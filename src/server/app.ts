import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';

import {
  createMatterSchema,
  createPartySchema,
  createTaskSchema,
  documentMetadataSchema,
  loginSchema,
  updateTaskSchema,
  type ApiErrorBody,
  type FirmRole,
} from '../shared/contracts.js';
import { EvidenceService } from './evidence/service.js';
import { evidenceRoutes } from './evidence/routes.js';
import { EvidenceStore } from './evidence/store.js';
import { IntakeConflictService } from './intake/conflicts.js';
import { intakeRoutes } from './intake/routes.js';
import { IntakeService } from './intake/service.js';
import { IntakeStore } from './intake/store.js';
import { canCreateMatter, hasCapability, type SessionUser } from './policy.js';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './security.js';
import { MatterStore, StoreError } from './store.js';
import {
  deleteStoredFile,
  MAX_UPLOAD_BYTES,
  openStoredFile,
  storeUploadedFile,
  UploadTooLargeError,
  type StoredFile,
} from './storage.js';
import { workflowRoutes } from './workflow/routes.js';
import { WorkflowService } from './workflow/service.js';
import { WorkflowStore } from './workflow/store.js';

const SESSION_COOKIE = 'swiftclaim_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;

type SqlRow = Record<string, string | number | null>;

export interface BuildAppOptions {
  database: DatabaseSync;
  storagePath: string;
  staticPath?: string;
  logger?: FastifyServerOptions['logger'];
  isProduction?: boolean;
  now?: () => Date;
}

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

function toSessionUser(row: SqlRow): SessionUser {
  return {
    id: String(row.id),
    firmId: String(row.firmId),
    firmName: String(row.firmName),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role) as FirmRole,
  };
}

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    firm: { id: user.firmId, name: user.firmName },
    permissions: {
      canCreateMatter: canCreateMatter(user),
      canViewAdministration: hasCapability(user, 'administration.view'),
      canTransitionWorkflow: hasCapability(user, 'workflow.transition'),
      canOverrideWorkflow: hasCapability(user, 'workflow.override'),
      canConfirmDeadline: hasCapability(user, 'deadline.confirm'),
      canAccessIntake: hasCapability(user, 'intake.read'),
      canWriteIntake: hasCapability(user, 'intake.write'),
      canDecideIntake: hasCapability(user, 'intake.decide'),
      canOverrideConflict: hasCapability(user, 'intake.override_conflict'),
      canConvertIntake: hasCapability(user, 'intake.convert'),
    },
  };
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
  });
  const database = options.database;
  const now = options.now ?? (() => new Date());
  const isProduction = options.isProduction ?? false;
  const matterStore = new MatterStore(database, now);
  const workflowStore = new WorkflowStore(database, now);
  const evidenceStore = new EvidenceStore(database);
  const evidenceService = new EvidenceService(evidenceStore, now);
  const workflowService = new WorkflowService(
    matterStore,
    workflowStore,
    now,
    evidenceService,
  );
  const intakeStore = new IntakeStore(database, now);
  const intakeService = new IntakeService(
    database,
    intakeStore,
    now,
    workflowStore,
  );
  const intakeConflicts = new IntakeConflictService(database, intakeStore, now);
  const dummyPasswordHash = hashPassword('invalid-password-value');

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 8,
      parts: 9,
    },
  });
  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });
  if (options.staticPath) {
    await app.register(fastifyStatic, {
      root: options.staticPath,
      prefix: '/',
      wildcard: false,
      cacheControl: isProduction,
      maxAge: isProduction ? '1h' : 0,
    });
  }

  app.addHook('onRequest', async (request) => {
    if (!isProduction || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (!origin || !host) {
      throw new HttpError(403, 'UNTRUSTED_ORIGIN', 'The request origin is not trusted.');
    }
    try {
      if (new URL(origin).host !== host) {
        throw new HttpError(
          403,
          'UNTRUSTED_ORIGIN',
          'The request origin is not trusted.',
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(403, 'UNTRUSTED_ORIGIN', 'The request origin is not trusted.');
    }
  });

  function currentUser(request: FastifyRequest): SessionUser | undefined {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return undefined;
    const row = database
      .prepare(
        `SELECT u.id, u.firm_id AS firmId, f.name AS firmName,
          u.email, u.name, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id AND u.firm_id = s.firm_id
        JOIN firms f ON f.id = u.firm_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(hashSessionToken(token), now().toISOString()) as SqlRow | undefined;

    return row ? toSessionUser(row) : undefined;
  }

  function requireUser(request: FastifyRequest): SessionUser {
    const user = currentUser(request);
    if (!user) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    }
    return user;
  }

  function requireMatter(user: SessionUser, matterId: string, write = false) {
    const aggregate = matterStore.getMatterAggregate(user, matterId);
    if (!aggregate) {
      throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    if (write && !aggregate.permissions.canWrite) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to change this matter.');
    }
    return aggregate;
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const field = issue.path.join('.') || '_form';
        (fields[field] ??= []).push(issue.message);
      }
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted fields and try again.',
          fields,
        },
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof StoreError) {
      return reply
        .status(400)
        .send(errorBody(error.code, 'The selected firm user is not available.'));
    }
    if (
      error instanceof UploadTooLargeError ||
      (error instanceof Error && error.message.includes('FST_REQ_FILE_TOO_LARGE')) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FST_REQ_FILE_TOO_LARGE')
    ) {
      return reply
        .status(413)
        .send(errorBody('FILE_TOO_LARGE', 'Files must be 25 MiB or smaller.'));
    }
    if (
      error instanceof Error &&
      error.message.includes('UNIQUE constraint failed: matters.firm_id, matters.reference')
    ) {
      return reply
        .status(409)
        .send(errorBody('REFERENCE_EXISTS', 'That matter reference already exists.'));
    }
    app.log.error(error);
    return reply
      .status(500)
      .send(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send(errorBody('NOT_FOUND', 'The requested resource was not found.'));
    }
    if (options.staticPath) {
      return reply.type('text/html').sendFile('index.html', {
        maxAge: 0,
        immutable: false,
      });
    }
    return reply.status(404).send('Not found');
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const row = database
        .prepare(
          `SELECT u.id, u.firm_id AS firmId, f.name AS firmName,
            u.email, u.name, u.role, u.password_hash AS passwordHash
          FROM users u
          JOIN firms f ON f.id = u.firm_id
          WHERE u.email = ? COLLATE NOCASE AND u.active = 1`,
        )
        .get(input.email) as SqlRow | undefined;
      const valid = verifyPassword(
        input.password,
        row ? String(row.passwordHash) : dummyPasswordHash,
      );
      if (!row || !valid) {
        throw new HttpError(
          401,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect.',
        );
      }

      const user = toSessionUser(row);
      const token = createSessionToken();
      const createdAt = now();
      database
        .prepare(
          `INSERT INTO sessions (
            id, firm_id, user_id, token_hash, expires_at, created_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          user.firmId,
          user.id,
          hashSessionToken(token),
          new Date(createdAt.getTime() + SESSION_DURATION_MS).toISOString(),
          createdAt.toISOString(),
          createdAt.toISOString(),
        );
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: Math.floor(SESSION_DURATION_MS / 1_000),
      });
      return { user: publicUser(user) };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      database
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(hashSessionToken(token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/me', async (request) => ({ user: publicUser(requireUser(request)) }));

  app.get('/api/users', async (request) => {
    const user = requireUser(request);
    return { users: matterStore.listFirmUsers(user) };
  });

  app.get('/api/matters', async (request) => {
    const user = requireUser(request);
    const query = request.query as { q?: string };
    return { matters: matterStore.listMatters(user, query.q ?? '') };
  });

  app.get('/api/matters/:id', async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    const aggregate = matterStore.getMatterAggregate(user, id);
    if (!aggregate) {
      throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    return aggregate;
  });

  app.post('/api/matters', async (request, reply) => {
    const user = requireUser(request);
    if (!canCreateMatter(user)) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to create matters.');
    }
    const input = createMatterSchema.parse(request.body);
    const aggregate = matterStore.createMatter(user, input, {
      requestId: request.id,
      ipAddress: request.ip,
    });
    return reply.status(201).send(aggregate);
  });

  app.get('/api/dashboard', async (request) => {
    const user = requireUser(request);
    return matterStore.getDashboard(user);
  });

  app.post('/api/matters/:id/parties', async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    requireMatter(user, id, true);
    const input = createPartySchema.parse(request.body);
    return reply.status(201).send(
      matterStore.addParty(user, id, input, {
        requestId: request.id,
        ipAddress: request.ip,
      }),
    );
  });

  app.post('/api/matters/:id/tasks', async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    requireMatter(user, id, true);
    const input = createTaskSchema.parse(request.body);
    return reply.status(201).send(
      matterStore.addTask(user, id, input, {
        requestId: request.id,
        ipAddress: request.ip,
      }),
    );
  });

  app.patch('/api/matters/:id/tasks/:taskId', async (request) => {
    const user = requireUser(request);
    const { id, taskId } = request.params as { id: string; taskId: string };
    requireMatter(user, id, true);
    const input = updateTaskSchema.parse(request.body);
    const updated = matterStore.updateTask(user, id, taskId, input, {
      requestId: request.id,
      ipAddress: request.ip,
    });
    if (!updated) {
      throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    return updated;
  });

  app.post('/api/matters/:id/documents', async (request, reply) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    requireMatter(user, id, true);

    const fields: Record<string, string> = {};
    let storedFile: StoredFile | undefined;
    let originalName = '';
    let mimeType = 'application/octet-stream';
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (storedFile) {
            part.file.resume();
            throw new HttpError(400, 'TOO_MANY_FILES', 'Upload one file at a time.');
          }
          originalName = part.filename || 'document';
          mimeType = part.mimetype || 'application/octet-stream';
          storedFile = await storeUploadedFile(options.storagePath, part.file);
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }

      const metadata = documentMetadataSchema.parse(fields);
      if (!storedFile) {
        throw new HttpError(400, 'FILE_REQUIRED', 'Choose a file to upload.');
      }
      if (originalName.length > 255) {
        throw new HttpError(400, 'INVALID_FILE_NAME', 'The file name is too long.');
      }
      const result = matterStore.addDocument(
        user,
        id,
        {
          ...metadata,
          originalName,
          mimeType,
          ...storedFile,
        },
        { requestId: request.id, ipAddress: request.ip },
      );
      return reply.status(201).send(result);
    } catch (error) {
      if (storedFile) deleteStoredFile(options.storagePath, storedFile.storageKey);
      throw error;
    }
  });

  app.get(
    '/api/matters/:id/documents/:documentId/download',
    async (request, reply) => {
      const user = requireUser(request);
      const { id, documentId } = request.params as {
        id: string;
        documentId: string;
      };
      requireMatter(user, id);
      const file = matterStore.getDocumentFile(user.firmId, id, documentId);
      if (!file) {
        throw new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.');
      }
      const safeName = file.originalName.replace(/["\\\r\n]/g, '_');
      reply
        .type(file.mimeType)
        .header('content-length', String(file.sizeBytes))
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', `attachment; filename="${safeName}"`);
      return reply.send(openStoredFile(options.storagePath, file.storageKey));
    },
  );

  await app.register(workflowRoutes, {
    service: workflowService,
    requireUser,
    auditContext: (request) => ({
      requestId: request.id,
      ipAddress: request.ip,
    }),
  });

  await app.register(evidenceRoutes, {
    service: evidenceService,
    requireUser,
    auditContext: (request) => ({
      requestId: request.id,
      ipAddress: request.ip,
    }),
  });

  await app.register(intakeRoutes, {
    store: intakeStore,
    service: intakeService,
    conflicts: intakeConflicts,
    requireUser,
    auditContext: (request) => ({
      requestId: request.id,
      ipAddress: request.ip,
    }),
  });

  return app;
}
