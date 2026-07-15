import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProtectedOffer, RepairsQuantumWorkspace } from '../../api.js';
import { RepairsQuantumPanel } from './RepairsQuantumPanel.js';

const workspace = {
  matterId: 'matter-1',
  permissions: {
    canWrite: true,
    canApprove: true,
    canWriteOffers: true,
    canReadProtectedOffers: true,
    canRecordOfferOutcome: true,
  },
  workSchedules: [
    {
      id: 'works-1',
      scheduleVersion: 1,
      recordVersion: 2,
      title: 'Synthetic expert schedule',
      sourceType: 'expert_report',
      sourceDocumentVersionId: 'document-version-1',
      status: 'approved',
      basedOnScheduleId: null,
      approvalNote: 'Reviewed.',
      acknowledgedWarningKeys: ['completion_disputed'],
      createdBy: 'user-1',
      createdAt: '2026-07-15T09:00:00.000Z',
      approvedBy: 'partner-1',
      approvedAt: '2026-07-15T10:00:00.000Z',
      items: [
        {
          id: 'work-item-1',
          lineageKey: 'bedroom-damp',
          area: 'Bedroom',
          description: 'Treat damp and reinstate finishes.',
          responsibilityPosition: 'agreed',
          priority: 'urgent',
          targetStartOn: '2026-07-18',
          targetCompletionOn: '2026-07-25',
          estimatedCostMinor: 125_000,
          currency: 'GBP',
          contractor: 'Synthetic Repairs Ltd',
          sourceNote: 'Synthetic report paragraph 14.',
          displayPosition: 0,
          defectIds: ['defect-1'],
          evidenceItemIds: ['evidence-1'],
          repairEvents: [],
          projection: {
            status: 'completion_asserted',
            producingEventId: 'event-1',
            lastAccessOutcome: 'provided',
            completionAsserted: true,
            clientPosition: 'disputed',
            verification: 'not_verified',
            warnings: [
              {
                key: 'completion_disputed',
                detail: 'The client disputes the asserted completion.',
              },
            ],
          },
        },
        {
          id: 'work-item-2',
          lineageKey: 'bathroom-seal',
          area: 'Bathroom',
          description: 'Renew bath seal and affected finishes.',
          responsibilityPosition: 'agreed',
          priority: 'routine',
          targetStartOn: '2026-07-18',
          targetCompletionOn: '2026-07-25',
          estimatedCostMinor: 25_000,
          currency: 'GBP',
          contractor: 'Synthetic Repairs Ltd',
          sourceNote: 'Synthetic report paragraph 18.',
          displayPosition: 1,
          defectIds: ['defect-2'],
          evidenceItemIds: ['evidence-2'],
          repairEvents: [],
          projection: {
            status: 'verified_complete',
            producingEventId: 'event-2',
            lastAccessOutcome: 'provided',
            completionAsserted: true,
            clientPosition: 'accepted',
            verification: 'verified',
            warnings: [],
          },
        },
      ],
    },
  ],
  lossSchedules: [
    {
      id: 'losses-1',
      scheduleVersion: 1,
      recordVersion: 3,
      title: 'Synthetic schedule of loss',
      status: 'approved',
      basedOnScheduleId: null,
      valuationOn: '2026-07-15',
      currency: 'GBP',
      notes: 'Evaluation only.',
      approvalNote: 'Reviewed.',
      acknowledgedEvidenceGapItemIds: ['loss-item-1'],
      createdBy: 'user-1',
      createdAt: '2026-07-15T09:00:00.000Z',
      approvedBy: 'partner-1',
      approvedAt: '2026-07-15T10:00:00.000Z',
      items: [
        {
          id: 'loss-item-1',
          recordVersion: 1,
          lineageKey: 'heating',
          category: 'additional_heating',
          description: 'Additional electric heating.',
          periodStartOn: '2026-01-01',
          periodEndOn: '2026-03-31',
          calculationType: 'quantity_rate',
          quantity: '12.5',
          unitLabel: 'weeks',
          rateMinor: 425,
          fixedAmountMinor: null,
          manualAmountMinor: null,
          manualBasis: '',
          calculatedAmountMinor: 5_313,
          calculation: '12.5 weeks × £4.25 = £53.13',
          currency: 'GBP',
          position: 'claimed',
          evidenceStatus: 'partial',
          sourceNote: 'Client figure checked against sample records.',
          displayPosition: 0,
          evidenceItemIds: ['evidence-1'],
        },
      ],
      totals: {
        specialDamagesMinor: 5_313,
        byPosition: { claimed: 5_313, accepted: 0, disputed: 0, withdrawn: 0 },
        byCategory: { additional_heating: 5_313 },
        evidenceGapCount: 1,
        unsupportedAmountMinor: 5_313,
        generalDamages: { lowMinor: 200_000, highMinor: 350_000, preferredMinor: 275_000 },
        combined: { lowMinor: 205_313, highMinor: 355_313 },
      },
    },
  ],
  generalDamagesReviews: [
    {
      id: 'review-1',
      valuationOn: '2026-07-15',
      lowMinor: 200_000,
      highMinor: 350_000,
      preferredMinor: 275_000,
      currency: 'GBP',
      basis: 'Human solicitor review of synthetic evidence.',
      authorities: ['Verify before use'],
      reviewNote: 'Evaluation only.',
      nonePresentlyAdvanced: false,
      supersedesReviewId: null,
      reviewedBy: 'partner-1',
      reviewedAt: '2026-07-15T10:00:00.000Z',
    },
  ],
  openOffers: [
    {
      id: 'offer-open-1',
      offerReference: 'OFFER-001',
      recordVersion: 1,
      direction: 'defendant',
      offerType: 'protocol_compensation',
      confidentiality: 'open',
      scope: 'whole_claim',
      scopeDescription: 'All damages.',
      damagesMinor: 300_000,
      costsMinor: null,
      totalMinor: null,
      currency: 'GBP',
      worksTerms: 'Complete the agreed works.',
      nonMoneyTerms: '',
      interestTreatment: '',
      writtenOfferDocumentVersionId: null,
      madeOn: '2026-07-15',
      idempotencyKey: 'offer-open-1',
      createdBy: 'user-1',
      createdAt: '2026-07-15T09:00:00.000Z',
      part36: null,
      events: [],
    },
  ],
  protectedOfferCount: 1,
  readiness: {
    controls: [
      { key: 'works_status_reviewed', eligible: true, explanation: 'Reviewed.' },
      { key: 'damages_schedule_reviewed', eligible: true, explanation: 'Reviewed.' },
    ],
  },
} as unknown as RepairsQuantumWorkspace;

const protectedOffers = [
  {
    id: 'offer-protected-1',
    offerReference: 'OFFER-002',
    recordVersion: 1,
    direction: 'defendant',
    offerType: 'part_36',
    confidentiality: 'protected_costs',
    scope: 'whole_claim',
    scopeDescription: 'All damages.',
    damagesMinor: 450_000,
    costsMinor: null,
    totalMinor: null,
    currency: 'GBP',
    worksTerms: 'Complete agreed works.',
    nonMoneyTerms: '',
    interestTreatment: 'Inclusive of interest.',
    writtenOfferDocumentVersionId: 'document-1',
    madeOn: '2026-07-15',
    idempotencyKey: 'offer-protected-1',
    createdBy: 'user-1',
    createdAt: '2026-07-15T09:00:00.000Z',
    part36: {
      relevantPeriodDays: 21,
      relevantPeriodBasis: 'Solicitor review required.',
      serviceOn: '2026-07-16',
      serviceConfirmed: true,
      projectedPeriodEndOn: '2026-08-06',
      calculationExplanation: '21-calendar-day projection; solicitor review required.',
      includesCounterclaim: false,
      paymentPeriodDays: 14,
      validationStatus: 'reviewed',
      validationNote: 'Reviewed.',
    },
    events: [],
  },
] as unknown as ProtectedOffer[];

describe('RepairsQuantumPanel', () => {
  it('distinguishes repair assertions, client disputes and verification', () => {
    render(
      <RepairsQuantumPanel
        matterId="matter-1"
        workspace={workspace}
        onRefresh={vi.fn()}
        loadProtectedOffers={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Repairs & quantum' })).toBeInTheDocument();
    expect(screen.getByText('Completion asserted')).toBeInTheDocument();
    expect(screen.getByText('Client disputes completion')).toBeInTheDocument();
    expect(screen.getByText('Verified complete')).toBeInTheDocument();
    expect(screen.getByText('The client disputes the asserted completion.')).toBeInTheDocument();
  });

  it('shows reproducible loss calculations and human valuation provenance', async () => {
    const user = userEvent.setup();
    render(
      <RepairsQuantumPanel
        matterId="matter-1"
        workspace={workspace}
        onRefresh={vi.fn()}
        loadProtectedOffers={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Quantum' }));
    expect(screen.getByText('12.5 weeks × £4.25 = £53.13')).toBeInTheDocument();
    expect(screen.getByText('Partial evidence')).toBeInTheDocument();
    expect(screen.getAllByText('£2,000.00–£3,500.00')).toHaveLength(2);
    expect(screen.getByText('Human solicitor review of synthetic evidence.')).toBeInTheDocument();
    expect(screen.getByText(/SwiftClaim did not generate this valuation/i)).toBeInTheDocument();
  });

  it('loads protected offers only after an explicit authorised action', async () => {
    const user = userEvent.setup();
    const loadProtectedOffers = vi.fn().mockResolvedValue(protectedOffers);
    render(
      <RepairsQuantumPanel
        matterId="matter-1"
        workspace={workspace}
        onRefresh={vi.fn()}
        loadProtectedOffers={loadProtectedOffers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Offers' }));
    expect(screen.getByText('£3,000.00')).toBeInTheDocument();
    expect(screen.queryByText('£4,500.00')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open 1 protected offer/i }));
    expect(loadProtectedOffers).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('£4,500.00')).toBeInTheDocument();
    expect(screen.getByText(/legal validity and effect require solicitor review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send|accept automatically/i })).not.toBeInTheDocument();
  });

  it('hides mutation actions from a read-only workspace', () => {
    render(
      <RepairsQuantumPanel
        matterId="matter-1"
        workspace={{
          ...workspace,
          permissions: {
            canWrite: false,
            canApprove: false,
            canWriteOffers: false,
            canReadProtectedOffers: false,
            canRecordOfferOutcome: false,
          },
        }}
        onRefresh={vi.fn()}
        loadProtectedOffers={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /record repair event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve schedule/i })).not.toBeInTheDocument();
  });
});
