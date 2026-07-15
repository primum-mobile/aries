# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import math
import os

import astrology
import chart
import chartfile
import common
import houses
import mtexts
import planets
import radixsignals
import searchcatalog
import util

import chartcollectionsearchquery


OBJECT_FAMILY_PART = 'family:part'

# Filter catalogs are user-facing and must follow the active mtexts language.
# mtexts.txts/mtexts.signs are rebound by mtexts.setLang AFTER this module is
# imported, so the labels are resolved at SERVE time (call time), never frozen
# at import. Consumers still read the ``OBJECT_CHOICES`` / ``SIGN_CHOICES`` /
# ``ASPECT_CHOICES`` / ``ASPECT_LABELS`` / ``SIGN_LABELS`` attributes; module
# ``__getattr__`` (below) rebuilds them fresh on every access.
#
# Object ids (``planet:sun`` …) are stable logic keys and stay English/verbatim.


def _object_choices():
	return (
		('', mtexts.txts.get('FilterAny', 'Any')),
		('planet:sun', mtexts.txts.get('Sun', 'Sun')),
		('planet:moon', mtexts.txts.get('Moon', 'Moon')),
		('planet:mercury', mtexts.txts.get('Mercury', 'Mercury')),
		('planet:venus', mtexts.txts.get('Venus', 'Venus')),
		('planet:mars', mtexts.txts.get('Mars', 'Mars')),
		('planet:jupiter', mtexts.txts.get('Jupiter', 'Jupiter')),
		('planet:saturn', mtexts.txts.get('Saturn', 'Saturn')),
		('planet:uranus', mtexts.txts.get('Uranus', 'Uranus')),
		('planet:neptune', mtexts.txts.get('Neptune', 'Neptune')),
		('planet:pluto', mtexts.txts.get('Pluto', 'Pluto')),
		('planet:chiron', mtexts.txts.get('Chiron', 'Chiron')),
		('planet:asc_node', mtexts.txts.get('AscNode', 'North Node')),
		('planet:desc_node', mtexts.txts.get('DescNode', 'South Node')),
		('angle:asc', mtexts.txts.get('Asc', 'Asc')),
		('angle:mc', mtexts.txts.get('MC', 'MC')),
		('point:lof', mtexts.txts.get('LoF', 'LoF')),
		(OBJECT_FAMILY_PART, mtexts.txts.get('AnyArabicPart', 'Any Arabic Part')),
	)


def _sign_choices():
	return tuple((idx, label) for idx, label in enumerate(mtexts.signs))


def _aspect_choices():
	return (
		(chartcollectionsearchquery.AspectClause.COPRESENCE, mtexts.txts.get('Copresence', 'Copresence')),
		(chart.Chart.CONJUNCTIO, mtexts.txts.get('Conjunctio', 'Conjunction')),
		(chart.Chart.SEXTIL, mtexts.txts.get('Sextil', 'Sextile')),
		(chart.Chart.QUADRAT, mtexts.txts.get('Quadrat', 'Square')),
		(chart.Chart.TRIGON, mtexts.txts.get('Trigon', 'Trine')),
		(chart.Chart.QUINQUNX, mtexts.txts.get('Quinqunx', 'Quincunx')),
		(chart.Chart.OPPOSITIO, mtexts.txts.get('Oppositio', 'Opposition')),
	)


def _aspect_label(aspect_type):
	"""Serve-time aspect label for a match string (English fallback ``Aspect``)."""
	return dict(_aspect_choices()).get(aspect_type, mtexts.txts.get('Aspect', 'Aspect'))


def __getattr__(name):
	# PEP 562 lazy module attributes: rebuild the localized catalogs on every
	# access so daemon payloads pick up the active language.
	if name == 'OBJECT_CHOICES':
		return _object_choices()
	if name == 'SIGN_CHOICES':
		return _sign_choices()
	if name == 'ASPECT_CHOICES':
		return _aspect_choices()
	if name == 'ASPECT_LABELS':
		return dict(_aspect_choices())
	if name == 'SIGN_LABELS':
		return dict(_sign_choices())
	raise AttributeError('module %r has no attribute %r' % (__name__, name))


class ChartCollectionSearchResult(object):
	def __init__(self, chart_info, path, record_index, matches):
		record = chart_info.get('record') or {}
		self.chart_info = chart_info
		self.path = path
		self.record_index = record_index
		self.name = chart_info.get('name') or record.get('name', '')
		self.date = chart_info.get('date') or record.get('date', '')
		self.time = chart_info.get('time') or record.get('time', '')
		self.type = chart_info.get('type') or record.get('type', '')
		self.collection = chart_info.get('collection') or _collection_name(path)
		self.place = chart_info.get('place') or record.get('place', '')
		self.matches = matches

	def matches_text(self):
		return '; '.join(self.matches)


class ChartCollectionSearchSummary(object):
	def __init__(self, scanned=0, matched=0, errors=0, truncated=False):
		self.scanned = scanned
		self.matched = matched
		self.errors = errors
		self.truncated = truncated


def search_chart_infos(chart_infos, options, query, should_cancel=None, limit=1000):
	active_placements = query.active_placement_clauses()
	active_aspects = query.active_aspect_clauses()
	if not active_placements and not active_aspects:
		return [], ChartCollectionSearchSummary()

	results = []
	summary = ChartCollectionSearchSummary()
	compiled = _CompiledCollectionQuery(active_placements, active_aspects)

	for chart_info in list(chart_infos or []):
		if should_cancel is not None and should_cancel():
			break
		path, record_index = _path_and_index(chart_info)
		record = chart_info.get('record')
		if path is None or record_index is None:
			continue
		try:
			if record is None:
				records = chartfile.read_jsonl(path)
				record = records[record_index]
			summary.scanned += 1
			if compiled.fast_path:
				matches = _match_chart_fast(record, options, active_placements, active_aspects, query)
			else:
				matches = _match_chart_full(record, options, active_placements, active_aspects, query)
			if matches is None:
				continue
			results.append(ChartCollectionSearchResult(chart_info, path, record_index, matches))
			if limit is not None and len(results) >= int(limit):
				summary.truncated = True
				break
		except Exception:
			summary.errors += 1

	summary.matched = len(results)
	return results, summary


class _CompiledCollectionQuery(object):
	def __init__(self, placement_clauses, aspect_clauses):
		self.fast_path = self._can_use_fast_path(placement_clauses, aspect_clauses)

	def _can_use_fast_path(self, placement_clauses, aspect_clauses):
		# Predicate pushdown: only use the selective SwissEph path when every
		# referenced object can be computed without materializing a full Chart.
		for clause in placement_clauses:
			if not clause.object_ids:
				return False
			if not _object_ids_fast_supported(clause.object_ids):
				return False
		for clause in aspect_clauses:
			if not clause.object_a_ids or not clause.object_b_ids:
				return False
			if not _object_ids_fast_supported(clause.object_a_ids):
				return False
			if not _object_ids_fast_supported(clause.object_b_ids):
				return False
		return True


class _FastObject(object):
	def __init__(self, oid, label, family, longitude, planet_index=None, speed_lon=None):
		self.id = oid
		self.label = label
		self.family = family
		self.longitude = longitude
		self.planet_index = planet_index
		self.speed_lon = speed_lon


class _FastChartContext(object):
	def __init__(self, record, options):
		common.ensure_swe_ready()
		self.record = record
		self.options = options
		self.place = _record_place(record)
		self.time = _record_time(record, self.place)
		self.jd = float(self.time.jd)
		astrology.swe_set_topo(self.place.lon, self.place.lat, self.place.altitude)
		self.pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
		self.ayanamsha = 0.0
		if getattr(self.options, 'ayanamsha', 0) != 0:
			astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(self.options.ayanamsha), 0, 0)
			self.ayanamsha = astrology.swe_get_ayanamsa_ut(self.jd)
		if getattr(self.options, 'topocentric', False):
			self.pflag |= astrology.SEFLG_TOPOCTR
		self._planet_states = {}
		self._houses = None
		self._obl = None
		self._sun_planet = None

	def planet_object(self, object_id):
		spec = _FAST_PLANET_OBJECTS.get(object_id)
		if spec is None:
			return None
		key, english, planet_id = spec
		label = mtexts.txts.get(key, english)
		lon, speed = self.planet_state(object_id)
		return _FastObject(object_id, label, searchcatalog.SearchObject.FAMILY_PLANET, lon, planet_index=planet_id, speed_lon=speed)

	def point_object(self, object_id):
		if object_id in _FAST_PLANET_OBJECTS:
			return self.planet_object(object_id)
		if object_id == 'angle:asc':
			return _FastObject(object_id, mtexts.txts.get('Asc', 'Asc'), searchcatalog.SearchObject.FAMILY_ANGLE, self.houses.ascmc[houses.Houses.ASC])
		if object_id == 'angle:mc':
			return _FastObject(object_id, mtexts.txts.get('MC', 'MC'), searchcatalog.SearchObject.FAMILY_ANGLE, self.houses.ascmc[houses.Houses.MC])
		if object_id == 'point:lof':
			return _FastObject(object_id, mtexts.txts.get('LoF', 'LoF'), searchcatalog.SearchObject.FAMILY_FORTUNE, self.fortune_longitude())
		return None

	def planet_state(self, object_id):
		if object_id in self._planet_states:
			return self._planet_states[object_id]
		if object_id == 'planet:desc_node':
			lon, speed = self.planet_state('planet:asc_node')
			state = (util.normalize(lon + 180.0), speed)
			self._planet_states[object_id] = state
			return state
		spec = _FAST_PLANET_OBJECTS.get(object_id)
		if spec is None:
			raise KeyError(object_id)
		_key, _english, planet_id = spec
		swe_id = planet_id
		if object_id == 'planet:asc_node':
			swe_id = astrology.SE_MEAN_NODE if getattr(self.options, 'meannode', False) else astrology.SE_TRUE_NODE
		_err, data = astrology.swe_calc_ut(self.jd, swe_id, self.pflag)
		state = (util.normalize(data[planets.Planet.LONG]), float(data[planets.Planet.SPLON]))
		self._planet_states[object_id] = state
		return state

	@property
	def obl(self):
		if self._obl is None:
			delta_t = astrology.swe_deltat(self.jd)
			_err, obl = astrology.swe_calc(self.jd + delta_t, astrology.SE_ECL_NUT, 0)
			self._obl = float(obl[0])
		return self._obl

	@property
	def houses(self):
		if self._houses is None:
			self._houses = houses.Houses(
				self.jd,
				0,
				self.place.lat,
				self.place.lon,
				self.options.hsys,
				self.obl,
				self.options.ayanamsha,
				self.ayanamsha,
			)
		return self._houses

	def fortune_longitude(self):
		sun_lon, _sun_speed = self.planet_state('planet:sun')
		moon_lon, _moon_speed = self.planet_state('planet:moon')
		asc_lon = self.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		abovehorizon = self.sun_above_horizon()
		if self.options.lotoffortune == chart.Chart.LFMOONSUN:
			diff = moon_lon - sun_lon
		elif self.options.lotoffortune == chart.Chart.LFDSUNMOON:
			diff = sun_lon - moon_lon if abovehorizon else moon_lon - sun_lon
		elif self.options.lotoffortune == chart.Chart.LFDMOONSUN:
			diff = moon_lon - sun_lon if abovehorizon else sun_lon - moon_lon
		else:
			diff = moon_lon - sun_lon
		return util.normalize(asc_lon + util.normalize(diff))

	def sun_above_horizon(self):
		if self._sun_planet is not None:
			return bool(self._sun_planet.abovehorizon)
		try:
			raequasc, _declequasc, _dist = astrology.swe_cotrans(
				self.houses.ascmc[houses.Houses.EQUASC],
				0.0,
				1.0,
				-self.obl,
			)
			self._sun_planet = planets.Planet(
				self.jd,
				astrology.SE_SUN,
				self.pflag,
				self.place.lat,
				self.houses.ascmc2,
				raequasc,
				None,
				None,
				False,
				self.obl,
			)
			return bool(self._sun_planet.abovehorizon)
		except Exception:
			return True

	def display_longitude(self, longitude):
		if longitude is None:
			return None
		lon = util.normalize(float(longitude))
		if getattr(self.options, 'ayanamsha', 0) != 0:
			lon = util.normalize(lon - self.ayanamsha)
		return lon


# (mtexts_key, english_fallback, swe_planet_id). The label is resolved through
# mtexts at SERVE time in planet_object()/planet_state(), not frozen at import.
_FAST_PLANET_OBJECTS = {
	'planet:sun': ('Sun', 'Sun', astrology.SE_SUN),
	'planet:moon': ('Moon', 'Moon', astrology.SE_MOON),
	'planet:mercury': ('Mercury', 'Mercury', astrology.SE_MERCURY),
	'planet:venus': ('Venus', 'Venus', astrology.SE_VENUS),
	'planet:mars': ('Mars', 'Mars', astrology.SE_MARS),
	'planet:jupiter': ('Jupiter', 'Jupiter', astrology.SE_JUPITER),
	'planet:saturn': ('Saturn', 'Saturn', astrology.SE_SATURN),
	'planet:uranus': ('Uranus', 'Uranus', astrology.SE_URANUS),
	'planet:neptune': ('Neptune', 'Neptune', astrology.SE_NEPTUNE),
	'planet:pluto': ('Pluto', 'Pluto', astrology.SE_PLUTO),
	'planet:chiron': ('Chiron', 'Chiron', astrology.SE_CHIRON),
	'planet:asc_node': ('AscNode', 'North Node', astrology.SE_PLUTO + 1),
	'planet:desc_node': ('DescNode', 'South Node', astrology.SE_PLUTO + 2),
}

_FAST_POINT_IDS = set(_FAST_PLANET_OBJECTS)
_FAST_POINT_IDS.update(('angle:asc', 'angle:mc', 'point:lof'))


def _object_ids_fast_supported(object_ids):
	for object_id in object_ids:
		if object_id == OBJECT_FAMILY_PART:
			return False
		if object_id not in _FAST_POINT_IDS:
			return False
	return True


def _match_chart_fast(record, options, placement_clauses, aspect_clauses, query):
	ctx = _FastChartContext(record, options)
	matches = []
	for clause in placement_clauses:
		match = _match_placement_clause_fast(ctx, clause, query)
		if match is None:
			return None
		matches.append(match)

	for clause in aspect_clauses:
		match = _match_aspect_clause_fast(ctx, clause)
		if match is None:
			return None
		matches.append(match)

	return matches


def _match_chart_full(record, options, placement_clauses, aspect_clauses, query):
	chrt = chartfile.dict_to_chart(record, options)
	catalog = searchcatalog.SearchCatalog(chrt)
	return _match_chart(chrt, catalog, placement_clauses, aspect_clauses, query)


def _match_placement_clause_fast(ctx, clause, query):
	for obj in _fast_objects_for_ids(ctx, clause.object_ids):
		detail = _placement_detail_fast(ctx, obj, clause, query)
		if detail is not None:
			return detail
	return None


def _placement_detail_fast(ctx, obj, clause, query):
	lon = _object_longitude(obj)
	display_lon = ctx.display_longitude(lon)

	if clause.sign_indices:
		if display_lon is None:
			return None
		sign = int(display_lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
		if sign not in clause.sign_indices:
			return None

	if clause.degree is not None:
		if display_lon is None:
			return None
		deg_in_sign = display_lon % chart.Chart.SIGN_DEG
		orb = clause.degree_orb if clause.degree_orb is not None else 0.0
		if _degree_delta(deg_in_sign, clause.degree) > max(0.0, float(orb)):
			return None

	if clause.house_numbers:
		house = _object_house_fast(ctx, obj)
		if house not in clause.house_numbers:
			return None

	if clause.motion:
		if not _matches_motion_fast(ctx, obj, clause.motion, query.station_window_days):
			return None

	parts = [obj.label]
	if display_lon is not None:
		parts.append(_format_compact_longitude(display_lon))
	if clause.house_numbers:
		house = _object_house_fast(ctx, obj)
		if house is not None:
			parts.append('H%d' % house)
	if clause.motion:
		parts.append(_motion_label(clause.motion))
	return ' '.join(parts)


def _match_aspect_clause_fast(ctx, clause):
	a_objects = _fast_objects_for_ids(ctx, clause.object_a_ids)
	b_objects = _fast_objects_for_ids(ctx, clause.object_b_ids)
	orb = max(0.0, float(clause.orb))
	best = None
	copresence = _is_copresence_aspect(clause)

	for obj_a in a_objects:
		lon_a = _object_longitude(obj_a)
		if lon_a is None:
			continue
		sign_a = _display_sign(ctx.display_longitude(lon_a)) if copresence else None
		for obj_b in b_objects:
			if obj_a.id == obj_b.id:
				continue
			lon_b = _object_longitude(obj_b)
			if lon_b is None:
				continue
			if copresence:
				sign_b = _display_sign(ctx.display_longitude(lon_b))
				if sign_a is not None and sign_a == sign_b:
					candidate = (0.0, obj_a, obj_b, sign_a)
					if best is None or candidate[0] < best[0]:
						best = candidate
				continue
			delta = abs(_aspect_distance(lon_a, lon_b) - chart.Chart.Aspects[clause.aspect_type])
			if delta <= orb:
				candidate = (delta, obj_a, obj_b, None)
				if best is None or candidate[0] < best[0]:
					best = candidate

	if best is None:
		return None
	delta, obj_a, obj_b, sign = best
	if copresence:
		return _format_copresence_match(obj_a, obj_b, sign)
	return '%s %s %s (%s)' % (
		obj_a.label,
		_aspect_label(clause.aspect_type).lower(),
		obj_b.label,
		_format_orb(delta),
	)


def _fast_objects_for_ids(ctx, object_ids):
	objects = []
	for object_id in object_ids:
		obj = ctx.point_object(object_id)
		if obj is not None:
			objects.append(obj)
	return objects


def _object_house_fast(ctx, obj):
	lon = _object_longitude(obj)
	if lon is None:
		return None
	try:
		return int(ctx.houses.getHousePos(lon, ctx.options, False)) + 1
	except Exception:
		return None


def _matches_motion_fast(ctx, obj, motion, station_window_days):
	if obj.planet_index is None or obj.speed_lon is None:
		return False
	speed = float(obj.speed_lon)
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_DIRECT:
		return speed > 0.0
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_RETROGRADE:
		return speed < 0.0
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_DIRECT:
		return radixsignals.get_station_marker_for_jd(
			ctx.jd,
			_fast_station_planet_id(obj),
			within_days=float(station_window_days),
			options=ctx.options,
			include_extended_stations=True,
		) == 'SD'
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_RETROGRADE:
		return radixsignals.get_station_marker_for_jd(
			ctx.jd,
			_fast_station_planet_id(obj),
			within_days=float(station_window_days),
			options=ctx.options,
			include_extended_stations=True,
		) == 'SR'
	return True


def _fast_station_planet_id(obj):
	if obj.id in ('planet:asc_node', 'planet:desc_node'):
		return astrology.SE_TRUE_NODE
	return obj.planet_index


def _match_chart(chrt, catalog, placement_clauses, aspect_clauses, query):
	matches = []
	for clause in placement_clauses:
		match = _match_placement_clause(chrt, catalog, clause, query)
		if match is None:
			return None
		matches.append(match)

	for clause in aspect_clauses:
		match = _match_aspect_clause(chrt, catalog, clause)
		if match is None:
			return None
		matches.append(match)

	return matches


def _match_placement_clause(chrt, catalog, clause, query):
	for obj in _objects_for_ids(catalog, clause.object_ids):
		detail = _placement_detail(chrt, obj, clause, query)
		if detail is not None:
			return detail
	return None


def _placement_detail(chrt, obj, clause, query):
	lon = _object_longitude(obj)
	display_lon = _display_longitude(chrt, lon)

	if clause.sign_indices:
		if display_lon is None:
			return None
		sign = int(display_lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
		if sign not in clause.sign_indices:
			return None

	if clause.degree is not None:
		if display_lon is None:
			return None
		deg_in_sign = display_lon % chart.Chart.SIGN_DEG
		orb = clause.degree_orb if clause.degree_orb is not None else 0.0
		if _degree_delta(deg_in_sign, clause.degree) > max(0.0, float(orb)):
			return None

	if clause.house_numbers:
		house = _object_house(chrt, obj)
		if house not in clause.house_numbers:
			return None

	if clause.motion:
		if not _matches_motion(chrt, obj, clause.motion, query.station_window_days):
			return None

	parts = [obj.label]
	if display_lon is not None:
		parts.append(_format_compact_longitude(display_lon))
	if clause.house_numbers:
		house = _object_house(chrt, obj)
		if house is not None:
			parts.append('H%d' % house)
	if clause.motion:
		parts.append(_motion_label(clause.motion))
	return ' '.join(parts)


def _match_aspect_clause(chrt, catalog, clause):
	a_objects = _objects_for_ids(catalog, clause.object_a_ids)
	b_objects = _objects_for_ids(catalog, clause.object_b_ids)
	orb = max(0.0, float(clause.orb))
	best = None
	copresence = _is_copresence_aspect(clause)

	for obj_a in a_objects:
		lon_a = _object_longitude(obj_a)
		if lon_a is None:
			continue
		sign_a = _display_sign(_display_longitude(chrt, lon_a)) if copresence else None
		for obj_b in b_objects:
			if obj_a.id == obj_b.id:
				continue
			if not clause.object_a_ids and not clause.object_b_ids and obj_a.id > obj_b.id:
				continue
			lon_b = _object_longitude(obj_b)
			if lon_b is None:
				continue
			if copresence:
				sign_b = _display_sign(_display_longitude(chrt, lon_b))
				if sign_a is not None and sign_a == sign_b:
					candidate = (0.0, obj_a, obj_b, sign_a)
					if best is None or candidate[0] < best[0]:
						best = candidate
				continue
			delta = abs(_aspect_distance(lon_a, lon_b) - chart.Chart.Aspects[clause.aspect_type])
			if delta <= orb:
				candidate = (delta, obj_a, obj_b, None)
				if best is None or candidate[0] < best[0]:
					best = candidate

	if best is None:
		return None

	delta, obj_a, obj_b, sign = best
	if copresence:
		return _format_copresence_match(obj_a, obj_b, sign)
	return '%s %s %s (%s)' % (
		obj_a.label,
		_aspect_label(clause.aspect_type).lower(),
		obj_b.label,
		_format_orb(delta),
	)


def _objects_for_ids(catalog, object_ids):
	objects = []
	if not object_ids:
		return list(catalog.objects)
	for object_id in object_ids:
		if object_id == OBJECT_FAMILY_PART:
			objects.extend([obj for obj in catalog.objects if obj.family == searchcatalog.SearchObject.FAMILY_PART])
			continue
		obj = catalog.get(object_id)
		if obj is not None:
			objects.append(obj)
	return objects


def _object_longitude(obj):
	try:
		return util.normalize(float(obj.longitude))
	except Exception:
		return None


def _display_longitude(chrt, longitude):
	if longitude is None:
		return None
	lon = util.normalize(float(longitude))
	if getattr(chrt.options, 'ayanamsha', 0) != 0:
		lon = util.normalize(lon - float(getattr(chrt, 'ayanamsha', 0.0)))
	return lon


def _display_sign(display_longitude):
	if display_longitude is None:
		return None
	return int(util.normalize(float(display_longitude)) / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM


def _is_copresence_aspect(clause):
	return clause.aspect_type == chartcollectionsearchquery.AspectClause.COPRESENCE


def _format_copresence_match(obj_a, obj_b, sign):
	if sign is None:
		sign_label = ''
	else:
		sign_label = ' (%s)' % searchcatalog.SIGNS[sign]
	return '%s %s %s%s' % (obj_a.label, mtexts.txts.get('CopresentWith', 'copresent with'), obj_b.label, sign_label)


def _format_compact_longitude(display_longitude):
	lon = util.normalize(float(display_longitude))
	sign = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
	deg, minute, second = util.decToDeg(lon - sign * chart.Chart.SIGN_DEG)
	return '%02d%s%02d %s' % (deg, chr(176), minute, searchcatalog.SIGNS[sign])


def _object_house(chrt, obj):
	lon = _object_longitude(obj)
	if lon is None:
		return None
	try:
		return int(chrt.houses.getHousePos(lon, chrt.options, False)) + 1
	except Exception:
		return None


def _matches_motion(chrt, obj, motion, station_window_days):
	if obj.planet_index is None:
		return False
	body = common.get_chart_planet(chrt, obj.planet_index)
	if body is None:
		return False
	try:
		speed = float(body.data[planets.Planet.SPLON])
	except Exception:
		return False

	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_DIRECT:
		return speed > 0.0
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_RETROGRADE:
		return speed < 0.0

	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_DIRECT:
		return _station_marker(chrt, obj.planet_index, station_window_days) == 'SD'
	if motion == chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_RETROGRADE:
		return _station_marker(chrt, obj.planet_index, station_window_days) == 'SR'

	return True


def _station_marker(chrt, planet_index, station_window_days):
	return radixsignals.get_station_marker(
		chrt,
		planet_index,
		within_days=float(station_window_days),
		options=getattr(chrt, 'options', None),
		include_extended_stations=True,
	)


def _motion_label(motion):
	# Serve-time labels for the match descriptor (English fallbacks preserve the
	# prior inline wording). ``motion`` values are stable logic ids, not display.
	labels = {
		chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_DIRECT: mtexts.txts.get('MotionDirect', 'direct'),
		chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_RETROGRADE: mtexts.txts.get('MotionRetrograde', 'retrograde'),
		chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_DIRECT: mtexts.txts.get('MotionStationDirect', 'station direct'),
		chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_RETROGRADE: mtexts.txts.get('MotionStationRetrograde', 'station retrograde'),
	}
	return labels.get(motion, motion)


def _degree_delta(a, b):
	return abs(((float(a) - float(b) + 15.0) % 30.0) - 15.0)


def _aspect_distance(lon1, lon2):
	dif = abs(float(lon1) - float(lon2))
	if dif > 180.0:
		dif = 360.0 - dif
	return dif


def _format_orb(delta):
	degrees = int(math.floor(float(delta)))
	minutes = int(round((float(delta) - degrees) * 60.0))
	if minutes >= 60:
		degrees += 1
		minutes = 0
	return '%s %d%s%02d' % (mtexts.txts.get('OrbLabel', 'orb'), degrees, chr(176), minutes)


def _path_and_index(chart_info):
	path_info = chart_info.get('path')
	if isinstance(path_info, tuple) and len(path_info) >= 2:
		return path_info[0], path_info[1]
	return None, None


def _collection_name(path):
	if not path:
		return ''
	return os.path.splitext(os.path.basename(path))[0]


def _record_place(record):
	lon = float(record.get('lon', 0.0))
	lat = float(record.get('lat', 0.0))
	deglon, minlon, seclon = _decimal_to_dms(lon)
	deglat, minlat, seclat = _decimal_to_dms(lat)
	return chart.Place(
		record.get('place', ''),
		deglon,
		minlon,
		seclon,
		lon >= 0.0,
		deglat,
		minlat,
		seclat,
		lat >= 0.0,
		float(record.get('alt', 0.0)),
	)


def _record_time(record, place):
	date_str = record.get('date', '1900-01-01')
	if date_str.startswith('-'):
		bc = True
		date_str = date_str[1:]
	else:
		bc = bool(record.get('bc', False))
	parts = date_str.split('-')
	year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
	tparts = record.get('time', '00:00:00').split(':')
	hour = int(tparts[0])
	minute = int(tparts[1]) if len(tparts) > 1 else 0
	second = int(tparts[2]) if len(tparts) > 2 else 0
	cal = chart.Time.JULIAN if record.get('cal', 'gregorian') == 'julian' else chart.Time.GREGORIAN
	zt = {
		'zone': chart.Time.ZONE,
		'greenwich': chart.Time.GREENWICH,
		'lmt': chart.Time.LOCALMEAN,
		'lat': chart.Time.LOCALAPPARENT,
	}.get(record.get('zt', 'zone'), chart.Time.ZONE)
	plus, total_min = _parse_tz(record.get('tz', 'Z'))
	dst = bool(record.get('dst', False))
	if dst:
		total_min = max(0, total_min - 60)
	return chart.Time(
		year,
		month,
		day,
		hour,
		minute,
		second,
		bc,
		cal,
		zt,
		plus,
		total_min // 60,
		total_min % 60,
		dst,
		place,
		full=False,
		tzid=record.get('tzid', ''),
		tzauto=bool(record.get('tzauto', False)),
	)


def _parse_tz(tz_str):
	if tz_str == 'Z' or not tz_str:
		return True, 0
	sign = 1 if tz_str[0] == '+' else -1
	body = tz_str[1:]
	if ':' in body:
		hours, minutes = body.split(':', 1)
	else:
		hours = body[:2]
		minutes = body[2:4] if len(body) >= 4 else '0'
	total = int(hours) * 60 + int(minutes)
	return sign > 0, total


def _decimal_to_dms(decimal_deg):
	total = abs(float(decimal_deg))
	deg = int(total)
	remainder = (total - deg) * 60.0
	minutes = int(remainder)
	seconds = round((remainder - minutes) * 60.0, 2)
	if seconds >= 60.0:
		seconds = 0.0
		minutes += 1
	if minutes >= 60:
		minutes = 0
		deg += 1
	return int(deg), int(minutes), float(seconds)
