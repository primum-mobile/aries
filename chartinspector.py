# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import math
from functools import lru_cache
from aries.astrology.ephemeris_context import EphemerisContext
from engine.dignity_display import chart_dignity_color, dignity_color_role, minor_dignity_count
import astrology
import chart
import common
import dateformat
import lunar
import manazil
import node_mirror
import moonphasejump
import planets
import houses
import radixsignals
import util
from engine import harmonic_chart, planetary_state, solar_proximity, void_of_course


_PLANET_NAMES = (
	'Sun',
	'Moon',
	'Mercury',
	'Venus',
	'Mars',
	'Jupiter',
	'Saturn',
	'Uranus',
	'Neptune',
	'Pluto',
	'North Node',
	'South Node',
)

_SIGN_NAMES = (
	'Aries',
	'Taurus',
	'Gemini',
	'Cancer',
	'Leo',
	'Virgo',
	'Libra',
	'Scorpio',
	'Sagittarius',
	'Capricorn',
	'Aquarius',
	'Pisces',
)

_SIGN_ELEMENTS = (
	'Fire',
	'Earth',
	'Air',
	'Water',
	'Fire',
	'Earth',
	'Air',
	'Water',
	'Fire',
	'Earth',
	'Air',
	'Water',
)

_SIGN_MODALITIES = (
	'Cardinal',
	'Fixed',
	'Mutable',
	'Cardinal',
	'Fixed',
	'Mutable',
	'Cardinal',
	'Fixed',
	'Mutable',
	'Cardinal',
	'Fixed',
	'Mutable',
)

# mtexts keys for planet/sign display names, parallel to the English tuples
# above. Resolved at serve time via ``_safe_text`` so titles/positions render
# in the active language; the English tuples remain the fallback and drive all
# index-based logic. North Node reuses the existing ``NorthNode`` key and
# Capricorn the existing ``Capricornus`` key.
_PLANET_NAME_KEYS = (
	'Sun',
	'Moon',
	'Mercury',
	'Venus',
	'Mars',
	'Jupiter',
	'Saturn',
	'Uranus',
	'Neptune',
	'Pluto',
	'NorthNode',
	'SouthNode',
)

_SIGN_NAME_KEYS = (
	'Aries',
	'Taurus',
	'Gemini',
	'Cancer',
	'Leo',
	'Virgo',
	'Libra',
	'Scorpio',
	'Sagittarius',
	'Capricornus',
	'Aquarius',
	'Pisces',
)

_SIGN_RULERS = (4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5)
_TRIPLICITY_GROUPS = (0, 3, 1, 2, 0, 3, 1, 2, 0, 3, 1, 2)
_ANGLE_LABELS = {
	'asc': 'Ascendant',
	'desc': 'Descendant',
	'mc': 'Midheaven',
	'ic': 'Imum Coeli',
}

_ANGLE_SHORT_LABELS = {
	'asc': 'Asc',
	'desc': 'Dsc',
	'mc': 'MC',
	'ic': 'IC',
}

_ANGLE_OPPOSITES = {
	'asc': 'Descendant',
	'desc': 'Ascendant',
	'mc': 'Imum Coeli',
	'ic': 'Midheaven',
}

_ROLE_LABELS = {
	'primary': '',
	'inner': 'Center chart',
	'outer': 'Outer ring',
}

_DIGNITY_LABELS = {
	chart.Chart.DOMICIL: 'Domicile',
	chart.Chart.EXAL: 'Exaltation',
	chart.Chart.PEREGRIN: 'Peregrine',
	# ``Fall`` is also the legacy season key.  Use the unambiguous dignity key
	# so German can render astrological Fall as "Fall" while the season remains
	# "Herbst" (and Spanish does not accidentally render dignity as "Otoño").
	chart.Chart.CASUS: 'Casus',
	chart.Chart.EXIL: 'Exile',
}

_ASPECT_LABELS = {
	chart.Chart.CONJUNCTIO: 'conj.',
	chart.Chart.SEMISEXTIL: 'semi-sext.',
	chart.Chart.SEMIQUADRAT: 'semi-square',
	chart.Chart.SEXTIL: 'sextile',
	chart.Chart.QUINTILE: 'quintile',
	chart.Chart.QUADRAT: 'square',
	chart.Chart.TRIGON: 'trine',
	chart.Chart.SESQUIQUADRAT: 'sesqui-square',
	chart.Chart.BIQUINTILE: 'biquintile',
	chart.Chart.QUINQUNX: 'quincunx',
	chart.Chart.OPPOSITIO: 'opposition',
	chart.Chart.SEPTILE: 'septile',
}

_ASPECT_FULL_LABELS = {
	chart.Chart.CONJUNCTIO: 'Conjunction',
	chart.Chart.SEMISEXTIL: 'Semisextile',
	chart.Chart.SEMIQUADRAT: 'Semisquare',
	chart.Chart.SEXTIL: 'Sextile',
	chart.Chart.QUINTILE: 'Quintile',
	chart.Chart.QUADRAT: 'Square',
	chart.Chart.TRIGON: 'Trine',
	chart.Chart.SESQUIQUADRAT: 'Sesquisquare',
	chart.Chart.BIQUINTILE: 'Biquintile',
	chart.Chart.QUINQUNX: 'Quincunx',
	chart.Chart.OPPOSITIO: 'Opposition',
	chart.Chart.SEPTILE: 'Septile',
}

_BODY_COLOUR_ROLES = {
	astrology.SE_SUN: '--morinus-body-sun',
	astrology.SE_MOON: '--morinus-body-moon',
	astrology.SE_MERCURY: '--morinus-body-mercury',
	astrology.SE_VENUS: '--morinus-body-venus',
	astrology.SE_MARS: '--morinus-body-mars',
	astrology.SE_JUPITER: '--morinus-body-jupiter',
	astrology.SE_SATURN: '--morinus-body-saturn',
	astrology.SE_URANUS: '--morinus-body-uranus',
	astrology.SE_NEPTUNE: '--morinus-body-neptune',
	astrology.SE_PLUTO: '--morinus-body-pluto',
	astrology.SE_MEAN_NODE: '--morinus-body-nodes',
	astrology.SE_TRUE_NODE: '--morinus-body-nodes',
	astrology.SE_CHIRON: '--morinus-body-chiron',
	astrology.SE_MEAN_APOG: '--morinus-body-moon',
	astrology.SE_OSCU_APOG: '--morinus-body-moon',
}

_ASPECT_COLOUR_ROLES = (
	'--morinus-aspect-conjunction',
	'--morinus-aspect-semisextile',
	'--morinus-aspect-semisquare',
	'--morinus-aspect-sextile',
	'--morinus-aspect-quintile',
	'--morinus-aspect-square',
	'--morinus-aspect-trine',
	'--morinus-aspect-sesquisquare',
	'--morinus-aspect-biquintile',
	'--morinus-aspect-quincunx',
	'--morinus-aspect-opposition',
	'--morinus-aspect-septile',
	'--morinus-aspect-parallel',
	'--morinus-aspect-contraparallel',
)


_ASPECT_EVENT_CACHE = {}
_ASPECT_SEARCH_DAYS = 45.0
_TRADITIONAL_ASPECT_SIGN_DIFF = (0, -1, -1, 2, -1, 3, 4, -1, -1, -1, 6)
_MOON_TRADITIONAL_WITNESS_BODIES = (
	astrology.SE_SUN,
	astrology.SE_MERCURY,
	astrology.SE_VENUS,
	astrology.SE_MARS,
	astrology.SE_JUPITER,
	astrology.SE_SATURN,
)

_SOLAR_PROFILE_BY_MODE = {
	0: solar_proximity.PROFILE_LATE_HELLENISTIC,
	1: solar_proximity.PROFILE_AL_QABISI,
	2: solar_proximity.PROFILE_IBN_EZRA,
	3: solar_proximity.PROFILE_LILLY_1647,
	4: solar_proximity.PROFILE_MORIN_1661,
}

def _sign_glyph(sign_index, options):
	signs = common.common.Signs1
	if not getattr(options, 'signs', True):
		signs = common.common.Signs2
	return signs[sign_index % chart.Chart.SIGN_NUM]


def _planet_glyph(planet_index):
	try:
		return common.common.get_planet_glyph(int(planet_index))
	except Exception:
		return ''


def _planet_name(planet_index, options=None):
	planet_index = int(planet_index)
	if planet_index in (astrology.SE_CHIRON, astrology.SE_MEAN_APOG, astrology.SE_OSCU_APOG):
		name = common.common.get_planet_name(planet_index)
		return _safe_text(name, name)
	if 0 <= planet_index < len(_PLANET_NAMES):
		label = _safe_text(_PLANET_NAME_KEYS[planet_index], _PLANET_NAMES[planet_index])
		if planet_index in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not bool(getattr(options, 'meannode', True)):
			return '%s (T)' % label
		return label
	name = common.common.get_planet_name(planet_index)
	return _safe_text(name, name)


def _trigon_lord_ids(chrt, options, sign_index):
	"""Return configured triplicity lords in the chart's active sect order."""
	if chrt is None:
		return []
	chart_options = getattr(chrt, 'options', options)
	try:
		group = _TRIPLICITY_GROUPS[int(sign_index) % chart.Chart.SIGN_NUM]
		rulers = chart_options.trips[chart_options.seltrip][group]
		daytime = bool(chrt.planets.planets[astrology.SE_SUN].abovehorizon)
		if getattr(chart_options, 'usedaynightorb', False):
			daytime = bool(chrt.fortune.abovehorizon)
	except (AttributeError, IndexError, TypeError, ValueError):
		return []

	ordered_slots = (0, 1, 2) if daytime else (1, 0, 2)
	lords = []
	seen = set()
	for slot in ordered_slots:
		try:
			ruler = int(rulers[slot])
		except (IndexError, TypeError, ValueError):
			continue
		if not astrology.SE_SUN <= ruler <= astrology.SE_SATURN or ruler in seen:
			continue
		seen.add(ruler)
		lords.append(ruler)
	return lords


def _trigon_lords_item(chrt, options, sign_index, current_planet=None):
	lord_ids = _trigon_lord_ids(chrt, options, sign_index)
	if not lord_ids:
		return None
	chart_options = getattr(chrt, 'options', options)
	lords = [{
		'planet_id': int(ruler_id),
		'glyph': _planet_glyph(ruler_id),
		'name': _planet_name(ruler_id, chart_options),
		'colour': _dignity_colour(chrt, chart_options, ruler_id),
		'colour_role': _dignity_colour_role(chrt, ruler_id),
		'current': current_planet is not None and int(ruler_id) == int(current_planet),
	} for ruler_id in lord_ids]
	return {
		'kind': 'triplicity_lords',
		'label': _safe_text('Triplicity Rulers', 'Triplicity Rulers'),
		'flag_label': _safe_text('Trip. Rulers', 'Trip. Rulers'),
		'lords': lords,
		'value_text': ', '.join(lord['name'] for lord in lords),
	}


def _triplicity_lord_spans(item):
	spans = []
	for index, lord in enumerate(item.get('lords') or []):
		if index:
			spans.append({'text': '  '})
		spans.append({
			'text': lord.get('glyph', ''),
			'colour': lord.get('colour'),
			'colourRole': lord.get('colour_role'),
			'glyph': True,
		})
	return spans


def _append_point_trigon_flag_row(payload, chrt, options, lon):
	if _is_varga_chart(chrt):
		return
	trigon_item = _point_trigon_lords_item(chrt, options, lon)
	if trigon_item is not None:
		payload['rows'].append((trigon_item['flag_label'], '', None, _triplicity_lord_spans(trigon_item)))


def _sign_name(sign_index):
	i = int(sign_index) % chart.Chart.SIGN_NUM
	return _safe_text(_SIGN_NAME_KEYS[i], _SIGN_NAMES[i])


def _format_position(display_lon):
	lon = util.normalize(float(display_lon))
	sign_index = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
	deg, minute, second = util.decToDeg(lon)
	deg = deg % chart.Chart.SIGN_DEG
	return sign_index, '%s %02d°%02d\'%02d"' % (_sign_name(sign_index), deg, minute, second)


def _position_house_item(display_lon, house_text, options):
	"""Summary line "<sign> 02°51'17\" · House 7"; the sign shows as its glyph.

	Without the glyph tables (bare test fakes) the line stays plain text."""
	sign_index, pos_text = _format_position(display_lon)
	text = '%s · %s' % (pos_text, house_text)
	degrees = pos_text[len(_sign_name(sign_index)):].strip()
	from webapp.daemon.display_palette import sign_color_role
	try:
		glyph = _sign_glyph(sign_index, options)
		colour = common.get_sign_color(options, sign_index)
		colour_role = sign_color_role(options, sign_index, resolved_color=colour)
	except AttributeError:
		return {'text': text, 'spans': []}
	return {
		'text': text,
		'spans': [
			{'text': glyph, 'glyph': True, 'colour': colour, 'colourRole': colour_role},
			{'text': '\u00a0%s · %s' % (degrees, house_text)},
		],
	}


def _house_text(house_index):
	if house_index is None:
		return _safe_text('Unknown', 'Unknown')
	return '%s %d' % (_safe_text('House', 'House'), int(house_index))


def _motion_text(data):
	marker = (data.get('motion_marker') or '').strip()
	if marker == 'R':
		return _safe_text('Retrograde', 'Retrograde')
	if marker == 'S':
		return _safe_text('Stationary', 'Stationary')
	if marker == 'SD':
		return _safe_text('Stationary direct', 'Stationary direct')
	return _safe_text('Direct', 'Direct')


def _motion_heading(data):
	"""Return the compact glyph shown beside a moving body's title.

	The engine owns the exact ``R`` / ``S`` / ``SD`` / ``SR`` marker.  Only
	plain retrograde needs a font-slot translation: ``Z`` is the bundled Morinus
	retrograde glyph.  Direct motion is intentionally unmarked.
	"""
	marker = (data.get('motion_marker') or '').strip().upper()
	if not marker:
		return None
	if marker == 'R':
		return {
			'glyph': getattr(getattr(common, 'common', None), 'retr', 'Z'),
			'uses_symbol_font': True,
			'label': _safe_text('Retrograde', 'Retrograde'),
		}
	if marker in ('S', 'SD', 'SR'):
		return {
			'glyph': marker,
			'uses_symbol_font': False,
			'label': marker,
		}
	return {
		'glyph': marker,
		'uses_symbol_font': False,
		'label': marker,
	}


def _format_signed_angle(value):
	sign = '+' if float(value) >= 0.0 else '-'
	d, m, s = util.decToDeg(abs(float(value)))
	return '%s%02d°%02d\'%02d"' % (sign, d, m, s)


def _moon_mansion_info(chrt, options, lon_in_chart):
	mode = getattr(options, 'manazil_zodiac', manazil.ZODIAC_AUTO)
	# ``chrt.ayanamsha_offset`` is the actual offset (0 in tropical
	# mode). ``chrt.ayanamsha`` is now the residual (= 0) after
	# ``Chart._zodiac_flags()`` applies ``SEFLG_SIDEREAL`` at the
	# SwissEph boundary — the Moon longitude we receive is already
	# in the chart's chosen zodiac. Fall back to ``ayanamsha`` so
	# any caller running on a stale Chart still works.
	ayan = float(
		getattr(chrt, 'ayanamsha_offset', 0.0)
		or getattr(chrt, 'ayanamsha', 0.0)
		or 0.0
	)
	try:
		jd = chrt.time.jd
	except AttributeError:
		jd = 0.0
	frame_lon = manazil.resolve_chart_lon(
		float(lon_in_chart),
		mode,
		ayan,
		jd,
		getattr(options, 'ayanamsha', 0) != 0,
	)
	idx, deg_in, entry = manazil.mansion_of(frame_lon)
	d, m, _s = util.decToDeg(deg_in)
	return {
		'label': _safe_text('Manzil', 'Manzil'),
		'index': idx + 1,
		'name_ar': entry['name_ar'],
		'name_translit': entry['name_translit'],
		'gloss_key': entry['gloss_key'],
		'degree_within': '%d°%02d\'' % (d, m),
	}


def _moon_mansion_text(chrt, options, lon_in_chart):
	"""Compatibility text form for non-structured consumers."""
	info = _moon_mansion_info(chrt, options, lon_in_chart)
	return '%s %d %s %s' % (
		info['label'],
		info['index'],
		info['name_translit'],
		info['degree_within'],
	)


def _lunar_phase_text(chrt, options):
	"""Line 1: '<Δλ d°m'> · <phase> · Day N' (anchor-aware).

	The exact elongation is the canonical phase measurement
	(0° = NM, 90° = Q1, 180° = FM, 270° = Q3).
	"""
	if chrt is None:
		return None
	try:
		info = lunar.phase(chrt)
	except Exception:
		return None
	anchor = getattr(options, 'lunar_day_anchor', lunar.ANCHOR_TRUE)
	day_true = lunar.lunation_day_true(chrt)
	day_mean = lunar.lunation_day_mean(chrt)
	day_label = _safe_text('Day', 'Day')
	if anchor == lunar.ANCHOR_MEAN:
		day_text = '%s %d' % (day_label, day_mean)
	elif anchor == lunar.ANCHOR_BOTH and day_true != day_mean:
		day_text = '%s %d (%s %d)' % (day_label, day_true, _safe_text('mean', 'mean'), day_mean)
	else:
		day_text = '%s %d' % (day_label, day_true)
	elong_arc = _format_arc_dm(info.delta_lambda)
	return _safe_text(
		'LunarPhaseRowFmt',
		'{elongation} · {phase} · {day}',
	).format(
		elongation=elong_arc,
		phase=lunar._localize_phase_name(info.name),
		day=day_text,
	)


def _format_arc_dm(deg_value):
	"""Format a positive arc in d°m' (no seconds), matching the Manzil row style."""
	d, m, _s = util.decToDeg(abs(float(deg_value)))
	return '%d°%02d\'' % (d, m)


def _lunar_tithi_text(chrt, options):
	"""Line 2: 'Tithi: <Paksha> <Name> · <Group> · ends HH:MM' (clock = chart's time scheme)."""
	if chrt is None:
		return None
	try:
		t = lunar.tithi(chrt)
	except Exception:
		return None
	if t.is_purnima:
		name_str = '%s (%s)' % (t.name_iast, _safe_text('Full Moon', 'Full Moon'))
	elif t.is_amavasya:
		name_str = '%s (%s)' % (t.name_iast, _safe_text('New Moon', 'New Moon'))
	else:
		name_str = '%s %s' % (t.paksha, t.name_iast)
	parts = ['%s: %s' % (_safe_text('Tithi', 'Tithi'), name_str), t.group]
	end_clock = _tithi_end_clock(chrt)
	if end_clock is not None:
		parts.append('%s %s' % (_safe_text('ends', 'ends'), end_clock))
	return ' · '.join(parts)


def _tithi_end_clock(chrt):
	"""Format the current tithi's end time as HH:MM in the chart's display time scheme.

	Returns None when no end time can be computed (e.g. speed unavailable).
	"""
	jd_end = lunar.tithi_end_jd(chrt)
	if jd_end is None:
		return None
	try:
		_y, _m, _d, h, mi, _s = moonphasejump._utc_jd_to_original_components(
			jd_end, chrt.time, chrt.place,
		)
	except Exception:
		return None
	return '%02d:%02d' % (h, mi)


def _void_course_text(chrt, options):
	"""'Void of course · since 01:00' / 'ends 1583-02-24 03:24', only while void.

	Two lines in one value, so the flag stays narrow. Times are on the chart's
	own clock, as the Tithi row's end; a date is added only when the time
	falls on another day than the chart's.
	"""
	label = void_of_course.display_text(chrt, options)
	if not label:
		return None
	try:
		period = void_of_course.period_for_chart(chrt, options)
	except (AttributeError, IndexError, KeyError, TypeError, ValueError, RuntimeError):
		period = None
	if period is None:
		return label

	def local(jd):
		return moonphasejump._utc_jd_to_original_components(jd, chrt.time, chrt.place)

	def clock(jd):
		y, m, d, h, mi, _s = local(jd)
		time_text = '%02d:%02d' % (h, mi)
		return time_text if (y, m, d) == day else '%04d-%02d-%02d %s' % (y, m, d, time_text)

	try:
		day = local(float(chrt.time.jd))[:3]
		start, end = clock(period.start_jd), clock(period.end_jd)
	except Exception:
		return label
	return _safe_text(
		'VoidCourseSinceEndsFmt', '{label} · since {start}\nends {end}',
	).format(label=label, start=start, end=end)


def _safe_text(key, fallback=None):
	if fallback is None:
		fallback = key
	try:
		import mtexts
		return mtexts.txts.get(key, mtexts.txtseng.get(key, fallback))
	except Exception:
		return fallback


def _solar_condition_result(chrt, planet_index, options):
	"""Resolve the selected historical lens from already-calculated chart data."""
	if chrt is None:
		return None
	try:
		mode = int(getattr(options, 'solarconditionmode', 4))
	except (TypeError, ValueError):
		mode = 4
	profile = _SOLAR_PROFILE_BY_MODE.get(mode, solar_proximity.DEFAULT_PROFILE)
	try:
		return solar_proximity.classify_chart_body(
			chrt,
			int(planet_index),
			profile=profile,
			include_modern=False,
		)
	except (TypeError, ValueError):
		return None


def _out_of_bounds_result(chrt, planet_index):
	"""Resolve OOB through the shared planetary-state engine."""
	if chrt is None:
		return None
	try:
		return planetary_state.classify_chart_body(chrt, int(planet_index))
	except (AttributeError, IndexError, TypeError, ValueError):
		return None


def _out_of_bounds_text(result):
	if result is None or not result.supported or not result.active:
		return None
	return _safe_text('OutOfBounds', 'Out of Bounds')


def _solar_condition_is_active(result):
	return bool(
		result is not None
		and result.supported
		and result.state in {
			solar_proximity.STATE_CAZIMI,
			solar_proximity.STATE_COMBUST,
			solar_proximity.STATE_UNDER_BEAMS,
		}
	)


def _solar_condition_state_text(state):
	if state == solar_proximity.STATE_UNDER_BEAMS:
		return _safe_text('SolarConditionUnderBeams', 'Under the beams')
	if state == solar_proximity.STATE_COMBUST:
		return _safe_text('SolarConditionCombust', 'Combust')
	if state == solar_proximity.STATE_CAZIMI:
		return _safe_text('Cazimi', 'Cazimi')
	return None


def _solar_condition_motion_text(motion):
	if motion == solar_proximity.MOTION_ENTERING:
		return _safe_text('SolarConditionEntering', 'entering')
	if motion == solar_proximity.MOTION_EMERGING:
		return _safe_text('SolarConditionEmerging', 'emerging')
	if motion == solar_proximity.MOTION_EXACT:
		return _safe_text('SolarConditionExact', 'exact')
	return _safe_text('SolarConditionIndeterminate', 'direction indeterminate')


def _solar_condition_separation_text(result):
	if result.lon_separation_deg is None:
		return '—'
	if (
		result.state == solar_proximity.STATE_CAZIMI
		and result.threshold_data is not None
		and result.threshold_data.cazimi_geometry == 'ecliptic_centre'
		and result.centre_separation_deg is not None
	):
		return _format_arc_dm(result.centre_separation_deg)
	return _format_arc_dm(result.lon_separation_deg)


def _solar_condition_value_text(result, *, include_mitigation=False):
	if not _solar_condition_is_active(result):
		return None
	if solar_proximity.MITIGATION_IN_CHARIOT in result.mitigations:
		return ' · '.join((
			_solar_condition_state_text(result.state),
			_safe_text('SolarConditionInChariot', 'In chariot'),
		))
	parts = [
		_solar_condition_state_text(result.state),
		_solar_condition_separation_text(result),
		_solar_condition_motion_text(result.motion),
	]
	if (
		include_mitigation
		and solar_proximity.MITIGATION_MERCURY_SLIGHT_HARM in result.mitigations
	):
		parts.append(_safe_text('SolarConditionSlightlyHarmed', 'Slightly harmed'))
	return ' · '.join(parts)


def _solar_condition_same_sign_relevant(result):
	thresholds = result.threshold_data
	if not _solar_condition_is_active(result) or thresholds is None or result.lon_separation_deg is None:
		return False
	if (
		thresholds.cazimi_same_sign
		and result.lon_separation_deg <= thresholds.cazimi_limit_deg
	):
		return True
	return bool(
		thresholds.combust_same_sign
		and thresholds.combust_limit_deg is not None
		and result.lon_separation_deg <= thresholds.combust_limit_deg
	)


def _solar_condition_detail_rows(result):
	if not _solar_condition_is_active(result):
		return []
	rows = []
	if _solar_condition_same_sign_relevant(result):
		rows.append('%s: %s' % (
			_safe_text('SolarConditionSameSign', 'Same sign'),
			_safe_text('Yes', 'Yes') if result.same_sign else _safe_text('No', 'No'),
		))
	return rows


def _speculum_speed_text(planet_index, value, options, chrt):
	"""Speed in the Speculum's selected mode (words, percent or daily motion)."""
	from webapp.daemon.tables_service import _position_speed_cell
	try:
		return _position_speed_cell(planet_index, value, options, chrt).get('text') or _format_speed(value)
	except Exception:
		return _format_speed(value)


def _format_speed(value):
	sign = '-' if float(value) < 0.0 else ''
	d, m, s = util.decToDeg(abs(float(value)))
	return '%s%02d°%02d\'%02d"/d' % (sign, d, m, s)


@lru_cache(maxsize=192)
def _station_position(jd_ut, body_id, context):
	with context.activate():
		_error, position = astrology.swe_calc_ut(jd_ut, body_id, context.flags)
	return float(position[planets.Planet.LONG])


def _station_event_spans(event, chrt, options):
	if event is None:
		return None
	try:
		calflag = astrology.SE_JUL_CAL if chrt.time.cal == chart.Time.JULIAN else astrology.SE_GREG_CAL
		year, month, day, _hour = astrology.swe_revjul(float(event.jd_ut), calflag)
		date_text = dateformat.date_text(int(year), int(month), int(day), options, bc=int(year) <= 0)
		motion = {'SR': 'R', 'SD': 'D'}.get(str(event.code).upper())
		if not date_text or not motion:
			return None
	except (AttributeError, TypeError, ValueError, OverflowError):
		return None
	spans = [
		{'text': date_text + ' ', 'wrapGroup': 1},
		{'text': motion, 'bold': True, 'wrapGroup': 1},
	]
	try:
		context = EphemerisContext.for_chart(chrt, ephe_path=common.get_ephe_path())
		body_id = int(event.body_id)
		physical_id = planetary_state._station_ephemeris_body_id(chrt, body_id)
		lon = _station_position(float(event.jd_ut), physical_id, context)
		if body_id == astrology.SE_TRUE_NODE:
			lon += 180.0
		lon = util.normalize(lon)
		sign_index = int(lon // chart.Chart.SIGN_DEG)
		deg, minute, _second = util.decToDeg(lon % chart.Chart.SIGN_DEG)
		from webapp.daemon.display_palette import sign_color_role
		colour = common.get_sign_color(options, sign_index)
		spans.extend((
			{'text': ' '},
			{
				'text': _sign_glyph(sign_index, options), 'glyph': True,
				'colour': colour,
				'colourRole': sign_color_role(options, sign_index, resolved_color=colour),
				'wrapGroup': 2,
			},
			{'text': ' %02d°%02d\'' % (deg, minute), 'wrapGroup': 2},
		))
	except (AttributeError, IndexError, TypeError, ValueError, OverflowError):
		pass
	return spans


def _station_event_text(event, chrt, options):
	spans = _station_event_spans(event, chrt, options)
	return ''.join(span['text'] for span in spans) if spans else None


def _planet_station_bracket(chrt, planet_index):
	if chrt is None:
		return None
	try:
		bracket = planetary_state.station_bracket(chrt, int(planet_index))
	except Exception:
		return None
	return bracket if bracket.supported else None


def _planet_station_detail_items(chrt, planet_index, options):
	bracket = _planet_station_bracket(chrt, planet_index)
	if bracket is None:
		return []
	rows = []
	for label, event in (
		(_safe_text('LastStation', 'Last station'), bracket.previous),
		(_safe_text('NextStation', 'Next station'), bracket.next),
	):
		spans = _station_event_spans(event, chrt, options)
		if spans:
			value = ''.join(span['text'] for span in spans)
			rows.append({'text': '%s: %s' % (label, value), 'spans': spans})
	return rows


def _planet_station_detail_rows(chrt, planet_index, options):
	return [item['text'] for item in _planet_station_detail_items(chrt, planet_index, options)]


def _planet_next_station_flag_row(chrt, planet_index, options):
	bracket = _planet_station_bracket(chrt, planet_index)
	if bracket is None:
		return None
	spans = _station_event_spans(bracket.next, chrt, options)
	if not spans:
		return None
	return (_safe_text('NextStation', 'Next station'), '', None, spans)


def _append_next_station_flag(payload, data, chrt, planet_index, options, defer_signals):
	try:
		is_retrograde = float(data.get('speed_lon')) < 0.0
	except (TypeError, ValueError):
		is_retrograde = False
	if not is_retrograde:
		return
	if defer_signals:
		payload['deferredSlots'] = ['stations']
		return
	row = _planet_next_station_flag_row(chrt, planet_index, options)
	if row is not None:
		payload['nextStationRow'] = row
		payload['rows'].append(row)


def _format_orb(value):
	"""One orb format at every size, to the nearest minute: 0°03', 3°38'."""
	d, m = divmod(int(round(abs(float(value)) * 60.0)), 60)
	return '%d°%02d\'' % (d, m)


def _aspect_text(kind):
	label = _ASPECT_LABELS.get(kind, 'aspect')
	return _safe_text(label, label)


def _aspect_title(kind):
	label = _ASPECT_FULL_LABELS.get(kind, 'Aspect')
	return _safe_text(label, label)


def _aspect_glyph(kind):
	try:
		return common.common.Aspects[int(kind)]
	except Exception:
		return ''


def _aspect_body_label(body, options=None):
	"""Return display label for an aspect endpoint dict (planet name, 'Asc', 'Fortune', etc.)."""
	if not isinstance(body, dict):
		return '—'
	kind = body.get('kind')
	if kind == 'planet':
		try:
			label = _planet_name(int(body.get('index', 0)), options)
		except Exception:
			label = body.get('label') or '—'
	else:
		label = body.get('label') or '—'
	return _with_ring_numeral(label, body.get('ring_numeral'))


def _with_ring_numeral(label, numeral):
	text = str(label or '').strip()
	ring = str(numeral or '').strip()
	return '%s %s' % (ring, text) if text and ring else text


def _aspect_body_glyph(body):
	"""Return Morinus glyph for an aspect endpoint, or '' if none."""
	if not isinstance(body, dict):
		return ''
	kind = body.get('kind')
	if kind == 'planet':
		try:
			return _planet_glyph(int(body.get('index', 0)))
		except Exception:
			return ''
	return body.get('glyph') or ''


def _aspect_state_label(data):
	"""'applying' / 'separating' / 'exact'."""
	if bool(data.get('exact')):
		return 'exact'
	return 'applying' if bool(data.get('applying')) else 'separating'


def _format_orb_decimal(value):
	"""Decimal-degree orb format: '1.5°', '0.5°' — one decimal, no arc seconds, leading zero."""
	return '%.1f°' % abs(float(value))


def _aspect_endpoint(glyph, text, ring_numeral=None):
	"""One side of a glyph aspect row: a Morinus glyph, else a short text label."""
	return {'glyph': glyph or '', 'text': '' if glyph else str(text or ''), 'ring': str(ring_numeral or '')}


def _planet_aspect_endpoint(chrt, planet_index, options, ring_numeral=None):
	"""A planet side of a glyph aspect row, in its dignity colour."""
	endpoint = _aspect_endpoint(_planet_glyph(planet_index), _planet_name(planet_index, options), ring_numeral)
	if endpoint['glyph']:
		span = _planet_glyph_span(chrt, planet_index)
		endpoint['colour'] = span['colour']
		endpoint['colour_role'] = span['colourRole']
	return endpoint


def _glyph_aspect_fields(label_state, current, other, asp):
	"""Actor-first glyph row fields: left, aspect glyph, right, app./sep., orb.

	``exact`` (within the Exact orb setting) is shown by emphasising the orb."""
	# The inspected object is on every row; it is drawn muted so the partner reads first.
	current = {**current, 'own': True}
	left, right = (other, current) if label_state.get('other_is_actor') else (current, other)
	return {
		'left': left,
		'right': right,
		'state_text': label_state['state_text'],
		'orb_text': _format_orb(asp.aspdif),
		'exact': bool(asp.exact),
	}


def _directed_aspect_labels(current_name, other_name, aspect_name, directed_state):
	if directed_state is None:
		return None
	other_is_actor = bool(
		(directed_state.get('is_applying') or directed_state.get('is_separating'))
		and not directed_state.get('current_is_actor')
	)
	state_text = ''
	app_abbr = _safe_text('AbbrApplying', 'app.')
	sep_abbr = _safe_text('AbbrSeparating', 'sep.')
	if directed_state.get('is_applying'):
		state_text = app_abbr
		if directed_state.get('current_is_actor'):
			compact = '%s %s %s' % (aspect_name, other_name, app_abbr)
			prefix = ''
			suffix = '%s %s' % (other_name, app_abbr)
		else:
			compact = '%s %s %s' % (other_name, aspect_name, app_abbr)
			prefix = '%s ' % other_name
			suffix = app_abbr
		full = _safe_text('AspectApplyingSentence', '%s applying to %s by %s') % (
			current_name if directed_state.get('current_is_actor') else other_name,
			other_name if directed_state.get('current_is_actor') else current_name,
			aspect_name,
		)
	elif directed_state.get('is_separating'):
		state_text = sep_abbr
		if directed_state.get('current_is_actor'):
			compact = '%s %s %s' % (aspect_name, other_name, sep_abbr)
			prefix = ''
			suffix = '%s %s' % (other_name, sep_abbr)
		else:
			compact = '%s %s %s' % (other_name, aspect_name, sep_abbr)
			prefix = '%s ' % other_name
			suffix = sep_abbr
		full = _safe_text('AspectSeparatingSentence', '%s separating from %s by %s') % (
			current_name if directed_state.get('current_is_actor') else other_name,
			other_name if directed_state.get('current_is_actor') else current_name,
			aspect_name,
		)
	else:
		compact = '%s %s' % (other_name, aspect_name)
		prefix = '%s ' % other_name
		suffix = ''
		full = _safe_text('AspectExactSentence', '%s exact %s with %s') % (current_name, aspect_name, other_name)
	return {
		'compact_text': compact,
		'full_text': full,
		'prefix_text': prefix,
		'suffix_text': suffix,
		'state_text': state_text,
		'other_is_actor': other_is_actor,
	}


def relative_cross_chart_aspect_state(current_body, other_body, aspect_type):
	"""Directed state for a biwheel/relative aspect.

	The primary ring is the fixed reference in a comparison/transit biwheel. The
	outer ring supplies the motion, so a radix endpoint never becomes the actor
	simply because its natal speed happened to outrank the transiting body.
	"""
	if not isinstance(current_body, dict) or not isinstance(other_body, dict):
		return None
	if current_body.get('kind') != 'planet' or other_body.get('kind') != 'planet':
		return None
	try:
		current_lon = float(current_body['lon'])
		other_lon = float(other_body['lon'])
		current_speed = float(current_body.get('speed') or 0.0)
		other_speed = float(other_body.get('speed') or 0.0)
	except Exception:
		return None
	current_role = current_body.get('role') or 'primary'
	other_role = other_body.get('role') or 'primary'
	outer_side = None
	if current_role == 'outer' and other_role != 'outer':
		other_speed = 0.0
		outer_side = 'current'
	elif other_role == 'outer' and current_role != 'outer':
		current_speed = 0.0
		outer_side = 'other'
	try:
		state = chart.Chart.directed_aspect_state_from_motion(
			0,
			1,
			current_lon,
			current_speed,
			other_lon,
			other_speed,
			int(aspect_type),
		)
	except Exception:
		return None
	if outer_side is not None:
		state['current_is_actor'] = outer_side == 'current'
		state['other_is_actor'] = outer_side == 'other'
	actor_side = 'current' if state.get('current_is_actor') else 'other'
	target_side = 'other' if actor_side == 'current' else 'current'
	try:
		current_idx = int(current_body.get('index'))
		other_idx = int(other_body.get('index'))
	except Exception:
		current_idx = current_body.get('index')
		other_idx = other_body.get('index')
	state['actor_side'] = actor_side
	state['target_side'] = target_side
	state['actor_id'] = current_idx if actor_side == 'current' else other_idx
	state['target_id'] = other_idx if actor_side == 'current' else current_idx
	return state


def _planet_motion_body(chrt, planet_index, role='primary'):
	try:
		body = chrt.get_planet_body(int(planet_index))
	except Exception:
		body = None
	if body is None:
		return None
	try:
		return {
			'kind': 'planet',
			'index': int(planet_index),
			'lon': float(body.data[planets.Planet.LONG]),
			'speed': float(body.data[planets.Planet.SPLON]),
			'role': role,
		}
	except Exception:
		return None


def _directed_cross_chart_planetary_aspect(current_chart, current_idx, partner_chart, other_idx, asp, current_role='primary'):
	if asp is None or getattr(asp, 'typ', chart.Chart.NONE) == chart.Chart.NONE:
		return None
	current_role = current_role or 'primary'
	other_role = 'primary' if current_role == 'outer' else 'outer'
	current_body = _planet_motion_body(current_chart, current_idx, current_role)
	other_body = _planet_motion_body(partner_chart, other_idx, other_role)
	state = relative_cross_chart_aspect_state(current_body, other_body, asp.typ)
	if state is None:
		return None
	state['aspect_type'] = asp.typ
	state['orb'] = getattr(asp, 'aspdif', 0.0)
	state['exact'] = getattr(asp, 'exact', False)
	return state


def _chart_ref(data):
	chrt = data.get('chart')
	if chrt is None:
		return None
	return chrt


def _aspect_colour_role(aspect_type):
	try:
		return _ASPECT_COLOUR_ROLES[int(aspect_type)]
	except (IndexError, TypeError, ValueError):
		return None


def _body_colour_role(chrt, options, planet_index):
	"""Semantic role for the same colour selected by the chart renderer.

	The role is presentation metadata only.  It lets retained web payloads follow
	the active CSS palette without asking the daemon to rebuild chart semantics.
	"""
	try:
		planet_index = int(planet_index)
	except (TypeError, ValueError):
		return '--morinus-peregrin'
	if planet_index == common.CHART_OBJECT_VERTEX:
		return '--morinus-peregrin'
	if getattr(options, 'useplanetcolors', False):
		return _BODY_COLOUR_ROLES.get(planet_index, '--morinus-peregrin')
	if planet_index in (astrology.SE_CHIRON, astrology.SE_MEAN_APOG, astrology.SE_OSCU_APOG):
		return '--morinus-peregrin'
	return _dignity_colour_role(chrt, planet_index)


def _dignity_colour_role(chrt, planet_index):
	if chrt is None:
		return '--morinus-peregrin'
	try:
		return dignity_color_role(chrt.dignity(int(planet_index)), minor_dignity_count(chrt, planet_index))
	except Exception:
		return '--morinus-peregrin'


def _literal_colour_role(options, colour):
	"""Resolve non-body literals with an unambiguous public chart role.

	This is a fallback for flag producers that already serialize a literal but
	do not carry object identity (for example a secondary-ring producer).  The
	semantic builders above remain authoritative for bodies, dignities, and
	aspects, where equal RGB values must not collapse distinct roles.
	"""
	if options is None or colour is None:
		return None
	try:
		colour = tuple(colour)
	except TypeError:
		return None
	role_attrs = (
		('--morinus-signs', 'clrsigns'),
		('--morinus-element-fire', 'clrsignelementfire'),
		('--morinus-element-earth', 'clrsignelementearth'),
		('--morinus-element-air', 'clrsignelementair'),
		('--morinus-element-water', 'clrsignelementwater'),
		('--morinus-text-bright', 'clrtexts'),
		('--morinus-peregrin', 'clrperegrin'),
		('--morinus-dignity-domicil', 'clrdomicil'),
		('--morinus-dignity-exal', 'clrexal'),
		('--morinus-dignity-casus', 'clrcasus'),
		('--morinus-dignity-exil', 'clrexil'),
	)
	matches = []
	for role, attr in role_attrs:
		try:
			if colour == tuple(getattr(options, attr)):
				matches.append(role)
		except (AttributeError, TypeError):
			continue
	return matches[0] if len(matches) == 1 else None


def _flag_accent_colour_role(region, options, accent):
	if accent is None:
		return None
	data = region.get('data') or {}
	explicit_role = data.get('colour_role')
	if isinstance(explicit_role, str) and explicit_role.startswith('--morinus-'):
		return explicit_role
	kind = region.get('kind')
	if kind == 'planet':
		return _body_colour_role(
			_chart_ref(data),
			options,
			region.get('object_id', data.get('planet_index')),
		)
	if kind == 'fortune':
		return '--morinus-body-fortune' if getattr(options, 'useplanetcolors', False) else '--morinus-peregrin'
	if kind == 'syzygy':
		return '--morinus-signs'
	if kind == 'eclipse':
		return '--morinus-signs'
	if kind == 'angle':
		return '--morinus-angles'
	if kind == 'aspect':
		return _aspect_colour_role(data.get('aspect_type', region.get('object_id')))
	if kind == 'drishti' and data.get('actor_id') is not None:
		return _body_colour_role(_chart_ref(data), options, data.get('actor_id'))
	return _literal_colour_role(options, accent)


def _is_varga_chart(chrt):
	return chrt is not None and getattr(chrt, '_varga_number', None) is not None


def _varga_house_number(chrt, longitude):
	if not _is_varga_chart(chrt):
		return None
	try:
		asc = float(chart.semantic_angle_longitude(chrt, 'asc'))
		asc_sign = int(util.normalize(asc) // chart.Chart.SIGN_DEG)
		sign = int(util.normalize(float(longitude)) // chart.Chart.SIGN_DEG)
		return ((sign - asc_sign) % chart.Chart.SIGN_NUM) + 1
	except Exception:
		return None


def _varga_house_text(chrt, longitude, fallback=None):
	house = _varga_house_number(chrt, longitude)
	return _house_text(house if house is not None else fallback)


def _drishti_method_text(method):
	if method == harmonic_chart.DRISHTI_MODE_JAIMINI:
		return _safe_text('DrishtiJaimini', 'Jaimini rāśi dṛṣṭi')
	return _safe_text('DrishtiParashari', 'Parāśari graha dṛṣṭi')


def _drishti_party_text(data, options):
	if data.get('actor_kind') == 'planet' and data.get('actor_id') is not None:
		actor = _planet_name(int(data['actor_id']), options)
	else:
		actor = _sign_name(int(data.get('actor_sign', 0)))
	target = _sign_name(int(data.get('target_sign', 0)))
	return actor, target


def _varga_planet_payload(region, options, data, accent, accent_role, role='', defer_signals=False):
	planet_index = int(region.get('object_id', 0))
	lon = data.get('display_lon', data.get('longitude', 0.0))
	_, pos_text = _format_position(lon)
	smart_rows = [pos_text, _varga_house_text(_chart_ref(data), lon, data.get('house_index'))]
	motion_heading = _motion_heading(data)
	if planet_index not in (astrology.SE_SUN, astrology.SE_MOON):
		smart_rows.append(_motion_text(data))
	station_items = [] if defer_signals else _planet_station_detail_items(
		_chart_ref(data), planet_index, options,
	)
	station_rows = [item['text'] for item in station_items]
	return {
		'glyph': _planet_glyph(planet_index),
		'title': _planet_name(planet_index, options),
		'motionGlyph': motion_heading.get('glyph', '') if motion_heading else '',
		'motionUsesSymbolFont': bool(motion_heading and motion_heading.get('uses_symbol_font')),
		'motionLabel': motion_heading.get('label', '') if motion_heading else '',
		'meta': role,
		'accent': accent,
		'accentRole': accent_role,
		'smart_rows': smart_rows,
		'dignity_rows': [],
		'dignity_items': [],
		'detail_rows': station_rows,
		'station_rows': station_rows,
		'station_items': station_items,
		'aspect_rows': [],
		'aspect_items': [],
		'manzil': None,
		'phasis_row': None,
		'deferred_slots': ['stations'] if defer_signals and planet_index not in (astrology.SE_SUN, astrology.SE_MOON) else [],
		'rows': smart_rows,
		'footer': '',
	}


def _dignity_text(chrt, planet_index):
	if not _is_classical_planet(planet_index):
		return None
	try:
		return _DIGNITY_LABELS.get(chrt.dignity(int(planet_index)), 'Peregrine')
	except Exception:
		return None


def _dignity_colour(chrt, options, planet_index):
	if chrt is None or options is None:
		return None
	try:
		return chart_dignity_color(chrt, options, int(planet_index))
	except Exception:
		return None


def _minor_dignity_colour(options):
	if options is None:
		return None
	try:
		return tuple(options.clrdomicil)
	except Exception:
		return None


def _essential_dignity_score_label(chrt, score_index):
	try:
		score = chrt.options.dignityscores[int(score_index)]
	except Exception:
		return ''
	if int(score) <= 0:
		return ''
	return ' +%d' % int(score)


def _is_classical_planet(planet_index):
	try:
		return astrology.SE_SUN <= int(planet_index) <= astrology.SE_SATURN
	except (TypeError, ValueError):
		return False


def _essential_dignity_info(chrt, planet_index, lon=None):
	try:
		if _is_classical_planet(planet_index):
			info = chrt.get_planet_essential_dignities(int(planet_index), lon=lon)
		else:
			# Outer planets, nodes and other bodies hold no essential dignity,
			# but the degree they occupy still has domicile, exaltation,
			# triplicity, term and face rulers.
			if lon is None:
				lon = chrt.get_planet_body(int(planet_index)).data[planets.Planet.LONG]
			info = chrt.get_longitude_essential_rulers(lon)
	except Exception:
		return None
	if info is None:
		return None
	rows = []
	for item in info.get('rows', []):
		new_item = dict(item)
		score = new_item.get('score', 0)
		new_item['score_label'] = ' +%d' % int(score) if new_item.get('active') and int(score) > 0 else ''
		rows.append(new_item)
	info = dict(info)
	info['rows'] = rows
	return info


def _planetary_joy_info(chrt, planet_index, lon=None, house_index=None):
	try:
		return chrt.get_planetary_joy_info(int(planet_index), lon=lon, house_index=house_index)
	except Exception:
		return None


def _essential_dignity_summary_text(chrt, planet_index, lon=None):
	if not _is_classical_planet(planet_index):
		return None
	info = _essential_dignity_info(chrt, planet_index, lon=lon)
	if info is None:
		return None
	return info.get('active_summary') or _safe_text('Peregrine', 'Peregrine')


def _essential_dignity_detail_rows(chrt, planet_index, lon=None):
	return [item['text'] for item in _essential_dignity_detail_items(chrt, planet_index, lon=lon)]


def _essential_dignity_detail_items(chrt, planet_index, lon=None):
	info = _essential_dignity_info(chrt, planet_index, lon=lon)
	if info is None:
		return []
	return _essential_ruler_items(chrt, info)


def _point_ruler_detail_rows(chrt, lon):
	return [item['text'] for item in _point_ruler_detail_items(chrt, lon)]


def _point_ruler_detail_items(chrt, lon):
	"""Domicile/Exaltation/Term/Face ruler rows for a non-body chart point."""
	if chrt is None or lon is None:
		return []
	try:
		info = _essential_dignity_info(chrt, -1, lon=float(lon))
	except (TypeError, ValueError):
		return []
	if info is None:
		return []
	return _essential_ruler_items(chrt, info)


def _point_ruler_detail_fields(chrt, lon):
	items = _point_ruler_detail_items(chrt, lon)
	return {'detail_rows': [item['text'] for item in items], 'ruler_items': items}


def _planet_glyph_span(chrt, planet_index):
	"""A planet as its Morinus glyph in its dignity colour, like the Triplicity Rulers row."""
	return {
		'text': _planet_glyph(planet_index),
		'colour': _dignity_colour(chrt, getattr(chrt, 'options', None), planet_index),
		'colourRole': _dignity_colour_role(chrt, planet_index),
		'glyph': True,
	}


def _point_trigon_lords_item(chrt, options, lon):
	if chrt is None or lon is None:
		return None
	try:
		sign_index = int(util.normalize(float(lon)) // chart.Chart.SIGN_DEG)
	except (TypeError, ValueError):
		return None
	return _trigon_lords_item(chrt, options, sign_index)


def _essential_ruler_rows(chrt, info, headline):
	return [item['text'] for item in _essential_ruler_items(chrt, info)]


def _essential_ruler_items(chrt, info):
	"""Ruler rows naming another planet as ruler, each with a glyph value span.

	Dignities the planet holds itself are listed once, in the Dignity block,
	so they get no row here; almuten points are not shown in the Inspector."""
	rows = []
	for item in info.get('rows', []):
		label = item.get('label') or 'Dignity'
		# The complete sect-ordered ruler sequence is rendered once as the
		# coloured Triplicity Rulers glyph row.  A planet's own Trigon lord
		# status remains in the dignity block via _dignity_display_items().
		if label == 'Triplicity':
			continue
		ruler_id = item.get('ruler')
		if item.get('active') or not _is_classical_planet(ruler_id):
			continue
		ruler_name = _planet_name(ruler_id, getattr(chrt, 'options', None))
		spans = [_planet_glyph_span(chrt, ruler_id), {'text': '\u00a0%s' % ruler_name}] if _planet_glyph(ruler_id) else None
		rows.append({'text': '%s: %s' % (_safe_text(label, label), ruler_name), 'spans': spans})
	return rows


def _other_essential_dignity_summary_text(chrt, planet_index, lon=None):
	labels = _other_essential_dignity_labels(chrt, planet_index, lon=lon)
	if not labels:
		return '—'
	return ', '.join(labels)


def _other_essential_dignity_labels(chrt, planet_index, lon=None):
	if not _is_classical_planet(planet_index):
		return []
	info = _essential_dignity_info(chrt, planet_index, lon=lon)
	if info is None:
		return []
	headline = _dignity_text(chrt, planet_index) if chrt is not None else None
	labels = []
	for item in info.get('rows', []):
		label = item.get('label') or ''
		if headline in ('Domicile', 'Exaltation') and label == headline:
			continue
		if label == 'Triplicity':
			if item.get('present'):
				status = item.get('status_label') or 'Triplicity'
				labels.append(_safe_text(status, status))
		elif item.get('active'):
			labels.append(_safe_text(label, label))
	return labels


def _dignity_display_items(chrt, options, planet_index, lon=None):
	# Non-classical bodies have degree rulers, never personal dignity or joy.
	if not _is_classical_planet(planet_index):
		if lon is None:
			try:
				lon = chrt.get_planet_body(int(planet_index)).data[planets.Planet.LONG]
			except (AttributeError, TypeError, ValueError):
				return []
		item = _point_trigon_lords_item(chrt, options, lon)
		return [item] if item is not None else []
	info = _essential_dignity_info(chrt, planet_index, lon=lon)
	headline = _dignity_text(chrt, planet_index) if chrt is not None else None
	minor_labels = _other_essential_dignity_labels(chrt, planet_index, lon=lon)
	triplicity = next(
		(item for item in (info or {}).get('rows', []) if item.get('label') == 'Triplicity'),
		None,
	)

	# Chart.dignity() is the inherited five-colour renderer classifier.  Its
	# PEREGRIN bucket means "none of domicile/exaltation/detriment/fall", not
	# the traditional judgment "no essential dignity whatsoever".  Keep that
	# stable renderer contract, but never promote its neutral fallback into a
	# false inspector statement when triplicity, term, or face is present.
	if headline == _DIGNITY_LABELS[chart.Chart.PEREGRIN] and minor_labels:
		headline = None

	sign_colour = _dignity_colour(chrt, options, planet_index)
	sign_colour_role = _dignity_colour_role(chrt, planet_index)
	minor_colour = _minor_dignity_colour(options)
	items = []
	if headline is not None:
		items.append({
			'label': _safe_text('Dignity', 'Dignity'),
			'value': _safe_text(headline, headline),
			'colour': sign_colour,
			'colour_role': sign_colour_role,
		})
	for index, label in enumerate(minor_labels):
		items.append({
			'label': _safe_text('Dignity', 'Dignity') if headline is None and index == 0 else '',
			'value': label,
			'colour': minor_colour,
			'colour_role': '--morinus-dignity-domicil',
		})
	triplicity_item = None
	if triplicity is not None and triplicity.get('rulers'):
		lord_items = []
		for ruler_id in triplicity['rulers']:
			if ruler_id is None or ruler_id == -1:
				continue
			lord_items.append({
				'planet_id': int(ruler_id),
				'glyph': _planet_glyph(ruler_id),
				'name': _planet_name(ruler_id, options),
				'colour': _dignity_colour(chrt, options, ruler_id),
				'colour_role': _dignity_colour_role(chrt, ruler_id),
				'current': int(ruler_id) == int(planet_index),
			})
		if lord_items:
			triplicity_item = {
				'kind': 'triplicity_lords',
				'label': _safe_text('Triplicity Rulers', 'Triplicity Rulers'),
				'flag_label': _safe_text('Trip. Rulers', 'Trip. Rulers'),
				'lords': lord_items,
				'value_text': ', '.join(item['name'] for item in lord_items),
			}
	joy_info = _planetary_joy_info(chrt, planet_index, lon=lon)
	if joy_info is not None and joy_info.get('active'):
		joy_label = joy_info.get('short_label') or 'Joy'
		items.append({
			'label': '',
			'value': _safe_text(joy_label, joy_label),
			'colour': minor_colour,
			'colour_role': '--morinus-dignity-domicil',
		})
	if triplicity_item is not None:
		items.append(triplicity_item)
	return items


def _append_before_triplicity_lords(items, item):
	for index, existing in enumerate(items):
		if existing.get('kind') == 'triplicity_lords':
			items.insert(index, item)
			return
	items.append(item)


def _domicile_ruler_for_sign(options, sign):
	sign = int(sign) % chart.Chart.SIGN_NUM
	try:
		for candidate in range(astrology.SE_SUN, astrology.SE_SATURN + 1):
			if options.dignities[candidate][0][sign]:
				return candidate
	except Exception:
		pass
	return _SIGN_RULERS[sign]


def _mutual_reception_item(chrt, options, planet_index, lon=None):
	if chrt is None:
		return None
	try:
		planet_index = int(planet_index)
	except Exception:
		return None
	try:
		if lon is None:
			body = chrt.get_planet_body(planet_index)
			if body is None:
				return None
			lon = float(body.data[planets.Planet.LONG])
		else:
			lon = float(lon)
		sign = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
	except Exception:
		return None
	ruler = _domicile_ruler_for_sign(chrt.options, sign)
	if ruler == planet_index:
		return None
	partner_body = chrt.get_planet_body(ruler)
	if partner_body is None:
		return None
	try:
		partner_lon = float(partner_body.data[planets.Planet.LONG])
		partner_sign = int(partner_lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
	except Exception:
		return None
	if _domicile_ruler_for_sign(chrt.options, partner_sign) != planet_index:
		return None
	return {
		'label': _safe_text('Mutual reception', 'Mutual reception'),
		'kind': 'mutual_reception',
		'left': _planet_glyph(planet_index),
		'arrow': '⇆',
		'right': _planet_glyph(ruler),
		'left_colour': _dignity_colour(chrt, options, planet_index),
		'left_colour_role': _dignity_colour_role(chrt, planet_index),
		'right_colour': _dignity_colour(chrt, options, ruler),
		'right_colour_role': _dignity_colour_role(chrt, ruler),
		'bold': True,
	}


def _nearest_signal_text(chrt, planet_index):
	try:
		signals = radixsignals.get_radix_overlay_signals(chrt)
	except Exception:
		return None

	best = None
	for bucket in ('phasis', 'stations'):
		for item in signals.get(bucket, []):
			if item.get('planet') != planet_index:
				continue
			offset_days = abs(float(item.get('offset_days', item.get('offset', 999.0))))
			label = radixsignals.format_signal_label(item.get('code'))
			offset = radixsignals.format_signal_offset(item.get('offset'))
			candidate = (offset_days, '%s %s' % (label, offset) if offset else label)
			if best is None or candidate[0] < best[0]:
				best = candidate
	return best[1] if best else None


def _visible_planet_count(chrt):
	try:
		return len(chrt.get_visible_aspect_planet_ids(include_chiron=True))
	except Exception:
		return 0


def _planet_has_aspmatrix(chrt, planet_index):
	try:
		return chrt.get_planet_body(int(planet_index)) is not None
	except Exception:
		return False


def _planet_visible_in_inspector(options, planet_index):
	return common.common.is_planet_visible(options, planet_index)


def _is_aspect_enabled(chrt, options, aspect_type, lon1, lon2):
	if not getattr(options, 'aspects', False):
		return False
	if aspect_type == chart.Chart.NONE:
		return False
	if aspect_type >= len(getattr(options, 'aspect', ())):
		return False
	if not options.aspect[aspect_type]:
		return False
	if not getattr(options, 'traditionalaspects', False):
		return True
	if aspect_type not in (
		chart.Chart.CONJUNCTIO,
		chart.Chart.SEXTIL,
		chart.Chart.QUADRAT,
		chart.Chart.TRIGON,
		chart.Chart.OPPOSITIO,
	):
		return False
	try:
		lona1 = float(lon1)
		lona2 = float(lon2)
		sign1 = int(lona1 / chart.Chart.SIGN_DEG)
		sign2 = int(lona2 / chart.Chart.SIGN_DEG)
		signdiff = math.fabs(sign1 - sign2)
		if signdiff > chart.Chart.SIGN_NUM / 2:
			signdiff = chart.Chart.SIGN_NUM - signdiff
		return _TRADITIONAL_ASPECT_SIGN_DIFF[aspect_type] == signdiff
	except Exception:
		return False


def _drop_mirrored_node_row(rows, items, node_hits):
	"""Show one row for an aspect both lunar nodes share (``node_mirror``).

	``node_hits`` maps node body id to ``(aspect type, index in rows/items)``."""
	drop = node_mirror.redundant_keys(
		(index, None, node, typ) for node, (typ, index) in node_hits.items()
	)
	for index in sorted(drop, reverse=True):
		del rows[index]
		del items[index]


def _current_aspect_rows(
	chrt, planet_index, options, partner_chart=None, current_role='primary',
	current_ring_numeral=None, partner_ring_numeral=None,
):
	rows = []
	items = []
	node_hits = {}
	# Callers also use this builder for symbolic charts whose aspect matrices are
	# intentionally absent (for example Parashari Vargas).  Respect the semantic
	# aspect gate before touching any precomputed matrix.
	if not bool(getattr(options, 'aspects', False)):
		return rows, items
	cross_chart = partner_chart is not None and partner_chart is not chrt
	target_chart = partner_chart if cross_chart else chrt
	planet_ids = []
	try:
		planet_ids = target_chart.get_visible_aspect_planet_ids(include_chiron=True)
	except Exception:
		planet_ids = []
	if not planet_ids:
		return rows, items
	if not _planet_has_aspmatrix(chrt, planet_index):
		return rows, items
	if not _planet_visible_in_inspector(options, planet_index):
		return rows, items
	try:
		planet_i = chrt.get_planet_body(planet_index)
		lon_i = float(planet_i.data[0])
	except Exception:
		return rows, items
	for other in planet_ids:
		# When comparing across charts, the same body id is a valid pair
		# (e.g. transit Sun conj. radix Sun) so we only skip self-aspects in
		# the single-chart case.
		if not cross_chart and other == planet_index:
			continue
		if not _planet_visible_in_inspector(options, other):
			continue
		if cross_chart:
			asp = chrt.get_cross_chart_planetary_aspect(planet_index, partner_chart, other)
		else:
			asp = chrt.get_planetary_aspect(planet_index, other)
		try:
			planet_j = target_chart.get_planet_body(other)
			lon_j = float(planet_j.data[0])
		except Exception:
			continue
		if not _is_aspect_enabled(chrt, options, asp.typ, lon_i, lon_j):
			continue
		if cross_chart:
			directed_state = _directed_cross_chart_planetary_aspect(
				chrt,
				planet_index,
				partner_chart,
				other,
				asp,
				current_role=current_role,
			)
		else:
			directed_state = chrt.get_directed_planetary_aspect(planet_index, other)
		label_state = _directed_aspect_labels(
			_with_ring_numeral(_planet_name(planet_index, options), current_ring_numeral),
			_with_ring_numeral(_planet_name(other, options), partner_ring_numeral),
			_aspect_text(asp.typ),
			directed_state,
		)
		if label_state is None:
			continue
		text = '%s %s' % (
			label_state['compact_text'],
			_format_orb(asp.aspdif),
		)
		if asp.exact:
			text += ' %s' % _safe_text('exact', 'exact')
		rows.append((float(asp.aspdif), text))
		suffix = '%s %s' % (label_state['suffix_text'], _format_orb(asp.aspdif))
		if asp.exact:
			suffix += ' %s' % _safe_text('exact', 'exact')
		items.append((float(asp.aspdif), {
			'prefix_text': label_state['prefix_text'],
			'aspect_glyph': _aspect_glyph(asp.typ),
			'suffix_text': suffix,
			'aspect_colour': tuple(options.clraspect[asp.typ]) if asp.typ < len(getattr(options, 'clraspect', ())) else None,
			'aspect_colour_role': _aspect_colour_role(asp.typ),
			'full_text': label_state['full_text'],
			**_glyph_aspect_fields(
				label_state,
				_planet_aspect_endpoint(chrt, planet_index, options, current_ring_numeral),
				_planet_aspect_endpoint(partner_chart if cross_chart else chrt, other, options, partner_ring_numeral),
				asp,
			),
		}))
		if other in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
			node_hits[other] = (asp.typ, len(items) - 1)
	_drop_mirrored_node_row(rows, items, node_hits)
	rows.sort(key=lambda item: (item[0], item[1]))
	items.sort(key=lambda item: (item[0], item[1].get('full_text', '')))
	return [text for _, text in rows], [item for _, item in items]


def _current_ephemeris_body_aspect_rows(
	chrt, body_id, longitude, speed_lon, body_name, options,
	partner_chart=None, current_role='primary', current_ring_numeral=None,
	partner_ring_numeral=None, declination=None,
):
	"""Build ordinary configured aspects for a dynamic Swiss Ephemeris body."""
	rows = []
	items = []
	node_hits = {}
	if chrt is None or not bool(getattr(options, 'aspects', False)):
		return rows, items
	cross_chart = partner_chart is not None and partner_chart is not chrt
	target_chart = partner_chart if cross_chart else chrt
	try:
		planet_ids = target_chart.get_visible_aspect_planet_ids(include_chiron=True)
		current_orb_index = int(chrt.get_planet_orb_index(int(body_id)))
		lon_i = float(longitude)
		speed_i = float(speed_lon or 0.0)
	except Exception:
		return rows, items
	for other in planet_ids:
		if not _planet_visible_in_inspector(options, other):
			continue
		try:
			planet_j = target_chart.get_planet_body(other)
			lon_j = float(planet_j.data[planets.Planet.LONG])
			speed_j = float(planet_j.data[planets.Planet.SPLON])
			other_orb_index = int(target_chart.get_planet_orb_index(other))
			orb_by_aspect = [
				float(chrt.options.orbis[current_orb_index][aspect_type])
				+ float(chrt.options.orbis[other_orb_index][aspect_type])
				for aspect_type in range(chart.Chart.ASPECT_NUM)
			]
			other_declination = planet_j.dataEqu[planets.Planet.DECLEQU]
			parallel_orbs = [
				float(chrt.options.orbisplanetspar[current_orb_index][0])
				+ float(chrt.options.orbisplanetspar[other_orb_index][0]),
				float(chrt.options.orbisplanetspar[current_orb_index][1])
				+ float(chrt.options.orbisplanetspar[other_orb_index][1]),
			]
			asp = chrt._build_dynamic_aspect(
				lon_i,
				lon_j,
				speed_i,
				speed_j,
				orb_by_aspect,
				declination,
				other_declination,
				parallel_orbs,
				False,
			)
		except Exception:
			continue
		if not _is_aspect_enabled(chrt, options, asp.typ, lon_i, lon_j):
			continue
		directed_state = chart.Chart.directed_aspect_state_from_motion(
			int(body_id), other, lon_i, speed_i, lon_j, speed_j, asp.typ,
		)
		directed_state['aspect_type'] = asp.typ
		directed_state['orb'] = asp.aspdif
		directed_state['exact'] = asp.exact
		directed_state['is_applying'] = bool(asp.appl)
		directed_state['is_separating'] = not bool(asp.appl)
		label_state = _directed_aspect_labels(
			_with_ring_numeral(body_name, current_ring_numeral),
			_with_ring_numeral(_planet_name(other, options), partner_ring_numeral),
			_aspect_text(asp.typ),
			directed_state,
		)
		if label_state is None:
			continue
		text = '%s %s' % (label_state['compact_text'], _format_orb(asp.aspdif))
		if asp.exact:
			text += ' %s' % _safe_text('exact', 'exact')
		rows.append((float(asp.aspdif), text))
		suffix = '%s %s' % (label_state['suffix_text'], _format_orb(asp.aspdif))
		if asp.exact:
			suffix += ' %s' % _safe_text('exact', 'exact')
		items.append((float(asp.aspdif), {
			'prefix_text': label_state['prefix_text'],
			'aspect_glyph': _aspect_glyph(asp.typ),
			'suffix_text': suffix,
			'aspect_colour': tuple(options.clraspect[asp.typ]) if asp.typ < len(getattr(options, 'clraspect', ())) else None,
			'aspect_colour_role': _aspect_colour_role(asp.typ),
			'full_text': label_state['full_text'],
			**_glyph_aspect_fields(
				label_state,
				_aspect_endpoint(_planet_glyph(body_id), body_name, current_ring_numeral),
				_planet_aspect_endpoint(target_chart, other, options, partner_ring_numeral),
				asp,
			),
		}))
		if other in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
			node_hits[other] = (asp.typ, len(items) - 1)
	_drop_mirrored_node_row(rows, items, node_hits)
	rows.sort(key=lambda item: (item[0], item[1]))
	items.sort(key=lambda item: (item[0], item[1].get('full_text', '')))
	return [text for _, text in rows], [item for _, item in items]


def _flag_rows_from_aspect_items(aspect_items, limit=2):
	if not aspect_items:
		return [(_safe_text('Aspect', 'Aspect'), '—')]
	rows = []
	for index, item in enumerate(aspect_items[:limit]):
		spans = []
		prefix = item.get('prefix_text') or ''
		glyph = item.get('aspect_glyph') or ''
		suffix = item.get('suffix_text') or ''
		if prefix:
			spans.append({'text': prefix})
		if glyph:
			spans.append({
				'text': glyph,
				'colour': item.get('aspect_colour'),
				'colourRole': item.get('aspect_colour_role'),
				'glyph': True,
			})
		if suffix:
			spans.append({'text': (' ' if glyph else '') + suffix})
		rows.append((_safe_text('Aspect', 'Aspect') if index == 0 else '', item.get('full_text') or suffix or '—', None, spans))
	return rows


def _flag_aspect_rows(
	chrt, planet_index, options, limit=2, partner_chart=None,
	current_role='primary', current_ring_numeral=None,
	partner_ring_numeral=None,
):
	if chrt is not None and hasattr(chrt, '_varga_number'):
		return []
	if chrt is None:
		return [(_safe_text('Aspect', 'Aspect'), '—')]
	_aspect_rows, aspect_items = _current_aspect_rows(
		chrt,
		planet_index,
		options,
		partner_chart=partner_chart,
		current_role=current_role,
		current_ring_numeral=current_ring_numeral,
		partner_ring_numeral=partner_ring_numeral,
	)
	return _flag_rows_from_aspect_items(aspect_items, limit=limit)


def _point_planet_aspect(chrt, point_lon, planet_chart, planet_index):
	"""Engine aspect between a fixed semantic point and one chart body."""
	try:
		body = planet_chart.get_planet_body(int(planet_index))
		orb_index = chrt.get_planet_orb_index(int(planet_index))
		orb_by_aspect = [
			float(chrt.options.orbis[orb_index][aspect_type])
			for aspect_type in range(chart.Chart.ASPECT_NUM)
		]
		return chrt._build_dynamic_aspect(
			body.data[planets.Planet.LONG],
			float(point_lon),
			body.data[planets.Planet.SPLON],
			0.0,
			orb_by_aspect,
			node_only_conjunction=int(planet_index) in (
				astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE,
			),
		)
	except Exception:
		return None


def _directed_point_aspect(
	point_lon, planet_chart, planet_index, asp, current_role='primary',
):
	if asp is None or getattr(asp, 'typ', chart.Chart.NONE) == chart.Chart.NONE:
		return None
	try:
		body = planet_chart.get_planet_body(int(planet_index))
		state = chart.Chart.directed_aspect_state_from_motion(
			-1,
			int(planet_index),
			float(point_lon),
			0.0,
			float(body.data[planets.Planet.LONG]),
			float(body.data[planets.Planet.SPLON]),
			int(asp.typ),
		)
	except Exception:
		return None
	if (current_role or 'primary') == 'outer':
		state['current_is_actor'] = True
		state['other_is_actor'] = False
		state['actor_id'] = -1
		state['target_id'] = int(planet_index)
	return state


def _current_point_aspect_rows(
	chrt, point_lon, point_label, options, partner_chart=None,
	current_role='primary', current_ring_numeral=None,
	partner_ring_numeral=None, point_glyph='', point_short='',
):
	"""Canonical aspect rows for Fortune, Vertex, Syzygy and Eclipse."""
	rows = []
	items = []
	node_hits = {}
	if not bool(getattr(options, 'aspects', False)):
		return rows, items
	target_chart = partner_chart if partner_chart is not None and partner_chart is not chrt else chrt
	try:
		planet_ids = target_chart.get_visible_aspect_planet_ids(include_chiron=True)
	except Exception:
		planet_ids = []
	for planet_index in planet_ids:
		if not _planet_visible_in_inspector(options, planet_index):
			continue
		if planet_index in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not bool(
			getattr(options, 'aspectstonodes', False)
		):
			continue
		try:
			body = target_chart.get_planet_body(planet_index)
			planet_lon = float(body.data[planets.Planet.LONG])
		except Exception:
			continue
		asp = _point_planet_aspect(chrt, point_lon, target_chart, planet_index)
		if asp is None or not _is_aspect_enabled(
			chrt, options, asp.typ, float(point_lon), planet_lon,
		):
			continue
		directed_state = _directed_point_aspect(
			point_lon,
			target_chart,
			planet_index,
			asp,
			current_role=current_role,
		)
		label_state = _directed_aspect_labels(
			_with_ring_numeral(point_label, current_ring_numeral),
			_with_ring_numeral(
				_planet_name(planet_index, options), partner_ring_numeral,
			),
			_aspect_text(asp.typ),
			directed_state,
		)
		if label_state is None:
			continue
		text = '%s %s' % (label_state['compact_text'], _format_orb(asp.aspdif))
		if asp.exact:
			text += ' %s' % _safe_text('exact', 'exact')
		rows.append((float(asp.aspdif), text))
		suffix = '%s %s' % (label_state['suffix_text'], _format_orb(asp.aspdif))
		if asp.exact:
			suffix += ' %s' % _safe_text('exact', 'exact')
		items.append((float(asp.aspdif), {
			'prefix_text': label_state['prefix_text'],
			'aspect_glyph': _aspect_glyph(asp.typ),
			'suffix_text': suffix,
			'aspect_colour': tuple(options.clraspect[asp.typ])
				if asp.typ < len(getattr(options, 'clraspect', ())) else None,
			'aspect_colour_role': _aspect_colour_role(asp.typ),
			'full_text': label_state['full_text'],
			**_glyph_aspect_fields(
				label_state,
				_aspect_endpoint(point_glyph, point_short or point_label, current_ring_numeral),
				_planet_aspect_endpoint(target_chart, planet_index, options, partner_ring_numeral),
				asp,
			),
		}))
		if planet_index in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
			node_hits[planet_index] = (asp.typ, len(items) - 1)
	_drop_mirrored_node_row(rows, items, node_hits)
	rows.sort(key=lambda item: (item[0], item[1]))
	items.sort(key=lambda item: (item[0], item[1].get('full_text', '')))
	return [text for _, text in rows], [item for _, item in items]


def _flag_point_aspect_rows(
	chrt, point_lon, point_label, options, limit=2, partner_chart=None,
	current_role='primary', current_ring_numeral=None,
	partner_ring_numeral=None,
):
	if chrt is not None and hasattr(chrt, '_varga_number'):
		return []
	if chrt is None:
		return [(_safe_text('Aspect', 'Aspect'), '—')]
	_aspect_rows, aspect_items = _current_point_aspect_rows(
		chrt,
		point_lon,
		point_label,
		options,
		partner_chart=partner_chart,
		current_role=current_role,
		current_ring_numeral=current_ring_numeral,
		partner_ring_numeral=partner_ring_numeral,
	)
	return _flag_rows_from_aspect_items(aspect_items, limit=limit)


def _angle_short_label(angle_key, fallback):
	short = _ANGLE_SHORT_LABELS.get(_normalise_angle_key(angle_key))
	return _safe_text(short, short) if short else fallback


def _normalise_angle_key(angle_key):
	key = str(angle_key or '').lower()
	if key in ('dc', 'dsc'):
		return 'desc'
	return key


def _angle_longitude(chrt, angle_key):
	key = _normalise_angle_key(angle_key)
	try:
		if key == 'asc':
			return float(chrt.houses.ascmc[houses.Houses.ASC])
		if key == 'mc':
			return float(chrt.houses.ascmc[houses.Houses.MC])
		if key == 'desc':
			return util.normalize(float(chrt.houses.ascmc[houses.Houses.ASC]) + 180.0)
		if key == 'ic':
			return util.normalize(float(chrt.houses.ascmc[houses.Houses.MC]) + 180.0)
	except Exception:
		return None
	return None


def _angle_declination(chrt, angle_key):
	key = _normalise_angle_key(angle_key)
	try:
		if key in ('asc', 'desc'):
			value = float(chrt.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL])
			return -value if key == 'desc' else value
		if key in ('mc', 'ic'):
			value = float(chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL])
			return -value if key == 'ic' else value
	except Exception:
		return None
	return None


def _angle_planet_aspect(chrt, angle_key, planet_chart, planet_index):
	"""Return the chart-engine aspect between one angle and one planet.

	ASC/MC on a single chart preserve the precomputed angle matrix. DSC/IC and
	cross-chart pairs use the same dynamic aspect builder and Asc/MC orb family
	as the complete click-adjacency exporter.
	"""
	key = _normalise_angle_key(angle_key)
	angle_lon = _angle_longitude(chrt, key)
	try:
		body = planet_chart.get_planet_body(int(planet_index))
	except Exception:
		body = None
	if angle_lon is None or body is None:
		return None
	if planet_chart is chrt and key in ('asc', 'mc'):
		angle_index = houses.Houses.ASC if key == 'asc' else houses.Houses.MC
		try:
			return chrt.get_ascmc_aspect(angle_index, int(planet_index))
		except Exception:
			return None
	try:
		orb_index = chrt.get_planet_orb_index(int(planet_index))
		orb_by_aspect = [
			chrt.options.orbisAscMC[aspect_type] + chrt.options.orbis[orb_index][aspect_type]
			for aspect_type in range(chart.Chart.ASPECT_NUM)
		]
		angle_decl = _angle_declination(chrt, key)
		planet_decl = body.dataEqu[planets.Planet.DECLEQU]
		parallel_orbs = [
			chrt.options.orbisparAscMC[0] + chrt.options.orbisplanetspar[orb_index][0],
			chrt.options.orbisparAscMC[1] + chrt.options.orbisplanetspar[orb_index][1],
		]
		return chrt._build_dynamic_aspect(
			body.data[planets.Planet.LONG],
			angle_lon,
			body.data[planets.Planet.SPLON],
			0.0,
			orb_by_aspect,
			planet_decl,
			angle_decl,
			parallel_orbs,
			int(planet_index) in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
		)
	except Exception:
		return None


def _directed_angle_aspect(chrt, angle_key, planet_chart, planet_index, asp, current_role='primary'):
	if asp is None or getattr(asp, 'typ', chart.Chart.NONE) == chart.Chart.NONE:
		return None
	angle_lon = _angle_longitude(chrt, angle_key)
	try:
		body = planet_chart.get_planet_body(int(planet_index))
		planet_lon = float(body.data[planets.Planet.LONG])
		planet_speed = float(body.data[planets.Planet.SPLON])
	except Exception:
		return None
	if angle_lon is None:
		return None
	try:
		state = chart.Chart.directed_aspect_state_from_motion(
			-1,
			int(planet_index),
			float(angle_lon),
			0.0,
			planet_lon,
			planet_speed,
			int(asp.typ),
		)
	except Exception:
		return None
	# In a biwheel, the outer ring is the moving chart. Preserve that semantic
	# actor even when the selected outer endpoint is an angle rather than a
	# planet; the aspect state itself still comes from the chart engine.
	if planet_chart is not chrt and (current_role or 'primary') == 'outer':
		state['current_is_actor'] = True
		state['other_is_actor'] = False
		state['actor_id'] = -1
		state['target_id'] = int(planet_index)
	return state


def _current_angle_aspect_rows(
	chrt, angle_key, options, partner_chart=None, current_role='primary',
	current_ring_numeral=None, partner_ring_numeral=None,
):
	rows = []
	items = []
	node_hits = {}
	if not bool(getattr(options, 'aspects', False)):
		return rows, items
	target_chart = partner_chart if partner_chart is not None and partner_chart is not chrt else chrt
	try:
		planet_ids = target_chart.get_visible_aspect_planet_ids(include_chiron=True)
	except Exception:
		planet_ids = []
	angle_lon = _angle_longitude(chrt, angle_key)
	if angle_lon is None:
		return rows, items
	angle_name_en = _ANGLE_LABELS.get(_normalise_angle_key(angle_key), 'Angle')
	angle_name = _safe_text(angle_name_en, angle_name_en)
	for planet_index in planet_ids:
		if not _planet_visible_in_inspector(options, planet_index):
			continue
		try:
			body = target_chart.get_planet_body(planet_index)
			planet_lon = float(body.data[planets.Planet.LONG])
		except Exception:
			continue
		asp = _angle_planet_aspect(chrt, angle_key, target_chart, planet_index)
		if asp is None or not _is_aspect_enabled(chrt, options, asp.typ, angle_lon, planet_lon):
			continue
		directed_state = _directed_angle_aspect(
			chrt,
			angle_key,
			target_chart,
			planet_index,
			asp,
			current_role=current_role,
		)
		label_state = _directed_aspect_labels(
			_with_ring_numeral(angle_name, current_ring_numeral),
			_with_ring_numeral(
				_planet_name(planet_index, options), partner_ring_numeral,
			),
			_aspect_text(asp.typ),
			directed_state,
		)
		if label_state is None:
			continue
		text = '%s %s' % (label_state['compact_text'], _format_orb(asp.aspdif))
		if asp.exact:
			text += ' %s' % _safe_text('exact', 'exact')
		rows.append((float(asp.aspdif), text))
		suffix = '%s %s' % (label_state['suffix_text'], _format_orb(asp.aspdif))
		if asp.exact:
			suffix += ' %s' % _safe_text('exact', 'exact')
		items.append((float(asp.aspdif), {
			'prefix_text': label_state['prefix_text'],
			'aspect_glyph': _aspect_glyph(asp.typ),
			'suffix_text': suffix,
			'aspect_colour': tuple(options.clraspect[asp.typ]) if asp.typ < len(getattr(options, 'clraspect', ())) else None,
			'aspect_colour_role': _aspect_colour_role(asp.typ),
			'full_text': label_state['full_text'],
			**_glyph_aspect_fields(
				label_state,
				_aspect_endpoint('', _angle_short_label(angle_key, angle_name), current_ring_numeral),
				_planet_aspect_endpoint(target_chart, planet_index, options, partner_ring_numeral),
				asp,
			),
		}))
		if planet_index in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
			node_hits[planet_index] = (asp.typ, len(items) - 1)
	_drop_mirrored_node_row(rows, items, node_hits)
	rows.sort(key=lambda item: (item[0], item[1]))
	items.sort(key=lambda item: (item[0], item[1].get('full_text', '')))
	return [text for _, text in rows], [item for _, item in items]


def _flag_angle_aspect_rows(
	chrt, angle_key, options, limit=2, partner_chart=None,
	current_role='primary', current_ring_numeral=None,
	partner_ring_numeral=None,
):
	if chrt is not None and hasattr(chrt, '_varga_number'):
		return []
	if chrt is None:
		return [(_safe_text('Aspect', 'Aspect'), '—')]
	_aspect_rows, aspect_items = _current_angle_aspect_rows(
		chrt,
		angle_key,
		options,
		partner_chart=partner_chart,
		current_role=current_role,
		current_ring_numeral=current_ring_numeral,
		partner_ring_numeral=partner_ring_numeral,
	)
	return _flag_rows_from_aspect_items(aspect_items, limit=limit)


def _moon_traditional_witness_rows(
	chrt, options, limit_each=2, partner_chart=None, current_role='primary',
	current_ring_numeral=None, partner_ring_numeral=None,
):
	if chrt is None or not bool(getattr(options, 'aspects', False)):
		return []
	cross_chart = partner_chart is not None and partner_chart is not chrt
	if cross_chart and current_role != 'outer':
		return []
	target_chart = partner_chart if cross_chart else chrt
	try:
		moon = chrt.get_planet_body(astrology.SE_MOON)
		lon_moon = float(moon.data[planets.Planet.LONG])
	except Exception:
		return []
	if not _planet_visible_in_inspector(options, astrology.SE_MOON):
		return []

	applying = []
	separating = []
	for other in _MOON_TRADITIONAL_WITNESS_BODIES:
		try:
			other_body = target_chart.get_planet_body(other)
			lon_other = float(other_body.data[planets.Planet.LONG])
		except Exception:
			continue
		if cross_chart:
			asp = chrt.get_cross_chart_planetary_aspect(astrology.SE_MOON, partner_chart, other)
			directed_state = _directed_cross_chart_planetary_aspect(
				chrt,
				astrology.SE_MOON,
				partner_chart,
				other,
				asp,
				current_role=current_role,
			)
		else:
			asp = chrt.get_planetary_aspect(astrology.SE_MOON, other)
			directed_state = chrt.get_directed_planetary_aspect(astrology.SE_MOON, other)
		if not _is_aspect_enabled(chrt, options, asp.typ, lon_moon, lon_other):
			continue
		if directed_state is None:
			continue
		item = {
			'other': other,
			'aspect_type': int(asp.typ),
			'orb': float(asp.aspdif),
			'exact': bool(getattr(asp, 'exact', False)),
		}
		if directed_state.get('is_applying'):
			applying.append(item)
		elif directed_state.get('is_separating'):
			separating.append(item)
	applying.sort(key=lambda item: (item['orb'], _planet_name(item['other'], options)))
	separating.sort(key=lambda item: (item['orb'], _planet_name(item['other'], options)))

	def _build_rows(label, items):
		if not items:
			return [(label, '—')]
		rows = []
		for index, item in enumerate(items[:limit_each]):
			aspect_type = item['aspect_type']
			orb = _format_orb(item['orb'])
			suffix = ' %s' % orb
			if item.get('exact'):
				suffix += ' %s' % _safe_text('exact', 'exact')
			planet_name = _with_ring_numeral(
				_planet_name(item['other'], options), partner_ring_numeral,
			)
			aspect_name = _aspect_text(aspect_type)
			text = '%s %s%s' % (planet_name, aspect_name, suffix)
			spans = [
				{'text': '%s ' % planet_name},
				{
					'text': _aspect_glyph(aspect_type),
					'colour': tuple(options.clraspect[aspect_type]) if aspect_type < len(getattr(options, 'clraspect', ())) else None,
					'colourRole': _aspect_colour_role(aspect_type),
					'glyph': True,
				},
				{'text': suffix},
			]
			rows.append((label if index == 0 else '', text, None, spans))
		return rows

	moon_label = _with_ring_numeral(
		_safe_text('Moon', 'Moon'), current_ring_numeral,
	)
	rows = []
	rows.extend(_build_rows('%s %s' % (moon_label, _safe_text('AbbrSeparating', 'sep.')), separating))
	rows.extend(_build_rows('%s %s' % (moon_label, _safe_text('AbbrApplying', 'app.')), applying))
	return rows


def _chart_signature(chrt):
	try:
		planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=True)
		return (
			round(float(chrt.time.jd), 6),
			tuple((i, round(float(chrt.get_planet_body(i).data[0]), 6)) for i in planet_ids if chrt.get_planet_body(i) is not None),
			tuple((i, round(float(chrt.get_planet_body(i).data[3]), 6)) for i in planet_ids if chrt.get_planet_body(i) is not None),
		)
	except Exception:
		return id(chrt)


def _aspect_option_signature(options):
	try:
		return (
			bool(getattr(options, 'aspects', False)),
			tuple(bool(v) for v in getattr(options, 'aspect', ())),
			bool(getattr(options, 'traditionalaspects', False)),
			tuple(bool(v) for v in getattr(options, 'transcendental', ())),
			bool(getattr(options, 'shownodes', False)),
			bool(getattr(options, 'aspectstonodes', False)),
			int(getattr(options, 'ayanamsha', 0)),
			int(getattr(options, 'langid', 0)),
		)
	except Exception:
		return id(options)


def _moon_course_events(chrt, options):
	"""The Moon's Last/Next aspect rows: the dashboard Moon list's exact
	perfections (chart_dashboard.moon_course), same bodies and aspect types."""
	if not _planet_has_aspmatrix(chrt, astrology.SE_MOON) or not _planet_visible_in_inspector(options, astrology.SE_MOON):
		return ('—', '—')
	from webapp.daemon import chart_dashboard
	try:
		body_ids = chrt.get_visible_aspect_planet_ids(include_chiron=True)
	except Exception:
		return ('—', '—')
	last, upcoming, type_of = chart_dashboard.moon_course(
		chrt, body_ids, bool(getattr(options, 'dashboard_moon_all_bodies', False)), options,
	)
	jd = float(chrt.time.jd)

	def _fmt(contact):
		if contact is None:
			return '—'
		return '%s %s %+.1fd' % (_planet_name(contact.body, options), _aspect_text(type_of[contact.angle]), contact.jd - jd)

	return (_fmt(last), _fmt(upcoming))


def _nearest_angle_aspect_events(chrt, angle_key, options):
	normalised_key = _normalise_angle_key(angle_key)
	key = (_chart_signature(chrt), _aspect_option_signature(options), 'angle', normalised_key)
	cached = _ASPECT_EVENT_CACHE.get(key)
	if cached is not None:
		return cached
	angle_lon = _angle_longitude(chrt, normalised_key)
	if angle_lon is None:
		result = ('—', '—')
		_ASPECT_EVENT_CACHE[key] = result
		return result
	try:
		planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=True)
	except Exception:
		planet_ids = []
	next_hit = None
	last_hit = None
	for planet_index in planet_ids:
		if not _planet_visible_in_inspector(options, planet_index):
			continue
		try:
			body = chrt.get_planet_body(planet_index)
			planet_lon = float(body.data[planets.Planet.LONG])
			relative_speed = float(body.data[planets.Planet.SPLON])
		except Exception:
			continue
		if abs(relative_speed) < 1e-7:
			continue
		delta = util.normalize(planet_lon - angle_lon)
		for aspect_type, target_deg in enumerate(chart.Chart.Aspects):
			if not _is_aspect_enabled(chrt, options, aspect_type, angle_lon, planet_lon):
				continue
			targets = [float(target_deg)]
			if target_deg not in (0.0, 180.0):
				targets.append(360.0 - float(target_deg))
			for target in targets:
				for turn in (-1, 0, 1):
					days = (target - delta + (360.0 * turn)) / relative_speed
					if 0.0 < days <= _ASPECT_SEARCH_DAYS:
						candidate = (days, planet_index, aspect_type)
						if next_hit is None or candidate[0] < next_hit[0]:
							next_hit = candidate
					elif -_ASPECT_SEARCH_DAYS <= days < 0.0:
						candidate = (abs(days), planet_index, aspect_type)
						if last_hit is None or candidate[0] < last_hit[0]:
							last_hit = candidate

	def _fmt(hit, future):
		if hit is None:
			return '—'
		days, planet_index, aspect_type = hit
		direction = '+%.1fd' % days if future else '-%.1fd' % days
		return '%s %s %s' % (
			_planet_name(planet_index, options),
			_aspect_text(aspect_type),
			direction,
		)

	result = (_fmt(last_hit, False), _fmt(next_hit, True))
	_ASPECT_EVENT_CACHE[key] = result
	return result


def _with_point_declination(payload, region, *, compact):
	"""Keep point coordinates consistent across every hover/Inspector branch."""
	if payload is None or not region:
		return payload
	data = region.get('data') or {}
	decl = data.get('declination')
	if decl is None or region.get('kind') not in (
		'planet', 'fortune', 'syzygy', 'eclipse', 'angle', 'house', 'secondary_ring',
	):
		return payload
	# Varga positions are symbolic; catalog stars and ephemeris asteroids
	# retain their physical coordinates on those charts.
	if _is_varga_chart(_chart_ref(data)) and not (
		region.get('kind') == 'secondary_ring'
		and data.get('family') in ('fixed_star', 'asteroid')
	):
		return payload
	label = _safe_text('Declination', 'Declination')
	value = _format_signed_angle(decl)
	if compact:
		rows = payload.setdefault('rows', [])
		if not any(row and row[0] == label for row in rows):
			rows.insert(min(1, len(rows)), (label, value))
	else:
		text = '%s %s' % (label, value)
		rows = payload.setdefault('smart_rows', [])
		if text not in rows:
			rows.insert(min(1, len(rows)), text)
		compat_rows = payload.get('rows')
		if compat_rows is not None and compat_rows is not rows and text not in compat_rows:
			compat_rows.insert(min(1, len(compat_rows)), text)
	return payload


def build_payload(region, options, defer_signals=False):
	return _without_empty_rows(_with_point_declination(
		_build_payload(region, options, defer_signals), region, compact=False,
	))


_EMPTY_VALUES = frozenset(('', '—', '–', '--', '-', 'None', 'null'))


def _is_empty_value(value):
	return value is None or str(value).strip() in _EMPTY_VALUES


def _is_empty_text_row(text):
	"""A text row is empty when it is a placeholder or 'Label: —' / 'Label —'."""
	if _is_empty_value(text):
		return True
	text = str(text).strip()
	for separator in (': ', ' '):
		head, sep, tail = text.rpartition(separator)
		if sep and head and _is_empty_value(tail):
			return True
	return False


def _without_empty_rows(payload):
	"""Omit rows with no value: absent facts are not displayed as dashes."""
	if not isinstance(payload, dict):
		return payload
	for key in ('rows', 'smart_rows', 'detail_rows'):
		rows = payload.get(key)
		if not isinstance(rows, list):
			continue
		kept = []
		for row in rows:
			if isinstance(row, (tuple, list)):
				spans = row[3] if len(row) > 3 else None
				if len(row) > 1 and _is_empty_value(row[1]) and not spans:
					continue
			elif isinstance(row, str) and _is_empty_text_row(row):
				continue
			kept.append(row)
		payload[key] = kept
	return payload


def _build_payload(region, options, defer_signals=False):
	if not region:
		return None

	data = region.get('data') or {}
	kind = region.get('kind')
	role = _ROLE_LABELS.get(region.get('chart_role') or 'primary', '')
	role = _safe_text(role, role) if role else role
	accent = tuple(data.get('colour') or ())
	if len(accent) != 3:
		accent = None
	accent_role = _flag_accent_colour_role(region, options, accent)

	if kind == 'planet':
		planet_index = int(region.get('object_id', 0))
		chrt = _chart_ref(data)
		if _is_varga_chart(chrt):
			return _varga_planet_payload(
				region, options, data, accent, accent_role, role,
				defer_signals=defer_signals,
			)
		current_role = region.get('chart_role') or 'primary'
		# When the chart was drawn as a biwheel (transit comparison, synastry,
		# etc.) the renderer also stashes the OTHER ring's chart here so the
		# aspect rows can report transit-to-radix (or radix-to-transit) aspects
		# instead of the hovered chart's aspects to itself.
		partner_chart = data.get('partner_chart')
		lon = data.get('longitude', data.get('display_lon', 0.0))
		house_index = data.get('house_index')
		solar_condition = _solar_condition_result(chrt, planet_index, options)
		solar_condition_text = _solar_condition_value_text(solar_condition, include_mitigation=True)
		out_of_bounds = _out_of_bounds_result(chrt, planet_index)
		out_of_bounds_text = _out_of_bounds_text(out_of_bounds)
		dignity_items = _dignity_display_items(chrt, options, planet_index, lon=lon) if chrt is not None else []
		mutual_item = _mutual_reception_item(chrt, options, planet_index, lon=lon) if chrt is not None else None
		if mutual_item is not None:
			_append_before_triplicity_lords(dignity_items, mutual_item)
		is_luminary = planet_index in (astrology.SE_SUN, astrology.SE_MOON)
		mansion_info = None
		# Motion needs no row: the title carries the retrograde/station marker.
		position_item = _position_house_item(
			data.get('display_lon', data.get('longitude', 0.0)),
			_house_text(data.get('house_index')),
			options,
		)
		smart_rows = [position_item['text']]
		if solar_condition_text:
			smart_rows.append(solar_condition_text)
		if out_of_bounds_text:
			smart_rows.append(out_of_bounds_text)
		decl = data.get('declination')
		if decl is not None:
			smart_rows.append('%s %s' % (_safe_text('Declination', 'Declination'), _format_signed_angle(decl)))
		# Ascensional Transits hover rows — populated by mundanechart when
		# the AT (or any other mundane biwheel) variant is active. Shows
		# both flanking quadrant angles: the one just passed (negative
		# eta) and the next one approaching (positive). The field is
		# absent on the round wheel, so this is a silent no-op for
		# non-mundane renderers.
		qa = data.get('quadrant_angles') or {}
		prev_qa, next_qa = qa.get('prev'), qa.get('next')
		if prev_qa and prev_qa.get('name') and prev_qa.get('eta_label'):
			smart_rows.append('%s %s' % (prev_qa['name'], prev_qa['eta_label']))
		if next_qa and next_qa.get('name') and next_qa.get('eta_label'):
			smart_rows.append('%s %s' % (next_qa['name'], next_qa['eta_label']))
		dignity_rows = []
		for item in dignity_items:
			if item.get('label'):
				# Mutual-reception items are structured glyph pairs and intentionally
				# have no scalar ``value``.  Do not leak Python's ``None`` into the
				# compatibility text rows (the React pane renders dignity_items).
				value = item.get('value', item.get('value_text'))
				dignity_rows.append('%s%s' % (
					item.get('label'),
					(': %s' % value) if value not in (None, '') else '',
				))
			else:
				dignity_rows.append(item.get('value'))
		phasis_row = None
		void_course_row = None
		if not is_luminary and not defer_signals:
			phase = _nearest_signal_text(chrt, planet_index) if chrt is not None else None
			# No nearby phasis/station signal means no row, not an em-dash row.
			if phase:
				phasis_row = '%s: %s' % (_safe_text('Phasis', 'Phasis'), phase)
				smart_rows.append(phasis_row)
		if planet_index == astrology.SE_MOON and chrt is not None:
			phase_row = _lunar_phase_text(chrt, options)
			if phase_row:
				smart_rows.append(phase_row)
			tithi_row = _lunar_tithi_text(chrt, options)
			if tithi_row:
				smart_rows.append(tithi_row)
			if not defer_signals:
				void_course_row = _void_course_text(chrt, options)
				if void_course_row:
					smart_rows.append(void_course_row)
			if bool(getattr(options, 'show_manzil_in_inspector', True)):
				mansion_info = _moon_mansion_info(chrt, options, lon)
		pd_direction_context = bool(data.get('pd_direction_context'))
		# Last/Next is the Moon's course; other planets show their in-orb aspects only.
		moon_course = (
			planet_index == astrology.SE_MOON and chrt is not None and not pd_direction_context
		)
		last_aspect, next_aspect = _moon_course_events(chrt, options) if moon_course else (None, None)
		detail_rows = []
		speed_lon = data.get('speed_lon')
		if speed_lon is not None:
			detail_rows.append('%s: %s' % (
				_safe_text('Speed', 'Speed'),
				_speculum_speed_text(planet_index, speed_lon, options, chrt),
			))
		station_items = [] if defer_signals else _planet_station_detail_items(
			chrt, planet_index, options,
		)
		station_rows = [item['text'] for item in station_items]
		detail_rows.extend(_solar_condition_detail_rows(solar_condition))
		ruler_items = _essential_dignity_detail_items(chrt, planet_index, lon=lon) if chrt is not None else []
		detail_rows.extend(item['text'] for item in ruler_items)
		if moon_course:
			detail_rows.append('%s: %s' % (_safe_text('Last aspect', 'Last aspect'), last_aspect))
			detail_rows.append('%s: %s' % (_safe_text('Next aspect', 'Next aspect'), next_aspect))
		# Last rows, so the step-time deferred slot (re-appended by the client)
		# never moves them.
		detail_rows.extend(station_rows)
		if pd_direction_context or chrt is None:
			aspect_rows, aspect_items = [], []
		elif planet_index == common.CHART_OBJECT_VERTEX:
			aspect_rows, aspect_items = _current_point_aspect_rows(
				chrt,
				lon,
				_planet_name(planet_index, options),
				options,
				partner_chart=partner_chart,
				current_role=current_role,
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
				point_glyph=_planet_glyph(planet_index),
			)
		else:
			aspect_rows, aspect_items = _current_aspect_rows(
				chrt,
				planet_index,
				options,
				partner_chart=partner_chart,
				current_role=current_role,
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			)
		motion_heading = _motion_heading(data)
		return {
			'glyph': _planet_glyph(planet_index),
			'title': _planet_name(planet_index, options),
			'motionGlyph': motion_heading.get('glyph', '') if motion_heading else '',
			'motionUsesSymbolFont': bool(motion_heading and motion_heading.get('uses_symbol_font')),
			'motionLabel': motion_heading.get('label', '') if motion_heading else '',
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'summary_items': [position_item],
			'dignity_rows': dignity_rows,
			'dignity_items': dignity_items,
			'detail_rows': detail_rows,
			'station_rows': station_rows,
			'station_items': station_items,
			'ruler_items': ruler_items,
			'aspect_rows': aspect_rows,
			'aspect_items': aspect_items,
			'manzil': mansion_info,
			'phasis_row': phasis_row,
			'void_course_row': void_course_row,
			'deferred_slots': (
				(['void-course'] if planet_index == astrology.SE_MOON else ['phasis', 'stations'] if not is_luminary else [])
				if defer_signals else []
			),
			'rows': smart_rows,
			'footer': '',
		}

	if kind == 'fortune':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		chrt = _chart_ref(data)
		point_label = _safe_text('Part of Fortune', 'Part of Fortune')
		position_item = _position_house_item(
			point_lon,
			_varga_house_text(chrt, point_lon, data.get('house_index'))
				if _is_varga_chart(chrt) else _house_text(data.get('house_index')),
			options,
		)
		smart_rows = [position_item['text']]
		decl = data.get('declination')
		if decl is not None:
			smart_rows.append('%s %s' % (_safe_text('Declination', 'Declination'), _format_signed_angle(decl)))
		aspect_rows, aspect_items = _current_point_aspect_rows(
			chrt,
			point_lon,
			point_label,
			options,
			partner_chart=data.get('partner_chart'),
			current_role=region.get('chart_role') or 'primary',
			current_ring_numeral=data.get('multiwheel_ring_numeral'),
			partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			point_glyph=common.common.fortune,
		) if (
			chrt is not None
			and not _is_varga_chart(chrt)
			and not bool(data.get('pd_direction_context'))
		) else ([], [])
		ruler_lon = None if _is_varga_chart(chrt) else point_lon
		trigon_item = _point_trigon_lords_item(chrt, options, ruler_lon)
		return {
			'glyph': common.common.fortune,
			'title': point_label,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'summary_items': [position_item],
			'dignity_items': [trigon_item] if trigon_item is not None else [],
			**_point_ruler_detail_fields(chrt, ruler_lon),
			'aspect_rows': aspect_rows,
			'aspect_items': aspect_items,
			'rows': smart_rows,
			'footer': '',
		}

	if kind == 'syzygy':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		chrt = _chart_ref(data)
		point_label = data.get('title') or _safe_text('Prenatal Syzygy', 'Prenatal Syzygy')
		position_item = _position_house_item(
			point_lon,
			_varga_house_text(chrt, point_lon, data.get('house_index'))
				if _is_varga_chart(chrt) else _house_text(data.get('house_index')),
			options,
		)
		smart_rows = [position_item['text']]
		aspect_rows, aspect_items = _current_point_aspect_rows(
			chrt,
			point_lon,
			point_label,
			options,
			partner_chart=data.get('partner_chart'),
			current_role=region.get('chart_role') or 'primary',
			current_ring_numeral=data.get('multiwheel_ring_numeral'),
			partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			point_short=_safe_text('Sy', 'Sy'),
		) if (
			chrt is not None
			and not _is_varga_chart(chrt)
			and not bool(data.get('pd_direction_context'))
		) else ([], [])
		ruler_lon = None if _is_varga_chart(chrt) else point_lon
		trigon_item = _point_trigon_lords_item(chrt, options, ruler_lon)
		return {
			'glyph': '',
			'title': point_label,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'summary_items': [position_item],
			'dignity_items': [trigon_item] if trigon_item is not None else [],
			**_point_ruler_detail_fields(chrt, ruler_lon),
			'aspect_rows': aspect_rows,
			'aspect_items': aspect_items,
			'rows': smart_rows,
			'footer': '',
		}

	if kind == 'eclipse':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		_, pos_text = _format_position(point_lon)
		chrt = _chart_ref(data)
		point_label = data.get('title') or _safe_text('Eclipses', 'Eclipses')
		house_text = (
			_varga_house_text(chrt, data.get('display_lon', data.get('longitude', 0.0)), data.get('house_index'))
			if _is_varga_chart(chrt) else _house_text(data.get('house_index'))
		)
		smart_rows = [
			pos_text,
			house_text,
			'%s: %s' % (_safe_text('Saros', 'Saros'), data.get('saros', '—')),
		]
		aspect_rows, aspect_items = _current_point_aspect_rows(
			chrt,
			point_lon,
			point_label,
			options,
			partner_chart=data.get('partner_chart'),
			current_role=region.get('chart_role') or 'primary',
			current_ring_numeral=data.get('multiwheel_ring_numeral'),
			partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			point_short=_safe_text('EclipseAbbr', 'Ec'),
		) if (
			chrt is not None
			and not _is_varga_chart(chrt)
			and not bool(data.get('pd_direction_context'))
		) else ([], [])
		ruler_lon = None if _is_varga_chart(chrt) else point_lon
		trigon_item = _point_trigon_lords_item(chrt, options, ruler_lon)
		return {
			'glyph': '',
			'title': point_label,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'dignity_items': [trigon_item] if trigon_item is not None else [],
			**_point_ruler_detail_fields(chrt, ruler_lon),
			'aspect_rows': aspect_rows,
			'aspect_items': aspect_items,
			'rows': smart_rows,
			'footer': '',
		}

	if kind == 'angle':
		angle_key = _normalise_angle_key(region.get('object_id'))
		chrt = _chart_ref(data)
		partner_chart = data.get('partner_chart')
		current_role = region.get('chart_role') or 'primary'
		sign_index, pos_text = _format_position(data.get('display_lon', data.get('longitude', 0.0)))
		angle_name_en = _ANGLE_LABELS.get(angle_key, 'Angle')
		angle_name = _safe_text(angle_name_en, angle_name_en)
		quality_row = '%s: %s' % (_safe_text('Quality', 'Quality'), _safe_text('Angular', 'Angular'))
		trigon_item = _trigon_lords_item(chrt, options, sign_index)
		dignity_items = [trigon_item] if trigon_item is not None else []
		smart_rows = [
			pos_text,
			_varga_house_text(chrt, data.get('display_lon', data.get('longitude', 0.0)), data.get('house_index'))
				if _is_varga_chart(chrt) else _house_text(data.get('house_index')),
		]
		if _is_varga_chart(chrt):
			smart_rows.append(quality_row)
			return {
				'glyph': '',
				'title': angle_name,
				'meta': role,
				'accent': accent,
				'accentRole': accent_role,
				'smart_rows': smart_rows,
				'dignity_rows': [],
				'dignity_items': dignity_items,
				'detail_rows': [],
				'aspect_rows': [],
				'aspect_items': [],
				'rows': smart_rows,
				'footer': '',
			}
		declination = data.get('declination')
		if declination is not None:
			smart_rows.append('%s %s' % (
				_safe_text('Declination', 'Declination'),
				_format_signed_angle(declination),
			))
		smart_rows.append(quality_row)
		pd_direction_context = bool(data.get('pd_direction_context'))
		ruler_items = _point_ruler_detail_items(chrt, data.get('display_lon', data.get('longitude')))
		ruler_rows = [item['text'] for item in ruler_items]
		if pd_direction_context:
			detail_rows = list(ruler_rows)
			aspect_rows, aspect_items = [], []
		else:
			last_aspect, next_aspect = (
				_nearest_angle_aspect_events(chrt, angle_key, options)
				if chrt is not None
				else ('—', '—')
			)
			detail_rows = list(ruler_rows) + [
				'%s: %s' % (_safe_text('Last aspect', 'Last aspect'), last_aspect),
				'%s: %s' % (_safe_text('Next aspect', 'Next aspect'), next_aspect),
			]
			aspect_rows, aspect_items = _current_angle_aspect_rows(
				chrt,
				angle_key,
				options,
				partner_chart=partner_chart,
				current_role=current_role,
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			) if chrt is not None else ([], [])
		return {
			'glyph': '',
			'title': angle_name,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'dignity_rows': [],
			'dignity_items': dignity_items,
			'detail_rows': detail_rows,
			'ruler_items': ruler_items,
			'aspect_rows': aspect_rows,
			'aspect_items': aspect_items,
			'rows': smart_rows,
			'footer': '',
		}

	if kind == 'house':
		sign_index, pos_text = _format_position(data.get('display_lon', data.get('longitude', 0.0)))
		quadrants = ('Angular', 'Succedent', 'Cadent', 'Angular', 'Succedent', 'Cadent', 'Angular', 'Succedent', 'Cadent', 'Angular', 'Succedent', 'Cadent')
		house_index = max(1, int(region.get('object_id', 1)))
		title = _house_text(house_index)
		quadrant_en = quadrants[(house_index - 1) % len(quadrants)]
		quality_row = '%s: %s' % (_safe_text('Quality', 'Quality'), _safe_text(quadrant_en, quadrant_en))
		smart_rows = [pos_text, quality_row]
		trigon_item = _trigon_lords_item(_chart_ref(data), options, sign_index)
		return {
			'glyph': '',
			'title': title,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'dignity_items': [trigon_item] if trigon_item is not None else [],
			**_point_ruler_detail_fields(
				None if _is_varga_chart(_chart_ref(data)) else _chart_ref(data),
				data.get('display_lon', data.get('longitude')),
			),
			'aspect_rows': [],
			'rows': list(smart_rows),
			'footer': '',
		}

	if kind == 'sign':
		sign_index = int(region.get('object_id', 0)) % chart.Chart.SIGN_NUM
		ruler_index = int(data.get('ruler_index', _SIGN_RULERS[sign_index]))
		element_en = _SIGN_ELEMENTS[sign_index]
		mode_en = _SIGN_MODALITIES[sign_index]
		sign_rows = [
			'%s: %s' % (_safe_text('Ruler', 'Ruler'), _planet_name(ruler_index, options)),
			'%s: %s' % (_safe_text('Element', 'Element'), _safe_text(element_en, element_en)),
			'%s: %s' % (_safe_text('Mode', 'Mode'), _safe_text(mode_en, mode_en)),
		]
		trigon_item = _trigon_lords_item(_chart_ref(data), options, sign_index)
		return {
			'glyph': _sign_glyph(sign_index, options),
			'title': _sign_name(sign_index),
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': list(sign_rows),
			'dignity_items': [trigon_item] if trigon_item is not None else [],
			'detail_rows': [],
			'aspect_rows': [],
			'rows': list(sign_rows),
			'footer': '',
		}

	if kind == 'aspect':
		aspect_type = int(data.get('aspect_type', region.get('object_id', chart.Chart.NONE)))
		actor = data.get('actor')
		target = data.get('target')
		actor_name = _aspect_body_label(actor, options)
		target_name = _aspect_body_label(target, options)
		state = _aspect_state_label(data)
		aspect_name = _aspect_text(aspect_type)
		orb_text = _format_orb_decimal(data.get('orb', 0.0))
		smart_rows = []
		if isinstance(actor, dict) and isinstance(target, dict):
			if state == 'exact':
				smart_rows.append(_safe_text('AspectExactSentence', '%s exact %s with %s') % (actor_name, aspect_name, target_name))
			elif state == 'applying':
				smart_rows.append(_safe_text('AspectApplyingSentence', '%s applying to %s by %s') % (actor_name, target_name, aspect_name))
			else:
				smart_rows.append(_safe_text('AspectSeparatingSentence', '%s separating from %s by %s') % (actor_name, target_name, aspect_name))
		orb_label = _safe_text('Orb', 'Orb')
		if state == 'exact':
			smart_rows.append('%s: %s (%s)' % (orb_label, orb_text, _safe_text('exact', 'exact')))
		else:
			smart_rows.append('%s: %s (%s)' % (orb_label, orb_text, _safe_text(state, state)))
		if data.get('contact_complete') is True:
			smart_rows.append(_safe_text('ContactComplete', "Mutual contact (each within the other's orb)"))
		elif data.get('contact_complete') is False:
			smart_rows.append(_safe_text('ContactIncomplete', "One-sided contact (one within the other's orb)"))
		return {
			'glyph': _aspect_glyph(aspect_type),
			'title': _aspect_title(aspect_type),
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'detail_rows': [],
			'aspect_rows': [],
			'rows': list(smart_rows),
			'footer': '',
		}

	if kind == 'drishti':
		actor, target = _drishti_party_text(data, options)
		method = _drishti_method_text(data.get('method'))
		smart_rows = [
			'%s: %s' % (_safe_text('From', 'From'), actor),
			'%s: %s' % (_safe_text('To', 'To'), target),
		]
		if data.get('ordinal') is not None:
			smart_rows.append('%s: %s' % (
				_safe_text('Drishti', 'Dṛṣṭi'),
				int(data['ordinal']),
			))
		return {
			'glyph': '',
			'title': method,
			'meta': role,
			'accent': accent,
			'accentRole': accent_role,
			'smart_rows': smart_rows,
			'detail_rows': [],
			'aspect_rows': [],
			'rows': list(smart_rows),
			'footer': '',
		}

	if kind == 'secondary_ring':
		return _build_secondary_ring_payload(region, options, role, accent)

	hover_hint = _safe_text('Hover a chart symbol', 'Hover a chart symbol')
	return {
		'glyph': '',
		'title': _safe_text('Inspector', 'Inspector'),
		'meta': role,
		'accent': accent,
		'accentRole': accent_role,
		'smart_rows': [hover_hint],
		'detail_rows': [],
		'aspect_rows': [],
		'rows': [hover_hint],
		'footer': '',
	}


def build_flag_payload(region, options, defer_signals=False):
	"""Compact on-chart hover payload used by the chart flag overlay."""
	return _without_empty_rows(_with_point_declination(
		_build_flag_payload(region, options, defer_signals), region, compact=True,
	))


def _build_flag_payload(region, options, defer_signals=False):
	if not region:
		return None
	data = region.get('data') or {}
	kind = region.get('kind')
	accent = tuple(data.get('colour') or ())
	if len(accent) != 3:
		accent = None
	payload = {
		'glyph': '',
		'title': '',
		'motionGlyph': '',
		'motionUsesSymbolFont': False,
		'motionLabel': '',
		'accent': accent,
		'accentRole': _flag_accent_colour_role(region, options, accent),
		'rows': [],
		'nextStationRow': None,
		'deferredSlots': [],
	}
	if kind == 'planet':
		planet_index = int(region.get('object_id', 0))
		chrt = _chart_ref(data)
		partner_chart = data.get('partner_chart')
		current_role = region.get('chart_role') or 'primary'
		lon = data.get('longitude', data.get('display_lon', 0.0))
		_, pos_text = _format_position(data.get('display_lon', lon))
		if _is_varga_chart(chrt):
			payload['glyph'] = _planet_glyph(planet_index)
			payload['title'] = _planet_name(planet_index, options)
			motion_heading = _motion_heading(data)
			if motion_heading:
				payload['motionGlyph'] = motion_heading['glyph']
				payload['motionUsesSymbolFont'] = motion_heading['uses_symbol_font']
				payload['motionLabel'] = motion_heading['label']
			payload['rows'] = [
				(_safe_text('Long', 'Long'), pos_text),
				(_safe_text('House', 'House'), str(_varga_house_number(chrt, lon) or '—')),
			]
			_append_next_station_flag(
				payload, data, chrt, planet_index, options, defer_signals,
			)
			return payload
		solar_condition = _solar_condition_result(chrt, planet_index, options)
		solar_condition_text = _solar_condition_value_text(
			solar_condition,
			include_mitigation=True,
		)
		out_of_bounds_text = _out_of_bounds_text(
			_out_of_bounds_result(chrt, planet_index),
		)
		dignity_items = _dignity_display_items(chrt, options, planet_index, lon=lon) if chrt is not None else []
		mutual_item = _mutual_reception_item(chrt, options, planet_index, lon=lon) if chrt is not None else None
		if mutual_item is not None:
			_append_before_triplicity_lords(dignity_items, mutual_item)
		payload['glyph'] = _planet_glyph(planet_index)
		payload['title'] = _planet_name(planet_index, options)
		motion_heading = _motion_heading(data)
		if motion_heading:
			payload['motionGlyph'] = motion_heading['glyph']
			payload['motionUsesSymbolFont'] = motion_heading['uses_symbol_font']
			payload['motionLabel'] = motion_heading['label']
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
		]
		if solar_condition_text:
			payload['rows'].append(('', solar_condition_text))
		if out_of_bounds_text:
			payload['rows'].append(('', out_of_bounds_text))
		# Flanking quadrant-angle ETAs (mundane/AT biwheels only — field
		# is absent on the round wheel). Two rows: the last angle the
		# planet passed (negative eta) and the next one approaching
		# (positive eta), each with the angle name as the row label so
		# they sit naturally above the dignity rows.
		qa = data.get('quadrant_angles') or {}
		prev_qa, next_qa = qa.get('prev'), qa.get('next')
		if prev_qa and prev_qa.get('name') and prev_qa.get('eta_label'):
			payload['rows'].append((prev_qa['name'], prev_qa['eta_label']))
		if next_qa and next_qa.get('name') and next_qa.get('eta_label'):
			payload['rows'].append((next_qa['name'], next_qa['eta_label']))
		pd_direction_context = bool(data.get('pd_direction_context'))
		if planet_index == astrology.SE_MOON and not pd_direction_context:
			payload['rows'].extend(_moon_traditional_witness_rows(
				chrt,
				options,
				partner_chart=partner_chart,
				current_role=current_role,
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			))
		if not pd_direction_context:
			if planet_index == common.CHART_OBJECT_VERTEX:
				payload['rows'].extend(_flag_point_aspect_rows(
					chrt,
					lon,
					_planet_name(planet_index, options),
					options,
					partner_chart=partner_chart,
					current_role=current_role,
					current_ring_numeral=data.get('multiwheel_ring_numeral'),
					partner_ring_numeral=data.get('multiwheel_partner_numeral'),
				))
			else:
				payload['rows'].extend(_flag_aspect_rows(
					chrt,
					planet_index,
					options,
					partner_chart=partner_chart,
					current_role=current_role,
					current_ring_numeral=data.get('multiwheel_ring_numeral'),
					partner_ring_numeral=data.get('multiwheel_partner_numeral'),
				))
		for index, item in enumerate(dignity_items):
			label = _safe_text('Dign', 'Dign') if index == 0 else ''
			if item.get('kind') == 'mutual_reception':
				spans = [
					{
						'text': item.get('left', ''),
						'colour': item.get('left_colour'),
						'colourRole': item.get('left_colour_role'),
						'glyph': True,
					},
					{'text': ' %s ' % item.get('arrow', '⇆')},
					{
						'text': item.get('right', ''),
						'colour': item.get('right_colour'),
						'colourRole': item.get('right_colour_role'),
						'glyph': True,
					},
				]
				payload['rows'].append((label, '', None, spans))
			elif item.get('kind') == 'triplicity_lords':
				spans = []
				for lord_index, lord in enumerate(item.get('lords') or []):
					if lord_index:
						spans.append({'text': '  '})
					spans.append({
						'text': lord.get('glyph', ''),
						'colour': lord.get('colour'),
						'colourRole': lord.get('colour_role'),
						'glyph': True,
					})
				payload['rows'].append((item.get('flag_label') or item.get('label') or label, '', None, spans))
			else:
				payload['rows'].append((
					label,
					item.get('value') or '—',
					item.get('colour'),
					None,
					item.get('colour_role'),
				))
		if planet_index == astrology.SE_MOON and chrt is not None:
			if defer_signals:
				payload['deferredSlots'].append('void-course')
			else:
				void_course_text = _void_course_text(chrt, options)
				if void_course_text:
					payload['voidCourseRow'] = ('', void_course_text)
					payload['rows'].append(payload['voidCourseRow'])
			try:
				info = lunar.phase(chrt)
				payload['rows'].append(('', '%s (%s)' % (
					_format_arc_dm(info.delta_lambda),
					lunar._localize_phase_name(info.name),
				)))
			except Exception:
				pass
		# Last row, so the step-time deferred slot (re-appended by the client)
		# never moves it.
		_append_next_station_flag(
			payload, data, chrt, planet_index, options, defer_signals,
		)
		return payload
	if kind == 'fortune':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		_, pos_text = _format_position(point_lon)
		point_label = _safe_text('Fortune', 'Fortune')
		payload['glyph'] = common.common.fortune
		payload['title'] = point_label
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
		]
		decl = data.get('declination')
		if decl is not None:
			payload['rows'].append((_safe_text('Declination', 'Declination'), _format_signed_angle(decl)))
		_append_point_trigon_flag_row(payload, _chart_ref(data), options, point_lon)
		if not bool(data.get('pd_direction_context')):
			payload['rows'].extend(_flag_point_aspect_rows(
				_chart_ref(data), point_lon, point_label, options,
				partner_chart=data.get('partner_chart'),
				current_role=region.get('chart_role') or 'primary',
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			))
		return payload
	if kind == 'syzygy':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		_, pos_text = _format_position(point_lon)
		point_label = data.get('title') or _safe_text('Prenatal Syzygy', 'Prenatal Syzygy')
		payload['title'] = point_label
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
		]
		_append_point_trigon_flag_row(payload, _chart_ref(data), options, point_lon)
		if not bool(data.get('pd_direction_context')):
			payload['rows'].extend(_flag_point_aspect_rows(
				_chart_ref(data), point_lon, point_label, options,
				partner_chart=data.get('partner_chart'),
				current_role=region.get('chart_role') or 'primary',
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			))
		return payload
	if kind == 'eclipse':
		point_lon = data.get('display_lon', data.get('longitude', 0.0))
		_, pos_text = _format_position(point_lon)
		point_label = data.get('title') or _safe_text('Eclipses', 'Eclipses')
		payload['title'] = point_label
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
			(_safe_text('House', 'House'), _house_text(data.get('house_index'))),
			(_safe_text('Saros', 'Saros'), data.get('saros', '—')),
		]
		_append_point_trigon_flag_row(payload, _chart_ref(data), options, point_lon)
		if not bool(data.get('pd_direction_context')):
			payload['rows'].extend(_flag_point_aspect_rows(
				_chart_ref(data), point_lon, point_label, options,
				partner_chart=data.get('partner_chart'),
				current_role=region.get('chart_role') or 'primary',
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			))
		return payload
	if kind == 'angle':
		angle_key = _normalise_angle_key(region.get('object_id'))
		chrt = _chart_ref(data)
		partner_chart = data.get('partner_chart')
		current_role = region.get('chart_role') or 'primary'
		sign_index, pos_text = _format_position(data.get('display_lon', data.get('longitude', 0.0)))
		angle_name_en = _ANGLE_LABELS.get(angle_key, 'Angle')
		payload['title'] = _safe_text(angle_name_en, angle_name_en)
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
			(_safe_text('Quality', 'Quality'), _safe_text('Angular', 'Angular')),
		]
		trigon_item = _trigon_lords_item(chrt, options, sign_index)
		if trigon_item is not None:
			payload['rows'].append((trigon_item['flag_label'], '', None, _triplicity_lord_spans(trigon_item)))
		if not bool(data.get('pd_direction_context')):
			payload['rows'].extend(_flag_angle_aspect_rows(
				chrt,
				angle_key,
				options,
				partner_chart=partner_chart,
				current_role=current_role,
				current_ring_numeral=data.get('multiwheel_ring_numeral'),
				partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			))
		return payload
	if kind == 'house':
		sign_index, pos_text = _format_position(data.get('display_lon', data.get('longitude', 0.0)))
		house_index = max(1, int(region.get('object_id', 1)))
		payload['glyph'] = ''
		payload['title'] = _house_text(house_index)
		payload['rows'] = [
			(_safe_text('Long', 'Long'), pos_text),
		]
		trigon_item = _trigon_lords_item(_chart_ref(data), options, sign_index)
		if trigon_item is not None:
			payload['rows'].append((trigon_item['flag_label'], '', None, _triplicity_lord_spans(trigon_item)))
		return payload
	if kind == 'sign':
		sign_index = int(region.get('object_id', 0)) % chart.Chart.SIGN_NUM
		ruler_index = int(data.get('ruler_index', _SIGN_RULERS[sign_index]))
		element_en = _SIGN_ELEMENTS[sign_index]
		mode_en = _SIGN_MODALITIES[sign_index]
		payload['glyph'] = _sign_glyph(sign_index, options)
		payload['title'] = _SIGN_NAMES[sign_index]
		payload['rows'] = [
			(_safe_text('Ruler', 'Ruler'), _planet_name(ruler_index, options)),
			(_safe_text('Element', 'Element'), _safe_text(element_en, element_en)),
			(_safe_text('Mode', 'Mode'), _safe_text(mode_en, mode_en)),
		]
		trigon_item = _trigon_lords_item(_chart_ref(data), options, sign_index)
		if trigon_item is not None:
			payload['rows'].append((trigon_item['flag_label'], '', None, _triplicity_lord_spans(trigon_item)))
		return payload
	if kind == 'aspect':
		aspect_type = int(data.get('aspect_type', region.get('object_id', chart.Chart.NONE)))
		glyph, font_role = common.common.aspect_glyph(aspect_type)
		# Inspector hover card renders glyph in the Morinus face unconditionally
		# (see workspace_shell.py:1060). For text-face aspects (only septile
		# today), suppress the glyph and rely on the title — drawing 'S' in the
		# Morinus font would show the trine triangle instead.
		payload['glyph'] = glyph if font_role == 'morinus' else ''
		# Flag always shows the orb number with app./sep. — never the word "exact"
		# (the inspector keeps the "exact" wording).
		orb_text = _format_orb_decimal(data.get('orb', 0.0))
		motion_short = _safe_text('AbbrApplying', 'app.') if bool(data.get('applying')) else _safe_text('AbbrSeparating', 'sep.')
		payload['title'] = '%s (%s %s)' % (_aspect_title(aspect_type), orb_text, motion_short)
		actor = data.get('actor')
		target = data.get('target')
		rows = []
		if isinstance(actor, dict) and isinstance(target, dict):
			rows.append((_safe_text('From', 'From'), _aspect_body_label(actor, options)))
			rows.append((_safe_text('To', 'To'), _aspect_body_label(target, options)))
		if data.get('contact_complete') is True:
			rows.append((_safe_text('Contact', 'Contact'), _safe_text('ContactCompleteShort', 'Mutual')))
		elif data.get('contact_complete') is False:
			rows.append((_safe_text('Contact', 'Contact'), _safe_text('ContactIncompleteShort', 'One-sided')))
		payload['rows'] = rows
		payload['compact'] = True
		return payload
	if kind == 'declination':
		# Chart dashboard: a body's parallels / contraparallels in orb.
		planet_index = int(region.get('object_id', 0))
		payload['glyph'] = _planet_glyph(planet_index)
		payload['title'] = _planet_name(planet_index, options)
		rows = []
		declination = data.get('declination')
		if declination is not None:
			rows.append((_safe_text('Declination', 'Declination'), _format_signed_angle(declination)))
		for contact in data.get('contacts') or []:
			label = 'Contraparallel' if contact.get('kind') == 'contraparallel' else 'Parallel'
			rows.append((
				_safe_text(label, label),
				'%s %s' % (_planet_name(int(contact['partner']), options), _format_orb(contact.get('orb', 0.0))),
			))
		if not data.get('contacts') and not data.get('pair'):
			rows.append((_safe_text('Parallel', 'Parallel'), '—'))
		payload['rows'] = rows
		payload['compact'] = True
		return payload
	if kind == 'drishti':
		actor, target = _drishti_party_text(data, options)
		payload['title'] = _drishti_method_text(data.get('method'))
		payload['rows'] = [
			(_safe_text('From', 'From'), actor),
			(_safe_text('To', 'To'), target),
		]
		if data.get('ordinal') is not None:
			payload['rows'].append((
				_safe_text('Drishti', 'Dṛṣṭi'),
				str(int(data['ordinal'])),
			))
		payload['compact'] = True
		return payload
	if kind == 'secondary_ring':
		display_lon = data.get('display_lon', data.get('longitude'))
		long_label = _safe_text('Long', 'Long')
		rows = [(long_label, '—')]
		if data.get('glyph_font') == 'morinus':
			payload['glyph'] = data.get('glyph') or ''
		if display_lon is not None:
			_, pos_text = _format_position(display_lon)
			rows[0] = (long_label, pos_text)
		if data.get('family') == 'fixed_star':
			nature_info = data.get('fixstar_nature') or {}
			nature = nature_info.get('nature') if isinstance(nature_info, dict) else None
			payload['title'] = data.get('fixstar_display_name') or data.get('fixstar_name') or _safe_text('Fixed star', 'Fixed star')
			if nature:
				rows.append((_safe_text('Nature', 'Nature'), nature))
			elif isinstance(nature_info, dict) and nature_info.get('note'):
				rows.append((_safe_text('Nature', 'Nature'), '—'))
			facts = data.get('fixstar_conjunctions') or {}
			contacts = facts.get('contacts') or []
			if contacts:
				spans = [{'text': payload['title']}]
				for index, contact in enumerate(contacts):
					name, glyph, short_label = _fixed_star_contact_identity(contact, options)
					spans.append({'text': ' · ' if index else ' '})
					spans.extend([
						{'text': _aspect_glyph(chart.Chart.CONJUNCTIO), 'glyph': True, 'colourRole': _aspect_colour_role(chart.Chart.CONJUNCTIO), 'wrapGroup': index},
						{'text': ' ', 'wrapGroup': index},
						{'text': glyph or short_label or name, 'glyph': bool(glyph), 'wrapGroup': index},
						{'text': ' ' + _format_orb(contact['separation']), 'wrapGroup': index},
					])
				payload['titleSpans'] = spans
				contact_rows, _ = _fixed_star_conjunction_rows(data, options)
				payload['titleLabel'] = ' · '.join([payload['title'], *contact_rows])
			payload['rows'] = rows
			return payload
		if data.get('family') == 'asteroid':
			payload['title'] = data.get('title') or _safe_text('Asteroid', 'Asteroid')
			motion_heading = _motion_heading(data)
			if motion_heading:
				payload['motionGlyph'] = motion_heading['glyph']
				payload['motionUsesSymbolFont'] = motion_heading['uses_symbol_font']
				payload['motionLabel'] = motion_heading['label']
			payload['rows'] = [rows[0]]
			payload['rows'].extend(_flag_rows_from_aspect_items(
				_current_ephemeris_body_aspect_rows(
					_chart_ref(data),
					data.get('body_id'),
					data.get('longitude'),
					data.get('speed_lon'),
					payload['title'],
					options,
					partner_chart=data.get('partner_chart'),
					current_role=region.get('chart_role') or 'primary',
					current_ring_numeral=data.get('multiwheel_ring_numeral'),
					partner_ring_numeral=data.get('multiwheel_partner_numeral'),
					declination=data.get('declination'),
				)[1],
				limit=2,
			))
			return payload
		if data.get('family') == 'surveil':
			source = data.get('source_name') or '—'
			study = data.get('study_name') or _safe_text('Study', 'Study')
			payload['glyph'] = data.get('glyph') if data.get('glyph_font') == 'morinus' else ''
			payload['title'] = data.get('title') or _safe_text('Surveil point', 'Surveil point')
			payload['rows'] = [(long_label, rows[0][1]), (_safe_text('Source', 'Source'), source), (_safe_text('Study', 'Study'), study)]
			return payload
		payload['title'] = data.get('title') or _safe_text('Ring item', 'Ring item')
		payload['rows'] = rows
		return payload
	return None


def _fixed_star_contact_identity(contact, options):
	"""Aspect List's body glyphs and compact structural-point labels."""
	kind, object_id = contact['kind'], contact['object_id']
	if kind == 'planet':
		return _planet_name(object_id, options), _planet_glyph(object_id), ''
	if kind == 'angle':
		key = _ANGLE_LABELS[_normalise_angle_key(object_id)]
		short_key = {'asc': 'Asc', 'dsc': 'Dsc', 'mc': 'MC', 'ic': 'IC'}[object_id]
		return _safe_text(key, key), '', _safe_text(short_key, short_key)
	if kind == 'house':
		import mtexts
		key = 'HC%d' % object_id
		return '%s %s' % (_safe_text('House', 'House'), object_id), '', _safe_text(key, mtexts.txtseng[key])
	if kind == 'vertex':
		return _safe_text('Vertex', 'Vertex'), common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX), ''
	if kind == 'syzygy':
		return _safe_text('PrenatalSyzygy', 'Syzygy'), '', 'Sy'
	if kind == 'eclipse':
		return _safe_text('PrenatalEclipse', 'Prenatal eclipse'), '', _safe_text('EclipseAbbr', 'Ec')
	return _safe_text('LotOfFortune', 'Lot of Fortune'), common.common.fortune, ''


def _fixed_star_conjunction_rows(data, options, *, header=False):
	"""Format daemon-owned star contacts for both existing Inspector surfaces."""
	rows, items = [], []
	for contact in (data.get('fixstar_conjunctions') or {}).get('contacts', ()):
		name, _, _ = _fixed_star_contact_identity(contact, options)
		separation = _format_orb(contact['separation'])
		suffix = '%s %s' % (name, separation) if header else separation
		text = '%s %s %s' % (name, _aspect_title(chart.Chart.CONJUNCTIO), separation)
		rows.append(text)
		items.append({
			'prefix_text': '' if header else name + ' ',
			'aspect_glyph': _aspect_glyph(chart.Chart.CONJUNCTIO),
			'suffix_text': suffix,
			'aspect_colour_role': _aspect_colour_role(chart.Chart.CONJUNCTIO),
			'full_text': text,
		})
	return rows, items


def _build_secondary_ring_payload(region, options, role, accent):
	data = region.get('data') or {}
	family = data.get('family') or 'secondary_ring'
	title = data.get('title') or _safe_text('Secondary ring', 'Secondary ring')
	display_lon = data.get('display_lon', data.get('longitude'))
	meta_bits = [role, _safe_text('Secondary ring', 'Secondary ring')]
	meta = ' • '.join([bit for bit in meta_bits if bit])
	rows = []
	if display_lon is not None:
		_, pos_text = _format_position(display_lon)
		rows.append(pos_text)
	if family == 'fixed_star':
		title = data.get('fixstar_name') or title
		meta = ' • '.join([bit for bit in [role, _safe_text('Fixed star', 'Fixed star')] if bit])
		constellation = data.get('fixstar_constellation') or {}
		if constellation.get('name'):
			name = constellation['name']
			if constellation.get('english_name'):
				name += ' (%s)' % constellation['english_name']
			rows.append('%s: %s' % (_safe_text('Constellation', 'Constellation'), name))
		nature_info = data.get('fixstar_nature') or {}
		nature = nature_info.get('nature') if isinstance(nature_info, dict) else None
		if nature:
			rows.append('%s: %s' % (_safe_text('Nature', 'Nature'), nature))
		elif isinstance(nature_info, dict) and nature_info.get('note'):
			rows.append(nature_info.get('note'))
	elif family == 'asteroid':
		rows.append(_safe_text('Asteroid', 'Asteroid'))
		rows.append(_motion_text(data))
	elif family == 'lot':
		rows.append(_safe_text('Lot', 'Lot'))
		formula_text = data.get('formula')
		if formula_text:
			rows.append('%s: %s' % (_safe_text('Formula', 'Formula'), formula_text))
	elif family == 'midpoint':
		rows.append(_safe_text('Midpoint', 'Midpoint'))
	elif family == 'dodecatemoria':
		rows.append(_safe_text('Dodecatemoria', 'Dodecatemoria'))
	elif family == 'antiscia':
		rows.append(_safe_text('Antiscia', 'Antiscia'))
	elif family == 'contra_antiscia':
		rows.append(_safe_text('Contraantiscia', 'Contraantiscia'))
	elif family == 'surveil':
		rows.append(_safe_text('Surveil point', 'Surveil point'))
		source = data.get('source_name')
		if source:
			rows.append('%s: %s' % (_safe_text('Source', 'Source'), source))
		study = data.get('study_name')
		if study:
			rows.append('%s: %s' % (_safe_text('Study', 'Study'), study))
	else:
		rows.append(_safe_text('Ring item', 'Ring item'))
	detail_rows = []
	if family == 'fixed_star':
		code = data.get('fixstar_code')
		if code:
			detail_rows.append('%s: %s' % (_safe_text('Code', 'Code'), code))
		nature_info = data.get('fixstar_nature') or {}
		if isinstance(nature_info, dict):
			sources = nature_info.get('sources') or []
			variants = nature_info.get('variants') or []
			note = nature_info.get('note') or ''
			if sources:
				detail_rows.append('%s: %s' % (_safe_text('NatureSource', 'Nature source'), '; '.join(sources)))
			if variants:
				detail_rows.append('%s: %s' % (_safe_text('Variant', 'Variant'), '; '.join(variants)))
			if note and note not in rows:
				detail_rows.append('%s: %s' % (_safe_text('Note', 'Note'), note))
	aspect_rows = []
	aspect_items = []
	header_aspect_items = []
	if family == 'fixed_star':
		facts = data.get('fixstar_conjunctions') or {}
		if facts.get('orb_limit') is not None:
			rows.append('%s: %s' % (_safe_text('FixedStarConjunctionOrb', 'Orb'), _format_orb(facts['orb_limit'])))
		_, header_aspect_items = _fixed_star_conjunction_rows(data, options, header=True)
	if family == 'asteroid' and data.get('body_id') is not None:
		aspect_rows, aspect_items = _current_ephemeris_body_aspect_rows(
			_chart_ref(data),
			data.get('body_id'),
			data.get('longitude'),
			data.get('speed_lon'),
			title,
			options,
			partner_chart=data.get('partner_chart'),
			current_role=region.get('chart_role') or 'primary',
			current_ring_numeral=data.get('multiwheel_ring_numeral'),
			partner_ring_numeral=data.get('multiwheel_partner_numeral'),
			declination=data.get('declination'),
		)
	return {
		'glyph': data.get('glyph') if data.get('glyph_font') == 'morinus' else '',
		'title': title,
		'meta': meta,
		'accent': accent,
		'accentRole': _flag_accent_colour_role(region, options, accent),
		'smart_rows': rows,
		'detail_rows': detail_rows,
		'aspect_rows': aspect_rows,
		'aspect_items': aspect_items,
		'header_aspect_items': header_aspect_items,
		'rows': rows,
		'footer': '',
	}
