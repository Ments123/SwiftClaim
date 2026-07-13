export type DeadlineUnit = 'calendar_days' | 'working_days';

export interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
  weekendDays: readonly number[];
  holidays: readonly string[];
}

export interface DeadlineRule {
  id: string;
  key: string;
  version: number;
  name: string;
  triggerEventType: string;
  offset: number;
  unit: DeadlineUnit;
  direction: 'after';
  sourceTitle: string;
  sourceUrl: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface DeadlineCalculation {
  triggerEventId: string;
  triggerDate: string;
  dueDate: string;
  rule: DeadlineRule;
  calendarId: string;
  explanation: string;
  excludedDates: string[];
}

export interface WorkflowStageDefinition {
  key: string;
  name: string;
  position: number;
  description: string;
  requiredChecklistKeys: readonly string[];
}

export interface WorkflowDefinition {
  key: string;
  version: number;
  name: string;
  jurisdiction: 'england';
  matterType: 'housing_conditions_claimant';
  effectiveFrom: string;
  stages: readonly WorkflowStageDefinition[];
  deadlineRules: readonly DeadlineRule[];
}
