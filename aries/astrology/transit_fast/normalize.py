# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

def wrap360(x: float) -> float:
	value = float(x) % 360.0
	if value < 0.0:
		value += 360.0
	return value


def wrap180(x: float) -> float:
	value = wrap360(x)
	if value >= 180.0:
		value -= 360.0
	return value


def angle_delta_signed(a: float, b: float) -> float:
	return wrap180(float(a) - float(b))


def crossed_zero(f0: float, f1: float) -> bool:
	if f0 == 0.0 or f1 == 0.0:
		return True
	return (f0 < 0.0 < f1) or (f1 < 0.0 < f0)
