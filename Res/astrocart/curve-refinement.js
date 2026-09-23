// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAriesCurveRefinement = factory;
})(typeof window === 'undefined' ? globalThis : window, function (options) {
  'use strict';
  const { createWorker, publish, report = console.warn } = options;
  let source = null, meshes = null, worker = null, generation = 0, requested = null;
  const cache = new Map();
  function cancel() {
    generation++;
    if (worker) worker.terminate();
    worker = null;
    requested = null;
  }
  function request(data, view) {
    if (source !== data) {
      cancel(); source = data; meshes = null; cache.clear();
    }
    if (!data.features?.some(feature => feature.properties?.curve)) return;
    const key = JSON.stringify(view);
    if (requested === key) return;
    cancel(); requested = key;
    const revision = generation;
    const install = (result) => {
      if (revision !== generation || source !== data) return;
      meshes = result;
      publish();
    };
    if (cache.has(key)) { install(cache.get(key)); return; }
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
        cache.set(key, result.geometries);
        while (cache.size > 3) cache.delete(cache.keys().next().value);
        install(result.geometries);
      };
      // Retain source properties on the main thread. Style changes must never
      // be overwritten by an older worker result or cached viewport geometry.
      worker.postMessage({ view, features: data.features.map(feature => ({
        properties: { curve: feature.properties?.curve }, geometry: feature.geometry,
      })) });
    } catch (error) { cancel(); report('Astrocart curve refinement failed', error.message); }
  }
  function getData(data) {
    if (data !== source || !meshes) return data;
    return { ...data, features: data.features.map((feature, index) =>
      meshes[index] ? { ...feature, geometry: meshes[index] } : feature) };
  }
  return { request, cancel, getData };
});
