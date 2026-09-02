// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import styles from "./temporal-chronomap.module.css";

export const TEMPORAL_CHRONOMAP_PRESETS = [
  "life",
  "decade",
  "year",
  "month",
  "week",
  "day",
] as const;

export const TEMPORAL_CHRONOMAP_YEAR_DAYS = 365.2421904;
export const TEMPORAL_CHRONOMAP_SETTLE_MS = 180;

export type TemporalChronomapPreset = (typeof TEMPORAL_CHRONOMAP_PRESETS)[number];

export type TemporalChronomapViewport = {
  startJdUt: number;
  endJdUt: number;
};

export type TemporalChronomapTick = {
  jdUt: number;
  label: string;
  major?: boolean;
};

export type TemporalChronomapCoverageStatus = "complete" | "pending" | "unknown";

export type TemporalChronomapCoverage = {
  startJdUt: number;
  endJdUt: number;
  status: TemporalChronomapCoverageStatus;
};

export type TemporalChronomapBand = {
  id: string;
  startJdUt: number;
  endJdUt: number;
  focusJdUt?: number;
  label: string;
  planetId?: number | null;
  planetIds?: readonly number[];
  count?: number;
  maxLaneCount?: number;
  markerColor?: string | null;
  markerColors?: readonly string[];
  intensity?: number;
};

export type TemporalChronomapLane = {
  id: string;
  label: string;
  bands: readonly TemporalChronomapBand[];
  coverage?: readonly TemporalChronomapCoverage[];
};

export type TemporalChronomapConcurrence = {
  id: string;
  startJdUt: number;
  endJdUt: number;
  focusJdUt: number;
  markerJdUt?: number;
  label: string;
  laneIds: readonly string[];
  planetId: number;
  markerColor?: string | null;
  markerColors?: readonly string[];
  count?: number;
  intensity?: number;
  selectable?: boolean;
};

export type TemporalChronomapLabels = {
  map: string;
  timeAxis: string;
  scale: string;
  coverage: string;
  pendingCoverage: string;
  unknownCoverage: string;
  presets: Record<TemporalChronomapPreset, string>;
};

export type TemporalChronomapViewportReason =
  | "preset"
  | "wheel"
  | "pan"
  | "keyboard";

export type TemporalChronomapFocusReason =
  | "axis"
  | "plot"
  | "band"
  | "concurrence"
  | "keyboard";

export type TemporalChronomapProps = {
  lifeStartJdUt: number;
  lifeEndJdUt: number;
  focusJdUt: number;
  focusLabel?: string | null;
  lanes: readonly [
    TemporalChronomapLane,
    TemporalChronomapLane,
    TemporalChronomapLane,
    TemporalChronomapLane,
  ];
  ticks: readonly TemporalChronomapTick[];
  concurrences: readonly TemporalChronomapConcurrence[];
  labels: TemporalChronomapLabels;
  selectedConcurrenceId?: string | null;
  className?: string;
  yearDays?: number;
  minimumSpanDays?: number;
  onViewportSettled?: (
    viewport: TemporalChronomapViewport,
    reason: TemporalChronomapViewportReason,
  ) => void;
  onFocusSettled?: (focusJdUt: number, reason: TemporalChronomapFocusReason) => void;
  onBandSelect?: (laneId: string, bandId: string) => void;
  onConcurrenceSelect?: (concurrenceId: string) => void;
};

type PositionedBand = {
  band: TemporalChronomapBand;
  slot: number;
  slotCount: number;
};

type PanGesture = {
  pointerId: number;
  startY: number;
  latestY: number;
  moved: boolean;
  viewport: TemporalChronomapViewport;
};

const MINIMUM_SPAN_DAYS = 1 / 24;
const POINTER_CLICK_THRESHOLD_PX = 4;

export function TemporalChronomap({
  lifeStartJdUt,
  lifeEndJdUt,
  focusJdUt,
  focusLabel,
  lanes,
  ticks,
  concurrences,
  labels,
  selectedConcurrenceId,
  className,
  yearDays = TEMPORAL_CHRONOMAP_YEAR_DAYS,
  minimumSpanDays = MINIMUM_SPAN_DAYS,
  onViewportSettled,
  onFocusSettled,
  onBandSelect,
  onConcurrenceSelect,
}: TemporalChronomapProps) {
  const world = React.useMemo(
    () => temporalChronomapWorld(lifeStartJdUt, lifeEndJdUt),
    [lifeEndJdUt, lifeStartJdUt],
  );
  const [viewport, setViewport] = React.useState<TemporalChronomapViewport>(world);
  const [localFocusJdUt, setLocalFocusJdUt] = React.useState(() =>
    clamp(focusJdUt, world.startJdUt, world.endJdUt),
  );
  const [activePreset, setActivePreset] = React.useState<TemporalChronomapPreset | null>("life");
  const [observedWorld, setObservedWorld] = React.useState(world);
  const [observedFocusJdUt, setObservedFocusJdUt] = React.useState(focusJdUt);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef(viewport);
  const focusRef = React.useRef(localFocusJdUt);
  const panGestureRef = React.useRef<PanGesture | null>(null);
  const panFrameRef = React.useRef(0);
  const viewportSettleRef = React.useRef<number | null>(null);
  const focusSettleRef = React.useRef<number | null>(null);
  const onViewportSettledRef = React.useRef(onViewportSettled);
  const onFocusSettledRef = React.useRef(onFocusSettled);

  if (
    observedWorld.startJdUt !== world.startJdUt
    || observedWorld.endJdUt !== world.endJdUt
  ) {
    const nextFocus = clamp(focusJdUt, world.startJdUt, world.endJdUt);
    setObservedWorld(world);
    setObservedFocusJdUt(focusJdUt);
    setViewport(world);
    setLocalFocusJdUt(nextFocus);
    setActivePreset("life");
  } else if (!Object.is(observedFocusJdUt, focusJdUt)) {
    const nextFocus = clamp(focusJdUt, world.startJdUt, world.endJdUt);
    setObservedFocusJdUt(focusJdUt);
    setLocalFocusJdUt(nextFocus);
  }

  React.useEffect(() => {
    onViewportSettledRef.current = onViewportSettled;
  }, [onViewportSettled]);
  React.useEffect(() => {
    onFocusSettledRef.current = onFocusSettled;
  }, [onFocusSettled]);

  React.useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  React.useEffect(() => {
    focusRef.current = localFocusJdUt;
  }, [localFocusJdUt]);

  React.useEffect(
    () => () => {
      if (viewportSettleRef.current != null) {
        window.clearTimeout(viewportSettleRef.current);
      }
      if (focusSettleRef.current != null) {
        window.clearTimeout(focusSettleRef.current);
      }
      window.cancelAnimationFrame(panFrameRef.current);
    },
    [],
  );

  const emitViewportAfterSettle = React.useCallback(
    (
      nextViewport: TemporalChronomapViewport,
      reason: TemporalChronomapViewportReason,
      delay = TEMPORAL_CHRONOMAP_SETTLE_MS,
    ) => {
      if (viewportSettleRef.current != null) {
        window.clearTimeout(viewportSettleRef.current);
      }
      viewportSettleRef.current = window.setTimeout(() => {
        viewportSettleRef.current = null;
        onViewportSettledRef.current?.(nextViewport, reason);
      }, delay);
    },
    [],
  );

  const emitFocusAfterSettle = React.useCallback(
    (
      nextFocusJdUt: number,
      reason: TemporalChronomapFocusReason,
      delay = TEMPORAL_CHRONOMAP_SETTLE_MS,
    ) => {
      if (focusSettleRef.current != null) {
        window.clearTimeout(focusSettleRef.current);
      }
      focusSettleRef.current = window.setTimeout(() => {
        focusSettleRef.current = null;
        onFocusSettledRef.current?.(nextFocusJdUt, reason);
      }, delay);
    },
    [],
  );

  const commitViewport = React.useCallback(
    (
      nextViewport: TemporalChronomapViewport,
      reason: TemporalChronomapViewportReason,
      settleDelay = TEMPORAL_CHRONOMAP_SETTLE_MS,
    ) => {
      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      emitViewportAfterSettle(nextViewport, reason, settleDelay);
    },
    [emitViewportAfterSettle],
  );

  const commitFocus = React.useCallback(
    (
      nextFocusJdUt: number,
      reason: TemporalChronomapFocusReason,
      settleDelay = 0,
    ) => {
      const boundedFocus = clamp(nextFocusJdUt, world.startJdUt, world.endJdUt);
      focusRef.current = boundedFocus;
      setLocalFocusJdUt(boundedFocus);
      emitFocusAfterSettle(boundedFocus, reason, settleDelay);
    },
    [emitFocusAfterSettle, world.endJdUt, world.startJdUt],
  );

  const selectPreset = React.useCallback(
    (preset: TemporalChronomapPreset) => {
      const nextViewport = temporalChronomapViewportForPreset(
        preset,
        world,
        focusRef.current,
        yearDays,
        minimumSpanDays,
      );
      setActivePreset(preset);
      commitViewport(nextViewport, "preset", 0);
    },
    [commitViewport, minimumSpanDays, world, yearDays],
  );

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const pointerRatio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const current = viewportRef.current;
      const anchorJdUt = temporalChronomapJdAtRatio(current, pointerRatio);
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      const delta = clamp(event.deltaY * modeScale, -240, 240);
      const factor = Math.exp(delta * 0.0025);
      const nextViewport = zoomTemporalChronomapViewport(
        current,
        world,
        anchorJdUt,
        factor,
        minimumSpanDays,
      );
      setActivePreset(null);
      commitViewport(nextViewport, "wheel");
    },
    [commitViewport, minimumSpanDays, world],
  );

  const updatePanFrame = React.useCallback(() => {
    panFrameRef.current = 0;
    const gesture = panGestureRef.current;
    const body = bodyRef.current;
    if (!gesture || !body || body.clientHeight <= 0) return;
    const deltaRatio = (gesture.latestY - gesture.startY) / body.clientHeight;
    const nextViewport = panTemporalChronomapViewport(
      gesture.viewport,
      world,
      -deltaRatio * temporalChronomapSpan(gesture.viewport),
    );
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  }, [world]);

  const schedulePanFrame = React.useCallback(() => {
    if (panFrameRef.current) return;
    panFrameRef.current = window.requestAnimationFrame(updatePanFrame);
  }, [updatePanFrame]);

  const handlePlotPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-chronomap-interactive='true']")) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        latestY: event.clientY,
        moved: false,
        viewport: viewportRef.current,
      };
    },
    [],
  );

  const handlePlotPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.latestY = event.clientY;
      if (Math.abs(gesture.latestY - gesture.startY) >= POINTER_CLICK_THRESHOLD_PX) {
        gesture.moved = true;
      }
      schedulePanFrame();
    },
    [schedulePanFrame],
  );

  const finishPlotPointer = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const gesture = panGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      panGestureRef.current = null;
      window.cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = 0;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (cancelled) {
        viewportRef.current = gesture.viewport;
        setViewport(gesture.viewport);
        return;
      }
      if (!gesture.moved) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = bounds.height > 0
          ? clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
          : 0.5;
        commitFocus(temporalChronomapJdAtRatio(viewportRef.current, ratio), "plot");
        return;
      }
      gesture.latestY = event.clientY;
      const bodyHeight = event.currentTarget.clientHeight;
      if (bodyHeight > 0) {
        const deltaRatio = (gesture.latestY - gesture.startY) / bodyHeight;
        const nextViewport = panTemporalChronomapViewport(
          gesture.viewport,
          world,
          -deltaRatio * temporalChronomapSpan(gesture.viewport),
        );
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
      }
      setActivePreset(null);
      emitViewportAfterSettle(viewportRef.current, "pan", 0);
    },
    [commitFocus, emitViewportAfterSettle, world],
  );

  const selectNearestConcurrence = React.useCallback(() => {
    const concurrence = nearestSelectableTemporalConcurrence(
      concurrences,
      viewportRef.current,
      focusRef.current,
    );
    if (!concurrence) return false;
    commitFocus(concurrence.focusJdUt, "concurrence");
    onConcurrenceSelect?.(concurrence.id);
    return true;
  }, [commitFocus, concurrences, onConcurrenceSelect]);

  const handleAxisPointer = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, phase: "start" | "move" | "end" | "cancel") => {
      if (event.button !== 0 && phase === "start") return;
      if (!event.isPrimary) return;
      if (phase === "start") {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }
      if (phase === "cancel") {
        event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const nextFocus = temporalChronomapJdAtRatio(viewportRef.current, ratio);
      focusRef.current = nextFocus;
      setLocalFocusJdUt(nextFocus);
      if (phase === "end") {
        event.currentTarget.releasePointerCapture(event.pointerId);
        emitFocusAfterSettle(nextFocus, "axis", 0);
      }
    },
    [emitFocusAfterSettle],
  );

  const handleMapKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const current = viewportRef.current;
      const span = temporalChronomapSpan(current);
      let nextViewport: TemporalChronomapViewport | null = null;
      if (event.key === "ArrowUp") {
        nextViewport = panTemporalChronomapViewport(current, world, -span * 0.1);
      } else if (event.key === "ArrowDown") {
        nextViewport = panTemporalChronomapViewport(current, world, span * 0.1);
      } else if (event.key === "PageUp") {
        nextViewport = panTemporalChronomapViewport(current, world, -span * 0.8);
      } else if (event.key === "PageDown") {
        nextViewport = panTemporalChronomapViewport(current, world, span * 0.8);
      } else if (event.key === "+" || event.key === "=") {
        nextViewport = zoomTemporalChronomapViewport(
          current,
          world,
          focusRef.current,
          0.7,
          minimumSpanDays,
        );
      } else if (event.key === "-" || event.key === "_") {
        nextViewport = zoomTemporalChronomapViewport(
          current,
          world,
          focusRef.current,
          1 / 0.7,
          minimumSpanDays,
        );
      } else if (event.key === "Home") {
        nextViewport = world;
        setActivePreset("life");
      } else if (event.key === "Enter" && selectNearestConcurrence()) {
        event.preventDefault();
        return;
      }
      if (!nextViewport) return;
      event.preventDefault();
      if (event.key !== "Home") setActivePreset(null);
      commitViewport(nextViewport, "keyboard");
    },
    [commitViewport, minimumSpanDays, selectNearestConcurrence, world],
  );

  const handleAxisKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && selectNearestConcurrence()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const step = Math.max(minimumSpanDays, temporalChronomapSpan(viewportRef.current) / 100);
      let nextFocus: number | null = null;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextFocus = focusRef.current - step;
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextFocus = focusRef.current + step;
      } else if (event.key === "Home") {
        nextFocus = viewportRef.current.startJdUt;
      } else if (event.key === "End") {
        nextFocus = viewportRef.current.endJdUt;
      }
      if (nextFocus == null) return;
      event.preventDefault();
      event.stopPropagation();
      commitFocus(nextFocus, "keyboard", TEMPORAL_CHRONOMAP_SETTLE_MS);
    },
    [commitFocus, minimumSpanDays, selectNearestConcurrence],
  );

  const focusTop = temporalChronomapPercent(localFocusJdUt, viewport);
  const focusLabelIsCurrent = Math.abs(localFocusJdUt - focusJdUt) < 1e-8;
  const visibleTicks = React.useMemo(
    () => visibleTemporalChronomapTicks(ticks, viewport),
    [ticks, viewport],
  );

  return (
    <section
      className={[styles.root, className].filter(Boolean).join(" ")}
      aria-label={labels.map}
      data-temporal-chronomap="true"
      data-temporal-lane-count="4"
      data-temporal-preset={activePreset ?? "custom"}
      data-temporal-viewport-start={viewport.startJdUt}
      data-temporal-viewport-end={viewport.endJdUt}
    >
      <div className={styles.toolbar}>
        <div className={styles.presets} role="group" aria-label={labels.scale}>
          {TEMPORAL_CHRONOMAP_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={activePreset === preset ? styles.presetActive : styles.preset}
              aria-pressed={activePreset === preset}
              onClick={() => selectPreset(preset)}
            >
              {labels.presets[preset]}
            </button>
          ))}
        </div>
        <div className={styles.coverageLegend} role="group" aria-label={labels.coverage}>
          <span className={styles.legendItem}>
            <span className={styles.pendingSwatch} aria-hidden="true" />
            <span>{labels.pendingCoverage}</span>
          </span>
          <span className={styles.legendItem}>
            <span className={styles.unknownSwatch} aria-hidden="true" />
            <span>{labels.unknownCoverage}</span>
          </span>
        </div>
      </div>

      <div className={styles.columnHeaders}>
        <div className={styles.axisHeader} title={labels.timeAxis}>
          {labels.timeAxis}
        </div>
        {lanes.map((lane) => (
          <div key={lane.id} className={styles.laneHeader} title={lane.label}>
            {lane.label}
          </div>
        ))}
      </div>

      <div
        ref={bodyRef}
        className={styles.mapBody}
        role="group"
        tabIndex={0}
        aria-keyshortcuts="Enter"
        aria-label={labels.map}
        onWheel={handleWheel}
        onPointerDown={handlePlotPointerDown}
        onPointerMove={handlePlotPointerMove}
        onPointerUp={(event) => finishPlotPointer(event, false)}
        onPointerCancel={(event) => finishPlotPointer(event, true)}
        onKeyDown={handleMapKeyDown}
      >
        <div className={styles.mapGrid}>
          <div
            className={styles.axis}
            role="group"
            tabIndex={0}
            aria-keyshortcuts="Enter"
            aria-label={
              focusLabelIsCurrent && focusLabel
                ? `${labels.timeAxis}: ${focusLabel}`
                : labels.timeAxis
            }
            data-chronomap-interactive="true"
            onPointerDown={(event) => handleAxisPointer(event, "start")}
            onPointerMove={(event) => handleAxisPointer(event, "move")}
            onPointerUp={(event) => handleAxisPointer(event, "end")}
            onPointerCancel={(event) => handleAxisPointer(event, "cancel")}
            onKeyDown={handleAxisKeyDown}
          >
            {visibleTicks.map((tick) => {
              const top = temporalChronomapPercent(tick.jdUt, viewport);
              return (
                <span
                  key={`${tick.jdUt}:${tick.label}`}
                  className={styles.tickLabel}
                  data-tick-major={tick.major ? "true" : "false"}
                  data-tick-edge={top <= 1 ? "start" : top >= 99 ? "end" : "middle"}
                  style={{ top: `${top}%` }}
                  title={tick.label}
                >
                  {tick.label}
                </span>
              );
            })}
          </div>

          {lanes.map((lane) => (
            <TemporalChronomapLaneColumn
              key={lane.id}
              lane={lane}
              viewport={viewport}
              labels={labels}
              onBandFocus={(band) => {
                commitFocus(
                  band.focusJdUt ?? band.startJdUt + (band.endJdUt - band.startJdUt) / 2,
                  "band",
                );
                onBandSelect?.(lane.id, band.id);
              }}
            />
          ))}
        </div>

        <div className={styles.ruleOverlay} aria-hidden="true">
          {visibleTicks.map((tick) => {
            return (
              <span
                key={`${tick.jdUt}:rule`}
                className={tick.major ? styles.majorRule : styles.minorRule}
                style={{ top: `${temporalChronomapPercent(tick.jdUt, viewport)}%` }}
              />
            );
          })}
        </div>

        <div className={styles.concurrenceOverlay}>
          {concurrences.map((concurrence) => (
            <TemporalConcurrenceHorizon
              key={concurrence.id}
              concurrence={concurrence}
              lanes={lanes}
              viewport={viewport}
              selected={concurrence.id === selectedConcurrenceId}
              onSelect={() => {
                commitFocus(concurrence.focusJdUt, "concurrence");
                onConcurrenceSelect?.(concurrence.id);
              }}
            />
          ))}
        </div>

        {focusTop >= 0 && focusTop <= 100 ? (
          <span
            className={styles.focusLine}
            aria-hidden="true"
            style={{ top: `${focusTop}%` }}
          />
        ) : null}
      </div>
    </section>
  );
}

function TemporalChronomapLaneColumn({
  lane,
  viewport,
  labels,
  onBandFocus,
}: {
  lane: TemporalChronomapLane;
  viewport: TemporalChronomapViewport;
  labels: TemporalChronomapLabels;
  onBandFocus: (band: TemporalChronomapBand) => void;
}) {
  const positionedBands = React.useMemo(
    () => layoutTemporalChronomapBands(lane.bands, viewport),
    [lane.bands, viewport],
  );
  const coverage = React.useMemo(
    () => temporalChronomapCoverageSegments(viewport, lane.coverage ?? []),
    [lane.coverage, viewport],
  );

  return (
    <div className={styles.lane} data-temporal-lane-id={lane.id} aria-label={lane.label}>
      {coverage.map((segment, index) => (
        <TemporalCoverageSegment
          key={`${segment.startJdUt}:${segment.endJdUt}:${segment.status}:${index}`}
          segment={segment}
          viewport={viewport}
          label={
            segment.status === "pending"
              ? labels.pendingCoverage
              : segment.status === "unknown"
                ? labels.unknownCoverage
                : null
          }
        />
      ))}
      {positionedBands.map(({ band, slot, slotCount }) => {
        const clippedStart = Math.max(band.startJdUt, viewport.startJdUt);
        const clippedEnd = Math.min(band.endJdUt, viewport.endJdUt);
        const top = temporalChronomapPercent(clippedStart, viewport);
        const height = Math.max(0, temporalChronomapPercent(clippedEnd, viewport) - top);
        const bandStyle: React.CSSProperties = {
          top: `${top}%`,
          height: `${height}%`,
          insetInlineStart: `${(slot / slotCount) * 100}%`,
          width: `${100 / slotCount}%`,
          color: band.markerColor ?? "var(--aries-text-muted)",
        };
        const bandOpacity = 0.08 + 0.34 * clamp(band.intensity ?? 0.5, 0, 1);
        const markerColors = band.markerColors?.length
          ? band.markerColors
          : [band.markerColor ?? "var(--aries-text-muted)"];
        return (
          <button
            key={band.id}
            type="button"
            className={styles.band}
            style={bandStyle}
            data-chronomap-interactive="true"
            data-temporal-band-id={band.id}
            data-temporal-planet-id={band.planetId ?? undefined}
            data-temporal-planet-ids={band.planetIds?.join(",") || undefined}
            data-temporal-planet-count={band.planetIds?.length ?? undefined}
            data-temporal-event-count={band.count ?? undefined}
            data-temporal-max-lane-count={band.maxLaneCount ?? undefined}
            tabIndex={-1}
            aria-label={band.label}
            title={band.label}
            onClick={() => onBandFocus(band)}
          >
            <span className={styles.bandFill} style={{ opacity: bandOpacity }} aria-hidden="true">
              {markerColors.map((color, markerIndex) => (
                <span key={`${color}:${markerIndex}`} style={{ backgroundColor: color }} />
              ))}
            </span>
            <span className={styles.bandLabel}>{band.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TemporalCoverageSegment({
  segment,
  viewport,
  label,
}: {
  segment: TemporalChronomapCoverage;
  viewport: TemporalChronomapViewport;
  label: string | null;
}) {
  const patternId = React.useId().replaceAll(":", "");
  const top = temporalChronomapPercent(segment.startJdUt, viewport);
  const height = Math.max(
    0,
    temporalChronomapPercent(segment.endJdUt, viewport) - top,
  );
  const segmentStyle: React.CSSProperties = { top: `${top}%`, height: `${height}%` };
  if (segment.status === "complete") {
    return <span className={styles.coverageComplete} style={segmentStyle} aria-hidden="true" />;
  }
  return (
    <span
      className={
        segment.status === "pending" ? styles.coveragePending : styles.coverageUnknown
      }
      style={segmentStyle}
      role="img"
      aria-label={label ?? undefined}
      data-temporal-coverage={segment.status}
    >
      <svg className={styles.hatch} aria-hidden="true">
        <defs>
          <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
            {segment.status === "pending" ? (
              <path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" />
            ) : (
              <path d="M-2 6 L6 -2 M2 10 L10 2 M-2 2 L2 -2 M6 10 L10 6" />
            )}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </span>
  );
}

function TemporalConcurrenceHorizon({
  concurrence,
  lanes,
  viewport,
  selected,
  onSelect,
}: {
  concurrence: TemporalChronomapConcurrence;
  lanes: TemporalChronomapProps["lanes"];
  viewport: TemporalChronomapViewport;
  selected: boolean;
  onSelect: () => void;
}) {
  const markerJdUt = concurrence.markerJdUt ?? concurrence.focusJdUt;
  if (
    markerJdUt < viewport.startJdUt
    || markerJdUt > viewport.endJdUt
  ) {
    return null;
  }
  const participantIndices = Array.from(new Set(
    concurrence.laneIds
      .map((laneId) => lanes.findIndex((lane) => lane.id === laneId))
      .filter((laneIndex) => laneIndex >= 0),
  )).sort((left, right) => left - right);
  if (participantIndices.length < 2 || participantIndices.length > 4) return null;
  const firstLane = participantIndices[0];
  const lastLane = participantIndices[participantIndices.length - 1];
  const laneSpan = lastLane - firstLane + 1;
  const horizonStyle: React.CSSProperties = {
    top: `${temporalChronomapPercent(markerJdUt, viewport)}%`,
    insetInlineStart: `${firstLane * 25}%`,
    width: `${laneSpan * 25}%`,
    color: concurrence.markerColor ?? "var(--aries-text-muted)",
    opacity: 0.25 + 0.75 * clamp(concurrence.intensity ?? 1, 0, 1),
  };
  const markerColors = concurrence.markerColors?.length
    ? concurrence.markerColors
    : [concurrence.markerColor ?? "var(--aries-text-muted)"];
  const content = (
    <>
      <span className={styles.horizonLine} aria-hidden="true">
        {markerColors.map((color, markerIndex) => (
          <span key={`${color}:${markerIndex}`} style={{ backgroundColor: color }} />
        ))}
      </span>
      {participantIndices.map((laneIndex) => (
        <span
          key={laneIndex}
          className={styles.horizonNode}
          aria-hidden="true"
          style={{
            insetInlineStart: `${((laneIndex - firstLane + 0.5) / laneSpan) * 100}%`,
          }}
        />
      ))}
    </>
  );
  const dataProps = {
    "data-temporal-concurrence-id": concurrence.id,
    "data-temporal-concurrence-count": participantIndices.length,
    "data-temporal-planet-id": concurrence.planetId,
    "data-temporal-group-count": concurrence.count,
  };
  if (concurrence.selectable === false) {
    return (
      <span className={styles.horizonAggregate} style={horizonStyle} {...dataProps}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={selected ? styles.horizonSelected : styles.horizon}
      style={horizonStyle}
      data-chronomap-interactive="true"
      tabIndex={-1}
      aria-label={concurrence.label}
      title={concurrence.label}
      onClick={onSelect}
      {...dataProps}
    >
      {content}
    </button>
  );
}

export function temporalChronomapWorld(
  lifeStartJdUt: number,
  lifeEndJdUt: number,
): TemporalChronomapViewport {
  if (
    !Number.isFinite(lifeStartJdUt)
    || !Number.isFinite(lifeEndJdUt)
    || lifeEndJdUt <= lifeStartJdUt
  ) {
    throw new RangeError("Temporal chronomap requires finite, increasing JD bounds");
  }
  return { startJdUt: lifeStartJdUt, endJdUt: lifeEndJdUt };
}

export function temporalChronomapSpan(viewport: TemporalChronomapViewport): number {
  return viewport.endJdUt - viewport.startJdUt;
}

export function temporalChronomapViewportForPreset(
  preset: TemporalChronomapPreset,
  world: TemporalChronomapViewport,
  focusJdUt: number,
  yearDays = TEMPORAL_CHRONOMAP_YEAR_DAYS,
  minimumSpanDays = MINIMUM_SPAN_DAYS,
): TemporalChronomapViewport {
  if (preset === "life") return world;
  const requestedSpan = {
    decade: yearDays * 10,
    year: yearDays,
    month: yearDays / 12,
    week: 7,
    day: 1,
  }[preset];
  return fitTemporalChronomapViewport(
    world,
    focusJdUt,
    Math.max(minimumSpanDays, requestedSpan),
  );
}

export function fitTemporalChronomapViewport(
  world: TemporalChronomapViewport,
  centerJdUt: number,
  requestedSpanDays: number,
): TemporalChronomapViewport {
  const worldSpan = temporalChronomapSpan(world);
  const span = clamp(requestedSpanDays, Math.min(worldSpan, MINIMUM_SPAN_DAYS), worldSpan);
  let startJdUt = clamp(centerJdUt, world.startJdUt, world.endJdUt) - span / 2;
  startJdUt = clamp(startJdUt, world.startJdUt, world.endJdUt - span);
  return { startJdUt, endJdUt: startJdUt + span };
}

export function zoomTemporalChronomapViewport(
  viewport: TemporalChronomapViewport,
  world: TemporalChronomapViewport,
  anchorJdUt: number,
  factor: number,
  minimumSpanDays = MINIMUM_SPAN_DAYS,
): TemporalChronomapViewport {
  const worldSpan = temporalChronomapSpan(world);
  const currentSpan = temporalChronomapSpan(viewport);
  const nextSpan = clamp(
    currentSpan * (Number.isFinite(factor) && factor > 0 ? factor : 1),
    Math.min(minimumSpanDays, worldSpan),
    worldSpan,
  );
  const boundedAnchor = clamp(anchorJdUt, viewport.startJdUt, viewport.endJdUt);
  const anchorRatio = currentSpan > 0
    ? (boundedAnchor - viewport.startJdUt) / currentSpan
    : 0.5;
  let startJdUt = boundedAnchor - anchorRatio * nextSpan;
  startJdUt = clamp(startJdUt, world.startJdUt, world.endJdUt - nextSpan);
  return { startJdUt, endJdUt: startJdUt + nextSpan };
}

export function panTemporalChronomapViewport(
  viewport: TemporalChronomapViewport,
  world: TemporalChronomapViewport,
  deltaDays: number,
): TemporalChronomapViewport {
  const span = Math.min(temporalChronomapSpan(viewport), temporalChronomapSpan(world));
  const startJdUt = clamp(
    viewport.startJdUt + deltaDays,
    world.startJdUt,
    world.endJdUt - span,
  );
  return { startJdUt, endJdUt: startJdUt + span };
}

export function temporalChronomapJdAtRatio(
  viewport: TemporalChronomapViewport,
  ratio: number,
): number {
  return viewport.startJdUt + clamp(ratio, 0, 1) * temporalChronomapSpan(viewport);
}

export function temporalChronomapPercent(
  jdUt: number,
  viewport: TemporalChronomapViewport,
): number {
  const span = temporalChronomapSpan(viewport);
  if (span <= 0) return 0;
  return ((jdUt - viewport.startJdUt) / span) * 100;
}

export function visibleTemporalChronomapTicks(
  ticks: readonly TemporalChronomapTick[],
  viewport: TemporalChronomapViewport,
): TemporalChronomapTick[] {
  return ticks
    .filter((tick) => (
      Number.isFinite(tick.jdUt)
      && tick.jdUt >= viewport.startJdUt
      && tick.jdUt <= viewport.endJdUt
    ))
    .slice()
    .sort((left, right) => left.jdUt - right.jdUt || left.label.localeCompare(right.label));
}

export function nearestSelectableTemporalConcurrence(
  concurrences: readonly TemporalChronomapConcurrence[],
  viewport: TemporalChronomapViewport,
  focusJdUt: number,
): TemporalChronomapConcurrence | null {
  return concurrences
    .filter((concurrence) => {
      if (concurrence.selectable === false) return false;
      const markerJdUt = concurrence.markerJdUt ?? concurrence.focusJdUt;
      return markerJdUt >= viewport.startJdUt && markerJdUt <= viewport.endJdUt;
    })
    .slice()
    .sort((left, right) => {
      const leftMarker = left.markerJdUt ?? left.focusJdUt;
      const rightMarker = right.markerJdUt ?? right.focusJdUt;
      return Math.abs(leftMarker - focusJdUt) - Math.abs(rightMarker - focusJdUt)
        || leftMarker - rightMarker
        || left.id.localeCompare(right.id);
    })[0] ?? null;
}

export function temporalChronomapCoverageSegments(
  viewport: TemporalChronomapViewport,
  coverage: readonly TemporalChronomapCoverage[],
): TemporalChronomapCoverage[] {
  const boundaries = new Set<number>([viewport.startJdUt, viewport.endJdUt]);
  const clipped = coverage.flatMap((segment) => {
    if (
      !Number.isFinite(segment.startJdUt)
      || !Number.isFinite(segment.endJdUt)
      || segment.endJdUt <= segment.startJdUt
    ) {
      return [];
    }
    const startJdUt = Math.max(viewport.startJdUt, segment.startJdUt);
    const endJdUt = Math.min(viewport.endJdUt, segment.endJdUt);
    if (endJdUt <= startJdUt) return [];
    boundaries.add(startJdUt);
    boundaries.add(endJdUt);
    return [{ ...segment, startJdUt, endJdUt }];
  });
  const ordered = Array.from(boundaries).sort((left, right) => left - right);
  const precedence: Record<TemporalChronomapCoverageStatus, number> = {
    unknown: 0,
    pending: 1,
    complete: 2,
  };
  const segments: TemporalChronomapCoverage[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const startJdUt = ordered[index];
    const endJdUt = ordered[index + 1];
    if (endJdUt <= startJdUt) continue;
    const midpoint = startJdUt + (endJdUt - startJdUt) / 2;
    const status = clipped
      .filter((segment) => segment.startJdUt <= midpoint && segment.endJdUt >= midpoint)
      .sort((left, right) => precedence[right.status] - precedence[left.status])[0]?.status
      ?? "unknown";
    const previous = segments[segments.length - 1];
    if (previous?.status === status && previous.endJdUt === startJdUt) {
      previous.endJdUt = endJdUt;
    } else {
      segments.push({ startJdUt, endJdUt, status });
    }
  }
  return segments;
}

export function layoutTemporalChronomapBands(
  bands: readonly TemporalChronomapBand[],
  viewport: TemporalChronomapViewport,
): PositionedBand[] {
  const visible = bands
    .filter((band) => (
      Number.isFinite(band.startJdUt)
      && Number.isFinite(band.endJdUt)
      && band.endJdUt >= band.startJdUt
      && band.endJdUt >= viewport.startJdUt
      && band.startJdUt <= viewport.endJdUt
    ))
    .slice()
    .sort((left, right) => (
      left.startJdUt - right.startJdUt
      || left.endJdUt - right.endJdUt
      || left.id.localeCompare(right.id)
    ));
  const slotEnds: number[] = [];
  const assigned = visible.map((band) => {
    const start = Math.max(band.startJdUt, viewport.startJdUt);
    let slot = slotEnds.findIndex((slotEnd) => slotEnd <= start);
    if (slot < 0) {
      slot = slotEnds.length;
      slotEnds.push(band.endJdUt);
    } else {
      slotEnds[slot] = band.endJdUt;
    }
    return { band, slot };
  });
  const slotCount = Math.max(1, slotEnds.length);
  return assigned.map((item) => ({ ...item, slotCount }));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
