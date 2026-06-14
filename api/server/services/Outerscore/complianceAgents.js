const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { ResourceType, PrincipalType, AccessRoleIds } = require('librechat-data-provider');
const { getAgent, createAgent, findUser } = require('~/models');
const { grantPermission } = require('~/server/services/PermissionService');

/**
 * Auto-seeded compliance agents (WP-H). The rule set lives here in code and is
 * seeded into MongoDB at server startup, then shared PUBLIC so it appears in
 * every user's agent picker — the compliance feature is triggered by SELECTING
 * the agent (or by an AUDIT-intent prompt in regular mode), with no button and
 * no per-deployment provisioning. The seeded agents are normal LibreChat agents:
 * the rule owner can open them in the builder and edit the rules live (seed is
 * **create-if-absent only** — a restart never overwrites a UI edit).
 *
 * Canonical, human-readable copy of these prompts:
 *   frontend docs/ai-integration/compliance-agent-instructions.md
 * Keep the two in sync. The `DO NOT EDIT` envelope section is a machine contract
 * with `parseComplianceEnvelope` (client/src/utils/canvas.ts) — never reword it
 * without changing the parser in the same release.
 */

/** Fixed author for seeded agents (no real user exists at boot). PUBLIC viewer
 *  grant — not the author — is what makes them selectable by everyone. */
const SYSTEM_AUTHOR_ID = new mongoose.Types.ObjectId('000000000000000000000001');

const ENVELOPE_PROTOCOL = [
  '──────────────────────── DO NOT EDIT BELOW THIS LINE ────────────────────────',
  'Reply with a single compliance envelope and NOTHING else — no preamble, no Markdown, no code fences:',
  '<compliance>{"findings":[{"text":"<verbatim span>","severity":"HIGH|MODERATE|LOW","reason":"<short explanation>","suggestion":"<optional in-place replacement>"}]}</compliance>',
  'If there is nothing to flag, reply exactly:',
  '<compliance>{"findings":[]}</compliance>',
].join('\n');

const FINDING_RULES = [
  'For every finding:',
  '- "text" must be a VERBATIM, contiguous span copied exactly from the document (it is used to locate and highlight the text — any paraphrase breaks the highlight).',
  '- Keep each span as short as possible while still unambiguous (a phrase or one sentence, not a whole paragraph).',
  '- "reason" is one short sentence explaining the problem.',
  '- Include "suggestion" ONLY when a single in-place replacement fixes the issue; write it so it can replace the flagged span verbatim, and keep it under 600 characters. When the right fix is to delete text or restructure, omit "suggestion".',
  '- Do not flag the same span twice; report at most the 10 most important findings.',
].join('\n');

const PROJECT_BRIEF_INSTRUCTIONS = [
  'You are a procurement compliance reviewer for SOW Project Briefs on the Outerscore platform. You will be given the current text of a Project Brief. Your only job is to audit it against the rules below and report findings. You never rewrite the document, never add commentary, and never answer questions.',
  '',
  'Check the text against these rules:',
  '- Discriminatory or biased wording (gender, age, nationality, or other protected characteristics) — flag HIGH.',
  '- Vendor-locked or branded language where a neutral alternative exists — flag MODERATE.',
  '- GDPR / data-handling obligations missing when personal data is clearly in scope — flag HIGH.',
  '- Ambiguous deadlines, vague scope statements, or unmeasurable success criteria — flag MODERATE (LOW when the statement is merely imprecise but verifiable).',
  '',
  FINDING_RULES,
  '',
  ENVELOPE_PROTOCOL,
].join('\n');

const DELIVERABLE_INSTRUCTIONS = [
  'You are a procurement compliance reviewer for SOW deliverable descriptions on the Outerscore platform. You will be given the current text of a deliverable description. Your only job is to audit it against the rules below and report findings. You never rewrite the document, never add commentary, and never answer questions.',
  '',
  'Check the text against these rules:',
  '- Vague acceptance criteria ("works well", "as needed", "to satisfaction", or any criterion that cannot be objectively tested) — flag HIGH.',
  '- "TBD" / "TBC" placeholders left unresolved — flag MODERATE.',
  '- Missing units on durations or quantities (e.g. "delivery within 5" — 5 what?) — flag MODERATE.',
  '- Unrealistic timelines given the listed scope — flag LOW (advisory; judgement call).',
  '- Discriminatory or biased wording — flag HIGH.',
  '',
  FINDING_RULES,
  '',
  ENVELOPE_PROTOCOL,
].join('\n');

/** Default model for seeded agents; override per deployment with OUTERSCORE_COMPLIANCE_MODEL. */
const DEFAULT_COMPLIANCE_MODEL = 'claude-sonnet-4-6';

/**
 * os_page → seed spec. The `id` is deterministic so the route resolves the
 * agent without any stored mapping; it doubles as the create-if-absent key.
 */
const COMPLIANCE_SPECS = {
  'sow-project-brief': {
    id: 'agent_oscompliance__sow-project-brief',
    name: 'Outerscore Compliance — Project Brief',
    description: 'Auto-seeded: audits SOW Project Briefs against procurement/compliance rules.',
    instructions: PROJECT_BRIEF_INSTRUCTIONS,
  },
  'sow-deliverable-description': {
    id: 'agent_oscompliance__sow-deliverable-description',
    name: 'Outerscore Compliance — Deliverable Description',
    description: 'Auto-seeded: audits SOW deliverable descriptions against compliance rules.',
    instructions: DELIVERABLE_INSTRUCTIONS,
  },
};

/** Grant a designated rule owner EDIT rights so they can tune rules in the builder. */
const grantOwnerEmailEditor = async (agent) => {
  const email = (process.env.OUTERSCORE_COMPLIANCE_OWNER_EMAIL || '').trim().toLowerCase();
  if (!email) {
    return;
  }
  try {
    const owner = await findUser({ email });
    if (!owner?._id) {
      logger.warn(`[outerscore] OWNER_EMAIL "${email}" not found — skipping editor grant`);
      return;
    }
    await grantPermission({
      principalType: PrincipalType.USER,
      principalId: owner._id,
      resourceType: ResourceType.AGENT,
      resourceId: agent._id,
      accessRoleId: AccessRoleIds.AGENT_EDITOR,
      grantedBy: SYSTEM_AUTHOR_ID,
    });
  } catch (err) {
    logger.warn(`[outerscore] owner-email editor grant failed for ${agent.id}:`, err.message);
  }
};

/**
 * Ensure one compliance agent exists and has the right access grants. Both the
 * agent (create-if-absent — a live builder edit is never overwritten) and the
 * grants are idempotent, so the grants below are (re)applied on EVERY startup —
 * which lets a newly-set OUTERSCORE_COMPLIANCE_OWNER_EMAIL gain edit access on
 * the already-seeded agents without deleting/re-seeding them.
 */
const seedOne = async (spec) => {
  let agent = await getAgent({ id: spec.id });
  if (!agent) {
    const model = process.env.OUTERSCORE_COMPLIANCE_MODEL || DEFAULT_COMPLIANCE_MODEL;
    agent = await createAgent({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      instructions: spec.instructions,
      provider: 'anthropic',
      model,
      // No `temperature`: Sonnet runs with extended thinking enabled, and Anthropic
      // rejects `temperature` when thinking is on ("temperature is not supported
      // when thinking is enabled"). Thinking is fine for compliance reasoning.
      model_parameters: {},
      tools: [],
      author: SYSTEM_AUTHOR_ID,
    });
    logger.info(`[outerscore] seeded compliance agent ${spec.id} (model ${model})`);
  }
  // PUBLIC *viewer* so every embedded user can select/use the agent, but NOT edit
  // the shared company compliance rules. Editing is reserved for the designated
  // owner (OUTERSCORE_COMPLIANCE_OWNER_EMAIL) below — and, longer term, gated by an
  // Outerscore right (WP-I `AI_AGENT_MANAGE`). This matches the access model
  // documented in librechat.test.yaml.
  await grantPermission({
    principalType: PrincipalType.PUBLIC,
    principalId: null,
    resourceType: ResourceType.AGENT,
    resourceId: agent._id,
    accessRoleId: AccessRoleIds.AGENT_VIEWER,
    grantedBy: SYSTEM_AUTHOR_ID,
  });
  // Grant the designated owner EDIT so they can tune the rules in the builder.
  await grantOwnerEmailEditor(agent);
};

/**
 * Seed all compliance agents at startup (called from server/index.js after
 * seedDatabase, under runAsSystem). Best-effort per agent — a failure is logged
 * and never blocks server boot.
 */
const seedComplianceAgents = async () => {
  for (const spec of Object.values(COMPLIANCE_SPECS)) {
    try {
      await seedOne(spec);
    } catch (err) {
      logger.error(`[outerscore] failed to seed compliance agent ${spec.id}:`, err.message);
    }
  }
};

module.exports = { seedComplianceAgents, COMPLIANCE_SPECS };
