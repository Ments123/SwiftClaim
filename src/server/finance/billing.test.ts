import { describe, expect, it } from 'vitest';

import {
  BillingProjectionError,
  projectBill,
  projectBillRegister,
  projectCreditImpact,
  projectWipEligibility,
  type BillProjectionInput,
} from './billing.js';

const version = {
  id: 'bill-version-1', versionNumber: 1, dueOn: '2026-08-20',
  netMinor: 60_300, vatMinor: 2_960, grossMinor: 63_260, currency: 'GBP' as const,
  lines: [
    { id: 'line-time', sourceKind: 'time' as const, sourceId: 'time-1', netMinor: 14_800, vatMinor: 2_960, grossMinor: 17_760 },
    { id: 'line-fee', sourceKind: 'disbursement' as const, sourceId: 'disbursement-1', netMinor: 45_500, vatMinor: 0, grossMinor: 45_500 },
  ],
};

function input(overrides: Partial<BillProjectionInput> = {}): BillProjectionInput {
  return {
    billId: 'bill-1', versions: [version], events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
    ], payments: [], credits: [], ...overrides,
  };
}

describe('immutable bill projections', () => {
  it('projects lifecycle in causal sequence and binds approval and issue to one exact version', () => {
    expect(projectBill(input({ events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
      { sequence: 2, eventType: 'submitted', billVersionId: version.id, occurredAt: '2026-07-21T09:15:00.000Z' },
      { sequence: 3, eventType: 'approved', billVersionId: version.id, occurredAt: '2026-07-21T09:30:00.000Z' },
      { sequence: 4, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000001' },
      { sequence: 5, eventType: 'delivered', billVersionId: version.id, occurredAt: '2026-07-21T10:05:00.000Z' },
    ]}))).toMatchObject({
      status: 'delivered', billReference: 'SC-2026-000001', issuedVersionId: version.id,
      netMinor: 60_300, vatMinor: 2_960, grossMinor: 63_260, outstandingMinor: 63_260,
    });
  });

  it('does not consume draft sources and consumes only issued allocations', () => {
    expect(projectWipEligibility({ approvedMinor: 14_800, allocations: [
      { amountMinor: 14_800, billIssued: false },
    ] })).toEqual({ eligibleMinor: 14_800, issuedAllocatedMinor: 0 });
    expect(projectWipEligibility({ approvedMinor: 14_800, allocations: [
      { amountMinor: 14_800, billIssued: true },
    ] })).toEqual({ eligibleMinor: 0, issuedAllocatedMinor: 14_800 });
  });

  it('projects partial payment and issued credits without rewriting original totals', () => {
    const projected = projectBill(input({
      events: [
        { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
        { sequence: 2, eventType: 'submitted', billVersionId: version.id, occurredAt: '2026-07-21T09:15:00.000Z' },
        { sequence: 3, eventType: 'approved', billVersionId: version.id, occurredAt: '2026-07-21T09:30:00.000Z' },
        { sequence: 4, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000001' },
      ],
      payments: [{ amountMinor: 20_000, posted: true }],
      credits: [{ grossMinor: 5_000, issued: true }],
    }));
    expect(projected).toMatchObject({
      status: 'part_paid', grossMinor: 63_260, creditedMinor: 5_000,
      allocatedMinor: 20_000, outstandingMinor: 38_260,
    });
  });

  it('rejects issue without exact-version approval and cancellation after issue', () => {
    expect(() => projectBill(input({ events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
      { sequence: 2, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000001' },
    ]}))).toThrow('An issued bill requires approval of the exact issued version.');
    expect(() => projectBill(input({ events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
      { sequence: 2, eventType: 'submitted', billVersionId: version.id, occurredAt: '2026-07-21T09:15:00.000Z' },
      { sequence: 3, eventType: 'approved', billVersionId: version.id, occurredAt: '2026-07-21T09:30:00.000Z' },
      { sequence: 4, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000001' },
      { sequence: 5, eventType: 'cancelled', billVersionId: version.id, occurredAt: '2026-07-21T11:00:00.000Z' },
    ]}))).toThrow(BillingProjectionError);
  });

  it('rejects a second issue event that attempts to replace the immutable reference', () => {
    expect(() => projectBill(input({ events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
      { sequence: 2, eventType: 'submitted', billVersionId: version.id, occurredAt: '2026-07-21T09:15:00.000Z' },
      { sequence: 3, eventType: 'approved', billVersionId: version.id, occurredAt: '2026-07-21T09:30:00.000Z' },
      { sequence: 4, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000001' },
      { sequence: 5, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:01:00.000Z', billReference: 'SC-2026-000002' },
    ]}))).toThrow('A bill can be issued only once.');
  });

  it('prevents credits from exceeding each original issued line', () => {
    expect(projectCreditImpact({ originalGrossMinor: 17_760, priorIssuedCreditsMinor: 5_000, proposedGrossMinor: 12_760 }))
      .toEqual({ remainingBeforeMinor: 12_760, remainingAfterMinor: 0 });
    expect(() => projectCreditImpact({ originalGrossMinor: 17_760, priorIssuedCreditsMinor: 5_000, proposedGrossMinor: 12_761 }))
      .toThrow('Credit exceeds the remaining issued bill line value.');
  });

  it('sorts the central register by issue sequence rather than mutable display status', () => {
    const issued = projectBill(input({ events: [
      { sequence: 1, eventType: 'prepared', billVersionId: version.id, occurredAt: '2026-07-21T09:00:00.000Z' },
      { sequence: 2, eventType: 'submitted', billVersionId: version.id, occurredAt: '2026-07-21T09:15:00.000Z' },
      { sequence: 3, eventType: 'approved', billVersionId: version.id, occurredAt: '2026-07-21T09:30:00.000Z' },
      { sequence: 4, eventType: 'issued', billVersionId: version.id, occurredAt: '2026-07-21T10:00:00.000Z', billReference: 'SC-2026-000002' },
    ]}));
    expect(projectBillRegister([
      { ...issued, billId: 'bill-2', billReference: 'SC-2026-000002' },
      { ...issued, billId: 'bill-1', billReference: 'SC-2026-000001' },
    ]).map(({ billReference }) => billReference)).toEqual(['SC-2026-000001', 'SC-2026-000002']);
  });
});
