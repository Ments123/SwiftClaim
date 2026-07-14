import { describe, expect, it } from 'vitest';

import { assembleExpertInstruction } from './instruction.js';

describe('assembleExpertInstruction', () => {
  it('builds a deterministic source-linked instruction and exposes approval blockers', () => {
    const result = assembleExpertInstruction({
      matterReference: 'NCL-2026-0017',
      claimantName: 'Maya Clarke',
      landlordName: 'Meridian Housing Association',
      propertyAddress: '18 Alder Court, Salford, M5 4QJ',
      engagement: {
        id: 'engagement-1',
        version: 2,
        route: 'proposed_single_joint',
        expertName: 'Elena Ward',
        organisation: 'Northfield Building Surveyors',
        expertRole: 'building_surveyor',
        termsStatus: 'received',
        feeMinor: 90000,
        currency: 'GBP',
        payerSplit: { claimantPercent: 50, landlordPercent: 50 },
        availabilitySummary: 'Inspection available in July.',
        conflictOutcome: 'potential',
        conflictDecision: 'proceed_with_override',
      },
      instruction: {
        issues: ['Identify all adverse housing conditions.'],
        questions: ['Set out the works required and estimated cost.'],
        accessDetail: 'Access is available on 20 July 2026 from 10:00 to 13:00.',
        urgentWorksRequested: true,
        scheduleOfWorksRequested: true,
        costEstimateRequested: true,
        reportDueOn: '2026-08-31',
      },
      materialSources: [
        { documentVersionId: 'version-b', title: 'Complaint email', version: 1, sha256: 'b'.repeat(64) },
        { documentVersionId: 'version-a', title: 'Bedroom photograph', version: 2, sha256: 'a'.repeat(64) },
      ],
      assembledAt: '2026-07-15T09:00:00.000Z',
    });

    expect(result.model).toMatchObject({
      matterReference: 'NCL-2026-0017',
      expert: { name: 'Elena Ward', role: 'Building surveyor' },
      parties: ['Maya Clarke', 'Meridian Housing Association'],
    });
    expect(result.model.materialSources).toEqual(['Bedroom photograph v2', 'Complaint email v1']);
    expect(result.manifest.materialSources.map(({ documentVersionId }) => documentVersionId))
      .toEqual(['version-a', 'version-b']);
    expect(result.blockers).toContainEqual(expect.objectContaining({ key: 'terms_not_accepted' }));
    expect(result.blockers).not.toContainEqual(expect.objectContaining({ key: 'conflict_not_cleared' }));
  });
});
