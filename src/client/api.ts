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
  | 'proceedings'
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
