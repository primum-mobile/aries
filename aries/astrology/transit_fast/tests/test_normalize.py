# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from aries.astrology.transit_fast.normalize import angle_delta_signed, crossed_zero, wrap180, wrap360


def test_wrap360():
	assert wrap360(0.0) == 0.0
	assert wrap360(360.0) == 0.0
	assert wrap360(-1.0) == 359.0


def test_wrap180():
	assert wrap180(0.0) == 0.0
	assert wrap180(180.0) == -180.0
	assert wrap180(359.0) == -1.0


def test_angle_delta_signed():
	assert angle_delta_signed(1.0, 359.0) == 2.0
	assert angle_delta_signed(359.0, 1.0) == -2.0


def test_crossed_zero():
	assert crossed_zero(-1.0, 1.0) is True
	assert crossed_zero(0.0, 1.0) is True
	assert crossed_zero(1.0, 2.0) is False
