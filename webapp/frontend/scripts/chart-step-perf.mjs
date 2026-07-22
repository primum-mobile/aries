#!/usr/bin/env node
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
const retainAstrocart = process.env.CHART_STEP_RETAINED_ASTROCART === "1";
const measureListScroll = process.env.CHART_STEP_LIST_SCROLL === "1";
const measureFullPaint = process.env.CHART_STEP_FULL_PAINT === "1";
const measuredSteps = positiveInt("CHART_STEP_RUNS", 30);
// Retained-map runs include a longer warm-up so map activation/teardown is not
// mixed into the steady-state step distribution. This adds well under a second
// while keeping the commit gate deterministic; explicit overrides still win.
const warmupSteps = positiveInt("CHART_STEP_WARMUPS", retainAstrocart ? 15 : 5);
const burstSize = positiveInt("CHART_STEP_BURST_SIZE", 0);
const burstIntervalMs = positiveInt("CHART_STEP_BURST_INTERVAL_MS", 8);
const timeoutMs = positiveInt("CHART_STEP_TIMEOUT_MS", 15_000);
const key = process.env.CHART_STEP_KEY ?? "ArrowRight";
const filter = process.env.CHART_STEP_FILTER ?? "";
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
    p50Ms: rounded(percentile(values, 0.5)),
    p95Ms: rounded(p95Ms),
    maxMs: rounded(values.length ? Math.max(...values) : null),
    budgetMs,
    breached: budgetMs != null && (p95Ms == null || p95Ms > budgetMs),
  };
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

async function openChart(page, context) {
  await page.goto(`${frontendUrl}/?chartPerf=1`, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
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

async function runListScrollScenario(page) {
  if (!measureListScroll) return;
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
  const scroller = table.locator("xpath=..");
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

async function stepBurst(page) {
  for (let index = 0; index < burstSize; index += 1) {
    await page.keyboard.press(key);
    if (burstIntervalMs > 0 && index + 1 < burstSize) {
      await page.waitForTimeout(burstIntervalMs);
    }
  }
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
  await runListScrollScenario(page);
  const retainedAstrocartPerfAfter = retainAstrocart
    ? await readRetainedAstrocartPerf(page)
    : null;
  const events = await page.evaluate(() => window.__ARIES_CHART_PERF_EVENTS__ ?? []);
  const displayToggleCoherence = await runHouseToggleCoherenceScenario(page, docId);
  const missedStepRecovery = await runMissedStepRecoveryScenario(page, docId);
  const unpaintedStepRecovery = await runUnpaintedStepRecoveryScenario(page, docId);
  const paints = events.filter(
    (event) =>
      event.name === "chart-canvas-paint" &&
      event.detail?.docId === docId &&
      event.detail?.mode === "step_fast",
  );
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
  const stepIntentTimes = stepIntentEvents
    .map((event) => event.detail?.intentAt)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const firstStepIntentAt = stepIntentTimes.reduce(
    (earliest, value) => Math.min(earliest, value),
    Number.POSITIVE_INFINITY,
  );
  const inputGapValues = stepIntentTimes
    .slice(1)
    .map((intentAt, index) => intentAt - stepIntentTimes[index]);
  const paintGapOverInputValues = paintGapValues
    .slice(0, inputGapValues.length)
    .map((paintGap, index) => Math.max(0, paintGap - inputGapValues[index]));
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
    maxAppliedInputsPerPaint: appliedInputsPerPaint.length > 0
      ? Math.max(...appliedInputsPerPaint)
      : null,
    noDroppedInputs: appliedStepInputs === expectedStepInputs,
    oneCommandPerInput: navigateCommands.length === expectedStepInputs,
    oneInputPerPaint:
      appliedInputsPerPaint.length === paints.length &&
      appliedInputsPerPaint.every((value) => value === 1),
    onePaintPerInput: paints.length === expectedStepInputs,
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
      numericEventDetails(events, "list-scroll-frame", "eventToFrameMs"),
      budgetValue("list.scroll-to-frame"),
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
    browserVersion: browser.version(),
    frontendUrl,
    key,
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
  console.log(`display-toggle coherence: ${displayToggleCoherence.passed ? "PASS" : "FAIL"}`);
  console.log(`missed-step recovery: ${missedStepRecovery.passed ? "PASS" : "FAIL"}`);
  console.log(`unpainted-step recovery: ${unpaintedStepRecovery.passed ? "PASS" : "FAIL"}`);
  console.log(`speedlog: ${outputPath}`);
  const burstContractBreached = burstSize > 0 && appliedStepInputs !== burstSize;
  if (
    burstContractBreached ||
    !visualCadence.passed ||
    !overlayContinuity.passed ||
    !visualContinuity.passed ||
    !displayToggleCoherence.passed ||
    !missedStepRecovery.passed ||
    !unpaintedStepRecovery.passed ||
    Object.values({ ...metrics, ...diagnostics }).some((metric) => metric.breached)
  ) {
    throw new Error(
      burstContractBreached
        ? `Aries time-step burst lost inputs (${appliedStepInputs}/${burstSize} applied).`
        : !visualCadence.passed
          ? `Aries time-step cadence merged or skipped a presented input: ${JSON.stringify(visualCadence)}.`
        : !overlayContinuity.passed
          ? `Aries time-step overlay blanked or settled incoherently: ${JSON.stringify(overlayContinuity)}.`
        : !visualContinuity.passed
          ? `Aries settled frame changed visible step geometry: ${JSON.stringify(visualContinuity)}.`
        : !displayToggleCoherence.passed
          ? `Aries house toggle produced duplicate or stale paints: ${JSON.stringify(displayToggleCoherence)}.`
        : !missedStepRecovery.passed
          ? `Aries missed-step settle did not recover one coherent full paint: ${JSON.stringify(missedStepRecovery)}.`
        : !unpaintedStepRecovery.passed
          ? `Aries unpainted-step settle did not recover one coherent full paint: ${JSON.stringify(unpaintedStepRecovery)}.`
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
