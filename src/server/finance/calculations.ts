export class FinanceCalculationError extends Error {
  constructor(public readonly code: 'ARITHMETIC_OVERFLOW' | 'INVALID_JOURNAL', message: string) {
    super(message);
    this.name = 'FinanceCalculationError';
  }
}

function safeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function calculateTimeValue(input: { minutes: number; hourlyRateMinor: number }) {
  if (!safeNonNegativeInteger(input.minutes) || !safeNonNegativeInteger(input.hourlyRateMinor))
    throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Finance arithmetic exceeded the safe integer range.');
  const numerator = input.minutes * input.hourlyRateMinor;
  if (!Number.isSafeInteger(numerator))
    throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Finance arithmetic exceeded the safe integer range.');
  return { chargeMinor: Math.trunc(numerator / 60), remainderNumerator: numerator % 60, denominator: 60 as const };
}

export interface JournalCalculationLine {
  debitMinor: number;
  creditMinor: number;
  currency: string;
}

export function validateJournalLines(lines: JournalCalculationLine[]) {
  if (lines.length < 2)
    throw new FinanceCalculationError('INVALID_JOURNAL', 'A journal requires at least two lines.');
  const currencies = new Set(lines.map(({ currency }) => currency));
  if (currencies.size !== 1)
    throw new FinanceCalculationError('INVALID_JOURNAL', 'Journal lines must use one currency.');
  let debitMinor = 0; let creditMinor = 0;
  for (const line of lines) {
    if (!safeNonNegativeInteger(line.debitMinor) || !safeNonNegativeInteger(line.creditMinor))
      throw new FinanceCalculationError('INVALID_JOURNAL', 'Journal amounts must be safe non-negative integers.');
    if ((line.debitMinor > 0) === (line.creditMinor > 0))
      throw new FinanceCalculationError('INVALID_JOURNAL', 'Each journal line must contain exactly one positive side.');
    debitMinor += line.debitMinor; creditMinor += line.creditMinor;
    if (!Number.isSafeInteger(debitMinor) || !Number.isSafeInteger(creditMinor))
      throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Finance arithmetic exceeded the safe integer range.');
  }
  if (debitMinor !== creditMinor)
    throw new FinanceCalculationError('INVALID_JOURNAL', 'Journal debits and credits must balance exactly.');
  return { currency: [...currencies][0]!, debitMinor, creditMinor };
}
