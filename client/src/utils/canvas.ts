import { ContentTypes } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';

const CANVAS_CONTEXT_KEY = 'outerscore:canvas-content';
const CANVAS_PAGE_KEY = 'outerscore:page';
const CANVAS_MODE_KEY = 'outerscore:canvas-mode';
const CANVAS_PAGES = new Set(['canvas2', 'sow-project-brief', 'sow-deliverable-description']);

/**
 * User-selected canvas mode (the composer toggle on canvas pages):
 *  - 'auto'     — routing follows `VITE_OUTERSCORE_CANVAS_ROUTING` ('intent' by
 *    default: the model decides chat-vs-document per turn via `<document>`).
 *  - 'chat'     — replies always stay in the chat; the canvas is never touched.
 *  - 'document' — every reply IS the document (the 'always' behaviour), on any model.
 * Stored in sessionStorage so it survives reloads within the embedded session
 * and is shared by the prompt builder and both SSE hooks.
 */
export type CanvasMode = 'auto' | 'chat' | 'document';

/** Effective per-turn routing after folding the user mode into the env lever. */
export type CanvasRouting = 'intent' | 'always' | 'chat';

export const getCanvasMode = (): CanvasMode => {
  try {
    const value = sessionStorage.getItem(CANVAS_MODE_KEY);
    return value === 'chat' || value === 'document' ? value : 'auto';
  } catch {
    return 'auto';
  }
};

export const setCanvasMode = (mode: CanvasMode): void => {
  try {
    if (mode === 'auto') {
      sessionStorage.removeItem(CANVAS_MODE_KEY);
    } else {
      sessionStorage.setItem(CANVAS_MODE_KEY, mode);
    }
  } catch {
    // sessionStorage unavailable — mode simply stays 'auto'.
  }
};

/**
 * The single routing decision both the prompt builder and the SSE hooks consume:
 * an explicit user mode ('chat' / 'document') wins; 'auto' falls back to the
 * env lever ('always' for weak local models, 'intent' otherwise).
 */
export const resolveCanvasRouting = (): CanvasRouting => {
  const mode = getCanvasMode();
  if (mode === 'chat') {
    return 'chat';
  }
  if (mode === 'document') {
    return 'always';
  }
  return isCanvasRoutingAlways() ? 'always' : 'intent';
};

interface CanvasSpec {
  /** Human name of the artifact, e.g. "SOW Project Brief". */
  artifact: string;
  /** One sentence describing the required section structure. */
  structure: string;
  /** Compliance rules relevant to this artifact. */
  rules: string[];
}

/*
 * Regular-mode compliance is intentionally DISABLED. Auto-running compliance
 * inside a normal canvas reply was confusing and buggy: asking to "improve the
 * brief" made the model rewrite AND audit in the same turn, so the findings
 * referenced the PRE-EDIT content and the host could not match those spans
 * against the freshly-replaced editor. Compliance is now produced ONLY by the
 * explicitly-selected compliance agent (seeded server-side — see the compliance
 * module in `packages/api` and `complianceAgents.js`); the SSE audit path still
 * parses/forwards that agent's `<compliance>` envelope.
 *
 * To re-enable here, reintroduce a `complianceClause(rules)` builder and append
 * it in the 'always'/'intent' branches below, plus the document-path forwarding
 * in the canvas stream bridge. `CanvasSpec.rules` is kept for exactly that; see
 * git history for the previous inline implementation.
 */

/**
 * Intent-aware canvas system prompt. The model decides, per turn, whether the
 * user is asking for document work or just chatting:
 *  - document work  → reply is ONLY `<document>…</document>`, which the host
 *    streams into the editor canvas;
 *  - anything else  → a normal chat reply with no tags, which stays in the chat.
 *
 * Compliance is intentionally NOT part of this prompt — see the compliance note
 * above. Returned as *system* instructions so the document never appears in the
 * visible user message.
 */
const buildSpecPrompt = (
  spec: CanvasSpec,
  document: string,
  routing: CanvasRouting,
  agentActive = false,
): string => {
  const trimmed = document.trim();
  const context = [
    `You are an assistant embedded next to a ${spec.artifact} editor on the Outerscore procurement platform.`,
    trimmed
      ? `The current ${spec.artifact} content is:\n---\n${trimmed}\n---`
      : `The ${spec.artifact} is currently empty.`,
    '',
  ];

  // A dedicated agent is active (e.g. a compliance agent selected in the picker):
  // it owns its own instructions/rules, so inject ONLY the current document as
  // context — never our rules/intent/envelope, which would duplicate or fight the
  // agent's own prompt. The agent's reply (a <compliance> envelope or a document)
  // is still parsed by the SSE hooks.
  if (agentActive) {
    return [
      ...context,
      `The text above is the live ${spec.artifact} the user is working on; use it as the document to act on.`,
    ].join('\n');
  }

  // 'chat' routing: the user pinned the toggle to chat-only — answer normally,
  // never produce a document. The SSE hooks also drop any canvas forwarding in
  // this mode, so this instruction is belt-and-braces for weak models.
  if (routing === 'chat') {
    return [
      ...context,
      `Reply as a helpful assistant in plain Markdown. You may quote or refer to the ${spec.artifact} content above, but do NOT output a rewritten ${spec.artifact} and never use <document> tags — the user has chat-only mode enabled and your reply stays in the chat.`,
    ].join('\n');
  }

  // 'always' routing: the host has already decided this turn targets the
  // document, so don't ask the model to choose — just have it write the doc.
  // No <document> envelope is required, which is what lets weaker / local
  // models (Ollama) drive the canvas reliably.
  if (routing === 'always') {
    return [
      ...context,
      `Treat the user's message as an instruction to create or revise the ${spec.artifact}. Reply with the COMPLETE updated ${spec.artifact} in Markdown — no preamble, no commentary, no code fences.`,
      spec.structure,
    ].join('\n');
  }

  // 'intent' routing: the model decides per reply via the <document> envelope.
  return [
    ...context,
    `The editor next to this chat is called the "canvas" — it holds the ${spec.artifact}. When the user says canvas, document, editor, or brief, they mean it.`,
    '',
    "Decide how to respond based on the user's message:",
    '',
    '1. DOCUMENT WORK — choose this whenever the user wants to CHANGE or ADD to the content. This is the default for any instruction that modifies the document:',
    `   - they ask you to WRITE, DRAFT, REWRITE, UPDATE, EDIT, CORRECT, FIX, IMPROVE, POLISH, ADD TO, EXTEND, TRANSLATE, SHORTEN, EXPAND or otherwise change the ${spec.artifact};`,
    '   - OR they ask for ANY content to be provided/put/written IN or ON the canvas, document, or editor (e.g. "provide a job description in the canvas", "write it to the document", "add more requirements in canvas") — even when that content is not literally a revision of the current text;',
    '   - OR they ask to move, copy, duplicate or "do the same" with an earlier chat answer in the canvas.',
    '   Reply with the COMPLETE updated document and nothing before it. Begin your reply with the <document> tag:',
    '<document>',
    '...the full document in Markdown — no preamble, no commentary, no code fences...',
    '</document>',
    spec.structure,
    'The <document> block is the ENTIRE reply — output nothing else.',
    '',
    '2. Otherwise (a question, advice, brainstorming, or general chat with no instruction to change the canvas), reply normally as a helpful assistant in plain Markdown. Do NOT use <document> tags. You may refer to the document content above. If you are unsure whether the user wanted the canvas updated, answer in chat and ask.',
  ].join('\n');
};

const PROJECT_BRIEF_SPEC: CanvasSpec = {
  artifact: 'SOW Project Brief',
  structure:
    'Use these top-level sections in order: ## Objectives, ## Scope, ## Success criteria, ## Out of scope. Keep it under ~400 words.',
  rules: [
    'discriminatory or biased wording (gender, age, nationality, protected characteristics)',
    'vendor-locked or branded language where a neutral alternative exists',
    'GDPR / data-handling obligations missing when personal data is in scope',
    'ambiguous deadlines, vague scope statements, or unmeasurable success criteria',
  ],
};

const DELIVERABLE_DESC_SPEC: CanvasSpec = {
  artifact: 'SOW deliverable description',
  structure:
    'Use these top-level sections in order: ## What, ## Acceptance criteria, ## Dependencies, ## Estimated effort. Acceptance criteria must be a numbered list of objectively testable statements. Keep it under ~250 words.',
  rules: [
    'vague acceptance criteria ("works well", "as needed", "to satisfaction")',
    '"TBD" / "TBC" placeholders left unresolved',
    'missing units on durations or quantities',
    'unrealistic timelines given the listed scope',
    'discriminatory or biased wording',
  ],
};

const GENERIC_SPEC: CanvasSpec = {
  artifact: 'document',
  structure: 'Keep the structure that best fits the document.',
  rules: ['discriminatory or biased wording', 'unverifiable or non-compliant claims'],
};

const SPEC_BY_PAGE: Record<string, CanvasSpec> = {
  'sow-project-brief': PROJECT_BRIEF_SPEC,
  'sow-deliverable-description': DELIVERABLE_DESC_SPEC,
};

/**
 * Builds the canvas system prompt for the current page from the editor content
 * the host pushed via `outerscore:canvas-context` (sessionStorage). Returns ''
 * when not on a canvas page, so callers can inject it unconditionally. Injected
 * as `promptPrefix` so the document + instructions stay out of the chat thread.
 */
export const buildCanvasSystemPrompt = (agentActive = false): string => {
  let page = '';
  let canvas = '';
  try {
    page = sessionStorage.getItem(CANVAS_PAGE_KEY) ?? '';
    canvas = sessionStorage.getItem(CANVAS_CONTEXT_KEY) ?? '';
  } catch {
    return '';
  }
  if (!CANVAS_PAGES.has(page)) {
    return '';
  }
  const spec = SPEC_BY_PAGE[page] ?? GENERIC_SPEC;
  return buildSpecPrompt(spec, canvas, resolveCanvasRouting(), agentActive);
};

/* ────────────────────────────────────────────────────────────────────────────
 * Host-bound stream parsing
 *
 * A model reply is parsed per turn before it is forwarded to the editor canvas
 * in the Outerscore host. Shared by both SSE hooks (`useSSE` and the active
 * `useResumableSSE`) so intent + compliance logic lives in exactly one place.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ComplianceSeverity = 'HIGH' | 'MODERATE' | 'LOW';

export interface ComplianceFinding {
  text: string;
  severity: ComplianceSeverity;
  reason: string;
  suggestion?: string;
}

/** Messages posted to the host parent window to drive the editor canvas. */
export type CanvasStreamMessage =
  | { type: 'outerscore:stream-start' }
  | { type: 'outerscore:stream-chunk'; chunk: string; accumulated: string }
  | { type: 'outerscore:stream-end'; accumulated: string }
  | { type: 'outerscore:canvas-complete' }
  | { type: 'outerscore:compliance-result'; findings: ComplianceFinding[] };

/**
 * Per-turn canvas intent. A reply is document work as soon as `<document>`
 * appears anywhere in it — weak/local models often emit a short preamble
 * before the tag, and a strict starts-with gate silently killed their live
 * preview (chunks never streamed; the doc only landed at the final event).
 * While the tag is absent the intent stays 'pending': it may still arrive in
 * a later chunk, so only the final pass decides a reply was chat-only — a
 * pending reply posts nothing to the canvas, which keeps in-chat Q&A intact.
 * 'no' remains in the union for exhaustiveness but is no longer produced.
 */
export type CanvasIntent = 'pending' | 'yes' | 'no';

export const CANVAS_PLACEHOLDER_TEXT = '✍️ Content written to canvas.';

const SUGGESTION_MAX_LEN = 600;
const COMPLIANCE_ENVELOPE = /<compliance>([\s\S]*?)<\/compliance>/;
const DOC_OPEN = '<document>';
const DOC_CLOSE = '</document>';
/** Opening tag only (no `>`), so a partial/streaming envelope is still recognized. */
const COMPLIANCE_OPEN = '<compliance';
const SEVERITIES = new Set(['HIGH', 'MODERATE', 'LOW']);

/** True when the fork treats every canvas-page reply as the document (weak models). */
export const isCanvasRoutingAlways = (): boolean =>
  ((import.meta.env.VITE_OUTERSCORE_CANVAS_ROUTING as string) || 'intent') === 'always';

/** True when the host has placed the iframe on a canvas-capable page. */
export const isOnCanvasPage = (): boolean => {
  try {
    return CANVAS_PAGES.has(sessionStorage.getItem(CANVAS_PAGE_KEY) ?? '');
  } catch {
    return false;
  }
};

export const detectCanvasIntent = (text: string): CanvasIntent => {
  return text.includes(DOC_OPEN) ? 'yes' : 'pending';
};

/**
 * True when a reply is an "audit": it carries a `<compliance>` envelope but no
 * `<document>` body. This is what a compliance check (the compliance agent, or an
 * AUDIT-intent reply from the default model) produces — findings only, nothing to
 * write to the editor. The SSE hooks route these to the findings panel and strip
 * the envelope from the chat bubble instead of treating it as document work.
 */
export const isComplianceOnlyReply = (text: string): boolean => {
  if (!text || text.includes(DOC_OPEN)) {
    return false;
  }
  return COMPLIANCE_ENVELOPE.test(text);
};

/**
 * True when a reply is (or is becoming) a compliance-only envelope: the opening
 * `<compliance` tag is present and there is no `<document>`. Unlike
 * {@link isComplianceOnlyReply} this does NOT require the closing tag, so the
 * display layer can suppress the raw JSON while it is still streaming.
 */
export const isComplianceReplyText = (text: string): boolean =>
  !!text && !text.includes(DOC_OPEN) && text.includes(COMPLIANCE_OPEN);

/** Short bubble shown in the chat after an audit (findings live in the host panel). */
export const COMPLIANCE_SUMMARY_TEXT = 'Compliance review complete — see the results panel.';

/** Friendly bubble for a compliance reply with no findings. */
export const NO_COMPLIANCE_FINDINGS_TEXT = '✅ No compliance issues found.';

/**
 * Render a compliance-only reply as readable chat markdown. Used in a regular
 * chat (no host findings panel) so the raw `<compliance>` JSON never shows: an
 * empty result becomes a friendly "all clear", otherwise a markdown list of the
 * findings with severity, reason, the flagged span, and any suggested fix.
 */
export const formatComplianceReply = (text: string): string => {
  const { findings } = parseComplianceEnvelope(text);
  if (findings.length === 0) {
    return NO_COMPLIANCE_FINDINGS_TEXT;
  }
  const heading =
    findings.length === 1
      ? '**1 compliance issue found:**'
      : `**${findings.length} compliance issues found:**`;
  const items = findings.map((finding) => {
    let item = `- **${finding.severity}** — ${finding.reason}`;
    if (finding.text) {
      item += `\n  > ${finding.text}`;
    }
    if (finding.suggestion) {
      item += `\n  _Suggested fix:_ ${finding.suggestion}`;
    }
    return item;
  });
  return `${heading}\n\n${items.join('\n')}`;
};

/**
 * True when an assistant reply's text is document work: the in-session canvas
 * placeholder, an explicit `<document>` tag, or a `<compliance>` envelope
 * (always-mode doc replies carry no `<document>` tag but do carry the envelope).
 */
export const isDocumentReplyText = (text: string): boolean => {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  return (
    trimmed === CANVAS_PLACEHOLDER_TEXT ||
    trimmed.includes(DOC_OPEN) ||
    // Opening tag (not the full envelope) so a STREAMING audit reply is masked with
    // the generation loader immediately, instead of showing raw JSON until it closes.
    trimmed.includes(COMPLIANCE_OPEN)
  );
};

/* ── Canvas-doc message registry ─────────────────────────────────────────────
 * 'always'-mode document replies are plain markdown with no marker in the
 * stored text, so once the user switches modes nothing distinguishes a past
 * document turn from a chat answer. The hooks record the messageId of every
 * reply they actually forward to the canvas; the display layer keeps masking
 * those forever, regardless of the mode selected later. localStorage (capped)
 * so the memory survives reloads. */

const CANVAS_DOC_IDS_KEY = 'outerscore:canvas-doc-ids';
const CANVAS_DOC_IDS_MAX = 300;

let canvasDocIdsCache: string[] | null = null;

const readCanvasDocIds = (): string[] => {
  if (canvasDocIdsCache) {
    return canvasDocIdsCache;
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CANVAS_DOC_IDS_KEY) ?? '[]');
    canvasDocIdsCache = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    canvasDocIdsCache = [];
  }
  return canvasDocIdsCache;
};

/** Record that a message's reply was written to the canvas (called by the SSE hooks). */
export const markMessageAsCanvasDoc = (messageId?: string | null): void => {
  if (!messageId) {
    return;
  }
  const ids = readCanvasDocIds().filter((id) => id !== messageId);
  ids.push(messageId);
  canvasDocIdsCache = ids.slice(-CANVAS_DOC_IDS_MAX);
  try {
    localStorage.setItem(CANVAS_DOC_IDS_KEY, JSON.stringify(canvasDocIdsCache));
  } catch {
    // storage unavailable — the in-memory cache still covers this session.
  }
};

/** True when this message's reply is known to have been written to the canvas. */
export const isMessageCanvasDoc = (messageId?: string | null): boolean => {
  if (!messageId) {
    return false;
  }
  return readCanvasDocIds().includes(messageId);
};

/** Drop the canvas-doc registry — called on logout so a new session starts clean. */
export const clearCanvasDocIds = (): void => {
  canvasDocIdsCache = [];
  try {
    localStorage.removeItem(CANVAS_DOC_IDS_KEY);
  } catch {
    // storage unavailable — the in-memory reset above still applies.
  }
};

/**
 * Strip canvas envelopes (`<document>` tags + the `<compliance>` block) from a
 * reply so it reads as plain content. Used on chat-mode replies from models
 * that emit the envelopes despite the chat-only instructions (weak/local ones).
 */
export const stripCanvasEnvelopes = (text: string): string => {
  if (!text) {
    return text;
  }
  const { stripped } = parseComplianceEnvelope(text);
  return stripped.replace(DOC_OPEN, '').replace(DOC_CLOSE, '').trim();
};

/**
 * Display decision for an assistant reply on a canvas page: mask it with the
 * "written to canvas" indicator, or render it as a normal chat bubble.
 *
 *  - A registry-recorded id (a turn that genuinely drove the canvas) is masked
 *    in every mode, forever.
 *  - Deployment-level 'always' (env lever, weak local models, user mode 'auto'):
 *    every stored reply IS the document and carries no marker — mask them all.
 *  - User-selected 'document' mode: mask only the in-flight turn (`isActiveTurn`,
 *    it streams to the canvas and gets its id recorded on commit). Earlier turns
 *    are judged on their own merits — flipping the toggle to Document must NOT
 *    retroactively claim past chat answers were "written to canvas" (they weren't).
 *  - 'chat': nothing is forwarded, so a doc-shaped reply was NOT written to
 *    the canvas — never claim it was. Mask only the in-session placeholder.
 *  - 'intent': mask doc-shaped replies and recorded ids.
 */
export const shouldMaskCanvasReply = (
  text: string,
  messageId?: string | null,
  isActiveTurn = false,
): boolean => {
  if (isMessageCanvasDoc(messageId)) {
    return true;
  }
  const routing = resolveCanvasRouting();
  if (routing === 'always') {
    if (getCanvasMode() === 'auto') {
      return true;
    }
    if (isActiveTurn) {
      return true;
    }
  }
  if (routing === 'chat') {
    return text.trim() === CANVAS_PLACEHOLDER_TEXT;
  }
  return isDocumentReplyText(text);
};

/** Document body (between the tags) from a document-mode reply; envelope stripped. */
export const extractDocBody = (text: string): string => {
  const t = text.replace(/^\s+/, '');
  const openIdx = t.indexOf(DOC_OPEN);
  let body = openIdx !== -1 ? t.slice(openIdx + DOC_OPEN.length) : t;
  const closeIdx = body.indexOf(DOC_CLOSE);
  if (closeIdx !== -1) {
    body = body.slice(0, closeIdx);
  }
  const compIdx = body.indexOf(COMPLIANCE_OPEN);
  if (compIdx !== -1) {
    body = body.slice(0, compIdx);
  }
  return body.trim();
};

/** Raw, unvalidated finding shape as parsed from the model's JSON envelope. */
interface RawComplianceFinding {
  text?: unknown;
  severity?: unknown;
  reason?: unknown;
  suggestion?: unknown;
}

/**
 * Pull the `<compliance>{…}</compliance>` envelope out of a reply: returns the
 * validated findings and the text with the envelope stripped. Malformed
 * envelopes are tolerated (no findings, original text preserved).
 */
export const parseComplianceEnvelope = (
  text: string,
): { findings: ComplianceFinding[]; stripped: string } => {
  const match = text.match(COMPLIANCE_ENVELOPE);
  if (!match) {
    return { findings: [], stripped: text };
  }
  let findings: ComplianceFinding[] = [];
  try {
    const parsed = JSON.parse(match[1]) as { findings?: unknown };
    if (Array.isArray(parsed?.findings)) {
      findings = (parsed.findings as RawComplianceFinding[]).reduce<ComplianceFinding[]>(
        (acc, item) => {
          if (
            item &&
            typeof item.text === 'string' &&
            typeof item.severity === 'string' &&
            typeof item.reason === 'string' &&
            SEVERITIES.has(item.severity.toUpperCase())
          ) {
            const finding: ComplianceFinding = {
              text: item.text,
              severity: item.severity.toUpperCase() as ComplianceSeverity,
              reason: item.reason,
            };
            if (typeof item.suggestion === 'string' && item.suggestion.trim().length > 0) {
              finding.suggestion = item.suggestion.slice(0, SUGGESTION_MAX_LEN);
            }
            acc.push(finding);
          }
          return acc;
        },
        [],
      );
    }
  } catch {
    return { findings: [], stripped: text };
  }
  const stripped = text
    .slice(0, match.index)
    .concat(text.slice((match.index ?? 0) + match[0].length))
    .trim();
  return { findings, stripped };
};

/**
 * Visible text of a single content part. Reasoning ('think') parts are NOT
 * text — the canvas pipeline must never treat the model's thinking as document
 * content. Text parts may carry either a plain string or the assistants-style
 * `{ value: string }` object (resume/sync paths store the latter), so both
 * shapes are unwrapped.
 */
export const extractPartText = (part: TMessageContentParts | string | undefined | null): string => {
  if (!part) {
    return '';
  }
  if (typeof part === 'string') {
    return part;
  }
  if ('text' in part) {
    const text = part.text;
    if (typeof text === 'string') {
      return text;
    }
    if (text && typeof text === 'object' && typeof text.value === 'string') {
      return text.value;
    }
  }
  return '';
};

/** Flatten a LibreChat message's text / content parts into a single string. */
export const extractMessageText = (message: TMessage | undefined | null): string => {
  if (!message) {
    return '';
  }
  if (typeof message.text === 'string' && message.text.length > 0) {
    return message.text;
  }
  const content = message.content;
  if (Array.isArray(content)) {
    return content.map(extractPartText).join('');
  }
  return typeof message.text === 'string' ? message.text : '';
};

/**
 * Replace a message's TEXT parts with a single text part holding `newText`,
 * PRESERVING every non-text part (reasoning/think, tool calls). The SSE hooks
 * use this when swapping a document reply for the canvas placeholder — the old
 * `content: undefined` wipe also destroyed the model's thinking block, which
 * should stay visible in the chat. Non-array content yields undefined so the
 * message's `text` field remains the single source.
 */
export const replaceTextParts = (
  content: TMessage['content'],
  newText: string,
): TMessage['content'] => {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const preserved = content.filter(
    (part) => part != null && typeof part !== 'string' && part.type !== ContentTypes.TEXT,
  );
  return [...preserved, { type: ContentTypes.TEXT, text: newText } as TMessageContentParts];
};

/**
 * Outbound channel to the embedding Outerscore host. The target origin is
 * pinned to `VITE_OUTERSCORE_PARENT_ORIGIN` when configured (production —
 * document content must not be readable by an arbitrary embedding page);
 * '*' remains only as the unconfigured-dev fallback.
 */
const parentOrigin = (import.meta.env.VITE_OUTERSCORE_PARENT_ORIGIN as string | undefined) || '*';

export const postToParent = (message: unknown): void => {
  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }
  try {
    window.parent.postMessage(message, parentOrigin);
  } catch {
    // Malformed origin / serialization failure — drop rather than break the stream path.
  }
};
