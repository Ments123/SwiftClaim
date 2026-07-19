import { createHash } from 'node:crypto';

type SafeActivityBase = {
  id: string;
  firmId: string;
  matterId: string;
  userId: string;
  observedMinutes: number;
  occurredAt: string;
};

export type SafeActivityFact =
  | (SafeActivityBase & { sourceKind: 'task'; taskType: string })
  | (SafeActivityBase & { sourceKind: 'communication_call'; direction: 'inbound' | 'outbound' })
  | (SafeActivityBase & { sourceKind: 'document_version'; documentCategory: string })
  | (SafeActivityBase & { sourceKind: 'filing'; filingType: string })
  | (SafeActivityBase & { sourceKind: 'hearing'; hearingType: string })
  | (SafeActivityBase & { sourceKind: 'timer'; activityCode: string; costsPhase: string });

const adapterDefaults = {
  task: { activityCode: 'case_progression', costsPhase: 'case_management', narrative: 'Completed task attendance recorded in SwiftClaim.', confidence: 'medium' },
  communication_call: { activityCode: 'telephone_attendance', costsPhase: 'communications', narrative: 'Call attendance recorded in SwiftClaim.', confidence: 'high' },
  document_version: { activityCode: 'document_preparation', costsPhase: 'documents', narrative: 'Approved document work recorded in SwiftClaim.', confidence: 'medium' },
  filing: { activityCode: 'court_filing', costsPhase: 'proceedings', narrative: 'Filing attendance recorded in SwiftClaim.', confidence: 'medium' },
  hearing: { activityCode: 'hearing_attendance', costsPhase: 'hearing', narrative: 'Hearing attendance recorded in SwiftClaim.', confidence: 'high' },
} as const;

function requireIdentifier(value: string, label: string): void {
  if (!value.trim()) throw new Error(`Activity ${label} is required.`);
}

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Activity timestamp is invalid.');
  return new Date(timestamp).toISOString();
}

function safeMetadata(fact: SafeActivityFact): Record<string, string | number> {
  const base = {
    sourceKind: fact.sourceKind,
    id: fact.id,
    firmId: fact.firmId,
    matterId: fact.matterId,
    userId: fact.userId,
    observedMinutes: fact.observedMinutes,
    occurredAt: canonicalTimestamp(fact.occurredAt),
  };
  switch (fact.sourceKind) {
    case 'task': return { ...base, taskType: fact.taskType };
    case 'communication_call': return { ...base, direction: fact.direction };
    case 'document_version': return { ...base, documentCategory: fact.documentCategory };
    case 'filing': return { ...base, filingType: fact.filingType };
    case 'hearing': return { ...base, hearingType: fact.hearingType };
    case 'timer': return { ...base, activityCode: fact.activityCode, costsPhase: fact.costsPhase };
  }
}

export function suggestTimeFromActivity(fact: SafeActivityFact) {
  for (const [label, value] of [
    ['source ID', fact.id], ['firm ID', fact.firmId], ['matter ID', fact.matterId], ['user ID', fact.userId],
  ] as const) requireIdentifier(value, label);
  if (!Number.isSafeInteger(fact.observedMinutes) || fact.observedMinutes <= 0) {
    throw new Error('Observed activity minutes must be a positive safe integer.');
  }

  const metadata = safeMetadata(fact);
  const inputHash = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  const configured = fact.sourceKind === 'timer'
    ? {
        activityCode: fact.activityCode.trim(), costsPhase: fact.costsPhase.trim(),
        narrative: 'Manual timer attendance recorded in SwiftClaim.', confidence: 'high' as const,
      }
    : adapterDefaults[fact.sourceKind];
  if (!configured.activityCode || !configured.costsPhase) {
    throw new Error('Activity code and costs phase are required.');
  }

  return {
    label: 'AI suggestion — human review required' as const,
    firmId: fact.firmId,
    matterId: fact.matterId,
    userId: fact.userId,
    sourceKind: fact.sourceKind,
    sourceId: fact.id,
    observedAt: metadata.occurredAt as string,
    minutes: fact.observedMinutes,
    proposedActivityCode: configured.activityCode,
    proposedCostsPhase: configured.costsPhase,
    proposedNarrative: configured.narrative,
    confidence: configured.confidence,
    explanation: `${fact.observedMinutes} minutes were observed from a ${fact.sourceKind.replaceAll('_', ' ')} record. A human must confirm, edit, split or reject this suggestion.`,
    model: 'finance-activity-rules-v1' as const,
    policyVersion: 'finance-time-suggestion-v1' as const,
    inputHash,
    version: 1 as const,
  };
}

export interface FinanceTimerEvent {
  id: string;
  timerId: string;
  firmId: string;
  matterId: string;
  userId: string;
  eventType: 'started' | 'stopped' | 'cancelled';
  occurredAt: string;
}

export interface FinanceTimerSessionProjection {
  timerId: string;
  firmId: string;
  matterId: string;
  userId: string;
  status: 'running' | 'stopped' | 'cancelled';
  startedAt: string;
  stoppedAt: string | null;
  elapsedMinutes: number | null;
  stopReason: 'explicit' | 'superseded' | 'cancelled' | null;
  supersededByTimerId: string | null;
}

function elapsedMinutes(startedAt: string, stoppedAt: string): number {
  const milliseconds = Date.parse(stoppedAt) - Date.parse(startedAt);
  if (milliseconds <= 0) throw new Error('Timer events are out of order.');
  const minutes = Math.ceil(milliseconds / 60_000);
  if (!Number.isSafeInteger(minutes)) throw new Error('Timer duration exceeded the safe integer range.');
  return minutes;
}

export function projectTimerSessions(events: FinanceTimerEvent[]) {
  const sessions = new Map<string, FinanceTimerSessionProjection>();
  const runningByUser = new Map<string, string>();
  const lastEventByUser = new Map<string, number>();

  for (const event of events) {
    for (const [label, value] of [
      ['event ID', event.id], ['timer ID', event.timerId], ['firm ID', event.firmId],
      ['matter ID', event.matterId], ['user ID', event.userId],
    ] as const) requireIdentifier(value, label);
    const occurred = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurred)) throw new Error('Timer event timestamp is invalid.');
    const occurredAt = new Date(occurred).toISOString();
    const userKey = `${event.firmId}\u0000${event.userId}`;
    const lastEvent = lastEventByUser.get(userKey);
    if (lastEvent !== undefined && occurred < lastEvent) throw new Error('Timer events are out of order.');

    if (event.eventType === 'started') {
      if (sessions.has(event.timerId)) throw new Error('A timer can only start once.');
      const priorTimerId = runningByUser.get(userKey);
      if (priorTimerId) {
        const prior = sessions.get(priorTimerId)!;
        prior.status = 'stopped';
        prior.stoppedAt = occurredAt;
        prior.elapsedMinutes = elapsedMinutes(prior.startedAt, occurredAt);
        prior.stopReason = 'superseded';
        prior.supersededByTimerId = event.timerId;
      }
      sessions.set(event.timerId, {
        timerId: event.timerId, firmId: event.firmId, matterId: event.matterId, userId: event.userId,
        status: 'running', startedAt: occurredAt, stoppedAt: null, elapsedMinutes: null,
        stopReason: null, supersededByTimerId: null,
      });
      runningByUser.set(userKey, event.timerId);
    } else {
      const session = sessions.get(event.timerId);
      if (!session) throw new Error('Timer must start before it can stop or be cancelled.');
      if (session.status !== 'running') throw new Error('A stopped timer cannot receive another terminal event.');
      if (session.firmId !== event.firmId || session.matterId !== event.matterId || session.userId !== event.userId) {
        throw new Error('Timer event identity does not match its start event.');
      }
      elapsedMinutes(session.startedAt, occurredAt);
      session.status = event.eventType === 'stopped' ? 'stopped' : 'cancelled';
      session.stoppedAt = occurredAt;
      session.elapsedMinutes = event.eventType === 'stopped' ? elapsedMinutes(session.startedAt, occurredAt) : null;
      session.stopReason = event.eventType === 'stopped' ? 'explicit' : 'cancelled';
      runningByUser.delete(userKey);
    }
    lastEventByUser.set(userKey, occurred);
  }

  return {
    sessions: [...sessions.values()],
    runningByUser: Object.fromEntries(
      [...runningByUser.entries()].map(([key, timerId]) => [key.slice(key.indexOf('\u0000') + 1), timerId]),
    ),
  };
}
