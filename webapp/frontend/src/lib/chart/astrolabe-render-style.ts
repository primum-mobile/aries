// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASTROLABE_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

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
  almucantar: string;
  azimuth: string;
  hour: string;
  capricorn: string;
  star: string;
  cardinal: string;
  sunFill: string;
  infoAtmospheric: string;
  infoSchematic: string;
}>;

export type AstrolabePayloadColors = Readonly<{
  atmospheric: Readonly<{ sky: string; ground: string }>;
  circleLabels: Readonly<{
    equator: string;
    horizon: string;
    ecliptic: string;
  }>;
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
  sphereOutlineWidth: number;
  bandWidthScale: number;
  tickStepScale: number;
  innerRadiusMin: number;
  starRadiusMin: number;
  starRadiusDivisor: number;
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
  infoFontDivisor: number;
  infoFontScale: number;
  infoInsetDivisor: number;
  infoLineHeightScale: number;
  pdRowFontDivisor: number;
  pdRowHeightScale: number;
  pdTokenGapScale: number;
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
  fineStrokeMin: ["--aries-astrolabe-fine-stroke-min", 1],
  fineStrokeDivisor: ["--aries-astrolabe-fine-stroke-divisor", 360],
  mediumStrokeMin: ["--aries-astrolabe-medium-stroke-min", 1],
  mediumStrokeDivisor: ["--aries-astrolabe-medium-stroke-divisor", 280],
  mainStrokeMin: ["--aries-astrolabe-main-stroke-min", 2],
  mainStrokeDivisor: ["--aries-astrolabe-main-stroke-divisor", 220],
  tropicDashOn: ["--aries-astrolabe-tropic-dash-on", 4],
  tropicDashOff: ["--aries-astrolabe-tropic-dash-off", 4],
  equatorDashOn: ["--aries-astrolabe-equator-dash-on", 5],
  equatorDashOff: ["--aries-astrolabe-equator-dash-off", 4],
  regioDashOn: ["--aries-astrolabe-regio-dash-on", 4],
  regioDashOff: ["--aries-astrolabe-regio-dash-off", 4],
  meridianDashOn: ["--aries-astrolabe-meridian-dash-on", 2],
  meridianDashOff: ["--aries-astrolabe-meridian-dash-off", 4],
  capricornDashOn: ["--aries-astrolabe-capricorn-dash-on", 2],
  capricornDashOff: ["--aries-astrolabe-capricorn-dash-off", 3],
  connectorDashOn: ["--aries-astrolabe-connector-dash-on", 2],
  connectorDashOff: ["--aries-astrolabe-connector-dash-off", 3],
  connectorOpacity: ["--aries-astrolabe-connector-opacity", 0.55],
  sphereOutlineWidth: ["--aries-astrolabe-sphere-outline-width", 1],
  bandWidthScale: ["--aries-astrolabe-band-width-scale", 0.15],
  tickStepScale: ["--aries-astrolabe-tick-step-scale", 0.01],
  innerRadiusMin: ["--aries-astrolabe-inner-radius-min", 1],
  starRadiusMin: ["--aries-astrolabe-star-radius-min", 1.5],
  starRadiusDivisor: ["--aries-astrolabe-star-radius-divisor", 320],
  signFontDivisor: ["--aries-astrolabe-sign-font-divisor", 22],
  signCullScale: ["--aries-astrolabe-sign-cull-scale", 0.03],
  sphereRadiusMin: ["--aries-astrolabe-sphere-radius-min", 2],
  sphereRadiusDivisor: ["--aries-astrolabe-sphere-radius-divisor", 160],
  planetFontDivisor: ["--aries-astrolabe-planet-font-divisor", 16],
  bodyLabelPadScale: ["--aries-astrolabe-body-label-pad-scale", 0.02],
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
  cardinalPadScale: ["--aries-astrolabe-cardinal-pad-scale", 0.06],
  cardinalFontDivisor: ["--aries-astrolabe-cardinal-font-divisor", 22],
  infoFontDivisor: ["--aries-astrolabe-info-font-divisor", 16],
  infoFontScale: ["--aries-astrolabe-info-font-scale", 0.75],
  infoInsetDivisor: ["--aries-astrolabe-info-inset-divisor", 25],
  infoLineHeightScale: ["--aries-astrolabe-info-line-height-scale", 1.2],
  pdRowFontDivisor: ["--aries-astrolabe-pd-row-font-divisor", 30],
  pdRowHeightScale: ["--aries-astrolabe-pd-row-height-scale", 1.3],
  pdTokenGapScale: ["--aries-astrolabe-pd-token-gap-scale", 0.35],
});

export const ASTROLABE_RENDER_PALETTE_SPECS: Readonly<AstrolabePaletteSpecs> = deepFreeze({
  background: ["--aries-astrolabe-background", "#23242a"],
  horizon: ["--aries-astrolabe-horizon", "#3e82c4"],
  ecliptic: ["--aries-astrolabe-ecliptic", "#c68a22"],
  equator: ["--aries-astrolabe-equator", "#78828f"],
  equatorLabel: ["--aries-astrolabe-equator-label", "#788291"],
  tropic: ["--aries-astrolabe-tropic", "rgba(200, 210, 220, 0.45)"],
  meridian: ["--aries-astrolabe-meridian", "rgba(170, 178, 196, 0.55)"],
  regio: ["--aries-astrolabe-regio", "rgba(150, 165, 185, 0.42)"],
  almucantar: ["--aries-astrolabe-almucantar", "rgba(120, 150, 190, 0.30)"],
  azimuth: ["--aries-astrolabe-azimuth", "rgba(120, 150, 190, 0.24)"],
  hour: ["--aries-astrolabe-hour", "rgba(170, 150, 110, 0.30)"],
  capricorn: ["--aries-astrolabe-capricorn", "rgba(150, 150, 152, 0.55)"],
  star: ["--aries-astrolabe-star", "rgba(220, 222, 230, 0.85)"],
  cardinal: ["--aries-astrolabe-cardinal", "rgba(160, 160, 162, 0.9)"],
  sunFill: ["--aries-astrolabe-sun-fill", "#ffe066"],
  infoAtmospheric: ["--aries-astrolabe-info-atmospheric", "#dcdcdc"],
  infoSchematic: ["--aries-astrolabe-info-schematic", "#c8c8c8"],
});

const DEFAULT_PAYLOAD_COLORS: AstrolabePayloadColors = deepFreeze({
  atmospheric: { sky: "#060812", ground: "#05070e" },
  circleLabels: { equator: "#788291", horizon: "#3e82c4", ecliptic: "#c68a22" },
});

function defaultRenderTokens(): Readonly<AstrolabeRenderTokens> {
  const tokens = {} as AstrolabeRenderTokens;
  for (const key of Object.keys(ASTROLABE_RENDER_TOKEN_SPECS) as Array<keyof AstrolabeRenderTokens>) {
    tokens[key] = ASTROLABE_RENDER_TOKEN_SPECS[key][1];
  }
  return deepFreeze(tokens);
}

function defaultRenderPalette(): AstrolabeRenderPalette {
  const palette = {} as Record<keyof AstrolabeRenderPalette, string>;
  for (const key of Object.keys(ASTROLABE_RENDER_PALETTE_SPECS) as Array<keyof AstrolabeRenderPalette>) {
    palette[key] = ASTROLABE_RENDER_PALETTE_SPECS[key][1];
  }
  return deepFreeze(palette) as AstrolabeRenderPalette;
}

export const DEFAULT_ASTROLABE_RENDER_TOKENS = defaultRenderTokens();
export const DEFAULT_ASTROLABE_RENDER_PALETTE = defaultRenderPalette();

export interface AstrolabeRenderStyle {
  readonly schemaVersion: typeof ASTROLABE_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: AstrolabeStyleRevision;
  readonly palette: AstrolabeRenderPalette;
  readonly data: Readonly<{
    atmospheric: Readonly<{ sky: string; ground: string }>;
  }>;
  readonly typography: Readonly<{
    fontUi: string;
    fontSymbols: string;
    signFontDivisor: number;
    planetFontDivisor: number;
    circleLabelFontDivisor: number;
    cardinalFontDivisor: number;
    infoFontDivisor: number;
    infoFontScale: number;
    pdRowFontDivisor: number;
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
  readonly layout: Readonly<{
    capricornFill: number;
    bandWidthScale: number;
    tickStepScale: number;
    innerRadiusMin: number;
    signCullScale: number;
    bodyLabelPadScale: number;
    bodyCullScale: number;
    circleLabelOffsetX: number;
    circleLabelOffsetY: number;
    cardinalPadScale: number;
    infoInsetDivisor: number;
    infoLineHeightScale: number;
    pdRowHeightScale: number;
    pdTokenGapScale: number;
  }>;
  readonly markers: Readonly<{
    starRadiusMin: number;
    starRadiusDivisor: number;
    sphereRadiusMin: number;
    sphereRadiusDivisor: number;
    sunSphereScale: number;
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
  "signFontDivisor",
  "sphereRadiusDivisor",
  "planetFontDivisor",
  "bodyCullScale",
  "collisionIterations",
  "sunSphereScale",
  "circleLabelFontDivisor",
  "cardinalFontDivisor",
  "infoFontDivisor",
  "infoInsetDivisor",
  "pdRowFontDivisor",
]);

const OPACITY_TOKEN_KEYS = new Set<keyof AstrolabeRenderTokens>([
  "connectorOpacity",
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
  payloadColors: AstrolabePayloadColors = DEFAULT_PAYLOAD_COLORS,
): AstrolabeRenderPalette {
  const palette = {} as Record<keyof AstrolabeRenderPalette, string>;
  for (const key of Object.keys(ASTROLABE_RENDER_PALETTE_SPECS) as Array<keyof AstrolabeRenderPalette>) {
    const [cssVar, fallback] = ASTROLABE_RENDER_PALETTE_SPECS[key];
    const payloadFallback = key === "equatorLabel"
      ? payloadColors.circleLabels.equator
      : key === "horizon"
        ? payloadColors.circleLabels.horizon
        : key === "ecliptic"
          ? payloadColors.circleLabels.ecliptic
          : fallback;
    palette[key] = readCssValue(cssVar).trim() || payloadFallback || fallback;
  }
  return deepFreeze(palette) as AstrolabeRenderPalette;
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "astrolabe-render-style-v1";

export type AstrolabeRenderStyleInput = {
  revision?: AstrolabeStyleRevision;
  palette?: AstrolabeRenderPalette;
  payloadColors?: AstrolabePayloadColors;
  fontUi?: string;
  fontSymbols?: string;
  tokens?: Readonly<AstrolabeRenderTokens>;
};

export function createAstrolabeRenderStyle({
  revision = DEFAULT_REVISION,
  palette = DEFAULT_ASTROLABE_RENDER_PALETTE,
  payloadColors = DEFAULT_PAYLOAD_COLORS,
  fontUi = DEFAULT_UI_FONT,
  fontSymbols = DEFAULT_SYMBOL_FONT,
  tokens = DEFAULT_ASTROLABE_RENDER_TOKENS,
}: AstrolabeRenderStyleInput = {}): AstrolabeRenderStyle {
  return deepFreeze({
    schemaVersion: ASTROLABE_RENDER_STYLE_SCHEMA_VERSION,
    revision,
    palette: { ...palette },
    data: {
      atmospheric: {
        sky: payloadColors.atmospheric.sky,
        ground: payloadColors.atmospheric.ground,
      },
    },
    typography: {
      fontUi,
      fontSymbols,
      signFontDivisor: tokens.signFontDivisor,
      planetFontDivisor: tokens.planetFontDivisor,
      circleLabelFontDivisor: tokens.circleLabelFontDivisor,
      cardinalFontDivisor: tokens.cardinalFontDivisor,
      infoFontDivisor: tokens.infoFontDivisor,
      infoFontScale: tokens.infoFontScale,
      pdRowFontDivisor: tokens.pdRowFontDivisor,
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
    layout: {
      capricornFill: tokens.capricornFill,
      bandWidthScale: tokens.bandWidthScale,
      tickStepScale: tokens.tickStepScale,
      innerRadiusMin: tokens.innerRadiusMin,
      signCullScale: tokens.signCullScale,
      bodyLabelPadScale: tokens.bodyLabelPadScale,
      bodyCullScale: tokens.bodyCullScale,
      circleLabelOffsetX: tokens.circleLabelOffsetX,
      circleLabelOffsetY: tokens.circleLabelOffsetY,
      cardinalPadScale: tokens.cardinalPadScale,
      infoInsetDivisor: tokens.infoInsetDivisor,
      infoLineHeightScale: tokens.infoLineHeightScale,
      pdRowHeightScale: tokens.pdRowHeightScale,
      pdTokenGapScale: tokens.pdTokenGapScale,
    },
    markers: {
      starRadiusMin: tokens.starRadiusMin,
      starRadiusDivisor: tokens.starRadiusDivisor,
      sphereRadiusMin: tokens.sphereRadiusMin,
      sphereRadiusDivisor: tokens.sphereRadiusDivisor,
      sunSphereScale: tokens.sunSphereScale,
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
  const payloadColors = input.payloadColors ?? DEFAULT_PAYLOAD_COLORS;
  return createAstrolabeRenderStyle({
    ...input,
    payloadColors,
    tokens: resolveAstrolabeRenderTokens(read),
    palette: resolveAstrolabeRenderPalette(read, payloadColors),
  });
}

export type AstrolabeStrokeWidths = Readonly<{ fine: number; medium: number; main: number }>;

/** Preserve the established min + rounded viewport-relative stroke formulas. */
export function resolveAstrolabeStrokeWidths(
  style: AstrolabeRenderStyle,
  size: number,
): AstrolabeStrokeWidths {
  return deepFreeze({
    fine: Math.max(style.strokes.fine.min, Math.round(size / style.strokes.fine.divisor)),
    medium: Math.max(style.strokes.medium.min, Math.round(size / style.strokes.medium.divisor)),
    main: Math.max(style.strokes.main.min, Math.round(size / style.strokes.main.divisor)),
  });
}
