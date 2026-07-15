import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateLossItemInput,
  CreateLossScheduleInput,
  CreateOfferInput,
  CreateRepairEventInput,
  CreateWorkScheduleInput,
} from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { QuantumStore, QuantumStoreError } from './store.js';

const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z');
const context = {
  requestId: 'request-quantum-test',
  ipAddress: '127.0.0.1',
};

function user(
  id: string,
  role: SessionUser['role'],
  firmId: string = SEED_IDS.northstarFirm,
): SessionUser {
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
const finance = user(SEED_IDS.finance, 'finance');
const lewis = user(SEED_IDS.southbankUser, 'partner', SEED_IDS.southbankFirm);

const workSchedule: CreateWorkScheduleInput = {
  title: 'Synthetic solicitor schedule of works',
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
      sourceNote: 'Prepared from the synthetic attendance record and solicitor review.',
      defectIds: [SEED_IDS.bedroomDampDefect],
      evidenceItemIds: [SEED_IDS.repairEvidence],
    },
  ],
};

const lossSchedule: CreateLossScheduleInput = {
  title: 'Synthetic schedule of loss',
  valuationOn: '2026-07-15',
  currency: 'GBP',
  basedOnScheduleId: null,
  notes: 'Evaluation-only figures.',
};

const lossItem: CreateLossItemInput = {
  expectedVersion: 1,
  lineageKey: 'additional-heating-q1',
  category: 'additional_heating',
  description: 'Additional electric heating during the damp period.',
  periodStartOn: '2026-01-01',
  periodEndOn: '2026-03-31',
  calculationType: 'quantity_rate',
  quantity: '12.5',
  unitLabel: 'weeks',
  rateMinor: 425,
  fixedAmountMinor: null,
  manualAmountMinor: null,
  manualBasis: '',
  position: 'claimed',
  evidenceStatus: 'partial',
  sourceNote: 'Checked against the synthetic heating attendance record.',
  evidenceItemIds: [SEED_IDS.repairEvidence],
};

describe('QuantumStore', () => {
  let database: DatabaseSync;
  let store: QuantumStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new QuantumStore(database, () => FIXED_NOW);
  });

  afterEach(() => database.close());

  it('returns an empty tenant-safe workspace without protected terms', () => {
    expect(store.getWorkspace(ava, SEED_IDS.northstarMatter)).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canWrite: true },
      workSchedules: [],
      lossSchedules: [],
      generalDamagesReviews: [],
      openOffers: [],
      protectedOfferCount: 0,
    });
    expect(store.getWorkspace(ava, SEED_IDS.northstarRestrictedMatter)).toBeUndefined();
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(store.getWorkspace(finance, SEED_IDS.northstarMatter)?.permissions).toEqual({
      canWrite: false,
    });
  });

  it('creates and approves a source-linked work schedule atomically', () => {
    const created = store.createWorkSchedule(
      ava,
      SEED_IDS.northstarMatter,
      workSchedule,
      context,
    );
    expect(created).toMatchObject({
      scheduleVersion: 1,
      recordVersion: 1,
      status: 'draft',
      items: [
        expect.objectContaining({
          lineageKey: 'bedroom-damp-treatment',
          defectIds: [SEED_IDS.bedroomDampDefect],
          evidenceItemIds: [SEED_IDS.repairEvidence],
        }),
      ],
    });

    const approved = store.approveWorkSchedule(
      partner,
      SEED_IDS.northstarMatter,
      created.id,
      {
        expectedVersion: 1,
        idempotencyKey: 'approve-work-store-001',
        approvalNote: 'Partner reviewed the schedule against the retained source.',
        acknowledgedWarningKeys: ['urgent_outstanding'],
      },
      context,
    );
    expect(approved).toMatchObject({ status: 'approved', recordVersion: 2 });
    expect(() =>
      database.prepare("UPDATE work_items SET description = 'Rewritten' WHERE id = ?")
        .run(approved.items[0]!.id),
    ).toThrow(/immutable/);
    expect(
      database.prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE entity_type = 'work_schedule'",
      ).get(),
    ).toEqual({ count: 2 });
  });

  it('keeps approved schedule versions immutable when a revision is approved', () => {
    const first = store.createWorkSchedule(
      ava,
      SEED_IDS.northstarMatter,
      workSchedule,
      context,
    );
    const firstApproved = store.approveWorkSchedule(
      partner,
      SEED_IDS.northstarMatter,
      first.id,
      {
        expectedVersion: 1,
        idempotencyKey: 'approve-work-store-revision-001',
        approvalNote: 'Approved first immutable schedule version.',
        acknowledgedWarningKeys: [],
      },
      context,
    );
    const revision = store.createWorkSchedule(
      ava,
      SEED_IDS.northstarMatter,
      {
        ...workSchedule,
        title: 'Synthetic solicitor schedule of works — revision 2',
        basedOnScheduleId: firstApproved.id,
      },
      context,
    );

    const revisionApproved = store.approveWorkSchedule(
      partner,
      SEED_IDS.northstarMatter,
      revision.id,
      {
        expectedVersion: 1,
        idempotencyKey: 'approve-work-store-revision-002',
        approvalNote: 'Approved second immutable schedule version.',
        acknowledgedWarningKeys: [],
      },
      context,
    );

    expect(revisionApproved.status).toBe('approved');
    expect(
      store.getReadinessProjection(ava.firmId, SEED_IDS.northstarMatter)
        .currentWorkSchedule?.id,
    ).toBe(revisionApproved.id);
    expect(
      database
        .prepare('SELECT status FROM work_schedules WHERE id = ?')
        .get(firstApproved.id),
    ).toEqual({ status: 'approved' });
  });

  it('appends a repair event idempotently and rejects changed replay payloads', () => {
    const schedule = store.createWorkSchedule(
      ava,
      SEED_IDS.northstarMatter,
      workSchedule,
      context,
    );
    const input: CreateRepairEventInput = {
      idempotencyKey: 'repair-store-event-001',
      eventType: 'started',
      occurredAt: '2026-07-15T10:00:00.000Z',
      actorType: 'contractor',
      note: 'Synthetic contractor started the bedroom works.',
      appointmentFrom: null,
      appointmentTo: null,
      evidenceItemIds: [SEED_IDS.repairEvidence],
      verifier: '',
      supersedesEventId: null,
      correctionReason: '',
    };
    const first = store.appendRepairEvent(
      ava,
      SEED_IDS.northstarMatter,
      schedule.items[0]!.id,
      input,
      context,
    );
    const replay = store.appendRepairEvent(
      ava,
      SEED_IDS.northstarMatter,
      schedule.items[0]!.id,
      input,
      context,
    );
    expect(replay.id).toBe(first.id);
    expect(() =>
      store.appendRepairEvent(
        ava,
        SEED_IDS.northstarMatter,
        schedule.items[0]!.id,
        { ...input, note: 'A changed replay payload must be rejected.' },
        context,
      ),
    ).toThrowError(QuantumStoreError);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM repair_events').get(),
    ).toEqual({ count: 1 });
  });

  it('calculates loss lines on the server and approves a reproducible schedule', () => {
    const schedule = store.createLossSchedule(
      ava,
      SEED_IDS.northstarMatter,
      lossSchedule,
      context,
    );
    const withItem = store.addLossItem(
      ava,
      SEED_IDS.northstarMatter,
      schedule.id,
      lossItem,
      context,
    );
    expect(withItem).toMatchObject({
      recordVersion: 2,
      totals: {
        specialDamagesMinor: 5_313,
        evidenceGapCount: 1,
        unsupportedAmountMinor: 5_313,
      },
    });
    expect(withItem.items[0]).toMatchObject({
      calculatedAmountMinor: 5_313,
      calculation: '12.5 weeks × £4.25 = £53.13',
    });

    const approved = store.approveLossSchedule(
      partner,
      SEED_IDS.northstarMatter,
      schedule.id,
      {
        expectedVersion: 2,
        idempotencyKey: 'approve-loss-store-001',
        approvalNote: 'Partner reviewed the calculation and evidence gap.',
        acknowledgedEvidenceGapItemIds: [withItem.items[0]!.id],
      },
      context,
    );
    expect(approved.status).toBe('approved');
    expect(() =>
      store.addLossItem(
        ava,
        SEED_IDS.northstarMatter,
        schedule.id,
        { ...lossItem, expectedVersion: approved.recordVersion, lineageKey: 'late-line' },
        context,
      ),
    ).toThrowError(QuantumStoreError);
  });

  it('keeps protected offers out of the ordinary workspace', () => {
    const openOffer: CreateOfferInput = {
      idempotencyKey: 'open-offer-store-001',
      direction: 'defendant',
      offerType: 'protocol_compensation',
      confidentiality: 'open',
      scope: 'whole_claim',
      scopeDescription: 'Synthetic compensation proposal.',
      damagesMinor: 300_000,
      costsMinor: null,
      totalMinor: null,
      currency: 'GBP',
      worksTerms: 'Complete the synthetic works schedule.',
      nonMoneyTerms: '',
      interestTreatment: '',
      writtenOfferDocumentVersionId: null,
      madeOn: '2026-07-15',
      part36: null,
    };
    store.createOffer(ava, SEED_IDS.northstarMatter, openOffer, context);
    store.createOffer(
      ava,
      SEED_IDS.northstarMatter,
      {
        ...openOffer,
        idempotencyKey: 'protected-offer-store-001',
        offerType: 'wpsatc',
        confidentiality: 'protected_costs',
      },
      context,
    );

    const workspaceJson = JSON.stringify(
      store.getWorkspace(ava, SEED_IDS.northstarMatter),
    );
    expect(workspaceJson).toContain('open-offer-store-001');
    expect(workspaceJson).not.toContain('protected-offer-store-001');
    expect(store.getWorkspace(ava, SEED_IDS.northstarMatter)).toMatchObject({
      openOffers: [expect.objectContaining({ confidentiality: 'open' })],
      protectedOfferCount: 1,
    });
    expect(store.getProtectedOffers(partner, SEED_IDS.northstarMatter)).toHaveLength(1);
    expect(store.getProtectedOffers(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
  });
});
