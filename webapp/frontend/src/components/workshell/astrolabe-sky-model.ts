// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AstrolabeProjection } from "@/lib/daemon/client";
import type { CityFrame } from "./astrolabe-city";
import type { SkyShading } from "./astrolabe-sky-gpu";

export type AstrolabeSkyTune = {
  /** Aerosol (Mie) density as a slider position: 0.25 · 24^haze times clear air. */
  haze: number;
  /** Ozone layer density, times Earth's mean. */
  ozone: number;
  /** Exposure bias, EV. */
  exposure: number;
  /** Lens diffusion, 0..1. */
  diffusion: number;
  /** Opacity of the dithered sky over the flat colour, 0..1. */
  strength: number;
  /** 1: finer pictures under zoom, and every on-screen picture shaded and
   * dithered on the GPU where WebGPU allows (design tuner). Absent or 0: one
   * picture magnified at every zoom, shaded with WebGL, dithered on the CPU. */
  finerZoom?: number;
};

/** The look picked in the design tuner: 2.0× haze, 2.35×
 * ozone, +0.6 EV, full diffusion, the dither at full strength over the flat
 * colour, with finer pictures under zoom shaded and dithered on the GPU
 * where WebGPU allows. The tuner moves them in development builds; shipped
 * builds use these. */
export const ASTROLABE_SKY_DEFAULT: AstrolabeSkyTune = {
  haze: 0.66, ozone: 2.35, exposure: 0.6, diffusion: 1, strength: 1, finerZoom: 1,
};

export type AstrolabeSkyLayer = {
  /** The directed Sun's true altitude and azimuth (deg, from north through east). */
  sunAltitude: number;
  sunAzimuth: number;
  tune: AstrolabeSkyTune;
};

/** The physical sky for a plate's atmospheric payload, or null for payloads without the Sun's azimuth. */
export function astrolabeSkyLayer(
  atmospheric: { sunAltitude: number; sunAzimuth?: number },
  tune: AstrolabeSkyTune | null | undefined,
): AstrolabeSkyLayer | null {
  const { sunAltitude, sunAzimuth } = atmospheric;
  if (!Number.isFinite(sunAltitude) || typeof sunAzimuth !== "number" || !Number.isFinite(sunAzimuth)) return null;
  return { sunAltitude, sunAzimuth, tune: tune ?? ASTROLABE_SKY_DEFAULT };
}

const D = Math.PI / 180;
const RG = 6360;
/** Observer 30 m up: the horizon dips 0.18°, and the plain's airlight hugs it. */
const CAM_H = 0.03;
export const VIEW_R = RG + CAM_H;
export const CAM_C = CAM_H * (2 * RG + CAM_H);
export const BETA = Math.acos(Math.sqrt(CAM_C) / VIEW_R);
const EXP_K = 0.18;
const EXP_MAX = 120;
/** Plate-space image (metering and diffusion), px across the plate square. */
export const PLATE_PX = 512;
/** Diffusion levels; the widest is 1/32 of the plate across. */
export const BLOOM_LEVELS = 5;
export const BLOOM_FALLOFF = 0.55;
const BLOOM_NORM = (1 - BLOOM_FALLOFF ** BLOOM_LEVELS) / (1 - BLOOM_FALLOFF);
/** Sky picture size, dots across the plate square: one per CSS px of the
 * unzoomed plate, within these bounds. */
const PICTURE_MIN = 256;
const PICTURE_MAX = 2048;
/** Magnification from which the fine picture is drawn: the city's
 * FINE_FROM_ZOOM (astrolabe-city.ts), so the sky's dots keep their 1× size
 * against the woodcut's grain. */
const FINE_FROM_ZOOM = 1.5;
/** Magnification from which the GPU dither draws the finest picture, four
 * times the base picture's dots across. */
const FINEST_FROM_ZOOM = 3;
/** On the CPU the fine picture has twice the base picture's dots across, at
 * most this many: about four times the dithering of an 800 px plate. */
const FINE_MAX = 1600;
/** Most dots across a picture with the GPU up: the dither alone took
 * 14..41 ms on an M2 in the native research runs (Atkinson GPU feasibility,
 * 4 Nov 2026), so 3200 is the costly tier. */
const GPU_PICTURE_MAX = 3200;

export type Tier = "base" | "fine" | "finest";

/** Which pictures zoom may draw: the base one only, the CPU's fine one too
 * (`finerZoom` while the GPU dither comes up or without it), or the GPU's
 * three. */
export type SkyTiers = "single" | "cpu" | "gpu";

/** Dots across the base picture (the palette's source) and across the
 * picture drawn at `magnification`, the zoom times any device pixels beyond
 * a Retina screen's, and that picture's tier. */
export function skyPictureSizes(fittedRadiusPx: number, magnification: number, tiers: SkyTiers = "single"): {
  base: number; shown: number; tier: Tier;
} {
  const base = Math.min(PICTURE_MAX, Math.max(PICTURE_MIN, Math.round(2 * fittedRadiusPx)));
  if (tiers === "single") return { base, shown: base, tier: "base" };
  const gpu = tiers === "gpu";
  const max = gpu ? GPU_PICTURE_MAX : FINE_MAX;
  const fine = Math.min(max, 2 * base);
  const finest = gpu ? Math.min(max, 4 * base) : fine;
  if (magnification >= FINEST_FROM_ZOOM && finest > fine) return { base, shown: finest, tier: "finest" };
  if (magnification >= FINE_FROM_ZOOM && fine > base) return { base, shown: fine, tier: "fine" };
  return { base, shown: base, tier: "base" };
}

/** The shading of the whole plate for this Sun and look, for WebGL and
 * WebGPU alike, and what a coherent frame's picture must match: plate, Sun
 * and look, not its dots across. */
export function skyShading(
  projection: AstrolabeProjection,
  frame: Pick<CityFrame, "lat" | "pole">,
  rEdge: number,
  layer: AstrolabeSkyLayer,
): { shading: SkyShading; content: string } {
  const { tune } = layer;
  // The Sun in the plate's horizon frame. A southern stereographic plate is
  // drawn for |lat| with the sky reflected through the equator, which swaps
  // north and south: bearing 180° − azimuth.
  const alt = layer.sunAltitude * D;
  const bearing = ((frame.pole ?? 1) < 0 ? 180 - layer.sunAzimuth : layer.sunAzimuth) * D;
  const sunDir = [Math.sin(bearing) * Math.cos(alt), Math.cos(bearing) * Math.cos(alt), Math.sin(alt)] as const;
  const haze = 0.25 * 24 ** tune.haze;
  const plateKey = [projection, frame.lat, frame.pole ?? 1, rEdge, ...sunDir, haze, tune.ozone, tune.exposure].join("|");
  const ext0 = [5.802e-3, 13.558e-3, 33.1e-3].map((v) => v + 4.44e-3 * haze);
  return {
    shading: {
      polar: projection === "polarEquidistant",
      lat: [Math.sin(frame.lat * D), Math.cos(frame.lat * D)],
      sunDir,
      haze,
      ozone: tune.ozone,
      ext0: [ext0[0], ext0[1], ext0[2]],
      viewR: VIEW_R,
      beta: BETA,
      camC: CAM_C,
      expK: EXP_K,
      expMax: EXP_MAX,
      expScale: 2 ** tune.exposure,
      edge: rEdge,
      diffuse: 0.32 * tune.diffusion * tune.diffusion,
      bloomNorm: BLOOM_NORM,
      bloomFalloff: BLOOM_FALLOFF,
      platePx: PLATE_PX,
      bloomLevels: BLOOM_LEVELS,
      atmosKey: `${haze}|${tune.ozone}`,
      skyKey: `${sunDir[2]}`,
      plateKey,
    },
    content: `${plateKey}|${tune.diffusion}`,
  };
}
