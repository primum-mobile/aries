// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import {
  ASTROLABE_CAMERA_IDENTITY,
  astrolabeCameraFromZoom,
  astrolabeZoomFromCamera,
  normalizeAstrolabeCamera,
} from "../src/lib/chart/astrolabe-camera";
import { astrolabeReteTurn, createAstrolabeReteSurface, hitAstrolabeRete } from "../src/components/workshell/astrolabe-canvas";

test("rete rotation crosses the angular seam without reversing or jumping", () => {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  expect(astrolabeReteTurn(rad(179), rad(-179))).toBeCloseTo(2);
  expect(astrolabeReteTurn(rad(-179), rad(179))).toBeCloseTo(-2);
  expect(astrolabeReteTurn(rad(60), rad(60))).toBe(0);
  let total = 0;
  for (let angle = 0; angle < 720; angle += 30) total += astrolabeReteTurn(rad(angle % 360), rad((angle + 30) % 360));
  expect(total).toBeCloseTo(720);
});

test("continuous zodiac bands include their full height plus five pixels on both sides", () => {
  const surface = createAstrolabeReteSurface();
  surface.center = [-1000, 200];
  surface.segments.push([100, 100, 500, 100, 30]);
  surface.markers.push({ x: 200, y: 300, size: 20 });
  surface.rings.push({ x: -1000, y: 200, inner: 1600, outer: 1640 });
  surface.band = { x: 1000, y: 500, inner: 80, outer: 120 };
  expect(hitAstrolabeRete(surface, 300, 130)).toBe(true);
  expect(hitAstrolabeRete(surface, 300, 134)).toBe(true);
  expect(hitAstrolabeRete(surface, 300, 136)).toBe(false);
  expect(hitAstrolabeRete(surface, 300, 66)).toBe(true);
  expect(hitAstrolabeRete(surface, 300, 64)).toBe(false);
  expect(hitAstrolabeRete(surface, 215, 300)).toBe(true);
  expect(hitAstrolabeRete(surface, 214, 300)).toBe(true);
  expect(hitAstrolabeRete(surface, 216, 300)).toBe(false);
  expect(hitAstrolabeRete(surface, 1124, 500)).toBe(true);
  expect(hitAstrolabeRete(surface, 1126, 500)).toBe(false);
  expect(hitAstrolabeRete(surface, 1076, 500)).toBe(true);
  expect(hitAstrolabeRete(surface, 1074, 500)).toBe(false);
  surface.band.padding = 20;
  expect(hitAstrolabeRete(surface, 1140, 500)).toBe(true);
  expect(hitAstrolabeRete(surface, 1141, 500)).toBe(false);
  expect(hitAstrolabeRete(surface, 1060, 500)).toBe(true);
  expect(hitAstrolabeRete(surface, 1059, 500)).toBe(false);
  expect(hitAstrolabeRete(surface, 620, 200)).toBe(true);
  expect(hitAstrolabeRete(surface, 651, 200)).toBe(false);
  expect(hitAstrolabeRete(surface, 400, 500)).toBe(false);
});

test("camera memory restores the same centre in differently sized panes", () => {
  const camera = astrolabeCameraFromZoom({ k: 8, x: -2160, y: -1560 }, 900, 800);
  expect(camera).toEqual({ k: 8, centerX: 0.3625, centerY: 0.30625 });
  const resized = astrolabeZoomFromCamera(camera, 450, 600);
  expect(resized.k).toBe(8);
  expect(resized.x).toBeCloseTo(-1080);
  expect(resized.y).toBeCloseTo(-1170);
  const restored = astrolabeCameraFromZoom(resized, 450, 600);
  expect(restored.centerX).toBeCloseTo(camera.centerX);
  expect(restored.centerY).toBeCloseTo(camera.centerY);
});

test("normalization keeps the fitted viewport covered at every zoom", () => {
  for (const k of [1, 2, 4, 8, 12, 99]) {
    const camera = normalizeAstrolabeCamera({ k, centerX: -100, centerY: 100 })!;
    const zoom = astrolabeZoomFromCamera(camera, 900, 800);
    expect(zoom.k).toBe(Math.min(12, k));
    expect(zoom.x).toBeCloseTo(0);
    expect(zoom.y).toBeCloseTo(800 * (1 - zoom.k));
  }
  expect(normalizeAstrolabeCamera({ k: -1, centerX: 0.2, centerY: 0.8 })).toEqual(ASTROLABE_CAMERA_IDENTITY);
});

test("malformed camera state cannot produce nonfinite transforms", () => {
  for (const camera of [null, [], {}, { k: "4", centerX: 0.5, centerY: 0.5 },
    { k: NaN, centerX: 0.5, centerY: 0.5 }, { k: 4, centerX: Infinity, centerY: 0.5 }]) {
    expect(normalizeAstrolabeCamera(camera)).toBeNull();
    expect(astrolabeZoomFromCamera(camera, 900, 800)).toEqual({ k: 1, x: 0, y: 0 });
  }
  expect(astrolabeCameraFromZoom({ k: NaN, x: Infinity, y: NaN }, 0, NaN)).toEqual(ASTROLABE_CAMERA_IDENTITY);
  expect(astrolabeZoomFromCamera({ k: 4, centerX: 0.6, centerY: 0.4 }, Infinity, 0)).toEqual({ k: 4, x: -0, y: -0 });
});
