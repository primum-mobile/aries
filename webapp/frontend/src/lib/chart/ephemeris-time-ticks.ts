// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris time ruler: the tick ladder adapts continuously with the
// camera — daily ticks and numbers, fifth days, 11th/21st, months, quarters,
// years — each level shown only while it stays legible, and labels never
// collide. At a twelve-month month-aligned camera it reproduces the classic
// plate (month names on their first-day tick, the year under the first month
// and under every January).

import {
  calendarOfJd,
  monthIndexOfJd,
  monthIndexStartJd,
  monthIndexYearMonth,
  type EphemerisCamera,
} from "./ephemeris-camera";
import type { RuleLevel } from "./ephemeris-geometry";

export type TimeTick = Readonly<{ x: number; level: RuleLevel }>;
export type TimeLabel = Readonly<{
  x: number;
  text: string;
  row: "month" | "year";
  /** "text" = month/year names (plate text size), "ruler" = day numbers. */
  font: "text" | "ruler";
  width: number;
}>;

export type TimeRuler = Readonly<{
  ticks: readonly TimeTick[];
  labels: readonly TimeLabel[];
  /** Dashed in-plot month lines (Show grid). */
  gridXs: readonly number[];
  level: TimeRulerLevel;
}>;

/** The coarsest legible unit the ruler labels, for tests and the hover. */
export type TimeRulerLevel = "days" | "five-days" | "months" | "quarters" | "years";

export type TimeRulerInput = Readonly<{
  camera: EphemerisCamera;
  xOrig: number;
  plotWidth: number;
  /** Jan..Dec abbreviations. */
  monthLabels: readonly string[];
  /** Width of `text` at the plate text size / the ruler label size. */
  measureText: (text: string) => number;
  measureRuler: (text: string) => number;
  minSpacing: number;
  /** Two neighbouring centred labels need their widths plus this gap. */
  labelGap: number;
}>;

export type MonthBoundary = { level: RuleLevel; label: boolean } | null;

/** Month boundary levels on the time ruler. While every month name fits, each
 * month start is a major tick (the 12-month plate). Zoomed out, years stay
 * major, quarters medium and other months minor, each only while legible. */
export function monthBoundaryLevel(
  calendarMonth: number,
  pxPerMonth: number,
  labelRoom: number,
  minSpacing: number,
): MonthBoundary {
  if (pxPerMonth >= labelRoom) return { level: "major", label: true };
  if (calendarMonth === 1) return { level: "major", label: true };
  if ((calendarMonth - 1) % 3 === 0) {
    if (pxPerMonth * 3 >= labelRoom) return { level: "medium", label: true };
    return pxPerMonth * 3 >= minSpacing ? { level: "medium", label: false } : null;
  }
  return pxPerMonth >= minSpacing ? { level: "minor", label: false } : null;
}

/** Day ruler levels inside one month: 11th/21st, every fifth day, each day.
 * A fifth-day tick right before the next month start falls back to a day tick. */
export function dayLevel(dayIndex: number, daysLeft: number, pxPerDay: number, minSpacing: number): RuleLevel | null {
  const fine = pxPerDay >= minSpacing ? "fine" : null;
  if (dayIndex === 10 || dayIndex === 20) {
    return pxPerDay * 10 >= minSpacing ? "medium" : fine;
  }
  if (dayIndex % 5 === 0 && daysLeft >= 3) {
    return pxPerDay * 5 >= minSpacing ? "minor" : fine;
  }
  return fine;
}

const MEAN_MONTH_DAYS = 365.2425 / 12;

export function monthLabelRoom(monthLabels: readonly string[], measureText: (text: string) => number, labelGap: number) {
  return Math.max(0, ...monthLabels.map((label) => measureText(label))) + labelGap;
}

/** Which unit the ruler labels at a scale (px per day). */
export function timeRulerLevel(
  pxPerDay: number,
  labelRoom: number,
  dayLabelRoom: number,
): TimeRulerLevel {
  if (pxPerDay >= dayLabelRoom) return "days";
  if (pxPerDay * 5 >= dayLabelRoom) return "five-days";
  const pxPerMonth = pxPerDay * MEAN_MONTH_DAYS;
  if (pxPerMonth >= labelRoom) return "months";
  if (pxPerMonth * 3 >= labelRoom) return "quarters";
  return "years";
}

/** Keep labels in priority order while their boxes (plus the gap) stay apart. */
function withoutCollisions(labels: Array<TimeLabel & { priority: number }>, gap: number): TimeLabel[] {
  const kept: Record<TimeLabel["row"], Array<[number, number]>> = { month: [], year: [] };
  const out: TimeLabel[] = [];
  const ordered = labels.map((label, order) => ({ label, order })).sort(
    (a, b) => a.label.priority - b.label.priority || a.order - b.order,
  );
  for (const { label } of ordered) {
    const left = label.x - label.width / 2 - gap / 2;
    const right = label.x + label.width / 2 + gap / 2;
    const row = kept[label.row];
    if (row.some(([l, r]) => left < r && right > l)) continue;
    row.push([left, right]);
    const { priority: _priority, ...plain } = label;
    void _priority;
    out.push(plain);
  }
  return out;
}

export function buildTimeRuler(input: TimeRulerInput): TimeRuler {
  const { camera, xOrig, plotWidth, monthLabels, minSpacing, labelGap } = input;
  const pxPerDay = plotWidth / Math.max(1e-9, camera.spanDays);
  const pxPerMonth = pxPerDay * MEAN_MONTH_DAYS;
  const room = monthLabelRoom(monthLabels, input.measureText, labelGap);
  const dayLabelW = input.measureRuler("30");
  const dayLabelRoom = dayLabelW + labelGap;
  const dayLabelEvery = pxPerDay >= dayLabelRoom ? 1 : pxPerDay * 5 >= dayLabelRoom ? 5 : 0;
  const gridEveryMonth = pxPerMonth >= room;
  const xOf = (jd: number) => xOrig + (jd - camera.startJd) * pxPerDay;
  const left = xOrig - 0.5;
  const right = xOrig + plotWidth + 0.5;
  const endJd = camera.startJd + camera.spanDays;

  const ticks: TimeTick[] = [];
  const labels: Array<TimeLabel & { priority: number }> = [];
  const gridXs: number[] = [];
  const first = monthIndexOfJd(camera.startJd);
  const last = monthIndexOfJd(endJd);
  const monthName = (index: number) => monthLabels[monthIndexYearMonth(index).month - 1] ?? "";
  const boundaryOf = (index: number) =>
    monthBoundaryLevel(monthIndexYearMonth(index).month, pxPerMonth, room, minSpacing);
  const anyDayLevel = pxPerDay * 10 >= minSpacing;

  let firstBoundary: { index: number; x: number; boundary: NonNullable<MonthBoundary> } | null = null;
  let firstJanuaryX: number | null = null;
  for (let index = first; index <= last + 1; index++) {
    const startJd = monthIndexStartJd(index);
    const x = xOf(startJd);
    const boundary = boundaryOf(index);
    const nextStart = monthIndexStartJd(index + 1);
    const monthDays = nextStart - startJd;
    if (x >= left && x <= right && boundary) {
      ticks.push({ x, level: boundary.level });
      if (!firstBoundary) firstBoundary = { index, x, boundary };
      if (boundary.label) {
        const text = monthName(index);
        labels.push({ x, text, row: "month", font: "text", width: input.measureText(text), priority: boundary.level === "major" ? 0 : 1 });
        if (monthIndexYearMonth(index).month === 1 && firstBoundary.index !== index) {
          if (firstJanuaryX == null) firstJanuaryX = x;
          const year = String(monthIndexYearMonth(index).year);
          labels.push({ x, text: year, row: "year", font: "text", width: input.measureText(year), priority: 0 });
        }
      }
      if (x > xOrig + 0.5 && x < xOrig + plotWidth - 0.5 && (gridEveryMonth || boundary.level !== "minor")) {
        gridXs.push(x);
      }
    }
    if (!anyDayLevel || index > last) continue;
    // Day ticks hang from the baseline; day numbers stay clear of month names.
    const labelHalf = (i: number) => {
      const b = boundaryOf(i);
      return b?.label ? input.measureText(monthName(i)) / 2 : 0;
    };
    const startHalf = labelHalf(index);
    const endHalf = labelHalf(index + 1);
    // A day number keeps one label of air from a month name, so none sits
    // right against it ("26 dec 6").
    const clearance = dayLabelW * 1.5 + labelGap;
    const dFrom = Math.max(1, Math.floor(camera.startJd - startJd));
    const dTo = Math.min(monthDays - 1, Math.ceil(endJd - startJd));
    for (let d = dFrom; d <= dTo; d++) {
      const level = dayLevel(d, monthDays - d, pxPerDay, minSpacing);
      if (!level) continue;
      const dx = xOf(startJd + d);
      if (dx < left || dx > right) continue;
      ticks.push({ x: dx, level });
      if (!dayLabelEvery || (dayLabelEvery === 5 && d % 5 !== 0)) continue;
      if (d * pxPerDay < startHalf + clearance) continue;
      if ((monthDays - d) * pxPerDay < endHalf + clearance) continue;
      const text = String(d + 1);
      labels.push({ x: dx, text, row: "month", font: "ruler", width: dayLabelW, priority: 2 });
    }
  }

  // The first boundary names its year unless a January label crowds it.
  if (firstBoundary) {
    const { index, x, boundary } = firstBoundary;
    const january = firstJanuaryX;
    if (boundary.label || january == null || january - x >= room * 2) {
      const year = String(monthIndexYearMonth(index).year);
      labels.push({ x, text: year, row: "year", font: "text", width: input.measureText(year), priority: 0 });
    }
  } else if (plotWidth > 0) {
    // No boundary in view (zoomed into one month): name the year at the start.
    const year = String(calendarOfJd(camera.startJd).year);
    labels.push({ x: xOrig, text: year, row: "year", font: "text", width: input.measureText(year), priority: 1 });
  }

  return {
    ticks,
    labels: withoutCollisions(labels, labelGap),
    gridXs,
    level: timeRulerLevel(pxPerDay, room, dayLabelRoom),
  };
}
