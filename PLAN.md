# Outerscore AI — current plan

Three concrete use cases on `claude/epic-mccarthy-7l065` (both `outerscore/frontend` and `outerscore/librechat`). Two live, one parked.

---

## Read this first

- **[`OUTERSCORE_AI_FOR_PO.md`](OUTERSCORE_AI_FOR_PO.md)** — PO-facing. Use cases, user stories, Given/When/Then acceptance criteria, **design-changes inventory** (new UI, changes to existing UI, what's not changing, open design questions), demo script, glossary, open-questions log. Read this for the *what*, *why*, and *what the user sees*.
- **[`OUTERSCORE_AI_ARCHITECTURE.md`](OUTERSCORE_AI_ARCHITECTURE.md)** — engineer-facing. Surface map, postMessage contract, per-use-case system prompts, compliance envelope shape, apply-fix data flow, future hooks. Read this for the *how*.

---

## Use cases

```
UC1 ✅  SOW Project Brief        — generation + compliance + apply-fix
UC2 ✅  SOW Deliverable desc.    — generation + compliance + apply-fix
UC3 🅿️  Work Order compliance    — documented, not built this iteration
```

## Cross-cutting capabilities

```
Live document context  ✅  every keystroke pushed to Claude's working memory
Intent-aware canvas    ✅  chat by default; document work only on request
Live write to editor   ✅  AI streams block-by-block into EditorJS (no Insert step)
Inline highlights      ✅  severity-coloured <mark> overlays in the editor
Findings list          ✅  side-panel list mirrors the highlights
Apply-fix              ✅  one-click span replacement with Claude's suggestion
Per-use-case prompts   ✅  brief / deliverable structures are visibly different
```

## Parked (documented in detail, not built)

```
F1  Temp/contingent description AI    — prereq: convert plain text to BlockStyleEditor
F2  Work-order pre-contract audit     — advisory, role text + contract terms
```

---

## Maintaining this index

When something changes status, update the checkbox here and update the corresponding *Status* line in `OUTERSCORE_AI_FOR_PO.md`. Don't rewrite history elsewhere.
