import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MatterBillingWorkspace } from '../../api.js';
import { BillingPanel } from './BillingPanel.js';

export const billingWorkspace: MatterBillingWorkspace = {
  matterId: 'matter-1',
  actingUserId: 'finance-1',
  permissions: {
    canPrepareBill: true, canApproveBill: false, canIssueBill: true,
    canPrepareTransfer: true, canApproveTransfer: true, canPostTransfer: true,
  },
  clients: [{ id: 'client-1', name: 'Jamie North' }],
  eligibleSources: [
    { id: 'time-1', kind: 'time', narrative: 'Approved document preparation', netMinor: 48_000, vatMinor: null },
    { id: 'disb-1', kind: 'disbursement', narrative: 'Court issue fee', netMinor: 45_500, vatMinor: 0 },
  ],
  bills: [{
    id: 'bill-1', clientPartyId: 'client-1', status: 'part_paid', billReference: 'SC-2026-000001',
    currentVersionId: 'bill-version-1', approvedVersionId: 'bill-version-1', issuedVersionId: 'bill-version-1',
    issuedAt: '2026-10-03T10:00:00.000Z', deliveredAt: '2026-10-03T11:00:00.000Z', dueOn: '2026-11-02',
    netMinor: 91_500, vatMinor: 9_200, grossMinor: 100_700, creditedMinor: 0, paidMinor: 60_000,
    allocatedMinor: 60_000, outstandingMinor: 40_700, currency: 'GBP', version: 5,
    preparedBy: 'solicitor-1', preparedAt: '2026-10-02T12:00:00.000Z', taxPoint: '2026-10-03',
    documentVersionId: 'document-version-1', documentSha256: 'a'.repeat(64),
    lines: [
      { id: 'line-1', lineNumber: 1, sourceKind: 'time', sourceId: 'time-1', narrative: 'Document preparation', netMinor: 48_000, vatTreatment: 'standard', vatMinor: 9_600, grossMinor: 57_600 },
      { id: 'line-2', lineNumber: 2, sourceKind: 'adjustment', sourceId: 'time-1', narrative: 'Reduction: agreed write-down', netMinor: 2_000, vatTreatment: 'standard', vatMinor: 400, grossMinor: 2_400 },
    ],
    events: [],
  }],
  money: [{ clientPartyId: 'client-1', clientHeldMinor: 8_000, clientClearedMinor: 8_000, clientRestrictedMinor: 0, clientAvailableMinor: 8_000, clientReservedMinor: 0, officeHeldMinor: 60_000 }],
  payments: [],
  transfers: [{ id: 'transfer-1', clientPartyId: 'client-1', billId: 'bill-1', amountMinor: 60_000, currency: 'GBP', preparedBy: 'finance-1', preparedAt: '2026-10-04T10:00:00.000Z', version: 3, status: 'posted', events: [] }],
  exceptions: [{ id: 'exception-1', kind: 'changed_beneficiary', severity: 'blocker', summary: 'Beneficiary details changed.', amountMinor: 2_000, raisedAt: '2026-10-05T10:00:00.000Z' }],
  history: [
    { id: 'event-1', kind: 'bill', recordId: 'bill-1', status: 'delivered', occurredAt: '2026-10-03T11:00:00.000Z', summary: 'Bill delivered' },
    { id: 'event-2', kind: 'transfer', recordId: 'transfer-1', status: 'posted', occurredAt: '2026-10-04T12:00:00.000Z', summary: 'Client-to-office transfer posted' },
  ],
};

describe('BillingPanel', () => {
  it('separates client and office money and drills bill totals into exact immutable lines', () => {
    render(<BillingPanel matterId="matter-1" initialWorkspace={billingWorkspace} />);

    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    expect(screen.getByText('Client money')).toBeTruthy();
    expect(screen.getByText('£80.00 available')).toBeTruthy();
    expect(screen.getByText('Office money')).toBeTruthy();
    expect(screen.getByText('£600.00 held')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    fireEvent.click(screen.getByRole('button', { name: /SC-2026-000001/i }));
    expect(screen.getByText('Document preparation')).toBeTruthy();
    expect(screen.getByText('Reduction: agreed write-down')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download exact issued bill' }).getAttribute('href'))
      .toContain('/api/finance/documents/bill/bill-1/versions/document-version-1/download');
  });

  it('shows source selection and explicit adjustments only to an authorised preparer', async () => {
    render(<BillingPanel matterId="matter-1" initialWorkspace={billingWorkspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare bill' }));

    expect(await screen.findByRole('checkbox', { name: /Approved document preparation/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Court issue fee/ })).toBeTruthy();
    expect(screen.getByLabelText('Adjustment reason')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve bill/i })).toBeNull();
  });

  it('shows transfer sufficiency and immutable history without colour-only meaning', () => {
    render(<BillingPanel matterId="matter-1" initialWorkspace={billingWorkspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    expect(screen.getByText('Maximum transferable now')).toBeTruthy();
    expect(screen.getAllByText(/£80\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Blocker · Changed beneficiary')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Bill delivered')).toBeTruthy();
    expect(screen.getByText('Client-to-office transfer posted')).toBeTruthy();
  });

  it('hides every command when capabilities are absent', () => {
    const readOnly = { ...billingWorkspace, permissions: {
      canPrepareBill: false, canApproveBill: false, canIssueBill: false,
      canPrepareTransfer: false, canApproveTransfer: false, canPostTransfer: false,
    } };
    render(<BillingPanel matterId="matter-1" initialWorkspace={readOnly} />);
    expect(screen.queryByRole('button', { name: 'Prepare bill' })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /issue/i })).toBeNull();
  });

  it('restores keyboard focus to the command trigger after closing a dialog', async () => {
    render(<BillingPanel matterId="matter-1" initialWorkspace={billingWorkspace} />);
    const trigger = screen.getByRole('button', { name: 'Prepare bill' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: 'Close dialog' }));
    expect(document.activeElement).toBe(trigger);
  });
});
