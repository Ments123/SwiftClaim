import type { DatabaseSync } from 'node:sqlite';

import type { ProceedingsReadinessProvider } from '../workflow/service.js';
import { projectDirection, type ProjectionEvent } from './projections.js';

type Row = Record<string, string | number | null>;

export class DatabaseProceedingsReadiness implements ProceedingsReadinessProvider {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  getProceedingsReadiness(
    firmId: string,
    matterId: string,
    stageKey: 'negotiation' | 'proceedings',
  ) {
    const proceeding = this.database.prepare(`SELECT id, procedure_type AS procedureType,
      current_authority_version_id AS currentAuthorityVersionId,
      sealed_claim_form_version_id AS sealedClaimFormVersionId,
      issued_at AS issuedAt, current_state AS currentState,
      disposal_position AS disposalPosition
      FROM court_proceedings WHERE firm_id = ? AND matter_id = ? AND active = 1
      ORDER BY updated_at DESC, id DESC LIMIT 1`).get(firmId, matterId) as Row | undefined;
    const authority = proceeding ? this.database.prepare(`SELECT id,
      procedure_type AS procedureType,
      claim_form_document_version_id AS claimFormDocumentVersionId,
      expires_at AS expiresAt, review_on AS reviewOn
      FROM proceeding_authority_versions
      WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
      ORDER BY version DESC LIMIT 1`).get(firmId, matterId, proceeding.id) as Row | undefined : undefined;
    const today = this.now().toISOString().slice(0, 10);
    const authorityEligible = Boolean(
      proceeding && authority &&
      proceeding.currentAuthorityVersionId === authority.id &&
      proceeding.procedureType === authority.procedureType &&
      (!authority.expiresAt || String(authority.expiresAt) >= this.now().toISOString()) &&
      (!authority.reviewOn || String(authority.reviewOn) >= today),
    );
    const controls = [{
      key: 'court_authority_recorded' as const,
      eligible: authorityEligible,
      explanation: authorityEligible
        ? 'Current independent authority covers the exact claim documents and procedure.'
        : 'Record current independent issue authority for the exact claim documents and procedure.',
    }];
    const progressionBlockers: Array<{
      key: string; label: string; severity: 'warning' | 'critical';
    }> = [];

    if (stageKey === 'proceedings') {
      if (!proceeding?.issuedAt || !proceeding.sealedClaimFormVersionId) {
        progressionBlockers.push({
          key: 'court_issue_not_verified',
          label: 'Court issue has not been verified against the retained sealed claim form.',
          severity: 'critical',
        });
      }
      if (proceeding?.currentState === 'disposed' && proceeding.disposalPosition !== 'reviewed') {
        progressionBlockers.push({
          key: 'court_disposal_not_reviewed',
          label: 'The procedural effect of the court disposal has not been human-reviewed.',
          severity: 'critical',
        });
      }
      const directions = proceeding ? this.database.prepare(`SELECT id, due_at AS dueAt
        FROM court_directions WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .all(firmId, matterId, proceeding.id) as Row[] : [];
      for (const direction of directions) {
        const events = this.database.prepare(`SELECT id, event_type AS eventType,
          occurred_at AS occurredAt, recorded_at AS recordedAt,
          supersedes_event_id AS supersedesEventId FROM court_direction_events
          WHERE firm_id = ? AND matter_id = ? AND direction_id = ?`)
          .all(firmId, matterId, direction.id) as Row[];
        const projection = projectDirection(events.map((event): ProjectionEvent => ({
          id: String(event.id), eventType: String(event.eventType),
          occurredAt: String(event.occurredAt), recordedAt: String(event.recordedAt),
          supersedesEventId: event.supersedesEventId ? String(event.supersedesEventId) : null,
        })), this.now().toISOString(), direction.dueAt ? String(direction.dueAt) : null);
        if (!['satisfied', 'superseded', 'waived_by_order'].includes(projection.state)) {
          progressionBlockers.push({
            key: `court_direction_open:${String(direction.id)}`,
            label: projection.overdue
              ? 'An operative court direction is overdue.'
              : 'An operative court direction remains outstanding.',
            severity: projection.overdue ? 'critical' : 'warning',
          });
        }
      }
    }
    return { controls, progressionBlockers };
  }
}
