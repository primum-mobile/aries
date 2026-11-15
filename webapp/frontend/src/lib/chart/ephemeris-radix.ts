// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris radix layer (Tab): the radix's points as horizontal lines
// at their folded longitude, labelled in a column beyond the degree ruler,
// and a ring wherever a transit curve crosses one (a hard aspect on the
// plate's modulus). Planet contacts: the aspect glyph wherever two transit
// curves cross, with or without the radix. The daemon owns every point and
// crossing (ephemeris_service.natal_points / natal_crossings /
// planet_contacts); this module decodes, filters by the scene's toggles and
// paints.

import type { EphemerisBlockStore } from "./ephemeris-block-store";
import { calendarOfJd, cameraEndJd, type EphemerisCamera } from "./ephemeris-camera";
import { mapEphemerisY, norm360, PlateRules, PlateText, type EphemerisGeometry } from "./ephemeris-geometry";
import { ephemerisInkTable, ephemerisPlanetInk, legibleInk } from "./ephemeris-ink";
import { ephemerisRecedeFactor, type EphemerisRadixRecede } from "./ephemeris-recede-fade";
import { EPHEMERIS_BODY_COLOR_VARS, EPHEMERIS_DIGNITY_COLOR_VARS, type EphemerisRenderStyle } from "./ephemeris-render-style";
import type { EphemerisDignity, EphemerisScene, EphemerisSurface } from "./ephemeris-scene";
import { decodeFloat64Base64 } from "./ephemeris-wire";
import { aspectGlyph, ASP_CONJUNCTION, ASP_OPPOSITION, ASP_QUINCUNX, ASP_SEMISEXTILE, ASP_SEMISQUARE, ASP_SESQUIQUADRATE, ASP_SEXTILE, ASP_SQUARE, ASP_TRINE } from "./glyphs";
import type {
  EphemerisContactsWire,
  EphemerisNatalCrossingsWire,
  EphemerisNatalPoint,
  EphemerisNatalWire,
} from "@/lib/daemon/client";

export type EphemerisRadixPoint = Readonly<{
  key: string;
  kind: string;
  lon: number;
  /** One mark, or two for a midpoint: a Morinus glyph for bodies and points,
   * the written name for the angles (Asc, Dsc, MC, IC), as in lists. */
  glyphs: readonly string[];
  glyphFonts: readonly ("morinus" | "text")[];
  /** Per glyph: the list's colour and its semantic role (hover flag). */
  glyphColors: readonly string[];
  glyphColorRoles: readonly (string | null)[];
  label: string;
  defaultVisible: boolean;
  /** A body's SE id (its Inspector region); absent for points and midpoints. */
  seId?: number;
}>;

export type EphemerisRadixCrossing = Readonly<{ jd: number; planet: number; pointKey: string; aspect: number }>;

/** Two transit curves crossing: `lon` is planet `a`'s longitude there,
 * `aspect` the angle a minus b. */
export type EphemerisPlanetContact = Readonly<{ jd: number; lon: number; a: number; b: number; aspect: number }>;

/** What the frame paints: the visible lines, the crossings and the planet
 * contacts near the camera. */
export type EphemerisRadixLayer = Readonly<{
  points: readonly EphemerisRadixPoint[];
  crossings: readonly EphemerisRadixCrossing[];
  contacts: readonly EphemerisPlanetContact[];
}>;

/** Inner planets whose crossings sit behind the "fast contacts" toggle. */
export const EPHEMERIS_FAST_PLANET_IDS: ReadonlySet<number> = new Set([0, 2, 3]);

/** The settled recede for a scene: full while a natal line is pinned, none
 * otherwise (exports and any paint without a live fade). */
export function settledRadixRecede(scene: Pick<EphemerisScene, "radixFocusKey" | "radixFocusPinned">): EphemerisRadixRecede {
  const pinned = scene.radixFocusKey != null && Boolean(scene.radixFocusPinned);
  return { amount: pinned ? 1 : 0, key: pinned ? scene.radixFocusKey ?? null : null };
}

export function decodeEphemerisRadixPoints(wire: EphemerisNatalWire): { radixKey: string; points: EphemerisRadixPoint[]; orb: number } {
  const points = (Array.isArray(wire?.points) ? wire.points : [])
    .filter((p: EphemerisNatalPoint) => typeof p?.key === "string" && Number.isFinite(p.lon))
    .map((p) => Object.freeze({
      key: p.key,
      kind: String(p.kind ?? ""),
      lon: norm360(p.lon),
      glyphs: Object.freeze((Array.isArray(p.glyphs) ? p.glyphs : []).map(String)),
      glyphFonts: Object.freeze(
        (Array.isArray(p.glyphs) ? p.glyphs : []).map((_, i) =>
          p.glyphFonts?.[i] === "morinus" ? ("morinus" as const) : ("text" as const),
        ),
      ),
      glyphColors: Object.freeze(
        (Array.isArray(p.glyphs) ? p.glyphs : []).map((_, i) => String(p.glyphColors?.[i] ?? "")),
      ),
      glyphColorRoles: Object.freeze(
        (Array.isArray(p.glyphs) ? p.glyphs : []).map((_, i) => {
          const role = p.glyphColorRoles?.[i];
          return typeof role === "string" && role ? role : null;
        }),
      ),
      label: String(p.label ?? p.key),
      defaultVisible: Boolean(p.defaultVisible),
      ...(Number.isInteger(p.seId) ? { seId: Number(p.seId) } : {}),
    }));
  const orb = Number(wire?.orb);
  return { radixKey: String(wire?.radixKey ?? ""), points, orb: Number.isFinite(orb) && orb > 0 ? orb : 0 };
}

export function decodeEphemerisRadixYear(wire: EphemerisNatalCrossingsWire): EphemerisRadixCrossing[] {
  const jds = decodeFloat64Base64(wire?.jd);
  const keys = Array.isArray(wire?.points) ? wire.points : [];
  const out: EphemerisRadixCrossing[] = [];
  for (let i = 0; i < jds.length; i++) {
    const pointKey = keys[wire.point?.[i] ?? -1];
    const planet = Number(wire.planet?.[i]);
    const aspect = Number(wire.aspect?.[i]);
    if (typeof pointKey !== "string" || !Number.isFinite(planet) || !Number.isFinite(aspect)) continue;
    out.push({ jd: jds[i], planet, pointKey, aspect });
  }
  return out;
}

export function decodeEphemerisContactsYear(wire: EphemerisContactsWire): EphemerisPlanetContact[] {
  const jds = decodeFloat64Base64(wire?.jd);
  const lons = decodeFloat64Base64(wire?.lon);
  const out: EphemerisPlanetContact[] = [];
  for (let i = 0; i < jds.length && i < lons.length; i++) {
    const a = Number(wire.a?.[i]);
    const b = Number(wire.b?.[i]);
    const aspect = Number(wire.aspect?.[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(aspect)) continue;
    out.push({ jd: jds[i], lon: norm360(lons[i]), a, b, aspect });
  }
  return out;
}

/** Calendar years the camera touches. */
export function radixYearsOf(camera: EphemerisCamera): number[] {
  const first = calendarOfJd(camera.startJd).year;
  const last = calendarOfJd(cameraEndJd(camera)).year;
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
}

type Fetcher<W> = (year: number, signal: AbortSignal) => Promise<W>;

/** Per-year rows (radix crossings, planet contacts) as a year layer of the
 * plate's one loader (`EphemerisBlockStore`): the loader schedules them with
 * the curves (visible years after the visible months, then the pan
 * direction), within the same in-flight bound and byte budget, pins what a
 * view needs and backs off after a failure, waking the plate itself. This
 * handle owns the layer's key and decoding; the view declares the layer in
 * its interest and reads `rows`. */
export class EphemerisYearStore<W, R> {
  constructor(
    protected readonly loader: EphemerisBlockStore,
    readonly layerId: string,
    fetchYear: Fetcher<W>,
    decode: (wire: W) => R[],
  ) {
    loader.defineYearLayer(layerId, {
      fetchYear: (year, signal) => fetchYear(year, signal),
      decode: (wire) => (this.accept(wire as W) ? Object.freeze(decode(wire as W)) : null),
    });
  }

  /** A new radix point set or data key: the old years are no longer drawn. */
  setKey(key: string) {
    this.loader.setLayerKey(this.layerId, key);
  }

  /** Whether a fetched year belongs to the current key; a store that can
   * tell (the radix store, by the wire's radixKey) refuses a stale one. */
  protected accept(wire: W): boolean {
    return wire != null;
  }

  /** Ask for years outside any view's range (they go first). */
  want(years: readonly number[]) {
    this.loader.askLayerYears(this.layerId, years);
  }

  /** Wants `years` and settles once each has loaded or failed (an export
   * paints the rows a settled frame would show). */
  ready(years: readonly number[]): Promise<void> {
    return this.loader.whenLayerSettled(this.layerId, years);
  }

  /** Resident rows over `years`; the same array while nothing changed. */
  rows(years: readonly number[]): readonly R[] {
    return this.loader.layerRows(this.layerId, years) as readonly R[];
  }

  subscribe(listener: () => void): () => void {
    return this.loader.subscribe(listener);
  }
}

/** Crossings with one radix's lines, keyed by the radix's point set
 * (radixKey) and the block data key. A year computed for another point set
 * (the radix was recalculated or the daemon reloaded under the same
 * document id) is refused and reported, so the view refetches the lines. */
export class EphemerisRadixStore extends EphemerisYearStore<EphemerisNatalCrossingsWire, EphemerisRadixCrossing> {
  private radixKey = "";
  private readonly staleListeners = new Set<(radixKey: string) => void>();

  constructor(loader: EphemerisBlockStore, layerId: string, fetchYear: Fetcher<EphemerisNatalCrossingsWire>) {
    super(loader, layerId, fetchYear, decodeEphemerisRadixYear);
  }

  /** The lines on screen (their radixKey) and the block data key. */
  setRadix(radixKey: string, dataKey: string) {
    this.radixKey = radixKey;
    this.setKey(radixKey && dataKey ? `${radixKey}|${dataKey}` : "");
  }

  protected override accept(wire: EphemerisNatalCrossingsWire): boolean {
    const served = typeof wire?.radixKey === "string" ? wire.radixKey : "";
    if (!served || !this.radixKey || served === this.radixKey) return true;
    for (const listener of this.staleListeners) listener(served);
    return false;
  }

  /** Called with the daemon's radixKey when it no longer matches the lines. */
  onStaleRadix(listener: (radixKey: string) => void): () => void {
    this.staleListeners.add(listener);
    return () => this.staleListeners.delete(listener);
  }
}

/** Planet-to-planet contacts: chart independent, keyed by the data key. */
export class EphemerisContactStore extends EphemerisYearStore<EphemerisContactsWire, EphemerisPlanetContact> {
  constructor(loader: EphemerisBlockStore, layerId: string, fetchYear: Fetcher<EphemerisContactsWire>) {
    super(loader, layerId, fetchYear, decodeEphemerisContactsYear);
  }
}

/** The lines and crossings this frame shows: visible points, visible curves,
 * the fast planets only when asked, and aspects on the plate's modulus. */
export function ephemerisRadixLayer(
  points: readonly EphemerisRadixPoint[],
  pointVisible: (point: EphemerisRadixPoint) => boolean,
  rows: readonly EphemerisRadixCrossing[],
  scene: Pick<EphemerisScene, "visible" | "modulus">,
  showFastContacts: boolean,
  contactRows: readonly EphemerisPlanetContact[] = [],
): EphemerisRadixLayer {
  const shown = points.filter(pointVisible);
  const keys = new Set(shown.map((p) => p.key));
  const modulus = scene.modulus || 360;
  const crossings = rows.filter(
    (row) =>
      keys.has(row.pointKey) &&
      scene.visible[row.planet] &&
      (showFastContacts || !EPHEMERIS_FAST_PLANET_IDS.has(row.planet)) &&
      row.aspect % modulus === 0,
  );
  const fast = (id: number) => !showFastContacts && EPHEMERIS_FAST_PLANET_IDS.has(id);
  const contacts = contactRows.filter(
    (row) => scene.visible[row.a] && scene.visible[row.b] && !fast(row.a) && !fast(row.b) && row.aspect % modulus === 0,
  );
  return { points: shown, crossings, contacts };
}

/** Radius of a plate mark's round paper knock-out for a glyph of `size` px:
 * the planet contacts' disc, shared by the reading line's glyphs. */
export function ephemerisKnockoutRadius(size: number, style: EphemerisRenderStyle): number {
  return size * style.radix.planetContactKnockoutScale;
}

/** A round paper knock-out centred on (cx, cy): a disc of
 * `ephemerisKnockoutRadius`, drawn out to a capsule with the same round ends
 * when the mark (`markWidth` px) is wider than the disc. Returns its half
 * width. */
export function paintEphemerisKnockout(
  ctx: CanvasRenderingContext2D,
  style: EphemerisRenderStyle,
  cx: number,
  cy: number,
  size: number,
  markWidth = 0,
): number {
  const r = ephemerisKnockoutRadius(size, style);
  const reach = Math.max(0, markWidth / 2 - r);
  ctx.beginPath();
  if (reach > 0) {
    ctx.arc(cx - reach, cy, r, Math.PI / 2, Math.PI * 1.5);
    ctx.arc(cx + reach, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = style.colors.paper;
  ctx.fill();
  return r + reach;
}

/** A glyph's ink box around its anchor (textAlign "left", textBaseline
 * "alphabetic"), as TextMetrics' actualBoundingBox* give it. */
export type EphemerisGlyphInk = Readonly<{ left: number; right: number; ascent: number; descent: number }>;

/** Where to anchor a row of runs (each at its advance offset, align left,
 * baseline alphabetic) so the union of their ink boxes is centred on
 * (cx, cy). Morinus glyphs do not sit centred on the em box, so "center" /
 * "middle" alignment leaves them visibly off their disc. */
export function ephemerisCentredInkAnchor(
  cx: number,
  cy: number,
  runs: readonly { advance: number; ink: EphemerisGlyphInk }[],
): { x: number; y: number; inkWidth: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let offset = 0;
  for (const run of runs) {
    x0 = Math.min(x0, offset - run.ink.left);
    x1 = Math.max(x1, offset + run.ink.right);
    y0 = Math.min(y0, -run.ink.ascent);
    y1 = Math.max(y1, run.ink.descent);
    offset += run.advance;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return { x: cx, y: cy, inkWidth: 0 };
  return { x: cx - (x0 + x1) / 2, y: cy - (y0 + y1) / 2, inkWidth: x1 - x0 };
}

/** Snap a CSS-px coordinate to the device pixel grid. */
export function snapToDevicePixel(value: number, dpr: number): number {
  const s = dpr > 0 ? dpr : 1;
  return Math.round(value * s) / s;
}

const glyphInkCache = new Map<string, { advance: number; ink: EphemerisGlyphInk }>();

function measureGlyphInk(ctx: CanvasRenderingContext2D, font: string, text: string) {
  const key = `${font}\n${text}`;
  let measured = glyphInkCache.get(key);
  if (!measured) {
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    measured = {
      advance: m.width,
      ink: {
        left: m.actualBoundingBoxLeft ?? 0,
        right: m.actualBoundingBoxRight ?? m.width,
        ascent: m.actualBoundingBoxAscent ?? 0,
        descent: m.actualBoundingBoxDescent ?? 0,
      },
    };
    if (glyphInkCache.size > 512) glyphInkCache.clear();
    glyphInkCache.set(key, measured);
  }
  return measured;
}

export type EphemerisKnockoutRun = Readonly<{ text: string; family: string; size: number; color: string }>;

/** A mark on its round paper knock-out: the centre snapped to the device
 * pixel grid once, the disc (capsule when the ink is wider) on it, and the
 * runs' measured ink box centred on the same point. */
export function paintEphemerisKnockoutMark(
  ctx: CanvasRenderingContext2D,
  style: EphemerisRenderStyle,
  dpr: number,
  x: number,
  y: number,
  size: number,
  runs: readonly EphemerisKnockoutRun[],
): void {
  const cx = snapToDevicePixel(x, dpr);
  const cy = snapToDevicePixel(y, dpr);
  const measured = runs.map((run) => ({ run, font: PlateText.fontSpec(run.size, run.family), ...measureGlyphInk(ctx, PlateText.fontSpec(run.size, run.family), run.text) }));
  const anchor = ephemerisCentredInkAnchor(cx, cy, measured);
  paintEphemerisKnockout(ctx, style, cx, cy, size, anchor.inkWidth);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let offset = anchor.x;
  for (const m of measured) {
    ctx.font = m.font;
    ctx.fillStyle = m.run.color;
    ctx.fillText(m.run.text, offset, anchor.y);
    offset += m.advance;
  }
}

/** Planet contacts: the aspect glyph in the plate ink on a paper knock-out
 * where two curves cross. */
export function paintEphemerisContacts(
  surface: EphemerisSurface,
  geo: EphemerisGeometry,
  camera: EphemerisCamera,
  layer: EphemerisRadixLayer,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
) {
  if (scene.mode !== "longitude" || geo.plotWidth <= 0 || layer.contacts.length === 0) return;
  const { ctx, dpr } = surface;
  const modulus = scene.modulus || 360;
  const size = geo.planetFontPx * style.radix.planetContactGlyphScale;
  const knockout = ephemerisKnockoutRadius(size, style);
  const pxPerDay = geo.plotWidth / camera.spanDays;
  ctx.save();
  for (const contact of layer.contacts) {
    const x = geo.xOrig + (contact.jd - camera.startJd) * pxPerDay;
    if (x < geo.xOrig - knockout || x > geo.plotRight + knockout) continue;
    const y = mapEphemerisY(geo, "longitude", contact.lon, modulus);
    paintEphemerisKnockoutMark(ctx, style, dpr, x, y, size, [
      { text: radixAspectGlyph(contact.aspect), family: style.typography.fontSymbols, size, color: style.colors.ink },
    ]);
  }
  ctx.restore();
}

const ASPECT_INDEX_BY_ANGLE: Readonly<Record<number, number>> = {
  0: ASP_CONJUNCTION,
  30: ASP_SEMISEXTILE,
  45: ASP_SEMISQUARE,
  60: ASP_SEXTILE,
  90: ASP_SQUARE,
  120: ASP_TRINE,
  135: ASP_SESQUIQUADRATE,
  150: ASP_QUINCUNX,
  180: ASP_OPPOSITION,
};

/** Aspect type index (glyphs.ts ASP_*) of a crossing angle (0..359, either side). */
export function radixAspectIndex(aspect: number): number | undefined {
  const angle = ((Math.round(aspect) % 360) + 360) % 360;
  return ASPECT_INDEX_BY_ANGLE[angle > 180 ? 360 - angle : angle];
}

/** Morinus aspect glyph of a crossing angle (0..359, either side). */
export function radixAspectGlyph(aspect: number): string {
  const index = radixAspectIndex(aspect);
  return index == null ? "" : aspectGlyph(index);
}

/** Transit longitude at the exact crossing: the line plus the aspect. */
export function radixCrossingLongitude(point: Pick<EphemerisRadixPoint, "lon">, aspect: number): number {
  return norm360(point.lon + aspect);
}

export type EphemerisRadixLabelPart = Readonly<{
  text: string;
  font: "morinus" | "text";
  /** The mark's list colour and semantic role; absent on the separator. */
  color?: string;
  colorRole?: string | null;
}>;

/** A point's mark as runs of one font each: "☉", "Asc", or "☉" "/" "Asc". */
export function radixPointParts(
  point: Pick<EphemerisRadixPoint, "glyphs" | "glyphFonts"> & Partial<Pick<EphemerisRadixPoint, "glyphColors" | "glyphColorRoles">>,
): EphemerisRadixLabelPart[] {
  const parts: EphemerisRadixLabelPart[] = [];
  point.glyphs.slice(0, 2).forEach((glyph, i) => {
    if (i > 0) parts.push({ text: "/", font: "text" });
    const color = point.glyphColors?.[i] || undefined;
    const colorRole = point.glyphColorRoles?.[i] || undefined;
    parts.push({
      text: glyph,
      font: point.glyphFonts[i] === "morinus" ? "morinus" : "text",
      ...(color ? { color } : {}),
      ...(colorRole ? { colorRole } : {}),
    });
  });
  return parts;
}

/** The one radix ink: every natal line, midpoint, leader and mark in the
 * plate's sign-glyph colour. The natal lines are a fixed reference frame,
 * like the grid; colour identity belongs to the moving transit curves. */
export function radixInk(style: EphemerisRenderStyle): string {
  return legibleInk(style.colors.signs, style);
}

/** Canvas colour of each mark of a natal point: the chart colour its list
 * shows (the active chart's body or dignity role), an angle (written mark)
 * in the chart's angle colour, read from the resolved style, else the
 * daemon's literal; ink when it would vanish against the paper. */
export function radixPointColors(
  point: Pick<EphemerisRadixPoint, "glyphs" | "glyphColors" | "glyphColorRoles"> & Partial<Pick<EphemerisRadixPoint, "glyphFonts">>,
  style: EphemerisRenderStyle,
): string[] {
  const colors = style.colors;
  return point.glyphs.slice(0, 2).map((_, i) => {
    const role = point.glyphColorRoles?.[i] ?? null;
    let color: string | undefined;
    if (role === "--morinus-text-bright") color = point.glyphFonts?.[i] === "text" ? colors.angles : colors.ink;
    else if (role) {
      const body = (EPHEMERIS_BODY_COLOR_VARS as readonly string[]).indexOf(role);
      if (body >= 0) color = colors.bodies[body] || undefined;
      else {
        const dignity = (Object.keys(EPHEMERIS_DIGNITY_COLOR_VARS) as EphemerisDignity[]).find(
          (key) => EPHEMERIS_DIGNITY_COLOR_VARS[key] === role,
        );
        if (dignity) color = colors.dignity[dignity];
      }
    }
    return legibleInk(color || point.glyphColors?.[i] || undefined, style);
  });
}

/** "Colour natal labels": the label column's marks in the active ink mode's
 * colour (tiers, planet or dignity colour of the natal body in its natal
 * sign), angles in the chart's angle colour, other points in their list
 * colour. A midpoint's marks take their parents'. Lines keep the radix ink. */
export function radixLabelColors(
  point: EphemerisRadixPoint,
  byKey: ReadonlyMap<string, EphemerisRadixPoint>,
  scene: Pick<EphemerisScene, "inkMode" | "usePlanetColors" | "dignityBySign">,
  style: EphemerisRenderStyle,
): string[] {
  const listed = radixPointColors(point, style);
  const parents = point.kind === "midpoint" ? point.key.split("/") : [point.key];
  return listed.map((fallback, i) => {
    const source = byKey.get(parents[i] ?? "") ?? (i === 0 ? point : undefined);
    if (!source || source.kind === "midpoint") return fallback;
    if (source.kind === "angle") return legibleInk(style.colors.angles, style);
    if (source.seId == null) return fallback;
    const sign = Math.min(11, Math.trunc(norm360(source.lon) / 30));
    return ephemerisPlanetInk({ id: source.seId, glyph: "", color: source.glyphColors[0] || "" }, sign, scene, style);
  });
}

/** Contour glyphs on the focused line: spread across the plot, clear of the
 * reading line at its centre (fractions of the plot width). */
export function radixContourFractions(count: number): number[] {
  const n = Math.max(0, Math.round(count));
  const left = Math.ceil(n / 2);
  const side = (k: number, a: number, b: number) => Array.from({ length: k }, (_, i) => a + ((b - a) * (i + 0.5)) / k);
  return [...side(left, 0.04, 0.44), ...side(n - left, 0.56, 0.96)];
}

/** Orb bands: each natal point's ± orb as a soft tint of its colour, under
 * the transit curves (painted from inside the plot paint, clipped there). */
export function paintEphemerisRadixBands(
  ctx: CanvasRenderingContext2D,
  geo: EphemerisGeometry,
  layer: EphemerisRadixLayer,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  recede: EphemerisRadixRecede = settledRadixRecede(scene),
) {
  const orb = scene.radixBandOrb ?? 0;
  if (scene.mode !== "longitude" || !scene.showRadix || !scene.showRadixBands || !(orb > 0) || geo.plotWidth <= 0) return;
  const modulus = scene.modulus || 360;
  const half = (geo.plotHeight / modulus) * orb;
  const focus = scene.radixFocusKey ?? null;
  const radix = style.radix;
  const others = ephemerisRecedeFactor(recede.amount, radix.radixRecedeOpacity);
  ctx.save();
  for (const point of layer.points) {
    const y = mapEphemerisY(geo, "longitude", point.lon, modulus);
    const top = Math.max(geo.yTop, y - half);
    const bottom = Math.min(geo.yBottom, y + half);
    if (bottom <= top) continue;
    const inks = [radixInk(style)];
    // Only a pinned (clicked) line recedes the others; hover never dims.
    const weight = point.key === focus ? radix.radixFocusBandScale : point.key === recede.key ? 1 : others;
    ctx.globalAlpha = (radix.radixBandOpacity * weight) / inks.length;
    for (const ink of inks) {
      ctx.fillStyle = ink;
      ctx.fillRect(geo.xOrig, top, geo.plotWidth, bottom - top);
    }
  }
  ctx.restore();
}

type RadixMarkRun = { text: string; font: "morinus" | "text"; color: string; size: number; width: number };

/** A point's mark as measured runs in its colours ("/" in muted ink). */
function radixMarkRuns(
  ctx: CanvasRenderingContext2D,
  point: EphemerisRadixPoint,
  inks: readonly string[],
  glyphSize: number,
  textSize: number,
  style: EphemerisRenderStyle,
): RadixMarkRun[] {
  let mark = 0;
  return radixPointParts(point).map((part) => {
    const separator = part.text === "/" && part.font === "text" && part.color == null && part.colorRole == null;
    const color = separator ? style.colors.muted : inks[mark++] ?? style.colors.ink;
    const size = part.font === "morinus" ? glyphSize : Math.min(glyphSize, textSize);
    ctx.font = PlateText.fontSpec(size, part.font === "morinus" ? style.typography.fontSymbols : style.typography.fontUi);
    return { text: part.text, font: part.font, color, size, width: ctx.measureText(part.text).width };
  });
}

function drawRadixRuns(
  symbols: PlateText,
  text: PlateText,
  runs: readonly RadixMarkRun[],
  x: number,
  y: number,
) {
  for (const run of runs) {
    (run.font === "morinus" ? symbols : text).draw(x, y, run.text, { size: run.size, fill: run.color, align: "left", baseline: "middle" });
    x += run.width;
  }
}

/** Lines, rings, glyphs at the reading line, the focused line's contour
 * glyphs and the label column. Painted over the plot layer. Every natal
 * line, leader and mark takes the one radix ink (radixInk); angles a little
 * heavier, midpoints dashed, the others hairline. "Colour natal labels"
 * colours only the label column's marks (radixLabelColors). A focused point (hovered or pinned) comes forward; the rest
 * recede only while one is pinned, by `recede` (the live fade; settled from
 * the scene when absent, as in exports). Hover never dims. */
export function paintEphemerisRadix(
  surface: EphemerisSurface,
  geo: EphemerisGeometry,
  camera: EphemerisCamera,
  layer: EphemerisRadixLayer,
  scene: EphemerisScene,
  style: EphemerisRenderStyle,
  recede: EphemerisRadixRecede = settledRadixRecede(scene),
) {
  if (scene.mode !== "longitude" || geo.plotWidth <= 0) return;
  const { ctx, dpr } = surface;
  const radix = style.radix;
  const colors = style.colors;
  const modulus = scene.modulus || 360;
  const byKey = new Map(layer.points.map((p) => [p.key, p]));
  const ink = radixInk(style);
  const inksByKey = new Map(layer.points.map((p) => [p.key, p.glyphs.slice(0, 2).map(() => ink)]));
  const yOf = (lon: number) => mapEphemerisY(geo, "longitude", lon, modulus);
  const pxPerDay = geo.plotWidth / camera.spanDays;
  const xOf = (jd: number) => geo.xOrig + (jd - camera.startJd) * pxPerDay;
  const focus = scene.radixFocusKey != null && byKey.has(scene.radixFocusKey) ? scene.radixFocusKey : null;
  // Hover only brings its own line forward; the others recede only while a
  // line is pinned (clicked), fading with the pin, never under the pointer.
  const others = ephemerisRecedeFactor(recede.amount, radix.radixRecedeOpacity);
  const alphaOf = (key: string, base: number) => (key === focus ? 1 : key === recede.key ? base : base * others);
  const symbols = new PlateText(ctx, style.typography.fontSymbols, 1);
  const text = new PlateText(ctx, style.typography.fontUi, 1);

  // Lines, under the rings, clipped to the plot.
  const lines = new PlateRules(ctx, colors.ink, dpr);
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.xOrig, geo.yTop - 0.5, geo.plotWidth, geo.plotHeight + 1);
  ctx.clip();
  for (const point of layer.points) {
    const y = yOf(point.lon);
    const inks = inksByKey.get(point.key) ?? [colors.ink];
    const scale = point.key === focus ? radix.radixFocusWidthScale : 1;
    ctx.globalAlpha = alphaOf(point.key, radix.radixLineOpacity);
    if (point.kind === "midpoint") {
      const width = radix.radixMidpointLineWidth * scale;
      const on = radix.radixMidpointDashOn;
      const off = radix.radixMidpointDashOff;
      lines.horizontal(geo.xOrig, geo.plotRight, y, width, [on, off], inks[0]);
    } else if (point.kind === "angle") {
      lines.horizontal(geo.xOrig, geo.plotRight, y, radix.radixLineWidth * radix.radixAngleLineScale * scale, undefined, inks[0]);
    } else {
      lines.horizontal(geo.xOrig, geo.plotRight, y, radix.radixLineWidth * radix.radixOuterWidthScale * scale, undefined, inks[0]);
    }
  }
  ctx.restore();

  // Rings at the exact crossings in the transit planet's ink.
  const inks = ephemerisInkTable(scene, style);
  const r = geo.planetFontPx * radix.radixRingScale;
  ctx.save();
  ctx.lineWidth = radix.radixRingWidth;
  for (const row of layer.crossings) {
    const x = xOf(row.jd);
    if (x < geo.xOrig - r || x > geo.plotRight + r) continue;
    const point = byKey.get(row.pointKey);
    if (!point) continue;
    const planetInk = inks.get(row.planet);
    const lon = radixCrossingLongitude(point, row.aspect);
    const ringR = point.key === focus ? r * radix.radixFocusRingScale : r;
    ctx.globalAlpha = alphaOf(point.key, 1);
    ctx.beginPath();
    ctx.arc(x, yOf(point.lon), ringR, 0, Math.PI * 2);
    ctx.fillStyle = colors.paper;
    ctx.fill();
    ctx.strokeStyle = planetInk?.bySign[Math.min(11, Math.trunc(lon / 30))] ?? colors.ink;
    ctx.stroke();
  }
  ctx.restore();

  // Marks on the plate: each line's glyph where it meets the reading line
  // (packed sideways where lines sit close), and the focused line's contour
  // glyphs. Each on a paper knock-out: round like the planet contacts' at
  // the reading line, a box for the contour glyphs.
  const knockout = (runs: readonly RadixMarkRun[], x: number, y: number, size: number) => {
    const total = runs.reduce((sum, run) => sum + run.width, 0);
    const pad = size * 0.2;
    ctx.fillStyle = colors.paper;
    ctx.fillRect(x - pad, y - size * 0.55, total + pad * 2, size * 1.1);
    drawRadixRuns(symbols, text, runs, x, y);
    return total;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.xOrig, geo.yTop, geo.plotWidth, geo.plotHeight);
  ctx.clip();
  const readingGlyphs = Boolean(scene.showNowLine) && scene.showRadixReadingGlyphs !== false;
  const pinned = focus != null && Boolean(scene.radixFocusPinned);
  if (readingGlyphs) {
    const size = geo.planetFontPx * radix.radixReadingGlyphScale;
    const r = ephemerisKnockoutRadius(size, style);
    // Knock-outs start just right of the line and pack sideways.
    const x0 = geo.xOrig + geo.plotWidth / 2 + size * 0.4;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const sorted = [...layer.points].sort((a, b) => yOf(a.lon) - yOf(b.lon));
    for (const point of sorted) {
      // A clicked line is named at the sides instead.
      if (pinned && point.key === focus) continue;
      const y = yOf(point.lon);
      const runs = radixMarkRuns(ctx, point, inksByKey.get(point.key) ?? [colors.ink], size, geo.tableFontPx, style);
      const total = runs.reduce((sum, run) => sum + run.width, 0);
      const half = Math.max(r, total / 2);
      let x = x0;
      for (;;) {
        const box = { x0: x, x1: x + half * 2, y0: y - r, y1: y + r };
        const hit = placed.find((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1);
        if (!hit) {
          placed.push(box);
          break;
        }
        x = hit.x1 + size * 0.15;
      }
      ctx.globalAlpha = alphaOf(point.key, 1);
      paintEphemerisKnockoutMark(
        ctx,
        style,
        dpr,
        x + half,
        y,
        size,
        runs.map((run) => ({
          text: run.text,
          family: run.font === "morinus" ? style.typography.fontSymbols : style.typography.fontUi,
          size: run.size,
          color: run.color,
        })),
      );
    }
  }
  // Contour glyphs name the focused line where no date-line glyph does: a
  // clicked line always, a hovered one when the date line shows none.
  const focused = focus != null && (pinned || !readingGlyphs) ? byKey.get(focus) : undefined;
  if (focused) {
    const size = geo.planetFontPx * radix.radixContourGlyphScale;
    const y = yOf(focused.lon);
    const runs = radixMarkRuns(ctx, focused, inksByKey.get(focused.key) ?? [colors.ink], size, geo.tableFontPx, style);
    const total = runs.reduce((sum, run) => sum + run.width, 0);
    ctx.globalAlpha = 1;
    for (const f of radixContourFractions(radix.radixContourCount)) {
      knockout(runs, geo.xOrig + geo.plotWidth * f - total / 2, y, size);
    }
  }
  ctx.restore();

  // Label column beyond the degree ruler: glyphs packed so they never
  // overlap, each led back to its line in the radix ink; the marks in it
  // too unless "Colour natal labels" is on.
  const left = geo.radixColumnLeft;
  const right = geo.radixColumnRight;
  if (right - left <= 0) return;
  const frame = new PlateRules(ctx, colors.frame, dpr);
  const inner = geo.mirrored ? right : left;
  frame.vertical(inner, geo.yTop, geo.yBottom, style.strokes.hairlineWidth);
  const glyphPx = geo.planetFontPx * radix.radixLabelScale;
  const gap = glyphPx * 1.05;
  const items = layer.points
    .map((point) => ({ point, y: yOf(point.lon), ly: 0 }))
    .sort((a, b) => a.y - b.y);
  const lo = geo.yTop + glyphPx / 2;
  const hi = geo.yBottom - glyphPx / 2;
  for (let i = 0; i < items.length; i++) items[i].ly = Math.max(lo, i ? Math.max(items[i].y, items[i - 1].ly + gap) : items[i].y);
  for (let i = items.length - 1; i >= 0; i--) items[i].ly = Math.min(items[i].ly, i === items.length - 1 ? hi : items[i + 1].ly - gap);
  const dir = geo.mirrored ? -1 : 1;
  const stub = inner + dir * geo.spaceSize;
  const lead = inner + dir * geo.spaceSize * 2;
  // Runs of one font each, laid left to right from the leader (right to
  // left when mirrored); written names at the plate's table text size.
  for (const item of items) {
    const pointInks = inksByKey.get(item.point.key) ?? [colors.ink];
    ctx.save();
    ctx.globalAlpha = alphaOf(item.point.key, 1);
    ctx.strokeStyle = pointInks[0];
    ctx.lineWidth = style.strokes.hairlineWidth * (item.point.key === focus ? radix.radixFocusWidthScale : 1);
    ctx.beginPath();
    ctx.moveTo(inner, item.y);
    ctx.lineTo(stub, item.y);
    ctx.lineTo(lead, item.ly);
    ctx.stroke();
    const glyphSize = item.point.glyphs.length >= 2 ? glyphPx * radix.radixPairLabelScale : glyphPx;
    const labelInks = scene.colorRadixLabels ? radixLabelColors(item.point, byKey, scene, style) : pointInks;
    const runs = radixMarkRuns(ctx, item.point, labelInks, glyphSize, geo.tableFontPx, style);
    const total = runs.reduce((sum, run) => sum + run.width, 0);
    drawRadixRuns(symbols, text, runs, lead + dir * geo.spaceSize * 0.5 - (geo.mirrored ? total : 0), item.ly);
    ctx.restore();
  }
}

/** The natal point whose line is under the pointer (plot or label column),
 * within the snap distance; null elsewhere. */
export function hitTestEphemerisRadixLine(
  px: number,
  py: number,
  geo: EphemerisGeometry,
  layer: EphemerisRadixLayer,
  scene: Pick<EphemerisScene, "mode" | "modulus" | "showRadix">,
  snapY: number,
): string | null {
  if (scene.mode !== "longitude" || !scene.showRadix || layer.points.length === 0) return null;
  const inPlot = px >= geo.xOrig && px <= geo.plotRight;
  const inColumn = px >= Math.min(geo.radixColumnLeft, geo.radixColumnRight) && px <= Math.max(geo.radixColumnLeft, geo.radixColumnRight);
  if ((!inPlot && !inColumn) || py < geo.yTop || py > geo.yBottom) return null;
  const modulus = scene.modulus || 360;
  let best: string | null = null;
  let bestDy = snapY;
  for (const point of layer.points) {
    const dy = Math.abs(py - mapEphemerisY(geo, "longitude", point.lon, modulus));
    if (dy <= bestDy) {
      best = point.key;
      bestDy = dy;
    }
  }
  return best;
}
