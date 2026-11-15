// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Graphic Ephemeris pin fade: a pinned natal line fades the others down after
// a short pause and back up on release, eased out, retargeting continuously,
// jumping under reduced motion; hover never feeds it and exports paint the
// settled state.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: [
      "export * from './src/lib/chart/ephemeris-recede-fade';",
      "export { settledRadixRecede } from './src/lib/chart/ephemeris-radix';",
      "export { createEphemerisRenderStyle } from './src/lib/chart/ephemeris-render-style';",
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  alias: { "@": "./src" },
});
const {
  createEphemerisRenderStyle,
  ephemerisRecedeAmount,
  ephemerisRecedeDone,
  ephemerisRecedeFactor,
  retargetEphemerisRecede,
  settledRadixRecede,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const timing = { delayMs: 80, durationMs: 160, reducedMotion: false };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("the fade tokens default to a short pause and a brief fade", () => {
  const radix = createEphemerisRenderStyle().radix;
  assert.equal(radix.radixRecedeDelayMs, 80);
  assert.equal(radix.radixRecedeFadeMs, 160);
});

test("a pin waits the pause, then eases out down to full recede", () => {
  const fade = retargetEphemerisRecede(null, 1, "moon", 1000, timing);
  assert.equal(fade.key, "moon");
  assert.equal(ephemerisRecedeAmount(fade, 1000), 0);
  assert.equal(ephemerisRecedeAmount(fade, 1080), 0);
  const quarter = ephemerisRecedeAmount(fade, 1080 + 40);
  const half = ephemerisRecedeAmount(fade, 1080 + 80);
  near(half, 1 - 0.5 ** 3);
  // Ease out: more than linear progress early, monotonic.
  assert.ok(quarter > 0.25 && half > quarter && half > 0.5);
  assert.equal(ephemerisRecedeDone(fade, 1239), false);
  assert.equal(ephemerisRecedeAmount(fade, 1240), 1);
  assert.equal(ephemerisRecedeDone(fade, 1240), true);
  assert.equal(ephemerisRecedeAmount(fade, 5000), 1);
});

test("the factor spans rest to the recede opacity", () => {
  assert.equal(ephemerisRecedeFactor(0, 0.4), 1);
  near(ephemerisRecedeFactor(1, 0.4), 0.4);
  near(ephemerisRecedeFactor(0.5, 0.4), 0.7);
});

test("release fades back up, keeping the released line spared", () => {
  const down = retargetEphemerisRecede(null, 1, "moon", 0, timing);
  const up = retargetEphemerisRecede(down, 0, null, 1000, timing);
  assert.equal(up.key, "moon");
  assert.equal(up.from, 1);
  assert.equal(ephemerisRecedeAmount(up, 1000 + 80), 1);
  assert.equal(ephemerisRecedeAmount(up, 1000 + 80 + 160), 0);
});

test("a quick click and release inside the pause paints nothing", () => {
  const down = retargetEphemerisRecede(null, 1, "moon", 0, timing);
  const up = retargetEphemerisRecede(down, 0, null, 50, timing);
  for (const t of [50, 60, 100, 200, 400]) assert.equal(ephemerisRecedeAmount(up, t), 0);
  assert.equal(ephemerisRecedeDone(up, 50), true);
});

test("a retarget mid-fade turns continuously, without a second pause", () => {
  const down = retargetEphemerisRecede(null, 1, "moon", 0, timing);
  const at = 80 + 60;
  const mid = ephemerisRecedeAmount(down, at);
  assert.ok(mid > 0 && mid < 1);
  const up = retargetEphemerisRecede(down, 0, null, at, timing);
  near(ephemerisRecedeAmount(up, at), mid);
  assert.equal(up.delayMs, 0);
  near(up.durationMs, 160 * mid);
  assert.ok(ephemerisRecedeAmount(up, at + 10) < mid);
  assert.equal(ephemerisRecedeAmount(up, at + up.durationMs), 0);
});

test("pinning another line keeps the recede and moves the spared line", () => {
  const down = retargetEphemerisRecede(null, 1, "moon", 0, timing);
  const other = retargetEphemerisRecede(down, 1, "sun", 1000, timing);
  assert.equal(other.key, "sun");
  assert.equal(ephemerisRecedeAmount(other, 1000), 1);
  assert.equal(ephemerisRecedeDone(other, 1000), true);
});

test("the same target again leaves a running fade untouched", () => {
  const down = retargetEphemerisRecede(null, 1, "moon", 0, timing);
  assert.equal(retargetEphemerisRecede(down, 1, "moon", 100, timing), down);
});

test("reduced motion jumps straight to the target", () => {
  const reduced = { ...timing, reducedMotion: true };
  const down = retargetEphemerisRecede(null, 1, "moon", 0, reduced);
  assert.equal(ephemerisRecedeAmount(down, 0), 1);
  assert.equal(ephemerisRecedeDone(down, 0), true);
  const up = retargetEphemerisRecede(down, 0, null, 10, reduced);
  assert.equal(ephemerisRecedeAmount(up, 10), 0);
});

test("the settled recede follows the pin: exports and fade-less paints", () => {
  assert.deepEqual(settledRadixRecede({ radixFocusKey: "moon", radixFocusPinned: true }), { amount: 1, key: "moon" });
  assert.deepEqual(settledRadixRecede({ radixFocusKey: "moon", radixFocusPinned: false }), { amount: 0, key: null });
  assert.deepEqual(settledRadixRecede({ radixFocusKey: null }), { amount: 0, key: null });
});

test("the view retargets only on the pin, samples it per plot frame, and exports settle", async () => {
  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /recedeFadeRef\.current = retargetEphemerisRecede\(recedeFadeRef\.current, pinnedRadixKey != null \? 1 : 0, pinnedRadixKey, ephemerisNow\(\)/);
  assert.match(view, /prefers-reduced-motion: reduce/);
  assert.match(view, /\}, \[pinnedRadixKey\]\);/);
  assert.match(view, /if \(fade && !ephemerisRecedeDone\(fade, started\)\) requestFrame\(\);/);
  assert.doesNotMatch(view, /setRecede|useState<EphemerisRecedeFade/);
  // The export paint passes no live fade: it settles from its stripped scene.
  const exportStart = view.indexOf("paintEphemerisPlate(base, top, {");
  const exportCall = view.slice(exportStart, view.indexOf("});", exportStart));
  assert.doesNotMatch(exportCall, /recede/);
  const plate = await read("lib/chart/ephemeris-plate-paint.ts");
  assert.match(plate, /paintEphemerisRadix\(plot, geo, camera, radix, scene, style, recede\);/);
});
