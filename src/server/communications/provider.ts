import type {
  CommunicationChannel,
  CommunicationParticipantInput,
} from '../../shared/contracts.js';

export type CommunicationProviderOperation =
  | 'send_email'
  | 'send_whatsapp_message'
  | 'start_whatsapp_call'
  | 'receive_events'
  | 'delivery_receipts';

export interface CommunicationProviderCapabilities {
  key: string;
  operations: Record<CommunicationProviderOperation, boolean>;
  reasons: Partial<Record<CommunicationProviderOperation, string>>;
}

export interface ProviderAttachment {
  documentVersionId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
}

export interface ProviderDispatchCommand {
  dispatchId: string;
  idempotencyKey: string;
  channel: CommunicationChannel;
  participants: CommunicationParticipantInput[];
  subject: string;
  body: string;
  bodyFormat: 'plain' | 'html' | 'structured_note';
  attachments: ProviderAttachment[];
}

export type ProviderTransportEventType =
  | 'queued'
  | 'attempting'
  | 'provider_accepted'
  | 'delivered'
  | 'failed'
  | 'read'
  | 'cancelled';

export interface ProviderDispatchResult {
  providerEventId: string;
  type: ProviderTransportEventType;
  occurredAt: string;
  externalMessageId: string | null;
  safePayload: Record<string, unknown>;
}

export interface ProviderEventInput {
  providerEventId: string;
  eventType: ProviderTransportEventType;
  occurredAt: string;
  signature: string;
  safePayload: Record<string, unknown>;
}

export interface VerifiedProviderEvent {
  providerEventId: string;
  eventType: ProviderTransportEventType;
  occurredAt: string;
  authenticated: boolean;
  authenticationMethod: string;
  externalMessageId?: string | null;
  safePayload: Record<string, unknown>;
}

export class CommunicationProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_CAPABILITY_UNAVAILABLE' | 'PROVIDER_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationProviderError';
  }
}

export interface CommunicationProvider {
  readonly key: string;
  capabilities(): Promise<CommunicationProviderCapabilities>;
  dispatch(command: ProviderDispatchCommand): Promise<ProviderDispatchResult>;
  verifyEvent(input: ProviderEventInput): Promise<VerifiedProviderEvent>;
}

export class CommunicationProviderRegistry {
  private readonly providers: Map<string, CommunicationProvider>;

  constructor(providers: readonly CommunicationProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.key, provider]));
  }

  require(key: string): CommunicationProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new CommunicationProviderError(
        'PROVIDER_NOT_FOUND',
        'The communication provider is not configured.',
      );
    }
    return provider;
  }

  async capabilities(): Promise<CommunicationProviderCapabilities[]> {
    return Promise.all([...this.providers.values()].map((provider) => provider.capabilities()));
  }
}
