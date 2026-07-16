export type NegotiationActionState =
  | 'draft'
  | 'instruction_required'
  | 'approval_required'
  | 'authorised'
  | 'externally_recorded'
  | 'cancelled'
  | 'superseded';

export type SettlementState =
  | 'preparing'
  | 'authority_required'
  | 'terms_agreed'
  | 'instrument_pending'
  | 'court_approval_pending'
  | 'concluded'
  | 'failed'
  | 'superseded';

export type ObligationState =
  | 'outstanding'
  | 'performance_asserted'
  | 'part_satisfied'
  | 'satisfied'
  | 'disputed'
  | 'waived';
