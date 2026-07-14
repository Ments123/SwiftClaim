import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ConvertEnquiryInput,
  CreateEnquiryInput,
  DecideEnquiryInput,
  SaveAssessmentInput,
  SaveOnboardingInput,
  UpdateEnquiryInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import type { WorkflowStore } from '../workflow/store.js';
import type {
  AssessmentRecord,
  EnquiryDetail,
  EnquiryListItem,
  HouseholdMemberRecord,
  IntakeConversionResult,
  MatterIntakeProfile,
  OnboardingRecord,
  TenancyRecord,
} from './types.js';

type Row = Record<string, string | number | null>;

export class IntakeStateConflictError extends Error {
  constructor() {
    super('The enquiry was changed by another request.');
    this.name = 'IntakeStateConflictError';
  }
}

export type IntakeStoreErrorCode =
  | 'FORBIDDEN'
  | 'ASSIGNEE_NOT_FOUND'
  | 'OWNER_NOT_FOUND'
  | 'SUPERVISOR_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATUS'
  | 'TERMINAL'
  | 'NOT_FOUND';

export class IntakeStoreError extends Error {
  constructor(public readonly code: IntakeStoreErrorCode) {
    super(code);
    this.name = 'IntakeStoreError';
  }
}

export interface IntakeAuditInput {
  user: SessionUser;
  enquiryId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  occurredAt: string;
  context: AuditContext;
}

function normalizeWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizePostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

const terminalStatuses = new Set([
  'declined',
  'referred',
  'duplicate',
  'unable_to_contact',
  'converted',
]);

function parseJsonArray<T extends string>(value: string | number | null): T[] {
  const parsed: unknown = JSON.parse(String(value ?? '[]'));
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function mapAssessment(value: Row): AssessmentRecord {
  return {
    id: String(value.id),
    enquiryId: String(value.enquiryId),
    version: Number(value.version),
    jurisdictionConfirmed: Number(value.jurisdictionConfirmed) === 1,
    claimantRelationship: String(
      value.claimantRelationship,
    ) as AssessmentRecord['claimantRelationship'],
    noticeSummary: String(value.noticeSummary ?? ''),
    conditionsUnresolved: Number(value.conditionsUnresolved) === 1,
    conditionStartDate: value.conditionStartDate
      ? String(value.conditionStartDate)
      : null,
    accessSummary: String(value.accessSummary ?? ''),
    evidenceSummary: String(value.evidenceSummary ?? ''),
    limitationReview: String(value.limitationReview ?? ''),
    legalIssues: parseJsonArray<AssessmentRecord['legalIssues'][number]>(
      value.legalIssuesJson,
    ),
    escalations: parseJsonArray<AssessmentRecord['escalations'][number]>(
      value.escalationsJson,
    ),
    meritsRating: String(value.meritsRating) as AssessmentRecord['meritsRating'],
    proportionalityRating: String(
      value.proportionalityRating,
    ) as AssessmentRecord['proportionalityRating'],
    decision: String(value.decision) as AssessmentRecord['decision'],
    decisionReason: String(value.decisionReason ?? ''),
    reviewedBy: value.reviewedById
      ? {
          id: String(value.reviewedById),
          name: String(value.reviewedByName),
          role: String(value.reviewedByRole),
        }
      : null,
    reviewedAt: value.reviewedAt ? String(value.reviewedAt) : null,
    updatedBy: {
      id: String(value.updatedById),
      name: String(value.updatedByName),
    },
    updatedAt: String(value.updatedAt),
  };
}

function mapTenancy(value: Row | undefined): TenancyRecord | null {
  if (!value) return null;
  return {
    id: String(value.id),
    tenancyType: String(value.tenancyType) as TenancyRecord['tenancyType'],
    startedOn: value.startedOn ? String(value.startedOn) : null,
    endedOn: value.endedOn ? String(value.endedOn) : null,
    rentMinor: Number(value.rentMinor),
    currency: String(value.currency),
    rentFrequency: String(value.rentFrequency) as TenancyRecord['rentFrequency'],
    occupancyStartedOn: value.occupancyStartedOn
      ? String(value.occupancyStartedOn)
      : null,
    occupancyEndedOn: value.occupancyEndedOn
      ? String(value.occupancyEndedOn)
      : null,
  };
}

function mapHouseholdMember(value: Row): HouseholdMemberRecord {
  return {
    id: String(value.id),
    displayName: String(value.displayName),
    relationship: String(value.relationship),
    currentlyOccupies: Number(value.currentlyOccupies) === 1,
    claimParticipant: Number(value.claimParticipant) === 1,
    vulnerabilitySummary: String(value.vulnerabilitySummary ?? ''),
    accessibilityNeeds: String(value.accessibilityNeeds ?? ''),
  };
}

function mapEnquiry(value: Row): EnquiryDetail {
  return {
    id: String(value.id),
    reference: String(value.reference),
    status: String(value.status) as EnquiryDetail['status'],
    version: Number(value.version),
    source: String(value.source),
    referrerName: String(value.referrerName ?? ''),
    summary: String(value.summary),
    defectSummary: String(value.defectSummary),
    desiredOutcome: String(value.desiredOutcome ?? ''),
    firstComplainedOn: value.firstComplainedOn
      ? String(value.firstComplainedOn)
      : null,
    currentlyOccupied: Number(value.currentlyOccupied) === 1,
    urgency: String(value.urgency) as EnquiryDetail['urgency'],
    immediateSafetyConcerns: String(value.immediateSafetyConcerns ?? ''),
    communicationRequirements: String(value.communicationRequirements ?? ''),
    decisionReason: String(value.decisionReason ?? ''),
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
    client: {
      id: String(value.contactId),
      displayName: String(value.contactDisplayName),
      givenName: String(value.contactGivenName),
      familyName: String(value.contactFamilyName),
      dateOfBirth: value.contactDateOfBirth
        ? String(value.contactDateOfBirth)
        : null,
      email: String(value.contactEmail ?? ''),
      phone: String(value.contactPhone ?? ''),
      preferredChannel: String(
        value.contactPreferredChannel,
      ) as EnquiryDetail['client']['preferredChannel'],
    },
    property: {
      id: String(value.propertyId),
      addressLine1: String(value.addressLine1),
      addressLine2: String(value.addressLine2 ?? ''),
      city: String(value.city),
      county: String(value.county ?? ''),
      postcode: String(value.postcode),
      country: String(value.country),
      propertyType: String(value.propertyType),
    },
    landlord: value.landlordId
      ? {
          id: String(value.landlordId),
          name: String(value.landlordName),
          kind: String(value.landlordKind),
        }
      : null,
    assignedTo: {
      id: String(value.assignedUserId),
      name: String(value.assignedUserName),
      role: String(value.assignedUserRole),
    },
  };
}

export class IntakeStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  private requireCapability(
    user: SessionUser,
    capability:
      | 'intake.read'
      | 'intake.write'
      | 'intake.decide'
      | 'intake.convert',
  ) {
    if (!hasCapability(user, capability)) {
      throw new IntakeStoreError('FORBIDDEN');
    }
  }

  private isFirmWide(user: SessionUser): boolean {
    return user.role === 'admin' || user.role === 'partner';
  }

  private enquirySelect(): string {
    return `SELECT
      e.id, e.reference, e.status, e.version, e.source,
      e.referrer_name AS referrerName, e.summary,
      e.defect_summary AS defectSummary,
      e.desired_outcome AS desiredOutcome,
      e.first_complained_on AS firstComplainedOn,
      e.currently_occupied AS currentlyOccupied, e.urgency,
      e.immediate_safety_concerns AS immediateSafetyConcerns,
      e.communication_requirements AS communicationRequirements,
      e.decision_reason AS decisionReason,
      e.created_at AS createdAt, e.updated_at AS updatedAt,
      c.id AS contactId, c.display_name AS contactDisplayName,
      c.given_name AS contactGivenName, c.family_name AS contactFamilyName,
      c.date_of_birth AS contactDateOfBirth, c.email AS contactEmail,
      c.phone AS contactPhone, c.preferred_channel AS contactPreferredChannel,
      p.id AS propertyId, p.address_line_1 AS addressLine1,
      p.address_line_2 AS addressLine2, p.city, p.county, p.postcode,
      p.country, p.property_type AS propertyType,
      o.id AS landlordId, o.name AS landlordName, o.kind AS landlordKind,
      assigned.id AS assignedUserId, assigned.name AS assignedUserName,
      assigned.role AS assignedUserRole
    FROM enquiries e
    JOIN contacts c
      ON c.id = e.prospective_contact_id AND c.firm_id = e.firm_id
    JOIN properties p
      ON p.id = e.property_id AND p.firm_id = e.firm_id
    LEFT JOIN organisations o
      ON o.id = e.landlord_organisation_id AND o.firm_id = e.firm_id
    JOIN users assigned
      ON assigned.id = e.assigned_user_id AND assigned.firm_id = e.firm_id`;
  }

  private getEnquiryForFirm(
    firmId: string,
    enquiryId: string,
  ): EnquiryDetail | undefined {
    const result = row(
      this.database
        .prepare(`${this.enquirySelect()} WHERE e.firm_id = ? AND e.id = ?`)
        .get(firmId, enquiryId),
    );
    return result ? mapEnquiry(result) : undefined;
  }

  private requireAssignee(firmId: string, userId: string): void {
    const assignee = row(
      this.database
        .prepare(
          `SELECT id FROM users
           WHERE id = ? AND firm_id = ? AND active = 1
             AND role IN ('admin', 'partner', 'solicitor', 'paralegal')`,
        )
        .get(userId, firmId),
    );
    if (!assignee) throw new IntakeStoreError('ASSIGNEE_NOT_FOUND');
  }

  private requireOnboardingUsers(
    firmId: string,
    ownerUserId: string,
    supervisorUserId: string,
  ): void {
    const owner = row(
      this.database
        .prepare(
          `SELECT id FROM users
           WHERE id = ? AND firm_id = ? AND active = 1
             AND role IN ('admin', 'partner', 'solicitor', 'paralegal')`,
        )
        .get(ownerUserId, firmId),
    );
    if (!owner) throw new IntakeStoreError('OWNER_NOT_FOUND');

    const supervisor = row(
      this.database
        .prepare(
          `SELECT id FROM users
           WHERE id = ? AND firm_id = ? AND active = 1
             AND role IN ('admin', 'partner')`,
        )
        .get(supervisorUserId, firmId),
    );
    if (!supervisor) throw new IntakeStoreError('SUPERVISOR_NOT_FOUND');
  }

  private assessmentSelect(): string {
    return `SELECT
      a.id, a.enquiry_id AS enquiryId, a.version,
      a.jurisdiction_confirmed AS jurisdictionConfirmed,
      a.claimant_relationship AS claimantRelationship,
      a.notice_summary AS noticeSummary,
      a.conditions_unresolved AS conditionsUnresolved,
      a.condition_start_date AS conditionStartDate,
      a.access_summary AS accessSummary,
      a.evidence_summary AS evidenceSummary,
      a.limitation_review AS limitationReview,
      a.legal_issues_json AS legalIssuesJson,
      a.escalations_json AS escalationsJson,
      a.merits_rating AS meritsRating,
      a.proportionality_rating AS proportionalityRating,
      a.decision, a.decision_reason AS decisionReason,
      reviewer.id AS reviewedById, reviewer.name AS reviewedByName,
      reviewer.role AS reviewedByRole, a.reviewed_at AS reviewedAt,
      updater.id AS updatedById, updater.name AS updatedByName,
      a.updated_at AS updatedAt
    FROM housing_assessments a
    LEFT JOIN users reviewer
      ON reviewer.id = a.reviewed_by AND reviewer.firm_id = a.firm_id
    JOIN users updater
      ON updater.id = a.updated_by AND updater.firm_id = a.firm_id`;
  }

  private getAssessmentForFirm(
    firmId: string,
    enquiryId: string,
  ): AssessmentRecord | undefined {
    const result = row(
      this.database
        .prepare(
          `${this.assessmentSelect()}
           WHERE a.firm_id = ? AND a.enquiry_id = ?`,
        )
        .get(firmId, enquiryId),
    );
    return result ? mapAssessment(result) : undefined;
  }

  private getOnboardingForFirm(
    firmId: string,
    enquiryId: string,
  ): OnboardingRecord | undefined {
    const profile = row(
      this.database
        .prepare(
          `SELECT
            p.id, p.enquiry_id AS enquiryId, p.version,
            p.identity_status AS identityStatus,
            p.client_care_status AS clientCareStatus,
            p.authority_status AS authorityStatus,
            p.privacy_status AS privacyStatus,
            p.funding_type AS fundingType,
            p.funding_status AS fundingStatus,
            p.signature_status AS signatureStatus,
            p.vulnerability_summary AS vulnerabilitySummary,
            p.accessibility_needs AS accessibilityNeeds,
            p.interpreter_language AS interpreterLanguage,
            p.safe_contact_instructions AS safeContactInstructions,
            owner.id AS ownerId, owner.name AS ownerName, owner.role AS ownerRole,
            supervisor.id AS supervisorId,
            supervisor.name AS supervisorName,
            supervisor.role AS supervisorRole,
            updater.id AS updatedById, updater.name AS updatedByName,
            p.updated_at AS updatedAt
           FROM onboarding_profiles p
           LEFT JOIN users owner
             ON owner.id = p.owner_user_id AND owner.firm_id = p.firm_id
           LEFT JOIN users supervisor
             ON supervisor.id = p.supervisor_user_id
            AND supervisor.firm_id = p.firm_id
           JOIN users updater
             ON updater.id = p.updated_by AND updater.firm_id = p.firm_id
           WHERE p.firm_id = ? AND p.enquiry_id = ?`,
        )
        .get(firmId, enquiryId),
    );
    if (!profile) return undefined;

    const tenancy = row(
      this.database
        .prepare(
          `SELECT id, tenancy_type AS tenancyType, started_on AS startedOn,
                  ended_on AS endedOn, rent_minor AS rentMinor, currency,
                  rent_frequency AS rentFrequency,
                  occupancy_started_on AS occupancyStartedOn,
                  occupancy_ended_on AS occupancyEndedOn
           FROM tenancies WHERE firm_id = ? AND enquiry_id = ?`,
        )
        .get(firmId, enquiryId),
    );
    const household = rows(
      this.database
        .prepare(
          `SELECT id, display_name AS displayName, relationship,
                  currently_occupies AS currentlyOccupies,
                  claim_participant AS claimParticipant,
                  vulnerability_summary AS vulnerabilitySummary,
                  accessibility_needs AS accessibilityNeeds
           FROM household_members
           WHERE firm_id = ? AND enquiry_id = ?
           ORDER BY created_at, rowid`,
        )
        .all(firmId, enquiryId),
    ).map(mapHouseholdMember);

    return {
      id: String(profile.id),
      enquiryId: String(profile.enquiryId),
      version: Number(profile.version),
      identityStatus: String(
        profile.identityStatus,
      ) as OnboardingRecord['identityStatus'],
      clientCareStatus: String(
        profile.clientCareStatus,
      ) as OnboardingRecord['clientCareStatus'],
      authorityStatus: String(
        profile.authorityStatus,
      ) as OnboardingRecord['authorityStatus'],
      privacyStatus: String(
        profile.privacyStatus,
      ) as OnboardingRecord['privacyStatus'],
      fundingType: String(profile.fundingType) as OnboardingRecord['fundingType'],
      fundingStatus: String(
        profile.fundingStatus,
      ) as OnboardingRecord['fundingStatus'],
      signatureStatus: String(
        profile.signatureStatus,
      ) as OnboardingRecord['signatureStatus'],
      vulnerabilitySummary: String(profile.vulnerabilitySummary ?? ''),
      accessibilityNeeds: String(profile.accessibilityNeeds ?? ''),
      interpreterLanguage: profile.interpreterLanguage
        ? String(profile.interpreterLanguage)
        : null,
      safeContactInstructions: String(profile.safeContactInstructions ?? ''),
      owner: profile.ownerId
        ? {
            id: String(profile.ownerId),
            name: String(profile.ownerName),
            role: String(profile.ownerRole),
          }
        : null,
      supervisor: profile.supervisorId
        ? {
            id: String(profile.supervisorId),
            name: String(profile.supervisorName),
            role: String(profile.supervisorRole),
          }
        : null,
      tenancy: mapTenancy(tenancy),
      householdMembers: household,
      updatedBy: {
        id: String(profile.updatedById),
        name: String(profile.updatedByName),
      },
      updatedAt: String(profile.updatedAt),
    };
  }

  private getConversionForFirm(
    firmId: string,
    enquiryId: string,
    workflowStore: WorkflowStore,
    replayed: boolean,
  ): IntakeConversionResult | undefined {
    const conversion = row(
      this.database
        .prepare(
          `SELECT
             c.id, c.idempotency_key AS idempotencyKey,
             c.converted_at AS convertedAt,
             m.id AS matterId, m.reference, m.title,
             m.client_name AS clientName, m.stage,
             owner.id AS ownerId, owner.name AS ownerName
           FROM intake_conversions c
           JOIN matters m ON m.id = c.matter_id AND m.firm_id = c.firm_id
           JOIN users owner
             ON owner.id = m.owner_user_id AND owner.firm_id = m.firm_id
           WHERE c.firm_id = ? AND c.enquiry_id = ?`,
        )
        .get(firmId, enquiryId),
    );
    if (!conversion) return undefined;
    const enquiry = this.getEnquiryForFirm(firmId, enquiryId);
    const workflow = workflowStore.getMatterWorkflow(
      firmId,
      String(conversion.matterId),
    );
    if (!enquiry || !workflow) {
      throw new Error('Persisted intake conversion is incomplete');
    }
    return {
      id: String(conversion.id),
      idempotencyKey: String(conversion.idempotencyKey),
      convertedAt: String(conversion.convertedAt),
      replayed,
      enquiry,
      matter: {
        id: String(conversion.matterId),
        reference: String(conversion.reference),
        title: String(conversion.title),
        clientName: String(conversion.clientName),
        stage: String(conversion.stage),
        owner: {
          id: String(conversion.ownerId),
          name: String(conversion.ownerName),
        },
      },
      workflow,
    };
  }

  private reserveReference(firmId: string, occurredAt: string): string {
    const year = occurredAt.slice(0, 4);
    const resourceKey = `enquiry:${year}`;
    const allocated = row(
      this.database
        .prepare(
          `INSERT INTO reference_sequences (firm_id, resource_key, next_value)
           VALUES (?, ?, 2)
           ON CONFLICT (firm_id, resource_key)
           DO UPDATE SET next_value = next_value + 1
           RETURNING next_value - 1 AS value`,
        )
        .get(firmId, resourceKey),
    );
    const value = Number(allocated?.value ?? 1);
    return `HDR-E-${year}-${String(value).padStart(4, '0')}`;
  }

  private reserveMatterReference(firmId: string, occurredAt: string): string {
    const year = occurredAt.slice(0, 4);
    const resourceKey = `matter:${year}`;
    const allocated = row(
      this.database
        .prepare(
          `INSERT INTO reference_sequences (firm_id, resource_key, next_value)
           VALUES (?, ?, 2)
           ON CONFLICT (firm_id, resource_key)
           DO UPDATE SET next_value = next_value + 1
           RETURNING next_value - 1 AS value`,
        )
        .get(firmId, resourceKey),
    );
    const value = Number(allocated?.value ?? 1);
    return `HDR-${year}-${String(value).padStart(4, '0')}`;
  }

  private findOrCreateContact(
    user: SessionUser,
    input: CreateEnquiryInput['client'],
    occurredAt: string,
  ): string {
    const givenName = input.givenName.trim();
    const familyName = input.familyName.trim();
    const displayName = `${givenName} ${familyName}`.trim();
    const normalizedName = normalizeWords(displayName);
    const email = normalizeEmail(input.email);
    const phone = input.phone.trim();
    const normalizedEmail = email || null;
    const normalizedPhone = normalizePhone(phone) || null;
    const existing =
      normalizedEmail || normalizedPhone
        ? row(
            this.database
              .prepare(
                `SELECT id FROM contacts
                 WHERE firm_id = ? AND normalized_name = ?
                   AND ((? IS NOT NULL AND normalized_email = ?)
                     OR (? IS NOT NULL AND normalized_phone = ?))
                 ORDER BY created_at LIMIT 1`,
              )
              .get(
                user.firmId,
                normalizedName,
                normalizedEmail,
                normalizedEmail,
                normalizedPhone,
                normalizedPhone,
              ),
          )
        : undefined;
    if (existing) return String(existing.id);

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO contacts (
          id, firm_id, given_name, family_name, display_name, date_of_birth,
          email, phone, preferred_channel, normalized_name, normalized_email,
          normalized_phone, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.firmId,
        givenName,
        familyName,
        displayName,
        input.dateOfBirth ?? null,
        email,
        phone,
        input.preferredChannel,
        normalizedName,
        normalizedEmail,
        normalizedPhone,
        user.id,
        occurredAt,
        occurredAt,
      );
    return id;
  }

  private findOrCreateProperty(
    user: SessionUser,
    input: CreateEnquiryInput['property'],
    occurredAt: string,
  ): string {
    const postcode = normalizePostcode(input.postcode);
    const normalizedAddress = normalizeWords(
      [
        input.addressLine1,
        input.addressLine2,
        input.city,
        input.county,
        postcode,
        input.country,
      ].join(' '),
    );
    const existing = row(
      this.database
        .prepare(
          `SELECT id FROM properties
           WHERE firm_id = ? AND normalized_address = ?
           ORDER BY created_at LIMIT 1`,
        )
        .get(user.firmId, normalizedAddress),
    );
    if (existing) return String(existing.id);

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO properties (
          id, firm_id, address_line_1, address_line_2, city, county,
          postcode, country, property_type, normalized_address, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.firmId,
        input.addressLine1.trim(),
        input.addressLine2.trim(),
        input.city.trim(),
        input.county.trim(),
        postcode,
        input.country,
        input.propertyType,
        normalizedAddress,
        user.id,
        occurredAt,
        occurredAt,
      );
    return id;
  }

  private findOrCreateLandlord(
    user: SessionUser,
    name: string,
    occurredAt: string,
  ): string {
    const trimmedName = name.trim();
    const normalizedName = normalizeWords(trimmedName);
    const existing = row(
      this.database
        .prepare(
          `SELECT id FROM organisations
           WHERE firm_id = ? AND kind = 'landlord' AND normalized_name = ?
           ORDER BY created_at LIMIT 1`,
        )
        .get(user.firmId, normalizedName),
    );
    if (existing) return String(existing.id);

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO organisations (
          id, firm_id, name, kind, normalized_name, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'landlord', ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.firmId,
        trimmedName,
        normalizedName,
        user.id,
        occurredAt,
        occurredAt,
      );
    return id;
  }

  recordAudit(input: IntakeAuditInput): void {
    this.database
      .prepare(
        `INSERT INTO intake_audit_events (
          id, firm_id, enquiry_id, user_id, action, entity_type, entity_id,
          before_json, after_json, request_id, ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.user.firmId,
        input.enquiryId,
        input.user.id,
        input.action,
        input.entityType,
        input.entityId,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        input.context.requestId,
        input.context.ipAddress,
        input.occurredAt,
      );
  }

  createEnquiry(
    user: SessionUser,
    input: CreateEnquiryInput,
    context: AuditContext,
  ): EnquiryDetail {
    this.requireCapability(user, 'intake.write');
    this.requireAssignee(user.firmId, input.assignedUserId);
    const occurredAt = this.now().toISOString();
    const enquiryId = randomUUID();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const contactId = this.findOrCreateContact(user, input.client, occurredAt);
      const propertyId = this.findOrCreateProperty(
        user,
        input.property,
        occurredAt,
      );
      const landlordId = this.findOrCreateLandlord(
        user,
        input.landlordName,
        occurredAt,
      );
      const reference = this.reserveReference(user.firmId, occurredAt);
      this.database
        .prepare(
          `INSERT INTO enquiries (
            id, firm_id, reference, status, version, source, referrer_name,
            prospective_contact_id, property_id, landlord_organisation_id,
            assigned_user_id, summary, defect_summary, desired_outcome,
            first_complained_on, currently_occupied, urgency,
            immediate_safety_concerns, communication_requirements,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, 'new', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?)`,
        )
        .run(
          enquiryId,
          user.firmId,
          reference,
          input.source.trim(),
          input.referrerName.trim(),
          contactId,
          propertyId,
          landlordId,
          input.assignedUserId,
          input.summary.trim(),
          input.defectSummary.trim(),
          input.desiredOutcome.trim(),
          input.firstComplainedOn ?? null,
          input.currentlyOccupied ? 1 : 0,
          input.urgency,
          input.immediateSafetyConcerns.trim(),
          input.communicationRequirements.trim(),
          user.id,
          occurredAt,
          occurredAt,
        );
      this.database
        .prepare(
          `INSERT INTO enquiry_status_events (
            id, firm_id, enquiry_id, from_status, to_status, reason,
            actor_user_id, occurred_at
          ) VALUES (?, ?, ?, NULL, 'new', 'Enquiry created', ?, ?)`,
        )
        .run(randomUUID(), user.firmId, enquiryId, user.id, occurredAt);
      this.recordAudit({
        user,
        enquiryId,
        action: 'enquiry.created',
        entityType: 'enquiry',
        entityId: enquiryId,
        after: { reference, ...input },
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const result = this.getEnquiryForFirm(user.firmId, enquiryId);
    if (!result) throw new IntakeStoreError('NOT_FOUND');
    return result;
  }

  listEnquiries(user: SessionUser): EnquiryListItem[] {
    this.requireCapability(user, 'intake.read');
    const parameters = this.isFirmWide(user)
      ? [user.firmId]
      : [user.firmId, user.id];
    const access = this.isFirmWide(user) ? '' : 'AND e.assigned_user_id = ?';
    return rows(
      this.database
        .prepare(
          `${this.enquirySelect()}
           WHERE e.firm_id = ? ${access}
           ORDER BY e.updated_at DESC, e.reference`,
        )
        .all(...parameters),
    ).map(mapEnquiry);
  }

  getEnquiry(
    user: SessionUser,
    enquiryId: string,
  ): EnquiryDetail | undefined {
    this.requireCapability(user, 'intake.read');
    const parameters = this.isFirmWide(user)
      ? [user.firmId, enquiryId]
      : [user.firmId, enquiryId, user.id];
    const access = this.isFirmWide(user) ? '' : 'AND e.assigned_user_id = ?';
    const result = row(
      this.database
        .prepare(
          `${this.enquirySelect()}
           WHERE e.firm_id = ? AND e.id = ? ${access}`,
        )
        .get(...parameters),
    );
    return result ? mapEnquiry(result) : undefined;
  }

  updateEnquiry(
    user: SessionUser,
    enquiryId: string,
    input: UpdateEnquiryInput,
    context: AuditContext,
  ): EnquiryDetail {
    this.requireCapability(user, 'intake.write');
    const before = this.getEnquiry(user, enquiryId);
    if (!before) throw new IntakeStoreError('NOT_FOUND');
    this.requireAssignee(user.firmId, input.assignedUserId);
    const occurredAt = this.now().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.database
        .prepare(
          `UPDATE enquiries SET
            summary = ?, defect_summary = ?, desired_outcome = ?, urgency = ?,
            immediate_safety_concerns = ?, communication_requirements = ?,
            assigned_user_id = ?, version = version + 1, updated_at = ?
           WHERE firm_id = ? AND id = ? AND version = ?`,
        )
        .run(
          input.summary.trim(),
          input.defectSummary.trim(),
          input.desiredOutcome.trim(),
          input.urgency,
          input.immediateSafetyConcerns.trim(),
          input.communicationRequirements.trim(),
          input.assignedUserId,
          occurredAt,
          user.firmId,
          enquiryId,
          input.expectedVersion,
        );
      if (updated.changes !== 1) throw new IntakeStateConflictError();
      this.recordAudit({
        user,
        enquiryId,
        action: 'enquiry.updated',
        entityType: 'enquiry',
        entityId: enquiryId,
        before,
        after: input,
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const result = this.getEnquiryForFirm(user.firmId, enquiryId);
    if (!result) throw new IntakeStoreError('NOT_FOUND');
    return result;
  }

  getAssessment(
    user: SessionUser,
    enquiryId: string,
  ): AssessmentRecord | undefined {
    this.requireCapability(user, 'intake.read');
    if (!this.getEnquiry(user, enquiryId)) return undefined;
    return this.getAssessmentForFirm(user.firmId, enquiryId);
  }

  saveAssessment(
    user: SessionUser,
    enquiryId: string,
    input: SaveAssessmentInput,
    context: AuditContext,
  ): { enquiry: EnquiryDetail; assessment: AssessmentRecord } {
    this.requireCapability(user, 'intake.write');
    const beforeEnquiry = this.getEnquiry(user, enquiryId);
    if (!beforeEnquiry) throw new IntakeStoreError('NOT_FOUND');
    if (terminalStatuses.has(beforeEnquiry.status)) {
      throw new IntakeStoreError('TERMINAL');
    }
    const beforeAssessment = this.getAssessmentForFirm(user.firmId, enquiryId);
    const assessmentId = beforeAssessment?.id ?? randomUUID();
    const occurredAt = this.now().toISOString();
    const reviewedBy = input.decision === 'draft' ? null : user.id;
    const reviewedAt = input.decision === 'draft' ? null : occurredAt;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.database
        .prepare(
          `UPDATE enquiries SET
             status = CASE WHEN status = 'new' THEN 'assessment' ELSE status END,
             version = version + 1, updated_at = ?
           WHERE firm_id = ? AND id = ? AND version = ?
             AND status IN ('new', 'assessment', 'accepted')`,
        )
        .run(occurredAt, user.firmId, enquiryId, input.expectedVersion);
      if (updated.changes !== 1) throw new IntakeStateConflictError();

      this.database
        .prepare(
          `INSERT INTO housing_assessments (
             id, firm_id, enquiry_id, version, jurisdiction_confirmed,
             claimant_relationship, notice_summary, conditions_unresolved,
             condition_start_date, access_summary, evidence_summary,
             limitation_review, legal_issues_json, escalations_json,
             merits_rating, proportionality_rating, decision, decision_reason,
             reviewed_by, reviewed_at, updated_by, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (firm_id, enquiry_id) DO UPDATE SET
             version = housing_assessments.version + 1,
             jurisdiction_confirmed = excluded.jurisdiction_confirmed,
             claimant_relationship = excluded.claimant_relationship,
             notice_summary = excluded.notice_summary,
             conditions_unresolved = excluded.conditions_unresolved,
             condition_start_date = excluded.condition_start_date,
             access_summary = excluded.access_summary,
             evidence_summary = excluded.evidence_summary,
             limitation_review = excluded.limitation_review,
             legal_issues_json = excluded.legal_issues_json,
             escalations_json = excluded.escalations_json,
             merits_rating = excluded.merits_rating,
             proportionality_rating = excluded.proportionality_rating,
             decision = excluded.decision,
             decision_reason = excluded.decision_reason,
             reviewed_by = excluded.reviewed_by,
             reviewed_at = excluded.reviewed_at,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .run(
          assessmentId,
          user.firmId,
          enquiryId,
          input.jurisdictionConfirmed ? 1 : 0,
          input.claimantRelationship,
          input.noticeSummary.trim(),
          input.conditionsUnresolved ? 1 : 0,
          input.conditionStartDate ?? null,
          input.accessSummary.trim(),
          input.evidenceSummary.trim(),
          input.limitationReview.trim(),
          JSON.stringify(input.legalIssues),
          JSON.stringify(input.escalations),
          input.meritsRating,
          input.proportionalityRating,
          input.decision,
          input.decisionReason.trim(),
          reviewedBy,
          reviewedAt,
          user.id,
          occurredAt,
        );

      if (beforeEnquiry.status === 'new') {
        this.database
          .prepare(
            `INSERT INTO enquiry_status_events (
               id, firm_id, enquiry_id, from_status, to_status, reason,
               actor_user_id, occurred_at
             ) VALUES (?, ?, ?, 'new', 'assessment', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            user.firmId,
            enquiryId,
            'Legal assessment commenced',
            user.id,
            occurredAt,
          );
      }
      this.recordAudit({
        user,
        enquiryId,
        action: 'assessment.saved',
        entityType: 'housing_assessment',
        entityId: assessmentId,
        before: beforeAssessment,
        after: input,
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const enquiry = this.getEnquiryForFirm(user.firmId, enquiryId);
    const assessment = this.getAssessmentForFirm(user.firmId, enquiryId);
    if (!enquiry || !assessment) throw new IntakeStoreError('NOT_FOUND');
    return { enquiry, assessment };
  }

  getOnboarding(
    user: SessionUser,
    enquiryId: string,
  ): OnboardingRecord | undefined {
    this.requireCapability(user, 'intake.read');
    if (!this.getEnquiry(user, enquiryId)) return undefined;
    return this.getOnboardingForFirm(user.firmId, enquiryId);
  }

  saveOnboarding(
    user: SessionUser,
    enquiryId: string,
    input: SaveOnboardingInput,
    context: AuditContext,
  ): { enquiry: EnquiryDetail; onboarding: OnboardingRecord } {
    this.requireCapability(user, 'intake.write');
    const beforeEnquiry = this.getEnquiry(user, enquiryId);
    if (!beforeEnquiry) throw new IntakeStoreError('NOT_FOUND');
    if (terminalStatuses.has(beforeEnquiry.status)) {
      throw new IntakeStoreError('TERMINAL');
    }
    if (beforeEnquiry.status !== 'accepted') {
      throw new IntakeStoreError('INVALID_STATUS');
    }
    if (!beforeEnquiry.landlord) throw new IntakeStoreError('NOT_FOUND');
    this.requireOnboardingUsers(
      user.firmId,
      input.ownerUserId,
      input.supervisorUserId,
    );
    const beforeOnboarding = this.getOnboardingForFirm(user.firmId, enquiryId);
    const profileId = beforeOnboarding?.id ?? randomUUID();
    const tenancyId = beforeOnboarding?.tenancy?.id ?? randomUUID();
    const occurredAt = this.now().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.database
        .prepare(
          `UPDATE enquiries SET version = version + 1, updated_at = ?
           WHERE firm_id = ? AND id = ? AND version = ? AND status = 'accepted'`,
        )
        .run(occurredAt, user.firmId, enquiryId, input.expectedVersion);
      if (updated.changes !== 1) throw new IntakeStateConflictError();

      this.database
        .prepare(
          `INSERT INTO onboarding_profiles (
             id, firm_id, enquiry_id, version, identity_status,
             client_care_status, authority_status, privacy_status, funding_type,
             funding_status, signature_status, vulnerability_summary,
             accessibility_needs, interpreter_language,
             safe_contact_instructions, owner_user_id, supervisor_user_id,
             updated_by, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (firm_id, enquiry_id) DO UPDATE SET
             version = onboarding_profiles.version + 1,
             identity_status = excluded.identity_status,
             client_care_status = excluded.client_care_status,
             authority_status = excluded.authority_status,
             privacy_status = excluded.privacy_status,
             funding_type = excluded.funding_type,
             funding_status = excluded.funding_status,
             signature_status = excluded.signature_status,
             vulnerability_summary = excluded.vulnerability_summary,
             accessibility_needs = excluded.accessibility_needs,
             interpreter_language = excluded.interpreter_language,
             safe_contact_instructions = excluded.safe_contact_instructions,
             owner_user_id = excluded.owner_user_id,
             supervisor_user_id = excluded.supervisor_user_id,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .run(
          profileId,
          user.firmId,
          enquiryId,
          input.identityStatus,
          input.clientCareStatus,
          input.authorityStatus,
          input.privacyStatus,
          input.fundingType,
          input.fundingStatus,
          input.signatureStatus,
          input.vulnerabilitySummary.trim(),
          input.accessibilityNeeds.trim(),
          input.interpreterLanguage,
          input.safeContactInstructions.trim(),
          input.ownerUserId,
          input.supervisorUserId,
          user.id,
          occurredAt,
        );

      this.database
        .prepare(
          `INSERT INTO tenancies (
             id, firm_id, enquiry_id, property_id, landlord_organisation_id,
             tenancy_type, started_on, ended_on, rent_minor, currency,
             rent_frequency, occupancy_started_on, occupancy_ended_on,
             updated_by, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (firm_id, enquiry_id) DO UPDATE SET
             property_id = excluded.property_id,
             landlord_organisation_id = excluded.landlord_organisation_id,
             tenancy_type = excluded.tenancy_type,
             started_on = excluded.started_on,
             ended_on = excluded.ended_on,
             rent_minor = excluded.rent_minor,
             currency = excluded.currency,
             rent_frequency = excluded.rent_frequency,
             occupancy_started_on = excluded.occupancy_started_on,
             occupancy_ended_on = excluded.occupancy_ended_on,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .run(
          tenancyId,
          user.firmId,
          enquiryId,
          beforeEnquiry.property.id,
          beforeEnquiry.landlord.id,
          input.tenancy.tenancyType,
          input.tenancy.startedOn,
          input.tenancy.endedOn,
          input.tenancy.rentMinor,
          input.tenancy.currency,
          input.tenancy.rentFrequency,
          input.tenancy.occupancyStartedOn,
          input.tenancy.occupancyEndedOn,
          user.id,
          occurredAt,
        );

      this.database
        .prepare(
          `DELETE FROM household_members
           WHERE firm_id = ? AND enquiry_id = ?`,
        )
        .run(user.firmId, enquiryId);
      const insertHousehold = this.database.prepare(
        `INSERT INTO household_members (
           id, firm_id, enquiry_id, display_name, relationship,
           currently_occupies, claim_participant, vulnerability_summary,
           accessibility_needs, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const member of input.householdMembers) {
        insertHousehold.run(
          randomUUID(),
          user.firmId,
          enquiryId,
          member.displayName.trim(),
          member.relationship.trim(),
          member.currentlyOccupies ? 1 : 0,
          member.claimParticipant ? 1 : 0,
          member.vulnerabilitySummary.trim(),
          member.accessibilityNeeds.trim(),
          user.id,
          occurredAt,
        );
      }

      this.database
        .prepare(
          `UPDATE contacts SET safe_contact_instructions = ?,
             accessibility_needs = ?, interpreter_language = ?, updated_at = ?
           WHERE firm_id = ? AND id = ?`,
        )
        .run(
          input.safeContactInstructions.trim(),
          input.accessibilityNeeds.trim(),
          input.interpreterLanguage,
          occurredAt,
          user.firmId,
          beforeEnquiry.client.id,
        );
      this.recordAudit({
        user,
        enquiryId,
        action: 'onboarding.saved',
        entityType: 'onboarding_profile',
        entityId: profileId,
        before: beforeOnboarding,
        after: input,
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const enquiry = this.getEnquiryForFirm(user.firmId, enquiryId);
    const onboarding = this.getOnboardingForFirm(user.firmId, enquiryId);
    if (!enquiry || !onboarding) throw new IntakeStoreError('NOT_FOUND');
    return { enquiry, onboarding };
  }

  decideEnquiry(
    user: SessionUser,
    enquiryId: string,
    input: DecideEnquiryInput,
    context: AuditContext,
  ): EnquiryDetail {
    this.requireCapability(user, 'intake.decide');
    const before = this.getEnquiry(user, enquiryId);
    if (!before) throw new IntakeStoreError('NOT_FOUND');
    if (terminalStatuses.has(before.status)) {
      throw new IntakeStoreError('TERMINAL');
    }
    if (before.status === 'accepted') {
      throw new IntakeStoreError('INVALID_STATUS');
    }
    const occurredAt = this.now().toISOString();
    const statusEventId = randomUUID();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.database
        .prepare(
          `UPDATE enquiries SET status = ?, decision_reason = ?,
             version = version + 1, updated_at = ?
           WHERE firm_id = ? AND id = ? AND version = ?
             AND status IN ('new', 'assessment')`,
        )
        .run(
          input.outcome,
          input.reason.trim(),
          occurredAt,
          user.firmId,
          enquiryId,
          input.expectedVersion,
        );
      if (updated.changes !== 1) throw new IntakeStateConflictError();
      this.database
        .prepare(
          `INSERT INTO enquiry_status_events (
             id, firm_id, enquiry_id, from_status, to_status, reason,
             actor_user_id, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          statusEventId,
          user.firmId,
          enquiryId,
          before.status,
          input.outcome,
          input.reason.trim(),
          user.id,
          occurredAt,
        );
      this.recordAudit({
        user,
        enquiryId,
        action: 'enquiry.decision_recorded',
        entityType: 'enquiry',
        entityId: enquiryId,
        before: { status: before.status, version: before.version },
        after: {
          status: input.outcome,
          version: before.version + 1,
          reason: input.reason.trim(),
        },
        occurredAt,
        context,
      });
      this.database
        .prepare(
          `INSERT INTO integration_outbox (
             id, firm_id, matter_id, topic, payload_json, status, attempts,
             available_at, created_at, deduplication_key
           ) VALUES (?, ?, NULL, 'intake.status_changed', ?, 'pending', 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          user.firmId,
          JSON.stringify({
            enquiryId,
            fromStatus: before.status,
            toStatus: input.outcome,
            version: before.version + 1,
          }),
          occurredAt,
          occurredAt,
          `intake.status_changed:${statusEventId}`,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const result = this.getEnquiryForFirm(user.firmId, enquiryId);
    if (!result) throw new IntakeStoreError('NOT_FOUND');
    return result;
  }

  getConversion(
    user: SessionUser,
    enquiryId: string,
    workflowStore: WorkflowStore,
  ): IntakeConversionResult | undefined {
    this.requireCapability(user, 'intake.read');
    if (!this.getEnquiry(user, enquiryId)) return undefined;
    return this.getConversionForFirm(
      user.firmId,
      enquiryId,
      workflowStore,
      false,
    );
  }

  getMatterIntakeProfile(
    user: SessionUser,
    matterId: string,
  ): MatterIntakeProfile | undefined {
    this.requireCapability(user, 'intake.read');
    const access = canReadAllFirmMatters(user)
      ? ''
      : `AND (
           m.owner_user_id = ? OR EXISTS (
             SELECT 1 FROM matter_members mm
             WHERE mm.firm_id = m.firm_id AND mm.matter_id = m.id
               AND mm.user_id = ?
           )
         )`;
    const parameters = canReadAllFirmMatters(user)
      ? [user.firmId, matterId]
      : [user.firmId, matterId, user.id, user.id];
    const housingCase = row(
      this.database
        .prepare(
          `SELECT hc.source_enquiry_id AS enquiryId
           FROM housing_cases hc
           JOIN matters m ON m.id = hc.matter_id AND m.firm_id = hc.firm_id
           WHERE hc.firm_id = ? AND hc.matter_id = ? ${access}`,
        )
        .get(...parameters),
    );
    if (!housingCase) return undefined;
    const enquiryId = String(housingCase.enquiryId);
    const enquiry = this.getEnquiryForFirm(user.firmId, enquiryId);
    const assessment = this.getAssessmentForFirm(user.firmId, enquiryId);
    const onboarding = this.getOnboardingForFirm(user.firmId, enquiryId);
    if (
      !enquiry ||
      !enquiry.landlord ||
      !assessment ||
      !onboarding ||
      !onboarding.tenancy
    ) {
      throw new Error('Converted matter intake profile is incomplete');
    }
    const contact = row(
      this.database
        .prepare(
          `SELECT safe_contact_instructions AS safeContactInstructions,
                  accessibility_needs AS accessibilityNeeds,
                  interpreter_language AS interpreterLanguage
           FROM contacts WHERE firm_id = ? AND id = ?`,
        )
        .get(user.firmId, enquiry.client.id),
    );
    return {
      matterId,
      enquiryId,
      enquiryReference: enquiry.reference,
      client: {
        ...enquiry.client,
        safeContactInstructions: String(contact?.safeContactInstructions ?? ''),
        accessibilityNeeds: String(contact?.accessibilityNeeds ?? ''),
        interpreterLanguage: contact?.interpreterLanguage
          ? String(contact.interpreterLanguage)
          : null,
      },
      householdMembers: onboarding.householdMembers,
      property: enquiry.property,
      landlord: enquiry.landlord,
      tenancy: onboarding.tenancy,
      assessment,
      onboarding,
    };
  }

  convertEnquiry(
    user: SessionUser,
    enquiryId: string,
    input: ConvertEnquiryInput,
    context: AuditContext,
    workflowStore: WorkflowStore,
  ): IntakeConversionResult {
    this.requireCapability(user, 'intake.convert');
    const beforeEnquiry = this.getEnquiry(user, enquiryId);
    if (!beforeEnquiry) throw new IntakeStoreError('NOT_FOUND');
    const existing = this.getConversionForFirm(
      user.firmId,
      enquiryId,
      workflowStore,
      true,
    );
    if (existing) {
      if (existing.idempotencyKey === input.idempotencyKey) return existing;
      throw new IntakeStoreError('IDEMPOTENCY_CONFLICT');
    }
    if (terminalStatuses.has(beforeEnquiry.status)) {
      throw new IntakeStoreError('TERMINAL');
    }
    if (beforeEnquiry.status !== 'accepted') {
      throw new IntakeStoreError('INVALID_STATUS');
    }
    const assessment = this.getAssessmentForFirm(user.firmId, enquiryId);
    const onboarding = this.getOnboardingForFirm(user.firmId, enquiryId);
    if (
      !assessment ||
      !onboarding?.tenancy ||
      !onboarding.owner ||
      !onboarding.supervisor ||
      !beforeEnquiry.landlord
    ) {
      throw new IntakeStoreError('INVALID_STATUS');
    }
    const ownerId = onboarding.owner.id;
    const supervisorId = onboarding.supervisor.id;

    const occurredAt = this.now().toISOString();
    const matterId = randomUUID();
    const conversionId = randomUUID();
    const statusEventId = randomUUID();
    const clientAddress = [
      beforeEnquiry.property.addressLine1,
      beforeEnquiry.property.addressLine2,
      beforeEnquiry.property.city,
      beforeEnquiry.property.county,
      beforeEnquiry.property.postcode,
    ]
      .filter(Boolean)
      .join(', ');
    const riskLevel =
      beforeEnquiry.urgency === 'critical'
        ? 'critical'
        : beforeEnquiry.urgency === 'urgent'
          ? 'high'
          : beforeEnquiry.urgency === 'priority'
            ? 'medium'
            : 'low';

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const duplicateKey = row(
        this.database
          .prepare(
            `SELECT enquiry_id AS enquiryId FROM intake_conversions
             WHERE firm_id = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, input.idempotencyKey),
      );
      if (duplicateKey) throw new IntakeStoreError('IDEMPOTENCY_CONFLICT');

      const updated = this.database
        .prepare(
          `UPDATE enquiries SET status = 'converted', version = version + 1,
             updated_at = ?
           WHERE firm_id = ? AND id = ? AND status = 'accepted' AND version = ?`,
        )
        .run(occurredAt, user.firmId, enquiryId, input.expectedVersion);
      if (updated.changes !== 1) throw new IntakeStateConflictError();

      const matterReference = this.reserveMatterReference(
        user.firmId,
        occurredAt,
      );
      const matterTitle = `${beforeEnquiry.client.familyName} v ${beforeEnquiry.landlord.name}`;
      this.database
        .prepare(
          `INSERT INTO matters (
             id, firm_id, reference, title, client_name, matter_type, status,
             stage, risk_level, owner_user_id, opened_at, description,
             external_source, external_id, import_batch_id, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'Housing conditions claim', 'open',
             'Evidence and notice', ?, ?, ?, ?, 'swiftclaim-intake', ?, NULL,
             ?, ?, ?)`,
        )
        .run(
          matterId,
          user.firmId,
          matterReference,
          matterTitle,
          beforeEnquiry.client.displayName,
          riskLevel,
          ownerId,
          occurredAt.slice(0, 10),
          `${beforeEnquiry.summary}\n\nReported conditions: ${beforeEnquiry.defectSummary}`,
          enquiryId,
          user.id,
          occurredAt,
          occurredAt,
        );

      const addMember = this.database.prepare(
        `INSERT OR IGNORE INTO matter_members (
           firm_id, matter_id, user_id, access_level, added_at
         ) VALUES (?, ?, ?, 'write', ?)`,
      );
      addMember.run(
        user.firmId,
        matterId,
        ownerId,
        occurredAt,
      );
      addMember.run(
        user.firmId,
        matterId,
        supervisorId,
        occurredAt,
      );

      const addParticipant = this.database.prepare(
        `INSERT INTO matter_participants (
           id, firm_id, matter_id, contact_id, organisation_id, role,
           is_primary, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      addParticipant.run(
        randomUUID(),
        user.firmId,
        matterId,
        beforeEnquiry.client.id,
        null,
        'claimant',
        1,
        user.id,
        occurredAt,
      );
      addParticipant.run(
        randomUUID(),
        user.firmId,
        matterId,
        null,
        beforeEnquiry.landlord.id,
        'landlord',
        0,
        user.id,
        occurredAt,
      );

      const addLegacyParty = this.database.prepare(
        `INSERT INTO parties (
           id, firm_id, matter_id, kind, name, organisation, email, phone,
           address, external_source, external_id, import_batch_id, created_by,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'swiftclaim-intake', ?, NULL, ?, ?)`,
      );
      addLegacyParty.run(
        randomUUID(),
        user.firmId,
        matterId,
        'client',
        beforeEnquiry.client.displayName,
        '',
        beforeEnquiry.client.email,
        beforeEnquiry.client.phone,
        clientAddress,
        beforeEnquiry.client.id,
        user.id,
        occurredAt,
      );
      addLegacyParty.run(
        randomUUID(),
        user.firmId,
        matterId,
        'opponent',
        beforeEnquiry.landlord.name,
        beforeEnquiry.landlord.name,
        '',
        '',
        '',
        beforeEnquiry.landlord.id,
        user.id,
        occurredAt,
      );

      const householdRows = rows(
        this.database
          .prepare(
            `SELECT id, display_name AS displayName, relationship
             FROM household_members
             WHERE firm_id = ? AND enquiry_id = ? ORDER BY created_at, rowid`,
          )
          .all(user.firmId, enquiryId),
      );
      for (const member of householdRows) {
        const displayName = String(member.displayName).trim();
        const nameParts = displayName.split(/\s+/).filter(Boolean);
        const familyName =
          nameParts.length > 1 ? String(nameParts.at(-1)) : 'Household';
        const givenName =
          nameParts.length > 1
            ? nameParts.slice(0, -1).join(' ')
            : displayName;
        const contactId = randomUUID();
        this.database
          .prepare(
            `INSERT INTO contacts (
               id, firm_id, given_name, family_name, display_name,
               preferred_channel, normalized_name, created_by, created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, 'email', ?, ?, ?, ?)`,
          )
          .run(
            contactId,
            user.firmId,
            givenName,
            familyName,
            displayName,
            normalizeWords(displayName),
            user.id,
            occurredAt,
            occurredAt,
          );
        this.database
          .prepare(
            `UPDATE household_members SET matter_id = ?, contact_id = ?
             WHERE firm_id = ? AND enquiry_id = ? AND id = ?`,
          )
          .run(matterId, contactId, user.firmId, enquiryId, member.id);
        addParticipant.run(
          randomUUID(),
          user.firmId,
          matterId,
          contactId,
          null,
          'household_member',
          0,
          user.id,
          occurredAt,
        );
        addLegacyParty.run(
          randomUUID(),
          user.firmId,
          matterId,
          'other',
          displayName,
          '',
          '',
          '',
          clientAddress,
          contactId,
          user.id,
          occurredAt,
        );
      }

      this.database
        .prepare(
          `UPDATE housing_assessments SET matter_id = ?
           WHERE firm_id = ? AND enquiry_id = ?`,
        )
        .run(matterId, user.firmId, enquiryId);
      this.database
        .prepare(
          `UPDATE onboarding_profiles SET matter_id = ?
           WHERE firm_id = ? AND enquiry_id = ?`,
        )
        .run(matterId, user.firmId, enquiryId);
      this.database
        .prepare(
          `UPDATE tenancies SET matter_id = ?
           WHERE firm_id = ? AND enquiry_id = ?`,
        )
        .run(matterId, user.firmId, enquiryId);
      this.database
        .prepare(
          `INSERT INTO housing_cases (
             id, firm_id, matter_id, source_enquiry_id, claimant_contact_id,
             property_id, tenancy_id, landlord_organisation_id,
             currently_occupied, created_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          user.firmId,
          matterId,
          enquiryId,
          beforeEnquiry.client.id,
          beforeEnquiry.property.id,
          onboarding.tenancy.id,
          beforeEnquiry.landlord.id,
          beforeEnquiry.currentlyOccupied ? 1 : 0,
          user.id,
          occurredAt,
        );

      const workflow = workflowStore.bootstrapFromIntakeInTransaction({
        firmId: user.firmId,
        matterId,
        actorUserId: user.id,
        occurredAt,
      });
      this.database
        .prepare(
          `INSERT INTO intake_conversions (
             id, firm_id, enquiry_id, matter_id, idempotency_key,
             converted_by, converted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          conversionId,
          user.firmId,
          enquiryId,
          matterId,
          input.idempotencyKey,
          user.id,
          occurredAt,
        );
      this.database
        .prepare(
          `INSERT INTO enquiry_status_events (
             id, firm_id, enquiry_id, from_status, to_status, reason,
             actor_user_id, occurred_at
           ) VALUES (?, ?, ?, 'accepted', 'converted', ?, ?, ?)`,
        )
        .run(
          statusEventId,
          user.firmId,
          enquiryId,
          `Converted to matter ${matterReference}`,
          user.id,
          occurredAt,
        );
      appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'matter.created_from_intake',
        title: 'Matter opened from accepted enquiry',
        detail: `${beforeEnquiry.reference} converted to ${matterReference} at Evidence and notice.`,
        actorUserId: user.id,
        occurredAt,
        metadata: { enquiryId, conversionId, workflowId: workflow.id },
      });
      appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: user.id,
        action: 'matter.created_from_intake',
        entityType: 'matter',
        entityId: matterId,
        after: {
          enquiryId,
          reference: matterReference,
          stage: 'evidence',
          ownerUserId: ownerId,
          supervisorUserId: supervisorId,
        },
        createdAt: occurredAt,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
      });
      this.recordAudit({
        user,
        enquiryId,
        action: 'intake.converted',
        entityType: 'intake_conversion',
        entityId: conversionId,
        before: { status: 'accepted', version: beforeEnquiry.version },
        after: {
          matterId,
          reference: matterReference,
          status: 'converted',
          version: beforeEnquiry.version + 1,
        },
        occurredAt,
        context,
      });
      this.database
        .prepare(
          `INSERT INTO integration_outbox (
             id, firm_id, matter_id, topic, payload_json, status, attempts,
             available_at, created_at, deduplication_key
           ) VALUES (?, ?, ?, 'intake.converted', ?, 'pending', 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          user.firmId,
          matterId,
          JSON.stringify({ enquiryId, matterId, conversionId }),
          occurredAt,
          occurredAt,
          `intake.converted:${conversionId}`,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const result = this.getConversionForFirm(
      user.firmId,
      enquiryId,
      workflowStore,
      false,
    );
    if (!result) throw new Error('Intake conversion could not be persisted');
    return result;
  }
}
