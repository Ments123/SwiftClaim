import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DisclosureCandidateRecord, DisclosureWorkspace } from '../../api.js';
import { DisclosurePanel } from './DisclosurePanel.js';

const candidate: DisclosureCandidateRecord = {
  id: 'candidate-1', reviewId: 'review-1', documentVersionId: 'version-1', evidenceItemId: null,
  custodian: 'Maya Clarke', sourceNote: 'Repair chronology', version: 2,
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
  suggestions: [{ id: 'suggestion-1', relevance: 'uncertain', privilegeWarning: 'none',
    rationale: 'Human review required.', model: 'evaluation-local-v1', policyVersion: 'disclosure-evaluation-v1',
    sourceHash: 'a'.repeat(64), citedSpans: [], suggestedIssueTags: [], createdBy: 'user-1',
    createdAt: '2026-10-01T10:00:00.000Z', provisional: true }],
  decisions: [{ id: 'decision-1', decision: 'review_required', redactionRequired: false,
    reason: 'Requires review.', reviewedBy: 'user-1', reviewedAt: '2026-10-01T11:00:00.000Z', createdAt: '2026-10-01T11:00:00.000Z' }],
  privilegeReviews: [], redactions: [],
  projection: { state: 'human_decision_recorded', restricted: false, canList: false,
    effectiveDocumentVersionId: 'version-1', suggestion: null, decision: null, privilege: null, redaction: null },
};

const workspace: DisclosureWorkspace = {
  proceedingId: 'proceeding-1', actingUserId: 'user-1',
  reviews: [{ id: 'review-1', proceedingId: 'proceeding-1', disclosingPartyId: 'party-1', directionId: null,
    scopeVersion: 1, scopeNote: 'Repair and notice issues.', dateFrom: null, dateTo: null,
    custodians: ['Maya Clarke'], issueTags: ['repairs'], version: 2,
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
    candidates: [candidate], lists: [{ id: 'list-1', reviewId: 'review-1', disclosingPartyId: 'party-1',
      snapshotNumber: 1, title: 'Claimant disclosure list', blockers: [{ candidateId: 'candidate-1', reason: 'human_decision_required' }],
      generatedBy: 'user-1', generatedAt: '2026-10-01T12:00:00.000Z', note: 'Snapshot.', entries: [] }],
    inspectionRequests: [{ id: 'inspection-1', disclosureListId: 'list-1', requestingPartyId: 'party-2',
      version: 2, receivedAt: '2026-10-02T10:00:00.000Z', note: 'Request.', itemIds: [],
      createdAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T11:00:00.000Z', events: [],
      projection: { received: true, acknowledged: false, refused: false, agreed: false, provided: true, completed: false, events: [] } }],
  }],
  sources: { documents: [{ id: 'version-1', title: 'Repair chronology', version: 1, originalName: 'repairs.pdf' }],
    parties: [{ id: 'party-1', name: 'Maya Clarke', kind: 'client' }, { id: 'party-2', name: 'Meridian Housing', kind: 'opponent' }] },
  permissions: { canRead: true, canPrepare: true, canReview: true, canReviewPrivilege: true,
    canWaivePrivilege: false, canApproveRedaction: true, canGenerateList: true, canRecordExternal: true },
};

describe('DisclosurePanel', () => {
  it('separates provisional AI output from the human decision', () => {
    render(<DisclosurePanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={workspace} />);
    expect(screen.getByText('AI suggestion — human review required')).toBeTruthy();
    expect(screen.getByText('Human decision: Review required')).toBeTruthy();
  });

  it('shows safe restricted metadata without a document title', () => {
    const restricted: DisclosureWorkspace = { ...workspace, reviews: [{ ...workspace.reviews[0]!,
      candidates: [{ id: 'restricted-1', reviewId: 'review-1', version: 2, restricted: true,
        state: 'human_review_required', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' }] }],
      permissions: { ...workspace.permissions, canReview: false, canReviewPrivilege: false, canApproveRedaction: false,
        canGenerateList: false, canWaivePrivilege: false } };
    render(<DisclosurePanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={restricted} />);
    expect(screen.getByText('Restricted document')).toBeTruthy();
    expect(screen.queryByText('Repair chronology')).toBeNull();
  });

  it('offers four operational views and hides waiver from solicitors', () => {
    render(<DisclosurePanel matterId="matter-1" proceedingId="proceeding-1" initialWorkspace={workspace} />);
    expect(screen.getByRole('button', { name: 'Review queue' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Inspection' }));
    expect(screen.getByText('Provided — completion not recorded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record privilege waiver' })).toBeNull();
  });
});
