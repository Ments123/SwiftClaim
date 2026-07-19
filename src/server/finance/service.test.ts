import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { FinanceService } from './service.js';
import { FinanceStore } from './store.js';

const now = () => new Date('2026-07-19T12:00:00.000Z');

describe('FinanceService capability boundary', () => {
  let database: DatabaseSync;
  let service: FinanceService;
  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    service = new FinanceService(new FinanceStore(database, now));
  });
  afterEach(() => database.close());

  it('returns generic absence for a user without finance workspace access', () => {
    const readonly: SessionUser = {
      id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
      email: 'readonly@northstar.test', name: 'Read Only', role: 'readonly',
    };
    expect(service.getWorkspace(readonly, SEED_IDS.northstarMatter)).toBeUndefined();
  });

  it('does not let a finance user record fee-earner time', () => {
    const finance: SessionUser = {
      id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
      email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance',
    };
    expect(() => service.submitTime(finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'finance-cannot-record-time', workDate: '2026-07-19', minutes: 10,
      narrative: 'Finance must not create fee-earner attendance on a legal matter.',
      activityCode: 'case_progression', costsPhase: 'case_management', chargeable: true,
      sourceKind: 'manual', sourceId: null,
    }, { requestId: 'finance-service-test', ipAddress: '127.0.0.1' }))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
