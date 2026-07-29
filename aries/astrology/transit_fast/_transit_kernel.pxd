# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

cpdef list search_longitude_transits_raw(
	int planet,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=*,
	int flags=*,
	object sidereal_mode=*,
	object topocentric_position=*,
	object step_days=*,
	double eps_deg=*,
	double eps_days=*,
)

cpdef list search_longitude_transits_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object targets_deg,
	object ephe_path=*,
	int flags=*,
	object sidereal_mode=*,
	object topocentric_position=*,
	object step_days=*,
	double eps_deg=*,
	double eps_days=*,
)

cpdef list search_station_times_raw(
	int planet,
	double jd_start,
	double jd_end,
	object ephe_path=*,
	int flags=*,
	object sidereal_mode=*,
	object topocentric_position=*,
	object step_days=*,
	double eps_speed=*,
	double eps_days=*,
)

cpdef list search_station_times_batch_raw(
	object planets,
	double jd_start,
	double jd_end,
	object ephe_path=*,
	int flags=*,
	object sidereal_mode=*,
	object topocentric_position=*,
	object step_days=*,
	double eps_speed=*,
	double eps_days=*,
)

cpdef list search_relative_aspects_batch_raw(
	object body_codes,
	double jd_start,
	double jd_end,
	object specs,
	object ephe_path=*,
	int flags=*,
	object sidereal_mode=*,
	object topocentric_position=*,
	object step_days=*,
	double eps_deg=*,
	double eps_days=*,
)
