# Auto Mode — How content is routed to EditorJS vs. Chat

How the Deliverable / ProjectBrief drawer decides whether AI-generated content
is written into the EditorJS canvas or shown in the chat thread.

## Short answer

In **Auto mode** the system does **not** decide upfront — it lets **the model
decide per message**, and the model signals its decision with a `<document>`
tag. If the reply is wrapped in `<document>…</document>`, it is streamed into
the EditorJS canvas; otherwise the reply stays in the chat thread.

This is the **"intent"** routing strategy. The three-button toggle on the drawer
(`client/src/components/Chat/Input/CanvasModeToggle.tsx`) maps to it like this:

| Toggle      | Internal routing      | Who decides editor-vs-chat                          |
|-------------|-----------------------|-----------------------------------------------------|
| **Auto**    | `intent` (default)    | The **model**, per message, via `<document>` tag    |
| **Chat**    | `chat`                | Always chat — canvas never touched                  |
| **Document**| `document` → `always` | Every reply goes to the editor                      |

> Note: "Auto" can also fall back to `always` instead of `intent` if the env var
> `VITE_OUTERSCORE_CANVAS_ROUTING=always` is set (intended for weak/local models
> like Ollama that can't reliably emit tags). By default it's `intent`.

## How the decision actually flows

Two gates must pass before anything reaches the editor
(`client/src/utils/canvas.ts`, `client/src/hooks/SSE/canvasStream.ts`):

### Gate 1 — Page capability

The drawer must be running embedded as an iframe on a canvas page.
`CANVAS_PAGES = {'canvas2', 'sow-project-brief', 'sow-deliverable-description'}`
(`canvas.ts:7`). The host posts which page it is, stored in sessionStorage. If
you're not on one of these pages, the canvas bridge is never even wired up.

### Gate 2 — Per-turn intent (this is the Auto-mode logic)

1. **Before the request**, `buildCanvasSystemPrompt()` (`canvas.ts:209`) injects
   a hidden system prompt into `promptPrefix`. In Auto/`intent` mode, that prompt
   (`canvas.ts:146-164`) instructs the model:
   - **DOCUMENT WORK** — if the user asks to *write, draft, rewrite, update,
     edit, fix, improve, translate, shorten, expand…* the artifact, OR asks for
     content to be put "in the canvas/document/editor" → reply with the
     **complete document wrapped in `<document>…</document>` and nothing else**.
   - **Otherwise** (a question, advice, brainstorming) → reply normally in plain
     Markdown, **no tags** → stays in chat.

   The prompt also injects the **current editor content** as context and a
   page-specific structure spec:
   - Project Brief: `## Objectives, ## Scope, ## Success criteria, ## Out of scope`
   - Deliverable: `## What, ## Acceptance criteria, ## Dependencies, ## Estimated effort`

2. **During streaming**, `forwardCanvasStream()` (`canvasStream.ts:146`) watches
   the reply. `detectCanvasIntent()` (`canvas.ts:285`) returns `'yes'` the moment
   `<document>` appears *anywhere* in the text (preambles tolerated). Until then
   intent stays `'pending'` and **nothing is posted to the canvas** — so a plain
   chat answer never leaks into the editor mid-stream.

3. Once intent is `'yes'`, only the body *inside* `<document>…</document>` is
   extracted (`extractDocBody`) and streamed block-by-block to the host editor
   via `postMessage`.

4. **On stream end** (`finalize()`, `canvasStream.ts:187`): if it was a document
   reply, the final body is sent (`stream-end`), the chat bubble is **replaced
   with a placeholder** (`✍️ Content written to canvas.`), and `canvas-complete`
   fires. If it was chat-only, the bubble is left untouched in the thread.

## Where the prompt reaches the model

`useChatFunctions.ts:329-342` appends the canvas system prompt to
`conversation.promptPrefix`. For the agents endpoint, the server
(`api/server/controllers/agents/client.js:510-549`) attaches it only to the
**primary** agent's run context (not sub-agents), so a selected compliance agent
isn't polluted with these rules.

## A separate path: compliance agents

If a dedicated agent (e.g. a compliance agent) is selected in the picker,
`agentActive` is true and the prompt builder (`canvas.ts:116`) injects **only the
document content** (not the editor/chat rules). That agent instead emits a
`<compliance>{…}</compliance>` envelope, which `finalize()` routes to the
findings panel (`canvasStream.ts:217-234`) rather than the editor.

## Key files

| File | Purpose |
|------|---------|
| `client/src/utils/canvas.ts` | Core routing logic, system prompt building, intent detection, envelope parsing |
| `client/src/hooks/SSE/canvasStream.ts` | Forwards AI output to the editor via `postMessage`; finalizes document/compliance replies |
| `client/src/components/Chat/Input/CanvasModeToggle.tsx` | User-facing Auto/Chat/Document toggle |
| `client/src/hooks/Chat/useChatFunctions.ts` | Injects canvas system prompt into the request `promptPrefix` |
| `api/server/controllers/agents/client.js` | Server-side: attaches canvas context to the primary agent only |
| `packages/api/src/agents/compliance.ts` | Compliance agent specs + `<compliance>` envelope protocol |
| `docs/OUTERSCORE_AI_ARCHITECTURE.md` | Full architecture reference |
