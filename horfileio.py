# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import pickle
import chart


def read_hor_values(fpath):
	values = []
	with open(fpath, 'rb') as f:
		unpickler = pickle.Unpickler(f)
		while True:
			try:
				values.append(unpickler.load())
			except EOFError:
				break
	return values


def values_to_chart(values, options):
	if len(values) < 27:
		raise EOFError('Incomplete horoscope file')

	name = values[0]
	male = values[1]
	htype = values[2]
	bc = values[3]
	year = values[4]
	month = values[5]
	day = values[6]
	hour = values[7]
	minute = values[8]
	second = values[9]
	cal = values[10]
	zt = values[11]
	plus = values[12]
	zh = values[13]
	zm = values[14]
	daylightsaving = values[15]
	place_name = values[16]
	deglon = values[17]
	minlon = values[18]
	seclon = values[19]
	east = values[20]
	deglat = values[21]
	minlat = values[22]
	seclat = values[23]
	north = values[24]
	altitude = values[25]
	notes = values[26]
	tzid = values[27] if len(values) > 27 else ''
	tzauto = values[28] if len(values) > 28 else (zt == chart.Time.ZONE and (not bc) and cal == chart.Time.GREGORIAN)

	place = chart.Place(place_name, deglon, minlon, 0, east, deglat, minlat, seclat, north, altitude)
	time = chart.Time(year, month, day, hour, minute, second, bc, cal, zt, plus, zh, zm, daylightsaving, place, tzid=tzid, tzauto=tzauto)
	return chart.Chart(name, male, time, place, htype, notes, options)


def _is_jsonl_or_json(fpath):
	ext = os.path.splitext(fpath)[1].lower()
	return ext in ('.jsonl', '.json')


def read_chart(fpath, options, record_index=None):
	"""Load a chart from any supported format (.hor, .jsonl, .json).

	*record_index* selects a specific entry in a .jsonl collection (0-based).
	When None the first record is used.
	"""
	if _is_jsonl_or_json(fpath):
		import chartfile
		ext = os.path.splitext(fpath)[1].lower()
		if ext == '.jsonl':
			records = chartfile.read_jsonl(fpath)
			if not records:
				raise EOFError('Empty JSONL file')
			idx = record_index if record_index is not None else 0
			return chartfile.dict_to_chart(records[idx], options)
		else:
			return chartfile.read_json_chart(fpath, options)
	return values_to_chart(read_hor_values(fpath), options)


def read_hor_chart(fpath, options, record_index=None):
	return read_chart(fpath, options, record_index=record_index)


def read_hor_summary(fpath):
	if _is_jsonl_or_json(fpath):
		import chartfile
		ext = os.path.splitext(fpath)[1].lower()
		if ext == '.jsonl':
			summaries = chartfile.read_jsonl_summaries(fpath)
			if not summaries:
				return None
			s = summaries[0]
			# Parse date/time for legacy summary format
			dparts = s.get('date', '').lstrip('-').split('-')
			tparts = s.get('time', '').split(':')
			return {
				'name': s.get('name', ''),
				'year': int(dparts[0]) if len(dparts) >= 1 and dparts[0] else 0,
				'month': int(dparts[1]) if len(dparts) >= 2 else 0,
				'day': int(dparts[2]) if len(dparts) >= 3 else 0,
				'hour': int(tparts[0]) if len(tparts) >= 1 and tparts[0] else 0,
				'minute': int(tparts[1]) if len(tparts) >= 2 else 0,
				'second': int(tparts[2]) if len(tparts) >= 3 else 0,
				'place': s.get('place', ''),
			}
		else:
			import json
			with open(fpath, 'r', encoding='utf-8') as f:
				d = json.load(f)
			if isinstance(d, list):
				d = d[0] if d else {}
			dparts = d.get('date', '').lstrip('-').split('-')
			tparts = d.get('time', '').split(':')
			return {
				'name': d.get('name', ''),
				'year': int(dparts[0]) if len(dparts) >= 1 and dparts[0] else 0,
				'month': int(dparts[1]) if len(dparts) >= 2 else 0,
				'day': int(dparts[2]) if len(dparts) >= 3 else 0,
				'hour': int(tparts[0]) if len(tparts) >= 1 and tparts[0] else 0,
				'minute': int(tparts[1]) if len(tparts) >= 2 else 0,
				'second': int(tparts[2]) if len(tparts) >= 3 else 0,
				'place': d.get('place', ''),
			}
	values = read_hor_values(fpath)
	if len(values) < 27:
		return None
	return {
		'name': values[0],
		'year': values[4],
		'month': values[5],
		'day': values[6],
		'hour': values[7],
		'minute': values[8],
		'second': values[9],
		'place': values[16],
	}
