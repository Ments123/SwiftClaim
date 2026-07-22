import type {
  ClosureBlocker,
  ClosureReadinessResult,
  ClosureTransfer,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function classifyClosureReadiness(input: {
  blockers: readonly ClosureBlocker[];
  transfers: readonly ClosureTransfer[];
  asOfDate: string;
}): ClosureReadinessResult {
  const transfers = new Map(input.transfers.map((transfer) => [transfer.blockerKey, transfer]));
  const blockerKeys = new Set(input.blockers.map(({ key }) => key));
  const transferCounts = new Map<string, number>();
  for (const transfer of input.transfers) transferCounts.set(transfer.blockerKey, (transferCounts.get(transfer.blockerKey) ?? 0) + 1);
  const unresolved: ClosureBlocker[] = [];
  const invalidTransfers: string[] = [];
  for (const [key, count] of transferCounts) {
    if (!blockerKeys.has(key) || count !== 1) invalidTransfers.push(key);
  }

  for (const blocker of input.blockers) {
    const transfer = transfers.get(blocker.key);
    if (blocker.severity === 'critical' || !blocker.transferable) {
      unresolved.push(blocker);
      continue;
    }
    if (!transfer) {
      unresolved.push(blocker);
      continue;
    }
    if (
      !UUID.test(transfer.ownerUserId) ||
      !DATE_ONLY.test(transfer.dueOn) ||
      transfer.dueOn <= input.asOfDate ||
      transfer.reason.trim().length < 10
    ) {
      if (!invalidTransfers.includes(blocker.key)) invalidTransfers.push(blocker.key);
    }
  }

  return {
    closable: unresolved.length === 0 && invalidTransfers.length === 0,
    unresolved,
    invalidTransfers,
  };
}
