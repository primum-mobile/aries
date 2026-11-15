// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Polar azimuthal equidistant plate — A. H. Blackwell's "PA" as Gary Christen
// draws it (Symmetrical Astrology, "The Whole Sky", slides 22-26): the North
// Celestial Pole at the centre, the South Pole spread around the rim, S/MC up,
// E left. Every chart object sits at its true RA/Dec and throws a straight
// leader out through the rim's degree scale to its glyph, so the rim reading
// is the object's mundane (hour-angle) position.
//
// PARADIGM: the daemon (polar_azimuthal_service) owns the projection, the
// object universe and every colour/label; this module maps projection space
// to pixels, spreads the rim labels and paints.

import { CanvasDraw } from "@/lib/chart/canvas-draw";
import { paintAstrolabeCity, type AstrolabeCityLayer } from "./astrolabe-city";
import { astrolabeSkyLayer, prepareAstrolabeSky, type AstrolabeSkyLive, type AstrolabeSkyTune } from "./astrolabe-sky";
import {
  eclipticEngraving,
  eclipticEngravingDepth,
  eclipticSamplesFromPath,
  engraveEcliptic,
  type AstrolabeEclipticStyle,
} from "./astrolabe-ecliptic-ruler";
import { paintPdReprojection } from "./astrolabe-pd-reprojection";
import {
  markAstrolabePlanetGlyphSize,
  resolveAstrolabeStrokeWidths,
  type AstrolabeRenderStyle,
} from "@/lib/chart/astrolabe-render-style";
import type {
  AstrolabeLine,
  AstrolabeZodiacDivision,
  PolarAzimuthalEarth,
  PolarAzimuthalGeometry,
  PolarAzimuthalObject,
  PolarPath,
} from "@/lib/daemon/client";
import { createResolvedSemanticChartColorResolver } from "@/lib/theme/semantic-color";
import type { useT } from "@/lib/i18n/i18n";
import {
  drawGraduatedLimb,
  paintEarthInFront,
  insideEvenOdd,
  divisionGlyphColor,
  divisionHoverTarget,
  drawReteArcSpan,
  drawStarPointer,
  drawAsterisms,
  starHoverTarget,
  starPointerMetrics,
  starPointerInView,
  astrolabeZoomMetrics,
  astrolabeZoomDetail,
  mapPoint,
  starLabelShown,
  type StarLabelMode,
  resolveCommonRingPlate,
  zoomLayout,
  ASTROLABE_ZOOM_IDENTITY,
  pointInView,
  strokeVisibleCircle,
  traceVisiblePolyline,
  viewRect,
  type ViewRect,
  type AstrolabeHoverTarget,
  type AstrolabeReteSurface,
  type AstrolabeZoom,
  type Layout,
} from "@/components/workshell/astrolabe-canvas";

export type PolarLayerToggles = {
  zodiacWheel?: boolean;
  atmospheric: boolean;
  almucantars: boolean;
  azimuths: boolean;
  stars: boolean;
  asterisms?: boolean;
  earthMap: boolean;
  declinationCircles: boolean;
  zodiacalHorizon: boolean;
  zodiacalMeridian: boolean;
  terms?: boolean;
  decans?: boolean;
  pdReprojection?: boolean;
  /** The ground drawn over the plate at `earthOpacity` (1 = solid). */
  earthInFront?: boolean;
  /** Plate lines; drawn unless false. The meridian toggle includes the six-o'clock line. */
  horizonLine?: boolean;
  meridianLine?: boolean;
  equatorLine?: boolean;
  earthOpacity?: number;
  /** Physical sky look (design tuner); the hardcoded default when absent. */
  skyTune?: AstrolabeSkyTune | null;
  /** The live plate's part in the GPU's asynchronous sky pictures (astrolabe-sky.ts). */
  skyLive?: AstrolabeSkyLive;
};

const DEG = Math.PI / 180;

type LabelBox = { x: number; y: number; width: number; height: number };

function overlapsViewport(box: LabelBox, cssW: number, cssH: number): boolean {
  return box.x <= cssW && box.x + box.width >= 0 && box.y <= cssH && box.y + box.height >= 0;
}

/** A bounded choice of nearby placements; markers keep their true position. */
function localLabelBox(
  px: number,
  py: number,
  width: number,
  height: number,
  gap: number,
  viewport: LabelBox,
  occupied: readonly LabelBox[],
  margin: number,
): LabelBox {
  const right = px + gap;
  const left = px - gap - width;
  const below = py + gap;
  const above = py - gap - height;
  const centeredX = px - width / 2;
  const centeredY = py - height / 2;
  const sideFirst = px < viewport.x + viewport.width / 2;
  const sides = sideFirst ? [right, left] : [left, right];
  const candidates: Array<[number, number]> = [
    [sides[0], centeredY], [sides[1], centeredY],
    [centeredX, above], [centeredX, below],
    [sides[0], above], [sides[0], below], [sides[1], above], [sides[1], below],
  ];
  let best: LabelBox | null = null;
  let bestOverlap = Infinity;
  for (const [x, y] of candidates) {
    const box = {
      x: Math.max(viewport.x, Math.min(viewport.x + viewport.width - width, x)),
      y: Math.max(viewport.y, Math.min(viewport.y + viewport.height - height, y)),
      width, height,
    };
    let overlap = 0;
    for (const other of occupied) {
      overlap += Math.max(0, Math.min(box.x + width + margin, other.x + other.width)
        - Math.max(box.x - margin, other.x))
        * Math.max(0, Math.min(box.y + height + margin, other.y + other.height)
        - Math.max(box.y - margin, other.y));
    }
    if (overlap < bestOverlap) {
      best = box;
      bestOverlap = overlap;
      if (overlap === 0) break;
    }
  }
  return best!;
}

function tracePaths(ctx: CanvasRenderingContext2D, layout: Layout, paths: PolarPath[], close: boolean) {
  for (const path of paths) {
    path.forEach(([x, y], index) => {
      const [sx, sy] = mapPoint(layout, x, y);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    if (close) ctx.closePath();
  }
}

function strokePaths(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  paths: PolarPath[],
  color: string,
  width: number,
  dash?: readonly number[],
) {
  const ctx = draw.ctx;
  ctx.save();
  ctx.beginPath();
  for (const path of paths) {
    traceVisiblePolyline(ctx, path.map(([x, y]) => mapPoint(layout, x, y)), view);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  if (dash?.some((value) => value > 0)) ctx.setLineDash([...dash]);
  ctx.stroke();
  ctx.restore();
}

function strokeLine(
  draw: CanvasDraw, layout: Layout, view: ViewRect, ln: AstrolabeLine, color: string, width: number,
  dash?: readonly number[],
) {
  strokePaths(draw, layout, view, [[[ln.x1, ln.y1], [ln.x2, ln.y2]]], color, width, dash);
}

/** Screen-space polyline clipped to the view, so deep-zoom dashes stay cheap. */
function strokeScreenPolyline(
  draw: CanvasDraw,
  view: ViewRect,
  points: Array<[number, number]>,
  color: string,
  width: number,
  dash?: readonly number[],
  opacity = 1,
) {
  const ctx = draw.ctx;
  ctx.save();
  ctx.beginPath();
  traceVisiblePolyline(ctx, points, view);
  ctx.globalAlpha *= opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  if (dash?.some((value) => value > 0)) ctx.setLineDash([...dash]);
  ctx.stroke();
  ctx.restore();
}

/** The daemon samples the ecliptic in zodiacal order at one-degree intervals. */
function drawEclipticGraduations(
  draw: CanvasDraw,
  layout: Layout,
  paths: PolarPath[],
  color: string,
  fineWidth: number,
  tickStep: number,
  reteSurface?: AstrolabeReteSurface,
) {
  const ctx = draw.ctx;
  ctx.save();
  ctx.beginPath();
  let sampleIndex = 0;
  for (const path of paths) {
    const closed = path.length > 2
      && path[0][0] === path[path.length - 1][0]
      && path[0][1] === path[path.length - 1][1];
    const count = path.length - (closed ? 1 : 0);
    for (let index = 0; index < count; index++, sampleIndex++) {
      const before = path[index > 0 ? index - 1 : closed ? count - 1 : index];
      const after = path[index + 1 < count ? index + 1 : closed ? 0 : index];
      const [bx, by] = mapPoint(layout, before[0], before[1]);
      const [ax, ay] = mapPoint(layout, after[0], after[1]);
      const dx = ax - bx;
      const dy = ay - by;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.01) continue;
      const [px, py] = mapPoint(layout, path[index][0], path[index][1]);
      const halfLength = tickStep * (sampleIndex % 10 === 0 ? 1.1 : sampleIndex % 5 === 0 ? 0.7 : 0.38);
      const nx = -dy / distance * halfLength;
      const ny = dx / distance * halfLength;
      ctx.moveTo(px - nx, py - ny);
      ctx.lineTo(px + nx, py + ny);
      reteSurface?.segments.push([px - nx, py - ny, px + nx, py + ny], [px, py, ax, ay]);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.45, fineWidth * 0.65);
  ctx.stroke();
  ctx.restore();
}

type DivisionBand = {
  entries: AstrolabeZodiacDivision[];
  kind: "term" | "decan";
  outward: boolean; // terms outside the ecliptic, decans inside
  gap: number; // CSS px from the ecliptic to the box's near edge
  depth: number; // box depth, CSS px
  boundaryColor: string;
};

/** The same offset path supplies subdivision paint and continuous grab bands. */
function eclipticBandGeometry(layout: Layout, path: PolarPath, outward: boolean) {
  const points = path.map(([x, y]) => mapPoint(layout, x, y));
  const count = points.length;
  const closed = count > 2 && path[0][0] === path[count - 1][0] && path[0][1] === path[count - 1][1];
  const normals = points.map(([px, py], index): [number, number] => {
    const before = points[index > 0 ? index - 1 : closed ? count - 2 : index];
    const after = points[index + 1 < count ? index + 1 : closed ? 1 : index];
    const dx = after[0] - before[0], dy = after[1] - before[1];
    const distance = Math.hypot(dx, dy) || 1;
    const nx = -dy / distance, ny = dx / distance;
    const away = nx * (px - layout.cx) + ny * (py - layout.cy) >= 0;
    return away === outward ? [nx, ny] : [-nx, -ny];
  });
  return { points, normals };
}

function addEclipticGrabBand(
  surface: AstrolabeReteSurface,
  points: Array<[number, number]>,
  normals: Array<[number, number]>,
  near: number,
  far: number,
) {
  const middle = (near + far) / 2;
  for (let index = 1; index < points.length; index++) {
    const [ax, ay] = points[index - 1], [bx, by] = points[index];
    surface.segments.push([
      ax + normals[index - 1][0] * middle, ay + normals[index - 1][1] * middle,
      bx + normals[index][0] * middle, by + normals[index][1] * middle, (far - near) / 2, 0,
    ]);
  }
}

/** Faint closed term/decan boxes along the ecliptic path: two edges offset
 * from it, a boundary at each division and a ruler glyph fitted to its box. */
function drawEclipticDivisionBand(
  draw: CanvasDraw,
  layout: Layout,
  view: ViewRect,
  ecliptic: PolarPath[],
  band: DivisionBand,
  style: AstrolabeRenderStyle,
  width: number,
  glyphColor: (entry: AstrolabeZodiacDivision) => string,
  hoverTargets: AstrolabeHoverTarget[],
  name: string,
) {
  const ctx = draw.ctx;
  const { cx, cy } = layout;
  const side = (px: number, py: number, nx: number, ny: number): [number, number] => {
    const away = nx * (px - cx) + ny * (py - cy) >= 0;
    return away === band.outward ? [nx, ny] : [-nx, -ny];
  };
  const near = band.gap;
  const far = band.gap + band.depth;
  ctx.save();
  ctx.globalAlpha = style.layout.polarDivisionOpacity;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const path of ecliptic) {
    const { points, normals } = eclipticBandGeometry(layout, path, band.outward);
    for (const offset of [near, far]) {
      traceVisiblePolyline(ctx, points.map(([px, py], index): [number, number] => (
        [px + normals[index][0] * offset, py + normals[index][1] * offset]
      )), view);
    }
  }
  ctx.strokeStyle = style.palette.termRing;
  ctx.stroke();
  ctx.beginPath();
  for (const entry of band.entries) {
    const [px, py] = mapPoint(layout, entry.boundary.x, entry.boundary.y);
    if (!pointInView(view, px, py, far)) continue;
    const [nx, ny] = side(px, py, -(entry.boundary.ty ?? 0), entry.boundary.tx ?? 0);
    ctx.moveTo(px + nx * near, py + ny * near);
    ctx.lineTo(px + nx * far, py + ny * far);
  }
  ctx.strokeStyle = band.boundaryColor;
  ctx.stroke();
  for (const entry of band.entries) {
    const [bx, by] = mapPoint(layout, entry.boundary.x, entry.boundary.y);
    const [mx, my] = mapPoint(layout, entry.mid.x, entry.mid.y);
    const glyphSize = Math.min(band.depth, Math.hypot(mx - bx, my - by) * 2) * style.layout.divisionGlyphScale;
    if (glyphSize < style.layout.divisionGlyphMin) continue;
    const [nx, ny] = side(mx, my, -(entry.mid.ty ?? 0), entry.mid.tx ?? 0);
    const gx = mx + nx * (near + far) / 2;
    const gy = my + ny * (near + far) / 2;
    if (!pointInView(view, gx, gy, glyphSize)) continue;
    draw.text([gx, gy], entry.glyph, {
      font: style.typography.fontSymbols,
      size: glyphSize,
      fill: glyphColor(entry),
      align: "center",
      baseline: "middle",
    });
    hoverTargets.push(divisionHoverTarget(entry, band.kind, gx, gy, glyphSize, name));
  }
  ctx.restore();
}

/** Unit normal of the ecliptic path at its sample nearest (x, y), pointing
 * away from the plate centre (projection and screen axes agree). */
function eclipticNormal(paths: PolarPath[], x: number, y: number): [number, number] {
  let best: { path: PolarPath; index: number } | null = null;
  let bestDistance = Infinity;
  for (const path of paths) {
    for (let index = 0; index < path.length; index++) {
      const distance = Math.hypot(path[index][0] - x, path[index][1] - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { path, index };
      }
    }
  }
  if (!best) return [0, -1];
  const { path, index } = best;
  const before = path[Math.max(0, index - 1)];
  const after = path[Math.min(path.length - 1, index + 1)];
  const dx = after[0] - before[0];
  const dy = after[1] - before[1];
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d;
  const ny = dx / d;
  return nx * x + ny * y >= 0 ? [nx, ny] : [-nx, -ny];
}

/** Screen unit vector for a clockwise-from-top plate angle in degrees. */
function direction(angleDeg: number): [number, number] {
  return [Math.sin(angleDeg * DEG), -Math.cos(angleDeg * DEG)];
}

function wrap180(angle: number): number {
  const value = ((angle + 180) % 360 + 360) % 360 - 180;
  return value === -180 ? 180 : value;
}

type LabelRun = { text: string; symbol: boolean };

type RimItem = {
  object: PolarAzimuthalObject;
  color: string;
  runs: LabelRun[];
  size: number;
  width: number;
  height: number;
  target: number; // true hour angle, deg
  angle: number; // spread lane angle, deg
  halfSpan: number; // tangential half extent in lane degrees
};

function labelRuns(object: PolarAzimuthalObject): LabelRun[] {
  if (object.segments?.length) {
    return object.segments.map((segment) => ({ text: segment.text, symbol: segment.kind === "planet" }));
  }
  if (object.glyph) return [{ text: object.glyph, symbol: object.glyphFont !== "text" }];
  return object.label ? [{ text: object.label, symbol: false }] : [];
}

/** Keep rim labels in true order while pushing overlaps apart along the lane. */
function spreadAlongLane(items: RimItem[], iterations: number) {
  if (items.length < 2) return;
  items.sort((a, b) => a.target - b.target);
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const b = items[(i + 1) % items.length];
      let gap = b.angle - a.angle;
      if (i === items.length - 1) gap += 360;
      const need = a.halfSpan + b.halfSpan;
      if (gap < need) {
        const push = (need - gap) / 2;
        a.angle -= push;
        b.angle += push;
        moved = true;
      }
    }
    // A weak spring back toward the true angle keeps groups centred on it.
    for (const item of items) item.angle += wrap180(item.target - item.angle) * 0.02;
    if (!moved) break;
  }
}

export function renderPolarAzimuthal(
  canvas: HTMLCanvasElement,
  geo: PolarAzimuthalGeometry,
  earth: PolarAzimuthalEarth | null,
  toggles: PolarLayerToggles & {
    starLabels?: StarLabelMode; pdFocus?: string | null; city?: AstrolabeCityLayer; observers?: AstrolabeCityLayer;
    eclipticStyle?: AstrolabeEclipticStyle;
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
  const ctx = draw.ctx;

  // The limb (outermost engraved ring) sits on Aries' common chart ring, the
  // single Anglo wheel's outer zodiac ring; the plate scales as a whole.
  // Painted envelope: the object glyph lane beyond the limb.
  const limbFill = style.layout.polarRimFill + style.layout.tickStepScale * 3;
  const plate = resolveCommonRingPlate(cssW, cssH, {
    ringFill,
    limbFill,
    paintFill: limbFill + style.layout.polarLaneGapScale
      + 1.1 * style.layout.capricornFill / style.typography.planetFontDivisor,
    marginFill: style.layout.tickStepScale * 2,
    topBoundary: paintTopBoundary,
  });
  if (!plate) {
    draw.fillBackground(style.palette.background);
    return hoverTargets;
  }
  // Zoom scales plate geometry (rim, scales, projected circles). Identifying
  // symbols grow more gently; strokes and the lane gap keep their CSS size.
  const fittedRadiusPx = plate.maxRadiusPx;
  const maxRadiusPx = fittedRadiusPx * zoom.k;
  const size = fittedRadiusPx * 2;
  // Text and marker proportions share the stereographic plate's basis so the
  // two projections read at the same type size.
  const chartRpx = style.layout.capricornFill * fittedRadiusPx;
  const rimPx = style.layout.polarRimFill * maxRadiusPx;
  const layout: Layout = zoomLayout(
    { cx: cssW / 2, cy: plate.centerY, scale: style.layout.polarRimFill * fittedRadiusPx / geo.radii.rim },
    zoom,
  );
  // The physical sky first: while the GPU makes a new Sun's picture the canvas
  // keeps its previous frame, untouched (astrolabe-sky.ts).
  const skyLayer = toggles.atmospheric ? astrolabeSkyLayer(geo.atmospheric, toggles.skyTune) : null;
  const sky = skyLayer && prepareAstrolabeSky(
    ctx, layout, geo.projection, geo, geo.radii.rim, style.layout.polarRimFill * fittedRadiusPx, skyLayer, skyLive);
  if (sky === "wait") return null;
  draw.fillBackground(style.palette.background);
  const { fine: w1, medium: w2, main: wMain } = resolveAstrolabeStrokeWidths(style, size);
  const tickStep = maxRadiusPx * style.layout.tickStepScale;
  const limbOuterPx = rimPx + tickStep * 3;
  const concentric = (r: number) => r * layout.scale;
  const centre: [number, number] = [layout.cx, layout.cy];
  if (reteSurface) {
    reteSurface.center = centre;
    reteSurface.rings.push({ x: layout.cx, y: layout.cy, inner: limbOuterPx - 40, outer: limbOuterPx + 40, padding: 0 });
  }
  const view = viewRect(cssW, cssH);
  const zoomMetrics = astrolabeZoomMetrics(zoom.k, style);

  // === Plate (clipped to the rim: the south celestial pole) ===
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, rimPx, 0, Math.PI * 2);
  ctx.clip();

  // Sky and ground fill complementary regions: stacking the translucent sky
  // on the ground would darken it below the ground on light plates.
  const traceSky = (target: CanvasRenderingContext2D) => {
    if (!geo.skyContainsCenter) target.arc(layout.cx, layout.cy, rimPx, 0, Math.PI * 2);
    tracePaths(target, layout, geo.frame.horizon, true);
  };
  // The daemon's flat sky and ground at the fill opacity, then the physical
  // sky (astrolabe-sky.ts) over both as dithered grit.
  const paintSky = sky && ((target: CanvasRenderingContext2D) => sky.paint(target));
  if (toggles.atmospheric) {
    ctx.save();
    ctx.globalAlpha = style.effects.atmosphericFillOpacity;
    ctx.beginPath();
    ctx.rect(layout.cx - rimPx, layout.cy - rimPx, rimPx * 2, rimPx * 2);
    traceSky(ctx);
    ctx.fillStyle = geo.atmospheric.ground;
    ctx.fill("evenodd");
    ctx.beginPath();
    traceSky(ctx);
    ctx.fillStyle = geo.atmospheric.sky;
    ctx.fill("evenodd");
    ctx.restore();
  }
  const physicalSky = Boolean(paintSky?.(ctx));

  // Design-tuner city on the plate's earth, under the world map, lattice and
  // rete. A solid earth in front repaints it there; a lighter one is laid
  // over this same earth, so only what lies between the two fades.
  const city = toggles.city;
  const paintCity = city && ((target: CanvasRenderingContext2D) => paintAstrolabeCity(
    target, layout, geo.projection, geo, geo.radii.rim, style.layout.polarRimFill * fittedRadiusPx, city));
  const eraseCityHoles = city && ((target: CanvasRenderingContext2D) => paintAstrolabeCity(
    target, layout, geo.projection, geo, geo.radii.rim, style.layout.polarRimFill * fittedRadiusPx, city, "holes"));
  const earthOpacity = toggles.earthOpacity ?? 1;
  if (paintCity && !(toggles.earthInFront && earthOpacity >= 1)) paintCity(ctx);

  if (toggles.earthMap && earth) {
    ctx.save();
    ctx.beginPath();
    for (const line of earth.lines) {
      const points: Array<[number, number]> = [];
      for (let i = 0; i + 1 < line.length; i += 2) points.push(mapPoint(layout, line[i], line[i + 1]));
      traceVisiblePolyline(ctx, points, view);
    }
    ctx.strokeStyle = colors.earth;
    ctx.lineWidth = w1;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  if (toggles.asterisms) drawAsterisms(draw, layout, view, geo.asterisms, style, size, zoom.k, hoverTargets);

  // Declination parallels: polar circles, tropics and the equator, all on the equator toggle.
  const dash = (value: readonly [number, number]) => (toggles.atmospheric ? undefined : [...value]);
  const showHorizon = toggles.horizonLine !== false;
  const showEquator = toggles.equatorLine !== false;
  if (showEquator) {
    for (const r of [geo.radii.arctic, geo.radii.cancer, geo.radii.capricorn, geo.radii.antarctic]) {
      strokeVisibleCircle(ctx, layout.cx, layout.cy, concentric(r), view, colors.tropic, w1, dash(dashes.tropic));
    }
    strokeVisibleCircle(ctx, layout.cx, layout.cy, concentric(geo.radii.equator), view, colors.equator, w1, dash(dashes.equator));
  }

  if (toggles.almucantars) {
    for (const a of geo.frame.almucantars) {
      strokePaths(draw, layout, view, a.paths, colors.almucantar, a.alt % 20 === 0 ? w2 : w1);
    }
  }
  if (toggles.azimuths) {
    for (const az of geo.frame.azimuths) {
      strokePaths(draw, layout, view, az.paths, colors.azimuth, Math.abs(az.az) % 60 === 0 ? w2 : w1);
    }
  }

  // Meridian, six-hour line and the Asc/Dsc marks follow the stereographic
  // meridian: dashed on the schematic plate, solid over the atmospheric fill.
  const meridianDash = dash(dashes.meridian);
  if (toggles.meridianLine !== false) {
    strokeLine(draw, layout, view, geo.frame.meridian, colors.meridian, w1, meridianDash);
    strokeLine(draw, layout, view, geo.frame.sixHour, colors.meridian, w1, meridianDash);
  }
  strokePaths(draw, layout, view, geo.frame.primeVertical, colors.primeVertical, w1);
  // With the earth in front, the horizon set (horizon, its label, Asc/Dsc,
  // the Asc leader, cardinals) is drawn once, over that earth.
  const earthInFront = Boolean(toggles.earthInFront);
  if (!earthInFront && showHorizon) strokePaths(draw, layout, view, geo.frame.horizon, colors.horizon, wMain);

  const objectColor = (o: PolarAzimuthalObject): string => {
    if (o.family === "angle") return colors.horizon;
    if (o.family === "ring") return colors.star;
    const fallback = o.color ?? colors.star;
    return resolveColor(o.colorRole ?? null, fallback) ?? fallback;
  };

  if (toggles.declinationCircles) {
    for (const o of geo.objects) {
      if (o.family !== "body") continue;
      strokeVisibleCircle(ctx, layout.cx, layout.cy, concentric((90 - o.decl) / 90), view,
        objectColor(o), w1, dashes.connector, style.strokes.connectorOpacity);
    }
  }

  const divisions = geo.zodiacDivisions;
  const divisionGap = tickStep * 1.4;
  const divisionDepth = maxRadiusPx * style.layout.polarDivisionBandScale;
  // The chosen ecliptic style: a scale or divided band hanging inward from the
  // true ecliptic in place of the drawn path and its centred graduations (the
  // daemon samples one degree a sample).
  const eclipticPath = geo.ecliptic.length === 1 && geo.ecliptic[0].length >= 360 ? geo.ecliptic[0] : null;
  const engraving = eclipticPath ? eclipticEngraving(toggles.eclipticStyle, style.layout) : null;
  const engravingDepth = engraving ? eclipticEngravingDepth(engraving, tickStep) : 0;
  // Inside the ecliptic: decans and degree labels clear the engraving.
  const innerGap = engraving ? engravingDepth + tickStep * 0.6 : divisionGap;
  const innerClear = engraving ? engravingDepth : tickStep * 1.1;
  if (engraving && eclipticPath) {
    const samples = eclipticSamplesFromPath(
      eclipticPath.slice(0, 360).map(([x, y]) => mapPoint(layout, x, y)), [layout.cx, layout.cy]);
    const signOuter = toggles.terms && divisions ? divisionGap + divisionDepth : tickStep * 0.5;
    engraveEcliptic(ctx, samples, engraving, tickStep, { fine: w1, medium: w1 }, colors.ecliptic,
      { from: -signOuter, to: engravingDepth + tickStep * (engraving.kind === "scale" ? 0.5 : 1.2) });
  } else {
    strokePaths(draw, layout, view, geo.ecliptic, colors.ecliptic, w2);
    drawEclipticGraduations(draw, layout, geo.ecliptic, colors.ecliptic, w1, tickStep, reteSurface);
  }
  // Twenty CSS pixels beyond each visible division band's far edge. Keep
  // the complete glyph/label envelope too, with its own five-pixel clearance.
  let zodiacGrabInner = (toggles.decans && divisions ? innerGap + divisionDepth : innerClear) + 20;
  let zodiacGrabOuter = (toggles.terms && divisions ? divisionGap + divisionDepth : tickStep * 1.1) + 20;
  if (divisions && (toggles.terms || toggles.decans)) {
    // Clear of the ecliptic's own graduations (1.1 tick steps each side).
    const gap = divisionGap;
    const depth = divisionDepth;
    const glyphColor = (entry: AstrolabeZodiacDivision) => divisionGlyphColor(
      entry, divisions.inheritPlanetColors, colors.subdivisionGlyph, resolveColor);
    const fine = Math.max(0.45, w1 * 0.65);
    if (toggles.terms) {
      drawEclipticDivisionBand(draw, layout, view, geo.ecliptic, {
        entries: divisions.terms, kind: "term", outward: true, gap, depth, boundaryColor: colors.termBoundary,
      }, style, fine, glyphColor, hoverTargets, t("astrolabe.terms"));
    }
    if (toggles.decans) {
      drawEclipticDivisionBand(draw, layout, view, geo.ecliptic, {
        entries: divisions.decans, kind: "decan", outward: false, gap: innerGap, depth, boundaryColor: colors.decanBoundary,
      }, style, fine, glyphColor, hoverTargets, t("astrolabe.decans"));
    }
  }

  // Quiet, upright sign-start labels. Geometry and glyph choice come from the
  // daemon, so sidereal signs and directed rete arcs follow the same contract.
  if (toggles.zodiacWheel) {
    const baseSize = chartRpx / style.typography.signFontDivisor * 0.8;
    const glyphSize = baseSize * Math.min(1.8, Math.pow(zoom.k, 0.48));
    const bandEdge = toggles.terms && divisions
      ? tickStep * 1.4 + maxRadiusPx * style.layout.polarDivisionBandScale
      : engraving ? tickStep * 0.5 : tickStep * 1.1;
    const gap = bandEdge + glyphSize * 0.75;
    if (geo.zodiacSigns?.length) zodiacGrabOuter = Math.max(zodiacGrabOuter, gap + glyphSize / 2 + 5);
    ctx.save();
    ctx.globalAlpha = 0.78;
    for (const sign of geo.zodiacSigns ?? []) {
      const [px, py] = mapPoint(layout, sign.x, sign.y);
      let nx = -sign.ty, ny = sign.tx;
      if (nx * sign.x + ny * sign.y < 0) { nx *= -1; ny *= -1; }
      const gx = px + nx * gap;
      const gy = py + ny * gap;
      if (!pointInView(view, gx, gy, glyphSize)) continue;
      // The sign starts here: one continuous major tick points directly at
      // its glyph, including through the term band's shared 0° boundary.
      // A scale or divided band draws its own sign ticks.
      if (!engraving) {
        draw.line([[px - nx * tickStep * 1.1, py - ny * tickStep * 1.1],
          [px + nx * bandEdge, py + ny * bandEdge]], { fill: colors.ecliptic, width: w1, pixelSnap: false });
      }
      reteSurface?.segments.push([px - nx * tickStep * 1.1, py - ny * tickStep * 1.1,
        px + nx * bandEdge, py + ny * bandEdge]);
      reteSurface?.markers.push({ x: gx, y: gy, size: glyphSize });
      draw.text([gx, gy], sign.glyph, {
        font: style.typography.fontSymbols,
        size: glyphSize,
        fill: colors.ecliptic,
        align: "center",
        baseline: "middle",
      });
    }
    ctx.restore();
  }

  // Label sign starts on the ecliptic scale in either Zodiac ring state.
  if (zoom.k > 2) {
    const { size: numberSize, opacity } = astrolabeZoomDetail(zoom.k);
    const innerEdge = toggles.decans && divisions
      ? innerGap + maxRadiusPx * style.layout.polarDivisionBandScale
      : innerClear + (engraving ? tickStep * 0.6 : 0);
    const numberGap = innerEdge + numberSize * 0.85;
    if (geo.zodiacDegrees?.length) zodiacGrabInner = Math.max(zodiacGrabInner, numberGap + numberSize / 2 + 5);
    for (const degree of geo.zodiacDegrees ?? []) {
      if (degree.degree !== 0) continue;
      const [px, py] = mapPoint(layout, degree.x, degree.y);
      let nx = -degree.ty, ny = degree.tx;
      if (nx * degree.x + ny * degree.y < 0) { nx *= -1; ny *= -1; }
      // The inner side keeps numbers apart from sign glyphs and term rulers.
      const gx = px - nx * numberGap;
      const gy = py - ny * numberGap;
      if (!pointInView(view, gx, gy, numberSize)) continue;
      reteSurface?.markers.push({ x: gx, y: gy, size: numberSize });
      draw.text([gx, gy], degree.label, {
        font: style.typography.fontUi,
        size: numberSize,
        fill: colors.ecliptic,
        align: "center",
        baseline: "middle",
        opacity,
      });
    }
  }

  if (reteSurface) {
    // One filled drag strip for the whole assembly, including every gap
    // between the inner labels, decans, ecliptic, terms and sign glyphs.
    for (const path of geo.ecliptic) {
      const { points, normals } = eclipticBandGeometry(layout, path, true);
      addEclipticGrabBand(reteSurface, points, normals, -zodiacGrabInner, zodiacGrabOuter);
    }
  }

  // Zodiacal horizon/meridian: a point on these circles is conjunct Asc/Dsc
  // (MC/IC) by zodiacal degree, whatever its latitude.
  if (toggles.zodiacalHorizon) {
    strokePaths(draw, layout, view, geo.frame.zodiacalHorizon, colors.horizon, w1, dashes.connector);
  }
  if (toggles.zodiacalMeridian) {
    strokePaths(draw, layout, view, geo.frame.zodiacalMeridian, colors.meridian, w1, dashes.connector);
  }

  if (toggles.stars) {
    const starR = Math.max(style.markers.starRadiusMin, size / style.markers.starRadiusDivisor) * zoomMetrics.star;
    const starLabelSize = (chartRpx / style.typography.circleLabelFontDivisor) * style.layout.polarStarLabelScale
      * zoomMetrics.starLabel;
    for (const st of geo.stars) {
      const [px, py] = mapPoint(layout, st.x, st.y);
      const label = starLabelShown(toggles.starLabels, st.inSettings) ? st.starName || st.name : "";
      const metrics = starPointerMetrics(starR * 2.5, st.mag, starLabelSize, style);
      if (!starPointerInView(view, px, py, metrics, label)) continue;
      drawStarPointer(draw, px, py, starR * 2.5, st.mag, label, starLabelSize, style);
      const target = starHoverTarget({ ...st, name: st.starName || st.name, nom: st.name }, px, py, metrics.radius);
      hoverTargets.push(target);
      if (label) {
        const labelX = Math.round(px + metrics.labelOffset);
        const ink = draw.textbounds(label, { font: style.typography.fontUi, size: metrics.labelSize, baseline: "middle" });
        hoverTargets.push({ ...target, x: labelX + ink.x + ink.w / 2, y: Math.round(py) + ink.y + ink.h / 2, width: ink.w, height: ink.h });
      }
    }
  }

  // Frame points: zenith/nadir crosses, East point and the ecliptic pole.
  const labelSize = chartRpx / style.typography.circleLabelFontDivisor;
  const markR = Math.max(style.markers.sphereRadiusMin, chartRpx / style.markers.sphereRadiusDivisor);
  const framePoints: Array<[keyof PolarAzimuthalGeometry["framePoints"], string, "cross" | "dot"]> = [
    ["zenith", t("astrolabe.zenith"), "cross"],
    ["nadir", t("astrolabe.nadir"), "cross"],
    ["east", t("astrolabe.eastPoint"), "dot"],
    ["eclipticPole", t("astrolabe.eclipticPole"), "dot"],
  ];
  for (const [key, label, mark] of framePoints) {
    const [px, py] = mapPoint(layout, geo.framePoints[key].x, geo.framePoints[key].y);
    if (mark === "cross") {
      const arm = markR * 2.2;
      draw.line([[px - arm, py], [px + arm, py]], { fill: colors.horizon, width: w1 });
      draw.line([[px, py - arm], [px, py + arm]], { fill: colors.horizon, width: w1 });
    } else {
      draw.circle([px, py], markR, { fill: colors.meridian });
    }
    draw.text([px + markR * 2.6, py + markR], label, {
      size: labelSize,
      fill: colors.equatorLabel,
      align: "left",
      baseline: "top",
    });
  }

  ctx.restore(); // end rim clip

  // === Circle labels: at the topmost sample of each great circle ===
  const topmost = (paths: PolarPath[]) => {
    let best: [number, number] | null = null;
    for (const path of paths) for (const p of path) if (!best || p[1] < best[1]) best = p;
    return best;
  };
  const rightmost = (paths: PolarPath[]) => {
    let best: [number, number] | null = null;
    for (const path of paths) for (const p of path) if (!best || p[0] > best[0]) best = p;
    return best;
  };
  const horizonLabel: [string, [number, number] | null, string] = [
    t("astrolabe.horizon"), topmost(geo.frame.horizon), colors.horizon,
  ];
  const circleLabels: Array<[string, [number, number] | null, string]> = [
    ...(showEquator ? [[t("astrolabe.equator"), [0, -geo.radii.equator], colors.equatorLabel] as (typeof horizonLabel)] : []),
    ...(showHorizon ? [horizonLabel] : []),
    [t("astrolabe.ecliptic"), topmost(geo.ecliptic), colors.ecliptic],
    [t("astrolabe.primeVertical"), rightmost(geo.frame.primeVertical), colors.primeVertical],
  ];
  const circleLabel = ([text, anchor, color]: (typeof circleLabels)[number]) => {
    if (!anchor) return;
    const [lx, ly] = mapPoint(layout, anchor[0], anchor[1]);
    if (Math.hypot(lx - layout.cx, ly - layout.cy) > rimPx - labelSize) return;
    draw.text([lx + style.layout.circleLabelOffsetX, ly + style.layout.circleLabelOffsetY], text, {
      size: labelSize,
      fill: color,
      align: "left",
      baseline: "top",
    });
  };
  for (const label of circleLabels) if (!earthInFront || label !== horizonLabel) circleLabel(label);

  // === Limb: the rim is the south pole; its scale reads hour angle ===
  drawGraduatedLimb(draw, layout.cx, layout.cy, rimPx, tickStep, colors.capricorn, w1, w2, wMain);

  const cardinalSize = chartRpx / style.typography.cardinalFontDivisor;
  const cardinalR = rimPx - cardinalSize * 0.9;
  const cardinals: Array<[string, number]> = [
    [t("astrolabe.cardinalS"), 0],
    [t("astrolabe.cardinalW"), 90],
    [t("astrolabe.cardinalN"), 180],
    [t("astrolabe.cardinalE"), 270],
  ];
  const paintCardinals = () => {
    for (const [label, angle] of cardinals) {
      const [ux, uy] = direction(angle);
      draw.text([layout.cx + ux * cardinalR, layout.cy + uy * cardinalR], label, {
        size: cardinalSize,
        fill: colors.cardinal,
        align: "center",
        baseline: "middle",
      });
    }
  };
  if (!earthInFront) paintCardinals();

  // === Objects: marker at true RA/Dec, leader out through the rim scale ===
  const baseGlyphSize = chartRpx / style.typography.planetFontDivisor;
  markAstrolabePlanetGlyphSize(canvas, baseGlyphSize);
  const glyphSize = baseGlyphSize * zoomMetrics.glyph;
  const ringSize = baseGlyphSize * style.layout.polarRingFontScale * zoomMetrics.starLabel;
  const laneGap = fittedRadiusPx * style.layout.polarLaneGapScale;
  const laneInner = limbOuterPx + laneGap;
  const outerGrabBand = reteSurface?.rings[0];
  if (outerGrabBand) {
    // Include at least a glyph radius inward and the whole outer glyph lane.
    outerGrabBand.inner = Math.min(outerGrabBand.inner, rimPx - glyphSize / 2 - 5);
    outerGrabBand.outer = Math.max(outerGrabBand.outer, laneInner + glyphSize / 2 + 5);
  }
  const baseSphereR = Math.max(style.markers.sphereRadiusMin, chartRpx / style.markers.sphereRadiusDivisor);
  const sphereR = baseSphereR * zoomMetrics.sphere;
  const ringSphereR = baseSphereR * 0.7 * zoomMetrics.star;

  const measureRuns = (runs: LabelRun[], sizePx: number) => {
    let width = 0;
    for (const run of runs) {
      width += draw.textsize(run.text, {
        font: run.symbol ? style.typography.fontSymbols : style.typography.fontUi,
        size: sizePx,
      })[0];
    }
    return width;
  };

  // Asc/Dsc: a line perpendicular to the ecliptic path, drawn like the
  // meridian, across the term (outside) and decan (inside) marks so the rising
  // degree, term and decan read along it. MC/IC keep their cross.
  const horizonReach = (outward: boolean) => (!outward && engraving
    ? (toggles.decans && geo.zodiacDivisions ? innerGap + divisionDepth : engravingDepth) + tickStep * 0.6
    : tickStep * 1.7 + (
      (outward ? toggles.terms : toggles.decans) && geo.zodiacDivisions
        ? tickStep * 1.4 + maxRadiusPx * style.layout.polarDivisionBandScale : 0));
  const drawHorizonAngle = (object: PolarAzimuthalObject, px: number, py: number) => {
    const [nx, ny] = eclipticNormal(geo.ecliptic, object.x, object.y);
    const out = horizonReach(true);
    const inward = horizonReach(false);
    strokeScreenPolyline(draw, view, [[px - nx * inward, py - ny * inward], [px + nx * out, py + ny * out]],
      colors.meridian, w1, meridianDash);
  };
  // Asc/Dsc lie on the horizon, with the Asc's leader to its rim title.
  const horizonAngles: Array<() => void> = [];
  const onHorizon = (paint: () => void) => (earthInFront ? horizonAngles.push(paint) : paint());
  const drawAngleMarker = (object: PolarAzimuthalObject, px: number, py: number, color: string) => {
    if (object.id === "angle:asc" || object.id === "angle:dsc") onHorizon(() => drawHorizonAngle(object, px, py));
    else drawAngleCross(px, py, color);
  };

  const drawAngleCross = (px: number, py: number, color: string) => {
    const arm = baseSphereR * 1.8;
    draw.line([[px - arm, py], [px + arm, py]], { fill: color, width: w2 });
    draw.line([[px, py - arm], [px, py + arm]], { fill: color, width: w2 });
  };

  const objectInspector = (object: PolarAzimuthalObject): AstrolabeHoverTarget["inspector"] => (
    object.starCode && object.longitude != null
      ? { kind: "fixed_star", code: object.starCode, longitude: object.longitude }
      : object.bodyId != null ? { kind: "planet", seId: object.bodyId }
      : object.id === "point:fortune" && object.longitude != null
        ? { kind: "fortune", longitude: object.longitude } : undefined
  );
  const markerRadius = (object: PolarAzimuthalObject) => (
    object.family === "angle" ? baseSphereR * 1.8
      : object.family === "ring" ? ringSphereR
        : object.isSun ? sphereR * style.markers.sunSphereScale : sphereR
  );
  const occupied: LabelBox[] = [];
  for (const object of geo.objects) {
    const [px, py] = mapPoint(layout, object.x, object.y);
    const radius = markerRadius(object);
    if (pointInView(view, px, py, radius)) {
      occupied.push({ x: px - radius, y: py - radius, width: radius * 2, height: radius * 2 });
    }
    if (object.hoverName) hoverTargets.push({ x: px, y: py, width: radius * 2, height: radius * 2,
      name: object.hoverName, position: object.hoverPosition, inspector: objectInspector(object) });
  }

  const items: RimItem[] = [];
  for (const object of geo.objects) {
    const runs = labelRuns(object);
    if (!runs.length) {
      // Dsc/IC: the cross on the ecliptic, no rim label (Christen labels As/MC).
      if (object.family === "angle") {
        const [px, py] = mapPoint(layout, object.x, object.y);
        drawAngleMarker(object, px, py, objectColor(object));
      }
      continue;
    }
    const textRuns = runs.every((run) => !run.symbol);
    const sizePx = object.family === "angle"
      ? baseGlyphSize * style.layout.polarAngleFontScale * zoomMetrics.houseNumber
      : object.family === "ring" || textRuns ? ringSize : glyphSize;
    const width = measureRuns(runs, sizePx);
    const height = sizePx;
    const [ux, uy] = direction(object.ha);
    // Tangential extent of an upright label at this lane angle.
    const tangential = Math.abs(ux) * height + Math.abs(uy) * width;
    items.push({
      object,
      color: objectColor(object),
      runs,
      size: sizePx,
      width,
      height,
      target: object.ha,
      angle: object.ha,
      halfSpan: (tangential / 2 + laneGap / 2) / (laneInner * DEG),
    });
  }
  spreadAlongLane(items, style.collision.iterations * 4);

  const localLabels: Array<{ item: RimItem; px: number; py: number }> = [];
  let ascTip: { object: PolarAzimuthalObject; x: number; y: number; nx: number; ny: number } | null = null;
  for (const item of items) {
    const { object } = item;
    const [px, py] = mapPoint(layout, object.x, object.y);
    const [tx, ty] = direction(object.ha);
    const [lx, ly] = direction(item.angle);
    const rim: [number, number] = [layout.cx + tx * rimPx, layout.cy + ty * rimPx];
    const limb: [number, number] = [layout.cx + tx * limbOuterPx, layout.cy + ty * limbOuterPx];
    const lane: [number, number] = [layout.cx + lx * laneInner, layout.cy + ly * laneInner];
    const leader = () => strokeScreenPolyline(draw, view, [[px, py], rim, limb, lane], item.color, w1,
      dashes.connector, style.layout.polarLeaderOpacity);
    if (object.id === "angle:asc") onHorizon(leader);
    else leader();

    if (object.family === "angle") {
      drawAngleMarker(object, px, py, item.color);
    } else if (object.isSun) {
      draw.circle([px, py], sphereR * style.markers.sunSphereScale, {
        fill: colors.sunFill,
        outline: colors.ecliptic,
        width: style.strokes.sphereOutlineWidth,
      });
    } else {
      const r = markerRadius(object);
      draw.circle([px, py], r, object.above
        ? { fill: item.color, outline: item.color, width: style.strokes.sphereOutlineWidth }
        : { outline: item.color, width: style.strokes.sphereOutlineWidth });
    }

    // Upright label just outside the lane: centred at top/bottom, growing
    // outward on the east and west flanks.
    const flank = Math.abs(lx) > 0.35;
    const labelR = laneInner + (flank ? item.size * 0.15 : item.height * 0.6);
    let x = layout.cx + lx * labelR;
    const y = layout.cy + ly * labelR;
    if (flank && lx < 0) x -= item.width;
    else if (!flank) x -= item.width / 2;
    const rimBox = { x, y: y - item.height / 2, width: item.width, height: item.height };
    if (outerGrabBand) {
      for (const bx of [rimBox.x, rimBox.x + rimBox.width]) {
        for (const by of [rimBox.y, rimBox.y + rimBox.height]) {
          outerGrabBand.outer = Math.max(outerGrabBand.outer, Math.hypot(bx - layout.cx, by - layout.cy) + 5);
        }
      }
    }
    if (!overlapsViewport(rimBox, cssW, cssH)) {
      // Deep zoom often leaves the true marker visible while its identification
      // on the distant rim is outside the window. Keep the same daemon glyph
      // beside that marker until any part of the rim label returns into view.
      if (zoom.k > 1 && (object.family === "body" || object.family === "point")
        && pointInView(viewRect(cssW, cssH, 0), px, py, markerRadius(object))) {
        localLabels.push({ item, px, py });
      } else if (zoom.k > 1 && object.id === "angle:asc") {
        // The rim Asc is out of view: name the rising degree in the frame
        // points' signal colour, continuing its marker line past the outer tip.
        const [nx, ny] = eclipticNormal(geo.ecliptic, object.x, object.y);
        const reach = horizonReach(true);
        if (pointInView(viewRect(cssW, cssH, 0), px + nx * reach, py + ny * reach, 0)) {
          ascTip = { object, x: px + nx * reach, y: py + ny * reach, nx, ny };
        }
      }
      continue;
    }
    occupied.push(rimBox);
    if (object.hoverName) hoverTargets.push({
      x: x + item.width / 2, y, width: item.width, height: item.height,
      name: object.hoverName, position: object.hoverPosition, inspector: objectInspector(object),
    });
    for (const run of item.runs) {
      const font = run.symbol ? style.typography.fontSymbols : style.typography.fontUi;
      draw.text([x, y], run.text, {
        font,
        size: item.size,
        fill: item.color,
        align: "left",
        baseline: "middle",
      });
      x += draw.textsize(run.text, { font, size: item.size })[0];
    }
  }

  const inset = Math.max(wMain * 2, style.layout.circleLabelOffsetX);
  const localViewport = {
    x: inset, y: Math.max(0, paintTopBoundary) + inset,
    width: Math.max(0, cssW - inset * 2),
    height: Math.max(0, cssH - Math.max(0, paintTopBoundary) - inset * 2),
  };
  for (const { item, px, py } of localLabels) {
    let advance = 0;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    const runs = item.runs.map((run) => {
      const font = run.symbol ? style.typography.fontSymbols : style.typography.fontUi;
      const ink = draw.textbounds(run.text, { font, size: item.size, baseline: "middle" });
      const offset = advance;
      left = Math.min(left, offset + ink.x); right = Math.max(right, offset + ink.x + ink.w);
      top = Math.min(top, ink.y); bottom = Math.max(bottom, ink.y + ink.h);
      advance += draw.textsize(run.text, { font, size: item.size })[0];
      return { ...run, font, offset };
    });
    const gap = markerRadius(item.object) + chartRpx * style.layout.bodyLabelPadScale;
    const box = localLabelBox(px, py, right - left, bottom - top, gap, localViewport,
      occupied, item.size * style.collision.marginScale);
    const originX = Math.round(box.x - left);
    const originY = Math.round(box.y - top);
    const painted = { x: originX + left, y: originY + top, width: box.width, height: box.height };
    occupied.push(painted);
    for (const run of runs) {
      draw.text([originX + run.offset, originY], run.text, {
        font: run.font, size: item.size, fill: item.color, align: "left", baseline: "middle",
      });
    }
    if (item.object.hoverName) hoverTargets.push({
      x: painted.x + painted.width / 2, y: painted.y + painted.height / 2,
      width: painted.width, height: painted.height,
      name: item.object.hoverName, position: item.object.hoverPosition, inspector: objectInspector(item.object),
    });
  }

  // Earth in front (optional): the ground and the picture standing on it
  // cover everything below the horizon inside the limb's rule, markers and
  // leaders included; the horizon, its label, the Asc/Dsc on it and the
  // cardinals stay on top, and the zoomed Asc's end label follows.
  if (earthInFront) {
    if (reteSurface && earthOpacity >= 1) {
      const discR = rimPx - wMain / 2;
      const horizon = geo.frame.horizon.map((path) => path.map(([px, py]) => mapPoint(layout, px, py)));
      reteSurface.ground = (x, y) => Math.hypot(x - layout.cx, y - layout.cy) <= discR
        && insideEvenOdd(horizon, x, y) !== geo.skyContainsCenter;
    }
    paintEarthInFront(ctx, { cx: layout.cx, cy: layout.cy, r: rimPx - wMain / 2 }, traceSky,
      {
        background: colors.background,
        ground: toggles.atmospheric ? geo.atmospheric.ground : undefined,
        groundOpacity: style.effects.atmosphericFillOpacity,
        paintGround: physicalSky && paintSky ? (target) => void paintSky(target) : undefined,
      },
      earthOpacity,
      paintCity,
      eraseCityHoles);
    ctx.save();
    ctx.beginPath();
    ctx.arc(layout.cx, layout.cy, rimPx, 0, Math.PI * 2);
    ctx.clip();
    if (showHorizon) strokePaths(draw, layout, view, geo.frame.horizon, colors.horizon, wMain);
    ctx.restore();
    if (showHorizon) circleLabel(horizonLabel);
    for (const paint of horizonAngles) paint();
    paintCardinals();
  }

  if (ascTip) {
    // Upright end label: it starts a small gap beyond the tip and grows away
    // from the line, centred on the line's axis, like the frame-point labels.
    const text = t("astrolabe.ascendant");
    const ink = draw.textbounds(text, { font: style.typography.fontUi, size: labelSize, baseline: "middle" });
    const gap = labelSize * 0.4;
    const ex = ascTip.x + ascTip.nx * gap;
    const ey = ascTip.y + ascTip.ny * gap;
    // Horizontal-ish lines extend sideways; steep ones put the text above/below.
    const sideways = Math.abs(ascTip.nx) >= Math.abs(ascTip.ny) * 0.5;
    const left = sideways ? (ascTip.nx < 0 ? ex - ink.w : ex) : ex - ink.w / 2;
    const top = sideways ? ey - ink.h / 2 : (ascTip.ny < 0 ? ey - ink.h : ey);
    const originX = Math.round(left - ink.x);
    const originY = Math.round(top - ink.y);
    draw.text([originX, originY], text, {
      font: style.typography.fontUi, size: labelSize, fill: colors.equatorLabel, align: "left", baseline: "middle",
    });
    if (ascTip.object.hoverName) hoverTargets.push({
      x: left + ink.w / 2, y: top + ink.h / 2, width: ink.w, height: ink.h,
      name: ascTip.object.hoverName, position: ascTip.object.hoverPosition,
    });
  }

  if (toggles.pdReprojection) paintPdReprojection(draw, geo, layout, view, style, sphereR, w1, hoverTargets,
    reteSurface, t, resolveColor, zoom.k, toggles.pdFocus ?? null, glyphSize);
  draw.circle(centre, Math.max(style.markers.sphereRadiusMin, wMain * 1.5), {
    fill: colors.background,
    outline: colors.capricorn,
    width: w1,
  });

  drawReteArcSpan(draw, layout.cx, layout.cy, rimPx, tickStep, geo.infoLabel.deltaDeg, geo.infoLabel.arc,
    labelSize, colors.meridian, w2);
  if (toggles.observers) paintAstrolabeCity(ctx, layout, geo.projection, geo,
    geo.radii.rim, style.layout.polarRimFill * fittedRadiusPx, toggles.observers);
  return hoverTargets;
}
