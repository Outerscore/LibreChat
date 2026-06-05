const CANVAS_CONTEXT_KEY = 'outerscore:canvas-content';
const CANVAS_PAGE_KEY = 'outerscore:page';
const CANVAS_PAGES = new Set(['canvas2', 'sow-project-brief', 'sow-deliverable-description']);

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
const buildSpecPrompt = (spec: CanvasSpec, document: string, alwaysDocument: boolean): string => {
  const trimmed = document.trim();
  const context = [
    `You are an assistant embedded next to a ${spec.artifact} editor on the Outerscore procurement platform.`,
    trimmed
      ? `The current ${spec.artifact} content is:\n---\n${trimmed}\n---`
      : `The ${spec.artifact} is currently empty.`,
    '',
  ];

  // 'always' routing: the host has already decided this turn targets the
  // document, so don't ask the model to choose — just have it write the doc.
  // No <document> envelope is required, which is what lets weaker / local
  // models (Ollama) drive the canvas reliably.
  if (alwaysDocument) {
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
  const alwaysDocument =
    ((import.meta.env.VITE_OUTERSCORE_CANVAS_ROUTING as string) || 'intent') === 'always';
  const spec = SPEC_BY_PAGE[page] ?? GENERIC_SPEC;
  return buildSpecPrompt(spec, canvas, alwaysDocument);
};
