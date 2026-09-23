// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
const require = createRequire(import.meta.url);
const curves = require('../../../Res/astrocart/curve-geometry.js');
const ruler = require('../../../Res/astrocart/ruler-geometry.js');
const features = Array.from({ length: 64 }, (_, i) => ({ properties: { curve: i < 32 ? {
  type: 'horizon', ra: i * 11.25, dec: i % 2 ? 23 : -23, rotation: 10,
  sign: i % 2 ? 1 : -1, domain: [-67, 67],
} : { type: 'geodesic', origin: [13.4, 52.5], bearing: i * 11.25, domain: [0, 20000000] } },
geometry: { type: 'MultiLineString', coordinates: [] } }));
const samples = [], solves = [];
let vertices = 0, outputBytes = 0;
for (let i = 0; i < 30; i++) {
  const start = performance.now();
  const output = features.map(feature => curves.tessellate(feature, {
    zoom: 18, bounds: [13.39, 52.49, 13.41, 52.51],
  }));
  const elapsed = performance.now() - start;
  if (i >= 10) samples.push(elapsed);
  vertices = output.reduce((sum, f) => sum + f.geometry.coordinates.flat().length, 0);
  outputBytes = Buffer.byteLength(JSON.stringify(output));
}
const index = ruler.prepare([features[32]]);
for (let i = 0; i < 140; i++) {
  const start = performance.now();
  ruler.nearest(index, [13.401 + i / 100000, 52.502]);
  if (i >= 40) solves.push(performance.now() - start);
}
samples.sort((a, b) => a - b); solves.sort((a, b) => a - b);
const report = { mode: 'curve-worker-cpu', platform: `${os.platform()}-${os.arch()}`,
  features: features.length, outputVertices: vertices, outputBytes, warmups: 10, samples: 20,
  refinementP95Ms: samples[18], refinementBudgetMs: 150,
  pointerP95Ms: solves[94], pointerBudgetMs: 5, requestsPerPointerMove: 0 };
console.log(JSON.stringify(report, null, 2));
assert.ok(report.refinementP95Ms < report.refinementBudgetMs);
assert.ok(report.pointerP95Ms < report.pointerBudgetMs);
