import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { DisclosureService, DisclosureServiceError } from './service.js';

export interface DisclosureRoutesOptions {
  service: DisclosureService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof ZodError) return reply.status(400).send({ error: {
    code: 'DISCLOSURE_INVALID', message: 'Check the disclosure command fields and try again.',
    fields: error.flatten().fieldErrors,
  } });
  if (!(error instanceof DisclosureServiceError)) throw error;
  const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403
    : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code) ? 409 : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

type Params = { matterId: string; proceedingId: string; reviewId: string; candidateId: string; requestId: string };

export const disclosureRoutes: FastifyPluginAsync<DisclosureRoutesOptions> = async (app, options) => {
  app.get('/api/matters/:matterId/proceedings/:proceedingId/disclosure', async (request, reply) => {
    try { const { matterId, proceedingId } = request.params as Params;
      return options.service.getWorkspace(options.requireUser(request), matterId, proceedingId);
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/reviews', async (request, reply) => {
    try { const { matterId, proceedingId } = request.params as Params;
      const review = options.service.openReview(options.requireUser(request), matterId, proceedingId, request.body, options.auditContext(request));
      return reply.status(201).send({ review });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/reviews/:reviewId/candidates', async (request, reply) => {
    try { const { matterId, proceedingId, reviewId } = request.params as Params;
      const candidate = options.service.addCandidate(options.requireUser(request), matterId, proceedingId, reviewId, request.body, options.auditContext(request));
      return reply.status(201).send({ candidate });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/candidates/:candidateId/ai-suggestions', async (request, reply) => {
    try { const { matterId, proceedingId, candidateId } = request.params as Params;
      const suggestion = options.service.recordAiSuggestion(options.requireUser(request), matterId, proceedingId, candidateId, request.body, options.auditContext(request));
      return reply.status(201).send({ suggestion });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/candidates/:candidateId/decisions', async (request, reply) => {
    try { const { matterId, proceedingId, candidateId } = request.params as Params;
      const candidate = options.service.recordDecision(options.requireUser(request), matterId, proceedingId, candidateId, request.body, options.auditContext(request));
      return reply.status(201).send({ candidate });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/candidates/:candidateId/privilege-reviews', async (request, reply) => {
    try { const { matterId, proceedingId, candidateId } = request.params as Params;
      const candidate = options.service.recordPrivilegeReview(options.requireUser(request), matterId, proceedingId, candidateId, request.body, options.auditContext(request));
      return reply.status(201).send({ candidate });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/candidates/:candidateId/redactions', async (request, reply) => {
    try { const { matterId, proceedingId, candidateId } = request.params as Params;
      const candidate = options.service.approveRedaction(options.requireUser(request), matterId, proceedingId, candidateId, request.body, options.auditContext(request));
      return reply.status(201).send({ candidate });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/reviews/:reviewId/lists', async (request, reply) => {
    try { const { matterId, proceedingId, reviewId } = request.params as Params;
      const list = options.service.generateList(options.requireUser(request), matterId, proceedingId, reviewId, request.body, options.auditContext(request));
      return reply.status(201).send({ list });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/reviews/:reviewId/inspection-requests', async (request, reply) => {
    try { const { matterId, proceedingId, reviewId } = request.params as Params;
      const inspectionRequest = options.service.createInspectionRequest(options.requireUser(request), matterId, proceedingId, reviewId, request.body, options.auditContext(request));
      return reply.status(201).send({ inspectionRequest });
    } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/disclosure/inspection-requests/:requestId/events', async (request, reply) => {
    try { const { matterId, proceedingId, requestId } = request.params as Params;
      const inspectionRequest = options.service.recordInspectionEvent(options.requireUser(request), matterId, proceedingId, requestId, request.body, options.auditContext(request));
      return reply.status(201).send({ inspectionRequest });
    } catch (error) { return failure(error, reply); }
  });
};
