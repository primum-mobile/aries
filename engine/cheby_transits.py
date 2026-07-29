# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Chebyshev fast path for mundane-weather (planet-pair) aspect search.

The existing transit_fast Cython kernel handles slow-pair queries efficiently
but doesn't support the Moon or lunar nodes — those fall through to a pure-Python
1-hour-step loop in `searchbackend._search_mundane_weather_specs_legacy`. That
loop costs ~2s per Moon-pair query over a 20-year window.

This module replaces that path: fit one Chebyshev polynomial per body in segments
spanning the search window, then for each (prom, sig, offset) spec evaluate the
unwrapped longitude difference `prom(jd) - sig(jd) - offset` densely, find
sign-change crossings (modulo 360°), and bisect the cheby evaluator to refine.

Body fits are shared across all specs in a query, so a Moon-Sun + Moon-Mars +
Moon-Saturn query pays the Moon-fit cost once.
"""

import bisect
import math

import numpy as np

import astrology
import util

# Reuse the body-sampling and segment infrastructure from cheby_progressions.
from engine.cheby_progressions import (
	_Segment,
	_unwrap_longitude,
	_sample_planet_longitudes,
	_sample_node_longitudes,
	_planet_context,
	_CADENCE,
	_SEGMENT_DAYS,
	_SEGMENT_DEGREE,
	_DENSE_POINTS_PER_DEGREE,
	_DENSE_POINTS_FLOOR,
	KIND_PLANET_FAST,
	KIND_PLANET_SLOW,
	KIND_NODE,
	KIND_CHIRON,
	_PLANET_KIND_BY_INDEX,
)


_TRANSIT_CADENCE = dict(_CADENCE)
_TRANSIT_SEGMENT_DAYS = dict(_SEGMENT_DAYS)
_TRANSIT_SEGMENT_DEGREE = dict(_SEGMENT_DEGREE)

# The progression fit parameters are intentionally broad because secondary
# symbolic spans are smooth. Real true-node transits are not: the node can
# reverse inside a few days, and broad low-degree segments smooth away repeated
# Chiron/node contacts.
_TRANSIT_CADENCE[KIND_NODE] = 4.0
_TRANSIT_SEGMENT_DAYS[KIND_NODE] = 20.0
_TRANSIT_SEGMENT_DEGREE[KIND_NODE] = 14

_TRANSIT_CADENCE[KIND_CHIRON] = 1.0
_TRANSIT_SEGMENT_DAYS[KIND_CHIRON] = 50.0
_TRANSIT_SEGMENT_DEGREE[KIND_CHIRON] = 10


def _kind_for_body(body_id, planet_index):
	if body_id in ('planet:asc_node', 'planet:desc_node'):
		return KIND_NODE
	if body_id == 'planet:chiron' or planet_index == astrology.SE_CHIRON:
		return KIND_CHIRON
	if planet_index == astrology.SE_MOON:
		return KIND_PLANET_FAST
	return _PLANET_KIND_BY_INDEX.get(planet_index, KIND_PLANET_SLOW)


def _transit_fit_params(kind, options):
	if kind == KIND_NODE and getattr(options, 'meannode', True):
		return _CADENCE[kind], _SEGMENT_DAYS[kind], _SEGMENT_DEGREE[kind]
	return _TRANSIT_CADENCE[kind], _TRANSIT_SEGMENT_DAYS[kind], _TRANSIT_SEGMENT_DEGREE[kind]


def _transit_segment_breakpoints(span_start, span_end, max_segment_days):
	span = float(span_end) - float(span_start)
	if span <= 0.0:
		return [(span_start, span_end)]
	count = max(1, int(math.ceil(span / float(max_segment_days))))
	step = span / count
	out = []
	for i in range(count):
		seg_lo = span_start + step * i
		seg_hi = span_start + step * (i + 1) if i + 1 < count else span_end
		out.append((seg_lo, seg_hi))
	return out


def _fit_transit_segments(samples, values, span_start, span_end, max_segment_days, degree):
	segments = []
	degree = int(degree)
	for seg_lo, seg_hi in _transit_segment_breakpoints(span_start, span_end, max_segment_days):
		mask = (samples >= seg_lo - 1e-9) & (samples <= seg_hi + 1e-9)
		seg_jds = samples[mask]
		seg_vals = values[mask]
		deg = degree if len(seg_jds) >= degree + 2 else max(1, len(seg_jds) - 1)
		cheb = np.polynomial.chebyshev.Chebyshev.fit(seg_jds, seg_vals, deg, domain=[seg_lo, seg_hi])
		cheb_deriv = cheb.deriv()
		dense_n = max(_DENSE_POINTS_FLOOR, deg * _DENSE_POINTS_PER_DEGREE)
		dense_jds = np.linspace(seg_lo, seg_hi, dense_n)
		dense_lons = cheb(dense_jds)
		segments.append(_Segment(
			seg_lo, seg_hi, cheb,
			float(np.min(dense_lons)), float(np.max(dense_lons)),
			dense_jds, dense_lons, cheb_deriv,
		))
	return segments


class TransitFit(object):
	"""Per-body cheby-segment fits over a real-JD span [jd_start, jd_end]."""

	def __init__(self, chrt, options, jd_start, jd_end):
		self.chrt = chrt
		self.options = options
		self.jd_start = float(jd_start)
		self.jd_end = float(jd_end)
		self.ephemeris_context = _planet_context(chrt)
		self.flags = self.ephemeris_context.flags
		self._segments = {}     # body_id -> list[_Segment] in JD domain
		self._kinds = {}
		# Cached per-segment evaluator state for fast scalar/vector lookup.
		self._segment_boundaries = {}       # body_id -> np.ndarray (vector path)
		self._segment_boundaries_list = {}  # body_id -> Python list (scalar path; bisect.bisect_left)
		# Pre-extracted Chebyshev coefficients per segment so chebval can take coefs
		# directly instead of going through Chebyshev.__call__'s array machinery.
		self._segment_coefs = {}            # body_id -> list of np.ndarray

	def fit(self, body_id, planet_index):
		if body_id in self._segments:
			return
		kind = _kind_for_body(body_id, planet_index)
		cadence, max_segment_days, degree = _transit_fit_params(kind, self.options)
		span = max(self.jd_end - self.jd_start, 1e-3)
		min_total = max(8, int(math.ceil(span * cadence)) + 4)
		jds = np.linspace(self.jd_start, self.jd_end, min_total)

		if body_id == 'planet:asc_node' or body_id == 'planet:desc_node':
			descending = (body_id == 'planet:desc_node')
			lons = _sample_node_longitudes(
				jds,
				self.chrt,
				self.flags,
				descending=descending,
				context=self.ephemeris_context,
			)
		elif body_id == 'planet:chiron' or planet_index == astrology.SE_CHIRON:
			lons = _sample_planet_longitudes(
				jds,
				astrology.SE_CHIRON,
				self.flags,
				context=self.ephemeris_context,
			)
		elif planet_index is not None:
			lons = _sample_planet_longitudes(
				jds,
				int(planet_index),
				self.flags,
				context=self.ephemeris_context,
			)
		else:
			raise ValueError('cannot fit body without planet_index: %r' % (body_id,))

		unwrapped = _unwrap_longitude(lons)
		segments = _fit_transit_segments(jds, unwrapped, self.jd_start, self.jd_end, max_segment_days, degree)
		self._segments[body_id] = segments
		self._kinds[body_id] = kind
		# Pre-compute segment-boundary array for fast lookup
		if len(segments) > 1:
			boundaries = [s.age_hi for s in segments[:-1]]
			self._segment_boundaries[body_id] = np.array(boundaries)
			self._segment_boundaries_list[body_id] = boundaries
		else:
			self._segment_boundaries[body_id] = np.array([])
			self._segment_boundaries_list[body_id] = []
		# `Chebyshev.__call__` rebuilds machinery per call; pre-extract the raw
		# coefficient + domain-mapping for each segment so the scalar path can
		# skip straight to a Clenshaw evaluation.
		coefs = []
		for seg in segments:
			c = seg.cheb
			coefs.append((np.asarray(c.coef, dtype=np.float64), float(c.domain[0]), float(c.domain[1])))
		self._segment_coefs[body_id] = coefs

	def has(self, body_id):
		return body_id in self._segments

	def evaluate_unwrapped(self, body_id, jds):
		"""Vectorized evaluation of the body's unwrapped longitude polynomial at
		each JD in `jds`. `jds` must be a numpy array (or scalar)."""
		segments = self._segments.get(body_id)
		if not segments:
			raise KeyError('body not fitted: %r' % (body_id,))
		jds_arr = np.atleast_1d(np.asarray(jds, dtype=np.float64))
		boundaries = self._segment_boundaries[body_id]
		if boundaries.size == 0:
			return segments[0].cheb(jds_arr)
		seg_indices = np.searchsorted(boundaries, jds_arr, side='left')
		seg_indices = np.clip(seg_indices, 0, len(segments) - 1)
		out = np.empty_like(jds_arr)
		for i in range(len(segments)):
			mask = seg_indices == i
			if mask.any():
				out[mask] = segments[i].cheb(jds_arr[mask])
		return out

	def _evaluate_scalar(self, body_id, jd):
		"""Single-JD evaluator that skips numpy's array machinery. Called inside
		the bisection inner loop, so per-call overhead matters."""
		coefs_list = self._segment_coefs[body_id]
		boundaries = self._segment_boundaries_list[body_id]
		jd_f = float(jd)
		if not boundaries:
			idx = 0
		else:
			idx = bisect.bisect_left(boundaries, jd_f)
			if idx >= len(coefs_list):
				idx = len(coefs_list) - 1
		coef, dom_lo, dom_hi = coefs_list[idx]
		# Map jd to [-1, 1] for the Chebyshev domain, then Clenshaw recurrence.
		half_span = 0.5 * (dom_hi - dom_lo)
		if half_span == 0.0:
			return float(coef[0])
		x = (jd_f - 0.5 * (dom_hi + dom_lo)) / half_span
		# Clenshaw recurrence for Chebyshev T_n at x.
		c = coef
		n = len(c)
		if n == 1:
			return float(c[0])
		if n == 2:
			return float(c[0] + c[1] * x)
		x2 = 2.0 * x
		c0 = c[-2]
		c1 = c[-1]
		for i in range(3, n + 1):
			tmp = c0
			c0 = c[-i] - c1
			c1 = tmp + c1 * x2
		return float(c0 + c1 * x)

	def longitude(self, body_id, jd):
		return float(util.normalize(self._evaluate_scalar(body_id, jd)))

	def find_relative_aspect_hits(self, prom_id, sig_id, offset_deg):
		"""Return JDs in [jd_start, jd_end] where (prom_lon − sig_lon − offset)
		crosses zero modulo 360°.

		Both polynomials are unwrapped (cumulative), so the difference is also
		smooth and unwrapped. We sample it densely, then for each integer winding
		number k that the difference range covers, find sign changes of
		(diff − 360k) and bisect each to refine.
		"""
		if prom_id not in self._segments:
			raise KeyError('promittor not fitted: %r' % (prom_id,))
		if sig_id not in self._segments:
			raise KeyError('significator not fitted: %r' % (sig_id,))

		# Cadence: 0.05 ephem-day if either body is fast (Moon), else 0.5.
		# Moon moves ~13°/day so 0.05 day = 0.65° per step — enough to never miss
		# a crossing without polynomial-second-derivative ambiguity.
		fast = (self._kinds[prom_id] == KIND_PLANET_FAST or self._kinds[sig_id] == KIND_PLANET_FAST)
		cadence = 0.05 if fast else 0.5
		span = self.jd_end - self.jd_start
		if span <= 0.0:
			return []
		n = max(int(math.ceil(span / cadence)) + 1, 32)
		jds = np.linspace(self.jd_start, self.jd_end, n)

		prom_lons = self.evaluate_unwrapped(prom_id, jds)
		sig_lons = self.evaluate_unwrapped(sig_id, jds)
		diff = prom_lons - sig_lons - float(offset_deg)

		diff_min = float(np.min(diff))
		diff_max = float(np.max(diff))
		# Winding numbers k such that 360k lies inside [diff_min - 360, diff_max + 360].
		# We pad by one period to catch crossings near boundaries.
		k_min = int(math.floor(diff_min / 360.0)) - 1
		k_max = int(math.ceil(diff_max / 360.0)) + 1

		hits = []
		offset_f = float(offset_deg)
		for k in range(k_min, k_max + 1):
			target = 360.0 * k
			residuals = diff - target
			sign_change = (residuals[:-1] * residuals[1:]) < 0.0
			zero_at = residuals[:-1] == 0.0
			candidate = np.where(sign_change | zero_at)[0]
			for idx in candidate:
				if zero_at[idx]:
					hits.append(float(jds[idx]))
					continue
				# Bisect on residual_at(jd) = prom(jd) − sig(jd) − offset − target.
				# Use the scalar fast path — array overhead would dominate per-iter cost.
				lo = float(jds[idx])
				hi = float(jds[idx + 1])
				lo_r = float(residuals[idx])
				# 18 iters → 2^-18 of bracket = ~5 seconds for a 0.1-day bracket.
				# Polynomial fit residual is sub-arcsec, so finer than that is wasted.
				for _ in range(18):
					mid = 0.5 * (lo + hi)
					mid_r = self._evaluate_scalar(prom_id, mid) - self._evaluate_scalar(sig_id, mid) - offset_f - target
					if math.fabs(mid_r) < 1e-9:
						lo = hi = mid
						break
					if (lo_r * mid_r) < 0.0:
						hi = mid
					else:
						lo, lo_r = mid, mid_r
				hits.append(0.5 * (lo + hi))

		# Sort + dedupe coincident roots (a winding number ±1 from another can
		# yield the same JD because of the over-padded k range).
		hits.sort()
		deduped = []
		for h in hits:
			if h < self.jd_start - 1e-9 or h > self.jd_end + 1e-9:
				continue
			if deduped and math.fabs(h - deduped[-1]) < 1e-6:
				continue
			deduped.append(float(h))
		return deduped
