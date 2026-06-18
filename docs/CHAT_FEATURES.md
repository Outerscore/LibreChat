# LibreChat Chat Features: Temporary Chat, Multi-Conversation & Presets

This document explains three chat-related features in LibreChat, their behavior, implementation, and configuration.

---

## Table of Contents

1. [Temporary Chat](#1-temporary-chat)
2. [Multi-Conversation (multiConvo)](#2-multi-conversation-multiconvo)
3. [Presets](#3-presets)

---

## 1. Temporary Chat

### What it is

An **ephemeral conversation that auto-deletes after a retention period** — similar to an "incognito" chat. Useful for one-off questions you don't want cluttering history or persisting long-term.

### Behavior

- Toggle it **on before sending the first message** in an empty chat, using the dashed message-circle icon. The input box turns **violet** to indicate temporary mode.
- The conversation is assigned an `expiredAt` timestamp and is **hidden from the conversation list**.
- A MongoDB **TTL index** automatically purges the conversation once it expires. Default retention is **720 hours (30 days)**.
- Temporary chats **skip automatic title generation** on the backend.
- A user preference (`defaultTemporaryChat`) can make all new chats default to temporary.

### Retention modes

- `RetentionMode.TEMPORARY` (default) — only chats flagged `isTemporary` get an expiration date.
- `RetentionMode.ALL` — every chat receives an expiration date based on the retention policy.

### Backend implementation

| Concern | File | Notes |
|---|---|---|
| Conversation schema | `packages/data-schemas/src/schema/convo.ts` | `isTemporary: Boolean`, `expiredAt: Date`; TTL index on `expiredAt`; compound index `(user, isTemporary, expiredAt)` |
| Message schema | `packages/data-schemas/src/types/message.ts` | `isTemporary?: boolean`, `expiredAt?: Date \| null` |
| Expiration logic | `packages/data-schemas/src/utils/tempChatRetention.ts` | `getTempChatRetentionHours()`, `createTempChatExpirationDate()` (bounds 1–8760h, default 720) |
| Save conversation | `packages/data-schemas/src/methods/conversation.ts` | `saveConvo()` sets/clears `expiredAt` based on `isTemporary` + retention mode |
| Visibility filter | `packages/data-schemas/src/utils/retention.ts` | `buildRetentionVisibilityFilter()` excludes `isTemporary: true` from lists |
| Request context | `api/app/clients/BaseClient.js` | `isTemporary` read from `req.body` and passed to `saveMessage()` |

### Frontend implementation

| Concern | File |
|---|---|
| State (Recoil + localStorage) | `client/src/store/temporary.ts` — `isTemporary`, `defaultTemporaryChat` atoms |
| Toggle button | `client/src/components/Chat/TemporaryChat.tsx` — only shown on empty chats; `MessageCircleDashed` icon |
| Route integration | `client/src/routes/ChatRoute.tsx` — applies preference to new chats / detects existing temporary chats |
| Utility | `client/src/utils/conversation.ts` — `isTemporaryConversation()` |
| Form styling | `client/src/components/Chat/Input/ChatForm.tsx` — violet styling when temporary |
| Request payload | `client/src/hooks/Chat/useChatFunctions.ts` — includes `isTemporary` in submissions |

### Configuration (`librechat.yaml` → `interface`)

```yaml
interface:
  temporaryChat: true               # show/hide the temporary toggle
  temporaryChatRetention: 720       # hours, range 1–8760 (default 720 = 30 days)
  retentionMode: "temporary"        # "temporary" (default) | "all"
  retainAgentFiles: false           # agent file expiration policy when retentionMode: "all"
```

- Env var `TEMP_CHAT_RETENTION_HOURS` overrides the retention default (checked first).
- Schema: `packages/data-provider/src/config.ts` (interface block).

---

## 2. Multi-Conversation (multiConvo)

### What it is

Lets you **send one message to two agents/models simultaneously and compare their responses side-by-side**, within the same chat.

### Behavior

- Click the **"+" (Add multi-conversation)** button in the chat input. It clones the current conversation into a second "added" conversation, where you can pick a different model/agent.
- You type one message; it routes to **both agents in parallel**, and both responses render in the same chat.
- Both responses share the same `parentMessageId`; the secondary response is tagged with an `addedConvo: true` flag so the frontend can separate them.
- Works with **agent endpoints**; **disabled for assistants endpoints**.

### Frontend implementation

| Concern | File |
|---|---|
| State | Recoil `conversationByIndex` atomFamily — `index 0` = primary, `index 1` = added (`ADDED_INDEX`) |
| Add button | `client/src/components/Chat/AddMultiConvo.tsx` — clones primary convo into index 1 |
| Added convo display | `client/src/components/Chat/Input/AddedConvo.tsx` — shows model/agent + close (X) |
| Textarea header | `client/src/components/Chat/Input/TextareaHeader.tsx` — renders AddedConvo above textarea |
| State hook | `client/src/hooks/Chat/useAddedResponse.ts` |
| Context | `client/src/Providers/AddedChatContext.tsx` |
| Submit | `client/src/hooks/Messages/useSubmitMessage.ts` → `ask(text, { addedConvo })` |
| Request building | `client/src/hooks/Chat/useChatFunctions.ts` — includes `addedConvo` in `endpointOption` |

### Backend implementation

| Concern | File | Notes |
|---|---|---|
| Parallel agent init | `api/server/services/Endpoints/agents/addedConvo.js` | `processAddedConvo()` builds a second agent config |
| Entry point | `api/server/services/Endpoints/agents/initialize.js` | Adds secondary agent to `agentConfigs` Map (`ADDED_AGENT_ID = '__added_agent__'`) |
| Response routing | `api/server/controllers/agents/client.js` | `createMultiAgentMapper()` with `mapCondition: msg => msg.addedConvo === true` |
| Permission check | `api/server/middleware/accessResources/canAccessAgentFromBody.js` | `checkAddedConvoAccess()` validates `MULTI_CONVO` permission |
| Message flag | `packages/data-schemas/src/types/message.ts` | `addedConvo` boolean |

**How it runs in parallel:** the second agent is added to the LangGraph run with no incoming edges, making it an independent start node that executes concurrently with the primary agent.

### Configuration & permissions

```yaml
interface:
  multiConvo: true                  # feature flag (default true)
```

- Permission: role-based `MULTI_CONVO: { use: boolean }` — `packages/data-provider/src/permissions.ts`.
- Config schema: `packages/data-provider/src/config.ts` (`multiConvo`).

---

## 3. Presets

### What it is

**Presets are saved, reusable conversation configurations** — templates that bundle an endpoint, model, and parameters (temperature, system prompt, tools, etc.) so you can quickly reapply a setup to a new conversation. They contain configuration only, **not messages**.

### Behavior

- **Save** the current conversation settings as a preset (via "Save as Preset" dialog).
- **Select/load** a preset to start a new conversation with those settings.
- **Set a default preset** to auto-apply on new conversations.
- **Edit, delete, export (JSON), and import** presets.
- Unavailable tools are automatically **filtered out** based on the current system configuration.

### Typical fields stored in a preset

`endpoint`, `model`, `temperature`, `top_p`, `topK`, `maxTokens`/`maxOutputTokens`, `promptPrefix` (system prompt), `system`, `title`, `presetId`, `defaultPreset`, `order`, `tools`, `agent_id`, `assistant_id`, `promptCache`/`thinking`/`thinkingBudget` (Anthropic), `file_ids`/`resendFiles`/`imageDetail`, `greeting`, `iconURL`.

### Presets vs Conversations vs Agents

- **Preset** — reusable configuration template (no messages).
- **Conversation** — holds messages; may carry an optional `presetOverride` to override params.
- **Agent** — endpoint-specific; its `agent_id` can be stored within a preset.

### Backend implementation

| Concern | File | Notes |
|---|---|---|
| Schema | `packages/data-schemas/src/schema/preset.ts` | `IPreset`; extends `conversationPreset` defaults; unique index on `presetId` + `tenantId` |
| Model | `packages/data-schemas/src/models/preset.ts` | Mongoose model with tenant isolation |
| CRUD methods | `packages/data-schemas/src/methods/preset.ts` | `getPreset()`, `getPresets()` (sorted by `order` then `updatedAt`), `savePreset()` (upsert + default-preset logic), `deletePresets()` |
| Routes | `api/server/routes/presets.js` | `GET /api/presets`, `POST /api/presets` (create/update, auto-UUID), `POST /api/presets/delete` — all JWT-authenticated |

### Frontend implementation

| Concern | File |
|---|---|
| Data service | `packages/data-provider/src/data-service.ts` — `getPresets`, `createPreset`, `updatePreset`, `deletePreset` |
| Query hook | `client/src/data-provider/queries.ts` — `useGetPresetsQuery()` |
| Mutations | `client/src/data-provider/mutations.ts` — `useUpdatePresetMutation()`, `useDeletePresetMutation()` |
| State | `client/src/store/preset.ts` — `defaultPreset`, `presetModalVisible` atoms; `presetByIndex` selector |
| Core hook | `client/src/hooks/Conversations/usePresets.ts` — `onSelectPreset`, `onChangePreset`, `submitPreset`, `onSetDefaultPreset`, `exportPreset`, `importPreset` |
| Edit options hook | `client/src/hooks/Conversations/usePresetIndexOptions.ts` |
| Menu | `client/src/components/Chat/Menus/PresetsMenu.tsx` (BookCopy icon) |
| Preset items | `client/src/components/Chat/Menus/Presets/PresetItems.tsx` |
| Edit dialog | `client/src/components/Chat/Menus/Presets/EditPresetDialog.tsx` |
| Save dialog | `client/src/components/Endpoints/SaveAsPresetDialog.tsx` |
| Utils | `client/src/utils/presets.ts` (`getPresetTitle`, `removeUnavailableTools`), `client/src/utils/cleanupPreset.ts` (`cleanupPreset`) |

### Lifecycle highlights

- **Create:** "Save as Preset" → `createPreset` → `POST /api/presets` (backend auto-generates `presetId` UUID) → presets query invalidated.
- **Use:** select in `PresetsMenu` → `onSelectPreset()` runs endpoint-switching logic → `newConversation({ preset })` → unavailable tools filtered.
- **Default:** pin / "Set as Default" → `updatePreset({ defaultPreset: true })`; backend unsets the previous default and sets `order = 0`. On startup, the default preset auto-applies to new conversations.
- **Export/Import:** `exportPreset()` downloads cleaned JSON; `importPreset()` uploads JSON → `cleanupPreset()` normalizes → create.

### Configuration & permissions

```yaml
interface:
  presets: true                     # show/hide the presets menu
```

- The presets menu renders only when `interface.presets === true` **and** `modelSelect` is enabled (`client/src/components/Chat/Header.tsx`).
- Interface defaults: `packages/data-schemas/src/app/interface.ts` (presets can default off when `modelSpecs` are prioritized).
- Startup validation warns on conflicts between `modelSpecs.prioritize`/`modelSpecs.enforce` and presets: `packages/api/src/app/checks.ts`.

---

## Feature Comparison at a Glance

| Feature | Purpose | Key flag | Persistence |
|---|---|---|---|
| **Temporary Chat** | Privacy / auto-expiring conversation | `interface.temporaryChat` | Auto-deleted via TTL (`expiredAt`) |
| **Multi-Conversation** | Compare two models/agents in parallel | `interface.multiConvo` | Normal conversation; second response flagged `addedConvo` |
| **Presets** | Save & reuse conversation configurations | `interface.presets` | Persisted as standalone preset documents |

These are independent features: Temporary Chat governs conversation lifetime, Multi-Conversation governs parallel responses, and Presets govern reusable configuration.
