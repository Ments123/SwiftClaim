import { z } from 'zod';

export const firmRoleSchema = z.enum([
  'admin',
  'partner',
  'solicitor',
  'paralegal',
  'finance',
  'readonly',
]);

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const matterStatusSchema = z.enum(['open', 'on_hold', 'closed', 'archived']);
export const taskStatusSchema = z.enum([
  'open',
  'in_progress',
  'completed',
  'cancelled',
]);
export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const partyKindSchema = z.enum([
  'client',
  'opponent',
  'solicitor',
  'barrister',
  'expert',
  'witness',
  'court',
  'insurer',
  'other',
]);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export const createMatterSchema = z.object({
  reference: z.string().trim().min(2).max(80),
  title: z.string().trim().min(3).max(240),
  clientName: z.string().trim().min(2).max(200),
  matterType: z.string().trim().min(2).max(120),
  stage: z.string().trim().min(2).max(120),
  riskLevel: riskLevelSchema,
  ownerUserId: z.string().uuid(),
  openedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(4_000).default(''),
  externalSource: z.string().trim().max(80).optional(),
  externalId: z.string().trim().max(200).optional(),
  importBatchId: z.string().trim().max(200).optional(),
});

export const createPartySchema = z.object({
  kind: partyKindSchema,
  name: z.string().trim().min(2).max(200),
  organisation: z.string().trim().max(200).default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  phone: z.string().trim().max(80).default(''),
  address: z.string().trim().max(500).default(''),
  externalSource: z.string().trim().max(80).optional(),
  externalId: z.string().trim().max(200).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(240),
  notes: z.string().trim().max(2_000).default(''),
  dueAt: z.string().datetime({ offset: true }),
  priority: taskPrioritySchema.default('normal'),
  assigneeUserId: z.string().uuid(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    notes: z.string().trim().max(2_000).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    assigneeUserId: z.string().uuid().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one field must be supplied.',
  });

export const documentMetadataSchema = z.object({
  title: z.string().trim().min(2).max(240),
  category: z.string().trim().min(2).max(120),
});

export const transitionWorkflowSchema = z.object({
  toStageKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(80),
  expectedVersion: z.number().int().positive(),
  completedChecklistKeys: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/).max(120))
    .max(100)
    .default([]),
  reason: z.string().trim().min(10).max(1_000),
  overrideReason: z.string().trim().min(10).max(1_000).optional(),
});

export const confirmWorkflowTriggerSchema = z.object({
  eventType: z.enum([
    'letter_of_claim.received',
    'landlord_response.received',
    'expert.inspection.completed',
  ]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const preferredContactChannelSchema = z.enum(['email', 'phone', 'sms', 'post']);
const enquiryUrgencySchema = z.enum([
  'routine',
  'priority',
  'urgent',
  'critical',
]);

export const createEnquirySchema = z.object({
  source: z.string().trim().min(2).max(120),
  referrerName: z.string().trim().max(200).default(''),
  client: z.object({
    givenName: z.string().trim().min(1).max(100),
    familyName: z.string().trim().min(1).max(100),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    email: z
      .union([z.literal(''), z.string().trim().toLowerCase().email().max(254)])
      .default(''),
    phone: z.string().trim().max(80).default(''),
    preferredChannel: preferredContactChannelSchema,
  }),
  property: z.object({
    addressLine1: z.string().trim().min(2).max(200),
    addressLine2: z.string().trim().max(200).default(''),
    city: z.string().trim().min(2).max(120),
    county: z.string().trim().max(120).default(''),
    postcode: z.string().trim().min(5).max(12),
    country: z.literal('England'),
    propertyType: z.enum([
      'house',
      'flat',
      'maisonette',
      'bungalow',
      'other',
      'unknown',
    ]),
  }),
  landlordName: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(10).max(4_000),
  defectSummary: z.string().trim().min(5).max(4_000),
  desiredOutcome: z.string().trim().max(2_000).default(''),
  firstComplainedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currentlyOccupied: z.boolean(),
  urgency: enquiryUrgencySchema,
  immediateSafetyConcerns: z.string().trim().max(2_000).default(''),
  communicationRequirements: z.string().trim().max(2_000).default(''),
  assignedUserId: z.string().uuid(),
});

export const updateEnquirySchema = z.object({
  expectedVersion: z.number().int().positive(),
  summary: z.string().trim().min(10).max(4_000),
  defectSummary: z.string().trim().min(5).max(4_000),
  desiredOutcome: z.string().trim().max(2_000),
  urgency: enquiryUrgencySchema,
  immediateSafetyConcerns: z.string().trim().max(2_000),
  communicationRequirements: z.string().trim().max(2_000),
  assignedUserId: z.string().uuid(),
});

export const recordConflictDecisionSchema = z.object({
  checkId: z.string().uuid(),
  decision: z.enum(['clear', 'blocked', 'cleared_with_override']),
  reason: z.string().trim().min(10).max(2_000),
});

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assessmentEscalationSchema = z.enum([
  'personal_injury',
  'possession',
  'homelessness',
  'safeguarding',
  'urgent_injunction',
  'critical_hazard',
]);

export const saveAssessmentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  jurisdictionConfirmed: z.boolean(),
  claimantRelationship: z.enum([
    'tenant',
    'former_tenant',
    'leaseholder',
    'other',
  ]),
  noticeSummary: z.string().trim().min(10).max(4_000),
  conditionsUnresolved: z.boolean(),
  conditionStartDate: dateOnlySchema.nullable().optional(),
  accessSummary: z.string().trim().max(2_000),
  evidenceSummary: z.string().trim().max(4_000),
  limitationReview: z.string().trim().min(10).max(2_000),
  legalIssues: z
    .array(z.enum(['section_11', 'fitness', 'statutory', 'contractual']))
    .max(20),
  escalations: z.array(assessmentEscalationSchema).max(20),
  meritsRating: z.enum(['weak', 'borderline', 'reasonable', 'strong']),
  proportionalityRating: z.enum([
    'poor',
    'borderline',
    'reasonable',
    'strong',
  ]),
  decision: z.enum(['draft', 'proceed', 'decline', 'refer']),
  decisionReason: z.string().trim().min(10).max(2_000),
});

const onboardingControlSchema = z.enum([
  'not_started',
  'pending',
  'complete',
]);

export const saveOnboardingSchema = z.object({
  expectedVersion: z.number().int().positive(),
  identityStatus: z.enum(['not_started', 'pending', 'complete', 'failed']),
  clientCareStatus: onboardingControlSchema,
  authorityStatus: onboardingControlSchema,
  privacyStatus: onboardingControlSchema,
  fundingType: z.enum([
    'unconfirmed',
    'cfa',
    'legal_aid',
    'private',
    'before_event',
    'trade_union',
    'other',
  ]),
  fundingStatus: onboardingControlSchema,
  signatureStatus: z.enum(['not_started', 'sent', 'complete']),
  vulnerabilitySummary: z.string().trim().max(4_000),
  accessibilityNeeds: z.string().trim().max(2_000),
  interpreterLanguage: z.string().trim().min(2).max(120).nullable(),
  safeContactInstructions: z.string().trim().max(2_000),
  ownerUserId: z.string().uuid(),
  supervisorUserId: z.string().uuid(),
  tenancy: z.object({
    tenancyType: z.enum([
      'secure',
      'assured',
      'assured_shorthold',
      'introductory',
      'flexible',
      'leasehold',
      'licence',
      'other',
      'unknown',
    ]),
    startedOn: dateOnlySchema.nullable(),
    endedOn: dateOnlySchema.nullable(),
    rentMinor: z.number().int().nonnegative(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    rentFrequency: z.enum([
      'weekly',
      'fortnightly',
      'monthly',
      'quarterly',
      'annual',
      'other',
    ]),
    occupancyStartedOn: dateOnlySchema.nullable(),
    occupancyEndedOn: dateOnlySchema.nullable(),
  }),
  householdMembers: z
    .array(
      z.object({
        displayName: z.string().trim().min(2).max(200),
        relationship: z.string().trim().min(2).max(120),
        currentlyOccupies: z.boolean(),
        claimParticipant: z.boolean(),
        vulnerabilitySummary: z.string().trim().max(2_000),
        accessibilityNeeds: z.string().trim().max(2_000),
      }),
    )
    .max(50),
});

export const decideEnquirySchema = z.object({
  expectedVersion: z.number().int().positive(),
  outcome: z.enum([
    'accepted',
    'declined',
    'referred',
    'duplicate',
    'unable_to_contact',
  ]),
  reason: z.string().trim().min(10).max(2_000),
});

export const convertEnquirySchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const evidenceDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const evidenceIdempotencyKeySchema = z.string().trim().min(8).max(200);
const defectCategorySchema = z.enum([
  'damp_mould',
  'leak',
  'heating',
  'electrical',
  'structural',
  'pest',
  'ventilation',
  'sanitation',
  'other',
]);
const defectSeveritySchema = z.enum([
  'low',
  'moderate',
  'serious',
  'critical',
]);
const defectStatusSchema = z.enum([
  'open',
  'monitoring',
  'repaired',
  'disputed',
  'superseded',
]);

export const createDefectSchema = z.object({
  location: z.string().trim().min(2).max(120),
  category: defectCategorySchema,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(4_000),
  severity: defectSeveritySchema,
  firstObservedOn: evidenceDateOnlySchema.nullable(),
  healthImpact: z.string().trim().max(2_000).default(''),
  hazardTags: z
    .array(z.string().trim().min(2).max(80))
    .max(20)
    .default([]),
});

export const updateDefectSchema = createDefectSchema.extend({
  expectedVersion: z.number().int().positive(),
  status: defectStatusSchema,
  statusReason: z.string().trim().min(10).max(1_000),
});

export const createNoticeSchema = z.object({
  idempotencyKey: evidenceIdempotencyKeySchema,
  occurredAt: z.string().datetime({ offset: true }),
  channel: z.enum([
    'email',
    'phone',
    'sms',
    'whatsapp',
    'letter',
    'portal',
    'in_person',
    'other',
  ]),
  recipientType: z.enum([
    'landlord',
    'managing_agent',
    'contractor',
    'local_authority',
    'other',
  ]),
  recipientName: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(10).max(4_000),
  proofStatus: z.enum([
    'linked',
    'client_recollection',
    'unavailable',
    'unknown',
  ]),
  responseStatus: z.enum([
    'none',
    'acknowledged',
    'inspection_arranged',
    'repair_promised',
    'repair_attempted',
    'repaired',
    'disputed',
    'other',
  ]),
  responseSummary: z.string().trim().max(2_000).default(''),
  supersedesNoticeId: z.string().uuid().nullable().default(null),
});

export const createAccessEventSchema = z.object({
  idempotencyKey: evidenceIdempotencyKeySchema,
  eventType: z.enum([
    'offered',
    'scheduled',
    'attempted',
    'completed',
    'refused_by_landlord',
    'refused_by_client',
    'no_access',
    'cancelled',
  ]),
  appointmentAt: z.string().datetime({ offset: true }).nullable(),
  notes: z.string().trim().min(5).max(2_000),
  supersedesAccessEventId: z.string().uuid().nullable().default(null),
});

const evidenceLinkIdsSchema = z.array(z.string().uuid()).max(100);

export const createEvidenceItemSchema = z
  .object({
    idempotencyKey: evidenceIdempotencyKeySchema,
    kind: z.enum([
      'photograph',
      'video',
      'correspondence',
      'repair_record',
      'tenancy_record',
      'medical_link',
      'client_statement',
      'other',
    ]),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(5).max(4_000),
    occurredOn: evidenceDateOnlySchema.nullable(),
    provenanceSource: z.enum([
      'client',
      'solicitor',
      'landlord',
      'managing_agent',
      'contractor',
      'expert',
      'medical_provider',
      'third_party',
      'other',
    ]),
    provenanceDetail: z.string().trim().min(5).max(2_000),
    documentVersionId: z.string().uuid(),
    defectIds: evidenceLinkIdsSchema.default([]),
    noticeIds: evidenceLinkIdsSchema.default([]),
    accessEventIds: evidenceLinkIdsSchema.default([]),
  })
  .superRefine((input, context) => {
    const linkGroups = [
      ['defectIds', input.defectIds],
      ['noticeIds', input.noticeIds],
      ['accessEventIds', input.accessEventIds],
    ] as const;

    for (const [field, ids] of linkGroups) {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          message: 'Link identifiers must be unique.',
          path: [field],
        });
      }
    }

    if (
      input.defectIds.length === 0 &&
      input.noticeIds.length === 0 &&
      input.accessEventIds.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Link the evidence to at least one investigation record.',
        path: ['defectIds'],
      });
    }
  });

export type FirmRole = z.infer<typeof firmRoleSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type CreateMatterInput = z.infer<typeof createMatterSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TransitionWorkflowInput = z.infer<
  typeof transitionWorkflowSchema
>;
export type ConfirmWorkflowTriggerInput = z.infer<
  typeof confirmWorkflowTriggerSchema
>;
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;
export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;
export type RecordConflictDecisionInput = z.infer<
  typeof recordConflictDecisionSchema
>;
export type SaveAssessmentInput = z.infer<typeof saveAssessmentSchema>;
export type SaveOnboardingInput = z.infer<typeof saveOnboardingSchema>;
export type DecideEnquiryInput = z.infer<typeof decideEnquirySchema>;
export type ConvertEnquiryInput = z.infer<typeof convertEnquirySchema>;
export type CreateDefectInput = z.infer<typeof createDefectSchema>;
export type UpdateDefectInput = z.infer<typeof updateDefectSchema>;
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
export type CreateAccessEventInput = z.infer<typeof createAccessEventSchema>;
export type CreateEvidenceItemInput = z.infer<typeof createEvidenceItemSchema>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
