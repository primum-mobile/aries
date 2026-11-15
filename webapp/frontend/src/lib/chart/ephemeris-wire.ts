// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris wire decoder: the one place that knows the daemon's block
// and station field names (/api/ephemeris/blocks, /api/ephemeris/stations).
// Everything downstream (store, painter, hit test) reads the typed shapes.

import type {
  EphemerisBlocksWire,
  EphemerisLunation,
  EphemerisOutOfBoundsMarker,
  EphemerisSignEvent,
  EphemerisStation,
  EphemerisYearStationsWire,
} from "@/lib/daemon/client";

/** One decoded calendar month: daily samples from `startJd` (00:00 UT on the
 * 1st), one Float64Array row per planet and field, plus the events whose JD
 * falls inside [startJd, startJd + days). */
export type EphemerisBlock = Readonly<{
  dataKey: string;
  year: number;
  month: number;
  /** year * 12 + month - 1: the block's position on the month axis. */
  monthIndex: number;
  startJd: number;
  days: number;
  planetIds: readonly number[];
  /** planet id -> row of `longitude` / `declination`. */
  rows: ReadonlyMap<number, { longitude: Float64Array; declination: Float64Array }>;
  signEvents: readonly EphemerisSignEvent[];
  declinationStations: readonly EphemerisStation[];
  lunations: readonly EphemerisLunation[];
  outOfBounds: readonly EphemerisOutOfBoundsMarker[];
  /** The block's calendar year declination scale (null when absent). */
  declinationScale: EphemerisDeclinationScale | null;
  /** Whether the daily series are here (a /series or full block). */
  curves: boolean;
  /** Whether the month's marks are here (a full or marks-only block); a
   * curves-only block has empty event lists until they are merged in. */
  marks: boolean;
  /** Resident size estimate for the store's byte budget. */
  bytes: number;
}>;

/** One calendar year's declination scale: the out-of-bounds limit (the
 * Sun's largest |declination|) and each zodiac sign's [lowest, highest]
 * declination at that obliquity, 0 = Aries, in the active zodiac. */
export type EphemerisDeclinationScale = Readonly<{
  limit: number;
  signRanges: readonly (readonly [number, number])[];
}>;

export type EphemerisStationYear = Readonly<{
  dataKey: string;
  year: number;
  longitude: readonly EphemerisStation[];
  bytes: number;
}>;

/** Rough resident cost of one decoded event object (keys, numbers, strings). */
const EVENT_BYTES = 160;

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

type Base64Decoder = (value: string) => Uint8Array;
const nativeFromBase64 = (Uint8Array as unknown as { fromBase64?: Base64Decoder }).fromBase64;

function base64Bytes(value: string): Uint8Array {
  if (nativeFromBase64) return nativeFromBase64(value);
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64 of little-endian Float64 values -> Float64Array (zero-copy view on
 * little-endian hosts). A short or malformed payload decodes to what it holds. */
export function decodeFloat64Base64(value: unknown): Float64Array {
  if (typeof value !== "string" || value.length === 0) return new Float64Array(0);
  const bytes = base64Bytes(value);
  const count = Math.floor(bytes.byteLength / 8);
  if (HOST_LITTLE_ENDIAN && bytes.byteOffset % 8 === 0) {
    return new Float64Array(bytes.buffer, bytes.byteOffset, count);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getFloat64(i * 8, true);
  return out;
}

type WireRecord = Record<string, unknown>;

const num = (value: unknown, fallback = Number.NaN): number =>
  typeof value === "number" ? value : value == null ? fallback : Number(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): WireRecord[] =>
  Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as WireRecord[]) : [];

function decodeStation(raw: WireRecord): EphemerisStation {
  return {
    planet: num(raw.planet),
    jd: num(raw.jd),
    value: num(raw.value),
    code: str(raw.code),
    date: str(raw.date),
  };
}

function decodeSignEvent(raw: WireRecord): EphemerisSignEvent {
  return {
    planet: num(raw.planet),
    jd: num(raw.jd),
    value: num(raw.value),
    targetSign: num(raw.targetSign),
    fromSign: num(raw.fromSign),
    toSign: num(raw.toSign),
    eventSign: num(raw.eventSign),
    retrograde: Boolean(raw.retrograde),
    date: str(raw.date),
  };
}

function decodeLunation(raw: WireRecord): EphemerisLunation {
  const eclipse = raw.eclipse === "solar" || raw.eclipse === "lunar" ? raw.eclipse : undefined;
  const eclipseLabel = str(raw.eclipseLabel);
  return {
    kind: raw.kind === "full" ? "full" : "new",
    jd: num(raw.jd),
    longitude: num(raw.longitude),
    declination: num(raw.declination),
    date: str(raw.date),
    ...(eclipse ? { eclipse } : {}),
    ...(eclipseLabel ? { eclipseLabel } : {}),
  };
}

function decodeOutOfBounds(raw: WireRecord): EphemerisOutOfBoundsMarker {
  return { planet: num(raw.planet), jd: num(raw.jd), value: num(raw.value) };
}

function decodeDeclinationScale(raw: unknown): EphemerisDeclinationScale | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as WireRecord;
  const limit = num(record.limit);
  const ranges = Array.isArray(record.signRanges) ? record.signRanges : [];
  const signRanges = ranges.map((range) =>
    Array.isArray(range) ? ([num(range[0]), num(range[1])] as const) : ([Number.NaN, Number.NaN] as const),
  );
  if (!Number.isFinite(limit) || signRanges.length !== 12 || signRanges.some(([lo, hi]) => !Number.isFinite(lo) || !Number.isFinite(hi))) {
    return null;
  }
  return { limit, signRanges };
}

const finiteJd = <T extends { jd: number }>(event: T) => Number.isFinite(event.jd);

/** Decode one /api/ephemeris/blocks response into month blocks. */
export function decodeEphemerisBlocks(payload: EphemerisBlocksWire): EphemerisBlock[] {
  const dataKey = str(payload.dataKey);
  const planetIds = (Array.isArray(payload.planetIds) ? payload.planetIds : []).map((id) => num(id));
  return list(payload.blocks).map((raw) => {
    const year = num(raw.year);
    const month = num(raw.month);
    const days = Math.max(0, Math.trunc(num(raw.days, 0)));
    const longitude = decodeFloat64Base64(raw.longitude);
    const declination = decodeFloat64Base64(raw.declination);
    const rows = new Map<number, { longitude: Float64Array; declination: Float64Array }>();
    planetIds.forEach((id, row) => {
      const from = row * days;
      rows.set(id, {
        longitude: longitude.subarray(Math.min(from, longitude.length), Math.min(from + days, longitude.length)),
        declination: declination.subarray(Math.min(from, declination.length), Math.min(from + days, declination.length)),
      });
    });
    const signEvents = list(raw.signEvents).map(decodeSignEvent).filter(finiteJd);
    const declinationStations = list(raw.declinationStations).map(decodeStation).filter(finiteJd);
    const lunations = list(raw.lunations).map(decodeLunation).filter(finiteJd);
    const outOfBounds = list(raw.outOfBounds).map(decodeOutOfBounds).filter(finiteJd);
    const events = signEvents.length + declinationStations.length + lunations.length + outOfBounds.length;
    return {
      dataKey,
      year,
      month,
      monthIndex: year * 12 + month - 1,
      startJd: num(raw.startJd),
      days,
      planetIds,
      rows,
      signEvents,
      declinationStations,
      lunations,
      outOfBounds,
      declinationScale: decodeDeclinationScale(raw.declinationScale),
      curves: typeof raw.longitude === "string",
      marks: Array.isArray(raw.signEvents),
      bytes: longitude.byteLength + declination.byteLength + events * EVENT_BYTES + 256,
    };
  });
}

/** A resident curves block with a marks-only block's events merged in. */
export function mergeEphemerisMarks(curves: EphemerisBlock, marks: EphemerisBlock): EphemerisBlock {
  return {
    ...curves,
    signEvents: marks.signEvents,
    declinationStations: marks.declinationStations,
    lunations: marks.lunations,
    outOfBounds: marks.outOfBounds,
    declinationScale: marks.declinationScale,
    marks: true,
    bytes: seriesBytes(curves) + markBytes(marks),
  };
}

function seriesBytes(block: EphemerisBlock): number {
  let bytes = 256;
  for (const row of block.rows.values()) bytes += row.longitude.byteLength + row.declination.byteLength;
  return bytes;
}

function markBytes(block: EphemerisBlock): number {
  const events = block.signEvents.length + block.declinationStations.length + block.lunations.length + block.outOfBounds.length;
  return events * EVENT_BYTES;
}

/** Decode one /api/ephemeris/stations?year= response. */
export function decodeEphemerisStationYear(payload: EphemerisYearStationsWire): EphemerisStationYear {
  const longitude = list(payload.longitude).map(decodeStation).filter(finiteJd);
  return {
    dataKey: str(payload.dataKey),
    year: num(payload.year),
    longitude,
    bytes: longitude.length * EVENT_BYTES + 128,
  };
}
