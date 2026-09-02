// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type {
  TemporalConcurrenceGroup,
  TemporalRowMeta,
} from "@/lib/daemon/client";
import { semanticChartColor } from "@/lib/theme/semantic-color";

type TemporalCarrier = TemporalRowMeta | { temporal?: TemporalRowMeta | null };
export type TemporalConfluenceLaneLens = Record<string, unknown>;

type LaneContextValue = {
  laneId: string;
  groupsByRow: ReadonlyMap<string, readonly TemporalConcurrenceGroup[]>;
  pinnedGroupId: string | null;
  pinnedRowId: string | null;
  reportRows: (rows: TemporalRowMeta[]) => void;
  reportCoverage: (coverage: TemporalCoverage | null) => void;
  reportLens: (lens: TemporalConfluenceLaneLens) => void;
  pinGroup: (groupId: string) => void;
};

export type TemporalCoverage = {
  startJdUt: number;
  endJdUt: number;
  authoritative: boolean;
};

export type TemporalCoverageBounds = Omit<TemporalCoverage, "authoritative">;

export type TemporalRowHighlight = {
  matched: boolean;
  groupId?: string;
  laneCount?: number;
  planetId?: number;
  pinned?: boolean;
  style?: React.CSSProperties;
  dataAttributes: {
    "data-temporal-row-id"?: string;
    "data-concurrence-group"?: string;
    "data-concurrence-count"?: number;
    "data-concurrence-planet"?: number;
    "data-concurrence-pinned"?: "true";
  };
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
};

const TemporalLaneContext = React.createContext<LaneContextValue | null>(null);

export function TemporalConfluenceLaneProvider({
  laneId,
  groups,
  pinnedGroupId,
  onRowsChange,
  onCoverageChange,
  onLensChange,
  onPinGroup,
  children,
}: {
  laneId: string;
  groups: readonly TemporalConcurrenceGroup[];
  pinnedGroupId: string | null;
  onRowsChange: (laneId: string, rows: TemporalRowMeta[]) => void;
  onCoverageChange: (laneId: string, coverage: TemporalCoverage | null) => void;
  onLensChange: (laneId: string, lens: TemporalConfluenceLaneLens) => void;
  onPinGroup: (groupId: string) => void;
  children: React.ReactNode;
}) {
  const groupsByRow = React.useMemo(() => {
    const result = new Map<string, TemporalConcurrenceGroup[]>();
    for (const group of groups) {
      for (const participant of group.participants) {
        if (participant.laneId !== laneId) continue;
        const current = result.get(participant.rowId);
        if (current) current.push(group);
        else result.set(participant.rowId, [group]);
      }
    }
    for (const rowGroups of result.values()) {
      rowGroups.sort(compareGroups);
    }
    return result;
  }, [groups, laneId]);
  const reportRows = React.useCallback(
    (rows: TemporalRowMeta[]) => onRowsChange(laneId, rows),
    [laneId, onRowsChange],
  );
  const reportCoverage = React.useCallback(
    (coverage: TemporalCoverage | null) => onCoverageChange(laneId, coverage),
    [laneId, onCoverageChange],
  );
  const reportLens = React.useCallback(
    (lens: TemporalConfluenceLaneLens) => onLensChange(laneId, lens),
    [laneId, onLensChange],
  );
  const pinnedRowId = React.useMemo(() => {
    const group = groups.find((candidate) => candidate.groupId === pinnedGroupId);
    return group?.participants.find((participant) => participant.laneId === laneId)?.rowId ?? null;
  }, [groups, laneId, pinnedGroupId]);
  const value = React.useMemo<LaneContextValue>(
    () => ({
      laneId,
      groupsByRow,
      pinnedGroupId,
      pinnedRowId,
      reportRows,
      reportCoverage,
      reportLens,
      pinGroup: onPinGroup,
    }),
    [
      groupsByRow,
      laneId,
      onPinGroup,
      pinnedGroupId,
      pinnedRowId,
      reportCoverage,
      reportLens,
      reportRows,
    ],
  );

  return <TemporalLaneContext.Provider value={value}>{children}</TemporalLaneContext.Provider>;
}

export function useTemporalPinnedRowId(): string | null {
  return React.useContext(TemporalLaneContext)?.pinnedRowId ?? null;
}

export function useTemporalConfluenceLensReporter(): (
  lens: TemporalConfluenceLaneLens,
) => void {
  const reportLens = React.useContext(TemporalLaneContext)?.reportLens;
  return React.useCallback(
    (lens: TemporalConfluenceLaneLens) => reportLens?.(lens),
    [reportLens],
  );
}

/** Report only canonical, post-filter rows already owned by the mounted list. */
export function useTemporalConfluenceRows(
  rows: readonly TemporalCarrier[],
  coverage?: TemporalCoverage | null,
): void {
  const context = React.useContext(TemporalLaneContext);
  const reportRows = context?.reportRows;
  const reportCoverage = context?.reportCoverage;
  const temporalRows = React.useMemo(
    () => rows.map(temporalFromCarrier).filter(isTemporalRowMeta),
    [rows],
  );
  const latestReportRef = React.useRef(reportRows);
  const latestCoverageReportRef = React.useRef(reportCoverage);
  React.useEffect(() => {
    latestReportRef.current = reportRows;
  }, [reportRows]);
  React.useEffect(() => {
    latestCoverageReportRef.current = reportCoverage;
  }, [reportCoverage]);

  React.useEffect(() => {
    reportRows?.(temporalRows);
  }, [reportRows, temporalRows]);
  React.useEffect(() => {
    reportCoverage?.(normalizeTemporalCoverage(coverage));
  }, [coverage, reportCoverage]);
  React.useEffect(
    () => () => {
      latestReportRef.current?.([]);
      latestCoverageReportRef.current?.(null);
    },
    [],
  );
}

export function temporalCoverageFromRows(
  rows: readonly TemporalCarrier[],
  authoritative = true,
): TemporalCoverage | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const carrier of rows) {
    const temporal = temporalFromCarrier(carrier);
    for (const activation of temporal?.activations ?? []) {
      for (const window of activation.windows) {
        if (!Number.isFinite(window.startJdUt) || !Number.isFinite(window.endJdUt)) continue;
        if (window.endJdUt <= window.startJdUt) continue;
        start = Math.min(start, window.startJdUt);
        end = Math.max(end, window.endJdUt);
      }
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { startJdUt: start, endJdUt: end, authoritative };
}

export function temporalCoverageBounds(
  startJdUt: number | null | undefined,
  endJdUt: number | null | undefined,
): TemporalCoverageBounds | null {
  if (typeof startJdUt !== "number" || typeof endJdUt !== "number") return null;
  const normalized = normalizeTemporalCoverage({
    startJdUt,
    endJdUt,
    authoritative: false,
  });
  return normalized
    ? { startJdUt: normalized.startJdUt, endJdUt: normalized.endJdUt }
    : null;
}

export function mergeTemporalCoverageBounds(
  current: TemporalCoverageBounds | null | undefined,
  chunk: TemporalCoverageBounds | null | undefined,
): TemporalCoverageBounds | null {
  const left = temporalCoverageBounds(current?.startJdUt, current?.endJdUt);
  const right = temporalCoverageBounds(chunk?.startJdUt, chunk?.endJdUt);
  if (!left || !right) return null;
  return {
    startJdUt: Math.min(left.startJdUt, right.startJdUt),
    endJdUt: Math.max(left.endJdUt, right.endJdUt),
  };
}

export function temporalCoverageFromJdBounds(
  coverage: TemporalCoverageBounds | null | undefined,
  authoritative: boolean,
): TemporalCoverage | null {
  const normalized = temporalCoverageBounds(coverage?.startJdUt, coverage?.endJdUt);
  return normalized ? { ...normalized, authoritative } : null;
}

export function useTemporalRowHighlight(
  temporal: TemporalRowMeta | null | undefined,
): TemporalRowHighlight {
  const context = React.useContext(TemporalLaneContext);
  const rowGroups = temporal && context ? context.groupsByRow.get(temporal.rowId) ?? [] : [];
  const group =
    rowGroups.find((candidate) => candidate.groupId === context?.pinnedGroupId) ?? rowGroups[0];
  if (!temporal || !context || !group) {
    return { matched: false, dataAttributes: {} };
  }

  const pinned = group.groupId === context.pinnedGroupId;
  const color = temporalGroupColor(group);
  return {
    matched: true,
    groupId: group.groupId,
    laneCount: group.laneCount,
    planetId: group.planetId,
    pinned,
    style: {
      boxShadow: `inset ${pinned ? 4 : 3}px 0 0 ${color}`,
      backgroundColor: `color-mix(in srgb, ${color} ${pinned ? 17 : 9}%, transparent)`,
      cursor: "pointer",
    },
    dataAttributes: {
      "data-temporal-row-id": temporal.rowId,
      "data-concurrence-group": group.groupId,
      "data-concurrence-count": group.laneCount,
      "data-concurrence-planet": group.planetId,
      "data-concurrence-pinned": pinned ? "true" : undefined,
    },
    onClick: (event) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element
        && target.closest("a,button,input,select,textarea,[role='button'],[role='link']")
      ) return;
      context.pinGroup(group.groupId);
    },
  };
}

export function planetColorRole(planetId: number): string | null {
  const roles: Record<number, string> = {
    0: "--morinus-body-sun",
    1: "--morinus-body-moon",
    2: "--morinus-body-mercury",
    3: "--morinus-body-venus",
    4: "--morinus-body-mars",
    5: "--morinus-body-jupiter",
    6: "--morinus-body-saturn",
    7: "--morinus-body-uranus",
    8: "--morinus-body-neptune",
    9: "--morinus-body-pluto",
    10: "--morinus-body-nodes",
    11: "--morinus-body-nodes",
    15: "--morinus-body-chiron",
  };
  return roles[planetId] ?? null;
}

export function temporalGroupColor(group: TemporalConcurrenceGroup): string {
  const bodyRole = planetColorRole(group.planetId);
  if (bodyRole) return `var(${bodyRole}, var(--aries-text-muted))`;
  return semanticChartColor(group.colorRole, group.colorHex)
    ?? "var(--aries-text-muted)";
}

function temporalFromCarrier(value: TemporalCarrier): TemporalRowMeta | null | undefined {
  if ("rowId" in value && "activations" in value) return value;
  return value.temporal;
}

function isTemporalRowMeta(value: TemporalRowMeta | null | undefined): value is TemporalRowMeta {
  return Boolean(value?.rowId && Array.isArray(value.activations));
}

function normalizeTemporalCoverage(
  coverage: TemporalCoverage | null | undefined,
): TemporalCoverage | null {
  if (!coverage) return null;
  const startJdUt = Number(coverage.startJdUt);
  const endJdUt = Number(coverage.endJdUt);
  if (!Number.isFinite(startJdUt) || !Number.isFinite(endJdUt) || endJdUt <= startJdUt) {
    return null;
  }
  return {
    startJdUt,
    endJdUt,
    authoritative: coverage.authoritative === true,
  };
}

function compareGroups(left: TemporalConcurrenceGroup, right: TemporalConcurrenceGroup): number {
  if (left.laneCount !== right.laneCount) return right.laneCount - left.laneCount;
  const leftDuration = left.endJdUt - left.startJdUt;
  const rightDuration = right.endJdUt - right.startJdUt;
  if (leftDuration !== rightDuration) return leftDuration - rightDuration;
  if (left.startJdUt !== right.startJdUt) return left.startJdUt - right.startJdUt;
  return left.groupId.localeCompare(right.groupId);
}
