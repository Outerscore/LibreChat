import type { TranslationKeys } from '~/hooks/useLocalize';

export interface OuterscoreStarter {
  labelKey: TranslationKeys;
  prompt: string;
}

/**
 * Placeholder conversation starters shown on the embedded landing when the
 * active entity has no `conversation_starters` of its own. The labels are
 * localized; the `prompt` is the text actually sent. Both are dummies for now
 * and will be swapped for real product prompts.
 */
export const OS_EMBEDDED_STARTERS: OuterscoreStarter[] = [
  {
    labelKey: 'com_ui_os_starter_statistics',
    prompt: 'This is a placeholder prompt that will provide statistics about my workspace.',
  },
  {
    labelKey: 'com_ui_os_starter_requisition',
    prompt: 'This is a placeholder prompt that will help me create a new requisition.',
  },
  {
    labelKey: 'com_ui_os_starter_report',
    prompt: 'This is a placeholder prompt that will help me create a new report.',
  },
  {
    labelKey: 'com_ui_os_starter_todos',
    prompt: 'This is a placeholder prompt that will show me my current to-dos.',
  },
];
