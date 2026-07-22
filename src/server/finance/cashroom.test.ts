import { describe, expect, it } from 'vitest';

import { CashroomProjectionError, projectCashbook, projectMatterMoney } from './cashroom.js';

describe('cashroom projections', () => {
  it('separates held, cleared, restricted and available client money', () => {
    expect(projectMatterMoney([
      { id: 'a', designation: 'client', amountMinor: 100_000, cleared: true, restricted: false, reversed: false },
      { id: 'b', designation: 'client', amountMinor: 25_000, cleared: false, restricted: false, reversed: false },
      { id: 'c', designation: 'client', amountMinor: 30_000, cleared: true, restricted: true, reversed: false },
      { id: 'd', designation: 'office', amountMinor: 10_000, cleared: true, restricted: false, reversed: false },
      { id: 'e', designation: 'suspense', amountMinor: 5_000, cleared: true, restricted: false, reversed: false },
    ])).toEqual({
      clientHeldMinor: 155_000,
      clientClearedMinor: 130_000,
      clientRestrictedMinor: 30_000,
      clientAvailableMinor: 100_000,
      officeHeldMinor: 10_000,
      suspenseMinor: 5_000,
      currency: 'GBP',
    });
  });

  it('removes reversed allocations and rejects negative money positions', () => {
    expect(projectMatterMoney([
      { id: 'a', designation: 'client', amountMinor: 20_000, cleared: true, restricted: false, reversed: true },
    ]).clientHeldMinor).toBe(0);
    expect(() => projectMatterMoney([
      { id: 'a', designation: 'client', amountMinor: -1, cleared: true, restricted: false, reversed: false },
    ])).toThrowError(CashroomProjectionError);
  });

  it('projects client and office cashbooks without conflating designations', () => {
    expect(projectCashbook([
      { id: 'j1', designation: 'client', debitMinor: 80_000, creditMinor: 0, cleared: true },
      { id: 'j2', designation: 'client', debitMinor: 0, creditMinor: 25_000, cleared: true },
      { id: 'j3', designation: 'office', debitMinor: 12_000, creditMinor: 0, cleared: false },
    ])).toEqual({
      clientLedgerMinor: 55_000,
      clientClearedMinor: 55_000,
      officeLedgerMinor: 12_000,
      officeClearedMinor: 0,
      currency: 'GBP',
    });
  });
});
