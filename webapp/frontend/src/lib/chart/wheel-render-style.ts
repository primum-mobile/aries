// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartPalette } from "./types";

export const WHEEL_RENDER_STYLE_SCHEMA_VERSION = 1 as const;

export type WheelStyleRevision = string | number;
export type WheelTypographyProfile = "classic" | "compact" | "anglo";
export type WheelRenderPalette = Omit<
  Readonly<ChartPalette>,
  "aspects" | "planets"
> & {
  readonly aspects: readonly string[];
  readonly planets: readonly string[];
};

export interface WheelTypographyRatios {
  readonly body: number;
  readonly outer: Readonly<Record<WheelTypographyProfile, number>>;
  readonly sign: Readonly<Record<WheelTypographyProfile, number>>;
  readonly subdivision: Readonly<Record<WheelTypographyProfile, number>>;
  readonly angleLabelScale: number;
  readonly angleLabelWeight: number;
  readonly syzygyScale: number;
}

export interface WheelTypographyStyle {
  readonly families: {
    readonly ui: string;
    readonly symbols: string;
  };
  readonly ratios: WheelTypographyRatios;
}

export interface WheelStrokeStyle {
  readonly referenceSize: number;
  readonly mediumBase: number;
  readonly degreeTick: {
    readonly breakpoint: number;
    readonly small: number;
    readonly large: number;
  };
  readonly ascMcDefaultBase: number;
}

export interface WheelRenderStyle {
  readonly schemaVersion: typeof WHEEL_RENDER_STYLE_SCHEMA_VERSION;
  readonly revision: WheelStyleRevision;
  readonly palette: WheelRenderPalette;
  readonly typography: WheelTypographyStyle;
  readonly strokes: WheelStrokeStyle;
  readonly outerLabels: {
    readonly edgePadFactor: number;
  };
}

/**
 * New renderer callers provide the complete style object. The legacy branch
 * remains explicit so existing website/export adapters cannot accidentally
 * draw without a palette.
 */
export type WheelRenderStyleSource =
  | {
      readonly renderStyle: WheelRenderStyle;
      readonly palette?: never;
      readonly styleRevision?: never;
      readonly fontUi?: never;
      readonly fontSymbols?: never;
    }
  | {
      readonly renderStyle?: undefined;
      readonly palette: ChartPalette;
      readonly styleRevision?: WheelStyleRevision;
      readonly fontUi?: string;
      readonly fontSymbols?: string;
    };

export interface ResolvedWheelTypographyMetrics {
  readonly bodySize: number;
  readonly outerSize: number;
  readonly signSize: number;
  readonly subdivisionSize: number;
  readonly angleLabelScale: number;
  readonly angleLabelWeight: number;
  readonly syzygyScale: number;
}

export interface ResolvedWheelStrokeMetrics {
  readonly medium: number;
  readonly degreeTick: number;
  readonly ascMc: number;
}

const DEFAULT_UI_FONT = "'FreeSans', ui-sans-serif, system-ui, sans-serif";
const DEFAULT_SYMBOL_FONT = '"AriesMorinus"';
const DEFAULT_REVISION = "wheel-render-style-v1";

const DEFAULT_PALETTE: ChartPalette = {
  background: "rgb(35,36,40)",
  frame: "rgb(220,220,221)",
  signs: "rgb(215,215,217)",
  angles: "rgb(205,205,209)",
  houses: "rgb(138,139,141)",
  houseNums: "rgb(59,59,60)",
  positions: "rgb(255,255,255)",
  peregrin: "rgb(205,205,209)",
  domicil: "rgb(2,191,2)",
  exil: "rgb(255,0,0)",
  exal: "rgb(255,215,0)",
  casus: "rgb(205,92,92)",
  textDim: "rgb(120,121,123)",
  textBright: "rgb(220,220,221)",
  fortune: "rgb(215,215,217)",
  surveilAccent: "rgb(229,146,70)",
  planets: Array.from({ length: 13 }, () => "rgb(205,205,209)"),
  aspects: Array.from({ length: 14 }, () => "rgb(205,205,209)"),
};

const PROFILE_BODY = 1 / 16;
const PROFILE_OUTER = Object.freeze({
  classic: 1 / 16,
  compact: 1 / 16,
  anglo: 1 / 20,
});
const PROFILE_SIGN = Object.freeze({
  classic: 1 / 20,
  compact: 1 / 20,
  anglo: 1 / 25,
});
const PROFILE_SUBDIVISION = Object.freeze({
  classic: 1 / 24,
  compact: 1 / 24,
  anglo: 1 / 32,
});

const DEFAULT_RATIOS: WheelTypographyRatios = Object.freeze({
  body: PROFILE_BODY,
  outer: PROFILE_OUTER,
  sign: PROFILE_SIGN,
  subdivision: PROFILE_SUBDIVISION,
  angleLabelScale: 0.75,
  angleLabelWeight: 500,
  syzygyScale: 0.58,
});

const DEFAULT_TYPOGRAPHY: WheelTypographyStyle = Object.freeze({
  families: Object.freeze({ ui: DEFAULT_UI_FONT, symbols: DEFAULT_SYMBOL_FONT }),
  ratios: DEFAULT_RATIOS,
});

const DEFAULT_STROKES: WheelStrokeStyle = Object.freeze({
  referenceSize: 720,
  mediumBase: 2,
  degreeTick: Object.freeze({ breakpoint: 600, small: 1, large: 2 }),
  ascMcDefaultBase: 5,
});

function immutablePalette(palette: ChartPalette): WheelRenderPalette {
  return Object.freeze({
    ...palette,
    planets: Object.freeze([...palette.planets]),
    aspects: Object.freeze([...palette.aspects]),
  });
}

export const DEFAULT_WHEEL_RENDER_STYLE: WheelRenderStyle = Object.freeze({
  schemaVersion: WHEEL_RENDER_STYLE_SCHEMA_VERSION,
  revision: DEFAULT_REVISION,
  palette: immutablePalette(DEFAULT_PALETTE),
  typography: DEFAULT_TYPOGRAPHY,
  strokes: DEFAULT_STROKES,
  outerLabels: Object.freeze({ edgePadFactor: 0.15 }),
});

export function createWheelRenderStyle({
  palette,
  revision = DEFAULT_WHEEL_RENDER_STYLE.revision,
  fontUi = DEFAULT_WHEEL_RENDER_STYLE.typography.families.ui,
  fontSymbols = DEFAULT_WHEEL_RENDER_STYLE.typography.families.symbols,
}: {
  palette: ChartPalette;
  revision?: WheelStyleRevision;
  fontUi?: string;
  fontSymbols?: string;
}): WheelRenderStyle {
  return Object.freeze({
    ...DEFAULT_WHEEL_RENDER_STYLE,
    revision,
    palette: immutablePalette(palette),
    typography: Object.freeze({
      ...DEFAULT_WHEEL_RENDER_STYLE.typography,
      families: Object.freeze({ ui: fontUi, symbols: fontSymbols }),
    }),
  });
}

export function resolveWheelRenderStyle(source: WheelRenderStyleSource): WheelRenderStyle {
  if (source.renderStyle) return source.renderStyle;
  return createWheelRenderStyle({
    palette: source.palette,
    revision: source.styleRevision,
    fontUi: source.fontUi,
    fontSymbols: source.fontSymbols,
  });
}

export function resolveWheelTypographyMetrics(
  style: WheelRenderStyle,
  profile: WheelTypographyProfile,
  maxRadius: number,
): ResolvedWheelTypographyMetrics {
  const ratios = style.typography.ratios;
  // Division by the ratio's denominator preserves the exact floating-point
  // path used by the established renderer (`maxRadius / 16`, `/ 20`, etc.).
  const scaled = (ratio: number) => maxRadius / (1 / ratio);
  return Object.freeze({
    bodySize: scaled(ratios.body),
    outerSize: scaled(ratios.outer[profile]),
    signSize: scaled(ratios.sign[profile]),
    subdivisionSize: scaled(ratios.subdivision[profile]),
    angleLabelScale: ratios.angleLabelScale,
    angleLabelWeight: ratios.angleLabelWeight,
    syzygyScale: ratios.syzygyScale,
  });
}

export function resolveScaledWheelStroke(
  style: WheelRenderStyle,
  chartSize: number,
  requestedBase: number,
): number {
  return Math.max(
    1,
    Math.round((requestedBase * chartSize) / style.strokes.referenceSize),
  );
}

export function resolveWheelStrokeMetrics(
  style: WheelRenderStyle,
  chartSize: number,
  ascMcBase = style.strokes.ascMcDefaultBase,
): ResolvedWheelStrokeMetrics {
  const degreeTick = style.strokes.degreeTick;
  return Object.freeze({
    medium: resolveScaledWheelStroke(style, chartSize, style.strokes.mediumBase),
    degreeTick:
      chartSize <= degreeTick.breakpoint ? degreeTick.small : degreeTick.large,
    ascMc: resolveScaledWheelStroke(style, chartSize, ascMcBase),
  });
}
