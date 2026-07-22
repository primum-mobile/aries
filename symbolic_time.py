# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime
import math
import calendar
try:
	from zoneinfo import ZoneInfo
except Exception:
	ZoneInfo = None

import astrology
import chart
import posfordate
import util

SECONDARY_MEAN_YEAR_DAYS = 365.24219907
MEAN_TERTIARY_PERIOD_DAYS = 27.32158648
BIJA_RATIO = 0.997269566


def _calflag_from_chart(chrt):
	if chrt is not None and getattr(chrt.time, 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _jd_to_datetime_tuple(jd_value, calflag):
	y, m, d, hour = astrology.swe_revjul(float(jd_value), calflag)
	hh, mm, ss = util.decToDeg(hour)
	return int(y), int(m), int(d), int(hh), int(mm), int(ss)


def _display_tzinfo(radix_chart):
	tzid = getattr(getattr(radix_chart, 'time', None), 'tzid', '') if radix_chart is not None else ''
	if tzid and ZoneInfo is not None:
		try:
			return ZoneInfo(tzid)
		except Exception:
			pass
	try:
		return datetime.datetime.now().astimezone().tzinfo
	except Exception:
		return None


def _display_datetime_to_jd(dt_tuple, calflag, radix_chart=None):
	y, m, d, h, mi, s = [int(v) for v in dt_tuple]
	tzinfo = _display_tzinfo(radix_chart)
	if tzinfo is not None:
		try:
			local_dt = datetime.datetime(y, m, d, h, mi, s, tzinfo=tzinfo)
			utc_dt = local_dt.astimezone(datetime.timezone.utc)
			ut = float(utc_dt.hour) + float(utc_dt.minute) / 60.0 + float(utc_dt.second) / 3600.0
			return astrology.swe_julday(int(utc_dt.year), int(utc_dt.month), int(utc_dt.day), ut, calflag)
		except Exception:
			pass
	ut = float(h) + float(mi) / 60.0 + float(s) / 3600.0
	return astrology.swe_julday(y, m, d, ut, calflag)


def _jd_to_display_datetime_tuple(jd_value, calflag, radix_chart=None):
	utc_tuple = _jd_to_datetime_tuple(jd_value, calflag)
	tzinfo = _display_tzinfo(radix_chart)
	if tzinfo is not None:
		try:
			uy, um, ud, uh, umi, us = utc_tuple
			utc_dt = datetime.datetime(uy, um, ud, uh, umi, us, tzinfo=datetime.timezone.utc)
			local_dt = utc_dt.astimezone(tzinfo)
			return (
				int(local_dt.year), int(local_dt.month), int(local_dt.day),
				int(local_dt.hour), int(local_dt.minute), int(local_dt.second),
			)
		except Exception:
			pass
	return utc_tuple


def _anniversary_datetime_tuple(radix_chart, year_value):
	if radix_chart is None or getattr(radix_chart, 'time', None) is None:
		return int(year_value), 1, 1, 0, 0, 0
	t = radix_chart.time
	month = int(getattr(t, 'origmonth', t.month))
	day = int(getattr(t, 'origday', t.day))
	hour = int(getattr(t, 'hour', 0))
	minute = int(getattr(t, 'minute', 0))
	second = int(getattr(t, 'second', 0))
	if month == 2 and day == 29:
		try:
			if not calendar.isleap(int(year_value)):
				day = 28
		except Exception:
			day = 28
	return int(year_value), month, day, hour, minute, second


def _local_datetime_from_tuple(dt_tuple):
	y, m, d, h, mi, s = [int(v) for v in dt_tuple]
	return datetime.datetime(y, m, d, h, mi, s)


def _round_datetime_to_second(value):
	if getattr(value, 'microsecond', 0) >= 500000:
		value = value + datetime.timedelta(seconds=1)
	return value.replace(microsecond=0)


def _effective_progression_method(method):
	method = posfordate.progression_method(method)
	if method == posfordate.SOLAR_ARC:
		return posfordate.SECONDARY
	return method


def _effective_progression_day_type(method, day_type):
	method = _effective_progression_method(method)
	day_type = posfordate.progression_day_type(day_type)
	if method not in (posfordate.SECONDARY, posfordate.TERTIARY):
		return posfordate.PROGRESSION_DAY_TYPE_Q2
	return day_type


def _symbolic_age_from_elapsed_days(elapsed_days, method=posfordate.SECONDARY, day_type=posfordate.PROGRESSION_DAY_TYPE_Q2):
	method = _effective_progression_method(method)
	day_type = _effective_progression_day_type(method, day_type)
	elapsed_days = float(elapsed_days)
	if method == posfordate.TERTIARY:
		symbolic_age = elapsed_days / MEAN_TERTIARY_PERIOD_DAYS
		if day_type == posfordate.PROGRESSION_DAY_TYPE_Q1:
			symbolic_age /= BIJA_RATIO
		return symbolic_age
	if method == posfordate.MINOR:
		return elapsed_days * (MEAN_TERTIARY_PERIOD_DAYS / SECONDARY_MEAN_YEAR_DAYS)
	symbolic_age = elapsed_days / SECONDARY_MEAN_YEAR_DAYS
	if day_type == posfordate.PROGRESSION_DAY_TYPE_Q1:
		symbolic_age /= BIJA_RATIO
	return symbolic_age


def _elapsed_days_from_progression_age(age_years, method=posfordate.SECONDARY, day_type=posfordate.PROGRESSION_DAY_TYPE_Q2):
	method = _effective_progression_method(method)
	day_type = _effective_progression_day_type(method, day_type)
	elapsed_days = float(age_years) * SECONDARY_MEAN_YEAR_DAYS
	if method in (posfordate.SECONDARY, posfordate.TERTIARY) and day_type == posfordate.PROGRESSION_DAY_TYPE_Q1:
		elapsed_days *= BIJA_RATIO
	return elapsed_days


def _calendar_age_years_for_real_datetime(radix_chart, real_datetime_tuple):
	if radix_chart is None or getattr(radix_chart, 'time', None) is None:
		return 0.0
	ry, rm, rd, rh, rmi, rs = [int(v) for v in real_datetime_tuple]
	real_local = _local_datetime_from_tuple((ry, rm, rd, rh, rmi, rs))
	birth_year = int(getattr(radix_chart.time, 'origyear', radix_chart.time.year))
	whole_years = int(ry - birth_year)
	current_anniv = _anniversary_datetime_tuple(radix_chart, birth_year + whole_years)
	current_anniv_local = _local_datetime_from_tuple(current_anniv)
	if real_local < current_anniv_local:
		whole_years -= 1
		current_anniv = _anniversary_datetime_tuple(radix_chart, birth_year + whole_years)
		current_anniv_local = _local_datetime_from_tuple(current_anniv)
	next_anniv = _anniversary_datetime_tuple(radix_chart, birth_year + whole_years + 1)
	next_anniv_local = _local_datetime_from_tuple(next_anniv)
	interval = float((next_anniv_local - current_anniv_local).total_seconds())
	if abs(interval) < 1e-9:
		return float(whole_years)
	frac = float((real_local - current_anniv_local).total_seconds()) / interval
	return float(whole_years) + float(frac)


def calendar_age_years_for_real_datetime(radix_chart, real_datetime_tuple):
	"""Return the native's fractional calendar age at a real display datetime."""
	return _calendar_age_years_for_real_datetime(radix_chart, real_datetime_tuple)


def solar_arc_age_for_real_datetime(radix_chart, real_datetime_tuple):
	"""Solar Arc's only date conversion: real datetime -> fractional age.

	The Solar Arc chart builder uses this age to find the secondary-progressed Sun,
	then applies that one arc uniformly to the natal chart. It does not use
	secondary progressed-angle or day-type options.
	"""
	return calendar_age_years_for_real_datetime(radix_chart, real_datetime_tuple)


def _real_datetime_for_calendar_age(radix_chart, age_years):
	if radix_chart is None or getattr(radix_chart, 'time', None) is None:
		return None
	birth_year = int(getattr(radix_chart.time, 'origyear', radix_chart.time.year))
	if age_years >= 0.0:
		whole_years = int(math.floor(age_years + 1e-12))
	else:
		whole_years = int(math.ceil(age_years - 1e-12))
	frac = float(age_years) - float(whole_years)
	base_anniv = _anniversary_datetime_tuple(radix_chart, birth_year + whole_years)
	next_anniv = _anniversary_datetime_tuple(radix_chart, birth_year + whole_years + 1)
	base_local = _local_datetime_from_tuple(base_anniv)
	next_local = _local_datetime_from_tuple(next_anniv)
	interval_seconds = float((next_local - base_local).total_seconds())
	target_local = _round_datetime_to_second(
		base_local + datetime.timedelta(seconds=interval_seconds * frac)
	)
	return (
		int(target_local.year), int(target_local.month), int(target_local.day),
		int(target_local.hour), int(target_local.minute), int(target_local.second),
	)


def secondary_direction_symbolic_info(radix_chart, directed_chart, method=posfordate.SECONDARY, day_type=None):
	if radix_chart is None or directed_chart is None:
		return None

	method = posfordate.progression_method(method)
	day_type = _effective_progression_day_type(method, day_type)
	scale = posfordate.progression_symbolic_scale(method)

	birth_jd = float(radix_chart.time.jd)
	prog_jd = float(directed_chart.time.jd)
	delta_ephem_days = prog_jd - birth_jd
	age_years = delta_ephem_days / scale if scale != 0.0 else delta_ephem_days
	if method == posfordate.SOLAR_ARC:
		# Solar Arc is built from the exact real-cursor calendar age. Reversing
		# that value through the chart Time/JD loses seconds because Time stores
		# whole seconds. Preserve the builder's canonical age when available.
		try:
			age_years = float(directed_chart._progression_age_years)
		except (AttributeError, TypeError, ValueError):
			pass
		delta_ephem_days = age_years * scale
	if method in (posfordate.SECONDARY, posfordate.TERTIARY) and day_type == posfordate.PROGRESSION_DAY_TYPE_Q1:
		age_years *= BIJA_RATIO
	calflag = _calflag_from_chart(radix_chart)

	if age_years >= 0.0:
		years_passed_int = int(math.floor(age_years + 1e-12))
	else:
		years_passed_int = int(math.ceil(age_years - 1e-12))
	real_dt = _real_datetime_for_calendar_age(radix_chart, age_years)
	progressed_dt = _jd_to_datetime_tuple(prog_jd, calflag)

	return {
		'progressed_datetime': progressed_dt,
		'signified_datetime': real_dt,
		'age_years': float(age_years),
		'age_years_int': int(years_passed_int),
		'delta_symbolic_days': float(delta_ephem_days),
		'method': method,
	}


def symbolic_age_for_real_datetime(radix_chart, real_datetime_tuple, method=posfordate.SECONDARY, day_type=posfordate.PROGRESSION_DAY_TYPE_Q2):
	"""Inverse of the real_jd mapping in secondary_direction_symbolic_info.

	Returns the fractional symbolic age (days since birth in ephemeris time)
	such that SecDir(radix, age).compute() produces a chart whose
	signified_datetime lands on real_datetime_tuple.
	"""
	if radix_chart is None:
		return 0.0

	method = posfordate.progression_method(method)
	day_type = _effective_progression_day_type(method, day_type)
	scale = posfordate.progression_symbolic_scale(method)

	ry, rm, rd, rh, rmi, rs = real_datetime_tuple
	age_years = _calendar_age_years_for_real_datetime(radix_chart, (ry, rm, rd, rh, rmi, rs))
	symbolic_age = age_years * scale
	if method in (posfordate.SECONDARY, posfordate.TERTIARY) and day_type == posfordate.PROGRESSION_DAY_TYPE_Q1:
		symbolic_age /= BIJA_RATIO
	return symbolic_age
