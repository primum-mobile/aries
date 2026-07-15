# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from dataclasses import dataclass


@dataclass(slots=True)
class TransitHit:
	jd_ut: float
	planet: int
	target_deg: float
	aspect_deg: float
	hit_type: str
	speed: float
	retrograde: bool
	pass_index: int
