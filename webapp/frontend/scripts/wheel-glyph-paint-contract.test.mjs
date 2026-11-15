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
const wheel = load(resolve(src, 'lib/chart/wheel-render-style.ts'));
const layout = load(resolve(src, 'lib/chart/wheel-layout-model.ts'));
const preset = load(resolve(src, 'lib/chart/wheel-geometry-preset.ts'));
const renderer = load(resolve(src, 'lib/chart/draw-chart.ts'));
const adapter = load(resolve(src, 'lib/style-lab/wheel-authoring-adapter.ts'));
const {CanvasDraw} = load(resolve(src, 'lib/chart/canvas-draw.ts'));
const {WHEEL_FACTORY_SETTINGS} = load(resolve(src, 'lib/chart/wheel-composition.ts'));
const theme = JSON.parse(readFileSync(resolve(src, '../../daemon/shipping-style-profiles.json'), 'utf8'))['Neo Tokyo'];
const design = theme.wheelGeometry.designs.anglo;
const compiled = JSON.parse(readFileSync(resolve(src, '../scripts/fixtures/wheel-beta12-full-layout.json'), 'utf8'));
const beta = JSON.parse(readFileSync(resolve(src, '../scripts/fixtures/neo-tokyo-beta11-rings.json'), 'utf8'));
const families = {signSymbols: 'AriesMorinus, Sign fixture', termSymbols: 'AriesMorinus, Term fixture',
  decanSymbols: 'AriesMorinus, Decan fixture'};
const classFamilies = {'zodiac.signGlyph': families.signSymbols,
  'subdivisions.term.glyph': families.termSymbols, 'subdivisions.decan.glyph': families.decanSymbols};

function recordingCanvas() {
  const stack = [];
  const context = new Proxy({
    font: '', globalAlpha: 1,
    save() { stack.push({font: this.font, globalAlpha: this.globalAlpha}); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) {
      const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 14);
      return {width: size * text.length * .6, actualBoundingBoxAscent: size * .8,
        actualBoundingBoxDescent: size * .2, actualBoundingBoxLeft: 0};
    },
  }, {get: (target, key) => key in target ? target[key] : () => {}});
  return {width: 800, height: 800, style: {}, getContext: () => context};
}
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7,
  `${message}: ${actual} != ${expected}`);
const thickness = band => band.outer - band.inner;
const bandFor = (result, id) => result.bands.find(band => band.id === id && band.visible);
const glyphsFor = (result, classId) => result.text.filter(text => text.font === classFamilies[classId]
  && (classId !== 'zodiac.signGlyph' || text.layer === 'geometry'));
function nativeStyle(profile, overrides = {}, appearanceOverrides = {}) {
  const style = preset.resolveWheelGeometryPresetStyle(() => '', {revision: 'painted-font-contract'}, {
    profile, presets: {[profile]: {id: `working.${profile}`, revision: 1, overrides}}, appearanceOverrides,
  });
  return {...style, typography: {...style.typography, families: {...style.typography.families, ...families}}};
}
function compositionFor(source, order, terms, decans, degree = false) {
  return {...source, rings: order.map(id => ({...source.rings.find(ring => ring.archetypeId === id),
    enabled: id === 'terms' ? terms : id === 'decans' ? decans : id === 'degree' ? degree : source.rings.find(ring => ring.archetypeId === id).enabled}))};
}
function record(style, composition, profile = 'anglo', paneRadius = 400, sidereal = false, mode = 'outer', displayVisibility, rulerColor) {
  // Coordinates arrive already projected by the daemon in either zodiac.
  // The paint fixture changes their longitude, never the engine's calculations.
  const offset = sidereal ? 23.9 : 0;
  const chart = {meta: {cornerLines: {}, zodiac: sidereal ? 'sidereal' : 'tropical'}, planets: rulerColor ? [{id: "venus", seId: 3, longitude: 15, latitude: 0, speed: 1, color: rulerColor}] : [], aspects: [],
    angles: {asc: offset, dsc: 180 + offset, mc: 270 + offset, ic: 90 + offset},
    houses: {cusps: Array.from({length: 12}, (_, index) => (index * 30 + offset) % 360),
      cuspDegMin: Array.from({length: 12}, (_, index) => ({degText: String(index + 1), minText: '00'}))},
    options: {theme: WHEEL_FACTORY_SETTINGS.layouts[profile].optionValue, wheelComposition: composition,
      showHouses: true, showPositions: true, showAspects: false, showSymbols: false, signVariant: 1,
      usePlanetColorsForSubdivisions: displayVisibility?.planetColors ?? true,
      showInformation: false, showTerms: displayVisibility?.terms ?? true, showDecans: displayVisibility?.decans ?? true, showCusplessAscMcLabels: false,
      terms: Array.from({length: 12}, (_, sign) => [{rulerSeId: 3, size: 30, rulerLon: sign * 30 + 15, rulerGlyph: 'F'}]),
      decans: Array.from({length: 12}, (_, sign) => ({rulers: Array.from({length: 3}, (_, index) =>
        ({rulerSeId: 3, rulerLon: sign * 30 + index * 10 + 5, rulerGlyph: 'G'}))})),
    }};
  const snapshot = {primaryChart: chart, outerRingMode: mode === 'outer' ? 'asteroids' : 'none', outerRingItems: [],
    overlayRenderMode: 'full', renderVariant: `round-${profile}`,
    ...(mode === 'comparison' ? {comparisonChart: structuredClone(chart), document: {compoundKind: 'synastry'}} : {})};
  const renderOptions = {width: 800, height: 800, chartSize: paneRadius * 2, renderStyle: style};
  const text = [];
  const ticks = [];
  const tickColors = new Map(['angloCuspRuler', 'inner', 'outer'].flatMap((role, roleIndex) =>
    ['1deg', '5deg', '10deg'].map((unit, unitIndex) => [`rgb(${roleIndex + 1},${unitIndex + 1},123)`, `zodiac.tick.${role}.${unit}`])));
  style = {...style, authoringOverrides: {...style.authoringOverrides, linePaint: {
    ...style.authoringOverrides.linePaint, [profile]: {...style.authoringOverrides.linePaint[profile],
      ...Object.fromEntries([...tickColors].map(([color, classId]) => [classId, {color}]))}}}};
  renderOptions.renderStyle = style;
  let layer = 'geometry';
  const draw = new CanvasDraw(recordingCanvas());
  draw.resize(800, 800, 1);
  const paintText = draw.text.bind(draw);
  draw.text = (point, value, paint) => {
    text.push({point, value, font: paint.font, size: paint.size, fill: paint.fill, layer});
    paintText(point, value, paint);
  };
  const paintLine = draw.line.bind(draw);
  draw.line = (points, paint) => {
    if (tickColors.has(paint.fill)) ticks.push({classId: tickColors.get(paint.fill),
      length: Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1])});
    paintLine(points, paint);
  };
  renderer.drawSnapshotLayer(draw, snapshot, 'geometry', renderOptions);
  layer = 'dynamic';
  renderer.drawSnapshotLayer(draw, snapshot, 'dynamic', renderOptions);
  const hits = renderer.computeHitRegions(snapshot, {...renderOptions, includeStyleTargets: true,
    textsize: draw.textsize.bind(draw), textbounds: draw.textbounds.bind(draw)});
  const maxRadius = paneRadius * wheel.resolveWheelScale(style, profile);
  const projected = wheel.projectWheelAuthoringStyle(style, maxRadius, profile);
  const geometry = renderer.wheelGeometryInputForSnapshot(snapshot, maxRadius);
  const rings = wheel.resolveWheelRingSet(projected, geometry);
  return {text, ticks, hits, geometry, rings, bands: layout.resolveWheelBandLayout(projected, geometry, rings).bands,
    typography: wheel.resolveWheelTypographyMetrics(projected, profile, maxRadius, geometry), projected};
}
function assertFontAndHits(result, classId, expected) {
  const glyphs = glyphsFor(result, classId);
  assert.ok(glyphs.length, `${classId} is really painted`);
  for (const glyph of glyphs) near(glyph.size, expected, `${classId} actual paint size`);
  const context = {geometry: result.geometry, targetWheelRadius: result.geometry.maxRadius};
  for (const runtime of [undefined, expected]) {
    const defaults = adapter.readWheelAuthoringClassDefaults(result.projected, result.geometry.profile, classId,
      {...context, ...(runtime == null ? {} : {runtimeFontSizePx: runtime})});
    near(defaults.fontSizePx * result.geometry.maxRadius / 400, expected, `${classId} editor default matches actual paint`);
  }
  if (classId === 'zodiac.signGlyph') {
    const signHits = result.hits.filter(hit => hit.kind === 'sign');
    assert.equal(signHits.length, 12);
    for (const [index, hit] of signHits.entries()) {
      near(glyphs[index].point[0] + expected / 2, hit.x, 'sign paint and hit centre X');
      near(glyphs[index].point[1] + expected / 2, hit.y, 'sign paint and hit centre Y');
    }
  } else {
    const family = classId === 'subdivisions.term.glyph' ? 'term' : 'decan';
    const hits = result.hits.filter(hit => hit.kind === 'subdivision' && hit.family === family && hit.component === 'glyph');
    assert.equal(hits.length, glyphs.length);
    for (const [index, hit] of hits.entries()) {
      near(glyphs[index].point[0] + expected / 2, hit.x, `${family} paint and hit centre X`);
      near(glyphs[index].point[1] + expected / 2, hit.y, `${family} paint and hit centre Y`);
    }
  }
}

test('native Anglo paint retains surviving fonts and preferred bands through visibility and Degree movement', () => {
  const outside = ['outerHouses', 'outerBodies', 'degree', 'zodiac', 'terms', 'decans',
    'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
  for (const inherited of [false, true]) for (const paneRadius of [180, 400, 733.5])
  for (const sidereal of [false, true]) {
    const source = inherited ? design.composition : WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
    const original = source.rings.map(ring => ring.archetypeId);
    const style = nativeStyle('anglo', inherited ? design.overrides : {}, inherited ? theme.authoringOverrides : {});
    const full = record(style, compositionFor(source, original, true, true), 'anglo', paneRadius, sidereal);
    if (inherited) for (const [field, value] of Object.entries(beta.rings))
      near(full.rings[field], value * full.geometry.maxRadius / 400, `${field} accepted Neo Tokyo geometry`);
    const fullDegree = record(style, compositionFor(source, original, true, true, true), 'anglo', paneRadius, sidereal);
    const saved = JSON.stringify(style);
    const references = new Map([[true, true], [true, false], [false, true], [false, false]].map(([terms, decans]) =>
      [`${terms}/${decans}`, record(style, compositionFor(source, original, terms, decans), 'anglo', paneRadius, sidereal)]));
    for (const order of [original, outside]) for (const degree of [false, true])
    for (const [terms, decans] of [[true, true], [true, false], [false, true], [false, false], [true, true]]) {
      const current = record(style, compositionFor(source, order, terms, decans, degree), 'anglo', paneRadius, sidereal);
      for (const [classId, size] of [['zodiac.signGlyph', 16],
        ['subdivisions.term.glyph', 12.5], ['subdivisions.decan.glyph', 12.5]]) {
        if (classId.includes('term.') && !terms || classId.includes('decan.') && !decans) continue;
        const ceiling = layout.resolveWheelClassFontSizeCeiling(classId, current.bands);
        const family = classId === 'zodiac.signGlyph' ? 'sign' : classId.includes('term.') ? 'term' : 'decan';
        const accepted = compiled.expected[`anglo|outer|${inherited ? 'inherited' : 'factory'}|1|1`].sizes[family] ?? size;
        const expected = Math.min(accepted * current.geometry.maxRadius / 400, ceiling);
        assertFontAndHits(current, classId, expected);
        near(glyphsFor(current, classId)[0].size, glyphsFor(full, classId)[0].size,
          `${classId} visibility and ruler order preserve the actual paint size`);
      }
      for (const id of ['zodiac', 'cuspRuler', 'cuspLabels', 'bodies', 'houses'])
        near(thickness(bandFor(current, id)), thickness(bandFor(full, id)), `${id} preferred width`);
      const released = (terms ? 0 : thickness(bandFor(full, 'terms')))
        + (decans ? 0 : thickness(bandFor(full, 'decans')));
      near(bandFor(current, 'hub').outer, bandFor(full, 'hub').outer + released, 'only hub receives released depth');
      near(current.rings.rSign, full.rings.rSign, 'Signs keep their accepted glyph radius');
      for (const tick of current.ticks) {
        const reference = fullDegree.ticks.find(item => item.classId === tick.classId);
        near(tick.length, reference.length, `${tick.classId} toggles and order preserve actual tick length`);
      }
      if (degree) assert.ok(bandFor(current, 'degree').overlay, 'Degree has no allocated width');
      const cuspText = result => result.text.filter(text => !Object.values(families).includes(text.font)
        || text.font === families.signSymbols && text.layer === 'dynamic');
      const referenceText = cuspText(references.get(`${terms}/${decans}`));
      assert.ok(referenceText.length >= 24, 'Cusp position labels are really painted');
      const labels = cuspText(current);
      assert.equal(labels.length, referenceText.length);
      for (const [index, label] of labels.entries()) {
        const reference = referenceText[index];
        assert.deepEqual([label.value, label.font, label.size, label.layer],
          [reference.value, reference.font, reference.size, reference.layer], 'Degree preserves Cusp label typography');
        near(label.point[0], reference.point[0], 'Degree preserves Cusp label X');
        near(label.point[1], reference.point[1], 'Degree preserves Cusp label Y');
      }
    }
    assert.equal(JSON.stringify(style), saved, 'paint never rewrites saved style or font values');
  }
});

test('font edits and whole-chart scale remain independent of band widths and radius edits', () => {
  const source = design.composition;
  const order = source.rings.map(ring => ring.archetypeId);
  const composition = compositionFor(source, order, true, true);
  const fonts = {'authoring.wheel.anglo.zodiac.signGlyph.fontSize': 17,
    'authoring.wheel.anglo.subdivisions.term.glyph.fontSize': 9,
    'authoring.wheel.anglo.subdivisions.decan.glyph.fontSize': 8};
  for (const paneRadius of [180, 400, 733.5]) for (const scale of [.5, .942016, 1]) {
    const overrides = {...design.overrides, 'authoring.wheel.anglo.canvas.chart.scale': scale};
    const style = nativeStyle('anglo', overrides, fonts);
    const accepted = record(style, composition, 'anglo', paneRadius);
    const wide = record(nativeStyle('anglo', {...overrides,
      'authoring.wheel.anglo.canvas.ring.anglo-zodiac.bandWidth': 80,
      'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth': 32,
      'authoring.wheel.anglo.canvas.ring.anglo-decans.bandWidth': 35}, fonts), composition, 'anglo', paneRadius);
    const radiusEdit = {...style, authoringOverrides: {...style.authoringOverrides,
      ringRadii: {anglo: {innerBoundaryRing: 295}}, radiusPriority: {anglo: 'innerBoundaryRing'}}};
    const resized = record(radiusEdit, composition, 'anglo', paneRadius);
    for (const [classId, referenceSize] of [['zodiac.signGlyph', 17], ['subdivisions.term.glyph', 9],
      ['subdivisions.decan.glyph', 8]]) {
      const expected = referenceSize * paneRadius * scale / 400;
      for (const result of [accepted, wide, resized]) assertFontAndHits(result, classId, expected);
    }
    near(thickness(bandFor(wide, 'terms')), 32 * paneRadius * scale / 400, 'explicit width still changes the band');
    assert.ok(Math.abs(resized.rings.rInner - accepted.rings.rInner) > .1, 'explicit radius still changes the boundary');
  }
});

test('oversized authored fonts are fitted once after typography overrides and share the painted hit bounds', () => {
  const source = design.composition;
  const composition = compositionFor(source, source.rings.map(ring => ring.archetypeId), true, true);
  const oversized = {'authoring.wheel.anglo.zodiac.signGlyph.fontSize': 96,
    'authoring.wheel.anglo.subdivisions.term.glyph.fontSize': 128,
    'authoring.wheel.anglo.subdivisions.decan.glyph.fontSize': 128};
  for (const paneRadius of [180, 400, 733.5]) {
    const style = nativeStyle('anglo', design.overrides, oversized);
    const result = record(style, composition, 'anglo', paneRadius);
    for (const classId of Object.keys(classFamilies)) {
      const ceiling = layout.resolveWheelClassBandThickness(classId, result.bands);
      assertFontAndHits(result, classId, ceiling);
      assert.ok(glyphsFor(result, classId)[0].size < 90 * result.geometry.maxRadius / 400,
        'the second typography application cannot bypass containment');
    }
    assert.equal(style.authoringOverrides.typography.anglo['subdivisions.term.glyph'].fontSizePx, 128,
      'containment preserves the explicit authored value');
  }
});

test('native Classic, Compact and Traditional paint use authored sizes and physical containment', () => {
  for (const profile of ['classic', 'compact']) for (const traditional of [false, true]) {
    if (traditional && profile !== 'compact') continue;
    const style = nativeStyle(profile, traditional ? {'wheel.presentation': 'traditional-morinus'} : {});
    const source = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
    const order = source.rings.map(ring => ring.archetypeId);
    for (const paneRadius of [180, 400, 733.5]) for (const sidereal of [false, true])
    for (const terms of [false, true]) for (const decans of [false, true]) {
      const result = record(style, compositionFor(source, order, terms, decans), profile, paneRadius, sidereal);
      for (const [classId, size, visible] of [['zodiac.signGlyph', result.typography.signSize, true],
        ['subdivisions.term.glyph', result.typography.termSize, terms], ['subdivisions.decan.glyph', result.typography.decanSize, decans]]) {
        if (visible) assertFontAndHits(result, classId,
          Math.min(size, layout.resolveWheelClassFontSizeCeiling(classId, result.bands)));
      }
    }
  }
});


test('all native factory families retain compiled full geometry and production typography across display modes', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const mode of ['bare', 'outer', 'comparison']) for (const inherited of [false, true])
  for (const sidereal of [false, true]) {
    const source = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
    const overrides = inherited ? theme.wheelGeometry.designs[profile].overrides : {};
    const style = nativeStyle(profile, overrides, inherited ? theme.authoringOverrides : {});
    const current = record(style, compositionFor(source, source.rings.map(ring => ring.archetypeId),
      profile === 'anglo' || profile === 'classic' || profile === 'compact',
      profile === 'anglo' || profile === 'classic' || profile === 'compact',
      source.rings.find(ring => ring.archetypeId === 'degree')?.enabled ?? false),
    profile, 400 / wheel.resolveWheelScale(style, profile), sidereal, mode);
    const key = `${profile}|${mode}|${inherited ? 'inherited' : 'factory'}|${['houses', 'cusps'].includes(profile) ? '0|0' : '1|1'}`;
    const expected = compiled.expected[key];
    for (const [family, classId] of [['sign', 'zodiac.signGlyph'], ['term', 'subdivisions.term.glyph'],
      ['decan', 'subdivisions.decan.glyph']]) {
      if (expected.sizes[family] != null) assertFontAndHits(current, classId, expected.sizes[family]);
    }
    if (!inherited) for (const field of Object.keys(expected.rings)) {
      // Today's readability and rim-clearance corrections have their own
      // contracts. The compiled source remains authority for band proportions.
      if (['rPlanet', 'rPos', 'rRetr', 'rLLine', 'rPosAscMC'].includes(field)) continue;
      near(current.rings[field], expected.rings[field], `${key}/${field} compiled full factory geometry`);
    }
    if (profile === 'anglo') for (const [color, length] of Object.entries(expected.tickSizes)) {
      const unit = {'rgb(1,2,3)': '1deg', 'rgb(4,5,6)': '5deg', 'rgb(7,8,9)': '10deg'}[color];
      near(current.ticks.find(tick => tick.classId === `zodiac.tick.angloCuspRuler.${unit}`).length,
        length, `${key}/${unit} accepted full Cusp tick size`);
    }
  }
});

test('deliberate own-band widths still scale fallback glyphs and invert without changing sibling fonts', () => {
  const source = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const order = source.rings.map(ring => ring.archetypeId);
  const composition = compositionFor(source, order, true, true);
  for (const [id, classId] of [['zodiac', 'zodiac.signGlyph'], ['terms', 'subdivisions.term.glyph'],
    ['decans', 'subdivisions.decan.glyph']]) {
    const baseline = record(nativeStyle('anglo'), composition);
    const baseWidth = thickness(bandFor(baseline, id));
    const baseSize = glyphsFor(baseline, classId)[0].size;
    for (const width of [baseWidth * 1.5, baseWidth * .9, baseWidth]) {
      const style = nativeStyle('anglo', {[`authoring.wheel.anglo.canvas.ring.anglo-${id}.bandWidth`]: width});
      const edited = record(style, composition);
      assertFontAndHits(edited, classId, baseSize * width / baseWidth);
      for (const sibling of Object.keys(classFamilies).filter(key => key !== classId))
        near(glyphsFor(edited, sibling)[0].size, glyphsFor(baseline, sibling)[0].size, `${sibling} independent own-band edit`);
      const hidden = record(style, compositionFor(source, order, id === 'terms', id === 'decans'));
      assertFontAndHits(hidden, classId, baseSize * width / baseWidth);
    }
  }
});


test('Cusp ticks share contiguous annotation material and stop before unrelated narrow reordered bands', () => {
  const source = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const original = source.rings.map(ring => ring.archetypeId);
  const orders = [original, ['outerHouses', 'outerBodies', 'zodiac', 'degree', 'terms',
    'cuspRuler', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub']];
  for (const order of orders) for (const width of [2, 10.74, 20]) {
    const style = nativeStyle('anglo', {'authoring.wheel.anglo.canvas.ring.anglo-cuspRuler.bandWidth': width});
    const result = record(style, compositionFor(source, order, true, true));
    const ruler = bandFor(result, 'cuspRuler');
    const labels = bandFor(result, 'cuspLabels');
    const shared = Math.abs(ruler.inner - labels.outer) < 1e-7;
    const material = ruler.outer - (shared ? labels.inner : ruler.inner);
    const ticks = result.ticks.filter(tick => tick.classId.includes('angloCuspRuler'));
    assert.equal(ticks.length, 360);
    for (const tick of ticks) assert.ok(tick.length <= material + 1e-7, 'Cusp tick stays inside its material');
    if (shared) assert.ok(ticks.some(tick => tick.length > thickness(ruler)), 'accepted long tick crosses only the shared seam');
  }
});


test('a deliberate radius edit proportionally sizes fallback Signs without authoring font values', () => {
  const source = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const composition = compositionFor(source, source.rings.map(ring => ring.archetypeId), true, true);
  const style = nativeStyle('anglo');
  const baseline = record(style, composition);
  const resizedStyle = {...style, authoringOverrides: {...style.authoringOverrides,
    ringRadii: {anglo: {zodiacInnerRing: baseline.rings.r0 - 4}}, radiusPriority: {anglo: 'zodiacInnerRing'}}};
  const resized = record(resizedStyle, composition);
  assert.ok(thickness(bandFor(resized, 'zodiac')) > thickness(bandFor(baseline, 'zodiac')) + 3.9);
  assertFontAndHits(resized, 'zodiac.signGlyph', glyphsFor(baseline, 'zodiac.signGlyph')[0].size
    * thickness(bandFor(resized, 'zodiac')) / thickness(bandFor(baseline, 'zodiac')));
  assert.equal(resizedStyle.authoringOverrides.typography.anglo, undefined);
});


test('term and decan wheel paint inherit the ruler planet token and preserve explicit class overrides', () => {
  for (const profile of ['classic', 'compact', 'anglo']) {
    const source = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
    const composition = compositionFor(source, source.rings.map(ring => ring.archetypeId), true, true);
    for (const overridden of [false, true]) for (const planetColors of [false, true]) {
      const style = nativeStyle(profile, {}, overridden ? {
        [`authoring.wheel.${profile}.subdivisions.term.glyph.color`]: '#00ff00',
        [`authoring.wheel.${profile}.subdivisions.decan.glyph.color`]: '#00ff00',
      } : {});
      const result = record(style, composition, profile, 400, false, 'outer', {planetColors}, '#ff0000');
      for (const classId of ['subdivisions.term.glyph', 'subdivisions.decan.glyph']) {
        const glyphs = glyphsFor(result, classId);
        assert.ok(glyphs.length);
        for (const glyph of glyphs) assert.equal(glyph.fill,
          overridden ? 'rgb(0 255 0 / 100%)' : planetColors ? '#ff0000' : style.palette.signs);
      }
    }
  }
});
