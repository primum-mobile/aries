# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations
from functools import wraps
from typing import Iterable

import astrology

from .constants import (
	BISECTION_MAX_ITERS,
	DEDUP_EPS_DAYS,
	DEFAULT_EPS_DAYS,
	DEFAULT_EPS_DEG,
	HIT_LONGITUDE,
	HIT_STATION,
	LOW_SPEED_WARN,
	NEWTON_MAX_ITERS,
	STATION_SPEED_EPS,
	default_relative_step_days_for_bodies,
	default_step_days_for_planet,
)
from .normalize import crossed_zero, wrap180, wrap360


def _configure_ephemeris_context(
	ephe_path: str | None,
	sidereal_mode: int | None,
	topocentric_position: tuple[float, float, float] | None,
) -> None:
	if ephe_path:
		astrology.swe_set_ephe_path(ephe_path)
	if sidereal_mode is not None:
		astrology.swe_set_sid_mode(int(sidereal_mode), 0.0, 0.0)
	if topocentric_position is not None:
		astrology.swe_set_topo(*topocentric_position)


def _set_ephe_path(ephe_path: str | None) -> None:
	_configure_ephemeris_context(ephe_path, None, None)


def _atomic_ephemeris_call(function):
	@wraps(function)
	def wrapped(*args, **kwargs):
		with astrology.swiss_context(
			kwargs.get("ephe_path"),
			kwargs.get("sidereal_mode"),
			kwargs.get("topocentric_position"),
		):
			return function(*args, **kwargs)
	return wrapped


def _eval_lon_speed(jd_ut: float, planet: int, flags: int) -> tuple[float, float]:
	retflag, xx, serr = astrology.swe_calc_ut_ex(jd_ut, planet, flags | astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED)
	if len(xx) < 4:
		raise RuntimeError(f"Swiss Ephemeris returned no longitude data for planet={planet} jd={jd_ut}: {serr!r}")
	return float(xx[0]), float(xx[3])


def _eval_body_lon_speed(jd_ut: float, body_code: int, flags: int) -> tuple[float, float]:
	body = int(body_code)
	desc = False
	if body >= 1000:
		body -= 1000
		desc = True
	lon, speed = _eval_lon_speed(jd_ut, body, flags)
	if desc:
		lon = wrap360(lon + 180.0)
	return lon, speed


def _adaptive_step(base_step: float, speed: float, eps_days: float) -> float:
	abs_speed = abs(float(speed))
	step = float(base_step)
	if abs_speed <= LOW_SPEED_WARN:
		step *= 0.25
	elif abs_speed >= 2.0:
		step *= 1.5
	return max(step, max(eps_days * 64.0, 1e-4))


def _adaptive_station_step(base_step: float, speed: float, eps_days: float) -> float:
	abs_speed = abs(float(speed))
	step = float(base_step)
	if abs_speed <= STATION_SPEED_EPS * 100.0:
		step *= 0.1
	elif abs_speed <= LOW_SPEED_WARN:
		step *= 0.2
	elif abs_speed <= 1e-3:
		step *= 0.5
	elif abs_speed >= 2.0:
		step *= 1.25
	return max(step, max(eps_days * 64.0, 1e-4))


def _is_longitude_zero_crossing(f0: float, f1: float) -> bool:
	if not crossed_zero(f0, f1):
		return False
	return abs(float(f1) - float(f0)) < 180.0


def _is_relative_zero_crossing(f0: float, f1: float, eps_deg: float) -> bool:
	if abs(float(f0)) <= eps_deg or abs(float(f1)) <= eps_deg:
		return True
	if not crossed_zero(f0, f1):
		return False
	return abs(float(f1) - float(f0)) < 180.0


def _relative_delta(prom_lon: float, sig_lon: float, offset: float) -> float:
	target = float(sig_lon) + float(offset)
	if target < 0.0:
		target += 360.0
	elif target >= 360.0:
		target -= 360.0
	return wrap180(float(prom_lon) - target)


def _append_unique(raw_hits: list[tuple], hit: tuple) -> None:
	jd_ut = float(hit[0])
	for existing in raw_hits:
		if (
			abs(float(existing[0]) - jd_ut) < DEDUP_EPS_DAYS
			and int(existing[1]) == int(hit[1])
			and int(existing[4]) == int(hit[4])
			and abs(float(existing[2]) - float(hit[2])) < DEFAULT_EPS_DEG
			and abs(float(existing[3]) - float(hit[3])) < DEFAULT_EPS_DEG
		):
			return
	raw_hits.append(hit)


def _refine_station_root(
	planet: int,
	jd_lo: float,
	jd_hi: float,
	flags: int,
	*,
	eps_speed: float,
	eps_days: float,
) -> tuple[float, float]:
	lo = float(jd_lo)
	hi = float(jd_hi)
	_, slo = _eval_lon_speed(lo, planet, flags)
	_, shi = _eval_lon_speed(hi, planet, flags)
	return _refine_station_root_seeded(lo, slo, hi, shi, planet, flags, eps_speed=eps_speed, eps_days=eps_days)


def _refine_station_root_seeded(
	jd_lo: float,
	speed_lo: float,
	jd_hi: float,
	speed_hi: float,
	planet: int,
	flags: int,
	*,
	eps_speed: float,
	eps_days: float,
) -> tuple[float, float]:
	lo = float(jd_lo)
	hi = float(jd_hi)
	slo = float(speed_lo)
	shi = float(speed_hi)
	best_jd = lo if abs(slo) <= abs(shi) else hi
	best_speed = slo if abs(slo) <= abs(shi) else shi

	for _ in range(BISECTION_MAX_ITERS):
		if abs(best_speed) <= eps_speed or (hi - lo) <= eps_days:
			break
		if crossed_zero(slo, shi):
			mid = (lo + hi) * 0.5
		else:
			den = shi - slo
			mid = (lo + hi) * 0.5 if den == 0.0 else hi - shi * (hi - lo) / den
			if mid <= lo or mid >= hi:
				mid = (lo + hi) * 0.5
		_, smid = _eval_lon_speed(mid, planet, flags)
		if abs(smid) < abs(best_speed):
			best_jd = mid
			best_speed = smid
		if abs(smid) <= eps_speed:
			return mid, smid
		if crossed_zero(slo, smid):
			hi = mid
			shi = smid
		elif crossed_zero(smid, shi):
			lo = mid
			slo = smid
		elif abs(slo) <= abs(shi):
			hi = mid
			shi = smid
		else:
			lo = mid
			slo = smid

	return best_jd, best_speed


def _refine_longitude_root(
	planet: int,
	target_deg: float,
	jd_lo: float,
	jd_hi: float,
	flags: int,
	*,
	eps_deg: float,
	eps_days: float,
) -> tuple[float, float]:
	lo = float(jd_lo)
	hi = float(jd_hi)
	lon_lo, speed_lo = _eval_lon_speed(lo, planet, flags)
	lon_hi, speed_hi = _eval_lon_speed(hi, planet, flags)
	f_lo = wrap180(lon_lo - target_deg)
	f_hi = wrap180(lon_hi - target_deg)
	best_jd = lo if abs(f_lo) <= abs(f_hi) else hi
	best_err = f_lo if abs(f_lo) <= abs(f_hi) else f_hi
	best_speed = speed_lo if abs(f_lo) <= abs(f_hi) else speed_hi
	if abs(speed_lo) > STATION_SPEED_EPS:
		x = lo - (f_lo / speed_lo)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif abs(speed_hi) > STATION_SPEED_EPS:
		x = hi - (f_hi / speed_hi)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for _ in range(NEWTON_MAX_ITERS + BISECTION_MAX_ITERS):
		lon_x, speed_x = _eval_lon_speed(x, planet, flags)
		f_x = wrap180(lon_x - target_deg)
		if abs(f_x) < abs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if abs(f_x) <= eps_deg:
			return x, speed_x
		if (hi - lo) <= eps_days:
			break

		if crossed_zero(f_lo, f_x):
			hi = x
			f_hi = f_x
		elif crossed_zero(f_x, f_hi):
			lo = x
			f_lo = f_x
		elif abs(f_lo) <= abs(f_hi):
			hi = x
			f_hi = f_x
		else:
			lo = x
			f_lo = f_x

		use_newton = abs(speed_x) > STATION_SPEED_EPS
		if use_newton:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	return best_jd, best_speed


def _dedupe_and_sort(raw_hits: list[tuple]) -> list[tuple]:
	raw_hits.sort(key=lambda item: (float(item[0]), float(item[2]), float(item[3]), int(item[1]), int(item[4])))
	deduped: list[tuple] = []
	for hit in raw_hits:
		_append_unique(deduped, hit)
	return deduped


def _refine_relative_root(
	prom_code: int,
	sig_code: int,
	offset: float,
	jd_lo: float,
	jd_hi: float,
	flags: int,
	*,
	eps_deg: float,
	eps_days: float,
) -> tuple[float, float, float]:
	lo = float(jd_lo)
	hi = float(jd_hi)
	prom_lon_lo, prom_speed_lo = _eval_body_lon_speed(lo, prom_code, flags)
	sig_lon_lo, sig_speed_lo = _eval_body_lon_speed(lo, sig_code, flags)
	prom_lon_hi, prom_speed_hi = _eval_body_lon_speed(hi, prom_code, flags)
	sig_lon_hi, sig_speed_hi = _eval_body_lon_speed(hi, sig_code, flags)
	f_lo = _relative_delta(prom_lon_lo, sig_lon_lo, offset)
	f_hi = _relative_delta(prom_lon_hi, sig_lon_hi, offset)
	best_jd = lo if abs(f_lo) <= abs(f_hi) else hi
	best_err = f_lo if abs(f_lo) <= abs(f_hi) else f_hi
	best_speed = (prom_speed_lo - sig_speed_lo) if abs(f_lo) <= abs(f_hi) else (prom_speed_hi - sig_speed_hi)

	if abs(prom_speed_lo - sig_speed_lo) > STATION_SPEED_EPS:
		x = lo - (f_lo / (prom_speed_lo - sig_speed_lo))
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif abs(prom_speed_hi - sig_speed_hi) > STATION_SPEED_EPS:
		x = hi - (f_hi / (prom_speed_hi - sig_speed_hi))
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for _ in range(NEWTON_MAX_ITERS + BISECTION_MAX_ITERS):
		prom_lon_x, prom_speed_x = _eval_body_lon_speed(x, prom_code, flags)
		sig_lon_x, sig_speed_x = _eval_body_lon_speed(x, sig_code, flags)
		speed_x = prom_speed_x - sig_speed_x
		f_x = _relative_delta(prom_lon_x, sig_lon_x, offset)
		if abs(f_x) < abs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if abs(f_x) <= eps_deg:
			return x, speed_x, f_x
		if (hi - lo) <= eps_days:
			break
		if crossed_zero(f_lo, f_x):
			hi = x
			f_hi = f_x
		elif crossed_zero(f_x, f_hi):
			lo = x
			f_lo = f_x
		elif abs(f_lo) <= abs(f_hi):
			hi = x
			f_hi = f_x
		else:
			lo = x
			f_lo = f_x
		if abs(speed_x) > STATION_SPEED_EPS:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	return best_jd, best_speed, best_err


def _refine_relative_speed_turn(
	prom_code: int,
	sig_code: int,
	jd_lo: float,
	jd_hi: float,
	prom_state_lo: tuple[float, float],
	sig_state_lo: tuple[float, float],
	prom_state_hi: tuple[float, float],
	sig_state_hi: tuple[float, float],
	flags: int,
	*,
	eps_days: float,
) -> tuple[float, float, float, float, float]:
	"""Locate one bracketed relative-speed reversal to temporal precision."""
	lo = float(jd_lo)
	hi = float(jd_hi)
	prom_lon_lo, prom_speed_lo = map(float, prom_state_lo)
	sig_lon_lo, sig_speed_lo = map(float, sig_state_lo)
	prom_lon_hi, prom_speed_hi = map(float, prom_state_hi)
	sig_lon_hi, sig_speed_hi = map(float, sig_state_hi)
	rel_speed_lo = prom_speed_lo - sig_speed_lo
	rel_speed_hi = prom_speed_hi - sig_speed_hi
	if rel_speed_lo == 0.0:
		return lo, prom_lon_lo, prom_speed_lo, sig_lon_lo, sig_speed_lo
	if rel_speed_hi == 0.0:
		return hi, prom_lon_hi, prom_speed_hi, sig_lon_hi, sig_speed_hi
	if not crossed_zero(rel_speed_lo, rel_speed_hi):
		raise ValueError("relative-speed turn is not bracketed")

	den = rel_speed_hi - rel_speed_lo
	x = (lo + hi) * 0.5 if den == 0.0 else hi - rel_speed_hi * (hi - lo) / den
	if x <= lo or x >= hi:
		x = (lo + hi) * 0.5
	previous_x = lo
	previous_speed = rel_speed_lo
	for _ in range(BISECTION_MAX_ITERS):
		if (hi - lo) <= eps_days:
			break
		prom_lon_x, prom_speed_x = _eval_body_lon_speed(x, prom_code, flags)
		sig_lon_x, sig_speed_x = _eval_body_lon_speed(x, sig_code, flags)
		rel_speed_x = prom_speed_x - sig_speed_x
		if rel_speed_x == 0.0 or abs(x - previous_x) <= eps_days:
			return x, prom_lon_x, prom_speed_x, sig_lon_x, sig_speed_x
		if crossed_zero(rel_speed_lo, rel_speed_x):
			hi = x
			rel_speed_hi = rel_speed_x
		else:
			lo = x
			rel_speed_lo = rel_speed_x
		den = rel_speed_x - previous_speed
		x_next = x - rel_speed_x * (x - previous_x) / den if den != 0.0 else (lo + hi) * 0.5
		if x_next <= lo or x_next >= hi:
			bracket_den = rel_speed_hi - rel_speed_lo
			x_next = (lo + hi) * 0.5 if bracket_den == 0.0 else hi - rel_speed_hi * (hi - lo) / bracket_den
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		previous_x = x
		previous_speed = rel_speed_x
		x = x_next

	x = (lo + hi) * 0.5
	prom_lon_x, prom_speed_x = _eval_body_lon_speed(x, prom_code, flags)
	sig_lon_x, sig_speed_x = _eval_body_lon_speed(x, sig_code, flags)
	return x, prom_lon_x, prom_speed_x, sig_lon_x, sig_speed_x


def _validated_relative_segment_root(
	prom_code: int,
	sig_code: int,
	offset: float,
	jd_lo: float,
	jd_hi: float,
	prom_state_lo: tuple[float, float],
	sig_state_lo: tuple[float, float],
	prom_state_hi: tuple[float, float],
	sig_state_hi: tuple[float, float],
	flags: int,
	*,
	eps_deg: float,
	eps_days: float,
) -> tuple[float, float] | None:
	if jd_hi < jd_lo:
		return None
	delta_lo = _relative_delta(prom_state_lo[0], sig_state_lo[0], offset)
	delta_hi = _relative_delta(prom_state_hi[0], sig_state_hi[0], offset)
	if abs(delta_lo) <= eps_deg:
		return float(jd_lo), float(prom_state_lo[1]) - float(sig_state_lo[1])
	if abs(delta_hi) <= eps_deg:
		return float(jd_hi), float(prom_state_hi[1]) - float(sig_state_hi[1])
	if not _is_relative_zero_crossing(delta_lo, delta_hi, eps_deg):
		return None
	hit_jd, hit_speed, hit_residual = _refine_relative_root(
		prom_code,
		sig_code,
		offset,
		jd_lo,
		jd_hi,
		flags,
		eps_deg=eps_deg,
		eps_days=eps_days,
	)
	if abs(hit_residual) > eps_deg:
		return None
	return hit_jd, hit_speed


@_atomic_ephemeris_call
def search_station_times_raw(
	planet: int,
	jd_start: float,
	jd_end: float,
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	sidereal_mode: int | None = None,
	topocentric_position: tuple[float, float, float] | None = None,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_configure_ephemeris_context(ephe_path, sidereal_mode, topocentric_position)
	base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
	accept_speed = max(float(eps_speed) * 1000.0, 1e-6)
	jd = float(jd_start)
	lon0, speed0 = _eval_lon_speed(jd, planet, flags)
	raw_hits: list[tuple] = []

	while jd < jd_end:
		step = _adaptive_station_step(base_step, speed0, eps_days)
		jd_next = min(jd + step, float(jd_end))
		lon1, speed1 = _eval_lon_speed(jd_next, planet, flags)
		if abs(speed0) <= eps_speed or abs(speed1) <= eps_speed or crossed_zero(speed0, speed1) or abs(speed0) <= LOW_SPEED_WARN or abs(speed1) <= LOW_SPEED_WARN:
			hit_jd, hit_speed = _refine_station_root_seeded(jd, speed0, jd_next, speed1, planet, flags, eps_speed=eps_speed, eps_days=eps_days)
			if jd_start <= hit_jd <= jd_end and abs(hit_speed) <= accept_speed:
				_append_unique(raw_hits, (hit_jd, planet, 0.0, 0.0, HIT_STATION, hit_speed, hit_speed < 0.0))
		jd = jd_next
		lon0 = lon1
		speed0 = speed1

	return _dedupe_and_sort(raw_hits)


@_atomic_ephemeris_call
def search_longitude_transits_raw(
	planet: int,
	jd_start: float,
	jd_end: float,
	targets_deg: Iterable[float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	sidereal_mode: int | None = None,
	topocentric_position: tuple[float, float, float] | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_configure_ephemeris_context(ephe_path, sidereal_mode, topocentric_position)
	base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
	seen = set()
	unique_targets = []
	for target in targets_deg:
		value = wrap360(target)
		key = round(value, 12)
		if key in seen:
			continue
		seen.add(key)
		unique_targets.append(value)
	unique_targets.sort()
	raw_hits: list[tuple] = []
	if not unique_targets:
		return raw_hits

	jd = float(jd_start)
	lon0, speed0 = _eval_lon_speed(jd, planet, flags)
	f0_values = [wrap180(lon0 - target_deg) for target_deg in unique_targets]

	while jd < jd_end:
		step = _adaptive_step(base_step, speed0, eps_days)
		jd_next = min(jd + step, float(jd_end))
		lon1, speed1 = _eval_lon_speed(jd_next, planet, flags)

		station_jd = None
		station_speed = None
		station_lon = None
		if crossed_zero(speed0, speed1) or abs(speed0) <= LOW_SPEED_WARN or abs(speed1) <= LOW_SPEED_WARN:
			station_eps = 0.0 if crossed_zero(speed0, speed1) else STATION_SPEED_EPS
			station_jd, station_speed = _refine_station_root_seeded(jd, speed0, jd_next, speed1, planet, flags, eps_speed=station_eps, eps_days=eps_days)
			station_lon, station_speed = _eval_lon_speed(station_jd, planet, flags)

		next_f0_values = []
		for idx, target_deg in enumerate(unique_targets):
			f0 = f0_values[idx]
			f1 = wrap180(lon1 - target_deg)
			next_f0_values.append(f1)

			station_f = None
			if station_jd is not None:
				station_f = wrap180(station_lon - target_deg)
				if abs(station_f) <= eps_deg:
					_append_unique(raw_hits, (station_jd, planet, target_deg, 0.0, HIT_LONGITUDE, station_speed, station_speed < 0.0))
					continue

			segments = [(jd, f0, speed0, jd_next, f1, speed1)]
			if station_jd is not None and jd < station_jd < jd_next:
				segments = [
					(jd, f0, speed0, station_jd, station_f, station_speed),
					(station_jd, station_f, station_speed, jd_next, f1, speed1),
				]

			for seg_lo, seg_f0, seg_speed0, seg_hi, seg_f1, seg_speed1 in segments:
				if seg_lo == seg_hi:
					continue
				if abs(seg_f0) <= eps_deg:
					_append_unique(raw_hits, (seg_lo, planet, target_deg, 0.0, HIT_LONGITUDE, seg_speed0, seg_speed0 < 0.0))
					continue
				if abs(seg_f1) <= eps_deg:
					_append_unique(raw_hits, (seg_hi, planet, target_deg, 0.0, HIT_LONGITUDE, seg_speed1, seg_speed1 < 0.0))
					continue
				if _is_longitude_zero_crossing(seg_f0, seg_f1):
					hit_jd, hit_speed = _refine_longitude_root(planet, target_deg, seg_lo, seg_hi, flags, eps_deg=eps_deg, eps_days=eps_days)
					hit_lon, hit_speed = _eval_lon_speed(hit_jd, planet, flags)
					if jd_start <= hit_jd <= jd_end and abs(wrap180(hit_lon - target_deg)) <= eps_deg:
						_append_unique(raw_hits, (hit_jd, planet, target_deg, 0.0, HIT_LONGITUDE, hit_speed, hit_speed < 0.0))

		jd = jd_next
		f0_values = next_f0_values
		speed0 = speed1

	return _dedupe_and_sort(raw_hits)


@_atomic_ephemeris_call
def search_longitude_transits_batch_raw(
	planets: Iterable[int],
	jd_start: float,
	jd_end: float,
	targets_deg: Iterable[float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	sidereal_mode: int | None = None,
	topocentric_position: tuple[float, float, float] | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_configure_ephemeris_context(ephe_path, sidereal_mode, topocentric_position)
	raw_hits: list[tuple] = []
	for planet in planets:
		raw_hits.extend(
			search_longitude_transits_raw(
				int(planet),
				jd_start,
				jd_end,
				targets_deg,
				ephe_path=None,
				flags=flags,
				sidereal_mode=sidereal_mode,
				topocentric_position=topocentric_position,
				step_days=step_days,
				eps_deg=eps_deg,
				eps_days=eps_days,
			)
		)
	return _dedupe_and_sort(raw_hits)


@_atomic_ephemeris_call
def search_station_times_batch_raw(
	planets: Iterable[int],
	jd_start: float,
	jd_end: float,
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	sidereal_mode: int | None = None,
	topocentric_position: tuple[float, float, float] | None = None,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_configure_ephemeris_context(ephe_path, sidereal_mode, topocentric_position)
	raw_hits: list[tuple] = []
	for planet in planets:
		raw_hits.extend(
			search_station_times_raw(
				int(planet),
				jd_start,
				jd_end,
				ephe_path=None,
				flags=flags,
				sidereal_mode=sidereal_mode,
				topocentric_position=topocentric_position,
				step_days=step_days,
				eps_speed=eps_speed,
				eps_days=eps_days,
			)
		)
	return _dedupe_and_sort(raw_hits)


@_atomic_ephemeris_call
def search_relative_aspects_batch_raw(
	body_codes: Iterable[int],
	jd_start: float,
	jd_end: float,
	specs: Iterable[tuple[int, int, float]],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	sidereal_mode: int | None = None,
	topocentric_position: tuple[float, float, float] | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_configure_ephemeris_context(ephe_path, sidereal_mode, topocentric_position)
	body_codes = [int(code) for code in body_codes]
	specs = [(int(prom_idx), int(sig_idx), float(offset)) for prom_idx, sig_idx, offset in specs]
	if not body_codes or not specs:
		return []

	base_step = float(default_relative_step_days_for_bodies(body_codes, specs) if step_days is None else step_days)
	raw_hits: list[tuple] = []
	jd = float(jd_start)
	state0 = [_eval_body_lon_speed(jd, code, flags) for code in body_codes]
	while jd < jd_end:
		jd_next = min(jd + base_step, float(jd_end))
		state1 = [_eval_body_lon_speed(jd_next, code, flags) for code in body_codes]
		turn_cache: dict[tuple[int, int], tuple[float, float, float, float, float] | None] = {}
		for spec_idx, (prom_idx, sig_idx, offset) in enumerate(specs):
			prom_state0 = state0[prom_idx]
			sig_state0 = state0[sig_idx]
			prom_state1 = state1[prom_idx]
			sig_state1 = state1[sig_idx]
			pair_key = (prom_idx, sig_idx)
			if pair_key not in turn_cache:
				rel_speed0 = float(prom_state0[1]) - float(sig_state0[1])
				rel_speed1 = float(prom_state1[1]) - float(sig_state1[1])
				turn_cache[pair_key] = (
					_refine_relative_speed_turn(
						body_codes[prom_idx],
						body_codes[sig_idx],
						jd,
						jd_next,
						prom_state0,
						sig_state0,
						prom_state1,
						sig_state1,
						flags,
						eps_days=eps_days,
					)
					if (rel_speed0 < 0.0 < rel_speed1) or (rel_speed1 < 0.0 < rel_speed0)
					else None
				)

			turn = turn_cache[pair_key]
			segments = [(jd, jd_next, prom_state0, sig_state0, prom_state1, sig_state1)]
			if turn is not None:
				turn_jd, turn_prom_lon, turn_prom_speed, turn_sig_lon, turn_sig_speed = turn
				turn_prom_state = (turn_prom_lon, turn_prom_speed)
				turn_sig_state = (turn_sig_lon, turn_sig_speed)
				turn_residual = _relative_delta(turn_prom_lon, turn_sig_lon, offset)
				if abs(turn_residual) <= eps_deg:
					hit_speed = turn_prom_speed - turn_sig_speed
					_append_unique(raw_hits, (turn_jd, spec_idx, 0.0, 0.0, HIT_LONGITUDE, hit_speed, hit_speed < 0.0))
					continue
				segments = [
					(jd, turn_jd, prom_state0, sig_state0, turn_prom_state, turn_sig_state),
					(turn_jd, jd_next, turn_prom_state, turn_sig_state, prom_state1, sig_state1),
				]

			for seg_lo, seg_hi, seg_prom0, seg_sig0, seg_prom1, seg_sig1 in segments:
				hit = _validated_relative_segment_root(
					body_codes[prom_idx],
					body_codes[sig_idx],
					offset,
					seg_lo,
					seg_hi,
					seg_prom0,
					seg_sig0,
					seg_prom1,
					seg_sig1,
					flags,
					eps_deg=eps_deg,
					eps_days=eps_days,
				)
				if hit is None:
					continue
				hit_jd, hit_speed = hit
				_append_unique(raw_hits, (hit_jd, spec_idx, 0.0, 0.0, HIT_LONGITUDE, hit_speed, hit_speed < 0.0))
		jd = jd_next
		state0 = state1
	return _dedupe_and_sort(raw_hits)
