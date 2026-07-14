import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { RecordConflictDecisionInput } from '../../shared/contracts.js';
import { hasCapability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  IntakeStore,
  IntakeStoreError,
} from './store.js';
import type {
  ConflictCheckResult,
  ConflictDecisionResult,
  ConflictMatch,
  EnquiryDetail,
} from './types.js';

type Row = Record<string, string | number | null>;

export type IntakeConflictErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT_REVIEW_REQUIRED'
  | 'STALE_CHECK'
  | 'VALIDATION_ERROR';

export class IntakeConflictError extends Error {
  constructor(
    public readonly code: IntakeConflictErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IntakeConflictError';
  }
}

function normalizeWords(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function queryFor(enquiry: EnquiryDetail) {
  return {
    name: normalizeWords(enquiry.client.displayName),
    email: normalizeEmail(enquiry.client.email),
    phone: normalizePhone(enquiry.client.phone),
    dateOfBirth: enquiry.client.dateOfBirth,
    address: normalizeWords(
      [
        enquiry.property.addressLine1,
        enquiry.property.addressLine2,
        enquiry.property.city,
        enquiry.property.county,
        enquiry.property.postcode,
        enquiry.property.country,
      ].join(' '),
    ),
    postcode: normalizeWords(enquiry.property.postcode),
    landlord: normalizeWords(enquiry.landlord?.name ?? ''),
  };
}

export class IntakeConflictService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly store: IntakeStore,
    private readonly now: () => Date,
  ) {}

  private requireEnquiry(user: SessionUser, enquiryId: string): EnquiryDetail {
    try {
      const enquiry = this.store.getEnquiry(user, enquiryId);
      if (!enquiry) {
        throw new IntakeConflictError(
          'NOT_FOUND',
          'The requested resource was not found.',
        );
      }
      return enquiry;
    } catch (error) {
      if (error instanceof IntakeStoreError && error.code === 'FORBIDDEN') {
        throw new IntakeConflictError(
          'FORBIDDEN',
          'You do not have permission to access intake records.',
        );
      }
      throw error;
    }
  }

  private findMatches(
    user: SessionUser,
    enquiry: EnquiryDetail,
  ): ConflictMatch[] {
    const query = queryFor(enquiry);
    const matches: ConflictMatch[] = [];
    const seen = new Set<string>();
    const add = (key: string, match: ConflictMatch) => {
      if (seen.has(key) || matches.length >= 25) return;
      seen.add(key);
      matches.push(match);
    };

    const matterCandidates = rows(
      this.database
        .prepare(
          `SELECT m.id, m.client_name AS clientName,
                  p.name AS partyName, p.email AS partyEmail,
                  p.phone AS partyPhone
           FROM matters m
           LEFT JOIN parties p
             ON p.matter_id = m.id AND p.firm_id = m.firm_id
           WHERE m.firm_id = ?
             AND (LOWER(TRIM(m.client_name)) = ?
               OR LOWER(TRIM(COALESCE(p.name, ''))) = ?
               OR (? <> '' AND LOWER(TRIM(COALESCE(p.email, ''))) = ?))
           ORDER BY m.created_at DESC
           LIMIT 25`,
        )
        .all(
          user.firmId,
          query.name,
          query.name,
          query.email,
          query.email,
        ),
    );
    for (const candidate of matterCandidates) {
      const matchedOn: string[] = [];
      if (
        normalizeWords(String(candidate.clientName ?? '')) === query.name ||
        normalizeWords(String(candidate.partyName ?? '')) === query.name
      ) {
        matchedOn.push('name');
      }
      if (
        query.email &&
        normalizeEmail(String(candidate.partyEmail ?? '')) === query.email
      ) {
        matchedOn.push('email');
      }
      if (
        query.phone &&
        normalizePhone(String(candidate.partyPhone ?? '')) === query.phone
      ) {
        matchedOn.push('phone');
      }
      if (matchedOn.length > 0) {
        add(`matter:${candidate.id}`, {
          source: 'matter',
          display: 'Existing firm matter — conflict review required',
          matchedOn,
        });
      }
    }

    const enquiryCandidates = rows(
      this.database
        .prepare(
          `SELECT e.id, c.normalized_name AS normalizedName,
                  c.normalized_email AS normalizedEmail,
                  c.normalized_phone AS normalizedPhone,
                  c.date_of_birth AS dateOfBirth,
                  p.normalized_address AS normalizedAddress,
                  LOWER(REPLACE(p.postcode, ' ', '')) AS normalizedPostcode,
                  o.normalized_name AS normalizedLandlord
           FROM enquiries e
           JOIN contacts c
             ON c.id = e.prospective_contact_id AND c.firm_id = e.firm_id
           JOIN properties p
             ON p.id = e.property_id AND p.firm_id = e.firm_id
           LEFT JOIN organisations o
             ON o.id = e.landlord_organisation_id AND o.firm_id = e.firm_id
           WHERE e.firm_id = ? AND e.id <> ?
             AND (c.normalized_name = ?
               OR (? <> '' AND c.normalized_email = ?)
               OR (? <> '' AND c.normalized_phone = ?)
               OR p.normalized_address = ?
               OR LOWER(REPLACE(p.postcode, ' ', '')) = ?
               OR (? <> '' AND o.normalized_name = ?))
           ORDER BY e.created_at DESC
           LIMIT 25`,
        )
        .all(
          user.firmId,
          enquiry.id,
          query.name,
          query.email,
          query.email,
          query.phone,
          query.phone,
          query.address,
          query.postcode.replaceAll(' ', ''),
          query.landlord,
          query.landlord,
        ),
    );
    for (const candidate of enquiryCandidates) {
      const matchedOn: string[] = [];
      if (String(candidate.normalizedName) === query.name) matchedOn.push('name');
      if (query.email && candidate.normalizedEmail === query.email) {
        matchedOn.push('email');
      }
      if (query.phone && candidate.normalizedPhone === query.phone) {
        matchedOn.push('phone');
      }
      if (
        query.dateOfBirth &&
        String(candidate.dateOfBirth ?? '') === query.dateOfBirth
      ) {
        matchedOn.push('date_of_birth');
      }
      if (String(candidate.normalizedAddress) === query.address) {
        matchedOn.push('address');
      }
      if (
        String(candidate.normalizedPostcode) ===
        query.postcode.replaceAll(' ', '')
      ) {
        matchedOn.push('postcode');
      }
      if (
        query.landlord &&
        String(candidate.normalizedLandlord ?? '') === query.landlord
      ) {
        matchedOn.push('landlord');
      }
      add(`enquiry:${candidate.id}`, {
        source: 'enquiry',
        display: 'Existing firm enquiry — conflict review required',
        matchedOn,
      });
    }

    const contactCandidates = rows(
      this.database
        .prepare(
          `SELECT id, normalized_name AS normalizedName,
                  normalized_email AS normalizedEmail,
                  normalized_phone AS normalizedPhone,
                  date_of_birth AS dateOfBirth
           FROM contacts
           WHERE firm_id = ? AND id <> ?
             AND (normalized_name = ?
               OR (? <> '' AND normalized_email = ?)
               OR (? <> '' AND normalized_phone = ?))
           ORDER BY created_at DESC LIMIT 25`,
        )
        .all(
          user.firmId,
          enquiry.client.id,
          query.name,
          query.email,
          query.email,
          query.phone,
          query.phone,
        ),
    );
    for (const candidate of contactCandidates) {
      const matchedOn: string[] = [];
      if (candidate.normalizedName === query.name) matchedOn.push('name');
      if (query.email && candidate.normalizedEmail === query.email) {
        matchedOn.push('email');
      }
      if (query.phone && candidate.normalizedPhone === query.phone) {
        matchedOn.push('phone');
      }
      if (
        query.dateOfBirth &&
        String(candidate.dateOfBirth ?? '') === query.dateOfBirth
      ) {
        matchedOn.push('date_of_birth');
      }
      add(`contact:${candidate.id}`, {
        source: 'contact',
        display: 'Existing firm contact — conflict review required',
        matchedOn,
      });
    }

    const propertyCandidates = rows(
      this.database
        .prepare(
          `SELECT id, normalized_address AS normalizedAddress,
                  LOWER(REPLACE(postcode, ' ', '')) AS normalizedPostcode
           FROM properties
           WHERE firm_id = ? AND id <> ?
             AND (normalized_address = ?
               OR LOWER(REPLACE(postcode, ' ', '')) = ?)
           ORDER BY created_at DESC LIMIT 25`,
        )
        .all(
          user.firmId,
          enquiry.property.id,
          query.address,
          query.postcode.replaceAll(' ', ''),
        ),
    );
    for (const candidate of propertyCandidates) {
      const matchedOn: string[] = [];
      if (candidate.normalizedAddress === query.address) matchedOn.push('address');
      if (
        String(candidate.normalizedPostcode) ===
        query.postcode.replaceAll(' ', '')
      ) {
        matchedOn.push('postcode');
      }
      add(`property:${candidate.id}`, {
        source: 'property',
        display: 'Existing firm property — conflict review required',
        matchedOn,
      });
    }

    if (enquiry.landlord && query.landlord) {
      for (const candidate of rows(
        this.database
          .prepare(
            `SELECT id FROM organisations
             WHERE firm_id = ? AND id <> ? AND normalized_name = ?
             ORDER BY created_at DESC LIMIT 25`,
          )
          .all(user.firmId, enquiry.landlord.id, query.landlord),
      )) {
        add(`organisation:${candidate.id}`, {
          source: 'organisation',
          display: 'Existing firm organisation — conflict review required',
          matchedOn: ['landlord'],
        });
      }
    }

    return matches.slice(0, 25);
  }

  runCheck(
    user: SessionUser,
    enquiryId: string,
    context: AuditContext,
  ): ConflictCheckResult {
    if (!hasCapability(user, 'intake.write')) {
      throw new IntakeConflictError(
        'FORBIDDEN',
        'You do not have permission to run conflict checks.',
      );
    }
    const enquiry = this.requireEnquiry(user, enquiryId);
    const matches = this.findMatches(user, enquiry);
    const occurredAt = this.now().toISOString();
    const id = randomUUID();
    const query = queryFor(enquiry);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO conflict_checks (
            id, firm_id, enquiry_id, query_json, results_json, match_count,
            run_by, run_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          enquiryId,
          JSON.stringify(query),
          JSON.stringify(matches),
          matches.length,
          user.id,
          occurredAt,
        );
      this.store.recordAudit({
        user,
        enquiryId,
        action: 'conflict.check_run',
        entityType: 'conflict_check',
        entityId: id,
        after: { matchCount: matches.length, matches },
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      id,
      enquiryId,
      matchCount: matches.length,
      matches,
      runAt: occurredAt,
      runBy: { id: user.id, name: user.name },
    };
  }

  recordDecision(
    user: SessionUser,
    enquiryId: string,
    command: RecordConflictDecisionInput,
    context: AuditContext,
  ): ConflictDecisionResult {
    if (!hasCapability(user, 'intake.decide')) {
      throw new IntakeConflictError(
        'FORBIDDEN',
        'You do not have permission to make conflict decisions.',
      );
    }
    this.requireEnquiry(user, enquiryId);
    const reason = command.reason.trim();
    if (reason.length < 10) {
      throw new IntakeConflictError(
        'VALIDATION_ERROR',
        'A conflict decision reason of at least 10 characters is required.',
      );
    }
    const latest = row(
      this.database
        .prepare(
          `SELECT id, match_count AS matchCount
           FROM conflict_checks
           WHERE firm_id = ? AND enquiry_id = ?
           ORDER BY run_at DESC, rowid DESC LIMIT 1`,
        )
        .get(user.firmId, enquiryId),
    );
    if (!latest || String(latest.id) !== command.checkId) {
      throw new IntakeConflictError(
        'STALE_CHECK',
        'Run or use the latest conflict check before recording a decision.',
      );
    }
    const matchCount = Number(latest.matchCount);
    if (command.decision === 'clear' && matchCount > 0) {
      throw new IntakeConflictError(
        'CONFLICT_REVIEW_REQUIRED',
        'Potential matches require an authorised override or a blocked decision.',
      );
    }
    if (
      command.decision === 'cleared_with_override' &&
      !hasCapability(user, 'intake.override_conflict')
    ) {
      throw new IntakeConflictError(
        'FORBIDDEN',
        'You do not have permission to override potential conflict matches.',
      );
    }

    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO conflict_decisions (
            id, firm_id, enquiry_id, conflict_check_id, decision, reason,
            decided_by, decided_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.firmId,
          enquiryId,
          command.checkId,
          command.decision,
          reason,
          user.id,
          occurredAt,
        );
      this.store.recordAudit({
        user,
        enquiryId,
        action: 'conflict.decision_recorded',
        entityType: 'conflict_decision',
        entityId: id,
        after: { checkId: command.checkId, decision: command.decision, reason },
        occurredAt,
        context,
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      id,
      checkId: command.checkId,
      decision: command.decision,
      reason,
      decidedAt: occurredAt,
      decidedBy: { id: user.id, name: user.name },
    };
  }
}
