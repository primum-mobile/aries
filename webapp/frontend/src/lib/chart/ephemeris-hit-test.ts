// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris hover hit test, read straight from the block store's
// resident data: snap to the nearest visible station (or lunation disc while
// discs are shown) inside the style's snap box, else a free day/value readout
// (graphephemwnd._hover_state_for_point + _hover_info_from_point).

import { calendarOfJd, type EphemerisCamera } from "./ephemeris-camera";
import type { EphemerisFrameData } from "./ephemeris-block-store";
import {
  lunationVisibility,
  mapEphemerisY,
  MOON_ID,
  norm360,
  signOf,
  valueAtEphemerisY,
  type EphemerisGeometry,
} from "./ephemeris-geometry";
import { ephemerisValueAt, sceneModulus } from "./ephemeris-plot-paint";
import {
  radixAspectGlyph,
  radixAspectIndex,
  radixCrossingLongitude,
  radixPointParts,
  type EphemerisRadixLabelPart,
  type EphemerisRadixLayer,
} from "./ephemeris-radix";
import type { EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisScene } from "./ephemeris-scene";

export type EphemerisHoverInfo = {
  date: string;
  /** Morinus sign glyph char (longitude mode). */
  sign: string;
  signName: string;
  degree: number;
  minute: number;
  declination: boolean;
  declSign?: string;
  planetGlyph?: string;
  /** The snapped body and the sign its longitude is in (its glyph colour). */
  planetId?: number;
  planetSign?: number;
  /** Sign index of the `sign` glyph. */
  signIndex?: number;
  stationCode?: string;
  /** Localized event name (New Moon / Full Moon / eclipse) for a snapped lunation. */
  eventLabel?: string;
  /** A snapped radix crossing: aspect glyph and the natal point's glyph(s);
   * a planet contact names the other body and its sign instead. */
  contact?: {
    aspectGlyph: string;
    /** Aspect type index (glyphs.ts ASP_*). */
    aspectIndex?: number;
    point: readonly EphemerisRadixLabelPart[];
    planetId?: number;
    planetSign?: number;
  };
  jd?: number;
};

export type EphemerisHit = {
  x: number;
  y: number;
  jd: number;
  info: EphemerisHoverInfo;
  /** SE id of the snapped body (station or lunation disc); absent on the free readout. */
  planet?: number;
  /** Snapped body's plotted value: longitude, or declination in declination mode. */
  value?: number;
};

/** Degree/minute split with carry (graphephemwnd.py:568-624). */
export function degMin(value: number): { deg: number; min: number } {
  let deg = Math.trunc(Math.abs(value));
  let min = Math.trunc((Math.abs(value) - deg) * 60);
  if (min === 60) {
    min = 0;
    deg += 1;
  }
  return { deg, min };
}

type Target = {
  x: number;
  y: number;
  jd: number;
  value: number;
  date: string;
  code: string;
  planet: number;
  label?: string;
  contact?: EphemerisHoverInfo["contact"];
};

function dayLabel(jd: number, monthLabels: readonly string[]): string {
  const { month, day } = calendarOfJd(jd);
  const monthTxt = monthLabels[month - 1] ?? "";
  return `${monthTxt.charAt(0).toUpperCase()}${monthTxt.slice(1)} ${day}`;
}

export function hitTestEphemeris(
  px: number,
  py: number,
  camera: EphemerisCamera,
  geo: EphemerisGeometry,
  data: EphemerisFrameData,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  radix: EphemerisRadixLayer | null = null,
): EphemerisHit | null {
  if (geo.plotWidth <= 0) return null;
  const mode = scene.mode;
  const modulus = sceneModulus(scene);
  const pxPerDay = geo.plotWidth / camera.spanDays;
  const xOf = (jd: number) => geo.xOrig + (jd - camera.startJd) * pxPerDay;
  const snapX = style.interaction.stationSnapX;
  const snapY = style.interaction.stationSnapY;
  const glyphOf = (id: number) => scene.planets.find((p) => p.id === id)?.glyph ?? "";
  let best: Target | null = null;
  let bestScore = Infinity;
  const consider = (target: Target) => {
    if (target.x < geo.xOrig || target.x > geo.plotRight) return;
    const dx = Math.abs(px - target.x);
    const dy = Math.abs(py - target.y);
    if (dx > snapX || dy > snapY) return;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      best = target;
      bestScore = score;
    }
  };
  const jdNear = (x: number) => camera.startJd + (x - geo.xOrig) / pxPerDay;
  const fromJd = jdNear(px - snapX - 1);
  const toJd = jdNear(px + snapX + 1);
  const near = (jd: number) => jd >= fromJd && jd <= toJd;
  const stations =
    mode === "declination"
      ? data.blocks.flatMap((block) => block.declinationStations)
      : data.stationYears.flatMap((layer) => layer.longitude);
  for (const st of stations) {
    if (!scene.visible[st.planet] || !near(st.jd)) continue;
    consider({
      x: xOf(st.jd),
      y: mapEphemerisY(geo, mode, st.value, modulus),
      jd: st.jd,
      value: st.value,
      date: st.date,
      code: st.code,
      planet: st.planet,
    });
  }
  if (scene.showLunations && lunationVisibility(geo, style, pxPerDay)) {
    for (const block of data.blocks) {
      for (const lunation of block.lunations) {
        if (!near(lunation.jd)) continue;
        const value = mode === "declination" ? lunation.declination : lunation.longitude;
        consider({
          x: xOf(lunation.jd),
          y: mapEphemerisY(geo, mode, value, modulus),
          jd: lunation.jd,
          value,
          date: lunation.date,
          code: "",
          planet: MOON_ID,
          label: lunation.eclipseLabel || (lunation.kind === "new" ? scene.lunationLabels.new : scene.lunationLabels.full),
        });
      }
    }
  }
  if (radix && mode === "longitude") {
    const byKey = new Map(radix.points.map((p) => [p.key, p]));
    for (const crossing of radix.crossings) {
      if (!near(crossing.jd)) continue;
      const point = byKey.get(crossing.pointKey);
      if (!point) continue;
      consider({
        x: xOf(crossing.jd),
        y: mapEphemerisY(geo, mode, point.lon, modulus),
        jd: crossing.jd,
        value: radixCrossingLongitude(point, crossing.aspect),
        date: dayLabel(crossing.jd, scene.monthLabels),
        code: "",
        planet: crossing.planet,
        contact: {
          aspectGlyph: radixAspectGlyph(crossing.aspect),
          aspectIndex: radixAspectIndex(crossing.aspect),
          point: radixPointParts(point),
        },
      });
    }
  }
  if (radix && mode === "longitude") {
    for (const contact of radix.contacts) {
      if (!near(contact.jd)) continue;
      consider({
        x: xOf(contact.jd),
        y: mapEphemerisY(geo, mode, contact.lon, modulus),
        jd: contact.jd,
        value: contact.lon,
        date: dayLabel(contact.jd, scene.monthLabels),
        code: "",
        planet: contact.a,
        contact: {
          aspectGlyph: radixAspectGlyph(contact.aspect),
          aspectIndex: radixAspectIndex(contact.aspect),
          point: [{ text: glyphOf(contact.b), font: "morinus" }],
          planetId: contact.b,
          planetSign: signOf(contact.lon - contact.aspect),
        },
      });
    }
  }
  const snapped = best as Target | null;
  if (snapped) {
    const planetLon = mode === "declination"
      ? ephemerisValueAt(data.blocks, snapped.planet, "longitude", snapped.jd)
      : snapped.value;
    const common = {
      date: snapped.date,
      planetGlyph: glyphOf(snapped.planet),
      planetId: snapped.planet,
      planetSign: planetLon == null || !Number.isFinite(planetLon) ? undefined : signOf(planetLon),
      stationCode: snapped.code || undefined,
      eventLabel: snapped.label,
      contact: snapped.contact,
      jd: snapped.jd,
    };
    if (mode === "declination") {
      const { deg, min } = degMin(snapped.value);
      return {
        x: snapped.x,
        y: snapped.y,
        jd: snapped.jd,
        planet: snapped.planet,
        value: snapped.value,
        info: { ...common, sign: "", signName: "", degree: deg, minute: min, declination: true, declSign: snapped.value >= 0 ? "+" : "-" },
      };
    }
    const lon = norm360(snapped.value);
    const signIdx = Math.min(11, Math.trunc(lon / 30));
    const { deg, min } = degMin(lon - signIdx * 30);
    return {
      x: snapped.x,
      y: snapped.y,
      jd: snapped.jd,
      planet: snapped.planet,
      value: lon,
      info: {
        ...common,
        sign: scene.signGlyphs[signIdx] ?? "",
        signName: scene.signNames[signIdx] ?? "",
        signIndex: signIdx,
        degree: deg,
        minute: min,
        declination: false,
      },
    };
  }

  // Free-cursor readout inside the plot rect.
  if (px < geo.xOrig || px > geo.plotRight || py < geo.yTop || py > geo.yBottom) return null;
  const jd = jdNear(px);
  const date = dayLabel(jd, scene.monthLabels);
  const raw = valueAtEphemerisY(geo, mode, py, modulus);
  if (mode === "declination") {
    const { deg, min } = degMin(raw);
    return {
      x: px,
      y: py,
      jd,
      info: { date, sign: "", signName: "", degree: deg, minute: min, declination: true, declSign: raw >= 0 ? "+" : "-" },
    };
  }
  if (modulus !== 360) {
    // A harmonic plate folds 360/M longitudes onto each row: the free cursor
    // reads the degree within the modulus, without a sign.
    const { deg, min } = degMin(Math.min(Math.max(raw, 0), modulus));
    return {
      x: px,
      y: py,
      jd,
      info: { date, sign: "", signName: "", degree: deg, minute: min, declination: false },
    };
  }
  const value = norm360(raw);
  let signIdx = Math.min(11, Math.trunc(value / 30));
  const { deg: rawDeg, min: minute } = degMin(value - signIdx * 30);
  let deg = rawDeg;
  if (deg === 30) {
    deg = 0;
    signIdx = (signIdx + 1) % 12;
  }
  return {
    x: px,
    y: py,
    jd,
    info: {
      date,
      sign: scene.signGlyphs[signIdx] ?? "",
      signName: scene.signNames[signIdx] ?? "",
      signIndex: signIdx,
      degree: deg,
      minute,
      declination: false,
    },
  };
}
