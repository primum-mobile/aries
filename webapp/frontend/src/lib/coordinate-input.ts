// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Free-text geographic coordinates for the Default location manual entry. */
export type CoordinateAxis = "lat" | "lon";

const HEMISPHERES: Record<CoordinateAxis, { positive: string; negative: string; limit: number }> = {
  lat: { positive: "N", negative: "S", limit: 90 },
  lon: { positive: "E", negative: "W", limit: 180 },
};

/** Parses `52.524`, `-13.41`, `52n31`, `52°31′N`, `52 31 24 N` and similar.
 * Returns signed decimal degrees, or null when the text is not a coordinate
 * on that axis. */
export function parseCoordinate(text: string, axis: CoordinateAxis): number | null {
  const { positive, negative, limit } = HEMISPHERES[axis];
  const raw = text.trim().toUpperCase().replace(/,/g, ".").replace(/−/g, "-");
  if (!raw) return null;
  const letters = raw.replace(/[^A-Z]/g, "");
  if (letters && letters !== positive && letters !== negative) return null;
  const parts = raw.match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length > 3) return null;
  const [d, m = 0, s = 0] = parts.map(Number);
  if (parts.length > 1 && (!Number.isInteger(d) || m >= 60 || s >= 60)) return null;
  const magnitude = d + m / 60 + s / 3600;
  const minus = raw.startsWith("-");
  if (minus && letters) return null;
  const value = (letters === negative || minus ? -1 : 1) * magnitude;
  return Math.abs(value) <= limit ? value : null;
}

/** `52°31′N`; seconds appear only when they are not zero. */
export function formatCoordinate(value: number, axis: CoordinateAxis): string {
  const { positive, negative } = HEMISPHERES[axis];
  let total = Math.round(Math.abs(value) * 3600);
  const sec = total % 60;
  total = (total - sec) / 60;
  const min = total % 60;
  const deg = (total - min) / 60;
  const seconds = sec ? `${String(sec).padStart(2, "0")}″` : "";
  return `${deg}°${String(min).padStart(2, "0")}′${seconds}${value < 0 ? negative : positive}`;
}
