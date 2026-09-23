// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contract for the wheel's ANGULAR model (`src/lib/chart/wheel-projection.ts`)
 * and its seam in `polar()`.
 *
 * The house wheel is a continuous remap, not a relocation: every longitude has
 * an image, the map is invertible, and it degrades to the identity whenever the
 * cusps cannot define a ring. These are the invariants the renderer relies on —
 * hit testing inverts the same map, so a projection that is not a bijection
 * would make the wheel unclickable in exactly the places it looks right.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpileFile = async (relative) =>
  ts.transpileModule(
    await readFile(new URL(relative, import.meta.url), "utf8"),
    { compilerOptions },
  ).outputText;

const projectionUrl = dataUrl(
  await transpileFile("../src/lib/chart/wheel-projection.ts"),
);
const {
  IDENTITY_PROJECTION,
  identityFrame,
  houseWheelProjection,
  wheelFrameForTheme,
} = await import(projectionUrl);

const chartFontsUrl = dataUrl(
  await transpileFile("../src/lib/chart/chart-fonts.ts"),
);
const { polar } = await import(
  dataUrl(
    (await transpileFile("../src/lib/chart/canvas-draw.ts"))
      .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`),
  )
);

// Placidus cusps for a mid-latitude nativity: unequal houses, wrapping past 0.
const UNEQUAL_CUSPS = [
  109.146, 140.113, 168.658, 196.289, 225.203, 256.596,
  289.146, 320.113, 348.658, 16.289, 45.203, 76.596,
];
const EQUAL_CUSPS = Array.from({ length: 12 }, (_, i) => (119.5 + i * 30) % 360);

const norm = (deg) => ((deg % 360) + 360) % 360;
const angularDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test("the identity projection is the zodiac-fixed wheel", () => {
  assert.equal(IDENTITY_PROJECTION.isIdentity, true);
  for (const lon of [0, 29.9, 180, 359.99]) {
    assert.equal(IDENTITY_PROJECTION.project(lon), lon);
    assert.equal(IDENTITY_PROJECTION.unproject(lon), lon);
  }
  const frame = identityFrame(119.87);
  assert.equal(frame.rotation, 119.87);
  assert.equal(frame.projection, IDENTITY_PROJECTION);
});

test("only House Wheel normalizes houses; Cusp Wheel preserves their spans", () => {
  const rotation = UNEQUAL_CUSPS[0];
  const houseFrame = wheelFrameForTheme(3, UNEQUAL_CUSPS, rotation);
  const cuspFrame = wheelFrameForTheme(4, UNEQUAL_CUSPS, rotation);

  assert.equal(houseFrame.projection.isIdentity, false);
  assert.equal(cuspFrame.projection, IDENTITY_PROJECTION);
  UNEQUAL_CUSPS.forEach((cusp, index) => {
    assert.ok(
      angularDelta(houseFrame.projection.project(cusp), norm(rotation + index * 30)) < 1e-9,
    );
    assert.equal(cuspFrame.projection.project(cusp), cusp);
  });
});

test("every house cusp lands on its own 30-degree boundary", () => {
  const anchor = UNEQUAL_CUSPS[0];
  const projection = houseWheelProjection(UNEQUAL_CUSPS, anchor);
  assert.equal(projection.isIdentity, false);
  UNEQUAL_CUSPS.forEach((cusp, index) => {
    assert.ok(
      angularDelta(projection.project(cusp), norm(anchor + index * 30)) < 1e-9,
      `cusp ${index + 1} must sit at ${index * 30} degrees from the anchor`,
    );
  });
});

test("a house's interior maps proportionally onto its wedge", () => {
  const anchor = 0;
  const projection = houseWheelProjection(UNEQUAL_CUSPS, anchor);
  for (let index = 0; index < 12; index++) {
    const start = UNEQUAL_CUSPS[index];
    const span = norm(UNEQUAL_CUSPS[(index + 1) % 12] - start);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const drawn = projection.project(norm(start + span * fraction));
      const expected = norm(anchor + index * 30 + fraction * 30);
      assert.ok(
        angularDelta(drawn, expected) < 1e-9,
        `house ${index + 1} at ${fraction} of its span`,
      );
    }
  }
});

test("the map is a bijection, so hit testing can invert it", () => {
  const projection = houseWheelProjection(UNEQUAL_CUSPS, 119.87);
  for (let lon = 0; lon < 360; lon += 0.37) {
    const round = projection.unproject(projection.project(lon));
    assert.ok(
      angularDelta(round, lon) < 1e-9,
      `round trip failed at ${lon}`,
    );
  }
  for (let drawn = 0; drawn < 360; drawn += 0.41) {
    const round = projection.project(projection.unproject(drawn));
    assert.ok(
      angularDelta(round, drawn) < 1e-9,
      `inverse round trip failed at ${drawn}`,
    );
  }
});

test("equal houses make the house wheel identical to the zodiac-fixed wheel", () => {
  // Nothing is distorted when the houses are already 30 degrees wide, so the
  // two layouts must agree exactly rather than merely look similar.
  const projection = houseWheelProjection(EQUAL_CUSPS, EQUAL_CUSPS[0]);
  for (let lon = 0; lon < 360; lon += 0.5) {
    assert.ok(
      angularDelta(projection.project(lon), lon) < 1e-9,
      `equal-house projection moved ${lon}`,
    );
  }
});

test("degenerate cusps fall back to the identity instead of scrambling the wheel", () => {
  const cases = {
    "wrong count": [0, 30, 60],
    "not a number": [Number.NaN, ...UNEQUAL_CUSPS.slice(1)],
    "zero-width house": [0, 0, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
    "not in ring order": [0, 330, 300, 270, 240, 210, 180, 150, 120, 90, 60, 30],
  };
  for (const [name, cusps] of Object.entries(cases)) {
    assert.equal(
      houseWheelProjection(cusps, 0),
      IDENTITY_PROJECTION,
      `${name} must degrade to the identity`,
    );
  }
});

test("the projection id changes with the cusps, so render caches cannot stale", () => {
  const a = houseWheelProjection(UNEQUAL_CUSPS, 0);
  const b = houseWheelProjection(UNEQUAL_CUSPS, 0);
  const moved = houseWheelProjection(
    [UNEQUAL_CUSPS[0] + 1, ...UNEQUAL_CUSPS.slice(1)],
    0,
  );
  const rotated = houseWheelProjection(UNEQUAL_CUSPS, 10);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, moved.id);
  assert.notEqual(a.id, rotated.id);
  assert.notEqual(a.id, IDENTITY_PROJECTION.id);
});

test("polar() accepts a bare rotation and a frame, and seats cusp 1 at the left", () => {
  const center = [200, 200];
  const rotation = UNEQUAL_CUSPS[0];

  // A bare number must still draw the pre-projection wheel exactly.
  for (const lon of [0, 45, 119.87, 270]) {
    assert.deepEqual(
      polar(center, 100, lon, rotation),
      polar(center, 100, lon, identityFrame(rotation)),
    );
  }

  // The wheel orientation contract: the rotation longitude sits at canvas left.
  const frame = {
    rotation,
    projection: houseWheelProjection(UNEQUAL_CUSPS, rotation),
  };
  const [x, y] = polar(center, 100, UNEQUAL_CUSPS[0], frame);
  assert.ok(Math.abs(x - (center[0] - 100)) < 1e-9);
  assert.ok(Math.abs(y - center[1]) < 1e-9);

  // Cusp 7 is half the circle away by construction, whatever its longitude.
  const [x7, y7] = polar(center, 100, UNEQUAL_CUSPS[6], frame);
  assert.ok(Math.abs(x7 - (center[0] + 100)) < 1e-9);
  assert.ok(Math.abs(y7 - center[1]) < 1e-9);
});

test("fixed screen shapes are offset after projection, never before", () => {
  // An arrowhead's half-width is a drawing shape. Offsetting the LONGITUDE by it
  // and then projecting stretches the head by the local house scale, and an
  // angle sits exactly on a cusp — so its two sides take the scales of two
  // different houses and the head comes out skewed. Measured on a real chart:
  // 0.489 deg on one side against 0.647 on the other, for an authored 0.5.
  const projection = houseWheelProjection(UNEQUAL_CUSPS, UNEQUAL_CUSPS[0]);
  const half = 0.5;
  const delta = (a, b) => ((a - b + 540) % 360) - 180;
  for (const cusp of UNEQUAL_CUSPS) {
    const wrong = [
      delta(projection.project(cusp), projection.project(cusp - half)),
      delta(projection.project(cusp + half), projection.project(cusp)),
    ];
    assert.ok(
      Math.abs(wrong[0] - wrong[1]) > 1e-6,
      "the cusp fixture must actually straddle two differently scaled houses",
    );
    const drawn = projection.project(cusp);
    assert.ok(Math.abs(delta(drawn, drawn - half) - half) < 1e-9);
    assert.ok(Math.abs(delta(drawn + half, drawn) - half) < 1e-9);
  }
});

test("every arrowhead in the renderer is built through the shared helper", async () => {
  const source = await readFile(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
    "utf8",
  );
  // Both paint sites and the hit-region mirror must go through arrowPoint, or a
  // head and its click target drift apart on the House Wheel.
  assert.match(source, /function arrowPoint\(/);
  const vertices = source.slice(source.indexOf("function angleArrowVertices("), source.indexOf("function paintAngleArrow("));
  assert.match(vertices, /arrowPoint\(center, geometry\.baseRadius, lon, 0, asc\)/);
  assert.match(vertices, /arrowPoint\(\[0, 0\], 1, lon, 0, asc\)/);
  assert.match(vertices, /arrowPoint\(center, geometry\.apexRadius, lon, 0, asc\)/);
  assert.match(source, /const \[left, right, apex\] = angleArrowVertices\(center, lon, asc, geometry\)/);
  assert.match(source, /const \[left, right, apex\] = angleArrowVertices\(center, longitude, asc, geometry\)/);
  // The old shape: offsetting the longitude and letting polar project it.
  for (const bad of [
    "lon - arrows.halfAngleDegrees",
    "lon + arrows.halfAngleDegrees",
    "lon - arrows.angloHalfAngleDegrees",
    "lon + arrows.angloHalfAngleDegrees",
    "longitude - style.strokes.arrows.halfAngleDegrees",
    "longitude + style.strokes.arrows.halfAngleDegrees",
  ]) {
    assert.ok(!source.includes(bad), `projection-space arrowhead offset: ${bad}`);
  }
});
