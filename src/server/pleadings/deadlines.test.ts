import { describe, expect, it } from 'vitest';

import { projectResponseDeadlines } from './deadlines.js';

const reviewedDomesticInput = {
  regime: 'part_7_domestic' as const,
  serviceReviewState: 'reviewed' as const,
  particularsServiceDate: '2026-07-01',
  acknowledgmentRecorded: false,
  courtSourceDate: null,
  sourceDocumentVersionId: null,
  extensionDate: null,
};

describe('pleading response deadlines', () => {
  it('projects 14-day acknowledgment and defence dates for reviewed domestic Part 7 service', () => {
    const result = projectResponseDeadlines(reviewedDomesticInput);
    expect(result.map(({ kind, outcome, date }) => ({ kind, outcome, date }))).toEqual([
      { kind: 'acknowledgment', outcome: 'projected', date: '2026-07-15' },
      { kind: 'defence', outcome: 'projected', date: '2026-07-15' },
    ]);
  });

  it.each(['part_7_service_out', 'part_8', 'court_directed', 'manual_review'] as const)(
    'does not apply ordinary dates to %s',
    (regime) => {
      expect(projectResponseDeadlines({ ...reviewedDomesticInput, regime })[0]?.outcome)
        .toBe('manual_court_period_required');
    },
  );

  it('blocks calculations when service facts are unreviewed', () => {
    expect(projectResponseDeadlines({
      ...reviewedDomesticInput,
      serviceReviewState: 'unreviewed',
    })[0]?.outcome).toBe('blocked_missing_facts');
  });

  it('uses 28 days for defence after acknowledgment', () => {
    const result = projectResponseDeadlines({
      ...reviewedDomesticInput,
      acknowledgmentRecorded: true,
    });
    expect(result.find((item) => item.kind === 'defence')?.date).toBe('2026-07-29');
  });

  it('uses a retained court source date instead of calculating', () => {
    const result = projectResponseDeadlines({
      ...reviewedDomesticInput,
      regime: 'court_directed',
      courtSourceDate: '2026-08-10',
      sourceDocumentVersionId: '91000000-0000-4000-8000-000000000001',
    });
    expect(result).toEqual([
      expect.objectContaining({
        kind: 'defence', outcome: 'source_date', date: '2026-08-10',
        sourceDocumentVersionId: '91000000-0000-4000-8000-000000000001',
      }),
    ]);
  });

  it('uses an explicitly recorded extension as a new qualified date', () => {
    const result = projectResponseDeadlines({
      ...reviewedDomesticInput,
      acknowledgmentRecorded: true,
      extensionDate: '2026-08-12',
    });
    expect(result.find((item) => item.kind === 'defence')).toMatchObject({
      outcome: 'source_date', date: '2026-08-12', ruleKey: 'recorded_extension',
    });
  });
});
