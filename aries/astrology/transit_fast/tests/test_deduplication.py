# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology

from aries.astrology.transit_fast.api import search_longitude_transits


def test_duplicate_targets_do_not_duplicate_hits():
	hits = search_longitude_transits(astrology.SE_SUN, 2461041.5, 2461406.5, [0.0, 360.0, 0.0])
	jds = [round(hit.jd_ut, 7) for hit in hits]
	assert len(jds) == len(set(jds))
