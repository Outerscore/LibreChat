const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { COMPLIANCE_SPECS } = require('@librechat/api');
const { deleteAgent } = require('~/models');

/**
 * Outerscore compliance agents — removal (WP-H reverted 2026-06-18).
 *
 * Product decision: **no agent is defaulted — by default there is no agent at
 * all**; agents are set up from scratch and we ship no pre-seeded defaults. This
 * module used to *create* the compliance agents at startup and share them PUBLIC
 * (`seedComplianceAgents`); it now does the opposite — it **removes** any
 * previously-seeded compliance agents so existing environments self-heal on the
 * next boot and the agent picker starts empty.
 *
 * The rule specs still live in `@librechat/api`
 * (packages/api/src/agents/compliance.ts) and continue to drive the AUDIT-intent
 * prompt + `<compliance>` parsing; only the auto-created agent *records* are
 * removed here. A user who later builds their own agent (random id, real author)
 * is never touched: deletion is keyed by the deterministic seed id AND the system
 * sentinel author the seeds were created under.
 */

/** Fixed author the seeded agents were created under (see the old seedOne). */
const SYSTEM_AUTHOR_ID = new mongoose.Types.ObjectId('000000000000000000000001');

/**
 * Delete every previously auto-seeded compliance agent. Called from
 * server/index.js after seedDatabase, under runAsSystem (the Agent collection is
 * tenant-isolated; strict mode rejects unscoped writes). Best-effort per agent —
 * a failure is logged and never blocks server boot. Idempotent: once removed, the
 * find returns null and the loop is a no-op on subsequent boots.
 */
const removeSeededComplianceAgents = async () => {
  for (const spec of Object.values(COMPLIANCE_SPECS)) {
    try {
      const removed = await deleteAgent({ id: spec.id, author: SYSTEM_AUTHOR_ID });
      if (removed) {
        logger.info(`[outerscore] removed seeded compliance agent ${spec.id}`);
      }
    } catch (err) {
      logger.error(
        `[outerscore] failed to remove seeded compliance agent ${spec.id}:`,
        err.message,
      );
    }
  }
};

module.exports = { removeSeededComplianceAgents };
