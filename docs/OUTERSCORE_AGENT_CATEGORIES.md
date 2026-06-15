# Outerscore — Agent Categories

How the agent-builder / marketplace **categories** work in this fork, and how to change them.

## Where the list comes from

Categories are **database-backed**, not a static enum. The flow:

```
Agent builder dropdown / marketplace tabs
  → useAgentCategories()  (client/src/hooks/Agents/useAgentCategories.tsx)
  → useGetAgentCategoriesQuery → GET /agents/categories
  → controllers/agents/v1.js  getAgentCategories()
  → db.getCategoriesWithCounts()  (reads the `agentcategories` Mongo collection)
```

The `agentcategories` collection is **seeded on startup** by `ensureDefaultCategories()` in:

```
packages/data-schemas/src/methods/agentCategory.ts
```

called from `seedDatabase()` in `api/models/index.js`.

Labels shown in the UI are **i18n keys** (`com_agents_category_*`) resolved client-side from
`client/src/locales/{en,de}/translation.json`. The DB stores the key in the `label` field; the
client translates it.

> Note: `packages/data-schemas/src/methods/categories.ts` (idea / travel / code / finance …)
> is the **prompt** category list and is unrelated to agents.

## Current categories (Outerscore VMS)

| Order | `value` | EN label | DE label |
|-------|---------|----------|----------|
| 0 | `general` | General | Allgemein |
| 1 | `user` | User | Benutzer |
| 2 | `compliance` | Compliance | Compliance |
| 3 | `reporting` | Reporting | Berichtswesen |
| 4 | `supplier` | Supplier | Lieferant |
| 5 | `workforce` | Workforce | Personal |
| 6 | `requisition` | Requisition | Anforderung |
| 7 | `rfx` | RFx | RFx |
| 8 | `work_order_contracts` | Work Order & Contracts | Arbeitsauftrag & Verträge |
| 9 | `timesheets_invoicing` | Timesheets & Invoicing | Zeiterfassung & Rechnungsstellung |

The `value` is what gets stored on each agent's `category` field (a free-form `String` in the
agent schema — there is no enum validation to keep in sync). `order` controls the display order
of the tabs/dropdown.

## How to change the list

1. **Edit the seed array** `defaultCategories` in
   `packages/data-schemas/src/methods/agentCategory.ts`. Set `value`, `label` (a
   `com_agents_category_*` key), `description` (a `*_description` key), and `order`.
2. **Add the i18n keys** in both `client/src/locales/en/translation.json` and
   `client/src/locales/de/translation.json` (`com_agents_category_<value>` and
   `com_agents_category_<value>_description`). Keep the file alphabetically sorted.
3. **Rebuild `@librechat/data-schemas`** — the API consumes it from `dist/`
   (`main: dist/index.cjs`), so source edits don't take effect until rebuilt:
   ```bash
   npm run build --workspace=packages/data-schemas
   ```
4. **Restart the API.** `ensureDefaultCategories()` runs on boot and reconciles the collection.

### Reconciliation behaviour (important)

`ensureDefaultCategories()` is idempotent and now reconciles in three ways:

- **Create** — a default not in the DB is inserted (`isActive: true`, `custom: false`).
- **Re-localize** — an existing non-custom category whose `label` isn't a `com_*` key is
  updated to the localized label/description.
- **Deactivate stale** — a previously-seeded **non-custom** category that is *no longer* in the
  default array is set to `isActive: false`, so dropped defaults stop appearing in databases
  that were seeded before the change. (Added for this change — upstream only created, never
  removed.)

User-created (**`custom: true`**) categories are never touched. Deactivated categories are kept
(not deleted), so any agents still tagged with an old `value` are preserved — they just no longer
surface as a marketplace tab. To re-delete entirely, use `deleteCategory(value)`.

> Categories removed in this change from the upstream defaults: `hr`, `rd`, `finance`, `it`,
> `sales`, `aftersales`. Their translation keys are intentionally left in the locale files
> (harmless, and still referenced by any legacy agent records) — only the seed array drives what
> is active.

## Per-feature scoping — the `os_category` contract

Categories are also the bridge the **Outerscore app** uses to scope the embedded
assistant to the feature it was launched from. The host forwards the active
category as a URL param when it builds the iframe `src`:

```
{baseUrl}?os_page=…&os_category=<category value>
```

- **Ingestion** — `client/src/main.jsx` reads `os_category` on boot and stores it
  in `sessionStorage['outerscore:agent-category']` (mirrors the existing
  `os_page` handling).
- **Accessor** — `client/src/utils/outerscoreAgentCategory.ts` exposes a
  validated `getAgentCategory()` (returns `null` for unscoped / unknown values)
  plus `OUTERSCORE_AGENT_CATEGORIES`, the mirror of the seed value list.
- **Future use (not yet wired)** — pre-select the marketplace category tab /
  filter `useMarketplaceAgentsInfiniteQuery({ category })` when scoped, so a user
  who opens AI from *Suppliers* sees the *Supplier* agents first.

> The `value`s are duplicated in three synced places: the seed array (this file),
> `OUTERSCORE_AGENT_CATEGORIES` in the client util, and the `AiAgentCategory`
> enum in the Outerscore frontend library. Change one → change all three.

## Files touched

| File | Change |
|------|--------|
| `packages/data-schemas/src/methods/agentCategory.ts` | New `defaultCategories` array + stale-category deactivation |
| `client/src/locales/en/translation.json` | New `com_agents_category_*` EN keys |
| `client/src/locales/de/translation.json` | New `com_agents_category_*` DE keys |
| `client/src/main.jsx` | Reads `os_category` → sessionStorage |
| `client/src/utils/outerscoreAgentCategory.ts` | Validated `getAgentCategory()` accessor + value mirror |
