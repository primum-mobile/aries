# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime

import astrology
import chart
import houses
import revolutions
import util


MEAN_TROPICAL_YEAR_DAYS = 365.2421904
_SOLAR_RETURN_JD_CACHE = {}
_LOY_CACHE = {}
_TERM_ROWS_CACHE = {}


def _freeze_signature_value(value):
	if isinstance(value, dict):
		return tuple(sorted((str(k), _freeze_signature_value(v)) for k, v in value.items()))
	if isinstance(value, (list, tuple)):
		return tuple(_freeze_signature_value(v) for v in value)
	if isinstance(value, float):
		return round(value, 6)
	return value


def _chart_signature(chrt):
	if chrt is None:
		return None
	try:
		t = chrt.time
	except Exception:
		t = None
	try:
		p = chrt.place
	except Exception:
		p = None
	try:
		h = chrt.houses
	except Exception:
		h = None
	try:
		asc = h.ascmc[houses.Houses.ASC] if h is not None else None
	except Exception:
		asc = None
	try:
		mc = h.ascmc[houses.Houses.MC] if h is not None else None
	except Exception:
		mc = None
	return _freeze_signature_value((
		getattr(chrt, 'htype', None),
		getattr(t, 'year', None),
		getattr(t, 'month', None),
		getattr(t, 'day', None),
		getattr(t, 'hour', None),
		getattr(t, 'minute', None),
		getattr(t, 'second', None),
		round(float(getattr(t, 'jd', 0.0)), 6) if t is not None else None,
		getattr(t, 'bc', None),
		getattr(t, 'cal', None),
		getattr(t, 'zt', None),
		getattr(t, 'plus', None),
		getattr(t, 'zh', None),
		getattr(t, 'zm', None),
		getattr(t, 'daylightsaving', None),
		round(float(getattr(p, 'lon', 0.0)), 6) if p is not None else None,
		round(float(getattr(p, 'lat', 0.0)), 6) if p is not None else None,
		round(float(getattr(p, 'altitude', 0.0)), 2) if p is not None else None,
		round(float(asc), 6) if asc is not None else None,
		round(float(mc), 6) if mc is not None else None,
		round(float(getattr(chrt, 'ayanamsha', 0.0)), 6),
	))


def _cursor_signature(target_chart, display_datetime, cursor_jd=None):
	if cursor_jd is not None:
		try:
			return ('jd', round(float(cursor_jd), 8))
		except Exception:
			pass
	if display_datetime is not None:
		return ('display', _freeze_signature_value(display_datetime))
	if target_chart is not None and getattr(target_chart, 'htype', None) == chart.Chart.RADIX:
		now = datetime.datetime.now()
		return ('now', now.year, now.month, now.day, now.hour, now.minute)
	return ('chart', _chart_signature(target_chart))


def _loy_options_signature(options):
	return _freeze_signature_value((
		round(float(getattr(options, 'ayanamsha', 0.0)), 6),
		bool(getattr(options, 'signs', True)),
		getattr(options, 'dignities', None),
	))


def _term_options_signature(options):
	return _freeze_signature_value((
		round(float(getattr(options, 'ayanamsha', 0.0)), 6),
		getattr(options, 'selterm', 0),
		getattr(options, 'terms', None),
		getattr(options, 'circumkey', None),
		bool(getattr(options, 'pdkeydyn', False)),
		getattr(options, 'pdkeys', None),
		getattr(options, 'pdkeydeg', 0),
		getattr(options, 'pdkeymin', 0),
		getattr(options, 'pdkeysec', 0),
		getattr(options, 'pdcircumoa', None),
	))


def _calflag_from_chart(chrt):
	if chrt is not None and getattr(chrt.time, 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _tuple_to_jd(y, m, d, hh, mm, ss, chrt):
	if chrt is not None and getattr(chrt, 'time', None) is not None and getattr(chrt, 'place', None) is not None:
		try:
			t = chrt.time
			time_obj = chart.Time(
				int(y), int(m), int(d), int(hh), int(mm), int(ss),
				bool(getattr(t, 'bc', False)),
				getattr(t, 'cal', chart.Time.GREGORIAN),
				getattr(t, 'zt', chart.Time.ZONE),
				bool(getattr(t, 'plus', True)),
				int(getattr(t, 'zh', 0) or 0),
				int(getattr(t, 'zm', 0) or 0),
				bool(getattr(t, 'daylightsaving', False)),
				chrt.place,
				False,
				tzid=getattr(t, 'tzid', ''),
				tzauto=bool(getattr(t, 'tzauto', False)),
			)
			return float(time_obj.jd)
		except Exception:
			pass
	calflag = _calflag_from_chart(chrt)
	hour = float(hh) + float(mm) / 60.0 + float(ss) / 3600.0
	return astrology.swe_julday(int(y), int(m), int(d), hour, calflag)


def _solar_return_jd_for_year(radix, year_value):
	key = (_chart_signature(radix), int(year_value))
	if key in _SOLAR_RETURN_JD_CACHE:
		return _SOLAR_RETURN_JD_CACHE[key]
	rev = revolutions.Revolutions()
	ok = rev.compute(
		revolutions.Revolutions.SOLAR,
		int(year_value),
		radix.time.month,
		radix.time.day,
		radix,
		target_year=int(year_value),
	)
	if not ok:
		_SOLAR_RETURN_JD_CACHE[key] = None
		return None
	y, m, d, hh, mm, ss = rev.t[0], rev.t[1], rev.t[2], rev.t[3], rev.t[4], rev.t[5]
	calflag = _calflag_from_chart(radix)
	hour = float(hh) + float(mm) / 60.0 + float(ss) / 3600.0
	result = astrology.swe_julday(int(y), int(m), int(d), hour, calflag)
	_SOLAR_RETURN_JD_CACHE[key] = result
	return result


def _completed_solar_years(radix, cursor_jd):
	"""Count how many solar returns have occurred between radix birth and cursor_jd."""
	birth_year = int(getattr(radix.time, 'origyear', radix.time.year))
	elapsed = cursor_jd - radix.time.jd
	if elapsed < 0:
		return 0

	# Rough estimate, then verify and adjust by at most 1
	n = int(elapsed / MEAN_TROPICAL_YEAR_DAYS)

	sr = _solar_return_jd_for_year(radix, birth_year + n)
	if sr is None:
		return n

	if cursor_jd >= sr:
		# Check if the next SR has also passed
		sr_next = _solar_return_jd_for_year(radix, birth_year + n + 1)
		if sr_next is not None and cursor_jd >= sr_next:
			n += 1
	else:
		# Fell before this SR — step back one
		if n > 0:
			n -= 1

	return n


def _get_cursor_tuple(target_chart, display_datetime):
	"""Return the effective cursor time as a 6-tuple."""
	if display_datetime is not None:
		return display_datetime

	if target_chart is None:
		return None

	if target_chart.htype == chart.Chart.RADIX:
		now = datetime.datetime.now()
		return (now.year, now.month, now.day, now.hour, now.minute, now.second)

	t = target_chart.time
	return (
		getattr(t, 'origyear', t.year),
		getattr(t, 'origmonth', t.month),
		getattr(t, 'origday', t.day),
		t.hour,
		t.minute,
		t.second,
	)


def get_term_lord(radix, target_chart, options, display_datetime=None, cursor_jd=None):
	"""Return (sign_idx, planet_id) for the circumambulation term lord at cursor time."""
	if radix is None:
		return None
	try:
		import circumambulation
		if cursor_jd is None:
			cursor = _get_cursor_tuple(target_chart, display_datetime)
			if cursor is None:
				return None
			cursor_jd = _tuple_to_jd(*cursor, radix)
		cache_key = (_chart_signature(radix), _term_options_signature(options))
		if cache_key in _TERM_ROWS_CACHE:
			rows = _TERM_ROWS_CACHE[cache_key]
		else:
			try:
				import copy
				radix_for_rows = copy.deepcopy(radix)
			except Exception:
				radix_for_rows = radix
			rows = circumambulation.compute_distributions(
				radix_for_rows,
				options,
				key=circumambulation.years_per_degree_from_options(options),
				use_exact_oa=circumambulation.use_pd_circumoa_from_options(options),
			)
			_TERM_ROWS_CACHE[cache_key] = rows
		if not rows:
			return None
		first = rows[0]
		if cursor_jd < first.get('jd_start', 0.0):
			return (first['sign_idx'], first['term_ruler_pid'])
		for row in rows:
			jd_s = row.get('jd_start', 0.0)
			jd_e = row.get('jd_end', 0.0)
			if jd_e > jd_s and jd_s <= cursor_jd < jd_e:
				return (row['sign_idx'], row['term_ruler_pid'])
		# cursor beyond all rows — return last
		last = rows[-1]
		return (last['sign_idx'], last['term_ruler_pid'])
	except Exception:
		return None


def get_lord_of_year(radix, target_chart, options, display_datetime=None, cursor_jd=None):
	"""LOY = count solar returns elapsed before cursor, advance ASC by n*30°."""
	if radix is None:
		return None

	try:
		cache_key = (_chart_signature(radix), _cursor_signature(target_chart, display_datetime, cursor_jd), _loy_options_signature(options))
		if cache_key in _LOY_CACHE:
			return _LOY_CACHE[cache_key]
		if cursor_jd is None:
			cursor = _get_cursor_tuple(target_chart, display_datetime)
			if cursor is None:
				return None
			cursor_jd = _tuple_to_jd(*cursor, radix)
		n = _completed_solar_years(radix, cursor_jd)

		prof_asc = util.normalize(radix.houses.ascmc[houses.Houses.ASC] + n * 30.0)
		if options.ayanamsha != 0:
			prof_asc = util.normalize(prof_asc - radix.ayanamsha)

		sign_idx = int(prof_asc / chart.Chart.SIGN_DEG)
		for pid in range(min(7, len(options.dignities))):
			if options.dignities[pid][0][sign_idx]:
				result = (sign_idx, pid)
				_LOY_CACHE[cache_key] = result
				return result
	except Exception:
		return None

	return None
