import { useEffect, useState, useRef, useCallback } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useSetRecoilState } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import {
  request,
  Constants,
  QueryKeys,
  ErrorTypes,
  StepEvents,
  apiBaseUrl,
  createPayload,
  ViolationTypes,
  removeNullishValues,
} from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import {
  useGetUserBalance,
  useGetStartupConfig,
  queueTitleGeneration,
  streamStatusQueryKey,
} from '~/data-provider';
import type { ActiveJobsResponse } from '~/data-provider';
import type { CanvasIntent, CanvasStreamMessage } from '~/utils/canvas';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import { clearAllDrafts } from '~/utils';
import {
  detectCanvasIntent,
  extractDocBody,
  extractMessageText,
  isComplianceOnlyReply,
  isOnCanvasPage,
  markMessageAsCanvasDoc,
  parseComplianceEnvelope,
  postToParent,
  replaceTextParts,
  resolveCanvasRouting,
  stripCanvasEnvelopes,
  CANVAS_PLACEHOLDER_TEXT,
  COMPLIANCE_SUMMARY_TEXT,
} from '~/utils/canvas';
import store from '~/store';

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
>;

const MAX_RETRIES = 5;

/**
 * Hook for resumable SSE streams.
 * Separates generation start (POST) from stream subscription (GET EventSource).
 * Supports auto-reconnection with exponential backoff.
 *
 * Key behavior:
 * - Navigation away does NOT abort the generation (just closes SSE)
 * - Only explicit abort (via stop button → backend abort endpoint) stops generation
 * - Backend emits `done` event with `aborted: true` on abort, handled via finalHandler
 */
export default function useResumableSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const queryClient = useQueryClient();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();

  /**
   * Optimistically add a job ID to the active jobs cache.
   * Called when generation starts.
   */
  const addActiveJob = useCallback(
    (jobId: string) => {
      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: [...new Set([...(old?.activeJobIds ?? []), jobId])],
      }));
    },
    [queryClient],
  );

  /**
   * Optimistically remove a job ID from the active jobs cache.
   * Called when generation completes, aborts, or errors.
   */
  const removeActiveJob = useCallback(
    (jobId: string) => {
      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: (old?.activeJobIds ?? []).filter((id) => id !== jobId),
      }));
    },
    [queryClient],
  );
  const [_completed, setCompleted] = useState(new Set());
  const [streamId, setStreamId] = useState<string | null>(null);
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const sseRef = useRef<SSE | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const submissionRef = useRef<TSubmission | null>(null);

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    stepHandler,
    finalHandler,
    errorHandler,
    clearStepMaps,
    messageHandler,
    contentHandler,
    createdHandler,
    syncStepMessage,
    attachmentHandler,
    resetContentHandler,
  } = useEventHandlers({
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  /**
   * Subscribe to stream via SSE library (supports custom headers)
   * Follows same auth pattern as useSSE
   * @param isResume - If true, adds ?resume=true to trigger sync event from server
   */
  const subscribeToStream = useCallback(
    (currentStreamId: string, currentSubmission: TSubmission, isResume = false) => {
      let { userMessage } = currentSubmission;
      let textIndex: number | null = null;
      // Canvas streaming state — intent-aware, mirroring useSSE so this active
      // (resumable) path drives the editor canvas with the same logic.
      let rawText = '';
      let sentDocBody = '';
      let canvasStreamStarted = false;
      let canvasIntent: CanvasIntent = 'pending';
      const isInIframe = typeof window !== 'undefined' && window.parent !== window;
      // Routing (see utils/canvas): the user's composer toggle wins, else the env
      // lever. 'chat' never touches the canvas; 'always' forwards every reply as
      // the document (weak/local models); 'intent' (default, Claude) lets the
      // model decide via the <document> envelope, which keeps in-chat Q&A working.
      const canvasRouting = resolveCanvasRouting();
      const shouldPostToCanvas = isInIframe && isOnCanvasPage() && canvasRouting !== 'chat';
      const alwaysDocument = canvasRouting === 'always';
      const postToCanvas = (message: CanvasStreamMessage) => {
        if (!shouldPostToCanvas) return;
        postToParent(message);
      };
      const forwardCanvasStream = () => {
        if (!shouldPostToCanvas) return;
        const msgs = getMessages() ?? [];
        const last = msgs[msgs.length - 1];
        if (!last || last.isCreatedByUser) return;
        const currentText = extractMessageText(last);
        if (!currentText) return;
        rawText = currentText;
        // 'always': the host already decided this turn targets the document.
        // 'intent': document work the moment <document> appears (preambles
        // tolerated); while it's absent we stay pending and post nothing, so
        // a plain chat reply never touches the canvas mid-stream.
        if (alwaysDocument) {
          canvasIntent = 'yes';
        } else if (canvasIntent === 'pending') {
          canvasIntent = detectCanvasIntent(currentText);
          if (canvasIntent !== 'yes') return;
        }
        // Document reply: stream only the body inside <document>…</document>.
        const body = extractDocBody(currentText);
        if (body.length <= sentDocBody.length) return;
        if (!canvasStreamStarted) {
          canvasStreamStarted = true;
          postToCanvas({ type: 'outerscore:stream-start' });
        }
        const chunk = body.slice(sentDocBody.length);
        sentDocBody = body;
        postToCanvas({ type: 'outerscore:stream-chunk', chunk, accumulated: body });
      };
      const replaceLastAssistantText = (newText: string) => {
        const msgs = getMessages() ?? [];
        if (!msgs.length) return;
        const lastIdx = msgs.length - 1;
        const last = msgs[lastIdx];
        if (last.isCreatedByUser) return;
        // Replace only the TEXT parts — reasoning/think parts stay visible in chat.
        const replaced: TMessage = {
          ...last,
          text: newText,
          content: replaceTextParts(last.content, newText),
        };
        setMessages([...msgs.slice(0, lastIdx), replaced]);
        const convoId = last.conversationId ?? currentSubmission.conversation?.conversationId;
        if (convoId) {
          queryClient.setQueryData<TMessage[]>([QueryKeys.messages, convoId], (prev) => {
            if (!prev || prev.length === 0) return prev;
            const prevLast = prev[prev.length - 1];
            if (prevLast.isCreatedByUser) return prev;
            return [
              ...prev.slice(0, prev.length - 1),
              { ...prevLast, text: newText, content: replaceTextParts(prevLast.content, newText) },
            ];
          });
        }
      };
      const replaceLastAssistantWithCanvasPlaceholder = () => {
        const msgs = getMessages() ?? [];
        const last = msgs[msgs.length - 1];
        if (!last || last.isCreatedByUser) return;
        // Durable marker: this reply drove the canvas, so the display layer keeps
        // masking it even after the user switches mode (always-mode docs carry no
        // marker in their stored text).
        markMessageAsCanvasDoc(last.messageId);
        replaceLastAssistantText(CANVAS_PLACEHOLDER_TEXT);
      };
      // Chat mode forwards nothing, but a weak model may still emit the canvas
      // envelopes despite the chat-only instructions — strip them so the reply
      // reads as a clean chat bubble instead of raw tags.
      const sanitizeChatModeReply = () => {
        if (!isInIframe || canvasRouting !== 'chat' || !isOnCanvasPage()) return;
        const msgs = getMessages() ?? [];
        const last = msgs[msgs.length - 1];
        if (!last || last.isCreatedByUser) return;
        const current = extractMessageText(last);
        const stripped = stripCanvasEnvelopes(current);
        if (!stripped || stripped === current.trim()) return;
        replaceLastAssistantText(stripped);
      };

      const baseUrl = `${apiBaseUrl()}/api/agents/chat/stream/${encodeURIComponent(currentStreamId)}`;
      const url = isResume ? `${baseUrl}?resume=true` : baseUrl;
      console.log('[ResumableSSE] Subscribing to stream:', url, { isResume });

      const sse = new SSE(url, {
        headers: { Authorization: `Bearer ${token}` },
        method: 'GET',
      });
      sseRef.current = sse;

      sse.addEventListener('open', () => {
        console.log('[ResumableSSE] Stream connected');
        setAbortScroll(false);
        // Restore UI state on successful connection (including reconnection)
        setIsSubmitting(true);
        setShowStopButton(true);
        reconnectAttemptRef.current = 0;
      });

      sse.addEventListener('message', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);

          if (data.final != null) {
            console.log('[ResumableSSE] Received FINAL event', {
              aborted: data.aborted,
              conversationId: data.conversation?.conversationId,
              hasResponseMessage: !!data.responseMessage,
            });
            clearAllDrafts(currentSubmission.conversation?.conversationId);
            try {
              finalHandler(data, currentSubmission as EventSubmission);
            } catch (error) {
              console.error('[ResumableSSE] Error in finalHandler:', error);
              setIsSubmitting(false);
              setShowStopButton(false);
            }
            // Clear handler maps on stream completion to prevent memory leaks
            clearStepMaps();
            // Optimistically remove from active jobs
            removeActiveJob(currentStreamId);
            (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
            forwardCanvasStream();
            sanitizeChatModeReply();
            if (shouldPostToCanvas) {
              if (alwaysDocument) {
                canvasIntent = 'yes';
              } else if (canvasIntent === 'pending') {
                canvasIntent = detectCanvasIntent(rawText);
              }
              // Only a document reply drives the canvas; a normal chat reply is
              // left in the thread untouched (no stream-end, no placeholder).
              if (canvasIntent === 'yes') {
                const { findings } = parseComplianceEnvelope(rawText);
                const body = extractDocBody(rawText);
                // Never clobber the editor with an empty body (weak/aborted replies).
                if (body.length > 0) {
                  postToCanvas({ type: 'outerscore:stream-end', accumulated: body });
                  postToCanvas({ type: 'outerscore:compliance-result', findings });
                  replaceLastAssistantWithCanvasPlaceholder();
                  postToCanvas({ type: 'outerscore:canvas-complete' });
                }
              }
            }
            // Audit reply (a <compliance> envelope, no <document>): route findings
            // to the host panel and strip the envelope from the chat bubble. Runs
            // on any canvas page regardless of the chat/document toggle — findings
            // are not a canvas write — but NOT in always-mode, where the whole
            // reply IS the document (handled above). Read the message directly:
            // rawText is only populated when shouldPostToCanvas is true.
            if (isInIframe && isOnCanvasPage() && !alwaysDocument) {
              const msgs = getMessages() ?? [];
              const last = msgs[msgs.length - 1];
              const replyText = last && !last.isCreatedByUser ? extractMessageText(last) : '';
              if (isComplianceOnlyReply(replyText)) {
                const { findings } = parseComplianceEnvelope(replyText);
                postToParent({ type: 'outerscore:compliance-result', findings });
                const stripped = stripCanvasEnvelopes(replyText);
                replaceLastAssistantText(stripped || COMPLIANCE_SUMMARY_TEXT);
              }
            }
            sse.close();
            setStreamId(null);
            return;
          }

          if (data.created != null) {
            console.log('[ResumableSSE] Received CREATED event', {
              messageId: data.message?.messageId,
              conversationId: data.message?.conversationId,
            });
            const runId = v4();
            setActiveRunId(runId);
            userMessage = {
              ...userMessage,
              ...data.message,
              overrideParentMessageId: userMessage.overrideParentMessageId,
            };
            createdHandler(data, { ...currentSubmission, userMessage } as EventSubmission);
            return;
          }

          if (data.event === 'attachment' && data.data) {
            attachmentHandler({
              data: data.data,
              submission: currentSubmission as EventSubmission,
            });
            return;
          }

          if (data.event != null) {
            stepHandler(data, { ...currentSubmission, userMessage } as EventSubmission);
            // Agents endpoint streams text deltas through stepHandler — forward each one
            // to the canvas so it animates live (no-op until the assistant text grows).
            forwardCanvasStream();
            return;
          }

          if (data.sync != null) {
            console.log('[ResumableSSE] SYNC received', {
              runSteps: data.resumeState?.runSteps?.length ?? 0,
              pendingEvents: data.pendingEvents?.length ?? 0,
            });

            const runId = v4();
            setActiveRunId(runId);

            if (data.resumeState?.runSteps) {
              for (const runStep of data.resumeState.runSteps) {
                stepHandler({ event: StepEvents.ON_RUN_STEP, data: runStep }, {
                  ...currentSubmission,
                  userMessage,
                } as EventSubmission);
              }
            }

            if (data.resumeState?.aggregatedContent && userMessage?.messageId) {
              const messages = getMessages() ?? [];
              const userMsgId = userMessage.messageId;
              const serverResponseId = data.resumeState.responseMessageId;

              let responseIdx = -1;
              if (serverResponseId) {
                responseIdx = messages.findIndex((m) => m.messageId === serverResponseId);
              }
              if (responseIdx < 0) {
                responseIdx = messages.findIndex(
                  (m) =>
                    !m.isCreatedByUser &&
                    (m.messageId === `${userMsgId}_` || m.parentMessageId === userMsgId),
                );
              }

              console.log('[ResumableSSE] SYNC update', {
                userMsgId,
                serverResponseId,
                responseIdx,
                foundMessageId: responseIdx >= 0 ? messages[responseIdx]?.messageId : null,
                messagesCount: messages.length,
                aggregatedContentLength: data.resumeState.aggregatedContent?.length,
              });

              if (responseIdx >= 0) {
                const updated = [...messages];
                const oldContent = updated[responseIdx]?.content;
                updated[responseIdx] = {
                  ...updated[responseIdx],
                  content: data.resumeState.aggregatedContent,
                };
                console.log('[ResumableSSE] SYNC updating message', {
                  messageId: updated[responseIdx]?.messageId,
                  oldContentLength: Array.isArray(oldContent) ? oldContent.length : 0,
                  newContentLength: data.resumeState.aggregatedContent?.length,
                });
                setMessages(updated);
                resetContentHandler();
                syncStepMessage(updated[responseIdx]);
                console.log('[ResumableSSE] SYNC complete, handlers synced');
              } else {
                const responseId = serverResponseId ?? `${userMsgId}_`;
                const newMessage = {
                  messageId: responseId,
                  parentMessageId: userMsgId,
                  conversationId: currentSubmission.conversation?.conversationId ?? '',
                  text: '',
                  content: data.resumeState.aggregatedContent,
                  isCreatedByUser: false,
                } as TMessage;
                setMessages([...messages, newMessage]);
                resetContentHandler();
                syncStepMessage(newMessage);
              }
            }

            if (data.pendingEvents?.length > 0) {
              console.log(`[ResumableSSE] Replaying ${data.pendingEvents.length} pending events`);
              const submission = { ...currentSubmission, userMessage } as EventSubmission;
              for (const pendingEvent of data.pendingEvents) {
                if (pendingEvent.event != null) {
                  stepHandler(pendingEvent, submission);
                } else if (pendingEvent.type != null) {
                  contentHandler({ data: pendingEvent, submission });
                }
              }
            }

            setIsSubmitting(true);
            setShowStopButton(true);
            return;
          }

          if (data.type != null) {
            const { text, index } = data;
            if (text != null && index !== textIndex) {
              textIndex = index;
            }
            contentHandler({ data, submission: currentSubmission as EventSubmission });
            forwardCanvasStream();
            return;
          }

          if (data.message != null) {
            const text = data.text ?? data.response;
            const initialResponse = {
              ...(currentSubmission.initialResponse as TMessage),
              parentMessageId: data.parentMessageId,
              messageId: data.messageId,
            };
            messageHandler(text, { ...currentSubmission, userMessage, initialResponse });
            forwardCanvasStream();
          }
        } catch (error) {
          console.error('[ResumableSSE] Error processing message:', error);
        }
      });

      /**
       * Error event handler - handles BOTH:
       * 1. HTTP-level errors (responseCode present) - 404, 401, network failures
       * 2. Server-sent error events (event: error with data) - known errors like ViolationTypes/ErrorTypes
       *
       * Order matters: check responseCode first since HTTP errors may also include data
       */
      sse.addEventListener('error', async (e: MessageEvent) => {
        (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

        /* @ts-ignore - sse.js types don't expose responseCode */
        const responseCode = e.responseCode;

        // 404 → job completed & was cleaned up; messages are persisted in DB.
        // Invalidate cache once so react-query refetches instead of showing an error.
        if (responseCode === 404) {
          const convoId = currentSubmission.conversation?.conversationId;
          console.log('[ResumableSSE] Stream 404, invalidating messages for:', convoId);
          sse.close();
          removeActiveJob(currentStreamId);
          clearAllDrafts(convoId);
          clearStepMaps();
          if (convoId) {
            queryClient.invalidateQueries({ queryKey: [QueryKeys.messages, convoId] });
            queryClient.removeQueries({ queryKey: streamStatusQueryKey(convoId) });
          }
          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Check for 401 and try to refresh token (same pattern as useSSE)
        if (responseCode === 401) {
          try {
            const refreshResponse = await request.refreshToken();
            const newToken = refreshResponse?.token ?? '';
            if (!newToken) {
              throw new Error('Token refresh failed.');
            }
            sse.headers = {
              Authorization: `Bearer ${newToken}`,
            };
            request.dispatchTokenUpdatedEvent(newToken);
            sse.stream();
            return;
          } catch (error) {
            console.log('[ResumableSSE] Token refresh failed:', error);
          }
        }

        /**
         * Server-sent error event (event: error with data) - no responseCode.
         * These are known errors (ErrorTypes, ViolationTypes) that should be displayed to user.
         * Only check e.data if there's no HTTP responseCode, since HTTP errors may also have body data.
         */
        if (!responseCode && e.data) {
          console.log('[ResumableSSE] Server-sent error event received:', e.data);
          sse.close();
          removeActiveJob(currentStreamId);

          try {
            const errorData = JSON.parse(e.data);
            const errorString = errorData.error ?? errorData.message ?? JSON.stringify(errorData);

            // Check if it's a known error type (ViolationTypes or ErrorTypes)
            let isKnownError = false;
            try {
              const parsed =
                typeof errorString === 'string' ? JSON.parse(errorString) : errorString;
              const errorType = parsed?.type ?? parsed?.code;
              if (errorType) {
                const violationValues = Object.values(ViolationTypes) as string[];
                const errorTypeValues = Object.values(ErrorTypes) as string[];
                isKnownError =
                  violationValues.includes(errorType) || errorTypeValues.includes(errorType);
              }
            } catch {
              // Not JSON or parsing failed - treat as generic error
            }

            console.log('[ResumableSSE] Error type check:', { isKnownError, errorString });

            // Display the error to user via errorHandler
            errorHandler({
              data: { text: errorString } as unknown as Parameters<typeof errorHandler>[0]['data'],
              submission: currentSubmission as EventSubmission,
            });
          } catch (parseError) {
            console.error('[ResumableSSE] Failed to parse server error:', parseError);
            errorHandler({
              data: { text: e.data } as unknown as Parameters<typeof errorHandler>[0]['data'],
              submission: currentSubmission as EventSubmission,
            });
          }

          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
          reconnectAttemptRef.current = 0;
          return;
        }

        // Network failure or unknown HTTP error - attempt reconnection with backoff
        console.log('[ResumableSSE] Stream error (network failure) - will attempt reconnect', {
          responseCode,
          hasData: !!e.data,
        });

        if (reconnectAttemptRef.current < MAX_RETRIES) {
          // Increment counter BEFORE close() so abort handler knows we're reconnecting
          reconnectAttemptRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 30000);

          console.log(
            `[ResumableSSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current}/${MAX_RETRIES})`,
          );

          sse.close();

          reconnectTimeoutRef.current = setTimeout(() => {
            if (submissionRef.current) {
              // Reconnect with isResume=true to get sync event with any missed content
              subscribeToStream(currentStreamId, submissionRef.current, true);
            }
          }, delay);

          // Keep UI in "submitting" state during reconnection attempts
          // so user knows we're still trying (abort handler may have reset these)
          setIsSubmitting(true);
          setShowStopButton(true);
        } else {
          console.error('[ResumableSSE] Max reconnect attempts reached');
          sse.close();
          errorHandler({ data: undefined, submission: currentSubmission as EventSubmission });
          // Optimistically remove from active jobs on max retries
          removeActiveJob(currentStreamId);
          setIsSubmitting(false);
          setShowStopButton(false);
          setStreamId(null);
        }
      });

      /**
       * Abort event - fired when sse.close() is called (intentional close).
       * This happens on cleanup/navigation OR when error handler closes to reconnect.
       * Only reset state if we're NOT in a reconnection cycle.
       */
      sse.addEventListener('abort', () => {
        // If we're in a reconnection cycle, don't reset state
        // (error handler will set up the reconnect timeout)
        if (reconnectAttemptRef.current > 0) {
          console.log('[ResumableSSE] Stream closed for reconnect - preserving state');
          return;
        }

        console.log('[ResumableSSE] Stream aborted (intentional close) - no reconnect');
        // Clear any pending reconnect attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        // Reset UI state - useResumeOnLoad will restore if user returns to this conversation
        setIsSubmitting(false);
        setShowStopButton(false);
        setStreamId(null);
      });

      // Start the SSE connection
      sse.stream();

      // Debug hooks for testing reconnection vs clean close behavior (dev only)
      if (import.meta.env.DEV) {
        const debugWindow = window as Window & {
          __sse?: SSE;
          __killNetwork?: () => void;
          __closeClean?: () => void;
        };
        debugWindow.__sse = sse;

        /** Simulate network drop - triggers error event → reconnection */
        debugWindow.__killNetwork = () => {
          console.log('[Debug] Simulating network drop...');
          // @ts-ignore - sse.js types are incorrect, dispatchEvent actually takes Event
          sse.dispatchEvent(new Event('error'));
        };

        /** Simulate clean close (navigation away) - triggers abort event → no reconnection */
        debugWindow.__closeClean = () => {
          console.log('[Debug] Simulating clean close (navigation away)...');
          sse.close();
        };
      }
    },
    [
      token,
      setAbortScroll,
      setActiveRunId,
      setShowStopButton,
      finalHandler,
      createdHandler,
      attachmentHandler,
      stepHandler,
      contentHandler,
      resetContentHandler,
      syncStepMessage,
      clearStepMaps,
      messageHandler,
      errorHandler,
      setIsSubmitting,
      getMessages,
      setMessages,
      startupConfig?.balance?.enabled,
      balanceQuery,
      removeActiveJob,
      queryClient,
    ],
  );

  /**
   * Start generation (POST request that returns streamId)
   * Uses request.post which has axios interceptors for automatic token refresh.
   * Retries up to 3 times on network errors with exponential backoff.
   */
  const startGeneration = useCallback(
    async (currentSubmission: TSubmission): Promise<string | null> => {
      const payloadData = createPayload(currentSubmission);
      let { payload } = payloadData;
      payload = removeNullishValues(payload) as TPayload;

      clearStepMaps();

      const url = payloadData.server;

      const maxRetries = 3;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Use request.post which handles auth token refresh via axios interceptors
          const data = (await request.post(url, payload)) as { streamId: string };
          console.log('[ResumableSSE] Generation started:', { streamId: data.streamId });
          return data.streamId;
        } catch (error) {
          lastError = error;
          // Check if it's a network error (retry) vs server error (don't retry)
          const isNetworkError =
            error instanceof Error &&
            'code' in error &&
            (error.code === 'ERR_NETWORK' || error.code === 'ERR_INTERNET_DISCONNECTED');

          if (isNetworkError && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            console.log(
              `[ResumableSSE] Network error starting generation, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // Don't retry: either not a network error or max retries reached
          break;
        }
      }

      console.error('[ResumableSSE] Error starting generation:', lastError);

      const axiosError = lastError as { response?: { data?: Record<string, unknown> } };
      const errorData = axiosError?.response?.data;
      if (errorData) {
        errorHandler({
          data: { text: JSON.stringify(errorData) } as unknown as Parameters<
            typeof errorHandler
          >[0]['data'],
          submission: currentSubmission as EventSubmission,
        });
      } else {
        errorHandler({ data: undefined, submission: currentSubmission as EventSubmission });
      }
      setIsSubmitting(false);
      return null;
    },
    [clearStepMaps, errorHandler, setIsSubmitting],
  );

  useEffect(() => {
    if (!submission || Object.keys(submission).length === 0) {
      console.log('[ResumableSSE] No submission, cleaning up');
      // Clear reconnect timeout if submission is cleared
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Close SSE but do NOT dispatch cancel - navigation should not abort
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      setStreamId(null);
      reconnectAttemptRef.current = 0;
      submissionRef.current = null;
      return;
    }

    const resumeStreamId = (submission as TSubmission & { resumeStreamId?: string }).resumeStreamId;
    console.log('[ResumableSSE] Effect triggered', {
      conversationId: submission.conversation?.conversationId,
      hasResumeStreamId: !!resumeStreamId,
      resumeStreamId,
      userMessageId: submission.userMessage?.messageId,
    });

    submissionRef.current = submission;

    const initStream = async () => {
      setIsSubmitting(true);
      setShowStopButton(true);

      if (resumeStreamId) {
        // Resume: just subscribe to existing stream, don't start new generation
        console.log('[ResumableSSE] Resuming existing stream:', resumeStreamId);
        setStreamId(resumeStreamId);
        // Optimistically add to active jobs (in case it's not already there)
        addActiveJob(resumeStreamId);
        subscribeToStream(resumeStreamId, submission, true); // isResume=true
      } else {
        // New generation: start and then subscribe
        console.log('[ResumableSSE] Starting NEW generation');
        const newStreamId = await startGeneration(submission);
        if (newStreamId) {
          setStreamId(newStreamId);
          // Optimistically add to active jobs
          addActiveJob(newStreamId);
          // Queue title generation if this is a new conversation (first message)
          const isNewConvo = submission.userMessage?.parentMessageId === Constants.NO_PARENT;
          if (isNewConvo) {
            queueTitleGeneration(newStreamId);
          }
          subscribeToStream(newStreamId, submission);
        } else {
          console.error('[ResumableSSE] Failed to get streamId from startGeneration');
        }
      }
    };

    initStream();

    return () => {
      console.log('[ResumableSSE] Cleanup - closing SSE, resetting UI state');
      // Cleanup on unmount/navigation - close connection but DO NOT abort backend
      // Reset UI state so it doesn't leak to other conversations
      // If user returns to this conversation, useResumeOnLoad will restore the state
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Reset reconnect counter before closing (so abort handler doesn't think we're reconnecting)
      reconnectAttemptRef.current = 0;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      // Clear handler maps to prevent memory leaks and stale state
      clearStepMaps();
      // Reset UI state on cleanup - useResumeOnLoad will restore if needed
      setIsSubmitting(false);
      setShowStopButton(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  return { streamId };
}
