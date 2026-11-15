// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  calendarOfJd,
  cameraCenterJd,
  cameraCenteredOn,
  cameraEndJd,
  cameraTweenAt,
  clampCamera,
  defaultCameraAround,
  EPHEMERIS_DEFAULT_SPAN_MONTHS,
  EPHEMERIS_MAX_SPAN_DAYS,
  EPHEMERIS_MIN_SPAN_DAYS,
  jdAtPlotX,
  lerpCamera,
  monthIndexOfJd,
  monthIndexStartJd,
  monthStartJd,
  normalizeEphemerisCamera,
  panCamera,
  resetZoomCamera,
  resetZoomCameraCenter,
  shiftJdByCalendarMonths,
  stepCamera,
  stepCameraCenter,
  yearCamera,
  zoomCameraAround,
} from "../src/lib/chart/ephemeris-camera";

const PLOT = 1000;

test("month starts match swe_julday at 00:00 UT (proleptic Gregorian)", () => {
  expect(monthStartJd(2000, 1)).toBe(2451544.5);
  expect(monthStartJd(2026, 3)).toBe(2461100.5);
  expect(monthStartJd(1582, 10)).toBe(2299146.5); // Oct 15 = 2299160.5
  expect(monthStartJd(-4712, 1)).toBe(37.5); // proleptic Gregorian, not Julian
  expect(calendarOfJd(2451544.5)).toEqual({ year: 2000, month: 1, day: 1 });
  expect(calendarOfJd(2451544.49)).toEqual({ year: 1999, month: 12, day: 31 });
  expect(calendarOfJd(monthStartJd(2024, 2) + 28.5)).toEqual({ year: 2024, month: 2, day: 29 });
  expect(monthIndexOfJd(monthStartJd(-1, 12))).toBe(-1);
});

test("zoom around the pointer keeps the pointer's JD fixed and clamps the span", () => {
  const camera = yearCamera(2026);
  for (const anchorX of [0, 137, 500, 999]) {
    const before = jdAtPlotX(camera, PLOT, anchorX);
    for (const factor of [0.5, 0.9, 1.1, 2.2]) {
      const zoomed = zoomCameraAround(camera, PLOT, anchorX, factor);
      expect(zoomed.spanDays).toBeCloseTo(camera.spanDays * factor, 9);
      expect(jdAtPlotX(zoomed, PLOT, anchorX)).toBeCloseTo(before, 7);
    }
  }
  const tight = zoomCameraAround(camera, PLOT, 250, 0.001);
  expect(tight.spanDays).toBe(EPHEMERIS_MIN_SPAN_DAYS);
  expect(jdAtPlotX(tight, PLOT, 250)).toBeCloseTo(jdAtPlotX(camera, PLOT, 250), 7);
  const wide = zoomCameraAround(camera, PLOT, 250, 1000);
  expect(wide.spanDays).toBe(EPHEMERIS_MAX_SPAN_DAYS);
  expect(clampCamera({ startJd: camera.startJd, spanDays: 5 }).spanDays).toBe(EPHEMERIS_MIN_SPAN_DAYS);
  expect(normalizeEphemerisCamera({ startJd: "x", spanDays: 30 })).toBeNull();
  expect(normalizeEphemerisCamera({ startJd: 2461041.5, spanDays: 99999 })?.spanDays).toBe(EPHEMERIS_MAX_SPAN_DAYS);
});

test("interpolated zoom keeps the anchor fixed every frame", () => {
  const from = yearCamera(2026);
  const to = zoomCameraAround(from, PLOT, 300, 0.25);
  const anchor = jdAtPlotX(from, PLOT, 300);
  for (const t of [0, 0.2, 0.5, 0.8, 1]) {
    expect(jdAtPlotX(lerpCamera(from, to, t), PLOT, 300)).toBeCloseTo(anchor, 7);
  }
  const tween = { from, to, startedAt: 100, durationMs: 170 };
  expect(cameraTweenAt(tween, 100).camera).toEqual(from);
  expect(cameraTweenAt(tween, 400)).toEqual({ camera: to, done: true });
});

test("pan moves content with the pointer", () => {
  const camera = yearCamera(2026);
  const panned = panCamera(camera, PLOT, 100);
  expect(panned.spanDays).toBe(camera.spanDays);
  expect(panned.startJd).toBeCloseTo(camera.startJd - camera.spanDays / 10, 9);
});

test("month and year steps land on calendar months across year boundaries", () => {
  const december = yearCamera(2026, 12);
  const january = stepCamera(december, "right");
  expect(january).toEqual(yearCamera(2027, 1));
  expect(stepCamera(yearCamera(2026, 1), "left")).toEqual(yearCamera(2025, 12));
  expect(stepCamera(yearCamera(2026, 6), "up")).toEqual(yearCamera(2027, 6));
  expect(stepCamera(yearCamera(2026, 6), "down")).toEqual(yearCamera(2025, 6));
  // Twelve calendar months stay twelve, leap year included.
  expect(stepCamera(yearCamera(2023, 3), "right").spanDays).toBe(366);
  expect(stepCamera(yearCamera(0, 1), "left")).toEqual(yearCamera(-1, 12));
  // A mid-month camera keeps its place inside the month.
  const mid = { startJd: monthStartJd(2026, 1) + 15.5, spanDays: 90 };
  const next = stepCamera(mid, "right");
  expect(calendarOfJd(next.startJd)).toEqual({ year: 2026, month: 2, day: 15 });
  expect(Math.abs(next.spanDays - 90)).toBeLessThan(2);
  // Twelve month steps equal one year step.
  let walked = mid as ReturnType<typeof stepCamera>;
  for (let i = 0; i < 12; i++) walked = stepCamera(walked, "right");
  expect(walked.startJd).toBeCloseTo(stepCamera(mid, "up").startJd, 9);
  expect(cameraEndJd(walked)).toBeCloseTo(cameraEndJd(stepCamera(mid, "up")), 9);
});

test("reset zoom returns to a month-aligned three-month plate", () => {
  expect(EPHEMERIS_DEFAULT_SPAN_MONTHS).toBe(3);
  const zoomed = zoomCameraAround(yearCamera(2026), PLOT, 750, 0.1);
  const reset = resetZoomCamera(zoomed, PLOT, 500);
  const start = calendarOfJd(reset.startJd);
  expect(start.day).toBe(1);
  const startIndex = start.year * 12 + start.month - 1;
  expect(reset.spanDays).toBe(monthIndexStartJd(startIndex + 3) - reset.startJd);
  // The anchor's date stays inside the reset plate.
  const anchorJd = jdAtPlotX(zoomed, PLOT, 500);
  expect(anchorJd).toBeGreaterThanOrEqual(reset.startJd);
  expect(anchorJd).toBeLessThanOrEqual(cameraEndJd(reset));
});

test("standard zoom opens three months around the moment", () => {
  const center = monthStartJd(2026, 11) + 13.5;
  const camera = defaultCameraAround(center);
  expect(cameraCenterJd(camera)).toBeCloseTo(center, 9);
  expect(camera.spanDays).toBeGreaterThan(89);
  expect(camera.spanDays).toBeLessThan(93);
  // A wide year zooms back to the same standard plate around its line.
  expect(resetZoomCameraCenter(cameraCenteredOn(center, 365))).toEqual(camera);
});

test("reading line: steps move the centre by calendar months, keeping day and time", () => {
  const noon14Nov = monthStartJd(2026, 11) + 13.5;
  const camera = cameraCenteredOn(noon14Nov, 120);
  expect(cameraCenterJd(camera)).toBeCloseTo(noon14Nov, 9);
  const dec = stepCameraCenter(camera, "right");
  expect(cameraCenterJd(dec)).toBeCloseTo(monthStartJd(2026, 12) + 13.5, 9);
  expect(dec.spanDays).toBe(120);
  expect(cameraCenterJd(stepCameraCenter(camera, "up"))).toBeCloseTo(monthStartJd(2027, 11) + 13.5, 9);
  expect(cameraCenterJd(stepCameraCenter(camera, "down"))).toBeCloseTo(monthStartJd(2025, 11) + 13.5, 9);
  // 31 January steps to the last day of February, same time of day.
  const jan31 = monthStartJd(2026, 1) + 30.25;
  expect(shiftJdByCalendarMonths(jan31, 1)).toBeCloseTo(monthStartJd(2026, 2) + 27.25, 9);
  expect(shiftJdByCalendarMonths(noon14Nov, -11)).toBeCloseTo(monthStartJd(2025, 12) + 13.5, 9);
});

test("reading line: zoom around the centre and reset keep the line's moment", () => {
  const center = monthStartJd(2026, 11) + 13.5;
  const camera = cameraCenteredOn(center, 365);
  const zoomed = zoomCameraAround(camera, PLOT, PLOT / 2, 0.25);
  expect(cameraCenterJd(zoomed)).toBeCloseTo(center, 9);
  expect(jdAtPlotX(zoomed, PLOT, PLOT / 2)).toBeCloseTo(center, 9);
  const reset = resetZoomCameraCenter(zoomed);
  expect(cameraCenterJd(reset)).toBeCloseTo(center, 9);
  expect(reset).toEqual(defaultCameraAround(center));
  // A drag pans time under the fixed line: the new centre is the date there.
  const panned = panCamera(camera, PLOT, -100);
  expect(cameraCenterJd(panned)).toBeCloseTo(jdAtPlotX(camera, PLOT, PLOT / 2 + 100), 9);
});
