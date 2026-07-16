import type { CommunicationTransportState } from './types.js';
import type { ProviderTransportEventType } from './provider.js';

export interface TransportEvent {
  id: string;
  eventType: ProviderTransportEventType;
  occurredAt: string;
  receivedAt: string;
  authenticated: boolean;
}

export interface TransportProjection {
  state: CommunicationTransportState;
  providerAcceptedAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  producingEventId: string | null;
}

const priority: Record<ProviderTransportEventType, number> = {
  queued: 1,
  attempting: 2,
  provider_accepted: 3,
  cancelled: 4,
  failed: 5,
  delivered: 6,
  read: 7,
};

function firstOccurred(
  events: readonly TransportEvent[],
  type: ProviderTransportEventType,
): string | null {
  return events.find((event) => event.eventType === type)?.occurredAt ?? null;
}

export function projectTransportState(
  events: readonly TransportEvent[],
): TransportProjection {
  const authenticated = events
    .filter((event) => event.authenticated)
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.receivedAt.localeCompare(right.receivedAt) ||
      left.id.localeCompare(right.id),
    );
  const producingEvent = authenticated.reduce<TransportEvent | null>(
    (current, event) => {
      if (!current || priority[event.eventType] >= priority[current.eventType]) {
        return event;
      }
      return current;
    },
    null,
  );
  return {
    state: producingEvent?.eventType ?? 'recorded',
    providerAcceptedAt: firstOccurred(authenticated, 'provider_accepted'),
    deliveredAt: firstOccurred(authenticated, 'delivered'),
    readAt: firstOccurred(authenticated, 'read'),
    failedAt: firstOccurred(authenticated, 'failed'),
    producingEventId: producingEvent?.id ?? null,
  };
}
