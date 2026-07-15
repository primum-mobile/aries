# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology

from aries.astrology.transit_fast.api import search_longitude_transits


def test_wraparound_transit_behavior():
	hits = search_longitude_transits(astrology.SE_SUN, 2461041.5, 2461406.5, [359.9, 0.0])
	assert len(hits) >= 2
	assert hits == sorted(hits, key=lambda item: item.jd_ut)
	assert any(hit.target_deg == 0.0 for hit in hits)
