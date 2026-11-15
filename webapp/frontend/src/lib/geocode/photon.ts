/**
 * Address search through Photon (https://photon.komoot.io/), the open-source
 * OpenStreetMap geocoder built for search-as-you-type. Nominatim's usage
 * policy forbids autocomplete, so type-ahead fields use Photon. The astrocart
 * map (Res/astrocart/map.html) carries the same parsing in its static page.
 *
 * Rows are display data plus an exact point; the daemon turns a picked point
 * into a form-shaped place (timezone, altitude) via `placeAt`.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";
// Photon localizes result names only for these languages; others get the
// local (OSM default) names.
const PHOTON_LANGS = new Set(["en", "de", "fr", "it"]);

export type PhotonPlace = {
  lon: number;
  lat: number;
  /** Primary line: the feature name, or "number street" for an address. */
  name: string;
  /** Context line: street, district, city, state (deduplicated). */
  secondary: string;
  /** Name to persist for a chart or default location: name plus its city. */
  label: string;
  countryCode: string;
};

export type PhotonBias = { lat: number; lon: number; zoom: number };

type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function text(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function rowFromFeature(feature: PhotonFeature): (PhotonPlace & { housenumber: string }) | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords)) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const p = feature.properties ?? {};
  const streetLine = [text(p.housenumber), text(p.street)].filter(Boolean).join(" ");
  const name = text(p.name) || streetLine;
  if (!name) return null;
  const parts: string[] = [];
  const seen = new Set([name.toLowerCase()]);
  const push = (v: unknown) => {
    const s = text(v);
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    parts.push(s);
  };
  if (text(p.name)) push(streetLine);
  push(p.locality);
  push(p.district);
  push(p.city);
  if (!text(p.city)) push(p.county);
  push(p.state);
  const town = text(p.city) || text(p.locality) || text(p.county) || text(p.state);
  const label = town && town.toLowerCase() !== name.toLowerCase() ? `${name}, ${town}` : name;
  return {
    lon,
    lat,
    name,
    secondary: parts.join(", ") || text(p.country),
    label,
    countryCode: text(p.countrycode).toUpperCase(),
    housenumber: text(p.housenumber).toLowerCase(),
  };
}

/** Search Photon. Returns at most `limit` deduplicated rows; a typed leading
 * house number that a result matches ranks that exact address first. */
export async function searchPhoton(
  query: string,
  options: { bias?: PhotonBias | null; locale?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PhotonPlace[]> {
  const q = query.trim();
  const limit = options.limit ?? 6;
  // Photon often returns several OSM ways of one street; over-fetch and
  // collapse identical labels.
  const params = new URLSearchParams({ q, limit: String(limit * 2) });
  const bias = options.bias;
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
    params.set("lat", Math.max(-85, Math.min(85, bias.lat)).toFixed(4));
    params.set("lon", (((bias.lon + 540) % 360) - 180).toFixed(4));
    params.set("zoom", String(Math.max(1, Math.min(18, Math.round(bias.zoom)))));
  }
  const lang = (options.locale ?? "").toLowerCase().split("-")[0];
  if (PHOTON_LANGS.has(lang)) params.set("lang", lang);
  const response = await fetch(`${PHOTON_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`photon ${response.status}`);
  const body = (await response.json()) as { features?: PhotonFeature[] };
  const rows: (PhotonPlace & { housenumber: string })[] = [];
  const labels = new Set<string>();
  for (const feature of body.features ?? []) {
    const row = rowFromFeature(feature);
    if (!row) continue;
    const key = `${row.name}|${row.secondary}|${row.countryCode}`.toLowerCase();
    if (labels.has(key)) continue;
    labels.add(key);
    rows.push(row);
  }
  const typedNumber = q.match(/^\s*(\d+[a-z]?)\b/i)?.[1]?.toLowerCase();
  if (typedNumber) {
    rows.sort((a, b) => Number(b.housenumber === typedNumber) - Number(a.housenumber === typedNumber));
  }
  return rows.slice(0, limit).map((row) => ({
    lon: row.lon,
    lat: row.lat,
    name: row.name,
    secondary: row.secondary,
    label: row.label,
    countryCode: row.countryCode,
  }));
}
