// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/geographiclib-geodesic.js'), require('./curve-geometry.js'));
  } else {
    root.AriesRulerGeometry = factory(root.geodesic, root.AriesCurveGeometry);
  }
})(typeof window === 'undefined' ? globalThis : window, function (library, curves) {
  'use strict';
  const earth = library.Geodesic.WGS84;
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const radians = Math.PI / 180;
  const formatters = new Map();

  function xyz(coordinate) {
    const lat = coordinate[1] * radians;
    const lon = coordinate[0] * radians;
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon),
      n * (1 - e2) * Math.sin(lat)];
  }

  function position(line, distance) {
    const point = line.Position(distance);
    return [point.lon2, point.lat2];
  }

  function distance(left, right) {
    return earth.Inverse(left[1], left[0], right[1], right[0]).s12;
  }

  function paths(geometry) {
    if (geometry?.type === 'LineString') return [geometry.coordinates];
    if (geometry?.type === 'MultiLineString') return geometry.coordinates;
    return [];
  }

  // Index the canonical curve once per selection. ECEF balls supply a cheap,
  // conservative lower bound; only plausible pieces need geodesic minimization.
  function prepare(features) {
    const segments = [], seen = new Set();
    function add(at, low, high, geodesic = false) {
      const middle = (low + high) / 2, p = at(middle);
      const radius = geodesic ? (high - low) / 2 : Math.max(
        curves.lengthBound(at(low), p), curves.lengthBound(p, at(high)));
      segments.push({ at, low, high, center: xyz(p), radius,
        span: geodesic ? (lo, hi) => hi - lo :
          (lo, hi) => curves.lengthBound(at(lo), at(hi)) });
    }
    for (const feature of features) {
      const curve = curves.model(feature);
      if (curve) {
        const key = JSON.stringify(feature.properties.curve);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const [lo, hi] of curves.intervals(curve)) add(curve.at, lo, hi, curve.geodesic);
        continue;
      }
      for (const path of paths(feature.geometry)) {
        for (let i = 1; i < path.length; i++) {
          const start = path[i - 1], end = path[i];
          if (![...start, ...end].every(Number.isFinite)) continue;
          const at = curves.mercatorSegment(start, end);
          const count = Math.max(1, Math.ceil(curves.lengthBound(start, end, false) / 100000));
          for (let j = 0; j < count; j++) add(at, j / count, (j + 1) / count);
        }
      }
    }
    return segments;
  }

  function nearest(segments, target) {
    if (!segments.length) return null;
    const p = xyz(target);
    // A Euclidean chord is a lower bound for surface distance. The geodesic
    // midpoint ball encloses the entire segment, including dateline/polar arcs.
    const candidates = segments.map((segment) => ({ segment, bound: Math.max(0,
      Math.hypot(...p.map((v, i) => v - segment.center[i])) - segment.radius),
    })).sort((left, right) => left.bound - right.bound);
    let best = null;
    const evaluate = (segment, s) => {
      const coordinate = segment.at(s);
      const meters = distance(coordinate, target);
      if (!best || meters < best.meters) best = { coordinate, meters };
      return meters;
    };
    const ratio = (Math.sqrt(5) - 1) / 2;
    for (const { segment, bound } of candidates) {
      if (best && bound > best.meters) break;
      let low = segment.low;
      let high = segment.high;
      evaluate(segment, low);
      evaluate(segment, high);
      let left = high - ratio * (high - low);
      let right = low + ratio * (high - low);
      let dl = evaluate(segment, left);
      let dr = evaluate(segment, right);
      for (let i = 0; i < 80 && segment.span(low, high) > 0.01; i++) {
        if (dl < dr) {
          high = right;
          right = left;
          dr = dl;
          left = high - ratio * (high - low);
          dl = evaluate(segment, left);
        } else {
          low = left;
          left = right;
          dl = dr;
          right = low + ratio * (high - low);
          dr = evaluate(segment, right);
        }
      }
      evaluate(segment, (low + high) / 2);
    }
    return best;
  }

  function connector(start, end) {
    const line = earth.InverseLine(start[1], start[0], end[1], end[0]);
    const count = Math.max(2, Math.min(128, Math.ceil(line.s13 / 100000)));
    return Array.from({ length: count + 1 }, (_, i) => position(line, line.s13 * i / count));
  }

  function formatDistance(meters, units, locale) {
    const imperial = units === 'miles';
    const small = meters < (imperial ? 1609.344 : 1000);
    const unit = imperial ? (small ? 'foot' : 'mile') : (small ? 'meter' : 'kilometer');
    const value = meters / (imperial ? (small ? 0.3048 : 1609.344) : (small ? 1 : 1000));
    const digits = small || value >= 100 ? 0 : 1;
    const key = `${locale || ''}:${unit}:${digits}`;
    if (!formatters.has(key)) {
      formatters.set(key, new Intl.NumberFormat(locale || undefined, { style: 'unit', unit,
        unitDisplay: 'short', maximumFractionDigits: digits }));
    }
    return formatters.get(key).format(value);
  }

  return { prepare, nearest, connector, distance, paths, formatDistance };
});
