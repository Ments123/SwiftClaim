import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ApproveLossScheduleInput,
  ApproveWorkScheduleInput,
  CreateGeneralDamagesReviewInput,
  CreateLossItemInput,
  CreateLossScheduleInput,
  CreateOfferInput,
  CreateRepairEventInput,
  CreateWorkScheduleInput,
  RecordOfferEventInput,
  ReviewPart36Input,
  UpdateLossItemInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { calculateLossAmount, projectQuantumTotals } from './calculations.js';
import { projectRepairState } from './repair-projection.js';
import type {
  EvidenceStatus,
  GeneralDamagesRange,
  LossCategory,
  LossPosition,
  RepairActorType,
  RepairEventType,
  RepairProjectionEvent,
} from './types.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export type QuantumStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK'
  | 'APPROVAL_BLOCKED';

export class QuantumStoreError extends Error {
  constructor(
    readonly code: QuantumStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuantumStoreError';
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

export class QuantumStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

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

  private requireWrite(user: SessionUser, matterId: string): void {
    if (!this.canWriteMatter(user, matterId)) {
      throw new QuantumStoreError('NOT_FOUND', 'The repairs and quantum workspace was not found.');
    }
  }

  private resolveDocumentVersion(
    firmId: string,
    matterId: string,
    versionId: string | null,
  ): { documentId: string; versionId: string } | null {
    if (!versionId) return null;
    const found = row(
      this.database
        .prepare(
          `SELECT d.id AS documentId, dv.id AS versionId
           FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
           WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`,
        )
        .get(versionId, firmId, matterId),
    );
    if (!found) {
      throw new QuantumStoreError('INVALID_LINK', 'The source document was not found.');
    }
    return {
      documentId: String(found.documentId),
      versionId: String(found.versionId),
    };
  }

  private requireScopedIds(
    table: 'defects' | 'evidence_items',
    firmId: string,
    matterId: string,
    ids: string[],
  ): void {
    for (const id of new Set(ids)) {
      if (
        !this.database
          .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND firm_id = ? AND matter_id = ?`)
          .get(id, firmId, matterId)
      ) {
        throw new QuantumStoreError('INVALID_LINK', 'A linked matter record was not found.');
      }
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
      idempotencyKey: string;
      protected?: boolean;
    },
    audit: AuditContext,
  ): void {
    appendTimeline(this.database, {
      firmId: user.firmId,
      matterId,
      type: details.action,
      title: details.protected ? 'Protected offer record updated' : details.title,
      actorUserId: user.id,
      occurredAt: details.occurredAt,
      metadata: details.protected
        ? { entityType: 'protected_offer', entityId: details.entityId }
        : { entityType: details.entityType, entityId: details.entityId },
    });
    appendAudit(this.database, {
      firmId: user.firmId,
      matterId,
      userId: user.id,
      action: details.action,
      entityType: details.entityType,
      entityId: details.entityId,
      after: details.after,
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
        `quantum:${details.idempotencyKey}`,
        canonicalJson(details.protected ? { entityId: details.entityId } : details.after),
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
        canonicalJson(
          details.protected
            ? { matterId, entityType: 'protected_offer', entityId: details.entityId }
            : { matterId, entityType: details.entityType, entityId: details.entityId },
        ),
        details.occurredAt,
        details.occurredAt,
        `quantum:${user.firmId}:${matterId}:${details.idempotencyKey}`,
      );
  }

  private workItems(firmId: string, matterId: string, scheduleId: string) {
    return rows(
      this.database
        .prepare(
          `SELECT id, lineage_key AS lineageKey, area, description,
            responsibility_position AS responsibilityPosition, priority,
            target_start_on AS targetStartOn,
            target_completion_on AS targetCompletionOn,
            estimated_cost_minor AS estimatedCostMinor, currency, contractor,
            source_note AS sourceNote, display_position AS displayPosition
           FROM work_items
           WHERE firm_id = ? AND matter_id = ? AND schedule_id = ?
           ORDER BY display_position, id`,
        )
        .all(firmId, matterId, scheduleId),
    ).map((item) => {
      const defectIds = rows(
        this.database
          .prepare(
            `SELECT defect_id AS id FROM work_item_defects
             WHERE firm_id = ? AND matter_id = ? AND work_item_id = ?
             ORDER BY defect_id`,
          )
          .all(firmId, matterId, String(item.id)),
      ).map(({ id }) => String(id));
      const evidenceItemIds = rows(
        this.database
          .prepare(
            `SELECT evidence_item_id AS id FROM work_item_evidence_links
             WHERE firm_id = ? AND matter_id = ? AND work_item_id = ?
             ORDER BY evidence_item_id`,
          )
          .all(firmId, matterId, String(item.id)),
      ).map(({ id }) => String(id));
      const repairEvents = this.repairEvents(firmId, matterId, String(item.id));
      return {
        id: String(item.id),
        lineageKey: String(item.lineageKey),
        area: String(item.area),
        description: String(item.description),
        responsibilityPosition: String(item.responsibilityPosition),
        priority: String(item.priority) as 'urgent' | 'high' | 'routine',
        targetStartOn: item.targetStartOn ? String(item.targetStartOn) : null,
        targetCompletionOn: item.targetCompletionOn
          ? String(item.targetCompletionOn)
          : null,
        estimatedCostMinor:
          item.estimatedCostMinor === null ? null : Number(item.estimatedCostMinor),
        currency: String(item.currency),
        contractor: String(item.contractor),
        sourceNote: String(item.sourceNote),
        displayPosition: Number(item.displayPosition),
        defectIds,
        evidenceItemIds,
        repairEvents,
        projection: projectRepairState(
          {
            id: String(item.id),
            priority: String(item.priority) as 'urgent' | 'high' | 'routine',
            targetCompletionOn: item.targetCompletionOn
              ? String(item.targetCompletionOn)
              : null,
          },
          repairEvents,
          this.now().toISOString().slice(0, 10),
        ),
      };
    });
  }

  private repairEvents(
    firmId: string,
    matterId: string,
    workItemId: string,
  ): RepairProjectionEvent[] {
    return rows(
      this.database
        .prepare(
          `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
            actor_type AS actorType, verifier,
            supersedes_event_id AS supersedesEventId, created_at AS createdAt
           FROM repair_events
           WHERE firm_id = ? AND matter_id = ? AND work_item_id = ?
           ORDER BY occurred_at, created_at, id`,
        )
        .all(firmId, matterId, workItemId),
    ).map((event) => ({
      id: String(event.id),
      eventType: String(event.eventType) as RepairEventType,
      occurredAt: String(event.occurredAt),
      actorType: String(event.actorType) as RepairActorType,
      verifier: String(event.verifier),
      supersedesEventId: event.supersedesEventId
        ? String(event.supersedesEventId)
        : null,
      createdAt: String(event.createdAt),
      evidenceIds: rows(
        this.database
          .prepare(
            `SELECT evidence_item_id AS id FROM repair_event_evidence_links
             WHERE firm_id = ? AND matter_id = ? AND repair_event_id = ?
             ORDER BY evidence_item_id`,
          )
          .all(firmId, matterId, String(event.id)),
      ).map(({ id }) => String(id)),
    }));
  }

  private listWorkSchedules(firmId: string, matterId: string) {
    return rows(
      this.database
        .prepare(
          `SELECT id, schedule_version AS scheduleVersion,
            record_version AS recordVersion, title, source_type AS sourceType,
            source_document_version_id AS sourceDocumentVersionId, status,
            based_on_schedule_id AS basedOnScheduleId,
            approval_note AS approvalNote,
            acknowledged_warnings_json AS acknowledgedWarningsJson,
            created_by AS createdBy, created_at AS createdAt,
            approved_by AS approvedBy, approved_at AS approvedAt
           FROM work_schedules WHERE firm_id = ? AND matter_id = ?
           ORDER BY schedule_version DESC`,
        )
        .all(firmId, matterId),
    ).map((schedule) => ({
      id: String(schedule.id),
      scheduleVersion: Number(schedule.scheduleVersion),
      recordVersion: Number(schedule.recordVersion),
      title: String(schedule.title),
      sourceType: String(schedule.sourceType),
      sourceDocumentVersionId: schedule.sourceDocumentVersionId
        ? String(schedule.sourceDocumentVersionId)
        : null,
      status: String(schedule.status),
      basedOnScheduleId: schedule.basedOnScheduleId
        ? String(schedule.basedOnScheduleId)
        : null,
      approvalNote: String(schedule.approvalNote),
      acknowledgedWarningKeys: parseJson<string[]>(
        schedule.acknowledgedWarningsJson,
        [],
      ),
      createdBy: String(schedule.createdBy),
      createdAt: String(schedule.createdAt),
      approvedBy: schedule.approvedBy ? String(schedule.approvedBy) : null,
      approvedAt: schedule.approvedAt ? String(schedule.approvedAt) : null,
      items: this.workItems(firmId, matterId, String(schedule.id)),
    }));
  }

  private lossItems(firmId: string, matterId: string, scheduleId: string) {
    return rows(
      this.database
        .prepare(
          `SELECT id, record_version AS recordVersion,
            lineage_key AS lineageKey, category, description,
            period_start_on AS periodStartOn, period_end_on AS periodEndOn,
            calculation_type AS calculationType, quantity,
            unit_label AS unitLabel, rate_minor AS rateMinor,
            fixed_amount_minor AS fixedAmountMinor,
            manual_amount_minor AS manualAmountMinor,
            manual_basis AS manualBasis,
            calculated_amount_minor AS calculatedAmountMinor,
            currency, position, evidence_status AS evidenceStatus,
            source_note AS sourceNote, display_position AS displayPosition
           FROM loss_items
           WHERE firm_id = ? AND matter_id = ? AND schedule_id = ?
           ORDER BY display_position, id`,
        )
        .all(firmId, matterId, scheduleId),
    ).map((item) => {
      const calculation = calculateLossAmount({
        calculationType: String(item.calculationType) as CreateLossItemInput['calculationType'],
        quantity: item.quantity ? String(item.quantity) : undefined,
        unitLabel: String(item.unitLabel),
        rateMinor: item.rateMinor === null ? undefined : Number(item.rateMinor),
        fixedAmountMinor:
          item.fixedAmountMinor === null ? undefined : Number(item.fixedAmountMinor),
        manualAmountMinor:
          item.manualAmountMinor === null ? undefined : Number(item.manualAmountMinor),
        manualBasis: String(item.manualBasis),
      });
      return {
        id: String(item.id),
        recordVersion: Number(item.recordVersion),
        lineageKey: String(item.lineageKey),
        category: String(item.category) as LossCategory,
        description: String(item.description),
        periodStartOn: item.periodStartOn ? String(item.periodStartOn) : null,
        periodEndOn: item.periodEndOn ? String(item.periodEndOn) : null,
        calculationType: String(item.calculationType),
        quantity: item.quantity ? String(item.quantity) : null,
        unitLabel: String(item.unitLabel),
        rateMinor: item.rateMinor === null ? null : Number(item.rateMinor),
        fixedAmountMinor:
          item.fixedAmountMinor === null ? null : Number(item.fixedAmountMinor),
        manualAmountMinor:
          item.manualAmountMinor === null ? null : Number(item.manualAmountMinor),
        manualBasis: String(item.manualBasis),
        calculatedAmountMinor: Number(item.calculatedAmountMinor),
        calculation: calculation.calculation,
        currency: String(item.currency),
        position: String(item.position) as LossPosition,
        evidenceStatus: String(item.evidenceStatus) as EvidenceStatus,
        sourceNote: String(item.sourceNote),
        displayPosition: Number(item.displayPosition),
        evidenceItemIds: rows(
          this.database
            .prepare(
              `SELECT evidence_item_id AS id FROM loss_item_evidence_links
               WHERE firm_id = ? AND matter_id = ? AND loss_item_id = ?
               ORDER BY evidence_item_id`,
            )
            .all(firmId, matterId, String(item.id)),
        ).map(({ id }) => String(id)),
      };
    });
  }

  private currentGeneralDamagesRange(
    firmId: string,
    matterId: string,
  ): GeneralDamagesRange | null {
    const current = row(
      this.database
        .prepare(
          `SELECT low_minor AS lowMinor, high_minor AS highMinor,
            preferred_minor AS preferredMinor
           FROM general_damages_reviews g
           WHERE g.firm_id = ? AND g.matter_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM general_damages_reviews newer
               WHERE newer.firm_id = g.firm_id AND newer.matter_id = g.matter_id
                 AND newer.supersedes_review_id = g.id
             )
           ORDER BY reviewed_at DESC LIMIT 1`,
        )
        .get(firmId, matterId),
    );
    return current
      ? {
          lowMinor: Number(current.lowMinor),
          highMinor: Number(current.highMinor),
          preferredMinor:
            current.preferredMinor === null ? null : Number(current.preferredMinor),
        }
      : null;
  }

  private listLossSchedules(firmId: string, matterId: string) {
    return rows(
      this.database
        .prepare(
          `SELECT id, schedule_version AS scheduleVersion,
            record_version AS recordVersion, title, status,
            based_on_schedule_id AS basedOnScheduleId,
            valuation_on AS valuationOn, currency, notes,
            approval_note AS approvalNote,
            acknowledged_gaps_json AS acknowledgedGapsJson,
            created_by AS createdBy, created_at AS createdAt,
            approved_by AS approvedBy, approved_at AS approvedAt
           FROM loss_schedules WHERE firm_id = ? AND matter_id = ?
           ORDER BY schedule_version DESC`,
        )
        .all(firmId, matterId),
    ).map((schedule) => {
      const items = this.lossItems(firmId, matterId, String(schedule.id));
      return {
        id: String(schedule.id),
        scheduleVersion: Number(schedule.scheduleVersion),
        recordVersion: Number(schedule.recordVersion),
        title: String(schedule.title),
        status: String(schedule.status),
        basedOnScheduleId: schedule.basedOnScheduleId
          ? String(schedule.basedOnScheduleId)
          : null,
        valuationOn: String(schedule.valuationOn),
        currency: String(schedule.currency),
        notes: String(schedule.notes),
        approvalNote: String(schedule.approvalNote),
        acknowledgedEvidenceGapItemIds: parseJson<string[]>(
          schedule.acknowledgedGapsJson,
          [],
        ),
        createdBy: String(schedule.createdBy),
        createdAt: String(schedule.createdAt),
        approvedBy: schedule.approvedBy ? String(schedule.approvedBy) : null,
        approvedAt: schedule.approvedAt ? String(schedule.approvedAt) : null,
        items,
        totals: projectQuantumTotals(
          items.map((item) => ({
            category: item.category,
            position: item.position,
            evidenceStatus: item.evidenceStatus,
            amountMinor: item.calculatedAmountMinor,
          })),
          this.currentGeneralDamagesRange(firmId, matterId),
        ),
      };
    });
  }

  private generalDamagesReviews(firmId: string, matterId: string) {
    return rows(
      this.database
        .prepare(
          `SELECT id, valuation_on AS valuationOn, low_minor AS lowMinor,
            high_minor AS highMinor, preferred_minor AS preferredMinor,
            currency, basis, authorities_json AS authoritiesJson,
            review_note AS reviewNote,
            none_presently_advanced AS nonePresentlyAdvanced,
            supersedes_review_id AS supersedesReviewId,
            reviewed_by AS reviewedBy, reviewed_at AS reviewedAt
           FROM general_damages_reviews
           WHERE firm_id = ? AND matter_id = ?
           ORDER BY reviewed_at DESC, id DESC`,
        )
        .all(firmId, matterId),
    ).map((review) => ({
      id: String(review.id),
      valuationOn: String(review.valuationOn),
      lowMinor: Number(review.lowMinor),
      highMinor: Number(review.highMinor),
      preferredMinor:
        review.preferredMinor === null ? null : Number(review.preferredMinor),
      currency: String(review.currency),
      basis: String(review.basis),
      authorities: parseJson<string[]>(review.authoritiesJson, []),
      reviewNote: String(review.reviewNote),
      nonePresentlyAdvanced: Boolean(review.nonePresentlyAdvanced),
      supersedesReviewId: review.supersedesReviewId
        ? String(review.supersedesReviewId)
        : null,
      reviewedBy: String(review.reviewedBy),
      reviewedAt: String(review.reviewedAt),
    }));
  }

  private listOffers(
    firmId: string,
    matterId: string,
    protectedOnly: boolean,
  ) {
    const operator = protectedOnly ? '<>' : '=';
    return rows(
      this.database
        .prepare(
          `SELECT o.id, o.offer_reference AS offerReference,
            o.record_version AS recordVersion, o.direction,
            o.offer_type AS offerType, o.confidentiality, o.scope,
            o.scope_description AS scopeDescription,
            o.damages_minor AS damagesMinor, o.costs_minor AS costsMinor,
            o.total_minor AS totalMinor, o.currency,
            o.works_terms AS worksTerms, o.non_money_terms AS nonMoneyTerms,
            o.interest_treatment AS interestTreatment,
            o.written_document_version_id AS writtenOfferDocumentVersionId,
            o.made_on AS madeOn, o.idempotency_key AS idempotencyKey,
            o.created_by AS createdBy, o.created_at AS createdAt,
            p.relevant_period_days AS relevantPeriodDays,
            p.relevant_period_basis AS relevantPeriodBasis,
            p.service_on AS serviceOn, p.service_confirmed AS serviceConfirmed,
            p.projected_period_end_on AS projectedPeriodEndOn,
            p.calculation_explanation AS calculationExplanation,
            p.includes_counterclaim AS includesCounterclaim,
            p.payment_period_days AS paymentPeriodDays,
            p.validation_status AS validationStatus,
            p.validation_note AS validationNote
           FROM offers o LEFT JOIN part_36_terms p ON p.offer_id = o.id
             AND p.firm_id = o.firm_id AND p.matter_id = o.matter_id
           WHERE o.firm_id = ? AND o.matter_id = ?
             AND o.confidentiality ${operator} 'open'
           ORDER BY o.made_on DESC, o.created_at DESC`,
        )
        .all(firmId, matterId),
    ).map((offer) => ({
      id: String(offer.id),
      offerReference: String(offer.offerReference),
      recordVersion: Number(offer.recordVersion),
      direction: String(offer.direction),
      offerType: String(offer.offerType),
      confidentiality: String(offer.confidentiality),
      scope: String(offer.scope),
      scopeDescription: String(offer.scopeDescription),
      damagesMinor: offer.damagesMinor === null ? null : Number(offer.damagesMinor),
      costsMinor: offer.costsMinor === null ? null : Number(offer.costsMinor),
      totalMinor: offer.totalMinor === null ? null : Number(offer.totalMinor),
      currency: String(offer.currency),
      worksTerms: String(offer.worksTerms),
      nonMoneyTerms: String(offer.nonMoneyTerms),
      interestTreatment: String(offer.interestTreatment),
      writtenOfferDocumentVersionId: offer.writtenOfferDocumentVersionId
        ? String(offer.writtenOfferDocumentVersionId)
        : null,
      madeOn: String(offer.madeOn),
      idempotencyKey: String(offer.idempotencyKey),
      createdBy: String(offer.createdBy),
      createdAt: String(offer.createdAt),
      part36:
        offer.relevantPeriodDays === null
          ? null
          : {
              relevantPeriodDays: Number(offer.relevantPeriodDays),
              relevantPeriodBasis: String(offer.relevantPeriodBasis),
              serviceOn: offer.serviceOn ? String(offer.serviceOn) : null,
              serviceConfirmed: Boolean(offer.serviceConfirmed),
              projectedPeriodEndOn: offer.projectedPeriodEndOn
                ? String(offer.projectedPeriodEndOn)
                : null,
              calculationExplanation: String(offer.calculationExplanation),
              includesCounterclaim: Boolean(offer.includesCounterclaim),
              paymentPeriodDays: Number(offer.paymentPeriodDays),
              validationStatus: String(offer.validationStatus),
              validationNote: String(offer.validationNote),
            },
      events: rows(
        this.database
          .prepare(
            `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
              note, source_document_version_id AS sourceDocumentVersionId,
              supersedes_event_id AS supersedesEventId,
              explicit_confirmation AS explicitConfirmation,
              created_by AS createdBy, created_at AS createdAt
             FROM offer_events
             WHERE firm_id = ? AND matter_id = ? AND offer_id = ?
             ORDER BY occurred_at, created_at, id`,
          )
          .all(firmId, matterId, String(offer.id)),
      ).map((event) => ({
        id: String(event.id),
        eventType: String(event.eventType),
        occurredAt: String(event.occurredAt),
        note: String(event.note),
        sourceDocumentVersionId: event.sourceDocumentVersionId
          ? String(event.sourceDocumentVersionId)
          : null,
        supersedesEventId: event.supersedesEventId
          ? String(event.supersedesEventId)
          : null,
        explicitConfirmation: Boolean(event.explicitConfirmation),
        createdBy: String(event.createdBy),
        createdAt: String(event.createdAt),
      })),
    }));
  }

  getWorkspace(user: SessionUser, matterId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const count = row(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM offers
           WHERE firm_id = ? AND matter_id = ? AND confidentiality <> 'open'`,
        )
        .get(user.firmId, matterId),
    );
    return {
      matterId,
      permissions: { canWrite: this.canWriteMatter(user, matterId) },
      workSchedules: this.listWorkSchedules(user.firmId, matterId),
      lossSchedules: this.listLossSchedules(user.firmId, matterId),
      generalDamagesReviews: this.generalDamagesReviews(user.firmId, matterId),
      openOffers: this.listOffers(user.firmId, matterId, false),
      protectedOfferCount: Number(count?.count ?? 0),
    };
  }

  getProtectedOffers(user: SessionUser, matterId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    return this.listOffers(user.firmId, matterId, true);
  }

  getReadinessProjection(firmId: string, matterId: string) {
    const workSchedules = this.listWorkSchedules(firmId, matterId);
    const lossSchedules = this.listLossSchedules(firmId, matterId);
    const reviews = this.generalDamagesReviews(firmId, matterId);
    return {
      currentWorkSchedule: workSchedules.find(({ status }) => status === 'approved') ?? null,
      currentLossSchedule: lossSchedules.find(({ status }) => status === 'approved') ?? null,
      currentGeneralDamagesReview: reviews[0] ?? null,
    };
  }

  createWorkSchedule(
    user: SessionUser,
    matterId: string,
    input: CreateWorkScheduleInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const source = this.resolveDocumentVersion(
      user.firmId,
      matterId,
      input.sourceDocumentVersionId,
    );
    this.requireScopedIds(
      'defects',
      user.firmId,
      matterId,
      input.items.flatMap(({ defectIds }) => defectIds),
    );
    this.requireScopedIds(
      'evidence_items',
      user.firmId,
      matterId,
      input.items.flatMap(({ evidenceItemIds }) => evidenceItemIds),
    );
    if (
      input.basedOnScheduleId &&
      !this.database
        .prepare(
          'SELECT 1 FROM work_schedules WHERE id = ? AND firm_id = ? AND matter_id = ?',
        )
        .get(input.basedOnScheduleId, user.firmId, matterId)
    ) {
      throw new QuantumStoreError('INVALID_LINK', 'The earlier work schedule was not found.');
    }
    const scheduleId = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const next = Number(
        row(
          this.database
            .prepare(
              `SELECT COALESCE(MAX(schedule_version), 0) + 1 AS version
               FROM work_schedules WHERE firm_id = ? AND matter_id = ?`,
            )
            .get(user.firmId, matterId),
        )?.version ?? 1,
      );
      this.database
        .prepare(
          `INSERT INTO work_schedules (
            id, firm_id, matter_id, schedule_version, title, source_type,
            source_document_id, source_document_version_id,
            based_on_schedule_id, created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          scheduleId,
          user.firmId,
          matterId,
          next,
          input.title,
          input.sourceType,
          source?.documentId ?? null,
          source?.versionId ?? null,
          input.basedOnScheduleId,
          user.id,
          occurredAt,
          user.id,
          occurredAt,
        );
      input.items.forEach((item, index) => {
        const workItemId = randomUUID();
        this.database
          .prepare(
            `INSERT INTO work_items (
              id, firm_id, matter_id, schedule_id, lineage_key, area,
              description, responsibility_position, priority,
              target_start_on, target_completion_on, estimated_cost_minor,
              currency, contractor, source_note, display_position,
              created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?, ?)`,
          )
          .run(
            workItemId,
            user.firmId,
            matterId,
            scheduleId,
            item.lineageKey,
            item.area,
            item.description,
            item.responsibilityPosition,
            item.priority,
            item.targetStartOn,
            item.targetCompletionOn,
            item.estimatedCostMinor,
            item.contractor,
            item.sourceNote,
            index,
            user.id,
            occurredAt,
          );
        for (const defectId of new Set(item.defectIds)) {
          this.database
            .prepare(
              `INSERT INTO work_item_defects (
                id, firm_id, matter_id, work_item_id, defect_id, linked_by, linked_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              user.firmId,
              matterId,
              workItemId,
              defectId,
              user.id,
              occurredAt,
            );
        }
        for (const evidenceId of new Set(item.evidenceItemIds)) {
          this.database
            .prepare(
              `INSERT INTO work_item_evidence_links (
                id, firm_id, matter_id, work_item_id, evidence_item_id,
                purpose, linked_by, linked_at
              ) VALUES (?, ?, ?, ?, ?, 'source', ?, ?)`,
            )
            .run(
              randomUUID(),
              user.firmId,
              matterId,
              workItemId,
              evidenceId,
              user.id,
              occurredAt,
            );
        }
      });
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.work_schedule.created',
          entityType: 'work_schedule',
          entityId: scheduleId,
          title: 'Schedule of works created',
          after: { title: input.title, sourceType: input.sourceType, itemCount: input.items.length },
          occurredAt,
          idempotencyKey: `work-schedule:${scheduleId}`,
        },
        audit,
      );
    });
    return this.listWorkSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  approveWorkSchedule(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: ApproveWorkScheduleInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE work_schedules SET status = 'approved',
            record_version = record_version + 1, approval_note = ?,
            acknowledged_warnings_json = ?, approved_by = ?, approved_at = ?,
            updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?
             AND status = 'draft' AND record_version = ?`,
        )
        .run(
          input.approvalNote,
          canonicalJson(input.acknowledgedWarningKeys),
          user.id,
          occurredAt,
          user.id,
          occurredAt,
          scheduleId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (result.changes !== 1) {
        throw new QuantumStoreError('CONFLICT', 'The work schedule changed before approval.');
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.work_schedule.approved',
          entityType: 'work_schedule',
          entityId: scheduleId,
          title: 'Schedule of works approved',
          after: {
            approvalNote: input.approvalNote,
            acknowledgedWarningKeys: input.acknowledgedWarningKeys,
          },
          occurredAt,
          idempotencyKey: input.idempotencyKey,
        },
        audit,
      );
    });
    return this.listWorkSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  appendRepairEvent(
    user: SessionUser,
    matterId: string,
    workItemId: string,
    input: CreateRepairEventInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payload = canonicalJson(input);
    const existing = row(
      this.database
        .prepare(
          `SELECT id, command_payload_json AS payload FROM repair_events
           WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
        )
        .get(user.firmId, matterId, input.idempotencyKey),
    );
    if (existing) {
      if (String(existing.payload) !== payload) {
        throw new QuantumStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key has already been used with different data.',
        );
      }
      return this.repairEvents(user.firmId, matterId, workItemId).find(
        ({ id }) => id === String(existing.id),
      )!;
    }
    if (
      !this.database
        .prepare(
          'SELECT 1 FROM work_items WHERE id = ? AND firm_id = ? AND matter_id = ?',
        )
        .get(workItemId, user.firmId, matterId)
    ) {
      throw new QuantumStoreError('NOT_FOUND', 'The work item was not found.');
    }
    this.requireScopedIds(
      'evidence_items',
      user.firmId,
      matterId,
      input.evidenceItemIds,
    );
    if (
      input.supersedesEventId &&
      !this.database
        .prepare(
          `SELECT 1 FROM repair_events
           WHERE id = ? AND firm_id = ? AND matter_id = ? AND work_item_id = ?`,
        )
        .get(input.supersedesEventId, user.firmId, matterId, workItemId)
    ) {
      throw new QuantumStoreError('INVALID_LINK', 'The corrected repair event was not found.');
    }
    const eventId = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO repair_events (
            id, firm_id, matter_id, work_item_id, event_type, occurred_at,
            actor_type, note, appointment_from, appointment_to, verifier,
            supersedes_event_id, correction_reason, idempotency_key,
            command_payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          user.firmId,
          matterId,
          workItemId,
          input.eventType,
          input.occurredAt,
          input.actorType,
          input.note,
          input.appointmentFrom,
          input.appointmentTo,
          input.verifier,
          input.supersedesEventId,
          input.correctionReason,
          input.idempotencyKey,
          payload,
          user.id,
          createdAt,
        );
      for (const evidenceId of new Set(input.evidenceItemIds)) {
        this.database
          .prepare(
            `INSERT INTO repair_event_evidence_links (
              id, firm_id, matter_id, repair_event_id, evidence_item_id,
              linked_by, linked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            user.firmId,
            matterId,
            eventId,
            evidenceId,
            user.id,
            createdAt,
          );
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.repair_event.recorded',
          entityType: 'repair_event',
          entityId: eventId,
          title: 'Repair status recorded',
          after: { workItemId, eventType: input.eventType },
          occurredAt: createdAt,
          idempotencyKey: input.idempotencyKey,
        },
        audit,
      );
    });
    return this.repairEvents(user.firmId, matterId, workItemId).find(
      ({ id }) => id === eventId,
    )!;
  }

  createLossSchedule(
    user: SessionUser,
    matterId: string,
    input: CreateLossScheduleInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    if (
      input.basedOnScheduleId &&
      !this.database
        .prepare(
          'SELECT 1 FROM loss_schedules WHERE id = ? AND firm_id = ? AND matter_id = ?',
        )
        .get(input.basedOnScheduleId, user.firmId, matterId)
    ) {
      throw new QuantumStoreError('INVALID_LINK', 'The earlier loss schedule was not found.');
    }
    const scheduleId = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const next = Number(
        row(
          this.database
            .prepare(
              `SELECT COALESCE(MAX(schedule_version), 0) + 1 AS version
               FROM loss_schedules WHERE firm_id = ? AND matter_id = ?`,
            )
            .get(user.firmId, matterId),
        )?.version ?? 1,
      );
      this.database
        .prepare(
          `INSERT INTO loss_schedules (
            id, firm_id, matter_id, schedule_version, title, based_on_schedule_id,
            valuation_on, currency, notes, created_by, created_at,
            updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          scheduleId,
          user.firmId,
          matterId,
          next,
          input.title,
          input.basedOnScheduleId,
          input.valuationOn,
          input.currency,
          input.notes,
          user.id,
          occurredAt,
          user.id,
          occurredAt,
        );
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.loss_schedule.created',
          entityType: 'loss_schedule',
          entityId: scheduleId,
          title: 'Schedule of loss created',
          after: { title: input.title, valuationOn: input.valuationOn },
          occurredAt,
          idempotencyKey: `loss-schedule:${scheduleId}`,
        },
        audit,
      );
    });
    return this.listLossSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  addLossItem(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: CreateLossItemInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    this.requireScopedIds(
      'evidence_items',
      user.firmId,
      matterId,
      input.evidenceItemIds,
    );
    const calculated = calculateLossAmount({
      calculationType: input.calculationType,
      quantity: input.quantity ?? undefined,
      unitLabel: input.unitLabel,
      rateMinor: input.rateMinor ?? undefined,
      fixedAmountMinor: input.fixedAmountMinor ?? undefined,
      manualAmountMinor: input.manualAmountMinor ?? undefined,
      manualBasis: input.manualBasis,
    });
    const itemId = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const schedule = row(
        this.database
          .prepare(
            `SELECT record_version AS version, status FROM loss_schedules
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .get(scheduleId, user.firmId, matterId),
      );
      if (!schedule) throw new QuantumStoreError('NOT_FOUND', 'The loss schedule was not found.');
      if (String(schedule.status) !== 'draft') {
        throw new QuantumStoreError('APPROVAL_BLOCKED', 'An approved loss schedule cannot be edited.');
      }
      if (Number(schedule.version) !== input.expectedVersion) {
        throw new QuantumStoreError('CONFLICT', 'The loss schedule changed before it was saved.');
      }
      const position = Number(
        row(
          this.database
            .prepare(
              `SELECT COALESCE(MAX(display_position), -1) + 1 AS position
               FROM loss_items WHERE firm_id = ? AND matter_id = ? AND schedule_id = ?`,
            )
            .get(user.firmId, matterId, scheduleId),
        )?.position ?? 0,
      );
      this.database
        .prepare(
          `INSERT INTO loss_items (
            id, firm_id, matter_id, schedule_id, lineage_key, category,
            description, period_start_on, period_end_on, calculation_type,
            quantity, unit_label, rate_minor, fixed_amount_minor,
            manual_amount_minor, manual_basis, calculated_amount_minor,
            currency, position, evidence_status, source_note, display_position,
            created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'GBP', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          user.firmId,
          matterId,
          scheduleId,
          input.lineageKey,
          input.category,
          input.description,
          input.periodStartOn,
          input.periodEndOn,
          input.calculationType,
          input.quantity,
          input.unitLabel,
          input.rateMinor,
          input.fixedAmountMinor,
          input.manualAmountMinor,
          input.manualBasis,
          calculated.amountMinor,
          input.position,
          input.evidenceStatus,
          input.sourceNote,
          position,
          user.id,
          occurredAt,
          user.id,
          occurredAt,
        );
      for (const evidenceId of new Set(input.evidenceItemIds)) {
        this.database
          .prepare(
            `INSERT INTO loss_item_evidence_links (
              id, firm_id, matter_id, loss_item_id, evidence_item_id,
              purpose, linked_by, linked_at
            ) VALUES (?, ?, ?, ?, ?, 'support', ?, ?)`,
          )
          .run(
            randomUUID(),
            user.firmId,
            matterId,
            itemId,
            evidenceId,
            user.id,
            occurredAt,
          );
      }
      const updated = this.database
        .prepare(
          `UPDATE loss_schedules SET record_version = record_version + 1,
            updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ? AND record_version = ?`,
        )
        .run(
          user.id,
          occurredAt,
          scheduleId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (updated.changes !== 1) {
        throw new QuantumStoreError('CONFLICT', 'The loss schedule changed before it was saved.');
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.loss_item.created',
          entityType: 'loss_item',
          entityId: itemId,
          title: 'Loss item added',
          after: {
            scheduleId,
            category: input.category,
            calculatedAmountMinor: calculated.amountMinor,
          },
          occurredAt,
          idempotencyKey: `loss-item:${itemId}`,
        },
        audit,
      );
    });
    return this.listLossSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  updateLossItem(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    itemId: string,
    input: UpdateLossItemInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    this.requireScopedIds(
      'evidence_items',
      user.firmId,
      matterId,
      input.evidenceItemIds,
    );
    const calculated = calculateLossAmount({
      calculationType: input.calculationType,
      quantity: input.quantity ?? undefined,
      unitLabel: input.unitLabel,
      rateMinor: input.rateMinor ?? undefined,
      fixedAmountMinor: input.fixedAmountMinor ?? undefined,
      manualAmountMinor: input.manualAmountMinor ?? undefined,
      manualBasis: input.manualBasis,
    });
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const schedule = row(
        this.database
          .prepare(
            `SELECT record_version AS version, status FROM loss_schedules
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          )
          .get(scheduleId, user.firmId, matterId),
      );
      if (!schedule) throw new QuantumStoreError('NOT_FOUND', 'The loss schedule was not found.');
      if (String(schedule.status) !== 'draft') {
        throw new QuantumStoreError('APPROVAL_BLOCKED', 'An approved loss schedule cannot be edited.');
      }
      if (Number(schedule.version) !== input.expectedVersion) {
        throw new QuantumStoreError('CONFLICT', 'The loss schedule changed before it was saved.');
      }
      const updatedItem = this.database
        .prepare(
          `UPDATE loss_items SET lineage_key = ?, category = ?, description = ?,
            period_start_on = ?, period_end_on = ?, calculation_type = ?,
            quantity = ?, unit_label = ?, rate_minor = ?, fixed_amount_minor = ?,
            manual_amount_minor = ?, manual_basis = ?, calculated_amount_minor = ?,
            position = ?, evidence_status = ?, source_note = ?,
            updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ? AND schedule_id = ?`,
        )
        .run(
          input.lineageKey,
          input.category,
          input.description,
          input.periodStartOn,
          input.periodEndOn,
          input.calculationType,
          input.quantity,
          input.unitLabel,
          input.rateMinor,
          input.fixedAmountMinor,
          input.manualAmountMinor,
          input.manualBasis,
          calculated.amountMinor,
          input.position,
          input.evidenceStatus,
          input.sourceNote,
          user.id,
          occurredAt,
          itemId,
          user.firmId,
          matterId,
          scheduleId,
        );
      if (updatedItem.changes !== 1) {
        throw new QuantumStoreError('NOT_FOUND', 'The loss item was not found.');
      }
      for (const evidenceId of new Set(input.evidenceItemIds)) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO loss_item_evidence_links (
              id, firm_id, matter_id, loss_item_id, evidence_item_id,
              purpose, linked_by, linked_at
            ) VALUES (?, ?, ?, ?, ?, 'support', ?, ?)`,
          )
          .run(
            randomUUID(),
            user.firmId,
            matterId,
            itemId,
            evidenceId,
            user.id,
            occurredAt,
          );
      }
      const updatedSchedule = this.database
        .prepare(
          `UPDATE loss_schedules SET record_version = record_version + 1,
            updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?
             AND status = 'draft' AND record_version = ?`,
        )
        .run(
          user.id,
          occurredAt,
          scheduleId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (updatedSchedule.changes !== 1) {
        throw new QuantumStoreError('CONFLICT', 'The loss schedule changed before it was saved.');
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.loss_item.updated',
          entityType: 'loss_item',
          entityId: itemId,
          title: 'Loss item updated',
          after: {
            scheduleId,
            category: input.category,
            calculatedAmountMinor: calculated.amountMinor,
          },
          occurredAt,
          idempotencyKey: `loss-item-update:${itemId}:${input.expectedVersion}`,
        },
        audit,
      );
    });
    return this.listLossSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  approveLossSchedule(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: ApproveLossScheduleInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE loss_schedules SET status = 'approved',
            record_version = record_version + 1, approval_note = ?,
            acknowledged_gaps_json = ?, approved_by = ?, approved_at = ?,
            updated_by = ?, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ?
             AND status = 'draft' AND record_version = ?`,
        )
        .run(
          input.approvalNote,
          canonicalJson(input.acknowledgedEvidenceGapItemIds),
          user.id,
          occurredAt,
          user.id,
          occurredAt,
          scheduleId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (result.changes !== 1) {
        throw new QuantumStoreError('CONFLICT', 'The loss schedule changed before approval.');
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.loss_schedule.approved',
          entityType: 'loss_schedule',
          entityId: scheduleId,
          title: 'Schedule of loss approved',
          after: {
            approvalNote: input.approvalNote,
            acknowledgedEvidenceGapItemIds: input.acknowledgedEvidenceGapItemIds,
          },
          occurredAt,
          idempotencyKey: input.idempotencyKey,
        },
        audit,
      );
    });
    return this.listLossSchedules(user.firmId, matterId).find(({ id }) => id === scheduleId)!;
  }

  createGeneralDamagesReview(
    user: SessionUser,
    matterId: string,
    input: CreateGeneralDamagesReviewInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    this.requireScopedIds(
      'evidence_items',
      user.firmId,
      matterId,
      input.evidenceItemIds,
    );
    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO general_damages_reviews (
            id, firm_id, matter_id, valuation_on, low_minor, high_minor,
            preferred_minor, currency, basis, authorities_json, review_note,
            none_presently_advanced, supersedes_review_id, idempotency_key,
            command_payload_json, reviewed_by, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          input.valuationOn,
          input.lowMinor,
          input.highMinor,
          input.preferredMinor,
          input.basis,
          canonicalJson(input.authorities),
          input.reviewNote,
          input.nonePresentlyAdvanced ? 1 : 0,
          input.supersedesReviewId,
          input.idempotencyKey,
          canonicalJson(input),
          user.id,
          occurredAt,
        );
      for (const evidenceId of new Set(input.evidenceItemIds)) {
        this.database
          .prepare(
            `INSERT INTO general_damages_evidence_links (
              id, firm_id, matter_id, review_id, evidence_item_id,
              linked_by, linked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), user.firmId, matterId, id, evidenceId, user.id, occurredAt);
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.general_damages.reviewed',
          entityType: 'general_damages_review',
          entityId: id,
          title: 'General damages reviewed',
          after: {
            valuationOn: input.valuationOn,
            lowMinor: input.lowMinor,
            highMinor: input.highMinor,
            nonePresentlyAdvanced: input.nonePresentlyAdvanced,
          },
          occurredAt,
          idempotencyKey: input.idempotencyKey,
        },
        audit,
      );
    });
    return this.generalDamagesReviews(user.firmId, matterId).find(
      (review) => review.id === id,
    )!;
  }

  createOffer(
    user: SessionUser,
    matterId: string,
    input: CreateOfferInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payload = canonicalJson(input);
    const existing = row(
      this.database
        .prepare(
          `SELECT id, command_payload_json AS payload, confidentiality
           FROM offers WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
        )
        .get(user.firmId, matterId, input.idempotencyKey),
    );
    if (existing) {
      if (String(existing.payload) !== payload) {
        throw new QuantumStoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key has already been used with different data.',
        );
      }
      return this.listOffers(
        user.firmId,
        matterId,
        String(existing.confidentiality) !== 'open',
      ).find(({ id }) => id === String(existing.id))!;
    }
    const source = this.resolveDocumentVersion(
      user.firmId,
      matterId,
      input.writtenOfferDocumentVersionId,
    );
    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const number = Number(
        row(
          this.database
            .prepare('SELECT COUNT(*) + 1 AS number FROM offers WHERE firm_id = ? AND matter_id = ?')
            .get(user.firmId, matterId),
        )?.number ?? 1,
      );
      this.database
        .prepare(
          `INSERT INTO offers (
            id, firm_id, matter_id, offer_reference, direction, offer_type,
            confidentiality, scope, scope_description, damages_minor,
            costs_minor, total_minor, currency, works_terms, non_money_terms,
            interest_treatment, written_document_id,
            written_document_version_id, made_on, idempotency_key,
            command_payload_json, created_by, created_at, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          `OFFER-${String(number).padStart(3, '0')}`,
          input.direction,
          input.offerType,
          input.confidentiality,
          input.scope,
          input.scopeDescription,
          input.damagesMinor,
          input.costsMinor,
          input.totalMinor,
          input.currency,
          input.worksTerms,
          input.nonMoneyTerms,
          input.interestTreatment,
          source?.documentId ?? null,
          source?.versionId ?? null,
          input.madeOn,
          input.idempotencyKey,
          payload,
          user.id,
          occurredAt,
          user.id,
          occurredAt,
        );
      if (input.part36) {
        this.database
          .prepare(
            `INSERT INTO part_36_terms (
              offer_id, firm_id, matter_id, relevant_period_days,
              relevant_period_basis, includes_counterclaim, payment_period_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            user.firmId,
            matterId,
            input.part36.relevantPeriodDays,
            input.part36.relevantPeriodBasis,
            input.part36.includesCounterclaim ? 1 : 0,
            input.part36.paymentPeriodDays,
          );
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.offer.recorded',
          entityType: input.confidentiality === 'open' ? 'offer' : 'protected_offer',
          entityId: id,
          title: 'Offer recorded',
          after: input,
          occurredAt,
          idempotencyKey: input.idempotencyKey,
          protected: input.confidentiality !== 'open',
        },
        audit,
      );
    });
    return this.listOffers(user.firmId, matterId, input.confidentiality !== 'open').find(
      (offer) => offer.id === id,
    )!;
  }

  appendOfferEvent(
    user: SessionUser,
    matterId: string,
    offerId: string,
    input: RecordOfferEventInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const offer = row(
      this.database
        .prepare(
          'SELECT confidentiality FROM offers WHERE id = ? AND firm_id = ? AND matter_id = ?',
        )
        .get(offerId, user.firmId, matterId),
    );
    if (!offer) throw new QuantumStoreError('NOT_FOUND', 'The offer was not found.');
    const source = this.resolveDocumentVersion(
      user.firmId,
      matterId,
      input.sourceDocumentVersionId,
    );
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO offer_events (
            id, firm_id, matter_id, offer_id, event_type, occurred_at, note,
            source_document_id, source_document_version_id, supersedes_event_id,
            correction_reason, explicit_confirmation, idempotency_key,
            command_payload_json, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          matterId,
          offerId,
          input.eventType,
          input.occurredAt,
          input.note,
          source?.documentId ?? null,
          source?.versionId ?? null,
          input.supersedesEventId,
          input.correctionReason,
          input.explicitConfirmation ? 1 : 0,
          input.idempotencyKey,
          canonicalJson(input),
          user.id,
          createdAt,
        );
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.offer_event.recorded',
          entityType:
            String(offer.confidentiality) === 'open' ? 'offer_event' : 'protected_offer_event',
          entityId: id,
          title: 'Offer event recorded',
          after: { offerId, eventType: input.eventType },
          occurredAt: createdAt,
          idempotencyKey: input.idempotencyKey,
          protected: String(offer.confidentiality) !== 'open',
        },
        audit,
      );
    });
    return this.listOffers(
      user.firmId,
      matterId,
      String(offer.confidentiality) !== 'open',
    ).find((candidate) => candidate.id === offerId)!;
  }

  reviewPart36(
    user: SessionUser,
    matterId: string,
    offerId: string,
    input: ReviewPart36Input,
    projectedEndOn: string,
    explanation: string,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const result = this.database
        .prepare(
          `UPDATE part_36_terms SET record_version = record_version + 1,
            service_on = ?, service_confirmed = 1,
            projected_period_end_on = ?, calculation_explanation = ?,
            validation_status = ?, validation_note = ?, reviewed_by = ?,
            reviewed_at = ?
           WHERE offer_id = ? AND firm_id = ? AND matter_id = ?
             AND record_version = ?`,
        )
        .run(
          input.serviceOn,
          projectedEndOn,
          explanation,
          input.validationStatus,
          input.validationNote,
          user.id,
          occurredAt,
          offerId,
          user.firmId,
          matterId,
          input.expectedVersion,
        );
      if (result.changes !== 1) {
        throw new QuantumStoreError('CONFLICT', 'The Part 36 review changed before it was saved.');
      }
      this.appendOperationalRecords(
        user,
        matterId,
        {
          action: 'quantum.part36.reviewed',
          entityType: 'protected_offer',
          entityId: offerId,
          title: 'Part 36 terms reviewed',
          after: { validationStatus: input.validationStatus },
          occurredAt,
          idempotencyKey: input.idempotencyKey,
          protected: true,
        },
        audit,
      );
    });
    return this.listOffers(user.firmId, matterId, true).find(({ id }) => id === offerId)!;
  }
}
