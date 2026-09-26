// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../../../Res/astrocart/map.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function applyPrintAtlasCities('), html.indexOf('function encodePrintCanvas('));

function capture(theme, offline = false, scope = 'world') {
  const screen = {
    sources: { geography: {}, acg: {}, labels: {} },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': theme } },
      { id: 'water', type: 'fill', source: 'geography', 'source-layer': 'water', filter: ['==', 'class', 'ocean'], paint: { 'fill-color': theme } },
      { id: 'boundaries-country', type: 'line', source: offline ? 'offline-world' : 'geography', paint: { 'line-color': theme } },
      { id: 'label_city', type: 'symbol', source: 'geography', minzoom: 2, layout: { visibility: 'visible', 'text-field': ['get', 'name'], 'text-size': 13 }, paint: { 'text-color': theme } },
      { id: 'acg-lines-solid', type: 'line', source: 'acg', filter: ['==', 'kind', 'MC'], paint: { 'line-color': '#d35488', 'line-width': 2.2 } },
    ],
  };
  const before = structuredClone(screen);
  const context = vm.createContext({
    map: { getStyle: () => screen },
    OFFLINE_WORLD_SOURCE_ID: 'offline-world',
    OFFLINE_PLACES_SOURCE_ID: 'offline-places',
    CITY_LABEL_LAYER_IDS: ['label_city', 'label_city_capital'],
    MINOR_PLACE_LABEL_LAYER_IDS: ['label_town', 'label_village'],
    SIMPLE_PLACE_NAME: ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name']],
    PRINT_ATLAS_LABEL_COLOR: '#202327',
    PRINT_ATLAS_OVERLAY_HALO: 'rgba(255,255,255,0.94)',
    URL, location: { href: 'http://localhost/astrocart/map.html' },
    ACG_SOURCE_ID: 'acg', ACG_LABEL_SOURCE_ID: 'labels',
    ASTERISM_SOURCE_ID: 'asterism', ECLIPSE_SOURCE_ID: 'eclipse',
    isColoredAtlasOverlayLayer: layer => layer.source === 'acg',
    grayscaleAtlasObjectColors: value => value,
    applyPrintAtlasOverlayContrast: () => {},
    applyPrintAtlasVisibility: () => {},
    printAtlasVisibilityState: value => value,
    applyPrintAtlasChips: () => {},
  });
  vm.runInContext(source, context);
  const result = context.activeStyleForPrintAtlas({}, { mapData: { type: 'FeatureCollection', features: [] } }, scope);
  assert.deepEqual(screen, before, 'export must not mutate the live style');
  return JSON.parse(JSON.stringify(result));
}

test('print geography is theme-independent while astrology colours, filters and label visibility survive', () => {
  const light = capture('#ffffff');
  assert.deepEqual(light, capture('#151515'));
  const line = light.layers.find(layer => layer.id === 'acg-lines-solid');
  assert.equal(line.paint['line-color'], '#d35488');
  assert.equal(line.paint['line-width'], 2.2);
  assert.deepEqual(line.filter, ['==', 'kind', 'MC']);
  assert.equal(light.layers.find(layer => layer.id === 'label_city').layout.visibility, 'none');
  const water = light.layers.find(layer => layer.id === 'water');
  const coast = light.layers.find(layer => layer.id === 'print-coastline');
  assert.equal(coast.source, water.source);
  assert.equal(coast['source-layer'], water['source-layer']);
  assert.deepEqual(coast.filter, water.filter);
  assert.ok(light.layers.findIndex(layer => layer.id === 'print-graticule') < light.layers.indexOf(line));
});

test('minimal offline outlines stay solid instead of becoming dashed political borders', () => {
  const border = capture('#ffffff', true).layers.find(layer => layer.id === 'boundaries-country');
  assert.equal(border.paint['line-dasharray'], undefined);
  assert.equal(border.paint['line-opacity'], 1);
});

// Exercise the sheet planner with the same Mercator implementation as the app.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const maplibregl = require('../../../Res/astrocart/vendor/maplibre-gl.js');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const planner = vm.createContext({
  maplibregl,
  selectedProjection: 'globe',
  map: {
    getCenter: () => ({ lng: 0, lat: 0 }),
    getProjection: () => ({ type: 'globe' }),
    getZoom: () => 1, getBearing: () => 0, getPitch: () => 0,
    transform: { width: 1200, height: 780 },
  },
});
vm.runInContext([
  section('const PRINT_ATLAS_LOGICAL_WIDTH', 'let BASE_VECTOR_STYLE'),
  section('function normalizedAtlasLongitude(', 'function renderPrintAtlasPolarOverlay('),
  section('function birthplaceCoordinates(', 'function applyBirthplaceMarkerLabel('),
  section('function printAtlasRegionalGrid(', 'function waitForPrintAtlasIdle('),
].join('\n'), planner);

function plannedPages(lon, lat, format = 'A4') {
  return JSON.parse(JSON.stringify(planner.printAtlasPageSpecs(format, { meta: { origin: { lon, lat } } })));
}
function sheetExtent(page) {
  const worldSize = 512 * 2 ** page.zoom;
  const center = maplibregl.MercatorCoordinate.fromLngLat(page.center);
  return { center, width: 1200 / worldSize, height: 780 / worldSize };
}
function contains(page, lon, lat) {
  const { center, width, height } = sheetExtent(page);
  const point = maplibregl.MercatorCoordinate.fromLngLat([lon, lat]);
  const dx = Math.abs(((point.x - center.x + 1.5) % 1) - 0.5);
  return dx <= width / 2 + 1e-9 && Math.abs(point.y - center.y) <= height / 2 + 1e-9;
}

test('six regional sheets cover the inhabited latitude band without gaps, including the dateline', () => {
  for (const [lon, lat] of [[13.4, 52.5], [-74, 40.7], [151.2, -33.9], [179.9, -17.7], [77, 19]]) {
    const pages = plannedPages(lon, lat);
    assert.equal(pages.length, 7);
    assert.deepEqual(pages[0].center, [planner.normalizedAtlasLongitude(lon), lat]);
    const sheets = pages.slice(1);
    assert.ok(contains(sheets[0], lon, lat), 'birthplace belongs to the first regional sheet');
    assert.equal(new Set(sheets.map(page => page.sheetId)).size, 6);
    assert.equal(new Set(sheets.map(page => page.zoom)).size, 1, 'consistent projected scale');
    for (let latitude = -60; latitude <= 75; latitude += 5) {
      for (let longitude = -180; longitude <= 180; longitude += 5) {
        assert.ok(sheets.some(page => contains(page, longitude, latitude)), `${longitude}, ${latitude} missing`);
      }
    }
    const first = sheetExtent(sheets[0]);
    const second = sheetExtent(sheets[1]);
    const verticalOverlap = 1 - Math.abs(first.center.y - second.center.y) / first.height;
    const horizontalOverlap = 1 - (1 / sheets[0].grid.columns) / first.width;
    assert.ok(verticalOverlap >= 0.10 - 1e-9);
    assert.ok(horizontalOverlap >= 0.10 - 1e-9);
    assert.equal(sheets[0].grid.column, sheets[1].grid.column);
    assert.notEqual(sheets[0].grid.row, sheets[1].grid.row);
  }
});

test('paper size changes resolution, while polar birthplaces extend the geographic coverage', () => {
  const a4 = plannedPages(20, 78, 'A4');
  const a3 = plannedPages(20, 78, 'A3');
  assert.ok(contains(a4[1], 20, 78));
  assert.ok(a3[1].targetWidth > a4[1].targetWidth);
  assert.deepEqual(a4.map(p => [p.center, p.zoom, p.sheetId]), a3.map(p => [p.center, p.zoom, p.sheetId]));
  assert.ok(contains(plannedPages(-60, -78)[1], -60, -78));
});

test('sheet references follow geographic neighbors despite birthplace-first reading order', () => {
  const pages = plannedPages(179, -34).slice(1);
  const fakeMap = {
    transform: { width: 1200, height: 780 },
    getBounds: () => ({ getWest: () => 100, getEast: () => 250, getSouth: () => -60, getNorth: () => 25 }),
    unproject: ([x]) => ({ lng: x / 10, lat: 0 }),
  };
  const directions = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (const page of pages) {
    const { neighbors } = planner.printAtlasPageMetadata(fakeMap, page);
    for (const [direction, id] of Object.entries(neighbors)) {
      if (!id) continue;
      const neighbor = pages.find(p => p.sheetId === id);
      assert.ok(neighbor, `missing neighbor ${id}`);
      const reciprocal = planner.printAtlasPageMetadata(fakeMap, neighbor).neighbors;
      assert.equal(reciprocal[directions[direction]], page.sheetId);
      if (direction === 'east' || direction === 'west') {
        const delta = planner.normalizedAtlasLongitude(neighbor.center[0] - page.center[0]);
        assert.ok(direction === 'east' ? delta > 0 : delta < 0);
      }
    }
  }
});


test('print cities use the bundled catalog, native collision spacing and astrology label priority', () => {
  const style = capture('#ffffff');
  const cities = style.layers.find(layer => layer.id === 'print-cities');
  assert.equal(style.sources[cities.source].data, 'http://localhost/astrocart/places.geojson');
  assert.equal(cities.layout['text-allow-overlap'], false);
  assert.equal(cities.layout['text-ignore-placement'], false);
  assert.ok(cities.layout['text-padding'] > 0);
  assert.ok(style.layers.indexOf(cities) < style.layers.findIndex(layer => layer.source === 'acg'));
  assert.equal(style.layers.find(layer => layer.id === 'label_city').layout.visibility, 'none');
});

test('print selection enables parans independently of hidden natal lines', () => {
  const context = vm.createContext({ viewOptions: { filters: {}, layers: {}, parans: false } });
  vm.runInContext([
    section('function normalizedVisibilitySelection(', 'function visibilitySelectionMatches('),
    section('function printAtlasVisibilityState(', 'function applyPrintAtlasVisibility('),
  ].join('\n'), context);
  const visible = context.printAtlasVisibilityState({ lineKinds: ['PARAN'], layerKinds: [], pointIds: ['sun', 'moon'] });
  assert.equal(visible.parans, true);
  assert.equal(visible.layers.natal, false);
  assert.equal(context.viewOptions.parans, false, 'export leaves the live view untouched');
  assert.equal(context.printAtlasVisibilityState({ lineKinds: ['MC'], layerKinds: ['natal'] }).parans, false);
});


test('current-map export preserves the full camera and viewport shape at print resolution', () => {
  const original = planner.map;
  try {
    for (const [width, height] of [[1440, 900], [700, 1200]]) {
      planner.map = {
        getCenter: () => ({ lng: 132, lat: -28 }),
        getProjection: () => ({ type: 'mercator' }),
        getZoom: () => 4.25, getBearing: () => 31, getPitch: () => 40,
        transform: { width, height },
      };
      const pages = planner.printAtlasPageSpecs('A3', { meta: { origin: { lon: 10, lat: 50 } } }, 'current');
      assert.equal(pages.length, 1);
      const page = pages[0];
      assert.deepEqual(Array.from(page.center), [132, -28]);
      assert.equal(page.projection, 'mercator');
      assert.equal(page.zoom, 4.25);
      assert.equal(page.bearing, 31);
      assert.equal(page.pitch, 40);
      assert.equal(page.logicalWidth, width);
      assert.equal(page.logicalHeight, height);
      assert.equal(Math.max(page.targetWidth, page.targetHeight), 4096);
      assert.ok(Math.abs(page.targetWidth / page.targetHeight - width / height) < 0.001);
    }
  } finally {
    planner.map = original;
  }
});


test('current-map export keeps visible provider place labels and their zoom rules', () => {
  const style = capture('#ffffff', false, 'current');
  const city = style.layers.find(layer => layer.id === 'label_city');
  assert.equal(city.layout.visibility, 'visible');
  assert.equal(city.minzoom, 2);
  assert.deepEqual(city.layout['text-field'], ['get', 'name']);
  assert.equal(city.layout['text-size'], 13);
  assert.equal(style.layers.some(layer => layer.id === 'print-cities'), false);
});
