import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CreateAccessEventInput,
  CreateDefectInput,
  CreateEvidenceItemInput,
  CreateNoticeInput,
  UpdateDefectInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline } from '../store.js';
import type {
  AccessEventRecord,
  Defect,
  DefectStatusEvent,
  EvidenceDocumentVersion,
  EvidenceItem,
  EvidenceMutationContext,
  EvidenceReadiness,
  EvidenceRisk,
  EvidenceWorkspace,
  NoticeRecord,
} from './types.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export class EvidenceStateConflictError extends Error {
  constructor() {
    super('The evidence record changed before this update was saved.');
    this.name = 'EvidenceStateConflictError';
  }
}

export class EvidenceIdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key has already been used with different data.');
    this.name = 'EvidenceIdempotencyConflictError';
  }
}

export class EvidenceRecordNotFoundError extends Error {
  constructor() {
    super('The evidence investigation record was not found.');
    this.name = 'EvidenceRecordNotFoundError';
  }
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function canonicalJson(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return input;
  }
  return JSON.stringify(canonical(value));
}

function parseStringArray(value: SqlValue): string[] {
  const parsed = JSON.parse(String(value ?? '[]')) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function mapDocumentVersion(record: Row): EvidenceDocumentVersion {
  return {
    id: String(record.documentVersionId),
    documentId: String(record.documentId),
    documentTitle: String(record.documentTitle),
    category: String(record.documentCategory),
    version: Number(record.documentVersion),
    originalName: String(record.originalName),
    mimeType: String(record.mimeType),
    sizeBytes: Number(record.sizeBytes),
    sha256: String(record.sha256),
    createdAt: String(record.documentVersionCreatedAt),
  };
}

export class EvidenceStore {
  constructor(private readonly database: DatabaseSync) {}

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.read')) return false;
    if (canReadAllFirmMatters(user)) {
      return Boolean(
        this.database
          .prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
          .get(matterId, user.firmId),
      );
    }
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM matters m
           WHERE m.id = ? AND m.firm_id = ? AND (
             m.owner_user_id = ? OR EXISTS (
               SELECT 1 FROM matter_members mm
               WHERE mm.firm_id = m.firm_id AND mm.matter_id = m.id
                 AND mm.user_id = ?
             )
           )`,
        )
        .get(matterId, user.firmId, user.id, user.id),
    );
  }

  private canWriteMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.write')) return false;
    if (canWriteAllFirmMatters(user)) {
      return Boolean(
        this.database
          .prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
          .get(matterId, user.firmId),
      );
    }
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM matters m
           WHERE m.id = ? AND m.firm_id = ? AND (
             m.owner_user_id = ? OR EXISTS (
               SELECT 1 FROM matter_members mm
               WHERE mm.firm_id = m.firm_id AND mm.matter_id = m.id
                 AND mm.user_id = ? AND mm.access_level = 'write'
             )
           )`,
        )
        .get(matterId, user.firmId, user.id, user.id),
    );
  }

  private requireWrite(
    user: SessionUser,
    matterId: string,
    context: EvidenceMutationContext,
  ): void {
    if (context.actorUserId !== user.id || !this.canWriteMatter(user, matterId)) {
      throw new EvidenceRecordNotFoundError();
    }
  }

  private listDefects(firmId: string, matterId: string): Defect[] {
    const statusEvents = rows(
      this.database
        .prepare(
          `SELECT id, defect_id AS defectId, from_status AS fromStatus,
             to_status AS toStatus, reason, actor_user_id AS actorUserId,
             occurred_at AS occurredAt
           FROM defect_status_events
           WHERE firm_id = ? AND matter_id = ?
           ORDER BY occurred_at, rowid`,
        )
        .all(firmId, matterId),
    );
    const eventsByDefect = new Map<string, DefectStatusEvent[]>();
    for (const event of statusEvents) {
      const defectId = String(event.defectId);
      const mapped: DefectStatusEvent = {
        id: String(event.id),
        fromStatus: event.fromStatus
          ? (String(event.fromStatus) as Defect['status'])
          : null,
        toStatus: String(event.toStatus) as Defect['status'],
        reason: String(event.reason),
        actorUserId: String(event.actorUserId),
        occurredAt: String(event.occurredAt),
      };
      eventsByDefect.set(defectId, [
        ...(eventsByDefect.get(defectId) ?? []),
        mapped,
      ]);
    }
    const links = rows(
      this.database
        .prepare(
          `SELECT defect_id AS targetId, evidence_item_id AS evidenceId
           FROM defect_evidence_links WHERE firm_id = ? AND matter_id = ?`,
        )
        .all(firmId, matterId),
    );
    const evidenceByDefect = this.groupLinks(links);

    return rows(
      this.database
        .prepare(
          `SELECT id, version, location, category, title, description,
             severity, status, first_observed_on AS firstObservedOn,
             health_impact AS healthImpact, hazard_tags_json AS hazardTagsJson,
             created_by AS createdBy, created_at AS createdAt,
             updated_by AS updatedBy, updated_at AS updatedAt
           FROM defects WHERE firm_id = ? AND matter_id = ?
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'serious' THEN 1
             WHEN 'moderate' THEN 2 ELSE 3 END, location, created_at`,
        )
        .all(firmId, matterId),
    ).map((record) => ({
      id: String(record.id),
      version: Number(record.version),
      location: String(record.location),
      category: String(record.category) as Defect['category'],
      title: String(record.title),
      description: String(record.description),
      severity: String(record.severity) as Defect['severity'],
      status: String(record.status) as Defect['status'],
      firstObservedOn: record.firstObservedOn
        ? String(record.firstObservedOn)
        : null,
      healthImpact: String(record.healthImpact),
      hazardTags: parseStringArray(record.hazardTagsJson),
      createdBy: String(record.createdBy),
      createdAt: String(record.createdAt),
      updatedBy: String(record.updatedBy),
      updatedAt: String(record.updatedAt),
      evidenceIds: evidenceByDefect.get(String(record.id)) ?? [],
      statusEvents: eventsByDefect.get(String(record.id)) ?? [],
    }));
  }

  private groupLinks(linkRows: Row[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const link of linkRows) {
      const targetId = String(link.targetId);
      grouped.set(targetId, [
        ...(grouped.get(targetId) ?? []),
        String(link.evidenceId),
      ]);
    }
    return grouped;
  }

  private listNotices(firmId: string, matterId: string): NoticeRecord[] {
    const evidenceByNotice = this.groupLinks(
      rows(
        this.database
          .prepare(
            `SELECT notice_id AS targetId, evidence_item_id AS evidenceId
             FROM notice_evidence_links WHERE firm_id = ? AND matter_id = ?`,
          )
          .all(firmId, matterId),
      ),
    );
    return rows(
      this.database
        .prepare(
          `SELECT id, occurred_at AS occurredAt, channel,
             recipient_type AS recipientType, recipient_name AS recipientName,
             summary, proof_status AS proofStatus,
             response_status AS responseStatus,
             response_summary AS responseSummary,
             supersedes_notice_id AS supersedesNoticeId,
             created_by AS createdBy, created_at AS createdAt
           FROM notices WHERE firm_id = ? AND matter_id = ?
           ORDER BY occurred_at DESC, created_at DESC`,
        )
        .all(firmId, matterId),
    ).map((record) => ({
      id: String(record.id),
      occurredAt: String(record.occurredAt),
      channel: String(record.channel) as NoticeRecord['channel'],
      recipientType: String(record.recipientType) as NoticeRecord['recipientType'],
      recipientName: String(record.recipientName),
      summary: String(record.summary),
      proofStatus: String(record.proofStatus) as NoticeRecord['proofStatus'],
      responseStatus: String(record.responseStatus) as NoticeRecord['responseStatus'],
      responseSummary: String(record.responseSummary),
      supersedesNoticeId: record.supersedesNoticeId
        ? String(record.supersedesNoticeId)
        : null,
      createdBy: String(record.createdBy),
      createdAt: String(record.createdAt),
      evidenceIds: evidenceByNotice.get(String(record.id)) ?? [],
    }));
  }

  private listAccessEvents(
    firmId: string,
    matterId: string,
  ): AccessEventRecord[] {
    const evidenceByAccess = this.groupLinks(
      rows(
        this.database
          .prepare(
            `SELECT access_event_id AS targetId, evidence_item_id AS evidenceId
             FROM access_evidence_links WHERE firm_id = ? AND matter_id = ?`,
          )
          .all(firmId, matterId),
      ),
    );
    return rows(
      this.database
        .prepare(
          `SELECT id, event_type AS eventType, appointment_at AS appointmentAt,
             notes, supersedes_access_event_id AS supersedesAccessEventId,
             created_by AS createdBy, created_at AS createdAt
           FROM access_events WHERE firm_id = ? AND matter_id = ?
           ORDER BY COALESCE(appointment_at, created_at) DESC, created_at DESC`,
        )
        .all(firmId, matterId),
    ).map((record) => ({
      id: String(record.id),
      eventType: String(record.eventType) as AccessEventRecord['eventType'],
      appointmentAt: record.appointmentAt
        ? String(record.appointmentAt)
        : null,
      notes: String(record.notes),
      supersedesAccessEventId: record.supersedesAccessEventId
        ? String(record.supersedesAccessEventId)
        : null,
      createdBy: String(record.createdBy),
      createdAt: String(record.createdAt),
      evidenceIds: evidenceByAccess.get(String(record.id)) ?? [],
    }));
  }

  private documentVersionRows(firmId: string, matterId: string): Row[] {
    return rows(
      this.database
        .prepare(
          `SELECT dv.id AS documentVersionId, d.id AS documentId,
             d.title AS documentTitle, d.category AS documentCategory,
             dv.version AS documentVersion, dv.original_name AS originalName,
             dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
             dv.sha256, dv.created_at AS documentVersionCreatedAt
           FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
           WHERE d.firm_id = ? AND d.matter_id = ?
           ORDER BY d.title, dv.version DESC`,
        )
        .all(firmId, matterId),
    );
  }

  private listEvidenceItems(firmId: string, matterId: string): EvidenceItem[] {
    const defectLinks = this.groupEvidenceTargets('defect_evidence_links', 'defect_id', firmId, matterId);
    const noticeLinks = this.groupEvidenceTargets('notice_evidence_links', 'notice_id', firmId, matterId);
    const accessLinks = this.groupEvidenceTargets('access_evidence_links', 'access_event_id', firmId, matterId);
    return rows(
      this.database
        .prepare(
          `SELECT ei.id, ei.kind, ei.title, ei.description,
             ei.occurred_on AS occurredOn,
             ei.provenance_source AS provenanceSource,
             ei.provenance_detail AS provenanceDetail,
             ei.created_by AS createdBy, ei.created_at AS createdAt,
             dv.id AS documentVersionId, d.id AS documentId,
             d.title AS documentTitle, d.category AS documentCategory,
             dv.version AS documentVersion, dv.original_name AS originalName,
             dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
             dv.sha256, dv.created_at AS documentVersionCreatedAt
           FROM evidence_items ei
           JOIN document_versions dv
             ON dv.id = ei.document_version_id AND dv.firm_id = ei.firm_id
           JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
           WHERE ei.firm_id = ? AND ei.matter_id = ?
           ORDER BY COALESCE(ei.occurred_on, ei.created_at) DESC, ei.created_at DESC`,
        )
        .all(firmId, matterId),
    ).map((record) => ({
      id: String(record.id),
      kind: String(record.kind) as EvidenceItem['kind'],
      title: String(record.title),
      description: String(record.description),
      occurredOn: record.occurredOn ? String(record.occurredOn) : null,
      provenanceSource: String(record.provenanceSource) as EvidenceItem['provenanceSource'],
      provenanceDetail: String(record.provenanceDetail),
      documentVersion: mapDocumentVersion(record),
      defectIds: defectLinks.get(String(record.id)) ?? [],
      noticeIds: noticeLinks.get(String(record.id)) ?? [],
      accessEventIds: accessLinks.get(String(record.id)) ?? [],
      createdBy: String(record.createdBy),
      createdAt: String(record.createdAt),
    }));
  }

  private groupEvidenceTargets(
    table: string,
    targetColumn: string,
    firmId: string,
    matterId: string,
  ): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const link of rows(
      this.database
        .prepare(
          `SELECT evidence_item_id AS evidenceId, ${targetColumn} AS targetId
           FROM ${table} WHERE firm_id = ? AND matter_id = ?`,
        )
        .all(firmId, matterId),
    )) {
      const evidenceId = String(link.evidenceId);
      grouped.set(evidenceId, [
        ...(grouped.get(evidenceId) ?? []),
        String(link.targetId),
      ]);
    }
    return grouped;
  }

  getWorkspace(
    user: SessionUser,
    matterId: string,
  ): EvidenceWorkspace | undefined {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const defects = this.listDefects(user.firmId, matterId);
    const notices = this.listNotices(user.firmId, matterId);
    const accessEvents = this.listAccessEvents(user.firmId, matterId);
    const evidenceItems = this.listEvidenceItems(user.firmId, matterId);
    const readiness = this.calculateReadiness(defects, notices, evidenceItems);
    return {
      matterId,
      permissions: { canWrite: this.canWriteMatter(user, matterId) },
      defects,
      notices,
      accessEvents,
      evidenceItems,
      availableDocumentVersions: this.documentVersionRows(
        user.firmId,
        matterId,
      ).map(mapDocumentVersion),
      readiness,
      risks: this.calculateRisks(
        defects,
        notices,
        accessEvents,
        evidenceItems,
        readiness,
      ),
    };
  }

  getEvidenceReadiness(firmId: string, matterId: string): EvidenceReadiness {
    const defects = this.listDefects(firmId, matterId);
    const notices = this.listNotices(firmId, matterId);
    const evidenceItems = this.listEvidenceItems(firmId, matterId);
    return this.calculateReadiness(defects, notices, evidenceItems);
  }

  private calculateReadiness(
    defects: Defect[],
    notices: NoticeRecord[],
    evidenceItems: EvidenceItem[],
  ): EvidenceReadiness {
    const activeDefects = defects.filter(
      ({ status }) => status !== 'repaired' && status !== 'superseded',
    );
    const activeIds = new Set(activeDefects.map(({ id }) => id));
    const hasPhotograph = evidenceItems.some(
      (item) =>
        item.kind === 'photograph' &&
        item.defectIds.some((id) => activeIds.has(id)),
    );
    return {
      controls: [
        {
          key: 'defect_schedule_recorded',
          eligible: activeDefects.length > 0,
          explanation:
            activeDefects.length > 0
              ? 'The active defect schedule is structured.'
              : 'Record at least one active defect.',
        },
        {
          key: 'notice_evidence_recorded',
          eligible: notices.some(({ proofStatus }) => proofStatus !== 'unknown'),
          explanation:
            notices.length > 0
              ? 'Record an explicit proof position for a notice.'
              : 'Record the landlord notice history.',
        },
        {
          key: 'photographs_recorded',
          eligible: hasPhotograph,
          explanation: hasPhotograph
            ? 'A preserved photograph is linked to an active defect.'
            : 'Link at least one preserved photograph to an active defect.',
        },
      ],
    };
  }

  private calculateRisks(
    defects: Defect[],
    notices: NoticeRecord[],
    accessEvents: AccessEventRecord[],
    evidenceItems: EvidenceItem[],
    readiness: EvidenceReadiness,
  ): EvidenceRisk[] {
    const risks: EvidenceRisk[] = [];
    const active = defects.filter(
      ({ status }) => status !== 'repaired' && status !== 'superseded',
    );
    for (const defect of active) {
      if (defect.severity === 'serious' || defect.severity === 'critical') {
        risks.push({
          key: `serious_open_defect:${defect.id}`,
          type: 'serious_open_defect',
          level: defect.severity === 'critical' ? 'critical' : 'high',
          title: `${defect.severity === 'critical' ? 'Critical' : 'Serious'} unresolved defect`,
          detail: `${defect.location}: ${defect.title}`,
          entityId: defect.id,
        });
      }
      if (defect.evidenceIds.length === 0) {
        risks.push({
          key: `defect_without_evidence:${defect.id}`,
          type: 'defect_without_evidence',
          level: 'high',
          title: 'Defect has no linked evidence',
          detail: `${defect.location}: ${defect.title}`,
          entityId: defect.id,
        });
      }
    }
    if (notices.length === 0) {
      risks.push({
        key: 'notice_evidence_missing:matter',
        type: 'notice_evidence_missing',
        level: 'high',
        title: 'Notice history is missing',
        detail: 'Record how and when the landlord was notified.',
        entityId: null,
      });
    }
    for (const notice of notices.filter(({ proofStatus }) =>
      ['unknown', 'unavailable'].includes(proofStatus),
    )) {
      risks.push({
        key: `notice_proof_gap:${notice.id}`,
        type: 'notice_proof_gap',
        level: 'high',
        title: 'Notice proof gap',
        detail: `${notice.recipientName}: ${notice.proofStatus.replace('_', ' ')}`,
        entityId: notice.id,
      });
    }
    for (const access of accessEvents.filter(({ eventType }) =>
      ['refused_by_landlord', 'refused_by_client', 'no_access'].includes(
        eventType,
      ),
    )) {
      risks.push({
        key: `failed_access:${access.id}`,
        type: 'failed_access',
        level: 'medium',
        title: 'Access did not complete',
        detail: access.notes,
        entityId: access.id,
      });
    }
    if (
      active.length > 0 &&
      !evidenceItems.some(
        ({ kind, defectIds }) =>
          kind === 'photograph' &&
          defectIds.some((id) => active.some((defect) => defect.id === id)),
      )
    ) {
      risks.push({
        key: 'photographs_missing:matter',
        type: 'photographs_missing',
        level: 'high',
        title: 'No preserved photograph is linked',
        detail: 'Link an exact document version to an active defect.',
        entityId: null,
      });
    }
    for (const control of readiness.controls.filter(
      ({ eligible }) => !eligible,
    )) {
      risks.push({
        key: `ineligible_control:${control.key}`,
        type: 'ineligible_control',
        level: 'medium',
        title: 'Evidence readiness control is not eligible',
        detail: control.explanation,
        entityId: null,
      });
    }
    return risks;
  }

  createDefect(
    user: SessionUser,
    matterId: string,
    input: CreateDefectInput,
    context: EvidenceMutationContext,
  ): Defect {
    this.requireWrite(user, matterId, context);
    const id = randomUUID();
    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO defects (
            id, firm_id, matter_id, version, location, category, title,
            description, severity, status, first_observed_on, health_impact,
            hazard_tags_json, created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          input.location,
          input.category,
          input.title,
          input.description,
          input.severity,
          input.firstObservedOn,
          input.healthImpact,
          JSON.stringify(input.hazardTags),
          context.actorUserId,
          context.occurredAt,
          context.actorUserId,
          context.occurredAt,
        );
      this.database
        .prepare(
          `INSERT INTO defect_status_events (
            id, firm_id, matter_id, defect_id, from_status, to_status,
            reason, actor_user_id, occurred_at
          ) VALUES (?, ?, ?, ?, NULL, 'open', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          user.firmId,
          matterId,
          id,
          'Defect recorded in the investigation schedule.',
          context.actorUserId,
          context.occurredAt,
        );
      appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'evidence.defect_created',
        title: 'Defect recorded',
        detail: `${input.location}: ${input.title}`,
        actorUserId: context.actorUserId,
        occurredAt: context.occurredAt,
        metadata: { defectId: id },
      });
      appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: context.actorUserId,
        action: 'evidence.defect_created',
        entityType: 'defect',
        entityId: id,
        after: { id, ...input, version: 1, status: 'open' },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        createdAt: context.occurredAt,
      });
    });
    return this.listDefects(user.firmId, matterId).find(
      (defect) => defect.id === id,
    )!;
  }

  updateDefect(
    user: SessionUser,
    matterId: string,
    defectId: string,
    input: UpdateDefectInput,
    context: EvidenceMutationContext,
  ): Defect {
    this.requireWrite(user, matterId, context);
    transaction(this.database, () => {
      const before = this.listDefects(user.firmId, matterId).find(
        ({ id }) => id === defectId,
      );
      if (!before) throw new EvidenceRecordNotFoundError();
      const result = this.database
        .prepare(
          `UPDATE defects SET version = version + 1, location = ?, category = ?,
             title = ?, description = ?, severity = ?, status = ?,
             first_observed_on = ?, health_impact = ?, hazard_tags_json = ?,
             updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`,
        )
        .run(
          input.location,
          input.category,
          input.title,
          input.description,
          input.severity,
          input.status,
          input.firstObservedOn,
          input.healthImpact,
          JSON.stringify(input.hazardTags),
          context.actorUserId,
          context.occurredAt,
          defectId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (Number(result.changes) === 0) throw new EvidenceStateConflictError();
      if (before.status !== input.status) {
        this.database
          .prepare(
            `INSERT INTO defect_status_events (
              id, firm_id, matter_id, defect_id, from_status, to_status,
              reason, actor_user_id, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            user.firmId,
            matterId,
            defectId,
            before.status,
            input.status,
            input.statusReason,
            context.actorUserId,
            context.occurredAt,
          );
      }
      const after = this.listDefects(user.firmId, matterId).find(
        ({ id }) => id === defectId,
      );
      appendTimeline(this.database, {
        firmId: user.firmId,
        matterId,
        type: 'evidence.defect_updated',
        title: 'Defect updated',
        detail: `${input.location}: ${input.title}`,
        actorUserId: context.actorUserId,
        occurredAt: context.occurredAt,
        metadata: { defectId, version: after?.version },
      });
      appendAudit(this.database, {
        firmId: user.firmId,
        matterId,
        userId: context.actorUserId,
        action: 'evidence.defect_updated',
        entityType: 'defect',
        entityId: defectId,
        before,
        after,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        createdAt: context.occurredAt,
      });
    });
    return this.listDefects(user.firmId, matterId).find(
      ({ id }) => id === defectId,
    )!;
  }

  createNotice(
    user: SessionUser,
    matterId: string,
    input: CreateNoticeInput,
    context: EvidenceMutationContext,
  ): NoticeRecord {
    this.requireWrite(user, matterId, context);
    const payload = canonicalJson(input);
    const id = transaction(this.database, () => {
      const replay = row(
        this.database
          .prepare(
            `SELECT id, command_payload_json AS payload FROM notices
             WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, matterId, input.idempotencyKey),
      );
      if (replay) {
        if (String(replay.payload) !== payload)
          throw new EvidenceIdempotencyConflictError();
        return String(replay.id);
      }
      if (
        input.supersedesNoticeId &&
        !this.targetExists('notices', input.supersedesNoticeId, user.firmId, matterId)
      ) {
        throw new EvidenceRecordNotFoundError();
      }
      const createdId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO notices (
            id, firm_id, matter_id, occurred_at, channel, recipient_type,
            recipient_name, summary, proof_status, response_status,
            response_summary, supersedes_notice_id, idempotency_key,
            command_payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          createdId,
          user.firmId,
          matterId,
          input.occurredAt,
          input.channel,
          input.recipientType,
          input.recipientName,
          input.summary,
          input.proofStatus,
          input.responseStatus,
          input.responseSummary,
          input.supersedesNoticeId,
          input.idempotencyKey,
          payload,
          context.actorUserId,
          context.occurredAt,
        );
      this.appendCreatedEvent(user.firmId, matterId, context, {
        action: 'evidence.notice_created',
        entityType: 'notice',
        entityId: createdId,
        title: 'Notice event recorded',
        detail: input.summary,
        after: { id: createdId, ...input },
      });
      return createdId;
    });
    return this.listNotices(user.firmId, matterId).find(({ id: value }) => value === id)!;
  }

  createAccessEvent(
    user: SessionUser,
    matterId: string,
    input: CreateAccessEventInput,
    context: EvidenceMutationContext,
  ): AccessEventRecord {
    this.requireWrite(user, matterId, context);
    const payload = canonicalJson(input);
    const id = transaction(this.database, () => {
      const replay = row(
        this.database
          .prepare(
            `SELECT id, command_payload_json AS payload FROM access_events
             WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, matterId, input.idempotencyKey),
      );
      if (replay) {
        if (String(replay.payload) !== payload)
          throw new EvidenceIdempotencyConflictError();
        return String(replay.id);
      }
      if (
        input.supersedesAccessEventId &&
        !this.targetExists('access_events', input.supersedesAccessEventId, user.firmId, matterId)
      ) {
        throw new EvidenceRecordNotFoundError();
      }
      const createdId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO access_events (
            id, firm_id, matter_id, event_type, appointment_at, notes,
            supersedes_access_event_id, idempotency_key,
            command_payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          createdId,
          user.firmId,
          matterId,
          input.eventType,
          input.appointmentAt,
          input.notes,
          input.supersedesAccessEventId,
          input.idempotencyKey,
          payload,
          context.actorUserId,
          context.occurredAt,
        );
      this.appendCreatedEvent(user.firmId, matterId, context, {
        action: 'evidence.access_created',
        entityType: 'access_event',
        entityId: createdId,
        title: 'Access event recorded',
        detail: input.notes,
        after: { id: createdId, ...input },
      });
      return createdId;
    });
    return this.listAccessEvents(user.firmId, matterId).find(({ id: value }) => value === id)!;
  }

  createEvidenceItem(
    user: SessionUser,
    matterId: string,
    input: CreateEvidenceItemInput,
    context: EvidenceMutationContext,
  ): EvidenceItem {
    this.requireWrite(user, matterId, context);
    const payload = canonicalJson(input);
    const id = transaction(this.database, () => {
      const replay = row(
        this.database
          .prepare(
            `SELECT id, command_payload_json AS payload FROM evidence_items
             WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, matterId, input.idempotencyKey),
      );
      if (replay) {
        if (String(replay.payload) !== payload)
          throw new EvidenceIdempotencyConflictError();
        return String(replay.id);
      }
      const version = row(
        this.database
          .prepare(
            `SELECT 1 FROM document_versions dv
             JOIN documents d
               ON d.id = dv.document_id AND d.firm_id = dv.firm_id
             WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`,
          )
          .get(input.documentVersionId, user.firmId, matterId),
      );
      if (!version) throw new EvidenceRecordNotFoundError();
      this.requireTargets('defects', input.defectIds, user.firmId, matterId);
      this.requireTargets('notices', input.noticeIds, user.firmId, matterId);
      this.requireTargets('access_events', input.accessEventIds, user.firmId, matterId);

      const createdId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO evidence_items (
            id, firm_id, matter_id, kind, title, description, occurred_on,
            provenance_source, provenance_detail, document_version_id,
            idempotency_key, command_payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          createdId,
          user.firmId,
          matterId,
          input.kind,
          input.title,
          input.description,
          input.occurredOn,
          input.provenanceSource,
          input.provenanceDetail,
          input.documentVersionId,
          input.idempotencyKey,
          payload,
          context.actorUserId,
          context.occurredAt,
        );
      this.insertLinks(
        'defect_evidence_links',
        'defect_id',
        input.defectIds,
        createdId,
        user.firmId,
        matterId,
        context,
      );
      this.insertLinks(
        'notice_evidence_links',
        'notice_id',
        input.noticeIds,
        createdId,
        user.firmId,
        matterId,
        context,
      );
      this.insertLinks(
        'access_evidence_links',
        'access_event_id',
        input.accessEventIds,
        createdId,
        user.firmId,
        matterId,
        context,
      );
      this.appendCreatedEvent(user.firmId, matterId, context, {
        action: 'evidence.item_created',
        entityType: 'evidence_item',
        entityId: createdId,
        title: 'Evidence item linked',
        detail: input.title,
        after: { id: createdId, ...input },
      });
      return createdId;
    });
    return this.listEvidenceItems(user.firmId, matterId).find(({ id: value }) => value === id)!;
  }

  private targetExists(
    table: string,
    id: string,
    firmId: string,
    matterId: string,
  ): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM ${table} WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(id, firmId, matterId),
    );
  }

  private requireTargets(
    table: string,
    ids: string[],
    firmId: string,
    matterId: string,
  ): void {
    for (const id of ids) {
      if (!this.targetExists(table, id, firmId, matterId)) {
        throw new EvidenceRecordNotFoundError();
      }
    }
  }

  private insertLinks(
    table: string,
    targetColumn: string,
    targetIds: string[],
    evidenceId: string,
    firmId: string,
    matterId: string,
    context: EvidenceMutationContext,
  ): void {
    const statement = this.database.prepare(
      `INSERT INTO ${table} (
        firm_id, matter_id, evidence_item_id, ${targetColumn}, linked_by, linked_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const targetId of targetIds) {
      statement.run(
        firmId,
        matterId,
        evidenceId,
        targetId,
        context.actorUserId,
        context.occurredAt,
      );
    }
  }

  private appendCreatedEvent(
    firmId: string,
    matterId: string,
    context: EvidenceMutationContext,
    event: {
      action: string;
      entityType: string;
      entityId: string;
      title: string;
      detail: string;
      after: unknown;
    },
  ): void {
    appendTimeline(this.database, {
      firmId,
      matterId,
      type: event.action,
      title: event.title,
      detail: event.detail,
      actorUserId: context.actorUserId,
      occurredAt: context.occurredAt,
      metadata: { entityId: event.entityId },
    });
    appendAudit(this.database, {
      firmId,
      matterId,
      userId: context.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      after: event.after,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      createdAt: context.occurredAt,
    });
  }
}

