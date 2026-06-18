import { EModelEndpoint } from 'librechat-data-provider';
import type { TPreset } from 'librechat-data-provider';

/**
 * The model a brand-new chat defaults to. Outerscore ships no pre-seeded agents,
 * so every fresh conversation starts on Sonnet rather than restoring the user's
 * last-picked model from localStorage. The picked model is still carried across
 * close/open/pin/unpin (in-memory conversation state) and history selection (each
 * conversation loads its own saved model) — those paths never hit this default.
 */
export const OUTERSCORE_DEFAULT_MODEL = 'claude-sonnet-4-6';

export const OUTERSCORE_DEFAULT_PRESET: Partial<TPreset> = {
  endpoint: EModelEndpoint.anthropic,
  model: OUTERSCORE_DEFAULT_MODEL,
};

/**
 * Whether a new-conversation template carries an explicit endpoint/model/agent
 * selection. When it doesn't, the fresh chat should fall back to the Outerscore
 * Sonnet default instead of the persisted last-selected model.
 */
export const hasExplicitConvoSelection = (template: {
  endpoint?: string | null;
  model?: string | null;
  agent_id?: string | null;
  assistant_id?: string | null;
  spec?: string | null;
}): boolean =>
  template.endpoint != null ||
  template.model != null ||
  template.agent_id != null ||
  template.assistant_id != null ||
  template.spec != null;
