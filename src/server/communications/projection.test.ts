import { describe, expect, it } from 'vitest';

import { projectTransportState, type TransportEvent } from './projection.js';

function event(
  eventType: TransportEvent['eventType'],
  occurredAt: string,
  authenticated = true,
): TransportEvent {
  return {
    id: `${eventType}-${occurredAt}`,
    eventType,
    occurredAt,
    receivedAt: occurredAt,
    authenticated,
  };
}

describe('communication transport projection', () => {
  it('does not promote provider acceptance to delivery', () => {
    expect(
      projectTransportState([
        event('queued', '2026-07-16T09:00:00.000Z'),
        event('attempting', '2026-07-16T09:00:01.000Z'),
        event('provider_accepted', '2026-07-16T09:00:02.000Z'),
      ]),
    ).toEqual({
      state: 'provider_accepted',
      providerAcceptedAt: '2026-07-16T09:00:02.000Z',
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      producingEventId: 'provider_accepted-2026-07-16T09:00:02.000Z',
    });
  });

  it('ignores unauthenticated delivery claims', () => {
    expect(
      projectTransportState([
        event('provider_accepted', '2026-07-16T09:00:00.000Z'),
        event('delivered', '2026-07-16T09:01:00.000Z', false),
      ]).state,
    ).toBe('provider_accepted');
  });

  it('keeps read evidence when a later failure event arrives', () => {
    expect(
      projectTransportState([
        event('delivered', '2026-07-16T09:01:00.000Z'),
        event('read', '2026-07-16T09:02:00.000Z'),
        event('failed', '2026-07-16T09:03:00.000Z'),
      ]).state,
    ).toBe('read');
  });
});
