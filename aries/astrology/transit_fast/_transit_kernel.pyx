# cython: language_level=3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from libc.math cimport fabs, isfinite
from libc.stdlib cimport free, malloc, realloc
from libc.string cimport memset
from cpython.pythread cimport (
	PyThread_acquire_lock,
	PyThread_allocate_lock,
	PyThread_release_lock,
	PyThread_type_lock,
	WAIT_LOCK,
)

cimport cython

import astrology as _astrology

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
from ._swe_bridge cimport swe_calc_ut, swe_set_ephe_path, swe_set_sid_mode, swe_set_topo
from ._swe_bridge cimport swe_solcross_ut, swe_mooncross_ut
from ._types cimport CHit


cdef int _DIRECT_UNSUPPORTED_FLAGS = int(
	getattr(_astrology, "SEFLG_TOPOCTR", 0)
	| getattr(_astrology, "SEFLG_HELCTR", 0)
	| getattr(_astrology, "SEFLG_BARYCTR", 0)
	| getattr(_astrology, "SEFLG_EQUATORIAL", 0)
	| getattr(_astrology, "SEFLG_XYZ", 0)
	| getattr(_astrology, "SEFLG_RADIANS", 0)
)
cdef int _SIDEREAL_FLAG = int(getattr(_astrology, "SEFLG_SIDEREAL", 0))
cdef int _TOPOCENTRIC_FLAG = int(getattr(_astrology, "SEFLG_TOPOCTR", 0))
cdef int _SWIEPH_FLAG = int(getattr(_astrology, "SEFLG_SWIEPH", 0))
cdef int _SPEED_FLAG = int(getattr(_astrology, "SEFLG_SPEED", 0))
cdef int _SUN_ID = int(getattr(_astrology, "SE_SUN", 0))
cdef int _MOON_ID = int(getattr(_astrology, "SE_MOON", 1))
cdef int _BISECTION_MAX_ITERS = int(BISECTION_MAX_ITERS)
cdef int _NEWTON_MAX_ITERS = int(NEWTON_MAX_ITERS)
cdef int _HIT_LONGITUDE = int(HIT_LONGITUDE)
cdef int _HIT_STATION = int(HIT_STATION)
cdef double _DEDUP_EPS_DAYS = float(DEDUP_EPS_DAYS)
cdef double _DEFAULT_EPS_DEG = float(DEFAULT_EPS_DEG)
cdef double _LOW_SPEED_WARN = float(LOW_SPEED_WARN)
cdef double _STATION_SPEED_EPS = float(STATION_SPEED_EPS)
cdef double _MAX_NATIVE_LOCK_SPAN_DAYS = 14.0
cdef object _active_ephe_path = None
cdef object _active_sidereal_mode = None
cdef object _active_topocentric_position = None
cdef PyThread_type_lock _native_swe_lock = PyThread_allocate_lock()
if _native_swe_lock == NULL:
	raise MemoryError("Could not allocate native Swiss Ephemeris lock")


cdef inline void _acquire_native_swe_lock() noexcept nogil:
	PyThread_acquire_lock(_native_swe_lock, WAIT_LOCK)


cdef inline void _release_native_swe_lock() noexcept nogil:
	PyThread_release_lock(_native_swe_lock)


cdef void _validate_scan_bounds(double jd_start, double jd_end):
	if not isfinite(jd_start) or not isfinite(jd_end):
		raise ValueError("Julian-day bounds must be finite")
	if jd_end <= jd_start:
		raise ValueError("jd_end must be greater than jd_start")


cdef void _validate_positive_double(double value, str name):
	if not isfinite(value) or value <= 0.0:
		raise ValueError(f"{name} must be finite and greater than zero")


cdef void _configure_ephemeris_context(
	object ephe_path,
	int flags,
	object sidereal_mode,
	object topocentric_position,
):
	global _active_ephe_path, _active_sidereal_mode, _active_topocentric_position
	cdef object normalized_topo = None
	if not ephe_path:
		raise ValueError("native transit searches require an explicit ephe_path")
	if flags & _SIDEREAL_FLAG and sidereal_mode is None:
		raise ValueError("sidereal flags require an explicit sidereal_mode")
	if flags & _TOPOCENTRIC_FLAG and topocentric_position is None:
		raise ValueError("topocentric flags require an explicit topocentric_position")
	if ephe_path and ephe_path != _active_ephe_path:
		swe_set_ephe_path(ephe_path.encode("utf-8"))
		_active_ephe_path = ephe_path
		_active_sidereal_mode = None
		_active_topocentric_position = None
	if sidereal_mode is not None and sidereal_mode != _active_sidereal_mode:
		swe_set_sid_mode(int(sidereal_mode), 0.0, 0.0)
		_active_sidereal_mode = sidereal_mode
	if topocentric_position is not None:
		normalized_topo = (
			float(topocentric_position[0]),
			float(topocentric_position[1]),
			float(topocentric_position[2]),
		)
	if normalized_topo is not None and normalized_topo != _active_topocentric_position:
		swe_set_topo(
			float(normalized_topo[0]),
			float(normalized_topo[1]),
			float(normalized_topo[2]),
		)
		_active_topocentric_position = normalized_topo


cdef inline double _wrap360_c(double x) noexcept nogil:
	cdef double value = x % 360.0
	if value < 0.0:
		value += 360.0
	return value


cdef inline double _wrap180_c(double x) noexcept nogil:
	cdef double value = _wrap360_c(x)
	if value >= 180.0:
		value -= 360.0
	return value


cdef inline double _relative_delta_c(double prom_lon, double sig_lon, double offset) noexcept nogil:
	cdef double target = sig_lon + offset
	if target < 0.0:
		target += 360.0
	elif target >= 360.0:
		target -= 360.0
	return _wrap180_c(prom_lon - target)


cdef inline bint _crossed_zero_c(double f0, double f1) noexcept nogil:
	if f0 == 0.0 or f1 == 0.0:
		return True
	return (f0 < 0.0 < f1) or (f1 < 0.0 < f0)


cdef inline bint _is_longitude_zero_crossing_c(double f0, double f1) noexcept nogil:
	if not _crossed_zero_c(f0, f1):
		return False
	return fabs(f1 - f0) < 180.0


cdef inline bint _is_relative_zero_crossing_c(double f0, double f1, double eps_deg) noexcept nogil:
	if fabs(f0) <= eps_deg or fabs(f1) <= eps_deg:
		return True
	if not _crossed_zero_c(f0, f1):
		return False
	return fabs(f1 - f0) < 180.0


cdef inline double _adaptive_step_c(double base_step, double speed, double eps_days) noexcept nogil:
	cdef double abs_speed = fabs(speed)
	cdef double step = base_step
	if abs_speed <= _LOW_SPEED_WARN:
		step *= 0.25
	elif abs_speed >= 2.0:
		step *= 1.5
	if step < eps_days * 64.0:
		step = eps_days * 64.0
	if step < 1e-4:
		step = 1e-4
	return step


cdef inline double _adaptive_station_step_c(double base_step, double speed, double eps_days) noexcept nogil:
	cdef double abs_speed = fabs(speed)
	cdef double step = base_step
	if abs_speed <= _STATION_SPEED_EPS * 100.0:
		step *= 0.1
	elif abs_speed <= _LOW_SPEED_WARN:
		step *= 0.2
	elif abs_speed <= 1e-3:
		step *= 0.5
	elif abs_speed >= 2.0:
		step *= 1.25
	if step < eps_days * 64.0:
		step = eps_days * 64.0
	if step < 1e-4:
		step = 1e-4
	return step


cdef inline size_t _lower_bound_c(double* values, size_t count, double target) noexcept nogil:
	cdef size_t lo = 0
	cdef size_t hi = count
	cdef size_t mid
	while lo < hi:
		mid = (lo + hi) // 2
		if values[mid] < target:
			lo = mid + 1
		else:
			hi = mid
	return lo


cdef inline size_t _upper_bound_c(double* values, size_t count, double target) noexcept nogil:
	cdef size_t lo = 0
	cdef size_t hi = count
	cdef size_t mid
	while lo < hi:
		mid = (lo + hi) // 2
		if values[mid] <= target:
			lo = mid + 1
		else:
			hi = mid
	return lo


cdef inline bint _can_use_direct_crossing_c(int planet, int flags) noexcept nogil:
	if planet != _SUN_ID and planet != _MOON_ID:
		return False
	return (flags & _DIRECT_UNSUPPORTED_FLAGS) == 0


cdef double _direct_cross_ut_c(
	int planet,
	double target_deg,
	double jd_ut,
	int flags,
) except? -2.0 nogil:
	cdef char serr[256]
	cdef double result
	memset(serr, 0, sizeof(serr))
	if planet == _MOON_ID:
		result = swe_mooncross_ut(target_deg, jd_ut, flags | _SWIEPH_FLAG, serr)
	else:
		result = swe_solcross_ut(target_deg, jd_ut, flags | _SWIEPH_FLAG, serr)
	if result < 0.0:
		with gil:
			raise RuntimeError(f"Swiss Ephemeris returned no crossing data for planet={planet} target={target_deg} jd={jd_ut}: {(<bytes>serr).decode('utf-8', 'ignore')!r}")
	return result


cdef int _eval_lon_speed(
	double jd_ut,
	int planet,
	int flags,
	double* lon,
	double* speed,
) except -1 nogil:
	cdef double xx[6]
	cdef char serr[256]
	cdef int retflag
	memset(serr, 0, sizeof(serr))
	retflag = swe_calc_ut(jd_ut, planet, flags | _SWIEPH_FLAG | _SPEED_FLAG, xx, serr)
	if retflag < 0:
		with gil:
			raise RuntimeError(f"Swiss Ephemeris returned no longitude data for planet={planet} jd={jd_ut}: {(<bytes>serr).decode('utf-8', 'ignore')!r}")
	lon[0] = xx[0]
	speed[0] = xx[3]
	return 0


cdef int _eval_body_lon_speed(
	double jd_ut,
	int body_code,
	int flags,
	double* lon,
	double* speed,
) except -1 nogil:
	cdef int planet = body_code
	cdef bint is_desc = False
	if planet >= 1000:
		planet -= 1000
		is_desc = True
	_eval_lon_speed(jd_ut, planet, flags, lon, speed)
	if is_desc:
		lon[0] = _wrap360_c(lon[0] + 180.0)
	return 0


cdef int _ensure_capacity(
	CHit** hits_ptr,
	size_t* capacity_ptr,
	size_t needed,
) except -1 nogil:
	cdef size_t new_capacity
	cdef void* new_ptr
	if needed <= capacity_ptr[0]:
		return 0
	new_capacity = 16 if capacity_ptr[0] == 0 else capacity_ptr[0] * 2
	while new_capacity < needed:
		new_capacity *= 2
	new_ptr = realloc(hits_ptr[0], new_capacity * cython.sizeof(CHit))
	if new_ptr == NULL:
		with gil:
			raise MemoryError("Could not grow transit hit buffer")
	hits_ptr[0] = <CHit*>new_ptr
	capacity_ptr[0] = new_capacity
	return 0


cdef int _append_unique_c(
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
	double jd_ut,
	int planet,
	double target_deg,
	double aspect_deg,
	int hit_kind,
	double speed,
	int retrograde,
) except -1 nogil:
	cdef size_t i = count_ptr[0]
	cdef CHit* hits = hits_ptr[0]
	while i > 0:
		i -= 1
		if hits[i].planet != planet:
			break
		if hits[i].jd_ut + _DEDUP_EPS_DAYS < jd_ut:
			break
		if (
			fabs(hits[i].jd_ut - jd_ut) < _DEDUP_EPS_DAYS
			and hits[i].planet == planet
			and hits[i].hit_kind == hit_kind
			and fabs(hits[i].target_deg - target_deg) < _DEFAULT_EPS_DEG
			and fabs(hits[i].aspect_deg - aspect_deg) < _DEFAULT_EPS_DEG
		):
			return 0
	_ensure_capacity(hits_ptr, capacity_ptr, count_ptr[0] + 1)
	hits = hits_ptr[0]
	hits[count_ptr[0]].jd_ut = jd_ut
	hits[count_ptr[0]].planet = planet
	hits[count_ptr[0]].target_deg = target_deg
	hits[count_ptr[0]].aspect_deg = aspect_deg
	hits[count_ptr[0]].speed = speed
	hits[count_ptr[0]].retrograde = retrograde
	hits[count_ptr[0]].pass_index = 0
	hits[count_ptr[0]].hit_kind = hit_kind
	count_ptr[0] += 1
	return 0


cdef int _refine_station_root_seeded_c(
	double jd_lo,
	double speed_lo,
	double jd_hi,
	double speed_hi,
	int planet,
	int flags,
	double eps_speed,
	double eps_days,
	double* result_jd,
	double* result_speed,
) except -1 nogil:
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double slo = speed_lo
	cdef double shi = speed_hi
	cdef double lon_tmp
	cdef double smid
	cdef double mid
	cdef double best_jd
	cdef double best_speed
	cdef double den
	cdef int i
	best_jd = lo if fabs(slo) <= fabs(shi) else hi
	best_speed = slo if fabs(slo) <= fabs(shi) else shi

	for i in range(_BISECTION_MAX_ITERS):
		if fabs(best_speed) <= eps_speed or (hi - lo) <= eps_days:
			break
		if _crossed_zero_c(slo, shi):
			mid = (lo + hi) * 0.5
		else:
			den = shi - slo
			mid = (lo + hi) * 0.5 if den == 0.0 else hi - shi * (hi - lo) / den
			if mid <= lo or mid >= hi:
				mid = (lo + hi) * 0.5
		_eval_lon_speed(mid, planet, flags, &lon_tmp, &smid)
		if fabs(smid) < fabs(best_speed):
			best_jd = mid
			best_speed = smid
		if fabs(smid) <= eps_speed:
			result_jd[0] = mid
			result_speed[0] = smid
			return 0
		if _crossed_zero_c(slo, smid):
			hi = mid
			shi = smid
		elif _crossed_zero_c(smid, shi):
			lo = mid
			slo = smid
		elif fabs(slo) <= fabs(shi):
			hi = mid
			shi = smid
		else:
			lo = mid
			slo = smid

	result_jd[0] = best_jd
	result_speed[0] = best_speed
	return 0


cdef int _refine_longitude_root_seeded_c(
	int planet,
	double target_deg,
	double jd_lo,
	double lon_lo,
	double speed_lo,
	double jd_hi,
	double lon_hi,
	double speed_hi,
	int flags,
	double eps_deg,
	double eps_days,
	double* result_jd,
	double* result_speed,
	double* result_residual,
) except -1 nogil:
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double lon_x
	cdef double speed_x
	cdef double f_lo
	cdef double f_hi
	cdef double f_x
	cdef double best_jd
	cdef double best_err
	cdef double best_speed
	cdef double x
	cdef double x_next
	cdef int i
	f_lo = _wrap180_c(lon_lo - target_deg)
	f_hi = _wrap180_c(lon_hi - target_deg)
	best_jd = lo if fabs(f_lo) <= fabs(f_hi) else hi
	best_err = f_lo if fabs(f_lo) <= fabs(f_hi) else f_hi
	best_speed = speed_lo if fabs(f_lo) <= fabs(f_hi) else speed_hi
	if fabs(speed_lo) > _STATION_SPEED_EPS:
		x = lo - (f_lo / speed_lo)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif fabs(speed_hi) > _STATION_SPEED_EPS:
		x = hi - (f_hi / speed_hi)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for i in range(_NEWTON_MAX_ITERS + _BISECTION_MAX_ITERS):
		_eval_lon_speed(x, planet, flags, &lon_x, &speed_x)
		f_x = _wrap180_c(lon_x - target_deg)
		if fabs(f_x) < fabs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if fabs(f_x) <= eps_deg:
			result_jd[0] = x
			result_speed[0] = speed_x
			result_residual[0] = f_x
			return 0
		if (hi - lo) <= eps_days:
			break
		if _crossed_zero_c(f_lo, f_x):
			hi = x
			f_hi = f_x
		elif _crossed_zero_c(f_x, f_hi):
			lo = x
			f_lo = f_x
		elif fabs(f_lo) <= fabs(f_hi):
			hi = x
			f_hi = f_x
		else:
			lo = x
			f_lo = f_x

		if fabs(speed_x) > _STATION_SPEED_EPS:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	result_jd[0] = best_jd
	result_speed[0] = best_speed
	result_residual[0] = best_err
	return 0


cdef int _refine_relative_root_c(
	int prom_code,
	int sig_code,
	double offset,
	double jd_lo,
	double jd_hi,
	double prom_lon_lo,
	double prom_speed_lo,
	double sig_lon_lo,
	double sig_speed_lo,
	double prom_lon_hi,
	double prom_speed_hi,
	double sig_lon_hi,
	double sig_speed_hi,
	int flags,
	double eps_deg,
	double eps_days,
	double* result_jd,
	double* result_speed,
	double* result_residual,
) except -1 nogil:
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double prom_lon_x
	cdef double prom_speed_x
	cdef double sig_lon_x
	cdef double sig_speed_x
	cdef double speed_lo
	cdef double speed_hi
	cdef double speed_x
	cdef double f_lo
	cdef double f_hi
	cdef double f_x
	cdef double best_jd
	cdef double best_err
	cdef double best_speed
	cdef double x
	cdef double x_next
	cdef int i
	speed_lo = prom_speed_lo - sig_speed_lo
	speed_hi = prom_speed_hi - sig_speed_hi
	f_lo = _relative_delta_c(prom_lon_lo, sig_lon_lo, offset)
	f_hi = _relative_delta_c(prom_lon_hi, sig_lon_hi, offset)
	best_jd = lo if fabs(f_lo) <= fabs(f_hi) else hi
	best_err = f_lo if fabs(f_lo) <= fabs(f_hi) else f_hi
	best_speed = speed_lo if fabs(f_lo) <= fabs(f_hi) else speed_hi
	if fabs(speed_lo) > _STATION_SPEED_EPS:
		x = lo - (f_lo / speed_lo)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif fabs(speed_hi) > _STATION_SPEED_EPS:
		x = hi - (f_hi / speed_hi)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for i in range(_NEWTON_MAX_ITERS + _BISECTION_MAX_ITERS):
		_eval_body_lon_speed(x, prom_code, flags, &prom_lon_x, &prom_speed_x)
		_eval_body_lon_speed(x, sig_code, flags, &sig_lon_x, &sig_speed_x)
		speed_x = prom_speed_x - sig_speed_x
		f_x = _relative_delta_c(prom_lon_x, sig_lon_x, offset)
		if fabs(f_x) < fabs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if fabs(f_x) <= eps_deg:
			result_jd[0] = x
			result_speed[0] = speed_x
			result_residual[0] = f_x
			return 0
		if (hi - lo) <= eps_days:
			break
		if _crossed_zero_c(f_lo, f_x):
			hi = x
			f_hi = f_x
		elif _crossed_zero_c(f_x, f_hi):
			lo = x
			f_lo = f_x
		elif fabs(f_lo) <= fabs(f_hi):
			hi = x
			f_hi = f_x
		else:
			lo = x
			f_lo = f_x
		if fabs(speed_x) > _STATION_SPEED_EPS:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	result_jd[0] = best_jd
	result_speed[0] = best_speed
	result_residual[0] = best_err
	return 0


cdef int _refine_relative_speed_turn_c(
	int prom_code,
	int sig_code,
	double jd_lo,
	double jd_hi,
	double prom_lon_lo,
	double prom_speed_lo,
	double sig_lon_lo,
	double sig_speed_lo,
	double prom_lon_hi,
	double prom_speed_hi,
	double sig_lon_hi,
	double sig_speed_hi,
	int flags,
	double eps_days,
	double* result_jd,
	double* result_prom_lon,
	double* result_prom_speed,
	double* result_sig_lon,
	double* result_sig_speed,
) except -1 nogil:
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double rel_speed_lo = prom_speed_lo - sig_speed_lo
	cdef double rel_speed_hi = prom_speed_hi - sig_speed_hi
	cdef double rel_speed_x
	cdef double den
	cdef double bracket_den
	cdef double x
	cdef double x_next
	cdef double previous_x
	cdef double previous_speed
	cdef double prom_lon_x
	cdef double prom_speed_x
	cdef double sig_lon_x
	cdef double sig_speed_x
	cdef int i
	if rel_speed_lo == 0.0:
		result_jd[0] = lo
		result_prom_lon[0] = prom_lon_lo
		result_prom_speed[0] = prom_speed_lo
		result_sig_lon[0] = sig_lon_lo
		result_sig_speed[0] = sig_speed_lo
		return 0
	if rel_speed_hi == 0.0:
		result_jd[0] = hi
		result_prom_lon[0] = prom_lon_hi
		result_prom_speed[0] = prom_speed_hi
		result_sig_lon[0] = sig_lon_hi
		result_sig_speed[0] = sig_speed_hi
		return 0
	den = rel_speed_hi - rel_speed_lo
	x = (lo + hi) * 0.5 if den == 0.0 else hi - rel_speed_hi * (hi - lo) / den
	if x <= lo or x >= hi:
		x = (lo + hi) * 0.5
	previous_x = lo
	previous_speed = rel_speed_lo
	for i in range(_BISECTION_MAX_ITERS):
		if (hi - lo) <= eps_days:
			break
		_eval_body_lon_speed(x, prom_code, flags, &prom_lon_x, &prom_speed_x)
		_eval_body_lon_speed(x, sig_code, flags, &sig_lon_x, &sig_speed_x)
		rel_speed_x = prom_speed_x - sig_speed_x
		if rel_speed_x == 0.0 or fabs(x - previous_x) <= eps_days:
			result_jd[0] = x
			result_prom_lon[0] = prom_lon_x
			result_prom_speed[0] = prom_speed_x
			result_sig_lon[0] = sig_lon_x
			result_sig_speed[0] = sig_speed_x
			return 0
		if _crossed_zero_c(rel_speed_lo, rel_speed_x):
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
	_eval_body_lon_speed(x, prom_code, flags, &prom_lon_x, &prom_speed_x)
	_eval_body_lon_speed(x, sig_code, flags, &sig_lon_x, &sig_speed_x)
	result_jd[0] = x
	result_prom_lon[0] = prom_lon_x
	result_prom_speed[0] = prom_speed_x
	result_sig_lon[0] = sig_lon_x
	result_sig_speed[0] = sig_speed_x
	return 0


cdef inline int _append_relative_segment_c(
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
	int spec_idx,
	int prom_code,
	int sig_code,
	double offset,
	double jd_lo,
	double jd_hi,
	double prom_lon_lo,
	double prom_speed_lo,
	double sig_lon_lo,
	double sig_speed_lo,
	double prom_lon_hi,
	double prom_speed_hi,
	double sig_lon_hi,
	double sig_speed_hi,
	int flags,
	double eps_deg,
	double eps_days,
) except -1 nogil:
	cdef double delta_lo
	cdef double delta_hi
	cdef double hit_jd
	cdef double hit_speed
	cdef double hit_residual
	if jd_hi <= jd_lo:
		return 0
	delta_lo = _relative_delta_c(prom_lon_lo, sig_lon_lo, offset)
	delta_hi = _relative_delta_c(prom_lon_hi, sig_lon_hi, offset)
	if fabs(delta_lo) <= eps_deg:
		return _append_unique_c(
			hits_ptr,
			count_ptr,
			capacity_ptr,
			jd_lo,
			spec_idx,
			0.0,
			0.0,
			_HIT_LONGITUDE,
			prom_speed_lo - sig_speed_lo,
			1 if prom_speed_lo - sig_speed_lo < 0.0 else 0,
		)
	if fabs(delta_hi) <= eps_deg:
		return _append_unique_c(
			hits_ptr,
			count_ptr,
			capacity_ptr,
			jd_hi,
			spec_idx,
			0.0,
			0.0,
			_HIT_LONGITUDE,
			prom_speed_hi - sig_speed_hi,
			1 if prom_speed_hi - sig_speed_hi < 0.0 else 0,
		)
	if not _is_relative_zero_crossing_c(delta_lo, delta_hi, eps_deg):
		return 0
	_refine_relative_root_c(
		prom_code,
		sig_code,
		offset,
		jd_lo,
		jd_hi,
		prom_lon_lo,
		prom_speed_lo,
		sig_lon_lo,
		sig_speed_lo,
		prom_lon_hi,
		prom_speed_hi,
		sig_lon_hi,
		sig_speed_hi,
		flags,
		eps_deg,
		eps_days,
		&hit_jd,
		&hit_speed,
		&hit_residual,
	)
	if fabs(hit_residual) > eps_deg:
		return 0
	return _append_unique_c(
		hits_ptr,
		count_ptr,
		capacity_ptr,
		hit_jd,
		spec_idx,
		0.0,
		0.0,
		_HIT_LONGITUDE,
		hit_speed,
		1 if hit_speed < 0.0 else 0,
	)


cdef inline int _append_arc_hits_range_c(
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
	int planet,
	double* targets,
	size_t idx_lo,
	size_t idx_hi,
	double jd_lo,
	double lon_lo,
	double speed_lo,
	double jd_hi,
	double lon_hi,
	double speed_hi,
	int flags,
	double eps_deg,
	double eps_days,
) except -1 nogil:
	cdef size_t idx
	cdef double target_deg
	cdef double f_lo
	cdef double f_hi
	cdef double hit_jd
	cdef double hit_speed
	cdef double hit_residual
	for idx in range(idx_lo, idx_hi):
		target_deg = targets[idx]
		f_lo = _wrap180_c(lon_lo - target_deg)
		f_hi = _wrap180_c(lon_hi - target_deg)
		if fabs(f_lo) <= eps_deg:
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, jd_lo, planet, target_deg, 0.0, _HIT_LONGITUDE, speed_lo, 1 if speed_lo < 0.0 else 0)
		elif fabs(f_hi) <= eps_deg:
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, jd_hi, planet, target_deg, 0.0, _HIT_LONGITUDE, speed_hi, 1 if speed_hi < 0.0 else 0)
		elif _is_longitude_zero_crossing_c(f_lo, f_hi):
			_refine_longitude_root_seeded_c(
				planet,
				target_deg,
				jd_lo,
				lon_lo,
				speed_lo,
				jd_hi,
				lon_hi,
				speed_hi,
				flags,
				eps_deg,
				eps_days,
				&hit_jd,
				&hit_speed,
				&hit_residual,
			)
			if fabs(hit_residual) <= eps_deg:
				_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, target_deg, 0.0, _HIT_LONGITUDE, hit_speed, 1 if hit_speed < 0.0 else 0)
	return 0


cdef inline int _append_arc_hits_c(
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
	int planet,
	double* targets,
	size_t target_count,
	double jd_lo,
	double lon_lo,
	double speed_lo,
	double jd_hi,
	double lon_hi,
	double speed_hi,
	int flags,
	double eps_deg,
	double eps_days,
) except -1 nogil:
	cdef double forward_span
	cdef double reverse_span
	cdef int direction
	cdef size_t idx_lo
	cdef size_t idx_hi
	if jd_hi <= jd_lo or target_count == 0:
		return 0
	if fabs(speed_lo) > _STATION_SPEED_EPS:
		direction = 1 if speed_lo > 0.0 else -1
	elif fabs(speed_hi) > _STATION_SPEED_EPS:
		direction = 1 if speed_hi > 0.0 else -1
	else:
		forward_span = _wrap360_c(lon_hi - lon_lo)
		reverse_span = _wrap360_c(lon_lo - lon_hi)
		direction = 1 if forward_span <= reverse_span else -1

	if direction > 0:
		forward_span = _wrap360_c(lon_hi - lon_lo)
		if forward_span >= 180.0:
			return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, 0, target_count, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
		if lon_hi >= lon_lo:
			idx_lo = _lower_bound_c(targets, target_count, lon_lo - eps_deg)
			idx_hi = _upper_bound_c(targets, target_count, lon_hi + eps_deg)
			return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, idx_lo, idx_hi, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
		idx_lo = _lower_bound_c(targets, target_count, lon_lo - eps_deg)
		_append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, idx_lo, target_count, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
		idx_hi = _upper_bound_c(targets, target_count, lon_hi + eps_deg)
		return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, 0, idx_hi, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)

	reverse_span = _wrap360_c(lon_lo - lon_hi)
	if reverse_span >= 180.0:
		return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, 0, target_count, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
	if lon_lo >= lon_hi:
		idx_lo = _lower_bound_c(targets, target_count, lon_hi - eps_deg)
		idx_hi = _upper_bound_c(targets, target_count, lon_lo + eps_deg)
		return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, idx_lo, idx_hi, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
	idx_hi = _upper_bound_c(targets, target_count, lon_lo + eps_deg)
	_append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, 0, idx_hi, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)
	idx_lo = _lower_bound_c(targets, target_count, lon_hi - eps_deg)
	return _append_arc_hits_range_c(hits_ptr, count_ptr, capacity_ptr, planet, targets, idx_lo, target_count, jd_lo, lon_lo, speed_lo, jd_hi, lon_hi, speed_hi, flags, eps_deg, eps_days)


cdef int _search_direct_crossings_into_c(
	int planet,
	double jd_start,
	double jd_end,
	double* targets,
	size_t target_count,
	int flags,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1 nogil:
	cdef size_t idx
	cdef double target_deg
	cdef double probe_jd
	cdef double hit_jd
	cdef double lon
	cdef double speed
	for idx in range(target_count):
		target_deg = targets[idx]
		probe_jd = jd_start
		while probe_jd <= jd_end:
			hit_jd = _direct_cross_ut_c(planet, target_deg, probe_jd, flags)
			if hit_jd < jd_start - _DEDUP_EPS_DAYS:
				probe_jd += 1e-6
				continue
			if hit_jd > jd_end + _DEDUP_EPS_DAYS:
				break
			_eval_lon_speed(hit_jd, planet, flags, &lon, &speed)
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, target_deg, 0.0, _HIT_LONGITUDE, speed, 1 if speed < 0.0 else 0)
			probe_jd = hit_jd + 1e-6
	return 0


cdef list _hits_to_python(CHit* hits, size_t count):
	cdef list out = []
	cdef size_t i
	for i in range(count):
		out.append(
			(
				hits[i].jd_ut,
				hits[i].planet,
				hits[i].target_deg,
				hits[i].aspect_deg,
				hits[i].hit_kind,
				hits[i].speed,
				bool(hits[i].retrograde),
			)
		)
	out.sort(key=lambda item: (item[0], item[2], item[3], item[1], item[4]))
	return out


def _sort_raw_hits_py(out):
	out.sort(key=lambda item: (item[0], item[2], item[3], item[1], item[4]))
	return out


cdef int _search_station_times_into_c(
	int planet,
	double jd_start,
	double jd_end,
	int flags,
	double base_step,
	double eps_speed,
	double eps_days,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1 nogil:
	cdef double accept_speed = eps_speed * 1000.0
	cdef double jd = jd_start
	cdef double jd_next
	cdef double lon0
	cdef double lon1
	cdef double speed0
	cdef double speed1
	cdef double hit_jd
	cdef double hit_speed
	if accept_speed < 1e-6:
		accept_speed = 1e-6
	_eval_lon_speed(jd, planet, flags, &lon0, &speed0)
	while jd < jd_end:
		jd_next = jd + _adaptive_station_step_c(base_step, speed0, eps_days)
		if jd_next > jd_end:
			jd_next = jd_end
		_eval_lon_speed(jd_next, planet, flags, &lon1, &speed1)
		if fabs(speed0) <= eps_speed or fabs(speed1) <= eps_speed or _crossed_zero_c(speed0, speed1) or fabs(speed0) <= _LOW_SPEED_WARN or fabs(speed1) <= _LOW_SPEED_WARN:
			_refine_station_root_seeded_c(
				jd,
				speed0,
				jd_next,
				speed1,
				planet,
				flags,
				eps_speed,
				eps_days,
				&hit_jd,
				&hit_speed,
			)
			if jd_start <= hit_jd <= jd_end and fabs(hit_speed) <= accept_speed:
				_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, 0.0, 0.0, _HIT_STATION, hit_speed, 1 if hit_speed < 0.0 else 0)
		jd = jd_next
		lon0 = lon1
		speed0 = speed1
	return 0


cdef int _prepare_targets_c(
	object targets_deg,
	double** targets_out,
	size_t* count_out,
) except -1:
	cdef double target_value
	cdef object seen_targets = set()
	cdef list normalized_targets = []
	cdef size_t idx
	for target in targets_deg:
		target_value = float(target)
		if not isfinite(target_value):
			raise ValueError("targets_deg values must be finite")
		target_value = _wrap360_c(target_value)
		if round(target_value, 12) in seen_targets:
			continue
		seen_targets.add(round(target_value, 12))
		normalized_targets.append(target_value)
	count_out[0] = len(normalized_targets)
	if count_out[0] == 0:
		targets_out[0] = NULL
		return 0
	targets_out[0] = <double*>malloc(count_out[0] * cython.sizeof(double))
	if targets_out[0] == NULL:
		raise MemoryError("Could not allocate target buffers")
	normalized_targets.sort()
	for idx in range(count_out[0]):
		targets_out[0][idx] = float(normalized_targets[idx])
	return 0


cdef int _search_longitude_transits_prepared_into_c(
	int planet,
	double jd_start,
	double jd_end,
	double* unique_targets,
	size_t target_count,
	int flags,
	double base_step,
	double eps_deg,
	double eps_days,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1 nogil:
	cdef double jd
	cdef double jd_next
	cdef double station_jd
	cdef double station_speed
	cdef double station_lon
	cdef double lon0
	cdef double lon1
	cdef double speed0
	cdef double speed1
	cdef double station_eps
	cdef bint have_station
	if target_count == 0:
		return 0
	if _can_use_direct_crossing_c(planet, flags):
		return _search_direct_crossings_into_c(planet, jd_start, jd_end, unique_targets, target_count, flags, hits_ptr, count_ptr, capacity_ptr)
	jd = jd_start
	_eval_lon_speed(jd, planet, flags, &lon0, &speed0)
	while jd < jd_end:
		jd_next = jd + _adaptive_step_c(base_step, speed0, eps_days)
		if jd_next > jd_end:
			jd_next = jd_end
		_eval_lon_speed(jd_next, planet, flags, &lon1, &speed1)
		have_station = _crossed_zero_c(speed0, speed1) or fabs(speed0) <= _LOW_SPEED_WARN or fabs(speed1) <= _LOW_SPEED_WARN
		if have_station:
			station_eps = 0.0 if _crossed_zero_c(speed0, speed1) else _STATION_SPEED_EPS
			_refine_station_root_seeded_c(
				jd,
				speed0,
				jd_next,
				speed1,
				planet,
				flags,
				station_eps,
				eps_days,
				&station_jd,
				&station_speed,
			)
			_eval_lon_speed(station_jd, planet, flags, &station_lon, &station_speed)
			if jd < station_jd < jd_next:
				_append_arc_hits_c(hits_ptr, count_ptr, capacity_ptr, planet, unique_targets, target_count, jd, lon0, speed0, station_jd, station_lon, station_speed, flags, eps_deg, eps_days)
				_append_arc_hits_c(hits_ptr, count_ptr, capacity_ptr, planet, unique_targets, target_count, station_jd, station_lon, station_speed, jd_next, lon1, speed1, flags, eps_deg, eps_days)
			else:
				_append_arc_hits_c(hits_ptr, count_ptr, capacity_ptr, planet, unique_targets, target_count, jd, lon0, speed0, jd_next, lon1, speed1, flags, eps_deg, eps_days)
		else:
			_append_arc_hits_c(hits_ptr, count_ptr, capacity_ptr, planet, unique_targets, target_count, jd, lon0, speed0, jd_next, lon1, speed1, flags, eps_deg, eps_days)
		jd = jd_next
		lon0 = lon1
		speed0 = speed1
	return 0


cdef int _search_relative_aspects_into_c(
	int* body_code_arr,
	Py_ssize_t body_count,
	int* prom_indices,
	int* sig_indices,
	int* pair_slots,
	Py_ssize_t pair_count,
	double* spec_offsets,
	Py_ssize_t spec_count,
	double jd_start,
	double jd_end,
	double base_step,
	int flags,
	double eps_deg,
	double eps_days,
	double* lon0,
	double* lon1,
	double* speed0,
	double* speed1,
	int* turn_status,
	double* turn_jd,
	double* turn_prom_lon,
	double* turn_prom_speed,
	double* turn_sig_lon,
	double* turn_sig_speed,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1 nogil:
	cdef double jd = jd_start
	cdef double jd_next
	cdef Py_ssize_t i
	cdef int prom_idx
	cdef int sig_idx
	cdef int pair_slot
	cdef int prom_code
	cdef int sig_code
	cdef double offset
	cdef double rel_speed0
	cdef double rel_speed1
	cdef double turn_residual
	cdef double hit_speed
	for i in range(body_count):
		_eval_body_lon_speed(jd, body_code_arr[i], flags, &lon0[i], &speed0[i])
	while jd < jd_end:
		jd_next = jd + base_step
		if jd_next > jd_end:
			jd_next = jd_end
		for i in range(body_count):
			_eval_body_lon_speed(jd_next, body_code_arr[i], flags, &lon1[i], &speed1[i])
		for i in range(pair_count):
			turn_status[i] = -1
		for i in range(spec_count):
			prom_idx = prom_indices[i]
			sig_idx = sig_indices[i]
			pair_slot = pair_slots[i]
			offset = spec_offsets[i]
			prom_code = body_code_arr[prom_idx]
			sig_code = body_code_arr[sig_idx]
			if turn_status[pair_slot] < 0:
				rel_speed0 = speed0[prom_idx] - speed0[sig_idx]
				rel_speed1 = speed1[prom_idx] - speed1[sig_idx]
				if (rel_speed0 < 0.0 < rel_speed1) or (rel_speed1 < 0.0 < rel_speed0):
					_refine_relative_speed_turn_c(
						prom_code,
						sig_code,
						jd,
						jd_next,
						lon0[prom_idx],
						speed0[prom_idx],
						lon0[sig_idx],
						speed0[sig_idx],
						lon1[prom_idx],
						speed1[prom_idx],
						lon1[sig_idx],
						speed1[sig_idx],
						flags,
						eps_days,
						&turn_jd[pair_slot],
						&turn_prom_lon[pair_slot],
						&turn_prom_speed[pair_slot],
						&turn_sig_lon[pair_slot],
						&turn_sig_speed[pair_slot],
					)
					turn_status[pair_slot] = 1
				else:
					turn_status[pair_slot] = 0
			if turn_status[pair_slot] == 1:
				turn_residual = _relative_delta_c(turn_prom_lon[pair_slot], turn_sig_lon[pair_slot], offset)
				if fabs(turn_residual) <= eps_deg:
					hit_speed = turn_prom_speed[pair_slot] - turn_sig_speed[pair_slot]
					_append_unique_c(
						hits_ptr,
						count_ptr,
						capacity_ptr,
						turn_jd[pair_slot],
						int(i),
						0.0,
						0.0,
						_HIT_LONGITUDE,
						hit_speed,
						1 if hit_speed < 0.0 else 0,
					)
					continue
				if jd < turn_jd[pair_slot] < jd_next:
					_append_relative_segment_c(
						hits_ptr, count_ptr, capacity_ptr, int(i), prom_code, sig_code, offset,
						jd, turn_jd[pair_slot],
						lon0[prom_idx], speed0[prom_idx], lon0[sig_idx], speed0[sig_idx],
						turn_prom_lon[pair_slot], turn_prom_speed[pair_slot], turn_sig_lon[pair_slot], turn_sig_speed[pair_slot],
						flags, eps_deg, eps_days,
					)
					_append_relative_segment_c(
						hits_ptr, count_ptr, capacity_ptr, int(i), prom_code, sig_code, offset,
						turn_jd[pair_slot], jd_next,
						turn_prom_lon[pair_slot], turn_prom_speed[pair_slot], turn_sig_lon[pair_slot], turn_sig_speed[pair_slot],
						lon1[prom_idx], speed1[prom_idx], lon1[sig_idx], speed1[sig_idx],
						flags, eps_deg, eps_days,
					)
					continue
			_append_relative_segment_c(
				hits_ptr, count_ptr, capacity_ptr, int(i), prom_code, sig_code, offset,
				jd, jd_next,
				lon0[prom_idx], speed0[prom_idx], lon0[sig_idx], speed0[sig_idx],
				lon1[prom_idx], speed1[prom_idx], lon1[sig_idx], speed1[sig_idx],
				flags, eps_deg, eps_days,
			)
		for i in range(body_count):
			lon0[i] = lon1[i]
			speed0[i] = speed1[i]
		jd = jd_next
	return 0


cpdef list search_station_times_raw(
	int planet,
	double jd_start,
	double jd_end,
	object ephe_path=None,
	int flags=0,
	object sidereal_mode=None,
	object topocentric_position=None,
	object step_days=None,
	double eps_speed=STATION_SPEED_EPS,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef bint lock_held = False
	cdef double base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
	cdef double slice_start
	cdef double slice_end
	try:
		_validate_scan_bounds(jd_start, jd_end)
		_validate_positive_double(base_step, "step_days")
		_validate_positive_double(eps_speed, "eps_speed")
		_validate_positive_double(eps_days, "eps_days")
		slice_start = jd_start
		while slice_start < jd_end:
			slice_end = min(jd_end, slice_start + _MAX_NATIVE_LOCK_SPAN_DAYS)
			with nogil:
				_acquire_native_swe_lock()
			lock_held = True
			_configure_ephemeris_context(ephe_path, flags, sidereal_mode, topocentric_position)
			with nogil:
				_search_station_times_into_c(planet, slice_start, slice_end, flags, base_step, eps_speed, eps_days, &hits, &count, &capacity)
				_release_native_swe_lock()
			lock_held = False
			slice_start = slice_end
		return _hits_to_python(hits, count)
	finally:
		if lock_held:
			with nogil:
				_release_native_swe_lock()
		if hits != NULL:
			free(hits)


cpdef list search_station_times_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object ephe_path=None,
	int flags=0,
	object sidereal_mode=None,
	object topocentric_position=None,
	object step_days=None,
	double eps_speed=STATION_SPEED_EPS,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef int planet
	cdef bint lock_held = False
	cdef double base_step
	cdef double slice_start
	cdef double slice_end
	try:
		_validate_scan_bounds(jd_start, jd_end)
		_validate_positive_double(eps_speed, "eps_speed")
		_validate_positive_double(eps_days, "eps_days")
		planets = list(planets)
		for planet in planets:
			base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
			_validate_positive_double(base_step, "step_days")
		slice_start = jd_start
		while slice_start < jd_end:
			slice_end = min(jd_end, slice_start + _MAX_NATIVE_LOCK_SPAN_DAYS)
			for planet in planets:
				base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
				with nogil:
					_acquire_native_swe_lock()
				lock_held = True
				_configure_ephemeris_context(ephe_path, flags, sidereal_mode, topocentric_position)
				with nogil:
					_search_station_times_into_c(int(planet), slice_start, slice_end, flags, base_step, eps_speed, eps_days, &hits, &count, &capacity)
					_release_native_swe_lock()
				lock_held = False
			slice_start = slice_end
		return _hits_to_python(hits, count)
	finally:
		if lock_held:
			with nogil:
				_release_native_swe_lock()
		if hits != NULL:
			free(hits)


cpdef list search_longitude_transits_raw(
	int planet,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=None,
	int flags=0,
	object sidereal_mode=None,
	object topocentric_position=None,
	object step_days=None,
	double eps_deg=DEFAULT_EPS_DEG,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef double* unique_targets = NULL
	cdef size_t target_count = 0
	cdef bint lock_held = False
	cdef double base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
	cdef double slice_start
	cdef double slice_end
	try:
		_validate_scan_bounds(jd_start, jd_end)
		_validate_positive_double(base_step, "step_days")
		_validate_positive_double(eps_deg, "eps_deg")
		_validate_positive_double(eps_days, "eps_days")
		_prepare_targets_c(targets_deg, &unique_targets, &target_count)
		if target_count == 0:
			return []
		slice_start = jd_start
		while slice_start < jd_end:
			slice_end = min(jd_end, slice_start + _MAX_NATIVE_LOCK_SPAN_DAYS)
			with nogil:
				_acquire_native_swe_lock()
			lock_held = True
			_configure_ephemeris_context(ephe_path, flags, sidereal_mode, topocentric_position)
			with nogil:
				_search_longitude_transits_prepared_into_c(planet, slice_start, slice_end, unique_targets, target_count, flags, base_step, eps_deg, eps_days, &hits, &count, &capacity)
				_release_native_swe_lock()
			lock_held = False
			slice_start = slice_end
		return _hits_to_python(hits, count)
	finally:
		if lock_held:
			with nogil:
				_release_native_swe_lock()
		if hits != NULL:
			free(hits)
		if unique_targets != NULL:
			free(unique_targets)


cpdef list search_longitude_transits_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=None,
	int flags=0,
	object sidereal_mode=None,
	object topocentric_position=None,
	object step_days=None,
	double eps_deg=DEFAULT_EPS_DEG,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef int planet
	cdef double* unique_targets = NULL
	cdef size_t target_count = 0
	cdef bint lock_held = False
	cdef double base_step
	cdef double slice_start
	cdef double slice_end
	try:
		_validate_scan_bounds(jd_start, jd_end)
		_validate_positive_double(eps_deg, "eps_deg")
		_validate_positive_double(eps_days, "eps_days")
		planets = list(planets)
		for planet in planets:
			base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
			_validate_positive_double(base_step, "step_days")
		_prepare_targets_c(targets_deg, &unique_targets, &target_count)
		if target_count == 0 or not planets:
			return []
		slice_start = jd_start
		while slice_start < jd_end:
			slice_end = min(jd_end, slice_start + _MAX_NATIVE_LOCK_SPAN_DAYS)
			for planet in planets:
				base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
				with nogil:
					_acquire_native_swe_lock()
				lock_held = True
				_configure_ephemeris_context(ephe_path, flags, sidereal_mode, topocentric_position)
				with nogil:
					_search_longitude_transits_prepared_into_c(int(planet), slice_start, slice_end, unique_targets, target_count, flags, base_step, eps_deg, eps_days, &hits, &count, &capacity)
					_release_native_swe_lock()
				lock_held = False
			slice_start = slice_end
		return _hits_to_python(hits, count)
	finally:
		if lock_held:
			with nogil:
				_release_native_swe_lock()
		if hits != NULL:
			free(hits)
		if unique_targets != NULL:
			free(unique_targets)


cpdef list search_relative_aspects_batch_raw(
	object body_codes,
	double jd_start,
	double jd_end,
	object specs,
	object ephe_path=None,
	int flags=0,
	object sidereal_mode=None,
	object topocentric_position=None,
	object step_days=None,
	double eps_deg=DEFAULT_EPS_DEG,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef double base_step = float(default_relative_step_days_for_bodies(body_codes, specs) if step_days is None else step_days)
	cdef Py_ssize_t body_count = len(body_codes)
	cdef Py_ssize_t spec_count = len(specs)
	cdef int* body_code_arr = NULL
	cdef int* prom_indices = NULL
	cdef int* sig_indices = NULL
	cdef int* pair_slots = NULL
	cdef int* turn_status = NULL
	cdef double* spec_offsets = NULL
	cdef double* lon0 = NULL
	cdef double* lon1 = NULL
	cdef double* speed0 = NULL
	cdef double* speed1 = NULL
	cdef double* turn_jd = NULL
	cdef double* turn_prom_lon = NULL
	cdef double* turn_prom_speed = NULL
	cdef double* turn_sig_lon = NULL
	cdef double* turn_sig_speed = NULL
	cdef Py_ssize_t i
	cdef Py_ssize_t pair_count = 0
	cdef int prom_idx
	cdef int sig_idx
	cdef int pair_slot
	cdef dict pair_slot_by_indices = {}
	cdef object pair_key
	cdef bint lock_held = False
	cdef double slice_start
	cdef double slice_end
	try:
		_validate_scan_bounds(jd_start, jd_end)
		_validate_positive_double(base_step, "step_days")
		_validate_positive_double(eps_deg, "eps_deg")
		_validate_positive_double(eps_days, "eps_days")
		if body_count == 0 or spec_count == 0:
			return []
		body_code_arr = <int*>malloc(body_count * cython.sizeof(int))
		prom_indices = <int*>malloc(spec_count * cython.sizeof(int))
		sig_indices = <int*>malloc(spec_count * cython.sizeof(int))
		pair_slots = <int*>malloc(spec_count * cython.sizeof(int))
		turn_status = <int*>malloc(spec_count * cython.sizeof(int))
		spec_offsets = <double*>malloc(spec_count * cython.sizeof(double))
		lon0 = <double*>malloc(body_count * cython.sizeof(double))
		lon1 = <double*>malloc(body_count * cython.sizeof(double))
		speed0 = <double*>malloc(body_count * cython.sizeof(double))
		speed1 = <double*>malloc(body_count * cython.sizeof(double))
		turn_jd = <double*>malloc(spec_count * cython.sizeof(double))
		turn_prom_lon = <double*>malloc(spec_count * cython.sizeof(double))
		turn_prom_speed = <double*>malloc(spec_count * cython.sizeof(double))
		turn_sig_lon = <double*>malloc(spec_count * cython.sizeof(double))
		turn_sig_speed = <double*>malloc(spec_count * cython.sizeof(double))
		if (
			body_code_arr == NULL
			or prom_indices == NULL
			or sig_indices == NULL
			or pair_slots == NULL
			or turn_status == NULL
			or spec_offsets == NULL
			or lon0 == NULL
			or lon1 == NULL
			or speed0 == NULL
			or speed1 == NULL
			or turn_jd == NULL
			or turn_prom_lon == NULL
			or turn_prom_speed == NULL
			or turn_sig_lon == NULL
			or turn_sig_speed == NULL
		):
			raise MemoryError("Could not allocate relative-aspect state buffers")
		for i in range(body_count):
			body_code_arr[i] = int(body_codes[i])
		for i in range(spec_count):
			prom_idx = int(specs[i][0])
			sig_idx = int(specs[i][1])
			if prom_idx < 0 or prom_idx >= body_count:
				raise ValueError("relative-aspect promittor index is out of range")
			if sig_idx < 0 or sig_idx >= body_count:
				raise ValueError("relative-aspect significator index is out of range")
			prom_indices[i] = prom_idx
			sig_indices[i] = sig_idx
			pair_key = (prom_idx, sig_idx)
			pair_slot = int(pair_slot_by_indices.get(pair_key, -1))
			if pair_slot < 0:
				pair_slot = int(pair_count)
				pair_slot_by_indices[pair_key] = pair_slot
				pair_count += 1
			pair_slots[i] = pair_slot
			spec_offsets[i] = float(specs[i][2])
			if not isfinite(spec_offsets[i]):
				raise ValueError("relative-aspect offsets must be finite")
		slice_start = jd_start
		while slice_start < jd_end:
			slice_end = min(jd_end, slice_start + _MAX_NATIVE_LOCK_SPAN_DAYS)
			with nogil:
				_acquire_native_swe_lock()
			lock_held = True
			_configure_ephemeris_context(ephe_path, flags, sidereal_mode, topocentric_position)
			with nogil:
				_search_relative_aspects_into_c(
					body_code_arr,
					body_count,
					prom_indices,
					sig_indices,
					pair_slots,
					pair_count,
					spec_offsets,
					spec_count,
					slice_start,
					slice_end,
					base_step,
					flags,
					eps_deg,
					eps_days,
					lon0,
					lon1,
					speed0,
					speed1,
					turn_status,
					turn_jd,
					turn_prom_lon,
					turn_prom_speed,
					turn_sig_lon,
					turn_sig_speed,
					&hits,
					&count,
					&capacity,
				)
				_release_native_swe_lock()
			lock_held = False
			slice_start = slice_end
		return _hits_to_python(hits, count)
	finally:
		if lock_held:
			with nogil:
				_release_native_swe_lock()
		if hits != NULL:
			free(hits)
		if body_code_arr != NULL:
			free(body_code_arr)
		if prom_indices != NULL:
			free(prom_indices)
		if sig_indices != NULL:
			free(sig_indices)
		if pair_slots != NULL:
			free(pair_slots)
		if turn_status != NULL:
			free(turn_status)
		if spec_offsets != NULL:
			free(spec_offsets)
		if lon0 != NULL:
			free(lon0)
		if lon1 != NULL:
			free(lon1)
		if speed0 != NULL:
			free(speed0)
		if speed1 != NULL:
			free(speed1)
		if turn_jd != NULL:
			free(turn_jd)
		if turn_prom_lon != NULL:
			free(turn_prom_lon)
		if turn_prom_speed != NULL:
			free(turn_prom_speed)
		if turn_sig_lon != NULL:
			free(turn_sig_lon)
		if turn_sig_speed != NULL:
			free(turn_sig_speed)
