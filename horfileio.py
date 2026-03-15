# -*- coding: utf-8 -*-
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


def read_hor_chart(fpath, options):
	return values_to_chart(read_hor_values(fpath), options)


def read_hor_summary(fpath):
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
