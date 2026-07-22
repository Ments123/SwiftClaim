import type { FinanceBillStatus, FinanceCurrency } from './types.js';

export class BillingProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingProjectionError';
  }
}

export interface BillLineSnapshot {
  id: string;
  sourceKind: 'time' | 'disbursement' | 'adjustment';
  sourceId: string;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
}

export interface BillVersionSnapshot {
  id: string;
  versionNumber: number;
  dueOn: string;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  currency: FinanceCurrency;
  lines: BillLineSnapshot[];
}

export type BillLifecycleEvent = {
  sequence: number;
  eventType: 'prepared' | 'submitted' | 'approved' | 'rejected' | 'issued' | 'delivered' | 'cancelled';
  billVersionId: string;
  occurredAt: string;
  billReference?: string;
};

export interface BillProjectionInput {
  billId: string;
  versions: BillVersionSnapshot[];
  events: BillLifecycleEvent[];
  payments: Array<{ amountMinor: number; posted: boolean }>;
  credits: Array<{ grossMinor: number; issued: boolean }>;
}

export interface ProjectedBill {
  billId: string;
  status: FinanceBillStatus;
  currentVersionId: string;
  approvedVersionId: string | null;
  issuedVersionId: string | null;
  billReference: string | null;
  issuedAt: string | null;
  dueOn: string;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  creditedMinor: number;
  allocatedMinor: number;
  outstandingMinor: number;
  currency: FinanceCurrency;
}

function requireSafeAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BillingProjectionError('Bill projection requires safe non-negative integer money.');
  }
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new BillingProjectionError('Bill projection arithmetic overflowed.');
  return value;
}

function orderedEvents(events: BillLifecycleEvent[]): BillLifecycleEvent[] {
  const result = [...events].sort((left, right) => left.sequence - right.sequence);
  result.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new BillingProjectionError('Bill events require a complete causal sequence.');
    }
  });
  return result;
}

export function projectBill(input: BillProjectionInput): ProjectedBill {
  const versions = new Map(input.versions.map((version) => [version.id, version]));
  let currentVersion: BillVersionSnapshot | undefined;
  let approvedVersionId: string | null = null;
  let issuedVersion: BillVersionSnapshot | undefined;
  let billReference: string | null = null;
  let issuedAt: string | null = null;
  let status: FinanceBillStatus = 'draft';

  for (const event of orderedEvents(input.events)) {
    const version = versions.get(event.billVersionId);
    if (!version) throw new BillingProjectionError('Bill event references an unavailable exact version.');
    if (event.eventType === 'prepared') {
      if (issuedVersion) throw new BillingProjectionError('An issued bill cannot receive a replacement draft version.');
      currentVersion = version;
      approvedVersionId = null;
      status = 'draft';
    } else if (!currentVersion || currentVersion.id !== version.id) {
      throw new BillingProjectionError('Bill event does not reference the current exact version.');
    } else if (event.eventType === 'submitted') {
      status = 'submitted';
    } else if (event.eventType === 'approved') {
      if (status !== 'submitted') throw new BillingProjectionError('Only the submitted exact bill version can be approved.');
      approvedVersionId = version.id;
      status = 'approved';
    } else if (event.eventType === 'rejected') {
      if (issuedVersion) throw new BillingProjectionError('An issued bill cannot be rejected or rewritten.');
      approvedVersionId = null;
      status = 'draft';
    } else if (event.eventType === 'issued') {
      if (issuedVersion) throw new BillingProjectionError('A bill can be issued only once.');
      if (approvedVersionId !== version.id) {
        throw new BillingProjectionError('An issued bill requires approval of the exact issued version.');
      }
      if (!event.billReference) throw new BillingProjectionError('An issued bill requires an immutable bill reference.');
      issuedVersion = version;
      billReference = event.billReference;
      issuedAt = event.occurredAt;
      status = 'issued';
    } else if (event.eventType === 'delivered') {
      if (!issuedVersion) throw new BillingProjectionError('Bill delivery requires an issued bill.');
      status = 'delivered';
    } else if (event.eventType === 'cancelled') {
      if (issuedVersion) throw new BillingProjectionError('An issued bill cannot be cancelled; use a credit note.');
      status = 'cancelled';
    }
  }

  if (!currentVersion) throw new BillingProjectionError('A bill requires at least one prepared version.');
  const exactVersion = issuedVersion ?? currentVersion;
  requireSafeAmount(exactVersion.netMinor);
  requireSafeAmount(exactVersion.vatMinor);
  requireSafeAmount(exactVersion.grossMinor);
  if (safeAdd(exactVersion.netMinor, exactVersion.vatMinor) !== exactVersion.grossMinor) {
    throw new BillingProjectionError('Bill version gross must equal net plus VAT.');
  }

  let creditedMinor = 0;
  for (const credit of input.credits) {
    requireSafeAmount(credit.grossMinor);
    if (credit.issued) creditedMinor = safeAdd(creditedMinor, credit.grossMinor);
  }
  let allocatedMinor = 0;
  for (const payment of input.payments) {
    requireSafeAmount(payment.amountMinor);
    if (payment.posted) allocatedMinor = safeAdd(allocatedMinor, payment.amountMinor);
  }
  const settledMinor = safeAdd(creditedMinor, allocatedMinor);
  if (settledMinor > exactVersion.grossMinor) {
    throw new BillingProjectionError('Bill credits and allocations exceed the immutable issued total.');
  }
  const outstandingMinor = exactVersion.grossMinor - settledMinor;
  if (issuedVersion && allocatedMinor > 0) status = outstandingMinor === 0 ? 'paid' : 'part_paid';

  return {
    billId: input.billId,
    status,
    currentVersionId: currentVersion.id,
    approvedVersionId,
    issuedVersionId: issuedVersion?.id ?? null,
    billReference,
    issuedAt,
    dueOn: exactVersion.dueOn,
    netMinor: exactVersion.netMinor,
    vatMinor: exactVersion.vatMinor,
    grossMinor: exactVersion.grossMinor,
    creditedMinor,
    allocatedMinor,
    outstandingMinor,
    currency: exactVersion.currency,
  };
}

export function projectWipEligibility(input: {
  approvedMinor: number;
  allocations: ReadonlyArray<{ amountMinor: number; billIssued: boolean }>;
}) {
  requireSafeAmount(input.approvedMinor);
  let issuedAllocatedMinor = 0;
  for (const allocation of input.allocations) {
    requireSafeAmount(allocation.amountMinor);
    if (allocation.billIssued) issuedAllocatedMinor = safeAdd(issuedAllocatedMinor, allocation.amountMinor);
  }
  if (issuedAllocatedMinor > input.approvedMinor) {
    throw new BillingProjectionError('Issued bill allocations exceed approved source value.');
  }
  return { eligibleMinor: input.approvedMinor - issuedAllocatedMinor, issuedAllocatedMinor };
}

export function projectCreditImpact(input: {
  originalGrossMinor: number;
  priorIssuedCreditsMinor: number;
  proposedGrossMinor: number;
}) {
  requireSafeAmount(input.originalGrossMinor);
  requireSafeAmount(input.priorIssuedCreditsMinor);
  requireSafeAmount(input.proposedGrossMinor);
  if (input.priorIssuedCreditsMinor > input.originalGrossMinor) {
    throw new BillingProjectionError('Prior credits exceed the original issued bill line value.');
  }
  const remainingBeforeMinor = input.originalGrossMinor - input.priorIssuedCreditsMinor;
  if (input.proposedGrossMinor > remainingBeforeMinor) {
    throw new BillingProjectionError('Credit exceeds the remaining issued bill line value.');
  }
  return { remainingBeforeMinor, remainingAfterMinor: remainingBeforeMinor - input.proposedGrossMinor };
}

export function projectBillRegister(bills: ProjectedBill[]): ProjectedBill[] {
  return [...bills].sort((left, right) => {
    if (left.billReference && right.billReference) return left.billReference.localeCompare(right.billReference);
    if (left.billReference) return -1;
    if (right.billReference) return 1;
    return left.billId.localeCompare(right.billId);
  });
}
