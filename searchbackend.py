# -*- coding: utf-8 -*-

import datetime
import math

import astrology
import chart
import common
import mtexts
import profections
import searchquery
import transits
import util


ASPECT_DEFS = (
	(searchquery.SearchQuery.ASPECT_CONJUNCTION, chart.Chart.CONJUNCTIO, False, mtexts.txts['Conjunctio']),
	(searchquery.SearchQuery.ASPECT_SEXTILE, chart.Chart.SEXTIL, True, mtexts.txts['Sextil']),
	(searchquery.SearchQuery.ASPECT_SQUARE, chart.Chart.QUADRAT, True, mtexts.txts['Quadrat']),
	(searchquery.SearchQuery.ASPECT_TRINE, chart.Chart.TRIGON, True, mtexts.txts['Trigon']),
	(searchquery.SearchQuery.ASPECT_QUINCUNX, chart.Chart.QUINQUNX, True, mtexts.txts['Quinqunx']),
	(searchquery.SearchQuery.ASPECT_OPPOSITION, chart.Chart.OPPOSITIO, False, mtexts.txts['Oppositio']),
)

ASPECT_INDEX_BY_ID = dict((aspect_id, chart_idx) for aspect_id, chart_idx, both_sides, label in ASPECT_DEFS)
ASPECT_LABEL_BY_ID = dict((aspect_id, label) for aspect_id, chart_idx, both_sides, label in ASPECT_DEFS)


def search(catalog, chrt, query, start_date, end_date, limit):
	start_jd = _date_to_jd(start_date, chrt)
	end_jd = _date_to_jd(end_date + datetime.timedelta(days=1), chrt)

	rows = []
	truncated = False

	if searchquery.SearchQuery.TECHNIQUE_TRANSITS in query.techniques:
		rows.extend(_search_transits(catalog, chrt, query, start_jd, end_jd))

	if searchquery.SearchQuery.TECHNIQUE_PROFECTIONS in query.techniques:
		rows.extend(_search_profections(catalog, chrt, query, start_jd, end_jd))

	rows = _dedupe_rows(rows)
	rows.sort(key=lambda row: (row.event_jd if row.event_jd is not None else float('inf'), row.technique, row.promittor_label, row.significator_label, row.aspect))

	if len(rows) > limit:
		rows = rows[:limit]
		truncated = True

	return rows, truncated


def _search_transits(catalog, chrt, query, start_jd, end_jd):
	rows = []
	calflag = _calendar_flag(chrt)

	for prom_id in query.promittor_ids:
		prom = catalog.get(prom_id)
		if prom is None or prom.planet_index is None:
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
					for year, month in _iter_months_between(start_jd, end_jd, calflag):
						engine = transits.Transits()
						engine.month(year, month, chrt, prom.planet_index, target_lon)
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


def _fill_row_from_jd(row, catalog, event_jd, calflag):
	prom = catalog.get(row.promittor_id)
	sig = catalog.get(row.significator_id)
	year, month, day, hour = astrology.swe_revjul(event_jd, calflag)
	hour, minute, second = _decimal_hours_to_hms(hour)

	row.promittor_label = prom.label if prom is not None else row.promittor_id
	row.significator_label = sig.label if sig is not None else row.significator_id
	row.event_jd = event_jd
	row.event_year = year
	row.event_month = month
	row.event_day = day
	row.event_hour = hour
	row.event_minute = minute
	row.event_second = second
	row.event_date = '%04d-%02d-%02d' % (year, month, day)
	row.event_time = '%02d:%02d:%02d' % (hour, minute, second)
	row.can_open_chart = True
	row.can_export_time = True
	row.can_export_ics = True


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


def _dedupe_rows(rows):
	seen = set()
	unique = []
	for row in rows:
		key = (
			row.technique,
			row.aspect,
			row.promittor_id,
			row.significator_id,
			row.event_date,
			row.event_time,
		)
		if key in seen:
			continue
		seen.add(key)
		unique.append(row)
	return unique


def _date_to_jd(value, chrt):
	time = chart.Time(
		value.year, value.month, value.day, 0, 0, 0,
		False, chrt.time.cal, chart.Time.GREENWICH,
		True, 0, 0, False, chrt.place, False
	)
	return time.jd


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


def _calendar_flag(chrt):
	if chrt.time.cal == chart.Time.JULIAN:
		return astrology.SE_JUL_CAL
	return astrology.SE_GREG_CAL


def build_clipboard_text(rows):
	lines = []
	for row in rows:
		lines.append('%s %s  %s %s %s  %s' % (
			row.event_date,
			row.event_time,
			row.promittor_label,
			_search_aspect_label(row.aspect),
			row.significator_label,
			_search_technique_label(row.technique)
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
				_search_technique_label(row.technique)
			)),
			'END:VEVENT',
		))

	lines.append('END:VCALENDAR')
	return '\r\n'.join(lines) + '\r\n'


def _search_aspect_glyph(aspect):
	idx = ASPECT_INDEX_BY_ID.get(aspect, chart.Chart.CONJUNCTIO)
	return common.common.Aspects[idx]


def _search_aspect_label(aspect):
	return ASPECT_LABEL_BY_ID.get(aspect, mtexts.txts['Conjunctio'])


def _search_technique_label(technique):
	if technique == searchquery.SearchQuery.TECHNIQUE_TRANSITS:
		return 'Transits'
	if technique == searchquery.SearchQuery.TECHNIQUE_PROFECTIONS:
		return 'Profections'
	if technique == searchquery.SearchQuery.TECHNIQUE_PRIMARY_DIRECTIONS:
		return 'Primary Directions'
	return technique


def _escape_ics_text(value):
	return value.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')
