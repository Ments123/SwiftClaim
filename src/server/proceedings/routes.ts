import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  createCourtApplicationSchema, createCourtDirectionSchema, createCourtFilingSchema,
  createCourtHearingSchema, createCourtOrderSchema, createCourtServiceRecordSchema,
  createProceedingAuthorityVersionSchema, createProceedingSchema,
  recordCourtApplicationEventSchema, recordCourtDirectionEventSchema,
  recordCourtFilingEventSchema, recordCourtHearingEventSchema,
  recordCourtServiceEventSchema, recordProceedingEventSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { ProceedingsService, ProceedingsServiceError } from './service.js';

export interface ProceedingsRoutesOptions {
  service: ProceedingsService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidProceedingsCommand extends Error {
  constructor(readonly fields: Record<string, string[] | undefined>) {
    super('Check the proceedings command fields and try again.');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidProceedingsCommand(result.error.flatten().fieldErrors);
  return result.data;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidProceedingsCommand) {
    return reply.status(400).send({ error: {
      code: 'PROCEEDINGS_INVALID', message: error.message, fields: error.fields,
    } });
  }
  if (!(error instanceof ProceedingsServiceError)) throw error;
  const status = error.code === 'NOT_FOUND' ? 404
    : error.code === 'FORBIDDEN' ? 403
      : ['CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code) ? 409 : 400;
  return reply.status(status).send({ error: { code: error.code, message: error.message } });
}

export const proceedingsRoutes: FastifyPluginAsync<ProceedingsRoutesOptions> = async (app, options) => {
  const context = (request: FastifyRequest) => {
    const params = request.params as { matterId: string; proceedingId?: string };
    return { user: options.requireUser(request), matterId: params.matterId,
      proceedingId: params.proceedingId };
  };
  const audit = (request: FastifyRequest) => options.auditContext(request);

  app.get('/api/matters/:matterId/proceedings', async (request, reply) => {
    try { const { user, matterId } = context(request); return options.service.getWorkspace(user, matterId); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings', async (request, reply) => {
    try { const { user, matterId } = context(request); return reply.status(201).send({ proceeding:
      options.service.createProceeding(user, matterId, parse(createProceedingSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/authority-versions', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ authority:
      options.service.createAuthorityVersion(user, matterId, proceedingId!, parse(createProceedingAuthorityVersionSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ proceeding:
      options.service.recordProceedingEvent(user, matterId, proceedingId!, parse(recordProceedingEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/filings', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ filing:
      options.service.createFiling(user, matterId, proceedingId!, parse(createCourtFilingSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/filings/:filingId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); const { filingId } = request.params as { filingId: string }; return reply.status(201).send({ filing:
      options.service.recordFilingEvent(user, matterId, proceedingId!, filingId, parse(recordCourtFilingEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/service-records', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ serviceRecord:
      options.service.createServiceRecord(user, matterId, proceedingId!, parse(createCourtServiceRecordSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/service-records/:serviceRecordId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); const { serviceRecordId } = request.params as { serviceRecordId: string }; return reply.status(201).send({ serviceRecord:
      options.service.recordServiceEvent(user, matterId, proceedingId!, serviceRecordId, parse(recordCourtServiceEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/applications', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ application:
      options.service.createApplication(user, matterId, proceedingId!, parse(createCourtApplicationSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/applications/:applicationId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); const { applicationId } = request.params as { applicationId: string }; return reply.status(201).send({ application:
      options.service.recordApplicationEvent(user, matterId, proceedingId!, applicationId, parse(recordCourtApplicationEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/orders', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ order:
      options.service.createOrder(user, matterId, proceedingId!, parse(createCourtOrderSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/directions', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ direction:
      options.service.createDirection(user, matterId, proceedingId!, parse(createCourtDirectionSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/directions/:directionId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); const { directionId } = request.params as { directionId: string }; return reply.status(201).send({ direction:
      options.service.recordDirectionEvent(user, matterId, proceedingId!, directionId, parse(recordCourtDirectionEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/hearings', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); return reply.status(201).send({ hearing:
      options.service.createHearing(user, matterId, proceedingId!, parse(createCourtHearingSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
  app.post('/api/matters/:matterId/proceedings/:proceedingId/hearings/:hearingId/events', async (request, reply) => {
    try { const { user, matterId, proceedingId } = context(request); const { hearingId } = request.params as { hearingId: string }; return reply.status(201).send({ hearing:
      options.service.recordHearingEvent(user, matterId, proceedingId!, hearingId, parse(recordCourtHearingEventSchema, request.body), audit(request)) }); }
    catch (error) { return failure(error, reply); }
  });
};
