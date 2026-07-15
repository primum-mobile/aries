# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology

from aries.astrology.transit_fast.api import search_longitude_transits


def test_retrograde_multi_hit_behavior():
	max_hits = []
	for target in range(0, 360, 30):
		hits = search_longitude_transits(astrology.SE_MERCURY, 2461041.5, 2461406.5, [float(target)])
		if len(hits) > len(max_hits):
			max_hits = hits
	assert len(max_hits) >= 2
	assert [hit.jd_ut for hit in max_hits] == sorted(hit.jd_ut for hit in max_hits)
	assert [hit.pass_index for hit in max_hits] == list(range(1, len(max_hits) + 1))
