// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EphemerisDignity } from "./ephemeris-scene";

export const EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION = 2 as const;

export type EphemerisStyleRevision = string | number;

export type EphemerisRenderPalette = Readonly<{
  background: string;
  frame: string;
  texts: string;
  signs: string;
  outOfBounds: string;
}>;

export type EphemerisChartProfileOverrides = Readonly<Record<string, string>>;

/** Retained plate roles: the daemon meta colours, overlaid by the active
 * chart profile. Paper, ink, frame and sign glyphs of the plate. */
export const EPHEMERIS_RENDER_BASE_PALETTE_ROLES: Readonly<
  Record<keyof EphemerisRenderPalette, string>
> = Object.freeze({
  background: "--morinus-background",
  frame: "--morinus-frame",
  texts: "--morinus-text-bright",
  signs: "--morinus-signs",
  outOfBounds: "--aries-destructive",
});

/** Theme roles read from computed CSS (profile values first): muted ink,
 * interior rules and the hover signal. */
export const EPHEMERIS_THEME_COLOR_ROLES = Object.freeze({
  muted: "--aries-text-muted",
  rule: "--aries-border-subtle",
  accent: "--aries-signal",
  /** The chart's Asc/MC axis colour (the wheel's angles, clrAscMC). */
  angles: "--morinus-angles",
});

/** The wheel's body roles (palette.ts BODY_COLOR_VARS), indexed by
 * ephemerisPlanetColorIndex. */
export const EPHEMERIS_BODY_COLOR_VARS = Object.freeze([
  "--morinus-body-sun",
  "--morinus-body-moon",
  "--morinus-body-mercury",
  "--morinus-body-venus",
  "--morinus-body-mars",
  "--morinus-body-jupiter",
  "--morinus-body-saturn",
  "--morinus-body-uranus",
  "--morinus-body-neptune",
  "--morinus-body-pluto",
  "--morinus-body-nodes",
  "--morinus-body-fortune",
  "--morinus-body-chiron",
] as const);

/** The wheel's essential-dignity roles. */
export const EPHEMERIS_DIGNITY_COLOR_VARS: Readonly<Record<EphemerisDignity, string>> = Object.freeze({
  domicile: "--morinus-dignity-domicil",
  exaltation: "--morinus-dignity-exal",
  detriment: "--morinus-dignity-exil",
  fall: "--morinus-dignity-casus",
  peregrine: "--morinus-peregrin",
});

/** Every colour the plate paints, resolved once per style. */
export type EphemerisInkColors = Readonly<{
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  frame: string;
  signs: string;
  accent: string;
  angles: string;
  outOfBounds: string;
  /** Body colour per ephemerisPlanetColorIndex; "" where the theme has none. */
  bodies: readonly string[];
  dignity: Readonly<Record<EphemerisDignity, string>>;
}>;

export type EphemerisRenderTokens = {
  minCanvasWidth: number;
  minCanvasHeight: number;
  planetFontDivisor: number;
  planetFontMin: number;
  planetFontMax: number;
  spaceDivisor: number;
  plateInsetScale: number;
  headerBandScale: number;
  wrapBandScale: number;
  timeBandScale: number;
  signTableScale: number;
  modalityCellPadSpaces: number;
  startGutterPadSpaces: number;
  degreeRulerScale: number;
  limbWidthSpaces: number;
  limbBarShare: number;
  headerFontScale: number;
  textFontScale: number;
  tableFontScale: number;
  signFontScale: number;
  modalityGlyphScale: number;
  edgeSignFontScale: number;
  startSignFontScale: number;
  stationFontScale: number;
  frameSmallMax: number;
  frameMediumMax: number;
  frameWidthSmall: number;
  frameWidthMedium: number;
  frameWidthLarge: number;
  plateFrameWidth: number;
  hairlineWidth: number;
  curveWidthSun: number;
  curveWidthInner: number;
  curveWidthOuter: number;
  curveWidthMoon: number;
  curveWidthHighlight: number;
  tierOuterWidthScale: number;
  gridLineWidth: number;
  gridDashOn: number;
  gridDashOff: number;
  guideOpacity: number;
  outOfBoundsTintOpacity: number;
  inkContrastRatioMin: number;
  eventGlyphScale: number;
  eventGlyphMin: number;
  eventGlyphMax: number;
  eventCodeOffsetYMin: number;
  stationLetterOffsetScale: number;
  turnDotScale: number;
  startSignOffsetScale: number;
  startLabelGapScale: number;
  edgeLabelGapScale: number;
  edgeLabelMaxShiftScale: number;
  labelYGapSpaces: number;
  stationSnapX: number;
  stationSnapY: number;
  tickWidth: number;
  minorTickWidth: number;
  rulerMajorTickScale: number;
  rulerMediumTickScale: number;
  rulerMinorTickScale: number;
  rulerFineTickScale: number;
  rulerTickMin: number;
  rulerTickMinSpacing: number;
  rulerLabelScale: number;
  rulerLabelGapSpaces: number;
  lunationDiscScale: number;
  lunationDiscMin: number;
  lunationDiscMax: number;
  lunationDiscOutlineWidth: number;
  eclipseLetterScale: number;
  radixColumnScale: number;
  radixLineWidth: number;
  radixMidpointLineWidth: number;
  radixMidpointDashOn: number;
  radixMidpointDashOff: number;
  radixLineOpacity: number;
  radixRingScale: number;
  radixRingWidth: number;
  radixLabelScale: number;
  radixPairLabelScale: number;
  radixAngleLineScale: number;
  radixOuterWidthScale: number;
  radixBandOpacity: number;
  radixFocusBandScale: number;
  radixRecedeOpacity: number;
  radixRecedeFadeMs: number;
  radixRecedeDelayMs: number;
  radixFocusWidthScale: number;
  radixFocusRingScale: number;
  radixReadingGlyphScale: number;
  radixContourGlyphScale: number;
  radixContourCount: number;
  planetContactGlyphScale: number;
  planetContactKnockoutScale: number;
  nowLineWidth: number;
  nowLineOpacity: number;
  nowTagPadScale: number;
};

type EphemerisRenderTokenSpecs = {
  readonly [K in keyof EphemerisRenderTokens]: readonly [cssVar: string, fallback: number];
};

function freezeTokenSpecs(specs: EphemerisRenderTokenSpecs): Readonly<EphemerisRenderTokenSpecs> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

// Plate metrics are multiples of the planet glyph size u = clamp(min(w, h) /
// planetFontDivisor, planetFontMin, planetFontMax); strokes are CSS px.
export const EPHEMERIS_RENDER_TOKEN_SPECS = freezeTokenSpecs({
  minCanvasWidth: ["--aries-ephem-min-canvas-width", 40],
  minCanvasHeight: ["--aries-ephem-min-canvas-height", 40],
  planetFontDivisor: ["--aries-ephem-planet-font-divisor", 48],
  planetFontMin: ["--aries-ephem-planet-font-min", 10],
  planetFontMax: ["--aries-ephem-planet-font-max", 16],
  spaceDivisor: ["--aries-ephem-space-divisor", 3],
  plateInsetScale: ["--aries-ephem-plate-inset-scale", 1.25],
  headerBandScale: ["--aries-ephem-header-band-scale", 2.3],
  wrapBandScale: ["--aries-ephem-wrap-band-scale", 2.75],
  timeBandScale: ["--aries-ephem-time-band-scale", 3.2],
  signTableScale: ["--aries-ephem-sign-table-scale", 2.3],
  // Modality table cell padding and start-label gutter padding, in spaces.
  modalityCellPadSpaces: ["--aries-ephem-modality-cell-pad-spaces", 2],
  startGutterPadSpaces: ["--aries-ephem-start-gutter-pad-spaces", 1],
  degreeRulerScale: ["--aries-ephem-degree-ruler-scale", 2.3],
  // Declination decan limbs: width in spaces, share of the zebra bars.
  limbWidthSpaces: ["--aries-ephem-limb-width-spaces", 2],
  limbBarShare: ["--aries-ephem-limb-bar-share", 0.45],
  headerFontScale: ["--aries-ephem-header-font-scale", 0.95],
  textFontScale: ["--aries-ephem-text-font-scale", 0.88],
  tableFontScale: ["--aries-ephem-table-font-scale", 0.73],
  signFontScale: ["--aries-ephem-sign-font-scale", 1.15],
  modalityGlyphScale: ["--aries-ephem-modality-glyph-scale", 0.77],
  edgeSignFontScale: ["--aries-ephem-edge-sign-font-scale", 0.8],
  startSignFontScale: ["--aries-ephem-start-sign-font-scale", 0.77],
  stationFontScale: ["--aries-ephem-station-font-scale", 0.65],
  frameSmallMax: ["--aries-ephem-frame-small-max", 400],
  frameMediumMax: ["--aries-ephem-frame-medium-max", 600],
  frameWidthSmall: ["--aries-ephem-frame-width-small", 1],
  frameWidthMedium: ["--aries-ephem-frame-width-medium", 1],
  frameWidthLarge: ["--aries-ephem-frame-width-large", 1],
  plateFrameWidth: ["--aries-ephem-plate-frame-width", 1],
  hairlineWidth: ["--aries-ephem-hairline-width", 0.75],
  curveWidthSun: ["--aries-ephem-curve-width-sun", 1.6],
  curveWidthInner: ["--aries-ephem-curve-width-inner", 1.15],
  curveWidthOuter: ["--aries-ephem-curve-width-outer", 1],
  curveWidthMoon: ["--aries-ephem-curve-width-moon", 0.8],
  curveWidthHighlight: ["--aries-ephem-curve-width-highlight", 2],
  tierOuterWidthScale: ["--aries-ephem-tier-outer-width-scale", 0.9],
  gridLineWidth: ["--aries-ephem-grid-line-width", 1],
  gridDashOn: ["--aries-ephem-grid-dash-on", 1],
  gridDashOff: ["--aries-ephem-grid-dash-off", 3],
  guideOpacity: ["--aries-ephem-guide-opacity", 0.65],
  outOfBoundsTintOpacity: ["--aries-ephem-oob-tint-opacity", 0.14],
  inkContrastRatioMin: ["--aries-ephem-ink-contrast-ratio-min", 2.2],
  eventGlyphScale: ["--aries-ephem-event-glyph-scale", 0.9],
  eventGlyphMin: ["--aries-ephem-event-glyph-min", 6],
  eventGlyphMax: ["--aries-ephem-event-glyph-max", 10],
  eventCodeOffsetYMin: ["--aries-ephem-event-code-offset-y-min", 1],
  stationLetterOffsetScale: ["--aries-ephem-station-letter-offset-scale", 0.65],
  turnDotScale: ["--aries-ephem-turn-dot-scale", 0.22],
  startSignOffsetScale: ["--aries-ephem-start-sign-offset-scale", 1.15],
  startLabelGapScale: ["--aries-ephem-start-label-gap-scale", 1],
  edgeLabelGapScale: ["--aries-ephem-edge-label-gap-scale", 1],
  edgeLabelMaxShiftScale: ["--aries-ephem-edge-label-max-shift-scale", 1.5],
  labelYGapSpaces: ["--aries-ephem-label-y-gap-spaces", 1],
  stationSnapX: ["--aries-ephem-station-snap-x", 10],
  stationSnapY: ["--aries-ephem-station-snap-y", 16],
  tickWidth: ["--aries-ephem-tick-width", 0.75],
  minorTickWidth: ["--aries-ephem-minor-tick-width", 0.75],
  rulerMajorTickScale: ["--aries-ephem-ruler-major-tick-scale", 0.7],
  rulerMediumTickScale: ["--aries-ephem-ruler-medium-tick-scale", 0.38],
  rulerMinorTickScale: ["--aries-ephem-ruler-minor-tick-scale", 0.3],
  rulerFineTickScale: ["--aries-ephem-ruler-fine-tick-scale", 0.2],
  rulerTickMin: ["--aries-ephem-ruler-tick-min", 2],
  rulerTickMinSpacing: ["--aries-ephem-ruler-tick-min-spacing", 3.5],
  rulerLabelScale: ["--aries-ephem-ruler-label-scale", 0.8],
  rulerLabelGapSpaces: ["--aries-ephem-ruler-label-gap-spaces", 0.5],
  lunationDiscScale: ["--aries-ephem-lunation-disc-scale", 0.5],
  lunationDiscMin: ["--aries-ephem-lunation-disc-min", 5],
  lunationDiscMax: ["--aries-ephem-lunation-disc-max", 9],
  lunationDiscOutlineWidth: ["--aries-ephem-lunation-disc-outline-width", 1],
  eclipseLetterScale: ["--aries-ephem-eclipse-letter-scale", 0.72],
  // Radix layer (Tab): natal reference lines, their labels beyond the degree
  // ruler and the exact-crossing rings.
  radixColumnScale: ["--aries-ephem-radix-column-scale", 3.6],
  radixLineWidth: ["--aries-ephem-radix-line-width", 1.25],
  radixMidpointLineWidth: ["--aries-ephem-radix-midpoint-line-width", 1],
  radixMidpointDashOn: ["--aries-ephem-radix-midpoint-dash-on", 6],
  radixMidpointDashOff: ["--aries-ephem-radix-midpoint-dash-off", 6],
  radixLineOpacity: ["--aries-ephem-radix-line-opacity", 0.85],
  radixRingScale: ["--aries-ephem-radix-ring-scale", 0.2],
  radixRingWidth: ["--aries-ephem-radix-ring-width", 1.25],
  radixLabelScale: ["--aries-ephem-radix-label-scale", 0.9],
  radixPairLabelScale: ["--aries-ephem-radix-pair-label-scale", 0.78],
  // Natal lines in chart colours: angles a little heavier (× line width)
  // in the chart's angle colour, non-personal planets thinner; Orb bands' tint; a focused
  // (hovered or pinned) line forward, the rest receded only while pinned; glyphs at the
  // reading line and the focused line's contour glyphs (count per viewport).
  radixAngleLineScale: ["--aries-ephem-radix-angle-line-scale", 1.6],
  radixOuterWidthScale: ["--aries-ephem-radix-outer-width-scale", 0.75],
  radixBandOpacity: ["--aries-ephem-radix-band-opacity", 0.1],
  radixFocusBandScale: ["--aries-ephem-radix-focus-band-scale", 1.4],
  radixRecedeOpacity: ["--aries-ephem-radix-recede-opacity", 0.4],
  // A pin fades the others down (and back up on release) after a short
  // pause, so a quick click-and-release never flickers; hover never dims.
  radixRecedeFadeMs: ["--aries-ephem-radix-recede-fade-ms", 160],
  radixRecedeDelayMs: ["--aries-ephem-radix-recede-delay-ms", 80],
  radixFocusWidthScale: ["--aries-ephem-radix-focus-width-scale", 1.6],
  radixFocusRingScale: ["--aries-ephem-radix-focus-ring-scale", 1.35],
  radixReadingGlyphScale: ["--aries-ephem-radix-reading-glyph-scale", 0.7],
  radixContourGlyphScale: ["--aries-ephem-radix-contour-glyph-scale", 0.75],
  radixContourCount: ["--aries-ephem-radix-contour-count", 2],
  // Planet contacts: aspect glyph size (× planet glyph) and its paper
  // knock-out radius (× glyph size).
  planetContactGlyphScale: ["--aries-ephem-planet-contact-glyph-scale", 0.85],
  planetContactKnockoutScale: ["--aries-ephem-planet-contact-knockout-scale", 0.55],
  // Reading line: the fixed current-date hairline at the plot centre and its
  // date tag on the time axis, in the signal colour.
  nowLineWidth: ["--aries-ephem-now-line-width", 1],
  nowLineOpacity: ["--aries-ephem-now-line-opacity", 0.55],
  nowTagPadScale: ["--aries-ephem-now-tag-pad-scale", 0.5],
});

function defaultRenderTokens(): Readonly<EphemerisRenderTokens> {
  const tokens = {} as EphemerisRenderTokens;
  for (const key of Object.keys(EPHEMERIS_RENDER_TOKEN_SPECS) as Array<keyof EphemerisRenderTokens>) {
    tokens[key] = EPHEMERIS_RENDER_TOKEN_SPECS[key][1];
  }
  return Object.freeze(tokens);
}

export const DEFAULT_EPHEMERIS_RENDER_TOKENS = defaultRenderTokens();

export const DEFAULT_EPHEMERIS_RENDER_PALETTE: EphemerisRenderPalette = Object.freeze({
  background: "#ffffff",
  frame: "#000000",
  texts: "#000000",
  signs: "#000000",
  outOfBounds: "#ff554b",
});

/** Overlay only the active chart-profile layer onto the retained daemon
 * palette. The daemon payload remains exact when no profile is active. */
export function resolveEphemerisRenderPalette(
  retained: Partial<EphemerisRenderPalette> = DEFAULT_EPHEMERIS_RENDER_PALETTE,
  profileOverrides: EphemerisChartProfileOverrides = {},
): EphemerisRenderPalette {
  const palette = {} as Record<keyof EphemerisRenderPalette, string>;
  for (const key of Object.keys(
    EPHEMERIS_RENDER_BASE_PALETTE_ROLES,
  ) as Array<keyof EphemerisRenderPalette>) {
    const profileValue = profileOverrides[EPHEMERIS_RENDER_BASE_PALETTE_ROLES[key]]?.trim();
    palette[key] = profileValue || retained[key] || DEFAULT_EPHEMERIS_RENDER_PALETTE[key];
  }
  return Object.freeze(palette) as EphemerisRenderPalette;
}

/** Theme colours on top of the retained palette: a profile value wins, then
 * the host's computed CSS; a missing role falls back to plate ink (bodies to
 * "", so the daemon's individual colour stands in). */
export function resolveEphemerisInkColors(
  palette: EphemerisRenderPalette,
  readCssValue: EphemerisCssValueReader = () => "",
  profileOverrides: EphemerisChartProfileOverrides = {},
): EphemerisInkColors {
  const read = (cssVar: string) => profileOverrides[cssVar]?.trim() || readCssValue(cssVar).trim();
  const peregrine = read(EPHEMERIS_DIGNITY_COLOR_VARS.peregrine) || palette.texts;
  const dignity = {} as Record<EphemerisDignity, string>;
  for (const key of Object.keys(EPHEMERIS_DIGNITY_COLOR_VARS) as EphemerisDignity[]) {
    dignity[key] = read(EPHEMERIS_DIGNITY_COLOR_VARS[key]) || peregrine;
  }
  return Object.freeze({
    paper: palette.background,
    ink: palette.texts,
    muted: read(EPHEMERIS_THEME_COLOR_ROLES.muted) || palette.texts,
    rule: read(EPHEMERIS_THEME_COLOR_ROLES.rule) || palette.frame,
    frame: palette.frame,
    signs: palette.signs,
    accent: read(EPHEMERIS_THEME_COLOR_ROLES.accent) || palette.texts,
    angles: read(EPHEMERIS_THEME_COLOR_ROLES.angles) || palette.texts,
    outOfBounds: palette.outOfBounds,
    bodies: Object.freeze(EPHEMERIS_BODY_COLOR_VARS.map(read)),
    dignity: Object.freeze(dignity),
  });
}

/** Mirror common.common.get_planet_color_index, which is the daemon authority
 * used by ephemeris_service._planet_colour_hex. */
export function ephemerisPlanetColorIndex(planetId: number): number {
  const id = Number.isFinite(planetId) ? planetId : 0;
  if (id === 12 || id === 13) return 1; // Lunar apogee shares the Moon palette
  if (id === 15) return 12; // astrology.SE_CHIRON -> SE_PLUTO + 3
  if (id === 11) return 10; // astrology.SE_TRUE_NODE -> SE_MEAN_NODE
  if (id < 0) return 0;
  if (id >= 12) return 11; // len(common.common.Planets) - 1
  return Math.trunc(id);
}

/** Apply the profile's individual-planet array without mutating the retained
 * payload. Missing/empty slots retain the exact daemon color. */
export function applyEphemerisPlanetProfileColors<
  T extends Readonly<{ id: number; color: string }>,
>(
  planets: readonly T[],
  profilePlanetColors?: readonly string[],
): readonly T[] {
  if (!profilePlanetColors?.length) return planets;
  let changed = false;
  const resolved = planets.map((planet) => {
    const colorIndex = Math.min(
      ephemerisPlanetColorIndex(planet.id),
      profilePlanetColors.length - 1,
    );
    const color = profilePlanetColors[colorIndex]?.trim();
    if (!color || color === planet.color) return planet;
    changed = true;
    return { ...planet, color };
  });
  return changed ? Object.freeze(resolved) : planets;
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "ephemeris-render-style-v2";

export interface EphemerisRenderStyle {
  readonly schemaVersion: typeof EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: EphemerisStyleRevision;
  readonly palette: EphemerisRenderPalette;
  readonly colors: EphemerisInkColors;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    planetFontDivisor: number;
    planetFontMin: number;
    planetFontMax: number;
    headerFontScale: number;
    textFontScale: number;
    tableFontScale: number;
    signFontScale: number;
    modalityGlyphScale: number;
    edgeSignFontScale: number;
    startSignFontScale: number;
    stationFontScale: number;
  }>;
  readonly strokes: Readonly<{
    frameSmallMax: number;
    frameMediumMax: number;
    frameWidthSmall: number;
    frameWidthMedium: number;
    frameWidthLarge: number;
    plateFrameWidth: number;
    hairlineWidth: number;
    curveWidthSun: number;
    curveWidthInner: number;
    curveWidthOuter: number;
    curveWidthMoon: number;
    curveWidthHighlight: number;
    tierOuterWidthScale: number;
      gridLineWidth: number;
    gridDashOn: number;
    gridDashOff: number;
    guideOpacity: number;
    outOfBoundsTintOpacity: number;
    inkContrastRatioMin: number;
    tickWidth: number;
    minorTickWidth: number;
    lunationDiscOutlineWidth: number;
  }>;
  readonly markers: Readonly<{
    eventGlyphScale: number;
    eventGlyphMin: number;
    eventGlyphMax: number;
    eventCodeOffsetYMin: number;
    stationLetterOffsetScale: number;
    turnDotScale: number;
    lunationDiscScale: number;
    lunationDiscMin: number;
    lunationDiscMax: number;
    eclipseLetterScale: number;
  }>;
  readonly labels: Readonly<{
    startSignOffsetScale: number;
    startLabelGapScale: number;
    edgeLabelGapScale: number;
    edgeLabelMaxShiftScale: number;
    labelYGapSpaces: number;
  }>;
  readonly ruler: Readonly<{
    majorTickScale: number;
    mediumTickScale: number;
    minorTickScale: number;
    fineTickScale: number;
    tickMin: number;
    tickMinSpacing: number;
    labelScale: number;
    labelGapSpaces: number;
  }>;
  readonly layout: Readonly<{
    minCanvasWidth: number;
    minCanvasHeight: number;
    spaceDivisor: number;
    plateInsetScale: number;
    headerBandScale: number;
    wrapBandScale: number;
    timeBandScale: number;
    signTableScale: number;
    modalityCellPadSpaces: number;
    startGutterPadSpaces: number;
    degreeRulerScale: number;
    limbWidthSpaces: number;
    limbBarShare: number;
  }>;
  readonly interaction: Readonly<{
    stationSnapX: number;
    stationSnapY: number;
  }>;
  readonly radix: Readonly<{
    radixColumnScale: number;
    radixLineWidth: number;
    radixMidpointLineWidth: number;
    radixMidpointDashOn: number;
    radixMidpointDashOff: number;
    radixLineOpacity: number;
    radixRingScale: number;
    radixRingWidth: number;
    radixLabelScale: number;
    radixPairLabelScale: number;
    radixAngleLineScale: number;
    radixOuterWidthScale: number;
    radixBandOpacity: number;
    radixFocusBandScale: number;
    radixRecedeOpacity: number;
    radixRecedeFadeMs: number;
    radixRecedeDelayMs: number;
    radixFocusWidthScale: number;
    radixFocusRingScale: number;
    radixReadingGlyphScale: number;
    radixContourGlyphScale: number;
    radixContourCount: number;
    planetContactGlyphScale: number;
    planetContactKnockoutScale: number;
  }>;
  readonly now: Readonly<{
    nowLineWidth: number;
    nowLineOpacity: number;
    nowTagPadScale: number;
  }>;
}

export type EphemerisCssValueReader = (cssVar: string) => string;

/** Pure CSS-number resolution preserving the established parseFloat and
 * non-negative fallback behavior. Units remain owned by the CSS contract. */
export function resolveEphemerisRenderTokens(
  readCssValue: EphemerisCssValueReader = () => "",
  profileOverrides: EphemerisChartProfileOverrides = {},
): Readonly<EphemerisRenderTokens> {
  const tokens = {} as EphemerisRenderTokens;
  for (const key of Object.keys(EPHEMERIS_RENDER_TOKEN_SPECS) as Array<keyof EphemerisRenderTokens>) {
    const [cssVar, fallback] = EPHEMERIS_RENDER_TOKEN_SPECS[key];
    const directProfileValue = profileOverrides[cssVar]?.trim();
    const value = Number.parseFloat(directProfileValue || readCssValue(cssVar).trim());
    tokens[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return Object.freeze(tokens);
}

export function readEphemerisRenderTokens(
  host: HTMLElement | null,
  profileOverrides: EphemerisChartProfileOverrides = {},
): Readonly<EphemerisRenderTokens> {
  const computed = host ? window.getComputedStyle(host) : null;
  return resolveEphemerisRenderTokens(
    (cssVar) => computed?.getPropertyValue(cssVar) ?? "",
    profileOverrides,
  );
}

function pick<K extends keyof EphemerisRenderTokens>(
  tokens: Readonly<EphemerisRenderTokens>,
  keys: readonly K[],
): Readonly<Pick<EphemerisRenderTokens, K>> {
  const out = {} as Pick<EphemerisRenderTokens, K>;
  for (const key of keys) out[key] = tokens[key];
  return Object.freeze(out);
}

export function createEphemerisRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_EPHEMERIS_RENDER_PALETTE,
  colors,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_EPHEMERIS_RENDER_TOKENS,
}: {
  revision?: EphemerisStyleRevision;
  palette?: EphemerisRenderPalette;
  colors?: EphemerisInkColors;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<EphemerisRenderTokens>;
} = {}): EphemerisRenderStyle {
  const frozenPalette = Object.freeze({ ...palette });
  return Object.freeze({
    schemaVersion: EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: frozenPalette,
    colors: colors ?? resolveEphemerisInkColors(frozenPalette),
    typography: Object.freeze({
      fontUi,
      fontSymbols,
      ...pick(tokens, [
        "planetFontDivisor", "planetFontMin", "planetFontMax", "headerFontScale", "textFontScale",
        "tableFontScale", "signFontScale", "modalityGlyphScale", "edgeSignFontScale", "startSignFontScale",
        "stationFontScale",
      ]),
    }),
    strokes: pick(tokens, [
      "frameSmallMax", "frameMediumMax", "frameWidthSmall", "frameWidthMedium", "frameWidthLarge",
      "plateFrameWidth", "hairlineWidth", "curveWidthSun", "curveWidthInner", "curveWidthOuter",
      "curveWidthMoon", "curveWidthHighlight", "tierOuterWidthScale",
      "gridLineWidth", "gridDashOn", "gridDashOff", "guideOpacity", "outOfBoundsTintOpacity", "inkContrastRatioMin", "tickWidth",
      "minorTickWidth", "lunationDiscOutlineWidth",
    ]),
    markers: pick(tokens, [
      "eventGlyphScale", "eventGlyphMin", "eventGlyphMax", "eventCodeOffsetYMin", "stationLetterOffsetScale", "turnDotScale",
      "lunationDiscScale", "lunationDiscMin", "lunationDiscMax", "eclipseLetterScale",
    ]),
    labels: pick(tokens, [
      "startSignOffsetScale", "startLabelGapScale", "edgeLabelGapScale", "edgeLabelMaxShiftScale", "labelYGapSpaces",
    ]),
    ruler: Object.freeze({
      majorTickScale: tokens.rulerMajorTickScale,
      mediumTickScale: tokens.rulerMediumTickScale,
      minorTickScale: tokens.rulerMinorTickScale,
      fineTickScale: tokens.rulerFineTickScale,
      tickMin: tokens.rulerTickMin,
      tickMinSpacing: tokens.rulerTickMinSpacing,
      labelScale: tokens.rulerLabelScale,
      labelGapSpaces: tokens.rulerLabelGapSpaces,
    }),
    layout: pick(tokens, [
      "minCanvasWidth", "minCanvasHeight", "spaceDivisor", "plateInsetScale", "headerBandScale",
      "wrapBandScale", "timeBandScale", "signTableScale", "modalityCellPadSpaces", "startGutterPadSpaces",
      "degreeRulerScale", "limbWidthSpaces", "limbBarShare",
    ]),
    interaction: pick(tokens, ["stationSnapX", "stationSnapY"]),
    radix: pick(tokens, [
      "radixColumnScale", "radixLineWidth", "radixMidpointLineWidth", "radixMidpointDashOn", "radixMidpointDashOff", "radixLineOpacity", "radixRingScale", "radixRingWidth", "radixLabelScale", "radixPairLabelScale", "radixAngleLineScale", "radixOuterWidthScale", "radixBandOpacity", "radixFocusBandScale", "radixRecedeOpacity", "radixRecedeFadeMs", "radixRecedeDelayMs", "radixFocusWidthScale", "radixFocusRingScale", "radixReadingGlyphScale", "radixContourGlyphScale", "radixContourCount", "planetContactGlyphScale", "planetContactKnockoutScale",
    ]),
    now: pick(tokens, ["nowLineWidth", "nowLineOpacity", "nowTagPadScale"]),
  });
}

/** Resolve one immutable style snapshot from the host's computed CSS. Callers
 * retain and share this exact object across paint and interaction paths. */
export function resolveEphemerisRenderStyle(
  host: HTMLElement | null,
  {
    profileOverrides = {},
    ...input
  }: Omit<NonNullable<Parameters<typeof createEphemerisRenderStyle>[0]>, "tokens" | "colors"> & {
    profileOverrides?: EphemerisChartProfileOverrides;
  } = {},
): EphemerisRenderStyle {
  const computed = host ? window.getComputedStyle(host) : null;
  const readCss = (cssVar: string) => computed?.getPropertyValue(cssVar) ?? "";
  const palette = input.palette ?? DEFAULT_EPHEMERIS_RENDER_PALETTE;
  return createEphemerisRenderStyle({
    ...input,
    colors: resolveEphemerisInkColors(palette, readCss, profileOverrides),
    tokens: resolveEphemerisRenderTokens(readCss, profileOverrides),
  });
}
