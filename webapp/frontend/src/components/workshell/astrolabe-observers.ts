// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Layout } from './astrolabe-canvas';
import type { AstrolabeProjection } from '@/lib/daemon/client';

/** Metres east/north on a level ground plane, eye 1.6 m above it. */
export const OBSERVER_HEIGHTS = [2.7, 2.7, 1] as const;
export const OBSERVER_ANCHORS = [0.505, 0.665, 0.36] as const;
export const OBSERVER_FOOT = 0.988;
export type ObserverPosition = readonly [number, number];
export const OBSERVER_DEFAULTS: ObserverPosition[] = [[-2, 7], [1, 9], [2, 4]];
export type ObserverFrame = { layout: Layout; projection: AstrolabeProjection; lat: number; edge: number };
export function observerRay(x: number, y: number, frame: ObserverFrame): [number, number, number] | null {
  const px = (x - frame.layout.cx) / frame.layout.scale;
  const py = (y - frame.layout.cy) / frame.layout.scale;
  const r = Math.hypot(px, py);
  if (r > frame.edge) return null;
  const z = frame.projection === 'polarEquidistant' ? r * Math.PI / 2 : 2 * Math.atan(r);
  const k = r > 0 ? Math.sin(z) / r : frame.projection === 'polarEquidistant' ? Math.PI / 2 : 2;
  const a = frame.lat * Math.PI / 180;
  return [-px * k, Math.cos(z) * Math.cos(a) + py * k * Math.sin(a), Math.cos(z) * Math.sin(a) - py * k * Math.cos(a)];
}
export function observerGround(ray: readonly number[]): ObserverPosition | null {
  if (ray[2] >= -0.02) return null;
  const t = -1.6 / ray[2];
  const east = ray[0] * t, north = ray[1] * t;
  const distance = Math.hypot(east, north);
  if (distance < 2 || distance > 60) return null;
  return [east, north];
}
/** Match the shader's radial upright billboard intersection for picking. */
export function observerHit(ray: readonly number[], position: ObserverPosition, pose: number): boolean {
  const d = Math.hypot(...position), nx = position[0] / d, ny = position[1] / d;
  const facing = ray[0] * nx + ray[1] * ny;
  if (facing <= 0) return false;
  const t = d / facing;
  const across = (ray[0] * ny - ray[1] * nx) * t;
  const up = 1.6 + ray[2] * t;
  const height = OBSERVER_HEIGHTS[pose];
  const u = OBSERVER_ANCHORS[pose] + across / height;
  const v = OBSERVER_FOOT - up / height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  if (!hitMask) return Math.abs(across) < height * 0.2 && up >= 0 && up <= height;
  return hitMask[(Math.floor(v * 1024) * 3072 + pose * 1024 + Math.floor(u * 1024)) * 4 + 3] > 64;
}
export function observerFootScreen(position: ObserverPosition, frame: ObserverFrame): ObserverPosition {
  const length = Math.hypot(...position, 1.6);
  const east = position[0] / length, north = position[1] / length, up = -1.6 / length;
  const a = frame.lat * Math.PI / 180;
  const ex = -east, ey = up * Math.cos(a) - north * Math.sin(a), ez = up * Math.sin(a) + north * Math.cos(a);
  const k = frame.projection === 'polarEquidistant'
    ? Math.acos(Math.max(-1, Math.min(1, ez))) / (Math.PI / 2) / Math.max(1e-12, Math.hypot(ex, ey))
    : 1 / (1 + ez);
  return [frame.layout.cx + ex * k * frame.layout.scale, frame.layout.cy - ey * k * frame.layout.scale];
}
const STORAGE = 'aries.designTuner.astrolabeObservers';
export function readObservers(): { enabled: boolean; positions: ObserverPosition[] } {
  const defaults = { enabled: false, positions: OBSERVER_DEFAULTS.map(p => [...p] as ObserverPosition) };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (!raw || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.positions) || raw.positions.length !== 3) return defaults;
    if (!raw.positions.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
      && Math.hypot(...p) >= 2 && Math.hypot(...p) <= 60)) return defaults;
    return raw;
  } catch { return defaults; }
}
export function writeObservers(enabled: boolean, positions: ObserverPosition[]) {
  try { localStorage.setItem(STORAGE, JSON.stringify({ enabled, positions })); } catch { /* best effort, like the other experimental tunes */ }
}

let hitMask: Uint8ClampedArray | undefined;
let maskLoad: Promise<void> | undefined;
/** One decode/readback for alpha picking, never a frame-time image transform. */
export function loadObserverHitMask(): Promise<void> {
  return maskLoad ??= (async () => {
    const img = new Image();
    img.src = '/astrolabe/munster-observers.png';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 3072; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    hitMask = ctx.getImageData(0, 0, 3072, 1024).data;
  })().catch(error => { maskLoad = undefined; console.error('[astrolabe-observers]', error); });
}
