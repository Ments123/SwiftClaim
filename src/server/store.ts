import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CreateMatterInput,
  CreatePartyInput,
  CreateTaskInput,
  UpdateTaskInput,
} from '../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  type SessionUser,
} from './policy.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export interface AuditContext {
  requestId: string;
  ipAddress: string;
}

interface ScopedSql {
  clause: string;
  params: SqlValue[];
}

function asRow(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function asRows(value: unknown): Row[] {
  return value as Row[];
}

function readScope(user: SessionUser, alias = 'm'): ScopedSql {
  if (canReadAllFirmMatters(user)) {
    return { clause: `${alias}.firm_id = ?`, params: [user.firmId] };
  }

  return {
    clause: `${alias}.firm_id = ? AND (
      ${alias}.owner_user_id = ? OR EXISTS (
        SELECT 1 FROM matter_members scope_mm
        WHERE scope_mm.firm_id = ?
          AND scope_mm.matter_id = ${alias}.id
          AND scope_mm.user_id = ?
      )
    )`,
    params: [user.firmId, user.id, user.firmId, user.id],
  };
}

function writeScope(user: SessionUser, alias = 'm'): ScopedSql {
  if (canWriteAllFirmMatters(user)) {
    return { clause: `${alias}.firm_id = ?`, params: [user.firmId] };
  }

  return {
    clause: `${alias}.firm_id = ? AND (
      ${alias}.owner_user_id = ? OR EXISTS (
        SELECT 1 FROM matter_members scope_mm
        WHERE scope_mm.firm_id = ?
          AND scope_mm.matter_id = ${alias}.id
          AND scope_mm.user_id = ?
          AND scope_mm.access_level = 'write'
      )
    )`,
    params: [user.firmId, user.id, user.firmId, user.id],
  };
}

function mapMatter(row: Row) {
  return {
    id: String(row.id),
    reference: String(row.reference),
    title: String(row.title),
    clientName: String(row.clientName),
    matterType: String(row.matterType),
    status: String(row.status),
    stage: String(row.stage),
    riskLevel: String(row.riskLevel),
    openedAt: String(row.openedAt),
    description: String(row.description ?? ''),
    externalSource: row.externalSource ? String(row.externalSource) : null,
    externalId: row.externalId ? String(row.externalId) : null,
    importBatchId: row.importBatchId ? String(row.importBatchId) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    owner: {
      id: String(row.ownerId),
      name: String(row.ownerName),
    },
    nextDeadline: row.nextDeadline ? String(row.nextDeadline) : null,
    openTaskCount: Number(row.openTaskCount ?? 0),
  };
}

export function appendTimeline(
  database: DatabaseSync,
  event: {
    firmId: string;
    matterId: string;
    type: string;
    title: string;
    detail?: string;
    actorUserId?: string | null;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  },
): string {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO timeline_events (
        id, firm_id, matter_id, type, title, detail, actor_user_id,
        occurred_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.firmId,
      event.matterId,
      event.type,
      event.title,
      event.detail ?? '',
      event.actorUserId ?? null,
      event.occurredAt,
      JSON.stringify(event.metadata ?? {}),
    );
  return id;
}

export function appendAudit(
  database: DatabaseSync,
  event: {
    firmId: string;
    matterId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    createdAt: string;
    requestId: string;
    ipAddress: string;
  },
): string {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO audit_events (
        id, firm_id, matter_id, user_id, action, entity_type, entity_id,
        before_json, after_json, request_id, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.firmId,
      event.matterId ?? null,
      event.userId ?? null,
      event.action,
      event.entityType,
      event.entityId,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.requestId,
      event.ipAddress,
      event.createdAt,
    );
  return id;
}

export class MatterStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  listFirmUsers(user: SessionUser) {
    return asRows(
      this.database
        .prepare(
          `SELECT id, name, email, role
          FROM users
          WHERE firm_id = ? AND active = 1
          ORDER BY name`,
        )
        .all(user.firmId),
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      role: String(row.role),
    }));
  }

  listMatters(user: SessionUser, search = '') {
    const scope = readScope(user);
    const normalisedSearch = search.trim().toLowerCase();
    const searchClause = normalisedSearch
      ? `AND (
          lower(m.reference) LIKE ? OR lower(m.title) LIKE ? OR
          lower(m.client_name) LIKE ? OR lower(owner.name) LIKE ?
        )`
      : '';
    const searchParams = normalisedSearch
      ? Array<SqlValue>(4).fill(`%${normalisedSearch}%`)
      : [];
    const rows = asRows(
      this.database
        .prepare(
          `SELECT
            m.id, m.reference, m.title, m.client_name AS clientName,
            m.matter_type AS matterType, m.status, m.stage,
            m.risk_level AS riskLevel, m.opened_at AS openedAt,
            m.description, m.external_source AS externalSource,
            m.external_id AS externalId, m.import_batch_id AS importBatchId,
            m.created_at AS createdAt, m.updated_at AS updatedAt,
            owner.id AS ownerId, owner.name AS ownerName,
            (
              SELECT MIN(t.due_at) FROM tasks t
              WHERE t.firm_id = m.firm_id AND t.matter_id = m.id
                AND t.status NOT IN ('completed', 'cancelled')
            ) AS nextDeadline,
            (
              SELECT COUNT(*) FROM tasks t
              WHERE t.firm_id = m.firm_id AND t.matter_id = m.id
                AND t.status NOT IN ('completed', 'cancelled')
            ) AS openTaskCount
          FROM matters m
          JOIN users owner ON owner.id = m.owner_user_id AND owner.firm_id = m.firm_id
          WHERE ${scope.clause} ${searchClause}
          ORDER BY m.updated_at DESC, m.reference`,
        )
        .all(...scope.params, ...searchParams),
    );

    return rows.map(mapMatter);
  }

  canWriteMatter(user: SessionUser, matterId: string): boolean {
    const scope = writeScope(user);
    return Boolean(
      this.database
        .prepare(`SELECT 1 FROM matters m WHERE m.id = ? AND ${scope.clause}`)
        .get(matterId, ...scope.params),
    );
  }

  getMatterAggregate(user: SessionUser, matterId: string) {
    const scope = readScope(user);
    const matterRow = asRow(
      this.database
        .prepare(
          `SELECT
            m.id, m.reference, m.title, m.client_name AS clientName,
            m.matter_type AS matterType, m.status, m.stage,
            m.risk_level AS riskLevel, m.opened_at AS openedAt,
            m.description, m.external_source AS externalSource,
            m.external_id AS externalId, m.import_batch_id AS importBatchId,
            m.created_at AS createdAt, m.updated_at AS updatedAt,
            owner.id AS ownerId, owner.name AS ownerName,
            (
              SELECT MIN(t.due_at) FROM tasks t
              WHERE t.firm_id = m.firm_id AND t.matter_id = m.id
                AND t.status NOT IN ('completed', 'cancelled')
            ) AS nextDeadline,
            (
              SELECT COUNT(*) FROM tasks t
              WHERE t.firm_id = m.firm_id AND t.matter_id = m.id
                AND t.status NOT IN ('completed', 'cancelled')
            ) AS openTaskCount
          FROM matters m
          JOIN users owner ON owner.id = m.owner_user_id AND owner.firm_id = m.firm_id
          WHERE m.id = ? AND ${scope.clause}`,
        )
        .get(matterId, ...scope.params),
    );

    if (!matterRow) return undefined;

    const parties = asRows(
      this.database
        .prepare(
          `SELECT id, kind, name, organisation, email, phone, address,
            external_source AS externalSource, external_id AS externalId,
            created_at AS createdAt
          FROM parties
          WHERE firm_id = ? AND matter_id = ?
          ORDER BY CASE kind WHEN 'client' THEN 0 WHEN 'opponent' THEN 1 ELSE 2 END, name`,
        )
        .all(user.firmId, matterId),
    ).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      organisation: String(row.organisation ?? ''),
      email: String(row.email ?? ''),
      phone: String(row.phone ?? ''),
      address: String(row.address ?? ''),
      externalSource: row.externalSource ? String(row.externalSource) : null,
      externalId: row.externalId ? String(row.externalId) : null,
      createdAt: String(row.createdAt),
    }));

    const tasks = this.listMatterTasks(user.firmId, matterId);

    const documents = asRows(
      this.database
        .prepare(
          `SELECT d.id, d.title, d.category, d.created_at AS createdAt,
            dv.id AS versionId, dv.version, dv.original_name AS originalName,
            dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
            dv.sha256, dv.created_at AS versionCreatedAt, uploader.name AS uploadedByName
          FROM documents d
          LEFT JOIN document_versions dv ON dv.document_id = d.id AND dv.firm_id = d.firm_id
            AND dv.version = (
              SELECT MAX(latest.version) FROM document_versions latest
              WHERE latest.firm_id = d.firm_id AND latest.document_id = d.id
            )
          LEFT JOIN users uploader ON uploader.id = dv.uploaded_by AND uploader.firm_id = dv.firm_id
          WHERE d.firm_id = ? AND d.matter_id = ?
          ORDER BY d.created_at DESC`,
        )
        .all(user.firmId, matterId),
    ).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      category: String(row.category),
      createdAt: String(row.createdAt),
      latestVersion: row.versionId
        ? {
            id: String(row.versionId),
            version: Number(row.version),
            originalName: String(row.originalName),
            mimeType: String(row.mimeType),
            sizeBytes: Number(row.sizeBytes),
            sha256: String(row.sha256),
            createdAt: String(row.versionCreatedAt),
            uploadedByName: String(row.uploadedByName),
          }
        : null,
    }));

    const timeline = asRows(
      this.database
        .prepare(
          `SELECT te.id, te.type, te.title, te.detail, te.occurred_at AS occurredAt,
            te.metadata_json AS metadataJson, actor.name AS actorName
          FROM timeline_events te
          LEFT JOIN users actor ON actor.id = te.actor_user_id AND actor.firm_id = te.firm_id
          WHERE te.firm_id = ? AND te.matter_id = ?
          ORDER BY te.occurred_at DESC, te.id DESC`,
        )
        .all(user.firmId, matterId),
    ).map((row) => ({
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      detail: String(row.detail ?? ''),
      occurredAt: String(row.occurredAt),
      actorName: row.actorName ? String(row.actorName) : 'System',
      metadata: JSON.parse(String(row.metadataJson ?? '{}')) as Record<string, unknown>,
    }));

    const audit = asRows(
      this.database
        .prepare(
          `SELECT ae.id, ae.action, ae.entity_type AS entityType,
            ae.entity_id AS entityId, ae.before_json AS beforeJson,
            ae.after_json AS afterJson, ae.request_id AS requestId,
            ae.ip_address AS ipAddress, ae.created_at AS createdAt,
            actor.name AS actorName
          FROM audit_events ae
          LEFT JOIN users actor ON actor.id = ae.user_id AND actor.firm_id = ae.firm_id
          WHERE ae.firm_id = ? AND ae.matter_id = ?
          ORDER BY ae.created_at DESC, ae.id DESC`,
        )
        .all(user.firmId, matterId),
    ).map((row) => ({
      id: String(row.id),
      action: String(row.action),
      entityType: String(row.entityType),
      entityId: String(row.entityId),
      actorName: row.actorName ? String(row.actorName) : 'System',
      requestId: String(row.requestId),
      ipAddress: String(row.ipAddress),
      createdAt: String(row.createdAt),
    }));

    return {
      matter: mapMatter(matterRow),
      parties,
      tasks,
      documents,
      timeline,
      audit,
      permissions: {
        canWrite: this.canWriteMatter(user, matterId),
        canCreateMatter: canWriteAllFirmMatters(user),
      },
      team: this.listFirmUsers(user),
    };
  }

  createMatter(
    user: SessionUser,
    input: CreateMatterInput,
    auditContext: AuditContext,
  ) {
    const owner = asRow(
      this.database
        .prepare(
          'SELECT id, name FROM users WHERE id = ? AND firm_id = ? AND active = 1',
        )
        .get(input.ownerUserId, user.firmId),
    );
    if (!owner) throw new StoreError('OWNER_NOT_FOUND');

    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO matters (
            id, firm_id, reference, title, client_name, matter_type, status,
            stage, risk_level, owner_user_id, opened_at, description,
            external_source, external_id, import_batch_id, created_by,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          input.reference,
          input.title,
          input.clientName,
          input.matterType,
          input.stage,
          input.riskLevel,
          input.ownerUserId,
          input.openedAt,
          input.description,
          input.externalSource ?? null,
          input.externalId ?? null,
          input.importBatchId ?? null,
          user.id,
          occurredAt,
          occurredAt,
        );
      this.database
        .prepare(
          `INSERT INTO matter_members (
            firm_id, matter_id, user_id, access_level, added_at
          ) VALUES (?, ?, ?, 'write', ?)`,
        )
        .run(user.firmId, id, input.ownerUserId, occurredAt);
      appendTimeline(this.database, {
        firmId: user.firmId,
        matterId: id,
        type: 'matter.created',
        title: 'Matter opened',
        detail: `${input.reference} was opened for ${input.clientName}.`,
        actorUserId: user.id,
        occurredAt,
        metadata: { externalSource: input.externalSource ?? null },
      });
      appendAudit(this.database, {
        firmId: user.firmId,
        matterId: id,
        userId: user.id,
        action: 'matter.created',
        entityType: 'matter',
        entityId: id,
        after: input,
        createdAt: occurredAt,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return this.getMatterAggregate(user, id);
  }

  addParty(
    user: SessionUser,
    matterId: string,
    input: CreatePartyInput,
    auditContext: AuditContext,
  ) {
    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    let timelineId = '';
    let auditId = '';

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO parties (
            id, firm_id, matter_id, kind, name, organisation, email, phone,
            address, external_source, external_id, import_batch_id,
            created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          input.kind,
          input.name,
          input.organisation,
          input.email,
          input.phone,
          input.address,
          input.externalSource ?? null,
          input.externalId ?? null,
          user.id,
          occurredAt,
        );
      timelineId = appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'party.created',
        title: `Added ${input.kind}: ${input.name}`,
        detail: input.organisation,
        actorUserId: user.id,
        occurredAt,
      });
      auditId = appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: user.id,
        action: 'party.created',
        entityType: 'party',
        entityId: id,
        after: input,
        createdAt: occurredAt,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      this.database
        .prepare('UPDATE matters SET updated_at = ? WHERE id = ? AND firm_id = ?')
        .run(occurredAt, matterId, user.firmId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      party: {
        id,
        ...input,
        externalSource: input.externalSource ?? null,
        externalId: input.externalId ?? null,
        createdAt: occurredAt,
      },
      timelineEvent: {
        id: timelineId,
        type: 'party.created',
        title: `Added ${input.kind}: ${input.name}`,
        detail: input.organisation,
        actorName: user.name,
        occurredAt,
      },
      auditEvent: {
        id: auditId,
        action: 'party.created',
        entityType: 'party',
        entityId: id,
        actorName: user.name,
        createdAt: occurredAt,
      },
    };
  }

  addTask(
    user: SessionUser,
    matterId: string,
    input: CreateTaskInput,
    auditContext: AuditContext,
  ) {
    const assignee = this.findFirmUser(user.firmId, input.assigneeUserId);
    if (!assignee) throw new StoreError('ASSIGNEE_NOT_FOUND');

    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    let timelineId = '';
    let auditId = '';
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO tasks (
            id, firm_id, matter_id, title, notes, due_at, priority, status,
            assignee_user_id, completed_at, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          input.title,
          input.notes,
          input.dueAt,
          input.priority,
          input.assigneeUserId,
          user.id,
          occurredAt,
          occurredAt,
        );
      timelineId = appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'task.created',
        title: `Deadline added: ${input.title}`,
        detail: `Assigned to ${String(assignee.name)}.`,
        actorUserId: user.id,
        occurredAt,
        metadata: { dueAt: input.dueAt, priority: input.priority },
      });
      auditId = appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: user.id,
        action: 'task.created',
        entityType: 'task',
        entityId: id,
        after: input,
        createdAt: occurredAt,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      this.database
        .prepare('UPDATE matters SET updated_at = ? WHERE id = ? AND firm_id = ?')
        .run(occurredAt, matterId, user.firmId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      task: {
        id,
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt,
        priority: input.priority,
        status: 'open',
        completedAt: null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        assignee: { id: input.assigneeUserId, name: String(assignee.name) },
      },
      timelineEvent: {
        id: timelineId,
        type: 'task.created',
        title: `Deadline added: ${input.title}`,
        occurredAt,
      },
      auditEvent: {
        id: auditId,
        action: 'task.created',
        entityType: 'task',
        entityId: id,
        createdAt: occurredAt,
      },
    };
  }

  updateTask(
    user: SessionUser,
    matterId: string,
    taskId: string,
    input: UpdateTaskInput,
    auditContext: AuditContext,
  ) {
    const current = asRow(
      this.database
        .prepare(
          `SELECT id, title, notes, due_at AS dueAt, priority, status,
            assignee_user_id AS assigneeUserId, completed_at AS completedAt,
            created_at AS createdAt
          FROM tasks
          WHERE id = ? AND matter_id = ? AND firm_id = ?`,
        )
        .get(taskId, matterId, user.firmId),
    );
    if (!current) return undefined;

    const assigneeId = input.assigneeUserId ?? String(current.assigneeUserId);
    const assignee = this.findFirmUser(user.firmId, assigneeId);
    if (!assignee) throw new StoreError('ASSIGNEE_NOT_FOUND');

    const occurredAt = this.now().toISOString();
    const status = input.status ?? String(current.status);
    const completedAt =
      status === 'completed'
        ? String(current.status) === 'completed'
          ? current.completedAt
          : occurredAt
        : null;
    const next = {
      title: input.title ?? String(current.title),
      notes: input.notes ?? String(current.notes ?? ''),
      dueAt: input.dueAt ?? String(current.dueAt),
      priority: input.priority ?? String(current.priority),
      status,
      assigneeUserId: assigneeId,
      completedAt,
    };
    const timelineType =
      status === 'completed' && String(current.status) !== 'completed'
        ? 'task.completed'
        : 'task.updated';
    const timelineTitle =
      timelineType === 'task.completed'
        ? `Completed: ${next.title}`
        : `Updated deadline: ${next.title}`;
    let timelineId = '';
    let auditId = '';

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE tasks SET title = ?, notes = ?, due_at = ?, priority = ?,
            status = ?, assignee_user_id = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND matter_id = ? AND firm_id = ?`,
        )
        .run(
          next.title,
          next.notes,
          next.dueAt,
          next.priority,
          next.status,
          next.assigneeUserId,
          next.completedAt,
          occurredAt,
          taskId,
          matterId,
          user.firmId,
        );
      timelineId = appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: timelineType,
        title: timelineTitle,
        actorUserId: user.id,
        occurredAt,
        metadata: { status: next.status, dueAt: next.dueAt },
      });
      auditId = appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: user.id,
        action: 'task.updated',
        entityType: 'task',
        entityId: taskId,
        before: current,
        after: next,
        createdAt: occurredAt,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      this.database
        .prepare('UPDATE matters SET updated_at = ? WHERE id = ? AND firm_id = ?')
        .run(occurredAt, matterId, user.firmId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      task: {
        id: taskId,
        ...next,
        createdAt: String(current.createdAt),
        updatedAt: occurredAt,
        assignee: { id: assigneeId, name: String(assignee.name) },
      },
      timelineEvent: {
        id: timelineId,
        type: timelineType,
        title: timelineTitle,
        occurredAt,
      },
      auditEvent: {
        id: auditId,
        action: 'task.updated',
        entityType: 'task',
        entityId: taskId,
        createdAt: occurredAt,
      },
    };
  }

  addDocument(
    user: SessionUser,
    matterId: string,
    input: {
      title: string;
      category: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      storageKey: string;
    },
    auditContext: AuditContext,
  ) {
    const documentId = randomUUID();
    const versionId = randomUUID();
    const occurredAt = this.now().toISOString();
    let timelineId = '';
    let auditId = '';

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO documents (
            id, firm_id, matter_id, title, category, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          documentId,
          user.firmId,
          matterId,
          input.title,
          input.category,
          user.id,
          occurredAt,
        );
      this.database
        .prepare(
          `INSERT INTO document_versions (
            id, firm_id, document_id, version, original_name, mime_type,
            size_bytes, sha256, storage_key, uploaded_by, created_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          user.firmId,
          documentId,
          input.originalName,
          input.mimeType,
          input.sizeBytes,
          input.sha256,
          input.storageKey,
          user.id,
          occurredAt,
        );
      timelineId = appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'document.uploaded',
        title: `Document uploaded: ${input.title}`,
        detail: input.originalName,
        actorUserId: user.id,
        occurredAt,
        metadata: { sha256: input.sha256, version: 1 },
      });
      auditId = appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: user.id,
        action: 'document.uploaded',
        entityType: 'document',
        entityId: documentId,
        after: {
          title: input.title,
          category: input.category,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          version: 1,
        },
        createdAt: occurredAt,
        requestId: auditContext.requestId,
        ipAddress: auditContext.ipAddress,
      });
      this.database
        .prepare('UPDATE matters SET updated_at = ? WHERE id = ? AND firm_id = ?')
        .run(occurredAt, matterId, user.firmId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      document: {
        id: documentId,
        title: input.title,
        category: input.category,
        createdAt: occurredAt,
        latestVersion: {
          id: versionId,
          version: 1,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          createdAt: occurredAt,
          uploadedByName: user.name,
        },
      },
      timelineEvent: {
        id: timelineId,
        type: 'document.uploaded',
        title: `Document uploaded: ${input.title}`,
        occurredAt,
      },
      auditEvent: {
        id: auditId,
        action: 'document.uploaded',
        entityType: 'document',
        entityId: documentId,
        createdAt: occurredAt,
      },
    };
  }

  getDocumentFile(firmId: string, matterId: string, documentId: string) {
    const row = asRow(
      this.database
        .prepare(
          `SELECT dv.storage_key AS storageKey, dv.original_name AS originalName,
            dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
            dv.sha256, dv.version
          FROM documents d
          JOIN document_versions dv ON dv.document_id = d.id AND dv.firm_id = d.firm_id
          WHERE d.id = ? AND d.matter_id = ? AND d.firm_id = ?
          ORDER BY dv.version DESC
          LIMIT 1`,
        )
        .get(documentId, matterId, firmId),
    );
    if (!row) return undefined;
    return {
      storageKey: String(row.storageKey),
      originalName: String(row.originalName),
      mimeType: String(row.mimeType),
      sizeBytes: Number(row.sizeBytes),
      sha256: String(row.sha256),
      version: Number(row.version),
    };
  }

  getDashboard(user: SessionUser) {
    const matters = this.listMatters(user);
    const matterIds = new Set(matters.map((matter) => matter.id));
    const scope = readScope(user);
    const tasks = asRows(
      this.database
        .prepare(
          `SELECT t.id, t.matter_id AS matterId, t.title, t.due_at AS dueAt,
            t.priority, t.status, t.assignee_user_id AS assigneeId,
            assignee.name AS assigneeName, m.reference, m.title AS matterTitle
          FROM tasks t
          JOIN matters m ON m.id = t.matter_id AND m.firm_id = t.firm_id
          JOIN users assignee ON assignee.id = t.assignee_user_id AND assignee.firm_id = t.firm_id
          WHERE ${scope.clause} AND t.status NOT IN ('completed', 'cancelled')
          ORDER BY t.due_at ASC`,
        )
        .all(...scope.params),
    )
      .filter((row) => matterIds.has(String(row.matterId)))
      .map((row) => ({
        id: String(row.id),
        matterId: String(row.matterId),
        title: String(row.title),
        dueAt: String(row.dueAt),
        priority: String(row.priority),
        status: String(row.status),
        assignee: { id: String(row.assigneeId), name: String(row.assigneeName) },
        matter: { reference: String(row.reference), title: String(row.matterTitle) },
      }));
    const now = this.now();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);

    return {
      summary: {
        activeMatters: matters.filter((matter) => matter.status === 'open').length,
        overdueTasks: tasks.filter((task) => new Date(task.dueAt) < now).length,
        dueThisWeek: tasks.filter((task) => {
          const due = new Date(task.dueAt);
          return due >= now && due < weekEnd;
        }).length,
        highRiskMatters: matters.filter(
          (matter) => matter.riskLevel === 'high' || matter.riskLevel === 'critical',
        ).length,
      },
      urgentTasks: tasks.slice(0, 6),
      recentMatters: matters.slice(0, 4),
      team: this.listFirmUsers(user),
    };
  }

  private listMatterTasks(firmId: string, matterId: string) {
    return asRows(
      this.database
        .prepare(
          `SELECT t.id, t.title, t.notes, t.due_at AS dueAt, t.priority,
            t.status, t.completed_at AS completedAt, t.created_at AS createdAt,
            t.updated_at AS updatedAt, assignee.id AS assigneeId,
            assignee.name AS assigneeName
          FROM tasks t
          JOIN users assignee ON assignee.id = t.assignee_user_id AND assignee.firm_id = t.firm_id
          WHERE t.firm_id = ? AND t.matter_id = ?
          ORDER BY
            CASE t.status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,
            t.due_at ASC`,
        )
        .all(firmId, matterId),
    ).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      notes: String(row.notes ?? ''),
      dueAt: String(row.dueAt),
      priority: String(row.priority),
      status: String(row.status),
      completedAt: row.completedAt ? String(row.completedAt) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      assignee: { id: String(row.assigneeId), name: String(row.assigneeName) },
    }));
  }

  private findFirmUser(firmId: string, userId: string): Row | undefined {
    return asRow(
      this.database
        .prepare('SELECT id, name FROM users WHERE id = ? AND firm_id = ? AND active = 1')
        .get(userId, firmId),
    );
  }
}

export class StoreError extends Error {
  constructor(public readonly code: 'OWNER_NOT_FOUND' | 'ASSIGNEE_NOT_FOUND') {
    super(code);
    this.name = 'StoreError';
  }
}
