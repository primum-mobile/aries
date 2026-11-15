// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EditorFields, EditorTimezone } from "../daemon/client";

/** Only civil-clock/location inputs trigger automatic zone resolution. */
export function editorTimezoneRequest(fields: EditorFields): string | null {
  if (!fields.tzauto || fields.zt !== "zone" || fields.bc) return null;
  const { lon, lat, year, month, day, hour, minute, second, cal, daylightSaving } = fields;
  return JSON.stringify({
    lon, lat, year, month, day, hour, minute, second, cal, daylightSaving,
    tzauto: true, zt: "zone",
  });
}

export function editorFieldsWithTimezone(fields: EditorFields, zone: EditorTimezone | null): EditorFields {
  return zone && editorTimezoneRequest(fields) ? { ...fields, ...zone } : fields;
}

export function editorPlaceRequest(fields: EditorFields): string | null {
  const { lon, lat } = fields;
  if (!fields.inferPlace || typeof lon !== "number" || typeof lat !== "number" ||
      !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return JSON.stringify({ lon, lat });
}

export function editorFieldsWithPlace(fields: EditorFields, name: string | null): EditorFields {
  return fields.inferPlace && name ? { ...fields, place: name, inferPlace: false } : fields;
}

/** A coordinate edit invalidates the selected place, including its cached ID. */
export function invalidateEditorLocation<T extends { lonDec: string; latDec: string; place: string; tzid: string; inferPlace?: boolean }>(
  fields: T, key: string,
): T {
  if (key === "place") return { ...fields, inferPlace: false };
  const longitude = ["lonDeg", "lonMin", "lonSec", "east"].includes(key);
  const latitude = ["latDeg", "latMin", "latSec", "north"].includes(key);
  if (!longitude && !latitude) return fields;
  return { ...fields, place: "", tzid: "", inferPlace: true, ...(longitude ? { lonDec: "" } : { latDec: "" }) };
}
