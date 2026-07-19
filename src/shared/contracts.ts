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

export const communicationChannelSchema = z.enum([
  'email',
  'whatsapp',
  'telephone',
  'letter',
  'portal',
  'sms',
  'in_person',
  'internal',
]);

export const communicationConfidentialitySchema = z.enum([
  'ordinary',
  'internal',
  'privileged',
  'protected_negotiation',
]);

export const communicationDirectionSchema = z.enum([
  'inbound',
  'outbound',
  'internal',
]);

export const communicationParticipantSchema = z
  .object({
    role: z.enum([
      'from',
      'to',
      'cc',
      'bcc',
      'caller',
      'callee',
      'attendee',
      'author',
      'recipient',
    ]),
    displayName: z.string().trim().min(1).max(200),
    endpointType: z.enum([
      'email',
      'phone',
      'whatsapp',
      'postal_address',
      'portal',
      'user',
      'unknown',
    ]),
    endpoint: z.string().trim().min(1).max(500),
    partyId: z.string().uuid().nullable().optional().default(null),
    userId: z.string().uuid().nullable().optional().default(null),
  })
  .strict();

const communicationIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200);
const communicationUuidListSchema = z.array(z.string().uuid()).max(50);
const communicationContentFields = {
  channel: communicationChannelSchema,
  confidentiality: communicationConfidentialitySchema,
  participants: z.array(communicationParticipantSchema).min(1).max(100),
  subject: z.string().trim().max(500).default(''),
  body: z.string().trim().min(1).max(100_000),
  bodyFormat: z.enum(['plain', 'html', 'structured_note']),
  attachmentVersionIds: communicationUuidListSchema.default([]),
};

function validateInternalCommunication(
  input: {
    channel: z.infer<typeof communicationChannelSchema>;
    confidentiality: z.infer<typeof communicationConfidentialitySchema>;
    participants: Array<z.infer<typeof communicationParticipantSchema>>;
  },
  context: z.RefinementCtx,
): void {
  if (input.channel !== 'internal') return;
  if (!['internal', 'privileged'].includes(input.confidentiality)) {
    context.addIssue({
      code: 'custom',
      path: ['confidentiality'],
      message: 'Internal communications must use internal or privileged confidentiality.',
    });
  }
  if (input.participants.some(({ endpointType }) => endpointType !== 'user')) {
    context.addIssue({
      code: 'custom',
      path: ['participants'],
      message: 'Internal communications can only address firm users.',
    });
  }
}

export const recordCommunicationSchema = z
  .object({
    idempotencyKey: communicationIdempotencyKeySchema,
    ...communicationContentFields,
    direction: communicationDirectionSchema,
    occurredAt: z.string().datetime({ offset: true }),
    source: z.enum(['manual', 'provider', 'import', 'system']),
    providerKey: z.string().trim().min(1).max(80).nullable(),
    externalMessageId: z.string().trim().min(1).max(500).nullable(),
    externalThreadId: z.string().trim().min(1).max(500).nullable(),
    conversationId: z.string().uuid().nullable().optional().default(null),
    supersedesEntryId: z.string().uuid().nullable(),
    correctionReason: z.string().trim().max(2_000).default(''),
  })
  .strict()
  .superRefine((input, context) => {
    validateInternalCommunication(input, context);
    if (input.channel === 'internal' && input.direction !== 'internal') {
      context.addIssue({
        code: 'custom',
        path: ['direction'],
        message: 'Internal communications must use internal direction.',
      });
    }
    if (input.supersedesEntryId && input.correctionReason.length < 10) {
      context.addIssue({
        code: 'custom',
        path: ['correctionReason'],
        message: 'A correction reason of at least 10 characters is required.',
      });
    }
  });

export const createCommunicationDraftSchema = z
  .object({ ...communicationContentFields, conversationId: z.string().uuid().nullable().optional().default(null) })
  .strict()
  .superRefine(validateInternalCommunication);

export const appendCommunicationDraftVersionSchema = z
  .object({ expectedVersion: z.number().int().positive(), ...communicationContentFields })
  .strict()
  .superRefine(validateInternalCommunication);

export const submitCommunicationDraftSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: communicationIdempotencyKeySchema,
    note: z.string().trim().min(10).max(2_000),
  })
  .strict();

export const decideCommunicationDraftSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    draftVersionId: z.string().uuid(),
    idempotencyKey: communicationIdempotencyKeySchema,
    decision: z.enum(['approved', 'rejected', 'approval_revoked']),
    note: z.string().trim().min(10).max(2_000),
  })
  .strict();

export const dispatchCommunicationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: communicationIdempotencyKeySchema,
    providerKey: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(80),
    confirmed: z.literal(true),
  })
  .strict();

export const recordCommunicationProviderEventSchema = z
  .object({
    providerEventId: z.string().trim().min(1).max(500),
    eventType: z.enum([
      'queued',
      'attempting',
      'provider_accepted',
      'delivered',
      'failed',
      'read',
      'cancelled',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    signature: z.string().trim().min(8).max(500),
    safePayload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const recordCommunicationCallSchema = z
  .object({
    idempotencyKey: communicationIdempotencyKeySchema,
    channel: z.enum(['telephone', 'whatsapp']),
    confidentiality: communicationConfidentialitySchema,
    direction: z.enum(['inbound', 'outbound']),
    participants: z.array(communicationParticipantSchema).min(1).max(25),
    occurredAt: z.string().datetime({ offset: true }),
    subject: z.string().trim().max(500).default(''),
    body: z.string().trim().min(1).max(100_000),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    purpose: z.string().trim().min(3).max(2_000),
    outcome: z.string().trim().min(3).max(4_000),
    identityCheckStatus: z.enum(['not_recorded', 'confirmed', 'failed']),
    identityCheckNote: z.string().trim().max(2_000).default(''),
    recordingStatus: z.enum([
      'not_recorded',
      'notice_given',
      'consent_recorded',
      'recorded',
      'unavailable',
    ]),
    noticeConsentBasis: z.string().trim().max(2_000).default(''),
    attachmentVersionIds: communicationUuidListSchema.default([]),
    recordingVersionIds: communicationUuidListSchema.default([]),
    transcriptVersionIds: communicationUuidListSchema.default([]),
    callNoteVersionIds: communicationUuidListSchema.default([]),
    providerKey: z.string().trim().min(1).max(80).nullable().optional().default(null),
    externalCallId: z.string().trim().min(1).max(500).nullable().optional().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Date(input.endedAt) < new Date(input.startedAt)) {
      context.addIssue({ code: 'custom', path: ['endedAt'], message: 'The call end cannot precede its start.' });
    }
    if (
      input.recordingVersionIds.length > 0 &&
      !['notice_given', 'consent_recorded', 'recorded'].includes(input.recordingStatus)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordingStatus'],
        message: 'A recording artifact requires notice or consent metadata.',
      });
    }
    if (
      ['notice_given', 'consent_recorded', 'recorded'].includes(input.recordingStatus) &&
      input.noticeConsentBasis.length < 10
    ) {
      context.addIssue({
        code: 'custom',
        path: ['noticeConsentBasis'],
        message: 'Record the notice or consent basis.',
      });
    }
  });

const negotiationUuidSchema = z.string().uuid();
const negotiationNullableUuidSchema = negotiationUuidSchema.nullable();
const negotiationIdempotencyKeySchema = z.string().trim().min(8).max(200);
const negotiationMoneySchema = z.number().int().nonnegative().safe();
const negotiationNullableMoneySchema = negotiationMoneySchema.nullable();
const negotiationDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const negotiationConfidentialitySchema = z.enum([
  'ordinary',
  'privileged',
  'protected_negotiation',
]);

const negotiationRecipientSchema = z.object({
  displayName: z.string().trim().min(2).max(240),
  endpointType: z.enum(['email', 'whatsapp', 'postal_address', 'portal', 'other']),
  endpoint: z.string().trim().min(3).max(1_000),
}).strict();

export const createNegotiationReviewSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  confidentiality: negotiationConfidentialitySchema,
  reviewedOn: negotiationDateSchema,
  reviewerUserId: negotiationNullableUuidSchema,
  selectedOfferIds: z.array(negotiationUuidSchema).max(100).default([]),
  lossScheduleId: negotiationNullableUuidSchema,
  generalDamagesReviewId: negotiationNullableUuidSchema,
  workScheduleId: negotiationNullableUuidSchema,
  confirmedFacts: z.string().trim().min(10).max(12_000),
  optionsExplained: z.string().trim().min(10).max(12_000),
  riskAnalysis: z.string().trim().min(10).max(12_000),
  costsFundingExplanation: z.string().trim().min(10).max(8_000),
  humanRecommendation: z.string().trim().max(8_000).default(''),
  adviceLimitations: z.string().trim().min(10).max(8_000),
  clientQuestions: z.string().trim().max(8_000).default(''),
  supersedesReviewId: negotiationNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
}).strict().superRefine((input, context) => {
  if (input.supersedesReviewId && input.correctionReason.length < 10) {
    context.addIssue({
      code: 'custom',
      path: ['correctionReason'],
      message: 'A superseding review requires a correction reason.',
    });
  }
});

export const recordClientInstructionSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  confidentiality: negotiationConfidentialitySchema,
  reviewId: negotiationNullableUuidSchema,
  actionId: negotiationNullableUuidSchema,
  actionVersionId: negotiationNullableUuidSchema,
  settlementId: negotiationNullableUuidSchema.optional(),
  settlementTermsVersionId: negotiationNullableUuidSchema.optional(),
  instructionType: z.enum([
    'accept',
    'reject',
    'counter',
    'clarify',
    'continue_negotiation',
    'issue_proceedings',
    'agree_terms',
    'other',
  ]),
  instructingPerson: z.string().trim().min(2).max(240),
  relationshipToClient: z.string().trim().min(2).max(240),
  authorityBasis: z.string().trim().min(10).max(4_000),
  decisionNote: z.string().trim().min(10).max(8_000),
  receivedMethod: z.enum(['in_person', 'telephone', 'video', 'email', 'letter', 'portal', 'other']),
  receivedAt: z.string().datetime({ offset: true }),
  identityStatus: z.enum(['confirmed', 'failed', 'not_required_reviewed']),
  identityNote: z.string().trim().min(10).max(2_000),
  understandingConfirmed: z.boolean(),
  accessibilityMeasures: z.string().trim().min(5).max(4_000),
  sourceCommunicationEntryId: negotiationNullableUuidSchema,
  sourceDocumentVersionId: negotiationNullableUuidSchema,
  supersedesInstructionId: negotiationNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitClientInstruction: z.literal(true),
}).strict().superRefine((input, context) => {
  if (Boolean(input.actionId) !== Boolean(input.actionVersionId)) {
    context.addIssue({
      code: 'custom',
      path: ['actionVersionId'],
      message: 'An action instruction must identify both the action and exact version.',
    });
  }
  if (Boolean(input.settlementId) !== Boolean(input.settlementTermsVersionId)) {
    context.addIssue({
      code: 'custom',
      path: ['settlementTermsVersionId'],
      message: 'A settlement instruction must identify both the settlement and exact terms version.',
    });
  }
  if (input.actionId && input.settlementId) {
    context.addIssue({
      code: 'custom',
      path: ['settlementId'],
      message: 'Record action and settlement instructions separately.',
    });
  }
  if (!input.sourceCommunicationEntryId && !input.sourceDocumentVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['sourceCommunicationEntryId'],
      message: 'Retain the communication or document evidencing the instruction.',
    });
  }
  if (!input.understandingConfirmed) {
    context.addIssue({
      code: 'custom',
      path: ['understandingConfirmed'],
      message: 'Record instructions only after understanding has been checked.',
    });
  }
  if (input.supersedesInstructionId && input.correctionReason.length < 10) {
    context.addIssue({
      code: 'custom',
      path: ['correctionReason'],
      message: 'A superseding instruction requires a correction reason.',
    });
  }
});

const negotiationActionTypeSchema = z.enum([
  'make_offer',
  'counteroffer',
  'accept',
  'reject',
  'withdraw',
  'clarify',
  'record_agreement',
]);

export const createSettlementAuthorityVersionSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  source: z.enum(['client_specific', 'retainer', 'firm_policy', 'court_or_representative', 'other']),
  scope: z.string().trim().min(10).max(4_000),
  actionTypes: z.array(negotiationActionTypeSchema).min(1).max(20),
  minimumAmountMinor: negotiationNullableMoneySchema,
  maximumAmountMinor: negotiationNullableMoneySchema,
  nonMoneyConstraints: z.string().trim().max(4_000).default(''),
  costsConstraints: z.string().trim().max(4_000).default(''),
  repairConstraints: z.string().trim().max(4_000).default(''),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  reviewOn: negotiationDateSchema.nullable(),
  requiresClientInstruction: z.boolean(),
  requiresPartnerApproval: z.boolean(),
  sourceDocumentVersionId: negotiationNullableUuidSchema,
  reviewNote: z.string().trim().min(10).max(4_000),
}).strict().superRefine((input, context) => {
  if (
    input.minimumAmountMinor !== null &&
    input.maximumAmountMinor !== null &&
    input.maximumAmountMinor < input.minimumAmountMinor
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maximumAmountMinor'],
      message: 'The maximum authority cannot be below the minimum.',
    });
  }
});

const negotiationActionFields = {
  actionType: negotiationActionTypeSchema,
  linkedOfferId: negotiationNullableUuidSchema,
  confidentiality: negotiationConfidentialitySchema,
  recipients: z.array(negotiationRecipientSchema).min(1).max(100),
  scope: z.enum(['whole_claim', 'part_of_claim', 'issue', 'costs_only', 'works_only']),
  scopeDescription: z.string().trim().min(10).max(4_000),
  damagesMinor: negotiationNullableMoneySchema,
  costsMinor: negotiationNullableMoneySchema,
  totalMinor: negotiationNullableMoneySchema,
  currency: z.literal('GBP'),
  worksTerms: z.string().trim().max(8_000).default(''),
  nonMoneyTerms: z.string().trim().max(8_000).default(''),
  interestTreatment: z.string().trim().max(4_000).default(''),
  confidentialityTerms: z.string().trim().max(4_000).default(''),
  paymentTerms: z.string().trim().max(4_000).default(''),
  proposedInstrumentType: z.enum([
    'part36_acceptance',
    'consent_order',
    'tomlin_order',
    'settlement_agreement',
    'deed',
    'oral_recorded',
    'other',
  ]),
  documentVersionIds: z.array(negotiationUuidSchema).max(100).default([]),
};

export const createNegotiationActionSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  ...negotiationActionFields,
}).strict();

export const appendNegotiationActionVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  changeReason: z.string().trim().min(10).max(2_000),
  ...negotiationActionFields,
}).strict();

export const submitNegotiationActionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: negotiationIdempotencyKeySchema,
  actionVersionId: negotiationUuidSchema,
  clientInstructionId: negotiationUuidSchema,
  authorityVersionId: negotiationUuidSchema,
  note: z.string().trim().min(10).max(2_000),
}).strict();

export const decideNegotiationActionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: negotiationIdempotencyKeySchema,
  actionVersionId: negotiationUuidSchema,
  clientInstructionId: negotiationUuidSchema,
  authorityVersionId: negotiationUuidSchema,
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().min(10).max(2_000),
}).strict();

export const recordNegotiationExternalActionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: negotiationIdempotencyKeySchema,
  actionVersionId: negotiationUuidSchema,
  occurredAt: z.string().datetime({ offset: true }),
  method: z.enum(['email', 'whatsapp', 'letter', 'portal', 'telephone', 'in_person', 'other']),
  recipient: z.string().trim().min(2).max(1_000),
  sourceCommunicationEntryId: negotiationNullableUuidSchema,
  sourceDocumentVersionId: negotiationNullableUuidSchema,
  factualNote: z.string().trim().min(10).max(4_000),
  explicitConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (!input.sourceCommunicationEntryId && !input.sourceDocumentVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['sourceCommunicationEntryId'],
      message: 'An external action requires a retained communication or document source.',
    });
  }
});

export const createSettlementSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  settlementType: z.enum([
    'part36_acceptance',
    'consent_order',
    'tomlin_order',
    'settlement_agreement',
    'deed',
    'oral_recorded',
    'other',
  ]),
  scope: z.enum(['whole_claim', 'part_of_claim', 'issue', 'costs_only', 'works_only']),
  confidentiality: negotiationConfidentialitySchema,
  originatingActionId: negotiationNullableUuidSchema,
  linkedOfferId: negotiationNullableUuidSchema,
  clientInstructionId: negotiationUuidSchema,
  title: z.string().trim().min(5).max(240),
}).strict();

const settlementTermsFields = {
  damagesMinor: negotiationNullableMoneySchema,
  costsMinor: negotiationNullableMoneySchema,
  totalMinor: negotiationNullableMoneySchema,
  currency: z.literal('GBP'),
  paymentMethod: z.string().trim().max(240).default(''),
  paymentDueAt: z.string().datetime({ offset: true }).nullable(),
  repairTerms: z.string().trim().max(12_000).default(''),
  accessTerms: z.string().trim().max(8_000).default(''),
  inspectionTerms: z.string().trim().max(8_000).default(''),
  liabilityAdmissionPosition: z.string().trim().max(4_000).default(''),
  interestTerms: z.string().trim().max(4_000).default(''),
  confidentialityTerms: z.string().trim().max(8_000).default(''),
  disposalTerms: z.string().trim().max(8_000).default(''),
  enforcementTerms: z.string().trim().max(8_000).default(''),
  otherTerms: z.string().trim().max(12_000).default(''),
  sourceDocumentVersionIds: z.array(negotiationUuidSchema).max(100).default([]),
  reviewNote: z.string().trim().min(10).max(4_000),
};

export const appendSettlementTermsSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: negotiationIdempotencyKeySchema,
  changeReason: z.string().trim().min(10).max(2_000),
  ...settlementTermsFields,
}).strict();

export const concludeSettlementSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: negotiationIdempotencyKeySchema,
  termsVersionId: negotiationUuidSchema,
  clientInstructionId: negotiationUuidSchema,
  courtApprovalPosition: z.enum(['unknown', 'not_required_reviewed', 'required', 'obtained']),
  instrumentDocumentVersionId: negotiationNullableUuidSchema,
  sourceCommunicationEntryId: negotiationNullableUuidSchema,
  conclusionNote: z.string().trim().min(10).max(4_000),
  obligationsReviewed: z.literal(true),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.courtApprovalPosition === 'unknown' || input.courtApprovalPosition === 'required') {
    context.addIssue({
      code: 'custom',
      path: ['courtApprovalPosition'],
      message: 'The court approval position must be reviewed and any required approval obtained.',
    });
  }
  if (!input.instrumentDocumentVersionId && !input.sourceCommunicationEntryId) {
    context.addIssue({
      code: 'custom',
      path: ['instrumentDocumentVersionId'],
      message: 'Retain the settlement instrument or source communication.',
    });
  }
});

export const createSettlementObligationSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  settlementTermsVersionId: negotiationUuidSchema,
  obligationType: z.enum([
    'payment', 'costs', 'repair', 'access', 'inspection',
    'document', 'filing', 'confidentiality', 'other',
  ]),
  responsibleParty: z.string().trim().min(2).max(500),
  beneficiary: z.string().trim().min(2).max(500),
  description: z.string().trim().min(10).max(8_000),
  amountMinor: negotiationNullableMoneySchema,
  dueAt: z.string().datetime({ offset: true }).nullable(),
  timezone: z.string().trim().min(3).max(100),
  evidenceRequirement: z.string().trim().min(5).max(4_000),
}).strict();

export const recordSettlementObligationEventSchema = z.object({
  idempotencyKey: negotiationIdempotencyKeySchema,
  eventType: z.enum([
    'due_confirmed', 'performance_asserted', 'part_satisfied', 'satisfied',
    'overdue_reviewed', 'disputed', 'waived', 'corrected',
  ]),
  occurredAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(10).max(4_000),
  amountSatisfiedMinor: negotiationNullableMoneySchema,
  evidenceDocumentVersionIds: z.array(negotiationUuidSchema).max(100).default([]),
  evidenceCommunicationEntryIds: z.array(negotiationUuidSchema).max(100).default([]),
  supersedesEventId: negotiationNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  waiverAuthorityDocumentVersionId: negotiationNullableUuidSchema,
  explicitConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (
    input.eventType === 'satisfied' &&
    input.evidenceDocumentVersionIds.length === 0 &&
    input.evidenceCommunicationEntryIds.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['evidenceDocumentVersionIds'],
      message: 'Satisfied obligations require retained evidence.',
    });
  }
  if (input.eventType === 'waived' && !input.waiverAuthorityDocumentVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['waiverAuthorityDocumentVersionId'],
      message: 'A waiver requires a retained authority source.',
    });
  }
  if (input.eventType === 'corrected' && !input.supersedesEventId) {
    context.addIssue({
      code: 'custom',
      path: ['supersedesEventId'],
      message: 'A correction must identify the corrected event.',
    });
  }
  if (input.supersedesEventId && input.correctionReason.length < 10) {
    context.addIssue({
      code: 'custom',
      path: ['correctionReason'],
      message: 'A correction reason of at least 10 characters is required.',
    });
  }
});

const proceedingsUuidSchema = z.string().uuid();
const proceedingsNullableUuidSchema = proceedingsUuidSchema.nullable();
const proceedingsCommandKeySchema = z.string().trim().min(8).max(200);
const proceedingsDateTimeSchema = z.string().datetime({ offset: true });
const proceedingsEvidenceFields = {
  evidenceDocumentVersionIds: z.array(proceedingsUuidSchema).max(100).default([]),
  evidenceFilingIds: z.array(proceedingsUuidSchema).max(100).default([]),
  evidenceServiceRecordIds: z.array(proceedingsUuidSchema).max(100).default([]),
};

export const proceedingProcedureTypeSchema = z.enum(['part7', 'part8']);
export const proceedingEventTypeSchema = z.enum([
  'authority_recorded', 'issue_request_prepared', 'issue_request_submitted',
  'issued', 'case_number_corrected', 'transferred', 'allocated', 'stayed',
  'restored', 'discontinued', 'dismissed', 'judgment_entered',
  'closed_by_court', 'disposal_position_reviewed', 'correction',
]);

export const createProceedingSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  procedureType: proceedingProcedureTypeSchema,
  jurisdiction: z.literal('england_wales'),
  courtName: z.string().trim().min(2).max(300),
  courtCode: z.string().trim().max(80).nullable(),
  hearingCentre: z.string().trim().max(300).nullable(),
}).strict();

export const createProceedingAuthorityVersionSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  clientInstructionId: proceedingsUuidSchema,
  procedureType: proceedingProcedureTypeSchema,
  scope: z.string().trim().min(10).max(8_000),
  defendantPartyIds: z.array(proceedingsUuidSchema).min(1).max(50),
  claimFormDocumentVersionId: proceedingsUuidSchema,
  particularsDocumentVersionId: proceedingsNullableUuidSchema,
  preparedByUserId: proceedingsUuidSchema,
  approvedByUserId: proceedingsUuidSchema,
  limitationPosition: z.string().trim().min(10).max(4_000),
  risks: z.string().trim().min(10).max(8_000),
  reviewNote: z.string().trim().min(10).max(4_000),
  expiresAt: proceedingsDateTimeSchema.nullable(),
  reviewOn: z.iso.date().nullable(),
  explicitApproval: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.preparedByUserId === input.approvedByUserId) {
    context.addIssue({
      code: 'custom', path: ['approvedByUserId'],
      message: 'Issue authority requires independent review of the exact claim documents.',
    });
  }
  if (input.procedureType === 'part7' && !input.particularsDocumentVersionId) {
    context.addIssue({
      code: 'custom', path: ['particularsDocumentVersionId'],
      message: 'Part 7 issue authority must identify the exact particulars version.',
    });
  }
});

export const recordProceedingEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: proceedingsCommandKeySchema,
  eventType: proceedingEventTypeSchema,
  occurredAt: proceedingsDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
  sourceDocumentVersionId: proceedingsNullableUuidSchema,
  courtName: z.string().trim().max(300).default(''),
  caseNumber: z.string().trim().max(120).default(''),
  track: z.enum(['small_claims', 'fast', 'intermediate', 'multi']).nullable(),
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'issued') {
    if (!input.sourceDocumentVersionId) context.addIssue({ code: 'custom', path: ['sourceDocumentVersionId'], message: 'Issue requires the retained sealed claim form.' });
    if (!input.courtName) context.addIssue({ code: 'custom', path: ['courtName'], message: 'Issue requires the issuing court.' });
    if (!input.caseNumber) context.addIssue({ code: 'custom', path: ['caseNumber'], message: 'Issue requires the court case number.' });
  }
  if (input.eventType === 'correction' && !input.supersedesEventId) {
    context.addIssue({ code: 'custom', path: ['supersedesEventId'], message: 'A correction must identify the corrected event.' });
  }
  if (input.supersedesEventId && input.correctionReason.length < 10) {
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'A correction reason of at least 10 characters is required.' });
  }
});

export const createCourtFilingSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  purpose: z.string().trim().min(5).max(2_000),
  documentVersionIds: z.array(proceedingsUuidSchema).min(1).max(100),
  submissionChannel: z.enum(['manual', 'email', 'post', 'portal', 'ce_file', 'my_hmcts', 'other']),
  feePosition: z.enum(['not_applicable', 'due', 'paid', 'remission_requested', 'remitted', 'unknown']),
  feeMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).default('GBP'),
}).strict();

export const recordCourtFilingEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: proceedingsCommandKeySchema,
  eventType: z.enum(['prepared', 'submitted', 'acknowledged', 'accepted', 'rejected', 'withdrawn', 'corrected']),
  occurredAt: proceedingsDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
  receiptDocumentVersionId: proceedingsNullableUuidSchema,
  externalReference: z.string().trim().max(500).nullable(),
  rejectionReason: z.string().trim().max(4_000).default(''),
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (['submitted', 'acknowledged', 'accepted', 'rejected'].includes(input.eventType) && !input.receiptDocumentVersionId && !input.externalReference) {
    context.addIssue({ code: 'custom', path: ['receiptDocumentVersionId'], message: 'External filing states require a retained receipt or reference.' });
  }
});

export const createCourtServiceRecordSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  courtDocumentVersionId: proceedingsUuidSchema,
  recipientPartyId: proceedingsUuidSchema,
  method: z.enum(['first_class_post', 'document_exchange', 'personal', 'hand_delivery', 'email', 'electronic', 'court_service', 'other']),
  serviceAddress: z.string().trim().min(3).max(2_000),
  jurisdictionPosition: z.enum(['within_jurisdiction', 'outside_jurisdiction', 'unknown']),
}).strict();

export const recordCourtServiceEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: proceedingsCommandKeySchema,
  eventType: z.enum(['prepared', 'step_completed', 'delivery_evidence_received', 'returned', 'disputed', 'human_reviewed', 'set_aside', 'corrected']),
  occurredAt: proceedingsDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
  preciseStep: z.string().trim().max(2_000).default(''),
  assertedServiceAt: proceedingsDateTimeSchema.nullable(),
  assertedDeemedServiceAt: proceedingsDateTimeSchema.nullable(),
  reviewPosition: z.enum(['unreviewed', 'reviewed', 'disputed', 'superseded']),
  ruleSourceTitle: z.string().trim().max(500).default(''),
  ruleSourceUrl: z.url().or(z.literal('')),
  evidenceDocumentVersionIds: z.array(proceedingsUuidSchema).max(100).default([]),
  evidenceCommunicationEntryIds: z.array(proceedingsUuidSchema).max(100).default([]),
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'step_completed' && input.preciseStep.length < 5) {
    context.addIssue({ code: 'custom', path: ['preciseStep'], message: 'Record the precise service step completed.' });
  }
  if (input.eventType === 'human_reviewed') {
    if (!input.assertedServiceAt || !input.ruleSourceTitle || !input.ruleSourceUrl) context.addIssue({ code: 'custom', path: ['ruleSourceTitle'], message: 'A service review requires dates and a retained rule source.' });
    if (!input.evidenceDocumentVersionIds.length && !input.evidenceCommunicationEntryIds.length) context.addIssue({ code: 'custom', path: ['evidenceDocumentVersionIds'], message: 'A service review requires retained evidence.' });
  }
});

export const createCourtApplicationSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  applicantPartyId: proceedingsUuidSchema,
  respondentPartyIds: z.array(proceedingsUuidSchema).max(50),
  requestedOrder: z.string().trim().min(10).max(8_000),
  groundsSummary: z.string().trim().min(10).max(8_000),
  noticePosition: z.enum(['on_notice', 'without_notice', 'court_dispensed', 'unknown']),
  hearingRequiredPosition: z.enum(['requested', 'not_requested', 'court_to_determine']),
  applicationNoticeVersionId: proceedingsUuidSchema,
  evidenceDocumentVersionIds: z.array(proceedingsUuidSchema).max(100),
  draftOrderVersionId: proceedingsNullableUuidSchema,
}).strict();

export const recordCourtApplicationEventSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: proceedingsCommandKeySchema,
  eventType: z.enum(['prepared', 'filed', 'served', 'listed', 'granted', 'refused', 'withdrawn', 'disposed', 'corrected']),
  occurredAt: proceedingsDateTimeSchema, note: z.string().trim().min(10).max(4_000),
  sourceDocumentVersionId: proceedingsNullableUuidSchema,
  resultingOrderId: proceedingsNullableUuidSchema,
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'granted' && !input.resultingOrderId) context.addIssue({ code: 'custom', path: ['resultingOrderId'], message: 'A granted application requires the resulting sealed order.' });
});

export const createCourtOrderSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  orderType: z.enum(['directions', 'allocation', 'interim', 'consent', 'judgment', 'disposal', 'costs', 'relief', 'other']),
  title: z.string().trim().min(5).max(500),
  orderDate: z.iso.date(),
  takesEffectAt: proceedingsDateTimeSchema,
  judgeName: z.string().trim().max(300).default(''),
  judicialTitle: z.string().trim().max(300).default(''),
  sealedDocumentVersionId: proceedingsNullableUuidSchema,
  variesOrderId: proceedingsNullableUuidSchema,
  supersedesOrderId: proceedingsNullableUuidSchema,
  servicePosition: z.enum(['court_to_serve', 'party_to_serve', 'served', 'unknown']),
  explicitSealedConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (!input.sealedDocumentVersionId) context.addIssue({ code: 'custom', path: ['sealedDocumentVersionId'], message: 'An operative order requires the exact retained sealed document.' });
});

export const createCourtDirectionSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  sourceOrderId: proceedingsNullableUuidSchema,
  ruleSourceTitle: z.string().trim().max(500).default(''),
  ruleSourceUrl: z.url().or(z.literal('')),
  responsiblePartyId: proceedingsUuidSchema,
  category: z.enum(['disclosure', 'witness_evidence', 'expert_evidence', 'bundle', 'costs', 'application', 'payment', 'filing', 'service', 'hearing_preparation', 'other']),
  requirementText: z.string().trim().min(10).max(8_000),
  dueAt: proceedingsDateTimeSchema.nullable(),
  timezone: z.string().trim().min(3).max(100),
  sanctionExpresslyStated: z.boolean(),
  sanctionText: z.string().trim().max(4_000).default(''),
  assignedUserId: proceedingsNullableUuidSchema,
}).strict().superRefine((input, context) => {
  if (!input.sourceOrderId && (!input.ruleSourceTitle || !input.ruleSourceUrl)) context.addIssue({ code: 'custom', path: ['sourceOrderId'], message: 'A direction requires a sealed order or explicit rule source.' });
  if (input.sanctionExpresslyStated && input.sanctionText.length < 5) context.addIssue({ code: 'custom', path: ['sanctionText'], message: 'Record the expressly stated sanction text.' });
});

export const recordCourtDirectionEventSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: proceedingsCommandKeySchema,
  eventType: z.enum(['created', 'assigned', 'performance_asserted', 'evidence_linked', 'satisfied', 'disputed', 'extended', 'stayed', 'resumed', 'relief_applied', 'relief_granted', 'relief_refused', 'waived_by_order', 'superseded', 'corrected']),
  occurredAt: proceedingsDateTimeSchema, note: z.string().trim().min(10).max(4_000),
  ...proceedingsEvidenceFields,
  sourceOrderId: proceedingsNullableUuidSchema,
  revisedDueAt: proceedingsDateTimeSchema.nullable(),
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'satisfied' && !input.evidenceDocumentVersionIds.length && !input.evidenceFilingIds.length && !input.evidenceServiceRecordIds.length) context.addIssue({ code: 'custom', path: ['evidenceDocumentVersionIds'], message: 'Satisfied directions require retained performance evidence.' });
  if (['waived_by_order', 'relief_granted', 'relief_refused', 'extended', 'stayed'].includes(input.eventType) && !input.sourceOrderId) context.addIssue({ code: 'custom', path: ['sourceOrderId'], message: 'This court outcome requires a retained sealed order.' });
});

export const createCourtHearingSchema = z.object({
  idempotencyKey: proceedingsCommandKeySchema,
  hearingType: z.enum(['case_management', 'application', 'directions', 'pre_trial_review', 'trial', 'judgment', 'costs', 'other']),
  title: z.string().trim().min(5).max(500),
  listingNoticeVersionId: proceedingsUuidSchema,
  startsAt: proceedingsDateTimeSchema,
  endsAt: proceedingsDateTimeSchema.nullable(),
  timezone: z.string().trim().min(3).max(100),
  courtName: z.string().trim().min(2).max(300),
  venue: z.string().trim().max(1_000).default(''),
  attendanceMode: z.enum(['in_person', 'telephone', 'video', 'hybrid', 'to_be_confirmed']),
  remoteAccessDetails: z.string().trim().max(4_000).default(''),
  privacyPosition: z.enum(['public', 'private_ordered', 'part_private', 'to_be_determined']),
  judgeName: z.string().trim().max(300).default(''),
  advocateNames: z.array(z.string().trim().min(2).max(300)).max(30).default([]),
  attendeeNames: z.array(z.string().trim().min(2).max(300)).max(100).default([]),
  bundleDocumentVersionId: proceedingsNullableUuidSchema,
}).strict();

export const recordCourtHearingEventSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: proceedingsCommandKeySchema,
  eventType: z.enum(['listed', 'relisted', 'adjourned', 'vacated', 'started', 'completed', 'outcome_recorded', 'corrected']),
  occurredAt: proceedingsDateTimeSchema, note: z.string().trim().min(10).max(8_000),
  sourceDocumentVersionId: proceedingsNullableUuidSchema,
  resultingOrderId: proceedingsNullableUuidSchema,
  revisedStartsAt: proceedingsDateTimeSchema.nullable(),
  supersedesEventId: proceedingsNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
  explicitHumanConfirmation: z.literal(true),
}).strict();

const pleadingUuidSchema = z.string().uuid();
const pleadingNullableUuidSchema = pleadingUuidSchema.nullable();
const pleadingCommandKeySchema = z.string().trim().min(8).max(200);
const pleadingDateTimeSchema = z.string().datetime({ offset: true });

export const procedureRegimeSchema = z.enum([
  'part_7_domestic', 'part_7_service_out', 'part_8',
  'court_directed', 'manual_review',
]);
export const statementTypeSchema = z.enum([
  'claim_form', 'particulars', 'acknowledgment_of_service', 'defence',
  'reply', 'counterclaim', 'defence_to_counterclaim',
  'part_8_acknowledgment', 'amended_statement', 'other',
]);
export const statementOfTruthStatusSchema = z.enum([
  'not_applicable', 'required_unconfirmed', 'present_unsigned', 'signed',
  'defective_or_disputed', 'not_reviewed',
]);
export const responsePositionSchema = z.enum([
  'defend_all', 'defend_part', 'admit_all', 'admit_part',
  'jurisdiction_challenged', 'counterclaim_included', 'not_recorded',
]);
export const amendmentRouteSchema = z.enum([
  'before_service', 'written_consent', 'court_permission',
  'court_direction', 'not_applicable',
]);
export const statementEventTypeSchema = z.enum([
  'prepared', 'approved_for_filing', 'filed', 'provider_acknowledged',
  'court_accepted', 'served', 'rejected', 'withdrawn', 'corrected',
  'superseded', 'permission_granted', 'permission_refused',
]);
export const deadlineOutcomeSchema = z.enum([
  'projected', 'source_date', 'manual_court_period_required',
  'blocked_missing_facts', 'superseded',
]);
export const defaultReviewOutcomeSchema = z.enum([
  'review_incomplete', 'blockers_recorded', 'human_review_completed',
]);

export const createResponseTrackSchema = z.object({
  idempotencyKey: pleadingCommandKeySchema,
  claimantPartyId: pleadingUuidSchema,
  defendantPartyId: pleadingUuidSchema,
  claimFormDocumentVersionId: pleadingUuidSchema,
  particularsDocumentVersionId: pleadingNullableUuidSchema,
  regime: procedureRegimeSchema,
  serviceRecordId: pleadingNullableUuidSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict();

export const createStatementVersionSchema = z.object({
  idempotencyKey: pleadingCommandKeySchema,
  statementType: statementTypeSchema,
  partyId: pleadingUuidSchema,
  documentVersionId: pleadingUuidSchema,
  predecessorVersionId: pleadingNullableUuidSchema,
  preparedByUserId: pleadingUuidSchema,
  statementOfTruthStatus: statementOfTruthStatusSchema,
  signatoryName: z.string().trim().max(300).default(''),
  signatoryCapacity: z.string().trim().max(300).default(''),
  signedAt: pleadingDateTimeSchema.nullable(),
  responsePosition: responsePositionSchema,
  amendmentRoute: amendmentRouteSchema,
  amendmentReason: z.string().trim().max(4_000).default(''),
}).strict().superRefine((input, context) => {
  if (input.statementOfTruthStatus === 'signed' &&
      (!input.signatoryName || !input.signatoryCapacity || !input.signedAt)) {
    context.addIssue({ code: 'custom', path: ['signatoryName'], message: 'Signed statements require signatory name, capacity and signed time.' });
  }
});

export const recordStatementEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: pleadingCommandKeySchema,
  eventType: statementEventTypeSchema,
  occurredAt: pleadingDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
  filingId: pleadingNullableUuidSchema,
  serviceRecordId: pleadingNullableUuidSchema,
  sourceDocumentVersionId: pleadingNullableUuidSchema,
  supersedesEventId: pleadingNullableUuidSchema,
  correctionReason: z.string().trim().max(2_000).default(''),
}).strict().superRefine((input, context) => {
  if (['filed', 'provider_acknowledged', 'court_accepted', 'rejected'].includes(input.eventType) && !input.filingId) {
    context.addIssue({ code: 'custom', path: ['filingId'], message: 'This event requires an exact filing record.' });
  }
  if (input.eventType === 'served' && !input.serviceRecordId) {
    context.addIssue({ code: 'custom', path: ['serviceRecordId'], message: 'Service requires an exact service record.' });
  }
  if (input.eventType === 'corrected' && (!input.supersedesEventId || input.correctionReason.length < 10)) {
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'A correction requires the superseded event and reason.' });
  }
});

export const reviewPleadingDeadlineSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: pleadingCommandKeySchema,
  kind: z.enum(['acknowledgment', 'defence', 'reply', 'counterclaim_response', 'amended_statement_filing', 'amended_statement_service']),
  outcome: deadlineOutcomeSchema,
  triggerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  projectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceDocumentVersionId: pleadingNullableUuidSchema,
  ruleKey: z.string().trim().max(100).default(''),
  ruleVersion: z.string().trim().max(100).default(''),
  sourceTitle: z.string().trim().max(500).default(''),
  sourceUrl: z.url().or(z.literal('')),
  reviewedAt: pleadingDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict().superRefine((input, context) => {
  if (input.outcome === 'source_date' && (!input.projectedDate || !input.sourceDocumentVersionId)) {
    context.addIssue({ code: 'custom', path: ['sourceDocumentVersionId'], message: 'A source date requires the exact source and date.' });
  }
});

export const recordAmendmentAuthoritySchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: pleadingCommandKeySchema,
  route: amendmentRouteSchema.exclude(['not_applicable']),
  consentDocumentVersionId: pleadingNullableUuidSchema,
  applicationId: pleadingNullableUuidSchema,
  sealedOrderId: pleadingNullableUuidSchema,
  reviewedAt: pleadingDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict().superRefine((input, context) => {
  if (input.route === 'written_consent' && !input.consentDocumentVersionId) context.addIssue({ code: 'custom', path: ['consentDocumentVersionId'], message: 'Written consent source is required.' });
  if (input.route === 'court_permission' && (!input.applicationId || !input.sealedOrderId)) context.addIssue({ code: 'custom', path: ['sealedOrderId'], message: 'Court permission requires the application and sealed order.' });
  if (input.route === 'court_direction' && !input.sealedOrderId) context.addIssue({ code: 'custom', path: ['sealedOrderId'], message: 'Court direction requires a sealed order.' });
});

export const createDefaultReviewSchema = z.object({
  idempotencyKey: pleadingCommandKeySchema,
  statementVersionId: pleadingNullableUuidSchema,
  deadlineProjectionId: pleadingNullableUuidSchema,
  claimType: z.string().trim().min(2).max(300),
  requestedMethod: z.string().trim().min(2).max(300),
  note: z.string().trim().min(10).max(4_000),
}).strict();

export const completeDefaultReviewSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: pleadingCommandKeySchema,
  outcome: defaultReviewOutcomeSchema,
  reviewedAt: pleadingDateTimeSchema,
  blockers: z.array(z.string().trim().min(3).max(1_000)).max(30),
  note: z.string().trim().min(10).max(4_000),
}).strict().superRefine((input, context) => {
  if (input.outcome === 'blockers_recorded' && input.blockers.length === 0) context.addIssue({ code: 'custom', path: ['blockers'], message: 'Record at least one blocker.' });
  if (input.outcome === 'human_review_completed' && input.blockers.length > 0) context.addIssue({ code: 'custom', path: ['blockers'], message: 'Resolve or record blockers before completing review.' });
});

const disclosureUuidSchema = z.uuid();
const disclosureNullableUuidSchema = disclosureUuidSchema.nullable();
const disclosureCommandKeySchema = z.string().trim().min(8).max(200);
const disclosureDateTimeSchema = z.string().datetime({ offset: true });

export const disclosureDecisionSchema = z.enum([
  'disclose', 'withhold_privilege', 'withhold_not_relevant',
  'withhold_other', 'duplicate_only', 'review_required',
]);
export const disclosurePrivilegeCategorySchema = z.enum([
  'legal_advice', 'litigation', 'joint', 'without_prejudice_or_protected',
  'other', 'none', 'uncertain',
]);
export const disclosurePrivilegeOutcomeSchema = z.enum([
  'restricted', 'not_privileged', 'further_review', 'waived',
]);

export const openDisclosureReviewSchema = z.object({
  idempotencyKey: disclosureCommandKeySchema,
  disclosingPartyId: disclosureUuidSchema,
  directionId: disclosureNullableUuidSchema,
  scopeNote: z.string().trim().min(20).max(8_000),
  dateFrom: z.string().date().nullable(),
  dateTo: z.string().date().nullable(),
  custodians: z.array(z.string().trim().min(1).max(300)).max(100),
  issueTags: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

export const addDisclosureCandidateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  documentVersionId: disclosureUuidSchema,
  evidenceItemId: disclosureNullableUuidSchema,
  custodian: z.string().trim().max(300),
  sourceNote: z.string().trim().min(10).max(4_000),
}).strict();

export const createDisclosureAiSuggestionSchema = z.object({
  idempotencyKey: disclosureCommandKeySchema,
  relevance: z.enum(['likely_relevant', 'likely_not_relevant', 'uncertain']),
  privilegeWarning: z.enum(['none', 'possible', 'likely']),
  rationale: z.string().trim().min(10).max(2_000),
  model: z.string().trim().min(2).max(120),
  policyVersion: z.string().trim().min(2).max(120),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  citedSpans: z.array(z.string().trim().min(1).max(500)).max(20),
  suggestedIssueTags: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

export const recordDisclosureDecisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  decision: disclosureDecisionSchema,
  reason: z.string().trim().min(20).max(4_000),
  redactionRequired: z.boolean(),
  reviewedAt: disclosureDateTimeSchema,
}).strict();

export const recordDisclosurePrivilegeReviewSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  category: disclosurePrivilegeCategorySchema,
  outcome: disclosurePrivilegeOutcomeSchema,
  basis: z.string().trim().min(20).max(4_000),
  authorityDocumentVersionId: disclosureNullableUuidSchema,
  confirmExposure: z.boolean(),
  reviewedAt: disclosureDateTimeSchema,
}).strict().superRefine((input, context) => {
  if (input.outcome === 'waived' && !input.confirmExposure) {
    context.addIssue({ code: 'custom', path: ['confirmExposure'], message: 'Privilege waiver requires explicit exposure confirmation.' });
  }
});

export const approveDisclosureRedactionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  redactedDocumentVersionId: disclosureUuidSchema,
  categories: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  reason: z.string().trim().min(20).max(4_000),
  visualReviewConfirmed: z.literal(true),
  reviewedAt: disclosureDateTimeSchema,
}).strict();

export const generateDisclosureListSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  title: z.string().trim().min(3).max(500),
  generatedAt: disclosureDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict();

export const createInspectionRequestSchema = z.object({
  idempotencyKey: disclosureCommandKeySchema,
  disclosureListId: disclosureUuidSchema,
  requestingPartyId: disclosureUuidSchema,
  entryIds: z.array(disclosureUuidSchema).min(1).max(500),
  receivedAt: disclosureDateTimeSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict();

export const recordInspectionEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: disclosureCommandKeySchema,
  eventType: z.enum(['received', 'acknowledged', 'refused', 'agreed', 'provided', 'completed']),
  occurredAt: disclosureDateTimeSchema,
  providedDocumentVersionId: disclosureNullableUuidSchema,
  deliveryEvidenceDocumentVersionId: disclosureNullableUuidSchema,
  note: z.string().trim().min(10).max(4_000),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'provided' && !input.providedDocumentVersionId && !input.deliveryEvidenceDocumentVersionId) {
    context.addIssue({ code: 'custom', path: ['providedDocumentVersionId'], message: 'Provision requires exact document or delivery evidence.' });
  }
});

const financeUuidSchema = z.uuid();
const financeNullableUuidSchema = financeUuidSchema.nullable();
const financeCommandKeySchema = z.string().trim().min(8).max(200);
const financeMoneySchema = z.number().int().safe();
const financeNonNegativeMoneySchema = financeMoneySchema.nonnegative();
const financeDateTimeSchema = z.string().datetime({ offset: true });
const financeCurrencySchema = z.literal('GBP');

export const decideFinanceActivitySuggestionSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  decision: z.enum(['accept', 'edit', 'split', 'reject']),
  reason: z.string().trim().min(5).max(2_000),
}).strict();
export const startFinanceTimerSchema = z.object({
  idempotencyKey: financeCommandKeySchema,
  activityCode: z.string().trim().min(2).max(100), costsPhase: z.string().trim().min(2).max(100),
  narrative: z.string().trim().min(5).max(2_000),
}).strict();
export const stopFinanceTimerSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
}).strict();
export const submitFinanceTimeSchema = z.object({
  idempotencyKey: financeCommandKeySchema, workDate: z.iso.date(),
  minutes: z.number().int().safe().positive().max(24 * 60),
  narrative: z.string().trim().min(10).max(4_000),
  activityCode: z.string().trim().min(2).max(100), costsPhase: z.string().trim().min(2).max(100),
  chargeable: z.boolean(), sourceKind: z.enum(['manual', 'timer', 'task', 'communication_call', 'document_version', 'filing', 'hearing']),
  sourceId: financeNullableUuidSchema,
}).strict();
export const approveFinanceTimeSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  approvedAt: financeDateTimeSchema, approvalNote: z.string().trim().min(10).max(2_000),
  explicitHumanApproval: z.literal(true),
}).strict();
export const reverseFinanceTimeSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  reason: z.string().trim().min(10).max(2_000), replacementEntryId: financeNullableUuidSchema,
  reversedAt: financeDateTimeSchema, explicitHumanApproval: z.literal(true),
}).strict();
export const createFinanceRateCardSchema = z.object({
  idempotencyKey: financeCommandKeySchema, name: z.string().trim().min(3).max(300),
  description: z.string().trim().min(10).max(2_000), currency: financeCurrencySchema,
}).strict();
export const addFinanceRateVersionSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().nullable(),
  entries: z.array(z.object({ grade: z.string().trim().min(1).max(100), userId: financeNullableUuidSchema,
    activityCode: z.string().trim().max(100), matterId: financeNullableUuidSchema,
    hourlyRateMinor: financeNonNegativeMoneySchema, currency: financeCurrencySchema }).strict()).min(1).max(500),
  note: z.string().trim().min(10).max(2_000),
}).strict();
export const activateFinanceRateVersionSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  rateVersionId: financeUuidSchema, approvedAt: financeDateTimeSchema,
  approvalNote: z.string().trim().min(10).max(2_000), explicitHumanApproval: z.literal(true),
}).strict();
export const createFinanceEstimateVersionSchema = z.object({
  idempotencyKey: financeCommandKeySchema, effectiveOn: z.iso.date(),
  scope: z.string().trim().min(10).max(4_000), feesMinor: financeNonNegativeMoneySchema,
  disbursementsMinor: financeNonNegativeMoneySchema, vatMinor: financeNonNegativeMoneySchema,
  overallLimitMinor: financeNonNegativeMoneySchema, currency: financeCurrencySchema,
  reviewOn: z.iso.date().nullable(), sourceDocumentVersionId: financeNullableUuidSchema,
  approvalNote: z.string().trim().min(10).max(2_000), explicitApproval: z.literal(true),
}).strict();
export const recordFinanceWarningEventSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  eventType: z.enum(['reviewed', 'client_notified']),
  occurredAt: financeDateTimeSchema, evidenceDocumentVersionId: financeNullableUuidSchema,
  note: z.string().trim().min(10).max(2_000),
}).strict();
export const createFinanceDisbursementSchema = z.object({
  idempotencyKey: financeCommandKeySchema, supplier: z.string().trim().min(2).max(300),
  invoiceReference: z.string().trim().max(200), category: z.string().trim().min(2).max(100),
  description: z.string().trim().min(10).max(4_000), netMinor: financeNonNegativeMoneySchema,
  vatMinor: financeNonNegativeMoneySchema, grossMinor: financeNonNegativeMoneySchema,
  currency: financeCurrencySchema, invoiceDate: z.iso.date().nullable(), dueOn: z.iso.date().nullable(),
  sourceDocumentVersionId: financeNullableUuidSchema,
}).strict().superRefine((input, context) => {
  if (input.netMinor + input.vatMinor !== input.grossMinor)
    context.addIssue({ code: 'custom', path: ['grossMinor'], message: 'Gross amount must equal net plus VAT.' });
});
export const recordFinanceDisbursementEventSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  eventType: z.enum(['approved', 'incurred', 'paid_external', 'cancelled', 'corrected']),
  occurredAt: financeDateTimeSchema, evidenceDocumentVersionId: financeNullableUuidSchema,
  note: z.string().trim().min(10).max(2_000),
}).strict().superRefine((input, context) => {
  if (input.eventType === 'paid_external' && !input.evidenceDocumentVersionId)
    context.addIssue({ code: 'custom', path: ['evidenceDocumentVersionId'], message: 'External payment requires exact retained evidence.' });
});
const financeJournalLineSchema = z.object({
  accountId: financeUuidSchema, debitMinor: financeNonNegativeMoneySchema,
  creditMinor: financeNonNegativeMoneySchema, currency: financeCurrencySchema,
  matterId: financeNullableUuidSchema, memo: z.string().trim().min(2).max(500),
}).strict().refine((line) => (line.debitMinor > 0) !== (line.creditMinor > 0), { message: 'Each journal line requires exactly one positive side.' });
export const prepareFinanceJournalSchema = z.object({
  idempotencyKey: financeCommandKeySchema, accountingDate: z.iso.date(),
  sourceKind: z.enum(['wip_control', 'disbursement_control', 'reversal', 'other']),
  sourceId: financeUuidSchema, description: z.string().trim().min(10).max(2_000),
  lines: z.array(financeJournalLineSchema).min(2).max(100),
}).strict();
export const approveFinanceJournalSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  approvedAt: financeDateTimeSchema, note: z.string().trim().min(10).max(2_000),
  explicitHumanApproval: z.literal(true),
}).strict();
export const postFinanceJournalSchema = z.object({
  expectedVersion: z.number().int().positive(), idempotencyKey: financeCommandKeySchema,
  postedAt: financeDateTimeSchema, explicitHumanConfirmation: z.literal(true),
}).strict();
export const reverseFinanceJournalSchema = z.object({
  idempotencyKey: financeCommandKeySchema, accountingDate: z.iso.date(),
  reason: z.string().trim().min(10).max(2_000), explicitHumanApproval: z.literal(true),
}).strict();

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
export type CommunicationChannel = z.infer<typeof communicationChannelSchema>;
export type CommunicationConfidentiality = z.infer<typeof communicationConfidentialitySchema>;
export type CommunicationDirection = z.infer<typeof communicationDirectionSchema>;
export type CommunicationParticipantInput = z.infer<typeof communicationParticipantSchema>;
export type RecordCommunicationInput = z.infer<typeof recordCommunicationSchema>;
export type CreateCommunicationDraftInput = z.infer<typeof createCommunicationDraftSchema>;
export type AppendCommunicationDraftVersionInput = z.infer<typeof appendCommunicationDraftVersionSchema>;
export type SubmitCommunicationDraftInput = z.infer<typeof submitCommunicationDraftSchema>;
export type DecideCommunicationDraftInput = z.infer<typeof decideCommunicationDraftSchema>;
export type DispatchCommunicationInput = z.infer<typeof dispatchCommunicationSchema>;
export type RecordCommunicationProviderEventInput = z.infer<typeof recordCommunicationProviderEventSchema>;
export type RecordCommunicationCallInput = z.infer<typeof recordCommunicationCallSchema>;
export type CreateNegotiationReviewInput = z.infer<typeof createNegotiationReviewSchema>;
export type RecordClientInstructionInput = z.infer<typeof recordClientInstructionSchema>;
export type CreateSettlementAuthorityVersionInput = z.infer<typeof createSettlementAuthorityVersionSchema>;
export type CreateNegotiationActionInput = z.infer<typeof createNegotiationActionSchema>;
export type AppendNegotiationActionVersionInput = z.infer<typeof appendNegotiationActionVersionSchema>;
export type SubmitNegotiationActionInput = z.infer<typeof submitNegotiationActionSchema>;
export type DecideNegotiationActionInput = z.infer<typeof decideNegotiationActionSchema>;
export type RecordNegotiationExternalActionInput = z.infer<typeof recordNegotiationExternalActionSchema>;
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
export type AppendSettlementTermsInput = z.infer<typeof appendSettlementTermsSchema>;
export type ConcludeSettlementInput = z.infer<typeof concludeSettlementSchema>;
export type CreateSettlementObligationInput = z.infer<typeof createSettlementObligationSchema>;
export type RecordSettlementObligationEventInput = z.infer<typeof recordSettlementObligationEventSchema>;
export type CreateProceedingInput = z.infer<typeof createProceedingSchema>;
export type CreateProceedingAuthorityVersionInput = z.infer<typeof createProceedingAuthorityVersionSchema>;
export type RecordProceedingEventInput = z.infer<typeof recordProceedingEventSchema>;
export type CreateCourtFilingInput = z.infer<typeof createCourtFilingSchema>;
export type RecordCourtFilingEventInput = z.infer<typeof recordCourtFilingEventSchema>;
export type CreateCourtServiceRecordInput = z.infer<typeof createCourtServiceRecordSchema>;
export type RecordCourtServiceEventInput = z.infer<typeof recordCourtServiceEventSchema>;
export type CreateCourtApplicationInput = z.infer<typeof createCourtApplicationSchema>;
export type RecordCourtApplicationEventInput = z.infer<typeof recordCourtApplicationEventSchema>;
export type CreateCourtOrderInput = z.infer<typeof createCourtOrderSchema>;
export type CreateCourtDirectionInput = z.infer<typeof createCourtDirectionSchema>;
export type RecordCourtDirectionEventInput = z.infer<typeof recordCourtDirectionEventSchema>;
export type CreateCourtHearingInput = z.infer<typeof createCourtHearingSchema>;
export type RecordCourtHearingEventInput = z.infer<typeof recordCourtHearingEventSchema>;
export type CreateResponseTrackInput = z.infer<typeof createResponseTrackSchema>;
export type CreateStatementVersionInput = z.infer<typeof createStatementVersionSchema>;
export type RecordStatementEventInput = z.infer<typeof recordStatementEventSchema>;
export type ReviewPleadingDeadlineInput = z.infer<typeof reviewPleadingDeadlineSchema>;
export type RecordAmendmentAuthorityInput = z.infer<typeof recordAmendmentAuthoritySchema>;
export type CreateDefaultReviewInput = z.infer<typeof createDefaultReviewSchema>;
export type CompleteDefaultReviewInput = z.infer<typeof completeDefaultReviewSchema>;
export type OpenDisclosureReviewInput = z.infer<typeof openDisclosureReviewSchema>;
export type AddDisclosureCandidateInput = z.infer<typeof addDisclosureCandidateSchema>;
export type CreateDisclosureAiSuggestionInput = z.infer<typeof createDisclosureAiSuggestionSchema>;
export type RecordDisclosureDecisionInput = z.infer<typeof recordDisclosureDecisionSchema>;
export type RecordDisclosurePrivilegeReviewInput = z.infer<typeof recordDisclosurePrivilegeReviewSchema>;
export type ApproveDisclosureRedactionInput = z.infer<typeof approveDisclosureRedactionSchema>;
export type GenerateDisclosureListInput = z.infer<typeof generateDisclosureListSchema>;
export type CreateInspectionRequestInput = z.infer<typeof createInspectionRequestSchema>;
export type RecordInspectionEventInput = z.infer<typeof recordInspectionEventSchema>;
export type DecideFinanceActivitySuggestionInput = z.infer<typeof decideFinanceActivitySuggestionSchema>;
export type StartFinanceTimerInput = z.infer<typeof startFinanceTimerSchema>;
export type StopFinanceTimerInput = z.infer<typeof stopFinanceTimerSchema>;
export type SubmitFinanceTimeInput = z.infer<typeof submitFinanceTimeSchema>;
export type ApproveFinanceTimeInput = z.infer<typeof approveFinanceTimeSchema>;
export type ReverseFinanceTimeInput = z.infer<typeof reverseFinanceTimeSchema>;
export type CreateFinanceRateCardInput = z.infer<typeof createFinanceRateCardSchema>;
export type AddFinanceRateVersionInput = z.infer<typeof addFinanceRateVersionSchema>;
export type ActivateFinanceRateVersionInput = z.infer<typeof activateFinanceRateVersionSchema>;
export type CreateFinanceEstimateVersionInput = z.infer<typeof createFinanceEstimateVersionSchema>;
export type RecordFinanceWarningEventInput = z.infer<typeof recordFinanceWarningEventSchema>;
export type CreateFinanceDisbursementInput = z.infer<typeof createFinanceDisbursementSchema>;
export type RecordFinanceDisbursementEventInput = z.infer<typeof recordFinanceDisbursementEventSchema>;
export type PrepareFinanceJournalInput = z.infer<typeof prepareFinanceJournalSchema>;
export type ApproveFinanceJournalInput = z.infer<typeof approveFinanceJournalSchema>;
export type PostFinanceJournalInput = z.infer<typeof postFinanceJournalSchema>;
export type ReverseFinanceJournalInput = z.infer<typeof reverseFinanceJournalSchema>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
