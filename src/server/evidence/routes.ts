import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodType } from 'zod';

import {
  createAccessEventSchema,
  createDefectSchema,
  createEvidenceItemSchema,
  createNoticeSchema,
  updateDefectSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { EvidenceError, EvidenceService } from './service.js';

export interface EvidenceRoutesOptions {
  service: EvidenceService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

function parseCommand<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) {
    throw new EvidenceError(
      422,
      'EVIDENCE_INVALID',
      result.error.issues[0]?.message ?? 'The evidence command is invalid.',
      { fields: result.error.flatten().fieldErrors },
    );
  }
  return result.data;
}

function evidenceErrorReply(error: unknown, reply: FastifyReply) {
  if (!(error instanceof EvidenceError)) throw error;
  const fields = error.details.fields;
  const body: {
    error: {
      code: string;
      message: string;
      fields?: Record<string, string[]>;
    };
    details?: Record<string, unknown>;
  } = {
    error: { code: error.code, message: error.message },
  };
  if (fields && typeof fields === 'object') {
    body.error.fields = fields as Record<string, string[]>;
  }
  const details = Object.fromEntries(
    Object.entries(error.details).filter(([key]) => key !== 'fields'),
  );
  if (Object.keys(details).length > 0) body.details = details;
  return reply.status(error.statusCode).send(body);
}

export const evidenceRoutes: FastifyPluginAsync<EvidenceRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    '/api/matters/:matterId/evidence-investigation',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId } = request.params as { matterId: string };
        return options.service.getWorkspace(user, matterId);
      } catch (error) {
        return evidenceErrorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/defects', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createDefectSchema, request.body);
      const defect = options.service.createDefect(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ defect });
    } catch (error) {
      return evidenceErrorReply(error, reply);
    }
  });

  app.patch(
    '/api/matters/:matterId/defects/:defectId',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, defectId } = request.params as {
          matterId: string;
          defectId: string;
        };
        const command = parseCommand(updateDefectSchema, request.body);
        return {
          defect: options.service.updateDefect(
            user,
            matterId,
            defectId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return evidenceErrorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/notices', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createNoticeSchema, request.body);
      const notice = options.service.createNotice(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ notice });
    } catch (error) {
      return evidenceErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/access-events', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createAccessEventSchema, request.body);
      const accessEvent = options.service.createAccessEvent(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ accessEvent });
    } catch (error) {
      return evidenceErrorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/evidence-items', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createEvidenceItemSchema, request.body);
      const evidenceItem = options.service.createEvidenceItem(
        user,
        matterId,
        command,
        options.auditContext(request),
      );
      return reply.status(201).send({ evidenceItem });
    } catch (error) {
      return evidenceErrorReply(error, reply);
    }
  });
};

