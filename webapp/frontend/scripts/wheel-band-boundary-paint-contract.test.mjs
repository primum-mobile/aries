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
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
  }).outputText;
  const localRequire = id => {
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    const target = id.startsWith('@/') ? resolve(src, id.slice(2)) : resolve(dirname(path), id);
    return load(target.endsWith('.json') ? target : `${target}.ts`);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const wheel = load(resolve(src, 'lib/chart/wheel-render-style.ts'));
const layout = load(resolve(src, 'lib/chart/wheel-layout-model.ts'));
const preset = load(resolve(src, 'lib/chart/wheel-geometry-preset.ts'));
const compositionApi = load(resolve(src, 'lib/chart/wheel-composition.ts'));
const sceneApi = load(resolve(src, 'lib/style-lab/wheel-style-scene.ts'));
const theme = JSON.parse(readFileSync(resolve(src, '../../daemon/shipping-style-profiles.json'), 'utf8'))['Neo Tokyo'];
const design = theme.wheelGeometry.designs.anglo;
const originalOrder = design.composition.rings.map(ring => ring.archetypeId);
const detachedDegreeOrder = ['outerHouses', 'outerBodies', 'zodiac', 'terms', 'degree', 'decans',
  'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
const withOrder = (order, labels = true) => ({...design.composition,
  rings: order.map(kind => ({...design.composition.rings.find(ring => ring.archetypeId === kind),
    enabled: kind === 'cuspLabels' ? labels : true})),
});
const geometry = composition => ({profile: 'anglo', mode: 'single', maxRadius: 400,
  showTerms: true, showDecans: true, showHouses: true, showPositions: true,
  hasOuterRing: true, outerRingMode: 'asteroids', comparisonWithOuterHouses: false, composition});
const style = wheel.projectWheelAuthoringStyle(preset.resolveWheelGeometryPresetStyle(() => '',
  {revision: 'cusp-material-boundaries'}, {profile: 'anglo',
    presets: {anglo: {id: 'working.anglo', revision: 1, overrides: design.overrides}},
    appearanceOverrides: theme.authoringOverrides}), 400, 'anglo');

// Run the production paint routines. Only drawing primitives and unrelated
// frame/pen helpers are replaced; the semantic boundary decision stays real.
const drawSource = readFileSync(resolve(src, 'lib/chart/draw-chart.ts'), 'utf8');
const ast = ts.createSourceFile('draw-chart.ts', drawSource, ts.ScriptTarget.Latest, true);
const paintFunctions = ['drawCircles', 'redrawMainCircles'].map(name => {
  const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join('\n');
const dependencies = {
  referenceScaleFrame: load(resolve(src, 'lib/chart/chart-coordinates.ts')).referenceScaleFrame,
  composedWheelLayout: layout.composedWheelLayout,
  wheelBandOuterBoundaryRole: layout.wheelBandOuterBoundaryRole,
  wheelHostedCuspRuler: layout.wheelHostedCuspRuler,
  wheelHasOuterDegreeRuler: layout.wheelHasOuterDegreeRuler,
  wheelDegreeTickEnds: layout.wheelDegreeTickEnds,
  wheelTypographyProfile: () => 'anglo',
  isAngloWheel: () => true,
  isCompactWheel: () => false,
  hasWheelRing: (chart, kind) => compositionApi.ringEnabled(chart.options.wheelComposition, kind, true),
  semanticLinePaint: (_style, role) => ({role}),
  drawRotatedLines: () => {},
  polar: (_center, radius, degree) => [radius, degree],
  chartRingPenWidth: () => 1,
  ascmcPenWidth: () => 1,
  degreeTickPenWidth: () => 1,
};
const compiledPaint = ts.transpileModule(paintFunctions, {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;
const paint = new Function(...Object.keys(dependencies), `${compiledPaint}; return {drawCircles, redrawMainCircles};`)(
  ...Object.values(dependencies));
function record(composition) {
  const input = geometry(composition);
  const rings = wheel.resolveWheelRingSet(style, input);
  const bands = layout.resolveWheelBandLayout(style, input, rings).bands;
  const circles = [];
  const draw = {circle: (_center, radius, opts) => circles.push({radius, role: opts.role}), line: () => {}};
  const chart = {options: {wheelComposition: composition, showTerms: true, showDecans: true}};
  paint.drawCircles(draw, [400, 400], rings, 800, style.palette, 0, chart, true, false, style);
  paint.redrawMainCircles(draw, [400, 400], rings, 800, style.palette, chart, style);
  return {bands, circles, scene: sceneApi.buildWheelStyleScene({style, geometry: input})};
}
const bandFor = (result, id) => result.bands.find(band => band.id === id && band.visible);
const near = (a, b) => Math.abs(a - b) < 1e-7;
const sceneRingAt = (result, radius) => result.scene.elements.filter(element => element.classId.startsWith('rings.')
  && element.hitGeometry?.kind === 'circle' && near(element.hitGeometry.radius, radius));
const assertBoundary = (result, id, role, classId) => {
  const band = bandFor(result, id);
  assert.ok(result.circles.some(circle => circle.role === role && near(circle.radius, band.outer)),
    `${id} has its own ${role} circle at its outer edge`);
  assert.ok(sceneRingAt(result, band.outer).some(element => element.classId === classId),
    `${id} has the matching ${classId} editor target`);
};

test('detaching Degree never paints the allocation join inside the combined cusp material', () => {
  for (const order of [originalOrder, detachedDegreeOrder]) {
    const result = record(withOrder(order));
    const ruler = bandFor(result, 'cuspRuler');
    const labels = bandFor(result, 'cuspLabels');
    assert.ok(near(ruler.inner, labels.outer), 'the screenshot has adjacent ruler and annotation parts');
    const join = labels.outer;
    assert.equal(result.circles.some(circle => near(circle.radius, join)), false,
      `${order.join(',')}: the internal allocation join at ${join}px must not become a painted circle`);
    assert.deepEqual(sceneRingAt(result, join), [],
      'an unpainted internal join must not become a selectable ring');
    assertBoundary(result, 'cuspRuler', 'cuspOuterRing', 'rings.angloCuspOuter');
    assertBoundary(result, 'bodies', 'innerBoundaryRing', 'rings.innerBoundary');
  }
  const detached = record(withOrder(detachedDegreeOrder));
  assertBoundary(detached, 'degree', 'innerDegreeRing', 'rings.innerDegree');
  assertBoundary(detached, 'terms', 'zodiacInnerRing', 'rings.zodiacInner');
  assertBoundary(detached, 'decans', 'termRing', 'rings.term');
});

test('separating cusp annotations keeps their actual material edge and semantic radius target', () => {
  const separated = record(withOrder(['outerHouses', 'outerBodies', 'zodiac', 'terms', 'decans',
    'cuspRuler', 'degree', 'cuspLabels', 'bodies', 'houses', 'hub']));
  assertBoundary(separated, 'cuspLabels', 'outerDegreeRing', 'rings.outerDegree');
  assertBoundary(separated, 'degree', 'innerDegreeRing', 'rings.innerDegree');
  const labelBoundary = sceneRingAt(separated, bandFor(separated, 'cuspLabels').outer)
    .find(element => element.classId === 'rings.outerDegree');
  assert.equal(labelBoundary.tokenBindings.find(binding => binding.property === 'radius')?.radiusTarget, 'cuspLabels');
  const reversed = record(withOrder(['outerHouses', 'outerBodies', 'zodiac', 'terms', 'degree', 'decans',
    'cuspLabels', 'cuspRuler', 'bodies', 'houses', 'hub']));
  assertBoundary(reversed, 'cuspLabels', 'outerDegreeRing', 'rings.outerDegree');
  assertBoundary(reversed, 'cuspRuler', 'cuspOuterRing', 'rings.angloCuspOuter');
  const hidden = record(withOrder(detachedDegreeOrder, false));
  assert.equal(hidden.circles.some(circle => circle.role === 'outerDegreeRing'), false,
    'disabled annotations do not leave a semantic circle behind');
  assert.equal(hidden.scene.elements.some(element => element.classId === 'rings.outerDegree'
    && element.hitGeometry?.kind === 'circle'), false);
});
