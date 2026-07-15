# cython: language_level=3

from libc.math cimport fabs
from libc.stdlib cimport free, malloc, realloc
from libc.string cimport memset

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
from ._swe_bridge cimport swe_calc_ut, swe_set_ephe_path
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


cdef inline double _wrap360_c(double x):
	cdef double value = x % 360.0
	if value < 0.0:
		value += 360.0
	return value


cdef inline double _wrap180_c(double x):
	cdef double value = _wrap360_c(x)
	if value >= 180.0:
		value -= 360.0
	return value


cdef inline double _relative_delta_c(double prom_lon, double sig_lon, double offset):
	cdef double target = sig_lon + offset
	if target < 0.0:
		target += 360.0
	elif target >= 360.0:
		target -= 360.0
	return _wrap180_c(prom_lon - target)


cdef inline bint _crossed_zero_c(double f0, double f1):
	if f0 == 0.0 or f1 == 0.0:
		return True
	return (f0 < 0.0 < f1) or (f1 < 0.0 < f0)


cdef inline bint _is_longitude_zero_crossing_c(double f0, double f1):
	if not _crossed_zero_c(f0, f1):
		return False
	return fabs(f1 - f0) < 180.0


cdef inline bint _is_relative_zero_crossing_c(double f0, double f1, double eps_deg):
	if fabs(f0) <= eps_deg or fabs(f1) <= eps_deg:
		return True
	if not _crossed_zero_c(f0, f1):
		return False
	return fabs(f1 - f0) < 180.0


cdef inline double _adaptive_step_c(double base_step, double speed, double eps_days):
	cdef double abs_speed = fabs(speed)
	cdef double step = base_step
	if abs_speed <= LOW_SPEED_WARN:
		step *= 0.25
	elif abs_speed >= 2.0:
		step *= 1.5
	if step < eps_days * 64.0:
		step = eps_days * 64.0
	if step < 1e-4:
		step = 1e-4
	return step


cdef inline double _adaptive_station_step_c(double base_step, double speed, double eps_days):
	cdef double abs_speed = fabs(speed)
	cdef double step = base_step
	if abs_speed <= STATION_SPEED_EPS * 100.0:
		step *= 0.1
	elif abs_speed <= LOW_SPEED_WARN:
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


cdef inline size_t _lower_bound_c(double* values, size_t count, double target):
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


cdef inline size_t _upper_bound_c(double* values, size_t count, double target):
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


cdef inline bint _can_use_direct_crossing_c(int planet, int flags):
	if planet != _astrology.SE_SUN and planet != _astrology.SE_MOON:
		return False
	return (flags & _DIRECT_UNSUPPORTED_FLAGS) == 0


cdef double _direct_cross_ut_c(int planet, double target_deg, double jd_ut, int flags) except? -2.0:
	cdef char serr[256]
	cdef double result
	memset(serr, 0, sizeof(serr))
	if planet == _astrology.SE_MOON:
		result = swe_mooncross_ut(target_deg, jd_ut, flags | _astrology.SEFLG_SWIEPH, serr)
	else:
		result = swe_solcross_ut(target_deg, jd_ut, flags | _astrology.SEFLG_SWIEPH, serr)
	if result < 0.0:
		raise RuntimeError(f"Swiss Ephemeris returned no crossing data for planet={planet} target={target_deg} jd={jd_ut}: {(<bytes>serr).decode('utf-8', 'ignore')!r}")
	return result


cdef int _eval_lon_speed(double jd_ut, int planet, int flags, double* lon, double* speed) except -1:
	cdef double xx[6]
	cdef char serr[256]
	cdef int retflag
	memset(serr, 0, sizeof(serr))
	retflag = swe_calc_ut(jd_ut, planet, flags | _astrology.SEFLG_SWIEPH | _astrology.SEFLG_SPEED, xx, serr)
	if retflag < 0:
		raise RuntimeError(f"Swiss Ephemeris returned no longitude data for planet={planet} jd={jd_ut}: {(<bytes>serr).decode('utf-8', 'ignore')!r}")
	lon[0] = xx[0]
	speed[0] = xx[3]
	return 0


cdef int _eval_body_lon_speed(double jd_ut, int body_code, int flags, double* lon, double* speed) except -1:
	cdef int planet = body_code
	cdef bint is_desc = False
	if planet >= 1000:
		planet -= 1000
		is_desc = True
	_eval_lon_speed(jd_ut, planet, flags, lon, speed)
	if is_desc:
		lon[0] = _wrap360_c(lon[0] + 180.0)
	return 0


cdef int _ensure_capacity(CHit** hits_ptr, size_t* capacity_ptr, size_t needed) except -1:
	cdef size_t new_capacity
	cdef void* new_ptr
	if needed <= capacity_ptr[0]:
		return 0
	new_capacity = 16 if capacity_ptr[0] == 0 else capacity_ptr[0] * 2
	while new_capacity < needed:
		new_capacity *= 2
	new_ptr = realloc(hits_ptr[0], new_capacity * cython.sizeof(CHit))
	if new_ptr == NULL:
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
) except -1:
	cdef size_t i = count_ptr[0]
	cdef CHit* hits = hits_ptr[0]
	while i > 0:
		i -= 1
		if hits[i].planet != planet:
			break
		if hits[i].jd_ut + DEDUP_EPS_DAYS < jd_ut:
			break
		if (
			fabs(hits[i].jd_ut - jd_ut) < DEDUP_EPS_DAYS
			and hits[i].planet == planet
			and hits[i].hit_kind == hit_kind
			and fabs(hits[i].target_deg - target_deg) < DEFAULT_EPS_DEG
			and fabs(hits[i].aspect_deg - aspect_deg) < DEFAULT_EPS_DEG
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


cdef tuple _refine_station_root_c(int planet, double jd_lo, double jd_hi, int flags, double eps_speed, double eps_days):
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double lon_tmp
	cdef double slo
	cdef double shi
	_eval_lon_speed(lo, planet, flags, &lon_tmp, &slo)
	_eval_lon_speed(hi, planet, flags, &lon_tmp, &shi)
	return _refine_station_root_seeded_c(lo, slo, hi, shi, planet, flags, eps_speed, eps_days)


cdef tuple _refine_station_root_seeded_c(
	double jd_lo,
	double speed_lo,
	double jd_hi,
	double speed_hi,
	int planet,
	int flags,
	double eps_speed,
	double eps_days,
):
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

	for i in range(BISECTION_MAX_ITERS):
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
			return mid, smid
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

	return best_jd, best_speed


cdef tuple _refine_longitude_root_c(int planet, double target_deg, double jd_lo, double jd_hi, int flags, double eps_deg, double eps_days):
	cdef double lo = jd_lo
	cdef double hi = jd_hi
	cdef double lon_lo
	cdef double lon_hi
	cdef double speed_lo
	cdef double speed_hi
	cdef double lon_x
	cdef double speed_x
	cdef double f_lo
	cdef double f_hi
	cdef double f_x
	cdef double best_jd
	cdef double best_err
	cdef double best_speed
	cdef double x = (lo + hi) * 0.5
	cdef double x_next
	cdef int i
	_eval_lon_speed(lo, planet, flags, &lon_lo, &speed_lo)
	_eval_lon_speed(hi, planet, flags, &lon_hi, &speed_hi)
	return _refine_longitude_root_seeded_c(
		planet,
		target_deg,
		lo,
		lon_lo,
		speed_lo,
		hi,
		lon_hi,
		speed_hi,
		flags,
		eps_deg,
		eps_days,
	)


cdef tuple _refine_longitude_root_seeded_c(
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
):
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
	if fabs(speed_lo) > STATION_SPEED_EPS:
		x = lo - (f_lo / speed_lo)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif fabs(speed_hi) > STATION_SPEED_EPS:
		x = hi - (f_hi / speed_hi)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for i in range(NEWTON_MAX_ITERS + BISECTION_MAX_ITERS):
		_eval_lon_speed(x, planet, flags, &lon_x, &speed_x)
		f_x = _wrap180_c(lon_x - target_deg)
		if fabs(f_x) < fabs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if fabs(f_x) <= eps_deg or (hi - lo) <= eps_days:
			return x, speed_x
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

		if fabs(speed_x) > STATION_SPEED_EPS:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	return best_jd, best_speed


cdef tuple _refine_relative_root_c(
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
):
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
	if fabs(speed_lo) > STATION_SPEED_EPS:
		x = lo - (f_lo / speed_lo)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	elif fabs(speed_hi) > STATION_SPEED_EPS:
		x = hi - (f_hi / speed_hi)
		if x <= lo or x >= hi:
			x = (lo + hi) * 0.5
	else:
		x = (lo + hi) * 0.5

	for i in range(NEWTON_MAX_ITERS + BISECTION_MAX_ITERS):
		_eval_body_lon_speed(x, prom_code, flags, &prom_lon_x, &prom_speed_x)
		_eval_body_lon_speed(x, sig_code, flags, &sig_lon_x, &sig_speed_x)
		speed_x = prom_speed_x - sig_speed_x
		f_x = _relative_delta_c(prom_lon_x, sig_lon_x, offset)
		if fabs(f_x) < fabs(best_err):
			best_jd = x
			best_err = f_x
			best_speed = speed_x
		if fabs(f_x) <= eps_deg or (hi - lo) <= eps_days:
			return x, speed_x
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
		if fabs(speed_x) > STATION_SPEED_EPS:
			x_next = x - (f_x / speed_x)
			if x_next <= lo or x_next >= hi:
				x_next = (lo + hi) * 0.5
		else:
			x_next = (lo + hi) * 0.5
		x = x_next

	return best_jd, best_speed


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
) except -1:
	cdef size_t idx
	cdef double target_deg
	cdef double f_lo
	cdef double f_hi
	cdef double hit_jd
	cdef double hit_speed
	for idx in range(idx_lo, idx_hi):
		target_deg = targets[idx]
		f_lo = _wrap180_c(lon_lo - target_deg)
		f_hi = _wrap180_c(lon_hi - target_deg)
		if fabs(f_lo) <= eps_deg:
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, jd_lo, planet, target_deg, 0.0, HIT_LONGITUDE, speed_lo, 1 if speed_lo < 0.0 else 0)
		elif fabs(f_hi) <= eps_deg:
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, jd_hi, planet, target_deg, 0.0, HIT_LONGITUDE, speed_hi, 1 if speed_hi < 0.0 else 0)
		elif _is_longitude_zero_crossing_c(f_lo, f_hi):
			hit_jd, hit_speed = _refine_longitude_root_seeded_c(
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
			)
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, target_deg, 0.0, HIT_LONGITUDE, hit_speed, 1 if hit_speed < 0.0 else 0)
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
) except -1:
	cdef double forward_span
	cdef double reverse_span
	cdef int direction
	cdef size_t idx_lo
	cdef size_t idx_hi
	if jd_hi <= jd_lo or target_count == 0:
		return 0
	if fabs(speed_lo) > STATION_SPEED_EPS:
		direction = 1 if speed_lo > 0.0 else -1
	elif fabs(speed_hi) > STATION_SPEED_EPS:
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
) except -1:
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
			if hit_jd < jd_start - DEDUP_EPS_DAYS:
				probe_jd += 1e-6
				continue
			if hit_jd > jd_end + DEDUP_EPS_DAYS:
				break
			_eval_lon_speed(hit_jd, planet, flags, &lon, &speed)
			_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, target_deg, 0.0, HIT_LONGITUDE, speed, 1 if speed < 0.0 else 0)
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
	object step_days,
	double eps_speed,
	double eps_days,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1:
	cdef double base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
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
		if fabs(speed0) <= eps_speed or fabs(speed1) <= eps_speed or _crossed_zero_c(speed0, speed1) or fabs(speed0) <= LOW_SPEED_WARN or fabs(speed1) <= LOW_SPEED_WARN:
			hit_jd, hit_speed = _refine_station_root_seeded_c(jd, speed0, jd_next, speed1, planet, flags, eps_speed, eps_days)
			if jd_start <= hit_jd <= jd_end and fabs(hit_speed) <= accept_speed:
				_append_unique_c(hits_ptr, count_ptr, capacity_ptr, hit_jd, planet, 0.0, 0.0, HIT_STATION, hit_speed, 1 if hit_speed < 0.0 else 0)
		jd = jd_next
		lon0 = lon1
		speed0 = speed1
	return 0


cdef int _search_longitude_transits_into_c(
	int planet,
	double jd_start,
	double jd_end,
	object targets_deg,
	int flags,
	object step_days,
	double eps_deg,
	double eps_days,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1:
	cdef double* unique_targets = NULL
	cdef size_t target_count = 0
	try:
		_prepare_targets_c(targets_deg, &unique_targets, &target_count)
		return _search_longitude_transits_prepared_into_c(
			planet,
			jd_start,
			jd_end,
			unique_targets,
			target_count,
			flags,
			step_days,
			eps_deg,
			eps_days,
			hits_ptr,
			count_ptr,
			capacity_ptr,
		)
	finally:
		if unique_targets != NULL:
			free(unique_targets)


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
		target_value = _wrap360_c(float(target))
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
	object step_days,
	double eps_deg,
	double eps_days,
	CHit** hits_ptr,
	size_t* count_ptr,
	size_t* capacity_ptr,
) except -1:
	cdef double base_step = float(default_step_days_for_planet(planet) if step_days is None else step_days)
	cdef double jd
	cdef double jd_next
	cdef double station_jd
	cdef double station_speed
	cdef double station_lon
	cdef double lon0
	cdef double lon1
	cdef double speed0
	cdef double speed1
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
		have_station = _crossed_zero_c(speed0, speed1) or fabs(speed0) <= LOW_SPEED_WARN or fabs(speed1) <= LOW_SPEED_WARN
		if have_station:
			station_jd, station_speed = _refine_station_root_seeded_c(jd, speed0, jd_next, speed1, planet, flags, STATION_SPEED_EPS, eps_days)
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


cpdef list search_station_times_raw(
	int planet,
	double jd_start,
	double jd_end,
	object ephe_path=None,
	int flags=0,
	object step_days=None,
	double eps_speed=STATION_SPEED_EPS,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	try:
		if ephe_path:
			swe_set_ephe_path(ephe_path.encode("utf-8"))
		_search_station_times_into_c(planet, jd_start, jd_end, flags, step_days, eps_speed, eps_days, &hits, &count, &capacity)
		return _hits_to_python(hits, count)
	finally:
		if hits != NULL:
			free(hits)


cpdef list search_station_times_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object ephe_path=None,
	int flags=0,
	object step_days=None,
	double eps_speed=STATION_SPEED_EPS,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	cdef int planet
	try:
		if ephe_path:
			swe_set_ephe_path(ephe_path.encode("utf-8"))
		for planet in planets:
			_search_station_times_into_c(int(planet), jd_start, jd_end, flags, step_days, eps_speed, eps_days, &hits, &count, &capacity)
		return _hits_to_python(hits, count)
	finally:
		if hits != NULL:
			free(hits)


cpdef list search_longitude_transits_raw(
	int planet,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=None,
	int flags=0,
	object step_days=None,
	double eps_deg=DEFAULT_EPS_DEG,
	double eps_days=DEFAULT_EPS_DAYS,
):
	cdef CHit* hits = NULL
	cdef size_t count = 0
	cdef size_t capacity = 0
	try:
		if ephe_path:
			swe_set_ephe_path(ephe_path.encode("utf-8"))
		_search_longitude_transits_into_c(planet, jd_start, jd_end, targets_deg, flags, step_days, eps_deg, eps_days, &hits, &count, &capacity)
		return _hits_to_python(hits, count)
	finally:
		if hits != NULL:
			free(hits)


cpdef list search_longitude_transits_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=None,
	int flags=0,
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
	try:
		if ephe_path:
			swe_set_ephe_path(ephe_path.encode("utf-8"))
		_prepare_targets_c(targets_deg, &unique_targets, &target_count)
		for planet in planets:
			_search_longitude_transits_prepared_into_c(int(planet), jd_start, jd_end, unique_targets, target_count, flags, step_days, eps_deg, eps_days, &hits, &count, &capacity)
		return _hits_to_python(hits, count)
	finally:
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
	cdef double* spec_offsets = NULL
	cdef double* lon0 = NULL
	cdef double* lon1 = NULL
	cdef double* speed0 = NULL
	cdef double* speed1 = NULL
	cdef double jd = jd_start
	cdef double jd_next
	cdef Py_ssize_t i
	cdef int prom_idx
	cdef int sig_idx
	cdef int prom_code
	cdef int sig_code
	cdef double offset
	cdef double delta0
	cdef double delta1
	cdef double hit_jd
	cdef double hit_speed
	try:
		if ephe_path:
			swe_set_ephe_path(ephe_path.encode("utf-8"))
		if body_count == 0 or spec_count == 0:
			return []
		body_code_arr = <int*>malloc(body_count * cython.sizeof(int))
		prom_indices = <int*>malloc(spec_count * cython.sizeof(int))
		sig_indices = <int*>malloc(spec_count * cython.sizeof(int))
		spec_offsets = <double*>malloc(spec_count * cython.sizeof(double))
		lon0 = <double*>malloc(body_count * cython.sizeof(double))
		lon1 = <double*>malloc(body_count * cython.sizeof(double))
		speed0 = <double*>malloc(body_count * cython.sizeof(double))
		speed1 = <double*>malloc(body_count * cython.sizeof(double))
		if (
			body_code_arr == NULL
			or prom_indices == NULL
			or sig_indices == NULL
			or spec_offsets == NULL
			or lon0 == NULL
			or lon1 == NULL
			or speed0 == NULL
			or speed1 == NULL
		):
			raise MemoryError("Could not allocate weather state buffers")
		for i in range(body_count):
			body_code_arr[i] = int(body_codes[i])
			_eval_body_lon_speed(jd, body_code_arr[i], flags, &lon0[i], &speed0[i])
		for i in range(spec_count):
			prom_indices[i] = int(specs[i][0])
			sig_indices[i] = int(specs[i][1])
			spec_offsets[i] = float(specs[i][2])
		while jd < jd_end:
			jd_next = jd + base_step
			if jd_next > jd_end:
				jd_next = jd_end
			for i in range(body_count):
				_eval_body_lon_speed(jd_next, body_code_arr[i], flags, &lon1[i], &speed1[i])
			for i in range(spec_count):
				prom_idx = prom_indices[i]
				sig_idx = sig_indices[i]
				offset = spec_offsets[i]
				delta0 = _relative_delta_c(lon0[prom_idx], lon0[sig_idx], offset)
				delta1 = _relative_delta_c(lon1[prom_idx], lon1[sig_idx], offset)
				if not _is_relative_zero_crossing_c(delta0, delta1, eps_deg) and fabs(delta0) > eps_deg and fabs(delta1) > eps_deg:
					continue
				prom_code = body_code_arr[prom_idx]
				sig_code = body_code_arr[sig_idx]
				hit_jd, hit_speed = _refine_relative_root_c(
					prom_code,
					sig_code,
					offset,
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
					eps_deg,
					eps_days,
				)
				_append_unique_c(&hits, &count, &capacity, hit_jd, int(i), 0.0, 0.0, HIT_LONGITUDE, hit_speed, 1 if hit_speed < 0.0 else 0)
			for i in range(body_count):
				lon0[i] = lon1[i]
				speed0[i] = speed1[i]
			jd = jd_next
		return _hits_to_python(hits, count)
	finally:
		if hits != NULL:
			free(hits)
		if body_code_arr != NULL:
			free(body_code_arr)
		if prom_indices != NULL:
			free(prom_indices)
		if sig_indices != NULL:
			free(sig_indices)
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
