import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { EvidenceService } from './service.js';
import { EvidenceStore } from './store.js';

const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z');
const audit = {
  requestId: 'request-evidence-service',
  ipAddress: '198.51.100.24',
};

function user(id: string, role: SessionUser['role']): SessionUser {
  return {
    id,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: `${role}@northstar.test`,
    name: role,
    role,
  };
}

const ava = user(SEED_IDS.ava, 'solicitor');
const finance = user(SEED_IDS.finance, 'finance');

const defectCommand = {
  location: 'Main bedroom',
  category: 'damp_mould',
  title: 'Damp and mould around window',
  description: 'Black mould and damp staining surround the bedroom window.',
  severity: 'serious',
  firstObservedOn: '2025-11-03',
  healthImpact: 'Client reports that the room is difficult to use.',
  hazardTags: ['damp'],
};

function noticeCommand(idempotencyKey = 'notice-service-001') {
  return {
    idempotencyKey,
    occurredAt: '2026-01-10T10:30:00.000Z',
    channel: 'email',
    recipientType: 'landlord',
    recipientName: 'Meridian Housing Association',
    summary: 'Reported bedroom damp and requested an urgent inspection.',
    proofStatus: 'linked',
    responseStatus: 'acknowledged',
    responseSummary: 'The repairs team acknowledged the complaint.',
    supersedesNoticeId: null,
  };
}

describe('EvidenceService', () => {
  let database: DatabaseSync;
  let service: EvidenceService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeEvidenceInvestigation: false });
    service = new EvidenceService(
      new EvidenceStore(database),
      () => FIXED_NOW,
    );
  });

  afterEach(() => database.close());

  it('returns a workspace but denies mutations for a read-only matter user', () => {
    expect(
      service.getWorkspace(finance, SEED_IDS.northstarMatter).permissions,
    ).toEqual({ canWrite: false });
    expect(() =>
      service.createDefect(
        finance,
        SEED_IDS.northstarMatter,
        defectCommand,
        audit,
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
    expect(() =>
      service.getWorkspace(ava, SEED_IDS.northstarRestrictedMatter),
    ).toThrow(
      expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
    );
  });

  it('validates commands and maps stale versions to stable service errors', () => {
    expect(() =>
      service.createDefect(
        ava,
        SEED_IDS.northstarMatter,
        { ...defectCommand, severity: 'urgent' },
        audit,
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 422,
        code: 'EVIDENCE_INVALID',
        details: expect.objectContaining({ fields: expect.any(Object) }),
      }),
    );
    const defect = service.createDefect(
      ava,
      SEED_IDS.northstarMatter,
      defectCommand,
      audit,
    );
    const update = {
      ...defectCommand,
      expectedVersion: 1,
      status: 'monitoring',
      statusReason: 'Inspection is booked and the condition remains unresolved.',
    };
    service.updateDefect(
      ava,
      SEED_IDS.northstarMatter,
      defect.id,
      update,
      audit,
    );
    expect(() =>
      service.updateDefect(
        ava,
        SEED_IDS.northstarMatter,
        defect.id,
        update,
        audit,
      ),
    ).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'CONFLICT' }),
    );
  });

  it('records actor, request and network metadata in one audited transaction', () => {
    const defect = service.createDefect(
      ava,
      SEED_IDS.northstarMatter,
      defectCommand,
      audit,
    );

    expect(
      database
        .prepare(
          `SELECT action, user_id AS userId, request_id AS requestId,
             ip_address AS ipAddress
           FROM audit_events WHERE entity_id = ?`,
        )
        .get(defect.id),
    ).toEqual({
      action: 'evidence.defect_created',
      userId: ava.id,
      requestId: audit.requestId,
      ipAddress: audit.ipAddress,
    });
    expect(
      database
        .prepare(
          `SELECT type, actor_user_id AS actorUserId
           FROM timeline_events
           WHERE json_extract(metadata_json, '$.defectId') = ?`,
        )
        .get(defect.id),
    ).toEqual({
      type: 'evidence.defect_created',
      actorUserId: ava.id,
    });
  });

  it('creates immutable corrections and rejects changed idempotency payloads', () => {
    const original = service.createNotice(
      ava,
      SEED_IDS.northstarMatter,
      noticeCommand(),
      audit,
    );
    const correction = service.createNotice(
      ava,
      SEED_IDS.northstarMatter,
      {
        ...noticeCommand('notice-service-002'),
        summary: 'Corrected the recipient and preserved the original record.',
        supersedesNoticeId: original.id,
      },
      audit,
    );
    expect(correction.supersedesNoticeId).toBe(original.id);
    expect(
      service.getWorkspace(ava, SEED_IDS.northstarMatter).notices,
    ).toHaveLength(2);

    expect(() =>
      service.createNotice(
        ava,
        SEED_IDS.northstarMatter,
        { ...noticeCommand(), summary: 'Changed replay data is forbidden.' },
        audit,
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    );
  });
});
