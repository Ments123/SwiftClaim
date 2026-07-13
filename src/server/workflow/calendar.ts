import type {
  BusinessCalendar,
  DeadlineCalculation,
  DeadlineRule,
} from './types.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string, field: string): Date {
  if (!DATE_ONLY.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (formatDateOnly(date) !== value) {
    throw new Error(`${field} is not a valid date`);
  }
  return date;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(value, 'date'));
}

export function isWorkingDay(
  value: string,
  calendar: BusinessCalendar,
): boolean {
  const date = parseDateOnly(value, 'date');
  return (
    !calendar.weekendDays.includes(date.getUTCDay()) &&
    !calendar.holidays.includes(value)
  );
}

export function calculateDeadline(input: {
  triggerDate: string;
  triggerEventId: string;
  rule: DeadlineRule;
  calendar: BusinessCalendar;
}): DeadlineCalculation {
  const cursor = parseDateOnly(input.triggerDate, 'triggerDate');
  const excludedDates: string[] = [];
  let counted = 0;

  while (counted < input.rule.offset) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const value = formatDateOnly(cursor);
    if (
      input.rule.unit === 'working_days' &&
      !isWorkingDay(value, input.calendar)
    ) {
      excludedDates.push(value);
      continue;
    }
    counted += 1;
  }

  const dueDate = formatDateOnly(cursor);
  const holidayCount = excludedDates.filter((date) =>
    input.calendar.holidays.includes(date),
  ).length;

  return {
    triggerEventId: input.triggerEventId,
    triggerDate: input.triggerDate,
    dueDate,
    rule: input.rule,
    calendarId: input.calendar.id,
    excludedDates,
    explanation: `${input.rule.offset} ${input.rule.unit.replace('_', ' ')} after ${displayDate(input.triggerDate)} is ${displayDate(dueDate)}; weekends and ${holidayCount} configured holiday${holidayCount === 1 ? '' : 's'} excluded.`,
  };
}
