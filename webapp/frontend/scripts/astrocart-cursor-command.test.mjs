// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const frontendRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, frontendRoot), "utf8");
}

async function cursorCommandHarness(result, reject = false) {
  const home = await source("src/components/workshell/home-client.tsx");
  const gate = await source("src/stores/workspace-command-snapshot-gate.ts");
  const gateContext = {};
  vm.runInNewContext(ts.transpileModule(
    `${gate.replaceAll("export ", "")}
     globalThis.runCommand = runWorkspaceDocumentSnapshotCommand;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText, gateContext);
  const executeStart = home.indexOf("const applyCursorCommandResult = useCallback(");
  const executeEnd = home.indexOf("const handleSpotlightCommit = useCallback(", executeStart);
  const inputStart = home.indexOf("const setAstrocartCursorMoment = useCallback(");
  const inputEnd = home.indexOf("useAmbientSpotlightTriggers(", inputStart);
  assert.ok(executeStart >= 0 && executeEnd > executeStart);
  assert.ok(inputStart >= 0 && inputEnd > inputStart);
  const calls = [];
  const context = {
    useCallback: (callback) => callback,
    beginWorkspaceSnapshotCommand: () => () => calls.push(["finish"]),
    runWorkspaceDocumentSnapshotCommand: gateContext.runCommand,
    spotlightExecute: async (...args) => {
      calls.push(["execute", ...args]);
      if (reject) throw new Error("invalid date");
      return result;
    },
    applyImmediateWorkspaceCommandResult: () => calls.push(["commit"]),
    astrocartLayerDocumentIdsRef: { current: new Set(["moving-layer"]) },
    activeDocRef: { current: { id: "moving-layer" } },
    workspaceAstrocartLayerNow: async (documentId) => {
      calls.push(["now", documentId]);
      if (reject) throw new Error("clock unavailable");
      return result;
    },
    window: { dispatchEvent: (event) => calls.push([event.type, event.detail]) },
    CustomEvent: class {
      constructor(type, { detail }) { this.type = type; this.detail = detail; }
    },
    console: { error() {} },
  };
  const compiled = ts.transpileModule(
    `${home.slice(executeStart, executeEnd)}
     ${home.slice(inputStart, inputEnd)}
     globalThis.setMoment = setAstrocartCursorMoment;
     globalThis.setNow = setAstrocartCursorNow;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(compiled, context);
  return { setMoment: context.setMoment, setNow: context.setNow, calls };
}

test("map date, calendar and time commits publish moving geometry after daemon acceptance", async () => {
  for (const moment of ["2031-06-02", "14:23:45"]) {
    const harness = await cursorCommandHarness({ documentId: "moving-layer", stepped: true });
    assert.equal(await harness.setMoment(moment), true);
    assert.deepEqual(harness.calls.map((call) => call[0]), [
      "execute", "commit", "aries:chart-step-published", "aries:chart-step-settle", "finish",
    ]);
    assert.equal(harness.calls[0][1], moment);
    assert.equal(harness.calls[0][2], "current");
    assert.equal(harness.calls[2][1].documentId, "moving-layer");
    assert.equal(harness.calls[2][1].burstOpen, false);
    assert.equal(harness.calls[3][1].documentId, "moving-layer");
  }
});

test("unrelated and unstepped commands leave retained maps alone", async () => {
  for (const result of [
    { documentId: "wheel", stepped: true },
    { documentId: "moving-layer", stepped: false },
    { documentId: "moving-layer" },
  ]) {
    const harness = await cursorCommandHarness(result);
    assert.equal(await harness.setMoment("2031-06-02"), true);
    assert.deepEqual(harness.calls.map((call) => call[0]), ["execute", "commit", "finish"]);
  }
});

test("rejected date edits do not publish a map cursor", async () => {
  const harness = await cursorCommandHarness(null, true);
  assert.equal(await harness.setMoment("2031-02-31"), false);
  assert.deepEqual(harness.calls.map((call) => call[0]), ["execute", "finish"]);
});

test("Now uses the selected layer and publishes its acknowledged wall-clock cursor", async () => {
  const harness = await cursorCommandHarness({ documentId: "moving-layer", stepped: true });
  assert.equal(await harness.setNow(), true);
  assert.deepEqual(harness.calls.map((call) => call[0]), [
    "now", "commit", "aries:chart-step-published", "aries:chart-step-settle", "finish",
  ]);
  assert.equal(harness.calls[0][1], "moving-layer");
});

test("Now follows an unfinished field edit so the old date cannot overwrite it", async () => {
  let acceptEdit;
  const pending = new Promise((resolve) => { acceptEdit = resolve; });
  const harness = await cursorCommandHarness(pending.then((result) => {
    harness.calls.push(["accepted-edit"]);
    return result;
  }));
  const edited = harness.setMoment("2031-06-02");
  const now = harness.setNow();
  await Promise.resolve();
  assert.equal(harness.calls.some((call) => call[0] === "now"), false);
  acceptEdit({ documentId: "moving-layer", stepped: true });
  assert.equal(await edited, true);
  assert.equal(await now, true);
  const operations = harness.calls.map((call) => call[0]);
  assert.ok(operations.indexOf("accepted-edit") < operations.indexOf("now"));
});
