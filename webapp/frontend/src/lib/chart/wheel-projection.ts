// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Angular model of the wheel: how an ecliptic longitude becomes a drawing
 * longitude.
 *
 * `wheel-layout-model.ts` owns the RADIAL structure (which band sits where).
 * This module owns the orthogonal ANGULAR question, which until now had a
 * single hard-coded answer: longitude maps to angle linearly, so a sign always
 * owns exactly 30 degrees of the circle and house wedges come out unequal.
 *
 * A `WheelProjection` makes that answer pluggable. `IDENTITY_PROJECTION`
 * reproduces the linear map bit-for-bit; `houseWheelProjection` gives every
 * house exactly 30 degrees of the drawing and stretches or compresses the
 * zodiac to follow — the convention Astrodienst ships as the "Huber House
 * Chart" ("All houses same size, signs of the zodiac either lengthened or
 * shortened") and Solar Fire/Astro Gold ship as "Proportional Houses" off.
 *
 * Note the two families differ in more than presentation. Solar Fire's
 * non-proportional wheel RELOCATES each planet into its house wedge, so the
 * glyph is no longer at its true angle; the projection here REMAPS the whole
 * plane continuously, so every body, aspect chord, tick and cusp stays exact
 * in the mapped space. See `doc/ui-specs/wheel-style-conventions-research.md`.
 *
 * Consumers pass a `WheelFrame` (rotation + projection) wherever the renderer
 * used to pass a bare ascendant rotation; `polar()` in `canvas-draw.ts` still
 * accepts a plain number, so callers outside the wheel are unaffected.
 */

export interface WheelProjection {
  /** Stable identity for render caches. */
  readonly id: string;
  /** True when `project` is the identity map (the zodiac-fixed wheel). */
  readonly isIdentity: boolean;
  /** Ecliptic longitude -> drawing longitude, both in degrees. */
  project(longitude: number): number;
  /** Drawing longitude -> ecliptic longitude. Inverse of `project`. */
  unproject(drawn: number): number;
}

/** The frame a wheel is drawn in: where 0 sits, and how longitudes map. */
export interface WheelFrame {
  /** Longitude placed at the canvas left edge (the wx `asc` rotation). */
  readonly rotation: number;
  readonly projection: WheelProjection;
}

const HOUSE_SPAN = 30;

function normalize(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export const IDENTITY_PROJECTION: WheelProjection = Object.freeze({
  id: "identity",
  isIdentity: true,
  project: (longitude: number) => longitude,
  unproject: (drawn: number) => drawn,
});

/** The zodiac-fixed frame every wheel used before projections existed. */
export function identityFrame(rotation: number): WheelFrame {
  return { rotation, projection: IDENTITY_PROJECTION };
}

/**
 * Piecewise-linear map giving each house exactly 30 degrees of the drawing.
 *
 * `cusps` are the 12 house cusp longitudes in wheel order (house 1 first).
 * `anchor` is the drawing longitude assigned to cusp 1 — pass the wheel's
 * rotation to seat house 1 at the canvas left edge, which is what a
 * house-centred wheel wants: the house frame IS the frame, and the Ascendant
 * lands wherever the houses put it (they coincide in every house system whose
 * first cusp is the Ascendant).
 *
 * Returns the identity projection when the cusps cannot define a monotonic
 * ring — degenerate data must not silently produce a scrambled wheel.
 */
export function houseWheelProjection(
  cusps: readonly number[],
  anchor: number,
): WheelProjection {
  if (cusps.length !== 12) return IDENTITY_PROJECTION;

  const starts = new Float64Array(12);
  const spans = new Float64Array(12);
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const start = cusps[i];
    const end = cusps[(i + 1) % 12];
    if (!Number.isFinite(start) || !Number.isFinite(end)) return IDENTITY_PROJECTION;
    const span = normalize(end - start);
    // A zero-width house has no interior to map into, and a house wider than
    // the whole circle means the cusps are not in ring order.
    if (!(span > 1e-9) || span >= 360) return IDENTITY_PROJECTION;
    starts[i] = normalize(start);
    spans[i] = span;
    total += span;
  }
  // The twelve spans must close the circle exactly once.
  if (Math.abs(total - 360) > 1e-6) return IDENTITY_PROJECTION;

  const base = normalize(anchor);
  const id = `houses:${base.toFixed(6)}:${Array.from(starts, (v) => v.toFixed(6)).join(",")}`;

  return Object.freeze({
    id,
    isIdentity: false,
    project(longitude: number): number {
      if (!Number.isFinite(longitude)) return longitude;
      for (let i = 0; i < 12; i++) {
        const offset = normalize(longitude - starts[i]);
        if (offset < spans[i]) {
          return normalize(base + i * HOUSE_SPAN + (offset / spans[i]) * HOUSE_SPAN);
        }
      }
      // Unreachable while the spans close the circle; keep the value sane.
      return normalize(longitude);
    },
    unproject(drawn: number): number {
      if (!Number.isFinite(drawn)) return drawn;
      const offset = normalize(drawn - base);
      const index = Math.min(11, Math.floor(offset / HOUSE_SPAN));
      const fraction = (offset - index * HOUSE_SPAN) / HOUSE_SPAN;
      return normalize(starts[index] + fraction * spans[index]);
    },
  });
}

/**
 * Persisted wheel layout -> complete angular frame.
 *
 * Theme 3 is the sole normalized-house layout. Theme 4 (Cusp Wheel) and every
 * zodiac-fixed layout deliberately retain the identity projection, so adding
 * another radial profile cannot accidentally normalize its house spans.
 */
export function wheelFrameForTheme(
  theme: number | null | undefined,
  cusps: readonly number[],
  rotation: number,
): WheelFrame {
  return theme === 3
    ? { rotation, projection: houseWheelProjection(cusps, rotation) }
    : identityFrame(rotation);
}
