// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { X } from "lucide-react";

import {
  fetchAscensionalSnapshot,
  type AscensionalListRow,
  type AscensionalSnapshotPayload,
} from "@/lib/daemon/client";
import { isAbortError } from "@/lib/abort-error";
import { LIST_ROLE_CLASSES } from "@/lib/list-tokens";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import type { WorkspaceDocument } from "@/stores/workspace-store";
import { PANE_CONTROL_CLASSES, PaneToolbarButton } from "./list-controls";
import { MundaneChartView } from "./mundane-chart-view";

type Props = {
  document: WorkspaceDocument;
};

export function AscensionalTransitsView({ document }: Props) {
  return (
    <div className="font-morinus-text flex h-full min-h-0 bg-background">
      <MundaneChartView
        documentId={document.id}
        parentDocumentId={document.parentDocumentId}
        sourceName={document.sourceName}
        refreshKey={`${document.ascensionalEventJd ?? ""}:${
          document.ascensionalEventPlace ? JSON.stringify(document.ascensionalEventPlace) : ""
        }`}
      />
    </div>
  );
}

type AscensionalTransitsPaneProps = {
  documentId: string;
  sourceName: string;
  ascensionalEventJd?: number | null;
  ascensionalEventPlace?: Record<string, unknown> | null;
  ascensionalFilterToActiveMoment?: boolean | null;
  ascensionalApplyPrecession?: boolean | null;
  onClose?: () => void;
};

type AscensionalTransitsPaneViewState = {
  filterToActive: boolean;
  scrollTop: number;
};

const ascensionalTransitsPaneViewStateCache = new Map<string, AscensionalTransitsPaneViewState>();

export function AscensionalTransitsPane({
  documentId,
  sourceName,
  ascensionalEventJd,
  ascensionalFilterToActiveMoment,
  onClose,
}: AscensionalTransitsPaneProps) {
  const t = useT();
  const cachedViewState = React.useMemo(
    () => ascensionalTransitsPaneViewStateCache.get(documentId) ?? null,
    [documentId],
  );
  const [filterToActive, setFilterToActive] = React.useState(
    cachedViewState?.filterToActive ?? ascensionalFilterToActiveMoment ?? true,
  );
  const [payload, setPayload] = React.useState<AscensionalSnapshotPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const filterToActiveRef = React.useRef(filterToActive);
  const restoredScrollTopRef = React.useRef(cachedViewState?.scrollTop ?? null);

  React.useEffect(() => {
    filterToActiveRef.current = filterToActive;
  }, [filterToActive]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    return () => {
      ascensionalTransitsPaneViewStateCache.set(documentId, {
        filterToActive: filterToActiveRef.current,
        scrollTop: scroller?.scrollTop ?? 0,
      });
    };
  }, [documentId]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAscensionalSnapshot(
      {
        documentId,
        sourceName,
        eventJd: ascensionalEventJd,
        filterToActiveMoment: filterToActive,
        applyPrecession: true,
      },
      controller.signal,
    )
      .then((nextPayload) => {
        setPayload(nextPayload);
        setError(null);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal)) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [
    documentId,
    sourceName,
    ascensionalEventJd,
    filterToActive,
  ]);

  React.useLayoutEffect(() => {
    const scrollTop = restoredScrollTopRef.current;
    if (scrollTop == null || !payload) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    restoredScrollTopRef.current = null;
    scroller.scrollTop = scrollTop;
  }, [payload]);

  return (
    <div className="font-morinus-text flex h-full min-h-0 flex-col bg-[color:var(--aries-surface)]">
      <div className={PANE_CONTROL_CLASSES.stackedHeader}>
        <div className="flex min-w-0 items-center justify-between gap-[var(--aries-pane-control-gap-y)]">
          <div className="min-w-0 truncate font-medium text-[color:var(--aries-text-primary)]">
            {t("asctransit.ascensionalTransits")}
          </div>
          {onClose ? (
            <PaneToolbarButton
              type="button"
              appearance="ghost"
              square
              onClick={onClose}
              aria-label={t("asctransit.closeAscensionalTransits")}
              className="shrink-0"
            >
              <X />
            </PaneToolbarButton>
          ) : null}
        </div>
        <div className="text-[color:var(--aries-text-muted)]">
          {payload?.event.datetime.isoUtc ?? t("asctransit.loadingEvent")}
          {payload ? ` UT · RAMC ${payload.event.ramc.toFixed(4)}°` : ""}
        </div>
        <label className="flex items-start gap-[var(--aries-pane-control-gap-y)] text-[color:var(--aries-text-primary)]">
          <input
            type="checkbox"
            checked={filterToActive}
            onChange={(event) => setFilterToActive(event.currentTarget.checked)}
            className="mt-0.5"
          />
          <span>
            {t("asctransit.twoTransitRule")}
            {payload ? (
              <span className="ml-1 text-[color:var(--aries-text-muted)]">
                {t("asctransit.activeEcliptic", { count: payload.activeEclipticAspects.length })}
              </span>
            ) : null}
          </span>
        </label>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto p-3">
        {error ? (
          <div className="text-[length:var(--aries-font-size-small)] text-destructive">
            {error}
          </div>
        ) : payload ? (
          <AscensionalRows rows={payload.list.rows} />
        ) : (
          <div className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
            {t("asctransit.loadingList")}
          </div>
        )}
      </div>
    </div>
  );
}

function AscensionalRows({ rows }: { rows: AscensionalListRow[] }) {
  return (
    <table className={cn(LIST_ROLE_CLASSES.dense, "border-collapse")}>
      <tbody>
        {rows.map((row, index) =>
          row.kind === "section" ? (
            <tr key={`section:${index}:${row.title}`}>
              <td
                colSpan={5}
                className="pt-2 text-[length:var(--aries-font-size-section)] font-medium text-[color:var(--aries-text-muted)]"
              >
                {row.title}
              </td>
            </tr>
          ) : (
            <tr
              key={`row:${index}:${row.transitGlyph}:${row.radixGlyph}:${row.orbText}`}
              className={cn(
                "aries-list-row border-b border-x-0 border-t-0",
                row.dim && "text-[color:var(--aries-text-muted)]",
              )}
            >
              <td className="aries-list-cell text-center"><GlyphText text={row.transitGlyph} font={row.transitFont} /></td>
              <td className="aries-list-cell text-center"><GlyphText text={row.aspectGlyph} font={row.aspectFont} /></td>
              <td className="aries-list-cell text-center"><GlyphText text={row.radixGlyph} font={row.radixFont} /></td>
              <td className="aries-list-cell text-right tabular-nums">{row.orbText}</td>
              <td className="aries-list-cell whitespace-nowrap text-[color:var(--aries-text-muted)]">
                {row.statusText}
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function GlyphText({ text, font }: { text: string; font?: string }) {
  return (
    <span
      className="whitespace-nowrap"
      style={font === "morinus" ? { fontFamily: "'AriesMorinus'" } : undefined}
      title={text}
    >
      {text}
    </span>
  );
}
