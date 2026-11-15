// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type DateConvention = "current" | "dmy";

export function coerceDateConvention(value: unknown): DateConvention {
  return value === "dmy" || value === "euro" ? "dmy" : "current";
}

export function formatDateTriple(
  values: [number, number, number],
  convention: DateConvention = "current",
): string {
  const [year, month, day] = values;
  const yy = year < 0 ? `-${String(-year).padStart(3, "0")}` : String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return convention === "dmy" ? `${dd}.${mm}.${yy}` : `${yy}-${mm}-${dd}`;
}

export function formatIsoDateDisplay(value: string, convention: DateConvention = "current"): string {
  const [date] = value.split("T");
  const fields = parseIsoDateTriple(date);
  return fields ? formatDateTriple(fields, convention) : value;
}

/** The chart UI writes a negative civil BC year; the engine includes year zero. */
export function astronomicalToCivilYear(year: number): number {
  return year <= 0 ? year - 1 : year;
}

export function civilToAstronomicalYear(year: number): number {
  return year < 0 ? year + 1 : year;
}

export function formatAstronomicalDateTriple(
  [year, month, day]: [number, number, number],
  convention: DateConvention = "current",
): string {
  return year <= 0
    ? `-${formatDateTriple([1 - year, month, day], convention)}`
    : formatDateTriple([year, month, day], convention);
}

/** Daemon dates use astronomical years: zero is 1 BC. */
export function parseIsoDateTriple(value: string | null): [number, number, number] | null {
  const match = value?.match(/^([+-]?\d+)-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const fields = match.slice(1).map(Number);
  const [year, month, day] = fields;
  if (!fields.every(Number.isSafeInteger) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

export function formatIsoDateTimeDisplay(value: string, convention: DateConvention = "current"): string {
  const [date, time = ""] = value.split("T");
  const dateLabel = date ? formatIsoDateDisplay(date, convention) : value;
  const timeLabel = time.slice(0, 8);
  return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
}

export function parseDateDisplayInput(
  value: string,
  convention: DateConvention = "current",
  options: { partial?: boolean } = {},
): string | null {
  const text = value.trim();
  if (!text) return null;

  // Fast range jumps: a bare year ("1991") or year and month ("1991-05",
  // "05.1991" under dmy) resolves to the first day of that period.
  if (options.partial) {
    const year = text.match(/^(\d{4})$/);
    if (year) return validDateToIso(Number(year[1]), 1, 1);
    const ym = text.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (ym) return validDateToIso(Number(ym[1]), Number(ym[2]), 1);
    if (convention === "dmy") {
      const my = text.match(/^(\d{1,2})[-/.](\d{4})$/);
      if (my) return validDateToIso(Number(my[2]), Number(my[1]), 1);
    }
  }

  const ymd = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    return validDateToIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  if (convention === "dmy") {
    const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmy) {
      return validDateToIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    }
  }

  return null;
}

function validDateToIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
