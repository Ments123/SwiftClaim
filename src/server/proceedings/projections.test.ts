import { describe, expect, it } from 'vitest';

import {
  projectApplication,
  projectDirection,
  projectFiling,
  projectHearing,
  projectProceeding,
  projectService,
} from './projections.js';

const ISO = '2026-09-01T10:00:00.000Z';
let sequence = 0;
function event<T extends string>(eventType: T, overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    eventType,
    occurredAt: new Date(Date.parse(ISO) + sequence * 1_000).toISOString(),
    recordedAt: new Date(Date.parse(ISO) + sequence * 1_000).toISOString(),
    supersedesEventId: null,
    ...overrides,
  };
}

describe('proceedings projections', () => {
  it('does not project issue from a submitted issue request', () => {
    expect(projectProceeding([
      event('issue_request_prepared'),
      event('issue_request_submitted'),
    ]).state).toBe('submitted');
  });

  it('projects issue only from the separate issued event', () => {
    expect(projectProceeding([
      event('issue_request_submitted'),
      event('issued'),
    ]).state).toBe('issued');
  });

  it('keeps filing acknowledgement distinct from acceptance', () => {
    expect(projectFiling([
      event('prepared'), event('submitted'), event('acknowledged'),
    ]).state).toBe('acknowledged');
  });

  it('keeps a service step separate from human review', () => {
    expect(projectService([event('prepared'), event('step_completed')]).state)
      .toBe('step_completed');
  });

  it('keeps performance assertion distinct from satisfaction', () => {
    const result = projectDirection([
      event('created'), event('performance_asserted'),
    ], '2026-09-20T00:00:00.000Z', '2026-09-18T16:00:00.000Z');
    expect(result.state).toBe('performance_asserted');
    expect(result.overdue).toBe(true);
  });

  it('treats a stay as controlling until a later resume', () => {
    const stayed = projectDirection([
      event('created'), event('stayed'),
    ], '2026-09-20T00:00:00.000Z', '2026-09-18T16:00:00.000Z');
    expect(stayed.state).toBe('stayed');
    expect(stayed.overdue).toBe(false);
    expect(projectDirection([
      event('created'), event('stayed'), event('resumed'),
    ], '2026-09-20T00:00:00.000Z', '2026-09-18T16:00:00.000Z').state)
      .toBe('overdue');
  });

  it('removes a corrected event from the controlling sequence', () => {
    const satisfied = event('satisfied');
    const correction = event('corrected', { supersedesEventId: satisfied.id });
    expect(projectDirection([
      event('created'), satisfied, correction,
    ], '2026-09-02T00:00:00.000Z', null).state).toBe('open');
  });

  it('keeps hearing outcome separate from a sealed resulting order', () => {
    const result = projectHearing([
      event('listed'), event('completed'), event('outcome_recorded'),
    ]);
    expect(result.state).toBe('completed');
    expect(result.outcomeRecorded).toBe(true);
  });

  it('projects a court application only from its immutable external events', () => {
    expect(projectApplication([
      event('prepared'), event('filed'), event('served'), event('granted'),
    ]).state).toBe('granted');
  });
});
