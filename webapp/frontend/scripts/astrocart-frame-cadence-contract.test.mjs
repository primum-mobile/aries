// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(
  new URL("../../../Res/astrocart/map.html", import.meta.url),
  "utf8",
);
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes("function recordRenderFrame"));

assert.ok(script, "missing bundled Astrocart frame instrumentation");

function sourceBetween(startMarker, endMarker) {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return script.slice(start, end);
}

const frameRecorder = sourceBetween(
  "function recordRenderFrame",
  "function recordDomLabelPerf",
);
const motionCoordinator = sourceBetween(
  "function beginMapMotion",
  "function onAsterismStarMove",
);

function createHarness() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `
      const ACG_PERF_MODE = true;
      let now = 0;
      let perfLastRenderAt = 0;
      const activeMapMotionPhases = new Set();
      const perfState = {
        renderFrames: 0,
        longFrames: 0,
        lastFrameMs: 0,
        maxFrameMs: 0,
        frameSamples: [],
      };
      function perfNow() { return now; }
      function setAsterismHoverEnabled() {}
      ${frameRecorder}
      ${motionCoordinator}
      globalThis.contract = {
        recordRenderFrame,
        beginMapMotion,
        endMapMotion,
        setNow(value) { now = value; },
        perfState,
      };
    `,
    context,
  );
  return context.contract;
}

test("idle on-demand renders never count as slow animation frames", () => {
  const api = createHarness();
  api.setNow(10);
  api.recordRenderFrame();
  api.setNow(5_010);
  api.recordRenderFrame();

  assert.equal(api.perfState.renderFrames, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.perfState.frameSamples)),
    [],
  );
  assert.equal(api.perfState.longFrames, 0);
});

test("frame gaps are sampled only inside the complete overlapping motion burst", () => {
  const api = createHarness();
  api.setNow(100);
  assert.equal(api.beginMapMotion("move"), true);
  assert.equal(api.beginMapMotion("zoom"), false);

  api.setNow(116);
  api.recordRenderFrame();
  assert.equal(api.endMapMotion("move"), false);
  api.setNow(133);
  api.recordRenderFrame();
  assert.equal(api.endMapMotion("zoom"), true);

  api.setNow(10_000);
  api.recordRenderFrame();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.perfState.frameSamples)),
    [16, 17],
  );
  assert.equal(api.perfState.maxFrameMs, 17);
  assert.equal(api.perfState.longFrames, 0);
});
