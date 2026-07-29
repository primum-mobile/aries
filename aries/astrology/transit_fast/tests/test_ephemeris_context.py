# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from types import SimpleNamespace
from unittest import mock
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import importlib
import threading
import time

import astrology
import common
import pytest
import sweastrology
import transits

from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import api, python_reference

try:
	from aries.astrology.transit_fast import _transit_kernel as kernel
except ImportError:  # pragma: no cover
	kernel = None


def _year_bounds() -> tuple[float, float]:
	return (
		astrology.swe_julday(2026, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2027, 1, 1, 0.0, astrology.SE_GREG_CAL),
	)


def _assert_raw_parity(left: list[tuple], right: list[tuple]) -> None:
	assert len(left) == len(right)
	for reference_hit, kernel_hit in zip(left, right):
		assert reference_hit[1:5] == kernel_hit[1:5]
		assert abs(float(reference_hit[0]) - float(kernel_hit[0])) * 86400.0 < 0.01


def test_context_for_chart_captures_complete_sidereal_topocentric_state():
	chrt = SimpleNamespace(
		options=SimpleNamespace(ayanamsha=2, topocentric=True),
		place=SimpleNamespace(lon=13.405, lat=52.52, altitude=34.0),
	)
	context = EphemerisContext.for_chart(chrt, ephe_path="/ephemeris")

	assert context.flags & astrology.SEFLG_SIDEREAL
	assert context.flags & astrology.SEFLG_TOPOCTR
	assert context.flags & astrology.SEFLG_SPEED
	assert context.sidereal_mode == astrology.ayanamsha_swe_mode(2)
	assert context.topocentric_position == (13.405, 52.52, 34.0)


def test_explicit_context_rejects_incomplete_frame_flags():
	with pytest.raises(ValueError, match="sidereal_mode"):
		EphemerisContext(
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SIDEREAL,
			ephe_path=common.get_ephe_path(),
		)
	with pytest.raises(ValueError, match="topocentric_position"):
		EphemerisContext(
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_TOPOCTR,
			ephe_path=common.get_ephe_path(),
			)


def test_legacy_context_without_path_is_not_native_compatible():
	context = EphemerisContext.legacy(
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		ephe_path=None,
	)

	assert not context.is_complete
	assert not context.is_native_compatible


def test_root_context_does_not_flush_ephemeris_cache_when_path_is_unchanged(monkeypatch):
	path = common.get_ephe_path()
	context = EphemerisContext(flags=astrology.SEFLG_SWIEPH, ephe_path=path)
	calls = []
	monkeypatch.setattr(astrology, "_SWISS_EPHE_PATH", None)
	monkeypatch.setitem(
		astrology._RAW_SWE_FUNCTIONS,
		"swe_set_ephe_path",
		lambda value: calls.append(value),
	)

	context.apply()
	context.apply()

	assert calls == [path]


def test_direct_sweastrology_setter_keeps_context_cache_coherent(monkeypatch):
	calls = []
	monkeypatch.setitem(
		astrology._RAW_SWE_FUNCTIONS,
		"swe_set_topo",
		lambda *value: calls.append(tuple(value)),
	)
	monkeypatch.setattr(astrology, "_SWISS_TOPO", None)
	first = (13.405, 52.52, 34.0)
	second = (-74.006, 40.7128, 10.0)

	astrology.swe_set_topo(*first)
	sweastrology.swe_set_topo(*second)
	astrology.swe_set_topo(*first)

	assert calls == [first, second, first]


def test_root_context_restores_ephemeris_path_after_swe_close():
	context = EphemerisContext(
		flags=astrology.SEFLG_SWIEPH,
		ephe_path=common.get_ephe_path(),
	)
	context.apply()
	astrology.swe_close()
	assert astrology._SWISS_EPHE_PATH is None
	context.apply()
	assert astrology._SWISS_EPHE_PATH == common.get_ephe_path()


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_outer_return_jump_is_exact_bounded_and_fast():
	context = EphemerisContext(
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		ephe_path=common.get_ephe_path(),
	)
	reference_jd = astrology.swe_julday(1980, 1, 1, 11.0, astrology.SE_GREG_CAL)
	anchor_jd = astrology.swe_julday(2026, 7, 24, 0.0, astrology.SE_GREG_CAL)
	spans = []
	original_search = api.search_longitude_transits

	def measured_search(planet, jd_start, jd_end, targets_deg, **kwargs):
		spans.append(float(jd_end) - float(jd_start))
		return original_search(planet, jd_start, jd_end, targets_deg, **kwargs)

	started = time.perf_counter()
	with mock.patch.object(api, "search_longitude_transits", side_effect=measured_search):
		for planet in (
			astrology.SE_SATURN,
			astrology.SE_URANUS,
			astrology.SE_NEPTUNE,
			astrology.SE_PLUTO,
		):
			with context.activate():
				target, _speed = python_reference._eval_lon_speed(
					reference_jd, planet, context.flags,
				)
			hit = api.search_adjacent_longitude_transit(
				planet,
				anchor_jd,
				target,
				1,
				reference_jd=reference_jd,
				context=context,
			)
			assert hit is not None
			with context.activate():
				actual, _speed = python_reference._eval_lon_speed(
					hit.jd_ut, planet, context.flags,
				)
			assert abs(api.wrap180(actual - target)) < 1e-6

	elapsed = time.perf_counter() - started
	assert max(spans) <= 2400.0
	assert elapsed < 0.25


def test_root_context_executor_is_atomic_across_incompatible_threads():
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	contexts = (
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_LAHIRI,
			topocentric_position=(13.405, 52.52, 34.0),
		),
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
			topocentric_position=(-74.006, 40.7128, 10.0),
		),
	)
	jd_ut = astrology.swe_julday(2026, 7, 1, 12.0, astrology.SE_GREG_CAL)

	def longitude(context: EphemerisContext) -> float:
		with context.activate():
			return float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, context.flags)[1][0])

	expected = tuple(longitude(context) for context in contexts)
	barrier = threading.Barrier(2)

	def worker(index: int) -> None:
		context = contexts[index]
		for _ in range(25):
			barrier.wait()
			with context.activate():
				first = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, context.flags)[1][0])
				time.sleep(0.0001)
				second = float(sweastrology.swe_calc_ut(jd_ut, astrology.SE_MOON, context.flags)[1][0])
			assert first == expected[index]
			assert second == expected[index]

	with ThreadPoolExecutor(max_workers=2) as executor:
		futures = [executor.submit(worker, index) for index in range(2)]
		for future in futures:
			future.result()


def test_nested_context_restores_outer_sidereal_and_topocentric_state():
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	outer = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
		topocentric_position=(13.405, 52.52, 34.0),
	)
	inner = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
		topocentric_position=(-74.006, 40.7128, 10.0),
	)
	jd_ut = astrology.swe_julday(2026, 7, 1, 12.0, astrology.SE_GREG_CAL)

	with outer.activate():
		expected = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])
	with outer.activate():
		before = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])
		with inner.activate():
			inner_value = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])
		after = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])

	assert before == expected
	assert after == expected
	assert inner_value != expected


def test_legacy_set_then_calculate_restores_each_threads_context():
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	contexts = (
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_LAHIRI,
			topocentric_position=(13.405, 52.52, 34.0),
		),
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
			topocentric_position=(-74.006, 40.7128, 10.0),
		),
	)
	jd_ut = astrology.swe_julday(2026, 7, 1, 12.0, astrology.SE_GREG_CAL)

	def longitude(context: EphemerisContext) -> float:
		with context.activate():
			return float(sweastrology.swe_calc_ut(jd_ut, astrology.SE_MOON, flags)[1][0])

	expected = tuple(longitude(context) for context in contexts)
	barrier = threading.Barrier(2)

	def worker(index: int) -> None:
		context = contexts[index]
		sweastrology.swe_set_ephe_path(context.ephe_path)
		sweastrology.swe_set_sid_mode(context.sidereal_mode, 0.0, 0.0)
		sweastrology.swe_set_topo(*context.topocentric_position)
		for _ in range(25):
			barrier.wait()
			longitude_value = float(
				sweastrology.swe_calc_ut(jd_ut, astrology.SE_MOON, flags)[1][0]
			)
			assert longitude_value == expected[index]
			barrier.wait()

	with ThreadPoolExecutor(max_workers=2) as executor:
		futures = [executor.submit(worker, index) for index in range(2)]
		for future in futures:
			future.result()


def test_astrology_reload_preserves_original_extension_functions():
	reloaded = importlib.reload(astrology)
	reloaded.swe_set_ephe_path(common.get_ephe_path())
	jd_ut = reloaded.swe_julday(2026, 7, 1, 12.0, reloaded.SE_GREG_CAL)
	result = sweastrology.swe_calc_ut(jd_ut, reloaded.SE_MOON, reloaded.SEFLG_SWIEPH)

	assert len(result[1]) >= 4


def test_native_context_spans_sort_and_dedupe_shared_boundaries():
	context = EphemerisContext(
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		ephe_path=common.get_ephe_path(),
	)
	calls: list[tuple[float, float]] = []

	def fake_native_method(_planets, jd_start, jd_end, _targets, **_kwargs):
		calls.append((float(jd_start), float(jd_end)))
		return [
			(float(jd_start), astrology.SE_SATURN, 0.0, 0.0, 0, 1.0, False),
			(float(jd_end), astrology.SE_SATURN, 0.0, 0.0, 0, 1.0, False),
		]

	result = api._call_native_backend_in_spans(
		context,
		fake_native_method,
		[astrology.SE_SATURN],
		100.0,
		130.0,
		[0.0],
	)

	assert calls == [(100.0, 114.0), (114.0, 128.0), (128.0, 130.0)]
	assert [hit[0] for hit in result] == [100.0, 114.0, 128.0, 130.0]


def test_legacy_transit_day_uses_the_supplied_context():
	entered = []

	class RecordingContext:
		flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_TOPOCTR

		@contextmanager
		def activate(self):
			entered.append(True)
			yield

	engine = transits.Transits()
	engine._day_in_active_context = mock.Mock()
	context = RecordingContext()
	chrt = object()

	engine.day(2026, 7, 1, chrt, astrology.SE_PLUTO, 120.0, context=context)

	assert entered == [True]
	assert engine.flags == context.flags
	engine._day_in_active_context.assert_called_once_with(
		2026,
		7,
		1,
		chrt,
		astrology.SE_PLUTO,
		120.0,
	)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_incomplete_legacy_sidereal_call_never_enters_native_kernel():
	start_jd, end_jd = _year_bounds()
	with mock.patch.object(kernel, "search_longitude_transits_raw", side_effect=AssertionError("native context must be complete")):
		hits = api.search_longitude_transits(
			astrology.SE_MERCURY,
			start_jd,
			end_jd,
			[0.0],
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_SIDEREAL,
		)
	assert isinstance(hits, list)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_public_native_search_resolves_the_canonical_path_when_omitted():
	start_jd, end_jd = _year_bounds()
	with mock.patch.object(
		kernel,
		"search_longitude_transits_raw",
		wraps=kernel.search_longitude_transits_raw,
	) as native_search:
		api.search_longitude_transits(
			astrology.SE_MERCURY,
			start_jd,
			end_jd,
			[0.0],
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		)

	assert native_search.call_args.kwargs["ephe_path"] == common.get_ephe_path()


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_direct_native_search_rejects_missing_path_instead_of_inheriting_state():
	start_jd, end_jd = _year_bounds()
	with pytest.raises(ValueError, match="explicit ephe_path"):
		kernel.search_longitude_transits_raw(
			astrology.SE_MERCURY,
			start_jd,
			end_jd,
			[0.0],
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_public_native_search_reapplies_context_after_incompatible_root_work():
	start_jd, end_jd = _year_bounds()
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_SIDEREAL
	lahiri = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
	)
	fagan = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
	)
	first = api.search_longitude_transits_batch_raw(
		[astrology.SE_MERCURY],
		start_jd,
		end_jd,
		[0.0, 90.0, 180.0, 270.0],
		context=lahiri,
	)
	with fagan.activate():
		astrology.swe_calc_ut_ex(start_jd, astrology.SE_MERCURY, fagan.flags)
	second = api.search_longitude_transits_batch_raw(
		[astrology.SE_MERCURY],
		start_jd,
		end_jd,
		[0.0, 90.0, 180.0, 270.0],
		context=lahiri,
	)

	assert first == second


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_native_kernel_matches_reference_in_lahiri_context():
	start_jd, end_jd = _year_bounds()
	context = EphemerisContext(
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_SIDEREAL,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
	)
	kwargs = api._backend_context_kwargs(context)
	reference = python_reference.search_longitude_transits_raw(
		astrology.SE_MERCURY,
		start_jd,
		end_jd,
		[0.0, 90.0, 180.0, 270.0],
		**kwargs,
	)
	native = kernel.search_longitude_transits_raw(
		astrology.SE_MERCURY,
		start_jd,
		end_jd,
		[0.0, 90.0, 180.0, 270.0],
		**kwargs,
	)

	assert native
	_assert_raw_parity(reference, native)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_native_kernel_matches_reference_in_topocentric_context():
	start_jd = astrology.swe_julday(2026, 7, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2026, 8, 1, 0.0, astrology.SE_GREG_CAL)
	context = EphemerisContext(
		flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_TOPOCTR,
		ephe_path=common.get_ephe_path(),
		topocentric_position=(13.405, 52.52, 34.0),
	)
	kwargs = api._backend_context_kwargs(context)
	reference = python_reference.search_longitude_transits_raw(
		astrology.SE_MOON,
		start_jd,
		end_jd,
		[0.0],
		**kwargs,
	)
	native = kernel.search_longitude_transits_raw(
		astrology.SE_MOON,
		start_jd,
		end_jd,
		[0.0],
		**kwargs,
	)

	assert native
	_assert_raw_parity(reference, native)


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_native_context_is_reapplied_without_sidereal_cross_contamination():
	start_jd, end_jd = _year_bounds()
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_SIDEREAL
	lahiri = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
	)
	fagan = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
	)

	def calculate(context: EphemerisContext) -> list[tuple]:
		return kernel.search_longitude_transits_raw(
			astrology.SE_MERCURY,
			start_jd,
			end_jd,
			[0.0, 90.0, 180.0, 270.0],
			**api._backend_context_kwargs(context),
		)

	first_lahiri = calculate(lahiri)
	fagan_hits = calculate(fagan)
	second_lahiri = calculate(lahiri)

	assert first_lahiri == second_lahiri
	assert [round(hit[0], 7) for hit in first_lahiri] != [round(hit[0], 7) for hit in fagan_hits]


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_native_contexts_are_serialized_across_concurrent_scans():
	start_jd, end_jd = _year_bounds()
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_SIDEREAL
	contexts = (
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_LAHIRI,
		),
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
		),
	)
	targets = [0.0, 90.0, 180.0, 270.0]

	def calculate(context: EphemerisContext) -> list[tuple]:
		return kernel.search_longitude_transits_batch_raw(
			[astrology.SE_MERCURY, astrology.SE_SATURN],
			start_jd,
			end_jd,
			targets,
			**api._backend_context_kwargs(context),
		)

	expected = tuple(calculate(context) for context in contexts)
	barrier = threading.Barrier(2)

	def worker(index: int) -> None:
		for _ in range(20):
			barrier.wait()
			assert calculate(contexts[index]) == expected[index]

	with ThreadPoolExecutor(max_workers=2) as executor:
		futures = [executor.submit(worker, index) for index in range(2)]
		for future in futures:
			future.result()


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_public_native_context_spans_match_one_native_scan_for_every_method():
	start_jd, end_jd = _year_bounds()
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	context = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
		topocentric_position=(13.405, 52.52, 34.0),
	)
	context_kwargs = api._backend_context_kwargs(context)
	cases = (
		(
			"search_longitude_transits_raw",
			(astrology.SE_MERCURY, start_jd, end_jd, [0.0, 90.0, 180.0, 270.0]),
			{},
		),
		(
			"search_longitude_transits_batch_raw",
			(
				[astrology.SE_MERCURY, astrology.SE_SATURN],
				start_jd,
				end_jd,
				[0.0, 90.0, 180.0, 270.0],
			),
			{},
		),
		(
			"search_station_times_raw",
			(astrology.SE_MERCURY, start_jd, end_jd),
			{},
		),
		(
			"search_station_times_batch_raw",
			([astrology.SE_MERCURY, astrology.SE_SATURN], start_jd, end_jd),
			{},
		),
		(
			"search_relative_aspects_batch_raw",
			(
				[astrology.SE_MERCURY, astrology.SE_SATURN],
				start_jd,
				end_jd,
				[(0, 1, 0.0)],
			),
			{"step_days": 2.0},
		),
	)
	for method_name, args, kwargs in cases:
		expected = getattr(kernel, method_name)(*args, **kwargs, **context_kwargs)
		assert api._call_backend(
			context,
			method_name,
			*args,
			**kwargs,
			**context_kwargs,
		) == expected, method_name


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_broad_public_native_search_yields_to_interactive_python_context():
	start_jd = astrology.swe_julday(2000, 1, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2060, 1, 1, 0.0, astrology.SE_GREG_CAL)
	jd_ut = astrology.swe_julday(2026, 7, 15, 12.0, astrology.SE_GREG_CAL)
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	search_context = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_LAHIRI,
		topocentric_position=(13.405, 52.52, 34.0),
	)
	interactive_context = EphemerisContext(
		flags=flags,
		ephe_path=common.get_ephe_path(),
		sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
		topocentric_position=(-74.006, 40.7128, 10.0),
	)
	with interactive_context.activate():
		expected = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])

	search_started = threading.Event()
	search_finished = threading.Event()
	search_error: list[BaseException] = []

	def broad_search() -> None:
		search_started.set()
		try:
			api.search_longitude_transits_batch_raw(
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
				context=search_context,
			)
		except BaseException as exc:
			search_error.append(exc)
		finally:
			search_finished.set()

	worker = threading.Thread(target=broad_search)
	worker.start()
	assert search_started.wait(timeout=1.0)
	time.sleep(0.03)
	assert worker.is_alive(), "broad Search was not long enough to test context handoff"

	interactive_started_at = time.perf_counter()
	with interactive_context.activate():
		actual = float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])
	interactive_elapsed = time.perf_counter() - interactive_started_at

	assert actual == expected
	assert interactive_elapsed < 0.25
	assert not search_finished.is_set()
	worker.join(timeout=10.0)
	assert not worker.is_alive()
	assert search_error == []


@pytest.mark.skipif(kernel is None, reason="native transit kernel is unavailable")
def test_public_native_and_python_calls_share_one_context_boundary():
	start_jd = astrology.swe_julday(2026, 7, 1, 0.0, astrology.SE_GREG_CAL)
	end_jd = astrology.swe_julday(2026, 8, 1, 0.0, astrology.SE_GREG_CAL)
	jd_ut = astrology.swe_julday(2026, 7, 15, 12.0, astrology.SE_GREG_CAL)
	flags = (
		astrology.SEFLG_SWIEPH
		| astrology.SEFLG_SPEED
		| astrology.SEFLG_SIDEREAL
		| astrology.SEFLG_TOPOCTR
	)
	contexts = (
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_LAHIRI,
			topocentric_position=(13.405, 52.52, 34.0),
		),
		EphemerisContext(
			flags=flags,
			ephe_path=common.get_ephe_path(),
			sidereal_mode=astrology.SE_SIDM_FAGAN_BRADLEY,
			topocentric_position=(-74.006, 40.7128, 10.0),
		),
	)
	targets = [0.0, 90.0, 180.0, 270.0]

	def native_result(context: EphemerisContext) -> list[tuple]:
		return api.search_longitude_transits_batch_raw(
			[astrology.SE_MERCURY, astrology.SE_SATURN],
			start_jd,
			end_jd,
			targets,
			context=context,
		)

	def python_result(context: EphemerisContext) -> float:
		with context.activate():
			return float(astrology.swe_calc_ut_ex(jd_ut, astrology.SE_MOON, flags)[1][0])

	expected_native = native_result(contexts[0])
	expected_python = python_result(contexts[1])
	barrier = threading.Barrier(2)

	def native_worker() -> None:
		for _ in range(20):
			barrier.wait()
			assert native_result(contexts[0]) == expected_native
			barrier.wait()

	def python_worker() -> None:
		for _ in range(20):
			barrier.wait()
			assert python_result(contexts[1]) == expected_python
			barrier.wait()

	with ThreadPoolExecutor(max_workers=2) as executor:
		futures = [executor.submit(native_worker), executor.submit(python_worker)]
		for future in futures:
			future.result()
