import { describe, expect, it } from 'vitest';

import {
  createDisclosureAiSuggestionSchema,
  recordDisclosureDecisionSchema,
  recordDisclosurePrivilegeReviewSchema,
} from '../shared/contracts.js';

const uuid = (suffix: string) => `92000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('governed disclosure contracts', () => {
  it('rejects a final AI disclosure decision', () => {
    expect(() => createDisclosureAiSuggestionSchema.parse({
      idempotencyKey: 'ai-suggestion-001',
      relevance: 'likely_relevant',
      privilegeWarning: 'possible',
      finalDecision: 'disclose',
      rationale: 'The document contains repair chronology evidence.',
      model: 'evaluation-local-v1',
      policyVersion: 'disclosure-v1',
      sourceHash: 'a'.repeat(64),
      citedSpans: ['repair chronology'],
      suggestedIssueTags: ['repairs'],
    })).toThrow();
  });

  it('requires human review metadata for a disclosure decision', () => {
    expect(recordDisclosureDecisionSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'disclosure-decision-001',
      decision: 'review_required',
      reason: 'The solicitor must resolve the outstanding relevance question.',
      redactionRequired: false,
      reviewedAt: '2026-07-18T18:00:00.000Z',
    })).toMatchObject({ decision: 'review_required' });
  });

  it('requires explicit exposure confirmation for privilege waiver', () => {
    const input = {
      expectedVersion: 1,
      idempotencyKey: 'privilege-review-001',
      category: 'legal_advice' as const,
      outcome: 'waived' as const,
      basis: 'The partner reviewed the exact advice and retained authority source.',
      authorityDocumentVersionId: uuid('1'),
      confirmExposure: false,
      reviewedAt: '2026-07-18T18:00:00.000Z',
    };
    expect(() => recordDisclosurePrivilegeReviewSchema.parse(input)).toThrow();
    expect(recordDisclosurePrivilegeReviewSchema.parse({
      ...input, confirmExposure: true,
    }).outcome).toBe('waived');
  });
});
