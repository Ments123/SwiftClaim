import { describe, expect, it } from 'vitest';

import { projectAccountBalances } from './journal.js';

describe('finance journal projection', () => {
  const lines = [
    { accountId: 'wip', matterId: 'matter-1', designation: 'neutral' as const, debitMinor: 14_800, creditMinor: 0, currency: 'GBP' as const },
    { accountId: 'wip-offset', matterId: 'matter-1', designation: 'neutral' as const, debitMinor: 0, creditMinor: 14_800, currency: 'GBP' as const },
  ];

  it('projects only posted journals into balances', () => {
    expect(projectAccountBalances([
      { id: 'draft', status: 'draft', lines },
      { id: 'posted', status: 'posted', lines },
    ])).toEqual([
      { accountId: 'wip', matterId: 'matter-1', designation: 'neutral', currency: 'GBP', debitMinor: 14_800, creditMinor: 0, netMinor: 14_800 },
      { accountId: 'wip-offset', matterId: 'matter-1', designation: 'neutral', currency: 'GBP', debitMinor: 0, creditMinor: 14_800, netMinor: -14_800 },
    ]);
  });

  it('does not net client and office designations together', () => {
    expect(projectAccountBalances([{ id: 'posted', status: 'posted', lines: [
      { accountId: 'cash', matterId: 'matter-1', designation: 'client', debitMinor: 1_000, creditMinor: 0, currency: 'GBP' },
      { accountId: 'cash', matterId: 'matter-1', designation: 'office', debitMinor: 0, creditMinor: 1_000, currency: 'GBP' },
    ] }])).toHaveLength(2);
  });

  it('applies an immutable reversal as a separate posted journal', () => {
    const reversal = lines.map((line) => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));
    expect(projectAccountBalances([
      { id: 'posted', status: 'posted', lines },
      { id: 'reversal', status: 'posted', lines: reversal },
    ]).every(({ netMinor }) => netMinor === 0)).toBe(true);
  });

  it('keeps a reversed original in balances until its posted reversal offsets it', () => {
    const reversal = lines.map((line) => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));
    expect(projectAccountBalances([
      { id: 'original', status: 'reversed', lines },
      { id: 'reversal', status: 'posted', lines: reversal },
    ]).every(({ netMinor }) => netMinor === 0)).toBe(true);
  });

  it('rejects a projection total outside the exact integer range', () => {
    const maximumLine = {
      accountId: 'wip', matterId: 'matter-1', designation: 'neutral' as const,
      debitMinor: Number.MAX_SAFE_INTEGER, creditMinor: 0, currency: 'GBP' as const,
    };
    expect(() => projectAccountBalances([
      { id: 'first', status: 'posted', lines: [maximumLine] },
      { id: 'second', status: 'posted', lines: [maximumLine] },
    ])).toThrow(/safe integer range/i);
  });
});
