import { describe, expect, it } from 'vitest';

import { projectMatterFinance } from './projections.js';

describe('matter finance projection', () => {
  it('shows unavailable cash positions rather than fabricated zero balances', () => {
    expect(projectMatterFinance({
      provisionalTime: [], approvedTime: [], disbursements: [], activeEstimate: null,
    })).toMatchObject({
      clientBalance: { state: 'not_connected' },
      officeBalance: { state: 'not_connected' },
      billed: { state: 'not_connected' },
      paid: { state: 'not_connected' },
      recovered: { state: 'not_connected' },
    });
  });

  it('keeps provisional time separate from approved WIP', () => {
    const projection = projectMatterFinance({
      provisionalTime: [
        { minutes: 18, estimatedChargeMinor: 7_200 },
        { minutes: 12, estimatedChargeMinor: null },
      ],
      approvedTime: [{ minutes: 37, chargeMinor: 14_800 }, { minutes: 12, chargeMinor: 4_000 }],
      disbursements: [],
      activeEstimate: null,
    });

    expect(projection.provisionalTime).toEqual({ minutes: 30, estimatedChargeMinor: 7_200, unpricedCount: 1, currency: 'GBP' });
    expect(projection.approvedWip).toEqual({ minutes: 49, amountMinor: 18_800, currency: 'GBP' });
  });

  it('projects disbursement states and estimate variance independently', () => {
    const projection = projectMatterFinance({
      provisionalTime: [],
      approvedTime: [{ minutes: 60, chargeMinor: 20_000 }],
      disbursements: [
        { id: 'd-1', status: 'proposed', grossMinor: 5_000 },
        { id: 'd-2', status: 'approved', grossMinor: 8_000 },
        { id: 'd-3', status: 'incurred', grossMinor: 7_000 },
        { id: 'd-4', status: 'paid_external', grossMinor: 3_000 },
        { id: 'd-5', status: 'cancelled', grossMinor: 9_000 },
      ],
      activeEstimate: { versionId: 'estimate-2', overallLimitMinor: 50_000 },
    });

    expect(projection.disbursements).toEqual({
      proposedMinor: 5_000,
      approvedExposureMinor: 18_000,
      cancelledMinor: 9_000,
      byStatus: { proposed: 5_000, approved: 8_000, incurred: 7_000, paid_external: 3_000, cancelled: 9_000 },
      currency: 'GBP',
    });
    expect(projection.estimate).toEqual({
      versionId: 'estimate-2', overallLimitMinor: 50_000,
      currentExposureMinor: 38_000, varianceMinor: 12_000, currency: 'GBP',
    });
  });

  it('rejects unsafe projection arithmetic', () => {
    expect(() => projectMatterFinance({
      provisionalTime: [],
      approvedTime: [
        { minutes: 1, chargeMinor: Number.MAX_SAFE_INTEGER },
        { minutes: 1, chargeMinor: 1 },
      ],
      disbursements: [], activeEstimate: null,
    })).toThrow(/safe integer range/i);
  });
});
