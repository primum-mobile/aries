# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from collections import defaultdict
import inspect
import math
import sys
import time

import astrology

from aries.astrology.ephemeris_context import EphemerisContext, resolve_ephemeris_context

from .constants import BODY_PERIOD_DAYS, DEDUP_EPS_DAYS, DEFAULT_EPS_DAYS, DEFAULT_EPS_DEG, HIT_LONGITUDE, HIT_STATION, STATION_SPEED_EPS, default_relative_step_days_for_bodies, default_step_days_for_planet
from .models import TransitHit
from .normalize import wrap180, wrap360
from . import python_reference

try:
	from . import _transit_kernel as _kernel
except ImportError as exc:
	if getattr(sys, "frozen", False):
		raise ImportError("Packaged Aries requires the native transit kernel") from exc
	_kernel = None


_NATIVE_CONTEXT_METHODS = (
	"search_longitude_transits_raw",
	"search_longitude_transits_batch_raw",
	"search_relative_aspects_batch_raw",
	"search_station_times_raw",
	"search_station_times_batch_raw",
)
_NATIVE_CONTEXT_PARAMETERS = frozenset(("sidereal_mode", "topocentric_position"))
# Match the kernel's native Swiss lock slice so the Python context lock never
# widens an already-bounded native span back into one whole Search request.
_NATIVE_CONTEXT_SPAN_DAYS = 14.0


def _native_backend_compatibility_error(kernel) -> str | None:
	if kernel is None:
		return "Native transit kernel is unavailable"
	for method_name in _NATIVE_CONTEXT_METHODS:
		method = getattr(kernel, method_name, None)
		if method is None:
			return f"Native transit kernel is missing {method_name}()"
		try:
			parameters = inspect.signature(method).parameters
		except (TypeError, ValueError):
			return f"Native transit kernel signature is unavailable for {method_name}()"
		missing = sorted(_NATIVE_CONTEXT_PARAMETERS.difference(parameters))
		if missing:
			return (
				f"Native transit kernel ABI mismatch for {method_name}(): "
				f"missing {', '.join(missing)}; rebuild Aries with make run"
			)
	return None


_NATIVE_BACKEND_ERROR = _native_backend_compatibility_error(_kernel)


def native_backend_available() -> bool:
	return _kernel is not None and _NATIVE_BACKEND_ERROR is None


def native_backend_error() -> str:
	return _NATIVE_BACKEND_ERROR or ""


def _backend(context: EphemerisContext | None = None):
	if _NATIVE_BACKEND_ERROR is not None and _kernel is not None:
		raise RuntimeError(_NATIVE_BACKEND_ERROR)
	if _kernel is None:
		return python_reference
	if context is not None and not context.is_native_compatible:
		return python_reference
	return _kernel


class _JumpSearchFallback(RuntimeError):
	pass


def _resolve_context(
	context: EphemerisContext | None,
	*,
	ephe_path: str | None,
	flags: int,
) -> EphemerisContext:
	return resolve_ephemeris_context(context, ephe_path=ephe_path, flags=flags)


def _backend_context_kwargs(context: EphemerisContext) -> dict:
	return {
		"ephe_path": context.ephe_path,
		"flags": context.flags,
		"sidereal_mode": context.sidereal_mode,
		"topocentric_position": context.topocentric_position,
	}


def _sort_and_dedupe_raw_hits(raw_hits: list[tuple]) -> list[tuple]:
	raw_hits.sort(key=lambda item: (item[0], item[2], item[3], item[1], item[4]))
	deduped: list[tuple] = []
	for hit in raw_hits:
		hit_jd = float(hit[0])
		is_duplicate = False
		for previous in reversed(deduped):
			if hit_jd - float(previous[0]) >= DEDUP_EPS_DAYS:
				break
			if (
				int(previous[1]) == int(hit[1])
				and int(previous[4]) == int(hit[4])
				and abs(float(previous[2]) - float(hit[2])) < DEFAULT_EPS_DEG
				and abs(float(previous[3]) - float(hit[3])) < DEFAULT_EPS_DEG
			):
				is_duplicate = True
				break
		if not is_duplicate:
			deduped.append(hit)
	return deduped


def _call_native_backend_in_spans(
	context: EphemerisContext,
	method,
	*args,
	**kwargs,
):
	"""Keep native Swiss work atomic only for one bounded kernel span."""
	if len(args) < 3:
		with context.activate():
			return method(*args, **kwargs)

	jd_start = float(args[1])
	jd_end = float(args[2])
	if jd_end - jd_start <= _NATIVE_CONTEXT_SPAN_DAYS:
		with context.activate():
			return method(*args, **kwargs)

	raw_hits: list[tuple] = []
	span_start = jd_start
	while span_start < jd_end:
		span_end = min(jd_end, span_start + _NATIVE_CONTEXT_SPAN_DAYS)
		span_args = list(args)
		span_args[1] = span_start
		span_args[2] = span_end
		with context.activate():
			raw_hits.extend(method(*span_args, **kwargs))
		span_start = span_end
		if span_start < jd_end:
			# Give an already-waiting interactive chart calculation the next
			# chance at the process-global Swiss context.
			time.sleep(0)
	return _sort_and_dedupe_raw_hits(raw_hits)


def _call_backend(context: EphemerisContext, method_name: str, *args, **kwargs):
	backend = _backend(context)
	method = getattr(backend, method_name)
	if backend is not python_reference:
		return _call_native_backend_in_spans(context, method, *args, **kwargs)
	with context.activate():
		return method(*args, **kwargs)


def _validate_range(jd_start: float, jd_end: float) -> None:
	start = float(jd_start)
	end = float(jd_end)
	if not math.isfinite(start) or not math.isfinite(end):
		raise ValueError("Julian-day bounds must be finite")
	if end <= start:
		raise ValueError("jd_end must be greater than jd_start")


def _validate_positive(value: float, name: str) -> float:
	normalized = float(value)
	if not math.isfinite(normalized) or normalized <= 0.0:
		raise ValueError(f"{name} must be finite and greater than zero")
	return normalized


def _validate_optional_step(step_days: float | None) -> float | None:
	if step_days is None:
		return None
	return _validate_positive(step_days, "step_days")


def _validate_targets(targets_deg: list[float]) -> list[float]:
	if not targets_deg:
		raise ValueError("targets_deg must not be empty")
	seen = set()
	normalized = []
	for value in targets_deg:
		value = float(value)
		if not math.isfinite(value):
			raise ValueError("targets_deg values must be finite")
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
	context: EphemerisContext,
	step_days: float | None,
	eps_deg: float,
	eps_days: float,
) -> tuple[float, float] | None:
	if _backend(context) is not _kernel or _kernel is None:
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
		lon_lo, _speed_lo = python_reference._eval_lon_speed(lo, int(planet), context.flags)
		lon_hi, _speed_hi = python_reference._eval_lon_speed(hi, int(planet), context.flags)
		f_lo = wrap180(lon_lo - target)
		f_hi = wrap180(lon_hi - target)
		if abs(f_lo) <= float(eps_deg) or abs(f_hi) <= float(eps_deg) or python_reference._is_longitude_zero_crossing(f_lo, f_hi):
			return python_reference._refine_longitude_root(
				int(planet),
				target,
				lo,
				hi,
				context.flags,
				eps_deg=float(eps_deg),
				eps_days=float(eps_days),
			)
		half_window *= 2.0

	return None


def _post_refine_longitude_raw_hits(
	raw_hits: list[tuple],
	*,
	context: EphemerisContext,
	step_days: float | None,
	eps_deg: float,
	eps_days: float,
) -> list[tuple]:
	if _backend(context) is not _kernel or _kernel is None:
		return raw_hits
	refined: list[tuple] = []
	last_index = len(raw_hits) - 1
	for index, hit in enumerate(raw_hits):
		if int(hit[4]) != HIT_LONGITUDE or int(hit[1]) in (astrology.SE_SUN, astrology.SE_MOON):
			refined.append(hit)
			continue
		with context.activate():
			refined.extend(
				_post_refine_longitude_raw_hits_active(
					[hit],
					context=context,
					step_days=step_days,
					eps_deg=eps_deg,
					eps_days=eps_days,
				)
			)
		if index < last_index:
			time.sleep(0)
	return refined


def _post_refine_longitude_raw_hits_active(
	raw_hits: list[tuple],
	*,
	context: EphemerisContext,
	step_days: float | None,
	eps_deg: float,
	eps_days: float,
) -> list[tuple]:

	refined = []
	for jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde in raw_hits:
		if int(hit_kind) != HIT_LONGITUDE:
			refined.append((jd_ut, planet, target_deg, aspect_deg, hit_kind, speed, retrograde))
			continue
		refined_hit = _refine_longitude_hit_window(
			int(planet),
			float(jd_ut),
			float(target_deg),
			context=context,
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


def _estimate_candidate_anchor_jd(
	prom_code: int,
	sig_code: int,
	offset: float,
	jd_start: float,
	context: EphemerisContext,
) -> float:
	with context.activate():
		prom_lon, _prom_speed = python_reference._eval_body_lon_speed(float(jd_start), int(prom_code), context.flags)
		sig_lon, _sig_speed = python_reference._eval_body_lon_speed(float(jd_start), int(sig_code), context.flags)
	delta = python_reference._relative_delta(prom_lon, sig_lon, float(offset))
	rate = _relative_rate_deg_per_day(prom_code, sig_code)
	if rate is None or abs(rate) < 1e-12:
		raise _JumpSearchFallback("relative rate unavailable")
	return float(jd_start) - (float(delta) / float(rate))


def _candidate_centers(anchor_jd: float, synodic_days: float, jd_start: float, jd_end: float, half_window_days: float) -> list[float]:
	first_k = int(math.floor(((float(jd_start) - float(half_window_days)) - float(anchor_jd)) / float(synodic_days))) - 1
	last_k = int(math.ceil(((float(jd_end) + float(half_window_days)) - float(anchor_jd)) / float(synodic_days))) + 1
	return [float(anchor_jd) + float(k) * float(synodic_days) for k in range(first_k, last_k + 1)]


def _candidate_center_is_safe(
	prom_code: int,
	sig_code: int,
	offset: float,
	center_jd: float,
	context: EphemerisContext,
	half_window_days: float,
) -> bool:
	with context.activate():
		prom_lon, _prom_speed = python_reference._eval_body_lon_speed(float(center_jd), int(prom_code), context.flags)
		sig_lon, _sig_speed = python_reference._eval_body_lon_speed(float(center_jd), int(sig_code), context.flags)
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
	context: EphemerisContext,
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
	anchor_jd = _estimate_candidate_anchor_jd(prom_code, sig_code, offset, jd_start, context)
	centers = _candidate_centers(anchor_jd, synodic_days, jd_start, jd_end, half_window_days)
	if not centers:
		return []
	raw_hits = []
	search_step = default_relative_step_days_for_bodies(body_codes, [(prom_idx, sig_idx, offset)]) if step_days is None else step_days
	for center_jd in centers:
		if not _candidate_center_is_safe(prom_code, sig_code, offset, center_jd, context, half_window_days):
			raise _JumpSearchFallback("candidate center drifted too far")
		window_start = max(float(jd_start), float(center_jd) - float(half_window_days))
		window_end = min(float(jd_end), float(center_jd) + float(half_window_days))
		if window_end <= window_start:
			continue
		window_hits = _call_backend(
			context,
			"search_relative_aspects_batch_raw",
			body_codes,
			window_start,
			window_end,
			[(prom_idx, sig_idx, offset)],
			step_days=search_step,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
			**_backend_context_kwargs(context),
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
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	targets = _validate_targets(targets_deg)
	step_days = _validate_optional_step(step_days)
	eps_deg = _validate_positive(eps_deg, "eps_deg")
	eps_days = _validate_positive(eps_days, "eps_days")
	raw_hits = _call_backend(
		context,
		"search_longitude_transits_raw",
		int(planet),
		float(jd_start),
		float(jd_end),
		targets,
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
		**_backend_context_kwargs(context),
	)
	raw_hits = _post_refine_longitude_raw_hits(
		raw_hits,
		context=context,
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
	)
	return _materialize_hits(raw_hits)


def _orbital_return_context(context: EphemerisContext) -> EphemerisContext:
	"""Return a heliocentric context used only to locate the next orbit."""
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_HELCTR
	if context.flags & astrology.SEFLG_SIDEREAL:
		flags |= astrology.SEFLG_SIDEREAL
	return EphemerisContext(
		flags=flags,
		ephe_path=context.ephe_path,
		sidereal_mode=context.sidereal_mode,
	)


def estimate_orbital_return_jd(
	planet: int,
	reference_jd: float,
	anchor_jd: float,
	direction: int,
	*,
	context: EphemerisContext,
) -> float:
	"""Estimate the adjacent orbital return without scanning the full cycle.

	The estimate is heliocentric so annual geocentric retrograde loops cannot
	destabilize Newton correction. The caller still performs an exact search in
	the original geocentric/topocentric context around the estimate.
	"""
	planet = int(planet)
	period_days = BODY_PERIOD_DAYS.get(planet)
	if period_days is None:
		raise ValueError(f"Orbital period is unavailable for planet {planet}")
	direction = 1 if int(direction) >= 0 else -1
	orbit_context = _orbital_return_context(context)
	with orbit_context.activate():
		reference_lon, _reference_speed = python_reference._eval_lon_speed(
			float(reference_jd), planet, orbit_context.flags,
		)
		anchor_lon, _anchor_speed = python_reference._eval_lon_speed(
			float(anchor_jd), planet, orbit_context.flags,
		)

	if direction > 0:
		phase_deg = wrap360(reference_lon - anchor_lon)
	else:
		phase_deg = wrap360(anchor_lon - reference_lon)
	if phase_deg <= 1e-7:
		phase_deg = 360.0
	candidate = float(anchor_jd) + direction * float(period_days) * phase_deg / 360.0

	# Heliocentric longitude is monotonic for the supported planets. A bounded
	# Newton solve therefore converges to the intended orbital branch while the
	# final geocentric search remains the exact authority.
	max_correction = float(period_days) / 4.0
	for _ in range(8):
		with orbit_context.activate():
			lon, speed = python_reference._eval_lon_speed(candidate, planet, orbit_context.flags)
		error = wrap180(lon - reference_lon)
		if abs(error) <= 1e-7 or abs(speed) <= STATION_SPEED_EPS:
			break
		correction = max(-max_correction, min(max_correction, error / speed))
		candidate -= correction
	return candidate


def search_adjacent_longitude_transit(
	planet: int,
	anchor_jd: float,
	target_deg: float,
	direction: int,
	*,
	reference_jd: float,
	context: EphemerisContext,
	inclusive: bool = False,
) -> TransitHit | None:
	"""Find the exact adjacent hit without linearly scanning a long orbit.

	A local window preserves direct/retrograde/direct pass ordering. If that
	window is empty, a heliocentric orbital estimate identifies the next return
	cluster and the normal longitude kernel refines the exact event in the
	caller's geocentric, sidereal, or topocentric context.
	"""
	planet = int(planet)
	period_days = BODY_PERIOD_DAYS.get(planet)
	if period_days is None:
		raise ValueError(f"Orbital period is unavailable for planet {planet}")
	direction = 1 if int(direction) >= 0 else -1
	anchor = float(anchor_jd)
	boundary_eps = max(DEFAULT_EPS_DAYS * 2.0, 0.5 / 86400.0)

	def select(hits: list[TransitHit]) -> TransitHit | None:
		if direction > 0:
			eligible = [
				hit for hit in hits
				if (
					hit.jd_ut >= anchor - boundary_eps
					if inclusive
					else hit.jd_ut > anchor + boundary_eps
				)
			]
		else:
			eligible = [
				hit for hit in hits
				if (
					hit.jd_ut <= anchor + boundary_eps
					if inclusive
					else hit.jd_ut < anchor - boundary_eps
				)
			]
		if not eligible:
			return None
		return min(eligible, key=lambda hit: hit.jd_ut) if direction > 0 else max(eligible, key=lambda hit: hit.jd_ut)

	local_days = min(1000.0, max(400.0, float(period_days) * 0.025))

	def certify_cluster(hit: TransitHit) -> TransitHit:
		if direction > 0:
			start = max(anchor + boundary_eps, hit.jd_ut - local_days)
			end = hit.jd_ut + boundary_eps
		else:
			start = hit.jd_ut - boundary_eps
			end = min(anchor - boundary_eps, hit.jd_ut + local_days)
		if end <= start:
			return hit
		certified = select(search_longitude_transits(
			planet,
			start,
			end,
			[target_deg],
			context=context,
		))
		return certified if certified is not None else hit

	if direction > 0:
		local_start = anchor - boundary_eps if inclusive else anchor + boundary_eps
		local_end = anchor + local_days
	else:
		local_start = anchor - local_days
		local_end = anchor + boundary_eps if inclusive else anchor - boundary_eps
	local_hits = search_longitude_transits(
		planet,
		local_start,
		local_end,
		[target_deg],
		context=context,
	)
	selected = select(local_hits)
	if selected is not None:
		return selected

	candidate = estimate_orbital_return_jd(
		planet,
		float(reference_jd),
		anchor,
		direction,
		context=context,
	)
	half_window = min(1200.0, max(500.0, float(period_days) * 0.015))
	# Inner planets need the fixed geocentric safety window even though their
	# shorter heliocentric periods would otherwise make the loop empty.
	max_half_window = max(half_window, float(period_days) * 0.6)
	while half_window <= max_half_window:
		window_start = candidate - half_window
		window_end = candidate + half_window
		if direction > 0:
			window_start = max(window_start, anchor + boundary_eps)
		else:
			window_end = min(window_end, anchor - boundary_eps)
		if window_end > window_start:
			hits = search_longitude_transits(
				planet,
				window_start,
				window_end,
				[target_deg],
				context=context,
			)
			selected = select(hits)
			if selected is not None:
				return certify_cluster(selected)
		half_window *= 2.0

	# The expanding candidate search normally resolves in its first window. This
	# bounded full-cycle fallback is the semantic guard for unusual ephemerides.
	fallback_days = max(1200.0, float(period_days) * 1.25)
	if direction > 0:
		fallback_start = anchor + boundary_eps
		fallback_end = anchor + fallback_days
	else:
		fallback_start = anchor - fallback_days
		fallback_end = anchor - boundary_eps
	return select(search_longitude_transits(
		planet,
		fallback_start,
		fallback_end,
		[target_deg],
		context=context,
	))


def search_station_times(
	planet: int,
	jd_start: float,
	jd_end: float,
	*,
	ephe_path: str | None = None,
	flags: int = 0,
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	step_days = _validate_optional_step(step_days)
	eps_speed = _validate_positive(eps_speed, "eps_speed")
	eps_days = _validate_positive(eps_days, "eps_days")
	raw_hits = _call_backend(
		context,
		"search_station_times_raw",
		int(planet),
		float(jd_start),
		float(jd_end),
		step_days=step_days,
		eps_speed=float(eps_speed),
		eps_days=float(eps_days),
		**_backend_context_kwargs(context),
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
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	planet_ids = _validate_planets(planets)
	targets = _validate_targets(targets_deg)
	step_days = _validate_optional_step(step_days)
	eps_deg = _validate_positive(eps_deg, "eps_deg")
	eps_days = _validate_positive(eps_days, "eps_days")
	raw_hits = _call_backend(
		context,
		"search_longitude_transits_batch_raw",
		planet_ids,
		float(jd_start),
		float(jd_end),
		targets,
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
		**_backend_context_kwargs(context),
	)
	raw_hits = _post_refine_longitude_raw_hits(
		raw_hits,
		context=context,
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
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	planet_ids = _validate_planets(planets)
	targets = _validate_targets(targets_deg)
	step_days = _validate_optional_step(step_days)
	eps_deg = _validate_positive(eps_deg, "eps_deg")
	eps_days = _validate_positive(eps_days, "eps_days")
	raw_hits = _call_backend(
		context,
		"search_longitude_transits_batch_raw",
		planet_ids,
		float(jd_start),
		float(jd_end),
		targets,
		step_days=step_days,
		eps_deg=float(eps_deg),
		eps_days=float(eps_days),
		**_backend_context_kwargs(context),
	)
	return _post_refine_longitude_raw_hits(
		raw_hits,
		context=context,
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
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_deg: float = DEFAULT_EPS_DEG,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[tuple]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	if not body_codes:
		raise ValueError("body_codes must not be empty")
	if not specs:
		return []
	normalized_codes = [int(value) for value in body_codes]
	normalized_specs = []
	for prom_idx, sig_idx, offset in specs:
		prom_idx = int(prom_idx)
		sig_idx = int(sig_idx)
		offset = float(offset)
		if not 0 <= prom_idx < len(normalized_codes):
			raise ValueError("relative-aspect promittor index is out of range")
		if not 0 <= sig_idx < len(normalized_codes):
			raise ValueError("relative-aspect significator index is out of range")
		if not math.isfinite(offset):
			raise ValueError("relative-aspect offsets must be finite")
		normalized_specs.append((prom_idx, sig_idx, offset))
	step_days = _validate_optional_step(step_days)
	eps_deg = _validate_positive(eps_deg, "eps_deg")
	eps_days = _validate_positive(eps_days, "eps_days")
	if step_days is not None:
		return _call_backend(
			context,
			"search_relative_aspects_batch_raw",
			normalized_codes,
			float(jd_start),
			float(jd_end),
			normalized_specs,
			step_days=step_days,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
			**_backend_context_kwargs(context),
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
				context=context,
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
		fallback_hits = _call_backend(
			context,
			"search_relative_aspects_batch_raw",
			normalized_codes,
			float(jd_start),
			float(jd_end),
			fallback_specs,
			step_days=fallback_step,
			eps_deg=float(eps_deg),
			eps_days=float(eps_days),
			**_backend_context_kwargs(context),
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
	context: EphemerisContext | None = None,
	step_days: float | None = None,
	eps_speed: float = STATION_SPEED_EPS,
	eps_days: float = DEFAULT_EPS_DAYS,
) -> list[TransitHit]:
	_validate_range(jd_start, jd_end)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
	planet_ids = _validate_planets(planets)
	step_days = _validate_optional_step(step_days)
	eps_speed = _validate_positive(eps_speed, "eps_speed")
	eps_days = _validate_positive(eps_days, "eps_days")
	raw_hits = _call_backend(
		context,
		"search_station_times_batch_raw",
		planet_ids,
		float(jd_start),
		float(jd_end),
		step_days=step_days,
		eps_speed=float(eps_speed),
		eps_days=float(eps_days),
		**_backend_context_kwargs(context),
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
	context: EphemerisContext | None = None,
) -> list[TransitHit]:
	_validate_range(year_start_jd, year_end_jd)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
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
	raw_hits = _call_backend(
		context,
		"search_longitude_transits_raw",
		int(planet),
		float(year_start_jd),
		float(year_end_jd),
		effective_targets,
		**_backend_context_kwargs(context),
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
	context: EphemerisContext | None = None,
) -> list[TransitHit]:
	_validate_range(year_start_jd, year_end_jd)
	context = _resolve_context(context, ephe_path=ephe_path, flags=flags)
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
	raw_hits = _call_backend(
		context,
		"search_longitude_transits_batch_raw",
		planet_ids,
		float(year_start_jd),
		float(year_end_jd),
		effective_targets,
		**_backend_context_kwargs(context),
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
