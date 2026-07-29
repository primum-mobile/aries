// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { Clipboard, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PaneSelect } from "@/components/workshell/list-controls";
import {
  useSettledWorkspaceRefreshState,
  workspaceSemanticRefreshSeq,
  type WorkspaceSessionChange,
} from "@/components/workshell/step-refresh";
import {
  buildStableRowKeys,
  filterRetainedRowsByHiddenIds,
} from "@/components/workshell/stitched-list-harness";
import {
  ASPECT_LIST_PERFECTION_CONCURRENCY,
  ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS,
  advanceAspectListCursorTracker,
  aspectListQueryIdentity,
  aspectListRequestedMode,
  aspectListRetainedWorldIdentity,
  aspectListVirtualWindow,
  isAspectListPayloadCurrent,
  nextAspectListPerfectionBatches,
  retainMatchingAspectListPerfections,
  selectRetainedAspectListPayloadState,
  type AspectListCursorTracker,
} from "@/lib/aspect-list-live-state.mjs";
import {
  defaultAspectListSecondaryRingIncluded,
  isAspectListRowIncluded,
  isAspectListSecondaryRingFilterId,
} from "@/lib/aspect-list-filter-state.mjs";
import {
  fetchAspectList,
  fetchAspectListPerfections,
  openAspectListPerfection,
  type AspectListMode,
  type AspectListFilter,
  type AspectListPayload,
  type AspectListPerfection,
  type AspectListPerfectionAction,
  type AspectListPhase,
  type AspectListRow,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import {
  LIST_BUTTON_PROPS,
  LIST_PANE_CLASSES,
  LIST_ROW_CLASSES,
  useFixedRowHeightAnchor,
  useListRowHeight,
} from "@/lib/list-tokens";
import {
  forgetListPayload,
  getCachedListPayload,
  rememberListPayload,
} from "@/lib/table/payload-cache";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import { beginWorkspaceSnapshotCommand } from "@/stores/workspace-command-snapshot-gate";
import { useWorkspaceStore } from "@/stores/workspace-store";

import {
  SidebarListBody,
  SidebarListCell,
  SidebarListDateCell,
  SidebarListHead,
  SidebarListHeader,
  SidebarListRow,
  SidebarListSortHeader,
  SidebarListSpacerRow,
  SidebarListTable,
  SidebarListTimeCell,
} from "./sidebar-list-table";

const CACHE_NAMESPACE = "aspect-list";
const DEFAULT_MAX_ORB = 10;
const ORB_OPTIONS = [1, 2, 3, 5, 7, 10, 15] as const;
const OVERSCAN_ROWS = 8;
const EMPTY_FILTER_IDS: readonly string[] = Object.freeze([]);
const EMPTY_ROW_ID_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_PERFECTION_MAP = new Map<string, AspectListPerfection>();

type AspectListSort = "body" | "orb" | "exact";
type SortDirection = "asc" | "desc";
type AspectListPerfectionState = {
  identity: string;
  byRow: Map<string, AspectListPerfection>;
  failedRowIds: Set<string>;
};
type AspectListCachedWorld = {
  payload: AspectListPayload;
  perfectionState: AspectListPerfectionState | null;
  scrollTop: number;
};
type AspectListPayloadState = {
  documentId: string;
  worldIdentity: string;
  payload: AspectListPayload;
  queryIdentity: string | null;
  actionIdentity: string | null;
};

function sameRowIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((rowId, index) => rowId === right[index]);
}

function relevantSessionSeq(
  change: WorkspaceSessionChange | null,
  documentId: string,
  parentDocumentId?: string | null,
): number {
  if (!change || change.listDataChanged === false) return 0;
  const ids = parentDocumentId ? [documentId, parentDocumentId] : [documentId];
  const touchesDocument =
    (change.docId !== null && ids.includes(change.docId)) ||
    change.rebuiltChildIds.some((id) => ids.includes(id));
  return touchesDocument
    ? change.seq
    : 0;
}

/**
 * The websocket session event is authoritative for normal chart stepping. The
 * focus prop is a quiet fallback for a missed/coalesced cursor notification:
 * it never starts a request during a held-key burst, and it reuses the same
 * list effect rather than creating a parallel fetch path.
 */
function useAspectListCursorFallbackSeq({
  documentId,
  parentDocumentId,
  focusDatetime,
  lastSessionChange,
}: {
  documentId: string;
  parentDocumentId?: string | null;
  focusDatetime: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
}): number {
  const sessionSeq = relevantSessionSeq(lastSessionChange, documentId, parentDocumentId);
  const trackedRef = React.useRef<AspectListCursorTracker>({
    documentId,
    focusDatetime,
    sessionSeq,
    pendingStepSeq: 0,
    pendingStepAt: 0,
  });
  const [fallbackSeq, setFallbackSeq] = React.useState(0);

  React.useEffect(() => {
    const transition = advanceAspectListCursorTracker(trackedRef.current, {
      documentId,
      focusDatetime,
      sessionSeq,
      sessionChangeReason: lastSessionChange?.changeReason ?? null,
      now: window.performance.now(),
    });
    trackedRef.current = transition.tracker;
    if (!transition.scheduleFallback) return;
    const timer = window.setTimeout(() => {
      const tracked = trackedRef.current;
      if (tracked.documentId !== documentId || tracked.focusDatetime === focusDatetime) return;
      trackedRef.current = {
        ...tracked,
        focusDatetime,
        sessionSeq: Math.max(tracked.sessionSeq, sessionSeq),
        pendingStepSeq: 0,
        pendingStepAt: 0,
      };
      setFallbackSeq((value) => value + 1);
    }, ASPECT_LIST_CURSOR_FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [documentId, focusDatetime, lastSessionChange?.changeReason, sessionSeq]);

  return fallbackSeq;
}

/**
 * Comparison view toggles publish a command snapshot but intentionally do not
 * fan out a second daemon session event. Establish the first observed shape as
 * the document baseline; later shape changes bump the one canonical list load.
 */
function useAspectListContextRevisionSeq(
  documentId: string,
  contextRevision: string | null,
): number {
  const trackedRef = React.useRef({ documentId, contextRevision });
  const [revisionSeq, setRevisionSeq] = React.useState(0);

  React.useEffect(() => {
    const tracked = trackedRef.current;
    if (tracked.documentId !== documentId) {
      trackedRef.current = { documentId, contextRevision };
      return;
    }
    if (contextRevision === null || tracked.contextRevision === contextRevision) return;
    if (tracked.contextRevision === null) {
      tracked.contextRevision = contextRevision;
      return;
    }
    tracked.contextRevision = contextRevision;
    queueMicrotask(() => setRevisionSeq((value) => value + 1));
  }, [contextRevision, documentId]);

  return revisionSeq;
}

/**
 * Row actions become inert as soon as the daemon reports a relevant session
 * mutation or the presented comparison grammar changes. This generation is
 * deliberately separate from the settled fetch generation: it changes on the
 * cheap event render, while the replacement payload still waits for burst
 * settle.
 */
function useAspectListActionIdentity({
  documentId,
  parentDocumentId,
  contextRevision,
  lastSessionChange,
}: {
  documentId: string;
  parentDocumentId?: string | null;
  contextRevision: string | null;
  lastSessionChange: WorkspaceSessionChange | null;
}): string {
  const rawSessionSeq = relevantSessionSeq(lastSessionChange, documentId, parentDocumentId);
  const [tracked, setTracked] = React.useState<{
    documentId: string;
    sessionSeq: number;
    contextRevision: string | null;
    contextSeq: number;
  }>(() => ({
    documentId,
    sessionSeq: rawSessionSeq,
    contextRevision,
    contextSeq: 0,
  }));
  const sameDocument = tracked.documentId === documentId;
  const sessionSeq = sameDocument
    ? Math.max(tracked.sessionSeq, rawSessionSeq)
    : rawSessionSeq;
  const contextChanged =
    sameDocument &&
    contextRevision !== null &&
    tracked.contextRevision !== null &&
    contextRevision !== tracked.contextRevision;
  const contextSeq = sameDocument
    ? tracked.contextSeq + (contextChanged ? 1 : 0)
    : 0;
  const resolvedContextRevision =
    contextRevision ?? (sameDocument ? tracked.contextRevision : null);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTracked((current) => {
        if (
          current.documentId === documentId &&
          current.sessionSeq === sessionSeq &&
          current.contextRevision === resolvedContextRevision &&
          current.contextSeq === contextSeq
        ) {
          return current;
        }
        return {
          documentId,
          sessionSeq,
          contextRevision: resolvedContextRevision,
          contextSeq,
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [contextSeq, documentId, resolvedContextRevision, sessionSeq]);

  return `${documentId}\u0000${sessionSeq}\u0000${contextSeq}`;
}

function compareBodyEndpoints(
  left: AspectListRow["left"],
  right: AspectListRow["left"],
): number {
  return (
    left.sortOrder - right.sortOrder ||
    left.name.localeCompare(right.name) ||
    left.key.localeCompare(right.key)
  );
}

function compareBodyRows(left: AspectListRow, right: AspectListRow): number {
  return (
    compareBodyEndpoints(left.left, right.left) ||
    compareBodyEndpoints(left.right, right.right) ||
    left.aspect.type - right.aspect.type ||
    left.orb - right.orb ||
    left.id.localeCompare(right.id)
  );
}

function compareOrbRows(left: AspectListRow, right: AspectListRow): number {
  return left.orb - right.orb || compareBodyRows(left, right);
}

function phaseLabel(phase: AspectListPhase, t: ReturnType<typeof useT>): string {
  if (phase === "exact") return t("aspectList.exact");
  if (phase === "applying") return t("aspectList.applying");
  if (phase === "separating") return t("aspectList.separating");
  return t("aspectList.noPhase");
}

function compactPhaseLabel(phase: AspectListPhase, t: ReturnType<typeof useT>): string {
  if (phase === "exact") return t("aspectList.exact");
  if (phase === "applying") return t("aspectList.applyingShort");
  if (phase === "separating") return t("aspectList.separatingShort");
  return "";
}

function shortClockTime(value?: string | null): string {
  if (!value) return "";
  return value.match(/^(\d{1,2}:\d{2})/)?.[1] ?? value;
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Tauri/Chromium can reject a focused menu write; use the DOM fallback.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard write was blocked");
}

function AspectGlyph({
  item,
  title,
}: {
  item: {
    glyph: string;
    glyphFont: string;
    color?: string | null;
    colorRole?: string | null;
  };
  title: string;
}) {
  return (
    <span
      className={cn(
        "aries-search-glyph inline-flex shrink-0 items-center justify-center leading-none",
        item.glyphFont !== "morinus" && "font-morinus-text",
      )}
      style={{
        color: semanticChartColor(item.colorRole, item.color),
        fontFamily: item.glyphFont === "morinus" ? "'AriesMorinus'" : undefined,
      }}
      title={title}
      aria-label={title}
      role="img"
    >
      {item.glyph}
    </span>
  );
}

function AspectEndpoint({ item }: { item: AspectListRow["left"] }) {
  const marker = item.displayMarker?.trim() ?? "";
  const motionMarker = item.motionMarker?.trim() ?? "";
  const markerSuffix = marker ? ` ${marker}` : "";
  const visibleName =
    markerSuffix && item.name.endsWith(markerSuffix)
      ? item.name.slice(0, -markerSuffix.length)
      : item.name;
  const segments = item.displaySegments ?? [];
  const title = motionMarker ? `${item.name} ${motionMarker}` : item.name;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[var(--aries-control-gap-compact)]"
      title={title}
    >
      {segments.length ? (
        <span className="inline-flex items-center gap-[calc(var(--aries-control-gap-compact)/2)]">
          {segments.map((segment, index) =>
            segment.kind === "planet" || segment.kind === "glyph" ? (
              <AspectGlyph
                key={`${index}:${segment.text}`}
                item={{
                  glyph: segment.text,
                  glyphFont: "morinus",
                  color: item.color,
                  colorRole: item.colorRole,
                }}
                title={item.name}
              />
            ) : (
              <span key={`${index}:${segment.text}`} className="shrink-0">
                {segment.text}
              </span>
            ),
          )}
        </span>
      ) : item.glyph ? (
        <AspectGlyph item={item} title={item.name} />
      ) : (
        <span className="aries-list-secondary-text">{visibleName}</span>
      )}
      {marker ? (
        <span className="aries-list-secondary-text shrink-0">
          {marker}
        </span>
      ) : null}
      {motionMarker ? (
        <span className="aries-search-marker shrink-0 text-muted-foreground">
          {motionMarker}
        </span>
      ) : null}
    </span>
  );
}

function AspectListFilterDrawer({
  items,
  focusedIds,
  focusMatchMode,
  rxFocusEnabled,
  activeSecondaryRing,
  includeActiveSecondaryRing,
  onToggleFocus,
  onFocusMatchModeChange,
  onToggleRxFocus,
  onClearFocus,
  onToggleSecondaryRing,
}: {
  items: AspectListFilter[];
  focusedIds: ReadonlySet<string>;
  focusMatchMode: "or" | "and";
  rxFocusEnabled: boolean;
  activeSecondaryRing: AspectListPayload["activeSecondaryRing"];
  includeActiveSecondaryRing: boolean;
  onToggleFocus: (id: string) => void;
  onFocusMatchModeChange: (mode: "or" | "and") => void;
  onToggleRxFocus: () => void;
  onClearFocus: () => void;
  onToggleSecondaryRing: () => void;
}) {
  const t = useT();
  const focusItems = items.filter(
    (item) => !isAspectListSecondaryRingFilterId(item.id),
  );
  const canUseAnd = focusedIds.size >= 2;
  return (
    <div className="w-full max-h-48 overflow-auto border-t border-border/70 pt-2">
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
            {t("aspectList.focus")}
          </span>
          <Button
            type="button"
            size="xs"
            variant={focusedIds.size === 0 && !rxFocusEnabled ? "default" : "outline"}
            aria-pressed={focusedIds.size === 0 && !rxFocusEnabled}
            title={t("aspectList.allFocusTitle")}
            onClick={onClearFocus}
          >
            {t("tlview.all")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={rxFocusEnabled ? "default" : "outline"}
            aria-pressed={rxFocusEnabled}
            title={t("aspectList.retrogradeFocusTitle")}
            onClick={onToggleRxFocus}
          >
            {t("aspectList.retrogradeFocus")}
          </Button>
          <div className={LIST_PANE_CLASSES.segmented} aria-label={t("aspectList.focus")}>
            <Button
              type="button"
              size="xs"
              variant={focusMatchMode === "or" ? "secondary" : "ghost"}
              className={cn(
                LIST_PANE_CLASSES.segmentedButton,
                "text-xs",
                focusMatchMode === "or" ? "" : "text-muted-foreground",
              )}
              aria-pressed={focusMatchMode === "or"}
              title={t("aspectList.matchAnyTitle")}
              onClick={() => onFocusMatchModeChange("or")}
            >
              {t("aspectList.matchAnyShort")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={focusMatchMode === "and" ? "secondary" : "ghost"}
              className={cn(
                LIST_PANE_CLASSES.segmentedButton,
                "text-xs",
                focusMatchMode === "and" ? "" : "text-muted-foreground",
              )}
              aria-pressed={focusMatchMode === "and"}
              title={t(
                canUseAnd
                  ? "aspectList.matchBothTitle"
                  : "aspectList.matchBothDisabledTitle",
              )}
              disabled={!canUseAnd}
              onClick={() => onFocusMatchModeChange("and")}
            >
              {t("aspectList.matchBothShort")}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span aria-hidden className="mr-1 min-w-14" />
          {focusItems.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="xs"
              variant={focusedIds.has(item.id) ? "default" : "outline"}
              aria-pressed={focusedIds.has(item.id)}
              onClick={() => onToggleFocus(item.id)}
              className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
            >
              {item.glyph ? <AspectGlyph item={item} title={item.label} /> : null}
              <span className="truncate">{item.label}</span>
            </Button>
          ))}
        </div>
        {activeSecondaryRing ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="mr-1 min-w-14 text-[length:var(--aries-font-size-section)] text-muted-foreground">
              {t("aspectList.include")}
            </span>
            <Button
              type="button"
              size="xs"
              variant={includeActiveSecondaryRing ? "default" : "outline"}
              aria-pressed={includeActiveSecondaryRing}
              onClick={onToggleSecondaryRing}
              className="h-6 max-w-44 justify-start gap-1 px-2 text-[length:var(--aries-font-size-small)]"
            >
              <span className="truncate">{activeSecondaryRing.label}</span>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AspectListRowContextMenu({
  row,
  perfection,
  active,
  actionsEnabled,
  opening,
  onOpenPerfection,
  children,
}: {
  row: AspectListRow;
  perfection?: AspectListPerfection;
  active: boolean;
  actionsEnabled: boolean;
  opening: boolean;
  onOpenPerfection: (row: AspectListRow, action?: AspectListPerfectionAction) => void;
  children: React.ReactElement;
}) {
  const t = useT();
  const ready = Boolean(
    perfection?.status === "ready" &&
      perfection.exactJd != null &&
      perfection.exactDatetime &&
      perfection.exactDate &&
      perfection.exactTime,
  );
  const timedDisabled = !actionsEnabled || !ready || opening;
  const aspectLabel = `${row.left.name} ${row.aspect.name} ${row.right.name}`;
  const copyTime = React.useCallback(() => {
    if (timedDisabled || !perfection?.exactDate || !perfection.exactTime) return;
    void copyText(`${perfection.exactDate} ${perfection.exactTime}`).catch((error) =>
      console.error("[aspect-list-copy-time]", error),
    );
  }, [perfection, timedDisabled]);

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      {active ? (
        <ContextMenuContent className="w-64">
          <ContextMenuItem
            disabled={timedDisabled}
            onClick={() => onOpenPerfection(row, "exact")}
          >
            {t("aspectList.openPerfection", { aspect: aspectLabel })}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={timedDisabled}
            onClick={() => onOpenPerfection(row, "solar")}
          >
            {t("dirview.openContainingSolarRevolution")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={timedDisabled}
            onClick={() => onOpenPerfection(row, "transits")}
          >
            {t("dirview.openAsTransit")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={timedDisabled}
            onClick={() => onOpenPerfection(row, "chart")}
          >
            {t("dirview.openAsChart")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={timedDisabled} onClick={copyTime}>
            <Clipboard className="size-[var(--aries-control-icon-size)]" />
            {t("tlview.copyTimeDate")}
          </ContextMenuItem>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

export function AspectListPanel({
  documentId,
  parentDocumentId,
  preferencesDocumentId,
  sourceName,
  focusDatetime,
  contextRevision,
  comparisonVisible,
  onClose,
}: {
  /** Live chart-session document whose current state owns the list query. */
  documentId: string;
  parentDocumentId?: string | null;
  /** Stable pane owner used only for retained chooser/sort preferences. */
  preferencesDocumentId: string;
  sourceName: string;
  focusDatetime?: string | null;
  /** Comparison/session shape not covered by a daemon session event. */
  contextRevision?: string | null;
  /** Whether the current presentation exposes the comparison role. */
  comparisonVisible?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const preferences = useWorkspaceStore(
    (state) =>
      state.aspectListPreferencesByDocument[preferencesDocumentId] ??
      state.sidebarListPreferenceDefaults?.aspectList,
  );
  const setPreferences = useWorkspaceStore((state) => state.setAspectListPreferences);
  const applyTimedChartOpenResult = useWorkspaceStore((state) => state.applyTimedChartOpenResult);
  const showRadix = useWorkspaceStore((state) => state.timedChartShowRadix);
  const selectedMode = preferences?.mode ?? null;
  const maxOrb = preferences?.maxOrb ?? DEFAULT_MAX_ORB;
  const sortBy = preferences?.sortBy ?? "orb";
  const sortDirection = preferences?.sortDirection ?? "asc";
  const focusedFilterIds = preferences?.focusedFilterIds ?? EMPTY_FILTER_IDS;
  const focusMatchMode = preferences?.focusMatchMode ?? "or";
  const rxFocusEnabled = preferences?.rxFocusEnabled ?? false;
  const secondaryRingEnabledByMode =
    preferences?.secondaryRingEnabledByMode ?? {};
  const filterDrawerOpen = preferences?.filterDrawerOpen ?? false;
  // TAB is a presentation lens. Preserve the user's comparison-mode choice
  // while the ring is hidden, but query the singleton's primary chart.
  const requestedMode = aspectListRequestedMode(
    selectedMode,
    comparisonVisible,
  ) as AspectListMode | null;
  const lastSessionChange = useDaemonWorkspaceStore((state) => state.lastSessionChange);
  const lastOptionsChange = useDaemonWorkspaceStore(
    (state) => state.lastRetainedDataOptionsChange,
  );
  const hiddenObjectIds = useDaemonWorkspaceStore(
    (state) => state.retainedListDisplay.hiddenObjectIds,
  );
  const lastOptionsChangeRef = React.useRef(lastOptionsChange);
  React.useLayoutEffect(() => {
    lastOptionsChangeRef.current = lastOptionsChange;
  }, [lastOptionsChange]);
  const refreshState = useSettledWorkspaceRefreshState({
    documentId,
    parentDocumentId,
    lastSessionChange,
    lastOptionsChange,
  });
  const refreshSeq = workspaceSemanticRefreshSeq(refreshState);
  const cursorFallbackSeq = useAspectListCursorFallbackSeq({
    documentId,
    parentDocumentId,
    focusDatetime: focusDatetime ?? null,
    lastSessionChange,
  });
  const contextRevisionSeq = useAspectListContextRevisionSeq(
    documentId,
    contextRevision ?? null,
  );
  const actionGeneration = useAspectListActionIdentity({
    documentId,
    parentDocumentId,
    contextRevision: contextRevision ?? null,
    lastSessionChange,
  });
  const actionIdentity = `${actionGeneration}\u0000${focusDatetime ?? "no-focus"}`;
  const actionIdentityRef = React.useRef(actionIdentity);
  React.useLayoutEffect(() => {
    actionIdentityRef.current = actionIdentity;
  }, [actionIdentity]);
  const [retrySeq, setRetrySeq] = React.useState(0);
  const [bootstrapRetainedListDataKey, setBootstrapRetainedListDataKey] =
    React.useState<string | null>(null);
  const queryIdentity = aspectListQueryIdentity({
    documentId,
    mode: requestedMode,
    refreshSeq,
    cursorFallbackSeq,
    contextRevisionSeq,
    retrySeq,
  });
  const retainedListDataKey =
    lastOptionsChange?.retainedListDataKey ??
    bootstrapRetainedListDataKey;
  const retainedWorldIdentity = aspectListRetainedWorldIdentity({
    documentId,
    mode: requestedMode,
    contextRevision: contextRevision ?? null,
    focusDatetime: focusDatetime ?? null,
    sessionMutationSeq: refreshState.immediateSessionSeq,
    retainedListDataKey,
  });
  const cachedWorld = getCachedListPayload<AspectListCachedWorld>(
    CACHE_NAMESPACE,
    retainedWorldIdentity,
  );
  const [storedPayloadState, setPayloadState] =
    React.useState<AspectListPayloadState | null>(() => {
    return cachedWorld
      ? {
          documentId,
          worldIdentity: retainedWorldIdentity,
          payload: cachedWorld.payload,
          queryIdentity,
          actionIdentity,
        }
      : null;
  });
  const payloadState = React.useMemo(
    () =>
      selectRetainedAspectListPayloadState({
        storedState: storedPayloadState,
        cachedPayload: cachedWorld?.payload ?? null,
        documentId,
        worldIdentity: retainedWorldIdentity,
        queryIdentity,
        actionIdentity,
      }) as AspectListPayloadState | null,
    [
      actionIdentity,
      cachedWorld,
      documentId,
      queryIdentity,
      retainedWorldIdentity,
      storedPayloadState,
    ],
  );
  const payload = payloadState?.payload ?? null;
  const payloadStateRef = React.useRef(payloadState);
  React.useLayoutEffect(() => {
    payloadStateRef.current = payloadState;
  }, [payloadState]);
  const payloadDocumentId = payloadState?.documentId ?? null;
  const payloadIsCurrent = isAspectListPayloadCurrent(
    payloadState,
    documentId,
    queryIdentity,
    actionIdentity,
  );
  const [storedPerfectionState, setPerfectionState] =
    React.useState<AspectListPerfectionState | null>(() => {
      return cachedWorld?.perfectionState ?? null;
    });
  const perfectionState =
    storedPayloadState?.worldIdentity === retainedWorldIdentity
      ? storedPerfectionState
      : cachedWorld?.perfectionState ?? storedPerfectionState;
  const perfectionStateRef = React.useRef(perfectionState);
  React.useLayoutEffect(() => {
    perfectionStateRef.current = perfectionState;
  }, [perfectionState]);
  const [pendingPerfectionState, setPendingPerfectionState] = React.useState<{
    identity: string;
    rowIds: Set<string>;
  } | null>(null);
  const [visiblePerfectionRowIds, setVisiblePerfectionRowIds] = React.useState<
    readonly string[]
  >([]);
  const [perfectionScheduleSeq, setPerfectionScheduleSeq] = React.useState(0);
  const [requestLoading, setLoading] = React.useState(payload === null);
  const [error, setError] = React.useState<string | null>(null);
  const [perfectionError, setPerfectionError] = React.useState<string | null>(null);
  const [openingRowId, setOpeningRowId] = React.useState<string | null>(null);
  const requestSeqRef = React.useRef(0);
  const nextPerfectionRequestIdRef = React.useRef(0);
  const activePerfectionRequestsRef = React.useRef(
    new Map<
      number,
      {
        identity: string;
        controller: AbortController;
        rowIds: readonly string[];
      }
    >(),
  );
  const currentWorldAvailable =
    payloadState?.worldIdentity === retainedWorldIdentity;
  const loading =
    currentWorldAvailable
      ? false
      : requestLoading || error === null;

  // The render above selects the exact cached world synchronously, so it is
  // visible before paint. Quietly adopt it as local state afterward; this keeps
  // later progressive exact-result merges based on the restored map.
  React.useEffect(() => {
    if (!cachedWorld) return;
    if (
      storedPayloadState?.worldIdentity === retainedWorldIdentity &&
      storedPayloadState.queryIdentity === queryIdentity &&
      storedPayloadState.actionIdentity === actionIdentity &&
      storedPayloadState.payload === cachedWorld.payload
    ) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPayloadState({
        documentId,
        worldIdentity: retainedWorldIdentity,
        payload: cachedWorld.payload,
        queryIdentity,
        actionIdentity,
      });
      setPerfectionState(cachedWorld.perfectionState);
      setPendingPerfectionState(null);
      setPerfectionError(null);
      setLoading(false);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    actionIdentity,
    cachedWorld,
    documentId,
    queryIdentity,
    retainedWorldIdentity,
    storedPayloadState,
  ]);

  React.useEffect(() => {
    const controller = new AbortController();
    const requestSeq = ++requestSeqRef.current;
    const requestActionIdentity = actionIdentityRef.current;
    const cached = getCachedListPayload<AspectListCachedWorld>(
      CACHE_NAMESPACE,
      retainedWorldIdentity,
    );
    if (cached) {
      return () => controller.abort();
    }
    queueMicrotask(() => {
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
      setLoading(true);
      setError(null);
    });

    const load = async () => {
      let next: AspectListPayload;
      try {
        next = await fetchAspectList(documentId, requestedMode, controller.signal);
      } catch (firstError) {
        if (controller.signal.aborted || !requestedMode) throw firstError;
        next = await fetchAspectList(documentId, null, controller.signal);
      }
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
      const canonicalWorldIdentity = aspectListRetainedWorldIdentity({
        documentId,
        mode: requestedMode,
        contextRevision: contextRevision ?? null,
        focusDatetime: focusDatetime ?? null,
        sessionMutationSeq: refreshState.immediateSessionSeq,
        retainedListDataKey: next.retainedListDataKey,
      });
      const previousPayloadState = payloadStateRef.current;
      const previousPayload = previousPayloadState?.payload;
      const previousPerfections = perfectionStateRef.current;
      if (
        lastOptionsChangeRef.current?.refreshMode === "house-system" &&
        previousPayload &&
        previousPayloadState?.documentId === documentId &&
        previousPerfections?.identity ===
          `${documentId}\u0000${previousPayload.activeMode}\u0000${previousPayload.contextKey}`
      ) {
        const nextIdentity =
          `${documentId}\u0000${next.activeMode}\u0000${next.contextKey}`;
        setPerfectionState({
          identity: nextIdentity,
          byRow: retainMatchingAspectListPerfections({
            previousRows: previousPayload.rows,
            nextRows: next.rows,
            previousByRow: previousPerfections.byRow,
          }),
          failedRowIds: new Set<string>(),
        });
        setPendingPerfectionState({
          identity: nextIdentity,
          rowIds: new Set<string>(),
        });
      }
      rememberListPayload<AspectListCachedWorld>(
        CACHE_NAMESPACE,
        canonicalWorldIdentity,
        {
          payload: next,
          perfectionState:
            previousPerfections?.identity ===
            `${documentId}\u0000${next.activeMode}\u0000${next.contextKey}`
              ? previousPerfections
              : null,
          scrollTop:
            getCachedListPayload<AspectListCachedWorld>(
              CACHE_NAMESPACE,
              canonicalWorldIdentity,
            )?.scrollTop ?? 0,
        },
      );
      if (canonicalWorldIdentity !== retainedWorldIdentity) {
        const canonicalWorld = getCachedListPayload<AspectListCachedWorld>(
          CACHE_NAMESPACE,
          canonicalWorldIdentity,
        );
        if (canonicalWorld) {
          rememberListPayload(
            CACHE_NAMESPACE,
            retainedWorldIdentity,
            canonicalWorld,
          );
        }
      }
      if (canonicalWorldIdentity !== retainedWorldIdentity) {
        setBootstrapRetainedListDataKey(next.retainedListDataKey);
      }
      setPayloadState({
        documentId,
        worldIdentity: retainedWorldIdentity,
        payload: next,
        queryIdentity,
        actionIdentity: requestActionIdentity,
      });
      setPerfectionError(null);
      setLoading(false);
      setError(null);
    };

    void load().catch((cause: unknown) => {
      if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : t("aspectList.failed"));
    });
    return () => controller.abort();
  }, [
    contextRevisionSeq,
    contextRevision,
    cursorFallbackSeq,
    documentId,
    focusDatetime,
    queryIdentity,
    requestedMode,
    refreshSeq,
    refreshState.immediateSessionSeq,
    retainedWorldIdentity,
    retrySeq,
    t,
  ]);

  const perfectionIdentity =
    payload && payloadDocumentId
      ? `${payloadDocumentId}\u0000${payload.activeMode}\u0000${payload.contextKey}`
      : null;
  const perfectionByRow = React.useMemo(
    () =>
      perfectionIdentity && perfectionState?.identity === perfectionIdentity
        ? perfectionState.byRow
        : new Map<string, AspectListPerfection>(),
    [perfectionIdentity, perfectionState],
  );
  const failedPerfectionRowIds =
    perfectionIdentity && perfectionState?.identity === perfectionIdentity
      ? perfectionState.failedRowIds
      : EMPTY_ROW_ID_SET;
  const pendingPerfectionRowIds =
    perfectionIdentity && pendingPerfectionState?.identity === perfectionIdentity
      ? pendingPerfectionState.rowIds
      : EMPTY_ROW_ID_SET;
  const hiddenObjectIdSet = React.useMemo(
    () => new Set(hiddenObjectIds),
    [hiddenObjectIds],
  );
  const visibleFilterItems = React.useMemo(
    () =>
      (payload?.filters ?? []).filter(
        (item) => !hiddenObjectIdSet.has(item.id),
      ),
    [hiddenObjectIdSet, payload?.filters],
  );
  const availableFocusIds = React.useMemo(
    () =>
      new Set(
        visibleFilterItems
          .filter((item) => !isAspectListSecondaryRingFilterId(item.id))
          .map((item) => item.id),
      ),
    [visibleFilterItems],
  );
  const effectiveFocusedFilterIdSet = React.useMemo(
    () => new Set(focusedFilterIds.filter((id) => availableFocusIds.has(id))),
    [availableFocusIds, focusedFilterIds],
  );
  const activeSecondaryRing = payload?.activeSecondaryRing ?? null;
  const activePointFocusCount = focusedFilterIds.reduce(
    (count, id) => count + (availableFocusIds.has(id) ? 1 : 0),
    0,
  );
  const effectiveFocusMatchMode =
    activePointFocusCount >= 2 && focusMatchMode === "and" ? "and" : "or";
  const activeSecondaryRingFilterIds = React.useMemo(
    () => new Set(activeSecondaryRing?.filterIds ?? []),
    [activeSecondaryRing?.filterIds],
  );
  const includeActiveSecondaryRing = activeSecondaryRing
    ? (
        secondaryRingEnabledByMode[activeSecondaryRing.id] ??
        defaultAspectListSecondaryRingIncluded(activeSecondaryRing.id)
      )
    : false;
  const displayRows = React.useMemo(
    () =>
      filterRetainedRowsByHiddenIds(
        payload?.rows ?? [],
        hiddenObjectIds,
        (row) => row.filterIds,
      ),
    [hiddenObjectIds, payload?.rows],
  );
  const candidateRows = React.useMemo(
    () =>
      displayRows.filter(
        (row) =>
          row.orb <= maxOrb &&
          isAspectListRowIncluded(
            row.filterIds,
            effectiveFocusedFilterIdSet,
            activeSecondaryRingFilterIds,
            includeActiveSecondaryRing,
            [row.left.motionMarker, row.right.motionMarker],
            rxFocusEnabled,
            effectiveFocusMatchMode,
            [row.left.filterIds, row.right.filterIds],
          ),
      ),
    [
      activeSecondaryRingFilterIds,
      displayRows,
      effectiveFocusedFilterIdSet,
      includeActiveSecondaryRing,
      maxOrb,
      rxFocusEnabled,
      effectiveFocusMatchMode,
    ],
  );
  const sortPerfectionByRow =
    sortBy === "exact" ? perfectionByRow : EMPTY_PERFECTION_MAP;
  const rows = React.useMemo(() => {
    return [...candidateRows].sort((left, right) => {
      if (sortBy === "exact") {
        const leftPerfection = sortPerfectionByRow.get(left.id);
        const rightPerfection = sortPerfectionByRow.get(right.id);
        const leftJd =
          leftPerfection?.status === "ready" && Number.isFinite(leftPerfection.exactJd)
            ? leftPerfection.exactJd ?? null
            : null;
        const rightJd =
          rightPerfection?.status === "ready" && Number.isFinite(rightPerfection.exactJd)
            ? rightPerfection.exactJd ?? null
            : null;
        if (leftJd === null && rightJd === null) return compareBodyRows(left, right);
        if (leftJd === null) return 1;
        if (rightJd === null) return -1;
        const result = leftJd - rightJd || compareBodyRows(left, right);
        return sortDirection === "asc" ? result : -result;
      }
      const compare = sortBy === "body" ? compareBodyRows : compareOrbRows;
      const result = compare(left, right);
      return sortDirection === "asc" ? result : -result;
    });
  }, [candidateRows, sortBy, sortDirection, sortPerfectionByRow]);
  const rowKeys = React.useMemo(() => buildStableRowKeys(rows, (row) => row.id), [rows]);
  const candidateRowIds = React.useMemo(
    () => candidateRows.map((row) => row.id),
    [candidateRows],
  );
  const onVisiblePerfectionRowsChange = React.useCallback((rowIds: readonly string[]) => {
    setVisiblePerfectionRowIds((current) =>
      sameRowIds(current, rowIds) ? current : [...rowIds],
    );
  }, []);
  const modeOptions = payload?.modes ?? [
    { id: requestedMode ?? "primary", label: sourceName },
  ];
  // A context may temporarily fall back from the user's preferred comparison
  // mode. Display the daemon-resolved mode without rewriting that preference;
  // it becomes active again when the compatible comparison returns.
  const activeMode = payload?.activeMode ?? requestedMode ?? "primary";
  React.useEffect(() => {
    const activeRequests = activePerfectionRequestsRef.current;
    for (const [requestId, request] of activeRequests) {
      if (!payloadIsCurrent || request.identity !== perfectionIdentity) {
        request.controller.abort();
        activeRequests.delete(requestId);
      }
    }
  }, [payloadIsCurrent, perfectionIdentity]);

  React.useEffect(
    () => () => {
      for (const request of activePerfectionRequestsRef.current.values()) {
        request.controller.abort();
      }
      activePerfectionRequestsRef.current.clear();
    },
    [],
  );

  React.useEffect(() => {
    if (!payload || !payloadIsCurrent || !perfectionIdentity) return;

    const activeRequests = activePerfectionRequestsRef.current;
    const candidateIdSet = new Set(candidateRowIds);
    const priorityRowIds = visiblePerfectionRowIds.filter((rowId) =>
      candidateIdSet.has(rowId),
    );
    const desiredRowIds =
      sortBy === "exact" ? candidateIdSet : new Set(priorityRowIds);
    for (const [requestId, request] of activeRequests) {
      if (
        request.identity === perfectionIdentity &&
        !request.rowIds.some((rowId) => desiredRowIds.has(rowId))
      ) {
        request.controller.abort();
        activeRequests.delete(requestId);
      }
    }
    const activeForContext = [...activeRequests.values()].filter(
      (request) => request.identity === perfectionIdentity,
    );
    const availableSlots = ASPECT_LIST_PERFECTION_CONCURRENCY - activeForContext.length;
    if (availableSlots <= 0) return;

    const inFlightRowIds = new Set(activeForContext.flatMap((request) => request.rowIds));
    const batches = nextAspectListPerfectionBatches({
      priorityRowIds,
      backgroundRowIds: sortBy === "exact" ? candidateRowIds : [],
      resolvedRowIds: new Set(perfectionByRow.keys()),
      pendingRowIds: inFlightRowIds,
      failedRowIds: failedPerfectionRowIds,
      availableSlots,
    });
    if (batches.length === 0) return;

    setPendingPerfectionState({
      identity: perfectionIdentity,
      rowIds: new Set([
        ...activeForContext.flatMap((request) => request.rowIds),
        ...batches.flat(),
      ]),
    });

    for (const batch of batches) {
      const requestId = ++nextPerfectionRequestIdRef.current;
      const controller = new AbortController();
      activeRequests.set(requestId, {
        identity: perfectionIdentity,
        controller,
        rowIds: batch,
      });
      void fetchAspectListPerfections(
        documentId,
        payload.activeMode,
        maxOrb,
        payload.contextKey,
        controller.signal,
        batch,
      )
        .then((next) => {
          const activeRequest = activeRequests.get(requestId);
          if (controller.signal.aborted || activeRequest?.identity !== perfectionIdentity) return;
          if (next.contextKey !== payload.contextKey) {
            setPerfectionState((current) => {
              const byRow =
                current?.identity === perfectionIdentity
                  ? current.byRow
                  : new Map<string, AspectListPerfection>();
              const failedRowIds =
                current?.identity === perfectionIdentity
                  ? new Set(current.failedRowIds)
                  : new Set<string>();
              for (const rowId of batch) failedRowIds.add(rowId);
              return { identity: perfectionIdentity, byRow, failedRowIds };
            });
            return;
          }
          const returnedRowIds = new Set(next.rows.map((row) => row.rowId));
          setPerfectionState((current) => {
            const byRow =
              current?.identity === perfectionIdentity
                ? new Map(current.byRow)
                : new Map<string, AspectListPerfection>();
            for (const row of next.rows) byRow.set(row.rowId, row);
            const failedRowIds =
              current?.identity === perfectionIdentity
                ? new Set(current.failedRowIds)
                : new Set<string>();
            for (const rowId of batch) {
              if (!returnedRowIds.has(rowId)) failedRowIds.add(rowId);
            }
            return { identity: perfectionIdentity, byRow, failedRowIds };
          });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setPerfectionState((current) => {
            const byRow =
              current?.identity === perfectionIdentity
                ? current.byRow
                : new Map<string, AspectListPerfection>();
            const failedRowIds =
              current?.identity === perfectionIdentity
                ? new Set(current.failedRowIds)
                : new Set<string>();
            for (const rowId of batch) failedRowIds.add(rowId);
            return { identity: perfectionIdentity, byRow, failedRowIds };
          });
          setPerfectionError(
            cause instanceof Error ? cause.message : t("aspectList.perfectionFailed"),
          );
        })
        .finally(() => {
          activeRequests.delete(requestId);
          setPendingPerfectionState((current) => {
            if (current?.identity !== perfectionIdentity) return current;
            const rowIds = new Set(current.rowIds);
            for (const rowId of batch) rowIds.delete(rowId);
            return { identity: current.identity, rowIds };
          });
          setPerfectionScheduleSeq((value) => value + 1);
        });
    }
  }, [
    candidateRowIds,
    documentId,
    failedPerfectionRowIds,
    maxOrb,
    payload,
    payloadIsCurrent,
    perfectionByRow,
    perfectionIdentity,
    perfectionScheduleSeq,
    sortBy,
    t,
    visiblePerfectionRowIds,
  ]);

  React.useEffect(() => {
    if (
      !payload ||
      !payloadIsCurrent ||
      payloadState?.worldIdentity !== retainedWorldIdentity
    ) {
      return;
    }
    rememberListPayload<AspectListCachedWorld>(
      CACHE_NAMESPACE,
      retainedWorldIdentity,
      {
        payload,
        perfectionState:
          perfectionState?.identity === perfectionIdentity
            ? perfectionState
            : null,
        scrollTop:
          getCachedListPayload<AspectListCachedWorld>(
            CACHE_NAMESPACE,
            retainedWorldIdentity,
          )?.scrollTop ?? 0,
      },
    );
  }, [
    payload,
    payloadIsCurrent,
    payloadState?.worldIdentity,
    perfectionIdentity,
    perfectionState,
    retainedWorldIdentity,
  ]);
  const displayedWorldIdentity =
    payloadState?.worldIdentity ?? retainedWorldIdentity;
  const displayedWorldScrollTop =
    getCachedListPayload<AspectListCachedWorld>(
      CACHE_NAMESPACE,
      displayedWorldIdentity,
    )?.scrollTop ?? 0;
  const rememberDisplayedWorldScrollTop = React.useCallback(
    (scrollTop: number) => {
      const cached = getCachedListPayload<AspectListCachedWorld>(
        CACHE_NAMESPACE,
        displayedWorldIdentity,
      );
      if (!cached || Math.abs(cached.scrollTop - scrollTop) < 0.5) return;
      rememberListPayload<AspectListCachedWorld>(
        CACHE_NAMESPACE,
        displayedWorldIdentity,
        { ...cached, scrollTop },
      );
    },
    [displayedWorldIdentity],
  );

  const toggleFocus = React.useCallback(
    (id: string) => {
      const next = new Set(focusedFilterIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPreferences(preferencesDocumentId, { focusedFilterIds: [...next] });
    },
    [focusedFilterIds, preferencesDocumentId, setPreferences],
  );

  const clearFocus = React.useCallback(
    () =>
      setPreferences(preferencesDocumentId, {
        focusedFilterIds: [],
        focusMatchMode: "or",
        rxFocusEnabled: false,
      }),
    [preferencesDocumentId, setPreferences],
  );

  const toggleRxFocus = React.useCallback(
    () =>
      setPreferences(preferencesDocumentId, {
        rxFocusEnabled: !rxFocusEnabled,
      }),
    [preferencesDocumentId, rxFocusEnabled, setPreferences],
  );

  const setFocusMatchMode = React.useCallback(
    (mode: "or" | "and") => {
      if (mode === "and" && activePointFocusCount < 2) return;
      setPreferences(preferencesDocumentId, { focusMatchMode: mode });
    },
    [activePointFocusCount, preferencesDocumentId, setPreferences],
  );

  const onModeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const mode = event.target.value as AspectListMode;
      setError(null);
      setPreferences(preferencesDocumentId, { mode });
    },
    [preferencesDocumentId, setPreferences],
  );

  const onSort = React.useCallback(
    (nextSort: AspectListSort) => {
      setPreferences(preferencesDocumentId, {
        sortBy: nextSort,
        sortDirection:
          sortBy === nextSort ? (sortDirection === "asc" ? "desc" : "asc") : "asc",
      });
    },
    [preferencesDocumentId, setPreferences, sortBy, sortDirection],
  );

  const onOpenPerfection = React.useCallback(
    (row: AspectListRow, action: AspectListPerfectionAction = "exact") => {
      if (!payloadIsCurrent || !payload?.contextKey) return;
      const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
      setOpeningRowId(row.id);
      setPerfectionError(null);
      void openAspectListPerfection(documentId, payload.activeMode ?? activeMode,
        row.id,
        payload.contextKey,
        action,
        showRadix,
      )
        .then((result) => applyTimedChartOpenResult(result))
        .catch(() => setPerfectionError(t("aspectList.openFailed")))
        .finally(() => {
          setOpeningRowId(null);
          finishSnapshotCommand();
        });
    },
    [activeMode, applyTimedChartOpenResult, documentId, payload, payloadIsCurrent, showRadix, t],
  );

  return (
    <div className={cn("font-morinus-text", LIST_PANE_CLASSES.root)}>
      <div className={LIST_PANE_CLASSES.standardHeader}>
        <div className={LIST_PANE_CLASSES.titleRow}>
          <div className={LIST_PANE_CLASSES.titleLeading}>
            <Button
              type="button"
              {...LIST_BUTTON_PROPS.icon}
              onClick={onClose}
              aria-label={t("aspectList.close")}
            >
              <X className="size-3.5" />
            </Button>
            <h2 className={LIST_PANE_CLASSES.title}>{t("aspectList.title")}</h2>
          </div>
          <span className={LIST_PANE_CLASSES.metadata} aria-live="polite">
            {loading && payload
              ? t("aspectList.refreshing")
              : t("aspectList.count", { count: rows.length })}
          </span>
        </div>
        <div className={LIST_PANE_CLASSES.controlRow}>
          <label className={LIST_PANE_CLASSES.labeledControl}>
            <span className={LIST_PANE_CLASSES.controlLabel}>{t("aspectList.view")}</span>
            <PaneSelect
              value={activeMode}
              onChange={onModeChange}
              disabled={loading && !payload}
              aria-label={t("aspectList.view")}
            >
              {modeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </PaneSelect>
          </label>
          <label className={LIST_PANE_CLASSES.labeledControl}>
            <span className={LIST_PANE_CLASSES.controlLabel}>{t("aspectList.maximumOrb")}</span>
            <PaneSelect
              value={maxOrb}
              onChange={(event) =>
                setPreferences(preferencesDocumentId, { maxOrb: Number(event.target.value) })
              }
              aria-label={t("aspectList.maximumOrb")}
            >
              {ORB_OPTIONS.map((orb) => (
                <option key={orb} value={orb}>{orb}°</option>
              ))}
            </PaneSelect>
          </label>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            aria-expanded={filterDrawerOpen}
            onClick={() =>
              setPreferences(preferencesDocumentId, { filterDrawerOpen: !filterDrawerOpen })
            }
          >
            {t("aspectList.filter")}
          </Button>
        </div>
        {filterDrawerOpen ? (
          <AspectListFilterDrawer
            items={visibleFilterItems}
            focusedIds={effectiveFocusedFilterIdSet}
            focusMatchMode={effectiveFocusMatchMode}
            rxFocusEnabled={rxFocusEnabled}
            activeSecondaryRing={activeSecondaryRing}
            includeActiveSecondaryRing={includeActiveSecondaryRing}
            onToggleFocus={toggleFocus}
            onFocusMatchModeChange={setFocusMatchMode}
            onToggleRxFocus={toggleRxFocus}
            onClearFocus={clearFocus}
            onToggleSecondaryRing={() => {
              if (!activeSecondaryRing) return;
              setPreferences(preferencesDocumentId, {
                secondaryRingEnabledByMode: {
                  ...secondaryRingEnabledByMode,
                  [activeSecondaryRing.id]: !includeActiveSecondaryRing,
                },
              });
            }}
          />
        ) : null}
      </div>
      {error && payload ? (
        <div className={cn(LIST_PANE_CLASSES.error, "flex shrink-0 items-center gap-2 border-b border-border py-2")}>
          <span className="min-w-0 flex-1 truncate">{t("aspectList.failed")}</span>
          <Button
            type="button"
            {...LIST_BUTTON_PROPS.command}
            onClick={() => {
              forgetListPayload(CACHE_NAMESPACE, retainedWorldIdentity);
              setLoading(true);
              setError(null);
              setRetrySeq((value) => value + 1);
            }}
          >
            <RefreshCw />
            {t("aspectList.retry")}
          </Button>
        </div>
      ) : null}
      {perfectionError ? (
        <div className="shrink-0 border-b border-[color:var(--aries-border-subtle)] px-[var(--aries-pane-header-padding-x)] py-1.5 text-[length:var(--aries-font-size-small)] text-destructive">
          {t("aspectList.perfectionFailed")}
        </div>
      ) : null}
      {!payload ? (
        <div className={error ? LIST_PANE_CLASSES.error : LIST_PANE_CLASSES.loading}>
          {error ? t("aspectList.failed") : t("aspectList.loading")}
        </div>
      ) : (
        <AspectListTable
          rows={rows}
          rowKeys={rowKeys}
          maxOrb={maxOrb}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={onSort}
          perfectionByRow={perfectionByRow}
          pendingPerfectionRowIds={pendingPerfectionRowIds}
          failedPerfectionRowIds={failedPerfectionRowIds}
          perfectionsActive={payloadIsCurrent}
          onVisibleRowsChange={onVisiblePerfectionRowsChange}
          openingRowId={openingRowId}
          actionsEnabled={payloadIsCurrent && !loading}
          onOpenPerfection={onOpenPerfection}
          worldIdentity={displayedWorldIdentity}
          initialScrollTop={displayedWorldScrollTop}
          onScrollTopChange={rememberDisplayedWorldScrollTop}
        />
      )}
    </div>
  );
}

const AspectListTable = React.memo(function AspectListTable({
  rows,
  rowKeys,
  maxOrb,
  sortBy,
  sortDirection,
  onSort,
  perfectionByRow,
  pendingPerfectionRowIds,
  failedPerfectionRowIds,
  perfectionsActive,
  onVisibleRowsChange,
  openingRowId,
  actionsEnabled,
  onOpenPerfection,
  worldIdentity,
  initialScrollTop,
  onScrollTopChange,
}: {
  rows: AspectListRow[];
  rowKeys: string[];
  maxOrb: number;
  sortBy: AspectListSort;
  sortDirection: SortDirection;
  onSort: (sort: AspectListSort) => void;
  perfectionByRow: Map<string, AspectListPerfection>;
  pendingPerfectionRowIds: ReadonlySet<string>;
  failedPerfectionRowIds: ReadonlySet<string>;
  perfectionsActive: boolean;
  onVisibleRowsChange: (rowIds: readonly string[]) => void;
  openingRowId: string | null;
  actionsEnabled: boolean;
  onOpenPerfection: (row: AspectListRow, action?: AspectListPerfectionAction) => void;
  worldIdentity: string;
  initialScrollTop: number;
  onScrollTopChange: (scrollTop: number) => void;
}) {
  const t = useT();
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const rowHeight = useListRowHeight("symbolic");
  const [viewport, setViewport] = React.useState<{
    worldIdentity: string | null;
    scrollTop: number;
    height: number;
  }>({
    worldIdentity: null,
    scrollTop: 0,
    height: 0,
  });
  const [contextRowId, setContextRowId] = React.useState<string | null>(null);

  useFixedRowHeightAnchor(scrollerRef, rows.length, rowHeight);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () =>
      setViewport((current) => ({
        ...current,
        scrollTop: scroller.scrollTop,
        height: scroller.clientHeight,
      }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxTop = Math.max(0, rows.length * rowHeight - scroller.clientHeight);
    if (scroller.scrollTop > maxTop) scroller.scrollTop = maxTop;
  }, [rowHeight, rows.length]);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || viewport.worldIdentity === worldIdentity) return;
    const nextWindow = aspectListVirtualWindow({
      currentViewport: {
        scrollTop: scroller.scrollTop,
        height: scroller.clientHeight,
      },
      presentedWorldIdentity: viewport.worldIdentity,
      worldIdentity,
      initialScrollTop,
      rowCount: rows.length,
      rowHeight,
      overscanRows: OVERSCAN_ROWS,
    });
    scroller.scrollTop = nextWindow.scrollTop;
    setViewport({
      worldIdentity,
      scrollTop: scroller.scrollTop,
      height: scroller.clientHeight,
    });
  }, [
    initialScrollTop,
    rowHeight,
    rows.length,
    viewport.worldIdentity,
    worldIdentity,
  ]);

  const virtualWindow = aspectListVirtualWindow({
    currentViewport: viewport,
    presentedWorldIdentity: viewport.worldIdentity,
    worldIdentity,
    initialScrollTop,
    rowCount: rows.length,
    rowHeight,
    overscanRows: OVERSCAN_ROWS,
  });
  const { start, end } = virtualWindow;
  const visibleRows = React.useMemo(() => rows.slice(start, end), [end, rows, start]);
  const visibleRowIds = React.useMemo(
    () => visibleRows.map((row) => row.id),
    [visibleRows],
  );
  const topSpacer = start * rowHeight;
  const bottomSpacer = Math.max(0, (rows.length - end) * rowHeight);

  React.useEffect(() => {
    onVisibleRowsChange(visibleRowIds);
  }, [onVisibleRowsChange, visibleRowIds]);

  return (
    <div
      ref={scrollerRef}
      className={LIST_PANE_CLASSES.scroller}
      onScroll={(event) =>
        {
          const scrollTop = event.currentTarget.scrollTop;
          setViewport({
            worldIdentity,
            scrollTop,
            height: event.currentTarget.clientHeight,
          });
          onScrollTopChange(scrollTop);
        }
      }
    >
      <SidebarListTable profile="directions-titled">
        <SidebarListHeader className={LIST_PANE_CLASSES.stickyHeader}>
          <SidebarListRow>
            <SidebarListHead
              className="text-left"
              aria-sort={sortBy === "body" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
            >
              <SidebarListSortHeader
                label={t("aspectList.bodies")}
                ariaLabel={t("aspectList.sortBy", { label: t("aspectList.bodies") })}
                direction={sortBy === "body" ? sortDirection : null}
                align="left"
                onClick={() => onSort("body")}
              />
            </SidebarListHead>
            <SidebarListHead
              className="text-right"
              aria-sort={sortBy === "orb" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
            >
              <SidebarListSortHeader
                label={t("aspectList.orb")}
                ariaLabel={t("aspectList.sortBy", { label: t("aspectList.orb") })}
                direction={sortBy === "orb" ? sortDirection : null}
                align="right"
                onClick={() => onSort("orb")}
              />
            </SidebarListHead>
            <SidebarListHead
              colSpan={2}
              className="text-center"
              aria-sort={sortBy === "exact" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
            >
              <SidebarListSortHeader
                label={t("aspectList.perfection")}
                ariaLabel={t("aspectList.sortBy", { label: t("aspectList.perfection") })}
                direction={sortBy === "exact" ? sortDirection : null}
                align="center"
                onClick={() => onSort("exact")}
              />
            </SidebarListHead>
          </SidebarListRow>
        </SidebarListHeader>
        <SidebarListBody>
          {topSpacer > 0 ? (
            <SidebarListSpacerRow colSpan={4} height={topSpacer} />
          ) : null}
          {visibleRows.map((row, offset) => {
            const index = start + offset;
            const phase = phaseLabel(row.phase, t);
            const compactPhase = compactPhaseLabel(row.phase, t);
            const perfection = perfectionByRow.get(row.id);
            const perfectionReady =
              perfection?.status === "ready" &&
              perfection.exactDate &&
              perfection.exactTime &&
              perfection.exactDatetime;
            const perfectionLoading =
              perfectionsActive &&
              !failedPerfectionRowIds.has(row.id) &&
              (!perfection || pendingPerfectionRowIds.has(row.id));
            return (
              <AspectListRowContextMenu
                key={rowKeys[index] ?? row.id}
                row={row}
                perfection={perfection}
                active={contextRowId === row.id}
                actionsEnabled={actionsEnabled}
                opening={openingRowId === row.id}
                onOpenPerfection={onOpenPerfection}
              >
                <SidebarListRow
                  className={cn(LIST_ROW_CLASSES.flagged, "cursor-context-menu")}
                  style={{ height: rowHeight }}
                  onContextMenu={() => setContextRowId(row.id)}
                >
                  <SidebarListCell>
                    <span
                      className="inline-flex items-center gap-1 whitespace-nowrap"
                      aria-label={`${row.left.name}, ${row.aspect.name}, ${row.right.name}`}
                      title={`${row.left.name} ${row.aspect.name} ${row.right.name}`}
                    >
                      <AspectEndpoint item={row.left} />
                      <AspectGlyph item={row.aspect} title={row.aspect.name} />
                      <AspectEndpoint item={row.right} />
                    </span>
                  </SidebarListCell>
                  <SidebarListCell className="text-right tabular-nums">
                    <span className="inline-flex items-baseline justify-end gap-[var(--aries-control-gap-compact)]">
                      <span>{row.orbFormatted}</span>
                      {compactPhase ? (
                        <span className="aries-list-secondary-text" title={phase}>
                          {compactPhase}
                        </span>
                      ) : null}
                    </span>
                  </SidebarListCell>
                  {perfectionReady ? (
                    <>
                      <SidebarListDateCell>
                        <button
                          type="button"
                          className="tabular-nums underline-offset-2 hover:text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                          disabled={!actionsEnabled || openingRowId === row.id}
                          title={`${perfection.exactDate} ${perfection.exactTime}`}
                          aria-label={t("aspectList.openPerfection", {
                            aspect: `${row.left.name} ${row.aspect.name} ${row.right.name}`,
                          })}
                          onClick={() => onOpenPerfection(row)}
                        >
                          {perfection.exactDate}
                        </button>
                      </SidebarListDateCell>
                      <SidebarListTimeCell title={perfection.exactTime}>
                        {shortClockTime(perfection.exactTime)}
                      </SidebarListTimeCell>
                    </>
                  ) : (
                    <SidebarListCell
                      colSpan={2}
                      className="text-right text-[color:var(--aries-text-muted)]"
                      title={
                        perfectionLoading
                          ? t("aspectList.perfectionCalculating")
                          : perfection?.reason === "turns-away-before-perfection"
                            ? t("aspectList.perfectionTurnsAway")
                          : perfection?.reason === "search-horizon-exhausted"
                            ? t("aspectList.perfectionBeyondHorizon")
                          : perfection?.reason === "regime-change-before-perfection"
                            ? t("aspectList.perfectionRegimeChange")
                          : t("aspectList.perfectionUnavailable")
                      }
                    >
                      {perfectionLoading ? "…" : t("aspectList.notApplicable")}
                    </SidebarListCell>
                  )}
                </SidebarListRow>
              </AspectListRowContextMenu>
            );
          })}
          {bottomSpacer > 0 ? (
            <SidebarListSpacerRow colSpan={4} height={bottomSpacer} />
          ) : null}
          {rows.length === 0 ? (
            <SidebarListRow>
              <SidebarListCell colSpan={4} className="py-[var(--aries-pane-state-padding)] text-center text-[color:var(--aries-text-muted)]">
                {t("aspectList.empty", { orb: maxOrb })}
              </SidebarListCell>
            </SidebarListRow>
          ) : null}
        </SidebarListBody>
      </SidebarListTable>
    </div>
  );
});
