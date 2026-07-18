import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from '../proceedings/store.js';
import { DisclosureStore } from './store.js';

const now = () => new Date('2026-10-01T10:00:00.000Z');
const audit = { requestId: 'disclosure-store-test', ipAddress: '127.0.0.1' };
const ava: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};

describe('DisclosureStore', () => {
  let database: DatabaseSync;
  let store: DisclosureStore;
  let proceedingId: string;
  let partyId: string;
  let documentVersionId: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    proceedingId = new ProceedingsStore(database, now).createProceeding(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'disclosure-test-proceeding', procedureType: 'part7',
      jurisdiction: 'england_wales', courtName: 'County Court', courtCode: null, hearingCentre: null,
    }, audit).id;
    partyId = String((database.prepare(`SELECT id FROM parties WHERE firm_id = ? AND matter_id = ? AND kind = 'client'`)
      .get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    documentVersionId = String((database.prepare(`SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY dv.created_at LIMIT 1`)
      .get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    store = new DisclosureStore(database, now);
  });

  afterEach(() => database.close());

  const reviewInput = () => ({
    idempotencyKey: 'open-disclosure-review-001', disclosingPartyId: partyId,
    directionId: null, scopeNote: 'Review the retained repair and notice records against the pleaded housing issues.',
    dateFrom: null, dateTo: null, custodians: ['Maya Clarke'], issueTags: ['repairs', 'notice'],
  });

  it('atomically opens one replay-safe review and operational records', () => {
    const first = store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit);
    expect(store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit)).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS count FROM disclosure_reviews').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM disclosure_review_events').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM disclosure_command_receipts').get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'disclosure.review_opened'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'disclosure.review_opened'").get()).toEqual({ count: 1 });
  });

  it('conflicts when an idempotency key is reused with changed input', () => {
    store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit);
    expect(() => store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, {
      ...reviewInput(), scopeNote: 'A changed disclosure scope note that must conflict with the retained receipt.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  });

  it('never returns another firm review by UUID', () => {
    const review = store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit);
    expect(store.getReview(SEED_IDS.southbankFirm, SEED_IDS.northstarMatter, review.id)).toBeUndefined();
    expect(store.getWorkspace(SEED_IDS.southbankFirm, SEED_IDS.northstarMatter, proceedingId)).toBeUndefined();
  });

  it('retains an exact candidate and immutable provisional AI suggestion', () => {
    const review = store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit);
    const candidate = store.addCandidate(ava, SEED_IDS.northstarMatter, proceedingId, review.id, {
      expectedVersion: 1, idempotencyKey: 'add-disclosure-candidate-001', documentVersionId,
      evidenceItemId: null, custodian: 'Maya Clarke', sourceNote: 'Exact retained repair document selected for disclosure review.',
    }, audit);
    const suggestion = store.recordAiSuggestion(ava, SEED_IDS.northstarMatter, proceedingId, candidate.id, {
      idempotencyKey: 'candidate-ai-suggestion-001', relevance: 'likely_relevant', privilegeWarning: 'none',
      rationale: 'Repair issue terms were detected and require human disclosure review.',
      model: 'evaluation-local-v1', policyVersion: 'disclosure-evaluation-v1', sourceHash: 'a'.repeat(64),
      citedSpans: ['repair'], suggestedIssueTags: ['repairs'],
    }, audit);
    expect(suggestion).toMatchObject({ relevance: 'likely_relevant', provisional: true });
    expect(store.getWorkspace(ava.firmId, SEED_IDS.northstarMatter, proceedingId)?.reviews[0]?.candidates[0])
      .toMatchObject({ id: candidate.id, documentVersionId, projection: { state: 'human_review_required' } });
  });

  it('rejects a candidate document outside the scoped matter', () => {
    const review = store.openReview(ava, SEED_IDS.northstarMatter, proceedingId, reviewInput(), audit);
    expect(() => store.addCandidate(ava, SEED_IDS.northstarMatter, proceedingId, review.id, {
      expectedVersion: 1, idempotencyKey: 'bad-disclosure-candidate',
      documentVersionId: '93000000-0000-4000-8000-000000000099', evidenceItemId: null,
      custodian: '', sourceNote: 'This cross-matter source must be rejected by exact source validation.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_LINK' }));
  });
});
