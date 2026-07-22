// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveShellHost } from "@/lib/shell-host";
import performanceBudgets from "./performance-budgets.json";

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
  key: string | null;
};

const SPEEDLOG_FLUSH_MS = 10_000;
const SPEEDLOG_MAX_SAMPLES = 240;
const speedlogSamples = new Map<string, SpeedlogSample[]>();
const pendingChartSteps: PendingChartStep[] = [];
let speedlogFlushTimer: ReturnType<typeof setTimeout> | null = null;

const speedlogBudgets = performanceBudgets.metrics as Record<
  string,
  { p95Ms?: number; description: string }
>;

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

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function addSpeedlogSample(metric: string, value: number, at: number): void {
  if (!speedlogEnabled() || !Number.isFinite(value) || value < 0) return;
  const samples = speedlogSamples.get(metric) ?? [];
  samples.push({ at, value });
  if (samples.length > SPEEDLOG_MAX_SAMPLES) {
    samples.splice(0, samples.length - SPEEDLOG_MAX_SAMPLES);
  }
  speedlogSamples.set(metric, samples);
  if (speedlogFlushTimer == null) {
    speedlogFlushTimer = setTimeout(flushSpeedlog, SPEEDLOG_FLUSH_MS);
  }
}

function flushSpeedlog(): void {
  speedlogFlushTimer = null;
  if (!speedlogEnabled() || speedlogSamples.size === 0) return;
  const metrics = Array.from(speedlogSamples.entries()).map(([name, samples]) => {
    const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
    const p95Ms = percentile(values, 0.95);
    const budgetMs = speedlogBudgets[name]?.p95Ms ?? null;
    return {
      name,
      description: speedlogBudgets[name]?.description ?? name,
      samples: values.length,
      averageMs: values.reduce((total, value) => total + value, 0) / values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms,
      maxMs: values.at(-1) ?? null,
      budgetMs,
      breached: values.length >= 10 && budgetMs != null && p95Ms != null && p95Ms > budgetMs,
    };
  });
  speedlogSamples.clear();
  const event: ChartPerfEvent = {
    name: "speedlog-summary",
    at: perfNow(),
    detail: {
      budgetVersion: performanceBudgets.version,
      metrics,
    },
  };
  if (metrics.some((metric) => metric.breached)) {
    console.warn("[aries-speedlog] performance budget exceeded", metrics);
  }
  void resolveShellHost().recordFrontendPerf(event).catch(() => {});
}

function collectSpeedlogSample(event: ChartPerfEvent): void {
  if (!speedlogEnabled()) return;
  if (event.name === "chart-canvas-paint") {
    const totalMs = numericDetail(event.detail, "totalMs");
    const mode = typeof event.detail.mode === "string" ? event.detail.mode : "unknown";
    if (totalMs != null) addSpeedlogSample(`chart.canvas.${mode}`, totalMs, event.at);
    const stepFirstPaintMs = numericDetail(event.detail, "stepIntentToPaintMs");
    if (stepFirstPaintMs != null) {
      addSpeedlogSample("time-step.first-useful-paint", stepFirstPaintMs, event.at);
    }
    return;
  }
  if (event.name === "list-scroll-frame") {
    const eventToFrameMs = numericDetail(event.detail, "eventToFrameMs");
    if (eventToFrameMs != null) {
      addSpeedlogSample("list.scroll-to-frame", eventToFrameMs, event.at);
    }
  }
}

export function recordChartPerf(name: string, detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const perfEnabled = chartPerfEnabled();
  const speedlog = speedlogEnabled();
  // Shipping builds with neither explicit profiling nor the automatic
  // speedlog should pay no event-allocation or retention cost at all.
  if (!perfEnabled && !speedlog) return;
  const at = perfNow();
  if (name === "chart-step-intent") {
    const intentAt = numericDetail(detail, "intentAt");
    pendingChartSteps.push({
      at: intentAt ?? at,
      docId: typeof detail.docId === "string" ? detail.docId : null,
      key: typeof detail.key === "string" ? detail.key : null,
    });
    if (pendingChartSteps.length > 8) pendingChartSteps.splice(0, pendingChartSteps.length - 8);
  }
  let eventDetail = detail;
  if (name === "chart-canvas-paint" && detail.mode === "step_fast" && pendingChartSteps.length > 0) {
    const paintedDocId = typeof detail.docId === "string" ? detail.docId : null;
    const stepIndex = pendingChartSteps.findIndex(
      (step) => step.docId == null || paintedDocId === step.docId,
    );
    if (stepIndex >= 0) {
      const [pendingChartStep] = pendingChartSteps.splice(stepIndex, 1);
      eventDetail = {
        ...detail,
        stepIntentToPaintMs: Math.max(0, at - pendingChartStep.at),
        stepKey: pendingChartStep.key,
      };
    }
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
