import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateProceedingAuthorityVersionInput,
  CreateProceedingInput,
  RecordProceedingEventInput,
} from '../../shared/contracts.js';
import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  seedNegotiationSettlementEvaluation,
  seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from './store.js';

const now = () => new Date('2026-09-01T10:00:00.000Z');
const audit = { requestId: 'proceedings-store-test', ipAddress: '127.0.0.1' };
const ava: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};
const lewis: SessionUser = {
  id: SEED_IDS.southbankUser, firmId: SEED_IDS.southbankFirm, firmName: 'Southbank Law',
  email: 'lewis@southbank.test', name: 'Lewis Grant', role: 'solicitor',
};
const ben: SessionUser = {
  id: SEED_IDS.ben, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ben@northstar.test', name: 'Ben Foster', role: 'paralegal',
};
const input: CreateProceedingInput = {
  idempotencyKey: 'create-proceeding-001',
  procedureType: 'part7', jurisdiction: 'england_wales',
  courtName: 'County Court at Central London', courtCode: null,
  hearingCentre: 'Central London',
};

describe('ProceedingsStore', () => {
  let database: DatabaseSync;
  let store: ProceedingsStore;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-proceedings-store-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database);
    await seedCommunicationsEvaluation(database);
    seedNegotiationSettlementEvaluation(database);
    store = new ProceedingsStore(database, now);
  });
  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates one replay-safe proceeding and its operational records atomically', () => {
    const first = store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    const replay = store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    expect(replay).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS count FROM court_proceedings').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM proceedings_command_receipts').get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'proceedings.created'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'proceedings.created'").get()).toEqual({ count: 1 });
  });

  it('rejects reuse of an idempotency key with different validated input', () => {
    store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    expect(() => store.createProceeding(ava, SEED_IDS.northstarMatter, {
      ...input, courtName: 'A different court',
    }, audit)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  });

  it('never returns another firm proceeding by UUID', () => {
    const created = store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    expect(store.getProceeding(lewis.firmId, SEED_IDS.northstarMatter, created.id)).toBeUndefined();
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
  });

  it('does not expose protected client instructions as command sources without permission', () => {
    store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    expect(store.getWorkspace(ava, SEED_IDS.northstarMatter)?.sources.clientInstructions.length)
      .toBeGreaterThan(0);
    expect(store.getWorkspace(ben, SEED_IDS.northstarMatter)?.sources.clientInstructions)
      .toEqual([]);
  });

  it('persists exact issue authority and a separately verified issued event', () => {
    const proceeding = store.createProceeding(ava, SEED_IDS.northstarMatter, input, audit);
    const clientInstructionId = String((database.prepare(
      `SELECT id FROM client_instructions WHERE firm_id = ? AND matter_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    const versions = database.prepare(
      `SELECT dv.id FROM document_versions dv JOIN documents d
       ON d.id = dv.document_id AND d.firm_id = dv.firm_id
       WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY dv.created_at LIMIT 2`,
    ).all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string }>;
    expect(versions).toHaveLength(2);
    const defendantPartyId = String((database.prepare(
      `SELECT id FROM parties WHERE firm_id = ? AND matter_id = ? AND kind = 'opponent' LIMIT 1`,
    ).get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    const authorityInput: CreateProceedingAuthorityVersionInput = {
      idempotencyKey: 'proceeding-authority-store-001',
      clientInstructionId,
      procedureType: 'part7',
      scope: 'Issue the synthetic housing conditions claim against the named landlord.',
      defendantPartyIds: [defendantPartyId],
      claimFormDocumentVersionId: versions[0]!.id,
      particularsDocumentVersionId: versions[1]!.id,
      preparedByUserId: SEED_IDS.ava,
      approvedByUserId: SEED_IDS.partner,
      limitationPosition: 'Limitation was reviewed against retained matter sources.',
      risks: 'Issue, service, evidence and costs risks were independently reviewed.',
      reviewNote: 'The exact synthetic claim form and particulars were approved.',
      expiresAt: null,
      reviewOn: '2026-09-30',
      explicitApproval: true,
    };
    const authority = store.createAuthorityVersion(
      ava, SEED_IDS.northstarMatter, proceeding.id, authorityInput, audit,
    );
    expect(authority.version).toBe(1);

    const issuedInput: RecordProceedingEventInput = {
      expectedVersion: 2,
      idempotencyKey: 'proceeding-issued-store-001',
      eventType: 'issued',
      occurredAt: '2026-09-10T10:00:00.000Z',
      note: 'Court issue was verified against the retained sealed claim form.',
      sourceDocumentVersionId: versions[0]!.id,
      courtName: 'County Court at Central London',
      caseNumber: 'K00CL123',
      track: null,
      supersedesEventId: null,
      correctionReason: '',
      explicitHumanConfirmation: true,
    };
    const issued = store.recordProceedingEvent(
      ava, SEED_IDS.northstarMatter, proceeding.id, issuedInput, audit,
    );
    expect(issued.currentState).toBe('issued');
    expect(issued.caseNumber).toBe('K00CL123');
    const workspace = store.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace?.authority).toMatchObject({ id: authority.id, version: 1 });
    expect(workspace?.events).toEqual([
      expect.objectContaining({ eventType: 'issued' }),
    ]);
  });
});
