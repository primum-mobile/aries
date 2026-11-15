// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Atkinson dithering of the astrolabe's physical sky (astrolabe-sky.ts) in
 * the sky's own colours, Horizon Aura's preset 2. Error diffusion is serial,
 * so it runs on the CPU over a readback of the shaded plate. The palette is a
 * median cut of the whole plate plus its brightest pixel, so the Sun
 * survives. Pure functions, no DOM.
 */

/** Bits per channel of the nearest-colour lookup. */
const LOOKUP_BITS = 5;
const LOOKUP_SIDE = 1 << LOOKUP_BITS;
const LOOKUP_SHIFT = 8 - LOOKUP_BITS;
/** Median-cut colours; the brightest pixel is one more. */
const PALETTE_COLOURS = 16;
/** Plate samples the median cut sorts; more only slows it down. */
const PALETTE_SAMPLES = 6000;
/** Lookup entry not computed yet (palettes stay far below 255 colours). */
const UNSET = 255;

/** Pixels between the median cut's samples of a picture `total` pixels large. */
export const paletteSampleStep = (total: number) => Math.max(1, Math.floor(total / PALETTE_SAMPLES));

/**
 * Median cut over a sample of the plate pixels (RGBA, alpha > 0 inside the
 * plate), every `step`th pixel, plus the brightest one. Returns packed RGB
 * triples.
 */
export function medianCutPalette(
  src: Uint8Array | Uint8ClampedArray,
  colours: number,
  step = paletteSampleStep(src.length / 4),
): Float32Array {
  const total = src.length / 4;
  const points: number[][] = [];
  let bright: number[] | null = null;
  let brightLuma = -1;
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (src[o + 3] === 0) continue;
    const point = [src[o], src[o + 1], src[o + 2]];
    points.push(point);
    const luma = 0.299 * point[0] + 0.587 * point[1] + 0.114 * point[2];
    if (luma > brightLuma) {
      brightLuma = luma;
      bright = point;
    }
  }
  if (!points.length) return Float32Array.from([0, 0, 0]);
  const boxes = [points];
  while (boxes.length < colours) {
    let widest = -1;
    let channel = 0;
    let range = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of box) {
          if (p[c] < lo) lo = p[c];
          if (p[c] > hi) hi = p[c];
        }
        if (hi - lo > range) {
          range = hi - lo;
          widest = index;
          channel = c;
        }
      }
    });
    if (widest < 0) break;
    const box = boxes[widest].sort((a, b) => a[channel] - b[channel]);
    boxes.splice(widest, 1, box.slice(0, box.length >> 1), box.slice(box.length >> 1));
  }
  const palette = boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const p of box) {
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
    }
    return sum.map((v) => v / box.length);
  });
  if (bright) palette.push(bright);
  return Float32Array.from(palette.flat());
}

/** An empty nearest-entry cache for one palette at LOOKUP_BITS per channel;
 * `ditherAtkinson` fills it as colours come up, since a sky uses only a few. */
export function createPaletteLookup(): Uint8Array {
  return new Uint8Array(LOOKUP_SIDE ** 3).fill(UNSET);
}

/** The whole nearest-entry lookup of `palette`, every cell filled as
 * `ditherAtkinson` fills it on demand, for the GPU (astrolabe-sky-gpu.ts). */
export function paletteLookupTable(palette: Float32Array): Uint8Array {
  const lookup = createPaletteLookup();
  const half = (1 << LOOKUP_SHIFT) / 2;
  for (let cell = 0; cell < lookup.length; cell++) {
    const ri = cell >> (2 * LOOKUP_BITS);
    const gi = (cell >> LOOKUP_BITS) & (LOOKUP_SIDE - 1);
    const bi = cell & (LOOKUP_SIDE - 1);
    lookup[cell] = nearest(palette, (ri << LOOKUP_SHIFT) + half, (gi << LOOKUP_SHIFT) + half, (bi << LOOKUP_SHIFT) + half);
  }
  return lookup;
}

/** Floats of `work` that `ditherAtkinson` needs for rows `w` pixels wide. */
export const ditherWorkLength = (w: number) => 9 * (w + 4);

/** The palette entry nearest a colour, by weighted RGB distance. */
function nearest(palette: Float32Array, r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let k = 0; k < palette.length; k += 3) {
    const dr = r - palette[k];
    const dg = g - palette[k + 1];
    const db = b - palette[k + 2];
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k / 3;
    }
  }
  return best;
}

/**
 * Atkinson error diffusion of `src` (RGBA, rows bottom-up as readPixels
 * returns them) into `out` (RGBA, rows top-down), every pixel a palette
 * colour. 1/8 of the error goes to each of six neighbours; the other 2/8 is
 * dropped, which keeps highlights and shadows clean. `lookup` caches the
 * nearest entry per colour cell (createPaletteLookup, one per palette);
 * `work` holds the error of three rows (ditherWorkLength).
 */
export function ditherAtkinson(
  src: Uint8Array,
  w: number,
  h: number,
  palette: Float32Array,
  lookup: Uint8Array,
  out: Uint8ClampedArray,
  work: Float32Array,
) {
  // Rows of error, padded two pixels each side so edge spill needs no test.
  const stride = (w + 4) * 3;
  const half = (1 << LOOKUP_SHIFT) / 2;
  const top = LOOKUP_SIDE - 1;
  work.fill(0, 0, 3 * stride);
  for (let y = 0; y < h; y++) {
    const row = (y % 3) * stride;
    const next = ((y + 1) % 3) * stride;
    const after = ((y + 2) % 3) * stride;
    work.fill(0, after, after + stride);
    const s0 = (h - 1 - y) * w * 4;
    const o0 = y * w * 4;
    for (let x = 0; x < w; x++) {
      const e = row + (x + 2) * 3;
      const s = s0 + x * 4;
      const r = src[s] + work[e];
      const g = src[s + 1] + work[e + 1];
      const b = src[s + 2] + work[e + 2];
      const ri = r <= 0 ? 0 : r >= 255 ? top : r >> LOOKUP_SHIFT;
      const gi = g <= 0 ? 0 : g >= 255 ? top : g >> LOOKUP_SHIFT;
      const bi = b <= 0 ? 0 : b >= 255 ? top : b >> LOOKUP_SHIFT;
      const cell = (ri << (2 * LOOKUP_BITS)) | (gi << LOOKUP_BITS) | bi;
      let k = lookup[cell];
      if (k === UNSET) {
        k = nearest(palette, (ri << LOOKUP_SHIFT) + half, (gi << LOOKUP_SHIFT) + half, (bi << LOOKUP_SHIFT) + half);
        lookup[cell] = k;
      }
      const pr = palette[3 * k];
      const pg = palette[3 * k + 1];
      const pb = palette[3 * k + 2];
      const o = o0 + x * 4;
      out[o] = pr;
      out[o + 1] = pg;
      out[o + 2] = pb;
      out[o + 3] = 255;
      const er = (r - pr) * 0.125;
      const eg = (g - pg) * 0.125;
      const eb = (b - pb) * 0.125;
      work[e + 3] += er; work[e + 4] += eg; work[e + 5] += eb;
      work[e + 6] += er; work[e + 7] += eg; work[e + 8] += eb;
      const n = next + (x + 2) * 3;
      work[n - 3] += er; work[n - 2] += eg; work[n - 1] += eb;
      work[n] += er; work[n + 1] += eg; work[n + 2] += eb;
      work[n + 3] += er; work[n + 4] += eg; work[n + 5] += eb;
      const a = after + (x + 2) * 3;
      work[a] += er; work[a + 1] += eg; work[a + 2] += eb;
    }
  }
}

/**
 * `ditherAtkinson` in Float32 throughout, as the GPU computes it
 * (astrolabe-sky-gpu.ts): each colour plus its incoming error and each error
 * share rounded to Float32. The GPU kernel's reference; it matches
 * `ditherAtkinson` on most pictures, but not dot for dot on large ones.
 * `lookup` is a full paletteLookupTable.
 */
export function ditherAtkinsonFloat32(
  src: Uint8Array,
  w: number,
  h: number,
  palette: Float32Array,
  lookup: Uint8Array,
  out: Uint8ClampedArray,
) {
  const f = Math.fround;
  const stride = (w + 4) * 3;
  const top = LOOKUP_SIDE - 1;
  const work = new Float32Array(3 * stride);
  for (let y = 0; y < h; y++) {
    const row = (y % 3) * stride;
    const next = ((y + 1) % 3) * stride;
    const after = ((y + 2) % 3) * stride;
    work.fill(0, after, after + stride);
    for (let x = 0; x < w; x++) {
      const e = row + (x + 2) * 3;
      const s = ((h - 1 - y) * w + x) * 4;
      const r = f(src[s] + work[e]);
      const g = f(src[s + 1] + work[e + 1]);
      const b = f(src[s + 2] + work[e + 2]);
      const ri = r <= 0 ? 0 : r >= 255 ? top : r >> LOOKUP_SHIFT;
      const gi = g <= 0 ? 0 : g >= 255 ? top : g >> LOOKUP_SHIFT;
      const bi = b <= 0 ? 0 : b >= 255 ? top : b >> LOOKUP_SHIFT;
      const k = lookup[(ri << (2 * LOOKUP_BITS)) | (gi << LOOKUP_BITS) | bi];
      const o = (y * w + x) * 4;
      out[o] = palette[3 * k];
      out[o + 1] = palette[3 * k + 1];
      out[o + 2] = palette[3 * k + 2];
      out[o + 3] = 255;
      const share = [f(f(r - palette[3 * k]) * 0.125), f(f(g - palette[3 * k + 1]) * 0.125), f(f(b - palette[3 * k + 2]) * 0.125)];
      const n = next + (x + 2) * 3;
      const a = after + (x + 2) * 3;
      for (let c = 0; c < 3; c++) {
        work[e + 3 + c] += share[c];
        work[e + 6 + c] += share[c];
        work[n - 3 + c] += share[c];
        work[n + c] += share[c];
        work[n + 3 + c] += share[c];
        work[a + c] += share[c];
      }
    }
  }
}

/** The palette of one shaded plate picture (RGBA): its median cut plus its brightest pixel. */
export const platePalette = (pixels: Uint8Array) => medianCutPalette(pixels, PALETTE_COLOURS);

/** `platePalette` from the picture's samples alone (RGBA, in readback order),
 * as the GPU gathers them (astrolabe-sky-wgsl.ts): every one is used. */
export const platePaletteOfSamples = (samples: Uint8Array) => medianCutPalette(samples, PALETTE_COLOURS, 1);

/** One shaded plate picture (RGBA, rows bottom-up, `size` square) dithered
 * onto `palette`, by default its own, rows top-down. */
export function ditherPlatePicture(
  pixels: Uint8Array,
  size: number,
  palette = platePalette(pixels),
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  ditherAtkinson(pixels, size, size, palette, createPaletteLookup(), out, new Float32Array(ditherWorkLength(size)));
  return out;
}
