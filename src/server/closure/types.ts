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

export interface PrepareClosureInput {
  outcome: string;
  closureReason: string;
  lessons: string;
  finalClientReportStatus: 'sent';
  finalClientReportDocumentVersionId: string;
  documentsPosition: 'returned' | 'retained' | 'mixed';
  documentsNote: string;
  retentionBasis: string;
  retentionUntil: string;
  undertakingsConfirmedClear: true;
  complaintsConfirmedClear: true;
  attestationNote: string;
  transfers: ClosureTransfer[];
  explicitHumanAuthority: true;
  idempotencyKey: string;
}

export interface ClosureDecisionInput {
  note: string;
  explicitHumanAuthority: true;
  idempotencyKey: string;
}
