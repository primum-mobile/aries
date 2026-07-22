// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type { GenericTableColumn, GenericTablePayload, GenericTableSection } from "@/lib/daemon/client";
import { LIST_ROLE_CLASSES } from "@/lib/list-tokens";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { CellView, alignClass } from "./generic-table-view";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";

// Channel 4 of the custom-table migration contract
// (doc/migration/parity-catalogue/custom-table-layouts.md): multi-section wx
// pages (midpointswnd.py:44-87 panel array; almutens, positions, misc, munpos,
// phasis) render as stacked panels, each with its own column header row. Panels
// flow left-to-right and wrap, mirroring the wx multi-column panel arrangement
// at wide widths while remaining responsive.
export function SectionedTableView({
  payload,
  onBindingChange,
}: {
  payload: GenericTablePayload;
  onBindingChange?: (binding: Record<string, unknown>) => Promise<void>;
}) {
  const sections = payload.sections ?? [];
  const topical = asTopicalCapability(payload.capabilities);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {topical && onBindingChange ? (
        <TopicSelector topical={topical} onBindingChange={onBindingChange} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-[var(--aries-pane-content-padding)]">
        <div className="flex flex-wrap items-start gap-[var(--aries-pane-content-padding)]">
          {sections.map((section) => (
            <SectionPanel key={section.id} section={section} unavailable={payload.unavailable} />
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
    </div>
  );
}

// Topic combobox for the topical almuten — wx AlmutenTopicalsFrame.namescb
// lists almutens.topicals.names and re-renders the grid for the chosen index
// (almutentopicalsframe.py:21-27,74-82). Selecting posts the topic binding,
// which the daemon round-trips and refetches.
function TopicSelector({
  topical,
  onBindingChange,
}: {
  topical: TopicalCapability;
  onBindingChange: (binding: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = React.useState(false);
  return (
    <div className="flex shrink-0 items-center gap-[var(--aries-pane-control-gap-y)] border-b border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface-subtle)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)]">
      <label
        className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]"
        htmlFor="almuten-topic"
      >
        {t("table.topic")}
      </label>
      <select
        id="almuten-topic"
        className="h-[var(--aries-control-height-small)] rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)]"
        value={String(topical.topic)}
        disabled={pending}
        onChange={(event) => {
          const topic = Number(event.target.value);
          setPending(true);
          void onBindingChange({ topic }).finally(() => setPending(false));
        }}
      >
        {topical.topics.map((option) => (
          <option key={option.id} value={String(option.id)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SectionPanel({
  section,
  unavailable,
}: {
  section: GenericTableSection;
  unavailable?: boolean;
}) {
  // wx draws every panel's header box even when its rows are all filtered
  // out (midpointswnd.py:179-186), so an empty section still shows headers.
  const hasHeaderLabels = section.columns.some((column) => column.label || column.headerGlyph);
  const columnIds = React.useMemo(
    () => section.columns.map((column) => column.id),
    [section.columns],
  );
  const tableResize = useResizableTableColumns({
    storageKey: `sectioned:${section.id}`,
    columnIds,
  });
  return (
    <div className="min-w-0">
      {section.title ? (
        <div className="mb-1 text-[length:var(--aries-font-size-small)] font-medium text-[color:var(--aries-text-muted)]">
          {section.title}
        </div>
      ) : null}
      <table
        className={cn(LIST_ROLE_CLASSES.standard, "border-collapse", tableResize.tableClassName)}
        style={tableResize.tableStyle}
      >
        {tableResize.colGroup}
        {hasHeaderLabels ? (
          <thead>
            <tr>
              {section.columns.map((column) => (
                <th
                  key={column.id}
                  className={cn(
                    "aries-list-head-cell relative border bg-[color:var(--aries-surface)] font-medium",
                    alignClass(column.align),
                  )}
                >
                  <ColumnHeader column={column} />
                  <ColumnResizeHandle
                    columnId={column.id}
                    getResizeHandleProps={tableResize.getResizeHandleProps}
                  />
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "aries-list-row aries-list-row--striped",
                row.current && "aries-list-row--current",
                row.emphasis === "strong" && "font-semibold",
              )}
            >
              {section.columns.map((column, index) => (
                <td
                  key={`${row.id}:${column.id}`}
                  className={cn(
                    "aries-list-cell border align-middle",
                    alignClass(row.cells[index]?.align ?? column.align),
                    unavailable && "text-[color:var(--aries-text-muted)]",
                  )}
                >
                  <CellView cell={row.cells[index]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Planet-glyph column header in the Morinus font with the wx per-planet color
// (almutenchartwnd.py:346-356; profectionswnd headerGlyph/colorHex channel).
function ColumnHeader({ column }: { column: GenericTableColumn }) {
  if (column.headerGlyph) {
    return (
      <span
        style={{
          fontFamily: "'AriesMorinus'",
          color: semanticChartColor(column.colorRole, column.colorHex),
        }}
      >
        {column.label}
      </span>
    );
  }
  return <>{column.label}</>;
}

type TopicalCapability = {
  topic: number;
  topics: { id: number; label: string }[];
};

function asTopicalCapability(capabilities?: Record<string, unknown>): TopicalCapability | null {
  const raw = capabilities?.almutenTopical;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const topicsRaw = record.topics;
  if (!Array.isArray(topicsRaw)) return null;
  const topics = topicsRaw
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      return { id: Number(item.id), label: String(item.label ?? item.id) };
    })
    .filter((entry) => Number.isFinite(entry.id));
  return { topic: Number(record.topic ?? 0), topics };
}
