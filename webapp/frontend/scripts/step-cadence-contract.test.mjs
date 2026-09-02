// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createStepCadenceCollector } from "../src/lib/chart/step-cadence.mjs";

function harness() {
  const samples = new Map();
  const collector = createStepCadenceCollector({
    onSample(name, value) {
      const values = samples.get(name) ?? [];
      values.push(value);
      samples.set(name, values);
    },
  });
  return { collector, samples };
}

test("pairs raw input, Canvas completion, and post-render boundaries exactly", () => {
  const { collector, samples } = harness();
  const rows = [
    { inputId: 1, inputAt: 100, canvasAt: 120, frameAt: 133, postAt: 134, frame2At: 149 },
    { inputId: 2, inputAt: 183, canvasAt: 203, frameAt: 216, postAt: 217, frame2At: 232 },
    { inputId: 3, inputAt: 266, canvasAt: 286, frameAt: 299, postAt: 300, frame2At: 315 },
  ];
  for (const row of rows) {
    collector.recordRawInput({ inputId: row.inputId, at: row.inputAt, docId: "doc" });
    collector.recordIntent({ appliedInputs: 1 });
    collector.recordCanvas({
      inputIds: [row.inputId],
      appliedInputs: 1,
      at: row.canvasAt,
      docId: "doc",
    });
    collector.recordBoundary({
      inputIds: [row.inputId],
      appliedInputs: 1,
      canvasAt: row.canvasAt,
      nextFrameAt: row.frameAt,
      postRenderAt: row.postAt,
      secondFrameAt: row.frame2At,
      nextFrameTimestamp: row.frameAt - 3,
      secondFrameTimestamp: row.frame2At - 3,
      postRenderOrder: 2,
      secondFrameOrder: 3,
      docId: "doc",
    });
  }

  assert.deepEqual(samples.get("time-step.input-gap"), [83, 83]);
  assert.deepEqual(samples.get("time-step.paint-gap"), [83, 83]);
  assert.deepEqual(samples.get("time-step.paint-gap-over-input"), [0, 0]);
  assert.deepEqual(samples.get("time-step.canvas-to-next-frame"), [13, 13, 13]);
  assert.deepEqual(samples.get("time-step.intent-to-next-frame"), [33, 33, 33]);
  assert.deepEqual(samples.get("time-step.raf-to-post-render-task"), [1, 1, 1]);
  assert.deepEqual(samples.get("time-step.canvas-to-post-render-task"), [14, 14, 14]);
  assert.deepEqual(samples.get("time-step.intent-to-post-render-task"), [34, 34, 34]);
  assert.deepEqual(samples.get("time-step.next-frame-interval"), [16, 16, 16]);
  assert.deepEqual(samples.get("time-step.next-raf-opportunity-gap"), [83, 83]);
  assert.deepEqual(samples.get("time-step.post-render-task-gap"), [83, 83]);
  assert.deepEqual(samples.get("time-step.post-render-gap-over-input"), [0, 0]);
  assert.deepEqual(samples.get("time-step.post-render-gap-delta"), [0, 0]);
  assert.deepEqual(collector.snapshot().counters, {
    rawInputs: 3,
    intentRecords: 3,
    appliedInputs: 3,
    stepPaints: 3,
    completedBoundaryProbes: 3,
    nextRafCallbacks: 3,
    postRenderTasks: 3,
    secondRafCallbacks: 3,
    uniqueNextRafOpportunities: 3,
    rafCollisionGroups: 0,
    rafCollisionExcess: 0,
    maxCanvasesPerNextRaf: 1,
    latePostRenderTasks: 0,
    maxAppliedInputsPerPaint: 1,
    sessionChangeTails: 0,
    sessionChangeTailsDuringBurst: 0,
    sessionChangeTailsAfterCanvas: 0,
    sessionChangeTailsBeforeCanvas: 0,
    sessionChangeTailsUnmatched: 0,
    settleStarts: 0,
    settleStartsDuringBurst: 0,
    boundaryTimeouts: 0,
    inputsWithoutBoundary: 0,
    longTasks: 0,
    unresolvedInputs: 0,
  });
});

test("missing and collapsed presentations stay visible in cardinality counters", () => {
  const missing = harness().collector;
  for (const [inputId, at] of [[1, 100], [2, 183], [3, 266]]) {
    missing.recordRawInput({ inputId, at, docId: "doc" });
  }
  for (const [inputId, at] of [[1, 120], [3, 286]]) {
    missing.recordCanvas({ inputIds: [inputId], appliedInputs: 1, at, docId: "doc" });
    missing.recordBoundary({
      inputIds: [inputId],
      appliedInputs: 1,
      canvasAt: at,
      nextFrameAt: at + 13,
      postRenderAt: at + 14,
      secondFrameAt: at + 29,
      nextFrameTimestamp: at + 10,
      secondFrameTimestamp: at + 26,
      postRenderOrder: 2,
      secondFrameOrder: 3,
      docId: "doc",
    });
  }
  assert.equal(missing.snapshot().counters.rawInputs, 3);
  assert.equal(missing.snapshot().counters.stepPaints, 2);
  assert.equal(missing.snapshot().counters.postRenderTasks, 2);
  assert.equal(missing.snapshot().counters.unresolvedInputs, 1);

  const collapsed = harness().collector;
  for (const [inputId, at] of [[1, 100], [2, 108], [3, 116]]) {
    collapsed.recordRawInput({ inputId, at, docId: "doc" });
  }
  collapsed.recordIntent({ appliedInputs: 3 });
  collapsed.recordCanvas({
    inputIds: [1, 2, 3],
    appliedInputs: 3,
    at: 140,
    docId: "doc",
  });
  collapsed.recordBoundary({
    inputIds: [1, 2, 3],
    appliedInputs: 3,
    canvasAt: 140,
    nextFrameAt: 149,
    postRenderAt: 150,
    secondFrameAt: 166,
    nextFrameTimestamp: 146,
    secondFrameTimestamp: 162,
    postRenderOrder: 2,
    secondFrameOrder: 3,
    docId: "doc",
  });
  const collapsedCounters = collapsed.snapshot().counters;
  assert.equal(collapsedCounters.rawInputs, 3);
  assert.equal(collapsedCounters.appliedInputs, 3);
  assert.equal(collapsedCounters.stepPaints, 1);
  assert.equal(collapsedCounters.postRenderTasks, 1);
  assert.equal(collapsedCounters.maxAppliedInputsPerPaint, 3);
  assert.equal(collapsedCounters.unresolvedInputs, 0);
});

test("unsupported optional observers are explicit and failed inputs drain", () => {
  const { collector } = harness();
  collector.recordRawInput({ inputId: 1, at: 100, docId: "doc" });
  collector.resolveInputsWithoutBoundary([1]);
  const snapshot = collector.snapshot();
  assert.equal(snapshot.capabilities.longTask, false);
  assert.equal(snapshot.counters.longTasks, 0);
  assert.equal(snapshot.counters.inputsWithoutBoundary, 1);
  assert.equal(snapshot.counters.unresolvedInputs, 0);
  assert.deepEqual(snapshot.outcomes, { unknown: 1 });
});

test("separate physical bursts do not measure the idle pause as cadence", () => {
  const { collector, samples } = harness();
  const record = (inputId, inputAt) => {
    collector.recordRawInput({ inputId, at: inputAt, docId: "doc" });
    collector.recordCanvas({ inputIds: [inputId], at: inputAt + 20, docId: "doc" });
    collector.recordBoundary({
      inputIds: [inputId],
      canvasAt: inputAt + 20,
      nextFrameAt: inputAt + 30,
      postRenderAt: inputAt + 31,
      secondFrameAt: inputAt + 47,
      nextFrameTimestamp: inputAt + 27,
      secondFrameTimestamp: inputAt + 44,
      postRenderOrder: 2,
      secondFrameOrder: 3,
      docId: "doc",
    });
  };
  collector.beginBurst();
  record(1, 100);
  collector.beginBurst();
  record(2, 5_100);

  assert.equal(samples.has("time-step.input-gap"), false);
  assert.equal(samples.has("time-step.paint-gap"), false);
  assert.equal(samples.has("time-step.post-render-task-gap"), false);
  assert.equal(samples.has("time-step.next-raf-opportunity-gap"), false);
});

test("timeouts and late post-render tasks stay explicit", () => {
  const timedOut = harness().collector;
  timedOut.recordRawInput({ inputId: 1, at: 100, docId: "doc" });
  timedOut.recordIntent({ appliedInputs: 3 });
  timedOut.recordBoundaryTimeout([1]);
  const timeoutSnapshot = timedOut.snapshot();
  assert.equal(timeoutSnapshot.counters.boundaryTimeouts, 1);
  assert.equal(timeoutSnapshot.counters.completedBoundaryProbes, 0);
  assert.equal(timeoutSnapshot.counters.inputsWithoutBoundary, 1);
  assert.equal(timeoutSnapshot.counters.maxAppliedInputsPerPaint, 0);
  assert.deepEqual(timeoutSnapshot.outcomes, { "boundary-timeout": 1 });

  const { collector, samples } = harness();
  collector.recordRawInput({ inputId: 2, at: 200, docId: "doc" });
  collector.recordCanvas({ inputIds: [2], at: 220, docId: "doc" });
  collector.recordBoundary({
    inputIds: [2],
    canvasAt: 220,
    nextFrameAt: 230,
    postRenderAt: 248,
    secondFrameAt: 247,
    nextFrameTimestamp: 227,
    secondFrameTimestamp: 244,
    postRenderOrder: 3,
    secondFrameOrder: 2,
    docId: "doc",
  });
  assert.equal(collector.snapshot().counters.latePostRenderTasks, 1);
  assert.equal(samples.has("time-step.canvas-to-post-render-task"), false);
});

test("rAF collisions and session tails are correlated by semantic frame", () => {
  const { collector, samples } = harness();
  for (const [inputId, inputAt, canvasAt, displayDatetime] of [
    [1, 100, 120, "2026-08-12T10:00:00"],
    [2, 183, 203, "2026-08-12T11:00:00"],
  ]) {
    collector.recordRawInput({ inputId, at: inputAt, docId: "doc" });
    collector.recordCanvas({
      inputIds: [inputId],
      at: canvasAt,
      docId: "doc",
      displayDatetime,
    });
    collector.recordBoundary({
      inputIds: [inputId],
      canvasAt,
      nextFrameAt: canvasAt + 10,
      postRenderAt: canvasAt + 11,
      secondFrameAt: canvasAt + 27,
      nextFrameTimestamp: 500,
      secondFrameTimestamp: 517,
      postRenderOrder: 2,
      secondFrameOrder: 3,
      docId: "doc",
    });
  }
  collector.recordSessionChange({
    at: 160,
    docId: "doc",
    displayDatetime: "2026-08-12T10:00:00",
    duringBurst: true,
  });
  collector.recordSessionChange({
    at: 250,
    docId: "doc",
    displayDatetime: "2026-08-12T12:00:00",
  });
  collector.recordCanvas({
    inputIds: [],
    at: 270,
    docId: "doc",
    displayDatetime: "2026-08-12T12:00:00",
  });
  const counters = collector.snapshot().counters;
  assert.equal(counters.uniqueNextRafOpportunities, 1);
  assert.equal(counters.rafCollisionGroups, 1);
  assert.equal(counters.rafCollisionExcess, 1);
  assert.equal(counters.maxCanvasesPerNextRaf, 2);
  assert.equal(counters.sessionChangeTailsAfterCanvas, 1);
  assert.equal(counters.sessionChangeTailsBeforeCanvas, 1);
  assert.deepEqual(samples.get("time-step.session-change-after-canvas"), [40]);
  assert.deepEqual(samples.get("time-step.session-change-before-canvas"), [20]);
});

test("native wiring defers summary I/O and preserves IDs through the boundary", async () => {
  const [perf, home, workspace] = await Promise.all([
    readFile(new URL("../src/lib/chart/perf.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/workshell/home-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/stores/daemon-workspace-store.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(perf, /speedlogBurstActive \|\| speedlogBoundaryProbes > 0/);
  assert.match(perf, /window\.requestAnimationFrame\(\(timestamp\) => \{[\s\S]*window\.setTimeout\([\s\S]*window\.requestAnimationFrame\(\(nextTimestamp\)/);
  for (const summaryField of ["minimumMs:", "p05Ms:", "p50Ms:", "p95Ms,"]) {
    assert.ok(perf.includes(summaryField), `missing speedlog summary field ${summaryField}`);
  }
  assert.match(perf, /schemaVersion: 2[\s\S]*counters: cadence\.counters[\s\S]*capabilities: cadence\.capabilities/);
  assert.match(perf, /displayDatetime: stringDetail\(detail, "displayDatetime"\)/);
  assert.match(perf, /name === "chart-canvas-paint-suppressed"/);
  assert.doesNotMatch(perf, /startBurstRafProbe/);
  assert.match(home, /recordChartStepInput\([\s\S]*inputIds: stepInputIds/);
  assert.match(home, /pending\.inputIds\.splice\(0, take\)/);
  assert.match(workspace, /event\.changeReason === "step"[\s\S]*recordChartPerf\("chart-step-session-change"/);
});
