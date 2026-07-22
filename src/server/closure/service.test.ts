import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ClosureService, ClosureServiceError } from './service.js';
import { ClosureStore } from './store.js';
import type { PrepareClosureInput } from './types.js';

const NOW = new Date('2026-07-22T10:00:00.000Z');
const MATTER = '30000000-0000-4000-8000-000000000090';
const REPORT_VERSION = '75000000-0000-4000-8000-000000000090';
const AUDIT = { requestId: 'closure-test', ipAddress: '127.0.0.1' };

const solicitor: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};
const partner: SessionUser = {
  id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner',
};
const admin: SessionUser = {
  id: '20000000-0000-4000-8000-000000000090', firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'admin@northstar.test', name: 'Ruth Cole', role: 'admin',
};

function prepareInput(key = 'closure-prepare-0001'): PrepareClosureInput {
  return {
    outcome: 'Repairs completed and damages paid.',
    closureReason: 'The client objectives and settlement obligations are complete.',
    lessons: 'Confirm document-return preference during final reporting.',
    finalClientReportStatus: 'sent' as const,
    finalClientReportDocumentVersionId: REPORT_VERSION,
    documentsPosition: 'retained' as const,
    documentsNote: 'The client authorised secure retention of the complete electronic file.',
    retentionBasis: 'Firm policy: retain the closed housing file for six years.',
    retentionUntil: '2032-07-22',
    undertakingsConfirmedClear: true,
    complaintsConfirmedClear: true,
    attestationNote: 'The solicitor reviewed the file and confirmed no unrecorded undertaking or complaint remains.',
    transfers: [],
    explicitHumanAuthority: true as const,
    idempotencyKey: key,
  };
}

describe('ClosureService', () => {
  let database: DatabaseSync;
  let service: ClosureService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    database.prepare(`INSERT INTO users (id,firm_id,email,name,password_hash,role,active,created_at)
      SELECT ?,firm_id,?,? ,password_hash,'admin',1,? FROM users WHERE id=?`)
      .run(admin.id, admin.email, admin.name, NOW.toISOString(), SEED_IDS.partner);
    database.prepare(`INSERT INTO matters (id,firm_id,reference,title,client_name,matter_type,status,stage,risk_level,
      owner_user_id,opened_at,description,created_by,created_at,updated_at)
      VALUES (?,?,'CLOSE-001','Closure test','Test Client','Housing conditions claim','open','Settlement','low',?,
      '2026-01-10','Ready-to-close fixture.',?,'2026-01-10T09:00:00.000Z','2026-01-10T09:00:00.000Z')`)
      .run(MATTER, SEED_IDS.northstarFirm, SEED_IDS.ava, SEED_IDS.ava);
    database.prepare(`INSERT INTO matter_members (firm_id,matter_id,user_id,access_level,added_at)
      VALUES (?,?,?,'write',?), (?,?,?,'write',?)`).run(
      SEED_IDS.northstarFirm, MATTER, SEED_IDS.ava, NOW.toISOString(),
      SEED_IDS.northstarFirm, MATTER, SEED_IDS.partner, NOW.toISOString(),
    );
    const document = '74000000-0000-4000-8000-000000000090';
    database.prepare(`INSERT INTO documents (id,firm_id,matter_id,title,category,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(document, SEED_IDS.northstarFirm, MATTER, 'Final client report', 'closure', SEED_IDS.ava, NOW.toISOString());
    database.prepare(`INSERT INTO document_versions (id,firm_id,document_id,version,storage_key,original_name,mime_type,
      size_bytes,sha256,uploaded_by,created_at) VALUES (?,?,?,1,'closure/report.pdf','report.pdf','application/pdf',12,?, ?,?)`)
      .run(REPORT_VERSION, SEED_IDS.northstarFirm, document, 'a'.repeat(64), SEED_IDS.ava, NOW.toISOString());
    service = new ClosureService(new ClosureStore(database, () => NOW));
  });

  afterEach(() => database.close());

  it('derives blockers from authoritative open tasks and rejects preparation', () => {
    database.prepare(`INSERT INTO tasks (id,firm_id,matter_id,title,notes,due_at,priority,status,assignee_user_id,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,'2026-08-01T12:00:00.000Z','normal','open',?,?,?,?)`).run(
      crypto.randomUUID(), SEED_IDS.northstarFirm, MATTER, 'Return original papers', '', SEED_IDS.ava, SEED_IDS.ava, NOW.toISOString(), NOW.toISOString(),
    );
    expect(() => service.prepare(solicitor, MATTER, prepareInput(), AUDIT)).toThrowError(
      expect.objectContaining<Partial<ClosureServiceError>>({ code: 'NOT_READY' }),
    );
  });

  it('requires independent approval and rechecks stale financial/legal facts before close', () => {
    const prepared = service.prepare(partner, MATTER, prepareInput(), AUDIT);
    expect(() => service.approve(partner, MATTER, prepared.review!.id, {
      note: 'I approve my own preparation.', explicitHumanAuthority: true, idempotencyKey: 'closure-approve-0001',
    }, AUDIT)).toThrowError(expect.objectContaining<Partial<ClosureServiceError>>({ code: 'INDEPENDENCE_REQUIRED' }));

    const approved = service.approve(admin, MATTER, prepared.review!.id, {
      note: 'Independently reviewed against the retained file and closure evidence.',
      explicitHumanAuthority: true, idempotencyKey: 'closure-approve-0002',
    }, AUDIT);
    expect(approved.status).toBe('approved');

    database.prepare(`INSERT INTO tasks (id,firm_id,matter_id,title,notes,due_at,priority,status,assignee_user_id,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,'2026-08-01T12:00:00.000Z','urgent','open',?,?,?,?)`).run(
      crypto.randomUUID(), SEED_IDS.northstarFirm, MATTER, 'Urgent court filing', '', SEED_IDS.ava, SEED_IDS.ava, NOW.toISOString(), NOW.toISOString(),
    );
    expect(() => service.close(admin, MATTER, prepared.review!.id, {
      note: 'Close matter.', explicitHumanAuthority: true, idempotencyKey: 'closure-close-0001',
    }, AUDIT)).toThrowError(expect.objectContaining<Partial<ClosureServiceError>>({ code: 'STALE_REVIEW' }));
  });

  it('closes only the independently approved exact review and replays safely', () => {
    const prepared = service.prepare(solicitor, MATTER, prepareInput(), AUDIT);
    service.approve(partner, MATTER, prepared.review!.id, {
      note: 'Independently reviewed against the retained closure evidence.',
      explicitHumanAuthority: true, idempotencyKey: 'closure-approve-0003',
    }, AUDIT);
    const command = { note: 'Closure authorised after final recheck.', explicitHumanAuthority: true as const, idempotencyKey: 'closure-close-0002' };
    const closed = service.close(partner, MATTER, prepared.review!.id, command, AUDIT);
    const replay = service.close(partner, MATTER, prepared.review!.id, command, AUDIT);
    expect(closed.status).toBe('closed');
    expect(replay.events).toEqual(closed.events);
    expect(database.prepare('SELECT status FROM matters WHERE id=?').get(MATTER)).toEqual({ status: 'closed' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM matter_closure_events WHERE matter_id=? AND event_type=\'closed\'').get(MATTER)).toEqual({ count: 1 });
  });

  it('reopens with a reason and new responsible owner without rewriting closure history', () => {
    const prepared = service.prepare(solicitor, MATTER, prepareInput('closure-prepare-reopen'), AUDIT);
    service.approve(partner, MATTER, prepared.review!.id, {
      note: 'Independent closure approval recorded.', explicitHumanAuthority: true, idempotencyKey: 'closure-approve-reopen',
    }, AUDIT);
    service.close(partner, MATTER, prepared.review!.id, {
      note: 'Matter closed after checks.', explicitHumanAuthority: true, idempotencyKey: 'closure-close-reopen',
    }, AUDIT);
    const reopened = service.reopen(partner, MATTER, {
      reason: 'The landlord has failed to perform a newly discovered settlement term.',
      newOwnerUserId: SEED_IDS.ava,
      explicitHumanAuthority: true,
      idempotencyKey: 'closure-reopen-0001',
    }, AUDIT);
    expect(reopened.status).toBe('active');
    expect(database.prepare('SELECT status,owner_user_id AS owner FROM matters WHERE id=?').get(MATTER))
      .toEqual({ status: 'open', owner: SEED_IDS.ava });
    expect(database.prepare(`SELECT event_type AS type FROM matter_closure_events WHERE matter_id=? ORDER BY sequence`).all(MATTER))
      .toEqual([{ type: 'prepared' }, { type: 'approved' }, { type: 'closed' }, { type: 'reopened' }]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM matter_active_periods WHERE matter_id=?').get(MATTER)).toEqual({ count: 1 });
  });
});
