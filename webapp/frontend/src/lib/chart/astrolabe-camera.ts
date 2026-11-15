// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AstrolabeZoom } from "@/components/workshell/astrolabe-canvas";
import type { AstrolabeCamera } from "@/lib/daemon/client";

export const ASTROLABE_CAMERA_IDENTITY: AstrolabeCamera = { k: 1, centerX: 0.5, centerY: 0.5 };
const MAX_ZOOM = 12;

/** The same viewport-coverage limits as the astrolabe pan transform. */
export function normalizeAstrolabeCamera(value: unknown): AstrolabeCamera | null {
  if (!value || typeof value !== "object") return null;
  const camera = value as Partial<AstrolabeCamera>;
  if (![camera.k, camera.centerX, camera.centerY].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  const k = Math.min(MAX_ZOOM, Math.max(1, camera.k!));
  const margin = 0.5 / k;
  return {
    k,
    centerX: Math.max(margin, Math.min(1 - margin, camera.centerX!)),
    centerY: Math.max(margin, Math.min(1 - margin, camera.centerY!)),
  };
}

export function astrolabeCameraFromZoom(zoom: AstrolabeZoom, width: number, height: number): AstrolabeCamera {
  const k = Number.isFinite(zoom.k) ? Math.min(MAX_ZOOM, Math.max(1, zoom.k)) : 1;
  return normalizeAstrolabeCamera({
    k,
    centerX: width > 0 && Number.isFinite(width) && Number.isFinite(zoom.x) ? (0.5 - zoom.x / width) / k : 0.5,
    centerY: height > 0 && Number.isFinite(height) && Number.isFinite(zoom.y) ? (0.5 - zoom.y / height) / k : 0.5,
  })!;
}

export function astrolabeZoomFromCamera(value: unknown, width: number, height: number): AstrolabeZoom {
  const camera = normalizeAstrolabeCamera(value) ?? ASTROLABE_CAMERA_IDENTITY;
  const safeWidth = width > 0 && Number.isFinite(width) ? width : 0;
  const safeHeight = height > 0 && Number.isFinite(height) ? height : 0;
  return {
    k: camera.k,
    x: (0.5 - camera.k * camera.centerX) * safeWidth,
    y: (0.5 - camera.k * camera.centerY) * safeHeight,
  };
}
