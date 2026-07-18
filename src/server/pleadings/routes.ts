import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  createResponseTrackSchema,
  createStatementVersionSchema,
  recordStatementEventSchema,
  recordAmendmentAuthoritySchema,
  createDefaultReviewSchema,
  completeDefaultReviewSchema,
  reviewPleadingDeadlineSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { PleadingsService, PleadingsServiceError } from './service.js';

export interface PleadingsRoutesOptions {
  service: PleadingsService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidPleadingsCommand extends Error {
  constructor(readonly fields: Record<string, string[] | undefined>) {
    super('Check the pleading command fields and try again.');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidPleadingsCommand(result.error.flatten().fieldErrors);
  return result.data;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidPleadingsCommand) {
    return reply.status(400).send({ error: {
      code: 'PLEADINGS_INVALID', message: error.message, fields: error.fields,
    } });
  }
  if (!(error instanceof PleadingsServiceError)) throw error;
  const status = error.code === 'NOT_FOUND' ? 404
    : error.code === 'FORBIDDEN' ? 403
      : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code) ? 409 : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const pleadingsRoutes: FastifyPluginAsync<PleadingsRoutesOptions> = async (app, options) => {
  app.get('/api/matters/:matterId/proceedings/:proceedingId/pleadings', async (request, reply) => {
    try {
      const { matterId, proceedingId } = request.params as { matterId: string; proceedingId: string };
      return options.service.getWorkspace(options.requireUser(request), matterId, proceedingId);
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/tracks', async (request, reply) => {
    try {
      const { matterId, proceedingId } = request.params as { matterId: string; proceedingId: string };
      const track = options.service.openTrack(
        options.requireUser(request), matterId, proceedingId,
        parse(createResponseTrackSchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ track });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/tracks/:trackId/statements', async (request, reply) => {
    try {
      const { matterId, proceedingId, trackId } = request.params as {
        matterId: string; proceedingId: string; trackId: string;
      };
      const statement = options.service.createStatementVersion(
        options.requireUser(request), matterId, proceedingId, trackId,
        parse(createStatementVersionSchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ statement });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/statements/:statementId/events', async (request, reply) => {
    try {
      const { matterId, proceedingId, statementId } = request.params as {
        matterId: string; proceedingId: string; statementId: string;
      };
      const statement = options.service.recordStatementEvent(
        options.requireUser(request), matterId, proceedingId, statementId,
        parse(recordStatementEventSchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ statement });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/statement-versions/:statementVersionId/amendment-authority', async (request, reply) => {
    try {
      const { matterId, proceedingId, statementVersionId } = request.params as {
        matterId: string; proceedingId: string; statementVersionId: string;
      };
      const authority = options.service.recordAmendmentAuthority(
        options.requireUser(request), matterId, proceedingId, statementVersionId,
        parse(recordAmendmentAuthoritySchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ authority });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/tracks/:trackId/default-reviews', async (request, reply) => {
    try {
      const { matterId, proceedingId, trackId } = request.params as {
        matterId: string; proceedingId: string; trackId: string;
      };
      const review = options.service.createDefaultReview(
        options.requireUser(request), matterId, proceedingId, trackId,
        parse(createDefaultReviewSchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ review });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/default-reviews/:reviewId/complete', async (request, reply) => {
    try {
      const { matterId, proceedingId, reviewId } = request.params as {
        matterId: string; proceedingId: string; reviewId: string;
      };
      const review = options.service.completeDefaultReview(
        options.requireUser(request), matterId, proceedingId, reviewId,
        parse(completeDefaultReviewSchema, request.body), options.auditContext(request),
      );
      return reply.status(200).send({ review });
    } catch (error) { return failure(error, reply); }
  });

  app.post('/api/matters/:matterId/proceedings/:proceedingId/pleadings/tracks/:trackId/deadline-reviews', async (request, reply) => {
    try {
      const { matterId, proceedingId, trackId } = request.params as {
        matterId: string; proceedingId: string; trackId: string;
      };
      const deadline = options.service.reviewDeadline(
        options.requireUser(request), matterId, proceedingId, trackId,
        parse(reviewPleadingDeadlineSchema, request.body), options.auditContext(request),
      );
      return reply.status(201).send({ deadline });
    } catch (error) { return failure(error, reply); }
  });
};
