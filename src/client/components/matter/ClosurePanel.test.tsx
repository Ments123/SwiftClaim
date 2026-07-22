import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ClosureWorkspace } from '../../api.js';
import { ClosurePanel } from './ClosurePanel.js';

const base: ClosureWorkspace = {
  matterId: '30000000-0000-4000-8000-000000000001', actingUserId: '20000000-0000-4000-8000-000000000001',
  status: 'prepared', readOnly: false, destructionSuspended: false,
  permissions: { canPrepare: true, canApprove: true, canReopen: true, canManageHold: true },
  currentReadiness: { hash: 'a'.repeat(64), calculatedAt: '2026-07-22T10:00:00.000Z', blockers: [] },
  review: { id: 'review-1', sequence: 1, snapshotHash: 'a'.repeat(64), outcome: 'Repairs completed and damages paid.',
    closureReason: 'The client objectives are complete.', lessons: 'Confirm return preferences early.', finalClientReportStatus: 'sent',
    finalClientReportDocumentVersionId: 'version-1', documentsPosition: 'retained', documentsNote: 'Client authorised retention.',
    retentionBasis: 'Six-year firm policy.', retentionUntil: '2032-07-22', preparedBy: 'different-user', preparedAt: '2026-07-22T09:00:00.000Z' },
  blockers: [], obligations: [], holds: [],
  events: [{ id: 'event-1', sequence: 1, eventType: 'prepared', reviewId: 'review-1', reason: 'Prepared after review.',
    responsibleOwnerUserId: null, recordedBy: 'different-user', recordedAt: '2026-07-22T09:00:00.000Z' }],
};

describe('ClosurePanel', () => {
  it('shows final reporting, retention and independent approval action', () => {
    render(<ClosurePanel matterId={base.matterId} initialWorkspace={base} team={[]} documents={[]} />);
    expect(screen.getByRole('heading', { name: 'Closure & retention' })).toBeTruthy();
    expect(screen.getByText('Repairs completed and damages paid.')).toBeTruthy();
    expect(screen.getByText(/22 Jul 2032/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve closure' })).toBeTruthy();
  });

  it('makes closed state explicit and offers only governed reopening controls', () => {
    render(<ClosurePanel matterId={base.matterId} initialWorkspace={{ ...base, status: 'closed', readOnly: true }} team={[]} documents={[]} />);
    expect(screen.getByRole('status').textContent).toContain('read-only');
    expect(screen.getByRole('button', { name: 'Reopen matter' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve closure' })).toBeNull();
  });

  it('shows critical blockers with text and suppresses preparation', () => {
    const blocker = { key: 'client-money:1', category: 'client_money', label: 'Client balance must be cleared.', severity: 'critical' as const, transferable: false, sourceId: '1' };
    render(<ClosurePanel matterId={base.matterId} initialWorkspace={{ ...base, status: 'active', review: null,
      currentReadiness: { ...base.currentReadiness, blockers: [blocker] }, blockers: [blocker] }} team={[]} documents={[]} />);
    expect(screen.getByText('Critical blocker')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prepare closure' })).toBeNull();
  });
});
