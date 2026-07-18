import { describe, expect, it } from 'vitest';

import { evaluateDisclosureDocument } from './evaluation.js';

describe('deterministic disclosure evaluation', () => {
  it('returns a provisional suggestion with deterministic provenance', () => {
    const input = {
      sourceHash: 'a'.repeat(64), title: 'Repair chronology',
      extractedText: 'Repairs were reported and inspected by the surveyor.', issueTags: ['repairs'],
    };
    const first = evaluateDisclosureDocument(input);
    expect(first).toEqual(evaluateDisclosureDocument(input));
    expect(first).toMatchObject({
      relevance: 'likely_relevant', model: 'evaluation-local-v1',
      policyVersion: 'disclosure-evaluation-v1', sourceHash: 'a'.repeat(64),
    });
    expect(first).not.toHaveProperty('finalDecision');
  });

  it('raises a possible privilege warning without making a privilege decision', () => {
    const result = evaluateDisclosureDocument({
      sourceHash: 'b'.repeat(64), title: 'Advice note',
      extractedText: 'Confidential legal advice prepared for litigation strategy.', issueTags: [],
    });
    expect(result.privilegeWarning).toBe('possible');
    expect(result.rationale).toMatch(/human review/i);
  });
});
