import { useEffect, useState } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useQueryClient } from '@tanstack/react-query';
import { useSetRecoilState } from 'recoil';
import { request, createPayload, removeNullishValues, QueryKeys } from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { TResData } from '~/common';
import type { CanvasIntent, CanvasStreamMessage } from '~/utils/canvas';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import { clearAllDrafts } from '~/utils';
import {
  detectCanvasIntent,
  extractDocBody,
  extractMessageText,
  isOnCanvasPage,
  markMessageAsCanvasDoc,
  parseComplianceEnvelope,
  resolveCanvasRouting,
  CANVAS_PLACEHOLDER_TEXT,
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

export default function useSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();
  const [completed, setCompleted] = useState(new Set());
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));
  const queryClient = useQueryClient();

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    clearStepMaps,
    stepHandler,
    syncHandler,
    finalHandler,
    errorHandler,
    messageHandler,
    contentHandler,
    createdHandler,
    attachmentHandler,
    abortConversation,
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

  useEffect(() => {
    if (submission == null || Object.keys(submission).length === 0) {
      return;
    }

    let { userMessage } = submission;

    const payloadData = createPayload(submission);
    let { payload } = payloadData;
    payload = removeNullishValues(payload) as TPayload;

    let textIndex = null;
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
    // Page must be canvas-capable; whether a given turn actually drives the
    // canvas is decided per-reply by canvasIntent (the <document> marker).
    const canvasCapable = isInIframe && isOnCanvasPage() && canvasRouting !== 'chat';
    const alwaysDocument = canvasRouting === 'always';
    const postToCanvas = (message: CanvasStreamMessage) => {
      if (!canvasCapable) {
        return;
      }
      window.parent.postMessage(message, '*');
    };
    const replaceLastAssistantWithPlaceholder = () => {
      const msgs = getMessages();
      if (!msgs || msgs.length === 0) {
        return;
      }
      const lastIdx = msgs.length - 1;
      const last = msgs[lastIdx];
      if (last.isCreatedByUser) {
        return;
      }
      // Durable marker: this reply drove the canvas, so the display layer keeps
      // masking it even after the user switches mode (always-mode docs carry no
      // marker in their stored text).
      markMessageAsCanvasDoc(last.messageId);
      const replaced: TMessage = {
        ...last,
        text: CANVAS_PLACEHOLDER_TEXT,
        content: undefined,
      };
      const nextMessages = [...msgs.slice(0, lastIdx), replaced];
      setMessages(nextMessages);
      const convoId = last.conversationId ?? submission.conversation?.conversationId;
      if (convoId) {
        queryClient.setQueryData<TMessage[]>([QueryKeys.messages, convoId], (prev) => {
          if (!prev || prev.length === 0) {
            return prev;
          }
          const prevLast = prev[prev.length - 1];
          if (prevLast.isCreatedByUser) {
            return prev;
          }
          return [
            ...prev.slice(0, prev.length - 1),
            { ...prevLast, text: CANVAS_PLACEHOLDER_TEXT, content: undefined },
          ];
        });
      }
    };
    clearStepMaps();

    const sse = new SSE(payloadData.server, {
      payload: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    sse.addEventListener('attachment', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error(error);
      }
    });

    const forwardCanvasStream = () => {
      if (!canvasCapable) {
        return;
      }
      const msgs = getMessages() ?? [];
      const last = msgs[msgs.length - 1];
      if (!last || last.isCreatedByUser) {
        return;
      }
      const currentText = extractMessageText(last);
      if (!currentText) {
        return;
      }
      rawText = currentText;
      // 'always' routing: the host already decided this turn targets the
      // document, so route every reply to the canvas — no <document> envelope
      // required (works on any model). 'intent': the model decides via the tag.
      if (alwaysDocument) {
        canvasIntent = 'yes';
      } else if (canvasIntent === 'pending') {
        canvasIntent = detectCanvasIntent(currentText);
        // No <document> tag yet — it may still arrive (weak models preamble
        // first), so stay pending and post nothing to the canvas.
        if (canvasIntent !== 'yes') {
          return;
        }
      }
      // Document reply: stream only the body inside <document>…</document>.
      const body = extractDocBody(currentText);
      if (body.length <= sentDocBody.length) {
        return;
      }
      if (!canvasStreamStarted) {
        canvasStreamStarted = true;
        postToCanvas({ type: 'outerscore:stream-start' });
      }
      const chunk = body.slice(sentDocBody.length);
      sentDocBody = body;
      postToCanvas({
        type: 'outerscore:stream-chunk',
        chunk,
        accumulated: body,
      });
    };

    sse.addEventListener('message', (e: MessageEvent) => {
      const data = JSON.parse(e.data);

      if (data.final != null) {
        clearAllDrafts(submission.conversation?.conversationId);
        try {
          finalHandler(data, submission as EventSubmission);
        } catch (error) {
          console.error('Error in finalHandler:', error);
          setIsSubmitting(false);
          setShowStopButton(false);
        }
        (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
        forwardCanvasStream();
        if (canvasCapable) {
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
            // Never clobber the editor with an empty body — weak models can
            // return nothing usable; leave the chat reply in place instead.
            if (body.length > 0) {
              postToCanvas({ type: 'outerscore:stream-end', accumulated: body });
              postToCanvas({ type: 'outerscore:compliance-result', findings });
              replaceLastAssistantWithPlaceholder();
              postToCanvas({ type: 'outerscore:canvas-complete' });
            }
          }
        }
        console.log('final', data);
        return;
      } else if (data.created != null) {
        const runId = v4();
        setActiveRunId(runId);
        userMessage = {
          ...userMessage,
          ...data.message,
          overrideParentMessageId: userMessage.overrideParentMessageId,
        };

        createdHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.event != null) {
        stepHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.sync != null) {
        const runId = v4();
        setActiveRunId(runId);
        /* synchronize messages to Assistants API as well as with real DB ID's */
        syncHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.type != null) {
        const { text, index } = data;
        if (text != null && index !== textIndex) {
          textIndex = index;
        }

        contentHandler({ data, submission: submission as EventSubmission });
      } else {
        const text: string = data.text ?? data.response ?? '';

        const initialResponse = {
          ...(submission.initialResponse as TMessage),
          parentMessageId: data.parentMessageId,
          messageId: data.messageId,
        };

        if (data.message != null) {
          messageHandler(text, { ...submission, userMessage, initialResponse });
        }
      }

      forwardCanvasStream();
    });

    sse.addEventListener('open', () => {
      setAbortScroll(false);
      console.log('connection is opened');
    });

    sse.addEventListener('cancel', async () => {
      const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
      if (completed.has(streamKey)) {
        setIsSubmitting(false);
        setCompleted((prev) => {
          prev.delete(streamKey);
          return new Set(prev);
        });
        return;
      }

      setCompleted((prev) => new Set(prev.add(streamKey)));
      const latestMessages = getMessages();
      const conversationId = latestMessages?.[latestMessages.length - 1]?.conversationId;
      try {
        await abortConversation(
          conversationId ??
            userMessage.conversationId ??
            submission.conversation?.conversationId ??
            '',
          submission as EventSubmission,
          latestMessages,
        );
      } catch (error) {
        console.error('Error during abort:', error);
        setIsSubmitting(false);
        setShowStopButton(false);
      }
    });

    sse.addEventListener('error', async (e: MessageEvent) => {
      /* @ts-ignore */
      if (e.responseCode === 401) {
        /* token expired, refresh and retry */
        try {
          const refreshResponse = await request.refreshToken();
          const token = refreshResponse?.token ?? '';
          if (!token) {
            throw new Error('Token refresh failed.');
          }
          sse.headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          };

          request.dispatchTokenUpdatedEvent(token);
          sse.stream();
          return;
        } catch (error) {
          /* token refresh failed, continue handling the original 401 */
          console.log(error);
        }
      }

      console.log('error in server stream.');
      (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

      let data: TResData | undefined = undefined;
      try {
        data = JSON.parse(e.data) as TResData;
      } catch (error) {
        console.error(error);
        console.log(e);
        setIsSubmitting(false);
      }

      errorHandler({ data, submission: { ...submission, userMessage } as EventSubmission });
    });

    setIsSubmitting(true);
    sse.stream();

    return () => {
      const isCancelled = sse.readyState <= 1;
      sse.close();
      if (isCancelled) {
        const e = new Event('cancel');
        /* @ts-ignore */
        sse.dispatchEvent(e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);
}
