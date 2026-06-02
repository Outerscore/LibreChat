# Outerscore AI — current plan

The work on this branch (`claude/epic-mccarthy-7l065`, both `outerscore/frontend` and `outerscore/librechat`) wires a Claude-powered LibreChat embed into the **Buyer SOW Requisition creation wizard** — Step 1 (visual stub) and Step 3 (Project Brief + per-Deliverable description, with streaming, live document context, and compliance highlighting).

---

## Read this first

- **`OUTERSCORE_AI_FOR_PO.md`** — PO-facing: where the AI shows up, what each stage delivers, acceptance per stage. Read this if you want the *what* and the *why*.
- **`OUTERSCORE_AI_ARCHITECTURE.md`** — engineer-facing: surface map, postMessage contract, file paths, canvas-page gating, compliance envelope shape. Read this if you want the *how*.

---

## Current stage

```
S1 ✅  Project Brief drawer in the creation wizard — AI toggle wired
S2 ✅  Deliverable description editor — inline AI toggle + duplex context
S3 ✅  Step 1 floating AI launcher (visual stub, pin/unpin persisted)
S4 ✅  Canvas-page gating extended so SOW pages get the document-aware prompt + stream
S5 ⏳  Compliance check (envelope + side-panel list + inline highlights)
```

Stages land as separate commits on the same branch in both repos. Per the PO doc, S1–S4 are sign-off-able now; S5 is the remaining work.
