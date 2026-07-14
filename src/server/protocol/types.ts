import type {
  CreateExpertEngagementInput,
  RecordExpertConflictCheckInput,
  RecordExpertMilestoneInput,
  RecordExpertQuestionInput,
  RecordExpertReportInput,
  RecordLandlordResponseInput,
  RecordProtocolServiceEventInput,
  SaveLetterOfClaimInput,
  SelectExpertRouteInput,
} from '../../shared/contracts.js';

export interface ProtocolMutationContext {
  actorUserId: string;
  occurredAt: string;
  requestId: string;
  ipAddress: string;
}

export interface VersionedSourceReference {
  id: string;
  version: number;
  digest: string;
}

export interface ImmutableSourceReference {
  id: string;
  digest: string;
}

export interface LetterSourceManifest {
  matter: VersionedSourceReference;
  claimant: ImmutableSourceReference;
  property: ImmutableSourceReference;
  landlord: ImmutableSourceReference;
  tenancy: ImmutableSourceReference;
  defects: VersionedSourceReference[];
  notices: ImmutableSourceReference[];
  accessEvents: ImmutableSourceReference[];
  evidenceItems: ImmutableSourceReference[];
  assembledAt: string;
}

export interface LetterReviewModel {
  matterReference: string;
  claimant: {
    name: string;
    address: string;
    phone: string;
  };
  property: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    county: string;
    postcode: string;
  };
  landlord: {
    name: string;
    address: string;
  };
  tenancy: {
    tenancyType: string;
    startedOn: string | null;
  };
  defects: Array<{
    id: string;
    location: string;
    title: string;
    description: string;
    status: string;
    severity: string;
    firstObservedOn: string | null;
    history: string[];
  }>;
  notices: Array<{
    id: string;
    occurredAt: string;
    channel: string;
    recipientName: string;
    summary: string;
    proofStatus: string;
  }>;
  access: Array<{
    id: string;
    eventType: string;
    appointmentAt: string | null;
    notes: string;
  }>;
  effectNarrative: string;
  personalInjury: {
    status: SaveLetterOfClaimInput['personalInjuryStatus'];
    summary: string;
  };
  specialDamages: {
    status: SaveLetterOfClaimInput['specialDamagesStatus'];
    summary: string;
  };
  accessWindows: SaveLetterOfClaimInput['accessWindows'];
  expertProposalSummary: string;
  disclosureRequests: string[];
  additionalContent: string;
}

export interface LetterAssemblyBlocker {
  key: string;
  label: string;
  sourceType: string;
}

export interface LetterAssemblyWarning {
  key: string;
  label: string;
  sourceType: string;
}

export interface LetterAssemblyResult {
  model: LetterReviewModel;
  manifest: LetterSourceManifest;
  blockers: LetterAssemblyBlocker[];
  warnings: LetterAssemblyWarning[];
}

export interface ExpertInstructionModel {
  matterReference: string;
  expert: {
    name: string;
    organisation: string;
    role: string;
  };
  parties: string[];
  propertyAddress: string;
  route: string;
  accessDetail: string;
  issues: string[];
  questions: string[];
  urgentWorksRequested: boolean;
  scheduleOfWorksRequested: boolean;
  costEstimateRequested: boolean;
  reportDueOn: string | null;
  materialSources: string[];
}

export interface LetterAssemblySources {
  assembledAt: string;
  matter: {
    id: string;
    version: number;
    reference: string;
  };
  claimant: {
    id: string;
    name: string;
    address: string;
    phone: string;
  } | null;
  property: {
    id: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    county: string;
    postcode: string;
  } | null;
  landlord: {
    id: string;
    name: string;
    address: string;
  } | null;
  tenancy: {
    id: string;
    tenancyType: string;
    startedOn: string | null;
  } | null;
  defects: LetterReviewModel['defects'][number][] &
    Array<{ version: number }>;
  notices: LetterReviewModel['notices'];
  accessEvents: LetterReviewModel['access'];
  evidenceItemIds: string[];
  draft: Omit<SaveLetterOfClaimInput, 'expectedVersion'>;
}

export interface SourceFreshnessResult {
  fresh: boolean;
  added: string[];
  changed: string[];
  removed: string[];
}

export interface ProtocolCaseRecord {
  id: string;
  version: number;
  protocolStatus:
    | 'preparing'
    | 'approved'
    | 'issued'
    | 'awaiting_response'
    | 'response_received'
    | 'expert_work'
    | 'taking_stock'
    | 'complete';
  expertRoute: SelectExpertRouteInput['route'];
  expertRouteReason: string;
  urgentReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface LetterOfClaimRecord {
  id: string;
  version: number;
  state: 'draft' | 'ready_for_review' | 'approved' | 'superseded';
  draft: Omit<SaveLetterOfClaimInput, 'expectedVersion'>;
  source: LetterAssemblyResult;
  authorUserId: string;
  reviewerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedDocumentVersion {
  documentId: string;
  id: string;
  version: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface LetterOfClaimVersionRecord {
  id: string;
  version: number;
  model: LetterReviewModel;
  sourceManifest: LetterSourceManifest;
  templateKey: string;
  rendererVersion: string;
  contentSha256: string;
  documentVersion: GeneratedDocumentVersion;
  approvedBy: string;
  approvedAt: string;
  sourceFreshness: SourceFreshnessResult;
}

export interface ProtocolServiceEventRecord {
  id: string;
  letterVersionId: string;
  eventType: RecordProtocolServiceEventInput['eventType'];
  method: RecordProtocolServiceEventInput['method'];
  occurredAt: string;
  legalTriggerOn: string | null;
  recipient: string;
  destination: string;
  sourceDetail: string;
  supportingDocumentVersionId: string | null;
  supersedesEventId: string | null;
  correctionReason: string;
  createdBy: string;
  createdAt: string;
}

export interface LandlordResponseRecord {
  id: string;
  responseType: RecordLandlordResponseInput['responseType'];
  receivedOn: string | null;
  respondingParty: string;
  contactName: string;
  generalLiabilityPosition: RecordLandlordResponseInput['generalLiabilityPosition'];
  liabilityReasons: string;
  noticePosition: string;
  accessPosition: string;
  disclosureStatus: RecordLandlordResponseInput['disclosureStatus'];
  disclosureSummary: string;
  expertProposalPosition: RecordLandlordResponseInput['expertProposalPosition'];
  expertProposalSummary: string;
  worksSchedule: string;
  worksStartOn: string | null;
  worksCompleteOn: string | null;
  compensationOfferMinor: number | null;
  costsOfferMinor: number | null;
  currency: string;
  sourceDocumentVersionId: string | null;
  supersedesResponseId: string | null;
  defectPositions: RecordLandlordResponseInput['defectPositions'];
  createdBy: string;
  createdAt: string;
}

export interface ExpertConflictCheckRecord {
  id: string;
  partiesChecked: string[];
  method: string;
  searchDetail: string;
  outcome: RecordExpertConflictCheckInput['outcome'];
  decision: RecordExpertConflictCheckInput['decision'];
  reason: string;
  checkedBy: string;
  checkedAt: string;
}

export interface ExpertInstructionVersionRecord {
  id: string;
  version: number;
  model: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  documentVersion: GeneratedDocumentVersion;
  approvedBy: string;
  approvedAt: string;
}

export interface ExpertMilestoneRecord {
  id: string;
  eventType: RecordExpertMilestoneInput['eventType'];
  occurredAt: string;
  legalTriggerOn: string | null;
  detail: string;
  instructionVersionId: string | null;
  supportingDocumentVersionId: string | null;
  supersedesEventId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ExpertReportRecord {
  id: string;
  reportType: RecordExpertReportInput['reportType'];
  reportOn: string;
  receivedOn: string;
  coverageSummary: string;
  urgentWorksIdentified: boolean;
  documentVersion: GeneratedDocumentVersion;
  supersedesReportId: string | null;
  reviewed: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ExpertQuestionRecord {
  id: string;
  reportId: string;
  question: string;
  clarificationPurpose: string;
  dispatchedOn: string | null;
  responseDueOn: string | null;
  legalBasis: RecordExpertQuestionInput['legalBasis'];
  reportServedOn: string | null;
  answers: Array<{
    id: string;
    receivedOn: string;
    summary: string;
    documentVersion: GeneratedDocumentVersion;
    createdBy: string;
    createdAt: string;
  }>;
  createdBy: string;
  createdAt: string;
}

export interface ExpertEngagementRecord {
  id: string;
  version: number;
  route: CreateExpertEngagementInput['route'];
  expertRole: CreateExpertEngagementInput['expertRole'];
  expertName: string;
  organisation: string;
  email: string;
  phone: string;
  expertise: string;
  qualifications: string;
  registrationBody: string;
  registrationReference: string;
  verificationStatus: CreateExpertEngagementInput['verificationStatus'];
  verificationMethod: string;
  verifiedOn: string | null;
  proposedBy: CreateExpertEngagementInput['proposedBy'];
  singleJoint: boolean;
  termsStatus: CreateExpertEngagementInput['termsStatus'];
  feeBasis: string;
  feeMinor: number | null;
  currency: string;
  payerSplit: CreateExpertEngagementInput['payerSplit'];
  availabilitySummary: string;
  targetReportOn: string | null;
  state:
    | 'candidate'
    | 'checks_pending'
    | 'terms_pending'
    | 'approved'
    | 'instructed'
    | 'inspection_booked'
    | 'report_due'
    | 'report_received'
    | 'reviewed'
    | 'cancelled';
  conflictChecks: ExpertConflictCheckRecord[];
  instructionVersions: ExpertInstructionVersionRecord[];
  milestones: ExpertMilestoneRecord[];
  reports: ExpertReportRecord[];
  questions: ExpertQuestionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolReadinessControl {
  key: 'letter_of_claim_sent' | 'expert_instruction_confirmed';
  eligible: boolean;
  explanation: string;
}

export interface ProtocolReadiness {
  controls: ProtocolReadinessControl[];
  progressionBlockers: Array<{
    key: string;
    label: string;
    severity: 'warning' | 'critical';
  }>;
}

export interface ProtocolRisk {
  key: string;
  type:
    | 'letter_sources_changed'
    | 'letter_not_dispatched'
    | 'receipt_not_confirmed'
    | 'landlord_response_overdue'
    | 'landlord_response_incomplete'
    | 'expert_route_undecided'
    | 'expert_conflict'
    | 'expert_terms_missing'
    | 'inspection_due'
    | 'inspection_failed'
    | 'report_missing'
    | 'report_not_reviewed'
    | 'urgent_works_not_escalated'
    | 'question_answer_overdue';
  level: 'medium' | 'high' | 'critical';
  title: string;
  detail: string;
  entityId: string | null;
}

export interface ProtocolDeadlineSummary {
  id: string;
  title: string;
  triggerDate: string;
  dueDate: string;
  status: string;
  explanation: string;
  sourceTitle: string;
  sourceUrl: string;
  ruleKey: string;
}

export interface ProtocolWorkspace {
  matterId: string;
  case: ProtocolCaseRecord;
  letter: LetterOfClaimRecord;
  letterVersions: LetterOfClaimVersionRecord[];
  serviceEvents: ProtocolServiceEventRecord[];
  landlordResponses: LandlordResponseRecord[];
  experts: ExpertEngagementRecord[];
  deadlines: ProtocolDeadlineSummary[];
  readiness: ProtocolReadiness;
  risks: ProtocolRisk[];
  permissions: {
    canPrepare: boolean;
    canApprove: boolean;
    canOverrideConflict: boolean;
    canReviewReport: boolean;
  };
}
