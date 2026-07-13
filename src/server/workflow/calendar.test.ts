import { describe, expect, it } from 'vitest';

import { calculateDeadline, isWorkingDay } from './calendar.js';
import type { BusinessCalendar, DeadlineRule } from './types.js';

const calendar: BusinessCalendar = {
  id: 'england-wales-2026',
  name: 'England and Wales 2026',
  timezone: 'Europe/London',
  weekendDays: [0, 6],
  holidays: ['2026-08-31', '2026-12-25', '2026-12-28'],
};

const rule: DeadlineRule = {
  id: 'protocol-response-v1',
  key: 'housing.protocol.landlord_response',
  version: 1,
  name: 'Landlord response to Letter of Claim',
  triggerEventType: 'letter_of_claim.received',
  offset: 20,
  unit: 'working_days',
  direction: 'after',
  sourceTitle:
    'Pre-Action Protocol for Housing Conditions Claims (England), 6.2',
  sourceUrl:
    'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
  effectiveFrom: '2021-08-19',
  effectiveTo: null,
};

describe('working-day deadlines', () => {
  it('recognises weekends and configured holidays', () => {
    expect(isWorkingDay('2026-08-28', calendar)).toBe(true);
    expect(isWorkingDay('2026-08-29', calendar)).toBe(false);
    expect(isWorkingDay('2026-08-31', calendar)).toBe(false);
  });

  it('counts from the next day and skips weekends and holidays', () => {
    const result = calculateDeadline({
      triggerDate: '2026-08-03',
      triggerEventId: 'event-1',
      rule,
      calendar,
    });

    expect(result.dueDate).toBe('2026-09-01');
    expect(result.explanation).toContain(
      '20 working days after 3 August 2026',
    );
    expect(result.explanation).toContain('1 configured holiday');
  });

  it('does not mutate the source rule or calendar', () => {
    const frozenRule = Object.freeze({ ...rule });
    const frozenCalendar = Object.freeze({
      ...calendar,
      holidays: Object.freeze([...calendar.holidays]),
    });

    expect(() =>
      calculateDeadline({
        triggerDate: '2026-07-13',
        triggerEventId: 'event-2',
        rule: frozenRule,
        calendar: frozenCalendar,
      }),
    ).not.toThrow();
  });

  it('rejects an invalid date-only trigger', () => {
    expect(() =>
      calculateDeadline({
        triggerDate: '13/07/2026',
        triggerEventId: 'event-3',
        rule,
        calendar,
      }),
    ).toThrow('triggerDate must be YYYY-MM-DD');
  });

  it('rejects impossible ISO-looking dates', () => {
    expect(() => isWorkingDay('2026-02-30', calendar)).toThrow(
      'date is not a valid date',
    );
  });
});
