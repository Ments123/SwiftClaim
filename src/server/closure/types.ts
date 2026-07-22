export type ClosureBlockerCategory =
  | 'client_money'
  | 'office_balance'
  | 'settlement_obligation'
  | 'court_deadline'
  | 'undertaking'
  | 'complaint'
  | 'legal_hold'
  | 'task'
  | 'document_return'
  | 'retention';

export interface ClosureBlocker {
  key: string;
  category: ClosureBlockerCategory;
  label: string;
  severity: 'critical' | 'residual';
  transferable: boolean;
  sourceId: string | null;
}

export interface ClosureTransfer {
  blockerKey: string;
  ownerUserId: string;
  dueOn: string;
  reason: string;
}

export interface ClosureReadinessResult {
  closable: boolean;
  unresolved: ClosureBlocker[];
  invalidTransfers: string[];
}
