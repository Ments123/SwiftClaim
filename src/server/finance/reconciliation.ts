export type ReconciliationInput = {
  statementClosingBalanceMinor: number;
  ledgerClearedBalanceMinor: number;
  outstandingLodgementsMinor: number;
  unpresentedPaymentsMinor: number;
  documentedAdjustmentsMinor: number;
};

function requireSafeMoney(values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value))) throw new Error('Reconciliation money must use safe integer minor units.');
}

export function calculateReconciliation(input: ReconciliationInput) {
  requireSafeMoney(Object.values(input));
  if (input.outstandingLodgementsMinor < 0 || input.unpresentedPaymentsMinor < 0) {
    throw new Error('Outstanding lodgements and unpresented payments cannot be negative.');
  }
  const expectedStatementBalanceMinor = input.ledgerClearedBalanceMinor + input.outstandingLodgementsMinor
    - input.unpresentedPaymentsMinor + input.documentedAdjustmentsMinor;
  const differenceMinor = input.statementClosingBalanceMinor - expectedStatementBalanceMinor;
  requireSafeMoney([expectedStatementBalanceMinor, differenceMinor]);
  return { expectedStatementBalanceMinor, differenceMinor, balanced: differenceMinor === 0 };
}

export function nextReviewDueOn(statementClosingOn: string, cadenceDays = 35): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementClosingOn) || !Number.isInteger(cadenceDays) || cadenceDays < 1) {
    throw new Error('A valid closing date and positive whole-day cadence are required.');
  }
  const date = new Date(`${statementClosingOn}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('The statement closing date is invalid.');
  date.setUTCDate(date.getUTCDate() + cadenceDays);
  return date.toISOString().slice(0, 10);
}

type MatchLine = { id: string; transactionDate: string; amountMinor: number; reference: string };
type JournalMatch = { id: string; accountingDate: string; amountMinor: number; reference: string };

export function suggestBankMatches(input: { statementLines: MatchLine[]; journalEntries: JournalMatch[] }) {
  return input.statementLines.flatMap((line) => {
    const ranked = input.journalEntries.map((journal) => {
      const amount = journal.amountMinor === line.amountMinor;
      const date = journal.accountingDate === line.transactionDate;
      const words = journal.reference.toLowerCase().split(/\W+/).filter((word) => word.length >= 3);
      const reference = words.some((word) => line.reference.toLowerCase().includes(word));
      return { journal, amount, date, reference, score: Number(amount) * 60 + Number(date) * 25 + Number(reference) * 15 };
    }).filter((candidate) => candidate.amount).sort((left, right) => right.score - left.score || left.journal.id.localeCompare(right.journal.id));
    const best = ranked[0];
    if (!best) return [];
    return [{ statementLineId: line.id, journalId: best.journal.id, provisional: true as const,
      confidence: best.score >= 100 ? 'high' as const : best.score >= 75 ? 'medium' as const : 'low' as const,
      explanation: `Exact amount${best.date ? ', date' : ''}${best.reference ? ' and reference' : ''} candidate; human confirmation required.`,
    }];
  });
}
