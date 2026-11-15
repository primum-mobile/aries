// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Body hit on the Graphic Ephemeris plate: a start label (the gutter at the
// camera's left edge), else the planet curve nearest the pointer at that date.
// The Inspector follows it, and the view's curve highlight reads its planet.
// The plate's own hover flag keeps using hitTestEphemeris unchanged. Moments
// are quantized to the daily sample (0h UT) so moving along a curve asks the
// Inspector for one moment per day, not one per pixel.

import type { EphemerisCamera } from "./ephemeris-camera";
import type { EphemerisFrameData } from "./ephemeris-block-store";
import { mapEphemerisY, type EphemerisGeometry } from "./ephemeris-geometry";
import { ephemerisLabelJd, ephemerisStartLabels, ephemerisValueAt, sceneModulus } from "./ephemeris-plot-paint";
import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisScene } from "./ephemeris-scene";

export type EphemerisBodyHit = { planet: number; jd: number; value: number };

/** Nearest daily sample moment (0h UT). */
export function ephemerisDayJd(jd: number): number {
  return Math.round(jd - 0.5) + 0.5;
}

export function hitTestEphemerisBody(
  px: number,
  py: number,
  camera: EphemerisCamera,
  geo: EphemerisGeometry,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
): EphemerisBodyHit | null {
  if (geo.plotWidth <= 0) return null;
  const mode = scene.mode;
  const modulus = sceneModulus(scene);
  const at = (planet: number, jd: number, fallback: number): EphemerisBodyHit => {
    const day = ephemerisDayJd(jd);
    return { planet, jd: day, value: ephemerisValueAt(data.blocks, planet, mode, day) ?? fallback };
  };

  // Planet labels: the glyph box in the gutter, the labelled edge's moment.
  const labelJd = ephemerisLabelJd(geo, camera);
  const start = ephemerisStartLabels(geo, style, data, scene, labelJd);
  const half = geo.planetFontPx / 2;
  const inGutter = geo.mirrored ? px > geo.plotRight && px <= geo.tableInner : px >= start.x - half && px < geo.xOrig;
  if (inGutter) {
    let best: (typeof start.labels)[number] | null = null;
    for (const label of start.labels) {
      if (Math.abs(py - label.y) <= half && (!best || Math.abs(py - label.y) < Math.abs(py - best.y))) best = label;
    }
    if (best) {
      const value = ephemerisValueAt(data.blocks, best.planetId, mode, labelJd);
      return value == null ? null : at(best.planetId, labelJd, value);
    }
  }

  // Curves: the visible planet whose line is nearest the pointer at this date.
  const tolerance = style.interaction.stationSnapY;
  if (px < geo.xOrig || px > geo.plotRight || py < geo.yTop - tolerance || py > geo.yBottom + tolerance) return null;
  const jd = camera.startJd + ((px - geo.xOrig) * camera.spanDays) / geo.plotWidth;
  let nearest: { planet: number; value: number; distance: number } | null = null;
  for (const planet of scene.planets) {
    if (!scene.visible[planet.id]) continue;
    const value = ephemerisValueAt(data.blocks, planet.id, mode, jd);
    if (value == null) continue;
    const y = mapEphemerisY(geo, mode, value, modulus);
    // A folded curve continues across the top/bottom edge.
    const distance =
      mode === "longitude"
        ? Math.min(Math.abs(py - y), Math.abs(py - y + geo.plotHeight), Math.abs(py - y - geo.plotHeight))
        : Math.abs(py - y);
    if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
      nearest = { planet: planet.id, value, distance };
    }
  }
  return nearest ? at(nearest.planet, jd, nearest.value) : null;
}
