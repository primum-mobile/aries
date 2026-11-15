// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAriesCurveRefinement = factory;
})(typeof window === 'undefined' ? globalThis : window, function (options) {
  'use strict';
  const { createWorker, publish, report = console.warn } = options;
  let source = null, meshes = null, worker = null, generation = 0, requested = null;
  let sourceKeys = [];
  const cache = new Map();
  // Payloads cross the iframe boundary as new objects. Only the analytic curve
  // defines its mesh; labels, styles and coarse daemon sampling do not.
  function curveKey(feature) {
    const curve = feature.properties?.curve;
    return curve ? JSON.stringify(Object.keys(curve).sort().map(key => [key, curve[key]])) : null;
  }
  function cancel() {
    generation++;
    if (worker) worker.terminate();
    worker = null;
    requested = null;
  }
  function request(data, view) {
    if (source !== data) retainUnchanged(data);
    if (!sourceKeys.some(Boolean)) return;
    const key = JSON.stringify(view);
    if (requested === key) return;
    cancel(); requested = key;
    const revision = generation;
    const viewMeshes = cache.get(key) || new Map();
    const install = () => {
      if (revision !== generation || source !== data) return;
      const next = sourceKeys.map(curve => viewMeshes.get(curve) || null);
      const changed = next.some((mesh, index) => mesh !== (meshes?.[index] || null));
      meshes = next;
      if (changed) publish();
    };
    const missing = new Map();
    sourceKeys.forEach((curve, index) => {
      if (curve && !viewMeshes.has(curve)) missing.set(curve, data.features[index]);
    });
    if (!missing.size) { install(); return; }
    const missingKeys = [...missing.keys()];
    try {
      worker = createWorker();
      worker.onerror = (error) => {
        if (revision !== generation) return;
        cancel(); report('Astrocart curve refinement failed', error.message);
      };
      worker.onmessage = ({ data: result }) => {
        if (revision !== generation) return;
        worker.terminate(); worker = null;
        if (result.error) { report('Astrocart curve refinement failed', result.error); return; }
        result.geometries.forEach((geometry, index) => viewMeshes.set(missingKeys[index], geometry));
        cache.set(key, viewMeshes);
        while (cache.size > 3) cache.delete(cache.keys().next().value);
        install();
      };
      // Retain source properties on the main thread. Style changes must never
      // be overwritten by an older worker result or cached viewport geometry.
      worker.postMessage({ view, features: [...missing.values()].map(feature => ({
        properties: { curve: feature.properties?.curve }, geometry: feature.geometry,
      })) });
    } catch (error) { cancel(); report('Astrocart curve refinement failed', error.message); }
  }
  function getData(data) {
    if (data !== source || !meshes) return data;
    return { ...data, features: data.features.map((feature, index) =>
      meshes[index] ? { ...feature, geometry: meshes[index] } : feature) };
  }
  function retainUnchanged(data) {
    const meshByCurve = new Map(sourceKeys.map((curve, index) => [curve, meshes?.[index]]));
    cancel();
    source = data;
    sourceKeys = (data.features || []).map(curveKey);
    const retained = sourceKeys.map(curve => meshByCurve.get(curve) || null);
    meshes = retained.some(Boolean) ? retained : null;
    const retainedKeys = new Set(sourceKeys);
    for (const viewMeshes of cache.values()) {
      for (const curve of viewMeshes.keys()) {
        if (!retainedKeys.has(curve)) viewMeshes.delete(curve);
      }
    }
  }
  return { request, cancel, getData, retainUnchanged };
});
