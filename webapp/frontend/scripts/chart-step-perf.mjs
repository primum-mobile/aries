#!/usr/bin/env node
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendDir, "../..");
const frontendUrl = (process.env.FRONTEND_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const useNativeDaemon = process.env.ARIES_PERF_USE_NATIVE === "1";
const daemonPort = useNativeDaemon
  ? positiveInt("ARIES_DAEMON_PORT", 8765)
  : positiveInt("ARIES_PERF_DAEMON_PORT", 8877);
const daemonUrl = `http://127.0.0.1:${daemonPort}`;
const scenarioProfile = process.env.CHART_STEP_PROFILE === "core" ? "core" : "extended";
const runExtendedScenarios = scenarioProfile === "extended";
const retainAstrocart = process.env.CHART_STEP_RETAINED_ASTROCART === "1";
const measureListScroll = process.env.CHART_STEP_LIST_SCROLL === "1";
const measureLiveTransitList = process.env.CHART_STEP_LIVE_TRANSIT_LIST === "1";
const measureFullPaint = process.env.CHART_STEP_FULL_PAINT === "1";
const measuredSteps = positiveInt("CHART_STEP_RUNS", 30);
const liveListSteps = positiveInt("CHART_STEP_LIVE_LIST_RUNS", 12);
const liveListIntervalMs = positiveInt("CHART_STEP_LIVE_LIST_INTERVAL_MS", 30);
// Retained-map runs include a longer warm-up so map activation/teardown is not
// mixed into the steady-state step distribution. This adds well under a second
// while keeping the commit gate deterministic; explicit overrides still win.
const warmupSteps = positiveInt("CHART_STEP_WARMUPS", retainAstrocart ? 15 : 5);
const burstSize = positiveInt("CHART_STEP_BURST_SIZE", 0);
const burstIntervalMs = positiveInt("CHART_STEP_BURST_INTERVAL_MS", 8);
const timeoutMs = positiveInt("CHART_STEP_TIMEOUT_MS", 15_000);
const key = process.env.CHART_STEP_KEY ?? "ArrowRight";
const filter = process.env.CHART_STEP_FILTER ?? "";
const requestedTheme = process.env.CHART_STEP_THEME?.trim() ?? "";
const headless = process.env.HEADLESS !== "0";
const traceEnabled = process.env.CHART_STEP_TRACE === "1";
const perfDir = process.env.ARIES_PERF_OUTPUT_DIR
  ? path.resolve(process.env.ARIES_PERF_OUTPUT_DIR)
  : path.join(frontendDir, ".tmp/perf");
const budgets = JSON.parse(
  readFileSync(path.join(frontendDir, "src/lib/chart/performance-budgets.json"), "utf8"),
);

function positiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function markPerfScript({ daemonBaseUrl, daemonToken, retainAstrocart }) {
  Object.defineProperty(window, "__ARIES_DAEMON_URL__", {
    value: daemonBaseUrl,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(window, "__ARIES_DAEMON_TOKEN__", {
    value: daemonToken,
    configurable: false,
    writable: false,
  });
  window.localStorage.setItem("ARIES_CHART_PERF", "1");
  if (retainAstrocart) {
    window.localStorage.setItem("ARIES_ASTROCART_FORCE_LOCAL_TILES", "1");
    window.localStorage.setItem("ARIES_ASTROCART_PERF", "1");
  }
  window.__ARIES_CHART_PERF_EVENTS__ = [];
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__ARIES_CHART_PERF_EVENTS__?.push({
          name: "browser-long-task",
          at: entry.startTime,
          detail: { durationMs: entry.duration },
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Older WebViews may not expose Long Tasks; the core timing gate remains.
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function rounded(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function summarizeMetric(values, budgetMs = null) {
  const p95Ms = percentile(values, 0.95);
  return {
    samples: values.length,
    averageMs: rounded(
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    ),
    minimumMs: rounded(values.length ? Math.min(...values) : null),
    p05Ms: rounded(percentile(values, 0.05)),
    p50Ms: rounded(percentile(values, 0.5)),
    p95Ms: rounded(p95Ms),
    maxMs: rounded(values.length ? Math.max(...values) : null),
    budgetMs,
    breached: budgetMs != null && (p95Ms == null || p95Ms > budgetMs),
  };
}

function integerEventIds(event, key) {
  const values = event?.detail?.[key];
  if (
    !Array.isArray(values) ||
    !values.every((value) => Number.isSafeInteger(value) && value > 0)
  ) {
    return [];
  }
  return values;
}

function duplicateCount(values) {
  return values.length - new Set(values).size;
}

function sameIdSet(left, right) {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function sameIdSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function completeRenderBoundary(event) {
  const detail = event?.detail;
  if (!detail || detail.timedOut !== false) return false;
  const ids = integerEventIds(event, "inputIds");
  if (ids.length === 0 || duplicateCount(ids) !== 0) return false;
  const finiteFields = [
    "appliedInputs",
    "canvasAt",
    "intentAt",
    "nextFrameAt",
    "postRenderAt",
    "secondFrameAt",
    "nextFrameTimestamp",
    "secondFrameTimestamp",
  ].every((key) => Number.isFinite(detail[key]));
  const callbackOrders = [detail.postRenderOrder, detail.secondFrameOrder];
  const postRenderTaskLate = detail.postRenderOrder > detail.secondFrameOrder;
  return (
    finiteFields &&
    Number.isInteger(detail.appliedInputs) &&
    detail.appliedInputs === ids.length &&
    callbackOrders.every((value) => value === 2 || value === 3) &&
    new Set(callbackOrders).size === callbackOrders.length &&
    typeof detail.postRenderTaskLate === "boolean" &&
    detail.postRenderTaskLate === postRenderTaskLate &&
    detail.intentAt <= detail.canvasAt &&
    detail.nextFrameAt >= detail.canvasAt &&
    detail.postRenderAt >= detail.nextFrameAt &&
    detail.secondFrameAt >= detail.nextFrameAt &&
    (postRenderTaskLate
      ? detail.postRenderAt >= detail.secondFrameAt
      : detail.postRenderAt <= detail.secondFrameAt) &&
    detail.secondFrameTimestamp > detail.nextFrameTimestamp
  );
}

function timestampCollisionSummary(events, key) {
  const counts = new Map();
  for (const event of events) {
    const timestamp = event.detail?.[key];
    if (!Number.isFinite(timestamp)) continue;
    counts.set(timestamp, (counts.get(timestamp) ?? 0) + 1);
  }
  const values = [...counts.values()];
  return {
    unique: counts.size,
    groups: values.filter((count) => count > 1).length,
    excess: values.reduce((total, count) => total + Math.max(0, count - 1), 0),
    maximum: values.length > 0 ? Math.max(...values) : 0,
  };
}

function postRenderTaskComparable(event) {
  return (
    Number.isInteger(event?.detail?.postRenderOrder) &&
    Number.isInteger(event?.detail?.secondFrameOrder) &&
    event.detail.postRenderOrder < event.detail.secondFrameOrder
  );
}

function budgetValue(metricName) {
  const budget = budgets.metrics[metricName];
  return budget?.p95Ms ?? budget?.p95Value ?? null;
}

function numericEventDetails(events, name, key, predicate = () => true) {
  return events
    .filter((event) => event.name === name && predicate(event))
    .map((event) => event.detail?.[key])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
}

function nestedValue(value, keys) {
  return keys.reduce(
    (current, key) => (current && typeof current === "object" ? current[key] : null),
    value,
  );
}

function nestedNumericEventDetails(events, keys) {
  return events
    .map((event) => nestedValue(event.detail, keys))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
}

function phaseDiagnostics(events, rootKeys, prefix) {
  const phaseNames = new Set();
  for (const event of events) {
    const phases = nestedValue(event.detail, rootKeys);
    if (!Array.isArray(phases)) continue;
    for (const phase of phases) {
      if (typeof phase?.name === "string") phaseNames.add(phase.name);
    }
  }
  return Object.fromEntries(
    [...phaseNames].sort().map((phaseName) => [
      `${prefix}.${phaseName}`,
      summarizeMetric(
        events
          .flatMap((event) => {
            const phases = nestedValue(event.detail, rootKeys);
            return Array.isArray(phases) ? phases : [];
          })
          .filter((phase) => phase?.name === phaseName)
          .map((phase) => phase.ms)
          .filter((value) => typeof value === "number" && Number.isFinite(value)),
      ),
    ]),
  );
}

function createTransitSearchTracker(page) {
  const state = {
    activeSessionIds: new Set(),
    inFlightStarts: 0,
    lastActivityAt: Date.now(),
    measurementActive: false,
    measuredStarts: 0,
    totalStarts: 0,
  };

  const transitListStartBody = (request) => {
    if (new URL(request.url()).pathname !== "/api/search/context/start") return null;
    try {
      const body = request.postDataJSON();
      return body?.ownerScope === "transit-list" ? body : null;
    } catch {
      return null;
    }
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (transitListStartBody(request)) {
      state.inFlightStarts += 1;
      state.totalStarts += 1;
      if (state.measurementActive) state.measuredStarts += 1;
      state.lastActivityAt = Date.now();
      return;
    }
    if (url.pathname !== "/api/search/cancel") return;
    try {
      const sessionId = request.postDataJSON()?.sessionId;
      if (typeof sessionId === "string") state.activeSessionIds.delete(sessionId);
    } catch {
      // The response path still resolves the active session.
    }
    state.lastActivityAt = Date.now();
  });

  page.on("response", async (response) => {
    const url = new URL(response.url());
    const isStart = url.pathname === "/api/search/context/start";
    const isProgress = url.pathname === "/api/search/progress";
    if (!isStart && !isProgress) return;
    const request = response.request();
    if (isStart && !transitListStartBody(request)) return;
    try {
      const payload = await response.json();
      const sessionId = payload?.sessionId;
      if (isStart) state.inFlightStarts = Math.max(0, state.inFlightStarts - 1);
      if (typeof sessionId === "string") {
        if (payload?.complete || payload?.cancelled || payload?.error) {
          state.activeSessionIds.delete(sessionId);
        } else {
          state.activeSessionIds.add(sessionId);
        }
      }
    } catch {
      if (isStart) state.inFlightStarts = Math.max(0, state.inFlightStarts - 1);
    }
    state.lastActivityAt = Date.now();
  });

  return {
    beginMeasurement() {
      state.measuredStarts = 0;
      state.measurementActive = true;
    },
    endMeasurement() {
      state.measurementActive = false;
      return state.measuredStarts;
    },
    snapshot() {
      return {
        activeSessions: state.activeSessionIds.size,
        inFlightStarts: state.inFlightStarts,
        lastActivityAt: state.lastActivityAt,
        measuredStarts: state.measuredStarts,
        totalStarts: state.totalStarts,
      };
    },
  };
}

async function waitForTransitSearchQuiescence(tracker) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const state = tracker.snapshot();
    if (state.totalStarts > 0 && state.inFlightStarts === 0 && state.activeSessions === 0) {
      if (!quietSince) quietSince = Date.now();
      if (
        Date.now() - quietSince >= 300
        && Date.now() - state.lastActivityAt >= 300
      ) {
        return;
      }
    } else {
      quietSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Transit List Search did not become quiescent: ${JSON.stringify(tracker.snapshot())}`,
  );
}

async function openChart(page, context) {
  await page.goto(`${frontendUrl}/?chartPerf=1`, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  if (requestedTheme) {
    await daemonCommand(page, "/api/options/theme", { name: requestedTheme });
  }
  const picker = await context.newPage();
  await picker.goto(`${frontendUrl}/chart-picker?mode=open-radix&chartPerf=1`, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  const quickFilter = picker.getByPlaceholder("Quick filter");
  await quickFilter.waitFor({ state: "visible", timeout: timeoutMs });
  if (filter) await quickFilter.fill(filter);
  const row = picker.locator("[data-chart-picker-row-key]").first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.dblclick();
  const handle = await page.waitForFunction(
    () => {
      const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
      const result = events
        .filter((event) => event.name === "workspace-command-main-result" && !event.detail?.failed)
        .at(-1);
      const docId = result?.detail?.docId;
      if (!docId) return false;
      return events.some(
        (event) => event.name === "chart-canvas-paint" && event.detail?.docId === docId,
      )
        ? docId
        : false;
    },
    null,
    { timeout: timeoutMs },
  );
  const docId = await handle.jsonValue();
  await picker.close();
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  return docId;
}

async function daemonCommand(page, pathName, payload) {
  return page.evaluate(
    async ({ daemonBaseUrl, commandPath, commandPayload }) => {
      const token = window.__ARIES_DAEMON_TOKEN__;
      const response = await fetch(`${daemonBaseUrl}${commandPath}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Aries-Token": token } : {}),
        },
        body: JSON.stringify(commandPayload),
      });
      if (!response.ok) {
        throw new Error(`${commandPath} failed: ${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    { daemonBaseUrl: daemonUrl, commandPath: pathName, commandPayload: payload },
  );
}

async function retainAstrocartSurface(page, docId) {
  const opened = await daemonCommand(page, "/api/workspace/open-astrocart", {
    parentRadixId: docId,
    eclipseJd: null,
    eclipseRetflag: null,
  });
  if (!opened.documentId) throw new Error("Astrocartography command returned no document id.");
  const iframe = page.locator('iframe[title="Astrocartography"]');
  await iframe.waitFor({ state: "visible", timeout: timeoutMs });
  const layout = await iframe.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const retainedHost = element.parentElement?.parentElement?.getBoundingClientRect();
    return retainedHost
      ? { frameWidth: frame.width, frameHeight: frame.height, hostWidth: retainedHost.width, hostHeight: retainedHost.height }
      : null;
  });
  if (
    !layout ||
    layout.frameWidth < layout.hostWidth - 1 ||
    layout.frameHeight < layout.hostHeight - 1
  ) {
    throw new Error(
      `Retained Astrocartography iframe does not fill its host: ${JSON.stringify(layout)}`,
    );
  }
  const frame = page.frameLocator('iframe[title="Astrocartography"]');
  await frame.locator(".maplibregl-canvas").waitFor({ state: "visible", timeout: timeoutMs });
  const iframeHandle = await iframe.elementHandle();
  const mapFrame = await iframeHandle?.contentFrame();
  if (!mapFrame) throw new Error("Astrocartography frame was not available.");
  // This scenario measures a retained, already-useful map. Waiting for the
  // preview line payload prevents an unfinished cold-start calculation from
  // being mislabeled as steady-state chart-step cost. Switch contention is a
  // separate workload and must receive its own budget/report.
  await mapFrame.waitForFunction(
    () => window.ACG?.getPerfState?.().lineFeatureCount > 0,
    null,
    { timeout: timeoutMs },
  );
  await daemonCommand(page, "/api/workspace/activate", { docId });
  await iframe.waitFor({ state: "hidden", timeout: timeoutMs });
  await page.waitForFunction(
    (activeDocId) =>
      (window.__ARIES_CHART_PERF_EVENTS__ ?? []).some(
        (event) => event.name === "chart-canvas-paint" && event.detail?.docId === activeDocId,
      ),
    docId,
    { timeout: timeoutMs },
  );
  return opened.documentId;
}

async function readRetainedAstrocartPerf(page) {
  const iframe = page.locator('iframe[title="Astrocartography"]');
  if (await iframe.count() === 0) return null;
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) return null;
  return frame.evaluate(() => window.ACG?.getPerfState?.() ?? null);
}

async function openTransitListSurface(page, tracker) {
  if (useNativeDaemon) {
    throw new Error("The list scenario may not change launcher options on the user's native daemon.");
  }
  // The isolated profile defaults timed launchers to Chart. Switch its private
  // temporary profile to Table so the canonical retained Transits pane opens;
  // no user option or cache is reachable in this harness.
  await daemonCommand(page, "/api/options", {
    quickCharts: { secondary_progression_launch_mode: 1 },
  });
  const action = page.locator('[data-aries-sidebar-action-id="transits"]');
  if (await action.count() === 0) {
    const collapsedGroups = page.locator('[data-aries-sidebar-group-id][aria-expanded="false"]');
    const count = await collapsedGroups.count();
    for (let index = 0; index < count; index += 1) {
      await collapsedGroups.nth(0).click();
    }
  }
  await action.waitFor({ state: "visible", timeout: timeoutMs });
  await action.click();
  const table = page.locator("table.aries-list").last();
  await table.waitFor({ state: "visible", timeout: timeoutMs });
  const scroller = page.locator("[data-transit-list-focus-target-ms]").last();
  await scroller.waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForFunction(
    (element) =>
      element.getAttribute("data-transit-list-focus-resident") === "true"
      && element.querySelectorAll("tbody tr").length > 0,
    await scroller.elementHandle(),
    { timeout: timeoutMs },
  );
  await waitForTransitSearchQuiescence(tracker);
  return { table, scroller };
}

async function installTransitListObservation(page, scroller) {
  await page.evaluate((element) => {
    const previous = window.__ARIES_TRANSIT_LIST_FOLLOW_OBSERVER__;
    previous?.observer?.disconnect();
    if (previous?.onScroll) previous.scroller?.removeEventListener("scroll", previous.onScroll);
    const observations = [];
    const state = {
      scroller: element,
      observations,
      scrollEvents: 0,
      observer: null,
      onScroll: null,
    };
    const record = () => {
      observations.push({
        targetMs: Number(element.getAttribute("data-transit-list-focus-target-ms")),
        focusIndex: Number(element.getAttribute("data-transit-list-focus-index")),
        resident: element.getAttribute("data-transit-list-focus-resident") === "true",
        rowCount: element.querySelectorAll("tbody tr").length,
        scrollTop: element.scrollTop,
      });
    };
    state.observer = new MutationObserver(record);
    state.observer.observe(element, {
      attributes: true,
      attributeFilter: [
        "data-transit-list-focus-target-ms",
        "data-transit-list-focus-index",
        "data-transit-list-focus-resident",
      ],
    });
    state.onScroll = () => {
      state.scrollEvents += 1;
    };
    element.addEventListener("scroll", state.onScroll, { passive: true });
    record();
    window.__ARIES_TRANSIT_LIST_FOLLOW_OBSERVER__ = state;
  }, await scroller.elementHandle());
}

async function resetTransitListObservation(page) {
  await page.evaluate(() => {
    window.__ARIES_CHART_PERF_EVENTS__ = [];
    const state = window.__ARIES_TRANSIT_LIST_FOLLOW_OBSERVER__;
    if (!state) return;
    state.observations.length = 0;
    state.scrollEvents = 0;
  });
}

async function readTransitListObservation(page) {
  return page.evaluate(() => {
    const state = window.__ARIES_TRANSIT_LIST_FOLLOW_OBSERVER__;
    const current = document.querySelector("[data-transit-list-focus-target-ms]");
    return {
      observations: state?.observations ?? [],
      scrollEvents: state?.scrollEvents ?? 0,
      sameScroller: Boolean(state?.scroller && current === state.scroller),
      finalTargetMs: Number(current?.getAttribute("data-transit-list-focus-target-ms")),
      finalFocusIndex: Number(current?.getAttribute("data-transit-list-focus-index")),
      finalResident: current?.getAttribute("data-transit-list-focus-resident") === "true",
      finalRowCount: current?.querySelectorAll("tbody tr").length ?? 0,
    };
  });
}

async function runLiveTransitListDirection(
  page,
  docId,
  tracker,
  { label, keyName },
) {
  await resetTransitListObservation(page);
  tracker.beginMeasurement();
  await stepKeyBurst(page, keyName, liveListSteps, liveListIntervalMs);
  await waitForCoherentSettle(page, docId);
  await page.waitForTimeout(50);
  const searchStarts = tracker.endMeasurement();
  const events = await page.evaluate(() => window.__ARIES_CHART_PERF_EVENTS__ ?? []);
  const observation = await readTransitListObservation(page);
  const paints = events.filter(
    (event) =>
      event.name === "chart-canvas-paint"
      && event.detail?.docId === docId
      && event.detail?.mode === "step_fast",
  );
  const navigateCommands = events.filter(
    (event) =>
      event.name === "workspace-command"
      && event.detail?.path === "/api/workspace/navigate-key",
  );
  const intents = events.filter((event) => event.name === "chart-step-intent");
  const paintTargetMs = paints
    .map((event) => Date.parse(event.detail?.displayDatetime ?? ""))
    .filter((value) => Number.isFinite(value));
  const observedTargetMs = new Set(
    observation.observations
      .map((item) => item.targetMs)
      .filter((value) => Number.isFinite(value)),
  );
  const appliedInputs = intents.reduce(
    (total, event) => total + (Number(event.detail?.repeat) || 0),
    0,
  );
  const metrics = {
    "time-step.first-useful-paint": summarizeMetric(
      paints
        .map((event) => event.detail?.stepIntentToPaintMs)
        .filter((value) => typeof value === "number" && Number.isFinite(value)),
      budgetValue("time-step.first-useful-paint"),
    ),
    "time-step.command-total": summarizeMetric(
      numericEventDetails(navigateCommands, "workspace-command", "totalMs"),
      budgetValue("time-step.command-total"),
    ),
    "time-step.paint-gap-over-input": summarizeMetric(
      paints
        .slice(1)
        .map((event, index) => event.at - paints[index].at)
        .slice(0, Math.max(0, intents.length - 1))
        .map((paintGap, index) => {
          const current = intents[index]?.detail?.intentAt;
          const next = intents[index + 1]?.detail?.intentAt;
          const inputGap =
            typeof current === "number" && typeof next === "number" ? next - current : 0;
          return Math.max(0, paintGap - inputGap);
        }),
      budgetValue("time-step.paint-gap-over-input"),
    ),
  };
  const contract = {
    expectedInputs: liveListSteps,
    appliedInputs,
    navigateCommands: navigateCommands.length,
    stepFastPaints: paints.length,
    searchStarts,
    focusMutations: observation.observations.length,
    scrollEvents: observation.scrollEvents,
    everyPaintTargetConsumed:
      paintTargetMs.length === paints.length
      && paintTargetMs.every((targetMs) => observedTargetMs.has(targetMs)),
    finalTargetMatchesPaint:
      paintTargetMs.length > 0
      && observation.finalTargetMs === paintTargetMs.at(-1),
    residentThroughout:
      observation.finalResident
      && observation.observations.length > 0
      && observation.observations.every((item) => item.resident),
    rowsNeverBlank:
      observation.finalRowCount > 0
      && observation.observations.every((item) => item.rowCount > 0),
    retainedScroller: observation.sameScroller,
    noSearchPerFrame: searchStarts === 0,
    noUnneededScroll: observation.scrollEvents === 0,
    oneInputPerPaint:
      intents.length === paints.length
      && intents.every((event) => event.detail?.repeat === 1),
    onePaintPerInput: paints.length === liveListSteps,
    oneCommandPerInput: navigateCommands.length === liveListSteps,
    noDroppedInputs: appliedInputs === liveListSteps,
  };
  contract.passed =
    contract.everyPaintTargetConsumed
    && contract.finalTargetMatchesPaint
    && contract.residentThroughout
    && contract.rowsNeverBlank
    && contract.retainedScroller
    && contract.noSearchPerFrame
    && contract.noUnneededScroll
    && contract.oneInputPerPaint
    && contract.onePaintPerInput
    && contract.oneCommandPerInput
    && contract.noDroppedInputs
    && !Object.values(metrics).some((metric) => metric.breached);
  return { label, key: keyName, contract, metrics };
}

async function runListScrollScenario(page, scroller) {
  if (!measureListScroll) return [];
  // A sparse current-month fixture can fit in the harness's tall viewport.
  // Constrain only this browser context so the canonical virtual list has a
  // real retained-pane scroll range; application layout/options are untouched.
  await scroller.evaluate((element) => {
    element.style.height = "160px";
    element.style.flex = "0 0 160px";
  });
  await page.waitForFunction(
    (element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight,
    await scroller.elementHandle(),
    { timeout: timeoutMs },
  );
  // A freshly mounted retained list may still be inside its brief row-height
  // reanchor guard. Scrolls during that window are intentionally ignored by
  // the app, so wait for the guard itself instead of turning a correct ignored
  // event into a random 15-second commit-gate timeout.
  await page.waitForFunction(
    (element) => Number(element.dataset.ariesRowHeightAnchorUntil ?? 0) <= Date.now(),
    await scroller.elementHandle(),
    { timeout: timeoutMs },
  );
  await scroller.evaluate((element) => {
    element.scrollTop = Math.max(1, Math.round((element.scrollHeight - element.clientHeight) * 0.4));
  });
  for (let index = 0; index < 12; index += 1) {
    const previousCount = await page.evaluate(
      () => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) => event.name === "list-scroll-frame",
      ).length,
    );
    await scroller.evaluate((element, offset) => {
      element.scrollTop += offset;
      element.dispatchEvent(new Event("scroll"));
    }, index % 2 === 0 ? 48 : -32);
    await page.waitForFunction(
      (count) => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) => event.name === "list-scroll-frame",
      ).length > count,
      previousCount,
      { timeout: timeoutMs },
    );
  }
  return page.evaluate(() => window.__ARIES_CHART_PERF_EVENTS__ ?? []);
}

async function runRetainedTransitListScenario(page, docId, tracker) {
  if (!measureListScroll && !measureLiveTransitList) return null;
  const { scroller } = await openTransitListSurface(page, tracker);
  const directions = [];
  if (measureLiveTransitList) {
    await installTransitListObservation(page, scroller);
    directions.push(
      await runLiveTransitListDirection(page, docId, tracker, {
        label: "forward",
        keyName: "Shift+ArrowRight",
      }),
    );
    directions.push(
      await runLiveTransitListDirection(page, docId, tracker, {
        label: "backward",
        keyName: "Shift+ArrowLeft",
      }),
    );
  }
  await resetTransitListObservation(page);
  const scrollEvents = await runListScrollScenario(page, scroller);
  return {
    kind: "transit",
    listOpen: true,
    inCoverage: true,
    directions,
    scrollEvents,
    passed: directions.every((direction) => direction.contract.passed),
  };
}

async function runFullPaintScenario(page, docId) {
  if (!measureFullPaint) return;
  await page.waitForFunction(
    (activeDocId) => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).some(
      (event) =>
        event.name === "chart-canvas-paint" &&
        event.detail?.docId === activeDocId &&
        event.detail?.mode === "full",
    ),
    docId,
    { timeout: timeoutMs },
  );
  for (let index = 0; index < 10; index += 1) {
    const previousCount = await page.evaluate(
      (activeDocId) => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "full",
      ).length,
      docId,
    );
    await page.setViewportSize({
      width: index % 2 === 0 ? 1279 : 1280,
      height: index % 2 === 0 ? 859 : 860,
    });
    await page.waitForFunction(
      ({ activeDocId, count }) => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "full",
      ).length > count,
      { activeDocId: docId, count: previousCount },
      { timeout: timeoutMs },
    );
  }
}

async function stepOnce(page, docId) {
  const before = await page.evaluate(
    (activeDocId) =>
      (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "step_fast",
      ).length,
    docId,
  );
  await page.keyboard.press(key);
  await page.waitForFunction(
    ({ activeDocId, previousCount }) =>
      (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "step_fast",
      ).length > previousCount,
    { activeDocId: docId, previousCount: before },
    { timeout: timeoutMs },
  );
}

async function readLatestOverlayPerfState(page, docId) {
  return page.evaluate((activeDocId) => {
    const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
    return events
      .filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          Array.isArray(event.detail?.overlay?.rows) &&
          event.detail.overlay.rows.length > 0,
      )
      .at(-1)?.detail?.overlay ?? null;
  }, docId);
}

async function stepKeyBurst(page, keyName, count, intervalMs) {
  if (count <= 0) return;
  await dispatchStepKey(page, keyName, "keydown", false);
  for (let index = 1; index < count; index += 1) {
    if (intervalMs > 0) {
      await page.waitForTimeout(intervalMs);
    }
    await dispatchStepKey(page, keyName, "keydown", true);
  }
  await dispatchStepKey(page, keyName, "keyup", false);
  let previousCommandCount = -1;
  let stableSince = Date.now();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const commandCount = await page.evaluate(
      () => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
        (event) =>
          event.name === "workspace-command" &&
          event.detail?.path === "/api/workspace/navigate-key",
      ).length,
    );
    if (commandCount !== previousCommandCount) {
      previousCommandCount = commandCount;
      stableSince = Date.now();
    } else if (commandCount > 0 && Date.now() - stableSince >= 300) {
      return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error("Timed out waiting for chart-step burst to settle.");
}

async function stepBurst(page) {
  await stepKeyBurst(page, key, burstSize, burstIntervalMs);
}

// ---------------------------------------------------------------------------
// Held-key cadence sweep.
//
// Every internal timer constant forms a resonance band with the input period,
// so a single cadence can never find one — that is geometry, not luck. The
// 2026-07-20 stutter was invisible at the harness's synthetic 30 ms and fired
// 23 times in 44 steps at the real macOS repeat interval (KeyRepeat x ~15 ms,
// commonly 80-100 ms). `stepOnce` cannot express a held key at all: it awaits
// the paint before pressing again, so the burst never stays open.
//
// Invariant asserted here (doc/policy-time-architecture.md T1/T6):
//   ZERO full settles while the key is held, EXACTLY ONE after release.
// ---------------------------------------------------------------------------
const cadenceSweepMs = (process.env.CHART_STEP_CADENCE_SWEEP_MS
  ?? "8,16,33,50,66,83,100,150,250")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const cadenceSweepRepeats = positiveInt("CHART_STEP_CADENCE_REPEATS", 12);

async function dispatchStepKey(page, keyName, type, repeat = false) {
  await page.evaluate(
    ({ k, t, r }) => {
      // Real key events target the focused element (document.body when none),
      // never window — dispatching at window gives handlers a target with no
      // .closest() and is not a faithful held-key simulation.
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent(t, { key: k, repeat: r, bubbles: true, cancelable: true }),
      );
    },
    { k: keyName, t: type, r: repeat },
  );
}

async function runHeldKeyCadenceSweep(page, docId) {
  const results = [];
  for (const intervalMs of cadenceSweepMs) {
    await page.evaluate(() => {
      window.__ARIES_CHART_PERF_EVENTS__ = [];
    });
    // Leading edge, then autorepeat, then release — one envelope.
    await dispatchStepKey(page, key, "keydown", false);
    for (let index = 1; index < cadenceSweepRepeats; index += 1) {
      await page.waitForTimeout(intervalMs);
      await dispatchStepKey(page, key, "keydown", true);
    }
    const releasedAt = await page.evaluate(() => performance.now());
    await dispatchStepKey(page, key, "keyup", false);

    // Let the close edge resolve: the residual backlog collapses, the final
    // commit paints, then exactly one authoritative settle runs.
    await page.waitForTimeout(Math.max(600, intervalMs * 4));

    const observed = await page.evaluate((activeDocId) => {
      const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
      const settles = events.filter((event) => event.name === "chart-step-settle-start");
      const paints = events.filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "step_fast",
      );
      const intents = events.filter((event) => event.name === "chart-step-intent");
      return {
        settleTimes: settles.map((event) => event.at),
        paints: paints.length,
        paintTimes: paints.map((event) => event.at),
        appliedInputs: intents.reduce(
          (total, event) => total + (Number(event.detail?.repeat) || 0),
          0,
        ),
      };
    }, docId);

    const settlesDuringHold = observed.settleTimes.filter((at) => at < releasedAt).length;
    const settlesAfterRelease = observed.settleTimes.length - settlesDuringHold;
    const paintsAfterRelease = observed.paintTimes.filter((at) => at > releasedAt).length;
    results.push({
      intervalMs,
      emittedInputs: cadenceSweepRepeats,
      appliedInputs: observed.appliedInputs,
      paints: observed.paints,
      settlesDuringHold,
      settlesAfterRelease,
      paintsAfterRelease,
      passed:
        settlesDuringHold === 0 &&
        settlesAfterRelease === 1 &&
        observed.appliedInputs === cadenceSweepRepeats,
    });
  }
  return { results, passed: results.every((row) => row.passed) };
}

async function waitForCoherentSettle(page, docId) {
  await page.waitForFunction(
    (activeDocId) => {
      const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
      const lastStepIndex = events.findLastIndex(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "step_fast",
      );
      if (lastStepIndex < 0) return false;
      return events.slice(lastStepIndex + 1).some(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.settleOverlayOnly === true,
      );
    },
    docId,
    { timeout: timeoutMs },
  );
}

async function runHouseToggleCoherenceScenario(page, docId) {
  await page.evaluate(() => {
    window.__ARIES_CHART_PERF_EVENTS__ = [];
  });
  await stepOnce(page, docId);
  const stepState = await page.evaluate((activeDocId) => {
    const paints = (window.__ARIES_CHART_PERF_EVENTS__ ?? []).filter(
      (event) =>
        event.name === "chart-canvas-paint" &&
        event.detail?.docId === activeDocId,
    );
    const stepPaint = paints.findLast((event) => event.detail?.mode === "step_fast");
    return {
      eventCount: (window.__ARIES_CHART_PERF_EVENTS__ ?? []).length,
      showHouses: stepPaint?.detail?.showHouses,
      displayDatetime: stepPaint?.detail?.displayDatetime,
      semanticFrameSignature: stepPaint?.detail?.semanticFrameSignature,
    };
  }, docId);
  if (
    typeof stepState.showHouses !== "boolean" ||
    typeof stepState.displayDatetime !== "string" ||
    typeof stepState.semanticFrameSignature !== "string"
  ) {
    throw new Error("House-toggle coherence scenario did not observe a step frame.");
  }
  const toggleOnce = async (previousShowHouses, eventCount) => {
    await page.keyboard.press("h");
    await page.waitForFunction(
      ({ activeDocId, startEventCount, previousHouseState }) =>
        (window.__ARIES_CHART_PERF_EVENTS__ ?? []).slice(startEventCount).some(
          (event) =>
            event.name === "chart-canvas-paint" &&
            event.detail?.docId === activeDocId &&
            event.detail?.mode === "full" &&
            event.detail?.showHouses === !previousHouseState,
        ),
      {
        activeDocId: docId,
        startEventCount: eventCount,
        previousHouseState: previousShowHouses,
      },
      { timeout: timeoutMs },
    );
    await page.waitForTimeout(200);
    return page.evaluate(
      ({
        activeDocId,
        startEventCount,
        previousHouseState,
        previousDisplayDatetime,
        previousSemanticFrameSignature,
      }) => {
        const laterPaints = (window.__ARIES_CHART_PERF_EVENTS__ ?? [])
          .slice(startEventCount)
          .filter(
            (event) =>
              event.name === "chart-canvas-paint" &&
              event.detail?.docId === activeDocId,
          );
        const togglePaints = laterPaints.filter(
          (event) => event.detail?.showHouses === !previousHouseState,
        );
        return {
          totalPaints: laterPaints.length,
          togglePaints: togglePaints.length,
          staleSettlePaints: laterPaints.filter(
            (event) => event.detail?.settleOverlayOnly === true,
          ).length,
          modes: laterPaints.map((event) => event.detail?.mode ?? null),
          displayDatetimes: laterPaints.map((event) => event.detail?.displayDatetime ?? null),
          semanticFrameSignatures: laterPaints.map(
            (event) => event.detail?.semanticFrameSignature ?? null,
          ),
          sameCursor: laterPaints.every(
            (event) => event.detail?.displayDatetime === previousDisplayDatetime,
          ),
          sameSemanticFrame: laterPaints.every(
            (event) =>
              event.detail?.semanticFrameSignature === previousSemanticFrameSignature,
          ),
        };
      },
      {
        activeDocId: docId,
        startEventCount: eventCount,
        previousHouseState: previousShowHouses,
        previousDisplayDatetime: stepState.displayDatetime,
        previousSemanticFrameSignature: stepState.semanticFrameSignature,
      },
    );
  };
  const hiddenOrShown = await toggleOnce(stepState.showHouses, stepState.eventCount);
  const returnEventCount = await page.evaluate(
    () => (window.__ARIES_CHART_PERF_EVENTS__ ?? []).length,
  );
  const restored = await toggleOnce(!stepState.showHouses, returnEventCount);
  const directions = [hiddenOrShown, restored];
  const result = {
    toggles: directions.length,
    directions,
    totalPaints: directions.reduce((total, direction) => total + direction.totalPaints, 0),
    togglePaints: directions.reduce((total, direction) => total + direction.togglePaints, 0),
    staleSettlePaints: directions.reduce(
      (total, direction) => total + direction.staleSettlePaints,
      0,
    ),
    modes: directions.flatMap((direction) => direction.modes),
    sameCursor: directions.every((direction) => direction.sameCursor),
    sameSemanticFrame: directions.every((direction) => direction.sameSemanticFrame),
    onePaintPerToggle: directions.every(
      (direction) => direction.totalPaints === 1 && direction.togglePaints === 1,
    ),
  };
  return {
    ...result,
    passed:
      result.toggles === 2 &&
      result.onePaintPerToggle &&
      result.staleSettlePaints === 0 &&
      result.sameCursor &&
      result.sameSemanticFrame,
  };
}

async function readRecoveryBaseline(page, docId, scenario) {
  const baseline = await page.evaluate((activeDocId) => {
    const paint = (window.__ARIES_CHART_PERF_EVENTS__ ?? [])
      .filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId,
      )
      .at(-1);
    return {
      displayDatetime: paint?.detail?.displayDatetime ?? null,
      semanticFrameSignature: paint?.detail?.semanticFrameSignature ?? null,
    };
  }, docId);
  if (
    typeof baseline.displayDatetime !== "string" ||
    typeof baseline.semanticFrameSignature !== "string"
  ) {
    throw new Error(`${scenario} did not observe a baseline frame.`);
  }
  return baseline;
}

async function resetChartPerfEvents(page) {
  await page.evaluate(() => {
    window.__ARIES_CHART_PERF_EVENTS__ = [];
  });
}

async function waitForFullRecoveryPaint(page, docId, expectedHadPublishedStep) {
  await page.waitForFunction(
    ({ activeDocId, hadPublishedStep }) => {
      const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
      const recoveryIndex = events.findIndex(
        (event) =>
          event.name === "chart-step-settle-recovery" &&
          event.detail?.docId === activeDocId &&
          event.detail?.hadPublishedStep === hadPublishedStep,
      );
      if (recoveryIndex < 0) return false;
      return events.slice(recoveryIndex + 1).some(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId &&
          event.detail?.mode === "full" &&
          event.detail?.settleOverlayOnly !== true &&
          event.detail?.dirty?.geometry === true &&
          event.detail?.dirty?.dynamic === true &&
          event.detail?.dirty?.outerLabel === true,
      );
    },
    { activeDocId: docId, hadPublishedStep: expectedHadPublishedStep },
    { timeout: timeoutMs },
  );
}

async function readRecoveryObservation(page, docId, baseline) {
  return page.evaluate(
    ({ activeDocId, baselineDisplayDatetime, baselineSemanticFrameSignature }) => {
      const events = window.__ARIES_CHART_PERF_EVENTS__ ?? [];
      const recoveryEvents = events.filter(
        (event) =>
          event.name === "chart-step-settle-recovery" &&
          event.detail?.docId === activeDocId,
      );
      const recoveryIndex = events.findIndex(
        (event) =>
          event.name === "chart-step-settle-recovery" &&
          event.detail?.docId === activeDocId,
      );
      const paints = events.filter(
        (event) =>
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === activeDocId,
      );
      const suppressedPaints = events.filter(
        (event) =>
          event.name === "chart-canvas-paint-suppressed" &&
          event.detail?.docId === activeDocId,
      );
      const recoveryPaints = recoveryIndex < 0
        ? []
        : events.slice(recoveryIndex + 1).filter(
            (event) =>
              event.name === "chart-canvas-paint" &&
              event.detail?.docId === activeDocId,
          );
      const fullRecoveryPaints = recoveryPaints.filter(
        (event) =>
          event.detail?.mode === "full" &&
          event.detail?.settleOverlayOnly !== true &&
          event.detail?.dirty?.geometry === true &&
          event.detail?.dirty?.dynamic === true &&
          event.detail?.dirty?.outerLabel === true,
      );
      const recoveryEvent = recoveryEvents.at(-1);
      const suppressedPaint = suppressedPaints.at(-1);
      const recoveryPaint = fullRecoveryPaints.at(-1);
      const recoveryDisplayDatetime = recoveryPaint?.detail?.displayDatetime ?? null;
      const recoverySemanticFrameSignature =
        recoveryPaint?.detail?.semanticFrameSignature ?? null;
      const suppressedDisplayDatetime = suppressedPaint?.detail?.displayDatetime ?? null;
      const suppressedSemanticFrameSignature =
        suppressedPaint?.detail?.semanticFrameSignature ?? null;
      return {
        recoveryEvents: recoveryEvents.length,
        recoveryHadPublishedStep: recoveryEvent?.detail?.hadPublishedStep === true,
        recoveryHadPaintedStep: recoveryEvent?.detail?.hadPaintedStep === true,
        stepIntents: events.filter(
          (event) =>
            event.name === "chart-step-intent" &&
            event.detail?.docId === activeDocId,
        ).length,
        suppressedStepPaints: suppressedPaints.length,
        totalPaints: paints.length,
        recoveryPaints: recoveryPaints.length,
        fullRecoveryPaints: fullRecoveryPaints.length,
        overlayOnlyPaints: paints.filter(
          (event) => event.detail?.settleOverlayOnly === true,
        ).length,
        baselineDisplayDatetime,
        recoveryDisplayDatetime,
        cursorAdvanced:
          typeof recoveryDisplayDatetime === "string" &&
          recoveryDisplayDatetime !== baselineDisplayDatetime,
        baselineSemanticFrameSignature,
        recoverySemanticFrameSignature,
        semanticFrameAdvanced:
          typeof recoverySemanticFrameSignature === "string" &&
          recoverySemanticFrameSignature !== baselineSemanticFrameSignature,
        recoveredSuppressedFrame:
          typeof suppressedDisplayDatetime === "string" &&
          suppressedDisplayDatetime === recoveryDisplayDatetime &&
          typeof suppressedSemanticFrameSignature === "string" &&
          suppressedSemanticFrameSignature === recoverySemanticFrameSignature,
      };
    },
    {
      activeDocId: docId,
      baselineDisplayDatetime: baseline.displayDatetime,
      baselineSemanticFrameSignature: baseline.semanticFrameSignature,
    },
  );
}

async function runMissedStepRecoveryScenario(page, docId) {
  const baseline = await readRecoveryBaseline(page, docId, "Missed-step recovery scenario");
  await resetChartPerfEvents(page);

  const routePattern = "**/api/workspace/navigate-key*";
  let interceptedResponses = 0;
  let responseHadSnapshot = false;
  let responseStepped = false;
  const omitStepSnapshot = async (route) => {
    interceptedResponses += 1;
    const response = await route.fetch();
    const payload = await response.json();
    responseHadSnapshot = Boolean(
      payload && typeof payload === "object" && payload.snapshot,
    );
    responseStepped = payload?.stepped === true;
    if (payload && typeof payload === "object") {
      delete payload.snapshot;
    }
    await route.fulfill({ response, json: payload });
  };

  await page.route(routePattern, omitStepSnapshot, { times: 1 });
  try {
    await page.keyboard.press(key);
    await waitForFullRecoveryPaint(page, docId, false);
  } finally {
    await page.unroute(routePattern, omitStepSnapshot);
  }
  await page.waitForTimeout(200);

  const observed = await readRecoveryObservation(page, docId, baseline);
  const result = {
    interceptedResponses,
    responseHadSnapshot,
    responseStepped,
    ...observed,
  };
  return {
    ...result,
    passed:
      result.interceptedResponses === 1 &&
      result.responseHadSnapshot &&
      result.responseStepped &&
      result.recoveryEvents === 1 &&
      !result.recoveryHadPublishedStep &&
      !result.recoveryHadPaintedStep &&
      result.totalPaints === 1 &&
      result.recoveryPaints === 1 &&
      result.fullRecoveryPaints === 1 &&
      result.overlayOnlyPaints === 0 &&
      result.cursorAdvanced &&
      result.semanticFrameAdvanced,
  };
}

async function runUnpaintedStepRecoveryScenario(page, docId) {
  const baseline = await readRecoveryBaseline(
    page,
    docId,
    "Unpainted-step recovery scenario",
  );
  await resetChartPerfEvents(page);
  await page.evaluate(() => {
    window.__ARIES_CHART_PERF_SUPPRESS_NEXT_STEP_PAINT__ = true;
  });
  try {
    await page.keyboard.press(key);
    await waitForFullRecoveryPaint(page, docId, true);
  } finally {
    await page.evaluate(() => {
      window.__ARIES_CHART_PERF_SUPPRESS_NEXT_STEP_PAINT__ = false;
    });
  }
  await page.waitForTimeout(200);

  const result = await readRecoveryObservation(page, docId, baseline);
  return {
    ...result,
    passed:
      result.recoveryEvents === 1 &&
      result.recoveryHadPublishedStep &&
      !result.recoveryHadPaintedStep &&
      result.stepIntents === 1 &&
      result.suppressedStepPaints === 1 &&
      result.totalPaints === 1 &&
      result.recoveryPaints === 1 &&
      result.fullRecoveryPaints === 1 &&
      result.overlayOnlyPaints === 0 &&
      result.cursorAdvanced &&
      result.semanticFrameAdvanced &&
      result.recoveredSuppressedFrame,
  };
}

function gitValue(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { cwd: path.resolve(frontendDir, "../.."), encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function discoverDaemonToken() {
  if (process.env.ARIES_DAEMON_TOKEN) return process.env.ARIES_DAEMON_TOKEN;
  try {
    const pids = execFileSync(
      "lsof",
      ["-tiTCP:" + daemonPort, "-sTCP:LISTEN"],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      const processLine = execFileSync("ps", ["eww", "-p", pid], { encoding: "utf8" });
      const match = processLine.match(/(?:^|\s)ARIES_DAEMON_TOKEN=([^\s]+)/);
      if (match) return match[1];
    }
  } catch {
    // The actionable error below covers a missing or non-Tauri daemon.
  }
  throw new Error(
    `Could not discover the native development daemon on port ${daemonPort}. Run make run first.`,
  );
}

async function startIsolatedDaemon() {
  const daemonToken = randomUUID().replaceAll("-", "");
  const python = process.env.WEB_PYTHON ?? path.join(repoRoot, "webapp/.venv/bin/python");
  const frontendOrigin = new URL(frontendUrl).origin;
  const pythonPath = [path.join(repoRoot, "SWEP/src"), process.env.PYTHONPATH]
    .filter(Boolean)
    .join(path.delimiter);
  const child = spawn(python, ["-m", "webapp.daemon"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ARIES_DAEMON_BASE_DIR: repoRoot,
      ARIES_DAEMON_CORS_ORIGINS: frontendOrigin,
      ARIES_DAEMON_PORT: String(daemonPort),
      ARIES_DAEMON_TOKEN: daemonToken,
      PYTHONPATH: pythonPath,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Isolated Aries performance daemon exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${daemonUrl}/health`, {
        headers: { "X-Aries-Token": daemonToken },
      });
      if (response.ok) return { child, daemonToken };
    } catch {
      // The daemon is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  throw new Error(`Isolated Aries performance daemon did not start on port ${daemonPort}.`);
}

const isolatedDaemon = useNativeDaemon ? null : await startIsolatedDaemon();
const daemonToken = isolatedDaemon?.daemonToken ?? discoverDaemonToken();
let browser = null;
let context = null;
let page = null;
let transitSearchTracker = null;
const searchRequestPaths = [];
let tracePath = null;
let traceStarted = false;

try {
  browser = await chromium.launch({
    headless,
    args: process.env.ARIES_PERF_BACKGROUND === "1"
      ? [
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--metrics-recording-only",
          "--no-first-run",
        ]
      : [],
  });
  context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript(markPerfScript, {
    daemonBaseUrl: daemonUrl,
    daemonToken,
    retainAstrocart,
  });
  page = await context.newPage();
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/search/")) searchRequestPaths.push(pathname);
  });
  transitSearchTracker = createTransitSearchTracker(page);
  if (traceEnabled) {
    tracePath = path.join(perfDir, "chart-step-trace.zip");
    mkdirSync(path.dirname(tracePath), { recursive: true });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;
  }
  const docId = await openChart(page, context);
  const retainedAstrocartId = retainAstrocart
    ? await retainAstrocartSurface(page, docId)
    : null;
  for (let index = 0; index < warmupSteps; index += 1) await stepOnce(page, docId);
  await waitForCoherentSettle(page, docId);
  const retainedAstrocartPerfBefore = retainAstrocart
    ? await readRetainedAstrocartPerf(page)
    : null;
  const overlayBaseline = await readLatestOverlayPerfState(page, docId);
  const searchRequestBaseline = searchRequestPaths.length;
  await page.evaluate(() => {
    window.__ARIES_CHART_PERF_EVENTS__ = [];
  });
  if (burstSize > 0) {
    await stepBurst(page);
  } else {
    for (let index = 0; index < measuredSteps; index += 1) await stepOnce(page, docId);
  }
  await waitForCoherentSettle(page, docId);
  await runFullPaintScenario(page, docId);
  const noListSearchRequests = searchRequestPaths.slice(searchRequestBaseline);
  const events = await page.evaluate(() => window.__ARIES_CHART_PERF_EVENTS__ ?? []);
  const displayToggleCoherence = runExtendedScenarios
    ? await runHouseToggleCoherenceScenario(page, docId)
    : null;
  const missedStepRecovery = runExtendedScenarios
    ? await runMissedStepRecoveryScenario(page, docId)
    : null;
  const unpaintedStepRecovery = runExtendedScenarios
    ? await runUnpaintedStepRecoveryScenario(page, docId)
    : null;
  const heldKeyCadence = await runHeldKeyCadenceSweep(page, docId);
  const retainedTransitList = await runRetainedTransitListScenario(
    page,
    docId,
    transitSearchTracker,
  );
  const retainedAstrocartPerfAfter = retainAstrocart
    ? await readRetainedAstrocartPerf(page)
    : null;
  const paints = events.filter(
    (event) =>
      event.name === "chart-canvas-paint" &&
      event.detail?.docId === docId &&
      event.detail?.mode === "step_fast",
  );
  const rawStepInputs = events.filter(
    (event) =>
      event.name === "chart-step-input" &&
      event.detail?.docId === docId &&
      event.detail?.paintsSnapshot === true,
  );
  const renderBoundaryCallbacks = events.filter(
    (event) =>
      event.name === "chart-step-render-boundary" &&
      event.detail?.docId === docId,
  );
  const completeBoundaryCallbacks = renderBoundaryCallbacks.filter(completeRenderBoundary);
  const boundaryTimeouts = renderBoundaryCallbacks.filter(
    (event) => event.detail?.timedOut === true,
  ).length;
  const rawInputIds = rawStepInputs
    .map((event) => event.detail?.inputId)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const rawInputById = new Map(
    rawStepInputs.flatMap((event) =>
      Number.isSafeInteger(event.detail?.inputId) &&
      event.detail.inputId > 0 &&
      Number.isFinite(event.detail?.intentAt)
        ? [[event.detail.inputId, event]]
        : []),
  );
  const paintInputIds = paints.flatMap((event) => integerEventIds(event, "stepInputIds"));
  const boundaryInputIds = completeBoundaryCallbacks.flatMap(
    (event) => integerEventIds(event, "inputIds"),
  );
  const rawInputIdSet = new Set(rawInputIds);
  const paintInputIdSet = new Set(paintInputIds);
  const boundaryInputIdSet = new Set(boundaryInputIds);
  const paintByInputId = new Map(
    paints.flatMap((event) => {
      const ids = integerEventIds(event, "stepInputIds");
      return ids.length === 1 ? [[ids[0], event]] : [];
    }),
  );
  const completeBoundaryMatchesPaint = completeBoundaryCallbacks.every((event) => {
    const ids = integerEventIds(event, "inputIds");
    if (ids.length !== 1) return false;
    const input = rawInputById.get(ids[0]);
    const paint = paintByInputId.get(ids[0]);
    return (
      input != null &&
      paint != null &&
      event.detail.appliedInputs === 1 &&
      event.detail.intentAt === input.detail.intentAt &&
      event.detail.canvasAt === paint.at
    );
  });
  const completePaintMatchesInput = paints.every((event) => {
    const ids = integerEventIds(event, "stepInputIds");
    if (ids.length !== 1) return false;
    const input = rawInputById.get(ids[0]);
    return (
      input != null &&
      event.detail?.stepAppliedInputs === 1 &&
      event.detail?.stepIntentAt === input.detail.intentAt
    );
  });
  const exactInputIdEquivalence =
    rawInputIds.length === rawStepInputs.length &&
    duplicateCount(rawInputIds) === 0 &&
    duplicateCount(paintInputIds) === 0 &&
    duplicateCount(boundaryInputIds) === 0 &&
    paints.every((event) => integerEventIds(event, "stepInputIds").length === 1) &&
    completeBoundaryCallbacks.every(
      (event) => integerEventIds(event, "inputIds").length === 1,
    ) &&
    sameIdSet(rawInputIdSet, paintInputIdSet) &&
    sameIdSet(rawInputIdSet, boundaryInputIdSet) &&
    sameIdSequence(rawInputIds, paintInputIds) &&
    sameIdSequence(rawInputIds, boundaryInputIds) &&
    completePaintMatchesInput &&
    completeBoundaryMatchesPaint;
  const nextRafTimestampSummary = timestampCollisionSummary(
    completeBoundaryCallbacks,
    "nextFrameTimestamp",
  );
  const secondRafTimestampSummary = timestampCollisionSummary(
    completeBoundaryCallbacks,
    "secondFrameTimestamp",
  );
  const comparablePostRenderCallbacks = completeBoundaryCallbacks.filter(
    postRenderTaskComparable,
  );
  const latePostRenderTasks =
    completeBoundaryCallbacks.length - comparablePostRenderCallbacks.length;
  const firstPaintValues = paints
    .map((event) => event.detail?.stepIntentToPaintMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const canvasValues = paints
    .map((event) => event.detail?.totalMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const paintGapValues = paints
    .slice(1)
    .map((event, index) => event.at - paints[index].at)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const navigateCommands = events.filter(
    (event) =>
      event.name === "workspace-command" && event.detail?.path === "/api/workspace/navigate-key",
  );
  const longTasks = events.filter((event) => event.name === "browser-long-task");
  const stepIntentEvents = events.filter((event) => event.name === "chart-step-intent");
  const appliedInputsPerPaint = stepIntentEvents
    .map((event) => event.detail?.repeat)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const appliedStepInputs = appliedInputsPerPaint.reduce((total, value) => total + value, 0);
  const expectedStepInputs = burstSize > 0 ? burstSize : measuredSteps;
  const stepIntentTimes = rawStepInputs
    .map((event) => event.detail?.intentAt)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const firstStepIntentAt = stepIntentTimes.reduce(
    (earliest, value) => Math.min(earliest, value),
    Number.POSITIVE_INFINITY,
  );
  const inputGapValues = stepIntentTimes
    .slice(1)
    .map((intentAt, index) => intentAt - stepIntentTimes[index]);
  const correlatedPaintCadence = paints.flatMap((event) => {
    const ids = integerEventIds(event, "stepInputIds");
    const input = ids.length === 1 ? rawInputById.get(ids[0]) : null;
    return input && Number.isFinite(input.detail?.intentAt)
      ? [{ inputId: ids[0], inputAt: input.detail.intentAt, paintAt: event.at }]
      : [];
  });
  const paintGapOverInputValues = correlatedPaintCadence
    .slice(1)
    .flatMap((current, index) => {
      const previous = correlatedPaintCadence[index];
      const paintGap = current.paintAt - previous.paintAt;
      const inputGap = current.inputAt - previous.inputAt;
      return paintGap >= 0 && inputGap >= 0
        ? [Math.max(0, paintGap - inputGap)]
        : [];
    });
  const correlatedBoundaryCadence = completeBoundaryCallbacks.flatMap((event) => {
    const ids = integerEventIds(event, "inputIds");
    const input = ids.length === 1 ? rawInputById.get(ids[0]) : null;
    return input
      ? [{
          inputId: ids[0],
          inputAt: input.detail.intentAt,
          nextFrameAt: event.detail.nextFrameAt,
          nextFrameTimestamp: event.detail.nextFrameTimestamp,
          postRenderAt: event.detail.postRenderAt,
          postRenderComparable: postRenderTaskComparable(event),
        }]
      : [];
  });
  const nextRafOpportunityGapValues = [];
  let previousNextRafTimestamp = null;
  for (const boundary of correlatedBoundaryCadence) {
    if (
      previousNextRafTimestamp != null &&
      boundary.nextFrameTimestamp > previousNextRafTimestamp
    ) {
      nextRafOpportunityGapValues.push(
        boundary.nextFrameTimestamp - previousNextRafTimestamp,
      );
    }
    if (
      previousNextRafTimestamp == null ||
      boundary.nextFrameTimestamp > previousNextRafTimestamp
    ) {
      previousNextRafTimestamp = boundary.nextFrameTimestamp;
    }
  }
  const postRenderTaskGapValues = correlatedBoundaryCadence
    .slice(1)
    .flatMap((current, index) => {
      const previous = correlatedBoundaryCadence[index];
      const gap = current.postRenderAt - previous.postRenderAt;
      return current.postRenderComparable && previous.postRenderComparable && gap >= 0
        ? [gap]
        : [];
    });
  const postRenderGapOverInputValues = correlatedBoundaryCadence
    .slice(1)
    .flatMap((current, index) => {
      const previous = correlatedBoundaryCadence[index];
      const taskGap = current.postRenderAt - previous.postRenderAt;
      const inputGap = current.inputAt - previous.inputAt;
      return current.postRenderComparable &&
        previous.postRenderComparable &&
        taskGap >= 0 &&
        inputGap >= 0
        ? [Math.max(0, taskGap - inputGap)]
        : [];
    });
  const postRenderGapDeltaValues = correlatedBoundaryCadence
    .slice(1)
    .flatMap((current, index) => {
      const previous = correlatedBoundaryCadence[index];
      const taskGap = current.postRenderAt - previous.postRenderAt;
      const inputGap = current.inputAt - previous.inputAt;
      return current.postRenderComparable &&
        previous.postRenderComparable &&
        taskGap >= 0 &&
        inputGap >= 0
        ? [Math.abs(taskGap - inputGap)]
        : [];
    });
  const lastStepPaintAt = paints.at(-1)?.at ?? Number.NEGATIVE_INFINITY;
  const settleStartEvents = events.filter(
    (event) => event.name === "chart-step-settle-start" && event.detail?.docId === docId,
  );
  const settleStartsDuringBurst = settleStartEvents.filter(
    (event) => event.at >= firstStepIntentAt && event.at <= lastStepPaintAt,
  ).length;
  const settleStartsAfterBurst = settleStartEvents.filter(
    (event) => event.at > lastStepPaintAt,
  ).length;
  const visualCadence = {
    observed: paints.length > 0 && appliedInputsPerPaint.length > 0,
    expectedInputs: expectedStepInputs,
    appliedInputs: appliedStepInputs,
    navigateCommands: navigateCommands.length,
    stepFastPaints: paints.length,
    rawInputs: rawStepInputs.length,
    renderBoundaryCallbacks: renderBoundaryCallbacks.length,
    completeBoundaryCallbacks: completeBoundaryCallbacks.length,
    boundaryTimeouts,
    incompleteBoundaryCallbacks:
      renderBoundaryCallbacks.length - completeBoundaryCallbacks.length,
    completedBoundaryProbes: completeBoundaryCallbacks.length,
    uniqueNextRafOpportunities: nextRafTimestampSummary.unique,
    rafCollisionGroups: nextRafTimestampSummary.groups,
    rafCollisionExcess: nextRafTimestampSummary.excess,
    maxCanvasesPerNextRaf: nextRafTimestampSummary.maximum,
    latePostRenderTasks,
    uniqueNextRafTimestamps: nextRafTimestampSummary.unique,
    nextRafTimestampCollisions: nextRafTimestampSummary.excess,
    uniqueSecondRafTimestamps: secondRafTimestampSummary.unique,
    secondRafTimestampCollisions: secondRafTimestampSummary.excess,
    maxAppliedInputsPerPaint: appliedInputsPerPaint.length > 0
      ? Math.max(...appliedInputsPerPaint)
      : null,
    noDroppedInputs: appliedStepInputs === expectedStepInputs,
    oneCommandPerInput: navigateCommands.length === expectedStepInputs,
    oneInputPerPaint:
      appliedInputsPerPaint.length === paints.length &&
      appliedInputsPerPaint.every((value) => value === 1),
    onePaintPerInput: paints.length === expectedStepInputs,
    oneRawInputPerExpectedInput: rawStepInputs.length === expectedStepInputs,
    oneCompleteBoundaryCallbackPerPaint:
      completeBoundaryCallbacks.length === paints.length,
    allBoundaryCallbacksComplete:
      completeBoundaryCallbacks.length === renderBoundaryCallbacks.length,
    exactInputIdEquivalence,
    noBoundaryTimeouts: boundaryTimeouts === 0,
    noNextRafTimestampCollisions: nextRafTimestampSummary.excess === 0,
    settleStartsDuringBurst,
    settleStartsAfterBurst,
    noSettleContention: settleStartsDuringBurst === 0,
    oneSettleAfterBurst: settleStartsAfterBurst === 1,
  };
  visualCadence.passed =
    visualCadence.observed &&
    visualCadence.noDroppedInputs &&
    visualCadence.oneCommandPerInput &&
    visualCadence.oneInputPerPaint &&
    visualCadence.onePaintPerInput &&
    visualCadence.oneRawInputPerExpectedInput &&
    visualCadence.oneCompleteBoundaryCallbackPerPaint &&
    visualCadence.allBoundaryCallbacksComplete &&
    visualCadence.exactInputIdEquivalence &&
    visualCadence.noBoundaryTimeouts &&
    visualCadence.noNextRafTimestampCollisions &&
    visualCadence.noSettleContention &&
    visualCadence.oneSettleAfterBurst;
  const lastStepPaint = paints.at(-1) ?? null;
  const settledPaint = lastStepPaint
    ? events.find(
        (event) =>
          event.at > lastStepPaint.at &&
          event.name === "chart-canvas-paint" &&
          event.detail?.docId === docId &&
          event.detail?.settleOverlayOnly === true,
      ) ?? null
    : null;
  const stepOverlayStates = paints
    .map((event) => event.detail?.overlay)
    .filter((overlay) => overlay && Array.isArray(overlay.rows));
  const settledOverlayState = settledPaint?.detail?.overlay ?? null;
  const populatedBaselineGroups = Object.entries(overlayBaseline?.groupCounts ?? {})
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([group]) => group);
  const rowsForSlot = (overlay, slot) => (overlay?.rows ?? [])
    .filter((row) => row.slot === slot)
    .map((row) => row.signature)
    .sort();
  const deferredSlots = ["term-lord", "signal"].filter(
    (slot) => rowsForSlot(overlayBaseline, slot).length > 0,
  );
  const cheapSlots = ["planetary-day", "planetary-hour", "lord-of-year"];
  const baselineCheapSlots = cheapSlots.filter(
    (slot) => rowsForSlot(overlayBaseline, slot).length > 0,
  );
  const lastStepOverlayState = stepOverlayStates.at(-1) ?? null;
  const observedCheapSlots = cheapSlots.filter(
    (slot) =>
      rowsForSlot(lastStepOverlayState, slot).length > 0 ||
      rowsForSlot(settledOverlayState, slot).length > 0,
  );
  const overlayContinuity = {
    observed: Boolean(
      overlayBaseline &&
      stepOverlayStates.length === paints.length &&
      settledOverlayState,
    ),
    baselineGroupCounts: overlayBaseline?.groupCounts ?? null,
    noBlankStepFrames:
      populatedBaselineGroups.length > 0 &&
      stepOverlayStates.every((overlay) =>
        populatedBaselineGroups.every((group) => (overlay.groupCounts?.[group] ?? 0) > 0),
      ),
    stepFramesDeferred:
      stepOverlayStates.length > 0 &&
      stepOverlayStates.every((overlay) => overlay.deferredSignals === true),
    currentCheapRowsNeverBlank:
      baselineCheapSlots.length > 0 &&
      stepOverlayStates.every((overlay) =>
        baselineCheapSlots.every((slot) => rowsForSlot(overlay, slot).length > 0),
      ),
    deferredSlots,
    deferredSlotsStayedPopulated: stepOverlayStates.every((overlay) =>
      deferredSlots.every((slot) => rowsForSlot(overlay, slot).length > 0),
    ),
    cheapSlotsCompared: observedCheapSlots,
    cheapRowsMatchSettle:
      observedCheapSlots.length > 0 &&
      observedCheapSlots.every(
        (slot) =>
          JSON.stringify(rowsForSlot(lastStepOverlayState, slot)) ===
          JSON.stringify(rowsForSlot(settledOverlayState, slot)),
      ),
    fullSettleAuthoritative: Boolean(
      settledPaint?.detail?.mode === "full" &&
      settledOverlayState &&
      settledOverlayState.deferredSignals === false,
    ),
  };
  overlayContinuity.passed =
    overlayContinuity.observed &&
    overlayContinuity.noBlankStepFrames &&
    overlayContinuity.stepFramesDeferred &&
    overlayContinuity.currentCheapRowsNeverBlank &&
    overlayContinuity.deferredSlotsStayedPopulated &&
    overlayContinuity.cheapRowsMatchSettle &&
    overlayContinuity.fullSettleAuthoritative;
  const visualContinuity = {
    observed: Boolean(lastStepPaint && settledPaint),
    overlayOnly: Boolean(
      settledPaint &&
      settledPaint.detail?.dirty?.geometry === false &&
      settledPaint.detail?.dirty?.dynamic === false &&
      settledPaint.detail?.dirty?.outerLabel === false,
    ),
    sameBodyLayout: Boolean(
      lastStepPaint?.detail?.bodyLayoutSignature &&
      settledPaint?.detail?.bodyLayoutSignature === lastStepPaint.detail.bodyLayoutSignature,
    ),
  };
  visualContinuity.passed =
    visualContinuity.observed && visualContinuity.overlayOnly && visualContinuity.sameBodyLayout;
  const metrics = {
    "time-step.first-useful-paint": summarizeMetric(
      firstPaintValues,
      budgetValue("time-step.first-useful-paint"),
    ),
    "chart.canvas.step_fast": summarizeMetric(
      canvasValues,
      budgetValue("chart.canvas.step_fast"),
    ),
    "chart.canvas.body-layout": summarizeMetric(
      nestedNumericEventDetails(paints, ["dynamicProfile", "body-layout", "ms"]),
      budgetValue("chart.canvas.body-layout"),
    ),
    "chart.canvas.full": summarizeMetric(
      numericEventDetails(
        events,
        "chart-canvas-paint",
        "totalMs",
        (event) => event.detail?.docId === docId && event.detail?.mode === "full",
      ),
      budgetValue("chart.canvas.full"),
    ),
    "list.scroll-to-frame": summarizeMetric(
      numericEventDetails(
        retainedTransitList?.scrollEvents ?? [],
        "list-scroll-frame",
        "eventToFrameMs",
      ),
      measureListScroll ? budgetValue("list.scroll-to-frame") : null,
    ),
    ...(burstSize > 0
      ? {
          "time-step.paint-gap-over-input": summarizeMetric(
            paintGapOverInputValues,
            budgetValue("time-step.paint-gap-over-input"),
          ),
        }
      : {}),
  };
  const diagnostics = {
    "time-step.command-total": summarizeMetric(
      numericEventDetails(navigateCommands, "workspace-command", "totalMs"),
      budgetValue("time-step.command-total"),
    ),
    "time-step.paint-gap": summarizeMetric(paintGapValues),
    "time-step.input-gap": summarizeMetric(inputGapValues),
    "time-step.command-fetch": summarizeMetric(
      numericEventDetails(navigateCommands, "workspace-command", "fetchMs"),
    ),
    "time-step.command-parse": summarizeMetric(
      numericEventDetails(navigateCommands, "workspace-command", "parseMs"),
      budgetValue("time-step.command-parse"),
    ),
    "time-step.payload-bytes": summarizeMetric(
      numericEventDetails(navigateCommands, "workspace-command", "bytes"),
      budgetValue("time-step.payload-bytes"),
    ),
    "browser.long-task": summarizeMetric(
      numericEventDetails(longTasks, "browser-long-task", "durationMs"),
    ),
    "time-step.canvas-to-next-frame": summarizeMetric(
      completeBoundaryCallbacks
        .map((event) => event.detail?.nextFrameAt - event.detail?.canvasAt)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.intent-to-next-frame": summarizeMetric(
      completeBoundaryCallbacks
        .map((event) => event.detail?.nextFrameAt - event.detail?.intentAt)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.canvas-to-post-render-task": summarizeMetric(
      comparablePostRenderCallbacks
        .map((event) => event.detail?.postRenderAt - event.detail?.canvasAt)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.intent-to-post-render-task": summarizeMetric(
      comparablePostRenderCallbacks
        .map((event) => event.detail?.postRenderAt - event.detail?.intentAt)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.raf-to-post-render-task": summarizeMetric(
      comparablePostRenderCallbacks
        .map((event) => event.detail?.postRenderAt - event.detail?.nextFrameAt)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.next-frame-interval": summarizeMetric(
      completeBoundaryCallbacks
        .map((event) =>
          event.detail?.secondFrameTimestamp - event.detail?.nextFrameTimestamp)
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
    "time-step.next-raf-opportunity-gap": summarizeMetric(
      nextRafOpportunityGapValues,
    ),
    "time-step.post-render-task-gap": summarizeMetric(postRenderTaskGapValues),
    "time-step.post-render-gap-over-input": summarizeMetric(
      postRenderGapOverInputValues,
    ),
    "time-step.post-render-gap-delta": summarizeMetric(postRenderGapDeltaValues),
    "chart.canvas.geometry": summarizeMetric(
      numericEventDetails(paints, "chart-canvas-paint", "geometryMs"),
    ),
    "chart.canvas.dynamic": summarizeMetric(
      numericEventDetails(paints, "chart-canvas-paint", "dynamicMs"),
    ),
    "chart.canvas.outer-label": summarizeMetric(
      numericEventDetails(paints, "chart-canvas-paint", "outerLabelMs"),
    ),
    "chart.canvas.hit-regions": summarizeMetric(
      numericEventDetails(paints, "chart-canvas-paint", "hitMs"),
    ),
    "daemon.navigate.total": summarizeMetric(
      nestedNumericEventDetails(navigateCommands, ["debugTiming", "totalMs"]),
    ),
    "daemon.navigate.pre-snapshot": summarizeMetric(
      nestedNumericEventDetails(navigateCommands, ["debugTiming", "preSnapshotMs"]),
    ),
    "daemon.snapshot.total": summarizeMetric(
      nestedNumericEventDetails(navigateCommands, ["debugTiming", "snapshot", "totalMs"]),
    ),
    ...phaseDiagnostics(
      navigateCommands,
      ["debugTiming", "snapshot", "phases"],
      "daemon.snapshot.phase",
    ),
    ...phaseDiagnostics(
      navigateCommands,
      ["debugTiming", "snapshot", "export", "phases"],
      "daemon.export.phase",
    ),
  };
  const requiredMetrics = [
    "chart.canvas.step_fast",
    "chart.canvas.body-layout",
    "time-step.first-useful-paint",
    "time-step.command-total",
    "time-step.command-parse",
    "time-step.payload-bytes",
    ...(burstSize > 0 ? ["time-step.paint-gap-over-input"] : []),
    ...(measureFullPaint ? ["chart.canvas.full"] : []),
    ...(measureListScroll ? ["list.scroll-to-frame"] : []),
  ];
  const requiredContracts = [
    "visualCadence",
    "overlayContinuity",
    "visualContinuity",
    "noListSearchIsolation",
    "heldKeyCadence",
    ...(runExtendedScenarios
      ? ["displayToggleCoherence", "missedStepRecovery", "unpaintedStepRecovery"]
      : []),
    ...(retainedTransitList ? ["retainedTransitList"] : []),
  ];
  const result = {
    recordedAt: new Date().toISOString(),
    budgetVersion: budgets.version,
    gitCommit:
      process.env.ARIES_PERF_GIT_COMMIT ?? gitValue(["rev-parse", "HEAD"]),
    gitDirty:
      process.env.ARIES_PERF_GIT_DIRTY != null
        ? process.env.ARIES_PERF_GIT_DIRTY === "1"
        : gitValue(["status", "--porcelain"], "") !== "",
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    harnessMode: useNativeDaemon ? "shared native daemon" : "isolated daemon",
    scenarioProfile,
    requiredMetrics,
    requiredContracts,
    browserVersion: browser.version(),
    frontendUrl,
    key,
    requestedTheme: requestedTheme || null,
    warmupSteps,
    measuredSteps,
    burst: burstSize > 0
      ? {
          emittedInputs: burstSize,
          intervalMs: burstIntervalMs,
          navigateCommands: navigateCommands.length,
          stepFastPaints: paints.length,
          appliedInputs: appliedStepInputs,
          droppedInputs: Math.max(0, burstSize - appliedStepInputs),
          maxAppliedInputsPerPaint: visualCadence.maxAppliedInputsPerPaint,
          oneInputPerPaint: visualCadence.oneInputPerPaint,
          settleStartsDuringBurst: visualCadence.settleStartsDuringBurst,
          settleStartsAfterBurst: visualCadence.settleStartsAfterBurst,
          commands: navigateCommands.map((event, index) => ({
            repeat: events.filter((candidate) => candidate.name === "chart-step-intent")[index]?.detail?.repeat ?? null,
            totalMs: rounded(event.detail?.totalMs),
            fetchMs: rounded(event.detail?.fetchMs),
            bodyMs: rounded(event.detail?.bodyMs),
            parseMs: rounded(event.detail?.parseMs),
            preSnapshotMs: rounded(event.detail?.debugTiming?.preSnapshotMs),
            snapshotMs: rounded(event.detail?.debugTiming?.snapshot?.totalMs),
            canvasMs: rounded(paints[index]?.detail?.totalMs),
            intentToPaintMs: rounded(paints[index]?.detail?.stepIntentToPaintMs),
            dynamicProfile: paints[index]?.detail?.dynamicProfile ?? null,
            bodyLayoutSignature: paints[index]?.detail?.bodyLayoutSignature ?? null,
            semanticFrameSignature: paints[index]?.detail?.semanticFrameSignature ?? null,
            width: paints[index]?.detail?.width ?? null,
            height: paints[index]?.detail?.height ?? null,
            chartSize: paints[index]?.detail?.chartSize ?? null,
          })),
        }
      : null,
    docId,
    retainedAstrocartId,
    retainedAstrocartPerf: retainAstrocart
      ? { before: retainedAstrocartPerfBefore, after: retainedAstrocartPerfAfter }
      : null,
    visualCadence,
    overlayContinuity,
    visualContinuity,
    displayToggleCoherence,
    missedStepRecovery,
    unpaintedStepRecovery,
    heldKeyCadence,
    noListSearchRequests,
    retainedTransitList,
    metrics,
    diagnostics,
  };
  const outputPath = path.join(perfDir, "chart-step-speedlog.jsonl");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(result)}\n`);
  console.table({ ...metrics, ...diagnostics });
  console.log(`visual cadence: ${visualCadence.passed ? "PASS" : "FAIL"}`);
  console.log(`overlay continuity: ${overlayContinuity.passed ? "PASS" : "FAIL"}`);
  console.log(`visual continuity: ${visualContinuity.passed ? "PASS" : "FAIL"}`);
  if (displayToggleCoherence) {
    console.log(`display-toggle coherence: ${displayToggleCoherence.passed ? "PASS" : "FAIL"}`);
  }
  if (missedStepRecovery) {
    console.log(`missed-step recovery: ${missedStepRecovery.passed ? "PASS" : "FAIL"}`);
  }
  if (unpaintedStepRecovery) {
    console.log(`unpainted-step recovery: ${unpaintedStepRecovery.passed ? "PASS" : "FAIL"}`);
  }
  console.log(`held-key cadence sweep: ${heldKeyCadence.passed ? "PASS" : "FAIL"}`);
  for (const row of heldKeyCadence.results) {
    console.log(
      `  ${String(row.intervalMs).padStart(4)} ms repeat  ` +
        `inputs ${row.appliedInputs}/${row.emittedInputs}  paints ${row.paints}  ` +
        `settles held/released ${row.settlesDuringHold}/${row.settlesAfterRelease}  ` +
        (row.passed ? "ok" : "FAIL"),
    );
  }
  console.log(`no-list Search requests: ${noListSearchRequests.length}`);
  if (retainedTransitList) {
    console.log(`retained Transit List stepping: ${retainedTransitList.passed ? "PASS" : "FAIL"}`);
  }
  console.log(`speedlog: ${outputPath}`);
  const burstContractBreached = burstSize > 0 && appliedStepInputs !== burstSize;
  if (
    burstContractBreached ||
    !visualCadence.passed ||
    !overlayContinuity.passed ||
    !visualContinuity.passed ||
    (displayToggleCoherence != null && !displayToggleCoherence.passed) ||
    (missedStepRecovery != null && !missedStepRecovery.passed) ||
    (unpaintedStepRecovery != null && !unpaintedStepRecovery.passed) ||
    !heldKeyCadence.passed ||
    noListSearchRequests.length > 0 ||
    (retainedTransitList != null && !retainedTransitList.passed) ||
    Object.values({ ...metrics, ...diagnostics }).some((metric) => metric.breached)
  ) {
    throw new Error(
      burstContractBreached
        ? `Aries time-step burst lost inputs (${appliedStepInputs}/${burstSize} applied).`
        : !visualCadence.passed
          ? `Aries time-step Canvas/boundary-callback cadence lost, merged, duplicated, or incompletely paired an input: ${JSON.stringify(visualCadence)}.`
        : !overlayContinuity.passed
          ? `Aries time-step overlay blanked or settled incoherently: ${JSON.stringify(overlayContinuity)}.`
        : !visualContinuity.passed
          ? `Aries settled frame changed visible step geometry: ${JSON.stringify(visualContinuity)}.`
        : displayToggleCoherence != null && !displayToggleCoherence.passed
          ? `Aries house toggle produced duplicate or stale paints: ${JSON.stringify(displayToggleCoherence)}.`
        : missedStepRecovery != null && !missedStepRecovery.passed
          ? `Aries missed-step settle did not recover one coherent full paint: ${JSON.stringify(missedStepRecovery)}.`
        : unpaintedStepRecovery != null && !unpaintedStepRecovery.passed
          ? `Aries unpainted-step settle did not recover one coherent full paint: ${JSON.stringify(unpaintedStepRecovery)}.`
        : !heldKeyCadence.passed
          ? `Aries held-key burst broke the settle contract (expected 0 settles while held, exactly 1 after release): ${JSON.stringify(heldKeyCadence.results.filter((row) => !row.passed))}.`
        : noListSearchRequests.length > 0
          ? `Aries no-list stepping unexpectedly started Search requests: ${noListSearchRequests.join(", ")}.`
        : retainedTransitList != null && !retainedTransitList.passed
          ? `Aries retained Transit List violated the resident frame lane: ${JSON.stringify(retainedTransitList)}.`
        : `Aries performance budget exceeded. Re-run with CHART_STEP_TRACE=1 for a Playwright trace.`,
    );
  }
} catch (error) {
  if (String(error).includes("ERR_CONNECTION_REFUSED")) {
    console.error("Aries is not running. Start the native development app with `make run`, then retry.");
  }
  throw error;
} finally {
  if (traceStarted && context) await context.tracing.stop({ path: tracePath });
  await context?.close();
  await browser?.close();
  isolatedDaemon?.child.kill("SIGTERM");
}
