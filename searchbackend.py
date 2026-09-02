# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import copy
import datetime
import math
import os
import time

import astrology
import eclipses
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import api as transit_fast_api
import campanianpd
import chart
import common
from engine import cheby_progressions
from engine import cheby_transits
from engine import converse_transits
from engine import prog_log
import fortune
import houses
import mtexts
import planets
import placidiansapd
import placidianutppd
import phasiscalc
import posfordate
import primdirs
import profections
import radixsignals
import regiomontanpd
import searchcatalog
import searchquery
import symbolic_time
import topocentricpd
import transits
import util


ASPECT_DEFS = (
	(searchquery.SearchQuery.ASPECT_CONJUNCTION, chart.Chart.CONJUNCTIO, False, mtexts.txts['Conjunctio']),
	(searchquery.SearchQuery.ASPECT_SEXTILE, chart.Chart.SEXTIL, True, mtexts.txts['Sextil']),
	(searchquery.SearchQuery.ASPECT_SQUARE, chart.Chart.QUADRAT, True, mtexts.txts['Quadrat']),
	(searchquery.SearchQuery.ASPECT_TRINE, chart.Chart.TRIGON, True, mtexts.txts['Trigon']),
	(searchquery.SearchQuery.ASPECT_QUINCUNX, chart.Chart.QUINQUNX, True, mtexts.txts['Quinqunx']),
	(searchquery.SearchQuery.ASPECT_OPPOSITION, chart.Chart.OPPOSITIO, False, mtexts.txts['Oppositio']),
	(searchquery.SearchQuery.ASPECT_SEMISEXTILE, chart.Chart.SEMISEXTIL, True, mtexts.txts['Semisextil']),
	(searchquery.SearchQuery.ASPECT_SEMISQUARE, chart.Chart.SEMIQUADRAT, True, mtexts.txts['Semiquadrat']),
	(searchquery.SearchQuery.ASPECT_QUINTILE, chart.Chart.QUINTILE, True, mtexts.txts['Quintile']),
	(searchquery.SearchQuery.ASPECT_SESQUISQUARE, chart.Chart.SESQUIQUADRAT, True, mtexts.txts['Sesquiquadrat']),
	(searchquery.SearchQuery.ASPECT_BIQUINTILE, chart.Chart.BIQUINTILE, True, mtexts.txts['Biquintile']),
	(searchquery.SearchQuery.ASPECT_SEPTILE, chart.Chart.SEPTILE, True, mtexts.txts['Septile']),
)

ASPECT_INDEX_BY_ID = dict((aspect_id, chart_idx) for aspect_id, chart_idx, both_sides, label in ASPECT_DEFS)
ASPECT_ID_BY_INDEX = dict((chart_idx, aspect_id) for aspect_id, chart_idx, both_sides, label in ASPECT_DEFS)


class _AspectLabelMap(object):
	"""Serve-time i18n map: aspect id -> localized label.

	Exposes the same ``.get``/``[]``/``in`` interface as the plain dict it
	replaced, but every lookup resolves through ``mtexts.txts`` at call time so
	the active language applies. Aspect labels are served per search row
	(``search_service`` ``aspectLabel``) and in clipboard/ICS exports, so they
	must be resolved when the payload is assembled, not frozen at import.
	"""

	def __init__(self, entries):
		self._entries = dict(entries)

	def get(self, aspect_id, default=None):
		entry = self._entries.get(aspect_id)
		if entry is None:
			return default
		key, english = entry
		return mtexts.txts.get(key, english)

	def __getitem__(self, aspect_id):
		key, english = self._entries[aspect_id]
		return mtexts.txts.get(key, english)

	def __contains__(self, aspect_id):
		return aspect_id in self._entries


# aspect id -> (mtexts key, English fallback). Resolved at serve time.
ASPECT_LABEL_BY_ID = _AspectLabelMap({
	searchquery.SearchQuery.ASPECT_CONJUNCTION: ('Conjunctio', 'Conjunction'),
	searchquery.SearchQuery.ASPECT_SEMISEXTILE: ('Semisextil', 'Semisextile'),
	searchquery.SearchQuery.ASPECT_SEMISQUARE: ('Semiquadrat', 'Semisquare'),
	searchquery.SearchQuery.ASPECT_SEXTILE: ('Sextil', 'Sextile'),
	searchquery.SearchQuery.ASPECT_QUINTILE: ('Quintile', 'Quintile'),
	searchquery.SearchQuery.ASPECT_SQUARE: ('Quadrat', 'Square'),
	searchquery.SearchQuery.ASPECT_TRINE: ('Trigon', 'Trine'),
	searchquery.SearchQuery.ASPECT_SESQUISQUARE: ('Sesquiquadrat', 'Sesquisquare'),
	searchquery.SearchQuery.ASPECT_BIQUINTILE: ('Biquintile', 'Biquintile'),
	searchquery.SearchQuery.ASPECT_QUINCUNX: ('Quinqunx', 'Quinqunx'),
	searchquery.SearchQuery.ASPECT_OPPOSITION: ('Oppositio', 'Opposition'),
	searchquery.SearchQuery.ASPECT_SEPTILE: ('Septile', 'Septile'),
	searchquery.SearchQuery.ASPECT_SIGN_CHANGE: ('Ingress', 'Ingress'),
	searchquery.SearchQuery.ASPECT_CAZIMI: ('Cazimi', 'Cazimi'),
	searchquery.SearchQuery.ASPECT_STATION_RETROGRADE: ('StationRetrograde', 'Station (Rx)'),
	searchquery.SearchQuery.ASPECT_STATION_DIRECT: ('StationDirect', 'Station (D)'),
	searchquery.SearchQuery.ASPECT_STATION: ('Station', 'Station'),
	searchquery.SearchQuery.ASPECT_HELIACAL_MORNING_FIRST: ('MorningRise', 'Morning rise'),
	searchquery.SearchQuery.ASPECT_HELIACAL_MORNING_LAST: ('MorningSet', 'Morning set'),
	searchquery.SearchQuery.ASPECT_HELIACAL_EVENING_FIRST: ('EveningRise', 'Evening rise'),
	searchquery.SearchQuery.ASPECT_HELIACAL_EVENING_LAST: ('EveningSet', 'Evening set'),
})
PRIMARY_SUPPORTED_FAMILIES = (
	searchcatalog.SearchObject.FAMILY_PLANET,
	searchcatalog.SearchObject.FAMILY_NODE,
	searchcatalog.SearchObject.FAMILY_ANGLE,
	searchcatalog.SearchObject.FAMILY_FORTUNE,
	searchcatalog.SearchObject.FAMILY_SYZYGY,
	searchcatalog.SearchObject.FAMILY_ECLIPSE,
)
TRADITIONAL_SIGN_DIFFS = {
	searchquery.SearchQuery.ASPECT_CONJUNCTION: 0,
	searchquery.SearchQuery.ASPECT_SEXTILE: 2,
	searchquery.SearchQuery.ASPECT_SQUARE: 3,
	searchquery.SearchQuery.ASPECT_TRINE: 4,
	searchquery.SearchQuery.ASPECT_OPPOSITION: 6,
}
EXACT_EPSILON = 0.0001
WEATHER_EVENT_EPSILON = 0.003
# Match the chart glyph contract: SR/SD wins within one day of the exact root.
DISPLAY_STATION_WINDOW_DAYS = 1.0
STATION_DEDUPE_WINDOW_DAYS = 1.0
RX_MOTION_MARKERS = frozenset(('R', 'SR', 'SD'))
RESULT_DEDUPE_WINDOW_DAYS = 2.0 / 86400.0
PROGRESS_WINDOW_DAYS = 14.0
CURSOR_DIRECTIONS = ('around', 'previous', 'next')
CURSOR_TECHNIQUES = (
	searchquery.SearchQuery.TECHNIQUE_TRANSITS,
	searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS,
	searchquery.SearchQuery.TECHNIQUE_PROFECTIONS,
	searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
	searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS,
	searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
	searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES,
	searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
	searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
)
CURSOR_MAX_WINDOW_MONTHS = 12
CURSOR_MAX_SEED_DAYS = 31
CURSOR_CHUNK_RESULT_LIMIT = 5000
CURSOR_PROGRESS_INTERVAL_SECONDS = 0.016
SECONDARY_STATION_ASPECT_BY_CODE = {
	'SR': searchquery.SearchQuery.ASPECT_STATION_RETROGRADE,
	'SD': searchquery.SearchQuery.ASPECT_STATION_DIRECT,
}
HELIACAL_ASPECT_BY_CODE = {
	'MF': searchquery.SearchQuery.ASPECT_HELIACAL_MORNING_FIRST,
	'ML': searchquery.SearchQuery.ASPECT_HELIACAL_MORNING_LAST,
	'EF': searchquery.SearchQuery.ASPECT_HELIACAL_EVENING_FIRST,
	'EL': searchquery.SearchQuery.ASPECT_HELIACAL_EVENING_LAST,
}
DIGNITY_LABELS = {
	0: 'Dom',
	1: 'Exa',
	2: 'Per',
	3: 'Cas',
	4: 'Exi',
}


class _SearchRuntime(object):
	def __init__(self):
		self._ephemeris_contexts = {}
		self._live_states = {}
		self._live_longitudes = {}
		self._live_vectors = {}
		self._chart_cache = {}
		self._chart_catalog_cache = {}
		self._secondary_catalog_cache = {}
		self._secondary_event_tuple_cache = {}
		self._secondary_snapshot_cache = {}
		self._primary_search_contexts = {}


	def ephemeris_context(self, chrt):
		key = id(chrt)
		context = self._ephemeris_contexts.get(key)
		if context is None:
			context = _planet_ephemeris_context(chrt)
			self._ephemeris_contexts[key] = context
		return context


	def planet_flags(self, chrt):
		context = self.ephemeris_context(chrt)
		context.apply()
		return context.flags


	def live_object_longitude(self, obj, chrt, event_jd):
		state = self.live_object_state(obj, chrt, event_jd)
		if state is None:
			return None
		return state[0]


	def live_object_state(self, obj, chrt, event_jd):
		if obj is None:
			return None
		context = self.ephemeris_context(chrt)
		key = (id(chrt), obj.id, round(float(event_jd), 9), context.flags)
		if key not in self._live_states:
			self._live_states[key] = _live_object_state_uncached(
				obj,
				chrt,
				event_jd,
				context.flags,
				context=context,
			)
		return self._live_states[key]


	def live_planet_longitudes(self, catalog, chrt, body_ids, event_jd):
		state = {}
		for oid in body_ids:
			obj = catalog.get(oid)
			if obj is None or obj.planet_index is None:
				continue
			state[oid] = self.live_object_longitude(obj, chrt, event_jd)
		return state


	def live_planet_longitude_vector(self, catalog, chrt, body_ids, event_jd):
		key = (id(chrt), tuple(body_ids), round(float(event_jd), 9), self.planet_flags(chrt))
		if key not in self._live_vectors:
			self._live_vectors[key] = tuple(self.live_object_longitude(catalog.get(oid), chrt, event_jd) for oid in body_ids)
		return self._live_vectors[key]


	def chart_for_event(self, kind, radix, event_tuple):
		key = (kind, id(radix), tuple(event_tuple))
		if key not in self._chart_cache:
			if kind == 'transit':
				self._chart_cache[key] = build_transit_chart_for_datetime(radix, event_tuple)
			elif kind == 'secondary':
				self._chart_cache[key] = build_secondary_chart_for_datetime(radix, event_tuple)
			elif kind == 'profection':
				self._chart_cache[key] = build_profection_chart_for_datetime(radix, event_tuple)
			else:
				self._chart_cache[key] = None
		return self._chart_cache[key]


	def catalog_for_chart(self, chart_obj, radix_catalog=None):
		if chart_obj is None:
			return radix_catalog
		key = id(chart_obj)
		if key not in self._chart_catalog_cache:
			self._chart_catalog_cache[key] = searchcatalog.SearchCatalog(chart_obj)
		return self._chart_catalog_cache[key]


	def secondary_catalog_for_jd(self, radix, event_jd):
		event_tuple = _jd_to_datetime_tuple(event_jd, _calendar_flag(radix))
		key = (id(radix), tuple(event_tuple))
		if key not in self._secondary_catalog_cache:
			secondary_chart = self.chart_for_event('secondary', radix, event_tuple)
			self._secondary_catalog_cache[key] = searchcatalog.SearchCatalog(secondary_chart) if secondary_chart is not None else searchcatalog.SearchCatalog(radix)
		return self._secondary_catalog_cache[key]


	def secondary_catalog_for_symbolic_age(self, radix, symbolic_age):
		key = (id(radix), round(float(symbolic_age), 9))
		if key not in self._secondary_catalog_cache:
			secondary_chart = build_secondary_chart_for_symbolic_age(radix, symbolic_age)
			self._secondary_catalog_cache[key] = searchcatalog.SearchCatalog(secondary_chart) if secondary_chart is not None else searchcatalog.SearchCatalog(radix)
		return self._secondary_catalog_cache[key]


	def secondary_event_tuple(self, radix, event_jd):
		key = (id(radix), round(float(event_jd), 9))
		if key not in self._secondary_event_tuple_cache:
			self._secondary_event_tuple_cache[key] = _secondary_event_tuple_for_jd(radix, event_jd)
		return self._secondary_event_tuple_cache[key]


	def secondary_snapshot_for_jd(self, radix_catalog, radix, event_jd, object_ids):
		event_tuple = _jd_to_datetime_tuple(event_jd, _calendar_flag(radix))
		key = (id(radix), tuple(object_ids), tuple(event_tuple))
		if key not in self._secondary_snapshot_cache:
			self._secondary_snapshot_cache[key] = _snapshot_catalog_subset(
				radix_catalog,
				self.secondary_catalog_for_jd(radix, event_jd),
				object_ids,
			)
		return self._secondary_snapshot_cache[key]


	def secondary_snapshot_for_symbolic_age(self, radix_catalog, radix, symbolic_age, object_ids):
		key = (id(radix), tuple(object_ids), round(float(symbolic_age), 9))
		if key not in self._secondary_snapshot_cache:
			self._secondary_snapshot_cache[key] = _snapshot_catalog_subset(
				radix_catalog,
				self.secondary_catalog_for_symbolic_age(radix, symbolic_age),
				object_ids,
			)
		return self._secondary_snapshot_cache[key]


class _SnapshotCatalog(object):
	def __init__(self, objects_by_id):
		self.objects_by_id = objects_by_id


	def get(self, oid):
		return self.objects_by_id.get(oid)


class _CompiledQuery(object):
	def __init__(self, catalog, query):
		self.static_targets = _build_static_targets(catalog, query)
		self.secondary_promittor_ids = _unique_in_order([prom_id for prom_id, sig_id, aspect_id, target_lon in self.static_targets])
		self.secondary_batch_promittor_ids = _compile_secondary_batch_promittor_ids(catalog, query)
		self.secondary_batch_promittors_by_index = _compile_transit_promittors_by_index(catalog, self.secondary_batch_promittor_ids)
		self.weather_pairs, self.weather_body_ids = _weather_pairs(catalog, query)
		self.weather_specs = _compile_weather_specs(self.weather_pairs, self.weather_body_ids, query.aspects)
		self.transit_batch_promittor_ids = _compile_transit_batch_promittor_ids(catalog, query)


def search(catalog, chrt, query, start_date, end_date, limit):
	final_rows = []
	final_truncated = False
	for _phase, rows, truncated in search_progress(catalog, chrt, query, start_date, end_date, limit):
		final_rows = rows
		final_truncated = truncated
	return final_rows, final_truncated


def search_progress(catalog, chrt, query, start_date, end_date, limit):
	"""Yield cumulative SearchResult rows during each search phase.

	The final yielded rows are byte-for-byte the same rows returned by search().
	Consumers such as the web daemon can surface early rows without duplicating
	any astrology/search logic outside this module.
	"""
	start_jd = _date_to_jd(start_date, chrt)
	end_jd = _date_to_jd(end_date + datetime.timedelta(days=1), chrt)
	runtime = _SearchRuntime()
	compiled = _CompiledQuery(catalog, query)
	secondary_scan_limit = None
	if (
		len(query.techniques) == 1
		and query.techniques[0] == searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS
		and limit is not None
	):
		secondary_scan_limit = int(limit) + 50

	raw_rows = []

	if searchquery.SearchQuery.TECHNIQUE_TRANSITS in query.techniques:
		for window_start_jd, window_end_jd in _iter_progress_jd_windows(start_jd, end_jd):
			raw_rows.extend(_search_transits(catalog, chrt, query, window_start_jd, window_end_jd, runtime, compiled))
			yield (
				searchquery.SearchQuery.TECHNIQUE_TRANSITS,
				*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
			)

	if searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS in query.techniques:
		for window_start_jd, window_end_jd in _iter_progress_jd_windows(start_jd, end_jd):
			raw_rows.extend(_search_converse_transits(catalog, chrt, query, window_start_jd, window_end_jd, runtime, compiled))
			yield (
				searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS,
				*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
			)

	if searchquery.SearchQuery.TECHNIQUE_PROFECTIONS in query.techniques:
		raw_rows.extend(_search_profections(catalog, chrt, query, start_jd, end_jd))
		yield (
			searchquery.SearchQuery.TECHNIQUE_PROFECTIONS,
			*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
		)

	if searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS in query.techniques:
		raw_rows.extend(_search_secondary_directions(catalog, chrt, query, start_jd, end_jd, runtime, compiled, max_rows=secondary_scan_limit))
		yield (
			searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
			*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
		)

	if searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS in query.techniques:
		raw_rows.extend(_search_primary_directions(catalog, chrt, query, start_jd, end_jd, runtime))
		yield (
			searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS,
			*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
		)

	if searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER in query.techniques:
		raw_rows.extend(_search_mundane_weather(catalog, chrt, query, start_jd, end_jd, runtime, compiled))
		yield (
			searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
			*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
		)

	if searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES in query.techniques:
		raw_rows.extend(_search_heliacal_phases(catalog, chrt, query.promittor_ids, start_jd, end_jd, runtime))
		yield (
			searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES,
			*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
		)

	if searchquery.SearchQuery.TECHNIQUE_LUNATIONS in query.techniques:
		for window_start_jd, window_end_jd in _iter_progress_jd_windows(start_jd, end_jd, window_days=62.0):
			raw_rows.extend(_search_lunations(catalog, chrt, query, window_start_jd, window_end_jd, runtime, eclipses_only=False))
			yield (
				searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
				*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
			)

	if searchquery.SearchQuery.TECHNIQUE_ECLIPSES in query.techniques:
		for window_start_jd, window_end_jd in _iter_progress_jd_windows(start_jd, end_jd, window_days=62.0):
			raw_rows.extend(_search_lunations(catalog, chrt, query, window_start_jd, window_end_jd, runtime, eclipses_only=True))
			yield (
				searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
				*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
			)

	sign_change_technique = _sign_change_technique(query)
	if sign_change_technique is not None:
		for window_start_jd, window_end_jd in _iter_progress_jd_windows(start_jd, end_jd):
			raw_rows.extend(_search_sign_change_rows(catalog, chrt, query.promittor_ids, window_start_jd, window_end_jd, sign_change_technique))
			raw_rows.extend(_search_station_rows(catalog, chrt, query.promittor_ids, window_start_jd, window_end_jd, sign_change_technique, runtime))
			raw_rows.extend(_search_cazimi_rows(catalog, chrt, query.promittor_ids, window_start_jd, window_end_jd, sign_change_technique, runtime))
			yield (
				'sign_changes',
				*_prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit),
			)


def search_cursor_progress(
	catalog,
	chrt,
	query,
	start_date,
	end_date,
	row_budget,
	direction='around',
	anchor_date=None,
	minimum_date=None,
	maximum_date=None,
	should_cancel=None,
):
	"""Yield complete, contiguous Search row coverage until a row budget is met.

	The cursor is a scheduling layer over the existing Search engine. It keeps
	one runtime and compiled query alive while sparse searches expand through
	adjacent calendar spans. Returned rows always describe the full reported
	coverage; callers never need to infer coverage from event density.
	"""
	direction = str(direction or '').strip().lower()
	if direction not in CURSOR_DIRECTIONS:
		raise ValueError('invalid search cursor direction')
	if not isinstance(start_date, datetime.date) or not isinstance(end_date, datetime.date):
		raise ValueError('search cursor dates must be datetime.date values')
	if start_date > end_date:
		raise ValueError('search cursor start date must not follow end date')
	if (end_date - start_date).days >= CURSOR_MAX_SEED_DAYS:
		raise ValueError('search cursor seed must not exceed one calendar month')
	unsupported_techniques = set(query.techniques) - set(CURSOR_TECHNIQUES)
	if unsupported_techniques:
		raise ValueError('search cursor contains an unsupported technique')
	try:
		row_budget = int(row_budget)
	except Exception as exc:
		raise ValueError('search cursor row budget must be an integer') from exc
	if row_budget < 1:
		raise ValueError('search cursor row budget must be positive')
	if anchor_date is None:
		anchor_date = start_date + datetime.timedelta(
			days=(end_date - start_date).days // 2
		)
	if not isinstance(anchor_date, datetime.date):
		raise ValueError('search cursor anchor must be a datetime.date value')
	if anchor_date < start_date or anchor_date > end_date:
		raise ValueError('search cursor anchor must be inside the seed range')
	minimum_date = minimum_date or datetime.date.min
	maximum_date = maximum_date or datetime.date.max
	if not isinstance(minimum_date, datetime.date) or not isinstance(maximum_date, datetime.date):
		raise ValueError('search cursor bounds must be datetime.date values')
	if minimum_date > start_date or maximum_date < end_date or minimum_date > maximum_date:
		raise ValueError('search cursor seed must be inside its range bounds')

	runtime = _SearchRuntime()
	compiled = _CompiledQuery(catalog, query)
	max_window_months = _cursor_max_window_months(catalog, query)

	def search_span(span_start, span_end):
		return _search_cursor_span(
			catalog,
			chrt,
			query,
			span_start,
			span_end,
			runtime,
			compiled,
			CURSOR_CHUNK_RESULT_LIMIT,
			should_cancel=should_cancel,
		)

	yield from row_cursor_progress(
		chrt,
		start_date,
		end_date,
		row_budget,
		direction=direction,
		anchor_date=anchor_date,
		minimum_date=minimum_date,
		maximum_date=maximum_date,
		search_span=search_span,
		max_window_months=max_window_months,
		should_cancel=should_cancel,
	)


def row_cursor_progress(
	chrt,
	start_date,
	end_date,
	row_budget,
	*,
	direction='around',
	anchor_date=None,
	minimum_date=None,
	maximum_date=None,
	search_span=None,
	max_window_months=CURSOR_MAX_WINDOW_MONTHS,
	should_cancel=None,
	dedupe_rows=None,
	row_sort_key=None,
):
	"""Apply Search's contiguous row-budget scheduler to an existing row source.

	``search_span`` owns event math and returns ``(rows, truncated, leaf_count)``
	for one inclusive civil-date span. The scheduler owns only adjacent coverage,
	row budgets, progress metadata, and cancellation between bounded spans.
	"""
	direction = str(direction or '').strip().lower()
	if direction not in CURSOR_DIRECTIONS:
		raise ValueError('invalid search cursor direction')
	if not isinstance(start_date, datetime.date) or not isinstance(end_date, datetime.date):
		raise ValueError('search cursor dates must be datetime.date values')
	if start_date > end_date:
		raise ValueError('search cursor start date must not follow end date')
	try:
		row_budget = int(row_budget)
	except Exception as exc:
		raise ValueError('search cursor row budget must be an integer') from exc
	if row_budget < 1:
		raise ValueError('search cursor row budget must be positive')
	if anchor_date is None:
		anchor_date = start_date + datetime.timedelta(
			days=(end_date - start_date).days // 2
		)
	if not isinstance(anchor_date, datetime.date):
		raise ValueError('search cursor anchor must be a datetime.date value')
	if anchor_date < start_date or anchor_date > end_date:
		raise ValueError('search cursor anchor must be inside the seed range')
	minimum_date = minimum_date or datetime.date.min
	maximum_date = maximum_date or datetime.date.max
	if not isinstance(minimum_date, datetime.date) or not isinstance(maximum_date, datetime.date):
		raise ValueError('search cursor bounds must be datetime.date values')
	if minimum_date > start_date or maximum_date < end_date or minimum_date > maximum_date:
		raise ValueError('search cursor seed must be inside its range bounds')
	if not callable(search_span):
		raise ValueError('search cursor span source is required')
	if dedupe_rows is None:
		dedupe_rows = _dedupe_rows
	if row_sort_key is None:
		row_sort_key = _search_row_sort_key

	anchor_jd = _date_to_jd(anchor_date, chrt)
	seed_start = start_date
	seed_end = end_date
	coverage_start = start_date
	coverage_end = end_date
	all_rows = []
	window_count = 0
	leaf_window_count = 0
	previous_row_count = 0
	started_at = time.perf_counter()
	last_yield_at = 0.0

	for span_start, span_end in _iter_cursor_date_spans(
		start_date,
		end_date,
		direction,
		max_window_months=max_window_months,
		minimum_date=minimum_date,
		maximum_date=maximum_date,
	):
		if should_cancel is not None and should_cancel():
			return
		try:
			span_rows, span_truncated, span_leaf_count = search_span(
				span_start,
				span_end,
			)
		except _SearchCursorCancelled:
			return
		if should_cancel is not None and should_cancel():
			return

		window_count += 1
		leaf_window_count += span_leaf_count
		coverage_start = min(coverage_start, span_start)
		coverage_end = max(coverage_end, span_end)
		all_rows.extend(span_rows)
		all_rows = dedupe_rows(all_rows)
		all_rows.sort(key=row_sort_key)
		row_count = len(all_rows)
		before_count = sum(
			1
			for row in all_rows
			if row.event_jd is not None and float(row.event_jd) < anchor_jd
		)
		after_count = row_count - before_count
		exhausted_previous = coverage_start <= minimum_date
		exhausted_next = coverage_end >= maximum_date
		before_budget = row_budget // 2
		after_budget = row_budget - before_budget
		if direction == 'previous':
			exhausted = exhausted_previous
			satisfied = row_count >= row_budget or exhausted
		elif direction == 'next':
			exhausted = exhausted_next
			satisfied = row_count >= row_budget or exhausted
		else:
			exhausted = exhausted_previous and exhausted_next
			satisfied = (
				(before_count >= before_budget or exhausted_previous)
				and (after_count >= after_budget or exhausted_next)
			)
		now = time.perf_counter()
		if (
			window_count == 1
			or span_truncated
			or satisfied
			or exhausted
			or now - last_yield_at >= CURSOR_PROGRESS_INTERVAL_SECONDS
		):
			coverage_start_jd, coverage_end_jd = _date_range_to_half_open_jd(
				coverage_start,
				coverage_end,
				chrt,
			)
			cursor = {
				'direction': direction,
				'rowBudget': row_budget,
				'rowCount': row_count,
				'newRows': max(0, row_count - previous_row_count),
				'beforeBudget': before_budget if direction == 'around' else 0,
				'afterBudget': after_budget if direction == 'around' else 0,
				'beforeCount': before_count,
				'afterCount': after_count,
				'seedFrom': seed_start.isoformat(),
				'seedTo': seed_end.isoformat(),
				'anchorDate': anchor_date.isoformat(),
				'rangeFrom': minimum_date.isoformat(),
				'rangeTo': maximum_date.isoformat(),
				'coverageFrom': coverage_start.isoformat(),
				'coverageTo': coverage_end.isoformat(),
				'coverageStartJdUt': coverage_start_jd,
				'coverageEndJdUt': coverage_end_jd,
				'windowsScanned': window_count,
				'leafWindowsScanned': leaf_window_count,
				'exhaustedPrevious': exhausted_previous,
				'exhaustedNext': exhausted_next,
				'exhausted': exhausted,
				'satisfied': satisfied,
				'elapsedMs': round((now - started_at) * 1000.0, 3),
			}
			last_yield_at = now
			previous_row_count = row_count
			yield all_rows, bool(span_truncated), cursor

		if span_truncated or satisfied or exhausted:
			return


def _iter_cursor_date_spans(
	start_date,
	end_date,
	direction,
	max_window_months=CURSOR_MAX_WINDOW_MONTHS,
	minimum_date=datetime.date.min,
	maximum_date=datetime.date.max,
):
	max_window_months = max(1, min(CURSOR_MAX_WINDOW_MONTHS, int(max_window_months)))
	yield start_date, end_date
	if direction == 'previous':
		months = 1
		cursor = start_date
		while cursor > minimum_date:
			span_start, span_end = _cursor_span_before(cursor, months)
			span_start = max(minimum_date, span_start)
			yield span_start, span_end
			cursor = span_start
			months = min(max_window_months, months * 2)
		return
	if direction == 'next':
		months = 1
		cursor = end_date
		while cursor < maximum_date:
			span_start, span_end = _cursor_span_after(cursor, months)
			span_end = min(maximum_date, span_end)
			yield span_start, span_end
			cursor = span_end
			months = min(max_window_months, months * 2)
		return

	previous_cursor = start_date
	next_cursor = end_date
	months = 1
	while previous_cursor > minimum_date or next_cursor < maximum_date:
		if previous_cursor > minimum_date:
			span_start, span_end = _cursor_span_before(previous_cursor, months)
			span_start = max(minimum_date, span_start)
			yield span_start, span_end
			previous_cursor = span_start
		if next_cursor < maximum_date:
			span_start, span_end = _cursor_span_after(next_cursor, months)
			span_end = min(maximum_date, span_end)
			yield span_start, span_end
			next_cursor = span_end
		months = min(max_window_months, months * 2)


def _cursor_max_window_months(catalog, query):
	if set(query.techniques) - {
		searchquery.SearchQuery.TECHNIQUE_TRANSITS,
		searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS,
	}:
		return 1
	if query.include_sign_changes or query.has_motion_filters():
		return 1
	if len(_per_target_transit_significator_ids(catalog, query)) != 0:
		return 1
	for promittor_id in query.promittor_ids:
		if not _can_use_fast_transit_promittor(catalog.get(promittor_id)):
			return 1
	return CURSOR_MAX_WINDOW_MONTHS


def _cursor_span_before(boundary, months):
	span_end = boundary - datetime.timedelta(days=1)
	span_start = _shift_date_months(boundary, -months)
	if span_start >= boundary:
		span_start = datetime.date.min
	return span_start, span_end


def _cursor_span_after(boundary, months):
	span_start = boundary + datetime.timedelta(days=1)
	end_exclusive = _shift_date_months(span_start, months)
	if end_exclusive <= span_start:
		span_end = datetime.date.max
	else:
		span_end = end_exclusive - datetime.timedelta(days=1)
	return span_start, span_end


def _shift_date_months(value, months):
	month_index = value.year * 12 + value.month - 1 + int(months)
	min_month_index = 12
	max_month_index = datetime.date.max.year * 12 + datetime.date.max.month - 1
	if month_index < min_month_index:
		return datetime.date.min
	if month_index > max_month_index:
		return datetime.date.max
	year, zero_month = divmod(month_index, 12)
	month = zero_month + 1
	day = min(value.day, _days_in_month(year, month))
	return datetime.date(year, month, day)


def _days_in_month(year, month):
	if year == datetime.date.max.year and month == 12:
		return datetime.date.max.day
	if month == 12:
		next_month = datetime.date(year + 1, 1, 1)
	else:
		next_month = datetime.date(year, month + 1, 1)
	return (next_month - datetime.date(year, month, 1)).days


class _SearchCursorCancelled(Exception):
	pass


def _search_cursor_span(
	catalog,
	chrt,
	query,
	start_date,
	end_date,
	runtime,
	compiled,
	limit,
	should_cancel=None,
):
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	rows, truncated = _search_date_window(
		catalog,
		chrt,
		query,
		start_date,
		end_date,
		runtime,
		compiled,
		limit,
		should_cancel=should_cancel,
	)
	if not truncated:
		return rows, False, 1
	if start_date >= end_date:
		raise RuntimeError(
			'search cursor cannot represent complete one-day coverage within its row limit'
		)

	midpoint = start_date + datetime.timedelta(days=(end_date - start_date).days // 2)
	left_rows, left_truncated, left_count = _search_cursor_span(
		catalog,
		chrt,
		query,
		start_date,
		midpoint,
		runtime,
		compiled,
		limit,
		should_cancel=should_cancel,
	)
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	right_rows, right_truncated, right_count = _search_cursor_span(
		catalog,
		chrt,
		query,
		midpoint + datetime.timedelta(days=1),
		end_date,
		runtime,
		compiled,
		limit,
		should_cancel=should_cancel,
	)
	merged = _dedupe_rows(left_rows + right_rows)
	merged.sort(key=_search_row_sort_key)
	return merged, bool(left_truncated or right_truncated), left_count + right_count


def _search_date_window(
	catalog,
	chrt,
	query,
	start_date,
	end_date,
	runtime,
	compiled,
	limit,
	should_cancel=None,
):
	start_jd, end_jd = _date_range_to_half_open_jd(start_date, end_date, chrt)
	raw_rows = []

	if searchquery.SearchQuery.TECHNIQUE_TRANSITS in query.techniques:
		raw_rows.extend(_search_transits(catalog, chrt, query, start_jd, end_jd, runtime, compiled))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS in query.techniques:
		raw_rows.extend(_search_converse_transits(catalog, chrt, query, start_jd, end_jd, runtime, compiled))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_PROFECTIONS in query.techniques:
		raw_rows.extend(_search_profections(catalog, chrt, query, start_jd, end_jd))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS in query.techniques:
		raw_rows.extend(_search_secondary_directions(
			catalog,
			chrt,
			query,
			start_jd,
			end_jd,
			runtime,
			compiled,
		))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS in query.techniques:
		raw_rows.extend(_search_primary_directions(catalog, chrt, query, start_jd, end_jd, runtime))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER in query.techniques:
		raw_rows.extend(_search_mundane_weather(catalog, chrt, query, start_jd, end_jd, runtime, compiled))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES in query.techniques:
		raw_rows.extend(_search_heliacal_phases(
			catalog,
			chrt,
			query.promittor_ids,
			start_jd,
			end_jd,
			runtime,
		))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_LUNATIONS in query.techniques:
		raw_rows.extend(_search_lunations(
			catalog,
			chrt,
			query,
			start_jd,
			end_jd,
			runtime,
			eclipses_only=False,
		))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()
	if searchquery.SearchQuery.TECHNIQUE_ECLIPSES in query.techniques:
		raw_rows.extend(_search_lunations(
			catalog,
			chrt,
			query,
			start_jd,
			end_jd,
			runtime,
			eclipses_only=True,
		))
	if should_cancel is not None and should_cancel():
		raise _SearchCursorCancelled()

	sign_change_technique = _sign_change_technique(query)
	if sign_change_technique is not None:
		raw_rows.extend(_search_sign_change_rows(catalog, chrt, query.promittor_ids, start_jd, end_jd, sign_change_technique))
		if should_cancel is not None and should_cancel():
			raise _SearchCursorCancelled()
		raw_rows.extend(_search_station_rows(catalog, chrt, query.promittor_ids, start_jd, end_jd, sign_change_technique, runtime))
		if should_cancel is not None and should_cancel():
			raise _SearchCursorCancelled()
		raw_rows.extend(_search_cazimi_rows(catalog, chrt, query.promittor_ids, start_jd, end_jd, sign_change_technique, runtime))

	return _prepare_search_rows(raw_rows, catalog, chrt, query, runtime, limit)


def _iter_progress_jd_windows(start_jd, end_jd, window_days=PROGRESS_WINDOW_DAYS):
	current_jd = float(start_jd)
	final_jd = float(end_jd)
	step = max(1.0, float(window_days))
	while current_jd < final_jd:
		next_jd = min(final_jd, current_jd + step)
		yield current_jd, next_jd
		current_jd = next_jd


def _prepare_search_rows(rows, catalog, chrt, query, runtime, limit):
	rows = _dedupe_rows(list(rows))
	rows.sort(key=_search_row_sort_key)
	if query.moon_phase_filter:
		rows = _annotate_rows_by_moon_phase(rows, catalog, chrt, runtime)
		rows = _filter_rows_by_moon_phase(rows, query)
		rows = _dedupe_rows(rows)
		rows.sort(key=_search_row_sort_key)
	if query.has_motion_filters():
		_hydrate_result_display_payloads(rows, catalog, chrt, runtime)
		rows = _filter_rows_by_motion(rows, query, catalog, chrt)
		rows = _dedupe_rows(rows)
		rows.sort(key=_search_row_sort_key)

	truncated = False
	if len(rows) > limit:
		rows = rows[:limit]
		truncated = True
	if not query.moon_phase_filter:
		rows = _annotate_rows_by_moon_phase(rows, catalog, chrt, runtime)

	if not query.has_motion_filters():
		_hydrate_result_display_payloads(rows, catalog, chrt, runtime)

	return rows, truncated


def _search_row_sort_key(row):
	return (
		row.event_jd if row.event_jd is not None else float('inf'),
		row.technique,
		row.promittor_label,
		row.significator_label,
		row.aspect,
		row.notes,
	)


def build_secondary_chart_for_datetime(radix, event_tuple):
	if radix is None:
		return None
	try:
		_age_int, _age_years, _progressed_date, progressed_chart = posfordate.make_progressed_chart_by_real_date(
			radix,
			radix.options,
			int(event_tuple[0]), int(event_tuple[1]), int(event_tuple[2]),
			int(event_tuple[3]), int(event_tuple[4]), int(event_tuple[5]),
			method=posfordate.SECONDARY,
		)
		return progressed_chart
	except Exception:
		return None


def build_secondary_chart_for_symbolic_age(radix, symbolic_age):
	if radix is None:
		return None
	try:
		_age_int, _age_years, _progressed_date, progressed_chart = posfordate.make_progressed_chart_by_symbolic_age(
			radix,
			radix.options,
			float(symbolic_age),
			method=posfordate.SECONDARY,
		)
		return progressed_chart
	except Exception:
		return None


def build_transit_chart_for_datetime(radix, event_tuple):
	if radix is None:
		return None

	y, m, d, hour, minute, second = event_tuple
	time = chart.Time(
		y, m, d, hour, minute, second,
		False, radix.time.cal, chart.Time.GREENWICH,
		True, 0, 0, False, radix.place, False
	)
	return chart.Chart(radix.name, radix.male, time, radix.place, chart.Chart.TRANSIT, '', radix.options, False)


def build_profection_chart_for_datetime(radix, event_tuple):
	if radix is None:
		return None

	y, m, d, hour, minute, second = event_tuple
	t = hour + minute/60.0 + second/3600.0
	prof = profections.Profections(radix, y, m, d, t)
	pchart = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PROFECTION, '', radix.options, False, chart.Chart.YEAR)
	pchart.calcProfPos(prof)
	return pchart


def format_result_technique_label(row):
	label = _search_technique_label(row.technique)
	if row is not None and row.notes:
		return '%s (%s)' % (label, row.notes)
	return label


def _search_transits(catalog, chrt, query, start_jd, end_jd, runtime=None, compiled=None):
	if compiled is None:
		compiled = _CompiledQuery(catalog, query)

	rows = []
	per_target_sig_ids = _per_target_transit_significator_ids(catalog, query)
	fast_promittors = []
	fallback_promittors = []
	for prom_id in query.promittor_ids:
		prom = catalog.get(prom_id)
		if _can_use_fast_transit_promittor(prom):
			fast_promittors.append(prom_id)
			continue
		if _can_use_moon_cross_solver(chrt, prom):
			rows.extend(_search_transits_moon_solver(catalog, chrt, query, start_jd, end_jd, prom_id))
		else:
			fallback_promittors.append(prom_id)
	rows.extend(_search_transits_fast_engine(catalog, chrt, start_jd, end_jd, compiled, excluded_significator_ids=per_target_sig_ids))
	if len(per_target_sig_ids) != 0 and len(fast_promittors) != 0:
		rows.extend(_search_transits_per_target(catalog, chrt, query, start_jd, end_jd, fast_promittors, significator_ids=per_target_sig_ids))
	if len(fallback_promittors) != 0:
		rows.extend(_search_transits_per_target(catalog, chrt, query, start_jd, end_jd, fallback_promittors))
	return rows


def _search_converse_transits(catalog, chrt, query, display_start_jd, display_end_jd, runtime=None, compiled=None):
	try:
		birth_jd = float(chrt.time.jd)
	except Exception:
		return []
	converse_start_jd = converse_transits.mirrored_jd(birth_jd, display_end_jd)
	converse_end_jd = converse_transits.mirrored_jd(birth_jd, display_start_jd)
	rows = _search_transits(catalog, chrt, query, converse_start_jd, converse_end_jd, runtime, compiled)
	calflag = _calendar_flag(chrt)
	out = []
	for row in rows:
		if row.event_jd is None:
			continue
		converse_jd = float(row.event_jd)
		display_jd = converse_transits.mirrored_jd(birth_jd, converse_jd)
		if display_jd < display_start_jd or display_jd >= display_end_jd:
			continue
		converse_tuple = _jd_to_datetime_tuple(converse_jd, calflag)
		row.metadata['converse_transit_jd'] = converse_jd
		row.metadata['converse_transit_datetime'] = converse_tuple
		row.metadata['converse_transit_date'] = '%04d-%02d-%02d' % (converse_tuple[0], converse_tuple[1], converse_tuple[2])
		row.metadata['converse_transit_time'] = '%02d:%02d:%02d' % (converse_tuple[3], converse_tuple[4], converse_tuple[5])
		_fill_row_from_jd(row, catalog, display_jd, calflag)
		row.technique = searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS
		row.can_open_chart = True
		out.append(row)
	return out


def _converse_transit_jd(birth_jd, event_jd):
	"""Compatibility alias for callers/tests; engine owns the mirror math."""
	return converse_transits.mirrored_jd(birth_jd, event_jd)


def _can_use_fast_transit_promittor(prom):
	if prom is None or prom.planet_index is None:
		return False
	if prom.id in ('planet:asc_node', 'planet:desc_node'):
		return True
	return (
		prom.family == searchcatalog.SearchObject.FAMILY_PLANET
		and prom.planet_index <= astrology.SE_PLUTO
	)


def _per_target_transit_significator_ids(catalog, query):
	ids = []
	for sig_id in query.significator_ids:
		obj = catalog.get(sig_id)
		if obj is not None and obj.family in (
			searchcatalog.SearchObject.FAMILY_SYZYGY,
			searchcatalog.SearchObject.FAMILY_ECLIPSE,
		):
			ids.append(sig_id)
	return tuple(ids)


def _search_transits_fast_engine(catalog, chrt, start_jd, end_jd, compiled, excluded_significator_ids=()):
	calflag = _calendar_flag(chrt)
	context = _planet_ephemeris_context(chrt)
	excluded_significator_ids = set(excluded_significator_ids or ())
	promittor_indices = []
	promittor_specs = {}
	seen_promittor_indices = set()
	for prom_id in compiled.transit_batch_promittor_ids:
		prom = catalog.get(prom_id)
		transit_body, target_shift = _transit_promittor_body_and_target_shift(prom, chrt)
		if transit_body is None:
			continue
		promittor_specs[prom_id] = (int(transit_body), float(target_shift))
		if transit_body not in seen_promittor_indices:
			seen_promittor_indices.add(transit_body)
			promittor_indices.append(int(transit_body))
	if len(promittor_indices) == 0:
		return []

	target_map = {}
	target_longitudes = []
	seen_target_specs = set()
	for prom_id, sig_id, aspect_id, target_lon in compiled.static_targets:
		promittor_spec = promittor_specs.get(prom_id)
		if promittor_spec is None:
			continue
		if sig_id in excluded_significator_ids:
			continue
		transit_body, target_shift = promittor_spec
		search_target_lon = util.normalize(float(target_lon) - target_shift)
		target_key = round(search_target_lon, 12)
		spec_key = (prom_id, sig_id, aspect_id, target_key)
		if spec_key in seen_target_specs:
			continue
		seen_target_specs.add(spec_key)
		key = (transit_body, target_key)
		if key not in target_map:
			target_map[key] = []
			target_longitudes.append(search_target_lon)
		target_map[key].append((prom_id, sig_id, aspect_id))
	if len(target_longitudes) == 0:
		return []

	hits = transit_fast_api.search_longitude_transits_batch_raw(
		promittor_indices,
		float(start_jd),
		float(end_jd),
		target_longitudes,
		context=context,
	)
	rows = []
	for hit_jd, planet_idx, target_deg, _aspect_deg, _hit_kind, _speed, _retrograde in hits:
		event_tuple = _jd_to_datetime_tuple(hit_jd, calflag)
		event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
		event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
		target_specs = target_map.get((int(planet_idx), round(float(target_deg), 12)), ())
		for prom_id, sig_id, aspect_id in target_specs:
			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_TRANSITS,
				aspect_id,
				prom_id,
				sig_id
			)
			_fill_row_from_event(row, catalog, hit_jd, event_tuple, event_date, event_time)
			rows.append(row)
	return rows


def _search_transits_per_target(catalog, chrt, query, start_jd, end_jd, promittor_ids=None, aspect_ids=None, significator_ids=None):
	rows = []
	calflag = _calendar_flag(chrt)
	context = _planet_ephemeris_context(chrt)
	if promittor_ids is None:
		promittor_ids = query.promittor_ids
	if aspect_ids is None:
		aspect_ids = query.aspects
	if significator_ids is None:
		significator_ids = query.significator_ids

	for prom_id in promittor_ids:
		prom = catalog.get(prom_id)
		transit_body, target_shift = _transit_promittor_body_and_target_shift(prom, chrt)
		if transit_body is None:
			continue

		for sig_id in significator_ids:
			sig = catalog.get(sig_id)
			if sig is None:
				continue

			for aspect_id in aspect_ids:
				chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
				if chart_aspect is None:
					continue

				for target_lon in _aspect_target_longitudes(sig.longitude, chart_aspect):
					search_target_lon = util.normalize(target_lon - target_shift)
					for year, month in _iter_months_between(start_jd, end_jd, calflag):
						engine = transits.Transits()
						engine.month(
							year,
							month,
							chrt,
							transit_body,
							search_target_lon,
							context=context,
						)
						for tr in engine.transits:
							event_jd = astrology.swe_julday(year, month, tr.day, tr.time, calflag)
							if event_jd < start_jd or event_jd >= end_jd:
								continue

							row = searchquery.SearchResult(
								searchquery.SearchQuery.TECHNIQUE_TRANSITS,
								aspect_id,
								prom.id,
								sig.id
							)
							_fill_row_from_jd(row, catalog, event_jd, calflag)
							rows.append(row)

	return rows


def _transit_promittor_body_and_target_shift(prom, chrt):
	if prom is None or prom.planet_index is None:
		return None, 0.0
	if prom.id == 'planet:asc_node':
		return astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE, 0.0
	if prom.id == 'planet:desc_node':
		return astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE, 180.0
	return int(prom.planet_index), 0.0


def _search_transits_moon_solver(catalog, chrt, query, start_jd, end_jd, prom_id):
	rows = []
	calflag = _calendar_flag(chrt)
	context = _moon_crossing_context(chrt)
	prom = catalog.get(prom_id)
	if prom is None:
		return rows

	for sig_id in query.significator_ids:
		sig = catalog.get(sig_id)
		if sig is None:
			continue

		for aspect_id in query.aspects:
			chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
			if chart_aspect is None:
				continue

			for target_lon in _aspect_target_longitudes(sig.longitude, chart_aspect):
				hits = transit_fast_api.search_longitude_transits(
					astrology.SE_MOON,
					float(start_jd),
					float(end_jd),
					[float(target_lon)],
					context=context,
				)
				for hit in hits:
					hit_jd = float(hit.jd_ut)
					if hit_jd < start_jd or hit_jd >= end_jd:
						continue

					row = searchquery.SearchResult(
						searchquery.SearchQuery.TECHNIQUE_TRANSITS,
						aspect_id,
						prom.id,
						sig.id
					)
					_fill_row_from_jd(row, catalog, hit_jd, calflag)
					rows.append(row)

	return rows


def _search_profections(catalog, chrt, query, start_jd, end_jd):
	rows = []
	calflag = _calendar_flag(chrt)
	cycle_days = 360.0*profections.Profections.K

	for prom_id in query.promittor_ids:
		prom = catalog.get(prom_id)
		if prom is None:
			continue

		for sig_id in query.significator_ids:
			sig = catalog.get(sig_id)
			if sig is None:
				continue

			for aspect_id in query.aspects:
				chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
				if chart_aspect is None:
					continue

				for target_lon in _aspect_target_longitudes(sig.longitude, chart_aspect):
					delta = util.normalize(target_lon-prom.longitude)
					first_hit = chrt.time.jd + delta*profections.Profections.K
					if first_hit >= end_jd and delta != 0.0:
						continue

					n = 0
					if first_hit < start_jd:
						n = int(math.floor((start_jd-first_hit)/cycle_days))
						if first_hit+n*cycle_days < start_jd:
							n += 1

					hit_jd = first_hit+n*cycle_days
					while hit_jd < end_jd:
						if hit_jd >= start_jd:
							row = searchquery.SearchResult(
								searchquery.SearchQuery.TECHNIQUE_PROFECTIONS,
								aspect_id,
								prom.id,
								sig.id
							)
							_fill_row_from_jd(row, catalog, hit_jd, calflag)
							rows.append(row)
						hit_jd += cycle_days

	return rows


def _cheby_secondary_disabled():
	value = os.environ.get('MORINUS_DISABLE_CHEBY', '')
	return value not in ('', '0', 'false', 'False', 'no', 'No')


def _search_secondary_directions(catalog, chrt, query, start_jd, end_jd, runtime=None, compiled=None, max_rows=None):
	if compiled is None:
		compiled = _CompiledQuery(catalog, query)

	method = int(getattr(query, 'progression_method', posfordate.SECONDARY))
	start_age = _secondary_symbolic_age_for_jd(chrt, start_jd, method=method)
	end_age = _secondary_symbolic_age_for_jd(chrt, end_jd, method=method)

	method_name = posfordate.progression_method_name(method).upper()
	# start_age/end_age are in ephem days. Convert to native years for the label.
	_method_scale = posfordate.progression_symbolic_scale(method) or 1.0
	rec = prog_log.Recorder('%s %.1f-%.1fy' % (
		method_name,
		float(start_age) / _method_scale,
		float(end_age) / _method_scale,
	))

	cheby_handled_promittor_ids = set()
	rows = []
	if not _cheby_secondary_disabled():
		with rec.stage('cheby'):
			cheby_rows, cheby_handled_promittor_ids = _search_secondary_directions_cheby(
				catalog, chrt, compiled, start_age, end_age, start_jd, end_jd, runtime, max_rows=max_rows, method=method, recorder=rec,
			)
		rows.extend(cheby_rows)
		rec.note('cheby_rows', len(cheby_rows))
		rec.note('cheby_handled', len(cheby_handled_promittor_ids))
		if max_rows is not None and len(rows) >= int(max_rows):
			rec.summary()
			return rows

	# The Moon-solver and planet-batch tiers go through transit_fast_api with a
	# real-ephemeris JD range — they only make sense for SECONDARY (1:1 mapping).
	# For tertiary/minor, only the cheby path runs; remaining unhandled
	# promittors fall through to the per-target snapshot loop below.
	if method == posfordate.SECONDARY:
		if 'planet:moon' not in cheby_handled_promittor_ids:
			with rec.stage('moon_solver'):
				moon_rows = _search_secondary_directions_moon_solver(
					catalog,
					chrt,
					query,
					start_age,
					end_age,
					start_jd,
					end_jd,
					runtime,
					max_rows=max_rows,
				)
			rows.extend(moon_rows)
			if max_rows is not None and len(rows) >= int(max_rows):
				rec.summary()
				return rows

		with rec.stage('planet_batch'):
			batch_rows = _search_secondary_directions_planet_batch(
				catalog,
				chrt,
				compiled,
				start_age,
				end_age,
				start_jd,
				end_jd,
				runtime,
				max_rows=max_rows,
				skip_promittor_ids=cheby_handled_promittor_ids,
			)
		rows.extend(batch_rows)
		if max_rows is not None and len(rows) >= int(max_rows):
			rec.summary()
			return rows

	calflag = _calendar_flag(chrt)
	batch_promittor_ids = set(compiled.secondary_batch_promittor_ids) if method == posfordate.SECONDARY else set()
	handled_promittor_ids = set(batch_promittor_ids)
	if method == posfordate.SECONDARY:
		handled_promittor_ids.add('planet:moon')
	handled_promittor_ids.update(cheby_handled_promittor_ids)
	targets = [target for target in compiled.static_targets if target[0] not in handled_promittor_ids]
	if len(targets) == 0:
		rec.note('rows', len(rows))
		rec.summary()
		return rows

	# Per-target snapshot fallback — slow path. Log a warning when it runs in
	# MINOR/TERTIARY (cheby should cover all standard bodies; the fallback firing
	# in non-SECONDARY mode signals an unsupported promittor configuration).
	if method != posfordate.SECONDARY:
		prog_log.log(
			'fallback snapshot loop fired in %s for %d targets: %s'
			% (method_name, len(targets), ', '.join(sorted(set(t[0] for t in targets))))
		)
	fallback_stage = rec.stage('snapshot_fallback')
	fallback_stage.__enter__()

	selected_promittor_ids = _unique_in_order([prom_id for prom_id, sig_id, aspect_id, target_lon in targets])
	current_age = start_age
	current_catalog = _build_secondary_snapshot_for_symbolic_age(catalog, chrt, current_age, selected_promittor_ids, runtime, method=method)
	# Step in ephemeris days. 1 ephem-day is fine-grained for all progression
	# methods: it equals 1 native year for SECONDARY and is sub-year for
	# MINOR/TERTIARY (which need finer resolution because their ephemeris span
	# is wider).
	step_days = 1.0

	while current_age < end_age:
		next_age = min(current_age + step_days, end_age)
		next_catalog = _build_secondary_snapshot_for_symbolic_age(catalog, chrt, next_age, selected_promittor_ids, runtime, method=method)

		for prom_id, sig_id, aspect_id, target_lon in targets:
			prom0 = current_catalog.get(prom_id)
			prom1 = next_catalog.get(prom_id)
			if prom0 is None or prom1 is None:
				continue

			delta0 = _signed_angular_delta(prom0.longitude, target_lon)
			delta1 = _signed_angular_delta(prom1.longitude, target_lon)
			if not _is_target_zero_crossing(delta0, delta1):
				continue

			exact_age = _interpolate_zero_crossing(current_age, next_age, delta0, delta1)
			event_info = _secondary_real_event_info_for_symbolic_age(chrt, exact_age, method=method)
			if event_info is None:
				continue
			exact_jd = _secondary_finalize_real_jd(
				catalog,
				chrt,
				prom_id,
				target_lon,
				event_info[0],
				start_jd,
				end_jd,
				runtime,
				method=method,
			)
			if exact_jd < start_jd or exact_jd >= end_jd:
				continue
			event_tuple = _jd_to_datetime_tuple(exact_jd, calflag)
			event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
			event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])

			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
				aspect_id,
				prom_id,
				sig_id
			)
			_fill_row_from_event(row, catalog, exact_jd, event_tuple, event_date, event_time)
			row.metadata['display_datetime'] = event_tuple
			rows.append(row)

		current_age = next_age
		current_catalog = next_catalog
		if max_rows is not None and len(rows) >= int(max_rows):
			break

	fallback_stage.__exit__(None, None, None)
	rec.note('rows', len(rows))
	rec.note('fallback_targets', len(targets))
	rec.summary()
	return rows


def build_secondary_station_rows(catalog, chrt, start_date, end_date, promittor_ids=None, method=posfordate.SECONDARY):
	if catalog is None or chrt is None or getattr(chrt, 'time', None) is None:
		return []
	start_jd = _date_to_jd(start_date, chrt)
	end_jd = _date_to_jd(end_date + datetime.timedelta(days=1), chrt)
	return _search_secondary_station_rows(
		catalog,
		chrt,
		start_jd,
		end_jd,
		_SearchRuntime(),
		promittor_ids=promittor_ids,
		method=method,
	)


def build_secondary_ingress_rows(
	catalog,
	chrt,
	start_date,
	end_date,
	promittor_ids=None,
	method=posfordate.SECONDARY,
	direction='direct',
):
	"""Return exact sign-boundary events on the progression trajectory.

	This is the symbolic-time twin of ``_search_sign_change_rows`` used by the
	Synodic Cycles list. Longitude roots are solved on the progressed ephemeris
	clock, then mapped back to the list's signified civil timeline.
	"""
	if catalog is None or chrt is None or getattr(chrt, 'time', None) is None:
		return []
	start_jd = _date_to_jd(start_date, chrt)
	end_jd = _date_to_jd(end_date + datetime.timedelta(days=1), chrt)
	return _search_secondary_ingress_rows(
		catalog,
		chrt,
		start_jd,
		end_jd,
		_SearchRuntime(),
		promittor_ids=promittor_ids,
		method=method,
		direction=direction,
	)


def _search_secondary_ingress_rows(
	catalog,
	chrt,
	start_jd,
	end_jd,
	runtime=None,
	promittor_ids=None,
	method=posfordate.SECONDARY,
	direction='direct',
):
	if runtime is None:
		runtime = _SearchRuntime()
	method = posfordate.progression_method(method)
	converse = str(direction or 'direct').strip().lower() == 'converse'
	start_age = _secondary_symbolic_age_for_jd(chrt, start_jd, method=method)
	end_age = _secondary_symbolic_age_for_jd(chrt, end_jd, method=method)
	if start_age >= end_age:
		return []

	birth_jd = float(chrt.time.jd)
	if converse:
		motion_start = birth_jd - float(end_age)
		motion_end = birth_jd - float(start_age)
	else:
		motion_start = birth_jd + float(start_age)
		motion_end = birth_jd + float(end_age)
	context = runtime.ephemeris_context(chrt)
	ids = list(promittor_ids) if promittor_ids is not None else list(getattr(catalog, 'promittor_ids', ()))
	rows = []
	for prom_id in ids:
		prom = catalog.get(prom_id)
		planet_id, targets, target_to_sign = _sign_change_planet_targets(prom, chrt)
		if planet_id is None or not targets:
			continue
		try:
			hits = transit_fast_api.search_longitude_transits(
				planet_id,
				float(motion_start),
				float(motion_end),
				targets,
				context=context,
			)
		except Exception:
			continue
		for hit in hits:
			motion_jd = float(hit.jd_ut)
			symbolic_age = birth_jd - motion_jd if converse else motion_jd - birth_jd
			event_info = _secondary_real_event_info_for_symbolic_age(chrt, symbolic_age, method=method)
			if event_info is None:
				continue
			event_real_jd, event_tuple, event_date, event_time = event_info
			if event_real_jd < start_jd or event_real_jd >= end_jd:
				continue
			target_sign = target_to_sign.get(round(float(hit.target_deg), 12))
			if target_sign is None:
				continue
			trajectory_speed = -float(hit.speed) if converse else float(hit.speed)
			left_sign, right_sign = _sign_change_pair(target_sign, trajectory_speed)
			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
				searchquery.SearchQuery.ASPECT_SIGN_CHANGE,
				prom_id,
				'sign:%02d' % right_sign,
			)
			_fill_row_from_event(row, catalog, event_real_jd, event_tuple, event_date, event_time)
			row.significator_label = '%s|%s' % (mtexts.signs[left_sign], mtexts.signs[right_sign])
			row.metadata.update(_sign_change_metadata(left_sign, right_sign, trajectory_speed))
			row.metadata['display_datetime'] = event_tuple
			row.metadata['secondary_ingress'] = True
			row.metadata['progressed_ingress_jd'] = motion_jd
			row.metadata['sig_display'] = _weather_sign_payload(
				row.metadata['sign_change_event_sign'], chrt,
			)
			prom_payload = _secondary_aspect_motion_payload(
				_build_payload_for_object(
					chrt,
					prom,
					float(hit.target_deg),
					float(hit.speed),
					motion_jd,
					True,
				)
			)
			if prom_payload is not None:
				row.metadata['prom_display'] = prom_payload
				if prom_payload.get('state_suffix'):
					row.promittor_label = '%s%s' % (prom.label, prom_payload['state_suffix'])
			row.metadata['display_hydrated'] = True
			rows.append(row)
	rows.sort(key=lambda row: (
		row.event_jd if row.event_jd is not None else float('inf'),
		row.promittor_label,
		row.significator_label,
	))
	return _dedupe_rows(rows)


def _search_secondary_station_rows(catalog, chrt, start_jd, end_jd, runtime=None, promittor_ids=None, method=posfordate.SECONDARY):
	if runtime is None:
		runtime = _SearchRuntime()
	method = posfordate.progression_method(method)
	start_age = _secondary_symbolic_age_for_jd(chrt, start_jd, method=method)
	end_age = _secondary_symbolic_age_for_jd(chrt, end_jd, method=method)
	if start_age >= end_age:
		return []

	station_promittors = _secondary_station_promittors(catalog, promittor_ids)
	if len(station_promittors) == 0:
		return []

	birth_jd = float(chrt.time.jd)
	range_start = birth_jd + float(start_age)
	range_end = birth_jd + float(end_age)
	context = runtime.ephemeris_context(chrt)
	flags = context.flags
	planet_ids = [planet_idx for planet_idx, _prom_id in station_promittors]
	promittor_by_planet = dict(station_promittors)

	try:
		hits = transit_fast_api.search_station_times_batch(
			planet_ids,
			float(range_start),
			float(range_end),
			context=context,
		)
	except Exception:
		hits = []
		for planet_idx in planet_ids:
			try:
				hits.extend(transit_fast_api.search_station_times(
					planet_idx,
					float(range_start),
					float(range_end),
					context=context,
				))
			except Exception:
				continue

	rows = []
	for hit, code in _classified_station_hits(hits, flags):
		planet_idx = int(hit.planet)
		prom_id = promittor_by_planet.get(planet_idx)
		if prom_id is None:
			continue
		station_jd = float(hit.jd_ut)
		symbolic_age = station_jd - birth_jd
		event_info = _secondary_real_event_info_for_symbolic_age(chrt, symbolic_age, method=method)
		if event_info is None:
			continue
		event_real_jd, event_tuple, event_date, event_time = event_info
		if event_real_jd < start_jd or event_real_jd >= end_jd:
			continue
		aspect_id = SECONDARY_STATION_ASPECT_BY_CODE.get(code, searchquery.SearchQuery.ASPECT_STATION)
		prom = catalog.get(prom_id)
		if prom is None:
			continue
		row = searchquery.SearchResult(
			searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
			aspect_id,
			prom_id,
			''
		)
		_fill_row_from_event(row, catalog, event_real_jd, event_tuple, event_date, event_time)
		row.significator_label = ''
		row.notes = radixsignals.format_signal_label(code)
		row.event_label = row.notes
		row.metadata['display_datetime'] = event_tuple
		row.metadata['progressed_station_jd'] = station_jd
		row.metadata['station_code'] = code
		row.metadata['secondary_station'] = True
		station_lon = _secondary_symbolic_object_longitude(prom, chrt, symbolic_age, runtime=runtime, method=method)
		_apply_secondary_station_display_payload(row, chrt, prom, station_lon, float(hit.speed), station_jd, code)
		rows.append(row)
	return rows


def _secondary_station_promittors(catalog, promittor_ids=None):
	ids = list(promittor_ids) if promittor_ids is not None else list(getattr(catalog, 'promittor_ids', ()))
	pairs = []
	seen_planets = set()
	for prom_id in ids:
		obj = catalog.get(prom_id)
		if obj is None or obj.family != searchcatalog.SearchObject.FAMILY_PLANET:
			continue
		if obj.planet_index is None:
			continue
		planet_idx = int(obj.planet_index)
		if planet_idx in (astrology.SE_SUN, astrology.SE_MOON):
			continue
		if planet_idx in seen_planets:
			continue
		seen_planets.add(planet_idx)
		pairs.append((planet_idx, prom_id))
	return pairs


def _station_speed_at_jd(planet_idx, jd_ut, flags):
	try:
		body = planets.Planet(float(jd_ut), int(planet_idx), int(flags))
		return float(body.data[planets.Planet.SPLON])
	except Exception:
		return None


def _station_code_for_planet_jd(planet_idx, jd_ut, flags):
	before = _station_speed_at_jd(planet_idx, float(jd_ut) - 0.05, flags)
	after = _station_speed_at_jd(planet_idx, float(jd_ut) + 0.05, flags)
	if before is None or after is None:
		return None
	if before > 0.0 and after < 0.0:
		return 'SR'
	if before < 0.0 and after > 0.0:
		return 'SD'
	return None


def _classified_station_hits(hits, flags):
	"""Keep only real station roots: speed must change sign around the refined JD.

	The low-level scanner deliberately emits near-zero speed candidates so a
	refinement window is not missed for slow planets. Search rows, however, need
	ephemeris-style SR/SD events, not every low-speed sample around them.
	"""
	classified = []
	for hit in sorted(hits, key=lambda item: (int(item.planet), float(item.jd_ut), abs(float(item.speed)))):
		code = _station_code_for_planet_jd(int(hit.planet), float(hit.jd_ut), flags)
		if code not in SECONDARY_STATION_ASPECT_BY_CODE:
			continue
		classified.append((hit, code))

	deduped = []
	for hit, code in classified:
		replaced = False
		for idx, (existing_hit, existing_code) in enumerate(deduped):
			if (
				int(existing_hit.planet) == int(hit.planet)
				and existing_code == code
				and math.fabs(float(existing_hit.jd_ut) - float(hit.jd_ut)) <= STATION_DEDUPE_WINDOW_DAYS
			):
				if math.fabs(float(hit.speed)) < math.fabs(float(existing_hit.speed)):
					deduped[idx] = (hit, code)
				replaced = True
				break
		if not replaced:
			deduped.append((hit, code))
	return sorted(deduped, key=lambda item: (float(item[0].jd_ut), int(item[0].planet)))


def _apply_secondary_station_display_payload(row, radix, prom_obj, station_lon, station_speed, station_jd, station_code):
	prom_payload = _build_payload_for_object(radix, prom_obj, station_lon, station_speed, station_jd, True)
	if prom_payload is not None:
		prom_payload['motion_marker'] = station_code
		prom_payload['state_suffix'] = _format_state_suffix(station_code, prom_payload.get('dignity_code'))
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (prom_obj.label, prom_payload['state_suffix'])
	row.metadata['display_hydrated'] = True


def _search_secondary_directions_moon_solver(catalog, chrt, query, start_age, end_age, start_jd, end_jd, runtime=None, max_rows=None):
	rows = []
	calflag = _calendar_flag(chrt)
	context = _moon_crossing_context(chrt)
	birth_jd = float(chrt.time.jd)
	range_start = birth_jd + float(start_age)
	range_end = birth_jd + float(end_age)
	prom = catalog.get('planet:moon')
	if prom is None or 'planet:moon' not in query.promittor_ids:
		return rows

	for sig_id in query.significator_ids:
		sig = catalog.get(sig_id)
		if sig is None:
			continue
		for aspect_id in query.aspects:
			chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
			if chart_aspect is None:
				continue
			for target_lon in _aspect_target_longitudes(sig.longitude, chart_aspect):
				hits = transit_fast_api.search_longitude_transits(
					astrology.SE_MOON,
					float(range_start),
					float(range_end),
					[float(target_lon)],
					context=context,
				)
				for hit in hits:
					hit_jd = float(hit.jd_ut)
					if hit_jd < range_start or hit_jd >= range_end:
						continue
					event_info = _secondary_real_event_info_for_symbolic_age(chrt, hit_jd - birth_jd)
					if event_info is None:
						continue
					event_real_jd = _secondary_finalize_real_jd(
						catalog,
						chrt,
						'planet:moon',
						target_lon,
						event_info[0],
						start_jd,
						end_jd,
						runtime,
					)
					if event_real_jd >= start_jd and event_real_jd < end_jd:
						event_tuple = _jd_to_datetime_tuple(event_real_jd, calflag)
						event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
						event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
						row = searchquery.SearchResult(
							searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
							aspect_id,
							'planet:moon',
							sig_id
						)
						_fill_row_from_event(row, catalog, event_real_jd, event_tuple, event_date, event_time)
						row.metadata['display_datetime'] = event_tuple
						rows.append(row)
						if max_rows is not None and len(rows) >= int(max_rows):
							return rows

	return rows


def _search_secondary_directions_planet_batch(catalog, chrt, compiled, start_age, end_age, start_jd, end_jd, runtime=None, max_rows=None, skip_promittor_ids=None):
	skip = set(skip_promittor_ids or ())
	promittor_indices = []
	promittors_by_index = compiled.secondary_batch_promittors_by_index
	allowed_promittor_ids = set()
	for prom_id in compiled.secondary_batch_promittor_ids:
		if prom_id in skip:
			continue
		prom = catalog.get(prom_id)
		if prom is None or prom.planet_index is None:
			continue
		promittor_indices.append(prom.planet_index)
		allowed_promittor_ids.add(prom_id)
	if len(promittor_indices) == 0:
		return []

	target_map = {}
	target_longitudes = []
	seen_target_specs = set()
	for prom_id, sig_id, aspect_id, target_lon in compiled.static_targets:
		if prom_id not in allowed_promittor_ids:
			continue
		spec_key = (sig_id, aspect_id, round(float(target_lon), 12))
		if spec_key in seen_target_specs:
			continue
		seen_target_specs.add(spec_key)
		key = round(float(target_lon), 12)
		if key not in target_map:
			target_map[key] = []
			target_longitudes.append(float(target_lon))
		target_map[key].append((sig_id, aspect_id))
	if len(target_longitudes) == 0:
		return []

	birth_jd = float(chrt.time.jd)
	context = runtime.ephemeris_context(chrt) if runtime is not None else _planet_ephemeris_context(chrt)
	hits = transit_fast_api.search_longitude_transits_batch_raw(
		promittor_indices,
		birth_jd + float(start_age),
		birth_jd + float(end_age),
		target_longitudes,
		context=context,
	)
	rows = []
	for hit_jd, planet_idx, target_deg, _aspect_deg, _hit_kind, _speed, _retrograde in hits:
		prom_id = promittors_by_index.get(int(planet_idx))
		if prom_id is None:
			continue
		target_lon = float(target_deg)
		event_info = _secondary_real_event_info_for_symbolic_age(chrt, float(hit_jd) - birth_jd)
		if event_info is None:
			continue
		event_real_jd = _secondary_finalize_real_jd(
			catalog,
			chrt,
			prom_id,
			target_lon,
			event_info[0],
			start_jd,
			end_jd,
			runtime,
		)
		if event_real_jd < start_jd or event_real_jd >= end_jd:
			continue
		event_tuple = _jd_to_datetime_tuple(event_real_jd, _calendar_flag(chrt))
		event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
		event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
		for sig_id, aspect_id in target_map.get(round(float(target_deg), 12), ()):
			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
				aspect_id,
				prom_id,
				sig_id
			)
			_fill_row_from_event(row, catalog, event_real_jd, event_tuple, event_date, event_time)
			row.metadata['display_datetime'] = event_tuple
			rows.append(row)
			if max_rows is not None and len(rows) >= int(max_rows):
				return rows
	return rows


def _cheby_body_kind_for_promittor(prom, options):
	if prom is None:
		return None
	if prom.id == 'planet:asc_node' or prom.id == 'planet:desc_node':
		return cheby_progressions.KIND_NODE
	if prom.id == 'planet:chiron':
		return cheby_progressions.KIND_CHIRON
	angle_method = posfordate.progression_angle_method(
		getattr(options, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)
	)
	is_quotidian = angle_method == posfordate.MEAN_QUOTIDIAN_Q2
	if prom.id == 'angle:asc':
		return cheby_progressions.KIND_ANGLE_ASC_QUOTIDIAN if is_quotidian else cheby_progressions.KIND_ANGLE_ASC
	if prom.id == 'angle:mc':
		return cheby_progressions.KIND_ANGLE_MC_QUOTIDIAN if is_quotidian else cheby_progressions.KIND_ANGLE_MC
	if prom.id == 'point:lof':
		# LoF under MEAN_QUOTIDIAN_Q2 isn't supported by the fast path yet — falls
		# back to legacy via supported_body_id() returning False.
		return cheby_progressions.KIND_LOF
	if prom.planet_index == astrology.SE_MOON:
		return cheby_progressions.KIND_PLANET_FAST
	if prom.planet_index is not None and prom.planet_index in (
		astrology.SE_SUN, astrology.SE_MERCURY, astrology.SE_VENUS, astrology.SE_MARS,
		astrology.SE_JUPITER, astrology.SE_SATURN, astrology.SE_URANUS,
		astrology.SE_NEPTUNE, astrology.SE_PLUTO,
	):
		return cheby_progressions.KIND_PLANET_SLOW
	return None


def _search_secondary_directions_cheby(catalog, chrt, compiled, start_age, end_age, start_jd, end_jd, runtime=None, max_rows=None, method=posfordate.SECONDARY, recorder=None):
	"""Chebyshev fast-path: fit one polynomial per promittor over the whole symbolic-age
	span, then turn each (promittor, target longitude) pair into closed-form polynomial
	root finding. Returns (rows, handled_promittor_ids)."""
	if start_age >= end_age:
		return [], set()

	rec = recorder if recorder is not None else prog_log.Recorder('cheby_isolated')

	with rec.stage('cheby_select'):
		supported_targets = []
		supported_promittor_ids = set()
		body_specs = {}  # promittor_id -> (kind, planet_index)
		for prom_id, sig_id, aspect_id, target_lon in compiled.static_targets:
			prom = catalog.get(prom_id)
			if prom is None:
				continue
			kind = _cheby_body_kind_for_promittor(prom, chrt.options)
			if kind is None:
				continue
			if not cheby_progressions.supported_body_id(catalog, chrt.options, prom_id):
				continue
			body_specs[prom_id] = (kind, prom.planet_index)
			supported_targets.append((prom_id, sig_id, aspect_id, target_lon))
			supported_promittor_ids.add(prom_id)

	if len(supported_targets) == 0:
		return [], set()

	try:
		with rec.stage('cheby_fit'):
			fit = cheby_progressions.ProgressionFit(chrt, chrt.options, start_age, end_age, method=method)
			fit.fit_many(
				(
					(prom_id, kind, planet_index)
					for prom_id, (kind, planet_index) in body_specs.items()
				)
			)
	except Exception:
		return [], set()

	if prog_log.enabled():
		# Per-body fit breakdown — one line per body, sorted slowest first.
		timings = sorted(fit.fit_timings_ms.items(), key=lambda kv: -kv[1])
		for body_id, ms in timings[:8]:
			samples = fit.sample_counts.get(body_id, '?')
			prog_log.log('  fit %s: %.0fms (%s samples)' % (body_id, ms, samples))

	rows = []
	birth_jd = float(chrt.time.jd)
	calflag = _calendar_flag(chrt)
	# Group targets by (promittor, target_lon) so each unique aspect target is solved once.
	grouped = {}
	for prom_id, sig_id, aspect_id, target_lon in supported_targets:
		key = (prom_id, round(float(target_lon), 12))
		grouped.setdefault(key, []).append((sig_id, aspect_id, float(target_lon)))

	# Lazy finalize: skip the per-hit swisseph refinement during search. For
	# non-snap bodies (Sun, planets) the calendar-mapped approx_jd is already
	# exact. For snap-required bodies (Moon, Asc, MC, LoF) we attach
	# self-contained refinement metadata to each row, including a pre-computed
	# per-real-day speed from the cheby fit so refinement needs no fit reference
	# later. `cheby_refine_row(catalog, radix, row)` does the Newton step on
	# demand at hover / save-as-text time. This drops cheby_finalize from
	# O(hits × swisseph) to O(visible_rows × swisseph).
	roots_ms = 0.0
	finalize_ms = 0.0
	total_hits = 0
	scale = posfordate.progression_symbolic_scale(method) or 1.0
	for (prom_id, _target_key), specs in grouped.items():
		target_lon = specs[0][2]
		t0 = time.perf_counter()
		age_candidates = fit.find_aspect_hits(
			prom_id,
			target_lon,
			with_candidate_kinds=True,
		)
		roots_ms += (time.perf_counter() - t0) * 1000.0
		total_hits += len(age_candidates)
		needs_snap = _secondary_requires_real_snap(prom_id, catalog)
		t1 = time.perf_counter()
		candidates = []
		for age, is_tangent in age_candidates:
			event_info = _secondary_real_event_info_for_symbolic_age(chrt, float(age), method=method)
			if event_info is None:
				continue
			approx_jd = float(event_info[0])
			# Range filter uses approx_jd. For snap bodies the approx_jd error is
			# bounded by the cheby fit error (sub-arcsecond → sub-millisecond for
			# Moon, ≤ 90 sec for quotidian Asc/MC). At range-boundary precision
			# this is invisible.
			if approx_jd < start_jd or approx_jd >= end_jd:
				continue
			candidates.append((float(age), bool(is_tangent), event_info))

		for candidate_index, (age, is_tangent, event_info) in enumerate(candidates):
			approx_jd = float(event_info[0])
			event_tuple = _jd_to_datetime_tuple(approx_jd, calflag)
			event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
			event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
			prom_speed = fit.speed(prom_id, float(age))
			prom_motion_jd = birth_jd + float(age)
			previous_jd = (
				float(candidates[candidate_index - 1][2][0])
				if candidate_index > 0
				else float(start_jd)
			)
			next_jd = (
				float(candidates[candidate_index + 1][2][0])
				if candidate_index + 1 < len(candidates)
				else float(end_jd)
			)
			bracket_start_jd = max(
				float(start_jd),
				0.5 * (previous_jd + approx_jd) if candidate_index > 0 else float(start_jd),
			)
			bracket_end_jd = min(
				float(end_jd),
				0.5 * (approx_jd + next_jd)
				if candidate_index + 1 < len(candidates)
				else float(end_jd),
			)
			# Build the (small) lazy payloads that get attached to every row.
			# `cheby_lazy_display` carries everything cheby_apply_lazy_display()
			# needs to compute prom_display/sig_display on-demand at render time
			# — saves ~250ms on wide MINOR ranges by skipping per-row
			# `_apply_cheby_secondary_display_payloads` during the worker stage.
			lazy_display_payload = {
				'prom_id': prom_id,
				'target_lon': float(target_lon),
				'prom_speed': float(prom_speed) if prom_speed is not None else None,
				'prom_motion_jd': float(prom_motion_jd),
			}
			exact_candidate_payload = {
				'prom_id': prom_id,
				'target_lon': float(target_lon),
				'age': float(age),
				'method': int(method),
				'speed_per_real_day': (
					float(prom_speed) * float(scale) / 365.2425
					if prom_speed is not None
					else None
				),
				'bracket_start_jd': float(bracket_start_jd),
				'bracket_end_jd': float(bracket_end_jd),
				'candidate_radius_real_days': 0.25 * 365.2425 / max(float(scale), 1e-12),
				'is_tangent_candidate': bool(is_tangent),
			}
			eager_exact_jd = None
			if is_tangent:
				eager_exact_jd = _cheby_exact_candidate_jd(
					catalog,
					chrt,
					exact_candidate_payload,
					approx_jd,
					runtime=runtime,
				)
				if eager_exact_jd is None:
					continue
				approx_jd = float(eager_exact_jd)
				event_tuple = _jd_to_datetime_tuple(approx_jd, calflag)
				event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
				event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
			for sig_id, aspect_id, _t in specs:
				row = searchquery.SearchResult(
					searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
					aspect_id,
					prom_id,
					sig_id,
				)
				_fill_row_from_event(row, catalog, approx_jd, event_tuple, event_date, event_time)
				row.metadata['display_datetime'] = event_tuple
				# Defer the eager payload build — render path triggers it JIT.
				# Per-row dict copy + sig_id capture is the only worker cost now.
				row.metadata['cheby_lazy_display'] = dict(lazy_display_payload, sig_id=sig_id)
				# CRITICAL: mark cheby_hydrated=True so `_hydrate_result_display_payloads`
				# (called by the outer `search()` at line 283) skips these rows. Without
				# this, the hydrator falls back to its per-row `runtime.chart_for_event`
				# slow path which builds a full secondary chart per row — that's where the
				# "popup stuck on Calculating for MINOR 100-150y" regression came from.
				# Display payloads get materialised by cheby_apply_lazy_display() in the
				# renderer's _draw_row() — visible rows only.
				row.metadata['cheby_hydrated'] = True
				if eager_exact_jd is None:
					row.metadata['cheby_exact_candidate'] = dict(exact_candidate_payload)
					if (
						needs_snap
						and exact_candidate_payload['speed_per_real_day'] is not None
						and math.fabs(float(exact_candidate_payload['speed_per_real_day'])) > 1e-9
					):
						row.metadata['cheby_lazy'] = dict(exact_candidate_payload)
				rows.append(row)
				if max_rows is not None and len(rows) >= int(max_rows):
					finalize_ms += (time.perf_counter() - t1) * 1000.0
					rec.add('cheby_roots', roots_ms)
					rec.add('cheby_finalize', finalize_ms)
					rec.note('cheby_hits', total_hits)
					return rows, supported_promittor_ids
		finalize_ms += (time.perf_counter() - t1) * 1000.0

	rec.add('cheby_roots', roots_ms)
	rec.add('cheby_finalize', finalize_ms)
	rec.note('cheby_hits', total_hits)
	rec.note('cheby_lazy_pending', sum(1 for r in rows if 'cheby_lazy' in r.metadata))
	return rows, supported_promittor_ids


def _apply_cheby_secondary_display_payloads(row, radix_catalog, radix, prom_obj, prom_lon, prom_speed, prom_motion_jd, sig_id):
	"""Pre-populate prom_display / sig_display so _hydrate_result_display_payloads can
	skip the per-row secondary-chart build."""
	prom_payload = _secondary_aspect_motion_payload(
		_build_payload_for_object(radix, prom_obj, prom_lon, prom_speed, prom_motion_jd, True)
	)
	if prom_payload is not None:
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])

	sig_obj = radix_catalog.get(sig_id)
	if sig_obj is not None:
		sig_payload = _build_payload_for_object(
			radix,
			sig_obj,
			getattr(sig_obj, 'longitude', None),
			_object_chart_speed(radix, sig_obj),
			None,
			False,
		)
		if sig_payload is not None:
			row.metadata['sig_display'] = sig_payload
			if sig_payload.get('state_suffix'):
				row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])

	row.metadata['cheby_hydrated'] = True


def _search_secondary_directions_legacy(catalog, chrt, query, start_jd, end_jd, runtime=None):
	rows = []
	calflag = _calendar_flag(chrt)
	targets = _build_static_targets(catalog, query)
	current_jd = start_jd
	current_catalog = _build_secondary_catalog_for_jd_legacy(chrt, current_jd, runtime)

	while current_jd < end_jd:
		next_jd = min(current_jd + 1.0, end_jd)
		next_catalog = _build_secondary_catalog_for_jd_legacy(chrt, next_jd, runtime)

		for prom_id, sig_id, aspect_id, target_lon in targets:
			prom0 = current_catalog.get(prom_id)
			prom1 = next_catalog.get(prom_id)
			if prom0 is None or prom1 is None:
				continue

			delta0 = _signed_angular_delta(prom0.longitude, target_lon)
			delta1 = _signed_angular_delta(prom1.longitude, target_lon)
			if not _is_target_zero_crossing(delta0, delta1):
				continue

			exact_jd = _refine_exact_jd(
				current_jd,
				next_jd,
				lambda jd, oid=prom_id, lon=target_lon: _secondary_target_delta_legacy(chrt, oid, lon, jd, runtime)
			)
			if exact_jd < start_jd or exact_jd >= end_jd:
				continue

			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS,
				aspect_id,
				prom_id,
				sig_id
			)
			_fill_row_from_jd(row, catalog, exact_jd, calflag)
			row.metadata['display_datetime'] = (
				row.event_year, row.event_month, row.event_day,
				row.event_hour, row.event_minute, row.event_second
			)
			rows.append(row)

		current_jd = next_jd
		current_catalog = next_catalog

	return rows


def _search_primary_directions(catalog, chrt, query, start_jd, end_jd, runtime=None):
	if chrt is None or getattr(chrt.time, 'bc', False):
		return []

	cache_key = (
		id(chrt),
		tuple(query.promittor_ids),
		tuple(query.significator_ids),
		tuple(query.aspects),
	)
	context = None if runtime is None else runtime._primary_search_contexts.get(cache_key)
	if context is None:
		effective_options, selected_prom_ids, selected_sig_ids = _build_primary_search_options(chrt, catalog, query)
		if effective_options is None:
			return []

		original_cpd2 = getattr(chrt, 'cpd2', None)
		if getattr(effective_options, 'searchEcPd', False):
			chrt.cpd2 = None
		try:
			engine = _build_primary_engine(chrt, effective_options)
		finally:
			if getattr(effective_options, 'searchEcPd', False):
				chrt.cpd2 = original_cpd2
		context = (engine, selected_prom_ids, selected_sig_ids)
		if runtime is not None:
			runtime._primary_search_contexts[cache_key] = context
	else:
		engine, selected_prom_ids, selected_sig_ids = context
	if engine is None:
		return []

	calflag = _calendar_flag(chrt)
	rows = []
	for pd in getattr(engine, 'pds', []):
		if getattr(pd, 'time', None) is None:
			continue
		if pd.time < start_jd or pd.time >= end_jd:
			continue

		prom_id = _pd_object_id(catalog, pd.prom, getattr(pd, 'promdyn', None))
		sig_id = _pd_object_id(catalog, pd.sig, getattr(pd, 'sigdyn', None))
		if prom_id not in selected_prom_ids or sig_id not in selected_sig_ids:
			continue

		aspect_id = _pd_search_aspect_id(pd)
		if aspect_id is None or aspect_id not in query.aspects:
			continue

		row = searchquery.SearchResult(
			searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS,
			aspect_id,
			prom_id,
			sig_id
		)
		_fill_row_from_jd(row, catalog, pd.time, calflag)
		row.can_open_chart = False
		row.notes = '%s %s' % (
			mtexts.txts['M'] if getattr(pd, 'mundane', False) else mtexts.txts['Z'],
			mtexts.txts['D'] if getattr(pd, 'direct', True) else mtexts.txts['C'],
		)
		row.metadata['pd_direct'] = bool(getattr(pd, 'direct', True))
		row.metadata['pd_mundane'] = bool(getattr(pd, 'mundane', False))
		rows.append(row)

	return rows


def _search_mundane_weather(catalog, chrt, query, start_jd, end_jd, runtime=None, compiled=None):
	if compiled is None:
		compiled = _CompiledQuery(catalog, query)

	rows = []
	body_ids = compiled.weather_body_ids
	specs = compiled.weather_specs
	sign_change_prom_ids = [oid for oid in query.promittor_ids if _is_weather_object(catalog.get(oid))]
	if (len(body_ids) == 0 and len(sign_change_prom_ids) == 0) or (len(specs) == 0 and not getattr(query, 'include_sign_changes', False)):
		return rows

	body_objects = dict((oid, catalog.get(oid)) for oid in tuple(body_ids) + tuple([oid for oid in sign_change_prom_ids if oid not in body_ids]))
	body_codes_by_id = {}
	for body_id in body_ids:
		body_code = _weather_body_code(body_objects.get(body_id), chrt)
		body_codes_by_id[body_id] = body_code

	fast_specs = []
	legacy_specs = []
	for spec in specs:
		prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset = spec
		prom_code = body_codes_by_id.get(prom_id)
		sig_code = body_codes_by_id.get(sig_id)
		# Mixed weather queries should keep precise planet-planet pairs on the
		# fast solver even when Moon/nodes force legacy handling elsewhere.
		if prom_code is not None and sig_code is not None and _can_use_fast_weather_kernel((prom_code, sig_code)):
			fast_specs.append(spec)
		else:
			legacy_specs.append(spec)

	if len(fast_specs) != 0:
		rows.extend(_search_mundane_weather_specs_fast(catalog, chrt, start_jd, end_jd, runtime, body_objects, body_codes_by_id, fast_specs))
	if len(legacy_specs) != 0:
		# The cheby path covers the Moon/node cases the Cython kernel rejects.
		# Falls back to the 1-hour-step legacy loop only on env override or fit failure.
		cheby_rows = None
		if not _cheby_secondary_disabled():
			try:
				cheby_rows = _search_mundane_weather_specs_cheby(catalog, chrt, start_jd, end_jd, runtime, body_objects, legacy_specs)
			except Exception:
				cheby_rows = None
		if cheby_rows is None:
			rows.extend(_search_mundane_weather_specs_legacy(catalog, chrt, start_jd, end_jd, runtime, body_objects, legacy_specs))
		else:
			rows.extend(cheby_rows)

	return rows


def _search_mundane_weather_specs_cheby(catalog, chrt, start_jd, end_jd, runtime, body_objects_by_id, specs):
	"""Chebyshev fast path for body-pair aspect search. Replaces the 1-hour-step
	Python loop in `_search_mundane_weather_specs_legacy` for the Moon/node-pair
	cases the Cython kernel doesn't support.

	The polynomial fit brackets roots quickly; returned rows are then hydrated from
	the exact ephemeris state so motion markers still reflect node retrogrades and
	direct stations.
	"""
	rows = []
	if len(specs) == 0:
		return rows

	body_ids = []
	for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in specs:
		if prom_id not in body_ids:
			body_ids.append(prom_id)
		if sig_id not in body_ids:
			body_ids.append(sig_id)

	fit = cheby_transits.TransitFit(chrt, chrt.options, float(start_jd), float(end_jd))
	for body_id in body_ids:
		obj = body_objects_by_id.get(body_id)
		if obj is None:
			raise RuntimeError('cheby weather: unknown body %r' % (body_id,))
		fit.fit(body_id, obj.planet_index)

	calflag = _calendar_flag(chrt)
	for prom_id, sig_id, _prom_idx, _sig_idx, aspect_id, offset in specs:
		hits = fit.find_relative_aspect_hits(prom_id, sig_id, float(offset))
		for exact_jd in hits:
			if exact_jd < start_jd or exact_jd >= end_jd:
				continue
			exact_jd = _refine_cheby_weather_exact_jd(
				body_objects_by_id.get(prom_id),
				body_objects_by_id.get(sig_id),
				chrt,
				offset,
				exact_jd,
				start_jd,
				end_jd,
				fit.flags,
			)
			exact_prom = util.normalize(fit._evaluate_scalar(prom_id, exact_jd))
			exact_sig = util.normalize(fit._evaluate_scalar(sig_id, exact_jd))
			prom_speed = None
			sig_speed = None
			prom_state = _live_object_state_uncached(body_objects_by_id.get(prom_id), chrt, exact_jd, fit.flags)
			sig_state = _live_object_state_uncached(body_objects_by_id.get(sig_id), chrt, exact_jd, fit.flags)
			if prom_state is not None:
				exact_prom, prom_speed = prom_state
			if sig_state is not None:
				exact_sig, sig_speed = sig_state
			if _weather_aspect_error(aspect_id, exact_prom, exact_sig) > WEATHER_EVENT_EPSILON:
				continue
			if not _passes_traditional_filter(aspect_id, exact_prom, exact_sig, chrt.options):
				continue
			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
				aspect_id,
				prom_id,
				sig_id,
			)
			_fill_row_from_jd(row, catalog, exact_jd, calflag)
			_apply_cheby_weather_display_payloads(
				row, catalog, chrt, body_objects_by_id,
				prom_id, sig_id, exact_prom, exact_sig, exact_jd,
				prom_speed=prom_speed,
				sig_speed=sig_speed,
			)
			rows.append(row)
	return rows


def _refine_cheby_weather_exact_jd(prom_obj, sig_obj, chrt, offset, candidate_jd, start_jd, end_jd, flags):
	if prom_obj is None or sig_obj is None:
		return float(candidate_jd)

	def evaluate(event_jd):
		prom_lon = _live_object_longitude_uncached(prom_obj, chrt, event_jd, flags)
		sig_lon = _live_object_longitude_uncached(sig_obj, chrt, event_jd, flags)
		if prom_lon is None or sig_lon is None:
			return None
		return _dynamic_weather_delta(prom_lon, sig_lon, offset)

	def strict_crosses(delta0, delta1):
		if not ((delta0 < 0.0 < delta1) or (delta1 < 0.0 < delta0)):
			return False
		return abs(float(delta1) - float(delta0)) < 180.0

	def bisect_pair(pair_lo, pair_hi, pair_lo_val, pair_hi_val):
		lo = float(pair_lo)
		hi = float(pair_hi)
		lo_val = float(pair_lo_val)
		hi_val = float(pair_hi_val)
		best_jd = lo if abs(lo_val) <= abs(hi_val) else hi
		best_val = lo_val if abs(lo_val) <= abs(hi_val) else hi_val
		has_strict_bracket = strict_crosses(lo_val, hi_val)
		for _i in range(52):
			mid = (lo + hi) / 2.0
			mid_val = evaluate(mid)
			if mid_val is None:
				break
			if abs(mid_val) < abs(best_val):
				best_jd = mid
				best_val = mid_val
			if hi - lo <= 0.25 / 86400.0:
				return (lo + hi) / 2.0 if has_strict_bracket else best_jd
			if strict_crosses(lo_val, mid_val):
				hi = mid
				hi_val = mid_val
				has_strict_bracket = True
			elif strict_crosses(mid_val, hi_val):
				lo = mid
				lo_val = mid_val
				has_strict_bracket = True
			elif abs(lo_val) <= abs(hi_val):
				hi = mid
				hi_val = mid_val
			else:
				lo = mid
				lo_val = mid_val
		return (lo + hi) / 2.0 if has_strict_bracket else best_jd

	start = float(start_jd)
	end = float(end_jd)
	center = min(max(float(candidate_jd), start), end)
	center_val = evaluate(center)
	if center_val is None:
		return center

	best_jd = center
	best_val = center_val
	near_pairs = []
	for half_window in (1.0 / 24.0, 2.0 / 24.0, 6.0 / 24.0, 12.0 / 24.0):
		lo = max(start, center - half_window)
		hi = min(end, center + half_window)
		if hi <= lo:
			continue
		lo_val = evaluate(lo)
		hi_val = evaluate(hi)
		if lo_val is None or hi_val is None:
			continue
		for event_jd, value in ((lo, lo_val), (hi, hi_val)):
			if abs(value) < abs(best_val):
				best_jd = event_jd
				best_val = value

		pairs = ((lo, center, lo_val, center_val), (center, hi, center_val, hi_val), (lo, hi, lo_val, hi_val))
		for pair_lo, pair_hi, pair_lo_val, pair_hi_val in pairs:
			if strict_crosses(pair_lo_val, pair_hi_val):
				return bisect_pair(pair_lo, pair_hi, pair_lo_val, pair_hi_val)
		for pair_lo, pair_hi, pair_lo_val, pair_hi_val in pairs:
			if _is_relative_zero_crossing(pair_lo_val, pair_hi_val, EXACT_EPSILON):
				near_pairs.append((pair_lo, pair_hi, pair_lo_val, pair_hi_val))

	for pair_lo, pair_hi, pair_lo_val, pair_hi_val in near_pairs:
		refined = bisect_pair(pair_lo, pair_hi, pair_lo_val, pair_hi_val)
		refined_val = evaluate(refined)
		if refined_val is not None and abs(refined_val) < abs(best_val):
			return refined
	return best_jd


def _apply_cheby_weather_display_payloads(
	row, radix_catalog, radix, body_objects_by_id,
	prom_id, sig_id, prom_lon, sig_lon, event_jd,
	prom_speed=None, sig_speed=None,
):
	prom_obj = body_objects_by_id.get(prom_id)
	sig_obj = body_objects_by_id.get(sig_id)
	if prom_obj is not None:
		prom_payload = _build_payload_for_object(radix, prom_obj, prom_lon, prom_speed, event_jd, True)
		if prom_payload is not None:
			row.metadata['prom_display'] = prom_payload
			if prom_payload.get('state_suffix'):
				row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])
	if sig_obj is not None:
		sig_payload = _build_payload_for_object(radix, sig_obj, sig_lon, sig_speed, event_jd, True)
		if sig_payload is not None:
			row.metadata['sig_display'] = sig_payload
			if sig_payload.get('state_suffix'):
				row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])
	row.metadata['cheby_hydrated'] = True


def _search_mundane_weather_legacy(catalog, chrt, query, start_jd, end_jd, runtime=None, compiled=None):
	if compiled is None:
		compiled = _CompiledQuery(catalog, query)

	rows = []
	body_ids = compiled.weather_body_ids
	specs = compiled.weather_specs
	if len(body_ids) == 0 or len(specs) == 0:
		return rows
	body_objects = dict((oid, catalog.get(oid)) for oid in body_ids)
	return _search_mundane_weather_specs_legacy(catalog, chrt, start_jd, end_jd, runtime, body_objects, specs)


def _search_mundane_weather_specs_fast(catalog, chrt, start_jd, end_jd, runtime, body_objects_by_id, body_codes_by_id, specs):
	rows = []
	calflag = _calendar_flag(chrt)
	context = runtime.ephemeris_context(chrt) if runtime is not None else _planet_ephemeris_context(chrt)
	flags = context.flags
	subset_body_ids = []
	for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in specs:
		if prom_id not in subset_body_ids:
			subset_body_ids.append(prom_id)
		if sig_id not in subset_body_ids:
			subset_body_ids.append(sig_id)
	body_index = dict((oid, idx) for idx, oid in enumerate(subset_body_ids))
	body_codes = [body_codes_by_id[oid] for oid in subset_body_ids]
	native_specs = [(body_index[prom_id], body_index[sig_id], offset) for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in specs]
	hits = transit_fast_api.search_relative_aspects_batch_raw(
		body_codes,
		float(start_jd),
		float(end_jd),
		native_specs,
		ephe_path=context.ephe_path,
		context=context,
	)
	for exact_jd, spec_idx, _target_deg, _aspect_deg, _hit_kind, _hit_speed, _retrograde in hits:
		if exact_jd < start_jd or exact_jd >= end_jd:
			continue
		prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset = specs[int(spec_idx)]
		exact_prom = _live_object_longitude_uncached(body_objects_by_id[prom_id], chrt, exact_jd, flags)
		exact_sig = _live_object_longitude_uncached(body_objects_by_id[sig_id], chrt, exact_jd, flags)
		if _weather_aspect_error(aspect_id, exact_prom, exact_sig) > WEATHER_EVENT_EPSILON:
			continue
		if not _passes_traditional_filter(aspect_id, exact_prom, exact_sig, chrt.options):
			continue

		row = searchquery.SearchResult(
			searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
			aspect_id,
			prom_id,
			sig_id
		)
		_fill_row_from_jd(row, catalog, exact_jd, calflag)
		rows.append(row)
	return rows


def _search_mundane_weather_specs_legacy(catalog, chrt, start_jd, end_jd, runtime, body_objects_by_id, specs):
	rows = []
	body_ids = []
	for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in specs:
		if prom_id not in body_ids:
			body_ids.append(prom_id)
		if sig_id not in body_ids:
			body_ids.append(sig_id)
	body_objects = tuple(body_objects_by_id[oid] for oid in body_ids)
	body_index = dict((oid, idx) for idx, oid in enumerate(body_ids))
	remapped_specs = tuple((prom_id, sig_id, body_index[prom_id], body_index[sig_id], aspect_id, offset) for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in specs)
	flags = _planet_flags(chrt)
	current_jd = start_jd
	current_state = _live_planet_longitude_vector_uncached(body_objects, chrt, flags, current_jd)
	calflag = _calendar_flag(chrt)
	while current_jd < end_jd:
		next_jd = min(current_jd + 1.0/24.0, end_jd)
		next_state = _live_planet_longitude_vector_uncached(body_objects, chrt, flags, next_jd)

		for prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset in remapped_specs:
			lon0 = current_state[prom_idx]
			lon1 = next_state[prom_idx]
			sig0 = current_state[sig_idx]
			sig1 = next_state[sig_idx]
			if lon0 is None or lon1 is None or sig0 is None or sig1 is None:
				continue

			delta0 = _dynamic_weather_delta(lon0, sig0, offset)
			delta1 = _dynamic_weather_delta(lon1, sig1, offset)
			if not _is_relative_zero_crossing(delta0, delta1, EXACT_EPSILON) and abs(delta0) > EXACT_EPSILON and abs(delta1) > EXACT_EPSILON:
				continue

			exact_jd = _refine_weather_exact_jd(
				body_objects[prom_idx],
				body_objects[sig_idx],
				chrt,
				offset,
				current_jd,
				next_jd,
				delta0,
				delta1,
				runtime,
				flags
			)
			if exact_jd < start_jd or exact_jd >= end_jd:
				continue

			exact_prom = _live_object_longitude_uncached(body_objects[prom_idx], chrt, exact_jd, flags)
			exact_sig = _live_object_longitude_uncached(body_objects[sig_idx], chrt, exact_jd, flags)
			if _weather_aspect_error(aspect_id, exact_prom, exact_sig) > WEATHER_EVENT_EPSILON:
				continue
			if not _passes_traditional_filter(aspect_id, exact_prom, exact_sig, chrt.options):
				continue

			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
				aspect_id,
				prom_id,
				sig_id
			)
			_fill_row_from_jd(row, catalog, exact_jd, calflag)
			rows.append(row)

		current_jd = next_jd
		current_state = next_state

	return rows


def _sign_change_planet_targets(obj, chrt):
	if obj is None or obj.planet_index is None:
		return None, (), {}
	target_shift = 0.0
	planet_id = int(obj.planet_index)
	if obj.id == 'planet:asc_node':
		planet_id = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
	elif obj.id == 'planet:desc_node':
		planet_id = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
		target_shift = 180.0
	elif obj.family not in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE):
		return None, (), {}
	targets = []
	target_to_sign = {}
	for sign_index in range(chart.Chart.SIGN_NUM):
		display_target = float(sign_index * chart.Chart.SIGN_DEG)
		search_target = util.normalize(display_target - target_shift)
		key = round(search_target, 12)
		targets.append(search_target)
		target_to_sign[key] = sign_index
	return planet_id, targets, target_to_sign


def _sign_change_pair(target_sign_index, speed):
	target_sign_index = int(target_sign_index) % chart.Chart.SIGN_NUM
	if float(speed) < 0.0:
		return target_sign_index, (target_sign_index - 1) % chart.Chart.SIGN_NUM
	return (target_sign_index - 1) % chart.Chart.SIGN_NUM, target_sign_index


def _sign_change_metadata(left_sign, right_sign, speed):
	left_sign = int(left_sign) % chart.Chart.SIGN_NUM
	right_sign = int(right_sign) % chart.Chart.SIGN_NUM
	retrograde = float(speed) < 0.0
	if retrograde:
		event_kind = 'leave'
		event_sign = left_sign
	else:
		event_kind = 'enter'
		event_sign = right_sign
	event_label = '%s %s%s' % (
		mtexts.txts.get('Leaves', 'leaves') if retrograde else mtexts.txts.get('Enters', 'enters'),
		mtexts.signs[event_sign],
		' (R)' if retrograde else '',
	)
	return {
		'sign_change': True,
		'sign_pair': (left_sign, right_sign),
		'sign_change_kind': event_kind,
		'sign_change_retrograde': retrograde,
		'sign_change_from': left_sign,
		'sign_change_to': right_sign,
		'sign_change_event_sign': event_sign,
		'sign_change_event_label': event_label,
	}


def _weather_sign_payload(sign_index, chrt):
	sign_index = int(sign_index) % chart.Chart.SIGN_NUM
	return {
		'longitude': float(sign_index * chart.Chart.SIGN_DEG),
		'display_longitude': float(sign_index * chart.Chart.SIGN_DEG),
		'lon_text': '',
		'glyph_color': common.get_sign_color(chrt.options, sign_index, force_element=True),
		'motion_marker': '',
		'dignity_code': None,
		'state_suffix': '',
		'is_live': False,
		'sign_index': sign_index,
		'label': mtexts.signs[sign_index],
	}


def _heliacal_promittors(catalog, promittor_ids):
	promittors = []
	seen = set()
	allowed = set(phasiscalc.PLANET_IDS)
	for prom_id in promittor_ids:
		if prom_id in seen:
			continue
		seen.add(prom_id)
		prom = catalog.get(prom_id)
		if prom is None or prom.planet_index is None:
			if prom is not None and prom.family == searchcatalog.SearchObject.FAMILY_FIXED_STAR:
				code = str(getattr(prom, 'fixedstar_code', '') or prom_id.replace('fixstar:', '', 1)).strip()
				if code:
					promittors.append(('fixstar', code, prom_id))
			continue
		planet_idx = int(prom.planet_index)
		if planet_idx not in allowed:
			continue
		promittors.append(('planet', planet_idx, prom_id))
	return promittors


def _heliacal_calculation_place_payload(chrt):
	place = getattr(chrt, 'place', None)
	return {
		'basis': 'chart_place',
		'name': str(getattr(place, 'place', '') or ''),
		'longitude': float(getattr(place, 'lon', 0.0) or 0.0),
		'latitude': float(getattr(place, 'lat', 0.0) or 0.0),
		'altitude_m': float(getattr(place, 'altitude', 0.0) or 0.0),
	}


def _search_heliacal_phases(catalog, chrt, promittor_ids, start_jd, end_jd, runtime):
	if runtime is None:
		runtime = _SearchRuntime()
	rows = []
	calflag = _calendar_flag(chrt)
	phasis_mode = phasiscalc._normalize_phasis_mode(
		getattr(getattr(chrt, 'options', None), 'phasismode', phasiscalc.PHASIS_MODE_SIMPLE_SWEP)
	)
	calculation_place = _heliacal_calculation_place_payload(chrt)
	for kind, target, prom_id in _heliacal_promittors(catalog, promittor_ids):
		try:
			if kind == 'fixstar':
				events = list(phasiscalc.iter_swe_heliacal_fixstar_events(chrt, target, start_jd, end_jd))
			else:
				events = list(phasiscalc.iter_heliacal_planet_events(chrt, target, start_jd, end_jd, mode=phasis_mode))
		except Exception:
			events = []
		for event in events:
			code = event.get('code')
			aspect_id = HELIACAL_ASPECT_BY_CODE.get(code)
			if aspect_id is None:
				continue
			event_jd = float(event.get('event_jd'))
			row = searchquery.SearchResult(
				searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES,
				aspect_id,
				prom_id,
				''
			)
			_fill_row_from_jd(row, catalog, event_jd, calflag)
			row.significator_label = ''
			row.notes = radixsignals.format_signal_label(code)
			row.event_label = row.notes
			row.metadata['heliacal'] = True
			row.metadata['heliacal_code'] = code
			default_method = phasiscalc.HELIACAL_METHOD_SWISS
			default_method_label = 'Swiss Ephemeris'
			if kind != 'fixstar':
				if int(phasis_mode) == phasiscalc.PHASIS_MODE_HELLENISTIC:
					default_method = phasiscalc.HELIACAL_METHOD_HELLENISTIC
					default_method_label = 'Hellenistic 15 deg elongation'
				elif int(phasis_mode) == phasiscalc.PHASIS_MODE_ASTRONOMICAL:
					default_method = phasiscalc.HELIACAL_METHOD_ASTRONOMICAL
					default_method_label = 'Astronomical'
				elif int(phasis_mode) == phasiscalc.PHASIS_MODE_ARCUS_VISIONIS:
					default_method = phasiscalc.HELIACAL_METHOD_ARCUS_VISIONIS
					default_method_label = 'Arcus visionis'
			row.metadata['heliacal_method'] = event.get('heliacal_method') or default_method
			row.metadata['heliacal_method_label'] = event.get('heliacal_method_label') or default_method_label
			if kind == 'fixstar':
				row.metadata['heliacal_requested_phasis_mode'] = int(phasis_mode)
				if int(phasis_mode) != phasiscalc.PHASIS_MODE_SIMPLE_SWEP:
					row.metadata['heliacal_method_fallback'] = 'fixed_star_swiss'
			if event.get('phasis_mode') is not None:
				row.metadata['phasis_mode'] = event.get('phasis_mode')
				row.metadata['phasis_mode_label'] = event.get('phasis_mode_label')
			if event.get('heliacal_threshold_deg') is not None:
				row.metadata['heliacal_threshold_deg'] = event.get('heliacal_threshold_deg')
			if event.get('heliacal_arcus_visionis_deg') is not None:
				row.metadata['heliacal_arcus_visionis_deg'] = event.get('heliacal_arcus_visionis_deg')
			if event.get('heliacal_arcus_source') is not None:
				row.metadata['heliacal_arcus_source'] = event.get('heliacal_arcus_source')
			row.metadata['heliacal_calculation_place'] = dict(calculation_place)
			row.metadata['heliacal_place_basis'] = calculation_place.get('basis')
			row.metadata['exact_event_jd'] = event_jd
			row.metadata['exact_event_datetime'] = _jd_to_datetime_tuple(event_jd, calflag)
			row.metadata['heliacal_optimum_jd'] = event.get('optimum_jd')
			row.metadata['heliacal_end_jd'] = event.get('end_jd')
			row.metadata['heliacal_duration_minutes'] = event.get('duration_minutes')
			row.metadata['heliacal_atmospheric_extinction'] = event.get('atmospheric_extinction')
			if event.get('date_only'):
				row.metadata['date_only'] = True
				row.event_time = ''
			prom = catalog.get(prom_id)
			if kind == 'fixstar':
				row.metadata['fixstar_code'] = target
				_apply_heliacal_fixstar_display_payload(row, chrt, prom, target, event_jd)
			else:
				state = runtime.live_object_state(prom, chrt, event_jd) if prom is not None else None
				if state is not None:
					planet_lon, planet_speed = state
				else:
					planet_lon, planet_speed = getattr(prom, 'longitude', None), None
				_apply_heliacal_display_payload(row, chrt, prom, planet_lon, planet_speed, event_jd)
			row.metadata['display_hydrated'] = True
			rows.append(row)
	return rows


def _search_lunations(catalog, chrt, query, start_jd, end_jd, runtime, eclipses_only=False):
	"""Search orb-close New/Full Moons or eclipses against radix points."""
	if runtime is None:
		runtime = _SearchRuntime()
	moon_id = 'planet:moon'
	sun_id = 'planet:sun'
	moon = catalog.get(moon_id)
	if moon is None:
		return []

	if catalog.get(sun_id) is None:
		return []

	phase_query = searchquery.SearchQuery()
	phase_query.set_promittor_ids([moon_id])
	phase_query.set_significator_ids([sun_id])
	phase_query.set_aspects([searchquery.SearchQuery.ASPECT_CONJUNCTION, searchquery.SearchQuery.ASPECT_OPPOSITION])
	phase_query.set_techniques([searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER])
	phase_rows = _search_mundane_weather(catalog, chrt, phase_query, start_jd, end_jd, runtime, _CompiledQuery(catalog, phase_query))
	try:
		eclipse_events = eclipses.find_eclipses_in_range(chrt, start_jd, end_jd)
	except Exception:
		eclipse_events = []

	calflag = _calendar_flag(chrt)
	orb = float(getattr(query, 'lunation_orb', 3.0))
	rows = []
	for phase_row in phase_rows:
		if {phase_row.promittor_id, phase_row.significator_id} != {moon_id, sun_id} or phase_row.event_jd is None:
			continue
		event_jd = float(phase_row.event_jd)
		moon_lon = runtime.live_object_longitude(moon, chrt, event_jd)
		if moon_lon is None:
			continue
		kind = 'new' if phase_row.aspect == searchquery.SearchQuery.ASPECT_CONJUNCTION else 'full'
		eclipse_event = min(
			(event for event in eclipse_events if bool(getattr(event, 'is_solar', False)) == (kind == 'new')),
			key=lambda event: abs(float(eclipses.syzygy_jdut_for_event(event) or 0.0) - event_jd),
			default=None,
		)
		if eclipse_event is not None:
			eclipse_jd = eclipses.syzygy_jdut_for_event(eclipse_event)
			if eclipse_jd is None or abs(float(eclipse_jd) - event_jd) > 1.0 / 24.0:
				eclipse_event = None
		if eclipses_only and eclipse_event is None:
			continue

		for sig_id in query.significator_ids:
			sig = catalog.get(sig_id)
			if sig is None or getattr(sig, 'longitude', None) is None:
				continue
			separation = abs(((float(moon_lon) - float(sig.longitude) + 180.0) % 360.0) - 180.0)
			for aspect_id in query.aspects:
				chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
				if chart_aspect is None:
					continue
				contact_orb = abs(separation - float(chart.Chart.Aspects[chart_aspect]))
				if contact_orb > orb:
					continue
				technique = (
					searchquery.SearchQuery.TECHNIQUE_ECLIPSES
					if eclipses_only
					else searchquery.SearchQuery.TECHNIQUE_LUNATIONS
				)
				row = searchquery.SearchResult(technique, aspect_id, moon_id, sig_id)
				_fill_row_from_jd(row, catalog, event_jd, calflag)
				row.metadata['lunation'] = True
				row.metadata['lunation_kind'] = kind
				row.metadata['lunation_contact_orb'] = contact_orb
				row.metadata['lunation_orb_limit'] = orb
				if eclipse_event is not None:
					row.metadata['eclipse'] = True
					row.metadata['eclipse_kind'] = 'solar' if kind == 'new' else 'lunar'
					row.metadata['eclipse_classification'] = radixsignals._eclipse_kind_label(eclipse_event)
					row.metadata['eclipse_saros'] = getattr(eclipse_event, 'saros', None)
					luminary = mtexts.txts.get('EclipseSolar' if kind == 'new' else 'EclipseLunar', 'Solar' if kind == 'new' else 'Lunar')
					row.notes = mtexts.txts.get('EclipseLabelFormat', '{kind} {luminary} Eclipse').format(kind=row.metadata['eclipse_classification'], luminary=luminary).strip()
				else:
					row.notes = mtexts.txts.get('NewMoon' if kind == 'new' else 'FullMoon', 'New Moon' if kind == 'new' else 'Full Moon')
				row.event_label = row.notes
				rows.append(row)
	return rows


def _apply_heliacal_display_payload(row, chrt, prom, longitude, speed_lon, event_jd):
	if prom is None:
		return
	display_longitude = _display_longitude_for_chart(chrt, longitude)
	motion_marker = ''
	if prom.planet_index is not None:
		motion_marker = radixsignals.get_motion_marker_for_speed(
			event_jd,
			prom.planet_index,
			speed_lon,
			within_days=DISPLAY_STATION_WINDOW_DAYS,
			options=getattr(chrt, 'options', None),
		)
	dignity_code = _dignity_code_for_longitude(chrt, prom, longitude)
	row.metadata['prom_display'] = {
		'longitude': longitude,
		'display_longitude': display_longitude,
		'speed_lon': speed_lon,
		'lon_text': _format_compact_longitude(display_longitude),
		'glyph_color': _glyph_color_for_dignity(chrt, prom, dignity_code),
		'motion_marker': motion_marker,
		'dignity_code': dignity_code,
		'state_suffix': _format_state_suffix(motion_marker, dignity_code),
		'is_live': True,
	}
	if row.metadata['prom_display'].get('state_suffix'):
		row.promittor_label = '%s%s' % (row.promittor_label, row.metadata['prom_display']['state_suffix'])


def _fixstar_longitude_at_jd(star_code, event_jd):
	try:
		ret, _name, dat, _serr = astrology.swe_fixstar_ut(',' + str(star_code).lstrip(','), float(event_jd), astrology.SEFLG_SWIEPH)
		if int(ret) < 0:
			return None
		return float(dat[0])
	except Exception:
		return None


def _apply_heliacal_fixstar_display_payload(row, chrt, prom, star_code, event_jd):
	if prom is None:
		return
	longitude = _fixstar_longitude_at_jd(star_code, event_jd)
	if longitude is not None and getattr(chrt.options, 'ayanamsha', 0) != 0:
		longitude = util.normalize(
			longitude - astrology.effective_ayanamsha_ut(
				float(event_jd), chrt.options.ayanamsha,
			)
		)
	if longitude is None:
		longitude = getattr(prom, 'longitude', None)
	display_longitude = _display_longitude_for_chart(chrt, longitude)
	row.metadata['prom_display'] = {
		'longitude': longitude,
		'display_longitude': display_longitude,
		'speed_lon': None,
		'lon_text': _format_compact_longitude(display_longitude),
		'glyph_color': getattr(chrt.options, 'clrtexts', None),
		'motion_marker': '',
		'dignity_code': None,
		'state_suffix': '',
		'is_live': True,
	}


def _search_sign_change_rows(catalog, chrt, promittor_ids, start_jd, end_jd, technique):
	rows = []
	calflag = _calendar_flag(chrt)
	context = _planet_ephemeris_context(chrt)

	for prom_id in promittor_ids:
		prom = catalog.get(prom_id)
		if not _is_weather_object(prom):
			continue
		planet_id, targets, target_to_sign = _sign_change_planet_targets(prom, chrt)
		if planet_id is None or len(targets) == 0:
			continue
		hits = transit_fast_api.search_longitude_transits(
			planet_id,
			float(start_jd),
			float(end_jd),
			targets,
			context=context,
		)
		for hit in hits:
			target_sign = target_to_sign.get(round(float(hit.target_deg), 12))
			if target_sign is None:
				continue
			left_sign, right_sign = _sign_change_pair(target_sign, hit.speed)
			exact_jd = float(hit.jd_ut)
			exact_tuple = _jd_to_datetime_tuple(exact_jd, calflag)
			event_jd, event_tuple = _sign_change_chart_parity_event(exact_jd, calflag)
			event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
			event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
			row = searchquery.SearchResult(
				technique,
				searchquery.SearchQuery.ASPECT_SIGN_CHANGE,
				prom_id,
				'sign:%02d' % right_sign
			)
			_fill_row_from_event(row, catalog, event_jd, event_tuple, event_date, event_time)
			row.significator_label = '%s|%s' % (mtexts.signs[left_sign], mtexts.signs[right_sign])
			row.metadata.update(_sign_change_metadata(left_sign, right_sign, hit.speed))
			row.metadata['exact_event_jd'] = exact_jd
			row.metadata['exact_event_datetime'] = exact_tuple
			row.event_label = row.metadata.get('sign_change_event_label', '')
			row.metadata['sig_display'] = _weather_sign_payload(right_sign, chrt)
			rows.append(row)

	return rows


def _search_station_rows(catalog, chrt, promittor_ids, start_jd, end_jd, technique, runtime):
	if runtime is None:
		runtime = _SearchRuntime()
	station_promittors = _secondary_station_promittors(catalog, promittor_ids)
	if len(station_promittors) == 0:
		return []

	context = runtime.ephemeris_context(chrt)
	flags = context.flags
	planet_ids = [planet_idx for planet_idx, _prom_id in station_promittors]
	promittor_by_planet = dict(station_promittors)
	try:
		hits = transit_fast_api.search_station_times_batch(
			planet_ids,
			float(start_jd),
			float(end_jd),
			context=context,
		)
	except Exception:
		hits = []
		for planet_idx in planet_ids:
			try:
				hits.extend(transit_fast_api.search_station_times(
					planet_idx,
					float(start_jd),
					float(end_jd),
					context=context,
				))
			except Exception:
				continue

	rows = []
	calflag = _calendar_flag(chrt)
	for hit, code in _classified_station_hits(hits, flags):
		planet_idx = int(hit.planet)
		prom_id = promittor_by_planet.get(planet_idx)
		if prom_id is None:
			continue
		station_jd = float(hit.jd_ut)
		aspect_id = SECONDARY_STATION_ASPECT_BY_CODE.get(code, searchquery.SearchQuery.ASPECT_STATION)
		prom = catalog.get(prom_id)
		if prom is None:
			continue
		row = searchquery.SearchResult(
			technique,
			aspect_id,
			prom_id,
			''
		)
		_fill_row_from_jd(row, catalog, station_jd, calflag)
		row.significator_label = ''
		row.notes = radixsignals.format_signal_label(code)
		row.event_label = row.notes
		row.metadata['station'] = True
		row.metadata['station_code'] = code
		row.metadata['exact_event_jd'] = station_jd
		row.metadata['exact_event_datetime'] = _jd_to_datetime_tuple(station_jd, calflag)
		state = runtime.live_object_state(prom, chrt, station_jd)
		if state is not None:
			station_lon, station_speed = state
		else:
			station_lon, station_speed = getattr(prom, 'longitude', None), float(hit.speed)
		_apply_secondary_station_display_payload(row, chrt, prom, station_lon, station_speed, station_jd, code)
		rows.append(row)
	return rows


def _search_cazimi_rows(
	catalog,
	chrt,
	promittor_ids,
	start_jd,
	end_jd,
	technique,
	runtime,
	*,
	respect_mode=True,
):
	if runtime is None:
		runtime = _SearchRuntime()
	sun_id = 'planet:sun'
	sun = catalog.get(sun_id)
	if sun is None or sun.planet_index is None:
		return []

	promittors = _cazimi_promittors(catalog, chrt, promittor_ids)
	if len(promittors) == 0:
		return []

	body_ids = []
	for _planet_idx, prom_id in promittors:
		if prom_id not in body_ids:
			body_ids.append(prom_id)
	if sun_id not in body_ids:
		body_ids.append(sun_id)
	body_index = dict((oid, idx) for idx, oid in enumerate(body_ids))
	body_objects = dict((oid, catalog.get(oid)) for oid in body_ids)
	body_codes_by_id = dict((oid, _weather_body_code(body_objects.get(oid), chrt)) for oid in body_ids)

	specs = []
	for _planet_idx, prom_id in promittors:
		specs.append((
			prom_id,
			sun_id,
			body_index[prom_id],
			body_index[sun_id],
			searchquery.SearchQuery.ASPECT_CONJUNCTION,
			0.0,
		))
	if len(specs) == 0:
		return []

	fast_specs = []
	legacy_specs = []
	for spec in specs:
		prom_id, sig_id, _prom_idx, _sig_idx, _aspect_id, _offset = spec
		prom_code = body_codes_by_id.get(prom_id)
		sig_code = body_codes_by_id.get(sig_id)
		if prom_code is not None and sig_code is not None and _can_use_fast_weather_kernel((prom_code, sig_code)):
			fast_specs.append(spec)
		else:
			legacy_specs.append(spec)

	raw_rows = []
	if len(fast_specs) != 0:
		raw_rows.extend(_search_mundane_weather_specs_fast(catalog, chrt, start_jd, end_jd, runtime, body_objects, body_codes_by_id, fast_specs))
	if len(legacy_specs) != 0:
		cheby_rows = None
		if not _cheby_secondary_disabled():
			try:
				cheby_rows = _search_mundane_weather_specs_cheby(catalog, chrt, start_jd, end_jd, runtime, body_objects, legacy_specs)
			except Exception:
				cheby_rows = None
		if cheby_rows is None:
			raw_rows.extend(_search_mundane_weather_specs_legacy(catalog, chrt, start_jd, end_jd, runtime, body_objects, legacy_specs))
		else:
			raw_rows.extend(cheby_rows)

	rows = []
	mode = radixsignals._normalize_cazimi_mode(getattr(chrt.options, 'cazimimode', radixsignals.CAZIMI_MODE_HELLENISTIC))
	calflag = _calendar_flag(chrt)
	for row in raw_rows:
		prom = catalog.get(row.promittor_id)
		sig = catalog.get(row.significator_id)
		match = _cazimi_event_match(
			chrt,
			prom,
			sig,
			row.event_jd,
			mode,
			respect_mode=respect_mode,
		)
		if match is None:
			continue
		row.technique = technique
		row.aspect = searchquery.SearchQuery.ASPECT_CAZIMI
		row.notes = mtexts.txts.get('Cazimi', 'Cazimi')
		row.event_label = mtexts.txts.get('Cazimi', 'Cazimi')
		row.metadata['cazimi'] = True
		row.metadata['cazimi_mode'] = mode
		row.metadata['cazimi_lon_delta'] = match[0]
		row.metadata['cazimi_lat_delta'] = match[1]
		row.metadata['exact_event_jd'] = row.event_jd
		row.metadata['exact_event_datetime'] = _jd_to_datetime_tuple(row.event_jd, calflag)
		_apply_live_pair_row_display_payloads(row, catalog, chrt, runtime)
		row.metadata['display_hydrated'] = True
		rows.append(row)
	return rows


def _cazimi_promittors(catalog, chrt, promittor_ids):
	promittors = []
	seen = set()
	allowed = set(radixsignals.CAZIMI_BODY_IDS)
	for prom_id in promittor_ids:
		if prom_id in seen:
			continue
		seen.add(prom_id)
		prom = catalog.get(prom_id)
		if prom is None or prom.planet_index is None:
			continue
		planet_idx = int(prom.planet_index)
		if planet_idx == astrology.SE_SUN or planet_idx not in allowed:
			continue
		promittors.append((planet_idx, prom_id))
	return promittors


def _cazimi_event_match(
	chrt,
	prom,
	sun,
	event_jd,
	mode,
	*,
	respect_mode=True,
):
	if prom is None or sun is None:
		return None
	flags = _planet_flags(chrt)
	prom_state = _live_object_lon_lat_state_uncached(prom, chrt, event_jd, flags)
	sun_state = _live_object_lon_lat_state_uncached(sun, chrt, event_jd, flags)
	if prom_state is None or sun_state is None:
		return None
	lon_delta = radixsignals._angular_distance(prom_state[0], sun_state[0])
	lat_delta = abs(float(prom_state[1]) - float(sun_state[1]))
	if not respect_mode:
		return lon_delta, lat_delta
	if mode == radixsignals.CAZIMI_MODE_HELLENISTIC:
		matches = lon_delta <= radixsignals.CAZIMI_HELLENISTIC_ORB_DEG
	elif mode == radixsignals.CAZIMI_MODE_ABU_MASHAR:
		matches = lon_delta <= radixsignals.CAZIMI_SIXTEEN_MIN_ORB_DEG
	else:
		matches = lon_delta <= radixsignals.CAZIMI_SIXTEEN_MIN_ORB_DEG and lat_delta <= radixsignals.CAZIMI_SIXTEEN_MIN_ORB_DEG
	if not matches:
		return None
	return lon_delta, lat_delta


def _sign_change_technique(query):
	if not getattr(query, 'include_sign_changes', False):
		return None
	return searchquery.SearchQuery.TECHNIQUE_INGRESS_SYNODIC


def _fill_row_from_jd(row, catalog, event_jd, calflag):
	event_tuple = _jd_to_datetime_tuple(event_jd, calflag)
	event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
	event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
	_fill_row_from_event(row, catalog, event_jd, event_tuple, event_date, event_time)


def _fill_row_from_event(row, catalog, event_jd, event_tuple, event_date, event_time):
	prom = catalog.get(row.promittor_id)
	sig = catalog.get(row.significator_id)
	year, month, day, hour, minute, second = event_tuple

	row.promittor_label = prom.label if prom is not None else row.promittor_id
	row.significator_label = sig.label if sig is not None else row.significator_id
	row.event_jd = event_jd
	row.event_year = year
	row.event_month = month
	row.event_day = day
	row.event_hour = hour
	row.event_minute = minute
	row.event_second = second
	row.event_date = event_date
	row.event_time = event_time
	row.can_open_chart = True
	row.can_export_time = True
	row.can_export_ics = True


def _event_tuple_from_row(row):
	return (
		row.event_year, row.event_month, row.event_day,
		row.event_hour, row.event_minute, row.event_second
	)


def _apply_row_display_payloads(row, radix_catalog, prom_chart, prom_jd, prom_is_live, sig_chart, sig_jd, sig_is_live, runtime=None, prom_payload_transform=None):
	prom_payload = _build_row_object_display(radix_catalog, row.promittor_id, prom_chart, prom_jd, prom_is_live, runtime)
	sig_payload = _build_row_object_display(radix_catalog, row.significator_id, sig_chart, sig_jd, sig_is_live, runtime)

	if prom_payload is not None:
		if prom_payload_transform is not None:
			prom_payload = prom_payload_transform(prom_payload)
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])

	if sig_payload is not None:
		row.metadata['sig_display'] = sig_payload
		if sig_payload.get('state_suffix'):
			row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])


def _apply_transit_row_display_payloads(row, radix_catalog, chrt, runtime):
	if row.metadata.get('sign_change'):
		_apply_sign_change_row_display_payloads(row, radix_catalog, chrt, runtime)
		return

	prom_jd = row.metadata.get('converse_transit_jd', row.event_jd)
	prom_payload = _build_live_row_object_display(radix_catalog, row.promittor_id, chrt, prom_jd, runtime)
	sig_payload = _build_static_row_object_display(radix_catalog, row.significator_id, chrt)

	if prom_payload is not None:
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])

	if sig_payload is not None:
		row.metadata['sig_display'] = sig_payload
		if sig_payload.get('state_suffix'):
			row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])


def _apply_sign_change_row_display_payloads(row, radix_catalog, chrt, runtime):
	prom = radix_catalog.get(row.promittor_id)
	sign_pair = row.metadata.get('sign_pair')
	if prom is None or sign_pair is None:
		return

	state = runtime.live_object_state(prom, chrt, row.event_jd) if runtime is not None else None
	if state is None:
		return

	longitude = float(state[0])
	speed_lon = float(state[1])
	entered_sign = int(sign_pair[1]) % chart.Chart.SIGN_NUM
	display_longitude = _display_longitude_for_chart(chrt, longitude)
	motion_marker = ''
	if prom.planet_index is not None:
		motion_marker = radixsignals.get_motion_marker_for_speed(
			row.event_jd,
			prom.planet_index,
			speed_lon,
			within_days=DISPLAY_STATION_WINDOW_DAYS,
			options=getattr(chrt, 'options', None),
		)
	dignity_code = _dignity_code_for_longitude(chrt, prom, longitude)

	row.metadata['prom_display'] = {
		'longitude': longitude,
		'display_longitude': display_longitude,
		'speed_lon': speed_lon,
		'lon_text': _format_compact_longitude(display_longitude),
		'glyph_color': _glyph_color_for_dignity(chrt, prom, dignity_code),
		'motion_marker': motion_marker,
		'dignity_code': dignity_code,
		'state_suffix': _format_state_suffix(motion_marker, dignity_code),
		'is_live': True,
	}
	row.metadata['sig_display'] = _weather_sign_payload(entered_sign, chrt)


def _apply_live_pair_row_display_payloads(row, radix_catalog, chrt, runtime):
	if row.metadata.get('sign_change'):
		_apply_sign_change_row_display_payloads(row, radix_catalog, chrt, runtime)
		return

	prom_payload = _build_live_row_object_display(radix_catalog, row.promittor_id, chrt, row.event_jd, runtime)
	sig_payload = _build_live_row_object_display(radix_catalog, row.significator_id, chrt, row.event_jd, runtime)

	if prom_payload is not None:
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])

	if sig_payload is not None:
		row.metadata['sig_display'] = sig_payload
		if sig_payload.get('state_suffix'):
			row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])


def _build_row_object_display(radix_catalog, object_id, display_chart, event_jd, is_live, runtime=None):
	if display_chart is None:
		return None

	if runtime is not None:
		display_catalog = runtime.catalog_for_chart(display_chart, radix_catalog)
	else:
		display_catalog = searchcatalog.SearchCatalog(display_chart)
	obj = display_catalog.get(object_id)
	if obj is None:
		obj = radix_catalog.get(object_id)
	if obj is None:
		return None

	longitude = getattr(obj, 'longitude', None)
	display_longitude = _display_longitude_for_chart(display_chart, longitude)
	speed_lon = _object_chart_speed(display_chart, obj)
	motion_marker = ''
	motion_jd = event_jd if is_live and event_jd is not None else getattr(getattr(display_chart, 'time', None), 'jd', None)
	if motion_jd is not None and obj is not None and obj.planet_index is not None:
		motion_marker = radixsignals.get_motion_marker_for_speed(
			motion_jd,
			obj.planet_index,
			speed_lon,
			within_days=DISPLAY_STATION_WINDOW_DAYS,
			options=getattr(display_chart, 'options', None),
		)
	dignity_code = _object_dignity_code(display_chart, obj)
	payload = {
		'longitude': longitude,
		'display_longitude': display_longitude,
		'speed_lon': speed_lon,
		'lon_text': _format_compact_longitude(display_longitude),
		'glyph_color': _object_glyph_color(display_chart, obj),
		'motion_marker': motion_marker,
		'dignity_code': dignity_code,
		'state_suffix': _format_state_suffix(motion_marker, dignity_code),
		'is_live': bool(is_live),
	}
	return payload


def _secondary_aspect_motion_payload(payload):
	if not isinstance(payload, dict):
		return payload
	speed_lon = payload.get('speed_lon')
	motion_marker = str(payload.get('motion_marker') or '').upper()
	if motion_marker not in ('SR', 'SD', 'S'):
		try:
			motion_marker = 'R' if speed_lon is not None and float(speed_lon) < 0.0 else ''
		except Exception:
			motion_marker = ''
	payload['motion_marker'] = motion_marker
	payload['state_suffix'] = _format_state_suffix(motion_marker, payload.get('dignity_code'))
	return payload


def _build_live_row_object_display(radix_catalog, object_id, chrt, event_jd, runtime):
	obj = radix_catalog.get(object_id)
	if obj is None or runtime is None:
		return None
	state = runtime.live_object_state(obj, chrt, event_jd)
	if state is None:
		return None
	longitude, speed_lon = state
	return _build_payload_for_object(chrt, obj, longitude, speed_lon, event_jd, True)


def _build_static_row_object_display(radix_catalog, object_id, display_chart):
	obj = radix_catalog.get(object_id)
	if obj is None:
		return None
	longitude = getattr(obj, 'longitude', None)
	speed_lon = _object_chart_speed(display_chart, obj)
	return _build_payload_for_object(display_chart, obj, longitude, speed_lon, None, False)


def _build_payload_for_object(display_chart, obj, longitude, speed_lon, event_jd, is_live):
	display_longitude = _display_longitude_for_chart(display_chart, longitude)
	motion_marker = ''
	motion_jd = event_jd if is_live and event_jd is not None else getattr(getattr(display_chart, 'time', None), 'jd', None)
	if motion_jd is not None and obj is not None and obj.planet_index is not None:
		motion_marker = radixsignals.get_motion_marker_for_speed(
			motion_jd,
			obj.planet_index,
			speed_lon,
			within_days=DISPLAY_STATION_WINDOW_DAYS,
			options=getattr(display_chart, 'options', None),
		)
	dignity_code = _dignity_code_for_longitude(display_chart, obj, longitude)
	payload = {
		'longitude': longitude,
		'display_longitude': display_longitude,
		'speed_lon': speed_lon,
		'lon_text': _format_compact_longitude(display_longitude),
		'glyph_color': _glyph_color_for_dignity(display_chart, obj, dignity_code),
		'motion_marker': motion_marker,
		'dignity_code': dignity_code,
		'state_suffix': _format_state_suffix(motion_marker, dignity_code),
		'is_live': bool(is_live),
	}
	return payload


def _hydrate_result_display_payloads(rows, catalog, chrt, runtime):
	if runtime is None:
		runtime = _SearchRuntime()
	for row in rows:
		if row.metadata.get('cheby_hydrated') or row.metadata.get('display_hydrated'):
			continue
		event_tuple = _event_tuple_from_row(row)
		if row.technique in (
			searchquery.SearchQuery.TECHNIQUE_TRANSITS,
			searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS,
			searchquery.SearchQuery.TECHNIQUE_INGRESS_SYNODIC,
		):
			_apply_transit_row_display_payloads(row, catalog, chrt, runtime)
		elif row.technique == searchquery.SearchQuery.TECHNIQUE_PROFECTIONS:
			_apply_profection_row_display_payloads(row, catalog, chrt)
		elif row.technique == searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS:
			display_tuple = row.metadata.get('display_datetime', event_tuple)
			secondary_chart = runtime.chart_for_event('secondary', chrt, display_tuple)
			prom_motion_jd = row.event_jd
			try:
				prom_motion_jd = float(secondary_chart.time.jd)
			except Exception:
				pass
			_apply_row_display_payloads(
				row,
				catalog,
				secondary_chart,
				prom_motion_jd,
				True,
				chrt,
				row.event_jd,
				False,
				runtime,
				prom_payload_transform=_secondary_aspect_motion_payload,
			)
		elif row.technique == searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER:
			_apply_live_pair_row_display_payloads(row, catalog, chrt, runtime)
		elif row.technique in (
			searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
			searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
		):
			_apply_lunation_row_display_payloads(row, catalog, chrt, runtime)
		row.metadata['display_hydrated'] = True


def _apply_lunation_row_display_payloads(row, catalog, chrt, runtime):
	prom_payload = _build_live_row_object_display(catalog, row.promittor_id, chrt, row.event_jd, runtime)
	sig_payload = _build_static_row_object_display(catalog, row.significator_id, chrt)
	if prom_payload is not None:
		row.metadata['prom_display'] = prom_payload
		if prom_payload.get('state_suffix'):
			row.promittor_label = '%s%s' % (row.promittor_label, prom_payload['state_suffix'])
	if sig_payload is not None:
		row.metadata['sig_display'] = sig_payload
		if sig_payload.get('state_suffix'):
			row.significator_label = '%s%s' % (row.significator_label, sig_payload['state_suffix'])


def _apply_profection_row_display_payloads(row, radix_catalog, radix):
	"""Hydrate a zodiacal profection row without constructing a full Chart."""
	event_tuple = _event_tuple_from_row(row)
	try:
		profection = profections.Profections(
			radix,
			int(event_tuple[0]),
			int(event_tuple[1]),
			int(event_tuple[2]),
			(
				float(event_tuple[3])
				+ float(event_tuple[4]) / 60.0
				+ float(event_tuple[5]) / 3600.0
			),
		)
	except Exception:
		return

	prom_obj = radix_catalog.get(row.promittor_id)
	if prom_obj is not None and getattr(prom_obj, 'longitude', None) is not None:
		prom_lon = util.normalize(float(prom_obj.longitude) + float(profection.offs))
		prom_payload = _build_payload_for_object(
			radix,
			prom_obj,
			prom_lon,
			_object_chart_speed(radix, prom_obj),
			row.event_jd,
			True,
		)
		if prom_payload is not None:
			row.metadata['prom_display'] = prom_payload
			if prom_payload.get('state_suffix'):
				row.promittor_label = '%s%s' % (
					row.promittor_label,
					prom_payload['state_suffix'],
				)

	sig_payload = _build_static_row_object_display(
		radix_catalog,
		row.significator_id,
		radix,
	)
	if sig_payload is not None:
		row.metadata['sig_display'] = sig_payload
		if sig_payload.get('state_suffix'):
			row.significator_label = '%s%s' % (
				row.significator_label,
				sig_payload['state_suffix'],
			)


def _filter_rows_by_motion(rows, query, catalog, chrt):
	if not query.has_motion_filters():
		return rows

	filtered = []
	for row in rows:
		if _row_matches_motion_filters(row, query, catalog, chrt):
			filtered.append(row)
	return filtered


def _annotate_rows_by_moon_phase(rows, catalog, chrt, runtime):
	"""Attach the filterable Moon phase once without removing retained source rows."""
	if runtime is None:
		runtime = _SearchRuntime()
	moon = catalog.get('planet:moon')
	sun = catalog.get('planet:sun')
	if moon is None or sun is None:
		return rows

	supported = (
		searchquery.SearchQuery.TECHNIQUE_TRANSITS,
		searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS,
		searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER,
		searchquery.SearchQuery.TECHNIQUE_INGRESS_SYNODIC,
	)
	for row in rows:
		if row.promittor_id != 'planet:moon' or row.technique in (
			searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
			searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
		):
			continue
		if row.technique not in supported or row.event_jd is None:
			continue
		phase_jd = float(row.metadata.get('converse_transit_jd', row.event_jd))
		moon_lon = runtime.live_object_longitude(moon, chrt, phase_jd)
		sun_lon = runtime.live_object_longitude(sun, chrt, phase_jd)
		if moon_lon is None or sun_lon is None:
			continue
		waxing = (float(moon_lon) - float(sun_lon)) % 360.0 < 180.0
		row.metadata['moon_phase'] = (
			searchquery.SearchQuery.MOON_PHASE_WAXING
			if waxing
			else searchquery.SearchQuery.MOON_PHASE_WANING
		)
	return rows


def _filter_rows_by_moon_phase(rows, query):
	"""Project the requested Moon phase from the annotated retained universe."""
	phase_filter = getattr(query, 'moon_phase_filter', '')
	if phase_filter not in searchquery.SearchQuery.MOON_PHASE_FILTERS:
		return rows
	filtered = []
	for row in rows:
		if row.promittor_id != 'planet:moon' or row.technique in (
			searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
			searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
		):
			filtered.append(row)
			continue
		if row.metadata.get('moon_phase') == phase_filter:
			filtered.append(row)
	return filtered


def _row_matches_motion_filters(row, query, catalog, chrt):
	role_filters = (
		(query.promittor_motion_filter, row.promittor_id, 'prom_display'),
		(query.significator_motion_filter, row.significator_id, 'sig_display'),
	)
	for motion_filter, object_id, payload_key in role_filters:
		if not motion_filter:
			continue
		motion_marker, speed_lon = _row_object_motion(row, object_id, payload_key, catalog, chrt)
		if not _matches_motion_filter(motion_filter, motion_marker, speed_lon):
			return False

	for object_id, payload_key in (
		(row.promittor_id, 'prom_display'),
		(row.significator_id, 'sig_display'),
	):
		motion_filter = query.object_motion_filters.get(object_id)
		if not motion_filter:
			continue
		motion_marker, speed_lon = _row_object_motion(row, object_id, payload_key, catalog, chrt)
		if not _matches_motion_filter(motion_filter, motion_marker, speed_lon):
			return False
	return True


def _row_object_motion(row, object_id, payload_key, catalog, chrt):
	payload = row.metadata.get(payload_key, {})
	if isinstance(payload, dict) and 'motion_marker' in payload:
		return str(payload.get('motion_marker') or '').upper(), payload.get('speed_lon')
	speed_lon = payload.get('speed_lon') if isinstance(payload, dict) else None
	if speed_lon is not None:
		speed = float(speed_lon)
		return ('R' if speed < 0.0 else 'S' if speed == 0.0 else ''), speed_lon
	if catalog is None or chrt is None:
		return '', None
	obj = catalog.get(object_id)
	if obj is None or obj.planet_index is None:
		return '', None
	speed_lon = _object_chart_speed(chrt, obj)
	motion_jd = getattr(getattr(chrt, 'time', None), 'jd', None)
	if motion_jd is None:
		return ('R' if speed_lon is not None and float(speed_lon) < 0.0 else ''), speed_lon
	marker = radixsignals.get_motion_marker_for_speed(
		motion_jd,
		obj.planet_index,
		speed_lon,
		within_days=DISPLAY_STATION_WINDOW_DAYS,
		options=getattr(chrt, 'options', None),
	)
	return str(marker or '').upper(), speed_lon


def _matches_motion_filter(motion_filter, motion_marker, speed_lon):
	marker = str(motion_marker or '').upper()
	if motion_filter == searchquery.SearchQuery.MOTION_RX:
		return marker in RX_MOTION_MARKERS
	if motion_filter == searchquery.SearchQuery.MOTION_DIRECT:
		return marker == '' and speed_lon is not None and float(speed_lon) > 0.0
	return True


def _display_longitude_for_chart(chrt, longitude):
	if longitude is None:
		return None
	# Live/catalog longitudes are already in the chart's selected zodiac.
	return util.normalize(float(longitude))


def _format_compact_longitude(display_longitude):
	if display_longitude is None:
		return ''
	lon = util.normalize(float(display_longitude))
	sign = int(lon / chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
	deg, minute, second = util.decToDeg(lon - sign*chart.Chart.SIGN_DEG)
	return '%02d%s%02d %s' % (deg, chr(176), minute, searchcatalog.SIGNS[sign])


def _object_chart_speed(display_chart, obj):
	if obj is None or obj.planet_index is None:
		return None
	try:
		body = common.get_chart_planet(display_chart, obj.planet_index)
		if body is None:
			return None
		return body.data[planets.Planet.SPLON]
	except Exception:
		return None


def _object_dignity_code(display_chart, obj):
	return _dignity_code_for_longitude(display_chart, obj, getattr(obj, 'longitude', None))


def _dignity_code_for_longitude(display_chart, obj, longitude):
	if obj is None:
		return None
	if obj.family != searchcatalog.SearchObject.FAMILY_PLANET:
		return None
	if obj.planet_index is None or obj.planet_index > astrology.SE_PLUTO:
		return None
	try:
		lona = float(longitude)
		sign = int(lona/chart.Chart.SIGN_DEG) % chart.Chart.SIGN_NUM
		isdom = display_chart.options.dignities[obj.planet_index][0][sign]
		isexal = display_chart.options.dignities[obj.planet_index][1][sign]
		oppsign = (sign + chart.Chart.SIGN_NUM // 2) % chart.Chart.SIGN_NUM
		isexil = display_chart.options.dignities[obj.planet_index][0][oppsign]
		iscasus = display_chart.options.dignities[obj.planet_index][1][oppsign]
		if isdom:
			return chart.Chart.DOMICIL
		if isexil:
			return chart.Chart.EXIL
		if isexal:
			return chart.Chart.EXAL
		if iscasus:
			return chart.Chart.CASUS
		return chart.Chart.PEREGRIN
	except Exception:
		return None


def _object_glyph_color(display_chart, obj):
	return _glyph_color_for_dignity(display_chart, obj, _object_dignity_code(display_chart, obj))


def _glyph_color_for_dignity(display_chart, obj, dignity_code):
	if obj is None:
		return display_chart.options.clrtexts
	if obj.id == 'point:lof':
		return display_chart.options.clrperegrin
	if obj.planet_index is None:
		return display_chart.options.clrtexts
	if obj.planet_index == astrology.SE_CHIRON:
		return display_chart.options.clrperegrin
	palette = (
		display_chart.options.clrdomicil,
		display_chart.options.clrexal,
		display_chart.options.clrperegrin,
		display_chart.options.clrcasus,
		display_chart.options.clrexil,
	)
	try:
		return palette[dignity_code]
	except Exception:
		return display_chart.options.clrperegrin


def _format_state_suffix(motion_marker, dignity_code):
	if motion_marker:
		return ' (%s)' % motion_marker
	return ''


def _build_static_targets(catalog, query):
	targets = []
	for prom_id in query.promittor_ids:
		if catalog.get(prom_id) is None:
			continue
		for sig_id in query.significator_ids:
			sig = catalog.get(sig_id)
			if sig is None:
				continue
			for aspect_id in query.aspects:
				chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
				if chart_aspect is None:
					continue
				for target_lon in _aspect_target_longitudes(sig.longitude, chart_aspect):
					targets.append((prom_id, sig_id, aspect_id, target_lon))
	return targets


def _build_secondary_catalog_for_jd_legacy(radix, event_jd, runtime=None):
	if runtime is not None:
		return runtime.secondary_catalog_for_jd(radix, event_jd)
	event_tuple = _jd_to_datetime_tuple(event_jd, _calendar_flag(radix))
	secondary_chart = build_secondary_chart_for_datetime(radix, event_tuple)
	return searchcatalog.SearchCatalog(secondary_chart) if secondary_chart is not None else searchcatalog.SearchCatalog(radix)


def _build_secondary_snapshot_for_jd(radix_catalog, radix, event_jd, object_ids, runtime=None):
	if runtime is not None:
		return runtime.secondary_snapshot_for_jd(radix_catalog, radix, event_jd, object_ids)
	return _snapshot_catalog_subset(
		radix_catalog,
		_build_secondary_catalog_for_jd_legacy(radix, event_jd, runtime),
		object_ids,
	)


def _build_secondary_snapshot_for_symbolic_age(radix_catalog, radix, symbolic_age, object_ids, runtime=None, method=posfordate.SECONDARY):
	if runtime is not None and method == posfordate.SECONDARY:
		# Runtime cache is keyed on (radix, object_ids, symbolic_age) without
		# method awareness — only safe to share for SECONDARY. Tertiary/minor
		# build a fresh snapshot.
		return runtime.secondary_snapshot_for_symbolic_age(radix_catalog, radix, symbolic_age, object_ids)
	return _secondary_symbolic_snapshot(radix_catalog, radix, symbolic_age, object_ids, runtime, method=method)


def _secondary_target_delta(catalog, radix, prom_id, target_lon, event_jd, runtime=None):
	snapshot = _build_secondary_snapshot_for_jd(catalog, radix, event_jd, (prom_id,), runtime)
	prom = snapshot.get(prom_id)
	if prom is None:
		return 999.0
	return _signed_angular_delta(prom.longitude, target_lon)

def _secondary_target_delta_by_symbolic_age(catalog, radix, prom_id, target_lon, symbolic_age, runtime=None):
	snapshot = _build_secondary_snapshot_for_symbolic_age(catalog, radix, symbolic_age, (prom_id,), runtime)
	prom = snapshot.get(prom_id)
	if prom is None:
		return 999.0
	return _signed_angular_delta(prom.longitude, target_lon)


def _interpolate_zero_crossing(start_value, end_value, delta0, delta1):
	start_value = float(start_value)
	end_value = float(end_value)
	delta0 = float(delta0)
	delta1 = float(delta1)
	denom = delta1 - delta0
	if abs(denom) <= EXACT_EPSILON:
		return start_value
	fraction = -delta0 / denom
	if fraction < 0.0:
		fraction = 0.0
	elif fraction > 1.0:
		fraction = 1.0
	return start_value + (end_value - start_value) * fraction


def _secondary_symbolic_snapshot(radix_catalog, radix, symbolic_age, object_ids, runtime=None, method=posfordate.SECONDARY):
	objects_by_id = {}
	angle_state = None
	if any(oid in ('angle:asc', 'angle:mc', 'point:lof') for oid in object_ids):
		angle_state = posfordate.progressed_angle_state_for_symbolic_age(
			radix,
			radix.options,
			float(symbolic_age),
			method=method,
		)

	for object_id in object_ids:
		base_obj = radix_catalog.get(object_id)
		if base_obj is None:
			continue
		longitude = _secondary_symbolic_object_longitude(base_obj, radix, symbolic_age, angle_state, runtime, method=method)
		if longitude is None:
			continue
		objects_by_id[object_id] = searchcatalog.SearchObject(
			base_obj.id,
			base_obj.label,
			base_obj.family,
			base_obj.source_type,
			longitude,
			base_obj.planet_index,
			base_obj.can_promittor,
			base_obj.can_significator,
		)

	return _SnapshotCatalog(objects_by_id)


def _secondary_symbolic_object_longitude(base_obj, radix, symbolic_age, angle_state=None, runtime=None, method=posfordate.SECONDARY):
	if base_obj is None:
		return None
	if base_obj.id == 'angle:asc':
		if angle_state is None:
			angle_state = posfordate.progressed_angle_state_for_symbolic_age(radix, radix.options, float(symbolic_age), method=method)
		return float(angle_state['asc_lon'])
	if base_obj.id == 'angle:mc':
		if angle_state is None:
			angle_state = posfordate.progressed_angle_state_for_symbolic_age(radix, radix.options, float(symbolic_age), method=method)
		return float(angle_state['mc_lon'])
	if base_obj.id == 'point:lof':
		return _secondary_symbolic_lof_longitude(radix, symbolic_age, angle_state, method=method)
	if base_obj.planet_index is None:
		return None
	# jd_prog = birth_jd + symbolic_age is correct for ALL progression methods —
	# `symbolic_age` is always in ephemeris days; the method's scale factor only
	# affects the symbolic_age ↔ native_years mapping, not the ephemeris lookup.
	jd_prog = float(radix.time.jd) + float(symbolic_age)
	flags = runtime.planet_flags(radix) if runtime is not None else _planet_flags(radix)
	state = _live_object_state_uncached(base_obj, radix, jd_prog, flags)
	if state is None:
		return None
	return float(state[0])


def _secondary_symbolic_lof_longitude(radix, symbolic_age, angle_state=None, method=posfordate.SECONDARY):
	if angle_state is None:
		angle_state = posfordate.progressed_angle_state_for_symbolic_age(radix, radix.options, float(symbolic_age), method=method)
	context = _planet_ephemeris_context(radix)
	with context.activate():
		return _secondary_symbolic_lof_longitude_in_active_context(
			radix,
			angle_state,
			context.flags,
		)


def _secondary_symbolic_lof_longitude_in_active_context(
	radix,
	angle_state,
	flags,
	*,
	sun_ecl=None,
	moon_ecl=None,
	sun_equ=None,
):
	jd_prog = float(angle_state['jd_prog'])
	if sun_ecl is None:
		_serr, sun_ecl = astrology.swe_calc_ut(
			jd_prog,
			astrology.SE_SUN,
			flags,
		)
	if moon_ecl is None:
		_serr, moon_ecl = astrology.swe_calc_ut(
			jd_prog,
			astrology.SE_MOON,
			flags,
		)
	if sun_equ is None:
		equatorial_flags = (
			(flags & ~astrology.SEFLG_SIDEREAL)
			| astrology.SEFLG_EQUATORIAL
		)
		_serr, sun_equ = astrology.swe_calc_ut(
			jd_prog,
			astrology.SE_SUN,
			equatorial_flags,
		)
	sun_lon = util.normalize(float(sun_ecl[planets.Planet.LONG]))
	moon_lon = util.normalize(float(moon_ecl[planets.Planet.LONG]))
	abovehor = _secondary_symbolic_sun_above_horizon(
		radix.place.lat,
		angle_state,
		float(sun_equ[planets.Planet.RAEQU]),
		float(sun_equ[planets.Planet.DECLEQU]),
		radix.options,
	)
	if radix.options.lotoffortune == chart.Chart.LFMOONSUN:
		diff = moon_lon - sun_lon
	elif radix.options.lotoffortune == chart.Chart.LFDSUNMOON:
		diff = sun_lon - moon_lon if abovehor else moon_lon - sun_lon
	else:
		diff = moon_lon - sun_lon if abovehor else sun_lon - moon_lon
	if diff < 0.0:
		diff += 360.0
	return util.normalize(float(angle_state['asc_lon']) + diff)


def _secondary_symbolic_sun_above_horizon(place_lat, angle_state, sun_ra, sun_decl, options):
	if angle_state.get('armc') is not None:
		ramc = float(angle_state['armc'])
	else:
		ramc = float(angle_state['ascmc2'][houses.Houses.MC][houses.Houses.RA])
	raic = util.normalize(ramc + 180.0)
	val = math.tan(math.radians(place_lat)) * math.tan(math.radians(sun_decl))
	adlat = 0.0
	if math.fabs(val) <= 1.0:
		adlat = math.degrees(math.asin(val))
	med = math.fabs(ramc - sun_ra)
	if med > 180.0:
		med = 360.0 - med
	icd = math.fabs(raic - sun_ra)
	if icd > 180.0:
		icd = 360.0 - icd
	dsa = 90.0 + adlat
	abovehorizon = med <= dsa
	if not getattr(options, 'usedaynightorb', False) or abovehorizon:
		return abovehorizon
	nsa = 90.0 - adlat
	mdsun = -icd
	sasun = -nsa
	if mdsun < 0.0:
		mdsun += 180.0
	if sasun < 0.0:
		sasun += 180.0
	orb = float(getattr(options, 'daynightorbdeg', 0.0)) + float(getattr(options, 'daynightorbmin', 0.0)) / 60.0
	return bool(mdsun - orb < sasun)


def _secondary_target_delta_direct(catalog, radix, prom_id, target_lon, event_jd, runtime=None, method=posfordate.SECONDARY):
	age = _secondary_symbolic_age_for_jd(radix, event_jd, method=method)
	prom = catalog.get(prom_id)
	longitude = _secondary_symbolic_object_longitude(prom, radix, age, runtime=runtime, method=method)
	if longitude is None:
		return 999.0
	return _signed_angular_delta(longitude, target_lon)


def _secondary_requires_real_snap(prom_id, catalog):
	obj = catalog.get(prom_id)
	if obj is None:
		return False
	if obj.id == 'point:lof':
		return True
	if obj.id in ('angle:asc', 'angle:mc'):
		return True
	return obj.planet_index == astrology.SE_MOON


def _secondary_finalize_real_jd(catalog, radix, prom_id, target_lon, approx_jd, start_jd, end_jd, runtime=None, method=posfordate.SECONDARY):
	if not _secondary_requires_real_snap(prom_id, catalog):
		return float(approx_jd)
	return _secondary_snap_real_jd(catalog, radix, prom_id, target_lon, approx_jd, start_jd, end_jd, runtime, method=method)


def cheby_apply_lazy_display(catalog, radix, row):
	"""Compute and attach `prom_display` / `sig_display` payloads on a cheby row
	whose display data was deferred at search time. Idempotent — does nothing
	if the row carries no `cheby_lazy_display` marker (already computed or
	wasn't from the cheby fast path).

	Called by the popup renderer (`SecDirsListWnd._draw_row`) for visible rows
	only, so the eager per-row dignity-code / motion-marker / glyph-color work
	(~30 μs per row × 5000+ rows ≈ 150-360 ms on wide MINOR ranges) collapses
	to ~30 μs × the ~30 rows actually painted in any one frame."""
	lazy = row.metadata.pop('cheby_lazy_display', None)
	if lazy is None:
		return False
	prom_obj = catalog.get(lazy['prom_id'])
	if prom_obj is None:
		return False
	prom_lon = util.normalize(float(lazy['target_lon']))
	_apply_cheby_secondary_display_payloads(
		row,
		catalog,
		radix,
		prom_obj,
		prom_lon,
		lazy.get('prom_speed'),
		lazy.get('prom_motion_jd'),
		lazy['sig_id'],
	)
	return True


def cheby_apply_lazy_display_rows(catalog, radix, rows):
	"""Bulk variant for paths (Save-As-Text, sort tiebreak) that need every
	row's display payload at once. Returns the number of rows materialised."""
	count = 0
	for row in rows:
		if cheby_apply_lazy_display(catalog, radix, row):
			count += 1
	return count


def cheby_refine_row(catalog, radix, row, runtime=None):
	"""On-demand swisseph refinement of a row built via the lazy-finalize cheby
	path. Mutates the row in place: updates `event_jd`, `event_year..event_second`,
	`event_date`, `event_time`, and `metadata['display_datetime']` to reflect the
	Newton-corrected real JD anchored to swisseph longitudes. Removes the
	`cheby_lazy` metadata key so subsequent calls are no-ops (idempotent).

	Returns True if the row was refined, False if it had no lazy payload (already
	exact, or never marked).
	"""
	lazy = row.metadata.get('cheby_lazy')
	if lazy is None:
		return False
	prom_id = lazy['prom_id']
	target_lon = float(lazy['target_lon'])
	method = int(lazy['method'])
	speed_per_real_day = float(lazy['speed_per_real_day'])
	approx_jd = float(row.event_jd) if row.event_jd is not None else None
	if approx_jd is None or math.fabs(speed_per_real_day) < 1e-9:
		row.metadata.pop('cheby_lazy', None)
		return False
	error_deg = _secondary_target_delta_direct(
		catalog, radix, prom_id, target_lon, approx_jd, runtime, method=method
	)
	if error_deg is None or math.fabs(error_deg) > 60.0:
		# Catastrophic mismatch — the residual sign suggests we straddled a
		# branch cut. Leave the row as approx; don't bisect (cost-prohibitive
		# here, and the approx is bounded by fit error anyway).
		row.metadata.pop('cheby_lazy', None)
		return False
	refined_jd = approx_jd - float(error_deg) / speed_per_real_day
	calflag = _calendar_flag(radix)
	event_tuple = _jd_to_datetime_tuple(refined_jd, calflag)
	event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
	event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
	_fill_row_from_event(row, catalog, refined_jd, event_tuple, event_date, event_time)
	row.metadata['display_datetime'] = event_tuple
	row.metadata.pop('cheby_lazy', None)
	return True


def cheby_refine_rows(catalog, radix, rows, runtime=None):
	"""Bulk refine — convenience wrapper for save-as-text and similar paths that
	need exact times for every row at once. Returns the number of rows refined."""
	count = 0
	for row in rows:
		if cheby_refine_row(catalog, radix, row, runtime=runtime):
			count += 1
	return count


def _cheby_exact_candidate_jd(catalog, radix, payload, approx_jd, runtime=None):
	"""Certify one Chebyshev candidate against the canonical progression engine."""
	prom_id = payload['prom_id']
	target_lon = float(payload['target_lon'])
	method = int(payload['method'])
	lo = float(payload.get('bracket_start_jd', approx_jd))
	hi = float(payload.get('bracket_end_jd', approx_jd))
	if not math.isfinite(lo) or not math.isfinite(hi) or hi <= lo:
		return None
	current_jd = min(max(float(approx_jd), lo), hi)
	speed = payload.get('speed_per_real_day')
	try:
		speed = float(speed) if speed is not None else None
	except Exception:
		speed = None
	is_tangent_candidate = bool(payload.get('is_tangent_candidate', False))

	evaluations = {}

	def evaluate(jd):
		jd = min(max(float(jd), lo), hi)
		key = round(jd, 12)
		if key not in evaluations:
			value = float(_secondary_target_delta_direct(
				catalog,
				radix,
				prom_id,
				target_lon,
				jd,
				runtime,
				method=method,
			))
			evaluations[key] = value
		return evaluations[key]

	current_error = evaluate(current_jd)
	if not math.isfinite(current_error) or math.fabs(current_error) > 180.0:
		return None
	if math.fabs(current_error) <= EXACT_EPSILON and not is_tangent_candidate:
		return current_jd

	best_jd = current_jd
	best_error = current_error
	derivative = speed
	for _iteration in range(8):
		if derivative is None or not math.isfinite(derivative) or math.fabs(derivative) < 1e-12:
			break
		step = current_error / derivative
		if not math.isfinite(step):
			break
		candidate_jd = min(max(current_jd - step, lo), hi)
		if math.fabs(candidate_jd - current_jd) < 1e-10:
			break
		candidate_error = evaluate(candidate_jd)
		if not math.isfinite(candidate_error) or math.fabs(candidate_error) > 180.0:
			break
		if math.fabs(candidate_error) < math.fabs(best_error):
			best_jd = candidate_jd
			best_error = candidate_error
		if math.fabs(candidate_error) <= EXACT_EPSILON and not is_tangent_candidate:
			return candidate_jd
		if (
			not is_tangent_candidate
			and _is_target_zero_crossing(current_error, candidate_error)
		):
			refined = _refine_exact_jd(current_jd, candidate_jd, evaluate)
			if math.fabs(evaluate(refined)) <= EXACT_EPSILON:
				return refined
		delta_jd = candidate_jd - current_jd
		delta_error = candidate_error - current_error
		if math.fabs(delta_error) < 180.0 and math.fabs(delta_jd) > 1e-12:
			derivative = delta_error / delta_jd
		current_jd = candidate_jd
		current_error = candidate_error

	# Newton normally converges in one or two calls. The bounded expansion is a
	# safeguard for near-stationary motion and imperfect polynomial derivatives.
	base_radius = 1.0 / 86400.0
	if speed is not None and math.isfinite(speed) and math.fabs(speed) >= 1e-12:
		base_radius = max(base_radius, math.fabs(float(best_error) / speed) * 1.5)
	radius = min(max(base_radius, 1.0 / 86400.0), hi - lo)
	for _iteration in range(16):
		left = max(lo, best_jd - radius)
		right = min(hi, best_jd + radius)
		evaluate(left)
		evaluate(right)
		points = sorted((jd, value) for jd, value in (
			(float(key), val) for key, val in evaluations.items()
		))
		for (left_jd, left_error), (right_jd, right_error) in zip(points, points[1:]):
			if is_tangent_candidate:
				break
			if not _is_target_zero_crossing(left_error, right_error):
				continue
			refined = _refine_exact_jd(left_jd, right_jd, evaluate)
			if math.fabs(evaluate(refined)) <= EXACT_EPSILON:
				return refined
		if left <= lo and right >= hi:
			break
		radius = min(hi - lo, radius * 2.0)

	# Tangent candidates do not bracket a sign change. Minimize the absolute
	# canonical residual in a small method-scaled neighborhood and only accept
	# the event when the true curve reaches the exact tolerance.
	local_radius = payload.get('candidate_radius_real_days')
	try:
		local_radius = float(local_radius)
	except Exception:
		local_radius = 0.0
	if math.isfinite(local_radius) and local_radius > 0.0:
		search_lo = max(lo, float(approx_jd) - local_radius)
		search_hi = min(hi, float(approx_jd) + local_radius)
		if search_hi > search_lo:
			golden_ratio = (math.sqrt(5.0) - 1.0) / 2.0
			left_probe = search_hi - golden_ratio * (search_hi - search_lo)
			right_probe = search_lo + golden_ratio * (search_hi - search_lo)
			left_error = math.fabs(evaluate(left_probe))
			right_error = math.fabs(evaluate(right_probe))
			for _iteration in range(40):
				if left_error <= right_error:
					search_hi = right_probe
					right_probe = left_probe
					right_error = left_error
					left_probe = search_hi - golden_ratio * (search_hi - search_lo)
					left_error = math.fabs(evaluate(left_probe))
				else:
					search_lo = left_probe
					left_probe = right_probe
					left_error = right_error
					right_probe = search_lo + golden_ratio * (search_hi - search_lo)
					right_error = math.fabs(evaluate(right_probe))
			minimum_jd = left_probe if left_error <= right_error else right_probe
			minimum_error = evaluate(minimum_jd)
			if math.fabs(minimum_error) <= EXACT_EPSILON:
				return minimum_jd

	return best_jd if math.fabs(best_error) <= EXACT_EPSILON else None


def cheby_finalize_search_rows(catalog, radix, rows, runtime=None):
	"""Return Search rows with every Chebyshev candidate exactly certified.

	The Search result limit is intentionally applied before this boundary. Rows
	that represent the same candidate share one canonical solve; unverified
	polynomial candidates are omitted instead of leaking approximate event times.
	"""
	exact_jd_by_candidate = {}
	finalized = []
	calflag = _calendar_flag(radix)
	for row in rows:
		payload = row.metadata.pop('cheby_exact_candidate', None)
		if payload is None:
			finalized.append(row)
			continue
		approx_jd = float(row.event_jd) if row.event_jd is not None else None
		if approx_jd is None:
			continue
		key = (
			str(payload.get('prom_id')),
			round(float(payload.get('target_lon')), 12),
			round(float(payload.get('age')), 12),
			int(payload.get('method')),
		)
		if key not in exact_jd_by_candidate:
			exact_jd_by_candidate[key] = _cheby_exact_candidate_jd(
				catalog,
				radix,
				payload,
				approx_jd,
				runtime=runtime,
			)
		exact_jd = exact_jd_by_candidate[key]
		row.metadata.pop('cheby_lazy', None)
		if exact_jd is None:
			continue
		event_tuple = _jd_to_datetime_tuple(float(exact_jd), calflag)
		event_date = '%04d-%02d-%02d' % (event_tuple[0], event_tuple[1], event_tuple[2])
		event_time = '%02d:%02d:%02d' % (event_tuple[3], event_tuple[4], event_tuple[5])
		_fill_row_from_event(
			row,
			catalog,
			float(exact_jd),
			event_tuple,
			event_date,
			event_time,
		)
		row.metadata['display_datetime'] = event_tuple
		finalized.append(row)

	finalized = _dedupe_rows(finalized)
	finalized.sort(key=_search_row_sort_key)
	return finalized


def _cheby_finalize_real_jd(catalog, radix, prom_id, target_lon, age, approx_jd, start_jd, end_jd, fit, runtime=None, method=posfordate.SECONDARY):
	"""Fast finalize for cheby-derived hits — one Newton step instead of bisection.

	`age` is the cheby symbolic age where the polynomial crosses target_lon (to ~1e-9
	precision). `approx_jd` is the real JD that maps to that age via the calendar.
	`fit` is the ProgressionFit whose `.speed(prom_id, age)` gives an analytic
	derivative for the Newton correction.

	For non-snap bodies (Sun, planets) the calendar mapping is already exact —
	return approx_jd directly. For Moon/Asc/MC/LoF the swisseph longitude at
	approx_jd may differ from the polynomial by the fit error; one swisseph
	evaluation + analytic derivative converges the residual in a single step.

	Falls back to legacy bisection (`_secondary_finalize_real_jd`) if the cheby
	speed is degenerate (zero / unavailable) or the residual is implausibly large
	(suggests the hit and approx_jd disagree about which root we're on).
	"""
	if not _secondary_requires_real_snap(prom_id, catalog):
		return float(approx_jd)
	error_deg = _secondary_target_delta_direct(
		catalog, radix, prom_id, target_lon, float(approx_jd), runtime, method=method
	)
	# Catastrophic mismatch — degenerate cheby fit or branch-cut surprise — bisect.
	if error_deg is None or math.fabs(error_deg) > 60.0:
		return _secondary_snap_real_jd(catalog, radix, prom_id, target_lon, approx_jd, start_jd, end_jd, runtime, method=method)
	speed_per_ephem_day = fit.speed(prom_id, float(age))
	if speed_per_ephem_day is None or math.fabs(speed_per_ephem_day) < 1e-9:
		return _secondary_snap_real_jd(catalog, radix, prom_id, target_lon, approx_jd, start_jd, end_jd, runtime, method=method)
	scale = posfordate.progression_symbolic_scale(method) or 1.0
	speed_per_real_day = float(speed_per_ephem_day) * float(scale) / 365.2425
	if math.fabs(speed_per_real_day) < 1e-9:
		return float(approx_jd)
	return float(approx_jd) - float(error_deg) / float(speed_per_real_day)


def _secondary_snap_real_jd(catalog, radix, prom_id, target_lon, approx_jd, start_jd, end_jd, runtime=None, method=posfordate.SECONDARY):
	calflag = _calendar_flag(radix)
	candidate_tuple = _jd_to_datetime_tuple(float(approx_jd), calflag)
	day_start = _date_to_jd(datetime.date(candidate_tuple[0], candidate_tuple[1], candidate_tuple[2]), radix)
	# For methods where 1 native year is much shorter than 1 ephem day (TERTIARY,
	# MINOR), the angle/Moon motion within a 1-real-day bracket can be huge. Shrink
	# the bracket so bisection still operates on a near-monotonic delta.
	scale = posfordate.progression_symbolic_scale(method)
	# bracket_size in real days that maps to 1 ephem day of progressed motion:
	bracket_real_days = max(0.1, 1.0 / max(scale, 1.0))
	for offset in (-bracket_real_days, 0.0, bracket_real_days):
		bracket_start = day_start + offset
		lo = max(float(bracket_start), float(start_jd))
		hi = min(float(bracket_start) + bracket_real_days, float(end_jd))
		if hi <= lo:
			continue
		delta0 = _secondary_target_delta_direct(catalog, radix, prom_id, target_lon, lo, runtime, method=method)
		delta1 = _secondary_target_delta_direct(catalog, radix, prom_id, target_lon, hi, runtime, method=method)
		if not _is_target_zero_crossing(delta0, delta1):
			continue
		return _refine_exact_jd(
			lo,
			hi,
			lambda jd, oid=prom_id, lon=target_lon: _secondary_target_delta_direct(catalog, radix, oid, lon, jd, runtime, method=method)
		)
	return float(approx_jd)


def _secondary_target_delta_legacy(radix, prom_id, target_lon, event_jd, runtime=None):
	catalog = _build_secondary_catalog_for_jd_legacy(radix, event_jd, runtime)
	prom = catalog.get(prom_id)
	if prom is None:
		return 999.0
	return _signed_angular_delta(prom.longitude, target_lon)


def _build_primary_search_options(chrt, catalog, query):
	selected_prom_ids = set()
	selected_sig_ids = set()
	options = copy.copy(chrt.options)
	source_promplanets = list(getattr(chrt.options, 'promplanets', []))
	source_sigplanets = list(getattr(chrt.options, 'sigplanets', []))
	source_sigangles = list(getattr(chrt.options, 'sigangles', [True, True, True, True]))
	source_pdaspects = list(getattr(chrt.options, 'pdaspects', []))

	options.promplanets = [False] * len(source_promplanets)
	options.sigplanets = [False] * len(source_sigplanets)
	options.sigangles = [False] * len(source_sigangles)
	options.sigascmc = [False] * len(getattr(chrt.options, 'sigascmc', [True, True]))
	options.pdlof = [False, False]
	options.pdsyzygy = False
	options.pdterms = False
	options.pdantiscia = False
	options.pdmidpoints = False
	options.pdparallels = [False] * len(getattr(chrt.options, 'pdparallels', []))
	options.pdfixstars = False
	options.pdfixstarssel = [False] * len(getattr(chrt.options, 'pdfixstarssel', []))
	options.pdcustomer = False
	options.pdcustomer2 = False
	options.pdpromchiron = False
	options.pdsigchiron = False
	options.pdaspects = [False] * len(source_pdaspects)

	for prom_id in query.promittor_ids:
		obj = catalog.get(prom_id)
		if obj is None:
			continue
		if (
			obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE)
			and obj.planet_index is not None
			and obj.planet_index < len(options.promplanets)
		):
			options.promplanets[obj.planet_index] = True
			selected_prom_ids.add(prom_id)
		elif obj.planet_index == astrology.SE_CHIRON:
			options.pdpromchiron = True
			selected_prom_ids.add(prom_id)
		elif obj.id == 'point:lof':
			options.pdlof[0] = True
			selected_prom_ids.add(prom_id)

	for sig_id in query.significator_ids:
		obj = catalog.get(sig_id)
		if obj is None or obj.family not in PRIMARY_SUPPORTED_FAMILIES:
			continue
		if (
			obj.family in (searchcatalog.SearchObject.FAMILY_PLANET, searchcatalog.SearchObject.FAMILY_NODE)
			and obj.planet_index is not None
			and obj.planet_index < len(options.sigplanets)
		):
			options.sigplanets[obj.planet_index] = True
			selected_sig_ids.add(sig_id)
		elif obj.planet_index == astrology.SE_CHIRON:
			options.pdsigchiron = True
			selected_sig_ids.add(sig_id)
		elif obj.id == 'angle:asc' and len(options.sigangles) > 0:
			options.sigangles[0] = True
			selected_sig_ids.add(sig_id)
		elif obj.id == 'angle:mc' and len(options.sigangles) > 2:
			options.sigangles[2] = True
			selected_sig_ids.add(sig_id)
		elif obj.id == 'point:lof':
			options.pdlof[1] = True
			selected_sig_ids.add(sig_id)
		elif obj.id == 'point:syzygy':
			options.pdsyzygy = True
			selected_sig_ids.add(sig_id)
		elif obj.id == 'point:eclipse':
			degrees, minutes, seconds = util.decToDeg(util.normalize(float(obj.longitude)))
			options.pdcustomer2 = True
			options.pdcustomer2lon = [degrees, minutes, seconds]
			options.pdcustomer2lat = [0, 0, 0]
			options.pdcustomer2southern = False
			options.searchEcPd = True
			selected_sig_ids.add(sig_id)

	if len(options.sigascmc) >= 2:
		options.sigascmc[0] = bool(len(options.sigangles) > 1 and (options.sigangles[0] or options.sigangles[1]))
		options.sigascmc[1] = bool(len(options.sigangles) > 3 and (options.sigangles[2] or options.sigangles[3]))

	for aspect_id in query.aspects:
		chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
		if chart_aspect is None or chart_aspect >= len(options.pdaspects):
			continue
		options.pdaspects[chart_aspect] = True

	if len(selected_prom_ids) == 0 or len(selected_sig_ids) == 0 or not any(options.pdaspects):
		return None, selected_prom_ids, selected_sig_ids

	return options, selected_prom_ids, selected_sig_ids


def _build_primary_engine(chrt, options):
	abort = primdirs.AbortPD()
	pdrange = primdirs.PrimDirs.RANGEALL
	direction = primdirs.PrimDirs.BOTHDC

	if options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC:
		return placidiansapd.PlacidianSAPD(chrt, options, pdrange, direction, abort)
	if options.primarydir == primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE:
		return placidianutppd.PlacidianUTPPD(chrt, options, pdrange, direction, abort)
	if options.primarydir == primdirs.PrimDirs.REGIOMONTAN:
		return regiomontanpd.RegiomontanPD(chrt, options, pdrange, direction, abort)
	if options.primarydir == primdirs.PrimDirs.TOPOCENTRIC:
		return topocentricpd.TopocentricPD(chrt, options, pdrange, direction, abort)
	return campanianpd.CampanianPD(chrt, options, pdrange, direction, abort)


def _pd_object_id(catalog, pd_object, dynamic_key=None):
	if dynamic_key == 'chiron':
		return 'planet:chiron'
	if dynamic_key == 'user_sig' and catalog.get('point:eclipse') is not None:
		return 'point:eclipse'
	if pd_object == primdirs.PrimDir.ASC:
		return 'angle:asc'
	if pd_object == primdirs.PrimDir.MC:
		return 'angle:mc'
	if pd_object == primdirs.PrimDir.LOF:
		return 'point:lof'
	if pd_object == primdirs.PrimDir.SYZ:
		return 'point:syzygy'

	for obj in catalog.objects:
		if obj.planet_index == pd_object:
			return obj.id
	return None


def _pd_search_aspect_id(pd):
	promasp = getattr(pd, 'promasp', chart.Chart.NONE)
	sigasp = getattr(pd, 'sigasp', chart.Chart.NONE)
	if promasp in ASPECT_ID_BY_INDEX and promasp != chart.Chart.CONJUNCTIO:
		return ASPECT_ID_BY_INDEX[promasp]
	if sigasp in ASPECT_ID_BY_INDEX and sigasp != chart.Chart.CONJUNCTIO:
		return ASPECT_ID_BY_INDEX[sigasp]
	if promasp == chart.Chart.CONJUNCTIO and sigasp == chart.Chart.CONJUNCTIO:
		return searchquery.SearchQuery.ASPECT_CONJUNCTION
	return ASPECT_ID_BY_INDEX.get(sigasp)


def _weather_pairs(catalog, query):
	supported_prom = [oid for oid in query.promittor_ids if _is_weather_object(catalog.get(oid))]
	supported_sig = [oid for oid in query.significator_ids if _is_weather_object(catalog.get(oid))]
	if len(supported_prom) == 0 or len(supported_sig) == 0:
		return [], ()

	order = [obj.id for obj in catalog.objects if _is_weather_object(obj)]
	order_index = dict((oid, idx) for idx, oid in enumerate(order))
	seen = set()
	pairs = []
	for prom_id in supported_prom:
		for sig_id in supported_sig:
			if prom_id == sig_id:
				continue
			if {prom_id, sig_id} == {'planet:asc_node', 'planet:desc_node'}:
				continue
			left, right = prom_id, sig_id
			if order_index.get(left, 0) > order_index.get(right, 0):
				left, right = right, left
			key = (left, right)
			if key in seen:
				continue
			seen.add(key)
			pairs.append(key)

	body_ids = tuple(sorted(set([oid for pair in pairs for oid in pair]), key=lambda oid: order_index.get(oid, 9999)))
	return pairs, body_ids


def _compile_weather_specs(pairs, body_ids, aspects):
	if len(pairs) == 0 or len(body_ids) == 0:
		return ()
	body_index = dict((oid, idx) for idx, oid in enumerate(body_ids))
	specs = []
	for prom_id, sig_id in pairs:
		prom_idx = body_index.get(prom_id)
		sig_idx = body_index.get(sig_id)
		if prom_idx is None or sig_idx is None:
			continue
		for aspect_id in aspects:
			chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
			if chart_aspect is None:
				continue
			for offset in _dynamic_aspect_offsets(chart_aspect):
				specs.append((prom_id, sig_id, prom_idx, sig_idx, aspect_id, offset))
	return tuple(specs)


def _weather_body_code(obj, chrt):
	if obj is None or obj.planet_index is None:
		return None
	if obj.id == 'planet:asc_node':
		return astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
	if obj.id == 'planet:desc_node':
		node_id = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
		return 1000 + node_id
	return int(obj.planet_index)


def _can_use_fast_weather_kernel(body_codes):
	for body_code in body_codes:
		if body_code == astrology.SE_MOON:
			return False
		if body_code == astrology.SE_MEAN_NODE or body_code == astrology.SE_TRUE_NODE:
			return False
		if body_code >= 1000:
			return False
	return True


def _is_weather_object(obj):
	if obj is None:
		return False
	return obj.family in (
		searchcatalog.SearchObject.FAMILY_PLANET,
		searchcatalog.SearchObject.FAMILY_NODE,
	) and obj.planet_index is not None


def _planet_ephemeris_context(chrt):
	return EphemerisContext.for_chart(chrt, ephe_path=common.get_ephe_path())


def _planet_flags(chrt):
	context = _planet_ephemeris_context(chrt)
	context.apply()
	return context.flags


def _live_planet_longitudes(catalog, chrt, body_ids, event_jd, runtime=None):
	if runtime is not None:
		return runtime.live_planet_longitudes(catalog, chrt, body_ids, event_jd)
	state = {}
	flags = _planet_flags(chrt)
	for oid in body_ids:
		obj = catalog.get(oid)
		if obj is None or obj.planet_index is None:
			continue
		state[oid] = _live_object_longitude_uncached(obj, chrt, event_jd, flags)
	return state


def _live_planet_longitude_vector(catalog, chrt, body_ids, event_jd, runtime=None):
	if runtime is not None:
		return runtime.live_planet_longitude_vector(catalog, chrt, body_ids, event_jd)
	state = _live_planet_longitudes(catalog, chrt, body_ids, event_jd, runtime)
	return tuple(state.get(oid) for oid in body_ids)


def _live_planet_longitude_vector_uncached(body_objects, chrt, flags, event_jd):
	return tuple(_live_object_longitude_uncached(obj, chrt, event_jd, flags) for obj in body_objects)


def _live_object_longitude_uncached(obj, chrt, event_jd, flags, context=None):
	state = _live_object_state_uncached(obj, chrt, event_jd, flags, context=context)
	if state is None:
		return None
	return state[0]


def _live_object_state_uncached(obj, chrt, event_jd, flags, context=None):
	if obj is None:
		return None
	context = context or _planet_ephemeris_context(chrt)
	with context.activate():
		if obj.id == 'planet:asc_node':
			node_id = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
			body = planets.Planet(event_jd, node_id, flags)
			return util.normalize(body.data[planets.Planet.LONG]), float(body.data[planets.Planet.SPLON])
		if obj.id == 'planet:desc_node':
			node_id = astrology.SE_MEAN_NODE if getattr(chrt.options, 'meannode', True) else astrology.SE_TRUE_NODE
			body = planets.Planet(event_jd, node_id, flags)
			return util.normalize(body.data[planets.Planet.LONG] + 180.0), float(body.data[planets.Planet.SPLON])
		body = planets.Planet(event_jd, obj.planet_index, flags)
		return util.normalize(body.data[planets.Planet.LONG]), float(body.data[planets.Planet.SPLON])


def _live_object_lon_lat_state_uncached(obj, chrt, event_jd, flags, context=None):
	if obj is None or obj.planet_index is None:
		return None
	context = context or _planet_ephemeris_context(chrt)
	with context.activate():
		body = planets.Planet(event_jd, obj.planet_index, flags)
		return (
			util.normalize(body.data[planets.Planet.LONG]),
			float(body.data[planets.Planet.LAT]),
			float(body.data[planets.Planet.SPLON]),
		)


def _dynamic_aspect_offsets(chart_aspect):
	angle = chart.Chart.Aspects[chart_aspect]
	if chart_aspect == chart.Chart.CONJUNCTIO:
		return (0.0,)
	if chart_aspect == chart.Chart.OPPOSITIO:
		return (angle,)
	return (angle, -angle)


def _dynamic_weather_delta(prom_lon, sig_lon, offset):
	target = float(sig_lon) + float(offset)
	if target < 0.0:
		target += 360.0
	elif target >= 360.0:
		target -= 360.0
	delta = float(prom_lon) - target
	if delta > 180.0:
		delta -= 360.0
	elif delta < -180.0:
		delta += 360.0
	return delta


def _weather_aspect_error(aspect_id, prom_lon, sig_lon):
	chart_aspect = ASPECT_INDEX_BY_ID.get(aspect_id)
	if chart_aspect is None or prom_lon is None or sig_lon is None:
		return 999.0
	return min(abs(_dynamic_weather_delta(prom_lon, sig_lon, offset)) for offset in _dynamic_aspect_offsets(chart_aspect))


def _weather_pair_delta(catalog, chrt, prom_id, sig_id, offset, event_jd, runtime=None):
	state = _live_planet_longitudes(catalog, chrt, (prom_id, sig_id), event_jd, runtime)
	prom_lon = state.get(prom_id)
	sig_lon = state.get(sig_id)
	if prom_lon is None or sig_lon is None:
		return 999.0
	return _dynamic_weather_delta(prom_lon, sig_lon, offset)


def _aspect_target_longitudes(base_longitude, chart_aspect):
	angle = chart.Chart.Aspects[chart_aspect]
	if chart_aspect == chart.Chart.CONJUNCTIO:
		return (util.normalize(base_longitude),)
	if chart_aspect == chart.Chart.OPPOSITIO:
		return (util.normalize(base_longitude + angle),)
	return (
		util.normalize(base_longitude + angle),
		util.normalize(base_longitude - angle),
	)


def _dedupe_lunar_event_rows(rows):
	"""Let the explicit Eclipses technique own a shared eclipse contact once."""
	unique = []
	nearby_by_contact = {}
	for row in rows:
		if (
			row.event_jd is None
			or not row.metadata.get('eclipse')
			or row.technique not in (
				searchquery.SearchQuery.TECHNIQUE_LUNATIONS,
				searchquery.SearchQuery.TECHNIQUE_ECLIPSES,
			)
		):
			unique.append(row)
			continue
		key = (row.aspect, row.promittor_id, row.significator_id)
		matches = nearby_by_contact.setdefault(key, [])
		match = next(
			((jd, index) for jd, index in matches if abs(float(row.event_jd) - jd) <= RESULT_DEDUPE_WINDOW_DAYS),
			None,
		)
		if match is None:
			matches.append((float(row.event_jd), len(unique)))
			unique.append(row)
			continue
		_index = match[1]
		if row.technique == searchquery.SearchQuery.TECHNIQUE_ECLIPSES:
			unique[_index] = row
	return unique


def _dedupe_rows(rows):
	rows = _dedupe_lunar_event_rows(rows)
	seen = {}
	unique = []
	for row in rows:
		key = (
			row.technique,
			row.aspect,
			row.promittor_id,
			row.significator_id,
			row.notes,
		)
		if row.event_jd is not None:
			nearby = seen.setdefault(key, [])
			if any(abs(float(row.event_jd) - jd) <= RESULT_DEDUPE_WINDOW_DAYS for jd in nearby):
				continue
			nearby.append(float(row.event_jd))
		else:
			fallback_key = (key, row.event_date, row.event_time)
			if fallback_key in seen:
				continue
			seen[fallback_key] = []
		unique.append(row)
	return unique


def _unique_in_order(values):
	seen = set()
	ordered = []
	for value in values:
		if value in seen:
			continue
		seen.add(value)
		ordered.append(value)
	return tuple(ordered)


def _date_to_jd(value, chrt):
	time = chart.Time(
		value.year, value.month, value.day, 0, 0, 0,
		False, chrt.time.cal, chart.Time.GREENWICH,
		True, 0, 0, False, chrt.place, False
	)
	return time.jd


def _date_range_to_half_open_jd(start_date, end_date, chrt):
	"""Map an inclusive civil-date range to its exact chart-calendar JD span."""
	return _date_to_jd(start_date, chrt), _date_to_jd(end_date, chrt) + 1.0


def _secondary_symbolic_age_for_jd(radix, event_jd, method=posfordate.SECONDARY):
	event_tuple = _jd_to_datetime_tuple(event_jd, _calendar_flag(radix))
	return symbolic_time.symbolic_age_for_real_datetime(
		radix,
		event_tuple,
		method=method,
		day_type=getattr(radix.options, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2),
	)


def _secondary_real_event_info_for_symbolic_age(radix, symbolic_age, method=posfordate.SECONDARY):
	if radix is None:
		return None
	# `symbolic_age` is in ephemeris days. The calendar-age helper expects native
	# years, so convert via the method's scale factor first.
	scale = posfordate.progression_symbolic_scale(method)
	age_years = float(symbolic_age) / scale if scale != 0.0 else float(symbolic_age)
	real_tuple = symbolic_time._real_datetime_for_calendar_age(radix, float(age_years))
	if real_tuple is None:
		return None
	calflag = _calendar_flag(radix)
	event_jd = astrology.swe_julday(
		int(real_tuple[0]),
		int(real_tuple[1]),
		int(real_tuple[2]),
		int(real_tuple[3]) + int(real_tuple[4]) / 60.0 + int(real_tuple[5]) / 3600.0,
		calflag,
	)
	event_date = '%04d-%02d-%02d' % (real_tuple[0], real_tuple[1], real_tuple[2])
	event_time = '%02d:%02d:%02d' % (real_tuple[3], real_tuple[4], real_tuple[5])
	return event_jd, real_tuple, event_date, event_time


def _iter_months_between(start_jd, end_jd, calflag):
	start_y, start_m, start_d, start_h = astrology.swe_revjul(start_jd, calflag)
	end_y, end_m, end_d, end_h = astrology.swe_revjul(end_jd-0.000001, calflag)

	year = start_y
	month = start_m
	while year < end_y or (year == end_y and month <= end_m):
		yield year, month
		year, month = util.incrMonth(year, month)


def _decimal_hours_to_hms(value):
	total_seconds = int(round(value*3600.0))
	if total_seconds >= 24*3600:
		total_seconds = 24*3600-1
	if total_seconds < 0:
		total_seconds = 0

	hour = total_seconds/3600
	minute = (total_seconds % 3600)/60
	second = total_seconds % 60
	return int(hour), int(minute), int(second)


def _select_sign_change_second(total_seconds):
	rounded = int(round(float(total_seconds)))
	if abs(float(total_seconds) - float(rounded)) <= 1e-6:
		return rounded
	return int(math.ceil(float(total_seconds)))


def _calendar_flag(chrt):
	if chrt.time.cal == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def _moon_crossing_context(chrt):
	return EphemerisContext.for_chart(
		chrt,
		ephe_path=common.get_ephe_path(),
		include_speed=False,
		include_topocentric=False,
	)


def _moon_crossing_flags(chrt):
	context = _moon_crossing_context(chrt)
	context.apply()
	return context.flags


def _can_use_moon_cross_solver(chrt, prom):
	if prom is None or prom.planet_index != astrology.SE_MOON:
		return False
	return not getattr(chrt.options, 'topocentric', False)


def _compile_transit_batch_promittor_ids(catalog, query):
	ids = []
	for prom_id in query.promittor_ids:
		prom = catalog.get(prom_id)
		if not _can_use_fast_transit_promittor(prom):
			continue
		ids.append(prom_id)
	return tuple(ids)


def _compile_secondary_batch_promittor_ids(catalog, query):
	ids = []
	for prom_id in query.promittor_ids:
		prom = catalog.get(prom_id)
		if prom is None or prom.family != searchcatalog.SearchObject.FAMILY_PLANET:
			continue
		if prom.planet_index is None or prom.planet_index > astrology.SE_PLUTO:
			continue
		if prom.planet_index == astrology.SE_MOON:
			continue
		ids.append(prom_id)
	return tuple(ids)


def _compile_transit_promittors_by_index(catalog, promittor_ids):
	mapping = {}
	for prom_id in promittor_ids:
		prom = catalog.get(prom_id)
		if prom is None or prom.planet_index is None:
			continue
		mapping[prom.planet_index] = prom_id
	return mapping


def _jd_to_datetime_tuple(event_jd, calflag):
	year, month, day, hour = astrology.swe_revjul(event_jd, calflag)
	hour, minute, second = _decimal_hours_to_hms(hour)
	return int(year), int(month), int(day), int(hour), int(minute), int(second)


def _sign_change_chart_parity_event(exact_jd, calflag):
	year, month, day, hour = astrology.swe_revjul(exact_jd, calflag)
	total_seconds = float(hour) * 3600.0
	second_index = _select_sign_change_second(total_seconds)
	day_start_jd = astrology.swe_julday(year, month, day, 0.0, calflag)
	event_jd = float(day_start_jd) + (float(second_index) / 86400.0)
	return event_jd, _jd_to_datetime_tuple(event_jd, calflag)


def _secondary_event_tuple_for_jd(radix, event_jd):
	if radix is None:
		return None
	event_tuple = _jd_to_datetime_tuple(event_jd, _calendar_flag(radix))
	secondary_chart = build_secondary_chart_for_datetime(radix, event_tuple)
	if secondary_chart is None or getattr(secondary_chart, 'time', None) is None:
		return None
	time_obj = secondary_chart.time
	return (
		int(time_obj.year), int(time_obj.month), int(time_obj.day),
		int(time_obj.hour), int(time_obj.minute), int(time_obj.second),
	)


def _snapshot_catalog_subset(radix_catalog, source_catalog, object_ids):
	if source_catalog is None:
		return _SnapshotCatalog({})

	objects_by_id = {}
	for object_id in object_ids:
		base_obj = radix_catalog.get(object_id)
		if base_obj is None:
			continue
		source_obj = source_catalog.get(object_id)
		if source_obj is None:
			continue
		objects_by_id[object_id] = searchcatalog.SearchObject(
			base_obj.id,
			base_obj.label,
			base_obj.family,
			base_obj.source_type,
			source_obj.longitude,
			base_obj.planet_index,
			base_obj.can_promittor,
			base_obj.can_significator
		)
	return _SnapshotCatalog(objects_by_id)


def _signed_angular_delta(current_lon, target_lon):
	delta = float(current_lon) - float(target_lon)
	if delta > 180.0 or delta < -180.0:
		delta = ((delta + 180.0) % 360.0) - 180.0
	return delta


def _crosses_zero(delta0, delta1):
	if abs(delta0) <= EXACT_EPSILON or abs(delta1) <= EXACT_EPSILON:
		return True
	return (delta0 < 0.0 < delta1) or (delta1 < 0.0 < delta0)


def _is_relative_zero_crossing(delta0, delta1, epsilon):
	if abs(delta0) <= epsilon or abs(delta1) <= epsilon:
		return True
	if not ((delta0 < 0.0 < delta1) or (delta1 < 0.0 < delta0)):
		return False
	return abs(float(delta1) - float(delta0)) < 180.0


def _is_target_zero_crossing(delta0, delta1):
	if abs(delta0) <= EXACT_EPSILON or abs(delta1) <= EXACT_EPSILON:
		return True
	if not _crosses_zero(delta0, delta1):
		return False
	return abs(float(delta1) - float(delta0)) < 180.0


def _refine_exact_jd(start_jd, end_jd, evaluator):
	lo = float(start_jd)
	hi = float(end_jd)
	lo_val = float(evaluator(lo))
	hi_val = float(evaluator(hi))
	best_jd = lo if abs(lo_val) <= abs(hi_val) else hi
	best_val = lo_val if abs(lo_val) <= abs(hi_val) else hi_val

	for i in range(28):
		mid = (lo + hi) / 2.0
		mid_val = float(evaluator(mid))
		if abs(mid_val) < abs(best_val):
			best_jd = mid
			best_val = mid_val
		if abs(mid_val) <= EXACT_EPSILON:
			return mid
		if _crosses_zero(lo_val, mid_val):
			hi = mid
			hi_val = mid_val
		elif _crosses_zero(mid_val, hi_val):
			lo = mid
			lo_val = mid_val
		elif abs(lo_val) <= abs(hi_val):
			hi = mid
			hi_val = mid_val
		else:
			lo = mid
			lo_val = mid_val

	return best_jd


def _refine_weather_exact_jd(prom_obj, sig_obj, chrt, offset, start_jd, end_jd, start_val, end_val, runtime, flags=None):
	if prom_obj is None or sig_obj is None:
		return float(start_jd)

	lo = float(start_jd)
	hi = float(end_jd)
	lo_val = float(start_val)
	hi_val = float(end_val)
	best_jd = lo if abs(lo_val) <= abs(hi_val) else hi
	best_val = lo_val if abs(lo_val) <= abs(hi_val) else hi_val

	for i in range(28):
		mid = (lo + hi) / 2.0
		if flags is not None:
			prom_lon = _live_object_longitude_uncached(prom_obj, chrt, mid, flags)
			sig_lon = _live_object_longitude_uncached(sig_obj, chrt, mid, flags)
		elif runtime is not None:
			prom_lon = runtime.live_object_longitude(prom_obj, chrt, mid)
			sig_lon = runtime.live_object_longitude(sig_obj, chrt, mid)
		else:
			return best_jd
		if prom_lon is None or sig_lon is None:
			break
		mid_val = _dynamic_weather_delta(prom_lon, sig_lon, offset)
		if abs(mid_val) < abs(best_val):
			best_jd = mid
			best_val = mid_val
		if abs(mid_val) <= EXACT_EPSILON:
			return mid
		if _crosses_zero(lo_val, mid_val):
			hi = mid
			hi_val = mid_val
		elif _crosses_zero(mid_val, hi_val):
			lo = mid
			lo_val = mid_val
		elif abs(lo_val) <= abs(hi_val):
			hi = mid
			hi_val = mid_val
		else:
			lo = mid
			lo_val = mid_val

	return best_jd


def _passes_traditional_filter(aspect_id, lon1, lon2, opts):
	if lon1 is None or lon2 is None:
		return False
	if not getattr(opts, 'traditionalaspects', False):
		return True
	if aspect_id not in TRADITIONAL_SIGN_DIFFS:
		return False

	sign1 = int(util.normalize(float(lon1)) / chart.Chart.SIGN_DEG)
	sign2 = int(util.normalize(float(lon2)) / chart.Chart.SIGN_DEG)
	sign_diff = abs(sign1 - sign2)
	if sign_diff > chart.Chart.SIGN_NUM / 2:
		sign_diff = chart.Chart.SIGN_NUM - sign_diff
	return sign_diff == TRADITIONAL_SIGN_DIFFS[aspect_id]


def build_clipboard_text(rows):
	lines = []
	for row in rows:
		lines.append('%s %s  %s %s %s  %s' % (
			row.event_date,
			row.event_time,
			row.promittor_label,
			_search_aspect_label(row.aspect),
			row.significator_label,
			format_result_technique_label(row)
		))
	return '\n'.join(lines)


def build_ics(rows):
	now = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
	lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Morinus//Search//EN',
		'CALSCALE:GREGORIAN',
	]

	for idx, row in enumerate(rows):
		lines.extend((
			'BEGIN:VEVENT',
			'UID:%s-%d@morinus-search' % (now, idx),
			'DTSTAMP:%s' % now,
			'DTSTART:%04d%02d%02dT%02d%02d%02dZ' % (
				row.event_year, row.event_month, row.event_day,
				row.event_hour, row.event_minute, row.event_second
			),
			'DURATION:PT1M',
			'SUMMARY:%s' % _escape_ics_text('%s %s %s (%s)' % (
				row.promittor_label,
				_search_aspect_label(row.aspect),
				row.significator_label,
				format_result_technique_label(row)
			)),
			'END:VEVENT',
		))

	lines.append('END:VCALENDAR')
	return '\r\n'.join(lines) + '\r\n'


def _search_aspect_glyph(aspect):
	idx = ASPECT_INDEX_BY_ID.get(aspect, chart.Chart.CONJUNCTIO)
	return common.common.Aspects[idx]


def _search_aspect_label(aspect):
	return ASPECT_LABEL_BY_ID.get(aspect, mtexts.txts.get('Conjunctio', 'Conjunction'))


def _search_technique_label(technique):
	if technique == searchquery.SearchQuery.TECHNIQUE_TRANSITS:
		return mtexts.txts.get('Transits', 'Transits')
	if technique == searchquery.SearchQuery.TECHNIQUE_CONVERSE_TRANSITS:
		return mtexts.txts.get('ConverseTransits', 'Converse Transits')
	if technique == searchquery.SearchQuery.TECHNIQUE_PROFECTIONS:
		return mtexts.txts.get('Profections', 'Profections')
	if technique == searchquery.SearchQuery.TECHNIQUE_SECONDARY_DIRECTIONS:
		return mtexts.txts.get('SecondaryDirections', 'Secondary Directions')
	if technique == searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS:
		return mtexts.txts.get('PrimaryDirections', 'Primary Directions')
	if technique == searchquery.SearchQuery.TECHNIQUE_MUNDANE_WEATHER:
		return mtexts.txts.get('CelestialWeather', 'Celestial Weather')
	if technique == searchquery.SearchQuery.TECHNIQUE_HELIACAL_PHASES:
		return mtexts.txts.get('HeliacalPhases', 'Heliacal Phases')
	if technique == searchquery.SearchQuery.TECHNIQUE_LUNATIONS:
		return mtexts.txts.get('SynodicCycles', 'Lunations')
	if technique == searchquery.SearchQuery.TECHNIQUE_ECLIPSES:
		return mtexts.txts.get('Eclipses', 'Eclipses')
	if technique == searchquery.SearchQuery.TECHNIQUE_INGRESS_SYNODIC:
		return mtexts.txts.get('PDsInChartIngress', 'Ingress')
	return technique


def _escape_ics_text(value):
	return value.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')
