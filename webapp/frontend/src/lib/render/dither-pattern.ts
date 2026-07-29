// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Renderer-neutral deterministic raster-pattern primitives.
 *
 * This module has no DOM, CSS, application-theme, chart, or session imports.
 * App surface materials and retained chart fills compile these masks only when
 * their resolved style recipe changes, then cache their own presentation asset.
 */

export type DitherRasterPattern =
  | "stipple"
  | "bayer2"
  | "bayer4"
  | "bayer8"
  | "noise"
  | "blueNoise"
  | "newsprint"
  | "atkinson"
  | "floydSteinberg";

export type DitherRasterPatternTile = Readonly<{
  mask: Uint8Array;
  side: number;
  shape: "circle" | "square";
}>;

const BLUE_NOISE_CACHE_LIMIT = 16;
const BLUE_NOISE_SIDE = 32;
const RASTER_DITHER_SIDE = 32;

const blueNoiseThresholdCache = new Map<string, Uint16Array>();

function createPrng(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function shuffledIndices(count: number, seed: number): number[] {
  const random = createPrng(seed);
  const values = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function boundedCacheGet<T>(cache: Map<string, T>, key: string): T | null {
  const existing = cache.get(key);
  if (existing == null) return null;
  cache.delete(key);
  cache.set(key, existing);
  return existing;
}

function boundedCacheSet<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function gaussianToroidalKernel(side: number): Float64Array {
  const sigma = 1.5;
  const denominator = 2 * sigma * sigma;
  const kernel = new Float64Array(side * side);
  for (let y = 0; y < side; y += 1) {
    const distanceY = Math.min(y, side - y);
    for (let x = 0; x < side; x += 1) {
      const distanceX = Math.min(x, side - x);
      kernel[y * side + x] = Math.exp(
        -((distanceX * distanceX + distanceY * distanceY) / denominator),
      );
    }
  }
  return kernel;
}

function updateToroidalEnergy(
  energy: Float64Array,
  kernel: Float64Array,
  side: number,
  point: number,
  direction: -1 | 1,
): void {
  const pointX = point % side;
  const pointY = Math.floor(point / side);
  for (let y = 0; y < side; y += 1) {
    const deltaY = (y - pointY + side) % side;
    const row = y * side;
    const kernelRow = deltaY * side;
    for (let x = 0; x < side; x += 1) {
      const deltaX = (x - pointX + side) % side;
      energy[row + x] += direction * kernel[kernelRow + deltaX];
    }
  }
}

function selectEnergyPoint(
  occupied: Uint8Array,
  energy: Float64Array,
  tieOrder: readonly number[],
  occupiedValue: 0 | 1,
  selectHighest: boolean,
): number {
  let selected = -1;
  let selectedEnergy = selectHighest
    ? Number.NEGATIVE_INFINITY
    : Number.POSITIVE_INFINITY;
  for (const index of tieOrder) {
    if (occupied[index] !== occupiedValue) continue;
    const value = energy[index];
    if (
      selected < 0
      || (selectHighest ? value > selectedEnergy : value < selectedEnergy)
    ) {
      selected = index;
      selectedEnergy = value;
    }
  }
  return selected;
}

/**
 * Seeded Ulichney void-and-cluster rank tile on a toroidal Gaussian field.
 *
 * The prototype is relaxed by exchanging the tightest cluster for the largest
 * void, then ranked below and above its 50% population. Incremental energy
 * updates keep construction O(n²) for n tile samples.
 */
function buildVoidAndClusterThresholdTile(
  seed: number,
  side: number,
): Uint16Array {
  const count = side * side;
  const kernel = gaussianToroidalKernel(side);
  const tieOrder = shuffledIndices(count, seed ^ 0xa5a5);
  const initialOrder = shuffledIndices(count, seed ^ 0x5a5a);
  const occupied = new Uint8Array(count);
  const occupiedCount = Math.floor(count / 2);
  for (let index = 0; index < occupiedCount; index += 1) {
    occupied[initialOrder[index]] = 1;
  }
  const energy = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    if (occupied[index]) {
      updateToroidalEnergy(energy, kernel, side, index, 1);
    }
  }

  for (let iteration = 0; iteration < count * 4; iteration += 1) {
    const cluster = selectEnergyPoint(
      occupied,
      energy,
      tieOrder,
      1,
      true,
    );
    occupied[cluster] = 0;
    updateToroidalEnergy(energy, kernel, side, cluster, -1);
    const voidPoint = selectEnergyPoint(
      occupied,
      energy,
      tieOrder,
      0,
      false,
    );
    occupied[voidPoint] = 1;
    updateToroidalEnergy(energy, kernel, side, voidPoint, 1);
    if (voidPoint === cluster) break;
  }

  const thresholds = new Uint16Array(count);
  const lowerOccupied = occupied.slice();
  const lowerEnergy = energy.slice();
  for (let rank = occupiedCount - 1; rank >= 0; rank -= 1) {
    const cluster = selectEnergyPoint(
      lowerOccupied,
      lowerEnergy,
      tieOrder,
      1,
      true,
    );
    thresholds[cluster] = rank;
    lowerOccupied[cluster] = 0;
    updateToroidalEnergy(lowerEnergy, kernel, side, cluster, -1);
  }

  const upperOccupied = occupied.slice();
  const upperEnergy = energy.slice();
  for (let rank = occupiedCount; rank < count; rank += 1) {
    const voidPoint = selectEnergyPoint(
      upperOccupied,
      upperEnergy,
      tieOrder,
      0,
      false,
    );
    thresholds[voidPoint] = rank;
    upperOccupied[voidPoint] = 1;
    updateToroidalEnergy(upperEnergy, kernel, side, voidPoint, 1);
  }
  return thresholds;
}

function cachedVoidAndClusterThresholdTile(
  seed: number,
  side: number,
): Uint16Array {
  const key = `${side}:${seed}`;
  const existing = boundedCacheGet(blueNoiseThresholdCache, key);
  if (existing) return existing;
  const generated = buildVoidAndClusterThresholdTile(seed, side);
  boundedCacheSet(
    blueNoiseThresholdCache,
    key,
    generated,
    BLUE_NOISE_CACHE_LIMIT,
  );
  return generated;
}

/** Return a defensive rank copy suitable for tests, export, or diagnostics. */
export function generateVoidAndClusterThresholdTile(
  seed: number,
  side = BLUE_NOISE_SIDE,
): Uint16Array {
  if (!Number.isInteger(seed) || seed < 0 || seed > 65535) {
    throw new TypeError(
      "blue-noise seed must be an integer from 0 to 65535",
    );
  }
  if (!Number.isInteger(side) || side < 8 || side > 64) {
    throw new TypeError(
      "blue-noise tile side must be an integer from 8 to 64",
    );
  }
  return cachedVoidAndClusterThresholdTile(seed, side).slice();
}

function thresholdMask(
  thresholds: ArrayLike<number>,
  density: number,
): Uint8Array {
  const mask = new Uint8Array(thresholds.length);
  const cutoff = (density / 100) * thresholds.length;
  for (let index = 0; index < thresholds.length; index += 1) {
    mask[index] = thresholds[index] < cutoff ? 1 : 0;
  }
  return mask;
}

function bayerThresholds(side: 2 | 4 | 8): Uint16Array {
  let matrix = [0, 2, 3, 1];
  let currentSide = 2;
  while (currentSide < side) {
    const nextSide = currentSide * 2;
    const next = new Array<number>(nextSide * nextSide);
    for (let y = 0; y < currentSide; y += 1) {
      for (let x = 0; x < currentSide; x += 1) {
        const value = matrix[y * currentSide + x] * 4;
        next[y * nextSide + x] = value;
        next[y * nextSide + x + currentSide] = value + 2;
        next[(y + currentSide) * nextSide + x] = value + 3;
        next[(y + currentSide) * nextSide + x + currentSide] =
          value + 1;
      }
    }
    matrix = next;
    currentSide = nextSide;
  }
  return Uint16Array.from(matrix);
}

function rankedRandomThresholds(side: number, seed: number): Uint16Array {
  const count = side * side;
  const order = shuffledIndices(count, seed);
  const thresholds = new Uint16Array(count);
  order.forEach((sample, rank) => {
    thresholds[sample] = rank;
  });
  return thresholds;
}

function clusteredThresholds(side: number): Uint16Array {
  const count = side * side;
  const center = (side - 1) / 2;
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (left, right) => {
      const leftX = left % side;
      const leftY = Math.floor(left / side);
      const rightX = right % side;
      const rightY = Math.floor(right / side);
      const leftDistance =
        (leftX - center) ** 2 + (leftY - center) ** 2;
      const rightDistance =
        (rightX - center) ** 2 + (rightY - center) ** 2;
      return leftDistance - rightDistance || left - right;
    },
  );
  const thresholds = new Uint16Array(count);
  order.forEach((sample, rank) => {
    thresholds[sample] = rank;
  });
  return thresholds;
}

/** Stable seeded noise sample for grain and error-diffusion sources. */
export function sampleDitherNoise(
  x: number,
  y: number,
  seed: number,
): number {
  let value = Math.imul(x + 0x51ed, 0x9e3779b1);
  value ^= Math.imul(y + 0x85eb, 0x85ebca77);
  value ^= Math.imul(seed + 0xc2b2, 0xc2b2ae3d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function sourceInk(
  x: number,
  y: number,
  side: number,
  density: number,
  seed: number,
): number {
  if (density <= 0) return 0;
  if (density >= 100) return 255;
  const wrappedX = ((x % side) + side) % side;
  const wrappedY = ((y % side) + side) % side;
  const jitter = (
    sampleDitherNoise(wrappedX, wrappedY, seed) - 0.5
  ) * 40;
  return Math.max(0, Math.min(255, (density / 100) * 255 + jitter));
}

function diffuseMask(
  side: number,
  density: number,
  seed: number,
  algorithm: "atkinson" | "floydSteinberg",
): Uint8Array {
  const expandedSide = side * 3;
  const values = new Float64Array(expandedSide * expandedSide);
  for (let y = 0; y < expandedSide; y += 1) {
    for (let x = 0; x < expandedSide; x += 1) {
      values[y * expandedSide + x] = sourceInk(
        x,
        y,
        side,
        density,
        seed,
      );
    }
  }

  const addError = (x: number, y: number, error: number) => {
    if (x < 0 || x >= expandedSide || y < 0 || y >= expandedSide) {
      return;
    }
    values[y * expandedSide + x] += error;
  };

  for (let y = 0; y < expandedSide; y += 1) {
    const reverse = y % 2 === 1;
    for (let step = 0; step < expandedSide; step += 1) {
      const x = reverse ? expandedSide - 1 - step : step;
      const index = y * expandedSide + x;
      const oldValue = values[index];
      const newValue = oldValue >= 127.5 ? 255 : 0;
      values[index] = newValue;
      const error = oldValue - newValue;
      const direction = reverse ? -1 : 1;
      if (algorithm === "atkinson") {
        const portion = error / 8;
        addError(x + direction, y, portion);
        addError(x + direction * 2, y, portion);
        addError(x - direction, y + 1, portion);
        addError(x, y + 1, portion);
        addError(x + direction, y + 1, portion);
        addError(x, y + 2, portion);
      } else {
        addError(x + direction, y, (error * 7) / 16);
        addError(x - direction, y + 1, (error * 3) / 16);
        addError(x, y + 1, (error * 5) / 16);
        addError(x + direction, y + 1, error / 16);
      }
    }
  }

  const mask = new Uint8Array(side * side);
  for (let y = 0; y < side; y += 1) {
    const sourceRow = (y + side) * expandedSide + side;
    for (let x = 0; x < side; x += 1) {
      mask[y * side + x] = values[sourceRow + x] >= 127.5 ? 1 : 0;
    }
  }
  return mask;
}

/** Compile one named raster screen into a renderer-neutral binary tile. */
export function createDitherRasterPatternTile(
  pattern: DitherRasterPattern,
  density: number,
  seed: number,
): DitherRasterPatternTile {
  const safeDensity = Math.max(0, Math.min(100, density));
  if (pattern === "stipple") {
    const thresholds = Uint16Array.from([
      0, 10, 4, 14,
      8, 2, 12, 6,
      5, 15, 1, 11,
      13, 7, 9, 3,
    ]);
    return Object.freeze({
      mask: thresholdMask(thresholds, safeDensity),
      side: 4,
      shape: "circle",
    });
  }
  if (
    pattern === "bayer2"
    || pattern === "bayer4"
    || pattern === "bayer8"
  ) {
    const side = Number(pattern.slice(-1)) as 2 | 4 | 8;
    return Object.freeze({
      mask: thresholdMask(bayerThresholds(side), safeDensity),
      side,
      shape: "square",
    });
  }
  if (pattern === "noise") {
    const side = 16;
    return Object.freeze({
      mask: thresholdMask(
        rankedRandomThresholds(side, seed),
        safeDensity,
      ),
      side,
      shape: "circle",
    });
  }
  if (pattern === "blueNoise") {
    return Object.freeze({
      mask: thresholdMask(
        cachedVoidAndClusterThresholdTile(seed, BLUE_NOISE_SIDE),
        safeDensity,
      ),
      side: BLUE_NOISE_SIDE,
      shape: "circle",
    });
  }
  if (pattern === "newsprint") {
    const side = 8;
    return Object.freeze({
      mask: thresholdMask(clusteredThresholds(side), safeDensity),
      side,
      shape: "circle",
    });
  }
  return Object.freeze({
    mask: diffuseMask(
      RASTER_DITHER_SIDE,
      safeDensity,
      seed,
      pattern,
    ),
    side: RASTER_DITHER_SIDE,
    shape: "square",
  });
}

export function clearDitherPatternCaches(): void {
  blueNoiseThresholdCache.clear();
}

export function getDitherPatternCacheStats(): Readonly<{
  blueNoiseThresholdTiles: number;
  blueNoiseThresholdTileLimit: number;
}> {
  return Object.freeze({
    blueNoiseThresholdTiles: blueNoiseThresholdCache.size,
    blueNoiseThresholdTileLimit: BLUE_NOISE_CACHE_LIMIT,
  });
}
