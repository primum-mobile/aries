import math

import astrology
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


_CACHE = {}


def _chart_signature(radix):
	return (
		round(float(radix.time.jd), 6),
		round(float(radix.place.lon), 6),
		round(float(radix.place.lat), 6),
		round(float(getattr(radix.place, 'altitude', 0.0)), 2),
	)


def _offset_text(offset):
	return u"%+d" % int(offset)


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
	sa = _safe_speed_lon(ta, ipl)
	sb = _safe_speed_lon(tb, ipl)
	if sa is None or sb is None:
		return None

	for _ in range(40):
		mid = 0.5 * (ta + tb)
		sm = _safe_speed_lon(mid, ipl)
		if sm is None:
			return None
		if abs(sm) < 1e-6 or abs(tb - ta) < 1e-4:
			return mid
		if sa * sm <= 0.0:
			tb, sb = mid, sm
		else:
			ta, sa = mid, sm

	return 0.5 * (ta + tb)


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


def _get_station_signals(radix, days_window):
	jd0 = float(radix.time.jd)
	signals = []

	for ipl in CLASSICAL_PLANETS:
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


def _get_phasis_signals(radix, days_window):
	vis = phasiscalc.visibility_flags_around(radix, days_window=days_window)
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


def get_radix_overlay_signals(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS):
	key = (_chart_signature(radix), int(phasis_window), float(station_window))
	if key not in _CACHE:
		_CACHE[key] = {
			'phasis': _get_phasis_signals(radix, int(phasis_window)),
			'stations': _get_station_signals(radix, float(station_window)),
		}
	return _CACHE[key]


def get_radix_overlay_rows(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS):
	signals = get_radix_overlay_signals(radix, phasis_window, station_window)
	rows = []
	for item in signals.get('phasis', []):
		rows.append((item['planet'], u"%s %s" % (item['code'], _offset_text(item['offset']))))
	for item in signals.get('stations', []):
		rows.append((item['planet'], u"%s %s" % (item['code'], _offset_text(item['offset']))))
	return rows


def format_signal_label(code):
	labels = {
		'MF': u'Morning rise',
		'ML': u'Morning set',
		'EF': u'Evening rise',
		'EL': u'Evening set',
		'SR': u'Retro station',
		'SD': u'Direct station',
	}
	return labels.get(code, unicode(code) if 'unicode' in globals() else str(code))


def format_signal_offset(offset):
	try:
		return u"%+dd" % int(offset)
	except Exception:
		return u""


def get_radix_overlay_display_rows(radix, phasis_window=PHASIS_WINDOW_DAYS, station_window=STATION_WINDOW_DAYS):
	signals = get_radix_overlay_signals(radix, phasis_window, station_window)
	rows = []
	for item in signals.get('phasis', []):
		rows.append((item['planet'], format_signal_label(item['code']), format_signal_offset(item['offset'])))
	for item in signals.get('stations', []):
		rows.append((item['planet'], format_signal_label(item['code']), format_signal_offset(item['offset'])))
	return rows


def get_station_direct_marker(radix, planet_idx, within_days=2.0):
	signals = get_radix_overlay_signals(radix)
	for item in signals.get('stations', []):
		if item.get('planet') != planet_idx:
			continue
		if item.get('code') != 'SD':
			continue
		offset_days = float(item.get('offset_days', item.get('offset', 999.0)))
		if 0.0 <= offset_days <= float(within_days):
			return 'SD'
	return None
