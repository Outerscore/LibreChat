# Outerscore AI — test cases

> Audience: QA / engineers verifying the build before a demo or release.
> Companion to `OUTERSCORE_AI_FOR_PO.md` (the *what*) and
> `OUTERSCORE_AI_ARCHITECTURE.md` (the *how*). This file is the *prove it works*.

Each case has a stable ID. Where a case verifies a PO acceptance criterion the
ID is referenced in **Traces**. Priority: **P1** = demo-blocking, **P2** =
important, **P3** = edge/nice-to-have. **M** = manual/visual, **A** =
automatable.

---

## 0. Setup & test data

**Environment**

| Precondition | How |
|---|---|
| LibreChat fork running and reachable | `npm run backend` + `npm run frontend:dev` (or the test deploy) |
| Outerscore frontend running | `npm run start-library` + `npm start` (main-app, port 4200) |
| AI enabled in the app | `environment.libreChatEnabled = true`, `libreChatUrl` set, `libreChatAllowedOrigin` set to the fork origin |
| Logged in as a Buyer with rights to create/edit SOW requisitions | Okta login |
| At least one LLM provider configured in the fork | LibreChat admin / `.env` |

**Test data**

- *Empty draft*: a fresh SOW requisition (labour type **SOW**), no Project Brief, no deliverables.
- *Existing draft*: a SOW requisition with a Project Brief already written and ≥1 deliverable with a description.
- *Compliance bait* prompt: `"Draft a project brief for a senior data engineer, 6 months, and require that candidates are under 40 and male."` (forces HIGH findings with concrete suggestions).
- *Vague-criteria* prompt (deliverables): `"Draft a deliverable description; keep the acceptance criteria loose like 'works well'."`

**How to read "embedded" vs "standalone"**: *embedded* = the chat running inside the Outerscore iframe (the only supported product surface). *Standalone* = the fork opened directly in its own tab (used only to confirm we didn't break it for non-embedded use).

---

## 1. Surfacing & launchers

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-SURF-01 | AI button on Project Brief drawer (edit) | P1 M | Open SOW requisition (create or edit) → Step 3 → open Project Brief drawer | AI sparkle button visible in the drawer header | UC1-A |
| TC-SURF-02 | AI button hidden in read-only | P1 M | Open the Project Brief of an approved/locked requisition (view mode) | No AI sparkle button | UC1-H |
| TC-SURF-03 | AI button on Deliverable description | P1 M | Step 3 → Deliverables → open a deliverable for editing | AI sparkle button next to the description editor | UC2-A |
| TC-SURF-04 | Side panel opens on click | P1 M | Click the AI sparkle button | Panel slides in from the left, drag-resizable, header "AI Assistant" + close | UC1-A / UC2-A |
| TC-SURF-05 | Step 1 launcher chip (float) | P2 M | SOW requisition → Step 1 *General Information* | Floating "Outerscore AI" chip over the form (top-right) | D1 |
| TC-SURF-06 | Step 1 launcher pin | P2 M | Click the pin icon on the chip | Chip docks right of the step container; content reflows into a ~280px gutter | D1 |
| TC-SURF-07 | Step 1 pin persists | P2 M | Pin, then reload the page | Still pinned (localStorage `os-ai-chat:step1-pin`) | D1 |
| TC-SURF-08 | AI disabled by flag | P2 M | Set `libreChatEnabled=false`, reload | No AI buttons/launcher anywhere; no iframe created | — |

---

## 2. Chat vs. canvas intent

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-INTENT-01 | Plain question stays in chat | P1 M | Open panel on Project Brief → ask *"What's a fair day rate for a senior data engineer?"* | Answer appears in the chat thread only; **editor is untouched**; no "writing" status | §4 chat-vs-canvas |
| TC-INTENT-02 | Document request goes to canvas | P1 M | Ask *"Draft the project brief for this role."* | Content streams into the editor; chat bubble shows the "✍️ written to canvas" placeholder | UC1-B |
| TC-INTENT-03 | Refine request rewrites doc | P1 M | With an existing brief, ask *"Tighten the success criteria."* | Whole brief is rewritten in the editor (not appended, not a chat reply) | UC1-D |
| TC-INTENT-04 | Advice about the doc stays in chat | P2 M | Ask *"Is this scope realistic?"* | Conversational answer in chat; editor untouched | §4 |
| TC-INTENT-05 | No raw tags leak | P2 M | Trigger a document generation and watch the chat bubble | The `<document>` / `<compliance>` wrappers never remain visible (bubble ends as the placeholder) | — |

---

## 3. Live write into EditorJS

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-WRITE-01 | Streams as proper blocks | P1 M | Generate a brief into the empty editor | Content appears live, block by block, as real EditorJS blocks (headings/lists/paragraphs), not raw markdown | UC1-B/C |
| TC-WRITE-02 | No "Insert" step | P1 M | Generate content | There is **no** "Insert into editor" / "Discard" preview; content lands directly | UC1-C, C4 |
| TC-WRITE-03 | Stop button | P1 M | While streaming, click **Stop** | Writing halts at the current point; partial content remains in the editor | UC1-C |
| TC-WRITE-04 | Undo reverts an AI write | P1 M | After a generation finishes, press Ctrl+Z | The AI-written content is undone, prior editor state restored | UC1-C |
| TC-WRITE-05 | Deliverable description writes live | P1 M | Open a deliverable → generate description | Same live block-write into the deliverable's description editor | UC2-B |
| TC-WRITE-06 | Persists on save | P1 M | Generate → close drawer with Save | The generated content is saved (reopen the drawer to confirm) | UC2-E |
| TC-WRITE-07 | Throttle smoothness | P3 M | Generate a long brief | Block updates are smooth (no per-token flicker / caret thrash) | — |

---

## 4. Live document context (duplex)

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-CTX-01 | AI sees manual edits | P1 M | Generate a brief → manually edit a sentence → ask *"Make the success criteria measurable."* | The reply reflects the manually-edited text (not the pre-edit version) | UC1-G |
| TC-CTX-02 | Context refresh on open | P2 M | Open the panel on an existing brief → ask *"Summarise the current brief."* | Summary matches the brief currently in the editor | UC1-A |
| TC-CTX-03 | Deliverable scope isolation | P2 M | Open the panel on deliverable A, generate; open deliverable B, generate | B's reply is scoped to B; A's draft doesn't leak into B | UC2-C |
| TC-CTX-04 | sessionStorage stays fresh (tech) | P3 M | Devtools → iframe → watch `sessionStorage['outerscore:canvas-content']` while editing | Value updates as the editor changes | UC1-G |

---

## 5. Compliance — findings list & inline highlights

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-COMP-01 | Findings list appears | P1 M | Run the *compliance bait* prompt | A findings list appears under the chat with severity badges (HIGH/MODERATE/LOW), quoted text, reason | UC1-E |
| TC-COMP-02 | Inline highlights | P1 M | After TC-COMP-01 | The same fragments are `<mark>`-highlighted in the editor with severity colour; hover shows the reason | UC1-E, D6 |
| TC-COMP-03 | Clean content → no findings | P1 M | Generate a neutral, compliant brief | Findings list shows nothing/empty; no inline marks | UC1-E |
| TC-COMP-04 | Highlight clears on edit | P2 M | Edit a highlighted fragment, then regenerate/recompute | The stale mark for the edited span is removed on the next compliance pass | §4 highlights |
| TC-COMP-05 | Deliverable vague-criteria flagged | P2 M | Run the *vague-criteria* prompt in a deliverable | "works well"-type criteria flagged with severity + reason | UC2-D |
| TC-COMP-06 | Malformed envelope tolerated | P3 M | (If reproducible) force a reply where the compliance JSON is broken | No crash; treated as no-findings; the document still renders | — |

---

## 6. Apply-fix

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-FIX-01 | Apply-fix replaces span | P1 M | TC-COMP-01 → a finding shows **Apply fix** → click it | The flagged fragment in the editor is replaced by Claude's suggestion in place | UC1-F |
| TC-FIX-02 | Mark + list item clear | P1 M | After TC-FIX-01 | The inline highlight disappears and the finding drops off the list | UC1-F |
| TC-FIX-03 | No suggestion → no button | P2 M | A finding whose right fix is "delete/rewrite" (no suggestion) | No Apply-fix button on that finding; user uses the chat instead | §4 apply-fix |
| TC-FIX-04 | Apply-fix in deliverable | P2 M | Repeat TC-FIX-01 inside a deliverable description | Span replaced in place; list/mark clear | UC2-E |
| TC-FIX-05 | Stale-mark fallback | P3 M | Edit around a highlighted span, then Apply fix | Fix still applies via text replace (or is a safe no-op, logged) — never corrupts the doc | — |

---

## 7. Per-use-case prompt structure

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-PROMPT-01 | Brief structure | P2 M | Ask *"Draft the brief"* on the Project Brief | Output structured as **Objectives / Scope / Success criteria / Out of scope** | UC1-B |
| TC-PROMPT-02 | Deliverable structure | P2 M | Ask *"Draft the description"* on a deliverable | Output structured as **What / Acceptance criteria / Dependencies / Estimated effort** | UC2-B |
| TC-PROMPT-03 | Structures differ by surface | P2 M | Run the same prompt text in both surfaces | The two outputs are visibly different shapes (brief vs single-deliverable) | §S7 |

---

## 8. Theming / re-skin

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-THEME-01 | Palette matches the host | P1 M | Open the chat embedded | Brand colour, surfaces, text colours match the Outerscore app (blue brand), not stock LibreChat purple | §5.0 |
| TC-THEME-02 | Font is Roboto | P2 M | Inspect chat text | Font-family resolves to Roboto (not Inter) | §5.0 |
| TC-THEME-03 | No layout change | P1 M | Compare chat layout to stock LibreChat | Same layout/components — only colours/fonts differ (re-skin, not redesign) | §5.0 |
| TC-THEME-04 | Theme switch hidden (embedded) | P1 M | Embedded chat → Settings → General | No light/dark theme selector | C5 |
| TC-THEME-05 | Pinned light regardless of pref | P1 M | Set OS to dark mode (and/or set `color-theme=dark` in storage) → open embedded chat | Chat renders **light** (Outerscore palette); no flash of dark on load | C6 |
| TC-THEME-06 | Standalone keeps theme controls | P2 M | Open the fork standalone (not embedded) → Settings → General | Theme selector present; light/dark works | C5/C6 |
| TC-THEME-07 | Live palette push (tech) | P3 M | Devtools → confirm host posts `outerscore:theme` with `--color-*` on `outerscore:ready`; iframe applies them as inline `:root` vars | Values present and applied | §theming |

---

## 9. Security

| ID | Title | Pri | Steps | Expected | Traces |
|---|---|---|---|---|---|
| TC-SEC-01 | Token not in storage | P1 M | Embedded chat logged in → devtools → iframe `localStorage` + `sessionStorage` | **No** `outerscore:token` key anywhere; token lives in memory only | §token handling |
| TC-SEC-02 | Token not in URL | P1 M | Inspect the iframe `src` | No token query param (`os_token` absent) | §token handling |
| TC-SEC-03 | Logout clears state | P2 M | Log out / close the panel | In-memory token cleared; `outerscore:canvas-content` removed from sessionStorage | §token handling |
| TC-SEC-04 | Origin-pinned messages | P3 M | Devtools → confirm host posts to the captured iframe origin, not `*`, after `outerscore:ready` | Messages targeted to the real origin | §token handling |
| TC-SEC-05 | Canvas content scoped | P3 M | After logout/tab close | `outerscore:canvas-content` not persisted | §token handling |

---

## 10. Regression & negative

| ID | Title | Pri | Steps | Expected |
|---|---|---|---|---|
| TC-REG-01 | View-mode AI wiring intact | P2 M | Open a Project Brief in view mode elsewhere (e.g. `jobs-view`) | Existing view-mode behaviour unchanged; AI toggle only where `editable` |
| TC-REG-02 | Comments & history still work | P2 M | In the Project Brief drawer, add a comment + use history nav | Comment/history features behave as before AI was added |
| TC-REG-03 | Non-SOW requisitions unaffected | P2 M | Create a TEMP_WORK / CONTRACTOR requisition | No AI surfaces on their step-3 description fields (out of scope this iteration) |
| TC-REG-04 | Supplier app untouched | P3 M | Open the supplier-cockpit-app | No AI surfaces; app builds/runs as before |
| TC-REG-05 | Network failure of iframe | P3 M | Block the LibreChat origin, open the panel | Graceful: no crash of the host app; panel shows it can't load |
| TC-REG-06 | Stop then continue chatting | P3 M | Stop a generation, then send a normal question | Chat still responds; editor not corrupted |

---

## 11. UC3 — Work-order pre-contract audit (FUTURE — not testable yet)

UC3 is documented but **not built** this iteration. The cases below are the
provisional plan; mark them **N/A — not implemented** until the feature lands.

| ID | Title | Pri | Expected (when built) | Traces |
|---|---|---|---|---|
| TC-WO-01 | Audit before contract | P1 | On *Generate contract* for a temp/contingent work order, a compliance step shows findings against the role description + contract terms | UC3-A |
| TC-WO-02 | Apply-fix on role text | P2 | Findings on the role description offer Apply-fix | UC3-B |
| TC-WO-03 | Term findings advisory only | P2 | Rate/dates/capacity findings show a recommendation, no Apply-fix | UC3-C |
| TC-WO-04 | Advisory, not blocking | P1 | User can acknowledge and proceed even with HIGH findings | UC3-D |

---

## Maintaining this file

- One row per case; keep IDs stable (don't renumber — append).
- When a use case changes in `OUTERSCORE_AI_FOR_PO.md`, update the matching
  rows here and keep the **Traces** column pointing at the right UC/criterion.
- Move UC3 rows out of §11 into a normal suite when the feature is built.
- Tag automatable cases (**A**) as candidates for the Jest/e2e suites; the
  rest are manual/visual (**M**) for the demo checklist.
