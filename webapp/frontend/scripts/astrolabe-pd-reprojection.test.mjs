// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Pure renderer checks with supplied geometry and a recording canvas adapter.
// No browser, live daemon or application UI is opened.
const bundle = await build({
  stdin: { contents: `
    export {nextPdFocus, paintPdReprojection} from './src/components/workshell/astrolabe-pd-reprojection';
    export {hitAstrolabeRete} from './src/components/workshell/astrolabe-canvas';
    export {createAstrolabeRenderStyle} from './src/lib/chart/astrolabe-render-style';
  `, resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
});
const { nextPdFocus, paintPdReprojection, hitAstrolabeRete, createAstrolabeRenderStyle } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);
const style = createAstrolabeRenderStyle();
const actual = { x: -.4, y: .1, longitude: 40, latitude: 8, ra: 35, decl: 14 };
const foot = { x: .3, y: -.2, longitude: 11, position: "11°" };
const metadata = { name: "Venus", glyph: "D", glyphFont: "morinus", color: "#abcdef", motionRef: { kind: "planet", bodyId: 3 } };
const pair = { key: "venus", metadata, actual, representative: foot, capability: { supported: true } };

function paint(projection, overrides = {}, zoom = 1, focus = null, glyphSize = undefined) {
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]), set: () => true });
  const draw = { ctx, circle: (...args) => calls.push(["circle", ...args]), text: (...args) => calls.push(["text", ...args]),
    line: (...args) => calls.push(["line", ...args]) };
  const points = [{ ...pair, capabilities: { reprojection: pair.capability } }];
  const geo = { projection, bodies: [{id: 3}], objects: [{bodyId: 3}],
    pdReprojection: { system: 2, systemLabel: "Regiomontanus", signedArc: 30, points,
      natalEcliptic: [], events: [], ...overrides } };
  const targets = [];
  const surface = { center: [0, 0], rings: [], segments: [], markers: [] };
  paintPdReprojection(draw, geo, { cx: 200, cy: 150, scale: 100 },
    { x0: 0, y0: 0, x1: 400, y1: 300 }, style, 3, 1, targets, surface,
    (key) => key, (_role, fallback) => fallback, zoom, focus, glyphSize);
  return { calls, targets, surface };
}

for (const projection of ["stereographic", "polarEquidistant"]) {
  test(`${projection}: tiny source glyphs fade in with the polar rete's close-up detail`, () => {
    const glyph = (result) => result.calls.find(([kind, _position, text]) => kind === "text" && text === "D");
    assert.equal(glyph(paint(projection, {}, 1)), undefined);
    assert.equal(glyph(paint(projection, {}, 2)), undefined);
    const midway = paint(projection, {}, 2.4);
    const label = glyph(midway);
    assert(label);
    assert.equal(label[3].font, style.typography.fontSymbols);
    assert.equal(label[3].fill, metadata.color);
    assert(Math.abs(label[3].opacity - 0.34) < 1e-8);
    assert(label[3].size >= 7.5 && label[3].size <= 9);
    const full = glyph(paint(projection, {}, 12));
    assert.equal(full[3].size, 9);
    assert.equal(full[3].opacity, 0.68);
    const target = midway.targets.at(-1);
    assert.deepEqual(target.inspector, { kind: "planet", seId: 3 });
    assert(hitAstrolabeRete(midway.surface, target.x, target.y));
    assert.equal(midway.targets[0].x, 230);
    assert.equal(midway.targets[0].y, 130);
  });
  test(`${projection}: linked representative uses daemon coordinates and existing hover/drag handles`, () => {
    const { calls, targets, surface } = paint(projection);
    assert(calls.some(([name, x, y]) => name === "moveTo" && x === 160 && y === 160));
    const target = targets.find((t) => t.pdReprojection);
    assert.equal(target.x, 230);
    assert.equal(target.y, 130);
    assert.equal(target.position, "11°");
    assert.deepEqual(target.inspector, { kind: "planet", seId: 3 });
    assert.match(target.detail, /pdRepresentative.*Regiomontanus/);
    assert(hitAstrolabeRete(surface, target.x, target.y));
  });
}

test("canonical ray and fixed target keep their own actual/representative coordinates", () => {
  const { targets, surface } = paint("stereographic", { points: [], events: [{ rays: [
    { ...pair, role: "promissor", aspect: 4, aspectGlyph: "square" },
    { ...pair, role: "significator", actual: { ...actual, x: .3, y: -.2 } },
  ] }] });
  assert(targets.some((t) => t.x === 160 && /pdActualRay/.test(t.detail)));
  assert(targets.some((t) => t.x === 230 && /pdNatalTarget/.test(t.detail)));
  assert.equal(surface.markers.length, 2); // Moving ray handles only.
});

test("undefined native projection has a caption and never invents a representative", () => {
  const { targets, surface } = paint("stereographic", { points: [{ ...pair, representative: undefined,
    capabilities: { reprojection: { supported: false, reason: "undefined-native-reprojection" } } }] });
  assert.equal(surface.markers.length, 0);
  assert.equal(targets[0].detail, "astrolabe.pdReprojectionUnavailable");
});

test("projected Fortune and star handles inspect their source identity, not the new longitude", () => {
  const { targets } = paint("polarEquidistant", { points: [], events: [{ rays: [
    { ...pair, role: "promissor", metadata: { ...metadata, longitude: 95, motionRef: { kind: "fortune" } } },
    { ...pair, role: "promissor", metadata: { ...metadata, longitude: 215, motionRef: { kind: "fixedStar", code: "alVir" } } },
  ] }] });
  assert(targets.some((t) => t.inspector?.kind === "fortune" && t.inspector.longitude === 95));
  assert(targets.some((t) => t.inspector?.kind === "fixed_star" && t.inspector.longitude === 215));
});

test("unturned and hidden point overlays add no handles", () => {
  assert.equal(paint("stereographic", { signedArc: 0 }).targets.length, 0);
  assert.equal(paint("stereographic", { points: [{ ...pair, metadata: { motionRef: { kind: "planet", bodyId: 4 } },
    capabilities: { reprojection: pair.capability } }] }).targets.length, 0);
});

test("natal ecliptic carries quiet sign-start ticks and close-up sign glyphs", () => {
  const natalSigns = [{ sign: 0, glyph: "a",
    start: { x: .5, y: 0, tx: 0, ty: 1 }, middle: { x: 0, y: .5, tx: -1, ty: 0 } }];
  const tick = Math.max(style.markers.sphereRadiusMin, 3 * .8) * 1.5;
  const far = paint("stereographic", { natalSigns }, 1);
  // Ticks cross the fixed circle along its outward normal.
  assert(far.calls.some(([name, x, y]) => name === "moveTo" && x === 250 - tick && y === 150));
  assert(far.calls.some(([name, x, y]) => name === "lineTo" && x === 250 + tick && y === 150));
  assert.equal(far.calls.find(([kind, _p, text]) => kind === "text" && text === "a"), undefined);
  const near = paint("polarEquidistant", { natalSigns }, 12);
  const glyph = near.calls.find(([kind, _p, text]) => kind === "text" && text === "a");
  assert.deepEqual(glyph[1], [200, 200 + tick + 9 * .7]);
  assert.equal(glyph[3].fill, style.palette.ecliptic);
  assert.equal(glyph[3].opacity, Math.min(.68, style.strokes.connectorOpacity));
  assert.equal(near.targets.some((target) => target.name === "a"), false);
});

test("links follow the daemon's locus samples exactly, else stay straight", () => {
  const strokes = (calls) => calls.filter(([name]) => name === "moveTo" || name === "lineTo")
    .map(([name, x, y]) => [name, Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
  const locus = [{ x: -.2, y: .05 }, { x: .05, y: -.08 }];
  const curved = paint("stereographic", { points: [{ ...pair, locus, capabilities: { reprojection: pair.capability } }] });
  const path = strokes(curved.calls);
  const start = path.findIndex(([name, x, y]) => name === "moveTo" && x === 160 && y === 160);
  assert(start >= 0);
  const link = path.slice(start, start + 13);
  // Four smoothed steps per span; every engine sample and the diamond are exact vertices.
  assert.deepEqual(link[4], ["lineTo", 180, 155]);
  assert.deepEqual(link[8], ["lineTo", 205, 142]);
  assert.deepEqual(link[12], ["lineTo", 230, 130]);
  assert(link.slice(1).every(([name]) => name === "lineTo"));
  const straight = strokes(paint("stereographic").calls);
  const i = straight.findIndex(([name, x, y]) => name === "moveTo" && x === 160 && y === 160);
  assert.deepEqual(straight[i + 1], ["lineTo", 230, 130]);
});

const sunMeta = { name: "Sun", glyph: "A", glyphFont: "morinus", color: "#f0a000", motionRef: { kind: "planet", bodyId: 0 } };
const sunMark = { x: .5, y: 0, tx: 0, ty: 1, longitude: 10, position: "10°" };
const significators = [{ key: "sun", kind: "planet", metadata: sunMeta, capability: { supported: true }, mark: sunMark,
  aspects: [{ aspect: 5, offset: -90, aspectGlyph: "Q", capability: { supported: true },
    mark: { x: 0, y: .5, tx: -1, ty: 0, longitude: 280, position: "280°" } }] }];

test("significator marks tick inward at their natal targets and focus on click", () => {
  const r = Math.max(style.markers.sphereRadiusMin, 3 * .8);
  const quiet = paint("stereographic", { significators }, 1);
  const tick = quiet.calls.find(([kind]) => kind === "line");
  // Inward from the ring: the outward normal at (.5, 0) points to +x.
  assert.deepEqual(tick[1], [[250, 150], [250 - r * 2.5, 150]]);
  assert.equal(tick[2].fill, sunMeta.color);
  assert.equal(quiet.calls.some(([kind, _p, text]) => kind === "text" && (text === "A" || text === "Q")), false);
  const mark = quiet.targets.find((target) => target.pdSignificator === "sun");
  assert.equal(mark.detail, "astrolabe.pdNatalTarget · Regiomontanus");
  assert.deepEqual(mark.inspector, { kind: "planet", seId: 0 });

  const focused = paint("stereographic", { significators }, 1, "sun");
  const glyph = focused.calls.find(([kind, _p, text]) => kind === "text" && text === "A");
  assert.equal(glyph[3].opacity, 1);
  assert.equal(glyph[3].size, r * 4);
  const aspect = focused.targets.find((target) => target.name === "Sun -90°");
  assert(aspect && aspect.pdSignificator === "sun");
  assert(focused.calls.some(([kind, _p, text]) => kind === "text" && text === "Q"));

  assert.equal(nextPdFocus(null, mark), "sun");
  assert.equal(nextPdFocus("sun", mark), null);
  assert.equal(nextPdFocus("sun", { x: 0, y: 0, name: "Venus" }), "sun");
  assert.equal(nextPdFocus("sun", null), null);
});

test("focus is exclusive: only the focused significator's nearest contacts draw", () => {
  const row = (promissor, significator, x) => ({ arc: 30, direct: true, capability: { supported: true }, promissor, significator,
    rays: [{ ...pair, key: promissor, role: "promissor", representative: { ...foot, x } }] });
  const venus = { ...pair, key: "venus", capabilities: { reprojection: pair.capability } };
  const mars = { ...pair, key: "mars", metadata: { ...metadata, motionRef: { kind: "planet", bodyId: 4 } },
    capabilities: { reprojection: pair.capability } };
  // The polar plate paints Venus only (bodyId 3); Mars appears just as a row ray.
  const geo = { points: [venus, mars], significators,
    events: [row("venus", "moon", .1)], focus: { key: "sun", events: [row("mars", "sun", .2)] } };
  const r = Math.max(style.markers.sphereRadiusMin, 3 * .8);
  // The diamond's own box; a glyph label copies its caption at another size.
  const diamonds = (result) => result.targets.filter((t) => t.pdReprojection && !t.pdSignificator
    && t.detail?.includes("pdRepresentative") && t.height === r * 2).map((t) => t.x);
  const all = paint("polarEquidistant", { ...geo }, 1);
  assert.deepEqual(diamonds(all), [230, 210]);
  const sun = paint("polarEquidistant", { ...geo }, 1, "sun");
  assert.deepEqual(diamonds(sun), [220]);
  assert.equal(sun.targets.filter((t) => t.pdSignificator === "sun").length >= 2, true);
  // Focused contacts name promissor and aspect at full strength, unzoomed.
  const label = sun.calls.find(([kind, _p, text]) => kind === "text" && text === "D");
  assert.equal(label[3].opacity, 1);
  assert.equal(label[3].size, r * 4);
  assert.equal(all.calls.some(([kind, _p, text]) => kind === "text" && text === "D"), false);
});

test("aspects lie on the natal ring as arcs, with the real width on hover", () => {
  const r = Math.max(style.markers.sphereRadiusMin, 3 * .8);
  const aspectArc = { start: 10, end: 104.5, span: 94.5, points: [{ x: .5, y: 0 }, { x: .35, y: .35 }, { x: 0, y: .5 }] };
  const ray = { ...pair, key: "mars", role: "promissor", aspect: 5, offset: 90, aspectGlyph: "Q", aspectArc };
  const row = { arc: 30, direct: true, capability: { supported: true }, promissor: "mars", significator: "sun", rays: [ray] };
  const { calls, targets } = paint("stereographic", { events: [row] });
  const path = calls.filter(([name]) => name === "moveTo" || name === "lineTo").map(([name, x, y]) => [name, x, y]);
  const start = path.findIndex(([name, x, y]) => name === "moveTo" && x === 250 && y === 150);
  assert.deepEqual(path.slice(start, start + 3), [["moveTo", 250, 150], ["lineTo", 235, 185], ["lineTo", 200, 200]]);
  const glyph = calls.find(([kind, _p, text]) => kind === "text" && text === "Q" && _p[1] > 185);
  assert(glyph);
  assert.equal(glyph[3].size, r * 4);
  const hover = targets.find((target) => target.detail === "94°30′");
  assert(hover && hover.name === "Venus +90°");

  const sunArc = { start: 10, end: 280, span: -90, points: [{ x: .5, y: 0 }, { x: .35, y: .35 }, { x: 0, y: .5 }] };
  const withArc = [{ ...significators[0], aspects: [{ ...significators[0].aspects[0], arc: sunArc }] }];
  const quiet = paint("stereographic", { significators: withArc }, 1);
  assert.equal(quiet.targets.some((target) => target.detail === "90°00′"), false);
  const focused = paint("stereographic", { significators: withArc }, 1, "sun");
  assert(focused.targets.some((target) => target.detail === "90°00′" && target.name === "Sun -90°"));
});

test("contacts paint at their fade strength; focus keeps a faint floor", () => {
  const aspectArc = { start: 10, end: 104.5, span: 94.5, points: [{ x: .5, y: 0 }, { x: .35, y: .35 }, { x: 0, y: .5 }] };
  const ray = { ...pair, key: "mars", role: "promissor", aspect: 5, offset: 90, aspectGlyph: "Q", aspectArc };
  const row = (strength) => ({ arc: 30, direct: true, capability: { supported: true }, promissor: "mars",
    significator: "sun", strength, rays: [{ ...ray }] });
  const opacities = (result) => result.calls.filter(([kind, _p, text]) => kind === "text" && text === "Q")
    .map(([, , , opts]) => opts.opacity);
  assert.deepEqual(opacities(paint("stereographic", { events: [row(0.5)] })), [0.5, 0.5]);
  assert.deepEqual(opacities(paint("stereographic", { events: [row(1)] })), [1, 1]);
  const floor = style.strokes.connectorOpacity;
  const faint = paint("stereographic", { significators, events: [], focus: { key: "sun", events: [row(0.05)] } }, 1, "sun");
  assert.deepEqual(opacities(faint).slice(-2), [floor, floor]);
});

test("aspect marks take the theme aspect colour and size from the body glyph", () => {
  const aspectArc = { start: 10, end: 104.5, span: 94.5, points: [{ x: .5, y: 0 }, { x: .35, y: .35 }, { x: 0, y: .5 }] };
  const ray = { ...pair, key: "mars", role: "promissor", aspect: 5, offset: 90, aspectGlyph: "Q", aspectArc,
    aspectColor: "#ff0044", aspectColorRole: "--morinus-aspect-square" };
  const row = { arc: 30, direct: true, capability: { supported: true }, promissor: "mars", significator: "sun",
    strength: 1, rays: [ray] };
  const { calls } = paint("stereographic", { significators, events: [], focus: { key: "sun", events: [row] } }, 1, "sun", 30);
  const texts = (glyph) => calls.filter(([kind, _p, text]) => kind === "text" && text === glyph).map(([, , , opts]) => opts);
  // The Sun's own aspect mark has no theme colour in this fixture, so it keeps
  // the Sun's; the ray's arc, open-point and label glyphs take the aspect ink,
  // all at 0.6 of the body glyph.
  assert.deepEqual(texts("Q").map((opts) => [opts.fill, opts.size]),
    [[sunMeta.color, 18], ...Array(3).fill(["#ff0044", 18])]);
  // The planet glyph keeps the planet's colour.
  assert.deepEqual(texts("D").map((opts) => [opts.fill, opts.size]), [[metadata.color, 18]]);
  // The focused significator's glyph follows the same size.
  assert.equal(texts("A")[0].size, 18);
});

test("the overlay is one context-menu layer, off by default, gated in both renderers", async () => {
  const { readFileSync } = await import("node:fs");
  const view = readFileSync("src/components/workshell/astrolabe-view.tsx", "utf8");
  const polar = readFileSync("src/components/workshell/astrolabe-polar-render.ts", "utf8");
  assert.match(view, /\n {2}pdReprojection: false, \/\/ PD /);
  for (const source of [view, polar]) assert.match(source, /if \(toggles\.pdReprojection\) paintPdReprojection\(/);
  assert.equal(view.match(/check\("pdReprojection", t\("astrolabe\.pdReprojection"\)\)/g)?.length, 1);
});
