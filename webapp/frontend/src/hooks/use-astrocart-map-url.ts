// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import {
  daemonAuthToken,
  daemonBaseUrl,
  fetchAstrocartBasemap,
  type AstrocartBasemapMeta,
} from "@/lib/daemon/client";

const FORCE_LOCAL_TILES_KEY = "ARIES_ASTROCART_FORCE_LOCAL_TILES";
const PERF_MODE_KEY = "ARIES_ASTROCART_PERF";

let basemapMetaPromise: Promise<AstrocartBasemapMeta> | null = null;

type AstrocartMapUrlOptions = {
  theme: "dark" | "light";
  pageBg: string;
  places?: string;
  titlebarSafeTop?: number;
};

type AstrocartMapLifecycleOptions = {
  allowTileAdoption?: boolean;
};

function readDebugFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const value = window.localStorage.getItem(key);
    return value === "1" || value === "true" || value === "on";
  } catch {
    return false;
  }
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function fetchBasemapMetaWithRetry(): Promise<AstrocartBasemapMeta> {
  let lastError: unknown;
  for (const delayMs of [0, 80, 240]) {
    if (delayMs) await waitForRetry(delayMs);
    try {
      return await fetchAstrocartBasemap();
    } catch (err) {
      lastError = err;
    }
  }
  console.error("[acg-basemap]", lastError);
  throw lastError;
}

function loadBasemapMeta(): Promise<AstrocartBasemapMeta> {
  if (!basemapMetaPromise) {
    basemapMetaPromise = fetchBasemapMetaWithRetry()
      .finally(() => {
        basemapMetaPromise = null;
      });
  }
  return basemapMetaPromise;
}

function buildAstrocartMapUrl(
  options: AstrocartMapUrlOptions,
  basemapMeta: AstrocartBasemapMeta,
): string {
  const params = new URLSearchParams({
    theme: options.theme,
    pageBg: options.pageBg,
  });
  if (options.places) params.set("places", options.places);
  if (options.titlebarSafeTop != null) params.set("titlebarSafeTop", String(options.titlebarSafeTop));
  const forceLocalTiles = readDebugFlag(FORCE_LOCAL_TILES_KEY);
  if (basemapMeta.hasLocalTiles && basemapMeta.tilesUrl) {
    params.set("tiles", basemapMeta.tilesUrl);
  }
  // Deterministic performance runs use the minimal bundled fallback when no
  // PMTiles archive exists; they must never depend on a network basemap.
  if (forceLocalTiles) params.set("offline", "1");
  const token = daemonAuthToken();
  if (token) params.set("token", token);
  if (readDebugFlag(PERF_MODE_KEY)) params.set("perf", "1");
  return `${daemonBaseUrl()}/Res/astrocart/map.html?${params.toString()}`;
}

export function useAstrocartMapUrl(
  options: AstrocartMapUrlOptions,
  lifecycle: AstrocartMapLifecycleOptions = {},
): string | null {
  const { pageBg, places, theme, titlebarSafeTop } = options;
  const allowTileAdoption = lifecycle.allowTileAdoption !== false;
  const resolvedOnceRef = React.useRef(false);
  const [basemapMeta, setBasemapMeta] = React.useState<AstrocartBasemapMeta | null>(null);

  React.useEffect(() => {
    let active = true;
    let pollTimer: number | null = null;
    let pollAttempt = 0;
    const schedulePoll = () => {
      const delays = [2000, 5000, 10000, 30000];
      const delay = delays[Math.min(pollAttempt, delays.length - 1)];
      pollAttempt += 1;
      pollTimer = window.setTimeout(refresh, delay);
    };
    const refresh = () => {
      loadBasemapMeta().then((meta) => {
        if (!active) return;
        const initialResolution = !resolvedOnceRef.current;
        resolvedOnceRef.current = true;
        // A newly installed archive is adopted while this surface is hidden,
        // avoiding a cold iframe replacement in the middle of map use.
        if (initialResolution || !meta.hasLocalTiles || allowTileAdoption) {
          setBasemapMeta((current) => (
            current &&
            current.hasLocalTiles === meta.hasLocalTiles &&
            current.tilesUrl === meta.tilesUrl &&
            current.installing === meta.installing
              ? current
              : meta
          ));
        }
        if (!meta.hasLocalTiles && meta.installing) schedulePoll();
      }).catch(() => {
        if (active) schedulePoll();
      });
    };
    refresh();
    return () => {
      active = false;
      if (pollTimer != null) window.clearTimeout(pollTimer);
    };
  }, [allowTileAdoption]);

  return React.useMemo(() => {
    if (!basemapMeta) return null;
    return buildAstrocartMapUrl({ pageBg, places, theme, titlebarSafeTop }, basemapMeta);
  }, [basemapMeta, pageBg, places, theme, titlebarSafeTop]);
}
