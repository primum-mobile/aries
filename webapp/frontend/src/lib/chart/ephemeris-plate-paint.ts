// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// One plate paint for the live frame and for Save as image / chart export:
// the same geometry call, scene, style and painters, so an exported PNG is
// the plate on screen.

import type { EphemerisCamera } from "./ephemeris-camera";
import { paintEphemerisChrome } from "./ephemeris-chrome-paint";
import { computeEphemerisGeometry, type EphemerisGeometry, type TextMeasure } from "./ephemeris-geometry";
import type { EphemerisFrameData } from "./ephemeris-block-store";
import { paintEphemerisPlot } from "./ephemeris-plot-paint";
import { paintEphemerisContacts, paintEphemerisRadix, paintEphemerisRadixBands, type EphemerisRadixLayer } from "./ephemeris-radix";
import type { EphemerisRadixRecede } from "./ephemeris-recede-fade";
import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisScene, EphemerisSurface } from "./ephemeris-scene";

export type EphemerisPlateSize = Readonly<{ w: number; h: number; dpr: number }>;

/** Everything the chrome layer reads: it repaints only when one of these
 * changes (by identity). */
export function ephemerisChromeInputs(size: EphemerisPlateSize, style: EphemerisRenderStyle, scene: EphemerisScene): readonly unknown[] {
  return [size.w, size.h, size.dpr, style, scene.mode, scene.showGrid, scene.signGlyphs, scene.planets, scene.modulus, scene.mirrored, scene.showEquator, scene.showSignBands, scene.showRadix];
}

export function sameEphemerisChromeInputs(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  return a != null && a.length === b.length && b.every((v, i) => v === a[i]);
}

/** The plate geometry for this size, scene and style. */
export function ephemerisPlateGeometry(
  size: EphemerisPlateSize,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  measure: TextMeasure,
): EphemerisGeometry {
  return computeEphemerisGeometry(size.w, size.h, scene.mode, measure, style, scene.modulus, scene.mirrored ?? false, scene.showSignBands ?? false, scene.showRadix ?? false, {
    planets: scene.planets.map((planet) => planet.glyph),
    signs: scene.signGlyphs,
  });
}

/** The scene an exported plate paints: the live scene, every heavy field by
 * identity, without the pointer's highlight or natal-line focus (hovered or
 * pinned). */
export function ephemerisExportScene(scene: EphemerisScene): EphemerisScene {
  return scene.highlightPlanetId == null && scene.radixFocusKey == null
    ? scene
    : { ...scene, highlightPlanetId: null, radixFocusKey: null, radixFocusPinned: false };
}

export type EphemerisPlateLayers = Readonly<{
  geo: EphemerisGeometry;
  camera: EphemerisCamera;
  data: EphemerisFrameData;
  scene: EphemerisScene;
  style: EphemerisRenderStyle;
  measure: TextMeasure;
  radix: EphemerisRadixLayer;
  /** The live pin fade (frame only); absent = settled from the scene, as an
   * export paints. */
  recede?: EphemerisRadixRecede;
}>;

/** Chrome under (skipped when null: the retained chrome is still current),
 * then the plot and the radix layer over it. */
export function paintEphemerisPlate(
  chrome: EphemerisSurface | null,
  plot: EphemerisSurface,
  { geo, camera, data, scene, style, measure, radix, recede }: EphemerisPlateLayers,
): void {
  if (chrome) paintEphemerisChrome(chrome, geo, scene, style);
  const bands = scene.showRadix && scene.showRadixBands
    ? (ctx: CanvasRenderingContext2D) => paintEphemerisRadixBands(ctx, geo, radix, scene, style, recede)
    : undefined;
  paintEphemerisPlot(plot, geo, camera, data, scene, style, measure, bands);
  if (scene.showRadix) paintEphemerisRadix(plot, geo, camera, radix, scene, style, recede);
  if (scene.showPlanetContacts) paintEphemerisContacts(plot, geo, camera, radix, scene, style);
}
