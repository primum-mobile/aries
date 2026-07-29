// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  APP_MATERIAL_BLEND_MODES,
  APP_MATERIAL_CLASSES,
  APP_MATERIAL_GRADIENT_TYPES,
  APP_MATERIAL_PATTERNS,
  APP_MATERIAL_PROPERTIES,
  APP_MATERIAL_SURFACE_CLASSES,
  AppMaterialValidationError,
  appMaterialCssVariableNames,
  clearAppMaterialCaches,
  compileFlatAppMaterialOverrides,
  generateVoidAndClusterThresholdTile,
  getAppMaterialCacheStats,
  parseFlatAppMaterialOverrides,
  resolveAppMaterialRecipes,
} from "../src/lib/theme/app-material";

const globalId = (property: string) =>
  `authoring.app.materials.global.${property}`;

test("app material contract mirrors the daemon's closed flat schema", () => {
  expect(APP_MATERIAL_CLASSES).toEqual([
    "materials.global",
    "surfaces.canvas",
    "sidebar",
    "titlebar",
    "statusbar",
    "panel",
    "inspector",
    "overlay",
    "popover",
    "control",
    "dataBody",
    "dataHeader",
  ]);
  expect(APP_MATERIAL_SURFACE_CLASSES).toHaveLength(11);
  expect(APP_MATERIAL_PROPERTIES).toEqual([
    "pattern",
    "backgroundColor",
    "patternColor",
    "gradientType",
    "gradientStartColor",
    "gradientEndColor",
    "gradientAngle",
    "opacity",
    "cellSize",
    "dotSize",
    "density",
    "angle",
    "seed",
    "blendMode",
    "backdropBlur",
    "backdropSaturation",
    "shadowColor",
    "shadowX",
    "shadowY",
    "shadowBlur",
  ]);
  expect(APP_MATERIAL_PATTERNS).toContain("blueNoise");
  expect(APP_MATERIAL_PATTERNS).toContain("floydSteinberg");
  expect(APP_MATERIAL_BLEND_MODES).toEqual([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "soft-light",
    "hard-light",
    "darken",
    "lighten",
  ]);
  expect(APP_MATERIAL_GRADIENT_TYPES).toEqual(["none", "linear", "radial"]);
});

test("flat parser accepts only known semantic IDs and typed bounded values", () => {
  expect(
    parseFlatAppMaterialOverrides({
      [globalId("pattern")]: "blueNoise",
      [globalId("backgroundColor")]: [243, 242, 235, 0.95],
      [globalId("patternColor")]: [35, 39, 42],
      [globalId("gradientType")]: "radial",
      [globalId("gradientStartColor")]: [250, 249, 242],
      [globalId("gradientEndColor")]: [80, 84, 88, 0.7],
      [globalId("gradientAngle")]: 28,
      [globalId("opacity")]: 18,
      [globalId("cellSize")]: 2.5,
      [globalId("dotSize")]: 0.75,
      [globalId("density")]: 28,
      [globalId("angle")]: -45,
      [globalId("seed")]: 65535,
      [globalId("blendMode")]: "multiply",
      [globalId("backdropBlur")]: 8,
      [globalId("backdropSaturation")]: 125,
    })["materials.global"],
  ).toMatchObject({
    pattern: "blueNoise",
    opacity: 18,
    seed: 65535,
    blendMode: "multiply",
  });

  const invalidValues: Array<Record<string, unknown>> = [
    { "renderer.wheel.color": [0, 0, 0] },
    { "authoring.app.unknown.pattern": "none" },
    { [globalId("unknown")]: 1 },
    { [globalId("pattern")]: "url(https://example.invalid/texture)" },
    { [globalId("backgroundColor")]: "var(--unsafe)" },
    { [globalId("patternColor")]: [0, 0, 256] },
    { [globalId("gradientType")]: "conic" },
    { [globalId("gradientAngle")]: 181 },
    { [globalId("opacity")]: 101 },
    { [globalId("cellSize")]: 0.49 },
    { [globalId("dotSize")]: 32.01 },
    { [globalId("density")]: Number.NaN },
    { [globalId("angle")]: 181 },
    { [globalId("seed")]: 1.5 },
    { [globalId("blendMode")]: "url" },
    { [globalId("backdropBlur")]: 41 },
    { [globalId("backdropSaturation")]: 201 },
  ];
  for (const invalid of invalidValues) {
    expect(() => parseFlatAppMaterialOverrides(invalid)).toThrow(
      AppMaterialValidationError,
    );
  }
});

test("static gradients layer beneath retained textures without DOM work", () => {
  const compiled = compileFlatAppMaterialOverrides({
    [globalId("pattern")]: "stipple",
    [globalId("gradientType")]: "linear",
    [globalId("gradientStartColor")]: [250, 249, 242],
    [globalId("gradientEndColor")]: [82, 86, 90, 0.75],
    [globalId("gradientAngle")]: 35,
  }).byClass.panel;

  expect(compiled.backgroundImage).toContain("data:image/svg+xml");
  expect(compiled.backgroundImage).toContain("linear-gradient(35deg");
  expect(compiled.backgroundSize).toContain(", cover");
  expect(compiled.backgroundRepeat).toBe("repeat, no-repeat");
  expect(compiled.backgroundPosition).toBe("0px 0px, center");
});

test("materials.global resolves into every surface before sparse overrides", () => {
  const resolved = resolveAppMaterialRecipes({
    [globalId("pattern")]: "paper",
    [globalId("backgroundColor")]: [241, 239, 230],
    [globalId("patternColor")]: [28, 31, 34, 0.8],
    [globalId("seed")]: 41,
    [globalId("density")]: 20,
    "authoring.app.sidebar.backgroundColor": [224, 222, 213],
    "authoring.app.sidebar.density": 12,
  });

  expect(resolved["surfaces.canvas"]).toMatchObject({
    pattern: "paper",
    backgroundColor: [241, 239, 230],
    patternColor: [28, 31, 34, 0.8],
    seed: 41,
    density: 20,
  });
  expect(resolved.sidebar).toMatchObject({
    pattern: "paper",
    backgroundColor: [224, 222, 213],
    seed: 41,
    density: 12,
  });
  expect(resolved.panel).not.toBe(resolved["materials.global"]);
  expect(Object.isFrozen(resolved.sidebar)).toBe(true);
});

test("material background alpha remains a fourth recipe channel", () => {
  const resolved = resolveAppMaterialRecipes({
    [globalId("backgroundColor")]: [24, 36, 48, 0.42],
  });
  expect(resolved["materials.global"].backgroundColor)
    .toEqual([24, 36, 48, 0.42]);
  expect(resolved.panel.backgroundColor).toEqual([24, 36, 48, 0.42]);
});

test("compiler emits solid fallbacks, safe material variables, and accessibility fallbacks", () => {
  const compiled = compileFlatAppMaterialOverrides({
    [globalId("pattern")]: "blueNoise",
    [globalId("backgroundColor")]: [249, 248, 242, 0.72],
    [globalId("patternColor")]: [23, 30, 38, 0.7],
    [globalId("opacity")]: 14,
    [globalId("density")]: 27,
    [globalId("cellSize")]: 1.5,
    [globalId("dotSize")]: 0.6,
    [globalId("seed")]: 1976,
    [globalId("blendMode")]: "multiply",
    [globalId("backdropBlur")]: 6,
    [globalId("backdropSaturation")]: 118,
  });
  const canvas = compiled.byClass["surfaces.canvas"];
  const names = appMaterialCssVariableNames("surfaces.canvas");

  expect(canvas.backgroundColor).toBe("rgb(249 248 242 / 0.72)");
  expect(canvas.solidBackgroundColor).toBe("rgb(249 248 242 / 1)");
  expect(canvas.patternColor).toBe("rgb(23 30 38 / 0.098)");
  expect(canvas.backgroundImage).toMatch(
    /^url\("data:image\/svg\+xml,/,
  );
  expect(canvas.backgroundSize).toBe("48px 48px");
  expect(canvas.backgroundBlendMode).toBe("multiply");
  expect(canvas.backdropFilter).toBe("blur(6px) saturate(118%)");
  expect(canvas.customProperties[names.backgroundColor]).toBe(
    canvas.backgroundColor,
  );
  expect(canvas.customProperties[names.forcedColorsBackgroundImage]).toBe(
    "none",
  );
  expect(canvas.customProperties[names.forcedColorsBackdropFilter]).toBe(
    "none",
  );
  expect(
    canvas.customProperties[names.reducedTransparencyBackgroundColor],
  ).toBe(canvas.solidBackgroundColor);
  expect(
    canvas.customProperties[names.reducedTransparencyBackgroundImage],
  ).toBe("none");
  expect(
    canvas.customProperties[names.reducedTransparencyBackdropFilter],
  ).toBe("none");
});

test("all reviewed patterns compile deterministically without DOM access", () => {
  clearAppMaterialCaches();
  const outputs = new Map<string, string>();
  for (const pattern of APP_MATERIAL_PATTERNS) {
    const overrides = {
      [globalId("pattern")]: pattern,
      [globalId("backgroundColor")]: [248, 247, 241],
      [globalId("patternColor")]: [31, 35, 38, 0.85],
      [globalId("opacity")]: 22,
      [globalId("cellSize")]: 2,
      [globalId("dotSize")]: 0.8,
      [globalId("density")]: 31,
      [globalId("angle")]: 37,
      [globalId("seed")]: 902,
      [globalId("blendMode")]: "soft-light",
    };
    const first =
      compileFlatAppMaterialOverrides(overrides).byClass.sidebar;
    const second =
      compileFlatAppMaterialOverrides(overrides).byClass.sidebar;
    expect(second.backgroundImage).toBe(first.backgroundImage);
    if (pattern === "none") {
      expect(first.backgroundImage).toBe("none");
    } else {
      expect(first.backgroundImage).not.toBe("none");
    }
    outputs.set(pattern, first.backgroundImage);
  }
  expect(outputs.get("atkinson")).not.toBe(
    outputs.get("floydSteinberg"),
  );
  expect(outputs.get("bayer4")).not.toBe(outputs.get("bayer8"));
  expect(outputs.get("noise")).not.toBe(outputs.get("blueNoise"));
});

test("angle rotates directional screens without clipping raster tiles", () => {
  const image = (pattern: "blueNoise" | "hatch", angle: number) =>
    compileFlatAppMaterialOverrides({
      [globalId("pattern")]: pattern,
      [globalId("angle")]: angle,
      [globalId("density")]: 31,
      [globalId("seed")]: 902,
    }).byClass.panel.backgroundImage;

  expect(image("blueNoise", 0)).toBe(image("blueNoise", 37));
  expect(image("hatch", 0)).not.toBe(image("hatch", 37));
});

test("void-and-cluster ranks are deterministic, complete, and seedable", () => {
  clearAppMaterialCaches();
  const first = generateVoidAndClusterThresholdTile(119, 8);
  const second = generateVoidAndClusterThresholdTile(119, 8);
  const different = generateVoidAndClusterThresholdTile(120, 8);

  expect(Array.from(second)).toEqual(Array.from(first));
  expect(new Set(first).size).toBe(64);
  expect(Math.min(...first)).toBe(0);
  expect(Math.max(...first)).toBe(63);
  expect(Array.from(different)).not.toEqual(Array.from(first));
});

test("material texture caches are bounded and include seed in identity", () => {
  clearAppMaterialCaches();
  const image = (seed: number) =>
    compileFlatAppMaterialOverrides({
      [globalId("pattern")]: "noise",
      [globalId("seed")]: seed,
      [globalId("density")]: 33,
    }).byClass.panel.backgroundImage;

  expect(image(1)).toBe(image(1));
  expect(image(2)).not.toBe(image(1));
  for (let seed = 3; seed < 80; seed += 1) image(seed);

  const stats = getAppMaterialCacheStats();
  expect(stats.textureTiles).toBeLessThanOrEqual(stats.textureTileLimit);
  expect(stats.blueNoiseThresholdTiles).toBeLessThanOrEqual(
    stats.blueNoiseThresholdTileLimit,
  );
});

test("surface-only colors and glass filters reuse the same texture asset", () => {
  clearAppMaterialCaches();
  const image = (
    backgroundColor: readonly [number, number, number],
    backdropBlur: number,
  ) =>
    compileFlatAppMaterialOverrides({
      [globalId("pattern")]: "blueNoise",
      [globalId("backgroundColor")]: backgroundColor,
      [globalId("patternColor")]: [31, 35, 38],
      [globalId("density")]: 29,
      [globalId("seed")]: 77,
      [globalId("backdropBlur")]: backdropBlur,
    }).byClass.panel.backgroundImage;

  expect(image([248, 247, 241], 0)).toBe(image([223, 228, 231], 14));
  expect(getAppMaterialCacheStats().textureTiles).toBe(1);
});
