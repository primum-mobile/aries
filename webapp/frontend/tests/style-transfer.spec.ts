// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  buildElementStylePastePatch,
  buildWheelVariantSyncPatch,
  buildWholeWheelSyncPatch,
  copyElementStyle,
  parseWheelAuthoringOverrideId,
} from "../src/lib/style-lab/style-transfer";

test("element copy and paste maps compatible properties instead of semantic ids", () => {
  const clipboard = copyElementStyle(
    {
      sourceClassId: "fills.chartField",
      sourceLabel: "Chart field",
      sourceProfile: "classic",
    },
    [
      {
        semanticId: "authoring.wheel.classic.fills.chartField.fillPattern",
        property: "effect",
        value: "newsprint",
      },
      {
        semanticId: "authoring.wheel.classic.fills.chartField.patternColor",
        property: "color",
        value: [20, 30, 40, 0.6],
      },
    ],
  );

  expect(buildElementStylePastePatch(clipboard, [
    {
      semanticId: "authoring.wheel.compact.fills.houseField.fillPattern",
      property: "effect",
      value: "solid",
    },
    {
      semanticId: "authoring.wheel.compact.fills.houseField.patternColor",
      property: "color",
      value: [0, 0, 0],
    },
  ])).toEqual({
    "authoring.wheel.compact.fills.houseField.fillPattern": "newsprint",
    "authoring.wheel.compact.fills.houseField.patternColor": [20, 30, 40, 0.6],
  });
});

test("element transfer skips ambiguous generic controls", () => {
  const clipboard = copyElementStyle(
    {
      sourceClassId: "bodies.inner.glyph",
      sourceLabel: "Planet glyphs",
      sourceProfile: "classic",
    },
    [
      { semanticId: "palette.one", property: "color", value: [1, 2, 3] },
      { semanticId: "palette.two", property: "color", value: [4, 5, 6] },
      { semanticId: "authoring.wheel.classic.bodies.inner.glyph.fontSize", property: "font-size", value: 22 },
    ],
  );

  expect(clipboard.entries).toEqual([
    { slot: "authoring:fontSize", value: 22 },
  ]);
});

test("variant sync copies sparse source overrides only to compatible targets", () => {
  const overrides = {
    "authoring.wheel.base.fills.zodiacBand.opacity": 20,
    "authoring.wheel.classic.fills.zodiacBand.fillPattern": "stipple",
    "authoring.wheel.classic.fills.zodiacBand.radius": 450,
    "authoring.wheel.compact.fills.zodiacBand.fillPattern": "solid",
  };

  expect(buildWheelVariantSyncPatch(overrides, {
    classId: "fills.zodiacBand",
    source: "classic",
    targets: ["compact", "anglo"],
    allowedProperties: {
      compact: new Set(["fillPattern", "radius"]),
      anglo: new Set(["fillPattern"]),
    },
  })).toEqual({
    "authoring.wheel.compact.fills.zodiacBand.fillPattern": "stipple",
    "authoring.wheel.compact.fills.zodiacBand.radius": 450,
    "authoring.wheel.anglo.fills.zodiacBand.fillPattern": "stipple",
  });
});

test("authoring ids preserve dotted semantic class names", () => {
  expect(parseWheelAuthoringOverrideId(
    "authoring.wheel.anglo.fills.houseField.shadowPattern",
  )).toEqual({
    scope: "anglo",
    classId: "fills.houseField",
    property: "shadowPattern",
  });
});

test("text font, weight, style, tracking, and class color remain transferable profile-v2 slots", () => {
  const fontRef = {
    role: "symbols" as const,
    source: "bundled" as const,
    family: ["AriesMorinus"],
    cssFamily: '"AriesMorinus"',
    style: "normal",
    weight: 400,
  };
  const clipboard = copyElementStyle(
    {
      sourceClassId: "bodies.inner.glyph",
      sourceLabel: "Planet glyphs",
      sourceProfile: "classic",
    },
    [
      {
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.fontRef",
        property: "font-family",
        value: fontRef,
      },
      {
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.tracking",
        property: "spacing",
        value: 1.25,
      },
      {
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.fontWeight",
        property: "font-weight",
        value: 700,
      },
      {
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.fontStyle",
        property: "font-style",
        value: "italic",
      },
      {
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.color",
        property: "color",
        value: [10, 20, 30, 0.8],
      },
    ],
  );

  expect(clipboard.entries).toEqual([
    { slot: "authoring:fontRef", value: fontRef },
    { slot: "authoring:tracking", value: 1.25 },
    { slot: "authoring:fontWeight", value: 700 },
    { slot: "authoring:fontStyle", value: "italic" },
    { slot: "authoring:color", value: [10, 20, 30, 0.8] },
  ]);
  expect(parseWheelAuthoringOverrideId(
    "authoring.wheel.anglo.chartOverlay.events.header.glyph.fontRef",
  )).toEqual({
    scope: "anglo",
    classId: "chartOverlay.events.header.glyph",
    property: "fontRef",
  });
  expect(parseWheelAuthoringOverrideId(
    "authoring.wheel.houses.houses.inner.label.fontStyle",
  )).toEqual({
    scope: "houses",
    classId: "houses.inner.label",
    property: "fontStyle",
  });
});

test("copying a band's look carries background and pattern but never its size", () => {
  // A ring band selected on the wheel shows its layout width beside its fill
  // class's material.
  const clipboard = copyElementStyle(
    { sourceClassId: "fills.zodiacBand", sourceLabel: "Zodiac band", sourceProfile: "classic" },
    [
      { semanticId: "authoring.wheel.classic.canvas.ring.zodiac.bandWidth", property: "radius", value: 48 },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.backgroundColor", property: "color", value: [10, 20, 30] },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.fillPattern", property: "effect", value: "stipple" },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.patternColor", property: "color", value: [200, 180, 90, 0.5] },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.density", property: "density", value: 0.7 },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.cellSize", property: "spacing", value: 9 },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.dotSize", property: "size", value: 1.4 },
      { semanticId: "authoring.wheel.base.fills.zodiacBand.seed", property: "seed", value: 17 },
    ],
  );
  expect(clipboard.entries.map((entry) => entry.slot)).not.toContain("authoring:bandWidth");

  expect(buildElementStylePastePatch(clipboard, [
    { semanticId: "authoring.wheel.classic.canvas.ring.term.bandWidth", property: "radius", value: 20 },
    { semanticId: "authoring.wheel.base.fills.termBand.backgroundColor", property: "color", value: [0, 0, 0] },
    { semanticId: "authoring.wheel.base.fills.termBand.fillPattern", property: "effect", value: "solid" },
    { semanticId: "authoring.wheel.base.fills.termBand.patternColor", property: "color", value: [0, 0, 0] },
    { semanticId: "authoring.wheel.base.fills.termBand.density", property: "density", value: 0.2 },
    { semanticId: "authoring.wheel.base.fills.termBand.cellSize", property: "spacing", value: 4 },
    { semanticId: "authoring.wheel.base.fills.termBand.dotSize", property: "size", value: 1.4 },
    { semanticId: "authoring.wheel.base.fills.termBand.seed", property: "seed", value: 3 },
  ])).toEqual({
    "authoring.wheel.base.fills.termBand.backgroundColor": [10, 20, 30],
    "authoring.wheel.base.fills.termBand.fillPattern": "stipple",
    "authoring.wheel.base.fills.termBand.patternColor": [200, 180, 90, 0.5],
    "authoring.wheel.base.fills.termBand.density": 0.7,
    "authoring.wheel.base.fills.termBand.cellSize": 9,
    "authoring.wheel.base.fills.termBand.seed": 17,
  });
});

test("an authoring property shown twice is pasted to both controls", () => {
  const clipboard = copyElementStyle(
    { sourceClassId: "fills.houseField", sourceLabel: "House field", sourceProfile: "classic" },
    [{ semanticId: "authoring.wheel.base.fills.houseField.backgroundColor", property: "color", value: [1, 2, 3] }],
  );
  expect(buildElementStylePastePatch(clipboard, [
    { semanticId: "authoring.wheel.base.fills.chartField.backgroundColor", property: "color", value: [0, 0, 0] },
    { semanticId: "authoring.wheel.classic.fills.chartField.backgroundColor", property: "color", value: [0, 0, 0] },
  ])).toEqual({
    "authoring.wheel.base.fills.chartField.backgroundColor": [1, 2, 3],
    "authoring.wheel.classic.fills.chartField.backgroundColor": [1, 2, 3],
  });
});

test("pasting a background onto the Anglo zodiac band sends only colours the daemon stores", () => {
  // Pasting a copied texture/colour background made the daemon refuse
  // "authoring.wheel.anglo.fills.zodiacBand.backgroundColor must be an RGB or
  // RGBA array" because a displayed CSS colour had travelled as text.
  const target = "authoring.wheel.anglo.fills.zodiacBand";
  const fromCss = copyElementStyle(
    { sourceClassId: "fills.houseField", sourceLabel: "House field", sourceProfile: "anglo" },
    [{ semanticId: "authoring.wheel.anglo.fills.houseField.backgroundColor", property: "color", kind: "color", value: "#336699" }],
  );
  expect(buildElementStylePastePatch(fromCss, [
    { semanticId: `${target}.backgroundColor`, property: "color", kind: "color", value: [0, 0, 0] },
  ])).toEqual({});

  const fromStored = copyElementStyle(
    { sourceClassId: "fills.houseField", sourceLabel: "House field", sourceProfile: "anglo" },
    [
      { semanticId: "authoring.wheel.anglo.fills.houseField.backgroundColor", property: "color", kind: "color", value: [51, 102, 153] },
      { semanticId: "authoring.wheel.anglo.fills.houseField.patternColor", property: "color", kind: "color", value: "{renderer.wheel.color.frame}" },
      { semanticId: "authoring.wheel.anglo.fills.houseField.fillPattern", property: "effect", value: "stipple" },
    ],
  );
  expect(buildElementStylePastePatch(fromStored, [
    { semanticId: `${target}.backgroundColor`, property: "color", kind: "color", value: [0, 0, 0] },
    { semanticId: `${target}.patternColor`, property: "color", kind: "color", value: [0, 0, 0] },
    { semanticId: `${target}.fillPattern`, property: "effect", value: "solid" },
  ])).toEqual({
    [`${target}.backgroundColor`]: [51, 102, 153],
    [`${target}.patternColor`]: "{renderer.wheel.color.frame}",
    [`${target}.fillPattern`]: "stipple",
  });
});

test("syncing a band's texture from Anglo reaches Classic, shared or per-style", () => {
  const anglo = "authoring.wheel.anglo.fills.zodiacBand";
  const classic = "authoring.wheel.classic.fills.zodiacBand";
  const base = "authoring.wheel.base.fills.zodiacBand";
  const allowedProperties = {
    classic: new Set(["backgroundColor", "fillPattern", "patternColor", "density", "cellSize", "dotSize", "seed"] as const),
  };
  // Anglo's look: its own background and pattern colour over a texture shared
  // by all wheel styles. Classic masks the shared texture with its own.
  const overrides = {
    [`${base}.fillPattern`]: "stipple",
    [`${base}.density`]: 0.7,
    [`${anglo}.backgroundColor`]: [10, 20, 30],
    [`${anglo}.patternColor`]: [200, 180, 90, 0.5],
    [`${classic}.fillPattern`]: "solid",
    [`${classic}.seed`]: 4,
  };
  const patch = buildWheelVariantSyncPatch(overrides, {
    classId: "fills.zodiacBand",
    source: "anglo",
    targets: ["classic"],
    allowedProperties,
  });
  expect(patch).toEqual({
    [`${classic}.backgroundColor`]: [10, 20, 30],
    [`${classic}.patternColor`]: [200, 180, 90, 0.5],
    // The shared texture shows again on Classic.
    [`${classic}.fillPattern`]: "stipple",
    // Anglo shows the factory seed, so Classic's own seed goes.
    [`${classic}.seed`]: null,
  });

  // Applying the patch makes Classic show exactly what Anglo shows.
  const synced: Record<string, unknown> = { ...overrides };
  for (const [id, value] of Object.entries(patch)) {
    if (value === null) delete synced[id];
    else synced[id] = value;
  }
  for (const property of allowedProperties.classic) {
    expect(synced[`${classic}.${property}`] ?? synced[`${base}.${property}`])
      .toEqual(synced[`${anglo}.${property}`] ?? synced[`${base}.${property}`]);
  }
  // Nothing left to sync the second time.
  expect(buildWheelVariantSyncPatch(synced as typeof overrides, {
    classId: "fills.zodiacBand", source: "anglo", targets: ["classic"], allowedProperties,
  })).toEqual({});
});

test("using the Anglo look on all wheel styles syncs every class, appearance only", () => {
  const overrides = {
    "authoring.wheel.anglo.fills.zodiacBand.backgroundColor": [10, 20, 30],
    "authoring.wheel.anglo.fills.houseField.fillPattern": "stipple",
    "authoring.wheel.classic.fills.houseField.fillPattern": "solid",
    "authoring.wheel.compact.fills.zodiacBand.backgroundColor": [10, 20, 30],
  };
  const fills = new Set(["backgroundColor", "fillPattern"] as const);
  expect(buildWholeWheelSyncPatch(overrides, "anglo", [
    { classId: "fills.zodiacBand", targets: ["classic", "compact"], allowedProperties: { classic: fills, compact: fills } },
    { classId: "fills.houseField", targets: ["classic", "compact"], allowedProperties: { classic: fills, compact: fills } },
  ])).toEqual({
    "authoring.wheel.classic.fills.zodiacBand.backgroundColor": [10, 20, 30],
    "authoring.wheel.classic.fills.houseField.fillPattern": "stipple",
    "authoring.wheel.compact.fills.houseField.fillPattern": "stipple",
  });
});
