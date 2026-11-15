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
function harness() {
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
      if (id === '@/lib/daemon/client') return {};
      if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
      const target = id.startsWith('@/') ? resolve(src, id.slice(2)) : resolve(dirname(path), id);
      return load(target.endsWith('.json') ? target : `${target}.ts`);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  return {
    wheel: load(resolve(src, 'lib/chart/wheel-render-style.ts')),
    layout: load(resolve(src, 'lib/chart/wheel-layout-model.ts')),
    preset: load(resolve(src, 'lib/chart/wheel-geometry-preset.ts')),
    adapter: load(resolve(src, 'lib/style-lab/wheel-authoring-adapter.ts')),
    composition: load(resolve(src, 'lib/chart/wheel-composition.ts')),
    store: load(resolve(src, 'stores/chart-style-editor-store.ts')).useChartStyleEditorStore,
  };
}
const api = harness();
const shipping = JSON.parse(readFileSync(resolve(src, '../../daemon/shipping-style-profiles.json'), 'utf8'));
const theme = shipping['Neo Tokyo'];
const design = theme.wheelGeometry.designs.anglo;
// The user's live recipe, excluding chart/session data. Stable instances and
// inherited dimensions come directly from the checked-in accepted theme.
const shownOrder = ['outerHouses', 'outerBodies', 'cuspRuler', 'zodiac', 'terms', 'degree',
  'decans', 'cuspLabels', 'bodies', 'houses', 'hub'];
const originalOrder = design.composition.rings.map(ring => ring.archetypeId);
const withOrder = (order, labels = false) => ({...design.composition,
  rings: order.map(kind => ({...design.composition.rings.find(ring => ring.archetypeId === kind),
    enabled: kind === 'cuspLabels' ? labels : true})),
});
const geometry = (composition, maxRadius = 400) => ({profile: 'anglo', mode: 'single', maxRadius,
  showTerms: true, showDecans: true, showHouses: true, showPositions: true,
  hasOuterRing: true, outerRingMode: 'asteroids', comparisonWithOuterHouses: false, composition});
const styleFor = (overrides, maxRadius = 400, production = api) => production.wheel.projectWheelAuthoringStyle(
  production.preset.resolveWheelGeometryPresetStyle(() => '', {revision: 'inherited-transition'}, {
    profile: 'anglo', presets: {anglo: {id: 'working.anglo', revision: 1, overrides}},
    appearanceOverrides: theme.authoringOverrides,
  }), maxRadius, 'anglo');
const solve = (style, composition, maxRadius = 400, production = api) => {
  const input = geometry(composition, maxRadius);
  const rings = production.wheel.resolveWheelRingSet(style, input);
  return {rings, bands: production.layout.resolveWheelBandLayout(style, input, rings).bands};
};
const thickness = band => band.outer - band.inner;
const bandFor = (result, id) => result.bands.find(band => band.id === id && band.visible);
const near = (actual, expected, context, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${context}: ${actual} != ${expected}`);
function permutations(items) {
  return items.length < 2 ? [items] : items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));
}
const selectedState = (composition, overrides = design.overrides) => ({schemaVersion: 1, revision: 1,
  selected: {anglo: 'working.anglo'}, presets: [], context: {sourceThemeName: 'Neo Tokyo', revision: 1},
  drafts: {anglo: {sourcePresetId: 'working.anglo', overrides, composition, dirty: false}},
});
const classForRole = role => api.adapter.WHEEL_RING_CLASS_IDS.find(classId =>
  api.adapter.wheelRingRoleForClass(classId) === role);

test('inherited Neo Tokyo dimensions survive every legal ruler/subdivision order with residual depth in the hub', () => {
  let checked = 0;
  for (const maxRadius of [180, 400, 733.5]) {
    const style = styleFor(design.overrides, maxRadius);
    const accepted = solve(style, withOrder(originalOrder), maxRadius);
    for (const middle of permutations(['cuspRuler', 'zodiac', 'terms', 'degree', 'decans'])) {
      const composition = withOrder(['outerHouses', 'outerBodies', ...middle, 'cuspLabels', 'bodies', 'houses', 'hub']);
      if (!api.composition.compatibleRingOrder(composition)) continue;
      const result = solve(style, composition, maxRadius);
      const context = `${maxRadius}/${middle.join(',')}`;
      for (const id of ['zodiac', 'terms', 'decans', 'bodies', 'houses']) {
        near(thickness(bandFor(result, id)), thickness(bandFor(accepted, id)), `${context}/${id}`);
      }
      const allocated = result.bands.filter(band => band.visible && !band.overlay && !band.floating
        && !['margin', 'hub'].includes(band.id));
      const outer = Math.max(...allocated.map(band => band.outer));
      near(bandFor(result, 'hub').outer, outer - allocated.reduce((sum, band) => sum + thickness(band), 0),
        `${context}/only hub absorbs residual`);
      assert.deepEqual(solve(JSON.parse(JSON.stringify(style)), composition, maxRadius).rings, result.rings,
        `${context}: saved preferences survive release/reload`);
      checked++;
    }
  }
  assert.equal(checked, 360);
});

test('hiding cusp annotations and hosting a ruler release only their allocated depth to the hub', () => {
  const style = styleFor(design.overrides);
  const visible = solve(style, withOrder(originalOrder, true));
  const hidden = solve(style, withOrder(originalOrder, false));
  const hosted = solve(style, withOrder(['outerHouses', 'outerBodies', 'cuspRuler', 'zodiac', 'degree',
    'terms', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'], false));
  for (const id of ['zodiac', 'terms', 'decans', 'bodies', 'houses']) {
    near(thickness(bandFor(hidden, id)), thickness(bandFor(visible, id)), `labels hidden/${id}`);
    near(thickness(bandFor(hosted, id)), thickness(bandFor(visible, id)), `ruler hosted/${id}`);
  }
  near(bandFor(hidden, 'hub').outer - bandFor(visible, 'hub').outer,
    thickness(bandFor(visible, 'cuspLabels')), 'hidden annotations free their depth');
  near(bandFor(hosted, 'hub').outer - bandFor(hidden, 'hub').outer,
    thickness(bandFor(hidden, 'cuspRuler')), 'hosted ruler frees its allocated depth');
  near(thickness(bandFor(hosted, 'cuspRuler')), thickness(bandFor(hidden, 'cuspRuler')),
    'hosting retains preferred ruler depth when Signs can contain it');
});

test('temporary subdivision visibility preserves authored ruler attachment and sends freed depth to the hub', () => {
  const outsideOrder = ['outerHouses', 'outerBodies', 'degree', 'zodiac', 'terms', 'decans',
    'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
  for (const maxRadius of [180, 400, 733.5]) {
    const style = styleFor(design.overrides, maxRadius);
    assert.deepEqual(style.authoringOverrides.radiusPriority, {}, 'fixture has no explicit edit priority');
    assert.deepEqual(style.authoringOverrides.outerDegreeBinding, {}, 'fixture has no terminal retargeting');
    assert.equal(style.authoringOverrides.ringRadii.anglo, undefined, 'old recipe values are inherited dimensions');
    const sample = (order, degree, terms, decans) => {
      const composition = withOrder(order, true);
      composition.rings = composition.rings.map(ring => ({...ring,
        enabled: ring.archetypeId === 'degree' ? degree : ring.archetypeId === 'terms' ? terms
          : ring.archetypeId === 'decans' ? decans : true}));
      const input = {...geometry(composition, maxRadius), showTerms: terms, showDecans: decans};
      const rings = api.wheel.resolveWheelRingSet(style, input);
      return {composition, input, rings, bands: api.layout.resolveWheelBandLayout(style, input, rings).bands};
    };
    const accepted = sample(originalOrder, false, true, true);
    const scale = maxRadius / 400;
    near(thickness(bandFor(accepted, 'zodiac')), 31 * scale, 'accepted Signs width');
    near(thickness(bandFor(accepted, 'cuspRuler')), 10.74 * scale, 'accepted Cusp width');
    const sequence = [[outsideOrder, true, true, true], [outsideOrder, true, false, true],
      [outsideOrder, true, false, false], [outsideOrder, false, false, false],
      [originalOrder, true, false, false], [outsideOrder, true, false, false],
      [outsideOrder, false, true, true], [originalOrder, false, true, true]];
    for (const [order, degree, terms, decans] of sequence) {
      const current = sample(order, degree, terms, decans);
      for (const id of ['zodiac', 'cuspRuler', 'cuspLabels', 'bodies', 'houses'])
        near(thickness(bandFor(current, id)), thickness(bandFor(accepted, id)),
          `${maxRadius}/${degree}/${terms}/${decans}/${id}: toggles preserve preferred dimensions`);
      const cusp = bandFor(current, 'cuspRuler');
      assert.ok(!cusp.overlay, 'hidden authored subdivision rows still separate Cusp from Signs');
      assert.deepEqual(api.layout.wheelCuspRulerTickEnds(current.composition, cusp),
        {base: cusp.outer, tip: cusp.inner}, 'allocated Cusp keeps its inward semantic endpoints');
      const released = (terms ? 0 : 13) + (decans ? 0 : 13.7);
      near(bandFor(current, 'hub').outer, (190.6 + released) * scale,
        'only the hub receives unoccupied subdivision depth');
      const instrument = bandFor(current, 'degree');
      if (degree) assert.ok(instrument.overlay, 'Degree beside Signs remains a width-free overlay');
      assert.deepEqual(api.wheel.resolveWheelRingSet(JSON.parse(JSON.stringify(style)), current.input), current.rings);
    }
    const hidden = sample(outsideOrder, false, false, false);
    const enabled = sample(outsideOrder, true, false, false);
    for (const field of ['rASCMC', 'rArrow', 'rSign', 'rCuspLabel', 'rPosHouses', 'rPlanet', 'rRetr',
      'rPos', 'rPosAscMC', 'rHouseName', 'rLLine', 'rLLine2', 'rAsp', 'rAspAscMC'])
      near(enabled.rings[field], hidden.rings[field], `${field}: Degree visibility preserves every visible content anchor`);
    const removed = {...hidden.composition,
      rings: hidden.composition.rings.filter(ring => !['terms', 'decans'].includes(ring.archetypeId))};
    const removedInput = {...hidden.input, composition: removed};
    const removedRings = api.wheel.resolveWheelRingSet(style, removedInput);
    const removedBands = api.layout.resolveWheelBandLayout(style, removedInput, removedRings).bands;
    const hosted = removedBands.find(band => band.id === 'cuspRuler' && band.visible);
    assert.ok(hosted.overlay, 'explicit removal changes the authored relationship and permits Cusp attachment');
    assert.equal(hosted.attachment.edge, 'inner');
    near(removedBands.find(band => band.id === 'hub').outer, (190.6 + 13 + 13.7 + 10.74) * scale,
      'explicit hosting releases precisely the remembered Cusp lane');
  }
});

test('a disabled cusp annotation separator preserves Degree and Cusp attachment relationships', () => {
  const style = styleFor(design.overrides);
  for (const [kind, order] of [
    ['degree', ['outerHouses', 'outerBodies', 'zodiac', 'cuspLabels', 'degree', 'terms', 'decans',
      'cuspRuler', 'bodies', 'houses', 'hub']],
    ['cuspRuler', ['outerHouses', 'outerBodies', 'degree', 'zodiac', 'cuspLabels', 'cuspRuler',
      'terms', 'decans', 'bodies', 'houses', 'hub']],
  ]) {
    const visible = solve(style, withOrder(order, true));
    const hidden = solve(style, withOrder(order, false));
    for (const result of [visible, hidden]) {
      assert.ok(!bandFor(result, kind).overlay, `${kind}: annotation remains an authored separator while hidden`);
      near(thickness(bandFor(result, 'zodiac')), 31, `${kind}: Signs retain their preferred width`);
    }
    near(thickness(bandFor(hidden, kind)), thickness(bandFor(visible, kind)), `${kind}: ruler retains allocated width`);
    near(bandFor(hidden, 'hub').outer - bandFor(visible, 'hub').outer,
      thickness(bandFor(visible, 'cuspLabels')), 'hidden separator releases only its physical depth');
  }
});

test('an empty native factory basis retains default preferred dimensions through subdivision and Degree toggles', () => {
  const factory = api.composition.WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const original = factory.rings.map(ring => ring.archetypeId);
  const outside = ['outerHouses', 'outerBodies', 'degree', 'zodiac', 'terms', 'decans',
    'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
  for (const maxRadius of [180, 400, 733.5]) {
    const style = styleFor({}, maxRadius);
    assert.deepEqual(style.authoringOverrides.recipeRadii.anglo, {});
    const sample = (order, degree, subdivisions, houses = true) => {
      const composition = {...factory, rings: order.map(id => ({...factory.rings.find(ring => ring.archetypeId === id),
        enabled: id === 'degree' ? degree : ['terms', 'decans'].includes(id) ? subdivisions
          : id === 'houses' ? houses : true}))};
      const input = {...geometry(composition, maxRadius), showTerms: subdivisions, showDecans: subdivisions,
        showHouses: houses};
      const rings = api.wheel.resolveWheelRingSet(style, input);
      return {input, rings, bands: api.layout.resolveWheelBandLayout(style, input, rings).bands};
    };
    const accepted = sample(original, false, false);
    const saved = JSON.stringify(style);
    for (const [order, degree, subdivisions, houses] of [[original, true, true, true],
      [outside, true, true, true], [outside, true, false, true], [outside, false, false, true],
      [outside, false, true, true], [original, false, false, false], [original, false, false, true]]) {
      const current = sample(order, degree, subdivisions, houses);
      for (const id of ['zodiac', 'cuspRuler', 'cuspLabels', 'bodies'])
        near(thickness(bandFor(current, id)), thickness(bandFor(accepted, id)),
          `${maxRadius}/${degree}/${subdivisions}/${houses}/${id}: factory dimensions do not follow temporary density`);
      assert.ok(!bandFor(current, 'cuspRuler').overlay, 'factory subdivision slots remain authored separators');
      if (!houses) {
        const hidden = current.bands.find(band => band.id === 'houses');
        assert.ok(!hidden?.visible);
        if (hidden) near(thickness(hidden), 0, 'hidden Houses consume no allocation');
      }
      const extra = current.bands.filter(band => band.visible && ['terms', 'decans'].includes(band.id))
        .reduce((sum, band) => sum + thickness(band), 0);
      near(bandFor(current, 'hub').outer, bandFor(accepted, 'hub').outer - extra
        + (houses ? 0 : thickness(bandFor(accepted, 'houses'))), 'only hub owns the change in allocated depth');
      assert.deepEqual(api.wheel.resolveWheelRingSet(JSON.parse(saved), current.input), current.rings);
    }
    assert.equal(JSON.stringify(style), saved, 'factory preferences never become stored overrides');
  }
});

test('pristine native factories preserve their accepted recipe source', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const mode of ['single', 'comparison']) for (const maxRadius of [180, 400, 733.5]) {
    const composition = structuredClone(api.composition.WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    const native = api.wheel.projectWheelAuthoringStyle(api.preset.resolveWheelGeometryPresetStyle(() => '',
      {revision: 'native-factory-default'}, {profile, presets: {[profile]: {id: `factory.${profile}`, revision: 1, overrides: {}}}}),
    maxRadius, profile);
    const historical = {...native, authoringOverrides: {...native.authoringOverrides, recipeRadii: undefined}};
    const enabled = id => composition.rings.find(ring => ring.archetypeId === id)?.enabled ?? false;
    const input = {...geometry(composition, maxRadius), profile, mode,
      showTerms: profile === 'anglo' || enabled('terms'), showDecans: profile === 'anglo' || enabled('decans'), showHouses: enabled('houses'),
      comparisonWithOuterHouses: mode === 'comparison', showOuterHouses: mode === 'comparison'};
    if (profile === 'anglo') composition.rings = composition.rings.map(ring => ({...ring,
      enabled: ['terms', 'decans'].includes(ring.archetypeId) ? true : ring.enabled}));
    assert.deepEqual(api.wheel.resolveWheelRingSet(native, input), api.wheel.resolveWheelRingSet(historical, input),
      `${profile}/${mode}/${maxRadius}: pristine production factory retains all numeric anchors exactly`);
  }
});

test('normalized legacy radius tokens carry inherited dimensions without becoming live pins again', () => {
  const normalized = Object.fromEntries(Object.entries(design.overrides).map(([id, value]) => {
    const classId = /^authoring\.wheel\.anglo\.(rings\..+)\.radius$/.exec(id)?.[1];
    const role = classId ? api.adapter.wheelRingRoleForClass(classId) : undefined;
    return role ? [`renderer.wheel.metric.${api.wheel.wheelRingRadiusTokenKey('anglo', role)}`, value / 400]
      : [id, value];
  }));
  const style = styleFor(normalized);
  const accepted = solve(style, withOrder(originalOrder));
  for (const order of [shownOrder,
    ['outerHouses', 'outerBodies', 'zodiac', 'terms', 'cuspRuler', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'],
    ['outerHouses', 'outerBodies', 'cuspRuler', 'degree', 'zodiac', 'terms', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub']]) {
    const result = solve(style, withOrder(order));
    for (const id of ['zodiac', 'terms', 'decans', 'bodies', 'houses']) {
      near(thickness(bandFor(result, id)), thickness(bandFor(accepted, id)), `${order.join(',')}/${id}`);
    }
  }
});

test('the first radius edit from the live old-radius recipe is continuous at every pane size', () => {
  for (const maxRadius of [180, 400, 733.5]) {
    for (const role of ['zodiacOuterRing', 'zodiacInnerRing', 'termRing', 'innerBoundaryRing', 'houseBoundaryRing', 'baseRing']) {
      const production = harness();
      const composition = withOrder(shownOrder);
      production.store.getState().acceptWheelPresets(selectedState(composition), 'anglo');
      const beforeStyle = styleFor(production.store.getState().geometryOverrides, maxRadius, production);
      const before = solve(beforeStyle, composition, maxRadius, production);
      const rendered = production.wheel.resolveWheelPaintedRingRadius(beforeStyle, geometry(composition, maxRadius), role);
      const semanticId = `authoring.wheel.anglo.${classForRole(role)}.radius`;
      const epsilon = 0.001;
      production.store.getState().beginGesture('numeric');
      production.store.getState().setOverride(semanticId, rendered * 400 / maxRadius + epsilon);
      production.store.getState().endGesture('numeric');
      const authored = production.store.getState().geometryOverrides;
      const afterStyle = styleFor(authored, maxRadius, production);
      const after = solve(afterStyle, composition, maxRadius, production);
      for (const [field, value] of Object.entries(before.rings)) {
        if (typeof value !== 'number') continue;
        assert.ok(Math.abs(after.rings[field] - value) <= epsilon * maxRadius / 400 * 20,
          `${maxRadius}/${role}/${field}: first epsilon edit jumped ${after.rings[field] - value}px`);
      }
      assert.deepEqual(solve(styleFor(JSON.parse(JSON.stringify(authored)), maxRadius, production), composition,
        maxRadius, production).rings, after.rings, 'release/reload retains sparse explicit intent');
      production.store.getState().undo();
      assert.deepEqual(production.store.getState().geometryOverrides, design.overrides,
        'undo restores the untouched inherited representation');
      production.store.getState().redo();
      assert.deepEqual(production.store.getState().geometryOverrides, authored);
    }
  }
});

test('inherited and normalized recipes expose identity pins inside their own reference ranges', () => {
  for (const maxRadius of [180, 400, 733.5]) {
    for (const role of ['zodiacOuterRing', 'zodiacInnerRing', 'termRing', 'innerBoundaryRing', 'houseBoundaryRing', 'baseRing']) {
      const production = harness();
      const composition = withOrder(shownOrder);
      production.store.getState().acceptWheelPresets(selectedState(composition), 'anglo');
      const beforeStyle = styleFor(design.overrides, maxRadius, production);
      const before = solve(beforeStyle, composition, maxRadius, production);
      const input = geometry(composition, maxRadius);
      const rendered = production.wheel.resolveWheelPaintedRingRadius(beforeStyle, input, role);
      const reference = rendered * 400 / maxRadius;
      const range = production.wheel.resolveWheelPaintedRingReferenceRange(beforeStyle, input, role);
      assert.ok(range && reference >= range.min - 1e-7 && reference <= range.max + 1e-7,
        `${maxRadius}/${role}: displayed reference radius ${reference} lies outside ${JSON.stringify(range)}`);
      production.store.getState().setOverride(`authoring.wheel.anglo.${classForRole(role)}.radius`, reference);
      const authored = production.store.getState().geometryOverrides;
      const normalizedStyle = styleFor(authored, maxRadius, production);
      const after = solve(normalizedStyle, composition, maxRadius, production);
      assert.deepEqual(Object.keys(after.rings), Object.keys(before.rings));
      for (const [field, value] of Object.entries(before.rings)) {
        if (typeof value === 'number') near(after.rings[field], value, `${maxRadius}/${role}/${field}/identity pin`, 1e-9);
        else assert.equal(after.rings[field], value);
      }
      const again = solve(styleFor(JSON.parse(JSON.stringify(authored)), maxRadius, production), composition,
        maxRadius, production);
      assert.deepEqual(again.rings, after.rings, 'normalization and JSON reload are idempotent');
    }
  }
});

test('returning the first radius gesture to its origin restores the complete sparse legacy bag', () => {
  const production = harness();
  const composition = withOrder(shownOrder);
  production.store.getState().acceptWheelPresets(selectedState(composition), 'anglo');
  const original = structuredClone(production.store.getState().geometryOverrides);
  const id = 'authoring.wheel.anglo.rings.zodiacOuter.radius';
  production.store.getState().beginGesture('canvas');
  production.store.getState().setOverride(id, original[id] + 1);
  production.store.getState().restoreGestureProperty(id, 'canvas');
  production.store.getState().endGesture('canvas');
  assert.deepEqual(production.store.getState().geometryOverrides, original,
    'conversion-only recipe metadata cannot survive a returned-to-origin gesture');
  assert.equal(production.store.getState().undoStack.length, 0);
});

test('an explicit radius equal to its recipe remains live after another boundary takes priority', () => {
  const inherited = design.overrides['authoring.wheel.anglo.rings.innerBoundary.radius'];
  const overrides = {...design.overrides,
    'authoring.wheel.anglo.canvas.chart.recipeVersion': 1,
    'authoring.wheel.anglo.rings.innerBoundary.recipeRadius': inherited,
    'authoring.wheel.anglo.rings.innerBoundary.radiusAuthored': true,
    'authoring.wheel.anglo.canvas.chart.radiusPriority': 'zodiacOuterRing',
  };
  const style = styleFor(overrides);
  assert.equal(style.authoringOverrides.ringRadii.anglo?.innerBoundaryRing, inherited,
    'explicit authorship is independent of numeric equality and last priority');
});

test('priority-only saved drafts retain their previously explicit boundary during inherited decoding', () => {
  const requested = 310;
  const style = styleFor({...design.overrides,
    'authoring.wheel.anglo.rings.innerBoundary.radius': requested,
    'authoring.wheel.anglo.canvas.chart.radiusPriority': 'innerBoundaryRing',
  });
  assert.equal(style.authoringOverrides.ringRadii.anglo?.innerBoundaryRing, requested);
  assert.deepEqual(Object.keys(style.authoringOverrides.ringRadii.anglo ?? {}), ['innerBoundaryRing'],
    'other inherited recipe radii do not reappear as live pins');
});

test('normalizing a priority-only draft preserves its previous live edit when another role is edited', () => {
  const production = harness();
  const composition = withOrder(shownOrder);
  const previous = {...design.overrides,
    'authoring.wheel.anglo.rings.innerBoundary.radius': 310,
    'authoring.wheel.anglo.canvas.chart.radiusPriority': 'innerBoundaryRing',
  };
  production.store.getState().acceptWheelPresets(selectedState(composition, previous), 'anglo');
  production.store.getState().setOverride('authoring.wheel.anglo.rings.zodiacOuter.radius', 380);
  const normalized = styleFor(production.store.getState().geometryOverrides, 400, production);
  assert.equal(normalized.authoringOverrides.ringRadii.anglo?.innerBoundaryRing, 310);
  assert.equal(normalized.authoringOverrides.ringRadii.anglo?.zodiacOuterRing, 380);
  assert.deepEqual(Object.keys(normalized.authoringOverrides.ringRadii.anglo).sort(),
    ['innerBoundaryRing', 'zodiacOuterRing']);
});

test('resetting a new radius exposes the remembered inherited design without discarding its basis', () => {
  const production = harness();
  const composition = withOrder(shownOrder);
  production.store.getState().acceptWheelPresets(selectedState(composition), 'anglo');
  const before = solve(styleFor(design.overrides, 400, production), composition, 400, production);
  const id = 'authoring.wheel.anglo.rings.zodiacOuter.radius';
  production.store.getState().setOverride(id, 380);
  production.store.getState().resetProperty(id);
  const reset = production.store.getState().geometryOverrides;
  assert.notEqual(reset[id.replace('.radius', '.radiusAuthored')], true);
  const result = solve(styleFor(reset, 400, production), composition, 400, production);
  assert.deepEqual(result.rings, before.rings, 'reset retains all inherited preferred dimensions');
});

test('an empty factory basis stays empty when its first explicit radius is authored and restored', () => {
  const production = harness();
  const composition = withOrder(shownOrder);
  production.store.getState().acceptWheelPresets(selectedState(composition, {}), 'anglo');
  const beforeStyle = styleFor({}, 400, production);
  const before = solve(beforeStyle, composition, 400, production);
  const value = production.wheel.resolveWheelPaintedRingRadius(beforeStyle, geometry(composition), 'innerBoundaryRing');
  const id = 'authoring.wheel.anglo.rings.innerBoundary.radius';
  production.store.getState().beginGesture('canvas');
  production.store.getState().setOverride(id, value + 0.001);
  const editedStyle = styleFor(production.store.getState().geometryOverrides, 400, production);
  assert.deepEqual(editedStyle.authoringOverrides.recipeRadii.anglo, {},
    'new live input is never mistaken for an inherited factory basis');
  const edited = solve(editedStyle, composition, 400, production);
  for (const [field, initial] of Object.entries(before.rings)) if (typeof initial === 'number') {
    assert.ok(Math.abs(edited.rings[field] - initial) <= 0.02, `${field}: empty basis first edit jumped`);
  }
  production.store.getState().restoreGestureProperty(id, 'canvas');
  production.store.getState().endGesture('canvas');
  assert.deepEqual(production.store.getState().geometryOverrides, {});
  assert.equal(production.store.getState().undoStack.length, 0);
});

test('Traditional Morinus retains the house allocation when H hides houses', () => {
  const factory = api.composition.WHEEL_FACTORY_SETTINGS.layouts.compact.composition;
  for (const presentation of ['traditional-morinus', undefined]) {
    const style = {...api.wheel.DEFAULT_WHEEL_RENDER_STYLE, presentation,
      authoringOverrides: {...api.wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        recipeRadii: {compact: {}}}};
    for (const reordered of [false, true]) {
      const ordered = [...factory.rings];
      if (reordered) {
        const index = ordered.findIndex(ring => ring.archetypeId === 'degree');
        ordered.unshift(...ordered.splice(index, 1));
      }
      const input = {profile: 'compact', mode: 'single', maxRadius: 400,
        showTerms: true, showDecans: true, showHouses: true, showPositions: true,
        hasOuterRing: false, comparisonWithOuterHouses: false,
        composition: {...factory, rings: ordered.map(ring => ({...ring, enabled: true}))}};
      const shown = api.wheel.resolveWheelRingSet(style, input);
      const hiddenInput = {...input, showHouses: false,
        composition: {...input.composition, rings: input.composition.rings.map(ring =>
          ({...ring, enabled: ring.archetypeId !== 'houses'}))}};
      const hidden = api.wheel.resolveWheelRingSet(style, hiddenInput);
      if (presentation) near(hidden.rBase, shown.rBase, `Morinus/${reordered}/center`);
      else assert.ok(hidden.rBase > shown.rBase, `other compact/${reordered} still expands`);
      const house = api.layout.resolveWheelBandLayout(style, hiddenInput, hidden).bands.find(band => band.id === 'houses');
      assert.ok(!house || !house.visible, 'houses remain hidden');
    }
  }
});
