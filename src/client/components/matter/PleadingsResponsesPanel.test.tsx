import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PleadingsWorkspace } from '../../api.js';
import { PleadingsResponsesPanel } from './PleadingsResponsesPanel.js';

const workspace: PleadingsWorkspace = {
  proceedingId: 'proceeding-1',
  actingUserId: 'user-1',
  tracks: [{
    id: 'track-1', proceedingId: 'proceeding-1', claimantPartyId: 'claimant-1',
    defendantPartyId: 'defendant-1', claimFormDocumentVersionId: 'document-1',
    particularsDocumentVersionId: 'document-2', regime: 'part_7_domestic',
    serviceRecordId: 'service-1', currentState: 'open', version: 1,
    createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z',
    claimant: { id: 'claimant-1', name: 'Maya Clarke', kind: 'client' },
    defendant: { id: 'defendant-1', name: 'Meridian Housing', kind: 'opponent' },
    events: [], statements: [{
      id: 'statement-1', proceedingId: 'proceeding-1', trackId: 'track-1',
      statementType: 'defence', partyId: 'defendant-1', version: 1,
      currentVersion: {
        id: 'statement-version-1', versionNumber: 1, statementType: 'defence',
        documentVersionId: 'document-1', predecessorVersionId: null,
        statementOfTruthStatus: 'signed', signatoryName: 'Meridian Housing',
        signatoryCapacity: 'Defendant', signedAt: '2026-09-15T09:00:00.000Z',
        responsePosition: 'counterclaim_included', amendmentRoute: 'written_consent',
        amendmentReason: 'Clarification', preparedByUserId: 'user-1',
        createdAt: '2026-09-15T10:00:00.000Z',
      },
      events: [], amendmentAuthorities: [{
        id: 'authority-1', statementVersionId: 'statement-version-1',
        route: 'written_consent', consentDocumentVersionId: 'consent-1',
        applicationId: null, sealedOrderId: null, reviewedBy: 'user-1',
        reviewedAt: '2026-09-15T10:00:00.000Z', note: 'Written consent retained.',
      }],
      projection: { filingState: 'filed', serviceState: 'not_served' },
    }],
    deadlines: [{
      id: 'deadline-1', kind: 'defence', outcome: 'projected', triggerDate: '2026-09-14',
      projectedDate: '2026-10-12', ruleKey: 'cpr_15_4_aos_general',
      ruleVersion: 'reviewed-2026-07-18', sourceTitle: 'CPR Part 15',
      sourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15',
      sourceDocumentVersionId: null, reviewedAt: '2026-09-15T10:00:00.000Z',
      createdAt: '2026-09-15T10:00:00.000Z',
    }],
    defaultReviews: [{
      id: 'review-1', outcome: 'blockers_recorded',
      blockers: ['Part 12 exclusion question unresolved'],
      claimType: 'Part 7 claim', requestedMethod: 'Court review required',
      note: 'Human review remains blocked.', version: 1,
      reviewedBy: 'user-1', reviewedAt: '2026-09-15T10:00:00.000Z',
    }],
  }],
  sources: { documents: [], parties: [] },
  permissions: {
    canRead: true, canPrepare: true, canRecordExternal: true,
    canApproveClaimantStatement: true, canReviewDefault: true,
    canRecordAmendmentAuthority: true,
  },
};

describe('PleadingsResponsesPanel', () => {
  it('shows qualified dates and a defendant-centric response track', () => {
    render(<PleadingsResponsesPanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={workspace} />);
    expect(screen.getByRole('heading', { name: 'Meridian Housing' })).toBeTruthy();
    expect(screen.getByText('Projected from reviewed service facts')).toBeTruthy();
    expect(screen.getByText('12 Oct 2026')).toBeTruthy();
  });

  it('uses neutral default-review language', () => {
    render(<PleadingsResponsesPanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={workspace} />);
    expect(screen.getByText('Blockers recorded')).toBeTruthy();
    expect(screen.queryByText(/eligible|entitled|safe to enter/i)).toBeNull();
  });

  it('shows the exact current statement and keeps filing, service and authority distinct', () => {
    render(<PleadingsResponsesPanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={workspace} />);
    expect(screen.getByText('Defence · version 1')).toBeTruthy();
    expect(screen.getByText('Filed')).toBeTruthy();
    expect(screen.getByText('Not served')).toBeTruthy();
    expect(screen.getByText('Statement of truth: Signed')).toBeTruthy();
    expect(screen.getByText('Amendment authority: Written consent')).toBeTruthy();
  });

  it('offers permission-gated statement, deadline and default-review commands', async () => {
    const governed: PleadingsWorkspace = {
      ...workspace,
      sources: {
        documents: [{ id: 'document-1', title: 'Defence', version: 1, originalName: 'defence.pdf' }],
        parties: workspace.tracks.map(({ defendant }) => defendant!).filter(Boolean),
      },
    };
    render(<PleadingsResponsesPanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={governed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add statement' }));
    expect(await screen.findByRole('dialog', { name: 'Retain statement of case' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Defence · v1/ })).toBeTruthy();
  });

  it('does not expose solicitor-only review commands to a paralegal', () => {
    const paralegal: PleadingsWorkspace = {
      ...workspace,
      permissions: {
        ...workspace.permissions,
        canApproveClaimantStatement: false,
        canReviewDefault: false,
        canRecordAmendmentAuthority: false,
      },
    };
    render(<PleadingsResponsesPanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={paralegal} />);
    expect(screen.getByRole('button', { name: 'Add statement' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review response date' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Default review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Amendment authority' })).toBeNull();
  });
});
