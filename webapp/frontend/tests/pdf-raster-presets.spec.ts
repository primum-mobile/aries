// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { applyPdfRasterPreset } from "../src/lib/chart/pdf-raster-presets";

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = Math.round(((x + y) / (width + height - 2)) * 255);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

test("PDF raster presets are deterministic monochrome treatments", () => {
  const width = 32;
  const height = 32;
  const results = (["atkinson", "blue-noise", "newsprint"] as const).map((preset) => {
    const first = gradient(width, height);
    const second = gradient(width, height);
    applyPdfRasterPreset(first, width, height, preset, false);
    applyPdfRasterPreset(second, width, height, preset, false);
    expect(Array.from(first)).toEqual(Array.from(second));
    for (let index = 0; index < first.length; index += 4) {
      expect([0, 255]).toContain(first[index]);
      expect(first[index + 1]).toBe(first[index]);
      expect(first[index + 2]).toBe(first[index]);
      expect(first[index + 3]).toBe(255);
    }
    return Array.from(first).join(",");
  });
  expect(new Set(results).size).toBe(3);
});

test("colored PDF details survive textured presets", () => {
  const data = gradient(4, 4);
  data[20] = 175;
  data[21] = 35;
  data[22] = 45;
  applyPdfRasterPreset(data, 4, 4, "atkinson", true);
  expect(Array.from(data.slice(20, 24))).toEqual([175, 35, 45, 255]);
});

test("Clean preserves color and only grays monochrome output", () => {
  const colored = new Uint8ClampedArray([160, 40, 20, 255]);
  applyPdfRasterPreset(colored, 1, 1, "clean", true);
  expect(Array.from(colored)).toEqual([160, 40, 20, 255]);

  const monochrome = new Uint8ClampedArray([160, 40, 20, 255]);
  applyPdfRasterPreset(monochrome, 1, 1, "clean", false);
  expect(monochrome[0]).toBe(monochrome[1]);
  expect(monochrome[1]).toBe(monochrome[2]);
  expect(monochrome[3]).toBe(255);
});
