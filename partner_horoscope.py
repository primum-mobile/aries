# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Partner horoscope (A. Marr time-distance offset).

Marr describes offsetting the older partner's birth back by the elapsed time
between the two nativities when the younger partner was born later; the chart is
read for the younger partner's birthplace. See A. Marr, *Prediction* III, p. 10
(Juan Perón / Evita Perón worked example → 11.03.1872 15:11:53, Buenos Aires).

    t_partner = t_older - (t_younger - t_older) = 2 * t_older - t_younger
"""

from __future__ import annotations

import copy
from typing import Tuple

import astrology
import chart
import mtexts
from engine import calendar_policy


def partner_horoscope_jd(jd_older: float, jd_younger: float) -> float:
	"""Julian day of the partner-horoscope epoch (Marr III p. 10)."""
	return (2.0 * float(jd_older)) - float(jd_younger)


def _marr_input_jd(chrt) -> float:
	"""Julian day for Marr offset math from radix clock fields (treated as U.T.).

	Marr III p. 10 subtracts the civil date/time labels of the two births as
	universal time. That matches Zet/Astrodatabank-style exports where the same
	clock figures are used for the partner line, independent of each radix's
	zone/LMT conversion used for its own wheel.
	"""
	t = chrt.time
	year = int(t.origyear)
	month = int(t.origmonth)
	day = int(t.origday)
	hour_float = float(t.hour) + float(t.minute) / 60.0 + float(t.second) / 3600.0
	if bool(t.bc):
		year = 1 - year
	calflag = astrology.SE_JUL_CAL if t.cal == chart.Time.JULIAN else astrology.SE_GREG_CAL
	return float(astrology.swe_julday(year, month, day, hour_float, calflag))


def classify_older_younger(chrt_a, chrt_b):
	"""Return (older_chart, younger_chart) ordered by birth instant (UT jd)."""
	jd_a = float(getattr(chrt_a.time, "jd", 0.0))
	jd_b = float(getattr(chrt_b.time, "jd", 0.0))
	if jd_a <= jd_b:
		return chrt_a, chrt_b
	return chrt_b, chrt_a


def _chart_time_from_jd(jd: float, place) -> chart.Time:
	"""Build chart time for a UT Julian day at ``place`` (Marr III p. 10).

	Marr's partner epoch is computed in universal time. The resulting clock must
	be stored as GMT/UT (``Time.GREENWICH``), not reinterpreted through either
	partner's zone or LMT flags — doing so shifts the displayed local time (e.g.
	Perón → 19:10 LC instead of 15:11:53).
	"""
	cal = chart.Time.GREGORIAN
	if calendar_policy.calendar_for_jd(jd) == calendar_policy.CALENDAR_JULIAN:
		cal = chart.Time.JULIAN
	calflag = astrology.SE_JUL_CAL if cal == chart.Time.JULIAN else astrology.SE_GREG_CAL

	year, month, day, hour_float = astrology.swe_revjul(float(jd), calflag)
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
		import util

		year, month, day = util.incrDay(int(year), int(month), int(day))

	bc = int(year) <= 0
	if bc:
		year = 1 - int(year)

	return chart.Time(
		int(year),
		int(month),
		int(day),
		int(hour),
		int(minute),
		int(second),
		bc,
		cal,
		chart.Time.GREENWICH,
		True,
		0,
		0,
		False,
		place,
		False,
		tzid="",
		tzauto=False,
	)


def partner_horoscope_datetime_tuple(older_chrt, younger_chrt) -> Tuple[int, int, int, int, int, int]:
	"""Wall-clock components for the partner-horoscope epoch (older reference calendar)."""
	older, younger = older_chrt, younger_chrt
	jd = partner_horoscope_jd(_marr_input_jd(older), _marr_input_jd(younger))
	time_obj = _chart_time_from_jd(jd, younger.place)
	return (
		int(time_obj.year),
		int(time_obj.month),
		int(time_obj.day),
		int(time_obj.hour),
		int(time_obj.minute),
		int(time_obj.second),
	)


def build_partner_horoscope_chart(chrt_a, chrt_b, opts, name=None):
	"""Build a radix-style partner horoscope for two nativities (Marr III p. 10)."""
	older, younger = classify_older_younger(chrt_a, chrt_b)
	jd = partner_horoscope_jd(_marr_input_jd(older), _marr_input_jd(younger))
	place = younger.place
	time = _chart_time_from_jd(jd, place)
	label = mtexts.txts.get("PartnerHoroscope", "Partner Horoscope")
	default_name = "%s & %s %s" % (
		getattr(older, "name", "") or "Partner",
		getattr(younger, "name", "") or "Partner",
		label,
	)
	chart_name = name or default_name
	result = chart.Chart(
		chart_name,
		bool(getattr(younger, "male", True)),
		time,
		place,
		chart.Chart.RADIX,
		mtexts.txts.get("PartnerHoroscopeChart", "Partner horoscope (Marr III p. 10)"),
		copy.deepcopy(opts),
		full=False,
	)
	result.full = True
	result.is_partner_horoscope = True
	result.partner_horoscope_source_pair = (older, younger)
	if result.full:
		from compositechart import _materialize_full_chart_state

		_materialize_full_chart_state(result)
	return result
