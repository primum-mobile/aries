// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// GeographicLib's browser UMD export targets window; the worker has self.
self.window = self;
const revision = new URLSearchParams(self.location.search).get('revision') || '';
importScripts(...['vendor/geographiclib-geodesic.js', 'curve-geometry.js'].map(
  path => path + '?revision=' + encodeURIComponent(revision)));
self.onmessage = ({ data }) => {
  try {
    const started = performance.now();
    const geometries = data.features.map(feature =>
      feature.properties?.curve ? AriesCurveGeometry.tessellate(feature, data.view).geometry : null);
    self.postMessage({ geometries, elapsedMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
