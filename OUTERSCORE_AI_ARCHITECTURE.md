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
│                                             streaming, streamAccumulated,
│                                             findings; applyFixRequested$;
│                                             requestStop())
│
├── LibrechatSidePanelComponent              (main-app — mounted at app-root,
│                                             left-docked panel, "AI is writing…"
│                                             status + Stop, findings list)
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
| `outerscore:theme` | `{ vars }` | Push the host's live `--color-*` palette so the embedded chat matches the running app. Sent on `outerscore:ready`. The fork applies the values as inline `:root` vars over its vendored fallback. |
| `outerscore:logout` | — | Clear the in-memory token + `outerscore:canvas-content` in sessionStorage |

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
| `outerscore:compliance-result` | `{ findings }` | Findings parsed from the `<compliance>…</compliance>` envelope at stream-end |

---

## Canvas-page gating — two gates

There are **two** gates, and both must pass before a reply drives the editor canvas.

**Gate 1 — page (capability).** `sessionStorage['outerscore:page']` must be in the allow-list:

```
canvas2
sow-project-brief
sow-deliverable-description
```

Source of truth: `CANVAS_PAGES` sets in `client/src/hooks/Messages/useSubmitMessage.ts`, `client/src/hooks/SSE/useSSE.ts`, `client/src/components/Chat/Messages/Content/CanvasStatus.tsx`. Add new pages in all three places.

**Gate 2 — intent (per turn).** Being on a canvas page does **not** mean every reply is document work. The chat is a normal assistant by default; a reply only goes to the canvas when the model decides the user asked for document work and wraps its output in `<document>…</document>`.

- The system prompt (`buildSpecPrompt`) tells the model: *write/rewrite/update the document → reply is `<document>…</document>` + `<compliance>…` and nothing else; otherwise reply as normal chat with no tags.*
- `useSSE.ts` detects intent per turn via `detectCanvasIntent(text)` → `'pending' | 'yes' | 'no'`, decided as soon as the streamed prefix can confirm/exclude a leading `<document>` tag.
  - `'yes'` → stream **only the document body** (`extractDocBody`) into the canvas, parse the trailing `<compliance>` envelope, then replace the chat bubble with the "✍️ Content written to canvas." placeholder.
  - `'no'` / unresolved `'pending'` → do nothing canvas-related; the reply stays in the chat thread as an ordinary message.

Net effect: ask "what's a fair day rate?" on the Project Brief page and you get a normal chat answer; ask "draft the brief" and the document streams **live into the editor** (see next section).

---

## Live streaming into EditorJS (no "Insert" step)

EditorJS is block-JSON, not an HTML sink — you cannot pipe HTML/markdown into it. So "live writing" is done at **block granularity**, not character-by-character.

`BlockStyleEditorComponent` exposes three methods (additive, alongside `appendBlocks`):

- `beginStream(replace = true)` — canvas mode passes `replace`: seeds the reconciliation cursor with the editor's current block ids (so the existing doc morphs into the new one in place — no clear/flash). `replace = false` appends after existing content.
- `streamBlocks(blocks)` — reconciles the streamed region to the given block list: updates the in-progress tail block via `editor.blocks.update(id, data)`, inserts newly completed blocks, deletes any that reflowed away. Runs outside Angular's zone; cheap no-op when a block's serialized data is unchanged.
- `endStream()` — flushes `onChangeHandler()` once so the new content persists into the value model + history, and clears the cursor.

Driver: the drawers (`BlockStyleEditorDrawerComponent`, `DeliverableDrawerComponent`) hold an `effect()` on `AiAssistantPanelService.streaming` + `streamAccumulated`. On the rising edge → `beginStream`; per chunk → markdown→html→`getBlocks`→`streamBlocks` (throttled ~80ms); on the falling edge → final flush + `endStream`. The side panel only shows an "AI is writing…" status + **Stop** (`requestStop()` flips `streaming` off; further chunks are ignored, content frozen; revert via editor undo).

Feedback-loop guard: during streaming the editor's `onChange` does not fire (streamBlocks runs outside the zone), so the live `outerscore:canvas-context` push-back happens only once at `endStream` with the final document — the AI never re-ingests its own half-written output.

EditorJS version: **2.30.8** (full `blocks.update/insert/delete` API).

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

## Compliance envelope (S5)

Compliance findings ride **in-band** with the canvas reply — no separate round-trip. `buildCanvasPrompt` (`client/src/hooks/Messages/useSubmitMessage.ts`) instructs Claude to append a tagged JSON envelope at the end of every canvas-mode response:

```
<compliance>{"findings":[{"text":"<verbatim span from the document>","severity":"HIGH|MODERATE|LOW","reason":"..."}]}</compliance>
```

An empty findings array is required when there is nothing to flag, so the envelope is always present and the host can rely on it.

`useSSE.ts → parseComplianceEnvelope` strips the envelope from the stream-end accumulated text **before** posting `outerscore:stream-end`, then posts a separate `outerscore:compliance-result` with the parsed findings. The host's markdown preview and editor therefore never see the raw JSON. Malformed envelopes are tolerated — the original text passes through with no findings.

Frontend rendering:
- `AiAssistantPanelService.findings = signal<ComplianceFinding[]>([])` — set on receipt, cleared on `open()` / `close()`.
- `AiComplianceFindingsComponent` (lib, standalone) renders the severity-coloured list inside `LibrechatSidePanelComponent` below the markdown preview. Hidden when there are no findings.
- `ComplianceHighlightDirective` (lib, standalone, selector `[osComplianceHighlight]`) wraps `text` matches with `<mark class="os-compliance-mark os-compliance-mark--{severity}">` on the editor's host element. Marks are stripped before the next findings emission so they never persist into saved content. Applied to both the Project Brief editor (in `BlockStyleEditorDrawerComponent`) and the Deliverable description editor.
- `ComplianceFinding` model lives in `outerscore-components-lib/src/lib/models/ai-compliance.model.ts`, reusing the existing `ComplianceRisk` enum.
- Global mark styling lives in `outerscore-components-lib/src/lib/styles/_ai-compliance-mark.scss`, loaded via the lib styles entry so EditorJS's unencapsulated DOM picks it up.

---

## Per-use-case system prompts

`client/src/hooks/Messages/useSubmitMessage.ts` exports one prompt builder per canvas page, keyed by the iframe's `outerscore:page` sessionStorage value:

```ts
type CanvasPrompt = (userText: string, document: string) => string;

const PROMPT_BY_PAGE: Record<string, CanvasPrompt> = {
  'sow-project-brief': PROJECT_BRIEF_PROMPT,
  'sow-deliverable-description': DELIVERABLE_DESC_PROMPT,
  // 'wo-temp-compliance':         WO_COMPLIANCE_PROMPT,     // F2 — unused slot
  // 'wo-contractor-compliance':   WO_COMPLIANCE_PROMPT,     // F2 — unused slot
};
```

Every prompt template satisfies four clauses:

1. **Identity** — tells Claude what the document *is* (so a Deliverable description generation doesn't return a whole brief, and vice versa).
2. **Structure** — lists the expected sections. Brief: *Objectives* / *Scope* / *Success criteria* / *Out of scope*. Deliverable: *What* / *Acceptance criteria* / *Dependencies* / *Estimated effort*.
3. **Output discipline** — Markdown only, no preamble, no code fences.
4. **Compliance clause** — appends the `<compliance>{…}</compliance>` envelope with use-case-specific rules (brief → GDPR / vendor-neutrality / discriminatory wording; deliverable → vague acceptance criteria / "TBD" placeholders / missing units / unrealistic timelines). Each finding may carry a `suggestion` when a concrete rewrite is sensible.

Fallback for unrecognised pages: `GENERIC_CANVAS_PROMPT` (the pre-S7 generic builder), so Step 1's placeholder canvas page (`sow-general-info`) still works.

## Compliance envelope (revised)

```
<compliance>{
  "findings": [
    {
      "text": "<verbatim span from the document>",
      "severity": "HIGH|MODERATE|LOW",
      "reason": "<short explanation>",
      "suggestion": "<optional — concrete replacement text>"
    }
  ]
}</compliance>
```

- `suggestion` is **optional**. Claude is instructed to include it only when a single, document-ready replacement is the right fix; if the right fix is "delete this" or "rewrite the whole paragraph", suggestion is omitted.
- `useSSE.ts → parseComplianceEnvelope` accepts envelopes with or without `suggestion`.
- The host model `ComplianceFinding` (`outerscore-components-lib/src/lib/models/ai-compliance.model.ts`) carries `suggestion?: string`.

### Apply-fix data flow

1. `AiComplianceFindingsComponent` renders an **Apply fix** button on each finding where `suggestion` is set.
2. Click → `AiAssistantPanelService.applyFix(finding)` → emits via `applyFixRequested$` Subject.
3. The active drawer (`BlockStyleEditorDrawerComponent` for UC1, `DeliverableDrawerComponent` for UC2) subscribes to `applyFixRequested$` for the lifetime of the drawer. Handler:
   - Find the matching `<mark class="os-compliance-mark">` in the editor's host element and swap its text node for the suggestion.
   - If no matching `<mark>` is present (e.g. the user edited the surrounding text), fall back to a string `replace(finding.text, finding.suggestion)` on the editor's value.
   - Re-emit `valueChange` so the EditorJS block model picks up the change.
4. `AiAssistantPanelService.findings.update(f => f.filter(item => item !== finding))` removes the applied finding from both the list and the highlight overlay.

## Future hooks

The architecture deliberately leaves bolt-on points for the parked work:

### F1 — Temp/contingent description AI

Prereqs:
1. Convert `TEW.description` and `IndContractor.description` from `string` fields rendered as form textareas (in `service-specification-temp-work.component` and `service-specification-ind-contractor.component`) to `BlockStyleEditor` inside a `BlockStyleEditorDrawerComponent`-style flow.
2. Pass `enableAiAssistant: true` with the appropriate `aiContext.page` (`temp-work-description`, `contractor-description`).
3. Add matching `PROMPT_BY_PAGE` entries plus `CANVAS_PAGES` allow-list entries in `useSubmitMessage.ts`, `useSSE.ts`, `CanvasStatus.tsx`.

### F2 — Work-order compliance audit (UC3)

Entry points:
- `OrderViewComponent.generateContract()` (SOW)
- `OrderViewTempWorkPanelComponent.generateContract()` (temp work, multi-candidate)
- The contractor equivalent on `OrderViewContractorPanelComponent`

Subject: the requisition role description **plus** the contract form fields (rate, dates, capacity, working-time, contract template fields).

Behaviour: advisory. Open a pre-contract step that hosts the existing `AiComplianceFindingsComponent` + apply-fix where applicable. *Apply fix* is offered only for findings that target the role description text — contract-term findings render a recommendation but no fix button (the user edits the form field manually).

When this is built, factor the pre-contract gate into a shared helper rather than duplicating it across the two/three panel components.

---

## Theming / re-skin

The fork is re-skinned to the Outerscore design system — **colours and fonts only, no layout change**. LibreChat's components and structure are untouched.

- **Palette source = the host app, not Figma.** `LibrechatIframeComponent.postTheme()` reads the host's computed `--color-*` values (`getComputedStyle(document.documentElement)`) and posts them via `outerscore:theme` on `outerscore:ready`. The fork's `main.jsx` applies them as inline `:root` vars. So the chat always matches whatever palette the host runs — today the blue `--color-brand-*` in `frontend → global-styles/_variables.scss`; after any future palette change it follows automatically. Do **not** hardcode Figma hex.
- **Fallback** (`client/src/style/outerscore-tokens.css`): a vendored copy of the current `--color-*` values, used pre-handshake and for standalone (non-embedded) runs. Keep it in sync with `_variables.scss` if the host palette is re-baselined.
- **Remap** (`client/src/style/outerscore.css`): maps LibreChat's own semantic vars (`--text-*`, `--surface-*`, `--header-*`, `--border-*`, `--brand-purple`, `--surface-submit*`, `--ring-primary`) onto `--color-*`. No hex literals.
- **Font**: Roboto, to match the host. Set in three places — `index.html` (Google Fonts link), `tailwind.config.cjs` (`font-sans`), and a `body` rule in `outerscore.css`.
- **Namespace note**: this branch predates the `--os-*` Cosmic token system, so everything uses `--color-*`. If/when the host migrates to `--os-*`, update `THEME_TOKENS` (host) + the remap targets here.
- **Theme pinned to light when embedded**: deterministically forces `localStorage['color-theme'] = 'light'` and strips the `.dark` class on `<html>` so the embedded chat always renders against the Outerscore host palette, regardless of the user's prior preference or system colour scheme. Done in two places:
  - `client/index.html` inline script — writes `color-theme=light` **before** `@librechat/client`'s `ThemeContext` initializes (no flash of dark);
  - `client/src/main.jsx` — belt-and-suspenders strip of `.dark` after React boots, in case anything re-adds it.
- **Theme switch hidden when embedded**: LibreChat's light/dark `ThemeSelector` (Settings → General) is hidden under `isOuterscoreContext()` so a user can't flip a theme that would fight the host re-skin. Standalone LibreChat keeps it.

## Token handling

The Outerscore JWT lives **only in memory** inside the iframe — never in
`sessionStorage` or `localStorage`. Three properties hold:

1. **Delivery is origin-pinned.** The parent posts the handshake to the
   captured `event.origin` from `outerscore:ready`, never `'*'`.
2. **Persistence is delegated to the parent.** On every iframe boot the
   parent re-sends the handshake; on token refresh in the host, the
   `accessToken` effect in `LibrechatIframeComponent` posts a fresh
   handshake. The iframe never needs to survive a reload with the token
   in hand.
3. **Storage is a single module-scope variable** in
   `client/src/utils/outerscoreToken.ts` (`getOuterscoreToken /
   setOuterscoreToken / clearOuterscoreToken`). `main.jsx` calls
   `setOuterscoreToken` when the handshake arrives; `useOuterscoreAutoLogin`
   reads via `getOuterscoreToken` and clears on bridge failure or logout.

Why this matters: a JS-readable store (sessionStorage, localStorage,
IndexedDB) gives any same-origin script free access to the credential —
LibreChat is a large third-party app with a real XSS surface, so the
memory-only approach shrinks the exfiltration window to "live tab,
script already running" instead of "any future code on this origin".

`canvas-content` and the `os_page` route key remain in `sessionStorage`
— they are confidential business data but not credentials, and per-tab
scoping plus `outerscore:logout` cleanup is the right trade-off.

Future hardening (when the same-origin reverse-proxy deploy in the
roadmap lands): authenticate the chat with a first-party `HttpOnly`
cookie and drop the bearer-in-JS path entirely.

## Things to keep in mind

- The iframe is on a separate origin; token never travels in the URL — only `postMessage` after `outerscore:ready` (security hardening from `c91bcfac`), and never to JS-readable storage (the in-memory holder above).
- The deliverable drawer's `insertRequested$` and `applyFixRequested$` subscriptions are scoped to the drawer's `DestroyRef`; opening a deliverable while a Project Brief drawer is also open will cross-talk unless those subscriptions are per-instance.
- `<compliance>` envelopes can clash with content that legitimately contains the tag. The parser is tag-pair specific and tolerates failure.
- The duplex `outerscore:canvas-context` re-post on every edit is debounced upstream (the editor itself debounces value emissions) — no extra throttling needed on the host side, but keep it in mind if you ever hook a high-frequency source.
- Apply-fix relies on `<mark>` overlays being present, which depends on the editor having rendered the findings since they arrived. The fallback to `value.replace` keeps it correct when the DOM is stale, but a no-op should be logged so it's visible in the console.
