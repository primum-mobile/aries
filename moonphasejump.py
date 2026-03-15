# -*- coding: utf-8 -*-

import astrology
import chart
import util


PHASE_ANGLES = (0.0, 90.0, 180.0, 270.0)
SEARCH_STEP_DAYS = 0.25
SEARCH_WINDOW_DAYS = 10.0
PHASE_EPSILON_DEG = 1e-3
PHASE_FLAGS = astrology.SEFLG_SWIEPH


def _planet_lon_ut(jd_ut, ipl):
	serr, xx = astrology.swe_calc_ut(float(jd_ut), int(ipl), int(PHASE_FLAGS))
	if not xx:
		raise ValueError(serr or 'Swiss Ephemeris returned no data')
	return float(xx[0])


def phase_angle_ut(jd_ut):
	sun_lon = _planet_lon_ut(jd_ut, astrology.SE_SUN)
	moon_lon = _planet_lon_ut(jd_ut, astrology.SE_MOON)
	return util.normalize(moon_lon - sun_lon)


def _signed_phase_delta(angle, target):
	diff = util.normalize(float(angle) - float(target))
	if diff > 180.0:
		diff -= 360.0
	return diff


def _pick_phase_target(angle, direction):
	angle = util.normalize(angle)
	direction = 1 if direction >= 0 else -1

	for index, target in enumerate(PHASE_ANGLES):
		if abs(_signed_phase_delta(angle, target)) <= PHASE_EPSILON_DEG:
			return PHASE_ANGLES[(index + direction) % len(PHASE_ANGLES)]

	if direction > 0:
		best = None
		for target in PHASE_ANGLES:
			dist = target - angle
			if dist <= PHASE_EPSILON_DEG:
				dist += 360.0
			candidate = (dist, target)
			if best is None or candidate < best:
				best = candidate
		return best[1]

	best = None
	for target in PHASE_ANGLES:
		dist = angle - target
		if dist <= PHASE_EPSILON_DEG:
			dist += 360.0
		candidate = (dist, target)
		if best is None or candidate < best:
			best = candidate
	return best[1]


def _find_phase_bracket(jd_start, target, direction):
	step = SEARCH_STEP_DAYS if direction >= 0 else -SEARCH_STEP_DAYS
	prev_jd = float(jd_start)
	prev_val = _signed_phase_delta(phase_angle_ut(prev_jd), target)
	steps = int(SEARCH_WINDOW_DAYS / SEARCH_STEP_DAYS) + 2

	for _ in range(steps):
		next_jd = prev_jd + step
		next_val = _signed_phase_delta(phase_angle_ut(next_jd), target)
		if prev_val == 0.0 or next_val == 0.0 or (prev_val < 0.0 <= next_val) or (prev_val > 0.0 >= next_val):
			return (prev_jd, next_jd)
		prev_jd = next_jd
		prev_val = next_val

	return None


def _bisect_phase_root(jd_a, jd_b, target):
	lo = min(float(jd_a), float(jd_b))
	hi = max(float(jd_a), float(jd_b))
	f_lo = _signed_phase_delta(phase_angle_ut(lo), target)
	f_hi = _signed_phase_delta(phase_angle_ut(hi), target)

	if abs(f_lo) < 1e-8:
		return lo
	if abs(f_hi) < 1e-8:
		return hi

	for _ in range(48):
		mid = 0.5 * (lo + hi)
		f_mid = _signed_phase_delta(phase_angle_ut(mid), target)
		if abs(f_mid) < 1e-8 or abs(hi - lo) < 1e-6:
			return mid
		if (f_lo < 0.0 <= f_mid) or (f_lo > 0.0 >= f_mid):
			hi = mid
			f_hi = f_mid
		else:
			lo = mid
			f_lo = f_mid

	return 0.5 * (lo + hi)


def _jd_to_ymdhms(jd_value, calflag):
	year, month, day, hour = astrology.swe_revjul(float(jd_value), int(calflag))
	total = int(round(float(hour) * 3600.0))
	if total >= 24 * 3600:
		total -= 24 * 3600
		year, month, day = util.incrDay(int(year), int(month), int(day))
	elif total < 0:
		total += 24 * 3600
		year, month, day = util.decrDay(int(year), int(month), int(day))

	hour = total // 3600
	total %= 3600
	minute = total // 60
	second = total % 60
	return int(year), int(month), int(day), int(hour), int(minute), int(second)


def _place_lon_hours(place):
	lon = float(place.deglon) + float(place.minlon) / 60.0
	if not place.east:
		lon *= -1.0
	return lon / 15.0


def _utc_jd_to_original_components(jd_ut, template_time, place):
	calflag = astrology.SE_GREG_CAL
	if template_time.cal == chart.Time.JULIAN:
		calflag = astrology.SE_JUL_CAL

	if template_time.zt == chart.Time.GREENWICH:
		local_jd = jd_ut
	elif template_time.zt == chart.Time.ZONE:
		ztime = float(template_time.zh) + float(template_time.zm) / 60.0
		offset_hours = ztime if template_time.plus else -ztime
		if template_time.daylightsaving:
			offset_hours += 1.0
		local_jd = jd_ut + offset_hours / 24.0
	elif template_time.zt == chart.Time.LOCALMEAN:
		offset_hours = _place_lon_hours(place)
		if template_time.daylightsaving:
			offset_hours += 1.0
		local_jd = jd_ut + offset_hours / 24.0
	elif template_time.zt == chart.Time.LOCALAPPARENT:
		jd_lmt = jd_ut + _place_lon_hours(place) / 24.0
		apparent_jd = jd_lmt
		for _ in range(8):
			ret, te, serr = astrology.swe_time_equ(apparent_jd)
			apparent_jd = jd_lmt - float(te)
		if template_time.daylightsaving:
			apparent_jd += 1.0 / 24.0
		local_jd = apparent_jd
	else:
		local_jd = jd_ut

	year, month, day, hour, minute, second = _jd_to_ymdhms(local_jd, calflag)
	if template_time.bc and year <= 0:
		year = 1 - year
	return year, month, day, hour, minute, second


def jump_to_classical_phase(template_time, place, direction):
	direction = 1 if direction >= 0 else -1
	jd_start = float(template_time.jd)
	target = _pick_phase_target(phase_angle_ut(jd_start), direction)
	bracket = _find_phase_bracket(jd_start, target, direction)
	if bracket is None:
		return None

	jd_target = _bisect_phase_root(bracket[0], bracket[1], target)
	y, m, d, h, mi, s = _utc_jd_to_original_components(jd_target, template_time, place)
	return chart.Time(
		y, m, d, h, mi, s,
		template_time.bc, template_time.cal, template_time.zt,
		template_time.plus, template_time.zh, template_time.zm,
		template_time.daylightsaving, place, False
	)
