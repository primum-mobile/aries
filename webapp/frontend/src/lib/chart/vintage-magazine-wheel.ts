// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vintage magazine wheel: a direct port of the approved measured mock-up.
 * Every radius, font size, stroke
 * and offset is the mock-up's own number in its 400-unit frame; the only
 * scale is `radius / 400`. The general wheel layout engine is not consulted.
 *
 * The mock-up hand-placed three crowded Reading-chart stacks. Here the same
 * angular displacement and leader are solved for any chart.
 *
 * Chart Style edits arrive as per-class overrides in the same 400-unit frame
 * (`VintageClassOverrides`); with none, the render is the mock-up exactly.
 */

import { bundledGlyphInkBounds } from "./chart-fonts";
import { polar } from "./canvas-draw";
import type { WheelFrame } from "./wheel-projection";

type Pt = [number, number];

/** The mock-up, verbatim, at outer radius 400. */
export const VINTAGE_MAGAZINE = Object.freeze({
  frame: 400,
  radius: Object.freeze({
    outer: 400, cusp: 346.589, hub: 178.031, label: 373.295,
    planet: 316, degree: 282, minute: 248, sign: 213,
  }),
  stroke: Object.freeze({
    outer: 2.738, cusp: 2.398, hub: 2.136, houseCusp: 2.4,
    asc: 2.872, mc: 2.685, dsc: 2.035, ic: 2.787,
    arrow: 2.1, tick: 1.8, leader: 1.35,
  }),
  arrow: Object.freeze({ tipInset: 1, baseInset: 12, halfWidth: 4.4 }),
  tick: Object.freeze({ cuspLength: 10, hubInward: 4, hubOutward: 7, leaderTipInset: 18 }),
  /**
   * Mock-up sizes, with the approved reduction so planets lead: planet
   * stacks and motion markers at 75 %, cusp captions and house numbers at
   * 85 %. Planet glyphs keep 26; text-set points (Sy, Ec) take the degree size.
   */
  font: Object.freeze({
    glyph: 26, degree: 23 * 0.75, minute: 22 * 0.75, sign: 25.3 * 0.75, motion: 21 * 0.75,
    houseNumber: 21.1 * 0.85, caption: 21.5 * 0.85, captionSign: 25.3 * 0.85, textGlyph: 23 * 0.75,
  }),
  /**
   * Text uses the theme's text face at its natural width (never synthetically
   * condensed). The font sizes above set a digit's ink to 0.75 em (FreeSans
   * Bold, in which the mock-up was measured), so any face is resized to that
   * same digit height. Regular weight matches the single-weight Morinus
   * glyph strokes, so planets lead by size rather than being out-inked.
   */
  text: Object.freeze({ digitHeightEm: 0.75, weight: 400 }),
  degreeKern: 0.05,
  minuteMark: "'",
  captionRows: Object.freeze({ upper: -15, lower: 13 }),
  motionInset: 7,
  knockout: 1.2,
  aspect: Object.freeze({
    // Never heavier than a house cusp; orb thickness can only thin a chord.
    width: 2.4, exactWidth: 2.4, widestWidth: 1.2,
    dash: Object.freeze({ 10: [14, 5], 6: [2, 5] } as Record<number, readonly number[]>),
  }),
  /** Dash and gap a line takes when a style edit makes it dashed or dotted. */
  dash: Object.freeze({ on: 14, off: 5 }),
  /** Clearance between neighbouring stacks, in addition to the knockouts. */
  stackGap: 0.3,
});

const M = VINTAGE_MAGAZINE;

/** Chart Style classes the port paints, each with its mock-up size in the 400-unit frame. */
export const VINTAGE_TEXT_CLASSES = Object.freeze({
  "bodies.inner.glyph": { size: M.font.glyph, symbols: true },
  "bodies.inner.position.degree": { size: M.font.degree, symbols: false },
  "bodies.inner.position.minute": { size: M.font.minute, symbols: false },
  "bodies.inner.position.sign": { size: M.font.sign, symbols: true },
  "bodies.inner.motion": { size: M.font.motion, symbols: false },
  "houses.inner.label": { size: M.font.houseNumber, symbols: false },
  "houses.inner.position.degree": { size: M.font.caption, symbols: false },
  "houses.inner.position.minute": { size: M.font.caption, symbols: false },
  "houses.inner.position.sign": { size: M.font.captionSign, symbols: true },
} as const);
export type VintageTextClass = keyof typeof VINTAGE_TEXT_CLASSES;

/**
 * Line classes and the stroke an edit is measured against. Where one class
 * paints several measured widths (the four angles, ticks beside leaders, orb
 * thinning) the edit scales them together and keeps their proportions.
 */
export const VINTAGE_LINE_CLASSES = Object.freeze({
  "rings.angloCuspOuter": { width: M.stroke.outer },
  "rings.innerBoundary": { width: M.stroke.cusp },
  "rings.aspectBoundary": { width: M.stroke.hub },
  "houses.inner.cusp": { width: M.stroke.houseCusp },
  "angles.inner.ray": { width: M.stroke.asc },
  "angles.inner.arrowhead": { width: M.stroke.arrow },
  "bodies.inner.leader": { width: M.stroke.leader },
  "aspects.primary.line": { width: M.aspect.width },
} as const);
export type VintageLineClass = keyof typeof VINTAGE_LINE_CLASSES;

export function isVintageClass(classId: string): classId is VintageTextClass | VintageLineClass {
  return classId in VINTAGE_TEXT_CLASSES || classId in VINTAGE_LINE_CLASSES;
}

/** One class's Chart Style edit. Lengths are in the 400-unit frame. */
export interface VintageTextOverride {
  font?: string;
  size?: number;
  weight?: number;
  style?: "normal" | "italic";
  tracking?: number;
  color?: string;
  opacity?: number;
}

export interface VintageLineOverride {
  width?: number;
  pattern?: "solid" | "dashed" | "dotted";
  dashOn?: number;
  dashOff?: number;
  lineCap?: CanvasLineCap;
  color?: string;
  opacity?: number;
  /** Arrowhead size as a ratio of the mock-up's; 1 is unchanged. */
  arrowSize?: number;
}

export interface VintageClassOverrides {
  readonly text?: Readonly<Partial<Record<VintageTextClass, VintageTextOverride>>>;
  readonly line?: Readonly<Partial<Record<VintageLineClass, VintageLineOverride>>>;
}

export interface VintageBody {
  key: string;
  /** Drawing angle (true longitude in the zodiacal frame). */
  angle: number;
  glyph: string;
  glyphIsText: boolean;
  color: string;
  degText?: string;
  minText?: string;
  signGlyph: string;
  /** The sign's colour (zodiac element colours), else the positions colour. */
  signColor?: string;
  motion?: string;
}

export interface VintageAspect {
  angle1: number;
  angle2: number;
  type: number;
  color: string;
  /** 0 exact … 1 at the maximum orb; undefined when orb modulation is off. */
  orbRatio?: number;
  opacity?: number;
}

export interface VintageCusp {
  angle: number;
  caption?: { degText: string; minText: string; signGlyph: string; signColor?: string };
}

export interface VintageWheelInput {
  center: Pt;
  /** Drawn outer-circle radius; everything scales by radius / 400. */
  radius: number;
  frame: WheelFrame;
  cusps: readonly VintageCusp[];
  angles: Readonly<{ asc: number; mc: number; dsc: number; ic: number }>;
  bodies: readonly VintageBody[];
  showHouses: boolean;
  showCaptions: boolean;
  showBodies: boolean;
  showPositions: boolean;
  showMinutes: boolean;
  showArrowheads: boolean;
  fonts: Readonly<{ text: string; symbols: string }>;
  colors: Readonly<{
    background: string; circles: string; houses: string; angles: string;
    positions: string; houseNumbers: string;
  }>;
  classes?: VintageClassOverrides;
}

export interface VintageInk { left: number; right: number; ascent: number; descent: number }
export type VintageMeasure = (
  text: string, font: string, size: number, weight: number, style?: "normal" | "italic",
) => VintageInk;

/** A resolved text appearance, in canvas px. */
export interface VintageTextSpec {
  font: string; size: number; weight: number; style: "normal" | "italic";
  tracking: number; color: string; opacity: number;
}

/** A resolved stroke, in canvas px. */
export interface VintageLinePaint {
  width: number; dash: number[]; color: string; opacity: number; cap: CanvasLineCap;
}

interface VintageTextRun { text: string; classId: VintageTextClass; spec: VintageTextSpec }

export interface VintageText {
  text: string;
  /** The first run's appearance; mixed runs keep their own on each part. */
  font: string; size: number; weight: number; color: string;
  knockout: boolean;
  itemId: string;
  /** Ink box in canvas px. */
  x: number; y: number; w: number; h: number;
  /** Anchor, and each segment's draw x relative to it plus the shared baseline offset. */
  anchor: Pt; parts: Array<{ text: string; dx: number; spec: VintageTextSpec }>; dy: number;
  /** Each class's ink extent within the box, for Chart Style targets. */
  spans: Array<{ classId: VintageTextClass; x: number; w: number }>;
}

export interface VintageLine { start: Pt; end: Pt }

export interface VintageBodyLayout {
  key: string;
  angle: number;
  shift: number;
  glyph: VintageText;
  texts: VintageText[];
  ticks: VintageLine[];
  leader?: VintageLine;
  tickPaint: VintageLinePaint;
  leaderPaint: VintageLinePaint;
}

export interface VintageWheelLayout {
  scale: number;
  circles: Array<{ classId: VintageLineClass; radius: number; paint: VintageLinePaint }>;
  bodies: VintageBodyLayout[];
  houseNumbers: Array<{ houseIndex: number; text: VintageText }>;
  captions: VintageText[];
  cuspLines: Array<VintageLine & { houseIndex: number; width: number; paint: VintageLinePaint }>;
  angleRays: Array<VintageLine & {
    angleId: "asc" | "mc" | "dsc" | "ic"; width: number; paint: VintageLinePaint;
    arrow?: [Pt, Pt, Pt]; arrowPaint?: VintageLinePaint;
  }>;
}

type StackRow = { units: number; run: VintageTextRun };

function fontSpec(weight: number, size: number, family: string, style: "normal" | "italic" = "normal"): string {
  return `${style} ${weight} ${size}px ${family}`;
}

const clamp01 = (value: number | undefined, fallback = 1) =>
  value == null || !Number.isFinite(value) ? fallback : Math.min(1, Math.max(0, value));

/** Ink metrics from Canvas, with bundled glyph ink where WebKit clamps it. */
export function canvasInkMeasure(ctx: CanvasRenderingContext2D): VintageMeasure {
  return (text, font, size, weight, style = "normal") => {
    ctx.save();
    ctx.font = fontSpec(weight, size, font, style);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    ctx.restore();
    let ascent = Number(m.actualBoundingBoxAscent);
    let descent = Number(m.actualBoundingBoxDescent);
    const glyphs = Array.from(text);
    const bundled = glyphs.map(glyph => bundledGlyphInkBounds(glyph, font, 1, weight));
    if (bundled.every(Boolean)) {
      ascent = Math.max(...bundled.map(ink => -ink!.y)) * size;
      descent = Math.max(...bundled.map(ink => ink!.y + ink!.h)) * size;
    }
    const left = Number(m.actualBoundingBoxLeft);
    const right = Number(m.actualBoundingBoxRight);
    return {
      left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : Number(m.width) || size * 0.6 * glyphs.length,
      ascent: Number.isFinite(ascent) ? ascent : size * 0.8,
      descent: Number.isFinite(descent) ? descent : size * 0.2,
    };
  };
}

/**
 * The mock-up's text(): centre the actual ink on the anchor. A degree sign is
 * set as its own segment, kerned tight against its neighbours; tracking, when
 * edited, is added after every character.
 */
function placeText(
  measure: VintageMeasure, runs: readonly VintageTextRun[], anchor: Pt, knockout: boolean, itemId: string,
): VintageText {
  const segments = runs.flatMap((run, runIndex) =>
    (run.spec.tracking ? Array.from(run.text) : run.text.split(/(°)/).filter(Boolean))
      .map(text => ({ text, run, runIndex })));
  let cursor = 0, ascent = 0, descent = 0;
  const runExtent = runs.map(() => ({ start: Infinity, end: -Infinity }));
  const parts = segments.map((segment, index) => {
    const { spec } = segment.run;
    const ink = measure(segment.text, spec.font, spec.size, spec.weight, spec.style);
    const dx = cursor + ink.left;
    const extent = runExtent[segment.runIndex];
    extent.start = Math.min(extent.start, cursor);
    cursor += ink.left + ink.right;
    extent.end = Math.max(extent.end, cursor);
    const next = segments[index + 1];
    if (next) {
      const kerned = segment.text === "°" || next.text === "°";
      cursor += (kerned ? M.degreeKern * spec.size : 0) + spec.tracking;
    }
    ascent = Math.max(ascent, ink.ascent);
    descent = Math.max(descent, ink.descent);
    return { text: segment.text, dx, spec };
  });
  const w = cursor;
  const h = ascent + descent;
  const x = anchor[0] - w / 2;
  const first = runs[0].spec;
  return {
    text: runs.map(run => run.text).join(""),
    font: first.font, size: first.size, weight: first.weight, color: first.color,
    knockout, itemId,
    x, y: anchor[1] - h / 2, w, h,
    anchor, parts: parts.map(part => ({ ...part, dx: part.dx - w / 2 })), dy: (ascent - descent) / 2,
    spans: runs.map((run, index) => ({ classId: run.classId, x: x + runExtent[index].start,
      w: Math.max(0, runExtent[index].end - runExtent[index].start) })),
  };
}

function minuteText(minText: string): string {
  return /^\d+$/.test(minText) ? `${minText}${M.minuteMark}` : minText.replace(/['′]$/, M.minuteMark);
}

function normalize(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** A stroke from its class edit; `units` is this occurrence's mock-up width. */
function resolveLine(
  override: VintageLineOverride | undefined, classId: VintageLineClass, units: number, color: string,
  scale: number, defaultDash: readonly number[] = [],
): VintageLinePaint {
  const ratio = override?.width != null && Number.isFinite(override.width)
    ? Math.max(0, override.width) / VINTAGE_LINE_CLASSES[classId].width : 1;
  const pattern = override?.pattern;
  const dash = pattern == null ? [...defaultDash]
    : pattern === "solid" ? []
      : pattern === "dashed" ? [override?.dashOn ?? M.dash.on, override?.dashOff ?? M.dash.off]
        : [0, override?.dashOff ?? M.dash.off];
  return {
    width: units * ratio * scale,
    dash: dash.map(length => Math.max(0, length) * scale),
    color: override?.color?.trim() || color,
    opacity: clamp01(override?.opacity),
    cap: override?.lineCap ?? (pattern === "dotted" ? "round" : "butt"),
  };
}

/**
 * Spread crowded stacks around the wheel. Each stack keeps its true angle
 * unless a neighbour needs room; a crowded run is centred on its true angles.
 */
export function spreadVintageStacks(angles: readonly number[], halfWidths: readonly number[]): number[] {
  const n = angles.length;
  const shifts = new Array<number>(n).fill(0);
  if (n < 2) return shifts;
  const order = angles.map((angle, index) => ({ angle: normalize(angle), index }))
    .sort((a, b) => a.angle - b.angle);
  let start = 0, widest = -1;
  for (let i = 0; i < n; i += 1) {
    const gap = normalize(order[(i + 1) % n].angle - order[i].angle) || (n === 1 ? 360 : 0);
    if (gap > widest) { widest = gap; start = (i + 1) % n; }
  }
  const items = Array.from({ length: n }, (_, i) => order[(start + i) % n]);
  const base = items[0].angle;
  const unwrapped = items.map(item => base + normalize(item.angle - base));
  const half = items.map(item => halfWidths[item.index]);
  let groups = items.map((_, i) => [i]);
  const place = (group: number[]) => {
    const offsets = [0];
    for (let j = 1; j < group.length; j += 1) offsets.push(offsets[j - 1] + half[group[j - 1]] + half[group[j]]);
    const anchor = group.reduce((sum, i, j) => sum + unwrapped[i] - offsets[j], 0) / group.length;
    return offsets.map(offset => anchor + offset);
  };
  for (let merged = true; merged;) {
    merged = false;
    const placed = groups.map(place);
    for (let g = 0; g + 1 < groups.length; g += 1) {
      const last = groups[g][groups[g].length - 1], first = groups[g + 1][0];
      if (placed[g][placed[g].length - 1] + half[last] + half[first] > placed[g + 1][0] + 1e-9) {
        groups = [...groups.slice(0, g), [...groups[g], ...groups[g + 1]], ...groups.slice(g + 2)];
        merged = true;
        break;
      }
    }
  }
  groups.forEach(group => place(group).forEach((angle, j) => {
    const i = group[j];
    shifts[items[i].index] = angle - unwrapped[i];
  }));
  return shifts;
}

/** The three printed circles, outermost first, with their class strokes. */
export function vintageCircles(radius: number, classes?: VintageClassOverrides, color = "") {
  const s = radius / M.frame;
  return ([
    ["rings.angloCuspOuter", M.radius.outer, M.stroke.outer],
    ["rings.innerBoundary", M.radius.cusp, M.stroke.cusp],
    ["rings.aspectBoundary", M.radius.hub, M.stroke.hub],
  ] as const).map(([classId, units, width]) => ({
    classId, radius: units * s, paint: resolveLine(classes?.line?.[classId], classId, width, color, s),
  }));
}

export function layoutVintageWheel(input: VintageWheelInput, measure: VintageMeasure): VintageWheelLayout {
  const s = input.radius / M.frame;
  const r = (units: number) => units * s;
  const at = (angle: number, units: number) => polar(input.center, r(units), angle, input.frame);
  const { fonts, colors } = input;
  const textEdits = input.classes?.text ?? {};
  const lineEdits = input.classes?.line ?? {};

  // The theme face fitted to the magazine's digit height, at its own width.
  const fits = new Map<string, number>();
  const digitFit = (font: string, weight: number, style: "normal" | "italic") => {
    const key = `${style}|${weight}|${font}`;
    let fit = fits.get(key);
    if (fit == null) {
      const probe = measure("8", font, 100, weight, style);
      const height = probe.ascent + probe.descent;
      fit = height > 0 ? M.text.digitHeightEm / (height / 100) : 1;
      fits.set(key, fit);
    }
    return fit;
  };
  /**
   * One class's text appearance. `units` overrides the class size for an
   * occurrence (text-set planets); a size edit scales it in proportion.
   * Symbol classes keep their size; text classes are fitted to the digit.
   */
  const textRun = (
    classId: VintageTextClass, text: string, color: string,
    occurrence: { font?: string; units?: number; symbols?: boolean } = {},
  ): VintageTextRun => {
    const edit = textEdits[classId];
    const declared = VINTAGE_TEXT_CLASSES[classId];
    const symbols = occurrence.symbols ?? declared.symbols;
    // A symbol-role font edit never reaches a planet set in the text face.
    const font = (symbols === declared.symbols ? edit?.font?.trim() : "")
      || occurrence.font || (symbols ? fonts.symbols : fonts.text);
    const weight = edit?.weight != null && Number.isFinite(edit.weight)
      ? Math.min(1000, Math.max(1, edit.weight)) : symbols ? 400 : M.text.weight;
    const style = edit?.style ?? "normal";
    const listed = (occurrence.units ?? declared.size) * (edit?.size != null && Number.isFinite(edit.size)
      ? Math.max(0.25, edit.size) / declared.size : 1);
    return {
      text, classId,
      spec: {
        font, weight, style,
        size: r(symbols ? listed : listed * digitFit(font, weight, style)),
        tracking: r(edit?.tracking ?? 0),
        color: edit?.color?.trim() || color,
        opacity: clamp01(edit?.opacity),
      },
    };
  };

  // Bodies: planet, degree, minute, sign, read inward on one radial line.
  const stacks = input.showBodies ? input.bodies.map(body => {
    const rows: StackRow[] = [];
    if (input.showPositions && body.degText != null) {
      rows.push({ units: M.radius.degree,
        run: textRun("bodies.inner.position.degree", `${body.degText}°`, colors.positions) });
      if (input.showMinutes && body.minText != null) {
        rows.push({ units: M.radius.minute,
          run: textRun("bodies.inner.position.minute", minuteText(body.minText), colors.positions) });
      }
      if (body.signGlyph) {
        rows.push({ units: M.radius.sign, run: textRun("bodies.inner.position.sign", body.signGlyph, body.signColor ?? colors.positions) });
      }
    }
    const glyphRow: StackRow = { units: M.radius.planet, run: body.glyphIsText
      ? textRun("bodies.inner.glyph", body.glyph, body.color,
        { symbols: false, font: fonts.text, units: M.font.textGlyph })
      : textRun("bodies.inner.glyph", body.glyph, body.color) };
    // Angular half-width of the stack: its widest row at that row's radius.
    const halfWidth = [glyphRow, ...rows].reduce((widest, row) => {
      const placed = placeText(measure, [row.run], [0, 0], false, "");
      const halfPx = placed.w / 2 + r(M.knockout + M.stackGap);
      return Math.max(widest, halfPx / r(row.units) * 180 / Math.PI);
    }, 0);
    return { body, glyphRow, rows, halfWidth };
  }) : [];
  const shifts = spreadVintageStacks(stacks.map(stack => stack.body.angle), stacks.map(stack => stack.halfWidth));

  const bodies = stacks.map(({ body, glyphRow, rows }, index): VintageBodyLayout => {
    const shift = shifts[index];
    const shifted = body.angle + shift;
    const item = `body:${body.key}`;
    const text = (row: StackRow, part: string) => placeText(measure, [row.run], at(shifted, row.units), true, `${item}:${part}`);
    const texts = rows.map(row => text(row, row.run.classId.split(".").slice(2).join(".")));
    if (body.motion) {
      texts.push(placeText(measure, [textRun("bodies.inner.motion", body.motion, body.color)],
        at(shifted, M.radius.hub - M.motionInset), true, `${item}:motion`));
    }
    const lastUnits = rows.length ? rows[rows.length - 1].units : M.radius.planet;
    const leaderEdit = lineEdits["bodies.inner.leader"];
    return {
      key: body.key, angle: body.angle, shift,
      glyph: text(glyphRow, "glyph"),
      texts,
      ticks: [
        { start: at(body.angle, M.radius.cusp), end: at(body.angle, M.radius.cusp - M.tick.cuspLength) },
        { start: at(body.angle, M.radius.hub - M.tick.hubInward), end: at(body.angle, M.radius.hub + M.tick.hubOutward) },
      ],
      ...(Math.abs(shift) > 1e-9 ? { leader: {
        start: at(body.angle, M.radius.hub + M.tick.hubOutward),
        end: at(shifted, lastUnits - M.tick.leaderTipInset),
      } } : {}),
      tickPaint: resolveLine(leaderEdit, "bodies.inner.leader", M.stroke.tick, body.color, s),
      leaderPaint: resolveLine(leaderEdit, "bodies.inner.leader", M.stroke.leader, body.color, s),
    };
  });

  const houseNumbers: VintageWheelLayout["houseNumbers"] = [];
  const captions: VintageText[] = [];
  const cuspLines: VintageWheelLayout["cuspLines"] = [];
  const angleRays: VintageWheelLayout["angleRays"] = [];
  const angleIds = ["asc", "mc", "dsc", "ic"] as const;
  const angleWidth = { asc: M.stroke.asc, mc: M.stroke.mc, dsc: M.stroke.dsc, ic: M.stroke.ic };
  const isAngle = (angle: number) => angleIds.some(id => Math.abs(normalize(angle - input.angles[id] + 180) - 180) < 1e-6);

  if (input.showHouses) {
    const cuspPaint = resolveLine(lineEdits["houses.inner.cusp"], "houses.inner.cusp", M.stroke.houseCusp, colors.houses, s);
    input.cusps.forEach((cusp, i) => {
      if (!Number.isFinite(cusp.angle)) return;
      if (!isAngle(cusp.angle)) {
        cuspLines.push({ houseIndex: i + 1, start: at(cusp.angle, M.radius.hub), end: at(cusp.angle, M.radius.cusp),
          width: cuspPaint.width, paint: cuspPaint });
      }
      const next = input.cusps[(i + 1) % input.cusps.length]?.angle;
      const extent = Number.isFinite(next) ? normalize(next - cusp.angle) : 30;
      houseNumbers.push({ houseIndex: i + 1, text: placeText(measure,
        [textRun("houses.inner.label", String(i + 1), colors.houseNumbers)],
        at(cusp.angle + extent / 2, M.radius.label), false, `house:${i + 1}:label`) });
    });
  }
  if (input.showCaptions) {
    input.cusps.forEach((cusp, i) => {
      if (!cusp.caption || !Number.isFinite(cusp.angle)) return;
      const anchor = at(cusp.angle, M.radius.label);
      // Both rows are upright: degree and minute above, sign below.
      captions.push(placeText(measure, [
        textRun("houses.inner.position.degree", `${cusp.caption.degText}°`, colors.positions),
        textRun("houses.inner.position.minute", minuteText(cusp.caption.minText), colors.positions),
      ], [anchor[0], anchor[1] + r(M.captionRows.upper)], true, `house:${i + 1}:position`));
      if (cusp.caption.signGlyph) {
        captions.push(placeText(measure, [textRun("houses.inner.position.sign", cusp.caption.signGlyph, cusp.caption.signColor ?? colors.positions)],
          [anchor[0], anchor[1] + r(M.captionRows.lower)], true, `house:${i + 1}:position:sign`));
      }
    });
  }
  const rayEdit = lineEdits["angles.inner.ray"];
  const arrowEdit = lineEdits["angles.inner.arrowhead"];
  const arrowSize = arrowEdit?.arrowSize != null && Number.isFinite(arrowEdit.arrowSize)
    ? Math.max(0.25, arrowEdit.arrowSize) : 1;
  for (const id of angleIds) {
    const angle = input.angles[id];
    if (!Number.isFinite(angle)) continue;
    const arrowed = input.showArrowheads && (id === "asc" || id === "mc");
    const paint = resolveLine(rayEdit, "angles.inner.ray", angleWidth[id], colors.angles, s);
    let arrow: [Pt, Pt, Pt] | undefined;
    if (arrowed) {
      const end = at(angle, M.radius.cusp - M.arrow.tipInset);
      const base = at(angle, M.radius.cusp - M.arrow.tipInset - (M.arrow.baseInset - M.arrow.tipInset) * arrowSize);
      const dx = end[0] - base[0], dy = end[1] - base[1];
      const length = Math.hypot(dx, dy) || 1;
      const half = r(M.arrow.halfWidth * arrowSize);
      const tangent: Pt = [-dy / length * half, dx / length * half];
      arrow = [[base[0] + tangent[0], base[1] + tangent[1]], end, [base[0] - tangent[0], base[1] - tangent[1]]];
    }
    angleRays.push({ angleId: id, start: at(angle, M.radius.hub), end: at(angle, M.radius.cusp), width: paint.width, paint,
      ...(arrow ? { arrow, arrowPaint: resolveLine(arrowEdit, "angles.inner.arrowhead", M.stroke.arrow, colors.angles, s) } : {}) });
  }
  return { scale: s, circles: vintageCircles(input.radius, input.classes, colors.circles),
    bodies, houseNumbers, captions, cuspLines, angleRays };
}

function line(ctx: CanvasRenderingContext2D, start: Pt, end: Pt, paint: VintageLinePaint) {
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.lineWidth = paint.width;
  ctx.strokeStyle = paint.color;
  ctx.globalAlpha = paint.opacity;
  ctx.lineCap = paint.cap;
  ctx.setLineDash(paint.dash);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintTexts(ctx: CanvasRenderingContext2D, texts: readonly VintageText[], background: string, scale: number) {
  const pad = M.knockout * scale;
  ctx.fillStyle = background;
  for (const t of texts) if (t.knockout) ctx.fillRect(t.x - pad, t.y - pad, t.w + pad * 2, t.h + pad * 2);
  for (const t of texts) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.translate(t.anchor[0], t.anchor[1]);
    for (const part of t.parts) {
      ctx.font = fontSpec(part.spec.weight, part.spec.size, part.spec.font, part.spec.style);
      ctx.fillStyle = part.spec.color;
      ctx.globalAlpha = part.spec.opacity;
      ctx.fillText(part.text, part.dx, t.dy);
    }
    ctx.restore();
  }
}

/** Geometry layer: paper, the three circles, cusp lines, angles, house numbers, cusp captions. */
export function paintVintageGeometry(ctx: CanvasRenderingContext2D, input: VintageWheelInput, layout: VintageWheelLayout) {
  const s = layout.scale;
  const { center, colors } = input;
  ctx.save();
  ctx.lineJoin = "miter";
  for (const circle of layout.circles) {
    ctx.beginPath();
    ctx.arc(center[0], center[1], circle.radius, 0, Math.PI * 2);
    ctx.lineWidth = circle.paint.width;
    ctx.strokeStyle = circle.paint.color;
    ctx.globalAlpha = circle.paint.opacity;
    ctx.lineCap = circle.paint.cap;
    ctx.setLineDash(circle.paint.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  for (const cusp of layout.cuspLines) line(ctx, cusp.start, cusp.end, cusp.paint);
  for (const ray of layout.angleRays) {
    line(ctx, ray.start, ray.end, ray.paint);
    if (ray.arrow && ray.arrowPaint) {
      line(ctx, ray.arrow[0], ray.arrow[1], ray.arrowPaint);
      line(ctx, ray.arrow[2], ray.arrow[1], ray.arrowPaint);
    }
  }
  paintTexts(ctx, [...layout.houseNumbers.map(number => number.text), ...layout.captions], colors.background, s);
  ctx.restore();
}

/** An aspect chord's stroke. A width edit scales the orb-thinning range with it. */
export function vintageAspectPaint(
  aspect: Pick<VintageAspect, "type" | "orbRatio"> & Partial<Pick<VintageAspect, "color" | "opacity">>,
  scale: number, edit?: VintageLineOverride,
): VintageLinePaint {
  const exact = edit?.width != null && Number.isFinite(edit.width) ? Math.max(0, edit.width) : M.aspect.exactWidth;
  const ratio = exact / M.aspect.exactWidth;
  const width = aspect.orbRatio == null ? M.aspect.width * ratio
    : (M.aspect.widestWidth + (M.aspect.exactWidth - M.aspect.widestWidth) * (1 - aspect.orbRatio)) * ratio;
  const paint = resolveLine(edit, "aspects.primary.line", 1, aspect.color ?? "", scale, M.aspect.dash[aspect.type] ?? []);
  return { ...paint, width: width * scale, opacity: paint.opacity * (aspect.opacity ?? 1) };
}

/** Dynamic layer: aspect chords, body ticks and leaders, radial stacks, motion markers. */
export function paintVintageDynamic(
  ctx: CanvasRenderingContext2D, input: VintageWheelInput, layout: VintageWheelLayout, aspects: readonly VintageAspect[],
) {
  const s = layout.scale;
  const hub = (angle: number) => polar(input.center, M.radius.hub * s, angle, input.frame);
  const aspectEdit = input.classes?.line?.["aspects.primary.line"];
  ctx.save();
  ctx.lineJoin = "miter";
  for (const aspect of aspects) {
    line(ctx, hub(aspect.angle1), hub(aspect.angle2), vintageAspectPaint(aspect, s, aspectEdit));
  }
  for (const body of layout.bodies) {
    for (const tick of body.ticks) line(ctx, tick.start, tick.end, body.tickPaint);
    if (body.leader) line(ctx, body.leader.start, body.leader.end, body.leaderPaint);
  }
  for (const body of layout.bodies) paintTexts(ctx, [body.glyph, ...body.texts], input.colors.background, s);
  ctx.restore();
}
