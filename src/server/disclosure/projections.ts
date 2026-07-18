export interface DisclosureSuggestionProjectionInput {
  id: string;
  relevance: 'likely_relevant' | 'likely_not_relevant' | 'uncertain';
  privilegeWarning: 'none' | 'possible' | 'likely';
  createdAt: string;
}

export interface DisclosureDecisionProjectionInput {
  id: string;
  decision: 'disclose' | 'withhold_privilege' | 'withhold_not_relevant' | 'withhold_other' | 'duplicate_only' | 'review_required';
  redactionRequired: boolean;
  reviewedAt: string;
}

export interface PrivilegeProjectionInput {
  id: string;
  outcome: 'restricted' | 'not_privileged' | 'further_review' | 'waived';
  reviewedAt: string;
}

export interface RedactionProjectionInput {
  id: string;
  status: 'awaiting_review' | 'approved' | 'rejected';
  redactedDocumentVersionId: string;
  reviewedAt: string;
}

const latest = <T extends { id: string }>(records: T[], time: (record: T) => string): T | undefined =>
  [...records].sort((left, right) => time(left).localeCompare(time(right)) || left.id.localeCompare(right.id)).at(-1);

export function projectDisclosureCandidate(input: {
  documentVersionId: string;
  suggestions: DisclosureSuggestionProjectionInput[];
  privilegeReviews: PrivilegeProjectionInput[];
  decisions: DisclosureDecisionProjectionInput[];
  redactions: RedactionProjectionInput[];
}) {
  const suggestion = latest(input.suggestions, (item) => item.createdAt);
  const privilege = latest(input.privilegeReviews, (item) => item.reviewedAt);
  const decision = latest(input.decisions, (item) => item.reviewedAt);
  const redaction = latest(input.redactions.filter(({ status }) => status === 'approved'), (item) => item.reviewedAt);
  const restricted = privilege?.outcome === 'restricted' || privilege?.outcome === 'further_review' ||
    (!privilege && (suggestion?.privilegeWarning === 'possible' || suggestion?.privilegeWarning === 'likely'));
  return {
    state: decision ? 'human_decision_recorded' as const : suggestion ? 'human_review_required' as const : 'unreviewed' as const,
    restricted,
    canList: decision?.decision === 'disclose' && !restricted && (!decision.redactionRequired || Boolean(redaction)),
    effectiveDocumentVersionId: redaction?.redactedDocumentVersionId ?? input.documentVersionId,
    suggestion: suggestion ?? null,
    decision: decision ?? null,
    privilege: privilege ?? null,
    redaction: redaction ?? null,
  };
}

export interface InspectionProjectionEvent {
  id: string;
  eventType: 'received' | 'acknowledged' | 'refused' | 'agreed' | 'provided' | 'completed';
  occurredAt: string;
}

export function projectInspection(events: InspectionProjectionEvent[]) {
  const ordered = [...events].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
  return {
    events: ordered,
    received: ordered.some(({ eventType }) => eventType === 'received'),
    acknowledged: ordered.some(({ eventType }) => eventType === 'acknowledged'),
    refused: ordered.some(({ eventType }) => eventType === 'refused'),
    agreed: ordered.some(({ eventType }) => eventType === 'agreed'),
    provided: ordered.some(({ eventType }) => eventType === 'provided'),
    completed: ordered.some(({ eventType }) => eventType === 'completed') && ordered.some(({ eventType }) => eventType === 'provided'),
  };
}
