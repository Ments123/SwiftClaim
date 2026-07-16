import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  appendCommunicationDraftVersionSchema,
  createCommunicationDraftSchema,
  decideCommunicationDraftSchema,
  dispatchCommunicationSchema,
  recordCommunicationCallSchema,
  recordCommunicationProviderEventSchema,
  recordCommunicationSchema,
  submitCommunicationDraftSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { CommunicationError, CommunicationService } from './service.js';

export interface CommunicationRoutesOptions {
  service: CommunicationService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidCommunicationCommand extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'InvalidCommunicationCommand';
  }
}

function parseCommand<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) {
    throw new InvalidCommunicationCommand(
      result.error.issues[0]?.message ?? 'The communication command is invalid.',
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

function errorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidCommunicationCommand) {
    return reply.status(400).send({
      error: {
        code: 'COMMUNICATION_INVALID',
        message: error.message,
        fields: error.fields,
      },
    });
  }
  if (!(error instanceof CommunicationError)) throw error;
  const status = error.code === 'NOT_FOUND'
    ? 404
    : error.code === 'FORBIDDEN'
      ? 403
      : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code)
        ? 409
        : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const communicationRoutes: FastifyPluginAsync<CommunicationRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/matters/:matterId/communications', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      return await options.service.getWorkspace(user, matterId);
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.get('/api/communication-providers/capabilities', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      return { providers: await options.service.getProviderCapabilities(user) };
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/communications/record', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(recordCommunicationSchema, request.body);
      return reply.status(201).send({
        entry: options.service.recordEntry(
          user,
          matterId,
          command,
          options.auditContext(request),
        ),
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post('/api/matters/:matterId/communication-drafts', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(createCommunicationDraftSchema, request.body);
      return reply.status(201).send({
        draft: options.service.createDraft(
          user,
          matterId,
          command,
          options.auditContext(request),
        ),
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/communication-drafts/:draftId/versions',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, draftId } = request.params as { matterId: string; draftId: string };
        const command = parseCommand(appendCommunicationDraftVersionSchema, request.body);
        return reply.status(201).send({
          draft: options.service.appendDraftVersion(
            user,
            matterId,
            draftId,
            command,
            options.auditContext(request),
          ),
        });
      } catch (error) {
        return errorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/communication-drafts/:draftId/submit',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, draftId } = request.params as { matterId: string; draftId: string };
        const command = parseCommand(submitCommunicationDraftSchema, request.body);
        return {
          draft: options.service.submitDraft(
            user,
            matterId,
            draftId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return errorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/communication-drafts/:draftId/decisions',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, draftId } = request.params as { matterId: string; draftId: string };
        const command = parseCommand(decideCommunicationDraftSchema, request.body);
        return {
          draft: options.service.decideDraft(
            user,
            matterId,
            draftId,
            command,
            options.auditContext(request),
          ),
        };
      } catch (error) {
        return errorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/communication-drafts/:draftId/dispatch',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, draftId } = request.params as { matterId: string; draftId: string };
        const command = parseCommand(dispatchCommunicationSchema, request.body);
        const result = await options.service.dispatch(
          user,
          matterId,
          draftId,
          command,
          options.auditContext(request),
        );
        return reply.status(202).send(result);
      } catch (error) {
        return errorReply(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/communication-dispatches/:dispatchId/events',
    async (request, reply) => {
      try {
        const user = options.requireUser(request);
        const { matterId, dispatchId } = request.params as { matterId: string; dispatchId: string };
        const providerKey = request.headers['x-swiftclaim-provider'];
        if (typeof providerKey !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(providerKey)) {
          throw new InvalidCommunicationCommand('A valid provider header is required.', {
            providerKey: ['Set x-swiftclaim-provider to the configured provider key.'],
          });
        }
        const command = parseCommand(recordCommunicationProviderEventSchema, request.body);
        return await options.service.recordProviderEvent(
          user,
          matterId,
          dispatchId,
          providerKey,
          command,
          options.auditContext(request),
        );
      } catch (error) {
        return errorReply(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/communication-calls', async (request, reply) => {
    try {
      const user = options.requireUser(request);
      const { matterId } = request.params as { matterId: string };
      const command = parseCommand(recordCommunicationCallSchema, request.body);
      return reply.status(201).send({
        entry: options.service.recordCall(
          user,
          matterId,
          command,
          options.auditContext(request),
        ),
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  });
};
