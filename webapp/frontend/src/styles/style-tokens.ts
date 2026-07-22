// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type StyleTokenGroup =
  | "Typography"
  | "Spacing"
  | "Text Colors"
  | "Surfaces"
  | "Tables"
  | "Graphic Ephemeris";

type BaseStyleToken = {
  id: StyleTokenId;
  group: StyleTokenGroup;
  label: string;
  cssVar: string;
  defaultValue: string | number;
};

export type NumberStyleToken = BaseStyleToken & {
  kind: "number";
  min: number;
  max: number;
  step: number;
  unit: "px" | "";
};

export type ColorStyleToken = BaseStyleToken & {
  kind: "color";
  defaultValue: string;
};

export type FontStyleToken = BaseStyleToken & {
  kind: "font";
  defaultValue: string;
  options: { label: string; value: string }[];
};

export type StyleToken = NumberStyleToken | ColorStyleToken | FontStyleToken;

export type StyleTokenId =
  | "fontSizeBase"
  | "fontSizeReading"
  | "fontSizeSmall"
  | "fontSizeSection"
  | "fontSizeHeader"
  | "uiScale"
  | "sidebarRowHeight"
  | "panelPaddingX"
  | "panelPaddingY"
  | "navSideMargin"
  | "sectionGap"
  | "textPrimary"
  | "textMuted"
  | "textDim"
  | "sidebarText"
  | "headerText"
  | "inspectorText"
  | "statusText"
  | "background"
  | "surface"
  | "surfaceSubtle"
  | "accent"
  | "borderSubtle"
  | "tableFontSize"
  | "tableRowHeight"
  | "tableHeaderHeight"
  | "tableCellX"
  | "tableCellY"
  | "tableSectionGap"
  | "tableRuleColor"
  | "ephemStateFontSize"
  | "ephemFrameWidthSmall"
  | "ephemFrameWidthMedium"
  | "ephemFrameWidthLarge"
  | "ephemCurveWidthSmall"
  | "ephemCurveWidthLarge"
  | "ephemGridLineWidth"
  | "ephemGridDashOn"
  | "ephemGridDashOff"
  | "ephemStationTickMin"
  | "ephemStationTickMax"
  | "ephemStationTickLineWidth"
  | "ephemEventGlyphMin"
  | "ephemEventGlyphMax"
  | "ephemHoverFontSize"
  | "ephemHoverPadX"
  | "ephemHoverPadY"
  | "ephemHoverOffsetX"
  | "ephemHoverOffsetY";

export const STYLE_TOKEN_GROUPS: StyleTokenGroup[] = [
  "Typography",
  "Spacing",
  "Text Colors",
  "Surfaces",
  "Tables",
  "Graphic Ephemeris",
];

export const STYLE_TOKENS: StyleToken[] = [
  {
    id: "fontSizeBase",
    group: "Typography",
    label: "Base text",
    cssVar: "--aries-font-size-base",
    kind: "number",
    defaultValue: 12,
    min: 10,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "fontSizeReading",
    group: "Typography",
    label: "Reading text",
    cssVar: "--aries-font-size-reading",
    kind: "number",
    defaultValue: 13,
    min: 11,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "fontSizeSmall",
    group: "Typography",
    label: "Small text",
    cssVar: "--aries-font-size-small",
    kind: "number",
    defaultValue: 11,
    min: 9,
    max: 15,
    step: 1,
    unit: "px",
  },
  {
    id: "fontSizeSection",
    group: "Typography",
    label: "Section labels",
    cssVar: "--aries-font-size-section",
    kind: "number",
    defaultValue: 10,
    min: 8,
    max: 14,
    step: 1,
    unit: "px",
  },
  {
    id: "fontSizeHeader",
    group: "Typography",
    label: "Header text",
    cssVar: "--aries-font-size-header",
    kind: "number",
    defaultValue: 12,
    min: 10,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "uiScale",
    group: "Spacing",
    label: "UI scale",
    cssVar: "--aries-ui-scale",
    kind: "number",
    defaultValue: 1,
    min: 0.85,
    max: 1.25,
    step: 0.01,
    unit: "",
  },
  {
    id: "sidebarRowHeight",
    group: "Spacing",
    label: "Sidebar row height",
    cssVar: "--aries-sidebar-row-height",
    kind: "number",
    defaultValue: 30,
    min: 24,
    max: 44,
    step: 1,
    unit: "px",
  },
  {
    id: "panelPaddingX",
    group: "Spacing",
    label: "Panel padding X",
    cssVar: "--aries-panel-padding-x",
    kind: "number",
    defaultValue: 16,
    min: 8,
    max: 32,
    step: 1,
    unit: "px",
  },
  {
    id: "panelPaddingY",
    group: "Spacing",
    label: "Panel padding Y",
    cssVar: "--aries-panel-padding-y",
    kind: "number",
    defaultValue: 12,
    min: 6,
    max: 28,
    step: 1,
    unit: "px",
  },
  {
    id: "navSideMargin",
    group: "Spacing",
    label: "Sidebar margin",
    cssVar: "--aries-nav-side-margin",
    kind: "number",
    defaultValue: 12,
    min: 4,
    max: 28,
    step: 1,
    unit: "px",
  },
  {
    id: "sectionGap",
    group: "Spacing",
    label: "Section spacing",
    cssVar: "--aries-section-gap",
    kind: "number",
    defaultValue: 20,
    min: 8,
    max: 36,
    step: 1,
    unit: "px",
  },
  {
    id: "textPrimary",
    group: "Text Colors",
    label: "Primary text",
    cssVar: "--aries-text-primary",
    kind: "color",
    defaultValue: "#ffffff",
  },
  {
    id: "textMuted",
    group: "Text Colors",
    label: "Muted text",
    cssVar: "--aries-text-muted",
    kind: "color",
    defaultValue: "#b4b5b6",
  },
  {
    id: "textDim",
    group: "Text Colors",
    label: "Dim text",
    cssVar: "--aries-text-dim",
    kind: "color",
    defaultValue: "#919294",
  },
  {
    id: "sidebarText",
    group: "Text Colors",
    label: "Sidebar text",
    cssVar: "--aries-sidebar-text",
    kind: "color",
    defaultValue: "#ffffff",
  },
  {
    id: "headerText",
    group: "Text Colors",
    label: "Header text",
    cssVar: "--aries-header-text",
    kind: "color",
    defaultValue: "#ffffff",
  },
  {
    id: "inspectorText",
    group: "Text Colors",
    label: "Inspector text",
    cssVar: "--aries-inspector-text",
    kind: "color",
    defaultValue: "#ffffff",
  },
  {
    id: "statusText",
    group: "Text Colors",
    label: "Status text",
    cssVar: "--aries-status-text",
    kind: "color",
    defaultValue: "#ffffff",
  },
  {
    id: "background",
    group: "Surfaces",
    label: "Background",
    cssVar: "--aries-background",
    kind: "color",
    defaultValue: "#232428",
  },
  {
    id: "surface",
    group: "Surfaces",
    label: "Surface",
    cssVar: "--aries-surface",
    kind: "color",
    defaultValue: "#1d1e21",
  },
  {
    id: "surfaceSubtle",
    group: "Surfaces",
    label: "Subtle surface",
    cssVar: "--aries-surface-subtle",
    kind: "color",
    defaultValue: "#2d2e31",
  },
  {
    id: "accent",
    group: "Surfaces",
    label: "Accent surface",
    cssVar: "--aries-accent",
    kind: "color",
    defaultValue: "#343538",
  },
  {
    id: "borderSubtle",
    group: "Surfaces",
    label: "Border",
    cssVar: "--aries-border-subtle",
    kind: "color",
    defaultValue: "#2e2f32",
  },
  {
    id: "tableFontSize",
    group: "Tables",
    label: "Table text",
    cssVar: "--aries-table-font-size-standard",
    kind: "number",
    defaultValue: 12,
    min: 10,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "tableRowHeight",
    group: "Tables",
    label: "Table row height",
    cssVar: "--aries-table-row-height-standard",
    kind: "number",
    defaultValue: 31,
    min: 24,
    max: 46,
    step: 1,
    unit: "px",
  },
  {
    id: "tableHeaderHeight",
    group: "Tables",
    label: "Table header height",
    cssVar: "--aries-table-header-height-standard",
    kind: "number",
    defaultValue: 31,
    min: 24,
    max: 46,
    step: 1,
    unit: "px",
  },
  {
    id: "tableCellX",
    group: "Tables",
    label: "Table cell X",
    cssVar: "--aries-table-cell-x-standard",
    kind: "number",
    defaultValue: 8,
    min: 4,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "tableCellY",
    group: "Tables",
    label: "Table cell Y",
    cssVar: "--aries-table-cell-y-standard",
    kind: "number",
    defaultValue: 4,
    min: 2,
    max: 12,
    step: 1,
    unit: "px",
  },
  {
    id: "tableSectionGap",
    group: "Tables",
    label: "Table section gap",
    cssVar: "--aries-table-section-gap",
    kind: "number",
    defaultValue: 22,
    min: 8,
    max: 44,
    step: 1,
    unit: "px",
  },
  {
    id: "tableRuleColor",
    group: "Tables",
    label: "Table rule",
    cssVar: "--aries-table-rule-color",
    kind: "color",
    defaultValue: "#000000",
  },
  {
    id: "ephemStateFontSize",
    group: "Graphic Ephemeris",
    label: "State text",
    cssVar: "--aries-ephem-state-font-size",
    kind: "number",
    defaultValue: 12,
    min: 8,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemFrameWidthSmall",
    group: "Graphic Ephemeris",
    label: "Frame width small",
    cssVar: "--aries-ephem-frame-width-small",
    kind: "number",
    defaultValue: 2,
    min: 1,
    max: 8,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemFrameWidthMedium",
    group: "Graphic Ephemeris",
    label: "Frame width medium",
    cssVar: "--aries-ephem-frame-width-medium",
    kind: "number",
    defaultValue: 3,
    min: 1,
    max: 9,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemFrameWidthLarge",
    group: "Graphic Ephemeris",
    label: "Frame width large",
    cssVar: "--aries-ephem-frame-width-large",
    kind: "number",
    defaultValue: 4,
    min: 1,
    max: 10,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemCurveWidthSmall",
    group: "Graphic Ephemeris",
    label: "Curve width small",
    cssVar: "--aries-ephem-curve-width-small",
    kind: "number",
    defaultValue: 1,
    min: 1,
    max: 6,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemCurveWidthLarge",
    group: "Graphic Ephemeris",
    label: "Curve width large",
    cssVar: "--aries-ephem-curve-width-large",
    kind: "number",
    defaultValue: 2,
    min: 1,
    max: 8,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemGridLineWidth",
    group: "Graphic Ephemeris",
    label: "Grid line",
    cssVar: "--aries-ephem-grid-line-width",
    kind: "number",
    defaultValue: 1,
    min: 1,
    max: 5,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemGridDashOn",
    group: "Graphic Ephemeris",
    label: "Grid dash",
    cssVar: "--aries-ephem-grid-dash-on",
    kind: "number",
    defaultValue: 6,
    min: 1,
    max: 16,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemGridDashOff",
    group: "Graphic Ephemeris",
    label: "Grid dash gap",
    cssVar: "--aries-ephem-grid-dash-off",
    kind: "number",
    defaultValue: 3,
    min: 1,
    max: 16,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemStationTickMin",
    group: "Graphic Ephemeris",
    label: "Station tick min",
    cssVar: "--aries-ephem-station-tick-min",
    kind: "number",
    defaultValue: 4,
    min: 2,
    max: 14,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemStationTickMax",
    group: "Graphic Ephemeris",
    label: "Station tick max",
    cssVar: "--aries-ephem-station-tick-max",
    kind: "number",
    defaultValue: 9,
    min: 4,
    max: 24,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemStationTickLineWidth",
    group: "Graphic Ephemeris",
    label: "Station tick line",
    cssVar: "--aries-ephem-station-tick-line-width",
    kind: "number",
    defaultValue: 1,
    min: 1,
    max: 5,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemEventGlyphMin",
    group: "Graphic Ephemeris",
    label: "Event glyph min",
    cssVar: "--aries-ephem-event-glyph-min",
    kind: "number",
    defaultValue: 6,
    min: 4,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemEventGlyphMax",
    group: "Graphic Ephemeris",
    label: "Event glyph max",
    cssVar: "--aries-ephem-event-glyph-max",
    kind: "number",
    defaultValue: 10,
    min: 6,
    max: 24,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemHoverFontSize",
    group: "Graphic Ephemeris",
    label: "Hover text",
    cssVar: "--aries-ephem-hover-font-size",
    kind: "number",
    defaultValue: 11,
    min: 8,
    max: 16,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemHoverPadX",
    group: "Graphic Ephemeris",
    label: "Hover padding X",
    cssVar: "--aries-ephem-hover-pad-x",
    kind: "number",
    defaultValue: 8,
    min: 2,
    max: 18,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemHoverPadY",
    group: "Graphic Ephemeris",
    label: "Hover padding Y",
    cssVar: "--aries-ephem-hover-pad-y",
    kind: "number",
    defaultValue: 4,
    min: 1,
    max: 14,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemHoverOffsetX",
    group: "Graphic Ephemeris",
    label: "Hover offset X",
    cssVar: "--aries-ephem-hover-offset-x",
    kind: "number",
    defaultValue: 12,
    min: 0,
    max: 40,
    step: 1,
    unit: "px",
  },
  {
    id: "ephemHoverOffsetY",
    group: "Graphic Ephemeris",
    label: "Hover offset Y",
    cssVar: "--aries-ephem-hover-offset-y",
    kind: "number",
    defaultValue: 48,
    min: 12,
    max: 90,
    step: 1,
    unit: "px",
  },
];

export type StyleTokenValue = string | number;
export type StyleTokenValues = Partial<Record<StyleTokenId, StyleTokenValue>>;

export const DEFAULT_STYLE_TOKEN_VALUES: Record<StyleTokenId, StyleTokenValue> =
  STYLE_TOKENS.reduce(
    (acc, token) => {
      acc[token.id] = token.defaultValue;
      return acc;
    },
    {} as Record<StyleTokenId, StyleTokenValue>,
  );

export function resolveStyleTokenValues(
  values: StyleTokenValues,
): Record<StyleTokenId, StyleTokenValue> {
  return { ...DEFAULT_STYLE_TOKEN_VALUES, ...values };
}

export function formatStyleTokenValue(
  token: StyleToken,
  value: StyleTokenValue,
): string {
  if (token.kind === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    const safeValue = Number.isFinite(numberValue) ? numberValue : token.defaultValue;
    return `${safeValue}${token.unit}`;
  }
  return String(value);
}
