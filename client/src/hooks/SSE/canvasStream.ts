import { QueryKeys } from 'librechat-data-provider';
import type { QueryClient } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import type { CanvasIntent, CanvasStreamMessage } from '~/utils/canvas';
import {
  detectCanvasIntent,
  extractDocBody,
  extractMessageText,
  formatComplianceReply,
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
  NO_COMPLIANCE_FINDINGS_TEXT,
} from '~/utils/canvas';

export interface CanvasStreamBridgeDeps {
  getMessages: () => TMessage[] | undefined;
  setMessages: (messages: TMessage[]) => void;
  queryClient: QueryClient;
  /** Conversation id fallback when the last message carries none (mirrors the SSE submission). */
  getConversationId: () => string | null | undefined;
}

export interface CanvasStreamBridge {
  /** Forward the latest assistant text delta to the host canvas (no-op off a canvas page / in chat mode). */
  forwardCanvasStream: () => void;
  /**
   * Stream-end housekeeping for the SSE `final` event: flush the final document
   * body to the canvas and swap the chat bubble for the placeholder, or route a
   * compliance-only reply to the findings panel. Idempotent for one stream.
   */
  finalize: () => void;
}

/**
 * Per-stream Outerscore canvas bridge shared by `useSSE` and `useResumableSSE`.
 * Holds the intent/streaming state for one model reply and forwards document
 * work to the embedding host. Created once per stream (not per render), so it
 * is a plain factory rather than a hook — the two SSE paths previously carried
 * identical copies of this logic.
 */
export const createCanvasStreamBridge = ({
  getMessages,
  setMessages,
  queryClient,
  getConversationId,
}: CanvasStreamBridgeDeps): CanvasStreamBridge => {
  let rawText = '';
  let sentDocBody = '';
  let canvasStreamStarted = false;
  let canvasIntent: CanvasIntent = 'pending';

  const isInIframe = typeof window !== 'undefined' && window.parent !== window;
  // Routing (see utils/canvas): the user's composer toggle wins, else the env
  // lever. 'chat' never touches the canvas; 'always' forwards every reply as the
  // document (weak/local models); 'intent' (default, Claude) lets the model
  // decide via the <document> envelope, which keeps in-chat Q&A working.
  const canvasRouting = resolveCanvasRouting();
  // Page must be canvas-capable; whether a given turn actually drives the canvas
  // is decided per-reply by canvasIntent (the <document> marker).
  const canvasCapable = isInIframe && isOnCanvasPage() && canvasRouting !== 'chat';
  const alwaysDocument = canvasRouting === 'always';

  const postToCanvas = (message: CanvasStreamMessage) => {
    if (!canvasCapable) {
      return;
    }
    postToParent(message);
  };

  const replaceLastAssistantText = (newText: string) => {
    const msgs = getMessages();
    if (!msgs || msgs.length === 0) {
      return;
    }
    const lastIdx = msgs.length - 1;
    const last = msgs[lastIdx];
    if (last.isCreatedByUser) {
      return;
    }
    // Replace only the TEXT parts — reasoning/think parts stay visible in chat.
    const replaced: TMessage = {
      ...last,
      text: newText,
      content: replaceTextParts(last.content, newText),
    };
    setMessages([...msgs.slice(0, lastIdx), replaced]);
    const convoId = last.conversationId ?? getConversationId();
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
          { ...prevLast, text: newText, content: replaceTextParts(prevLast.content, newText) },
        ];
      });
    }
  };

  const replaceLastAssistantWithPlaceholder = () => {
    const msgs = getMessages();
    const last = msgs?.[msgs.length - 1];
    if (!last || last.isCreatedByUser) {
      return;
    }
    // Durable marker: this reply drove the canvas, so the display layer keeps
    // masking it even after the user switches mode (always-mode docs carry no
    // marker in their stored text).
    markMessageAsCanvasDoc(last.messageId);
    replaceLastAssistantText(CANVAS_PLACEHOLDER_TEXT);
  };

  // Chat mode forwards nothing, but a weak model may still emit the canvas
  // envelopes despite the chat-only instructions — strip them so the reply reads
  // as a clean chat bubble instead of raw tags.
  const sanitizeChatModeReply = () => {
    if (!isInIframe || canvasRouting !== 'chat' || !isOnCanvasPage()) {
      return;
    }
    const msgs = getMessages() ?? [];
    const last = msgs[msgs.length - 1];
    if (!last || last.isCreatedByUser) {
      return;
    }
    const current = extractMessageText(last);
    const stripped = stripCanvasEnvelopes(current);
    if (!stripped || stripped === current.trim()) {
      return;
    }
    replaceLastAssistantText(stripped);
  };

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
    // 'always' routing: the host already decided this turn targets the document,
    // so route every reply to the canvas — no <document> envelope required (works
    // on any model). 'intent': the model decides via the tag (preambles
    // tolerated); while it's absent we stay pending and post nothing, so a plain
    // chat reply never touches the canvas mid-stream.
    if (alwaysDocument) {
      canvasIntent = 'yes';
    } else if (canvasIntent === 'pending') {
      canvasIntent = detectCanvasIntent(currentText);
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
    postToCanvas({ type: 'outerscore:stream-chunk', chunk, accumulated: body });
  };

  // Route a compliance-only reply (the selected compliance agent) to the findings
  // panel: post the parsed findings to the host and replace the raw <compliance>
  // JSON in the chat bubble. Returns true when it handled the reply, so finalize
  // can stop before the document / chat-mode paths touch it. A compliance envelope
  // is ALWAYS an audit — never document content and never a chat answer — so this
  // runs regardless of routing mode (always/chat included).
  const routeComplianceReply = (): boolean => {
    const msgs = getMessages() ?? [];
    const last = msgs[msgs.length - 1];
    const replyText = last && !last.isCreatedByUser ? extractMessageText(last) : '';
    if (!isComplianceOnlyReply(replyText)) {
      return false;
    }
    const { findings } = parseComplianceEnvelope(replyText);
    if (isInIframe && isOnCanvasPage()) {
      postToParent({ type: 'outerscore:compliance-result', findings });
      const stripped = stripCanvasEnvelopes(replyText);
      replaceLastAssistantText(
        stripped || (findings.length > 0 ? COMPLIANCE_SUMMARY_TEXT : NO_COMPLIANCE_FINDINGS_TEXT),
      );
    } else {
      replaceLastAssistantText(formatComplianceReply(replyText));
    }
    return true;
  };

  const finalize = () => {
    forwardCanvasStream();
    // Audit replies are handled first and unconditionally: neither the always-mode
    // document path nor chat-mode envelope stripping may swallow the findings.
    if (routeComplianceReply()) {
      return;
    }
    sanitizeChatModeReply();
    if (canvasCapable) {
      if (alwaysDocument) {
        canvasIntent = 'yes';
      } else if (canvasIntent === 'pending') {
        canvasIntent = detectCanvasIntent(rawText);
      }
      // Only a document reply drives the canvas; a normal chat reply is left in
      // the thread untouched (no stream-end, no placeholder).
      if (canvasIntent === 'yes') {
        // TODO(compliance): regular-mode compliance is disabled — a document write
        // no longer forwards findings (they referenced the pre-edit content and
        // mismatched the editor highlights). Compliance is produced only by the
        // explicitly-selected compliance agent (handled by routeComplianceReply above).
        const body = extractDocBody(rawText);
        // Never clobber the editor with an empty body (weak/aborted replies).
        if (body.length > 0) {
          postToCanvas({ type: 'outerscore:stream-end', accumulated: body });
          replaceLastAssistantWithPlaceholder();
          postToCanvas({ type: 'outerscore:canvas-complete' });
        }
      }
    }
  };

  return { forwardCanvasStream, finalize };
};
