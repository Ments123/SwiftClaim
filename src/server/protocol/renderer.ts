import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx';
import JSZip from 'jszip';

import type { ExpertInstructionModel, LetterReviewModel } from './types.js';

export const PROTOCOL_RENDERER_VERSION = 'swiftclaim-docx-1';
const FIXED_DOCUMENT_DATE = new Date('2000-01-01T00:00:00.000Z');

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 100 } });
}

function line(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun(value || 'Not recorded'),
    ],
  });
}

function bullet(text: string) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function footer(label: string) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun(`${label} · ${PROTOCOL_RENDERER_VERSION} · Page `),
          new TextRun({ children: [PageNumber.CURRENT] }),
        ],
      }),
    ],
  });
}

function document(children: Paragraph[], title: string, footerLabel: string) {
  return new Document({
    creator: 'SwiftClaim Litigation',
    title,
    description: 'Generated from governed SwiftClaim matter facts for solicitor review.',
    revision: 1,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1_080, right: 1_080, bottom: 1_080, left: 1_080 },
          },
        },
        footers: { default: footer(footerLabel) },
        children,
      },
    ],
  });
}

async function packDeterministically(value: Document): Promise<Buffer> {
  const packed = await Packer.toBuffer(value);
  const archive = await JSZip.loadAsync(packed);
  const coreProperties = archive.file('docProps/core.xml');

  if (!coreProperties) throw new Error('Generated DOCX has no core properties');
  const coreXml = await coreProperties.async('string');
  archive.file(
    'docProps/core.xml',
    coreXml
      .replace(
        /<dcterms:created([^>]*)>[^<]*<\/dcterms:created>/,
        `<dcterms:created$1>${FIXED_DOCUMENT_DATE.toISOString()}</dcterms:created>`,
      )
      .replace(
        /<dcterms:modified([^>]*)>[^<]*<\/dcterms:modified>/,
        `<dcterms:modified$1>${FIXED_DOCUMENT_DATE.toISOString()}</dcterms:modified>`,
      ),
  );

  for (const entry of Object.values(archive.files)) {
    entry.date = FIXED_DOCUMENT_DATE;
  }

  return archive.generateAsync({
    type: 'nodebuffer',
    platform: 'DOS',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function renderLetterOfClaimDocx(
  model: LetterReviewModel,
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: 'LETTER OF CLAIM',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    line('Matter reference', model.matterReference),
    line('Claimant', model.claimant.name),
    line('Claimant address', model.claimant.address),
    line('Claimant telephone', model.claimant.phone),
    line(
      'Property',
      [
        model.property.addressLine1,
        model.property.addressLine2,
        model.property.city,
        model.property.county,
        model.property.postcode,
      ]
        .filter(Boolean)
        .join(', '),
    ),
    line('Landlord', model.landlord.name),
    line('Landlord address', model.landlord.address),
    line('Tenancy', `${model.tenancy.tenancyType}${model.tenancy.startedOn ? ` from ${model.tenancy.startedOn}` : ''}`),
    heading('Housing conditions', HeadingLevel.HEADING_1),
  ];

  for (const defect of model.defects) {
    children.push(
      heading(`${defect.location}: ${defect.title}`, HeadingLevel.HEADING_2),
      line('Description', defect.description),
      line('Severity and status', `${defect.severity}; ${defect.status}`),
      line('First observed', defect.firstObservedOn ?? 'Not recorded'),
      ...defect.history.map((entry) => bullet(entry)),
    );
  }

  children.push(heading('Notice history', HeadingLevel.HEADING_1));
  for (const notice of model.notices) {
    children.push(
      bullet(
        `${notice.occurredAt.slice(0, 10)} · ${notice.channel} to ${notice.recipientName} · ${notice.summary} · proof ${notice.proofStatus}`,
      ),
    );
  }
  children.push(heading('Access and repair attempts', HeadingLevel.HEADING_1));
  for (const access of model.access) {
    children.push(
      bullet(`${access.appointmentAt ?? 'Date not recorded'} · ${access.eventType} · ${access.notes}`),
    );
  }
  children.push(
    heading('Effect on the claimant and household', HeadingLevel.HEADING_1),
    new Paragraph(model.effectNarrative),
    heading('Personal injury position', HeadingLevel.HEADING_1),
    line('Status', model.personalInjury.status.replaceAll('_', ' ')),
    new Paragraph(model.personalInjury.summary || 'No additional narrative recorded.'),
    heading('Special damages', HeadingLevel.HEADING_1),
    line('Status', model.specialDamages.status.replaceAll('_', ' ')),
    new Paragraph(model.specialDamages.summary || 'No additional narrative recorded.'),
    heading('Proposed access', HeadingLevel.HEADING_1),
    ...model.accessWindows.map((window) =>
      bullet(`${window.date}, ${window.from}–${window.to}${window.notes ? ` · ${window.notes}` : ''}`),
    ),
    heading('Expert proposal', HeadingLevel.HEADING_1),
    new Paragraph(model.expertProposalSummary || 'No expert proposal recorded.'),
    heading('Disclosure requested', HeadingLevel.HEADING_1),
    ...model.disclosureRequests.map(bullet),
  );
  if (model.additionalContent) {
    children.push(
      heading('Additional reviewed content', HeadingLevel.HEADING_1),
      new Paragraph(model.additionalContent),
    );
  }

  return packDeterministically(
    document(
      children,
      `Letter of Claim ${model.matterReference}`,
      `Letter of Claim ${model.matterReference}`,
    ),
  );
}

export async function renderExpertInstructionDocx(
  model: ExpertInstructionModel,
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: 'LETTER OF INSTRUCTION TO EXPERT',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    line('Matter reference', model.matterReference),
    line('Expert', model.expert.name),
    line('Organisation', model.expert.organisation),
    line('Discipline', model.expert.role),
    line('Parties', model.parties.join(' and ')),
    line('Property', model.propertyAddress),
    line('Instruction route', model.route),
    heading('Expert duty', HeadingLevel.HEADING_1),
    new Paragraph(
      'You are instructed as an independent expert. Your duty to help the court on matters within your expertise overrides any obligation to the person instructing or paying you. Please provide an objective and unbiased opinion and identify any issue outside your expertise or where the available information is insufficient.',
    ),
    heading('Access', HeadingLevel.HEADING_1),
    new Paragraph(model.accessDetail),
    heading('Issues', HeadingLevel.HEADING_1),
    ...model.issues.map(bullet),
    heading('Questions', HeadingLevel.HEADING_1),
    ...model.questions.map(bullet),
    heading('Requested outputs', HeadingLevel.HEADING_1),
    bullet(`Identify urgent works: ${model.urgentWorksRequested ? 'Yes' : 'No'}`),
    bullet(`Provide a schedule of works: ${model.scheduleOfWorksRequested ? 'Yes' : 'No'}`),
    bullet(`Provide a cost estimate: ${model.costEstimateRequested ? 'Yes' : 'No'}`),
    line('Requested report date', model.reportDueOn ?? 'Not fixed'),
    heading('Material supplied', HeadingLevel.HEADING_1),
    ...model.materialSources.map(bullet),
  ];

  return packDeterministically(
    document(
      children,
      `Expert instruction ${model.matterReference}`,
      `Expert instruction ${model.matterReference}`,
    ),
  );
}
