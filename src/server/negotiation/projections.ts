import type {
  NegotiationActionState,
  ObligationState,
  SettlementState,
} from './types.js';

export interface NegotiationInstructionProjectionEvent {
  id: string;
  actionVersion: number;
  occurredAt: string;
  supersedesInstructionId: string | null;
}

export interface NegotiationApprovalProjectionEvent {
  id: string;
  actionVersion: number;
  eventSequence?: number;
  decision: 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'invalidated';
  occurredAt: string;
}

export interface NegotiationExternalActProjectionEvent {
  id: string;
  actionVersion: number;
  occurredAt: string;
}

export interface ActionProjectionInput {
  currentVersion: number;
  cancelled: boolean;
  superseded: boolean;
  instructions: readonly NegotiationInstructionProjectionEvent[];
  approvals: readonly NegotiationApprovalProjectionEvent[];
  externalActs: readonly NegotiationExternalActProjectionEvent[];
}

export interface ActionProjection {
  state: NegotiationActionState;
  instructionCurrent: boolean;
  approvalCurrent: boolean;
  canRecordExternalAction: boolean;
  producingExternalActId: string | null;
}

function byOccurredThenId<T extends { occurredAt: string; id: string }>(left: T, right: T) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

export function projectAction(input: ActionProjectionInput): ActionProjection {
  const supersededInstructions = new Set(
    input.instructions.flatMap(({ supersedesInstructionId }) =>
      supersedesInstructionId ? [supersedesInstructionId] : [],
    ),
  );
  const instructionCurrent = input.instructions.some(
    ({ id, actionVersion }) =>
      actionVersion === input.currentVersion && !supersededInstructions.has(id),
  );
  const latestApproval = input.approvals
    .filter(({ actionVersion }) => actionVersion === input.currentVersion)
    .toSorted((left, right) =>
      (left.eventSequence ?? 0) - (right.eventSequence ?? 0) ||
      byOccurredThenId(left, right),
    )
    .at(-1);
  const approvalCurrent = latestApproval?.decision === 'approved';
  const externalAct = input.externalActs
    .filter(({ actionVersion }) => actionVersion === input.currentVersion)
    .toSorted(byOccurredThenId)
    .at(-1);

  let state: NegotiationActionState;
  if (input.superseded) state = 'superseded';
  else if (input.cancelled) state = 'cancelled';
  else if (externalAct) state = 'externally_recorded';
  else if (!instructionCurrent) state = 'instruction_required';
  else if (!approvalCurrent) state = 'approval_required';
  else state = 'authorised';

  return {
    state,
    instructionCurrent,
    approvalCurrent,
    canRecordExternalAction: state === 'authorised',
    producingExternalActId: externalAct?.id ?? null,
  };
}

export interface ObligationProjectionEvent {
  id: string;
  eventType:
    | 'due_confirmed'
    | 'performance_asserted'
    | 'part_satisfied'
    | 'satisfied'
    | 'overdue_reviewed'
    | 'disputed'
    | 'waived'
    | 'corrected';
  occurredAt: string;
  recordedAt: string;
  supersedesEventId: string | null;
}

export interface ObligationProjection {
  state: ObligationState;
  satisfiedAt: string | null;
  waivedAt: string | null;
  disputedAt: string | null;
  overdue: boolean;
  producingEventId: string | null;
}

const obligationStateByEvent: Partial<
  Record<ObligationProjectionEvent['eventType'], ObligationState>
> = {
  performance_asserted: 'performance_asserted',
  part_satisfied: 'part_satisfied',
  satisfied: 'satisfied',
  disputed: 'disputed',
  waived: 'waived',
};

function orderedEffectiveObligationEvents(
  events: readonly ObligationProjectionEvent[],
): ObligationProjectionEvent[] {
  const corrected = new Set(
    events
      .filter(({ eventType }) => eventType === 'corrected')
      .flatMap(({ supersedesEventId }) => supersedesEventId ? [supersedesEventId] : []),
  );
  return events
    .filter(({ id, eventType }) => eventType !== 'corrected' && !corrected.has(id))
    .toSorted((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.id.localeCompare(right.id),
    );
}

export function projectObligation(
  events: readonly ObligationProjectionEvent[],
  asOf: string,
  dueAt: string | null,
): ObligationProjection {
  const effective = orderedEffectiveObligationEvents(events);
  const producing = effective.filter(({ eventType }) => obligationStateByEvent[eventType]).at(-1);
  const state = producing ? obligationStateByEvent[producing.eventType] ?? 'outstanding' : 'outstanding';
  const resolved = state === 'satisfied' || state === 'waived';
  return {
    state,
    satisfiedAt: state === 'satisfied' ? producing?.occurredAt ?? null : null,
    waivedAt: state === 'waived' ? producing?.occurredAt ?? null : null,
    disputedAt: state === 'disputed' ? producing?.occurredAt ?? null : null,
    overdue: Boolean(dueAt && dueAt < asOf && !resolved),
    producingEventId: producing?.id ?? null,
  };
}

export type CourtApprovalPosition =
  | 'unknown'
  | 'not_required_reviewed'
  | 'required'
  | 'obtained';

export interface SettlementProjectionInput {
  currentTermsVersion: number;
  instructionTermsVersion: number | null;
  approvalTermsVersion: number | null;
  instrumentRecorded: boolean;
  courtApprovalPosition: CourtApprovalPosition;
  concludedAt: string | null;
}

export interface SettlementProjection {
  state: SettlementState;
  instructionCurrent: boolean;
  approvalCurrent: boolean;
  courtApprovalReviewed: boolean;
  canConclude: boolean;
}

export function projectSettlement(input: SettlementProjectionInput): SettlementProjection {
  const instructionCurrent = input.instructionTermsVersion === input.currentTermsVersion;
  const approvalCurrent = input.approvalTermsVersion === input.currentTermsVersion;
  const courtApprovalReviewed = input.courtApprovalPosition !== 'unknown';
  const courtApprovalSatisfied =
    input.courtApprovalPosition === 'not_required_reviewed' ||
    input.courtApprovalPosition === 'obtained';
  const canConclude =
    instructionCurrent &&
    approvalCurrent &&
    input.instrumentRecorded &&
    courtApprovalSatisfied;

  let state: SettlementState;
  if (!instructionCurrent || !approvalCurrent) state = 'authority_required';
  else if (!courtApprovalReviewed || input.courtApprovalPosition === 'required') {
    state = 'court_approval_pending';
  } else if (!input.instrumentRecorded) state = 'instrument_pending';
  else if (input.concludedAt && canConclude) state = 'concluded';
  else state = 'terms_agreed';

  return {
    state,
    instructionCurrent,
    approvalCurrent,
    courtApprovalReviewed,
    canConclude,
  };
}
