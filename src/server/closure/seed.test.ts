import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, seedMatterClosureEvaluation, SEED_IDS } from '../database.js';

const tables = ['matter_closure_reviews', 'matter_closure_blockers', 'matter_closure_events', 'matter_active_periods',
  'post_closure_obligations', 'retention_schedules', 'legal_holds', 'legal_hold_events', 'closure_command_receipts'] as const;

describe('Matter Closure & Reopening Northstar evaluation seed', () => {
  let database: ReturnType<typeof createDatabase>;
  beforeEach(() => { database = createDatabase(':memory:'); seedDatabase(database); });
  afterEach(() => database.close());

  it('is idempotent and preserves blocked, closed, held and reopened facts', () => {
    seedMatterClosureEvaluation(database);
    const first = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()]));
    seedMatterClosureEvaluation(database);
    const second = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()]));
    expect(second).toEqual(first);
    expect(database.prepare('SELECT status,owner_user_id AS owner FROM matters WHERE id=?').get(SEED_IDS.northstarClosureMatter))
      .toEqual({ status: 'open', owner: SEED_IDS.ava });
    expect(database.prepare(`SELECT event_type AS type FROM matter_closure_events WHERE matter_id=? ORDER BY sequence`).all(SEED_IDS.northstarClosureMatter))
      .toEqual([{ type: 'blocked' }, { type: 'prepared' }, { type: 'approved' }, { type: 'closed' }, { type: 'reopened' }]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM matter_active_periods WHERE matter_id=?').get(SEED_IDS.northstarClosureMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM post_closure_obligations WHERE matter_id=?').get(SEED_IDS.northstarClosureMatter)).toEqual({ count: 1 });
    expect(database.prepare(`SELECT event_type AS type FROM legal_hold_events WHERE matter_id=?`).all(SEED_IDS.northstarClosureMatter)).toEqual([{ type: 'applied' }]);
  });
});
