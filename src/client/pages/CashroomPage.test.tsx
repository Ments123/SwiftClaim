import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CashroomWorkspace } from '../api.js';
import { CashroomPage } from './CashroomPage.js';

const workspace: CashroomWorkspace = {
  actingUserId: 'finance-1',
  permissions: { canRecordBankActivity: true, canAllocateMoney: true, canPreparePayment: true,
    canApprovePayment: true, canPostCashroom: true, canPrepareReconciliation: true,
    canSignoffReconciliation: false, canExport: true },
  summary: { issuedGrossMinor: 100_700, outstandingMinor: 40_700, overdueBills: 1,
    unallocatedReceiptsMinor: 15_000, blockerExceptions: 1 },
  bills: [
    { id: 'bill-1', matterId: 'matter-1', matterReference: 'NCL-2026-0017', clientPartyId: 'client-1',
      billReference: 'SC-2026-000001', dueOn: '2026-11-02', grossMinor: 100_700, creditedMinor: 0,
      paidMinor: 60_000, outstandingMinor: 40_700, currency: 'GBP', status: 'part_paid', ageBucket: '1_30' },
  ],
  receipts: [{ id: 'receipt-1', bankAccountId: 'bank-1', amountMinor: 15_000, allocatedMinor: 0,
    unallocatedMinor: 15_000, receivedOn: '2026-10-05', reference: 'Unidentified receipt', currency: 'GBP', status: 'suspense' }],
  payments: [{ id: 'payment-1', matterId: 'matter-1', matterReference: 'NCL-2026-0017', clientPartyId: 'client-1',
    amountMinor: 2_000, currency: 'GBP', purpose: 'Client refund', preparedBy: 'finance-1',
    preparedAt: '2026-10-05T09:00:00.000Z', status: 'recorded_external' }],
  bankAccounts: [{ id: 'bank-1', name: 'Northstar client account', designation: 'client',
    accountIdentifierMasked: '****5678', currency: 'GBP', active: true, latestStatementTo: '2026-10-05' }],
  statements: [{ id: 'batch-1', bankAccountId: 'bank-1', statementFrom: '2026-10-01', statementTo: '2026-10-05',
    closingBalanceMinor: 23_000, currency: 'GBP', reconciliationId: 'rec-1', reconciliationStatus: 'completed',
    reconciliationVersion: 3, lines: [{ id: 'statement-line-1', transactionDate: '2026-10-05',
      amountMinor: 70_000, reference: 'Client receipt', decision: 'human_confirmed', suggestion: null }] }],
  reconciliations: [{ id: 'rec-1', bankAccountId: 'bank-1', statementBatchId: 'batch-1',
    statementClosingOn: '2026-10-05', statementClosingBalanceMinor: 23_000, ledgerClearedBalanceMinor: 8_000,
    differenceMinor: 0, currency: 'GBP', preparedBy: 'finance-1', preparedAt: '2026-10-05T10:00:00.000Z',
    version: 3, status: 'completed', nextReviewDueOn: null }],
  exceptions: [{ id: 'exception-1', matterId: 'matter-1', kind: 'changed_beneficiary', severity: 'blocker',
    summary: 'Beneficiary details changed.', amountMinor: 2_000, currency: 'GBP', raisedAt: '2026-10-05T10:00:00.000Z' }],
  exports: [
    { kind: 'bills', href: '/api/finance/cashroom/exports/bills' },
    { kind: 'cashbook', href: '/api/finance/cashroom/exports/cashbook' },
    { kind: 'reconciliations', href: '/api/finance/cashroom/exports/reconciliations' },
  ],
};

describe('CashroomPage', () => {
  it('filters the aged-debt register and exposes exact source drill-down', () => {
    render(<CashroomPage initialWorkspace={workspace} />);
    expect(screen.getAllByText('£407.00')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Filter bills'), { target: { value: '1_30' } });
    fireEvent.click(screen.getByRole('button', { name: /SC-2026-000001/i }));
    expect(screen.getByText('NCL-2026-0017')).toBeInTheDocument();
    expect(screen.getByText('£1,007.00 gross')).toBeInTheDocument();
  });

  it('shows suspense, masked banking and independently controlled reconciliation', () => {
    render(<CashroomPage initialWorkspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Receipts' }));
    expect(screen.getByText('Suspense · £150.00 unallocated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bank' }));
    expect(screen.getByText('****5678')).toBeInTheDocument();
    expect(screen.getByText('Human-confirmed match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconciliation' }));
    expect(screen.getByText(/Completed · awaiting independent sign-off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign off reconciliation' })).not.toBeInTheDocument();
  });

  it('shows blockers and audited export entry points', () => {
    render(<CashroomPage initialWorkspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exceptions' }));
    expect(screen.getByText('Blocker · Changed beneficiary')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export bills CSV' })).toHaveAttribute('href', '/api/finance/cashroom/exports/bills');
    expect(screen.getByText(/Every export retains its exact columns, filters, row count and SHA-256 checksum/i)).toBeInTheDocument();
  });
});
