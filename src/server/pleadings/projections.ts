import type { DefaultReviewOutcome, StatementEventType } from './types.js';

interface ProjectionEvent {
  id: string;
  occurredAt: string;
  recordedAt: string;
  supersedesEventId: string | null;
}

export interface StatementProjectionEvent extends ProjectionEvent {
  eventType: StatementEventType;
}

export interface TrackProjectionEvent extends ProjectionEvent {
  eventType:
    | 'track_opened'
    | 'service_basis_recorded'
    | 'regime_confirmed'
    | 'response_source_date_recorded'
    | 'deadline_reviewed'
    | 'extension_recorded'
    | 'stay_recorded'
    | 'stay_lifted'
    | 'track_closed'
    | 'correction';
}

function ordered<T extends ProjectionEvent>(events: readonly T[]): T[] {
  const superseded = new Set(
    events.flatMap((item) => item.supersedesEventId ? [item.supersedesEventId] : []),
  );
  return events
    .filter((item) => !superseded.has(item.id))
    .sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.id.localeCompare(right.id));
}

export function projectStatement(events: readonly StatementProjectionEvent[]) {
  const active = ordered(events);
  let filingState: 'not_filed' | 'filed' | 'provider_acknowledged' | 'court_accepted' | 'rejected' | 'withdrawn' = 'not_filed';
  let serviceState: 'not_served' | 'served' = 'not_served';
  for (const item of active) {
    if (item.eventType === 'filed') filingState = 'filed';
    if (item.eventType === 'provider_acknowledged') filingState = 'provider_acknowledged';
    if (item.eventType === 'court_accepted') filingState = 'court_accepted';
    if (item.eventType === 'rejected') filingState = 'rejected';
    if (item.eventType === 'withdrawn') filingState = 'withdrawn';
    if (item.eventType === 'served') serviceState = 'served';
  }
  return { filingState, serviceState, events: active };
}

export function projectResponseTrack(events: readonly TrackProjectionEvent[]) {
  const active = ordered(events);
  let state: 'open' | 'stayed' | 'closed' = 'open';
  for (const item of active) {
    if (item.eventType === 'stay_recorded') state = 'stayed';
    if (item.eventType === 'stay_lifted') state = 'open';
    if (item.eventType === 'track_closed') state = 'closed';
  }
  return { state, events: active };
}

const DEFAULT_LABELS: Record<DefaultReviewOutcome, string> = {
  review_incomplete: 'Review incomplete',
  blockers_recorded: 'Blockers recorded',
  human_review_completed: 'Human review completed',
};

export function projectDefaultReview(review: {
  outcome: DefaultReviewOutcome;
  blockers: readonly string[];
}) {
  return { label: DEFAULT_LABELS[review.outcome], blockers: [...review.blockers] };
}
