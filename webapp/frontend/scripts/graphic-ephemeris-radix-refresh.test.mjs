// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris radix rings stay current without an unrelated repaint
// (a theme switch used to be the only thing that refreshed them): a failed
// crossing year is asked for again on its own, a year computed for another
// radix point set is refused and reported, and the radix lines key on the
// parent radix's revision as well as the options payload key.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents:
      "export { EphemerisRadixStore, EphemerisContactStore } from './src/lib/chart/ephemeris-radix';" +
      "export { EphemerisBlockStore } from './src/lib/chart/ephemeris-block-store';",
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  alias: { "@": "./src" },
});
const { EphemerisRadixStore, EphemerisContactStore, EphemerisBlockStore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

const f64 = (values) => Buffer.from(new Float64Array(values).buffer).toString("base64");
const crossingYear = (radixKey, year = 2026) => ({
  dataKey: "d", radixKey, year, points: ["sun"], jd: f64([2461050]), planet: [5], point: [0], aspect: [90],
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The plate's one loader, with no curve traffic and a short retry. */
const loaderOf = () =>
  new EphemerisBlockStore(
    { fetchBlocks: () => new Promise(() => {}), fetchStationYear: () => new Promise(() => {}) },
    { retryMinMs: 5 },
  );
const quietErrors = async (body) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await body();
  } finally {
    console.error = original;
  }
};

test("a failed crossing year wakes the plate and loads on the retry, without another repaint", async () => {
  await quietErrors(async () => {
    let calls = 0;
    const store = new EphemerisRadixStore(loaderOf(), "radix:doc", async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Load failed");
      return crossingYear("radix-a");
    });
    let wakes = 0;
    // The view's listener is requestFrame; the frame asks for its years again.
    store.subscribe(() => {
      wakes += 1;
      store.want([2026]);
    });
    store.setRadix("radix-a", "data-1");
    await store.ready([2026]);
    assert.equal(store.rows([2026]).length, 0);
    // Asked again before the backoff ends: no request storm.
    store.want([2026]);
    assert.equal(calls, 1);
    await wait(40);
    assert.equal(calls, 2);
    assert.ok(wakes >= 2, "the retry timer and the loaded year both wake the plate");
    assert.equal(store.rows([2026]).length, 1);
  });
});

test("a new radix or data key drops the old key's retries", async () => {
  await quietErrors(async () => {
    let calls = 0;
    const store = new EphemerisContactStore(loaderOf(), "contacts", async () => {
      calls += 1;
      throw new TypeError("Load failed");
    });
    store.setKey("data-1");
    await store.ready([2026]);
    assert.equal(calls, 1);
    store.setKey("data-2");
    await wait(30);
    assert.equal(calls, 1, "nothing asks for the old key's year again");
  });
});

test("crossings computed for another radix point set are refused and reported", async () => {
  let served = "radix-b";
  const store = new EphemerisRadixStore(loaderOf(), "radix:doc", async () => crossingYear(served));
  const stale = [];
  store.onStaleRadix((key) => stale.push(key));
  store.setRadix("radix-a", "data-1");
  await store.ready([2026]);
  assert.deepEqual(stale, ["radix-b"]);
  assert.equal(store.rows([2026]).length, 0, "no rings from another radix");
  // The view refetches the lines and keys the store on what the daemon serves.
  store.setRadix("radix-b", "data-1");
  await store.ready([2026]);
  assert.equal(store.rows([2026]).length, 1);
  served = "radix-b";
  assert.deepEqual(stale, ["radix-b"]);
});

test("the view keys the radix lines on the parent radix revision and retries a failed fetch", async () => {
  const view = await readFile(new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url), "utf8");
  assert.match(view, /return useRadixListRevision\(\[documentId, parentDocumentId\]\);/);
  assert.match(view, /const radixPointsRevision = `\$\{ephemerisDataKey\}\|\$\{radixRevision\}\|\$\{radixPointsNonce\}`;/);
  assert.match(view, /if \(cached && cached\.revision === radixPointsRevision\) return;/);
  assert.match(view, /retry = setTimeout\(\s*\(\) => setRadixPointsNonce\(\(n\) => n \+ 1\)/);
  assert.match(view, /radixStore\.onStaleRadix\(\(served\) => \{/);
  assert.match(view, /radixStore\.setRadix\(radixKey, metaDataKey\);/);
  // Rings are a year layer of the block store: the frame declares them with
  // its range, and arrivals repaint through the store's one subscription.
  assert.match(view, /layers: shownYearLayers\(currentScene\),/);
  assert.match(view, /new EphemerisRadixStore\(ephemerisStore, `radix:\$\{documentId\}`/);
});
