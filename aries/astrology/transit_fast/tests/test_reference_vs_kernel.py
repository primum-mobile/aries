# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import common
from unittest import mock

import pytest

from aries.astrology.transit_fast import api, python_reference
from aries.astrology.transit_fast.constants import default_relative_step_days_for_bodies

try:
	from aries.astrology.transit_fast import _transit_kernel as kernel
except ImportError:  # pragma: no cover
	kernel = None


def test_reference_vs_kernel():
	if kernel is None:
		return
	# The Python extension and native kernel embed separate Swiss contexts;
	# parity requires the same explicit ephemeris dataset on both sides.
	ephe_path = common.get_ephe_path()
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(
			astrology.SE_MERCURY,
			2461041.5,
			2461406.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=ephe_path,
		)
	)
	cython_hits = api._materialize_hits(
		kernel.search_longitude_transits_raw(
			astrology.SE_MERCURY,
			2461041.5,
			2461406.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=ephe_path,
		)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.target_deg == right.target_deg


def test_reference_vs_kernel_moon():
	if kernel is None:
		return
	ephe_path = common.get_ephe_path()
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(
			astrology.SE_MOON,
			2461041.5,
			2461071.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=ephe_path,
		)
	)
	cython_hits = api._materialize_hits(
		kernel.search_longitude_transits_raw(
			astrology.SE_MOON,
			2461041.5,
			2461071.5,
			[0.0, 90.0, 180.0, 270.0],
			ephe_path=ephe_path,
		)
	)
	assert len(reference) == len(cython_hits)
	for left, right in zip(reference, cython_hits):
		assert abs(left.jd_ut - right.jd_ut) < 1e-6
		assert left.target_deg == right.target_deg


def test_public_api_matches_reference_for_pluto_sign_changes():
	if kernel is None:
		return
	ephe_path = common.get_ephe_path()
	reference = api._materialize_hits(
		python_reference.search_longitude_transits_raw(
			astrology.SE_PLUTO,
			astrology.swe_julday(2023, 1, 1, 0.0, astrology.SE_GREG_CAL),
			astrology.swe_julday(2024, 1, 1, 0.0, astrology.SE_GREG_CAL),
			[300.0],
			ephe_path=ephe_path,
			flags=astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
		)
	)
	public_hits = api.search_longitude_transits(
		astrology.SE_PLUTO,
		astrology.swe_julday(2023, 1, 1, 0.0, astrology.SE_GREG_CAL),
		astrology.swe_julday(2024, 1, 1, 0.0, astrology.SE_GREG_CAL),
		[300.0],
		ephe_path=ephe_path,
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


def _synthetic_relative_evaluator(curve, derivative):
	def evaluate(jd_ut, body_code, _flags):
		if int(body_code) == 101:
			return 100.0 + float(curve(float(jd_ut))), float(derivative(float(jd_ut)))
		if int(body_code) == 102:
			return 100.0, 0.0
		raise AssertionError(f"unexpected synthetic body {body_code}")

	return evaluate


def test_relative_reference_recovers_off_centre_tangent_without_endpoint_sign_change():
	turn = 0.37
	with mock.patch.object(
		python_reference,
		"_eval_body_lon_speed",
		new=_synthetic_relative_evaluator(
			lambda jd: (jd - turn) ** 2,
			lambda jd: 2.0 * (jd - turn),
		),
	):
		hits = python_reference.search_relative_aspects_batch_raw(
			[101, 102],
			0.0,
			1.0,
			[(0, 1, 0.0)],
			step_days=1.0,
			eps_deg=1e-10,
			eps_days=1e-10,
		)

	assert len(hits) == 1
	assert abs(float(hits[0][0]) - turn) <= 1e-9


def test_relative_reference_rejects_tangent_near_miss():
	turn = 0.37
	with mock.patch.object(
		python_reference,
		"_eval_body_lon_speed",
		new=_synthetic_relative_evaluator(
			lambda jd: 1e-4 + (jd - turn) ** 2,
			lambda jd: 2.0 * (jd - turn),
		),
	):
		hits = python_reference.search_relative_aspects_batch_raw(
			[101, 102],
			0.0,
			1.0,
			[(0, 1, 0.0)],
			step_days=1.0,
			eps_deg=1e-8,
			eps_days=1e-10,
		)

	assert hits == []


def test_relative_reference_splits_at_turn_to_recover_double_roots():
	turn = 0.37
	with mock.patch.object(
		python_reference,
		"_eval_body_lon_speed",
		new=_synthetic_relative_evaluator(
			lambda jd: (jd - turn) ** 2 - 0.04,
			lambda jd: 2.0 * (jd - turn),
		),
	):
		hits = python_reference.search_relative_aspects_batch_raw(
			[101, 102],
			0.0,
			1.0,
			[(0, 1, 0.0)],
			step_days=1.0,
			eps_deg=1e-10,
			eps_days=1e-10,
		)

	assert len(hits) == 2
	assert [float(hit[0]) for hit in hits] == pytest.approx([0.17, 0.57], abs=1e-9)


def test_relative_reference_dedupes_boundary_tangent_and_caches_turn_per_pair():
	turn = 0.37
	evaluator = _synthetic_relative_evaluator(
		lambda jd: (jd - turn) ** 2,
		lambda jd: 2.0 * (jd - turn),
	)
	with (
		mock.patch.object(python_reference, "_eval_body_lon_speed", new=evaluator),
		mock.patch.object(
			python_reference,
			"_refine_relative_speed_turn",
			wraps=python_reference._refine_relative_speed_turn,
		) as refine_turn,
	):
		hits = python_reference.search_relative_aspects_batch_raw(
			[101, 102],
			0.0,
			1.0,
			[(0, 1, 0.0), (0, 1, 10.0)],
			step_days=1.0,
			eps_deg=1e-10,
			eps_days=1e-10,
		)

	assert [int(hit[1]) for hit in hits] == [0]
	assert refine_turn.call_count == 1

	boundary_turn = 1.0
	with mock.patch.object(
		python_reference,
		"_eval_body_lon_speed",
		new=_synthetic_relative_evaluator(
			lambda jd: (jd - boundary_turn) ** 2,
			lambda jd: 2.0 * (jd - boundary_turn),
		),
	):
		boundary_hits = python_reference.search_relative_aspects_batch_raw(
			[101, 102],
			0.0,
			2.0,
			[(0, 1, 0.0)],
			step_days=1.0,
			eps_deg=1e-10,
			eps_days=1e-10,
		)

	assert len(boundary_hits) == 1
	assert abs(float(boundary_hits[0][0]) - boundary_turn) <= 1e-9


def test_longitude_reference_emits_one_exact_tangent_not_segment_duplicates():
	turn = 0.37

	def evaluate(jd_ut, _planet, _flags):
		jd = float(jd_ut)
		return 10.0 + (jd - turn) ** 2, 2.0 * (jd - turn)

	with mock.patch.object(python_reference, "_eval_lon_speed", new=evaluate):
		hits = python_reference.search_longitude_transits_raw(
			101,
			0.0,
			1.0,
			[10.0],
			step_days=1.0,
			eps_deg=1e-10,
			eps_days=1e-10,
		)

	assert len(hits) == 1
	assert abs(float(hits[0][0]) - turn) <= 1e-9


def test_relative_real_coarse_saturn_neptune_matches_fine_reference_and_kernel():
	if kernel is None:
		return
	body_codes = [astrology.SE_SATURN, astrology.SE_NEPTUNE]
	specs = [(0, 1, 0.0)]
	jd_start = astrology.swe_julday(1989, 5, 15, 0.0, astrology.SE_GREG_CAL)
	jd_end = astrology.swe_julday(1989, 12, 1, 0.0, astrology.SE_GREG_CAL)
	kwargs = {
		"ephe_path": common.get_ephe_path(),
		"flags": astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED,
	}
	fine = python_reference.search_relative_aspects_batch_raw(
		body_codes,
		jd_start,
		jd_end,
		specs,
		step_days=0.25,
		**kwargs,
	)
	coarse_reference = python_reference.search_relative_aspects_batch_raw(
		body_codes,
		jd_start,
		jd_end,
		specs,
		step_days=250.0,
		**kwargs,
	)
	coarse_kernel = kernel.search_relative_aspects_batch_raw(
		body_codes,
		jd_start,
		jd_end,
		specs,
		step_days=250.0,
		**kwargs,
	)

	assert len(fine) == len(coarse_reference) == len(coarse_kernel) == 2
	for expected, reference, native in zip(fine, coarse_reference, coarse_kernel):
		assert abs(float(expected[0]) - float(reference[0])) <= 1e-6
		assert abs(float(expected[0]) - float(native[0])) <= 1e-6
		for hit in (reference, native):
			prom_lon, _prom_speed = python_reference._eval_body_lon_speed(float(hit[0]), body_codes[0], kwargs["flags"])
			sig_lon, _sig_speed = python_reference._eval_body_lon_speed(float(hit[0]), body_codes[1], kwargs["flags"])
			assert abs(python_reference._relative_delta(prom_lon, sig_lon, 0.0)) <= 1e-8


def test_relative_real_saturn_neptune_tangent_and_near_miss_match_kernel():
	if kernel is None:
		return
	body_codes = [astrology.SE_SATURN, astrology.SE_NEPTUNE]
	jd_start = astrology.swe_julday(2024, 6, 27, 0.0, astrology.SE_GREG_CAL)
	jd_end = jd_start + 2.0
	ephe_path = common.get_ephe_path()
	flags = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
	with astrology.swiss_context(ephe_path, None, None):
		prom_state0 = python_reference._eval_body_lon_speed(jd_start, body_codes[0], flags)
		sig_state0 = python_reference._eval_body_lon_speed(jd_start, body_codes[1], flags)
		prom_state1 = python_reference._eval_body_lon_speed(jd_end, body_codes[0], flags)
		sig_state1 = python_reference._eval_body_lon_speed(jd_end, body_codes[1], flags)
		turn = python_reference._refine_relative_speed_turn(
			body_codes[0],
			body_codes[1],
			jd_start,
			jd_end,
			prom_state0,
			sig_state0,
			prom_state1,
			sig_state1,
			flags,
			eps_days=1e-8,
		)
	turn_jd, turn_prom_lon, _turn_prom_speed, turn_sig_lon, _turn_sig_speed = turn
	tangent_offset = (turn_prom_lon - turn_sig_lon) % 360.0
	kwargs = {
		"ephe_path": ephe_path,
		"flags": flags,
		"step_days": 2.0,
	}

	for search in (
		python_reference.search_relative_aspects_batch_raw,
		kernel.search_relative_aspects_batch_raw,
	):
		tangent_hits = search(body_codes, jd_start, jd_end, [(0, 1, tangent_offset)], **kwargs)
		near_miss_hits = search(body_codes, jd_start, jd_end, [(0, 1, tangent_offset + 1e-4)], **kwargs)
		assert len(tangent_hits) == 1
		assert abs(float(tangent_hits[0][0]) - turn_jd) <= 1e-6
		assert near_miss_hits == []
