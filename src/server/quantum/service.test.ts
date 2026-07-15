import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateLossItemInput,
  CreateOfferInput,
  CreateWorkScheduleInput,
} from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { QuantumError, QuantumService } from './service.js';
import { QuantumStore } from './store.js';

const now = () => new Date('2026-07-15T09:00:00.000Z');
const audit = { requestId: 'request-quantum-service', ipAddress: '127.0.0.1' };

function user(id: string, role: SessionUser['role'], firmId: string = SEED_IDS.northstarFirm): SessionUser {
  return {
    id,
    firmId,
    firmName: firmId === SEED_IDS.northstarFirm ? 'Northstar Legal' : 'Southbank Law',
    email: `${role}@example.test`,
    name: role,
    role,
  };
}

const ava = user(SEED_IDS.ava, 'solicitor');
const partner = user(SEED_IDS.partner, 'partner');
const paralegal = user(SEED_IDS.ben, 'paralegal');
const finance = user(SEED_IDS.finance, 'finance');
const lewis = user(SEED_IDS.southbankUser, 'partner', SEED_IDS.southbankFirm);

const workInput: CreateWorkScheduleInput = {
  title: 'Synthetic expert schedule of works',
  sourceType: 'solicitor_review',
  sourceDocumentVersionId: SEED_IDS.repairVersion,
  basedOnScheduleId: null,
  items: [
    {
      lineageKey: 'bedroom-damp-treatment',
      area: 'Bedroom',
      description: 'Treat the damp source and reinstate affected finishes.',
      responsibilityPosition: 'agreed',
      priority: 'urgent',
      targetStartOn: '2026-07-18',
      targetCompletionOn: '2026-07-25',
      estimatedCostMinor: 125_000,
      contractor: 'Synthetic Repairs Ltd',
      sourceNote: 'Prepared from retained synthetic material.',
      defectIds: [SEED_IDS.bedroomDampDefect],
      evidenceItemIds: [SEED_IDS.repairEvidence],
    },
  ],
};

const lossItem: CreateLossItemInput = {
  expectedVersion: 1,
  lineageKey: 'additional-heating-q1',
  category: 'additional_heating',
  description: 'Additional electric heating during the damp period.',
  periodStartOn: '2026-01-01',
  periodEndOn: '2026-03-31',
  calculationType: 'fixed',
  quantity: null,
  unitLabel: '',
  rateMinor: null,
  fixedAmountMinor: 5_000,
  manualAmountMinor: null,
  manualBasis: '',
  position: 'claimed',
  evidenceStatus: 'partial',
  sourceNote: 'Synthetic client figure with a retained sample record.',
  evidenceItemIds: [SEED_IDS.repairEvidence],
};

const protectedOffer: CreateOfferInput = {
  idempotencyKey: 'service-protected-offer-001',
  direction: 'defendant',
  offerType: 'part_36',
  confidentiality: 'protected_costs',
  scope: 'whole_claim',
  scopeDescription: 'All damages in the synthetic claim.',
  damagesMinor: 450_000,
  costsMinor: null,
  totalMinor: null,
  currency: 'GBP',
  worksTerms: 'Complete the agreed works within 28 days.',
  nonMoneyTerms: '',
  interestTreatment: 'Inclusive of interest to the relevant date.',
  writtenOfferDocumentVersionId: SEED_IDS.complaintVersion,
  madeOn: '2026-07-15',
  part36: {
    relevantPeriodDays: 21,
    relevantPeriodBasis: 'Reviewable CPR Part 36 calendar-day projection.',
    includesCounterclaim: false,
    paymentPeriodDays: 14,
  },
};

describe('QuantumService', () => {
  let database: DatabaseSync;
  let service: QuantumService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    service = new QuantumService(new QuantumStore(database, now), now);
  });

  afterEach(() => database.close());

  it('preserves generic non-disclosure before applying domain capabilities', () => {
    expect(() => service.getWorkspace(lewis, SEED_IDS.northstarMatter)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => service.getWorkspace(finance, SEED_IDS.northstarMatter)).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(service.getWorkspace(ava, SEED_IDS.northstarMatter).matterId).toBe(
      SEED_IDS.northstarMatter,
    );
  });

  it('allows preparation but reserves work-schedule approval and warning acknowledgement', () => {
    const schedule = service.createWorkSchedule(
      paralegal,
      SEED_IDS.northstarMatter,
      workInput,
      audit,
    );
    expect(() =>
      service.approveWorkSchedule(
        paralegal,
        SEED_IDS.northstarMatter,
        schedule.id,
        {
          expectedVersion: 1,
          idempotencyKey: 'service-work-approve-001',
          approvalNote: 'Paralegal must not be able to approve this schedule.',
          acknowledgedWarningKeys: ['urgent_outstanding'],
        },
        audit,
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    expect(() =>
      service.approveWorkSchedule(
        partner,
        SEED_IDS.northstarMatter,
        schedule.id,
        {
          expectedVersion: 1,
          idempotencyKey: 'service-work-approve-002',
          approvalNote: 'Partner attempted approval without warning acknowledgement.',
          acknowledgedWarningKeys: [],
        },
        audit,
      ),
    ).toThrowError(expect.objectContaining({ code: 'APPROVAL_BLOCKED' }));

    expect(
      service.approveWorkSchedule(
        partner,
        SEED_IDS.northstarMatter,
        schedule.id,
        {
          expectedVersion: 1,
          idempotencyKey: 'service-work-approve-003',
          approvalNote: 'Partner reviewed the urgent outstanding-work warning.',
          acknowledgedWarningKeys: ['urgent_outstanding'],
        },
        audit,
      ).status,
    ).toBe('approved');
  });

  it('requires every evidence gap to be acknowledged before loss approval', () => {
    const schedule = service.createLossSchedule(
      ava,
      SEED_IDS.northstarMatter,
      {
        title: 'Synthetic schedule of loss',
        valuationOn: '2026-07-15',
        currency: 'GBP',
        basedOnScheduleId: null,
        notes: 'Evaluation only.',
      },
      audit,
    );
    const withItem = service.addLossItem(
      ava,
      SEED_IDS.northstarMatter,
      schedule.id,
      lossItem,
      audit,
    );
    expect(() =>
      service.approveLossSchedule(
        partner,
        SEED_IDS.northstarMatter,
        schedule.id,
        {
          expectedVersion: 2,
          idempotencyKey: 'service-loss-approve-001',
          approvalNote: 'The evidence gap has not been acknowledged.',
          acknowledgedEvidenceGapItemIds: [],
        },
        audit,
      ),
    ).toThrowError(expect.objectContaining({ code: 'APPROVAL_BLOCKED' }));

    expect(
      service.approveLossSchedule(
        partner,
        SEED_IDS.northstarMatter,
        schedule.id,
        {
          expectedVersion: 2,
          idempotencyKey: 'service-loss-approve-002',
          approvalNote: 'Partner reviewed and acknowledged the partial evidence.',
          acknowledgedEvidenceGapItemIds: [withItem.items[0]!.id],
        },
        audit,
      ).status,
    ).toBe('approved');
  });

  it('rejects an unsubstantiated verified-completion command before persistence', () => {
    const schedule = service.createWorkSchedule(
      ava,
      SEED_IDS.northstarMatter,
      workInput,
      audit,
    );
    expect(() =>
      service.recordRepairEvent(
        ava,
        SEED_IDS.northstarMatter,
        schedule.items[0]!.id,
        {
          idempotencyKey: 'service-repair-verify-001',
          eventType: 'verified_complete',
          occurredAt: '2026-07-15T10:00:00.000Z',
          actorType: 'expert',
          note: 'Purported verification without a retained source.',
          appointmentFrom: null,
          appointmentTo: null,
          evidenceItemIds: [],
          verifier: '',
          supersedesEventId: null,
          correctionReason: '',
        },
        audit,
      ),
    ).toThrowError(expect.objectContaining({ code: 'APPROVAL_BLOCKED' }));
    expect(database.prepare('SELECT COUNT(*) AS count FROM repair_events').get()).toEqual({
      count: 0,
    });
  });

  it('segregates protected offers and produces a review-labelled relevant-period date', () => {
    const offer = service.createOffer(
      ava,
      SEED_IDS.northstarMatter,
      protectedOffer,
      audit,
    );
    expect(JSON.stringify(service.getWorkspace(ava, SEED_IDS.northstarMatter))).not.toContain(
      '450000',
    );
    expect(() =>
      service.getProtectedOffers(paralegal, SEED_IDS.northstarMatter),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(service.getProtectedOffers(ava, SEED_IDS.northstarMatter)).toHaveLength(1);

    const reviewed = service.reviewPart36(
      ava,
      SEED_IDS.northstarMatter,
      offer.id,
      {
        expectedVersion: 1,
        idempotencyKey: 'service-part36-review-001',
        serviceOn: '2026-07-16',
        serviceConfirmed: true,
        validationStatus: 'reviewed',
        validationNote: 'Solicitor reviewed the retained writing and service evidence.',
      },
      audit,
    );
    expect(reviewed.part36).toMatchObject({
      projectedPeriodEndOn: '2026-08-06',
      validationStatus: 'reviewed',
      calculationExplanation: expect.stringContaining('projection'),
    });
  });

  it('never treats recording acceptance as external communication', () => {
    const offer = service.createOffer(
      ava,
      SEED_IDS.northstarMatter,
      protectedOffer,
      audit,
    );
    const updated = service.recordOfferEvent(
      ava,
      SEED_IDS.northstarMatter,
      offer.id,
      {
        idempotencyKey: 'service-offer-event-001',
        eventType: 'accepted',
        occurredAt: '2026-07-20T10:00:00.000Z',
        note: 'Written client-authorised acceptance retained on the synthetic file.',
        sourceDocumentVersionId: SEED_IDS.complaintVersion,
        supersedesEventId: null,
        correctionReason: '',
        explicitConfirmation: true,
      },
      audit,
    );
    expect(updated.events.at(-1)).toMatchObject({ eventType: 'accepted' });
    expect(
      database.prepare(
        "SELECT COUNT(*) AS count FROM integration_outbox WHERE topic LIKE '%send%' OR topic LIKE '%dispatch%'",
      ).get(),
    ).toEqual({ count: 0 });
  });
});
