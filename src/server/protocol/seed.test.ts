import { readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedDatabase,
  seedProtocolExpertsEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProtocolStore } from './store.js';

describe('protocol and experts evaluation seed', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('creates one idempotent tenant-scoped journey with real private generated files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swiftclaim-protocol-seed-'));
    directories.push(directory);
    const database = createDatabase(':memory:');
    seedDatabase(database);

    await seedProtocolExpertsEvaluation(database, directory);
    await seedProtocolExpertsEvaluation(database, directory);

    expect(database.prepare('SELECT COUNT(*) AS count FROM protocol_cases WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM letter_of_claim_versions WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM protocol_service_events WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 2 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM landlord_responses WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM expert_engagements WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM expert_instruction_versions WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM expert_milestone_events
      WHERE firm_id = ? AND matter_id = ? AND event_type = 'inspection_completed'`)
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM expert_report_records WHERE firm_id = ? AND matter_id = ?')
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM protocol_cases WHERE firm_id = ?')
      .get(SEED_IDS.southbankFirm)).toEqual({ count: 0 });

    const ava: SessionUser = {
      id: SEED_IDS.ava,
      firmId: SEED_IDS.northstarFirm,
      firmName: 'Northstar Legal',
      email: 'ava@northstar.test',
      name: 'Ava Morgan',
      role: 'solicitor',
    };
    const workspace = new ProtocolStore(
      database,
      () => new Date('2026-08-20T09:00:00.000Z'),
    ).getWorkspace(ava, SEED_IDS.northstarMatter)!;
    expect(workspace.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'landlord_response_incomplete' }),
      expect.objectContaining({ type: 'report_missing' }),
    ]));

    const blobs = readdirSync(directory).filter((name) => name.endsWith('.blob'));
    expect(blobs).toHaveLength(2);
    for (const blob of blobs) expect(statSync(join(directory, blob)).mode & 0o777).toBe(0o600);
    database.close();
  });
});
