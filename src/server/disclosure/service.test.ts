import { describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from '../proceedings/store.js';
import { DisclosureService } from './service.js';
import { DisclosureStore } from './store.js';

const now = () => new Date('2026-10-02T10:00:00.000Z');
const audit = { requestId: 'disclosure-service-test', ipAddress: '127.0.0.1' };
const user = (role: SessionUser['role']): SessionUser => ({
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: `${role}@northstar.test`, name: role, role,
});

function fixture(privilegeWarning: 'none' | 'possible' = 'possible') {
  const database = createDatabase(':memory:'); seedDatabase(database);
  const solicitor = user('solicitor'); const store = new DisclosureStore(database, now);
  const proceedingId = new ProceedingsStore(database, now).createProceeding(solicitor, SEED_IDS.northstarMatter, {
    idempotencyKey: 'disclosure-service-proceeding', procedureType: 'part7', jurisdiction: 'england_wales',
    courtName: 'County Court', courtCode: null, hearingCentre: null,
  }, audit).id;
  const partyId = String((database.prepare(`SELECT id FROM parties WHERE firm_id = ? AND matter_id = ? AND kind = 'client'`)
    .get(solicitor.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
  const versions = (database.prepare(`SELECT dv.id FROM document_versions dv JOIN documents d
    ON d.id = dv.document_id AND d.firm_id = dv.firm_id WHERE dv.firm_id = ? AND d.matter_id = ?
    ORDER BY dv.created_at LIMIT 2`).all(solicitor.firmId, SEED_IDS.northstarMatter) as Array<{ id: string }>).map(({ id }) => id);
  const review = store.openReview(solicitor, SEED_IDS.northstarMatter, proceedingId, {
    idempotencyKey: 'disclosure-service-review', disclosingPartyId: partyId, directionId: null,
    scopeNote: 'Review the exact repair records against the pleaded issues and retained sources.',
    dateFrom: null, dateTo: null, custodians: ['Maya Clarke'], issueTags: ['repairs'],
  }, audit);
  const candidate = store.addCandidate(solicitor, SEED_IDS.northstarMatter, proceedingId, review.id, {
    expectedVersion: 1, idempotencyKey: 'disclosure-service-candidate', documentVersionId: versions[0]!,
    evidenceItemId: null, custodian: 'Maya Clarke', sourceNote: 'Exact source retained for governed disclosure review.',
  }, audit);
  store.recordAiSuggestion(solicitor, SEED_IDS.northstarMatter, proceedingId, candidate.id, {
    idempotencyKey: 'disclosure-service-suggestion', relevance: 'likely_relevant', privilegeWarning,
    rationale: 'The local evaluation detected issue terms and requires human review.',
    model: 'evaluation-local-v1', policyVersion: 'disclosure-evaluation-v1', sourceHash: 'b'.repeat(64),
    citedSpans: ['repair'], suggestedIssueTags: ['repairs'],
  }, audit);
  return { database, store, service: new DisclosureService(store), proceedingId, candidateId: candidate.id, versions };
}

describe('DisclosureService', () => {
  it('blocks disclosure while a possible privilege warning is unresolved', () => {
    const context = fixture();
    expect(() => context.service.recordDecision(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 1, idempotencyKey: 'blocked-decision', decision: 'disclose',
        reason: 'The document appears relevant after human review of the exact retained version.',
        redactionRequired: false, reviewedAt: '2026-10-02T11:00:00.000Z' }, audit))
      .toThrow('Resolve the privilege warning before recording disclosure');
    context.database.close();
  });

  it('allows a solicitor to resolve privilege and record a human decision', () => {
    const context = fixture();
    const privilege = context.service.recordPrivilegeReview(user('solicitor'), SEED_IDS.northstarMatter,
      context.proceedingId, context.candidateId, { expectedVersion: 1, idempotencyKey: 'not-privileged-review',
        category: 'none', outcome: 'not_privileged', basis: 'The solicitor reviewed the exact source and found no privileged communication.',
        authorityDocumentVersionId: null, confirmExposure: false, reviewedAt: '2026-10-02T11:00:00.000Z' }, audit);
    expect(privilege.projection.restricted).toBe(false);
    const decision = context.service.recordDecision(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 2, idempotencyKey: 'human-disclosure-decision', decision: 'disclose',
        reason: 'The solicitor reviewed the exact retained version and approved disclosure treatment.',
        redactionRequired: false, reviewedAt: '2026-10-02T12:00:00.000Z' }, audit);
    expect(decision.projection).toMatchObject({ canList: true, restricted: false });
    context.database.close();
  });

  it('does not allow a solicitor to waive privilege', () => {
    const context = fixture();
    expect(() => context.service.recordPrivilegeReview(user('solicitor'), SEED_IDS.northstarMatter,
      context.proceedingId, context.candidateId, { expectedVersion: 1, idempotencyKey: 'privilege-waiver',
        category: 'legal_advice', outcome: 'waived',
        basis: 'The exact advice and authority source were reviewed for an intentional privilege waiver.',
        authorityDocumentVersionId: context.versions[0]!, confirmExposure: true,
        reviewedAt: '2026-10-02T11:00:00.000Z' }, audit)).toThrow('You do not have permission');
    context.database.close();
  });

  it('returns only safe metadata for restricted candidates to a paralegal', () => {
    const context = fixture();
    context.service.recordPrivilegeReview(user('solicitor'), SEED_IDS.northstarMatter,
      context.proceedingId, context.candidateId, { expectedVersion: 1, idempotencyKey: 'restricted-review',
        category: 'legal_advice', outcome: 'restricted',
        basis: 'The solicitor identified legal advice within the exact retained document version.',
        authorityDocumentVersionId: null, confirmExposure: false,
        reviewedAt: '2026-10-02T11:00:00.000Z' }, audit);
    const candidate = context.service.getWorkspace(user('paralegal'), SEED_IDS.northstarMatter,
      context.proceedingId).reviews[0]!.candidates[0]!;
    expect(candidate).toMatchObject({ id: context.candidateId, restricted: true });
    expect(candidate).not.toHaveProperty('documentVersionId');
    expect(candidate).not.toHaveProperty('sourceNote');
    context.database.close();
  });

  it('retains exact approved redaction lineage', () => {
    const context = fixture('none');
    const redaction = context.service.approveRedaction(user('solicitor'), SEED_IDS.northstarMatter,
      context.proceedingId, context.candidateId, { expectedVersion: 1, idempotencyKey: 'approved-redaction',
        redactedDocumentVersionId: context.versions[1]!, categories: ['personal_data'],
        reason: 'The solicitor visually checked the redacted exact version against the retained original.',
        visualReviewConfirmed: true, reviewedAt: '2026-10-02T11:00:00.000Z' }, audit);
    expect(redaction.projection.redaction).toMatchObject({ status: 'approved', redactedDocumentVersionId: context.versions[1] });
    context.database.close();
  });

  it('generates an immutable list from currently approved candidates', () => {
    const context = fixture();
    context.service.recordPrivilegeReview(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 1, idempotencyKey: 'list-privilege-review', category: 'none',
        outcome: 'not_privileged', basis: 'The solicitor reviewed the exact source and found no privileged communication.',
        authorityDocumentVersionId: null, confirmExposure: false, reviewedAt: '2026-10-02T11:00:00.000Z' }, audit);
    context.service.recordDecision(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 2, idempotencyKey: 'list-disclosure-decision', decision: 'disclose',
        reason: 'The solicitor reviewed the exact retained version and approved disclosure treatment.',
        redactionRequired: false, reviewedAt: '2026-10-02T12:00:00.000Z' }, audit);
    const list = context.service.generateList(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.store.getCandidate(user('solicitor').firmId, SEED_IDS.northstarMatter, context.candidateId)!.reviewId,
      { expectedVersion: 2, idempotencyKey: 'generate-list-snapshot', title: 'Claimant disclosure list',
        generatedAt: '2026-10-02T13:00:00.000Z', note: 'Immutable snapshot generated from current human decisions.' }, audit);
    expect(list.entries).toEqual([expect.objectContaining({ candidateId: context.candidateId })]);
    expect(list.blockers).toEqual([]);
    context.database.close();
  });

  it('keeps inspection provision and completion as separate events', () => {
    const context = fixture();
    context.service.recordPrivilegeReview(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 1, idempotencyKey: 'inspection-privilege-review', category: 'none',
        outcome: 'not_privileged', basis: 'The solicitor reviewed the exact source and found no privileged communication.',
        authorityDocumentVersionId: null, confirmExposure: false, reviewedAt: '2026-10-02T11:00:00.000Z' }, audit);
    context.service.recordDecision(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId,
      context.candidateId, { expectedVersion: 2, idempotencyKey: 'inspection-decision', decision: 'disclose',
        reason: 'The solicitor reviewed the exact retained version and approved disclosure treatment.',
        redactionRequired: false, reviewedAt: '2026-10-02T12:00:00.000Z' }, audit);
    const reviewId = context.store.getCandidate(user('solicitor').firmId, SEED_IDS.northstarMatter, context.candidateId)!.reviewId;
    const list = context.service.generateList(user('solicitor'), SEED_IDS.northstarMatter, context.proceedingId, reviewId,
      { expectedVersion: 2, idempotencyKey: 'inspection-list', title: 'Claimant disclosure list',
        generatedAt: '2026-10-02T13:00:00.000Z', note: 'List snapshot for the inspection request.' }, audit);
    const request = context.service.createInspectionRequest(user('paralegal'), SEED_IDS.northstarMatter,
      context.proceedingId, reviewId, { idempotencyKey: 'create-inspection-request', disclosureListId: list.id,
        requestingPartyId: list.disclosingPartyId, entryIds: [list.entries[0]!.id],
        receivedAt: '2026-10-03T10:00:00.000Z', note: 'Inspection request received for the selected exact list entry.' }, audit);
    const provided = context.service.recordInspectionEvent(user('paralegal'), SEED_IDS.northstarMatter,
      context.proceedingId, request.id, { expectedVersion: 1, idempotencyKey: 'inspection-provided', eventType: 'provided',
        occurredAt: '2026-10-04T10:00:00.000Z', providedDocumentVersionId: context.versions[0]!,
        deliveryEvidenceDocumentVersionId: null, note: 'Exact inspection copy was provided and retained.' }, audit);
    expect(provided.projection).toMatchObject({ provided: true, completed: false });
    const completed = context.service.recordInspectionEvent(user('paralegal'), SEED_IDS.northstarMatter,
      context.proceedingId, request.id, { expectedVersion: 2, idempotencyKey: 'inspection-completed', eventType: 'completed',
        occurredAt: '2026-10-05T10:00:00.000Z', providedDocumentVersionId: null,
        deliveryEvidenceDocumentVersionId: null, note: 'Human reviewer recorded inspection completion after provision.' }, audit);
    expect(completed.projection).toMatchObject({ provided: true, completed: true });
    context.database.close();
  });
});
