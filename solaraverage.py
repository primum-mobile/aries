# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime
import math

import astrology
import chart
import houses
import mtexts
import planets
import revolutions
import util


DEFAULT_SOLAR_AVERAGE_BIRTHDAY = 84
RETURN_AVERAGE_SOLAR = 'solar'
RETURN_AVERAGE_LUNAR = 'lunar'
RETURN_AVERAGE_DEFAULT_KIND = RETURN_AVERAGE_SOLAR
# English identity for each kind — used as the localization fallback and by
# callers (workspace_service) that key off these values. Do NOT translate this
# dict in place; resolve the display label at serve time via
# return_average_kind_label().
RETURN_AVERAGE_KIND_LABELS = {
	RETURN_AVERAGE_SOLAR: 'Solar Average',
	RETURN_AVERAGE_LUNAR: 'Lunar Average',
}

# mtexts keys carrying the localized form of each kind label.
RETURN_AVERAGE_KIND_LABEL_KEYS = {
	RETURN_AVERAGE_SOLAR: 'SolarAverage',
	RETURN_AVERAGE_LUNAR: 'LunarAverage',
}


def return_average_kind_label(kind):
	"""Serve-time localized display label for an average-return kind.

	Resolved against the active mtexts dictionary so the label renders in the
	viewer's language; falls back to the English identity in
	RETURN_AVERAGE_KIND_LABELS.
	"""
	kind = normalize_return_average_kind(kind)
	return mtexts.txts.get(
		RETURN_AVERAGE_KIND_LABEL_KEYS[kind],
		RETURN_AVERAGE_KIND_LABELS[kind],
	)


def normalize_return_average_kind(kind):
	value = str(kind or RETURN_AVERAGE_DEFAULT_KIND).strip().lower().replace('-', '_')
	if value in ('lunar', 'moon', 'moon_return', 'lunar_return', 'lunar_average'):
		return RETURN_AVERAGE_LUNAR
	return RETURN_AVERAGE_SOLAR


def _circular_mean(values):
	angles = [math.radians(util.normalize(float(value))) for value in values]
	if not angles:
		return 0.0
	sin_sum = sum(math.sin(angle) for angle in angles)
	cos_sum = sum(math.cos(angle) for angle in angles)
	if math.fabs(sin_sum) < 1e-12 and math.fabs(cos_sum) < 1e-12:
		return 0.0
	return util.normalize(math.degrees(math.atan2(sin_sum, cos_sum)))


def _mean(values):
	values = [float(value) for value in values]
	if not values:
		return 0.0
	return sum(values) / float(len(values))


def _mean_time_for_returns(return_charts, radix):
	jd = _mean(getattr(chrt.time, 'jd', 0.0) for chrt in return_charts)
	cal = getattr(radix.time, 'cal', chart.Time.GREGORIAN)
	calflag = astrology.SE_GREG_CAL
	if cal == chart.Time.JULIAN:
		calflag = astrology.SE_JUL_CAL

	year, month, day, hour_float = astrology.swe_revjul(jd, calflag)
	hour = int(hour_float)
	minute_float = (hour_float - hour) * 60.0
	minute = int(minute_float)
	second = int(round((minute_float - minute) * 60.0))

	if second >= 60:
		second = 0
		minute += 1
	if minute >= 60:
		minute = 0
		hour += 1
	if hour >= 24:
		hour = 0
		year, month, day = util.incrDay(int(year), int(month), int(day))

	bc = int(year) <= 0
	if bc:
		year = 1 - int(year)

	return chart.Time(
		int(year), int(month), int(day), int(hour), int(minute), int(second),
		bc, cal, chart.Time.GREENWICH, True, 0, 0, False, radix.place, False,
		tzid=getattr(radix.time, 'tzid', ''),
		tzauto=getattr(radix.time, 'tzauto', False),
	)


def _zone_adjusted_datetime(radix, y, m, d, h, mi, s):
	plus = getattr(radix.time, 'plus', True)
	zh = getattr(radix.time, 'zh', 0)
	zm = getattr(radix.time, 'zm', 0)
	daylight = bool(getattr(radix.time, 'daylightsaving', False))
	try:
		base = datetime.datetime(int(y), int(m), int(d), int(h), int(mi), int(s))
		offset = datetime.timedelta(hours=int(zh), minutes=int(zm))
		if daylight:
			offset += datetime.timedelta(hours=1)
		if plus:
			local_dt = base + offset
		else:
			local_dt = base - offset
		return (
			local_dt.year,
			local_dt.month,
			local_dt.day,
			local_dt.hour,
			local_dt.minute,
			local_dt.second,
		)
	except Exception:
		return (int(y), int(m), int(d), int(h), int(mi), int(s))


def _apply_average_houses(target_houses, return_charts, obl):
	cusps = [0.0]
	for idx in range(1, houses.Houses.HOUSE_NUM + 1):
		cusps.append(_circular_mean(chrt.houses.cusps[idx] for chrt in return_charts))
	target_houses.cusps = tuple(cusps)

	ascmc = list(target_houses.ascmc)
	count = min(len(target_houses.ascmc), len(return_charts[0].houses.ascmc))
	for idx in range(count):
		ascmc[idx] = _circular_mean(chrt.houses.ascmc[idx] for chrt in return_charts)
	target_houses.ascmc = tuple(ascmc)

	ascra, ascdecl, dist = astrology.swe_cotrans(target_houses.ascmc[houses.Houses.ASC], 0.0, 1.0, -obl)
	mcra, mcdecl, dist = astrology.swe_cotrans(target_houses.ascmc[houses.Houses.MC], 0.0, 1.0, -obl)
	target_houses.ascmc2 = (
		(target_houses.ascmc[houses.Houses.ASC], 0.0, ascra, ascdecl),
		(target_houses.ascmc[houses.Houses.MC], 0.0, mcra, mcdecl),
	)

	qasc = 0.0
	val = math.tan(math.radians(ascdecl)) * math.tan(math.radians(return_charts[0].place.lat))
	if math.fabs(val) <= 1.0:
		qasc = math.degrees(math.asin(val))
	target_houses.regioMPAsc = ascra - qasc
	target_houses.regioMPMC = mcra

	cuspstmp = []
	for idx in range(houses.Houses.HOUSE_NUM):
		ra, decl, dist = astrology.swe_cotrans(target_houses.cusps[idx + 1], 0.0, dist, -obl)
		cuspstmp.append([ra, decl])
	target_houses.cuspstmp = cuspstmp
	target_houses.cusps2 = tuple((entry[0], entry[1]) for entry in cuspstmp)


def _average_body_data(return_charts, body_getter):
	bodies = [body_getter(chrt) for chrt in return_charts]
	lon = _circular_mean(body.data[planets.Planet.LONG] for body in bodies)
	lat = _mean(body.data[planets.Planet.LAT] for body in bodies)
	dist = _mean(body.data[planets.Planet.DIST] for body in bodies)
	splon = _mean(body.data[planets.Planet.SPLON] for body in bodies)
	splat = _mean(body.data[planets.Planet.SPLAT] for body in bodies)
	spdist = _mean(body.data[planets.Planet.SPDIST] for body in bodies)
	spraequ = _mean(body.dataEqu[planets.Planet.SPRAEQU] for body in bodies)
	spdeclequ = _mean(body.dataEqu[planets.Planet.SPDECLEQU] for body in bodies)
	spdistequ = _mean(body.dataEqu[planets.Planet.SPDISTEQU] for body in bodies)
	return (lon, lat, dist, splon, splat, spdist, spraequ, spdeclequ, spdistequ)


def _apply_average_body(target_body, return_charts, body_getter, placelat, ascmc2, raequasc, obl, nolat=False):
	data = _average_body_data(return_charts, body_getter)
	lon = data[planets.Planet.LONG]
	lat = 0.0 if nolat else data[planets.Planet.LAT]
	ra, decl, dist = astrology.swe_cotrans(lon, lat, 1.0, -obl)
	target_body.data = (
		float(lon),
		float(lat),
		float(data[planets.Planet.DIST]),
		float(data[planets.Planet.SPLON]),
		float(data[planets.Planet.SPLAT]),
		float(data[planets.Planet.SPDIST]),
	)
	target_body.dataEqu = (
		float(ra),
		float(decl),
		float(dist),
		float(data[6]),
		float(data[7]),
		float(data[8]),
	)
	target_body.speculums = []
	target_body.computePlacidianSpeculum(placelat, ascmc2)
	target_body.computeRegiomontanSpeculum(placelat, ascmc2, raequasc)


def _build_solar_return_chart(radix, options_obj, target_year, correction_cb=None):
	revs = revolutions.Revolutions()
	if not revs.compute(revolutions.Revolutions.SOLAR, int(target_year), radix.time.month, radix.time.day, radix):
		return None

	y, m, d, hh, mi, ss = [int(value) for value in revs.t[:6]]
	if getattr(options_obj, 'ayanamsha', 0) != 0 and callable(correction_cb):
		try:
			y, m, d, hh, mi, ss = correction_cb(
				revs,
				astrology.SE_SUN,
				topo_place=radix.place,
				reference_chart=radix,
			)
		except Exception:
			pass
	time = chart.Time(
		y, m, d, hh, mi, ss,
		False, radix.time.cal, chart.Time.GREENWICH, True, 0, 0, False, radix.place, False,
		tzid=getattr(radix.time, 'tzid', ''),
		tzauto=getattr(radix.time, 'tzauto', False),
	)
	return chart.Chart(radix.name, radix.male, time, radix.place, chart.Chart.SOLAR, '', options_obj, False)


def _build_lunar_return_chart(radix, options_obj, ref_dt, correction_cb=None):
	revs = revolutions.Revolutions()
	if not revs.compute_lunar_after_datetime(ref_dt, radix, inclusive=False):
		return None

	y, m, d, hh, mi, ss = [int(value) for value in revs.t[:6]]
	target_lon = None
	try:
		target_lon = float(radix.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG])
	except Exception:
		pass
	if getattr(options_obj, 'ayanamsha', 0) != 0 and callable(correction_cb):
		try:
			y, m, d, hh, mi, ss = correction_cb(
				revs,
				astrology.SE_MOON,
				topo_place=radix.place,
				seed=(y, m, d, hh, mi, ss),
				target_lon_trop=target_lon,
				reference_chart=radix,
			)
		except Exception:
			pass
	time = chart.Time(
		y, m, d, hh, mi, ss,
		False, radix.time.cal, chart.Time.GREENWICH, True, 0, 0, False, radix.place, False,
		tzid=getattr(radix.time, 'tzid', ''),
		tzauto=getattr(radix.time, 'tzauto', False),
	)
	return chart.Chart(radix.name, radix.male, time, radix.place, chart.Chart.LUNAR, '', options_obj, False)


def _birth_datetime(radix):
	return datetime.datetime(
		int(getattr(radix.time, 'year', getattr(radix.time, 'origyear', 1))),
		int(getattr(radix.time, 'month', getattr(radix.time, 'origmonth', 1))),
		int(getattr(radix.time, 'day', getattr(radix.time, 'origday', 1))),
		int(getattr(radix.time, 'hour', getattr(radix.time, 'orighour', 0))),
		int(getattr(radix.time, 'minute', getattr(radix.time, 'origminute', 0))),
		int(getattr(radix.time, 'second', getattr(radix.time, 'origsecond', 0))),
	)


def _add_years_clamped(dt_value, years):
	target_year = int(dt_value.year) + int(years)
	try:
		return dt_value.replace(year=target_year)
	except ValueError:
		return dt_value.replace(year=target_year, day=28)


def _collect_solar_average_returns(radix, options_obj, max_birthday, correction_cb=None):
	base_year = int(getattr(radix.time, 'origyear', radix.time.year))
	return_charts = [radix]
	for offset in range(1, max_birthday + 1):
		return_chart = _build_solar_return_chart(radix, options_obj, base_year + offset, correction_cb=correction_cb)
		if return_chart is None:
			return (None, None, mtexts.txts.get('CouldnotComputeRevolution', 'Could not compute revolution!'))
		return_charts.append(return_chart)
	return (return_charts, None, None)


def _collect_lunar_average_returns(radix, options_obj, max_birthday, correction_cb=None):
	return_charts = [radix]
	if max_birthday <= 0:
		return (return_charts, None, None)
	birth_dt = _birth_datetime(radix)
	end_dt = _add_years_clamped(birth_dt, max_birthday)
	ref_dt = birth_dt + datetime.timedelta(seconds=1)
	for _ in range(max_birthday * 14 + 4):
		return_chart = _build_lunar_return_chart(radix, options_obj, ref_dt, correction_cb=correction_cb)
		if return_chart is None:
			break
		hit_dt = datetime.datetime(
			int(return_chart.time.year),
			int(return_chart.time.month),
			int(return_chart.time.day),
			int(return_chart.time.hour),
			int(return_chart.time.minute),
			int(return_chart.time.second),
		)
		if hit_dt > end_dt:
			break
		return_charts.append(return_chart)
		ref_dt = hit_dt + datetime.timedelta(seconds=1)
	return (return_charts, None, None)


def build_average_return_chart(
	radix,
	options_obj,
	return_kind=RETURN_AVERAGE_DEFAULT_KIND,
	max_birthday=DEFAULT_SOLAR_AVERAGE_BIRTHDAY,
	correction_cb=None,
):
	max_birthday = max(0, int(max_birthday))
	return_kind = normalize_return_average_kind(return_kind)
	if return_kind == RETURN_AVERAGE_LUNAR:
		return_charts, _display, error = _collect_lunar_average_returns(
			radix,
			options_obj,
			max_birthday,
			correction_cb=correction_cb,
		)
	else:
		return_charts, _display, error = _collect_solar_average_returns(
			radix,
			options_obj,
			max_birthday,
			correction_cb=correction_cb,
		)
	if error is not None:
		return (None, None, error)
	if not return_charts:
		return (None, None, mtexts.txts.get('CouldnotComputeRevolution', 'Could not compute revolution!'))

	# Localized label for the served chart name; English identity kept for the
	# internal descriptor (not surfaced to the webapp, avoids a translated
	# string being lowercased/glued).
	label = return_average_kind_label(return_kind)
	label_en = RETURN_AVERAGE_KIND_LABELS.get(return_kind, RETURN_AVERAGE_KIND_LABELS[RETURN_AVERAGE_SOLAR])
	mean_time = _mean_time_for_returns(return_charts, radix)
	avg_chart = chart.Chart(
		'%s %s' % (radix.name, label),
		radix.male,
		mean_time,
		radix.place,
		chart.Chart.RADIX,
		'%s research chart' % label_en.lower(),
		options_obj,
		False,
	)
	avg_chart.is_solar_average = True
	avg_chart.is_return_average = True
	avg_chart.return_average_kind = return_kind
	avg_chart.return_average_count = len(return_charts)
	avg_chart.solar_average_age_min = 0
	avg_chart.solar_average_age_max = max_birthday
	avg_chart.solar_average_footer_label = mtexts.txts.get('Average', 'Average')
	avg_chart.solar_average_hide_overlay_info = True

	_apply_average_houses(avg_chart.houses, return_charts, avg_chart.obl[0])
	avg_chart.raequasc, declequasc, dist = astrology.swe_cotrans(avg_chart.houses.ascmc[houses.Houses.EQUASC], 0.0, 1.0, -avg_chart.obl[0])

	for idx in range(planets.Planets.PLANETS_NUM):
		_apply_average_body(
			avg_chart.planets.planets[idx],
			return_charts,
			lambda chrt, idx=idx: chrt.planets.planets[idx],
			avg_chart.place.lat,
			avg_chart.houses.ascmc2,
			avg_chart.raequasc,
			avg_chart.obl[0],
			nolat=avg_chart.nolat,
		)

	if getattr(avg_chart, 'chiron', None) is not None and all(getattr(chrt, 'chiron', None) is not None for chrt in return_charts):
		_apply_average_body(
			avg_chart.chiron,
			return_charts,
			lambda chrt: chrt.chiron,
			avg_chart.place.lat,
			avg_chart.houses.ascmc2,
			avg_chart.raequasc,
			avg_chart.obl[0],
			nolat=avg_chart.nolat,
		)

	avg_chart.abovehorizonwithorb = avg_chart.isAboveHorizonWithOrb()
	avg_chart.calcFortune()
	avg_chart.calcAspMatrix()

	display_dt = _zone_adjusted_datetime(
		radix,
		avg_chart.time.year,
		avg_chart.time.month,
		avg_chart.time.day,
		avg_chart.time.hour,
		avg_chart.time.minute,
		avg_chart.time.second,
	)
	return (avg_chart, display_dt, None)


def build_solar_average_chart(radix, options_obj, max_birthday=DEFAULT_SOLAR_AVERAGE_BIRTHDAY, correction_cb=None):
	return build_average_return_chart(
		radix,
		options_obj,
		return_kind=RETURN_AVERAGE_SOLAR,
		max_birthday=max_birthday,
		correction_cb=correction_cb,
	)
