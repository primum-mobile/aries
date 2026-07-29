// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export type PdfChartRasterPreset = "clean" | "atkinson" | "blue-noise" | "newsprint";

const ATKINSON_THRESHOLD = 214;
const BLUE_NOISE_SIZE = 64;
const NEWSPRINT_SIZE = 8;
const CHROMA_FLOOR = 24;

function luminance(data: Uint8ClampedArray, index: number): number {
  return (
    (0.2126 * data[index]) +
    (0.7152 * data[index + 1]) +
    (0.0722 * data[index + 2])
  );
}

function isColoredDetail(data: Uint8ClampedArray, index: number): boolean {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return Math.max(red, green, blue) - Math.min(red, green, blue) >= CHROMA_FLOOR;
}

function writeMonochrome(data: Uint8ClampedArray, index: number, value: number) {
  data[index] = value;
  data[index + 1] = value;
  data[index + 2] = value;
}

function applyCleanMonochrome(data: Uint8ClampedArray) {
  for (let index = 0; index < data.length; index += 4) {
    writeMonochrome(data, index, Math.round(luminance(data, index)));
  }
}

function applyAtkinson(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  preserveColoredDetails: boolean,
) {
  const padding = 2;
  let current = new Float32Array(width + padding * 2);
  let next = new Float32Array(width + padding * 2);
  let following = new Float32Array(width + padding * 2);

  const fillRow = (row: Float32Array, y: number) => {
    row.fill(255);
    if (y >= height) return;
    let pixel = y * width * 4;
    for (let x = 0; x < width; x += 1, pixel += 4) {
      row[x + padding] = luminance(data, pixel);
    }
  };

  fillRow(current, 0);
  fillRow(next, 1);
  fillRow(following, 2);

  for (let y = 0; y < height; y += 1) {
    let pixel = y * width * 4;
    for (let x = 0; x < width; x += 1, pixel += 4) {
      if (preserveColoredDetails && isColoredDetail(data, pixel)) continue;
      const column = x + padding;
      const oldValue = current[column];
      const newValue = oldValue >= ATKINSON_THRESHOLD ? 255 : 0;
      const error = (oldValue - newValue) / 8;
      writeMonochrome(data, pixel, newValue);
      current[column + 1] += error;
      current[column + 2] += error;
      next[column - 1] += error;
      next[column] += error;
      next[column + 1] += error;
      following[column] += error;
    }
    const recycled = current;
    current = next;
    next = following;
    following = recycled;
    fillRow(following, y + 3);
  }
}

function buildBlueNoiseThresholds(): Float32Array {
  const count = BLUE_NOISE_SIZE * BLUE_NOISE_SIZE;
  const random = new Float32Array(count);
  let seed = 0x6d2b79f5;
  for (let index = 0; index < count; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    random[index] = (seed >>> 0) / 0x100000000;
  }

  const highPass = new Float32Array(count);
  for (let y = 0; y < BLUE_NOISE_SIZE; y += 1) {
    for (let x = 0; x < BLUE_NOISE_SIZE; x += 1) {
      let neighbors = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = (x + offsetX + BLUE_NOISE_SIZE) % BLUE_NOISE_SIZE;
          const sampleY = (y + offsetY + BLUE_NOISE_SIZE) % BLUE_NOISE_SIZE;
          neighbors += random[sampleY * BLUE_NOISE_SIZE + sampleX];
        }
      }
      const index = y * BLUE_NOISE_SIZE + x;
      highPass[index] = random[index] - neighbors / 25;
    }
  }

  const order = Array.from({ length: count }, (_, index) => index)
    .sort((left, right) => highPass[left] - highPass[right]);
  const thresholds = new Float32Array(count);
  order.forEach((index, rank) => {
    thresholds[index] = (rank + 0.5) / count;
  });
  return thresholds;
}

const BLUE_NOISE_THRESHOLDS = buildBlueNoiseThresholds();

function buildNewsprintThresholds(): Float32Array {
  const count = NEWSPRINT_SIZE * NEWSPRINT_SIZE;
  const center = (NEWSPRINT_SIZE - 1) / 2;
  const distance = Array.from({ length: count }, (_, index) => {
    const x = index % NEWSPRINT_SIZE;
    const y = Math.floor(index / NEWSPRINT_SIZE);
    return ((x - center) ** 2) + ((y - center) ** 2);
  });
  const order = Array.from({ length: count }, (_, index) => index)
    .sort((left, right) => distance[left] - distance[right]);
  const thresholds = new Float32Array(count);
  order.forEach((index, rank) => {
    thresholds[index] = (count - rank - 0.5) / count;
  });
  return thresholds;
}

const NEWSPRINT_THRESHOLDS = buildNewsprintThresholds();

function applyBlueNoise(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  preserveColoredDetails: boolean,
) {
  for (let y = 0; y < height; y += 1) {
    let pixel = y * width * 4;
    const thresholdRow = (y & (BLUE_NOISE_SIZE - 1)) * BLUE_NOISE_SIZE;
    for (let x = 0; x < width; x += 1, pixel += 4) {
      if (preserveColoredDetails && isColoredDetail(data, pixel)) continue;
      const threshold = BLUE_NOISE_THRESHOLDS[thresholdRow + (x & (BLUE_NOISE_SIZE - 1))];
      writeMonochrome(data, pixel, luminance(data, pixel) / 255 < threshold ? 0 : 255);
    }
  }
}

function applyNewsprint(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  preserveColoredDetails: boolean,
) {
  for (let y = 0; y < height; y += 1) {
    let pixel = y * width * 4;
    for (let x = 0; x < width; x += 1, pixel += 4) {
      if (preserveColoredDetails && isColoredDetail(data, pixel)) continue;
      // A fixed 45-degree clustered-dot screen keeps the halftone stable and
      // avoids trigonometry inside the 4.32-million-pixel export loop.
      const screenX = (x + y) & (NEWSPRINT_SIZE - 1);
      const screenY = (y - x) & (NEWSPRINT_SIZE - 1);
      const threshold = NEWSPRINT_THRESHOLDS[screenY * NEWSPRINT_SIZE + screenX];
      writeMonochrome(data, pixel, luminance(data, pixel) / 255 < threshold ? 0 : 255);
    }
  }
}

export function applyPdfRasterPreset(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  preset: PdfChartRasterPreset,
  preserveColoredDetails: boolean,
) {
  if (preset === "clean") {
    if (!preserveColoredDetails) applyCleanMonochrome(data);
    return;
  }
  if (preset === "atkinson") {
    applyAtkinson(data, width, height, preserveColoredDetails);
    return;
  }
  if (preset === "blue-noise") {
    applyBlueNoise(data, width, height, preserveColoredDetails);
    return;
  }
  applyNewsprint(data, width, height, preserveColoredDetails);
}
