// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { createAstrolabeReteSurface, hitAstrolabeRete, drawVisibleRulerTick, traceDiscInBox, traceVisibleCircle, traceVisiblePolyline, viewRect } from "../src/components/workshell/astrolabe-canvas";
import { CanvasDraw } from "../src/lib/chart/canvas-draw";
import { renderStereographicAstrolabe } from "../src/components/workshell/astrolabe-view";
import { renderPolarAzimuthal } from "../src/components/workshell/astrolabe-polar-render";
import { createAstrolabeRenderStyle } from "../src/lib/chart/astrolabe-render-style";
import { ASTROLABE_SKY_DEFAULT, ASTROLABE_SKY_SHADERS, astrolabeSkyLayer, skyPictureSizes } from "../src/components/workshell/astrolabe-sky";
import {
  createPaletteLookup, ditherAtkinson, ditherAtkinsonFloat32, ditherPlatePicture, ditherWorkLength, medianCutPalette,
  paletteLookupTable, paletteSampleStep, platePalette, platePaletteOfSamples,
} from "../src/components/workshell/astrolabe-sky-dither";
import type { AstrolabeGeometry, PolarAzimuthalGeometry } from "../src/lib/daemon/client";
import stereoFixture from "../src/design-lab/fixtures/morinus/astrolabe-stereographic.json";
// The plate lines (daemon astrolabe_plate_lines) for that fixture's plate.
import plateLinesFixture from "../src/design-lab/fixtures/morinus/astrolabe-plate-lines.json";
import polarFixture from "../src/design-lab/fixtures/morinus/astrolabe-polar.json";

type Command = [string, ...number[]];
class RecordingContext {
  path: Command[] = [];
  strokes: Array<{ path: Command[]; dash: number[]; ink: unknown }> = [];
  texts: string[] = [];
  measured: string[] = [];
  font = "14px Test";
  globalAlpha = 1;
  strokeStyle: unknown = "";
  fillStyle: unknown = "";
  /** Strokes and fills in paint order, by ink. */
  events: string[] = [];
  dash: number[] = [];
  stack: Array<{ alpha: number; ink: unknown; dash: number[] }> = [];
  save() { this.stack.push({ alpha: this.globalAlpha, ink: this.strokeStyle, dash: this.dash }); }
  restore() {
    const state = this.stack.pop()!;
    this.globalAlpha = state.alpha; this.strokeStyle = state.ink; this.dash = state.dash;
  }
  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push(["M", x, y]); }
  lineTo(x: number, y: number) { this.path.push(["L", x, y]); }
  arc(x: number, y: number, r: number, start = 0, end = Math.PI * 2) {
    this.path.push(["A", x, y, r, start, end]);
  }
  stroke() {
    this.strokes.push({ path: [...this.path], dash: this.dash, ink: this.strokeStyle });
    this.events.push(`stroke:${String(this.strokeStyle)}`);
  }
  setLineDash(dash: number[]) { this.dash = dash; }
  fillText(text: string) {
    this.texts.push(text);
    this.events.push(`text:${text}`);
  }
  measureText(text: string) {
    this.measured.push(text);
    return { width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
  }
  createLinearGradient() { return { addColorStop() {} }; }
  closePath() {}
  fill(rule: CanvasFillRule = "nonzero") { this.events.push(`fill:${String(this.fillStyle)}:${rule}`); }
  clip() {}
  fillRect() {}
  rect() {}
  setTransform() {}
  get ctx() { return this as unknown as CanvasRenderingContext2D; }
  get canvas() { return { width: 0, height: 0, style: {}, getContext: () => this.ctx } as unknown as HTMLCanvasElement; }
}

test("crossing segments reach the viewport edges without joining separate branches", () => {
  const ctx = new RecordingContext();
  traceVisiblePolyline(ctx.ctx, [[-1000, 30], [1000, 30], [1000, 70], [-1000, 70]], viewRect(100, 100, 0));
  expect(ctx.path).toEqual([["M", 0, 30], ["L", 100, 30], ["M", 100, 70], ["L", 0, 70]]);
});

test("ruler culling preserves snapped crossing ticks and thick edge ink", () => {
  const ctx = new RecordingContext();
  const draw = new CanvasDraw(ctx.canvas);
  const view = viewRect(100, 100, 0);
  drawVisibleRulerTick(draw, view, [-100.2, 30.4], [200.2, 30.4], "ink", 1);
  drawVisibleRulerTick(draw, view, [-2.2, 20], [-2.2, 80], "ink", 6);
  drawVisibleRulerTick(draw, view, [-30, 20], [-20, 80], "ink", 6);
  drawVisibleRulerTick(draw, view, [20, 120], [80, 130], "ink", 1);
  expect(ctx.strokes.map(({ path }) => path)).toEqual([
    [["M", -100, 30], ["L", 200, 30]],
    [["M", -2, 20], ["L", -2, 80]],
  ]);
});

test("deep-zoom circles trace exact visible arcs and omit invisible circles", () => {
  const ctx = new RecordingContext();
  const view = viewRect(100, 100, 0);
  traceVisibleCircle(ctx.ctx, -950, 50, 1000, view);
  expect(ctx.path.length).toBeGreaterThan(1);
  for (const [kind, x, y, r, start, end] of ctx.path) {
    if (kind !== "A") continue;
    for (let i = 0; i <= 8; i++) {
      const angle = start + (end - start) * i / 8;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      expect(px).toBeGreaterThanOrEqual(-1e-8); expect(px).toBeLessThanOrEqual(100 + 1e-8);
      expect(py).toBeGreaterThanOrEqual(-1e-8); expect(py).toBeLessThanOrEqual(100 + 1e-8);
    }
  }
  ctx.beginPath();
  traceVisibleCircle(ctx.ctx, 50, 50, 1000, view);
  traceVisibleCircle(ctx.ctx, -1000, -1000, 10, view);
  expect(ctx.path).toEqual([]);
});

test("circle clipping keeps every visible branch with a bounded number of native arcs", () => {
  const view = viewRect(100, 100, 0);
  for (const [cx, cy, radius] of [[50, 50, 60], [-950, 50, 1000], [-59950, 50, 60000], [-999950, 50, 1000000]]) {
    const ctx = new RecordingContext();
    traceVisibleCircle(ctx.ctx, cx, cy, radius, view);
    const arcs = ctx.path.filter(([kind]) => kind === "A");
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.length).toBeLessThanOrEqual(8);
    expect(ctx.path.some(([kind]) => kind === "L")).toBe(false);
    // Dense reference points check visible coverage, including disjoint arcs.
    for (let i = 0; i < 3600; i++) {
      const angle = i * Math.PI / 1800;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const visible = x >= 0 && x <= 100 && y >= 0 && y <= 100;
      const traced = arcs.some(([, , , , start, end]) => angle >= start && angle <= end);
      expect(traced).toBe(visible);
    }
  }
});

// An equatorial plate's horizon: a near-straight circle far past single precision.
const FLAT: Array<[number, number, number]> = [[50, 50 - 1e8, 1e8], [50, 30 + 3e9, 3e9], [-4e7, 50, 4e7 + 50]];

test("near-straight circles past single precision are traced as exact polylines", () => {
  const view = viewRect(100, 100, 0);
  for (const [cx, cy, radius] of FLAT) {
    const ctx = new RecordingContext();
    traceVisibleCircle(ctx.ctx, cx, cy, radius, view);
    expect(ctx.path.some(([kind]) => kind === "A")).toBe(false);
    const points = ctx.path.map(([, x, y]) => [x, y]);
    expect(points.length).toBeGreaterThan(20);
    expect(points.length).toBeLessThanOrEqual(2 * 4097);
    for (const [x, y] of points) {
      expect(Math.abs(Math.hypot(x - cx, y - cy) - radius)).toBeLessThan(1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(100 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(100 + 1e-6);
    }
    // No visible stretch is skipped: consecutive points stay a few px apart.
    for (let i = 1; i < ctx.path.length; i++) {
      if (ctx.path[i][0] === "L") expect(Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])).toBeLessThan(3);
    }
  }
});

test("a near-straight disc limited to a box is filled exactly", () => {
  const box = { x0: -2, y0: -2, x1: 102, y1: 102 };
  for (const [cx, cy, radius] of [...FLAT, [50, -1e7, 1e7 + 150] as [number, number, number],
    [50, -1e7, 1e7 - 150] as [number, number, number], [50, 50, 30] as [number, number, number]]) {
    const commands: Array<[string, number, number]> = [];
    const ctx = {
      moveTo: (x: number, y: number) => commands.push(["M", x, y]),
      lineTo: (x: number, y: number) => commands.push(["L", x, y]),
      arc: (x: number, y: number) => commands.push(["A", x, y]),
      rect: (x: number, y: number) => commands.push(["R", x, y]),
      closePath: () => commands.push(["Z", 0, 0]),
    } as unknown as CanvasRenderingContext2D;
    traceDiscInBox(ctx, cx, cy, radius, box);
    if (radius <= 1e6) {
      expect(commands.map(([kind]) => kind)).toEqual(["M", "A"]);
      continue;
    }
    const kinds = new Set(commands.map(([kind]) => kind));
    if (kinds.has("R")) {
      expect(Math.hypot(50 - cx, 50 - cy)).toBeLessThan(radius);
      continue;
    }
    if (commands.length === 0) {
      expect(Math.hypot(50 - cx, 50 - cy)).toBeGreaterThan(radius);
      continue;
    }
    const polygon = commands.filter(([kind]) => kind === "M" || kind === "L").map(([, x, y]) => [x, y]);
    const inPolygon = (px: number, py: number) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    for (let gx = -1.5; gx <= 101.5; gx += 1.7) {
      for (let gy = -1.5; gy <= 101.5; gy += 1.3) {
        const off = Math.hypot(gx - cx, gy - cy) - radius;
        if (Math.abs(off) < 1e-3) continue;
        expect(inPolygon(gx, gy)).toBe(off < 0);
      }
    }
  }
});

const toggles = {
  atmospheric: true, regioHouses: true, zodiacWheel: true, terms: true, decans: true, almucantars: true,
  azimuths: true, hourLines: true, stars: true, asterisms: false, starLabels: "all" as const,
  earthMap: true, declinationCircles: true, zodiacalHorizon: true, zodiacalMeridian: true, fullSphere: false,
  pdReprojection: false,
};
const t = ((key: string) => key) as Parameters<typeof renderStereographicAstrolabe>[6];

test("polar zodiac is one filled drag band between signs and across all internal gaps", () => {
  const style = createAstrolabeRenderStyle();
  const geo = structuredClone(polarFixture) as unknown as PolarAzimuthalGeometry;
  geo.zodiacSigns = geo.zodiacDivisions!.terms.filter((entry) => entry.index === 0).map((entry) => ({
    ...entry.boundary, sign: entry.sign, glyph: "A", tx: entry.boundary.tx!, ty: entry.boundary.ty!,
  }));
  const paint = (zoom: { k: number; x: number; y: number }) => {
    const surface = createAstrolabeReteSurface(), ctx = new RecordingContext();
    renderPolarAzimuthal(ctx.canvas, geo, null, toggles, 900, 800, style, t, 1, 0, 1, zoom, surface);
    return surface;
  };
  const fitted = paint({ k: 1, x: 0, y: 0 });
  const p0 = geo.ecliptic[0][0], p15 = geo.ecliptic[0][15];
  const first = fitted.segments[1];
  const scale = Math.hypot(first[0] - fitted.center[0], first[1] - fitted.center[1]) / Math.hypot(...p0);
  const focus = [fitted.center[0] + p15[0] * scale, fitted.center[1] + p15[1] * scale];
  const firstGlyph = fitted.markers[0];
  const gap = Math.hypot(firstGlyph.x - first[0], firstGlyph.y - first[1]);
  const before = geo.ecliptic[0][14], after = geo.ecliptic[0][16];
  const dx = after[0] - before[0], dy = after[1] - before[1], length = Math.hypot(dx, dy);
  let nx = -dy / length, ny = dx / length;
  if (nx * p15[0] + ny * p15[1] < 0) { nx *= -1; ny *= -1; }
  for (const k of [1, 4, 12]) {
    const surface = paint({ k, x: 450 - focus[0] * k, y: 400 - focus[1] * k });
    const size = firstGlyph.size * Math.min(1.8, k ** 0.48);
    const bandEdge = (gap - firstGlyph.size * 0.75) * k;
    const outer = Math.max(bandEdge + 20, bandEdge + size * 1.25 + 5);
    for (let offset = -bandEdge - 19; offset <= outer - 1; offset++) {
      expect(hitAstrolabeRete(surface, 450 + nx * offset, 400 + ny * offset)).toBe(true);
    }
    expect(hitAstrolabeRete(surface, 450 + nx * (outer + 4), 400 + ny * (outer + 4))).toBe(false);
  }
});

test("polar outer grab band includes the entire glyph lane between glyphs", () => {
  const style = createAstrolabeRenderStyle(), surface = createAstrolabeReteSurface();
  const ctx = new RecordingContext();
  const targets = renderPolarAzimuthal(ctx.canvas, polarFixture as unknown as PolarAzimuthalGeometry,
    null, toggles, 900, 800, style, t, 1, 0, 1, undefined, surface)!;
  const band = surface.rings[0];
  const outerLine = Math.max(...ctx.strokes.flatMap(({ path, ink }) => (
    ink === style.palette.capricorn && path.length === 1 && path[0][0] === "A"
      ? [path[0][3] as number] : []
  )));
  for (const target of targets) {
    if (!target.width || !target.height || Math.hypot(target.x - band.x, target.y - band.y) <= outerLine) continue;
    for (const x of [target.x - target.width / 2, target.x + target.width / 2]) {
      for (const y of [target.y - target.height / 2, target.y + target.height / 2]) {
        expect(hitAstrolabeRete(surface, x, y)).toBe(true);
      }
    }
  }
  for (let angle = 0; angle < 360; angle += 5) {
    const radians = angle * Math.PI / 180;
    const radius = (band.inner + band.outer) / 2;
    expect(hitAstrolabeRete(surface, band.x + Math.cos(radians) * radius, band.y + Math.sin(radians) * radius)).toBe(true);
  }
});

test("both renderers publish complete term, decan and outer RA grab zones", () => {
  const style = createAstrolabeRenderStyle();
  for (const projection of ["stereographic", "polarEquidistant"]) {
    for (const layer of ["terms", "decans"] as const) {
      const ctx = new RecordingContext(), surface = createAstrolabeReteSurface();
      const layers = { ...toggles, terms: layer === "terms", decans: layer === "decans" };
      const zoom = { k: 12, x: -3000, y: -2000 };
      const args = [900, 800, style, t, 1, 0, 1, zoom, surface] as const;
      if (projection === "stereographic") {
        renderStereographicAstrolabe(ctx.canvas, stereoFixture as unknown as AstrolabeGeometry, layers, ...args);
        const band = surface.band!;
        expect(hitAstrolabeRete(surface, band.x + band.inner + 1, band.y)).toBe(true);
      } else {
        renderPolarAzimuthal(ctx.canvas, polarFixture as unknown as PolarAzimuthalGeometry, null, layers, ...args);
        const spans = surface.segments.filter((segment) => (segment[4] ?? 0) > 0);
        expect(spans.length).toBeGreaterThan(300);
        for (const [ax, ay, bx, by, halfWidth] of spans.filter((_, index) => index % 30 === 0)) {
          const length = Math.hypot(bx - ax, by - ay);
          expect(hitAstrolabeRete(surface, (ax + bx) / 2 - (by - ay) / length * halfWidth!,
            (ay + by) / 2 + (bx - ax) / length * halfWidth!)).toBe(true);
        }
      }
      const ring = surface.rings[0];
      const outerLine = Math.max(...ctx.strokes.flatMap(({ path, ink }) => (
        ink === style.palette.capricorn && path.length === 1 && path[0][0] === "A"
          ? [path[0][3] as number] : []
      )));
      expect(ring.inner).toBeLessThanOrEqual(outerLine - 40 + 0.5);
      expect(ring.outer).toBeGreaterThanOrEqual(outerLine + 40 - 0.5);
      expect(hitAstrolabeRete(surface, ring.x + (ring.inner + ring.outer) / 2, ring.y)).toBe(true);
    }
  }
});

test("earth in front covers the rete and bodies; the horizon set is drawn once, over it", () => {
  // The rete's ink apart from the limb's, so paint order can tell them apart.
  const base = createAstrolabeRenderStyle();
  const style = createAstrolabeRenderStyle({ palette: { ...base.palette, ecliptic: "rgb(1 2 3)" } });
  const earth = `fill:${style.palette.background}:evenodd`;
  const count = (events: string[], event: string) => events.filter((entry) => entry === event).length;
  for (const projection of ["stereographic", "polarEquidistant"]) {
    const paint = (earthInFront: boolean) => {
      const ctx = new RecordingContext();
      const layers = { ...toggles, earthInFront, earthOpacity: 1 };
      if (projection === "stereographic") {
        renderStereographicAstrolabe(ctx.canvas, stereoFixture as unknown as AstrolabeGeometry, layers, 900, 800, style, t, 1, 0, 1);
      } else {
        renderPolarAzimuthal(ctx.canvas, polarFixture as unknown as PolarAzimuthalGeometry, null, layers, 900, 800, style, t, 1, 0, 1);
      }
      return ctx.events;
    };
    const behind = paint(false);
    expect(behind).not.toContain(earth);
    const events = paint(true);
    const covered = events.indexOf(earth);
    expect(covered).toBeGreaterThan(events.lastIndexOf(`stroke:${style.palette.ecliptic}`));
    // Horizon, its label, Asc/Dsc (polar: with the Asc leader) and the polar
    // cardinals: once each, all after the earth.
    const onTop = [
      `stroke:${style.palette.horizon}`, `stroke:${style.palette.meridian}`, "text:astrolabe.horizon",
      ...(projection === "stereographic" ? ["text:Asc", "text:Dsc"] : ["text:astrolabe.cardinalN"]),
    ];
    for (const event of onTop) {
      expect(count(events, event), event).toBe(count(behind, event));
      expect(events.lastIndexOf(event), event).toBeGreaterThan(covered);
      // The polar Asc title sits outside the rim, beyond the earth.
      if (event.startsWith("text:")) expect(events.indexOf(event), event).toBeGreaterThan(covered);
    }
  }
});

test("a solid earth in front hides its rete from the time drag; a translucent one does not", () => {
  const style = createAstrolabeRenderStyle();
  // A translucent earth composites through an offscreen layer; none here.
  const host = globalThis as { document?: unknown };
  const previousDocument = host.document;
  host.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  for (const projection of ["stereographic", "polarEquidistant"]) {
    const surfaceFor = (earthInFront: boolean, earthOpacity: number) => {
      const ctx = new RecordingContext(), surface = createAstrolabeReteSurface();
      const layers = { ...toggles, earthInFront, earthOpacity };
      if (projection === "stereographic") {
        renderStereographicAstrolabe(ctx.canvas, stereoFixture as unknown as AstrolabeGeometry, layers, 900, 800, style, t, 1, 0, 1, undefined, surface);
      } else {
        renderPolarAzimuthal(ctx.canvas, polarFixture as unknown as PolarAzimuthalGeometry, null, layers, 900, 800, style, t, 1, 0, 1, undefined, surface);
      }
      return surface;
    };
    const hits = (surface: ReturnType<typeof surfaceFor>) => {
      const out: string[] = [];
      for (let x = 0; x < 900; x += 5) for (let y = 0; y < 800; y += 5) if (hitAstrolabeRete(surface, x, y)) out.push(`${x},${y}`);
      return out;
    };
    const behind = hits(surfaceFor(false, 1));
    expect(surfaceFor(true, 0.8).ground, projection).toBeUndefined();
    expect(hits(surfaceFor(true, 0.8)), projection).toEqual(behind);
    const solid = hits(surfaceFor(true, 1));
    expect(solid.length, projection).toBeGreaterThan(0);
    expect(solid.length, projection).toBeLessThan(behind.length);
    expect(solid.every((point) => behind.includes(point)), projection).toBe(true);
  }
  if (previousDocument === undefined) delete host.document;
});

test("plate lines: 5° almucantars and azimuths and day/night hours lie under the background picture", () => {
  const base = createAstrolabeRenderStyle();
  const style = createAstrolabeRenderStyle({ palette: { ...base.palette, almucantar: "rgb(4 5 6)", azimuth: "rgb(7 8 9)" } });
  const geo = {
    ...stereoFixture,
    tympan: { ...stereoFixture.tympan, ...plateLinesFixture },
  } as unknown as AstrolabeGeometry;
  const paint = (on: boolean) => {
    const ctx = new RecordingContext();
    const layers = { ...toggles, almucantars: on, azimuths: on, hourLines: on };
    renderStereographicAstrolabe(ctx.canvas, geo, layers, 900, 800, style, t, 1, 0, 1);
    return ctx;
  };
  const off = paint(false);
  const on = paint(true);
  const strokes = (ctx: RecordingContext, ink: string) => ctx.events.filter((event) => event === `stroke:${ink}`).length;
  expect(strokes(off, style.palette.almucantar)).toBe(0);
  expect(strokes(on, style.palette.almucantar)).toBe(plateLinesFixture.almucantars.length);
  expect(strokes(on, style.palette.azimuth)).toBe(plateLinesFixture.azimuths.length);
  expect(strokes(on, style.palette.hour)).toBe(plateLinesFixture.hourLines.length);
  // Engraved first, under any background picture: every grid and hour stroke
  // comes before the tympan's equator.
  for (const ink of [style.palette.almucantar, style.palette.azimuth, style.palette.hour]) {
    expect(on.events.lastIndexOf(`stroke:${ink}`)).toBeLessThan(on.events.indexOf(`stroke:${style.palette.equator}`));
  }
});

test("the 10° grid keeps every second almucantar and azimuth of the daemon's 5° division", () => {
  const base = createAstrolabeRenderStyle();
  const style = createAstrolabeRenderStyle({ palette: { ...base.palette, almucantar: "rgb(4 5 6)", azimuth: "rgb(7 8 9)" } });
  const geo = {
    ...stereoFixture,
    tympan: { ...stereoFixture.tympan, ...plateLinesFixture },
  } as unknown as AstrolabeGeometry;
  const ctx = new RecordingContext();
  renderStereographicAstrolabe(ctx.canvas, geo, {
    ...toggles, almucantars: true, azimuths: true, hourLines: false, gridTenDegrees: true,
  }, 900, 800, style, t, 1, 0, 1);
  const strokes = (ink: string) => ctx.events.filter((event) => event === `stroke:${ink}`).length;
  expect(strokes(style.palette.almucantar)).toBe(plateLinesFixture.almucantars.filter((c) => c.alt % 10 === 0).length);
  expect(strokes(style.palette.azimuth)).toBe(plateLinesFixture.azimuths.filter((c) => c.az % 10 === 0).length);
});

test("a southern stereographic plate puts N at the top, on the equator side", () => {
  const style = createAstrolabeRenderStyle();
  // Cardinals are painted top, bottom, east, west.
  const order = (pole: "north" | "south") => {
    const ctx = new RecordingContext();
    renderStereographicAstrolabe(ctx.canvas, { ...stereoFixture, pole } as unknown as AstrolabeGeometry, toggles, 900, 800, style, t, 1, 0, 1);
    return ctx.events.filter((event) => event === "text:astrolabe.cardinalN" || event === "text:astrolabe.cardinalS");
  };
  expect(order("north")).toEqual(["text:astrolabe.cardinalS", "text:astrolabe.cardinalN"]);
  expect(order("south")).toEqual(["text:astrolabe.cardinalN", "text:astrolabe.cardinalS"]);
});

test("both plates paint asterism figures only when enabled", () => {
  const style = createAstrolabeRenderStyle();
  const asterisms = { paths: [[[0, 0], [0.2, 0.2]]] as Array<Array<[number, number]>>, stars: [] };
  for (const projection of ["stereographic", "polarEquidistant"]) {
    const paint = (enabled: boolean) => {
      const ctx = new RecordingContext();
      const layers = { ...toggles, asterisms: enabled };
      if (projection === "stereographic") {
        const geo = { ...structuredClone(stereoFixture), asterisms } as unknown as AstrolabeGeometry;
        renderStereographicAstrolabe(ctx.canvas, geo, layers, 900, 800, style, t, 1, 0, 1);
      } else {
        const geo = { ...structuredClone(polarFixture), asterisms } as unknown as PolarAzimuthalGeometry;
        renderPolarAzimuthal(ctx.canvas, geo, null, layers, 900, 800, style, t, 1, 0, 1);
      }
      return ctx.strokes;
    };
    const before = paint(false);
    const after = paint(true);
    expect(after.length).toBe(before.length + 1);
    expect(after.filter(({ ink }) => ink === style.palette.starFaint).length)
      .toBe(before.filter(({ ink }) => ink === style.palette.starFaint).length + 1);
  }
});

test("asterism and ordinary stars share exact hover targets and viewport culling in both plates", () => {
  const star = { x: -0.4, y: 0.3, name: "Alpheratz", nom: "alAnd", lon: 14, ra: 2, decl: 29,
    position: "14° Aries", mag: 2.07 };
  const style = createAstrolabeRenderStyle();
  for (const projection of ["stereographic", "polarEquidistant"]) {
    const paint = (asterisms: boolean, stars: boolean, offscreen = false) => {
      const point = { ...star, ...(offscreen ? { x: -1000, y: -1000 } : {}) };
      const figures = { paths: [], stars: [point] };
      const layers = { ...toggles, asterisms, stars, starLabels: "none" as const };
      const ctx = new RecordingContext();
      if (projection === "stereographic") {
        const geo = { ...structuredClone(stereoFixture), asterisms: figures } as unknown as AstrolabeGeometry;
        geo.rete.stars = [point]; geo.rete.markedStars = [];
        return renderStereographicAstrolabe(ctx.canvas, geo, layers, 900, 800, style, t, 1, 0, 1)!;
      }
      const geo = { ...structuredClone(polarFixture), asterisms: figures } as unknown as PolarAzimuthalGeometry;
      geo.stars = [{ ...point, name: point.nom, starName: point.name }];
      return renderPolarAzimuthal(ctx.canvas, geo, null, layers, 900, 800, style, t, 1, 0, 1)!;
    };
    const target = (items: ReturnType<typeof paint>) => items.find((item) => (
      item.inspector?.kind === "fixed_star" && item.inspector.code === star.nom
    ));
    expect(target(paint(true, false))).toEqual(target(paint(false, true)));
    expect(target(paint(true, false))?.inspector).toEqual({ kind: "fixed_star", code: "alAnd", longitude: 14 });
    expect(target(paint(false, false))).toBeUndefined();
    expect(target(paint(true, false, true))).toBeUndefined();
  }
});

test("stereo keeps fitted zodiac graduations and labels sign starts above 2x", () => {
  const geo = structuredClone(stereoFixture) as unknown as AstrolabeGeometry;
  const withoutTicks = structuredClone(geo);
  withoutTicks.zodiacBand.ticks = [];
  const style = createAstrolabeRenderStyle();
  const paint = (geometry: AstrolabeGeometry, k: number, zodiacWheel = true) => {
    const ctx = new RecordingContext();
    renderStereographicAstrolabe(ctx.canvas, geometry, { ...toggles, zodiacWheel }, 900, 800, style, t, 1, 0, 1,
      { k, x: 450 * (1 - k), y: 400 * (1 - k) });
    return ctx;
  };
  expect(paint(geo, 1).strokes.length - paint(withoutTicks, 1).strokes.length).toBe(geo.zodiacBand.ticks.length);
  expect(paint(geo, 12).strokes).toEqual(paint(withoutTicks, 12).strokes);

  const labels = (ctx: RecordingContext) => ctx.texts.filter((text) => /^\d+°$/.test(text));
  for (const zodiacWheel of [true, false]) {
    expect(labels(paint(geo, 2, zodiacWheel))).toEqual([]);
    expect(new Set(labels(paint(geo, 2.8, zodiacWheel)))).toEqual(new Set(["0°"]));
    expect(labels(paint(geo, 12, zodiacWheel))).toEqual([]);
  }
});

test("stereo sign glyphs reach the degree labels' size on a small plate", () => {
  const geo = stereoFixture as unknown as AstrolabeGeometry;
  const style = createAstrolabeRenderStyle();
  const firstSign = geo.zodiacBand.glyphs[0].glyph;
  for (const zodiacWheel of [true, false]) {
    const paint = (k: number) => {
      const ctx = new RecordingContext();
      const sizes = new Map<string, number>();
      ctx.fillText = (text) => { sizes.set(text, Number(ctx.font.match(/([\d.]+)px/)?.[1])); };
      renderStereographicAstrolabe(ctx.canvas, geo, { ...toggles, zodiacWheel }, 480, 360, style, t, 1, 0, 1,
        { k, x: 240 * (1 - k), y: 180 * (1 - k) });
      return sizes;
    };
    const fitted = paint(1);
    const closeUp = paint(2.8);
    expect(closeUp.get(firstSign)).toBeGreaterThan(fitted.get(firstSign)!);
    expect(closeUp.get(firstSign)).toBe(closeUp.get("0°"));
    expect(paint(12).get(firstSign)).toBe(9);
  }
});

test("both plates cull distant stars before measuring labels at 12x", () => {
  for (const projection of ["stereographic", "polarEquidistant"]) {
    const ctx = new RecordingContext();
    const style = createAstrolabeRenderStyle();
    const star = { x: -1000, y: -1000, name: "Distant unique star", nom: "offscreen", lon: 10, ra: 10, decl: 10, mag: 2 };
    const zoom = { k: 12, x: -4950, y: -4400 };
    let paint: () => void;
    if (projection === "stereographic") {
      const geo = structuredClone(stereoFixture) as unknown as AstrolabeGeometry;
      geo.rete.stars = [star]; geo.rete.markedStars = [];
      geo.bodies[0].sphere = { x: -1, y: 0 };
      geo.bodies[0].ecliptic = { x: 1, y: 0 };
      paint = () => { renderStereographicAstrolabe(ctx.canvas, geo, toggles, 900, 800, style, t, 1, 0, 1, zoom); };
    } else {
      const geo = structuredClone(polarFixture) as unknown as PolarAzimuthalGeometry;
      geo.stars = [star];
      geo.frame.zodiacalHorizon = [[[-1, 0], [1, 0]]];
      paint = () => { renderPolarAzimuthal(ctx.canvas, geo, null, toggles, 900, 800, style, t, 1, 0, 1, zoom); };
    }
    paint();
    expect(ctx.texts).not.toContain(star.name);
    expect(ctx.measured).not.toContain(star.name);
    const dotted = ctx.strokes.filter((stroke) => stroke.dash.length && stroke.path.length);
    expect(dotted.length).toBeGreaterThan(0);
    for (const stroke of dotted) for (const [kind, x, y] of stroke.path) {
      if (kind === "A") continue;
      expect(x).toBeGreaterThanOrEqual(-8 - 1e-8); expect(x).toBeLessThanOrEqual(908 + 1e-8);
      expect(y).toBeGreaterThanOrEqual(-8 - 1e-8); expect(y).toBeLessThanOrEqual(808 + 1e-8);
    }
    // A star just outside the left edge keeps its name extending into view.
    star.x = 0; star.y = 0; star.name = "Edge visible star";
    zoom.x = -5420;
    paint();
    expect(ctx.texts).toContain(star.name);
  }
});

test("the culled painter retains daemon angles and conjunction cues", () => {
  const ctx = new RecordingContext();
  const geo = structuredClone(stereoFixture) as unknown as AstrolabeGeometry;
  geo.contactOrbDeg = 0.2;
  geo.contacts = [{ pointId: geo.bodies[0].id, point: "body", target: { kind: "meridian", angle: "mc" }, arcToExact: 0 }];
  geo.angles = ["asc", "dsc", "mc", "ic"].map((id, index) => ({
    id: `angle:${id}`, label: `angle ${id}`, name: `hover ${id}`, position: "10°", x: 0.3 + index * 0.1, y: 0.3,
  }));
  const targets = renderStereographicAstrolabe(ctx.canvas, geo, toggles, 900, 800, createAstrolabeRenderStyle(), t, 1, 0, 1)!;
  for (const angle of geo.angles) {
    expect(ctx.texts).toContain(angle.label);
    expect(targets.some((target) => target.name === angle.name)).toBe(true);
  }
  expect(ctx.strokes.some((stroke) => typeof stroke.ink === "object" && stroke.path.length)).toBe(true);
});

test("without WebGL the atmospheric plates keep the daemon's flat sky and ground", () => {
  const style = createAstrolabeRenderStyle();
  const stereo = structuredClone(stereoFixture) as unknown as AstrolabeGeometry;
  const polar = structuredClone(polarFixture) as unknown as PolarAzimuthalGeometry;
  for (const geo of [stereo, polar]) geo.atmospheric = { ...geo.atmospheric, sunAltitude: 12, sunAzimuth: 95 };
  expect(astrolabeSkyLayer(stereo.atmospheric, null)).toMatchObject({ sunAltitude: 12, sunAzimuth: 95 });
  expect(astrolabeSkyLayer(stereoFixture.atmospheric, null)).toBeNull();
  for (const earthInFront of [false, true]) {
    const layers = { ...toggles, earthInFront, earthOpacity: 1 };
    const flat = new RecordingContext();
    renderStereographicAstrolabe(flat.canvas, stereo, layers, 900, 800, style, t, 1, 0, 1);
    expect(flat.events).toContain(`fill:${stereo.atmospheric.sky}:nonzero`);
    expect(flat.events.filter((event) => event === `fill:${stereo.atmospheric.ground}:evenodd`)).toHaveLength(earthInFront ? 2 : 1);
    const polarCtx = new RecordingContext();
    renderPolarAzimuthal(polarCtx.canvas, polar, null, layers, 900, 800, style, t, 1, 0, 1);
    expect(polarCtx.events).toContain(`fill:${polar.atmospheric.sky}:evenodd`);
    expect(polarCtx.events.filter((event) => event === `fill:${polar.atmospheric.ground}:evenodd`)).toHaveLength(earthInFront ? 2 : 1);
  }
});

test("the sky's Atkinson dither paints only palette colours, keeps the mean and reads rows bottom-up", () => {
  const w = 96, h = 48;
  // A dusk ramp: blue overhead (the top row, last in readPixels order) to orange at the horizon.
  const src = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const up = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, glow = Math.max(0, 1 - Math.hypot(x - 20, y) / 40);
      src.set([Math.round(40 + 180 * (1 - up) * glow + 30 * (1 - up)), Math.round(50 + 60 * (1 - up)), Math.round(150 * up + 40), 255], o);
    }
  }
  const palette = medianCutPalette(src, 16);
  expect(palette.length).toBe(17 * 3);
  const lookup = createPaletteLookup();
  const out = new Uint8ClampedArray(w * h * 4);
  ditherAtkinson(src, w, h, palette, lookup, out, new Float32Array(ditherWorkLength(w)));
  const colours = new Set(Array.from({ length: palette.length / 3 }, (_, k) => [0, 1, 2].map((c) => Math.round(palette[k * 3 + c])).join()));
  const mean = (data: ArrayLike<number>, c: number, rows: [number, number], flip: boolean) => {
    let sum = 0;
    for (let y = rows[0]; y < rows[1]; y++) {
      const row = flip ? h - 1 - y : y;
      for (let x = 0; x < w; x++) sum += data[(row * w + x) * 4 + c];
    }
    return sum / ((rows[1] - rows[0]) * w);
  };
  for (let i = 0; i < w * h; i++) {
    expect(colours.has([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]].map(Math.round).join())).toBe(true);
    expect(out[i * 4 + 3]).toBe(255);
  }
  // Atkinson drops a quarter of the error, so a band's mean stays near, not on, the source.
  for (const rows of [[0, 12], [18, 30], [36, 48]] as Array<[number, number]>) {
    for (let c = 0; c < 3; c++) expect(Math.abs(mean(out, c, rows, false) - mean(src, c, rows, true))).toBeLessThan(10);
  }
  // Output row 0 is the top of the plate: the blue overhead.
  expect(mean(out, 2, [0, 6], false)).toBeGreaterThan(mean(out, 2, [h - 6, h], false) + 80);
  // The whole-picture pass (main thread): its own palette, the same dither.
  const square = src.slice(0, 48 * 48 * 4);
  const picture = ditherPlatePicture(square, 48);
  const own = medianCutPalette(square, 16);
  const expected = new Uint8ClampedArray(48 * 48 * 4);
  ditherAtkinson(square, 48, 48, own, createPaletteLookup(), expected, new Float32Array(ditherWorkLength(48)));
  expect(Array.from(picture)).toEqual(Array.from(expected));
  expect(Array.from(platePalette(square))).toEqual(Array.from(own));
  // The fine picture is dithered on the base picture's palette, not its own.
  const fine = ditherPlatePicture(square, 48, palette);
  ditherAtkinson(square, 48, 48, palette, createPaletteLookup(), expected, new Float32Array(ditherWorkLength(48)));
  expect(Array.from(fine)).toEqual(Array.from(expected));
  // The GPU's whole lookup holds what the CPU fills on demand, and its Float32
  // reference dithers this small picture dot for dot as the CPU does.
  const table = paletteLookupTable(palette);
  lookup.forEach((entry, cell) => {
    if (entry !== 255) expect(table[cell]).toBe(entry);
  });
  expect(table.every((entry) => entry < palette.length / 3)).toBe(true);
  const float32 = new Uint8ClampedArray(w * h * 4);
  ditherAtkinsonFloat32(src, w, h, palette, table, float32);
  expect(Array.from(float32)).toEqual(Array.from(out));
});

test("the GPU's palette samples alone make the whole picture's palette", () => {
  // The GPU reads back only the median cut's samples (GATHER_WGSL), in readback order.
  const w = 240, h = 120, total = w * h;
  const src = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const x = i % w, y = Math.floor(i / w);
    const inside = Math.hypot(x - w / 2, y - h / 2) < h / 2;
    src.set([(x * 7 + y) & 255, (y * 3) & 255, (x ^ y) & 255, inside ? 255 : 0], i * 4);
  }
  const step = paletteSampleStep(total);
  expect(step).toBeGreaterThan(1);
  const samples = new Uint8Array(Math.ceil(total / step) * 4);
  for (let k = 0; k * step < total; k++) samples.set(src.subarray(k * step * 4, k * step * 4 + 4), k * 4);
  expect(Array.from(platePaletteOfSamples(samples))).toEqual(Array.from(platePalette(src)));
});

test("the shipped sky adds 2x and 4x pictures under zoom, and one picture serves every zoom with the finer-zoom switch off", () => {
  // Switch off (tiers "single", the tuner's off state): one dot per CSS px of the unzoomed plate, within 256..2048, magnified at every zoom.
  for (const magnification of [1, 1.5, 3, 6, 12]) {
    expect(skyPictureSizes(400, magnification)).toEqual({ base: 800, shown: 800, tier: "base" });
    expect(skyPictureSizes(50, magnification, "single")).toEqual({ base: 256, shown: 256, tier: "base" });
    expect(skyPictureSizes(1500, magnification)).toEqual({ base: 2048, shown: 2048, tier: "base" });
  }
  // With the switch, up to 1.5x: the same base picture, the palette's source.
  for (const tiers of ["cpu", "gpu"] as const) {
    for (const magnification of [1, 1.2, 1.49]) {
      expect(skyPictureSizes(400, magnification, tiers)).toEqual({ base: 800, shown: 800, tier: "base" });
      expect(skyPictureSizes(50, magnification, tiers)).toEqual({ base: 256, shown: 256, tier: "base" });
      expect(skyPictureSizes(1500, magnification, tiers)).toEqual({ base: 2048, shown: 2048, tier: "base" });
    }
  }
  // CPU (the GPU dither not up), from the city's 1.5x on: twice the dots across, up to 1600.
  for (const magnification of [1.5, 2, 4, 8]) {
    expect(skyPictureSizes(400, magnification, "cpu")).toEqual({ base: 800, shown: 1600, tier: "fine" });
    expect(skyPictureSizes(50, magnification, "cpu")).toEqual({ base: 256, shown: 512, tier: "fine" });
    expect(skyPictureSizes(600, magnification, "cpu")).toEqual({ base: 1200, shown: 1600, tier: "fine" });
    expect(skyPictureSizes(900, magnification, "cpu")).toEqual({ base: 1800, shown: 1800, tier: "base" });
  }
  // GPU: twice the dots from 1.5x and four times from 3x, up to 3200, so a dot
  // stays 0.75..1.5 CSS px up to 6x and 3 px at 12x on an 800 px plate.
  for (const magnification of [1.5, 2, 2.99]) {
    expect(skyPictureSizes(400, magnification, "gpu")).toEqual({ base: 800, shown: 1600, tier: "fine" });
    expect(skyPictureSizes(50, magnification, "gpu")).toEqual({ base: 256, shown: 512, tier: "fine" });
    expect(skyPictureSizes(900, magnification, "gpu")).toEqual({ base: 1800, shown: 3200, tier: "fine" });
  }
  for (const magnification of [3, 6, 12]) {
    expect(skyPictureSizes(400, magnification, "gpu")).toEqual({ base: 800, shown: 3200, tier: "finest" });
    expect(skyPictureSizes(50, magnification, "gpu")).toEqual({ base: 256, shown: 1024, tier: "finest" });
    expect(skyPictureSizes(600, magnification, "gpu")).toEqual({ base: 1200, shown: 3200, tier: "finest" });
    // Where twice the dots already reach the cap, the fine picture serves on: no third picture.
    expect(skyPictureSizes(900, magnification, "gpu")).toEqual({ base: 1800, shown: 3200, tier: "fine" });
    expect(skyPictureSizes(1500, magnification, "gpu")).toEqual({ base: 2048, shown: 3200, tier: "fine" });
  }
  // The shipped look has the switch on (4 Nov 2026, "Astrolabe GPU sky on by
  // default"); the tuner's off state stores 0 and reaches the layer as such.
  expect(ASTROLABE_SKY_DEFAULT).toEqual({ haze: 0.66, ozone: 2.35, exposure: 0.6, diffusion: 1, strength: 1, finerZoom: 1 });
  expect(astrolabeSkyLayer({ sunAltitude: 5, sunAzimuth: 90 }, null)?.tune.finerZoom).toBe(1);
  expect(astrolabeSkyLayer({ sunAltitude: 5, sunAzimuth: 90 }, { ...ASTROLABE_SKY_DEFAULT, finerZoom: 0 })?.tune.finerZoom).toBe(0);
});

test("the sky shaders keep every literal a float where WebGL needs one", () => {
  // Desktop GL converts int to float implicitly; WebGL 2 refuses. Bare
  // integers may only count loops.
  const loose: string[] = [];
  for (const [name, source] of Object.entries(ASTROLABE_SKY_SHADERS.fragments)) {
    source.split("\n").forEach((line, index) => {
      const code = line.split("//")[0];
      if (code.trim().startsWith("#") || /for \(int \w+ = 0; \w+ < \d+; \w+\+\+\)/.test(code)) return;
      const bare = code.replace(/\d+\.\d*(e[-+]?\d+)?|\d+e[-+]?\d+|float\(i \+ 1\)/g, "").match(/(?<![\w.])\d+(?![\w.])/);
      if (bare) loose.push(`${name}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(loose).toEqual([]);
});
