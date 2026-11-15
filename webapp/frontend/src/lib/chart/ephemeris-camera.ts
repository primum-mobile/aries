// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris camera: a continuous time viewport (left-edge JD + visible
// days) over the daemon's calendar-month blocks. Pure maths only — the view
// keeps the camera in refs and repaints per animation frame.
//
// Calendar: proleptic Gregorian at 00:00 UT, the daemon's _month_jd
// (swe_julday(year, month, 1, 0, SE_GREG_CAL)).

export type EphemerisCamera = Readonly<{ startJd: number; spanDays: number }>;

/** Visible time span limits: four weeks to ten years. */
export const EPHEMERIS_MIN_SPAN_DAYS = 28;
export const EPHEMERIS_MAX_SPAN_DAYS = 3653;
/** The standard zoom: three calendar months, how the plate opens and what
 * Reset zoom (0) returns to. Read best at the default 45° modulus. */
export const EPHEMERIS_DEFAULT_SPAN_MONTHS = 3;
/** Months the arrows move by (calendar arithmetic on both camera edges). */
export const EPHEMERIS_STEP_MONTHS = { left: -1, right: 1, down: -12, up: 12 } as const;
export type EphemerisStepKey = keyof typeof EPHEMERIS_STEP_MONTHS;
/** Keep the camera inside years -9999..9999 so calendar maths stays exact. */
const MIN_MONTH_INDEX = -9999 * 12;
const MAX_MONTH_INDEX = 9999 * 12;
const MEAN_MONTH_DAYS = 365.2425 / 12;

/** JD (00:00 UT) of the 1st of `month` (1..12) in `year`, proleptic Gregorian. */
export function monthStartJd(year: number, month: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn =
    1 + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return jdn - 0.5;
}

/** Month index (year * 12 + month - 1) -> JD of its first day. */
export function monthIndexStartJd(index: number): number {
  const year = Math.floor(index / 12);
  return monthStartJd(year, index - year * 12 + 1);
}

export function monthIndexYearMonth(index: number): { year: number; month: number } {
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

export function monthIndexDays(index: number): number {
  return monthIndexStartJd(index + 1) - monthIndexStartJd(index);
}

/** The month index whose [start, next start) contains `jd`. */
export function monthIndexOfJd(jd: number): number {
  let index = Math.floor((jd - monthStartJd(0, 1)) / MEAN_MONTH_DAYS);
  while (monthIndexStartJd(index) > jd) index--;
  while (monthIndexStartJd(index + 1) <= jd) index++;
  return index;
}

/** Calendar date of `jd` (proleptic Gregorian, UT). */
export function calendarOfJd(jd: number): { year: number; month: number; day: number } {
  const index = monthIndexOfJd(jd);
  const { year, month } = monthIndexYearMonth(index);
  return { year, month, day: Math.floor(jd - monthIndexStartJd(index)) + 1 };
}

/** `jd` as (month index, fraction of that month elapsed). */
function monthPosition(jd: number): { index: number; fraction: number } {
  const index = monthIndexOfJd(jd);
  const start = monthIndexStartJd(index);
  return { index, fraction: (jd - start) / (monthIndexStartJd(index + 1) - start) };
}

function atMonthPosition(index: number, fraction: number): number {
  const start = monthIndexStartJd(index);
  return start + fraction * (monthIndexStartJd(index + 1) - start);
}

/** Move a JD by whole calendar months, keeping its position inside the month. */
export function shiftJdByMonths(jd: number, months: number): number {
  const position = monthPosition(jd);
  return atMonthPosition(position.index + months, position.fraction);
}

export function clampSpanDays(spanDays: number): number {
  if (!Number.isFinite(spanDays)) return 365;
  return Math.min(EPHEMERIS_MAX_SPAN_DAYS, Math.max(EPHEMERIS_MIN_SPAN_DAYS, spanDays));
}

const MIN_START_JD = monthIndexStartJd(MIN_MONTH_INDEX);
const MAX_START_JD = monthIndexStartJd(MAX_MONTH_INDEX);

export function clampCamera(camera: EphemerisCamera): EphemerisCamera {
  const spanDays = clampSpanDays(camera.spanDays);
  const raw = Number.isFinite(camera.startJd) ? camera.startJd : monthStartJd(2000, 1);
  const startJd = Math.min(MAX_START_JD - spanDays, Math.max(MIN_START_JD, raw));
  return startJd === camera.startJd && spanDays === camera.spanDays ? camera : { startJd, spanDays };
}

/** Twelve calendar months from January of `year`: the classic plate. */
export function yearCamera(year: number, month = 1): EphemerisCamera {
  const index = year * 12 + month - 1;
  const startJd = monthIndexStartJd(index);
  return { startJd, spanDays: monthIndexStartJd(index + 12) - startJd };
}

/** A stored camera ({startJd, spanDays}) or null when it is unusable. */
export function normalizeEphemerisCamera(value: unknown): EphemerisCamera | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { startJd?: unknown; spanDays?: unknown };
  const startJd = Number(raw.startJd);
  const spanDays = Number(raw.spanDays);
  if (!Number.isFinite(startJd) || !Number.isFinite(spanDays) || spanDays <= 0) return null;
  return clampCamera({ startJd, spanDays });
}

export function cameraEndJd(camera: EphemerisCamera): number {
  return camera.startJd + camera.spanDays;
}

/** JD under plot x (0 = plot origin, plotWidth = right plot edge). */
export function jdAtPlotX(camera: EphemerisCamera, plotWidth: number, x: number): number {
  return camera.startJd + (x / Math.max(1, plotWidth)) * camera.spanDays;
}

/** Scale the span by `factor` (>1 zooms out) around plot x `anchorX`: the JD
 * under the anchor stays under it, unless the span is clamped. */
export function zoomCameraAround(
  camera: EphemerisCamera,
  plotWidth: number,
  anchorX: number,
  factor: number,
): EphemerisCamera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const fraction = Math.min(1, Math.max(0, anchorX / Math.max(1, plotWidth)));
  const anchorJd = camera.startJd + fraction * camera.spanDays;
  const spanDays = clampSpanDays(camera.spanDays * factor);
  return clampCamera({ startJd: anchorJd - fraction * spanDays, spanDays });
}

/** Drag/scroll pan: content follows the pointer, so +dx shows earlier dates. */
export function panCamera(camera: EphemerisCamera, plotWidth: number, dxPx: number): EphemerisCamera {
  return clampCamera({
    startJd: camera.startJd - (dxPx / Math.max(1, plotWidth)) * camera.spanDays,
    spanDays: camera.spanDays,
  });
}

/** One arrow step: both edges move by calendar months, so a month-aligned
 * plate stays month-aligned (twelve calendar months stay twelve). */
export function stepCamera(camera: EphemerisCamera, key: EphemerisStepKey, repeat = 1): EphemerisCamera {
  const months = EPHEMERIS_STEP_MONTHS[key] * repeat;
  const startJd = shiftJdByMonths(camera.startJd, months);
  const endJd = shiftJdByMonths(cameraEndJd(camera), months);
  return clampCamera({ startJd, spanDays: endJd - startJd });
}

/** Reset zoom: the standard span of calendar months starting at the month
 * boundary nearest to where that span would start around the anchor. */
export function resetZoomCamera(camera: EphemerisCamera, plotWidth: number, anchorX: number): EphemerisCamera {
  const fraction = Math.min(1, Math.max(0, anchorX / Math.max(1, plotWidth)));
  const anchorJd = camera.startJd + fraction * camera.spanDays;
  const approxStart = anchorJd - fraction * EPHEMERIS_DEFAULT_SPAN_MONTHS * MEAN_MONTH_DAYS;
  let index = monthIndexOfJd(approxStart);
  if (approxStart - monthIndexStartJd(index) > monthIndexDays(index) / 2) index += 1;
  const startJd = monthIndexStartJd(index);
  return clampCamera({ startJd, spanDays: monthIndexStartJd(index + EPHEMERIS_DEFAULT_SPAN_MONTHS) - startJd });
}

/** The camera's centre: where the reading line stands, and the ephemeris
 * document's current moment (the daemon centres the camera on the cursor). */
export function cameraCenterJd(camera: EphemerisCamera): number {
  return camera.startJd + camera.spanDays / 2;
}

/** The camera of this span with `jd` at its centre. */
export function cameraCenteredOn(jd: number, spanDays: number): EphemerisCamera {
  const span = clampSpanDays(spanDays);
  return clampCamera({ startJd: jd - span / 2, spanDays: span });
}

/** Move a JD by whole calendar months keeping its day of the month and time
 * of day (UT), the day clamped to the target month's last (31 Jan -> 28 Feb),
 * as a chart's month step does. */
export function shiftJdByCalendarMonths(jd: number, months: number): number {
  const index = monthIndexOfJd(jd);
  const offset = jd - monthIndexStartJd(index);
  const day = Math.floor(offset);
  const target = index + months;
  return monthIndexStartJd(target) + Math.min(day, monthIndexDays(target) - 1) + (offset - day);
}

/** One arrow step with the reading line: the centre (the current moment)
 * moves by calendar months (14 November 12:00 -> 14 December 12:00), the span
 * stays, so the plate slides under a fixed line. */
export function stepCameraCenter(camera: EphemerisCamera, key: EphemerisStepKey, repeat = 1): EphemerisCamera {
  const months = EPHEMERIS_STEP_MONTHS[key] * repeat;
  return cameraCenteredOn(shiftJdByCalendarMonths(cameraCenterJd(camera), months), camera.spanDays);
}

/** The standard camera with `jd` on the reading line: the standard span of
 * calendar months around it (the mean of that many months either side, so
 * the span follows the actual month lengths there). */
export function defaultCameraAround(jd: number): EphemerisCamera {
  const months = EPHEMERIS_DEFAULT_SPAN_MONTHS;
  return cameraCenteredOn(jd, (shiftJdByMonths(jd, months) - shiftJdByMonths(jd, -months)) / 2);
}

/** Reset zoom with the reading line: the standard span around the centre,
 * which stays on the line. */
export function resetZoomCameraCenter(camera: EphemerisCamera): EphemerisCamera {
  return defaultCameraAround(cameraCenterJd(camera));
}

export function camerasEqual(a: EphemerisCamera | null, b: EphemerisCamera | null, epsilon = 1e-9): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.startJd - b.startJd) <= epsilon && Math.abs(a.spanDays - b.spanDays) <= epsilon;
}

/** Interpolate both edges, so an anchored zoom keeps its anchor every frame. */
export function lerpCamera(from: EphemerisCamera, to: EphemerisCamera, t: number): EphemerisCamera {
  const startJd = from.startJd + (to.startJd - from.startJd) * t;
  const endJd = cameraEndJd(from) + (cameraEndJd(to) - cameraEndJd(from)) * t;
  return { startJd, spanDays: endJd - startJd };
}

export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/** A short eased camera move; retargeting starts from the shown camera. */
export type EphemerisCameraTween = Readonly<{
  from: EphemerisCamera;
  to: EphemerisCamera;
  startedAt: number;
  durationMs: number;
}>;

export const EPHEMERIS_TWEEN_MS = 170;
/** A step is a clockwork tick, not a glide: a few frames that leave fast and
 * stop hard (ease-out quart), just enough to link the two views. */
export const EPHEMERIS_TICK_MS = 0;

function easeOutQuart(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u * u;
}

export function cameraTweenAt(tween: EphemerisCameraTween, now: number): { camera: EphemerisCamera; done: boolean } {
  const t = tween.durationMs <= 0 ? 1 : (now - tween.startedAt) / tween.durationMs;
  if (t >= 1) return { camera: tween.to, done: true };
  const eased = tween.durationMs <= EPHEMERIS_TICK_MS ? easeOutQuart(t) : easeOutCubic(t);
  return { camera: lerpCamera(tween.from, tween.to, eased), done: false };
}
