# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import common
import threading
import time
from unittest import mock

import pytest

from aries.astrology.transit_fast import api, python_reference
from aries.astrology.transit_fast.constants import default_relative_step_days_for_bodies

try:
	from aries.astrology.transit_fast import _transit_kernel as kernel
except ImportError:  # pragma: no cover
	kernel = None


def test_native_backend_rejects_stale_context_abi():
	class StaleKernel:
		@staticmethod
		def search_longitude_transits_raw(
			planet,
			jd_start,
			jd_end,
			targets_deg,
			ephe_path=None,
			flags=0,
		):
			return []

	error = api._native_backend_compatibility_error(StaleKernel)

	assert error is not None
	assert "ABI mismatch" in error
	assert "sidereal_mode" in error
	assert "topocentric_position" in error


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
	context_kwargs = {
		'ephe_path': common.get_ephe_path(),
		'flags': astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	}
	reference = api._materialize_hits(
		python_reference.search_station_times_batch_raw(
			planets,
			2461041.5,
			2461406.5,
			**context_kwargs,
		)
	)
	cython_hits = api._materialize_hits(
		kernel.search_station_times_batch_raw(
			planets,
			2461041.5,
			2461406.5,
			**context_kwargs,
		)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.planet == right.planet
		assert left.hit_type == right.hit_type


def test_native_longitude_scan_releases_the_python_gil():
	if kernel is None:
		return
	start_jd = astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2020, 1, 1, 0.0, astrology.SE_GREG_CAL)
	started = threading.Event()
	finished = threading.Event()

	def scan():
		started.set()
		try:
			kernel.search_longitude_transits_batch_raw(
				[
					astrology.SE_SATURN,
					astrology.SE_URANUS,
					astrology.SE_NEPTUNE,
					astrology.SE_PLUTO,
					astrology.SE_MEAN_NODE,
				],
				start_jd,
				end_jd,
				[float(value) for value in range(0, 360, 10)],
				ephe_path=common.get_ephe_path(),
				flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
			)
		finally:
			finished.set()

	worker = threading.Thread(target=scan)
	worker.start()
	assert started.wait(timeout=1.0)
	time.sleep(0.03)
	assert worker.is_alive(), "native scan finished before the GIL probe could observe it"
	python_iterations = 0
	while not finished.is_set():
		python_iterations += 1
		time.sleep(0.001)
	worker.join(timeout=2.0)

	assert not worker.is_alive()
	assert python_iterations > 10


@pytest.mark.parametrize(
	"specs",
	[
		[(-1, 1, 0.0)],
		[(0, 2, 0.0)],
	],
)
def test_relative_batch_rejects_out_of_range_indices_without_poisoning_native_lock(specs):
	start_jd = astrology.swe_julday(2026, 1, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2026, 2, 1, 0.0, astrology.SE_GREG_CAL)
	with pytest.raises(ValueError, match="index is out of range"):
		api.search_relative_aspects_batch_raw(
			[astrology.SE_SATURN, astrology.SE_NEPTUNE],
			start_jd,
			end_jd,
			specs,
		)

	assert isinstance(
		api.search_relative_aspects_batch_raw(
			[astrology.SE_SATURN, astrology.SE_NEPTUNE],
			start_jd,
			end_jd,
			[(0, 1, 0.0)],
		),
		list,
	)


@pytest.mark.parametrize("step_days", [0.0, -1.0, float("nan"), float("inf")])
def test_relative_batch_rejects_non_positive_or_non_finite_steps(step_days):
	start_jd = astrology.swe_julday(2026, 1, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2026, 2, 1, 0.0, astrology.SE_GREG_CAL)
	with pytest.raises(ValueError, match="step_days"):
		api.search_relative_aspects_batch_raw(
			[astrology.SE_SATURN, astrology.SE_NEPTUNE],
			start_jd,
			end_jd,
			[(0, 1, 0.0)],
			step_days=step_days,
		)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_bounded_native_slices_let_a_short_query_finish_during_a_broad_scan():
	broad_started = threading.Event()
	broad_finished = threading.Event()
	broad_error: list[BaseException] = []
	ephe_path = common.get_ephe_path()
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED

	def broad_scan():
		broad_started.set()
		try:
			kernel.search_longitude_transits_batch_raw(
				[
					astrology.SE_SATURN,
					astrology.SE_URANUS,
					astrology.SE_NEPTUNE,
					astrology.SE_PLUTO,
					astrology.SE_MEAN_NODE,
				],
				astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL),
				astrology.swe_julday(2120, 1, 1, 0.0, astrology.SE_GREG_CAL),
				[float(value) for value in range(0, 360, 10)],
				ephe_path=ephe_path,
				flags=flags,
			)
		except BaseException as exc:
			broad_error.append(exc)
		finally:
			broad_finished.set()

	worker = threading.Thread(target=broad_scan)
	worker.start()
	assert broad_started.wait(timeout=1.0)
	time.sleep(0.03)
	assert worker.is_alive(), "broad native scan was not long enough to test lock handoff"

	short_started_at = time.perf_counter()
	kernel.search_longitude_transits_batch_raw(
		[astrology.SE_PLUTO],
		astrology.swe_julday(2026, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2026, 2, 1, 0.0, astrology.SE_GREG_CAL),
		[0.0, 90.0, 180.0, 270.0],
		ephe_path=ephe_path,
		flags=flags,
	)
	short_elapsed = time.perf_counter() - short_started_at

	assert short_elapsed < 0.5
	assert not broad_finished.is_set()
	worker.join(timeout=10.0)
	assert not worker.is_alive()
	assert broad_error == []


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
		ephe_path=common.get_ephe_path(),
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
