// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { GenericTableCell, InspectorSpeculumPrecision } from "@/lib/daemon/client";
import { formatTableAngleText } from "@/lib/table/angle-precision";
import { CellView } from "./generic-table-view";

const TIME_TEXT = /^\s?\d{1,2}:\d{2}(?::\d{2})?$/;

/** The cell with its text runs shortened; sign glyphs and daemon colour channels stay. */
function shortenSpeculumCell(cell: GenericTableCell, shortenText: (text: string) => string): GenericTableCell {
  return {
    ...cell,
    text: cell.text ? shortenText(cell.text) : cell.text,
    runs: cell.runs?.map((run) => run.glyph ? run : { ...run, text: shortenText(run.text) }),
  };
}

/** Shorten seconds, then minutes; retain sign glyphs and daemon colour channels. */
export function InspectorSpeculumAngle({
  cell, column, precision = "seconds", dynamicFit = false,
}: {
  cell?: GenericTableCell;
  column: string;
  precision?: InspectorSpeculumPrecision;
  dynamicFit?: boolean;
}) {
  if (!cell) return null;
  const time = column === "ra" || cell.angleTime === true;
  // `fitted` marks the fit's own shortened forms. Right ascension in time
  // (H:MM:SS) shortens there to H:MM and has no shorter form after that.
  const shorten = (level: InspectorSpeculumPrecision, fitted = false) => {
    const format = (text: string) => formatTableAngleText(
      text,
      fitted && level === "degrees" && time && TIME_TEXT.test(text) ? "minutes" : level,
      time,
    );
    return shortenSpeculumCell(cell, format);
  };
  // The fit's shortened values drop their finer units outright ("28°06'",
  // "28°"), the way a narrowing spreadsheet column drops decimals. No mark
  // replaces them: an ellipsis reads as clipped text and, about one em wide,
  // costs nearly the width the seconds freed. The cell title keeps the full value.
  const fullCell = precision === "seconds" ? cell : shorten(precision);
  const compactCell = precision === "seconds" ? shorten("minutes", true) : fullCell;
  const degreeCell = precision === "degrees" ? fullCell : shorten("degrees", true);
  return (
    <span data-speculum-angle={column}>
      <span className="aries-inspector-speculum-full-angle" data-speculum-variant={dynamicFit ? "seconds" : undefined}><CellView cell={fullCell} preserveAngleSeconds /></span>
      <span className="aries-inspector-speculum-compact-angle" data-speculum-variant={dynamicFit ? "minutes" : undefined} hidden={dynamicFit || undefined}><CellView cell={compactCell} preserveAngleSeconds /></span>
      <span className="aries-inspector-speculum-degree-angle" data-speculum-variant={dynamicFit ? "degrees" : undefined} hidden={dynamicFit || undefined}><CellView cell={degreeCell} preserveAngleSeconds /></span>
    </span>
  );
}

/** Daily speed drops its seconds like a coordinate; only then may it break
 * before "/d" (the fit wraps speed after every column has lost its seconds). */
export function InspectorSpeculumSpeed({
  cell, precision = "seconds",
}: { cell?: GenericTableCell; precision?: InspectorSpeculumPrecision }) {
  if (!cell) return null;
  const displayCell = cell.text && precision !== "seconds"
    ? { ...cell, text: formatTableAngleText(cell.text, precision) }
    : cell;
  const compactCell = cell.text && precision === "seconds"
    ? { ...cell, text: formatTableAngleText(cell.text, "minutes") }
    : displayCell;
  const dailyParts = compactCell.text?.match(/^(.+['′°])((?:\d{2}["″])?\/d)$/);
  return (
    <>
      <span className="aries-inspector-speculum-full-speed"><CellView cell={displayCell} preserveAngleSeconds /></span>
      <span className="aries-inspector-speculum-compact-speed"><CellView cell={compactCell} preserveAngleSeconds /></span>
      <span className="aries-inspector-speculum-wrapped-speed">
        {dailyParts ? (
          <><CellView cell={{ ...compactCell, text: dailyParts[1] }} preserveAngleSeconds /><wbr /><CellView cell={{ ...compactCell, text: dailyParts[2] }} preserveAngleSeconds /></>
        ) : <CellView cell={compactCell} preserveAngleSeconds />}
      </span>
    </>
  );
}
