// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const geometry = require('../../../Res/astrocart/ruler-geometry.js');
const feature = (coordinates) => ({ geometry: { type: 'LineString', coordinates } });
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`);

test('WGS84 distances use ellipsoidal meters', () => {
  close(geometry.distance([0, 0], [1, 0]), 111319.490793, 0.001);
  close(geometry.distance([0, 0], [0, 1]), 110574.388558, 0.001);
});

test('attachment slides along a meridian and minimizes geographic distance', () => {
  const segments = geometry.prepare([feature([[0, -70], [0, 70]])]);
  const target = [10, 45];
  const result = geometry.nearest(segments, target);
  close(result.coordinate[0], 0, 1e-9);
  close(result.coordinate[1], 45.44002, 0.00001);
  assert.ok(result.meters < geometry.distance([0, 45], target));
  for (const delta of [-0.001, 0.001]) {
    assert.ok(geometry.distance([0, result.coordinate[1] + delta], target) > result.meters);
  }
});

test('equatorial foot, finite endpoints, and points on the line', () => {
  const segments = geometry.prepare([feature([[-10, 0], [10, 0]])]);
  const foot = geometry.nearest(segments, [3, 5]);
  close(foot.coordinate[0], 3, 0.000002);
  close(foot.meters, geometry.distance([3, 0], [3, 5]), 0.001);
  close(geometry.nearest(segments, [20, 0]).coordinate[0], 10, 1e-9);
  assert.ok(geometry.nearest(segments, [0, 0]).meters < 0.2);
});

test('dateline segments and separate branches do not connect through Greenwich', () => {
  const segments = geometry.prepare([{ geometry: { type: 'MultiLineString', coordinates: [
    [[170, 0], [180, 0]], [[-180, 0], [-170, 0]],
  ] } }]);
  const result = geometry.nearest(segments, [-179, 2]);
  close(result.coordinate[0], -179, 0.000002);
  close(result.meters, geometry.distance([-179, 0], [-179, 2]), 0.001);
  assert.ok(geometry.nearest(segments, [0, 0]).meters > 18000000);
});

test('pole crossings, duplicate vertices, and empty geometry stay finite', () => {
  const segments = geometry.prepare([{ ...feature([[0, 85], [180, 85], [180, 85]]),
    properties: { curve: { type: 'geodesic', origin: [0, 85], bearing: 0, domain: [0, 1200000] } },
  }]);
  assert.ok(geometry.nearest(segments, [90, 90]).meters < 0.2);
  assert.equal(geometry.nearest([], [0, 0]), null);
  const result = geometry.nearest(segments, [90, 89]);
  assert.ok(Number.isFinite(result.meters));
  assert.ok(geometry.connector(result.coordinate, [90, 89]).flat().every(Number.isFinite));
});

test('unit changes format the same meter result without recalculating geometry', () => {
  assert.match(geometry.formatDistance(1609.344, 'miles', 'en'), /1 mi/);
  assert.match(geometry.formatDistance(1609.344, 'metric', 'en'), /1.6 km/);
  assert.match(geometry.formatDistance(100, 'metric', 'en'), /100 m/);
  assert.match(geometry.formatDistance(0.3048, 'miles', 'en'), /1 ft/);
});

function harness({ enabled = true, kind = 'MC' } = {}) {
  const element = () => ({
    listeners: {}, style: { setProperty() {} }, children: [], attributes: {},
    classList: {
      values: new Set(),
      toggle(name, force) {
        const add = force === undefined ? !this.values.has(name) : !!force;
        if (add) this.values.add(name); else this.values.delete(name);
        return add;
      },
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); },
      contains(name) { return this.values.has(name); },
    },
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    setPointerCapture() {}, releasePointerCapture() {},
  });
  const host = element(), canvas = element(), document = element();
  document.createElement = document.createElementNS = element;
  const window = element();
  const jobs = new Map();
  const timers = new Map();
  let now = 0, nextTimerId = 0;
  window.setTimeout = (fn, delay) => {
    const id = ++nextTimerId; timers.set(id, { fn, at: now + delay }); return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  let nextId = 0, calculations = 0, preparations = 0, pan = true, zoom = true, hit = true;
  let mapZoom = 4;
  window.AriesRulerGeometry = { ...geometry, prepare(...args) {
    preparations++; return geometry.prepare(...args);
  }, nearest(...args) {
    calculations++; return geometry.nearest(...args);
  } };
  const changes = [];
  const context = { window, document, console,
    requestAnimationFrame(fn) { const id = ++nextId; jobs.set(id, fn); return id; },
    cancelAnimationFrame(id) { jobs.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../../Res/astrocart/ruler.js', import.meta.url), 'utf8'), context);
  let projection = ([lon, lat]) => ({ x: 500 + lon * 5, y: 300 - lat * 3, longitude: lon });
  const project = (coordinate) => projection(coordinate);
  const mapEvents = {};
  const map = {
    getContainer: () => host, getCanvas: () => canvas, transform: { width: 1000, height: 600 },
    getZoom: () => mapZoom,
    unproject: ({ x, y }) => ({ lng: (x - 500) / 5, lat: (300 - y) / 3 }), on(type, handler) { mapEvents[type] = handler; },
    dragPan: { isEnabled: () => pan, enable: () => { pan = true; }, disable: () => { pan = false; } },
    doubleClickZoom: { isEnabled: () => zoom, enable: () => { zoom = true; }, disable: () => { zoom = false; } },
  };
  const selected = { features: [{
    ...feature([[0, -70], [0, 70]]), properties: { kind },
  }] };
  const ruler = window.createAriesMapRuler({ map, project, pick: () => hit ? selected : null,
    resolve: () => selected, onEnabledChange: (value) => changes.push(value) });
  const event = (type, x = 500, y = 300, target = canvas, overrides = {}) => {
    const e = { type, target, button: 0, pointerId: 1, clientX: x, clientY: y, key: 'Escape', ...overrides,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.propagationStopped = true; } };
    for (const handler of (type === 'keydown' ? document : type === 'blur' ? window : host).listeners[type] || []) handler(e);
    return e;
  };
  const flush = () => { const pending = [...jobs.values()]; jobs.clear(); pending.forEach((fn) => fn()); };
  ruler.configure({ enabled, ready: true, units: 'metric', locale: 'en' });
  return { ruler, event, flush, jobs, timers, host, changes,
    mapClick(x = 500, y = 300, overrides = {}) {
      mapEvents.click({ point: { x, y }, originalEvent: { target: canvas, button: 0, ...overrides } });
    },
    mapDragStart() { mapEvents.dragstart(); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    setProjection(fn) { projection = fn; }, render() { mapEvents.render(); },
    calculations: () => calculations, preparations: () => preparations,
    setHit(value) { hit = value; }, setZoom(value) { mapZoom = value; },
    pan: () => pan, zoom: () => zoom };
}

test('an empty map click dismisses a dragged ruler, but its release and line clicks do not', () => {
  const h = harness({ enabled: false });
  h.event('pointerdown'); h.advance(160); h.event('pointermove', 550); h.event('pointerup', 550);
  h.setHit(false);
  assert.equal(h.event('click', 550).propagationStopped, true);
  assert.equal(h.ruler.enabled, true);
  h.mapClick(550); // Existing endpoint remains selectable.
  assert.equal(h.ruler.enabled, true);
  h.setHit(true); h.mapClick(500);
  assert.equal(h.ruler.enabled, true);
  h.setHit(false);
  h.event('pointerdown', 700); h.event('pointermove', 740); h.event('pointerup', 740);
  assert.equal(h.ruler.enabled, true); // Panning does not emit a MapLibre click.
  h.mapClick(700, 300, { shiftKey: true });
  assert.equal(h.ruler.enabled, true);
  h.mapClick(700);
  assert.equal(h.ruler.enabled, false);
  assert.deepEqual(h.changes, [true, false]);
  assert.equal(h.host.children[0].style.display, 'none');
  assert.equal(h.pan(), true);
});

test('a pointer burst coalesces to one solve per frame and restores camera controls', () => {
  const h = harness();
  h.event('pointerdown');
  for (let i = 0; i < 40; i++) h.event('pointermove', 510 + i);
  assert.equal(h.jobs.size, 1);
  assert.equal(h.calculations(), 0);
  assert.equal(h.pan(), false);
  h.flush();
  assert.equal(h.calculations(), 1);
  assert.match(h.host.children[1].textContent, /km/);
  h.event('pointerup', 550);
  assert.equal(h.pan(), true);
  assert.equal(h.jobs.size, 0);
  const count = h.calculations();
  h.ruler.configure({ units: 'miles' });
  assert.match(h.host.children[1].textContent, /mi/);
  assert.equal(h.calculations(), count);
  h.event('keydown');
  assert.equal(h.ruler.enabled, false);
  assert.deepEqual(h.changes, [false]);
});

test('hidden retained maps cancel pending solves and preserve completed rulers', () => {
  const h = harness();
  h.event('pointerdown'); h.event('pointermove', 550); h.flush();
  h.event('pointermove', 560);
  const count = h.calculations();
  h.ruler.setActive(false);
  h.flush();
  assert.equal(h.calculations(), count);
  assert.equal(h.jobs.size, 0);
  assert.equal(h.pan(), true);
  h.ruler.setActive(true);
  assert.equal(h.host.children[0].style.display, '');
});

test('ruler mode leaves search, legend, and map controls interactive', () => {
  const h = harness();
  h.event('pointerdown', 500, 300, { tagName: 'INPUT' });
  assert.equal(h.jobs.size, 0);
  assert.equal(h.pan(), true);
});

test('zoom retains ruler segments with one or both endpoints outside the viewport', () => {
  const h = harness();
  h.event('pointerdown'); h.event('pointermove', 550); h.event('pointerup', 550);
  const calculations = h.calculations();
  const svg = h.host.children[0], label = h.host.children[1];
  const distance = label.textContent;
  for (const offset of [500, -500]) {
    h.setProjection(([lon, lat]) => ({ x: offset + lon * 2000, y: 300 - lat * 3, longitude: lon }));
    h.render();
    const commands = [...svg.children[1].attributes.d.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)]
      .map(([, op, x, y]) => ({ op, x: Number(x), y: Number(y) }));
    assert.ok(commands.some((point, i) => i && point.op === 'L' &&
      commands[i - 1].x < 1000 && point.x > 0 && Math.abs(point.x - commands[i - 1].x) > 500));
    assert.ok(Number(svg.children[3].attributes.cx) > 1000, 'free endpoint is offscreen');
    if (offset < 0) assert.ok(Number(svg.children[2].attributes.cx) < 0, 'both endpoints are offscreen');
    assert.equal(label.textContent, distance);
  }
  assert.equal(h.calculations(), calculations, 'camera redraws never solve distance again');
});

test('true longitude-wrap seams still break the ruler instead of drawing across the map', () => {
  const h = harness();
  h.event('pointerdown'); h.event('pointermove', 550); h.event('pointerup', 550);
  h.setProjection(([lon, lat]) => {
    const longitude = lon > 5 ? lon - 360 : lon;
    return { x: longitude, y: lat, longitude };
  });
  h.render();
  const d = h.host.children[0].children[1].attributes.d;
  assert.equal((d.match(/M/g) || []).length, 2);
  assert.match(d, /L/);
});

test('a short line click passes through to the existing flag without enabling or solving the ruler', () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    assert.equal(h.event('pointerdown').defaultPrevented, undefined);
    assert.equal(h.pan(), !enabled);
    assert.equal(h.event('mousedown').propagationStopped, undefined);
    assert.equal(h.event('pointermove', 503, 302).defaultPrevented, undefined);
    assert.equal(h.event('pointerup', 503, 302).defaultPrevented, undefined);
    assert.equal(h.event('mouseup', 503, 302).propagationStopped, undefined);
    assert.equal(h.event('click', 503, 302).propagationStopped, undefined);
    assert.equal(h.ruler.enabled, enabled);
    assert.equal(h.pan(), true);
    assert.equal(h.zoom(), true);
    assert.equal(h.preparations(), 0);
    assert.equal(h.calculations(), 0);
    assert.equal(h.jobs.size, 0);
    assert.deepEqual(h.changes, []);
  }
});

test('holding a line before dragging enables the ruler once and consumes the trailing flag click', () => {
  const h = harness({ enabled: false });
  h.event('pointerdown'); h.event('mousedown');
  h.event('pointermove', 504);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.host.classList.contains('acg-ruler-enabled'), false);
  assert.equal(h.jobs.size, 0);
  h.advance(160);
  assert.equal(h.host.classList.contains('acg-ruler-enabled'), true);
  assert.equal(h.event('pointermove', 506).defaultPrevented, true);
  for (let i = 0; i < 30; i++) h.event('pointermove', 507 + i);
  assert.equal(h.preparations(), 1);
  assert.equal(h.jobs.size, 1);
  assert.equal(h.calculations(), 0);
  assert.deepEqual(h.changes, [true]);
  assert.equal(h.zoom(), false);
  h.flush();
  assert.equal(h.calculations(), 1);
  h.event('pointerup', 540);
  assert.equal(h.pan(), true);
  assert.equal(h.zoom(), true);
  assert.equal(h.event('click', 540).propagationStopped, true);
  assert.equal(h.ruler.enabled, true);
  // A subsequent ordinary line click must open its flag again.
  h.event('pointerdown'); h.event('mousedown'); h.event('pointerup');
  assert.equal(h.event('click').propagationStopped, undefined);
});

test('parans require a longer hold while fast drags remain map navigation', () => {
  const h = harness({ enabled: false, kind: 'PARAN' });
  h.event('pointerdown'); h.event('mousedown');
  h.advance(80);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.event('pointermove', 510);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.event('pointerup', 510);

  h.event('pointerdown'); h.event('mousedown');
  h.mapDragStart();
  assert.equal(h.timers.size, 0);
  h.advance(500);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.event('pointerup');

  h.event('pointerdown'); h.event('mousedown');
  h.advance(179);
  assert.equal(h.ruler.enabled, false);
  h.advance(1);
  assert.equal(h.ruler.enabled, true);
  assert.equal(h.pan(), false);
  h.event('pointermove', 550); h.event('pointerup', 550);
  assert.equal(h.pan(), true);

  h.event('pointerdown');
  assert.equal(h.pan(), true, 'automatic ruler display leaves the next map drag available');
  h.event('pointermove', 550); h.event('pointerup', 550);
  assert.equal(h.pan(), true);
});

test('world-view paran holds give panning more time and never reserve later drags automatically', () => {
  const h = harness({ enabled: false, kind: 'PARAN' });
  h.setZoom(1.5);
  h.event('pointerdown');
  h.advance(319);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.advance(1);
  assert.equal(h.ruler.enabled, true);
  assert.equal(h.pan(), false);
  h.event('pointermove', 550); h.event('pointerup', 550);
  assert.equal(h.pan(), true);
  assert.equal(h.host.classList.contains('acg-ruler-gesture'), false);
  assert.equal(h.host.classList.contains('acg-ruler-explicit'), false);

  h.event('pointerdown');
  assert.equal(h.pan(), true, 'a visible automatic ruler must not claim the next pan');
  h.event('pointermove', 550);
  assert.equal(h.timers.size, 0);
  assert.equal(h.pan(), true);
  h.event('pointerup', 550);
  assert.equal(h.pan(), true);
  assert.equal(h.ruler.enabled, true);
});

test('world-view planetary lines leave a longer pan window than detailed views', () => {
  const h = harness({ enabled: false });
  h.setZoom(2);
  h.event('pointerdown');
  h.advance(200);
  h.event('pointermove', 510);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.event('pointerup', 510);

  h.event('pointerdown');
  h.advance(259);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.pan(), true);
  h.advance(1);
  assert.equal(h.ruler.enabled, true);
  h.event('pointermove', 550); h.event('pointerup', 550);
  assert.equal(h.pan(), true);
});

test('an automatic ruler leaves the map free but its endpoint remains directly draggable', () => {
  const h = harness({ enabled: false, kind: 'PARAN' });
  h.event('pointerdown'); h.advance(180);
  h.event('pointermove', 550); h.event('pointerup', 550);
  assert.equal(h.pan(), true);

  h.event('pointerdown', 550);
  assert.equal(h.pan(), false, 'the existing endpoint is an explicit adjustment target');
  h.event('pointermove', 580); h.event('pointerup', 580);
  assert.equal(h.pan(), true);
  assert.equal(h.ruler.enabled, true);
});

test('paran hover gives an immediate crosshair cue and map motion clears it', () => {
  const h = harness({ enabled: false, kind: 'PARAN' });
  const cursorClass = 'acg-ruler-hover-paran';
  h.ruler.setParanHover(true);
  assert.equal(h.host.classList.contains(cursorClass), true);
  assert.equal(h.ruler.enabled, false);
  h.ruler.setParanHover(false);
  assert.equal(h.host.classList.contains(cursorClass), false);
  h.ruler.setParanHover(true);
  h.mapDragStart();
  assert.equal(h.host.classList.contains(cursorClass), false);
  h.ruler.setParanHover(true);
  h.ruler.setActive(false);
  assert.equal(h.host.classList.contains(cursorClass), false);

  const html = fs.readFileSync(new URL('../../../Res/astrocart/map.html', import.meta.url), 'utf8');
  assert.match(html, /\.acg-ruler-hover-paran \.maplibregl-canvas/);
  assert.match(html, /\.acg-ruler-gesture \.maplibregl-canvas/);
  assert.match(html, /map\.on\('mouseenter', 'acg-parans', \(\) => mapRuler\?\.setParanHover\(true\)\)/);
  assert.match(html, /map\.on\('mouseleave', 'acg-parans', \(\) => mapRuler\?\.setParanHover\(false\)\)/);
});

test('paran measurement requires a closer hit than ordinary map lines', () => {
  const html = fs.readFileSync(new URL('../../../Res/astrocart/map.html', import.meta.url), 'utf8');
  const start = html.indexOf('  function pickRulerLine(point, { direct = false } = {}) {');
  const end = html.indexOf('  function onLineClick(e) {', start);
  assert.ok(start >= 0 && end > start);
  let distance = 5;
  let kind = 'PARAN';
  let zoom = 4;
  const queriedLayers = [];
  const map = {
    getStyle: () => ({ layers: [
      { id: 'acg-casing', source: 'acg', type: 'line' },
      { id: 'lines', source: 'acg', type: 'line' },
    ] }),
    getProjection: () => ({ type: 'mercator' }),
    getZoom: () => zoom,
    queryRenderedFeatures: ([[left], [right]], { layers }) => {
      queriedLayers.push(layers);
      return distance <= (right - left) / 2
        ? [{ source: 'acg', properties: { kind } }]
        : [];
    },
  };
  const pick = vm.runInNewContext(
    `${html.slice(start, end)}\npickRulerLine`,
    {
      map,
      rulerCollections: () => [['acg', {}]],
      rulerLineKey: (_source, item) => item.properties.kind,
      resolveRulerLine: (selection) => ({ ...selection, features: [{}] }),
    },
  );
  assert.equal(pick({ x: 500, y: 300 }), null);
  distance = 2;
  assert.equal(pick({ x: 500, y: 300 }).key, 'PARAN');
  zoom = 2;
  assert.equal(pick({ x: 500, y: 300 }), null, 'world-view parans need an exact hit');
  distance = 0.5;
  assert.equal(pick({ x: 500, y: 300 }).key, 'PARAN');
  kind = 'MC';
  distance = 2.5;
  zoom = 4;
  assert.equal(pick({ x: 500, y: 300 }).key, 'MC');
  zoom = 2;
  assert.equal(pick({ x: 500, y: 300 }), null, 'world-view planets need a closer hit');
  distance = 0.5;
  assert.equal(pick({ x: 500, y: 300 }).key, 'MC');
  distance = 5;
  assert.equal(pick({ x: 500, y: 300 }, { direct: true }).key, 'MC');
  assert.equal(queriedLayers.at(-1).includes('acg-casing'), true);
  pick({ x: 500, y: 300 });
  assert.equal(queriedLayers.at(-1).includes('acg-casing'), false,
    'decorative casing cannot enlarge the automatic line target');
});

test('paran visibility changes only the retained layer layout', () => {
  const html = fs.readFileSync(new URL('../../../Res/astrocart/map.html', import.meta.url), 'utf8');
  const start = html.indexOf('  function syncParanVisibility() {');
  const end = html.indexOf('  function setParansVisible(visible) {', start);
  assert.ok(start >= 0 && end > start);
  const visible = new Map([['acg-parans', 'none'], ['acg-paran-labels', 'none']]);
  const changed = [];
  const map = {
    getLayer: () => true,
    getLayoutProperty: (id) => visible.get(id),
    setLayoutProperty(id, property, value) {
      assert.equal(property, 'visibility');
      visible.set(id, value);
      changed.push(id);
    },
    setFilter() { assert.fail('a visibility toggle must not reparse map filters'); },
  };
  const button = { classList: { toggle() {} }, setAttribute() {} };
  const sync = vm.runInNewContext(`${html.slice(start, end)}\nsyncParanVisibility`, {
    viewOptions: { parans: true }, map,
    currentDevSettings: () => ({ paranLabelsOn: true }),
    document: { querySelector: () => button },
    scheduleDomAcgLabels() {},
  });
  sync();
  assert.deepEqual(changed, ['acg-parans', 'acg-paran-labels']);
  sync();
  assert.equal(changed.length, 2, 'replaying the same state must not relayout layers');
});

test('repeated line holds always restore map panning after measurement', () => {
  const h = harness({ enabled: false });
  for (let attempt = 0; attempt < 3; attempt++) {
    h.event('pointerdown');
    assert.equal(h.pan(), true);
    h.event('mousedown');
    h.advance(160);
    assert.equal(h.pan(), false);
    h.event('pointermove', 550);
    h.event('pointerup', 550);
    assert.equal(h.pan(), true, `map panning must recover after hold ${attempt + 1}`);
    h.event('click', 550);
  }
  h.setHit(false);
  h.event('pointerdown', 700);
  assert.equal(h.event('mousedown', 700).propagationStopped, undefined);
  assert.equal(h.event('pointermove', 750).defaultPrevented, undefined);
  h.event('pointerup', 750);
  assert.equal(h.pan(), true);
});

test('background drags and modified camera gestures are left to MapLibre', () => {
  const h = harness({ enabled: false });
  h.setHit(false);
  assert.equal(h.event('pointerdown').defaultPrevented, undefined);
  assert.equal(h.pan(), true);
  h.event('pointermove', 550); h.event('pointerup', 550);
  h.setHit(true);
  for (const overrides of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { pointerType: 'touch' }]) {
    assert.equal(h.event('pointerdown', 500, 300, undefined, overrides).defaultPrevented, undefined);
    assert.equal(h.pan(), true);
    h.event('pointerup');
  }
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.preparations(), 0);
});

test('cancelled pending line gestures restore navigation without doing geometry work', () => {
  for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur', 'hide', 'keydown']) {
    const h = harness({ enabled: false });
    h.event('pointerdown');
    assert.equal(h.pan(), true);
    if (cancellation === 'hide') h.ruler.setActive(false); else h.event(cancellation);
    assert.equal(h.pan(), true);
    assert.equal(h.zoom(), true);
    assert.equal(h.preparations(), 0);
    assert.equal(h.jobs.size, 0);
    assert.equal(h.ruler.enabled, false);
    assert.equal(h.timers.size, 0);
    h.advance(500);
    assert.equal(h.ruler.enabled, false);
  }
});

test('holding a line starts the ruler without requiring pointer movement', () => {
  const h = harness({ enabled: false });
  h.event('pointerdown'); h.event('mousedown');
  h.advance(159);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.preparations(), 0);
  h.advance(1);
  assert.equal(h.ruler.enabled, true);
  assert.deepEqual(h.changes, [true]);
  assert.equal(h.preparations(), 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.jobs.size, 1);
  h.flush();
  assert.equal(h.host.children[0].style.display, '');
  assert.match(h.host.children[1].textContent, /m/);
  h.event('pointermove', 550); h.flush(); h.event('pointerup', 550);
  assert.equal(h.pan(), true);
  assert.equal(h.event('click', 550).propagationStopped, true);
  assert.deepEqual(h.changes, [true]);
});

test('quick clicks cancel the hold trigger and dragging never activates twice', () => {
  const h = harness({ enabled: false });
  h.event('pointerdown'); h.advance(50); h.event('pointerup');
  assert.equal(h.event('click').propagationStopped, undefined);
  h.advance(500);
  assert.equal(h.ruler.enabled, false);
  assert.equal(h.preparations(), 0);
  h.event('pointerdown'); h.event('pointermove', 510);
  assert.equal(h.timers.size, 0);
  h.advance(500);
  assert.deepEqual(h.changes, []);
  assert.equal(h.preparations(), 0);
  assert.equal(h.pan(), true);
  h.event('pointerup', 510);
});
