export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  firm: { id: string; name: string };
  permissions: {
    canCreateMatter: boolean;
    canViewAdministration: boolean;
    canTransitionWorkflow: boolean;
    canOverrideWorkflow: boolean;
    canConfirmDeadline: boolean;
    canAccessIntake: boolean;
    canWriteIntake: boolean;
    canDecideIntake: boolean;
    canOverrideConflict: boolean;
    canConvertIntake: boolean;
    canPrepareProtocol: boolean;
    canApproveProtocol: boolean;
    canOverrideExpertConflict: boolean;
    canReviewExpertReport: boolean;
  };
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export type EnquiryStatus =
  | 'new'
  | 'assessment'
  | 'accepted'
  | 'declined'
  | 'referred'
  | 'duplicate'
  | 'unable_to_contact'
  | 'converted';

export interface EnquiryDetail {
  id: string;
  reference: string;
  status: EnquiryStatus;
  version: number;
  source: string;
  referrerName: string;
  summary: string;
  defectSummary: string;
  desiredOutcome: string;
  firstComplainedOn: string | null;
  currentlyOccupied: boolean;
  urgency: 'routine' | 'priority' | 'urgent' | 'critical';
  immediateSafetyConcerns: string;
  communicationRequirements: string;
  decisionReason: string;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    displayName: string;
    givenName: string;
    familyName: string;
    dateOfBirth: string | null;
    email: string;
    phone: string;
    preferredChannel: 'email' | 'phone' | 'sms' | 'post';
  };
  property: {
    id: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    county: string;
    postcode: string;
    country: string;
    propertyType: string;
  };
  landlord: { id: string; name: string; kind: string } | null;
  assignedTo: { id: string; name: string; role: string };
}

export type EnquiryListItem = EnquiryDetail;

export interface IntakeBlocker {
  key: string;
  label: string;
  severity: 'warning' | 'critical';
}

export interface IntakeReadiness {
  assessment: { ready: boolean; blockers: IntakeBlocker[] };
  onboarding: { ready: boolean; blockers: IntakeBlocker[] };
  conversion: { ready: boolean; blockers: IntakeBlocker[] };
}

export interface ConflictCheck {
  id: string;
  enquiryId: string;
  matchCount: number;
  matches: Array<{
    source: 'matter' | 'enquiry' | 'contact' | 'property' | 'organisation';
    display: string;
    matchedOn: string[];
  }>;
  runAt: string;
  runBy: { id: string; name: string };
}

export interface ConflictDecision {
  id: string;
  checkId: string;
  decision: 'clear' | 'blocked' | 'cleared_with_override';
  reason: string;
  decidedAt: string;
  decidedBy: { id: string; name: string };
}

export interface IntakeAssessment {
  id: string;
  enquiryId: string;
  version: number;
  jurisdictionConfirmed: boolean;
  claimantRelationship: 'tenant' | 'former_tenant' | 'leaseholder' | 'other';
  noticeSummary: string;
  conditionsUnresolved: boolean;
  conditionStartDate: string | null;
  accessSummary: string;
  evidenceSummary: string;
  limitationReview: string;
  legalIssues: Array<'section_11' | 'fitness' | 'statutory' | 'contractual'>;
  escalations: Array<
    | 'personal_injury'
    | 'possession'
    | 'homelessness'
    | 'safeguarding'
    | 'urgent_injunction'
    | 'critical_hazard'
  >;
  meritsRating: 'weak' | 'borderline' | 'reasonable' | 'strong';
  proportionalityRating: 'poor' | 'borderline' | 'reasonable' | 'strong';
  decision: 'draft' | 'proceed' | 'decline' | 'refer';
  decisionReason: string;
  reviewedBy: { id: string; name: string; role: string } | null;
  reviewedAt: string | null;
  updatedBy: { id: string; name: string };
  updatedAt: string;
}

export interface IntakeTenancy {
  id: string;
  tenancyType: string;
  startedOn: string | null;
  endedOn: string | null;
  rentMinor: number;
  currency: string;
  rentFrequency: string;
  occupancyStartedOn: string | null;
  occupancyEndedOn: string | null;
}

export interface IntakeHouseholdMember {
  id: string;
  displayName: string;
  relationship: string;
  currentlyOccupies: boolean;
  claimParticipant: boolean;
  vulnerabilitySummary: string;
  accessibilityNeeds: string;
}

export interface IntakeOnboarding {
  id: string;
  enquiryId: string;
  version: number;
  identityStatus: 'not_started' | 'pending' | 'complete' | 'failed';
  clientCareStatus: 'not_started' | 'pending' | 'complete';
  authorityStatus: 'not_started' | 'pending' | 'complete';
  privacyStatus: 'not_started' | 'pending' | 'complete';
  fundingType: string;
  fundingStatus: 'not_started' | 'pending' | 'complete';
  signatureStatus: 'not_started' | 'sent' | 'complete';
  vulnerabilitySummary: string;
  accessibilityNeeds: string;
  interpreterLanguage: string | null;
  safeContactInstructions: string;
  owner: { id: string; name: string; role: string } | null;
  supervisor: { id: string; name: string; role: string } | null;
  tenancy: IntakeTenancy | null;
  householdMembers: IntakeHouseholdMember[];
  updatedBy: { id: string; name: string };
  updatedAt: string;
}

export interface IntakeConversion {
  id: string;
  idempotencyKey: string;
  convertedAt: string;
  replayed: boolean;
  enquiry: EnquiryDetail;
  matter: {
    id: string;
    reference: string;
    title: string;
    clientName: string;
    stage: string;
    owner: { id: string; name: string };
  };
  workflow: {
    id: string;
    currentStage: { key: string; name: string };
    version: number;
  };
}

export interface IntakeWorkspace {
  enquiry: EnquiryDetail;
  conflict: {
    latestCheck: ConflictCheck | null;
    latestDecision: ConflictDecision | null;
  };
  assessment: IntakeAssessment | null;
  onboarding: IntakeOnboarding | null;
  readiness: IntakeReadiness;
  conversion: IntakeConversion | null;
}

export interface MatterIntakeProfile {
  matterId: string;
  enquiryId: string;
  enquiryReference: string;
  client: EnquiryDetail['client'] & {
    safeContactInstructions: string;
    accessibilityNeeds: string;
    interpreterLanguage: string | null;
  };
  householdMembers: IntakeHouseholdMember[];
  property: EnquiryDetail['property'];
  landlord: NonNullable<EnquiryDetail['landlord']>;
  tenancy: IntakeTenancy;
  assessment: IntakeAssessment;
  onboarding: IntakeOnboarding;
}

export interface MatterSummary {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  matterType: string;
  status: string;
  stage: string;
  riskLevel: string;
  openedAt: string;
  description: string;
  externalSource: string | null;
  externalId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string };
  nextDeadline: string | null;
  openTaskCount: number;
}

export interface MatterTask {
  id: string;
  title: string;
  notes: string;
  dueAt: string;
  priority: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { id: string; name: string };
}

export interface DashboardTask extends MatterTask {
  matterId: string;
  matter: { reference: string; title: string };
}

export interface Party {
  id: string;
  kind: string;
  name: string;
  organisation: string;
  email: string;
  phone: string;
  address: string;
  externalSource: string | null;
  externalId: string | null;
  createdAt: string;
}

export interface MatterDocument {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  latestVersion: null | {
    id: string;
    version: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
    uploadedByName: string;
  };
}

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  actorName: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string;
  requestId: string;
  ipAddress: string;
  createdAt: string;
}

export interface MatterAggregate {
  matter: MatterSummary;
  parties: Party[];
  tasks: MatterTask[];
  documents: MatterDocument[];
  timeline: TimelineEvent[];
  audit: AuditEvent[];
  permissions: { canWrite: boolean; canCreateMatter: boolean };
  team: TeamMember[];
}

export interface DashboardData {
  summary: {
    activeMatters: number;
    overdueTasks: number;
    dueThisWeek: number;
    highRiskMatters: number;
  };
  urgentTasks: DashboardTask[];
  recentMatters: MatterSummary[];
  team: TeamMember[];
}

export interface MatterWorkflowStage {
  key: string;
  name: string;
  position: number;
  description: string;
  requiredChecklistKeys: string[];
  state: 'completed' | 'current' | 'upcoming';
}

export interface MatterWorkflowBlocker {
  key: string;
  label: string;
  severity: 'warning' | 'critical';
}

export interface MatterLegalDeadline {
  id: string;
  title: string;
  triggerDate: string;
  dueDate: string;
  status: 'pending' | 'satisfied' | 'superseded' | 'cancelled';
  explanation: string;
  sourceTitle: string;
  sourceUrl: string;
  ruleKey: string;
}

export interface Matter360Data {
  matter: MatterSummary;
  workflow: {
    id: string;
    version: number;
    definitionVersion: number;
    name: string;
    currentStageKey: string;
    currentStagePosition: number;
    stages: MatterWorkflowStage[];
    completedChecklistKeys: string[];
    blockers: MatterWorkflowBlocker[];
  };
  deadlines: MatterLegalDeadline[];
  nextActions: MatterTask[];
  alerts: Array<{
    key: string;
    severity: 'warning' | 'critical';
    title: string;
    detail: string;
  }>;
  permissions: {
    canWrite: boolean;
    canTransition: boolean;
    canOverrideWorkflow: boolean;
  };
}

export interface EvidenceDocumentVersion {
  id: string;
  documentId: string;
  documentTitle: string;
  category: string;
  version: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface EvidenceDefect {
  id: string;
  version: number;
  location: string;
  category: 'damp_mould' | 'leak' | 'heating' | 'electrical' | 'structural' | 'pest' | 'ventilation' | 'sanitation' | 'other';
  title: string;
  description: string;
  severity: 'low' | 'moderate' | 'serious' | 'critical';
  status: 'open' | 'monitoring' | 'repaired' | 'disputed' | 'superseded';
  firstObservedOn: string | null;
  healthImpact: string;
  hazardTags: string[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  evidenceIds: string[];
  statusEvents: Array<{
    id: string;
    fromStatus: EvidenceDefect['status'] | null;
    toStatus: EvidenceDefect['status'];
    reason: string;
    actorUserId: string;
    occurredAt: string;
  }>;
}

export interface EvidenceNotice {
  id: string;
  occurredAt: string;
  channel: 'email' | 'phone' | 'sms' | 'whatsapp' | 'letter' | 'portal' | 'in_person' | 'other';
  recipientType: 'landlord' | 'managing_agent' | 'contractor' | 'local_authority' | 'other';
  recipientName: string;
  summary: string;
  proofStatus: 'linked' | 'client_recollection' | 'unavailable' | 'unknown';
  responseStatus: 'none' | 'acknowledged' | 'inspection_arranged' | 'repair_promised' | 'repair_attempted' | 'repaired' | 'disputed' | 'other';
  responseSummary: string;
  supersedesNoticeId: string | null;
  createdBy: string;
  createdAt: string;
  evidenceIds: string[];
}

export interface EvidenceAccessEvent {
  id: string;
  eventType: 'offered' | 'scheduled' | 'attempted' | 'completed' | 'refused_by_landlord' | 'refused_by_client' | 'no_access' | 'cancelled';
  appointmentAt: string | null;
  notes: string;
  supersedesAccessEventId: string | null;
  createdBy: string;
  createdAt: string;
  evidenceIds: string[];
}

export interface EvidenceItemRecord {
  id: string;
  kind: 'photograph' | 'video' | 'correspondence' | 'repair_record' | 'tenancy_record' | 'medical_link' | 'client_statement' | 'other';
  title: string;
  description: string;
  occurredOn: string | null;
  provenanceSource: 'client' | 'solicitor' | 'landlord' | 'managing_agent' | 'contractor' | 'expert' | 'medical_provider' | 'third_party' | 'other';
  provenanceDetail: string;
  documentVersion: EvidenceDocumentVersion;
  defectIds: string[];
  noticeIds: string[];
  accessEventIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface EvidenceWorkspace {
  matterId: string;
  permissions: { canWrite: boolean };
  defects: EvidenceDefect[];
  notices: EvidenceNotice[];
  accessEvents: EvidenceAccessEvent[];
  evidenceItems: EvidenceItemRecord[];
  availableDocumentVersions: EvidenceDocumentVersion[];
  readiness: {
    controls: Array<{
      key: 'defect_schedule_recorded' | 'notice_evidence_recorded' | 'photographs_recorded';
      eligible: boolean;
      explanation: string;
    }>;
  };
  risks: Array<{
    key: string;
    type: 'serious_open_defect' | 'defect_without_evidence' | 'notice_proof_gap' | 'notice_evidence_missing' | 'failed_access' | 'photographs_missing' | 'ineligible_control';
    level: 'medium' | 'high' | 'critical';
    title: string;
    detail: string;
    entityId: string | null;
  }>;
}

export interface ProtocolGeneratedDocumentVersion {
  documentId: string;
  id: string;
  version: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ProtocolWorkspace {
  matterId: string;
  case: {
    id: string;
    version: number;
    protocolStatus: string;
    expertRoute: string;
    expertRouteReason: string;
    urgentReason: string;
    createdAt: string;
    updatedAt: string;
  };
  letter: {
    id: string;
    version: number;
    state: string;
    draft: Record<string, unknown>;
    source: {
      model: {
        matterReference?: string;
        defects: Array<{
          id: string;
          location: string;
          title: string;
          description?: string;
          status?: string;
          severity?: string;
        }>;
        notices?: Array<{ id: string; occurredAt: string; channel: string; summary: string }>;
        access?: Array<{ id: string; eventType: string; appointmentAt: string | null; notes: string }>;
        effectNarrative?: string;
        disclosureRequests?: string[];
      };
      blockers: Array<{ key: string; label: string; sourceType?: string }>;
      warnings: Array<{ key: string; label: string; sourceType?: string }>;
    };
    authorUserId: string;
    reviewerUserId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  letterVersions: Array<{
    id: string;
    version: number;
    model: Record<string, unknown>;
    sourceManifest: Record<string, unknown>;
    templateKey: string;
    rendererVersion: string;
    contentSha256: string;
    documentVersion: ProtocolGeneratedDocumentVersion;
    approvedBy: string;
    approvedAt: string;
    sourceFreshness: { fresh: boolean; added: string[]; changed: string[]; removed: string[] };
  }>;
  serviceEvents: Array<{
    id: string;
    letterVersionId: string;
    eventType: string;
    method: string;
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
  }>;
  landlordResponses: Array<{
    id: string;
    responseType: string;
    receivedOn: string | null;
    respondingParty: string;
    contactName: string;
    generalLiabilityPosition: string;
    liabilityReasons: string;
    noticePosition: string;
    accessPosition: string;
    disclosureStatus: string;
    disclosureSummary: string;
    expertProposalPosition: string;
    expertProposalSummary: string;
    worksSchedule: string;
    worksStartOn: string | null;
    worksCompleteOn: string | null;
    compensationOfferMinor: number | null;
    costsOfferMinor: number | null;
    currency: string;
    sourceDocumentVersionId: string | null;
    supersedesResponseId: string | null;
    defectPositions: Array<{ defectId: string; position: string; reason: string }>;
    createdBy: string;
    createdAt: string;
  }>;
  experts: Array<{
    id: string;
    version: number;
    route: string;
    expertRole: string;
    expertName: string;
    organisation: string;
    email: string;
    phone: string;
    expertise: string;
    qualifications: string;
    registrationBody: string;
    registrationReference: string;
    verificationStatus: string;
    verificationMethod: string;
    verifiedOn: string | null;
    proposedBy: string;
    singleJoint: boolean;
    termsStatus: string;
    feeBasis: string;
    feeMinor: number | null;
    currency: string;
    payerSplit: { claimantPercent: number; landlordPercent: number };
    availabilitySummary: string;
    targetReportOn: string | null;
    state: string;
    conflictChecks: Array<{ id: string; outcome: string; decision: string; reason: string; [key: string]: unknown }>;
    instructionVersions: Array<{ id: string; version: number; documentVersion: ProtocolGeneratedDocumentVersion; [key: string]: unknown }>;
    milestones: Array<{ id: string; eventType: string; occurredAt: string; detail: string; [key: string]: unknown }>;
    reports: Array<{ id: string; reportType: string; receivedOn: string; reviewed: boolean; documentVersion: ProtocolGeneratedDocumentVersion; [key: string]: unknown }>;
    questions: Array<{ id: string; question: string; responseDueOn: string | null; answers: unknown[]; [key: string]: unknown }>;
    createdAt: string;
    updatedAt: string;
  }>;
  deadlines: MatterLegalDeadline[];
  readiness: {
    controls: Array<{ key: string; eligible: boolean; explanation: string }>;
    progressionBlockers: MatterWorkflowBlocker[];
  };
  risks: Array<{
    key: string;
    type: string;
    level: 'medium' | 'high' | 'critical';
    title: string;
    detail: string;
    entityId: string | null;
  }>;
  permissions: {
    canPrepare: boolean;
    canApprove: boolean;
    canOverrideConflict: boolean;
    canReviewReport: boolean;
  };
}

export interface RepairProjection {
  status: string;
  producingEventId: string | null;
  lastAccessOutcome: string | null;
  completionAsserted: boolean;
  clientPosition: 'not_recorded' | 'accepted' | 'disputed';
  verification: 'not_verified' | 'failed' | 'verified';
  warnings: Array<{ key: string; detail: string }>;
}

export interface WorkScheduleRecord {
  id: string;
  scheduleVersion: number;
  recordVersion: number;
  title: string;
  sourceType: string;
  sourceDocumentVersionId: string | null;
  status: string;
  basedOnScheduleId: string | null;
  approvalNote: string;
  acknowledgedWarningKeys: string[];
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  items: Array<{
    id: string;
    lineageKey: string;
    area: string;
    description: string;
    responsibilityPosition: string;
    priority: 'urgent' | 'high' | 'routine';
    targetStartOn: string | null;
    targetCompletionOn: string | null;
    estimatedCostMinor: number | null;
    currency: string;
    contractor: string;
    sourceNote: string;
    displayPosition: number;
    defectIds: string[];
    evidenceItemIds: string[];
    repairEvents: Array<{
      id: string;
      eventType: string;
      occurredAt: string;
      actorType: string;
      verifier: string;
      evidenceIds: string[];
    }>;
    projection: RepairProjection;
  }>;
}

export interface LossScheduleRecord {
  id: string;
  scheduleVersion: number;
  recordVersion: number;
  title: string;
  status: string;
  basedOnScheduleId: string | null;
  valuationOn: string;
  currency: string;
  notes: string;
  approvalNote: string;
  acknowledgedEvidenceGapItemIds: string[];
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  items: Array<{
    id: string;
    recordVersion: number;
    lineageKey: string;
    category: string;
    description: string;
    periodStartOn: string | null;
    periodEndOn: string | null;
    calculationType: string;
    quantity: string | null;
    unitLabel: string;
    rateMinor: number | null;
    fixedAmountMinor: number | null;
    manualAmountMinor: number | null;
    manualBasis: string;
    calculatedAmountMinor: number;
    calculation: string;
    currency: string;
    position: string;
    evidenceStatus: string;
    sourceNote: string;
    displayPosition: number;
    evidenceItemIds: string[];
  }>;
  totals: {
    specialDamagesMinor: number;
    byPosition: Record<string, number>;
    byCategory: Record<string, number>;
    evidenceGapCount: number;
    unsupportedAmountMinor: number;
    generalDamages: {
      lowMinor: number;
      highMinor: number;
      preferredMinor: number | null;
    } | null;
    combined: { lowMinor: number; highMinor: number } | null;
  };
}

export interface OfferRecord {
  id: string;
  offerReference: string;
  recordVersion: number;
  direction: string;
  offerType: string;
  confidentiality: string;
  scope: string;
  scopeDescription: string;
  damagesMinor: number | null;
  costsMinor: number | null;
  totalMinor: number | null;
  currency: string;
  worksTerms: string;
  nonMoneyTerms: string;
  interestTreatment: string;
  writtenOfferDocumentVersionId: string | null;
  madeOn: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  part36: {
    relevantPeriodDays: number;
    relevantPeriodBasis: string;
    serviceOn: string | null;
    serviceConfirmed: boolean;
    projectedPeriodEndOn: string | null;
    calculationExplanation: string;
    includesCounterclaim: boolean;
    paymentPeriodDays: number;
    validationStatus: string;
    validationNote: string;
  } | null;
  events: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    note: string;
    sourceDocumentVersionId: string | null;
    supersedesEventId: string | null;
    explicitConfirmation: boolean;
    createdBy: string;
    createdAt: string;
  }>;
}

export type ProtectedOffer = OfferRecord;

export interface RepairsQuantumWorkspace {
  matterId: string;
  permissions: {
    canWrite: boolean;
    canApprove: boolean;
    canWriteOffers: boolean;
    canReadProtectedOffers: boolean;
    canRecordOfferOutcome: boolean;
  };
  workSchedules: WorkScheduleRecord[];
  lossSchedules: LossScheduleRecord[];
  generalDamagesReviews: Array<{
    id: string;
    valuationOn: string;
    lowMinor: number;
    highMinor: number;
    preferredMinor: number | null;
    currency: string;
    basis: string;
    authorities: string[];
    reviewNote: string;
    nonePresentlyAdvanced: boolean;
    supersedesReviewId: string | null;
    reviewedBy: string;
    reviewedAt: string;
  }>;
  openOffers: OfferRecord[];
  protectedOfferCount: number;
  readiness: {
    controls: Array<{ key: string; eligible: boolean; explanation: string }>;
  };
}

export type CommunicationChannel =
  | 'email'
  | 'whatsapp'
  | 'telephone'
  | 'letter'
  | 'portal'
  | 'sms'
  | 'in_person'
  | 'internal';

export interface CommunicationParticipant {
  role: string;
  displayName: string;
  endpointType: string;
  endpoint: string;
  partyId: string | null;
  userId: string | null;
}

export interface CommunicationTransport {
  state: string;
  providerAcceptedAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  producingEventId: string | null;
}

export interface CommunicationAttachment {
  documentVersionId: string;
  purpose: string;
  fileName: string;
  sha256: string;
}

export interface CommunicationEntry {
  id: string;
  conversationId: string;
  channel: CommunicationChannel;
  direction: 'inbound' | 'outbound' | 'internal';
  confidentiality: 'ordinary' | 'internal' | 'privileged' | 'protected_negotiation';
  participants: CommunicationParticipant[];
  subject: string;
  body: string;
  bodyFormat: string;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
  source: string;
  providerKey: string | null;
  externalMessageId: string | null;
  externalThreadId: string | null;
  supersedesEntryId: string | null;
  correctionReason: string;
  attachments: CommunicationAttachment[];
  call: {
    id: string;
    providerKey: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    purpose: string;
    outcome: string;
    identityCheckStatus: string;
    identityCheckNote: string;
    recordingStatus: string;
    noticeConsentBasis: string;
    externalCallId: string | null;
  } | null;
  serviceAssertion: {
    id: string;
    assertedMethod: string;
    serviceAt: string;
    recipient: string;
    endpoint: string;
    sourceDocumentVersionId: string | null;
    factualNote: string;
    reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
    assertedBy: string;
    assertedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
  } | null;
  transport: CommunicationTransport;
}

export interface CommunicationDraft {
  id: string;
  conversationId: string;
  channel: CommunicationChannel;
  confidentiality: CommunicationEntry['confidentiality'];
  status: string;
  recordVersion: number;
  currentVersion: {
    id: string;
    version: number;
    participants: CommunicationParticipant[];
    subject: string;
    body: string;
    bodyFormat: string;
    attachments: CommunicationAttachment[];
    createdBy: string;
    createdAt: string;
  };
  currentApproval: {
    id: string;
    decision: string;
    note: string;
    actorUserId: string;
    occurredAt: string;
  } | null;
  dispatch: {
    id: string;
    providerKey: string;
    status: string;
    externalMessageId: string | null;
    lastErrorCode: string | null;
    lastErrorDetail: string | null;
    createdAt: string;
    lastEventAt: string;
    transport: CommunicationTransport;
  } | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CommunicationProviderCapabilities {
  key: string;
  operations: {
    send_email: boolean;
    send_whatsapp_message: boolean;
    start_whatsapp_call: boolean;
    receive_events: boolean;
    delivery_receipts: boolean;
  };
  reasons: Partial<Record<keyof CommunicationProviderCapabilities['operations'], string>>;
}

export interface CommunicationWorkspace {
  matterId: string;
  permissions: {
    canWrite: boolean;
    canApprove: boolean;
    canSend: boolean;
    canReadPrivileged: boolean;
    canReadProtected: boolean;
    canManageProvider: boolean;
  };
  counts: { total: number; inbound: number; outbound: number; drafts: number };
  entries: CommunicationEntry[];
  drafts: CommunicationDraft[];
  providerCapabilities: CommunicationProviderCapabilities[];
}

export interface NegotiationReviewRecord {
  id: string;
  reviewNumber: number;
  confidentiality: 'ordinary' | 'privileged' | 'protected_negotiation';
  reviewedOn: string;
  confirmedFacts: string;
  optionsExplained: string;
  riskAnalysis: string;
  costsFundingExplanation: string;
  humanRecommendation: string;
  adviceLimitations: string;
  clientQuestions: string;
  sourceManifestDigest: string;
  supersedesReviewId: string | null;
  createdAt: string;
}

export interface ClientInstructionRecord {
  id: string;
  confidentiality: NegotiationReviewRecord['confidentiality'];
  instructionType: string;
  instructingPerson: string;
  decisionNote: string;
  receivedMethod: string;
  receivedAt: string;
  identityStatus: string;
  actionVersion: number | null;
  settlementTermsVersion: number | null;
  supersedesInstructionId: string | null;
}

export interface SettlementAuthorityRecord {
  id: string;
  version: number;
  source: string;
  scope: string;
  actionTypes: string[];
  minimumAmountMinor: number | null;
  maximumAmountMinor: number | null;
  requiresClientInstruction: boolean;
  requiresPartnerApproval: boolean;
  expiresAt: string | null;
  reviewOn: string | null;
  reviewNote: string;
}

export interface NegotiationActionRecord {
  id: string;
  actionReference: string;
  recordVersion: number;
  actionType: string;
  confidentiality: NegotiationReviewRecord['confidentiality'];
  currentVersion: { id: string; version: number; totalMinor: number | null; currency: string };
  projection: {
    state: string;
    instructionCurrent: boolean;
    approvalCurrent: boolean;
    canRecordExternalAction: boolean;
  };
}

export interface SettlementRecord {
  id: string;
  settlementReference: string;
  recordVersion: number;
  settlementType: string;
  confidentiality: NegotiationReviewRecord['confidentiality'];
  title: string;
  courtApprovalPosition: string;
  currentTerms: null | {
    id: string;
    version: number;
    totalMinor: number | null;
    currency: string;
    paymentDueAt: string | null;
    repairTerms: string;
    termsDigest: string;
  };
  projection: { state: string; canConclude: boolean };
}

export interface NegotiationWorkspace {
  matterId: string;
  reviews: NegotiationReviewRecord[];
  instructions: ClientInstructionRecord[];
  actions: NegotiationActionRecord[];
  settlements: SettlementRecord[];
  currentAuthority: SettlementAuthorityRecord | null;
}

export interface CourtProceedingRecord {
  id: string; proceedingReference: string; procedureType: string; jurisdiction: string;
  courtName: string; caseNumber: string | null; track: string | null;
  currentState: string; issuedAt: string | null; disposalPosition: string; version: number;
}

export interface ProceedingAuthorityRecord {
  id: string; version: number; reviewOn: string | null;
}

export interface CourtFilingRecord {
  id: string; filingReference: string; purpose: string; currentState: string;
  version: number; documentVersionIds: string[]; events: unknown[];
}

export interface CourtServiceRecord {
  id: string; serviceReference: string; method: string; recipientPartyId: string;
  currentState: string; version: number; events: unknown[];
}

export interface CourtApplicationRecord {
  id: string; applicationReference: string; requestedOrder: string; noticePosition: string;
  currentState: string; version: number; events: unknown[];
}

export interface CourtOrderRecord {
  id: string; orderReference: string; orderType: string; title: string;
  orderDate: string; takesEffectAt: string; servicePosition: string;
}

export interface CourtDirectionRecord {
  id: string; directionReference: string; category: string; requirementText: string;
  dueAt: string | null; currentState: string; version: number;
  projection: { state: string; overdue: boolean; dueSoon: boolean }; events: unknown[];
}

export interface CourtHearingRecord {
  id: string; hearingReference: string; hearingType: string; title: string;
  startsAt: string; courtName: string; attendanceMode: string; currentState: string;
  version: number; projection: { state: string; outcomeRecorded: boolean };
  resultingOrderId: string | null; events: unknown[];
}

export interface ProceedingsWorkspace {
  proceeding: CourtProceedingRecord | null;
  authority: ProceedingAuthorityRecord | null;
  events: unknown[];
  filings: CourtFilingRecord[];
  services: CourtServiceRecord[];
  applications: CourtApplicationRecord[];
  orders: CourtOrderRecord[];
  directions: CourtDirectionRecord[];
  hearings: CourtHearingRecord[];
  risks: Array<{ key?: string; severity?: string; title?: string; detail?: string }>;
  sources?: {
    documents: Array<{ id: string; title: string; version: number; originalName: string }>;
    parties: Array<{ id: string; name: string; kind: string }>;
    users: Array<{ id: string; name: string; role: string }>;
    clientInstructions: Array<{ id: string; instructionType: string; instructingPerson: string; receivedAt: string }>;
  };
  permissions?: {
    canRead: boolean; canPrepare: boolean; canApproveIssue: boolean;
    canRecordExternal: boolean; canManageDirections: boolean;
    canManageHearings: boolean; canRecordOrder: boolean;
    canRecordRelief: boolean;
  };
}

export interface PleadingDeadlineRecord {
  id: string; kind: string; outcome: string; triggerDate: string | null;
  projectedDate: string | null; ruleKey: string; ruleVersion: string;
  sourceTitle: string; sourceUrl: string; sourceDocumentVersionId: string | null;
  reviewedAt: string | null; createdAt: string;
}

export interface DefaultJudgmentReviewRecord {
  id: string; outcome: 'review_incomplete' | 'blockers_recorded' | 'human_review_completed';
  blockers: string[]; claimType: string; requestedMethod: string; note: string;
  version: number; reviewedBy: string | null; reviewedAt: string | null;
}

export interface PleadingResponseTrack {
  id: string; proceedingId: string; claimantPartyId: string; defendantPartyId: string;
  claimFormDocumentVersionId: string; particularsDocumentVersionId: string | null;
  regime: string; serviceRecordId: string | null; currentState: string; version: number;
  createdAt: string; updatedAt: string;
  claimant: { id: string; name: string; kind: string } | null;
  defendant: { id: string; name: string; kind: string } | null;
  events: unknown[]; statements: PleadingStatementRecord[]; deadlines: PleadingDeadlineRecord[];
  defaultReviews: DefaultJudgmentReviewRecord[];
}

export interface PleadingsWorkspace {
  proceedingId: string;
  actingUserId: string;
  tracks: PleadingResponseTrack[];
  sources: {
    documents: Array<{ id: string; title: string; version: number; originalName: string }>;
    parties: Array<{ id: string; name: string; kind: string }>;
  };
  permissions: {
    canRead: boolean; canPrepare: boolean; canRecordExternal: boolean;
    canApproveClaimantStatement: boolean; canReviewDefault: boolean;
    canRecordAmendmentAuthority: boolean;
  };
}

export interface PleadingStatementRecord {
  id: string; proceedingId: string; trackId: string | null; statementType: string;
  partyId: string; version: number;
  currentVersion: null | {
    id: string; versionNumber: number; statementType: string; documentVersionId: string;
    predecessorVersionId: string | null; statementOfTruthStatus: string;
    signatoryName: string; signatoryCapacity: string; signedAt: string | null;
    responsePosition: string; amendmentRoute: string; amendmentReason: string;
    preparedByUserId: string; createdAt: string;
  };
  events: unknown[];
  amendmentAuthorities: Array<{
    id: string; statementVersionId: string; route: string;
    consentDocumentVersionId: string | null; applicationId: string | null;
    sealedOrderId: string | null; reviewedBy: string; reviewedAt: string; note: string;
  }>;
  projection: { filingState: string; serviceState: string };
}

export interface DisclosureSuggestionRecord {
  id: string; relevance: string; privilegeWarning: string; rationale: string;
  model: string; policyVersion: string; sourceHash: string; citedSpans: string[];
  suggestedIssueTags: string[]; createdBy: string; createdAt: string; provisional: true;
}
export interface DisclosureCandidateRecord {
  id: string; reviewId: string; documentVersionId: string; evidenceItemId: string | null;
  custodian: string; sourceNote: string; version: number; createdAt: string; updatedAt: string;
  suggestions: DisclosureSuggestionRecord[];
  decisions: Array<{ id: string; decision: string; redactionRequired: boolean; reason: string; reviewedBy: string; reviewedAt: string; createdAt: string }>;
  privilegeReviews: Array<{ id: string; category: string; outcome: string; basis: string; reviewedAt: string }>;
  redactions: Array<{ id: string; originalDocumentVersionId: string; redactedDocumentVersionId: string; status: string; reviewedAt: string }>;
  projection: { state: string; restricted: boolean; canList: boolean; effectiveDocumentVersionId: string; suggestion: unknown; decision: unknown; privilege: unknown; redaction: unknown };
}
export interface RestrictedDisclosureCandidate {
  id: string; reviewId: string; version: number; restricted: true; state: string; createdAt: string; updatedAt: string;
}
export interface DisclosureListRecord {
  id: string; reviewId: string; disclosingPartyId: string; snapshotNumber: number; title: string;
  blockers: Array<{ candidateId: string; reason: string }>; generatedBy: string; generatedAt: string;
  note: string; entries: Array<{ id: string; candidateId: string; documentVersionId: string; decisionId: string; description: string }>;
}
export interface InspectionRequestRecord {
  id: string; disclosureListId: string; requestingPartyId: string; version: number; receivedAt: string;
  note: string; itemIds: string[]; createdAt: string; updatedAt: string; events: unknown[];
  projection: { received: boolean; acknowledged: boolean; refused: boolean; agreed: boolean; provided: boolean; completed: boolean; events: unknown[] };
}
export interface DisclosureReviewRecord {
  id: string; proceedingId: string; disclosingPartyId: string; directionId: string | null;
  scopeVersion: number; scopeNote: string; dateFrom: string | null; dateTo: string | null;
  custodians: string[]; issueTags: string[]; version: number; createdAt: string; updatedAt: string;
  candidates: Array<DisclosureCandidateRecord | RestrictedDisclosureCandidate>;
  lists: DisclosureListRecord[]; inspectionRequests: InspectionRequestRecord[];
}
export interface DisclosureWorkspace {
  proceedingId: string; actingUserId: string; reviews: DisclosureReviewRecord[];
  sources: { documents: Array<{ id: string; title: string; version: number; originalName: string }>;
    parties: Array<{ id: string; name: string; kind: string }> };
  permissions: { canRead: boolean; canPrepare: boolean; canReview: boolean; canReviewPrivilege: boolean;
    canWaivePrivilege: boolean; canApproveRedaction: boolean; canGenerateList: boolean; canRecordExternal: boolean };
}

export type FinanceCurrency = 'GBP';
export type FinanceNotConnected = { state: 'not_connected' };

export interface FinanceActivitySuggestion {
  id: string; userId: string; sourceKind: string; sourceId: string; minutes: number;
  observedAt: string; proposedActivityCode: string; proposedCostsPhase: string;
  proposedNarrative: string; confidence: 'high' | 'medium' | 'low'; explanation: string;
  model: string; policyVersion: string; inputHash: string; version: number;
  status: 'pending' | 'accept' | 'edit' | 'split' | 'reject';
  decisions: Array<{ id: string; decision: string; reason: string | null; decidedBy: string; decidedAt: string }>;
  createdAt: string; provisional: true; label: 'AI suggestion — human review required';
}

export interface FinanceTimer {
  id: string; matterId: string; userId: string; activityCode: string; costsPhase: string;
  narrative: string | null; status: 'running' | 'stopped' | 'cancelled'; startedAt: string;
  stoppedAt: string | null; elapsedMinutes: number | null; version: number;
  createdAt: string; updatedAt: string;
}

export interface FinanceTimeEntry {
  id: string; userId: string; workDate: string; minutes: number; narrative: string | null;
  activityCode: string; costsPhase: string; chargeable: boolean; sourceKind: string;
  sourceId: string | null; currency: FinanceCurrency;
  status: 'submitted' | 'approved' | 'rejected' | 'reversed'; version: number;
  createdBy: string; createdAt: string; events: Array<Record<string, unknown>>;
  approvalId: string | null; rateVersionId: string | null; rateEntryId: string | null;
  gradeSnapshot: string | null; hourlyRateMinor: number | null; chargeMinor: number | null;
  remainderNumerator: number | null; denominator: number | null; approvedBy: string | null;
  approvedAt: string | null; approvalNote: string | null;
}

export interface FinanceEstimateVersion {
  id: string; estimateId: string; versionNumber: number; effectiveOn: string; scope: string | null;
  feesMinor: number; disbursementsMinor: number; vatMinor: number; overallLimitMinor: number;
  currency: FinanceCurrency; reviewOn: string | null; sourceDocumentVersionId: string | null;
  approvalNote: string | null; approvedBy: string; createdAt: string;
  thresholds: Array<{ id: string; thresholdPercent: number }>;
}

export interface FinanceWarning {
  id: string; thresholdId: string; estimateVersionId: string; thresholdPercent: number;
  crossedAt: string; exposureMinor: number; currency: FinanceCurrency;
  state: 'open' | 'closed_by_new_estimate'; latestEvent: string; version: number;
  events: Array<Record<string, unknown>>;
}

export interface FinanceDisbursement {
  id: string; supplier: string; invoiceReference: string; category: string; description: string;
  netMinor: number; vatMinor: number; grossMinor: number; currency: FinanceCurrency;
  invoiceDate: string | null; dueOn: string | null; sourceDocumentVersionId: string | null;
  createdBy: string; createdAt: string;
  status: 'proposed' | 'approved' | 'incurred' | 'paid_external' | 'cancelled' | 'corrected';
  version: number; events: Array<Record<string, unknown>>; approved: boolean; incurred: boolean;
  paidExternally: boolean; cancelled: boolean; corrected: boolean; billed: false; recovered: false;
  duplicateFindings: Array<{ matchedDisbursementId: string; reasons: string[]; provisional: true; label: string }>;
}

export interface FinanceJournalLine {
  id: string; lineNumber: number; accountId: string; accountClass: string;
  designation: 'client' | 'office' | 'neutral'; accountCode: string; accountName: string;
  matterId: string; debitMinor: number; creditMinor: number; currency: FinanceCurrency; memo: string;
}

export interface FinanceJournal {
  id: string; periodId: string; accountingDate: string;
  sourceKind: 'wip_control' | 'disbursement_control' | 'reversal' | 'other'; sourceId: string;
  description: string; currency: FinanceCurrency; reversesJournalId: string | null;
  preparedBy: string; preparedAt: string; approvedBy: string | null; approvedAt: string | null;
  postedBy: string | null; postedAt: string | null;
  status: 'draft' | 'approved' | 'posted' | 'rejected' | 'reversed'; version: number;
  totalDebitMinor: number; totalCreditMinor: number; lines: FinanceJournalLine[];
  events: Array<Record<string, unknown>>;
}

export interface FinanceRateCard {
  id: string; name: string; description: string; currency: FinanceCurrency; version: number;
  createdBy: string; createdAt: string; updatedAt: string;
  versions: Array<{
    id: string; rateCardId: string; versionNumber: number; effectiveFrom: string;
    effectiveTo: string | null; note: string; preparedBy: string; createdAt: string;
    status: 'draft' | 'active' | 'retired'; events: Array<Record<string, unknown>>;
    entries: Array<{ id: string; grade: string; userId: string | null; activityCode: string;
      matterId: string | null; hourlyRateMinor: number; currency: FinanceCurrency }>;
  }>;
}

export interface FinanceDocumentSource {
  id: string; documentId: string; title: string; category: string; version: number; originalName: string;
}

export interface FinanceWorkspace {
  matterId: string; actingUserId: string;
  permissions: {
    canRecordTime: boolean; canApproveTime: boolean; canManageRates: boolean;
    canManageEstimates: boolean; canManageDisbursements: boolean;
    canPrepareJournal: boolean; canApproveJournal: boolean; canPostJournal: boolean;
  };
  suggestions: FinanceActivitySuggestion[]; timers: FinanceTimer[]; timeEntries: FinanceTimeEntry[];
  warnings: FinanceWarning[]; estimates: FinanceEstimateVersion[];
  disbursements: FinanceDisbursement[];
  ledger: {
    journals: FinanceJournal[];
    balances: Array<{ accountId: string; matterId: string | null; designation: 'client' | 'office' | 'neutral';
      currency: FinanceCurrency; debitMinor: number; creditMinor: number; netMinor: number }>;
  };
  snapshot: {
    provisionalTime: { minutes: number; estimatedChargeMinor: number; unpricedCount: number; currency: FinanceCurrency };
    approvedWip: { minutes: number; amountMinor: number; currency: FinanceCurrency };
    disbursements: {
      proposedMinor: number; approvedExposureMinor: number; cancelledMinor: number;
      byStatus: Record<'proposed' | 'approved' | 'incurred' | 'paid_external' | 'cancelled', number>;
      currency: FinanceCurrency;
    };
    estimate: null | { versionId: string; overallLimitMinor: number; currentExposureMinor: number;
      varianceMinor: number; currency: FinanceCurrency };
    clientBalance: FinanceNotConnected; officeBalance: FinanceNotConnected;
    billed: FinanceNotConnected; paid: FinanceNotConnected; recovered: FinanceNotConnected;
  };
  sources: { documents: FinanceDocumentSource[] };
}

export interface MatterBillLine {
  id: string; lineNumber: number; sourceKind: 'time' | 'disbursement' | 'adjustment'; sourceId: string;
  narrative: string; netMinor: number; vatTreatment: string; vatMinor: number; grossMinor: number;
}

export interface MatterBill {
  id: string; clientPartyId: string; status: string; billReference: string | null;
  currentVersionId: string; approvedVersionId: string | null; issuedVersionId: string | null;
  issuedAt: string | null; deliveredAt: string | null; dueOn: string; netMinor: number;
  vatMinor: number; grossMinor: number; creditedMinor: number; allocatedMinor: number;
  paidMinor: number; outstandingMinor: number; currency: FinanceCurrency; version: number;
  preparedBy: string; preparedAt: string; taxPoint: string | null; documentVersionId: string | null;
  documentSha256: string | null; lines: MatterBillLine[]; events: Array<Record<string, unknown>>;
}

export interface MatterMoneyBalance {
  clientPartyId: string; clientHeldMinor: number; clientClearedMinor: number;
  clientRestrictedMinor: number; clientAvailableMinor: number; clientReservedMinor: number;
  officeHeldMinor: number;
}

export interface MatterPayment {
  id: string; clientPartyId: string; amountMinor: number; purpose: string; preparedBy: string; preparedAt: string;
  currency: FinanceCurrency; version: number; status: string; events: Array<Record<string, unknown>>;
}

export interface MatterTransfer {
  id: string; clientPartyId: string; billId: string; amountMinor: number; preparedBy: string;
  preparedAt: string; currency: FinanceCurrency; version: number; status: string;
  events: Array<Record<string, unknown>>;
}

export interface MatterBillingWorkspace {
  matterId: string; actingUserId: string;
  permissions: {
    canPrepareBill: boolean; canApproveBill: boolean; canIssueBill: boolean;
    canPrepareTransfer: boolean; canApproveTransfer: boolean; canPostTransfer: boolean;
  };
  clients: Array<{ id: string; name: string }>;
  eligibleSources: Array<{ id: string; kind: 'time' | 'disbursement'; narrative: string; netMinor: number; vatMinor: number | null }>;
  bills: MatterBill[]; money: MatterMoneyBalance[]; payments: MatterPayment[]; transfers: MatterTransfer[];
  exceptions: Array<{ id: string; kind: string; severity: string; summary: string; amountMinor: number | null; raisedAt: string }>;
  history: Array<{ id: string; kind: string; recordId: string; status: string; occurredAt: string; summary: string }>;
}

export type MatterSection =
  | 'overview'
  | 'client_household'
  | 'property_tenancy'
  | 'defects_repairs'
  | 'evidence'
  | 'documents'
  | 'communications'
  | 'protocol_experts'
  | 'damages_offers'
  | 'negotiation_settlement'
  | 'proceedings'
  | 'disclosure'
  | 'tasks_calendar'
  | 'time_finance'
  | 'chronology'
  | 'audit';

export interface TransitionWorkflowCommand {
  toStageKey: string;
  expectedVersion: number;
  completedChecklistKeys: string[];
  reason: string;
  overrideReason?: string;
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? ((await response.json()) as ErrorPayload & T) : undefined;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.',
      payload?.error?.fields,
      payload?.details,
    );
  }
  return payload as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
