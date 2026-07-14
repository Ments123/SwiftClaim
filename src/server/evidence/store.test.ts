import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateAccessEventInput,
  CreateDefectInput,
  CreateEvidenceItemInput,
  CreateNoticeInput,
  UpdateDefectInput,
} from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import {
  EvidenceIdempotencyConflictError,
  EvidenceStateConflictError,
  EvidenceStore,
} from './store.js';

const FIXED_NOW = '2026-07-15T09:00:00.000Z';

function user(
  id: string,
  role: SessionUser['role'],
  firmId: string = SEED_IDS.northstarFirm,
): SessionUser {
  return {
    id,
    firmId,
    firmName:
      firmId === SEED_IDS.northstarFirm
        ? 'Northstar Legal'
        : 'Southbank Law',
    email: `${role}@example.test`,
    name: role,
    role,
  };
}

const ava = user(SEED_IDS.ava, 'solicitor');
const partner = user(SEED_IDS.partner, 'partner');
const finance = user(SEED_IDS.finance, 'finance');
const lewis = user(
  SEED_IDS.southbankUser,
  'partner',
  SEED_IDS.southbankFirm,
);

const context = {
  actorUserId: SEED_IDS.ava,
  occurredAt: FIXED_NOW,
  requestId: 'request-evidence-test',
  ipAddress: '127.0.0.1',
};

const defectInput: CreateDefectInput = {
  location: 'Main bedroom',
  category: 'damp_mould',
  title: 'Damp and mould around window',
  description: 'Black mould and damp staining surround the bedroom window.',
  severity: 'serious',
  firstObservedOn: '2025-11-03',
  healthImpact: 'Client reports that the room is difficult to use.',
  hazardTags: ['damp', 'respiratory concern'],
};

function noticeInput(
  idempotencyKey = 'notice-command-001',
): CreateNoticeInput {
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

function accessInput(
  idempotencyKey = 'access-command-001',
): CreateAccessEventInput {
  return {
    idempotencyKey,
    eventType: 'no_access',
    appointmentAt: '2026-02-02T14:00:00.000Z',
    notes: 'The contractor did not attend the arranged appointment.',
    supersedesAccessEventId: null,
  };
}

function insertDocumentVersion(
  database: DatabaseSync,
  matterId: string = SEED_IDS.northstarMatter,
  idSuffix: string = '1',
) {
  const documentId = `e1000000-0000-4000-8000-00000000000${idSuffix}`;
  const versionId = `e2000000-0000-4000-8000-00000000000${idSuffix}`;
  database
    .prepare(
      `INSERT INTO documents (
        id, firm_id, matter_id, title, category, created_by, created_at
      ) VALUES (?, ?, ?, 'Synthetic bedroom evidence', 'Photographs', ?, ?)`,
    )
    .run(
      documentId,
      SEED_IDS.northstarFirm,
      matterId,
      SEED_IDS.ava,
      FIXED_NOW,
    );
  database
    .prepare(
      `INSERT INTO document_versions (
        id, firm_id, document_id, version, original_name, mime_type,
        size_bytes, sha256, storage_key, uploaded_by, created_at
      ) VALUES (?, ?, ?, 1, 'synthetic-bedroom.jpg', 'image/jpeg', 128,
        ?, ?, ?, ?)`,
    )
    .run(
      versionId,
      SEED_IDS.northstarFirm,
      documentId,
      idSuffix.repeat(64),
      `test/evidence-${idSuffix}.jpg`,
      SEED_IDS.ava,
      FIXED_NOW,
    );
  return versionId;
}

describe('EvidenceStore', () => {
  let database: DatabaseSync;
  let store: EvidenceStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeEvidenceInvestigation: false });
    store = new EvidenceStore(database);
  });

  afterEach(() => database.close());

  it('projects an empty, permission-aware workspace without leaking matters', () => {
    expect(store.getWorkspace(ava, SEED_IDS.northstarMatter)).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canWrite: true },
      defects: [],
      notices: [],
      accessEvents: [],
      evidenceItems: [],
      readiness: {
        controls: expect.arrayContaining([
          expect.objectContaining({
            key: 'defect_schedule_recorded',
            eligible: false,
          }),
          expect.objectContaining({
            key: 'notice_evidence_recorded',
            eligible: false,
          }),
          expect.objectContaining({
            key: 'photographs_recorded',
            eligible: false,
          }),
        ]),
      },
    });
    expect(
      store.getWorkspace(ava, SEED_IDS.northstarRestrictedMatter),
    ).toBeUndefined();
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(
      store.getWorkspace(partner, SEED_IDS.northstarRestrictedMatter)
        ?.permissions,
    ).toEqual({ canWrite: true });
    expect(store.getWorkspace(finance, SEED_IDS.northstarMatter)?.permissions).toEqual(
      { canWrite: false },
    );
  });

  it('creates and version-updates a defect with full overlapping risks', () => {
    const defect = store.createDefect(
      ava,
      SEED_IDS.northstarMatter,
      defectInput,
      context,
    );
    expect(defect).toMatchObject({
      version: 1,
      status: 'open',
      severity: 'serious',
      hazardTags: ['damp', 'respiratory concern'],
      statusEvents: [
        expect.objectContaining({ fromStatus: null, toStatus: 'open' }),
      ],
    });

    const update: UpdateDefectInput = {
      ...defectInput,
      expectedVersion: 1,
      status: 'monitoring',
      statusReason: 'Inspection is booked and the condition remains unresolved.',
    };
    expect(
      store.updateDefect(
        ava,
        SEED_IDS.northstarMatter,
        defect.id,
        update,
        { ...context, occurredAt: '2026-07-15T10:00:00.000Z' },
      ),
    ).toMatchObject({ version: 2, status: 'monitoring' });
    expect(() =>
      store.updateDefect(
        ava,
        SEED_IDS.northstarMatter,
        defect.id,
        update,
        { ...context, occurredAt: '2026-07-15T11:00:00.000Z' },
      ),
    ).toThrow(EvidenceStateConflictError);

    const workspace = store.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace?.risks.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'serious_open_defect',
        'defect_without_evidence',
        'notice_evidence_missing',
        'photographs_missing',
      ]),
    );
    expect(workspace?.readiness.controls).toContainEqual(
      expect.objectContaining({
        key: 'defect_schedule_recorded',
        eligible: true,
      }),
    );
  });

  it('records append-only notice and access events with safe idempotent replay', () => {
    const notice = store.createNotice(
      ava,
      SEED_IDS.northstarMatter,
      noticeInput(),
      context,
    );
    const replayedNotice = store.createNotice(
      ava,
      SEED_IDS.northstarMatter,
      noticeInput(),
      { ...context, requestId: 'request-replay' },
    );
    expect(replayedNotice.id).toBe(notice.id);
    expect(() =>
      store.createNotice(
        ava,
        SEED_IDS.northstarMatter,
        { ...noticeInput(), summary: 'A different complaint payload.' },
        context,
      ),
    ).toThrow(EvidenceIdempotencyConflictError);

    const access = store.createAccessEvent(
      ava,
      SEED_IDS.northstarMatter,
      accessInput(),
      context,
    );
    expect(access).toMatchObject({ eventType: 'no_access' });

    const workspace = store.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace?.readiness.controls).toContainEqual(
      expect.objectContaining({
        key: 'notice_evidence_recorded',
        eligible: true,
      }),
    );
    expect(workspace?.risks.map(({ type }) => type)).toContain('failed_access');
  });

  it('links one immutable document version atomically and rolls back cross-matter targets', () => {
    const documentVersionId = insertDocumentVersion(database);
    const otherMatterVersionId = insertDocumentVersion(
      database,
      SEED_IDS.northstarRestrictedMatter,
      '2',
    );
    const defect = store.createDefect(
      ava,
      SEED_IDS.northstarMatter,
      defectInput,
      context,
    );
    const notice = store.createNotice(
      ava,
      SEED_IDS.northstarMatter,
      noticeInput(),
      context,
    );
    const access = store.createAccessEvent(
      ava,
      SEED_IDS.northstarMatter,
      accessInput(),
      context,
    );
    const input: CreateEvidenceItemInput = {
      idempotencyKey: 'evidence-command-001',
      kind: 'photograph',
      title: 'Bedroom mould photograph',
      description: 'Synthetic evaluation evidence supplied by the client.',
      occurredOn: '2026-01-09',
      provenanceSource: 'client',
      provenanceDetail: 'Received as an email attachment and preserved intact.',
      documentVersionId,
      defectIds: [defect.id],
      noticeIds: [notice.id],
      accessEventIds: [access.id],
    };
    const evidence = store.createEvidenceItem(
      ava,
      SEED_IDS.northstarMatter,
      input,
      context,
    );

    expect(evidence).toMatchObject({
      documentVersion: {
        id: documentVersionId,
        version: 1,
        originalName: 'synthetic-bedroom.jpg',
      },
      defectIds: [defect.id],
      noticeIds: [notice.id],
      accessEventIds: [access.id],
    });
    expect(
      store
        .getWorkspace(ava, SEED_IDS.northstarMatter)
        ?.readiness.controls.find(({ key }) => key === 'photographs_recorded'),
    ).toMatchObject({ eligible: true });

    expect(() =>
      store.createEvidenceItem(
        ava,
        SEED_IDS.northstarMatter,
        {
          ...input,
          idempotencyKey: 'evidence-command-002',
          documentVersionId: otherMatterVersionId,
        },
        context,
      ),
    ).toThrow();
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM evidence_items
           WHERE idempotency_key = 'evidence-command-002'`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
