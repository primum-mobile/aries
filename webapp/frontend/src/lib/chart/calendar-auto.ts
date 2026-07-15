// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type CalendarAutoPolicy = {
  cutover: { year: number; month: number; day: number };
  before: string;
  from: string;
};

export type CalendarDateFields = {
  bc: boolean;
  year: string | number;
  month: string | number;
  day: string | number;
};

function integerField(value: string | number): number | null {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function automaticCalendarForDate(
  fields: CalendarDateFields,
  policy: CalendarAutoPolicy,
): string | null {
  const year = integerField(fields.year);
  const month = integerField(fields.month);
  const day = integerField(fields.day);
  if (year === null || year < 1 || month === null || month < 1 || month > 12) return null;
  if (day === null || day < 1 || day > 31) return null;
  if (fields.bc) return policy.before;

  const value = [year, month, day];
  const cutover = [policy.cutover.year, policy.cutover.month, policy.cutover.day];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] < cutover[index]) return policy.before;
    if (value[index] > cutover[index]) return policy.from;
  }
  return policy.from;
}

export function calendarAfterDateChange(
  fields: CalendarDateFields,
  policy: CalendarAutoPolicy,
  currentCalendar: string,
  manualOverride: boolean,
): string {
  if (manualOverride) return currentCalendar;
  return automaticCalendarForDate(fields, policy) ?? currentCalendar;
}
