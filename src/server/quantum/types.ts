export type LossCalculationType =
  | 'fixed'
  | 'quantity_rate'
  | 'period_rate'
  | 'manual';

export type LossCategory =
  | 'damaged_belongings'
  | 'additional_heating'
  | 'cleaning'
  | 'temporary_accommodation'
  | 'travel'
  | 'medical_expense'
  | 'loss_of_earnings'
  | 'other';

export type LossPosition = 'claimed' | 'accepted' | 'disputed' | 'withdrawn';
export type EvidenceStatus = 'supported' | 'partial' | 'missing' | 'not_applicable';

export interface LossCalculationInput {
  calculationType: LossCalculationType;
  fixedAmountMinor?: number;
  manualAmountMinor?: number;
  manualBasis?: string;
  quantity?: string;
  unitLabel?: string;
  rateMinor?: number;
}

export interface QuantumProjectionLine {
  category: LossCategory;
  position: LossPosition;
  evidenceStatus: EvidenceStatus;
  amountMinor: number;
}

export interface GeneralDamagesRange {
  lowMinor: number;
  highMinor: number;
  preferredMinor: number | null;
}

export type RepairEventType =
  | 'proposed'
  | 'appointment_booked'
  | 'access_offered'
  | 'access_provided'
  | 'access_refused'
  | 'access_unavailable'
  | 'started'
  | 'paused'
  | 'completion_asserted'
  | 'client_disputes_completion'
  | 'failed_inspection'
  | 'verified_complete'
  | 'superseded';

export type RepairActorType =
  | 'client'
  | 'landlord'
  | 'contractor'
  | 'expert'
  | 'solicitor'
  | 'other';

export interface RepairProjectionItem {
  id: string;
  priority: 'urgent' | 'high' | 'routine';
  targetCompletionOn: string | null;
}

export interface RepairProjectionEvent {
  id: string;
  eventType: RepairEventType;
  occurredAt: string;
  createdAt: string;
  actorType: RepairActorType;
  evidenceIds: string[];
  verifier: string;
  supersedesEventId: string | null;
}
