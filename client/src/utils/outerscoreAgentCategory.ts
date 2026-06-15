/**
 * The Outerscore feature the assistant was launched from, expressed as an agent
 * category. The host (Outerscore Angular app) forwards it as the `os_category`
 * URL param; `main.jsx` persists it to sessionStorage on boot. Read it here to
 * scope / pre-select the agent list for that feature (marketplace, agent picker).
 *
 * CONTRACT: the values below must stay in exact sync with:
 *  - the categories seeded by `ensureDefaultCategories()` in
 *    `packages/data-schemas/src/methods/agentCategory.ts` (the agent `category`), and
 *  - the `AiAgentCategory` enum in the Outerscore frontend library.
 */
const AGENT_CATEGORY_KEY = 'outerscore:agent-category';

/** All Outerscore agent-category values. Mirror of the seed list (source of truth). */
export const OUTERSCORE_AGENT_CATEGORIES = [
  'general',
  'user',
  'compliance',
  'reporting',
  'supplier',
  'workforce',
  'requisition',
  'rfx',
  'work_order_contracts',
  'timesheets_invoicing',
] as const;

export type OuterscoreAgentCategory = (typeof OUTERSCORE_AGENT_CATEGORIES)[number];

const VALID = new Set<string>(OUTERSCORE_AGENT_CATEGORIES);

/**
 * The agent category the embedded session was scoped to, or `null` when launched
 * unscoped (global launcher) or when the host sent an unknown value. Validated
 * against {@link OUTERSCORE_AGENT_CATEGORIES} so a stale/bad param never leaks
 * into a marketplace query.
 */
export const getAgentCategory = (): OuterscoreAgentCategory | null => {
  try {
    const value = sessionStorage.getItem(AGENT_CATEGORY_KEY) ?? '';
    return VALID.has(value) ? (value as OuterscoreAgentCategory) : null;
  } catch {
    return null;
  }
};

/** True when the session is scoped to a specific Outerscore feature category. */
export const hasAgentCategory = (): boolean => getAgentCategory() !== null;
