import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  approveLossScheduleSchema,
  approveWorkScheduleSchema,
  createGeneralDamagesReviewSchema,
  createLossItemSchema,
  createLossScheduleSchema,
  createOfferSchema,
  createRepairEventSchema,
  createWorkScheduleSchema,
  recordOfferEventSchema,
  reviewPart36Schema,
  updateLossItemSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { QuantumError, QuantumService } from './service.js';

export interface QuantumRoutesOptions {
  service: QuantumService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidQuantumCommand extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'InvalidQuantumCommand';
  }
}

function parseCommand<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) {
    throw new InvalidQuantumCommand(
      result.error.issues[0]?.message ?? 'The repairs and quantum command is invalid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

function quantumErrorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidQuantumCommand) {
    return reply.status(422).send({
      error: {
        code: 'QUANTUM_INVALID',
        message: error.message,
        fields: error.fields,
      },
    });
  }
  if (!(error instanceof QuantumError)) throw error;
  const status =
    error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'FORBIDDEN'
        ? 403
        : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code)
          ? 409
          : 422;
  return reply.status(status).send({
    error: { code: error.code, message: error.message },
  });
}

export const quantumRoutes: FastifyPluginAsync<QuantumRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/matters/:matterId/repairs-quantum', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      return options.service.getWorkspace(user, matterId);
    } catch (error) {
      return quantumErrorReply(error, reply);
    }
  });

  app.get('/api/matters/:matterId/offers/protected', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      return { offers: options.service.getProtectedOffers(user, matterId) };
    } catch (error) {
      return quantumErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/work-schedules', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createWorkScheduleSchema, request.body);
      const schedule = options.service.createWorkSchedule(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ schedule });
    } catch (error) {
      return quantumErrorReply(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/work-schedules/:scheduleId/approve',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, scheduleId } = request.params as {
          matterId: string;
          scheduleId: string;
        };
        const command = parseCommand(approveWorkScheduleSchema, request.body);
        return {
          schedule: options.service.approveWorkSchedule(
            user,
            matterId,
            scheduleId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.patch(
    '/api/matters/:matterId/loss-schedules/:scheduleId/items/:itemId',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, scheduleId, itemId } = request.params as {
          matterId: string;
          scheduleId: string;
          itemId: string;
        };
        const command = parseCommand(updateLossItemSchema, request.body);
        return {
          schedule: options.service.updateLossItem(
            user,
            matterId,
            scheduleId,
            itemId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/work-items/:workItemId/events',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, workItemId } = request.params as {
          matterId: string;
          workItemId: string;
        };
        const command = parseCommand(createRepairEventSchema, request.body);
        const repairEvent = options.service.recordRepairEvent(
          user,
          matterId,
          workItemId,
          command,
          options.auditContext(request),
        );
        return reply.status(201).send({ repairEvent });
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/loss-schedules', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createLossScheduleSchema, request.body);
      const schedule = options.service.createLossSchedule(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ schedule });
    } catch (error) {
      return quantumErrorReply(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/loss-schedules/:scheduleId/items',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, scheduleId } = request.params as {
          matterId: string;
          scheduleId: string;
        };
        const command = parseCommand(createLossItemSchema, request.body);
        const schedule = options.service.addLossItem(
          user,
          matterId,
          scheduleId,
          command,
          options.auditContext(request),
        );
        return reply.status(201).send({ schedule });
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/loss-schedules/:scheduleId/approve',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, scheduleId } = request.params as {
          matterId: string;
          scheduleId: string;
        };
        const command = parseCommand(approveLossScheduleSchema, request.body);
        return {
          schedule: options.service.approveLossSchedule(
            user,
            matterId,
            scheduleId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/general-damages-reviews',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId } = request.params as { matterId: string };
        const command = parseCommand(createGeneralDamagesReviewSchema, request.body);
        const review = options.service.createGeneralDamagesReview(
          user,
          matterId,
          command,
          options.auditContext(request),
        );
        return reply.status(201).send({ review });
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/offers', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createOfferSchema, request.body);
      const offer = options.service.createOffer(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ offer });
    } catch (error) {
      return quantumErrorReply(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/offers/:offerId/events',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, offerId } = request.params as {
          matterId: string;
          offerId: string;
        };
        const command = parseCommand(recordOfferEventSchema, request.body);
        const offer = options.service.recordOfferEvent(
          user,
          matterId,
          offerId,
          command,
          options.auditContext(request),
        );
        return reply.status(201).send({ offer });
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/offers/:offerId/part-36-review',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, offerId } = request.params as {
          matterId: string;
          offerId: string;
        };
        const command = parseCommand(reviewPart36Schema, request.body);
        return {
          offer: options.service.reviewPart36(
            user,
            matterId,
            offerId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return quantumErrorReply(error, reply);
      }
    },
  );
};
