import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from '../proceedings/store.js';
import { PleadingsStore } from './store.js';

const now = () => new Date('2026-09-01T10:00:00.000Z');
const audit = { requestId: 'pleadings-store-test', ipAddress: '127.0.0.1' };
const ava: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};

describe('PleadingsStore', () => {
  let database: DatabaseSync;
  let store: PleadingsStore;
  let proceedingId: string;
  let claimantPartyId: string;
  let defendantPartyId: string;
  let documentVersionIds: string[];

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    proceedingId = new ProceedingsStore(database, now).createProceeding(
      ava,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'pleadings-test-proceeding', procedureType: 'part7',
        jurisdiction: 'england_wales', courtName: 'County Court',
        courtCode: null, hearingCentre: null,
      },
      audit,
    ).id;
    const parties = database.prepare(`SELECT id, kind FROM parties
      WHERE firm_id = ? AND matter_id = ? ORDER BY kind, id`)
      .all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string; kind: string }>;
    claimantPartyId = parties.find(({ kind }) => kind === 'client')!.id;
    defendantPartyId = parties.find(({ kind }) => kind === 'opponent')!.id;
    documentVersionIds = (database.prepare(`SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY dv.created_at LIMIT 2`)
      .all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string }>).map(({ id }) => id);
    store = new PleadingsStore(database, now);
  });

  afterEach(() => database.close());

  const input = () => ({
    idempotencyKey: 'open-response-track-001',
    claimantPartyId,
    defendantPartyId,
    claimFormDocumentVersionId: documentVersionIds[0]!,
    particularsDocumentVersionId: documentVersionIds[1]!,
    regime: 'part_7_domestic' as const,
    serviceRecordId: null,
    note: 'The response regime was selected from reviewed synthetic source records.',
  });

  it('creates one replay-safe track and operational records atomically', () => {
    const first = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    expect(store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit)).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS count FROM claim_response_tracks').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM claim_response_track_events').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM pleadings_command_receipts').get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'pleadings.track_opened'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'pleadings.track_opened'").get()).toEqual({ count: 1 });
  });

  it('conflicts when an idempotency key is reused with changed input', () => {
    store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    expect(() => store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, {
      ...input(), regime: 'part_8',
    }, audit)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  });

  it('never returns another firm track by UUID', () => {
    const created = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    expect(store.getTrack(SEED_IDS.southbankFirm, SEED_IDS.northstarMatter, created.id)).toBeUndefined();
    expect(store.getWorkspace(SEED_IDS.southbankFirm, SEED_IDS.northstarMatter, proceedingId)).toBeUndefined();
  });

  it('rejects a document version outside the scoped matter', () => {
    expect(() => store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, {
      ...input(), claimFormDocumentVersionId: '91000000-0000-4000-8000-000000000099',
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_LINK' }));
  });

  it('assembles defendant labels and exact source options', () => {
    const created = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const workspace = store.getWorkspace(ava.firmId, SEED_IDS.northstarMatter, proceedingId);
    expect(workspace?.tracks).toEqual([
      expect.objectContaining({ id: created.id, defendant: expect.objectContaining({ id: defendantPartyId }) }),
    ]);
    expect(workspace?.sources.documents[0]).toMatchObject({ id: expect.any(String), title: expect.any(String) });
  });

  it('retains an exact statement version and distinct filing and service events', () => {
    const track = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const statement = store.createStatementVersion(
      ava, SEED_IDS.northstarMatter, proceedingId, track.id,
      {
        idempotencyKey: 'create-defence-version-001', statementType: 'defence',
        partyId: defendantPartyId, documentVersionId: documentVersionIds[1]!,
        predecessorVersionId: null, preparedByUserId: ava.id,
        statementOfTruthStatus: 'signed', signatoryName: 'Synthetic Defendant',
        signatoryCapacity: 'Defendant', signedAt: '2026-09-20T10:00:00.000Z',
        responsePosition: 'defend_all', amendmentRoute: 'not_applicable', amendmentReason: '',
      }, audit,
    );
    expect(statement.currentVersion).toMatchObject({ versionNumber: 1, statementType: 'defence' });

    const filing = new ProceedingsStore(database, now).createFiling(
      ava, SEED_IDS.northstarMatter, proceedingId, {
        idempotencyKey: 'pleadings-store-filing', purpose: 'File the exact defence version.',
        documentVersionIds: [documentVersionIds[1]!], submissionChannel: 'portal',
        feePosition: 'not_applicable', feeMinor: null, currency: 'GBP',
      }, audit,
    );
    const filed = store.recordStatementEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, statement.id,
      {
        expectedVersion: 1, idempotencyKey: 'defence-filed-001', eventType: 'filed',
        occurredAt: '2026-09-20T11:00:00.000Z',
        note: 'The exact defence version was submitted through the retained filing record.',
        filingId: filing.id, serviceRecordId: null, sourceDocumentVersionId: null,
        supersedesEventId: null, correctionReason: '',
      }, audit,
    );
    expect(filed.projection).toMatchObject({ filingState: 'filed', serviceState: 'not_served' });
    expect(store.getWorkspace(ava.firmId, SEED_IDS.northstarMatter, proceedingId)?.tracks[0]?.statements)
      .toEqual([expect.objectContaining({ id: statement.id, currentVersion: expect.objectContaining({ documentVersionId: documentVersionIds[1] }) })]);
  });

  it('retains exact written consent as immutable amendment authority', () => {
    const track = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const statement = store.createStatementVersion(ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
      idempotencyKey: 'amendment-source-version', statementType: 'amended_statement',
      partyId: claimantPartyId, documentVersionId: documentVersionIds[1]!,
      predecessorVersionId: null, preparedByUserId: ava.id,
      statementOfTruthStatus: 'signed', signatoryName: 'Ava Morgan',
      signatoryCapacity: 'Solicitor', signedAt: '2026-09-22T10:00:00.000Z',
      responsePosition: 'not_recorded', amendmentRoute: 'written_consent',
      amendmentReason: 'Correct the pleaded chronology from the retained source.',
    }, audit);
    const authority = store.recordAmendmentAuthority(
      ava, SEED_IDS.northstarMatter, proceedingId, statement.currentVersion!.id, {
        expectedVersion: 1, idempotencyKey: 'written-consent-authority',
        route: 'written_consent', consentDocumentVersionId: documentVersionIds[0]!,
        applicationId: null, sealedOrderId: null,
        reviewedAt: '2026-09-22T11:00:00.000Z',
        note: 'The exact written consent was reviewed and retained for this amendment.',
      }, audit,
    );
    expect(authority).toMatchObject({
      route: 'written_consent', consentDocumentVersionId: documentVersionIds[0],
      statementVersionId: statement.currentVersion!.id,
    });
    expect(store.getStatement(ava.firmId, SEED_IDS.northstarMatter, statement.id)?.amendmentAuthorities)
      .toEqual([expect.objectContaining({ id: authority.id })]);
  });

  it('records default review as a neutral append-only human checklist', () => {
    const track = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const review = store.createDefaultReview(
      ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
        idempotencyKey: 'default-review-create', statementVersionId: null,
        deadlineProjectionId: null, claimType: 'Part 7 money and remedy claim',
        requestedMethod: 'Court review required',
        note: 'The solicitor opened a source-backed default judgment review checklist.',
      }, audit,
    );
    expect(review.outcome).toBe('review_incomplete');
    const completed = store.completeDefaultReview(
      ava, SEED_IDS.northstarMatter, proceedingId, review.id, {
        expectedVersion: 1, idempotencyKey: 'default-review-blockers',
        outcome: 'blockers_recorded', reviewedAt: '2026-09-25T10:00:00.000Z',
        blockers: ['Part 12 exclusion question unresolved'],
        note: 'Human review recorded the unresolved exclusion question as a blocker.',
      }, audit,
    );
    expect(completed).toMatchObject({ outcome: 'blockers_recorded', version: 2 });
    expect(completed.events).toHaveLength(2);
    expect(JSON.stringify(completed)).not.toMatch(/eligible|entitled|safe to enter/i);
  });

  it('retains a reviewed deadline projection without overwriting its predecessor', () => {
    const track = store.openTrack(ava, SEED_IDS.northstarMatter, proceedingId, input(), audit);
    const first = store.reviewDeadline(ava, SEED_IDS.northstarMatter, proceedingId, track.id, {
      expectedVersion: 1, idempotencyKey: 'deadline-review-first', kind: 'defence',
      outcome: 'projected', triggerDate: '2026-09-14', projectedDate: '2026-10-12',
      sourceDocumentVersionId: null, ruleKey: 'cpr_15_4_aos_general',
      ruleVersion: 'reviewed-2026-07-18', sourceTitle: 'CPR Part 15',
      sourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15',
      reviewedAt: '2026-09-15T10:00:00.000Z',
      note: 'The solicitor reviewed the trigger facts and qualified projection source.',
    }, audit);
    expect(first).toMatchObject({ outcome: 'projected', projectedDate: '2026-10-12' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM pleading_deadline_projections').get())
      .toEqual({ count: 1 });
  });
});
