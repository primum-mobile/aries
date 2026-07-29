# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import common

from aries.astrology.transit_fast import api, python_reference
from aries.astrology.transit_fast.constants import default_relative_step_days_for_bodies

try:
	from aries.astrology.transit_fast import _transit_kernel as kernel
except ImportError:  # pragma: no cover
	kernel = None


def test_reference_vs_kernel():
	if kernel is None:
		return
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(astrology.SE_MERCURY, 2461041.5, 2461406.5, [0.0, 90.0, 180.0, 270.0])
	)
	cython_hits = api._materialize_hits(
		kernel.search_longitude_transits_raw(
			astrology.SE_MERCURY,
			2461041.5,
			2461406.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=common.get_ephe_path(),
		)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.target_deg == right.target_deg


def test_reference_vs_kernel_moon():
	if kernel is None:
		return
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(astrology.SE_MOON, 2461041.5, 2461071.5, [0.0, 90.0, 180.0, 270.0])
	)
	cython_hits = api._materialize_hits(
		kernel.search_longitude_transits_raw(
			astrology.SE_MOON,
			2461041.5,
			2461071.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=common.get_ephe_path(),
		)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.target_deg == right.target_deg


def test_public_api_matches_reference_for_pluto_sign_changes():
	if kernel is None:
		return
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(
			astrology.SE_PLUTO,
			astrology.swe_julday(2023, 1, 1, 0.0, astrology.SE_GREG_CAL),
			astrology.swe_julday(2024, 1, 1, 0.0, astrology.SE_GREG_CAL),
			[300.0],
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		)
	)
	public_hits = api.search_longitude_transits(
		astrology.SE_PLUTO,
		astrology.swe_julday(2023, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2024, 1, 1, 0.0, astrology.SE_GREG_CAL),
		[300.0],
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	)
	assert len(reference) == len(public_hits) == 2
	for left, right in zip(reference, public_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.target_deg == right.target_deg
		assert left.retrograde == right.retrograde


def test_relative_aspects_reference_vs_kernel_slow_pair():
	if kernel is None:
		return
	step = default_relative_step_days_for_bodies(
		[astrology.SE_NEPTUNE, astrology.SE_SATURN],
		[(0, 1, 0.0)],
	)
	reference = python_reference.search_relative_aspects_batch_raw(
		[astrology.SE_NEPTUNE, astrology.SE_SATURN],
		astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2026, 4, 23, 0.0, astrology.SE_GREG_CAL),
		[(0, 1, 0.0)],
		ephe_path=common.get_ephe_path(),
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		step_days=step,
	)
	cython_hits = kernel.search_relative_aspects_batch_raw(
		[astrology.SE_NEPTUNE, astrology.SE_SATURN],
		astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2026, 4, 23, 0.0, astrology.SE_GREG_CAL),
		[(0, 1, 0.0)],
		ephe_path=common.get_ephe_path(),
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		step_days=step,
	)
	assert len(reference) == len(cython_hits) == 1
	assert abs(reference[0][0] - cython_hits[0][0]) < 1e-6
