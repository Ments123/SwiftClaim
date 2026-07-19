import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  seedFinanceEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { FinanceStore } from './store.js';

const partner: SessionUser = {
  id: SEED_IDS.partner,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'partner@northstar.test',
  name: 'Marcus Reed',
  role: 'partner',
};

const southbank: SessionUser = {
  id: SEED_IDS.southbankUser,
  firmId: SEED_IDS.southbankFirm,
  firmName: 'Southbank Law',
  email: 'lewis@southbank.test',
  name: 'Lewis Grant',
  role: 'partner',
};

function financeCounts(database: DatabaseSync) {
  return Object.fromEntries([
    'finance_rate_cards',
    'finance_rate_versions',
    'finance_activity_suggestions',
    'finance_timer_sessions',
    'finance_time_entries',
    'finance_time_approvals',
    'finance_estimate_versions',
    'finance_estimate_warnings',
    'finance_disbursements',
    'finance_journals',
    'finance_journal_lines',
  ].map((table) => [
    table,
    Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
  ]));
}

describe('governed finance evaluation seed', () => {
  let database: DatabaseSync;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedCommunicationsEvaluation(database);
  });

  afterEach(() => database.close());

  it('seeds the complete Northstar finance journey idempotently', () => {
    seedFinanceEvaluation(database);
    const firstCounts = financeCounts(database);
    seedFinanceEvaluation(database);

    expect(financeCounts(database)).toEqual(firstCounts);

    const store = new FinanceStore(database, () => new Date('2026-10-02T12:00:00.000Z'));
    const workspace = store.getWorkspace(partner, SEED_IDS.northstarMatter)!;
    const rateCards = store.listRateCards(partner)!;

    expect(rateCards).toHaveLength(1);
    expect(rateCards[0]).toMatchObject({
      name: 'Northstar standard litigation rates',
      versions: [{
        status: 'active',
        entries: expect.arrayContaining([
          expect.objectContaining({ grade: 'solicitor', hourlyRateMinor: 24_000 }),
          expect.objectContaining({ grade: 'paralegal', hourlyRateMinor: 12_000 }),
        ]),
      }],
    });
    expect(workspace.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: 'communication_call',
        status: 'pending',
        label: 'AI suggestion — human review required',
      }),
      expect.objectContaining({ sourceKind: 'document_version', status: 'accept' }),
      expect.objectContaining({ sourceKind: 'task', status: 'reject' }),
    ]));
    expect(workspace.timers).toContainEqual(expect.objectContaining({
      status: 'stopped',
      elapsedMinutes: 8,
    }));
    expect(workspace.timeEntries).toContainEqual(expect.objectContaining({
      status: 'approved',
      minutes: 120,
      hourlyRateMinor: 24_000,
      chargeMinor: 48_000,
    }));
    expect(workspace.snapshot).toMatchObject({
      provisionalTime: { minutes: 14, currency: 'GBP' },
      approvedWip: { minutes: 120, amountMinor: 48_000, currency: 'GBP' },
      disbursements: {
        proposedMinor: 120_000,
        approvedExposureMinor: 45_500,
      },
      estimate: {
        overallLimitMinor: 110_000,
        currentExposureMinor: 93_500,
        varianceMinor: 16_500,
      },
      clientBalance: { state: 'not_connected' },
      officeBalance: { state: 'not_connected' },
      billed: { state: 'not_connected' },
      paid: { state: 'not_connected' },
    });
    expect(workspace.warnings).toContainEqual(expect.objectContaining({
      thresholdPercent: 80,
      state: 'open',
      exposureMinor: 93_500,
    }));
    expect(workspace.warnings).not.toContainEqual(expect.objectContaining({ thresholdPercent: 100 }));
    expect(workspace.disbursements).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: 'Independent Expert Ltd', status: 'proposed' }),
      expect.objectContaining({ supplier: 'HM Courts & Tribunals Service', status: 'incurred', paidExternally: false }),
    ]));
    expect(workspace.sources.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: SEED_IDS.complaintVersion, documentId: SEED_IDS.complaintDocument }),
      expect.objectContaining({ id: SEED_IDS.repairVersion, documentId: SEED_IDS.repairDocument }),
    ]));
    expect(workspace.ledger.journals).toContainEqual(expect.objectContaining({
      sourceKind: 'wip_control',
      status: 'posted',
      totalDebitMinor: 48_000,
      totalCreditMinor: 48_000,
      lines: expect.arrayContaining([
        expect.objectContaining({ designation: 'neutral' }),
      ]),
    }));
  });

  it('does not create finance facts for the isolated Southbank tenant', () => {
    seedFinanceEvaluation(database);

    const workspace = new FinanceStore(database, () => new Date('2026-10-02T12:00:00.000Z'))
      .getWorkspace(southbank, SEED_IDS.southbankMatter)!;

    expect(workspace.suggestions).toEqual([]);
    expect(workspace.timeEntries).toEqual([]);
    expect(workspace.disbursements).toEqual([]);
    expect(workspace.ledger.journals).toEqual([]);
  });
});
