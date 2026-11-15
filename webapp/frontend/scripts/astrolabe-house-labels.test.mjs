// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/chart/astrolabe-house-labels.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { astrolabeHouseLabelAnchor: anchor } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("all twelve Alcabitius radials carry their number at 80% of the plate", () => {
  for (let house = 0; house < 12; house++) {
    const angle = house * Math.PI / 6;
    const point = anchor([[{ x: 0, y: 0 }, { x: 1.5 * Math.cos(angle), y: 1.5 * Math.sin(angle) }]], 1.5);
    near(point.x, 1.2 * Math.cos(angle));
    near(point.y, 1.2 * Math.sin(angle));
  }
});

test("curved boundaries are labeled on the actual supplied segment", () => {
  const point = anchor([[{ x: 0.2, y: 0.1 }, { x: 0.5, y: 0.2 }, { x: 1, y: 0.6 }]], 1);
  near(Math.hypot(point.x, point.y), 0.8);
  near((point.y - 0.2) * 0.5, (point.x - 0.5) * 0.4);
});

test("disjoint branches never create a label on an imaginary joining line", () => {
  const point = anchor([
    [{ x: 0, y: 0 }, { x: 0.2, y: 0 }],
    [{ x: 1, y: 0 }, { x: 1.2, y: 0 }],
  ], 1);
  assert.deepEqual(point, { x: 1, y: 0 });
});

test("short, repeated, and empty paths stay bounded", () => {
  assert.deepEqual(anchor([[{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 }]], 1), { x: 0.5, y: 0 });
  assert.equal(anchor([], 1), null);
  assert.equal(anchor([[]], 1), null);
  assert.equal(anchor([[{ x: 1, y: 1 }]], 0), null);
});
