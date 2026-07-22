# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Pure-function topocentric pole and oblique ascension for a single point.

Extracted from `topocentricpd.TopocentricPD.getData` so it can be reused
without instantiating a full PD engine (e.g. by the ascensional-transits
engine, by future PSSR/ascensional-progression code, or by unit tests).

Polich/Page closed form:

    AD_geo  = arcsin( tan(decl) . tan(placelat) )
    SA      = 90 + AD_geo  (diurnal)   or  90 - AD_geo  (nocturnal)
    tan PHI = (MD / SA) . tan(placelat)
    AD_phi  = arcsin( tan(decl) . tan(PHI) )
    OA      = RA - AD_phi  (eastern)   or  RA + AD_phi  (western)

`compute(lon, lat, ramc, obl, placelat)` is the canonical entry point.
"""

import math
import collections

import astrology
import util


PoleInfo = collections.namedtuple(
	'PoleInfo',
	['ok', 'eastern', 'above_horizon', 'phi', 'ad', 'oa', 'ra', 'decl'],
)


def compute(lon, lat, ramc, obl, placelat, ayanamsha_offset=0.0):
	"""Return PoleInfo for a point at ecliptic (lon, lat).

	Arguments:
		lon, lat   -- ecliptic longitude, latitude in degrees.
		ramc       -- right ascension of the MC, in degrees [0, 360).
		obl        -- obliquity of the ecliptic, in degrees.
		placelat   -- geographic latitude of the birthplace, in degrees.
	"""
	raic = ramc + 180.0
	if raic > 360.0:
		raic -= 360.0

	ra, decl, _dist = astrology.swe_cotrans(
		util.to_tropical_lon(lon, ayanamsha_offset),
		lat,
		1.0,
		-obl,
	)

	eastern = True
	if ramc > raic:
		if ra > raic and ra < ramc:
			eastern = False
	else:
		if (ra > raic and ra < 360.0) or (ra < ramc and ra > 0.0):
			eastern = False

	ok = True
	adlat = 0.0
	val = math.tan(math.radians(placelat)) * math.tan(math.radians(decl))
	if math.fabs(val) <= 1.0:
		adlat = math.degrees(math.asin(val))
	else:
		ok = False

	md = math.fabs(ramc - ra)
	if md > 180.0:
		md = 360.0 - md
	icd = math.fabs(raic - ra)
	if icd > 180.0:
		icd = 360.0 - icd

	dsa = 90.0 + adlat
	nsa = 90.0 - adlat

	above_horizon = True
	if md > dsa:
		above_horizon = False

	sa = dsa
	if not above_horizon:
		sa = nsa
		md = icd

	phi = 0.0
	adphi = 0.0
	if sa != 0.0:
		tan_phi = (md / sa) * math.tan(math.radians(placelat))
		phi = math.degrees(math.atan(tan_phi))
		val = math.tan(math.radians(decl)) * tan_phi
		if math.fabs(val) <= 1.0:
			adphi = math.degrees(math.asin(val))
		else:
			ok = False

	# Note: oa is returned in raw (possibly signed / >360) form to match
	# the original PlacidianUTPPD.getData() semantics. Consumers that need
	# a [0, 360) value should normalize themselves.
	if eastern:
		oa = ra - adphi
	else:
		oa = ra + adphi

	return PoleInfo(ok=ok, eastern=eastern, above_horizon=above_horizon,
	                phi=phi, ad=adphi, oa=oa, ra=ra, decl=decl)
