import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedDatabase,
  seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { QuantumService } from './service.js';
import { QuantumStore } from './store.js';

describe('repairs and quantum evaluation seed', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('creates one idempotent end-to-end Maya pilot position', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'swiftclaim-quantum-seed-'));
    directories.push(directory);
    const database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, directory);

    seedRepairsQuantumEvaluation(database);
    seedRepairsQuantumEvaluation(database);

    const workflow = database
      .prepare(
        `SELECT current_stage_key AS stageKey
         FROM matter_workflows
         WHERE firm_id = ? AND matter_id = ?`,
      )
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter);
    expect(workflow).toEqual({ stageKey: 'repairs_quantum' });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM work_schedules WHERE firm_id = ? AND matter_id = ?')
        .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM loss_schedules WHERE firm_id = ? AND matter_id = ?')
        .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM offers WHERE firm_id = ? AND matter_id = ?')
        .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter),
    ).toEqual({ count: 2 });

    const ava: SessionUser = {
      id: SEED_IDS.ava,
      firmId: SEED_IDS.northstarFirm,
      firmName: 'Northstar Legal',
      email: 'ava@northstar.test',
      name: 'Ava Morgan',
      role: 'solicitor',
    };
    const service = new QuantumService(
      new QuantumStore(database, () => new Date('2026-08-20T09:00:00.000Z')),
      () => new Date('2026-08-20T09:00:00.000Z'),
    );
    const workspace = service.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace.workSchedules[0]).toMatchObject({
      status: 'approved',
      items: expect.arrayContaining([
        expect.objectContaining({ projection: expect.objectContaining({ clientPosition: 'disputed' }) }),
        expect.objectContaining({ projection: expect.objectContaining({ verification: 'verified' }) }),
      ]),
    });
    expect(workspace.lossSchedules[0]).toMatchObject({
      status: 'approved',
      totals: { evidenceGapCount: 1, specialDamagesMinor: 14_313 },
    });
    expect(workspace.openOffers).toHaveLength(1);
    expect(workspace.protectedOfferCount).toBe(1);
    expect(service.getProtectedOffers(ava, SEED_IDS.northstarMatter)[0]).toMatchObject({
      offerType: 'part_36',
      part36: { validationStatus: 'reviewed', projectedPeriodEndOn: '2026-08-31' },
    });
    expect(workspace.readiness.controls.every(({ eligible }) => eligible)).toBe(true);
    database.close();
  });
});
