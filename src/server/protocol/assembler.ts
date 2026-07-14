import { createHash } from 'node:crypto';

import type {
  ImmutableSourceReference,
  LetterAssemblyBlocker,
  LetterAssemblyResult,
  LetterAssemblySources,
  LetterAssemblyWarning,
  LetterSourceManifest,
  SourceFreshnessResult,
  VersionedSourceReference,
} from './types.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function immutableReference(
  source: { id: string } | null,
): ImmutableSourceReference {
  return { id: source?.id ?? '', digest: digest(source) };
}

function versionedReference(
  source: { id: string; version: number },
): VersionedSourceReference {
  return { id: source.id, version: source.version, digest: digest(source) };
}

function blocker(
  key: string,
  label: string,
  sourceType: string,
): LetterAssemblyBlocker {
  return { key, label, sourceType };
}

function warning(
  key: string,
  label: string,
  sourceType: string,
): LetterAssemblyWarning {
  return { key, label, sourceType };
}

export function assembleLetterOfClaim(
  input: LetterAssemblySources,
): LetterAssemblyResult {
  const defects = [...input.defects].sort(
    (left, right) =>
      left.location.localeCompare(right.location) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
  const notices = [...input.notices].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  const access = [...input.accessEvents].sort(
    (left, right) =>
      (left.appointmentAt ?? '').localeCompare(right.appointmentAt ?? '') ||
      left.id.localeCompare(right.id),
  );
  const evidenceItemIds = [...new Set(input.evidenceItemIds)].sort();

  const model = {
    matterReference: input.matter.reference,
    claimant: {
      name: input.claimant?.name ?? '',
      address: input.draft.claimantAddress,
      phone: input.claimant?.phone ?? '',
    },
    property: {
      addressLine1: input.property?.addressLine1 ?? '',
      addressLine2: input.property?.addressLine2 ?? '',
      city: input.property?.city ?? '',
      county: input.property?.county ?? '',
      postcode: input.property?.postcode ?? '',
    },
    landlord: {
      name: input.draft.landlordRecipient || input.landlord?.name || '',
      address: input.draft.landlordAddress || input.landlord?.address || '',
    },
    tenancy: {
      tenancyType: input.tenancy?.tenancyType ?? '',
      startedOn: input.tenancy?.startedOn ?? null,
    },
    defects: defects.map(({ version: _version, ...defect }) => defect),
    notices,
    access,
    effectNarrative: input.draft.effectNarrative,
    personalInjury: {
      status: input.draft.personalInjuryStatus,
      summary: input.draft.personalInjurySummary,
    },
    specialDamages: {
      status: input.draft.specialDamagesStatus,
      summary: input.draft.specialDamagesSummary,
    },
    accessWindows: input.draft.accessWindows,
    expertProposalSummary: input.draft.expertProposalSummary,
    disclosureRequests: [...input.draft.disclosureRequests],
    additionalContent: input.draft.additionalContent,
  };

  const manifest: LetterSourceManifest = {
    matter: versionedReference(input.matter),
    claimant: immutableReference(input.claimant),
    property: immutableReference(input.property),
    landlord: immutableReference(input.landlord),
    tenancy: immutableReference(input.tenancy),
    defects: defects.map(versionedReference),
    notices: notices.map(immutableReference),
    accessEvents: access.map(immutableReference),
    evidenceItems: evidenceItemIds.map((id) => ({ id, digest: digest(id) })),
    assembledAt: input.assembledAt,
  };

  const blockers: LetterAssemblyBlocker[] = [];
  if (!input.claimant) {
    blockers.push(
      blocker('claimant_missing', 'The primary claimant record is missing.', 'claimant'),
    );
  }
  if (!input.property) {
    blockers.push(
      blocker('property_missing', 'The claim property record is missing.', 'property'),
    );
  }
  if (!input.landlord) {
    blockers.push(
      blocker('landlord_missing', 'The landlord record is missing.', 'landlord'),
    );
  }
  if (!input.tenancy) {
    blockers.push(
      blocker('tenancy_missing', 'The tenancy record is missing.', 'tenancy'),
    );
  }
  if (defects.length === 0) {
    blockers.push(
      blocker('defect_schedule_missing', 'No active defect schedule is available.', 'defects'),
    );
  }
  if (notices.length === 0) {
    blockers.push(
      blocker('notice_history_missing', 'No landlord notice history is available.', 'notices'),
    );
  }
  if (access.length === 0) {
    blockers.push(
      blocker('access_history_missing', 'No inspection or repair access history is available.', 'access'),
    );
  }
  if (input.draft.effectNarrative.trim().length < 10) {
    blockers.push(
      blocker('effect_on_client_missing', 'Record the effect on the client and household.', 'letter'),
    );
  }
  if (input.draft.accessWindows.length === 0) {
    blockers.push(
      blocker('access_availability_missing', 'Record at least one access window.', 'letter'),
    );
  }

  const warnings: LetterAssemblyWarning[] = [];
  if (evidenceItemIds.length === 0) {
    warnings.push(
      warning('supporting_evidence_missing', 'No supporting evidence item is selected.', 'evidence'),
    );
  }
  if (input.draft.personalInjuryStatus === 'under_review') {
    warnings.push(
      warning('personal_injury_under_review', 'The personal-injury position remains under review.', 'letter'),
    );
  }
  if (input.draft.specialDamagesStatus === 'under_review') {
    warnings.push(
      warning('special_damages_under_review', 'The special-damages position remains under review.', 'letter'),
    );
  }
  if (!input.draft.expertProposalSummary.trim()) {
    warnings.push(
      warning('expert_proposal_missing', 'No proposed expert position is recorded.', 'expert'),
    );
  }

  return { model, manifest, blockers, warnings };
}

function flattenManifest(manifest: LetterSourceManifest): Map<string, string> {
  const values = new Map<string, string>();
  values.set(`matter:${manifest.matter.id}`, manifest.matter.digest);
  values.set(`claimant:${manifest.claimant.id}`, manifest.claimant.digest);
  values.set(`property:${manifest.property.id}`, manifest.property.digest);
  values.set(`landlord:${manifest.landlord.id}`, manifest.landlord.digest);
  values.set(`tenancy:${manifest.tenancy.id}`, manifest.tenancy.digest);
  for (const [group, references] of [
    ['defects', manifest.defects],
    ['notices', manifest.notices],
    ['accessEvents', manifest.accessEvents],
    ['evidenceItems', manifest.evidenceItems],
  ] as const) {
    for (const reference of references) {
      values.set(`${group}:${reference.id}`, reference.digest);
    }
  }
  return values;
}

export function compareSourceManifest(
  approved: LetterSourceManifest,
  current: LetterSourceManifest,
): SourceFreshnessResult {
  const approvedValues = flattenManifest(approved);
  const currentValues = flattenManifest(current);
  const added = [...currentValues.keys()]
    .filter((key) => !approvedValues.has(key))
    .sort();
  const removed = [...approvedValues.keys()]
    .filter((key) => !currentValues.has(key))
    .sort();
  const changed = [...currentValues.keys()]
    .filter(
      (key) =>
        approvedValues.has(key) &&
        approvedValues.get(key) !== currentValues.get(key),
    )
    .sort();
  return {
    fresh: added.length === 0 && changed.length === 0 && removed.length === 0,
    added,
    changed,
    removed,
  };
}
