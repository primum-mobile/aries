// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type EphemerisStyleRevision = string | number;

export type EphemerisRenderPalette = Readonly<{
  background: string;
  frame: string;
  texts: string;
  grid: string;
  signs: string;
}>;

export type EphemerisRenderTokens = {
  minCanvasWidth: number;
  minCanvasHeight: number;
  planetFontDivisor: number;
  borderPlanetScale: number;
  spaceDivisor: number;
  plotLeftBorderScale: number;
  plotRightBorderScale: number;
  axisXBorderScale: number;
  axisSignXBorderScale: number;
  outerBorderScale: number;
  bottomAxisBorderScale: number;
  signOuterMarginRows: number;
  axisReserveSignScale: number;
  signFontScale: number;
  monthColumns: number;
  textFontDivisor: number;
  frameSmallMax: number;
  frameMediumMax: number;
  frameWidthSmall: number;
  frameWidthMedium: number;
  frameWidthLarge: number;
  curveSmallMax: number;
  curveWidthSmall: number;
  curveWidthLarge: number;
  gridLineWidth: number;
  gridDashOn: number;
  gridDashOff: number;
  stationTickScale: number;
  stationTickMin: number;
  stationTickMax: number;
  stationTickLineWidth: number;
  eventGlyphScale: number;
  eventGlyphMin: number;
  eventGlyphMax: number;
  eventCodeOffsetXMin: number;
  eventCodeOffsetYMin: number;
  leftPlanetLabelGapSpaces: number;
  edgeWrapLabelGapSpaces: number;
  labelYGapSpaces: number;
  relaxIterations: number;
  stationSnapX: number;
  stationSnapY: number;
};

type EphemerisRenderTokenSpecs = {
  readonly [K in keyof EphemerisRenderTokens]: readonly [cssVar: string, fallback: number];
};

function freezeTokenSpecs(specs: EphemerisRenderTokenSpecs): Readonly<EphemerisRenderTokenSpecs> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

export const EPHEMERIS_RENDER_TOKEN_SPECS = freezeTokenSpecs({
  minCanvasWidth: ["--aries-ephem-min-canvas-width", 40],
  minCanvasHeight: ["--aries-ephem-min-canvas-height", 40],
  planetFontDivisor: ["--aries-ephem-planet-font-divisor", 40],
  borderPlanetScale: ["--aries-ephem-border-planet-scale", 1],
  spaceDivisor: ["--aries-ephem-space-divisor", 3],
  plotLeftBorderScale: ["--aries-ephem-plot-left-border-scale", 2],
  plotRightBorderScale: ["--aries-ephem-plot-right-border-scale", 2],
  axisXBorderScale: ["--aries-ephem-axis-x-border-scale", 2],
  axisSignXBorderScale: ["--aries-ephem-axis-sign-x-border-scale", 2],
  outerBorderScale: ["--aries-ephem-outer-border-scale", 1],
  bottomAxisBorderScale: ["--aries-ephem-bottom-axis-border-scale", 4],
  signOuterMarginRows: ["--aries-ephem-sign-outer-margin-rows", 2],
  axisReserveSignScale: ["--aries-ephem-axis-reserve-sign-scale", 0.5],
  signFontScale: ["--aries-ephem-sign-font-scale", 1],
  monthColumns: ["--aries-ephem-month-columns", 13],
  textFontDivisor: ["--aries-ephem-text-font-divisor", 3],
  frameSmallMax: ["--aries-ephem-frame-small-max", 400],
  frameMediumMax: ["--aries-ephem-frame-medium-max", 600],
  frameWidthSmall: ["--aries-ephem-frame-width-small", 2],
  frameWidthMedium: ["--aries-ephem-frame-width-medium", 3],
  frameWidthLarge: ["--aries-ephem-frame-width-large", 4],
  curveSmallMax: ["--aries-ephem-curve-small-max", 500],
  curveWidthSmall: ["--aries-ephem-curve-width-small", 1],
  curveWidthLarge: ["--aries-ephem-curve-width-large", 2],
  gridLineWidth: ["--aries-ephem-grid-line-width", 1],
  gridDashOn: ["--aries-ephem-grid-dash-on", 6],
  gridDashOff: ["--aries-ephem-grid-dash-off", 3],
  stationTickScale: ["--aries-ephem-station-tick-scale", 0.22],
  stationTickMin: ["--aries-ephem-station-tick-min", 4],
  stationTickMax: ["--aries-ephem-station-tick-max", 9],
  stationTickLineWidth: ["--aries-ephem-station-tick-line-width", 1],
  eventGlyphScale: ["--aries-ephem-event-glyph-scale", 0.9],
  eventGlyphMin: ["--aries-ephem-event-glyph-min", 6],
  eventGlyphMax: ["--aries-ephem-event-glyph-max", 10],
  eventCodeOffsetXMin: ["--aries-ephem-event-code-offset-x-min", 2],
  eventCodeOffsetYMin: ["--aries-ephem-event-code-offset-y-min", 1],
  leftPlanetLabelGapSpaces: ["--aries-ephem-left-planet-label-gap-spaces", 3],
  edgeWrapLabelGapSpaces: ["--aries-ephem-edge-wrap-label-gap-spaces", 2],
  labelYGapSpaces: ["--aries-ephem-label-y-gap-spaces", 1],
  relaxIterations: ["--aries-ephem-relax-iterations", 30],
  stationSnapX: ["--aries-ephem-station-snap-x", 10],
  stationSnapY: ["--aries-ephem-station-snap-y", 16],
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
  grid: "#808080",
  signs: "#000000",
});

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "ephemeris-render-style-v1";

export interface EphemerisRenderStyle {
  readonly schemaVersion: typeof EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: EphemerisStyleRevision;
  readonly palette: EphemerisRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    planetFontDivisor: number;
    signFontScale: number;
    textFontDivisor: number;
  }>;
  readonly strokes: Readonly<{
    frameSmallMax: number;
    frameMediumMax: number;
    frameWidthSmall: number;
    frameWidthMedium: number;
    frameWidthLarge: number;
    curveSmallMax: number;
    curveWidthSmall: number;
    curveWidthLarge: number;
    gridLineWidth: number;
    gridDashOn: number;
    gridDashOff: number;
    stationTickLineWidth: number;
  }>;
  readonly markers: Readonly<{
    stationTickScale: number;
    stationTickMin: number;
    stationTickMax: number;
    eventGlyphScale: number;
    eventGlyphMin: number;
    eventGlyphMax: number;
    eventCodeOffsetXMin: number;
    eventCodeOffsetYMin: number;
  }>;
  readonly labels: Readonly<{
    leftPlanetLabelGapSpaces: number;
    edgeWrapLabelGapSpaces: number;
    labelYGapSpaces: number;
    relaxIterations: number;
  }>;
  readonly layout: Readonly<{
    minCanvasWidth: number;
    minCanvasHeight: number;
    borderPlanetScale: number;
    spaceDivisor: number;
    plotLeftBorderScale: number;
    plotRightBorderScale: number;
    axisXBorderScale: number;
    axisSignXBorderScale: number;
    outerBorderScale: number;
    bottomAxisBorderScale: number;
    signOuterMarginRows: number;
    axisReserveSignScale: number;
    monthColumns: number;
  }>;
  readonly interaction: Readonly<{
    stationSnapX: number;
    stationSnapY: number;
  }>;
}

export type EphemerisCssValueReader = (cssVar: string) => string;

/** Pure CSS-number resolution preserving the established parseFloat and
 * non-negative fallback behavior. Units remain owned by the CSS contract. */
export function resolveEphemerisRenderTokens(
  readCssValue: EphemerisCssValueReader = () => "",
): Readonly<EphemerisRenderTokens> {
  const tokens = {} as EphemerisRenderTokens;
  for (const key of Object.keys(EPHEMERIS_RENDER_TOKEN_SPECS) as Array<keyof EphemerisRenderTokens>) {
    const [cssVar, fallback] = EPHEMERIS_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    tokens[key] = Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  return Object.freeze(tokens);
}

export function readEphemerisRenderTokens(
  host: HTMLElement | null,
): Readonly<EphemerisRenderTokens> {
  const computed = host ? window.getComputedStyle(host) : null;
  return resolveEphemerisRenderTokens((cssVar) => computed?.getPropertyValue(cssVar) ?? "");
}

export function createEphemerisRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_EPHEMERIS_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_EPHEMERIS_RENDER_TOKENS,
}: {
  revision?: EphemerisStyleRevision;
  palette?: EphemerisRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<EphemerisRenderTokens>;
} = {}): EphemerisRenderStyle {
  return Object.freeze({
    schemaVersion: EPHEMERIS_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: Object.freeze({ ...palette }),
    typography: Object.freeze({
      fontUi,
      fontSymbols,
      planetFontDivisor: tokens.planetFontDivisor,
      signFontScale: tokens.signFontScale,
      textFontDivisor: tokens.textFontDivisor,
    }),
    strokes: Object.freeze({
      frameSmallMax: tokens.frameSmallMax,
      frameMediumMax: tokens.frameMediumMax,
      frameWidthSmall: tokens.frameWidthSmall,
      frameWidthMedium: tokens.frameWidthMedium,
      frameWidthLarge: tokens.frameWidthLarge,
      curveSmallMax: tokens.curveSmallMax,
      curveWidthSmall: tokens.curveWidthSmall,
      curveWidthLarge: tokens.curveWidthLarge,
      gridLineWidth: tokens.gridLineWidth,
      gridDashOn: tokens.gridDashOn,
      gridDashOff: tokens.gridDashOff,
      stationTickLineWidth: tokens.stationTickLineWidth,
    }),
    markers: Object.freeze({
      stationTickScale: tokens.stationTickScale,
      stationTickMin: tokens.stationTickMin,
      stationTickMax: tokens.stationTickMax,
      eventGlyphScale: tokens.eventGlyphScale,
      eventGlyphMin: tokens.eventGlyphMin,
      eventGlyphMax: tokens.eventGlyphMax,
      eventCodeOffsetXMin: tokens.eventCodeOffsetXMin,
      eventCodeOffsetYMin: tokens.eventCodeOffsetYMin,
    }),
    labels: Object.freeze({
      leftPlanetLabelGapSpaces: tokens.leftPlanetLabelGapSpaces,
      edgeWrapLabelGapSpaces: tokens.edgeWrapLabelGapSpaces,
      labelYGapSpaces: tokens.labelYGapSpaces,
      relaxIterations: tokens.relaxIterations,
    }),
    layout: Object.freeze({
      minCanvasWidth: tokens.minCanvasWidth,
      minCanvasHeight: tokens.minCanvasHeight,
      borderPlanetScale: tokens.borderPlanetScale,
      spaceDivisor: tokens.spaceDivisor,
      plotLeftBorderScale: tokens.plotLeftBorderScale,
      plotRightBorderScale: tokens.plotRightBorderScale,
      axisXBorderScale: tokens.axisXBorderScale,
      axisSignXBorderScale: tokens.axisSignXBorderScale,
      outerBorderScale: tokens.outerBorderScale,
      bottomAxisBorderScale: tokens.bottomAxisBorderScale,
      signOuterMarginRows: tokens.signOuterMarginRows,
      axisReserveSignScale: tokens.axisReserveSignScale,
      monthColumns: tokens.monthColumns,
    }),
    interaction: Object.freeze({
      stationSnapX: tokens.stationSnapX,
      stationSnapY: tokens.stationSnapY,
    }),
  });
}

/** Resolve one immutable style snapshot from the host's computed CSS. Callers
 * retain and share this exact object across paint and interaction paths. */
export function resolveEphemerisRenderStyle(
  host: HTMLElement | null,
  input: Omit<Parameters<typeof createEphemerisRenderStyle>[0], "tokens"> = {},
): EphemerisRenderStyle {
  return createEphemerisRenderStyle({
    ...input,
    tokens: readEphemerisRenderTokens(host),
  });
}
