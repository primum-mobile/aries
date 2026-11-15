// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASTROLABE_RENDER_STYLE_SCHEMA_VERSION = 3 as const;

export type AstrolabeStyleRevision = string | number;

export type AstrolabeRenderPalette = Readonly<{
  background: string;
  horizon: string;
  ecliptic: string;
  equator: string;
  equatorLabel: string;
  tropic: string;
  meridian: string;
  regio: string;
  regioZoomed: string;
  contact: string;
  almucantar: string;
  azimuth: string;
  hour: string;
  capricorn: string;
  star: string;
  starFaint: string;
  cardinal: string;
  sunFill: string;
  primeVertical: string;
  earth: string;
  declination: string;
  termRing: string;
  termBoundary: string;
  decanBoundary: string;
  subdivisionGlyph: string;
}>;

export type AstrolabeRenderTokens = {
  capricornFill: number;
  fineStrokeMin: number;
  fineStrokeDivisor: number;
  mediumStrokeMin: number;
  mediumStrokeDivisor: number;
  mainStrokeMin: number;
  mainStrokeDivisor: number;
  tropicDashOn: number;
  tropicDashOff: number;
  equatorDashOn: number;
  equatorDashOff: number;
  regioDashOn: number;
  regioDashOff: number;
  meridianDashOn: number;
  meridianDashOff: number;
  capricornDashOn: number;
  capricornDashOff: number;
  connectorDashOn: number;
  connectorDashOff: number;
  connectorOpacity: number;
  atmosphericFillOpacity: number;
  sphereOutlineWidth: number;
  bandWidthScale: number;
  divisionSignShare: number;
  termBandScale: number;
  decanBandScale: number;
  divisionGlyphScale: number;
  divisionGlyphMin: number;
  polarDivisionBandScale: number;
  polarDivisionOpacity: number;
  bareEclipticTickScale: number;
  bareSignGlyphScale: number;
  eclipticScaleTick1: number;
  eclipticScaleTick5: number;
  eclipticScaleTick10: number;
  eclipticScaleWeight: number;
  eclipticBandWidthSteps: number;
  eclipticBandBoxDegrees: number;
  eclipticBandTickShare: number;
  tickStepScale: number;
  innerRadiusMin: number;
  starRadiusMin: number;
  starRadiusDivisor: number;
  starBrightLimit: number;
  starMagnitudeExponent: number;
  starScaleMin: number;
  starScaleMax: number;
  starFaintOpacity: number;
  signFontDivisor: number;
  signCullScale: number;
  sphereRadiusMin: number;
  sphereRadiusDivisor: number;
  planetFontDivisor: number;
  bodyLabelPadScale: number;
  bodyCullScale: number;
  collisionMarginScale: number;
  collisionIterations: number;
  collisionMinDelta: number;
  collisionTieDelta: number;
  collisionPushScale: number;
  collisionMoveScale: number;
  sunSphereScale: number;
  circleLabelFontDivisor: number;
  circleLabelOffsetX: number;
  circleLabelOffsetY: number;
  cardinalPadScale: number;
  cardinalFontDivisor: number;
  polarRimFill: number;
  polarLaneGapScale: number;
  polarRingFontScale: number;
  polarAngleFontScale: number;
  polarStarLabelScale: number;
  polarLeaderOpacity: number;
  zoomRampStart: number;
  zoomRampEnd: number;
  zoomLatticeFade: number;
  zoomHouseNumberExponent: number;
  zoomHouseNumberCap: number;
  zoomSphereExponent: number;
  zoomSphereCap: number;
  zoomGlyphExponent: number;
  zoomGlyphCap: number;
  zoomStarExponent: number;
  zoomStarCap: number;
  zoomStarLabelExponent: number;
  zoomStarLabelCap: number;
  notchHalfLength: number;
  notchZoomExponent: number;
  notchZoomCap: number;
  notchRampStart: number;
  notchRampEnd: number;
  notchWidthScale: number;
  diskThreshold: number;
  diskFillOpacity: number;
  diskOutlineOpacity: number;
  angleTickScale: number;
  angleLabelScale: number;
  contactHalfLength: number;
  contactGlow: number;
  notchContactWidthScale: number;
};

type AstrolabeRenderTokenSpecs = {
  readonly [K in keyof AstrolabeRenderTokens]: readonly [cssVar: string, fallback: number];
};

type AstrolabePaletteSpecs = {
  readonly [K in keyof AstrolabeRenderPalette]: readonly [cssVar: string, fallback: string];
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const ASTROLABE_RENDER_TOKEN_SPECS: Readonly<AstrolabeRenderTokenSpecs> = deepFreeze({
  capricornFill: ["--aries-astrolabe-capricorn-fill", 0.83],
  fineStrokeMin: ["--aries-astrolabe-fine-stroke-min", 0.75],
  fineStrokeDivisor: ["--aries-astrolabe-fine-stroke-divisor", 960],
  mediumStrokeMin: ["--aries-astrolabe-medium-stroke-min", 1],
  mediumStrokeDivisor: ["--aries-astrolabe-medium-stroke-divisor", 720],
  mainStrokeMin: ["--aries-astrolabe-main-stroke-min", 1.5],
  mainStrokeDivisor: ["--aries-astrolabe-main-stroke-divisor", 720],
  tropicDashOn: ["--aries-astrolabe-tropic-dash-on", 1],
  tropicDashOff: ["--aries-astrolabe-tropic-dash-off", 3],
  equatorDashOn: ["--aries-astrolabe-equator-dash-on", 1],
  equatorDashOff: ["--aries-astrolabe-equator-dash-off", 3],
  regioDashOn: ["--aries-astrolabe-regio-dash-on", 1],
  regioDashOff: ["--aries-astrolabe-regio-dash-off", 4],
  meridianDashOn: ["--aries-astrolabe-meridian-dash-on", 2],
  meridianDashOff: ["--aries-astrolabe-meridian-dash-off", 4],
  capricornDashOn: ["--aries-astrolabe-capricorn-dash-on", 1],
  capricornDashOff: ["--aries-astrolabe-capricorn-dash-off", 2],
  connectorDashOn: ["--aries-astrolabe-connector-dash-on", 1],
  connectorDashOff: ["--aries-astrolabe-connector-dash-off", 3],
  connectorOpacity: ["--aries-astrolabe-connector-opacity", 0.42],
  atmosphericFillOpacity: ["--aries-astrolabe-atmospheric-fill-opacity", 0.32],
  sphereOutlineWidth: ["--aries-astrolabe-sphere-outline-width", 0.75],
  bandWidthScale: ["--aries-astrolabe-band-width-scale", 0.12],
  // Term and decan rings housed inside the rete band (stereographic) and the
  // faint division marks on the polar ecliptic.
  divisionSignShare: ["--aries-astrolabe-division-sign-share", 0.6],
  termBandScale: ["--aries-astrolabe-term-band-scale", 0.034],
  decanBandScale: ["--aries-astrolabe-decan-band-scale", 0.026],
  // Ruler glyph: share of its box's width, so it grows with zoom; hidden below
  // the minimum CSS px. Polar boxes run faintly along the ecliptic.
  divisionGlyphScale: ["--aries-astrolabe-division-glyph-scale", 0.72],
  divisionGlyphMin: ["--aries-astrolabe-division-glyph-min", 5],
  polarDivisionBandScale: ["--aries-astrolabe-polar-division-band-scale", 0.018],
  polarDivisionOpacity: ["--aries-astrolabe-polar-division-opacity", 0.4],
  // Zodiac off: the bare ecliptic keeps the band's graduations at this share
  // of their length (30° marks reach four steps) and small sign glyphs.
  bareEclipticTickScale: ["--aries-astrolabe-bare-ecliptic-tick-scale", 0.5],
  bareSignGlyphScale: ["--aries-astrolabe-bare-sign-glyph-scale", 0.5],
  // Ecliptic engraving where the zodiac ring is off (always on the polar
  // plate), in tick steps: the graduated scale's 1°/5°/10° ticks (the sign tick
  // reaches half a step past the 10° tick) and stroke weight; the divided
  // band's width, box size in degrees and 1° tick share of the band.
  eclipticScaleTick1: ["--aries-astrolabe-ecliptic-scale-tick-1", 1],
  eclipticScaleTick5: ["--aries-astrolabe-ecliptic-scale-tick-5", 1.8],
  eclipticScaleTick10: ["--aries-astrolabe-ecliptic-scale-tick-10", 2.5],
  eclipticScaleWeight: ["--aries-astrolabe-ecliptic-scale-weight", 0.8],
  eclipticBandWidthSteps: ["--aries-astrolabe-ecliptic-band-width-steps", 1],
  eclipticBandBoxDegrees: ["--aries-astrolabe-ecliptic-band-box-degrees", 5],
  eclipticBandTickShare: ["--aries-astrolabe-ecliptic-band-tick-share", 1],
  tickStepScale: ["--aries-astrolabe-tick-step-scale", 0.008],
  innerRadiusMin: ["--aries-astrolabe-inner-radius-min", 1],
  starRadiusMin: ["--aries-astrolabe-star-radius-min", 1],
  starRadiusDivisor: ["--aries-astrolabe-star-radius-divisor", 590],
  // Magnitude rendering: stars at or brighter than the limit draw as the
  // four-pointed glyph, fainter ones as dimming dots; size follows
  // exp(-exponent * (mag - 1)), clamped to [scaleMin, scaleMax].
  starBrightLimit: ["--aries-astrolabe-star-bright-limit", 2.5],
  starMagnitudeExponent: ["--aries-astrolabe-star-magnitude-exponent", 0.3],
  starScaleMin: ["--aries-astrolabe-star-scale-min", 0.3],
  starScaleMax: ["--aries-astrolabe-star-scale-max", 1.6],
  starFaintOpacity: ["--aries-astrolabe-star-faint-opacity", 0.35],
  signFontDivisor: ["--aries-astrolabe-sign-font-divisor", 24],
  signCullScale: ["--aries-astrolabe-sign-cull-scale", 0.03],
  sphereRadiusMin: ["--aries-astrolabe-sphere-radius-min", 1.5],
  sphereRadiusDivisor: ["--aries-astrolabe-sphere-radius-divisor", 190],
  planetFontDivisor: ["--aries-astrolabe-planet-font-divisor", 22.22],
  bodyLabelPadScale: ["--aries-astrolabe-body-label-pad-scale", 0.018],
  bodyCullScale: ["--aries-astrolabe-body-cull-scale", 1.1],
  collisionMarginScale: ["--aries-astrolabe-collision-margin-scale", 0.15],
  collisionIterations: ["--aries-astrolabe-collision-iterations", 40],
  collisionMinDelta: ["--aries-astrolabe-collision-min-delta", 0.5],
  collisionTieDelta: ["--aries-astrolabe-collision-tie-delta", 1],
  collisionPushScale: ["--aries-astrolabe-collision-push-scale", 0.5],
  collisionMoveScale: ["--aries-astrolabe-collision-move-scale", 0.5],
  sunSphereScale: ["--aries-astrolabe-sun-sphere-scale", 1.5],
  circleLabelFontDivisor: ["--aries-astrolabe-circle-label-font-divisor", 36],
  circleLabelOffsetX: ["--aries-astrolabe-circle-label-offset-x", 4],
  circleLabelOffsetY: ["--aries-astrolabe-circle-label-offset-y", 2],
  cardinalPadScale: ["--aries-astrolabe-cardinal-pad-scale", 0.04],
  cardinalFontDivisor: ["--aries-astrolabe-cardinal-font-divisor", 24],
  polarRimFill: ["--aries-astrolabe-polar-rim-fill", 0.78],
  polarLaneGapScale: ["--aries-astrolabe-polar-lane-gap-scale", 0.012],
  polarRingFontScale: ["--aries-astrolabe-polar-ring-font-scale", 0.5],
  // Rim Asc/MC labels and fixed-star names, relative to the planet glyph and
  // circle-label sizes.
  polarAngleFontScale: ["--aries-astrolabe-polar-angle-font-scale", 0.62],
  polarStarLabelScale: ["--aries-astrolabe-polar-star-label-scale", 0.62],
  polarLeaderOpacity: ["--aries-astrolabe-polar-leader-opacity", 0.72],
  // Zoom symbology: grow(e, cap) = min(cap, k^e); ramp(a, b) fades a layer in
  // between zoom a and b. Geometry scales with k; these set what else does.
  zoomRampStart: ["--aries-astrolabe-zoom-ramp-start", 2],
  zoomRampEnd: ["--aries-astrolabe-zoom-ramp-end", 4],
  zoomLatticeFade: ["--aries-astrolabe-zoom-lattice-fade", 0.55],
  zoomHouseNumberExponent: ["--aries-astrolabe-zoom-house-number-exponent", 0.5],
  zoomHouseNumberCap: ["--aries-astrolabe-zoom-house-number-cap", 2.6],
  zoomSphereExponent: ["--aries-astrolabe-zoom-sphere-exponent", 0.5],
  zoomSphereCap: ["--aries-astrolabe-zoom-sphere-cap", 4],
  zoomGlyphExponent: ["--aries-astrolabe-zoom-glyph-exponent", 0.4],
  zoomGlyphCap: ["--aries-astrolabe-zoom-glyph-cap", 2.5],
  zoomStarExponent: ["--aries-astrolabe-zoom-star-exponent", 0.2],
  zoomStarCap: ["--aries-astrolabe-zoom-star-cap", 1.6],
  zoomStarLabelExponent: ["--aries-astrolabe-zoom-star-label-exponent", 0.12],
  zoomStarLabelCap: ["--aries-astrolabe-zoom-star-label-cap", 1.3],
  notchHalfLength: ["--aries-astrolabe-notch-half-length", 5],
  notchZoomExponent: ["--aries-astrolabe-notch-zoom-exponent", 0.3],
  notchZoomCap: ["--aries-astrolabe-notch-zoom-cap", 1.8],
  notchRampStart: ["--aries-astrolabe-notch-ramp-start", 2],
  notchRampEnd: ["--aries-astrolabe-notch-ramp-end", 3],
  notchWidthScale: ["--aries-astrolabe-notch-width-scale", 1.6],
  diskThreshold: ["--aries-astrolabe-disk-threshold", 1.2],
  diskFillOpacity: ["--aries-astrolabe-disk-fill-opacity", 0.14],
  diskOutlineOpacity: ["--aries-astrolabe-disk-outline-opacity", 0.55],
  angleTickScale: ["--aries-astrolabe-angle-tick-scale", 0.6],
  angleLabelScale: ["--aries-astrolabe-angle-label-scale", 0.7],
  // Contact cue: a lit stretch of the touched line, CSS px each way.
  contactHalfLength: ["--aries-astrolabe-contact-half-length", 40],
  contactGlow: ["--aries-astrolabe-contact-glow", 6],
  notchContactWidthScale: ["--aries-astrolabe-notch-contact-width-scale", 2.4],
});

export const ASTROLABE_RENDER_PALETTE_SPECS: Readonly<AstrolabePaletteSpecs> = deepFreeze({
  background: ["--aries-astrolabe-background", "var(--morinus-background)"],
  horizon: ["--aries-astrolabe-horizon", "var(--morinus-angles)"],
  ecliptic: ["--aries-astrolabe-ecliptic", "var(--morinus-frame)"],
  equator: ["--aries-astrolabe-equator", "var(--morinus-houses)"],
  equatorLabel: ["--aries-astrolabe-equator-label", "var(--morinus-houses)"],
  tropic: ["--aries-astrolabe-tropic", "var(--morinus-houses)"],
  meridian: ["--aries-astrolabe-meridian", "var(--morinus-angles)"],
  regio: ["--aries-astrolabe-regio", "var(--morinus-houses)"],
  regioZoomed: ["--aries-astrolabe-regio-zoomed", "var(--morinus-houses)"],
  contact: ["--aries-astrolabe-contact", "var(--morinus-aspect-conjunction)"],
  almucantar: ["--aries-astrolabe-almucantar", "var(--morinus-houses)"],
  azimuth: ["--aries-astrolabe-azimuth", "var(--morinus-houses)"],
  hour: ["--aries-astrolabe-hour", "var(--morinus-angles)"],
  capricorn: ["--aries-astrolabe-capricorn", "var(--morinus-frame)"],
  star: ["--aries-astrolabe-star", "var(--morinus-positions)"],
  starFaint: ["--aries-astrolabe-star-faint", "var(--morinus-houses)"],
  cardinal: ["--aries-astrolabe-cardinal", "var(--morinus-angles)"],
  sunFill: ["--aries-astrolabe-sun-fill", "var(--morinus-body-sun)"],
  primeVertical: ["--aries-astrolabe-prime-vertical", "var(--morinus-houses)"],
  earth: ["--aries-astrolabe-earth", "var(--morinus-positions)"],
  declination: ["--aries-astrolabe-declination", "var(--morinus-houses)"],
  // Term and decan boxes use the chart wheel's subdivision roles.
  termRing: ["--aries-astrolabe-term-ring", "var(--morinus-frame)"],
  termBoundary: ["--aries-astrolabe-term-boundary", "var(--morinus-frame)"],
  decanBoundary: ["--aries-astrolabe-decan-boundary", "var(--morinus-frame)"],
  subdivisionGlyph: ["--aries-astrolabe-subdivision-glyph", "var(--morinus-signs)"],
});

const ASTROLABE_RENDER_PALETTE_OPACITY: Readonly<Record<keyof AstrolabeRenderPalette, number>> = deepFreeze({
  background: 1,
  horizon: 0.86,
  ecliptic: 1,
  equator: 0.78,
  equatorLabel: 1,
  tropic: 0.58,
  meridian: 0.62,
  regio: 0.46,
  regioZoomed: 0.86,
  contact: 1,
  almucantar: 0.34,
  azimuth: 0.28,
  hour: 0.25,
  capricorn: 1,
  star: 0.88,
  starFaint: 1,
  cardinal: 1,
  sunFill: 1,
  primeVertical: 0.52,
  earth: 0.4,
  declination: 0.5,
  termRing: 1,
  termBoundary: 1,
  decanBoundary: 1,
  subdivisionGlyph: 1,
});

const CHART_COLOR_FALLBACKS: Readonly<Record<string, string>> = deepFreeze({
  "--morinus-background": "rgb(35 36 40)",
  "--morinus-text-bright": "rgb(255 255 255)",
  "--morinus-frame": "rgb(220 220 221)",
  "--morinus-angles": "rgb(205 205 209)",
  "--morinus-houses": "rgb(138 139 141)",
  "--morinus-positions": "rgb(255 255 255)",
  "--morinus-body-sun": "rgb(255 215 0)",
  "--morinus-aspect-conjunction": "rgb(246 0 206)",
  "--morinus-signs": "rgb(215 215 217)",
});

const CSS_VAR_ALIAS = /^var\((--[a-z0-9-]+)\)$/;

function resolveColorAlias(
  value: string,
  readCssValue: AstrolabeCssValueReader,
  seen: ReadonlySet<string> = new Set(),
): string {
  const match = CSS_VAR_ALIAS.exec(value.trim());
  if (!match) return value.trim();
  const cssVar = match[1];
  if (seen.has(cssVar)) return CHART_COLOR_FALLBACKS[cssVar] ?? "rgb(205 205 209)";
  const next = readCssValue(cssVar).trim() || CHART_COLOR_FALLBACKS[cssVar] || "";
  return next
    ? resolveColorAlias(next, readCssValue, new Set([...seen, cssVar]))
    : "rgb(205 205 209)";
}

export function colorWithOpacity(value: string, opacity: number): string {
  if (opacity >= 1) return value;
  const percent = Number((opacity * 100).toFixed(4));
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
    return `rgb(${channels[0]} ${channels[1]} ${channels[2]} / ${percent}%)`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s*(?:\/|,)\s*([\d.]+)%?)?\s*\)$/i.exec(value.trim());
  if (!rgb) return value;
  const existingOpacity = rgb[4]
    ? Math.min(1, Math.max(0, Number(rgb[4]) / (value.includes("%") ? 100 : 1)))
    : 1;
  const combinedPercent = Number((existingOpacity * opacity * 100).toFixed(4));
  return `rgb(${rgb[1]} ${rgb[2]} ${rgb[3]} / ${combinedPercent}%)`;
}

function defaultRenderTokens(): Readonly<AstrolabeRenderTokens> {
  const tokens = {} as AstrolabeRenderTokens;
  for (const key of Object.keys(ASTROLABE_RENDER_TOKEN_SPECS) as Array<keyof AstrolabeRenderTokens>) {
    tokens[key] = ASTROLABE_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

function defaultRenderPalette(): AstrolabeRenderPalette {
  return resolveAstrolabeRenderPalette();
}

export const DEFAULT_ASTROLABE_RENDER_TOKENS = defaultRenderTokens();
export const DEFAULT_ASTROLABE_RENDER_PALETTE = defaultRenderPalette();

export interface AstrolabeRenderStyle {
  readonly schemaVersion: typeof ASTROLABE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: AstrolabeStyleRevision;
  readonly palette: AstrolabeRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    signFontDivisor: number;
    planetFontDivisor: number;
    circleLabelFontDivisor: number;
    cardinalFontDivisor: number;
  }>;
  readonly strokes: Readonly<{
    fine: Readonly<{ min: number; divisor: number }>;
    medium: Readonly<{ min: number; divisor: number }>;
    main: Readonly<{ min: number; divisor: number }>;
    dashes: Readonly<{
      tropic: readonly [number, number];
      equator: readonly [number, number];
      regio: readonly [number, number];
      meridian: readonly [number, number];
      capricorn: readonly [number, number];
      connector: readonly [number, number];
    }>;
    connectorOpacity: number;
    sphereOutlineWidth: number;
  }>;
  readonly effects: Readonly<{
    atmosphericFillOpacity: number;
  }>;
  readonly layout: Readonly<{
    capricornFill: number;
    bandWidthScale: number;
    divisionSignShare: number;
    termBandScale: number;
    decanBandScale: number;
    divisionGlyphScale: number;
    divisionGlyphMin: number;
    polarDivisionBandScale: number;
    polarDivisionOpacity: number;
    bareEclipticTickScale: number;
    bareSignGlyphScale: number;
    eclipticScaleTick1: number;
    eclipticScaleTick5: number;
    eclipticScaleTick10: number;
    eclipticScaleWeight: number;
    eclipticBandWidthSteps: number;
    eclipticBandBoxDegrees: number;
    eclipticBandTickShare: number;
    tickStepScale: number;
    innerRadiusMin: number;
    signCullScale: number;
    bodyLabelPadScale: number;
    bodyCullScale: number;
    circleLabelOffsetX: number;
    circleLabelOffsetY: number;
    cardinalPadScale: number;
    polarRimFill: number;
    polarLaneGapScale: number;
    polarRingFontScale: number;
    polarAngleFontScale: number;
    polarStarLabelScale: number;
    polarLeaderOpacity: number;
  }>;
  readonly markers: Readonly<{
    starRadiusMin: number;
    starRadiusDivisor: number;
    starBrightLimit: number;
    starMagnitudeExponent: number;
    starScaleMin: number;
    starScaleMax: number;
    starFaintOpacity: number;
    sphereRadiusMin: number;
    sphereRadiusDivisor: number;
    sunSphereScale: number;
  }>;
  readonly zoom: Readonly<{
    rampStart: number;
    rampEnd: number;
    latticeFade: number;
    houseNumber: Readonly<{ exponent: number; cap: number }>;
    sphere: Readonly<{ exponent: number; cap: number }>;
    glyph: Readonly<{ exponent: number; cap: number }>;
    star: Readonly<{ exponent: number; cap: number }>;
    starLabel: Readonly<{ exponent: number; cap: number }>;
    notch: Readonly<{ halfLength: number; exponent: number; cap: number; rampStart: number; rampEnd: number; widthScale: number }>;
    disk: Readonly<{ threshold: number; fillOpacity: number; outlineOpacity: number }>;
    angle: Readonly<{ tickScale: number; labelScale: number }>;
    contact: Readonly<{ halfLength: number; glow: number; notchWidthScale: number }>;
  }>;
  readonly collision: Readonly<{
    marginScale: number;
    iterations: number;
    minDelta: number;
    tieDelta: number;
    pushScale: number;
    moveScale: number;
  }>;
}

export type AstrolabeCssValueReader = (cssVar: string) => string;

const POSITIVE_TOKEN_KEYS = new Set<keyof AstrolabeRenderTokens>([
  "capricornFill",
  "fineStrokeDivisor",
  "mediumStrokeDivisor",
  "mainStrokeDivisor",
  "starRadiusDivisor",
  "starScaleMin",
  "starScaleMax",
  "signFontDivisor",
  "sphereRadiusDivisor",
  "planetFontDivisor",
  "bodyCullScale",
  "collisionIterations",
  "sunSphereScale",
  "circleLabelFontDivisor",
  "cardinalFontDivisor",
  "polarRimFill",
  "polarRingFontScale",
  "polarAngleFontScale",
  "polarStarLabelScale",
  "zoomHouseNumberCap",
  "zoomSphereCap",
  "zoomGlyphCap",
  "zoomStarCap",
  "zoomStarLabelCap",
  "notchZoomCap",
]);

const OPACITY_TOKEN_KEYS = new Set<keyof AstrolabeRenderTokens>([
  "connectorOpacity",
  "atmosphericFillOpacity",
  "polarLeaderOpacity",
  "starFaintOpacity",
  "zoomLatticeFade",
  "diskFillOpacity",
  "diskOutlineOpacity",
]);

export function resolveAstrolabeRenderTokens(
  readCssValue: AstrolabeCssValueReader = () => "",
): Readonly<AstrolabeRenderTokens> {
  const tokens = {} as AstrolabeRenderTokens;
  for (const key of Object.keys(ASTROLABE_RENDER_TOKEN_SPECS) as Array<keyof AstrolabeRenderTokens>) {
    const [cssVar, fallback] = ASTROLABE_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value)
      && (POSITIVE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0)
      && (!OPACITY_TOKEN_KEYS.has(key) || value <= 1);
    tokens[key] = valid ? value : fallback;
  }
  tokens.collisionIterations = Math.max(1, Math.round(tokens.collisionIterations));
  return deepFreeze(tokens);
}

export function resolveAstrolabeRenderPalette(
  readCssValue: AstrolabeCssValueReader = () => "",
): AstrolabeRenderPalette {
  const palette = {} as Record<keyof AstrolabeRenderPalette, string>;
  for (const key of Object.keys(ASTROLABE_RENDER_PALETTE_SPECS) as Array<keyof AstrolabeRenderPalette>) {
    const [cssVar, chartAlias] = ASTROLABE_RENDER_PALETTE_SPECS[key];
    const candidate = readCssValue(cssVar).trim() || chartAlias;
    const resolved = resolveColorAlias(candidate, readCssValue);
    palette[key] = candidate.startsWith("var(")
      ? colorWithOpacity(resolved, ASTROLABE_RENDER_PALETTE_OPACITY[key])
      : resolved;
  }
  return deepFreeze(palette) as AstrolabeRenderPalette;
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "astrolabe-render-style-v3";

export type AstrolabeRenderStyleInput = {
  revision?: AstrolabeStyleRevision;
  palette?: AstrolabeRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<AstrolabeRenderTokens>;
};

export function createAstrolabeRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_ASTROLABE_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_ASTROLABE_RENDER_TOKENS,
}: AstrolabeRenderStyleInput = {}): AstrolabeRenderStyle {
  return deepFreeze({
    schemaVersion: ASTROLABE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: { ...palette },
    typography: {
      fontUi,
      fontSymbols,
      signFontDivisor: tokens.signFontDivisor,
      planetFontDivisor: tokens.planetFontDivisor,
      circleLabelFontDivisor: tokens.circleLabelFontDivisor,
      cardinalFontDivisor: tokens.cardinalFontDivisor,
    },
    strokes: {
      fine: { min: tokens.fineStrokeMin, divisor: tokens.fineStrokeDivisor },
      medium: { min: tokens.mediumStrokeMin, divisor: tokens.mediumStrokeDivisor },
      main: { min: tokens.mainStrokeMin, divisor: tokens.mainStrokeDivisor },
      dashes: {
        tropic: [tokens.tropicDashOn, tokens.tropicDashOff] as const,
        equator: [tokens.equatorDashOn, tokens.equatorDashOff] as const,
        regio: [tokens.regioDashOn, tokens.regioDashOff] as const,
        meridian: [tokens.meridianDashOn, tokens.meridianDashOff] as const,
        capricorn: [tokens.capricornDashOn, tokens.capricornDashOff] as const,
        connector: [tokens.connectorDashOn, tokens.connectorDashOff] as const,
      },
      connectorOpacity: tokens.connectorOpacity,
      sphereOutlineWidth: tokens.sphereOutlineWidth,
    },
    effects: {
      atmosphericFillOpacity: tokens.atmosphericFillOpacity,
    },
    layout: {
      capricornFill: tokens.capricornFill,
      bandWidthScale: tokens.bandWidthScale,
      divisionSignShare: tokens.divisionSignShare,
      termBandScale: tokens.termBandScale,
      decanBandScale: tokens.decanBandScale,
      divisionGlyphScale: tokens.divisionGlyphScale,
      divisionGlyphMin: tokens.divisionGlyphMin,
      polarDivisionBandScale: tokens.polarDivisionBandScale,
      polarDivisionOpacity: tokens.polarDivisionOpacity,
      bareEclipticTickScale: tokens.bareEclipticTickScale,
      bareSignGlyphScale: tokens.bareSignGlyphScale,
      eclipticScaleTick1: tokens.eclipticScaleTick1,
      eclipticScaleTick5: tokens.eclipticScaleTick5,
      eclipticScaleTick10: tokens.eclipticScaleTick10,
      eclipticScaleWeight: tokens.eclipticScaleWeight,
      eclipticBandWidthSteps: tokens.eclipticBandWidthSteps,
      eclipticBandBoxDegrees: tokens.eclipticBandBoxDegrees,
      eclipticBandTickShare: tokens.eclipticBandTickShare,
      tickStepScale: tokens.tickStepScale,
      innerRadiusMin: tokens.innerRadiusMin,
      signCullScale: tokens.signCullScale,
      bodyLabelPadScale: tokens.bodyLabelPadScale,
      bodyCullScale: tokens.bodyCullScale,
      circleLabelOffsetX: tokens.circleLabelOffsetX,
      circleLabelOffsetY: tokens.circleLabelOffsetY,
      cardinalPadScale: tokens.cardinalPadScale,
      polarRimFill: tokens.polarRimFill,
      polarLaneGapScale: tokens.polarLaneGapScale,
      polarRingFontScale: tokens.polarRingFontScale,
      polarAngleFontScale: tokens.polarAngleFontScale,
      polarStarLabelScale: tokens.polarStarLabelScale,
      polarLeaderOpacity: tokens.polarLeaderOpacity,
    },
    markers: {
      starRadiusMin: tokens.starRadiusMin,
      starRadiusDivisor: tokens.starRadiusDivisor,
      starBrightLimit: tokens.starBrightLimit,
      starMagnitudeExponent: tokens.starMagnitudeExponent,
      starScaleMin: tokens.starScaleMin,
      starScaleMax: tokens.starScaleMax,
      starFaintOpacity: tokens.starFaintOpacity,
      sphereRadiusMin: tokens.sphereRadiusMin,
      sphereRadiusDivisor: tokens.sphereRadiusDivisor,
      sunSphereScale: tokens.sunSphereScale,
    },
    zoom: {
      rampStart: tokens.zoomRampStart,
      rampEnd: Math.max(tokens.zoomRampStart, tokens.zoomRampEnd),
      latticeFade: tokens.zoomLatticeFade,
      houseNumber: { exponent: tokens.zoomHouseNumberExponent, cap: tokens.zoomHouseNumberCap },
      sphere: { exponent: tokens.zoomSphereExponent, cap: tokens.zoomSphereCap },
      glyph: { exponent: tokens.zoomGlyphExponent, cap: tokens.zoomGlyphCap },
      star: { exponent: tokens.zoomStarExponent, cap: tokens.zoomStarCap },
      starLabel: { exponent: tokens.zoomStarLabelExponent, cap: tokens.zoomStarLabelCap },
      notch: {
        halfLength: tokens.notchHalfLength,
        exponent: tokens.notchZoomExponent,
        cap: tokens.notchZoomCap,
        rampStart: tokens.notchRampStart,
        rampEnd: Math.max(tokens.notchRampStart, tokens.notchRampEnd),
        widthScale: tokens.notchWidthScale,
      },
      disk: {
        threshold: tokens.diskThreshold,
        fillOpacity: tokens.diskFillOpacity,
        outlineOpacity: tokens.diskOutlineOpacity,
      },
      angle: { tickScale: tokens.angleTickScale, labelScale: tokens.angleLabelScale },
      contact: {
        halfLength: tokens.contactHalfLength,
        glow: tokens.contactGlow,
        notchWidthScale: tokens.notchContactWidthScale,
      },
    },
    collision: {
      marginScale: tokens.collisionMarginScale,
      iterations: tokens.collisionIterations,
      minDelta: tokens.collisionMinDelta,
      tieDelta: tokens.collisionTieDelta,
      pushScale: tokens.collisionPushScale,
      moveScale: tokens.collisionMoveScale,
    },
  }) as AstrolabeRenderStyle;
}

export function resolveAstrolabeRenderStyle(
  host: HTMLElement | null,
  input: Omit<AstrolabeRenderStyleInput, "palette" | "tokens"> = {},
): AstrolabeRenderStyle {
  const computed = host ? window.getComputedStyle(host) : null;
  const read = (cssVar: string) => computed?.getPropertyValue(cssVar) ?? "";
  return createAstrolabeRenderStyle({
    ...input,
    tokens: resolveAstrolabeRenderTokens(read),
    palette: resolveAstrolabeRenderPalette(read),
  });
}

/** Planet glyph font size (CSS px at 1x zoom) last painted on this canvas,
 * read back by the design tuner. */
export const ASTROLABE_PLANET_GLYPH_PX_ATTR = "data-planet-glyph-px";

export function markAstrolabePlanetGlyphSize(canvas: HTMLCanvasElement, px: number) {
  // Offscreen and test canvases carry no DOM attributes.
  if (typeof canvas.setAttribute !== "function") return;
  const value = px.toFixed(1);
  if (canvas.getAttribute(ASTROLABE_PLANET_GLYPH_PX_ATTR) !== value) {
    canvas.setAttribute(ASTROLABE_PLANET_GLYPH_PX_ATTR, value);
  }
}

export type AstrolabeStrokeWidths = Readonly<{ fine: number; medium: number; main: number }>;

/** Smooth CSS-pixel stroke hierarchy: etched plate, rete, then structural rim. */
export function resolveAstrolabeStrokeWidths(
  style: AstrolabeRenderStyle,
  size: number,
): AstrolabeStrokeWidths {
  const width = (minimum: number, divisor: number) => (
    Math.round(Math.max(minimum, size / divisor) * 100) / 100
  );
  return deepFreeze({
    fine: width(style.strokes.fine.min, style.strokes.fine.divisor),
    medium: width(style.strokes.medium.min, style.strokes.medium.divisor),
    main: width(style.strokes.main.min, style.strokes.main.divisor),
  });
}
