export type FinanceCurrency = 'GBP';
export type FinanceAccountDesignation = 'client' | 'office' | 'neutral';
export type FinanceAccountClass =
  | 'client_asset' | 'client_liability' | 'office_asset' | 'office_liability'
  | 'wip_asset' | 'income' | 'expense' | 'vat_control'
  | 'disbursement_control' | 'suspense' | 'equity';
export type FinanceTimeStatus =
  | 'suggested' | 'draft' | 'submitted' | 'approved' | 'rejected'
  | 'written_off' | 'billed' | 'reversed';
export interface FinanceMoney { amountMinor: number; currency: FinanceCurrency }
export type FinanceVatTreatment = 'standard' | 'zero' | 'exempt' | 'outside_scope';
export type FinanceBillStatus = 'draft' | 'submitted' | 'approved' | 'issued' | 'delivered' | 'part_paid' | 'paid' | 'cancelled';
export type FinanceReceiptDesignation = 'client' | 'office' | 'suspense';
export type FinanceBankActivitySource = 'manual' | 'csv' | 'provider';
export interface FinanceWorkspacePermissions {
  canRecordTime: boolean; canApproveTime: boolean; canManageRates: boolean;
  canManageEstimates: boolean; canManageDisbursements: boolean;
  canPrepareJournal: boolean; canApproveJournal: boolean; canPostJournal: boolean;
}
