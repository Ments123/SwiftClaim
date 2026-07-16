import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { EvaluationCommunicationProvider } from './evaluation-provider.js';

const now = () => new Date('2026-07-16T09:00:00.000Z');

describe('evaluation communication provider', () => {
  it('advertises supported messaging and unavailable WhatsApp Calling', async () => {
    const provider = new EvaluationCommunicationProvider(now, 'evaluation-secret');

    await expect(provider.capabilities()).resolves.toMatchObject({
      key: 'evaluation',
      operations: {
        send_email: true,
        send_whatsapp_message: true,
        start_whatsapp_call: false,
        receive_events: true,
        delivery_receipts: false,
      },
      reasons: {
        start_whatsapp_call: 'Not enabled for the evaluation provider.',
      },
    });
  });

  it('returns provider acceptance without claiming delivery', async () => {
    const provider = new EvaluationCommunicationProvider(now, 'evaluation-secret');
    await expect(
      provider.dispatch({
        dispatchId: 'dispatch-1',
        idempotencyKey: 'dispatch-evaluation-001',
        channel: 'email',
        participants: [{ role: 'to', displayName: 'Recipient', endpointType: 'email', endpoint: 'recipient@example.test', partyId: null, userId: null }],
        subject: 'Synthetic message',
        body: 'Evaluation content only.',
        bodyFormat: 'plain',
        attachments: [],
      }),
    ).resolves.toMatchObject({
      type: 'provider_accepted',
      occurredAt: '2026-07-16T09:00:00.000Z',
    });
  });

  it('verifies signed events and quarantines invalid signatures', async () => {
    const provider = new EvaluationCommunicationProvider(now, 'evaluation-secret');
    const payload = {
      providerEventId: 'event-1',
      eventType: 'delivered' as const,
      occurredAt: '2026-07-16T09:01:00.000Z',
      safePayload: { dispatchId: 'dispatch-1' },
    };
    const signature = createHash('sha256')
      .update(`evaluation-secret:${JSON.stringify(payload)}`)
      .digest('hex');

    await expect(provider.verifyEvent({ ...payload, signature })).resolves.toMatchObject({ authenticated: true });
    await expect(provider.verifyEvent({ ...payload, signature: 'invalid-signature' })).resolves.toMatchObject({ authenticated: false });
  });
});
