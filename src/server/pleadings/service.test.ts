import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from '../proceedings/store.js';
import { PleadingsService } from './service.js';
import { PleadingsStore } from './store.js';

const now = () => new Date('2026-09-01T10:00:00.000Z');
const audit = { requestId: 'pleadings-service-test', ipAddress: '127.0.0.1' };
const ava: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};
const ben: SessionUser = {
  ...ava, id: SEED_IDS.ben, email: 'ben@northstar.test', name: 'Ben Foster', role: 'paralegal',
};
const readonly: SessionUser = {
  ...ava, email: 'readonly@northstar.test', name: 'Read Only', role: 'readonly',
};

describe('PleadingsService', () => {
  let database: DatabaseSync;
  let service: PleadingsService;
  let proceedingId: string;
  let claimantPartyId: string;
  let defendantPartyId: string;
  let documentVersionIds: string[];

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    proceedingId = new ProceedingsStore(database, now).createProceeding(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'pleadings-service-proceeding', procedureType: 'part7',
      jurisdiction: 'england_wales', courtName: 'County Court', courtCode: null, hearingCentre: null,
    }, audit).id;
    const parties = database.prepare(`SELECT id, kind FROM parties
      WHERE firm_id = ? AND matter_id = ?`).all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string; kind: string }>;
    claimantPartyId = parties.find(({ kind }) => kind === 'client')!.id;
    defendantPartyId = parties.find(({ kind }) => kind === 'opponent')!.id;
    documentVersionIds = (database.prepare(`SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY dv.created_at LIMIT 2`)
      .all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string }>).map(({ id }) => id);
    service = new PleadingsService(new PleadingsStore(database, now));
  });

  afterEach(() => database.close());

  const input = () => ({
    idempotencyKey: 'service-open-track', claimantPartyId, defendantPartyId,
    claimFormDocumentVersionId: documentVersionIds[0]!,
    particularsDocumentVersionId: documentVersionIds[1]!,
    regime: 'part_7_domestic' as const, serviceRecordId: null,
    note: 'The response track was opened from reviewed synthetic source records.',
  });

  it('requires both proceedings and pleadings read capabilities', () => {
    expect(() => service.getWorkspace(readonly, SEED_IDS.northstarMatter, proceedingId))
      .toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('allows a paralegal to prepare a response track', () => {
    expect(service.openTrack(ben, SEED_IDS.northstarMatter, proceedingId, input(), audit))
      .toMatchObject({ defendantPartyId, regime: 'part_7_domestic' });
  });

  it('returns narrow command permissions with the workspace', () => {
    service.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    expect(service.getWorkspace(ava, SEED_IDS.northstarMatter, proceedingId).permissions)
      .toEqual({
        canRead: true, canPrepare: true, canRecordExternal: true,
        canApproveClaimantStatement: true, canReviewDefault: true,
        canRecordAmendmentAuthority: true,
      });
  });

  it('prevents a paralegal completing default review', () => {
    expect(() => service.assertCanCompleteDefaultReview(ben))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => service.assertCanCompleteDefaultReview(ava)).not.toThrow();
  });

  it('requires independent claimant-statement approval and gates external events', () => {
    const track = service.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const statement = service.createStatementVersion(
      ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
        idempotencyKey: 'service-claim-version', statementType: 'particulars',
        partyId: claimantPartyId, documentVersionId: documentVersionIds[1]!,
        predecessorVersionId: null, preparedByUserId: ava.id,
        statementOfTruthStatus: 'signed', signatoryName: 'Ava Morgan',
        signatoryCapacity: 'Solicitor', signedAt: '2026-09-20T10:00:00.000Z',
        responsePosition: 'not_recorded', amendmentRoute: 'not_applicable', amendmentReason: '',
      }, audit,
    );
    expect(() => service.recordStatementEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, statement.id, {
        expectedVersion: 1, idempotencyKey: 'service-self-approval',
        eventType: 'approved_for_filing', occurredAt: '2026-09-20T11:00:00.000Z',
        note: 'The exact claimant statement was reviewed for filing approval.',
        filingId: null, serviceRecordId: null, sourceDocumentVersionId: null,
        supersedesEventId: null, correctionReason: '',
      }, audit,
    )).toThrowError(expect.objectContaining({ code: 'INDEPENDENT_REVIEW_REQUIRED' }));
  });

  it('reserves amendment authority for solicitors and above', () => {
    const track = service.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const statement = service.createStatementVersion(ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
      idempotencyKey: 'service-amended-version', statementType: 'amended_statement',
      partyId: claimantPartyId, documentVersionId: documentVersionIds[1]!,
      predecessorVersionId: null, preparedByUserId: ava.id,
      statementOfTruthStatus: 'signed', signatoryName: 'Ava Morgan',
      signatoryCapacity: 'Solicitor', signedAt: '2026-09-22T10:00:00.000Z',
      responsePosition: 'not_recorded', amendmentRoute: 'written_consent',
      amendmentReason: 'Correct the pleaded chronology from the retained source.',
    }, audit);
    const authority = {
      expectedVersion: 1, idempotencyKey: 'service-amendment-authority',
      route: 'written_consent' as const, consentDocumentVersionId: documentVersionIds[0]!,
      applicationId: null, sealedOrderId: null, reviewedAt: '2026-09-22T11:00:00.000Z',
      note: 'The exact written consent was reviewed and retained for this amendment.',
    };
    expect(() => service.recordAmendmentAuthority(
      ben, SEED_IDS.northstarMatter, proceedingId, statement.currentVersion!.id, authority, audit,
    )).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(service.recordAmendmentAuthority(
      ava, SEED_IDS.northstarMatter, proceedingId, statement.currentVersion!.id, authority, audit,
    )).toMatchObject({ route: 'written_consent' });
  });

  it('creates and completes only neutral human default reviews', () => {
    const track = service.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const review = service.createDefaultReview(ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
      idempotencyKey: 'service-default-create', statementVersionId: null,
      deadlineProjectionId: null, claimType: 'Part 7 claim',
      requestedMethod: 'Court review required',
      note: 'Ava opened the human default judgment checklist from retained sources.',
    }, audit);
    expect(() => service.completeDefaultReview(ben, SEED_IDS.northstarMatter, proceedingId, review.id, {
      expectedVersion: 1, idempotencyKey: 'service-default-forbidden',
      outcome: 'blockers_recorded', reviewedAt: '2026-09-25T10:00:00.000Z',
      blockers: ['Part 12 exclusion question unresolved'],
      note: 'The unresolved exclusion question remains a recorded blocker.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(service.completeDefaultReview(ava, SEED_IDS.northstarMatter, proceedingId, review.id, {
      expectedVersion: 1, idempotencyKey: 'service-default-blocked',
      outcome: 'blockers_recorded', reviewedAt: '2026-09-25T10:00:00.000Z',
      blockers: ['Part 12 exclusion question unresolved'],
      note: 'The unresolved exclusion question remains a recorded blocker.',
    }, audit)).toMatchObject({ outcome: 'blockers_recorded' });
  });

  it('records qualified deadline review only through external-record authority', () => {
    const track = service.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    expect(service.reviewDeadline(ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
      expectedVersion: 1, idempotencyKey: 'service-deadline-review', kind: 'defence',
      outcome: 'projected', triggerDate: '2026-09-14', projectedDate: '2026-10-12',
      sourceDocumentVersionId: null, ruleKey: 'cpr_15_4_aos_general',
      ruleVersion: 'reviewed-2026-07-18', sourceTitle: 'CPR Part 15',
      sourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15',
      reviewedAt: '2026-09-15T10:00:00.000Z',
      note: 'The solicitor reviewed the service trigger and qualified response projection.',
    }, audit)).toMatchObject({ outcome: 'projected' });
  });
});
