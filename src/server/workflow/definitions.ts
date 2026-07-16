import type { DatabaseSync } from 'node:sqlite';

import type { BusinessCalendar, WorkflowDefinition } from './types.js';

const PROTOCOL_URL =
  'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou';
const CPR_35_URL =
  'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part35';
const BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays';

export const WORKFLOW_IDS = {
  englandWales2026Calendar: '71000000-0000-4000-8000-000000000001',
  housingTemplate: '72000000-0000-4000-8000-000000000001',
  housingVersion1: '73000000-0000-4000-8000-000000000001',
  landlordResponseRule: '74000000-0000-4000-8000-000000000001',
  expertInspectionRule: '74000000-0000-4000-8000-000000000002',
  expertReportRule: '74000000-0000-4000-8000-000000000003',
  substantiveResponseRule: '74000000-0000-4000-8000-000000000004',
  clarificationQuestionsRule: '74000000-0000-4000-8000-000000000005',
} as const;

const STAGE_IDS = [
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000006',
  '75000000-0000-4000-8000-000000000007',
  '75000000-0000-4000-8000-000000000008',
  '75000000-0000-4000-8000-000000000009',
  '75000000-0000-4000-8000-000000000010',
  '75000000-0000-4000-8000-000000000011',
] as const;

export const ENGLAND_WALES_2026_CALENDAR: BusinessCalendar = {
  id: WORKFLOW_IDS.englandWales2026Calendar,
  name: 'England and Wales working days 2026',
  timezone: 'Europe/London',
  weekendDays: [0, 6],
  holidays: [
    '2026-01-01',
    '2026-04-03',
    '2026-04-06',
    '2026-05-04',
    '2026-05-25',
    '2026-08-31',
    '2026-12-25',
    '2026-12-28',
  ],
};

const HOLIDAY_NAMES = [
  "New Year's Day",
  'Good Friday',
  'Easter Monday',
  'Early May bank holiday',
  'Spring bank holiday',
  'Summer bank holiday',
  'Christmas Day',
  'Boxing Day substitute day',
] as const;

export const HOUSING_DISREPAIR_WORKFLOW: WorkflowDefinition = {
  key: 'housing_conditions_claimant_england',
  version: 1,
  name: 'Housing Conditions — Claimant (England)',
  jurisdiction: 'england',
  matterType: 'housing_conditions_claimant',
  effectiveFrom: '2026-01-01',
  stages: [
    {
      key: 'enquiry',
      name: 'Enquiry',
      position: 0,
      description: 'Capture the prospective client, property and initial complaint.',
      requiredChecklistKeys: [
        'initial_contact_recorded',
        'conflict_check_completed',
      ],
      allowedNextStageKeys: ['assessment'],
    },
    {
      key: 'assessment',
      name: 'Assessment',
      position: 1,
      description: 'Assess duty, notice, limitation, causation and proportionality.',
      requiredChecklistKeys: [
        'tenancy_confirmed',
        'landlord_duty_screened',
        'limitation_reviewed',
        'merits_decision_recorded',
      ],
      allowedNextStageKeys: ['onboarding'],
    },
    {
      key: 'onboarding',
      name: 'Onboarding',
      position: 2,
      description: 'Complete client care, identity, authority and funding records.',
      requiredChecklistKeys: [
        'client_care_signed',
        'authority_signed',
        'id_checks_completed',
        'funding_recorded',
      ],
      allowedNextStageKeys: ['evidence'],
    },
    {
      key: 'evidence',
      name: 'Evidence and notice',
      position: 3,
      description: 'Build the defect, notice, loss, vulnerability and photo evidence.',
      requiredChecklistKeys: [
        'defect_schedule_recorded',
        'notice_evidence_recorded',
        'photographs_recorded',
      ],
      allowedNextStageKeys: ['protocol'],
    },
    {
      key: 'protocol',
      name: 'Pre-Action Protocol',
      position: 4,
      description: 'Prepare, send and monitor the Housing Conditions Letter of Claim.',
      requiredChecklistKeys: ['letter_of_claim_sent'],
      allowedNextStageKeys: ['expert'],
    },
    {
      key: 'expert',
      name: 'Expert evidence',
      position: 5,
      description: 'Instruct the expert and control inspection and report milestones.',
      requiredChecklistKeys: ['expert_instruction_confirmed'],
      allowedNextStageKeys: ['repairs_quantum'],
    },
    {
      key: 'repairs_quantum',
      name: 'Repairs and quantum',
      position: 6,
      description: 'Track remedial works and maintain the damages and loss schedule.',
      requiredChecklistKeys: [
        'works_status_reviewed',
        'damages_schedule_reviewed',
      ],
      allowedNextStageKeys: ['negotiation'],
    },
    {
      key: 'negotiation',
      name: 'Negotiation',
      position: 7,
      description: 'Control offers, advice and current settlement authority.',
      requiredChecklistKeys: ['settlement_authority_recorded'],
      allowedNextStageKeys: ['proceedings', 'settlement'],
    },
    {
      key: 'proceedings',
      name: 'Proceedings',
      position: 8,
      description: 'Issue and manage court proceedings, directions and hearings.',
      requiredChecklistKeys: ['court_authority_recorded'],
      allowedNextStageKeys: ['settlement'],
    },
    {
      key: 'settlement',
      name: 'Settlement',
      position: 9,
      description: 'Record agreed terms, works, damages, costs and payment dates.',
      requiredChecklistKeys: ['settlement_terms_recorded'],
      allowedNextStageKeys: ['closure'],
    },
    {
      key: 'closure',
      name: 'Closure',
      position: 10,
      description: 'Complete outcome, financial, file-review and retention checks.',
      requiredChecklistKeys: [
        'final_outcome_recorded',
        'closure_review_completed',
      ],
      allowedNextStageKeys: [],
    },
  ],
  deadlineRules: [
    {
      id: WORKFLOW_IDS.landlordResponseRule,
      key: 'housing.protocol.landlord_response',
      version: 1,
      name: 'Landlord response to Letter of Claim',
      triggerEventType: 'letter_of_claim.received',
      offset: 20,
      unit: 'working_days',
      direction: 'after',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 6.2',
      sourceUrl: PROTOCOL_URL,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    {
      id: WORKFLOW_IDS.expertInspectionRule,
      key: 'housing.expert.inspection',
      version: 1,
      name: 'Expert inspection',
      triggerEventType: 'landlord_response.received',
      offset: 20,
      unit: 'working_days',
      direction: 'after',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 7.4(a)',
      sourceUrl: PROTOCOL_URL,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    {
      id: WORKFLOW_IDS.expertReportRule,
      key: 'housing.expert.report',
      version: 1,
      name: 'Expert report or agreed schedule',
      triggerEventType: 'expert.inspection.completed',
      offset: 10,
      unit: 'working_days',
      direction: 'after',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 7.4(b)',
      sourceUrl: PROTOCOL_URL,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    {
      id: WORKFLOW_IDS.substantiveResponseRule,
      key: 'housing.protocol.substantive_response',
      version: 1,
      name: 'Substantive response after expert report',
      triggerEventType: 'expert.report.received',
      offset: 20,
      unit: 'working_days',
      direction: 'after',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 7.5',
      sourceUrl: PROTOCOL_URL,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    {
      id: WORKFLOW_IDS.clarificationQuestionsRule,
      key: 'housing.expert.clarification_questions',
      version: 1,
      name: 'Written questions to expert under CPR 35.6',
      triggerEventType: 'expert.report.served_cpr35',
      offset: 28,
      unit: 'calendar_days',
      direction: 'after',
      sourceTitle: 'Civil Procedure Rules, Part 35.6',
      sourceUrl: CPR_35_URL,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

export function seedWorkflowDefinitions(
  database: DatabaseSync,
  createdAt = new Date().toISOString(),
): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        `INSERT OR IGNORE INTO business_calendars (
          id, firm_id, name, timezone, weekend_days_json, effective_from,
          effective_to, source_title, source_url, created_at
        ) VALUES (?, NULL, ?, ?, ?, '2026-01-01', '2026-12-31', ?, ?, ?)`,
      )
      .run(
        ENGLAND_WALES_2026_CALENDAR.id,
        ENGLAND_WALES_2026_CALENDAR.name,
        ENGLAND_WALES_2026_CALENDAR.timezone,
        JSON.stringify(ENGLAND_WALES_2026_CALENDAR.weekendDays),
        'UK Government bank holidays: England and Wales',
        BANK_HOLIDAYS_URL,
        createdAt,
      );

    const insertHoliday = database.prepare(
      `INSERT OR IGNORE INTO business_calendar_holidays (
        calendar_id, date, name
      ) VALUES (?, ?, ?)`,
    );
    ENGLAND_WALES_2026_CALENDAR.holidays.forEach((date, index) => {
      insertHoliday.run(
        ENGLAND_WALES_2026_CALENDAR.id,
        date,
        HOLIDAY_NAMES[index],
      );
    });

    database
      .prepare(
        `INSERT OR IGNORE INTO workflow_templates (
          id, key, name, jurisdiction, matter_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        WORKFLOW_IDS.housingTemplate,
        HOUSING_DISREPAIR_WORKFLOW.key,
        HOUSING_DISREPAIR_WORKFLOW.name,
        HOUSING_DISREPAIR_WORKFLOW.jurisdiction,
        HOUSING_DISREPAIR_WORKFLOW.matterType,
        createdAt,
      );

    database
      .prepare(
        `INSERT OR IGNORE INTO workflow_versions (
          id, template_id, version, effective_from, effective_to, status,
          definition_json, created_at
        ) VALUES (?, ?, ?, ?, NULL, 'active', ?, ?)`,
      )
      .run(
        WORKFLOW_IDS.housingVersion1,
        WORKFLOW_IDS.housingTemplate,
        HOUSING_DISREPAIR_WORKFLOW.version,
        HOUSING_DISREPAIR_WORKFLOW.effectiveFrom,
        JSON.stringify(HOUSING_DISREPAIR_WORKFLOW),
        createdAt,
      );

    const insertStage = database.prepare(
      `INSERT OR IGNORE INTO workflow_stages (
        id, workflow_version_id, key, name, position, description,
        required_checklist_json, allowed_next_stage_keys_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    HOUSING_DISREPAIR_WORKFLOW.stages.forEach((stage, index) => {
      insertStage.run(
        STAGE_IDS[index],
        WORKFLOW_IDS.housingVersion1,
        stage.key,
        stage.name,
        stage.position,
        stage.description,
        JSON.stringify(stage.requiredChecklistKeys),
        JSON.stringify(stage.allowedNextStageKeys),
      );
    });

    const insertRule = database.prepare(
      `INSERT OR IGNORE INTO deadline_rules (
        id, workflow_version_id, key, version, name, trigger_event_type,
        offset, unit, source_title, source_url, effective_from, effective_to,
        definition_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const rule of HOUSING_DISREPAIR_WORKFLOW.deadlineRules) {
      insertRule.run(
        rule.id,
        WORKFLOW_IDS.housingVersion1,
        rule.key,
        rule.version,
        rule.name,
        rule.triggerEventType,
        rule.offset,
        rule.unit,
        rule.sourceTitle,
        rule.sourceUrl,
        rule.effectiveFrom,
        rule.effectiveTo,
        JSON.stringify(rule),
      );
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
