import { describe, expect, it } from 'vitest';

import {
  calculateLossAmount,
  projectQuantumTotals,
  QuantumCalculationError,
} from './calculations.js';

describe('calculateLossAmount', () => {
  it('returns a fixed amount in integer minor units', () => {
    expect(
      calculateLossAmount({
        calculationType: 'fixed',
        fixedAmountMinor: 12_345,
      }),
    ).toEqual({ amountMinor: 12_345, calculation: '£123.45 fixed' });
  });

  it('multiplies an exact decimal quantity and rounds a half penny up', () => {
    expect(
      calculateLossAmount({
        calculationType: 'quantity_rate',
        quantity: '2.5',
        unitLabel: 'loads',
        rateMinor: 333,
      }),
    ).toEqual({
      amountMinor: 833,
      calculation: '2.5 loads × £3.33 = £8.33',
    });
  });

  it('calculates declared period units without deriving dates', () => {
    expect(
      calculateLossAmount({
        calculationType: 'period_rate',
        quantity: '12',
        unitLabel: 'weeks',
        rateMinor: 425,
      }),
    ).toEqual({
      amountMinor: 5_100,
      calculation: '12 weeks × £4.25 = £51.00',
    });
  });

  it('requires a human basis for a reviewed manual amount', () => {
    expect(() =>
      calculateLossAmount({
        calculationType: 'manual',
        manualAmountMinor: 8_000,
        manualBasis: ' ',
      }),
    ).toThrowError(new QuantumCalculationError('A manual amount requires a review basis.'));
  });

  it.each(['-1', '1.00001', 'one', '1e2', '']) (
    'rejects unsafe quantity %j',
    (quantity) => {
      expect(() =>
        calculateLossAmount({
          calculationType: 'quantity_rate',
          quantity,
          unitLabel: 'items',
          rateMinor: 100,
        }),
      ).toThrow(QuantumCalculationError);
    },
  );

  it('rejects unsafe integer money', () => {
    expect(() =>
      calculateLossAmount({
        calculationType: 'fixed',
        fixedAmountMinor: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrowError(new QuantumCalculationError('Money must be a non-negative safe integer.'));
  });
});

describe('projectQuantumTotals', () => {
  it('returns reproducible totals, evidence gaps and a separate human valuation range', () => {
    const projection = projectQuantumTotals(
      [
        {
          category: 'additional_heating',
          position: 'claimed',
          evidenceStatus: 'supported',
          amountMinor: 5_100,
        },
        {
          category: 'damaged_belongings',
          position: 'disputed',
          evidenceStatus: 'partial',
          amountMinor: 12_500,
        },
        {
          category: 'cleaning',
          position: 'withdrawn',
          evidenceStatus: 'missing',
          amountMinor: 2_000,
        },
      ],
      { lowMinor: 200_000, highMinor: 350_000, preferredMinor: 275_000 },
    );

    expect(projection).toEqual({
      specialDamagesMinor: 17_600,
      byPosition: {
        claimed: 5_100,
        accepted: 0,
        disputed: 12_500,
        withdrawn: 2_000,
      },
      byCategory: {
        additional_heating: 5_100,
        damaged_belongings: 12_500,
        cleaning: 2_000,
      },
      evidenceGapCount: 2,
      unsupportedAmountMinor: 12_500,
      generalDamages: {
        lowMinor: 200_000,
        highMinor: 350_000,
        preferredMinor: 275_000,
      },
      combined: { lowMinor: 217_600, highMinor: 367_600 },
    });
  });

  it('rejects an inverted general-damages range', () => {
    expect(() =>
      projectQuantumTotals([], {
        lowMinor: 20_000,
        highMinor: 10_000,
        preferredMinor: null,
      }),
    ).toThrowError(
      new QuantumCalculationError(
        'The general-damages high value must not be below the low value.',
      ),
    );
  });
});
