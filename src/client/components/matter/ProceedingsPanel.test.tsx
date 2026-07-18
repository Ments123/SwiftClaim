import { render, screen } from '@testing-library/react';
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
});
