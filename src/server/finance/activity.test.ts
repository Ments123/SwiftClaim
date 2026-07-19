import { describe, expect, it } from 'vitest';

import {
  projectTimerSessions,
  suggestTimeFromActivity,
  type SafeActivityFact,
} from './activity.js';

describe('safe finance activity suggestions', () => {
  const callFact = {
    sourceKind: 'communication_call',
    id: 'call-1',
    firmId: 'firm-1',
    matterId: 'matter-1',
    userId: 'user-1',
    observedMinutes: 18,
    occurredAt: '2026-07-19T09:00:00.000Z',
    direction: 'outbound',
  } as const;

  it('creates one deterministic provisional suggestion from a safe call fact', () => {
    const result = suggestTimeFromActivity(callFact);

    expect(result).toEqual(suggestTimeFromActivity(callFact));
    expect(result).toMatchObject({
      label: 'AI suggestion — human review required',
      firmId: 'firm-1',
      matterId: 'matter-1',
      userId: 'user-1',
      sourceKind: 'communication_call',
      sourceId: 'call-1',
      minutes: 18,
      proposedActivityCode: 'telephone_attendance',
      proposedCostsPhase: 'communications',
      confidence: 'high',
      model: 'finance-activity-rules-v1',
      policyVersion: 'finance-time-suggestion-v1',
    });
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('posted');
    expect(result).not.toHaveProperty('approved');
  });

  it('whitelists metadata and never consumes supplied content text', () => {
    const withRestrictedContent = {
      ...callFact,
      messageBody: 'Privileged advice that must never enter finance AI.',
      transcript: 'Restricted call transcript.',
    };

    expect(suggestTimeFromActivity(withRestrictedContent)).toEqual(
      suggestTimeFromActivity(callFact),
    );
  });

  it('supports every approved source adapter with neutral narratives', () => {
    const facts: SafeActivityFact[] = [
      { sourceKind: 'task', id: 'task-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', observedMinutes: 12, occurredAt: '2026-07-19T09:00:00.000Z', taskType: 'case_review' },
      { ...callFact },
      { sourceKind: 'document_version', id: 'doc-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', observedMinutes: 24, occurredAt: '2026-07-19T09:00:00.000Z', documentCategory: 'draft' },
      { sourceKind: 'filing', id: 'filing-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', observedMinutes: 9, occurredAt: '2026-07-19T09:00:00.000Z', filingType: 'court' },
      { sourceKind: 'hearing', id: 'hearing-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', observedMinutes: 60, occurredAt: '2026-07-19T09:00:00.000Z', hearingType: 'directions' },
      { sourceKind: 'timer', id: 'timer-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', observedMinutes: 31, occurredAt: '2026-07-19T09:00:00.000Z', activityCode: 'research', costsPhase: 'evidence' },
    ];

    const results = facts.map(suggestTimeFromActivity);
    expect(results.map(({ sourceKind }) => sourceKind)).toEqual([
      'task', 'communication_call', 'document_version', 'filing', 'hearing', 'timer',
    ]);
    expect(results.every(({ proposedNarrative }) => !/privileged|transcript|body/i.test(proposedNarrative))).toBe(true);
    expect(results.at(-1)).toMatchObject({ proposedActivityCode: 'research', proposedCostsPhase: 'evidence' });
  });

  it('rejects invalid observed time and timestamps', () => {
    expect(() => suggestTimeFromActivity({ ...callFact, observedMinutes: 0 })).toThrow(/minutes/i);
    expect(() => suggestTimeFromActivity({ ...callFact, occurredAt: 'not-a-date' })).toThrow(/timestamp/i);
  });
});

describe('finance timer projection', () => {
  it('automatically stops a prior running timer when the user starts another', () => {
    const projection = projectTimerSessions([
      { id: 'event-1', timerId: 'timer-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'started', occurredAt: '2026-07-19T09:00:00.000Z' },
      { id: 'event-2', timerId: 'timer-2', firmId: 'firm-1', matterId: 'matter-2', userId: 'user-1', eventType: 'started', occurredAt: '2026-07-19T09:18:00.000Z' },
    ]);

    expect(projection.sessions).toEqual([
      expect.objectContaining({ timerId: 'timer-1', status: 'stopped', elapsedMinutes: 18, stopReason: 'superseded', supersededByTimerId: 'timer-2' }),
      expect.objectContaining({ timerId: 'timer-2', status: 'running', elapsedMinutes: null }),
    ]);
    expect(projection.runningByUser).toEqual({ 'user-1': 'timer-2' });
  });

  it('projects explicit stop and cancellation events', () => {
    const projection = projectTimerSessions([
      { id: 'event-1', timerId: 'timer-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'started', occurredAt: '2026-07-19T09:00:00.000Z' },
      { id: 'event-2', timerId: 'timer-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'stopped', occurredAt: '2026-07-19T09:07:30.000Z' },
      { id: 'event-3', timerId: 'timer-2', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'started', occurredAt: '2026-07-19T09:08:00.000Z' },
      { id: 'event-4', timerId: 'timer-2', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'cancelled', occurredAt: '2026-07-19T09:09:00.000Z' },
    ]);

    expect(projection.sessions).toEqual([
      expect.objectContaining({ timerId: 'timer-1', status: 'stopped', elapsedMinutes: 8, stopReason: 'explicit' }),
      expect.objectContaining({ timerId: 'timer-2', status: 'cancelled', elapsedMinutes: null, stopReason: 'cancelled' }),
    ]);
    expect(projection.runningByUser).toEqual({});
  });

  it('rejects reordered, mismatched and impossible timer events', () => {
    const start = { id: 'event-1', timerId: 'timer-1', firmId: 'firm-1', matterId: 'matter-1', userId: 'user-1', eventType: 'started' as const, occurredAt: '2026-07-19T09:00:00.000Z' };
    expect(() => projectTimerSessions([{ ...start, eventType: 'stopped' }])).toThrow(/start/i);
    expect(() => projectTimerSessions([start, { ...start, id: 'event-2', eventType: 'stopped', occurredAt: '2026-07-19T08:59:00.000Z' }])).toThrow(/order/i);
    expect(() => projectTimerSessions([start, { ...start, id: 'event-2', eventType: 'stopped', userId: 'user-2', occurredAt: '2026-07-19T09:01:00.000Z' }])).toThrow(/identity/i);
  });
});
