import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  appendNegotiationActionVersionSchema,
  appendSettlementTermsSchema,
  concludeSettlementSchema,
  createNegotiationActionSchema,
  createNegotiationReviewSchema,
  createSettlementAuthorityVersionSchema,
  createSettlementObligationSchema,
  createSettlementSchema,
  decideNegotiationActionSchema,
  recordClientInstructionSchema,
  recordNegotiationExternalActionSchema,
  recordSettlementObligationEventSchema,
  submitNegotiationActionSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { NegotiationService, NegotiationServiceError } from './service.js';

export interface NegotiationRoutesOptions {
  service: NegotiationService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidNegotiationCommand extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'InvalidNegotiationCommand';
  }
}

function parseCommand<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) {
    throw new InvalidNegotiationCommand(
      result.error.issues[0]?.message ?? 'The negotiation command is invalid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

function errorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidNegotiationCommand) {
    return reply.status(400).send({
      error: {
        code: 'NEGOTIATION_INVALID',
        message: error.message,
        fields: error.fields,
      },
    });
  }
  if (!(error instanceof NegotiationServiceError)) throw error;
  const status = error.code === 'NOT_FOUND'
    ? 404
    : error.code === 'FORBIDDEN'
      ? 403
      : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code)
        ? 409
        : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const negotiationRoutes: FastifyPluginAsync<NegotiationRoutesOptions> = async (
  app,
  options,
) => {
  const audit = (request: FastifyRequest) => options.auditContext(request);
  const context = (request: FastifyRequest) => {
    const user = options.requireUser(request);
    const { matterId } = request.params as { matterId: string };
    return { user, matterId };
  };

  app.get('/api/matters/:matterId/negotiation-settlement', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      return options.service.getWorkspace(user, matterId);
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.get('/api/matters/:matterId/negotiation-settlement/protected', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      return options.service.getProtectedWorkspace(user, matterId);
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-reviews', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const input = parseCommand(createNegotiationReviewSchema, request.body);
      return reply.status(201).send({ review: options.service.createReview(user, matterId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/client-instructions', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const input = parseCommand(recordClientInstructionSchema, request.body);
      return reply.status(201).send({ instruction: options.service.recordInstruction(user, matterId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlement-authority-versions', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const input = parseCommand(createSettlementAuthorityVersionSchema, request.body);
      return reply.status(201).send({ authority: options.service.createAuthorityVersion(user, matterId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-actions', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const input = parseCommand(createNegotiationActionSchema, request.body);
      return reply.status(201).send({ action: options.service.createAction(user, matterId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-actions/:actionId/versions', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { actionId } = request.params as { actionId: string };
      const input = parseCommand(appendNegotiationActionVersionSchema, request.body);
      return reply.status(201).send({ action: options.service.appendActionVersion(user, matterId, actionId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-actions/:actionId/submit', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { actionId } = request.params as { actionId: string };
      const input = parseCommand(submitNegotiationActionSchema, request.body);
      return { action: options.service.submitAction(user, matterId, actionId, input, audit(request)) };
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-actions/:actionId/decisions', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { actionId } = request.params as { actionId: string };
      const input = parseCommand(decideNegotiationActionSchema, request.body);
      return { action: options.service.decideAction(user, matterId, actionId, input, audit(request)) };
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/negotiation-actions/:actionId/external-acts', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { actionId } = request.params as { actionId: string };
      const input = parseCommand(recordNegotiationExternalActionSchema, request.body);
      return reply.status(201).send({ action: options.service.recordExternalAction(user, matterId, actionId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlements', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const input = parseCommand(createSettlementSchema, request.body);
      return reply.status(201).send({ settlement: options.service.createSettlement(user, matterId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlements/:settlementId/terms', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { settlementId } = request.params as { settlementId: string };
      const input = parseCommand(appendSettlementTermsSchema, request.body);
      return reply.status(201).send({ settlement: options.service.appendSettlementTerms(user, matterId, settlementId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlements/:settlementId/conclude', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { settlementId } = request.params as { settlementId: string };
      const input = parseCommand(concludeSettlementSchema, request.body);
      return { settlement: options.service.concludeSettlement(user, matterId, settlementId, input, audit(request)) };
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlements/:settlementId/obligations', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { settlementId } = request.params as { settlementId: string };
      const input = parseCommand(createSettlementObligationSchema, request.body);
      return reply.status(201).send({ obligation: options.service.createObligation(user, matterId, settlementId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/settlement-obligations/:obligationId/events', async (request, reply) => {
    try {
      const { user, matterId } = context(request);
      const { obligationId } = request.params as { obligationId: string };
      const input = parseCommand(recordSettlementObligationEventSchema, request.body);
      return reply.status(201).send({ obligation: options.service.recordObligationEvent(user, matterId, obligationId, input, audit(request)) });
    } catch (error) {
      return errorReply(error, reply);
    }
  });
};
