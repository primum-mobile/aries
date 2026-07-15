// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveShellHost } from "@/lib/shell-host";

export type ChartPerfEvent = {
  name: string;
  at: number;
  detail: Record<string, unknown>;
};

declare global {
  interface Window {
    __ARIES_CHART_PERF_EVENTS__?: ChartPerfEvent[];
    __ARIES_STARTUP_MILESTONES__?: Record<string, number>;
    __ARIES_NATIVE_PERF__?: boolean;
  }
}

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

export function approxUtf8Bytes(text: string): number {
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).byteLength;
}

export function recordChartPerf(name: string, detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const event: ChartPerfEvent = { name, at: perfNow(), detail };
  const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
  events.push(event);
  if (events.length > 500) {
    events.splice(0, events.length - 500);
  }
  window.__ARIES_CHART_PERF_EVENTS__ = events;
  if (chartPerfEnabled()) {
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
