// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasDraw, polar, type LineOpts } from "./canvas-draw";
import { signGlyph } from "./glyphs";
import type {
  Chart,
  ChartPalette,
  ChartRenderSnapshot,
  InterChartAspectKey,
} from "./types";
import {
  resolveWheelLinePaint,
  resolveWheelOverlayMetrics,
  resolveWheelTypographyPaint,
  type WheelTypographyProfile,
  type WheelRenderStyle,
} from "./wheel-render-style";

export type MultiwheelZodiacPosition = "rim" | "centre";
export type MultiwheelBand = Readonly<{ inner: number; outer: number }>;

export interface MultiwheelLayout {
  readonly maxRadius: number;
  readonly hubRadius: number;
  readonly ringBands: readonly MultiwheelBand[];
  readonly zodiacBand: MultiwheelBand;
  readonly termBand: MultiwheelBand | null;
  readonly decanBand: MultiwheelBand | null;
  readonly glyphSize: number;
  readonly positionSize: number;
  readonly houseSize: number;
  readonly frameWidth: number;
}

export interface MultiwheelLayoutInput {
  maxRadius: number;
  ringCount: number;
  ringZodiac: MultiwheelZodiacPosition;
  bodiesPerRing?: readonly number[];
  showTerms?: boolean;
  showDecans?: boolean;
}

export interface MultiwheelViewport {
  readonly width: number;
  readonly height: number;
  readonly topBoundary: number;
}

const clamp = (value: number, low: number, high: number) => (
  Math.max(low, Math.min(high, value))
);

type MultiwheelBodyStackDepths = Readonly<{
  glyph: number;
  degree: number;
  sign: number;
  minute: number;
}>;

type MultiwheelBodyStackLanes = Readonly<{
  glyphRadius: number;
  degreeRadius: number;
  signRadius: number;
  minuteRadius: number;
}>;

const multiwheelEndpointKey = (ringIndex: number, endpoint: InterChartAspectKey) => (
  `${ringIndex}:${endpoint}`
);

type MultiwheelConjunctionContact = Readonly<{
  orb: number;
  maxOrb: number;
}>;
type MultiwheelConjunctionFoot = ReadonlyMap<number, MultiwheelConjunctionContact>;

function resolveMultiwheelConjunctionFeet(
  snapshot: ChartRenderSnapshot,
): ReadonlyMap<string, MultiwheelConjunctionFoot> {
  const byBody = new Map<string, Map<number, MultiwheelConjunctionContact>>();
  const retain = (
    key: string,
    counterpartRing: number,
    orb: number,
    maxOrb: number,
  ) => {
    const byRing = byBody.get(key) ?? new Map<number, MultiwheelConjunctionContact>();
    const previous = byRing.get(counterpartRing);
    const previousRatio = previous ? previous.orb / previous.maxOrb : Number.POSITIVE_INFINITY;
    if (orb / maxOrb < previousRatio) byRing.set(counterpartRing, { orb, maxOrb });
    byBody.set(key, byRing);
  };
  for (const conjunction of snapshot.multiwheelConjunctions ?? []) {
    retain(
      multiwheelEndpointKey(conjunction.innerRing, conjunction.inner),
      conjunction.outerRing,
      conjunction.orb,
      conjunction.maxOrb,
    );
    retain(
      multiwheelEndpointKey(conjunction.outerRing, conjunction.outer),
      conjunction.innerRing,
      conjunction.orb,
      conjunction.maxOrb,
    );
  }
  return byBody;
}

function resolveMultiwheelConjunctionFootWidth(
  conjunction: MultiwheelConjunctionFoot,
): number {
  let width = 1;
  for (const contact of conjunction.values()) {
    const proximity = clamp(1 - contact.orb / contact.maxOrb, 0, 1);
    width += proximity * proximity * (3 - 2 * proximity);
  }
  return width;
}

/** Pack one shared body column inward using measured ink instead of band ratios. */
function resolveMultiwheelBodyStackLanes(
  band: MultiwheelBand,
  depths: MultiwheelBodyStackDepths,
  houseSize: number,
): MultiwheelBodyStackLanes {
  const bandThickness = band.outer - band.inner;
  const outerClearance = clamp(houseSize * 1.15, 8, 11);
  const innerClearance = 3;
  const preferredBodyGap = 3;
  const preferredPositionGap = 1;
  const inkDepth = depths.glyph + depths.degree + depths.sign + depths.minute;
  const positionDepths = [depths.degree, depths.sign, depths.minute]
    .filter((depth) => depth > 0);
  const gapBudget = Math.max(
    0,
    bandThickness - outerClearance - innerClearance - inkDepth,
  );
  const preferredGapTotal = positionDepths.length
    ? preferredBodyGap + preferredPositionGap * (positionDepths.length - 1)
    : 0;
  const gapScale = preferredGapTotal
    ? Math.min(1, gapBudget / preferredGapTotal)
    : 0;
  const bodyGap = preferredBodyGap * gapScale;
  const positionGap = preferredPositionGap * gapScale;

  const glyphRadius = band.outer - outerClearance - depths.glyph / 2;
  let cursor = glyphRadius - depths.glyph / 2;
  let visibleRowIndex = 0;
  const placeRow = (depth: number) => {
    if (depth <= 0) return glyphRadius;
    cursor -= visibleRowIndex === 0 ? bodyGap : positionGap;
    cursor -= depth / 2;
    const radius = cursor;
    cursor -= depth / 2;
    visibleRowIndex += 1;
    return radius;
  };
  const degreeRadius = placeRow(depths.degree);
  const signRadius = placeRow(depths.sign);
  const minuteRadius = placeRow(depths.minute);

  return { glyphRadius, degreeRadius, signRadius, minuteRadius };
}

/** Solve the independent multi-wheel stack from the space its contents need. */
export function resolveMultiwheelLayout(input: MultiwheelLayoutInput): MultiwheelLayout {
  const maxRadius = Math.max(80, input.maxRadius);
  const ringCount = clamp(Math.round(input.ringCount), 3, 4);
  const rim = maxRadius - Math.max(3, maxRadius * 0.01);
  const zodiacThickness = clamp(maxRadius * 0.052, 18, 26);
  const termThickness = input.showTerms ? clamp(maxRadius * 0.026, 8, 13) : 0;
  const decanThickness = input.showDecans ? clamp(maxRadius * 0.026, 8, 13) : 0;
  const decorationThickness = zodiacThickness + termThickness + decanThickness;
  const minimumHub = clamp(maxRadius * 0.09, 26, 42);
  const availableForRings = rim - decorationThickness - minimumHub;
  const bandThickness = Math.max(36, availableForRings / ringCount);
  const hubRadius = Math.max(28, rim - decorationThickness - bandThickness * ringCount);

  let bodyInner = hubRadius;
  let bodyOuter = rim - decorationThickness;
  let zodiacBand: MultiwheelBand;
  let termBand: MultiwheelBand | null = null;
  let decanBand: MultiwheelBand | null = null;

  if (input.ringZodiac === "centre") {
    zodiacBand = { inner: hubRadius, outer: hubRadius + zodiacThickness };
    let cursor = zodiacBand.outer;
    if (termThickness) {
      termBand = { inner: cursor, outer: cursor + termThickness };
      cursor = termBand.outer;
    }
    if (decanThickness) {
      decanBand = { inner: cursor, outer: cursor + decanThickness };
      cursor = decanBand.outer;
    }
    bodyInner = cursor;
    bodyOuter = rim;
  } else {
    zodiacBand = { inner: rim - zodiacThickness, outer: rim };
    let cursor = zodiacBand.inner;
    if (termThickness) {
      termBand = { inner: cursor - termThickness, outer: cursor };
      cursor = termBand.inner;
    }
    if (decanThickness) {
      decanBand = { inner: cursor - decanThickness, outer: cursor };
      cursor = decanBand.inner;
    }
    bodyOuter = cursor;
  }

  const resolvedBandThickness = (bodyOuter - bodyInner) / ringCount;
  const ringBands = Array.from({ length: ringCount }, (_, index) => ({
    inner: bodyInner + index * resolvedBandThickness,
    outer: bodyInner + (index + 1) * resolvedBandThickness,
  }));
  const innerBodyRadius = (ringBands[0].inner + ringBands[0].outer) / 2;
  const maxBodies = Math.max(1, ...(input.bodiesPerRing ?? [14]));
  const angularCeiling = (Math.PI * 2 * innerBodyRadius) / (maxBodies * 1.35);
  const radialCeiling = resolvedBandThickness * 0.26;
  const glyphSize = clamp(Math.min(radialCeiling, angularCeiling), 12, 21);
  const positionSize = clamp(glyphSize * 0.56, 8, 10);

  return Object.freeze({
    maxRadius,
    hubRadius: input.ringZodiac === "centre" ? hubRadius : ringBands[0].inner,
    ringBands: Object.freeze(ringBands.map((band) => Object.freeze({ ...band }))),
    zodiacBand: Object.freeze(zodiacBand),
    termBand: termBand ? Object.freeze(termBand) : null,
    decanBand: decanBand ? Object.freeze(decanBand) : null,
    glyphSize,
    positionSize,
    houseSize: clamp(positionSize * 0.82, 7, 10),
    frameWidth: maxRadius >= 300 ? 1.15 : 0.85,
  });
}

type Body = {
  longitude: number;
  glyph: string;
  glyphFont: "text" | "morinus";
  glyphScale: number;
  color: string;
  degText: string;
  minText: string;
  motion: string;
  hover: MultiwheelHoverBody;
};

type MultiwheelHoverBody =
  | {
      kind: "planet";
      planetId: Chart["planets"][number]["id"];
      seId: number;
      longitude: number;
      latitude: number;
      speed: number;
      house?: number;
      dignity?: Chart["planets"][number]["dignity"];
    }
  | { kind: "fortune"; longitude: number }
  | { kind: "vertex"; longitude: number; house?: number }
  | { kind: "syzygy"; longitude: number; house?: number; label?: string }
  | { kind: "eclipse"; longitude: number; house?: number; label?: string };

type MultiwheelHitIdentity = {
  x: number;
  y: number;
  r: number;
  ringIndex: number;
  chartRole: "primary" | "outer";
};

export type MultiwheelHitRegion =
  | (MultiwheelHoverBody & MultiwheelHitIdentity)
  | ({
      kind: "angle";
      angleId: "asc" | "mc" | "dsc" | "ic";
      longitude: number;
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      tolerance: number;
    } & MultiwheelHitIdentity);

function multiwheelHoverAspectKey(hover: MultiwheelHoverBody): InterChartAspectKey {
  if (hover.kind === "planet") return hover.planetId;
  return hover.kind;
}

const normalized = (value: number) => ((value % 360) + 360) % 360;
const forwardGap = (from: number, to: number) => normalized(to - from);

function chartBodies(chart: Chart, palette: ChartPalette): Body[] {
  const bodies: Body[] = chart.planets.map((planet) => ({
    longitude: planet.longitude,
    glyph: planet.glyph ?? "",
    glyphFont: "morinus",
    glyphScale: 1,
    color: planet.color ?? palette.peregrin,
    degText: planet.degText ?? String(Math.floor(normalized(planet.longitude) % 30)),
    minText: planet.minText ?? "",
    motion: planet.motion ?? "",
    hover: {
      kind: "planet",
      planetId: planet.id,
      seId: planet.seId,
      longitude: planet.longitude,
      latitude: planet.latitude,
      speed: planet.speed,
      house: planet.house,
      dignity: planet.dignity,
    },
  }));
  const append = (point: {
    longitude: number;
    glyph?: string;
    color?: string;
    degText?: string;
    minText?: string;
    glyphFont?: "text" | "morinus";
  } | undefined,
  fallbackGlyph: string,
  fallbackColor: string,
  hover: MultiwheelHoverBody,
  glyphScale = 1,
  fallbackFont: "text" | "morinus" = "morinus",
  ) => {
    if (!point?.glyph && !fallbackGlyph) return;
    bodies.push({
      longitude: point?.longitude ?? 0,
      glyph: point?.glyph ?? fallbackGlyph,
      glyphFont: point?.glyphFont ?? fallbackFont,
      glyphScale,
      color: point?.color ?? fallbackColor,
      degText: point?.degText ?? String(Math.floor(normalized(point?.longitude ?? 0) % 30)),
      minText: point?.minText ?? "",
      motion: "",
      hover,
    });
  };
  if (chart.options.showLoF !== false && chart.fortune) {
    append(chart.fortune, "4", palette.fortune, {
      kind: "fortune",
      longitude: chart.fortune.longitude,
    }, 1, "morinus");
  }
  if (chart.options.showVertex !== false && chart.vertex) {
    append(chart.vertex, "!", palette.peregrin, {
      kind: "vertex",
      longitude: chart.vertex.longitude,
      house: chart.vertex.house,
    }, 1, "morinus");
  }
  const eclipseVisible = chart.options.showPrenatalEclipse ? chart.eclipse : undefined;
  if (chart.options.showPrenatalSyzygy && !eclipseVisible?.coincidesWithSyzygy) {
    if (chart.syzygy) {
      append(chart.syzygy, "Sy", palette.signs, {
        kind: "syzygy",
        longitude: chart.syzygy.longitude,
        house: chart.syzygy.house,
        label: chart.syzygy.label,
      }, 0.58, "text");
    }
  }
  if (eclipseVisible) {
    append(eclipseVisible, "Ec", palette.signs, {
      kind: "eclipse",
      longitude: eclipseVisible.longitude,
      house: eclipseVisible.house,
      label: eclipseVisible.label,
    }, 0.58, "text");
  }
  return bodies.filter((body) => body.glyph);
}

/** Ordered circular relaxation with the largest real gap used as the seam. */
function spreadLongitudes(longitudes: readonly number[], minimumGap: number): number[] {
  if (longitudes.length < 2 || minimumGap * longitudes.length >= 358) {
    return longitudes.map(normalized);
  }
  const sorted = longitudes
    .map((longitude, index) => ({ longitude: normalized(longitude), index }))
    .sort((a, b) => a.longitude - b.longitude);
  let seam = 0;
  let largestGap = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    const next = (index + 1) % sorted.length;
    const gap = forwardGap(sorted[index].longitude, sorted[next].longitude);
    if (gap > largestGap) {
      largestGap = gap;
      seam = next;
    }
  }
  const ordered = [...sorted.slice(seam), ...sorted.slice(0, seam)];
  const truth = ordered.map((entry, index) => {
    const value = entry.longitude;
    return index && value < ordered[0].longitude ? value + 360 : value;
  });
  const positions = [...truth];
  for (let pass = 0; pass < 12; pass += 1) {
    for (let index = 1; index < positions.length; index += 1) {
      const shortfall = minimumGap - (positions[index] - positions[index - 1]);
      if (shortfall > 0) {
        positions[index - 1] -= shortfall / 2;
        positions[index] += shortfall / 2;
      }
    }
  }
  const meanShift = positions.reduce((sum, value, index) => sum + value - truth[index], 0)
    / positions.length;
  const result = Array(longitudes.length).fill(0) as number[];
  ordered.forEach((entry, index) => {
    result[entry.index] = normalized(positions[index] - meanShift);
  });
  return result;
}

function drawAnnulusFrame(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  color: string,
  width: number,
) {
  draw.circle(center, band.inner, { outline: color, width });
  draw.circle(center, band.outer, { outline: color, width });
}

function drawRadialLine(
  draw: CanvasDraw,
  center: [number, number],
  inner: number,
  outer: number,
  longitude: number,
  asc: number,
  color: string,
  width: number,
  opacity = 1,
) {
  draw.line([polar(center, inner, longitude, asc), polar(center, outer, longitude, asc)], {
    fill: color,
    width,
    opacity,
  });
}

function resolveMultiwheelBodyFootLength(
  band: MultiwheelBand,
  layout: MultiwheelLayout,
  style: WheelRenderStyle,
): number {
  const bandLimit = Math.max(4, (band.outer - band.inner) * 0.18);
  return clamp(
    style.geometry.anglo.leaderInsetScale * layout.maxRadius,
    4,
    Math.min(7, bandLimit),
  );
}

function drawMultiwheelBodyFoot(
  draw: CanvasDraw,
  center: [number, number],
  edgeRadius: number,
  direction: -1 | 1,
  footLength: number,
  trueLongitude: number,
  rootAsc: number,
  paint: LineOpts,
) {
  draw.line(
    [
      polar(center, edgeRadius, trueLongitude, rootAsc),
      polar(center, edgeRadius + direction * footLength, trueLongitude, rootAsc),
    ],
    paint,
  );
}

const MULTIWHEEL_ANGLE_ENTRIES = (
  chart: Chart,
): readonly Readonly<{
  angleId: "asc" | "mc" | "dsc" | "ic";
  label?: "AC" | "MC";
  longitude: number;
}>[] => [
  { angleId: "asc", label: "AC", longitude: chart.angles.asc },
  { angleId: "dsc", longitude: chart.angles.dsc },
  { angleId: "mc", label: "MC", longitude: chart.angles.mc },
  { angleId: "ic", longitude: chart.angles.ic },
];

function drawMultiwheelAngleArrowhead(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  longitude: number,
  rootAsc: number,
  rayWidth: number,
  style: WheelRenderStyle,
) {
  const arrowLength = resolveMultiwheelAngleArrowLength(band);
  const baseRadius = band.outer - arrowLength;
  const halfWidth = clamp(rayWidth * 1.35, 1.75, 2.75);
  const halfAngle = Math.atan2(halfWidth, Math.max(1, baseRadius)) * 180 / Math.PI;
  const left = polar(center, baseRadius, longitude - halfAngle, rootAsc);
  const right = polar(center, baseRadius, longitude + halfAngle, rootAsc);
  const apex = polar(center, band.outer, longitude, rootAsc);
  const paint = resolveWheelLinePaint(
    style,
    "angle",
    style.strokes.angloStructural,
    {},
    "angles.inner.arrowhead",
  );
  const ctx = draw.ctx;
  ctx.save();
  ctx.fillStyle = paint.fill ?? style.elementColors.angleRay;
  ctx.globalAlpha = paint.opacity;
  ctx.beginPath();
  ctx.moveTo(Math.round(apex[0]), Math.round(apex[1]));
  ctx.lineTo(Math.round(left[0]), Math.round(left[1]));
  ctx.lineTo(Math.round(right[0]), Math.round(right[1]));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function resolveMultiwheelAngleArrowLength(band: MultiwheelBand): number {
  return clamp((band.outer - band.inner) * 0.05, 4, 7);
}

function drawMultiwheelAngles(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  rootAsc: number,
  layout: MultiwheelLayout,
  ringIndex: number,
  hitRegions: MultiwheelHitRegion[],
  style: WheelRenderStyle,
) {
  const entries = MULTIWHEEL_ANGLE_ENTRIES(chart);
  const rayWidth = layout.frameWidth * 1.35;
  entries.forEach(({ angleId, longitude }) => {
    const inner = polar(center, band.inner, longitude, rootAsc);
    const outer = polar(center, band.outer, longitude, rootAsc);
    draw.line(
      [inner, outer],
      {
        fill: style.elementColors.angleRay,
        width: rayWidth,
        opacity: 0.72,
      },
    );
    hitRegions.push({
      kind: "angle",
      angleId,
      longitude,
      x: outer[0],
      y: outer[1],
      r: Math.max(8, layout.glyphSize * 0.5),
      shape: "line",
      x1: inner[0],
      y1: inner[1],
      x2: outer[0],
      y2: outer[1],
      tolerance: Math.max(4, rayWidth * 2.5),
      ringIndex,
      chartRole: ringIndex === 0 ? "primary" : "outer",
    });
  });
  if (chart.options.showAngleArrowheads !== false) {
    [chart.angles.asc, chart.angles.mc].forEach((longitude) => {
      drawMultiwheelAngleArrowhead(
        draw,
        center,
        band,
        longitude,
        rootAsc,
        rayWidth,
        style,
      );
    });
  }
}

function drawMultiwheelAngleLabels(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  rootAsc: number,
  fontUi: string,
  layout: MultiwheelLayout,
  style: WheelRenderStyle,
) {
  const proportionalSize = clamp(layout.glyphSize * 0.68, 9, 13);
  const paint = resolveWheelTypographyPaint(
    style,
    "anglo",
    "angles.inner.label",
    layout.maxRadius,
    {
      font: fontUi,
      size: proportionalSize,
      weight: style.typography.ratios.angleLabelWeight,
      color: style.elementColors.angleLabel,
    },
  );
  MULTIWHEEL_ANGLE_ENTRIES(chart).forEach(({ label, longitude }) => {
    if (!label) return;
    const [labelWidth, labelHeight] = draw.textsize(label, {
      font: paint.font,
      size: paint.size,
      weight: paint.weight,
      style: paint.style,
      tracking: paint.tracking,
    });
    const radialDepth = Math.max(labelWidth, labelHeight);
    const radius = band.outer
      - resolveMultiwheelAngleArrowLength(band)
      - 3
      - radialDepth / 2;
    draw.text(polar(center, radius, longitude, rootAsc), label, {
      font: paint.font,
      size: paint.size,
      weight: paint.weight,
      style: paint.style,
      tracking: paint.tracking,
      fill: paint.color,
      opacity: paint.opacity,
      align: "center",
      baseline: "middle",
    });
  });
}

function drawZodiac(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  size: number,
  frameWidth: number,
) {
  drawAnnulusFrame(draw, center, band, palette.frame, frameWidth);
  const asc = chart.angles.asc;
  const radius = (band.inner + band.outer) / 2;
  for (let sign = 0; sign < 12; sign += 1) {
    drawRadialLine(draw, center, band.inner, band.outer, sign * 30, asc, palette.frame, frameWidth * 0.6, 0.75);
    const point = polar(center, radius, sign * 30 + 15, asc);
    draw.text(point, signGlyph(sign, chart.options.signVariant), {
      font: fontSymbols,
      size,
      fill: chart.options.multiwheelUseSignColors
        ? chart.options.multiwheelSignColors?.[sign] ?? palette.signs
        : palette.signs,
      align: "center",
      baseline: "middle",
    });
  }
}

function drawTermStrip(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  size: number,
  frameWidth: number,
) {
  drawAnnulusFrame(draw, center, band, palette.houses, frameWidth * 0.55);
  const asc = chart.angles.asc;
  for (const signTerms of chart.options.terms ?? []) {
    for (const term of signTerms) {
      if (Number.isFinite(term.boundaryLon)) {
        drawRadialLine(draw, center, band.inner, band.outer, Number(term.boundaryLon), asc, palette.houses, 0.55, 0.75);
      }
      if (Number.isFinite(term.rulerLon) && term.rulerGlyph) {
        draw.text(polar(center, (band.inner + band.outer) / 2, Number(term.rulerLon), asc), term.rulerGlyph, {
          font: fontSymbols,
          size,
          fill: palette.textDim,
          align: "center",
          baseline: "middle",
        });
      }
    }
  }
}

function drawDecanStrip(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  palette: ChartPalette,
  fontSymbols: string,
  size: number,
  frameWidth: number,
) {
  drawAnnulusFrame(draw, center, band, palette.houses, frameWidth * 0.55);
  const asc = chart.angles.asc;
  for (let longitude = 0; longitude < 360; longitude += 10) {
    drawRadialLine(draw, center, band.inner, band.outer, longitude, asc, palette.houses, 0.5, 0.65);
  }
  for (const segment of chart.options.decans ?? []) {
    for (const ruler of segment.rulers ?? []) {
      draw.text(polar(center, (band.inner + band.outer) / 2, ruler.rulerLon, asc), ruler.rulerGlyph, {
        font: fontSymbols,
        size,
        fill: palette.textDim,
        align: "center",
        baseline: "middle",
      });
    }
  }
}

function drawChartBand(
  draw: CanvasDraw,
  center: [number, number],
  band: MultiwheelBand,
  chart: Chart,
  rootAsc: number,
  palette: ChartPalette,
  fontSymbols: string,
  fontUi: string,
  layout: MultiwheelLayout,
  ringIndex: number,
  hitRegions: MultiwheelHitRegion[],
  conjunctionFeet: ReadonlyMap<string, MultiwheelConjunctionFoot>,
  style: WheelRenderStyle,
) {
  drawAnnulusFrame(draw, center, band, palette.frame, layout.frameWidth);
  if (chart.options.showHouses !== false) {
    chart.houses.cusps.forEach((cusp, index) => {
      if (index !== 0 && index !== 3 && index !== 6 && index !== 9) {
        drawRadialLine(
          draw,
          center,
          band.inner,
          band.outer,
          cusp,
          rootAsc,
          palette.houses,
          layout.frameWidth * 0.45,
          0.28,
        );
      }
      const next = chart.houses.cusps[(index + 1) % 12];
      const middle = normalized(cusp + forwardGap(cusp, next) / 2);
      draw.text(polar(center, band.outer - layout.houseSize * 0.78, middle, rootAsc), String(index + 1), {
        font: fontUi,
        size: layout.houseSize,
        fill: palette.textDim,
        align: "center",
        baseline: "middle",
        opacity: 0.85,
      });
    });
  }
  drawMultiwheelAngles(
    draw,
    center,
    band,
    chart,
    rootAsc,
    layout,
    ringIndex,
    hitRegions,
    style,
  );

  const bodies = chartBodies(chart, palette);
  const showPositions = chart.options.multiwheelShowPositions !== false;
  const showMinutes = showPositions && chart.options.multiwheelShowMinutes !== false;
  const degreeSize = clamp(layout.positionSize * 1.20, 10, 12);
  const signSize = clamp(layout.positionSize * 1.24, 10, 13);
  const minuteSize = clamp(layout.positionSize * 0.94, 8, 10);
  const measuredBodies = bodies.map((body) => {
    const glyphFont = body.glyphFont === "text" ? fontUi : fontSymbols;
    const glyphMeasure = draw.textsize(body.glyph, {
      font: glyphFont,
      size: layout.glyphSize * body.glyphScale,
    });
    const degreeMeasure = showPositions
      ? draw.textsize(`${body.degText}°`, { font: fontUi, size: degreeSize })
      : [0, 0] as const;
    const signMeasure = showPositions
      ? draw.textsize(
        signGlyph(Math.floor(normalized(body.longitude) / 30), chart.options.signVariant),
        { font: fontSymbols, size: signSize },
      )
      : [0, 0] as const;
    const minuteMeasure = showMinutes
      ? draw.textsize(
        body.minText ? `${body.minText}′` : "00′",
        { font: fontUi, size: minuteSize },
      )
      : [0, 0] as const;
    return {
      glyphMeasure,
      degreeMeasure,
      signMeasure,
      minuteMeasure,
      widest: Math.max(
        glyphMeasure[0] + (body.motion ? layout.positionSize * 0.8 : 0),
        degreeMeasure[0],
        signMeasure[0],
        minuteMeasure[0],
      ),
    };
  });
  const rowDepths = measuredBodies.reduce<MultiwheelBodyStackDepths>(
    (depths, body) => ({
      glyph: Math.max(depths.glyph, body.glyphMeasure[1]),
      degree: Math.max(depths.degree, body.degreeMeasure[1]),
      sign: Math.max(depths.sign, body.signMeasure[1]),
      minute: Math.max(depths.minute, body.minuteMeasure[1]),
    }),
    {
      glyph: layout.glyphSize,
      degree: showPositions ? degreeSize : 0,
      sign: showPositions ? signSize : 0,
      minute: showMinutes ? minuteSize : 0,
    },
  );
  const {
    glyphRadius,
    degreeRadius,
    signRadius,
    minuteRadius,
  } = resolveMultiwheelBodyStackLanes(band, rowDepths, layout.houseSize);
  const widestColumn = measuredBodies.reduce(
    (widest, body) => Math.max(widest, body.widest),
    layout.glyphSize,
  );
  const minimumGap = clamp(
    ((widestColumn + 3) / Math.max(
      1,
      showMinutes ? minuteRadius : showPositions ? signRadius : glyphRadius,
    )) * 180 / Math.PI,
    4.5,
    17,
  );
  const displayed = spreadLongitudes(bodies.map((body) => body.longitude), minimumGap);
  const bodyFootLength = resolveMultiwheelBodyFootLength(band, layout, style);
  const resolvedBodyFootPaint = resolveWheelLinePaint(
    style,
    "bodyLeader",
    layout.frameWidth * 0.55,
    { color: style.elementColors.angloBodyLeader },
    "bodies.inner.leader",
  );
  const bodyFootPaint: LineOpts = {
    ...resolvedBodyFootPaint,
    width: 1,
  };
  bodies.forEach((body, index) => {
    const longitude = displayed[index];
    const glyphPoint = polar(center, glyphRadius, longitude, rootAsc);
    const degreePoint = polar(center, degreeRadius, longitude, rootAsc);
    const signPoint = polar(center, signRadius, longitude, rootAsc);
    const minutePoint = polar(center, minuteRadius, longitude, rootAsc);
    const conjunctionFoot = conjunctionFeet.get(
      multiwheelEndpointKey(ringIndex, multiwheelHoverAspectKey(body.hover)),
    );
    const paintedFoot: LineOpts = conjunctionFoot === undefined
      ? bodyFootPaint
      : {
          ...bodyFootPaint,
          fill: palette.aspects[0] ?? palette.frame,
          width: resolveMultiwheelConjunctionFootWidth(conjunctionFoot),
        };
    drawMultiwheelBodyFoot(
      draw,
      center,
      band.outer,
      -1,
      bodyFootLength,
      body.longitude,
      rootAsc,
      paintedFoot,
    );
    if (ringIndex !== 0) {
      drawMultiwheelBodyFoot(
        draw,
        center,
        band.inner,
        1,
        bodyFootLength,
        body.longitude,
        rootAsc,
        paintedFoot,
      );
    }
    draw.text(glyphPoint, body.glyph, {
      font: body.glyphFont === "text" ? fontUi : fontSymbols,
      size: layout.glyphSize * body.glyphScale,
      fill: body.color,
      align: "center",
      baseline: "middle",
    });
    hitRegions.push({
      ...body.hover,
      x: glyphPoint[0],
      y: glyphPoint[1],
      r: Math.max(8, layout.glyphSize * body.glyphScale * 0.72),
      ringIndex,
      chartRole: ringIndex === 0 ? "primary" : "outer",
    });
    if (body.motion) {
      draw.text([glyphPoint[0] + layout.glyphSize * 0.44, glyphPoint[1] + layout.glyphSize * 0.12], body.motion, {
        font: fontUi,
        size: layout.positionSize * 0.8,
        fill: body.color,
        align: "center",
        baseline: "middle",
      });
    }
    if (showPositions) {
      draw.text(degreePoint, `${body.degText}°`, {
        font: fontUi,
        size: degreeSize,
        fill: palette.positions,
        align: "center",
        baseline: "middle",
      });
      const signIndex = Math.floor(normalized(body.longitude) / 30);
      draw.text(signPoint, signGlyph(signIndex, chart.options.signVariant), {
        font: fontSymbols,
        size: signSize,
        fill: chart.options.multiwheelUseSignColors
          ? chart.options.multiwheelSignColors?.[signIndex] ?? palette.signs
          : palette.signs,
        align: "center",
        baseline: "middle",
      });
    }
    if (showMinutes && body.minText) {
      draw.text(minutePoint, `${body.minText}′`, {
        font: fontUi,
        size: minuteSize,
        fill: palette.positions,
        align: "center",
        baseline: "middle",
      });
    }
  });
  if (chart.options.multiwheelShowAngleLabels !== false) {
    drawMultiwheelAngleLabels(
      draw,
      center,
      band,
      chart,
      rootAsc,
      fontUi,
      layout,
      style,
    );
  }
}

export type MultiwheelCaptionRow = Readonly<{
  role: "name" | "type" | "place" | "datetime";
  text: string;
}>;

export function multiwheelChartCaption(chart: Chart): readonly MultiwheelCaptionRow[] {
  const ringNumeral = chart.meta.multiwheelRingNumeral?.trim() ?? "";
  const rows: MultiwheelCaptionRow[] = [
    {
      role: "name",
      text: [ringNumeral, chart.meta.name.trim()].filter(Boolean).join(" "),
    },
    { role: "type", text: chart.meta.titleParts?.[1]?.trim() ?? "" },
    { role: "place", text: chart.meta.place.trim() || chart.meta.placeCoords.trim() },
    { role: "datetime", text: [
      chart.meta.numericDateDisplay ?? chart.meta.dateDisplay,
      chart.meta.compactTimeDisplay ?? chart.meta.timeDisplay,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ") },
  ];
  return rows.filter((row) => Boolean(row.text));
}

function drawMultiwheelCornerCaptions(
  draw: CanvasDraw,
  viewport: MultiwheelViewport,
  rings: readonly Chart[],
  palette: ChartPalette,
  fontUi: string,
  layout: MultiwheelLayout,
  style: WheelRenderStyle,
) {
  if (rings[0]?.options.showInformation === false) return;
  const overlayMetrics = resolveWheelOverlayMetrics(style.overlays, {
    width: viewport.width,
    height: Math.max(0, viewport.height - viewport.topBoundary),
  });
  const edgeInset = overlayMetrics.edgeInset;
  const slots = [
    { x: edgeInset, y: viewport.topBoundary + edgeInset, align: "left", vertical: "top" },
    { x: viewport.width - edgeInset, y: viewport.topBoundary + edgeInset, align: "right", vertical: "top" },
    { x: edgeInset, y: viewport.height - edgeInset, align: "left", vertical: "bottom" },
    { x: viewport.width - edgeInset, y: viewport.height - edgeInset, align: "right", vertical: "bottom" },
  ] as const;
  const maximumWidth = Math.max(120, viewport.width / 2 - edgeInset * 2);

  rings.slice(0, slots.length).forEach((chart, index) => {
    const caption = multiwheelChartCaption(chart);
    if (!caption.length) return;
    const slot = slots[index];
    const profile: WheelTypographyProfile = chart.options.theme === 2
      ? "anglo"
      : chart.options.theme === 1
        ? "compact"
        : "classic";
    const semanticClass = slot.vertical === "top"
      ? "chartOverlay.information.topLeft"
      : "chartOverlay.information.bottomLeft";
    const basePaint = resolveWheelTypographyPaint(
      style,
      profile,
      semanticClass,
      layout.maxRadius,
      {
        font: fontUi,
        size: overlayMetrics.infoFontSize,
        color: palette.textDim,
      },
    );
    const rowStyles = caption.map(({ role }) => ({
      ...basePaint,
      fill: role === "name" ? palette.textBright : basePaint.color,
      weight: role === "name" ? Math.max(500, basePaint.weight) : basePaint.weight,
    }));
    const widest = caption.reduce((width, row, rowIndex) => Math.max(
      width,
      draw.textsize(row.text, {
        font: rowStyles[rowIndex].font,
        size: rowStyles[rowIndex].size,
        weight: rowStyles[rowIndex].weight,
        style: rowStyles[rowIndex].style,
        tracking: rowStyles[rowIndex].tracking,
      })[0],
    ), 0);
    const scale = widest > maximumWidth ? Math.max(0.7, maximumWidth / widest) : 1;
    const lineHeight = basePaint.size * scale * style.overlays.cornerLineHeight;
    const rowGap = style.overlays.infoGap * scale;
    const blockHeight = caption.length * lineHeight
      + Math.max(0, caption.length - 1) * rowGap;
    let y = slot.vertical === "top" ? slot.y : slot.y - blockHeight;
    caption.forEach((row, rowIndex) => {
      const rowStyle = rowStyles[rowIndex];
      draw.text([slot.x, y], row.text, {
        font: rowStyle.font,
        size: rowStyle.size * scale,
        fill: rowStyle.fill,
        weight: rowStyle.weight,
        style: rowStyle.style,
        tracking: rowStyle.tracking * scale,
        align: slot.align,
        baseline: "top",
        opacity: rowStyle.opacity,
      });
      y += lineHeight + rowGap;
    });
  });
}

export function drawMultiwheel(
  draw: CanvasDraw,
  center: [number, number],
  layout: MultiwheelLayout,
  snapshot: ChartRenderSnapshot,
  palette: ChartPalette,
  fonts: { symbols: string; ui: string },
  viewport: MultiwheelViewport,
  style: WheelRenderStyle,
): MultiwheelHitRegion[] {
  const rings = (snapshot.rings ?? []).slice(0, layout.ringBands.length);
  const hitRegions: MultiwheelHitRegion[] = [];
  if (rings.length < 3) return hitRegions;
  const root = rings[0];
  const rootAsc = root.angles.asc;
  const conjunctionFeet = resolveMultiwheelConjunctionFeet(snapshot);

  draw.fillBackground(palette.background);
  layout.ringBands.forEach((band, index) => {
    const chart = rings[index];
    if (chart) {
      drawChartBand(
        draw,
        center,
        band,
        chart,
        rootAsc,
        palette,
        fonts.symbols,
        fonts.ui,
        layout,
        index,
        hitRegions,
        conjunctionFeet,
        style,
      );
    }
  });
  drawZodiac(
    draw,
    center,
    layout.zodiacBand,
    root,
    palette,
    fonts.symbols,
    clamp(layout.glyphSize * 0.75, 10, 16),
    layout.frameWidth,
  );
  if (layout.termBand) {
    drawTermStrip(draw, center, layout.termBand, root, palette, fonts.symbols, clamp(layout.positionSize * 0.78, 7, 9), layout.frameWidth);
  }
  if (layout.decanBand) {
    drawDecanStrip(draw, center, layout.decanBand, root, palette, fonts.symbols, clamp(layout.positionSize * 0.78, 7, 9), layout.frameWidth);
  }
  draw.circle(center, layout.hubRadius, {
    fill: palette.background,
    outline: palette.frame,
    width: layout.frameWidth,
  });
  drawMultiwheelCornerCaptions(
    draw,
    viewport,
    rings,
    palette,
    fonts.ui,
    layout,
    style,
  );
  return hitRegions;
}

export function findMultiwheelHitRegion(
  regions: readonly MultiwheelHitRegion[],
  x: number,
  y: number,
): MultiwheelHitRegion | null {
  let best: MultiwheelHitRegion | null = null;
  let bestDistance = Infinity;
  for (const region of regions) {
    let distance: number;
    let inside: boolean;
    if (region.kind === "angle" && region.shape === "line") {
      const vx = region.x2 - region.x1;
      const vy = region.y2 - region.y1;
      const lengthSq = vx * vx + vy * vy;
      const projection = lengthSq > 0
        ? ((x - region.x1) * vx + (y - region.y1) * vy) / lengthSq
        : 0;
      const t = clamp(projection, 0, 1);
      const dx = x - (region.x1 + vx * t);
      const dy = y - (region.y1 + vy * t);
      distance = dx * dx + dy * dy;
      inside = distance <= region.tolerance * region.tolerance;
    } else {
      const dx = x - region.x;
      const dy = y - region.y;
      distance = dx * dx + dy * dy;
      inside = distance <= region.r * region.r;
    }
    if (inside && distance < bestDistance) {
      best = region;
      bestDistance = distance;
    }
  }
  return best;
}
