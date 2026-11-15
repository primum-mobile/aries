// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the Graphic Ephemeris shows, independent of time: mode, toggles,
// planets and labels. The painters, the hit test and the view share it.

import type { EphemerisDisplayMode } from "./ephemeris-geometry";

export type EphemerisModulus = 360 | 90 | 45 | 30;
/** tiers: two inks; planets: each body's theme colour; chart: dignity colours. */
export type EphemerisInkMode = "tiers" | "planets" | "dignity";
export type EphemerisDignity = "domicile" | "exaltation" | "detriment" | "fall" | "peregrine";

export type EphemerisScenePlanet = Readonly<{ id: number; glyph: string; color: string }>;

export type EphemerisScene = Readonly<{
  mode: EphemerisDisplayMode;
  planets: readonly EphemerisScenePlanet[];
  visible: Readonly<Record<number, boolean>>;
  signGlyphs: readonly string[];
  signNames: readonly string[];
  monthLabels: readonly string[];
  showGrid: boolean;
  showEventGlyphs: boolean;
  showLunations: boolean;
  lunationLabels: Readonly<{ new: string; full: string }>;
  /** Localized one-letter eclipse marks drawn on the lunation disc. */
  eclipseLetters?: Readonly<{ solar: string; lunar: string }>;
  outOfBoundsLabel: string;
  /** Longitude mode only; declination ignores it. */
  modulus: EphemerisModulus;
  inkMode: EphemerisInkMode;
  /** Hovered curve, painted last in the signal colour. */
  highlightPlanetId: number | null;
  /** Twelve essential dignities per planet, sign 0..11. */
  dignityBySign: Readonly<Record<number, readonly EphemerisDignity[]>>;
  /** Theme/options: individual body colours instead of dignity colours. */
  usePlanetColors: boolean;
  /** Table and planet labels on the right, degree ruler on the left. */
  mirrored?: boolean;
  /** Declination: the dashed 0° equator through the plot, marked on both limbs. */
  showEquator?: boolean;
  /** Declination: the year's ±out-of-bounds limit ruled and tinted beyond. */
  showOutOfBoundsRange?: boolean;
  /** Declination: sign pairs between the sign-cusp declinations in the table. */
  showSignBands?: boolean;
  /** Longitude: the radix layer (Tab) — natal lines, their label column
   * beyond the degree ruler, and the exact-crossing rings. */
  showRadix?: boolean;
  /** Longitude: planet-to-planet contacts as aspect glyphs (Tab or not). */
  showPlanetContacts?: boolean;
  /** Longitude, radix on: each natal point's ± orb as a tint (Orb bands). */
  showRadixBands?: boolean;
  /** Longitude, radix and reading line on: each natal line's glyph at the
   * reading line (default on). */
  showRadixReadingGlyphs?: boolean;
  /** Longitude, radix on: the label column's natal marks in the ink mode's
   * colour; the lines stay in the one radix ink (default off). */
  colorRadixLabels?: boolean;
  /** The bands' orb in degrees: the options' midpoint orb (ringorb_midpoints). */
  radixBandOrb?: number;
  /** The natal point under the pointer or pinned: forward; the rest recede
   * only when it is pinned (hover never dims). */
  radixFocusKey?: string | null;
  /** The focus is a click (pinned), not only the pointer: its glyphs move
   * from the date line to the sides and the other lines recede. */
  radixFocusPinned?: boolean;
  /** The reading line: a fixed signal hairline at the plot centre marking
   * the document's current moment (the camera centre), with its date tagged
   * on the time axis; the header then names that date. */
  showNowLine?: boolean;
  /** Localized date for the reading line's tag. */
  nowLineLabel?: (jd: number) => string;
  /** Localized technical header, composed by the view, for the date it
   * names: the reading line's when shown, else the left edge. */
  headerText: (jd: number) => string;
}>;

/** One device-scaled 2D surface: CSS size plus pixels per CSS px. */
export type EphemerisSurface = Readonly<{
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
}>;
