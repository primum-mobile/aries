// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// A live step payload must win over a Speculum fetch that was already in
// flight: the older fetch is aborted, its late answer is ignored, and the
// replacement fetch waits for the burst completion edge before it starts.
// Exercises the real InspectorSpeculum request/live effects; only external
// stores, services and table rendering are replaced.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import esbuild from "esbuild";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inspector = readFileSync(path.join(frontend, "src/components/workshell/inspector-panel.tsx"), "utf8");
const start = inspector.indexOf("function InspectorSpeculum({");
const end = inspector.indexOf("  // Re-arm the fit", start);
// The real visibility hook the component calls; it lives in the same module.
const visibilityStart = inspector.indexOf("export function useSpeculumVisibility(");
const visibilityEnd = inspector.indexOf("\n}\n", visibilityStart);

async function withInspector(run) {
  assert.ok(start >= 0 && end > start, "InspectorSpeculum extraction anchors moved");
  assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart, "useSpeculumVisibility extraction anchors moved");
  const visibilityHook = inspector.slice(visibilityStart, visibilityEnd + 2).replace("export function", "function");
  const component = `${inspector.slice(start, end)}
  return <div id="value">{payloadState?.payload?.value ?? "empty"}</div>;
}`;
  const source = `
import * as React from "react";
import { createRoot } from "react-dom/client";
import { useFreshLivePayload, liveSurfaceResult, LIVE_SURFACE_PRIORITY } from ${JSON.stringify(path.join(frontend, "src/lib/live-surfaces.ts"))};
import { useStepBurst, beginStepBurst, endStepBurst } from ${JSON.stringify(path.join(frontend, "src/lib/chart/step-burst.ts"))};
window.beginBurst = beginStepBurst;
window.endBurst = endStepBurst;
const useT = () => () => "";
const getCachedGenericTablePayload = () => null;
const useSettledWorkspaceRefreshSeq = () => 0;
const useLiveSurfaceRequest = () => {};
const inspectorSpeculumRefreshSeqByDocument = new Map();
const rememberGenericTablePayload = () => {};
const isAbortError = (_error, signal) => signal.aborted;
window.requests = [];
window.rowBuilds = 0;
const inspectorSpeculumRows = () => { window.rowBuilds += 1; return []; };
const fetchGenericTablePayload = (_table, _document, signal) => new Promise((resolve) => {
  window.requests.push({ resolve, signal });
});
${visibilityHook}
${component}
function Harness() {
  const [chart, setChart] = React.useState({ primaryChart: { planets: [{ seId: 0 }], options: {} } });
  React.useEffect(() => {
    window.publish = (payload) => setChart((chart) => ({ ...chart, liveSurfaces: { "speculum:doc": { status: "ok", payload, ms: 0 } } }));
    window.changeWheel = (ids = [0], extra = {}) => setChart((chart) => ({ ...chart, primaryChart: { ...chart.primaryChart, ...extra, planets: ids.map((seId) => ({ seId, lon: Math.random() })) } }));
  }, []);
  return <InspectorSpeculum chart={chart} visible documentId="doc" parentDocumentId={null} lastSessionChange={null} lastOptionsChange={null} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
`;
  const built = await esbuild.build({
    stdin: { contents: source, loader: "tsx", resolveDir: frontend },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    await page.waitForFunction(() => window.requests.length === 1 && window.publish);
    await run(page);
  } finally {
    await browser.close();
  }
}

test("live step supersedes an in-flight Speculum fetch when idle", async () => {
  await withInspector(async (page) => {
    await page.evaluate(() => window.publish({ value: "live step" }));
    await page.waitForFunction(() => document.getElementById("value").textContent === "live step");
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.evaluate(() => window.requests[0].signal.aborted), true);
    await page.evaluate(() => window.requests[0].resolve({ value: "older fetch" }));
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#value").textContent(), "live step");
    await page.evaluate(() => window.requests[1].resolve({ value: "restarted fetch" }));
    await page.waitForFunction(() => document.getElementById("value").textContent === "restarted fetch");
  });
});

for (const live of [true, false]) {
  test(`Speculum full refresh waits for burst completion (live=${live})`, async () => {
    await withInspector(async (page) => {
      await page.evaluate(() => window.beginBurst());
      // Simulate a slow outstanding request and multiple valid step intervals.
      for (let step = 1; step <= 3; step += 1) {
        if (live) {
          await page.evaluate((value) => window.publish({ value }), `step ${step}`);
          await page.waitForFunction((value) => document.getElementById("value").textContent === value, `step ${step}`);
        }
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => window.requests.length), 1, "no full table fetch inside a burst");
      }
      assert.equal(await page.evaluate(() => window.requests[0].signal.aborted), true);
      await page.evaluate(() => window.requests[0].resolve({ value: "obsolete fetch" }));
      await page.waitForTimeout(50);
      assert.equal(await page.locator("#value").textContent(), live ? "step 3" : "empty");
      await page.evaluate(() => window.endBurst());
      await page.waitForFunction(() => window.requests.length === 2);
      await page.evaluate(() => window.requests[1].resolve({ value: "settled" }));
      await page.waitForFunction(() => document.getElementById("value").textContent === "settled");
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.requests.length), 2, "one completion refresh");
    });
  });
}

test("wheel-only updates retain Speculum rows while data and visibility refresh them", async () => {
  await withInspector(async (page) => {
    await page.evaluate(() => window.requests[0].resolve({ value: "initial rows" }));
    await page.waitForFunction(() => document.getElementById("value").textContent === "initial rows");
    const initial = await page.evaluate(() => window.rowBuilds);
    await page.evaluate(() => window.changeWheel());
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.rowBuilds), initial);
    await page.evaluate(() => window.changeWheel([0, 1]));
    await page.waitForFunction((count) => window.rowBuilds > count, initial);
    const visible = await page.evaluate(() => window.rowBuilds);
    await page.evaluate(() => window.changeWheel([0, 1], { fortune: { lon: 30 } }));
    await page.waitForFunction((count) => window.rowBuilds > count, visible);
    const fortune = await page.evaluate(() => window.rowBuilds);
    await page.evaluate(() => window.publish({ value: "new live rows" }));
    await page.waitForFunction(() => document.getElementById("value").textContent === "new live rows");
    assert.ok(await page.evaluate(() => window.rowBuilds) > fortune);
  });
});
