import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import { decideMatterClosureSchema, legalHoldSchema, prepareMatterClosureSchema, reopenMatterSchema } from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { ClosureService, ClosureServiceError } from './service.js';

export interface ClosureRoutesOptions {
  service: ClosureService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidClosureCommand extends Error {
  constructor(readonly fields: Record<string, string[] | undefined>) {
    super('Check the closure command fields and try again.');
    this.name = 'InvalidClosureCommand';
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidClosureCommand(result.error.flatten().fieldErrors);
  return result.data;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidClosureCommand) return reply.status(400).send({ error: {
    code: 'CLOSURE_INVALID', message: error.message, fields: error.fields,
  } });
  if (!(error instanceof ClosureServiceError)) throw error;
  if (error.code === 'NOT_FOUND' || error.code === 'INVALID_LINK') return reply.status(404).send({
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  });
  if (error.code === 'FORBIDDEN') return reply.status(403).send({ error: { code: error.code, message: error.message } });
  const status = ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'INDEPENDENCE_REQUIRED', 'STALE_REVIEW'].includes(error.code) ? 409 : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const closureRoutes: FastifyPluginAsync<ClosureRoutesOptions> = async (app, options) => {
  const context = (request: FastifyRequest) => ({
    user: options.requireUser(request),
    matterId: (request.params as { matterId: string }).matterId,
    audit: options.auditContext(request),
  });
  app.get('/api/matters/:matterId/closure', async (request, reply) => {
    try { const { user, matterId } = context(request); return options.service.getWorkspace(user, matterId); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/reviews', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); return reply.status(201).send(
      options.service.prepare(user, matterId, parse(prepareMatterClosureSchema, request.body), audit),
    ); } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/reviews/:reviewId/approve', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); const { reviewId } = request.params as { reviewId: string }; return options.service.approve(
      user, matterId, reviewId, parse(decideMatterClosureSchema, request.body), audit,
    ); } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/reviews/:reviewId/close', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); const { reviewId } = request.params as { reviewId: string }; return options.service.close(
      user, matterId, reviewId, parse(decideMatterClosureSchema, request.body), audit,
    ); } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/reopen', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); return options.service.reopen(
      user, matterId, parse(reopenMatterSchema, request.body), audit,
    ); } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/legal-holds', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); return reply.status(201).send(options.service.applyLegalHold(
      user, matterId, parse(legalHoldSchema, request.body), audit,
    )); } catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/closure/legal-holds/:holdId/release', async (request, reply) => {
    try { const { user, matterId, audit } = context(request); const { holdId } = request.params as { holdId: string }; return options.service.releaseLegalHold(
      user, matterId, holdId, parse(legalHoldSchema, request.body), audit,
    ); } catch (error) { return failure(error, reply); }
  });
};
