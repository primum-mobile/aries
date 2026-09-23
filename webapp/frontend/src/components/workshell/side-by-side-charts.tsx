// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { memo, useCallback, useEffect, useState, type ComponentType } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { executeWorkspaceContextMenuAction, type WorkspaceStatePayload } from "@/lib/daemon/client";
import { fetchCachedDocumentSnapshot, getDocumentSnapshot } from "@/lib/chart/document-snapshot-cache";
import type { ChartRenderSnapshot, SideBySideView } from "@/lib/chart/types";
import type { WheelVerticalAlignment } from "@/lib/chart/outer-glyph-lane";
import { perfNow, recordChartPerf } from "@/lib/chart/perf";
import { createSplitPeerRefreshGate, splitSnapshotForDocument } from "@/lib/chart/side-by-side-refresh";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import { applyImmediateWorkspaceCommandResult, useDaemonWorkspaceView } from "@/stores/daemon-workspace-adapter";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { runWorkspaceDocumentSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { localizedWorkspaceDocumentTitle } from "@/stores/workspace-store";
import styles from "./side-by-side-charts.module.css";

export async function setSideBySideView(payload: Record<string, unknown>): Promise<void> {
  const startedAt = perfNow();
  const { result, isLatest } = await runWorkspaceDocumentSnapshotCommand(
    "workspace.side-by-side",
    () => executeWorkspaceContextMenuAction("workspace.set_side_by_side", payload),
  );
  if (isLatest) {
    applyImmediateWorkspaceCommandResult(result as WorkspaceStatePayload);
    recordChartPerf("chart-split-command", { ms: perfNow() - startedAt, side: payload.side ?? null });
  }
}

export function useSideBySideCommand() {
  const t = useT();
  return useCallback((payload: Record<string, unknown>) => {
    void setSideBySideView(payload).catch(() => window.alert(t("chartview.failed")));
  }, [t]);
}

type Surface = ComponentType<{
  chart: ChartRenderSnapshot;
  exportRegistrationEnabled?: boolean;
  appControlsEnabled?: boolean;
  wheelVerticalAlignment?: WheelVerticalAlignment;
}>;

function isSplitSnapshot(snapshot: ChartRenderSnapshot | null | undefined, documentId: string | null): boolean {
  const view = snapshot?.sideBySide;
  return Boolean(documentId && snapshot?.document?.documentId === documentId && view?.enabled &&
    (view.leftDocumentId === documentId || view.rightDocumentId === documentId));
}

/** Each slot retains its last coherent paint while a different document loads. */
const ChartSlot = memo(function ChartSlot({ documentId, active, current, revision, Surface }: {
  documentId: string | null;
  active: boolean;
  current: ChartRenderSnapshot | null;
  revision: number;
  Surface: Surface;
}) {
  const t = useT();
  const [retained, setRetained] = useState<ChartRenderSnapshot | null>(null);
  const [lastCandidate, setLastCandidate] = useState<ChartRenderSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  const cached = documentId ? getDocumentSnapshot(documentId) : undefined;
  const candidate = current ?? (isSplitSnapshot(cached, documentId) ? cached ?? null : null);
  if (candidate && candidate !== lastCandidate) {
    setLastCandidate(candidate);
    setRetained(candidate);
  }

  useEffect(() => {
    if (!documentId || active) return;
    let alive = true;
    let generation = 0;
    const shouldRefresh = createSplitPeerRefreshGate(documentId, () =>
      (getDocumentSnapshot(documentId)?.ringTaxonomy ?? []).flatMap((ring) => ring.documentId ? [ring.documentId] : []),
    );
    const refresh = () => {
      const request = ++generation;
      const startedAt = perfNow();
      void fetchCachedDocumentSnapshot(documentId).then((snapshot) => {
        if (!alive || request !== generation) return;
        setRetained(snapshot);
        setFailed(false);
        recordChartPerf("chart-split-peer-ready", { docId: documentId, ms: perfNow() - startedAt });
      }).catch(() => {
        if (alive && request === generation) setFailed(true);
      });
    };
    const cached = getDocumentSnapshot(documentId);
    if (!isSplitSnapshot(cached, documentId)) refresh();
    // Both visible wheels consume the same navigate response. Events remain
    // a fallback for external edits/options, never a per-step second request.
    const unsubscribe = useDaemonWorkspaceStore.subscribe((state, previous) => {
      const bundle = state.steppedSnapshot !== previous.steppedSnapshot
        ? state.steppedSnapshot?.snapshot : state.commandSnapshot !== previous.commandSnapshot
          ? state.commandSnapshot?.snapshot : undefined;
      if (bundle?.sideBySideSnapshots?.[documentId]) generation += 1;
      if (shouldRefresh(state, previous)) refresh();
    });
    return () => { alive = false; unsubscribe(); };
  }, [active, documentId, revision]);

  const shown = candidate && candidate !== lastCandidate ? candidate : retained;
  const ready = isSplitSnapshot(shown, documentId);
  if (!documentId) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">{t("chartview.openChart")}</div>;
  return (
    <div className="relative h-full min-h-0" aria-busy={!ready}>
      {shown ? <div className={cn("h-full", (!active || !ready) && "pointer-events-none")}>
        <Surface chart={shown} exportRegistrationEnabled={active && ready} wheelVerticalAlignment="upper" />
      </div> : null}
      {failed ? <div role="alert" className="absolute bottom-0 inset-x-0 p-2 text-sm text-destructive">{t("chartview.failed")}</div> : null}
    </div>
  );
});

export function SideBySideCharts({ chart, view, Surface }: {
  chart: ChartRenderSnapshot;
  view: SideBySideView;
  Surface: Surface;
}) {
  const t = useT();
  const command = useSideBySideCommand();
  const { documents } = useDaemonWorkspaceView();
  const summaries = useDaemonWorkspaceStore((state) => state.documents);
  const eligibleIds = new Set(summaries.filter((doc) => doc.hasChart).map((doc) => doc.documentId));
  const choices = documents.filter((doc) => eligibleIds.has(doc.id)).map((doc) => {
    const title = localizedWorkspaceDocumentTitle(doc, t);
    const name = doc.sourceName || title;
    return { id: doc.id, name, detail: title !== name ? title : "" };
  });
  return (
    <div className="grid h-full min-h-0 grid-cols-2 pt-[var(--titlebar-pane-pad-top)]" data-chart-view="side-by-side">
      {(["left", "right"] as const).map((side) => {
        const documentId = side === "left" ? view.leftDocumentId : view.rightDocumentId;
        const active = view.activeSide === side;
        const current = splitSnapshotForDocument(chart, documentId);
        const selected = choices.find((doc) => doc.id === documentId);
        return <section key={side} aria-label={t(`chartview.${side}`)} className="flex min-h-0 min-w-0 flex-col"
          onPointerDown={() => { if (!active) command({ side }); }}>
          <div className="flex shrink-0 justify-center px-[var(--aries-pane-header-padding-x)] py-[var(--aries-pane-header-compact-padding-y)]"
            onPointerDown={(event) => event.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm"
                className={cn(
                  "min-w-0 max-w-full shrink font-normal transition-colors duration-[var(--aries-motion-shell-duration)] ease-[var(--aries-motion-shell-ease)] motion-reduce:transition-none",
                  active ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground",
                )} />}>
                <span className="truncate">
                  {selected?.name ?? t("chartview.chooseChart")}
                  {selected?.detail ? <span className="text-muted-foreground"> · {selected.detail}</span> : null}
                </span>
                <ChevronDown aria-hidden="true" className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-max max-w-(--available-width)">
                <DropdownMenuRadioGroup value={documentId ?? ""}>
                  {choices.map((doc) => <DropdownMenuRadioItem key={doc.id} value={doc.id}
                    label={[doc.name, doc.detail].filter(Boolean).join(" ")} closeOnClick
                    onClick={() => { if (doc.id !== documentId || !active) command({ side, documentId: doc.id }); }}>
                    <span className="flex min-w-0 flex-col whitespace-normal">
                      <span>{doc.name}</span>
                      {doc.detail ? <span className="text-muted-foreground">{doc.detail}</span> : null}
                    </span>
                  </DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative min-h-0 flex-1">
            <ChartSlot documentId={documentId} active={active} current={current} revision={view.revision} Surface={Surface} />
            {active ? <div aria-hidden="true" className={styles.focusWash} /> : null}
          </div>
        </section>;
      })}
    </div>
  );
}
