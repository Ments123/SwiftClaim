import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createDatabase, seedDatabase, SEED_IDS } from './database.js';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? String(header[0]) : String(header);
  return value.split(';')[0] ?? '';
}

async function login(
  app: FastifyInstance,
  email = 'ava@northstar.test',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'SwiftClaim!2026' },
  });

  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

function multipartDocument(
  fields: Record<string, string>,
  file: { name: string; type: string; content: Buffer },
) {
  const boundary = `----SwiftClaimTest${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  const payload = Buffer.concat(chunks);
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
  };
}

describe('SwiftClaim API', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-api-'));
    const staticPath = join(testDirectory, 'public');
    mkdirSync(staticPath);
    writeFileSync(join(staticPath, 'index.html'), '<!doctype html><title>SwiftClaim</title>');
    database = createDatabase(join(testDirectory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database,
      storagePath: join(testDirectory, 'storage'),
      staticPath,
      logger: false,
      isProduction: false,
      now: () => new Date('2026-07-13T12:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('exposes a minimal health response', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves the client shell for application routes but keeps API 404s JSON', async () => {
    const applicationRoute = await app.inject({
      method: 'GET',
      url: '/matters/example-id',
    });
    expect(applicationRoute.statusCode).toBe(200);
    expect(applicationRoute.headers['content-type']).toContain('text/html');
    expect(applicationRoute.body).toContain('<title>SwiftClaim</title>');

    const missingApi = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  it('creates a revocable HTTP-only session for valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ava@northstar.test', password: 'SwiftClaim!2026' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.json()).toMatchObject({
      user: {
        email: 'ava@northstar.test',
        name: 'Ava Morgan',
        role: 'solicitor',
        firm: { id: SEED_IDS.northstarFirm, name: 'Northstar Legal' },
      },
    });

    const cookie = sessionCookie(response);
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('ava@northstar.test');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('returns the same generic error for unknown users and wrong passwords', async () => {
    const attempts = [
      { email: 'missing@northstar.test', password: 'SwiftClaim!2026' },
      { email: 'ava@northstar.test', password: 'wrong-password' },
    ];

    for (const payload of attempts) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect.',
        },
      });
    }
  });

  it('limits a solicitor to assigned matters and hides all other resources', async () => {
    const cookie = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/api/matters',
      headers: { cookie },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().matters.map((matter: { id: string }) => matter.id)).toEqual([
      SEED_IDS.northstarMatter,
    ]);

    for (const inaccessibleMatter of [
      SEED_IDS.northstarRestrictedMatter,
      SEED_IDS.southbankMatter,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/matters/${inaccessibleMatter}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
  });

  it('lets a partner create a matter with membership, timeline, and audit atomically', async () => {
    const cookie = await login(app, 'partner@northstar.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/matters',
      headers: { cookie },
      payload: {
        reference: 'NCL-2026-0042',
        title: 'Ahmed v Orion Logistics',
        clientName: 'Samira Ahmed',
        matterType: 'Commercial dispute',
        stage: 'Pre-action',
        riskLevel: 'medium',
        ownerUserId: SEED_IDS.ava,
        openedAt: '2026-07-13',
        description: 'Contract and consequential loss dispute.',
        externalSource: 'proclaim',
        externalId: '0042-AHMED',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      matter: {
        reference: 'NCL-2026-0042',
        owner: { id: SEED_IDS.ava, name: 'Ava Morgan' },
      },
    });
    expect(response.json().timeline[0].type).toBe('matter.created');
    expect(response.json().audit[0].action).toBe('matter.created');

    const persisted = database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM matters WHERE reference = ?) AS matters,
          (SELECT COUNT(*) FROM matter_members mm JOIN matters m ON m.id = mm.matter_id
            WHERE m.reference = ? AND mm.user_id = ?) AS members,
          (SELECT COUNT(*) FROM timeline_events te JOIN matters m ON m.id = te.matter_id
            WHERE m.reference = ? AND te.type = 'matter.created') AS timeline,
          (SELECT COUNT(*) FROM audit_events ae JOIN matters m ON m.id = ae.matter_id
            WHERE m.reference = ? AND ae.action = 'matter.created') AS audit`,
      )
      .get(
        'NCL-2026-0042',
        'NCL-2026-0042',
        SEED_IDS.ava,
        'NCL-2026-0042',
        'NCL-2026-0042',
      );
    expect(persisted).toEqual({ matters: 1, members: 1, timeline: 1, audit: 1 });
  });

  it('forbids a paralegal from creating a matter', async () => {
    const cookie = await login(app, 'ben@northstar.test');
    const response = await app.inject({
      method: 'POST',
      url: '/api/matters',
      headers: { cookie },
      payload: {
        reference: 'NCL-2026-0099',
        title: 'Unauthorised matter',
        clientName: 'No Client',
        matterType: 'Commercial dispute',
        stage: 'Pre-action',
        riskLevel: 'low',
        ownerUserId: SEED_IDS.ben,
        openedAt: '2026-07-13',
        description: '',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('calculates dashboard work from accessible matters only', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        activeMatters: 1,
        overdueTasks: 1,
        dueThisWeek: 2,
        highRiskMatters: 1,
      },
    });
    expect(response.json().urgentTasks).toHaveLength(3);
  });

  it('adds a party to an authorised matter and records the action', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/parties`,
      headers: { cookie },
      payload: {
        kind: 'expert',
        name: 'Dr Maya Chen',
        organisation: 'Northern Orthopaedics',
        email: 'maya.chen@example.test',
        phone: '+44 113 496 0102',
        address: 'Leeds',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      party: { kind: 'expert', name: 'Dr Maya Chen' },
      timelineEvent: { type: 'party.created' },
      auditEvent: { action: 'party.created' },
    });

    const aggregate = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}`,
      headers: { cookie },
    });
    expect(
      aggregate.json().parties.some((party: { name: string }) => party.name === 'Dr Maya Chen'),
    ).toBe(true);
  });

  it('creates and completes a deadline with an evidential history', async () => {
    const cookie = await login(app);
    const created = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/tasks`,
      headers: { cookie },
      payload: {
        title: 'File costs budget',
        notes: 'Obtain partner approval before filing.',
        dueAt: '2026-07-20T15:00:00.000Z',
        priority: 'high',
        assigneeUserId: SEED_IDS.ben,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      task: {
        title: 'File costs budget',
        status: 'open',
        assignee: { id: SEED_IDS.ben, name: 'Ben Foster' },
      },
      timelineEvent: { type: 'task.created' },
      auditEvent: { action: 'task.created' },
    });

    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/matters/${SEED_IDS.northstarMatter}/tasks/${created.json().task.id}`,
      headers: { cookie },
      payload: { status: 'completed' },
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      task: {
        status: 'completed',
        completedAt: '2026-07-13T12:00:00.000Z',
      },
      timelineEvent: { type: 'task.completed' },
      auditEvent: { action: 'task.updated' },
    });
  });

  it('rejects an assignee from another firm without disclosing them', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/tasks`,
      headers: { cookie },
      payload: {
        title: 'Invalid assignment',
        notes: '',
        dueAt: '2026-07-20T15:00:00.000Z',
        priority: 'normal',
        assigneeUserId: SEED_IDS.southbankUser,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'ASSIGNEE_NOT_FOUND',
        message: 'The selected firm user is not available.',
      },
    });
  });

  it('prevents a read-only firm role from mutating a visible matter', async () => {
    const cookie = await login(app, 'finance@northstar.test');
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/parties`,
      headers: { cookie },
      payload: { kind: 'witness', name: 'Read-only attempt' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('stores, hashes, and serves an authorised immutable document version', async () => {
    const cookie = await login(app);
    const fileContent = Buffer.from('signed evidence');
    const multipart = multipartDocument(
      { title: 'Signed witness statement', category: 'Witness evidence' },
      { name: 'statement.txt', type: 'text/plain', content: fileContent },
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/documents`,
      headers: { cookie, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      document: {
        title: 'Signed witness statement',
        category: 'Witness evidence',
        latestVersion: {
          version: 1,
          originalName: 'statement.txt',
          mimeType: 'text/plain',
          sizeBytes: fileContent.length,
          sha256: createHash('sha256').update(fileContent).digest('hex'),
        },
      },
      timelineEvent: { type: 'document.uploaded' },
      auditEvent: { action: 'document.uploaded' },
    });

    const download = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/documents/${response.json().document.id}/download`,
      headers: { cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(fileContent);
    expect(download.headers['content-disposition']).toContain('statement.txt');

    const exactVersionDownload = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/document-versions/${response.json().document.latestVersion.id}/download`,
      headers: { cookie },
    });
    expect(exactVersionDownload.statusCode).toBe(200);
    expect(exactVersionDownload.rawPayload).toEqual(fileContent);
    expect(exactVersionDownload.headers['content-disposition']).toContain('statement.txt');
  });

  it('limits finance users to a safe matter shell and finance-linked exact evidence', async () => {
    const avaCookie = await login(app);
    const financeCookie = await login(app, 'finance@northstar.test');
    const partnerCookie = await login(app, 'partner@northstar.test');
    const fileContent = Buffer.from('reviewed client estimate');
    const multipart = multipartDocument(
      { title: 'Reviewed client estimate', category: 'Costs' },
      { name: 'client-estimate.txt', type: 'text/plain', content: fileContent },
    );
    const upload = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/documents`,
      headers: { cookie: avaCookie, ...multipart.headers },
      payload: multipart.payload,
    });
    expect(upload.statusCode).toBe(201);
    const documentId = String(upload.json().document.id);
    const versionId = String(upload.json().document.latestVersion.id);

    const aggregate = await app.inject({
      method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}`,
      headers: { cookie: financeCookie },
    });
    expect(aggregate.statusCode).toBe(200);
    expect(aggregate.json()).toMatchObject({
      matter: { description: '', externalSource: null, externalId: null, importBatchId: null },
      parties: [], tasks: [], documents: [], timeline: [], audit: [],
      permissions: { canWrite: false, canCreateMatter: false }, team: [],
    });

    const summary = await app.inject({
      method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}/summary`,
      headers: { cookie: financeCookie },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ deadlines: [], nextActions: [], alerts: [] });
    expect(summary.json().workflow).toMatchObject({ completedChecklistKeys: [], blockers: [] });

    for (const url of [
      `/api/matters/${SEED_IDS.northstarMatter}/documents/${documentId}/download`,
      `/api/matters/${SEED_IDS.northstarMatter}/document-versions/${versionId}/download`,
    ]) {
      const hidden = await app.inject({ method: 'GET', url, headers: { cookie: financeCookie } });
      expect(hidden.statusCode).toBe(404);
      expect(hidden.json().error.code).toBe('NOT_FOUND');
    }

    const estimate = await app.inject({
      method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/finance/estimates`,
      headers: { cookie: partnerCookie },
      payload: {
        idempotencyKey: 'finance-linked-evidence-estimate', effectiveOn: '2026-07-13',
        scope: 'Reviewed litigation costs through the next procedural phase.',
        feesMinor: 100_000, disbursementsMinor: 20_000, vatMinor: 20_000,
        overallLimitMinor: 140_000, currency: 'GBP', reviewOn: '2026-08-13',
        sourceDocumentVersionId: versionId,
        approvalNote: 'The client estimate and exact retained source were reviewed.',
        explicitApproval: true,
      },
    });
    expect(estimate.statusCode).toBe(201);

    const exactEvidence = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/document-versions/${versionId}/download`,
      headers: { cookie: financeCookie },
    });
    expect(exactEvidence.statusCode).toBe(200);
    expect(exactEvidence.rawPayload).toEqual(fileContent);
  });

  it('does not reveal an uploaded document across firms', async () => {
    const northstarCookie = await login(app);
    const multipart = multipartDocument(
      { title: 'Confidential advice', category: 'Advice' },
      { name: 'advice.txt', type: 'text/plain', content: Buffer.from('privileged') },
    );
    const upload = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/documents`,
      headers: { cookie: northstarCookie, ...multipart.headers },
      payload: multipart.payload,
    });
    expect(upload.statusCode).toBe(201);

    const southbankCookie = await login(app, 'lewis@southbank.test');
    const response = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/documents/${upload.json().document.id}/download`,
      headers: { cookie: southbankCookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');

    const exactVersionResponse = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/document-versions/${upload.json().document.latestVersion.id}/download`,
      headers: { cookie: southbankCookie },
    });
    expect(exactVersionResponse.statusCode).toBe(404);
    expect(exactVersionResponse.json().error.code).toBe('NOT_FOUND');
  });
});
