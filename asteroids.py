# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import math

import astrology
import houses


class Asteroid:
	"""Data of an Asteroid"""

	def __init__(self, tjd_ut, aId, flag, placelat=None, ascmc2=None):
		self.aId = aId

		rflag, dat, serr = astrology.swe_calc_ut_ex(tjd_ut, aId, flag)
		equatorial_flag = (int(flag) & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL
		rflag, datEqu, serr = astrology.swe_calc_ut_ex(tjd_ut, aId, equatorial_flag)
		self.data = (dat[0], dat[1], datEqu[0], datEqu[1])
		# Asteroids are ordinary Swiss Ephemeris bodies.  Keep their real
		# ecliptic velocity available to semantic consumers (Aspect List,
		# transit search) instead of flattening them into static ring labels.
		self.speed = float(dat[3]) if len(dat) > 3 else 0.0
		if placelat is not None and ascmc2 is not None:
			elv, azm = self._calc_horizontal(placelat, ascmc2, datEqu[0], datEqu[1])
			self.data = self.data + (elv, azm)

		self.name = astrology.swe_get_planet_name(aId)

	def _calc_horizontal(self, placelat, ascmc2, ra, decl):
		ramc = ascmc2[houses.Houses.MC][houses.Houses.RA]
		ha = ra - ramc
		if ha < 0.0:
			ha += 360.0

		sin_elv = (
			math.sin(math.radians(placelat)) * math.sin(math.radians(decl)) +
			math.cos(math.radians(placelat)) * math.cos(math.radians(decl)) * math.cos(math.radians(ha))
		)
		sin_elv = max(-1.0, min(1.0, sin_elv))
		elv = math.degrees(math.asin(sin_elv))

		cos_elv = math.cos(math.radians(elv))
		if abs(cos_elv) <= 1e-12:
			azm = 0.0
		else:
			cos_azm = (
				math.cos(math.radians(placelat)) * math.sin(math.radians(decl)) -
				math.sin(math.radians(placelat)) * math.cos(math.radians(decl)) * math.cos(math.radians(ha))
			) / cos_elv
			cos_azm = max(-1.0, min(1.0, cos_azm))
			azm_north = math.degrees(math.acos(cos_azm))
			if ha > 180.0:
				azm_north = 360.0 - azm_north
			azm = 450.0 - azm_north
			if azm > 360.0:
				azm -= 360.0
		return elv, azm


class Asteroids:
	"""Calculates the positions of the asteroids"""

	ids = [astrology.SE_CERES, astrology.SE_CHIRON, astrology.SE_JUNO, astrology.SE_PALLAS, astrology.SE_PHOLUS, astrology.SE_VESTA]

	def __init__(self, tjd_ut, flag, placelat=None, ascmc2=None):
		self.asteroids = []
		
		for i in Asteroids.ids:
			self.asteroids.append(Asteroid(tjd_ut, i, flag, placelat, ascmc2))

	
	
