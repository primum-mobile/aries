// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const gateSource = await readFile(
  new URL("../src/stores/workspace-command-snapshot-gate.ts", import.meta.url),
  "utf8",
);
const gateJavascript = ts.transpileModule(gateSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const gate = await import(
  `data:text/javascript;base64,${Buffer.from(gateJavascript).toString("base64")}`
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("same-document projection mutations preserve intent order and publish only the latest", async () => {
  const first = deferred();
  const second = deferred();
  const starts = [];

  const firstRun = gate.runWorkspaceDocumentSnapshotCommand("harmonic-1", async () => {
    starts.push("harmonic");
    return first.promise;
  });
  const secondRun = gate.runWorkspaceDocumentSnapshotCommand("harmonic-1", async () => {
    starts.push("varga");
    return second.promise;
  });

  await nextTask();
  assert.deepEqual(starts, ["harmonic"]);
  assert.equal(gate.workspaceDocumentSnapshotCommandGeneration("harmonic-1"), 2);

  first.resolve({ projectionMode: "harmonic" });
  const firstResult = await firstRun;
  assert.equal(firstResult.isLatest, false);
  await nextTask();
  assert.deepEqual(starts, ["harmonic", "varga"]);

  let barrierSettled = false;
  const barrier = gate.waitForWorkspaceDocumentSnapshotCommands("harmonic-1")
    .then(() => {
      barrierSettled = true;
    });
  await nextTask();
  assert.equal(barrierSettled, false);

  second.resolve({ projectionMode: "varga" });
  const secondResult = await secondRun;
  await barrier;
  assert.equal(secondResult.isLatest, true);
  assert.equal(secondResult.result.projectionMode, "varga");
  assert.equal(barrierSettled, true);
});

test("projection mutations on different documents do not block each other", async () => {
  const first = deferred();
  const second = deferred();
  const starts = [];

  const firstRun = gate.runWorkspaceDocumentSnapshotCommand("harmonic-a", async () => {
    starts.push("a");
    return first.promise;
  });
  const secondRun = gate.runWorkspaceDocumentSnapshotCommand("harmonic-b", async () => {
    starts.push("b");
    return second.promise;
  });

  await nextTask();
  assert.deepEqual(starts.sort(), ["a", "b"]);
  first.resolve("a");
  second.resolve("b");
  const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
  assert.equal(firstResult.isLatest, true);
  assert.equal(secondResult.isLatest, true);
});

test("harmonic stepping waits on the document command barrier and rejects obsolete paints", async () => {
  const homeClient = await readFile(
    new URL("../src/components/workshell/home-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    homeClient,
    /hasPendingWorkspaceDocumentSnapshotCommand\(targetDocId\)[\s\S]*waitForWorkspaceDocumentSnapshotCommands\(targetDocId\)\.then\(startNavigationRequest\)/,
  );
  assert.match(
    homeClient,
    /const startNavigationRequest = \(\) => \{[\s\S]*workspaceNavigateKey\(targetDocId/,
  );
  assert.match(
    homeClient,
    /documentCommandGenerationAtRequest\s*!==\s*workspaceDocumentSnapshotCommandGeneration\(targetDocId\)/,
  );
});
