import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedBillingCashroomEvaluation, seedCommunicationsEvaluation, seedDatabase, seedFinanceEvaluation, SEED_IDS } from '../database.js';

function cookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  return String(Array.isArray(value) ? value[0] : value).split(';')[0] ?? '';
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return cookie(response);
}

describe('billing and cashroom routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;
  let solicitor: string;
  let finance: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-billing-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database,
      storagePath: join(directory, 'storage'),
      logger: false,
      now: () => new Date('2026-10-05T12:00:00.000Z'),
    });
    solicitor = await login(app, 'ava@northstar.test');
    finance = await login(app, 'finance@northstar.test');
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('requires authentication before exposing billing records', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/finance/billing/matters/${SEED_IDS.northstarMatter}/bills/${crypto.randomUUID()}`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('returns the governed matter billing workspace without requiring record IDs', async () => {
    await seedCommunicationsEvaluation(database);
    seedFinanceEvaluation(database);
    seedBillingCashroomEvaluation(database);
    const response = await app.inject({
      method: 'GET',
      url: `/api/finance/billing/matters/${SEED_IDS.northstarMatter}/workspace`,
      headers: { cookie: finance },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspace).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      bills: [expect.objectContaining({ billReference: 'SC-2026-000001' })],
    });
    expect(response.json().workspace.payments[0]).not.toHaveProperty('bankAccountId');
    expect(response.json().workspace.payments[0]).not.toHaveProperty('beneficiaryName');
    expect(response.json().workspace.payments[0]).not.toHaveProperty('beneficiaryFingerprint');

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/finance/billing/matters/${SEED_IDS.southbankMatter}/workspace`,
      headers: { cookie: finance },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('applies strict billing command schemas before store access', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/finance/billing/matters/${SEED_IDS.northstarMatter}/bills`,
      headers: { cookie: solicitor },
      payload: {
        idempotencyKey: 'billing-api-autonomous-attempt',
        clientPartyId: SEED_IDS.northstarClient,
        dueOn: '2026-11-04',
        sourceEntries: [],
        adjustments: [],
        aiApproved: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'BILLING_CASHROOM_INVALID' } });
  });

  it('returns the same generic 404 for absent and cross-tenant records', async () => {
    const absent = await app.inject({
      method: 'GET',
      url: `/api/finance/billing/matters/${SEED_IDS.northstarMatter}/bills/${crypto.randomUUID()}`,
      headers: { cookie: finance },
    });
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/api/finance/billing/matters/${SEED_IDS.southbankMatter}/bills/${crypto.randomUUID()}`,
      headers: { cookie: finance },
    });
    expect(absent.statusCode).toBe(404);
    expect(crossTenant.statusCode).toBe(404);
    expect(crossTenant.json()).toEqual(absent.json());
  });

  it('capability-gates deterministic account exports', async () => {
    const denied = await app.inject({
      method: 'GET', url: '/api/finance/cashroom/exports/bills', headers: { cookie: solicitor },
    });
    const allowed = await app.inject({
      method: 'GET', url: '/api/finance/cashroom/exports/bills', headers: { cookie: finance },
    });
    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['content-type']).toContain('text/csv');
    expect(allowed.body).toBe('bill_reference,matter_id,client_party_id,due_on,net_minor,vat_minor,gross_minor,currency,status\n');
  });

  it('retains multipart statement evidence behind an exact finance-only grant', async () => {
    const boundary = 'swiftclaim-statement-boundary';
    const body = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="idempotencyKey"\r\n\r\nstatement-evidence-upload-001\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="matterId"\r\n\r\n${SEED_IDS.northstarMatter}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nOctober client account statement\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="statement.csv"\r\nContent-Type: text/csv\r\n\r\ndate,amount\n2026-10-01,100.00\n\r\n`,
      `--${boundary}--\r\n`,
    ].join(''));
    const retained = await app.inject({
      method: 'POST', url: '/api/finance/cashroom/statements/evidence', headers: {
        cookie: finance, 'content-type': `multipart/form-data; boundary=${boundary}`,
      }, payload: body,
    });
    expect(retained.statusCode).toBe(201);
    const versionId = retained.json().evidence.documentVersionId as string;
    const ledgerAccountId = crypto.randomUUID();
    database.prepare(`INSERT INTO finance_accounts (
      id,firm_id,code,name,account_class,designation,currency,active,created_by,created_at
    ) VALUES (?,?,'CLIENT-BANK-TEST','Client bank test','client_asset','client','GBP',1,?,?)`).run(
      ledgerAccountId, SEED_IDS.northstarFirm, SEED_IDS.finance, '2026-10-05T12:00:00.000Z',
    );
    const bankAccountId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    database.prepare(`INSERT INTO finance_bank_accounts (
      id,firm_id,name,designation,ledger_account_id,provider,account_identifier_masked,currency,active,created_by,created_at
    ) VALUES (?,?,?,'client',?,'manual','****5678','GBP',1,?,?)`).run(
      bankAccountId, SEED_IDS.northstarFirm, 'Client account', ledgerAccountId, SEED_IDS.finance, '2026-10-05T12:00:00.000Z',
    );
    database.prepare(`INSERT INTO finance_bank_statement_batches (
      id,firm_id,bank_account_id,source,statement_from,statement_to,opening_balance_minor,closing_balance_minor,
      currency,evidence_document_version_id,raw_checksum,imported_by,imported_at
    ) VALUES (?,?,?,'csv','2026-10-01','2026-10-01',0,10000,'GBP',?,?,?,?)`).run(
      batchId, SEED_IDS.northstarFirm, bankAccountId, versionId, 'a'.repeat(64), SEED_IDS.finance,
      '2026-10-05T12:00:00.000Z',
    );

    const general = await app.inject({
      method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}/document-versions/${versionId}/download`,
      headers: { cookie: finance },
    });
    const granted = await app.inject({
      method: 'GET', url: `/api/finance/documents/statement/${batchId}/versions/${versionId}/download`,
      headers: { cookie: finance },
    });
    const wrongRecord = await app.inject({
      method: 'GET', url: `/api/finance/documents/statement/${crypto.randomUUID()}/versions/${versionId}/download`,
      headers: { cookie: finance },
    });

    expect(general.statusCode).toBe(404);
    expect(granted.statusCode).toBe(200);
    expect(granted.headers['content-disposition']).toContain('statement.csv');
    expect(granted.body).toContain('2026-10-01,100.00');
    expect(wrongRecord.statusCode).toBe(404);
    expect(wrongRecord.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Financial record not found.' } });
  });
});
