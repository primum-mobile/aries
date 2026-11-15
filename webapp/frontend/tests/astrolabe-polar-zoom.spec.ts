// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import {
  astrolabeZoomMetrics, starPointerInView, starPointerMetrics, viewRect, type AstrolabeZoom,
} from "../src/components/workshell/astrolabe-canvas";
import { renderPolarAzimuthal } from "../src/components/workshell/astrolabe-polar-render";
import { createAstrolabeRenderStyle, DEFAULT_ASTROLABE_RENDER_TOKENS } from "../src/lib/chart/astrolabe-render-style";
import type { PolarAzimuthalGeometry, PolarAzimuthalObject } from "../src/lib/daemon/client";
import polarFixture from "../src/design-lab/fixtures/morinus/astrolabe-polar.json";

type Command = [string, ...number[]];
class RecordingContext {
  path: Command[] = [];
  strokes: Array<{ path: Command[]; ink: string; width: number }> = [];
  texts: Array<{ text: string; x: number; y: number; size: number; ink: string; opacity: number }> = [];
  font = "normal 400 14px TestUI";
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  textBaseline = "middle";
  textAlign = "left";
  globalAlpha = 1;
  stack: Array<Pick<RecordingContext, "font" | "fillStyle" | "strokeStyle" | "lineWidth" | "textBaseline" | "globalAlpha">> = [];
  get fontSize() { return Number(this.font.match(/([\d.]+)px/)?.[1] ?? 14); }
  save() {
    this.stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, textBaseline: this.textBaseline, globalAlpha: this.globalAlpha });
  }
  restore() { Object.assign(this, this.stack.pop()!); }
  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push(["M", x, y]); }
  lineTo(x: number, y: number) { this.path.push(["L", x, y]); }
  arc(x: number, y: number, r: number) { this.path.push(["A", x, y, r]); }
  stroke() { this.strokes.push({ path: [...this.path], ink: this.strokeStyle, width: this.lineWidth }); }
  fillText(text: string, x: number, y: number) {
    this.texts.push({ text, x, y, size: this.fontSize, ink: this.fillStyle, opacity: this.globalAlpha });
  }
  measureText(text: string) {
    const width = text.length * this.fontSize * 0.6;
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width,
      actualBoundingBoxAscent: this.fontSize / 2, actualBoundingBoxDescent: this.fontSize / 2 };
  }
  setLineDash() {}
  closePath() {}
  fill() {}
  clip() {}
  fillRect() {}
  rect() {}
  setTransform() {}
  get canvas() { return { width: 0, height: 0, style: {}, getContext: () => this } as unknown as HTMLCanvasElement; }
}

const bodyColor = "#123456";
const style = () => createAstrolabeRenderStyle({ fontUi: "TestUI", fontSymbols: "TestSymbols" });
const t = ((key: string) => key) as Parameters<typeof renderPolarAzimuthal>[7];
const toggles = {
  atmospheric: false, almucantars: false, azimuths: false, stars: false,
  earthMap: false, declinationCircles: false, zodiacalHorizon: false, zodiacalMeridian: false,
};
const centeredZoom = (k: number): AstrolabeZoom => ({ k, x: 450 * (1 - k), y: 400 * (1 - k) });
const body = (id = "planet:4", glyph = "M"): PolarAzimuthalObject => ({
  id, family: "body", bodyId: 4, ra: 0, decl: 0, ha: 90, x: 0.1, y: 0.08,
  glyph, glyphFont: "symbol", color: bodyColor, above: true,
  hoverName: id, hoverPosition: "10°",
});
function paint(objects: PolarAzimuthalObject[], zoom: AstrolabeZoom, layers = {}) {
  const geo = structuredClone(polarFixture) as unknown as PolarAzimuthalGeometry;
  geo.objects = objects; geo.stars = [];
  geo.zodiacSigns = geo.zodiacDivisions!.terms.filter((entry) => entry.index === 0)
    .map((entry) => ({ ...entry.boundary, sign: entry.sign, glyph: `sign:${entry.sign}`,
      tx: entry.boundary.tx!, ty: entry.boundary.ty! }));
  geo.zodiacDegrees = geo.zodiacDivisions!.decans.map((entry) => ({
    ...entry.boundary, sign: entry.sign, degree: entry.index * 10, label: `${entry.index * 10}°`,
    tx: entry.boundary.tx!, ty: entry.boundary.ty!,
  }));
  const ctx = new RecordingContext();
  // No live sky here: every frame paints (only the app's live plate waits for the GPU).
  const targets = renderPolarAzimuthal(ctx.canvas, geo, null, { ...toggles, ...layers }, 900, 800, style(), t, 1, 0, 1, zoom)!;
  return { ctx, targets };
}

test("polar zodiac toggle hides only sign labels and leaves the ecliptic and terms intact", () => {
  const shown = paint([], centeredZoom(1), { zodiacWheel: true, terms: true });
  const hidden = paint([], centeredZoom(1), { zodiacWheel: false, terms: true });
  const signs = (result: ReturnType<typeof paint>) => result.ctx.texts.filter(({ text }) => text.startsWith("sign:"));
  expect(signs(shown)).toHaveLength(12);
  expect(signs(hidden)).toHaveLength(0);
  expect(shown.ctx.strokes).toEqual(expect.arrayContaining(hidden.ctx.strokes));
  const existingStrokes = new Set(hidden.ctx.strokes.map((stroke) => JSON.stringify(stroke)));
  const signTicks = shown.ctx.strokes.filter((stroke) => !existingStrokes.has(JSON.stringify(stroke)));
  expect(signTicks).toHaveLength(12);
  for (const [index, { path }] of signTicks.entries()) {
    const [, x0, y0] = path[0], [, x1, y1] = path[1];
    const glyph = signs(shown)[index];
    // Each glyph's centre lies on its boundary tick, with no sideways drift.
    const distance = Math.abs((glyph.x - x0) * (y1 - y0) - (glyph.y - y0) * (x1 - x0))
      / Math.hypot(x1 - x0, y1 - y0);
    expect(distance).toBeLessThan(1); // CanvasDraw snaps to CSS pixels.
  }
  expect(shown.ctx.texts.filter(({ text }) => !text.startsWith("sign:"))).toEqual(hidden.ctx.texts);
  expect(signs(shown).every(({ ink }) => ink === style().palette.ecliptic)).toBe(true);
});

test("polar sign-start labels fade in with zoom in either zodiac ring state and clear decans", () => {
  const labels = (result: ReturnType<typeof paint>) => result.ctx.texts.filter(({ text }) => /^\d+°$/.test(text));
  for (const k of [1, 2]) expect(labels(paint([], centeredZoom(k), { zodiacWheel: true }))).toHaveLength(0);
  const fitted = paint([], centeredZoom(1), { zodiacWheel: true }).ctx.texts.find(({ text }) => text === "sign:0")!;
  const focusZoom = (k: number) => ({ k, x: 450 - fitted.x * k, y: 400 - fitted.y * k });
  const fading = labels(paint([], focusZoom(2.4), { zodiacWheel: true }));
  const shown = labels(paint([], focusZoom(2.8), { zodiacWheel: true }));
  expect(new Set(shown.map(({ text }) => text))).toEqual(new Set(["0°"]));
  expect(shown.every(({ size, ink }) => size <= 9 && ink === style().palette.ecliptic)).toBe(true);
  const zero = shown.find(({ text }) => text === "0°")!;
  expect(zero.opacity).toBeCloseTo(0.68);
  expect(fading.find(({ text }) => text === "0°")!.opacity).toBeCloseTo(0.34);
  expect(labels(paint([], focusZoom(2.8), { zodiacWheel: false }))).toEqual(shown);
  expect(labels(paint([], { k: 12, x: 0, y: 0 }, { zodiacWheel: true }))).toHaveLength(0);
  const withDecans = labels(paint([], focusZoom(2.8), { zodiacWheel: true, decans: true }));
  const displaced = withDecans.find(({ text }) => text === "0°")!;
  expect(Math.hypot(displaced.x - zero.x, displaced.y - zero.y)).toBeGreaterThan(zero.size);
});

test("polar sign identifiers grow gently with zoom and clear the visible term band", () => {
  const atOne = paint([], centeredZoom(1), { zodiacWheel: true });
  const first = atOne.ctx.texts.find(({ text }) => text === "sign:0")!;
  // Keep the sign boundary visible while zooming the same plate geometry.
  const zoomed = paint([], { k: 2.8, x: 450 - first.x * 2.8, y: 400 - first.y * 2.8 }, { zodiacWheel: true });
  const last = zoomed.ctx.texts.find(({ text }) => text === "sign:0")!;
  // CanvasDraw rounds font sizes to CSS pixels.
  expect(Math.abs(last.size - first.size * 2.8 ** 0.48)).toBeLessThan(1);
  expect(last.size / first.size).toBeLessThan(2.8);
  const withTerms = paint([], centeredZoom(1), { zodiacWheel: true, terms: true });
  const displaced = withTerms.ctx.texts.find(({ text }) => text === "sign:0")!;
  expect(Math.hypot(displaced.x - first.x, displaced.y - first.y)).toBeGreaterThan(first.size / 2);
  expect(paint([], { k: 12, x: 0, y: 0 }, { zodiacWheel: true }).ctx.texts
    .filter(({ text }) => text.startsWith("sign:"))).toHaveLength(0);
});

test("zoom metrics honor authored curves with modest star and name growth", () => {
  const renderStyle = style();
  const atOne = astrolabeZoomMetrics(1, renderStyle);
  expect(Object.values(atOne)).toEqual([1, 1, 1, 1, 1]);
  const atTwelve = astrolabeZoomMetrics(12, renderStyle);
  expect(atTwelve.sphere).toBeCloseTo(Math.sqrt(12));
  expect(atTwelve.glyph).toBeCloseTo(2.5);
  expect(atTwelve.star).toBeCloseTo(1.6);
  expect(atTwelve.starLabel).toBeCloseTo(1.3);
  const authored = createAstrolabeRenderStyle({ tokens: {
    ...DEFAULT_ASTROLABE_RENDER_TOKENS, zoomStarExponent: 0.1, zoomStarCap: 1.2,
    zoomStarLabelExponent: 0, zoomStarLabelCap: 1,
  } });
  expect(astrolabeZoomMetrics(12, authored).star).toBeCloseTo(1.2);
  expect(astrolabeZoomMetrics(12, authored).starLabel).toBe(1);
});

test("star paint metrics retain magnitude hierarchy, faint label sizes and long edge names", () => {
  const renderStyle = style();
  const bright = starPointerMetrics(5, 0, 10, renderStyle);
  const faint = starPointerMetrics(5, 5, 10, renderStyle);
  expect(bright.radius).toBeGreaterThan(faint.radius);
  expect(bright.labelOffset).toBeCloseTo(bright.radius * 1.3);
  expect(faint.labelSize).toBe(8.5);
  expect(starPointerMetrics(5, 5, 10, renderStyle, true).bright).toBe(true);
  const longName = "A long localized catalogue star name";
  expect(starPointerInView(viewRect(100, 100, 0), -160, 50, bright, longName)).toBe(true);
  expect(starPointerInView(viewRect(100, 100, 0), -160, 50, bright, "")).toBe(false);
  expect(starPointerInView(viewRect(100, 100, 0), 120, 50, bright, longName)).toBe(false);
});

test("polar planets grow at their exact projected centres while strokes retain their width", () => {
  const object = body();
  const fitted = paint([object], centeredZoom(1));
  const zoomed = paint([object], centeredZoom(12));
  const marker = (result: ReturnType<typeof paint>) => result.targets.find((target) => target.name === object.id)!;
  const first = marker(fitted), last = marker(zoomed);
  expect(last.x - 450).toBeCloseTo((first.x - 450) * 12);
  expect(last.y - 400).toBeCloseTo((first.y - 400) * 12);
  expect(last.width! / first.width!).toBeCloseTo(Math.sqrt(12));
  const bodyStroke = (result: ReturnType<typeof paint>) => result.ctx.strokes.find((stroke) => (
    stroke.ink === bodyColor && stroke.path.length === 1 && stroke.path[0][0] === "A"
  ))!;
  expect(bodyStroke(zoomed).width).toBe(bodyStroke(fitted).width);
  const firstGlyph = fitted.ctx.texts.find(({ text }) => text === object.glyph)!;
  const lastGlyph = zoomed.ctx.texts.find(({ text }) => text === object.glyph)!;
  expect(lastGlyph.size / firstGlyph.size).toBeGreaterThan(2.3);
});

test("local polar identifiers replace only fully offscreen rim labels and retain Inspector identity", () => {
  const object = body();
  for (const k of [1, 2, 12]) {
    const { ctx, targets } = paint([object], centeredZoom(k));
    const labels = ctx.texts.filter(({ text }) => text === object.glyph);
    expect(labels).toHaveLength(1);
    const labelTarget = targets.find((target) => target.name === object.id
      && target.width! > target.height! / 2 && Math.abs(target.x - labels[0].x) < labels[0].size)!;
    expect(labelTarget).toBeDefined();
    expect(labelTarget.inspector).toEqual({ kind: "planet", seId: 4 });
    if (k === 12) {
      expect(labels[0].x).toBeGreaterThanOrEqual(0);
      expect(labels[0].x).toBeLessThanOrEqual(900);
      expect(labels[0].y).toBeGreaterThanOrEqual(0);
      expect(labels[0].y).toBeLessThanOrEqual(800);
    }
  }
  const hidden = paint([object], { k: 12, x: 0, y: 0 });
  expect(hidden.ctx.texts.filter(({ text }) => text === object.glyph)).toHaveLength(0);
});

test("deep zoom names the Asc marker locally in the frame-point signal colour", () => {
  const asc: PolarAzimuthalObject = {
    id: "angle:asc", family: "angle", ra: 25.46, decl: 10.58, ha: -101.15, x: -0.8657, y: 0.1706,
    glyph: "Asc", glyphFont: "text", above: true, hoverName: "Asc", hoverPosition: "",
  };
  const renderStyle = style();
  const atOne = paint([asc, body()], centeredZoom(1));
  const rim = atOne.ctx.texts.filter(({ text }) => text === "Asc");
  expect(rim).toHaveLength(1);
  expect(rim[0].ink).toBe(renderStyle.palette.horizon);
  expect(rim[0].size).toBeLessThan(atOne.ctx.texts.find(({ text }) => text === "M")!.size);
  const marker = atOne.targets.find((target) => target.name === "Asc")!;
  const zoomed = paint([asc], { k: 12, x: 450 - 12 * marker.x, y: 400 - 12 * marker.y });
  expect(zoomed.ctx.texts.filter(({ text }) => text === "Asc")).toHaveLength(0);
  const local = zoomed.ctx.texts.filter(({ text }) => text === "astrolabe.ascendant");
  expect(local).toHaveLength(1);
  expect(local[0].ink).toBe(renderStyle.palette.equatorLabel);
  // Upright end label continuing the outer (east) tip: it ends left of the marker.
  expect(local[0].x).toBeGreaterThanOrEqual(0);
  expect(local[0].x + local[0].text.length * local[0].size * 0.6).toBeLessThan(450);
  expect(Math.abs(local[0].y - 400)).toBeLessThan(80);
});

test("nearby polar labels avoid each other without moving exact point markers", () => {
  const a = body("planet:4", "M"), b = { ...body("planet:5", "J"), bodyId: 5 };
  const { ctx, targets } = paint([a, b], centeredZoom(12));
  const markerA = targets.find((target) => target.name === a.id)!;
  const markerB = targets.find((target) => target.name === b.id)!;
  expect([markerA.x, markerA.y]).toEqual([markerB.x, markerB.y]);
  const aLabel = ctx.texts.find(({ text }) => text === a.glyph)!;
  const bLabel = ctx.texts.find(({ text }) => text === b.glyph)!;
  expect(aLabel).toBeDefined(); expect(bLabel).toBeDefined();
  const aBox = targets.findLast((target) => target.name === a.id)!;
  const bBox = targets.findLast((target) => target.name === b.id)!;
  const overlapsX = Math.abs(aBox.x - bBox.x) < (aBox.width! + bBox.width!) / 2;
  const overlapsY = Math.abs(aBox.y - bBox.y) < (aBox.height! + bBox.height!) / 2;
  expect(overlapsX && overlapsY).toBe(false);
  for (const label of [aBox, bBox]) for (const marker of [markerA, markerB]) {
    const overlapX = Math.abs(label.x - marker.x) < (label.width! + marker.width!) / 2;
    const overlapY = Math.abs(label.y - marker.y) < (label.height! + marker.height!) / 2;
    expect(overlapX && overlapY).toBe(false);
  }
});

test("local polar identifiers stay visible near every viewport edge", () => {
  const object = body();
  const initial = paint([object], centeredZoom(12));
  const marker = initial.targets.find((target) => target.name === object.id)!;
  for (const [x, y] of [[4, 400], [896, 400], [450, 4], [450, 796]]) {
    const zoom = centeredZoom(12);
    zoom.x += x - marker.x; zoom.y += y - marker.y;
    const { ctx, targets } = paint([object], zoom);
    expect(ctx.texts.filter(({ text }) => text === object.glyph)).toHaveLength(1);
    const local = targets.findLast((target) => target.name === object.id)!;
    expect(local.x - local.width! / 2).toBeGreaterThanOrEqual(0);
    expect(local.x + local.width! / 2).toBeLessThanOrEqual(900);
    expect(local.y - local.height! / 2).toBeGreaterThanOrEqual(0);
    expect(local.y + local.height! / 2).toBeLessThanOrEqual(800);
  }
});

test("a partly visible rim label suppresses the local duplicate", () => {
  const object = body("planet:4", "MMMM");
  const zoom = { k: 2, x: -800, y: -400 };
  const initial = paint([object], zoom);
  const firstLabel = initial.ctx.texts.find(({ text }) => text === object.glyph)!;
  const marker = initial.targets.find((target) => target.name === object.id)!;
  expect(firstLabel.x - marker.x).toBeGreaterThan(100);
  zoom.x += 890 - firstLabel.x;
  const { ctx, targets } = paint([object], zoom);
  const labels = ctx.texts.filter(({ text }) => text === object.glyph);
  expect(labels).toHaveLength(1);
  expect(labels[0].x).toBe(890);
  const rimTarget = targets.findLast((target) => target.name === object.id)!;
  expect(rimTarget.x - rimTarget.width! / 2).toBeLessThan(900);
  expect(rimTarget.x + rimTarget.width! / 2).toBeGreaterThan(900);
});
