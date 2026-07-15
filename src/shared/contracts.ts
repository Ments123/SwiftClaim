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
    'expert.report.received',
    'expert.report.served_cpr35',
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

const protocolDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const protocolNullableDateSchema = protocolDateOnlySchema.nullable();
const protocolNullableUuidSchema = z.string().uuid().nullable();
const protocolIdempotencyKeySchema = z.string().trim().min(8).max(200);
const protocolCorrectionReasonSchema = z.string().trim().max(2_000).default('');
const protocolCurrencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const accessWindowSchema = z
  .object({
    date: protocolDateOnlySchema,
    from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    notes: z.string().trim().max(500).default(''),
  })
  .refine((value) => value.from < value.to, {
    message: 'The access end time must be after the start time.',
    path: ['to'],
  });

export const saveLetterOfClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
  claimantAddress: z.string().trim().min(5).max(500),
  landlordRecipient: z.string().trim().min(2).max(240),
  landlordAddress: z.string().trim().min(5).max(500),
  effectNarrative: z.string().trim().min(10).max(8_000),
  personalInjuryStatus: z.enum([
    'none',
    'minor_gp_evidence',
    'other_protocol_required',
    'under_review',
  ]),
  personalInjurySummary: z.string().trim().max(4_000).default(''),
  specialDamagesStatus: z.enum(['none', 'claimed', 'under_review']),
  specialDamagesSummary: z.string().trim().max(4_000).default(''),
  accessWindows: z.array(accessWindowSchema).max(20),
  expertProposalSummary: z.string().trim().max(4_000).default(''),
  disclosureRequests: z
    .array(z.string().trim().min(3).max(500))
    .min(1)
    .max(30)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Disclosure requests must be unique.',
    }),
  additionalContent: z.string().trim().max(8_000).default(''),
  state: z.enum(['draft', 'ready_for_review']),
});

export const approveLetterOfClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: protocolIdempotencyKeySchema,
});

export const recordProtocolServiceEventSchema = z
  .object({
    idempotencyKey: protocolIdempotencyKeySchema,
    letterVersionId: z.string().uuid(),
    eventType: z.enum([
      'dispatched',
      'actual_receipt',
      'deemed_receipt',
      'receipt_disputed',
      'delivery_failed',
      'corrected',
    ]),
    method: z.enum(['email', 'post', 'hand', 'portal', 'courier', 'other']),
    occurredAt: z.string().datetime({ offset: true }),
    legalTriggerOn: protocolNullableDateSchema,
    recipient: z.string().trim().min(2).max(240),
    destination: z.string().trim().min(2).max(500),
    sourceDetail: z.string().trim().min(10).max(2_000),
    supportingDocumentVersionId: protocolNullableUuidSchema,
    supersedesEventId: protocolNullableUuidSchema,
    correctionReason: protocolCorrectionReasonSchema,
  })
  .superRefine((input, context) => {
    if (
      ['actual_receipt', 'deemed_receipt'].includes(input.eventType) &&
      !input.legalTriggerOn
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A confirmed legal trigger date is required for receipt.',
        path: ['legalTriggerOn'],
      });
    }
    if (input.supersedesEventId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'A correction reason of at least 10 characters is required.',
        path: ['correctionReason'],
      });
    }
  });

const responseDefectPositionSchema = z.object({
  defectId: z.string().uuid(),
  position: z.enum([
    'admitted',
    'partly_admitted',
    'denied',
    'not_addressed',
    'unclear',
  ]),
  reason: z.string().trim().max(2_000).default(''),
});

export const recordLandlordResponseSchema = z
  .object({
    idempotencyKey: protocolIdempotencyKeySchema,
    responseType: z.enum([
      'initial',
      'expert_proposal',
      'substantive',
      'supplemental',
      'no_response_recorded',
    ]),
    receivedOn: protocolNullableDateSchema,
    respondingParty: z.string().trim().min(2).max(240),
    contactName: z.string().trim().max(240).default(''),
    generalLiabilityPosition: z.enum([
      'admitted',
      'partly_admitted',
      'denied',
      'reserved',
      'not_addressed',
      'no_response',
    ]),
    liabilityReasons: z.string().trim().max(6_000).default(''),
    noticePosition: z.string().trim().max(4_000).default(''),
    accessPosition: z.string().trim().max(4_000).default(''),
    disclosureStatus: z.enum([
      'complete',
      'partial',
      'withheld',
      'none',
      'not_applicable',
    ]),
    disclosureSummary: z.string().trim().max(4_000).default(''),
    expertProposalPosition: z.enum([
      'agreed',
      'agreed_separate_instructions',
      'joint_inspection',
      'objected',
      'not_addressed',
      'not_applicable',
    ]),
    expertProposalSummary: z.string().trim().max(4_000).default(''),
    worksSchedule: z.string().trim().max(6_000).default(''),
    worksStartOn: protocolNullableDateSchema,
    worksCompleteOn: protocolNullableDateSchema,
    compensationOfferMinor: z.number().int().nonnegative().nullable(),
    costsOfferMinor: z.number().int().nonnegative().nullable(),
    currency: protocolCurrencySchema,
    sourceDocumentVersionId: protocolNullableUuidSchema,
    supersedesResponseId: protocolNullableUuidSchema,
    correctionReason: protocolCorrectionReasonSchema,
    defectPositions: z.array(responseDefectPositionSchema).max(200),
  })
  .superRefine((input, context) => {
    if (input.responseType === 'no_response_recorded') {
      if (input.receivedOn !== null || input.generalLiabilityPosition !== 'no_response') {
        context.addIssue({
          code: 'custom',
          message: 'A no-response record cannot contain a received date or liability response.',
          path: ['responseType'],
        });
      }
    } else {
      if (!input.receivedOn) {
        context.addIssue({
          code: 'custom',
          message: 'The landlord response received date is required.',
          path: ['receivedOn'],
        });
      }
      if (input.defectPositions.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Record the response position for at least one defect.',
          path: ['defectPositions'],
        });
      }
    }
    if (
      new Set(input.defectPositions.map(({ defectId }) => defectId)).size !==
      input.defectPositions.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A defect can appear only once in a response.',
        path: ['defectPositions'],
      });
    }
    if (input.supersedesResponseId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'A correction reason of at least 10 characters is required.',
        path: ['correctionReason'],
      });
    }
  });

export const varyProtocolDeadlineSchema = z.object({
  deadlineId: z.string().uuid(),
  agreedOn: protocolDateOnlySchema,
  dueOn: protocolDateOnlySchema,
  reason: z.string().trim().min(10).max(2_000),
  idempotencyKey: protocolIdempotencyKeySchema,
});

export const expertRouteSchema = z.enum([
  'undecided',
  'proposed_single_joint',
  'single_joint_joint_instructions',
  'single_joint_separate_instructions',
  'separate_experts',
  'joint_inspection',
  'urgent_own_expert',
  'not_required',
]);

export const selectExpertRouteSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    route: expertRouteSchema,
    reason: z.string().trim().max(2_000).default(''),
    urgentReason: z.string().trim().max(2_000).default(''),
  })
  .superRefine((input, context) => {
    if (
      ['not_required', 'urgent_own_expert'].includes(input.route) &&
      input.reason.length < 10
    ) {
      context.addIssue({
        code: 'custom',
        message: 'This expert route requires a reason of at least 10 characters.',
        path: ['reason'],
      });
    }
    if (input.route === 'urgent_own_expert' && input.urgentReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'An urgent instruction reason is required.',
        path: ['urgentReason'],
      });
    }
  });

const expertEngagementFields = {
  route: z.enum([
    'proposed_single_joint',
    'single_joint_joint_instructions',
    'single_joint_separate_instructions',
    'separate_experts',
    'joint_inspection',
    'urgent_own_expert',
  ]),
  expertRole: z.enum([
    'building_surveyor',
    'environmental_health',
    'other_housing_conditions',
  ]),
  expertName: z.string().trim().min(2).max(240),
  organisation: z.string().trim().max(240).default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  phone: z.string().trim().max(80).default(''),
  expertise: z.string().trim().min(5).max(2_000),
  qualifications: z.string().trim().max(2_000).default(''),
  registrationBody: z.string().trim().max(120).default(''),
  registrationReference: z.string().trim().max(200).default(''),
  verificationStatus: z.enum(['unverified', 'user_verified']),
  verificationMethod: z.string().trim().max(1_000).default(''),
  verifiedOn: protocolNullableDateSchema,
  proposedBy: z.enum(['claimant', 'landlord', 'jointly', 'court', 'other']),
  singleJoint: z.boolean(),
  termsStatus: z.enum([
    'not_requested',
    'requested',
    'received',
    'accepted',
    'rejected',
  ]),
  feeBasis: z.string().trim().max(1_000).default(''),
  feeMinor: z.number().int().nonnegative().nullable(),
  currency: protocolCurrencySchema,
  payerSplit: z
    .object({
      claimantPercent: z.number().int().min(0).max(100),
      landlordPercent: z.number().int().min(0).max(100),
    })
    .refine(
      ({ claimantPercent, landlordPercent }) =>
        claimantPercent + landlordPercent === 100,
      { message: 'The payer split must total 100 percent.' },
    ),
  availabilitySummary: z.string().trim().max(2_000).default(''),
  targetReportOn: protocolNullableDateSchema,
};

export const createExpertEngagementSchema = z.object(expertEngagementFields);
export const updateExpertEngagementSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    route: expertEngagementFields.route.optional(),
    expertRole: expertEngagementFields.expertRole.optional(),
    expertName: expertEngagementFields.expertName.optional(),
    organisation: expertEngagementFields.organisation.optional(),
    email: expertEngagementFields.email.optional(),
    phone: expertEngagementFields.phone.optional(),
    expertise: expertEngagementFields.expertise.optional(),
    qualifications: expertEngagementFields.qualifications.optional(),
    registrationBody: expertEngagementFields.registrationBody.optional(),
    registrationReference: expertEngagementFields.registrationReference.optional(),
    verificationStatus: expertEngagementFields.verificationStatus.optional(),
    verificationMethod: expertEngagementFields.verificationMethod.optional(),
    verifiedOn: expertEngagementFields.verifiedOn.optional(),
    proposedBy: expertEngagementFields.proposedBy.optional(),
    singleJoint: expertEngagementFields.singleJoint.optional(),
    termsStatus: expertEngagementFields.termsStatus.optional(),
    feeBasis: expertEngagementFields.feeBasis.optional(),
    feeMinor: expertEngagementFields.feeMinor.optional(),
    currency: expertEngagementFields.currency.optional(),
    payerSplit: expertEngagementFields.payerSplit.optional(),
    availabilitySummary: expertEngagementFields.availabilitySummary.optional(),
    targetReportOn: expertEngagementFields.targetReportOn.optional(),
  })
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'At least one expert field must be supplied.',
  });

export const recordExpertConflictCheckSchema = z
  .object({
    idempotencyKey: protocolIdempotencyKeySchema,
    partiesChecked: z.array(z.string().trim().min(2).max(240)).min(2).max(100),
    method: z.string().trim().min(5).max(1_000),
    searchDetail: z.string().trim().min(5).max(4_000),
    outcome: z.enum(['clear', 'potential', 'blocked', 'unable_to_complete']),
    decision: z.enum([
      'clear_to_proceed',
      'proceed_with_override',
      'do_not_proceed',
    ]),
    reason: z.string().trim().min(10).max(2_000),
  })
  .superRefine((input, context) => {
    if (input.outcome === 'potential' && input.decision !== 'proceed_with_override') {
      context.addIssue({
        code: 'custom',
        message: 'A potential conflict requires an explicit override or a stop decision.',
        path: ['decision'],
      });
    }
    if (
      ['blocked', 'unable_to_complete'].includes(input.outcome) &&
      input.decision !== 'do_not_proceed'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'This conflict result cannot proceed.',
        path: ['decision'],
      });
    }
  });

export const approveExpertInstructionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: protocolIdempotencyKeySchema,
  issues: z.array(z.string().trim().min(5).max(2_000)).min(1).max(50),
  questions: z.array(z.string().trim().min(5).max(2_000)).min(1).max(50),
  accessDetail: z.string().trim().min(5).max(2_000),
  urgentWorksRequested: z.boolean(),
  scheduleOfWorksRequested: z.boolean(),
  costEstimateRequested: z.boolean(),
  reportDueOn: protocolNullableDateSchema,
});

export const recordExpertMilestoneSchema = z
  .object({
    idempotencyKey: protocolIdempotencyKeySchema,
    instructionVersionId: protocolNullableUuidSchema,
    eventType: z.enum([
      'expert_proposed', 'expert_agreed', 'expert_objected', 'expert_withdrawn',
      'terms_offered', 'terms_accepted', 'terms_rejected',
      'instruction_dispatched', 'instruction_acknowledged',
      'inspection_proposed', 'inspection_booked', 'inspection_rescheduled',
      'inspection_completed', 'inspection_failed', 'inspection_cancelled',
      'access_provided', 'access_refused', 'access_unavailable',
      'report_received', 'report_reviewed', 'report_superseded', 'report_shared',
      'joint_schedule_received', 'urgent_issue_escalated',
      'engagement_completed', 'engagement_cancelled',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    legalTriggerOn: protocolNullableDateSchema,
    detail: z.string().trim().min(5).max(4_000),
    supportingDocumentVersionId: protocolNullableUuidSchema,
    supersedesEventId: protocolNullableUuidSchema,
    correctionReason: protocolCorrectionReasonSchema,
  })
  .superRefine((input, context) => {
    if (input.supersedesEventId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'A correction reason of at least 10 characters is required.',
        path: ['correctionReason'],
      });
    }
  });

export const recordExpertReportSchema = z.object({
  idempotencyKey: protocolIdempotencyKeySchema,
  reportType: z.enum([
    'single_joint_report',
    'party_report',
    'agreed_schedule',
    'supplemental_report',
    'other',
  ]),
  reportOn: protocolDateOnlySchema,
  receivedOn: protocolDateOnlySchema,
  coverageSummary: z.string().trim().min(10).max(6_000),
  urgentWorksIdentified: z.boolean(),
  documentVersionId: z.string().uuid(),
  supersedesReportId: protocolNullableUuidSchema,
});

export const recordExpertQuestionSchema = z
  .object({
    idempotencyKey: protocolIdempotencyKeySchema,
    reportId: z.string().uuid(),
    question: z.string().trim().min(10).max(4_000),
    clarificationPurpose: z.string().trim().min(10).max(2_000),
    dispatchedOn: protocolNullableDateSchema,
    responseDueOn: protocolNullableDateSchema,
    legalBasis: z.enum(['none', 'agreed', 'solicitor_set', 'cpr35_6']),
    reportServedOn: protocolNullableDateSchema,
  })
  .superRefine((input, context) => {
    if (input.legalBasis === 'cpr35_6' && !input.reportServedOn) {
      context.addIssue({
        code: 'custom',
        message: 'Confirm the report service date before applying CPR 35.6.',
        path: ['reportServedOn'],
      });
    }
  });

export const recordExpertQuestionAnswerSchema = z.object({
  idempotencyKey: protocolIdempotencyKeySchema,
  receivedOn: protocolDateOnlySchema,
  summary: z.string().trim().min(10).max(4_000),
  documentVersionId: z.string().uuid(),
});

const quantumDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const quantumNullableDateSchema = quantumDateOnlySchema.nullable();
const quantumNullableUuidSchema = z.string().uuid().nullable();
const quantumIdempotencyKeySchema = z.string().trim().min(8).max(200);
const quantumMoneySchema = z.number().int().nonnegative().safe();
const quantumNullableMoneySchema = quantumMoneySchema.nullable();
const quantumLineageKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .min(3)
  .max(120);

const workItemSchema = z
  .object({
    lineageKey: quantumLineageKeySchema,
    area: z.string().trim().min(2).max(200),
    description: z.string().trim().min(10).max(4_000),
    responsibilityPosition: z.enum(['agreed', 'disputed', 'unknown']),
    priority: z.enum(['urgent', 'high', 'routine']),
    targetStartOn: quantumNullableDateSchema,
    targetCompletionOn: quantumNullableDateSchema,
    estimatedCostMinor: quantumNullableMoneySchema,
    contractor: z.string().trim().max(240).default(''),
    sourceNote: z.string().trim().min(5).max(2_000),
    defectIds: z.array(z.string().uuid()).max(100).default([]),
    evidenceItemIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict()
  .refine(
    ({ targetStartOn, targetCompletionOn }) =>
      !targetStartOn || !targetCompletionOn || targetCompletionOn >= targetStartOn,
    {
      message: 'The target completion date must not be before the start date.',
      path: ['targetCompletionOn'],
    },
  );

export const createWorkScheduleSchema = z
  .object({
    title: z.string().trim().min(5).max(240),
    sourceType: z.enum([
      'expert_report',
      'agreed_schedule',
      'landlord_response',
      'solicitor_review',
      'other',
    ]),
    sourceDocumentVersionId: quantumNullableUuidSchema,
    basedOnScheduleId: quantumNullableUuidSchema,
    items: z.array(workItemSchema).min(1).max(250),
  })
  .strict()
  .refine(
    ({ items }) => new Set(items.map(({ lineageKey }) => lineageKey)).size === items.length,
    { message: 'Work item lineage keys must be unique.', path: ['items'] },
  );

export const approveWorkScheduleSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: quantumIdempotencyKeySchema,
    approvalNote: z.string().trim().min(10).max(2_000),
    acknowledgedWarningKeys: z
      .array(z.string().trim().min(2).max(120))
      .max(100)
      .default([]),
  })
  .strict();

export const createRepairEventSchema = z
  .object({
    idempotencyKey: quantumIdempotencyKeySchema,
    eventType: z.enum([
      'proposed',
      'appointment_booked',
      'access_offered',
      'access_provided',
      'access_refused',
      'access_unavailable',
      'started',
      'paused',
      'completion_asserted',
      'client_disputes_completion',
      'failed_inspection',
      'verified_complete',
      'superseded',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    actorType: z.enum([
      'client',
      'landlord',
      'contractor',
      'expert',
      'solicitor',
      'other',
    ]),
    note: z.string().trim().min(5).max(4_000),
    appointmentFrom: z.string().datetime({ offset: true }).nullable(),
    appointmentTo: z.string().datetime({ offset: true }).nullable(),
    evidenceItemIds: z.array(z.string().uuid()).max(100).default([]),
    verifier: z.string().trim().max(240).default(''),
    supersedesEventId: quantumNullableUuidSchema,
    correctionReason: z.string().trim().max(2_000).default(''),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.eventType === 'verified_complete' &&
      (!input.verifier || input.evidenceItemIds.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Verified completion requires a verifier and completion evidence.',
        path: ['verifier'],
      });
    }
    if (input.eventType === 'superseded' && !input.supersedesEventId) {
      context.addIssue({
        code: 'custom',
        message: 'A superseding event must identify the corrected event.',
        path: ['supersedesEventId'],
      });
    }
    if (input.supersedesEventId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'A correction reason of at least 10 characters is required.',
        path: ['correctionReason'],
      });
    }
    if (
      input.appointmentFrom &&
      input.appointmentTo &&
      input.appointmentTo <= input.appointmentFrom
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The appointment end must be after its start.',
        path: ['appointmentTo'],
      });
    }
  });

export const createLossScheduleSchema = z
  .object({
    title: z.string().trim().min(5).max(240),
    valuationOn: quantumDateOnlySchema,
    currency: z.literal('GBP'),
    basedOnScheduleId: quantumNullableUuidSchema,
    notes: z.string().trim().max(4_000).default(''),
  })
  .strict();

const lossItemFields = {
  lineageKey: quantumLineageKeySchema,
  category: z.enum([
    'damaged_belongings',
    'additional_heating',
    'cleaning',
    'temporary_accommodation',
    'travel',
    'medical_expense',
    'loss_of_earnings',
    'other',
  ]),
  description: z.string().trim().min(5).max(4_000),
  periodStartOn: quantumNullableDateSchema,
  periodEndOn: quantumNullableDateSchema,
  calculationType: z.enum(['fixed', 'quantity_rate', 'period_rate', 'manual']),
  quantity: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
    .nullable(),
  unitLabel: z.string().trim().max(80).default(''),
  rateMinor: quantumNullableMoneySchema,
  fixedAmountMinor: quantumNullableMoneySchema,
  manualAmountMinor: quantumNullableMoneySchema,
  manualBasis: z.string().trim().max(2_000).default(''),
  position: z.enum(['claimed', 'accepted', 'disputed', 'withdrawn']),
  evidenceStatus: z.enum(['supported', 'partial', 'missing', 'not_applicable']),
  sourceNote: z.string().trim().min(5).max(2_000),
  evidenceItemIds: z.array(z.string().uuid()).max(100).default([]),
};

function validateLossCalculation(
  input: {
    calculationType: string;
    quantity: string | null;
    unitLabel: string;
    rateMinor: number | null;
    fixedAmountMinor: number | null;
    manualAmountMinor: number | null;
    manualBasis: string;
    periodStartOn: string | null;
    periodEndOn: string | null;
  },
  context: z.RefinementCtx,
) {
  if (
    ['quantity_rate', 'period_rate'].includes(input.calculationType) &&
    (!input.quantity || !input.unitLabel || input.rateMinor === null)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Quantity calculations require quantity, unit and rate.',
      path: ['quantity'],
    });
  }
  if (input.calculationType === 'fixed' && input.fixedAmountMinor === null) {
    context.addIssue({
      code: 'custom',
      message: 'A fixed calculation requires a fixed amount.',
      path: ['fixedAmountMinor'],
    });
  }
  if (
    input.calculationType === 'manual' &&
    (input.manualAmountMinor === null || input.manualBasis.length < 10)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'A manual amount requires an amount and review basis.',
      path: ['manualBasis'],
    });
  }
  if (
    input.periodStartOn &&
    input.periodEndOn &&
    input.periodEndOn < input.periodStartOn
  ) {
    context.addIssue({
      code: 'custom',
      message: 'The loss period end must not precede its start.',
      path: ['periodEndOn'],
    });
  }
}

export const createLossItemSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    ...lossItemFields,
  })
  .strict()
  .superRefine(validateLossCalculation);

export const updateLossItemSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    ...lossItemFields,
  })
  .strict()
  .superRefine(validateLossCalculation);

export const approveLossScheduleSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: quantumIdempotencyKeySchema,
    approvalNote: z.string().trim().min(10).max(2_000),
    acknowledgedEvidenceGapItemIds: z
      .array(z.string().uuid())
      .max(250)
      .default([]),
  })
  .strict();

export const createGeneralDamagesReviewSchema = z
  .object({
    idempotencyKey: quantumIdempotencyKeySchema,
    valuationOn: quantumDateOnlySchema,
    lowMinor: quantumMoneySchema,
    highMinor: quantumMoneySchema,
    preferredMinor: quantumNullableMoneySchema,
    basis: z.string().trim().min(10).max(6_000),
    authorities: z.array(z.string().trim().min(3).max(1_000)).max(100),
    evidenceItemIds: z.array(z.string().uuid()).max(100),
    reviewNote: z.string().trim().min(10).max(2_000),
    supersedesReviewId: quantumNullableUuidSchema,
    nonePresentlyAdvanced: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.highMinor < input.lowMinor) {
      context.addIssue({
        code: 'custom',
        message: 'The high value must not be below the low value.',
        path: ['highMinor'],
      });
    }
    if (
      input.preferredMinor !== null &&
      (input.preferredMinor < input.lowMinor || input.preferredMinor > input.highMinor)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The preferred value must fall within the reviewed range.',
        path: ['preferredMinor'],
      });
    }
    if (
      input.nonePresentlyAdvanced &&
      (input.lowMinor !== 0 || input.highMinor !== 0 || input.preferredMinor !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'No current claim must use a zero range without a preferred value.',
        path: ['nonePresentlyAdvanced'],
      });
    }
  });

const part36OfferTermsSchema = z
  .object({
    relevantPeriodDays: z.number().int().min(21).max(365),
    relevantPeriodBasis: z.string().trim().min(10).max(2_000),
    includesCounterclaim: z.boolean(),
    paymentPeriodDays: z.number().int().positive().max(365),
  })
  .strict();

export const createOfferSchema = z
  .object({
    idempotencyKey: quantumIdempotencyKeySchema,
    direction: z.enum(['claimant', 'defendant']),
    offerType: z.enum([
      'part_36',
      'wpsatc',
      'open',
      'protocol_compensation',
      'costs_only',
      'global',
    ]),
    confidentiality: z.enum(['open', 'protected_costs', 'protected_negotiation']),
    scope: z.enum(['whole_claim', 'part_of_claim', 'issue']),
    scopeDescription: z.string().trim().min(5).max(2_000),
    damagesMinor: quantumNullableMoneySchema,
    costsMinor: quantumNullableMoneySchema,
    totalMinor: quantumNullableMoneySchema,
    currency: z.literal('GBP'),
    worksTerms: z.string().trim().max(4_000).default(''),
    nonMoneyTerms: z.string().trim().max(4_000).default(''),
    interestTreatment: z.string().trim().max(2_000).default(''),
    writtenOfferDocumentVersionId: quantumNullableUuidSchema,
    madeOn: quantumDateOnlySchema,
    part36: part36OfferTermsSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.offerType === 'part_36') {
      if (input.confidentiality !== 'protected_costs') {
        context.addIssue({
          code: 'custom',
          message: 'A Part 36 offer must use protected-costs confidentiality.',
          path: ['confidentiality'],
        });
      }
      if (!input.part36 || !input.writtenOfferDocumentVersionId) {
        context.addIssue({
          code: 'custom',
          message: 'A Part 36 record requires written terms and a retained document.',
          path: ['part36'],
        });
      }
    } else if (input.part36) {
      context.addIssue({
        code: 'custom',
        message: 'Part 36 terms can only be attached to a Part 36 offer.',
        path: ['part36'],
      });
    }
    if (
      input.offerType === 'wpsatc' &&
      input.confidentiality !== 'protected_costs'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A WPSATC offer must use protected-costs confidentiality.',
        path: ['confidentiality'],
      });
    }
  });

export const recordOfferEventSchema = z
  .object({
    idempotencyKey: quantumIdempotencyKeySchema,
    eventType: z.enum([
      'made',
      'served',
      'clarified',
      'improved',
      'withdrawn',
      'accepted',
      'rejected',
      'not_accepted',
      'superseded',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    note: z.string().trim().min(10).max(4_000),
    sourceDocumentVersionId: quantumNullableUuidSchema,
    supersedesEventId: quantumNullableUuidSchema,
    correctionReason: z.string().trim().max(2_000).default(''),
    explicitConfirmation: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      ['accepted', 'withdrawn'].includes(input.eventType) &&
      !input.explicitConfirmation
    ) {
      context.addIssue({
        code: 'custom',
        message: 'This outcome requires explicit confirmation.',
        path: ['explicitConfirmation'],
      });
    }
    if (input.supersedesEventId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        message: 'A correction reason of at least 10 characters is required.',
        path: ['correctionReason'],
      });
    }
  });

export const reviewPart36Schema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: quantumIdempotencyKeySchema,
    serviceOn: quantumDateOnlySchema,
    serviceConfirmed: z.literal(true),
    validationStatus: z.enum(['reviewed', 'not_valid']),
    validationNote: z.string().trim().min(10).max(2_000),
  })
  .strict();

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
export type SaveLetterOfClaimInput = z.infer<typeof saveLetterOfClaimSchema>;
export type ApproveLetterOfClaimInput = z.infer<typeof approveLetterOfClaimSchema>;
export type RecordProtocolServiceEventInput = z.infer<typeof recordProtocolServiceEventSchema>;
export type RecordLandlordResponseInput = z.infer<typeof recordLandlordResponseSchema>;
export type VaryProtocolDeadlineInput = z.infer<typeof varyProtocolDeadlineSchema>;
export type SelectExpertRouteInput = z.infer<typeof selectExpertRouteSchema>;
export type CreateExpertEngagementInput = z.infer<typeof createExpertEngagementSchema>;
export type UpdateExpertEngagementInput = z.infer<typeof updateExpertEngagementSchema>;
export type RecordExpertConflictCheckInput = z.infer<typeof recordExpertConflictCheckSchema>;
export type ApproveExpertInstructionInput = z.infer<typeof approveExpertInstructionSchema>;
export type RecordExpertMilestoneInput = z.infer<typeof recordExpertMilestoneSchema>;
export type RecordExpertReportInput = z.infer<typeof recordExpertReportSchema>;
export type RecordExpertQuestionInput = z.infer<typeof recordExpertQuestionSchema>;
export type RecordExpertQuestionAnswerInput = z.infer<typeof recordExpertQuestionAnswerSchema>;
export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type ApproveWorkScheduleInput = z.infer<typeof approveWorkScheduleSchema>;
export type CreateRepairEventInput = z.infer<typeof createRepairEventSchema>;
export type CreateLossScheduleInput = z.infer<typeof createLossScheduleSchema>;
export type CreateLossItemInput = z.infer<typeof createLossItemSchema>;
export type UpdateLossItemInput = z.infer<typeof updateLossItemSchema>;
export type ApproveLossScheduleInput = z.infer<typeof approveLossScheduleSchema>;
export type CreateGeneralDamagesReviewInput = z.infer<typeof createGeneralDamagesReviewSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type RecordOfferEventInput = z.infer<typeof recordOfferEventSchema>;
export type ReviewPart36Input = z.infer<typeof reviewPart36Schema>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
