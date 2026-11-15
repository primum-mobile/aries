// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris ink: which colour and weight each curve (and its labels)
// takes under the ink modes. Resolved once per scene and style, then
// read per sample by sign index, so a frame does no colour work.
//
//   tiers  Sun..Mars and the Moon in ink; Jupiter outward, Chiron, nodes and
//          apogees in muted ink, slightly thinner
//   planets each body in its own theme colour (the wheel's body token)
//   dignity each curve coloured by its essential dignity in the sign it is in
// A colour too faint against the paper (contrast below the style's floor)
// falls back to ink. The highlighted planet takes the signal colour.

import { MOON_ID, SIGN_NUM } from "./ephemeris-geometry";
import { ephemerisPlanetColorIndex, type EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisDignity, EphemerisScene, EphemerisScenePlanet } from "./ephemeris-scene";
import { wcagContrastRatio } from "../theme/linked-palette";

export const SUN_ID = 0;
/** Mercury, Venus, Mars: the inner tier with Sun and Moon. */
const INNER_IDS = new Set([2, 3, 4]);

export type EphemerisInk = Readonly<{
  planetId: number;
  /** Colour by sign index 0..11 (the same twelve times unless by dignity). */
  bySign: readonly string[];
  /** Distinct colours in bySign, in first-seen order. */
  runs: readonly string[];
  /** Index into runs for each sign. */
  runBySign: readonly number[];
  width: number;
  /** Under the pointer (or pinned): its own ink at the highlight weight;
   * every other curve keeps its normal look. */
  highlighted: boolean;
}>;

export function isInnerTier(planetId: number): boolean {
  return planetId === SUN_ID || planetId === MOON_ID || INNER_IDS.has(planetId);
}

export function curveWidth(planetId: number, scene: Pick<EphemerisScene, "inkMode">, style: EphemerisRenderStyle): number {
  const strokes = style.strokes;
  if (planetId === SUN_ID) return strokes.curveWidthSun;
  if (planetId === MOON_ID) return strokes.curveWidthMoon;
  if (INNER_IDS.has(planetId)) return strokes.curveWidthInner;
  return strokes.curveWidthOuter * (scene.inkMode === "tiers" ? strokes.tierOuterWidthScale : 1);
}

const contrastCache = new Map<string, number>();

/** WCAG contrast of `color` on `paper`, memoized (theme colours repeat). */
export function inkContrast(color: string, paper: string): number {
  const key = `${color}\n${paper}`;
  let value = contrastCache.get(key);
  if (value == null) {
    try {
      value = wcagContrastRatio(color, paper);
    } catch {
      value = Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(value)) value = Number.POSITIVE_INFINITY;
    if (contrastCache.size > 256) contrastCache.clear();
    contrastCache.set(key, value);
  }
  return value;
}

/** mockup planetColour: a candidate colour, or ink when it would vanish. */
export function legibleInk(color: string | undefined, style: EphemerisRenderStyle): string {
  const colors = style.colors;
  if (!color) return colors.ink;
  return inkContrast(color, colors.paper) >= style.strokes.inkContrastRatioMin ? color : colors.ink;
}

/** Colour of `planet` in sign `sign` (the highlight keeps it). */
export function ephemerisPlanetInk(
  planet: EphemerisScenePlanet,
  sign: number,
  scene: Pick<EphemerisScene, "inkMode" | "usePlanetColors" | "dignityBySign">,
  style: EphemerisRenderStyle,
): string {
  const colors = style.colors;
  if (scene.inkMode === "tiers") return isInnerTier(planet.id) ? colors.ink : colors.muted;
  if (scene.inkMode === "planets") {
    return legibleInk(colors.bodies[ephemerisPlanetColorIndex(planet.id)] || planet.color, style);
  }
  const dignity: EphemerisDignity = scene.dignityBySign?.[planet.id]?.[sign] ?? "peregrine";
  return legibleInk(colors.dignity[dignity] ?? colors.dignity.peregrine, style);
}

function buildInk(planet: EphemerisScenePlanet, scene: EphemerisScene, style: EphemerisRenderStyle): EphemerisInk {
  const highlighted = scene.highlightPlanetId === planet.id;
  const bySign: string[] = [];
  for (let sign = 0; sign < SIGN_NUM; sign++) bySign.push(ephemerisPlanetInk(planet, sign, scene, style));
  const width = curveWidth(planet.id, scene, style);
  const runs = [...new Set(bySign)];
  return Object.freeze({
    planetId: planet.id,
    bySign: Object.freeze(bySign),
    runs: Object.freeze(runs),
    runBySign: Object.freeze(bySign.map((color) => runs.indexOf(color))),
    width: highlighted ? Math.max(width, style.strokes.curveWidthHighlight) : width,
    highlighted,
  });
}

const inkCache = new WeakMap<EphemerisScene, { style: EphemerisRenderStyle; table: Map<number, EphemerisInk> }>();

/** Ink per planet for this scene and style; rebuilt only when either changes. */
export function ephemerisInkTable(scene: EphemerisScene, style: EphemerisRenderStyle): ReadonlyMap<number, EphemerisInk> {
  const cached = inkCache.get(scene);
  if (cached && cached.style === style) return cached.table;
  const table = new Map<number, EphemerisInk>();
  for (const planet of scene.planets) table.set(planet.id, buildInk(planet, scene, style));
  inkCache.set(scene, { style, table });
  return table;
}

/** Paint order: the highlighted planet last, over every other curve. */
export function ephemerisPaintOrder<T extends { id: number }>(planets: readonly T[], highlightPlanetId: number | null): T[] {
  if (highlightPlanetId == null) return [...planets];
  const rest = planets.filter((p) => p.id !== highlightPlanetId);
  const top = planets.find((p) => p.id === highlightPlanetId);
  return top ? [...rest, top] : rest;
}
