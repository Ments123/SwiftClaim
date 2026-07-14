import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';

import {
  convertEnquirySchema,
  decideEnquirySchema,
  saveAssessmentSchema,
  saveOnboardingSchema,
  type ConvertEnquiryInput,
  type DecideEnquiryInput,
  type SaveAssessmentInput,
  type SaveOnboardingInput,
} from '../../shared/contracts.js';
import { hasCapability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { WorkflowStore } from '../workflow/store.js';
import {
  IntakeStateConflictError,
  IntakeStore,
  IntakeStoreError,
} from './store.js';
import type {
  AssessmentRecord,
  ConflictCheckResult,
  ConflictDecisionResult,
  EnquiryDetail,
  IntakeConversionResult,
  IntakeReadiness,
  IntakeWorkspace,
  OnboardingRecord,
  ReadinessBlocker,
  ReadinessSection,
} from './types.js';

type Row = Record<string, string | number | null>;

export type IntakeServiceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'READINESS_BLOCKED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATUS'
  | 'TERMINAL';

export class IntakeServiceError extends Error {
  constructor(
    public readonly code: IntakeServiceErrorCode,
    message: string,
    public readonly blockers?: ReadinessBlocker[],
  ) {
    super(message);
    this.name = 'IntakeServiceError';
  }
}

interface ConflictState {
  hasCheck: boolean;
  decision: 'clear' | 'blocked' | 'cleared_with_override' | null;
}

function section(blockers: ReadinessBlocker[]): ReadinessSection {
  return { ready: blockers.length === 0, blockers };
}

function critical(key: string, label: string): ReadinessBlocker {
  return { key, label, severity: 'critical' };
}

function projectAssessmentReadiness(
  enquiry: EnquiryDetail,
  conflict: ConflictState,
  assessment: AssessmentRecord | undefined,
): ReadinessSection {
  const blockers: ReadinessBlocker[] = [];
  if (
    !conflict.hasCheck ||
    (conflict.decision !== 'clear' &&
      conflict.decision !== 'cleared_with_override')
  ) {
    blockers.push(
      critical(
        'conflict_decision',
        conflict.decision === 'blocked'
          ? 'The latest conflict check is blocked.'
          : 'A human decision on the latest conflict check is required.',
      ),
    );
  }
  if (!assessment) {
    blockers.push(
      critical('legal_assessment', 'A reviewed legal assessment is required.'),
    );
    return section(blockers);
  }
  if (enquiry.property.country !== 'England') {
    blockers.push(
      critical(
        'jurisdiction_scope',
        'The property must be within the approved England jurisdiction.',
      ),
    );
  }
  if (!assessment.jurisdictionConfirmed) {
    blockers.push(
      critical(
        'jurisdiction_confirmed',
        'Jurisdiction must be confirmed by the legal reviewer.',
      ),
    );
  }
  if (assessment.claimantRelationship === 'other') {
    blockers.push(
      critical(
        'claimant_relationship',
        'The claimant’s qualifying relationship must be confirmed.',
      ),
    );
  }
  if (assessment.noticeSummary.trim().length < 10) {
    blockers.push(
      critical('notice_summary', 'Landlord notice history must be reviewed.'),
    );
  }
  if (!assessment.conditionsUnresolved) {
    blockers.push(
      critical(
        'conditions_unresolved',
        'The unresolved housing conditions must be confirmed.',
      ),
    );
  }
  if (!assessment.conditionStartDate) {
    blockers.push(
      critical(
        'condition_start_date',
        'The reported condition start date must be recorded.',
      ),
    );
  }
  if (!assessment.accessSummary.trim()) {
    blockers.push(
      critical('access_summary', 'Access history must be reviewed.'),
    );
  }
  if (!assessment.evidenceSummary.trim()) {
    blockers.push(
      critical('evidence_summary', 'Available evidence must be reviewed.'),
    );
  }
  if (assessment.limitationReview.trim().length < 10) {
    blockers.push(
      critical('limitation_review', 'A limitation review must be recorded.'),
    );
  }
  if (assessment.legalIssues.length === 0) {
    blockers.push(
      critical('legal_issues', 'At least one legal issue must be identified.'),
    );
  }
  if (!['reasonable', 'strong'].includes(assessment.meritsRating)) {
    blockers.push(
      critical(
        'merits_rating',
        'Merits must be rated reasonable or strong before acceptance.',
      ),
    );
  }
  if (!['reasonable', 'strong'].includes(assessment.proportionalityRating)) {
    blockers.push(
      critical(
        'proportionality_rating',
        'Proportionality must be reasonable or strong before acceptance.',
      ),
    );
  }
  if (assessment.decision !== 'proceed') {
    blockers.push(
      critical(
        'assessment_decision',
        'A reviewed proceed decision is required before acceptance.',
      ),
    );
  }
  if (
    assessment.escalations.length > 0 &&
    (!assessment.reviewedBy ||
      !['admin', 'partner'].includes(assessment.reviewedBy.role))
  ) {
    blockers.push(
      critical(
        'supervisor_review',
        'A partner or administrator must review the recorded escalation.',
      ),
    );
  }
  return section(blockers);
}

function projectOnboardingReadiness(
  onboarding: OnboardingRecord | undefined,
): ReadinessSection {
  const blockers: ReadinessBlocker[] = [];
  const control = (
    key: string,
    label: string,
    complete: boolean,
  ): void => {
    if (!complete) blockers.push(critical(key, label));
  };
  control(
    'identity_status',
    onboarding?.identityStatus === 'failed'
      ? 'Identity verification failed and requires review.'
      : 'Identity verification must be complete.',
    onboarding?.identityStatus === 'complete',
  );
  control(
    'client_care_status',
    'Client-care documentation must be complete.',
    onboarding?.clientCareStatus === 'complete',
  );
  control(
    'authority_status',
    'Authority to act must be complete.',
    onboarding?.authorityStatus === 'complete',
  );
  control(
    'privacy_status',
    'Privacy information must be complete.',
    onboarding?.privacyStatus === 'complete',
  );
  control(
    'funding_type',
    'A funding arrangement must be selected.',
    Boolean(onboarding && onboarding.fundingType !== 'unconfirmed'),
  );
  control(
    'funding_status',
    'The funding arrangement must be complete.',
    onboarding?.fundingStatus === 'complete',
  );
  control(
    'signature_status',
    'Required signatures must be complete.',
    onboarding?.signatureStatus === 'complete',
  );
  control('matter_owner', 'A matter owner must be assigned.', Boolean(onboarding?.owner));
  control(
    'matter_supervisor',
    'A partner-level supervisor must be assigned.',
    Boolean(onboarding?.supervisor),
  );
  control('tenancy', 'Tenancy details must be recorded.', Boolean(onboarding?.tenancy));
  return section(blockers);
}

function mergeBlockers(...groups: ReadinessBlocker[][]): ReadinessBlocker[] {
  const byKey = new Map<string, ReadinessBlocker>();
  for (const blockers of groups) {
    for (const blocker of blockers) byKey.set(blocker.key, blocker);
  }
  return [...byKey.values()];
}

function validationError(error: ZodError): IntakeServiceError {
  const message = error.issues[0]?.message ?? 'The command is invalid.';
  return new IntakeServiceError('VALIDATION_ERROR', message);
}

export class IntakeService {
  private readonly workflowStore: WorkflowStore;

  constructor(
    private readonly database: DatabaseSync,
    private readonly store: IntakeStore,
    now: () => Date,
    workflowStore?: WorkflowStore,
  ) {
    this.workflowStore = workflowStore ?? new WorkflowStore(database, now);
  }

  private translateStoreError(error: unknown): never {
    if (error instanceof IntakeStateConflictError) throw error;
    if (!(error instanceof IntakeStoreError)) throw error;
    switch (error.code) {
      case 'FORBIDDEN':
        throw new IntakeServiceError(
          'FORBIDDEN',
          'You do not have permission to perform this intake action.',
        );
      case 'TERMINAL':
        throw new IntakeServiceError(
          'TERMINAL',
          'This enquiry has a terminal outcome and cannot be edited.',
        );
      case 'INVALID_STATUS':
        throw new IntakeServiceError(
          'INVALID_STATUS',
          'The enquiry is not in a status that permits this action.',
        );
      case 'OWNER_NOT_FOUND':
        throw new IntakeServiceError(
          'VALIDATION_ERROR',
          'Select an active matter owner from this firm.',
        );
      case 'SUPERVISOR_NOT_FOUND':
        throw new IntakeServiceError(
          'VALIDATION_ERROR',
          'Select an active partner-level supervisor from this firm.',
        );
      case 'ASSIGNEE_NOT_FOUND':
        throw new IntakeServiceError(
          'VALIDATION_ERROR',
          'Select an active intake assignee from this firm.',
        );
      case 'IDEMPOTENCY_CONFLICT':
        throw new IntakeServiceError(
          'IDEMPOTENCY_CONFLICT',
          'This conversion or idempotency key has already been used.',
        );
      case 'NOT_FOUND':
        throw new IntakeServiceError(
          'NOT_FOUND',
          'The requested resource was not found.',
        );
    }
  }

  private requireEnquiry(user: SessionUser, enquiryId: string): EnquiryDetail {
    try {
      const enquiry = this.store.getEnquiry(user, enquiryId);
      if (!enquiry) {
        throw new IntakeServiceError(
          'NOT_FOUND',
          'The requested resource was not found.',
        );
      }
      return enquiry;
    } catch (error) {
      if (error instanceof IntakeServiceError) throw error;
      return this.translateStoreError(error);
    }
  }

  private conflictState(firmId: string, enquiryId: string): ConflictState {
    const value = this.database
      .prepare(
        `SELECT c.id AS checkId, d.decision
         FROM conflict_checks c
         LEFT JOIN conflict_decisions d
           ON d.conflict_check_id = c.id AND d.firm_id = c.firm_id
         WHERE c.firm_id = ? AND c.enquiry_id = ?
         ORDER BY c.run_at DESC, c.rowid DESC,
                  d.decided_at DESC, d.rowid DESC
         LIMIT 1`,
      )
      .get(firmId, enquiryId) as Row | undefined;
    return {
      hasCheck: Boolean(value?.checkId),
      decision: value?.decision
        ? (String(value.decision) as ConflictState['decision'])
        : null,
    };
  }

  getWorkspace(user: SessionUser, enquiryId: string): IntakeWorkspace {
    const enquiry = this.requireEnquiry(user, enquiryId);
    const checkRow = this.database
      .prepare(
        `SELECT c.id, c.results_json AS resultsJson,
                c.match_count AS matchCount, c.run_at AS runAt,
                runner.id AS runById, runner.name AS runByName
         FROM conflict_checks c
         JOIN users runner
           ON runner.id = c.run_by AND runner.firm_id = c.firm_id
         WHERE c.firm_id = ? AND c.enquiry_id = ?
         ORDER BY c.run_at DESC, c.rowid DESC LIMIT 1`,
      )
      .get(user.firmId, enquiryId) as Row | undefined;
    const latestCheck: ConflictCheckResult | null = checkRow
      ? {
          id: String(checkRow.id),
          enquiryId,
          matchCount: Number(checkRow.matchCount),
          matches: JSON.parse(String(checkRow.resultsJson)) as ConflictCheckResult['matches'],
          runAt: String(checkRow.runAt),
          runBy: { id: String(checkRow.runById), name: String(checkRow.runByName) },
        }
      : null;
    const decisionRow = latestCheck
      ? (this.database
          .prepare(
            `SELECT d.id, d.conflict_check_id AS checkId, d.decision, d.reason,
                    d.decided_at AS decidedAt,
                    actor.id AS decidedById, actor.name AS decidedByName
             FROM conflict_decisions d
             JOIN users actor
               ON actor.id = d.decided_by AND actor.firm_id = d.firm_id
             WHERE d.firm_id = ? AND d.enquiry_id = ?
               AND d.conflict_check_id = ?
             ORDER BY d.decided_at DESC, d.rowid DESC LIMIT 1`,
          )
          .get(user.firmId, enquiryId, latestCheck.id) as Row | undefined)
      : undefined;
    const latestDecision: ConflictDecisionResult | null = decisionRow
      ? {
          id: String(decisionRow.id),
          checkId: String(decisionRow.checkId),
          decision: String(
            decisionRow.decision,
          ) as ConflictDecisionResult['decision'],
          reason: String(decisionRow.reason),
          decidedAt: String(decisionRow.decidedAt),
          decidedBy: {
            id: String(decisionRow.decidedById),
            name: String(decisionRow.decidedByName),
          },
        }
      : null;
    try {
      return {
        enquiry,
        conflict: { latestCheck, latestDecision },
        assessment: this.store.getAssessment(user, enquiryId) ?? null,
        onboarding: this.store.getOnboarding(user, enquiryId) ?? null,
        readiness: this.getReadiness(user, enquiryId),
        conversion:
          this.store.getConversion(user, enquiryId, this.workflowStore) ?? null,
      };
    } catch (error) {
      return this.translateStoreError(error);
    }
  }

  getReadiness(user: SessionUser, enquiryId: string): IntakeReadiness {
    const enquiry = this.requireEnquiry(user, enquiryId);
    let assessment: AssessmentRecord | undefined;
    let onboarding: OnboardingRecord | undefined;
    try {
      assessment = this.store.getAssessment(user, enquiryId);
      onboarding = this.store.getOnboarding(user, enquiryId);
    } catch (error) {
      return this.translateStoreError(error);
    }
    const assessmentSection = projectAssessmentReadiness(
      enquiry,
      this.conflictState(user.firmId, enquiryId),
      assessment,
    );
    const onboardingSection = projectOnboardingReadiness(onboarding);
    const statusBlockers =
      enquiry.status === 'accepted'
        ? []
        : [
            critical(
              'enquiry_accepted',
              'The enquiry must be accepted by an authorised legal reviewer.',
            ),
          ];
    const conversionBlockers = mergeBlockers(
      statusBlockers,
      assessmentSection.blockers,
      onboardingSection.blockers,
    );
    return {
      assessment: assessmentSection,
      onboarding: onboardingSection,
      conversion: section(conversionBlockers),
    };
  }

  saveAssessment(
    user: SessionUser,
    enquiryId: string,
    command: unknown,
    context: AuditContext,
  ): {
    enquiry: EnquiryDetail;
    assessment: AssessmentRecord;
    readiness: IntakeReadiness;
  } {
    const parsed = saveAssessmentSchema.safeParse(command);
    if (!parsed.success) throw validationError(parsed.error);
    const input: SaveAssessmentInput = parsed.data;
    if (input.decision !== 'draft' && !hasCapability(user, 'intake.decide')) {
      throw new IntakeServiceError(
        'FORBIDDEN',
        'You do not have permission to record a legal assessment decision.',
      );
    }
    try {
      const result = this.store.saveAssessment(user, enquiryId, input, context);
      return {
        ...result,
        readiness: this.getReadiness(user, enquiryId),
      };
    } catch (error) {
      return this.translateStoreError(error);
    }
  }

  saveOnboarding(
    user: SessionUser,
    enquiryId: string,
    command: unknown,
    context: AuditContext,
  ): {
    enquiry: EnquiryDetail;
    onboarding: OnboardingRecord;
    readiness: IntakeReadiness;
  } {
    const parsed = saveOnboardingSchema.safeParse(command);
    if (!parsed.success) throw validationError(parsed.error);
    const input: SaveOnboardingInput = parsed.data;
    try {
      const result = this.store.saveOnboarding(user, enquiryId, input, context);
      return {
        ...result,
        readiness: this.getReadiness(user, enquiryId),
      };
    } catch (error) {
      return this.translateStoreError(error);
    }
  }

  decideEnquiry(
    user: SessionUser,
    enquiryId: string,
    command: unknown,
    context: AuditContext,
  ): { enquiry: EnquiryDetail; readiness: IntakeReadiness } {
    const parsed = decideEnquirySchema.safeParse(command);
    if (!parsed.success) throw validationError(parsed.error);
    const input: DecideEnquiryInput = parsed.data;
    if (!hasCapability(user, 'intake.decide')) {
      throw new IntakeServiceError(
        'FORBIDDEN',
        'You do not have permission to make an intake decision.',
      );
    }
    this.requireEnquiry(user, enquiryId);
    if (input.outcome === 'accepted') {
      const readiness = this.getReadiness(user, enquiryId);
      if (!readiness.assessment.ready) {
        throw new IntakeServiceError(
          'READINESS_BLOCKED',
          'Resolve every legal assessment blocker before accepting the enquiry.',
          readiness.assessment.blockers,
        );
      }
    }
    try {
      const enquiry = this.store.decideEnquiry(user, enquiryId, input, context);
      return {
        enquiry,
        readiness: this.getReadiness(user, enquiryId),
      };
    } catch (error) {
      return this.translateStoreError(error);
    }
  }

  convertEnquiry(
    user: SessionUser,
    enquiryId: string,
    command: unknown,
    context: AuditContext,
  ): IntakeConversionResult {
    const parsed = convertEnquirySchema.safeParse(command);
    if (!parsed.success) throw validationError(parsed.error);
    const input: ConvertEnquiryInput = parsed.data;
    if (!hasCapability(user, 'intake.convert')) {
      throw new IntakeServiceError(
        'FORBIDDEN',
        'You do not have permission to convert accepted enquiries.',
      );
    }
    const enquiry = this.requireEnquiry(user, enquiryId);
    try {
      const existing = this.store.getConversion(
        user,
        enquiryId,
        this.workflowStore,
      );
      if (existing) {
        if (existing.idempotencyKey !== input.idempotencyKey) {
          throw new IntakeServiceError(
            'IDEMPOTENCY_CONFLICT',
            'This enquiry has already been converted with another key.',
          );
        }
        return { ...existing, replayed: true };
      }
    } catch (error) {
      if (error instanceof IntakeServiceError) throw error;
      return this.translateStoreError(error);
    }
    if (enquiry.version !== input.expectedVersion) {
      throw new IntakeStateConflictError();
    }
    const readiness = this.getReadiness(user, enquiryId);
    if (!readiness.conversion.ready) {
      throw new IntakeServiceError(
        'READINESS_BLOCKED',
        'Resolve every conversion blocker before opening the matter.',
        readiness.conversion.blockers,
      );
    }
    try {
      return this.store.convertEnquiry(
        user,
        enquiryId,
        input,
        context,
        this.workflowStore,
      );
    } catch (error) {
      return this.translateStoreError(error);
    }
  }
}
