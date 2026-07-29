# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

cdef extern from "swephexp.h":
	ctypedef int int32

	int32 swe_calc_ut(double tjd_ut, int32 ipl, int32 iflag, double *xx, char *serr) nogil
	double swe_solcross_ut(double x2cross, double jd_ut, int32 flag, char *serr) nogil
	double swe_mooncross_ut(double x2cross, double jd_ut, int32 flag, char *serr) nogil
	void swe_set_ephe_path(const char *path) nogil
	void swe_set_sid_mode(int32 sid_mode, double t0, double ayan_t0) nogil
	void swe_set_topo(double geolon, double geolat, double geoalt) nogil
	void swe_close() nogil
