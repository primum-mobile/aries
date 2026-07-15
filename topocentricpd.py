# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Polich/Page topocentric primary directions.

Inherits the full PlacidianUTPPD arc machinery: the only mathematical
difference is the formula for the pole of the significator. Both poles are
closed-form; they differ only in what is interpolated linearly with the
proportional meridian distance MD/SA. The Placidian-UTP pole interpolates
the ascensional difference (AD_pole = (MD/SA).AD_geo, the hour-distance-
proportional pole; see PlacidianUTPPD.getData); the topocentric pole
interpolates the pole's tangent (tan PHI = (MD/SA).tan(geolat), the cone
result).

References:
  Polich, V. & Page, A. P. Nelson, *The Topocentric System of Houses*
    (Buenos Aires, 1976).
  Juan Estadella, *Predictive Astrology*, 3rd ed. (Barcelona, 2019), ch. 5.
  Astrodienst Astrowiki, "Topocentric House System."

Pole formula (for an arbitrary point at right ascension RA, declination DEL):
    1. MD  = |RA - RAMC|   (or |RA - RAIC| if below the horizon)
    2. SA  = 90 + AD_geo   (diurnal)   or  90 - AD_geo  (nocturnal)
         where AD_geo = arcsin(tan DEL . tan PHI_geo)
    3. tan PHI_pole = (MD / SA) . tan PHI_geo
    4. AD_pole = arcsin(tan DEL . tan PHI_pole)
    5. OA = RA - AD_pole  (eastern)   or  RA + AD_pole  (western)

At MC (MD=0) PHI_pole = 0; on the horizon (MD=SA) PHI_pole = PHI_geo;
in between, the cone gives intermediate poles. For the cusps this reduces
to tan PHI = (k/3) . tan PHI_geo with k = 1 (XI/III) or 2 (XII/II).

The Placidian-UTP and topocentric poles coincide on the equator and at
the angles, but diverge mid-house off-equator. The directional arc orbs
collapse to ~2.5' / 15 days under this pole (Estadella op. cit. ch. 7),
which is what makes second-resolution rectification feasible.
"""

import copy
import math

import astrology
import chart
import customerpd
import houses
import planets
import placidiansapd
import placidianutppd
import primdirs
import topocentric_pole


class TopocentricPD(placidianutppd.PlacidianUTPPD):
	'Implements Polich/Page topocentric Primary Directions'

	def __init__(self, chrt, options, pdrange, direction, abort):
		placidianutppd.PlacidianUTPPD.__init__(self, chrt, options, pdrange, direction, abort)


	def calc(self):
		"""Calculate genuine temporal and Topocentric-ecliptic passes.

		Polich/Page zodiacal directions use the Topocentric pole of the
		significator.  Mundane aspects instead live in temporal/MDO space
		(MD / SA * 90), which is the Placidian semi-arc mundane construction.
		PlacidianUTPPD's ``mundane`` argument does not change that geometry and
		therefore used to emit the zodiacal arc a second time with an M marker.
		"""
		mode = self.options.subprimarydir
		if mode in (primdirs.PrimDirs.MUNDANE, primdirs.PrimDirs.BOTH):
			mundane_options = copy.copy(self.options)
			mundane_options.subprimarydir = primdirs.PrimDirs.MUNDANE
			mundane = placidiansapd.PlacidianSAPD(
				self.chart,
				mundane_options,
				self.pdrange,
				self.direction,
				self.abort,
			)
			self.pds.extend(mundane.pds)

		if not self.abort.abort and mode in (primdirs.PrimDirs.ZODIACAL, primdirs.PrimDirs.BOTH):
			self.calcZodPDs()


	def _force_getdata_for_sig(self):
		# The Placidian speculum caches POH/AODO under the Placidian pole.
		# Topocentric directions need the cone-based pole instead, so always
		# go through getData() rather than using the cached values.
		return True


	def getData(self, lon, lat):
		# Delegates to the shared pure-function helper so the same pole
		# formula serves PD, ascensional transits, and any future
		# topocentric calculation. Return shape kept tuple-compatible
		# with PlacidianUTPPD.getData() so the existing call sites need
		# no change.
		info = topocentric_pole.compute(
			lon, lat,
			self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.RA],
			self.chart.obl[0],
			self.chart.place.lat,
		)
		return info.ok, info.eastern, info.above_horizon, info.phi, info.oa
