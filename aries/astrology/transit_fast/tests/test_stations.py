# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology

from aries.astrology.transit_fast.api import search_station_times


def test_station_detection():
	hits = search_station_times(astrology.SE_MERCURY, 2461041.5, 2461406.5)
	assert len(hits) >= 2
	assert all(hit.hit_type == "station" for hit in hits)
	assert all(abs(hit.speed) < 1e-5 for hit in hits)
