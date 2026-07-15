import { describe, expect, it } from 'vitest';

import {
  approveLossScheduleSchema,
  approveWorkScheduleSchema,
  createGeneralDamagesReviewSchema,
  createLossItemSchema,
  createOfferSchema,
  createRepairEventSchema,
  createWorkScheduleSchema,
  recordOfferEventSchema,
  reviewPart36Schema,
} from '../shared/contracts.js';

const id = (suffix: string) =>
  `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('repairs and quantum command contracts', () => {
  it('accepts a source-linked schedule while keeping money integral', () => {
    const input = {
      title: 'Synthetic expert schedule of works',
      sourceType: 'expert_report',
      sourceDocumentVersionId: id('1'),
      basedOnScheduleId: null,
      items: [
        {
          lineageKey: 'bedroom-damp-treatment',
          area: 'Bedroom',
          description: 'Treat penetrating damp and reinstate finishes.',
          responsibilityPosition: 'agreed',
          priority: 'urgent',
          targetStartOn: '2026-07-20',
          targetCompletionOn: '2026-07-27',
          estimatedCostMinor: 125_000,
          contractor: 'Synthetic contractor',
          sourceNote: 'Paragraph 14 of the synthetic expert report.',
          defectIds: [id('2')],
          evidenceItemIds: [id('3')],
        },
      ],
    };

    expect(createWorkScheduleSchema.safeParse(input).success).toBe(true);
    expect(
      createWorkScheduleSchema.safeParse({
        ...input,
        items: [{ ...input.items[0], estimatedCostMinor: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it('requires explicit review acknowledgements to approve schedules', () => {
    expect(
      approveWorkScheduleSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: 'approve-works-001',
        approvalNote: 'Reviewed against the signed expert report.',
        acknowledgedWarningKeys: ['urgent_outstanding'],
      }).success,
    ).toBe(true);
    expect(
      approveLossScheduleSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: 'approve-losses-001',
        approvalNote: 'Reviewed against receipts and client instructions.',
        acknowledgedEvidenceGapItemIds: [id('5')],
      }).success,
    ).toBe(true);
  });

  it('requires completion evidence and a verifier for verified repair events', () => {
    const base = {
      idempotencyKey: 'repair-event-001',
      eventType: 'verified_complete',
      occurredAt: '2026-07-15T09:00:00.000Z',
      actorType: 'expert',
      note: 'Works inspected after completion.',
      appointmentFrom: null,
      appointmentTo: null,
      evidenceItemIds: [],
      verifier: '',
      supersedesEventId: null,
      correctionReason: '',
    };
    expect(createRepairEventSchema.safeParse(base).success).toBe(false);
    expect(
      createRepairEventSchema.safeParse({
        ...base,
        evidenceItemIds: [id('4')],
        verifier: 'A. Surveyor MRICS',
      }).success,
    ).toBe(true);
  });

  it('accepts exact quantity text and rejects client-calculated totals', () => {
    const input = {
      expectedVersion: 1,
      lineageKey: 'heating-2026-q1',
      category: 'additional_heating',
      description: 'Additional electric heating during damp period.',
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
      sourceNote: 'Client schedule checked against sample bills.',
      evidenceItemIds: [id('6')],
    };
    expect(createLossItemSchema.safeParse(input).success).toBe(true);
    expect(
      createLossItemSchema.safeParse({ ...input, amountMinor: 9_999 }).success,
    ).toBe(false);
    expect(
      createLossItemSchema.safeParse({ ...input, quantity: '12.55555' }).success,
    ).toBe(false);
  });

  it('keeps general damages a human reviewed range with a substantive basis', () => {
    expect(
      createGeneralDamagesReviewSchema.safeParse({
        idempotencyKey: 'general-damages-001',
        valuationOn: '2026-07-15',
        lowMinor: 200_000,
        highMinor: 350_000,
        preferredMinor: 275_000,
        basis: 'Solicitor review of the synthetic evidence and recorded duration.',
        authorities: ['Human-entered internal reference; verify before use'],
        evidenceItemIds: [id('7')],
        reviewNote: 'Evaluation-only valuation requiring live legal review.',
        supersedesReviewId: null,
        nonePresentlyAdvanced: false,
      }).success,
    ).toBe(true);
    expect(
      createGeneralDamagesReviewSchema.safeParse({
        idempotencyKey: 'general-damages-002',
        valuationOn: '2026-07-15',
        lowMinor: 400_000,
        highMinor: 350_000,
        preferredMinor: null,
        basis: 'Reviewed range is inverted and must be rejected.',
        authorities: [],
        evidenceItemIds: [],
        reviewNote: 'Rejected example only.',
        supersedesReviewId: null,
        nonePresentlyAdvanced: false,
      }).success,
    ).toBe(false);
  });

  it('requires protected confidentiality and Part 36 terms for a Part 36 offer', () => {
    const input = {
      idempotencyKey: 'offer-create-001',
      direction: 'defendant',
      offerType: 'part_36',
      confidentiality: 'protected_costs',
      scope: 'whole_claim',
      scopeDescription: 'All damages in the synthetic claim.',
      damagesMinor: 450_000,
      costsMinor: null,
      totalMinor: null,
      currency: 'GBP',
      worksTerms: 'Complete the agreed schedule within 28 days.',
      nonMoneyTerms: '',
      interestTreatment: 'Inclusive of interest to the relevant date.',
      writtenOfferDocumentVersionId: id('8'),
      madeOn: '2026-07-15',
      part36: {
        relevantPeriodDays: 21,
        relevantPeriodBasis: 'CPR Part 36 review required.',
        includesCounterclaim: false,
        paymentPeriodDays: 14,
      },
    };
    expect(createOfferSchema.safeParse(input).success).toBe(true);
    expect(
      createOfferSchema.safeParse({
        ...input,
        confidentiality: 'open',
      }).success,
    ).toBe(false);
  });

  it('records offer outcomes as retained events and requires review before Part 36 validity', () => {
    expect(
      recordOfferEventSchema.safeParse({
        idempotencyKey: 'offer-event-001',
        eventType: 'accepted',
        occurredAt: '2026-07-20T10:00:00.000Z',
        note: 'Written client-authorised acceptance retained on file.',
        sourceDocumentVersionId: id('9'),
        supersedesEventId: null,
        correctionReason: '',
        explicitConfirmation: true,
      }).success,
    ).toBe(true);
    expect(
      reviewPart36Schema.safeParse({
        expectedVersion: 1,
        idempotencyKey: 'part36-review-001',
        serviceOn: '2026-07-16',
        serviceConfirmed: true,
        validationStatus: 'reviewed',
        validationNote: 'Solicitor reviewed the written terms and service evidence.',
      }).success,
    ).toBe(true);
  });
});
