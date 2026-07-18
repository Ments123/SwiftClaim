export type ProceedingState =
  | 'preparing'
  | 'submitted'
  | 'issued'
  | 'stayed'
  | 'active'
  | 'disposed';

export type FilingState =
  | 'prepared'
  | 'submitted'
  | 'acknowledged'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export type ServiceState =
  | 'prepared'
  | 'step_completed'
  | 'evidence_received'
  | 'reviewed'
  | 'disputed'
  | 'returned'
  | 'set_aside';

export type ApplicationState =
  | 'prepared'
  | 'filed'
  | 'served'
  | 'listed'
  | 'granted'
  | 'refused'
  | 'withdrawn'
  | 'disposed';

export type DirectionState =
  | 'open'
  | 'due_soon'
  | 'overdue'
  | 'performance_asserted'
  | 'satisfied'
  | 'stayed'
  | 'disputed'
  | 'superseded'
  | 'waived_by_order';

export type HearingState =
  | 'listed'
  | 'relisted'
  | 'adjourned'
  | 'vacated'
  | 'started'
  | 'completed';
