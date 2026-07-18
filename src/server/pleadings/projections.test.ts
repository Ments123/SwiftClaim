import { describe, expect, it } from 'vitest';

import {
  projectDefaultReview,
  projectResponseTrack,
  projectStatement,
  type StatementProjectionEvent,
} from './projections.js';

const event = (
  id: string,
  eventType: StatementProjectionEvent['eventType'],
  supersedesEventId: string | null = null,
): StatementProjectionEvent => ({
  id,
  eventType,
  occurredAt: `2026-07-${id.padStart(2, '0')}T10:00:00.000Z`,
  recordedAt: `2026-07-${id.padStart(2, '0')}T10:01:00.000Z`,
  supersedesEventId,
});

describe('pleading projections', () => {
  it('keeps filing, provider acknowledgment, acceptance and service distinct', () => {
    const projection = projectStatement([
      event('1', 'prepared'), event('2', 'filed'),
      event('3', 'provider_acknowledged'), event('4', 'court_accepted'),
    ]);
    expect(projection).toMatchObject({ filingState: 'court_accepted', serviceState: 'not_served' });
    expect(projectStatement([...projection.events, event('5', 'served')]).serviceState).toBe('served');
  });

  it('omits an event replaced by a correction', () => {
    const projection = projectStatement([
      event('1', 'prepared'), event('2', 'filed'), event('3', 'corrected', '2'),
    ]);
    expect(projection.events.map(({ id }) => id)).toEqual(['1', '3']);
    expect(projection.filingState).toBe('not_filed');
  });

  it('keeps a stayed response track stayed until lifted', () => {
    const base = [
      { id: '1', eventType: 'track_opened' as const, occurredAt: '2026-07-01T10:00:00.000Z', recordedAt: '2026-07-01T10:00:01.000Z', supersedesEventId: null },
      { id: '2', eventType: 'stay_recorded' as const, occurredAt: '2026-07-02T10:00:00.000Z', recordedAt: '2026-07-02T10:00:01.000Z', supersedesEventId: null },
    ];
    expect(projectResponseTrack(base).state).toBe('stayed');
    expect(projectResponseTrack([...base, {
      id: '3', eventType: 'stay_lifted' as const, occurredAt: '2026-07-03T10:00:00.000Z', recordedAt: '2026-07-03T10:00:01.000Z', supersedesEventId: null,
    }]).state).toBe('open');
  });

  it('exposes only neutral default review outcomes', () => {
    expect(projectDefaultReview({ outcome: 'blockers_recorded', blockers: ['Service question unresolved'] }))
      .toEqual({ label: 'Blockers recorded', blockers: ['Service question unresolved'] });
  });
});
