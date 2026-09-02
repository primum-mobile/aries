// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions }).outputText;
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}

const presentationSource = await readSource(
  new URL("../src/lib/chart/pd-event-presentation.ts", import.meta.url),
);
const presentation = await import(dataUrl(transpile(presentationSource)));

const fixedRingPresentation = {
  traditionalConverse: false,
  primaryBodies: { sourceRole: "primary", track: "inner" },
  comparisonBodies: { sourceRole: "outer", track: "outer" },
  frameworkSourceRole: "primary",
  showComparisonHouses: true,
  showComparisonAxes: true,
};

const traditionalRingPresentation = {
  traditionalConverse: true,
  primaryBodies: { sourceRole: "primary", track: "outer" },
  comparisonBodies: { sourceRole: "outer", track: "inner" },
  frameworkSourceRole: "primary",
  showComparisonHouses: false,
  showComparisonAxes: false,
};

const geometry = {
  center: [400, 400],
  ascendantDegrees: 0,
  outerRayInnerRadius: 330,
  outerRayOuterRadius: 360,
  innerMarkerInnerRadius: 150,
  innerMarkerOuterRadius: 180,
  innerMarkerLabelRadius: 210,
  outerMarkerLabelRadius: 345,
};

function overlay(frame = "fixed-radix", longitudes = [120, 120]) {
  const traditional = frame === "traditional-converse";
  return {
    schemaVersion: 1,
    eventId: "pd-angle-v1|fixture",
    supported: true,
    unsupportedReason: null,
    eventKind: "body-aspect-to-angle",
    domain: "zodiacal",
    system: 0,
    projectionMode: "ecliptic-feet",
    displayFrame: frame,
    direction: traditional ? "converse" : "direct",
    eventJd: 2462000.5,
    exactArcDegrees: 12,
    exactArcDegreesSigned: traditional ? -12 : 12,
    currentArcDegreesSigned: traditional ? -12 : 12,
    remainingArcDegreesSigned: 0,
    remainingArcDegrees: 0,
    exactNow: true,
    residualDegrees: 0,
    nativeCoordinateKind: "oblique-ascension",
    literalLongitudeContact: longitudes[0] === longitudes[1],
    parties: {
      promissor: {
        pointId: 0,
        aspect: 0,
        aspectOffset: 0,
        bodyLongitude: longitudes[0],
        bodyLatitude: 0,
        rayLongitude: longitudes[0],
        rayLatitude: 0,
        color: "rgb(200,100,80)",
      },
      significator: {
        pointId: 13,
        aspect: 0,
        longitude: longitudes[1],
      },
    },
    primitives: [
      {
        kind: "direction-ray",
        role: "promissor",
        motion: traditional ? "fixed" : "moving",
        ring: "outer",
        longitude: longitudes[0],
        latitude: 0,
        nativeCoordinate: 212,
        nativeCoordinateKind: "oblique-ascension",
      },
      {
        kind: "directed-angle",
        role: "significator",
        motion: traditional ? "moving" : "fixed",
        ring: "inner",
        angleId: 13,
        longitude: longitudes[1],
        latitude: 0,
        nativeCoordinate: 212,
        nativeCoordinateKind: "oblique-ascension",
      },
    ],
  };
}

function angleOverlay(
  frame = "fixed-radix",
  angleId = 12,
  longitudes = [120, 120],
) {
  const traditional = frame === "traditional-converse";
  const input = overlay(frame, longitudes);
  input.eventId = "pd-angle-promissor-v1|fixture";
  input.eventKind = "angle-to-body-aspect";
  input.literalLongitudeContact = longitudes[0] === longitudes[1];
  input.parties = {
    promissor: {
      pointId: angleId,
      dynamicKey: null,
      aspect: 0,
      aspectOffset: 0,
      longitude: longitudes[0],
      rayLongitude: longitudes[0],
      rayLatitude: 0,
      color: "rgb(120,180,220)",
    },
    significator: {
      pointId: 2,
      dynamicKey: null,
      aspect: 0,
      aspectOffset: 0,
      bodyLongitude: longitudes[1],
      bodyLatitude: 0,
      rayLongitude: longitudes[1],
      rayLatitude: 0,
      color: "rgb(220,150,90)",
    },
  };
  input.primitives = [
    {
      kind: "directed-angle",
      role: "promissor",
      motion: traditional ? "fixed" : "moving",
      ring: "outer",
      angleId,
      longitude: longitudes[0],
      latitude: 0,
      nativeCoordinate: 212,
      nativeCoordinateKind: "row-native",
    },
    {
      kind: "direction-ray",
      role: "significator",
      motion: traditional ? "moving" : "fixed",
      ring: "inner",
      longitude: longitudes[1],
      latitude: 0,
      nativeCoordinate: 212,
      nativeCoordinateKind: "row-native",
    },
  ];
  return input;
}

function directionState(eventOverlay, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: eventOverlay.eventId,
    eventKind: "aspect",
    domain: "zodiacal",
    system: 0,
    direction: eventOverlay.direction,
    eventJd: 2461250.25,
    eventLabel: "Selected primary direction",
    exactArcDegrees: eventOverlay.exactArcDegrees,
    exactArcDegreesSigned: eventOverlay.exactArcDegreesSigned,
    currentArcDegreesSigned: eventOverlay.currentArcDegreesSigned,
    remainingArcDegreesSigned: eventOverlay.remainingArcDegreesSigned,
    remainingArcDegrees: Math.abs(eventOverlay.remainingArcDegreesSigned),
    exactNow: eventOverlay.exactNow,
    phase: eventOverlay.exactNow ? "exact" : "applying",
    ...overrides,
  };
}

test("fixed radix uses moving outer promissor and fixed primary angle", () => {
  const result = presentation.resolvePdEventLayout(
    overlay(),
    fixedRingPresentation,
    geometry,
  );
  assert.ok(result);
  assert.deepEqual(
    {
      role: result.directionRay.sourceRole,
      track: result.directionRay.track,
      motion: result.directionRay.motion,
    },
    { role: "outer", track: "outer", motion: "moving" },
  );
  assert.deepEqual(
    {
      role: result.directedAngle.sourceRole,
      track: result.directedAngle.track,
      motion: result.directedAngle.motion,
    },
    { role: "primary", track: "inner", motion: "fixed" },
  );
  assert.equal(result.promissorColor, "rgb(200,100,80)");
  assert.equal(result.directedAngle.angleId, 13);
  assert.equal(result.directedAngleLabel, null);
  assert.equal("connector" in result, false);
});

test("traditional converse swaps source identity without moving the radix framework", () => {
  const result = presentation.resolvePdEventLayout(
    overlay("traditional-converse"),
    traditionalRingPresentation,
    geometry,
  );
  assert.ok(result);
  assert.deepEqual(
    {
      role: result.directionRay.sourceRole,
      track: result.directionRay.track,
      motion: result.directionRay.motion,
    },
    { role: "primary", track: "outer", motion: "fixed" },
  );
  assert.deepEqual(
    {
      role: result.directedAngle.sourceRole,
      track: result.directedAngle.track,
      motion: result.directedAngle.motion,
    },
    { role: "outer", track: "inner", motion: "moving" },
  );
  assert.equal(traditionalRingPresentation.frameworkSourceRole, "primary");
  assert.equal(traditionalRingPresentation.showComparisonAxes, false);
  assert.equal(result.directedAngle.angleId, 13);
  assert.equal(result.directedAngleLabel.text, "DC");
});

test("Planets projection keeps projected longitude separation visible", () => {
  const input = overlay("fixed-radix", [120, 121.25]);
  input.projectionMode = "planets";
  input.literalLongitudeContact = false;
  const result = presentation.resolvePdEventLayout(
    input,
    fixedRingPresentation,
    geometry,
  );
  assert.ok(result);
  assert.equal(result.directionRay.longitude, 120);
  assert.equal(result.directedAngle.longitude, 121.25);
  assert.notDeepEqual(result.directionRay.start, result.directedAngle.start);
});

test("angle promissors preserve daemon roles in both reciprocal frames", () => {
  for (const [frame, ringPresentation, expected] of [
    [
      "fixed-radix",
      fixedRingPresentation,
      {
        angle: ["outer", "outer", "moving"],
        ray: ["primary", "inner", "fixed"],
      },
    ],
    [
      "traditional-converse",
      traditionalRingPresentation,
      {
        angle: ["primary", "outer", "fixed"],
        ray: ["outer", "inner", "moving"],
      },
    ],
  ]) {
    const result = presentation.resolvePdEventLayout(
      angleOverlay(frame),
      ringPresentation,
      geometry,
    );
    assert.ok(result);
    assert.equal(result.eventKind, "angle-to-body-aspect");
    assert.deepEqual(
      [
        result.directedAngle.sourceRole,
        result.directedAngle.track,
        result.directedAngle.motion,
      ],
      expected.angle,
    );
    assert.deepEqual(
      [
        result.directionRay.sourceRole,
        result.directionRay.track,
        result.directionRay.motion,
      ],
      expected.ray,
    );
    assert.equal(result.directedAngleLabel.text, "AC");
    assert.equal(result.promissorColor, "rgb(120,180,220)");
    assert.equal(result.significatorColor, "rgb(220,150,90)");
  }
});

test("all four promissor angles are labeled on the outer marker", () => {
  for (const [frame, ringPresentation] of [
    ["fixed-radix", fixedRingPresentation],
    ["traditional-converse", traditionalRingPresentation],
  ]) {
    for (const [angleId, label] of [
      [12, "AC"],
      [13, "DC"],
      [14, "MC"],
      [15, "IC"],
    ]) {
      const result = presentation.resolvePdEventLayout(
        angleOverlay(frame, angleId),
        ringPresentation,
        geometry,
      );
      assert.ok(result);
      assert.equal(result.directedAngle.track, "outer");
      assert.equal(result.directedAngleLabel.text, label);
    }
  }
});

test("angle-to-body Planets projection preserves visible ray separation", () => {
  const input = angleOverlay("fixed-radix", 14, [84.25, 86.5]);
  input.projectionMode = "planets";
  input.literalLongitudeContact = false;
  const result = presentation.resolvePdEventLayout(
    input,
    fixedRingPresentation,
    geometry,
  );
  assert.ok(result);
  assert.equal(result.directedAngle.longitude, 84.25);
  assert.equal(result.directionRay.longitude, 86.5);
  assert.notDeepEqual(result.directionRay.start, result.directedAngle.start);
});

test("unsupported, mismatched and malformed contracts draw nothing", () => {
  const unsupported = overlay();
  unsupported.supported = false;
  unsupported.primitives = [];
  assert.equal(
    presentation.resolvePdEventLayout(
      unsupported,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  assert.equal(
    presentation.resolvePdEventLayout(
      overlay("traditional-converse"),
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const wrongTrack = overlay();
  wrongTrack.primitives[0].ring = "inner";
  assert.equal(
    presentation.resolvePdEventLayout(
      wrongTrack,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );

  const missingPrimitives = overlay();
  delete missingPrimitives.primitives;
  assert.equal(
    presentation.resolvePdEventLayout(
      missingPrimitives,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const nonArrayPrimitives = overlay();
  nonArrayPrimitives.primitives = {};
  assert.equal(
    presentation.resolvePdEventLayout(
      nonArrayPrimitives,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const incompleteParties = overlay();
  incompleteParties.parties = {};
  assert.equal(
    presentation.resolvePdEventLayout(
      incompleteParties,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const badEventId = overlay();
  badEventId.eventId = "";
  assert.equal(
    presentation.resolvePdEventLayout(
      badEventId,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  badEventId.eventId = 42;
  assert.equal(
    presentation.resolvePdEventLayout(
      badEventId,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const badAngleId = overlay();
  badAngleId.primitives[1].angleId = 99;
  assert.equal(
    presentation.resolvePdEventLayout(
      badAngleId,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const nullPrimitive = overlay();
  nullPrimitive.primitives[0] = null;
  assert.doesNotThrow(() => {
    assert.equal(
      presentation.resolvePdEventLayout(
        nullPrimitive,
        fixedRingPresentation,
        geometry,
      ),
      null,
    );
  });

  const wrongAngleRole = angleOverlay();
  wrongAngleRole.primitives[0].role = "significator";
  assert.equal(
    presentation.resolvePdEventLayout(
      wrongAngleRole,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const wrongAngleTrack = angleOverlay();
  wrongAngleTrack.primitives[1].ring = "outer";
  assert.equal(
    presentation.resolvePdEventLayout(
      wrongAngleTrack,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const wrongAngleMotion = angleOverlay();
  wrongAngleMotion.primitives[0].motion = "fixed";
  assert.equal(
    presentation.resolvePdEventLayout(
      wrongAngleMotion,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const mismatchedEventKind = angleOverlay();
  mismatchedEventKind.eventKind = "body-aspect-to-angle";
  assert.equal(
    presentation.resolvePdEventLayout(
      mismatchedEventKind,
      fixedRingPresentation,
      geometry,
    ),
    null,
  );
  const staleDirectTraditional = angleOverlay("traditional-converse");
  staleDirectTraditional.direction = "direct";
  assert.equal(
    presentation.resolvePdEventLayout(
      staleDirectTraditional,
      traditionalRingPresentation,
      geometry,
    ),
    null,
  );
});

test("non-finite geometry and endpoints fail closed", () => {
  for (const invalidGeometry of [
    { ...geometry, ascendantDegrees: Number.NaN },
    { ...geometry, outerRayOuterRadius: Number.POSITIVE_INFINITY },
    { ...geometry, innerMarkerInnerRadius: -1 },
    { ...geometry, center: [Number.NaN, 400] },
  ]) {
    assert.equal(
      presentation.resolvePdEventLayout(
        overlay(),
        fixedRingPresentation,
        invalidGeometry,
      ),
      null,
    );
  }
  const overflowingGeometry = {
    center: [Number.MAX_VALUE, Number.MAX_VALUE],
    ascendantDegrees: 0,
    outerRayInnerRadius: Number.MAX_VALUE / 2,
    outerRayOuterRadius: Number.MAX_VALUE,
    innerMarkerInnerRadius: Number.MAX_VALUE / 4,
    innerMarkerOuterRadius: Number.MAX_VALUE / 3,
    innerMarkerLabelRadius: Number.MAX_VALUE / 2,
  };
  assert.equal(
    presentation.resolvePdEventLayout(
      overlay(),
      fixedRingPresentation,
      overflowingGeometry,
    ),
    null,
  );
});

test("the PD bridge does not borrow generic aspect presentation", async () => {
  const drawSource = await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  );
  const paintBlock = drawSource.match(
    /function drawPdEventOverlay[\s\S]*?\n}\n\nfunction drishtiEndpoints/,
  )?.[0];
  assert.ok(paintBlock);
  assert.doesNotMatch(paintBlock, /semanticLinePaint\([\s\S]{0,120}"aspect"/);
  assert.doesNotMatch(paintBlock, /strokes\.aspects/);
  assert.doesNotMatch(paintBlock, /connector|dash:/);
  assert.match(paintBlock, /\.\.\.semanticLinePaint[\s\S]*?fill:[\s\S]*?partyColor/);
  assert.match(paintBlock, /"angles\.outer\.ray"/);
  assert.match(paintBlock, /"bodies\.inner\.leader"/);
  assert.match(
    paintBlock,
    /\[primitive\.start as Pt, primitive\.end as Pt\]/,
  );
  const hitBlock = drawSource.match(
    /const regions: ChartHitRegion\[\] = \[\];[\s\S]*?const comparisonPlanetMapForPaint/,
  )?.[0];
  assert.ok(hitBlock);
  assert.doesNotMatch(hitBlock, /angleLineTolerance|priorities\.aspectLine/);
  assert.match(
    hitBlock,
    /x1: primitive\.start\[0\],[\s\S]*?y1: primitive\.start\[1\],[\s\S]*?x2: primitive\.end\[0\],[\s\S]*?y2: primitive\.end\[1\]/,
  );
});

async function loadDrawChart() {
  const chartFontsUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/chart-fonts.ts", import.meta.url),
  )));
  const canvasDrawUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/canvas-draw.ts", import.meta.url),
  )).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`));
  const layoutModelUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url),
  )));
  const wheelStyleUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
  )).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`));
  const pdRingUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/pd-ring-presentation.ts", import.meta.url),
  )));
  const pdEventUrl = dataUrl(transpile(presentationSource));
  const glyphsUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/chart/glyphs.ts", import.meta.url),
  )));
  const ditherUrl = dataUrl(transpile(await readSource(
    new URL("../src/lib/render/dither-pattern.ts", import.meta.url),
  )));
  const drawSource = transpile(await readSource(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  ))
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`)
    .replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`)
    .replaceAll('"./pd-ring-presentation"', `"${pdRingUrl}"`)
    .replaceAll('"./pd-event-presentation"', `"${pdEventUrl}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"../render/dither-pattern"', `"${ditherUrl}"`);
  return {
    ...(await import(dataUrl(drawSource))),
    DEFAULT_WHEEL_RENDER_STYLE: (await import(wheelStyleUrl)).DEFAULT_WHEEL_RENDER_STYLE,
  };
}

function chartFixture(theme = 0) {
  return {
    planets: [],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: { cusps: Array.from({ length: 12 }, (_, index) => index * 30) },
    aspects: [],
    options: {
      theme,
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

function paintRecorder() {
  const calls = { line: [], text: [] };
  const draw = new Proxy({
    line: (...args) => calls.line.push(args),
    text: (...args) => calls.text.push(args),
    textsize: () => [12, 12],
    measure: (_name, operation) => operation(),
  }, {
    get: (target, property) => target[property] ?? (() => undefined),
  });
  return { calls, draw };
}

test("stale direct traditional payload produces no PD paint or hits", async () => {
  const drawChart = await loadDrawChart();
  const validOverlay = angleOverlay("traditional-converse");
  const staleOverlay = structuredClone(validOverlay);
  staleOverlay.direction = "direct";
  const baseSnapshot = {
    primaryChart: chartFixture(),
    comparisonChart: chartFixture(),
    displayDatetime: "2026-08-14T00:00:00+02:00",
    renderVariant: "round-classic",
    overlayRenderMode: "full",
    outerRingMode: "none",
    document: { pdInChartFrame: "traditional-converse" },
  };
  const drawOptions = {
    width: 800,
    height: 800,
    chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
  };
  const validPaint = paintRecorder();
  drawChart.drawSnapshotLayer(
    validPaint.draw,
    { ...baseSnapshot, pdEventOverlay: validOverlay },
    "dynamic",
    drawOptions,
  );
  const stalePaint = paintRecorder();
  drawChart.drawSnapshotLayer(
    stalePaint.draw,
    { ...baseSnapshot, pdEventOverlay: staleOverlay },
    "dynamic",
    drawOptions,
  );
  assert.equal(validPaint.calls.line.length - stalePaint.calls.line.length, 2);
  assert.equal(validPaint.calls.text.length - stalePaint.calls.text.length, 1);

  const staleRegions = drawChart.computeHitRegions(
    { ...baseSnapshot, pdEventOverlay: staleOverlay },
    { ...drawOptions, textsize: () => [12, 12] },
  );
  assert.equal(
    staleRegions.filter((region) => region.kind === "pd_event").length,
    0,
  );
});

test("all wheel variants expose both PD event orientations only as dedicated event hits", async () => {
  const drawChart = await loadDrawChart();
  const variants = [
    [0, "round-classic"],
    [1, "round-compact"],
    [2, "round-anglo"],
  ];
  for (const [theme, renderVariant] of variants) {
    for (const frame of ["fixed-radix", "traditional-converse"]) {
      for (const eventKind of ["body-aspect-to-angle", "angle-to-body-aspect"]) {
        const eventOverlay = eventKind === "body-aspect-to-angle"
          ? overlay(frame)
          : angleOverlay(frame, 15, [121.25, 120]);
        const snapshot = {
          primaryChart: chartFixture(theme),
          comparisonChart: chartFixture(theme),
          displayDatetime: "2026-08-14T00:00:00+02:00",
          renderVariant,
          overlayRenderMode: "full",
          outerRingMode: "none",
          document: { pdInChartFrame: frame },
          pdEventOverlay: eventOverlay,
          pdDirectionState: directionState(eventOverlay),
        };
        const regions = drawChart.computeHitRegions(snapshot, {
          width: 800,
          height: 800,
          chartSize: 800,
          renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
          textsize: () => [12, 12],
        });
        const eventRegions = regions.filter(
          (region) => region.kind === "pd_event",
        );
        assert.equal(
          regions.filter((region) => region.kind === "aspect").length,
          0,
          "the selected PD bridge is never registered as a zodiacal aspect hit",
        );
        assert.equal(
          eventRegions.length,
          eventKind === "angle-to-body-aspect"
            || frame === "traditional-converse"
            ? 3
            : 2,
          `${renderVariant} ${frame} ${eventKind}`,
        );
        const expectedRoles = eventKind === "body-aspect-to-angle"
          ? (frame === "fixed-radix"
            ? [
                ["direction-ray", "outer", "outer", "moving"],
                ["directed-angle", "primary", "inner", "fixed"],
              ]
            : [
                ["direction-ray", "primary", "outer", "fixed"],
                ["directed-angle", "outer", "inner", "moving"],
                ["directed-angle-label", "outer", "inner", "moving"],
              ])
          : (frame === "fixed-radix"
          ? [
              ["direction-ray", "primary", "inner", "fixed"],
              ["directed-angle", "outer", "outer", "moving"],
              ["directed-angle-label", "outer", "outer", "moving"],
            ]
          : [
              ["direction-ray", "outer", "inner", "moving"],
              ["directed-angle", "primary", "outer", "fixed"],
              ["directed-angle-label", "primary", "outer", "fixed"],
            ]);
        assert.deepEqual(
          eventRegions.map(({ component, sourceRole, track, motion }) => [
            component,
            sourceRole,
            track,
            motion,
          ]),
          expectedRoles,
        );
        for (const region of eventRegions) {
          assert.equal(region.eventKind, eventKind);
          assert.equal(region.interactive, true);
          assert.equal(region.directionState.eventId, eventOverlay.eventId);
          assert.equal(
            drawChart.findHitRegion([region], region.x, region.y),
            region,
            "validated PD event geometry must be directly hittable",
          );
        }
      }
    }
  }
});

test("missing, stale, or malformed direction state fails closed", async () => {
  const drawChart = await loadDrawChart();
  const eventOverlay = angleOverlay("fixed-radix", 12, [121.25, 120]);
  const baseSnapshot = {
    primaryChart: chartFixture(),
    comparisonChart: chartFixture(),
    displayDatetime: "2026-08-14T00:00:00+02:00",
    renderVariant: "round-classic",
    overlayRenderMode: "full",
    outerRingMode: "none",
    document: { pdInChartFrame: "fixed-radix" },
    pdEventOverlay: eventOverlay,
  };
  const options = {
    width: 800,
    height: 800,
    chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
    textsize: () => [12, 12],
  };
  for (const pdDirectionState of [
    undefined,
    directionState(eventOverlay, { eventId: "stale-event" }),
    directionState(eventOverlay, { eventKind: "" }),
    directionState(eventOverlay, { eventKind: null }),
    directionState(eventOverlay, { domain: "mundane" }),
    directionState(eventOverlay, { direction: "converse" }),
    directionState(eventOverlay, { exactNow: !eventOverlay.exactNow }),
    directionState(eventOverlay, { phase: "transiting" }),
    directionState(eventOverlay, { eventLabel: "" }),
    directionState(eventOverlay, { eventJd: Number.NaN }),
    directionState(eventOverlay, { remainingArcDegrees: Number.NaN }),
    directionState(eventOverlay, { remainingArcDegrees: -1 }),
  ]) {
    const regions = drawChart.computeHitRegions(
      { ...baseSnapshot, pdDirectionState },
      options,
    );
    assert.equal(
      regions.filter((region) => region.kind === "pd_event").length,
      0,
    );
  }
  const unsupportedOverlay = { ...eventOverlay, supported: false };
  assert.equal(
    drawChart.computeHitRegions(
      {
        ...baseSnapshot,
        pdEventOverlay: unsupportedOverlay,
        pdDirectionState: directionState(eventOverlay),
      },
      options,
    ).filter((region) => region.kind === "pd_event").length,
    0,
  );

  const movingOverlay = {
    ...eventOverlay,
    exactNow: false,
    currentArcDegreesSigned: 10,
    remainingArcDegreesSigned: 2,
    remainingArcDegrees: 2,
  };
  for (const phase of ["applying", "separating"]) {
    const regions = drawChart.computeHitRegions(
      {
        ...baseSnapshot,
        pdEventOverlay: movingOverlay,
        pdDirectionState: directionState(movingOverlay, { phase }),
      },
      options,
    );
    const eventRegions = regions.filter((region) => region.kind === "pd_event");
    assert.equal(eventRegions.length, 3);
    assert.ok(eventRegions.every((region) => region.directionState.phase === phase));
  }
});

test("frontend routing keeps PD identity explicit and contains no direction math", async () => {
  const [storeSource, canvasSource, hoverSource, inspectorSource] = await Promise.all([
    readFile(new URL("../src/stores/workspace-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/chart-hover-flag.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/workshell/inspector-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(
    storeSource,
    /`pd_event:\$\{region\.eventId\}:\$\{region\.component\}:\$\{region\.partyRole\}:\$\{region\.sourceRole\}:\$\{region\.track\}`/,
  );
  assert.match(canvasSource, /function hitToHover\(hit: ChartHitRegion\): HoverRegion \| null/);
  assert.match(canvasSource, /if \(hit\.kind === "pd_event"\)/);
  assert.match(canvasSource, /return null;[\s\S]*?function clickPointKey/);
  assert.doesNotMatch(
    canvasSource,
    /return \{ kind: "sign", signIndex: 0, longitude: 0 \}/,
  );
  assert.match(hoverSource, /if \(region\.kind === "pd_event"\) return region\.eventId/);
  assert.match(inspectorSource, /"pd_event",/);
  assert.match(inspectorSource, /if \(region\.kind === "pd_event"\) return region\.eventId/);
  assert.match(inspectorSource, /region\.kind !== "pd_event"/);
  assert.match(
    hoverSource,
    /current\?\.identityKey === identityKey \? null : current/,
  );
  assert.match(
    canvasSource,
    /const trackedKey = hoverRegionKey[\s\S]*?hoverRegionKey\(hitToHover\(candidate\)\) === trackedKey/,
  );
  for (const source of [storeSource, canvasSource, hoverSource, inspectorSource]) {
    assert.doesNotMatch(source, /remainingArcDegreesSigned\s*[*+\-/]/);
    assert.doesNotMatch(source, /phase\s*=\s*.*(?:applying|separating)/);
  }

  const keyFunction = storeSource.match(
    /export function hoverRegionKey[\s\S]*?\n}\n\nexport type TransitSearchPaneState/,
  )?.[0].replace(/\n\nexport type TransitSearchPaneState[\s\S]*$/, "");
  assert.ok(keyFunction);
  const keyModule = await import(dataUrl(transpile(`type HoverRegion = any;\n${keyFunction}`)));
  const baseRegion = {
    kind: "pd_event",
    eventId: "pd-event-1",
    eventKind: "body-aspect-to-angle",
    component: "direction-ray",
    partyRole: "promissor",
    sourceRole: "outer",
    track: "outer",
    motion: "moving",
    exactNow: false,
    longitude: 120,
    nativeCoordinate: 121,
    directionState: { phase: "applying" },
  };
  const originalKey = keyModule.hoverRegionKey(baseRegion);
  assert.equal(
    keyModule.hoverRegionKey({
      ...baseRegion,
      exactNow: true,
      longitude: 125,
      nativeCoordinate: 126,
      directionState: { phase: "exact" },
    }),
    originalKey,
    "stepping semantic values must re-anchor the same hovered primitive",
  );
  for (const changed of [
    { component: "directed-angle" },
    { partyRole: "significator" },
    { sourceRole: "primary" },
    { track: "inner" },
  ]) {
    assert.notEqual(keyModule.hoverRegionKey({ ...baseRegion, ...changed }), originalKey);
  }
});
