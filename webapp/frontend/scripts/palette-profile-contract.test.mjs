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
const javascript = ts.transpileModule(source.replace(
  'import dignityDisplayPolicy from "./dignity-display-policy.json";',
  `const dignityDisplayPolicy = ${await readFile(new URL("../src/lib/chart/dignity-display-policy.json", import.meta.url), "utf8")};`,
), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  applyProfileColorsToSnapshot,
  readPaletteFromTheme,
  readPaletteProfileOverrides,
  withSettingsColorPreview,
  withMinorDignityColors,
  minorDignityPaletteColor,
  settingsColorPreviewMatchesTheme,
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
    options: { useDignityColors: individual, useZodiacElementColors: true, signColors: ["old-sign"] },
  };
}

const theme = {
  appTokens: {},
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
    wheelAuthoring: {
      "authoring.wheel.base.signs.color": [1, 2, 3],
    },
    wheelColorRoleAliases: {
      "authoring.wheel.base.signs.color": "--morinus-element-fire",
    },
  },
};

test("Settings gamut preview repaints every palette authority without changing saved theme", () => {
  const fire = withSettingsColorPreview(theme, {
    attr: "clrsignelementfire", rgb: [11, 22, 33], revision: 1,
  });
  assert.equal(fire.chartPalette["--morinus-element-fire"], "rgb(11 22 33)");
  assert.equal(fire.profileOverrides.chartPalette["--morinus-element-fire"], "rgb(11 22 33)");
  assert.equal(fire.profileOverrides.chartData.signColors[0], "rgb(11 22 33)");
  assert.equal(fire.profileOverrides.chartData.signColors[4], "rgb(11 22 33)");
  assert.deepEqual(fire.profileOverrides.wheelAuthoring["authoring.wheel.base.signs.color"], [11, 22, 33]);
  assert.equal(theme.profileOverrides.chartData.signColors[0], "profile-sign-0");

  const body = withSettingsColorPreview(theme, {
    attr: "clrindividual", index: 12, rgb: [4, 5, 6], revision: 2,
  });
  assert.equal(readPaletteProfileOverrides(body).planets[12], "rgb(4 5 6)");
  const aspect = withSettingsColorPreview(theme, {
    attr: "clraspect", index: 0, rgb: [7, 8, 9], revision: 3,
  });
  assert.equal(readPaletteProfileOverrides(aspect).aspects[0], "rgb(7 8 9)");
  const chrome = withSettingsColorPreview({ ...theme, mode: "light" }, {
    attr: "clrbackground", rgb: [10, 20, 30], revision: 4,
  });
  assert.equal(chrome.mode, "dark");
  assert.equal(chrome.appTokens["--aries-background"], "rgb(10 20 30)");
  assert.equal(chrome.chartPalette["--morinus-background"], "rgb(10 20 30)");
  assert.equal(settingsColorPreviewMatchesTheme(chrome, {
    attr: "clrbackground", rgb: [10, 20, 30], revision: 4,
  }), true);
  assert.equal(settingsColorPreviewMatchesTheme(theme, {
    attr: "clrbackground", rgb: [10, 20, 30], revision: 4,
  }), false);
});

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

test("profile foreground and background rederive dim overlay text", () => {
  const profile = readPaletteProfileOverrides({
    chartPalette: {
      "--morinus-background": "rgb(35 36 40)",
      "--morinus-text-bright": "rgb(220 220 221)",
      "--morinus-text-dim": "rgb(120 121 123)",
    },
    profileOverrides: {
      appTokens: {},
      chartPalette: {
        "--morinus-background": "rgb(255 255 255)",
        "--morinus-text-bright": "rgb(0 0 0)",
      },
      chartData: {},
    },
  });

  assert.equal(profile.textBright, "rgb(0 0 0)");
  assert.equal(profile.textDim, "rgb(128 128 128)");
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

test("profile color mode replaces stale retained snapshot mode", () => {
  const midnightTheme = {
    ...theme,
    profileOverrides: {
      ...theme.profileOverrides,
      chartData: {
        ...theme.profileOverrides.chartData,
        usePlanetColors: false,
      },
    },
  };
  const resolved = applyProfileColorsToSnapshot(
    { primaryChart: chart({ individual: true }) },
    midnightTheme,
  );

  assert.equal(resolved.primaryChart.options.useDignityColors, false);
  assert.equal(resolved.primaryChart.planets[0].color, "profile-domicile");
  assert.equal(resolved.primaryChart.planets[1].color, "profile-peregrin");
  assert.equal(resolved.primaryChart.fortune.color, "profile-peregrin");
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

test("element profile colors do not override a disabled Settings glyph switch", () => {
  const plain = chart();
  plain.options.useZodiacElementColors = false;
  const resolved = applyProfileColorsToSnapshot(
    { primaryChart: plain },
    {
      chartPalette: {
        "--morinus-signs": "plain-sign",
        "--morinus-element-fire": "fire",
      },
      profileOverrides: {
        appTokens: {},
        chartPalette: {
          "--morinus-signs": "plain-sign",
          "--morinus-element-fire": "fire",
        },
        chartData: { signColors: Array.from({ length: 12 }, () => "fire") },
      },
    },
  );
  assert.deepEqual(resolved.primaryChart.options.signColors, Array(12).fill("plain-sign"));
});

test("minor dignity colors follow the live role pair and switch in every retained ring", () => {
  const minorChart = {
    ...chart(),
    palette: { peregrin: 'rgb(100 100 100)', domicil: 'rgb(0 200 0)' },
    planets: [0, 1, 2, 3].map(count => ({
      id: 'mercury', seId: 2, dignity: 'peregrin', minorDignityCount: count,
      color: count ? 'old-color' : 'rgb(100 100 100)',
    })),
  };
  const snapshot = { primaryChart: minorChart, comparisonChart: minorChart, rings: [minorChart] };
  const enabledTheme = {
    chartPalette: { "--morinus-peregrin": "rgb(100 100 100)", "--morinus-dignity-domicil": "rgb(0 200 0)" },
    profileOverrides: { chartPalette: {}, chartData: { blendMinorDignities: true } },
  };
  const enabled = applyProfileColorsToSnapshot(snapshot, enabledTheme);
  const expected = ['rgb(100 100 100)', 'rgb(70 130 70)', 'rgb(40 160 40)', 'rgb(20 180 20)'];
  for (const c of [enabled.primaryChart, enabled.comparisonChart, ...enabled.rings]) {
    assert.deepEqual(c.planets.map(p => p.color), expected);
  }
  const disabled = applyProfileColorsToSnapshot(enabled, {
    ...enabledTheme,
    profileOverrides: { chartPalette: {}, chartData: { blendMinorDignities: false } },
  });
  assert.deepEqual(disabled.primaryChart.planets.map(p => p.color), Array(4).fill('rgb(100 100 100)'));
  const changedRole = applyProfileColorsToSnapshot(enabled, {
    ...enabledTheme,
    profileOverrides: {
      chartPalette: { '--morinus-dignity-domicil': 'rgb(200 0 0)' },
      chartData: { blendMinorDignities: true },
    },
  });
  assert.equal(changedRole.primaryChart.planets[1].color, 'rgb(130 70 70)');
  assert.equal(minorChart.planets[1].color, 'old-color');
  const roles = withMinorDignityColors({
    '--morinus-peregrin': 'rgb(100 100 100)', '--morinus-dignity-domicil': 'rgb(0 200 0)',
  }, true);
  assert.equal(roles['--morinus-minor-dignity-2'], 'rgb(40 160 40)');
  const preview = withMinorDignityColors({
    ...roles, '--morinus-dignity-domicil': 'rgb(200 0 0)',
  }, true);
  assert.equal(preview['--morinus-minor-dignity-2'], 'rgb(160 40 40)');
  assert.equal(withMinorDignityColors(preview, false)['--morinus-minor-dignity-2'], 'rgb(100 100 100)');
});


test("minor planet consumers select resolved global colors without blending again", () => {
  const palette = { peregrin: "neutral", domicil: "positive", minorDignities: ["global-one", "global-two", "global-three"] };
  assert.equal(minorDignityPaletteColor(palette, 1, true), "global-one");
  assert.equal(minorDignityPaletteColor(palette, 2, true), "global-two");
  assert.equal(minorDignityPaletteColor(palette, 3, true), "global-three");
  assert.equal(minorDignityPaletteColor(palette, 3, false), "neutral");
});


test("retained wheel options adopt the subdivision color switch immediately", () => {
  const snapshot = { primaryChart: chart(), comparisonChart: chart() };
  for (const enabled of [false, true]) {
    const resolved = applyProfileColorsToSnapshot(snapshot, {
      profileOverrides: { chartPalette: {}, chartData: { usePlanetColorsForSubdivisions: enabled } },
    });
    assert.equal(resolved.primaryChart.options.usePlanetColorsForSubdivisions, enabled);
    assert.equal(resolved.comparisonChart.options.usePlanetColorsForSubdivisions, enabled);
    assert.equal(snapshot.primaryChart.options.usePlanetColorsForSubdivisions, undefined);
  }
});
