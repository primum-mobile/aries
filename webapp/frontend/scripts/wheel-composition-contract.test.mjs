// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compositionModuleUrl } from './wheel-composition-test-loader.mjs';
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`);
const layoutUrl = url(await transpile('../src/lib/chart/wheel-layout-model.ts'));
const wheel = await import(url((await transpile('../src/lib/chart/wheel-render-style.ts'))
  .replaceAll('"./wheel-layout-model"', `"${layoutUrl}"`)));
const {composedWheelLayout, resolveWheelBandLayout, wheelOuterAttachmentRadius, wheelDegreeTickEnds,
  wheelCuspRulerTickEnds, resolveWheelBandFillRegions, wheelBandMinimumWidth} = await import(layoutUrl);
const {compatibleRingOrder, moveWheelRing, WHEEL_FACTORY_SETTINGS, WHEEL_RING_ARCHETYPES} = await import(compositionModuleUrl);
const recipe = (profile, ids) => ({schemaVersion: 1, customized: true,
  projection: profile === 'houses' ? 'houses' : 'zodiac',
  rings: ids.map(archetypeId => ({instanceId: `${profile}-${archetypeId}`, archetypeId,
    enabled: true, chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary'})),
});
const input = composition => ({profile: 'cusps', mode: 'single', maxRadius: 400,
  showTerms: false, showDecans: false, showHouses: true, showPositions: true,
  comparisonWithOuterHouses: false, hasOuterRing: false, composition});
const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
  ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
  ringWidths: {cusps: {'cusps-terms': 25, 'cusps-decans': 22}},
}};
function solve(composition) {
  return composedWheelLayout(wheel.resolveWheelRingSet(style, input(composition)));
}

const factoryComposition = profile => structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
const withDegreeRuler = composition => ({...composition, rings: composition.rings.map(ring =>
  ring.archetypeId === 'degree' ? {...ring, enabled: true} : ring)});
const arrangementGeometry = (profile, composition, arrangement, maxRadius = 400) => ({
  ...input(composition), profile, maxRadius,
  mode: ['transit', 'synastry'].includes(arrangement) ? 'comparison' : 'single',
  hasOuterRing: arrangement !== 'single',
  restrainedAngloComparison: arrangement === 'synastry',
});

const factoryGeometry = (profile, arrangement) => ({
  ...arrangementGeometry(profile, factoryComposition(profile), arrangement),
  showOuterHouses: arrangement !== 'single',
  comparisonWithOuterHouses: arrangement !== 'single' && ['classic', 'compact'].includes(profile),
});
const withBandWidth = (profile, instanceId, width) => ({
  ...wheel.DEFAULT_WHEEL_RENDER_STYLE,
  authoringOverrides: {...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
    ringWidths: {[profile]: {[instanceId]: width}}},
});
const thickness = band => band.outer - band.inner;

test('Anglo ruler combinations preserve neighboring widths and reclaim unoccupied space', () => {
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
    for (const subdivisions of [false, true]) for (const reordered of [false, true]) {
      const original = factoryComposition('anglo');
      if (reordered) [original.rings[0], original.rings[1]] = [original.rings[1], original.rings[0]];
      original.rings = original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
        ? {...ring, enabled: subdivisions} : ring);
      const sample = (degree, cuspRuler, cuspLabels, remove = false) => {
        const flags = {degree, cuspRuler, cuspLabels};
        const composition = {...original, rings: original.rings.map(ring => ring.archetypeId in flags
          ? {...ring, enabled: flags[ring.archetypeId]} : ring)};
        if (remove) composition.rings = composition.rings.filter(ring => !(ring.archetypeId in flags) || ring.enabled);
        const geometry = {...factoryGeometry('anglo', arrangement), composition,
          showTerms: subdivisions, showDecans: subdivisions};
        const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
        return {rings, bands: resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands};
      };
      const baseline = sample(true, true, true);
      for (const degree of [false, true]) for (const cuspRuler of [false, true])
      for (const cuspLabels of [false, true]) for (const remove of [false, true]) {
        const current = sample(degree, cuspRuler, cuspLabels, remove);
        const context = `${arrangement}/${subdivisions}/${reordered}/${degree}/${cuspRuler}/${cuspLabels}/${remove}`;
        for (const band of current.bands) {
          if (['margin', 'hub', 'degree', 'cuspRuler', 'cuspLabels'].includes(band.id)) continue;
          const before = baseline.bands.find(item => item.id === band.id);
          assert.ok(Math.abs(thickness(band) - thickness(before)) < 1e-8,
            `${context}: ${band.id} cannot resize when an instrument is toggled`);
        }
        const occupied = bands => bands.filter(band => !band.overlay && band.visible
          && ['degree', 'cuspRuler', 'cuspLabels'].includes(band.id))
          .reduce((sum, band) => sum + thickness(band), 0);
        for (const key of reordered ? [] : ['rPlanet', 'rHouse', 'rAsp']) {
          const expected = baseline.rings[key] + occupied(baseline.bands) - occupied(current.bands);
          assert.ok(Math.abs(current.rings[key] - expected) < 1e-8, `${context}: ${key} reclaims only unoccupied bands`);
        }
      }
    }
  }
});

test('the first original-band width edit preserves existing geometry and changes continuously', () => {
  const epsilon = 1e-5;
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const geometry = factoryGeometry(profile, arrangement);
      const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const originalBands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, original).bands;
      for (const instance of geometry.composition.rings) {
        const band = originalBands.find(item => item.id === instance.archetypeId);
        if (!instance.enabled || instance.archetypeId === 'hub' || !band?.visible || thickness(band) <= 0) continue;
        const context = `${profile}/${arrangement}/${instance.archetypeId}`;
        const exactStyle = withBandWidth(profile, instance.instanceId, thickness(band));
        assert.deepEqual(wheel.resolveWheelRingSet(exactStyle, geometry), original,
          `${context}: storing the existing width must not reinterpret the original geometry`);
        const nearby = wheel.resolveWheelRingSet(withBandWidth(profile, instance.instanceId, thickness(band) + epsilon), geometry);
        for (const [field, value] of Object.entries(original)) {
          if (typeof value !== 'number') continue;
          assert.ok(typeof nearby[field] === 'number' && Math.abs(nearby[field] - value) < epsilon * 20,
            `${context}: ${field} jumped from ${value} to ${nearby[field]} on a ${epsilon}px edit`);
        }
      }
    }
  }
});

test('original width expansion consumes hub space then clamps without shrinking other bands', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const geometry = factoryGeometry(profile, arrangement);
      const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const originalBands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, original).bands;
      const kind = profile === 'anglo' ? 'cuspRuler' : ['houses', 'cusps'].includes(profile) ? 'cuspLabels' : 'bodies';
      const instance = geometry.composition.rings.find(ring => ring.archetypeId === kind);
      const edited = originalBands.find(band => band.id === kind);
      const hub = originalBands.find(band => band.id === 'hub');
      const minHub = Math.min(thickness(hub), WHEEL_RING_ARCHETYPES.hub.minWidth);
      const spare = thickness(hub) - minHub;
      assert.ok(spare > 10, 'factory fixture must exercise real spare hub space');
      for (const requestedDelta of [10, spare + 50]) {
        const expectedDelta = Math.min(requestedDelta, spare);
        const editedStyle = withBandWidth(profile, instance.instanceId, thickness(edited) + requestedDelta);
        const rings = wheel.resolveWheelRingSet(editedStyle, geometry);
        const bands = resolveWheelBandLayout(editedStyle, geometry, rings).bands;
        const context = `${profile}/${arrangement}/${kind}/+${requestedDelta}`;
        assert.ok(Math.abs(thickness(bands.find(band => band.id === kind)) - thickness(edited) - expectedDelta) < 1e-8,
          `${context}: edited width should use available space exactly`);
        assert.ok(Math.abs(thickness(bands.find(band => band.id === 'hub')) - thickness(hub) + expectedDelta) < 1e-8,
          `${context}: the hub supplies the width budget`);
        for (const other of originalBands) {
          if (other.id === kind || other.id === 'hub' || !other.visible || thickness(other) <= 0) continue;
          const next = bands.find(band => band.id === other.id);
          assert.ok(next && Math.abs(thickness(next) - thickness(other)) < 1e-8,
            `${context}: untouched ${other.id} must retain its width`);
        }
      }
    }
  }
});

test('custom Cusp subdivision widths use hub space without squeezing neighbors or the transit track', () => {
  for (const subdivisions of [['terms', 'decans'], ['decans', 'terms']]) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const composition = recipe('cusps', ['outerHouses', 'outerBodies', ...subdivisions,
        'cuspLabels', 'bodies', 'houses', 'hub']);
      const geometry = {...factoryGeometry('cusps', arrangement), composition,
        showTerms: true, showDecans: true};
      const baseline = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const baselineBands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, baseline).bands;
      const hub = baselineBands.find(band => band.id === 'hub');
      const spare = thickness(hub) - Math.min(thickness(hub), WHEEL_RING_ARCHETYPES.hub.minWidth);
      assert.ok(spare > 10, 'custom fixture must have enough room to distinguish direct growth from clamping');
      for (const kind of subdivisions) {
        const instance = composition.rings.find(ring => ring.archetypeId === kind);
        const band = baselineBands.find(item => item.id === kind);
        for (const request of [thickness(band) + 10, thickness(band) + spare + 50]) {
          const style = withBandWidth('cusps', instance.instanceId, request);
          const rings = wheel.resolveWheelRingSet(style, geometry);
          const bands = resolveWheelBandLayout(style, geometry, rings).bands;
          const growth = Math.min(request - thickness(band), spare);
          const context = `${subdivisions.join('/')}/${arrangement}/${kind}/${request}`;
          assert.ok(Math.abs(thickness(bands.find(item => item.id === kind)) - thickness(band) - growth) < 1e-8,
            `${context}: resize is direct until the available width limit`);
          assert.ok(Math.abs(thickness(bands.find(item => item.id === 'hub')) - thickness(hub) + growth) < 1e-8,
            `${context}: only the hub gives up radial space`);
          for (const other of baselineBands) {
            if (other.id === kind || other.id === 'hub') continue;
            const next = bands.find(item => item.id === other.id);
            assert.ok(next && Math.abs(thickness(next) - thickness(other)) < 1e-8,
              `${context}: ${other.id} retains its width`);
          }
          if (arrangement === 'transit') {
            for (const key of ['rOuterPlanet', 'rOuterRetr', 'rOuterLine', 'rOuterASCMC', 'rOuterHouseName']) {
              assert.equal(rings[key], baseline[key], `${context}: external transit anchor ${key} stays fixed`);
            }
          }
        }
      }
    }
  }
});

test('open transit role widths move only their own anchors and retain the primary rim', () => {
  const anchors = {
    outerBodies: ['rOuterPlanet', 'rOuterRetr', 'rOuterLine', 'rAntis', 'rAntisLines'],
    outerHouses: ['rOuterASCMC', 'rOuterArrow', 'rOuterHouseName'],
  };
  for (const profile of ['anglo', 'houses', 'cusps']) for (const customized of [false, true]) {
    const composition = factoryComposition(profile);
    if (customized) {
      [composition.rings[0], composition.rings[1]] = [composition.rings[1], composition.rings[0]];
      composition.customized = true;
    }
    const geometry = {...factoryGeometry(profile, 'transit'), composition};
    const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const originalBands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, original).bands;
    for (const kind of ['outerBodies', 'outerHouses']) {
      const band = originalBands.find(item => item.id === kind);
      const instance = composition.rings.find(ring => ring.archetypeId === kind);
      const context = `${profile}/${customized ? 'custom' : 'original'}/${kind}`;
      assert.ok(band?.visible && band.overlay, `${context}: the external role has an authorable lane`);
      const requested = thickness(band) - 5;
      assert.ok(requested >= (band.widthBounds?.min ?? WHEEL_RING_ARCHETYPES[kind].minWidth));
      const exactStyle = withBandWidth(profile, instance.instanceId, thickness(band));
      assert.deepEqual(wheel.resolveWheelRingSet(exactStyle, geometry), original,
        `${context}: the current width preserves all anchors`);
      const editedStyle = withBandWidth(profile, instance.instanceId, requested);
      const edited = wheel.resolveWheelRingSet(editedStyle, geometry);
      const editedBand = resolveWheelBandLayout(editedStyle, geometry, edited).bands.find(item => item.id === kind);
      assert.equal(editedBand.inner, original.r30, `${context}: the primary rim anchors the lane`);
      assert.ok(Math.abs(thickness(editedBand) - requested) < 1e-8, `${context}: width changes the resolved lane`);
      assert.notEqual(edited[anchors[kind][0]], original[anchors[kind][0]], `${context}: its visible anchor must move`);
      for (const [field, value] of Object.entries(original)) {
        if (anchors[kind].includes(field)) continue;
        assert.equal(edited[field], value, `${context}: unrelated anchor ${field} stays fixed`);
      }
    }
  }
});

test('factory compositions preserve their dimensions when the Anglo Degree ruler is enabled', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
      for (const maxRadius of [200, 400, 600]) {
        const composition = factoryComposition(profile);
        const geometry = arrangementGeometry(profile,
          profile === 'anglo' ? withDegreeRuler(composition) : composition, arrangement, maxRadius);
        const actual = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
        const factory = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, {...geometry, composition: undefined});
        const where = `${profile}/${arrangement}/${maxRadius}`;
        if (profile === 'anglo') {
          const degreeFields = new Set(['rOuter0', 'rOuter1', 'rOuter5', 'rOuter10']);
          assert.deepEqual(Object.fromEntries(Object.entries(actual).filter(([key]) => !degreeFields.has(key))),
            Object.fromEntries(Object.entries(factory).filter(([key]) => !degreeFields.has(key))),
            `${where} must retain every non-degree factory radius`);
          assert.equal(actual.rOuter10, actual.r0, `${where} ruler rests on the inner sign edge`);
          assert.ok(actual.rOuter0 > actual.r0 && actual.rOuter0 < actual.r30,
            `${where} outward ticks stay within Signs`);
        } else assert.deepEqual(actual, factory, `${where} must retain the original radii`);
      }
    }
  }
});

test('moving Degree above Signs reverses its attachment in every arrangement', () => {
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
    const original = withDegreeRuler(factoryComposition('anglo'));
    const moved = structuredClone(original);
    const index = moved.rings.findIndex(ring => ring.archetypeId === 'degree');
    [moved.rings[index], moved.rings[index - 1]] = [moved.rings[index - 1], moved.rings[index]];
    for (const [composition, above] of [[original, false], [moved, true]]) {
      const geometry = arrangementGeometry('anglo', composition, arrangement);
      const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const bands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands;
      const degree = bands.find(band => band.id === 'degree' && band.visible);
      const signs = bands.find(band => band.id === 'zodiac' && band.visible);
      const {base, tip} = wheelDegreeTickEnds(composition, degree.outer, degree.inner);
      const where = `${arrangement}/${above ? 'above' : 'below'}`;
      assert.ok(above ? base > tip : base < tip, `${where}: tick direction follows order`);
      assert.ok(above ? Math.abs(base - signs.outer) < 1e-8
        : Math.abs(base - signs.inner) < 1e-8,
      `${where}: Degree attaches to the adjoining sign edge`);
    }
  }
});

test('factory Anglo cusp ruler and cusp labels can be hidden, removed, and restored independently', () => {
  for (const kind of ['cuspRuler', 'cuspLabels']) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const original = factoryComposition('anglo');
      const hidden = {...original, rings: original.rings.map(ring =>
        ring.archetypeId === kind ? {...ring, enabled: false} : ring)};
      const removed = {...original, customized: true,
        rings: original.rings.filter(ring => ring.archetypeId !== kind)};
      const initialGeometry = arrangementGeometry('anglo', original, arrangement);
      const initialRings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, initialGeometry);
      assert.equal(hidden.customized, false, 'a visibility preference does not alter the saved design');
      for (const composition of [hidden, removed]) {
        const geometry = arrangementGeometry('anglo', composition, arrangement);
        const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
        const bands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands;
        assert.ok(!bands.some(band => band.id === kind && band.visible && band.outer > band.inner),
          `${kind}/${arrangement} must leave no allocated paint or selection band`);
        const other = bands.find(band => band.id === (kind === 'cuspRuler' ? 'cuspLabels' : 'cuspRuler'));
        assert.ok(other?.visible && other.outer > other.inner, 'the neighboring cusp band remains available');
        if (arrangement === 'transit') {
          assert.equal(rings.rOuterPlanet, initialRings.rOuterPlanet, 'hiding a primary band cannot move the transit track');
          assert.equal(rings.rOuterLine, initialRings.rOuterLine);
        }
      }
      assert.deepEqual(wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, initialGeometry), initialRings);
    }
  }
});

test('cusp band widths survive toggle and remove/re-add with the same stable instance', () => {
  for (const [profile, kind] of [['anglo', 'cuspRuler'], ['cusps', 'cuspRuler'],
    ['anglo', 'cuspLabels'], ['houses', 'cuspLabels'], ['cusps', 'cuspLabels']]) {
    for (const arrangement of ['single', 'transit', 'synastry']) {
      const original = factoryComposition(profile);
      const composition = {...original, rings: original.rings.map(ring =>
        ring.archetypeId === kind ? {...ring, enabled: true} : ring)};
      const instance = composition.rings.find(ring => ring.archetypeId === kind);
      const requestedWidth = kind === 'cuspRuler' ? 18 : 44;
      const authored = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
        ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringWidths: {[profile]: {[instance.instanceId]: requestedWidth}},
      }};
      const geometry = arrangementGeometry(profile, composition, arrangement, 600);
      const initial = wheel.resolveWheelRingSet(authored, geometry);
      const band = resolveWheelBandLayout(authored, geometry, initial).bands.find(item => item.id === kind);
      assert.ok(band?.visible && band.outer > band.inner,
        `${profile}/${kind}/${arrangement}: an enabled instrument must allocate a visible band`);
      const widerStyle = {...authored, authoringOverrides: {...authored.authoringOverrides,
        ringWidths: {[profile]: {[instance.instanceId]: requestedWidth + 12}},
      }};
      const wider = resolveWheelBandLayout(widerStyle, geometry, wheel.resolveWheelRingSet(widerStyle, geometry)).bands.find(item => item.id === kind);
      assert.ok(wider.outer - wider.inner > band.outer - band.inner,
        `${profile}/${kind}/${arrangement} must honor its own width input`);
      for (const changed of [
        {...composition, rings: composition.rings.map(ring => ring === instance ? {...ring, enabled: false} : ring)},
        {...composition, customized: true, rings: composition.rings.filter(ring => ring !== instance)},
      ]) {
        const hidden = wheel.resolveWheelRingSet(authored, {...geometry, composition: changed});
        assert.ok(!resolveWheelBandLayout(authored, {...geometry, composition: changed}, hidden).bands.some(item => item.id === kind && item.visible && thickness(item) > 0),
          `${profile}/${kind}/${arrangement} must not reserve disabled width`);
        assert.deepEqual(wheel.resolveWheelRingSet(authored, geometry), initial,
          'restoring the same instance restores its width and neighboring anchors');
      }
    }
  }
});

// Exercise the daemon's effective factory recipe, including theme visibility.
// Previously only customized:true recipes were tested with Cusp subdivisions.
const cuspRecipes = JSON.parse(execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', `
import json
from types import SimpleNamespace
from webapp.daemon.wheel_composition import effective_composition, builtin_composition
result = []
for terms in (False, True):
    for decans in (False, True):
        opts = SimpleNamespace(wheel_presets_active=True, showterms=terms,
            showdecans=decans, houses=True,
            wheel_compositions={'cusps': builtin_composition('cusps')})
        result.append(effective_composition(opts, 'cusps'))
print(json.dumps(result))
`], {cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8'}));

test('factory Cusp visibility allocates separate subdivision bands in every arrangement', () => {
  for (const composition of cuspRecipes) {
    const enabled = kind => composition.rings.some(r => r.archetypeId === kind && r.enabled);
    const before = JSON.stringify(composition);
    for (const maxRadius of [200, 400, 600]) {
      for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
        const geometry = {...input(composition), maxRadius,
          showTerms: enabled('terms'), showDecans: enabled('decans'),
          mode: ['transit', 'synastry'].includes(arrangement) ? 'comparison' : 'single',
          hasOuterRing: arrangement !== 'single',
          restrainedAngloComparison: arrangement === 'synastry',
        };
        const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
        const layout = composedWheelLayout(rings);
        if (!enabled('terms') && !enabled('decans')) {
          assert.equal(layout, undefined, 'original Cusp layout stays on its preserved geometry');
          continue;
        }
        assert.ok(layout, 'visible Cusp subdivisions require allocated bands');
        const stack = layout.bands.filter(b => !b.overlay);
        for (let i = 1; i < stack.length; i++) {
          assert.equal(stack[i].outer, stack[i-1].inner);
          assert.ok(stack[i].outer > stack[i].inner, `${stack[i].id} has space`);
        }
        for (const [kind, anchor] of [['terms', 'rTermsPlanet'], ['decans', 'rDecansPlanet']]) {
          const band = layout.bands.find(b => b.id === kind);
          assert.equal(Boolean(band), enabled(kind));
          if (band) assert.ok(rings[anchor] > band.inner && rings[anchor] < band.outer);
        }
        const labels = layout.bands.find(b => b.id === 'cuspLabels');
        assert.ok(rings.rCuspLabel > labels.inner && rings.rCuspLabel < labels.outer);
        if (arrangement === 'transit') {
          const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE,
            {...geometry, composition: undefined});
          assert.equal(rings.rOuterPlanet, original.rOuterPlanet);
          assert.equal(rings.rOuterLine, original.rOuterLine);
          assert.ok(layout.bands.find(b => b.id === 'outerBodies').overlay);
        }
      }
    }
    assert.equal(JSON.stringify(composition), before, 'visibility must not mark a factory preset modified');
    assert.equal(composition.customized, false);
  }
});

test('zodiac subdivisions reorder with stable widths and exact shared boundaries', () => {
  const composition = recipe('cusps', ['terms','decans','cuspLabels','bodies','houses','hub']);
  const first = solve(composition);
  const moved = {...composition, rings: [...composition.rings]};
  [moved.rings[0], moved.rings[1]] = [moved.rings[1], moved.rings[0]];
  const second = solve(moved);
  for (const layout of [first,second]) {
    for (let i = 1; i < layout.bands.length; i++) {
      const band = layout.bands[i];
      assert.equal(band.outer, layout.bands[i - 1].inner);
      assert.ok(band.outer >= band.inner);
    }
    assert.equal(layout.rings.rTermsPlanet, (layout.rings.rTerms + layout.rings.rTermsInner) / 2);
    assert.equal(layout.rings.rDecansPlanet, (layout.rings.rDecans + layout.rings.rDecansInner) / 2);
    const labels = layout.bands.find(b => b.id === 'cuspLabels');
    assert.equal(layout.rings.rCuspLabel, (labels.outer + labels.inner) / 2);
  }
  for (const id of ['terms','decans','bodies','houses']) {
    const a = first.bands.find(b=>b.id===id), b = second.bands.find(b=>b.id===id);
    assert.equal(a.instanceId, b.instanceId);
    assert.ok(Math.abs((a.outer-a.inner)-(b.outer-b.inner))<1e-9);
  }
});

test('disabled bands consume zero depth and restore their preferred width', () => {
  const composition = recipe('cusps', ['terms','decans','cuspLabels','bodies','houses','hub']);
  const enabled = solve(composition);
  const disabled = solve({...composition, rings: composition.rings.map(r=>r.archetypeId==='terms'?{...r,enabled:false}:r)});
  assert.ok(!disabled.bands.some(b=>b.id==='terms'));
  const delta = disabled.bands.find(b=>b.id==='decans').outer - enabled.bands.find(b=>b.id==='decans').outer;
  assert.equal(delta, 25);
  assert.deepEqual(solve(composition), enabled);
});

test('conflicting Anglo diameters release hidden subdivisions without violating visible band minimums', () => {
  const profile = 'anglo';
  const authored = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
    ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
    ringRadii: {anglo: {zodiacOuterRing: 379.1, zodiacInnerRing: 348.1,
      termRing: 335.1, cuspOuterRing: 321.4, innerBoundaryRing: 299.1,
      houseBoundaryRing: 211, baseRing: 190.6}},
  }};
  for (const maxRadius of [360, 400])
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
    const sample = (showTerms, showDecans) => {
      const composition = factoryComposition(profile);
      composition.rings = composition.rings.map(ring =>
        ring.archetypeId === 'terms' ? {...ring, enabled: showTerms}
          : ring.archetypeId === 'decans' ? {...ring, enabled: showDecans} : ring);
      const geometry = {...arrangementGeometry(profile, composition, arrangement, maxRadius), showTerms, showDecans};
      const rings = wheel.resolveWheelRingSet(authored, geometry);
      return {rings, geometry, bands: resolveWheelBandLayout(authored, geometry, rings).bands};
    };
    const full = sample(true, true);
    const fullSign = full.bands.find(band => band.id === 'zodiac');
    for (const [terms, decans] of [[true, false], [false, true], [false, false]]) {
      const current = sample(terms, decans);
      const sign = current.bands.find(band => band.id === 'zodiac');
      // These saved diameters cannot fit all minimums simultaneously. Freed
      // space may also restore a constrained neighbour's preferred width.
      assert.ok(thickness(sign) >= thickness(fullSign) - 1e-7,
        `${arrangement}/${terms}/${decans}: Signs must absorb hidden subdivision widths`);
      assert.ok(Math.abs(sign.outer - fullSign.outer) < 1e-7);
      assert.ok(Math.abs(current.rings.r0 - sign.inner) < 1e-7
        && current.rings.rSign > sign.inner && current.rings.rSign < sign.outer,
      `${arrangement}/${terms}/${decans}: sign circle and glyphs must use the expanded band`);
      const nextVisible = current.bands.find(band => band.id === (terms ? 'terms' : decans ? 'decans' : 'cuspRuler'));
      assert.ok(Math.abs(sign.inner - nextVisible.outer) < 1e-7,
        `${arrangement}/${terms}/${decans}: no empty band may remain inside Signs`);
      const signFill = resolveWheelBandFillRegions(current.bands).find(region => region.classId === 'fills.zodiacBand');
      assert.ok(signFill && Math.abs(signFill.inner - sign.inner) < 1e-7,
        `${arrangement}/${terms}/${decans}: sign paint must reach its new inner edge`);
      for (const band of current.bands.filter(band => band.visible && !band.overlay && band.id !== 'margin')) {
        assert.ok(thickness(band) >= wheelBandMinimumWidth(authored, current.geometry, band) - 1e-7,
          `${arrangement}/${terms}/${decans}: ${band.id} must retain its minimum`);
      }
      for (const kind of ['terms', 'decans']) {
        const band = current.bands.find(item => item.id === kind);
        if ((kind === 'terms' && !terms) || (kind === 'decans' && !decans))
          assert.ok(!band.visible && Math.abs(thickness(band)) < 1e-7);
      }
    }
    assert.deepEqual(sample(true, true).rings, full.rings);
  }
});

test('compatible ring ordering keeps house rays out of zodiac instruments', () => {
  assert.ok(compatibleRingOrder(recipe('cusps',['decans','terms','bodies','houses','hub'])));
  assert.equal(compatibleRingOrder(recipe('cusps',['bodies','terms','houses','hub'])),false);
  assert.equal(compatibleRingOrder(recipe('cusps',['terms','outerBodies','bodies','houses','hub'])),false);
});

test('drag moves keep ring identities and reject crossings of chart roles and the core', () => {
  const original = recipe('cusps', ['outerHouses','outerBodies','terms','decans','cuspLabels','bodies','houses','hub']);
  const move = (source, target) => moveWheelRing(original, `cusps-${source}`, `cusps-${target}`);
  const reordered = move('terms', 'cuspLabels');
  assert.deepEqual(reordered.rings.map(r => r.archetypeId),
    ['outerHouses','outerBodies','decans','cuspLabels','terms','bodies','houses','hub']);
  for (const ring of original.rings) assert.equal(reordered.rings.find(r => r.instanceId === ring.instanceId), ring);
  for (const [source, target] of [['terms','outerBodies'], ['terms','houses'], ['outerBodies','bodies'],
    ['houses','hub'], ['hub','terms'], ['missing','terms'], ['terms','missing']]) {
    assert.equal(move(source, target), null, `${source} → ${target} must not submit an invalid intent`);
  }
  assert.deepEqual(original.rings.map(r => r.archetypeId),
    ['outerHouses','outerBodies','terms','decans','cuspLabels','bodies','houses','hub']);
});

test('biwheel outer bands reclaim the legacy outer zone and discard removed anchors', () => {
  for (const profile of ['classic','compact','anglo','houses','cusps']) {
    for (const outerHouses of [true,false]) for (const outerBodies of [true,false]) {
      const ids = ['outerHouses','outerBodies', ...(profile === 'houses' || profile === 'cusps' ? [] : ['zodiac','degree']),
        ...(['anglo','houses','cusps'].includes(profile) ? ['cuspLabels'] : []), 'bodies','houses','hub'];
      const composition = recipe(profile, ids);
      composition.rings = composition.rings.map(r => r.archetypeId === 'outerBodies' ? {...r, enabled: outerBodies} : r);
      const geometry = {...input(composition), profile, mode: 'comparison', hasOuterRing: true,
        showOuterHouses: outerHouses, comparisonWithOuterHouses: false};
      const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const layout = composedWheelLayout(rings);
      const houses = layout.bands.find(b => b.id === 'outerHouses');
      const bodies = layout.bands.find(b => b.id === 'outerBodies');
      assert.equal(Boolean(houses), outerHouses);
      assert.equal(Boolean(bodies), outerBodies);
      if (!['anglo','houses','cusps'].includes(profile)) assert.equal(rings.rOuterHouseName === undefined, !outerHouses);
      assert.equal(rings.rOuterPlanet === undefined, !outerBodies);
      const primary = layout.bands.find(b => b.id !== 'margin' && !b.id.startsWith('outer'));
      assert.ok(rings.r30 <= primary.outer);
      assert.ok(rings.rASCMC <= primary.outer);
      for (const key of ['rOuterMax','rOuterASCMC','rOuterArrow','rOuterLine']) {
        if (!['anglo','houses','cusps'].includes(profile)) assert.ok(rings[key] <= layout.bands[0].inner && rings[key] >= primary.outer, `${profile}: ${key}`);
      }
      if (bodies) assert.ok(rings.rOuterPlanet > bodies.inner && rings.rOuterPlanet < bodies.outer);
      const stack = layout.bands.filter(b => !b.overlay);
      for (let i=1;i<stack.length;i++) assert.equal(stack[i].outer, stack[i-1].inner);
      if (['anglo','houses','cusps'].includes(profile)) {
        const legacy = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, {...geometry, composition: undefined});
        assert.equal(primary.outer, legacy.r30);
        for (const key of ['rOuterASCMC','rOuterArrow','rOuterLine']) assert.equal(rings[key], legacy[key]);
        if (bodies) { assert.equal(bodies.overlay, true); assert.equal(rings.rOuterPlanet, legacy.rOuterPlanet); }
        if (houses) assert.equal(houses.overlay, true);
      }
    }
  }
});

test('cusp material joins adjacent parts but never crosses a reordered intervening ring', async () => {
  for (const ruler of [false, true]) for (const labels of [false, true]) {
    const composition = factoryComposition('anglo');
    for (const ring of composition.rings) {
      if (ring.archetypeId === 'cuspRuler') ring.enabled = ruler;
      if (ring.archetypeId === 'cuspLabels') ring.enabled = labels;
    }
    const geometry = arrangementGeometry('anglo', composition, 'single');
    const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const regions = resolveWheelBandFillRegions(resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands)
      .filter(r => r.classId === 'fills.cuspDegreeBand');
    const hosted = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands
      .some(band => band.id === 'cuspRuler' && band.overlay);
    assert.equal(regions.length, labels || (ruler && !hosted) ? 1 : 0);
    if (regions.length) {
      assert.equal(regions[0].outer, ruler ? rings.rCuspOuter : rings.rCuspLabelOuter);
      assert.equal(regions[0].inner, labels ? rings.rInner : rings.rCuspLabelOuter);
    }
  }
  const composition = recipe('anglo', ['cuspRuler', 'zodiac', 'cuspLabels', 'bodies', 'houses', 'hub']);
  const geometry = arrangementGeometry('anglo', composition, 'single');
  const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
  const bands = composedWheelLayout(rings).bands;
  const regions = resolveWheelBandFillRegions(bands).filter(r => r.classId === 'fills.cuspDegreeBand');
  assert.equal(regions.length, 1, 'a cusp ruler hosted by Signs adds no independent material band');
  const zodiac = bands.find(b => b.id === 'zodiac');
  assert.ok(bands.find(b => b.id === 'cuspRuler')?.overlay);
  assert.ok(regions.every(r => r.inner >= zodiac.outer || r.outer <= zodiac.inner));
});

test('adjacent Cusp rulers occupy Signs without allocating another band in every Anglo-family layout', () => {
  for (const profile of ['anglo', 'houses', 'cusps'])
  for (const arrangement of ['single', 'transit', 'synastry'])
  for (const outside of [false, true]) {
    const composition = factoryComposition(profile);
    composition.rings = composition.rings.map(ring => ring.archetypeId === 'degree'
      ? {...ring, enabled: false} : ring.archetypeId === 'zodiac'
        ? {...ring, enabled: true} : ring);
    const termsIndex = composition.rings.findIndex(ring => ring.archetypeId === 'terms');
    const decansIndex = composition.rings.findIndex(ring => ring.archetypeId === 'decans');
    [composition.rings[termsIndex], composition.rings[decansIndex]] =
      [composition.rings[decansIndex], composition.rings[termsIndex]];
    const cusp = composition.rings.splice(composition.rings.findIndex(r => r.archetypeId === 'cuspRuler'), 1)[0];
    cusp.enabled = true;
    const signIndex = composition.rings.findIndex(r => r.archetypeId === 'zodiac');
    composition.rings.splice(signIndex + Number(!outside), 0, cusp);
    const geometry = arrangementGeometry(profile, composition, arrangement);
    const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const bands = composedWheelLayout(rings)?.bands;
    const signs = bands?.find(b => b.id === 'zodiac');
    const ruler = bands?.find(b => b.id === 'cuspRuler');
    const where = `${profile}/${arrangement}/${outside ? 'outside' : 'inside'}`;
    assert.ok(ruler?.overlay && ruler.visible, `${where}: Cusp ruler is hosted`);
    assert.ok(ruler.inner >= signs.inner && ruler.outer <= signs.outer, `${where}: ticks stay within Signs`);
    const ends = wheelCuspRulerTickEnds(composition, ruler);
    assert.equal(ends.base, outside ? signs.outer : signs.inner, `${where}: attach at adjoining edge`);
    assert.ok(outside ? ends.tip < ends.base : ends.tip > ends.base, `${where}: point into Signs`);
    const without = {...composition, rings: composition.rings.map(r => r === cusp ? {...r, enabled: false} : r)};
    const baseline = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, {...geometry, composition: without});
    for (const key of ['r30', 'r0', 'rSign', 'rPlanet', 'rHouse', 'rAsp']) {
      assert.ok(Math.abs(rings[key] - baseline[key]) < 1e-8, `${where}: hosted ticks must not shift ${key}`);
    }
    assert.ok(!resolveWheelBandFillRegions(bands).some(region => region.classId === 'fills.cuspDegreeBand'
      && region.outer === ruler.outer && region.inner === ruler.inner), `${where}: no separate Cusp annulus`);
  }
});

test('moving Degree outside Signs preserves the separated Cusp and annotation widths', () => {
  for (const arrangement of ['single', 'transit', 'synastry'])
  for (const maxRadius of [180, 400, 800]) {
    const inside = withDegreeRuler(factoryComposition('anglo'));
    inside.rings = inside.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
      ? {...ring, enabled: false} : ring);
    const outside = structuredClone(inside);
    const degree = outside.rings.splice(outside.rings.findIndex(ring => ring.archetypeId === 'degree'), 1)[0];
    outside.rings.splice(outside.rings.findIndex(ring => ring.archetypeId === 'zodiac'), 0, degree);
    const sample = composition => {
      const geometry = {...factoryGeometry('anglo', arrangement), composition, maxRadius,
        showTerms: false, showDecans: false};
      const rings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
      const bands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, rings).bands;
      return {rings, bands, band: id => bands.find(item => item.id === id)};
    };
    const before = sample(inside), after = sample(outside);
    const context = `${arrangement}/${maxRadius}`;
    assert.ok(after.band('degree').overlay && !after.band('cuspRuler').overlay,
      `${context}: hidden subdivision rows preserve Cusp's authored allocation`);
    assert.ok(Math.abs(thickness(after.band('cuspRuler')) - thickness(before.band('cuspRuler'))) < 1e-8,
      `${context}: Cusp retains its own remembered width`);
    assert.ok(Math.abs(thickness(after.band('cuspLabels'))
      - thickness(before.band('cuspLabels'))) < 1e-8,
      `${context}: annotations retain their own remembered width`);
    for (const key of ['r30', 'r0', 'rInner', 'rPlanet', 'rHouse', 'rAsp']) {
      assert.ok(Math.abs(after.rings[key] - before.rings[key]) < 1e-8,
        `${context}: moving Degree must not shift ${key}`);
    }
  }
});

test('authored Cusp and annotation widths keep their individual owners when Degree moves outside Signs', () => {
  const inside = withDegreeRuler(factoryComposition('anglo'));
  inside.rings = inside.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: false} : ring);
  const outside = structuredClone(inside);
  const degree = outside.rings.splice(outside.rings.findIndex(ring => ring.archetypeId === 'degree'), 1)[0];
  outside.rings.splice(outside.rings.findIndex(ring => ring.archetypeId === 'zodiac'), 0, degree);
  const ruler = inside.rings.find(ring => ring.archetypeId === 'cuspRuler');
  const labels = inside.rings.find(ring => ring.archetypeId === 'cuspLabels');
  const editedStyle = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
    ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
    ringWidths: {anglo: {[ruler.instanceId]: 15, [labels.instanceId]: 30}},
  }};
  const sample = composition => {
    const geometry = {...factoryGeometry('anglo', 'single'), composition,
      showTerms: false, showDecans: false};
    const rings = wheel.resolveWheelRingSet(editedStyle, geometry);
    return {rings, bands: resolveWheelBandLayout(editedStyle, geometry, rings).bands};
  };
  const before = sample(inside), after = sample(outside);
  const width = (layout, kind) => thickness(layout.bands.find(band => band.id === kind));
  assert.equal(width(before, 'cuspRuler'), 15);
  assert.equal(width(before, 'cuspLabels'), 30);
  assert.equal(width(after, 'cuspRuler'), width(before, 'cuspRuler'));
  assert.equal(width(after, 'cuspLabels'), width(before, 'cuspLabels'));
  assert.ok(Math.abs(after.rings.rPlanet - before.rings.rPlanet) < 1e-8);
});

test('moving disabled cusp instruments cannot change the active wheel', () => {
  for (const profile of ['anglo', 'houses', 'cusps'])
  for (const arrangement of ['single', 'transit', 'synastry']) {
    const composition = factoryComposition(profile);
    composition.rings = composition.rings.map(ring => ['cuspRuler', 'cuspLabels'].includes(ring.archetypeId)
      ? {...ring, enabled: false} : ring);
    const baseline = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE,
      arrangementGeometry(profile, composition, arrangement));
    const moved = structuredClone(composition);
    const inactive = moved.rings.filter(ring => ['cuspRuler', 'cuspLabels'].includes(ring.archetypeId));
    moved.rings = [...inactive, ...moved.rings.filter(ring => !inactive.includes(ring))];
    const actual = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE,
      arrangementGeometry(profile, moved, arrangement));
    assert.deepEqual(actual, baseline, `${profile}/${arrangement}: unchecked rows cannot change geometry`);
  }
});


test('exterior attachments use the visible rim and remain independent of interior widths', () => {
  for (const profile of ['anglo', 'houses', 'cusps'])
  for (const arrangement of ['auxiliary', 'transit', 'synastry'])
  for (const maxRadius of [180, 400, 800]) for (const outside of [false, true]) {
    const composition = recipe(profile, ['outerHouses', 'outerBodies',
      ...(outside ? ['cuspLabels', 'zodiac'] : ['zodiac', 'cuspLabels']),
      'bodies', 'houses', 'hub']);
    const geometry = {...factoryGeometry(profile, arrangement), composition, maxRadius};
    const base = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const bands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, base).bands;
    const annotation = bands.find(band => band.id === 'cuspLabels');
    const rim = wheelOuterAttachmentRadius(base);
    assert.equal(rim, outside && arrangement === 'synastry' ? annotation.outer : base.r30);
    if (outside && arrangement !== 'synastry') assert.ok(annotation.outer > rim, 'open labels reserve local space without becoming an attachment circle');
    for (const delta of [-2, 2]) {
      const bodies = bands.find(band => band.id === 'bodies');
      const style = withBandWidth(profile, bodies.instanceId, thickness(bodies) * 400 / maxRadius + delta);
      const edited = wheel.resolveWheelRingSet(style, geometry);
      assert.equal(wheelOuterAttachmentRadius(edited), rim, 'interior width cannot stretch exterior leaders');
      assert.equal(edited.rOuterLine - wheelOuterAttachmentRadius(edited), base.rOuterLine - rim);
    }
  }
});

test('auxiliary track width moves text and glyph anchors together without changing primary bands', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const maxRadius of [180, 400, 800]) {
    const geometry = {...factoryGeometry(profile, 'auxiliary'), mode: 'single', maxRadius};
    const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const layout = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, original);
    const band = layout.bands.find(item => item.id === 'outerBodies');
    assert.ok(band?.visible && band.overlay, 'auxiliary text has an authorable outer lane');
    const style = withBandWidth(profile, band.instanceId, thickness(band) * 400 / maxRadius - 2);
    const edited = wheel.resolveWheelRingSet(style, geometry);
    for (const field of ['rAntis', 'rAntisLines', 'rOuterLine']) {
      assert.ok(edited[field] < original[field], `${profile}: ${field} follows track width`);
    }
    const updated = resolveWheelBandLayout(style, geometry, edited);
    for (const before of layout.bands.filter(item => !item.overlay && item.id !== 'margin')) {
      const after = updated.bands.find(item => item.id === before.id);
      assert.equal(after.inner, before.inner);
      assert.equal(after.outer, before.outer);
    }
    assert.ok(updated.bands.every(item => Number.isFinite(item.outer) && Number.isFinite(item.inner)));
  }
});

test('floating exterior cusps do not consume the physical wheel or push any exterior anchor', () => {
  for (const profile of ['anglo', 'houses', 'cusps']) for (const arrangement of ['single', 'auxiliary', 'transit']) {
    const composition = recipe(profile, ['outerBodies', 'cuspLabels', 'zodiac', 'degree', 'bodies', 'houses', 'hub']);
    const geometry = arrangementGeometry(profile, composition, arrangement);
    const without = {...geometry, composition: {...composition, rings: composition.rings.map(ring =>
      ring.archetypeId === 'cuspLabels' ? {...ring, enabled: false} : ring)}};
    const baseline = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, without);
    for (const width of [undefined, 8, 30, 60]) {
      const style = width == null ? wheel.DEFAULT_WHEEL_RENDER_STYLE : withBandWidth(profile, `${profile}-cuspLabels`, width);
      const actual = wheel.resolveWheelRingSet(style, geometry);
      const band = composedWheelLayout(actual).bands.find(band => band.id === 'cuspLabels');
      assert.ok(band.floating && band.inner === actual.r30, `${profile}/${arrangement}: floats at the real rim`);
      for (const field of ['r30', 'r0', 'rSign', 'rPlanet', 'rHouse', 'rAsp', 'rOuterPlanet', 'rOuterRetr', 'rOuterLine', 'rAntis']) {
        assert.equal(actual[field], baseline[field], `${profile}/${arrangement}/${width}: cusp width must not alter ${field}`);
      }
      assert.equal(wheelOuterAttachmentRadius(actual), actual.r30);
    }
  }
});


test('an explicitly adjoining lone Cusp ruler occupies Signs and leaves no empty inner annulus', () => {
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry'])
    for (const degree of [false, true]) for (const width of [4, 12, 40]) {
      const composition = factoryComposition('anglo');
      for (const ring of composition.rings) {
        if (['terms', 'decans', 'cuspLabels'].includes(ring.archetypeId)) ring.enabled = false;
        if (ring.archetypeId === 'degree') ring.enabled = degree;
      }
      composition.rings = composition.rings.filter(ring => !['terms', 'decans', 'cuspLabels'].includes(ring.archetypeId));
      const degreeRing = composition.rings.splice(composition.rings.findIndex(ring => ring.archetypeId === 'degree'), 1)[0];
      composition.rings.splice(composition.rings.findIndex(ring => ring.archetypeId === 'zodiac'), 0, degreeRing);
      const ruler = composition.rings.find(ring => ring.archetypeId === 'cuspRuler');
      const style = withBandWidth('anglo', ruler.instanceId, width);
      const geometry = {...factoryGeometry('anglo', arrangement), composition, showTerms: false, showDecans: false};
      const rings = wheel.resolveWheelRingSet(style, geometry);
      const bands = resolveWheelBandLayout(style, geometry, rings).bands;
      const signs = bands.find(band => band.id === 'zodiac');
      const bodies = bands.find(band => band.id === 'bodies');
      const ticks = bands.find(band => band.id === 'cuspRuler');
      assert.equal(signs.inner, bodies.outer);
      assert.ok(ticks.overlay && ticks.visible);
      assert.equal(ticks.inner, signs.inner);
      assert.ok(ticks.outer <= signs.outer && ticks.outer > ticks.inner);
    }
});

test('diameter and saved thickness compose in either edit order across wheel arrangements', () => {
  const near = (actual, expected, context) => assert.ok(Math.abs(actual - expected) < 1e-7,
    `${context}: ${actual} != ${expected}`);
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry'])
  for (const reordered of [false, true]) {
    const composition = factoryComposition(profile);
    if (reordered) {
      const a = composition.rings.findIndex(ring => ring.archetypeId === 'bodies');
      const b = composition.rings.findIndex(ring => ring.archetypeId === 'houses');
      [composition.rings[a], composition.rings[b]] = [composition.rings[b], composition.rings[a]];
    }
    const geometry = {...factoryGeometry(profile, arrangement), composition};
    const context = `${profile}/${arrangement}/${reordered}`;
    const solve = style => {
      const rings = wheel.resolveWheelRingSet(style, geometry);
      return {rings, bands: resolveWheelBandLayout(style, geometry, rings).bands};
    };
    const factory = solve(wheel.DEFAULT_WHEEL_RENDER_STYLE);
    const body = factory.bands.find(band => band.id === 'bodies');
    const widthStyle = withBandWidth(profile, body.instanceId, thickness(body) + 3);
    const sized = solve(widthStyle);
    const startRadius = sized.rings.rInner;
    for (const delta of [-2, 0, 2, -1, 1]) {
      const target = startRadius + delta;
      const edited = {...widthStyle, authoringOverrides: {...widthStyle.authoringOverrides,
        ringRadii: {[profile]: {innerBoundaryRing: target}}}};
      const result = solve(edited);
      near(result.rings.rInner, target, `${context}/radius-after-width`);
      near(thickness(result.bands.find(band => band.id === 'bodies')),
        thickness(sized.bands.find(band => band.id === 'bodies')), `${context}/carry-width`);
      const nextWidth = thickness(body) + 4;
      const resized = {...edited, authoringOverrides: {...edited.authoringOverrides,
        ringWidths: {[profile]: {[body.instanceId]: nextWidth}}}};
      const after = solve(resized);
      near(after.rings.rInner, target, `${context}/hold-diameter`);
      near(thickness(after.bands.find(band => band.id === 'bodies')), nextWidth,
        `${context}/width-after-radius`);
      assert.deepEqual(solve(JSON.parse(JSON.stringify(resized))), after, `${context}/reload`);
      assert.deepEqual(solve(widthStyle), sized, `${context}/revert`);
      for (const band of after.bands) assert.ok(band.outer >= band.inner - 1e-7, `${context}/${band.id}`);
    }
  }
});

test('two authored neighbor diameters constrain thickness and its advertised limits', () => {
  const geometry = {...factoryGeometry('classic', 'single'), showTerms: true, showDecans: true};
  const original = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
  const band = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, original)
    .bands.find(item => item.id === 'bodies');
  const style = {...withBandWidth('classic', band.instanceId, thickness(band) + 10),
    authoringOverrides: {...withBandWidth('classic', band.instanceId, thickness(band) + 10).authoringOverrides,
      ringRadii: {classic: {innerBoundaryRing: band.outer, aspectBoundaryRing: band.inner}}}};
  const rings = wheel.resolveWheelRingSet(style, geometry);
  const solved = resolveWheelBandLayout(style, geometry, rings).bands.find(item => item.id === 'bodies');
  assert.equal(rings.rInner, band.outer);
  assert.equal(rings.rAsp, band.inner);
  assert.equal(thickness(solved), thickness(band));
  assert.deepEqual(solved.widthBounds, {min: thickness(band), max: thickness(band)});
});

test('band minimums survive conflicting diameters, width edits, and subdivision toggles', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry'])
  for (const reordered of [false, true])
  for (const maxRadius of [200, 400, 800]) {
    const composition = factoryComposition(profile);
    if (reordered) {
      const a = composition.rings.findIndex(ring => ring.archetypeId === 'terms');
      const b = composition.rings.findIndex(ring => ring.archetypeId === 'zodiac');
      [composition.rings[a], composition.rings[b]] = [composition.rings[b], composition.rings[a]];
    }
    for (const [terms, decans] of [[true, false], [true, true], [false, true], [false, false], [true, true]]) {
      const active = {...composition, rings: composition.rings.map(ring => ({...ring,
        enabled: ring.archetypeId === 'terms' ? terms : ring.archetypeId === 'decans' ? decans : ring.enabled}))};
      for (const pin of [0, 10, 200, 390, 800])
      for (const requestedWidth of [1, 45, 1000]) {
        const authored = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
          ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
          ringRadii: {[profile]: {zodiacOuterRing: pin, zodiacInnerRing: pin,
            termRing: pin, cuspOuterRing: pin, innerBoundaryRing: pin, houseBoundaryRing: pin, baseRing: pin}},
          ringWidths: {[profile]: {[`${profile}-zodiac`]: 1, [`${profile}-terms`]: requestedWidth,
            [`${profile}-decans`]: requestedWidth, [`${profile}-cuspLabels`]: 1}},
        }};
        const geometry = {...arrangementGeometry(profile, active, arrangement, maxRadius), showTerms: terms, showDecans: decans};
        const rings = wheel.resolveWheelRingSet(authored, geometry);
        const bands = resolveWheelBandLayout(authored, geometry, rings).bands;
        for (const band of bands.filter(band => band.visible && !band.overlay && !band.floating && band.id !== 'margin')) {
          const minimum = wheelBandMinimumWidth(authored, geometry, band);
          assert.ok(thickness(band) >= minimum - 1e-7,
            `${profile}/${arrangement}/${reordered}/${maxRadius}/${terms}/${decans}/${pin}: ${band.id} width ${thickness(band)} below ${minimum}`);
          assert.ok(band.inner >= -1e-7, 'all bands remain inside the radial domain');
        }
      }
    }
  }
});

test('touching a reordered subdivision radius preserves the wheel and hosted ruler attachment', () => {
  const original = withDegreeRuler(factoryComposition('anglo'));
  original.rings = original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  for (const [source, role] of [['degree', 'termRing'], ['cuspRuler', 'zodiacInnerRing'], ['cuspLabels', 'termRing']]) {
    const composition = moveWheelRing(original, `anglo-${source}`, 'anglo-zodiac');
    assert.ok(composition);
    const geometry = {...arrangementGeometry('anglo', composition, 'single'), showTerms: true, showDecans: true};
    const before = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const shown = wheel.resolveWheelPaintedRingRadius(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, role);
    const range = wheel.resolveWheelPaintedRingReferenceRange(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, role);
    assert.ok(shown >= range.min && shown <= range.max, 'the displayed value is feasible');
    const authored = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii: {anglo: {[role]: shown}},
    }};
    const after = wheel.resolveWheelRingSet(authored, geometry);
    for (const [field, value] of Object.entries(before)) {
      if (typeof value === 'number') assert.ok(Math.abs(after[field] - value) < 1e-8,
        `${source}/${role}: touching ${shown} moved ${field}: ${value} -> ${after[field]}`);
    }
    const bands = resolveWheelBandLayout(authored, geometry, after).bands;
    const signs = bands.find(band => band.id === 'zodiac');
    for (const ruler of bands.filter(band => band.overlay && ['degree', 'cuspRuler'].includes(band.id))) {
      assert.ok(ruler.outer >= ruler.inner, `${ruler.id} is not inverted`);
      assert.ok(ruler.outer <= signs.outer && ruler.inner >= signs.inner, `${ruler.id} stays in Signs`);
      const ticks = ruler.id === 'degree' ? wheelDegreeTickEnds(composition, ruler.outer, ruler.inner)
        : wheelCuspRulerTickEnds(composition, ruler);
      const outside = composition.rings.findIndex(ring => ring.archetypeId === ruler.id)
        < composition.rings.findIndex(ring => ring.archetypeId === 'zodiac');
      assert.ok(outside ? ticks.tip <= ticks.base : ticks.tip >= ticks.base, `${ruler.id} keeps its direction`);
    }
  }
});

test('chart-ring spans scale the actual reordered boundary sequence and keep hosted instruments attached', () => {
  const original = withDegreeRuler(factoryComposition('anglo'));
  original.rings = original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  for (const source of ['degree', 'cuspRuler']) {
    const composition = moveWheelRing(original, `anglo-${source}`, 'anglo-zodiac');
    const geometry = {...arrangementGeometry('anglo', composition, 'single'), showTerms: true, showDecans: true};
    const originalRings = wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry);
    const originalBands = resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry, originalRings).bands;
    const factor = .95;
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, bandSpanScale: {anglo: {chartRing: factor}},
    }};
    const result = wheel.resolveWheelRingSet(style, geometry);
    const bands = resolveWheelBandLayout(style, geometry, result).bands;
    const bodyIndex = bands.findIndex(band => band.id === 'bodies');
    for (const band of bands.slice(0, bodyIndex + 1).filter(band => band.id !== 'margin' && !band.overlay)) {
      const before = originalBands.find(item => item.id === band.id);
      const expected = geometry.maxRadius - factor * (geometry.maxRadius - before.outer);
      assert.ok(Math.abs(band.outer - expected) < 1e-8,
        `${source}/${band.id}: span moved boundary to ${band.outer}, expected ${expected}`);
    }
  }
});

test('persisted radius priority reproduces a push after release and reload without adding pins', () => {
  for (const reordered of [false, true]) {
    const original = withDegreeRuler(factoryComposition('anglo'));
    original.rings = original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
      ? {...ring, enabled: true} : ring);
    const composition = reordered ? moveWheelRing(original, 'anglo-cuspRuler', 'anglo-zodiac') : original;
    const geometry = {...arrangementGeometry('anglo', composition, 'single'), showTerms: true, showDecans: true};
    const radii = {zodiacOuterRing: 300, innerBoundaryRing: 320};
    const oldStyle = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, ringRadii: {anglo: radii},
    }};
    const during = wheel.resolveWheelRingSet(oldStyle, {...geometry, pushBoundaryRole: 'innerBoundaryRing'});
    const committed = {...oldStyle, authoringOverrides: {...oldStyle.authoringOverrides,
      radiusPriority: {anglo: 'innerBoundaryRing'},
    }};
    const stored = JSON.stringify(committed);
    const released = wheel.resolveWheelRingSet(committed, geometry);
    assert.deepEqual(released, during, 'release retains the final pushed wheel');
    assert.deepEqual(wheel.resolveWheelRingSet(JSON.parse(stored), geometry), during, 'reload retains push priority');
    assert.equal(JSON.stringify(committed), stored, 'solving never edits authored preferences');
    assert.deepEqual(committed.authoringOverrides.ringRadii.anglo, radii, 'displaced neighbours do not become pins');
    assert.ok(released.rInner > wheel.resolveWheelRingSet(oldStyle, geometry).rInner, 'old profiles retain their previous policy');
  }
});

test('authored boundary roles keep their semantic edge when reordered wheels return to original order', () => {
  const original = withDegreeRuler(factoryComposition('anglo'));
  original.rings = original.rings.map(ring => ['terms', 'decans', 'outerHouses'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  const reordered = moveWheelRing(original, 'anglo-degree', 'anglo-zodiac');
  for (const arrangement of ['single', 'synastry']) {
    const inputFor = composition => ({...factoryGeometry('anglo', arrangement), composition,
      showTerms: true, showDecans: true, comparisonWithOuterHouses: arrangement === 'synastry',
      showOuterHouses: arrangement === 'synastry'});
    const editedInput = inputFor(reordered);
    const roles = [['zodiacInnerRing', 'terms'], ['termRing', 'decans'], ['outerDegreeRing', 'cuspLabels']];
    if (arrangement === 'synastry') roles.push(['outerMaximumRing', 'outerHouses'], ['outerHouseRing', 'outerBodies']);
    for (const [role, bandId] of roles) {
      const shown = wheel.resolveWheelPaintedRingRadius(wheel.DEFAULT_WHEEL_RENDER_STYLE, editedInput, role);
      const target = shown + 2;
      const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
        ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        ringRadii: {anglo: {[role]: target}}, radiusPriority: {anglo: role},
        ...(role === 'outerDegreeRing' ? {outerDegreeBinding: {anglo: 'cuspLabels'}} : {}),
      }};
      const saved = JSON.stringify(style);
      const before = wheel.resolveWheelRingSet(style, editedInput);
      for (const composition of [original, reordered, original, reordered]) {
        const input = inputFor(composition);
        const rings = wheel.resolveWheelRingSet(style, input);
        const band = resolveWheelBandLayout(style, input, rings).bands.find(band => band.id === bandId);
        assert.ok(Math.abs(band.outer - target) < 1e-7,
          `${arrangement}/${role}: ${bandId} edge changed meaning (${band.outer} vs ${target})`);
        if (composition === reordered) assert.deepEqual(rings, before, 'reorder-back restores the edited geometry');
      }
      assert.equal(JSON.stringify(style), saved, 'reordering retains sparse authored preferences');
    }
  }
});

test('inherited radius dimensions survive ruler reflow and the first explicit radius edit', () => {
  const recipeRadii = {zodiacOuterRing: 379.1, zodiacInnerRing: 348.1, termRing: 335.1,
    cuspOuterRing: 321.4, innerBoundaryRing: 299.1, houseBoundaryRing: 211, baseRing: 190.6};
  const saved = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
    ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
    recipeRadii: {anglo: recipeRadii}, ringRadii: {},
  }};
  const full = withDegreeRuler(factoryComposition('anglo'));
  full.rings = full.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  const makeInput = composition => ({...factoryGeometry('anglo', 'auxiliary'), composition,
    showTerms: true, showDecans: true, outerRingMode: 'fixstars'});
  const solve = (style, composition) => {
    const geometry = makeInput(composition);
    const rings = wheel.resolveWheelRingSet(style, geometry);
    return {geometry, rings, bands: resolveWheelBandLayout(style, geometry, rings).bands};
  };
  const original = solve(saved, full);
  const inherited = {...saved, authoringOverrides: {...saved.authoringOverrides,
    recipeRadii: undefined, ringRadii: {anglo: recipeRadii}}};
  const previous = solve(inherited, full);
  for (const [field, value] of Object.entries(previous.rings)) if (typeof value === 'number')
    assert.ok(Math.abs(original.rings[field] - value) < 1e-7, `${field}: unchanged saved recipe stays exact`);
  const order = ['outerHouses', 'outerBodies', 'cuspRuler', 'zodiac', 'terms', 'degree',
    'decans', 'cuspLabels', 'bodies', 'houses', 'hub'];
  const shown = {...full, customized: true, rings: order.map(kind => ({
    ...full.rings.find(ring => ring.archetypeId === kind), enabled: kind !== 'cuspLabels',
  }))};
  const outsideDegree = moveWheelRing(shown, 'anglo-degree', 'anglo-zodiac');
  const insideDegree = moveWheelRing(shown, 'anglo-degree', 'anglo-terms');
  for (const composition of [shown, outsideDegree, insideDegree, shown]) {
    const current = solve(saved, composition);
    for (const id of ['zodiac', 'terms', 'decans', 'bodies', 'houses']) {
      const before = original.bands.find(band => band.id === id);
      const band = current.bands.find(band => band.id === id);
      assert.ok(Math.abs(thickness(band) - thickness(before)) < 1e-7,
        `${id}: a structural ruler move must retain its preferred width`);
    }
    for (const role of ['zodiacOuterRing', 'zodiacInnerRing', 'termRing', 'innerBoundaryRing', 'baseRing']) {
      const radius = wheel.resolveWheelPaintedRingRadius(saved, current.geometry, role);
      const touched = {...saved, authoringOverrides: {...saved.authoringOverrides,
        ringRadii: {anglo: {[role]: radius}}, radiusPriority: {anglo: role}}};
      const noOp = solve(touched, composition);
      for (const [field, value] of Object.entries(current.rings)) if (typeof value === 'number')
        assert.ok(Math.abs(noOp.rings[field] - value) < 1e-7, `${role}: first no-op must preserve ${field}`);
      const moved = {...touched, authoringOverrides: {...touched.authoringOverrides,
        ringRadii: {anglo: {[role]: radius + .001}}}};
      const after = solve(moved, composition);
      for (const [field, value] of Object.entries(current.rings)) if (typeof value === 'number')
        assert.ok(Math.abs(after.rings[field] - value) <= .001 * 4 + 1e-7,
          `${role}: an epsilon edit cannot teleport ${field}`);
      assert.deepEqual(solve(JSON.parse(JSON.stringify(moved)), composition).rings, after.rings);
    }
  }
  const allocated = solve(saved, shown), hosted = solve(saved, insideDegree);
  const degree = allocated.bands.find(band => band.id === 'degree');
  assert.ok(!degree.overlay);
  assert.ok(hosted.bands.find(band => band.id === 'degree').overlay);
  assert.ok(hosted.bands.find(band => band.id === 'cuspRuler').overlay);
  assert.ok(Math.abs(thickness(hosted.bands.find(band => band.id === 'hub'))
    - thickness(allocated.bands.find(band => band.id === 'hub')) - thickness(degree)) < 1e-7,
  'hosting a ruler returns precisely its allocated depth to the hub');
});

test('live outer-degree targets and transient push diagnostics never retarget the inherited recipe', () => {
  const original = withDegreeRuler(factoryComposition('anglo'));
  original.rings = original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  const composition = moveWheelRing(original, 'anglo-degree', 'anglo-zodiac');
  const geometry = {...factoryGeometry('anglo', 'synastry'), composition,
    showTerms: true, showDecans: true, comparisonWithOuterHouses: true, showOuterHouses: true};
  const saved = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
    ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
    recipeRadii: {anglo: {outerDegreeRing: 330}}, ringRadii: {},
  }};
  const before = wheel.resolveWheelRingSet(saved, geometry);
  const targetStyle = {...saved, authoringOverrides: {...saved.authoringOverrides,
    outerDegreeBinding: {anglo: 'cuspLabels'}}};
  assert.deepEqual(wheel.resolveWheelRingSet(targetStyle, geometry), before,
    'a new live target cannot reinterpret an inherited degree boundary');
  const labels = resolveWheelBandLayout(saved, geometry, before).bands.find(band => band.id === 'cuspLabels');
  const touched = {...targetStyle, authoringOverrides: {...targetStyle.authoringOverrides,
    ringRadii: {anglo: {outerDegreeRing: labels.outer}}, radiusPriority: {anglo: 'outerDegreeRing'}}};
  const released = wheel.resolveWheelRingSet(touched, geometry);
  for (const [field, value] of Object.entries(before)) if (typeof value === 'number')
    assert.ok(Math.abs(released[field] - value) < 1e-7, `no-op target switch changed ${field}`);
  assert.deepEqual(wheel.resolveWheelRingSet(touched, {...geometry, pushBoundaryRole: 'outerDegreeRing'}), released,
    'transient diagnostics affect only the final live solve');
});

test('explicit Degree terminal intent survives unpainted annotation joins and annotation visibility', () => {
  const full = withDegreeRuler(factoryComposition('anglo'));
  full.rings = full.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  const order = ['outerHouses', 'outerBodies', 'zodiac', 'terms', 'degree', 'decans',
    'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
  const detached = {...full, customized: true,
    rings: order.map(id => full.rings.find(ring => ring.archetypeId === id))};
  for (const maxRadius of [200, 400, 800]) for (const cuspRuler of [false, true])
  for (const cuspLabels of [false, true]) {
    const composition = {...detached, rings: detached.rings.map(ring =>
      ring.archetypeId === 'cuspRuler' ? {...ring, enabled: cuspRuler}
        : ring.archetypeId === 'cuspLabels' ? {...ring, enabled: cuspLabels} : ring)};
    const geometry = {...arrangementGeometry('anglo', composition, 'single', maxRadius),
      showTerms: true, showDecans: true};
    const base = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      recipeRadii: {anglo: {}}, outerDegreeBinding: {anglo: 'degree'},
    }};
    const before = wheel.resolveWheelRingSet(base, geometry);
    const degree = resolveWheelBandLayout(base, geometry, before).bands.find(band => band.id === 'degree');
    const initial = degree.inner * 400 / maxRadius;
    const range = wheel.resolveWheelPaintedRingReferenceRange(base, geometry, 'outerDegreeRing');
    assert.ok(range && range.min <= initial && range.max >= initial,
      'the declared Degree terminal remains editable when its adjoining annotation seam is unpainted');
    for (const delta of [-1, 0, 1]) {
      const target = initial + delta;
      const edited = {...base, authoringOverrides: {...base.authoringOverrides,
        ringRadii: {anglo: {outerDegreeRing: target}}, radiusPriority: {anglo: 'outerDegreeRing'}}};
      const after = wheel.resolveWheelRingSet(edited, geometry);
      const bands = resolveWheelBandLayout(edited, geometry, after).bands;
      const moved = bands.find(band => band.id === 'degree');
      const decans = bands.find(band => band.id === 'decans');
      assert.ok(Math.abs(moved.inner - target * maxRadius / 400) < 1e-7,
        `${maxRadius}/${cuspRuler}/${cuspLabels}/${delta}: explicit Degree terminal must solve its actual edge`);
      assert.equal(moved.inner, decans.outer, 'a shared terminal has one declared physical boundary');
      assert.equal(after.rOuter10, moved.inner, 'the final derived Degree alias agrees with the edited terminal');
      if (!delta) assert.deepEqual(after, before, 'a no-op terminal edit preserves every numeric anchor');
      assert.deepEqual(wheel.resolveWheelRingSet(JSON.parse(JSON.stringify(edited)), geometry), after);
    }
  }
});

test('explicit hosted Degree terminal edits follow their declared attachment without adding a lane', () => {
  const full = withDegreeRuler(factoryComposition('anglo'));
  full.rings = full.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring);
  for (const edge of ['outer', 'inner']) for (const maxRadius of [200, 400, 800]) {
    const primary = edge === 'outer' ? ['degree', 'zodiac', 'terms', 'decans']
      : ['zodiac', 'degree', 'terms', 'decans'];
    const order = ['outerHouses', 'outerBodies', ...primary, 'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'];
    const composition = {...full, customized: true,
      rings: order.map(id => full.rings.find(ring => ring.archetypeId === id))};
    const geometry = {...arrangementGeometry('anglo', composition, 'single', maxRadius),
      showTerms: true, showDecans: true};
    const base = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      recipeRadii: {anglo: {}}, outerDegreeBinding: {anglo: 'degree'},
      ringWidths: {anglo: {'anglo-degree': 10}},
    }};
    const before = wheel.resolveWheelRingSet(base, geometry);
    const originalBands = resolveWheelBandLayout(base, geometry, before).bands;
    const degree = originalBands.find(band => band.id === 'degree');
    assert.equal(degree.attachment?.edge, edge);
    const withoutBinding = {...base, authoringOverrides: {...base.authoringOverrides, outerDegreeBinding: {}}};
    for (const role of ['zodiacOuterRing', 'cuspOuterRing', 'innerBoundaryRing'])
      assert.deepEqual(wheel.resolveWheelPaintedRingReferenceRange(base, geometry, role),
        wheel.resolveWheelPaintedRingReferenceRange(withoutBinding, geometry, role),
        `${role}: another handle cannot inherit the Degree depth interval`);
    const initial = degree.inner * 400 / maxRadius;
    const range = wheel.resolveWheelPaintedRingReferenceRange(base, geometry, 'outerDegreeRing');
    assert.ok(range && range.min <= initial - 1 && range.max >= initial + 1,
      `${edge}: a hosted terminal exposes the applicable stack or depth interval`);
    for (const delta of [-1, 0, 1]) {
      const target = initial + delta;
      const edited = {...base, authoringOverrides: {...base.authoringOverrides,
        ringRadii: {anglo: {outerDegreeRing: target}}, radiusPriority: {anglo: 'outerDegreeRing'}}};
      const after = wheel.resolveWheelRingSet(edited, geometry);
      const bands = resolveWheelBandLayout(edited, geometry, after).bands;
      const moved = bands.find(band => band.id === 'degree');
      const signs = bands.find(band => band.id === 'zodiac');
      assert.ok(Math.abs(moved.inner - target * maxRadius / 400) < 1e-7,
        `${edge}/${maxRadius}/${delta}: final hosted terminal follows explicit intent`);
      assert.ok(moved.inner >= signs.inner && moved.outer <= signs.outer, 'hosted Degree stays inside Signs');
      if (edge === 'outer') for (const band of bands.filter(band => band.id !== 'degree')) {
        const original = originalBands.find(item => item.id === band.id);
        assert.equal(band.outer, original.outer, `${band.id}: depth editing does not allocate another lane`);
        assert.equal(band.inner, original.inner, `${band.id}: depth editing does not displace the physical stack`);
      }
      if (!delta) for (const [field, value] of Object.entries(before)) if (typeof value === 'number')
        assert.ok(Math.abs(after[field] - value) < 1e-7, `no-op hosted terminal changed ${field}`);
      assert.deepEqual(wheel.resolveWheelRingSet(JSON.parse(JSON.stringify(edited)), geometry), after);
    }
  }
});
