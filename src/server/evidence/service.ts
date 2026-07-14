import { ZodError, type ZodType } from 'zod';

import {
  createAccessEventSchema,
  createDefectSchema,
  createEvidenceItemSchema,
  createNoticeSchema,
  updateDefectSchema,
  type CreateAccessEventInput,
  type CreateDefectInput,
  type CreateEvidenceItemInput,
  type CreateNoticeInput,
  type UpdateDefectInput,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  EvidenceIdempotencyConflictError,
  EvidenceRecordNotFoundError,
  EvidenceStateConflictError,
  EvidenceStore,
} from './store.js';
import type { EvidenceReadiness, EvidenceWorkspace } from './types.js';

export type EvidenceErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'EVIDENCE_INVALID';

export class EvidenceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: EvidenceErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EvidenceError';
  }
}

export interface EvidenceReadinessProvider {
  getEvidenceReadiness(firmId: string, matterId: string): EvidenceReadiness;
}

function invalid(error: ZodError): EvidenceError {
  return new EvidenceError(
    422,
    'EVIDENCE_INVALID',
    error.issues[0]?.message ?? 'The evidence command is invalid.',
    { fields: error.flatten().fieldErrors },
  );
}

function parse<T>(schema: ZodType<T>, command: unknown): T {
  const result = schema.safeParse(command);
  if (!result.success) throw invalid(result.error);
  return result.data;
}

export class EvidenceService implements EvidenceReadinessProvider {
  constructor(
    private readonly store: EvidenceStore,
    private readonly now: () => Date,
  ) {}

  private context(user: SessionUser, audit: AuditContext) {
    return {
      actorUserId: user.id,
      occurredAt: this.now().toISOString(),
      requestId: audit.requestId,
      ipAddress: audit.ipAddress,
    };
  }

  private mapStoreError(error: unknown): never {
    if (error instanceof EvidenceStateConflictError) {
      throw new EvidenceError(
        409,
        'CONFLICT',
        'This evidence record changed before your update was saved.',
      );
    }
    if (error instanceof EvidenceIdempotencyConflictError) {
      throw new EvidenceError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with different evidence data.',
      );
    }
    if (error instanceof EvidenceRecordNotFoundError) {
      throw new EvidenceError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    throw error;
  }

  private requireWritable(user: SessionUser, matterId: string): void {
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) {
      throw new EvidenceError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    if (!workspace.permissions.canWrite) {
      throw new EvidenceError(
        403,
        'FORBIDDEN',
        'You do not have permission to change this evidence investigation.',
      );
    }
  }

  getWorkspace(user: SessionUser, matterId: string): EvidenceWorkspace {
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) {
      throw new EvidenceError(404, 'NOT_FOUND', 'The requested resource was not found.');
    }
    return workspace;
  }

  getEvidenceReadiness(firmId: string, matterId: string): EvidenceReadiness {
    return this.store.getEvidenceReadiness(firmId, matterId);
  }

  createDefect(
    user: SessionUser,
    matterId: string,
    command: unknown,
    audit: AuditContext,
  ) {
    this.requireWritable(user, matterId);
    const input: CreateDefectInput = parse(createDefectSchema, command);
    try {
      return this.store.createDefect(
        user,
        matterId,
        input,
        this.context(user, audit),
      );
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  updateDefect(
    user: SessionUser,
    matterId: string,
    defectId: string,
    command: unknown,
    audit: AuditContext,
  ) {
    this.requireWritable(user, matterId);
    const input: UpdateDefectInput = parse(updateDefectSchema, command);
    try {
      return this.store.updateDefect(
        user,
        matterId,
        defectId,
        input,
        this.context(user, audit),
      );
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  createNotice(
    user: SessionUser,
    matterId: string,
    command: unknown,
    audit: AuditContext,
  ) {
    this.requireWritable(user, matterId);
    const input: CreateNoticeInput = parse(createNoticeSchema, command);
    try {
      return this.store.createNotice(
        user,
        matterId,
        input,
        this.context(user, audit),
      );
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  createAccessEvent(
    user: SessionUser,
    matterId: string,
    command: unknown,
    audit: AuditContext,
  ) {
    this.requireWritable(user, matterId);
    const input: CreateAccessEventInput = parse(
      createAccessEventSchema,
      command,
    );
    try {
      return this.store.createAccessEvent(
        user,
        matterId,
        input,
        this.context(user, audit),
      );
    } catch (error) {
      return this.mapStoreError(error);
    }
  }

  createEvidenceItem(
    user: SessionUser,
    matterId: string,
    command: unknown,
    audit: AuditContext,
  ) {
    this.requireWritable(user, matterId);
    const input: CreateEvidenceItemInput = parse(
      createEvidenceItemSchema,
      command,
    );
    try {
      return this.store.createEvidenceItem(
        user,
        matterId,
        input,
        this.context(user, audit),
      );
    } catch (error) {
      return this.mapStoreError(error);
    }
  }
}

