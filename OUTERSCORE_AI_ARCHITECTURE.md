# Outerscore AI — architecture (engineer)

Companion to `OUTERSCORE_AI_FOR_PO.md`. Skim this when changing wiring.

---

## Surface map

```
Outerscore Buyer (Angular, port 4200)
├── BlockStyleEditorDrawerComponent          (lib, Project Brief drawer)
├── DeliverableDrawerComponent               (lib, per-deliverable editor)
├── JobAddGeneralComponent                   (main-app, Step 1 launcher chip)
│
├── AiAssistantPanelService                  (lib — signals: isOpen, context,
│                                             streamAccumulated, activeBriefContent;
│                                             insertRequested$ Subject)
│
├── LibrechatSidePanelComponent              (main-app — mounted at app-root,
│                                             left-docked panel, marked preview,
│                                             "Insert into editor" button)
│       │
│       └── LibrechatIframeComponent         (main-app — owns the iframe,
│                                             postMessage bridge, strict-origin
│                                             handshake, stream-* outputs)
│                                                  │
└── LibrechatContextService                        │  iframe URL + os_* params
                                                   ▼
                                        LibreChat fork (React, separate origin)
                                        ├── main.jsx        (boot handshake,
                                        │                    sessionStorage writer)
                                        ├── useOuterscoreAutoLogin (SSO bridge)
                                        ├── useSubmitMessage       (buildCanvasPrompt)
                                        └── useSSE                  (postToCanvas:
                                                                     stream messages
                                                                     to parent)
                                                   │
                                                   ▼
                                                Claude
```

### Key files

| Concern | Path |
|---|---|
| Side panel + markdown preview | `outerscore/frontend → projects/main-app/src/app/modules/feature/librechat/side-panel/librechat-side-panel.component.ts` |
| Iframe wrapper + postMessage bridge | `outerscore/frontend → .../librechat/components/librechat-iframe/librechat-iframe.component.ts` |
| Floating launcher widget (non-editor pages) | `outerscore/frontend → .../librechat/widget/librechat-widget.component.ts` |
| Shared assistant state | `outerscore/frontend → projects/outerscore-components-lib/src/lib/services/ai-assistant-panel.service.ts` |
| `AiIframeContext` shape | `outerscore/frontend → .../outerscore-components-lib/src/lib/injectors/ai-iframe.injector.ts` |
| Project Brief drawer (AI-aware) | `outerscore/frontend → .../outerscore-components-lib/src/lib/components/block-style-editor-drawer/block-style-editor-drawer.component.ts` |
| Deliverable drawer (AI-aware) | `outerscore/frontend → .../outerscore-components-lib/src/lib/base-components/deliverable-drawer/deliverable-drawer.component.ts` |
| Step 1 launcher chip | `outerscore/frontend → .../main-app/.../jobs-add/job-add-general/job-add-general.component.{ts,html,scss}` |
| Markdown → EditorJS blocks | `outerscore/frontend → .../outerscore-components-lib/src/lib/services/editorjs-converter.service.ts` |
| Boot handshake + sessionStorage | `outerscore/librechat → client/src/main.jsx` |
| Canvas system prompt | `outerscore/librechat → client/src/hooks/Messages/useSubmitMessage.ts` |
| Stream broadcaster | `outerscore/librechat → client/src/hooks/SSE/useSSE.ts` |
| Post-generate broadcaster | `outerscore/librechat → client/src/components/Chat/Messages/Content/CanvasStatus.tsx` |

---

## postMessage contract

All messages are `{ type: 'outerscore:...', ... }`. Origins are strictly checked — the iframe origin is captured from the first `outerscore:ready` message; subsequent posts use that origin, not `'*'`.

### Parent → iframe

| Type | Payload | Purpose |
|---|---|---|
| `outerscore:handshake` | `{ token, context }` | SSO bridge — exchange Outerscore JWT for LibreChat session |
| `outerscore:canvas-context` | `{ content }` | Push the latest editor plain-text. Re-posted on **every** edit so Claude's next reply sees the fresh document. |
| `outerscore:logout` | — | Clear `outerscore:token` + `outerscore:canvas-content` in sessionStorage |
| `outerscore:request-compliance` | — | *(S5, planned)* Ask the fork to re-run a compliance pass against the current `canvas-content` |

### iframe → parent

| Type | Payload | Purpose |
|---|---|---|
| `outerscore:ready` | — | Boot complete; parent captures `event.origin` for subsequent handshakes |
| `outerscore:auth-required` | — | Token rejected or missing — parent resends handshake |
| `outerscore:auth-success` | — | Login bridged |
| `outerscore:stream-start` | — | LLM started streaming |
| `outerscore:stream-chunk` | `{ accumulated, chunk }` | Markdown so far + delta |
| `outerscore:stream-end` | `{ accumulated }` | Streaming complete |
| `outerscore:canvas-complete` | — | Final canvas state written (post-stream housekeeping) |
| `outerscore:content` | `{ html }` | Completed document (switch between regenerated siblings) |
| `outerscore:navigate` | `{ page, resourceId }` | AI asked to navigate the host (handler is informational today) |
| `outerscore:compliance-result` | `{ findings }` | *(S5, planned)* Findings parsed from the `<compliance>…</compliance>` envelope |

---

## Canvas-page gating

The fork only applies the document-aware system prompt and only broadcasts `stream-*` messages when `sessionStorage['outerscore:page']` is in the allow-list:

```
canvas2
sow-project-brief
sow-deliverable-description
```

Source of truth: `CANVAS_PAGES` sets in `client/src/hooks/Messages/useSubmitMessage.ts`, `client/src/hooks/SSE/useSSE.ts`, `client/src/components/Chat/Messages/Content/CanvasStatus.tsx`. Add new pages in all three places.

---

## `AiIframeContext` (what the host stamps)

```ts
interface AiIframeContext {
  page?: string;                      // routed to os_page query param + sessionStorage
  resourceId?: string;                // os_resource_id
  metadata?: Record<string, string>;  // os_<key> per entry
}
```

Current call sites stamp:

| Site | `page` | `metadata` |
|---|---|---|
| `os-service-specification-sow` (view-mode Project Brief) | `sow-project-brief` | `field`, `laborType` |
| `service-specification-sow` (creation-wizard Project Brief) | `sow-project-brief` | `field`, `laborType`, `flow=requisition-create`, `step=job-posting` |
| `deliverable-drawer` (description) | `sow-deliverable-description` | `field`, `deliverableId`, `deliverableLabel`, `laborType`, `flow=requisition-create` |
| Step 1 launcher | `sow-general-info` | `field=general-info`, `laborType`, `flow=requisition-create`, `step=general-information`, `mode=placeholder` |

`mode=placeholder` is the signal the fork can use to respond with a generic greeting instead of trying to draft content from an empty context.

---

## Compliance envelope (S5, planned)

When the host posts `outerscore:request-compliance`, the fork's submit hook prepends a system instruction telling Claude to reply with **only** a tagged JSON envelope:

```
<compliance>{"findings":[{"text":"<verbatim span from the document>","severity":"HIGH|MODERATE|LOW","reason":"..."}, ...]}</compliance>
```

`useSSE.ts` parses on `stream-end`. If a well-formed envelope is found, it posts `outerscore:compliance-result` to the parent and **suppresses** the regular `stream-chunk` markdown for that turn so the chat thread doesn't fill up with raw JSON. Parse failure falls back to "no findings, regular reply".

Frontend rendering:
- `AiAssistantPanelService.findings = signal<ComplianceFinding[]>([])` — set on receipt, cleared on next `open()` / `close()`.
- New `ai-compliance-findings.component.ts` in the lib renders the severity-coloured list inside `LibrechatSidePanelComponent` below the markdown preview.
- A new helper on `BlockStyleEditorComponent` (or sibling directive) wraps `text` matches with `<mark class="os-compliance-mark os-compliance-mark--{severity}">`. Removed on next stream or on user edit of the block (so marks never persist into saved content).
- `ComplianceFinding` model lives in `outerscore-components-lib/src/lib/models/ai-compliance.model.ts`, reusing the existing `ComplianceRisk` enum.

---

## Things to keep in mind

- The iframe is on a separate origin; token never travels in the URL — only `postMessage` after `outerscore:ready` (security hardening from `c91bcfac`).
- The deliverable drawer's `insertRequested$` subscription is scoped to the drawer's `DestroyRef`; opening a deliverable while a Project Brief drawer is also open will cross-talk unless those subscriptions are per-instance.
- `<compliance>` envelopes can clash with content that legitimately contains the tag. The parser is tag-pair specific and tolerates failure.
- The duplex `outerscore:canvas-context` re-post on every edit is debounced upstream (the editor itself debounces value emissions) — no extra throttling needed on the host side, but keep it in mind if you ever hook a high-frequency source.
