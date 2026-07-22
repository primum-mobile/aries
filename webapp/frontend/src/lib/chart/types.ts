// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Chart data shape consumed by drawChart().
 * Simplified from chart.py / planets.py — only what the renderer reads.
 * Flask backend will serve this JSON; for now we use static fixtures.
 */

export type PlanetId =
  | "sun" | "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn"
  | "uranus" | "neptune" | "pluto" | "nnode" | "snode" | "chiron";

export type DignityKind = "domicil" | "exil" | "exal" | "casus" | "peregrin";

export interface ChartPlanet {
  id: PlanetId;
  seId: number; // SE_SUN..SE_CHIRON (matches common.py tables)
  longitude: number;
  latitude: number;
  speed: number; // negative = retrograde
  house?: number; // 1–12
  dignity?: DignityKind;
  // Daemon-resolved render values (export_chart_json.export_planets). The skin
  // prints these; it does not re-derive color/glyph/motion/deg-min.
  color?: string; // CSS rgb() from inspector_service._body_colour
  glyph?: string; // Morinus glyph char from common.common.get_planet_glyph
  motion?: string; // "" | "R" | "S" | station marker, from _motion_marker
  degText?: string;
  minText?: string;
}

/** Body key used by bodyAspects + the click-toggle selection: a planet id, one
 * of the chart points the desktop click target supports, or a daemon-exported
 * secondary-ring point key (`point:<role>:<family>:<id>:<longitude>`). */
export type AspectPointKey = `point:${string}`;
export type AngleAspectKey = "asc" | "mc" | "dc" | "dsc" | "ic";
export type AspectBodyKey = PlanetId | AngleAspectKey | "fortune" | "vertex" | "syzygy" | AspectPointKey;
export type InterChartAspectKey = PlanetId | AngleAspectKey | "fortune" | "vertex" | "syzygy";

export interface ChartAspect {
  p1: AspectBodyKey;
  p2: AspectBodyKey;
  type: number; // ASP_CONJUNCTION..ASP_OPPOSITION
  orb: number;
  maxOrb?: number;
  exact?: boolean;
}

/** One engine-computed aspect record from bodyAspects[X] — the FULL set before
 * the render-time type/visibility filter (export_chart_json.export_body_aspects;
 * desktop force-show source graphchart.py:974-1018). */
export interface BodyAspect {
  other: AspectBodyKey;
  type: number; // ASP_CONJUNCTION..ASP_OPPOSITION
  orb: number;
  maxOrb?: number;
  exact?: boolean;
  applying?: boolean;
  // Engine verdict for the click force-show path: major-only + ayanamsha-correct
  // whole-sign traditional filter, decided in the chart's zodiac
  // (export_chart_json._click_filter_pass). The skin reads this bit instead of
  // recomputing aspect meaning from tropical longitudes.
  showsOnClick?: boolean;
}

/** Click-to-toggle option flags (meaning, daemon-owned). options.py:149-151. */
export interface ClickAspectFlags {
  exclusiveOnClick: boolean;
  showMinor: boolean;
  traditional: boolean;
}

/** Per-body engine aspect adjacency, keyed by AspectBodyKey. */
export type BodyAspectsMap = Partial<Record<AspectBodyKey, BodyAspect[]>>;

export interface DegMin {
  degText: string;
  minText: string;
}

export interface ChartAngles {
  asc: number;
  mc: number;
  armc: number;
  vertex: number;
  dsc: number;
  ic: number;
  ascDegMin?: DegMin;
  mcDegMin?: DegMin;
}

export interface ChartHouses {
  system: "P" | "K" | "R" | "C" | "E" | "W" | "B" | "O" | "M" | "H" | "T";
  cusps: number[]; // 12 values, index 0 = cusp 1 (ASC)
  cuspDegMin?: DegMin[];
}

export interface ChartFortune {
  longitude: number;
  glyph?: string;
  color?: string;
  degText?: string;
  minText?: string;
}

/** Vertex as a drawable body (export_chart_json.export_vertex). Present only
 * when options.showvertex is on. Glyph/color are daemon-resolved like planets;
 * the Vertex has no motion/speed (it's a chart point, graphchart.py:2905). */
export interface ChartVertex {
  longitude: number;
  house?: number;
  glyph?: string;
  color?: string;
  degText?: string;
  minText?: string;
}

export interface ChartSyzygy {
  longitude: number;
  house?: number;
  label?: string;
  glyph?: string;
  glyphFont?: "text" | "morinus";
  color?: string;
  degText?: string;
  minText?: string;
}

export interface ArabicPart {
  id: string;
  label: string;
  glyph?: string; // Morinus glyph; defaults to Fortune
  longitude: number;
}

export interface FixedStar {
  id: string;
  name: string;
  longitude: number;
  magnitude?: number;
}

export interface Midpoint {
  p1: PlanetId;
  p2: PlanetId;
  longitude: number;
}

export interface ChartMeta {
  name: string;
  kind:
    | "radix"
    | "horary"
    | "transit"
    | "solar-return"
    | "lunar-return"
    | "progression"
    | "revolution"
    | "profection"
    | "primary-direction"
    | "composite"
    | "relationship";
  datetime: string; // ISO
  dateDisplay: string; // e.g. "2000.January.02"
  timeDisplay: string; // e.g. "03:04:00, ZN"
  anchorDisplay?: string; // daemon-formatted "date time" for biwheel anchor labels
  place: string;
  placeCoords: string; // "4°43'E, 45°59'N"
  latitude: number;
  longitude: number;
  obliquity: number;
  buildStamp: string; // e.g. "Built: 2026-04-22 19:14"
  age: string; // e.g. "Age: 38.16y"
  titleParts?: string[];
  statusFields?: string[];
  houseSystemLines?: string[];
  cornerLines?: {
    topLeft?: string[];
    bottomLeft?: string[];
  };
}

export interface OverlayInfoRow {
  group?: "dayhour" | "header" | "signal";
  slot?:
    | "planetary-day"
    | "planetary-hour"
    | "term-lord"
    | "lord-of-year"
    | "signal"
    | "station-signal";
  label: string;
  glyphs: Array<{
    char: string;
    color?: string; // CSS color; optional override of palette.angles
    kind?: "planet" | "sign" | "aspect";
    seId?: number; // when kind = planet — picks color from palette
  }>;
  trailing?: string; // e.g. "-7d" / "+0.6d"
}

export interface OverlayInfo {
  rows: OverlayInfoRow[];
  // True when current signal rows were intentionally skipped for a step burst.
  // The document cache keeps the prior populated signal slots visible until a
  // generation-guarded full snapshot replaces them atomically.
  deferredSignals?: boolean;
}

export interface ChartTermSegment {
  rulerSeId: number;
  size: number;
  // Daemon-resolved longitudes/glyph — renderer maps longitude→pixel only.
  boundaryLon?: number;
  rulerLon?: number;
  rulerGlyph?: string;
}

export interface ChartDecanRuler {
  rulerSeId: number;
  rulerLon: number;
  rulerGlyph: string;
}

export interface ChartDecanSegment {
  rulerSeIds: number[];
  rulers?: ChartDecanRuler[];
}

export type ChartRenderRole = "primary" | "outer" | "radix" | "anchor";
export type RenderVariant = "round-classic" | "round-compact" | "round-anglo";
export type OverlayRenderMode = "full" | "step_fast" | "deferred";
export type OuterRingMode =
  | "none"
  | "fixstars"
  | "asteroids"
  | "midpoints"
  | "hybrid_hits"
  | "antiscia"
  | "dodecatemoria"
  | "contra_antiscia"
  | "arabic_parts"
  | "parallel_transits";

export interface RenderInvalidation {
  geometry: boolean;
  dynamic: boolean;
  outerLabel: boolean;
  deferredOuterLabel?: boolean;
}

export interface RingLabelSegment {
  // "text"   -> UI font (plain label)
  // "planet" -> Morinus symbols font, colored by the body's seId
  // "glyph"  -> Morinus symbols font for a non-body glyph (e.g. Lot of
  //             Fortune in the antiscia ring), no seId / textDim color
  // color     -> optional daemon-resolved override for glyphs sourced from an
  //             auxiliary chart not present as primaryChart/comparisonChart
  text: string;
  kind: "text" | "planet" | "glyph";
  seId?: number;
  color?: string;
}

export interface OuterRingItem {
  id: string;
  family: string;
  longitude: number;
  label: string;
  role?: ChartRenderRole;
  segments?: RingLabelSegment[];
  fitPolicy?: "bitmap" | "none";
  searchObjectId?: string;
  motion?: string;
}

export interface InterChartAspect {
  outer: InterChartAspectKey;
  inner: InterChartAspectKey;
  type: number;
  orb: number;
  maxOrb?: number;
  exact?: boolean;
  applying?: boolean;
  showsNormally?: boolean;
  showsOnClick?: boolean;
}

/** Per-endpoint comparison aspect adjacency. Inner endpoints use their raw key
 * (`sun`, `fortune`, `dc`); outer endpoints are prefixed (`outer:sun`). */
export type InterChartAspectSelectionKey = InterChartAspectKey | `outer:${InterChartAspectKey}`;
export type InterChartBodyAspectsMap = Partial<Record<InterChartAspectSelectionKey, InterChartAspect[]>>;

export interface Chart {
  meta: ChartMeta;
  planets: ChartPlanet[];
  angles: ChartAngles;
  houses: ChartHouses;
  fortune?: ChartFortune;
  vertex?: ChartVertex;
  syzygy?: ChartSyzygy;
  arabicParts?: ArabicPart[];
  fixedStars?: FixedStar[];
  midpoints?: Midpoint[];
  surveilMarks?: SurveilMark[];
  aspects: ChartAspect[];
  // Additive click-to-toggle data (export_chart_json). Option flags own the
  // meaning; bodyAspects is the force-show source. Optional for older payloads.
  clickAspectFlags?: ClickAspectFlags;
  bodyAspects?: BodyAspectsMap;
  overlay?: OverlayInfo;
  palette?: Partial<ChartPalette>;
  options: {
    uranus: boolean;
    pluto: number;
    signVariant: 1 | 2;
    useDignityColors?: boolean;
    useZodiacElementColors?: boolean;
    theme?: 0 | 1 | 2;
    angloDenseLabelLayout?: "leader-columns" | "routed-cusps";
    ascmcSize?: number;
    chartRingThickness?: number;
    showLoF?: boolean;
    showVertex?: boolean;
    showPrenatalSyzygy?: boolean;
    showAspectsToVertex?: boolean;
    showFixstarsToHcs?: boolean;
    showFixstarsToLoF?: boolean;
    showHouses?: boolean;
    showPositions?: boolean;
    showInformation?: boolean;
    showHouseSystem?: boolean;
    showSymbols?: boolean;
    showAspects?: boolean;
    showMinorAspects?: boolean;
    aspectThicknessMode?: boolean;
    aspectOpacityMode?: boolean;
    showTerms?: boolean;
    showAngleArrowheads?: boolean;
    showCusplessAscMcLabels?: boolean;
    selectedTermSet?: number;
    terms?: ChartTermSegment[][];
    showDecans?: boolean;
    selectedDecanSet?: number;
    decans?: ChartDecanSegment[];
    signColors?: string[];
  };
}

// Signified-real-time + age readout for an open symbolic derived chart.
// Every value is derived daemon-side from canonical session/engine state; the
// React skin renders these strings and never computes symbolic math. Used by
// progression and PD-in-Chart documents.
export interface SymbolicTimeReadout {
  method: number | string;
  signifiedDatetime: string;
  signifiedDateText: string;
  signifiedDateDisplay?: string;
  signifiedTimeDisplay?: string;
  progressedDatetime: string;
  ageYears: number;
  ageYearsInt: number;
  ageText: string;
  realText: string;
  symbolicRealText: string;
}

// Live session metadata block the daemon attaches to a document snapshot
// (workspace_service.document_snapshot -> snapshot['document']).
export interface SnapshotDocumentMeta {
  documentId: string;
  featureKind?: string | null;
  launcherKind?: string | null;
  chartVisualMode?: "zodiac" | "mdo" | "mundane" | "ascensional_transits" | string | null;
  comparisonName?: string | null;
  compoundKind?: string | null;
  compositeVariant?: string | null;
  viewMode: number;
  displayDatetime?: string | null;
  titleSuffix?: string | null;
  binding?: unknown;
  dirty: boolean;
  editDirty: boolean;
  stepDirty: boolean;
  isActive: boolean;
  showRadixComparison?: boolean;
  symbolicTime?: SymbolicTimeReadout | null;
}

export interface ChartRenderSnapshot {
  primaryChart: Chart;
  comparisonChart?: Chart | null;
  radixChart?: Chart | null;
  displayAnchorChart?: Chart | null;
  displayDatetime: string;
  renderVariant: RenderVariant;
  overlayRenderMode: OverlayRenderMode;
  // The post-burst snapshot updates semantic/store truth only. The immediately
  // preceding step frame already painted current wheel geometry and a validated
  // collision layout, so repainting canvas layers here would create a late snap.
  settleOverlayOnly?: boolean;
  renderInvalidation?: RenderInvalidation;
  outerRingMode: OuterRingMode;
  // Daemon-owned comparison grammar. `standard` keeps the primary house wheel
  // and places the comparison bodies outside it; `with-houses` is the distinct
  // biwheel form with a second house annulus.
  comparisonLayout?: "standard" | "with-houses";
  comparisonWholeSign?: boolean;
  interChartAspects?: InterChartAspect[];
  interChartBodyAspects?: InterChartBodyAspectsMap;
  outerRingItems?: Partial<Record<OuterRingMode, OuterRingItem[]>>;
  // Compatibility mirrors used by older snapshots. Current payloads keep the
  // canonical click-toggle data on primaryChart to avoid serializing the same
  // aspect adjacency graph twice.
  clickAspectFlags?: ClickAspectFlags;
  bodyAspects?: BodyAspectsMap;
  // Live session metadata (only on workspace document snapshots).
  document?: SnapshotDocumentMeta | null;
  debugTiming?: {
    documentId: string;
    overlayRenderMode: OverlayRenderMode;
    totalMs: number;
    phases: Array<{ name: string; ms: number }>;
    export?: {
      phases?: Array<{ name: string; ms: number }>;
      outerRingCounts?: Record<string, number>;
    };
  } | null;
}

export interface ChartPalette {
  background: string;
  frame: string;
  signs: string;
  angles: string;
  houses: string;
  houseNums: string;
  positions: string;
  peregrin: string;
  domicil: string;
  exil: string;
  exal: string;
  casus: string;
  textDim: string;
  textBright: string;
  fortune: string;
  planets: string[];   // 13-entry palette indexed by SE id
  aspects: string[];   // 14-entry palette indexed by aspect type
                       // (0=Conj, 1=Semisext, 2=Semisq, 3=Sext, 4=Quint,
                       //  5=Sq, 6=Trine, 7=Sesq, 8=Biquint, 9=Quinc,
                       //  10=Opp, 11=Septile, 12=Parallel, 13=Contraparallel)
  // Warm orange accent for Surveil study marks, luminance-picked daemon-side
  // (tokens.SURVEIL_ACCENT_*_RGB). Optional for older payloads.
  surveilAccent?: string;
}

// Global Surveil study mark: a captured zodiacal longitude rendered as a tick +
// glyph/label outside the wheel (graphchart.drawSurveilMarks).
export interface SurveilMark {
  id: string;
  longitude: number;
  label: string;
  glyph: string;
  glyphFont: "morinus" | "text";
  sourceName?: string;
  studyName?: string;
}
