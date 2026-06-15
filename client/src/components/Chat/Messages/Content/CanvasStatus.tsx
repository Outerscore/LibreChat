import type { TMessageContentParts } from 'librechat-data-provider';
import {
  extractDocBody,
  extractPartText,
  isOnCanvasPage,
  postToParent,
  resolveCanvasRouting,
  shouldMaskCanvasReply,
  CANVAS_PLACEHOLDER_TEXT,
} from '~/utils/canvas';
import { useLocalize } from '~/hooks';
import Container from './Container';

/** Alias of {@link isOnCanvasPage}; the canvas-page allow-list lives in utils/canvas. */
export const isCanvas2Mode = (): boolean => isOnCanvasPage();

/** Visible text of the content parts — reasoning/think parts excluded (shared extractor). */
export const extractPartsText = (content?: Array<TMessageContentParts | undefined>): string => {
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map(extractPartText).join('');
};

/**
 * Pushes the active assistant message's document body to the parent canvas
 * (envelope stripped — the host editor must never see raw `<document>` tags).
 * `initial: true` marks a mount-time re-announcement (conversation reopen /
 * message remount) rather than a user-driven change — the host only applies an
 * initial post when its editor is empty, so reopening a restored conversation
 * can never clobber the current document.
 */
export const postCanvasContent = (
  content?: Array<TMessageContentParts | undefined>,
  initial = false,
  messageId?: string | null,
): void => {
  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }
  // Chat mode never drives the editor, and only document work may be (re)posted:
  // a Q&A reply or the bare in-session placeholder must not land as content.
  if (resolveCanvasRouting() === 'chat') {
    return;
  }
  const raw = extractPartsText(content);
  if (raw.trim() === CANVAS_PLACEHOLDER_TEXT || !shouldMaskCanvasReply(raw, messageId)) {
    return;
  }
  const text = extractDocBody(raw);
  if (!text) {
    return;
  }
  postToParent({ type: 'outerscore:content', html: text, initial });
};

export const CanvasWritingIndicator = () => {
  const localize = useLocalize();
  return (
    <Container>
      <div className="flex items-center gap-2 py-2 text-text-secondary">
        <svg
          className="h-4 w-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <span className="text-sm">{localize('com_ui_generating')}</span>
      </div>
    </Container>
  );
};

export const CanvasDoneIndicator = () => {
  const localize = useLocalize();
  return (
    <Container>
      <div className="flex items-center gap-2 py-2 text-text-secondary">
        <span className="text-sm">{localize('com_ui_canvas_written')}</span>
      </div>
    </Container>
  );
};
