// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type {
  AspectMatrixAxisEntry,
  AspectMatrixCell,
  GenericTablePayload,
} from "@/lib/daemon/client";
import { cn } from "@/lib/utils";

/**
 * Aspect matrix surface — structural translation of the wx AspectsWnd grid
 * (aspectswnd.py:194-469): a left planet-glyph column, the Asc/MC section,
 * the planets x planets UPPER triangle with diagonal glyph headers, and the
 * optional houses section. Cell semantics (aspect glyph + 1-decimal orb,
 * applying corner triangle, exact inset border, parallel/contraparallel
 * mark) come from the daemon payload; styling follows the Aries webapp
 * component language, not a pixel clone.
 */

const CELL = 46; // square size in px; wx uses SQUARE_SIZE (aspectswnd.py:27)

type Props = {
  payload: GenericTablePayload;
};

export function AspectMatrixView({ payload }: Props) {
  const matrix = payload.matrix;
  if (!matrix) return null;

  // Fixed-star aspects use a different geometry: text star-name rows on the
  // left rail and a single flat glyph-header column axis (angles, planets,
  // Lot of Fortune, houses) — no triangle, no diagonal headers
  // (fixstarsaspectswnd.py:184-841). Branch to the dedicated layout.
  if (matrix.kind === "fixedStar") {
    return <FixedStarMatrix payload={payload} />;
  }

  const planets = matrix.planets;
  const ascmc = matrix.ascmc;
  const housesAxis = matrix.houses ?? [];
  const n = planets.length;

  // Grid columns: planet glyph rail | Asc/MC | planets triangle | houses.
  // Mirrors the wx single-table column order (aspectswnd.py:245-457).
  const totalCols = 1 + ascmc.length + n + housesAxis.length;
  const housesOffset = 1 + ascmc.length + n;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div
        className="inline-grid"
        style={{
          gridTemplateColumns: `repeat(${totalCols}, ${CELL}px)`,
          gridTemplateRows: `repeat(${n + 1}, ${CELL}px)`,
        }}
      >
        {/* Header row: blank corner, Asc/MC glyphs (aspectswnd.py:256-263),
            nothing above the triangle, house labels (aspectswnd.py:396-399). */}
        {ascmc.map((entry, index) => (
          <AxisHeader key={entry.id} entry={entry} col={2 + index} row={1} />
        ))}
        {housesAxis.map((entry, index) => (
          <AxisHeader key={entry.id} entry={entry} col={housesOffset + 1 + index} row={1} />
        ))}

        {planets.map((rowEntry, rowIndex) => (
          <React.Fragment key={rowEntry.id}>
            {/* Left planet rail (aspectswnd.py:245-254). */}
            <AxisHeader entry={rowEntry} col={1} row={2 + rowIndex} />
            {/* Asc/MC section cells (aspectswnd.py:265-320). */}
            {ascmc.map((angle, angleIndex) => (
              <MatrixCellView
                key={`${angle.id}:${rowEntry.id}`}
                cell={matrix.cells[`ascmc:${angleIndex}:planet:${rowEntry.planet}`]}
                col={2 + angleIndex}
                row={2 + rowIndex}
              />
            ))}
            {/* Planets section: diagonal glyph header (aspectswnd.py:322-331)
                and upper-triangle cells jj > ii (aspectswnd.py:333-391); the
                lower triangle stays empty exactly like wx. */}
            {planets.map((colEntry, colIndex) => {
              const col = 1 + ascmc.length + 1 + colIndex;
              if (colIndex === rowIndex) {
                return <AxisHeader key={colEntry.id} entry={colEntry} col={col} row={2 + rowIndex} />;
              }
              if (colIndex > rowIndex) return null;
              return (
                <MatrixCellView
                  key={`${colEntry.id}:${rowEntry.id}`}
                  cell={matrix.cells[`planet:${colEntry.planet}:planet:${rowEntry.planet}`]}
                  col={col}
                  row={2 + rowIndex}
                />
              );
            })}
            {/* Houses section cells (aspectswnd.py:401-457). */}
            {housesAxis.map((house, houseIndex) => (
              <MatrixCellView
                key={`${house.id}:${rowEntry.id}`}
                cell={matrix.cells[`house:${houseIndex}:planet:${rowEntry.planet}`]}
                col={housesOffset + 1 + houseIndex}
                row={2 + rowIndex}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      {payload.notes?.length ? (
        <div className="mt-3 space-y-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
          {payload.notes.map((note, index) => (
            <div key={`${index}:${note}`}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const STAR_RAIL = 132; // left name column width; wx CELL_WIDTH = 6*FONT_SIZE

/**
 * Fixed-star aspect matrix — structural translation of the wx
 * FixStarsAspectsWnd grid (fixstarsaspectswnd.py:184-841): a left star-name
 * rail, glyph column headers for Asc/Dsc/MC/IC + planets + Lot of Fortune +
 * houses, and N×M cells of aspect glyph + 1-decimal orb. Column families gate
 * server-side (transcendentals/nodes/LoF/houses), so the column axis already
 * reflects the option state.
 */
function FixedStarMatrix({ payload }: Props) {
  const matrix = payload.matrix;
  if (!matrix?.rows || !matrix.cols) return null;

  const rows = matrix.rows;
  const cols = matrix.cols;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div
        className="inline-grid"
        style={{
          gridTemplateColumns: `${STAR_RAIL}px repeat(${cols.length}, ${CELL}px)`,
          gridTemplateRows: `repeat(${rows.length + 1}, ${CELL}px)`,
        }}
      >
        {/* Header row: blank corner over the name rail, then column glyphs
            (fixstarsaspectswnd.py:225-427). */}
        <div className="border border-border/40" style={{ gridColumn: 1, gridRow: 1 }} />
        {cols.map((entry, colIndex) => (
          <AxisHeader key={entry.id} entry={entry} col={2 + colIndex} row={1} />
        ))}

        {rows.map((rowEntry, rowIndex) => (
          <React.Fragment key={rowEntry.id}>
            {/* Star name in the left rail (fixstarsaspectswnd.py:210-223). */}
            <div
              className="flex items-center justify-start border border-border/40 px-2"
              style={{ gridColumn: 1, gridRow: 2 + rowIndex }}
              title={rowEntry.label}
            >
              <span className="truncate text-[11px] text-foreground/80">{rowEntry.label}</span>
            </div>
            {cols.map((_colEntry, colIndex) => (
              <MatrixCellView
                key={`${rowEntry.id}:${_colEntry.id}`}
                cell={matrix.cells[`row:${rowIndex}:col:${colIndex}`]}
                col={2 + colIndex}
                row={2 + rowIndex}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      {payload.notes?.length ? (
        <div className="mt-3 space-y-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
          {payload.notes.map((note, index) => (
            <div key={`${index}:${note}`}>{note}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AxisHeader({ entry, col, row }: { entry: AspectMatrixAxisEntry; col: number; row: number }) {
  return (
    <div
      className="flex items-center justify-center border border-border/40"
      style={{ gridColumn: col, gridRow: row }}
      title={entry.label}
    >
      {entry.glyph ? (
        <span
          className="text-[19px] leading-none"
          style={{
            fontFamily: entry.glyphFont === "text" ? undefined : "'AriesMorinus'",
            color: entry.color,
          }}
        >
          {entry.glyph}
        </span>
      ) : (
        <span className="text-[11px] text-foreground/60 tabular-nums">{entry.label}</span>
      )}
    </div>
  );
}

function MatrixCellView({ cell, col, row }: { cell?: AspectMatrixCell; col: number; row: number }) {
  if (!cell) {
    return <div className="border border-border/40" style={{ gridColumn: col, gridRow: row }} />;
  }
  const hasAspect = Boolean(cell.glyph);
  return (
    <div
      className="relative border border-border/40"
      style={{ gridColumn: col, gridRow: row }}
    >
      {/* Exact aspect: inset border rectangle (aspectswnd.py:277-278). */}
      {cell.exact ? <div className="pointer-events-none absolute inset-[3px] border border-foreground/45" /> : null}
      {/* Applying aspect: filled corner triangle (aspectswnd.py:280-281). */}
      {cell.applying ? (
        <div
          className="pointer-events-none absolute left-0 top-0 size-0 border-[5px] border-transparent border-l-foreground/55 border-t-foreground/55"
        />
      ) : null}
      {/* Aspect glyph, top-left, aspect-colored (aspectswnd.py:283-287). */}
      {hasAspect ? (
        <span
          className="absolute left-[7px] top-[5px] text-[14px] leading-none"
          style={{
            fontFamily: cell.glyphFont === "text" ? undefined : "'AriesMorinus'",
            color: cell.color,
          }}
        >
          {cell.glyph}
        </span>
      ) : null}
      {/* Parallel / contraparallel mark, top-right (aspectswnd.py:289-297). */}
      {cell.parallel ? (
        <span
          className="absolute right-[4px] top-[5px] text-[12px] leading-none text-foreground/45"
          style={{ fontFamily: "'AriesMorinus'" }}
          title={cell.parallel}
        >
          {cell.parallel === "contraparallel" ? "Y" : "X"}
        </span>
      ) : null}
      {/* Orb, 1 decimal, bottom-center: aspect-colored when shown, muted
          separation otherwise (aspectswnd.py:299-319). */}
      <span
        className={cn(
          "absolute inset-x-0 bottom-[4px] text-center leading-none tabular-nums",
          hasAspect ? "text-[11px]" : "text-[10px] text-foreground/35",
        )}
        style={hasAspect ? { color: cell.color } : undefined}
      >
        {cell.orb}
      </span>
    </div>
  );
}
