import { useCallback, useState } from 'react';
import { isOuterscoreContext } from '~/hooks/useOuterscoreAutoLogin';
import { getCanvasMode, setCanvasMode, isOnCanvasPage } from '~/utils/canvas';
import type { CanvasMode } from '~/utils/canvas';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ModeOption {
  mode: CanvasMode;
  labelKey: TranslationKeys;
  titleKey: TranslationKeys;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'auto', labelKey: 'com_ui_os_mode_auto', titleKey: 'com_ui_os_mode_auto_tip' },
  { mode: 'chat', labelKey: 'com_ui_os_mode_chat', titleKey: 'com_ui_os_mode_chat_tip' },
  {
    mode: 'document',
    labelKey: 'com_ui_os_mode_document',
    titleKey: 'com_ui_os_mode_document_tip',
  },
];

/**
 * Segmented "Auto / Chat / Document" control shown in the composer on embedded
 * canvas pages. It drives the per-turn canvas routing (utils/canvas →
 * `resolveCanvasRouting`): 'chat' keeps every reply in the thread, 'document'
 * makes every reply rewrite the editor document (works on any model), 'auto'
 * leaves the decision to the intent envelope / env lever.
 */
const CanvasModeToggle = () => {
  const localize = useLocalize();
  const [mode, setMode] = useState<CanvasMode>(getCanvasMode);

  const selectMode = useCallback((next: CanvasMode) => {
    setCanvasMode(next);
    setMode(next);
  }, []);

  if (!isOuterscoreContext() || !isOnCanvasPage()) {
    return null;
  }

  return (
    <div
      className="os-mode-toggle flex items-center"
      role="radiogroup"
      aria-label={localize('com_ui_os_mode_label')}
    >
      {MODE_OPTIONS.map(({ mode: option, labelKey, titleKey }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          title={localize(titleKey)}
          onClick={() => selectMode(option)}
          className={cn('os-mode-chip', mode === option && 'os-mode-chip--active')}
        >
          {localize(labelKey)}
        </button>
      ))}
    </div>
  );
};

export default CanvasModeToggle;
