import type { DatabaseSync } from 'node:sqlite';

import type { NegotiationReadinessProvider } from '../workflow/service.js';
import { projectObligation, type ObligationProjectionEvent } from './projections.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

function rows(value: unknown): Row[] {
  return value as Row[];
}

export class DatabaseNegotiationReadiness implements NegotiationReadinessProvider {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  getNegotiationReadiness(
    firmId: string,
    matterId: string,
    stageKey: 'negotiation' | 'settlement',
  ) {
    const authority = this.database.prepare(
      `SELECT id, expires_at AS expiresAt, review_on AS reviewOn
       FROM settlement_authority_versions
       WHERE firm_id = ? AND matter_id = ? ORDER BY version DESC LIMIT 1`,
    ).get(firmId, matterId) as Row | undefined;
    const today = this.now().toISOString().slice(0, 10);
    const authorityEligible = Boolean(
      authority &&
      (!authority.expiresAt || String(authority.expiresAt) >= this.now().toISOString()) &&
      (!authority.reviewOn || String(authority.reviewOn) >= today),
    );
    const settlement = this.database.prepare(
      `SELECT id, current_terms_version_id AS currentTermsVersionId, status,
        court_approval_position AS courtApprovalPosition,
        instrument_document_version_id AS instrumentDocumentVersionId,
        source_communication_entry_id AS sourceCommunicationEntryId
       FROM settlements WHERE firm_id = ? AND matter_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
    ).get(firmId, matterId) as Row | undefined;
    const termsEligible = Boolean(settlement?.currentTermsVersionId);

    const controls = stageKey === 'negotiation'
      ? [{
        key: 'settlement_authority_recorded' as const,
        eligible: authorityEligible,
        explanation: authorityEligible
          ? 'Current settlement authority is recorded and within its review period.'
          : 'Record and review current settlement authority before progressing.',
      }]
      : [{
        key: 'settlement_terms_recorded' as const,
        eligible: termsEligible,
        explanation: termsEligible
          ? 'An exact current settlement terms version is recorded.'
          : 'Record an exact settlement terms version before progressing.',
      }];

    const progressionBlockers = [] as Array<{
      key: string;
      label: string;
      severity: 'warning' | 'critical';
    }>;
    if (stageKey === 'settlement' && settlement) {
      if (settlement.status !== 'concluded') {
        progressionBlockers.push({
          key: 'settlement_not_concluded',
          label: 'The settlement conclusion has not been human-confirmed.',
          severity: 'critical',
        });
      }
      if (
        settlement.courtApprovalPosition === 'unknown' ||
        settlement.courtApprovalPosition === 'required'
      ) {
        progressionBlockers.push({
          key: 'settlement_court_approval_unresolved',
          label: 'The court approval position remains unresolved.',
          severity: 'critical',
        });
      }
      if (!settlement.instrumentDocumentVersionId && !settlement.sourceCommunicationEntryId) {
        progressionBlockers.push({
          key: 'settlement_instrument_missing',
          label: 'No retained settlement instrument or source communication is recorded.',
          severity: 'critical',
        });
      }
      const obligations = rows(this.database.prepare(
        `SELECT id, due_at AS dueAt FROM settlement_obligations
         WHERE firm_id = ? AND matter_id = ? AND settlement_id = ?`,
      ).all(firmId, matterId, settlement.id));
      for (const obligation of obligations) {
        const events = rows(this.database.prepare(
          `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
            recorded_at AS recordedAt, supersedes_event_id AS supersedesEventId
           FROM settlement_obligation_events
           WHERE firm_id = ? AND matter_id = ? AND obligation_id = ?`,
        ).all(firmId, matterId, obligation.id)).map((event): ObligationProjectionEvent => ({
          id: String(event.id),
          eventType: String(event.eventType) as ObligationProjectionEvent['eventType'],
          occurredAt: String(event.occurredAt),
          recordedAt: String(event.recordedAt),
          supersedesEventId: event.supersedesEventId ? String(event.supersedesEventId) : null,
        }));
        const projection = projectObligation(
          events,
          this.now().toISOString(),
          obligation.dueAt ? String(obligation.dueAt) : null,
        );
        if (projection.state !== 'satisfied' && projection.state !== 'waived') {
          progressionBlockers.push({
            key: `settlement_obligation_open:${String(obligation.id)}`,
            label: 'A settlement obligation remains outstanding or disputed.',
            severity: 'critical',
          });
        }
      }
    }
    return { controls, progressionBlockers };
  }
}
