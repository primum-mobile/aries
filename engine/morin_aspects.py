# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Morin's 3-D aspect circle ("excentric").

Implements the geometry of Astrologia Gallica Book 16 Section I Chapter 9 and
the directional correction from Book 22 Section II Chapters 2-3.

For a planet of true ecliptic longitude lambda_p and signed latitude beta_p at
time t, the circle of aspects (Morin's "excentric") is the great circle that
passes through the body and is inclined to the ecliptic by

    i = max |beta(t')| over t' in the current half-revolution
        (between the two latitude-zero crossings flanking t)

with the sign of i tracking the hemisphere the planet is currently in.

Bianchini takes i = beta_p (the instantaneous latitude). Morin replaces that
with the half-revolution maximum so the aspect circle approximates the
planet's real apparent path on the Primum Mobile, and the squares/trines fall
off-ecliptic with their own latitude.

This module exposes a single entry point used by the PD engine:

    aspect_correction(tjd_ut, pId, flag, lon_p, lat_p, asp_signed_deg)
        -> (delta_lon_deg, lat_aspect_deg)

so that the corrected ecliptic position of the aspect terminus is

    lon_aspect = lon_p + asp_signed_deg + delta_lon_deg   (mod 360)
    lat_aspect = lat_aspect_deg

asp_signed_deg is positive for sinister, negative for dexter, in
{0, 30, 45, 60, 72, 90, 120, 135, 144, 150, 180}.
"""

import math
import astrology


# Half-revolution scan window in days for each Swiss-Eph planet id.
# Tuned to comfortably bracket two consecutive ecliptic-latitude zero
# crossings (apparent nodes).
_NODE_SCAN_DAYS = {
	astrology.SE_SUN:     0,
	astrology.SE_MOON:    20,
	astrology.SE_MERCURY: 60,
	astrology.SE_VENUS:   140,
	astrology.SE_MARS:    420,
	astrology.SE_JUPITER: 800,
	astrology.SE_SATURN:  1500,
	astrology.SE_URANUS:  3000,
	astrology.SE_NEPTUNE: 6000,
	astrology.SE_PLUTO:   9000,
}


_cache = {}


def clear_cache():
	"""Drop the module-level cache. Call when the chart time changes."""
	_cache.clear()


def _calc_lat(tjd, pId, flag):
	serr, data = astrology.swe_calc_ut(tjd, pId, flag)
	return data[1]


def _bisect_node(t_a, t_b, lat_a, lat_b, pId, flag, tol=1.0e-4):
	# Caller guarantees lat_a and lat_b have opposite sign (or one is ~zero).
	for _ in range(60):
		if abs(t_b - t_a) <= tol:
			break
		tm = 0.5 * (t_a + t_b)
		lm = _calc_lat(tm, pId, flag)
		if (lm >= 0.0) == (lat_a >= 0.0):
			t_a, lat_a = tm, lm
		else:
			t_b, lat_b = tm, lm
	return 0.5 * (t_a + t_b)


def _half_revolution(tjd, pId, flag, lat_now):
	"""Return (t_prev_node, t_next_node, t_max, lat_max_signed) bracketing
	tjd, or None if the surrounding nodes can't be located within the
	planet's scan window.
	"""
	if abs(lat_now) < 1.0e-9:
		return None

	span = _NODE_SCAN_DAYS.get(pId, 0)
	if span <= 0:
		return None

	step = max(span / 40.0, 0.25)
	sign = 1.0 if lat_now > 0.0 else -1.0

	# Forward search for next node.
	t = tjd
	lat = lat_now
	t_next = None
	steps = int(math.ceil(span / step)) + 1
	for _ in range(steps):
		t_n = t + step
		lat_n = _calc_lat(t_n, pId, flag)
		if lat * sign > 0.0 and lat_n * sign <= 0.0:
			t_next = _bisect_node(t, t_n, lat, lat_n, pId, flag)
			break
		t, lat = t_n, lat_n
	if t_next is None:
		return None

	# Backward search for previous node.
	t = tjd
	lat = lat_now
	t_prev = None
	for _ in range(steps):
		t_p = t - step
		lat_p = _calc_lat(t_p, pId, flag)
		if lat * sign > 0.0 and lat_p * sign <= 0.0:
			t_prev = _bisect_node(t_p, t, lat_p, lat, pId, flag)
			break
		t, lat = t_p, lat_p
	if t_prev is None:
		return None

	# Locate the latitude extremum between the two nodes.
	# Coarse scan + parabolic interpolation around the best sample.
	n_samples = 80
	dt = (t_next - t_prev) / n_samples
	best_t = tjd
	best_lat = lat_now
	for k in range(1, n_samples):
		ti = t_prev + k * dt
		li = _calc_lat(ti, pId, flag)
		if abs(li) > abs(best_lat):
			best_t = ti
			best_lat = li

	# Parabolic refinement around best_t (one bisection-style refinement).
	for _ in range(8):
		h = max(dt * 0.5, 1.0e-4)
		l_left = _calc_lat(best_t - h, pId, flag)
		l_right = _calc_lat(best_t + h, pId, flag)
		if abs(l_left) > abs(best_lat):
			best_t -= h
			best_lat = l_left
			dt = h
			continue
		if abs(l_right) > abs(best_lat):
			best_t += h
			best_lat = l_right
			dt = h
			continue
		# Parabolic vertex of |lat|: approximate via second-difference.
		denom = (l_right - 2.0 * best_lat + l_left)
		if abs(denom) > 1.0e-9:
			shift = 0.5 * h * (l_left - l_right) / denom
			if -h < shift < h:
				cand_t = best_t + shift
				cand_lat = _calc_lat(cand_t, pId, flag)
				if abs(cand_lat) > abs(best_lat):
					best_t = cand_t
					best_lat = cand_lat
		dt = h
		break

	return (t_prev, t_next, best_t, best_lat)


def _excentric_arc_of_planet(lat_p, lat_max_signed, tjd, t_max):
	"""Return Exc_p in [0, 360) along the excentric, given the planet's
	current latitude, the half-revolution max latitude (signed), and the
	timing relative to the latitude extremum.
	"""
	sin_i = math.sin(math.radians(abs(lat_max_signed)))
	if sin_i < 1.0e-12:
		return 0.0
	s = math.sin(math.radians(lat_p)) / sin_i
	if s > 1.0:
		s = 1.0
	elif s < -1.0:
		s = -1.0
	# arcsin of |s| in [0, 90]
	base = math.degrees(math.asin(abs(s)))
	if lat_max_signed > 0.0:
		# Northern half-revolution: Exc in (0, 180)
		exc = base if tjd <= t_max else (180.0 - base)
	else:
		# Southern half-revolution: Exc in (180, 360)
		exc = (180.0 + base) if tjd <= t_max else (360.0 - base)
	return exc


def project_from_excentric(exc_p, inclination_deg, asp_signed_deg):
	"""Project one aspect from Morin's excentric circle back to the ecliptic.

	Returns ``(delta_lon_deg, lat_aspect_deg)``. ``delta_lon_deg`` is added
	to the ordinary ecliptic aspect longitude ``lon_p + asp_signed_deg``.
	"""
	i_inc = abs(inclination_deg)
	if i_inc < 1.0e-9:
		return 0.0, 0.0

	sin_i = math.sin(math.radians(i_inc))
	cos_i = math.cos(math.radians(i_inc))
	exc_a = (exc_p + asp_signed_deg) % 360.0

	sin_p = math.sin(math.radians(exc_p))
	cos_p = math.cos(math.radians(exc_p))
	sin_a = math.sin(math.radians(exc_a))
	cos_a = math.cos(math.radians(exc_a))

	lat_a = math.degrees(math.asin(sin_a * sin_i))

	delta_p = math.degrees(math.atan2(sin_p * cos_i, cos_p))
	delta_a = math.degrees(math.atan2(sin_a * cos_i, cos_a))
	delta_lon = (delta_a - delta_p) - asp_signed_deg
	while delta_lon > 180.0:
		delta_lon -= 360.0
	while delta_lon <= -180.0:
		delta_lon += 360.0

	return delta_lon, lat_a


def aspect_correction(tjd_ut, pId, flag, lon_p, lat_p, asp_signed_deg, cache_key=None):
	"""Compute Morin's excentric correction for one aspect.

	Returns ``(delta_lon_deg, lat_aspect_deg)``.

	The corrected ecliptic position of the aspect terminus is
	``(lon_p + asp_signed_deg + delta_lon_deg, lat_aspect_deg)``.

	Returns ``(0.0, 0.0)`` for the Sun, for zero-latitude bodies, or when
	the surrounding apparent nodes can't be located.
	"""
	if abs(lat_p) < 1.0e-9 or pId == astrology.SE_SUN:
		return 0.0, 0.0

	key = (cache_key if cache_key is not None else round(tjd_ut, 4), pId)
	info = _cache.get(key)
	if info is None:
		info = _half_revolution(tjd_ut, pId, flag, lat_p)
		_cache[key] = info
	if info is None:
		return 0.0, 0.0

	t_prev, t_next, t_max, lat_max = info
	i_inc = abs(lat_max)
	if i_inc < 1.0e-9:
		return 0.0, 0.0

	exc_p = _excentric_arc_of_planet(lat_p, lat_max, tjd_ut, t_max)
	return project_from_excentric(exc_p, lat_max, asp_signed_deg)


def half_revolution_info(tjd_ut, pId, flag, lat_p, cache_key=None):
	"""Diagnostic helper: returns the cached half-revolution tuple
	``(t_prev_node, t_next_node, t_max, lat_max_signed)`` or None.
	"""
	if abs(lat_p) < 1.0e-9 or pId == astrology.SE_SUN:
		return None
	key = (cache_key if cache_key is not None else round(tjd_ut, 4), pId)
	info = _cache.get(key)
	if info is None:
		info = _half_revolution(tjd_ut, pId, flag, lat_p)
		_cache[key] = info
	return info
