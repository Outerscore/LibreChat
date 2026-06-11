import type { TMessage } from 'librechat-data-provider';

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

/**
 * Compliance envelope spec — appended *inside* a document reply only. Findings
 * may include an optional `suggestion`; the host renders an "Apply fix" button
 * only when one is present, so the model is told to add it only when a single
 * document-ready rewrite is the right fix.
 */
const complianceClause = (rules: string[]): string =>
  [
    'Immediately after </document>, append a single compliance envelope and nothing else:',
    '<compliance>{"findings":[{"text":"<verbatim span from the document>","severity":"HIGH|MODERATE|LOW","reason":"<short explanation>","suggestion":"<optional replacement — omit when the right fix is to delete or rewrite from scratch>"}]}</compliance>',
    'Keep each suggestion under 600 characters and write it so it can replace the flagged span in place. If there is nothing to flag, append <compliance>{"findings":[]}</compliance>.',
    'Check the document against these rules:',
    ...rules.map((r) => `- ${r}`),
  ].join('\n');

/**
 * Intent-aware canvas system prompt. The model decides, per turn, whether the
 * user is asking for document work or just chatting:
 *  - document work  → reply is ONLY `<document>…</document>` + `<compliance>…`,
 *    which the host streams into the editor canvas;
 *  - anything else  → a normal chat reply with no tags, which stays in the chat.
 *
 * Returned as *system* instructions so the document + rules never appear in the
 * visible user message.
 */
const buildSpecPrompt = (spec: CanvasSpec, document: string, routing: CanvasRouting): string => {
  const trimmed = document.trim();
  const context = [
    `You are an assistant embedded next to a ${spec.artifact} editor on the Outerscore procurement platform.`,
    trimmed
      ? `The current ${spec.artifact} content is:\n---\n${trimmed}\n---`
      : `The ${spec.artifact} is currently empty.`,
    '',
  ];

  // 'chat' routing: the user pinned the toggle to chat-only — answer normally,
  // never produce a document. The SSE hooks also drop any canvas forwarding in
  // this mode, so this instruction is belt-and-braces for weak models.
  if (routing === 'chat') {
    return [
      ...context,
      `Reply as a helpful assistant in plain Markdown. You may quote or refer to the ${spec.artifact} content above, but do NOT output a rewritten ${spec.artifact} and never use <document> or <compliance> tags — the user has chat-only mode enabled and your reply stays in the chat.`,
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
      complianceClause(spec.rules),
    ].join('\n');
  }

  // 'intent' routing: the model decides per reply via the <document> envelope.
  return [
    ...context,
    "Decide how to respond based on the user's message:",
    '',
    `1. If the user asks you to WRITE, DRAFT, REWRITE, UPDATE, TRANSLATE, SHORTEN, EXPAND or otherwise change the ${spec.artifact}, reply with the COMPLETE updated document and nothing before it. Begin your reply with the <document> tag:`,
    '<document>',
    '...the full document in Markdown — no preamble, no commentary, no code fences...',
    '</document>',
    spec.structure,
    complianceClause(spec.rules),
    'The <document> block followed by the <compliance> envelope is the ENTIRE reply — output nothing else.',
    '',
    '2. Otherwise (a question, advice, brainstorming, or general chat), reply normally as a helpful assistant in plain Markdown. Do NOT use <document> or <compliance> tags. You may refer to the document content above.',
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
export const buildCanvasSystemPrompt = (): string => {
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
  return buildSpecPrompt(spec, canvas, resolveCanvasRouting());
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
    COMPLIANCE_ENVELOPE.test(trimmed)
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

/**
 * Display decision for an assistant reply on a canvas page: mask it with the
 * "written to canvas" indicator, or render it as a normal chat bubble.
 * Under 'always' routing every reply is the document (and carries no marker),
 * so everything is masked; under 'intent' and 'chat' a reply is masked when it
 * is doc-shaped OR known (by id) to have driven the canvas — which is what
 * lets Q&A and chat-mode replies render in the thread while past document
 * turns stay masked after a mode switch.
 */
export const shouldMaskCanvasReply = (text: string, messageId?: string | null): boolean => {
  if (resolveCanvasRouting() === 'always') {
    return true;
  }
  return isDocumentReplyText(text) || isMessageCanvasDoc(messageId);
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
  const compIdx = body.indexOf('<compliance>');
  if (compIdx !== -1) {
    body = body.slice(0, compIdx);
  }
  return body.trim();
};

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
      findings = parsed.findings.reduce<ComplianceFinding[]>((acc, item) => {
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
      }, []);
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
    return content
      .map((part) => {
        if (!part) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return typeof message.text === 'string' ? message.text : '';
};
