// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compositionModuleUrl } from "./wheel-composition-test-loader.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions }).outputText.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`).replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}

async function loadDrawChart() {
  const overlayLinesUrl = dataUrl(transpile(
    await readSource(new URL("../src/lib/chart/chart-overlay-lines.ts", import.meta.url)),
  ));
  const chartFontsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
    ),
  );
  const canvasDrawUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url)),
    ).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`),
  );
  const layoutModelUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url),
      ),
    ),
  );
  const wheelStyleUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
      ),
    ).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`),
  );
  const wheelStyle = await import(wheelStyleUrl);
  const pdRingPresentationUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/pd-ring-presentation.ts", import.meta.url),
      ),
    ),
  );
  const pdEventPresentationUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/pd-event-presentation.ts", import.meta.url),
      ),
    ),
  );
  const glyphsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/glyphs.ts", import.meta.url)),
    ),
  );
  const ditherPatternUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/render/dither-pattern.ts", import.meta.url),
      ),
    ),
  );
  const outerGlyphLaneUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/outer-glyph-lane.ts", import.meta.url),
      ),
    ),
  );
  const wheelProjectionUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-projection.ts", import.meta.url),
      ),
    ),
  );
  const drawChartJavascript = transpile(
    await readSource(new URL("../src/lib/chart/draw-chart.ts", import.meta.url)),
  )
    .replaceAll('"./chart-overlay-lines"', `"${overlayLinesUrl}"`)
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./wheel-projection"', `"${wheelProjectionUrl}"`)
    .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`)
    .replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`)
    .replaceAll('"./pd-ring-presentation"', `"${pdRingPresentationUrl}"`)
    .replaceAll('"./pd-event-presentation"', `"${pdEventPresentationUrl}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"./outer-glyph-lane"', `"${outerGlyphLaneUrl}"`)
    .replaceAll('"../render/dither-pattern"', `"${ditherPatternUrl}"`);
  const multiwheelJavascript = transpile(
    await readSource(new URL("../src/lib/chart/multiwheel-render-style.ts", import.meta.url)),
  )
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`);
  return {
    ...(await import(dataUrl(multiwheelJavascript))),
    ...(await import(dataUrl(drawChartJavascript + "\nexport { aspectEndpointLongitude, resolveAspectsForDraw, resolveInterChartAspectsForDraw, drawAscMC };"))),
    DEFAULT_WHEEL_RENDER_STYLE: wheelStyle.DEFAULT_WHEEL_RENDER_STYLE,
    createTokenizedWheelRenderStyle: wheelStyle.createTokenizedWheelRenderStyle,
    CanvasDraw: (await import(canvasDrawUrl)).CanvasDraw,
  };
}

const drawChart = await loadDrawChart();

function chartFixture() {
  return {
    planets: [],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: {
      cusps: Array.from({ length: 12 }, (_, index) => index * 30),
    },
    aspects: [],
    options: {
      theme: 0,
      signVariant: 0,
      showHouses: false,
      showPositions: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: false,
    },
  };
}

test("all four classic angles expose the painted ray and endpoint disc", () => {
  const snapshot = {
    primaryChart: chartFixture(),
    displayDatetime: "2026-07-24T00:00:00+02:00",
    renderVariant: "round-classic",
    overlayRenderMode: "full",
    outerRingMode: "none",
  };
  const regions = drawChart.computeHitRegions(snapshot, {
    width: 800,
    height: 800,
    chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
    textsize: () => [12, 12],
  });
  const angles = regions.filter((region) => region.kind === "angle");

  assert.deepEqual(
    angles.map((region) => region.angleId).sort(),
    ["asc", "dsc", "ic", "mc"],
  );
  for (const region of angles) {
    assert.equal(region.shape, "line");
    assert.ok(Number.isFinite(region.x1));
    assert.ok(Number.isFinite(region.y1));
    assert.ok(Number.isFinite(region.x2));
    assert.ok(Number.isFinite(region.y2));
    const midpointX = (region.x1 + region.x2) / 2;
    const midpointY = (region.y1 + region.y2) / 2;
    assert.equal(drawChart.findHitRegion([region], midpointX, midpointY), region);
    assert.equal(drawChart.findHitRegion([region], region.x + region.r * 0.9, region.y), region);
  }
});

test("a point outside both the angle ray tolerance and endpoint disc misses", () => {
  const region = {
    kind: "angle",
    angleId: "dsc",
    x: 100,
    y: 0,
    r: 10,
    longitude: 180,
    shape: "line",
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    tolerance: 6,
    priority: 30,
  };

  assert.equal(drawChart.findHitRegion([region], 50, 7), null);
  assert.equal(drawChart.findHitRegion([region], 111, 0), null);
});

for (const [theme, variant] of [[0, 'classic'], [1, 'compact'], [2, 'anglo'], [3, 'houses'], [4, 'cusps']]) {
  for (const comparison of [false, true]) {
    test(`${variant} cusp strokes select their actual source (${comparison ? 'comparison' : 'single'})`, () => {
      const primary = chartFixture();
      primary.options = { ...primary.options, theme, showHouses: true, showOuterHouseLines: true };
      // Angular cusps need not coincide with the angles (e.g. whole-sign).
      primary.houses.cusps = primary.houses.cusps.map(lon => lon + 7);
      const outer = structuredClone(primary);
      outer.houses.cusps = outer.houses.cusps.map(lon => lon + 11);
      const snapshot = {
        primaryChart: primary, comparisonChart: comparison ? outer : undefined,
        renderVariant: `round-${variant}`, overlayRenderMode: 'full', outerRingMode: 'none',
      };
      const opts = { width: 800, height: 800, chartSize: 800,
        renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize: () => [12, 12] };
      const regions = drawChart.computeHitRegions(snapshot, opts);
      const cusps = regions.filter(r => r.kind === 'cusp');
      assert.deepEqual([...new Set(cusps.filter(r => r.chartRole === 'primary').map(r => r.houseIndex))].sort((a,b)=>a-b),
        Array.from({length:12}, (_,i)=>i+1));
      assert.equal(cusps.filter(r => r.chartRole === 'outer').length, comparison ? 12 : 0);
      for (const region of cusps) {
        const source = region.chartRole === 'outer' ? outer : primary;
        assert.equal(region.longitude, source.houses.cusps[region.houseIndex - 1]);
        assert.equal(drawChart.aspectEndpointLongitude(source, new Map(), `cusp${region.houseIndex}`), region.longitude);
        const x = (region.x1 + region.x2) / 2;
        const y = (region.y1 + region.y2) / 2;
        assert.equal(drawChart.findHitRegion([region], x, y), region);
        assert.equal(drawChart.findHitRegion([region], x + 1000, y + 1000), null);
      }
      primary.options.showOuterHouseLines = false;
      assert.equal(drawChart.computeHitRegions(snapshot, opts).filter(r => r.kind === 'cusp' && r.chartRole === 'outer').length, 0);
      primary.options.showHouses = false;
      assert.equal(drawChart.computeHitRegions(snapshot, opts).filter(r => r.kind === 'cusp').length, 0);
    });
  }
}

test('cusp click selectors retain chart identity, filters, hide-all and reset behavior', () => {
  const chart = chartFixture();
  const normal = { p1: 'sun', p2: 'moon', type: 5, orb: 0 };
  chart.aspects = [normal];
  chart.clickAspectFlags = { exclusiveOnClick: true };
  chart.bodyAspects = { cusp2: [
    {other: 'sun', type: 5, orb: 1, maxOrb: 7, showsOnClick: true},
    {other: 'moon', type: 1, orb: 0, showsOnClick: false},
  ] };
  const selected = { selectedBody: 'cusp2', hideAll: false };
  assert.equal(drawChart.resolveAspectsForDraw(chart, selected).length, 1);
  assert.equal(drawChart.resolveAspectsForDraw(chart, selected)[0].p1, 'cusp2');
  assert.deepEqual(drawChart.resolveAspectsForDraw(chart, {...selected, selectedBody: null}), [normal]);
  assert.equal(drawChart.resolveAspectsForDraw(chart, {...selected, hideAll: true}), null);
  const inner = { inner: 'cusp2', outer: 'sun', type: 5, showsOnClick: true, showsNormally: false };
  const outer = { inner: 'moon', outer: 'cusp2', type: 3, showsOnClick: true, showsNormally: false };
  const map = { cusp2: [inner], 'outer:cusp2': [outer] };
  assert.deepEqual(drawChart.resolveInterChartAspectsForDraw(chart, [inner, outer], map, selected), [inner]);
  assert.deepEqual(drawChart.resolveInterChartAspectsForDraw(chart, [inner, outer], map,
    {...selected, selectedBody: 'outer:cusp2'}), [outer]);
  chart.clickAspectFlags.exclusiveOnClick = false;
  assert.deepEqual(drawChart.resolveAspectsForDraw(chart, selected), [normal]);
  assert.deepEqual(drawChart.resolveInterChartAspectsForDraw(chart, [inner, outer], map, selected), []);
});

test('routed cusp targets follow painted segments and preserve angle priority', () => {
  const primary = chartFixture();
  primary.meta = { datetime: '', dateDisplay: '', timeDisplay: '', place: '', placeCoords: '' };
  primary.options = { ...primary.options, theme: 2, showHouses: true, showPositions: true };
  primary.planets = ['sun', 'moon', 'mercury', 'venus'].map((id, index) => ({
    id, seId: index, longitude: 29.7 + index * 0.2, latitude: 0, speed: 1,
    glyph: String.fromCharCode(65 + index), degText: '29', minText: '59',
  }));
  const snapshot = { primaryChart: primary, renderVariant: 'round-anglo', outerRingMode: 'none', overlayRenderMode: 'full' };
  const lines = [];
  const draw = new Proxy({
    ctx: new Proxy({}, { get: () => () => undefined }),
    line: (points) => lines.push(points), textsize: () => [12, 12],
    measure: (_name, operation) => operation(),
  }, { get: (target, property) => target[property] ?? (() => undefined) });
  const opts = { width: 800, height: 800, chartSize: 800, renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
    textsize: () => [12, 12] };
  drawChart.drawSnapshotLayer(draw, snapshot, 'geometry', opts);
  const regions = drawChart.computeHitRegions(snapshot, opts);
  const cusps = regions.filter(r => r.kind === 'cusp');
  assert.ok(cusps.length > 0);
  const paintedSegments = lines.flatMap(points => points.slice(1).map((end, index) => [points[index], end]));
  for (const hit of cusps) {
    assert.ok(paintedSegments.some(([a,b]) => a[0] === hit.x1 && a[1] === hit.y1 && b[0] === hit.x2 && b[1] === hit.y2),
      `cusp ${hit.houseIndex} must follow a real painted segment`);
  }
  const axis = regions.find(r => r.kind === 'angle' && r.shape === 'line');
  assert.ok(axis);
  const coincidentCusp = {...axis, kind: 'cusp', houseIndex: 1, priority: cusps[0].priority};
  assert.equal(drawChart.findHitRegion([coincidentCusp, axis], (axis.x1 + axis.x2)/2, (axis.y1 + axis.y2)/2), axis);
});

test('traditional converse keeps cusp identity with the primary house framework', () => {
  const primary = chartFixture();
  primary.options.showHouses = true;
  const snapshot = { primaryChart: primary, comparisonChart: structuredClone(primary),
    renderVariant: 'round-classic', outerRingMode: 'none', overlayRenderMode: 'full',
    document: {pdInChartFrame: 'traditional-converse'} };
  const regions = drawChart.computeHitRegions(snapshot, { width:800, height:800, chartSize:800,
    renderStyle:drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize:()=>[12,12] });
  assert.equal(regions.filter(r => r.kind === 'cusp' && r.chartRole === 'primary').length, 12);
  assert.equal(regions.filter(r => r.kind === 'cusp' && r.chartRole === 'outer').length, 0);
});

function positionLabelFixture(theme, showPositions) {
  const chart = chartFixture();
  chart.meta = { name: '', datetime: '', dateDisplay: '', timeDisplay: '', place: '', placeCoords: '' };
  chart.options = { ...chart.options, theme, showPositions, showHouses: true };
  chart.planets = [{ id: 'sun', seId: 0, longitude: 17.5, latitude: 0, speed: 1,
    glyph: 'A', degText: '17', minText: '30' }];
  chart.angles.ascDegMin = { degText: '00', minText: '00' };
  chart.angles.mcDegMin = { degText: '00', minText: '00' };
  chart.houses.cuspDegMin = chart.houses.cusps.map(() => ({ degText: '00', minText: '00' }));
  return chart;
}

function recordingPositionDraw(texts) {
  const text = (_point, value) => texts.push(value);
  return new Proxy({
    ctx: new Proxy({}, { get: () => () => undefined }),
    text, textAtInkTop: text, textsize: () => [12, 12],
    measure: (_name, operation) => operation(),
  }, { get: (target, key) => target[key] ?? (() => undefined) });
}

test('position toggle controls painted coordinates and hit targets in every wheel style and biwheel', () => {
  const opts = { width: 800, height: 800, chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize: () => [12, 12], includeStyleTargets: true };
  for (const theme of [0, 1, 2, 3, 4]) {
    for (const comparison of [false, true]) {
      // Reuse the same object while toggling so retained layout caches must also update.
      const chart = positionLabelFixture(theme, true);
      const snapshot = { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
        ...(comparison ? { comparisonChart: positionLabelFixture(theme, true) } : {}) };
      for (const visible of [true, false, true]) {
        chart.options.showPositions = visible;
        if (snapshot.comparisonChart) snapshot.comparisonChart.options.showPositions = visible;
        const texts = [];
        drawChart.drawSnapshotLayer(recordingPositionDraw(texts), snapshot, 'dynamic', opts);
        const context = `theme=${theme}, comparison=${comparison}, visible=${visible}`;
        assert.equal(texts.some(text => text === '17' || text === '17°'), visible, context);
        assert.equal(texts.some(text => text === '00' || text === '00°'), visible, context);
        assert.ok(texts.includes('A'), `planet glyph remains: ${context}`);
        const regions = drawChart.computeHitRegions(snapshot, opts);
        const positions = regions.filter(region => /^(bodies|angles|houses)\.inner\.position\./.test(region.classId ?? ''));
        assert.equal(positions.length > 0, visible, `position hit targets: ${context}`);
        assert.ok(regions.some(region => region.kind === 'planet'), `planet remains interactive: ${context}`);
        assert.ok(regions.some(region => region.kind === 'angle'), `angles remain interactive: ${context}`);
      }
    }
  }
});

test('tri and quad wheels honor chart position labels and retain their local position preference', () => {
  const style = drawChart.DEFAULT_WHEEL_RENDER_STYLE;
  for (const ringCount of [3, 4]) {
    const layout = drawChart.resolveMultiwheelLayout({ chartSize: 800, ringCount, ringZodiac: 'rim' });
    for (const visible of [false, true]) {
      for (const localVisible of [false, true]) {
        const rings = Array.from({ length: ringCount }, () => positionLabelFixture(2, visible));
        for (const chart of rings) chart.options.multiwheelShowPositions = localVisible;
        const texts = [];
        drawChart.drawMultiwheel(recordingPositionDraw(texts), [400, 400], layout,
          { primaryChart: rings[0], rings }, style.palette, { symbols: 'AriesMorinus', ui: 'AriesText' },
          { width: 800, height: 800, topBoundary: 0 }, style);
        assert.equal(texts.some(text => text === '17' || text === '17°'), visible && localVisible,
          `rings=${ringCount}, positions=${visible}, multiwheel=${localVisible}`);
        assert.ok(texts.includes('A'));
      }
    }
  }
});

test('hiding coordinates preserves floating AC and MC labels without house lines', () => {
  for (const theme of [2, 3, 4]) {
    const chart = positionLabelFixture(theme, false);
    chart.options.showHouses = false;
    chart.options.showCusplessAscMcLabels = true;
    const texts = [];
    drawChart.drawSnapshotLayer(recordingPositionDraw(texts),
      { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full' }, 'dynamic',
      { width: 800, height: 800, chartSize: 800, renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE });
    assert.ok(texts.includes('AC'), `AC remains in theme ${theme}`);
    assert.ok(texts.includes('MC'), `MC remains in theme ${theme}`);
    assert.ok(!texts.some(text => text === '00' || text === '00°'));
  }
});

test('outer minutes switch formats biwheel bodies and every outer-object family across wheel styles', () => {
  const families = [['antiscia', 'antiscia'], ['contra_antiscia', 'contra_antiscia'],
    ['dodecatemoria', 'dodecatemoria'], ['arabic_parts', 'arabic_part'],
    ['asteroids', 'asteroid'], ['midpoints', 'midpoint'], ['fixstars', 'fixstar'],
    ['parallel_transits', 'parallel_transit'], ['comparison', 'comparison']];
  for (const theme of [0, 1, 2, 3, 4]) for (const [mode, family] of families) {
    const chart = positionLabelFixture(theme, false);
    chart.options.showOuterPositions = true;
    const item = { id: 'outer', family, longitude: 17.5, label: 'Outer', role: 'outer',
      degText: '17', minText: '30', segments: [{ text: 'A', kind: 'glyph' }] };
    const snapshot = { primaryChart: chart, outerRingMode: mode, overlayRenderMode: 'full',
      ...(mode === 'comparison' ? { comparisonChart: chart, outerRingMode: 'none' }
        : { outerRingItems: { [mode]: [item] } }) };
    const opts = { width: 900, height: 900, chartSize: 700,
      renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, includeStyleTargets: true,
      textsize: text => [String(text).length * 6, 12] };
    const widths = [];
    for (const minutes of [true, false, true]) {
      chart.options.showOuterMinutes = minutes;
      const texts = [];
      const draw = recordingPositionDraw(texts);
      draw.textsize = opts.textsize;
      for (const layer of ['dynamic', 'labels']) drawChart.drawSnapshotLayer(draw, snapshot, layer, opts);
      const expected = minutes ? '17°30′' : '17°';
      assert.ok(texts.some(text => text.trim() === expected), `${theme}/${family}/${minutes}: ${texts}`);
      assert.ok(!texts.some(text => text.trim() === (minutes ? '17°' : '17°30′')));
      const regions = drawChart.computeHitRegions(snapshot, opts);
      const positions = regions.filter(region => region.classId === 'bodies.outer.position');
      assert.ok(positions.length > 0, `${theme}/${family}: coordinate hit target`);
      widths.push(positions[0].width);
    }
    assert.ok(widths[1] < widths[0], `${theme}/${family}: degree-only hit target shrinks`);
    assert.equal(widths[2], widths[0], `${theme}/${family}: minutes restore cached width`);
  }
});

test('whole-sign floating angle degrees paint inside cusp annotations in every geometry', () => {
  const opts = { width: 800, height: 800, chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize: () => [12, 12], includeStyleTargets: true };
  for (const theme of [0, 1, 2, 3, 4]) {
    const chart = positionLabelFixture(theme, true);
    chart.options.wheelComposition = { schemaVersion: 1, customized: true,
      projection: theme === 3 ? 'houses' : 'zodiac',
      rings: ['cuspLabels', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        instanceId: archetypeId, archetypeId, enabled: true, chartRole: 'primary',
      })),
    };
    chart.angles = { asc: 8.5, dsc: 188.5, mc: 98.5, ic: 278.5,
      ascDegMin: { degText: '08', minText: '30' }, mcDegMin: { degText: '08', minText: '30' } };
    const snapshot = { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full' };
    const regions = drawChart.computeHitRegions(snapshot, opts);
    const radius = r => Math.hypot(r.x - 400, r.y - 400);
    const angles = regions.filter(r => r.classId === 'angles.inner.position.degree');
    const cusps = regions.filter(r => r.classId === 'houses.inner.position.degree');
    assert.equal(angles.length, 2, `theme ${theme}: angle coordinates retained`);
    assert.ok(cusps.length >= 6);
    assert.ok(Math.max(...angles.map(radius)) < Math.min(...cusps.map(radius)),
      `theme ${theme}: point coordinates ${angles.map(radius)} must be inside cusp coordinates ${cusps.map(radius)}`);
    for (const angleId of ['asc', 'mc']) {
      const ray = regions.find(r => r.itemId === `angle:${angleId}:ray`);
      const dx = ray.x2 - ray.x1, dy = ray.y2 - ray.y1;
      const length = Math.hypot(dx, dy);
      for (const box of regions.filter(r => r.itemId?.startsWith(`angle:${angleId}:position`))) {
        const distances = [[box.left, box.top], [box.left + box.width, box.top],
          [box.left, box.top + box.height], [box.left + box.width, box.top + box.height]]
          .map(([x, y]) => ((x - ray.x1) * -dy + (y - ray.y1) * dx) / length);
        assert.ok(Math.max(...distances) < 0,
          `theme ${theme}: ${angleId} readout stays on the following-house side of its ray`);
      }
    }
    const painted = [];
    const draw = recordingPositionDraw([]);
    draw.text = draw.textAtInkTop = (point, text) => painted.push({ point, text });
    drawChart.drawSnapshotLayer(draw, snapshot, 'dynamic', opts);
    for (const region of angles) {
      assert.ok(painted.some(p => (p.text === '08' || p.text === '08°')
        && Math.abs(p.point[0] - region.left) < 1 && Math.abs(p.point[1] - region.top) < 1),
      `theme ${theme}: hit bounds follow the painted degree`);
    }
  }
});


test('AC/MC arrowheads remain available away from house cusps and respect their toggle', () => {
  const opts = { width: 800, height: 800, chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize: () => [12, 12], includeStyleTargets: true };
  for (const theme of [0, 1, 2, 3, 4]) {
    const chart = positionLabelFixture(theme, true);
    chart.angles.asc = 8.5;
    chart.angles.mc = 98.5;
    const snapshot = { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full' };
    for (const enabled of [true, false, true]) {
      chart.options.showAngleArrowheads = enabled;
      const arrows = drawChart.computeHitRegions(snapshot, opts)
        .filter(r => r.classId === 'angles.inner.arrowhead');
      assert.deepEqual([...new Set(arrows.map(r => r.itemId.split(':')[1]))].sort(),
        enabled ? ['asc', 'mc'] : [], `theme ${theme}, arrowheads ${enabled}`);
    }
  }
});


test('thick angle shafts stop before filled arrow tips in paint and editor targets', () => {
  for (const theme of [2, 3, 4]) for (const wholeSign of [false, true]) {
    const chart = positionLabelFixture(theme, true);
    chart.planets = [];
    chart.angles.asc = wholeSign ? 8.5 : 0;
    chart.angles.mc = wholeSign ? 98.5 : 270;
    const snapshot = { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full' };
    const arrowWidths = [];
    for (const width of [2, 12]) {
      const style = drawChart.createTokenizedWheelRenderStyle({ authoringOverrides: {
        ...drawChart.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        linePaint: Object.fromEntries(['classic', 'compact', 'anglo', 'houses', 'cusps'].map(profile =>
          [profile, { 'angles.inner.ray': { strokeWidthPx: width } }])) } });
      const opts = { width: 800, height: 800, chartSize: 800,
        renderStyle: style, textsize: () => [12, 12], includeStyleTargets: true };
      const regions = drawChart.computeHitRegions(snapshot, opts);
      const arrow = regions.find(r => r.itemId === 'angle:asc:arrowhead');
      arrowWidths.push(arrow.height);
      const ray = regions.find(r => r.itemId === 'angle:asc:ray');
      const lines = [], triangles = [];
      let path = [];
      const draw = recordingPositionDraw([]);
      draw.line = points => lines.push(points);
      draw.ctx = new Proxy({
        beginPath: () => { path = []; },
        moveTo: (x, y) => path.push([x, y]), lineTo: (x, y) => path.push([x, y]),
        fill: () => { if (path.length === 3) triangles.push(path); },
      }, { get: (target, key) => target[key] ?? (() => undefined) });
      for (const layer of ['geometry', 'dynamic']) drawChart.drawSnapshotLayer(draw, snapshot, layer, opts);
      assert.ok(lines.some(points => points.some(p => Math.hypot(p[0] - ray.x2, p[1] - ray.y2) < 0.01)),
        'painted shaft ends at its editor target');
      const triangle = triangles.find(points => points.every(([x, y]) =>
        x >= arrow.left - 1 && x <= arrow.left + arrow.width + 1
        && y >= arrow.top - 1 && y <= arrow.top + arrow.height + 1));
      assert.ok(triangle, 'editor arrow target encloses the painted triangle');
      const unit = [(ray.x2 - 400), (ray.y2 - 400)];
      const length = Math.hypot(...unit); unit[0] /= length; unit[1] /= length;
      const along = p => (p[0] - 400) * unit[0] + (p[1] - 400) * unit[1];
      const apex = Math.max(...triangle.map(along));
      const base = Math.min(...triangle.map(along));
      for (const points of lines) for (let i = 1; i < points.length; i++) {
        const pair = [points[i - 1], points[i]];
        if (!pair.every(p => Math.abs((p[0] - 400) * -unit[1] + (p[1] - 400) * unit[0]) < 0.01)) continue;
        const lo = Math.min(...pair.map(along)), hi = Math.max(...pair.map(along));
        assert.ok(hi < apex - 1 || lo >= apex - 1, `no angle shaft reaches its arrow tip: theme=${theme} wholeSign=${wholeSign} width=${width} segment=${lo},${hi} head=${base},${apex}`);
      }
    }
    assert.ok(arrowWidths[1] > arrowWidths[0], 'arrow grows with the line width');
  }
});


test('actual Canvas angle shafts and filled heads share one subpixel axis and overlap at the base', () => {
  for (const width of [2, 12]) {
    const strokes = [], fills = [];
    let path = [];
    const ctx = new Proxy({
      beginPath: () => { path = []; },
      moveTo: (x, y) => path.push([x, y]), lineTo: (x, y) => path.push([x, y]),
      stroke: () => strokes.push(path), fill: () => fills.push(path),
    }, { get: (target, key) => target[key] ?? (() => undefined) });
    const draw = new drawChart.CanvasDraw({ getContext: () => ctx });
    const chart = positionLabelFixture(4, true);
    chart.angles = { asc: 0, dsc: 180, mc: 73.54, ic: 253.54 };
    const rings = { rBase: 123.4, rInner: 300.6, r30: 350.8 };
    const style = drawChart.createTokenizedWheelRenderStyle({ authoringOverrides: {
      ...drawChart.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      linePaint: Object.fromEntries(['classic', 'compact', 'anglo', 'houses', 'cusps'].map(profile =>
        [profile, { 'angles.inner.ray': { strokeWidthPx: width } }])) } });
    drawChart.drawAscMC(draw, [400.3, 400.7], rings,
      { rotation: 0, projection: { project: lon => lon } }, chart, 800, {}, style);
    assert.equal(fills.length, 2);
    for (const [index, triangle] of fills.entries()) {
      const [apex, left, right] = triangle;
      const base = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
      const axis = [apex[0] - base[0], apex[1] - base[1]];
      const length = Math.hypot(...axis); axis[0] /= length; axis[1] /= length;
      const shaft = strokes[index * 2];
      for (const point of shaft) {
        assert.ok(Math.abs((point[0] - base[0]) * -axis[1] + (point[1] - base[1]) * axis[0]) < 1e-9,
          'Canvas commands preserve exact shaft/head centering');
      }
      const end = shaft[1];
      const overlap = (end[0] - base[0]) * axis[0] + (end[1] - base[1]) * axis[1];
      assert.ok(overlap > 0 && overlap < length, 'shaft overlaps the base without reaching the tip');
      const headHalfWidth = Math.hypot(left[0] - right[0], left[1] - right[1]) / 2;
      assert.ok(headHalfWidth * (1 - overlap / length) >= width / 2,
        'the overlapping shaft fits inside the arrow taper');
    }
  }
});

test('each arrow drawer choice paints its shape across every wheel geometry', () => {
  for (const theme of [0, 1, 2, 3, 4]) for (const shape of ['filled', 'outlined', 'open', 'stealth', 'spear']) {
    const strokes = [], fills = [];
    let path = [];
    const ctx = new Proxy({
      beginPath: () => { path = []; }, moveTo: (x, y) => path.push([x, y]),
      lineTo: (x, y) => path.push([x, y]), stroke: () => strokes.push(path), fill: () => fills.push(path),
    }, { get: (target, key) => target[key] ?? (() => undefined) });
    const draw = new drawChart.CanvasDraw({getContext: () => ctx});
    const chart = positionLabelFixture(theme, true);
    const rings = {rBase: 120, rInner: 300, r30: 350, rASCMC: 320, rArrow: 330};
    const style = drawChart.createTokenizedWheelRenderStyle({authoringOverrides: {
      ...drawChart.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      linePaint: Object.fromEntries(['classic', 'compact', 'anglo', 'houses', 'cusps'].map(profile =>
        [profile, {'angles.inner.arrowhead': {arrowStyle: shape}}])),
    }});
    drawChart.drawAscMC(draw, [400, 400], rings, {rotation: 0, projection: {project: lon => lon}},
      chart, 800, {}, style);
    if (shape === 'open' || shape === 'outlined') {
      assert.equal(fills.length, 0);
      assert.equal(strokes.length, 4 + (shape === 'open' ? 4 : 6));
    } else {
      assert.equal(strokes.length, 4);
      assert.equal(fills.length, 2);
      assert.ok(fills.every(points => points.length === (shape === 'stealth' ? 4 : 3)));
    }
    const regions = drawChart.computeHitRegions({primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'},
      {width: 800, height: 800, chartSize: 800, renderStyle: style, textsize: () => [12, 12], includeStyleTargets: true});
    assert.ok(regions.some(r => r.classId === 'angles.inner.arrowhead'));
  }
});


test('H keeps one shared AC/MC coordinate with a retained cusp annotation band', () => {
  const opts = { width: 800, height: 800, chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE, textsize: () => [12, 12], includeStyleTargets: true };
  for (const theme of [0, 1, 2, 3, 4]) {
    for (const comparison of [false, true]) {
      const chart = positionLabelFixture(theme, true);
      chart.angles.asc = chart.houses.cusps[0];
      chart.angles.mc = chart.houses.cusps[9];
      chart.angles.ascDegMin = chart.houses.cuspDegMin[0] = { degText: '11', minText: '15' };
      chart.angles.mcDegMin = chart.houses.cuspDegMin[9] = { degText: '22', minText: '45' };
      const snapshot = { primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full',
        ...(comparison ? { comparisonChart: positionLabelFixture(theme, true) } : {}) };
      for (const showHouses of [true, false, true, false]) {
        chart.options.showHouses = showHouses;
        const painted = [];
        drawChart.drawSnapshotLayer(recordingPositionDraw(painted), snapshot, 'dynamic', opts);
        for (const degree of ['11', '22']) {
          assert.equal(painted.filter(text => text === degree || text === `${degree}°`).length, 1,
            `theme ${theme}, comparison ${comparison}, houses ${showHouses}: one ${degree} degree readout`);
        }
        const positions = drawChart.computeHitRegions(snapshot, opts).filter(region =>
          region.classId === 'angles.inner.position.degree' || region.classId === 'houses.inner.position.degree');
        assert.equal(positions.length, theme >= 2 ? 12 : showHouses ? 6 : 2,
          `theme ${theme}, houses ${showHouses}: no duplicate coordinate targets`);
      }
    }
  }
});

test('Classic and Compact keep Morinus arrow vertices independent of angle pen width', () => {
  for (const theme of [0, 1]) {
    const dimensions = [];
    for (const width of [1, 3, 5, 12]) {
      const chart = positionLabelFixture(theme, true);
      chart.options.ascmcSize = width;
      const regions = drawChart.computeHitRegions({primaryChart: chart, outerRingMode: 'none', overlayRenderMode: 'full'}, {
        width: 800, height: 800, renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
        textsize: () => [12, 12], includeStyleTargets: true,
      });
      const heads = regions.filter(r => r.classId === 'angles.inner.arrowhead');
      assert.equal(heads.length, 6);
      dimensions.push(heads.map(head => [head.x1, head.y1, head.x2, head.y2]));
    }
    for (const dimension of dimensions) assert.deepEqual(dimension, dimensions[0]);
  }
});
