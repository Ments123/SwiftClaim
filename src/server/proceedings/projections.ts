import type {
  ApplicationState,
  DirectionState,
  FilingState,
  HearingState,
  ProceedingState,
  ServiceState,
} from './types.js';

export interface ProjectionEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  supersedesEventId: string | null;
}

function controlling(events: readonly ProjectionEvent[]): ProjectionEvent[] {
  const superseded = new Set(
    events.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []),
  );
  return events
    .filter((event) => !superseded.has(event.id))
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.id.localeCompare(right.id),
    );
}

export function projectProceeding(events: readonly ProjectionEvent[]): {
  state: ProceedingState;
} {
  let state: ProceedingState = 'preparing';
  for (const event of controlling(events)) {
    switch (event.eventType) {
      case 'issue_request_submitted': state = 'submitted'; break;
      case 'issued': state = 'issued'; break;
      case 'allocated':
      case 'restored': state = 'active'; break;
      case 'stayed': state = 'stayed'; break;
      case 'discontinued':
      case 'dismissed':
      case 'judgment_entered':
      case 'closed_by_court': state = 'disposed'; break;
    }
  }
  return { state };
}

export function projectFiling(events: readonly ProjectionEvent[]): {
  state: FilingState;
} {
  let state: FilingState = 'prepared';
  for (const event of controlling(events)) {
    if (['prepared', 'submitted', 'acknowledged', 'accepted', 'rejected', 'withdrawn'].includes(event.eventType)) {
      state = event.eventType as FilingState;
    }
  }
  return { state };
}

export function projectService(events: readonly ProjectionEvent[]): {
  state: ServiceState;
} {
  let state: ServiceState = 'prepared';
  for (const event of controlling(events)) {
    switch (event.eventType) {
      case 'prepared': state = 'prepared'; break;
      case 'step_completed': state = 'step_completed'; break;
      case 'delivery_evidence_received': state = 'evidence_received'; break;
      case 'human_reviewed': state = 'reviewed'; break;
      case 'disputed': state = 'disputed'; break;
      case 'returned': state = 'returned'; break;
      case 'set_aside': state = 'set_aside'; break;
    }
  }
  return { state };
}

export function projectApplication(events: readonly ProjectionEvent[]): {
  state: ApplicationState;
} {
  let state: ApplicationState = 'prepared';
  for (const event of controlling(events)) {
    if (['prepared', 'filed', 'served', 'listed', 'granted', 'refused', 'withdrawn', 'disposed']
      .includes(event.eventType)) {
      state = event.eventType as ApplicationState;
    }
  }
  return { state };
}

export function projectDirection(
  events: readonly ProjectionEvent[],
  now: string,
  dueAt: string | null,
): { state: DirectionState; overdue: boolean; dueSoon: boolean } {
  let base: DirectionState = 'open';
  for (const event of controlling(events)) {
    switch (event.eventType) {
      case 'created':
      case 'resumed': base = 'open'; break;
      case 'performance_asserted': base = 'performance_asserted'; break;
      case 'satisfied': base = 'satisfied'; break;
      case 'stayed': base = 'stayed'; break;
      case 'disputed': base = 'disputed'; break;
      case 'superseded': base = 'superseded'; break;
      case 'waived_by_order': base = 'waived_by_order'; break;
    }
  }
  const timeSensitive = base === 'open' || base === 'performance_asserted';
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  const current = Date.parse(now);
  const overdue = timeSensitive && Number.isFinite(due) && due < current;
  const dueSoon = timeSensitive && Number.isFinite(due) && due >= current && due - current <= 7 * 86_400_000;
  const state = base === 'open' && overdue
    ? 'overdue'
    : base === 'open' && dueSoon
      ? 'due_soon'
      : base;
  return { state, overdue, dueSoon };
}

export function projectHearing(events: readonly ProjectionEvent[]): {
  state: HearingState;
  outcomeRecorded: boolean;
} {
  let state: HearingState = 'listed';
  let outcomeRecorded = false;
  for (const event of controlling(events)) {
    if (['listed', 'relisted', 'adjourned', 'vacated', 'started', 'completed'].includes(event.eventType)) {
      state = event.eventType as HearingState;
    }
    if (event.eventType === 'outcome_recorded') outcomeRecorded = true;
  }
  return { state, outcomeRecorded };
}
