import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CommunicationWorkspace } from '../../api.js';
import { CommunicationsPanel } from './CommunicationsPanel.js';

const workspace: CommunicationWorkspace = {
  matterId: 'matter-1',
  permissions: {
    canWrite: true,
    canApprove: false,
    canSend: true,
    canReadPrivileged: true,
    canReadProtected: true,
    canManageProvider: false,
  },
  counts: { total: 2, inbound: 1, outbound: 1, drafts: 1 },
  entries: [
    {
      id: 'entry-email-1',
      conversationId: 'conversation-1',
      channel: 'email',
      direction: 'inbound',
      confidentiality: 'ordinary',
      participants: [{ role: 'from', displayName: 'Harbour Homes Legal', endpointType: 'email', endpoint: 'legal@harbourhomes.test', partyId: null, userId: null }],
      subject: 'Repair appointment',
      body: 'The contractor proposes Friday morning.',
      bodyFormat: 'plain',
      occurredAt: '2026-07-16T08:30:00.000Z',
      recordedAt: '2026-07-16T09:00:00.000Z',
      recordedBy: 'user-1',
      source: 'manual',
      providerKey: null,
      externalMessageId: null,
      externalThreadId: null,
      supersedesEntryId: null,
      correctionReason: '',
      attachments: [{ documentVersionId: 'version-1', purpose: 'attachment', fileName: 'repair-letter.pdf', sha256: 'a'.repeat(64) }],
      call: null,
      serviceAssertion: null,
      transport: { state: 'recorded', providerAcceptedAt: null, deliveredAt: null, readAt: null, failedAt: null, producingEventId: null },
    },
    {
      id: 'entry-call-1',
      conversationId: 'conversation-2',
      channel: 'telephone',
      direction: 'outbound',
      confidentiality: 'ordinary',
      participants: [{ role: 'callee', displayName: 'Maya Patel', endpointType: 'phone', endpoint: '+447700900001', partyId: null, userId: null }],
      subject: 'Client update call',
      body: 'Identity confirmed and repair access discussed.',
      bodyFormat: 'structured_note',
      occurredAt: '2026-07-16T08:00:00.000Z',
      recordedAt: '2026-07-16T09:00:00.000Z',
      recordedBy: 'user-1',
      source: 'manual',
      providerKey: null,
      externalMessageId: null,
      externalThreadId: null,
      supersedesEntryId: null,
      correctionReason: '',
      attachments: [],
      call: { id: 'call-1', providerKey: 'manual', startedAt: '2026-07-16T08:00:00.000Z', endedAt: '2026-07-16T08:05:00.000Z', durationSeconds: 300, purpose: 'Client update', outcome: 'Access discussed', identityCheckStatus: 'confirmed', identityCheckNote: 'Name and address confirmed.', recordingStatus: 'not_recorded', noticeConsentBasis: '', externalCallId: null },
      serviceAssertion: null,
      transport: { state: 'recorded', providerAcceptedAt: null, deliveredAt: null, readAt: null, failedAt: null, producingEventId: null },
    },
  ],
  drafts: [
    {
      id: 'draft-1',
      conversationId: 'conversation-3',
      channel: 'whatsapp',
      confidentiality: 'ordinary',
      status: 'dispatched',
      recordVersion: 2,
      currentVersion: { id: 'draft-version-1', version: 1, participants: [{ role: 'to', displayName: 'Maya Patel', endpointType: 'whatsapp', endpoint: '+447700900001', partyId: null, userId: null }], subject: 'Appointment reminder', body: 'Friday at 10am.', bodyFormat: 'plain', attachments: [], createdBy: 'user-1', createdAt: '2026-07-16T08:00:00.000Z' },
      currentApproval: null,
      dispatch: { id: 'dispatch-1', providerKey: 'evaluation', status: 'provider_accepted', externalMessageId: 'eval-1', lastErrorCode: null, lastErrorDetail: null, createdAt: '2026-07-16T08:00:00.000Z', lastEventAt: '2026-07-16T08:00:00.000Z', transport: { state: 'provider_accepted', providerAcceptedAt: '2026-07-16T08:00:00.000Z', deliveredAt: null, readAt: null, failedAt: null, producingEventId: 'event-1' } },
      createdBy: 'user-1', createdAt: '2026-07-16T08:00:00.000Z', updatedBy: 'user-1', updatedAt: '2026-07-16T08:00:00.000Z',
    },
  ],
  providerCapabilities: [{
    key: 'evaluation',
    operations: { send_email: true, send_whatsapp_message: true, start_whatsapp_call: false, receive_events: true, delivery_receipts: false },
    reasons: { start_whatsapp_call: 'Not enabled for the evaluation provider.', delivery_receipts: 'The evaluation provider records acceptance only.' },
  }],
};

describe('CommunicationsPanel', () => {
  it('labels provider acceptance without claiming delivery', () => {
    render(<CommunicationsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);

    expect(screen.getByText('Accepted by provider')).toBeInTheDocument();
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
    expect(screen.getByText('repair-letter.pdf')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaaaaa…')).toBeInTheDocument();
  });

  it('shows WhatsApp Calling as unavailable with the provider reason', () => {
    render(<CommunicationsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start WhatsApp call' })).toBeDisabled();
    expect(screen.getByText('Not enabled for the evaluation provider.')).toBeInTheDocument();
  });

  it('filters the ledger by channel using an accessible control', async () => {
    render(<CommunicationsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Channel' }), 'telephone');

    expect(screen.getAllByText('Client update call')).toHaveLength(2);
    expect(screen.queryByText('Repair appointment')).not.toBeInTheDocument();
  });

  it('requires a separate confirmation dialog before external dispatch', async () => {
    const approved = {
      ...workspace,
      drafts: [{
        ...workspace.drafts[0]!,
        status: 'approved',
        recordVersion: 3,
        dispatch: null,
        currentApproval: {
          id: 'approval-1',
          decision: 'approved',
          note: 'Reviewed exact version.',
          actorUserId: 'partner-1',
          occurredAt: '2026-07-16T08:30:00.000Z',
        },
      }],
    };
    render(<CommunicationsPanel matterId="matter-1" workspace={approved} onRefresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Dispatch approved draft' }));
    expect(screen.getByRole('dialog', { name: 'Confirm external dispatch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm dispatch' })).toBeEnabled();
  });
});
