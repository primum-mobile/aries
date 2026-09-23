# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import math

import astrology
import houses


# Astrology-first starter set: Astrodienst's major/default asteroids plus the
# additional bodies most consistently represented in mainstream asteroid work.
# Keep this order stable: it is also the empty-search catalogue order.
POPULAR_ASTEROID_NUMBERS = (
	1,      # Ceres
	2,      # Pallas
	3,      # Juno
	4,      # Vesta
	2060,   # Chiron
	5145,   # Pholus
	433,    # Eros
	7066,   # Nessus
	10,     # Hygiea
	16,     # Psyche
	80,     # Sappho
	1221,   # Amor
	5,      # Astraea
)
DEFAULT_ASTEROID_NUMBERS = POPULAR_ASTEROID_NUMBERS
BUNDLED_ASTEROID_NUMBERS = frozenset(POPULAR_ASTEROID_NUMBERS)
MAX_SELECTED_ASTEROIDS = 200
MAIN_BODY_ID_BY_ASTEROID_NUMBER = {
	1: astrology.SE_CERES,
	2: astrology.SE_PALLAS,
	3: astrology.SE_JUNO,
	4: astrology.SE_VESTA,
	2060: astrology.SE_CHIRON,
	5145: astrology.SE_PHOLUS,
}


def asteroid_body_id(number):
	"""Return the Swiss-Ephemeris body id for one MPC asteroid number."""
	number = int(number)
	return MAIN_BODY_ID_BY_ASTEROID_NUMBER.get(
		number,
		astrology.SE_AST_OFFSET + number,
	)


def iter_chart_asteroids(chrt):
	"""All materialized semantic bodies, including unavailable selections.

	Ring visibility and current aspect hits must never define timed candidates.
	Keep Swiss IDs unique (not positional ring indices).
	"""
	seen = set()
	for body in getattr(getattr(chrt, 'asteroids', None), 'asteroids', ()) or ():
		body_id = int(body.aId)
		if body_id not in seen:
			seen.add(body_id)
			yield body


def chart_asteroid(chrt, body_id):
	return next((body for body in iter_chart_asteroids(chrt) if body.aId == body_id), None)


def normalize_asteroid_numbers(values, defaults=DEFAULT_ASTEROID_NUMBERS):
	"""Normalize persisted/user asteroid selections without widening legacy ids."""
	if values is None:
		return list(defaults)
	result = []
	seen = set()
	for raw in values or ():
		try:
			number = int(raw)
		except (TypeError, ValueError):
			continue
		if not 1 <= number <= 999999 or number in seen or number == 134340:
			continue
		seen.add(number)
		result.append(number)
		if len(result) >= MAX_SELECTED_ASTEROIDS:
			break
	return result


class Asteroid:
	"""Data of an Asteroid"""

	def __init__(self, tjd_ut, aId, flag, placelat=None, ascmc2=None, number=None):
		self.aId = aId
		self.number = int(number) if number is not None else None
		self.available = False
		self.error = ''
		self.data = ()
		self.speed = 0.0
		self.name = astrology.swe_get_planet_name(aId)

		rflag, dat, serr = astrology.swe_calc_ut_ex(tjd_ut, aId, flag)
		if int(rflag) & 0xFFFFFFFF == 0xFFFFFFFF:
			self.error = str(serr or 'asteroid_ephemeris_unavailable')
			return
		equatorial_flag = (int(flag) & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL
		rflag, datEqu, serr = astrology.swe_calc_ut_ex(tjd_ut, aId, equatorial_flag)
		if int(rflag) & 0xFFFFFFFF == 0xFFFFFFFF:
			self.error = str(serr or 'asteroid_equatorial_ephemeris_unavailable')
			return
		self.data = (dat[0], dat[1], datEqu[0], datEqu[1])
		# Asteroids are ordinary Swiss Ephemeris bodies.  Keep their real
		# ecliptic velocity available to semantic consumers (Aspect List,
		# transit search) instead of flattening them into static ring labels.
		self.speed = float(dat[3]) if len(dat) > 3 else 0.0
		if placelat is not None and ascmc2 is not None:
			elv, azm = self._calc_horizontal(placelat, ascmc2, datEqu[0], datEqu[1])
			self.data = self.data + (elv, azm)

		self.name = astrology.swe_get_planet_name(aId)
		self.available = True

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

	def __init__(self, tjd_ut, flag, placelat=None, ascmc2=None, asteroid_numbers=None):
		self.asteroids = []
		self.numbers = normalize_asteroid_numbers(asteroid_numbers)

		for number in self.numbers:
			body_id = asteroid_body_id(number)
			self.asteroids.append(
				Asteroid(tjd_ut, body_id, flag, placelat, ascmc2, number=number)
			)

	
	
