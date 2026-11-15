// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { formatTableDegrees } from "@/lib/table/angle-precision";
import type { InspectorSpeculumPrecision } from "@/lib/daemon/client";
import { useTablePrecision } from "./table-precision-menu";
import * as React from "react";

import type {
  AspectMatrixAxisEntry,
  AspectMatrixCell,
  AspectMatrixPayload,
  GenericTablePayload,
} from "@/lib/daemon/client";
import { semanticChartColor } from "@/lib/theme/semantic-color";

/**
 * Aspect matrix surface — structural translation of the wx AspectsWnd grid
 * (aspectswnd.py:194-469): a left planet-glyph column, the Asc/MC section,
 * the planets x planets UPPER triangle with diagonal glyph headers, and the
 * optional houses section. Cell semantics (aspect glyph + 1-decimal orb,
 * applying corner triangle, exact inset border, parallel/contraparallel
 * mark) come from the daemon payload; styling follows the Aries webapp
 * component language, not a pixel clone.
 *
 * Framed blocks with simple lines (dashboard module 0): axis glyphs and labels stand open without rules or fill; each
 * data section (Asc/MC, planet triangle, houses, fixed-star cells) is its own
 * block with a heavier outline and single cell rules in one line colour,
 * separated by the section gap.
 */

type Props = {
  payload: GenericTablePayload;
};

type SlotSection = "axis" | "ascmc" | "planets" | "houses" | "stars";

type MatrixSlot = {
  key: string;
  col: number;
  row: number;
  section: SlotSection;
} & (
  | { kind: "axis"; entry: AspectMatrixAxisEntry }
  | { kind: "star"; entry: AspectMatrixAxisEntry }
  | { kind: "corner" }
  | { kind: "cell"; cell?: AspectMatrixCell }
);

type MatrixLayout = {
  columns: string[];
  rows: string[];
  slots: MatrixSlot[];
};

const CELL_TRACK = "var(--aries-aspect-matrix-cell-size)";
const ORB_TRACK = `minmax(${CELL_TRACK}, max-content)`;
const GAP_TRACK = "var(--aries-aspect-matrix-section-gap)";

/** Grid tracks with optional section-gap spacers; returns the grid line of each logical track. */
function buildTracks(sizes: string[], gapBefore: Set<number>) {
  const tracks: string[] = [];
  const line: number[] = [];
  sizes.forEach((size, index) => {
    if (gapBefore.has(index)) tracks.push(GAP_TRACK);
    tracks.push(size);
    line.push(tracks.length);
  });
  return { tracks, line };
}

function planetaryLayout(matrix: AspectMatrixPayload): MatrixLayout {
  const { planets, ascmc } = matrix;
  const houses = matrix.houses ?? [];
  const n = planets.length;
  // Columns: planet glyph rail | Asc/MC | planets triangle | houses — the wx
  // single-table column order (aspectswnd.py:245-457).
  const ascmcStart = 1;
  const planetStart = ascmcStart + ascmc.length;
  const houseStart = planetStart + n;
  const columnCount = houseStart + houses.length;
  const cols = buildTracks([CELL_TRACK, ...Array(columnCount - 1).fill(ORB_TRACK)], new Set([ascmcStart, planetStart, houseStart]));
  const rows = buildTracks(Array(n + 1).fill(CELL_TRACK), new Set([1]));
  const slots: MatrixSlot[] = [];
  const at = (col: number, row: number) => ({ col: cols.line[col], row: rows.line[row] });

  // Header row: Asc/MC glyphs (aspectswnd.py:256-263), nothing above the
  // triangle, house labels (aspectswnd.py:396-399).
  ascmc.forEach((entry, index) => {
    slots.push({ key: entry.id, kind: "axis", section: "axis", entry, ...at(ascmcStart + index, 0) });
  });
  houses.forEach((entry, index) => {
    slots.push({ key: entry.id, kind: "axis", section: "axis", entry, ...at(houseStart + index, 0) });
  });

  planets.forEach((rowEntry, rowIndex) => {
    const row = rowIndex + 1;
    // Left planet rail (aspectswnd.py:245-254).
    slots.push({ key: `rail:${rowEntry.id}`, kind: "axis", section: "axis", entry: rowEntry, ...at(0, row) });
    // Asc/MC section cells (aspectswnd.py:265-320).
    ascmc.forEach((angle, angleIndex) => {
      slots.push({
        key: `${angle.id}:${rowEntry.id}`,
        kind: "cell",
        section: "ascmc",
        cell: matrix.cells[`ascmc:${angleIndex}:planet:${rowEntry.planet}`],
        ...at(ascmcStart + angleIndex, row),
      });
    });
    // Planets section: diagonal glyph header (aspectswnd.py:322-331) and
    // triangle cells (aspectswnd.py:333-391); the other half stays empty
    // exactly like wx.
    planets.forEach((colEntry, colIndex) => {
      if (colIndex > rowIndex) return;
      const position = at(planetStart + colIndex, row);
      if (colIndex === rowIndex) {
        slots.push({ key: colEntry.id, kind: "axis", section: "axis", entry: colEntry, ...position });
        return;
      }
      slots.push({
        key: `${colEntry.id}:${rowEntry.id}`,
        kind: "cell",
        section: "planets",
        cell: matrix.cells[`planet:${colEntry.planet}:planet:${rowEntry.planet}`],
        ...position,
      });
    });
    // Houses section cells (aspectswnd.py:401-457).
    houses.forEach((house, houseIndex) => {
      slots.push({
        key: `${house.id}:${rowEntry.id}`,
        kind: "cell",
        section: "houses",
        cell: matrix.cells[`house:${houseIndex}:planet:${rowEntry.planet}`],
        ...at(houseStart + houseIndex, row),
      });
    });
  });
  return { columns: cols.tracks, rows: rows.tracks, slots };
}

/**
 * Fixed-star aspect matrix — structural translation of the wx
 * FixStarsAspectsWnd grid (fixstarsaspectswnd.py:184-841): a left star-name
 * rail, glyph column headers for Asc/Dsc/MC/IC + planets + Lot of Fortune +
 * houses, and N×M cells of aspect glyph + 1-decimal orb. Column families gate
 * server-side (transcendentals/nodes/LoF/houses), so the column axis already
 * reflects the option state.
 */
function fixedStarLayout(matrix: AspectMatrixPayload): MatrixLayout | null {
  if (!matrix.rows || !matrix.cols) return null;
  const starRows = matrix.rows;
  const starCols = matrix.cols;
  const cols = buildTracks(
    ["var(--aries-aspect-matrix-fixed-star-rail-width)", ...starCols.map(() => ORB_TRACK)],
    new Set([1]),
  );
  const rows = buildTracks(Array(starRows.length + 1).fill(CELL_TRACK), new Set([1]));
  const slots: MatrixSlot[] = [];
  // Header row: blank corner over the name rail, then column glyphs
  // (fixstarsaspectswnd.py:225-427).
  slots.push({ key: "corner", kind: "corner", section: "axis", col: cols.line[0], row: rows.line[0] });
  starCols.forEach((entry, colIndex) => {
    slots.push({ key: entry.id, kind: "axis", section: "axis", entry, col: cols.line[colIndex + 1], row: rows.line[0] });
  });
  starRows.forEach((rowEntry, rowIndex) => {
    // Star name in the left rail (fixstarsaspectswnd.py:210-223).
    slots.push({
      key: `rail:${rowEntry.id}`,
      kind: "star",
      section: "axis",
      entry: rowEntry,
      col: cols.line[0],
      row: rows.line[rowIndex + 1],
    });
    starCols.forEach((colEntry, colIndex) => {
      slots.push({
        key: `${rowEntry.id}:${colEntry.id}`,
        kind: "cell",
        section: "stars",
        cell: matrix.cells[`row:${rowIndex}:col:${colIndex}`],
        col: cols.line[colIndex + 1],
        row: rows.line[rowIndex + 1],
      });
    });
  });
  return { columns: cols.tracks, rows: rows.tracks, slots };
}

type EdgeClass = "frame" | "rule" | null;
type SlotEdges = { top: EdgeClass; right: EdgeClass; bottom: EdgeClass; left: EdgeClass };

/**
 * Each rule is drawn exactly once, inside one square: a square owns its right
 * and bottom edge, and its top/left edge only on the outline. Edges between
 * data squares are cell rules; edges against empty space, open axis labels or
 * the section gap are the block frame.
 */
function slotEdges(layout: MatrixLayout): Map<string, SlotEdges> {
  const ruled = layout.slots.filter((slot) => slot.section !== "axis");
  const occupied = new Set(ruled.map((slot) => `${slot.col}:${slot.row}`));
  const edges = new Map<string, SlotEdges>();
  for (const slot of ruled) {
    const has = (dc: number, dr: number) => occupied.has(`${slot.col + dc}:${slot.row + dr}`);
    edges.set(slot.key, {
      top: has(0, -1) ? null : "frame",
      right: has(1, 0) ? "rule" : "frame",
      bottom: has(0, 1) ? "rule" : "frame",
      left: has(-1, 0) ? null : "frame",
    });
  }
  return edges;
}

const EDGE_WIDTH: Record<NonNullable<EdgeClass>, string> = {
  frame: "var(--aries-aspect-matrix-frame-width)",
  rule: "var(--aries-aspect-matrix-rule-width)",
};

function SlotRules({ edges }: { edges: SlotEdges }) {
  const side = (edge: EdgeClass) => ({
    width: edge ? EDGE_WIDTH[edge] : "0",
    color: edge ? "var(--aries-aspect-matrix-rule-color)" : "transparent",
  });
  const top = side(edges.top);
  const right = side(edges.right);
  const bottom = side(edges.bottom);
  const left = side(edges.left);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 border-solid"
      style={{
        borderTopWidth: top.width,
        borderRightWidth: right.width,
        borderBottomWidth: bottom.width,
        borderLeftWidth: left.width,
        borderTopColor: top.color,
        borderRightColor: right.color,
        borderBottomColor: bottom.color,
        borderLeftColor: left.color,
      }}
    />
  );
}

export function AspectMatrixView({ payload }: Props) {
  const matrix = payload.matrix;
  const precision = useTablePrecision();
  const layout = React.useMemo(() => {
    if (!matrix) return null;
    // Fixed-star aspects use a different geometry: text star-name rows on the
    // left rail and a single flat glyph-header column axis (angles, planets,
    // Lot of Fortune, houses) — no triangle, no diagonal headers
    // (fixstarsaspectswnd.py:184-841).
    return matrix.kind === "fixedStar" ? fixedStarLayout(matrix) : planetaryLayout(matrix);
  }, [matrix]);
  const edges = React.useMemo(() => (layout ? slotEdges(layout) : null), [layout]);
  if (!layout) return null;

  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      style={{ padding: "var(--aries-aspect-matrix-outer-padding)" }}
    >
      <div
        className="inline-grid"
        style={{ gridTemplateColumns: layout.columns.join(" "), gridTemplateRows: layout.rows.join(" ") }}
      >
        {layout.slots.map((slot) => {
          const slotEdgesValue = edges?.get(slot.key);
          const placement: React.CSSProperties = { gridColumn: slot.col, gridRow: slot.row };
          const rules = slotEdgesValue ? <SlotRules edges={slotEdgesValue} /> : null;
          switch (slot.kind) {
            case "axis":
              return <AxisHeader key={slot.key} entry={slot.entry} style={placement} rules={rules} />;
            case "star":
              return <StarLabel key={slot.key} entry={slot.entry} style={placement} rules={rules} />;
            case "corner":
              return (
                <div key={slot.key} className="relative" style={placement}>
                  {rules}
                </div>
              );
            case "cell":
              return <MatrixCellView key={slot.key} cell={slot.cell} precision={precision} style={placement} rules={rules} />;
          }
        })}
      </div>
      {payload.notes?.length ? (
        <div
          className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)] [&>*+*]:mt-[var(--aries-control-gap-compact)]"
          style={{ marginTop: "var(--aries-pane-title-gap)" }}
        >
          {payload.notes.map((note, index) => (
            <div key={`${index}:${note}`}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type SlotViewProps = { style: React.CSSProperties; rules: React.ReactNode };

function StarLabel({ entry, style, rules }: SlotViewProps & { entry: AspectMatrixAxisEntry }) {
  return (
    <div
      className="relative flex items-center justify-start px-[var(--aries-control-padding-x-compact)]"
      style={style}
      title={entry.label}
    >
      {rules}
      <span
        className="truncate text-[length:var(--aries-font-size-small)]"
        style={{ color: "color-mix(in srgb, var(--aries-text-primary) 80%, transparent)" }}
      >
        {entry.label}
      </span>
    </div>
  );
}

function AxisHeader({ entry, style, rules }: SlotViewProps & { entry: AspectMatrixAxisEntry }) {
  return (
    <div className="relative flex items-center justify-center" style={style} title={entry.label}>
      {rules}
      {entry.glyph ? (
        <span
          className="leading-none"
          style={{
            fontFamily: entry.glyphFont === "text" ? undefined : "var(--aries-font-symbols)",
            fontSize: "var(--aries-aspect-matrix-axis-glyph-size)",
            color: semanticChartColor(entry.colorRole, entry.color),
          }}
        >
          {entry.glyph}
        </span>
      ) : (
        <span
          className="tabular-nums"
          style={{
            fontSize: "var(--aries-aspect-matrix-axis-label-size)",
            color: "var(--aries-aspect-matrix-axis-label-color)",
          }}
        >
          {entry.label}
        </span>
      )}
    </div>
  );
}

function MatrixCellView({ cell, style, rules, precision }: SlotViewProps & { cell?: AspectMatrixCell; precision: InspectorSpeculumPrecision }) {
  if (!cell) {
    return (
      <div className="relative" style={style}>
        {rules}
      </div>
    );
  }
  const hasAspect = Boolean(cell.glyph);
  // Preserve the matrix's decimal-degree notation.
  const orb = cell.orbDegrees;
  const units = precision === "degrees" ? 1 : precision === "minutes" ? 60 : 3600;
  const digits = precision === "degrees" ? 0 : precision === "minutes" ? 2 : 4;
  const orbLabel = orb == null ? cell.orb : (Math.trunc(Math.round(orb * 3600) / (3600 / units)) / units).toFixed(digits);
  const aspectColor = semanticChartColor(cell.colorRole, cell.color);
  return (
    <div className="relative flex flex-col justify-end" style={style}>
      {rules}
      {/* Exact aspect: inset border rectangle (aspectswnd.py:277-278). */}
      {cell.exact ? (
        <div
          className="pointer-events-none absolute border-solid"
          style={{
            inset: "var(--aries-aspect-matrix-exact-inset)",
            borderWidth: "var(--aries-aspect-matrix-exact-width)",
            borderColor: "var(--aries-aspect-matrix-exact-color)",
          }}
        />
      ) : null}
      {/* Applying aspect: filled corner triangle (aspectswnd.py:280-281). */}
      {cell.applying ? (
        <div
          className="pointer-events-none absolute left-0 top-0 size-0 border-solid"
          style={{
            borderWidth: "var(--aries-aspect-matrix-applying-marker-size)",
            borderColor: "transparent",
            borderLeftColor: "var(--aries-aspect-matrix-applying-color)",
            borderTopColor: "var(--aries-aspect-matrix-applying-color)",
          }}
        />
      ) : null}
      {/* Aspect glyph, top-left, aspect-colored (aspectswnd.py:283-287). */}
      {hasAspect ? (
        <span
          className="absolute leading-none"
          style={{
            fontFamily: cell.glyphFont === "text" ? undefined : "var(--aries-font-symbols)",
            fontSize: "var(--aries-aspect-matrix-glyph-size)",
            left: "var(--aries-aspect-matrix-glyph-inset-x)",
            top: "var(--aries-aspect-matrix-glyph-inset-y)",
            color: aspectColor,
          }}
        >
          {cell.glyph}
        </span>
      ) : null}
      {/* Parallel / contraparallel mark, top-right (aspectswnd.py:289-297). */}
      {cell.parallel ? (
        <span
          className="absolute leading-none"
          style={{
            fontFamily: "var(--aries-font-symbols)",
            fontSize: "var(--aries-aspect-matrix-parallel-size)",
            right: "var(--aries-aspect-matrix-parallel-inset-x)",
            top: "var(--aries-aspect-matrix-parallel-inset-y)",
            color: cell.parallel === "contraparallel"
              ? "color-mix(in srgb, var(--morinus-aspect-contraparallel) var(--aries-aspect-matrix-parallel-strength), transparent)"
              : "color-mix(in srgb, var(--morinus-aspect-parallel) var(--aries-aspect-matrix-parallel-strength), transparent)",
          }}
          title={cell.parallel}
        >
          {cell.parallel === "contraparallel" ? "Y" : "X"}
        </span>
      ) : null}
      {/* Orb, bottom-center: aspect-colored when shown, muted
          separation otherwise (aspectswnd.py:299-319). */}
      <span
        className="whitespace-nowrap text-center tabular-nums"
        title={orb == null ? undefined : formatTableDegrees(orb, "seconds")}
        style={{
          fontSize: hasAspect ? "var(--aries-aspect-matrix-orb-size)" : "var(--aries-aspect-matrix-empty-orb-size)",
          lineHeight: "var(--aries-aspect-matrix-orb-line-height)",
          marginBottom: "var(--aries-aspect-matrix-orb-inset-bottom)",
          color: hasAspect ? aspectColor : "var(--aries-aspect-matrix-empty-color)",
        }}
      >
        {orbLabel}
      </span>
    </div>
  );
}
