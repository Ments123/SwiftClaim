import type {
  GeneralDamagesRange,
  LossCalculationInput,
  LossCategory,
  LossPosition,
  QuantumProjectionLine,
} from './types.js';

export class QuantumCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantumCalculationError';
  }
}

function assertMoney(value: number | undefined): asserts value is number {
  if (
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new QuantumCalculationError(
      'Money must be a non-negative safe integer.',
    );
  }
}

function parseQuantity(value: string | undefined): {
  numerator: bigint;
  scale: bigint;
  display: string;
} {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value)) {
    throw new QuantumCalculationError(
      'Quantity must be a non-negative decimal with at most four decimal places.',
    );
  }
  const [whole, fraction = ''] = value.split('.');
  const scale = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(`${whole}${fraction}`),
    scale,
    display: value,
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new QuantumCalculationError('The calculated amount is too large.');
  }
  return result;
}

export function formatGbp(minor: number): string {
  assertMoney(minor);
  return `£${Math.floor(minor / 100).toLocaleString('en-GB')}.${String(
    minor % 100,
  ).padStart(2, '0')}`;
}

export function calculateLossAmount(input: LossCalculationInput): {
  amountMinor: number;
  calculation: string;
} {
  if (input.calculationType === 'fixed') {
    assertMoney(input.fixedAmountMinor);
    return {
      amountMinor: input.fixedAmountMinor,
      calculation: `${formatGbp(input.fixedAmountMinor)} fixed`,
    };
  }

  if (input.calculationType === 'manual') {
    assertMoney(input.manualAmountMinor);
    if (!input.manualBasis?.trim()) {
      throw new QuantumCalculationError(
        'A manual amount requires a review basis.',
      );
    }
    return {
      amountMinor: input.manualAmountMinor,
      calculation: `${formatGbp(input.manualAmountMinor)} manually reviewed`,
    };
  }

  assertMoney(input.rateMinor);
  const quantity = parseQuantity(input.quantity);
  const amountMinor = safeNumber(
    roundHalfUp(quantity.numerator * BigInt(input.rateMinor), quantity.scale),
  );
  const unit = input.unitLabel?.trim();
  if (!unit) {
    throw new QuantumCalculationError('A quantity requires a unit label.');
  }
  return {
    amountMinor,
    calculation: `${quantity.display} ${unit} × ${formatGbp(
      input.rateMinor,
    )} = ${formatGbp(amountMinor)}`,
  };
}

function addSafe(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new QuantumCalculationError('The calculated total is too large.');
  }
  return value;
}

export function projectQuantumTotals(
  lines: QuantumProjectionLine[],
  generalDamages: GeneralDamagesRange | null,
) {
  if (generalDamages) {
    assertMoney(generalDamages.lowMinor);
    assertMoney(generalDamages.highMinor);
    if (generalDamages.preferredMinor !== null) {
      assertMoney(generalDamages.preferredMinor);
    }
    if (generalDamages.highMinor < generalDamages.lowMinor) {
      throw new QuantumCalculationError(
        'The general-damages high value must not be below the low value.',
      );
    }
    if (
      generalDamages.preferredMinor !== null &&
      (generalDamages.preferredMinor < generalDamages.lowMinor ||
        generalDamages.preferredMinor > generalDamages.highMinor)
    ) {
      throw new QuantumCalculationError(
        'The preferred value must be within the reviewed range.',
      );
    }
  }

  const byPosition: Record<LossPosition, number> = {
    claimed: 0,
    accepted: 0,
    disputed: 0,
    withdrawn: 0,
  };
  const byCategory: Partial<Record<LossCategory, number>> = {};
  let specialDamagesMinor = 0;
  let evidenceGapCount = 0;
  let unsupportedAmountMinor = 0;

  for (const line of lines) {
    assertMoney(line.amountMinor);
    byPosition[line.position] = addSafe(
      byPosition[line.position],
      line.amountMinor,
    );
    byCategory[line.category] = addSafe(
      byCategory[line.category] ?? 0,
      line.amountMinor,
    );
    if (line.position !== 'withdrawn') {
      specialDamagesMinor = addSafe(specialDamagesMinor, line.amountMinor);
      if (line.evidenceStatus === 'partial' || line.evidenceStatus === 'missing') {
        evidenceGapCount += 1;
        unsupportedAmountMinor = addSafe(
          unsupportedAmountMinor,
          line.amountMinor,
        );
      }
    } else if (
      line.evidenceStatus === 'partial' ||
      line.evidenceStatus === 'missing'
    ) {
      evidenceGapCount += 1;
    }
  }

  return {
    specialDamagesMinor,
    byPosition,
    byCategory,
    evidenceGapCount,
    unsupportedAmountMinor,
    generalDamages,
    combined: generalDamages
      ? {
          lowMinor: addSafe(generalDamages.lowMinor, specialDamagesMinor),
          highMinor: addSafe(generalDamages.highMinor, specialDamagesMinor),
        }
      : null,
  };
}
