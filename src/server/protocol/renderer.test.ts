import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  renderExpertInstructionDocx,
  renderLetterOfClaimDocx,
} from './renderer.js';
import type { ExpertInstructionModel, LetterReviewModel } from './types.js';

const letter: LetterReviewModel = {
  matterReference: 'NCL-2026-0017',
  claimant: {
    name: 'Maya Clarke',
    address: '18 Alder Court, Salford, M5 4QJ',
    phone: '0161 000 1042',
  },
  property: {
    addressLine1: '18 Alder Court',
    addressLine2: '',
    city: 'Salford',
    county: 'Greater Manchester',
    postcode: 'M5 4QJ',
  },
  landlord: {
    name: 'Meridian Housing Association',
    address: '1 Civic Square, Salford, M5 1AA',
  },
  tenancy: { tenancyType: 'assured', startedOn: '2019-04-01' },
  defects: [
    {
      id: 'defect-1',
      location: 'Bedroom',
      title: 'Damp & mould <script>alert(1)</script>',
      description: 'Mould surrounds the window.',
      status: 'open',
      severity: 'serious',
      firstObservedOn: '2025-10-15',
      history: ['Reported on 3 November 2025.'],
    },
  ],
  notices: [
    {
      id: 'notice-1',
      occurredAt: '2025-11-03T09:00:00.000Z',
      channel: 'email',
      recipientName: 'Meridian Housing Association',
      summary: 'Damp reported.',
      proofStatus: 'linked',
    },
  ],
  access: [
    {
      id: 'access-1',
      eventType: 'completed',
      appointmentAt: '2025-11-18T10:00:00.000Z',
      notes: 'Operative attended.',
    },
  ],
  effectNarrative: 'The child cannot safely use the affected bedroom.',
  personalInjury: {
    status: 'minor_gp_evidence',
    summary: 'GP attendance is recorded.',
  },
  specialDamages: { status: 'under_review', summary: '' },
  accessWindows: [
    { date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Call first.' },
  ],
  expertProposalSummary: 'A single joint building surveyor is proposed.',
  disclosureRequests: ['Tenancy file', 'Inspection and works records'],
  additionalContent: '',
};

const instruction: ExpertInstructionModel = {
  matterReference: 'NCL-2026-0017',
  expert: {
    name: 'Elena Ward',
    organisation: 'Northfield Building Surveyors',
    role: 'Building surveyor',
  },
  parties: ['Maya Clarke', 'Meridian Housing Association'],
  propertyAddress: '18 Alder Court, Salford, M5 4QJ',
  route: 'Proposed single joint expert',
  accessDetail: 'Access is available on 20 July 2026 from 10:00 to 13:00.',
  issues: ['Identify all adverse housing conditions.'],
  questions: ['Set out the works required and estimated cost.'],
  urgentWorksRequested: true,
  scheduleOfWorksRequested: true,
  costEstimateRequested: true,
  reportDueOn: '2026-08-31',
  materialSources: ['Bedroom photograph v1', 'Complaint email v1'],
};

async function documentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('DOCX has no word/document.xml');
  return document.async('string');
}

async function differingArchiveEntries(first: Buffer, second: Buffer): Promise<string[]> {
  const [firstZip, secondZip] = await Promise.all([
    JSZip.loadAsync(first),
    JSZip.loadAsync(second),
  ]);
  const names = [...new Set([...Object.keys(firstZip.files), ...Object.keys(secondZip.files)])].sort();
  const differences: string[] = [];

  for (const name of names) {
    const firstEntry = firstZip.file(name);
    const secondEntry = secondZip.file(name);
    if (!firstEntry || !secondEntry) {
      differences.push(name);
      continue;
    }
    const [firstBytes, secondBytes] = await Promise.all([
      firstEntry.async('nodebuffer'),
      secondEntry.async('nodebuffer'),
    ]);
    if (!firstBytes.equals(secondBytes)) {
      differences.push(
        name === 'docProps/core.xml'
          ? `${name}: ${firstBytes.toString('utf8')} <> ${secondBytes.toString('utf8')}`
          : name,
      );
    }
  }

  return differences;
}

describe('protocol document renderer', () => {
  it('renders a deterministic valid Letter of Claim DOCX with escaped text', async () => {
    const first = await renderLetterOfClaimDocx(letter);
    const second = await renderLetterOfClaimDocx(letter);
    const xml = await documentXml(first);

    expect(first.subarray(0, 2).toString()).toBe('PK');
    expect(first.length).toBeGreaterThan(2_000);
    expect(first.equals(second), `differing entries: ${(await differingArchiveEntries(first, second)).join(', ')}`).toBe(true);
    expect(xml).toContain('Maya Clarke');
    expect(xml).toContain('Damp &amp; mould &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(xml).not.toContain('<script>');
  });

  it('renders expert instructions with the expert-duty safeguard', async () => {
    const bytes = await renderExpertInstructionDocx(instruction);
    const xml = await documentXml(bytes);

    expect(xml).toContain('Elena Ward');
    expect(xml).toContain('duty to help the court');
    expect(xml).toContain('Identify all adverse housing conditions.');
  });
});
