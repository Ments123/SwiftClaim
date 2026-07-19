import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { suggestTimeFromActivity } from './activity.js';
import { FinanceStore } from './store.js';

const now = () => new Date('2026-07-19T12:00:00.000Z');
const audit = { requestId: 'finance-time-store-test', ipAddress: '127.0.0.1' };

const users = {
  ava: { id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor' },
  partner: { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' },
  finance: { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' },
  southbank: { id: SEED_IDS.southbankUser, firmId: SEED_IDS.southbankFirm, firmName: 'Southbank Law', email: 'lewis@southbank.test', name: 'Lewis Grant', role: 'partner' },
} satisfies Record<string, SessionUser>;

describe('FinanceStore time, rate and WIP governance', () => {
  let database: DatabaseSync;
  let store: FinanceStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new FinanceStore(database, now);
  });

  afterEach(() => database.close());

  function activateAvaRate(hourlyRateMinor = 24_000, effectiveFrom = '2026-01-01') {
    const card = store.createRateCard(users.finance, {
      idempotencyKey: `rate-card-${hourlyRateMinor}-${effectiveFrom}`,
      name: `Northstar standard ${hourlyRateMinor} ${effectiveFrom}`,
      description: 'Standard synthetic rate card used for governed finance tests.',
      currency: 'GBP',
    }, audit);
    const version = store.addRateVersion(users.finance, card.id, {
      expectedVersion: 1,
      idempotencyKey: `rate-version-${hourlyRateMinor}-${effectiveFrom}`,
      effectiveFrom,
      effectiveTo: null,
      entries: [{
        grade: 'solicitor', userId: users.ava.id, activityCode: '', matterId: null,
        hourlyRateMinor, currency: 'GBP',
      }],
      note: 'Prepared with an exact fee-earner rate for independent activation.',
    }, audit);
    return {
      card,
      version: store.activateRateVersion(users.partner, card.id, {
        expectedVersion: 2,
        idempotencyKey: `activate-rate-${hourlyRateMinor}-${effectiveFrom}`,
        rateVersionId: version.id,
        approvedAt: '2026-07-19T12:10:00.000Z',
        approvalNote: 'Independently checked against the approved firm rate schedule.',
        explicitHumanApproval: true,
      }, audit),
    };
  }

  function submitAvaTime(idempotencyKey = 'submit-time-entry-001') {
    return store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey,
      workDate: '2026-07-19',
      minutes: 37,
      narrative: 'Reviewed the retained evidence and prepared the next case steps.',
      activityCode: 'case_progression',
      costsPhase: 'case_management',
      chargeable: true,
      sourceKind: 'manual',
      sourceId: null,
    }, audit);
  }

  it('approves time with an immutable exact rate snapshot into WIP', () => {
    const { version } = activateAvaRate();
    const entry = submitAvaTime();

    expect(() => store.approveTime(users.ava, SEED_IDS.northstarMatter, entry.id, {
      expectedVersion: 1,
      idempotencyKey: 'self-approve-time-entry',
      approvedAt: '2026-07-19T12:15:00.000Z',
      approvalNote: 'A fee earner must not be able to approve their own time entry.',
      explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));

    const approved = store.approveTime(users.partner, SEED_IDS.northstarMatter, entry.id, {
      expectedVersion: 1,
      idempotencyKey: 'approve-time-entry-001',
      approvedAt: '2026-07-19T12:20:00.000Z',
      approvalNote: 'Time, narrative, rate and matter allocation independently checked.',
      explicitHumanApproval: true,
    }, audit);

    expect(approved).toMatchObject({
      status: 'approved', version: 2, rateVersionId: version.id,
      hourlyRateMinor: 24_000, chargeMinor: 14_800,
      remainderNumerator: 0, denominator: 60, currency: 'GBP',
    });
    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.snapshot.approvedWip)
      .toEqual({ minutes: 37, amountMinor: 14_800, currency: 'GBP' });
    expect(() => database.prepare('UPDATE finance_time_approvals SET charge_minor = 1').run()).toThrow(/immutable/i);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'finance.time_approved'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'finance.time_approved'").get()).toEqual({ count: 1 });
  });

  it('uses the rate effective on the work date and never reprices the approval snapshot', () => {
    const { card, version: historicalVersion } = activateAvaRate();
    const futureVersion = store.addRateVersion(users.finance, card.id, {
      expectedVersion: 3, idempotencyKey: 'future-rate-version',
      effectiveFrom: '2026-08-01', effectiveTo: null,
      entries: [{ grade: 'solicitor', userId: users.ava.id, activityCode: '', matterId: null, hourlyRateMinor: 30_000, currency: 'GBP' }],
      note: 'Future rate version that must not reprice work performed in July.',
    }, audit);
    store.activateRateVersion(users.partner, card.id, {
      expectedVersion: 4, idempotencyKey: 'activate-future-rate', rateVersionId: futureVersion.id,
      approvedAt: '2026-07-19T12:20:00.000Z',
      approvalNote: 'Future effective rate independently checked and activated.', explicitHumanApproval: true,
    }, audit);
    const entry = submitAvaTime('submit-historical-rate-time');
    const approved = store.approveTime(users.partner, SEED_IDS.northstarMatter, entry.id, {
      expectedVersion: 1, idempotencyKey: 'approve-historical-rate-time',
      approvedAt: '2026-07-19T12:30:00.000Z',
      approvalNote: 'Historical work date and exact applicable rate independently checked.', explicitHumanApproval: true,
    }, audit);

    expect(approved).toMatchObject({
      rateVersionId: historicalVersion.id, hourlyRateMinor: 24_000, chargeMinor: 14_800,
    });
    expect(store.getTimeEntry(users.partner, SEED_IDS.northstarMatter, entry.id))
      .toMatchObject({ rateVersionId: historicalVersion.id, hourlyRateMinor: 24_000, chargeMinor: 14_800 });
  });

  it('replays one activity source and rejects a changed idempotency payload', () => {
    const fact = {
      sourceKind: 'communication_call', id: '81000000-0000-4000-8000-000000000001',
      firmId: users.ava.firmId, matterId: SEED_IDS.northstarMatter, userId: users.ava.id,
      observedMinutes: 18, occurredAt: '2026-07-19T09:00:00.000Z', direction: 'outbound',
    } as const;
    const first = store.createSuggestion(users.ava, SEED_IDS.northstarMatter, suggestTimeFromActivity(fact), audit);

    expect(first.observedAt).toBe('2026-07-19T09:00:00.000Z');
    expect(store.createSuggestion(users.ava, SEED_IDS.northstarMatter, suggestTimeFromActivity(fact), audit)).toEqual(first);
    expect(() => store.createSuggestion(users.ava, SEED_IDS.northstarMatter,
      suggestTimeFromActivity({ ...fact, observedMinutes: 19 }), audit))
      .toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_activity_suggestions').get()).toEqual({ count: 1 });
  });

  it('requires an independent user to activate an immutable rate version', () => {
    const card = store.createRateCard(users.finance, {
      idempotencyKey: 'independent-rate-card', name: 'Independent rate card',
      description: 'Rate card that proves preparation and activation stay separate.', currency: 'GBP',
    }, audit);
    const version = store.addRateVersion(users.finance, card.id, {
      expectedVersion: 1, idempotencyKey: 'independent-rate-version',
      effectiveFrom: '2026-01-01', effectiveTo: null,
      entries: [{ grade: 'solicitor', userId: users.ava.id, activityCode: '', matterId: null, hourlyRateMinor: 24_000, currency: 'GBP' }],
      note: 'Prepared by finance and awaiting a separate human approver.',
    }, audit);
    const activation = {
      expectedVersion: 2, idempotencyKey: 'independent-rate-activate', rateVersionId: version.id,
      approvedAt: '2026-07-19T12:10:00.000Z',
      approvalNote: 'Rate schedule checked independently before activation.', explicitHumanApproval: true as const,
    };

    expect(() => store.activateRateVersion(users.finance, card.id, activation, audit))
      .toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));
    expect(() => store.activateRateVersion(users.partner, card.id, {
      ...activation, idempotencyKey: 'backdated-rate-activate', approvedAt: '2026-07-19T11:59:00.000Z',
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect(store.activateRateVersion(users.partner, card.id, activation, audit)).toMatchObject({ status: 'active' });
    expect(() => database.prepare("UPDATE finance_rate_versions SET note = 'changed'").run()).toThrow(/immutable/i);
    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_integration_outbox WHERE topic = 'finance.rate_version_activated'").get()).toEqual({ count: 1 });
  });

  it('stops an existing timer before starting another and submits its exact elapsed minutes', () => {
    let clock = '2026-07-19T09:00:00.000Z';
    store = new FinanceStore(database, () => new Date(clock));
    const first = store.startTimer(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'start-finance-timer-001',
      activityCode: 'case_progression', costsPhase: 'case_management',
      narrative: 'Working through the matter evidence and next procedural steps.',
    }, audit);
    clock = '2026-07-19T09:18:00.000Z';
    const second = store.startTimer(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'start-finance-timer-002',
      activityCode: 'document_preparation', costsPhase: 'documents',
      narrative: 'Preparing a governed document revision for supervisor review.',
    }, audit);

    expect(store.getTimer(users.ava, SEED_IDS.northstarMatter, first.id)).toMatchObject({ status: 'stopped', version: 2, elapsedMinutes: 18 });
    expect(store.getTimer(users.ava, SEED_IDS.northstarMatter, second.id)).toMatchObject({ status: 'running', version: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_timer_sessions WHERE firm_id = ? AND user_id = ? AND status = 'running'")
      .get(users.ava.firmId, users.ava.id)).toEqual({ count: 1 });

    clock = '2026-07-19T09:25:30.000Z';
    const stopped = store.stopTimer(users.ava, SEED_IDS.northstarMatter, second.id, {
      expectedVersion: 1, idempotencyKey: 'stop-finance-timer-002',
    }, audit);
    expect(stopped).toMatchObject({ status: 'stopped', elapsedMinutes: 8, version: 2 });
    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.snapshot.provisionalTime.minutes).toBe(26);
    expect(() => store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'submit-inflated-timer', workDate: '2026-07-19', minutes: 9,
      narrative: 'Confirmed timer attendance with an incorrectly inflated duration.',
      activityCode: 'document_preparation', costsPhase: 'documents', chargeable: true,
      sourceKind: 'timer', sourceId: second.id,
    }, audit)).toThrow(/elapsed/i);
    expect(store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'submit-exact-timer', workDate: '2026-07-19', minutes: 8,
      narrative: 'Confirmed timer attendance at the exact server-recorded duration.',
      activityCode: 'document_preparation', costsPhase: 'documents', chargeable: true,
      sourceKind: 'timer', sourceId: second.id,
    }, audit)).toMatchObject({ status: 'submitted', minutes: 8, sourceId: second.id });
    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.snapshot.provisionalTime.minutes).toBe(26);
  });

  it('requires an explicit human decision before activity-derived time is submitted', () => {
    const fact = {
      sourceKind: 'communication_call', id: '81000000-0000-4000-8000-000000000011',
      firmId: users.ava.firmId, matterId: SEED_IDS.northstarMatter, userId: users.ava.id,
      observedMinutes: 18, occurredAt: '2026-07-19T09:00:00.000Z', direction: 'outbound',
    } as const;
    const suggestionInput = suggestTimeFromActivity(fact);
    const suggestion = store.createSuggestion(users.ava, SEED_IDS.northstarMatter, suggestionInput, audit);
    const timeInput = {
      idempotencyKey: 'submit-reviewed-call-time', workDate: '2026-07-19', minutes: 18,
      narrative: suggestionInput.proposedNarrative,
      activityCode: suggestionInput.proposedActivityCode,
      costsPhase: suggestionInput.proposedCostsPhase,
      chargeable: true, sourceKind: 'communication_call' as const, sourceId: fact.id,
    };

    expect(() => store.submitTime(users.ava, SEED_IDS.northstarMatter, timeInput, audit)).toThrow(/human review/i);
    store.decideSuggestion(users.ava, SEED_IDS.northstarMatter, suggestion.id, {
      expectedVersion: 1, idempotencyKey: 'accept-call-suggestion', decision: 'accept',
      reason: 'The call duration and neutral billing narrative have been checked.',
    }, audit);
    expect(store.submitTime(users.ava, SEED_IDS.northstarMatter, timeInput, audit))
      .toMatchObject({ status: 'submitted', sourceKind: 'communication_call', sourceId: fact.id });
  });

  it('keeps accepted activity provisional until its reviewed time is submitted', () => {
    activateAvaRate();
    const fact = {
      sourceKind: 'communication_call', id: '81000000-0000-4000-8000-000000000012',
      firmId: users.ava.firmId, matterId: SEED_IDS.northstarMatter, userId: users.ava.id,
      observedMinutes: 18, occurredAt: '2026-07-19T09:00:00.000Z', direction: 'outbound',
    } as const;
    const suggestionInput = suggestTimeFromActivity(fact);
    const suggestion = store.createSuggestion(users.ava, SEED_IDS.northstarMatter, suggestionInput, audit);
    store.decideSuggestion(users.ava, SEED_IDS.northstarMatter, suggestion.id, {
      expectedVersion: 1, idempotencyKey: 'accept-call-before-submit', decision: 'accept',
      reason: 'The exact activity duration and proposed narrative were checked.',
    }, audit);

    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.snapshot.provisionalTime)
      .toEqual({ minutes: 18, estimatedChargeMinor: 7_200, unpricedCount: 0, currency: 'GBP' });

    store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'submit-call-after-acceptance', workDate: '2026-07-19', minutes: 18,
      narrative: suggestionInput.proposedNarrative,
      activityCode: suggestionInput.proposedActivityCode,
      costsPhase: suggestionInput.proposedCostsPhase,
      chargeable: true, sourceKind: 'communication_call', sourceId: fact.id,
    }, audit);
    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.snapshot.provisionalTime.minutes).toBe(18);
  });

  it('does not price explicitly non-chargeable submitted time as provisional WIP', () => {
    activateAvaRate();
    store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'submit-non-chargeable-time', workDate: '2026-07-19', minutes: 30,
      narrative: 'Reviewed non-chargeable internal administration recorded separately.',
      activityCode: 'case_progression', costsPhase: 'case_management',
      chargeable: false, sourceKind: 'manual', sourceId: null,
    }, audit);

    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.snapshot.provisionalTime)
      .toEqual({ minutes: 30, estimatedChargeMinor: 0, unpricedCount: 0, currency: 'GBP' });
  });

  it('prevents split activity time from exceeding the exact observed duration', () => {
    const fact = {
      sourceKind: 'communication_call', id: '81000000-0000-4000-8000-000000000013',
      firmId: users.ava.firmId, matterId: SEED_IDS.northstarMatter, userId: users.ava.id,
      observedMinutes: 18, occurredAt: '2026-07-19T09:00:00.000Z', direction: 'outbound',
    } as const;
    const input = suggestTimeFromActivity(fact);
    const suggestion = store.createSuggestion(users.ava, SEED_IDS.northstarMatter, input, audit);
    store.decideSuggestion(users.ava, SEED_IDS.northstarMatter, suggestion.id, {
      expectedVersion: 1, idempotencyKey: 'split-call-before-submit', decision: 'split',
      reason: 'The attendance covered two separately recorded activities.',
    }, audit);
    const split = (idempotencyKey: string, minutes: number) => ({
      idempotencyKey, workDate: '2026-07-19', minutes,
      narrative: 'Reviewed split of the exact telephone attendance.',
      activityCode: 'telephone_attendance', costsPhase: 'communications',
      chargeable: true, sourceKind: 'communication_call' as const, sourceId: fact.id,
    });

    store.submitTime(users.ava, SEED_IDS.northstarMatter, split('split-call-part-one', 10), audit);
    expect(() => store.submitTime(
      users.ava, SEED_IDS.northstarMatter, split('split-call-too-large', 9), audit,
    )).toThrow(/observed duration/i);
    expect(store.submitTime(
      users.ava, SEED_IDS.northstarMatter, split('split-call-part-two', 8), audit,
    )).toMatchObject({ status: 'submitted', minutes: 8 });
  });

  it('does not grant finance document access from legal work activity alone', () => {
    const input = suggestTimeFromActivity({
      sourceKind: 'document_version', id: SEED_IDS.bedroomPhotoVersion,
      firmId: users.ava.firmId, matterId: SEED_IDS.northstarMatter, userId: users.ava.id,
      observedMinutes: 12, occurredAt: '2026-07-19T09:00:00.000Z', documentCategory: 'photographs',
    });
    store.createSuggestion(users.ava, SEED_IDS.northstarMatter, input, audit);

    expect(store.getWorkspace(users.ava, SEED_IDS.northstarMatter)?.sources.documents)
      .toContainEqual(expect.objectContaining({ id: SEED_IDS.bedroomPhotoVersion }));
    expect(store.getWorkspace(users.finance, SEED_IDS.northstarMatter)?.sources.documents)
      .not.toContainEqual(expect.objectContaining({ id: SEED_IDS.bedroomPhotoVersion }));
  });

  it('removes reversed approved time from WIP without mutating the source or approval', () => {
    activateAvaRate();
    const entry = submitAvaTime('submit-time-for-reversal');
    const approved = store.approveTime(users.partner, SEED_IDS.northstarMatter, entry.id, {
      expectedVersion: 1, idempotencyKey: 'approve-time-for-reversal',
      approvedAt: '2026-07-19T12:20:00.000Z',
      approvalNote: 'Approved before a later governed correction was identified.', explicitHumanApproval: true,
    }, audit);

    expect(store.reverseTime(users.partner, SEED_IDS.northstarMatter, entry.id, {
      expectedVersion: approved.version, idempotencyKey: 'reverse-time-entry-001',
      reason: 'The attendance was allocated to the wrong costs phase and must be replaced.',
      replacementEntryId: null, reversedAt: '2026-07-19T12:30:00.000Z', explicitHumanApproval: true,
    }, audit)).toMatchObject({ status: 'reversed', version: 3, chargeMinor: 14_800 });
    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.snapshot.approvedWip.amountMinor).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_time_entries').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_time_approvals').get()).toEqual({ count: 1 });
  });

  it('returns generic absence across tenants and rejects cross-tenant rate links', () => {
    expect(store.getWorkspace(users.southbank, SEED_IDS.northstarMatter)).toBeUndefined();
    const card = store.createRateCard(users.finance, {
      idempotencyKey: 'tenant-rate-card', name: 'Tenant-safe rate card',
      description: 'Rate entries must not link users or matters from another firm.', currency: 'GBP',
    }, audit);
    expect(() => store.addRateVersion(users.finance, card.id, {
      expectedVersion: 1, idempotencyKey: 'tenant-rate-version', effectiveFrom: '2026-01-01', effectiveTo: null,
      entries: [{ grade: 'partner', userId: users.southbank.id, activityCode: '', matterId: SEED_IDS.southbankMatter, hourlyRateMinor: 30_000, currency: 'GBP' }],
      note: 'This deliberately invalid cross-tenant rate link must be rejected.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_LINK' }));
  });

  it('gives finance users safe amounts and sources without privileged time narratives', () => {
    const entry = submitAvaTime('submit-time-for-finance-redaction');

    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.timeEntries[0]?.narrative)
      .toBe(entry.narrative);
    expect(store.getWorkspace(users.finance, SEED_IDS.northstarMatter)?.timeEntries[0])
      .toMatchObject({ id: entry.id, minutes: 37, narrative: null });
  });
});
