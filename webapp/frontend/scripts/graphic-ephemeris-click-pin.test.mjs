// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris click -> Inspector pin: a click on a curve, ring, contact
// or natal line pins its Inspector info the way a wheel click does
// (inspectorActiveRegion); the same target again or empty plate releases it,
// and a drag (pan) pins nothing.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ephemerisRadixInspectorRegion,
  nextEphemerisPin,
} from "../src/lib/chart/ephemeris-inspector-region.ts";

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const none = { planet: null, radixKey: null };

test("a click pins its curve, the same curve again or empty plate releases it", () => {
  const mars = nextEphemerisPin(none, { planet: 4, radixKey: null }, false);
  assert.deepEqual(mars, { planet: 4, radixKey: null });
  assert.deepEqual(nextEphemerisPin(mars, { planet: 4, radixKey: null }, false), none);
  assert.deepEqual(nextEphemerisPin(mars, { planet: 0, radixKey: null }, false), { planet: 0, radixKey: null });
  assert.deepEqual(nextEphemerisPin(mars, { planet: null, radixKey: null }, false), none);
});

test("off every curve a natal line pins the same way, and a curve replaces it", () => {
  const asc = nextEphemerisPin(none, { planet: null, radixKey: "asc" }, false);
  assert.deepEqual(asc, { planet: null, radixKey: "asc" });
  assert.deepEqual(nextEphemerisPin(asc, { planet: null, radixKey: "asc" }, false), none);
  assert.deepEqual(nextEphemerisPin(asc, { planet: null, radixKey: "sun" }, false), { planet: null, radixKey: "sun" });
  assert.deepEqual(nextEphemerisPin(asc, { planet: 1, radixKey: null }, false), { planet: 1, radixKey: null });
  assert.deepEqual(nextEphemerisPin(asc, none, false), none);
});

test("a drag pins and releases nothing", () => {
  const pinned = { planet: 4, radixKey: null };
  assert.equal(nextEphemerisPin(pinned, { planet: 0, radixKey: null }, true), null);
  assert.equal(nextEphemerisPin(pinned, none, true), null);
  assert.equal(nextEphemerisPin(none, { planet: null, radixKey: "mc" }, true), null);
});

test("a natal line is its natal point in the live radix document", () => {
  assert.deepEqual(ephemerisRadixInspectorRegion({ key: "sun", kind: "planet", lon: 12.5, seId: 0 }, "radix-1"), {
    kind: "planet", planetId: "sun", seId: 0, longitude: 12.5, latitude: 0, speed: 0, viewDocumentId: "radix-1",
  });
  assert.deepEqual(ephemerisRadixInspectorRegion({ key: "asc", kind: "angle", lon: 200 }, "radix-1"), {
    kind: "angle", angleId: "asc", longitude: 200, viewDocumentId: "radix-1",
  });
  for (const kind of ["fortune", "vertex", "syzygy", "eclipse"]) {
    assert.deepEqual(ephemerisRadixInspectorRegion({ key: kind, kind, lon: 5 }, "radix-1"), { kind, longitude: 5, viewDocumentId: "radix-1" });
  }
  // Midpoints, a body without its SE id and a view with no radix name none.
  assert.equal(ephemerisRadixInspectorRegion({ key: "sun/moon", kind: "midpoint", lon: 5 }, "radix-1"), null);
  assert.equal(ephemerisRadixInspectorRegion({ key: "sun", kind: "planet", lon: 5 }, "radix-1"), null);
  assert.equal(ephemerisRadixInspectorRegion({ key: "sun", kind: "planet", lon: 5, seId: 0 }, null), null);
  assert.equal(ephemerisRadixInspectorRegion(null, "radix-1"), null);
});

test("the view pins through the wheel's inspector pin and keeps both pins in sync", async () => {
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  // The wheel's click rule: pin into an open Inspector, or on a phone.
  assert.match(view, /if \(!useFrameLayoutStore\.getState\(\)\.inspectorOpen && !mobileLayoutMatches\(\)\) return;/);
  assert.match(view, /workspace\.setInspectorActiveRegion\(release \? null : region\);/);
  // The release decides from the drag, and pins what hover shows there.
  assert.match(view, /const next = nextEphemerisPin\(\n\s*\{ planet: pinnedPlanetRef\.current, radixKey: pinnedRadixRef\.current \},\n\s*\{ planet, radixKey \},\n\s*drag\.moved,\n\s*\);\n\s*if \(!next\) return;/);
  assert.match(view, /pinInspector\(release \? null : inspectorRegionAt\(hit, e\.clientX, e\.clientY\), release\);/);
  // Hover and click share one region path; a natal line names its point.
  assert.match(view, /return ephemerisRadixInspectorRegion\(point, radixDocumentId\);/);
  // Plate pin released -> Inspector pin released; Inspector pin replaced -> plate released.
  assert.match(view, /if \(hoverRegionKey\(workspace\.inspectorActiveRegion\) === ownPinKeyRef\.current\) workspace\.setInspectorActiveRegion\(null\);/);
  assert.match(view, /useWorkspaceStore\.subscribe\(\(state, previous\) => \{/);
  // The panel keeps a pinned region in front of hover, as for the wheel.
  const panel = await read("components/workshell/inspector-panel.tsx");
  assert.match(panel, /const selectedRegion = pinned \?\? hovered;/);
});

test("natal body lines carry their SE id from the daemon", async () => {
  const radix = await read("lib/chart/ephemeris-radix.ts");
  assert.match(radix, /\.\.\.\(Number\.isInteger\(p\.seId\) \? \{ seId: Number\(p\.seId\) \} : \{\}\),/);
});
