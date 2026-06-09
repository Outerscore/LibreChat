import { detectCanvasIntent, extractDocBody, parseComplianceEnvelope } from '../canvas';

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

    it("returns 'no' for a normal chat reply", () => {
      expect(detectCanvasIntent('A fair day rate depends on…')).toBe('no');
      expect(detectCanvasIntent('Here is some advice <document>')).toBe('no');
    });
  });

  describe('extractDocBody', () => {
    it('returns the body between the document tags', () => {
      expect(extractDocBody('<document>\n## Objectives\nDo X\n</document>')).toBe(
        '## Objectives\nDo X',
      );
    });

    it('strips a trailing compliance envelope from the body', () => {
      const reply =
        '<document>\nBody text\n</document><compliance>{"findings":[]}</compliance>';
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
      expect(findings).toEqual([
        { text: 'ASAP', severity: 'HIGH', reason: 'vague deadline' },
      ]);
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
