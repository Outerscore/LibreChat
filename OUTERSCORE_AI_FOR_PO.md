# Outerscore AI — what's coming, for the PO

A short page. If you only read one doc, read this one.

---

## What it is

Outerscore AI is an in-app chat that helps users draft and check job content. It lives in a left-side panel that opens next to the editor, generates text directly into the document (no copy/paste), and flags compliance issues with inline highlights.

The chat is a Claude-powered LibreChat embed; the host app (Outerscore Buyer) passes the user's current document to it and inserts back what Claude returns.

---

## Where it shows up

**Buyer side only.** Scoped to the SOW Requisition creation wizard:

- **Step 1 — General information** — small chat icon, floating over the form. Pin to dock it to the right. Clicking opens the chat with a placeholder context — *no real assistant work yet, just the surface.*
- **Step 3 — Job Posting → Project Brief** — chat icon in the Project Brief drawer. Generates the brief and checks it for compliance.
- **Step 3 — Job Posting → Deliverable description** — chat icon next to the description editor inside each Deliverable's drawer. Same behaviour, per-deliverable.

Other apps (Supplier), other pages, other labour types — out of scope for this delivery.

---

## Stages, in delivery order

Each stage is one sign-off-able outcome.

| Stage | Outcome |
|---|---|
| **S1** | Project Brief drawer in the **creation wizard** shows the AI toggle; clicking it opens the chat side panel with the current brief as context. |
| **S2** | Deliverable description editor shows an AI icon; opening it streams generated text into that deliverable's description. |
| **S3** | Step 1 shows the floating AI chip. Pin/unpin works and the choice persists. Real Step 1 wiring is a separate, later piece. |
| **S4** | The LLM always sees the latest editor content — every manual edit re-pushes the document so Claude's next reply is grounded in it. |
| **S5** | Compliance check: when Claude finishes, the side panel shows a list of flagged spans (severity-coloured), and the same spans get inline highlights in the editor. Auto-runs on stream end and after manual edits. |

S1–S4 are landed on the branch. S5 is the only remaining net-new piece.

---

## Acceptance per stage

**S1.** Open SOW Requisition → step 3 → Project Brief drawer. AI icon visible in the drawer header. Click → side panel slides in from the left with the brief content already in context. Ask "Draft a project brief…" → response streams into the right pane → click "Insert into editor" → blocks appear in the brief.

**S2.** Open a deliverable row → drawer opens → AI icon next to the description editor. Click → side panel opens with the deliverable's current description as context (including the deliverable's name in metadata so Claude can scope its reply). Streaming + insert behave the same as S1.

**S3.** On step 1 the floating chip is visible at top-right of the form. Click the pin → chip docks to the right, form reflows to make room. Reload → still pinned. Click the chip itself → side panel opens.

**S4.** Edit text in the Project Brief or a Deliverable description → the side panel's context updates immediately. The next message you send to the chat reflects the edited text (Claude never sees stale content).

**S5.** Click "Generate a deliverable description". When streaming finishes, the side panel shows a *Findings* list with severity-coloured items. The same fragments are highlighted in the editor block with the matching severity colour. Clicking a list item scrolls to the inline highlight. Editing a highlighted block clears its mark.

---

## Out of scope

Supplier app. Agent-picker UI in the chat. Storing AI sessions in the Outerscore backend. Real Step 1 content. Compliance findings that survive a page reload. These are deliberate cuts, not omissions.

---

For engineering detail (postMessage contract, file paths, compliance envelope) see **OUTERSCORE_AI_ARCHITECTURE.md**.
