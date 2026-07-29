// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  buildElementStylePastePatch,
  buildWheelVariantSyncPatch,
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

test("text font, tracking, and class color remain transferable profile-v2 slots", () => {
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
        semanticId: "authoring.wheel.classic.bodies.inner.glyph.color",
        property: "color",
        value: [10, 20, 30, 0.8],
      },
    ],
  );

  expect(clipboard.entries).toEqual([
    { slot: "authoring:fontRef", value: fontRef },
    { slot: "authoring:tracking", value: 1.25 },
    { slot: "authoring:color", value: [10, 20, 30, 0.8] },
  ]);
  expect(parseWheelAuthoringOverrideId(
    "authoring.wheel.anglo.chartOverlay.events.header.glyph.fontRef",
  )).toEqual({
    scope: "anglo",
    classId: "chartOverlay.events.header.glyph",
    property: "fontRef",
  });
});
