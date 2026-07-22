import { describe, expect, it } from 'vitest';

import { ManualCsvBankProvider, maskBankAccountIdentifier } from './bank-provider.js';
import { calculateReconciliation, nextReviewDueOn, suggestBankMatches } from './reconciliation.js';

describe('manual bank evidence and reconciliation calculations', () => {
  it('masks account identifiers and normalises CSV lines while retaining exact evidence hashes', () => {
    expect(maskBankAccountIdentifier('20-00-00 12345678')).toBe('****5678');
    const provider = new ManualCsvBankProvider();
    const result = provider.normalise([
      'transaction_date,value_date,amount_minor,reference,payer_payee,provider_line_id',
      '2026-10-05,2026-10-05,100000,SC-2026-000001,Maya Clarke,bank-1',
      '2026-10-06,, -25000 ,Client refund,Maya Clarke,bank-2',
    ].join('\n'));

    expect(result).toEqual([
      expect.objectContaining({ lineNumber: 2, transactionDate: '2026-10-05', valueDate: '2026-10-05', amountMinor: 100_000, providerLineId: 'bank-1' }),
      expect.objectContaining({ lineNumber: 3, transactionDate: '2026-10-06', valueDate: null, amountMinor: -25_000, providerLineId: 'bank-2' }),
    ]);
    expect(result.every((line) => /^[a-f0-9]{64}$/.test(line.rawLineHash))).toBe(true);
  });

  it('produces transparent provisional match suggestions without confirming anything', () => {
    const suggestions = suggestBankMatches({
      statementLines: [{ id: 'line-1', transactionDate: '2026-10-05', amountMinor: 100_000, reference: 'SC-2026-000001 Maya' }],
      journalEntries: [
        { id: 'journal-close', accountingDate: '2026-10-05', amountMinor: 100_000, reference: 'SC-2026-000001' },
        { id: 'journal-wrong', accountingDate: '2026-10-05', amountMinor: 90_000, reference: 'SC-2026-000001' },
      ],
    });

    expect(suggestions).toEqual([expect.objectContaining({
      statementLineId: 'line-1', journalId: 'journal-close', provisional: true,
      confidence: 'high', explanation: expect.stringMatching(/amount.*date.*reference/i),
    })]);
  });

  it('uses the exact reconciliation equation and projects the next review at 35 days', () => {
    expect(calculateReconciliation({
      statementClosingBalanceMinor: 125_000,
      ledgerClearedBalanceMinor: 100_000,
      outstandingLodgementsMinor: 30_000,
      unpresentedPaymentsMinor: 10_000,
      documentedAdjustmentsMinor: 5_000,
    })).toEqual({ expectedStatementBalanceMinor: 125_000, differenceMinor: 0, balanced: true });
    expect(nextReviewDueOn('2026-10-05')).toBe('2026-11-09');
  });

  it('rejects an unsafe intermediate reconciliation balance even when the final value appears safe', () => {
    expect(() => calculateReconciliation({
      statementClosingBalanceMinor: Number.MAX_SAFE_INTEGER,
      ledgerClearedBalanceMinor: Number.MAX_SAFE_INTEGER,
      outstandingLodgementsMinor: 2,
      unpresentedPaymentsMinor: 2,
      documentedAdjustmentsMinor: 0,
    })).toThrow(/safe integer/i);
  });
});
