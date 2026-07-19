import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FinanceRateCard, FinanceWorkspace } from '../../api.js';
import { FinancePanel } from './FinancePanel.js';

const workspace: FinanceWorkspace = {
  matterId: 'matter-1',
  actingUserId: 'user-1',
  permissions: {
    canRecordTime: true,
    canApproveTime: true,
    canManageRates: true,
    canManageEstimates: true,
    canManageDisbursements: true,
    canPrepareJournal: true,
    canApproveJournal: true,
    canPostJournal: true,
  },
  suggestions: [{
    id: 'suggestion-1', userId: 'user-1', sourceKind: 'communication_call', sourceId: 'call-1',
    minutes: 6, observedAt: '2026-10-02T09:00:00.000Z', proposedActivityCode: 'telephone_attendance',
    proposedCostsPhase: 'communications', proposedNarrative: 'Call attendance recorded in SwiftClaim.',
    confidence: 'high', explanation: 'Six minutes were observed from the exact call record.',
    model: 'finance-activity-rules-v1', policyVersion: 'finance-time-suggestion-v1',
    inputHash: 'a'.repeat(64), version: 1, status: 'pending', decisions: [],
    createdAt: '2026-10-02T12:00:00.000Z', provisional: true,
    label: 'AI suggestion — human review required',
  }],
  timers: [{
    id: 'timer-1', matterId: 'matter-1', userId: 'user-1', activityCode: 'case_progression',
    costsPhase: 'case_management', narrative: 'Chronology review', status: 'stopped',
    startedAt: '2026-10-02T10:00:00.000Z', stoppedAt: '2026-10-02T10:07:30.000Z',
    elapsedMinutes: 8, version: 2, createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  }],
  timeEntries: [{
    id: 'time-1', userId: 'user-1', workDate: '2026-10-02', minutes: 120,
    narrative: 'Approved document work recorded in SwiftClaim.', activityCode: 'document_preparation',
    costsPhase: 'documents', chargeable: true, sourceKind: 'document_version', sourceId: 'version-1',
    currency: 'GBP', status: 'approved', version: 2, createdBy: 'user-1',
    createdAt: '2026-10-02T12:00:00.000Z', events: [], approvalId: 'approval-1',
    rateVersionId: 'rate-version-1', rateEntryId: 'rate-entry-1', gradeSnapshot: 'solicitor',
    hourlyRateMinor: 24_000, chargeMinor: 48_000, remainderNumerator: 0, denominator: 60,
    approvedBy: 'partner-1', approvedAt: '2026-10-02T12:20:00.000Z',
    approvalNote: 'Independently checked.',
  }],
  warnings: [{
    id: 'warning-1', thresholdId: 'threshold-1', estimateVersionId: 'estimate-version-1',
    thresholdPercent: 80, crossedAt: '2026-10-02T12:30:00.000Z', exposureMinor: 93_500,
    currency: 'GBP', state: 'open', latestEvent: 'opened', version: 1, events: [],
  }],
  estimates: [{
    id: 'estimate-version-1', estimateId: 'estimate-1', versionNumber: 1, effectiveOn: '2026-10-01',
    scope: 'Current litigation phase.', feesMinor: 50_000, disbursementsMinor: 45_500,
    vatMinor: 14_500, overallLimitMinor: 110_000, currency: 'GBP', reviewOn: '2026-10-30',
    sourceDocumentVersionId: 'version-2', approvalNote: 'Reviewed estimate.', approvedBy: 'partner-1',
    createdAt: '2026-10-02T12:00:00.000Z', thresholds: [
      { id: 'threshold-1', thresholdPercent: 80 },
      { id: 'threshold-2', thresholdPercent: 100 },
    ],
  }],
  disbursements: [{
    id: 'disbursement-1', supplier: 'Independent Expert Ltd', invoiceReference: 'PROP-001',
    category: 'expert_report', description: 'Proposed expert report.', netMinor: 100_000,
    vatMinor: 20_000, grossMinor: 120_000, currency: 'GBP', invoiceDate: '2026-10-01',
    dueOn: '2026-10-31', sourceDocumentVersionId: 'version-2', createdBy: 'finance-1',
    createdAt: '2026-10-02T12:00:00.000Z', status: 'proposed', version: 1, events: [],
    approved: false, incurred: false, paidExternally: false, cancelled: false, corrected: false,
    billed: false, recovered: false, duplicateFindings: [],
  }],
  ledger: {
    journals: [{
      id: 'journal-1', periodId: 'period-1', accountingDate: '2026-10-02', sourceKind: 'wip_control',
      sourceId: 'time-1', description: 'Approved WIP control.', currency: 'GBP', reversesJournalId: null,
      preparedBy: 'partner-1', preparedAt: '2026-10-02T12:00:00.000Z', approvedBy: 'finance-1',
      approvedAt: '2026-10-02T12:50:00.000Z', postedBy: 'finance-1',
      postedAt: '2026-10-02T13:00:00.000Z', status: 'posted', version: 3,
      totalDebitMinor: 48_000, totalCreditMinor: 48_000, lines: [{
        id: 'line-1', lineNumber: 1, accountId: 'account-1', accountClass: 'wip_asset',
        designation: 'neutral', accountCode: 'WIP-CONTROL', accountName: 'Unbilled WIP control',
        matterId: 'matter-1', debitMinor: 48_000, creditMinor: 0, currency: 'GBP', memo: 'WIP',
      }], events: [],
    }],
    balances: [{ accountId: 'account-1', matterId: 'matter-1', designation: 'neutral', currency: 'GBP', debitMinor: 48_000, creditMinor: 0, netMinor: 48_000 }],
  },
  snapshot: {
    provisionalTime: { minutes: 14, estimatedChargeMinor: 5_600, unpricedCount: 0, currency: 'GBP' },
    approvedWip: { minutes: 120, amountMinor: 48_000, currency: 'GBP' },
    disbursements: {
      proposedMinor: 120_000, approvedExposureMinor: 45_500, cancelledMinor: 0,
      byStatus: { proposed: 120_000, approved: 0, incurred: 45_500, paid_external: 0, cancelled: 0 },
      currency: 'GBP',
    },
    estimate: { versionId: 'estimate-version-1', overallLimitMinor: 110_000, currentExposureMinor: 93_500, varianceMinor: 16_500, currency: 'GBP' },
    clientBalance: { state: 'not_connected' }, officeBalance: { state: 'not_connected' },
    billed: { state: 'not_connected' }, paid: { state: 'not_connected' }, recovered: { state: 'not_connected' },
  },
  sources: {
    documents: [{
      id: 'version-2', documentId: 'document-2', title: 'Expert proposal', category: 'invoice',
      version: 1, originalName: 'expert-proposal.pdf',
    }],
  },
};

const rateCards: FinanceRateCard[] = [{
  id: 'rate-card-1', name: 'Northstar standard litigation rates',
  description: 'Effective-dated rates.', currency: 'GBP', version: 2,
  createdBy: 'finance-1', createdAt: '2026-10-02T12:00:00.000Z', updatedAt: '2026-10-02T12:10:00.000Z',
  versions: [{
    id: 'rate-version-1', rateCardId: 'rate-card-1', versionNumber: 1,
    effectiveFrom: '2026-01-01', effectiveTo: null, note: 'Reviewed rates.',
    preparedBy: 'finance-1', createdAt: '2026-10-02T12:00:00.000Z', status: 'active',
    events: [], entries: [{ id: 'rate-entry-1', grade: 'solicitor', userId: 'user-1',
      activityCode: '', matterId: null, hourlyRateMinor: 24_000, currency: 'GBP' }],
  }],
}];

describe('FinancePanel', () => {
  it('separates provisional time from approved WIP and never fabricates cash', () => {
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={rateCards} />);

    expect(screen.getByText('Approved WIP')).toBeTruthy();
    expect(screen.getByText('£480.00')).toBeTruthy();
    expect(screen.getByText('Provisional time')).toBeTruthy();
    expect(screen.getByText('14 min')).toBeTruthy();
    expect(screen.getByText('Client balance · Not yet connected')).toBeTruthy();
    expect(screen.queryByText('Client balance · £0.00')).toBeNull();
  });

  it('labels AI output and keeps human decisions explicit', () => {
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={rateCards} />);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));

    expect(screen.getByText('AI suggestion — human review required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve all/i })).toBeNull();
  });

  it('keeps a stopped timer visible until the fee earner submits it', () => {
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={rateCards} />);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));

    expect(screen.getByText('Stopped timers awaiting submission')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit 8 min timer' })).toBeTruthy();
  });

  it('keeps accepted suggestions recoverable until reviewed time is submitted', () => {
    const acceptedWithoutTime: FinanceWorkspace = {
      ...workspace,
      suggestions: [{
        ...workspace.suggestions[0]!,
        status: 'accept',
        version: 2,
        decisions: [{
          id: 'decision-1', decision: 'accept', reason: 'Checked against the call record.',
          decidedBy: 'user-1', decidedAt: '2026-10-02T12:05:00.000Z',
        }],
      }],
    };

    render(<FinancePanel matterId="matter-1" initialWorkspace={acceptedWithoutTime} initialRateCards={rateCards} />);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));

    expect(screen.getByText('Human reviewed — submission still required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit reviewed time' })).toBeTruthy();
  });

  it('shows effective rates, warning evidence and exact source links', () => {
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={rateCards} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rates & estimates' }));

    expect(screen.getByText('Northstar standard litigation rates')).toBeTruthy();
    expect(screen.getByText('80% cost warning')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open exact source' }).getAttribute('href'))
      .toBe('/api/matters/matter-1/document-versions/version-2/download');
  });

  it('offers visible matter documents as exact sources for new finance records', async () => {
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={rateCards}
      availableDocumentSources={[{
        id: 'version-3', documentId: 'document-3', title: 'Latest client estimate',
        category: 'costs', version: 3, originalName: 'client-estimate-v3.pdf',
      }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rates & estimates' }));
    fireEvent.click(screen.getByRole('button', { name: 'New estimate' }));

    expect(await screen.findByRole('option', { name: 'Latest client estimate · v3' })).toBeTruthy();
  });

  it('exposes rate preparation and independent draft activation', () => {
    const cardWithDraft: FinanceRateCard = {
      ...rateCards[0]!,
      version: 3,
      versions: [...rateCards[0]!.versions, {
        id: 'rate-version-2', rateCardId: 'rate-card-1', versionNumber: 2,
        effectiveFrom: '2027-01-01', effectiveTo: null, note: 'Prepared future rates.',
        preparedBy: 'finance-1', createdAt: '2026-10-02T13:00:00.000Z', status: 'draft',
        events: [], entries: [{ id: 'rate-entry-2', grade: 'solicitor', userId: null,
          activityCode: '', matterId: null, hourlyRateMinor: 26_000, currency: 'GBP' }],
      }],
    };
    render(<FinancePanel matterId="matter-1" initialWorkspace={workspace} initialRateCards={[cardWithDraft]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rates & estimates' }));

    expect(screen.getByRole('button', { name: 'Add rate version' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activate rate version 2' })).toBeTruthy();
  });

  it('hides journal actions when permissions do not allow them', () => {
    const readOnly: FinanceWorkspace = {
      ...workspace,
      permissions: {
        ...workspace.permissions,
        canPrepareJournal: false,
        canApproveJournal: false,
        canPostJournal: false,
      },
    };
    render(<FinancePanel matterId="matter-1" initialWorkspace={readOnly} initialRateCards={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));

    expect(screen.getByText('Approved WIP control.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve journal/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /post journal/i })).toBeNull();
  });
});
