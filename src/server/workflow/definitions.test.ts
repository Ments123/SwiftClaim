import { describe, expect, it } from 'vitest';

import { HOUSING_DISREPAIR_WORKFLOW } from './definitions.js';

describe('protocol and expert workflow definitions', () => {
  it('defines the confirmed report deadlines with the correct time units', () => {
    const ruleFor = (trigger: string) =>
      HOUSING_DISREPAIR_WORKFLOW.deadlineRules.find(
        ({ triggerEventType }) => triggerEventType === trigger,
      );

    expect(ruleFor('expert.report.received')).toMatchObject({
      key: 'housing.protocol.substantive_response',
      offset: 20,
      unit: 'working_days',
    });
    expect(ruleFor('expert.report.served_cpr35')).toMatchObject({
      key: 'housing.expert.clarification_questions',
      offset: 28,
      unit: 'calendar_days',
    });
  });
});
