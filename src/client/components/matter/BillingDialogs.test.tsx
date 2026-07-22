import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api.js')>();
  return { ...actual, request: vi.fn() };
});

import { request, type MatterBill, type MatterBillingWorkspace } from '../../api.js';
import { BillingDialogs } from './BillingDialogs.js';

const bill: MatterBill = {
  id: 'bill-1', clientPartyId: 'client-1', status: 'draft', billReference: null,
  currentVersionId: 'version-1', approvedVersionId: null, issuedVersionId: null, issuedAt: null,
  deliveredAt: null, dueOn: '2026-11-01', netMinor: 10_000, vatMinor: 2_000, grossMinor: 12_000,
  creditedMinor: 0, allocatedMinor: 0, paidMinor: 0, outstandingMinor: 12_000, currency: 'GBP',
  version: 1, preparedBy: 'user-1', preparedAt: '2026-10-01T10:00:00.000Z', taxPoint: null,
  documentVersionId: null, documentSha256: null, lines: [], events: [],
};
const workspace = {
  matterId: 'matter-1', actingUserId: 'user-1', clients: [{ id: 'client-1', name: 'Client' }],
  eligibleSources: [], bills: [bill], money: [], payments: [], transfers: [], exceptions: [], history: [],
  permissions: { canPrepareBill: true, canApproveBill: false, canIssueBill: false,
    canPrepareTransfer: false, canApproveTransfer: false, canPostTransfer: false },
} satisfies MatterBillingWorkspace;

describe('BillingDialogs', () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it('reuses the complete command payload after a lost response', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce(undefined);
    const completed = vi.fn();
    render(<BillingDialogs matterId="matter-1" workspace={workspace} command={{ kind: 'submit_bill', bill }}
      onClose={() => undefined} onCompleted={completed} />);

    fireEvent.click(screen.getByRole('button', { name: 'Submit bill' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
    fireEvent.click(screen.getByRole('button', { name: 'Submit bill' }));
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));

    const first = JSON.parse(String(vi.mocked(request).mock.calls[0]?.[1]?.body));
    const retry = JSON.parse(String(vi.mocked(request).mock.calls[1]?.[1]?.body));
    expect(retry).toEqual(first);
    expect(first.idempotencyKey).toEqual(expect.any(String));
  });
});
