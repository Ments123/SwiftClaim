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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}
