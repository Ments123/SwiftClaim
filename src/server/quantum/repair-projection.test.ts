import { describe, expect, it } from 'vitest';

import { projectRepairState, RepairProjectionError } from './repair-projection.js';

const item = {
  id: '81000000-0000-4000-8000-000000000001',
  priority: 'urgent' as const,
  targetCompletionOn: '2026-07-10',
};

const event = (
  id: string,
  eventType:
    | 'proposed'
    | 'appointment_booked'
    | 'access_offered'
    | 'access_provided'
    | 'access_refused'
    | 'access_unavailable'
    | 'started'
    | 'paused'
    | 'completion_asserted'
    | 'client_disputes_completion'
    | 'failed_inspection'
    | 'verified_complete'
    | 'superseded',
  occurredAt: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  eventType,
  occurredAt,
  createdAt: occurredAt,
  actorType: 'contractor' as const,
  evidenceIds: [] as string[],
  verifier: '',
  supersedesEventId: null as string | null,
  ...extra,
});

describe('projectRepairState', () => {
  it('folds appointments, access and progress into a current factual state', () => {
    const result = projectRepairState(
      item,
      [
        event('1', 'proposed', '2026-07-01T09:00:00.000Z'),
        event('2', 'appointment_booked', '2026-07-02T09:00:00.000Z'),
        event('3', 'access_provided', '2026-07-04T09:00:00.000Z', {
          actorType: 'client',
        }),
        event('4', 'started', '2026-07-04T10:00:00.000Z'),
        event('5', 'paused', '2026-07-04T14:00:00.000Z'),
      ],
      '2026-07-15',
    );

    expect(result).toMatchObject({
      status: 'paused',
      producingEventId: '5',
      lastAccessOutcome: 'provided',
      completionAsserted: false,
      clientPosition: 'not_recorded',
      verification: 'not_verified',
    });
    expect(result.warnings.map(({ key }) => key)).toEqual([
      'urgent_outstanding',
      'target_overdue',
    ]);
  });

  it('does not equate a contractor completion assertion with verification', () => {
    const result = projectRepairState(
      item,
      [event('1', 'completion_asserted', '2026-07-09T12:00:00.000Z')],
      '2026-07-15',
    );

    expect(result).toMatchObject({
      status: 'completion_asserted',
      completionAsserted: true,
      clientPosition: 'not_recorded',
      verification: 'not_verified',
    });
    expect(result.warnings.map(({ key }) => key)).toContain(
      'completion_unverified',
    );
  });

  it('projects a client dispute and failed inspection after an assertion', () => {
    const result = projectRepairState(
      item,
      [
        event('1', 'completion_asserted', '2026-07-09T12:00:00.000Z'),
        event('2', 'client_disputes_completion', '2026-07-10T08:00:00.000Z', {
          actorType: 'client',
        }),
        event('3', 'failed_inspection', '2026-07-11T08:00:00.000Z', {
          actorType: 'expert',
        }),
      ],
      '2026-07-15',
    );

    expect(result).toMatchObject({
      status: 'failed_inspection',
      completionAsserted: true,
      clientPosition: 'disputed',
      verification: 'failed',
    });
    expect(result.warnings.map(({ key }) => key)).toContain(
      'completion_disputed',
    );
  });

  it('requires evidence and an explicit verifier for verified completion', () => {
    expect(() =>
      projectRepairState(
        item,
        [
          event('1', 'verified_complete', '2026-07-12T08:00:00.000Z', {
            actorType: 'expert',
          }),
        ],
        '2026-07-15',
      ),
    ).toThrowError(
      new RepairProjectionError(
        'Verified completion requires a verifier and completion evidence.',
      ),
    );
  });

  it('projects verified completion without overdue or urgent warnings', () => {
    const result = projectRepairState(
      item,
      [
        event('1', 'completion_asserted', '2026-07-09T12:00:00.000Z'),
        event('2', 'verified_complete', '2026-07-12T08:00:00.000Z', {
          actorType: 'expert',
          verifier: 'A. Surveyor MRICS',
          evidenceIds: ['76000000-0000-4000-8000-000000000001'],
        }),
      ],
      '2026-07-15',
    );

    expect(result).toMatchObject({
      status: 'verified_complete',
      completionAsserted: true,
      clientPosition: 'not_recorded',
      verification: 'verified',
    });
    expect(result.warnings).toEqual([]);
  });

  it('removes an explicitly superseded event and orders ties by creation then id', () => {
    const result = projectRepairState(
      item,
      [
        event('a', 'access_refused', '2026-07-05T08:00:00.000Z', {
          actorType: 'client',
        }),
        event('b', 'superseded', '2026-07-06T08:00:00.000Z', {
          actorType: 'solicitor',
          supersedesEventId: 'a',
        }),
        event('c', 'access_unavailable', '2026-07-07T08:00:00.000Z', {
          actorType: 'client',
          createdAt: '2026-07-07T08:00:00.000Z',
        }),
        event('d', 'access_provided', '2026-07-07T08:00:00.000Z', {
          actorType: 'client',
          createdAt: '2026-07-07T08:00:00.000Z',
        }),
      ],
      '2026-07-08',
    );

    expect(result.lastAccessOutcome).toBe('provided');
    expect(result.status).toBe('access_provided');
  });
});
