# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Partner horoscope — A. Marr, Prediction III p. 10 (Juan & Evita Perón)."""

from __future__ import annotations

import datetime

import astrology
import chart

from partner_horoscope import (
	classify_older_younger,
	partner_horoscope_datetime_tuple,
	partner_horoscope_jd,
)


class _FakeTime:
	def __init__(self, dt: datetime.datetime, jd: float):
		self.year = dt.year
		self.month = dt.month
		self.day = dt.day
		self.origyear = dt.year
		self.origmonth = dt.month
		self.origday = dt.day
		self.hour = dt.hour
		self.minute = dt.minute
		self.second = dt.second
		self.jd = jd
		self.bc = False
		self.cal = 0  # GREGORIAN
		self.plus = True
		self.zh = 0
		self.zm = 0
		self.daylightsaving = False
		self.zt = 0
		self.tzid = ""
		self.tzauto = False


class _FakePlace:
	deglon = 0
	minlon = 0
	east = True
	altitude = 0


class _FakeChart:
	def __init__(self, name: str, male: bool, dt: datetime.datetime, jd: float):
		self.name = name
		self.male = male
		self.time = _FakeTime(dt, jd)
		self.place = _FakePlace()


def _dt(y, m, d, h, mi, s):
	return datetime.datetime(y, m, d, h, mi, s)


def test_partner_horoscope_jd_symmetry():
	juan_jd = 2414338.003009
	evita_jd = 2422948.872812
	assert partner_horoscope_jd(juan_jd, evita_jd) == (2.0 * juan_jd - evita_jd)


def test_marr_prediction_iii_page_10_peron_example():
	"""Marr III p. 10: Juan 8.10.1895 12:04:22, Evita 7.5.1919 8:56:51 → 11.3.1872 15:11:53."""
	juan_dt = _dt(1895, 10, 8, 12, 4, 22)
	evita_dt = _dt(1919, 5, 7, 8, 56, 51)
	delta = evita_dt - juan_dt
	expected = juan_dt - delta
	assert expected == _dt(1872, 3, 11, 15, 11, 53)

	def _jd(dt: datetime.datetime) -> float:
		return astrology.swe_julday(
			dt.year,
			dt.month,
			dt.day,
			dt.hour + dt.minute / 60.0 + dt.second / 3600.0,
			astrology.SE_GREG_CAL,
		)

	juan = _FakeChart("Peron, Juan", True, juan_dt, _jd(juan_dt))
	evita = _FakeChart("Peron, Evita", False, evita_dt, _jd(evita_dt))
	older, younger = classify_older_younger(juan, evita)
	assert older is juan
	assert younger is evita
	tuple_ = partner_horoscope_datetime_tuple(older, younger)
	assert tuple_ == (
		expected.year,
		expected.month,
		expected.day,
		expected.hour,
		expected.minute,
		expected.second,
	)


def test_marr_partner_epoch_stored_as_ut_not_zone_clock():
	"""Zone-time radixes must not shift the displayed partner epoch (Perón → 15:11:53)."""
	place_ba = chart.Place("Buenos Aires, Argentina", 34, 36, 0, False, 58, 27, 0, False, 0)
	place_lobos = chart.Place("Lobos, Argentina", 35, 11, 0, False, 59, 6, 0, False, 0)
	t_juan = chart.Time(
		1895,
		10,
		8,
		12,
		4,
		22,
		False,
		chart.Time.GREGORIAN,
		chart.Time.ZONE,
		False,
		4,
		0,
		False,
		place_lobos,
		tzid="",
		tzauto=False,
	)
	t_evita = chart.Time(
		1919,
		5,
		7,
		8,
		56,
		51,
		False,
		chart.Time.GREGORIAN,
		chart.Time.ZONE,
		False,
		4,
		0,
		False,
		place_ba,
		tzid="",
		tzauto=False,
	)

	class _Chart:
		def __init__(self, name, male, time, place):
			self.name = name
			self.male = male
			self.time = time
			self.place = place

	juan = _Chart("Peron, Juan", True, t_juan, place_lobos)
	evita = _Chart("Peron, Evita", False, t_evita, place_ba)
	older, younger = classify_older_younger(juan, evita)
	tuple_ = partner_horoscope_datetime_tuple(older, younger)
	assert tuple_[3:] == (15, 11, 53)
	assert tuple_[:3] == (1872, 3, 11)
