import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  AppendCommunicationDraftVersionInput,
  CreateCommunicationDraftInput,
  DispatchCommunicationInput,
  RecordCommunicationCallInput,
  RecordCommunicationInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import type { VerifiedProviderEvent } from './provider.js';
import { projectTransportState } from './projection.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export type CommunicationStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_LINK'
  | 'IDEMPOTENCY_KEY_REUSED';

export class CommunicationStoreError extends Error {
  constructor(
    readonly code: CommunicationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationStoreError';
  }
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function parseJson<T>(value: SqlValue, fallback: T): T {
  try {
    return JSON.parse(String(value ?? '')) as T;
  } catch {
    return fallback;
  }
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

function payloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
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

interface WorkspaceAccess {
  readPrivileged: boolean;
  readProtected: boolean;
}

interface ApprovalCommand {
  draftVersionId: string;
  decision: 'submitted' | 'approved' | 'rejected' | 'approval_revoked';
  note: string;
  idempotencyKey: string;
}

export class CommunicationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (canReadAllFirmMatters(user)) {
      return Boolean(
        this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?').get(matterId, user.firmId),
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
    if (canWriteAllFirmMatters(user)) {
      return Boolean(
        this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?').get(matterId, user.firmId),
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

  private requireWrite(user: SessionUser, matterId: string): void {
    if (!this.canWriteMatter(user, matterId)) {
      throw new CommunicationStoreError('NOT_FOUND', 'The requested resource was not found.');
    }
  }

  private resolveDocumentVersions(
    firmId: string,
    matterId: string,
    versionIds: readonly string[],
  ): Array<{
    documentId: string;
    documentVersionId: string;
    fileName: string;
    mimeType: string;
    sha256: string;
  }> {
    return [...new Set(versionIds)].map((versionId) => {
      const found = row(
        this.database
          .prepare(
            `SELECT d.id AS documentId, dv.id AS documentVersionId,
              dv.original_name AS fileName, dv.mime_type AS mimeType, dv.sha256
             FROM document_versions dv
             JOIN documents d
               ON d.id = dv.document_id AND d.firm_id = dv.firm_id
             WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`,
          )
          .get(versionId, firmId, matterId),
      );
      if (!found) {
        throw new CommunicationStoreError('INVALID_LINK', 'The document version was not found.');
      }
      return {
        documentId: String(found.documentId),
        documentVersionId: String(found.documentVersionId),
        fileName: String(found.fileName),
        mimeType: String(found.mimeType),
        sha256: String(found.sha256),
      };
    });
  }

  private createConversation(
    user: SessionUser,
    matterId: string,
    input: {
      channel: string;
      subject: string;
      confidentiality: string;
      participants: Array<{
        role: string;
        displayName: string;
        endpointType: string;
        endpoint: string;
        partyId?: string | null;
        userId?: string | null;
      }>;
      providerKey?: string | null;
      externalThreadId?: string | null;
    },
    createdAt: string,
  ): string {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO communication_conversations (
          id, firm_id, matter_id, channel, subject, confidentiality,
          status, provider_key, external_thread_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.firmId,
        matterId,
        input.channel,
        input.subject,
        input.confidentiality,
        input.providerKey ?? null,
        input.externalThreadId ?? null,
        user.id,
        createdAt,
      );
    const insertParticipant = this.database.prepare(
      `INSERT INTO communication_participants (
        id, firm_id, matter_id, conversation_id, party_id, user_id,
        role, display_name, endpoint_type, endpoint, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const participant of input.participants) {
      insertParticipant.run(
        randomUUID(),
        user.firmId,
        matterId,
        id,
        participant.partyId ?? null,
        participant.userId ?? null,
        participant.role,
        participant.displayName,
        participant.endpointType,
        participant.endpoint,
        user.id,
        createdAt,
      );
    }
    return id;
  }

  private appendAttachments(
    user: SessionUser,
    matterId: string,
    target: { entryId?: string; draftVersionId?: string },
    attachments: ReturnType<CommunicationStore['resolveDocumentVersions']>,
    purpose: 'attachment' | 'recording' | 'transcript' | 'call_note' = 'attachment',
    createdAt = this.now().toISOString(),
  ): void {
    const statement = this.database.prepare(
      `INSERT INTO communication_attachments (
        id, firm_id, matter_id, entry_id, draft_version_id, document_id,
        document_version_id, purpose, file_name, sha256, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const attachment of attachments) {
      statement.run(
        randomUUID(),
        user.firmId,
        matterId,
        target.entryId ?? null,
        target.draftVersionId ?? null,
        attachment.documentId,
        attachment.documentVersionId,
        purpose,
        attachment.fileName,
        attachment.sha256,
        user.id,
        createdAt,
      );
    }
  }

  private appendOperationalRecords(
    user: SessionUser,
    matterId: string,
    details: {
      action: string;
      entityType: string;
      entityId: string;
      title: string;
      after: unknown;
      occurredAt: string;
      deduplicationKey: string;
      sensitive: boolean;
    },
    audit: AuditContext,
  ): void {
    const safeAfter = details.sensitive
      ? { entityId: details.entityId, confidentiality: 'restricted' }
      : details.after;
    appendTimeline(this.database, {
      firmId: user.firmId,
      matterId,
      type: details.action,
      title: details.sensitive ? 'Restricted communication record updated' : details.title,
      actorUserId: user.id,
      occurredAt: details.occurredAt,
      metadata: details.sensitive
        ? { entityType: 'restricted_communication', entityId: details.entityId }
        : { entityType: details.entityType, entityId: details.entityId },
    });
    appendAudit(this.database, {
      firmId: user.firmId,
      matterId,
      userId: user.id,
      action: details.action,
      entityType: details.entityType,
      entityId: details.entityId,
      after: safeAfter,
      createdAt: details.occurredAt,
      requestId: audit.requestId,
      ipAddress: audit.ipAddress,
    });
    this.database
      .prepare(
        `INSERT INTO domain_events (
          id, firm_id, matter_id, type, occurred_on, actor_user_id,
          idempotency_key, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        user.firmId,
        matterId,
        details.action,
        details.occurredAt.slice(0, 10),
        user.id,
        `communications:${details.deduplicationKey}`,
        canonicalJson(safeAfter),
        details.occurredAt,
      );
    this.database
      .prepare(
        `INSERT INTO integration_outbox (
          id, firm_id, matter_id, topic, payload_json, status, attempts,
          available_at, created_at, deduplication_key
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        user.firmId,
        matterId,
        details.action,
        canonicalJson(safeAfter),
        details.occurredAt,
        details.occurredAt,
        `communications:${user.firmId}:${matterId}:${details.deduplicationKey}`,
      );
  }

  private entryView(firmId: string, matterId: string, entryId: string) {
    const entry = row(
      this.database
        .prepare(
          `SELECT id, conversation_id AS conversationId, channel, direction,
            confidentiality, participants_json AS participantsJson, subject,
            body_text AS body, body_format AS bodyFormat,
            occurred_at AS occurredAt, recorded_at AS recordedAt,
            recorded_by AS recordedBy, source, provider_key AS providerKey,
            external_message_id AS externalMessageId,
            external_thread_id AS externalThreadId,
            supersedes_entry_id AS supersedesEntryId,
            correction_reason AS correctionReason
           FROM communication_entries
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(entryId, firmId, matterId),
    );
    if (!entry) throw new CommunicationStoreError('NOT_FOUND', 'The communication entry was not found.');
    const attachments = rows(
      this.database
        .prepare(
          `SELECT document_version_id AS documentVersionId, purpose,
            file_name AS fileName, sha256
           FROM communication_attachments
           WHERE firm_id = ? AND matter_id = ? AND entry_id = ?
           ORDER BY created_at, id`,
        )
        .all(firmId, matterId, entryId),
    ).map((item) => ({
      documentVersionId: String(item.documentVersionId),
      purpose: String(item.purpose),
      fileName: String(item.fileName),
      sha256: String(item.sha256),
    }));
    const call = row(
      this.database
        .prepare(
          `SELECT id, provider_key AS providerKey, started_at AS startedAt,
            ended_at AS endedAt, duration_seconds AS durationSeconds, purpose,
            outcome, identity_check_status AS identityCheckStatus,
            identity_check_note AS identityCheckNote,
            recording_status AS recordingStatus,
            notice_consent_basis AS noticeConsentBasis,
            external_call_id AS externalCallId
           FROM communication_call_sessions
           WHERE firm_id = ? AND matter_id = ? AND entry_id = ?`,
        )
        .get(firmId, matterId, entryId),
    );
    const serviceAssertion = row(
      this.database
        .prepare(
          `SELECT id, asserted_method AS assertedMethod, service_at AS serviceAt,
            recipient, endpoint, source_document_version_id AS sourceDocumentVersionId,
            factual_note AS factualNote, review_status AS reviewStatus,
            asserted_by AS assertedBy, asserted_at AS assertedAt,
            reviewed_by AS reviewedBy, reviewed_at AS reviewedAt
           FROM communication_service_assertions
           WHERE firm_id = ? AND matter_id = ? AND entry_id = ?
           ORDER BY asserted_at DESC, id DESC LIMIT 1`,
        )
        .get(firmId, matterId, entryId),
    );
    return {
      id: String(entry.id),
      conversationId: String(entry.conversationId),
      channel: String(entry.channel),
      direction: String(entry.direction),
      confidentiality: String(entry.confidentiality),
      participants: parseJson(entry.participantsJson, []),
      subject: String(entry.subject),
      body: String(entry.body),
      bodyFormat: String(entry.bodyFormat),
      occurredAt: String(entry.occurredAt),
      recordedAt: String(entry.recordedAt),
      recordedBy: String(entry.recordedBy),
      source: String(entry.source),
      providerKey: entry.providerKey ? String(entry.providerKey) : null,
      externalMessageId: entry.externalMessageId ? String(entry.externalMessageId) : null,
      externalThreadId: entry.externalThreadId ? String(entry.externalThreadId) : null,
      supersedesEntryId: entry.supersedesEntryId ? String(entry.supersedesEntryId) : null,
      correctionReason: String(entry.correctionReason),
      attachments,
      call: call
        ? {
            id: String(call.id),
            providerKey: String(call.providerKey),
            startedAt: String(call.startedAt),
            endedAt: String(call.endedAt),
            durationSeconds: Number(call.durationSeconds),
            purpose: String(call.purpose),
            outcome: String(call.outcome),
            identityCheckStatus: String(call.identityCheckStatus),
            identityCheckNote: String(call.identityCheckNote),
            recordingStatus: String(call.recordingStatus),
            noticeConsentBasis: String(call.noticeConsentBasis),
            externalCallId: call.externalCallId ? String(call.externalCallId) : null,
          }
        : null,
      serviceAssertion: serviceAssertion
        ? {
            id: String(serviceAssertion.id),
            assertedMethod: String(serviceAssertion.assertedMethod),
            serviceAt: String(serviceAssertion.serviceAt),
            recipient: String(serviceAssertion.recipient),
            endpoint: String(serviceAssertion.endpoint),
            sourceDocumentVersionId: serviceAssertion.sourceDocumentVersionId
              ? String(serviceAssertion.sourceDocumentVersionId)
              : null,
            factualNote: String(serviceAssertion.factualNote),
            reviewStatus: String(serviceAssertion.reviewStatus),
            assertedBy: String(serviceAssertion.assertedBy),
            assertedAt: String(serviceAssertion.assertedAt),
            reviewedBy: serviceAssertion.reviewedBy ? String(serviceAssertion.reviewedBy) : null,
            reviewedAt: serviceAssertion.reviewedAt ? String(serviceAssertion.reviewedAt) : null,
          }
        : null,
      transport: this.entryTransport(firmId, matterId, entryId),
    };
  }

  private entryTransport(firmId: string, matterId: string, entryId: string) {
    const dispatch = row(
      this.database
        .prepare(
          `SELECT id, status FROM communication_dispatches
           WHERE entry_id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(entryId, firmId, matterId),
    );
    if (!dispatch) return projectTransportState([]);
    const events = rows(
      this.database
        .prepare(
          `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
            received_at AS receivedAt, authenticated
           FROM communication_provider_events
           WHERE dispatch_id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .all(dispatch.id, firmId, matterId),
    ).map((event) => ({
      id: String(event.id),
      eventType: String(event.eventType) as Parameters<typeof projectTransportState>[0][number]['eventType'],
      occurredAt: String(event.occurredAt),
      receivedAt: String(event.receivedAt),
      authenticated: Boolean(event.authenticated),
    }));
    return events.length
      ? projectTransportState(events)
      : { ...projectTransportState([]), state: String(dispatch.status) };
  }

  recordEntry(
    user: SessionUser,
    matterId: string,
    input: RecordCommunicationInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const attachments = this.resolveDocumentVersions(user.firmId, matterId, input.attachmentVersionIds);
    const existing = row(
      this.database
        .prepare(
          `SELECT id, command_payload_json AS commandPayload
           FROM communication_entries
           WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
        )
        .get(user.firmId, matterId, input.idempotencyKey),
    );
    if (existing) {
      if (String(existing.commandPayload) !== canonicalJson(input)) {
        throw new CommunicationStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was used for a different command.');
      }
      return this.entryView(user.firmId, matterId, String(existing.id));
    }
    return transaction(this.database, () => {
      const recordedAt = this.now().toISOString();
      const conversationId = input.conversationId ?? this.createConversation(
        user,
        matterId,
        {
          channel: input.channel,
          subject: input.subject,
          confidentiality: input.confidentiality,
          participants: input.participants,
          providerKey: input.providerKey,
          externalThreadId: input.externalThreadId,
        },
        recordedAt,
      );
      if (input.conversationId && !this.database.prepare(
        'SELECT 1 FROM communication_conversations WHERE id = ? AND firm_id = ? AND matter_id = ?',
      ).get(input.conversationId, user.firmId, matterId)) {
        throw new CommunicationStoreError('INVALID_LINK', 'The conversation was not found.');
      }
      if (input.supersedesEntryId && !this.database.prepare(
        'SELECT 1 FROM communication_entries WHERE id = ? AND firm_id = ? AND matter_id = ?',
      ).get(input.supersedesEntryId, user.firmId, matterId)) {
        throw new CommunicationStoreError('INVALID_LINK', 'The corrected communication was not found.');
      }
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO communication_entries (
            id, firm_id, matter_id, conversation_id, channel, direction,
            confidentiality, participants_json, subject, body_text, body_format,
            occurred_at, recorded_at, recorded_by, source, provider_key,
            external_message_id, external_thread_id, supersedes_entry_id,
            correction_reason, idempotency_key, command_payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          conversationId,
          input.channel,
          input.direction,
          input.confidentiality,
          canonicalJson(input.participants),
          input.subject,
          input.body,
          input.bodyFormat,
          input.occurredAt,
          recordedAt,
          user.id,
          input.source,
          input.providerKey,
          input.externalMessageId,
          input.externalThreadId,
          input.supersedesEntryId,
          input.correctionReason,
          input.idempotencyKey,
          canonicalJson(input),
        );
      this.appendAttachments(user, matterId, { entryId: id }, attachments, 'attachment', recordedAt);
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.recorded',
          entityType: 'communication_entry',
          entityId: id,
          title: `${input.channel} communication recorded`,
          after: { id, channel: input.channel, direction: input.direction, occurredAt: input.occurredAt },
          occurredAt: recordedAt,
          deduplicationKey: `record:${input.idempotencyKey}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(input.confidentiality),
        },
        audit,
      );
      return this.entryView(user.firmId, matterId, id);
    });
  }

  private draftView(firmId: string, matterId: string, draftId: string) {
    const draft = row(
      this.database
        .prepare(
          `SELECT id, conversation_id AS conversationId, channel,
            confidentiality, status, record_version AS recordVersion,
            current_draft_version_id AS currentDraftVersionId,
            created_by AS createdBy, created_at AS createdAt,
            updated_by AS updatedBy, updated_at AS updatedAt
           FROM communication_drafts
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(draftId, firmId, matterId),
    );
    if (!draft) throw new CommunicationStoreError('NOT_FOUND', 'The communication draft was not found.');
    const version = row(
      this.database
        .prepare(
          `SELECT id, version, participants_json AS participantsJson, subject,
            body_text AS body, body_format AS bodyFormat,
            created_by AS createdBy, created_at AS createdAt
           FROM communication_draft_versions
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(draft.currentDraftVersionId, firmId, matterId),
    );
    if (!version) throw new CommunicationStoreError('NOT_FOUND', 'The current draft version was not found.');
    const attachments = rows(
      this.database
        .prepare(
          `SELECT document_version_id AS documentVersionId, purpose,
            file_name AS fileName, sha256
           FROM communication_attachments
           WHERE firm_id = ? AND matter_id = ? AND draft_version_id = ?
           ORDER BY created_at, id`,
        )
        .all(firmId, matterId, version.id),
    ).map((item) => ({
      documentVersionId: String(item.documentVersionId),
      purpose: String(item.purpose),
      fileName: String(item.fileName),
      sha256: String(item.sha256),
    }));
    const approval = row(
      this.database
        .prepare(
          `SELECT id, decision, note, actor_user_id AS actorUserId,
            occurred_at AS occurredAt
           FROM communication_approval_events
           WHERE firm_id = ? AND matter_id = ? AND draft_id = ?
             AND draft_version_id = ?
           ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        )
        .get(firmId, matterId, draftId, version.id),
    );
    const dispatch = row(
      this.database
        .prepare(
          `SELECT id, provider_key AS providerKey, status,
            external_message_id AS externalMessageId,
            last_error_code AS lastErrorCode,
            last_error_detail AS lastErrorDetail,
            created_at AS createdAt, last_event_at AS lastEventAt
           FROM communication_dispatches
           WHERE firm_id = ? AND matter_id = ? AND draft_version_id = ?`,
        )
        .get(firmId, matterId, version.id),
    );
    const providerEvents = dispatch
      ? rows(
          this.database
            .prepare(
              `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
                received_at AS receivedAt, authenticated
               FROM communication_provider_events
               WHERE firm_id = ? AND matter_id = ? AND dispatch_id = ?`,
            )
            .all(firmId, matterId, dispatch.id),
        ).map((event) => ({
          id: String(event.id),
          eventType: String(event.eventType) as Parameters<typeof projectTransportState>[0][number]['eventType'],
          occurredAt: String(event.occurredAt),
          receivedAt: String(event.receivedAt),
          authenticated: Boolean(event.authenticated),
        }))
      : [];
    return {
      id: String(draft.id),
      conversationId: String(draft.conversationId),
      channel: String(draft.channel),
      confidentiality: String(draft.confidentiality),
      status: String(draft.status),
      recordVersion: Number(draft.recordVersion),
      currentVersion: {
        id: String(version.id),
        version: Number(version.version),
        participants: parseJson(version.participantsJson, []),
        subject: String(version.subject),
        body: String(version.body),
        bodyFormat: String(version.bodyFormat),
        attachments,
        createdBy: String(version.createdBy),
        createdAt: String(version.createdAt),
      },
      currentApproval:
        approval && approval.decision === 'approved'
          ? {
              id: String(approval.id),
              decision: String(approval.decision),
              note: String(approval.note),
              actorUserId: String(approval.actorUserId),
              occurredAt: String(approval.occurredAt),
            }
          : null,
      dispatch: dispatch
        ? {
            id: String(dispatch.id),
            providerKey: String(dispatch.providerKey),
            status: String(dispatch.status),
            externalMessageId: dispatch.externalMessageId ? String(dispatch.externalMessageId) : null,
            lastErrorCode: dispatch.lastErrorCode ? String(dispatch.lastErrorCode) : null,
            lastErrorDetail: dispatch.lastErrorDetail ? String(dispatch.lastErrorDetail) : null,
            createdAt: String(dispatch.createdAt),
            lastEventAt: String(dispatch.lastEventAt),
            transport: providerEvents.length
              ? projectTransportState(providerEvents)
              : { ...projectTransportState([]), state: String(dispatch.status) },
          }
        : null,
      createdBy: String(draft.createdBy),
      createdAt: String(draft.createdAt),
      updatedBy: String(draft.updatedBy),
      updatedAt: String(draft.updatedAt),
    };
  }

  createDraft(
    user: SessionUser,
    matterId: string,
    input: CreateCommunicationDraftInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const attachments = this.resolveDocumentVersions(user.firmId, matterId, input.attachmentVersionIds);
    return transaction(this.database, () => {
      const createdAt = this.now().toISOString();
      const conversationId = input.conversationId ?? this.createConversation(
        user,
        matterId,
        {
          channel: input.channel,
          subject: input.subject,
          confidentiality: input.confidentiality,
          participants: input.participants,
        },
        createdAt,
      );
      if (input.conversationId && !this.database.prepare(
        'SELECT 1 FROM communication_conversations WHERE id = ? AND firm_id = ? AND matter_id = ?',
      ).get(input.conversationId, user.firmId, matterId)) {
        throw new CommunicationStoreError('INVALID_LINK', 'The conversation was not found.');
      }
      const draftId = randomUUID();
      const versionId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO communication_drafts (
            id, firm_id, matter_id, conversation_id, channel,
            confidentiality, status, record_version, current_draft_version_id,
            created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          draftId,
          user.firmId,
          matterId,
          conversationId,
          input.channel,
          input.confidentiality,
          versionId,
          user.id,
          createdAt,
          user.id,
          createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO communication_draft_versions (
            id, firm_id, matter_id, draft_id, version, participants_json,
            subject, body_text, body_format, created_by, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          user.firmId,
          matterId,
          draftId,
          canonicalJson(input.participants),
          input.subject,
          input.body,
          input.bodyFormat,
          user.id,
          createdAt,
        );
      this.appendAttachments(user, matterId, { draftVersionId: versionId }, attachments, 'attachment', createdAt);
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.draft_created',
          entityType: 'communication_draft',
          entityId: draftId,
          title: 'Communication draft created',
          after: { id: draftId, channel: input.channel, status: 'draft' },
          occurredAt: createdAt,
          deduplicationKey: `draft:${draftId}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(input.confidentiality),
        },
        audit,
      );
      return this.draftView(user.firmId, matterId, draftId);
    });
  }

  appendDraftVersion(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: AppendCommunicationDraftVersionInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const attachments = this.resolveDocumentVersions(user.firmId, matterId, input.attachmentVersionIds);
    return transaction(this.database, () => {
      const draft = row(
        this.database
          .prepare(
            `SELECT record_version AS recordVersion, confidentiality,
              (SELECT MAX(version) FROM communication_draft_versions v
               WHERE v.draft_id = d.id) AS latestVersion
             FROM communication_drafts d
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .get(draftId, user.firmId, matterId),
      );
      if (!draft) throw new CommunicationStoreError('NOT_FOUND', 'The communication draft was not found.');
      if (Number(draft.recordVersion) !== input.expectedVersion) {
        throw new CommunicationStoreError('CONFLICT', 'The communication draft changed before it was saved.');
      }
      const now = this.now().toISOString();
      const versionId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO communication_draft_versions (
            id, firm_id, matter_id, draft_id, version, participants_json,
            subject, body_text, body_format, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          user.firmId,
          matterId,
          draftId,
          Number(draft.latestVersion) + 1,
          canonicalJson(input.participants),
          input.subject,
          input.body,
          input.bodyFormat,
          user.id,
          now,
        );
      this.appendAttachments(user, matterId, { draftVersionId: versionId }, attachments, 'attachment', now);
      this.database
        .prepare(
          `UPDATE communication_drafts
           SET current_draft_version_id = ?, status = 'draft',
             record_version = record_version + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .run(versionId, user.id, now, draftId, user.firmId, matterId);
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.draft_revised',
          entityType: 'communication_draft',
          entityId: draftId,
          title: 'Communication draft revised',
          after: { id: draftId, draftVersionId: versionId, status: 'draft' },
          occurredAt: now,
          deduplicationKey: `draft-version:${versionId}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(String(draft.confidentiality)),
        },
        audit,
      );
      return this.draftView(user.firmId, matterId, draftId);
    });
  }

  recordApprovalEvent(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: ApprovalCommand,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    return transaction(this.database, () => {
      const draft = row(
        this.database
          .prepare(
            `SELECT current_draft_version_id AS currentDraftVersionId,
              confidentiality
             FROM communication_drafts
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .get(draftId, user.firmId, matterId),
      );
      if (!draft) throw new CommunicationStoreError('NOT_FOUND', 'The communication draft was not found.');
      if (String(draft.currentDraftVersionId) !== input.draftVersionId) {
        throw new CommunicationStoreError('CONFLICT', 'Only the current draft version can be reviewed.');
      }
      const existing = row(
        this.database
          .prepare(
            `SELECT id FROM communication_approval_events
             WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, matterId, input.idempotencyKey),
      );
      if (existing) return this.draftView(user.firmId, matterId, draftId);
      const id = randomUUID();
      const now = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO communication_approval_events (
            id, firm_id, matter_id, draft_id, draft_version_id, decision,
            note, idempotency_key, actor_user_id, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          draftId,
          input.draftVersionId,
          input.decision,
          input.note,
          input.idempotencyKey,
          user.id,
          now,
        );
      const status = input.decision === 'submitted'
        ? 'pending_approval'
        : input.decision === 'approved'
          ? 'approved'
          : input.decision === 'rejected'
            ? 'rejected'
            : 'draft';
      this.database
        .prepare(
          `UPDATE communication_drafts
           SET status = ?, record_version = record_version + 1,
             updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .run(status, user.id, now, draftId, user.firmId, matterId);
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: `communication.${input.decision}`,
          entityType: 'communication_draft',
          entityId: draftId,
          title: `Communication draft ${input.decision}`,
          after: { id: draftId, draftVersionId: input.draftVersionId, decision: input.decision },
          occurredAt: now,
          deduplicationKey: `approval:${input.idempotencyKey}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(String(draft.confidentiality)),
        },
        audit,
      );
      return this.draftView(user.firmId, matterId, draftId);
    });
  }

  createDispatch(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: DispatchCommunicationInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    return transaction(this.database, () => {
      const draft = row(
        this.database
          .prepare(
            `SELECT draft.record_version AS recordVersion,
              current_draft_version_id AS currentDraftVersionId,
              draft.confidentiality, draft.conversation_id AS conversationId,
              draft.channel, version.participants_json AS participantsJson,
              version.subject, version.body_text AS body,
              version.body_format AS bodyFormat
             FROM communication_drafts draft
             JOIN communication_draft_versions version
               ON version.id = draft.current_draft_version_id
               AND version.firm_id = draft.firm_id
             WHERE draft.id = ? AND draft.firm_id = ? AND draft.matter_id = ?`,
          )
          .get(draftId, user.firmId, matterId),
      );
      if (!draft) throw new CommunicationStoreError('NOT_FOUND', 'The communication draft was not found.');
      if (Number(draft.recordVersion) !== input.expectedVersion) {
        throw new CommunicationStoreError('CONFLICT', 'The communication draft changed before dispatch.');
      }
      const existing = row(
        this.database
          .prepare(
            `SELECT * FROM communication_dispatches
             WHERE firm_id = ? AND provider_key = ? AND idempotency_key = ?`,
          )
          .get(user.firmId, input.providerKey, input.idempotencyKey),
      );
      if (existing) return this.dispatchView(user.firmId, matterId, String(existing.id));
      const id = randomUUID();
      const entryId = randomUUID();
      const now = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO communication_entries (
            id, firm_id, matter_id, conversation_id, channel, direction,
            confidentiality, participants_json, subject, body_text, body_format,
            occurred_at, recorded_at, recorded_by, source, provider_key,
            external_message_id, external_thread_id, supersedes_entry_id,
            correction_reason, idempotency_key, command_payload_json
          ) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?,
            'system', ?, NULL, NULL, NULL, '', ?, ?)`,
        )
        .run(
          entryId,
          user.firmId,
          matterId,
          draft.conversationId,
          draft.channel,
          draft.confidentiality,
          draft.participantsJson,
          draft.subject,
          draft.body,
          draft.bodyFormat,
          now,
          now,
          user.id,
          input.providerKey,
          `dispatch-entry:${input.idempotencyKey}`,
          canonicalJson({ draftId, draftVersionId: draft.currentDraftVersionId, dispatch: input }),
        );
      const draftAttachmentIds = rows(
        this.database
          .prepare(
            `SELECT document_version_id AS documentVersionId
             FROM communication_attachments
             WHERE firm_id = ? AND matter_id = ? AND draft_version_id = ?`,
          )
          .all(user.firmId, matterId, draft.currentDraftVersionId),
      ).map((item) => String(item.documentVersionId));
      this.appendAttachments(
        user,
        matterId,
        { entryId },
        this.resolveDocumentVersions(user.firmId, matterId, draftAttachmentIds),
        'attachment',
        now,
      );
      this.database
        .prepare(
          `INSERT INTO communication_dispatches (
            id, firm_id, matter_id, entry_id, draft_id, draft_version_id, provider_key,
            idempotency_key, status, attempt_count, created_by, created_at,
            last_event_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          entryId,
          draftId,
          draft.currentDraftVersionId,
          input.providerKey,
          input.idempotencyKey,
          user.id,
          now,
          now,
        );
      this.database
        .prepare(
          `UPDATE communication_drafts
           SET status = 'dispatched', record_version = record_version + 1,
             updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .run(user.id, now, draftId, user.firmId, matterId);
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.dispatch_queued',
          entityType: 'communication_dispatch',
          entityId: id,
          title: 'External communication queued',
          after: { id, entryId, draftId, providerKey: input.providerKey, state: 'queued' },
          occurredAt: now,
          deduplicationKey: `dispatch:${input.providerKey}:${input.idempotencyKey}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(String(draft.confidentiality)),
        },
        audit,
      );
      return this.dispatchView(user.firmId, matterId, id);
    });
  }

  private dispatchView(firmId: string, matterId: string, dispatchId: string) {
    const dispatch = row(
      this.database
        .prepare(
          `SELECT id, entry_id AS entryId, draft_id AS draftId,
            draft_version_id AS draftVersionId,
            provider_key AS providerKey, idempotency_key AS idempotencyKey,
            status, attempt_count AS attemptCount,
            external_message_id AS externalMessageId,
            last_error_code AS lastErrorCode,
            last_error_detail AS lastErrorDetail,
            created_at AS createdAt, last_event_at AS lastEventAt
           FROM communication_dispatches
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        )
        .get(dispatchId, firmId, matterId),
    );
    if (!dispatch) throw new CommunicationStoreError('NOT_FOUND', 'The communication dispatch was not found.');
    return {
      id: String(dispatch.id),
      entryId: String(dispatch.entryId),
      draftId: String(dispatch.draftId),
      draftVersionId: String(dispatch.draftVersionId),
      providerKey: String(dispatch.providerKey),
      idempotencyKey: String(dispatch.idempotencyKey),
      status: String(dispatch.status),
      attemptCount: Number(dispatch.attemptCount),
      externalMessageId: dispatch.externalMessageId ? String(dispatch.externalMessageId) : null,
      lastErrorCode: dispatch.lastErrorCode ? String(dispatch.lastErrorCode) : null,
      lastErrorDetail: dispatch.lastErrorDetail ? String(dispatch.lastErrorDetail) : null,
      createdAt: String(dispatch.createdAt),
      lastEventAt: String(dispatch.lastEventAt),
    };
  }

  recordProviderEvent(
    user: SessionUser,
    matterId: string,
    dispatchId: string,
    providerKey: string,
    event: VerifiedProviderEvent,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    return transaction(this.database, () => {
      const dispatch = row(
        this.database
          .prepare(
            `SELECT d.id, draft.confidentiality
             FROM communication_dispatches d
             JOIN communication_drafts draft
               ON draft.id = d.draft_id AND draft.firm_id = d.firm_id
             WHERE d.id = ? AND d.firm_id = ? AND d.matter_id = ?
               AND d.provider_key = ?`,
          )
          .get(dispatchId, user.firmId, matterId, providerKey),
      );
      if (!dispatch) throw new CommunicationStoreError('NOT_FOUND', 'The communication dispatch was not found.');
      const existing = row(
        this.database
          .prepare(
            `SELECT id FROM communication_provider_events
             WHERE firm_id = ? AND provider_key = ? AND provider_event_id = ?`,
          )
          .get(user.firmId, providerKey, event.providerEventId),
      );
      if (existing) {
        return { dispatch: this.dispatchView(user.firmId, matterId, dispatchId), replayed: true };
      }
      const id = randomUUID();
      const receivedAt = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO communication_provider_events (
            id, firm_id, matter_id, dispatch_id, provider_key,
            provider_event_id, event_type, authenticated,
            authentication_method, occurred_at, received_at, safe_payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          dispatchId,
          providerKey,
          event.providerEventId,
          event.eventType,
          event.authenticated ? 1 : 0,
          event.authenticationMethod,
          event.occurredAt,
          receivedAt,
          canonicalJson(event.safePayload),
        );
      if (event.authenticated) {
        this.database
          .prepare(
            `UPDATE communication_dispatches
             SET status = ?, last_event_at = ?, attempt_count = attempt_count + 1,
               external_message_id = COALESCE(?, external_message_id)
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .run(
            event.eventType,
            event.occurredAt,
            event.externalMessageId ?? null,
            dispatchId,
            user.firmId,
            matterId,
          );
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: event.authenticated
            ? `communication.transport_${event.eventType}`
            : 'communication.provider_event_quarantined',
          entityType: 'communication_dispatch',
          entityId: dispatchId,
          title: event.authenticated
            ? 'Communication transport updated'
            : 'Unauthenticated provider event quarantined',
          after: { dispatchId, providerKey, eventType: event.eventType, authenticated: event.authenticated },
          occurredAt: receivedAt,
          deduplicationKey: `provider-event:${providerKey}:${event.providerEventId}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(String(dispatch.confidentiality)),
        },
        audit,
      );
      return { dispatch: this.dispatchView(user.firmId, matterId, dispatchId), replayed: false };
    });
  }

  getProviderDispatchCommand(user: SessionUser, matterId: string, dispatchId: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new CommunicationStoreError('NOT_FOUND', 'The requested resource was not found.');
    }
    const found = row(
      this.database
        .prepare(
          `SELECT d.id AS dispatchId, d.idempotency_key AS idempotencyKey,
            draft.channel, v.participants_json AS participantsJson,
            v.subject, v.body_text AS body, v.body_format AS bodyFormat,
            v.id AS draftVersionId
           FROM communication_dispatches d
           JOIN communication_drafts draft
             ON draft.id = d.draft_id AND draft.firm_id = d.firm_id
           JOIN communication_draft_versions v
             ON v.id = d.draft_version_id AND v.firm_id = d.firm_id
           WHERE d.id = ? AND d.firm_id = ? AND d.matter_id = ?`,
        )
        .get(dispatchId, user.firmId, matterId),
    );
    if (!found) throw new CommunicationStoreError('NOT_FOUND', 'The communication dispatch was not found.');
    const attachments = rows(
      this.database
        .prepare(
          `SELECT a.document_version_id AS documentVersionId,
            a.file_name AS fileName, dv.mime_type AS mimeType, a.sha256
           FROM communication_attachments a
           JOIN document_versions dv
             ON dv.id = a.document_version_id AND dv.firm_id = a.firm_id
           WHERE a.firm_id = ? AND a.matter_id = ? AND a.draft_version_id = ?`,
        )
        .all(user.firmId, matterId, found.draftVersionId),
    ).map((item) => ({
      documentVersionId: String(item.documentVersionId),
      fileName: String(item.fileName),
      mimeType: String(item.mimeType),
      sha256: String(item.sha256),
    }));
    return {
      dispatchId: String(found.dispatchId),
      idempotencyKey: String(found.idempotencyKey),
      channel: String(found.channel) as 'email' | 'whatsapp',
      participants: parseJson(found.participantsJson, []),
      subject: String(found.subject),
      body: String(found.body),
      bodyFormat: String(found.bodyFormat) as 'plain' | 'html' | 'structured_note',
      attachments,
    };
  }

  recordCall(
    user: SessionUser,
    matterId: string,
    input: RecordCommunicationCallInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const allVersionIds = [
      ...input.attachmentVersionIds,
      ...input.recordingVersionIds,
      ...input.transcriptVersionIds,
      ...input.callNoteVersionIds,
    ];
    this.resolveDocumentVersions(user.firmId, matterId, allVersionIds);
    return transaction(this.database, () => {
      const entry = this.recordEntryWithoutTransaction(user, matterId, {
        idempotencyKey: input.idempotencyKey,
        channel: input.channel,
        direction: input.direction,
        confidentiality: input.confidentiality,
        participants: input.participants,
        subject: input.subject,
        body: input.body,
        bodyFormat: 'structured_note',
        occurredAt: input.occurredAt,
        attachmentVersionIds: [],
        source: input.providerKey ? 'provider' : 'manual',
        providerKey: input.providerKey,
        externalMessageId: input.externalCallId,
        externalThreadId: null,
        conversationId: null,
        supersedesEntryId: null,
        correctionReason: '',
      });
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const durationSeconds = Math.floor(
        (new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()) / 1_000,
      );
      this.database
        .prepare(
          `INSERT INTO communication_call_sessions (
            id, firm_id, matter_id, entry_id, provider_key, started_at,
            ended_at, duration_seconds, purpose, outcome,
            identity_check_status, identity_check_note, recording_status,
            notice_consent_basis, notice_consent_actor_user_id,
            external_call_id, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          entry.id,
          input.providerKey ?? 'manual',
          input.startedAt,
          input.endedAt,
          durationSeconds,
          input.purpose,
          input.outcome,
          input.identityCheckStatus,
          input.identityCheckNote,
          input.recordingStatus,
          input.noticeConsentBasis,
          ['notice_given', 'consent_recorded', 'recorded'].includes(input.recordingStatus)
            ? user.id
            : null,
          input.externalCallId,
          user.id,
          createdAt,
        );
      const groups: Array<[readonly string[], 'attachment' | 'recording' | 'transcript' | 'call_note']> = [
        [input.attachmentVersionIds, 'attachment'],
        [input.recordingVersionIds, 'recording'],
        [input.transcriptVersionIds, 'transcript'],
        [input.callNoteVersionIds, 'call_note'],
      ];
      for (const [ids, purpose] of groups) {
        this.appendAttachments(
          user,
          matterId,
          { entryId: entry.id },
          this.resolveDocumentVersions(user.firmId, matterId, ids),
          purpose,
          createdAt,
        );
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.call_recorded',
          entityType: 'communication_call',
          entityId: id,
          title: 'Call record added',
          after: { id, entryId: entry.id, channel: input.channel, durationSeconds },
          occurredAt: createdAt,
          deduplicationKey: `call:${input.idempotencyKey}`,
          sensitive: ['privileged', 'protected_negotiation'].includes(input.confidentiality),
        },
        audit,
      );
      return this.entryView(user.firmId, matterId, entry.id);
    });
  }

  recordServiceAssertion(
    user: SessionUser,
    matterId: string,
    entryId: string,
    input: {
      assertedMethod: string;
      serviceAt: string;
      recipient: string;
      endpoint: string;
      sourceDocumentVersionId: string | null;
      factualNote: string;
    },
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const source = input.sourceDocumentVersionId
      ? this.resolveDocumentVersions(user.firmId, matterId, [input.sourceDocumentVersionId])[0]
      : undefined;
    return transaction(this.database, () => {
      if (!this.database.prepare(
        'SELECT 1 FROM communication_entries WHERE id = ? AND firm_id = ? AND matter_id = ?',
      ).get(entryId, user.firmId, matterId)) {
        throw new CommunicationStoreError('NOT_FOUND', 'The communication entry was not found.');
      }
      const existing = row(
        this.database
          .prepare(
            `SELECT id, review_status AS reviewStatus
             FROM communication_service_assertions
             WHERE entry_id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .get(entryId, user.firmId, matterId),
      );
      if (existing) return { id: String(existing.id), reviewStatus: String(existing.reviewStatus) };
      const id = randomUUID();
      const assertedAt = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO communication_service_assertions (
            id, firm_id, matter_id, entry_id, asserted_method, service_at,
            recipient, endpoint, source_document_id, source_document_version_id,
            factual_note, review_status, asserted_by, asserted_at,
            reviewed_by, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?, NULL, NULL)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          entryId,
          input.assertedMethod,
          input.serviceAt,
          input.recipient,
          input.endpoint,
          source?.documentId ?? null,
          source?.documentVersionId ?? null,
          input.factualNote,
          user.id,
          assertedAt,
        );
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'communication.service_asserted',
          entityType: 'communication_service_assertion',
          entityId: id,
          title: 'Service fact asserted for review',
          after: { id, entryId, reviewStatus: 'unreviewed', serviceAt: input.serviceAt },
          occurredAt: assertedAt,
          deduplicationKey: `service-assertion:${entryId}`,
          sensitive: false,
        },
        audit,
      );
      return { id, reviewStatus: 'unreviewed' };
    });
  }

  private recordEntryWithoutTransaction(
    user: SessionUser,
    matterId: string,
    input: RecordCommunicationInput,
  ): { id: string } {
    const recordedAt = this.now().toISOString();
    const conversationId = this.createConversation(
      user,
      matterId,
      {
        channel: input.channel,
        subject: input.subject,
        confidentiality: input.confidentiality,
        participants: input.participants,
        providerKey: input.providerKey,
        externalThreadId: input.externalThreadId,
      },
      recordedAt,
    );
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO communication_entries (
          id, firm_id, matter_id, conversation_id, channel, direction,
          confidentiality, participants_json, subject, body_text, body_format,
          occurred_at, recorded_at, recorded_by, source, provider_key,
          external_message_id, external_thread_id, supersedes_entry_id,
          correction_reason, idempotency_key, command_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, user.firmId, matterId, conversationId, input.channel,
        input.direction, input.confidentiality, canonicalJson(input.participants),
        input.subject, input.body, input.bodyFormat, input.occurredAt,
        recordedAt, user.id, input.source, input.providerKey,
        input.externalMessageId, input.externalThreadId, input.supersedesEntryId,
        input.correctionReason, input.idempotencyKey, canonicalJson(input),
      );
    return { id };
  }

  getWorkspace(
    user: SessionUser,
    matterId: string,
    access: WorkspaceAccess,
  ) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const allowed = ['ordinary', 'internal'];
    if (access.readPrivileged) allowed.push('privileged');
    if (access.readProtected) allowed.push('protected_negotiation');
    const placeholders = allowed.map(() => '?').join(', ');
    const entryIds = rows(
      this.database
        .prepare(
          `SELECT id FROM communication_entries
           WHERE firm_id = ? AND matter_id = ?
             AND confidentiality IN (${placeholders})
           ORDER BY occurred_at DESC, recorded_at DESC, id DESC`,
        )
        .all(user.firmId, matterId, ...allowed),
    ).map((item) => String(item.id));
    const draftIds = rows(
      this.database
        .prepare(
          `SELECT id FROM communication_drafts
           WHERE firm_id = ? AND matter_id = ?
             AND confidentiality IN (${placeholders})
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(user.firmId, matterId, ...allowed),
    ).map((item) => String(item.id));
    const entries = entryIds.map((id) => this.entryView(user.firmId, matterId, id));
    const drafts = draftIds.map((id) => this.draftView(user.firmId, matterId, id));
    const counts = {
      total: entries.length,
      inbound: entries.filter(({ direction }) => direction === 'inbound').length,
      outbound: entries.filter(({ direction }) => direction === 'outbound').length,
      drafts: drafts.length,
    };
    return {
      matterId,
      permissions: { canWrite: this.canWriteMatter(user, matterId) },
      counts,
      entries,
      drafts,
    };
  }

  getDraft(user: SessionUser, matterId: string, draftId: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new CommunicationStoreError('NOT_FOUND', 'The requested resource was not found.');
    }
    return this.draftView(user.firmId, matterId, draftId);
  }
}
