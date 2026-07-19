import { FinanceCalculationError } from './calculations.js';
import type {
  FinanceAccountDesignation,
  FinanceCurrency,
} from './types.js';

export interface FinanceJournalProjectionLine {
  accountId: string;
  matterId: string | null;
  designation: FinanceAccountDesignation;
  debitMinor: number;
  creditMinor: number;
  currency: FinanceCurrency;
}

export interface FinanceJournalProjectionInput {
  id: string;
  status: 'draft' | 'approved' | 'posted' | 'rejected' | 'reversed';
  lines: FinanceJournalProjectionLine[];
}

export function projectAccountBalances(journals: FinanceJournalProjectionInput[]) {
  const balances = new Map<string, {
    accountId: string; matterId: string | null; designation: FinanceAccountDesignation;
    currency: FinanceCurrency; debitMinor: number; creditMinor: number; netMinor: number;
  }>();
  for (const journal of journals) {
    if (journal.status !== 'posted' && journal.status !== 'reversed') continue;
    for (const line of journal.lines) {
      const key = `${line.accountId}\u0000${line.matterId ?? ''}\u0000${line.designation}\u0000${line.currency}`;
      const current = balances.get(key) ?? {
        accountId: line.accountId, matterId: line.matterId, designation: line.designation,
        currency: line.currency, debitMinor: 0, creditMinor: 0, netMinor: 0,
      };
      const debitMinor = current.debitMinor + line.debitMinor;
      const creditMinor = current.creditMinor + line.creditMinor;
      if (!Number.isSafeInteger(debitMinor) || !Number.isSafeInteger(creditMinor)) {
        throw new FinanceCalculationError(
          'ARITHMETIC_OVERFLOW',
          'Finance projection exceeded the safe integer range.',
        );
      }
      current.debitMinor = debitMinor;
      current.creditMinor = creditMinor;
      current.netMinor = current.debitMinor - current.creditMinor;
      if (!Number.isSafeInteger(current.netMinor)) {
        throw new FinanceCalculationError(
          'ARITHMETIC_OVERFLOW',
          'Finance projection exceeded the safe integer range.',
        );
      }
      balances.set(key, current);
    }
  }
  return [...balances.values()].sort((left, right) =>
    left.accountId.localeCompare(right.accountId) ||
    (left.matterId ?? '').localeCompare(right.matterId ?? '') ||
    left.designation.localeCompare(right.designation));
}
