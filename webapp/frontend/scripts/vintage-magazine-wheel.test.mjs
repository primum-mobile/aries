// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path).exports;
  if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
  const compiledModule = {exports: {}};
  modules.set(path, compiledModule);
  const javascript = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText;
  const localRequire = id => {
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const target = id.startsWith('@/') ? resolve(src, id.slice(2)) : resolve(dirname(path), id);
    return load(target.endsWith('.json') ? target : `${target}.ts`);
  };
  new Function('require', 'module', 'exports', javascript)(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const vintage = load(resolve(src, 'lib/chart/vintage-magazine-wheel.ts'));
const renderer = load(resolve(src, 'lib/chart/draw-chart.ts'));
const preset = load(resolve(src, 'lib/chart/wheel-geometry-preset.ts'));
const {CanvasDraw} = load(resolve(src, 'lib/chart/canvas-draw.ts'));
const {identityFrame} = load(resolve(src, 'lib/chart/wheel-projection.ts'));
const {WHEEL_FACTORY_SETTINGS} = load(resolve(src, 'lib/chart/wheel-composition.ts'));

const near = (actual, expected, message, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} != ${expected}`);
const measure = (text, _font, size) => ({left: 0, right: size * 0.6 * Array.from(text).length, ascent: size * 0.7, descent: 0});
const distance = (point, center) => Math.hypot(point[0] - center[0], point[1] - center[1]);

function wheelInput(radius, bodies) {
  return {
    center: [500, 500], radius, frame: identityFrame(0),
    cusps: Array.from({length: 12}, (_, i) => ({angle: i * 30 + 15,
      caption: {degText: '14', minText: '58', signGlyph: 'e'}})),
    angles: {asc: 15, mc: 285, dsc: 195, ic: 105},
    bodies, showHouses: true, showCaptions: true, showBodies: true, showPositions: true, showMinutes: true,
    showArrowheads: true, fonts: {text: 'FreeSans', symbols: 'AriesMorinus'},
    colors: {background: 'white', circles: 'black', houses: 'black', angles: 'black', positions: 'black', houseNumbers: 'black'},
  };
}
const moon = {key: 'moon', angle: 147.7, glyph: 'B', glyphIsText: false, color: 'black', degText: '27', minText: '42', signGlyph: 'e'};

test('a lone body reads planet, degree, minute, sign at the mock-up radii and sizes', () => {
  const layout = vintage.layoutVintageWheel(wheelInput(400, [moon]), measure);
  const [body] = layout.bodies;
  assert.equal(body.shift, 0);
  near(distance(body.glyph.anchor, [500, 500]), 316, 'planet');
  assert.equal(body.glyph.size, 26);
  const [degree, minute, sign] = body.texts;
  assert.deepEqual([degree.text, minute.text, sign.text], ['27°', "42'", 'e']);
  near(distance(degree.anchor, [500, 500]), 282, 'degree');
  near(distance(minute.anchor, [500, 500]), 248, 'minute');
  near(distance(sign.anchor, [500, 500]), 213, 'sign');
  // The fixture face's digit is 0.7 em tall: sizes are fitted to the
  // magazine's 0.75 em digit, and the face keeps its own width.
  const fit = 0.75 / 0.7;
  near(degree.size, 23 * 0.75 * fit, 'degree size'); near(minute.size, 22 * 0.75 * fit, 'minute size');
  near(sign.size, 25.3 * 0.75, 'position sign size');
  assert.equal(degree.weight, 400);
  // The degree sign is its own segment, set tight against the digits.
  assert.deepEqual(degree.parts.map(part => part.text), ['27', '°']);
});

test('house numbers and cusp captions share the 373.3 lane with upright -15/+13 rows', () => {
  const layout = vintage.layoutVintageWheel(wheelInput(400, []), measure);
  assert.equal(layout.houseNumbers.length, 12);
  for (const number of layout.houseNumbers) near(distance(number.text.anchor, [500, 500]), 373.295, 'house number');
  const [degreeMinute, sign] = layout.captions;
  assert.equal(degreeMinute.text, "14°58'");
  near(sign.anchor[1] - degreeMinute.anchor[1], 28, 'row-centre separation');
  near(degreeMinute.size, 21.5 * 0.85 * 0.75 / 0.7, 'cusp captions at 85 %');
  near(distance([degreeMinute.anchor[0], degreeMinute.anchor[1] + 15], [500, 500]), 373.295, 'caption lane');
});

test('every position, font and stroke is the mock-up number times radius / 400', () => {
  const full = vintage.layoutVintageWheel(wheelInput(400, [moon]), measure);
  const small = vintage.layoutVintageWheel(wheelInput(358.5, [moon]), measure);
  const share = 358.5 / 400;
  const pairs = [[full.bodies[0].glyph, small.bodies[0].glyph], ...full.bodies[0].texts.map((text, i) => [text, small.bodies[0].texts[i]]),
    ...full.captions.map((text, i) => [text, small.captions[i]])];
  for (const [a, b] of pairs) {
    near(distance(b.anchor, [500, 500]), distance(a.anchor, [500, 500]) * share, `${a.text} radius`);
    near(b.size, a.size * share, `${a.text} size`);
  }
  near(small.angleRays[0].width, full.angleRays[0].width * share, 'angle stroke');
  near(vintage.vintageAspectPaint({type: 10}, share).dash[0], 14 * share, 'long dash');
  // An aspect is never heavier than a house cusp; orb thickness only thins it.
  near(vintage.vintageAspectPaint({type: 6, orbRatio: 0}, 1).width, 2.4, 'exact aspect at cusp weight');
  near(vintage.vintageAspectPaint({type: 6, orbRatio: 1}, 1).width, 1.2, 'wide orb thinned');
});

test('crowded stacks spread symmetrically with the leader, isolated stacks stay on their degree', () => {
  // The Reading chart's Aries cluster, which the mock-up placed by hand.
  const aries = [['mercury', 10.64], ['jupiter', 9.86], ['saturn', 2.58]].map(([key, angle]) =>
    ({...moon, key, angle, degText: '10', minText: '38', signGlyph: 'a'}));
  const layout = vintage.layoutVintageWheel(wheelInput(400, [moon, ...aries]), measure);
  const byKey = new Map(layout.bodies.map(body => [body.key, body]));
  assert.equal(byKey.get('moon').shift, 0);
  const placed = ['saturn', 'jupiter', 'mercury'].map(key => byKey.get(key).angle + byKey.get(key).shift);
  assert.ok(placed[0] < placed[1] && placed[1] < placed[2], 'order is preserved');
  assert.ok(placed[1] - placed[0] > 5 && placed[2] - placed[1] > 5, 'neighbouring stacks are separated');
  near(placed.reduce((a, b) => a + b) / 3, (10.64 + 9.86 + 2.58) / 3, 'the run stays centred on its true degrees');
  for (const key of ['mercury', 'saturn']) assert.ok(byKey.get(key).leader, `${key} has a leader to its true degree`);
});

function recordingCanvas() {
  const arcs = [];
  const context = new Proxy({
    font: '', globalAlpha: 1, lineWidth: 1,
    arc(_x, _y, radius) { arcs.push({radius}); },
    stroke() { const last = arcs[arcs.length - 1]; if (last && last.width == null) last.width = this.lineWidth; },
    measureText(text) {
      const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 14);
      return {width: size * text.length * .6, actualBoundingBoxAscent: size * .7, actualBoundingBoxDescent: 0,
        actualBoundingBoxLeft: 0, actualBoundingBoxRight: size * text.length * .6};
    },
  }, {get: (target, key) => key in target ? target[key] : () => {}});
  return {canvas: {width: 800, height: 800, style: {}, getContext: () => context}, arcs};
}

function vintageSnapshot(outerRingMode) {
  const composition = WHEEL_FACTORY_SETTINGS.layouts.cusps.composition;
  return {primaryChart: {meta: {cornerLines: {}}, aspects: [],
    planets: [{id: 'moon', seId: 1, longitude: 147.7, latitude: 0, speed: 12, glyph: 'B', degText: '27', minText: '42'}],
    angles: {asc: 213.3, dsc: 33.3, mc: 135, ic: 315, armc: 0, vertex: 0},
    houses: {system: 'R', cusps: Array.from({length: 12}, (_, i) => (213.3 + i * 30) % 360),
      cuspDegMin: Array.from({length: 12}, () => ({degText: '3', minText: '18'}))},
    options: {theme: WHEEL_FACTORY_SETTINGS.layouts.cusps.optionValue, wheelComposition: composition, signVariant: 1,
      showHouses: true, showPositions: true, showAspects: true}},
  outerRingMode, outerRingItems: [], overlayRenderMode: 'full', renderVariant: 'round-cusps'};
}

test('the production renderer dispatches the vintage preset to the port, with or without an outer ring', () => {
  const style = preset.resolveWheelGeometryPresetStyle(() => '', {revision: 'vintage-port'}, {profile: 'cusps',
    presets: {cusps: {id: 'factory.vintage-magazine', revision: 1, overrides: {'wheel.presentation': 'vintage-magazine'}}}});
  assert.equal(style.presentation, 'vintage-magazine');
  for (const mode of ['none', 'fixstars']) {
    const {canvas, arcs} = recordingCanvas();
    const draw = new CanvasDraw(canvas);
    draw.resize(800, 800, 1);
    const opts = {width: 800, height: 800, chartSize: 800, renderStyle: style};
    renderer.drawSnapshotLayer(draw, vintageSnapshot(mode), 'geometry', opts);
    const radius = arcs[0].radius;
    assert.deepEqual(arcs.map(arc => arc.radius / radius).map(ratio => Number(ratio.toFixed(6))),
      [1, Number((346.589 / 400).toFixed(6)), Number((178.031 / 400).toFixed(6))], `${mode}: measured circle ratios`);
    near(arcs[0].width, 2.738 * radius / 400, `${mode}: outer stroke`);
    const hits = renderer.computeHitRegions(vintageSnapshot(mode), {...opts,
      textsize: (text, o) => [(o?.size ?? 14) * text.length * .6, (o?.size ?? 14) * .7]});
    const moonHit = hits.find(hit => hit.kind === 'planet' && hit.planetId === 'moon');
    near(Math.hypot(moonHit.x - 400, moonHit.y - 400), 316 * radius / 400, `${mode}: hit target sits on the painted glyph`, 1e-6);
  }
});

const scene = load(resolve(src, 'lib/style-lab/wheel-style-scene.ts'));
const vintagePreset = {cusps: {id: 'factory.vintage-magazine', revision: 1, overrides: {'wheel.presentation': 'vintage-magazine'}}};
const vintageStyle = appearanceOverrides => preset.resolveWheelGeometryPresetStyle(() => '', {revision: 'vintage-edit'},
  {profile: 'cusps', presets: vintagePreset, appearanceOverrides});

test('class edits feed the port in its 400-unit frame and scale measured siblings together', () => {
  const plain = vintage.layoutVintageWheel(wheelInput(400, [moon]), measure);
  const edited = vintage.layoutVintageWheel({...wheelInput(400, [{...moon, motion: 'R'}]), classes: {
    text: {'bodies.inner.glyph': {size: 32, color: 'red', opacity: 0.5},
      'houses.inner.position.minute': {color: 'blue'}},
    line: {'angles.inner.ray': {width: 2.872 * 2}, 'bodies.inner.leader': {width: 2.7},
      'houses.inner.cusp': {width: 1, pattern: 'dashed'}, 'angles.inner.arrowhead': {arrowSize: 2},
      'rings.innerBoundary': {color: 'green'}},
  }}, measure);
  const glyph = edited.bodies[0].glyph;
  assert.equal(glyph.size, 32);
  assert.deepEqual([glyph.parts[0].spec.color, glyph.parts[0].spec.opacity], ['red', 0.5]);
  // Unedited classes keep the mock-up exactly.
  assert.deepEqual(edited.bodies[0].texts.slice(0, 3).map(text => text.size), plain.bodies[0].texts.map(text => text.size));
  near(edited.angleRays.find(ray => ray.angleId === 'dsc').width, 2.035 * 2, 'angles keep their measured proportions');
  near(edited.bodies[0].tickPaint.width, 1.8 * 2, 'ticks scale with the leader class');
  assert.equal(edited.cuspLines[0].width, 1);
  assert.deepEqual(edited.cuspLines[0].paint.dash, [14, 5]);
  const arrow = edited.angleRays.find(ray => ray.arrow).arrow;
  near(Math.hypot(arrow[0][0] - arrow[2][0], arrow[0][1] - arrow[2][1]), 4.4 * 2 * 2, 'arrowhead width doubles');
  assert.deepEqual(edited.circles.map(circle => circle.paint.color), ['black', 'green', 'black']);
  // A caption row is one printed run with separately styled degree and minute.
  const caption = edited.captions[0];
  assert.deepEqual(caption.spans.map(span => span.classId), ['houses.inner.position.degree', 'houses.inner.position.minute']);
  assert.deepEqual(caption.parts.map(part => part.spec.color), ['black', 'black', 'blue']);
  assert.equal(caption.text, plain.captions[0].text);
  near(caption.w, plain.captions[0].w, 'caption keeps its measured width');
  const aspect = vintage.vintageAspectPaint({type: 6, orbRatio: 1, color: 'grey'}, 1, {width: 1.2, pattern: 'solid', color: 'teal'});
  assert.deepEqual([aspect.width, aspect.dash, aspect.color], [0.6, [], 'teal']);
});

test('the vintage wheel reads its own scope only; shared and Cusp-wheel edits never reach it', () => {
  const ratios = style => {
    const {canvas, arcs} = recordingCanvas();
    const draw = new CanvasDraw(canvas);
    draw.resize(800, 800, 1);
    renderer.drawSnapshotLayer(draw, vintageSnapshot('none'), 'geometry', {width: 800, height: 800, chartSize: 800, renderStyle: style});
    return arcs.map(arc => arc.width / arcs[0].radius * 400);
  };
  const factory = ratios(vintageStyle({}));
  assert.deepEqual(ratios(vintageStyle({
    'authoring.wheel.base.rings.angloCuspOuter.strokeWidth': 9,
    'authoring.wheel.cusps.rings.innerBoundary.strokeWidth': 9,
  })), factory);
  const edited = ratios(vintageStyle({'authoring.wheel.vintage.rings.angloCuspOuter.strokeWidth': 5}));
  near(edited[0], 5, 'edited outer circle');
  assert.deepEqual(edited.slice(1), factory.slice(1));
});

test('Chart Style sees every painted vintage class at the painted geometry', () => {
  const style = vintageStyle({'authoring.wheel.vintage.bodies.inner.glyph.fontSize': 30});
  const snapshot = vintageSnapshot('none');
  snapshot.primaryChart.planets[0].motion = 'R';
  const opts = {width: 800, height: 800, chartSize: 800, renderStyle: style, includeStyleTargets: true,
    textsize: (text, o) => [(o?.size ?? 14) * text.length * .6, (o?.size ?? 14) * .7]};
  const hits = renderer.computeHitRegions(snapshot, opts);
  const targets = hits.filter(hit => hit.kind === 'style_target');
  const classes = new Set(targets.map(hit => hit.classId));
  for (const classId of ['bodies.inner.glyph', 'bodies.inner.position.degree', 'bodies.inner.position.minute',
    'bodies.inner.position.sign', 'bodies.inner.motion', 'bodies.inner.leader', 'houses.inner.label',
    'houses.inner.position.degree', 'houses.inner.position.minute', 'houses.inner.position.sign',
    'houses.inner.cusp', 'angles.inner.ray', 'angles.inner.arrowhead']) assert.ok(classes.has(classId), classId);
  assert.ok(targets.every(hit => vintage.isVintageClass(hit.classId) && hit.itemId.startsWith('vintage:')),
    'no ordinary-renderer target describes an unpainted wheel');
  const moonHit = hits.find(hit => hit.kind === 'planet' && hit.planetId === 'moon');
  const glyph = targets.find(hit => hit.classId === 'bodies.inner.glyph');
  near(glyph.x, moonHit.left + moonHit.width / 2, 'glyph target is the painted glyph', 1);

  const geometry = {...renderer.wheelGeometryInputForSnapshot(snapshot, 400)};
  const built = scene.buildWheelStyleScene({style, geometry, center: [400, 400], viewport: {width: 800, height: 800},
    ascendantDegrees: snapshot.primaryChart.angles.asc, hitRegions: hits});
  const editable = built.elements.filter(element => element.editability.state === 'editable' && element.hitGeometry);
  assert.ok(editable.every(element => element.stateTags.includes(scene.VINTAGE_PRESENTATION_TAG)));
  const glyphElement = built.elements.find(element => element.classId === 'bodies.inner.glyph' && element.hitGeometry);
  assert.equal(glyphElement.authoringDefaults.fontSizePx, 30, 'the inspector shows the vintage value');
  assert.equal(glyphElement.authoringDefaults.radiusPx, undefined);
  const rings = built.elements.filter(element => element.primitive === 'circle' && element.hitGeometry?.kind === 'circle');
  assert.deepEqual(rings.map(element => element.classId), ['rings.angloCuspOuter', 'rings.innerBoundary', 'rings.aspectBoundary']);
  near(rings[1].hitGeometry.radius / rings[0].hitGeometry.radius, 346.589 / 400, 'scene circles are the painted circles');
  assert.equal(rings[2].authoringDefaults.strokeWidthPx, 2.136);
  const zodiac = built.elements.find(element => element.classId === 'zodiac.signGlyph');
  assert.equal(zodiac.editability.state, 'read-only', 'a class the port does not paint is not offered');
  assert.equal(built.handles.length, 1, 'only the whole-wheel scale handle');
});

test('the daemon accepts exactly the classes the port paints in the vintage scope', () => {
  const python = readFileSync(resolve(src, '../../daemon/style_authoring_service.py'), 'utf8');
  const block = /VINTAGE_CLASSES = frozenset\(\{([\s\S]*?)\}\)/.exec(python)[1];
  const daemonClasses = [...block.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(daemonClasses, [...Object.keys(vintage.VINTAGE_TEXT_CLASSES), ...Object.keys(vintage.VINTAGE_LINE_CLASSES)].sort());
});

test('position sign glyphs take the zodiac element colours when those are on', () => {
  const style = vintageStyle({});
  const opts = {width: 800, height: 800, chartSize: 800, renderStyle: style, includeStyleTargets: true,
    textsize: (text, o) => [(o?.size ?? 14) * text.length * .6, (o?.size ?? 14) * .7]};
  const signColors = Array.from({length: 12}, (_, i) => `#0000${String(i).padStart(2, '0')}`);
  const colorsOf = useZodiacElementColors => {
    const snapshot = vintageSnapshot('none');
    Object.assign(snapshot.primaryChart.options, {useZodiacElementColors, signColors});
    const targets = renderer.computeHitRegions(snapshot, opts).filter(hit => hit.kind === 'style_target');
    return classId => new Set(targets.filter(hit => hit.classId === classId).map(hit => hit.colorValue));
  };
  const on = colorsOf(true), off = colorsOf(false);
  // Moon at 147.7 is in Leo (index 4).
  assert.deepEqual([...on('bodies.inner.position.sign')], ['#000004']);
  assert.ok([...on('houses.inner.position.sign')].every(color => signColors.includes(color)));
  assert.ok(on('houses.inner.position.sign').size > 1, 'each cusp sign takes its own colour');
  assert.deepEqual([...off('bodies.inner.position.sign')], [...off('bodies.inner.position.degree')]);
  assert.deepEqual([...on('bodies.inner.position.degree')], [...off('bodies.inner.position.degree')]);
});
