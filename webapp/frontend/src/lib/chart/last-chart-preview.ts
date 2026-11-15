// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Browser (WASM) build only: keeps a picture of the last painted chart on the
// device so the startup splash can show it while the engine starts, instead
// of an empty screen. The picture is the real renderer's output (the stacked
// chart canvases), never a second rendering of the chart.

const ENABLED = process.env.NEXT_PUBLIC_ARIES_WEB_ENGINE === "1";
// Kept by webapp/wasm/sw.js when it clears old caches.
const CACHE_NAME = "aries-last-chart-v1";
const CACHE_KEY = "/__aries-last-chart__";
// Captured once painting has been quiet this long, so stepping never pays for it.
const SETTLE_MS = 1500;
const MAX_SIDE = 1024;

let timer: number | null = null;

/** Call after a full chart paint; captures once painting settles. */
export function notifyChartPainted(): void {
  if (!ENABLED || typeof window === "undefined" || !("caches" in window)) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 0));
    // A failed capture (storage full, tainted canvas) just keeps the older picture.
    idle(() => void captureLastChart().catch(() => undefined));
  }, SETTLE_MS);
}

function largestChartHost(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const layer of document.querySelectorAll<HTMLCanvasElement>('canvas[data-aries-chart-layer="outer-label"]')) {
    const host = layer.parentElement;
    if (!host) continue;
    const rect = host.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = host;
      bestArea = area;
    }
  }
  return best;
}

function backgroundBehind(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return getComputedStyle(document.body).backgroundColor;
}

async function captureLastChart(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const host = largestChartHost();
  if (!host) return;
  const rect = host.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const layers = Array.from(host.children).filter(
    (child): child is HTMLCanvasElement => child instanceof HTMLCanvasElement && child.width > 0,
  );
  if (layers.length === 0) return;
  const scale = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(rect.width, rect.height));
  const out = document.createElement("canvas");
  out.width = Math.round(rect.width * scale);
  out.height = Math.round(rect.height * scale);
  const context = out.getContext("2d");
  if (!context) return;
  context.fillStyle = backgroundBehind(host);
  context.fillRect(0, 0, out.width, out.height);
  for (const layer of layers) context.drawImage(layer, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(CACHE_KEY, new Response(blob, { headers: { "content-type": blob.type } }));
}

/** Object URL of the last chart picture, or null. The caller revokes it. */
export async function loadLastChartPreview(): Promise<string | null> {
  if (!ENABLED || typeof window === "undefined" || !("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(CACHE_KEY);
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}
