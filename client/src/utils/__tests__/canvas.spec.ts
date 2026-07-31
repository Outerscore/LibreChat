import type { TMessage } from 'librechat-data-provider';
import {
  buildCanvasSystemPrompt,
  detectCanvasIntent,
  extractDocBody,
  extractMessageText,
  formatComplianceReply,
  isComplianceOnlyReply,
  isComplianceReplyText,
  getCanvasMode,
  isDocumentReplyText,
  isMessageCanvasDoc,
  markMessageAsCanvasDoc,
  parseComplianceEnvelope,
  replaceTextParts,
  resolveCanvasRouting,
  setCanvasMode,
  shouldMaskCanvasReply,
  stripCanvasEnvelopes,
  CANVAS_PLACEHOLDER_TEXT,
  NO_COMPLIANCE_FINDINGS_TEXT,
} from '../canvas';

const PAGE_KEY = 'outerscore:page';
const MODE_KEY = 'outerscore:canvas-mode';

describe('canvas — user mode & routing', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('getCanvasMode / setCanvasMode', () => {
    it("defaults to 'auto' when nothing is stored", () => {
      expect(getCanvasMode()).toBe('auto');
    });

    it("falls back to 'auto' on an unknown stored value", () => {
      sessionStorage.setItem(MODE_KEY, 'bogus');
      expect(getCanvasMode()).toBe('auto');
    });

    it('round-trips chat and document', () => {
      setCanvasMode('chat');
      expect(getCanvasMode()).toBe('chat');
      setCanvasMode('document');
      expect(getCanvasMode()).toBe('document');
    });

    it("clears the stored value when set back to 'auto'", () => {
      setCanvasMode('document');
      setCanvasMode('auto');
      expect(sessionStorage.getItem(MODE_KEY)).toBeNull();
      expect(getCanvasMode()).toBe('auto');
    });
  });

  describe('resolveCanvasRouting', () => {
    it("maps an explicit 'chat' mode to 'chat' routing", () => {
      setCanvasMode('chat');
      expect(resolveCanvasRouting()).toBe('chat');
    });

    it("maps an explicit 'document' mode to 'always' routing", () => {
      setCanvasMode('document');
      expect(resolveCanvasRouting()).toBe('always');
    });

    it("falls back to the env lever ('intent' by default) in 'auto' mode", () => {
      expect(resolveCanvasRouting()).toBe('intent');
    });
  });

  describe('isDocumentReplyText', () => {
    it('flags the in-session canvas placeholder', () => {
      expect(isDocumentReplyText(CANVAS_PLACEHOLDER_TEXT)).toBe(true);
      expect(isDocumentReplyText(`  ${CANVAS_PLACEHOLDER_TEXT}  `)).toBe(true);
    });

    it('flags replies carrying a <document> tag or a compliance envelope', () => {
      expect(isDocumentReplyText('Sure!\n<document>\nBody\n</document>')).toBe(true);
      expect(isDocumentReplyText('Body\n<compliance>{"findings":[]}</compliance>')).toBe(true);
    });

    it('does not flag a plain chat reply or empty text', () => {
      expect(isDocumentReplyText('A fair day rate depends on…')).toBe(false);
      expect(isDocumentReplyText('')).toBe(false);
    });
  });

  describe('shouldMaskCanvasReply', () => {
    it("masks only doc-shaped replies in 'auto' (intent) mode", () => {
      expect(shouldMaskCanvasReply('Plain Q&A answer')).toBe(false);
      expect(shouldMaskCanvasReply('<document>Body</document>')).toBe(true);
      expect(shouldMaskCanvasReply(CANVAS_PLACEHOLDER_TEXT)).toBe(true);
    });

    it("never masks a plain reply in 'chat' mode but keeps masking past document turns", () => {
      setCanvasMode('chat');
      expect(shouldMaskCanvasReply('Plain Q&A answer')).toBe(false);
      expect(shouldMaskCanvasReply(CANVAS_PLACEHOLDER_TEXT)).toBe(true);
    });

    it("does not mask a doc-shaped reply in 'chat' mode — nothing was written to the canvas", () => {
      setCanvasMode('chat');
      expect(shouldMaskCanvasReply('<document>Body</document>')).toBe(false);
      expect(shouldMaskCanvasReply('Answer\n<compliance>{"findings":[]}</compliance>')).toBe(false);
    });

    it("does NOT retroactively mask earlier chat turns in 'document' mode", () => {
      // Bug seen live: answering in chat under 'auto', then flipping the toggle
      // to Document masked the past chat reply as "written to canvas" — false.
      setCanvasMode('document');
      expect(shouldMaskCanvasReply('Plain chat answer from an earlier auto-mode turn')).toBe(false);
    });

    it("masks the in-flight (active) turn in 'document' mode — it streams to the canvas", () => {
      setCanvasMode('document');
      expect(shouldMaskCanvasReply('Raw streaming markdown', undefined, true)).toBe(true);
      // Once committed, the turn is masked via its recorded id / placeholder instead.
      expect(shouldMaskCanvasReply(CANVAS_PLACEHOLDER_TEXT, undefined, false)).toBe(true);
    });

    it("masks a committed document turn in 'document' mode via its recorded id", () => {
      setCanvasMode('document');
      markMessageAsCanvasDoc('msg-doc-mode-1');
      expect(
        shouldMaskCanvasReply('Untagged markdown that IS the document', 'msg-doc-mode-1'),
      ).toBe(true);
    });

    it('keeps masking a marker-less doc reply after a mode switch via its recorded id', () => {
      // Generated under 'document' (always) routing: no marker in the text.
      markMessageAsCanvasDoc('msg-doc-1');
      setCanvasMode('chat');
      expect(shouldMaskCanvasReply('Untagged markdown that IS the document', 'msg-doc-1')).toBe(
        true,
      );
      expect(shouldMaskCanvasReply('Plain Q&A answer', 'msg-chat-1')).toBe(false);
    });
  });

  describe('stripCanvasEnvelopes', () => {
    it('removes document tags and the compliance envelope', () => {
      expect(
        stripCanvasEnvelopes(
          '<document>\n## Body\n</document>\n<compliance>{"findings":[]}</compliance>',
        ),
      ).toBe('## Body');
    });

    it('removes a trailing envelope from an untagged chat reply', () => {
      expect(
        stripCanvasEnvelopes('A plain answer.\n<compliance>{"findings":[]}</compliance>'),
      ).toBe('A plain answer.');
    });

    it('leaves a clean reply unchanged (modulo trimming)', () => {
      expect(stripCanvasEnvelopes('  A plain answer.  ')).toBe('A plain answer.');
      expect(stripCanvasEnvelopes('')).toBe('');
    });
  });

  describe('markMessageAsCanvasDoc / isMessageCanvasDoc', () => {
    it('round-trips a recorded id and ignores unknown / missing ids', () => {
      expect(isMessageCanvasDoc('m1')).toBe(false);
      markMessageAsCanvasDoc('m1');
      expect(isMessageCanvasDoc('m1')).toBe(true);
      expect(isMessageCanvasDoc('m2')).toBe(false);
      expect(isMessageCanvasDoc(undefined)).toBe(false);
      expect(isMessageCanvasDoc(null)).toBe(false);
    });

    it('persists ids to localStorage', () => {
      markMessageAsCanvasDoc('m-persisted');
      const stored = JSON.parse(localStorage.getItem('outerscore:canvas-doc-ids') ?? '[]');
      expect(stored).toContain('m-persisted');
    });
  });

  describe('buildCanvasSystemPrompt — per-mode prompts', () => {
    it('returns an empty prompt off canvas pages regardless of mode', () => {
      setCanvasMode('document');
      expect(buildCanvasSystemPrompt()).toBe('');
    });

    it("instructs intent-based routing via <document> in 'auto' mode", () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('Decide how to respond');
      expect(prompt).toContain('<document>');
    });

    it('does NOT run compliance in regular canvas mode (disabled — agent-only)', () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      // intent ('auto'), always ('document') and chat modes must all be free of
      // any compliance/audit instruction — compliance is produced only by the
      // explicitly-selected compliance agent.
      const intentPrompt = buildCanvasSystemPrompt();
      expect(intentPrompt).not.toContain('<compliance>');
      expect(intentPrompt).not.toContain('AUDIT');

      setCanvasMode('document');
      expect(buildCanvasSystemPrompt()).not.toContain('<compliance>');

      setCanvasMode('chat');
      expect(buildCanvasSystemPrompt()).not.toContain('<compliance>');
    });

    it("instructs a chat-only reply (no tags) in 'chat' mode", () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      setCanvasMode('chat');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('chat-only mode');
      expect(prompt).not.toContain('Decide how to respond');
      expect(prompt).not.toContain('Begin your reply with the <document> tag');
    });

    it("instructs an unconditional document rewrite in 'document' mode", () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      setCanvasMode('document');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('COMPLETE updated');
      expect(prompt).not.toContain('Decide how to respond');
    });

    it("routes explicit canvas references to document work in 'auto' (intent) mode", () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      const prompt = buildCanvasSystemPrompt();
      // "provide X in the canvas" and "move that chat answer to the canvas"
      // must be treated as document work, not chat.
      expect(prompt).toContain('IN or ON the canvas');
      expect(prompt).toContain('earlier chat answer');
      expect(prompt).toContain('called the "canvas"');
    });

    it('lists change verbs (correct/fix/improve) under DOCUMENT WORK', () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('CORRECT');
      expect(prompt).toContain('ADD TO');
      expect(prompt).toContain('IMPROVE');
    });

    it('injects document context only (no rules/intent) when an agent is active', () => {
      sessionStorage.setItem(PAGE_KEY, 'sow-project-brief');
      const prompt = buildCanvasSystemPrompt(true);
      // The selected agent owns its own rules — we must not duplicate them.
      expect(prompt).toContain('the live SOW Project Brief');
      expect(prompt).not.toContain('Decide how to respond');
      expect(prompt).not.toContain('<document>');
      expect(prompt).not.toContain('compliance envelope');
    });

    it('builds a job-description canvas prompt with its own artifact + structure', () => {
      sessionStorage.setItem(PAGE_KEY, 'job-description');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('Job Description');
      expect(prompt).toContain('## Responsibilities');
    });

    it('builds a contract-description prompt restricted to PDF-safe blocks', () => {
      sessionStorage.setItem(PAGE_KEY, 'contract-description');
      const prompt = buildCanvasSystemPrompt();
      expect(prompt).toContain('contract work description');
      expect(prompt).toContain('Never use tables, code fences');
    });
  });
});

describe('canvas — isComplianceOnlyReply', () => {
  it('is true for a reply that is only a compliance envelope', () => {
    expect(isComplianceOnlyReply('<compliance>{"findings":[]}</compliance>')).toBe(true);
    expect(
      isComplianceOnlyReply('Here is the review:\n<compliance>{"findings":[]}</compliance>'),
    ).toBe(true);
  });

  it('is false when the reply also contains a <document> (that is document work)', () => {
    expect(
      isComplianceOnlyReply('<document>Body</document><compliance>{"findings":[]}</compliance>'),
    ).toBe(false);
  });

  it('is false for a plain chat reply or empty text', () => {
    expect(isComplianceOnlyReply('A fair day rate depends on…')).toBe(false);
    expect(isComplianceOnlyReply('')).toBe(false);
  });
});

describe('canvas — isComplianceReplyText (streaming-tolerant)', () => {
  it('is true for a complete or partial compliance envelope (no document)', () => {
    expect(isComplianceReplyText('<compliance>{"findings":[]}</compliance>')).toBe(true);
    expect(isComplianceReplyText('<compliance>{"findi')).toBe(true);
  });

  it('is false for a document reply or plain chat', () => {
    expect(isComplianceReplyText('<document>Body</document><compliance>{}</compliance>')).toBe(
      false,
    );
    expect(isComplianceReplyText('A fair day rate depends on…')).toBe(false);
    expect(isComplianceReplyText('')).toBe(false);
  });
});

describe('canvas — formatComplianceReply', () => {
  it('renders the all-clear message for an empty envelope (no raw JSON)', () => {
    const result = formatComplianceReply('<compliance>{"findings":[]}</compliance>');
    expect(result).toBe(NO_COMPLIANCE_FINDINGS_TEXT);
    expect(result).not.toContain('<compliance>');
    expect(result).not.toContain('findings');
  });

  it('renders a readable markdown list with severity, reason, span and suggestion', () => {
    const reply =
      '<compliance>{"findings":[{"text":"under 40","severity":"HIGH","reason":"age discrimination","suggestion":"remove the age requirement"}]}</compliance>';
    const result = formatComplianceReply(reply);
    expect(result).toContain('1 compliance issue found');
    expect(result).toContain('**HIGH**');
    expect(result).toContain('age discrimination');
    expect(result).toContain('under 40');
    expect(result).toContain('remove the age requirement');
    expect(result).not.toContain('<compliance>');
  });

  it('pluralizes the heading for multiple findings', () => {
    const reply =
      '<compliance>{"findings":[{"text":"a","severity":"LOW","reason":"r1"},{"text":"b","severity":"MODERATE","reason":"r2"}]}</compliance>';
    expect(formatComplianceReply(reply)).toContain('2 compliance issues found');
  });
});

describe('canvas — host-bound stream parsing', () => {
  describe('detectCanvasIntent', () => {
    it("returns 'pending' for empty or whitespace-only text", () => {
      expect(detectCanvasIntent('')).toBe('pending');
      expect(detectCanvasIntent('   \n')).toBe('pending');
    });

    it("returns 'pending' while the prefix could still become <document>", () => {
      expect(detectCanvasIntent('<doc')).toBe('pending');
      expect(detectCanvasIntent('  <document')).toBe('pending');
    });

    it("returns 'yes' once the reply opens with <document> (tolerating leading whitespace)", () => {
      expect(detectCanvasIntent('<document>\n## Objectives')).toBe('yes');
      expect(detectCanvasIntent('   \n<document>x')).toBe('yes');
    });

    it("returns 'yes' when the tag arrives after a model preamble", () => {
      expect(detectCanvasIntent('Here is the updated brief:\n<document>\nBody')).toBe('yes');
    });

    it("stays 'pending' for a tag-less reply (only the final pass decides chat-only)", () => {
      expect(detectCanvasIntent('A fair day rate depends on…')).toBe('pending');
    });
  });

  describe('extractDocBody', () => {
    it('returns the body between the document tags', () => {
      expect(extractDocBody('<document>\n## Objectives\nDo X\n</document>')).toBe(
        '## Objectives\nDo X',
      );
    });

    it('strips a trailing compliance envelope from the body', () => {
      const reply = '<document>\nBody text\n</document><compliance>{"findings":[]}</compliance>';
      expect(extractDocBody(reply)).toBe('Body text');
    });

    it('tolerates a preamble before the opening tag', () => {
      expect(extractDocBody('Sure! <document>Body</document>')).toBe('Body');
    });

    it('returns the body while still streaming (no close tag yet)', () => {
      expect(extractDocBody('<document>Partial body so far')).toBe('Partial body so far');
    });

    it('falls back to the whole reply when there is no envelope', () => {
      expect(extractDocBody('  Just plain markdown  ')).toBe('Just plain markdown');
    });
  });

  describe('parseComplianceEnvelope', () => {
    it('returns no findings and the original text when there is no envelope', () => {
      const text = 'Body with no envelope';
      expect(parseComplianceEnvelope(text)).toEqual({ findings: [], stripped: text });
    });

    it('parses valid findings and strips the envelope from the text', () => {
      const text =
        'Body text\n<compliance>{"findings":[{"text":"ASAP","severity":"high","reason":"vague deadline"}]}</compliance>';
      const { findings, stripped } = parseComplianceEnvelope(text);
      expect(findings).toEqual([{ text: 'ASAP', severity: 'HIGH', reason: 'vague deadline' }]);
      expect(stripped).toBe('Body text');
    });

    it('keeps a suggestion when present and drops it when blank', () => {
      const withSuggestion =
        '<compliance>{"findings":[{"text":"x","severity":"LOW","reason":"r","suggestion":"do y"}]}</compliance>';
      expect(parseComplianceEnvelope(withSuggestion).findings[0].suggestion).toBe('do y');

      const blankSuggestion =
        '<compliance>{"findings":[{"text":"x","severity":"LOW","reason":"r","suggestion":"   "}]}</compliance>';
      expect(parseComplianceEnvelope(blankSuggestion).findings[0]).not.toHaveProperty('suggestion');
    });

    it('truncates an over-long suggestion to 600 characters', () => {
      const long = 'a'.repeat(800);
      const text = `<compliance>{"findings":[{"text":"x","severity":"MODERATE","reason":"r","suggestion":"${long}"}]}</compliance>`;
      expect(parseComplianceEnvelope(text).findings[0].suggestion).toHaveLength(600);
    });

    it('filters out findings with an unknown severity or missing fields', () => {
      const text =
        '<compliance>{"findings":[{"text":"a","severity":"CRITICAL","reason":"r"},{"severity":"LOW","reason":"r"},{"text":"b","severity":"low","reason":"ok"}]}</compliance>';
      expect(parseComplianceEnvelope(text).findings).toEqual([
        { text: 'b', severity: 'LOW', reason: 'ok' },
      ]);
    });

    it('tolerates a malformed envelope (no findings, original text preserved)', () => {
      const text = 'Body\n<compliance>{not valid json}</compliance>';
      expect(parseComplianceEnvelope(text)).toEqual({ findings: [], stripped: text });
    });

    it('handles an explicitly empty findings array', () => {
      const text = 'Body\n<compliance>{"findings":[]}</compliance>';
      const { findings, stripped } = parseComplianceEnvelope(text);
      expect(findings).toEqual([]);
      expect(stripped).toBe('Body');
    });
  });
});

describe('canvas — message text extraction & placeholder replacement', () => {
  describe('extractMessageText', () => {
    it('prefers the flat text field when present', () => {
      const message = {
        text: 'flat text',
        content: [{ type: 'text', text: 'part text' }],
      } as unknown as TMessage;
      expect(extractMessageText(message)).toBe('flat text');
    });

    it('flattens string-shaped text parts', () => {
      const message = {
        text: '',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      } as unknown as TMessage;
      expect(extractMessageText(message)).toBe('Hello world');
    });

    it('unwraps object-shaped ({ value }) text parts (resume/sync paths)', () => {
      const message = {
        text: '',
        content: [{ type: 'text', text: { value: 'from value' } }],
      } as unknown as TMessage;
      expect(extractMessageText(message)).toBe('from value');
    });

    it("skips reasoning parts — the model's thinking is never document content", () => {
      const message = {
        text: '',
        content: [
          { type: 'think', think: 'internal reasoning the host must never see' },
          { type: 'text', text: '<document>Body</document>' },
        ],
      } as unknown as TMessage;
      expect(extractMessageText(message)).toBe('<document>Body</document>');
    });

    it('returns an empty string for a missing message', () => {
      expect(extractMessageText(null)).toBe('');
      expect(extractMessageText(undefined)).toBe('');
    });
  });

  describe('replaceTextParts', () => {
    it('replaces text parts with a single placeholder part, preserving think parts', () => {
      const content = [
        { type: 'think', think: 'reasoning' },
        { type: 'text', text: '<document>Body</document>' },
      ] as unknown as TMessage['content'];
      const replaced = replaceTextParts(content, CANVAS_PLACEHOLDER_TEXT) ?? [];
      expect(replaced).toHaveLength(2);
      expect(replaced[0]).toEqual({ type: 'think', think: 'reasoning' });
      expect(replaced[1]).toEqual({ type: 'text', text: CANVAS_PLACEHOLDER_TEXT });
    });

    it('collapses multiple text parts into one replacement part', () => {
      const content = [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ] as unknown as TMessage['content'];
      const replaced = replaceTextParts(content, 'new') ?? [];
      expect(replaced).toEqual([{ type: 'text', text: 'new' }]);
    });

    it('returns undefined for non-array content (text field stays the single source)', () => {
      expect(replaceTextParts(undefined, 'new')).toBeUndefined();
    });
  });
});
