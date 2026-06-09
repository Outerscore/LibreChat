import type { TMessageContentParts } from 'librechat-data-provider';
import { isOnCanvasPage } from '~/utils/canvas';
import { useLocalize } from '~/hooks';
import Container from './Container';

/** Alias of {@link isOnCanvasPage}; the canvas-page allow-list lives in utils/canvas. */
export const isCanvas2Mode = (): boolean => isOnCanvasPage();

const extractPartsText = (content?: Array<TMessageContentParts | undefined>): string => {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (part == null) {
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
};

/**
 * Pushes a completed assistant message's text to the parent canvas. Used when the
 * displayed variant changes outside of live streaming (e.g. switching regenerate
 * siblings), so the canvas reflects the selected answer.
 */
export const postCanvasContent = (content?: Array<TMessageContentParts | undefined>): void => {
  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }
  const text = extractPartsText(content);
  if (!text) {
    return;
  }
  window.parent.postMessage({ type: 'outerscore:content', html: text }, '*');
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
