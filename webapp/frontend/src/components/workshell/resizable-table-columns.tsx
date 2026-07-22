// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { useT } from "@/lib/i18n/i18n";

const STORAGE_PREFIX = "aries.table-column-widths:v1:";
const DEFAULT_MIN_WIDTH = 28;

type ColumnWidths = Record<string, number>;

type UseResizableTableColumnsOptions = {
  storageKey: string;
  columnIds: readonly string[];
  minWidth?: number;
};

function captureHeaderWidths(
  header: HTMLElement | null,
  columnIds: readonly string[],
  minWidth: number,
): ColumnWidths {
  const row = header?.parentElement;
  if (!row) return {};
  const cells = Array.from(row.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const captured: ColumnWidths = {};
  columnIds.forEach((columnId, index) => {
    const cell = cells[index];
    if (cell) captured[columnId] = Math.max(minWidth, Math.round(cell.getBoundingClientRect().width));
  });
  return captured;
}

function readColumnWidths(storageKey: string): ColumnWidths {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const widths: ColumnWidths = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        widths[key] = value;
      }
    });
    return widths;
  } catch {
    return {};
  }
}

function writeColumnWidths(storageKey: string, widths: ColumnWidths): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_PREFIX}${storageKey}`;
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Column widths are local chrome state; failing to persist is harmless.
  }
}

export function useResizableTableColumns({
  storageKey,
  columnIds,
  minWidth = DEFAULT_MIN_WIDTH,
}: UseResizableTableColumnsOptions) {
  const [widths, setWidths] = React.useState<ColumnWidths>(() => readColumnWidths(storageKey));

  const commitColumnWidths = React.useCallback(
    (next: ColumnWidths) => {
      setWidths(next);
      writeColumnWidths(storageKey, next);
    },
    [storageKey],
  );

  const setColumnWidth = React.useCallback(
    (columnId: string, width: number | null) => {
      setWidths((current) => {
        const next = { ...current };
        if (width == null) delete next[columnId];
        else next[columnId] = Math.max(minWidth, Math.round(width));
        writeColumnWidths(storageKey, next);
        return next;
      });
    },
    [minWidth, storageKey],
  );

  const hasWidths = React.useMemo(
    () => columnIds.length > 0 && columnIds.every((columnId) => widths[columnId] != null),
    [columnIds, widths],
  );

  const tableWidth = React.useMemo(() => {
    if (!hasWidths) return null;
    return columnIds.reduce((total, columnId) => total + Math.max(minWidth, widths[columnId] ?? minWidth), 0);
  }, [columnIds, hasWidths, minWidth, widths]);

  const getResizeHandleProps = React.useCallback(
    (columnId: string): React.HTMLAttributes<HTMLSpanElement> => ({
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        setColumnWidth(columnId, null);
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const header = (event.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
        const startX = event.clientX;
        const capturedWidths = captureHeaderWidths(header, columnIds, minWidth);
        const startWidths = columnIds.some((id) => widths[id] == null)
          ? { ...capturedWidths, ...widths }
          : { ...widths };
        const startWidth = startWidths[columnId] ?? header?.getBoundingClientRect().width ?? minWidth;
        const onPointerMove = (moveEvent: PointerEvent) => {
          const nextWidth = Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX));
          commitColumnWidths({ ...startWidths, [columnId]: nextWidth });
        };
        const onPointerUp = () => {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
        };
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp, { once: true });
      },
    }),
    [columnIds, commitColumnWidths, minWidth, setColumnWidth, widths],
  );

  const colGroup = React.useMemo(() => {
    if (!hasWidths) return null;
    return (
      <colgroup>
        {columnIds.map((columnId) => (
          <col key={columnId} style={{ width: `${Math.max(minWidth, widths[columnId] ?? minWidth)}px` }} />
        ))}
      </colgroup>
    );
  }, [columnIds, hasWidths, minWidth, widths]);

  const tableStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!tableWidth) return undefined;
    return { tableLayout: "fixed", width: `${tableWidth}px` };
  }, [tableWidth]);

  return {
    colGroup,
    getResizeHandleProps,
    hasWidths,
    tableClassName: hasWidths ? "aries-table--resized" : undefined,
    tableStyle,
  };
}

export function ColumnResizeHandle({
  columnId,
  getResizeHandleProps,
}: {
  columnId: string;
  getResizeHandleProps: (columnId: string) => React.HTMLAttributes<HTMLSpanElement>;
}) {
  const t = useT();
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={t("table.resizeColumn")}
      title={t("table.resizeColumnHint")}
      {...getResizeHandleProps(columnId)}
      className="group absolute inset-y-0 right-[-4px] z-20 flex w-2 cursor-col-resize touch-none select-none items-stretch justify-center"
    >
      <span className="my-1 w-[var(--aries-sash-rule-size)] bg-transparent transition-colors group-hover:bg-[color:var(--aries-border-subtle)] group-active:bg-primary" />
    </span>
  );
}
