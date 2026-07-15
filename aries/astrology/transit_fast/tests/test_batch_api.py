# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
from unittest import mock

from aries.astrology.transit_fast import api, python_reference
from aries.astrology.transit_fast.constants import default_relative_step_days_for_bodies

try:
	from aries.astrology.transit_fast import _transit_kernel as kernel
except ImportError:  # pragma: no cover
	kernel = None


def test_year_batch_matches_concatenated_single_planet_searches():
	planets = [astrology.SE_MERCURY, astrology.SE_SATURN]
	batched = api.search_year_transits_batch(planets, 2461041.5, 2461406.5, [0.0, 90.0], [0.0, 60.0, 90.0, 180.0])
	separate = []
	for planet in planets:
		separate.extend(api.search_year_transits(planet, 2461041.5, 2461406.5, [0.0, 90.0], [0.0, 60.0, 90.0, 180.0]))
	separate = api._assign_pass_indexes(separate)
	assert [(hit.jd_ut, hit.planet, hit.target_deg, hit.aspect_deg) for hit in batched] == [
		(hit.jd_ut, hit.planet, hit.target_deg, hit.aspect_deg) for hit in separate
	]


def test_station_batch_matches_reference_kernel():
	if kernel is None:
		return
	planets = [astrology.SE_MERCURY, astrology.SE_SATURN]
	reference = api._materialize_hits(
		python_reference.search_station_times_batch_raw(planets, 2461041.5, 2461406.5)
	)
	cython_hits = api._materialize_hits(
		kernel.search_station_times_batch_raw(planets, 2461041.5, 2461406.5)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.planet == right.planet
		assert left.hit_type == right.hit_type


def test_relative_default_step_uses_fastest_body_cap_for_slow_pair():
	step = default_relative_step_days_for_bodies(
		[astrology.SE_NEPTUNE, astrology.SE_SATURN],
		[(0, 1, 0.0)],
	)
	assert step == 2.0


def test_relative_batch_finds_only_2026_neptune_saturn_conjunction():
	hits = api.search_relative_aspects_batch_raw(
		[astrology.SE_NEPTUNE, astrology.SE_SATURN],
		astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2026, 4, 23, 0.0, astrology.SE_GREG_CAL),
		[(0, 1, 0.0)],
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	)
	assert len(hits) == 1
	year, month, day, hour = astrology.swe_revjul(hits[0][0], astrology.SE_GREG_CAL)
	assert (int(year), int(month), int(day)) == (2026, 2, 20)


def test_relative_batch_preserves_three_pass_saturn_neptune_cycle():
	hits = api.search_relative_aspects_batch_raw(
		[astrology.SE_SATURN, astrology.SE_NEPTUNE],
		astrology.swe_julday(1988, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(1991, 1, 1, 0.0, astrology.SE_GREG_CAL),
		[(0, 1, 0.0)],
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	)
	assert len(hits) == 3
	assert [
		tuple(int(value) for value in astrology.swe_revjul(hit[0], astrology.SE_GREG_CAL)[:3])
		for hit in hits
	] == [
		(1989, 3, 3),
		(1989, 6, 24),
		(1989, 11, 13),
	]


def test_relative_batch_preserves_uranus_neptune_cycles():
	hits = api.search_relative_aspects_batch_raw(
		[astrology.SE_NEPTUNE, astrology.SE_URANUS],
		astrology.swe_julday(1700, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2027, 1, 1, 0.0, astrology.SE_GREG_CAL),
		[(0, 1, 0.0)],
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	)
	assert [
		tuple(int(value) for value in astrology.swe_revjul(hit[0], astrology.SE_GREG_CAL)[:3])
		for hit in hits
	] == [
		(1821, 3, 22),
		(1821, 5, 3),
		(1821, 12, 3),
		(1993, 2, 2),
		(1993, 8, 20),
		(1993, 10, 24),
	]


def test_relative_batch_falls_back_when_jump_validation_fails():
	if kernel is None:
		return
	body_codes = [astrology.SE_NEPTUNE, astrology.SE_SATURN]
	specs = [(0, 1, 0.0)]
	step = default_relative_step_days_for_bodies(body_codes, specs)
	expected = kernel.search_relative_aspects_batch_raw(
		body_codes,
		astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2026, 4, 23, 0.0, astrology.SE_GREG_CAL),
		specs,
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		step_days=step,
	)
	with mock.patch.object(api, '_search_relative_aspect_jump_raw', side_effect=api._JumpSearchFallback('forced')):
		actual = api.search_relative_aspects_batch_raw(
			body_codes,
			astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
			astrology.swe_julday(2026, 4, 23, 0.0, astrology.SE_GREG_CAL),
			specs,
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		)
	assert expected == actual
