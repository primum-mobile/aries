// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/chart/palette.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  applyProfileColorsToSnapshot,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
} = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

function chart({ individual = false } = {}) {
  return {
    meta: {},
    angles: {},
    houses: {},
    aspects: [],
    planets: [
      { id: "sun", seId: 0, dignity: "domicil", color: "old-sun" },
      { id: "chiron", seId: 15, dignity: "domicil", color: "old-chiron" },
    ],
    fortune: { longitude: 0, color: "old-fortune" },
    vertex: { longitude: 0, color: "old-vertex" },
    syzygy: { longitude: 0, color: "old-syzygy" },
    options: { useDignityColors: individual, signColors: ["old-sign"] },
  };
}

const theme = {
  chartPalette: {
    "--morinus-body-sun": "named-profile-sun",
    "--morinus-aspect-conjunction": "named-profile-conjunction",
  },
  profileOverrides: {
    appTokens: {},
    chartPalette: {
      "--morinus-signs": "profile-sign",
      "--morinus-peregrin": "profile-peregrin",
      "--morinus-dignity-domicil": "profile-domicile",
      "--morinus-body-sun": "named-profile-sun",
      "--morinus-aspect-conjunction": "named-profile-conjunction",
    },
    chartData: {
      planets: Array.from({ length: 13 }, (_, index) => `profile-planet-${index}`),
      aspects: ["profile-aspect"],
      signColors: Array.from({ length: 12 }, (_, index) => `profile-sign-${index}`),
    },
  },
};

test("profile data arrays join scalar chart overrides at final palette precedence", () => {
  const palette = readPaletteProfileOverrides(theme);
  assert.equal(palette.domicil, "profile-domicile");
  assert.equal(palette.planets[12], "profile-planet-12");
  assert.deepEqual(palette.aspects, ["profile-aspect"]);
});

test("named body and aspect roles are concrete palette fallbacks", () => {
  const namedTheme = {
    chartPalette: {
      "--morinus-frame": "named-frame",
      "--morinus-text-bright": "named-text",
      "--morinus-peregrin": "named-peregrin",
      "--morinus-body-sun": "named-sun",
      "--morinus-body-moon": "named-moon",
      "--morinus-aspect-parallel": "named-parallel",
    },
    profileOverrides: {
      appTokens: {},
      chartPalette: {
        "--morinus-body-sun": "named-sun",
        "--morinus-aspect-parallel": "named-parallel",
      },
      chartData: {},
    },
  };
  const base = readPaletteFromTheme(namedTheme);
  const profile = readPaletteProfileOverrides(namedTheme);

  assert.equal(base.planets[0], "named-sun");
  assert.equal(base.planets[1], "named-moon");
  assert.equal(base.aspects[12], "named-parallel");
  assert.equal(base.aspects[13], "named-frame");
  assert.equal(profile.planets[0], "named-sun");
  assert.equal(profile.planets[1], "named-moon");
  assert.equal(profile.aspects[12], "named-parallel");
});

test("retained dignity and point colors receive the active profile layer", () => {
  const original = chart();
  const comparison = chart({ individual: true });
  const snapshot = { primaryChart: original, comparisonChart: comparison };
  const resolved = applyProfileColorsToSnapshot(snapshot, theme);

  assert.notStrictEqual(resolved, snapshot);
  assert.equal(resolved.primaryChart.planets[0].color, "profile-domicile");
  assert.equal(resolved.primaryChart.planets[1].color, "profile-peregrin");
  assert.equal(resolved.primaryChart.fortune.color, "profile-peregrin");
  assert.equal(resolved.primaryChart.vertex.color, "profile-peregrin");
  assert.equal(resolved.primaryChart.syzygy.color, "profile-sign");
  assert.deepEqual(resolved.primaryChart.options.signColors, theme.profileOverrides.chartData.signColors);
  assert.equal(resolved.comparisonChart.planets[0].color, "profile-planet-0");
  assert.equal(resolved.comparisonChart.planets[1].color, "profile-planet-12");
  assert.equal(resolved.comparisonChart.fortune.color, "profile-planet-11");
  assert.equal(original.planets[0].color, "old-sun");
  assert.deepEqual(original.options.signColors, ["old-sign"]);
});

test("without an active profile layer the retained snapshot identity is preserved", () => {
  const snapshot = { primaryChart: chart() };
  assert.strictEqual(
    applyProfileColorsToSnapshot(snapshot, {
      profileOverrides: { appTokens: {}, chartPalette: {}, chartData: {} },
    }),
    snapshot,
  );
});

test("named element roles provide a sign-color fallback when chartData is absent", () => {
  const elementTheme = {
    chartPalette: {
      "--morinus-element-fire": "fire",
      "--morinus-element-earth": "earth",
      "--morinus-element-air": "air",
      "--morinus-element-water": "water",
    },
    profileOverrides: {
      appTokens: {},
      chartPalette: { "--morinus-element-fire": "fire" },
      chartData: {},
    },
  };
  const resolved = applyProfileColorsToSnapshot(
    { primaryChart: chart() },
    elementTheme,
  );
  assert.deepEqual(resolved.primaryChart.options.signColors, [
    "fire", "earth", "air", "water",
    "fire", "earth", "air", "water",
    "fire", "earth", "air", "water",
  ]);
});
