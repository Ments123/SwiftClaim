import { createHash, timingSafeEqual } from 'node:crypto';

import {
  CommunicationProviderError,
  type CommunicationProvider,
  type CommunicationProviderCapabilities,
  type ProviderDispatchCommand,
  type ProviderDispatchResult,
  type ProviderEventInput,
  type VerifiedProviderEvent,
} from './provider.js';

export class EvaluationCommunicationProvider implements CommunicationProvider {
  readonly key = 'evaluation';

  constructor(
    private readonly now: () => Date,
    private readonly signingSecret: string,
  ) {}

  async capabilities(): Promise<CommunicationProviderCapabilities> {
    return {
      key: this.key,
      operations: {
        send_email: true,
        send_whatsapp_message: true,
        start_whatsapp_call: false,
        receive_events: true,
        delivery_receipts: false,
      },
      reasons: {
        start_whatsapp_call: 'Not enabled for the evaluation provider.',
        delivery_receipts: 'The evaluation provider records acceptance only.',
      },
    };
  }

  async dispatch(command: ProviderDispatchCommand): Promise<ProviderDispatchResult> {
    if (!['email', 'whatsapp'].includes(command.channel)) {
      throw new CommunicationProviderError(
        'PROVIDER_CAPABILITY_UNAVAILABLE',
        'That channel is not enabled for the evaluation provider.',
      );
    }
    const digest = createHash('sha256')
      .update(`${command.dispatchId}:${command.idempotencyKey}`)
      .digest('hex')
      .slice(0, 24);
    return {
      providerEventId: `evaluation:${digest}`,
      type: 'provider_accepted',
      occurredAt: this.now().toISOString(),
      externalMessageId: `eval-${digest}`,
      safePayload: { mode: 'evaluation', networkCall: false },
    };
  }

  async verifyEvent(input: ProviderEventInput): Promise<VerifiedProviderEvent> {
    const unsigned = {
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      safePayload: input.safePayload,
    };
    const expected = createHash('sha256')
      .update(`${this.signingSecret}:${JSON.stringify(unsigned)}`)
      .digest();
    const supplied = /^[a-f0-9]{64}$/.test(input.signature)
      ? Buffer.from(input.signature, 'hex')
      : Buffer.alloc(expected.length);
    return {
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      authenticated: timingSafeEqual(expected, supplied),
      authenticationMethod: 'evaluation_sha256',
      safePayload: input.safePayload,
    };
  }
}
