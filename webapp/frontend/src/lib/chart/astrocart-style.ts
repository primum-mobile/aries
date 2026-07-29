// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ASTROCART_STYLE_SCHEMA_VERSION = 10 as const;
export const ASTROCART_TITLEBAR_SAFE_TOP = 34;
export const ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS = Object.freeze([0, 256] as const);
export const ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS = Object.freeze([0.25, 3] as const);
export const ASTROCART_POINT_LINE_OPACITY_BOUNDS = Object.freeze([0, 1] as const);

export type AstrocartMode = "dark" | "light";

export type AstrocartPointStyle = Readonly<{
  label: string;
  color: string;
  glyphMorinus: string;
  lineWidthScale: number;
  lineOpacity: number;
}>;

export type AstrocartChromeStyle = Readonly<{
  pageBg: string;
  titlebarSafeTop: number;
  chromeBg: string;
  chromeBgThin: string;
  chromeBorder: string;
  chromeRule: string;
  chromeText: string;
  chromeDim: string;
  chromeSoft: string;
  buttonActiveBg: string;
  buttonHoverBg: string;
  buttonActiveFg: string;
  keyLine: string;
  keyParan: string;
  popupBg: string;
  menuBg: string;
  menuBorder: string;
  menuShadow: string;
  menuHoverBg: string;
  menuHoverFg: string;
  fontUi: string;
  fontSymbols: string;
  controlSize: number;
  panelRadius: number;
  fontSize: number;
  smallFontSize: number;
  inset: number;
  gap: number;
  paddingX: number;
  paddingY: number;
}>;

/** Complete, versioned MapLibre presentation seam. Interaction, collision,
 * camera state, and geographic computation remain outside this contract. */
export type AstrocartRendererStyle = Readonly<{
  casing: string;
  labelColor: string;
  labelHalo: string;
  paranColor: string;
  paranHalo: string;
  fallbackMcColor: string;
  fallbackIcColor: string;
  fallbackAscColor: string;
  fallbackDscColor: string;
  fallbackUnknownColor: string;
  eclipseShadowColor: string;
  eclipseOutlineColor: string;
  eclipseCenterColor: string;
  eclipseHaloColor: string;
  asterismHighlightColor: string;
  asterismShadowColor: string;
  referenceEclipticColor: string;
  referenceEquatorColor: string;
  referenceAscColor: string;
  referenceMcColor: string;
  referenceHouseGridColor: string;
  referenceZodiacGridColor: string;
  pageBg: string;
  oceanColor: string;
  landColor: string;
  borderColor: string;
  countryLabelColor: string;
  countryLabelHalo: string;
  countryLabelSize: number;
  countryLabelsOn: boolean;
  cityLabelColor: string;
  cityLabelHalo: string;
  cityLabelSize: number;
  cityLabelsOn: boolean;
  minorPlaceLabelColor: string;
  minorPlaceLabelHalo: string;
  minorPlaceLabelSize: number;
  waterLabelColor: string;
  waterLabelHalo: string;
  waterLabelSize: number;
  hospitalLabelColor: string;
  hospitalLabelHalo: string;
  hospitalFillColor: string;
  roadColor: string;
  streetNameColor: string;
  streetNameHalo: string;
  buildingColor: string;
  buildingOutlineColor: string;
  parkColor: string;
  parkOutlineColor: string;
  residentialColor: string;
  casingWidth: number;
  casingOpacity: number;
  solidWidth: number;
  solidOpacity: number;
  dashedWidth: number;
  dashedOpacity: number;
  dashedOn: number;
  dashedOff: number;
  paranWidth: number;
  paranOpacity: number;
  paranDashOn: number;
  paranDashOff: number;
  localSpaceOppositionWidthScale: number;
  localSpaceOppositionOpacityScale: number;
  localSpaceOppositionDashOnScale: number;
  localSpaceOppositionDashOffScale: number;
  aspectLineWidthScale: number;
  aspectLineOpacityScale: number;
  aspectLineDashOn: number;
  aspectLineDashOff: number;
  zenithRadiusMin: number;
  zenithRadiusWidthScale: number;
  zenithStrokeWidthMin: number;
  transitLayerOpacity: number;
  progressionLayerOpacity: number;
  labelSize: number;
  labelSpacing: number;
  labelHaloWidth: number;
  labelOpacity: number;
  domLabelOpacityScale: number;
  labelHaloOn: boolean;
  labelsOn: boolean;
  paranLabelSize: number;
  paranLabelSpacing: number;
  paranLabelHaloWidth: number;
  paranLabelOpacity: number;
  paranLabelHaloOn: boolean;
  paranLabelsOn: boolean;
  localCountryBorderWidth: number;
  localCountryBorderOpacity: number;
  localRegionBorderWidth: number;
  localRegionBorderOpacity: number;
  buildingOpacityScale: number;
  residentialOpacityScale: number;
  parkFillOpacityScale: number;
  parkOutlineOpacityScale: number;
  hospitalFillOpacityScale: number;
  roadWidthScale: number;
  roadOpacityScale: number;
  roadBlur: number;
  waterLineOpacity: number;
  waterLabelSpacing: number;
  waterLabelHaloWidth: number;
  waterLabelHaloBlur: number;
  waterLineLabelOpacity: number;
  waterPointLabelOpacity: number;
  streetLabelSize: number;
  streetLabelHaloWidth: number;
  streetLabelHaloBlur: number;
  streetLabelOpacity: number;
  hospitalLabelSize: number;
  hospitalLabelHaloWidth: number;
  hospitalLabelHaloBlur: number;
  hospitalLabelOpacity: number;
  hospitalIconOpacity: number;
  countryLabelSpacing: number;
  countryLabelHaloWidth: number;
  countryLabelHaloBlur: number;
  countryLabelOpacity: number;
  cityLabelSpacing: number;
  cityLabelHaloWidth: number;
  cityLabelHaloBlur: number;
  cityLabelOpacity: number;
  minorPlaceLabelSpacing: number;
  minorPlaceLabelHaloWidth: number;
  minorPlaceLabelHaloBlur: number;
  minorPlaceLabelOpacity: number;
  eclipseShadowWidth: number;
  eclipseShadowOpacity: number;
  eclipseShadowBlur: number;
  eclipseFillOpacity: number;
  eclipseOutlineWidth: number;
  eclipseOutlineOpacity: number;
  eclipseLimitWidth: number;
  eclipseLimitOpacity: number;
  eclipseLimitDashOn: number;
  eclipseLimitDashOff: number;
  eclipseCenterWidth: number;
  eclipseCenterOpacity: number;
  eclipseMaximumRadius: number;
  eclipseMaximumStrokeWidth: number;
  eclipseLabelSize: number;
  eclipseLabelSpacing: number;
  eclipseLabelHaloWidth: number;
  eclipseLabelOpacity: number;
  asterismLineWidth: number;
  asterismLineOpacity: number;
  asterismStarRadiusMin: number;
  asterismStarRadiusMax: number;
  asterismStarOpacity: number;
  asterismShadowSpread: number;
  asterismShadowOpacity: number;
  asterismShadowBlur: number;
  asterismLabelSize: number;
  asterismLabelSpacing: number;
  asterismLabelHaloWidth: number;
  asterismLabelOpacity: number;
  referenceLineWidth: number;
  referenceLineOpacity: number;
  referenceSignSize: number;
  referenceSignOpacity: number;
  referenceSignHaloWidth: number;
  referenceGridLineWidth: number;
  referenceGridLineOpacity: number;
  referencePoleSignSize: number;
  referencePoleHouseSize: number;
  referencePoleLabelOpacity: number;
  referencePoleLabelHaloWidth: number;
}>;

export type AstrocartStyle = Readonly<{
  schemaVersion: typeof ASTROCART_STYLE_SCHEMA_VERSION;
  styleRevision: string;
  styleHash: string;
  mode: AstrocartMode;
  chrome: AstrocartChromeStyle;
  renderer: AstrocartRendererStyle;
  points: Readonly<Record<string, AstrocartPointStyle>>;
  behavior: Readonly<{
    showEcliptic: boolean;
    showEquator: boolean;
    showAscCircle: boolean;
    showMcCircle: boolean;
    showHouseLines: boolean;
    showZodiacLines: boolean;
  }>;
}>;

export const ASTROCART_CHROME_STRING_FIELDS = Object.freeze([
  "pageBg",
  "chromeBg",
  "chromeBgThin",
  "chromeBorder",
  "chromeRule",
  "chromeText",
  "chromeDim",
  "chromeSoft",
  "buttonActiveBg",
  "buttonHoverBg",
  "buttonActiveFg",
  "keyLine",
  "keyParan",
  "popupBg",
  "menuBg",
  "menuBorder",
  "menuShadow",
  "menuHoverBg",
  "menuHoverFg",
  "fontUi",
  "fontSymbols",
] as const satisfies readonly (keyof AstrocartChromeStyle)[]);

export const ASTROCART_CHROME_NUMBER_FIELDS = Object.freeze([
  "controlSize",
  "panelRadius",
  "fontSize",
  "smallFontSize",
  "inset",
  "gap",
  "paddingX",
  "paddingY",
] as const satisfies readonly (keyof AstrocartChromeStyle)[]);

export const ASTROCART_RENDERER_STRING_FIELDS = Object.freeze([
  "casing",
  "labelColor",
  "labelHalo",
  "paranColor",
  "paranHalo",
  "fallbackMcColor",
  "fallbackIcColor",
  "fallbackAscColor",
  "fallbackDscColor",
  "fallbackUnknownColor",
  "eclipseShadowColor",
  "eclipseOutlineColor",
  "eclipseCenterColor",
  "eclipseHaloColor",
  "asterismHighlightColor",
  "asterismShadowColor",
  "referenceEclipticColor",
  "referenceEquatorColor",
  "referenceAscColor",
  "referenceMcColor",
  "referenceHouseGridColor",
  "referenceZodiacGridColor",
  "pageBg",
  "oceanColor",
  "landColor",
  "borderColor",
  "countryLabelColor",
  "countryLabelHalo",
  "cityLabelColor",
  "cityLabelHalo",
  "minorPlaceLabelColor",
  "minorPlaceLabelHalo",
  "waterLabelColor",
  "waterLabelHalo",
  "hospitalLabelColor",
  "hospitalLabelHalo",
  "hospitalFillColor",
  "roadColor",
  "streetNameColor",
  "streetNameHalo",
  "buildingColor",
  "buildingOutlineColor",
  "parkColor",
  "parkOutlineColor",
  "residentialColor",
] as const satisfies readonly (keyof AstrocartRendererStyle)[]);

export const ASTROCART_RENDERER_NUMBER_FIELDS = Object.freeze([
  "countryLabelSize",
  "cityLabelSize",
  "minorPlaceLabelSize",
  "waterLabelSize",
  "casingWidth",
  "casingOpacity",
  "solidWidth",
  "solidOpacity",
  "dashedWidth",
  "dashedOpacity",
  "dashedOn",
  "dashedOff",
  "paranWidth",
  "paranOpacity",
  "paranDashOn",
  "paranDashOff",
  "localSpaceOppositionWidthScale",
  "localSpaceOppositionOpacityScale",
  "localSpaceOppositionDashOnScale",
  "localSpaceOppositionDashOffScale",
  "aspectLineWidthScale",
  "aspectLineOpacityScale",
  "aspectLineDashOn",
  "aspectLineDashOff",
  "zenithRadiusMin",
  "zenithRadiusWidthScale",
  "zenithStrokeWidthMin",
  "transitLayerOpacity",
  "progressionLayerOpacity",
  "labelSize",
  "labelSpacing",
  "labelHaloWidth",
  "labelOpacity",
  "domLabelOpacityScale",
  "paranLabelSize",
  "paranLabelSpacing",
  "paranLabelHaloWidth",
  "paranLabelOpacity",
  "localCountryBorderWidth",
  "localCountryBorderOpacity",
  "localRegionBorderWidth",
  "localRegionBorderOpacity",
  "buildingOpacityScale",
  "residentialOpacityScale",
  "parkFillOpacityScale",
  "parkOutlineOpacityScale",
  "hospitalFillOpacityScale",
  "roadWidthScale",
  "roadOpacityScale",
  "roadBlur",
  "waterLineOpacity",
  "waterLabelSpacing",
  "waterLabelHaloWidth",
  "waterLabelHaloBlur",
  "waterLineLabelOpacity",
  "waterPointLabelOpacity",
  "streetLabelSize",
  "streetLabelHaloWidth",
  "streetLabelHaloBlur",
  "streetLabelOpacity",
  "hospitalLabelSize",
  "hospitalLabelHaloWidth",
  "hospitalLabelHaloBlur",
  "hospitalLabelOpacity",
  "hospitalIconOpacity",
  "countryLabelSpacing",
  "countryLabelHaloWidth",
  "countryLabelHaloBlur",
  "countryLabelOpacity",
  "cityLabelSpacing",
  "cityLabelHaloWidth",
  "cityLabelHaloBlur",
  "cityLabelOpacity",
  "minorPlaceLabelSpacing",
  "minorPlaceLabelHaloWidth",
  "minorPlaceLabelHaloBlur",
  "minorPlaceLabelOpacity",
  "eclipseShadowWidth",
  "eclipseShadowOpacity",
  "eclipseShadowBlur",
  "eclipseFillOpacity",
  "eclipseOutlineWidth",
  "eclipseOutlineOpacity",
  "eclipseLimitWidth",
  "eclipseLimitOpacity",
  "eclipseLimitDashOn",
  "eclipseLimitDashOff",
  "eclipseCenterWidth",
  "eclipseCenterOpacity",
  "eclipseMaximumRadius",
  "eclipseMaximumStrokeWidth",
  "eclipseLabelSize",
  "eclipseLabelSpacing",
  "eclipseLabelHaloWidth",
  "eclipseLabelOpacity",
  "asterismLineWidth",
  "asterismLineOpacity",
  "asterismStarRadiusMin",
  "asterismStarRadiusMax",
  "asterismStarOpacity",
  "asterismShadowSpread",
  "asterismShadowOpacity",
  "asterismShadowBlur",
  "asterismLabelSize",
  "asterismLabelSpacing",
  "asterismLabelHaloWidth",
  "asterismLabelOpacity",
  "referenceLineWidth",
  "referenceLineOpacity",
  "referenceSignSize",
  "referenceSignOpacity",
  "referenceSignHaloWidth",
  "referenceGridLineWidth",
  "referenceGridLineOpacity",
  "referencePoleSignSize",
  "referencePoleHouseSize",
  "referencePoleLabelOpacity",
  "referencePoleLabelHaloWidth",
] as const satisfies readonly (keyof AstrocartRendererStyle)[]);

type AstrocartRendererNumberField = (typeof ASTROCART_RENDERER_NUMBER_FIELDS)[number];
type AstrocartChromeNumberField = (typeof ASTROCART_CHROME_NUMBER_FIELDS)[number];
type AstrocartNumberBounds = readonly [minimum: number, maximum: number];

function freezeNumberBounds<T extends Record<string, AstrocartNumberBounds>>(bounds: T): Readonly<T> {
  for (const value of Object.values(bounds)) Object.freeze(value);
  return Object.freeze(bounds);
}

/** Finite postMessage boundary limits. These mirror the daemon profile's
 * authoring envelope while rejecting values MapLibre cannot paint safely. */
export const ASTROCART_RENDERER_NUMBER_BOUNDS = freezeNumberBounds({
  countryLabelSize: [4.8, 24],
  cityLabelSize: [4.2, 21],
  minorPlaceLabelSize: [3.7, 19],
  waterLabelSize: [4.4, 22],
  casingWidth: [0.25, 12],
  casingOpacity: [0, 1],
  solidWidth: [0.25, 8],
  solidOpacity: [0, 1],
  dashedWidth: [0.25, 8],
  dashedOpacity: [0, 1],
  dashedOn: [0.25, 12],
  dashedOff: [0.25, 8],
  paranWidth: [0.25, 8],
  paranOpacity: [0, 1],
  paranDashOn: [0.25, 8],
  paranDashOff: [0.25, 8],
  localSpaceOppositionWidthScale: [0.25, 3],
  localSpaceOppositionOpacityScale: [0, 1.5],
  localSpaceOppositionDashOnScale: [0.25, 3],
  localSpaceOppositionDashOffScale: [0.25, 3],
  aspectLineWidthScale: [0.25, 3],
  aspectLineOpacityScale: [0, 1.5],
  aspectLineDashOn: [0.25, 12],
  aspectLineDashOff: [0.25, 12],
  zenithRadiusMin: [0.5, 12],
  zenithRadiusWidthScale: [0.25, 6],
  zenithStrokeWidthMin: [0, 6],
  transitLayerOpacity: [0, 1],
  progressionLayerOpacity: [0, 1],
  labelSize: [4.4, 22],
  labelSpacing: [0, 16],
  labelHaloWidth: [0.25, 8],
  labelOpacity: [0, 1],
  domLabelOpacityScale: [0, 1],
  paranLabelSize: [4.4, 22],
  paranLabelSpacing: [0, 16],
  paranLabelHaloWidth: [0.25, 8],
  paranLabelOpacity: [0, 1],
  localCountryBorderWidth: [0.1, 4],
  localCountryBorderOpacity: [0, 1],
  localRegionBorderWidth: [0.1, 3],
  localRegionBorderOpacity: [0, 1],
  buildingOpacityScale: [0, 2],
  residentialOpacityScale: [0, 2],
  parkFillOpacityScale: [0, 2],
  parkOutlineOpacityScale: [0, 2],
  hospitalFillOpacityScale: [0, 2],
  roadWidthScale: [0.25, 3],
  roadOpacityScale: [0, 1.5],
  roadBlur: [0, 4],
  waterLineOpacity: [0, 1],
  waterLabelSpacing: [0, 0.5],
  waterLabelHaloWidth: [0, 6],
  waterLabelHaloBlur: [0, 4],
  waterLineLabelOpacity: [0, 1],
  waterPointLabelOpacity: [0, 1],
  streetLabelSize: [6, 24],
  streetLabelHaloWidth: [0, 6],
  streetLabelHaloBlur: [0, 4],
  streetLabelOpacity: [0, 1],
  hospitalLabelSize: [6, 24],
  hospitalLabelHaloWidth: [0, 6],
  hospitalLabelHaloBlur: [0, 4],
  hospitalLabelOpacity: [0, 1],
  hospitalIconOpacity: [0, 1],
  countryLabelSpacing: [0, 0.5],
  countryLabelHaloWidth: [0, 6],
  countryLabelHaloBlur: [0, 4],
  countryLabelOpacity: [0, 1],
  cityLabelSpacing: [0, 0.5],
  cityLabelHaloWidth: [0, 6],
  cityLabelHaloBlur: [0, 4],
  cityLabelOpacity: [0, 1],
  minorPlaceLabelSpacing: [0, 0.5],
  minorPlaceLabelHaloWidth: [0, 6],
  minorPlaceLabelHaloBlur: [0, 4],
  minorPlaceLabelOpacity: [0, 1],
  eclipseShadowWidth: [1, 40],
  eclipseShadowOpacity: [0, 1],
  eclipseShadowBlur: [0, 12],
  eclipseFillOpacity: [0, 1],
  eclipseOutlineWidth: [0.25, 8],
  eclipseOutlineOpacity: [0, 1],
  eclipseLimitWidth: [0.25, 8],
  eclipseLimitOpacity: [0, 1],
  eclipseLimitDashOn: [0.25, 16],
  eclipseLimitDashOff: [0.25, 16],
  eclipseCenterWidth: [0.25, 10],
  eclipseCenterOpacity: [0, 1],
  eclipseMaximumRadius: [1, 16],
  eclipseMaximumStrokeWidth: [0, 8],
  eclipseLabelSize: [6, 28],
  eclipseLabelSpacing: [0, 0.5],
  eclipseLabelHaloWidth: [0, 8],
  eclipseLabelOpacity: [0, 1],
  asterismLineWidth: [0.25, 6],
  asterismLineOpacity: [0, 1],
  asterismStarRadiusMin: [0.5, 4],
  asterismStarRadiusMax: [2, 10],
  asterismStarOpacity: [0, 1],
  asterismShadowSpread: [0, 4],
  asterismShadowOpacity: [0, 1],
  asterismShadowBlur: [0, 2],
  asterismLabelSize: [5, 12],
  asterismLabelSpacing: [0, 0.3],
  asterismLabelHaloWidth: [0, 3],
  asterismLabelOpacity: [0, 1],
  referenceLineWidth: [0.25, 6],
  referenceLineOpacity: [0, 1],
  referenceSignSize: [5, 16],
  referenceSignOpacity: [0, 1],
  referenceSignHaloWidth: [0, 4],
  referenceGridLineWidth: [0.25, 1.5],
  referenceGridLineOpacity: [0, 1],
  referencePoleSignSize: [5, 14],
  referencePoleHouseSize: [5, 12],
  referencePoleLabelOpacity: [0, 1],
  referencePoleLabelHaloWidth: [0, 4],
} satisfies Record<AstrocartRendererNumberField, AstrocartNumberBounds>);

export const ASTROCART_CHROME_NUMBER_BOUNDS = freezeNumberBounds({
  controlSize: [18, 56],
  panelRadius: [0, 24],
  fontSize: [7, 24],
  smallFontSize: [6, 20],
  inset: [0, 48],
  gap: [0, 24],
  paddingX: [0, 32],
  paddingY: [0, 24],
} satisfies Record<AstrocartChromeNumberField, AstrocartNumberBounds>);

export const ASTROCART_RENDERER_BOOLEAN_FIELDS = Object.freeze([
  "countryLabelsOn",
  "cityLabelsOn",
  "labelHaloOn",
  "labelsOn",
  "paranLabelHaloOn",
  "paranLabelsOn",
] as const satisfies readonly (keyof AstrocartRendererStyle)[]);

type AstrocartProfileSpec = readonly [cssVar: string, fallback: string | number];

function freezeProfileSpecs<T extends Record<string, AstrocartProfileSpec>>(specs: T): Readonly<T> {
  for (const spec of Object.values(specs)) Object.freeze(spec);
  return Object.freeze(specs);
}

/** Portable profile authoring roles. The active daemon payload remains the
 * resolved iframe authority; these exact dark defaults seed the global catalog
 * and named-profile validator without moving map state into React. */
export const ASTROCART_RENDER_PALETTE_SPECS = freezeProfileSpecs({
  chromePageBg: ["--aries-astrocart-chrome-page-bg", "#232428"],
  chromeBg: ["--aries-astrocart-chrome-bg", "rgba(29,30,33,0.88)"],
  chromeBgThin: ["--aries-astrocart-chrome-bg-thin", "rgba(29,30,33,0.84)"],
  chromeBorder: ["--aries-astrocart-chrome-border", "rgba(255,255,255,0.10)"],
  chromeRule: ["--aries-astrocart-chrome-rule", "rgba(255,255,255,0.08)"],
  chromeText: ["--aries-astrocart-chrome-text", "#e2e3e6"],
  chromeDim: ["--aries-astrocart-chrome-dim", "#b0b3b8"],
  chromeSoft: ["--aries-astrocart-chrome-soft", "#c4c6ca"],
  chromeButtonActiveBg: ["--aries-astrocart-chrome-button-active-bg", "rgba(255,255,255,0.12)"],
  chromeButtonHoverBg: ["--aries-astrocart-chrome-button-hover-bg", "rgba(255,255,255,0.05)"],
  chromeButtonActiveFg: ["--aries-astrocart-chrome-button-active-fg", "#ffffff"],
  chromeKeyLine: ["--aries-astrocart-chrome-key-line", "#d0d2d6"],
  chromeKeyParan: ["--aries-astrocart-chrome-key-paran", "#e59246"],
  chromePopupBg: ["--aries-astrocart-chrome-popup-bg", "#23262c"],
  chromeMenuBg: ["--aries-astrocart-chrome-menu-bg", "rgba(37,39,44,0.88)"],
  chromeMenuBorder: ["--aries-astrocart-chrome-menu-border", "rgba(255,255,255,0.14)"],
  chromeMenuShadow: ["--aries-astrocart-chrome-menu-shadow", "rgba(0,0,0,0.45)"],
  chromeMenuHoverBg: ["--aries-astrocart-chrome-menu-hover-bg", "#0a84ff"],
  chromeMenuHoverFg: ["--aries-astrocart-chrome-menu-hover-fg", "#ffffff"],
  mapCasing: ["--aries-astrocart-map-casing", "rgba(10,12,16,0.85)"],
  mapLabelColor: ["--aries-astrocart-map-label-color", "#e2e3e6"],
  mapLabelHalo: ["--aries-astrocart-map-label-halo", "rgba(10,12,16,0.85)"],
  mapParanColor: ["--aries-astrocart-map-paran-color", "#e59246"],
  mapParanHalo: ["--aries-astrocart-map-paran-halo", "rgba(10,12,16,0.85)"],
  mapPageBg: ["--aries-astrocart-map-page-bg", "#1a1d21"],
  mapOceanColor: ["--aries-astrocart-map-ocean-color", "#232a32"],
  mapLandColor: ["--aries-astrocart-map-land-color", "#31353a"],
  mapBorderColor: ["--aries-astrocart-map-border-color", "#59616a"],
  mapCountryLabelColor: ["--aries-astrocart-map-country-label-color", "#d7dbe0"],
  mapCountryLabelHalo: ["--aries-astrocart-map-country-label-halo", "rgba(10,12,16,0.88)"],
  mapCityLabelColor: ["--aries-astrocart-map-city-label-color", "#9ea5ae"],
  mapCityLabelHalo: ["--aries-astrocart-map-city-label-halo", "rgba(10,12,16,0.88)"],
  mapMinorPlaceLabelColor: ["--aries-astrocart-map-minor-place-label-color", "#868d95"],
  mapMinorPlaceLabelHalo: ["--aries-astrocart-map-minor-place-label-halo", "rgba(10,12,16,0.50)"],
  mapWaterLabelColor: ["--aries-astrocart-map-water-label-color", "#8db5d9"],
  mapWaterLabelHalo: ["--aries-astrocart-map-water-label-halo", "rgba(10,12,16,0.62)"],
  mapHospitalLabelColor: ["--aries-astrocart-map-hospital-label-color", "#c2c7cd"],
  mapHospitalLabelHalo: ["--aries-astrocart-map-hospital-label-halo", "rgba(10,12,16,0.72)"],
  mapHospitalFillColor: ["--aries-astrocart-map-hospital-fill-color", "rgba(182,188,196,0.10)"],
  mapRoadColor: ["--aries-astrocart-map-road-color", "#454d57"],
  mapStreetNameColor: ["--aries-astrocart-map-street-name-color", "rgba(230,235,240,0.42)"],
  mapStreetNameHalo: ["--aries-astrocart-map-street-name-halo", "rgba(10,12,16,0.22)"],
  mapResidentialColor: ["--aries-astrocart-map-residential-color", "rgba(70,76,84,0.08)"],
  mapFallbackMcColor: ["--aries-astrocart-map-fallback-mc-color", "#e74c3c"],
  mapFallbackIcColor: ["--aries-astrocart-map-fallback-ic-color", "#8e44ad"],
  mapFallbackAscColor: ["--aries-astrocart-map-fallback-asc-color", "#2ecc71"],
  mapFallbackDscColor: ["--aries-astrocart-map-fallback-dsc-color", "#f39c12"],
  mapFallbackUnknownColor: ["--aries-astrocart-map-fallback-unknown-color", "#888888"],
  mapEclipseShadowColor: ["--aries-astrocart-map-eclipse-shadow-color", "rgba(5,6,7,0.34)"],
  mapEclipseOutlineColor: ["--aries-astrocart-map-eclipse-outline-color", "#c8c2b5"],
  mapEclipseCenterColor: ["--aries-astrocart-map-eclipse-center-color", "#d9b760"],
  mapEclipseHaloColor: ["--aries-astrocart-map-eclipse-halo-color", "rgba(8,11,15,0.92)"],
  mapAsterismHighlightColor: ["--aries-astrocart-map-asterism-highlight-color", "#c9a7ff"],
  mapAsterismShadowColor: ["--aries-astrocart-map-asterism-shadow-color", "#4f8cff"],
  mapReferenceEclipticColor: ["--aries-astrocart-map-reference-ecliptic-color", "#d7d7d9"],
  mapReferenceEquatorColor: ["--aries-astrocart-map-reference-equator-color", "#dcdccd"],
  mapReferenceAscColor: ["--aries-astrocart-map-reference-asc-color", "#cdcdd1"],
  mapReferenceMcColor: ["--aries-astrocart-map-reference-mc-color", "#cdcdd1"],
  mapReferenceHouseGridColor: ["--aries-astrocart-map-reference-house-grid-color", "#8a8b8d"],
  mapReferenceZodiacGridColor: ["--aries-astrocart-map-reference-zodiac-grid-color", "#d7d7d9"],
  mapSunLineColor: ["--aries-astrocart-map-sun-line-color", "#ffd700"],
  mapMoonLineColor: ["--aries-astrocart-map-moon-line-color", "#00bfff"],
  mapMercuryLineColor: ["--aries-astrocart-map-mercury-line-color", "#8a2be2"],
  mapVenusLineColor: ["--aries-astrocart-map-venus-line-color", "#008000"],
  mapMarsLineColor: ["--aries-astrocart-map-mars-line-color", "#b22222"],
  mapJupiterLineColor: ["--aries-astrocart-map-jupiter-line-color", "#0000ff"],
  mapSaturnLineColor: ["--aries-astrocart-map-saturn-line-color", "#606060"],
  mapUranusLineColor: ["--aries-astrocart-map-uranus-line-color", "#000080"],
  mapNeptuneLineColor: ["--aries-astrocart-map-neptune-line-color", "#000080"],
  mapPlutoLineColor: ["--aries-astrocart-map-pluto-line-color", "#000080"],
  mapChironLineColor: ["--aries-astrocart-map-chiron-line-color", "#800080"],
  mapNorthNodeLineColor: ["--aries-astrocart-map-north-node-line-color", "#8b3626"],
  mapSouthNodeLineColor: ["--aries-astrocart-map-south-node-line-color", "#8b3626"],
});

export const ASTROCART_RENDER_TOKEN_SPECS = freezeProfileSpecs({
  chromeControlSize: ["--aries-astrocart-chrome-control-size", 28],
  chromePanelRadius: ["--aries-astrocart-chrome-panel-radius", 6],
  chromeFontSize: ["--aries-astrocart-chrome-font-size", 11],
  chromeSmallFontSize: ["--aries-astrocart-chrome-small-font-size", 10],
  chromeInset: ["--aries-astrocart-chrome-inset", 8],
  chromeGap: ["--aries-astrocart-chrome-gap", 4],
  chromePaddingX: ["--aries-astrocart-chrome-padding-x", 8],
  chromePaddingY: ["--aries-astrocart-chrome-padding-y", 6],
  mapCountryLabelSize: ["--aries-astrocart-map-country-label-size", 12],
  mapCityLabelSize: ["--aries-astrocart-map-city-label-size", 10.5],
  mapMinorPlaceLabelSize: ["--aries-astrocart-map-minor-place-label-size", 9.4],
  mapWaterLabelSize: ["--aries-astrocart-map-water-label-size", 11],
  mapCasingWidth: ["--aries-astrocart-map-casing-width", 3],
  mapCasingOpacity: ["--aries-astrocart-map-casing-opacity", 0.9],
  mapSolidWidth: ["--aries-astrocart-map-solid-width", 1.6],
  mapSolidOpacity: ["--aries-astrocart-map-solid-opacity", 0.95],
  mapDashedWidth: ["--aries-astrocart-map-dashed-width", 1.6],
  mapDashedOpacity: ["--aries-astrocart-map-dashed-opacity", 0.95],
  mapDashedOn: ["--aries-astrocart-map-dashed-on", 3],
  mapDashedOff: ["--aries-astrocart-map-dashed-off", 2],
  mapParanWidth: ["--aries-astrocart-map-paran-width", 1],
  mapParanLineOpacity: ["--aries-astrocart-map-paran-line-opacity", 0.7],
  mapParanDashOn: ["--aries-astrocart-map-paran-dash-on", 1],
  mapParanDashOff: ["--aries-astrocart-map-paran-dash-off", 2],
  mapLocalSpaceOppositionWidthScale: ["--aries-astrocart-map-local-space-opposition-width-scale", 0.9],
  mapLocalSpaceOppositionOpacityScale: ["--aries-astrocart-map-local-space-opposition-opacity-scale", 0.88],
  mapLocalSpaceOppositionDashOnScale: ["--aries-astrocart-map-local-space-opposition-dash-on-scale", 0.65],
  mapLocalSpaceOppositionDashOffScale: ["--aries-astrocart-map-local-space-opposition-dash-off-scale", 1.25],
  mapAspectLineWidthScale: ["--aries-astrocart-map-aspect-line-width-scale", 0.82],
  mapAspectLineOpacityScale: ["--aries-astrocart-map-aspect-line-opacity-scale", 0.78],
  mapAspectLineDashOn: ["--aries-astrocart-map-aspect-line-dash-on", 0.45],
  mapAspectLineDashOff: ["--aries-astrocart-map-aspect-line-dash-off", 1.55],
  mapZenithRadiusMin: ["--aries-astrocart-map-zenith-radius-min", 3],
  mapZenithRadiusWidthScale: ["--aries-astrocart-map-zenith-radius-width-scale", 2],
  mapZenithStrokeWidthMin: ["--aries-astrocart-map-zenith-stroke-width-min", 1],
  mapTransitLayerOpacity: ["--aries-astrocart-map-transit-layer-opacity", 0.82],
  mapProgressionLayerOpacity: ["--aries-astrocart-map-progression-layer-opacity", 0.68],
  mapLabelSize: ["--aries-astrocart-map-label-size", 11],
  mapLabelSpacing: ["--aries-astrocart-map-label-spacing", 0.04],
  mapLabelHaloWidth: ["--aries-astrocart-map-label-halo-width", 1],
  mapLabelOpacity: ["--aries-astrocart-map-label-opacity", 1],
  mapDomLabelOpacityScale: ["--aries-astrocart-map-dom-label-opacity-scale", 0.9],
  mapParanLabelSize: ["--aries-astrocart-map-paran-label-size", 11],
  mapParanLabelSpacing: ["--aries-astrocart-map-paran-label-spacing", 0.02],
  mapParanLabelHaloWidth: ["--aries-astrocart-map-paran-label-halo-width", 1.3],
  mapParanLabelOpacity: ["--aries-astrocart-map-paran-label-opacity", 1],
  mapLocalCountryBorderWidth: ["--aries-astrocart-map-local-country-border-width", 0.8],
  mapLocalCountryBorderOpacity: ["--aries-astrocart-map-local-country-border-opacity", 0.62],
  mapLocalRegionBorderWidth: ["--aries-astrocart-map-local-region-border-width", 0.45],
  mapLocalRegionBorderOpacity: ["--aries-astrocart-map-local-region-border-opacity", 0.28],
  mapResidentialOpacityScale: ["--aries-astrocart-map-residential-opacity-scale", 1],
  mapHospitalFillOpacityScale: ["--aries-astrocart-map-hospital-fill-opacity-scale", 1],
  mapRoadWidthScale: ["--aries-astrocart-map-road-width-scale", 1],
  mapRoadOpacityScale: ["--aries-astrocart-map-road-opacity-scale", 1],
  mapRoadBlur: ["--aries-astrocart-map-road-blur", 0],
  mapWaterLineOpacity: ["--aries-astrocart-map-water-line-opacity", 0.65],
  mapWaterLabelSpacing: ["--aries-astrocart-map-water-label-spacing", 0.12],
  mapWaterLabelHaloWidth: ["--aries-astrocart-map-water-label-halo-width", 1.05],
  mapWaterLabelHaloBlur: ["--aries-astrocart-map-water-label-halo-blur", 0.45],
  mapWaterLineLabelOpacity: ["--aries-astrocart-map-water-line-label-opacity", 0.62],
  mapWaterPointLabelOpacity: ["--aries-astrocart-map-water-point-label-opacity", 0.74],
  mapStreetLabelSize: ["--aries-astrocart-map-street-label-size", 11],
  mapStreetLabelHaloWidth: ["--aries-astrocart-map-street-label-halo-width", 0.65],
  mapStreetLabelHaloBlur: ["--aries-astrocart-map-street-label-halo-blur", 0.25],
  mapStreetLabelOpacity: ["--aries-astrocart-map-street-label-opacity", 1],
  mapHospitalLabelSize: ["--aries-astrocart-map-hospital-label-size", 11.2],
  mapHospitalLabelHaloWidth: ["--aries-astrocart-map-hospital-label-halo-width", 1],
  mapHospitalLabelHaloBlur: ["--aries-astrocart-map-hospital-label-halo-blur", 0.35],
  mapHospitalLabelOpacity: ["--aries-astrocart-map-hospital-label-opacity", 0.82],
  mapHospitalIconOpacity: ["--aries-astrocart-map-hospital-icon-opacity", 0.5],
  mapCountryLabelSpacing: ["--aries-astrocart-map-country-label-spacing", 0.04],
  mapCountryLabelHaloWidth: ["--aries-astrocart-map-country-label-halo-width", 1.35],
  mapCountryLabelHaloBlur: ["--aries-astrocart-map-country-label-halo-blur", 0.8],
  mapCountryLabelOpacity: ["--aries-astrocart-map-country-label-opacity", 0.92],
  mapCityLabelSpacing: ["--aries-astrocart-map-city-label-spacing", 0.02],
  mapCityLabelHaloWidth: ["--aries-astrocart-map-city-label-halo-width", 1.15],
  mapCityLabelHaloBlur: ["--aries-astrocart-map-city-label-halo-blur", 0.7],
  mapCityLabelOpacity: ["--aries-astrocart-map-city-label-opacity", 0.82],
  mapMinorPlaceLabelSpacing: ["--aries-astrocart-map-minor-place-label-spacing", 0.01],
  mapMinorPlaceLabelHaloWidth: ["--aries-astrocart-map-minor-place-label-halo-width", 0.35],
  mapMinorPlaceLabelHaloBlur: ["--aries-astrocart-map-minor-place-label-halo-blur", 0.2],
  mapMinorPlaceLabelOpacity: ["--aries-astrocart-map-minor-place-label-opacity", 0.64],
  mapEclipseShadowWidth: ["--aries-astrocart-map-eclipse-shadow-width", 12],
  mapEclipseShadowOpacity: ["--aries-astrocart-map-eclipse-shadow-opacity", 0.92],
  mapEclipseShadowBlur: ["--aries-astrocart-map-eclipse-shadow-blur", 3],
  mapEclipseFillOpacity: ["--aries-astrocart-map-eclipse-fill-opacity", 0.9],
  mapEclipseOutlineWidth: ["--aries-astrocart-map-eclipse-outline-width", 0.8],
  mapEclipseOutlineOpacity: ["--aries-astrocart-map-eclipse-outline-opacity", 0.24],
  mapEclipseLimitWidth: ["--aries-astrocart-map-eclipse-limit-width", 1.2],
  mapEclipseLimitOpacity: ["--aries-astrocart-map-eclipse-limit-opacity", 0.78],
  mapEclipseLimitDashOn: ["--aries-astrocart-map-eclipse-limit-dash-on", 3],
  mapEclipseLimitDashOff: ["--aries-astrocart-map-eclipse-limit-dash-off", 2],
  mapEclipseCenterWidth: ["--aries-astrocart-map-eclipse-center-width", 2],
  mapEclipseCenterOpacity: ["--aries-astrocart-map-eclipse-center-opacity", 0.96],
  mapEclipseMaximumRadius: ["--aries-astrocart-map-eclipse-maximum-radius", 4.5],
  mapEclipseMaximumStrokeWidth: ["--aries-astrocart-map-eclipse-maximum-stroke-width", 2],
  mapEclipseLabelSize: ["--aries-astrocart-map-eclipse-label-size", 11],
  mapEclipseLabelSpacing: ["--aries-astrocart-map-eclipse-label-spacing", 0],
  mapEclipseLabelHaloWidth: ["--aries-astrocart-map-eclipse-label-halo-width", 1.3],
  mapEclipseLabelOpacity: ["--aries-astrocart-map-eclipse-label-opacity", 1],
  mapAsterismLineWidth: ["--aries-astrocart-map-asterism-line-width", 0.7],
  mapAsterismLineOpacity: ["--aries-astrocart-map-asterism-line-opacity", 0.52],
  mapAsterismStarRadiusMin: ["--aries-astrocart-map-asterism-star-radius-min", 0.85],
  mapAsterismStarRadiusMax: ["--aries-astrocart-map-asterism-star-radius-max", 3.8],
  mapAsterismStarOpacity: ["--aries-astrocart-map-asterism-star-opacity", 0.92],
  mapAsterismShadowSpread: ["--aries-astrocart-map-asterism-shadow-spread", 0.65],
  mapAsterismShadowOpacity: ["--aries-astrocart-map-asterism-shadow-opacity", 0.28],
  mapAsterismShadowBlur: ["--aries-astrocart-map-asterism-shadow-blur", 0.55],
  mapAsterismLabelSize: ["--aries-astrocart-map-asterism-label-size", 7],
  mapAsterismLabelSpacing: ["--aries-astrocart-map-asterism-label-spacing", 0.06],
  mapAsterismLabelHaloWidth: ["--aries-astrocart-map-asterism-label-halo-width", 0.55],
  mapAsterismLabelOpacity: ["--aries-astrocart-map-asterism-label-opacity", 0.72],
  mapReferenceLineWidth: ["--aries-astrocart-map-reference-line-width", 1.1],
  mapReferenceLineOpacity: ["--aries-astrocart-map-reference-line-opacity", 0.78],
  mapReferenceSignSize: ["--aries-astrocart-map-reference-sign-size", 12],
  mapReferenceSignOpacity: ["--aries-astrocart-map-reference-sign-opacity", 1],
  mapReferenceSignHaloWidth: ["--aries-astrocart-map-reference-sign-halo-width", 1.25],
  mapReferenceGridLineWidth: ["--aries-astrocart-map-reference-grid-line-width", 0.5],
  mapReferenceGridLineOpacity: ["--aries-astrocart-map-reference-grid-line-opacity", 0.34],
  mapReferencePoleSignSize: ["--aries-astrocart-map-reference-pole-sign-size", 8],
  mapReferencePoleHouseSize: ["--aries-astrocart-map-reference-pole-house-size", 7],
  mapReferencePoleLabelOpacity: ["--aries-astrocart-map-reference-pole-label-opacity", 0.82],
  mapReferencePoleLabelHaloWidth: ["--aries-astrocart-map-reference-pole-label-halo-width", 0.9],
  mapSunLineWidthScale: ["--aries-astrocart-map-sun-line-width-scale", 1],
  mapSunLineOpacity: ["--aries-astrocart-map-sun-line-opacity", 1],
  mapMoonLineWidthScale: ["--aries-astrocart-map-moon-line-width-scale", 1],
  mapMoonLineOpacity: ["--aries-astrocart-map-moon-line-opacity", 1],
  mapMercuryLineWidthScale: ["--aries-astrocart-map-mercury-line-width-scale", 1],
  mapMercuryLineOpacity: ["--aries-astrocart-map-mercury-line-opacity", 1],
  mapVenusLineWidthScale: ["--aries-astrocart-map-venus-line-width-scale", 1],
  mapVenusLineOpacity: ["--aries-astrocart-map-venus-line-opacity", 1],
  mapMarsLineWidthScale: ["--aries-astrocart-map-mars-line-width-scale", 1],
  mapMarsLineOpacity: ["--aries-astrocart-map-mars-line-opacity", 1],
  mapJupiterLineWidthScale: ["--aries-astrocart-map-jupiter-line-width-scale", 1],
  mapJupiterLineOpacity: ["--aries-astrocart-map-jupiter-line-opacity", 1],
  mapSaturnLineWidthScale: ["--aries-astrocart-map-saturn-line-width-scale", 1],
  mapSaturnLineOpacity: ["--aries-astrocart-map-saturn-line-opacity", 1],
  mapUranusLineWidthScale: ["--aries-astrocart-map-uranus-line-width-scale", 1],
  mapUranusLineOpacity: ["--aries-astrocart-map-uranus-line-opacity", 1],
  mapNeptuneLineWidthScale: ["--aries-astrocart-map-neptune-line-width-scale", 1],
  mapNeptuneLineOpacity: ["--aries-astrocart-map-neptune-line-opacity", 1],
  mapPlutoLineWidthScale: ["--aries-astrocart-map-pluto-line-width-scale", 1],
  mapPlutoLineOpacity: ["--aries-astrocart-map-pluto-line-opacity", 1],
  mapChironLineWidthScale: ["--aries-astrocart-map-chiron-line-width-scale", 1],
  mapChironLineOpacity: ["--aries-astrocart-map-chiron-line-opacity", 1],
  mapNorthNodeLineWidthScale: ["--aries-astrocart-map-north-node-line-width-scale", 1],
  mapNorthNodeLineOpacity: ["--aries-astrocart-map-north-node-line-opacity", 1],
  mapSouthNodeLineWidthScale: ["--aries-astrocart-map-south-node-line-width-scale", 1],
  mapSouthNodeLineOpacity: ["--aries-astrocart-map-south-node-line-opacity", 1],
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  kind: "string" | "number" | "boolean",
  label: string,
): void {
  for (const field of fields) {
    const item = value[field];
    if (typeof item !== kind || (kind === "number" && !Number.isFinite(item))) {
      throw new Error(`${label}.${field} must be a finite ${kind}`);
    }
  }
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const allowed = new Set(fields);
  const extra = Object.keys(value).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label}.${extra} is not part of schema v${ASTROCART_STYLE_SCHEMA_VERSION}`);
}

function requireBoundedRendererNumbers(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const field of ASTROCART_RENDERER_NUMBER_FIELDS) {
    const item = value[field] as number;
    const [minimum, maximum] = ASTROCART_RENDERER_NUMBER_BOUNDS[field];
    if (item < minimum || item > maximum) {
      throw new Error(`${label}.${field} must be between ${minimum} and ${maximum}`);
    }
  }
}

function requireBoundedChromeNumbers(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const field of ASTROCART_CHROME_NUMBER_FIELDS) {
    const item = value[field] as number;
    const [minimum, maximum] = ASTROCART_CHROME_NUMBER_BOUNDS[field];
    if (item < minimum || item > maximum) {
      throw new Error(`${label}.${field} must be between ${minimum} and ${maximum}`);
    }
  }
}

/** Validate the daemon payload before it crosses the iframe message boundary. */
export function parseAstrocartStyle(value: unknown): AstrocartStyle {
  const candidate = record(value, "AstrocartStyle");
  if (candidate.schemaVersion !== ASTROCART_STYLE_SCHEMA_VERSION) {
    throw new Error(`unsupported AstrocartStyle schema ${String(candidate.schemaVersion)}`);
  }
  if (candidate.mode !== "dark" && candidate.mode !== "light") {
    throw new Error("AstrocartStyle.mode must be dark or light");
  }
  if (typeof candidate.styleRevision !== "string" || typeof candidate.styleHash !== "string") {
    throw new Error("AstrocartStyle identity is missing");
  }
  requireExactFields(
    candidate,
    ["schemaVersion", "styleRevision", "styleHash", "mode", "chrome", "renderer", "points", "behavior"],
    "AstrocartStyle",
  );

  const chrome = record(candidate.chrome, "AstrocartStyle.chrome");
  requireFields(chrome, ASTROCART_CHROME_STRING_FIELDS, "string", "AstrocartStyle.chrome");
  requireFields(chrome, ASTROCART_CHROME_NUMBER_FIELDS, "number", "AstrocartStyle.chrome");
  requireBoundedChromeNumbers(chrome, "AstrocartStyle.chrome");
  const titlebarSafeTop = chrome.titlebarSafeTop;
  if (typeof titlebarSafeTop !== "number" || !Number.isFinite(titlebarSafeTop)) {
    throw new Error("AstrocartStyle.chrome.titlebarSafeTop must be finite");
  }
  if (
    titlebarSafeTop < ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS[0]
    || titlebarSafeTop > ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS[1]
  ) {
    throw new Error(
      `AstrocartStyle.chrome.titlebarSafeTop must be between ${ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS[0]} and ${ASTROCART_TITLEBAR_SAFE_TOP_BOUNDS[1]}`,
    );
  }
  requireExactFields(
    chrome,
    [
      ...ASTROCART_CHROME_STRING_FIELDS,
      ...ASTROCART_CHROME_NUMBER_FIELDS,
      "titlebarSafeTop",
    ],
    "AstrocartStyle.chrome",
  );

  const renderer = record(candidate.renderer, "AstrocartStyle.renderer");
  requireFields(renderer, ASTROCART_RENDERER_STRING_FIELDS, "string", "AstrocartStyle.renderer");
  requireFields(renderer, ASTROCART_RENDERER_NUMBER_FIELDS, "number", "AstrocartStyle.renderer");
  requireBoundedRendererNumbers(renderer, "AstrocartStyle.renderer");
  requireFields(renderer, ASTROCART_RENDERER_BOOLEAN_FIELDS, "boolean", "AstrocartStyle.renderer");
  requireExactFields(
    renderer,
    [
      ...ASTROCART_RENDERER_STRING_FIELDS,
      ...ASTROCART_RENDERER_NUMBER_FIELDS,
      ...ASTROCART_RENDERER_BOOLEAN_FIELDS,
    ],
    "AstrocartStyle.renderer",
  );

  const rawPoints = record(candidate.points, "AstrocartStyle.points");
  const points: Record<string, AstrocartPointStyle> = {};
  for (const [id, rawPoint] of Object.entries(rawPoints)) {
    const point = record(rawPoint, `AstrocartStyle.points.${id}`);
    requireFields(point, ["label", "color", "glyphMorinus"], "string", `AstrocartStyle.points.${id}`);
    requireFields(point, ["lineWidthScale", "lineOpacity"], "number", `AstrocartStyle.points.${id}`);
    requireExactFields(
      point,
      ["label", "color", "glyphMorinus", "lineWidthScale", "lineOpacity"],
      `AstrocartStyle.points.${id}`,
    );
    const lineWidthScale = point.lineWidthScale as number;
    const lineOpacity = point.lineOpacity as number;
    if (
      lineWidthScale < ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[0]
      || lineWidthScale > ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[1]
    ) {
      throw new Error(
        `AstrocartStyle.points.${id}.lineWidthScale must be between ${ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[0]} and ${ASTROCART_POINT_LINE_WIDTH_SCALE_BOUNDS[1]}`,
      );
    }
    if (
      lineOpacity < ASTROCART_POINT_LINE_OPACITY_BOUNDS[0]
      || lineOpacity > ASTROCART_POINT_LINE_OPACITY_BOUNDS[1]
    ) {
      throw new Error(
        `AstrocartStyle.points.${id}.lineOpacity must be between ${ASTROCART_POINT_LINE_OPACITY_BOUNDS[0]} and ${ASTROCART_POINT_LINE_OPACITY_BOUNDS[1]}`,
      );
    }
    points[id] = Object.freeze({
      label: point.label as string,
      color: point.color as string,
      glyphMorinus: point.glyphMorinus as string,
      lineWidthScale,
      lineOpacity,
    });
  }
  const behavior = record(candidate.behavior, "AstrocartStyle.behavior");
  const behaviorFields = [
    "showEcliptic",
    "showEquator",
    "showAscCircle",
    "showMcCircle",
    "showHouseLines",
    "showZodiacLines",
  ] as const;
  for (const field of behaviorFields) {
    if (typeof behavior[field] !== "boolean") {
      throw new Error(`AstrocartStyle.behavior.${field} must be boolean`);
    }
  }
  requireExactFields(behavior, behaviorFields, "AstrocartStyle.behavior");

  return Object.freeze({
    schemaVersion: ASTROCART_STYLE_SCHEMA_VERSION,
    styleRevision: candidate.styleRevision,
    styleHash: candidate.styleHash,
    mode: candidate.mode,
    chrome: Object.freeze({ ...chrome }) as AstrocartChromeStyle,
    renderer: Object.freeze({ ...renderer }) as AstrocartRendererStyle,
    points: Object.freeze(points),
    behavior: Object.freeze({
      showEcliptic: behavior.showEcliptic as boolean,
      showEquator: behavior.showEquator as boolean,
      showAscCircle: behavior.showAscCircle as boolean,
      showMcCircle: behavior.showMcCircle as boolean,
      showHouseLines: behavior.showHouseLines as boolean,
      showZodiacLines: behavior.showZodiacLines as boolean,
    }),
  });
}

export function createAstrocartStyleMessage(value: unknown): Readonly<{
  type: "aries.setDisplayStyle";
  payload: AstrocartStyle;
}> {
  return Object.freeze({
    type: "aries.setDisplayStyle",
    payload: parseAstrocartStyle(value),
  });
}
