import { describe, expect, it } from 'vitest';

import { assembleLetterOfClaim, compareSourceManifest } from './assembler.js';
import type { LetterAssemblySources } from './types.js';

const fixture = (): LetterAssemblySources => ({
  assembledAt: '2026-07-14T15:00:00.000Z',
  matter: {
    id: '30000000-0000-4000-8000-000000000001',
    version: 3,
    reference: 'NCL-2026-0017',
  },
  claimant: {
    id: '41000000-0000-4000-8000-000000000003',
    name: 'Maya Clarke',
    address: '18 Alder Court, Salford, M5 4QJ',
    phone: '0161 000 1042',
  },
  property: {
    id: '43000000-0000-4000-8000-000000000003',
    addressLine1: '18 Alder Court',
    addressLine2: '',
    city: 'Salford',
    county: 'Greater Manchester',
    postcode: 'M5 4QJ',
  },
  landlord: {
    id: '42000000-0000-4000-8000-000000000003',
    name: 'Meridian Housing Association',
    address: '1 Civic Square, Salford, M5 1AA',
  },
  tenancy: {
    id: '48000000-0000-4000-8000-000000000003',
    tenancyType: 'assured',
    startedOn: '2019-04-01',
  },
  defects: [
    {
      id: '71000000-0000-4000-8000-000000000002',
      version: 1,
      location: 'Bathroom',
      title: 'Bath edge leak',
      description: 'Water escapes around the bath edge.',
      status: 'open',
      severity: 'moderate',
      firstObservedOn: '2025-12-01',
      history: ['Reported by phone on 8 December 2025.'],
    },
    {
      id: '71000000-0000-4000-8000-000000000001',
      version: 2,
      location: 'Bedroom',
      title: 'Bedroom damp and mould',
      description: 'Damp and mould surround the bedroom window.',
      status: 'open',
      severity: 'serious',
      firstObservedOn: '2025-10-15',
      history: ['Reported by email on 3 November 2025.'],
    },
  ],
  notices: [
    {
      id: '72000000-0000-4000-8000-000000000001',
      occurredAt: '2025-11-03T09:00:00.000Z',
      channel: 'email',
      recipientName: 'Meridian Housing Association',
      summary: 'Bedroom damp and mould reported.',
      proofStatus: 'linked',
    },
  ],
  accessEvents: [
    {
      id: '73000000-0000-4000-8000-000000000001',
      eventType: 'completed',
      appointmentAt: '2025-11-18T10:00:00.000Z',
      notes: 'Landlord operative attended.',
    },
  ],
  evidenceItemIds: [
    '76000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000002',
  ],
  draft: {
    claimantAddress: '18 Alder Court, Salford, M5 4QJ',
    landlordRecipient: 'Meridian Housing Association',
    landlordAddress: '1 Civic Square, Salford, M5 1AA',
    effectNarrative:
      'The bedroom cannot be used safely by the child during periods of heavy mould growth.',
    personalInjuryStatus: 'minor_gp_evidence',
    personalInjurySummary: 'The child has attended the GP regarding asthma symptoms.',
    specialDamagesStatus: 'under_review',
    specialDamagesSummary: '',
    accessWindows: [
      { date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Call first.' },
    ],
    expertProposalSummary: 'A single joint building surveyor is proposed.',
    disclosureRequests: [
      'Tenancy agreement and tenancy conditions',
      'Tenancy file',
      'Inspection reports and works records',
      'Computerised repair and complaint records',
    ],
    additionalContent: '',
    state: 'ready_for_review',
  },
});

describe('assembleLetterOfClaim', () => {
  it('builds a deterministic protocol review model and source manifest', () => {
    const result = assembleLetterOfClaim(fixture());

    expect(result.model).toMatchObject({
      matterReference: 'NCL-2026-0017',
      claimant: { name: 'Maya Clarke' },
      property: { addressLine1: '18 Alder Court' },
      landlord: { name: 'Meridian Housing Association' },
      defects: [
        { location: 'Bathroom', title: 'Bath edge leak' },
        { location: 'Bedroom', title: 'Bedroom damp and mould' },
      ],
      disclosureRequests: expect.arrayContaining([
        'Tenancy file',
        'Inspection reports and works records',
      ]),
    });
    expect(result.manifest.defects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '71000000-0000-4000-8000-000000000001',
          version: 2,
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map(({ key }) => key)).toContain(
      'special_damages_under_review',
    );
  });

  it('reports missing authoritative sources without inventing content', () => {
    const input = fixture();
    input.claimant = null;
    input.notices = [];
    input.accessEvents = [];
    input.evidenceItemIds = [];

    const result = assembleLetterOfClaim(input);

    expect(result.model.claimant.name).toBe('');
    expect(result.blockers.map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        'claimant_missing',
        'notice_history_missing',
        'access_history_missing',
      ]),
    );
    expect(result.warnings.map(({ key }) => key)).toContain(
      'supporting_evidence_missing',
    );
  });

  it('describes added, changed and removed source facts', () => {
    const approved = assembleLetterOfClaim(fixture()).manifest;
    const currentInput = fixture();
    currentInput.defects[0] = {
      ...currentInput.defects[0]!,
      version: 2,
      description: 'Water now escapes through the bath edge and flooring.',
    };
    currentInput.notices = [];
    currentInput.evidenceItemIds.push(
      '76000000-0000-4000-8000-000000000003',
    );
    const current = assembleLetterOfClaim(currentInput).manifest;

    expect(compareSourceManifest(approved, current)).toEqual({
      fresh: false,
      added: ['evidenceItems:76000000-0000-4000-8000-000000000003'],
      changed: ['defects:71000000-0000-4000-8000-000000000002'],
      removed: ['notices:72000000-0000-4000-8000-000000000001'],
    });
  });
});
