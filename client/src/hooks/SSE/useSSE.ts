import { useEffect, useState } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useQueryClient } from '@tanstack/react-query';
import { useSetRecoilState } from 'recoil';
import { request, createPayload, removeNullishValues, QueryKeys } from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { TResData } from '~/common';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import { clearAllDrafts } from '~/utils';
import store from '~/store';

type ComplianceSeverity = 'HIGH' | 'MODERATE' | 'LOW';

interface ComplianceFinding {
  text: string;
  severity: ComplianceSeverity;
  reason: string;
  suggestion?: string;
}

const SUGGESTION_MAX_LEN = 600;

type CanvasStreamMessage =
  | { type: 'outerscore:stream-start' }
  | { type: 'outerscore:stream-chunk'; chunk: string; accumulated: string }
  | { type: 'outerscore:stream-end'; accumulated: string }
  | { type: 'outerscore:canvas-complete' }
  | { type: 'outerscore:compliance-result'; findings: ComplianceFinding[] };

const CANVAS_PLACEHOLDER_TEXT = '✍️ Content written to canvas.';
const COMPLIANCE_ENVELOPE = /<compliance>([\s\S]*?)<\/compliance>/;
const DOC_OPEN = '<document>';
const DOC_CLOSE = '</document>';

/**
 * Per-turn canvas intent. A reply is treated as document work only when it
 * begins with `<document>`; anything else is a normal chat reply and is left
 * untouched in the chat thread. Returns 'pending' while the streamed prefix is
 * still a possible start of the opening tag.
 */
type CanvasIntent = 'pending' | 'yes' | 'no';

const detectCanvasIntent = (text: string): CanvasIntent => {
  const t = text.replace(/^\s+/, '');
  if (t.length === 0) {
    return 'pending';
  }
  if (t.startsWith(DOC_OPEN)) {
    return 'yes';
  }
  return DOC_OPEN.startsWith(t) ? 'pending' : 'no';
};

/** Extract the document body (between the tags) from a document-mode reply. */
const extractDocBody = (text: string): string => {
  const t = text.replace(/^\s+/, '');
  // Find the <document> open tag anywhere (tolerate a preamble); fall back to
  // the whole reply when there is no envelope — e.g. weaker models, or 'always'
  // routing where the host already decided the reply targets the document.
  const openIdx = t.indexOf(DOC_OPEN);
  let body = openIdx !== -1 ? t.slice(openIdx + DOC_OPEN.length) : t;
  const closeIdx = body.indexOf(DOC_CLOSE);
  if (closeIdx !== -1) {
    body = body.slice(0, closeIdx);
  }
  // Strip the compliance envelope (parsed separately); never show it in the doc.
  const compIdx = body.indexOf('<compliance>');
  if (compIdx !== -1) {
    body = body.slice(0, compIdx);
  }
  return body.trim();
};

const SEVERITIES: Set<string> = new Set(['HIGH', 'MODERATE', 'LOW']);

const parseComplianceEnvelope = (text: string): {
  findings: ComplianceFinding[];
  stripped: string;
} => {
  const match = text.match(COMPLIANCE_ENVELOPE);
  if (!match) {
    return { findings: [], stripped: text };
  }
  let findings: ComplianceFinding[] = [];
  try {
    const parsed = JSON.parse(match[1]);
    if (Array.isArray(parsed?.findings)) {
      findings = parsed.findings.reduce<ComplianceFinding[]>((acc, item) => {
        if (
          item &&
          typeof item.text === 'string' &&
          typeof item.severity === 'string' &&
          typeof item.reason === 'string' &&
          SEVERITIES.has(item.severity.toUpperCase())
        ) {
          const finding: ComplianceFinding = {
            text: item.text,
            severity: item.severity.toUpperCase() as ComplianceSeverity,
            reason: item.reason,
          };
          if (typeof item.suggestion === 'string' && item.suggestion.trim().length > 0) {
            finding.suggestion = item.suggestion.slice(0, SUGGESTION_MAX_LEN);
          }
          acc.push(finding);
        }
        return acc;
      }, []);
    }
  } catch {
    /* malformed envelope — treat as no findings, keep original text */
    return { findings: [], stripped: text };
  }
  const stripped = text.slice(0, match.index).concat(text.slice((match.index ?? 0) + match[0].length)).trim();
  return { findings, stripped };
};

const extractMessageText = (message: TMessage | undefined | null): string => {
  if (!message) {
    return '';
  }
  if (typeof message.text === 'string' && message.text.length > 0) {
    return message.text;
  }
  const content = message.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return typeof message.text === 'string' ? message.text : '';
};

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
    const CANVAS_PAGES = new Set(['canvas2', 'sow-project-brief', 'sow-deliverable-description']);
    // Routing mode — the model-independence lever:
    //  'intent' (default): the model decides per reply by emitting <document>.
    //    Best for instruction-following models (Claude); keeps in-chat Q&A.
    //  'always': every reply on a canvas page IS the document — no envelope
    //    required, no model decision. Works on ANY model, incl. local/Ollama.
    //  Set VITE_OUTERSCORE_CANVAS_ROUTING=always to enable.
    const CANVAS_ROUTING: 'intent' | 'always' =
      ((import.meta.env.VITE_OUTERSCORE_CANVAS_ROUTING as string) || 'intent') === 'always'
        ? 'always'
        : 'intent';
    let isCanvasPage = false;
    try {
      isCanvasPage = CANVAS_PAGES.has(sessionStorage.getItem('outerscore:page') ?? '');
    } catch {
      /* ignore */
    }
    // Page must be canvas-capable; whether a given turn actually drives the
    // canvas is decided per-reply by canvasIntent (the <document> marker).
    const canvasCapable = isInIframe && isCanvasPage;
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
      if (CANVAS_ROUTING === 'always') {
        canvasIntent = 'yes';
      } else if (canvasIntent === 'no') {
        return;
      } else if (canvasIntent === 'pending') {
        canvasIntent = detectCanvasIntent(currentText);
        // Still ambiguous, or confirmed a plain chat reply → don't touch canvas.
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
          if (CANVAS_ROUTING === 'always') {
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
