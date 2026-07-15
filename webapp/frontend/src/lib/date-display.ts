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
  const yy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return convention === "dmy" ? `${dd}.${mm}.${yy}` : `${yy}-${mm}-${dd}`;
}

export function formatIsoDateDisplay(value: string, convention: DateConvention = "current"): string {
  const [date] = value.split("T");
  const parts = date.split("-");
  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10);
  const day = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return value;
  return formatDateTriple([year, month, day], convention);
}

export function formatIsoDateTimeDisplay(value: string, convention: DateConvention = "current"): string {
  const [date, time = ""] = value.split("T");
  const dateLabel = date ? formatIsoDateDisplay(date, convention) : value;
  const timeLabel = time.slice(0, 8);
  return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
}

export function parseDateDisplayInput(value: string, convention: DateConvention = "current"): string | null {
  const text = value.trim();
  if (!text) return null;

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
