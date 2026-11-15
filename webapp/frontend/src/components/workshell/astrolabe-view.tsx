// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import * as React from "react";
import { readObservers, writeObservers, loadObserverHitMask, observerFootScreen, observerRay, observerGround, observerHit, type ObserverPosition, type ObserverFrame } from "./astrolabe-observers";
import { resolveMinorDignityDecoration, triplicityColorRole } from "@/lib/chart/wheel-render-style";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DESIGN_TUNERS_ENABLED, useDesignTunerStore } from "@/stores/design-tuner-store";
import {
  ASTROLABE_ECLIPTIC_STYLES,
  eclipticEngraving,
  eclipticEngravingDepth,
  engraveEcliptic,
  type AstrolabeEclipticStyle,
  type EclipticSample,
} from "@/components/workshell/astrolabe-ecliptic-ruler";
import { CanvasDraw } from "@/lib/chart/canvas-draw";
import {
  contactAnchor,
  paintContactCue,
  strongestContact,
  stickyHouseNumber,
  zoomGrow,
  zoomRamp,
  type LiveContact,
} from "./astrolabe-annotations";
import { astrolabeHouseLabelAnchor } from "@/lib/chart/astrolabe-house-labels";
import { astrolabeCameraFromZoom, astrolabeZoomFromCamera } from "@/lib/chart/astrolabe-camera";
import { registerAstrolabeDisplayCommands } from "@/lib/chart/astrolabe-display-commands.mjs";
import {
  registerAstrolabeNavigator,
  type AstrolabeNavigationKey,
  type AstrolabeNavigationModifiers,
} from "@/lib/chart/astrolabe-navigation.mjs";
import {
  canvasPngPayload,
  normalizeCanvasForPrint,
  PNG_EXPORT_PIXEL_SIZE,
  registerChartExportRenderer,
  renderCanvasChartExport,
  type ChartExportRenderRequest,
  type ChartExportRenderResult,
} from "@/lib/chart/chart-export-registry";
import { drawPngWatermark, preparePngWatermark } from "@/lib/chart/chart-export-watermark";
import {
  ASTROLABE_PLANET_GLYPH_PX_ATTR,
  markAstrolabePlanetGlyphSize,
  resolveAstrolabeRenderStyle,
  resolveAstrolabeStrokeWidths,
  type AstrolabeRenderStyle,
} from "@/lib/chart/astrolabe-render-style";
import { morinusTextFontFromTokens } from "@/lib/chart/chart-fonts";
import { awaitFonts } from "@/lib/chart/draw-chart";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { renderPolarAzimuthal } from "@/components/workshell/astrolabe-polar-render";
import { nextPdFocus, paintPdReprojection } from "./astrolabe-pd-reprojection";
import {
  AstrolabeCorners,
  paintAstrolabeCorners,
  resolveAstrolabeCornerStyle,
} from "@/components/workshell/astrolabe-corners";
import { useAstrolabeStore } from "@/stores/astrolabe-store";
import {
  ASTROLABE_ZOOM_IDENTITY,
  clampAstrolabeZoom,
  drawGraduatedLimb,
  paintEarthInFront,
  drawVisibleRulerTick,
  drawReteArcSpan,
  drawStarPointer,
  drawAsterisms,
  starHoverTarget,
  findHoverTarget,
  divisionHoverTarget,
  createAstrolabeReteSurface,
  hitAstrolabeRete,
  astrolabeReteTurn,
  starLabelShown,
  type StarLabelMode,
  mapPoint,
  divisionGlyphColor,
  pointInView,
  readCommonRingFill,
  resolveCommonRingPlate,
  zoomAstrolabeAt,
  zoomLayout,
  astrolabeZoomDetail,
  astrolabeZoomMetrics,
  starPointerMetrics,
  starPointerInView,
  strokeVisibleCircle,
  traceDiscInBox,
  traceVisiblePolyline,
  viewRect,
  type ViewRect,
  type AstrolabeHoverTarget,
  type AstrolabeReteSurface,
  type AstrolabeZoom,
  type Layout,
} from "@/components/workshell/astrolabe-canvas";
import {
  executeWorkspaceContextMenuAction,
  fetchAstrolabe,
  fetchAstrolabeEarth,
  fetchHouseSystemMenu,
  fetchAstrolabeViewState,
  fetchOptions,
  storeAstrolabeViewState,
  type AstrolabeCircle,
  type AstrolabeCamera,
  type AstrolabeGeometry,
  type AstrolabeProjection,
  type AstrolabeZodiacDivision,
  type PolarAzimuthalEarth,
  type PolarAzimuthalGeometry,
  type AstrolabeLine,
  type AstrolabeStarField,
  type AstrolabeStarLabels,
  type AstrolabeViewState,
  type OptionsFixedStars,
  type ThemeState,
  type WorkspaceContextMenuNode,
} from "@/lib/daemon/client";
import { usePosterExportStore, type PreparedPosterPlate } from "@/stores/poster-export-store";
import { loadAstrolabeCityPictures } from "./astrolabe-city";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { useThemeStore } from "@/stores/theme-store";
import { Minus, Plus } from "lucide-react";
import { useLocale, useT, useTFallback } from "@/lib/i18n/i18n";
import { usesAppleShortcuts } from "@/lib/shortcut-display";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import { useWorkspaceStore, type HoverRegion } from "@/stores/workspace-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { ChartHoverFlag, type FlagAnchor } from "./chart-hover-flag";
import { createResolvedSemanticChartColorResolver } from "@/lib/theme/semantic-color";
import { paintAstrolabeCity, tokenRgb, type AstrolabeCityLayer, type CityPicture } from "./astrolabe-city";
import { astrolabeSkyLayer, prepareAstrolabeSky, type AstrolabeSkyLive, type AstrolabeSkyTune } from "./astrolabe-sky";
import { AstrolabeSkyTuner, readSkyTune, writeSkyTune } from "./astrolabe-sky-tuner";

// ---------------------------------------------------------------------------
// Planispheric astrolabe — the daemon-owned view-only surface (launcherKind
// "astrolabe"). Faithful to the desktop AstrolabeChart (astrolabechart.py).
//
// DEFAULT = atmospheric view: a filled plate with a sun-altitude-driven sky
// (above horizon) and darkened ground (below), the eccentric ecliptic + sign
// glyphs, projected body spheres (filled above / hollow below the horizon),
// the Equator/Horizon/Ecliptic text labels, the Arc/Age info label and the
// PD-exact overlay. Schematic view is the non-default alternate (no sky fill).
//
// Four OPTIONAL plate-lattice layers (almucantars, azimuth arcs, unequal-hour
// lines, bright-star pointers) are OFF by default; they are explicit webapp-only
// features driven LIVE from the daemon projection (proj.almucantar /
// proj.azimuth_arc), never part of the desktop default surface.
//
// PARADIGM: the daemon (astrolabe_service via astrolabe_projection) owns ALL
// projection geometry AND the engine reads (sky colour, per-sign colour, PD
// list, info-label strings). This view only maps the normalized R_eq=1
// projection space to canvas pixels and draws. The rete arc steps forward only
// and SNAPS to real primary-direction events (geo.pd.snapArcs); nothing
// astrological is computed in TypeScript.
// Oracle: astrolabechart.py drawChart / _draw_atmospheric / _draw_* .
// ---------------------------------------------------------------------------

type LayerToggles = {
  atmospheric: boolean;
  regioHouses: boolean; // persisted key for the active system's house lines
  zodiacWheel: boolean;
  terms: boolean;
  decans: boolean;
  almucantars: boolean;
  azimuths: boolean;
  hourLines: boolean;
  gridTenDegrees: boolean;
  stars: boolean;
  asterisms: boolean;
  earthMap: boolean;
  declinationCircles: boolean;
  fullSphere: boolean;
  zodiacalHorizon: boolean;
  zodiacalMeridian: boolean;
  pdReprojection: boolean;
  earthInFront: boolean;
  horizonLine: boolean;
  meridianLine: boolean;
  equatorLine: boolean;
};

const DEFAULT_TOGGLES: LayerToggles = {
  atmospheric: true, // desktop default (astrolabe_atmospheric=True, morin.py:19259)
  regioHouses: true,
  zodiacWheel: true,
  terms: true, // active term set: rete ring / faint polar marks
  decans: false, // active decan set, inside the term ring
  almucantars: false, // every 5° in the sky, as engraved on a plate — OFF by default
  azimuths: false, // every 5° in the sky, as engraved on a plate — OFF by default
  hourLines: false, // unequal hours 1–12 of the day and the night — OFF by default
  gridTenDegrees: false, // almucantars and azimuths every 10° instead of 5°
  stars: true, // star pointers, the whole catalogue by default
  asterisms: false,
  earthMap: true, // polar plate: the world beneath its zenith points
  declinationCircles: false, // polar plate: each body's parallel
  fullSphere: false, // polar plate: fitted to horizon + objects, not the south pole
  zodiacalHorizon: true, // polar plate: where zodiacal degrees reach Asc/Dsc
  zodiacalMeridian: false, // polar plate: where zodiacal degrees reach MC/IC
  pdReprojection: false, // PD diamonds, loci, significators, arcs and focus: off until tuned
  earthInFront: false, // both plates: the ground drawn over the rete, at earthOpacity
  horizonLine: true, // both plates: the horizon circle and its label
  meridianLine: true, // both plates: the meridian (polar: with the six-o'clock line)
  equatorLine: true, // both plates: the equator and its label
};
/** The plate layers a stored view state shows (defaults for absent keys). */
function layerTogglesFromViewState(state: AstrolabeViewState): LayerToggles {
  return {
    atmospheric: state.atmospheric,
    regioHouses: state.regioHouses,
    zodiacWheel: state.zodiacWheel,
    terms: state.terms ?? DEFAULT_TOGGLES.terms,
    decans: state.decans ?? DEFAULT_TOGGLES.decans,
    almucantars: state.almucantars,
    azimuths: state.azimuths,
    hourLines: state.hourLines,
    gridTenDegrees: state.gridTenDegrees ?? DEFAULT_TOGGLES.gridTenDegrees,
    stars: state.stars,
    asterisms: state.asterisms ?? DEFAULT_TOGGLES.asterisms,
    earthMap: state.earthMap,
    declinationCircles: state.declinationCircles,
    fullSphere: state.fullSphere,
    zodiacalHorizon: state.zodiacalHorizon,
    zodiacalMeridian: state.zodiacalMeridian,
    pdReprojection: state.pdReprojection ?? DEFAULT_TOGGLES.pdReprojection,
    earthInFront: state.earthInFront ?? DEFAULT_TOGGLES.earthInFront,
    horizonLine: state.horizonLine ?? DEFAULT_TOGGLES.horizonLine,
    meridianLine: state.meridianLine ?? DEFAULT_TOGGLES.meridianLine,
    equatorLine: state.equatorLine ?? DEFAULT_TOGGLES.equatorLine,
  };
}
/** Solid earth; the menu's lighter choices let the plate show through. */
const DEFAULT_EARTH_OPACITY = 1;
const EARTH_OPACITIES = [1, 0.8, 0.6, 0.4] as const;

type StarPick = { field: AstrolabeStarField; labels: AstrolabeStarLabels; marked: string[] };

const DEFAULT_STAR_PICK: StarPick = { field: "catalogue", labels: "settings", marked: [] };

const DEFAULT_VIEW_STATE: AstrolabeViewState = {
  deltaDeg: 0,
  ...DEFAULT_TOGGLES,
  earthOpacity: DEFAULT_EARTH_OPACITY,
  projection: "stereographic",
  eclipticStyle: "scale",
  starField: DEFAULT_STAR_PICK.field,
  starLabels: DEFAULT_STAR_PICK.labels,
  markedStars: DEFAULT_STAR_PICK.marked,
};

function astrolabeTitlebarTopBoundary(hostRect: DOMRect): number {
  const titlebar = document.querySelector<HTMLElement>(
    "[data-aries-titlebar-backplate]",
  );
  if (!titlebar) return 0;
  const titlebarRect = titlebar.getBoundingClientRect();
  if (
    titlebarRect.width <= 0
    || titlebarRect.height <= 0
    || titlebarRect.left >= hostRect.right
    || titlebarRect.right <= hostRect.left
    || titlebarRect.bottom <= hostRect.top
    || titlebarRect.top >= hostRect.bottom
  ) {
    return 0;
  }
  return Math.min(
    hostRect.height,
    Math.max(0, titlebarRect.bottom - hostRect.top),
  );
}

function drawCircle(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  c: AstrolabeCircle,
  color: string,
  width: number,
  dash?: number[],
) {
  const [sx, sy] = mapPoint(layout, c.cx, c.cy);
  const r = c.r * layout.scale;
  // Near-straight circles (an equatorial plate's horizon) are traced exactly.
  if (!Number.isFinite(r) || r <= 0) return;
  strokeVisibleCircle(draw.ctx, sx, sy, r, view, color, width, dash);
}

/** The plate's engraved almucantars and azimuths, in the sky only: circles
 * clipped to the horizon disk. The daemon ships the 5° division; the 10°
 * choice keeps every second circle. Azimuths that do not run on to the zenith
 * stop at the last almucantar below it (85° or 80°). */
function drawPlateGrid(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  geo: AstrolabeGeometry,
  colors: { almucantar: string; azimuth: string },
  width: number,
  show: { almucantars: boolean; azimuths: boolean; gridTenDegrees?: boolean },
) {
  const grid = geo.tympan;
  const ten = Boolean(show.gridTenDegrees);
  const almucantars = ten ? grid.almucantars.filter((circle) => circle.alt % 10 === 0) : grid.almucantars;
  const azimuths = ten ? grid.azimuths.filter((circle) => circle.az % 10 === 0) : grid.azimuths;
  const toZenith = (az: number, flag?: boolean) => (ten ? az % 30 === 0 : Boolean(flag));
  const azimuthStop = ten ? grid.almucantars.find((circle) => circle.alt === 80) : grid.azimuthStop;
  const ctx = draw.ctx;
  ctx.save();
  const [capx, capy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  ctx.beginPath();
  ctx.arc(capx, capy, geo.radii.capricorn * layout.scale, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  traceStereographicHorizon(ctx, layout, geo);
  ctx.clip();
  if (show.almucantars) {
    for (const circle of almucantars) drawCircle(draw, layout, view, circle, colors.almucantar, width);
  }
  if (!show.azimuths) {
    ctx.restore();
    return;
  }
  for (const circle of azimuths) {
    if (toZenith(circle.az, circle.toZenith)) drawCircle(draw, layout, view, circle, colors.azimuth, width);
  }
  if (azimuthStop) {
    const [sx, sy] = mapPoint(layout, azimuthStop.cx, azimuthStop.cy);
    ctx.beginPath();
    ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    traceDiscInBox(ctx, sx, sy, azimuthStop.r * layout.scale, view);
    ctx.clip("evenodd");
  }
  for (const circle of azimuths) {
    if (!toZenith(circle.az, circle.toZenith)) drawCircle(draw, layout, view, circle, colors.azimuth, width);
  }
  ctx.restore();
}

/** Unequal hour lines of the day and the night, tropic to tropic. */
function drawUnequalHours(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  geo: AstrolabeGeometry,
  color: string,
  width: number,
) {
  for (const line of geo.tympan.hourLines) {
    // Older captured payloads carry the former circle family: nothing to trace.
    for (const path of line.paths ?? []) {
      strokeVisibleLine(draw, view, path.map(({ x, y }) => mapPoint(layout, x, y)), color, width);
    }
  }
}

/** Stroke the on-screen part of a polyline (dashes are paid per visible px). */
function strokeVisibleLine(
  draw: CanvasDraw,
  view: ViewRect,
  points: Array<[number, number]>,
  color: string,
  width: number,
  dash?: readonly number[],
  opacity?: number,
) {
  const ctx = draw.ctx;
  ctx.save();
  if (opacity != null) ctx.globalAlpha = opacity;
  ctx.beginPath();
  traceVisiblePolyline(ctx, points, view);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.25, width);
  if (dash?.some((value) => value > 0)) ctx.setLineDash([...dash]);
  ctx.stroke();
  ctx.restore();
}

function drawLine(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  ln: AstrolabeLine,
  color: string,
  width: number,
  dash?: number[],
) {
  strokeVisibleLine(draw, view, [mapPoint(layout, ln.x1, ln.y1), mapPoint(layout, ln.x2, ln.y2)], color, width, dash);
}

/** Atmospheric plate fill: the daemon's flat sky fills the intersection of
 * the horizon circle and the Capricorn disk (the visible sky) and its ground
 * the rest; the two fills never overlap, so the translucent sky is never
 * stacked on the ground and darkened by it. The physical sky
 * (astrolabe-sky.ts) is laid over both as dithered grit; true when it was
 * drawn (not without WebGL2, or for a payload without the Sun's azimuth).
 * The daemon owns the projected horizon, the Sun and the flat
 * sun-altitude colour ramp; the renderer preserves those atmospheric colours
 * instead of theme-tokenizing physical daylight. */
function drawAtmosphericPlate(
  draw: CanvasDraw,
  layout: Layout,
  geo: AstrolabeGeometry,
  style: AstrolabeRenderStyle,
  paintSky?: (ctx: CanvasRenderingContext2D) => boolean,
): boolean {
  const ctx = draw.ctx;
  const [cx, cy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  const rCap = geo.radii.capricorn * layout.scale;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rCap, 0, Math.PI * 2);
  ctx.clip();
  ctx.save();
  ctx.globalAlpha = style.effects.atmosphericFillOpacity;

  // Ground = the daemon's darkened sky, the disk outside the horizon.
  ctx.beginPath();
  ctx.arc(cx, cy, rCap, 0, Math.PI * 2);
  traceStereographicHorizon(ctx, layout, geo);
  ctx.fillStyle = geo.atmospheric.ground;
  ctx.fill("evenodd");

  // Sky = intersection of the horizon disk and the plate. The plate is cut
  // for the visible pole, so the sky is always inside the horizon circle.
  ctx.beginPath();
  traceStereographicHorizon(ctx, layout, geo);
  ctx.fillStyle = geo.atmospheric.sky;
  ctx.fill();
  ctx.restore();
  const physical = paintSky?.(ctx) ?? false;
  ctx.restore();
  return physical;
}

/** Add the horizon disk (the sky) within the plate to the current path, exact
 * also for the near-straight horizon of a near-equatorial plate. */
function traceStereographicHorizon(ctx: CanvasRenderingContext2D, layout: Layout, geo: AstrolabeGeometry) {
  const [hcx, hcy] = mapPoint(layout, geo.tympan.horizon.cx, geo.tympan.horizon.cy);
  const [cx, cy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  const edge = geo.radii.capricorn * layout.scale + 2;
  traceDiscInBox(ctx, hcx, hcy, geo.tympan.horizon.r * layout.scale,
    { x0: cx - edge, y0: cy - edge, x1: cx + edge, y1: cy + edge });
}

export function renderStereographicAstrolabe(
  canvas: HTMLCanvasElement,
  geo: AstrolabeGeometry,
  toggles: Omit<LayerToggles, "earthInFront" | "horizonLine" | "meridianLine" | "equatorLine" | "gridTenDegrees"> & {
    gridTenDegrees?: boolean;
    starLabels?: StarLabelMode; pdFocus?: string | null; city?: AstrolabeCityLayer; observers?: AstrolabeCityLayer;
    earthInFront?: boolean; horizonLine?: boolean; meridianLine?: boolean; equatorLine?: boolean; earthOpacity?: number; eclipticStyle?: AstrolabeEclipticStyle;
    skyTune?: AstrolabeSkyTune | null; skyLive?: AstrolabeSkyLive;
  },
  cssW: number,
  cssH: number,
  style: AstrolabeRenderStyle,
  t: ReturnType<typeof useT>,
  ringFill: number,
  paintTopBoundary = 0,
  dpr?: number,
  zoom: AstrolabeZoom = ASTROLABE_ZOOM_IDENTITY,
  reteSurface?: AstrolabeReteSurface,
): AstrolabeHoverTarget[] | null {
  const hoverTargets: AstrolabeHoverTarget[] = [];
  const resolveColor = createResolvedSemanticChartColorResolver();
  const draw = new CanvasDraw(canvas);
  draw.setDefaultFont(style.typography.fontUi);
  const kept = [canvas.width, canvas.height];
  draw.resize(cssW, cssH, dpr);
  // A resized canvas has lost its frame: this one cannot wait for its sky.
  const skyLive = canvas.width === kept[0] && canvas.height === kept[1]
    ? toggles.skyLive
    : toggles.skyLive && { repaint: toggles.skyLive.repaint };
  const colors = style.palette;
  const dashes = style.strokes.dashes;

  // The limb (outermost engraved ring) sits on Aries' common chart ring, the
  // single Anglo wheel's outer zodiac ring; the plate scales as a whole.
  // Painted envelope: the cardinal letters beyond the limb.
  const capFill = style.layout.capricornFill;
  const plate = resolveCommonRingPlate(cssW, cssH, {
    ringFill,
    limbFill: capFill + style.layout.tickStepScale * 3,
    paintFill: capFill + style.layout.tickStepScale * 3
      + capFill * (style.layout.cardinalPadScale + 0.5 / style.typography.cardinalFontDivisor),
    marginFill: style.layout.tickStepScale * 2,
    topBoundary: paintTopBoundary,
  });
  if (!plate) {
    draw.fillBackground(style.palette.background);
    return hoverTargets;
  }
  const size = plate.maxRadiusPx * 2;

  // Fit the Capricorn disk (the outer plate boundary) into the viewport with
  // NCP at the centre (atmospheric layout — astrolabechart.py:142-153).
  // wx sizes so r_capricorn = CAPRICORN_FILL * maxradius, maxradius = min(w,h)/2
  // (astrolabechart.py:62,135,144-147). chartRpx / maxRadiusPx are the SAME two
  // bases every wx font/sphere/band divisor is taken from — keep them, do NOT
  // re-key proportions to `size` (that inflates everything ~2x).
  const rCap = geo.radii.capricorn || 1.5;
  // Zoom scales the plate geometry; type and markers use the fitted plate
  // as their base size, with separate growth for close-up detail.
  const fittedRadiusPx = size / 2; // wx self.maxradius
  const typeRpx = style.layout.capricornFill * fittedRadiusPx; // wx self._chart_r (= r_capricorn, px)
  const maxRadiusPx = fittedRadiusPx * zoom.k;
  const chartRpx = typeRpx * zoom.k;
  const layout = zoomLayout({ cx: cssW / 2, cy: plate.centerY, scale: typeRpx / rCap }, zoom);
  const scale = layout.scale;
  // The physical sky first: while the GPU makes a new Sun's picture the canvas
  // keeps its previous frame, untouched (astrolabe-sky.ts).
  const skyLayer = toggles.atmospheric ? astrolabeSkyLayer(geo.atmospheric, toggles.skyTune) : null;
  const sky = skyLayer && prepareAstrolabeSky(draw.ctx, layout, geo.projection, {
    ...geo, lat: geo.plateLat ?? geo.lat, pole: geo.pole === "south" ? -1 : 1,
  }, rCap, typeRpx, skyLayer, skyLive);
  if (sky === "wait") return null;
  draw.fillBackground(style.palette.background);
  if (reteSurface) reteSurface.center = [layout.cx, layout.cy];
  const zoomed = zoom.k > 1;
  const view = viewRect(cssW, cssH);
  const zoomStyle = style.zoom;
  const zoomMetrics = astrolabeZoomMetrics(zoom.k, style);
  const inkRamp = zoomRamp(zoom.k, zoomStyle.rampStart, zoomStyle.rampEnd);
  const contactOrb = geo.contactOrbDeg ?? 0;
  const liveContacts: LiveContact[] = (geo.contacts ?? []).flatMap((contact) => {
    const strength = contactOrb > 0 ? Math.max(0, 1 - Math.abs(contact.arcToExact) / contactOrb) : 0;
    return strength > 0 ? [{ contact, strength, anchor: contactAnchor(geo, contact) }] : [];
  });

  const { fine: w1, medium: w2, main: wMain } = resolveAstrolabeStrokeWidths(style, size);
  const schematicDash = <T extends readonly number[]>(dash: T): number[] | undefined => (
    toggles.atmospheric ? undefined : [...dash]
  );

  // === ATMOSPHERIC PLATE FILL (default) ===
  const paintSky = sky && ((ctx: CanvasRenderingContext2D) => sky.paint(ctx));
  const physicalSky = toggles.atmospheric && drawAtmosphericPlate(draw, layout, geo, style, paintSky ?? undefined);
  // Design-tuner city on the plate's earth, under the lattice and rete. A
  // solid earth in front repaints it there; a lighter one is laid over this
  // same earth, so only what lies between the two fades, never the earth.
  const city = toggles.city;
  const paintCity = city && ((ctx: CanvasRenderingContext2D) => (
    paintAstrolabeCity(ctx, layout, geo.projection, {
      ...geo, lat: geo.plateLat ?? geo.lat, pole: geo.pole === "south" ? -1 : 1,
    }, rCap, typeRpx, city)));
  const eraseCityHoles = city && ((ctx: CanvasRenderingContext2D) => (
    paintAstrolabeCity(ctx, layout, geo.projection, {
      ...geo, lat: geo.plateLat ?? geo.lat, pole: geo.pole === "south" ? -1 : 1,
    }, rCap, typeRpx, city, "holes")));
  const earthOpacity = toggles.earthOpacity ?? DEFAULT_EARTH_OPACITY;
  // Almucantars, azimuths and unequal hours are engraved on the plate itself:
  // they show wherever no picture covers the plate, a background picture is
  // drawn over them, and they recede as the house-line ink strengthens with zoom.
  if (toggles.almucantars || toggles.azimuths || toggles.hourLines) {
    draw.ctx.save();
    draw.ctx.globalAlpha = 1 - zoomStyle.latticeFade * inkRamp;
    if (toggles.almucantars || toggles.azimuths) drawPlateGrid(draw, layout, view, geo, colors, w1, toggles);
    if (toggles.hourLines) drawUnequalHours(draw, layout, view, geo, colors.hour, w1);
    draw.ctx.restore();
  }
  if (paintCity && !(toggles.earthInFront && earthOpacity >= 1)) paintCity(draw.ctx);

  // Clip everything to the Capricorn disk so projected circles do not overflow.
  draw.ctx.save();
  draw.ctx.beginPath();
  const [capx, capy] = mapPoint(layout, geo.tympan.tropicCapricorn.cx, geo.tympan.tropicCapricorn.cy);
  draw.ctx.arc(capx, capy, rCap * scale, 0, Math.PI * 2);
  draw.ctx.clip();

  if (toggles.asterisms) drawAsterisms(draw, layout, view, geo.asterisms, style, size, zoom.k, hoverTargets);

  // === TYMPAN (fixed plate) ===
  const showHorizon = toggles.horizonLine !== false;
  // The equator toggle carries the Tropic of Cancer; Capricorn is the plate's rim.
  const showEquator = toggles.equatorLine !== false;
  if (showEquator) {
    drawCircle(draw, layout, view, geo.tympan.tropicCancer, colors.tropic, w1, schematicDash(dashes.tropic));
    drawCircle(draw, layout, view, geo.tympan.equator, colors.equator, w1, schematicDash(dashes.equator));
  }

  // The selected system's own spatial/time boundaries, projected by the daemon.
  if (toggles.regioHouses) {
    for (const line of geo.tympan.houseLines) {
      for (const path of line.paths) {
        const [first, second, ...rest] = path;
        if (!first || !second) continue;
        strokeVisibleLine(draw, view, [
          mapPoint(layout, first.x, first.y),
          mapPoint(layout, second.x, second.y),
          ...rest.map(({ x, y }) => mapPoint(layout, x, y)),
        ], colors.regio, w1, schematicDash(dashes.regio));
        if (inkRamp > 0) strokeVisibleLine(draw, view,
          path.map(({ x, y }) => mapPoint(layout, x, y)),
          colors.regioZoomed, w1, schematicDash(dashes.regio), inkRamp);
      }
    }
  }

  // Meridian through the NCP.
  if (toggles.meridianLine !== false) {
    drawLine(draw, layout, view, geo.tympan.meridian, colors.meridian, w1, schematicDash(dashes.meridian));
  }

  // Horizon — the prominent blue circle (with the earth in front, it is
  // drawn once, over that earth).
  const earthInFront = Boolean(toggles.earthInFront);
  if (!earthInFront && showHorizon) drawCircle(draw, layout, view, geo.tympan.horizon, colors.horizon, wMain);

  for (const live of liveContacts) {
    if (live.anchor) paintContactCue(draw.ctx, layout, live.anchor, live.strength, colors.contact, w2, zoomStyle.contact);
  }

  // === RETE (rotating: ecliptic + sign ticks / zodiac band + stars) ===
  const ecl = geo.rete.ecliptic;
  // With the zodiac ring off, the chosen ecliptic style (scale or divided band)
  // is engraved in place of the bare drawn circle; the zodiac ring keeps its band.
  const engraving = toggles.zodiacWheel ? null : eclipticEngraving(toggles.eclipticStyle, style.layout);
  if (!engraving) drawCircle(draw, layout, view, ecl, colors.ecliptic, w2);
  const [eclScrX, eclScrY] = mapPoint(layout, ecl.cx, ecl.cy);

  // Graduated zodiac band — 1/5/10/30° radial ticks from the ecliptic inward,
  // toward the band's inner radius (astrolabechart._draw_zodiac_wheel_band,
  // astrolabechart.py:613-680).
  // Band width / tick step are fractions of maxradius in wx (ZODIAC_SECTOR_LEN /
  // ZODIAC_TICK_LEN, astrolabechart.py:105-106,621-622), NOT of the ecliptic radius.
  // Term and decan rings are housed inside the band: the signs keep its outer
  // share, the term ring follows, the decan ring is innermost. They are their
  // own layers: with the zodiac off they keep these positions and only the
  // band frame goes, the bare ecliptic keeping short graduations.
  const divisions = geo.zodiacDivisions;
  const termRing = toggles.terms && Boolean(divisions?.terms.length);
  const decanRing = toggles.decans && Boolean(divisions?.decans.length);
  const fullBand = maxRadiusPx * style.layout.bandWidthScale;
  const bandWidth = termRing || decanRing ? fullBand * style.layout.divisionSignShare : fullBand;
  const tickStep = maxRadiusPx * style.layout.tickStepScale;
  const outerR = ecl.r * scale;
  // Zodiac ring off: a scale or divided band replaces the bare graduations; the small
  // sign glyphs follow it after a gap and the rings keep their places.
  const engravingGap = Math.max(2, tickStep * 0.6);
  const engravingDepth = engraving ? eclipticEngravingDepth(engraving, tickStep) : 0;
  const innerR = Math.max(style.layout.innerRadiusMin, outerR - bandWidth);
  const termInnerR = Math.max(style.layout.innerRadiusMin,
    innerR - (termRing ? maxRadiusPx * style.layout.termBandScale : 0));
  const reteInnerR = Math.max(style.layout.innerRadiusMin,
    termInnerR - (decanRing ? maxRadiusPx * style.layout.decanBandScale : 0));
  const r5 = Math.max(innerR, outerR - tickStep * 2);
  const r10 = Math.max(innerR, outerR - tickStep * 3);
  const r1 = Math.max(innerR, outerR - tickStep);
  const bare = !toggles.zodiacWheel;
  const bareTick = tickStep * style.layout.bareEclipticTickScale;
  const { size: numberSize, opacity: numberOpacity } = astrolabeZoomDetail(zoom.k);
  const baseSignSize = typeRpx / style.typography.signFontDivisor * (bare ? style.layout.bareSignGlyphScale : 1);
  // Keep signs at least as large as the close-up numbers once they appear.
  const signGlyphSize = Math.max(baseSignSize, numberSize * zoomRamp(zoom.k, 1, 2));
  const bareGlyphR = outerR - (engraving ? engravingDepth + engravingGap : bareTick * 4) - signGlyphSize * 0.7;
  if (reteSurface) {
    reteSurface.band = { x: eclScrX, y: eclScrY,
      inner: termRing || decanRing ? reteInnerR : bare ? outerR - (engraving ? engravingDepth : bareTick) : innerR,
      outer: outerR, padding: 20 };
    const raOuterLine = chartRpx + tickStep * 3;
    reteSurface.rings.push({ x: layout.cx, y: layout.cy, inner: raOuterLine - 40, outer: raOuterLine + 40, padding: 0 });
  }
  // Innermost engraving on the rete, for the MC/IC labels and the angle lines.
  const reteContentR = !bare || termRing || decanRing ? reteInnerR : bareGlyphR - signGlyphSize * 0.6;
  {
    // Keep CanvasDraw's pixel snapping while bounding the zoomed ring path.
    const ringOutline = (radius: number, color: string) => strokeVisibleCircle(draw.ctx,
      Math.round(eclScrX), Math.round(eclScrY), Math.round(radius), view, color, w1);
    if (!bare) ringOutline(innerR, colors.ecliptic);
    else if (termRing || decanRing) ringOutline(innerR, colors.termRing);
    if (engraving) {
      const samples = [...geo.zodiacBand.ticks].sort((a, b) => a.deg - b.deg).map((tick): EclipticSample => {
        const [x, y] = mapPoint(layout, tick.x, tick.y);
        const d = Math.hypot(eclScrX - x, eclScrY - y) || 1;
        return { x, y, nx: (eclScrX - x) / d, ny: (eclScrY - y) / d };
      });
      engraveEcliptic(draw.ctx, samples, engraving, tickStep, { fine: w1, medium: w2 }, colors.ecliptic,
        { from: 0, to: engravingDepth + tickStep * (engraving.kind === "scale" ? 0.5 : 0.8) });
    }
    for (const t of engraving ? [] : geo.zodiacBand.ticks) {
      const [tx, ty] = mapPoint(layout, t.x, t.y);
      let dx = tx - eclScrX;
      let dy = ty - eclScrY;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      dx /= d;
      dy /= d;
      const target = bare
        ? outerR - bareTick * (t.level === 30 ? 4 : t.level === 10 ? 3 : t.level === 5 ? 2 : 1)
        : t.level === 30 ? reteInnerR : t.level === 10 ? r10 : t.level === 5 ? r5 : r1;
      const ww = t.level === 30 ? w2 : w1;
      drawVisibleRulerTick(draw, view, [tx, ty],
        [eclScrX + dx * target, eclScrY + dy * target], colors.ecliptic, ww);
    }
    // Closed boxes as on the chart wheel: the ring's inner edge, a boundary at
    // each division and its ruler glyph fitted to the box, growing with zoom.
    const ring = (
      entries: AstrolabeZodiacDivision[], ringOuter: number, ringInner: number, boundaryColor: string, kind: "term" | "decan",
    ) => {
      draw.circle([eclScrX, eclScrY], ringInner, { outline: colors.termRing, width: w1 });
      const glyphR = (ringOuter + ringInner) / 2;
      const boxGlyph = (ringOuter - ringInner) * style.layout.divisionGlyphScale;
      for (const entry of entries) {
        const [bx, by] = mapPoint(layout, entry.boundary.x, entry.boundary.y);
        const bd = Math.hypot(bx - eclScrX, by - eclScrY);
        // Index 0 shares the sign boundary, engraved through every ring while
        // the band shows; the bare ecliptic closes the box itself.
        if ((entry.index > 0 || bare) && bd > 1e-6) {
          const ux = (bx - eclScrX) / bd;
          const uy = (by - eclScrY) / bd;
          draw.line([[eclScrX + ux * ringOuter, eclScrY + uy * ringOuter],
            [eclScrX + ux * ringInner, eclScrY + uy * ringInner]], { fill: boundaryColor, width: w1 });
        }
        const [mx, my] = mapPoint(layout, entry.mid.x, entry.mid.y);
        const md = Math.hypot(mx - eclScrX, my - eclScrY);
        const glyphSize = Math.min(boxGlyph,
          (entry.end - entry.start) * Math.PI / 180 * glyphR * style.layout.divisionGlyphScale);
        if (md < 1e-6 || glyphSize < style.layout.divisionGlyphMin) continue;
        const gx = eclScrX + (mx - eclScrX) / md * glyphR;
        const gy = eclScrY + (my - eclScrY) / md * glyphR;
        if (!pointInView(view, gx, gy, glyphSize)) continue;
        draw.text([gx, gy], entry.glyph, {
          font: style.typography.fontSymbols,
          size: glyphSize,
          fill: divisionGlyphColor(entry, divisions?.inheritPlanetColors, colors.subdivisionGlyph, resolveColor),
          align: "center",
          baseline: "middle",
        });
        hoverTargets.push(divisionHoverTarget(entry, kind, gx, gy, glyphSize,
          t(kind === "term" ? "astrolabe.terms" : "astrolabe.decans")));
      }
    };
    if (termRing && divisions) ring(divisions.terms, innerR, termInnerR, colors.termBoundary, "term");
    if (decanRing && divisions) ring(divisions.decans, termInnerR, reteInnerR, colors.decanBoundary, "decan");
  }

  // Close-up labels mark sign starts and sit inside the
  // engraving, clear of the sign glyphs and the term/decan rings.
  const numberEdge = bare ? Math.min(reteContentR, bareGlyphR - signGlyphSize * 0.6) : reteContentR;
  const numberR = numberEdge - numberSize * 0.85;
  if (numberOpacity > 0 && numberR > 0) {
    for (const tick of geo.zodiacBand.ticks) {
      if (tick.level !== 30) continue;
      const dx = (tick.x - ecl.cx) * scale;
      const dy = (tick.y - ecl.cy) * scale;
      const radius = Math.hypot(dx, dy);
      if (radius < 1e-6) continue;
      const x = eclScrX + dx / radius * numberR;
      const y = eclScrY + dy / radius * numberR;
      if (!pointInView(view, x, y, numberSize)) continue;
      reteSurface?.markers.push({ x, y, size: numberSize });
      draw.text([x, y], "0°", {
        size: numberSize,
        fill: colors.ecliptic,
        align: "center",
        baseline: "middle",
        opacity: numberOpacity,
      });
    }
  }

  // Bright-star pointers (optional) — small dots on the rete.
  if (toggles.stars) {
    const starR = Math.max(style.markers.starRadiusMin, size / style.markers.starRadiusDivisor) * zoomMetrics.star;
    const starLabelSize = (typeRpx / style.typography.circleLabelFontDivisor) * 0.8 * zoomMetrics.starLabel;
    for (const st of geo.rete.stars) {
      const [px, py] = mapPoint(layout, st.x, st.y);
      const label = starLabelShown(toggles.starLabels, st.inSettings) ? st.name : "";
      const metrics = starPointerMetrics(starR * 2.5, st.mag, starLabelSize, style);
      if (!starPointerInView(view, px, py, metrics, label)) continue;
      drawStarPointer(draw, px, py, starR * 2.5, st.mag, label, starLabelSize, style);
      const target = starHoverTarget(st, px, py, metrics.radius);
      hoverTargets.push(target);
      if (label) {
        const labelX = px + metrics.labelOffset;
        const labelWidth = draw.textsize(label, { font: style.typography.fontUi, size: metrics.labelSize })[0];
        hoverTargets.push({ ...target, x: labelX + labelWidth / 2, width: labelWidth, height: metrics.labelSize });
      }
    }
  }
  // Marked stars: always named and larger, independent of the star layer.
  {
    const starR = Math.max(style.markers.starRadiusMin, size / style.markers.starRadiusDivisor) * zoomMetrics.star;
    const markedLabelSize = typeRpx / style.typography.circleLabelFontDivisor * zoomMetrics.starLabel;
    for (const st of geo.rete.markedStars ?? []) {
      const [px, py] = mapPoint(layout, st.x, st.y);
      const metrics = starPointerMetrics(starR * 4, st.mag, markedLabelSize, style, true);
      if (!starPointerInView(view, px, py, metrics, st.name)) continue;
      drawStarPointer(draw, px, py, starR * 4, st.mag, st.name, markedLabelSize, style, true);
      const target = starHoverTarget(st, px, py, metrics.radius);
      hoverTargets.push(target);
      const labelX = px + metrics.labelOffset;
      const labelWidth = draw.textsize(st.name, { font: style.typography.fontUi, size: metrics.labelSize })[0];
      hoverTargets.push({ ...target, x: labelX + labelWidth / 2, width: labelWidth, height: metrics.labelSize });
    }
  }

  draw.ctx.restore(); // end Capricorn clip

  // === SIGN GLYPHS — placed just inside the zodiac band, per-sign colour ===
  const signCull = chartRpx * style.layout.signCullScale; // wx margin (astrolabechart.py:667,676)
  const glyphR = bare ? bareGlyphR : outerR - bandWidth / 2;
  if (reteSurface?.band) {
    const halfHeight = signGlyphSize / 2;
    reteSurface.band.inner = Math.min(reteSurface.band.inner, glyphR - halfHeight);
    reteSurface.band.outer = Math.max(reteSurface.band.outer, glyphR + halfHeight);
  }
  {
    for (const g of geo.zodiacBand.glyphs) {
      const [mx, my] = mapPoint(layout, g.x, g.y);
      const dx = mx - eclScrX;
      const dy = my - eclScrY;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const gx = eclScrX + (dx / d) * glyphR;
      const gy = eclScrY + (dy / d) * glyphR;
      if (Math.hypot(gx - layout.cx, gy - layout.cy) > chartRpx + signCull) continue;
      reteSurface?.markers.push({ x: gx, y: gy, size: signGlyphSize });
      draw.text([gx, gy], g.glyph, {
        font: style.typography.fontSymbols,
        size: signGlyphSize,
        fill: resolveColor(g.colorRole, g.color) ?? g.color,
        align: "center",
        baseline: "middle",
      });
    }
  }

  // === BODIES — sphere at true RA/Dec, dotted connector to ecliptic foot,
  // Morinus glyph label (astrolabechart.py:911-982). ===
  // wx: sphere_r = chart_r/PLANET_SPHERE_DIV(160), fntPlanets = chart_r/PLANET_GLYPH_DIV(16),
  // label_pad = sphere_r + chart_r*PLANET_LABEL_PAD/1000 (astrolabechart.py:65,109-110,178,686,711).
  const bodies = geo.bodies.map((b) => ({
    body: b,
    color: resolveColor(b.colorRole, b.color) ?? b.color,
    hover: {
      name: b.name ?? "",
      position: b.position,
      inspector: b.id === -1
        ? { kind: "fortune" as const, longitude: b.lon }
        : { kind: "planet" as const, seId: b.id },
    },
  }));

  const appearance = useThemeStore.getState().theme?.profileOverrides?.chartData;
  const sphereR = Math.max(
    style.markers.sphereRadiusMin,
    typeRpx / style.markers.sphereRadiusDivisor,
  ) * zoomMetrics.sphere;
  const baseGlyphSize = typeRpx / style.typography.planetFontDivisor;
  markAstrolabePlanetGlyphSize(canvas, baseGlyphSize);
  const glyphSize = baseGlyphSize * zoomMetrics.glyph;
  const labelPad = sphereR + typeRpx * style.layout.bodyLabelPadScale;
  const viewportClearance = Math.max(wMain * 2, glyphSize * 0.45);
  const limbClearance = Math.max(wMain * 2, glyphSize * 0.12);
  const bodyLabelTop = Math.max(paintTopBoundary, 0) + viewportClearance;
  const bodyLabelBottom = Math.max(bodyLabelTop, cssH - viewportClearance);

  const bodyDecoration = (body: { glyph: string; dignity?: string | null; minorDignityCount?: number;
    hasTermDignity?: boolean; hasFaceDignity?: boolean; primaryTriplicityElement?: import("@/lib/chart/types").ZodiacElement | null },
  bounds: { x: number; y: number; w: number; h: number }, color: string) => {
    if (!body.minorDignityCount || !(appearance?.showDignityGlyphs
      || appearance?.showTermGlyphs || appearance?.showFaceGlyphs)) return;
    const ink = draw.textbounds(body.glyph, { font: style.typography.fontSymbols, size: glyphSize });
    return resolveMinorDignityDecoration(body,
      { ...ink, x: Math.round(bounds.x) + ink.x, y: Math.round(bounds.y) + ink.y }, glyphSize,
      { font: style.typography.fontUi,
        dignityColor: resolveColor("--morinus-dignity-domicil", color) ?? color,
        triplicityColor: resolveColor(triplicityColorRole(body.primaryTriplicityElement,
          Boolean(appearance?.useZodiacElementColors)), color) ?? color,
        measure: (text, textSize, font, weight) => {
          const box = draw.textbounds(text, { font, size: textSize, weight, baseline: "alphabetic" });
          return [box.w, box.h];
        } }, appearance ?? {});
  };
  type Item = {
    gx: number; gy: number; sx: number; sy: number; ex: number; ey: number;
    body: AstrolabeGeometry["bodies"][number];
    color: string; tw: number; th: number; glyphW: number; glyphH: number;
    hoverTarget: AstrolabeHoverTarget;
  };
  const clampBodyLabel = (item: Item) => {
    // Zoomed, the canvas edge crops the plate: labels stay beside their
    // bodies instead of piling up along the viewport edge.
    if (!zoomed) {
      const minX = viewportClearance;
      const maxX = Math.max(minX, cssW - viewportClearance - item.tw);
      const minY = bodyLabelTop;
      const maxY = Math.max(minY, bodyLabelBottom - item.th);
      item.gx = Math.min(maxX, Math.max(minX, item.gx));
      item.gy = Math.min(maxY, Math.max(minY, item.gy));
    }

    // Keep the complete glyph rectangle inside the Capricorn plate. The limb
    // now owns the exterior annulus, so collision pushes cannot send labels
    // back through the engraved ruler or into the titlebar above it.
    const labelCx = item.gx + item.tw / 2;
    const labelCy = item.gy + item.th / 2;
    const fromCentreX = labelCx - layout.cx;
    const fromCentreY = labelCy - layout.cy;
    const centreDistance = Math.hypot(fromCentreX, fromCentreY);
    const maxCentreDistance = Math.max(
      0,
      chartRpx - limbClearance - Math.hypot(item.tw, item.th) / 2,
    );
    if (centreDistance > maxCentreDistance && centreDistance > 1e-6) {
      item.gx = layout.cx + fromCentreX / centreDistance * maxCentreDistance - item.tw / 2;
      item.gy = layout.cy + fromCentreY / centreDistance * maxCentreDistance - item.th / 2;
    }
  };
  const items: Item[] = [];
  for (const { body: b, color, hover } of bodies) {
    const [sx, sy] = mapPoint(layout, b.sphere.x, b.sphere.y);
    if (Math.hypot(sx - layout.cx, sy - layout.cy) > rCap * scale * style.layout.bodyCullScale) continue;
    const hoverTarget: AstrolabeHoverTarget = { ...hover, x: sx, y: sy };
    if (b.name) hoverTargets.push(hoverTarget);
    const [ex, ey] = mapPoint(layout, b.ecliptic.x, b.ecliptic.y);
    const [glyphW] = draw.textsize(b.glyph, { font: style.typography.fontSymbols, size: glyphSize });
    const glyphH = glyphSize;
    const decoration = bodyDecoration(b, { x: 0, y: 0, w: glyphW, h: glyphH }, b.color);
    const tw = decoration?.bounds.w ?? glyphW, th = decoration?.bounds.h ?? glyphH;
    const radialDistance = Math.hypot(sx - layout.cx, sy - layout.cy);
    const ux = radialDistance > 1e-6 ? (sx - layout.cx) / radialDistance : 1;
    const uy = radialDistance > 1e-6 ? (sy - layout.cy) / radialDistance : 0;
    const labelDistance = labelPad + Math.max(tw, th) * 0.45;
    const labelHalfDiagonal = Math.hypot(tw, th) / 2;
    const outwardCrossesLimb = (
      radialDistance + labelDistance + labelHalfDiagonal
      > chartRpx - limbClearance
    );
    const labelDirection = outwardCrossesLimb ? -1 : 1;
    let labelCx = sx + ux * labelDistance * labelDirection;
    let labelCy = sy + uy * labelDistance * labelDirection;
    // A body on a lit line moves its glyph off the line, away from its foot.
    const bodyAnchor = strongestContact(liveContacts, b.id, "body")?.anchor;
    if (bodyAnchor) {
      let nx = -bodyAnchor.ty;
      let ny = bodyAnchor.tx;
      if (nx * (ex - sx) + ny * (ey - sy) > 0) {
        nx = -nx;
        ny = -ny;
      }
      labelCx = sx + nx * labelDistance * 1.3;
      labelCy = sy + ny * labelDistance * 1.3;
    }
    const item: Item = {
      gx: labelCx - tw / 2, gy: labelCy - th / 2, sx, sy, ex, ey,
      body: b, color, tw, th, glyphW, glyphH, hoverTarget,
    };
    clampBodyLabel(item);
    items.push(item);
  }
  const pushMargin = items.length ? items[0].th * style.collision.marginScale : 0;
  for (let iter = 0; iter < style.collision.iterations; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const si = items[i];
        const sj = items[j];
        const ox = Math.min(si.gx + si.tw, sj.gx + sj.tw) - Math.max(si.gx, sj.gx);
        const oy = Math.min(si.gy + si.th, sj.gy + sj.th) - Math.max(si.gy, sj.gy);
        if (ox > -pushMargin && oy > -pushMargin) {
          let dy = sj.gy - si.gy;
          if (Math.abs(dy) < style.collision.minDelta) dy = style.collision.tieDelta;
          const push = ((si.th + sj.th) / 2 + pushMargin) * style.collision.pushScale;
          if (dy > 0) {
            si.gy -= push * style.collision.moveScale;
            sj.gy += push * style.collision.moveScale;
          } else {
            si.gy += push * style.collision.moveScale;
            sj.gy -= push * style.collision.moveScale;
          }
          clampBodyLabel(si);
          clampBodyLabel(sj);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Ecliptic-degree foot: a small dot on the ecliptic line at each body's
  // longitude, so a zodiacal contact with a cusp line reads apart from the
  // body's own.
  const notchAlpha = zoomRamp(zoom.k, zoomStyle.notch.rampStart, zoomStyle.notch.rampEnd);
  const notchGrow = zoomGrow(zoom.k, zoomStyle.notch);
  if (notchAlpha > 0) {
    for (const it of items) {
      if (Math.hypot(it.sx - it.ex, it.sy - it.ey) < 0.5) continue;
      const widthScale = strongestContact(liveContacts, it.body.id, "ecliptic")
        ? zoomStyle.contact.notchWidthScale : zoomStyle.notch.widthScale;
      // Unsnapped, so the dot stays centred exactly on the ecliptic.
      const ctx = draw.ctx;
      ctx.save();
      ctx.globalAlpha = notchAlpha;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.arc(it.ex, it.ey, w2 * widthScale * notchGrow, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (const it of items) {
    const b = it.body;
    // Dotted connector from sphere to its zodiacal-degree foot.
    strokeVisibleLine(draw, view, [[it.sx, it.sy], [it.ex, it.ey]], it.color, w1,
      dashes.connector, style.strokes.connectorOpacity);
    // Sphere — filled (above horizon / Sun) or hollow (below horizon).
    const r = b.isSun ? sphereR * style.markers.sunSphereScale : sphereR;
    // Sun and Moon show their true disk once it outgrows the marker.
    const diskPx = (b.diskRadius ?? 0) * scale;
    if (diskPx > zoomStyle.disk.threshold * r) {
      const diskColor = b.isSun ? colors.sunFill : it.color;
      draw.circle([it.sx, it.sy], diskPx, { fill: diskColor, opacity: zoomStyle.disk.fillOpacity });
      draw.circle([it.sx, it.sy], diskPx, {
        outline: diskColor,
        width: w1,
        opacity: zoomStyle.disk.outlineOpacity,
      });
    }
    if (b.isSun) {
      draw.circle([it.sx, it.sy], r, {
        fill: colors.sunFill,
        outline: colors.ecliptic,
        width: style.strokes.sphereOutlineWidth,
      });
    } else if (b.above) {
      draw.circle([it.sx, it.sy], r, {
        fill: it.color,
        outline: it.color,
        width: style.strokes.sphereOutlineWidth,
      });
    } else {
      draw.circle([it.sx, it.sy], r, {
        outline: it.color,
        width: style.strokes.sphereOutlineWidth,
      });
    }
    const outline = bodyDecoration(b, { x: it.gx, y: it.gy, w: it.glyphW, h: it.glyphH }, it.color);
    draw.text([it.gx, it.gy], b.glyph, {
      font: style.typography.fontSymbols,
      size: glyphSize,
      fill: it.color,
      markers: outline?.markers,
      align: "left",
      baseline: "top",
    });
    if (it.hoverTarget.name) hoverTargets.push({ ...it.hoverTarget,
      x: it.gx + it.tw / 2, y: it.gy + it.th / 2, width: it.tw, height: it.th });
  }

  // === ANGLES — Asc/Dsc lines across the rete where the ecliptic meets the
  // horizon, perpendicular to it and drawn exactly like the meridian, so the
  // rising degree, term and decan read along them; MC/IC labels sit inside
  // the ecliptic circle beside the meridian. The daemon supplies the directed
  // angles of the turned rete. ===
  const houseNumberGrow = zoomMetrics.houseNumber;
  const angleBaseSize = typeRpx / style.typography.circleLabelFontDivisor;
  const angleTickHalf = angleBaseSize * zoomStyle.angle.tickScale;
  const angleLabelSize = angleBaseSize * zoomStyle.angle.labelScale * houseNumberGrow;
  // Asc/Dsc lie on the horizon: with the earth in front, they are drawn
  // once, over it.
  const horizonAngles: Array<() => void> = [];
  for (const angle of geo.angles ?? []) {
    const [ax, ay] = mapPoint(layout, angle.x, angle.y);
    const dx = ax - eclScrX;
    const dy = ay - eclScrY;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const ux = dx / d;
    const uy = dy / d;
    const onHorizon = angle.id === "angle:asc" || angle.id === "angle:dsc";
    if (onHorizon) {
      const inner = reteContentR - angleTickHalf;
      const outer = outerR + angleTickHalf;
      const labelR = angleTickHalf + angleLabelSize * 0.8;
      const paint = () => {
        draw.line([
          [eclScrX + ux * inner, eclScrY + uy * inner],
          [eclScrX + ux * outer, eclScrY + uy * outer],
        ], { fill: colors.meridian, width: w1, dash: schematicDash(dashes.meridian), pixelSnap: false });
        draw.text([ax + ux * labelR, ay + uy * labelR],
          angle.label, { size: angleLabelSize, fill: colors.meridian, align: "center", baseline: "middle" });
      };
      if (earthInFront) horizonAngles.push(paint);
      else paint();
    } else {
      // Inside the ecliptic circle, under the zodiac band, beside the meridian.
      const labelR = reteContentR - angleLabelSize * 0.9;
      draw.text([eclScrX + ux * labelR + angleLabelSize * 0.35, eclScrY + uy * labelR],
        angle.label, { size: angleLabelSize, fill: colors.meridian, align: "left", baseline: "middle" });
    }
    hoverTargets.push({ x: ax, y: ay, name: angle.name, position: angle.position });
  }

  // === CIRCLE TEXT LABELS (Equator / Horizon / Ecliptic) ===
  // wx fntLabel = chart_r / LABEL_TEXT_DIV(36) (astrolabechart.py:69,181).
  const labelSize = typeRpx / style.typography.circleLabelFontDivisor;
  type CircleLabel = [string, { x: number; y: number }, string];
  const horizonLabel: CircleLabel = [t("astrolabe.horizon"), geo.circleLabels.horizon, colors.horizon];
  const labels: CircleLabel[] = [
    ...(showEquator ? [[t("astrolabe.equator"), geo.circleLabels.equator, colors.equatorLabel] as CircleLabel] : []),
    ...(showHorizon ? [horizonLabel] : []),
    [t("astrolabe.ecliptic"), geo.circleLabels.ecliptic, colors.ecliptic],
  ];
  const circleLabel = ([txt, anchor, color]: CircleLabel) => {
    const [lx, ly] = mapPoint(layout, anchor.x, anchor.y);
    draw.text([
      lx + style.layout.circleLabelOffsetX,
      ly + style.layout.circleLabelOffsetY,
    ], txt, {
      size: labelSize,
      fill: color,
      align: "left",
      baseline: "top",
    });
  };
  for (const label of labels) if (!earthInFront || label !== horizonLabel) circleLabel(label);

  // Tiny numbers on the fixed plate, with the house lines' own ink strength.
  // Zoomed, they grow and stick to a visible stretch of their own line.
  if (toggles.regioHouses) {
    const houseSize = labelSize * 0.7 * houseNumberGrow;
    const inset = 18;
    const visible = (x: number, y: number) => (
      x >= inset && x <= cssW - inset
      && y >= Math.max(paintTopBoundary, 0) + inset && y <= cssH - inset
      && Math.hypot(x - layout.cx, y - layout.cy) < chartRpx
    );
    const houseInk = (house: number, x: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline) => {
      const options = { size: houseSize, align, baseline };
      draw.text([x, y], String(house), { ...options, fill: colors.regio });
      if (inkRamp > 0) draw.text([x, y], String(house), { ...options, fill: colors.regioZoomed, opacity: inkRamp });
    };
    for (const line of geo.tympan.houseLines) {
      const anchor = astrolabeHouseLabelAnchor(line.paths, rCap);
      if (!anchor) continue;
      const [x, y] = mapPoint(layout, anchor.x, anchor.y);
      if (zoom.k < zoomStyle.rampStart) {
        houseInk(line.house, x + style.layout.circleLabelOffsetX, y + style.layout.circleLabelOffsetY, "left", "top");
        continue;
      }
      const sticky = stickyHouseNumber(
        line.paths.map((path) => path.map(({ x: px, y: py }) => mapPoint(layout, px, py))),
        [eclScrX, eclScrY], outerR + houseSize * 1.6, [x, y], houseSize, visible,
      );
      if (sticky) houseInk(line.house, sticky[0], sticky[1], "center", "middle");
    }
  }

  // === EARTH IN FRONT (optional): the ground and the picture standing on it
  // cover everything below the horizon so far; the horizon, its label and the
  // Asc/Dsc on it stay on top, the limb and cardinals follow. ===
  if (earthInFront) {
    if (reteSurface && earthOpacity >= 1) {
      const [hcx, hcy] = mapPoint(layout, geo.tympan.horizon.cx, geo.tympan.horizon.cy);
      const discR = rCap * scale, horizonR = geo.tympan.horizon.r * layout.scale;
      reteSurface.ground = (x, y) => Math.hypot(x - capx, y - capy) <= discR && Math.hypot(x - hcx, y - hcy) > horizonR;
    }
    paintEarthInFront(draw.ctx, { cx: capx, cy: capy, r: rCap * scale },
      (ctx) => traceStereographicHorizon(ctx, layout, geo),
      {
        background: colors.background,
        ground: toggles.atmospheric ? geo.atmospheric.ground : undefined,
        groundOpacity: style.effects.atmosphericFillOpacity,
        paintGround: physicalSky && paintSky ? (ctx) => void paintSky(ctx) : undefined,
      },
      earthOpacity,
      paintCity,
      eraseCityHoles);
    draw.ctx.save();
    draw.ctx.beginPath();
    draw.ctx.arc(capx, capy, rCap * scale, 0, Math.PI * 2);
    draw.ctx.clip();
    if (showHorizon) drawCircle(draw, layout, view, geo.tympan.horizon, colors.horizon, wMain);
    draw.ctx.restore();
    if (showHorizon) circleLabel(horizonLabel);
    for (const paint of horizonAngles) paint();
  }

  // === CARDINAL LABELS (equator side top, pole side bottom, E left, W right):
  // S at the top of a northern plate, N at the top of a southern one ===
  // wx places these on the CAPRICORN boundary, centred on the NCP — NOT on the
  // horizon circle (whose radius balloons past the plate at mid-latitudes).
  // pad = chart_r*0.06, fntCardinal = chart_r/CARDINAL_DIV(22) (astrolabechart.py:67,182,774-787).
  const ncx = layout.cx;
  const ncy = layout.cy;
  const capPad = typeRpx * style.layout.cardinalPadScale;
  const limbOuterR = chartRpx + tickStep * 3;
  const cardinalSize = typeRpx / style.typography.cardinalFontDivisor;
  const [top, bottom] = geo.pole === "south"
    ? [t("astrolabe.cardinalN"), t("astrolabe.cardinalS")]
    : [t("astrolabe.cardinalS"), t("astrolabe.cardinalN")];
  const cardinals: Array<[string, number, number]> = [
    [top, ncx, ncy - limbOuterR - capPad],
    [bottom, ncx, ncy + limbOuterR + capPad],
    [t("astrolabe.cardinalE"), ncx - limbOuterR - capPad, ncy],
    [t("astrolabe.cardinalW"), ncx + limbOuterR + capPad, ncy],
  ];
  for (const [lbl, x, y] of cardinals) {
    draw.text([x, y], lbl, {
      size: cardinalSize,
      fill: colors.cardinal,
      align: "center",
      baseline: "middle",
    });
  }

  // The mater/limb is the visual frame: a solid boundary, inner rule, and
  // fixed one-degree scale. Schematic mode retains its dotted construction
  // treatment; the default atmospheric presentation reads as engraved metal.
  drawGraduatedLimb(
    draw,
    layout.cx,
    layout.cy,
    chartRpx,
    tickStep,
    colors.capricorn,
    w1,
    w2,
    wMain,
    schematicDash(dashes.capricorn),
  );
  if (toggles.pdReprojection) paintPdReprojection(draw, geo, layout, view, style, sphereR, w1, hoverTargets,
    reteSurface, t, resolveColor, zoom.k, toggles.pdFocus ?? null, glyphSize);
  draw.circle([layout.cx, layout.cy], Math.max(style.markers.sphereRadiusMin, wMain * 1.5), {
    fill: colors.background,
    outline: colors.capricorn,
    width: w1,
  });

  drawReteArcSpan(draw, layout.cx, layout.cy, chartRpx, tickStep, geo.infoLabel.deltaDeg, geo.infoLabel.arc,
    labelSize, colors.meridian, w2);
  if (toggles.observers) paintAstrolabeCity(draw.ctx, layout, geo.projection,
    { ...geo, lat: geo.plateLat ?? geo.lat, pole: geo.pole === "south" ? -1 : 1 }, rCap, typeRpx, toggles.observers);
  return hoverTargets;
}

const render = renderStereographicAstrolabe;

const PDF_EXPORT_SIZE = { width: 900, height: 1200, dpr: 2 } as const;

/** Square astrolabe export composed like a wheel export: the plate fills the
 * frame, the chart corners are painted in and the PNG watermark sits under
 * the top-left block. PDFs reuse the shared raster treatment. */
async function renderAstrolabeExport(
  request: ChartExportRenderRequest,
  geo: AstrolabeGeometry | PolarAzimuthalGeometry,
  paintPlate: (canvas: HTMLCanvasElement, width: number, height: number, dpr: number) => void,
  cornerStyle: (width: number, height: number) => ReturnType<typeof resolveAstrolabeCornerStyle>,
): Promise<ChartExportRenderResult> {
  const png = request.kind === "png";
  if (png) await preparePngWatermark(request.watermarkStyle);
  const width = png ? PNG_EXPORT_PIXEL_SIZE : PDF_EXPORT_SIZE.width;
  const height = png ? PNG_EXPORT_PIXEL_SIZE : PDF_EXPORT_SIZE.height;
  const dpr = png ? 1 : PDF_EXPORT_SIZE.dpr;
  const plate = document.createElement("canvas");
  paintPlate(plate, width, height, dpr);
  const output = document.createElement("canvas");
  const draw = new CanvasDraw(output);
  draw.resize(width, height, dpr);
  draw.ctx.drawImage(plate, 0, 0, width, height);
  const corners = cornerStyle(width, height);
  const watermark = paintAstrolabeCorners(
    draw, geo.information, geo.pd.nearbyEvents, corners, width, height, request.includeOverlays,
  );
  if (!png) return renderCanvasChartExport(output, request);
  if (request.colorMode !== "screen") {
    const image = draw.ctx.getImageData(0, 0, output.width, output.height);
    normalizeCanvasForPrint(image.data, image.width, image.height, request.colorMode === "colored-details");
    draw.ctx.putImageData(image, 0, 0);
  }
  drawPngWatermark(draw.ctx, width, request.watermarkLabel, {
    x: corners.metrics.edgeInset,
    y: watermark.watermarkY,
    size: watermark.watermarkPaint.size * 1.15,
    font: watermark.watermarkPaint.font,
    maxWidth: watermark.watermarkWidth,
    monochrome: request.colorMode === "monochrome",
    style: request.watermarkStyle,
    color: request.colorMode === "screen" ? corners.palette.textBright : "#000000",
  });
  return {
    ...await canvasPngPayload(output, request.output),
    width: output.width,
    height: output.height,
  };
}

export function AstrolabeView({
  inspectorDocumentId,
  inspectorChart,
  sourceName,
  source,
  documentId,
  onKeyboardFocusTarget,
}: {
  inspectorDocumentId: string;
  inspectorChart: ChartRenderSnapshot | null;
  sourceName: string;
  source?: string;
  documentId?: string;
  onKeyboardFocusTarget?: (target: HTMLDivElement | null) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const registerKeyboardFocusTarget = React.useCallback((target: HTMLDivElement | null) => {
    wrapRef.current = target;
    onKeyboardFocusTarget?.(target);
  }, [onKeyboardFocusTarget]);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hoverTargetsRef = React.useRef<AstrolabeHoverTarget[]>([]);
  const reteSurfaceRef = React.useRef<AstrolabeReteSurface>(createAstrolabeReteSurface());
  // Paint closures in creation order, and the newest one that painted: an older
  // frame whose sky arrives late never paints over a newer one.
  const paintSeqRef = React.useRef(0);
  const paintedSeqRef = React.useRef(0);
  const [hover, setHover] = React.useState<AstrolabeHover | null>(null);
  const hoveredTargetRef = React.useRef<AstrolabeHoverTarget | null>(null);
  const hoverTokenRef = React.useRef(0);
  const setHoveredRegion = useWorkspaceStore((state) => state.setHoveredRegion);
  const setInspectorActiveRegion = useWorkspaceStore((state) => state.setInspectorActiveRegion);
  const inspectorOpen = useFrameLayoutStore((state) => state.inspectorOpen);
  const mobileLayout = useMobileLayout();
  const pinOnClick = inspectorOpen || mobileLayout;
  const [geo, setGeo] = React.useState<AstrolabeGeometry | PolarAzimuthalGeometry | null>(null);
  // Wheel-style PD significator focus: session-only view state per document,
  // dropped when the canonical rows no longer name that significator.
  const [pdFocusState, setPdFocusState] = React.useState<{ documentId?: string; key: string } | null>(null);
  const pdFocusKey = pdFocusState && pdFocusState.documentId === documentId ? pdFocusState.key : null;
  const pdFocus = pdFocusKey && geo?.pdReprojection?.significators?.some((item) => item.key === pdFocusKey)
    ? pdFocusKey : null;
  const [earth, setEarth] = React.useState<PolarAzimuthalEarth | null>(null);
  const [projection, setProjection] = React.useState<AstrolabeProjection>(DEFAULT_VIEW_STATE.projection);
  const projectionRef = React.useRef<AstrolabeProjection>(DEFAULT_VIEW_STATE.projection);
  const [starPick, setStarPick] = React.useState<StarPick>(DEFAULT_STAR_PICK);
  const starPickRef = React.useRef<StarPick>(DEFAULT_STAR_PICK);
  const [error, setError] = React.useState<string | null>(null);
  const [delta, setDelta] = React.useState(DEFAULT_VIEW_STATE.deltaDeg);
  const [fontsReadyFor, setFontsReadyFor] = React.useState<string | null>(null);
  const [toggles, setToggles] = React.useState<LayerToggles>(DEFAULT_TOGGLES);
  const [earthOpacity, setEarthOpacity] = React.useState<number>(DEFAULT_EARTH_OPACITY);
  const earthOpacityRef = React.useRef<number>(DEFAULT_EARTH_OPACITY);
  const [eclipticStyle, setEclipticStyle] = React.useState<AstrolabeEclipticStyle>(DEFAULT_VIEW_STATE.eclipticStyle);
  const eclipticStyleRef = React.useRef<AstrolabeEclipticStyle>(DEFAULT_VIEW_STATE.eclipticStyle);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const deltaRef = React.useRef(DEFAULT_VIEW_STATE.deltaDeg);
  const togglesRef = React.useRef<LayerToggles>(DEFAULT_TOGGLES);
  // Local paint is immediate; settled cameras are saved with per-radix state.
  const zoomRef = React.useRef<AstrolabeZoom>(ASTROLABE_ZOOM_IDENTITY);
  const camerasRef = React.useRef<Partial<Record<AstrolabeProjection, AstrolabeCamera>>>({});
  const paintedProjectionRef = React.useRef<AstrolabeProjection>(DEFAULT_VIEW_STATE.projection);
  const cameraEditsRef = React.useRef(new Set<AstrolabeProjection>());
  const zoomWasEditedRef = React.useRef(false);
  const viewEditsRef = React.useRef(new Set<"projection" | "layers" | "stars" | "delta">());
  const viewStateReadyRef = React.useRef(!documentId);
  const [viewStateReady] = React.useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  });
  const pendingPersistRef = React.useRef(false);
  const cameraPersistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomGestureActiveRef = React.useRef(false);
  const dragRef = React.useRef<{ startX: number; startY: number; startDelta: number; center: [number, number];
    lastAngle: number; lastPoint: [number, number]; turn: number; pointerId: number; moved: boolean } | null>(null);
  const dragFrameRef = React.useRef<number | null>(null);
  const panRef = React.useRef<{ startX: number; startY: number; zoom: AstrolabeZoom; pointerId: number; moved: boolean } | null>(null);
  // Repaints the viewport-culled plate at the current zoom on the next frame.
  const requestFrameRef = React.useRef<(() => void) | null>(null);
  // The zoom pill reads the level from this ref-backed store, so wheel zoom
  // repaints the canvas and the readout without re-rendering the view.
  const zoomListenersRef = React.useRef(new Set<() => void>());
  const subscribeZoom = React.useCallback((listener: () => void) => {
    const listeners = zoomListenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const readZoomLevel = React.useCallback(() => zoomRef.current.k, []);
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const styleRevision = useStyleRevision();
  const liveStylePreviewRevision = useChartStyleEditorStore((state) => (
    state.liveAppThemePreview ? `live:${state.revision}` : "live:off"
  ));
  const [starTuneSeq, setStarTuneSeq] = React.useState(0);
  const tunerOpen = useDesignTunerStore((state) => state.open);
  const [observerInitial] = React.useState(readObservers);
  const [observersOn, setObserversOn] = React.useState(observerInitial.enabled);
  const observerPositions = React.useRef<ObserverPosition[]>(observerInitial.positions);
  React.useEffect(() => {
    writeObservers(observersOn, observerPositions.current);
    if (observersOn) void loadObserverHitMask();
  }, [observersOn]);
  const observerFrame = React.useRef<ObserverFrame | null>(null);
  const observerDrag = React.useRef<{ index: number; pointerId: number; offset: ObserverPosition } | null>(null);
  // Read only by pointer handlers, so mirroring after commit is early enough.
  const observersEnabled = React.useRef(false);
  React.useLayoutEffect(() => {
    observersEnabled.current = observersOn;
  }, [observersOn]);
  const [cityTunes, setCityTunes] = React.useState<CityTunes>(() => ({
    stereographic: readCityTune("stereographic"),
    polarEquidistant: readCityTune("polarEquidistant"),
  }));
  // Rides the display toggles so a tuner change repaints like any layer toggle.
  // The stereographic background is a view setting in every build; the polar
  // plate's Monte map stays a design-tuner layer.
  const cityTuned = React.useMemo<CityTunes>(() => (
    DESIGN_TUNERS_ENABLED
      ? cityTunes
      : { ...cityTunes, polarEquidistant: { ...cityTunes.polarEquidistant, mode: "off" } }
  ), [cityTunes]);
  const changeBackground = React.useCallback((next: StereoBackground) => {
    setCityTunes((current) => {
      const tune = current.stereographic;
      const stereographic: CityTune = next === "off"
        ? { ...tune, mode: "off" }
        : { ...tune, picture: next, mode: tune.mode === "off" ? CITY_TUNE_DEFAULTS.stereographic.mode : tune.mode };
      writeCityTune("stereographic", stereographic);
      return { ...current, stereographic };
    });
  }, []);
  // The picture's strength over the ground, the same value the tuner slides.
  const changeBackgroundOpacity = React.useCallback((next: number) => {
    setCityTunes((current) => {
      const stereographic: CityTune = { ...current.stereographic, strength: next };
      writeCityTune("stereographic", stereographic);
      return { ...current, stereographic };
    });
  }, []);
  const [skyTune, setSkyTune] = React.useState<AstrolabeSkyTune>(readSkyTune);
  const skyTuned = DESIGN_TUNERS_ENABLED ? skyTune : null;
  // Persisted design-tuner values apply on open, whether the panel shows.
  React.useLayoutEffect(() => {
    if (DESIGN_TUNERS_ENABLED && applyStarTunerOverrides(wrapRef.current)) {
      setStarTuneSeq((n) => n + 1);
    }
  }, []);
  const paintRevision = `${styleRevision}:${liveStylePreviewRevision}:${starTuneSeq}`;
  const sessionRefreshSeq = useDaemonWorkspaceStore((state) => {
    const change = state.lastSessionChange;
    if (!documentId || !change) return 0;
    return change.docId === documentId || change.docId === inspectorDocumentId
      || change.rebuiltChildIds.includes(documentId)
      ? change.seq
      : 0;
  });
  // The polar plate ships its altitude/azimuth lattice only when shown.
  const polarPlate = projection === "polarEquidistant";
  const lattice = polarPlate && (toggles.almucantars || toggles.azimuths);
  const fullSphere = polarPlate && toggles.fullSphere;
  const asterisms = toggles.asterisms;
  const pdOverlay = toggles.pdReprojection;
  // The star field and marked stars travel with the request; star names are
  // display-only and repaint the retained geometry.
  const starField = starPick.field;
  const markedStars = starPick.marked;
  const geometryRevision = `${sessionRefreshSeq}:${projection}:${lattice ? 1 : 0}:${fullSphere ? 1 : 0}`
    + `:${asterisms ? 1 : 0}:${starField}:${markedStars.join(",")}:${pdOverlay ? 1 : 0}:${pdFocus ?? ""}`;
  const chartTextFont = morinusTextFontFromTokens(theme?.appTokens);
  const chartSymbolFont =
    theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  const chartFontKey = `${chartTextFont}\u0000${chartSymbolFont}`;
  const fontsReady = fontsReadyFor === chartFontKey;

  React.useEffect(() => {
    let cancelled = false;
    void awaitFonts(chartTextFont, chartSymbolFont).then(() => {
      if (!cancelled) setFontsReadyFor(chartFontKey);
    });
    return () => {
      cancelled = true;
    };
  }, [chartFontKey, chartSymbolFont, chartTextFont]);

  const persistViewState = React.useCallback((
    nextToggles: LayerToggles = togglesRef.current,
    nextDelta: number = deltaRef.current,
  ) => {
    if (!documentId) return;
    const snapshot = (layers = togglesRef.current, arc = deltaRef.current): AstrolabeViewState => ({
      cameras: { ...camerasRef.current },
      deltaDeg: arc,
      ...layers,
      earthOpacity: earthOpacityRef.current,
      eclipticStyle: eclipticStyleRef.current,
      projection: projectionRef.current,
      starField: starPickRef.current.field,
      starLabels: starPickRef.current.labels,
      markedStars: starPickRef.current.marked,
    });
    let state: AstrolabeViewState | Promise<AstrolabeViewState>;
    if (!viewStateReadyRef.current) {
      if (pendingPersistRef.current) return;
      pendingPersistRef.current = true;
      state = viewStateReady.promise.then(() => snapshot());
    } else {
      state = snapshot(nextToggles, nextDelta);
    }
    void storeAstrolabeViewState(documentId, state)
      .catch((err) => {
        console.error("[astrolabe-view-state]", err);
      });
  }, [documentId, viewStateReady]);

  // Restore untouched fields only: a quick Tab or zoom must outrank a late
  // initial response. Gestures wait for that merge before saving preferences.
  React.useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    let mounted = true;
    const edited = viewEditsRef.current;
    const editedCameras = cameraEditsRef.current;
    const finish = () => {
      viewStateReadyRef.current = true;
      pendingPersistRef.current = false;
      viewStateReady.resolve();
      if (mounted) requestFrameRef.current?.();
    };
    void fetchAstrolabeViewState(documentId, controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return;
        if (!edited.has("layers")) {
          const nextToggles = layerTogglesFromViewState(state);
          togglesRef.current = nextToggles;
          earthOpacityRef.current = state.earthOpacity ?? DEFAULT_EARTH_OPACITY;
          eclipticStyleRef.current = ASTROLABE_ECLIPTIC_STYLES.includes(state.eclipticStyle)
            ? state.eclipticStyle : DEFAULT_VIEW_STATE.eclipticStyle;
          if (mounted) {
            setToggles(nextToggles);
            setEarthOpacity(earthOpacityRef.current);
            setEclipticStyle(eclipticStyleRef.current);
          }
        }
        if (!edited.has("projection")) {
          projectionRef.current = state.projection;
          if (mounted) setProjection(state.projection);
        }
        if (!edited.has("stars")) {
          const nextStars: StarPick = {
            field: state.starField ?? DEFAULT_STAR_PICK.field,
            labels: state.starLabels ?? DEFAULT_STAR_PICK.labels,
            marked: state.markedStars ?? [],
          };
          starPickRef.current = nextStars;
          if (mounted) setStarPick(nextStars);
        }
        if (!edited.has("delta")) {
          const nextDelta = Math.max(0, state.deltaDeg);
          deltaRef.current = nextDelta;
          if (mounted) setDelta(nextDelta);
        }
        const cameras = { ...state.cameras };
        for (const projection of editedCameras) {
          cameras[projection] = camerasRef.current[projection];
        }
        if (zoomWasEditedRef.current) {
          for (const plate of ["stereographic", "polarEquidistant"] as const) {
            const camera = cameras[plate];
            if (camera) cameras[plate] = { ...camera, k: zoomRef.current.k };
          }
        }
        camerasRef.current = cameras;
        finish();
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        console.error("[astrolabe-view-state]", err);
        finish();
      });
    return () => {
      mounted = false;
      // An early gesture still needs the initial state merged before saving.
      if (!pendingPersistRef.current && !editedCameras.size && !edited.size) {
        controller.abort();
      }
    };
  }, [documentId, viewStateReady]);

  const scheduleCameraPersist = React.useCallback(() => {
    if (cameraPersistTimerRef.current != null) clearTimeout(cameraPersistTimerRef.current);
    cameraPersistTimerRef.current = setTimeout(() => {
      cameraPersistTimerRef.current = null;
      if (panRef.current || zoomGestureActiveRef.current) return;
      persistViewState();
    }, 200);
  }, [persistViewState]);
  const finishCameraGesture = React.useCallback(() => {
    if (cameraPersistTimerRef.current != null) clearTimeout(cameraPersistTimerRef.current);
    cameraPersistTimerRef.current = null;
    persistViewState();
  }, [persistViewState]);
  React.useEffect(() => {
    const editedCameras = cameraEditsRef.current;
    return () => {
      if (cameraPersistTimerRef.current == null && !editedCameras.size) return;
      if (cameraPersistTimerRef.current != null) clearTimeout(cameraPersistTimerRef.current);
      cameraPersistTimerRef.current = null;
      // Switching tabs keeps the document alive and needs this final save;
      // closing a tab (or its parent branch) has already removed its owner.
      if (!useDaemonWorkspaceStore.getState().documents.some((doc) => doc.documentId === documentId)) return;
      persistViewState();
    };
  }, [documentId, persistViewState]);

  // Geometry fetch: one request in flight; completion consumes the latest intent.
  // Drag input is frame-coalesced below, without quantising the requested arc.
  // Aborting/restarting each request would starve paint during continuous input.
  const inflightRef = React.useRef(false);
  const wantDeltaRef = React.useRef(0);
  const wantRevisionRef = React.useRef(geometryRevision);
  const wantQueryRef = React.useRef({
    projection, lattice, fullSphere, asterisms, starField, marked: markedStars, pdOverlay, pdFocus,
  });
  const doneDeltaRef = React.useRef<number | null>(null);
  const doneRevisionRef = React.useRef<string | null>(null);

  const pumpFetch = React.useCallback(() => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    void (async () => {
      try {
        while (
          doneDeltaRef.current !== wantDeltaRef.current ||
          doneRevisionRef.current !== wantRevisionRef.current
        ) {
          const d = wantDeltaRef.current;
          const revision = wantRevisionRef.current;
          const g = await fetchAstrolabe(sourceName, {
            delta: d,
            source,
            documentId,
            ...wantQueryRef.current,
          });
          doneDeltaRef.current = d;
          doneRevisionRef.current = revision;
          if (revision !== wantRevisionRef.current) continue;
          setGeo(g);
          setError(null);
        }
      } catch (err) {
        console.error("[astrolabe]", err);
        setError(String((err as Error).message ?? err));
      } finally {
        inflightRef.current = false;
      }
    })();
  }, [sourceName, source, documentId]);

  // New source → invalidate the fetched-arc cache so the next pump refetches
  // even if the arc value is unchanged (mutating a ref, not setState).
  React.useEffect(() => {
    doneDeltaRef.current = null;
    doneRevisionRef.current = null;
  }, [sourceName, source, documentId]);

  // Arc or session changed → retain the current plate while the daemon supplies
  // the latest geometry. Style-only changes repaint the retained geometry below.
  React.useEffect(() => {
    wantDeltaRef.current = delta;
    wantRevisionRef.current = geometryRevision;
    wantQueryRef.current = {
      projection, lattice, fullSphere, asterisms, starField, marked: markedStars, pdOverlay, pdFocus,
    };
    pumpFetch();
  }, [asterisms, delta, fullSphere, geometryRevision, lattice, markedStars, pdFocus, pdOverlay, projection, pumpFetch,
    starField]);

  // Corner overlays size from the same viewport as the wheel's corners.
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const rect = wrap.getBoundingClientRect();
      setViewport((prev) => (
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      ));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // PD rows and acknowledged Spotlight cursors turn the rete to their arc.
  React.useEffect(() => useAstrolabeStore.subscribe((state, previous) => {
    const request = state.arcRequest;
    if (!request || request === previous.arcRequest || request.documentId !== documentId) return;
    const next = Math.max(0, request.arc);
    viewEditsRef.current.add("delta");
    deltaRef.current = next;
    setDelta(next);
    if (!request.persisted) persistViewState(togglesRef.current, next);
  }), [documentId, persistViewState]);

  // Titlebar: real (signified) date and age of the arc, like PD-in-Chart.
  const setTitleSuffix = useAstrolabeStore((s) => s.setTitleSuffix);
  const titleSuffix = geo
    ? `${geo.symbolicTime.signifiedDateText} · ${geo.symbolicTime.ageText}`
    : null;
  React.useEffect(() => {
    if (!documentId) return;
    setTitleSuffix(documentId, titleSuffix);
  }, [documentId, setTitleSuffix, titleSuffix]);
  React.useEffect(() => () => {
    if (documentId) setTitleSuffix(documentId, null);
  }, [documentId, setTitleSuffix]);

  const paintToggles = React.useMemo(
    () => ({
      ...toggles, observersOn, earthOpacity, starLabels: starPick.labels, pdFocus, cityTuned, eclipticStyle,
      skyTune: skyTuned,
    }),
    [observersOn, cityTuned, earthOpacity, eclipticStyle, pdFocus, skyTuned, starPick.labels, toggles],
  );

  // Draw on geometry / size / font / toggle change. One resolved style feeds
  // the visible paint and the export.
  const resolvePaintStyle = React.useCallback(
    (wrap: HTMLElement) => astrolabePaintStyle(wrap, {
      revision: paintRevision,
      fontUi: chartTextFont,
      fontSymbols: chartSymbolFont,
    }),
    [chartSymbolFont, chartTextFont, paintRevision],
  );
  const clearInspectorHover = React.useCallback(() => {
    if (!hoveredTargetRef.current) return;
    hoveredTargetRef.current = null;
    setHover(null);
    if (useWorkspaceStore.getState().hoveredRegion?.viewDocumentId === inspectorDocumentId) {
      setHoveredRegion(null);
    }
  }, [inspectorDocumentId, setHoveredRegion]);
  React.useEffect(() => () => {
    if (useWorkspaceStore.getState().hoveredRegion?.viewDocumentId === inspectorDocumentId) {
      setHoveredRegion(null);
    }
  }, [inspectorDocumentId, setHoveredRegion]);

  // Observe the retained host once. Re-observing after every geometry response
  // delivers an initial resize notification and paints that same frame twice.
  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => requestFrameRef.current?.());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !geo || !fontsReady) return;

    const seq = ++paintSeqRef.current;
    const paint = () => {
      if (seq < paintedSeqRef.current) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const renderStyle = resolvePaintStyle(wrap);
      const topBoundary = astrolabeTitlebarTopBoundary(rect);
      const ringFill = readCommonRingFill(wrap);
      const camera = camerasRef.current[geo.projection];
      const zoom = camera
        ? astrolabeZoomFromCamera(camera, rect.width, rect.height)
        : clampAstrolabeZoom(zoomRef.current, rect.width, rect.height);
      const previousK = zoomRef.current.k;
      zoomRef.current = zoom;
      camerasRef.current[geo.projection] = astrolabeCameraFromZoom(zoom, rect.width, rect.height);
      if (previousK !== zoom.k) for (const listener of zoomListenersRef.current) listener();
      const reteSurface = createAstrolabeReteSurface();
      const city = cityLayerFor(wrap, paintToggles.cityTuned, geo.projection, () => requestFrameRef.current?.());
      const observers = paintToggles.observersOn ? observerLayerFor(wrap, paintToggles.cityTuned, geo.projection,
        observerPositions.current, () => requestFrameRef.current?.(), frame => { observerFrame.current = frame; }) : undefined;
      const cityToggles = { ...paintToggles, ...(city ? { city } : {}), observers, skyLive };
      const painted = geo.projection === "polarEquidistant"
        ? renderPolarAzimuthal(
          canvas,
          geo,
          earth,
          cityToggles,
          rect.width,
          rect.height,
          renderStyle,
          t,
          ringFill,
          topBoundary,
          undefined,
          zoom,
          reteSurface,
        )
        : render(
          canvas, geo, cityToggles, rect.width, rect.height, renderStyle, t, ringFill,
          topBoundary, undefined, zoom, reteSurface,
        );
      // The GPU is still making this frame's sky: the canvas keeps the
      // previous frame, and this paint runs again once the sky is made.
      if (!painted) return;
      paintedSeqRef.current = seq;
      paintedProjectionRef.current = geo.projection;
      hoverTargetsRef.current = painted;
      reteSurfaceRef.current = reteSurface;
      clearInspectorHover();
    };
    let resizeFrame = 0;
    const schedulePaint = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(paint);
    };
    const skyLive: AstrolabeSkyLive = { wait: paint, repaint: schedulePaint };
    paint();
    requestFrameRef.current = schedulePaint;
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      if (requestFrameRef.current === schedulePaint) requestFrameRef.current = null;
    };
  }, [geo, earth, fontsReady, paintToggles, t, resolvePaintStyle, clearInspectorHover]);

  // The world layer is fixed to the polar plate's horizon frame, so it only
  // changes with the chart's longitude: fetch it once per place and retain it.
  const polarLon = geo?.projection === "polarEquidistant" ? geo.lon : null;
  const earthWanted = polarLon != null && toggles.earthMap;
  React.useEffect(() => {
    if (!earthWanted || polarLon == null) return;
    if (earth && Math.abs(earth.lon - polarLon) < 1e-6) return;
    const controller = new AbortController();
    void fetchAstrolabeEarth(sourceName, { source, documentId }, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setEarth(next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        console.error("[astrolabe-earth]", err);
      });
    return () => controller.abort();
  }, [documentId, earth, earthWanted, polarLon, source, sourceName]);

  // Export renders its own square plate at the wheel's PNG size, with the
  // chart corners painted in, instead of letterboxing the wide visible canvas.
  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!documentId || !geo || !wrap) return;
    return registerChartExportRenderer(documentId, async (request) => {
      const renderStyle = resolvePaintStyle(wrap);
      const ringFill = readCommonRingFill(wrap);
      const city = cityLayerFor(wrap, paintToggles.cityTuned, geo.projection);
      const observers = paintToggles.observersOn ? observerLayerFor(wrap, paintToggles.cityTuned, geo.projection, observerPositions.current) : undefined;
      if (observers) await loadAstrolabeCityPictures(observers);
      const cityToggles = { ...paintToggles, city, observers };
      return renderAstrolabeExport(request, geo, (canvas, width, height, dpr) => {
        if (geo.projection === "polarEquidistant") {
          renderPolarAzimuthal(canvas, geo, earth, cityToggles, width, height, renderStyle, t, ringFill, 0, dpr);
        } else {
          renderStereographicAstrolabe(canvas, geo, cityToggles, width, height, renderStyle, t, ringFill, 0, dpr);
        }
      }, (width, height) => resolveAstrolabeCornerStyle(
        theme, styleRevision, geo.information.wheelTheme, { width, height },
      ));
    });
  }, [documentId, earth, geo, paintToggles, resolvePaintStyle, styleRevision, t, theme]);

  // Poster export (⌥E from any chart surface, poster-export-host.tsx): while
  // this astrolabe is on screen the poster paints its live plate, exactly as
  // shown here (layers, stars, background, colours), uncropped.
  const registerLivePoster = usePosterExportStore((state) => state.registerLive);
  const preparePosterPlate = React.useCallback(async (): Promise<PreparedPosterPlate> => {
    const wrap = wrapRef.current;
    if (!geo || !wrap) throw new Error("astrolabe geometry is not ready");
    return prepareAstrolabePlate({
      geo, earth, toggles: paintToggles, host: wrap, renderStyle: resolvePaintStyle(wrap),
      theme, styleRevision, t, observerPositions: observerPositions.current,
    });
  }, [earth, geo, paintToggles, resolvePaintStyle, styleRevision, t, theme]);
  React.useEffect(() => {
    if (!documentId || !geo) return;
    return registerLivePoster({
      documentId,
      chartDocumentId: inspectorDocumentId,
      chart: inspectorChart,
      preparePlate: preparePosterPlate,
    });
  }, [documentId, geo, inspectorChart, inspectorDocumentId, preparePosterPlate, registerLivePoster]);

  const toggle = React.useCallback((key: keyof LayerToggles) => {
    viewEditsRef.current.add("layers");
    const current = togglesRef.current;
    const next = { ...current, [key]: !current[key] };
    togglesRef.current = next;
    setToggles(next);
    persistViewState(next);
  }, [persistViewState]);

  React.useEffect(() => {
    if (!documentId) return;
    return registerAstrolabeDisplayCommands(documentId, (command) => {
      if (command === "toggle-houses" && projectionRef.current === "stereographic") {
        toggle("regioHouses");
      }
      // A/M are reserved for the future aspect layer in both projections.
      // Polar H is reserved until that projection has house-line display.
    });
  }, [documentId, toggle]);

  // Choosing how solid the earth is brings it in front.
  const changeEarthOpacity = React.useCallback((next: number) => {
    viewEditsRef.current.add("layers");
    earthOpacityRef.current = next;
    setEarthOpacity(next);
    let nextToggles = togglesRef.current;
    if (!nextToggles.earthInFront) {
      nextToggles = { ...nextToggles, earthInFront: true };
      togglesRef.current = nextToggles;
      setToggles(nextToggles);
    }
    persistViewState(nextToggles);
  }, [persistViewState]);

  // How the ecliptic is engraved where the zodiac ring is not drawn.
  const changeEclipticStyle = React.useCallback((next: AstrolabeEclipticStyle) => {
    viewEditsRef.current.add("layers");
    eclipticStyleRef.current = next;
    setEclipticStyle(next);
    persistViewState(togglesRef.current);
  }, [persistViewState]);

  // Fixed-star layer settings: choosing a field or names shows the layer;
  // marking stars does not (marked stars draw on their own).
  const changeStarPick = React.useCallback((next: StarPick) => {
    viewEditsRef.current.add("stars");
    viewEditsRef.current.add("layers");
    const previous = starPickRef.current;
    starPickRef.current = next;
    setStarPick(next);
    let nextToggles = togglesRef.current;
    const layerChoice = next.field !== previous.field || next.labels !== previous.labels;
    if (layerChoice && !nextToggles.stars) {
      nextToggles = { ...nextToggles, stars: true };
      togglesRef.current = nextToggles;
      setToggles(nextToggles);
    }
    persistViewState(nextToggles);
  }, [persistViewState]);

  // === ZOOM — a display transform over the fitted plate, like the
  // astrocartography map: scroll or pinch zooms about the cursor, +/−/0 from
  // the keyboard. Empty-space drag pans; the painted ecliptic/signs turn the
  // rete. ⌘/Ctrl-drag and middle-drag always pan. Only the
  // settled viewport is saved, without recalculation or geometry requests. ===
  const applyZoom = React.useCallback((next: AstrolabeZoom) => {
    const wrap = wrapRef.current;
    const clamped = wrap ? clampAstrolabeZoom(next, wrap.clientWidth, wrap.clientHeight) : next;
    const previous = zoomRef.current;
    if (previous.k === clamped.k && previous.x === clamped.x && previous.y === clamped.y) return;
    zoomRef.current = clamped;
    const projection = paintedProjectionRef.current;
    if (wrap) {
      camerasRef.current[projection] = astrolabeCameraFromZoom(clamped, wrap.clientWidth, wrap.clientHeight);
      cameraEditsRef.current.add(projection);
    }
    if (previous.k !== clamped.k) {
      zoomWasEditedRef.current = true;
      for (const plate of ["stereographic", "polarEquidistant"] as const) {
        const camera = camerasRef.current[plate];
        if (camera) camerasRef.current[plate] = { ...camera, k: clamped.k };
      }
    }
    scheduleCameraPersist();
    clearInspectorHover();
    requestFrameRef.current?.();
    if (previous.k !== clamped.k) for (const listener of zoomListenersRef.current) listener();
  }, [clearInspectorHover, scheduleCameraPersist]);
  const zoomBy = React.useCallback((factor: number, px?: number, py?: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    applyZoom(zoomAstrolabeAt(zoomRef.current, factor, px ?? w / 2, py ?? h / 2, w, h));
  }, [applyZoom]);
  const resetZoom = React.useCallback(() => applyZoom(ASTROLABE_ZOOM_IDENTITY), [applyZoom]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // WebKit (the Tauri webview) reports trackpad pinch as gesture events;
    // Chromium reports it as Ctrl + wheel. Ignore the wheel while a gesture runs.
    let gestureActive = false;
    let gestureStartK = 1;
    const local = (clientX: number, clientY: number): [number, number] => {
      const rect = wrap.getBoundingClientRect();
      return [clientX - rect.left, clientY - rect.top];
    };
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? wrap.clientHeight : 1;
      e.preventDefault();
      if (gestureActive) return;
      // WebKit turns a Shift + mouse wheel into horizontal scroll.
      const delta = e.deltaY === 0 ? e.deltaX : e.deltaY;
      const dy = Math.max(-WHEEL_ZOOM_DELTA_MAX, Math.min(WHEEL_ZOOM_DELTA_MAX, delta * unit));
      zoomBy(Math.exp(-dy * WHEEL_ZOOM_RATE), ...local(e.clientX, e.clientY));
    };
    type GestureEventLike = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureActive = true;
      zoomGestureActiveRef.current = true;
      gestureStartK = zoomRef.current.k;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      zoomBy(gestureStartK * gesture.scale / zoomRef.current.k, ...local(gesture.clientX, gesture.clientY));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureActive = false;
      zoomGestureActiveRef.current = false;
      finishCameraGesture();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("gesturestart", onGestureStart);
    wrap.addEventListener("gesturechange", onGestureChange);
    wrap.addEventListener("gestureend", onGestureEnd);
    return () => {
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("gesturestart", onGestureStart);
      wrap.removeEventListener("gesturechange", onGestureChange);
      wrap.removeEventListener("gestureend", onGestureEnd);
    };
  }, [finishCameraGesture, zoomBy]);

  const selectProjection = React.useCallback((next: AstrolabeProjection) => {
    if (next === projectionRef.current) return;
    viewEditsRef.current.add("projection");
    const wrap = wrapRef.current;
    const current = wrap
      ? astrolabeCameraFromZoom(zoomRef.current, wrap.clientWidth, wrap.clientHeight)
      : { k: zoomRef.current.k, centerX: 0.5, centerY: 0.5 };
    const remembered = camerasRef.current[next] ?? current;
    camerasRef.current[next] = { ...remembered, k: current.k };
    projectionRef.current = next;
    setProjection(next);
    finishCameraGesture();
  }, [finishCameraGesture]);

  // === RETE ROTATION — direct angular travel around the painted pole.
  // Freeze that centre for the gesture; unwrap angle crossings continuously.
  React.useEffect(() => () => {
    if (dragFrameRef.current != null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  // === HOVER — resolve the painted target through the chart's shared inspector. ===
  const regionForTarget = React.useCallback((target: AstrolabeHoverTarget): HoverRegion | null => {
    const inspector = target.inspector;
    if (!inspector) return null;
    if (inspector.kind === "fixed_star") {
      return { kind: "secondary_ring", family: "fixstar", itemId: inspector.code,
        starCode: inspector.code, label: target.name, longitude: inspector.longitude,
        viewDocumentId: inspectorDocumentId };
    }
    if (inspector.kind === "fortune") {
      return { kind: "fortune", longitude: inspector.longitude, viewDocumentId: inspectorDocumentId };
    }
    if (inspector.kind === "term" || inspector.kind === "decan") {
      return { ...inspector, viewDocumentId: inspectorDocumentId };
    }
    const planet = inspectorChart?.primaryChart.planets.find((item) => item.seId === inspector.seId);
    return planet ? { kind: "planet", planetId: planet.id, seId: planet.seId,
      longitude: planet.longitude, latitude: planet.latitude, speed: planet.speed,
      house: planet.house, dignity: planet.dignity, viewDocumentId: inspectorDocumentId } : null;
  }, [inspectorChart, inspectorDocumentId]);
  React.useEffect(() => {
    const target = hoveredTargetRef.current;
    if (target) setHoveredRegion(regionForTarget(target));
  }, [regionForTarget, setHoveredRegion]);
  const flagAnchor = React.useMemo<FlagAnchor | null>(() => {
    const region = hover && !hover.target.pdReprojection ? regionForTarget(hover.target) : null;
    return hover && region ? { region, x: hover.left + hover.target.x,
      y: hover.top + hover.target.y, token: hover.token } : null;
  }, [hover, regionForTarget]);
  const updateHover = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = findHoverTarget(hoverTargetsRef.current, x, y, HOVER_RADIUS_PX);
    const region = target ? regionForTarget(target) : null;
    if (hoveredTargetRef.current === target) return region;
    hoveredTargetRef.current = target;
    const current = useWorkspaceStore.getState().hoveredRegion;
    if (region || current?.viewDocumentId === inspectorDocumentId) setHoveredRegion(region);
    setHover(target ? { target, width: rect.width, left: rect.left, top: rect.top, token: ++hoverTokenRef.current } : null);
    return region;
  }, [inspectorDocumentId, regionForTarget, setHoveredRegion]);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const zoom = zoomRef.current;
      const panModifier = usesAppleShortcuts() ? e.metaKey : e.ctrlKey;
      if ((e.button !== 0 && e.button !== 1) || dragRef.current || panRef.current || observerDrag.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const frame = observerFrame.current;
      const ray = frame && observersEnabled.current && observerRay(x, y, frame);
      if (ray && e.button === 0 && !panModifier) {
        const positions = observerPositions.current;
        const index = positions.map((p, i) => ({ p, i })).sort((a, b) => Math.hypot(...a.p) - Math.hypot(...b.p))
          .find(({ p, i }) => observerHit(ray, p, i))?.i;
        if (index != null && frame) {
          const foot = observerFootScreen(positions[index], frame);
          observerDrag.current = { index, pointerId: e.pointerId,
            offset: [foot[0] - x, foot[1] - y] };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          clearInspectorHover();
          return;
        }
      }
      const surface = reteSurfaceRef.current;
      const pan = e.button === 1 || panModifier || !hitAstrolabeRete(surface, x, y);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      if (pan) {
        e.preventDefault();
        panRef.current = { startX: e.clientX, startY: e.clientY, zoom, pointerId: e.pointerId, moved: false };
        canvas.style.cursor = "grabbing";
        return;
      }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startDelta: deltaRef.current,
        center: [...surface.center],
        lastAngle: Math.atan2(y - surface.center[1], x - surface.center[0]),
        lastPoint: [x - surface.center[0], y - surface.center[1]],
        turn: 0,
        pointerId: e.pointerId,
        moved: false,
      };
      canvas.style.cursor = "grabbing";
    },
    [clearInspectorHover],
  );

  const onPointerMove = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const observer = observerDrag.current;
    if (observer && observer.pointerId === e.pointerId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const frame = observerFrame.current;
      const ray = frame && observerRay(e.clientX - rect.left + observer.offset[0], e.clientY - rect.top + observer.offset[1], frame);
      const ground = ray && observerGround(ray);
      if (ground) {
        const next: ObserverPosition = ground;
        if (Math.hypot(...next) >= 2 && Math.hypot(...next) <= 60) {
          observerPositions.current[observer.index] = next;
          requestFrameRef.current?.();
        }
      }
      return;
    }
    const pan = panRef.current;
    if (pan) {
      if (e.pointerId !== pan.pointerId) return;
      if (!pan.moved && Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) < 3) return;
      pan.moved = true;
      applyZoom({
        k: pan.zoom.k,
        x: pan.zoom.x + e.clientX - pan.startX,
        y: pan.zoom.y + e.clientY - pan.startY,
      });
      return;
    }
    const ds = dragRef.current;
    if (!ds) {
      e.currentTarget.style.cursor = "grab";
      const frame = observerFrame.current;
      if (frame && observersEnabled.current) {
        const rect = e.currentTarget.getBoundingClientRect();
        const ray = observerRay(e.clientX - rect.left, e.clientY - rect.top, frame);
        if (ray && observerPositions.current.some((position, pose) => observerHit(ray, position, pose))) {
          clearInspectorHover();
          return;
        }
      }
      updateHover(e);
      return;
    }
    if (e.pointerId !== ds.pointerId) return;
    if (!ds.moved && Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) < 3) return;
    ds.moved = true;
    if (hoveredTargetRef.current) clearInspectorHover();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - ds.center[0], y = e.clientY - rect.top - ds.center[1];
    const angle = Math.atan2(y, x);
    // A straight drag through the pole is radial, with no stable angular
    // continuation. Re-anchor after it instead of jumping the arc by 180°.
    const [lastX, lastY] = ds.lastPoint;
    const dx = x - lastX, dy = y - lastY, lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared > 0 ? Math.max(0, Math.min(1, -(lastX * dx + lastY * dy) / lengthSquared)) : 0;
    ds.lastPoint = [x, y];
    if (Math.hypot(lastX + along * dx, lastY + along * dy) < 16) {
      ds.lastAngle = angle;
      return;
    }
    ds.turn += astrolabeReteTurn(ds.lastAngle, angle);
    ds.lastAngle = angle;
    const next = ds.startDelta + ds.turn;
    const clamped = Math.max(0, next);
    if (clamped === deltaRef.current) return;
    viewEditsRef.current.add("delta");
    deltaRef.current = clamped;
    // Bound work by presentation cadence, not by angular jumps that grow with
    // zoom. Multiple pointer events before a frame share their latest intent.
    if (dragFrameRef.current == null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        setDelta(deltaRef.current);
      });
    }
  }, [applyZoom, clearInspectorHover, updateHover]);

  const endDrag = React.useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (observerDrag.current?.pointerId === e.pointerId) {
      if (e.type === "pointerup") onPointerMove(e);
      observerDrag.current = null;
      writeObservers(observersEnabled.current, observerPositions.current);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const pan = panRef.current;
    const drag = dragRef.current;
    const gesture = pan ?? drag;
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (e.type === "pointerup") onPointerMove(e);
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pan) {
      panRef.current = null;
      finishCameraGesture();
    }
    if (drag?.moved) {
      if (dragFrameRef.current != null) window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      setDelta(deltaRef.current);
      persistViewState(togglesRef.current, deltaRef.current);
    }
    dragRef.current = null;
    if (canvas) {
      canvas.style.cursor = "grab";
    }
    if (!gesture.moved && e.type !== "pointercancel"
      && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < 3) {
      const region = updateHover(e);
      if (pinOnClick) setInspectorActiveRegion(region);
      const target = hoveredTargetRef.current;
      setPdFocusState((current) => {
        const previous = current && current.documentId === documentId ? current.key : null;
        const key = nextPdFocus(previous, target);
        return key === previous ? current : key ? { documentId, key } : null;
      });
    }
  }, [documentId, finishCameraGesture, onPointerMove, persistViewState, pinOnClick, setInspectorActiveRegion, updateHover]);

  // === ARC STEPPING — shared by the plate's keys and the chart navbar. ===
  const stepArc = React.useCallback(
    (key: AstrolabeNavigationKey, modifiers: AstrolabeNavigationModifiers): boolean => {
      if (!geo) return false;
      const ypd = geo.yearsPerDegree > 0 ? geo.yearsPerDegree : 1;
      const snap = geo.pd.snapArcs;
      let next = deltaRef.current;
      if (key === "left" || key === "right") {
        let yrs = modifiers.alt ? 7 / 365.2425 : modifiers.shift ? 1 / 12 : 1;
        if (key === "left") yrs = -yrs;
        next = Math.max(0, next + yrs / ypd);
      } else if (key === "up") {
        for (const arc of snap) {
          if (arc > next + 0.001) {
            next = arc;
            break;
          }
        }
      } else if (key === "down") {
        next = 0;
        for (let i = snap.length - 1; i >= 0; i--) {
          if (snap[i] < deltaRef.current - 0.001) {
            next = snap[i];
            break;
          }
        }
      } else {
        next = 0;
      }
      viewEditsRef.current.add("delta");
      deltaRef.current = next;
      setDelta(next);
      persistViewState(togglesRef.current, next);
      return true;
    },
    [geo, persistViewState],
  );
  React.useEffect(
    () => (documentId ? registerAstrolabeNavigator(documentId, stepArc) : undefined),
    [documentId, stepArc],
  );

  // === KEYBOARD STEPPING — mirrors _AstrolabeStepper.handle_navigation_key
  // (morin.py:19335-19394): ←/→ step time (1yr / Shift 1mo / Alt 1wk) via the
  // active PD key, ↑/↓ jump to the prev/next PD event, Space resets to 0°. ===
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const zoomKey = e.key === "+" || e.key === "=" ? 1
        : e.key === "-" || e.key === "_" || e.key === "\u2212" ? -1
          : e.key === "0" ? 0 : null;
      // Tab flips between the stereographic and polar plates.
      if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        selectProjection(projectionRef.current === "polarEquidistant" ? "stereographic" : "polarEquidistant");
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (zoomKey != null && !e.altKey) {
        if (zoomKey === 0) resetZoom();
        else zoomBy(zoomKey > 0 ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const key = e.key === "ArrowLeft" ? "left"
        : e.key === "ArrowRight" ? "right"
          : e.key === "ArrowUp" ? "up"
            : e.key === "ArrowDown" ? "down"
              : e.key === " " || e.code === "Space" ? "space" : null;
      if (!key || !stepArc(key, { shift: e.shiftKey, alt: e.altKey })) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [resetZoom, selectProjection, stepArc, zoomBy],
  );

  return (
    <div className="font-morinus-text relative flex h-full w-full min-w-0 flex-1 min-h-0 flex-col overflow-hidden bg-background">
      <ContextMenu>
        <ContextMenuTrigger
          render={(
            <div
              ref={registerKeyboardFocusTarget}
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="group/astrolabe relative h-full w-full min-w-0 flex-1 min-h-0 overflow-hidden outline-none"
            >
              <canvas
                ref={canvasRef}
                onPointerDown={(e) => {
                  wrapRef.current?.focus();
                  clearInspectorHover();
                  onPointerDown(e);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={clearInspectorHover}
                // Out of flow like the wheel's canvases: its backing-store size
                // must never size the chart-area row the right panes share.
                className="absolute inset-0 block h-full w-full cursor-grab touch-none"
              />
              {inspectorChart ? <ChartHoverFlag anchor={flagAnchor} chart={inspectorChart} /> : null}
              {hover && (!flagAnchor || !inspectorChart) ? <AstrolabeHoverCaption hover={hover} /> : null}
              {geo ? (
                <AstrolabeZoomPill
                  subscribe={subscribeZoom}
                  readLevel={readZoomLevel}
                  onZoom={zoomBy}
                  onReset={resetZoom}
                />
              ) : null}
              {DESIGN_TUNERS_ENABLED && tunerOpen ? (
                <AstrolabeStarTuner
                  observerControl={<label className="flex items-center justify-between">
                    <span>{t("astrolabe.observers")}</span>
                    <input type="checkbox" checked={observersOn} onChange={e => setObserversOn(e.target.checked)} />
                  </label>}
                  hostRef={wrapRef}
                  onChange={() => setStarTuneSeq((n) => n + 1)}
                  city={cityTunes[geo?.projection ?? projection]}
                  projection={geo?.projection ?? projection}
                  onCityChange={(next) => {
                    const plate = geo?.projection ?? projection;
                    setCityTunes((current) => ({ ...current, [plate]: next }));
                    writeCityTune(plate, next);
                  }}
                  sky={skyTune}
                  onSkyChange={(next) => {
                    setSkyTune(next);
                    writeSkyTune(next);
                  }}
                />
              ) : null}
              {geo ? (
                <AstrolabeCorners
                  information={geo.information}
                  events={geo.pd.nearbyEvents}
                  viewport={viewport}
                />
              ) : null}
              {error ? (
                <div className="absolute inset-0 flex items-center justify-center text-[length:var(--aries-font-size-base)] text-destructive">
                  {t("astrolabe.failed", { error })}
                </div>
              ) : !geo ? (
                <div className="absolute inset-0 flex items-center justify-center text-[length:var(--aries-font-size-base)] text-muted-foreground">
                  {t("astrolabe.loading")}
                </div>
              ) : null}
            </div>
          )}
        />
        <AstrolabeViewMenu
          toggles={toggles}
          onToggle={toggle}
          projection={projection}
          onProjection={selectProjection}
          starPick={starPick}
          onStarPick={changeStarPick}
          earthOpacity={earthOpacity}
          onEarthOpacity={changeEarthOpacity}
          eclipticStyle={eclipticStyle}
          onEclipticStyle={changeEclipticStyle}
          background={cityTunes.stereographic.mode === "off" ? "off" : cityTunes.stereographic.picture}
          onBackground={changeBackground}
          backgroundOpacity={cityTunes.stereographic.strength}
          onBackgroundOpacity={changeBackgroundOpacity}
        />
      </ContextMenu>
    </div>
  );
}

const HOVER_RADIUS_PX = 8;
const KEY_ZOOM_STEP = 1.25;
const WHEEL_LINE_PX = 16;
// Exponential wheel zoom; a mouse notch (~100 px) is capped to one firm step
// while trackpad pinch deltas (a few px) zoom smoothly.
const WHEEL_ZOOM_RATE = 0.01;
const WHEEL_ZOOM_DELTA_MAX = 40;

// In-frame design tuner (Shift+Cmd+D), in pages: the star magnitude, planet
// glyph and ecliptic engraving tokens (sliders write those --aries-astrolabe-*
// variables on the astrolabe host and repaint), the sky and the background
// picture. Development builds only.

type TunerToken = readonly [name: string, min: number, max: number, step: number, baked: number];

const STAR_TUNER_TOKENS: readonly TunerToken[] = [
  ["--aries-astrolabe-star-bright-limit", -1.5, 6, 0.1, 2.5],
  ["--aries-astrolabe-star-magnitude-exponent", 0, 1, 0.01, 0.3],
  ["--aries-astrolabe-star-scale-min", 0.05, 1, 0.01, 0.3],
  ["--aries-astrolabe-star-scale-max", 0.5, 3, 0.05, 1.6],
  ["--aries-astrolabe-star-faint-opacity", 0, 1, 0.01, 0.35],
  ["--aries-astrolabe-star-radius-divisor", 120, 900, 10, 590],
];
// Ecliptic engraving (Ecliptic menu: Scale, Divided band), in tick steps.
const ECLIPTIC_TUNER_TOKENS: readonly TunerToken[] = [
  ["--aries-astrolabe-ecliptic-scale-tick-1", 0.5, 4, 0.1, 1],
  ["--aries-astrolabe-ecliptic-scale-tick-5", 1, 6, 0.1, 1.8],
  ["--aries-astrolabe-ecliptic-scale-tick-10", 1.5, 8, 0.1, 2.5],
  ["--aries-astrolabe-ecliptic-scale-weight", 0.5, 2.5, 0.05, 0.8],
  ["--aries-astrolabe-ecliptic-band-width-steps", 1, 10, 0.25, 1],
  ["--aries-astrolabe-ecliptic-band-box-degrees", 5, 10, 5, 5],
  ["--aries-astrolabe-ecliptic-band-tick-share", 0.2, 1, 0.05, 1],
];
// Planet glyph size on both plates: the slider is a scale on the baked
// --aries-astrolabe-planet-font-divisor and stores the divisor it yields.
const PLANET_FONT_DIVISOR = "--aries-astrolabe-planet-font-divisor";
const PLANET_FONT_DIVISOR_BAKED = 22.22;

// Tuned values persist per browser profile (dev builds only) so they survive
// closing the smoke app; reset clears them back to the baked token defaults.
const STAR_TUNER_STORAGE_KEY = "aries.designTuner.astrolabeStars";
const STAR_TUNER_FAINT = "--aries-astrolabe-star-faint";
const TUNER_PAGE_STORAGE_KEY = "aries.designTuner.astrolabePage";
const TUNER_PAGES = ["stars", "planets", "ecliptic", "sky", "background"] as const;
type TunerPage = (typeof TUNER_PAGES)[number];
const TUNER_PAGE_LABEL = {
  stars: "astrolabe.stars",
  planets: "astrolabe.tuner.planets",
  ecliptic: "astrolabe.ecliptic",
  sky: "astrolabe.tuner.sky",
  background: "astrolabe.background",
} as const satisfies Record<TunerPage, string>;

function readTunerPage(): TunerPage {
  try {
    const page = window.localStorage.getItem(TUNER_PAGE_STORAGE_KEY);
    return TUNER_PAGES.find((name) => name === page) ?? "stars";
  } catch {
    return "stars";
  }
}

function writeTunerPage(page: TunerPage) {
  try {
    window.localStorage.setItem(TUNER_PAGE_STORAGE_KEY, page);
  } catch {
    /* storage is best-effort */
  }
}

function readStarTunerOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STAR_TUNER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function writeStarTunerOverrides(overrides: Record<string, string>) {
  try {
    window.localStorage.setItem(STAR_TUNER_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage is best-effort */
  }
}

/** Apply persisted tuner values to the astrolabe host, panel open or not. */
function applyStarTunerOverrides(host: HTMLElement | null): boolean {
  if (!host) return false;
  const overrides = readStarTunerOverrides();
  for (const [name, value] of Object.entries(overrides)) host.style.setProperty(name, value);
  return Object.keys(overrides).length > 0;
}

// City on the plate's earth (see astrolabe-city.ts): picture, mode, two colour
// tokens, the middle level's foreground share and the picture's strength over
// the ground (both percent). Persisted like the star values.
// The picture is chosen for the astrolabe; the polar plate always shows Monte's
// map, the one picture drawn in its own projection. Each plate keeps its own
// values: Monte only reads as a low-key one-bit layer under the polar lattice.
type PlatePicture = Extract<CityPicture, "catena" | "naarden" | "cinderCones" | "durer">;
type CityTune = {
  picture: PlatePicture; mode: "off" | "one" | "three"; fg: string; bg: string; mix: number; strength: number;
};
type CityTunes = Record<AstrolabeProjection, CityTune>;
/** The stereographic plate's background, as the view menu offers it. */
type StereoBackground = PlatePicture | "off";
const CITY_TUNE_DEFAULTS: CityTunes = {
  stereographic: {
    picture: "cinderCones", mode: "three", fg: "--morinus-frame", bg: "--morinus-background", mix: 45, strength: 80,
  },
  polarEquidistant: {
    picture: "catena", mode: "off", fg: "--morinus-frame", bg: "--morinus-background", mix: 45, strength: 34,
  },
};
/** The view menu's background strengths (percent), the earth opacity stops. */
const BACKGROUND_OPACITIES = [100, 80, 60, 40] as const;
const CITY_PICTURE_LABEL = {
  catena: "astrolabe.cityTuner.pictureCatena",
  naarden: "astrolabe.cityTuner.pictureNaarden",
  cinderCones: "astrolabe.cityTuner.pictureCinderCones",
  durer: "astrolabe.cityTuner.pictureDurer",
} as const satisfies Record<PlatePicture, string>;
const CITY_TUNE_STORAGE_KEYS: Record<AstrolabeProjection, string> = {
  stereographic: "aries.designTuner.astrolabeCity",
  polarEquidistant: "aries.designTuner.astrolabeCityPolar",
};
const CITY_FG_TOKENS = [
  "--morinus-frame",
  "--aries-text-muted",
  "--morinus-houses",
  "--morinus-angles",
  "--morinus-signs",
  "--aries-astrolabe-capricorn",
  "--aries-text-primary",
] as const;
const CITY_BG_TOKENS = [
  "--morinus-background",
  "--aries-surface",
  "--aries-surface-subtle",
  "--aries-background",
] as const;

/** The tuned city in this host's theme colours, or undefined when off.
 * `requestRepaint` repaints the plate once a city picture has loaded. */
function observerLayerFor(host: HTMLElement, tunes: CityTunes, projection: AstrolabeProjection,
  positions: ObserverPosition[], requestRepaint?: () => void, observerFrame?: (frame: ObserverFrame) => void): AstrolabeCityLayer | undefined {
  const tune = tunes[projection];
  const fg = tokenRgb(host, tune.fg), bg = tokenRgb(host, tune.bg);
  return fg && bg ? { picture: tune.picture, mode: tune.mode === "off" ? "three" : tune.mode,
    fg, bg, mix: tune.mix / 100, strength: 1, observers: positions, requestRepaint, observerFrame } : undefined;
}

function cityLayerFor(
  host: HTMLElement,
  tunes: CityTunes | null,
  projection: AstrolabeProjection,
  requestRepaint?: () => void,
): AstrolabeCityLayer | undefined {
  const tune = tunes?.[projection];
  if (!tune || tune.mode === "off") return undefined;
  const fg = tokenRgb(host, tune.fg);
  const bg = tokenRgb(host, tune.bg);
  if (!fg || !bg) return undefined;
  return {
    picture: projection === "polarEquidistant" ? "monte" : tune.picture,
    mode: tune.mode, fg, bg, mix: tune.mix / 100, strength: tune.strength / 100, requestRepaint,
  };
}

/** Everything the plate paints from besides its geometry (the view's `paintToggles`). */
type PlatePaintToggles = LayerToggles & {
  observersOn: boolean;
  earthOpacity: number;
  starLabels: AstrolabeStarLabels;
  pdFocus: string | null;
  cityTuned: CityTunes;
  eclipticStyle: AstrolabeEclipticStyle;
  skyTune: AstrolabeSkyTune | null;
};

/** The plate for the poster: this geometry, these layers and this style,
 * whole (identity zoom), with its city and observer pictures loaded. */
export async function prepareAstrolabePlate(input: {
  geo: AstrolabeGeometry | PolarAzimuthalGeometry;
  earth: PolarAzimuthalEarth | null;
  toggles: PlatePaintToggles;
  host: HTMLElement;
  renderStyle: AstrolabeRenderStyle;
  theme: ThemeState | null;
  styleRevision: string | number;
  t: ReturnType<typeof useT>;
  observerPositions: ObserverPosition[];
}): Promise<PreparedPosterPlate> {
  const { geo, earth, toggles, host, renderStyle, theme, styleRevision, t } = input;
  const ringFill = readCommonRingFill(host);
  const city = cityLayerFor(host, toggles.cityTuned, geo.projection);
  if (city) await loadAstrolabeCityPictures(city);
  const observers = toggles.observersOn
    ? observerLayerFor(host, toggles.cityTuned, geo.projection, input.observerPositions)
    : undefined;
  if (observers) await loadAstrolabeCityPictures(observers);
  const paintToggles = { ...toggles, city, observers };
  const palette = resolveAstrolabeCornerStyle(theme, styleRevision, geo.information.wheelTheme, { width: 1, height: 1 }).palette;
  return {
    background: renderStyle.palette.background,
    ink: {
      text: palette.textBright,
      muted: palette.textDim,
      fontUi: renderStyle.typography.fontUi,
      fontSymbols: renderStyle.typography.fontSymbols,
    },
    paint: (canvas, side, dpr) => {
      if (geo.projection === "polarEquidistant") {
        renderPolarAzimuthal(canvas, geo, earth, paintToggles, side, side, renderStyle, t, ringFill, 0, dpr);
      } else {
        renderStereographicAstrolabe(canvas, geo, paintToggles, side, side, renderStyle, t, ringFill, 0, dpr);
      }
    },
  };
}

/** The plate an astrolabe of this chart would show right now, without one on
 * screen: the stored projection, layers, stars and rete arc (per radix), the
 * local background, observers and sky tunes, and the current theme. */
export async function prepareStoredAstrolabePlate(input: {
  documentId: string;
  sourceName: string;
  source?: string;
  theme: ThemeState | null;
  styleRevision: string | number;
  t: ReturnType<typeof useT>;
}): Promise<PreparedPosterPlate> {
  const { documentId, sourceName, source, theme, styleRevision, t } = input;
  const state = await fetchAstrolabeViewState(documentId);
  const toggles = layerTogglesFromViewState(state);
  const projection = state.projection;
  const polar = projection === "polarEquidistant";
  const starField = state.starField ?? DEFAULT_STAR_PICK.field;
  const marked = state.markedStars ?? [];
  const [geo, earth] = await Promise.all([
    fetchAstrolabe(sourceName, {
      delta: Math.max(0, state.deltaDeg),
      source,
      documentId,
      projection,
      lattice: polar && (toggles.almucantars || toggles.azimuths),
      fullSphere: polar && toggles.fullSphere,
      asterisms: toggles.asterisms,
      starField,
      marked,
      pdOverlay: toggles.pdReprojection,
      pdFocus: null,
    }),
    polar ? fetchAstrolabeEarth(sourceName, { source, documentId }) : Promise.resolve(null),
  ]);
  const fontUi = morinusTextFontFromTokens(theme?.appTokens);
  const fontSymbols = theme?.appTokens?.["--aries-font-symbols"]?.trim() || '"AriesMorinus"';
  await awaitFonts(fontUi, fontSymbols);
  // Theme tokens live on the document; the astrolabe host adds none of its own.
  const host = document.body;
  const cityTunes: CityTunes = {
    stereographic: readCityTune("stereographic"),
    polarEquidistant: readCityTune("polarEquidistant"),
  };
  const observers = readObservers();
  return prepareAstrolabePlate({
    geo,
    earth,
    toggles: {
      ...toggles,
      observersOn: observers.enabled,
      earthOpacity: state.earthOpacity ?? DEFAULT_EARTH_OPACITY,
      starLabels: state.starLabels ?? DEFAULT_STAR_PICK.labels,
      pdFocus: null,
      cityTuned: DESIGN_TUNERS_ENABLED
        ? cityTunes
        : { ...cityTunes, polarEquidistant: { ...cityTunes.polarEquidistant, mode: "off" } },
      eclipticStyle: ASTROLABE_ECLIPTIC_STYLES.includes(state.eclipticStyle)
        ? state.eclipticStyle : DEFAULT_VIEW_STATE.eclipticStyle,
      skyTune: DESIGN_TUNERS_ENABLED ? readSkyTune() : null,
    },
    host,
    renderStyle: astrolabePaintStyle(host, { revision: `${styleRevision}:poster`, fontUi, fontSymbols }),
    theme,
    styleRevision,
    t,
    observerPositions: observers.positions,
  });
}

/** The one place the astrolabe's paint style is resolved: the screen's
 * retained paint and the poster's stored plate share it. */
function astrolabePaintStyle(wrap: HTMLElement, options: Parameters<typeof resolveAstrolabeRenderStyle>[1]) {
  const renderStyle = resolveAstrolabeRenderStyle(wrap, options);
  return renderStyle;
}

function readCityTune(projection: AstrolabeProjection): CityTune {
  const defaults = CITY_TUNE_DEFAULTS[projection];
  try {
    const raw = window.localStorage.getItem(CITY_TUNE_STORAGE_KEYS[projection]);
    const parsed = raw ? (JSON.parse(raw) as Partial<CityTune>) : {};
    const tune = { ...defaults, ...parsed };
    return tune.picture in CITY_PICTURE_LABEL ? tune : { ...tune, picture: defaults.picture };
  } catch {
    return defaults;
  }
}

function writeCityTune(projection: AstrolabeProjection, tune: CityTune) {
  try {
    window.localStorage.setItem(CITY_TUNE_STORAGE_KEYS[projection], JSON.stringify(tune));
  } catch {
    /* storage is best-effort */
  }
}

const CITY_MODE_LABEL = { off: "astrolabe.cityTuner.off", one: "astrolabe.cityTuner.oneBit", three: "astrolabe.cityTuner.threeLevel" } as const;

function AstrolabeCityTuner({
  tune,
  projection,
  onChange,
}: {
  tune: CityTune;
  projection: AstrolabeProjection;
  onChange: (next: CityTune) => void;
}) {
  const t = useT();
  const polar = projection === "polarEquidistant";
  const defaults = CITY_TUNE_DEFAULTS[projection];
  const select = (key: "fg" | "bg", options: readonly string[]) => (
    <select
      data-aries-surface="control"
      className="min-w-0 flex-1 bg-transparent"
      value={tune[key]}
      onChange={(e) => onChange({ ...tune, [key]: e.target.value })}
    >
      {options.map((name) => <option key={name} value={name}>{name.replace(/^--/, "")}</option>)}
    </select>
  );
  return (
    <div className="flex flex-col gap-1 border-b border-foreground/10 pb-2">
      <span className="flex gap-1">
        {(["off", "one", "three"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`flex-1 rounded-[var(--aries-radius-control-compact)] ring-1 ring-foreground/20 ${tune.mode === mode ? "bg-accent" : "hover:bg-accent"}`}
            onClick={() => onChange({ ...tune, mode })}
          >
            {t(CITY_MODE_LABEL[mode])}
          </button>
        ))}
      </span>
      <label className="flex items-center gap-2">
        <span className="w-12">{t("astrolabe.cityTuner.picture")}</span>
        {polar ? (
          <select data-aries-surface="control" className="min-w-0 flex-1 bg-transparent" disabled value="monte">
            <option value="monte">{t("astrolabe.cityTuner.pictureMonte")}</option>
          </select>
        ) : (
          <select
            data-aries-surface="control"
            className="min-w-0 flex-1 bg-transparent"
            value={tune.picture}
            onChange={(e) => onChange({ ...tune, picture: e.target.value as PlatePicture })}
          >
            {(Object.keys(CITY_PICTURE_LABEL) as PlatePicture[]).map((picture) => (
              <option key={picture} value={picture}>{t(CITY_PICTURE_LABEL[picture])}</option>
            ))}
          </select>
        )}
      </label>
      <label className="flex items-center gap-2"><span className="w-12">{t("astrolabe.cityTuner.ink")}</span>{select("fg", CITY_FG_TOKENS)}</label>
      <label className="flex items-center gap-2"><span className="w-12">{t("astrolabe.cityTuner.paper")}</span>{select("bg", CITY_BG_TOKENS)}</label>
      <label className="flex flex-col">
        <span className="flex justify-between">
          <span>{t("astrolabe.cityTuner.midShare")}</span>
          <span className="tabular-nums">{tune.mix}%</span>
        </span>
        <input
          type="range"
          min={10}
          max={90}
          step={1}
          value={tune.mix}
          disabled={tune.mode !== "three"}
          onChange={(e) => onChange({ ...tune, mix: Number(e.target.value) })}
          onDoubleClick={() => onChange({ ...tune, mix: defaults.mix })}
        />
      </label>
      <label className="flex flex-col">
        <span className="flex justify-between">
          <span>{t("astrolabe.cityTuner.strength")}</span>
          <span className="tabular-nums">{tune.strength}%</span>
        </span>
        <input
          type="range"
          min={20}
          max={100}
          step={1}
          value={tune.strength}
          onChange={(e) => onChange({ ...tune, strength: Number(e.target.value) })}
          onDoubleClick={() => onChange({ ...tune, strength: defaults.strength })}
        />
      </label>
      <button
        type="button"
        className="rounded-[var(--aries-radius-control-compact)] ring-1 ring-foreground/20 hover:bg-accent"
        onClick={() => onChange(defaults)}
      >
        {t("astrolabe.cityTuner.reset")}
      </button>
    </div>
  );
}

/** The plate's planet glyph font size (CSS px at 1x zoom) as last painted. */
function usePlanetGlyphPx(hostRef: React.RefObject<HTMLDivElement | null>): string | null {
  const [px, setPx] = React.useState<string | null>(null);
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => setPx(host.querySelector(`canvas[${ASTROLABE_PLANET_GLYPH_PX_ATTR}]`)?.getAttribute(ASTROLABE_PLANET_GLYPH_PX_ATTR) ?? null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(host, { subtree: true, attributeFilter: [ASTROLABE_PLANET_GLYPH_PX_ATTR] });
    return () => observer.disconnect();
  }, [hostRef]);
  return px;
}

function AstrolabeStarTuner({
  observerControl,
  hostRef,
  onChange,
  city,
  projection,
  onCityChange,
  sky,
  onSkyChange,
}: {
  observerControl: React.ReactNode;
  hostRef: React.RefObject<HTMLDivElement | null>;
  onChange: () => void;
  city: CityTune;
  projection: AstrolabeProjection;
  onCityChange: (next: CityTune) => void;
  sky: AstrolabeSkyTune;
  onSkyChange: (next: AstrolabeSkyTune) => void;
}) {
  const t = useT();
  const [page, setPage] = React.useState<TunerPage>(readTunerPage);
  const [overrides, setOverrides] = React.useState<Record<string, string>>(readStarTunerOverrides);
  const apply = (next: Record<string, string>) => {
    setOverrides(next);
    writeStarTunerOverrides(next);
    onChange();
  };
  const update = (name: string, value: string | null) => {
    const next = { ...overrides };
    if (value == null) {
      delete next[name];
      hostRef.current?.style.removeProperty(name);
    } else {
      next[name] = value;
      hostRef.current?.style.setProperty(name, value);
    }
    apply(next);
  };
  // Reset clears this page's token overrides back to the baked defaults.
  const resetTokens = (names: readonly string[]) => {
    const next = { ...overrides };
    for (const name of names) {
      delete next[name];
      hostRef.current?.style.removeProperty(name);
    }
    apply(next);
  };
  const resetButton = (names: readonly string[]) => (
    <button
      type="button"
      className="rounded-[var(--aries-radius-control-compact)] ring-1 ring-foreground/20 hover:bg-accent"
      onClick={() => resetTokens(names)}
    >
      {t("astrolabe.tuner.reset")}
    </button>
  );
  const tokenSliders = (tokens: readonly TunerToken[]) => tokens.map(([name, min, max, step, baked]) => {
    const value = overrides[name] != null ? Number(overrides[name]) : baked;
    return (
      <label key={name} className="flex flex-col">
        <span className="flex justify-between">
          <span className="truncate">{name.replace(/^--aries-astrolabe-(star-)?/, "")}</span>
          <span className="tabular-nums">{value}</span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => update(name, e.target.value)}
          // Double-click restores this token's baked default.
          onDoubleClick={() => update(name, null)}
        />
      </label>
    );
  });
  const planetDivisor = overrides[PLANET_FONT_DIVISOR] != null
    ? Number(overrides[PLANET_FONT_DIVISOR]) : PLANET_FONT_DIVISOR_BAKED;
  const planetScale = Math.round((PLANET_FONT_DIVISOR_BAKED / planetDivisor) * 100) / 100;
  const planetGlyphPx = usePlanetGlyphPx(hostRef);
  const pageClass = "flex flex-col gap-1";
  return (
    <div
      className="absolute right-[var(--aries-control-padding-x)] bottom-[var(--aries-control-padding-x)] z-20 flex w-72 flex-col gap-1 rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] p-2 font-mono text-[length:var(--aries-font-size-small)] text-[color:var(--aries-popover-text)] shadow-md ring-1 ring-foreground/10"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <Tabs
        value={page}
        onValueChange={(next) => {
          const name = TUNER_PAGES.find((candidate) => candidate === next) ?? "stars";
          setPage(name);
          writeTunerPage(name);
        }}
        className="gap-2"
      >
        <TabsList className="w-full">
          {TUNER_PAGES.map((name) => (
            <TabsTrigger
              key={name}
              value={name}
              className="min-w-0 px-1 font-sans text-[length:var(--aries-font-size-small)]"
            >
              <span className="truncate">{t(TUNER_PAGE_LABEL[name])}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="stars" className={pageClass}>
          {tokenSliders(STAR_TUNER_TOKENS)}
          <label className="flex items-center justify-between">
            <span>faint</span>
            <input
              type="color"
              value={overrides[STAR_TUNER_FAINT] ?? "#8a8b8d"}
              onChange={(e) => update(STAR_TUNER_FAINT, e.target.value)}
              onDoubleClick={() => update(STAR_TUNER_FAINT, null)}
            />
          </label>
          {resetButton([...STAR_TUNER_TOKENS.map(([name]) => name), STAR_TUNER_FAINT])}
        </TabsContent>
        <TabsContent value="planets" className={pageClass}>
          <label className="flex flex-col">
            <span className="flex justify-between">
              <span>{t("astrolabe.tuner.planetGlyphSize")}</span>
              <span className="tabular-nums">
                {planetGlyphPx ? `${planetGlyphPx} px · ` : ""}{`${planetScale.toFixed(2)}×`}
              </span>
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={planetScale}
              onChange={(e) => {
                const divisor = Math.round((PLANET_FONT_DIVISOR_BAKED / Number(e.target.value)) * 100) / 100;
                update(PLANET_FONT_DIVISOR, String(divisor));
              }}
              // Double-click restores the baked divisor.
              onDoubleClick={() => update(PLANET_FONT_DIVISOR, null)}
            />
          </label>
          {resetButton([PLANET_FONT_DIVISOR])}
        </TabsContent>
        <TabsContent value="ecliptic" className={pageClass}>
          {tokenSliders(ECLIPTIC_TUNER_TOKENS)}
          {resetButton(ECLIPTIC_TUNER_TOKENS.map(([name]) => name))}
        </TabsContent>
        <TabsContent value="sky" className={pageClass}>
          <AstrolabeSkyTuner tune={sky} onChange={onSkyChange} />
        </TabsContent>
        <TabsContent value="background" className={pageClass}>
          {observerControl}
          <AstrolabeCityTuner tune={city} projection={projection} onChange={onCityChange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Zoom pill: always in the lower right, above the bottom-right corner block.
const ZOOM_PILL_CORNER_BOTTOM_PX = 64;

function AstrolabeZoomPill({
  subscribe,
  readLevel,
  onZoom,
  onReset,
}: {
  subscribe: (listener: () => void) => () => void;
  readLevel: () => number;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const level = React.useSyncExternalStore(subscribe, readLevel, readLevel);
  const formatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  );
  const zoomed = level > 1;
  const cell = "flex size-6.5 items-center justify-center text-foreground hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent";
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("astrolabe.zoom")}
      className={`absolute right-4 z-10 flex flex-col overflow-hidden rounded-[var(--aries-radius-popover)] border border-border bg-popover/88 transition-opacity ${
        zoomed ? "opacity-100" : "opacity-35 group-hover/astrolabe:opacity-100"
      }`}
      style={{ bottom: ZOOM_PILL_CORNER_BOTTOM_PX }}
      // Keep keyboard focus on the plate so its keys keep working.
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button type="button" className={cell} aria-label={t("astrolabe.zoomIn")} title={t("astrolabe.zoomIn")}
        onClick={() => onZoom(KEY_ZOOM_STEP)}>
        <Plus className="size-3.5" />
      </button>
      <button type="button" className={`${cell} text-[length:var(--aries-font-size-small)] tabular-nums`}
        aria-label={t("astrolabe.zoomReset")} title={t("astrolabe.zoomReset")} onClick={onReset}>
        {t("astrolabe.zoomLevel", { level: formatter.format(Math.round(level * 10) / 10) })}
      </button>
      <button type="button" className={cell} aria-label={t("astrolabe.zoomOut")} title={t("astrolabe.zoomOut")}
        disabled={!zoomed} onClick={() => onZoom(1 / KEY_ZOOM_STEP)}>
        <Minus className="size-3.5" />
      </button>
    </div>
  );
}

type AstrolabeHover = { target: AstrolabeHoverTarget; width: number; left: number; top: number; token: number };

function AstrolabeHoverCaption({ hover }: { hover: AstrolabeHover }) {
  const { target, width } = hover;
  // Flip to the pointer's left near the right edge so the caption stays inside.
  const flip = target.x > width * 0.7;
  return (
    <div
      data-aries-surface="popover"
      className="pointer-events-none absolute z-20 w-max max-w-xs rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] text-[color:var(--aries-popover-text)] shadow-md ring-1 ring-foreground/10"
      style={{
        left: target.x,
        top: target.y,
        transform: flip ? "translate(calc(-100% - 10px), 10px)" : "translate(10px, 10px)",
      }}
    >
      <div className="font-medium">
        {target.name}
        {target.detail ? <span className="ml-[var(--aries-control-gap)] text-muted-foreground">{target.detail}</span> : null}
      </div>
      {target.position ? <div className="tabular-nums text-muted-foreground">{target.position}</div> : null}
    </div>
  );
}

function AstrolabeViewMenu({
  toggles,
  onToggle,
  projection,
  onProjection,
  starPick,
  onStarPick,
  earthOpacity,
  onEarthOpacity,
  eclipticStyle,
  onEclipticStyle,
  background,
  onBackground,
  backgroundOpacity,
  onBackgroundOpacity,
}: {
  toggles: LayerToggles;
  onToggle: (key: keyof LayerToggles) => void;
  projection: AstrolabeProjection;
  onProjection: (projection: AstrolabeProjection) => void;
  starPick: StarPick;
  onStarPick: (next: StarPick) => void;
  earthOpacity: number;
  onEarthOpacity: (next: number) => void;
  eclipticStyle: AstrolabeEclipticStyle;
  onEclipticStyle: (next: AstrolabeEclipticStyle) => void;
  background: StereoBackground;
  onBackground: (next: StereoBackground) => void;
  backgroundOpacity: number;
  onBackgroundOpacity: (next: number) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const degrees = new Intl.NumberFormat(locale, { style: "unit", unit: "degree", unitDisplay: "narrow" });
  const polar = projection === "polarEquidistant";
  const check = (key: keyof LayerToggles, label: string) => (
    <ContextMenuCheckboxItem
      key={key}
      checked={toggles[key]}
      closeOnClick={false}
      onCheckedChange={() => onToggle(key)}
    >
      {label}
    </ContextMenuCheckboxItem>
  );
  const plateLineItems: Array<[keyof LayerToggles, string]> = [
    ["horizonLine", t("astrolabe.horizon")],
    ["meridianLine", t("astrolabe.meridian")],
    ["equatorLine", t("astrolabe.equator")],
    ["almucantars", t("astrolabe.almucantars")],
    ["azimuths", t("astrolabe.azimuths")],
    ...(polar
      ? [
        ["declinationCircles", t("astrolabe.declinationCircles")],
        ["zodiacalHorizon", t("astrolabe.zodiacalHorizon")],
        ["zodiacalMeridian", t("astrolabe.zodiacalMeridian")],
      ] as Array<[keyof LayerToggles, string]>
      : [["hourLines", t("astrolabe.hourLines")] as [keyof LayerToggles, string]]),
  ];
  const eclipticItems: Array<[AstrolabeEclipticStyle, string]> = [
    ["scale", t("astrolabe.eclipticScale")],
    ["dividedBand", t("astrolabe.eclipticDividedBand")],
    ["line", t("astrolabe.eclipticLine")],
  ];
  const fieldItems: Array<[AstrolabeStarField, string]> = [
    ["settings", t("astrolabe.starFieldSettings")],
    ["bright", t("astrolabe.starFieldBright")],
    ["catalogue", t("astrolabe.starFieldCatalogue")],
  ];
  const labelItems: Array<[AstrolabeStarLabels, string]> = [
    ["all", t("astrolabe.starLabelsAll")],
    ["settings", t("astrolabe.starLabelsSettings")],
    ["none", t("astrolabe.starLabelsNone")],
  ];
  return (
    <ContextMenuContent className="min-w-[var(--aries-menu-context-min-width)]">
      <ContextMenuGroup>
        <ContextMenuLabel>{t("astrolabe.projection")}</ContextMenuLabel>
        <ContextMenuRadioGroup
          value={projection}
          onValueChange={(value) => onProjection(value as AstrolabeProjection)}
        >
          <ContextMenuRadioItem value="stereographic" closeOnClick={false}>
            {t("astrolabe.projectionStereographic")}
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="polarEquidistant" closeOnClick={false}>
            {t("astrolabe.projectionPolarEquidistant")}
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        {polar ? check("fullSphere", t("astrolabe.fullSphere")) : null}
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {polar ? null : check("regioHouses", t("astrolabe.houseLines"))}
        <AstrolabeHouseSystemSubmenu />
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("astrolabe.ecliptic")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={eclipticStyle}
              onValueChange={(value) => onEclipticStyle(value as AstrolabeEclipticStyle)}
            >
              {eclipticItems.map(([value, label]) => (
                <ContextMenuRadioItem key={value} value={value} closeOnClick={false}>{label}</ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            {check("zodiacWheel", t("astrolabe.zodiacRing"))}
            <ContextMenuSeparator />
            {check("terms", t("astrolabe.terms"))}
            {check("decans", t("astrolabe.decans"))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("astrolabe.plateLines")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {plateLineItems.map(([key, label]) => check(key, label))}
            {polar ? null : (
              <>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuLabel>{t("astrolabe.gridSpacing")}</ContextMenuLabel>
                  <ContextMenuRadioGroup
                    value={toggles.gridTenDegrees ? "10" : "5"}
                    onValueChange={(value) => {
                      if ((value === "10") !== toggles.gridTenDegrees) onToggle("gridTenDegrees");
                    }}
                  >
                    {[5, 10].map((step) => (
                      <ContextMenuRadioItem key={step} value={String(step)} closeOnClick={false}>
                        {degrees.format(step)}
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuGroup>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("astrolabe.fixedStars")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {check("stars", t("astrolabe.showFixedStars"))}
            {check("asterisms", t("astrolabe.asterisms"))}
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>{t("astrolabe.starField")}</ContextMenuLabel>
              <ContextMenuRadioGroup
                value={starPick.field}
                onValueChange={(value) => onStarPick({ ...starPick, field: value as AstrolabeStarField })}
              >
                {fieldItems.map(([value, label]) => (
                  <ContextMenuRadioItem key={value} value={value} closeOnClick={false}>{label}</ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>{t("astrolabe.starLabels")}</ContextMenuLabel>
              <ContextMenuRadioGroup
                value={starPick.labels}
                onValueChange={(value) => onStarPick({ ...starPick, labels: value as AstrolabeStarLabels })}
              >
                {labelItems.map(([value, label]) => (
                  <ContextMenuRadioItem key={value} value={value} closeOnClick={false}>{label}</ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <AstrolabeMarkedStarsSubmenu
              starPick={starPick}
              onStarPick={onStarPick}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t("astrolabe.skyAndEarth")}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {check("atmospheric", t("astrolabe.atmospheric"))}
            {polar ? check("earthMap", t("astrolabe.earthMap")) : null}
            {polar ? null : (
              <>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuLabel>{t("astrolabe.background")}</ContextMenuLabel>
                  <ContextMenuRadioGroup
                    value={background}
                    onValueChange={(value) => onBackground(value as StereoBackground)}
                  >
                    <ContextMenuRadioItem value="off" closeOnClick={false}>{t("astrolabe.backgroundNone")}</ContextMenuRadioItem>
                    {(Object.keys(CITY_PICTURE_LABEL) as PlatePicture[]).map((picture) => (
                      <ContextMenuRadioItem key={picture} value={picture} closeOnClick={false}>
                        {t(CITY_PICTURE_LABEL[picture])}
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuLabel>{t("astrolabe.backgroundOpacity")}</ContextMenuLabel>
                  <ContextMenuRadioGroup
                    value={String(backgroundOpacity)}
                    onValueChange={(value) => onBackgroundOpacity(Number(value))}
                  >
                    {BACKGROUND_OPACITIES.map((value) => (
                      <ContextMenuRadioItem
                        key={value}
                        value={String(value)}
                        disabled={background === "off"}
                        closeOnClick={false}
                      >
                        {percent.format(value / 100)}
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuGroup>
              </>
            )}
            <ContextMenuSeparator />
            {check("earthInFront", t("astrolabe.earthInFront"))}
            <ContextMenuGroup>
              <ContextMenuLabel>{t("astrolabe.earthOpacity")}</ContextMenuLabel>
              <ContextMenuRadioGroup
                value={String(earthOpacity)}
                onValueChange={(value) => onEarthOpacity(Number(value))}
              >
                {EARTH_OPACITIES.map((value) => (
                  <ContextMenuRadioItem key={value} value={String(value)} closeOnClick={false}>
                    {value === 1 ? t("astrolabe.earthOpacitySolid") : percent.format(value)}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {check("pdReprojection", t("astrolabe.pdReprojection"))}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

type MenuRadioGroup = Extract<WorkspaceContextMenuNode, { type: "radioGroup" }>;
type MenuRadio = Extract<WorkspaceContextMenuNode, { type: "radio" }>;

function findRadioGroup(nodes: readonly WorkspaceContextMenuNode[]): MenuRadioGroup | null {
  for (const node of nodes) {
    if (node.type === "radioGroup") return node;
    if (node.type === "submenu") {
      const found = findRadioGroup(node.children);
      if (found) return found;
    }
  }
  return null;
}

/** The chart menu's House System choice, served by the daemon with the same
 * radios, labels and `options.set_house_system` action as the wheel menu.
 * The recalc reaches the plate through the radix's session change. */
function AstrolabeHouseSystemSubmenu() {
  const t = useT();
  const tf = useTFallback();
  const [group, setGroup] = React.useState<MenuRadioGroup | null>(null);
  const load = React.useCallback(() => {
    void fetchHouseSystemMenu()
      .then((payload) => setGroup(findRadioGroup(payload.items)))
      .catch((err) => console.error("[astrolabe-house-system]", err));
  }, []);
  const radios = (group?.children ?? []).filter((node): node is MenuRadio => node.type === "radio");
  return (
    <ContextMenuSub onOpenChange={(open) => { if (open) load(); }}>
      <ContextMenuSubTrigger>{t("chartmenu.houseSystem")}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[var(--aries-menu-context-submenu-min-width)]">
        {group ? (
          <ContextMenuRadioGroup
            value={group.value}
            onValueChange={(value) => {
              const selected = radios.find((radio) => radio.value === value);
              if (!selected || selected.disabled || !selected.actionId) return;
              setGroup({ ...group, value });
              void executeWorkspaceContextMenuAction(selected.actionId, selected.payload)
                .then(load)
                .catch((err) => {
                  console.error("[astrolabe-house-system]", err);
                  load();
                });
            }}
          >
            {radios.map((radio) => (
              <ContextMenuRadioItem key={radio.value} value={radio.value} disabled={radio.disabled} closeOnClick={false}>
                {radio.labelKey ? tf(radio.labelKey, radio.label) : radio.label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        ) : (
          <ContextMenuItem disabled>{t("chartmenu.loading")}</ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

const STAR_SEARCH_LIMIT = 40;

/** Mark individual stars for rim leaders. Load the catalogue only when this
 * picker opens; visibility, field and name controls need no catalogue. */
function AstrolabeMarkedStarsSubmenu({
  starPick,
  onStarPick,
}: {
  starPick: StarPick;
  onStarPick: (next: StarPick) => void;
}) {
  const t = useT();
  const [stars, setStars] = React.useState<OptionsFixedStars | null>(null);
  const [query, setQuery] = React.useState("");
  const loadingRef = React.useRef(false);
  const load = React.useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    void fetchOptions()
      .then((opts) => setStars(opts.fixedStars))
      .catch((err) => {
        loadingRef.current = false;
        console.error("[astrolabe-stars]", err);
      });
  }, []);

  const byCode = React.useMemo(
    () => new Map((stars?.catalog ?? []).map((row) => [row.code, row])),
    [stars],
  );
  const settingsCodes = React.useMemo(() => stars?.selectedCodes ?? [], [stars]);
  const marked = React.useMemo(() => new Set(starPick.marked), [starPick.marked]);
  const maxSelected = stars?.maxSelected ?? 200;

  const rows = React.useMemo(() => {
    if (!stars) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) {
      const codes = [...starPick.marked, ...settingsCodes.filter((code) => !marked.has(code))];
      return codes.map((code) => byCode.get(code)).filter((row) => row != null);
    }
    return stars.catalog
      .filter((row) => row.name.toLocaleLowerCase().includes(needle)
        || row.code.toLocaleLowerCase().includes(needle))
      .slice(0, STAR_SEARCH_LIMIT);
  }, [byCode, marked, query, settingsCodes, starPick.marked, stars]);

  const toggleMarked = (code: string) => {
    const next = marked.has(code)
      ? starPick.marked.filter((c) => c !== code)
      : starPick.marked.length < maxSelected ? [...starPick.marked, code] : starPick.marked;
    onStarPick({ ...starPick, marked: next });
  };
  return (
    <ContextMenuSub onOpenChange={(open) => { if (open) load(); }}>
      <ContextMenuSubTrigger>{t("astrolabe.markedStars")}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[var(--aries-menu-context-min-width)] shadow-lg">
        <ContextMenuGroup>
          <ContextMenuLabel>{t("astrolabe.markedStars")}</ContextMenuLabel>
          <div className="px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)]">
            <Input
              value={query}
              placeholder={t("astrolabe.starsSearch")}
              aria-label={t("astrolabe.starsSearch")}
              onChange={(e) => setQuery(e.target.value)}
              // Keep typing in the field instead of the menu's typeahead.
              onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
            />
          </div>
          <div className="max-h-[min(20rem,40vh)] overflow-y-auto">
            {rows.map((row) => (
              <ContextMenuCheckboxItem
                key={row.code}
                checked={marked.has(row.code)}
                closeOnClick={false}
                onCheckedChange={() => toggleMarked(row.code)}
              >
                <span className="truncate">{row.name}</span>
                <span className="ml-auto pl-[var(--aries-control-gap)] text-muted-foreground tabular-nums">{row.lon}</span>
              </ContextMenuCheckboxItem>
            ))}
            {stars && !rows.length ? (
              <div className="px-[var(--aries-menu-item-padding-x)] py-[var(--aries-menu-item-padding-y)] text-muted-foreground">
                {t("astrolabe.starsNoMatch")}
              </div>
            ) : null}
          </div>
          <ContextMenuLabel>
            {t("astrolabe.starsSelectedCount", { count: starPick.marked.length, max: maxSelected })}
          </ContextMenuLabel>
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
