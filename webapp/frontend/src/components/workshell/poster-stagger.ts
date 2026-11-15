// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Poster layout "Stagger, title block": no frame, only the sheet margin. The plate's
// ink sits on the top and left margins, the chart wheel's rim on the right and
// bottom ones. The name and the chart's facts head the column top right, with
// the bodies and house cusps as one ledger below them. Bottom left, the Moon
// list and the aspect grid run down the corner in one rhythm, the grid nesting
// into the wheel's curve as the dashboard's does. Every list is set as a print
// table: a caption, small column heads, tabular figures, one ink.
// Design-lab painter of record: `src/design-lab/paint/poster-09.ts` (`paintTitle`).

import type { CanvasDraw } from "@/lib/chart/canvas-draw";
import type { DashboardLayout } from "@/lib/chart/dashboard-layout";
import type { DashboardPrint } from "@/lib/chart/dashboard-paint";
import { SIGN_GLYPHS_1 } from "@/lib/chart/glyphs";
import type { Chart, ChartMeta } from "@/lib/chart/types";
import type { PosterSheet } from "@/lib/daemon/client";
import {
  posterSheetPixels,
  type PosterContent,
  type PosterCounts,
  type PosterDisc,
  type PosterInk,
  type PosterLayout,
} from "./astrolabe-poster";

/** Tuned values, as shares of the sheet's width. */
const S = {
  discs: 0.7,
  type: 0.013,
  name: 0.029,
  facts: 0.018,
  margin: 0.04,
  /** Aspect figures, × the table type. */
  gridType: 1,
} as const;
/** One row pitch for every table and the Moon list. */
const ROW = 1.6;
/** The plate's outermost ink (its compass letters) sits this share of the
 * radius inside its render square. */
const PLATE_INK_INSET = 0.058;
/** The poster wheel's outer ring sits this share of the radius inside its
 * paint square on the right and bottom. */
const WHEEL_RIM_INSET = 0.1;
/** How far the grid's axis glyphs reach past each staircase step, in cells. */
const GRID_GLYPH_REACH = 0.9;
/** The grid's cell range, in table type sizes. */
const GRID_CELL_MIN = 1.2;
const GRID_CELL_MAX = 4;
/** Moon list width, in table type sizes. */
const MOON_WIDTH = 16.5;
const MIN_DISC = 0.3;
/** The title block wraps where the discs would fall below this share of the width. */
const WRAP_DISC = 0.62;

type Box = { x: number; y: number; w: number; h: number };

export type PosterFact = { text: string; primary: boolean };
/** The title block's text: the chart's name and its facts in print form. */
export type PosterTitle = {
  name: string;
  facts: PosterFact[];
  /** Mark ending the last facts line (the PNG watermark), or null. */
  mark: string | null;
};
export type PosterMeasure = (text: string, font: string) => number;

/** Width estimate where no canvas measures (tests). */
export const estimateMeasure: PosterMeasure = (text, font) => {
  const px = Number.parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? "12");
  return text.length * px * 0.55;
};

const font = (px: number, family: string, weight = 400) => `${weight} ${px.toFixed(2)}px ${family}`;

/** The chart's facts in print form: the date with spaces (a named month), no
 * comma before the zone, latitude before longitude with primes for minutes. */
export function posterTitleFromChart(meta: ChartMeta, mark: string | null): PosterTitle {
  const date = meta.dateDisplay?.trim() ?? "";
  const coord = (s: string) => s.trim().replace(/'/g, "′").replace(/^0(\d)/, "$1").replace(/([NSEW])$/, " $1");
  // The daemon writes "longitude, latitude" (`ChartMeta.placeCoords`).
  const [longitude, latitude] = (meta.placeCoords ?? "").split(/,\s*/).map((part) => part.trim()).filter(Boolean);
  const facts: PosterFact[] = [
    { text: /\p{L}/u.test(date) ? date.replace(/\./g, " ") : date, primary: true },
    { text: (meta.timeDisplay ?? "").trim().replace(/,\s*/, " "), primary: true },
    { text: meta.place?.trim() ?? "", primary: false },
    { text: [latitude, longitude].filter(Boolean).map((c) => coord(c!)).join(" "), primary: false },
    { text: (meta.houseSystemLines ?? []).map((line) => line.trim()).filter(Boolean).join(" "), primary: false },
  ].filter((fact) => fact.text);
  return { name: meta.name?.trim() ?? "", facts, mark: mark?.trim() || null };
}

// ── Title block ─────────────────────────────────────────────────────────────

type TitleLine = { text: string; w: number; size: number; primary: boolean; name: boolean };
type TitleBlock = { lines: TitleLine[]; baselines: number[]; mark: number; sep: number; w: number; h: number };

/** Words on as few lines as `measureWidth` allows (a lone long word keeps its line). */
function wrap(text: string, px: number, family: string, measureWidth: number, measure: PosterMeasure) {
  const lines: Array<{ text: string; w: number }> = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    const joined = last ? `${last.text} ${word}` : word;
    const w = measure(joined, font(px, family));
    if (last && w <= measureWidth) {
      last.text = joined;
      last.w = w;
    } else {
      lines.push({ text: word, w: measure(word, font(px, family)) });
    }
  }
  return lines;
}

/** Name in its stored case, then one fact per line, each wrapped to the
 * column's measure; the mark ends the last line. */
function titleBlock(title: PosterTitle, nameSize: number, factSize: number, family: string, measureWidth: number, measure: PosterMeasure): TitleBlock {
  const lines: TitleLine[] = [];
  for (const line of wrap(title.name, nameSize, family, measureWidth, measure)) {
    lines.push({ ...line, size: nameSize, primary: true, name: true });
  }
  for (const fact of title.facts) {
    for (const line of wrap(fact.text, factSize, family, measureWidth, measure)) {
      lines.push({ ...line, size: factSize, primary: fact.primary, name: false });
    }
  }
  const baselines: number[] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    if (!prev) baselines.push(line.size * 0.74);
    // The name at 1.12 × its size, a wider step under it, then the facts at 1.45 × theirs.
    else baselines.push(baselines[i - 1] + (line.name ? nameSize * 1.12 : prev.name ? factSize * 2 : factSize * 1.45));
  });
  const mark = title.mark ? measure(title.mark, font(factSize, family)) : 0;
  const sep = title.mark ? factSize * 2 : 0;
  const last = lines[lines.length - 1];
  const w = Math.max(0, ...lines.map((l) => l.w), (last?.w ?? 0) + sep + mark);
  const h = lines.length ? baselines[baselines.length - 1] + factSize * 0.3 : 0;
  return { lines, baselines, mark, sep, w, h };
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Column widths in table type sizes. Bodies: glyph · degrees° · sign · minutes′ · motion · house. */
const BODY_COLS = [1.4, 1.9, 1.5, 1.6, 0.9, 1.9] as const;
/** Houses: numeral · degrees° · sign · minutes′. */
const CUSP_COLS = [1.6, 2.4, 1.5, 1.6] as const;
const LEDGER_GUTTER = 1.4;
const sum = (cols: readonly number[]) => cols.reduce((a, b) => a + b, 0);
const LEDGER_WIDTH = sum(BODY_COLS) + LEDGER_GUTTER + sum(CUSP_COLS);

/** Caption, heads, body rows and a closing step. */
const ledgerHeight = (size: number, rows: number) => size * ROW * (1 + 0.95 + 0.3 + rows + 0.2);
/** Caption, the rows, closing step. */
const moonHeight = (size: number, rows: number) => size * ROW * (1 + 0.25 + rows + 0.25);
/** Caption above the grid's top. */
const aspectsCaption = (size: number) => size * ROW * 1.1;

// ── Geometry ────────────────────────────────────────────────────────────────

/** Lower edge of a disc over the columns [x0, x1], or null where they clear it. */
function discFloor(disc: PosterDisc, x0: number, x1: number): number | null {
  const dx = Math.max(0, x0 - disc.cx, disc.cx - x1);
  return dx >= disc.r ? null : disc.cy + Math.sqrt(disc.r * disc.r - dx * dx);
}

/** Distance from a disc's rim to a box (negative inside). */
function discDistance(disc: PosterDisc, r: Box): number {
  const dx = Math.max(r.x - disc.cx, 0, disc.cx - r.x - r.w);
  const dy = Math.max(r.y - disc.cy, 0, disc.cy - r.y - r.h);
  return Math.hypot(dx, dy) - disc.r;
}

/** Largest value in [lo, hi] that `fits` (fits is monotone, true at lo). */
function solve(lo: number, hi: number, fits: (v: number) => boolean) {
  if (fits(hi)) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 18; i += 1) {
    const mid = (a + b) / 2;
    if (fits(mid)) a = mid;
    else b = mid;
  }
  return a;
}

/** What the Stagger sheet paints besides the discs and the modules. */
export type StaggerSheet = {
  type: number;
  nameSize: number;
  factSize: number;
  family: string;
  /** The column top right: title block, then the ledger. */
  column: { x: number; x1: number; y: number };
  title: TitleBlock;
  ledger: { x: number; y: number; rows: number };
  /** Captions over the Moon list and the aspect grid (their tops). */
  moonCaption: { x: number; y: number } | null;
  aspectsCaption: { x: number; y: number } | null;
};

/** Is the Stagger's every element present (modules need their data)? */
export type StaggerModules = { aspectGrid: boolean; moon: boolean };

const STAGGER_CONTENT: PosterContent = {
  lead: "astrolabe",
  leadShare: S.discs,
  plate: true,
  wheel: true,
  speculum: false,
  cusps: false,
  aspectGrid: false,
  declination: false,
  moon: false,
  neatline: false,
  facts: false,
};

/**
 * Stagger, title block. The discs take the largest diameter that leaves the
 * column beside the plate, the column's depth above the wheel, and the
 * corner's Moon list and aspect grid below the plate. The wheel then moves
 * toward its corner by its rim inset (at most ¾ of the margin, so its outer
 * labels keep a quarter margin from the paper's edge). The aspect grid takes
 * the largest cell whose staircase and axis glyphs still clear the wheel, and
 * plate, Moon list and aspects stand equally apart.
 */
export function posterStaggerLayout(
  sheet: PosterSheet,
  counts: PosterCounts,
  title: PosterTitle,
  family: string,
  modules: StaggerModules,
  measure: PosterMeasure = estimateMeasure,
): PosterLayout {
  const { width, height, dpr, page } = posterSheetPixels(sheet);
  const W = page.width;
  const margin = W * S.margin;
  const box = { x0: margin, y0: margin, x1: page.width - margin, y1: page.height - margin };
  const size = W * S.type;
  const r = size * ROW;
  const gap = size * 2;
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const nameSize = W * S.name;
  const factSize = W * S.facts;
  const ledgerRows = Math.max(counts.speculumRows, 12);
  const ledgerW = LEDGER_WIDTH * size;
  const block = titleBlock(title, nameSize, factSize, family, Math.max(ledgerW, cw - W * WRAP_DISC - gap), measure);
  const ledgerH = ledgerHeight(size, ledgerRows);
  const colW = Math.max(ledgerW, block.w);
  const titleGap = block.h ? r * 2 : 0;
  const colH = block.h + titleGap + ledgerH;
  const n = counts.gridBodies;
  const moonW = MOON_WIDTH * size;
  const moonH = modules.moon ? moonHeight(size, counts.moonRows) : 0;
  const aspectsH = (cell: number) => (modules.aspectGrid ? n * cell + aspectsCaption(size) : 0);
  const cellFor = (d: number) => Math.min(size * 2.1, (cw - d - gap) / n);
  const corner = (d: number) => moonH + (moonH && modules.aspectGrid ? gap * 1.5 : 0) + aspectsH(cellFor(d));
  const leftW = modules.moon ? moonW : modules.aspectGrid ? n * size * GRID_CELL_MIN : 0;
  const d = solve(W * MIN_DISC, Math.min(W * S.discs, cw, ch), (v) =>
    v + gap + Math.max(colW, leftW) <= cw && colH <= ch - v - gap && corner(v) <= ch - v - gap);

  const shift = Math.min((d / 2) * WHEEL_RIM_INSET, margin * 0.75);
  const plateDisc: PosterDisc = { cx: box.x0 + d / 2, cy: box.y0 + d / 2, r: d / 2 };
  const wheelDisc: PosterDisc = { cx: box.x1 - d / 2 + shift, cy: box.y1 - d / 2 + shift, r: d / 2 };
  const plateSide = d / (1 - PLATE_INK_INSET);
  const wheelRect = { x: wheelDisc.cx - d / 2, y: wheelDisc.cy - d / 2, w: d, h: d };

  // Bottom left, under the plate's curve.
  const floor = discFloor(plateDisc, box.x0, box.x0 + Math.max(moonW, leftW)) ?? box.y0;
  const moonTop = floor + gap;
  const gridRoom = box.y1 - (modules.moon ? moonTop + moonH + gap * 1.5 : floor + gap);
  const clears = (c: number) => {
    if (n * c + aspectsCaption(size) > gridRoom) return false;
    const top = box.y1 - n * c;
    for (let row = 0; row < n; row += 1) {
      const step = { x: box.x0, y: top + row * c, w: (row + 1) * c + c * GRID_GLYPH_REACH, h: c };
      if (discDistance(wheelDisc, step) < gap) return false;
    }
    return true;
  };
  const cell = modules.aspectGrid ? solve(size * GRID_CELL_MIN, size * GRID_CELL_MAX, clears) : 0;
  // One rhythm down the corner: plate, Moon and aspects equally apart, the
  // Moon rising only as far as the wheel's curve asks.
  const capTop = modules.aspectGrid ? box.y1 - aspectsH(cell) : box.y1;
  const even = (floor + capTop - moonH) / 2;
  const moonClears = (y: number) => discDistance(wheelDisc, { x: box.x0, y, w: moonW, h: moonH }) >= gap;
  const moonY = even > moonTop ? solve(moonTop, even, moonClears) : moonTop;

  // The Moon list's rows: their baselines from the box's bottom, as the
  // dashboard sets them (`moonRowBaseline`), on this table's row grid.
  const moonRows = modules.moon
    ? { x: box.x0, y: moonY + r * 1.25, w: moonW, h: r * (counts.moonRows - 0.5) + size * 0.35 }
    : null;
  const gridLayout = modules.aspectGrid ? { left: box.x0, bottom: box.y1, size: n * cell } : null;
  const moduleLayout: DashboardLayout | null = moonRows || gridLayout ? {
    cell: cell || size * 2,
    gap,
    glyph: size,
    text: size,
    grid: gridLayout,
    scale: null,
    moon: moonRows,
    wheel: null,
  } : null;

  const columnX = box.x1 - colW;
  const ledgerY = box.y0 + block.h + titleGap;
  const boxes: PosterLayout["boxes"] = [
    { id: "plate", rect: { x: plateDisc.cx - d / 2, y: plateDisc.cy - d / 2, w: d, h: d } },
    { id: "wheel", rect: wheelRect },
  ];
  if (block.h) boxes.push({ id: "title", rect: { x: columnX, y: box.y0, w: block.w, h: block.h } });
  boxes.push({ id: "ledger", rect: { x: columnX, y: ledgerY, w: ledgerW, h: ledgerH } });
  if (moonRows) boxes.push({ id: "moon", rect: { x: box.x0, y: moonY, w: moonW, h: moonH } });
  if (gridLayout) boxes.push({ id: "aspectGrid", rect: { x: box.x0, y: box.y1 - n * cell, w: n * cell, h: n * cell } });

  return {
    width,
    height,
    dpr,
    page,
    plate: {
      side: plateSide,
      x: Math.round((plateDisc.cx - plateSide / 2) * dpr),
      y: Math.round((plateDisc.cy - plateSide / 2) * dpr),
    },
    wheel: wheelRect,
    wheelClip: { ...wheelDisc, r: wheelDisc.r + gap / 2 },
    frame: margin,
    type: size,
    foot: factSize,
    speculum: null,
    cusps: null,
    modules: moduleLayout,
    modulesPrint: moduleLayout ? STAGGER_PRINT(size) : null,
    stagger: {
      type: size,
      nameSize,
      factSize,
      family,
      column: { x: columnX, x1: box.x1, y: box.y0 },
      title: block,
      ledger: { x: columnX, y: ledgerY, rows: ledgerRows },
      moonCaption: moonRows ? { x: box.x0, y: moonY } : null,
      aspectsCaption: gridLayout ? { x: box.x0, y: box.y1 - n * cell - aspectsCaption(size) } : null,
    },
    boxes,
    content: { ...STAGGER_CONTENT, aspectGrid: modules.aspectGrid, moon: modules.moon },
  };
}

/** The grid's figures at the table type, the empty lattice quieter than the staircase. */
const STAGGER_PRINT = (size: number): DashboardPrint => ({
  gridGlyph: size * S.gridType,
  gridOrb: size * S.gridType * 0.72,
  lattice: "color-mix(in srgb, var(--aries-text-dim) 45%, transparent)",
  outline: "var(--aries-text-muted)",
  ruleWidth: 0.5,
  frameWidth: 0.5,
  moonHeading: false,
});

// ── Paint ───────────────────────────────────────────────────────────────────

const DIGITS = "0123456789";
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/** Set `text` with tabular figures: canvas has no font-variant-numeric, so digits are placed one by one. */
function fillFigures(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: "left" | "right" | "center") {
  const dw = Math.max(...[...DIGITS].map((d) => ctx.measureText(d).width));
  const advance = (ch: string) => (isDigit(ch) ? dw : ctx.measureText(ch).width);
  const w = [...text].reduce((s, ch) => s + advance(ch), 0);
  let cx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  ctx.textAlign = "left";
  for (const ch of text) {
    const a = ctx.measureText(ch).width;
    ctx.fillText(ch, isDigit(ch) ? cx + (dw - a) / 2 : cx, y);
    cx += advance(ch);
  }
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const signGlyph = (longitude: number) => SIGN_GLYPHS_1[Math.floor((((longitude % 360) + 360) % 360) / 30)];

export type StaggerLabels = {
  bodies: string;
  houses: string;
  longitude: string;
  house: string;
  cusps: string;
  aspects: string;
  moon: string;
};

type Cell = { text: string; sym?: boolean; fig?: boolean; ink: string; scale?: number } | null;
type Col = { w: number; align: "left" | "right" | "center"; head?: string; pad?: number };

function paintCaption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, ink: PosterInk) {
  ctx.font = font(size, ink.fontUi, 500);
  ctx.fillStyle = ink.text;
  ctx.textAlign = "left";
  ctx.fillText(text, x, y + size * ROW * 0.66);
}

/** Bodies and houses side by side on one row grid, each under its caption. */
function paintLedger(ctx: CanvasRenderingContext2D, chart: Chart, sheet: StaggerSheet, ink: PosterInk, labels: StaggerLabels) {
  const size = sheet.type;
  const r = size * ROW;
  const bodyCols: Col[] = [
    { w: BODY_COLS[0], align: "center" },
    { w: BODY_COLS[1], align: "right" },
    { w: BODY_COLS[2], align: "center", head: labels.longitude },
    { w: BODY_COLS[3], align: "left" },
    { w: BODY_COLS[4], align: "left", pad: 0.15 },
    { w: BODY_COLS[5], align: "right", head: labels.house },
  ];
  const cuspCols: Col[] = [
    { w: CUSP_COLS[0], align: "right" },
    { w: CUSP_COLS[1], align: "right" },
    { w: CUSP_COLS[2], align: "center", head: labels.cusps },
    { w: CUSP_COLS[3], align: "left" },
  ];
  const bodyRows: Cell[][] = chart.planets.map((planet) => [
    planet.glyph ? { text: planet.glyph, sym: true, ink: ink.text } : null,
    planet.degText ? { text: `${planet.degText.trim()}°`, fig: true, ink: ink.text } : null,
    { text: signGlyph(planet.longitude), sym: true, ink: ink.text },
    planet.minText ? { text: `${planet.minText}′`, fig: true, ink: ink.text } : null,
    planet.motion ? { text: planet.motion, ink: ink.muted, scale: 0.78 } : null,
    planet.house ? { text: ROMAN[planet.house - 1] ?? "", ink: ink.muted } : null,
  ]);
  const angles = [chart.angles.asc, chart.angles.mc, chart.angles.dsc, chart.angles.ic];
  const isAngle = (lon: number) => angles.some((a) => Math.abs(((lon - a + 540) % 360) - 180) < 1e-6);
  const cuspRows: Cell[][] = chart.houses.cusps.map((longitude, i) => {
    const dm = chart.houses.cuspDegMin?.[i];
    return [
      { text: ROMAN[i], ink: isAngle(longitude) ? ink.text : ink.muted },
      dm?.degText ? { text: `${dm.degText.trim()}°`, fig: true, ink: ink.text } : null,
      { text: signGlyph(longitude), sym: true, ink: ink.text },
      dm?.minText ? { text: `${dm.minText}′`, fig: true, ink: ink.text } : null,
    ];
  });
  const groups = [
    { title: labels.bodies, cols: bodyCols, rows: bodyRows },
    { title: labels.houses, cols: cuspCols, rows: cuspRows },
  ];
  const { x, y } = sheet.ledger;
  const head = r * 0.95;
  ctx.textBaseline = "alphabetic";
  let gx = x;
  for (const group of groups) {
    paintCaption(ctx, group.title, gx, y, size, ink);
    const top = y + r;
    let cx = gx;
    const anchors = group.cols.map((c) => {
      const at = c.align === "left" ? cx + (c.pad ?? 0) * size
        : c.align === "right" ? cx + (c.w - (c.pad ?? 0)) * size
          : cx + (c.w * size) / 2;
      cx += c.w * size;
      return at;
    });
    ctx.font = font(size * 0.8, ink.fontUi);
    ctx.fillStyle = ink.muted;
    group.cols.forEach((c, ci) => {
      if (!c.head) return;
      ctx.textAlign = c.align;
      ctx.fillText(c.head, anchors[ci], top + r * 0.68);
    });
    group.rows.forEach((row, ri) => {
      const base = top + head + r * 0.3 + r * ri + r * 0.7;
      row.forEach((cell, ci) => {
        if (!cell) return;
        const k = cell.scale ?? 1;
        ctx.fillStyle = cell.ink;
        ctx.font = cell.sym ? font(size * 1.05 * k, ink.fontSymbols) : font(size * k, ink.fontUi);
        if (cell.fig) fillFigures(ctx, cell.text, anchors[ci], base, group.cols[ci].align);
        else {
          ctx.textAlign = group.cols[ci].align;
          ctx.fillText(cell.text, anchors[ci], base);
        }
      });
    });
    gx = cx + LEDGER_GUTTER * size;
  }
}

/** The title block, flush left on the column; the mark flush right on the last line. */
function paintTitle(ctx: CanvasRenderingContext2D, sheet: StaggerSheet, title: PosterTitle, ink: PosterInk) {
  const { column, title: block } = sheet;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  block.lines.forEach((line, i) => {
    ctx.font = font(line.size, sheet.family);
    ctx.fillStyle = line.primary ? ink.text : ink.muted;
    ctx.fillText(line.text, column.x, column.y + block.baselines[i]);
  });
  if (title.mark && block.baselines.length) {
    ctx.font = font(sheet.factSize, sheet.family);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.fillText(title.mark, column.x1, column.y + block.baselines[block.baselines.length - 1]);
  }
}

/** Everything on the Stagger sheet but the discs and the modules' bodies. */
export function paintStaggerSheet(
  draw: CanvasDraw,
  sheet: StaggerSheet,
  chart: Chart,
  title: PosterTitle,
  ink: PosterInk,
  labels: StaggerLabels,
) {
  const { ctx } = draw;
  ctx.save();
  paintTitle(ctx, sheet, title, ink);
  paintLedger(ctx, chart, sheet, ink, labels);
  if (sheet.moonCaption) paintCaption(ctx, labels.moon, sheet.moonCaption.x, sheet.moonCaption.y, sheet.type, ink);
  if (sheet.aspectsCaption) paintCaption(ctx, labels.aspects, sheet.aspectsCaption.x, sheet.aspectsCaption.y, sheet.type, ink);
  ctx.restore();
}
