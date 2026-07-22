// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MUNDANE_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type MundaneStyleRevision = string | number;

export type MundaneRenderPalette = Readonly<{
  background: string;
  frame: string;
  ascmc: string;
  houses: string;
  houseNumbers: string;
  positions: string;
}>;

export type MundaneRenderTokens = {
  minimumSide: number;
  compoundSectorScale: number;
  singleSectorScale: number;
  planetLineScale: number;
  singleHouseOffsetAdjustment: number;
  outerMaxScale: number;
  compoundHouseBandScale: number;
  compoundOuterInsetScale: number;
  singleOuterScale: number;
  singleAscMcScale: number;
  arrowScale: number;
  degreeTickScale: number;
  fiveDegreeTickScale: number;
  tenDegreeTickScale: number;
  motionMarkerScale: number;
  compoundPositionScale: number;
  singlePositionScale: number;
  compoundBaseScale: number;
  singleBaseScale: number;
  glyphCenterDivisor: number;
  motionCenterDivisor: number;
  houseLabelOffsetDivisor: number;
  secondHouseXOffsetDivisor: number;
  symbolMin: number;
  compoundSymbolDivisor: number;
  singleSymbolDivisor: number;
  fontMin: number;
  textDivisor: number;
  smallTextDivisor: number;
  smallMax: number;
  mediumMax: number;
  hairlineWidth: number;
  heavySmall: number;
  heavyMedium: number;
  heavyLarge: number;
  tenDegreeSmall: number;
  tenDegreeLarge: number;
  planetLineSmall: number;
  planetLineLarge: number;
  ascMcMinWidth: number;
  ascMcConfiguredDefault: number;
  ascMcSmallConfiguredMin: number;
  ascMcMediumConfiguredMin: number;
  ascMcConfiguredMax: number;
  ascMcSmallWidth: number;
  ascMcMediumWidth: number;
  aspectWidthMin: number;
  aspectWidthScale: number;
  aspectOpacityBase: number;
  aspectOpacityRange: number;
  aspectDashThreshold: number;
  aspectDashOn: number;
  aspectDashOff: number;
  collisionStep: number;
  collisionMaxIterations: number;
  bodyHitPadMin: number;
  bodyHitPadScale: number;
  aspectHitToleranceMin: number;
  aspectHitToleranceScale: number;
  overlayCompactMax: number;
  overlaySymbolDivisor: number;
  overlayCompactFontMin: number;
  overlayRegularFontMin: number;
  overlayCompactFontScale: number;
  overlayRegularFontScale: number;
  overlayCompactInsetMin: number;
  overlayRegularInsetMin: number;
  overlayInsetDivisor: number;
  overlayTitlebarSafeTop: number;
  overlayLineHeight: number;
};

type MundaneRenderTokenSpecs = {
  readonly [K in keyof MundaneRenderTokens]: readonly [cssVar: string, fallback: number];
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const MUNDANE_RENDER_TOKEN_SPECS: Readonly<MundaneRenderTokenSpecs> = deepFreeze({
  minimumSide: ["--aries-mundane-minimum-side", 120],
  compoundSectorScale: ["--aries-mundane-compound-sector-scale", 0.15],
  singleSectorScale: ["--aries-mundane-single-sector-scale", 0.18],
  planetLineScale: ["--aries-mundane-planet-line-scale", 0.03],
  singleHouseOffsetAdjustment: ["--aries-mundane-single-house-offset-adjustment", 0.01],
  outerMaxScale: ["--aries-mundane-outer-max-scale", 0.97],
  compoundHouseBandScale: ["--aries-mundane-compound-house-band-scale", 0.06],
  compoundOuterInsetScale: ["--aries-mundane-compound-outer-inset-scale", 0.12],
  singleOuterScale: ["--aries-mundane-single-outer-scale", 0.96],
  singleAscMcScale: ["--aries-mundane-single-ascmc-scale", 0.88],
  arrowScale: ["--aries-mundane-arrow-scale", 0.04],
  degreeTickScale: ["--aries-mundane-degree-tick-scale", 0.01],
  fiveDegreeTickScale: ["--aries-mundane-five-degree-tick-scale", 0.02],
  tenDegreeTickScale: ["--aries-mundane-ten-degree-tick-scale", 0.03],
  motionMarkerScale: ["--aries-mundane-motion-marker-scale", 0.01],
  compoundPositionScale: ["--aries-mundane-compound-position-scale", 0.45],
  singlePositionScale: ["--aries-mundane-single-position-scale", 0.55],
  compoundBaseScale: ["--aries-mundane-compound-base-scale", 0.11],
  singleBaseScale: ["--aries-mundane-single-base-scale", 0.2],
  glyphCenterDivisor: ["--aries-mundane-glyph-center-divisor", 2],
  motionCenterDivisor: ["--aries-mundane-motion-center-divisor", 8],
  houseLabelOffsetDivisor: ["--aries-mundane-house-label-offset-divisor", 4],
  secondHouseXOffsetDivisor: ["--aries-mundane-second-house-x-offset-divisor", 8],
  symbolMin: ["--aries-mundane-symbol-min", 8],
  compoundSymbolDivisor: ["--aries-mundane-compound-symbol-divisor", 16],
  singleSymbolDivisor: ["--aries-mundane-single-symbol-divisor", 12],
  fontMin: ["--aries-mundane-font-min", 6],
  textDivisor: ["--aries-mundane-text-divisor", 2],
  smallTextDivisor: ["--aries-mundane-small-text-divisor", 4],
  smallMax: ["--aries-mundane-small-max", 400],
  mediumMax: ["--aries-mundane-medium-max", 600],
  hairlineWidth: ["--aries-mundane-hairline-width", 1],
  heavySmall: ["--aries-mundane-heavy-small", 1],
  heavyMedium: ["--aries-mundane-heavy-medium", 2],
  heavyLarge: ["--aries-mundane-heavy-large", 3],
  tenDegreeSmall: ["--aries-mundane-ten-degree-small", 1],
  tenDegreeLarge: ["--aries-mundane-ten-degree-large", 2],
  planetLineSmall: ["--aries-mundane-planet-line-small", 1],
  planetLineLarge: ["--aries-mundane-planet-line-large", 2],
  ascMcMinWidth: ["--aries-mundane-ascmc-min-width", 1],
  ascMcConfiguredDefault: ["--aries-mundane-ascmc-configured-default", 5],
  ascMcSmallConfiguredMin: ["--aries-mundane-ascmc-small-configured-min", 3],
  ascMcMediumConfiguredMin: ["--aries-mundane-ascmc-medium-configured-min", 4],
  ascMcConfiguredMax: ["--aries-mundane-ascmc-configured-max", 5],
  ascMcSmallWidth: ["--aries-mundane-ascmc-small-width", 2],
  ascMcMediumWidth: ["--aries-mundane-ascmc-medium-width", 3],
  aspectWidthMin: ["--aries-mundane-aspect-width-min", 1],
  aspectWidthScale: ["--aries-mundane-aspect-width-scale", 2],
  aspectOpacityBase: ["--aries-mundane-aspect-opacity-base", 0.35],
  aspectOpacityRange: ["--aries-mundane-aspect-opacity-range", 0.65],
  aspectDashThreshold: ["--aries-mundane-aspect-dash-threshold", 0.25],
  aspectDashOn: ["--aries-mundane-aspect-dash-on", 6],
  aspectDashOff: ["--aries-mundane-aspect-dash-off", 6],
  collisionStep: ["--aries-mundane-collision-step", 0.1],
  collisionMaxIterations: ["--aries-mundane-collision-max-iterations", 5000],
  bodyHitPadMin: ["--aries-mundane-body-hit-pad-min", 6],
  bodyHitPadScale: ["--aries-mundane-body-hit-pad-scale", 0.45],
  aspectHitToleranceMin: ["--aries-mundane-aspect-hit-tolerance-min", 5],
  aspectHitToleranceScale: ["--aries-mundane-aspect-hit-tolerance-scale", 0.32],
  overlayCompactMax: ["--aries-mundane-overlay-compact-max", 390],
  overlaySymbolDivisor: ["--aries-mundane-overlay-symbol-divisor", 32],
  overlayCompactFontMin: ["--aries-mundane-overlay-compact-font-min", 11],
  overlayRegularFontMin: ["--aries-mundane-overlay-regular-font-min", 10],
  overlayCompactFontScale: ["--aries-mundane-overlay-compact-font-scale", 0.86],
  overlayRegularFontScale: ["--aries-mundane-overlay-regular-font-scale", 0.75],
  overlayCompactInsetMin: ["--aries-mundane-overlay-compact-inset-min", 10],
  overlayRegularInsetMin: ["--aries-mundane-overlay-regular-inset-min", 0],
  overlayInsetDivisor: ["--aries-mundane-overlay-inset-divisor", 25],
  overlayTitlebarSafeTop: ["--aries-mundane-overlay-titlebar-safe-top", 14],
  overlayLineHeight: ["--aries-mundane-overlay-line-height", 1.1],
});

const POSITIVE_TOKEN_KEYS = new Set<keyof MundaneRenderTokens>([
  "minimumSide",
  "glyphCenterDivisor",
  "motionCenterDivisor",
  "houseLabelOffsetDivisor",
  "secondHouseXOffsetDivisor",
  "compoundSymbolDivisor",
  "singleSymbolDivisor",
  "textDivisor",
  "smallTextDivisor",
  "smallMax",
  "mediumMax",
  "collisionStep",
  "collisionMaxIterations",
  "overlaySymbolDivisor",
  "overlayInsetDivisor",
]);

function defaultRenderTokens(): Readonly<MundaneRenderTokens> {
  const tokens = {} as MundaneRenderTokens;
  for (const key of Object.keys(MUNDANE_RENDER_TOKEN_SPECS) as Array<keyof MundaneRenderTokens>) {
    tokens[key] = MUNDANE_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

export const DEFAULT_MUNDANE_RENDER_TOKENS = defaultRenderTokens();

export const DEFAULT_MUNDANE_RENDER_PALETTE: MundaneRenderPalette = deepFreeze({
  background: "#232428",
  frame: "#dcdcdd",
  ascmc: "#cdcdd1",
  houses: "#8a8b8d",
  houseNumbers: "#8a8b8d",
  positions: "#ffffff",
});

export interface MundaneRenderStyle {
  readonly schemaVersion: typeof MUNDANE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: MundaneStyleRevision;
  readonly palette: MundaneRenderPalette;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    symbolMin: number;
    compoundSymbolDivisor: number;
    singleSymbolDivisor: number;
    fontMin: number;
    textDivisor: number;
    smallTextDivisor: number;
  }>;
  readonly strokes: Readonly<{
    smallMax: number;
    mediumMax: number;
    hairline: number;
    heavySmall: number;
    heavyMedium: number;
    heavyLarge: number;
    tenDegreeSmall: number;
    tenDegreeLarge: number;
    planetLineSmall: number;
    planetLineLarge: number;
    ascMcMinWidth: number;
    ascMcConfiguredDefault: number;
    ascMcSmallConfiguredMin: number;
    ascMcMediumConfiguredMin: number;
    ascMcConfiguredMax: number;
    ascMcSmallWidth: number;
    ascMcMediumWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
  }>;
  readonly layout: Readonly<{
    minimumSide: number;
    compoundSectorScale: number;
    singleSectorScale: number;
    planetLineScale: number;
    singleHouseOffsetAdjustment: number;
    outerMaxScale: number;
    compoundHouseBandScale: number;
    compoundOuterInsetScale: number;
    singleOuterScale: number;
    singleAscMcScale: number;
    arrowScale: number;
    degreeTickScale: number;
    fiveDegreeTickScale: number;
    tenDegreeTickScale: number;
    motionMarkerScale: number;
    compoundPositionScale: number;
    singlePositionScale: number;
    compoundBaseScale: number;
    singleBaseScale: number;
    glyphCenterDivisor: number;
    motionCenterDivisor: number;
    houseLabelOffsetDivisor: number;
    secondHouseXOffsetDivisor: number;
  }>;
  readonly aspects: Readonly<{
    widthMin: number;
    widthScale: number;
    opacityBase: number;
    opacityRange: number;
    dashThreshold: number;
    dashOn: number;
    dashOff: number;
  }>;
  readonly interaction: Readonly<{
    collisionStep: number;
    collisionMaxIterations: number;
    bodyHitPadMin: number;
    bodyHitPadScale: number;
    aspectHitToleranceMin: number;
    aspectHitToleranceScale: number;
  }>;
  readonly overlays: Readonly<{
    compactMax: number;
    symbolDivisor: number;
    compactFontMin: number;
    regularFontMin: number;
    compactFontScale: number;
    regularFontScale: number;
    compactInsetMin: number;
    regularInsetMin: number;
    insetDivisor: number;
    titlebarSafeTop: number;
    lineHeight: number;
  }>;
}

export type MundaneCssValueReader = (cssVar: string) => string;

export function resolveMundaneRenderTokens(
  readCssValue: MundaneCssValueReader = () => "",
): Readonly<MundaneRenderTokens> {
  const tokens = {} as MundaneRenderTokens;
  for (const key of Object.keys(MUNDANE_RENDER_TOKEN_SPECS) as Array<keyof MundaneRenderTokens>) {
    const [cssVar, fallback] = MUNDANE_RENDER_TOKEN_SPECS[key];
    const value = Number.parseFloat(readCssValue(cssVar).trim());
    const valid = Number.isFinite(value) && (POSITIVE_TOKEN_KEYS.has(key) ? value > 0 : value >= 0);
    tokens[key] = valid ? value : fallback;
  }
  return deepFreeze(tokens);
}

function readMundaneRenderTokens(host: HTMLElement | null): Readonly<MundaneRenderTokens> {
  const computed = host ? window.getComputedStyle(host) : null;
  return resolveMundaneRenderTokens((cssVar) => computed?.getPropertyValue(cssVar) ?? "");
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "mundane-render-style-v1";

export function createMundaneRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_MUNDANE_RENDER_PALETTE,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_MUNDANE_RENDER_TOKENS,
}: {
  revision?: MundaneStyleRevision;
  palette?: MundaneRenderPalette;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<MundaneRenderTokens>;
} = {}): MundaneRenderStyle {
  return deepFreeze({
    schemaVersion: MUNDANE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: { ...palette },
    typography: {
      fontUi,
      fontSymbols,
      symbolMin: tokens.symbolMin,
      compoundSymbolDivisor: tokens.compoundSymbolDivisor,
      singleSymbolDivisor: tokens.singleSymbolDivisor,
      fontMin: tokens.fontMin,
      textDivisor: tokens.textDivisor,
      smallTextDivisor: tokens.smallTextDivisor,
    },
    strokes: {
      smallMax: tokens.smallMax,
      mediumMax: tokens.mediumMax,
      hairline: tokens.hairlineWidth,
      heavySmall: tokens.heavySmall,
      heavyMedium: tokens.heavyMedium,
      heavyLarge: tokens.heavyLarge,
      tenDegreeSmall: tokens.tenDegreeSmall,
      tenDegreeLarge: tokens.tenDegreeLarge,
      planetLineSmall: tokens.planetLineSmall,
      planetLineLarge: tokens.planetLineLarge,
      ascMcMinWidth: tokens.ascMcMinWidth,
      ascMcConfiguredDefault: tokens.ascMcConfiguredDefault,
      ascMcSmallConfiguredMin: tokens.ascMcSmallConfiguredMin,
      ascMcMediumConfiguredMin: tokens.ascMcMediumConfiguredMin,
      ascMcConfiguredMax: tokens.ascMcConfiguredMax,
      ascMcSmallWidth: tokens.ascMcSmallWidth,
      ascMcMediumWidth: tokens.ascMcMediumWidth,
      lineCap: "butt" as const,
      lineJoin: "miter" as const,
    },
    layout: {
      minimumSide: tokens.minimumSide,
      compoundSectorScale: tokens.compoundSectorScale,
      singleSectorScale: tokens.singleSectorScale,
      planetLineScale: tokens.planetLineScale,
      singleHouseOffsetAdjustment: tokens.singleHouseOffsetAdjustment,
      outerMaxScale: tokens.outerMaxScale,
      compoundHouseBandScale: tokens.compoundHouseBandScale,
      compoundOuterInsetScale: tokens.compoundOuterInsetScale,
      singleOuterScale: tokens.singleOuterScale,
      singleAscMcScale: tokens.singleAscMcScale,
      arrowScale: tokens.arrowScale,
      degreeTickScale: tokens.degreeTickScale,
      fiveDegreeTickScale: tokens.fiveDegreeTickScale,
      tenDegreeTickScale: tokens.tenDegreeTickScale,
      motionMarkerScale: tokens.motionMarkerScale,
      compoundPositionScale: tokens.compoundPositionScale,
      singlePositionScale: tokens.singlePositionScale,
      compoundBaseScale: tokens.compoundBaseScale,
      singleBaseScale: tokens.singleBaseScale,
      glyphCenterDivisor: tokens.glyphCenterDivisor,
      motionCenterDivisor: tokens.motionCenterDivisor,
      houseLabelOffsetDivisor: tokens.houseLabelOffsetDivisor,
      secondHouseXOffsetDivisor: tokens.secondHouseXOffsetDivisor,
    },
    aspects: {
      widthMin: tokens.aspectWidthMin,
      widthScale: tokens.aspectWidthScale,
      opacityBase: tokens.aspectOpacityBase,
      opacityRange: tokens.aspectOpacityRange,
      dashThreshold: tokens.aspectDashThreshold,
      dashOn: tokens.aspectDashOn,
      dashOff: tokens.aspectDashOff,
    },
    interaction: {
      collisionStep: tokens.collisionStep,
      collisionMaxIterations: tokens.collisionMaxIterations,
      bodyHitPadMin: tokens.bodyHitPadMin,
      bodyHitPadScale: tokens.bodyHitPadScale,
      aspectHitToleranceMin: tokens.aspectHitToleranceMin,
      aspectHitToleranceScale: tokens.aspectHitToleranceScale,
    },
    overlays: {
      compactMax: tokens.overlayCompactMax,
      symbolDivisor: tokens.overlaySymbolDivisor,
      compactFontMin: tokens.overlayCompactFontMin,
      regularFontMin: tokens.overlayRegularFontMin,
      compactFontScale: tokens.overlayCompactFontScale,
      regularFontScale: tokens.overlayRegularFontScale,
      compactInsetMin: tokens.overlayCompactInsetMin,
      regularInsetMin: tokens.overlayRegularInsetMin,
      insetDivisor: tokens.overlayInsetDivisor,
      titlebarSafeTop: tokens.overlayTitlebarSafeTop,
      lineHeight: tokens.overlayLineHeight,
    },
  });
}

export const DEFAULT_MUNDANE_RENDER_STYLE = createMundaneRenderStyle();

export function resolveMundaneRenderStyle(
  host: HTMLElement | null,
  input: Omit<Parameters<typeof createMundaneRenderStyle>[0], "tokens"> = {},
): MundaneRenderStyle {
  return createMundaneRenderStyle({
    ...input,
    tokens: readMundaneRenderTokens(host),
  });
}

export type MundaneLayout = Readonly<{
  compound: boolean;
  side: number;
  cx: number;
  cy: number;
  maxradius: number;
  symbolSize: number;
  r30: number;
  rHouse: number;
  rASCMC: number;
  rArrow: number;
  r0: number;
  r1: number;
  r5: number;
  r10: number;
  rInner: number;
  rLLine: number;
  rPlanet: number;
  rAsp: number;
  rLLine2: number;
  rRetr: number;
  rPos: number;
  rBase: number;
  rOuterPlanet: number;
  rOuterLine: number;
  rOuterRetr: number;
  rOuter0: number;
  rOuter1: number;
  rOuter5: number;
  rOuter10: number;
}>;

export function resolveMundaneLayout(
  style: MundaneRenderStyle,
  side: number,
  compound: boolean,
  showHouses: boolean,
): MundaneLayout {
  const metrics = style.layout;
  const maxradius = side / 2;
  const planetsectorlen = compound ? metrics.compoundSectorScale : metrics.singleSectorScale;
  const housesectorlen = planetsectorlen;
  const planetoffs = (planetsectorlen / 2) * maxradius;
  const planetlinelen = metrics.planetLineScale;
  const houseoffs = (
    housesectorlen / 2 - (compound ? 0 : metrics.singleHouseOffsetAdjustment)
  ) * maxradius;
  const rOuterMax = maxradius * metrics.outerMaxScale;
  const r30 = compound
    ? (
        showHouses
          ? rOuterMax - metrics.compoundHouseBandScale * maxradius
          : rOuterMax
      ) - metrics.compoundOuterInsetScale * maxradius
    : maxradius * metrics.singleOuterScale;
  const r0 = r30 - housesectorlen * maxradius;
  const rHouse = r30 - houseoffs;
  const rASCMC = compound ? rHouse : maxradius * metrics.singleAscMcScale;
  const rAsp = r0 - planetsectorlen * maxradius;
  const rLLine2 = rAsp + planetlinelen * maxradius;
  const rOuterLine = r30 + planetlinelen * maxradius;
  return deepFreeze({
    compound,
    side,
    cx: side / 2,
    cy: side / 2,
    maxradius,
    symbolSize: Math.max(
      style.typography.symbolMin,
      maxradius / (
        compound
          ? style.typography.compoundSymbolDivisor
          : style.typography.singleSymbolDivisor
      ),
    ),
    r30,
    rHouse,
    rASCMC,
    rArrow: rASCMC + metrics.arrowScale * maxradius,
    r0,
    r1: r0 + metrics.degreeTickScale * maxradius,
    r5: r0 + metrics.fiveDegreeTickScale * maxradius,
    r10: r0 + metrics.tenDegreeTickScale * maxradius,
    rInner: r0,
    rLLine: r0 - planetlinelen * maxradius,
    rPlanet: r0 - planetoffs,
    rAsp,
    rLLine2,
    rRetr: rLLine2 + maxradius * metrics.motionMarkerScale,
    rPos: maxradius * (
      compound ? metrics.compoundPositionScale : metrics.singlePositionScale
    ),
    rBase: maxradius * (compound ? metrics.compoundBaseScale : metrics.singleBaseScale),
    rOuterPlanet: r30 + planetoffs,
    rOuterLine,
    rOuterRetr: rOuterLine + maxradius * metrics.motionMarkerScale,
    rOuter0: r30,
    rOuter1: r30 - metrics.degreeTickScale * maxradius,
    rOuter5: r30 - metrics.fiveDegreeTickScale * maxradius,
    rOuter10: r30 - metrics.tenDegreeTickScale * maxradius,
  });
}

export type MundaneTypographyMetrics = Readonly<{
  symbol: number;
  text: number;
  smallText: number;
}>;

export function resolveMundaneTypographyMetrics(
  style: MundaneRenderStyle,
  layout: MundaneLayout,
): MundaneTypographyMetrics {
  const symPx = Math.max(style.typography.fontMin, Math.round(layout.symbolSize));
  return deepFreeze({
    symbol: symPx,
    text: Math.max(style.typography.fontMin, Math.round(symPx / style.typography.textDivisor)),
    smallText: Math.max(
      style.typography.fontMin,
      Math.round(symPx / style.typography.smallTextDivisor),
    ),
  });
}

export type MundaneStrokeMetrics = Readonly<{
  heavy: number;
  tenDegree: number;
  planetLine: number;
  ascMc: number;
}>;

export function resolveMundaneStrokeMetrics(
  style: MundaneRenderStyle,
  side: number,
  configuredAscMc: number,
): MundaneStrokeMetrics {
  const strokes = style.strokes;
  const heavy = side <= strokes.smallMax
    ? strokes.heavySmall
    : side <= strokes.mediumMax
      ? strokes.heavyMedium
      : strokes.heavyLarge;
  const ascMc = side <= strokes.smallMax &&
      configuredAscMc >= strokes.ascMcSmallConfiguredMin &&
      configuredAscMc <= strokes.ascMcConfiguredMax
    ? strokes.ascMcSmallWidth
    : side <= strokes.mediumMax &&
        configuredAscMc >= strokes.ascMcMediumConfiguredMin &&
        configuredAscMc <= strokes.ascMcConfiguredMax
      ? strokes.ascMcMediumWidth
      : Math.max(strokes.ascMcMinWidth, configuredAscMc);
  return deepFreeze({
    heavy,
    tenDegree: side <= strokes.mediumMax ? strokes.tenDegreeSmall : strokes.tenDegreeLarge,
    planetLine: side <= strokes.mediumMax ? strokes.planetLineSmall : strokes.planetLineLarge,
    ascMc,
  });
}

export function resolveMundaneAspectPaint(
  style: MundaneRenderStyle,
  orbRatio: number,
  orbArcmin: number,
): Readonly<{ width: number; opacity: number; dash?: readonly number[] }> {
  const aspects = style.aspects;
  const opacity = aspects.opacityBase + aspects.opacityRange * (1 - orbRatio);
  return deepFreeze({
    width: Math.max(aspects.widthMin, Math.round(aspects.widthScale * (1 - orbRatio))),
    // The two authorable terms are independently bounded. Clamp their combined
    // result so every valid profile remains a valid Canvas globalAlpha value.
    opacity: Math.min(1, Math.max(0, opacity)),
    ...(orbArcmin > aspects.dashThreshold
      ? { dash: [aspects.dashOn, aspects.dashOff] }
      : {}),
  });
}

export function resolveMundaneHitMetrics(
  style: MundaneRenderStyle,
  symbolSize: number,
): Readonly<{ bodyPad: number; aspectTolerance: number }> {
  return deepFreeze({
    bodyPad: Math.max(
      style.interaction.bodyHitPadMin,
      Math.round(symbolSize * style.interaction.bodyHitPadScale),
    ),
    aspectTolerance: Math.max(
      style.interaction.aspectHitToleranceMin,
      Math.round(symbolSize * style.interaction.aspectHitToleranceScale),
    ),
  });
}

export type MundaneOverlayMetrics = Readonly<{
  compact: boolean;
  fontSize: number;
  edgeInset: number;
  topEdgeInset: number;
  lineHeight: number;
}>;

export function resolveMundaneOverlayMetrics(
  style: MundaneRenderStyle,
  side: number,
): MundaneOverlayMetrics {
  const overlays = style.overlays;
  const compact = side > 0 && side <= overlays.compactMax;
  const symbolSize = side > 0 ? side / overlays.symbolDivisor : 0;
  const fontSize = Math.max(
    compact ? overlays.compactFontMin : overlays.regularFontMin,
    symbolSize * (compact ? overlays.compactFontScale : overlays.regularFontScale),
  );
  const edgeInset = side > 0
    ? Math.max(
        compact ? overlays.compactInsetMin : overlays.regularInsetMin,
        side / overlays.insetDivisor,
      )
    : 0;
  return deepFreeze({
    compact,
    fontSize,
    edgeInset,
    topEdgeInset: compact ? edgeInset : edgeInset + overlays.titlebarSafeTop,
    lineHeight: overlays.lineHeight,
  });
}
