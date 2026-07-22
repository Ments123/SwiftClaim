export class BillingCalculationError extends Error {
  constructor(
    public readonly code: 'ARITHMETIC_OVERFLOW' | 'INVALID_VAT' | 'INVALID_ALLOCATION',
    message: string,
  ) {
    super(message);
    this.name = 'BillingCalculationError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function requireNonNegativeSafeInteger(value: number, message = 'Billing arithmetic exceeded the safe integer range.'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BillingCalculationError('ARITHMETIC_OVERFLOW', message);
  }
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new BillingCalculationError('ARITHMETIC_OVERFLOW', 'Billing arithmetic exceeded the safe integer range.');
  }
  return result;
}

export type VatTreatment = 'standard' | 'zero' | 'exempt' | 'outside_scope';

export type VatCalculation = {
  vatMinor: number;
  treatment: VatTreatment;
  unroundedNumerator: number;
  rateNumerator: number;
  rateDenominator: number;
  quotientMinor: number;
  remainderNumerator: number;
  rounding: 'half_up';
};

export function calculateVat(input:
  | { netMinor: number; treatment: Exclude<VatTreatment, 'standard'> }
  | { netMinor: number; treatment?: 'standard'; rateNumerator: number; rateDenominator: number },
): VatCalculation {
  requireNonNegativeSafeInteger(input.netMinor);
  if (input.treatment && input.treatment !== 'standard') {
    return {
      vatMinor: 0,
      treatment: input.treatment,
      unroundedNumerator: 0,
      rateNumerator: 0,
      rateDenominator: 1,
      quotientMinor: 0,
      remainderNumerator: 0,
      rounding: 'half_up',
    };
  }

  if (!Number.isSafeInteger(input.rateNumerator) || input.rateNumerator < 0) {
    throw new BillingCalculationError('INVALID_VAT', 'VAT rate numerator must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(input.rateDenominator) || input.rateDenominator <= 0) {
    throw new BillingCalculationError('INVALID_VAT', 'VAT rate denominator must be a positive safe integer.');
  }
  const unroundedNumerator = input.netMinor * input.rateNumerator;
  if (!Number.isSafeInteger(unroundedNumerator)) {
    throw new BillingCalculationError('ARITHMETIC_OVERFLOW', 'Billing arithmetic exceeded the safe integer range.');
  }
  const quotientMinor = Math.trunc(unroundedNumerator / input.rateDenominator);
  const remainderNumerator = unroundedNumerator % input.rateDenominator;
  const vatMinor = safeAdd(quotientMinor, remainderNumerator * 2 >= input.rateDenominator ? 1 : 0);
  return {
    vatMinor,
    treatment: 'standard',
    unroundedNumerator,
    rateNumerator: input.rateNumerator,
    rateDenominator: input.rateDenominator,
    quotientMinor,
    remainderNumerator,
    rounding: 'half_up',
  };
}

export function calculateBillTotals(lines: ReadonlyArray<{ netMinor: number; vatMinor: number }>) {
  let netMinor = 0;
  let vatMinor = 0;
  for (const line of lines) {
    requireNonNegativeSafeInteger(line.netMinor);
    requireNonNegativeSafeInteger(line.vatMinor);
    netMinor = safeAdd(netMinor, line.netMinor);
    vatMinor = safeAdd(vatMinor, line.vatMinor);
  }
  return { netMinor, vatMinor, grossMinor: safeAdd(netMinor, vatMinor) };
}

export type ReceiptAllocationDesignation = 'client' | 'office' | 'suspense';

export function validateAllocation(input: {
  receiptAmountMinor: number;
  allocations: ReadonlyArray<{ designation: ReceiptAllocationDesignation; amountMinor: number }>;
}) {
  requireNonNegativeSafeInteger(input.receiptAmountMinor);
  if (input.allocations.length === 0) {
    throw new BillingCalculationError('INVALID_ALLOCATION', 'At least one receipt allocation is required.');
  }
  let clientMinor = 0;
  let officeMinor = 0;
  let suspenseMinor = 0;
  for (const allocation of input.allocations) {
    requireNonNegativeSafeInteger(allocation.amountMinor);
    if (allocation.amountMinor === 0) {
      throw new BillingCalculationError('INVALID_ALLOCATION', 'Receipt allocations must be positive.');
    }
    if (allocation.designation === 'client') clientMinor = safeAdd(clientMinor, allocation.amountMinor);
    else if (allocation.designation === 'office') officeMinor = safeAdd(officeMinor, allocation.amountMinor);
    else suspenseMinor = safeAdd(suspenseMinor, allocation.amountMinor);
  }
  const totalMinor = safeAdd(safeAdd(clientMinor, officeMinor), suspenseMinor);
  if (totalMinor !== input.receiptAmountMinor) {
    throw new BillingCalculationError('INVALID_ALLOCATION', 'Receipt allocations must equal the receipt amount exactly.');
  }
  return { clientMinor, officeMinor, suspenseMinor, totalMinor };
}

function dateOnlyEpoch(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BillingCalculationError('INVALID_ALLOCATION', 'A valid ISO date is required for aged debt.');
  }
  const epoch = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(epoch)) {
    throw new BillingCalculationError('INVALID_ALLOCATION', 'A valid ISO date is required for aged debt.');
  }
  return epoch;
}

export function calculateAgedDebt(input: {
  asOf: string;
  bills: ReadonlyArray<{ dueOn: string; outstandingMinor: number }>;
}) {
  const asOfEpoch = dateOnlyEpoch(input.asOf);
  const result = { currentMinor: 0, days1To30Minor: 0, days31To60Minor: 0, days61To90Minor: 0, over90Minor: 0 };
  for (const bill of input.bills) {
    requireNonNegativeSafeInteger(bill.outstandingMinor);
    const daysLate = Math.floor((asOfEpoch - dateOnlyEpoch(bill.dueOn)) / DAY_MS);
    const key = daysLate <= 0 ? 'currentMinor'
      : daysLate <= 30 ? 'days1To30Minor'
        : daysLate <= 60 ? 'days31To60Minor'
          : daysLate <= 90 ? 'days61To90Minor'
            : 'over90Minor';
    result[key] = safeAdd(result[key], bill.outstandingMinor);
  }
  return result;
}
