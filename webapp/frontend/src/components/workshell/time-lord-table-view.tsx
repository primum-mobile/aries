// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type {
  GenericTableCell,
  GenericTablePayload,
  GenericTableRow,
  OptionsPatch,
} from "@/lib/daemon/client";
import { LIST_ROLE_CLASSES, useListRowHeight } from "@/lib/list-tokens";
import { useT, type TFunc } from "@/lib/i18n/i18n";
import { semanticChartColor } from "@/lib/theme/semantic-color";
import { cn } from "@/lib/utils";
import type { VimshottariPreferences } from "@/stores/workspace-store";
import { DateTransitLink, TimedChartContextMenu } from "./directions-view";
import {
  PANE_CONTROL_CLASSES,
  PaneControlBar,
  PaneInfoBar,
  PaneSelect,
} from "./list-controls";
import { ColumnResizeHandle, useResizableTableColumns } from "./resizable-table-columns";
import {
  temporalCoverageFromRows,
  useTemporalConfluenceRows,
  useTemporalPinnedRowId,
  useTemporalRowHighlight,
} from "./temporal-confluence-context";

type Props = {
  documentId: string;
  payload: GenericTablePayload;
  onBindingChange: (binding: Record<string, unknown>) => Promise<void>;
  onOptionsChange?: (patch: OptionsPatch) => Promise<void>;
  onVimshottariPreferencesChange?: (
    patch: Partial<VimshottariPreferences>,
  ) => Promise<void>;
};

type BindingOption = {
  value: string | number | boolean;
  label?: string;
  glyph?: string;
};

type ViewportAnchor = {
  periodStart: string | null;
  rowId: string | null;
  rowFraction: number;
  scrollTop: number;
  rowHeight: number;
};

const OVERSCAN_ROWS = 10;
const TIME_LORD_VIRTUAL_SCROLL_SYNC_EVENT = "aries:time-lord-virtual-scroll-sync";

export function TimeLordTableView({
  documentId,
  payload,
  onBindingChange,
  onOptionsChange,
  onVimshottariPreferencesChange,
}: Props) {
  const rowHeight = useListRowHeight("symbolic");
  const payloadKey = React.useMemo(() => expansionKey(payload), [payload]);
  const focusKey = React.useMemo(() => currentFocusKey(documentId, payload), [documentId, payload]);
  const initialIds = React.useMemo(() => initialExpanded(payload), [payload]);
  const system = String((payload.capabilities ?? {}).timeLordSystem ?? payload.tableId);
  const isZodiacalReleasing = system === "zodiacal_releasing";
  const isTriplicityDirections = system === "triplicity_directions";
  const isVimshottari = system === "vimshottari";
  const preservesExpandedAcrossBinding = isZodiacalReleasing || isTriplicityDirections;
  const [expandedState, setExpandedState] = React.useState<{
    documentId: string;
    key: string;
    ids: Set<string>;
    preserve: boolean;
  }>(() => ({
    documentId,
    key: payloadKey,
    ids: initialIds,
    preserve: false,
  }));
  const [pending, setPending] = React.useState(false);
  const manualViewportRef = React.useRef(false);
  const viewportAnchorRef = React.useRef<ViewportAnchor | null>(null);
  const pendingViewportRestoreFromKeyRef = React.useRef<string | null>(null);
  const programmaticScrollUntilRef = React.useRef(0);
  const expandedStateMatchesDocument = expandedState.documentId === documentId;
  const preserveExpanded = expandedStateMatchesDocument && expandedState.preserve;
  const expanded =
    expandedStateMatchesDocument && expandedState.key === payloadKey
      ? expandedState.ids
      : preservesExpandedAcrossBinding && preserveExpanded
        ? expandedState.ids
        : initialIds;
  const tableColumnIds = React.useMemo(
    () => payload.columns.map((column) => column.id),
    [payload.columns],
  );
  const tableResize = useResizableTableColumns({
    storageKey: `time-lord:${payload.tableId}`,
    columnIds: tableColumnIds,
  });
  const visibleRows = React.useMemo(() => visibleTreeRows(payload.rows, expanded), [payload.rows, expanded]);
  const temporalCoverage = React.useMemo(
    () => temporalCoverageFromRows(payload.rows),
    [payload.rows],
  );
  useTemporalConfluenceRows(visibleRows, temporalCoverage);
  const currentRowId = React.useMemo(() => {
    const ids = asArray((payload.capabilities ?? {}).currentRowIds).filter(
      (id): id is string => typeof id === "string",
    );
    return ids.length ? ids[ids.length - 1] : null;
  }, [payload.capabilities]);
  const pinnedTemporalRowId = useTemporalPinnedRowId();
  const focusIndex = React.useMemo(
    () => {
      if (pinnedTemporalRowId) {
        const pinnedIndex = visibleRows.findIndex(
          (row) => row.temporal?.rowId === pinnedTemporalRowId,
        );
        if (pinnedIndex >= 0) return pinnedIndex;
      }
      return currentRowId ? visibleRows.findIndex((row) => row.id === currentRowId) : -1;
    },
    [currentRowId, pinnedTemporalRowId, visibleRows],
  );
  const effectiveFocusKey = `${focusKey}|temporal:${pinnedTemporalRowId ?? ""}`;
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const focusedForKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    manualViewportRef.current = false;
    viewportAnchorRef.current = null;
    pendingViewportRestoreFromKeyRef.current = null;
    focusedForKeyRef.current = null;
  }, [documentId]);

  const captureViewportAnchor = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || visibleRows.length === 0) return;
    const viewportAnchor = scroller.clientHeight * 0.35;
    const anchorY = scroller.scrollTop + viewportAnchor;
    const anchorUnits = anchorY / rowHeight;
    const index = Math.max(
      0,
      Math.min(visibleRows.length - 1, Math.floor(anchorUnits)),
    );
    const row = visibleRows[index];
    viewportAnchorRef.current = {
      periodStart: stringOrUndefined(row?.meta?.periodStart) ?? null,
      rowId: row?.id ?? null,
      rowFraction: Math.max(0, Math.min(1, anchorUnits - index)),
      scrollTop: scroller.scrollTop,
      rowHeight,
    };
  }, [rowHeight, visibleRows]);

  const setProgrammaticScrollTop = React.useCallback((scroller: HTMLDivElement, value: number) => {
    programmaticScrollUntilRef.current = Date.now() + 120;
    scroller.scrollTop = value;
    scroller.dispatchEvent(new Event(TIME_LORD_VIRTUAL_SCROLL_SYNC_EVENT));
  }, []);

  const previousRowHeightRef = React.useRef(rowHeight);
  React.useLayoutEffect(() => {
    const previousRowHeight = previousRowHeightRef.current;
    previousRowHeightRef.current = rowHeight;
    if (previousRowHeight === rowHeight) return;
    const scroller = scrollerRef.current;
    if (!scroller || visibleRows.length === 0) return;
    const viewportAnchor = scroller.clientHeight * 0.35;
    const anchorUnits = (scroller.scrollTop + viewportAnchor) / previousRowHeight;
    setProgrammaticScrollTop(
      scroller,
      Math.max(0, anchorUnits * rowHeight - viewportAnchor),
    );
  }, [rowHeight, setProgrammaticScrollTop, visibleRows.length]);

  React.useLayoutEffect(() => {
    if (focusIndex < 0) return undefined;
    if (isZodiacalReleasing && manualViewportRef.current && !pinnedTemporalRowId) return undefined;
    if (focusedForKeyRef.current === effectiveFocusKey) return undefined;
    let frame = 0;
    let cancelled = false;
    const scroll = () => {
      if (cancelled) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const target = Math.max(
        0,
        focusIndex * previousRowHeightRef.current - scroller.clientHeight * 0.35,
      );
      setProgrammaticScrollTop(scroller, target);
      focusedForKeyRef.current = effectiveFocusKey;
    };
    frame = requestAnimationFrame(scroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [effectiveFocusKey, focusIndex, isZodiacalReleasing, pinnedTemporalRowId, setProgrammaticScrollTop]);

  React.useLayoutEffect(() => {
    if (!isZodiacalReleasing || !manualViewportRef.current) return undefined;
    const restoreFromKey = pendingViewportRestoreFromKeyRef.current;
    if (restoreFromKey === null || restoreFromKey === payloadKey) return undefined;
    const anchor = viewportAnchorRef.current;
    if (!anchor || visibleRows.length === 0) return undefined;
    let frame = 0;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const currentRowHeight = previousRowHeightRef.current;
      const index = nearestPeriodRowIndex(visibleRows, anchor, currentRowHeight);
      const rowFraction = Number.isFinite(anchor.rowFraction) ? anchor.rowFraction : 0;
      const target = Math.max(
        0,
        (index + rowFraction) * currentRowHeight - scroller.clientHeight * 0.35,
      );
      setProgrammaticScrollTop(scroller, target);
      pendingViewportRestoreFromKeyRef.current = null;
    };
    frame = requestAnimationFrame(restore);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isZodiacalReleasing, payloadKey, setProgrammaticScrollTop, visibleRows]);

  const handleScrollerScroll = React.useCallback(() => {
    if (!isZodiacalReleasing) return;
    if (Date.now() < programmaticScrollUntilRef.current) return;
    manualViewportRef.current = true;
    captureViewportAnchor();
  }, [captureViewportAnchor, isZodiacalReleasing]);

  const markViewportUserControlled = React.useCallback(() => {
    if (!isZodiacalReleasing) return;
    manualViewportRef.current = true;
  }, [isZodiacalReleasing]);

  const virtual = useVirtualRows(scrollerRef, visibleRows.length, rowHeight);
  const renderedRows = visibleRows.slice(virtual.startIndex, virtual.endIndex);
  const rowById = React.useMemo(() => {
    const rows = new Map<string, GenericTableRow>();
    for (const row of payload.rows) rows.set(row.id, row);
    return rows;
  }, [payload.rows]);
  const childCountByParent = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of payload.rows) {
      const parentId = typeof row.meta?.parentId === "string" ? row.meta.parentId : null;
      if (!parentId) continue;
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    }
    return counts;
  }, [payload.rows]);

  const updateBinding = React.useCallback(
    async (next: Record<string, unknown>, preserveViewport = true) => {
      if (isZodiacalReleasing && preserveViewport) {
        manualViewportRef.current = true;
        captureViewportAnchor();
        pendingViewportRestoreFromKeyRef.current = payloadKey;
      }
      setPending(true);
      try {
        if (isVimshottari && onVimshottariPreferencesChange) {
          const preferencePatch = vimshottariPreferenceDelta(payload, next);
          if (Object.keys(preferencePatch).length > 0) {
            await onVimshottariPreferencesChange(preferencePatch);
          }
        }
        await onBindingChange(next);
      } finally {
        setPending(false);
      }
    },
    [
      captureViewportAnchor,
      isVimshottari,
      isZodiacalReleasing,
      onBindingChange,
      onVimshottariPreferencesChange,
      payload,
      payloadKey,
    ],
  );

  const updateOptions = React.useCallback(
    async (patch: OptionsPatch) => {
      if (!onOptionsChange) return;
      setPending(true);
      try {
        await onOptionsChange(patch);
      } finally {
        setPending(false);
      }
    },
    [onOptionsChange],
  );

  const toggleExpanded = React.useCallback(
    (row: GenericTableRow) => {
      const rowId = row.id;
      const isOpening = !expanded.has(rowId);
      setExpandedState((current) => {
        const canReuseCurrent =
          current.documentId === documentId &&
          (current.key === payloadKey || (preservesExpandedAcrossBinding && current.preserve));
        const next = new Set(canReuseCurrent ? current.ids : initialIds);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return {
          documentId,
          key: payloadKey,
          ids: next,
          preserve: preservesExpandedAcrossBinding,
        };
      });
      if (isTriplicityDirections) {
        const expandedRows = expandedTriplicityRows(payload);
        const isExplicit = expandedRows.includes(rowId);
        if (isOpening && !isExplicit && (childCountByParent.get(rowId) ?? 0) === 0) {
          void updateBinding(triplicityBindingPayload(payload, {
            expanded_row_ids: [...expandedRows, rowId],
            drill_row_id: rowId,
          }), false);
        } else if (!isOpening && isExplicit) {
          const descendantPrefix = `${rowId}:`;
          const nextRows = expandedRows.filter((item) => item !== rowId && !item.startsWith(descendantPrefix));
          void updateBinding(triplicityBindingPayload(payload, {
            expanded_row_ids: nextRows,
            drill_row_id: nextRows[nextRows.length - 1] ?? null,
          }), false);
        }
        return;
      }
      if (isVimshottari && asNumber(row.meta?.level, 0) === 2) {
        const expandedRows = expandedVimshottariRows(payload);
        const isExplicit = expandedRows.includes(rowId);
        if (isOpening && !isExplicit && (childCountByParent.get(rowId) ?? 0) === 0) {
          void updateBinding(vimshottariBindingPayload(payload, {
            expanded_row_ids: [...expandedRows, rowId],
          }), false);
        } else if (!isOpening && isExplicit) {
          void updateBinding(vimshottariBindingPayload(payload, {
            expanded_row_ids: expandedRows.filter((item) => item !== rowId),
          }), false);
        }
        return;
      }
      if (
        (payload.capabilities ?? {}).timeLordSystem !== "zodiacal_releasing" ||
        asNumber(row.meta?.level, 0) !== 2
      ) {
        return;
      }
      const periodStart = stringOrUndefined(row.meta?.periodStart);
      if (!periodStart) return;
      const starts = expandedZrStarts(payload);
      const isExplicit = starts.includes(periodStart);
      if (isOpening && !isExplicit && (childCountByParent.get(rowId) ?? 0) === 0) {
        void updateBinding(zrBindingPayload(payload, {
          expanded_l2_starts: [...starts, periodStart],
          drill_l2_start: periodStart,
        }), false);
      } else if (!isOpening && isExplicit) {
        const nextStarts = starts.filter((item) => item !== periodStart);
        void updateBinding(zrBindingPayload(payload, {
          expanded_l2_starts: nextStarts,
          drill_l2_start: nextStarts[nextStarts.length - 1] ?? null,
        }), false);
      }
    },
    [
      childCountByParent,
      documentId,
      expanded,
      initialIds,
      isTriplicityDirections,
      isVimshottari,
      payload,
      payloadKey,
      preservesExpandedAcrossBinding,
      updateBinding,
    ],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TimeLordHeader payload={payload} />
      <BindingControls
        payload={payload}
        pending={pending}
        onBindingChange={updateBinding}
        onOptionsChange={updateOptions}
      />
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto"
        onPointerDownCapture={markViewportUserControlled}
        onScroll={handleScrollerScroll}
      >
        <table
          className={cn(
            LIST_ROLE_CLASSES.symbolic,
            "aries-list--frameless border-collapse [--aries-list-cell-x:6px]",
            tableResize.tableClassName,
          )}
          style={tableResize.tableStyle}
        >
          {tableResize.colGroup}
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {payload.columns.map((column) => (
                <th
                  key={column.id}
                  className={cn(
                    "aries-list-head-cell relative border-b font-medium",
                    alignClass(column.align),
                  )}
                  style={{
                    fontFamily: column.headerGlyph ? "'AriesMorinus'" : undefined,
                    fontWeight: column.headerGlyph ? 400 : undefined,
                    color: semanticChartColor(column.colorRole, column.colorHex),
                  }}
                >
                  {column.label}
                  <ColumnResizeHandle
                    columnId={column.id}
                    getResizeHandleProps={tableResize.getResizeHandleProps}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-rendered-row-count={renderedRows.length} data-total-row-count={visibleRows.length}>
            {virtual.paddingTop > 0 ? <VirtualSpacerRow colSpan={payload.columns.length} height={virtual.paddingTop} /> : null}
            {renderedRows.map((row) => (
              <TimeLordRow
                key={row.id}
                documentId={documentId}
                payload={payload}
                row={row}
                rowById={rowById}
                expanded={expanded.has(row.id)}
                onToggle={toggleExpanded}
                rowHeight={rowHeight}
              />
            ))}
            {virtual.paddingBottom > 0 ? <VirtualSpacerRow colSpan={payload.columns.length} height={virtual.paddingBottom} /> : null}
          </tbody>
        </table>
        {payload.notes?.length ? (
          <div className="space-y-1 border-t border-[color:var(--aries-border-subtle)] px-3 py-2 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
            {payload.notes.map((note, index) => (
              <div key={`${index}:${note}`}>{note}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimeLordHeader({ payload }: { payload: GenericTablePayload }) {
  const t = useT();
  const capabilities = payload.capabilities ?? {};
  const system = String(capabilities.timeLordSystem ?? payload.tableId);
  const title = headerTitle(payload, system, t);
  if (!title) return null;
  return (
    <PaneInfoBar className="gap-[var(--aries-pane-control-gap-y)]">
      {title}
    </PaneInfoBar>
  );
}

function headerTitle(payload: GenericTablePayload, system: string, t: TFunc): React.ReactNode {
  const capabilities = payload.capabilities ?? {};
  if (system === "firdaria") {
    const header = asRecord(capabilities.firdaria);
    return <span>{String(header.titleText ?? payload.title)}</span>;
  }
  if (system === "vimshottari") {
    const header = asRecord(capabilities.vimshottari);
    const birthNakshatraKey = String(header.birthNakshatraKey ?? "");
    const startNakshatraKey = String(header.startNakshatraKey ?? "");
    const birthNakshatra = birthNakshatraKey ? t(birthNakshatraKey) : "";
    const startNakshatra = startNakshatraKey ? t(startNakshatraKey) : "";
    const balanceYears = asNumber(header.balanceYears, 0).toFixed(3);
    return (
      <>
        <span>{t("timelord.birthNakshatra")}: {birthNakshatra}</span>
        {startNakshatra && startNakshatra !== birthNakshatra ? (
          <span>{t("timelord.startNakshatra")}: {startNakshatra}</span>
        ) : null}
        <span>{t("timelord.balanceYears", { years: balanceYears })}</span>
        <span className="text-[color:var(--aries-text-muted)]">
          {String(header.ayanamshaLabel ?? "")}
        </span>
      </>
    );
  }
  if (system === "decennials") {
    const header = asRecord(capabilities.decennials);
    const startIsPlanet = Boolean(header.startIsPlanet);
    const firstRulerVisible = Boolean(header.firstRulerVisible);
    return (
      <>
        <span className="text-[color:var(--aries-text-muted)]">{String(header.startLabel ?? t("timelord.start"))}:</span>
        {startIsPlanet ? (
          <span
            style={{
              fontFamily: "'AriesMorinus'",
              color: semanticChartColor(
                stringOrUndefined(header.startColorRole),
                stringOrUndefined(header.startColorHex),
              ),
            }}
          >
            {String(header.startGlyph ?? "")}
          </span>
        ) : (
          <span>{String(header.startText ?? "")}</span>
        )}
        {firstRulerVisible ? (
          <>
            <span className="text-[color:var(--aries-text-muted)]">{String(header.firstRulerLabel ?? "")}:</span>
            <span
              style={{
                fontFamily: "'AriesMorinus'",
                color: semanticChartColor(
                  stringOrUndefined(header.firstRulerColorRole),
                  stringOrUndefined(header.firstRulerColorHex),
                ),
              }}
            >
              {String(header.firstRulerGlyph ?? "")}
            </span>
          </>
        ) : null}
        {header.housesText ? (
          <span className="text-[color:var(--aries-text-muted)]">{String(header.housesText)}</span>
        ) : null}
        {header.ruleText ? (
          <span className="text-[color:var(--aries-text-muted)]">{String(header.ruleText)}</span>
        ) : null}
      </>
    );
  }
  if (system === "zodiacal_releasing") {
    const header = asRecord(capabilities.zr);
    return (
      <>
        <span>
          {String(header.releaserHeading ?? t("timelord.releaser"))}: {String(header.releaserLabel ?? "")}
        </span>
        <span className="text-[color:var(--aries-text-muted)]">{String(header.inLabel ?? t("timelord.in"))}</span>
        <span
          style={{
            fontFamily: "'AriesMorinus'",
            color: semanticChartColor(
              colorAt(header.signColorRoles, asNumber(header.signIndex, 0)),
              colorAt(header.signColors, asNumber(header.signIndex, 0)),
            ),
          }}
        >
          {String(header.signGlyph ?? "")}
        </span>
        <span
          style={{
            color: semanticChartColor(
              colorAt(header.signColorRoles, asNumber(header.signIndex, 0)),
              colorAt(header.signColors, asNumber(header.signIndex, 0)),
            ),
          }}
        >
          {String(header.signName ?? "")}
        </span>
        {header.degreeText ? <span>{String(header.degreeText)}</span> : null}
      </>
    );
  }
  if (system === "triplicity_directions") {
    const header = asRecord(capabilities.triplicityDirections);
    return (
      <>
        <span>{payload.title}</span>
        <span className="text-[color:var(--aries-text-muted)]">{String(header.sectLabel ?? "")}</span>
        <span style={{ fontFamily: "'AriesMorinus'" }}>{String(header.baseSignGlyph ?? "")}</span>
        <span>{String(header.baseSignName ?? "")}</span>
        <span className="text-[color:var(--aries-text-muted)]">{String(header.baseGroupLabel ?? "")}</span>
        <span className="text-[color:var(--aries-text-muted)]">{String(header.schemeLabel ?? "")}</span>
      </>
    );
  }
  if (system === "profections_table") {
    const header = asRecord(capabilities.profections);
    return <span>{String(header.modeLabel ?? payload.title)}</span>;
  }
  return <span>{payload.title}</span>;
}

function BindingControls({
  payload,
  pending,
  onBindingChange,
  onOptionsChange,
}: {
  payload: GenericTablePayload;
  pending: boolean;
  onBindingChange: (binding: Record<string, unknown>) => Promise<void>;
  onOptionsChange: (patch: OptionsPatch) => Promise<void>;
}) {
  const t = useT();
  const capabilities = payload.capabilities ?? {};
  const bindings = asRecord(capabilities.bindings);
  const options = asRecord(capabilities.bindingOptions);
  if (capabilities.timeLordSystem === "vimshottari") {
    const ayanamshaOptions = asOptions(options.ayanamsha);
    const ayanamshaSelection = vimshottariAyanamshaBinding(bindings.ayanamsha);
    const nextBinding = (patch: Record<string, unknown>) =>
      vimshottariBindingPayload(payload, patch);
    return (
      <PaneControlBar density="compact">
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="vimshottari-anchor">
          {t("timelord.anchor")}
        </label>
        <PaneSelect
          id="vimshottari-anchor"
          value={String(bindings.anchor ?? "moon")}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ anchor: event.target.value }))}
        >
          <option value="moon">{t("notes.planetMoon")}</option>
          <option value="ascendant">{t("notes.ascendant")}</option>
        </PaneSelect>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="vimshottari-start-star">
          {t("timelord.tara")}
        </label>
        <PaneSelect
          id="vimshottari-start-star"
          value={String(bindings.start_star ?? "janma")}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ start_star: event.target.value }))}
        >
          <option value="janma">{t("timelord.startJanma")}</option>
          <option value="kshema">{t("timelord.startKshema")}</option>
          <option value="utpanna">{t("timelord.startUtpanna")}</option>
          <option value="adhana">{t("timelord.startAdhana")}</option>
        </PaneSelect>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="vimshottari-year">
          {t("timelord.yearLength")}
        </label>
        <PaneSelect
          id="vimshottari-year"
          value={String(asNumber(bindings.year_days, 365.25))}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ year_days: Number(event.target.value) }))}
        >
          <option value="365.25">{t("timelord.yearJulian")}</option>
          <option value="360">{t("timelord.yearSavana")}</option>
        </PaneSelect>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="vimshottari-ayanamsha">
          {t("settings.ayanamsha")}
        </label>
        <PaneSelect
          id="vimshottari-ayanamsha"
          value={String(ayanamshaSelection)}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            void onBindingChange(nextBinding({
              ayanamsha: value === "follow_chart" ? value : Number(value),
            }));
          }}
        >
          <option value="follow_chart">{t("timelord.followChart")}</option>
          {ayanamshaOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
      </PaneControlBar>
    );
  }
  if (capabilities.timeLordSystem === "firdaria") {
    const header = asRecord(capabilities.firdaria);
    const isFirBonatti = Boolean(bindings.isfirbonatti);
    return (
      <PaneControlBar>
        <label className={PANE_CONTROL_CLASSES.checkboxLabel}>
          <input
            type="checkbox"
            checked={isFirBonatti}
            disabled={pending}
            onChange={(event) => void onBindingChange({ isfirbonatti: event.target.checked })}
          />
          {String(header.bonattiToggleLabel ?? t("timelord.useBonattiNocturnalOrder"))}
        </label>
      </PaneControlBar>
    );
  }
  if (capabilities.timeLordSystem === "decennials") {
    const header = asRecord(capabilities.decennials);
    const startOptions = asOptions(options.startToken);
    const aphetaHouseSystemOptions = asOptions(options.aphetaHouseSystem);
    const overlapResolutionOptions = asOptions(options.overlapResolution);
    const lowerLevelOptions = asOptions(options.lowerLevelMethod);
    const nextBinding = (patch: Record<string, unknown>) => ({
      start_token: String(bindings.start_token ?? "valens_apheta"),
      apheta_house_system: String(bindings.apheta_house_system ?? "whole_sign"),
      overlap_resolution: String(bindings.overlap_resolution ?? "table"),
      lower_level_method: String(bindings.lower_level_method ?? "proportional"),
      ...patch,
    });
    const valensAphetaSelected = String(bindings.start_token ?? "valens_apheta") === "valens_apheta";
    return (
      <PaneControlBar density="compact">
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="decennial-start">
          {t("timelord.start")}
        </label>
        <PaneSelect
          id="decennial-start"
          value={String(bindings.start_token ?? "valens_apheta")}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ start_token: event.target.value }))}
        >
          {startOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        {valensAphetaSelected ? (
          <>
            <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="decennial-apheta-houses">
              {String(header.houseSystemLabel ?? "")}
            </label>
            <PaneSelect
              id="decennial-apheta-houses"
              value={String(bindings.apheta_house_system ?? "whole_sign")}
              disabled={pending}
              onChange={(event) => void onBindingChange(nextBinding({ apheta_house_system: event.target.value }))}
            >
              {aphetaHouseSystemOptions.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label ?? String(option.value)}
                </option>
              ))}
            </PaneSelect>
          </>
        ) : null}
        {valensAphetaSelected && Boolean(header.overlapApplicable) ? (
          <>
            <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="decennial-overlap-resolution">
              {String(header.overlapLabel ?? "")}
            </label>
            <PaneSelect
              id="decennial-overlap-resolution"
              value={String(bindings.overlap_resolution ?? "table")}
              disabled={pending}
              onChange={(event) => void onBindingChange(nextBinding({ overlap_resolution: event.target.value }))}
            >
              {overlapResolutionOptions.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label ?? String(option.value)}
                </option>
              ))}
            </PaneSelect>
          </>
        ) : null}
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="decennial-lower-level-method">
          {String(header.lowerLevelsLabel ?? "")}
        </label>
        <PaneSelect
          id="decennial-lower-level-method"
          value={String(bindings.lower_level_method ?? "proportional")}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ lower_level_method: event.target.value }))}
        >
          {lowerLevelOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
      </PaneControlBar>
    );
  }
  if (capabilities.timeLordSystem === "triplicity_directions") {
    const header = asRecord(capabilities.triplicityDirections);
    const signOptions = asOptions(options.sign);
    const startSign = asNumber(bindings.start_sign, asNumber(header.baseSign, 0));
    const extendedDepth = Boolean(bindings.extended_depth);
    return (
      <PaneControlBar
        density="compact"
        className="gap-[var(--aries-pane-control-gap-y)]"
      >
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="triplicity-start-sign">
          {t("timelord.start")}
        </label>
        <PaneSelect
          id="triplicity-start-sign"
          value={String(startSign)}
          disabled={pending}
          onChange={(event) =>
            void onBindingChange(triplicityBindingPayload(payload, {
              start_sign: Number(event.target.value),
              expanded_row_ids: [],
              drill_row_id: null,
            }))
          }
        >
          {signOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        <label className={PANE_CONTROL_CLASSES.checkboxLabel}>
          <input
            type="checkbox"
            checked={extendedDepth}
            disabled={pending}
            onChange={(event) =>
              void onBindingChange(triplicityBindingPayload(payload, {
                extended_depth: event.target.checked,
              }))
            }
          />
          {t("timelord.plus6Layers")}
        </label>
        <span className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]">
          {t("timelord.levelsPer90Years", { levels: String(header.maxLevel ?? (extendedDepth ? 15 : 9)) })}
        </span>
      </PaneControlBar>
    );
  }
  if (capabilities.timeLordSystem === "zodiacal_releasing") {
    const releasers = asOptions(options.releaser);
    const signs = asOptions(options.sign);
    const header = asRecord(capabilities.zr);
    const releaser = String(bindings.releaser ?? "spirit");
    return (
      <PaneControlBar>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="zr-releaser">
          {t("timelord.releaser")}
        </label>
        <PaneSelect
          id="zr-releaser"
          value={releaser}
          disabled={pending}
          onChange={(event) =>
            void onBindingChange({
              releaser: event.target.value,
              apply_spirit_shift: Boolean(bindings.apply_spirit_shift),
              start_sign: asNumber(bindings.start_sign, 0),
            })
          }
        >
          {releasers.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        {releaser === "spirit" ? (
          <label
            className={cn(
              PANE_CONTROL_CLASSES.checkboxLabel,
              "gap-[var(--aries-control-gap-compact)]",
            )}
          >
            <input
              type="checkbox"
              checked={Boolean(bindings.apply_spirit_shift)}
              disabled={pending}
              onChange={(event) =>
                void onBindingChange({
                  releaser,
                  apply_spirit_shift: event.target.checked,
                  start_sign: asNumber(bindings.start_sign, 0),
                })
              }
            />
            {String(header.shiftLabel ?? t("timelord.shift"))}
          </label>
        ) : null}
        {releaser === "sign" ? (
          <>
            <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="zr-sign">
              {t("timelord.sign")}
            </label>
            <PaneSelect
              id="zr-sign"
              value={String(asNumber(bindings.start_sign, 0))}
              disabled={pending}
              onChange={(event) =>
                void onBindingChange({
                  releaser,
                  apply_spirit_shift: Boolean(bindings.apply_spirit_shift),
                  start_sign: Number(event.target.value),
                })
              }
            >
              {signs.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label ?? String(option.value)}
                </option>
              ))}
            </PaneSelect>
          </>
        ) : null}
      </PaneControlBar>
    );
  }
  if (capabilities.timeLordSystem === "profections_table") {
    const displayOptions = asOptions(options.mainsigs);
    const monthlyOptions = asOptions(options.monthlySteps);
    const header = asRecord(capabilities.profections);
    const mainsigs = Boolean(bindings.mainsigs ?? true);
    const monthlySteps12 = Boolean(bindings.monthly_steps12 ?? true);
    const ageOffset = asNumber(bindings.age_offset, 0);
    const zodprof = Boolean(header.zodprof ?? true);
    const nextBinding = (patch: Record<string, unknown>) => ({
      mainsigs,
      monthly_steps12: monthlySteps12,
      age_offset: ageOffset,
      ...patch,
    });
    return (
      <PaneControlBar surface>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-mode">
          {t("timelord.mode")}
        </label>
        <PaneSelect
          id="prof-mode"
          surface
          value={zodprof ? "zodiacal" : "mundane"}
          disabled={pending}
          onChange={(event) =>
            void onOptionsChange({
              profections: event.target.value === "zodiacal"
                ? { zodiacal: true, useZodProjs: false }
                : { zodiacal: false },
            })
          }
        >
          <option value="zodiacal">{String(header.zodLabel ?? t("timelord.zodiacal"))}</option>
          <option value="mundane">{String(header.munLabel ?? t("timelord.placidian"))}</option>
        </PaneSelect>
        <label
          className={cn(
            PANE_CONTROL_CLASSES.checkboxLabel,
            "gap-[var(--aries-control-gap-compact)]",
            zodprof ? "text-[color:var(--aries-text-muted)] opacity-60" : "text-[color:var(--aries-text-primary)]",
          )}
        >
          <input
            type="checkbox"
            checked={Boolean(header.useZodProjs)}
            disabled={pending || zodprof}
            onChange={(event) => void onOptionsChange({ profections: { useZodProjs: event.target.checked } })}
          />
          {String(header.useZodProjsLabel ?? t("timelord.useZodiacalProjections"))}
        </label>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-display">
          {t("timelord.display")}
        </label>
        <PaneSelect
          id="prof-display"
          surface
          value={String(mainsigs)}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ mainsigs: event.target.value === "true" }))}
        >
          {displayOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        <label className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-muted)]" htmlFor="prof-monthly">
          {t("timelord.monthly")}
        </label>
        <PaneSelect
          id="prof-monthly"
          surface
          value={String(monthlySteps12)}
          disabled={pending}
          onChange={(event) => void onBindingChange(nextBinding({ monthly_steps12: event.target.value === "true" }))}
        >
          {monthlyOptions.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </PaneSelect>
        <div className={PANE_CONTROL_CLASSES.rangeStepper}>
          <button
            type="button"
            className={PANE_CONTROL_CLASSES.rangeStepperButton}
            disabled={pending || ageOffset <= 0}
            onClick={() => void onBindingChange(nextBinding({ age_offset: Math.max(0, ageOffset - 12) }))}
          >
            -12
          </button>
          <span className={PANE_CONTROL_CLASSES.rangeStepperValue}>
            {t("timelord.age", { age: ageOffset })}
          </span>
          <button
            type="button"
            className={PANE_CONTROL_CLASSES.rangeStepperButton}
            disabled={pending || ageOffset >= 144}
            onClick={() => void onBindingChange(nextBinding({ age_offset: Math.min(144, ageOffset + 12) }))}
          >
            +12
          </button>
        </div>
      </PaneControlBar>
    );
  }
  return null;
}

function TimeLordRow({
  documentId,
  payload,
  row,
  rowById,
  expanded,
  onToggle,
  rowHeight,
}: {
  documentId: string;
  payload: GenericTablePayload;
  row: GenericTableRow;
  rowById: Map<string, GenericTableRow>;
  expanded: boolean;
  onToggle: (row: GenericTableRow) => void;
  rowHeight: number;
}) {
  const t = useT();
  const meta = row.meta ?? {};
  const level = asNumber(meta.level, 1);
  const parentId = typeof meta.parentId === "string" ? meta.parentId : null;
  const parentRow = parentId ? rowById.get(parentId) ?? null : null;
  const hasChildren = Boolean(meta.hasChildren);
  const isCurrent = Boolean(row.current || meta.current);
  const isStrong = row.emphasis === "strong" || level === 1 || level === 3;
  const colorHex = stringOrUndefined(meta.colorHex);
  const colorRole = stringOrUndefined(meta.colorRole);
  const eventDatetime = timedChartEventDatetime(meta);
  const rowTitle = rowHoverTitle(row);
  const temporalHighlight = useTemporalRowHighlight(row.temporal);
  const system = String((payload.capabilities ?? {}).timeLordSystem ?? payload.tableId);
  const hierarchyColumnIndex = Math.max(
    0,
    payload.columns.findIndex((column) =>
      ["body", "planet", "ruler", "sign"].includes(column.id.toLowerCase())
    ),
  );
  const rowElement = (
    <tr
      data-time-lord-row={row.id}
      {...temporalHighlight.dataAttributes}
      title={rowTitle}
      className={cn(
        "aries-list-row aries-list-row--flagged cursor-context-menu",
        hasChildren && "cursor-pointer",
        isStrong && "font-semibold",
        isCurrent && "text-accent-foreground",
      )}
      style={{ height: rowHeight, ...temporalHighlight.style }}
      onClick={(event) => {
        temporalHighlight.onClick?.(event);
        // In the comparison table, the row body owns concurrence pinning.
        // Keep hierarchy expansion on its explicit chevron so one click never
        // performs both actions. Standalone Time Lord tables retain their
        // existing whole-row expand/collapse behavior.
        if (!temporalHighlight.matched && hasChildren) onToggle(row);
      }}
    >
      {payload.columns.map((column, index) => {
        const cell = row.cells[index];
        const dateLinked = isTimeLordDateColumn(column.id);
        const quietCell = isQuietTimeLordCell(system, column.id, index, cell, row, parentRow);
        const cellContent = (
          <span
            className={cn(
              "block whitespace-nowrap",
              quietCell && "text-[color:var(--aries-text-muted)]",
            )}
          >
            <CellView cell={cell} />
          </span>
        );
        return (
          <td
            key={`${row.id}:${column.id}`}
            className={cn(
              "aries-list-cell border-b align-middle",
              alignClass(cell?.align ?? column.align),
              index === 0 && "whitespace-nowrap",
            )}
            style={
              cell?.glyph && (colorRole || colorHex)
                ? { color: semanticChartColor(colorRole, colorHex) }
                : undefined
            }
          >
            {index === hierarchyColumnIndex ? (
              <div className="flex items-center gap-1" style={{ paddingLeft: `${Math.max(0, level - 1) * 14}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    className={PANE_CONTROL_CLASSES.microIconButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(row);
                    }}
                    aria-label={expanded ? t("timelord.collapse") : t("timelord.expand")}
                  >
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                  </button>
                ) : (
                  <span className="size-[var(--aries-control-height-micro)] shrink-0" />
                )}
                {dateLinked ? (
                  <DateTransitLink
                    documentId={documentId}
                    eventDatetime={eventDatetime}
                  >
                    {cellContent}
                  </DateTransitLink>
                ) : (
                  cellContent
                )}
              </div>
            ) : (
              dateLinked ? (
                <DateTransitLink
                  documentId={documentId}
                  eventDatetime={eventDatetime}
                >
                  {cellContent}
                </DateTransitLink>
              ) : (
                cellContent
              )
            )}
          </td>
        );
      })}
    </tr>
  );
  if (!hasTimedRowActions(meta)) {
    return rowElement;
  }
  return (
    <TimedChartContextMenu
      documentId={documentId}
      eventDatetime={eventDatetime}
    >
      {rowElement}
    </TimedChartContextMenu>
  );
}

function initialExpanded(payload: GenericTablePayload): Set<string> {
  const ids = asArray((payload.capabilities ?? {}).initialExpandedRowIds)
    .filter((id): id is string => typeof id === "string");
  return new Set(ids);
}

function expandedZrStarts(payload: GenericTablePayload): string[] {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  return Array.from(new Set(
    asArray(bindings.expanded_l2_starts).filter((item): item is string => typeof item === "string" && item.length > 0),
  ));
}

function expandedTriplicityRows(payload: GenericTablePayload): string[] {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  return Array.from(new Set(
    asArray(bindings.expanded_row_ids).filter((item): item is string => typeof item === "string" && item.length > 0),
  ));
}

function expandedVimshottariRows(payload: GenericTablePayload): string[] {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  return Array.from(new Set(
    asArray(bindings.expanded_row_ids).filter((item): item is string => typeof item === "string" && item.length > 0),
  ));
}

function vimshottariAyanamshaBinding(value: unknown): "follow_chart" | number {
  if (value === "follow_chart") return value;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : "follow_chart";
}

function triplicityBindingPayload(
  payload: GenericTablePayload,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  return {
    extended_depth: Boolean(bindings.extended_depth),
    start_sign: asNumber(bindings.start_sign, 0),
    expanded_row_ids: expandedTriplicityRows(payload),
    drill_row_id: typeof bindings.drill_row_id === "string" ? bindings.drill_row_id : null,
    ...patch,
  };
}

function vimshottariBindingPayload(
  payload: GenericTablePayload,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  const resetsPeriodTree = (
    "anchor" in patch ||
    "start_star" in patch ||
    "year_days" in patch ||
    "ayanamsha" in patch
  );
  return {
    anchor: String(bindings.anchor ?? "moon"),
    start_star: String(bindings.start_star ?? "janma"),
    year_days: asNumber(bindings.year_days, 365.25),
    ayanamsha: vimshottariAyanamshaBinding(bindings.ayanamsha),
    expanded_row_ids: resetsPeriodTree ? [] : expandedVimshottariRows(payload),
    ...patch,
  };
}

function vimshottariPreferenceDelta(
  payload: GenericTablePayload,
  next: Record<string, unknown>,
): Partial<VimshottariPreferences> {
  const current = asRecord((payload.capabilities ?? {}).bindings);
  const patch: Partial<VimshottariPreferences> = {};
  const anchor = String(next.anchor ?? "moon") === "ascendant" ? "ascendant" : "moon";
  if (anchor !== String(current.anchor ?? "moon")) patch.anchor = anchor;
  const startStarValue = String(next.start_star ?? "janma");
  const startStar = (
    startStarValue === "kshema" ||
    startStarValue === "utpanna" ||
    startStarValue === "adhana"
  ) ? startStarValue : "janma";
  if (startStar !== String(current.start_star ?? "janma")) patch.startStar = startStar;
  const yearDays = asNumber(next.year_days, 365.25) === 360 ? 360 : 365.25;
  if (yearDays !== asNumber(current.year_days, 365.25)) patch.yearDays = yearDays;
  const ayanamsha = vimshottariAyanamshaBinding(next.ayanamsha);
  if (ayanamsha !== vimshottariAyanamshaBinding(current.ayanamsha)) {
    patch.ayanamsha = ayanamsha;
  }
  return patch;
}

function zrBindingPayload(
  payload: GenericTablePayload,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const bindings = asRecord((payload.capabilities ?? {}).bindings);
  return {
    releaser: String(bindings.releaser ?? "spirit"),
    apply_spirit_shift: Boolean(bindings.apply_spirit_shift),
    start_sign: asNumber(bindings.start_sign, 0),
    ...patch,
  };
}

function expansionKey(payload: GenericTablePayload): string {
  const capabilities = payload.capabilities ?? {};
  const system = String(capabilities.timeLordSystem ?? payload.tableId);
  return JSON.stringify({
    tableId: payload.tableId,
    bindings: capabilities.bindings ?? null,
    currentRowIds: focusRowIds(system, capabilities.currentRowIds),
  });
}

function currentFocusKey(documentId: string, payload: GenericTablePayload): string {
  const capabilities = payload.capabilities ?? {};
  const system = String(capabilities.timeLordSystem ?? payload.tableId);
  return JSON.stringify({
    documentId,
    tableId: payload.tableId,
    system,
    bindings: focusBindings(system, capabilities.bindings),
    currentRowIds: focusRowIds(system, capabilities.currentRowIds),
  });
}

function focusBindings(system: string, value: unknown): Record<string, unknown> | unknown {
  const bindings = asRecord(value);
  if (system !== "zodiacal_releasing" && system !== "triplicity_directions" && system !== "vimshottari") return value ?? null;
  const stableBindings = { ...bindings };
  delete stableBindings.drill_l2_start;
  delete stableBindings.expanded_l2_starts;
  delete stableBindings.drilled_row_id;
  delete stableBindings.drill_row_id;
  delete stableBindings.expanded_row_ids;
  return stableBindings;
}

function focusRowIds(system: string, value: unknown): unknown {
  return system === "zodiacal_releasing" ? null : value ?? null;
}

function visibleTreeRows(rows: GenericTableRow[], expanded: Set<string>) {
  const visible: GenericTableRow[] = [];
  const visibleById = new Set<string>();
  for (const row of rows) {
    const parentId = typeof row.meta?.parentId === "string" ? row.meta.parentId : null;
    if (!parentId || (visibleById.has(parentId) && expanded.has(parentId))) {
      visible.push(row);
      visibleById.add(row.id);
    }
  }
  return visible;
}

function nearestPeriodRowIndex(
  rows: GenericTableRow[],
  anchor: ViewportAnchor,
  rowHeight: number,
): number {
  if (rows.length === 0) return 0;
  const anchorTime = anchor.periodStart ? Date.parse(anchor.periodStart) : Number.NaN;
  if (Number.isFinite(anchorTime)) {
    let bestIndex = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < rows.length; index += 1) {
      const rowStart = stringOrUndefined(rows[index].meta?.periodStart);
      const rowTime = rowStart ? Date.parse(rowStart) : Number.NaN;
      if (!Number.isFinite(rowTime)) continue;
      const delta = Math.abs(rowTime - anchorTime);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index;
      }
    }
    return bestIndex;
  }
  if (anchor.rowId) {
    const rowIndex = rows.findIndex((row) => row.id === anchor.rowId);
    if (rowIndex >= 0) return rowIndex;
  }
  const sourceRowHeight = anchor.rowHeight > 0 ? anchor.rowHeight : rowHeight;
  return Math.max(
    0,
    Math.min(rows.length - 1, Math.floor(anchor.scrollTop / sourceRowHeight)),
  );
}

function isTimeLordDateColumn(columnId: string): boolean {
  const id = columnId.toLowerCase();
  return id === "date" || id === "start" || id === "period" || id.endsWith(":date");
}

function isRepeatedDateCell(
  columnId: string,
  index: number,
  cell: GenericTableCell | undefined,
  row: GenericTableRow,
  parentRow: GenericTableRow | null,
): boolean {
  if (!parentRow || !isTimeLordDateColumn(columnId)) return false;
  if (asNumber(row.meta?.level, 1) <= 1) return false;
  const text = cellText(cell);
  return text !== "" && text === cellText(parentRow.cells[index]);
}

function isQuietTimeLordCell(
  system: string,
  columnId: string,
  index: number,
  cell: GenericTableCell | undefined,
  row: GenericTableRow,
  parentRow: GenericTableRow | null,
): boolean {
  if (isRepeatedDateCell(columnId, index, cell, row, parentRow)) return true;
  if (!CONTINUOUS_AGE_SYSTEMS.has(system)) return false;
  if (columnId.toLowerCase() !== "age") return false;
  if (asNumber(row.meta?.level, 1) <= 1) return false;
  return cellText(cell) !== "";
}

const CONTINUOUS_AGE_SYSTEMS = new Set([
  "decennials",
  "firdaria",
  "zodiacal_releasing",
]);

function rowHoverTitle(row: GenericTableRow): string {
  const meta = row.meta ?? {};
  const start = typeof meta.periodStart === "string" ? meta.periodStart : null;
  const end = typeof meta.periodEndExclusive === "string" ? meta.periodEndExclusive : null;
  const period = start && end ? `${start} - ${end}` : start ?? "";
  const text = row.cells
    .map((cell) => cellText(cell))
    .filter(Boolean)
    .join(" · ");
  return [period, text].filter(Boolean).join(" · ");
}

function cellText(cell?: GenericTableCell): string {
  if (!cell) return "";
  if (cell.text) return cell.text;
  if (cell.runs?.length) return cell.runs.map((run) => run.text).join("");
  return cell.glyph ?? "";
}

function useVirtualRows(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
  rowHeight: number,
) {
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0, headerHeight: 0 });

  const measureNow = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      scrollTop: scroller.scrollTop,
      height: scroller.clientHeight,
      headerHeight: scroller.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0,
    };
    setViewport((prev) =>
      prev.scrollTop === next.scrollTop && prev.height === next.height && prev.headerHeight === next.headerHeight
        ? prev
        : next,
    );
  }, [scrollerRef]);

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let frame = 0;
    const measureSync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      measureNow();
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measureNow();
      });
    };
    scheduleMeasure();
    scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
    scroller.addEventListener(TIME_LORD_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    resizeObserver?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", scheduleMeasure);
      scroller.removeEventListener(TIME_LORD_VIRTUAL_SCROLL_SYNC_EVENT, measureSync);
      resizeObserver?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measureNow, rowCount, scrollerRef]);

  return React.useMemo(() => {
    if (rowCount <= 0) {
      return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const bodyScrollTop = Math.max(0, viewport.scrollTop - viewport.headerHeight);
    const visibleStart = viewport.height > 0 ? Math.floor(bodyScrollTop / rowHeight) : 0;
    const visibleCount = Math.max(1, Math.ceil(viewport.height / rowHeight));
    const startIndex = Math.max(0, visibleStart - OVERSCAN_ROWS);
    const endIndex = Math.min(rowCount, visibleStart + visibleCount + OVERSCAN_ROWS);
    return {
      startIndex,
      endIndex,
      paddingTop: startIndex * rowHeight,
      paddingBottom: (rowCount - endIndex) * rowHeight,
    };
  }, [rowCount, rowHeight, viewport.headerHeight, viewport.height, viewport.scrollTop]);
}

function VirtualSpacerRow({ colSpan, height }: { colSpan: number; height: number }) {
  return (
    <tr aria-hidden="true" data-virtual-spacer className="border-0 hover:bg-transparent" style={{ height }}>
      <td colSpan={colSpan} className="border-0 p-0" style={{ height }} />
    </tr>
  );
}

function CellView({ cell }: { cell?: GenericTableCell }) {
  if (!cell) return null;
  const color = semanticChartColor(cell.colorRole, cell.color);
  const channelStyle: React.CSSProperties | undefined =
    color || cell.emphasis === "strong"
      ? {
          color,
          fontWeight: cell.emphasis === "strong" ? 600 : undefined,
        }
      : undefined;
  if (cell.runs?.length) {
    return (
      <span style={channelStyle}>
        {cell.runs.map((run, index) => (
          <span
            key={`${index}:${run.text}`}
            style={{
              fontFamily: run.glyph ? "'AriesMorinus'" : undefined,
              color: semanticChartColor(run.colorRole, run.color),
            }}
          >
            {run.text}
          </span>
        ))}
      </span>
    );
  }
  if (cell.glyph) {
    return (
      <span style={channelStyle}>
        <span style={{ fontFamily: "'AriesMorinus'" }}>{cell.glyph}</span>
        {cell.text ? <span>{cell.text}</span> : null}
      </span>
    );
  }
  if (channelStyle) {
    return <span style={channelStyle}>{cell.text ?? ""}</span>;
  }
  return <>{cell.text ?? ""}</>;
}

function alignClass(align?: string) {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asOptions(value: unknown): BindingOption[] {
  return asArray(value).filter(
    (item): item is BindingOption => item !== null && typeof item === "object" && "value" in item,
  );
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function colorAt(value: unknown, index: number): string | undefined {
  const items = Array.isArray(value) ? value : [];
  const item = items[index];
  return typeof item === "string" ? item : undefined;
}

function hasTimedRowActions(meta: Record<string, unknown>): boolean {
  return Array.isArray(meta.rowActions) && meta.rowActions.length > 0;
}

function timedChartEventDatetime(meta: Record<string, unknown>): string | null {
  const explicit = meta.eventDatetime;
  if (typeof explicit === "string" && explicit) return explicit;
  const date = meta.eventDate;
  if (typeof date === "string" && date) {
    return date.includes("T") ? date : `${date}T00:00:00`;
  }
  return null;
}
