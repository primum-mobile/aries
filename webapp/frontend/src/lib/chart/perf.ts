// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveShellHost } from "@/lib/shell-host";
import performanceBudgets from "./performance-budgets.json";
import {
  STEP_CADENCE_SCHEMA_VERSION,
  createStepCadenceCollector,
} from "./step-cadence.mjs";

export type ChartPerfEvent = {
  name: string;
  at: number;
  detail: Record<string, unknown>;
};

declare global {
  interface Window {
    __ARIES_CHART_PERF_EVENTS__?: ChartPerfEvent[];
    __ARIES_CHART_PERF_CONSOLE__?: boolean;
    __ARIES_STARTUP_MILESTONES__?: Record<string, number>;
    __ARIES_NATIVE_PERF__?: boolean;
    __ARIES_SPEEDLOG__?: boolean;
  }
}

type SpeedlogSample = {
  at: number;
  value: number;
};

type PendingChartStep = {
  at: number;
  docId: string | null;
  displayDatetime: string | null;
  key: string | null;
  inputIds: number[];
  appliedInputs: number;
};

const SPEEDLOG_FLUSH_MS = 10_000;
const SPEEDLOG_MAX_SAMPLES = 240;
const SPEEDLOG_INCOMPLETE_DRAIN_MS = 2_000;
const SPEEDLOG_POST_BURST_TAIL_MS = 120;
const STEP_BOUNDARY_TIMEOUT_MS = 1_000;
const speedlogSamples = new Map<string, SpeedlogSample[]>();
const pendingChartSteps: PendingChartStep[] = [];
const speedlogOpenInputIds = new Set<number>();
let speedlogFlushTimer: ReturnType<typeof setTimeout> | null = null;
let speedlogFlushPending = false;
let speedlogWindowStartedAt: number | null = null;
let speedlogWindowId = 0;
let speedlogBurstActive = false;
let speedlogBurstOpenedAt: number | null = null;
let speedlogBurstClosedAt: number | null = null;
let speedlogBoundaryProbes = 0;
let stepInputSequence = 0;
let longTaskObserverAttempted = false;
let longTaskSupported = false;
let longTaskObserver: PerformanceObserver | null = null;

const speedlogBudgets = performanceBudgets.metrics as Record<
  string,
  { p95Ms?: number; description: string }
>;

const speedlogDescriptions: Record<string, string> = {
  "time-step.input-gap": "Accepted chart-step input gap",
  "time-step.paint-gap": "Coherent step Canvas-completion gap",
  "time-step.paint-gap-over-input": "Canvas-completion gap delay beyond input cadence",
  "time-step.canvas-to-next-frame": "Canvas completion to next rAF callback",
  "time-step.intent-to-next-frame": "Chart-step input to next rAF callback",
  "time-step.raf-to-post-render-task": "Next rAF callback to post-render task proxy",
  "time-step.canvas-to-post-render-task": "Canvas completion to post-render task proxy",
  "time-step.intent-to-post-render-task": "Chart-step input to post-render task proxy",
  "time-step.next-frame-interval": "First to second rAF opportunity interval",
  "time-step.next-raf-opportunity-gap": "Successive unique next-rAF opportunity gap",
  "time-step.post-render-task-gap": "Successive post-render-task gap",
  "time-step.post-render-gap-over-input": "Post-render-task gap delay beyond input cadence",
  "time-step.post-render-gap-delta": "Absolute post-render-task versus input gap delta",
  "time-step.session-change-after-canvas": "Pure-step session notification delay after Canvas",
  "time-step.session-change-before-canvas": "Canvas delay after an early pure-step session notification",
  "browser.long-task": "Browser main-thread long task during held stepping",
};

export function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function chartPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__ARIES_NATIVE_PERF__ === true) return true;
  try {
    return (
      window.localStorage.getItem("ARIES_CHART_PERF") === "1" ||
      new URLSearchParams(window.location.search).get("chartPerf") === "1"
    );
  } catch {
    return false;
  }
}

export function speedlogEnabled(): boolean {
  return typeof window !== "undefined" && window.__ARIES_SPEEDLOG__ === true;
}

export function approxUtf8Bytes(text: string): number {
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).byteLength;
}

function numericDetail(detail: Record<string, unknown>, key: string): number | null {
  const value = detail[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericArrayDetail(detail: Record<string, unknown>, key: string): number[] {
  const value = detail[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === "number" && Number.isInteger(item),
  );
}

function stringDetail(detail: Record<string, unknown>, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" ? value : null;
}

function removePendingChartStepInputs(inputIds: readonly number[]): void {
  if (inputIds.length === 0) return;
  const removed = new Set(inputIds);
  for (let index = pendingChartSteps.length - 1; index >= 0; index -= 1) {
    const pending = pendingChartSteps[index];
    pending.inputIds = pending.inputIds.filter((inputId) => !removed.has(inputId));
    if (pending.inputIds.length === 0) {
      pendingChartSteps.splice(index, 1);
    } else {
      pending.appliedInputs = Math.min(pending.appliedInputs, pending.inputIds.length);
    }
  }
}

function takePendingChartStep(detail: Record<string, unknown>): PendingChartStep | null {
  const paintedDocId = stringDetail(detail, "docId");
  const displayDatetime = stringDetail(detail, "displayDatetime");
  const stepIndex = pendingChartSteps.findIndex((step) => {
    if (step.docId != null && paintedDocId !== step.docId) return false;
    if (step.displayDatetime != null && displayDatetime !== step.displayDatetime) return false;
    return true;
  });
  if (stepIndex < 0) return null;
  return pendingChartSteps.splice(stepIndex, 1)[0] ?? null;
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function touchSpeedlogWindow(at: number): void {
  if (!speedlogEnabled()) return;
  if (speedlogWindowStartedAt == null) speedlogWindowStartedAt = at;
  if (speedlogFlushTimer == null && !speedlogFlushPending) {
    speedlogFlushTimer = setTimeout(flushSpeedlog, SPEEDLOG_FLUSH_MS);
  }
}

function addSpeedlogSample(metric: string, value: number, at: number): void {
  if (!speedlogEnabled() || !Number.isFinite(value) || value < 0) return;
  touchSpeedlogWindow(at);
  const samples = speedlogSamples.get(metric) ?? [];
  samples.push({ at, value });
  if (samples.length > SPEEDLOG_MAX_SAMPLES) {
    samples.splice(0, samples.length - SPEEDLOG_MAX_SAMPLES);
  }
  speedlogSamples.set(metric, samples);
}

const stepCadence = createStepCadenceCollector({
  maxTrackedInputs: SPEEDLOG_MAX_SAMPLES,
  onSample: addSpeedlogSample,
});

function speedlogCanDrain(now: number): boolean {
  if (speedlogBurstActive || speedlogBoundaryProbes > 0) return false;
  if (
    speedlogBurstClosedAt != null &&
    now - speedlogBurstClosedAt < SPEEDLOG_POST_BURST_TAIL_MS
  ) {
    return false;
  }
  if (speedlogOpenInputIds.size === 0) return true;
  const drainAnchor = speedlogBurstClosedAt ?? speedlogWindowStartedAt;
  return drainAnchor != null && now - drainAnchor >= SPEEDLOG_INCOMPLETE_DRAIN_MS;
}

function resumeDeferredSpeedlogFlush(): void {
  if (!speedlogFlushPending || speedlogFlushTimer != null) return;
  const now = perfNow();
  if (speedlogBurstActive || speedlogBoundaryProbes > 0) return;
  const drainAnchor = speedlogBurstClosedAt ?? speedlogWindowStartedAt;
  const incompleteWait = speedlogOpenInputIds.size > 0 && drainAnchor != null
    ? Math.max(0, SPEEDLOG_INCOMPLETE_DRAIN_MS - (now - drainAnchor))
    : 0;
  const tailWait = speedlogBurstClosedAt != null
    ? Math.max(0, SPEEDLOG_POST_BURST_TAIL_MS - (now - speedlogBurstClosedAt))
    : 0;
  speedlogFlushTimer = setTimeout(flushSpeedlog, Math.max(incompleteWait, tailWait));
}

function flushSpeedlog(): void {
  speedlogFlushTimer = null;
  if (!speedlogEnabled() || speedlogWindowStartedAt == null) return;
  const endedAt = perfNow();
  if (!speedlogCanDrain(endedAt)) {
    speedlogFlushPending = true;
    resumeDeferredSpeedlogFlush();
    return;
  }
  speedlogFlushPending = false;
  if (speedlogOpenInputIds.size > 0) {
    const unresolvedInputIds = [...speedlogOpenInputIds];
    stepCadence.resolveInputsWithoutBoundary(unresolvedInputIds, "summary-drain-timeout");
    removePendingChartStepInputs(unresolvedInputIds);
    speedlogOpenInputIds.clear();
  }
  const metrics = Array.from(speedlogSamples.entries()).map(([name, samples]) => {
    const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
    const p95Ms = percentile(values, 0.95);
    const budgetMs = speedlogBudgets[name]?.p95Ms ?? null;
    return {
      name,
      description: speedlogBudgets[name]?.description ?? speedlogDescriptions[name] ?? name,
      samples: values.length,
      averageMs: values.reduce((total, value) => total + value, 0) / values.length,
      minimumMs: values.at(0) ?? null,
      p05Ms: percentile(values, 0.05),
      p50Ms: percentile(values, 0.5),
      p95Ms,
      maxMs: values.at(-1) ?? null,
      budgetMs,
      breached: values.length >= 10 && budgetMs != null && p95Ms != null && p95Ms > budgetMs,
    };
  });
  const cadence = stepCadence.snapshot();
  speedlogSamples.clear();
  speedlogWindowId += 1;
  const event: ChartPerfEvent = {
    name: "speedlog-summary",
    at: endedAt,
    detail: {
      schemaVersion: 2,
      windowId: speedlogWindowId,
      windowStartedAt: speedlogWindowStartedAt,
      windowEndedAt: endedAt,
      budgetVersion: performanceBudgets.version,
      cadenceSchemaVersion: STEP_CADENCE_SCHEMA_VERSION,
      counters: cadence.counters,
      outcomes: cadence.outcomes,
      capabilities: cadence.capabilities,
      metrics,
    },
  };
  speedlogWindowStartedAt = null;
  speedlogBurstOpenedAt = null;
  speedlogBurstClosedAt = null;
  speedlogOpenInputIds.clear();
  stepCadence.reset();
  stepCadence.setCapability("longTask", longTaskSupported);
  if (metrics.some((metric) => metric.breached)) {
    console.warn("[aries-speedlog] performance budget exceeded", metrics);
  }
  void resolveShellHost().recordFrontendPerf(event).catch(() => {});
}

function ensureLongTaskObserver(): void {
  if (!speedlogEnabled() || longTaskObserverAttempted || typeof PerformanceObserver === "undefined") {
    return;
  }
  longTaskObserverAttempted = true;
  longTaskSupported = PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
  stepCadence.setCapability("longTask", longTaskSupported);
  if (!longTaskSupported) return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (speedlogBurstOpenedAt == null) continue;
        const entryEnd = entry.startTime + entry.duration;
        const burstEnd = speedlogBurstClosedAt ?? Number.POSITIVE_INFINITY;
        if (entryEnd < speedlogBurstOpenedAt || entry.startTime > burstEnd) continue;
        stepCadence.recordLongTask({ duration: entry.duration, at: entry.startTime });
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    longTaskSupported = false;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    stepCadence.setCapability("longTask", false);
  }
}

/** Keep native summary I/O outside a physical held-key envelope. */
export function setChartStepBurstActive(active: boolean): void {
  if (speedlogBurstActive === active) return;
  speedlogBurstActive = active;
  if (active) {
    speedlogBurstOpenedAt = perfNow();
    speedlogBurstClosedAt = null;
    stepCadence.beginBurst();
    ensureLongTaskObserver();
    return;
  }
  speedlogBurstClosedAt = perfNow();
  resumeDeferredSpeedlogFlush();
}

/** Record one accepted chart-navigation keydown before queueing/coalescing. */
export function recordChartStepInput(
  docId: string,
  key: string,
  shift: boolean,
  alt: boolean,
  paintsSnapshot: boolean,
  intentAt: number,
): number | null {
  if (typeof window === "undefined" || (!chartPerfEnabled() && !speedlogEnabled())) return null;
  if (speedlogEnabled() && !speedlogBurstActive) stepCadence.beginBurst();
  stepInputSequence += 1;
  const inputId = stepInputSequence;
  recordChartPerfAt("chart-step-input", {
    docId,
    key,
    shift,
    alt,
    paintsSnapshot,
    inputId,
    intentAt,
  }, intentAt);
  return inputId;
}

/** Resolve an accepted input that cannot produce the expected Canvas boundary. */
export function recordChartStepInputsWithoutBoundary(
  inputIds: readonly number[],
  outcome: string,
): void {
  if (inputIds.length === 0) return;
  recordChartPerf("chart-step-input-outcome", { inputIds: [...inputIds], outcome });
}

function scheduleStepRenderBoundary(event: ChartPerfEvent): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    recordChartStepInputsWithoutBoundary(
      numericArrayDetail(event.detail, "stepInputIds"),
      "frame-boundary-unavailable",
    );
    return;
  }
  const inputIds = numericArrayDetail(event.detail, "stepInputIds");
  const appliedInputs = numericDetail(event.detail, "stepAppliedInputs") ?? 1;
  const intentAt = numericDetail(event.detail, "stepIntentAt");
  const docId = typeof event.detail.docId === "string" ? event.detail.docId : null;
  const canvasAt = event.at;
  let nextFrameAt: number | null = null;
  let postRenderAt: number | null = null;
  let secondFrameAt: number | null = null;
  let nextFrameTimestamp: number | null = null;
  let secondFrameTimestamp: number | null = null;
  let callbackOrder = 0;
  let postRenderOrder: number | null = null;
  let secondFrameOrder: number | null = null;
  let finished = false;
  if (speedlogEnabled()) speedlogBoundaryProbes += 1;

  const finish = (timedOut = false) => {
    if (finished) return;
    if (!timedOut && (postRenderAt == null || secondFrameAt == null)) return;
    finished = true;
    window.clearTimeout(watchdog);
    recordChartPerf("chart-step-render-boundary", {
      docId,
      inputIds,
      appliedInputs,
      intentAt,
      canvasAt,
      nextFrameAt,
      postRenderAt,
      secondFrameAt,
      nextFrameTimestamp,
      secondFrameTimestamp,
      postRenderOrder,
      secondFrameOrder,
      postRenderTaskLate:
        postRenderOrder != null &&
        secondFrameOrder != null &&
        postRenderOrder > secondFrameOrder,
      timedOut,
    });
    if (speedlogEnabled()) {
      speedlogBoundaryProbes = Math.max(0, speedlogBoundaryProbes - 1);
      resumeDeferredSpeedlogFlush();
    }
  };
  const watchdog = window.setTimeout(() => finish(true), STEP_BOUNDARY_TIMEOUT_MS);
  window.requestAnimationFrame((timestamp) => {
    if (finished) return;
    callbackOrder += 1;
    nextFrameTimestamp = timestamp;
    nextFrameAt = perfNow();
    window.setTimeout(() => {
      if (finished) return;
      callbackOrder += 1;
      postRenderOrder = callbackOrder;
      postRenderAt = perfNow();
      finish();
    }, 0);
    window.requestAnimationFrame((nextTimestamp) => {
      if (finished) return;
      callbackOrder += 1;
      secondFrameOrder = callbackOrder;
      secondFrameTimestamp = nextTimestamp;
      secondFrameAt = perfNow();
      finish();
    });
  });
}

function collectSpeedlogSample(event: ChartPerfEvent): void {
  if (!speedlogEnabled()) return;
  if (event.name === "chart-step-input") {
    if (event.detail.paintsSnapshot !== true) return;
    const inputId = numericDetail(event.detail, "inputId");
    const intentAt = numericDetail(event.detail, "intentAt") ?? event.at;
    if (inputId == null) return;
    touchSpeedlogWindow(intentAt);
    speedlogOpenInputIds.add(inputId);
    if (speedlogOpenInputIds.size > SPEEDLOG_MAX_SAMPLES) {
      const oldestInputId = speedlogOpenInputIds.values().next().value;
      if (oldestInputId !== undefined) {
        speedlogOpenInputIds.delete(oldestInputId);
        stepCadence.resolveInputsWithoutBoundary([oldestInputId], "input-capacity");
      }
    }
    stepCadence.recordRawInput({
      inputId,
      at: intentAt,
      docId: typeof event.detail.docId === "string" ? event.detail.docId : null,
    });
    return;
  }
  if (event.name === "chart-step-intent") {
    touchSpeedlogWindow(event.at);
    stepCadence.recordIntent({
      appliedInputs: numericDetail(event.detail, "repeat") ?? 1,
    });
    return;
  }
  if (event.name === "chart-canvas-paint") {
    const totalMs = numericDetail(event.detail, "totalMs");
    const mode = typeof event.detail.mode === "string" ? event.detail.mode : "unknown";
    if (totalMs != null) addSpeedlogSample(`chart.canvas.${mode}`, totalMs, event.at);
    const stepFirstPaintMs = numericDetail(event.detail, "stepIntentToPaintMs");
    if (stepFirstPaintMs != null) {
      addSpeedlogSample("time-step.first-useful-paint", stepFirstPaintMs, event.at);
    }
    const stepInputIds = numericArrayDetail(event.detail, "stepInputIds");
    if (stepInputIds.length > 0 && numericDetail(event.detail, "stepIntentAt") != null) {
      stepCadence.recordCanvas({
        inputIds: stepInputIds,
        appliedInputs: numericDetail(event.detail, "stepAppliedInputs") ?? 1,
        intentAt: numericDetail(event.detail, "stepIntentAt"),
        at: event.at,
        docId: typeof event.detail.docId === "string" ? event.detail.docId : null,
        displayDatetime:
          typeof event.detail.displayDatetime === "string"
            ? event.detail.displayDatetime
            : null,
      });
    }
    return;
  }
  if (event.name === "chart-canvas-paint-suppressed") {
    const inputIds = numericArrayDetail(event.detail, "stepInputIds");
    if (inputIds.length === 0) return;
    touchSpeedlogWindow(event.at);
    stepCadence.resolveInputsWithoutBoundary(inputIds, "paint-suppressed");
    for (const inputId of inputIds) speedlogOpenInputIds.delete(inputId);
    resumeDeferredSpeedlogFlush();
    return;
  }
  if (event.name === "chart-step-render-boundary") {
    const inputIds = numericArrayDetail(event.detail, "inputIds");
    touchSpeedlogWindow(event.at);
    if (event.detail.timedOut === true) {
      stepCadence.recordBoundaryTimeout(inputIds);
      for (const inputId of inputIds) speedlogOpenInputIds.delete(inputId);
      resumeDeferredSpeedlogFlush();
      return;
    }
    const boundaryDetail = {
      inputIds,
      appliedInputs: numericDetail(event.detail, "appliedInputs") ?? 1,
      intentAt: numericDetail(event.detail, "intentAt"),
      canvasAt: numericDetail(event.detail, "canvasAt") ?? event.at,
      nextFrameAt: numericDetail(event.detail, "nextFrameAt"),
      postRenderAt: numericDetail(event.detail, "postRenderAt"),
      secondFrameAt: numericDetail(event.detail, "secondFrameAt"),
      nextFrameTimestamp: numericDetail(event.detail, "nextFrameTimestamp"),
      secondFrameTimestamp: numericDetail(event.detail, "secondFrameTimestamp"),
      postRenderOrder: numericDetail(event.detail, "postRenderOrder"),
      secondFrameOrder: numericDetail(event.detail, "secondFrameOrder"),
      docId: typeof event.detail.docId === "string" ? event.detail.docId : null,
    };
    const boundaryComplete =
      boundaryDetail.nextFrameAt != null &&
      boundaryDetail.postRenderAt != null &&
      boundaryDetail.secondFrameAt != null &&
      boundaryDetail.nextFrameTimestamp != null &&
      boundaryDetail.secondFrameTimestamp != null &&
      boundaryDetail.postRenderOrder != null &&
      boundaryDetail.secondFrameOrder != null &&
      boundaryDetail.nextFrameAt >= boundaryDetail.canvasAt &&
      boundaryDetail.postRenderAt >= boundaryDetail.nextFrameAt &&
      boundaryDetail.secondFrameAt >= boundaryDetail.nextFrameAt &&
      boundaryDetail.secondFrameTimestamp > boundaryDetail.nextFrameTimestamp &&
      boundaryDetail.postRenderOrder !== boundaryDetail.secondFrameOrder;
    if (boundaryComplete) {
      stepCadence.recordBoundary(boundaryDetail);
    } else {
      stepCadence.resolveInputsWithoutBoundary(inputIds, "incomplete-boundary");
    }
    for (const inputId of inputIds) speedlogOpenInputIds.delete(inputId);
    return;
  }
  if (event.name === "chart-step-input-outcome") {
    const inputIds = numericArrayDetail(event.detail, "inputIds");
    touchSpeedlogWindow(event.at);
    stepCadence.resolveInputsWithoutBoundary(
      inputIds,
      typeof event.detail.outcome === "string" ? event.detail.outcome : "unknown",
    );
    for (const inputId of inputIds) speedlogOpenInputIds.delete(inputId);
    resumeDeferredSpeedlogFlush();
    return;
  }
  if (event.name === "chart-step-session-change") {
    touchSpeedlogWindow(event.at);
    stepCadence.recordSessionChange({
      at: event.at,
      docId: typeof event.detail.docId === "string" ? event.detail.docId : null,
      displayDatetime:
        typeof event.detail.displayDatetime === "string"
          ? event.detail.displayDatetime
          : null,
      duringBurst: event.detail.duringBurst === true,
    });
    return;
  }
  if (event.name === "chart-step-settle-start") {
    touchSpeedlogWindow(event.at);
    stepCadence.recordSettleStart({ duringBurst: event.detail.duringBurst === true });
    return;
  }
  if (event.name === "list-scroll-frame") {
    const eventToFrameMs = numericDetail(event.detail, "eventToFrameMs");
    if (eventToFrameMs != null) {
      addSpeedlogSample("list.scroll-to-frame", eventToFrameMs, event.at);
    }
  }
}

function recordChartPerfAt(
  name: string,
  detail: Record<string, unknown>,
  at: number,
): void {
  if (typeof window === "undefined") return;
  const perfEnabled = chartPerfEnabled();
  const speedlog = speedlogEnabled();
  // Shipping builds with neither explicit profiling nor the automatic
  // speedlog should pay no event-allocation or retention cost at all.
  if (!perfEnabled && !speedlog) return;
  let droppedPendingInputIds: number[] = [];
  if (name === "chart-step-input-outcome") {
    removePendingChartStepInputs(numericArrayDetail(detail, "inputIds"));
  }
  if (name === "chart-step-intent") {
    const intentAt = numericDetail(detail, "intentAt");
    pendingChartSteps.push({
      at: intentAt ?? at,
      docId: stringDetail(detail, "docId"),
      displayDatetime: stringDetail(detail, "displayDatetime"),
      key: stringDetail(detail, "key"),
      inputIds: numericArrayDetail(detail, "inputIds"),
      appliedInputs: numericDetail(detail, "repeat") ?? 1,
    });
    if (pendingChartSteps.length > 8) {
      droppedPendingInputIds = pendingChartSteps
        .splice(0, pendingChartSteps.length - 8)
        .flatMap((step) => step.inputIds);
    }
  }
  let eventDetail = detail;
  if (
    (name === "chart-canvas-paint" || name === "chart-canvas-paint-suppressed") &&
    pendingChartSteps.length > 0
  ) {
    const pendingChartStep = takePendingChartStep(detail);
    if (pendingChartStep != null) {
      eventDetail = {
        ...detail,
        stepIntentToPaintMs: Math.max(0, at - pendingChartStep.at),
        stepIntentAt: pendingChartStep.at,
        stepKey: pendingChartStep.key,
        stepInputIds: pendingChartStep.inputIds,
        stepInputId: pendingChartStep.inputIds[0] ?? null,
        stepAppliedInputs: pendingChartStep.appliedInputs,
      };
    }
  }
  if (
    name === "chart-step-session-change" ||
    name === "chart-step-settle-start"
  ) {
    eventDetail = { ...eventDetail, duringBurst: speedlogBurstActive };
  }
  const event: ChartPerfEvent = { name, at, detail: eventDetail };
  if (perfEnabled) {
    const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
    events.push(event);
    if (events.length > 500) {
      events.splice(0, events.length - 500);
    }
    window.__ARIES_CHART_PERF_EVENTS__ = events;
  }
  collectSpeedlogSample(event);
  // Console serialization is useful during an explicitly requested manual
  // trace, but it perturbs burst measurements and can itself create a periodic
  // long task as the console buffer grows. The in-memory event stream remains
  // the canonical harness input.
  if (window.__ARIES_CHART_PERF_CONSOLE__ === true) {
    console.info("[chart-perf]", JSON.stringify(event));
  }
  if (window.__ARIES_NATIVE_PERF__ === true) {
    void resolveShellHost().recordFrontendPerf(event).catch(() => {});
  }
  if (
    name === "chart-canvas-paint" &&
    numericDetail(eventDetail, "stepIntentAt") != null
  ) {
    scheduleStepRenderBoundary(event);
  }
  if (droppedPendingInputIds.length > 0) {
    recordChartStepInputsWithoutBoundary(droppedPendingInputIds, "pending-intent-capacity");
  }
}

export function recordChartPerf(name: string, detail: Record<string, unknown>): void {
  recordChartPerfAt(name, detail, perfNow());
}

const startupPerfOnce = new Set<string>();
const startupMilestones = new Map<string, number>();

function startupMilestoneSnapshot(): Record<string, number> {
  return Object.fromEntries(startupMilestones.entries());
}

export function recordStartupPerf(name: string, detail: Record<string, unknown> = {}): void {
  recordChartPerf(`startup-${name}`, {
    msSinceNavigation: Math.round(perfNow()),
    ...detail,
  });
}

export function recordStartupPerfOnce(
  name: string,
  detail: Record<string, unknown> = {},
): void {
  if (startupPerfOnce.has(name)) return;
  startupPerfOnce.add(name);
  const at = Math.round(perfNow());
  const previous = Array.from(startupMilestones.values()).at(-1);
  startupMilestones.set(name, at);
  if (typeof window !== "undefined") {
    window.__ARIES_STARTUP_MILESTONES__ = startupMilestoneSnapshot();
  }
  recordStartupPerf(name, {
    phaseMs: previous == null ? null : Math.max(0, at - previous),
    ...detail,
    milestones: startupMilestoneSnapshot(),
  });
}
