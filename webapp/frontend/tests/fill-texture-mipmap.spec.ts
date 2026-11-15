// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  clearFillTextureMipCache,
  fillTextureMipChain,
  fillTextureRecipeKey,
  selectFillTextureLevelIndex,
  type FillTextureAlgorithm,
} from "../src/lib/render/fill-texture-mipmap";

function mean(coverage: Float32Array): number {
  let sum = 0;
  for (const value of coverage) sum += value;
  return sum / coverage.length;
}

const ALGORITHMS: FillTextureAlgorithm[] = [
  "stipple",
  "bayer2",
  "bayer4",
  "bayer8",
  "noise",
  "blueNoise",
  "newsprint",
  "atkinson",
  "floydSteinberg",
  "paper",
  "hatch",
  "crosshatch",
  "scanline",
];

test("every mip level keeps the master tone, down to a flat fill", () => {
  clearFillTextureMipCache();
  for (const algorithm of ALGORITHMS) {
    const chain = fillTextureMipChain({
      algorithm,
      density: 37,
      seed: 11,
      dotRatio: 0.3,
    });
    expect(chain.levels.at(-1)?.side).toBe(1);
    for (const level of chain.levels) {
      expect(mean(level.coverage)).toBeCloseTo(chain.meanCoverage, 5);
    }
  }
});

test("square dot tone is the exact fractional dot area, not a whole-pixel dot", () => {
  // bayer2 at 50% inks two of four cells; a 0.25-ratio square covers 1/16.
  const chain = fillTextureMipChain({
    algorithm: "bayer2",
    density: 50,
    seed: 0,
    dotRatio: 0.25,
  });
  expect(chain.meanCoverage).toBeCloseTo(0.5 * 0.25 * 0.25, 6);
});

test("smaller wheels select coarser levels of the same chain", () => {
  const chain = fillTextureMipChain({
    algorithm: "stipple",
    density: 40,
    seed: 3,
    dotRatio: 0.2,
  });
  const large = selectFillTextureLevelIndex(chain, 12);
  const small = selectFillTextureLevelIndex(chain, 1.5);
  const tiny = selectFillTextureLevelIndex(chain, 0.01);
  expect(chain.levels[large].cellPx).toBeGreaterThanOrEqual(12);
  expect(chain.levels[large].cellPx).toBeLessThan(24);
  expect(small).toBeGreaterThan(large);
  expect(tiny).toBe(chain.levels.length - 1);
  // The selected level never minifies by 2x or more.
  expect(chain.levels[small].cellPx / 1.5).toBeLessThan(2);
});

test("scaled cell and dot sizes resolve to one cached recipe", () => {
  const keys = new Set<string>();
  for (const scale of [0.13, 0.5, 0.77, 1, 1.9]) {
    const cell = 1.5 * scale;
    const dot = 0.25 * scale;
    keys.add(fillTextureRecipeKey({
      algorithm: "blueNoise",
      density: 22,
      seed: 4,
      dotRatio: dot / cell,
    }));
  }
  expect(keys.size).toBe(1);
});
