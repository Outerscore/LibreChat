# Outerscore AI — what we're building, why, and how we'll know it works

> Audience: product, sales, account management, QA, other PMs.
> Read this end-to-end in under 10 minutes.

## 1. The pitch

Buyers in Outerscore spend real time writing job content — Project Briefs,
Deliverable descriptions, work-order role specs — and then re-checking that
what they wrote complies with their procurement, GDPR and labour rules. Both
jobs are error-prone and tedious.

Outerscore AI puts a Claude-powered chat next to those text fields. It can
**draft** content from a one-line instruction, **refine** content the user
has already written, and **flag** non-compliant fragments inline, with a
one-click "Apply fix" that lets Claude correct the text in place.

The integration runs as an embedded chat panel that opens on the left side
of whichever editor the user is in. The chat already knows what document
the user is working on (the panel keeps Claude's view of the document in
sync as the user edits), so the user types instructions, not context.

## 2. Who uses this

| Persona | What they do today | What changes with AI |
|---|---|---|
| **Buyer (Requisitioner)** | Hand-writes briefs and deliverable descriptions during requisition creation; copies templates from a shared drive. | Asks AI to draft, refines via chat, accepts compliance fixes. |
| **Buyer (Order owner)** *(future)* | Reviews the role spec + contract terms before signing off contract generation for a temp/contingent worker. | Gets a pre-contract advisory check that flags risky terms or wording. |
| **Procurement / Legal** *(indirect)* | Catches non-compliant wording in review, often after the fact. | Most non-compliant wording is corrected during authoring. |

## 3. Where it shows up — three use cases

Two are live on the branch today; the third is documented and parked for a
later iteration.

### UC1 — Draft and refine a SOW Project Brief

**Where:** SOW Requisition wizard → Step 3 *Job Posting* → *Project Brief* drawer.

**User story**
> **As a** Buyer creating a SOW requisition
> **I want to** ask Outerscore AI to draft, refine and compliance-check the Project Brief
> **so that** I produce a complete, compliant brief in one sitting instead of pasting templates and second-guessing.

**Acceptance criteria**

| # | Given | When | Then |
|---|---|---|---|
| UC1-A | I'm in the Project Brief drawer of a SOW requisition I'm creating or editing | I click the AI sparkle icon next to the drawer's title | The Outerscore AI panel slides in on the left of the screen with the brief's current content already loaded as context |
| UC1-B | The AI panel is open and the brief is empty | I type "Draft a project brief for a 6-month migration project to AWS" and send | The brief is written **live, block by block, directly into the Project Brief editor** — proper headings/lists/paragraphs (not raw markdown), structured as Objectives / Scope / Success criteria / Out of scope. No "Insert" step. |
| UC1-C | The AI is writing into the editor | I click "Stop" (or press Ctrl+Z afterwards) | Writing halts at the current point / the AI's write is undone. The content is in the editor as soon as it streams — there is no separate confirm/insert action. |
| UC1-D | I have an existing brief and ask "Tighten the success criteria" | The AI responds | The reply rewrites the *whole* brief with sharper success criteria — not a chat-style answer |
| UC1-E | The brief contains a discriminatory or non-compliant fragment | The AI finishes the reply | A compliance findings list appears under the preview with a severity badge per finding, and the same fragments are highlighted inline in the editor with a matching colour |
| UC1-F | A finding shows an "Apply fix" button | I click it | The highlighted fragment in the editor is replaced by Claude's suggested correction, the highlight disappears, and the finding drops off the list |
| UC1-G | I edit the brief manually after a generation | I send another message to the AI | The AI's reply takes my edits into account (it never works from stale content) |
| UC1-H | I'm viewing the brief in read-only mode (e.g. requisition is already approved) | I open the drawer | The AI sparkle icon is hidden — AI is only available in edit mode |

**Status: Live ✅**

### UC2 — Draft and refine a SOW Deliverable description

**Where:** SOW Requisition wizard → Step 3 *Job Posting* → *Deliverables* table → row click → Deliverable drawer → *Description* field.

**User story**
> **As a** Buyer defining the deliverables of a SOW requisition
> **I want to** ask Outerscore AI to draft and refine each deliverable's description, with compliance checking
> **so that** every deliverable has clear, testable acceptance criteria without me writing them from scratch.

**Acceptance criteria**

| # | Given | When | Then |
|---|---|---|---|
| UC2-A | I have opened a Deliverable for editing in the Deliverable drawer | I click the AI sparkle icon next to the description editor | The Outerscore AI panel opens with that deliverable's description loaded as context, plus the deliverable's name/label so the AI's reply is scoped to this one item |
| UC2-B | I ask "Draft the description for this deliverable" | The AI responds | The description is written **live, directly into the deliverable's description editor**, structured as *What*, *Acceptance criteria*, *Dependencies*, *Estimated effort* — not a project-brief structure. No "Insert" step; Stop/undo to revert. |
| UC2-C | I open a second Deliverable while the panel is open | The panel updates | The AI's context is reloaded for the newly opened deliverable; replies are scoped to it; the previous deliverable's drafts do not leak |
| UC2-D | The drafted description contains a vague acceptance criterion ("works well") | The AI finishes | The finding appears with a severity, a quoted snippet, and (where possible) a suggested replacement |
| UC2-E | I click "Apply fix" on a deliverable finding | — | The highlighted span is replaced in place; the editor's saved value reflects the corrected text on next save |
| UC2-F | I close the Deliverable drawer | — | The AI panel closes with it; the next deliverable starts with a clean panel state |

**Status: Live ✅**

### UC3 — Pre-contract compliance audit for temp/contingent (Future)

**Where:** Work Order view → Generate Contract → before the contract drawer opens.

**User story**
> **As a** Buyer about to generate a contract for a temp or contingent worker
> **I want to** see an AI compliance audit of the role description and the contract terms
> **so that** I catch risky terms, working-time problems, discriminatory wording or rate inconsistencies *before* signing.

**Subject of the check:** the role description carried from the originating
Requisition **plus** the contract form fields (rate, dates, capacity,
working-time).

**Behaviour:** advisory. The audit runs when the user clicks *Generate
contract*; findings show in a dedicated step; the user can acknowledge and
proceed even with HIGH findings (the demo deliberately does not hard-block).

**Acceptance criteria (provisional, to be confirmed before build)**

| # | Given | When | Then |
|---|---|---|---|
| UC3-A | I'm on a Work Order for a temp or contingent worker, with the order in a state that allows contract generation | I click *Generate contract* | A compliance step shows before the contract drawer; the panel lists findings against the role description and contract terms |
| UC3-B | A finding flags the role description text | — | "Apply fix" is offered; the description in the underlying requisition (or its on-order copy) gets the suggestion applied |
| UC3-C | A finding flags a contract term (rate / dates / capacity / working-time) | — | The finding is shown with a recommendation; *Apply fix* is **not** offered (the user fixes the form field themselves) |
| UC3-D | I acknowledge the findings | — | The contract drawer opens, prefilled as today; the contract proceeds to generation |

**Status: Future 🅿️ — documented, not built this iteration.**

## 4. The cross-cutting magic — compliance + apply-fix

These two capabilities live underneath UC1 and UC2 today (and will
underpin UC3 later). They are the part of the system that lets the AI
feel like a teammate rather than a chat window.

### Live document context

The AI panel always sees the **current** editor content. Every keystroke
in the editor is pushed to Claude's working memory in the background, so
when the user asks "Tighten the success criteria" Claude is working off
what's in the editor now — not what it was when the panel opened. This is
invisible to the user; it shows up as "the AI never feels stale."

### Inline compliance highlights

When Claude returns text (a draft or a refinement), the response carries a
hidden structured envelope listing any non-compliant fragments. The host
parses it and:

- shows the findings in a list under the chat preview, severity-coloured
  (HIGH / MODERATE / LOW), with the quoted text and a short reason;
- wraps the same fragments inline in the editor with a `<mark>` styled to
  match severity. Hover shows the reason.

The list and the highlights are linked: clicking a finding focuses the
matching highlight; editing the editor strips the mark on the next
compliance pass.

### Apply-fix

Where Claude can suggest a concrete replacement (and only there), each
finding offers an **Apply fix** button. One click replaces the flagged span
with Claude's correction in place. The list item and the inline mark both
disappear; the user keeps editing.

Where the right fix is "delete this" or "rewrite from scratch", no
suggestion is offered and the user uses the chat for that.

### Chat vs. canvas — the assistant knows the difference

Sitting next to an editor does **not** turn every message into a document
edit. The assistant stays a normal chat by default: ask it "what's a fair
day rate for this role?" or "is this scope realistic?" and you get a plain
answer in the chat. Only when you ask it to **write, rewrite, update,
translate, shorten or expand the document** does it switch into canvas mode
— and then the content is written **live, straight into the editor**, block
by block, as it streams. There is no "Insert into editor" step. The user
never flips a switch; the assistant decides from what you asked. To revert,
press **Stop** while it writes, or **Ctrl+Z** afterwards.

## 5. Design changes — what the user actually sees

This section enumerates every visible UI change. Where a Figma frame
exists, it's linked; everything else was built using existing Outerscore
patterns (Cosmic palette, `ComplianceRisk` colours, the existing drawer
chrome) and is marked **design review pending**.

### 5.1 New UI elements

| # | Element | Where it appears | Visual reference | Status |
|---|---|---|---|---|
| D1 | **AI launcher chip** (sparkle icon + "Outerscore AI" label) | Step 1 *General Information* — floats over the form by default; click the pin icon to dock it on the right of the step container (reserves a 280px gutter; state persists in localStorage) | [Figma frame](https://www.figma.com/design/eASH9pfpus2hoPzKo8Jlm0/Buyer---Outerscore-2025?node-id=21704-19497) | Built to Figma |
| D2 | **AI sparkle button** (`auto_awesome` icon, becomes brand-coloured when the panel is open) | Header of the Project Brief drawer + header strip next to the Deliverable description editor (`isEditMode` only) | None — uses existing `mat-icon-button` + brand-token colour | Design review pending |
| D3 | **AI side panel** (left-docked, drag-resizable, 25% width default, 15–45% clamp; header with sparkle + "AI Assistant" + close) | Mounted at app-root; opens on D2 click, slides in from the left, pushes page content via flexbox split | None — same layout pattern as `/librechat/canvas2` POC | Design review pending |
| D4 | **"AI is writing into the editor…" status bar** with a **Stop** button | Top of the side panel while AI is streaming into the editor (replaces the old preview pane) | None | Design review pending |
| D5 | **Compliance findings list** (severity-coloured cards: HIGH = red border, MODERATE = amber, LOW = green; quoted text + reason + optional suggestion + *Apply fix* button) | Below the status bar, inside the side panel | None — reuses `ComplianceRisk` palette (matches `ComplianceResultItemComponent` elsewhere in the app) | Design review pending |
| D6 | **Inline compliance highlights** (`<mark>` with severity-coloured underline + tinted background; hover shows the reason) | Wraps non-compliant fragments inside the EditorJS editor body | None — colours pulled from `--os-state-error-fg / -warning-fg / -success-fg` | Design review pending |

### 5.2 Changes to existing UI

| # | Where | What changes |
|---|---|---|
| C1 | Project Brief drawer header | New AI sparkle button (D2) appears next to the title in edit mode. Comments + history controls unchanged. |
| C2 | Deliverable drawer — description editor header | New AI sparkle button (D2) appears next to the description's actions row. Other actions (comments, history) unchanged. |
| C3 | SOW Requisition Step 1 (`job-add-general`) | `.step-container` becomes positioning-relative + reserves a 280px right gutter while pinned. Page content reflows; no other field changes. |
| C4 | Side-panel "Insert into editor" / "Discard" preview pane | **Removed.** AI content writes live into the editor; revert is via Stop / Ctrl+Z. |

### 5.3 What is **not** changing (deliberate)

- LibreChat's chat surface inside the iframe — unchanged.
- The EditorJS toolbar, block styles, and existing markdown rendering — unchanged. Compliance highlights are layered on top, not a fork of the editor.
- Step 2 and other wizard steps — no AI surface this iteration.
- View-mode (read-only) screens — the AI sparkle button is hidden.

### 5.4 Open design questions

| Date | Question | Owner |
|---|---|---|
| (TBC) | Are there Figma frames I should align D2–D6 to, or do we want a design review pass on what's shipped? | Design |
| (TBC) | Should the side panel be re-positionable to the right of the editor as well as the left? Today it's left-docked only. | Design + PO |
| (TBC) | Severity colour mapping for inline highlights — keep current `ComplianceRisk` palette or a softer AI-specific palette? | Design |

## 6. What we deliberately do *not* do (yet)

| Item | Why we parked it |
|---|---|
| AI in temp/contingent step-3 description fields | Their description fields are plain text today. We need to migrate them to the BlockStyleEditor first; that's a separate piece of work. |
| UC3 (work-order compliance audit) | Higher-impact than UC1/UC2 but requires the broader system-prompt work to be settled first. Documented in detail; build follows after UC1/UC2 are validated in production. |
| Supplier app | This whole AI scope is Buyer-only for now. |
| Storing AI sessions in the Outerscore backend | The demo uses LibreChat's own storage. Outerscore-side persistence is a separate ticket. |
| Hard-blocking on HIGH compliance findings | Demo experience favours speed; once usage data exists we'll revisit. |

## 7. How to demo this in 5 minutes

1. **Open the SOW Requisition wizard.** Navigate to Requisitions → New →
   choose *SOW* labour type → walk through to step 3 *Job Posting*.
2. **UC1 — Project Brief.** Click *Edit* on the Project Brief panel to open
   its drawer. Click the AI sparkle icon. Side panel slides in. Ask *"Draft
   a brief for a 6-month migration of our finance ERP to a SaaS platform,
   including one ambiguous deadline."* Watch the brief write itself **live
   into the editor**, block by block (no Insert step). Point at the compliance
   finding ("ambiguous deadline"). Click *Apply fix*. Show that the editor
   text changed and the finding cleared.
3. **UC2 — Deliverable description.** Add a deliverable in the deliverables
   table. Open it. Click the AI icon next to the description editor. Ask
   *"Draft the description, focusing on acceptance criteria."* Show the
   deliverable-shaped output (What / Acceptance criteria / Dependencies /
   Estimated effort). Repeat the apply-fix demo on any finding.
4. **Live context.** Edit the description manually mid-demo. Send "Now make
   the acceptance criteria more measurable." Show that the AI's reply
   respects what you just typed.
5. **Future glimpse.** Open this doc to UC3 and read the 4-row table aloud
   as a roadmap teaser.

## 8. Glossary

- **Project Brief** — the rich-text description of a SOW requisition's overall objective.
- **Deliverable description** — the rich-text definition of one line item in a SOW deliverables table.
- **Compliance finding** — a non-compliant fragment Claude has flagged, with severity (HIGH / MODERATE / LOW) and reason.
- **Apply fix** — one-click replacement of a flagged fragment with Claude's suggested correction.
- **Canvas mode** — internal name for "the AI knows it's working *on* a document, not chatting freely." Switched on automatically by the page the user is on.

## 9. Open questions / decisions log

| Date | Question | Decision |
|---|---|---|
| (TBC) | Should UC3 hard-block contract generation on HIGH findings? | Advisory in the demo, revisit later. |
| (TBC) | Should temp/contingent description fields be migrated to BlockStyleEditor in this scope? | No — parked. |
| (TBC) | Should AI sessions persist in the Outerscore backend? | No for the demo. Separate ticket. |
| (TBC) | Where does the iframe keep the Outerscore access token? | **In memory only.** The parent re-sends it on every iframe boot and on token refresh, so the iframe never needs sessionStorage/localStorage. Cuts the XSS exfiltration window to "live tab, script already running" and applies to the demo as well as production. Long-term goal is to drop bearer-in-JS entirely once the same-origin reverse-proxy deploy lands (first-party `HttpOnly` cookie). |
| (TBC) | Is canvas mode always on when next to an editor? | **No — intent-driven.** The assistant replies as a normal chat unless the user asks it to write/update the document, in which case it wraps output in a `<document>` marker that the host streams into the canvas. Detected from the request, no user toggle. |
| (TBC) | Keep the "Insert into editor" confirmation step? | **No — removed.** AI content is written live, block by block, directly into the editor as it streams. Revert via Stop (mid-stream) or Ctrl+Z (after). Decided with PO. |

---

> **Maintenance rules**
> - Each use case section is self-contained. Adding or removing one does not break the others.
> - Acceptance criteria use Given/When/Then so QA can lift them straight into their test plan.
> - The status flag (Live ✅ / Future 🅿️) is the only thing that should change as work progresses; the body of each use case stays.
> - Open-questions log lives at the bottom so decisions don't get lost. Add a dated row when something changes — don't rewrite history.
