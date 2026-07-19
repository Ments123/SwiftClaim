import { describe, expect, it } from 'vitest';

import { calculateTimeValue, validateJournalLines } from './calculations.js';

describe('finance integer calculations', () => {
  it('calculates exact time value without floating-point money', () => {
    expect(calculateTimeValue({ minutes: 37, hourlyRateMinor: 24_000 }))
      .toEqual({ chargeMinor: 14_800, remainderNumerator: 0, denominator: 60 });
    expect(calculateTimeValue({ minutes: 1, hourlyRateMinor: 10_001 }))
      .toEqual({ chargeMinor: 166, remainderNumerator: 41, denominator: 60 });
  });

  it('rejects unsafe arithmetic', () => {
    expect(() => calculateTimeValue({ minutes: Number.MAX_SAFE_INTEGER, hourlyRateMinor: 2 }))
      .toThrow('Finance arithmetic exceeded the safe integer range.');
  });

  it('accepts one-currency exactly balanced lines', () => {
    expect(validateJournalLines([
      { debitMinor: 10_000, creditMinor: 0, currency: 'GBP' },
      { debitMinor: 0, creditMinor: 10_000, currency: 'GBP' },
    ])).toEqual({ currency: 'GBP', debitMinor: 10_000, creditMinor: 10_000 });
  });

  it('rejects unbalanced, mixed-currency and dual-sided lines', () => {
    expect(() => validateJournalLines([
      { debitMinor: 10_000, creditMinor: 0, currency: 'GBP' },
      { debitMinor: 0, creditMinor: 9_999, currency: 'GBP' },
    ])).toThrow('Journal debits and credits must balance exactly.');
    expect(() => validateJournalLines([
      { debitMinor: 10_000, creditMinor: 0, currency: 'GBP' },
      { debitMinor: 0, creditMinor: 10_000, currency: 'USD' },
    ])).toThrow('Journal lines must use one currency.');
    expect(() => validateJournalLines([
      { debitMinor: 1, creditMinor: 1, currency: 'GBP' },
      { debitMinor: 0, creditMinor: 1, currency: 'GBP' },
    ])).toThrow('Each journal line must contain exactly one positive side.');
  });
});
