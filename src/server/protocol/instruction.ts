import type { ApproveExpertInstructionInput } from '../../shared/contracts.js';
import type { ExpertInstructionModel } from './types.js';

export interface ExpertInstructionSources {
  matterReference: string;
  claimantName: string;
  landlordName: string;
  propertyAddress: string;
  engagement: {
    id: string;
    version: number;
    route: string;
    expertName: string;
    organisation: string;
    expertRole: 'building_surveyor' | 'environmental_health' | 'other_housing_conditions';
    termsStatus: string;
    feeMinor: number | null;
    currency: string;
    payerSplit: { claimantPercent: number; landlordPercent: number };
    availabilitySummary: string;
    conflictOutcome: string | null;
    conflictDecision: string | null;
  };
  instruction: Omit<ApproveExpertInstructionInput, 'expectedVersion' | 'idempotencyKey'>;
  materialSources: Array<{
    documentVersionId: string;
    title: string;
    version: number;
    sha256: string;
  }>;
  assembledAt: string;
}

export interface ExpertInstructionAssembly {
  model: ExpertInstructionModel;
  manifest: {
    engagement: { id: string; version: number };
    materialSources: ExpertInstructionSources['materialSources'];
    assembledAt: string;
  };
  blockers: Array<{ key: string; label: string }>;
}

const ROLE_LABELS: Record<ExpertInstructionSources['engagement']['expertRole'], string> = {
  building_surveyor: 'Building surveyor',
  environmental_health: 'Environmental health expert',
  other_housing_conditions: 'Housing conditions expert',
};

export function assembleExpertInstruction(
  input: ExpertInstructionSources,
): ExpertInstructionAssembly {
  const materialSources = [...input.materialSources].sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.documentVersionId.localeCompare(right.documentVersionId),
  );
  const blockers: ExpertInstructionAssembly['blockers'] = [];
  if (input.engagement.termsStatus !== 'accepted') {
    blockers.push({ key: 'terms_not_accepted', label: 'The expert terms have not been accepted.' });
  }
  if (input.engagement.feeMinor === null) {
    blockers.push({ key: 'fee_not_recorded', label: 'The expert fee has not been recorded.' });
  }
  if (!input.engagement.availabilitySummary.trim()) {
    blockers.push({ key: 'availability_missing', label: 'The expert availability has not been recorded.' });
  }
  const conflictCleared =
    (input.engagement.conflictOutcome === 'clear' &&
      input.engagement.conflictDecision === 'clear_to_proceed') ||
    (input.engagement.conflictOutcome === 'potential' &&
      input.engagement.conflictDecision === 'proceed_with_override');
  if (!conflictCleared) {
    blockers.push({ key: 'conflict_not_cleared', label: 'A human conflict decision is required.' });
  }
  if (materialSources.length === 0) {
    blockers.push({ key: 'material_missing', label: 'No source material is linked to the instruction.' });
  }

  return {
    model: {
      matterReference: input.matterReference,
      expert: {
        name: input.engagement.expertName,
        organisation: input.engagement.organisation,
        role: ROLE_LABELS[input.engagement.expertRole],
      },
      parties: [input.claimantName, input.landlordName],
      propertyAddress: input.propertyAddress,
      route: input.engagement.route.replaceAll('_', ' '),
      accessDetail: input.instruction.accessDetail,
      issues: [...input.instruction.issues],
      questions: [...input.instruction.questions],
      urgentWorksRequested: input.instruction.urgentWorksRequested,
      scheduleOfWorksRequested: input.instruction.scheduleOfWorksRequested,
      costEstimateRequested: input.instruction.costEstimateRequested,
      reportDueOn: input.instruction.reportDueOn,
      materialSources: materialSources.map(({ title, version }) => `${title} v${version}`),
    },
    manifest: {
      engagement: { id: input.engagement.id, version: input.engagement.version },
      materialSources,
      assembledAt: input.assembledAt,
    },
    blockers,
  };
}
