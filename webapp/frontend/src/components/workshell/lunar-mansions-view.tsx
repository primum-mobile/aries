// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isAbortError } from "@/lib/abort-error";
import {
  fetchGenericTablePayload,
  type GenericTablePayload,
  type GenericTableRow,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import {
  LIST_BUTTON_PROPS,
  LIST_PANE_CLASSES,
  LIST_ROLE_CLASSES,
  LIST_ROW_CLASSES,
  LIST_ROW_HEIGHT,
} from "@/lib/list-tokens";
import {
  getCachedGenericTablePayload,
  rememberGenericTablePayload,
} from "@/lib/table/payload-cache";
import { cn } from "@/lib/utils";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";

import { CellView } from "./generic-table-view";
import { useSettledWorkspaceRefreshSeq } from "./step-refresh";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string;
  onClose?: () => void;
};

const TABLE_ID = "lunar_mansions";

const COLUMN_KEYS = [
  "manzilTable.number",
  "manzilTable.arabic",
  "manzilTable.transliteration",
  "manzilTable.start",
  "manzilTable.stars",
] as const;

export function LunarMansionsView({ documentId, parentDocumentId, sourceName, onClose }: Props) {
  const t = useT();
  const [payload, setPayload] = React.useState<GenericTablePayload | null>(() =>
    getCachedGenericTablePayload(TABLE_ID, documentId),
  );
  const [error, setError] = React.useState<string | null>(null);
  const requestSeqRef = React.useRef(0);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const lastCurrentRowRef = React.useRef<string | null>(null);
  const lastSessionChange = useDaemonWorkspaceStore((state) => state.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore((state) => state.lastOptionsChange);
  const refreshSeq = useSettledWorkspaceRefreshSeq({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    fetchGenericTablePayload(TABLE_ID, documentId, controller.signal)
      .then((next) => {
        if (requestSeq !== requestSeqRef.current) return;
        rememberGenericTablePayload(TABLE_ID, documentId, next);
        setPayload(next);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal) || requestSeq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [documentId, refreshSeq]);

  const currentRowId = payload?.rows.find((row) => row.current)?.id ?? null;
  React.useLayoutEffect(() => {
    if (!currentRowId || currentRowId === lastCurrentRowRef.current) return;
    lastCurrentRowRef.current = currentRowId;
    const currentRow = scrollerRef.current?.querySelector<HTMLElement>(`[data-row-id="${currentRowId}"]`);
    currentRow?.scrollIntoView({ block: "center" });
  }, [currentRowId]);

  const mode = String(payload?.capabilities?.manzilZodiac ?? "auto");
  const modeLabel =
    mode === "sidereal"
      ? t("optmenu.alwaysSidereal")
      : mode === "tropical"
        ? t("optmenu.alwaysTropical")
        : t("optmenu.followChartZodiac");

  return (
    <div className={cn(LIST_PANE_CLASSES.root, "font-morinus-text")}>
      <div className={LIST_PANE_CLASSES.compactHeader}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className={cn(LIST_PANE_CLASSES.title, "truncate")}>{t("table.lunar_mansions")}</h2>
            {sourceName ? <span className={cn(LIST_PANE_CLASSES.metadata, "truncate")}>{sourceName}</span> : null}
          </div>
          <div className={LIST_PANE_CLASSES.metadata}>{modeLabel}</div>
        </div>
        {onClose ? (
          <Button type="button" {...LIST_BUTTON_PROPS.icon} onClick={onClose} aria-label={t("manzilTable.close")}>
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <div ref={scrollerRef} className={LIST_PANE_CLASSES.scroller}>
        {!payload ? (
          <div className={error ? LIST_PANE_CLASSES.error : "px-4 py-6 text-[12px] text-muted-foreground"}>
            {error ? t("manzilTable.loadFailed") : t("manzilTable.loading")}
          </div>
        ) : (
          <table className={cn("caption-bottom border-collapse", LIST_ROLE_CLASSES.standard)}>
            <thead className={LIST_PANE_CLASSES.stickyHeader}>
              <tr>
                {COLUMN_KEYS.map((key, index) => (
                  <th
                    key={key}
                    className={cn(
                      "aries-list-head-cell border-b text-left font-medium text-muted-foreground",
                      index === 0 && "text-right",
                      index === 1 && "text-right",
                      index === 3 && "text-center",
                    )}
                  >
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row) => (
                <MansionRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MansionRow({ row }: { row: GenericTableRow }) {
  const aliasesAr = Array.isArray(row.meta?.aliasesAr) ? row.meta.aliasesAr.join(" · ") : "";
  const aliasesTranslit = Array.isArray(row.meta?.aliasesTranslit)
    ? row.meta.aliasesTranslit.join(" · ")
    : "";
  return (
    <tr
      data-row-id={row.id}
      className={cn(
        "aries-list-row",
        LIST_ROW_CLASSES.hover,
        row.current && LIST_ROW_CLASSES.current,
      )}
      style={{ height: LIST_ROW_HEIGHT.standard }}
    >
      {row.cells.map((cell, index) => (
        <td
          key={`${row.id}:${index}`}
          className={cn(
            "aries-list-cell border-b border-border/55",
            index === 0 && "text-right tabular-nums",
            index === 1 && "text-right text-[17px] leading-none",
            index === 3 && "text-center tabular-nums",
          )}
          title={index === 1 ? aliasesAr : index === 2 ? aliasesTranslit : undefined}
        >
          <CellView cell={cell} />
        </td>
      ))}
    </tr>
  );
}
