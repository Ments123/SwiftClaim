import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  activateFinanceRateVersionSchema,
  addFinanceRateVersionSchema,
  approveFinanceJournalSchema,
  approveFinanceTimeSchema,
  createFinanceDisbursementSchema,
  createFinanceEstimateVersionSchema,
  createFinanceRateCardSchema,
  decideFinanceActivitySuggestionSchema,
  postFinanceJournalSchema,
  prepareFinanceJournalSchema,
  recordFinanceDisbursementEventSchema,
  recordFinanceWarningEventSchema,
  reverseFinanceJournalSchema,
  reverseFinanceTimeSchema,
  startFinanceTimerSchema,
  stopFinanceTimerSchema,
  submitFinanceTimeSchema,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { FinanceCalculationError } from './calculations.js';
import { FinanceService } from './service.js';
import { FinanceStoreError } from './store.js';

export interface FinanceRoutesOptions {
  service: FinanceService;
  requireUser: (request: FastifyRequest) => SessionUser;
  auditContext: (request: FastifyRequest) => AuditContext;
}

class InvalidFinanceCommand extends Error {
  constructor(readonly fields: Record<string, string[] | undefined>) {
    super('Check the finance command fields and try again.');
    this.name = 'InvalidFinanceCommand';
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvalidFinanceCommand(result.error.flatten().fieldErrors);
  }
  return result.data;
}

function failure(error: unknown, reply: FastifyReply) {
  if (error instanceof InvalidFinanceCommand) {
    return reply.status(400).send({
      error: {
        code: 'FINANCE_INVALID',
        message: error.message,
        fields: error.fields,
      },
    });
  }
  if (error instanceof FinanceCalculationError) {
    return reply.status(400).send({
      error: { code: error.code, message: error.message },
    });
  }
  if (!(error instanceof FinanceStoreError)) throw error;
  if (error.code === 'NOT_FOUND' || error.code === 'INVALID_LINK') {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Finance record not found.' },
    });
  }
  if (error.code === 'FORBIDDEN') {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'The finance action is not permitted.' },
    });
  }
  return reply.status(409).send({
    error: { code: error.code, message: error.message },
  });
}

type Params = {
  matterId: string;
  suggestionId: string;
  timerId: string;
  timeEntryId: string;
  rateCardId: string;
  warningId: string;
  disbursementId: string;
  journalId: string;
};

export const financeRoutes: FastifyPluginAsync<FinanceRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/api/matters/:matterId/finance', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const workspace = options.service.getWorkspace(options.requireUser(request), matterId);
      if (!workspace) {
        throw new FinanceStoreError('NOT_FOUND', 'The finance workspace was not found.');
      }
      return workspace;
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.get('/api/finance/rate-cards/:rateCardId', async (request, reply) => {
    try {
      const { rateCardId } = request.params as Params;
      const rateCard = options.service.getRateCard(options.requireUser(request), rateCardId);
      if (!rateCard) {
        throw new FinanceStoreError('NOT_FOUND', 'The rate card was not found.');
      }
      return { rateCard };
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.get('/api/finance/rate-cards', async (request, reply) => {
    try {
      const rateCards = options.service.listRateCards(options.requireUser(request));
      if (!rateCards) {
        throw new FinanceStoreError('NOT_FOUND', 'The rate cards were not found.');
      }
      return { rateCards };
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post('/api/finance/rate-cards', async (request, reply) => {
    try {
      const rateCard = options.service.createRateCard(
        options.requireUser(request),
        parse(createFinanceRateCardSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ rateCard });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post('/api/finance/rate-cards/:rateCardId/versions', async (request, reply) => {
    try {
      const { rateCardId } = request.params as Params;
      const rateVersion = options.service.addRateVersion(
        options.requireUser(request),
        rateCardId,
        parse(addFinanceRateVersionSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ rateVersion });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post('/api/finance/rate-cards/:rateCardId/activate', async (request, reply) => {
    try {
      const { rateCardId } = request.params as Params;
      const rateVersion = options.service.activateRateVersion(
        options.requireUser(request),
        rateCardId,
        parse(activateFinanceRateVersionSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ rateVersion });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/suggestions/:suggestionId/decisions',
    async (request, reply) => {
      try {
        const { matterId, suggestionId } = request.params as Params;
        const suggestion = options.service.decideSuggestion(
          options.requireUser(request),
          matterId,
          suggestionId,
          parse(decideFinanceActivitySuggestionSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ suggestion });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/finance/timers', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const timer = options.service.startTimer(
        options.requireUser(request),
        matterId,
        parse(startFinanceTimerSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ timer });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/timers/:timerId/stop',
    async (request, reply) => {
      try {
        const { matterId, timerId } = request.params as Params;
        const timer = options.service.stopTimer(
          options.requireUser(request),
          matterId,
          timerId,
          parse(stopFinanceTimerSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ timer });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/finance/time-entries', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const timeEntry = options.service.submitTime(
        options.requireUser(request),
        matterId,
        parse(submitFinanceTimeSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ timeEntry });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/time-entries/:timeEntryId/approve',
    async (request, reply) => {
      try {
        const { matterId, timeEntryId } = request.params as Params;
        const timeEntry = options.service.approveTime(
          options.requireUser(request),
          matterId,
          timeEntryId,
          parse(approveFinanceTimeSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ timeEntry });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/finance/time-entries/:timeEntryId/reverse',
    async (request, reply) => {
      try {
        const { matterId, timeEntryId } = request.params as Params;
        const timeEntry = options.service.reverseTime(
          options.requireUser(request),
          matterId,
          timeEntryId,
          parse(reverseFinanceTimeSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ timeEntry });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/finance/estimates', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const estimate = options.service.addEstimateVersion(
        options.requireUser(request),
        matterId,
        parse(createFinanceEstimateVersionSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ estimate });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/warnings/:warningId/events',
    async (request, reply) => {
      try {
        const { matterId, warningId } = request.params as Params;
        const warning = options.service.recordWarningEvent(
          options.requireUser(request),
          matterId,
          warningId,
          parse(recordFinanceWarningEventSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ warning });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/finance/disbursements', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const disbursement = options.service.createDisbursement(
        options.requireUser(request),
        matterId,
        parse(createFinanceDisbursementSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ disbursement });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/disbursements/:disbursementId/events',
    async (request, reply) => {
      try {
        const { matterId, disbursementId } = request.params as Params;
        const disbursement = options.service.recordDisbursementEvent(
          options.requireUser(request),
          matterId,
          disbursementId,
          parse(recordFinanceDisbursementEventSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ disbursement });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post('/api/matters/:matterId/finance/journals', async (request, reply) => {
    try {
      const { matterId } = request.params as Params;
      const journal = options.service.prepareJournal(
        options.requireUser(request),
        matterId,
        parse(prepareFinanceJournalSchema, request.body),
        options.auditContext(request),
      );
      return reply.status(201).send({ journal });
    } catch (error) {
      return failure(error, reply);
    }
  });

  app.post(
    '/api/matters/:matterId/finance/journals/:journalId/approve',
    async (request, reply) => {
      try {
        const { matterId, journalId } = request.params as Params;
        const journal = options.service.approveJournal(
          options.requireUser(request),
          matterId,
          journalId,
          parse(approveFinanceJournalSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ journal });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/finance/journals/:journalId/post',
    async (request, reply) => {
      try {
        const { matterId, journalId } = request.params as Params;
        const journal = options.service.postJournal(
          options.requireUser(request),
          matterId,
          journalId,
          parse(postFinanceJournalSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ journal });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );

  app.post(
    '/api/matters/:matterId/finance/journals/:journalId/reverse',
    async (request, reply) => {
      try {
        const { matterId, journalId } = request.params as Params;
        const journal = options.service.reverseJournal(
          options.requireUser(request),
          matterId,
          journalId,
          parse(reverseFinanceJournalSchema, request.body),
          options.auditContext(request),
        );
        return reply.status(201).send({ journal });
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
};
