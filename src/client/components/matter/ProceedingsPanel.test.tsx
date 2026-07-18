import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProceedingsWorkspace } from '../../api.js';
import { ProceedingsPanel } from './ProceedingsPanel.js';

const workspace: ProceedingsWorkspace = {
  proceeding: {
    id: 'proceeding-1', proceedingReference: 'CRT-001', procedureType: 'part7',
    jurisdiction: 'england_wales', courtName: 'County Court at Central London',
    caseNumber: 'K00CL123', track: 'fast', currentState: 'issued',
    issuedAt: '2026-09-10T10:00:00.000Z', disposalPosition: 'not_applicable', version: 4,
  },
  authority: { id: 'authority-1', version: 1, reviewOn: '2026-09-30' },
  events: [], filings: [],
  services: [{ id: 'service-1', serviceReference: 'SRV-001', method: 'first_class_post',
    recipientPartyId: 'party-1', currentState: 'reviewed', version: 3, events: [] }],
  applications: [], orders: [],
  directions: [{ id: 'direction-1', directionReference: 'DIR-001',
    category: 'witness_evidence', requirementText: 'Serve signed witness statements.',
    dueAt: '2026-08-20T16:00:00.000Z', currentState: 'performance_asserted', version: 2,
    projection: { state: 'performance_asserted', overdue: true, dueSoon: false }, events: [] }],
  hearings: [{ id: 'hearing-1', hearingReference: 'HRG-001', hearingType: 'case_management',
    title: 'Case management conference', startsAt: '2026-11-10T10:00:00.000Z',
    courtName: 'County Court at Central London', attendanceMode: 'in_person',
    currentState: 'listed', version: 1, projection: { state: 'listed', outcomeRecorded: false },
    resultingOrderId: null, events: [] }],
  risks: [],
};

describe('ProceedingsPanel', () => {
  it('distinguishes issue, reviewed service and unaccepted performance assertions', () => {
    render(<ProceedingsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);
    expect(screen.getAllByText('Issued')).not.toHaveLength(0);
    expect(screen.getByText('Service reviewed')).toBeTruthy();
    expect(screen.getByText('Performance asserted — evidence not accepted')).toBeTruthy();
  });

  it('keeps the next court date and overdue direction visible in its summary', () => {
    render(<ProceedingsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /next court date/i })).toBeTruthy();
    expect(screen.getByText(/1 overdue direction/i)).toBeTruthy();
  });

  it('offers a dedicated pleadings and responses view for issued proceedings', () => {
    render(<ProceedingsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pleadings & responses' })).toBeTruthy();
  });

  it('gates commands with server permissions and offers exact retained sources', async () => {
    const governed: ProceedingsWorkspace = {
      ...workspace,
      permissions: { canRead: true, canPrepare: true, canApproveIssue: true,
        canRecordExternal: true, canManageDirections: true, canManageHearings: true,
        canRecordOrder: true, canRecordRelief: true },
      sources: {
        documents: [{ id: 'document-version-1', title: 'Claim form', version: 2,
          originalName: 'sealed-claim-form.pdf' }],
        parties: [{ id: 'party-1', name: 'Meridian Housing', kind: 'opponent' }],
        users: [{ id: 'user-1', name: 'Ava Morgan', role: 'solicitor' }],
        clientInstructions: [],
      },
    };
    render(<ProceedingsPanel matterId="matter-1" workspace={governed} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filings & service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare filing' }));
    expect(await screen.findByRole('dialog', { name: 'Prepare court filing' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Claim form · v2/ })).toBeTruthy();
    expect(screen.getByText(/does not mean submission/i)).toBeTruthy();
  });

  it('records direction assertions and satisfaction through distinct event choices', async () => {
    const governed: ProceedingsWorkspace = {
      ...workspace,
      permissions: { canRead: true, canPrepare: true, canApproveIssue: false,
        canRecordExternal: true, canManageDirections: true, canManageHearings: true,
        canRecordOrder: true, canRecordRelief: false },
      sources: { documents: [], parties: [], users: [], clientInstructions: [] },
    };
    render(<ProceedingsPanel matterId="matter-1" workspace={governed} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Directions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('option', { name: 'Performance asserted' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Satisfied with evidence' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Waived by sealed order' })).toBeNull();
    expect(screen.getByText(/does not imply any broader validity/i)).toBeTruthy();
  });
});
