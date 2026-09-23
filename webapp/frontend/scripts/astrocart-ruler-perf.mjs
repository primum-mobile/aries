// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// CPU-only ruler budget; native interaction/paint remains covered by the app gate.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(import.meta.url);
const geometry = require('../../../Res/astrocart/ruler-geometry.js');
const fixture = [{ geometry: { type: 'LineString', coordinates:
  Array.from({ length: 721 }, (_, i) => [10 + Math.sin(i / 90) * 25, -90 + i / 4]),
} }];
const prepareStart = performance.now();
const segments = geometry.prepare(fixture);
const prepareMs = performance.now() - prepareStart;
const samples = [];
for (let i = 0; i < 140; i++) {
  const target = [12 + i / 200, 48 + i / 200];
  const start = performance.now();
  const result = geometry.nearest(segments, target);
  geometry.connector(result.coordinate, target);
  geometry.formatDistance(result.meters, 'metric', 'en');
  if (i >= 40) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const report = {
  mode: 'ruler-cpu', node: process.version, platform: `${os.platform()}-${os.arch()}`,
  segments: segments.length, fixtureBytes: Buffer.byteLength(JSON.stringify(fixture)),
  requestsPerMove: 0, warmups: 40, samples: samples.length, prepareMs,
  p50: samples[49], p95: samples[94], max: samples.at(-1), p95BudgetMs: 5,
};
console.log(JSON.stringify(report, null, 2));
assert.ok(report.p95 < report.p95BudgetMs, `ruler CPU p95 ${report.p95} ms exceeds 5 ms`);
