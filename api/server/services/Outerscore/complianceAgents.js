const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { ResourceType, PrincipalType, AccessRoleIds } = require('librechat-data-provider');
const { COMPLIANCE_SPECS, DEFAULT_COMPLIANCE_MODEL } = require('@librechat/api');
const { getAgent, createAgent, findUser } = require('~/models');
const { grantPermission } = require('~/server/services/PermissionService');

/**
 * Auto-seeded compliance agents (WP-H). The prompt/rule content and seed specs
 * live in `@librechat/api` (packages/api/src/agents/compliance.ts); this module
 * is the thin server wrapper that seeds them into MongoDB at startup and shares
 * them PUBLIC so they appear in every user's agent picker — the compliance
 * feature is triggered by SELECTING the agent (or by an AUDIT-intent prompt in
 * regular mode), with no button and no per-deployment provisioning. Seeding is
 * **create-if-absent only** — a restart never overwrites a live builder edit.
 */

/** Fixed author for seeded agents (no real user exists at boot). PUBLIC viewer
 *  grant — not the author — is what makes them selectable by everyone. */
const SYSTEM_AUTHOR_ID = new mongoose.Types.ObjectId('000000000000000000000001');

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
