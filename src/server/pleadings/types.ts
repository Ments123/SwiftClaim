export type ProcedureRegime =
  | 'part_7_domestic'
  | 'part_7_service_out'
  | 'part_8'
  | 'court_directed'
  | 'manual_review';

export type StatementType =
  | 'claim_form'
  | 'particulars'
  | 'acknowledgment_of_service'
  | 'defence'
  | 'reply'
  | 'counterclaim'
  | 'defence_to_counterclaim'
  | 'part_8_acknowledgment'
  | 'amended_statement'
  | 'other';

export type StatementEventType =
  | 'prepared'
  | 'approved_for_filing'
  | 'filed'
  | 'provider_acknowledged'
  | 'court_accepted'
  | 'served'
  | 'rejected'
  | 'withdrawn'
  | 'corrected'
  | 'superseded'
  | 'permission_granted'
  | 'permission_refused';

export type DeadlineOutcome =
  | 'projected'
  | 'source_date'
  | 'manual_court_period_required'
  | 'blocked_missing_facts'
  | 'superseded';

export type DefaultReviewOutcome =
  | 'review_incomplete'
  | 'blockers_recorded'
  | 'human_review_completed';
