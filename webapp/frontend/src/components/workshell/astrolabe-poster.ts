// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Astrolabe poster: an atlas plate on an ISO sheet (A3 to A1) at 300 dpi, in
// the screen's colours.
// By default the astrolabe leads; below it the chart wheel of the same moment
// between its speculum and house cusps; a hairline double rule frames the
// sheet, and the chart's facts sit in the margin outside it: name on top,
// moment, place and house system below, latitude up the left edge, longitude
// down the right. The export dialog (astrolabe-poster-dialog.tsx) chooses the
// elements: either may lead or stand alone, and the chart dashboard's modules
// (aspect grid, declination scale, Moon list) can join along the foot.
// A sheet is up to 70 megapixels, past WebKit's 16.7-megapixel canvas, so the
// same renderer calls paint it tile by tile (`setCanvasDeviceFrame`) and the
// daemon stitches the tiles (`poster_export_service.py`).

import { CanvasDraw, setCanvasDeviceFrame, type CanvasDeviceFrame } from "@/lib/chart/canvas-draw";
import { canvasPngPayload } from "@/lib/chart/chart-export-registry";
import { solveDashboardLayout, type DashboardLayout, type DashRect } from "@/lib/chart/dashboard-layout";
import type { DashboardPrint } from "@/lib/chart/dashboard-paint";
import { SIGN_GLYPHS_1 } from "@/lib/chart/glyphs";
import type { Chart } from "@/lib/chart/types";
import {
  addPosterTile,
  beginPosterExport,
  cancelPosterExport,
  finishPosterExport,
  finishPosterExportBytes,
  type PosterSheet,
} from "@/lib/daemon/client";
import type { StaggerSheet } from "./poster-stagger";

export const POSTER_SHEETS_MM: Readonly<Record<PosterSheet, readonly [number, number]>> = {
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
};
const POSTER_DPI = 300;
// The sheet is composed in CSS px with its short edge about a large screen's
// chart width, so the plate's type, strokes and sky keep their on-screen
// proportions; the device pixel ratio carries it to 300 dpi.
const POSTER_SHORT_EDGE_CSS = 1100;
/** Tile edge in device px: 4096² is WebKit's canvas limit. */
const POSTER_TILE_PX = 4096;
/** Round 06 K, as shares of the sheet's width (rule widths in CSS px). */
const K = {
  frame: 0.07,
  margin: 0.02,
  plate: 0.72,
  wheel: 0.5,
  type: 0.012,
  foot: 0.011,
  rule: 1,
  innerGap: 4,
} as const;
/** Table rows: a row is this many type sizes high; the cusp table is 13 rows. */
const ROW = 1.7;
const CUSP_TABLE_WIDTH = 7.4;

type Rect = { x: number; y: number; w: number; h: number };

/** What the sheet carries (the export dialog's choices). */
export type PosterContent = {
  /** The leading element when both plate and wheel are on. */
  lead: "astrolabe" | "chart";
  /** The leading element's side as a share of the sheet's width. */
  leadShare: number;
  plate: boolean;
  wheel: boolean;
  speculum: boolean;
  cusps: boolean;
  aspectGrid: boolean;
  declination: boolean;
  moon: boolean;
  neatline: boolean;
  /** Name, moment, place and coordinates in the margin. */
  facts: boolean;
};

/** Round 06 K: the astrolabe leads, the wheel between its tables below. */
export const POSTER_CONTENT_K: PosterContent = {
  lead: "astrolabe",
  leadShare: K.plate,
  plate: true,
  wheel: true,
  speculum: true,
  cusps: true,
  aspectGrid: false,
  declination: false,
  moon: false,
  neatline: true,
  facts: true,
};
export const POSTER_LEAD_SHARE_RANGE = [0.4, 0.84] as const;

/** Row counts the tables and modules are sized for (defaults: a natal chart). */
export type PosterCounts = {
  speculumRows: number;
  gridBodies: number;
  scaleBodies: number;
  moonRows: number;
  /** The declination scale folds (mirrored setting). */
  mirrored: boolean;
};
export const POSTER_COUNTS_DEFAULT: PosterCounts = {
  speculumRows: 13, gridBodies: 12, scaleBodies: 13, moonRows: 6, mirrored: false,
};

export type PosterElement =
  | "plate" | "wheel" | "speculum" | "cusps" | "aspectGrid" | "declination" | "moon"
  /** The Stagger layout's title block and its bodies-and-houses ledger. */
  | "title" | "ledger";

export type PosterDisc = { cx: number; cy: number; r: number };

export type PosterLayout = {
  /** Sheet in device px at 300 dpi. */
  width: number;
  height: number;
  dpr: number;
  /** Sheet in CSS px. */
  page: { width: number; height: number };
  /** The plate's square: CSS side and device-px origin on the sheet. */
  plate: { side: number; x: number; y: number } | null;
  /** The chart wheel's square (its painted envelope, outer labels included)
   * and the disc its layers are clipped to, so they never cover the plate. */
  wheel: Rect | null;
  wheelClip: PosterDisc | null;
  /** The neatline's inset from the paper edge; table origins and type size. */
  frame: number;
  type: number;
  foot: number;
  speculum: { x: number; y: number } | null;
  cusps: { x: number; y: number } | null;
  /** Dashboard modules in the screen painter's layout terms (`paintDashboard`). */
  modules: DashboardLayout | null;
  /** The modules' print setting (fixed layouts), or null for the screen's. */
  modulesPrint: DashboardPrint | null;
  /** A fixed layout's own sheet parts (`poster-stagger.ts`), or null for Custom. */
  stagger: StaggerSheet | null;
  /** Every placed element's box in CSS px (the dialog's schematic); the
   * plate and the wheel are discs inscribed in theirs. */
  boxes: Array<{ id: PosterElement; rect: Rect }>;
  content: PosterContent;
};

const SPECULUM_WIDTH = 10.2;
/** Shrinking the band may cost the solved disc at most this much radius. */
const FIT_TOLERANCE = 1;
const FIT_STEPS = 16;
/** A lead that leaves no room for the other disc gives way in these steps. */
const LEAD_STEP = 0.96;
const MIN_LEAD_SHARE = 0.25;

type Region = { x: number; y: number; w: number; h: number };

/** Lower edge of the lead disc over the columns [x0, x1], or null where it is clear. */
function discFloor(disc: PosterDisc, x0: number, x1: number): number | null {
  const dx = Math.max(0, Math.max(x0 - disc.cx, disc.cx - x1));
  if (dx >= disc.r) return null;
  return disc.cy + Math.sqrt(disc.r * disc.r - dx * dx);
}

function shiftModules(layout: DashboardLayout, dx: number, dy: number): DashboardLayout {
  const move = (r: DashRect): DashRect => ({ ...r, x: r.x + dx, y: r.y + dy });
  return {
    ...layout,
    grid: layout.grid ? { ...layout.grid, left: layout.grid.left + dx, bottom: layout.grid.bottom + dy } : null,
    scale: layout.scale ? { ...layout.scale, rect: move(layout.scale.rect) } : null,
    moon: layout.moon ? move(layout.moon) : null,
    wheel: layout.wheel ? { ...layout.wheel, cx: layout.wheel.cx + dx, cy: layout.wheel.cy + dy } : null,
  };
}

/**
 * Posters are portrait and composed like the chart dashboard: with both discs
 * the lead (plate or wheel, at its chosen share of the sheet's width) stands
 * on top, the speculum and the cusp table tuck into the corners beside its
 * lower half, the dashboard modules take their screen places along the foot
 * (aspect grid left, declination scale and Moon list right), and the other
 * disc takes the largest circle that clears all of them (the dashboard's own
 * solver). That band then shrinks to what its disc needs, and the whole
 * composition is centred on the sheet, so no space is left over between
 * the parts. A lone disc is solved over the whole sheet the same way.
 */
/** The sheet in device px at 300 dpi and in the CSS px it is composed in. */
export function posterSheetPixels(sheet: PosterSheet) {
  const [widthMm, heightMm] = POSTER_SHEETS_MM[sheet];
  // Rounded like the daemon's `poster_pixel_size`.
  const width = Math.round((widthMm / 25.4) * POSTER_DPI);
  const height = Math.round((heightMm / 25.4) * POSTER_DPI);
  const dpr = width / POSTER_SHORT_EDGE_CSS;
  return { width, height, dpr, page: { width: POSTER_SHORT_EDGE_CSS, height: height / dpr } };
}

export function posterLayout(
  sheet: PosterSheet,
  content: PosterContent = POSTER_CONTENT_K,
  counts: PosterCounts = POSTER_COUNTS_DEFAULT,
): PosterLayout {
  const { width, height, dpr, page } = posterSheetPixels(sheet);
  const W = page.width;
  const H = page.height;
  const frame = W * K.frame;
  const type = W * K.type;
  const inset = frame + W * K.margin * 0.6;
  const gap = type * 1.5;
  const innerW = W - inset * 2;
  const availH = H - inset * 2;

  const both = content.plate && content.wheel;
  const leadIs: "plate" | "wheel" | null = both
    ? (content.lead === "chart" ? "wheel" : "plate")
    : null;
  const solvedIs: "plate" | "wheel" | null = both
    ? (leadIs === "plate" ? "wheel" : "plate")
    : content.plate ? "plate" : content.wheel ? "wheel" : null;
  const specW = type * SPECULUM_WIDTH;
  const specH = type * ROW * (counts.speculumRows + 1);
  const cuspW = type * CUSP_TABLE_WIDTH;
  const cuspH = type * ROW * 13;
  const modules = { aspectGrid: content.aspectGrid, declination: content.declination, moon: content.moon };

  /** The band below the lead (or the whole sheet), solved from its top `y`. */
  const solveBand = (top: number, h: number, lead: PosterDisc | null) => {
    const region: Region = { x: inset, y: top, w: innerW, h };
    // Tables in the band's top corners, lifted into the lead's lower corners
    // as far as its disc allows.
    const tableTop = (x0: number, x1: number) => {
      const floor = lead ? discFloor(lead, x0, x1) : null;
      return floor == null ? (lead ? inset : top) : floor + gap;
    };
    const specRect = content.speculum
      ? { x: inset, y: tableTop(inset, inset + specW), w: specW, h: specH } : null;
    const cuspRect = content.cusps
      ? { x: W - inset - cuspW, y: tableTop(W - inset - cuspW, W - inset), w: cuspW, h: cuspH } : null;
    const local = (r: Rect | null): DashRect | null => (r ? { x: r.x - region.x, y: r.y - region.y, w: r.w, h: r.h } : null);
    const solved = solveDashboardLayout({
      width: region.w,
      height: region.h,
      inset: 0,
      corners: { topLeft: local(specRect), topRight: local(cuspRect) },
      bodies: counts.gridBodies,
      modules,
      mirrored: counts.mirrored,
      // The bar keeps the modules along the foot, clear of the lead above.
      horizontal: true,
      moonRows: counts.moonRows,
    });
    return { region, specRect, cuspRect, layout: shiftModules(solved, region.x, region.y) };
  };
  const tablesBottom = (band: ReturnType<typeof solveBand>) =>
    Math.max(band.specRect ? band.specRect.y + band.specRect.h : 0, band.cuspRect ? band.cuspRect.y + band.cuspRect.h : 0);
  const radiusOf = (band: ReturnType<typeof solveBand>) => band.layout.wheel?.r ?? 0;
  /** Height the foot modules stand above the band's bottom (the taller side). */
  const modulesHeight = (band: ReturnType<typeof solveBand>) => {
    const { grid, scale, moon } = band.layout;
    const bottom = band.region.y + band.region.h;
    return Math.max(grid?.size ?? 0, ...[scale?.rect.y, moon?.y].filter((y): y is number => y != null).map((y) => bottom - y));
  };
  /** The lowest band that keeps the tables above the foot modules. */
  const bandFloor = (band: ReturnType<typeof solveBand>) => {
    const tables = tablesBottom(band);
    const mods = modulesHeight(band);
    return tables > 0 && mods > 0 ? tables - band.region.y + gap + mods : Math.max(0, tables - band.region.y, mods);
  };
  const fits = (band: ReturnType<typeof solveBand>) =>
    (!solvedIs || Boolean(band.layout.wheel)) && bandFloor(band) <= band.region.h;

  /** Lead at the top of the column, then the band to the column's foot. */
  const compose = (leadSide: number) => {
    const lead: PosterDisc | null = leadIs ? { cx: W / 2, cy: inset + leadSide / 2, r: leadSide / 2 } : null;
    const top = lead ? inset + leadSide + gap : inset;
    const full = solveBand(top, inset + availH - top, lead);
    return { lead, top, full };
  };
  let leadSide = leadIs ? Math.min(W * content.leadShare, innerW) : 0;
  let composed = compose(leadSide);
  // The solved disc must fit and the tables clear the modules; a lead that
  // crowds them out gives way.
  while (leadIs && !fits(composed.full) && leadSide > W * MIN_LEAD_SHARE) {
    leadSide *= LEAD_STEP;
    composed = compose(leadSide);
  }
  const { lead, top } = composed;
  let band = composed.full;
  // Shrink the band to what its disc needs: the smallest height that keeps
  // the solved radius (the disc is then width-bound), never cutting a table.
  if (solvedIs && band.layout.wheel) {
    const target = radiusOf(band) - FIT_TOLERANCE;
    let lo = Math.min(band.region.h, bandFloor(band));
    let hi = band.region.h;
    for (let step = 0; step < FIT_STEPS && hi - lo > 0.5; step++) {
      const mid = (lo + hi) / 2;
      if (radiusOf(solveBand(top, mid, lead)) >= target) hi = mid;
      else lo = mid;
    }
    band = solveBand(top, hi, lead);
  }
  // Centre the composition: from the lead's top (or the band's) to the
  // lowest part placed.
  const solvedDisc = solvedIs ? band.layout.wheel : null;
  const parts = [
    lead ? lead.cy + lead.r : -Infinity,
    solvedDisc ? solvedDisc.cy + solvedDisc.r : -Infinity,
    tablesBottom(band),
    band.layout.grid?.bottom ?? -Infinity,
    band.layout.scale ? band.layout.scale.rect.y + band.layout.scale.rect.h : -Infinity,
    band.layout.moon ? band.layout.moon.y + band.layout.moon.h : -Infinity,
  ];
  const tops = [
    lead ? inset : Infinity,
    solvedDisc ? solvedDisc.cy - solvedDisc.r : Infinity,
    band.specRect?.y ?? Infinity,
    band.cuspRect?.y ?? Infinity,
    band.layout.grid ? band.layout.grid.bottom - band.layout.grid.size : Infinity,
    band.layout.scale?.rect.y ?? Infinity,
    band.layout.moon?.y ?? Infinity,
  ];
  const usedTop = Math.min(...tops);
  const usedBottom = Math.max(...parts);
  const dy = Number.isFinite(usedTop) && Number.isFinite(usedBottom)
    ? inset + (availH - (usedBottom - usedTop)) / 2 - usedTop
    : 0;

  const boxes: PosterLayout["boxes"] = [];
  let plate: PosterLayout["plate"] = null;
  let wheel: Rect | null = null;
  let wheelClip: PosterDisc | null = null;
  const place = (id: "plate" | "wheel", disc: PosterDisc) => {
    const d = { ...disc, cy: disc.cy + dy };
    const rect = { x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 };
    boxes.push({ id, rect });
    if (id === "plate") {
      plate = { side: rect.w, x: Math.round(rect.x * dpr), y: Math.round(rect.y * dpr) };
    } else {
      wheel = rect;
      wheelClip = { ...d, r: d.r + gap / 2 };
    }
  };
  if (leadIs && lead) place(leadIs, lead);
  if (solvedIs && solvedDisc) place(solvedIs, solvedDisc);
  const speculum = band.specRect ? { x: band.specRect.x, y: band.specRect.y + dy } : null;
  const cusps = band.cuspRect ? { x: band.cuspRect.x, y: band.cuspRect.y + dy } : null;
  if (band.specRect && speculum) boxes.push({ id: "speculum", rect: { ...band.specRect, y: speculum.y } });
  if (band.cuspRect && cusps) boxes.push({ id: "cusps", rect: { ...band.cuspRect, y: cusps.y } });
  const moduleLayout = modules.aspectGrid || modules.declination || modules.moon
    ? { ...shiftModules(band.layout, 0, dy), wheel: null }
    : null;
  if (moduleLayout?.grid) {
    const { left, bottom, size } = moduleLayout.grid;
    boxes.push({ id: "aspectGrid", rect: { x: left, y: bottom - size, w: size, h: size } });
  }
  if (moduleLayout?.scale) boxes.push({ id: "declination", rect: moduleLayout.scale.rect });
  if (moduleLayout?.moon) boxes.push({ id: "moon", rect: moduleLayout.moon });

  return {
    width,
    height,
    dpr,
    page: { width: W, height: H },
    plate,
    wheel,
    wheelClip,
    frame,
    type,
    foot: W * K.foot,
    speculum,
    cusps,
    modules: moduleLayout,
    modulesPrint: null,
    stagger: null,
    boxes,
    content,
  };
}

export type PosterInk = { text: string; muted: string; fontUi: string; fontSymbols: string };
export type PosterLabels = { longitude: string; house: string; cusps: string };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const filled = (values: ReadonlyArray<string | null | undefined>) =>
  values.map((value) => value?.trim() ?? "").filter(Boolean);
const signGlyph = (longitude: number) => SIGN_GLYPHS_1[Math.floor((((longitude % 360) + 360) % 360) / 30)];
const degMin = (deg?: string, min?: string) => (deg && min ? `${deg.padStart(2, " ")}°${min}′` : "");

/** Speculum: body, sign, longitude with its motion marker, house. */
function paintSpeculum(ctx: CanvasRenderingContext2D, chart: Chart, x: number, y: number, size: number, ink: PosterInk, labels: PosterLabels) {
  const row = size * ROW;
  const cols = [0, size * 1.6, size * 3.2, size * 8.6];
  const houseX = x + cols[3] + size * 1.6;
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink.muted;
  ctx.font = `${size * 0.8}px ${ink.fontUi}`;
  ctx.textAlign = "left";
  ctx.fillText(labels.longitude, x + cols[2], y + row / 2);
  ctx.textAlign = "right";
  ctx.fillText(labels.house, houseX, y + row / 2);
  chart.planets.forEach((planet, index) => {
    const cy = y + row * (index + 1.5);
    ctx.textAlign = "center";
    ctx.font = `${size * 1.15}px ${ink.fontSymbols}`;
    if (planet.glyph) {
      ctx.fillStyle = planet.color ?? ink.text;
      ctx.fillText(planet.glyph, x + cols[0] + size * 0.6, cy);
    }
    ctx.fillStyle = ink.text;
    ctx.fillText(signGlyph(planet.longitude), x + cols[1] + size * 0.6, cy);
    ctx.font = `${size}px ${ink.fontUi}`;
    ctx.textAlign = "left";
    ctx.fillText(filled([degMin(planet.degText, planet.minText), planet.motion]).join(" "), x + cols[2], cy);
    const house = planet.house ? ROMAN[planet.house - 1] : "";
    if (house) {
      ctx.textAlign = "right";
      ctx.fillStyle = ink.muted;
      ctx.fillText(house, houseX, cy);
    }
  });
}

/** House cusps I–XII: sign and longitude. */
function paintCusps(ctx: CanvasRenderingContext2D, chart: Chart, x: number, y: number, size: number, ink: PosterInk, labels: PosterLabels) {
  const row = size * ROW;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = ink.muted;
  ctx.font = `${size * 0.8}px ${ink.fontUi}`;
  ctx.fillText(labels.cusps, x, y + row / 2);
  chart.houses.cusps.forEach((longitude, index) => {
    const cy = y + row * (index + 1.5);
    ctx.textAlign = "left";
    ctx.fillStyle = ink.muted;
    ctx.font = `${size}px ${ink.fontUi}`;
    ctx.fillText(ROMAN[index], x, cy);
    ctx.fillStyle = ink.text;
    ctx.textAlign = "center";
    ctx.font = `${size * 1.15}px ${ink.fontSymbols}`;
    ctx.fillText(signGlyph(longitude), x + size * 2.9, cy);
    const text = degMin(chart.houses.cuspDegMin?.[index]?.degText, chart.houses.cuspDegMin?.[index]?.minText);
    if (text) {
      ctx.textAlign = "left";
      ctx.font = `${size}px ${ink.fontUi}`;
      ctx.fillText(text, x + size * 3.9, cy);
    }
  });
}

/** The neatline: a frame with a finer rule just inside it, as engraved plates have. */
function paintNeatline(ctx: CanvasRenderingContext2D, layout: PosterLayout, ink: PosterInk) {
  const { frame, page } = layout;
  ctx.strokeStyle = ink.muted;
  ctx.lineWidth = K.rule;
  ctx.strokeRect(frame, frame, page.width - frame * 2, page.height - frame * 2);
  const inner = frame + K.innerGap;
  ctx.lineWidth = K.rule * 0.4;
  ctx.strokeRect(inner, inner, page.width - inner * 2, page.height - inner * 2);
}

/** The margin: name on top, moment, place and house system below, latitude
 * up the left edge and longitude down the right, each centred in its strip. */
function paintMarginFacts(ctx: CanvasRenderingContext2D, layout: PosterLayout, chart: Chart, ink: PosterInk) {
  const { frame, page, foot } = layout;
  const { meta } = chart;
  const mid = frame / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (meta.name?.trim()) {
    ctx.fillStyle = ink.text;
    ctx.font = `${foot * 1.25}px ${ink.fontUi}`;
    ctx.fillText(meta.name.trim(), page.width / 2, mid);
  }
  ctx.fillStyle = ink.muted;
  ctx.font = `${foot}px ${ink.fontUi}`;
  const below = filled([meta.dateDisplay, meta.timeDisplay, meta.place, ...(meta.houseSystemLines ?? [])]);
  if (below.length) ctx.fillText(below.join("      "), page.width / 2, page.height - mid);
  // The daemon writes "longitude, latitude" (`ChartMeta.placeCoords`).
  const [longitude, latitude] = filled((meta.placeCoords ?? "").split(","));
  const edge = (text: string | undefined, x: number, turn: number) => {
    if (!text) return;
    ctx.save();
    ctx.translate(x, page.height / 2);
    ctx.rotate(turn);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  edge(latitude, mid, -Math.PI / 2);
  edge(longitude, page.width - mid, Math.PI / 2);
}

/** Everything on the sheet but the plate, the wheel and the modules. */
export function paintPosterSheet(
  draw: CanvasDraw,
  layout: PosterLayout,
  chart: Chart | null,
  ink: PosterInk,
  labels: PosterLabels,
) {
  const ctx = draw.ctx;
  const { content } = layout;
  ctx.save();
  if (content.neatline) paintNeatline(ctx, layout, ink);
  if (chart) {
    if (layout.speculum) paintSpeculum(ctx, chart, layout.speculum.x, layout.speculum.y, layout.type, ink, labels);
    if (layout.cusps) paintCusps(ctx, chart, layout.cusps.x, layout.cusps.y, layout.type, ink, labels);
    if (content.facts) paintMarginFacts(ctx, layout, chart, ink);
  }
  ctx.restore();
}

export type PosterPainters = {
  /** Paper colour where no plate paints the tile's background. */
  background: string;
  /** Paint the plate into its square of `side` CSS px at `dpr`. */
  plate: (canvas: HTMLCanvasElement, side: number, dpr: number) => void;
  /** Composite the chart wheel onto the tile (`frame` is the tile's device frame). */
  wheel: (canvas: HTMLCanvasElement, frame: CanvasDeviceFrame, layout: PosterLayout) => void;
  /** Paint the neatline, tables, modules and margin facts over the sheet. */
  sheet: (draw: CanvasDraw, layout: PosterLayout) => void;
};

/** Paint the poster tile by tile and hand each to the daemon, which writes
 * the stitched sheet to `target` (a save-dialog path, or a download). */
export async function exportAstrolabePoster(
  layout: PosterLayout,
  sheet: PosterSheet,
  kind: "pdf" | "png",
  title: string,
  target: { path: string } | { filename: string },
  painters: PosterPainters,
) {
  const { jobId } = await beginPosterExport({ sheet, width: layout.width, height: layout.height });
  const canvas = document.createElement("canvas");
  try {
    for (let y = 0; y < layout.height; y += POSTER_TILE_PX) {
      for (let x = 0; x < layout.width; x += POSTER_TILE_PX) {
        const width = Math.min(POSTER_TILE_PX, layout.width - x);
        const height = Math.min(POSTER_TILE_PX, layout.height - y);
        const frame = { x: -x, y: -y, width, height };
        if (layout.plate) {
          // The plate's renderer fills the whole tile with its background first.
          setCanvasDeviceFrame(canvas, { x: layout.plate.x - x, y: layout.plate.y - y, width, height });
          painters.plate(canvas, layout.plate.side, layout.dpr);
        } else {
          setCanvasDeviceFrame(canvas, frame);
          const paper = new CanvasDraw(canvas);
          paper.resize(layout.page.width, layout.page.height, layout.dpr);
          paper.fillBackground(painters.background);
        }
        if (layout.wheel && layout.wheelClip) painters.wheel(canvas, frame, layout);
        setCanvasDeviceFrame(canvas, frame);
        const draw = new CanvasDraw(canvas);
        draw.resize(layout.page.width, layout.page.height, layout.dpr);
        painters.sheet(draw, layout);
        const { pngBase64 } = await canvasPngPayload(canvas, "base64");
        await addPosterTile({ jobId, x, y, pngBase64: pngBase64 ?? "" });
      }
    }
  } catch (err) {
    void cancelPosterExport(jobId).catch(() => {});
    throw err;
  } finally {
    setCanvasDeviceFrame(canvas, null);
    canvas.width = canvas.height = 0;
  }
  return "path" in target
    ? finishPosterExport({ jobId, kind, title, path: target.path })
    : finishPosterExportBytes({ jobId, kind, title, filename: target.filename });
}
