# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime

import astrology
import chart
import geonames
import revolutions
import util


def _zone_adjusted_datetime(y, m, d, h, mi, s, plus, zh, zm, daylight=False, radix=None):
	if radix is not None:
		tzid = getattr(getattr(radix, 'time', None), 'tzid', '') or ''
		zoneinfo_cls = getattr(geonames, 'ZoneInfo', None)
		if not tzid and getattr(radix, 'place', None) is not None:
			try:
				tzid = geonames.Geonames.get_timezone_name(radix.place.lon, radix.place.lat) or ''
			except Exception:
				tzid = ''
		if tzid and zoneinfo_cls is not None:
			try:
				utc_dt = datetime.datetime(
					int(y), int(m), int(d), int(h), int(mi), int(s),
					tzinfo=datetime.timezone.utc,
				)
				return utc_dt.astimezone(zoneinfo_cls(tzid))
			except Exception:
				pass
	try:
		base = datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
		offset = datetime.timedelta(hours=int(zh), minutes=int(zm))
		if bool(daylight):
			offset += datetime.timedelta(hours=1)
		return (base + offset) if bool(plus) else (base - offset)
	except Exception:
		return datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))


def _calflag_from_chart(radix):
	if radix is not None and getattr(getattr(radix, 'time', None), 'cal', chart.Time.GREGORIAN) == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _datetime_to_jd(radix, dt):
	if dt is None:
		return None
	calflag = _calflag_from_chart(radix)
	ut = float(dt.hour) + float(dt.minute) / 60.0 + float(dt.second) / 3600.0
	return astrology.swe_julday(int(dt.year), int(dt.month), int(dt.day), ut, calflag)


def _normalize_ymdhms(y, m, d, hh, mi, ss):
	y = int(y)
	m = int(m)
	d = int(d)
	hh = int(hh)
	mi = int(mi)
	ss = int(round(float(ss)))

	while ss >= 60:
		ss -= 60
		mi += 1
	while mi >= 60:
		mi -= 60
		hh += 1
	while hh >= 24:
		hh -= 24
		y, m, d = util.incrDay(y, m, d)
	return (y, m, d, hh, mi, ss)


def solar_return_datetime_for_year(radix, year_value):
	if radix is None:
		return None
	rev = revolutions.Revolutions()
	ok = rev.compute(
		revolutions.Revolutions.SOLAR,
		int(year_value),
		int(radix.time.month),
		int(radix.time.day),
		radix,
		target_year=int(year_value),
	)
	if not ok:
		return None
	y, m, d, hh, mi, ss = _normalize_ymdhms(rev.t[0], rev.t[1], rev.t[2], rev.t[3], rev.t[4], rev.t[5])
	y, m, d, hh, mi, ss = _zone_adjusted_datetime(
		y, m, d, hh, mi, ss,
		getattr(radix.time, 'plus', True),
		getattr(radix.time, 'zh', 0),
		getattr(radix.time, 'zm', 0),
		getattr(radix.time, 'daylightsaving', False),
		radix=radix,
	).timetuple()[:6]
	try:
		return datetime.datetime(y, m, d, hh, mi, ss)
	except Exception:
		return None


def completed_solar_return_datetime(radix, source_dt):
	if radix is None or source_dt is None:
		return None
	birth_year = int(getattr(radix.time, 'year', source_dt.year))
	target_year = max(int(source_dt.year), birth_year)
	source_jd = _datetime_to_jd(radix, source_dt)
	sr = solar_return_datetime_for_year(radix, target_year)
	if sr is None:
		return None
	sr_jd = _datetime_to_jd(radix, sr)
	if source_jd is not None and sr_jd is not None and source_jd < sr_jd and target_year > birth_year:
		target_year -= 1
		sr = solar_return_datetime_for_year(radix, target_year)
	return sr


def adjacent_solar_return_datetime(radix, source_dt, direction):
	if direction not in (-1, 1):
		return None
	if radix is None or source_dt is None:
		return None
	birth_year = int(getattr(radix.time, 'year', source_dt.year))
	completed = completed_solar_return_datetime(radix, source_dt)
	if completed is None:
		return None
	completed_jd = _datetime_to_jd(radix, completed)
	source_jd = _datetime_to_jd(radix, source_dt)
	if direction > 0:
		if source_jd is not None and completed_jd is not None and source_jd < completed_jd:
			return completed
		return solar_return_datetime_for_year(radix, int(completed.year) + 1)
	if source_jd is not None and completed_jd is not None and source_jd > completed_jd:
		return completed
	prev_year = int(completed.year) - 1
	if prev_year < birth_year:
		return None
	return solar_return_datetime_for_year(radix, prev_year)


def solar_year_fraction(radix, source_dt):
	if radix is None or source_dt is None:
		return None
	start = completed_solar_return_datetime(radix, source_dt)
	if start is None:
		return None
	end = solar_return_datetime_for_year(radix, int(start.year) + 1)
	if end is None:
		return None
	jd_start = _datetime_to_jd(radix, start)
	jd_end = _datetime_to_jd(radix, end)
	jd_cursor = _datetime_to_jd(radix, source_dt)
	if jd_start is None or jd_end is None or jd_cursor is None:
		return None
	span = float(jd_end - jd_start)
	if span <= 0.0:
		return None
	frac = float(jd_cursor - jd_start) / span
	if frac < 0.0:
		frac = 0.0
	if frac > 1.0:
		frac = 1.0
	return frac


def adjacent_monthly_profection_datetime(radix, source_dt, direction):
	if direction not in (-1, 1):
		return None
	if radix is None or source_dt is None:
		return None
	birth_year = int(getattr(radix.time, 'year', source_dt.year))
	start = completed_solar_return_datetime(radix, source_dt)
	if start is None:
		return None
	end = solar_return_datetime_for_year(radix, int(start.year) + 1)
	if end is None:
		return None
	jd_start = _datetime_to_jd(radix, start)
	jd_end = _datetime_to_jd(radix, end)
	jd_cursor = _datetime_to_jd(radix, source_dt)
	if jd_start is None or jd_end is None or jd_cursor is None:
		return None
	span = float(jd_end - jd_start)
	if span <= 0.0:
		return None
	boundary_tolerance = max(1e-9, 1.0 / max(span * 86400.0, 1.0))
	start_year = int(start.year)
	boundaries = []
	for idx in range(13):
		boundary_dt = datetime_for_fraction_in_solar_year(radix, start_year, float(idx) / 12.0)
		if boundary_dt is None:
			continue
		boundary_jd = _datetime_to_jd(radix, boundary_dt)
		if boundary_jd is None:
			continue
		boundaries.append((boundary_jd, boundary_dt, idx))
	if not boundaries:
		return None
	if direction > 0:
		for boundary_jd, boundary_dt, idx in boundaries:
			if boundary_jd > (jd_cursor + boundary_tolerance):
				return boundary_dt
		return datetime_for_fraction_in_solar_year(radix, start_year + 1, 0.0)
	for boundary_jd, boundary_dt, idx in reversed(boundaries):
		if boundary_jd < (jd_cursor - boundary_tolerance):
			return boundary_dt
	prev_year = start_year - 1
	if prev_year < birth_year:
		return None
	return datetime_for_fraction_in_solar_year(radix, prev_year, 11.0 / 12.0)


def datetime_for_fraction_in_solar_year(radix, start_year, fraction):
	if radix is None:
		return None
	start = solar_return_datetime_for_year(radix, int(start_year))
	if start is None:
		return None
	end = solar_return_datetime_for_year(radix, int(start_year) + 1)
	if end is None:
		return None
	jd_start = _datetime_to_jd(radix, start)
	jd_end = _datetime_to_jd(radix, end)
	if jd_start is None or jd_end is None:
		return None
	if fraction is None:
		fraction = 0.0
	frac = max(0.0, min(1.0, float(fraction)))
	jd_target = jd_start + (jd_end - jd_start) * frac
	calflag = _calflag_from_chart(radix)
	y, m, d, ut = astrology.swe_revjul(jd_target, calflag)
	h = int(ut)
	minf = (ut - float(h)) * 60.0
	mi = int(minf)
	secf = (minf - float(mi)) * 60.0
	ss = int(round(secf))
	y, m, d, h, mi, ss = _normalize_ymdhms(y, m, d, h, mi, ss)
	try:
		return datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(ss))
	except Exception:
		return start
