import type { DeadlineOutcome, ProcedureRegime } from './types.js';

export interface DeadlineInput {
  regime: ProcedureRegime;
  serviceReviewState: 'unreviewed' | 'reviewed' | 'disputed';
  particularsServiceDate: string | null;
  acknowledgmentRecorded: boolean;
  courtSourceDate: string | null;
  sourceDocumentVersionId: string | null;
  extensionDate: string | null;
}

export interface DeadlineProjection {
  kind: 'acknowledgment' | 'defence';
  outcome: DeadlineOutcome;
  date: string | null;
  ruleKey: string;
  ruleVersion: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDocumentVersionId: string | null;
  inputs: DeadlineInput;
}

const PART_10_URL = 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part10';
const PART_15_URL = 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15';

export function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error('Invalid trigger date');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function result(
  input: DeadlineInput,
  kind: DeadlineProjection['kind'],
  outcome: DeadlineOutcome,
  date: string | null,
  ruleKey: string,
  sourceTitle: string,
  sourceUrl: string,
): DeadlineProjection {
  return {
    kind,
    outcome,
    date,
    ruleKey,
    ruleVersion: 'reviewed-2026-07-18',
    sourceTitle,
    sourceUrl,
    sourceDocumentVersionId: input.sourceDocumentVersionId,
    inputs: { ...input },
  };
}

export function projectResponseDeadlines(input: DeadlineInput): DeadlineProjection[] {
  if (input.courtSourceDate && input.sourceDocumentVersionId) {
    return [result(input, 'defence', 'source_date', input.courtSourceDate, 'court_source_date', 'Retained court source', '')];
  }

  if (input.regime !== 'part_7_domestic') {
    return [result(input, 'defence', 'manual_court_period_required', null, 'manual_period', 'Human-selected response regime', '')];
  }

  if (input.serviceReviewState !== 'reviewed' || !input.particularsServiceDate) {
    return [result(input, 'defence', 'blocked_missing_facts', null, 'missing_reviewed_service', 'Reviewed service facts required', '')];
  }

  const acknowledgment = result(
    input,
    'acknowledgment',
    'projected',
    addUtcDays(input.particularsServiceDate, 14),
    'cpr_10_3_general',
    'CPR Part 10',
    PART_10_URL,
  );
  const defence = input.extensionDate
    ? result(input, 'defence', 'source_date', input.extensionDate, 'recorded_extension', 'Recorded extension source', '')
    : result(
        input,
        'defence',
        'projected',
        addUtcDays(input.particularsServiceDate, input.acknowledgmentRecorded ? 28 : 14),
        input.acknowledgmentRecorded ? 'cpr_15_4_aos_general' : 'cpr_15_4_general',
        'CPR Part 15',
        PART_15_URL,
      );
  return [acknowledgment, defence];
}
