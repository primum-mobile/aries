# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Chebyshev-fit fast path for secondary-progression aspect hits.

Secondary progressions map 1 ephemeris day to 1 native year, so an N-year
search window only spans N days of real ephemeris. We sample swisseph once
on a sparse grid covering that span, fit one Chebyshev polynomial per body
to the unwrapped longitude, and turn aspect-hit search into closed-form
polynomial root finding via numpy.polynomial.chebyshev.chebroots.

This module owns the fitting, evaluation, and root-finding primitives.
Wiring into the search backend lives in searchbackend.py.
"""

import math
import time

import numpy as np

import astrology
import houses
import planets
import posfordate
import util
from engine import prog_log


# ---------------------------------------------------------------------------
# Body kinds — drive sampling cadence, fit degree, and per-sample function
# ---------------------------------------------------------------------------

KIND_PLANET_FAST = 'planet_fast'   # Moon
KIND_PLANET_SLOW = 'planet_slow'   # Sun, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto
KIND_NODE = 'node'                 # Mean / true lunar nodes (and their symmetric desc node)
KIND_CHIRON = 'chiron'
KIND_ANGLE_ASC = 'angle_asc'
KIND_ANGLE_MC = 'angle_mc'
KIND_LOF = 'lof'
# Mean-quotidian (Q2) Asc/MC: ARMC moves ~360.99°/native-year, so the angle is a
# 360°-periodic function of age. Handled by an inverse-function table, not a
# polynomial fit.
KIND_ANGLE_ASC_QUOTIDIAN = 'angle_asc_quotidian'
KIND_ANGLE_MC_QUOTIDIAN = 'angle_mc_quotidian'
# Lot of Fortune under MEAN_QUOTIDIAN_Q2: composes the fast (quotidian) Asc with
# slow (cheby-fit) Sun and Moon, plus a day/night flag derived from progressed
# Sun RA/decl and progressed ARMC. Has its own composite evaluator + dense-scan
# root finder.
KIND_LOF_QUOTIDIAN = 'lof_quotidian'

# Sampling cadence (samples per ephemeris day). Higher cadence captures faster motion.
_CADENCE = {
	KIND_PLANET_FAST: 4.0,
	KIND_PLANET_SLOW: 1.0,
	KIND_NODE: 0.5,
	KIND_CHIRON: 0.5,
	KIND_ANGLE_ASC: 1.0,
	KIND_ANGLE_MC: 1.0,
	KIND_LOF: 4.0,
}

# Maximum span (in symbolic days) per Chebyshev segment. Longer spans need more
# segments because high-order polynomials over wide domains develop ringing.
# Inner planets (Mercury/Venus) retrograde inside long segments — keep them short.
_SEGMENT_DAYS = {
	KIND_PLANET_FAST: 20.0,
	KIND_PLANET_SLOW: 50.0,
	KIND_NODE: 200.0,
	KIND_CHIRON: 200.0,
	KIND_ANGLE_ASC: 50.0,
	KIND_ANGLE_MC: 50.0,
	KIND_LOF: 20.0,
}

# Polynomial degree per segment. Slightly oversized — Chebyshev cost is small.
_SEGMENT_DEGREE = {
	KIND_PLANET_FAST: 14,
	KIND_PLANET_SLOW: 10,
	KIND_NODE: 6,
	KIND_CHIRON: 8,
	KIND_ANGLE_ASC: 10,
	KIND_ANGLE_MC: 10,
	KIND_LOF: 14,
}

# Body IDs the fast path supports today. Asc/MC/LoF are deliberately excluded
# until we add the angle/state sampler — the search backend falls back to the
# legacy step loop for those.
_PLANET_KIND_BY_INDEX = {
	astrology.SE_SUN: KIND_PLANET_SLOW,
	astrology.SE_MOON: KIND_PLANET_FAST,
	astrology.SE_MERCURY: KIND_PLANET_SLOW,
	astrology.SE_VENUS: KIND_PLANET_SLOW,
	astrology.SE_MARS: KIND_PLANET_SLOW,
	astrology.SE_JUPITER: KIND_PLANET_SLOW,
	astrology.SE_SATURN: KIND_PLANET_SLOW,
	astrology.SE_URANUS: KIND_PLANET_SLOW,
	astrology.SE_NEPTUNE: KIND_PLANET_SLOW,
	astrology.SE_PLUTO: KIND_PLANET_SLOW,
}


def supported_body_id(catalog, options, body_id):
	"""Return True if the cheby fast path can fit this body for SECONDARY method."""
	obj = catalog.get(body_id)
	if obj is None:
		return False
	if body_id == 'planet:asc_node' or body_id == 'planet:desc_node':
		return True
	if body_id == 'planet:chiron':
		return True
	if body_id in ('angle:asc', 'angle:mc'):
		# All five angle methods supported: TRUE_SOLAR_ARC_{LON,RA} / NAIBOD_{LON,RA}
		# go through the cheby fit; MEAN_QUOTIDIAN_Q2 takes the inverse-function
		# table path (see _build_quotidian_angle_table).
		return True
	if body_id == 'point:lof':
		# LoF rides on Asc + slow (Sun, Moon) terms. For the four slow angle
		# methods we fit it as a single polynomial. For MEAN_QUOTIDIAN_Q2 the Asc
		# component cycles per year — handled by a composite evaluator that
		# combines the inverse Asc table with cheby Sun/Moon fits + analytic Sun
		# RA/decl, and root-finds via dense-scan + bisection.
		return True
	if obj.planet_index is None:
		return False
	return obj.planet_index in _PLANET_KIND_BY_INDEX or obj.planet_index in (
		astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE, astrology.SE_CHIRON,
	)


def _body_kind(body_id, planet_index, options=None):
	if body_id in ('planet:asc_node', 'planet:desc_node'):
		return KIND_NODE
	if body_id == 'planet:chiron' or planet_index == astrology.SE_CHIRON:
		return KIND_CHIRON
	angle_method = posfordate.progression_angle_method(
		getattr(options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
	) if options is not None else posfordate.TRUE_SOLAR_ARC_LON
	if body_id == 'angle:asc':
		return KIND_ANGLE_ASC_QUOTIDIAN if angle_method == posfordate.MEAN_QUOTIDIAN_Q2 else KIND_ANGLE_ASC
	if body_id == 'angle:mc':
		return KIND_ANGLE_MC_QUOTIDIAN if angle_method == posfordate.MEAN_QUOTIDIAN_Q2 else KIND_ANGLE_MC
	if body_id == 'point:lof':
		return KIND_LOF_QUOTIDIAN if angle_method == posfordate.MEAN_QUOTIDIAN_Q2 else KIND_LOF
	return _PLANET_KIND_BY_INDEX.get(planet_index, KIND_PLANET_SLOW)


# ---------------------------------------------------------------------------
# Sample collection
# ---------------------------------------------------------------------------


def _planet_flags(radix):
	# Mirror searchbackend._planet_flags but kept local so this module has no
	# import cycle with searchbackend.
	flags = astrology.SEFLG_SPEED + astrology.SEFLG_SWIEPH
	if getattr(radix.options, 'topocentric', False):
		astrology.swe_set_topo(radix.place.lon, radix.place.lat, radix.place.altitude)
		flags += astrology.SEFLG_TOPOCTR
	if getattr(radix.options, 'ayanamsha', 0) != 0:
		astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(radix.options.ayanamsha), 0, 0)
		flags |= astrology.SEFLG_SIDEREAL
	return flags


def _sample_planet_longitudes(jd_array, planet_index, flags):
	out = np.empty(len(jd_array), dtype=np.float64)
	for i, jd in enumerate(jd_array):
		_serr, data = astrology.swe_calc_ut(float(jd), int(planet_index), int(flags))
		out[i] = util.normalize(float(data[planets.Planet.LONG]))
	return out


def _sample_node_longitudes(jd_array, radix, flags, *, descending):
	node_id = astrology.SE_MEAN_NODE if getattr(radix.options, 'meannode', True) else astrology.SE_TRUE_NODE
	out = np.empty(len(jd_array), dtype=np.float64)
	offset = 180.0 if descending else 0.0
	for i, jd in enumerate(jd_array):
		_serr, data = astrology.swe_calc_ut(float(jd), int(node_id), int(flags))
		out[i] = util.normalize(float(data[planets.Planet.LONG]) + offset)
	return out


def _sample_angle_longitudes(jd_array, symbolic_age_array, radix, options, kind, method=posfordate.SECONDARY):
	out = np.empty(len(jd_array), dtype=np.float64)
	for i, age in enumerate(symbolic_age_array):
		state = posfordate.progressed_angle_state_for_symbolic_age(
			radix, options, float(age), method=method,
		)
		if kind == KIND_ANGLE_ASC:
			out[i] = util.normalize(float(state['asc_lon']))
		else:
			out[i] = util.normalize(float(state['mc_lon']))
	return out


# ---------------------------------------------------------------------------
# Unwrap + fit + segment management
# ---------------------------------------------------------------------------


def _unwrap_longitude(values):
	"""Convert a sequence of mod-360 longitudes into a continuous (cumulative)
	longitude by removing wrap discontinuities. Detects forward (+360) wraps and
	backward (retrograde-through-zero) wraps."""
	out = np.array(values, dtype=np.float64, copy=True)
	for i in range(1, len(out)):
		delta = out[i] - out[i - 1]
		while delta > 180.0:
			out[i:] -= 360.0
			delta = out[i] - out[i - 1]
		while delta < -180.0:
			out[i:] += 360.0
			delta = out[i] - out[i - 1]
	return out


class _Segment(object):
	__slots__ = (
		'age_lo', 'age_hi', 'cheb', 'cheb_deriv', 'lon_lo', 'lon_hi',
		'dense_ages', 'dense_lons',
	)

	def __init__(self, age_lo, age_hi, cheb, lon_lo, lon_hi, dense_ages, dense_lons, cheb_deriv):
		self.age_lo = float(age_lo)
		self.age_hi = float(age_hi)
		self.cheb = cheb
		self.cheb_deriv = cheb_deriv
		self.lon_lo = float(lon_lo)
		self.lon_hi = float(lon_hi)
		# Dense pre-eval grid for sign-change bracketing in find_aspect_hits.
		# Built once at fit time; reused across every (target_lon, k) combination.
		self.dense_ages = dense_ages
		self.dense_lons = dense_lons


# Dense grid density per polynomial degree. A degree-d polynomial has at most
# d-1 extrema, so we sample ~4 points per monotonic interval to guarantee every
# sign change against any target is captured by adjacent samples.
_DENSE_POINTS_PER_DEGREE = 4
_DENSE_POINTS_FLOOR = 32


def _segment_breakpoints(span_start_age, span_end_age, kind):
	max_segment = float(_SEGMENT_DAYS[kind])
	span = float(span_end_age) - float(span_start_age)
	if span <= 0.0:
		return [(span_start_age, span_end_age)]
	count = max(1, int(math.ceil(span / max_segment)))
	step = span / count
	out = []
	for i in range(count):
		seg_lo = span_start_age + step * i
		seg_hi = span_start_age + step * (i + 1) if i + 1 < count else span_end_age
		out.append((seg_lo, seg_hi))
	return out


def _fit_segments(age_samples, lon_samples_unwrapped, kind, span_start_age, span_end_age):
	"""Cut the global sample set into segments and fit Chebyshev to each."""
	segments = []
	degree = _SEGMENT_DEGREE[kind]
	for seg_lo, seg_hi in _segment_breakpoints(span_start_age, span_end_age, kind):
		mask = (age_samples >= seg_lo - 1e-9) & (age_samples <= seg_hi + 1e-9)
		# Need enough samples for the degree we want
		seg_ages = age_samples[mask]
		seg_vals = lon_samples_unwrapped[mask]
		if len(seg_ages) < degree + 2:
			# Not enough samples in this segment; collapse to a single linear fit
			deg = max(1, len(seg_ages) - 1)
		else:
			deg = degree
		cheb = np.polynomial.chebyshev.Chebyshev.fit(seg_ages, seg_vals, deg, domain=[seg_lo, seg_hi])
		cheb_deriv = cheb.deriv()
		# Dense grid: enough resolution that adjacent samples bracket every
		# sign change against any horizontal target. Built once per segment at
		# fit cost (single vectorized polynomial eval) and reused for every
		# target_lon × winding-number-shift combination in find_aspect_hits —
		# replacing per-target Chebyshev.roots() (O(d^3) eigenvalue) with
		# O(grid) sign-scan + handful of Newton iterations per hit.
		dense_n = max(_DENSE_POINTS_FLOOR, deg * _DENSE_POINTS_PER_DEGREE)
		dense_ages = np.linspace(seg_lo, seg_hi, dense_n)
		dense_lons = cheb(dense_ages)
		segments.append(_Segment(
			seg_lo, seg_hi, cheb,
			float(np.min(dense_lons)), float(np.max(dense_lons)),
			dense_ages, dense_lons, cheb_deriv,
		))
	return segments


# ---------------------------------------------------------------------------
# Mean-quotidian angle inverse-function table
# ---------------------------------------------------------------------------
#
# For the MEAN_QUOTIDIAN_Q2 angle method, ARMC advances at a constant rate of
# MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR per native year (≈360.985°/yr). For SECONDARY
# the symbolic_age unit equals one ephemeris day equals one native year, so:
#
#     ARMC(age) = natal_armc + age * MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR  (mod 360°)
#
# Asc(ARMC) and MC(ARMC) are 360°-periodic functions of ARMC alone (given the
# place's latitude and the obliquity, both essentially constant over an 80-day
# real-ephemeris span). We sample one full 360° period of ARMC, build a lookup
# from ARMC to angle longitude, and invert as needed for aspect search.


class _QuotidianAngleTable(object):
	"""Inverse-function table for mean-quotidian Asc/MC.

	Stores Asc-as-function-of-ARMC (or MC-as-function-of-ARMC) sampled densely
	over [0, 360°). For aspect search at target T, find ARMC₀ where
	angle(ARMC₀) = T, then enumerate the ages that map to that ARMC₀ via the
	linear ARMC(age) law.
	"""

	__slots__ = (
		'kind',
		'natal_armc',
		'deg_per_age',
		'span_start_age',
		'span_end_age',
		'armc_grid',
		'angle_grid',
		'angle_grid_unwrapped',
		'unwrapped_min',
		'unwrapped_max',
		'ayanamsha_offset',
	)

	def __init__(self, kind, natal_armc, deg_per_age, span_start_age, span_end_age,
				 armc_grid, angle_grid, angle_grid_unwrapped, ayanamsha_offset=0.0):
		self.kind = kind
		self.natal_armc = float(natal_armc)
		self.deg_per_age = float(deg_per_age)
		self.span_start_age = float(span_start_age)
		self.span_end_age = float(span_end_age)
		self.armc_grid = armc_grid
		self.angle_grid = angle_grid
		self.angle_grid_unwrapped = angle_grid_unwrapped
		self.unwrapped_min = float(np.min(angle_grid_unwrapped))
		self.unwrapped_max = float(np.max(angle_grid_unwrapped))
		self.ayanamsha_offset = float(ayanamsha_offset)


def _quotidian_obliquity(radix, span_start_age, span_end_age):
	"""Pick the obliquity at the midpoint of the real-ephemeris span. Drift over an
	80-day span is sub-arcsecond; using midpoint keeps worst-case error symmetric."""
	birth_jd = float(radix.time.jd)
	mid_age = 0.5 * (float(span_start_age) + float(span_end_age))
	return posfordate._obl_ut(birth_jd + mid_age)


def _build_quotidian_angle_table(radix, kind, span_start_age, span_end_age, scale=1.0):
	"""Sample Asc(ARMC) or MC(ARMC) over one full 360° period using the same
	swisseph entry point that posfordate._build_houses_from_armc uses.

	`scale` is the progression-method scale factor (1.0 for SECONDARY, 27.32 for
	MINOR, 13.37 for TERTIARY). It enters only via `deg_per_age` — the rate at
	which ARMC advances per ephemeris-day for the chosen progression method.
	"""
	if kind not in (KIND_ANGLE_ASC_QUOTIDIAN, KIND_ANGLE_MC_QUOTIDIAN):
		raise ValueError('quotidian table requested for non-quotidian kind: %r' % (kind,))
	place = radix.place
	obl = _quotidian_obliquity(radix, span_start_age, span_end_age)
	mid_age = 0.5 * (float(span_start_age) + float(span_end_age))
	ayan = posfordate._ayan_ut(float(radix.time.jd) + mid_age, radix.options)
	hsys = radix.options.hsys if getattr(radix.options, 'hsys', None) in houses.Houses.hsystems else houses.Houses.hsystems[0]
	hsys_ord = ord(hsys)
	# 0.25° resolution in ARMC is enough for mid-latitudes — Asc varies by at most
	# ~6° per 1° of ARMC near the equator/poles, so 0.25° → ~1.5° max angle step.
	# We refine roots after detection so coarse sampling here is fine.
	n = 1440
	armc_grid = np.linspace(0.0, 360.0, n, endpoint=False)
	angle_grid = np.empty(n, dtype=np.float64)
	for i, armc in enumerate(armc_grid):
		_res, _cusps, ascmc = astrology.swe_houses_armc(
			float(armc), float(place.lat), float(obl), hsys_ord
		)
		if kind == KIND_ANGLE_ASC_QUOTIDIAN:
			angle_grid[i] = util.normalize(float(ascmc[houses.Houses.ASC]) - ayan)
		else:
			angle_grid[i] = util.normalize(float(ascmc[houses.Houses.MC]) - ayan)

	# Unwrap to a continuous (cumulative) angle, plus pad one period so the
	# wraparound from grid index n-1 → 0 has a smooth representation. We extend
	# the grid by one full period to make root detection across the wrap trivial.
	unwrapped_one = _unwrap_longitude(angle_grid)
	# Append one more period (shifted by +360°) so segments straddling the wrap
	# are covered by linear interpolation without special-casing.
	armc_extended = np.concatenate([armc_grid, armc_grid + 360.0])
	angle_extended = np.concatenate([unwrapped_one, unwrapped_one + 360.0])

	natal_armc = float(radix.houses.ascmc[houses.Houses.ARMC])
	# ARMC moves MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR degrees per native year, and
	# (1 native year) = (`scale` ephemeris days). So the per-ephem-day rate is
	# the per-year rate divided by the scale factor.
	if scale <= 0.0:
		scale = 1.0
	deg_per_age = float(posfordate.MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR) / float(scale)

	return _QuotidianAngleTable(
		kind=kind,
		natal_armc=natal_armc,
		deg_per_age=deg_per_age,
		span_start_age=span_start_age,
		span_end_age=span_end_age,
		armc_grid=armc_extended,
		angle_grid=angle_grid,  # mod-360 grid kept for evaluation
		angle_grid_unwrapped=angle_extended,
		ayanamsha_offset=ayan,
	)


def _quotidian_angle_at_armc(table, armc):
	"""Linearly interpolate the (mod-360) angle for a given ARMC."""
	armc_norm = float(armc) % 360.0
	# armc_grid is sorted ascending [0..360..720); use the first period.
	idx = int(armc_norm / 360.0 * (len(table.armc_grid) // 2))
	# Clamp to valid index range
	if idx < 0:
		idx = 0
	max_idx = len(table.armc_grid) // 2 - 1
	if idx > max_idx:
		idx = max_idx
	# Linear interp across the unwrapped grid (then mod 360 at the end)
	a = float(table.armc_grid[idx])
	b = float(table.armc_grid[idx + 1])
	if b == a:
		val = float(table.angle_grid_unwrapped[idx])
	else:
		t = (armc_norm - a) / (b - a)
		val = float(table.angle_grid_unwrapped[idx]) + t * (float(table.angle_grid_unwrapped[idx + 1]) - float(table.angle_grid_unwrapped[idx]))
	return util.normalize(val)


def _quotidian_angle_speed_at_armc(table, armc):
	"""Estimate d(angle)/d(armc) at a given ARMC by central difference on the
	sample grid; multiply by deg_per_age to convert to d(angle)/d(symbolic_age)."""
	armc_norm = float(armc) % 360.0
	half = len(table.armc_grid) // 2
	idx = int(armc_norm / 360.0 * half)
	idx = max(1, min(half - 2, idx))
	d_angle = float(table.angle_grid_unwrapped[idx + 1]) - float(table.angle_grid_unwrapped[idx - 1])
	d_armc = float(table.armc_grid[idx + 1]) - float(table.armc_grid[idx - 1])
	if d_armc == 0:
		return 0.0
	return (d_angle / d_armc) * table.deg_per_age


def _quotidian_find_aspect_hits(table, target_lon):
	"""Return ages within [span_start_age, span_end_age] where the angle hits target_lon."""
	target = float(target_lon) % 360.0
	# Walk the unwrapped grid (covers two full periods) and find sign changes of
	# (angle - target) modulo 360. Because we work with the unwrapped (cumulative)
	# longitude, "target" appears as target + 360k for every k in the angle range.
	angle_unwrapped = table.angle_grid_unwrapped
	armc_grid = table.armc_grid
	hits_armc = []
	# Iterate winding numbers k that intersect the unwrapped range.
	k_min = int(math.floor((table.unwrapped_min - target) / 360.0))
	k_max = int(math.ceil((table.unwrapped_max - target) / 360.0))
	for k in range(k_min, k_max + 1):
		shifted = target + 360.0 * k
		# Find sign-change crossings in (angle_unwrapped - shifted)
		residual = angle_unwrapped - shifted
		# Detect zero crossings between consecutive samples
		sign_change = (residual[:-1] * residual[1:]) < 0.0
		idx_list = np.where(sign_change)[0]
		for idx in idx_list:
			# Linear root in [armc_grid[idx], armc_grid[idx+1]]
			r0, r1 = float(residual[idx]), float(residual[idx + 1])
			if r1 == r0:
				armc0 = float(armc_grid[idx])
			else:
				t = -r0 / (r1 - r0)
				armc0 = float(armc_grid[idx]) + t * (float(armc_grid[idx + 1]) - float(armc_grid[idx]))
			# armc0 is in [0, 720°). Take mod 360° for the canonical period.
			hits_armc.append(armc0 % 360.0)

	# Deduplicate near-equal ARMC roots from the doubled grid
	hits_armc.sort()
	deduped_armc = []
	for a in hits_armc:
		if deduped_armc and abs(a - deduped_armc[-1]) < 1e-6:
			continue
		deduped_armc.append(a)

	# Convert each canonical ARMC to ages within [span_start_age, span_end_age]:
	#     age_k = (armc0 - natal_armc + 360k) / deg_per_age
	natal_armc = table.natal_armc
	deg_per_age = table.deg_per_age
	if deg_per_age == 0:
		return []
	ages = []
	for armc0 in deduped_armc:
		# Need integer k such that age_k ∈ [start, end]
		base = (armc0 - natal_armc) / deg_per_age
		# k is the number of full ARMC cycles past natal — find k range
		k_min_age = math.ceil((table.span_start_age - base) * deg_per_age / 360.0)
		k_max_age = math.floor((table.span_end_age - base) * deg_per_age / 360.0)
		for k in range(int(k_min_age), int(k_max_age) + 1):
			age_k = base + k * 360.0 / deg_per_age
			if table.span_start_age - 1e-9 <= age_k <= table.span_end_age + 1e-9:
				ages.append(age_k)
	ages.sort()
	return ages


# ---------------------------------------------------------------------------
# Lot of Fortune under MEAN_QUOTIDIAN_Q2: composite evaluator
# ---------------------------------------------------------------------------
#
# LoF in secondary progression is:
#     diff_signed = ±(moon_lon - sun_lon)   [sign depends on day/night + lotoffortune mode]
#     diff = diff_signed mod 360
#     LoF = asc_lon + diff  (mod 360)
#
# For mean-quotidian:
#   - asc_lon: from _QuotidianAngleTable (cycles 360°/year)
#   - sun_lon, moon_lon: from cheby fits (slow)
#   - day/night: derived from progressed ARMC + Sun's RA/decl + place.lat
#       ARMC = natal_armc + age * MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR (exact)
#       Sun RA/decl: derived analytically from sun_lon + obliquity
#         (Sun's ecliptic latitude is < 1 arcsec — analytic conversion accurate
#          to better than 0.01 arcsec).
#
# LoF aspect search: LoF(age) ≈ asc_lon(age) + slow_term(age) — fast cycle
# riding on slow drift, with occasional discontinuities at day/night flips.
# We sample LoF(age) on a coarse grid (every ~0.05 ephem-day = 18° of asc
# motion), detect sign changes against (LoF − target), and bisect.


class _QuotidianLofTable(object):
	"""Composite evaluator for mean-quotidian LoF aspect-hit search."""

	__slots__ = (
		'asc_table',
		'cheby_sun_id',
		'cheby_moon_id',
		'place_lat',
		'obl_rad',
		'lotoffortune_mode',
		'usedaynightorb',
		'daynightorb_deg',
		'natal_armc',
		'deg_per_age',
		'span_start_age',
		'span_end_age',
	)

	def __init__(
		self,
		asc_table,
		cheby_sun_id,
		cheby_moon_id,
		place_lat,
		obl_rad,
		lotoffortune_mode,
		usedaynightorb,
		daynightorb_deg,
		natal_armc,
		deg_per_age,
		span_start_age,
		span_end_age,
	):
		self.asc_table = asc_table
		self.cheby_sun_id = cheby_sun_id
		self.cheby_moon_id = cheby_moon_id
		self.place_lat = float(place_lat)
		self.obl_rad = float(obl_rad)
		self.lotoffortune_mode = int(lotoffortune_mode)
		self.usedaynightorb = bool(usedaynightorb)
		self.daynightorb_deg = float(daynightorb_deg)
		self.natal_armc = float(natal_armc)
		self.deg_per_age = float(deg_per_age)
		self.span_start_age = float(span_start_age)
		self.span_end_age = float(span_end_age)


def _sun_ra_decl_from_lon(sun_lon_deg, obl_rad):
	"""Analytic ecliptic→equatorial conversion ignoring Sun's ecliptic latitude
	(under 1 arcsec by definition). Returns (RA, decl) in degrees, RA in [0, 360)."""
	lon_rad = math.radians(float(sun_lon_deg))
	sin_lon = math.sin(lon_rad)
	cos_lon = math.cos(lon_rad)
	sin_obl = math.sin(obl_rad)
	cos_obl = math.cos(obl_rad)
	decl = math.degrees(math.asin(sin_obl * sin_lon))
	ra = math.degrees(math.atan2(cos_obl * sin_lon, cos_lon))
	if ra < 0.0:
		ra += 360.0
	return ra, decl


def _sun_above_horizon(armc, sun_ra, sun_decl, place_lat, usedaynightorb, daynightorb_deg):
	"""Mirror of searchbackend._secondary_symbolic_sun_above_horizon, expressed in
	terms of raw ARMC + Sun RA/decl + place latitude (no angle_state dict)."""
	ramc = float(armc) % 360.0
	raic = (ramc + 180.0) % 360.0
	val = math.tan(math.radians(place_lat)) * math.tan(math.radians(sun_decl))
	adlat = 0.0
	if math.fabs(val) <= 1.0:
		adlat = math.degrees(math.asin(val))
	med = math.fabs(ramc - sun_ra)
	if med > 180.0:
		med = 360.0 - med
	icd = math.fabs(raic - sun_ra)
	if icd > 180.0:
		icd = 360.0 - icd
	dsa = 90.0 + adlat
	abovehorizon = med <= dsa
	if not usedaynightorb or abovehorizon:
		return abovehorizon
	nsa = 90.0 - adlat
	mdsun = -icd
	sasun = -nsa
	if mdsun < 0.0:
		mdsun += 180.0
	if sasun < 0.0:
		sasun += 180.0
	return bool(mdsun - daynightorb_deg < sasun)


def _build_quotidian_lof_table(fit, asc_table_body_id, sun_body_id, moon_body_id, span_start_age, span_end_age):
	"""Wire up the composite LoF evaluator. Caller must have already fit the
	quotidian Asc table and cheby Sun/Moon polynomials on `fit`."""
	radix = fit.radix
	options = fit.options
	asc_table = fit._quotidian.get(asc_table_body_id)
	if asc_table is None:
		raise ValueError('asc table not built before LoF composition')
	mid_age = 0.5 * (float(span_start_age) + float(span_end_age))
	obl_deg = posfordate._obl_ut(float(radix.time.jd) + mid_age)
	obl_rad = math.radians(float(obl_deg))
	lotoffortune_mode = int(getattr(options, 'lotoffortune', 0))
	usedaynightorb = bool(getattr(options, 'usedaynightorb', False))
	daynightorb_deg = float(getattr(options, 'daynightorbdeg', 0.0)) + float(getattr(options, 'daynightorbmin', 0.0)) / 60.0
	return _QuotidianLofTable(
		asc_table=asc_table,
		cheby_sun_id=sun_body_id,
		cheby_moon_id=moon_body_id,
		place_lat=radix.place.lat,
		obl_rad=obl_rad,
		lotoffortune_mode=lotoffortune_mode,
		usedaynightorb=usedaynightorb,
		daynightorb_deg=daynightorb_deg,
		natal_armc=asc_table.natal_armc,
		deg_per_age=asc_table.deg_per_age,
		span_start_age=float(span_start_age),
		span_end_age=float(span_end_age),
	)


def _quotidian_lof_at_age(fit, table, symbolic_age):
	"""Compute LoF longitude (mod 360°) at a given symbolic age."""
	lon, _abovehor = _quotidian_lof_at_age_with_flag(fit, table, symbolic_age)
	return lon


def _quotidian_lof_at_age_with_flag(fit, table, symbolic_age):
	"""Compute LoF longitude AND the day/night flag used. Day/night flips are
	discontinuities — search must skip intervals where this flag changes."""
	age = float(symbolic_age)
	armc = (table.natal_armc + age * table.deg_per_age) % 360.0
	asc_lon = _quotidian_angle_at_armc(table.asc_table, armc)

	sun_segments = fit._segments.get(table.cheby_sun_id)
	moon_segments = fit._segments.get(table.cheby_moon_id)
	sun_lon = util.normalize(float(_eval_segments_at_age(sun_segments, age)))
	moon_lon = util.normalize(float(_eval_segments_at_age(moon_segments, age)))

	sun_ra, sun_decl = _sun_ra_decl_from_lon(
		util.to_tropical_lon(sun_lon, table.asc_table.ayanamsha_offset),
		table.obl_rad,
	)
	abovehor = _sun_above_horizon(armc, sun_ra, sun_decl, table.place_lat, table.usedaynightorb, table.daynightorb_deg)

	# Mirror searchbackend._secondary_symbolic_lof_longitude
	#   LFMOONSUN (0): always moon-sun
	#   LFDSUNMOON (1): sun-moon if day, moon-sun if night
	#   else (LFNIGHT-flipped, default): moon-sun if day, sun-moon if night
	if table.lotoffortune_mode == 0:
		diff = moon_lon - sun_lon
	elif table.lotoffortune_mode == 1:
		diff = (sun_lon - moon_lon) if abovehor else (moon_lon - sun_lon)
	else:
		diff = (moon_lon - sun_lon) if abovehor else (sun_lon - moon_lon)
	if diff < 0.0:
		diff += 360.0
	return util.normalize(asc_lon + diff), abovehor


def _eval_segments_at_age(segments, age):
	"""Evaluate cheby-segment list at a given symbolic age."""
	if not segments:
		return 0.0
	for seg in segments:
		if seg.age_lo - 1e-9 <= age <= seg.age_hi + 1e-9:
			return float(seg.cheb(age))
	seg = segments[0] if age < segments[0].age_lo else segments[-1]
	return float(seg.cheb(age))


def _signed_arc_short(a, b):
	d = float(a) - float(b)
	while d > 180.0:
		d -= 360.0
	while d <= -180.0:
		d += 360.0
	return d


def _refine_root_safe_newton(cheb, cheb_deriv, target, a_lo, a_hi, r_lo, r_hi, max_iters=40, tol=1e-9):
	"""Safe Newton-Raphson on (cheb(age) - target) within [a_lo, a_hi], where
	r_lo and r_hi are pre-computed residual values at the brackets with opposite
	signs. Falls back to bisection whenever Newton tries to step outside the
	bracket or the derivative goes to zero. Always converges if (r_lo, r_hi)
	straddle zero.

	Returns the refined age, or None if convergence fails (shouldn't happen for
	well-formed brackets but the guard is here for safety)."""
	if r_lo == 0.0:
		return a_lo
	if r_hi == 0.0:
		return a_hi
	# Orient so f(lo) < 0 < f(hi).
	if r_lo > 0.0:
		a_lo, a_hi = a_hi, a_lo
		r_lo, r_hi = r_hi, r_lo
	age = 0.5 * (a_lo + a_hi)
	prev_step = abs(a_hi - a_lo)
	step = prev_step
	for _ in range(max_iters):
		f = float(cheb(age)) - target
		if math.fabs(f) < tol:
			return age
		df = float(cheb_deriv(age))
		# Decide between Newton and bisection. Newton is preferred when the
		# step (a) keeps us inside the bracket and (b) is at least halving
		# the residual range — the Numerical Recipes 'rtsafe' rule.
		do_bisect = (df == 0.0)
		if not do_bisect:
			newton_step = f / df
			candidate = age - newton_step
			# Outside bracket → bisect.
			if (candidate - a_hi) * (candidate - a_lo) > 0.0:
				do_bisect = True
			# Step not at least halving → bisect.
			elif math.fabs(2.0 * f) > math.fabs(prev_step * df):
				do_bisect = True
		if do_bisect:
			prev_step = step
			step = 0.5 * (a_hi - a_lo)
			new_age = a_lo + step
			if new_age == a_lo:
				return new_age
			age = new_age
		else:
			prev_step = step
			step = newton_step
			new_age = candidate
			if new_age == age:
				return new_age
			age = new_age
		# Update bracket using sign of f at new age.
		new_f = float(cheb(age)) - target
		if new_f < 0.0:
			a_lo = age
			r_lo = new_f
		else:
			a_hi = age
			r_hi = new_f
	# Failed to converge to tolerance — return midpoint of final bracket.
	return 0.5 * (a_lo + a_hi)


def _quotidian_lof_find_aspect_hits(fit, table, target_lon):
	"""Sample LoF on a fine grid (~0.05 ephem-day = ~18° of asc motion). When two
	adjacent samples sit on opposite sides of a day/night flip we bisect to find
	the exact flip moment, split the interval at the flip, and search each
	sub-interval independently — real aspect crossings can occur arbitrarily close
	to a flip on either side. Sign-change roots within a same-flag sub-interval
	are bisected to refine."""
	span = table.span_end_age - table.span_start_age
	if span <= 0.0:
		return []
	cadence = 0.05
	n = max(int(math.ceil(span / cadence)) + 1, 32)
	ages = np.linspace(table.span_start_age, table.span_end_age, n)
	target = float(target_lon)

	residuals = np.empty(n, dtype=np.float64)
	flags = np.empty(n, dtype=bool)
	for i, a in enumerate(ages):
		lon, abovehor = _quotidian_lof_at_age_with_flag(fit, table, float(a))
		residuals[i] = _signed_arc_short(lon, target)
		flags[i] = abovehor

	hits = []
	for i in range(n - 1):
		lo_age, hi_age = float(ages[i]), float(ages[i + 1])
		lo_r, hi_r = float(residuals[i]), float(residuals[i + 1])
		lo_flag, hi_flag = bool(flags[i]), bool(flags[i + 1])

		if lo_flag == hi_flag:
			_lof_check_subinterval(fit, table, target, lo_age, hi_age, lo_r, hi_r, lo_flag, hits)
			continue

		# Day/night flip somewhere in this interval — find it and split.
		flip_age, lo_side_lon, hi_side_lon = _bisect_lof_flip(fit, table, lo_age, hi_age, lo_flag)
		# Two new sub-intervals: [lo_age → flip_age] on lo_flag side,
		#                       [flip_age → hi_age] on hi_flag side.
		lo_side_r = _signed_arc_short(lo_side_lon, target)
		hi_side_r = _signed_arc_short(hi_side_lon, target)
		_lof_check_subinterval(fit, table, target, lo_age, flip_age, lo_r, lo_side_r, lo_flag, hits)
		_lof_check_subinterval(fit, table, target, flip_age, hi_age, hi_side_r, hi_r, hi_flag, hits)

	# Dedupe near-coincident roots
	hits.sort()
	deduped = []
	for h in hits:
		if deduped and math.fabs(h - deduped[-1]) < 1e-6:
			continue
		deduped.append(h)
	return deduped


def _lof_check_subinterval(fit, table, target, lo_age, hi_age, lo_r, hi_r, expected_flag, hits):
	"""Test a same-flag sub-interval for a sign-change crossing; bisect to refine."""
	if hi_age <= lo_age + 1e-9:
		return
	if math.fabs(hi_r - lo_r) > 60.0:
		# Within-flag residual swing larger than expected sample-step motion —
		# typically a 360° wraparound, not a real crossing. Skip.
		return
	if lo_r == 0.0:
		hits.append(lo_age)
		return
	if lo_r * hi_r >= 0.0:
		return

	lo, hi = lo_age, hi_age
	lo_val = lo_r
	for _ in range(50):
		mid = 0.5 * (lo + hi)
		mid_lon, mid_flag = _quotidian_lof_at_age_with_flag(fit, table, mid)
		if bool(mid_flag) != expected_flag:
			# Bisection wandered onto the other flag side — pull `hi` in.
			hi = mid
			continue
		mid_r = _signed_arc_short(mid_lon, target)
		if math.fabs(mid_r) < 1e-7:
			hits.append(mid)
			return
		if (lo_val * mid_r) < 0.0:
			hi = mid
		else:
			lo, lo_val = mid, mid_r
	hits.append(0.5 * (lo + hi))


def _bisect_lof_flip(fit, table, lo_age, hi_age, lo_flag):
	"""Bisect [lo_age, hi_age] to find the day/night flip moment. Return
	(flip_age, lo_side_lon_just_before_flip, hi_side_lon_just_after_flip)."""
	lo, hi = lo_age, hi_age
	for _ in range(50):
		mid = 0.5 * (lo + hi)
		_, mid_flag = _quotidian_lof_at_age_with_flag(fit, table, mid)
		if bool(mid_flag) == lo_flag:
			lo = mid
		else:
			hi = mid
		if hi - lo < 1e-9:
			break
	# Sample LoF on each side of the flip with a tiny offset to capture the two
	# distinct LoF values. lo is just before flip (lo_flag side); hi is just after.
	lo_side_lon, _ = _quotidian_lof_at_age_with_flag(fit, table, lo)
	hi_side_lon, _ = _quotidian_lof_at_age_with_flag(fit, table, hi)
	return 0.5 * (lo + hi), lo_side_lon, hi_side_lon


# ---------------------------------------------------------------------------
# Public fit object
# ---------------------------------------------------------------------------


class ProgressionFit(object):
	"""Bundle of Chebyshev fits over [span_start_age, span_end_age].

	`span_start_age` / `span_end_age` are in **ephemeris days** — the natural
	domain for the polynomial (and for `birth_jd + age = jd_prog`). The progression
	method only affects the symbolic_age ↔ native_years mapping, the angle-state
	sampler's method dispatch, and the mean-quotidian degree-per-age rate.
	"""

	def __init__(self, radix, options, span_start_age, span_end_age, method=posfordate.SECONDARY):
		self.radix = radix
		self.options = options
		self.method = posfordate.progression_method(method)
		self.scale = posfordate.progression_symbolic_scale(self.method)
		self.span_start_age = float(span_start_age)
		self.span_end_age = float(span_end_age)
		self.flags = _planet_flags(radix)
		self.birth_jd = float(radix.time.jd)
		self._segments = {}      # body_id -> list[_Segment] (cheby fit)
		self._kinds = {}         # body_id -> kind
		self._quotidian = {}     # body_id -> _QuotidianAngleTable (mean-quotidian inverse-fn)
		self._quotidian_lof = {} # body_id -> _QuotidianLofTable
		# Per-body fit timing accumulators (populated only when PROG_LOG enabled).
		self.fit_timings_ms = {}   # body_id -> total fit cost
		self.sample_counts = {}    # body_id -> number of swisseph samples taken

	def fit(self, body_id, kind, planet_index=None):
		if body_id in self._segments or body_id in self._quotidian or body_id in self._quotidian_lof:
			return
		t0 = time.perf_counter() if prog_log.enabled() else 0.0
		# Mean-quotidian Asc/MC use an inverse-function table, not a cheby fit.
		if kind in (KIND_ANGLE_ASC_QUOTIDIAN, KIND_ANGLE_MC_QUOTIDIAN):
			self._quotidian[body_id] = _build_quotidian_angle_table(
				self.radix, kind, self.span_start_age, self.span_end_age, scale=self.scale,
			)
			self._kinds[body_id] = kind
			if prog_log.enabled():
				self.fit_timings_ms[body_id] = (time.perf_counter() - t0) * 1000.0
				self.sample_counts[body_id] = 1440  # quotidian table grid size
			return
		# Mean-quotidian LoF combines the Asc table with cheby Sun/Moon.
		if kind == KIND_LOF_QUOTIDIAN:
			self.fit('angle:asc', KIND_ANGLE_ASC_QUOTIDIAN)
			self.fit('planet:sun', KIND_PLANET_SLOW, planet_index=astrology.SE_SUN)
			self.fit('planet:moon', KIND_PLANET_FAST, planet_index=astrology.SE_MOON)
			self._quotidian_lof[body_id] = _build_quotidian_lof_table(
				self,
				asc_table_body_id='angle:asc',
				sun_body_id='planet:sun',
				moon_body_id='planet:moon',
				span_start_age=self.span_start_age,
				span_end_age=self.span_end_age,
			)
			self._kinds[body_id] = kind
			if prog_log.enabled():
				# Composite — its cost is rolled up into the sub-fits above.
				self.fit_timings_ms[body_id] = (time.perf_counter() - t0) * 1000.0
			return

		cadence = _CADENCE[kind]
		span = max(self.span_end_age - self.span_start_age, 1e-3)
		# At least degree+4 samples per segment, plus a small global floor.
		min_total = max(8, int(math.ceil(span * cadence)) + 4)
		ages = np.linspace(self.span_start_age, self.span_end_age, min_total)
		jds = self.birth_jd + ages

		if kind in (KIND_PLANET_FAST, KIND_PLANET_SLOW):
			lons = _sample_planet_longitudes(jds, planet_index, self.flags)
		elif kind == KIND_NODE:
			descending = (body_id == 'planet:desc_node')
			lons = _sample_node_longitudes(jds, self.radix, self.flags, descending=descending)
		elif kind == KIND_CHIRON:
			lons = _sample_planet_longitudes(jds, astrology.SE_CHIRON, self.flags)
		elif kind in (KIND_ANGLE_ASC, KIND_ANGLE_MC):
			lons = _sample_angle_longitudes(jds, ages, self.radix, self.options, kind, method=self.method)
		elif kind == KIND_LOF:
			# LoF derives from Sun, Moon, and Asc; ensure those fits exist first.
			self.fit('planet:sun', KIND_PLANET_SLOW, planet_index=astrology.SE_SUN)
			self.fit('planet:moon', KIND_PLANET_FAST, planet_index=astrology.SE_MOON)
			self.fit('angle:asc', KIND_ANGLE_ASC)
			lons = _sample_lof_longitudes(jds, ages, self.radix, self.options, self.flags, method=self.method)
		else:
			raise ValueError('unknown body kind: %r' % (kind,))

		unwrapped = _unwrap_longitude(lons)
		self._segments[body_id] = _fit_segments(ages, unwrapped, kind, self.span_start_age, self.span_end_age)
		self._kinds[body_id] = kind
		if prog_log.enabled():
			self.fit_timings_ms[body_id] = (time.perf_counter() - t0) * 1000.0
			self.sample_counts[body_id] = int(min_total)

	def has(self, body_id):
		return body_id in self._segments or body_id in self._quotidian or body_id in self._quotidian_lof

	def _quotidian_armc_for_age(self, table, symbolic_age):
		return (table.natal_armc + float(symbolic_age) * table.deg_per_age) % 360.0

	def longitude(self, body_id, symbolic_age):
		lof_table = self._quotidian_lof.get(body_id)
		if lof_table is not None:
			return _quotidian_lof_at_age(self, lof_table, symbolic_age)
		quot = self._quotidian.get(body_id)
		if quot is not None:
			armc = self._quotidian_armc_for_age(quot, symbolic_age)
			return _quotidian_angle_at_armc(quot, armc)
		segments = self._segments.get(body_id)
		if not segments:
			return None
		age = float(symbolic_age)
		for seg in segments:
			if seg.age_lo - 1e-9 <= age <= seg.age_hi + 1e-9:
				return util.normalize(float(seg.cheb(age)))
		# Outside fitted span — clamp to nearest segment for robustness.
		seg = segments[0] if age < segments[0].age_lo else segments[-1]
		return util.normalize(float(seg.cheb(age)))

	def speed(self, body_id, symbolic_age):
		"""Return d(longitude)/d(symbolic_age) — degrees per ephemeris day. For
		SECONDARY this equals degrees per native year of progressed motion."""
		if body_id in self._quotidian_lof:
			# LoF speed dominated by progressed Asc rate (Sun/Moon contribute
			# fractions of a degree per year). Use a finite difference on the
			# composite evaluator — small perturbation is cheap.
			eps = 1e-3
			lo = self.longitude(body_id, symbolic_age - eps)
			hi = self.longitude(body_id, symbolic_age + eps)
			return _signed_arc_short(hi, lo) / (2.0 * eps)
		quot = self._quotidian.get(body_id)
		if quot is not None:
			armc = self._quotidian_armc_for_age(quot, symbolic_age)
			return _quotidian_angle_speed_at_armc(quot, armc)
		segments = self._segments.get(body_id)
		if not segments:
			return None
		age = float(symbolic_age)
		for seg in segments:
			if seg.age_lo - 1e-9 <= age <= seg.age_hi + 1e-9:
				return float(seg.cheb.deriv()(age))
		seg = segments[0] if age < segments[0].age_lo else segments[-1]
		return float(seg.cheb.deriv()(age))

	def find_aspect_hits(self, body_id, target_lon):
		"""Return a sorted list of symbolic ages where body crosses target_lon (mod 360).

		Roots are constrained to the fitted span. Uses cached per-segment dense
		evaluation grids and safe Newton-with-bisection refinement; the per-target
		Chebyshev.roots() eigenvalue solve is only invoked as a fallback for
		segments where the dense grid suggests anomalous behavior.
		"""
		lof_table = self._quotidian_lof.get(body_id)
		if lof_table is not None:
			return _quotidian_lof_find_aspect_hits(self, lof_table, target_lon)
		quot = self._quotidian.get(body_id)
		if quot is not None:
			return _quotidian_find_aspect_hits(quot, target_lon)
		segments = self._segments.get(body_id)
		if not segments:
			return []
		hits = []
		target = float(target_lon)
		for seg in segments:
			# Inflate bracket to be safe against flat polynomial extrema.
			lo = seg.lon_lo - 1.0
			hi = seg.lon_hi + 1.0
			# Smallest k such that target + 360 k >= lo
			k_min = int(math.floor((lo - target) / 360.0))
			k_max = int(math.ceil((hi - target) / 360.0))
			dense_ages = seg.dense_ages
			dense_lons = seg.dense_lons
			for k in range(k_min, k_max + 1):
				shifted_target = target + 360.0 * k
				if shifted_target < seg.lon_lo - 1.0 or shifted_target > seg.lon_hi + 1.0:
					continue
				# Sign-change scan on the cached dense grid — O(n) and vectorized.
				residual = dense_lons - shifted_target
				# Adjacent pair brackets a root when signs differ, including the
				# case where one sample landed exactly on the target (sign 0).
				# np.sign returns {-1, 0, +1}; pairs (0,0) correctly resolve to
				# equal (not a bracket) because they share no root information.
				sign_lo = np.sign(residual[:-1])
				sign_hi = np.sign(residual[1:])
				bracket_mask = sign_lo != sign_hi
				bracket_idx = np.where(bracket_mask)[0]
				for idx in bracket_idx:
					a_lo = float(dense_ages[idx])
					a_hi = float(dense_ages[idx + 1])
					r_lo = float(residual[idx])
					r_hi = float(residual[idx + 1])
					root_age = _refine_root_safe_newton(
						seg.cheb, seg.cheb_deriv, shifted_target,
						a_lo, a_hi, r_lo, r_hi,
					)
					if root_age is None:
						continue
					if root_age < seg.age_lo - 1e-9 or root_age > seg.age_hi + 1e-9:
						continue
					hits.append(root_age)
				# Tangent touches (residual hits exactly 0 at a sample without sign change)
				# would be missed by the strict <0 mask. They're vanishingly rare for the
				# astrology cases we care about (aspects to discrete target longitudes); if
				# they ever show up we can extend with a near-zero detector.
		# Sort + dedupe near-coincident roots (segment boundaries can produce both sides).
		hits.sort()
		deduped = []
		for h in hits:
			if deduped and abs(h - deduped[-1]) < 1e-6:
				continue
			deduped.append(h)
		return deduped


# ---------------------------------------------------------------------------
# Lot of Fortune sampler (lives at module scope so ProgressionFit.fit can call it)
# ---------------------------------------------------------------------------


def _sample_lof_longitudes(jd_array, symbolic_age_array, radix, options, flags, method=posfordate.SECONDARY):
	"""Sample LoF longitude by reusing the existing posfordate angle state machinery.

	This still calls swe_calc_ut three times per sample (Sun ecliptic, Moon
	ecliptic, Sun equatorial for above-horizon test) but only on the small
	sample grid, not per output row.
	"""
	import searchbackend  # local import to avoid cycle on module load
	out = np.empty(len(jd_array), dtype=np.float64)
	for i, age in enumerate(symbolic_age_array):
		angle_state = posfordate.progressed_angle_state_for_symbolic_age(
			radix, options, float(age), method=method,
		)
		out[i] = util.normalize(float(searchbackend._secondary_symbolic_lof_longitude(radix, float(age), angle_state, method=method)))
	return out
