// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/geographiclib-geodesic.js'));
  } else root.AriesCurveGeometry = factory(root.geodesic);
})(typeof self === 'undefined' ? globalThis : self, function (library) {
  'use strict';
  const earth = library.Geodesic.WGS84;
  const rad = Math.PI / 180;
  const normalize = (x) => ((x + 180) % 360 + 360) % 360 - 180;
  const near = (x, reference) => reference + normalize(x - reference);
  const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-89.999999, Math.min(89.999999, lat)) * rad / 2));
  const inverseY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / rad;
  const distance = (a, b) => earth.Inverse(a[1], a[0], b[1], b[0]).s12;

  function model(feature) {
    const curve = feature.properties?.curve;
    if (!curve || !Array.isArray(curve.domain) || !curve.domain.every(Number.isFinite) || curve.domain[0] >= curve.domain[1]) return null;
    if (curve.type === 'geodesic' && curve.origin?.every(Number.isFinite) && Number.isFinite(curve.bearing)) {
      const line = earth.Line(curve.origin[1], curve.origin[0], curve.bearing);
      return { domain: curve.domain, step: 200000, geodesic: true, at(t) {
        const p = line.Position(t); return [p.lon2, p.lat2];
      } };
    }
    if (curve.type !== 'horizon' || ![curve.ra, curve.dec, curve.rotation, curve.sign].every(Number.isFinite)) return null;
    const tanDec = Math.abs(curve.dec) < 1e-9 ? 0 : Math.tan(curve.dec * rad);
    const cosEps = curve.obliquity == null ? null : Math.cos(curve.obliquity * rad);
    return { domain: curve.domain, step: 2, at(lat) {
      const h = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * rad) * tanDec)));
      let lon = curve.ra * rad + curve.sign * h;
      if (cosEps !== null) lon = Math.atan2(Math.sin(lon) / cosEps, Math.cos(lon));
      return [normalize(lon / rad + curve.rotation), lat];
    } };
  }

  function intervals(curve) {
    const [low, high] = curve.domain;
    const count = Math.max(1, Math.ceil((high - low) / curve.step));
    return Array.from({ length: count }, (_, i) => [low + (high - low) * i / count, low + (high - low) * (i + 1) / count]);
  }

  // An upper bound on length for monotonic longitude/latitude curve pieces.
  // 6.4 Mm exceeds both WGS84 principal curvature radii. Used only for pruning.
  function lengthBound(a, b, wrapped = true) {
    return 6400000 * rad * (Math.abs(b[1] - a[1]) + Math.abs((wrapped ? near(b[0], a[0]) : b[0]) - a[0]));
  }

  function mercatorSegment(a, b) {
    const lon = b[0], ya = mercatorY(a[1]), yb = mercatorY(b[1]);
    return (t) => [normalize(a[0] + (lon - a[0]) * t), inverseY(ya + (yb - ya) * t)];
  }

  function pointSegmentDistance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }

  function tessellate(feature, view) {
    const curve = model(feature);
    if (!curve) return feature;
    const bounds = view.bounds; // unwrapped [west, south, east, north], with margin
    const center = (bounds[0] + bounds[2]) / 2;
    const scale = 512 * 2 ** view.zoom;
    const tolerance = 0.25 / scale;
    const project = (p, reference) => [near(p[0], reference) / 360, mercatorY(p[1]) / (2 * Math.PI)];
    const vertices = [];
    let probes = 0;
    function walk(lo, hi, a, b, depth) {
      const ts = [lo + (hi - lo) / 3, (lo + hi) / 2, hi - (hi - lo) / 3];
      const ps = ts.map(curve.at);
      probes += 3;
      const points = [a, ...ps, b];
      const reference = near(a[0], center);
      const lons = points.map(p => near(p[0], reference));
      const lats = points.map(p => p[1]);
      // A geodesic can turn between probes. Enclose it conservatively so a
      // tiny viewport at its latitude extremum cannot be falsely culled.
      const latPad = curve.geodesic ? (hi - lo) / 110000 : 0;
      const maxLat = Math.max(...lats.map(Math.abs)) + latPad;
      const lonPad = !latPad ? 0 : maxLat >= 89.9 ? 180 : latPad / Math.cos(maxLat * rad);
      const visible = Math.max(...lons) + lonPad >= bounds[0] && Math.min(...lons) - lonPad <= bounds[2] &&
        Math.max(...lats) + latPad >= bounds[1] && Math.min(...lats) - latPad <= bounds[3];
      const pa = project(a, reference), pb = project(b, reference);
      const error = Math.max(...ps.map(p => pointSegmentDistance(project(p, reference), pa, pb)));
      // A conservative ground bound from Mercator distance (scale >= 1), with
      // margin for WGS84 versus spherical Mercator. No low-latitude loophole.
      const allowed = view.zoom >= 15 ? Math.min(tolerance, 0.5 / 40300000) : tolerance;
      if (visible && error > allowed) {
        if (depth >= 40 || probes >= 200000) throw new Error("Curve subdivision budget exceeded");
        walk(lo, ts[1], a, ps[1], depth + 1);
        walk(ts[1], hi, ps[1], b, depth + 1);
      } else {
        vertices.push({ t: lo, p: a });
      }
    }
    for (const [lo, hi] of intervals(curve)) walk(lo, hi, curve.at(lo), curve.at(hi), 0);
    vertices.push({ t: curve.domain[1], p: curve.at(curve.domain[1]) });
    const paths = [[]];
    for (let i = 0; i < vertices.length; i++) {
      const { t, p } = vertices[i];
      if (i && Math.abs(p[0] - vertices[i - 1].p[0]) > 180) {
        const previous = vertices[i - 1];
        const end = near(p[0], previous.p[0]);
        const boundary = end > 180 ? 180 : -180;
        let lo = previous.t, hi = t;
        for (let j = 0; j < 48; j++) {
          const mid = (lo + hi) / 2;
          const lon = near(curve.at(mid)[0], previous.p[0]);
          if ((end > previous.p[0]) === (lon < boundary)) lo = mid; else hi = mid;
        }
        const lat = curve.at((lo + hi) / 2)[1];
        paths.at(-1).push([boundary, lat]);
        paths.push([[-boundary, lat]]);
      }
      paths.at(-1).push(p);
    }
    return { ...feature, geometry: { type: 'MultiLineString', coordinates: paths.filter(p => p.length > 1) } };
  }

  return { model, intervals, lengthBound, mercatorSegment, mercatorY, inverseY, near, normalize, distance, tessellate };
});
