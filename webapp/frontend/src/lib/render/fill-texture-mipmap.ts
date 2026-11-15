// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createDitherRasterPatternTile,
  sampleDitherNoise,
  type DitherRasterPattern,
} from "./dither-pattern";

/**
 * Scale-invariant coverage mipmaps for retained chart fill textures.
 *
 * A texture's tone is its mean ink coverage. Drawing dots at whole device
 * pixels changes that coverage whenever the wheel is resized, so small wheels
 * printed visibly darker. Instead, each recipe is rasterised once at a fixed
 * master resolution with exact fractional coverage, then box-filtered into a
 * chain of halved levels. Box filtering preserves the mean exactly, so every
 * level carries the same tone; the painter picks the level closest above the
 * on-screen cell size and lets the pattern transform cover the remainder.
 *
 * Pure data: no DOM, canvas, colour, or device-pixel-ratio input. Wheel size
 * and DPR only select a level, so resizing never rebuilds a texture.
 */

export type FillTextureAlgorithm =
  | DitherRasterPattern
  | "paper"
  | "hatch"
  | "crosshatch"
  | "scanline";

export type FillTextureRecipe = Readonly<{
  algorithm: FillTextureAlgorithm;
  density: number;
  seed: number;
  /** Dot (or line) size as a fraction of the cell size, in (0, 1]. */
  dotRatio: number;
}>;

export type FillTextureLevel = Readonly<{
  side: number;
  /** Texels per authoring cell at this level. */
  cellPx: number;
  coverage: Float32Array;
}>;

export type FillTextureMipChain = Readonly<{
  key: string;
  levels: readonly FillTextureLevel[];
  meanCoverage: number;
}>;

/** Master texels per raster cell; covers shipped cells at 2x DPR unmagnified. */
const MASTER_CELL_PX = 16;
const LINE_MASTER_SIDE = 512;
const PAPER_SIDE = 24;
const CIRCLE_SUPERSAMPLE = 4;
const CHAIN_CACHE_LIMIT = 32;

const chainCache = new Map<string, FillTextureMipChain>();

function isLineAlgorithm(algorithm: FillTextureAlgorithm): boolean {
  return algorithm === "hatch"
    || algorithm === "crosshatch"
    || algorithm === "scanline";
}

/** Tile period in authoring cells (the CSS size of one tile is this × cell). */
export function fillTextureRepeatCells(recipe: FillTextureRecipe): number {
  if (isLineAlgorithm(recipe.algorithm)) {
    return Math.max(recipe.dotRatio, 100 / Math.max(1e-6, recipe.density));
  }
  if (recipe.algorithm === "paper") return PAPER_SIDE;
  return createDitherRasterPatternTile(
    recipe.algorithm as DitherRasterPattern,
    recipe.density,
    recipe.seed,
  ).side;
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function squareStamp(cellPx: number, dotPx: number): Float32Array {
  const stamp = new Float32Array(cellPx * cellPx);
  const inset = (cellPx - dotPx) / 2;
  for (let y = 0; y < cellPx; y += 1) {
    const cy = overlap1d(y, y + 1, inset, inset + dotPx);
    if (cy <= 0) continue;
    for (let x = 0; x < cellPx; x += 1) {
      stamp[y * cellPx + x] = cy * overlap1d(x, x + 1, inset, inset + dotPx);
    }
  }
  return stamp;
}

function circleStamp(cellPx: number, radius: number, alpha = 1): Float32Array {
  const stamp = new Float32Array(cellPx * cellPx);
  const centre = cellPx / 2;
  const r2 = radius * radius;
  const step = 1 / CIRCLE_SUPERSAMPLE;
  const weight = alpha / (CIRCLE_SUPERSAMPLE * CIRCLE_SUPERSAMPLE);
  const lo = Math.max(0, Math.floor(centre - radius));
  const hi = Math.min(cellPx, Math.ceil(centre + radius));
  for (let y = lo; y < hi; y += 1) {
    for (let x = lo; x < hi; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < CIRCLE_SUPERSAMPLE; sy += 1) {
        const dy = y + (sy + 0.5) * step - centre;
        for (let sx = 0; sx < CIRCLE_SUPERSAMPLE; sx += 1) {
          const dx = x + (sx + 0.5) * step - centre;
          if (dx * dx + dy * dy <= r2) hits += 1;
        }
      }
      stamp[y * cellPx + x] = hits * weight;
    }
  }
  return stamp;
}

function placeStamp(
  coverage: Float32Array,
  side: number,
  column: number,
  row: number,
  cellPx: number,
  stamp: Float32Array,
): void {
  const originX = column * cellPx;
  const originY = row * cellPx;
  for (let y = 0; y < cellPx; y += 1) {
    const target = (originY + y) * side + originX;
    for (let x = 0; x < cellPx; x += 1) {
      coverage[target + x] = stamp[y * cellPx + x];
    }
  }
}

function masterLevel(recipe: FillTextureRecipe): FillTextureLevel {
  const ratio = Math.max(0, Math.min(1, recipe.dotRatio));
  if (isLineAlgorithm(recipe.algorithm)) {
    const side = LINE_MASTER_SIDE;
    const width = Math.min(side, (ratio / fillTextureRepeatCells(recipe)) * side);
    const band = new Float32Array(side);
    for (let index = 0; index < side; index += 1) {
      band[index] = overlap1d(index, index + 1, 0, width);
    }
    const coverage = new Float32Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const vertical = band[x];
        const value = recipe.algorithm === "crosshatch"
          ? 1 - (1 - vertical) * (1 - band[y])
          : vertical;
        coverage[y * side + x] = value;
      }
    }
    return { side, cellPx: side / fillTextureRepeatCells(recipe), coverage };
  }
  const cellPx = MASTER_CELL_PX;
  const dotPx = ratio * cellPx;
  if (recipe.algorithm === "paper") {
    const side = PAPER_SIDE * cellPx;
    const coverage = new Float32Array(side * side);
    for (let row = 0; row < PAPER_SIDE; row += 1) {
      for (let column = 0; column < PAPER_SIDE; column += 1) {
        const presence = sampleDitherNoise(column, row, recipe.seed);
        if (presence * 100 >= recipe.density) continue;
        const fine = sampleDitherNoise(
          column * 3 + 7,
          row * 5 + 11,
          recipe.seed ^ 0x4f31,
        );
        const coarse = sampleDitherNoise(
          Math.floor(column / 4),
          Math.floor(row / 4),
          recipe.seed ^ 0x7123,
        );
        const alpha = Math.min(1, 0.15 + fine * 0.55 + coarse * 0.3);
        placeStamp(
          coverage,
          side,
          column,
          row,
          cellPx,
          circleStamp(cellPx, dotPx * (0.2 + fine * 0.3), alpha),
        );
      }
    }
    return { side, cellPx, coverage };
  }
  const raster = createDitherRasterPatternTile(
    recipe.algorithm as DitherRasterPattern,
    recipe.density,
    recipe.seed,
  );
  const side = raster.side * cellPx;
  const coverage = new Float32Array(side * side);
  const stamp = raster.shape === "circle"
    ? circleStamp(cellPx, dotPx / 2)
    : squareStamp(cellPx, dotPx);
  for (let index = 0; index < raster.mask.length; index += 1) {
    if (!raster.mask[index]) continue;
    placeStamp(
      coverage,
      side,
      index % raster.side,
      Math.floor(index / raster.side),
      cellPx,
      stamp,
    );
  }
  return { side, cellPx, coverage };
}

function meanOf(coverage: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < coverage.length; index += 1) sum += coverage[index];
  return coverage.length > 0 ? sum / coverage.length : 0;
}

/** Halve a tileable level with a 2×2 box filter; odd sides collapse to tone. */
function downsample(level: FillTextureLevel): FillTextureLevel {
  if (level.side % 2 !== 0) {
    return {
      side: 1,
      cellPx: level.cellPx / level.side,
      coverage: Float32Array.of(meanOf(level.coverage)),
    };
  }
  const side = level.side / 2;
  const source = level.coverage;
  const coverage = new Float32Array(side * side);
  for (let y = 0; y < side; y += 1) {
    const top = 2 * y * level.side;
    const bottom = top + level.side;
    for (let x = 0; x < side; x += 1) {
      coverage[y * side + x] = (
        source[top + 2 * x]
        + source[top + 2 * x + 1]
        + source[bottom + 2 * x]
        + source[bottom + 2 * x + 1]
      ) / 4;
    }
  }
  return { side, cellPx: level.cellPx / 2, coverage };
}

export function fillTextureRecipeKey(recipe: FillTextureRecipe): string {
  // The ratio is derived from two equally scaled floats; quantise it so
  // resizing can never miss the cache on floating-point noise.
  return [
    recipe.algorithm,
    recipe.density,
    recipe.seed,
    Math.round(recipe.dotRatio * 4096),
  ].join("\u0000");
}

export function fillTextureMipChain(
  recipe: FillTextureRecipe,
): FillTextureMipChain {
  const key = fillTextureRecipeKey(recipe);
  const cached = chainCache.get(key);
  if (cached) {
    chainCache.delete(key);
    chainCache.set(key, cached);
    return cached;
  }
  const levels: FillTextureLevel[] = [masterLevel(recipe)];
  while (levels[levels.length - 1].side > 1) {
    levels.push(downsample(levels[levels.length - 1]));
  }
  const chain: FillTextureMipChain = Object.freeze({
    key,
    levels: Object.freeze(levels.map(level => Object.freeze(level))),
    meanCoverage: meanOf(levels[0].coverage),
  });
  chainCache.set(key, chain);
  while (chainCache.size > CHAIN_CACHE_LIMIT) {
    const oldest = chainCache.keys().next().value as string | undefined;
    if (oldest == null) break;
    chainCache.delete(oldest);
  }
  return chain;
}

/**
 * Pick the smallest level that is still at least as detailed as the target,
 * so sampling only ever minifies by less than 2× (or magnifies the master).
 */
export function selectFillTextureLevelIndex(
  chain: FillTextureMipChain,
  deviceCellPx: number,
): number {
  let selected = 0;
  for (let index = 1; index < chain.levels.length; index += 1) {
    if (chain.levels[index].cellPx < deviceCellPx) break;
    selected = index;
  }
  return selected;
}

export function clearFillTextureMipCache(): void {
  chainCache.clear();
}
