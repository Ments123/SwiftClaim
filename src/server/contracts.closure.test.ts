import { describe, expect, it } from 'vitest';

import { prepareMatterClosureSchema, reopenMatterSchema } from '../shared/contracts.js';

describe('matter closure contracts', () => {
  it('requires exact final-report evidence and explicit human authority', () => {
    const input = {
      outcome: 'The repairs and settlement terms have been completed.',
      closureReason: 'The client objectives and all known obligations are complete.',
      lessons: 'Confirm file-return preferences during the final reporting call.',
      finalClientReportStatus: 'sent',
      finalClientReportDocumentVersionId: crypto.randomUUID(),
      documentsPosition: 'retained',
      documentsNote: 'The client authorised secure electronic retention of the file.',
      retentionBasis: 'Firm policy requires the closed file to be retained for six years.',
      retentionUntil: '2032-07-22',
      undertakingsConfirmedClear: true,
      complaintsConfirmedClear: true,
      attestationNote: 'The solicitor reviewed the file and found no unrecorded complaint or undertaking.',
      transfers: [],
      explicitHumanAuthority: true,
      idempotencyKey: 'closure-prepare-001',
    };
    expect(prepareMatterClosureSchema.parse(input).finalClientReportStatus).toBe('sent');
    expect(() => prepareMatterClosureSchema.parse({ ...input, explicitHumanAuthority: false })).toThrow();
    expect(() => prepareMatterClosureSchema.parse({ ...input, aiApproved: true })).toThrow();
  });

  it('requires a substantive reopening reason and a named new owner', () => {
    expect(() => reopenMatterSchema.parse({
      reason: 'short', newOwnerUserId: crypto.randomUUID(), explicitHumanAuthority: true, idempotencyKey: 'closure-reopen-001',
    })).toThrow();
    expect(reopenMatterSchema.parse({
      reason: 'New evidence requires further advice and active case management.',
      newOwnerUserId: crypto.randomUUID(), explicitHumanAuthority: true, idempotencyKey: 'closure-reopen-002',
    }).newOwnerUserId).toMatch(/[0-9a-f-]{36}/);
  });
});
