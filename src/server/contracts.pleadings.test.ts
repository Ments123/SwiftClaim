import { describe, expect, it } from 'vitest';

import {
  completeDefaultReviewSchema,
  createResponseTrackSchema,
  createStatementVersionSchema,
  recordAmendmentAuthoritySchema,
  recordStatementEventSchema,
} from '../shared/contracts.js';

const uuid = (suffix: string) => `91000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('governed pleading contracts', () => {
  it('rejects an automated default eligibility result', () => {
    expect(() => completeDefaultReviewSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'default-review-001',
      outcome: 'eligible',
      reviewedAt: '2026-07-18T12:00:00.000Z',
      blockers: [],
      note: 'The response record and service evidence were checked by a solicitor.',
    })).toThrow();
  });

  it('accepts only explicit response regimes', () => {
    expect(createResponseTrackSchema.parse({
      idempotencyKey: 'response-track-001',
      claimantPartyId: uuid('1'),
      defendantPartyId: uuid('2'),
      claimFormDocumentVersionId: uuid('3'),
      particularsDocumentVersionId: uuid('4'),
      regime: 'part_7_domestic',
      serviceRecordId: uuid('5'),
      note: 'The solicitor selected the regime from reviewed retained sources.',
    })).toMatchObject({ regime: 'part_7_domestic' });
  });

  it('requires signatory metadata for a signed statement of truth', () => {
    const input = {
      idempotencyKey: 'statement-version-001',
      statementType: 'defence' as const,
      partyId: uuid('6'),
      documentVersionId: uuid('7'),
      predecessorVersionId: null,
      preparedByUserId: uuid('8'),
      statementOfTruthStatus: 'signed' as const,
      signatoryName: '',
      signatoryCapacity: '',
      signedAt: null,
      responsePosition: 'defend_all' as const,
      amendmentRoute: 'not_applicable' as const,
      amendmentReason: '',
    };
    expect(() => createStatementVersionSchema.parse(input)).toThrow();
    expect(createStatementVersionSchema.parse({
      ...input,
      signatoryName: 'A. Example',
      signatoryCapacity: 'Defendant',
      signedAt: '2026-07-18T11:00:00.000Z',
    })).toMatchObject({ statementOfTruthStatus: 'signed' });
  });

  it('keeps filed, acknowledged, accepted and served as distinct events', () => {
    const base = {
      expectedVersion: 1,
      idempotencyKey: 'statement-event-001',
      eventType: 'filed' as const,
      occurredAt: '2026-07-18T12:00:00.000Z',
      note: 'The filing event was verified against the retained filing record.',
      filingId: uuid('9'),
      serviceRecordId: null,
      sourceDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    };
    expect(recordStatementEventSchema.parse(base).eventType).toBe('filed');
    expect(() => recordStatementEventSchema.parse({
      ...base, eventType: 'served', filingId: null,
    })).toThrow();
  });

  it('requires the exact authority source for a written-consent amendment', () => {
    const base = {
      expectedVersion: 1,
      idempotencyKey: 'amendment-authority-001',
      route: 'written_consent' as const,
      consentDocumentVersionId: null,
      applicationId: null,
      sealedOrderId: null,
      reviewedAt: '2026-07-18T12:00:00.000Z',
      note: 'The amendment authority route was reviewed against the retained source.',
    };
    expect(() => recordAmendmentAuthoritySchema.parse(base)).toThrow();
    expect(recordAmendmentAuthoritySchema.parse({
      ...base, consentDocumentVersionId: uuid('10'),
    }).route).toBe('written_consent');
  });
});
