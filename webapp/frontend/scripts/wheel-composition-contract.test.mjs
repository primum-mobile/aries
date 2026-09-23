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
const {composedWheelLayout, resolveWheelBandLayout, wheelOuterAttachmentRadius} = await import(layoutUrl);
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

test('Anglo ruler combinations preserve neighboring widths and additive geometry', () => {
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
        const singles = [sample(degree, true, true), sample(true, cuspRuler, true), sample(true, true, cuspLabels)];
        for (const key of ['rPlanet', 'rHouse', 'rAsp']) {
          const expected = baseline.rings[key] + singles.reduce((delta, item) => delta + item.rings[key] - baseline.rings[key], 0);
          assert.ok(Math.abs(current.rings[key] - expected) < 1e-8, `${context}: ${key} must combine additively`);
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

test('untouched factory compositions preserve all five original dimensions', () => {
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    for (const arrangement of ['single', 'auxiliary', 'transit', 'synastry']) {
      for (const maxRadius of [200, 400, 600]) {
        const geometry = arrangementGeometry(profile, factoryComposition(profile), arrangement, maxRadius);
        assert.deepEqual(wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry),
          wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, {...geometry, composition: undefined}),
          `${profile}/${arrangement}/${maxRadius} must retain the original radii`);
      }
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
      assert.ok(band?.outer > band?.inner);
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
const cuspRecipes = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
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
  const {resolveWheelBandFillRegions} = await import(layoutUrl);
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
    assert.equal(regions.length, ruler || labels ? 1 : 0);
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
  assert.equal(regions.length, 2);
  const zodiac = bands.find(b => b.id === 'zodiac');
  assert.ok(regions.every(r => r.inner >= zodiac.outer || r.outer <= zodiac.inner));
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
