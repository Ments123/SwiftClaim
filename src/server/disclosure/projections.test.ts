import { describe, expect, it } from 'vitest';

import { projectDisclosureCandidate, projectInspection } from './projections.js';

const versionId = '93000000-0000-4000-8000-000000000001';

describe('disclosure projections', () => {
  it('keeps a candidate restricted when AI suggests relevance', () => {
    expect(projectDisclosureCandidate({
      documentVersionId: versionId,
      suggestions: [{ id: 's1', relevance: 'likely_relevant', privilegeWarning: 'possible', createdAt: '2026-07-18T10:00:00.000Z' }],
      privilegeReviews: [{ id: 'p1', outcome: 'restricted', reviewedAt: '2026-07-18T11:00:00.000Z' }],
      decisions: [], redactions: [],
    })).toMatchObject({ state: 'human_review_required', restricted: true, canList: false });
  });

  it('uses only an approved exact redaction for a listable decision', () => {
    expect(projectDisclosureCandidate({
      documentVersionId: versionId, suggestions: [], privilegeReviews: [],
      decisions: [{ id: 'd1', decision: 'disclose', redactionRequired: true, reviewedAt: '2026-07-18T11:00:00.000Z' }],
      redactions: [{ id: 'r1', status: 'approved', redactedDocumentVersionId: '93000000-0000-4000-8000-000000000002', reviewedAt: '2026-07-18T12:00:00.000Z' }],
    })).toMatchObject({ canList: true, effectiveDocumentVersionId: '93000000-0000-4000-8000-000000000002' });
  });

  it('keeps provided and completed inspection states separate', () => {
    const provided = projectInspection([{ id: 'e1', eventType: 'provided', occurredAt: '2026-07-18T12:00:00.000Z' }]);
    expect(provided).toMatchObject({ provided: true, completed: false });
    expect(projectInspection([...provided.events, { id: 'e2', eventType: 'completed', occurredAt: '2026-07-18T13:00:00.000Z' }]))
      .toMatchObject({ provided: true, completed: true });
  });
});
