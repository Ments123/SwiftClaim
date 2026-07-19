import { FinanceCalculationError } from './calculations.js';

export type FinanceDisbursementStatus = 'proposed' | 'approved' | 'incurred' | 'paid_external' | 'cancelled';

export interface MatterFinanceProjectionInput {
  provisionalTime: Array<{ minutes: number; estimatedChargeMinor: number | null }>;
  approvedTime: Array<{ minutes: number; chargeMinor: number }>;
  disbursements: Array<{ id: string; status: FinanceDisbursementStatus; grossMinor: number }>;
  activeEstimate: { versionId: string; overallLimitMinor: number } | null;
}

function requireSafeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', `${label} is outside the safe integer range.`);
  }
}

function addSafe(current: number, value: number): number {
  requireSafeNonNegative(value, 'Finance projection value');
  const result = current + value;
  if (!Number.isSafeInteger(result)) {
    throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Finance projection exceeded the safe integer range.');
  }
  return result;
}

export function projectMatterFinance(input: MatterFinanceProjectionInput) {
  let provisionalMinutes = 0;
  let provisionalValueMinor = 0;
  let unpricedCount = 0;
  for (const entry of input.provisionalTime) {
    if (!Number.isSafeInteger(entry.minutes) || entry.minutes <= 0) {
      throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Provisional minutes are outside the safe integer range.');
    }
    provisionalMinutes = addSafe(provisionalMinutes, entry.minutes);
    if (entry.estimatedChargeMinor === null) unpricedCount += 1;
    else provisionalValueMinor = addSafe(provisionalValueMinor, entry.estimatedChargeMinor);
  }

  let approvedMinutes = 0;
  let approvedWipMinor = 0;
  for (const entry of input.approvedTime) {
    if (!Number.isSafeInteger(entry.minutes) || entry.minutes <= 0) {
      throw new FinanceCalculationError('ARITHMETIC_OVERFLOW', 'Approved minutes are outside the safe integer range.');
    }
    approvedMinutes = addSafe(approvedMinutes, entry.minutes);
    approvedWipMinor = addSafe(approvedWipMinor, entry.chargeMinor);
  }

  const byStatus: Record<FinanceDisbursementStatus, number> = {
    proposed: 0, approved: 0, incurred: 0, paid_external: 0, cancelled: 0,
  };
  for (const disbursement of input.disbursements) {
    byStatus[disbursement.status] = addSafe(byStatus[disbursement.status], disbursement.grossMinor);
  }
  const approvedDisbursementExposureMinor = addSafe(
    addSafe(byStatus.approved, byStatus.incurred),
    byStatus.paid_external,
  );
  const currentExposureMinor = addSafe(approvedWipMinor, approvedDisbursementExposureMinor);

  if (input.activeEstimate) requireSafeNonNegative(input.activeEstimate.overallLimitMinor, 'Estimate limit');
  const notConnected = { state: 'not_connected' as const };

  return {
    provisionalTime: {
      minutes: provisionalMinutes,
      estimatedChargeMinor: provisionalValueMinor,
      unpricedCount,
      currency: 'GBP' as const,
    },
    approvedWip: { minutes: approvedMinutes, amountMinor: approvedWipMinor, currency: 'GBP' as const },
    disbursements: {
      proposedMinor: byStatus.proposed,
      approvedExposureMinor: approvedDisbursementExposureMinor,
      cancelledMinor: byStatus.cancelled,
      byStatus,
      currency: 'GBP' as const,
    },
    estimate: input.activeEstimate
      ? {
          versionId: input.activeEstimate.versionId,
          overallLimitMinor: input.activeEstimate.overallLimitMinor,
          currentExposureMinor,
          varianceMinor: input.activeEstimate.overallLimitMinor - currentExposureMinor,
          currency: 'GBP' as const,
        }
      : null,
    clientBalance: notConnected,
    officeBalance: notConnected,
    billed: notConnected,
    paid: notConnected,
    recovered: notConnected,
  };
}
