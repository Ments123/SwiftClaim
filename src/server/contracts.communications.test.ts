import { describe, expect, it } from 'vitest';

import {
  createCommunicationDraftSchema,
  dispatchCommunicationSchema,
  recordCommunicationCallSchema,
  recordCommunicationSchema,
} from '../shared/contracts.js';

const recipient = {
  role: 'to',
  displayName: 'Harbour Homes Legal',
  endpointType: 'email',
  endpoint: 'legal@harbourhomes.test',
};

describe('communication contracts', () => {
  it('rejects an internal draft addressed to an external endpoint', () => {
    const result = createCommunicationDraftSchema.safeParse({
      channel: 'internal',
      confidentiality: 'internal',
      participants: [recipient],
      subject: 'Private case analysis',
      body: 'This note must remain inside the firm.',
      bodyFormat: 'plain',
      attachmentVersionIds: [],
    });

    expect(result.success).toBe(false);
  });

  it('requires literal confirmation for dispatch', () => {
    expect(
      dispatchCommunicationSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: 'dispatch-evaluation-001',
        providerKey: 'evaluation',
        confirmed: false,
      }).success,
    ).toBe(false);
  });

  it('requires notice or consent metadata for a recording attachment', () => {
    const result = recordCommunicationCallSchema.safeParse({
      idempotencyKey: 'manual-call-001',
      channel: 'telephone',
      confidentiality: 'ordinary',
      direction: 'outbound',
      participants: [{ ...recipient, role: 'callee', endpointType: 'phone', endpoint: '+442071234567' }],
      occurredAt: '2026-07-16T09:00:00.000Z',
      subject: 'Repair access call',
      body: 'The client confirmed access for Friday morning.',
      startedAt: '2026-07-16T09:00:00.000Z',
      endedAt: '2026-07-16T09:05:00.000Z',
      purpose: 'Confirm repair access.',
      outcome: 'Access confirmed for Friday morning.',
      identityCheckStatus: 'confirmed',
      identityCheckNote: 'Name, address and matter reference confirmed.',
      recordingStatus: 'not_recorded',
      noticeConsentBasis: '',
      attachmentVersionIds: ['00000000-0000-4000-8000-000000000001'],
      recordingVersionIds: ['00000000-0000-4000-8000-000000000001'],
    });

    expect(result.success).toBe(false);
  });

  it('accepts a canonical manual inbound email record', () => {
    expect(
      recordCommunicationSchema.parse({
        idempotencyKey: 'manual-email-001',
        channel: 'email',
        direction: 'inbound',
        confidentiality: 'ordinary',
        participants: [{ ...recipient, role: 'from' }],
        subject: 'Repair appointment',
        body: 'The contractor proposes attendance on Friday morning.',
        bodyFormat: 'plain',
        occurredAt: '2026-07-16T08:30:00.000Z',
        attachmentVersionIds: [],
        source: 'manual',
        providerKey: null,
        externalMessageId: null,
        externalThreadId: null,
        supersedesEntryId: null,
        correctionReason: '',
      }),
    ).toMatchObject({ channel: 'email', direction: 'inbound' });
  });
});
