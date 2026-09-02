#!/usr/bin/env node
// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
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
const timeoutMs = positiveInt("ASTROCART_MAP_TIMEOUT_MS", 30_000);
const warmupsPerInteraction = positiveInt("ASTROCART_MAP_WARMUPS", 2);
const samplesPerInteraction = Math.max(10, positiveInt("ASTROCART_MAP_RUNS", 10));
const idleObservationMs = positiveInt("ASTROCART_MAP_IDLE_MS", 1_000);
const deviceScaleFactor = positiveInt("ASTROCART_MAP_DEVICE_SCALE_FACTOR", 2);
const filter = process.env.ASTROCART_MAP_FILTER ?? "";
const headless = process.env.HEADLESS !== "0";
const perfDir = process.env.ARIES_PERF_OUTPUT_DIR
  ? path.resolve(process.env.ARIES_PERF_OUTPUT_DIR)
  : path.join(frontendDir, ".tmp/perf");
const outputPath = path.join(perfDir, "astrocart-map-speedlog.jsonl");

function positiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rounded(value) {
  return value == null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    samples: finite.length,
    average: rounded(
      finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
    ),
    p50: rounded(percentile(finite, 0.5)),
    p95: rounded(percentile(finite, 0.95)),
    max: rounded(finite.length ? Math.max(...finite) : null),
  };
}

function gitValue(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markAstrocartPerfScript({ daemonBaseUrl, daemonToken }) {
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
  window.localStorage.setItem("ARIES_ASTROCART_FORCE_LOCAL_TILES", "1");
  window.localStorage.setItem("ARIES_ASTROCART_PERF", "1");
  window.__ARIES_CHART_PERF_EVENTS__ = [];

  const state = {
    active: false,
    gaps: [],
    lastRafAt: null,
    longTasks: [],
    rafId: null,
  };
  const tick = (now) => {
    if (!state.active) return;
    if (state.lastRafAt != null) state.gaps.push(now - state.lastRafAt);
    state.lastRafAt = now;
    state.rafId = window.requestAnimationFrame(tick);
  };
  try {
    const observer = new PerformanceObserver((list) => {
      if (!state.active) return;
      for (const entry of list.getEntries()) {
        state.longTasks.push({
          durationMs: entry.duration,
          startTimeMs: entry.startTime,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    // Long Tasks are optional in WebKit, but Chromium provides them for this harness.
  }

  window.__ARIES_ASTROCART_MAP_PROBE__ = {
    start() {
      if (state.rafId != null) window.cancelAnimationFrame(state.rafId);
      state.active = true;
      state.gaps = [];
      state.lastRafAt = null;
      state.longTasks = [];
      state.rafId = window.requestAnimationFrame(tick);
    },
    stop() {
      state.active = false;
      if (state.rafId != null) window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
      return {
        rafGapsMs: state.gaps.slice(),
        longTasks: state.longTasks.slice(),
      };
    },
  };
}

async function daemonCommand(page, pathName, payload) {
  return page.evaluate(
    async ({ commandPath, commandPayload, daemonBaseUrl }) => {
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
    { commandPath: pathName, commandPayload: payload, daemonBaseUrl: daemonUrl },
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

async function openAstrocartSurface(page, docId) {
  const opened = await daemonCommand(page, "/api/workspace/open-astrocart", {
    parentRadixId: docId,
    eclipseJd: null,
    eclipseRetflag: null,
  });
  if (!opened.documentId) throw new Error("Astrocartography command returned no document id.");

  const iframe = page.locator('iframe[title="Astrocartography"]');
  await iframe.waitFor({ state: "visible", timeout: timeoutMs });
  const iframeHandle = await iframe.elementHandle();
  const mapFrame = await iframeHandle?.contentFrame();
  if (!mapFrame) throw new Error("Astrocartography frame was not available.");
  await mapFrame.locator(".maplibregl-canvas").waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
  await mapFrame.waitForFunction(
    () => (
      window.ACG?.getPerfState?.().enabled === true
      && window.ACG?.getPerfState?.().lineFeatureCount > 0
    ),
    null,
    { timeout: timeoutMs },
  );
  return { documentId: opened.documentId, iframe, mapFrame };
}

function countCoordinateVertices(value) {
  if (!Array.isArray(value)) return 0;
  if (
    value.length >= 2
    && typeof value[0] === "number"
    && Number.isFinite(value[0])
    && typeof value[1] === "number"
    && Number.isFinite(value[1])
  ) {
    return 1;
  }
  return value.reduce((total, child) => total + countCoordinateVertices(child), 0);
}

function profileGeoJson(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return {
    featureCount: features.length,
    vertexCount: features.reduce(
      (total, feature) => total + countCoordinateVertices(feature?.geometry?.coordinates),
      0,
    ),
  };
}

function payloadKind(url) {
  if (/\/api\/workspace\/document\/[^/]+\/astrocart$/.test(url.pathname)) return "lines";
  if (/\/api\/workspace\/document\/[^/]+\/astrocart\/asterisms$/.test(url.pathname)) {
    return "asterisms";
  }
  if (url.pathname === "/api/astrocart/eclipse-path") return "eclipse";
  return null;
}

function createPayloadTracker(page) {
  const observations = [];
  const errors = [];
  const pending = new Set();

  const capture = async (response) => {
    const url = new URL(response.url());
    const kind = payloadKind(url);
    if (!kind || response.request().method() !== "GET" || !response.ok()) return;
    const body = await response.body();
    const payload = JSON.parse(body.toString("utf8"));
    observations.push({
      kind,
      url: `${url.pathname}${url.search}`,
      precision: url.searchParams.get("precision"),
      modes: url.searchParams.get("modes"),
      payloadBytes: body.byteLength,
      ...profileGeoJson(payload),
    });
  };

  page.on("response", (response) => {
    const task = capture(response)
      .catch((error) => {
        errors.push(String(error));
      })
      .finally(() => {
        pending.delete(task);
      });
    pending.add(task);
  });

  return {
    errors,
    observations,
    async flush() {
      await Promise.allSettled([...pending]);
    },
  };
}

async function waitForInteractivePayload(tracker) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await tracker.flush();
    if (
      tracker.observations.some(
        (entry) => entry.kind === "lines" && entry.precision === "interactive",
      )
    ) {
      return;
    }
    await sleep(50);
  }
  throw new Error("Astrocartography interactive geometry payload did not arrive.");
}

async function readMapSnapshot(mapFrame) {
  return mapFrame.evaluate(() => ({
    camera: window.ACG?.getState?.() ?? null,
    perf: window.ACG?.getPerfState?.() ?? null,
  }));
}

function cameraChanged(before, after) {
  const beforeCenter = before?.center ?? {};
  const afterCenter = after?.center ?? {};
  return (
    Math.abs((before?.zoom ?? 0) - (after?.zoom ?? 0)) > 0.00001
    || Math.abs((beforeCenter.lng ?? 0) - (afterCenter.lng ?? 0)) > 0.00001
    || Math.abs((beforeCenter.lat ?? 0) - (afterCenter.lat ?? 0)) > 0.00001
    || Math.abs((before?.bearing ?? 0) - (after?.bearing ?? 0)) > 0.00001
    || Math.abs((before?.pitch ?? 0) - (after?.pitch ?? 0)) > 0.00001
  );
}

async function waitForMapQuiet(mapFrame, baseline, quietMs = 350) {
  const deadline = Date.now() + timeoutMs;
  let changed = false;
  let latest = await readMapSnapshot(mapFrame);
  let lastRenderCount = latest.perf?.renderFrames ?? 0;
  let quietSince = Date.now();

  while (Date.now() < deadline) {
    await sleep(25);
    latest = await readMapSnapshot(mapFrame);
    const renderCount = latest.perf?.renderFrames ?? 0;
    if (renderCount !== lastRenderCount) {
      lastRenderCount = renderCount;
      quietSince = Date.now();
    }
    changed ||= (
      renderCount > (baseline.perf?.renderFrames ?? 0)
      && cameraChanged(baseline.camera, latest.camera)
    );
    if (changed && Date.now() - quietSince >= quietMs) {
      return { changed, snapshot: latest };
    }
  }
  return { changed, snapshot: latest };
}

async function waitForRenderSilence(mapFrame, quietMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await readMapSnapshot(mapFrame);
  let renderCount = snapshot.perf?.renderFrames ?? 0;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(25);
    snapshot = await readMapSnapshot(mapFrame);
    const nextRenderCount = snapshot.perf?.renderFrames ?? 0;
    if (nextRenderCount !== renderCount) {
      renderCount = nextRenderCount;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return snapshot;
    }
  }
  throw new Error("Astrocartography map never reached an idle render state.");
}

async function normalizeMapCamera(mapFrame) {
  await mapFrame.evaluate(() => {
    const acg = window.ACG;
    if (!acg) throw new Error("Astrocartography API is missing.");
    const state = acg.getState?.() ?? {};
    acg.applyState?.({
      ...state,
      projection: "globe",
      center: { lng: 0, lat: 0 },
      zoom: 2,
      bearing: 0,
      pitch: 0,
    });
  });
  await waitForRenderSilence(mapFrame);
}

async function performDrag(page, mapFrame, index) {
  const canvas = mapFrame.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Astrocartography canvas has no screen bounds.");
  const direction = index % 2 === 0 ? 1 : -1;
  const centerX = box.x + box.width * 0.5;
  const centerY = box.y + box.height * 0.52;
  const startX = centerX - direction * Math.min(70, box.width * 0.08);
  const endX = centerX + direction * Math.min(70, box.width * 0.08);
  await page.mouse.move(startX, centerY);
  await page.mouse.down();
  await page.mouse.move(endX, centerY + direction * 12, { steps: 12 });
  await page.mouse.up();
}

async function performZoom(page, mapFrame, index) {
  const canvas = mapFrame.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Astrocartography canvas has no screen bounds.");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.52);
  await page.mouse.wheel(0, index % 2 === 0 ? -360 : 360);
}

function diffCounter(before, after, key) {
  return Math.max(0, (after?.[key] ?? 0) - (before?.[key] ?? 0));
}

function domMeasuredTime(before, after) {
  const beforeTotal = (before?.domLabelAvgMs ?? 0) * (before?.domLabelRebuilds ?? 0);
  const afterTotal = (after?.domLabelAvgMs ?? 0) * (after?.domLabelRebuilds ?? 0);
  return Math.max(0, afterTotal - beforeTotal);
}

async function runInteractionSample(page, mapFrame, kind, index, measured) {
  const before = await readMapSnapshot(mapFrame);
  if (measured) {
    await mapFrame.evaluate(() => window.__ARIES_ASTROCART_MAP_PROBE__?.start());
  }
  const startedAt = performance.now();
  if (kind === "drag") {
    await performDrag(page, mapFrame, index);
  } else {
    await performZoom(page, mapFrame, index);
  }
  const quiet = await waitForMapQuiet(mapFrame, before);
  await sleep(50);
  const probe = measured
    ? await mapFrame.evaluate(() => window.__ARIES_ASTROCART_MAP_PROBE__?.stop())
    : { rafGapsMs: [], longTasks: [] };
  const after = quiet.snapshot;
  const domRebuildCount = diffCounter(before.perf, after.perf, "domLabelRebuilds");
  const domTimeMs = domMeasuredTime(before.perf, after.perf);
  return {
    kind,
    index,
    cameraChanged: quiet.changed,
    elapsedMs: rounded(performance.now() - startedAt),
    rafGapsMs: probe?.rafGapsMs ?? [],
    longTaskDurationsMs: (probe?.longTasks ?? []).map((entry) => entry.durationMs),
    mapLibreRenderCount: diffCounter(before.perf, after.perf, "renderFrames"),
    polarDrawCount: diffCounter(before.perf, after.perf, "polarOverlayDraws"),
    polarLastMs: rounded(after.perf?.polarOverlayLastMs ?? 0),
    domLabelRebuildCount: domRebuildCount,
    domLabelTimeMs: rounded(domTimeMs),
    domLabelAverageMs: rounded(domRebuildCount ? domTimeMs / domRebuildCount : 0),
    domLabelLastMs: rounded(after.perf?.domLabelLastMs ?? 0),
  };
}

async function warmUp(page, mapFrame) {
  for (const kind of ["drag", "zoom"]) {
    for (let index = 0; index < warmupsPerInteraction; index += 1) {
      const sample = await runInteractionSample(page, mapFrame, kind, index, false);
      if (!sample.cameraChanged || sample.mapLibreRenderCount === 0) {
        throw new Error(`Astrocartography ${kind} warm-up did not move and render.`);
      }
    }
  }
}

async function measureInteractions(page, mapFrame) {
  const samples = [];
  for (const kind of ["drag", "zoom"]) {
    for (let index = 0; index < samplesPerInteraction; index += 1) {
      samples.push(await runInteractionSample(page, mapFrame, kind, index, true));
    }
  }
  return samples;
}

function summarizeInteractionSamples(samples) {
  const rafGaps = samples.flatMap((sample) => sample.rafGapsMs);
  const longTasks = samples.flatMap((sample) => sample.longTaskDurationsMs);
  return {
    samples: samples.length,
    elapsedMs: summarize(samples.map((sample) => sample.elapsedMs)),
    rafGapMs: summarize(rafGaps),
    longTasks: {
      count: longTasks.length,
      totalDurationMs: rounded(longTasks.reduce((sum, value) => sum + value, 0)),
      durationMs: summarize(longTasks),
    },
    mapLibreRenderCount: {
      total: samples.reduce((sum, sample) => sum + sample.mapLibreRenderCount, 0),
      perSample: summarize(samples.map((sample) => sample.mapLibreRenderCount)),
    },
    polarOverlay: {
      drawCount: samples.reduce((sum, sample) => sum + sample.polarDrawCount, 0),
      drawsPerSample: summarize(samples.map((sample) => sample.polarDrawCount)),
      lastDrawMs: summarize(samples.map((sample) => sample.polarLastMs)),
    },
    domLabels: {
      rebuildCount: samples.reduce((sum, sample) => sum + sample.domLabelRebuildCount, 0),
      measuredTotalMs: rounded(samples.reduce((sum, sample) => sum + sample.domLabelTimeMs, 0)),
      rebuildsPerSample: summarize(samples.map((sample) => sample.domLabelRebuildCount)),
      averageRebuildMs: summarize(samples.map((sample) => sample.domLabelAverageMs)),
      lastRebuildMs: summarize(samples.map((sample) => sample.domLabelLastMs)),
    },
  };
}

function latestPayload(observations, kind, precision = null) {
  return observations
    .filter(
      (entry) => entry.kind === kind && (precision == null || entry.precision === precision),
    )
    .at(-1) ?? null;
}

function linePayloadsByTier(observations) {
  const tiers = {};
  for (const entry of observations.filter((observation) => observation.kind === "lines")) {
    const tier = entry.precision ?? "unspecified";
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(entry);
  }
  return tiers;
}

async function measureIdle(mapFrame) {
  const before = await waitForRenderSilence(mapFrame);
  await sleep(idleObservationMs);
  const after = await readMapSnapshot(mapFrame);
  return {
    observationMs: idleObservationMs,
    mapLibreRenderCount: diffCounter(before.perf, after.perf, "renderFrames"),
    polarDrawCount: diffCounter(before.perf, after.perf, "polarOverlayDraws"),
    domLabelRebuildCount: diffCounter(before.perf, after.perf, "domLabelRebuilds"),
  };
}

function structuralFailures({
  baselinePerf,
  externalRequests,
  idle,
  payloadTracker,
  visibleLines,
  samples,
}) {
  const failures = [];
  const dragSamples = samples.filter((sample) => sample.kind === "drag");
  const zoomSamples = samples.filter((sample) => sample.kind === "zoom");
  if (baselinePerf?.enabled !== true) failures.push("map performance instrumentation is disabled");
  if (baselinePerf?.forceLocalTiles !== true) failures.push("offline/local basemap mode is disabled");
  if ((baselinePerf?.lineFeatureCount ?? 0) <= 0) failures.push("no line features reached the map");
  if (!visibleLines) failures.push("no interactive line payload was observed");
  if (visibleLines && visibleLines.featureCount <= 0) {
    failures.push("interactive payload has no features");
  }
  if (visibleLines && visibleLines.vertexCount <= 0) {
    failures.push("interactive payload has no vertices");
  }
  if (visibleLines && visibleLines.payloadBytes <= 0) {
    failures.push("interactive payload has no bytes");
  }
  if (
    payloadTracker.observations.some(
      (entry) => entry.kind === "lines" && entry.precision === "precise",
    )
  ) {
    failures.push("ordinary retained-map opening requested print-only precise geometry");
  }
  if (dragSamples.length < 10) failures.push(`only ${dragSamples.length} measured drag samples`);
  if (zoomSamples.length < 10) failures.push(`only ${zoomSamples.length} measured zoom samples`);
  for (const sample of samples) {
    if (!sample.cameraChanged) failures.push(`${sample.kind} sample ${sample.index} did not move`);
    if (sample.mapLibreRenderCount <= 0) {
      failures.push(`${sample.kind} sample ${sample.index} produced no MapLibre render`);
    }
    if (sample.rafGapsMs.length === 0) {
      failures.push(`${sample.kind} sample ${sample.index} produced no rAF samples`);
    }
  }
  if (idle.mapLibreRenderCount !== 0) {
    failures.push(`idle map rendered ${idle.mapLibreRenderCount} frames`);
  }
  if (externalRequests.length > 0) {
    failures.push(`${externalRequests.length} external network requests were attempted`);
  }
  if (payloadTracker.errors.length > 0) {
    failures.push(`${payloadTracker.errors.length} payload observations failed`);
  }
  return failures;
}

function discoverDaemonToken() {
  if (process.env.ARIES_DAEMON_TOKEN) return process.env.ARIES_DAEMON_TOKEN;
  try {
    const pids = execFileSync(
      "lsof",
      [`-tiTCP:${daemonPort}`, "-sTCP:LISTEN"],
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
    await sleep(50);
  }
  child.kill("SIGTERM");
  throw new Error(`Isolated Aries performance daemon did not start on port ${daemonPort}.`);
}

const isolatedDaemon = useNativeDaemon ? null : await startIsolatedDaemon();
const daemonToken = isolatedDaemon?.daemonToken ?? discoverDaemonToken();
let browser = null;
let context = null;

try {
  browser = await chromium.launch({
    headless,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor,
  });
  const externalRequests = [];
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:")
      && requestUrl.hostname !== "127.0.0.1"
      && requestUrl.hostname !== "localhost"
    ) {
      externalRequests.push({
        method: route.request().method(),
        resourceType: route.request().resourceType(),
        url: route.request().url(),
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.addInitScript(markAstrocartPerfScript, {
    daemonBaseUrl: daemonUrl,
    daemonToken,
  });

  const page = await context.newPage();
  const payloadTracker = createPayloadTracker(page);
  const docId = await openChart(page, context);
  const { documentId, mapFrame } = await openAstrocartSurface(page, docId);
  await waitForInteractivePayload(payloadTracker);
  await normalizeMapCamera(mapFrame);
  await warmUp(page, mapFrame);
  const baseline = await readMapSnapshot(mapFrame);
  const samples = await measureInteractions(page, mapFrame);
  const finalSnapshot = await readMapSnapshot(mapFrame);
  const idle = await measureIdle(mapFrame);
  await payloadTracker.flush();

  const visibleLines = latestPayload(payloadTracker.observations, "lines", "interactive");
  const lineTiers = linePayloadsByTier(payloadTracker.observations);
  const asterisms = latestPayload(payloadTracker.observations, "asterisms");
  const allMetrics = summarizeInteractionSamples(samples);
  const dragMetrics = summarizeInteractionSamples(
    samples.filter((sample) => sample.kind === "drag"),
  );
  const zoomMetrics = summarizeInteractionSamples(
    samples.filter((sample) => sample.kind === "zoom"),
  );
  allMetrics.polarOverlay.maxAtMeasurementStartMs = rounded(
    baseline.perf?.polarOverlayMaxMs ?? 0,
  );
  allMetrics.polarOverlay.maxAtMeasurementEndMs = rounded(
    finalSnapshot.perf?.polarOverlayMaxMs ?? 0,
  );
  allMetrics.domLabels.maxAtMeasurementStartMs = rounded(
    baseline.perf?.domLabelMaxMs ?? 0,
  );
  allMetrics.domLabels.maxAtMeasurementEndMs = rounded(
    finalSnapshot.perf?.domLabelMaxMs ?? 0,
  );

  const failures = structuralFailures({
    baselinePerf: baseline.perf,
    externalRequests,
    idle,
    payloadTracker,
    visibleLines,
    samples,
  });
  const report = {
    schema: "aries.astrocart-map-perf",
    schemaVersion: 2,
    recordedAt: new Date().toISOString(),
    source: {
      commit: gitValue(["rev-parse", "HEAD"]),
      dirty: gitValue(["status", "--porcelain"], "") !== "",
    },
    environment: {
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      browser: await browser.version(),
      headless,
      deviceScaleFactor,
      frontendUrl,
      daemonMode: useNativeDaemon ? "native" : "isolated",
    },
    documentId,
    workload: {
      projection: baseline.camera?.projection ?? null,
      warmupsPerInteraction,
      measuredSamplesPerInteraction: samplesPerInteraction,
      idleObservationMs,
      basemap: {
        forceLocalTiles: baseline.perf?.forceLocalTiles ?? null,
        hasLocalTiles: baseline.perf?.hasLocalTiles ?? null,
        tileSource: baseline.perf?.tileSource ?? null,
      },
    },
    data: {
      mapLineFeatureCount: baseline.perf?.lineFeatureCount ?? null,
      polarOverlayPathCount: baseline.perf?.polarOverlayPathCount ?? null,
      visibleLines,
      lineTiers,
      asterisms,
      payloads: payloadTracker.observations,
    },
    metrics: {
      all: allMetrics,
      drag: dragMetrics,
      zoom: zoomMetrics,
      idle,
    },
    network: {
      externalRequests,
    },
    structural: {
      passed: failures.length === 0,
      failures,
    },
  };

  mkdirSync(perfDir, { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(report)}\n`);
  console.log(
    `Astrocart active map: ${samples.length} measured samples `
    + `(${samplesPerInteraction} drag, ${samplesPerInteraction} zoom)`,
  );
  console.log(
    `rAF gaps p50/p95/max: ${allMetrics.rafGapMs.p50}/`
    + `${allMetrics.rafGapMs.p95}/${allMetrics.rafGapMs.max} ms`,
  );
  console.log(
    `long tasks: ${allMetrics.longTasks.count}; MapLibre renders: `
    + `${allMetrics.mapLibreRenderCount.total}; idle renders: ${idle.mapLibreRenderCount}`,
  );
  console.log(
    `polar max: ${allMetrics.polarOverlay.maxAtMeasurementEndMs} ms; `
    + `DOM label measured total: ${allMetrics.domLabels.measuredTotalMs} ms`,
  );
  console.log(
    `visible payload: ${visibleLines?.featureCount ?? 0} features, `
    + `${visibleLines?.vertexCount ?? 0} vertices, ${visibleLines?.payloadBytes ?? 0} bytes`,
  );
  console.log(`speedlog: ${outputPath}`);

  if (failures.length > 0) {
    throw new Error(`Astrocartography structural performance check failed: ${failures.join("; ")}`);
  }
} catch (error) {
  if (String(error).includes("ERR_CONNECTION_REFUSED")) {
    console.error("Aries frontend is not running. Start it with `make run`, then retry.");
  }
  throw error;
} finally {
  await context?.close();
  await browser?.close();
  isolatedDaemon?.child.kill("SIGTERM");
}
