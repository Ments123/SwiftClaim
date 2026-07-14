import type { MatterWorkflowRecord } from '../workflow/store.js';

export type EnquiryStatus =
  | 'new'
  | 'assessment'
  | 'accepted'
  | 'declined'
  | 'referred'
  | 'duplicate'
  | 'unable_to_contact'
  | 'converted';

export type EnquiryUrgency = 'routine' | 'priority' | 'urgent' | 'critical';

export interface IntakeContactSummary {
  id: string;
  displayName: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string | null;
  email: string;
  phone: string;
  preferredChannel: 'email' | 'phone' | 'sms' | 'post';
}

export interface IntakePropertySummary {
  id: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
  propertyType: string;
}

export interface IntakeOrganisationSummary {
  id: string;
  name: string;
  kind: string;
}

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
  urgency: EnquiryUrgency;
  immediateSafetyConcerns: string;
  communicationRequirements: string;
  decisionReason: string;
  createdAt: string;
  updatedAt: string;
  client: IntakeContactSummary;
  property: IntakePropertySummary;
  landlord: IntakeOrganisationSummary | null;
  assignedTo: { id: string; name: string; role: string };
}

export type EnquiryListItem = EnquiryDetail;

export interface ConflictMatch {
  source: 'matter' | 'enquiry' | 'contact' | 'property' | 'organisation';
  display: string;
  matchedOn: string[];
}

export interface ConflictCheckResult {
  id: string;
  enquiryId: string;
  matchCount: number;
  matches: ConflictMatch[];
  runAt: string;
  runBy: { id: string; name: string };
}

export interface ConflictDecisionResult {
  id: string;
  checkId: string;
  decision: 'clear' | 'blocked' | 'cleared_with_override';
  reason: string;
  decidedAt: string;
  decidedBy: { id: string; name: string };
}

export type AssessmentDecision = 'draft' | 'proceed' | 'decline' | 'refer';

export interface AssessmentRecord {
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
  decision: AssessmentDecision;
  decisionReason: string;
  reviewedBy: { id: string; name: string; role: string } | null;
  reviewedAt: string | null;
  updatedBy: { id: string; name: string };
  updatedAt: string;
}

export interface HouseholdMemberRecord {
  id: string;
  displayName: string;
  relationship: string;
  currentlyOccupies: boolean;
  claimParticipant: boolean;
  vulnerabilitySummary: string;
  accessibilityNeeds: string;
}

export interface TenancyRecord {
  id: string;
  tenancyType:
    | 'secure'
    | 'assured'
    | 'assured_shorthold'
    | 'introductory'
    | 'flexible'
    | 'leasehold'
    | 'licence'
    | 'other'
    | 'unknown';
  startedOn: string | null;
  endedOn: string | null;
  rentMinor: number;
  currency: string;
  rentFrequency:
    | 'weekly'
    | 'fortnightly'
    | 'monthly'
    | 'quarterly'
    | 'annual'
    | 'other';
  occupancyStartedOn: string | null;
  occupancyEndedOn: string | null;
}

export interface OnboardingRecord {
  id: string;
  enquiryId: string;
  version: number;
  identityStatus: 'not_started' | 'pending' | 'complete' | 'failed';
  clientCareStatus: 'not_started' | 'pending' | 'complete';
  authorityStatus: 'not_started' | 'pending' | 'complete';
  privacyStatus: 'not_started' | 'pending' | 'complete';
  fundingType:
    | 'unconfirmed'
    | 'cfa'
    | 'legal_aid'
    | 'private'
    | 'before_event'
    | 'trade_union'
    | 'other';
  fundingStatus: 'not_started' | 'pending' | 'complete';
  signatureStatus: 'not_started' | 'sent' | 'complete';
  vulnerabilitySummary: string;
  accessibilityNeeds: string;
  interpreterLanguage: string | null;
  safeContactInstructions: string;
  owner: { id: string; name: string; role: string } | null;
  supervisor: { id: string; name: string; role: string } | null;
  tenancy: TenancyRecord | null;
  householdMembers: HouseholdMemberRecord[];
  updatedBy: { id: string; name: string };
  updatedAt: string;
}

export interface ReadinessBlocker {
  key: string;
  label: string;
  severity: 'critical' | 'warning';
}

export interface ReadinessSection {
  ready: boolean;
  blockers: ReadinessBlocker[];
}

export interface IntakeReadiness {
  assessment: ReadinessSection;
  onboarding: ReadinessSection;
  conversion: ReadinessSection;
}

export interface ConvertedMatterSummary {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  stage: string;
  owner: { id: string; name: string };
}

export interface IntakeConversionResult {
  id: string;
  idempotencyKey: string;
  convertedAt: string;
  replayed: boolean;
  enquiry: EnquiryDetail;
  matter: ConvertedMatterSummary;
  workflow: MatterWorkflowRecord;
}

export interface IntakeWorkspace {
  enquiry: EnquiryDetail;
  conflict: {
    latestCheck: ConflictCheckResult | null;
    latestDecision: ConflictDecisionResult | null;
  };
  assessment: AssessmentRecord | null;
  onboarding: OnboardingRecord | null;
  readiness: IntakeReadiness;
  conversion: IntakeConversionResult | null;
}

export interface MatterIntakeProfile {
  matterId: string;
  enquiryId: string;
  enquiryReference: string;
  client: IntakeContactSummary & {
    safeContactInstructions: string;
    accessibilityNeeds: string;
    interpreterLanguage: string | null;
  };
  householdMembers: HouseholdMemberRecord[];
  property: IntakePropertySummary;
  landlord: IntakeOrganisationSummary;
  tenancy: TenancyRecord;
  assessment: AssessmentRecord;
  onboarding: OnboardingRecord;
}
