import { COMPLIANCE_SPECS, DEFAULT_COMPLIANCE_MODEL } from './compliance';

describe('compliance specs', () => {
  const specs = Object.values(COMPLIANCE_SPECS);

  it('exposes a spec per supported canvas page with deterministic, unique ids', () => {
    expect(Object.keys(COMPLIANCE_SPECS).sort()).toEqual([
      'sow-deliverable-description',
      'sow-project-brief',
    ]);
    const ids = specs.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^agent_oscompliance__/));
  });

  it('gives every spec a name, description and instructions', () => {
    specs.forEach((spec) => {
      expect(spec.name).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.instructions.length).toBeGreaterThan(0);
    });
  });

  it('embeds the <compliance> envelope contract the client parser depends on', () => {
    // These substrings are the machine contract with parseComplianceEnvelope
    // (client/src/utils/canvas.ts); changing them requires changing the parser.
    specs.forEach((spec) => {
      expect(spec.instructions).toContain('<compliance>{"findings":[{"text":"<verbatim span>"');
      expect(spec.instructions).toContain('<compliance>{"findings":[]}</compliance>');
      expect(spec.instructions).toContain('HIGH|MODERATE|LOW');
    });
  });

  it('keeps the two page prompts distinct (brief vs deliverable structure)', () => {
    expect(COMPLIANCE_SPECS['sow-project-brief'].instructions).not.toEqual(
      COMPLIANCE_SPECS['sow-deliverable-description'].instructions,
    );
    expect(COMPLIANCE_SPECS['sow-project-brief'].instructions).toContain('Project Brief');
    expect(COMPLIANCE_SPECS['sow-deliverable-description'].instructions).toContain(
      'deliverable description',
    );
  });

  it('defaults to a Claude model', () => {
    expect(DEFAULT_COMPLIANCE_MODEL).toBe('claude-sonnet-4-6');
  });
});
