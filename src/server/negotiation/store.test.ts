import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateNegotiationReviewInput,
  CreateSettlementAuthorityVersionInput,
  RecordClientInstructionInput,
} from '../../shared/contracts.js';
import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { NegotiationStore } from './store.js';

const now = () => new Date('2026-08-20T12:00:00.000Z');
const audit = { requestId: 'negotiation-store-test', ipAddress: '127.0.0.1' };

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

const ben: SessionUser = {
  id: SEED_IDS.ben,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ben@northstar.test',
  name: 'Ben Foster',
  role: 'paralegal',
};

const lewis: SessionUser = {
  id: SEED_IDS.southbankUser,
  firmId: SEED_IDS.southbankFirm,
  firmName: 'Southbank Law',
  email: 'lewis@southbank.test',
  name: 'Lewis Grant',
  role: 'solicitor',
};

const reviewInput = (
  confidentiality: CreateNegotiationReviewInput['confidentiality'] = 'ordinary',
  idempotencyKey = 'negotiation-review-001',
): CreateNegotiationReviewInput => ({
  idempotencyKey,
  confidentiality,
  reviewedOn: '2026-08-20',
  reviewerUserId: null,
  selectedOfferIds: [],
  lossScheduleId: null,
  generalDamagesReviewId: null,
  workScheduleId: null,
  confirmedFacts: 'The reviewed position contains synthetic source facts only.',
  optionsExplained: 'Continue negotiating, counteroffer, reject or consider proceedings.',
  riskAnalysis: confidentiality === 'protected_negotiation'
    ? 'Protected settlement floor must never enter the ordinary workspace.'
    : 'The legal and evidential risks require a human solicitor decision.',
  costsFundingExplanation: 'Potential costs consequences and funding limits were explained.',
  humanRecommendation: 'Human recommendation recorded for evaluation only.',
  adviceLimitations: 'No legal validity or outcome is determined by SwiftClaim.',
  clientQuestions: '',
  supersedesReviewId: null,
  correctionReason: '',
});

const authorityInput = (
  idempotencyKey = 'settlement-authority-001',
): CreateSettlementAuthorityVersionInput => ({
  idempotencyKey,
  source: 'client_specific',
  scope: 'Specified synthetic counteroffer authority for this matter only.',
  actionTypes: ['counteroffer'],
  minimumAmountMinor: 250_000,
  maximumAmountMinor: 350_000,
  nonMoneyConstraints: 'Repairs remain included.',
  costsConstraints: 'Costs remain subject to separate agreement.',
  repairConstraints: 'Bathroom works require independent verification.',
  expiresAt: null,
  reviewOn: '2026-09-01',
  requiresClientInstruction: true,
  requiresPartnerApproval: true,
  sourceDocumentVersionId: null,
  reviewNote: 'Authority captured from the synthetic client instruction.',
});

describe('NegotiationStore', () => {
  let database: DatabaseSync;
  let store: NegotiationStore;
  let sourceCommunicationEntryId: string;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedCommunicationsEvaluation(database);
    sourceCommunicationEntryId = String((database.prepare(
      `SELECT id FROM communication_entries
       WHERE firm_id = ? AND matter_id = ? AND channel = 'telephone' LIMIT 1`,
    ).get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
    store = new NegotiationStore(database, now);
  });

  afterEach(() => database.close());

  it('creates one idempotent source-manifested review and operational records', () => {
    const first = store.createReview(ava, SEED_IDS.northstarMatter, reviewInput(), audit);
    const replay = store.createReview(ava, SEED_IDS.northstarMatter, reviewInput(), audit);

    expect(replay.id).toBe(first.id);
    expect(first.sourceManifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(database.prepare('SELECT COUNT(*) AS count FROM negotiation_reviews').get())
      .toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'negotiation.review_recorded'",
    ).get()).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'negotiation.review_recorded'",
    ).get()).toEqual({ count: 1 });
  });

  it('rejects idempotency-key reuse with a different payload', () => {
    store.createReview(ava, SEED_IDS.northstarMatter, reviewInput(), audit);
    expect(() => store.createReview(
      ava,
      SEED_IDS.northstarMatter,
      { ...reviewInput(), confirmedFacts: 'A materially different reviewed factual position.' },
      audit,
    )).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  });

  it('filters protected reviews and instructions before ordinary response assembly', () => {
    const ordinary = store.createReview(ava, SEED_IDS.northstarMatter, reviewInput(), audit);
    const protectedReview = store.createReview(
      ava,
      SEED_IDS.northstarMatter,
      reviewInput('protected_negotiation', 'negotiation-review-protected-001'),
      audit,
    );
    const instruction: RecordClientInstructionInput = {
      idempotencyKey: 'protected-instruction-001',
      confidentiality: 'protected_negotiation',
      reviewId: protectedReview.id,
      actionId: null,
      actionVersionId: null,
      instructionType: 'continue_negotiation',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Protected instruction content must remain outside ordinary responses.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T11:00:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'Information was explained verbally and checked back.',
      sourceCommunicationEntryId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    };
    store.recordInstruction(ava, SEED_IDS.northstarMatter, instruction, audit);

    const workspace = store.getWorkspace(ben, SEED_IDS.northstarMatter);
    expect(workspace?.reviews.map(({ id }) => id)).toEqual([ordinary.id]);
    expect(JSON.stringify(workspace)).not.toContain('Protected settlement floor');
    expect(JSON.stringify(workspace)).not.toContain('Protected instruction content');
    expect(workspace).not.toHaveProperty('protectedCount');

    const protectedWorkspace = store.getProtectedWorkspace(ava, SEED_IDS.northstarMatter);
    expect(protectedWorkspace.reviews).toEqual([
      expect.objectContaining({ id: protectedReview.id }),
    ]);
    expect(protectedWorkspace.instructions).toEqual([
      expect.objectContaining({ instructionType: 'continue_negotiation' }),
    ]);
  });

  it('returns generic absence for a cross-firm matter', () => {
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(() => store.createReview(lewis, SEED_IDS.northstarMatter, reviewInput(), audit))
      .toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('supersedes rather than updates client instructions', () => {
    const review = store.createReview(ava, SEED_IDS.northstarMatter, reviewInput(), audit);
    const first = store.recordInstruction(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'client-instruction-first-001',
      confidentiality: 'privileged',
      reviewId: review.id,
      actionId: null,
      actionVersionId: null,
      instructionType: 'continue_negotiation',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Continue negotiation while the proposed repairs are clarified.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T10:00:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'Information was explained verbally and checked back.',
      sourceCommunicationEntryId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    }, audit);
    const second = store.recordInstruction(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'client-instruction-second-001',
      confidentiality: 'privileged',
      reviewId: review.id,
      actionId: null,
      actionVersionId: null,
      instructionType: 'clarify',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Seek clarification of the proposed repair inspection term.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T11:00:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'Information was explained verbally and checked back.',
      sourceCommunicationEntryId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: first.id,
      correctionReason: 'Maya gave a later instruction after further explanation.',
      explicitClientInstruction: true,
    }, audit);

    expect(second.supersedesInstructionId).toBe(first.id);
    expect(database.prepare('SELECT COUNT(*) AS count FROM client_instructions').get())
      .toEqual({ count: 2 });
    expect(() => database.prepare('UPDATE client_instructions SET decision_note = ? WHERE id = ?')
      .run('Changed in place', first.id)).toThrow('client instructions are immutable');
  });

  it('projects the latest immutable authority version as current', () => {
    const first = store.createAuthorityVersion(
      ava,
      SEED_IDS.northstarMatter,
      authorityInput(),
      audit,
    );
    const second = store.createAuthorityVersion(
      ava,
      SEED_IDS.northstarMatter,
      {
        ...authorityInput('settlement-authority-002'),
        maximumAmountMinor: 400_000,
      },
      audit,
    );

    expect(first.version).toBe(1);
    expect(second).toMatchObject({ version: 2, supersedesAuthorityId: first.id });
    expect(store.getProtectedWorkspace(ava, SEED_IDS.northstarMatter).currentAuthority)
      .toMatchObject({ id: second.id, maximumAmountMinor: 400_000 });
  });
});
