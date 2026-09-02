# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime
import math
from collections import OrderedDict

import astrology
import eclipses
import phasiscalc


PHASIS_WINDOW_DAYS = 7
STATION_WINDOW_DAYS = 7.0
CLASSICAL_PLANETS = (
	astrology.SE_SATURN,
	astrology.SE_JUPITER,
	astrology.SE_MARS,
	astrology.SE_VENUS,
	astrology.SE_MERCURY,
)
EXTENDED_STATION_PLANETS = (
	astrology.SE_URANUS,
	astrology.SE_NEPTUNE,
	astrology.SE_PLUTO,
	astrology.SE_CHIRON,
)
CAZIMI_MODE_HELLENISTIC = 0
CAZIMI_MODE_AL_QABISI = 1
CAZIMI_MODE_ABU_MASHAR = 2
CAZIMI_HELLENISTIC_ORB_DEG = 1.0
CAZIMI_SIXTEEN_MIN_ORB_DEG = 16.0 / 60.0
CAZIMI_WINDOW_DAYS = 2.0
CAZIMI_EXACT_SEARCH_DAYS = CAZIMI_WINDOW_DAYS
ECLIPSE_WINDOW_DAYS = 7.0
ECLIPSE_CACHE_CHUNK_DAYS = 45.0
ECLIPSE_CACHE_MAX = 48
RADIX_SYNODIC_GLYPH_WINDOW_DAYS = 2.0
RADIX_SYNODIC_ELONGATION_MARKER = u'*'
RADIX_SYNODIC_RISING_MARKER = u'⌃'
RADIX_SYNODIC_SETTING_MARKER = u'⌄'
CAZIMI_BODY_IDS = (
	astrology.SE_MERCURY,
	astrology.SE_VENUS,
	astrology.SE_MARS,
	astrology.SE_JUPITER,
	astrology.SE_SATURN,
	astrology.SE_URANUS,
	astrology.SE_NEPTUNE,
	astrology.SE_PLUTO,
	astrology.SE_CHIRON,
)

PHASIS_MODE_ASTRONOMICAL = getattr(phasiscalc, 'PHASIS_MODE_ASTRONOMICAL', 0)

_PHASIS_GLYPH_MARKERS = {
	'MF': (RADIX_SYNODIC_RISING_MARKER, u'Morning rise'),
	'EF': (RADIX_SYNODIC_RISING_MARKER, u'Evening rise'),
	'ML': (RADIX_SYNODIC_SETTING_MARKER, u'Morning set'),
	'EL': (RADIX_SYNODIC_SETTING_MARKER, u'Evening set'),
}


_CACHE = {}
_STATION_CACHE = {}
_ECLIPSE_CACHE = OrderedDict()
_NO_MARKER = object()


def _extended_station_planets_enabled(options):
	return bool(getattr(options, 'extendedradixstations', False)) if options is not None else False


def _is_station_planet_enabled(ipl, options):
	if options is None:
		return True
	transcendental = tuple(bool(v) for v in getattr(options, 'transcendental', (True, True, True)))
	if ipl == astrology.SE_URANUS:
		return len(transcendental) < 1 or transcendental[0]
	if ipl == astrology.SE_NEPTUNE:
		return len(transcendental) < 2 or transcendental[1]
	if ipl == astrology.SE_PLUTO:
		return len(transcendental) < 3 or transcendental[2]
	if ipl == astrology.SE_CHIRON:
		return bool(getattr(options, 'showchiron', True))
	return True


def _station_planets(options=None, include_extended=None):
	if include_extended is None:
		include_extended = _extended_station_planets_enabled(options)
	planets = list(CLASSICAL_PLANETS)
	if include_extended:
		for ipl in EXTENDED_STATION_PLANETS:
			if _is_station_planet_enabled(ipl, options):
				planets.append(ipl)
	return tuple(planets)


def _cazimi_planets(options=None):
	planets = []
	for ipl in CAZIMI_BODY_IDS:
		if _is_station_planet_enabled(ipl, options):
			planets.append(ipl)
	return tuple(planets)


def _chart_signature(radix):
	return (
		round(float(radix.time.jd), 6),
		round(float(radix.place.lon), 6),
		round(float(radix.place.lat), 6),
		round(float(getattr(radix.place, 'altitude', 0.0)), 2),
	)


def _offset_text(offset):
	return u"%+d" % int(offset)


def _angular_distance(lon_a, lon_b):
	return abs((float(lon_a) - float(lon_b) + 180.0) % 360.0 - 180.0)


def _signed_longitude_delta(lon_a, lon_b):
	delta = (float(lon_a) - float(lon_b) + 180.0) % 360.0 - 180.0
	if delta <= -180.0:
		return 180.0
	return delta


def _planet_body(radix, ipl):
	try:
		body = radix.get_planet_body(int(ipl))
		if body is not None:
			return body
	except Exception:
		pass
	if ipl == astrology.SE_CHIRON:
		return getattr(radix, 'chiron', None)
	try:
		return radix.planets.planets[int(ipl)]
	except Exception:
		return None


def _safe_speed_lon(jd_ut, ipl):
	try:
		res = astrology.swe_calc_ut(float(jd_ut), int(ipl), int(astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED))
	except Exception:
		return None

	if isinstance(res, tuple) and len(res) >= 2 and isinstance(res[1], (list, tuple)) and len(res[1]) >= 4:
		try:
			return float(res[1][3])
		except Exception:
			return None

	if isinstance(res, (list, tuple)) and len(res) >= 4 and all(isinstance(v, (int, float)) for v in res[:4]):
		try:
			return float(res[3])
		except Exception:
			return None

	return None


def _refine_station_root(ipl, ta, tb):
	"""ITP method (Oliveira & Takahashi 2020) — optimal bracketed root-finder.

	Guarantees bisection worst-case while achieving superlinear convergence
	on smooth functions like planetary speed."""
	ta = float(ta)
	tb = float(tb)
	if tb < ta:
		ta, tb = tb, ta
	sa = _safe_speed_lon(ta, ipl)
	sb = _safe_speed_lon(tb, ipl)
	if sa is None or sb is None:
		return None
	if abs(sa) < 1e-6:
		return ta
	if abs(sb) < 1e-6:
		return tb
	if tb <= ta:
		return None
	# Keep the time bracket ordered and flip function signs if needed so the
	# ITP update logic still sees a negative left endpoint and positive right.
	flip_sign = sa > 0.0
	if flip_sign:
		sa = -sa
		sb = -sb

	eps = 1e-4          # tolerance in JD (~8.6 seconds)
	k1 = 0.2 / (tb - ta)
	k2 = 2.0
	n0 = 1
	n_half = max(1, int(math.ceil(math.log2((tb - ta) / (2.0 * eps)))))
	n_max = n_half + n0

	for j in range(n_max):
		diff = tb - ta
		if diff < 2.0 * eps:
			break

		# interpolation (regula falsi)
		xf = (sa * tb - sb * ta) / (sa - sb)
		mid = 0.5 * (ta + tb)

		# truncation
		sigma = 1.0 if xf > mid else (-1.0 if xf < mid else 0.0)
		delta = k1 * diff ** k2
		if delta <= abs(mid - xf):
			xt = xf + sigma * delta
		else:
			xt = mid

		# projection — minmax interval
		r = eps * 2.0 ** (n_max - j) - 0.5 * diff
		if abs(xt - mid) <= r:
			xitp = xt
		else:
			xitp = mid - sigma * r

		# evaluate
		sitp = _safe_speed_lon(xitp, ipl)
		if sitp is None:
			return None
		if flip_sign:
			sitp = -sitp
		if abs(sitp) < 1e-6:
			return xitp
		if sitp < 0.0:
			ta, sa = xitp, sitp
		else:
			tb, sb = xitp, sitp

	return 0.5 * (ta + tb)


def _nearest_station_signal(ipl, jd_ut, within_days, station_planets=None):
	if station_planets is None:
		station_planets = CLASSICAL_PLANETS
	if ipl not in station_planets:
		return None

	jd0 = float(jd_ut)
	window = float(within_days)
	step = 0.5
	best = None
	t = jd0 - window
	prev_t = t
	prev_speed = _safe_speed_lon(prev_t, ipl)
	t += step

	while t <= jd0 + window + 1e-9:
		speed = _safe_speed_lon(t, ipl)
		if prev_speed is not None and speed is not None and prev_speed * speed <= 0.0:
			root = _refine_station_root(ipl, prev_t, t)
			if root is not None:
				kind = _station_kind(ipl, root)
				if kind is not None:
					offset_days = float(root - jd0)
					if abs(offset_days) <= window:
						candidate = (abs(offset_days), {'planet': ipl, 'code': kind, 'offset_days': offset_days})
						if best is None or candidate < best:
							best = candidate
		prev_t = t
		prev_speed = speed
		t += step

	if best is None:
		return None
	return best[1]


def _station_kind(ipl, jd_root):
	before = _safe_speed_lon(jd_root - 0.05, ipl)
	after = _safe_speed_lon(jd_root + 0.05, ipl)
	if before is None or after is None:
		return None
	if before > 0.0 and after < 0.0:
		return 'SR'
	if before < 0.0 and after > 0.0:
		return 'SD'
	return None


def _get_station_signals(radix, days_window, station_planets=None):
	jd0 = float(radix.time.jd)
	signals = []
	if station_planets is None:
		station_planets = CLASSICAL_PLANETS

	for ipl in station_planets:
		best = None
		step = 0.5
		t = jd0 - days_window
		prev_t = t
		prev_speed = _safe_speed_lon(prev_t, ipl)
		t += step

		while t <= jd0 + days_window + 1e-9:
			speed = _safe_speed_lon(t, ipl)
			if prev_speed is not None and speed is not None and prev_speed * speed <= 0.0:
				root = _refine_station_root(ipl, prev_t, t)
				if root is not None:
					kind = _station_kind(ipl, root)
					if kind is not None:
						offset_days = float(root - jd0)
						offset = int(round(offset_days))
						candidate = (abs(offset_days), ipl, {'planet': ipl, 'code': kind, 'offset': offset, 'offset_days': offset_days})
						if best is None or candidate < best:
							best = candidate
			prev_t = t
			prev_speed = speed
			t += step

		if best is not None:
			signals.append(best[2])

	signals.sort(key=lambda item: (abs(item['offset']), item['planet']))
	return signals


def _get_phasis_signals(radix, days_window, phasis_mode):
	vis = phasiscalc.visibility_flags_around(radix, days_window=days_window, mode=phasis_mode)
	pref = {'MF': 0, 'ML': 1, 'EF': 2, 'EL': 3}
	signals = []

	for ipl in phasiscalc.PLANET_IDS:
		data = vis.get(ipl, {})
		events = []
		for code in ('MF', 'ML', 'EF', 'EL'):
			off = data.get(code)
			if isinstance(off, int) and abs(off) <= days_window:
				events.append((abs(off), pref[code], {'planet': ipl, 'code': code, 'offset': int(off)}))
		if events:
			events.sort(key=lambda item: (item[0], item[1]))
			signals.append(events[0][2])

	signals.sort(key=lambda item: (abs(item['offset']), item['planet']))
	return signals


def _cazimi_calc_flags(radix):
	if not hasattr(radix, '_zodiac_flags'):
		return None
	try:
		astrology.swe_set_topo(float(radix.place.lon), float(radix.place.lat), float(getattr(radix.place, 'altitude', 0.0)))
	except Exception:
		return None
	try:
		pflag, _hflag, _fsflag, _astflag = radix._zodiac_flags()
		return int(pflag)
	except Exception:
		return None


def _body_longitude_at(jd_ut, ipl, pflag):
	try:
		res = astrology.swe_calc_ut(float(jd_ut), int(ipl), int(pflag))
	except Exception:
		return None
	if isinstance(res, tuple) and len(res) >= 2 and isinstance(res[1], (list, tuple)) and len(res[1]) >= 1:
		try:
			return float(res[1][0])
		except Exception:
			return None
	if isinstance(res, (list, tuple)) and len(res) >= 1 and isinstance(res[0], (int, float)):
		try:
			return float(res[0])
		except Exception:
			return None
	return None


def _body_lon_lat_at(jd_ut, ipl, pflag):
	try:
		res = astrology.swe_calc_ut(float(jd_ut), int(ipl), int(pflag))
	except Exception:
		return None
	if isinstance(res, tuple) and len(res) >= 2 and isinstance(res[1], (list, tuple)) and len(res[1]) >= 2:
		try:
			return float(res[1][0]), float(res[1][1])
		except Exception:
			return None
	if isinstance(res, (list, tuple)) and len(res) >= 2 and all(isinstance(v, (int, float)) for v in res[:2]):
		try:
			return float(res[0]), float(res[1])
		except Exception:
			return None
	return None


def _sun_delta_at(jd_ut, ipl, pflag):
	sun_lon = _body_longitude_at(jd_ut, astrology.SE_SUN, pflag)
	body_lon = _body_longitude_at(jd_ut, ipl, pflag)
	if sun_lon is None or body_lon is None:
		return None
	return _signed_longitude_delta(body_lon, sun_lon)


def _refine_cazimi_root(ipl, ta, tb, pflag):
	ta = float(ta)
	tb = float(tb)
	if tb < ta:
		ta, tb = tb, ta
	fa = _sun_delta_at(ta, ipl, pflag)
	fb = _sun_delta_at(tb, ipl, pflag)
	if fa is None or fb is None:
		return None
	if abs(fa) < 1e-6:
		return ta
	if abs(fb) < 1e-6:
		return tb
	if fa * fb > 0.0:
		return None
	for _ in range(48):
		mid = 0.5 * (ta + tb)
		fm = _sun_delta_at(mid, ipl, pflag)
		if fm is None:
			return None
		if abs(fm) < 1e-6 or abs(tb - ta) < 1e-5:
			return mid
		if fa * fm <= 0.0:
			tb, fb = mid, fm
		else:
			ta, fa = mid, fm
	return 0.5 * (ta + tb)


def _exact_cazimi_offset_days(radix, ipl, window_days=CAZIMI_EXACT_SEARCH_DAYS):
	pflag = _cazimi_calc_flags(radix)
	if pflag is None:
		return None
	try:
		jd0 = float(radix.time.jd)
	except Exception:
		return None
	window = float(window_days)
	step = 0.25
	best = None
	t = jd0 - window
	prev_t = t
	prev_delta = _sun_delta_at(prev_t, ipl, pflag)
	if prev_delta is not None and abs(prev_delta) < 1e-6:
		best = prev_t
	t += step
	while t <= jd0 + window + 1e-9:
		delta = _sun_delta_at(t, ipl, pflag)
		if prev_delta is not None and delta is not None:
			root = None
			if abs(delta) < 1e-6:
				root = t
			elif prev_delta * delta <= 0.0:
				root = _refine_cazimi_root(ipl, prev_t, t, pflag)
			if root is not None and (best is None or abs(root - jd0) < abs(best - jd0)):
				best = root
		prev_t = t
		prev_delta = delta
		t += step
	if best is not None:
		return float(best - jd0)

	current = _sun_delta_at(jd0, ipl, pflag)
	speed_body = _safe_speed_lon(jd0, ipl)
	speed_sun = _safe_speed_lon(jd0, astrology.SE_SUN)
	if current is None or speed_body is None or speed_sun is None:
		return None
	relative_speed = float(speed_body) - float(speed_sun)
	if abs(relative_speed) < 1e-6:
		return None
	offset = -float(current) / relative_speed
	if abs(offset) <= window:
		return float(offset)
	return None


def _normalize_cazimi_mode(mode):
	try:
		mode = int(mode)
	except Exception:
		return CAZIMI_MODE_HELLENISTIC
	if mode == CAZIMI_MODE_AL_QABISI:
		return CAZIMI_MODE_AL_QABISI
	if mode == CAZIMI_MODE_ABU_MASHAR:
		return CAZIMI_MODE_ABU_MASHAR
	return CAZIMI_MODE_HELLENISTIC


def _get_cazimi_signals(radix, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, days_window=CAZIMI_WINDOW_DAYS):
	if options is not None and not bool(getattr(options, 'showcazimi', True)):
		return []
	mode = _normalize_cazimi_mode(cazimi_mode)
	days_window = float(days_window)
	try:
		jd0 = float(radix.time.jd)
	except Exception:
		return []
	pflag = _cazimi_calc_flags(radix)
	signals = []
	for ipl in _cazimi_planets(options):
		if _planet_body(radix, ipl) is None:
			continue
		offset_days = _exact_cazimi_offset_days(radix, ipl, window_days=days_window)
		if offset_days is None or abs(float(offset_days)) > days_window:
			continue
		lon_delta = 0.0
		lat_delta = 0.0
		if pflag is not None:
			exact_jd = jd0 + float(offset_days)
			body_exact = _body_lon_lat_at(exact_jd, ipl, pflag)
			sun_exact = _body_lon_lat_at(exact_jd, astrology.SE_SUN, pflag)
			if body_exact is None or sun_exact is None:
				if mode == CAZIMI_MODE_AL_QABISI:
					continue
			else:
				lon_delta = _angular_distance(body_exact[0], sun_exact[0])
				lat_delta = abs(float(body_exact[1]) - float(sun_exact[1]))
		if mode == CAZIMI_MODE_HELLENISTIC:
			matches = lon_delta <= CAZIMI_HELLENISTIC_ORB_DEG
		elif mode == CAZIMI_MODE_ABU_MASHAR:
			matches = lon_delta <= CAZIMI_SIXTEEN_MIN_ORB_DEG
		else:
			matches = lon_delta <= CAZIMI_SIXTEEN_MIN_ORB_DEG and lat_delta <= CAZIMI_SIXTEEN_MIN_ORB_DEG
		if matches:
			signals.append({
				'planet': ipl,
				'code': 'CAZ',
				'lon_delta': lon_delta,
				'lat_delta': lat_delta,
				'mode': mode,
				'offset_days': offset_days,
			})
	signals.sort(key=lambda item: (abs(float(item['offset_days'])), item['planet']))
	return signals


def _eclipse_events_for_window(radix, jd0, window_days):
	try:
		chunk = int(math.floor(float(jd0) / ECLIPSE_CACHE_CHUNK_DAYS))
	except Exception:
		return []
	start = (chunk * ECLIPSE_CACHE_CHUNK_DAYS) - float(window_days)
	end = ((chunk + 1) * ECLIPSE_CACHE_CHUNK_DAYS) + float(window_days)
	key = (chunk, round(start, 6), round(end, 6))
	events = _ECLIPSE_CACHE.get(key)
	if events is None:
		try:
			events = eclipses.find_eclipses_in_range(radix, start, end)
		except Exception:
			events = []
		_ECLIPSE_CACHE[key] = list(events)
		if len(_ECLIPSE_CACHE) > ECLIPSE_CACHE_MAX:
			_ECLIPSE_CACHE.popitem(last=False)
	else:
		_ECLIPSE_CACHE.move_to_end(key)
	return list(events)


def _eclipse_kind_label(event):
	return eclipses.eclipse_kind_label(event)


def get_eclipse_display_rows(radix, options=None, eclipse_window=ECLIPSE_WINDOW_DAYS):
	if options is not None and not bool(getattr(options, 'showeclipseoverlay', True)):
		return []
	try:
		jd0 = float(radix.time.jd)
	except Exception:
		return []
	window = float(eclipse_window)
	mode = getattr(options, 'eclipse_chart_moment', getattr(eclipses, 'ECLIPSE_CHART_MOMENT_EXACT', 'exact_conjunction'))
	rows = []
	for event in _eclipse_events_for_window(radix, jd0, window):
		try:
			event_jd = float(eclipses.chart_moment_jdut_for_event(event, mode))
		except Exception:
			continue
		offset_days = float(event_jd - jd0)
		if abs(offset_days) > window:
			continue
		import mtexts
		luminary = mtexts.txts.get('EclipseSolar', u'Solar') if bool(getattr(event, 'is_solar', False)) else mtexts.txts.get('EclipseLunar', u'Lunar')
		fmt = mtexts.txts.get('EclipseLabelFormat', u'{kind} {luminary} Eclipse')
		label = fmt.format(kind=_eclipse_kind_label(event), luminary=luminary)
		rows.append((abs(offset_days), label, offset_days))
	rows.sort(key=lambda item: (item[0], item[1]))
	return [(None, label, format_signal_offset(offset_days)) for _abs_offset, label, offset_days in rows]


def get_radix_overlay_signals(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS, phasis_mode=PHASIS_MODE_ASTRONOMICAL, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, include_extended_stations=None, cazimi_window=CAZIMI_WINDOW_DAYS):
	station_planets = _station_planets(options=options, include_extended=include_extended_stations)
	cazimi_planets = _cazimi_planets(options)
	cazimi_mode = _normalize_cazimi_mode(cazimi_mode)
	show_cazimi = bool(getattr(options, 'showcazimi', True)) if options is not None else True
	key = (_chart_signature(radix), int(phasis_window), float(station_window), int(phasis_mode), int(cazimi_mode), float(cazimi_window), bool(show_cazimi), station_planets, cazimi_planets)
	if key not in _CACHE:
		_CACHE[key] = {
			'phasis': _get_phasis_signals(radix, int(phasis_window), int(phasis_mode)),
			'stations': _get_station_signals(radix, float(station_window), station_planets=station_planets),
			'cazimi': _get_cazimi_signals(radix, cazimi_mode, options=options, days_window=float(cazimi_window)) if show_cazimi else [],
		}
	return _CACHE[key]


def get_radix_overlay_rows(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS, phasis_mode=PHASIS_MODE_ASTRONOMICAL, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, include_extended_stations=None, cazimi_window=CAZIMI_WINDOW_DAYS, eclipse_window=ECLIPSE_WINDOW_DAYS):
	signals = get_radix_overlay_signals(
		radix,
		phasis_window,
		station_window,
		phasis_mode,
		cazimi_mode,
		options=options,
		include_extended_stations=include_extended_stations,
		cazimi_window=cazimi_window,
	)
	rows = []
	for item in signals.get('phasis', []):
		rows.append((item['planet'], u"%s %s" % (item['code'], _offset_text(item['offset']))))
	for item in signals.get('cazimi', []):
		rows.append((item['planet'], u"Cazimi %s" % format_signal_offset(item.get('offset_days'))))
	for _planet_idx, label, offset_text in get_eclipse_display_rows(radix, options=options, eclipse_window=eclipse_window):
		rows.append((None, u"%s %s" % (label, offset_text)))
	for item in signals.get('stations', []):
		rows.append((item['planet'], u"%s %s" % (item['code'], _offset_text(item['offset']))))
	return rows


def format_signal_label(code):
	import mtexts
	keys = {
		'MF': ('MorningRise', u'Morning rise'),
		'ML': ('MorningSet', u'Morning set'),
		'EF': ('EveningRise', u'Evening rise'),
		'EL': ('EveningSet', u'Evening set'),
		'SR': ('RetroStation', u'Retro station'),
		'SD': ('DirectStation', u'Direct station'),
	}
	entry = keys.get(code)
	if entry:
		return unicode(mtexts.txts.get(entry[0], entry[1])) if 'unicode' in globals() else str(mtexts.txts.get(entry[0], entry[1]))
	return unicode(code) if 'unicode' in globals() else str(code)


def format_signal_offset(offset):
	try:
		v = float(offset)
		if abs(v) < 1.0:
			return u"%+.1fd" % v
		return u"%+dd" % int(round(v))
	except Exception:
		return u""


def get_cazimi_display_rows(radix, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, cazimi_window=CAZIMI_WINDOW_DAYS):
	import mtexts
	cazimi_label = unicode(mtexts.txts.get('Cazimi', u'Cazimi')) if 'unicode' in globals() else str(mtexts.txts.get('Cazimi', u'Cazimi'))
	rows = []
	for item in _get_cazimi_signals(radix, cazimi_mode, options=options, days_window=float(cazimi_window)):
		rows.append((item['planet'], cazimi_label, format_signal_offset(item.get('offset_days'))))
	return rows


def get_radix_signal_display_rows(radix, station_window=STATION_WINDOW_DAYS, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, include_extended_stations=None):
	return get_radix_station_display_rows(radix, station_window=station_window, options=options, include_extended_stations=include_extended_stations)


def get_radix_overlay_display_rows(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS, phasis_mode=PHASIS_MODE_ASTRONOMICAL, cazimi_mode=CAZIMI_MODE_HELLENISTIC, options=None, include_extended_stations=None, cazimi_window=CAZIMI_WINDOW_DAYS, eclipse_window=ECLIPSE_WINDOW_DAYS):
	signals = get_radix_overlay_signals(
		radix,
		phasis_window,
		station_window,
		phasis_mode,
		cazimi_mode,
		options=options,
		include_extended_stations=include_extended_stations,
		cazimi_window=cazimi_window,
	)
	import mtexts
	rows = []
	cazimi_label = str(mtexts.txts.get('Cazimi', u'Cazimi'))
	for item in signals.get('phasis', []):
		rows.append((item['planet'], format_signal_label(item['code']), format_signal_offset(item['offset'])))
	for item in signals.get('cazimi', []):
		rows.append((item['planet'], cazimi_label, format_signal_offset(item.get('offset_days'))))
	rows.extend(get_eclipse_display_rows(radix, options=options, eclipse_window=eclipse_window))
	for item in signals.get('stations', []):
		rows.append((item['planet'], format_signal_label(item['code']), format_signal_offset(item.get('offset_days', item['offset']))))
	return rows


def get_radix_station_display_rows(radix, station_window=STATION_WINDOW_DAYS, options=None, include_extended_stations=None):
	station_planets = _station_planets(options=options, include_extended=include_extended_stations)
	key = (_chart_signature(radix), float(station_window), station_planets)
	signals = _STATION_CACHE.get(key)
	if signals is None or not isinstance(signals, list):
		signals = _get_station_signals(radix, float(station_window), station_planets=station_planets)
		_STATION_CACHE[key] = list(signals)
	rows = []
	for item in signals:
		rows.append((item['planet'], format_signal_label(item['code']), format_signal_offset(item.get('offset_days', item['offset']))))
	return rows


def get_station_direct_marker(radix, planet_idx, within_days=2.0, options=None, include_extended_stations=None):
	return get_station_marker(radix, planet_idx, within_days=within_days, options=options, include_extended_stations=include_extended_stations, station_codes=('SD',))


def get_station_marker(radix, planet_idx, within_days=2.0, options=None, include_extended_stations=None, station_codes=('SR', 'SD')):
	try:
		planet_idx = int(planet_idx)
	except Exception:
		return None
	station_codes = tuple(station_codes)
	station_planets = _station_planets(options=options, include_extended=include_extended_stations)
	if planet_idx not in station_planets:
		return None
	key = (_chart_signature(radix), int(planet_idx), float(within_days), station_planets, station_codes)
	marker = _STATION_CACHE.get(key, _NO_MARKER)
	if marker is _NO_MARKER:
		# Glyph drawing asks about one body at a time; do not make that path
		# pay for all enabled extended station planets on first paint.
		signals_key = ('stations', _chart_signature(radix), float(within_days), (planet_idx,))
		signals = _STATION_CACHE.get(signals_key)
		if signals is None or not isinstance(signals, list):
			signals = _get_station_signals(radix, float(within_days), station_planets=(planet_idx,))
			_STATION_CACHE[signals_key] = list(signals)
		marker = None
		for item in signals:
			if item.get('planet') != planet_idx:
				continue
			if item.get('code') not in station_codes:
				continue
			offset_days = float(item.get('offset_days', item.get('offset', 999.0)))
			if abs(offset_days) <= float(within_days):
				marker = item.get('code')
				break
		_STATION_CACHE[key] = marker
	if marker is None:
		return None
	return marker


def get_station_marker_for_jd(jd_ut, planet_idx, within_days=2.0, options=None, include_extended_stations=None):
	item = _nearest_station_signal(
		int(planet_idx),
		float(jd_ut),
		float(within_days),
		station_planets=_station_planets(options=options, include_extended=include_extended_stations),
	)
	if item is None:
		return None
	return item.get('code')


def get_motion_marker_for_speed(
	jd_ut,
	planet_idx,
	speed_lon,
	within_days=2.0,
	options=None,
	include_extended_stations=None,
):
	if speed_lon is None:
		return ''

	marker = get_station_marker_for_jd(
		jd_ut,
		planet_idx,
		within_days=within_days,
		options=options,
		include_extended_stations=include_extended_stations,
	)
	if marker is not None:
		return marker

	speed = float(speed_lon)
	if abs(speed) <= 1e-6:
		return 'S'
	if speed < 0.0:
		return 'R'
	return ''
