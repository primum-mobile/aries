// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const curves = require('../../../Res/astrocart/curve-geometry.js');
const ruler = require('../../../Res/astrocart/ruler-geometry.js');
const refinement = require('../../../Res/astrocart/curve-refinement.js');
const horizon = (extra = {}) => ({ properties: { curve: {
  type: 'horizon', ra: 45, dec: 23, rotation: 10, sign: -1, domain: [-67, 67], ...extra,
} }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
const ray = (extra = {}) => ({ properties: { curve: {
  type: 'geodesic', origin: [13.4, 52.5], bearing: 74, domain: [0, 20000000], ...extra,
} }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
const viewport = (p, zoom) => ({ zoom, bounds: [p[0] - .03, p[1] - .03, p[0] + .03, p[1] + .03] });

for (const [name, feature, t] of [
  ['ordinary', horizon(), 48.13579], ['geodetic', horizon({ obliquity: 23.4367 }), -48.13579],
  ['Local Space', ray(), 1234567.89], ['opposition', ray({ bearing: 254 }), 8765432.1],
]) {
  test(`${name}: analytic on-line attachment stays exact through every drawing zoom`, () => {
    const point = curves.model(feature).at(t);
    const segments = ruler.prepare([feature]);
    assert.ok(ruler.nearest(segments, point).meters < .02);
    for (const zoom of [2, 10, 18, 22]) {
      const drawn = curves.tessellate(feature, viewport(point, zoom));
      // Remove the descriptor to measure the actual rendered Mercator mesh.
      const mesh = ruler.prepare([{ ...drawn, properties: {} }]);
      const error = ruler.nearest(mesh, point).meters;
      const pixelMeters = 40300000 / (512 * 2 ** zoom);
      assert.ok(error <= Math.max(.02, .4 * pixelMeters), `${name} zoom ${zoom}: ${error} m`);
      assert.ok(ruler.nearest(ruler.prepare([drawn]), point).meters < .02);
    }
  });
}

test('fallback lines follow drawn Mercator segments rather than a different geodesic', () => {
  const feature = { geometry: { type: 'LineString', coordinates: [[10, 45], [20, 55]] } };
  const point = curves.mercatorSegment(...feature.geometry.coordinates)(.4321);
  assert.ok(ruler.nearest(ruler.prepare([feature]), point).meters < .02);
});

test('dateline intersections are solved on the curve and never draw a world-spanning chord', () => {
  for (const feature of [ray({ origin: [179.9, 55], bearing: 83 }), horizon({ rotation: 179 })]) {
    const drawn = curves.tessellate(feature, { zoom: 16, bounds: [179, -80, 181, 80] });
    assert.ok(drawn.geometry.coordinates.length > 1);
    for (const path of drawn.geometry.coordinates) {
      for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i][0] - path[i - 1][0]) <= 180);
      for (const point of path.filter(p => Math.abs(p[0]) === 180)) {
        assert.ok(ruler.nearest(ruler.prepare([feature]), point).meters < .02);
      }
    }
  }
});

test('cancelled refinement cannot publish; caches retain live styles and replace source geometry', () => {
  const workers = [], publications = [];
  const api = refinement({ createWorker() {
    const worker = { terminate() { this.terminated = true; }, postMessage(data) { this.data = data; } };
    workers.push(worker); return worker;
  }, publish() { publications.push(api.getData(data)); } });
  let data = { features: [horizon()] };
  const a = viewport([0, 0], 18), b = viewport([1, 0], 18);
  api.request(data, a); api.cancel();
  workers[0].onmessage({ data: { geometries: [{ stale: true }] } });
  assert.equal(publications.length, 0);
  api.request(data, b);
  data.features[0].properties.color = 'updated-theme';
  workers[1].onmessage({ data: { geometries: [{ current: true }] } });
  assert.equal(publications.length, 1);
  assert.equal(publications[0].features[0].properties.color, 'updated-theme');
  api.cancel(); api.request(data, b);
  assert.equal(workers.length, 2);
  assert.equal(publications.length, 2);
  data = { features: [ray()] };
  api.request(data, b);
  assert.equal(api.getData(data), data);
  assert.equal(workers.length, 3);
  api.cancel();
});

test('moving lines reuse unchanged static meshes without starting a new refinement worker', () => {
  const workers = [];
  const api = refinement({ createWorker() {
    const worker = { terminate() {}, postMessage() {} };
    workers.push(worker); return worker;
  }, publish() {} });
  const staticLine = horizon();
  const secondStaticLine = horizon({ rotation: 30 });
  const initial = { features: [staticLine, ray(), secondStaticLine] };
  api.request(initial, viewport([0, 0], 18));
  const refinedStatic = { type: 'LineString', coordinates: [[2, 2], [3, 3]] };
  const refinedSecond = { type: 'LineString', coordinates: [[4, 4], [5, 5]] };
  workers[0].onmessage({ data: { geometries: [refinedStatic, null, refinedSecond] } });
  const next = { features: [staticLine, secondStaticLine, ray({ bearing: 90 })] };
  api.retainUnchanged(next);
  assert.equal(workers.length, 1);
  assert.equal(api.getData(next).features[0].geometry, refinedStatic);
  assert.equal(api.getData(next).features[1].geometry, refinedSecond);
  assert.equal(api.getData(next).features[2], next.features[2]);
});

test('the actual worker loads the browser GeographicLib bundle without a DOM', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const root = new URL('../../../Res/astrocart/', import.meta.url);
  const replies = [];
  const imports = [];
  const context = vm.createContext({ performance, console, URLSearchParams,
    location: { search: '?revision=test-runtime' }, postMessage: reply => replies.push(reply) });
  context.self = context;
  context.importScripts = (...paths) => paths.forEach(path => {
    imports.push(path);
    vm.runInContext(fs.readFileSync(new URL(path, root), 'utf8'), context);
  });
  vm.runInContext(fs.readFileSync(new URL('curve-worker.js', root), 'utf8'), context);
  context.onmessage({ data: { features: [ray()], view: viewport([13.4, 52.5], 18) } });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].error, undefined);
  assert.ok(replies[0].geometries[0].coordinates[0].length > 2);
  assert.deepEqual(imports, ['vendor/geographiclib-geodesic.js?revision=test-runtime',
    'curve-geometry.js?revision=test-runtime']);
});

test('closest-point convergence uses meters near a horizon turning point', () => {
  const feature = horizon();
  const model = curves.model(feature), index = ruler.prepare([feature]);
  for (const edge of [-67, 67]) {
    for (const offset of [1e-5, 1e-7, 1e-9]) {
      const point = model.at(edge - Math.sign(edge) * offset);
      assert.ok(ruler.nearest(index, point).meters < .02);
    }
  }
});

test('full-width paran parallels and exactly half-world chords preserve their drawn domain', () => {
  const parallel = { geometry: { type: 'LineString', coordinates: [[-180, 48], [180, 48]] } };
  const index = ruler.prepare([parallel]);
  for (const lon of [-179, -90, 0, 90, 179]) {
    assert.ok(ruler.nearest(index, [lon, 48]).meters < .02);
    const foot = ruler.nearest(index, [lon, 49]);
    assert.ok(Math.abs(foot.coordinate[0] - lon) < 1e-5);
  }
  const half = { geometry: { type: 'LineString', coordinates: [[0, 48], [180, 48]] } };
  assert.ok(ruler.nearest(ruler.prepare([half]), [90, 48]).meters < .02);
  assert.ok(ruler.nearest(ruler.prepare([half]), [-90, 48]).meters > 1000000);
});
