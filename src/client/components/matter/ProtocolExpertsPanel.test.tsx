import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProtocolWorkspace } from '../../api.js';
import { ProtocolExpertsPanel } from './ProtocolExpertsPanel.js';

const workspace = {
  matterId: 'matter-1',
  case: { id: 'case-1', version: 6, protocolStatus: 'expert_work', expertRoute: 'proposed_single_joint', expertRouteReason: 'Independent evidence required.', urgentReason: '', createdAt: '', updatedAt: '' },
  letter: {
    id: 'letter-1', version: 2, state: 'approved',
    draft: {},
    source: { model: { defects: [
      { id: 'defect-1', location: 'Bedroom', title: 'Damp and mould' },
      { id: 'defect-2', location: 'Whole property', title: 'Communal water ingress' },
    ] }, blockers: [], warnings: [] },
    authorUserId: 'user-1', reviewerUserId: 'user-1', createdAt: '', updatedAt: '',
  },
  letterVersions: [{
    id: 'letter-version-1', version: 1, model: {}, sourceManifest: {},
    templateKey: 'housing', rendererVersion: 'swiftclaim-docx-1', contentSha256: 'a'.repeat(64),
    documentVersion: { documentId: 'document-1', id: 'doc-version-1', version: 1, originalName: 'letter.docx', mimeType: 'application/docx', sizeBytes: 1234, sha256: 'b'.repeat(64), createdAt: '' },
    approvedBy: 'user-1', approvedAt: '2026-07-14T09:00:00.000Z',
    sourceFreshness: { fresh: true, added: [], changed: [], removed: [] },
  }],
  serviceEvents: [{ id: 'service-1', letterVersionId: 'letter-version-1', eventType: 'actual_receipt', method: 'email', occurredAt: '2026-07-14T10:00:00.000Z', legalTriggerOn: '2026-07-14', recipient: 'Meridian Housing', destination: 'example.test', sourceDetail: 'Acknowledged.', supportingDocumentVersionId: null, supersedesEventId: null, correctionReason: '', createdBy: 'user-1', createdAt: '' }],
  landlordResponses: [{
    id: 'response-1', responseType: 'initial', receivedOn: '2026-07-16', respondingParty: 'Meridian Housing Association', contactName: 'Repairs', generalLiabilityPosition: 'partly_admitted', liabilityReasons: 'Some conditions admitted.', noticePosition: 'Acknowledged', accessPosition: 'Requested', disclosureStatus: 'partial', disclosureSummary: 'Complaint logs remain missing.', expertProposalPosition: 'agreed', expertProposalSummary: 'Agreed.', worksSchedule: 'Inspect.', worksStartOn: null, worksCompleteOn: null, compensationOfferMinor: null, costsOfferMinor: null, currency: 'GBP', sourceDocumentVersionId: null, supersedesResponseId: null,
    defectPositions: [{ defectId: 'defect-1', position: 'partly_admitted', reason: 'Cause reserved.' }], createdBy: 'user-1', createdAt: '',
  }],
  experts: [{
    id: 'expert-1', version: 2, route: 'proposed_single_joint', expertRole: 'building_surveyor', expertName: 'Elena Ward', organisation: 'Northfield Building Surveyors', email: 'example.test', phone: '', expertise: 'Housing conditions', qualifications: 'Supplied BSc MRICS', registrationBody: 'RICS', registrationReference: 'SYNTHETIC-RICS-1042', verificationStatus: 'unverified', verificationMethod: '', verifiedOn: null, proposedBy: 'jointly', singleJoint: true, termsStatus: 'accepted', feeBasis: 'Fixed', feeMinor: 90000, currency: 'GBP', payerSplit: { claimantPercent: 50, landlordPercent: 50 }, availabilitySummary: 'Inspected.', targetReportOn: '2026-08-03', state: 'report_due', conflictChecks: [{ id: 'conflict-1', partiesChecked: ['Maya', 'Meridian'], method: 'Declaration', searchDetail: 'Clear', outcome: 'clear', decision: 'clear_to_proceed', reason: 'Reviewed.', checkedBy: 'user-1', checkedAt: '' }], instructionVersions: [], milestones: [{ id: 'milestone-1', eventType: 'inspection_completed', occurredAt: '2026-07-20T12:00:00.000Z', legalTriggerOn: '2026-07-20', detail: 'Completed.', instructionVersionId: null, supportingDocumentVersionId: null, supersedesEventId: null, createdBy: 'user-1', createdAt: '' }], reports: [], questions: [], createdAt: '', updatedAt: '',
  }],
  deadlines: [{ id: 'deadline-1', title: 'Expert report or agreed schedule', triggerDate: '2026-07-20', dueDate: '2026-08-03', status: 'pending', explanation: '10 working days after 20 July 2026 is 3 August 2026.', sourceTitle: 'Housing Conditions Protocol paragraph 7.4(b)', sourceUrl: 'https://www.justice.gov.uk/', ruleKey: 'housing.expert.report' }],
  readiness: { controls: [{ key: 'expert_instruction_confirmed', eligible: true, explanation: 'Instruction dispatched.' }], progressionBlockers: [{ key: 'report', label: 'Report missing.', severity: 'warning' }] },
  risks: [{ key: 'risk-1', type: 'report_missing', level: 'critical', title: 'Expert report overdue or missing', detail: 'No report is recorded.', entityId: 'expert-1' }],
  permissions: { canPrepare: true, canApprove: true, canOverrideConflict: false, canReviewReport: true },
} as unknown as ProtocolWorkspace;

describe('ProtocolExpertsPanel', () => {
  it('presents the governed letter, response and expert views', async () => {
    const user = userEvent.setup();
    render(<ProtocolExpertsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);

    expect(screen.getByText('Expert report overdue or missing')).toBeInTheDocument();
    expect(screen.getByText('10 working days after 20 July 2026 is 3 August 2026.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download letter of claim v1/i })).toHaveAttribute('href', expect.stringContaining('doc-version-1'));

    await user.click(screen.getByRole('button', { name: 'Landlord response' }));
    expect(screen.getByText('Partial disclosure')).toBeInTheDocument();
    expect(screen.getByText('Communal water ingress')).toBeInTheDocument();
    expect(screen.getByText('Not addressed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Experts' }));
    expect(screen.getByText('Elena Ward')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('£900.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record expert event/i })).toBeInTheDocument();
  });

  it('keeps governed mutations out of a read-only workspace', async () => {
    const user = userEvent.setup();
    render(<ProtocolExpertsPanel matterId="matter-1" workspace={{ ...workspace, permissions: { canPrepare: false, canApprove: false, canOverrideConflict: false, canReviewReport: false } }} onRefresh={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /edit preparation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve exact version/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Landlord response' }));
    expect(screen.queryByRole('button', { name: /record response/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Experts' }));
    expect(screen.queryByRole('button', { name: /record expert event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record report/i })).not.toBeInTheDocument();
  });
});
