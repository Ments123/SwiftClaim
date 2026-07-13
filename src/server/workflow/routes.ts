import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import {
  confirmWorkflowTriggerSchema,
  transitionWorkflowSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { WorkflowError, type WorkflowErrorCode, WorkflowService } from './service.js';

export interface WorkflowRoutesOptions {
  service: WorkflowService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

const STATUS_BY_CODE: Record<WorkflowErrorCode, 403 | 404 | 409 | 422> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  READINESS_BLOCKED: 409,
  CONFLICT: 409,
  RULE_NOT_FOUND: 422,
};

function workflowErrorReply(error: unknown, reply: FastifyReply) {
  if (!(error instanceof WorkflowError)) {
    throw error;
  }
  const body: {
    error: { code: WorkflowErrorCode; message: string };
    details?: Record<string, unknown>;
  } = {
    error: { code: error.code, message: error.message },
  };
  if (Object.keys(error.details).length > 0) {
    body.details = error.details;
  }
  return reply.status(STATUS_BY_CODE[error.code]).send(body);
}

export const workflowRoutes: FastifyPluginAsync<WorkflowRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/matters/:id/summary', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      return options.service.getMatter360(user, id);
    } catch (error) {
      return workflowErrorReply(error, reply);
    }
  });

  app.post(
    '/api/matters/:id/workflow/transitions',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { id } = request.params as { id: string };
        const input = transitionWorkflowSchema.parse(request.body);
        return options.service.transitionStage(
          user,
          id,
          input,
          options.auditContext(request),
        );
      } catch (error) {
        return workflowErrorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:id/workflow/triggers', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { id } = request.params as { id: string };
      const input = confirmWorkflowTriggerSchema.parse(request.body);
      return options.service.confirmTrigger(
        user,
        id,
        input,
        options.auditContext(request),
      );
    } catch (error) {
      return workflowErrorReply(error, reply);
    }
  });
};
