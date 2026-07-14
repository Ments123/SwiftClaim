import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  approveExpertInstructionSchema,
  approveLetterOfClaimSchema,
  createExpertEngagementSchema,
  recordExpertConflictCheckSchema,
  recordExpertMilestoneSchema,
  recordExpertQuestionAnswerSchema,
  recordExpertQuestionSchema,
  recordExpertReportSchema,
  recordLandlordResponseSchema,
  recordProtocolServiceEventSchema,
  saveLetterOfClaimSchema,
  selectExpertRouteSchema,
  updateExpertEngagementSchema,
  varyProtocolDeadlineSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import { openStoredFile } from '../storage.js';
import type { AuditContext } from '../store.js';
import { ProtocolError, ProtocolService } from './service.js';
import { ProtocolStore } from './store.js';

export interface ProtocolRoutesOptions {
  service: ProtocolService;
  store: ProtocolStore;
  storagePath: string;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidProtocolCommand extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'InvalidProtocolCommand';
  }
}

function parseCommand<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) {
    throw new InvalidProtocolCommand(
      result.error.issues[0]?.message ?? 'The protocol command is invalid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

function protocolErrorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidProtocolCommand) {
    return reply.status(422).send({
      error: {
        code: 'PROTOCOL_INVALID',
        message: error.message,
        fields: error.fields,
      },
    });
  }
  if (!(error instanceof ProtocolError)) throw error;
  const status = error.code === 'NOT_FOUND' ? 404
    : error.code === 'FORBIDDEN' ? 403
      : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code) ? 409 : 422;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const protocolRoutes: FastifyPluginAsync<ProtocolRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/matters/:matterId/protocol-experts', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const workspace = options.service.getWorkspace(user, matterId);
      if (!workspace) throw new ProtocolError('NOT_FOUND', 'The requested resource was not found.');
      return workspace;
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.put('/api/matters/:matterId/protocol/letter', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(saveLetterOfClaimSchema, request.body);
      return { letter: options.service.saveLetter(user, matterId, command, options.auditContext(request)) };
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/protocol/letter/approve', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(approveLetterOfClaimSchema, request.body);
      const result = await options.service.approveLetter(user, matterId, command, options.auditContext(request));
      return reply.status(201).send(result);
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/protocol/service-events', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(recordProtocolServiceEventSchema, request.body);
      const serviceEvent = options.service.recordServiceEvent(user, matterId, command, options.auditContext(request));
      return reply.status(201).send({ serviceEvent });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/protocol/deadline-variations', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(varyProtocolDeadlineSchema, request.body);
      const variation = options.service.varyProtocolDeadline(user, matterId, command, options.auditContext(request));
      return reply.status(201).send({ variation });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/protocol/landlord-responses', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(recordLandlordResponseSchema, request.body);
      const response = options.service.recordLandlordResponse(user, matterId, command, options.auditContext(request));
      return reply.status(201).send({ response });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.put('/api/matters/:matterId/protocol/expert-route', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(selectExpertRouteSchema, request.body);
      return { case: options.service.selectExpertRoute(user, matterId, command, options.auditContext(request)) };
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createExpertEngagementSchema, request.body);
      const engagement = options.service.createExpertEngagement(user, matterId, command, options.auditContext(request));
      return reply.status(201).send({ engagement });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.patch('/api/matters/:matterId/experts/:engagementId', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(updateExpertEngagementSchema, request.body);
      return { engagement: options.service.updateExpertEngagement(user, matterId, engagementId, command, options.auditContext(request)) };
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/conflict-checks', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(recordExpertConflictCheckSchema, request.body);
      const conflictCheck = options.service.recordExpertConflictCheck(user, matterId, engagementId, command, options.auditContext(request));
      return reply.status(201).send({ conflictCheck });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/instructions/approve', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(approveExpertInstructionSchema, request.body);
      const result = await options.service.approveExpertInstruction(user, matterId, engagementId, command, options.auditContext(request));
      return reply.status(201).send(result);
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/milestones', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(recordExpertMilestoneSchema, request.body);
      const milestone = options.service.recordExpertMilestone(user, matterId, engagementId, command, options.auditContext(request));
      return reply.status(201).send({ milestone });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/reports', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(recordExpertReportSchema, request.body);
      const report = options.service.recordExpertReport(user, matterId, engagementId, command, options.auditContext(request));
      return reply.status(201).send({ report });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/questions', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId } = request.params as { matterId: string; engagementId: string };
      const command = parseCommand(recordExpertQuestionSchema, request.body);
      const question = options.service.recordExpertQuestion(user, matterId, engagementId, command, options.auditContext(request));
      return reply.status(201).send({ question });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/experts/:engagementId/questions/:questionId/answers', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, engagementId, questionId } = request.params as {
        matterId: string; engagementId: string; questionId: string;
      };
      const command = parseCommand(recordExpertQuestionAnswerSchema, request.body);
      const answer = options.service.recordExpertQuestionAnswer(
        user, matterId, engagementId, questionId, command, options.auditContext(request),
      );
      return reply.status(201).send({ answer });
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });

  app.get('/api/matters/:matterId/protocol/generated/:documentVersionId/download', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId, documentVersionId } = request.params as {
        matterId: string; documentVersionId: string;
      };
      const workspace = options.service.getWorkspace(user, matterId);
      if (!workspace) throw new ProtocolError('NOT_FOUND', 'The requested resource was not found.');
      const file = options.store.getDocumentFileByVersion(user.firmId, matterId, documentVersionId);
      if (!file) throw new ProtocolError('NOT_FOUND', 'The requested resource was not found.');
      const safeName = file.originalName.replace(/["\\\r\n]/g, '_');
      reply
        .type(file.mimeType)
        .header('content-length', String(file.sizeBytes))
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `attachment; filename="${safeName}"`);
      return reply.send(openStoredFile(options.storagePath, file.storageKey));
    } catch (error) {
      return protocolErrorReply(error, reply);
    }
  });
};
