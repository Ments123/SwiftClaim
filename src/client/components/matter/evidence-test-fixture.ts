import type { EvidenceWorkspace } from '../../api.js';

export const evidenceWorkspace: EvidenceWorkspace = {
  matterId: 'matter-1',
  permissions: { canWrite: true },
  defects: [
    {
      id: 'defect-1', version: 1, location: 'Main bedroom', category: 'damp_mould',
      title: 'Damp and black mould', description: 'Black mould surrounds the bedroom window.',
      severity: 'serious', status: 'open', firstObservedOn: '2025-10-12',
      healthImpact: 'Room is difficult to use.', hazardTags: ['damp'], createdBy: 'user-1',
      createdAt: '2026-07-13T08:30:00.000Z', updatedBy: 'user-1',
      updatedAt: '2026-07-13T08:30:00.000Z', evidenceIds: ['evidence-1'],
      statusEvents: [{ id: 'status-1', fromStatus: null, toStatus: 'open', reason: 'Recorded.', actorUserId: 'user-1', occurredAt: '2026-07-13T08:30:00.000Z' }],
    },
    {
      id: 'defect-2', version: 2, location: 'Main bedroom', category: 'leak',
      title: 'Window leak', description: 'Rain enters at the window frame.', severity: 'moderate',
      status: 'monitoring', firstObservedOn: null, healthImpact: '', hazardTags: [],
      createdBy: 'user-1', createdAt: '2026-07-13T08:30:00.000Z', updatedBy: 'user-1',
      updatedAt: '2026-07-14T08:30:00.000Z', evidenceIds: [], statusEvents: [],
    },
  ],
  notices: [{
    id: 'notice-1', occurredAt: '2026-01-10T10:30:00.000Z', channel: 'email',
    recipientType: 'landlord', recipientName: 'Meridian Housing Association',
    summary: 'Reported bedroom damp and requested inspection.', proofStatus: 'linked',
    responseStatus: 'acknowledged', responseSummary: 'Acknowledged.', supersedesNoticeId: null,
    createdBy: 'user-1', createdAt: '2026-07-13T08:30:00.000Z', evidenceIds: ['evidence-1'],
  }],
  accessEvents: [{
    id: 'access-1', eventType: 'no_access', appointmentAt: '2026-02-02T14:00:00.000Z',
    notes: 'Contractor did not attend.', supersedesAccessEventId: null, createdBy: 'user-1',
    createdAt: '2026-07-13T08:30:00.000Z', evidenceIds: [],
  }],
  evidenceItems: [],
  availableDocumentVersions: [],
  readiness: { controls: [
    { key: 'defect_schedule_recorded', eligible: true, explanation: 'The active defect schedule is structured.' },
    { key: 'notice_evidence_recorded', eligible: true, explanation: 'A notice proof position is recorded.' },
    { key: 'photographs_recorded', eligible: false, explanation: 'Link a photograph.' },
  ] },
  risks: [
    { key: 'serious:defect-1', type: 'serious_open_defect', level: 'high', title: 'Serious unresolved defect', detail: 'Main bedroom: Damp and black mould', entityId: 'defect-1' },
    { key: 'failed:access-1', type: 'failed_access', level: 'medium', title: 'Access did not complete', detail: 'Contractor did not attend.', entityId: 'access-1' },
  ],
};

