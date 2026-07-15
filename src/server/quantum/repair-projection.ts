import type {
  RepairProjectionEvent,
  RepairProjectionItem,
} from './types.js';

export class RepairProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepairProjectionError';
  }
}

export interface RepairWarning {
  key:
    | 'urgent_outstanding'
    | 'target_overdue'
    | 'completion_unverified'
    | 'completion_disputed';
  detail: string;
}

export function projectRepairState(
  item: RepairProjectionItem,
  events: RepairProjectionEvent[],
  asOf: string,
) {
  const superseded = new Set(
    events
      .filter((candidate) => candidate.eventType === 'superseded')
      .map((candidate) => candidate.supersedesEventId)
      .filter((id): id is string => Boolean(id)),
  );
  const active = events
    .filter(
      (candidate) =>
        candidate.eventType !== 'superseded' && !superseded.has(candidate.id),
    )
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );

  let status = 'not_started';
  let producingEventId: string | null = null;
  let lastAccessOutcome: 'offered' | 'provided' | 'refused' | 'unavailable' | null =
    null;
  let completionAsserted = false;
  let clientPosition: 'not_recorded' | 'accepted' | 'disputed' = 'not_recorded';
  let verification: 'not_verified' | 'failed' | 'verified' = 'not_verified';

  for (const current of active) {
    if (
      current.eventType === 'verified_complete' &&
      (!current.verifier.trim() || current.evidenceIds.length === 0)
    ) {
      throw new RepairProjectionError(
        'Verified completion requires a verifier and completion evidence.',
      );
    }
    status = current.eventType;
    producingEventId = current.id;
    if (current.eventType === 'access_offered') lastAccessOutcome = 'offered';
    if (current.eventType === 'access_provided') lastAccessOutcome = 'provided';
    if (current.eventType === 'access_refused') lastAccessOutcome = 'refused';
    if (current.eventType === 'access_unavailable') {
      lastAccessOutcome = 'unavailable';
    }
    if (current.eventType === 'completion_asserted') completionAsserted = true;
    if (current.eventType === 'client_disputes_completion') {
      clientPosition = 'disputed';
    }
    if (current.eventType === 'failed_inspection') verification = 'failed';
    if (current.eventType === 'verified_complete') {
      verification = 'verified';
      if (current.actorType === 'client') clientPosition = 'accepted';
    }
  }

  const complete = verification === 'verified';
  const warnings: RepairWarning[] = [];
  if (!complete && item.priority === 'urgent') {
    warnings.push({
      key: 'urgent_outstanding',
      detail: 'Urgent work is not independently verified as complete.',
    });
  }
  if (
    !complete &&
    item.targetCompletionOn &&
    item.targetCompletionOn < asOf
  ) {
    warnings.push({
      key: 'target_overdue',
      detail: 'The recorded target completion date has passed.',
    });
  }
  if (completionAsserted && verification === 'not_verified') {
    warnings.push({
      key: 'completion_unverified',
      detail: 'Completion has been asserted but not independently verified.',
    });
  }
  if (clientPosition === 'disputed' || verification === 'failed') {
    warnings.push({
      key: 'completion_disputed',
      detail: 'The asserted completion is disputed or failed inspection.',
    });
  }

  return {
    status,
    producingEventId,
    lastAccessOutcome,
    completionAsserted,
    clientPosition,
    verification,
    warnings,
  };
}
