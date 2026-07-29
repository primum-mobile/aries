# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

ctypedef struct CHit:
	double jd_ut
	int planet
	double target_deg
	double aspect_deg
	double speed
	int retrograde
	int pass_index
	int hit_kind
