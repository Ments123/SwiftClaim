import { describe, expect, it } from 'vitest';

import {
  BillingCalculationError,
  calculateAgedDebt,
  calculateBillTotals,
  calculateVat,
  validateAllocation,
} from './billing-calculations.js';

describe('billing and cashroom calculations', () => {
  it('calculates VAT with an explicit reproducible half-up remainder snapshot', () => {
    expect(calculateVat({ netMinor: 10_003, rateNumerator: 20, rateDenominator: 100 })).toEqual({
      vatMinor: 2_001,
      treatment: 'standard',
      unroundedNumerator: 200_060,
      rateNumerator: 20,
      rateDenominator: 100,
      quotientMinor: 2_000,
      remainderNumerator: 60,
      rounding: 'half_up',
    });
  });

  it('keeps zero, exempt and outside-scope VAT explicit', () => {
    for (const treatment of ['zero', 'exempt', 'outside_scope'] as const) {
      expect(calculateVat({ netMinor: 10_003, treatment })).toMatchObject({
        vatMinor: 0,
        treatment,
        rateNumerator: 0,
      });
    }
  });

  it('totals immutable bill lines using safe integer arithmetic', () => {
    expect(calculateBillTotals([
      { netMinor: 14_800, vatMinor: 2_960 },
      { netMinor: 45_500, vatMinor: 0 },
    ])).toEqual({ netMinor: 60_300, vatMinor: 2_960, grossMinor: 63_260 });
  });

  it('fails closed on unsafe arithmetic and invalid VAT fractions', () => {
    expect(() => calculateVat({ netMinor: Number.MAX_SAFE_INTEGER, rateNumerator: 20, rateDenominator: 100 }))
      .toThrow(BillingCalculationError);
    expect(() => calculateVat({ netMinor: 10_000, rateNumerator: 20, rateDenominator: 0 }))
      .toThrow('VAT rate denominator must be a positive safe integer.');
    expect(() => calculateBillTotals([
      { netMinor: Number.MAX_SAFE_INTEGER, vatMinor: 1 },
    ])).toThrow('Billing arithmetic exceeded the safe integer range.');
  });

  it('requires allocations to equal the receipt and retain one designation per line', () => {
    expect(validateAllocation({
      receiptAmountMinor: 15_000,
      allocations: [
        { designation: 'client', amountMinor: 10_000 },
        { designation: 'office', amountMinor: 5_000 },
      ],
    })).toEqual({ clientMinor: 10_000, officeMinor: 5_000, suspenseMinor: 0, totalMinor: 15_000 });

    expect(() => validateAllocation({
      receiptAmountMinor: 15_000,
      allocations: [{ designation: 'client', amountMinor: 14_999 }],
    })).toThrow('Receipt allocations must equal the receipt amount exactly.');
  });

  it('places outstanding debt into deterministic non-overlapping ageing buckets', () => {
    expect(calculateAgedDebt({
      asOf: '2026-07-21',
      bills: [
        { dueOn: '2026-07-21', outstandingMinor: 100 },
        { dueOn: '2026-07-20', outstandingMinor: 200 },
        { dueOn: '2026-06-20', outstandingMinor: 300 },
        { dueOn: '2026-05-20', outstandingMinor: 400 },
        { dueOn: '2026-04-20', outstandingMinor: 500 },
      ],
    })).toEqual({ currentMinor: 100, days1To30Minor: 200, days31To60Minor: 300, days61To90Minor: 400, over90Minor: 500 });
  });
});
