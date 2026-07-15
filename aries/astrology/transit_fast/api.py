# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from collections import defaultdict
import math

import astrology

from .constants import BODY_PERIOD_DAYS, DEFAULT_EPS_DAYS, DEFAULT_EPS_DEG, HIT_LONGITUDE, HIT_STATION, STATION_SPEED_EPS, default_relative_step_days_for_bodies, default_step_days_for_planet
from .models import TransitHit
from .normalize import wrap180, wrap360
from . import python_reference

try:
	from . import _transit_kernel as _kernel
except ImportError:
	_kernel = None


def _backend():
	return _kernel if _kernel is not None else python_reference


class _JumpSearchFallback(RuntimeError):
	pass


def _validate_range(jd_start: float, jd_end: float) -> None:
	if float(jd_end) <= float(jd_start):
		raise ValueError("jd_end must be greater than jd_start")


def _validate_targets(targets_deg: list[float]) -> list[float]:
	if not targets_deg:
		raise ValueError("targets_deg must not be empty")
	seen = set()
	normalized = []
	for value in targets_deg:
		target = wrap360(value)
		key = round(target, 12)
		if key in seen:
			continue
		seen.add(key)
		normalized.append(target)
	return normalized


def _validate_planets(planets: list[int]) -> list[int]:
	if not planets:
		raise ValueError("planets must not be empty")
	seen = set()
	normalized = []
	for value in planets:
		planet = int(value)
		if planet in seen:
			continue
		seen.add(planet)
		normalized.append(planet)
	return normalized


def _materialize_hits(raw_hits: list[tuple], *, target_override: float | None = None, aspect_override: float | None = None) -> list[TransitHit]:
	hits = []
	for jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde in raw_hits:
		hits.append(
			TransitHit(
				jd_ut=float(jd_ut),
				planet=int(planet),
				target_deg=float(target_deg if target_override is None else target_override),
				aspect_deg=float(aspect_deg if aspect_override is None else aspect_override),
				hit_type="longitude" if int(hit_kind) == HIT_LONGITUDE else "station",
				speed=float(speed),
				retrograde=bool(retrograde),
				pass_index=0,
			)
	)
	return _assign_pass_indexes(_dedupe_hits(hits))


def _refine_longitude_hit_window(
	planet: int,
	jd_ut: float,
	target_deg: float,
	*,
	flags: int,
	step_days: float | None,
	eps_deg: float,
	eps_days: float,
) -> tuple[float, float] | None:
	if _backend() is not _kernel or _kernel is None:
		return None
	if int(planet) in (astrology.SE_SUN, astrology.SE_MOON):
		return None

	base_step = float(default_step_days_for_planet(int(planet)) if step_days is None else step_days)
	half_window = max(min(base_step / 8.0, 0.25), 1.0 / 1440.0)
	max_half_window = max(base_step, 0.5)
	target = wrap360(float(target_deg))
	jd_center = float(jd_ut)

	while half_window <= max_half_window + float(eps_days):
		lo = jd_center - half_window
		hi = jd_center + half_window
		lon_lo, _speed_lo = python_reference._eval_lon_speed(lo, int(planet), int(flags))
		lon_hi, _speed_hi = python_reference._eval_lon_speed(hi, int(planet), int(flags))
		f_lo = wrap180(lon_lo - target)
		f_hi = wrap180(lon_hi - target)
		if abs(f_lo) <= float(eps_deg) or abs(f_hi) <= float(eps_deg) or python_reference._is_longitude_zero_crossing(f_lo, f_hi):
			return python_reference._refine_longitude_root(
				int(planet),
				target,
				lo,
				hi,
				int(flags),
				eps_deg=float(eps_deg),
				eps_days=float(eps_days),
			)
		half_window *= 2.0

	return None


def _post_refine_longitude_raw_hits(
	raw_hits: list[tuple],
	*,
	flags: int,
	step_days: float | None,
	eps_deg: float,
	eps_days: float,
) -> list[tuple]:
	if _backend() is not _kernel or _kernel is None:
		return raw_hits

	refined = []
	for jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde in raw_hits:
		if int(hit_kind) != HIT_LONGITUDE:
			refined.append((jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde))
			continue
		refined_hit = _refine_longitude_hit_window(
			int(planet),
			float(jd_ut),
			float(target_deg),
			flags=int(flags),
			step_days=step_days,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
		)
		if refined_hit is None:
			refined.append((jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde))
			continue
		refined_jd, refined_speed = refined_hit
		refined.append((
			float(refined_jd),
			int(planet),
			float(target_deg),
			float(aspect_deg),
			int(hit_kind),
			float(refined_speed),
			bool(refined_speed < 0.0),
		))
	return refined


def _dedupe_hits(hits: list[TransitHit]) -> list[TransitHit]:
	deduped: list[TransitHit] = []
	seen: set[tuple[float, int, float, float, str]] = set()
	for hit in hits:
		key = (
			round(float(hit.jd_ut), 7),
			int(hit.planet),
			round(float(hit.target_deg), 8),
			round(float(hit.aspect_deg), 8),
			hit.hit_type,
		)
		if key in seen:
			continue
		seen.add(key)
		deduped.append(hit)
	return deduped


def _assign_pass_indexes(hits: list[TransitHit]) -> list[TransitHit]:
	hits.sort(key=lambda item: (item.jd_ut, item.target_deg, item.aspect_deg, item.planet, item.hit_type))
	counters = defaultdict(lambda: 1)
	for hit in hits:
		key = (hit.planet, hit.target_deg, hit.aspect_deg, hit.hit_type)
		hit.pass_index = counters[key]
		counters[key] += 1
	return hits


def _expand_effective_targets(target_deg: float, aspect_deg: float) -> list[tuple[float, float]]:
	aspect = float(aspect_deg)
	target = wrap360(target_deg)
	if aspect == 0.0 or abs(aspect) == 180.0:
		return [(wrap360(target + aspect), aspect)]
	abs_aspect = abs(aspect)
	return [
		(wrap360(target + abs_aspect), abs_aspect),
		(wrap360(target - abs_aspect), -abs_aspect),
	]


def _dedupe_relative_raw_hits(raw_hits: list[tuple]) -> list[tuple]:
	deduped = []
	seen = set()
	for jd_ut, spec_idx, target_deg, aspect_deg, hit_kind, speed, retrograde in sorted(
		raw_hits,
		key=lambda item: (float(item[0]), int(item[1]), float(item[2]), float(item[3]), int(item[4])),
	):
		key = (
			round(float(jd_ut), 7),
			int(spec_idx),
			round(float(target_deg), 8),
			round(float(aspect_deg), 8),
			int(hit_kind),
		)
		if key in seen:
			continue
		seen.add(key)
		deduped.append((jd_ut, spec_idx, target_deg, aspect_deg, hit_kind, speed, retrograde))
	return deduped


def _normalize_body_code(body_code: int) -> int:
	body_code = int(body_code)
	if body_code >= 1000:
		body_code -= 1000
	return body_code


def _is_slow_body(body_code: int) -> bool:
	return default_step_days_for_planet(_normalize_body_code(body_code)) >= 2.0


def _qualifies_for_jump_conjunction(body_codes: list[int], spec: tuple[int, int, float]) -> bool:
	prom_idx, sig_idx, offset = spec
	if float(offset) != 0.0:
		return False
	prom_code = int(body_codes[int(prom_idx)])
	sig_code = int(body_codes[int(sig_idx)])
	if prom_code >= 1000 or sig_code >= 1000:
		return False
	if not (_is_slow_body(prom_code) and _is_slow_body(sig_code)):
		return False
	prom_period = BODY_PERIOD_DAYS.get(_normalize_body_code(prom_code))
	sig_period = BODY_PERIOD_DAYS.get(_normalize_body_code(sig_code))
	return prom_period is not None and sig_period is not None and prom_code != sig_code


def _relative_period_days(prom_code: int, sig_code: int) -> float | None:
	prom_period = BODY_PERIOD_DAYS.get(_normalize_body_code(prom_code))
	sig_period = BODY_PERIOD_DAYS.get(_normalize_body_code(sig_code))
	if prom_period is None or sig_period is None:
		return None
	rate = abs((1.0 / float(prom_period)) - (1.0 / float(sig_period)))
	if rate <= 0.0:
		return None
	return 1.0 / rate


def _relative_rate_deg_per_day(prom_code: int, sig_code: int) -> float | None:
	prom_period = BODY_PERIOD_DAYS.get(_normalize_body_code(prom_code))
	sig_period = BODY_PERIOD_DAYS.get(_normalize_body_code(sig_code))
	if prom_period is None or sig_period is None:
		return None
	return (360.0 / float(prom_period)) - (360.0 / float(sig_period))


def _jump_window_half_days(prom_code: int, sig_code: int, synodic_days: float) -> float:
	base = max(
		120.0,
		max(default_step_days_for_planet(_normalize_body_code(prom_code)), default_step_days_for_planet(_normalize_body_code(sig_code))) * 200.0,
	)
	return min(base, float(synodic_days) / 4.0)


def _estimate_candidate_anchor_jd(prom_code: int, sig_code: int, offset: float, jd_start: float, flags: int, ephe_path: str | None) -> float:
	python_reference._set_ephe_path(ephe_path)
	prom_lon, _prom_speed = python_reference._eval_body_lon_speed(float(jd_start), int(prom_code), int(flags))
	sig_lon, _sig_speed = python_reference._eval_body_lon_speed(float(jd_start), int(sig_code), int(flags))
	delta = python_reference._relative_delta(prom_lon, sig_lon, float(offset))
	rate = _relative_rate_deg_per_day(prom_code, sig_code)
	if rate is None or abs(rate) < 1e-12:
		raise _JumpSearchFallback("relative rate unavailable")
	return float(jd_start) - (float(delta) / float(rate))


def _candidate_centers(anchor_jd: float, synodic_days: float, jd_start: float, jd_end: float, half_window_days: float) -> list[float]:
	first_k = int(math.floor(((float(jd_start) - float(half_window_days)) - float(anchor_jd)) / float(synodic_days))) - 1
	last_k = int(math.ceil(((float(jd_end) + float(half_window_days)) - float(anchor_jd)) / float(synodic_days))) + 1
	return [float(anchor_jd) + float(k) * float(synodic_days) for k in range(first_k, last_k + 1)]


def _candidate_center_is_safe(prom_code: int, sig_code: int, offset: float, center_jd: float, flags: int, ephe_path: str | None, half_window_days: float) -> bool:
	python_reference._set_ephe_path(ephe_path)
	prom_lon, _prom_speed = python_reference._eval_body_lon_speed(float(center_jd), int(prom_code), int(flags))
	sig_lon, _sig_speed = python_reference._eval_body_lon_speed(float(center_jd), int(sig_code), int(flags))
	delta = abs(python_reference._relative_delta(prom_lon, sig_lon, float(offset)))
	rate = abs(_relative_rate_deg_per_day(prom_code, sig_code) or 0.0)
	max_expected_delta = max(10.0, float(half_window_days) * max(rate, 1e-6) * 1.5)
	return delta <= max_expected_delta


def _search_relative_aspect_jump_raw(
	body_codes: list[int],
	jd_start: float,
	jd_end: float,
	spec: tuple[int, int, float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	prom_idx, sig_idx, offset = (int(spec[0]), int(spec[1]), float(spec[2]))
	prom_code = int(body_codes[prom_idx])
	sig_code = int(body_codes[sig_idx])
	synodic_days = _relative_period_days(prom_code, sig_code)
	if synodic_days is None:
		raise _JumpSearchFallback("synodic period unavailable")
	half_window_days = _jump_window_half_days(prom_code, sig_code, synodic_days)
	anchor_jd = _estimate_candidate_anchor_jd(prom_code, sig_code, offset, jd_start, flags, ephe_path)
	centers = _candidate_centers(anchor_jd, synodic_days, jd_start, jd_end, half_window_days)
	if not centers:
		return []
	raw_hits = []
	search_step = default_relative_step_days_for_bodies(body_codes, [(prom_idx, sig_idx, offset)]) if step_days is None else step_days
	for center_jd in centers:
		if not _candidate_center_is_safe(prom_code, sig_code, offset, center_jd, flags, ephe_path, half_window_days):
			raise _JumpSearchFallback("candidate center drifted too far")
		window_start = max(float(jd_start), float(center_jd) - float(half_window_days))
		window_end = min(float(jd_end), float(center_jd) + float(half_window_days))
		if window_end <= window_start:
			continue
		window_hits = _backend().search_relative_aspects_batch_raw(
			body_codes,
			window_start,
			window_end,
			[(prom_idx, sig_idx, offset)],
			ephe_path=ephe_path,
			flags=int(flags),
			step_days=search_step,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
		)
		for hit in window_hits:
			if float(hit[0]) < window_start - float(eps_days) or float(hit[0]) > window_end + float(eps_days):
				raise _JumpSearchFallback("refined hit escaped candidate window")
		raw_hits.extend(window_hits)
	if not raw_hits:
		raise _JumpSearchFallback("jump windows produced no hits")
	return _dedupe_relative_raw_hits(raw_hits)


def search_longitude_transits(
	planet: int,
	jd_start: float,
	jd_end: float,
	targets_deg: list[float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	targets = _validate_targets(targets_deg)
	raw_hits = _backend().search_longitude_transits_raw(
		int(planet),
		float(jd_start),
		float(jd_end),
		targets,
		ephe_path=ephe_path,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	raw_hits = _post_refine_longitude_raw_hits(
		raw_hits,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	return _materialize_hits(raw_hits)


def search_station_times(
	planet: int,
	jd_start: float,
	jd_end: float,
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	raw_hits = _backend().search_station_times_raw(
		int(planet),
		float(jd_start),
		float(jd_end),
		ephe_path=ephe_path,
		flags=int(flags),
		step_days=step_days,
		eps_speed=float(eps_speed),
		eps_days=float(eps_days),
	)
	return _materialize_hits(raw_hits)


def search_longitude_transits_batch(
	planets: list[int],
	jd_start: float,
	jd_end: float,
	targets_deg: list[float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	planet_ids = _validate_planets(planets)
	targets = _validate_targets(targets_deg)
	raw_hits = _backend().search_longitude_transits_batch_raw(
		planet_ids,
		float(jd_start),
		float(jd_end),
		targets,
		ephe_path=ephe_path,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	raw_hits = _post_refine_longitude_raw_hits(
		raw_hits,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	return _materialize_hits(raw_hits)


def search_longitude_transits_batch_raw(
	planets: list[int],
	jd_start: float,
	jd_end: float,
	targets_deg: list[float],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_validate_range(jd_start, jd_end)
	planet_ids = _validate_planets(planets)
	targets = _validate_targets(targets_deg)
	raw_hits = _backend().search_longitude_transits_batch_raw(
		planet_ids,
		float(jd_start),
		float(jd_end),
		targets,
		ephe_path=ephe_path,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	return _post_refine_longitude_raw_hits(
		raw_hits,
		flags=int(flags),
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)


def search_relative_aspects_batch_raw(
	body_codes: list[int],
	jd_start: float,
	jd_end: float,
	specs: list[tuple[int, int, float]],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_validate_range(jd_start, jd_end)
	if not body_codes:
		raise ValueError("body_codes must not be empty")
	if not specs:
		return []
	normalized_codes = [int(value) for value in body_codes]
	normalized_specs = [(int(prom_idx), int(sig_idx), float(offset)) for prom_idx, sig_idx, offset in specs]
	if step_days is not None:
		return _backend().search_relative_aspects_batch_raw(
			normalized_codes,
			float(jd_start),
			float(jd_end),
			normalized_specs,
			ephe_path=ephe_path,
			flags=int(flags),
			step_days=step_days,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
		)

	raw_hits = []
	fallback_specs = []
	fallback_index_map = []
	for spec_idx, spec in enumerate(normalized_specs):
		if not _qualifies_for_jump_conjunction(normalized_codes, spec):
			fallback_index_map.append(spec_idx)
			fallback_specs.append(spec)
			continue
		try:
			jump_hits = _search_relative_aspect_jump_raw(
				normalized_codes,
				float(jd_start),
				float(jd_end),
				spec,
				ephe_path=ephe_path,
				flags=int(flags),
				step_days=None,
				eps_deg=float(eps_deg),
				eps_days=float(eps_days),
			)
			raw_hits.extend((hit[0], spec_idx, hit[2], hit[3], hit[4], hit[5], hit[6]) for hit in jump_hits)
		except _JumpSearchFallback:
			fallback_index_map.append(spec_idx)
			fallback_specs.append(spec)

	if fallback_specs:
		fallback_step = default_relative_step_days_for_bodies(normalized_codes, fallback_specs)
		fallback_hits = _backend().search_relative_aspects_batch_raw(
			normalized_codes,
			float(jd_start),
			float(jd_end),
			fallback_specs,
			ephe_path=ephe_path,
			flags=int(flags),
			step_days=fallback_step,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
		)
		for hit in fallback_hits:
			mapped_idx = fallback_index_map[int(hit[1])]
			raw_hits.append((hit[0], mapped_idx, hit[2], hit[3], hit[4], hit[5], hit[6]))

	return _dedupe_relative_raw_hits(raw_hits)


def search_station_times_batch(
	planets: list[int],
	jd_start: float,
	jd_end: float,
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	planet_ids = _validate_planets(planets)
	raw_hits = _backend().search_station_times_batch_raw(
		planet_ids,
		float(jd_start),
		float(jd_end),
		ephe_path=ephe_path,
		flags=int(flags),
		step_days=step_days,
		eps_speed=float(eps_speed),
		eps_days=float(eps_days),
	)
	return _materialize_hits(raw_hits)


def search_year_transits(
	planet: int,
	year_start_jd: float,
	year_end_jd: float,
	targets_deg: list[float],
	aspects_deg: list[float] = [0.0],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
) -> list[TransitHit]:
	_validate_range(year_start_jd, year_end_jd)
	targets = _validate_targets(targets_deg)
	if not aspects_deg:
		raise ValueError("aspects_deg must not be empty")

	effective_targets: list[float] = []
	effective_map: dict[float, list[tuple[float, float]]] = defaultdict(list)
	for target_deg in targets:
		for aspect_deg in aspects_deg:
			for effective_target, signed_aspect in _expand_effective_targets(target_deg, aspect_deg):
				key = round(effective_target, 12)
				if key not in effective_map:
					effective_targets.append(effective_target)
				effective_map[key].append((target_deg, signed_aspect))
	raw_hits = _backend().search_longitude_transits_raw(
		int(planet),
		float(year_start_jd),
		float(year_end_jd),
		effective_targets,
		ephe_path=ephe_path,
		flags=int(flags),
	)
	all_hits: list[TransitHit] = []
	for jd_ut, hit_planet, effective_target, _aspect_deg, hit_kind, speed, retrograde in raw_hits:
		for target_deg, signed_aspect in effective_map[round(float(effective_target), 12)]:
			all_hits.append(
				TransitHit(
					jd_ut=float(jd_ut),
					planet=int(hit_planet),
					target_deg=float(target_deg),
					aspect_deg=float(signed_aspect),
					hit_type="longitude" if int(hit_kind) == HIT_LONGITUDE else "station",
					speed=float(speed),
					retrograde=bool(retrograde),
					pass_index=0,
				)
			)
	return _assign_pass_indexes(_dedupe_hits(all_hits))


def search_year_transits_batch(
	planets: list[int],
	year_start_jd: float,
	year_end_jd: float,
	targets_deg: list[float],
	aspects_deg: list[float] = [0.0],
	*,
	ephe_path: str | None = None,
	flags: int = 0,
) -> list[TransitHit]:
	_validate_range(year_start_jd, year_end_jd)
	planet_ids = _validate_planets(planets)
	targets = _validate_targets(targets_deg)
	if not aspects_deg:
		raise ValueError("aspects_deg must not be empty")

	effective_targets: list[float] = []
	effective_map: dict[float, list[tuple[float, float]]] = defaultdict(list)
	for target_deg in targets:
		for aspect_deg in aspects_deg:
			for effective_target, signed_aspect in _expand_effective_targets(target_deg, aspect_deg):
				key = round(effective_target, 12)
				if key not in effective_map:
					effective_targets.append(effective_target)
				effective_map[key].append((target_deg, signed_aspect))
	raw_hits = _backend().search_longitude_transits_batch_raw(
		planet_ids,
		float(year_start_jd),
		float(year_end_jd),
		effective_targets,
		ephe_path=ephe_path,
		flags=int(flags),
	)
	all_hits: list[TransitHit] = []
	for jd_ut, hit_planet, effective_target, _aspect_deg, hit_kind, speed, retrograde in raw_hits:
		for target_deg, signed_aspect in effective_map[round(float(effective_target), 12)]:
			all_hits.append(
				TransitHit(
					jd_ut=float(jd_ut),
					planet=int(hit_planet),
					target_deg=float(target_deg),
					aspect_deg=float(signed_aspect),
					hit_type="longitude" if int(hit_kind) == HIT_LONGITUDE else "station",
					speed=float(speed),
					retrograde=bool(retrograde),
					pass_index=0,
				)
			)
	return _assign_pass_indexes(_dedupe_hits(all_hits))
