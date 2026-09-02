// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import { isAbortError } from "@/lib/abort-error";
import {
  cancelTemporalMap,
  fetchTemporalMapContext,
  fetchTemporalMapGroups,
  fetchTemporalMapProgress,
  fetchTemporalMapTiles,
  formatTemporalMapJds,
  openTemporalMap,
  workspaceUpdateTableBinding,
  type TemporalConcurrenceGroup,
  type TemporalMapContext,
  type TemporalMapInstant,
  type TemporalMapGroupsResult,
  type TemporalMapLaneSpec,
  type TemporalMapLaneSnapshot,
  type TemporalMapTilesResult,
} from "@/lib/daemon/client";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { useDaemonWorkspaceStore } from "@/stores/daemon-workspace-store";
import type { TimeLordTableId } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

import { DirectionsView } from "./directions-view";
import { PaneSelect } from "./list-controls";
import { SynodicCycleListView } from "./synodic-cycle-list-view";
import {
  planetColorRole,
  temporalGroupColor,
  TemporalConfluenceLaneProvider,
  type TemporalConfluenceLaneLens,
} from "./temporal-confluence-context";
import {
  TemporalChronomap,
  type TemporalChronomapBand,
  type TemporalChronomapConcurrence,
  type TemporalChronomapCoverage,
  type TemporalChronomapLane,
  type TemporalChronomapTick,
  type TemporalChronomapViewport,
} from "./temporal-chronomap";
import { TimeLordPaneView } from "./time-lord-pane-view";
import { TransitListView } from "./transit-list-view";

type Props = {
  documentId: string;
  parentDocumentId?: string | null;
  sourceName?: string | null;
  focusDatetime?: string | null;
  className?: string;
};

type LaneSourceId =
  | "transits"
  | "synodic_cycles"
  | "primary_directions"
  | "secondary_progressions"
  | "minor_progressions"
  | "tertiary_progressions"
  | "circumambulation"
  | "zodiacal_releasing"
  | "firdaria"
  | "decennials"
  | "triplicity_directions"
  | "profection_periods";

type LaneSourceDefinition = {
  id: LaneSourceId;
  labelKey: string;
  groupKey: string;
};

type LaneLensEntry = {
  documentId: string;
  sourceId: LaneSourceId;
  lens: TemporalConfluenceLaneLens;
  signature: string;
};

const LANE_COUNT = 4;
const MAP_BIN_COUNT = 256;
const MAP_GROUP_LIMIT = 2000;
const MAP_EXACT_GROUP_SPAN_DAYS = 45;
const MAP_LENS_SETTLE_MS = 240;
const MAP_PROGRESS_INTERVAL_MS = 900;
const DEFAULT_LANE_SOURCES: readonly LaneSourceId[] = [
  "transits",
  "synodic_cycles",
  "zodiacal_releasing",
  "primary_directions",
];

const LANE_SOURCES: readonly LaneSourceDefinition[] = [
  {
    id: "transits",
    labelKey: "sidebar.action.transits",
    groupKey: "search.techniques",
  },
  {
    id: "synodic_cycles",
    labelKey: "table.synodic_cycles",
    groupKey: "search.techniques",
  },
  {
    id: "primary_directions",
    labelKey: "dirview.primaryDirections",
    groupKey: "search.techniques",
  },
  {
    id: "secondary_progressions",
    labelKey: "dirview.secondaryProgressions",
    groupKey: "search.techniques",
  },
  {
    id: "minor_progressions",
    labelKey: "supplementary.minor-progression",
    groupKey: "search.techniques",
  },
  {
    id: "tertiary_progressions",
    labelKey: "supplementary.tertiary-progression",
    groupKey: "search.techniques",
  },
  {
    id: "circumambulation",
    labelKey: "dirview.circumambulations",
    groupKey: "search.techniques",
  },
  {
    id: "zodiacal_releasing",
    labelKey: "table.zodiacal_releasing",
    groupKey: "sidebar.group.time-lords",
  },
  {
    id: "firdaria",
    labelKey: "table.firdaria",
    groupKey: "sidebar.group.time-lords",
  },
  {
    id: "decennials",
    labelKey: "table.decennials",
    groupKey: "sidebar.group.time-lords",
  },
  {
    id: "triplicity_directions",
    labelKey: "table.triplicity_directions",
    groupKey: "sidebar.group.time-lords",
  },
  {
    id: "profection_periods",
    labelKey: "table.profections_table",
    groupKey: "sidebar.group.time-lords",
  },
];

const SOURCE_BY_ID = new Map(LANE_SOURCES.map((source) => [source.id, source]));

export function TemporalConfluenceView({
  documentId,
  parentDocumentId,
  sourceName,
  focusDatetime,
  className,
}: Props) {
  const t = useT();
  const documents = useDaemonWorkspaceStore((state) => state.documents);
  const retainedDataOptionsChange = useDaemonWorkspaceStore(
    (state) => state.lastRetainedDataOptionsChange,
  );
  const comparisonDocument = React.useMemo(
    () => documents.find((document) => document.documentId === documentId) ?? null,
    [documentId, documents],
  );
  const chartDocumentId = parentDocumentId ?? documentId;
  const chartDocument = React.useMemo(
    () => documents.find((document) => document.documentId === chartDocumentId) ?? null,
    [chartDocumentId, documents],
  );
  const mapSemanticRevision = retainedDataOptionsChange
    && (
      retainedDataOptionsChange.refreshedDocumentIds.length === 0
      || retainedDataOptionsChange.refreshedDocumentIds.includes(chartDocumentId)
    )
    ? retainedDataOptionsChange.seq
    : 0;
  const persistedSources = React.useMemo(
    () => laneSourcesFromBinding(comparisonDocument?.tableBinding),
    [comparisonDocument?.tableBinding],
  );
  const persistedSourcesKey = persistedSources.join("|");
  const [laneSources, setLaneSources] = React.useState<LaneSourceId[]>(persistedSources);
  const [laneLenses, setLaneLenses] = React.useState<Record<string, LaneLensEntry>>({});
  const [mapContext, setMapContext] = React.useState<TemporalMapContext | null>(null);
  const [mapToken, setMapToken] = React.useState<string | null>(null);
  const [mapDisplaySources, setMapDisplaySources] =
    React.useState<LaneSourceId[]>(persistedSources);
  const [mapLanes, setMapLanes] = React.useState<TemporalMapLaneSnapshot[]>([]);
  const [mapTiles, setMapTiles] = React.useState<TemporalMapTilesResult | null>(null);
  const [mapViewport, setMapViewport] = React.useState<TemporalChronomapViewport | null>(null);
  const [mapTicks, setMapTicks] = React.useState<TemporalChronomapTick[]>([]);
  const [mapFocusInstant, setMapFocusInstant] = React.useState<TemporalMapInstant | null>(null);
  const [mapBuildSettled, setMapBuildSettled] = React.useState(true);
  const [laneFocusDatetimes, setLaneFocusDatetimes] = React.useState<Record<string, string>>({});
  const [groups, setGroups] = React.useState<TemporalConcurrenceGroup[]>([]);
  const [pinnedGroupId, setPinnedGroupId] = React.useState<string | null>(null);
  const [pinnedGroupSnapshot, setPinnedGroupSnapshot] =
    React.useState<TemporalConcurrenceGroup | null>(null);
  const pinnedGroupSnapshotRef = React.useRef<TemporalConcurrenceGroup | null>(null);
  const [pinnedRailTop, setPinnedRailTop] = React.useState<number | null>(null);
  const comparisonGridRef = React.useRef<HTMLDivElement | null>(null);
  const mapQuerySeqRef = React.useRef(0);
  const mapQueryControllerRef = React.useRef<AbortController | null>(null);
  const mapFocusControllerRef = React.useRef<AbortController | null>(null);
  const mapRevisionRef = React.useRef(-1);
  const mapViewportRef = React.useRef<TemporalChronomapViewport | null>(null);
  const mapDocumentRef = React.useRef<string | null>(null);
  const mapDisplayTokenRef = React.useRef<string | null>(null);
  const laneSourcesKey = laneSources.join("|");
  const mapLaneSpecs = React.useMemo(
    () => laneSources.map((sourceId, laneIndex) => {
      const laneId = `lane-${laneIndex + 1}`;
      const entry = laneLenses[laneId];
      return {
        laneId,
        sourceId,
        spec: {
          ...(entry?.documentId === chartDocumentId && entry.sourceId === sourceId
            ? entry.lens
            : {}),
          ...(sourceId === "transits" ? { includeOrbTemporal: true } : {}),
        },
      };
    }),
    [chartDocumentId, laneLenses, laneSources],
  );
  const settledMapLaneSpecs = useSettledTemporalLaneSpecs(mapLaneSpecs);
  const mapLaneLensesReady = laneSources.every((sourceId, laneIndex) => {
    const entry = laneLenses[`lane-${laneIndex + 1}`];
    return entry?.documentId === chartDocumentId && entry.sourceId === sourceId;
  });
  const mapWorldReady = mapLaneLensesReady
    && JSON.stringify(settledMapLaneSpecs) === JSON.stringify(mapLaneSpecs);
  React.useEffect(() => {
    pinnedGroupSnapshotRef.current = pinnedGroupSnapshot;
  }, [pinnedGroupSnapshot]);
  React.useEffect(() => {
    mapViewportRef.current = mapViewport;
  }, [mapViewport]);

  React.useEffect(() => {
    if (laneSourcesKey === persistedSourcesKey) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void workspaceUpdateTableBinding(
        documentId,
        {
          lanes: laneSources.map((sourceId, index) => ({
            id: `lane-${index + 1}`,
            sourceId,
          })),
        },
        null,
        controller.signal,
      ).catch((error: unknown) => {
        if (!isAbortError(error, controller.signal)) {
          console.error("[temporal-comparison-binding]", error);
        }
      });
    }, 100);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [documentId, laneSources, laneSourcesKey, persistedSourcesKey]);

  const effectiveSourceName = chartDocument?.sourceName || sourceName || "";
  const effectiveFocusDatetime =
    chartDocument?.displayDatetime ?? focusDatetime ?? comparisonDocument?.displayDatetime ?? undefined;
  const groupedSources = groupLaneSources(LANE_SOURCES);
  const title = t("temporalConfluence.title");
  const pinnedGroup = React.useMemo(
    () =>
      groups.find((group) => group.groupId === pinnedGroupId)
      ?? (pinnedGroupSnapshot?.groupId === pinnedGroupId ? pinnedGroupSnapshot : null),
    [groups, pinnedGroupId, pinnedGroupSnapshot],
  );
  const laneGroups = React.useMemo(
    () =>
      pinnedGroup && !groups.some((group) => group.groupId === pinnedGroup.groupId)
        ? [...groups, pinnedGroup]
        : groups,
    [groups, pinnedGroup],
  );
  const synchronizedFocusDatetime =
    mapFocusInstant?.canonicalQueryDatetime
    ?? mapContext?.focus.canonicalQueryDatetime
    ?? effectiveFocusDatetime;
  const ignoreLaneRows = React.useCallback(() => {}, []);
  const ignoreLaneCoverage = React.useCallback(() => {}, []);
  const reportLaneLens = React.useCallback(
    (laneId: string, lens: TemporalConfluenceLaneLens) => {
      const laneIndex = Number(laneId.slice("lane-".length)) - 1;
      const sourceId = laneSources[laneIndex];
      if (!sourceId) return;
      const normalized = normalizeTemporalLaneLens(lens);
      const signature = JSON.stringify(normalized);
      setLaneLenses((current) => {
        const existing = current[laneId];
        if (
          existing?.documentId === chartDocumentId
          && existing.sourceId === sourceId
          && existing.signature === signature
        ) return current;
        return {
          ...current,
          [laneId]: { documentId: chartDocumentId, sourceId, lens: normalized, signature },
        };
      });
    },
    [chartDocumentId, laneSources],
  );

  const pinGroup = React.useCallback(
    (groupId: string) => {
      setPinnedRailTop(null);
      setPinnedGroupId(groupId);
      setPinnedGroupSnapshot(
        groups.find((group) => group.groupId === groupId) ?? null,
      );
    },
    [groups],
  );

  React.useEffect(() => {
    if (!pinnedGroup) return undefined;
    const controller = new AbortController();
    const laneJds = laneSources.map((_, laneIndex) => {
      const laneId = `lane-${laneIndex + 1}`;
      return temporalLaneFocusJdUt(pinnedGroup, laneId, pinnedGroup.focusJdUt);
    });
    void formatTemporalMapJds(
      chartDocumentId,
      [pinnedGroup.focusJdUt, ...laneJds],
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted || result.instants.length < laneJds.length + 1) return;
      setMapFocusInstant(result.instants[0]);
      setLaneFocusDatetimes(Object.fromEntries(
        laneJds.map((_, laneIndex) => [
          `lane-${laneIndex + 1}`,
          result.instants[laneIndex + 1].canonicalQueryDatetime,
        ]),
      ));
    }).catch((error: unknown) => {
      if (!isAbortError(error, controller.signal)) {
        console.error("[temporal-map-group-focus]", error);
      }
    });
    return () => controller.abort();
  }, [chartDocumentId, laneSources, pinnedGroup]);

  React.useLayoutEffect(() => {
    if (!pinnedGroup) return undefined;
    const root = comparisonGridRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let frame = 0;
    const align = () => {
      if (cancelled) return;
      const located = pinnedGroup.participants
        .map((participant) => locatePinnedParticipant(root, participant.laneId, participant.rowId))
        .filter(isLocatedParticipant);
      if (located.length === pinnedGroup.participants.length) {
        const commonTop = Math.max(...located.map(({ scroller }) => scroller.getBoundingClientRect().top));
        const commonBottom = Math.min(
          ...located.map(({ scroller }) => scroller.getBoundingClientRect().bottom),
        );
        if (commonBottom > commonTop) {
          const targetY = commonTop + (commonBottom - commonTop) * 0.42;
          for (const { row, scroller } of located) {
            const rowRect = row.getBoundingClientRect();
            const delta = rowRect.top + rowRect.height / 2 - targetY;
            if (Math.abs(delta) > 1) {
              scroller.scrollTop += delta;
              scroller.dispatchEvent(new Event("aries:virtual-scroll-sync"));
              scroller.dispatchEvent(new Event("aries:time-lord-virtual-scroll-sync"));
            }
          }
          const nextRailTop = targetY - root.getBoundingClientRect().top;
          setPinnedRailTop((current) =>
            current != null && Math.abs(current - nextRailTop) < 0.5 ? current : nextRailTop,
          );
          return;
        }
      }
    };
    const scheduleAlign = () => {
      if (cancelled || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        align();
      });
    };
    const mutationObserver = new MutationObserver(scheduleAlign);
    mutationObserver.observe(root, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(scheduleAlign);
    resizeObserver.observe(root);
    scheduleAlign();
    return () => {
      cancelled = true;
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [pinnedGroup]);

  const replaceLaneSource = React.useCallback(
    (laneIndex: number, sourceId: LaneSourceId) => {
      if (laneSources[laneIndex] === sourceId || laneSources.includes(sourceId)) return;
      const next = laneSources.slice();
      next[laneIndex] = sourceId;
      setLaneSources(next);
      setLaneLenses((current) => {
        const laneId = `lane-${laneIndex + 1}`;
        if (!(laneId in current)) return current;
        const nextLenses = { ...current };
        delete nextLenses[laneId];
        return nextLenses;
      });
      setPinnedGroupId(null);
      setPinnedGroupSnapshot(null);
      setGroups([]);
      setLaneFocusDatetimes({});
    },
    [laneSources],
  );

  const loadMapViewport = React.useCallback(
    async (
      token: string,
      viewport: TemporalChronomapViewport,
      displaySources: readonly LaneSourceId[],
      signal: AbortSignal,
    ) => {
      const requestSeq = mapQuerySeqRef.current + 1;
      mapQuerySeqRef.current = requestSeq;
      const tickJds = temporalMapTickJds(viewport);
      const [tiles, groupResult, formatted] = await Promise.all([
        fetchTemporalMapTiles(
          {
            token,
            startJdUt: viewport.startJdUt,
            endJdUt: viewport.endJdUt,
            binCount: MAP_BIN_COUNT,
          },
          signal,
        ),
        fetchTemporalMapGroupPages(token, viewport, signal),
        formatTemporalMapJds(chartDocumentId, tickJds, signal),
      ]);
      if (signal.aborted || requestSeq !== mapQuerySeqRef.current) return;
      mapViewportRef.current = viewport;
      mapDisplayTokenRef.current = token;
      setMapViewport(viewport);
      setMapDisplaySources(displaySources.slice());
      setMapTiles(tiles);
      setMapLanes(tiles.coverage);
      setGroups(groupResult?.groups ?? []);
      setMapTicks(temporalMapTicksFromInstants(formatted.instants, viewport));
      const pinnedSnapshot = pinnedGroupSnapshotRef.current;
      if (pinnedSnapshot && groupResult) {
        const refreshed = groupResult.groups.find(
          (group) => group.groupId === pinnedSnapshot.groupId,
        );
        if (refreshed) {
          pinnedGroupSnapshotRef.current = refreshed;
          setPinnedGroupSnapshot(refreshed);
        } else if (shouldClearPinnedTemporalGroup(pinnedSnapshot, groupResult, viewport)) {
          pinnedGroupSnapshotRef.current = null;
          setPinnedGroupId(null);
          setPinnedGroupSnapshot(null);
          setLaneFocusDatetimes({});
          setPinnedRailTop(null);
        }
      }
      mapRevisionRef.current = Math.max(tiles.revision, groupResult?.revision ?? -1);
    },
    [chartDocumentId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    const documentChanged = mapDocumentRef.current !== chartDocumentId;
    void fetchTemporalMapContext(chartDocumentId, controller.signal)
      .then((context) => {
        if (controller.signal.aborted) return;
        setMapContext(context);
        setMapFocusInstant(context.focus);
        setPinnedGroupId(null);
        setPinnedGroupSnapshot(null);
        setLaneFocusDatetimes({});
        if (documentChanged) {
          mapDisplayTokenRef.current = null;
          setMapTiles(null);
          setMapLanes([]);
          setGroups([]);
          const lifeViewport = {
            startJdUt: context.birthJdUt,
            endJdUt: context.lifeEndJdUt,
          };
          mapViewportRef.current = lifeViewport;
          setMapViewport(lifeViewport);
          setMapTicks(temporalMapTicksFromInstants(
            [context.birth, context.lifeEnd],
            lifeViewport,
          ));
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error, controller.signal)) {
          console.error("[temporal-map-context]", error);
        }
      });
    return () => controller.abort();
  }, [chartDocumentId]);

  React.useEffect(() => {
    if (!mapWorldReady) return undefined;
    const controller = new AbortController();
    let openedToken: string | null = null;
    const sameDocument = mapDocumentRef.current === chartDocumentId;
    const retainedViewport = sameDocument ? mapViewportRef.current : null;
    mapDocumentRef.current = chartDocumentId;
    mapQueryControllerRef.current?.abort();
    mapFocusControllerRef.current?.abort();
    mapQuerySeqRef.current += 1;
    mapRevisionRef.current = -1;
    pinnedGroupSnapshotRef.current = null;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setMapToken(null);
      setMapBuildSettled(true);
      setPinnedGroupId(null);
      setPinnedGroupSnapshot(null);
      setLaneFocusDatetimes({});
      setPinnedRailTop(null);
      setGroups([]);
    });

    void openTemporalMap(
      {
        documentId: chartDocumentId,
        lanes: settledMapLaneSpecs,
        minimumLanes: 2,
        ...(retainedViewport
          ? {
              viewportStartJdUt: retainedViewport.startJdUt,
              viewportEndJdUt: retainedViewport.endJdUt,
            }
          : {}),
      },
      controller.signal,
    ).then((opened) => {
      if (controller.signal.aborted) {
        void cancelTemporalMap(opened.token).catch(() => {});
        return;
      }
      openedToken = opened.token;
      setMapToken(opened.token);
      if (mapDisplayTokenRef.current == null) {
        setMapLanes(opened.lanes);
      }
      setMapBuildSettled(opened.build.settled);
      mapRevisionRef.current = opened.revision;
      const viewport = boundedTemporalMapViewport(retainedViewport, opened.horizon);
      const openedSources = settledMapLaneSpecs.map(
        (lane) => lane.sourceId as LaneSourceId,
      );
      mapViewportRef.current = viewport;
      setMapViewport(viewport);
      const queryController = new AbortController();
      mapQueryControllerRef.current = queryController;
      void loadMapViewport(opened.token, viewport, openedSources, queryController.signal).catch(
        (error: unknown) => {
          if (!isAbortError(error, queryController.signal)) {
            console.error("[temporal-map-initial]", error);
          }
        },
      );
    }).catch((error: unknown) => {
      if (!isAbortError(error, controller.signal)) {
        console.error("[temporal-map-open]", error);
        setMapBuildSettled(true);
      }
    });

    return () => {
      controller.abort();
      mapQueryControllerRef.current?.abort();
      mapFocusControllerRef.current?.abort();
      if (openedToken) void cancelTemporalMap(openedToken).catch(() => {});
    };
  }, [chartDocumentId, loadMapViewport, mapSemanticRevision, mapWorldReady, settledMapLaneSpecs]);

  const handleMapViewportSettled = React.useCallback(
    (viewport: TemporalChronomapViewport) => {
      mapViewportRef.current = viewport;
      setMapViewport(viewport);
      if (!mapToken || !mapWorldReady) return;
      mapQueryControllerRef.current?.abort();
      const controller = new AbortController();
      mapQueryControllerRef.current = controller;
      setMapBuildSettled(false);
      void loadMapViewport(mapToken, viewport, laneSources, controller.signal).catch((error: unknown) => {
        if (!isAbortError(error, controller.signal)) {
          console.error("[temporal-map-viewport]", error);
        }
      });
    },
    [laneSources, loadMapViewport, mapToken, mapWorldReady],
  );

  const handleMapFocusSettled = React.useCallback(
    (focusJdUt: number, reason: string) => {
      if (reason !== "concurrence") {
        setPinnedGroupId(null);
        setPinnedGroupSnapshot(null);
        setLaneFocusDatetimes({});
      }
      mapFocusControllerRef.current?.abort();
      const controller = new AbortController();
      mapFocusControllerRef.current = controller;
      void formatTemporalMapJds(chartDocumentId, [focusJdUt], controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && result.instants[0]) {
            setMapFocusInstant(result.instants[0]);
          }
        })
        .catch((error: unknown) => {
          if (!isAbortError(error, controller.signal)) {
            console.error("[temporal-map-focus]", error);
          }
        });
    },
    [chartDocumentId],
  );

  React.useEffect(() => {
    if (!mapToken || mapBuildSettled || !mapWorldReady) return undefined;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const progress = await fetchTemporalMapProgress(mapToken, controller.signal);
        if (controller.signal.aborted) return;
        if (mapDisplayTokenRef.current === mapToken) {
          setMapLanes(progress.lanes);
        }
        setMapBuildSettled(progress.build.settled);
        if (progress.revision > mapRevisionRef.current && mapViewport) {
          await loadMapViewport(mapToken, mapViewport, laneSources, controller.signal);
        }
        if (!progress.build.settled && !controller.signal.aborted) {
          timer = window.setTimeout(poll, MAP_PROGRESS_INTERVAL_MS);
        }
      } catch (error: unknown) {
        if (!isAbortError(error, controller.signal)) {
          console.error("[temporal-map-progress]", error);
          timer = window.setTimeout(poll, MAP_PROGRESS_INTERVAL_MS * 2);
        }
      }
    };
    timer = window.setTimeout(poll, MAP_PROGRESS_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [laneSources, loadMapViewport, mapBuildSettled, mapToken, mapViewport, mapWorldReady]);

  const chronomapLanes = React.useMemo(
    () => buildChronomapLanes(mapDisplaySources, mapLanes, mapTiles, t),
    [mapDisplaySources, mapLanes, mapTiles, t],
  );
  const chronomapConcurrences = React.useMemo(
    () => buildChronomapConcurrences(groups, mapTiles, t("temporalConfluence.timeline")),
    [groups, mapTiles, t],
  );

  return (
    <section
      data-aries-surface="panel"
      className={cn(
        "font-morinus-text box-border flex h-full min-h-0 w-full min-w-0 flex-col bg-background pt-[var(--titlebar-h)]",
        className,
      )}
      aria-label={title}
    >
      <div className={cn(LIST_PANE_CLASSES.compactHeader, "shrink-0")}>
        <div className={LIST_PANE_CLASSES.titleGroup}>
          <h2 className={LIST_PANE_CLASSES.title}>{title}</h2>
          {effectiveSourceName ? (
            <span className={LIST_PANE_CLASSES.metadata}>{effectiveSourceName}</span>
          ) : null}
        </div>
      </div>
      <div className="grid shrink-0 min-w-0 grid-cols-4 border-b border-[color:var(--aries-border-subtle)]">
        {laneSources.map((sourceId, laneIndex) => {
          const laneLabel = t("temporalConfluence.listNumber", { number: laneIndex + 1 });
          return (
            <label
              key={`chooser:${laneIndex + 1}`}
              className="flex min-w-0 items-center gap-[var(--aries-control-gap)] border-r border-[color:var(--aries-border-subtle)] px-[var(--aries-pane-header-compact-padding-x)] py-[var(--aries-pane-header-padding-y)] last:border-r-0"
            >
              <span className={LIST_PANE_CLASSES.controlLabel}>{laneLabel}</span>
              <PaneSelect
                className="min-w-0 flex-1"
                value={sourceId}
                aria-label={`${laneLabel}: ${t("temporalConfluence.source")}`}
                onChange={(event) =>
                  replaceLaneSource(laneIndex, event.currentTarget.value as LaneSourceId)
                }
              >
                {groupedSources.map(([groupKey, sources]) => (
                  <optgroup key={groupKey} label={t(groupKey)}>
                    {sources.map((source) => (
                      <option
                        key={source.id}
                        value={source.id}
                        disabled={source.id !== sourceId && laneSources.includes(source.id)}
                      >
                        {t(source.labelKey)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </PaneSelect>
            </label>
          );
        })}
      </div>
      {mapContext ? (
        <TemporalChronomap
          lifeStartJdUt={mapContext.birthJdUt}
          lifeEndJdUt={mapContext.lifeEndJdUt}
          focusJdUt={mapFocusInstant?.jdUt ?? mapContext.focusJdUt}
          focusLabel={mapFocusInstant?.datetimeLabel ?? mapContext.focus.datetimeLabel}
          lanes={chronomapLanes}
          ticks={mapTicks}
          concurrences={chronomapConcurrences}
          labels={{
            map: t("temporalConfluence.timeline"),
            timeAxis: t("temporalConfluence.timeAxis"),
            scale: t("temporalConfluence.scale"),
            coverage: t("temporalConfluence.coverage"),
            pendingCoverage: t("temporalConfluence.coveragePending"),
            unknownCoverage: t("temporalConfluence.coverageUnknown"),
            presets: {
              life: t("temporalConfluence.scale.life"),
              decade: t("temporalConfluence.scale.decade"),
              year: t("temporalConfluence.scale.year"),
              month: t("temporalConfluence.scale.month"),
              week: t("temporalConfluence.scale.week"),
              day: t("temporalConfluence.scale.day"),
            },
          }}
          selectedConcurrenceId={pinnedGroupId}
          yearDays={mapContext.tropicalYearDays}
          onViewportSettled={handleMapViewportSettled}
          onFocusSettled={handleMapFocusSettled}
          onConcurrenceSelect={pinGroup}
        />
      ) : (
        <div
          className="h-[clamp(14rem,34vh,24rem)] shrink-0 border-b border-[color:var(--aries-border-subtle)]"
          aria-label={t("temporalConfluence.timeline")}
          aria-busy="true"
        />
      )}
      <div ref={comparisonGridRef} className="relative min-h-0 flex-1 overflow-hidden">
        {pinnedGroup && pinnedRailTop != null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-20 border-t opacity-55"
            style={{
              top: pinnedRailTop,
              borderColor: temporalGroupColor(pinnedGroup),
            }}
          />
        ) : null}
        <div className="grid h-full min-h-0 min-w-0 grid-cols-4">
          {laneSources.map((sourceId, laneIndex) => {
            const laneLabel = t("temporalConfluence.listNumber", { number: laneIndex + 1 });
            const laneId = `lane-${laneIndex + 1}`;
            return (
              <section
                key={laneId}
                className="flex min-h-0 min-w-0 flex-col border-r border-[color:var(--aries-border-subtle)] last:border-r-0"
                aria-label={laneLabel}
                data-comparison-lane={laneIndex + 1}
                data-comparison-lane-id={laneId}
                data-comparison-source={sourceId}
              >
                <div className="min-h-0 flex-1 overflow-hidden">
                  <TemporalConfluenceLaneProvider
                    laneId={laneId}
                    groups={laneGroups}
                    pinnedGroupId={pinnedGroupId}
                    onRowsChange={ignoreLaneRows}
                    onCoverageChange={ignoreLaneCoverage}
                    onLensChange={reportLaneLens}
                    onPinGroup={pinGroup}
                  >
                    <CanonicalComparisonLane
                      key={`${chartDocumentId}:${sourceId}`}
                      sourceId={sourceId}
                      documentId={chartDocumentId}
                      sourceName={effectiveSourceName}
                      sourcePath={chartDocument?.fpath ?? undefined}
                      focusDatetime={laneFocusDatetimes[laneId] ?? synchronizedFocusDatetime}
                    />
                  </TemporalConfluenceLaneProvider>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CanonicalComparisonLane({
  sourceId,
  documentId,
  sourceName,
  sourcePath,
  focusDatetime,
}: {
  sourceId: LaneSourceId;
  documentId: string;
  sourceName: string;
  sourcePath?: string;
  focusDatetime?: string;
}) {
  if (sourceId === "transits") {
    return (
      <TransitListView
        documentId={documentId}
        focusDatetime={focusDatetime}
        embedded
        includeTemporal
        includeOrbTemporal
      />
    );
  }
  if (sourceId === "synodic_cycles") {
    return (
      <SynodicCycleListView
        documentId={documentId}
        focusDatetime={focusDatetime}
        embedded
        includeTemporal
      />
    );
  }
  if (sourceId === "primary_directions") {
    return (
      <DirectionsView
        sourceName={sourceName}
        source={sourcePath}
        documentId={documentId}
        cursorDocumentId={documentId}
        focusDocumentId={documentId}
        focusDatetime={focusDatetime}
        initialTab="primary"
        initialPrimaryMode="radix"
        includeTemporal
        lockTechnique
      />
    );
  }
  if (sourceId === "circumambulation") {
    return (
      <DirectionsView
        sourceName={sourceName}
        source={sourcePath}
        documentId={documentId}
        cursorDocumentId={documentId}
        focusDocumentId={documentId}
        focusDatetime={focusDatetime}
        initialTab="circumambulation"
        initialPrimaryMode="radix"
        includeTemporal
        lockTechnique
      />
    );
  }
  if (
    sourceId === "secondary_progressions" ||
    sourceId === "minor_progressions" ||
    sourceId === "tertiary_progressions"
  ) {
    const secondaryMethod =
      sourceId === "minor_progressions"
        ? "minor"
        : sourceId === "tertiary_progressions"
          ? "tertiary"
          : "secondary";
    return (
      <DirectionsView
        sourceName={sourceName}
        source={sourcePath}
        documentId={documentId}
        cursorDocumentId={documentId}
        focusDocumentId={documentId}
        focusDatetime={focusDatetime}
        initialTab="secondary"
        secondaryMethod={secondaryMethod}
        includeTemporal
        lockTechnique
      />
    );
  }
  return (
    <TimeLordPaneView
      documentId={documentId}
      tableId={timeLordTableId(sourceId)}
      sourceName={sourceName}
      focusDatetime={focusDatetime}
      includeTemporal
    />
  );
}

function timeLordTableId(sourceId: LaneSourceId): TimeLordTableId {
  if (sourceId === "profection_periods") return "profections_table";
  if (
    sourceId === "zodiacal_releasing" ||
    sourceId === "firdaria" ||
    sourceId === "decennials" ||
    sourceId === "triplicity_directions"
  ) {
    return sourceId;
  }
  return "zodiacal_releasing";
}

function laneSourcesFromBinding(binding: Record<string, unknown> | null | undefined): LaneSourceId[] {
  const selected: LaneSourceId[] = [];
  const lanes = Array.isArray(binding?.lanes) ? binding.lanes : [];
  for (const lane of lanes) {
    if (!isRecord(lane)) continue;
    const sourceId = String(lane.sourceId ?? lane.source_id ?? "") as LaneSourceId;
    if (!SOURCE_BY_ID.has(sourceId) || selected.includes(sourceId)) continue;
    selected.push(sourceId);
    if (selected.length === LANE_COUNT) break;
  }
  for (const sourceId of DEFAULT_LANE_SOURCES) {
    if (selected.length === LANE_COUNT) break;
    if (!selected.includes(sourceId)) selected.push(sourceId);
  }
  for (const source of LANE_SOURCES) {
    if (selected.length === LANE_COUNT) break;
    if (!selected.includes(source.id)) selected.push(source.id);
  }
  return selected;
}

function groupLaneSources(
  sources: readonly LaneSourceDefinition[],
): Array<[string, LaneSourceDefinition[]]> {
  const groups = new Map<string, LaneSourceDefinition[]>();
  for (const source of sources) {
    const group = groups.get(source.groupKey);
    if (group) group.push(source);
    else groups.set(source.groupKey, [source]);
  }
  return [...groups.entries()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTemporalLaneLens(
  lens: TemporalConfluenceLaneLens,
): TemporalConfluenceLaneLens {
  try {
    const normalized = JSON.parse(JSON.stringify(lens)) as unknown;
    return isRecord(normalized) ? normalized : {};
  } catch {
    return {};
  }
}

function useSettledTemporalLaneSpecs(
  specs: TemporalMapLaneSpec[],
): TemporalMapLaneSpec[] {
  const signature = JSON.stringify(specs);
  const [settledSignature, setSettledSignature] = React.useState(signature);
  React.useEffect(() => {
    if (signature === settledSignature) return undefined;
    const timer = window.setTimeout(() => {
      setSettledSignature(signature);
    }, MAP_LENS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settledSignature, signature]);
  return React.useMemo(
    () => JSON.parse(settledSignature) as TemporalMapLaneSpec[],
    [settledSignature],
  );
}

type ChronomapLaneTuple = [
  TemporalChronomapLane,
  TemporalChronomapLane,
  TemporalChronomapLane,
  TemporalChronomapLane,
];

export function temporalLaneFocusJdUt(
  group: TemporalConcurrenceGroup | null,
  laneId: string,
  fallbackJdUt: number,
): number {
  const candidate = group?.participants.find(
    (participant) => participant.laneId === laneId,
  )?.rowAnchorJdUt;
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : fallbackJdUt;
}

export function shouldClearPinnedTemporalGroup(
  pinnedGroup: TemporalConcurrenceGroup,
  result: TemporalMapGroupsResult,
  viewport: TemporalChronomapViewport,
): boolean {
  return result.complete
    && pinnedGroup.focusJdUt >= viewport.startJdUt
    && pinnedGroup.focusJdUt <= viewport.endJdUt
    && !result.groups.some((group) => group.groupId === pinnedGroup.groupId);
}

export function temporalMapTickJds(
  viewport: TemporalChronomapViewport,
  count = 7,
): number[] {
  const tickCount = Math.max(2, Math.min(12, Math.floor(count)));
  const span = viewport.endJdUt - viewport.startJdUt;
  if (!Number.isFinite(span) || span <= 0) return [];
  return Array.from(
    { length: tickCount },
    (_, index) => viewport.startJdUt + span * index / (tickCount - 1),
  );
}

export function temporalMapTicksFromInstants(
  instants: readonly TemporalMapInstant[],
  viewport: TemporalChronomapViewport,
): TemporalChronomapTick[] {
  const span = viewport.endJdUt - viewport.startJdUt;
  return instants.map((instant, index) => ({
    jdUt: instant.jdUt,
    label:
      span >= 2 * 365.2421904
        ? String(Math.max(0, Math.round(instant.ageYears)))
        : span <= 2
          ? instant.datetimeLabel
          : instant.dateLabel,
    major: index === 0 || index === instants.length - 1 || index % 2 === 0,
  }));
}

function boundedTemporalMapViewport(
  retained: TemporalChronomapViewport | null,
  horizon: { startJdUt: number; endJdUt: number },
): TemporalChronomapViewport {
  if (!retained) return { ...horizon };
  const startJdUt = Math.max(horizon.startJdUt, retained.startJdUt);
  const endJdUt = Math.min(horizon.endJdUt, retained.endJdUt);
  return endJdUt > startJdUt ? { startJdUt, endJdUt } : { ...horizon };
}

export function shouldLoadExactTemporalGroups(viewport: TemporalChronomapViewport): boolean {
  return viewport.endJdUt - viewport.startJdUt <= MAP_EXACT_GROUP_SPAN_DAYS;
}

export async function fetchTemporalMapGroupPages(
  token: string,
  viewport: TemporalChronomapViewport,
  signal: AbortSignal,
  fetchPage: typeof fetchTemporalMapGroups = fetchTemporalMapGroups,
): Promise<TemporalMapGroupsResult | null> {
  if (!shouldLoadExactTemporalGroups(viewport)) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let page = await fetchPage(
      {
        token,
        startJdUt: viewport.startJdUt,
        endJdUt: viewport.endJdUt,
        minimumLanes: 2,
        limit: MAP_GROUP_LIMIT,
      },
      signal,
    );
    const revision = page.revision;
    const byId = new Map(page.groups.map((group) => [group.groupId, group]));
    let nextOffset = page.nextOffset;
    let revisionDrifted = false;
    while (nextOffset != null) {
      if (signal.aborted) return null;
      const requestedOffset = nextOffset;
      page = await fetchPage(
        {
          token,
          startJdUt: viewport.startJdUt,
          endJdUt: viewport.endJdUt,
          minimumLanes: 2,
          offset: requestedOffset,
          limit: MAP_GROUP_LIMIT,
        },
        signal,
      );
      if (page.revision !== revision) {
        revisionDrifted = true;
        break;
      }
      for (const group of page.groups) byId.set(group.groupId, group);
      nextOffset = page.nextOffset;
      if (nextOffset === requestedOffset) break;
    }
    if (revisionDrifted) continue;
    return {
      ...page,
      groups: [...byId.values()].sort(compareTemporalMapGroups),
      offset: 0,
      nextOffset: null,
      revision,
    };
  }
  return null;
}

function buildChronomapLanes(
  laneSources: readonly LaneSourceId[],
  laneSnapshots: readonly TemporalMapLaneSnapshot[],
  tiles: TemporalMapTilesResult | null,
  t: TFunc,
): ChronomapLaneTuple {
  const concurrenceBins = new Map((tiles?.bins ?? []).map((bin) => [bin.index, bin]));
  const lanes = laneSources.slice(0, LANE_COUNT).map((sourceId, laneIndex) => {
    const laneId = `lane-${laneIndex + 1}`;
    const source = SOURCE_BY_ID.get(sourceId);
    const label = source ? t(source.labelKey) : sourceId;
    const snapshot = laneSnapshots.find((candidate) => candidate.laneId === laneId);
    const tileLane = tiles?.lanes.find((candidate) => candidate.laneId === laneId);
    const maximumCount = Math.max(1, ...(tileLane?.bins ?? []).map((bin) => bin.count));
    const bands: TemporalChronomapBand[] = (tileLane?.bins ?? []).map((bin) => {
      const planetId = bin.planetIds.length === 1 ? bin.planetIds[0] : null;
      const globalBin = concurrenceBins.get(bin.index);
      const startJdUt = (tiles?.startJdUt ?? 0) + bin.index * (tiles?.binDays ?? 0);
      const endJdUt = Math.min(
        tiles?.endJdUt ?? startJdUt,
        startJdUt + (tiles?.binDays ?? 0),
      );
      return {
        id: `${laneId}:bin:${bin.index}`,
        startJdUt,
        endJdUt,
        focusJdUt: startJdUt + (endJdUt - startJdUt) / 2,
        label,
        planetId,
        planetIds: bin.planetIds,
        count: bin.count,
        maxLaneCount: globalBin?.maxLaneCount,
        markerColor: planetMarkerColor(bin.planetIds[0] ?? null),
        markerColors: bin.planetIds.map(planetMarkerColor),
        intensity: logarithmicIntensity(bin.count, maximumCount),
      };
    });
    return {
      id: laneId,
      label,
      bands,
      coverage: chronomapCoverage(snapshot, tiles),
    } satisfies TemporalChronomapLane;
  });
  if (lanes.length !== LANE_COUNT) {
    throw new RangeError("Temporal Confluence requires exactly four map lanes");
  }
  return [lanes[0], lanes[1], lanes[2], lanes[3]];
}

function chronomapCoverage(
  lane: TemporalMapLaneSnapshot | undefined,
  tiles: TemporalMapTilesResult | null,
): TemporalChronomapCoverage[] {
  if (!lane) return [];
  const coverage: TemporalChronomapCoverage[] = [];
  if ((lane.status === "queued" || lane.status === "building") && tiles) {
    coverage.push({
      startJdUt: tiles.startJdUt,
      endJdUt: tiles.endJdUt,
      status: "pending",
    });
  }
  coverage.push(...lane.provisionalCoverage.spans.map((span) => ({
    ...span,
    status: "pending" as const,
  })));
  coverage.push(...lane.evidenceCoverage.spans.map((span) => ({
    ...span,
    status: "pending" as const,
  })));
  if (tiles) {
    coverage.push(...lane.concurrenceCoverage.spans.flatMap((span) => {
      const startJdUt = Math.max(span.startJdUt, tiles.startJdUt);
      const endJdUt = Math.min(span.endJdUt, tiles.endJdUt);
      return endJdUt > startJdUt
        ? [{ startJdUt, endJdUt, status: "complete" as const }]
        : [];
    }));
  }
  return coverage;
}

export function buildChronomapConcurrences(
  groups: readonly TemporalConcurrenceGroup[],
  tiles: TemporalMapTilesResult | null,
  label: string,
): TemporalChronomapConcurrence[] {
  if (groups.length) {
    return groups.map((group) => ({
      id: group.groupId,
      startJdUt: group.startJdUt,
      endJdUt: group.endJdUt,
      focusJdUt: group.focusJdUt,
      markerJdUt: Math.min(group.endJdUt, Math.max(group.startJdUt, group.focusJdUt)),
      label,
      laneIds: group.participants.map((participant) => participant.laneId),
      planetId: group.planetId,
      markerColor: temporalGroupColor(group),
      markerColors: [temporalGroupColor(group)],
      count: 1,
      intensity: 1,
      selectable: true,
    }));
  }
  if (!tiles) return [];
  const maximumCount = Math.max(
    1,
    ...tiles.bins.flatMap((bin) => (
      bin.planetSummaries.map((summary) => summary.groupCount)
    )),
  );
  return tiles.bins.flatMap((bin) => {
    return bin.planetSummaries.flatMap((summary, summaryIndex) => {
      const laneIds = laneIdsFromMask(summary.laneMask);
      if (laneIds.length < 2 || laneIds.length > 4) return [];
      const density = logarithmicIntensity(summary.groupCount, maximumCount);
      const laneStrength = Math.max(0, Math.min(1, (summary.maxLaneCount - 1) / 3));
      const markerColor = planetMarkerColor(summary.planetId);
      return [{
        id: `aggregate:${bin.index}:${summary.planetId}:${summary.laneMask}:${summaryIndex}`,
        startJdUt: bin.startJdUt,
        endJdUt: bin.endJdUt,
        focusJdUt: bin.startJdUt + (bin.endJdUt - bin.startJdUt) / 2,
        markerJdUt: bin.startJdUt + (bin.endJdUt - bin.startJdUt) / 2,
        label,
        laneIds,
        planetId: summary.planetId,
        markerColor,
        markerColors: [markerColor],
        count: summary.groupCount,
        intensity: density * 0.65 + laneStrength * 0.35,
        selectable: false,
      } satisfies TemporalChronomapConcurrence];
    });
  });
}

function laneIdsFromMask(mask: number): string[] {
  return Array.from({ length: LANE_COUNT }, (_, laneIndex) => laneIndex)
    .filter((laneIndex) => (mask & (1 << laneIndex)) !== 0)
    .map((laneIndex) => `lane-${laneIndex + 1}`);
}

function logarithmicIntensity(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.log1p(value) / Math.log1p(maximum);
}

function compareTemporalMapGroups(
  left: TemporalConcurrenceGroup,
  right: TemporalConcurrenceGroup,
): number {
  return left.startJdUt - right.startJdUt
    || left.endJdUt - right.endJdUt
    || left.groupId.localeCompare(right.groupId);
}

function planetMarkerColor(planetId: number | null): string {
  const colorRole = planetId == null ? null : planetColorRole(planetId);
  return colorRole ? `var(${colorRole}, var(--aries-text-muted))` : "var(--aries-text-muted)";
}

type LocatedParticipant = {
  row: HTMLElement;
  scroller: HTMLElement;
};

function locatePinnedParticipant(
  root: HTMLElement,
  laneId: string,
  rowId: string,
): LocatedParticipant | null {
  const lane = Array.from(root.querySelectorAll<HTMLElement>("[data-comparison-lane-id]")).find(
    (candidate) => candidate.dataset.comparisonLaneId === laneId,
  );
  if (!lane) return null;
  const row = Array.from(lane.querySelectorAll<HTMLElement>("[data-temporal-row-id]")).find(
    (candidate) => candidate.dataset.temporalRowId === rowId,
  );
  if (!row) return null;
  let current = row.parentElement;
  while (current && current !== lane) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return { row, scroller: current };
    }
    current = current.parentElement;
  }
  return null;
}

function isLocatedParticipant(value: LocatedParticipant | null): value is LocatedParticipant {
  return value !== null;
}
