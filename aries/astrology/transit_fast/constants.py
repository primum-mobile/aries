# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology


DEFAULT_EPS_DEG = 1e-8
DEFAULT_EPS_DAYS = 1e-8
NEWTON_MAX_ITERS = 12
BISECTION_MAX_ITERS = 60
STATION_SPEED_EPS = 1e-6
LOW_SPEED_WARN = 1e-4
DEDUP_EPS_DAYS = 1e-7

HIT_LONGITUDE = 0
HIT_STATION = 1

PLANET_STEP_DAYS = {
	astrology.SE_MOON: 0.125,
	astrology.SE_MERCURY: 0.5,
	astrology.SE_VENUS: 0.5,
	astrology.SE_MARS: 0.5,
	astrology.SE_JUPITER: 2.0,
	astrology.SE_SATURN: 2.0,
	astrology.SE_URANUS: 3.0,
	astrology.SE_NEPTUNE: 3.0,
	astrology.SE_PLUTO: 3.0,
}


BODY_PERIOD_DAYS = {
	astrology.SE_MOON: 27.321661,
	astrology.SE_MERCURY: 87.9691,
	astrology.SE_VENUS: 224.70069,
	astrology.SE_MARS: 686.97959,
	astrology.SE_JUPITER: 4332.589,
	astrology.SE_SATURN: 10759.22,
	astrology.SE_URANUS: 30688.5,
	astrology.SE_NEPTUNE: 60182.0,
	astrology.SE_PLUTO: 90560.0,
	astrology.SE_MEAN_NODE: 6798.383,
	astrology.SE_TRUE_NODE: 6798.383,
}


def default_step_days_for_planet(planet: int) -> float:
	return PLANET_STEP_DAYS.get(planet, 1.0)


def default_relative_step_days_for_bodies(body_codes, specs) -> float:
	if not body_codes or not specs:
		return 1.0

	step = None
	for prom_idx, sig_idx, _offset in specs:
		prom_code = int(body_codes[int(prom_idx)])
		sig_code = int(body_codes[int(sig_idx)])
		if prom_code >= 1000:
			prom_code -= 1000
		if sig_code >= 1000:
			sig_code -= 1000

		pair_step = min(default_step_days_for_planet(prom_code), default_step_days_for_planet(sig_code))
		prom_period = BODY_PERIOD_DAYS.get(prom_code)
		sig_period = BODY_PERIOD_DAYS.get(sig_code)
		if prom_period is not None and sig_period is not None:
			rate = abs((1.0 / float(prom_period)) - (1.0 / float(sig_period)))
			if rate > 0.0:
				synodic_period = 1.0 / rate
				pair_step = min(pair_step, max(1e-4, synodic_period / 64.0))

		if step is None or pair_step < step:
			step = pair_step

	return float(step if step is not None else 1.0)


PLANET_DEFAULT_STEP_DAYS = PLANET_STEP_DAYS
