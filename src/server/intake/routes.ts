import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import {
  convertEnquirySchema,
  createEnquirySchema,
  decideEnquirySchema,
  recordConflictDecisionSchema,
  saveAssessmentSchema,
  saveOnboardingSchema,
  updateEnquirySchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  IntakeConflictError,
  IntakeConflictService,
} from './conflicts.js';
import { IntakeService, IntakeServiceError } from './service.js';
import {
  IntakeStateConflictError,
  IntakeStore,
  IntakeStoreError,
} from './store.js';

export interface IntakeRoutesOptions {
  store: IntakeStore;
  service: IntakeService;
  conflicts: IntakeConflictService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  blockers?: unknown[],
) {
  const body: {
    error: { code: string; message: string };
    details?: { blockers: unknown[] };
  } = { error: { code, message } };
  if (blockers) body.details = { blockers };
  return reply.status(statusCode).send(body);
}

function intakeErrorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof IntakeStateConflictError) {
    return sendError(
      reply,
      409,
      'CONFLICT',
      'The enquiry was changed by another request. Refresh and try again.',
    );
  }
  if (error instanceof IntakeServiceError) {
    const statusByCode = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      VALIDATION_ERROR: 400,
      READINESS_BLOCKED: 409,
      IDEMPOTENCY_CONFLICT: 409,
      INVALID_STATUS: 409,
      TERMINAL: 409,
    } as const;
    return sendError(
      reply,
      statusByCode[error.code],
      error.code,
      error.message,
      error.blockers,
    );
  }
  if (error instanceof IntakeConflictError) {
    const statusByCode = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT_REVIEW_REQUIRED: 409,
      STALE_CHECK: 409,
      VALIDATION_ERROR: 400,
    } as const;
    return sendError(
      reply,
      statusByCode[error.code],
      error.code,
      error.message,
    );
  }
  if (error instanceof IntakeStoreError) {
    if (error.code === 'NOT_FOUND') {
      return sendError(
        reply,
        404,
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }
    if (error.code === 'FORBIDDEN') {
      return sendError(
        reply,
        403,
        'FORBIDDEN',
        'You do not have permission to access intake records.',
      );
    }
    const conflictCodes = new Set([
      'INVALID_STATUS',
      'TERMINAL',
      'IDEMPOTENCY_CONFLICT',
    ]);
    return sendError(
      reply,
      conflictCodes.has(error.code) ? 409 : 400,
      error.code,
      error.code === 'SUPERVISOR_NOT_FOUND'
        ? 'Select an active partner-level supervisor from this firm.'
        : 'The selected firm user is not available.',
    );
  }
  throw error;
}

const emptyCommandSchema = z.object({}).strict();

export const intakeRoutes: FastifyPluginAsync<IntakeRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/enquiries', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      return { enquiries: options.store.listEnquiries(user) };
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.post('/api/enquiries', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const input = createEnquirySchema.parse(request.body);
      const enquiry = options.store.createEnquiry(
        user,
        input,
        options.auditContext(request),
      );
      return reply.status(201).send({ enquiry });
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.get('/api/enquiries/:id', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      return options.service.getWorkspace(user, id);
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.patch('/api/enquiries/:id', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = updateEnquirySchema.parse(request.body);
      return {
        enquiry: options.store.updateEnquiry(
          user,
          id,
          input,
          options.auditContext(request),
        ),
      };
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.post('/api/enquiries/:id/conflict-checks', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      emptyCommandSchema.parse(request.body ?? {});
      const check = options.conflicts.runCheck(
        user,
        id,
        options.auditContext(request),
      );
      return reply.status(201).send({ check });
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.post('/api/enquiries/:id/conflict-decisions', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = recordConflictDecisionSchema.parse(request.body);
      const decision = options.conflicts.recordDecision(
        user,
        id,
        input,
        options.auditContext(request),
      );
      return reply.status(201).send({ decision });
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.put('/api/enquiries/:id/assessment', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = saveAssessmentSchema.parse(request.body);
      return options.service.saveAssessment(
        user,
        id,
        input,
        options.auditContext(request),
      );
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.put('/api/enquiries/:id/onboarding', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = saveOnboardingSchema.parse(request.body);
      return options.service.saveOnboarding(
        user,
        id,
        input,
        options.auditContext(request),
      );
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.post('/api/enquiries/:id/decisions', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = decideEnquirySchema.parse(request.body);
      return options.service.decideEnquiry(
        user,
        id,
        input,
        options.auditContext(request),
      );
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.post('/api/enquiries/:id/convert', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = convertEnquirySchema.parse(request.body);
      const conversion = options.service.convertEnquiry(
        user,
        id,
        input,
        options.auditContext(request),
      );
      return reply.status(conversion.replayed ? 200 : 201).send(conversion);
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });

  app.get('/api/matters/:id/intake-profile', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const profile = options.store.getMatterIntakeProfile(user, id);
      if (!profile) {
        return sendError(
          reply,
          404,
          'NOT_FOUND',
          'The requested resource was not found.',
        );
      }
      return { profile };
    } catch (error) {
      return intakeErrorReply(error, reply);
    }
  });
};
