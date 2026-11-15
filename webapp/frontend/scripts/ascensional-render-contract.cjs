// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// A real shared-painter contract, fed a daemon snapshot by pytest.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const lib = path.resolve(__dirname, '../src/lib/chart');
const { drawSnapshotLayer, computeHitRegions } = require(path.join(lib, 'draw-chart.ts'));
const { createWheelRenderStyle } = require(path.join(lib, 'wheel-render-style.ts'));
const { resolveMultiwheelLayout, drawMultiwheel } = require(path.join(lib, 'multiwheel-render-style.ts'));
const { CanvasDraw } = require(path.join(lib, 'canvas-draw.ts'));
const { EMPTY_ASPECT_VIEW, aspectViewState, changeAspectView } = require(path.join(lib, 'aspect-view-state.ts'));
const snapshot = JSON.parse(fs.readFileSync(0, 'utf8'));
const calls = [];
const ctx = new Proxy({ font: '12px sans-serif' }, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'getTransform') return () => ({a: 1});
  if (key === 'measureText') return text => { const size = Number(/([0-9.]+)px/.exec(target.font)?.[1] || 12); return {width: text.length * size * .6, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size * .6, actualBoundingBoxAscent: size*.8, actualBoundingBoxDescent: size*.2}; };
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({addColorStop() {}});
  return (...args) => { for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)} has nonfinite coordinate`); calls.push([key, ...args]); };
}});
const draw = new CanvasDraw({width: 800, height: 800, style: {}, getContext: () => ctx});
let state = {...EMPTY_ASPECT_VIEW, aspectViews: {}};
state = {...state, ...changeAspectView(state, 'left', 'body', 'sun')};
state = {...state, ...changeAspectView(state, 'right', 'hide')};
assert.equal(aspectViewState(state, 'left').selectedAspectBody, 'sun');
assert.equal(aspectViewState(state, 'right').hideAllAspects, true);
assert.equal(aspectViewState(state, 'left').hideAllAspects, false);
assert.equal(aspectViewState(state, 'new').selectedAspectBody, null);
for (const theme of [0, 1, 2]) {
  snapshot.primaryChart.options.theme = theme;
  const renderStyle = createWheelRenderStyle({palette: snapshot.primaryChart.palette});
  const opts = {width: 800, height: 800, renderStyle};
  calls.length = 0;
  // Screen and PNG/PDF exporters all call these same layers.
  for (const layer of ['fill', 'geometry', 'dynamic', 'outer-label']) drawSnapshotLayer(draw, snapshot, layer, opts);
  assert.ok(calls.length > 100);
  const hits = computeHitRegions(snapshot, {...opts, includeStyleTargets: true, textMeasurer: draw});
  const sun = hits.find(hit => hit.kind === 'planet' && hit.planetId === 'sun');
  assert.ok(sun, `Sun hit in theme ${theme}`);
  assert.equal(sun.longitude, snapshot.primaryChart.planets.find(p => p.id === 'sun').longitude);
  assert.equal(sun.viewDocumentId, snapshot.document.documentId);
  assert.equal(sun.coordinateMode, 'ascensional');
  assert.equal(hits.filter(hit => hit.kind === 'term' || hit.kind === 'decan').length, 0);
  for (const hit of hits) for (const field of ['x','y','w','h','radius']) if (field in hit) assert.ok(Number.isFinite(hit[field]), `${hit.kind}:${field}`);
  assert.equal(hits.filter(hit => hit.kind === 'sign').length, snapshot.primaryChart.coordinateFrame.showEquatorialSigns ? 12 : 0);
  assert.ok(hits.some(hit => hit.kind === 'angle'));
  // Without equatorial signs the sign band is the house band: house labels sit
  // in it once, outside the body ring, and no zodiac sign target exists there.
  const houseHits = hits.filter(hit => hit.kind === 'house');
  if (houseHits.length === 12) {
    const cx = houseHits.reduce((sum, hit) => sum + hit.x, 0) / 12;
    const cy = houseHits.reduce((sum, hit) => sum + hit.y, 0) / 12;
    const houseRadius = Math.hypot(houseHits[0].x - cx, houseHits[0].y - cy);
    const sunRadius = Math.hypot(sun.x - cx, sun.y - cy);
    assert.equal(houseRadius > sunRadius, !snapshot.primaryChart.coordinateFrame.showEquatorialSigns,
      `house labels ${houseRadius} vs bodies ${sunRadius} in theme ${theme}`);
  }
  // Single letters double as Morinus body glyphs; multi-letter house labels do not.
  for (const label of ['IV', 'VII']) {
    const painted = calls.filter(call => call[0] === 'fillText' && call[1] === label).length;
    assert.ok(painted <= 1, `${label} painted ${painted} times in theme ${theme}`);
    if (!snapshot.primaryChart.coordinateFrame.showEquatorialSigns && houseHits.length === 12) {
      assert.equal(painted, 1, `${label} in the house band, theme ${theme}`);
    }
  }
  for (const hit of hits.filter(hit => hit.kind === 'aspect')) {
    assert.ok(hit.contactId);
    assert.ok(hit.method === 'mdo' || hit.method === 'ascensional-transits');
  }
  for (const item of snapshot.outerRingItems?.[snapshot.outerRingMode] ?? []) {
    const hit = hits.find(hit => hit.kind === 'secondary_ring' && hit.itemId === item.id);
    assert.ok(hit, `${item.family}:${item.id} reaches shared hits`);
    assert.equal(hit.longitude, item.longitude);
    assert.equal(hit.aspectKey, item.aspectKey);
    if (item.positionInLabel && snapshot.outerRingItems[snapshot.outerRingMode].length === 1) {
      const expected = snapshot.primaryChart.options.showOuterMinutes === false
        ? ` ${item.degText}°` : ` ${item.degText}°${item.minText}′`;
      assert.ok(calls.some(call => call[0] === 'fillText' && call[1].trim() === expected.trim()),
        `${item.id} paints its prepared ascensional readout ${expected}`);
    }
  }
  // Undefined points never paint or create a stale/source-longitude region.
  const undefinedSnapshot = structuredClone(snapshot);
  undefinedSnapshot.primaryChart.planets.find(p => p.id === 'sun').drawingAngle = null;
  const undefinedHits = computeHitRegions(undefinedSnapshot, opts);
  assert.ok(!undefinedHits.some(hit => hit.kind === 'planet' && hit.planetId === 'sun'));
}
const rings = Array.from({length: 4}, () => structuredClone(snapshot.primaryChart));
const multi = {...snapshot, rings};
const style = createWheelRenderStyle({palette: rings[0].palette});
const visible = resolveMultiwheelLayout({maxRadius: 380, ringCount: 4, ringZodiac: 'rim', showZodiac: true});
const hidden = resolveMultiwheelLayout({maxRadius: 380, ringCount: 4, ringZodiac: 'rim', showZodiac: false});
assert.equal(hidden.zodiacBand.outer - hidden.zodiacBand.inner, 0);
assert.ok(hidden.ringBands[3].outer > visible.ringBands[3].outer);
const hits = drawMultiwheel(draw, [400,400], visible, multi, rings[0].palette, {symbols:'AriesMorinus',ui:'FreeSans'}, {width:800,height:800,topBoundary:0}, style);
for (let index=0; index<4; index++) assert.ok(hits.some(hit => hit.kind === 'planet' && hit.planetId === 'sun' && hit.ringIndex === index));
console.log('Shared ascensional paint/hit/export and view-isolation contracts passed');

const {multiwheelOuterScene, paintMultiwheelOuterRing} = require(path.join(lib, 'multiwheel-outer-ring.ts'));
const overlay = multiwheelOuterScene(multi, {width:800,height:800,renderStyle:style}, visible.maxRadius);
if (overlay) {
 const outerHits = paintMultiwheelOuterRing(draw, overlay);
 assert.equal(outerHits.length, overlay.scene.items.length);
 assert.ok(outerHits.every(hit => hit.kind === 'secondary_ring' && hit.coordinateMode === 'ascensional'));
}
