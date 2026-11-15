// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris hover -> Inspector region. A snapped plate target that
// names a body (a station marker, or a lunation disc for the Moon) is that body
// at the hovered moment: the daemon builds the transit chart at `atJd` over the
// view's radix (workspace_service.inspector_charts_at_jd) and the region asks
// for its outer ring, exactly like a transit-biwheel outer body. A curve or a
// curve-head label (ephemeris-body-hit) names a body at its day; the free
// date/degree readout names none and yields no region.

import type { EphemerisHit } from "./ephemeris-hit-test";
import type { EphemerisRadixPoint } from "./ephemeris-radix";
import type { PlanetId } from "./types";
import type { HoverRegion } from "../../stores/workspace-store";

// SE id -> chart planet id (export_chart_json PLANET_ID_BY_SE for the
// ephemeris PLANET_ORDER). The inspector keys on seId; planetId is the
// region's display identity only.
const PLANET_ID_BY_SE: Readonly<Record<number, PlanetId>> = {
  0: "sun",
  1: "moon",
  2: "mercury",
  3: "venus",
  4: "mars",
  5: "jupiter",
  6: "saturn",
  7: "uranus",
  8: "neptune",
  9: "pluto",
  12: "apogee",
  13: "apogee",
  15: "chiron",
};

export function ephemerisInspectorRegion(
  hit: Pick<EphemerisHit, "jd" | "planet" | "value"> | null,
  viewDocumentId: string,
  mode: "longitude" | "declination",
): HoverRegion | null {
  if (!hit || hit.planet == null || !Number.isFinite(hit.jd)) return null;
  const planetId = PLANET_ID_BY_SE[hit.planet];
  if (!planetId) return null;
  return {
    kind: "planet",
    planetId,
    seId: hit.planet,
    longitude: mode === "longitude" && hit.value != null ? hit.value : 0,
    latitude: 0,
    speed: 0,
    chartRole: "outer",
    atJd: hit.jd,
    viewDocumentId,
  };
}

const PLANET_IDS: ReadonlySet<string> = new Set(Object.values(PLANET_ID_BY_SE));
const ANGLE_IDS: ReadonlySet<string> = new Set(["asc", "mc", "dsc", "ic"]);

/** A natal (radix) line -> the natal point it marks, the region the radix
 * wheel's own glyph opens: that point in the live radix document. Midpoints
 * have no Inspector region. */
export function ephemerisRadixInspectorRegion(
  point: Pick<EphemerisRadixPoint, "key" | "kind" | "lon" | "seId"> | null | undefined,
  radixDocumentId: string | null,
): HoverRegion | null {
  if (!point || !radixDocumentId) return null;
  const viewDocumentId = radixDocumentId;
  const longitude = point.lon;
  switch (point.kind) {
    case "planet":
      return point.seId != null && PLANET_IDS.has(point.key)
        ? { kind: "planet", planetId: point.key as PlanetId, seId: point.seId, longitude, latitude: 0, speed: 0, viewDocumentId }
        : null;
    case "angle":
      return ANGLE_IDS.has(point.key)
        ? { kind: "angle", angleId: point.key as "asc" | "mc" | "dsc" | "ic", longitude, viewDocumentId }
        : null;
    case "fortune":
    case "vertex":
    case "syzygy":
    case "eclipse":
      return { kind: point.kind, longitude, viewDocumentId };
    default:
      return null;
  }
}

/** What a plate click names: the curve (or ring/contact) body, else the
 * natal line under the pointer. */
export type EphemerisClickTarget = { planet: number | null; radixKey: string | null };
export type EphemerisPin = { planet: number | null; radixKey: string | null };

/** The pin after a pointer release on the plate, the wheel's click rule: a
 * click on a target pins it (curve before natal line), the pinned target or
 * empty plate releases it. A drag (pan) is no click and changes nothing. */
export function nextEphemerisPin(
  current: EphemerisPin,
  target: EphemerisClickTarget,
  dragged: boolean,
): EphemerisPin | null {
  if (dragged) return null;
  if (target.planet != null) {
    return target.planet === current.planet ? { planet: null, radixKey: null } : { planet: target.planet, radixKey: null };
  }
  if (target.radixKey != null) {
    return target.radixKey === current.radixKey ? { planet: null, radixKey: null } : { planet: null, radixKey: target.radixKey };
  }
  return { planet: null, radixKey: null };
}
