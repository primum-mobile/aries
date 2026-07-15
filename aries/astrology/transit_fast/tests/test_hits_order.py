# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology

from aries.astrology.transit_fast.api import search_year_transits


def test_hits_are_sorted():
	hits = search_year_transits(astrology.SE_MERCURY, 2461041.5, 2461406.5, [0.0, 90.0], [0.0, 60.0, 90.0, 180.0])
	assert [hit.jd_ut for hit in hits] == sorted(hit.jd_ut for hit in hits)
