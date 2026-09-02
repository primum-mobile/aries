# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import astrology
import chart
import houses
import math
import planets
import options
import util


def _ayanamsha_at(chrt, jd_ut):
	if getattr(chrt.options, 'ayanamsha', 0) == 0:
		return 0.0
	astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(chrt.options.ayanamsha), 0, 0)
	return float(astrology.effective_ayanamsha_ut(float(jd_ut), chrt.options.ayanamsha))


class Syzygy:
	LON = 0
	LAT = 1
	RA = 2
	DECL = 3

	#for topical almutens
	TOPICALDEFAULT = 0
	TOPICALCONIUNCTIO = 1
	TOPICALOPPOSITIO = 2
	TOPICALOPPOSITIORADIX = 3
	TOPICALMOON = 4

	def __init__(self, chrt, previous_opposite=None):
		self.time = chrt.time
		self.lon = chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG]
		# Stable semantic identity for consumers that follow the prenatal point
		# through rebuilt charts.  The longitude may later receive a continuous
		# profection/arc offset; this marker changes only when the configured
		# full-moon rule actually switches from Moon to Sun.
		self.selected_body = 'moon'

		self.flags = astrology.SEFLG_SPEED+astrology.SEFLG_SWIEPH
		if chrt.options.ayanamsha != 0:
			astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(chrt.options.ayanamsha), 0, 0)
			self.flags |= astrology.SEFLG_SIDEREAL

		#for topical almutens
		self.lons = []

		if not chrt.time.bc:
			lonsun = chrt.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]
			lonmoon = chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG]

			d, m, s = util.decToDeg(lonsun)
			lonsun = d+m/60.0+s/3600.0
			d, m, s = util.decToDeg(lonmoon)
			lonmoon = d+m/60.0+s/3600.0

			diff = lonmoon-lonsun
			self.newmoon, self.ready = self.isNewMoon(diff)

			if not self.ready:
				ok, self.time, self.ready = self.getDateHour(self.time, chrt.place, self.newmoon)
				if not self.ready:
					ok, self.time, self.ready = self.getDateMinute(self.time, chrt.place, self.newmoon)
					if not self.ready:
						ok, self.time, self.ready = self.getDateSecond(self.time, chrt.place, self.newmoon)

			hses = houses.Houses(self.time.jd, 0, chrt.place.lat, chrt.place.lon, chrt.options.hsys, chrt.obl[0], chrt.options.ayanamsha, _ayanamsha_at(chrt, self.time.jd))
			moon = planets.Planet(self.time.jd, astrology.SE_MOON, self.flags, chrt.place.lat, hses.ascmc2)
			if self.newmoon:
				self.lon = moon.data[planets.Planet.LONG]
			else:
				if chrt.options.syzmoon == options.Options.MOON:
					self.lon = moon.data[planets.Planet.LONG]
				elif chrt.options.syzmoon == options.Options.ABOVEHOR:
					if moon.abovehorizon:
						self.lon = moon.data[planets.Planet.LONG]
					else:
						sun = planets.Planet(self.time.jd, astrology.SE_SUN, self.flags)
						self.lon = sun.data[planets.Planet.LONG]
						self.selected_body = 'sun'
				else:
					moon = planets.Planet(self.time.jd, astrology.SE_MOON, self.flags, chrt.place.lat, chrt.houses.ascmc2)
					if moon.abovehorizon:
						self.lon = moon.data[planets.Planet.LONG]
					else:
						sun = planets.Planet(self.time.jd, astrology.SE_SUN, self.flags)
						self.lon = sun.data[planets.Planet.LONG]
						self.selected_body = 'sun'

		ra, decl, dist = astrology.swe_cotrans(
			util.to_tropical_lon(self.lon, _ayanamsha_at(chrt, self.time.jd)),
			0.0, 1.0, -chrt.obl[0]
		)
		self.speculum = [self.lon, 0.0, ra, decl]

		#the other syzygy (i.e. if the syzygy was conjunction then calculate the opposition and vice versa)
		self.lon2 = chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG]
		if not chrt.time.bc:
			seed = self._validated_previous_opposite(previous_opposite)
			if seed is not None:
				# At a forward phase flip, the previous chart's canonical
				# lunation is exactly this chart's secondary/opposite lunation.
				# Reuse its exact Time result; all longitude, house, speculum,
				# and topical fields below are still rebuilt from current inputs.
				self.time2 = seed.time
				self.ready2 = bool(getattr(seed, 'ready', False))
			else:
				self.time2 = self.time
				ok, self.time2, self.ready2 = self.getDateHour(self.time2, chrt.place, not self.newmoon)
				if not self.ready2:
					ok, self.time2, self.ready2 = self.getDateMinute(self.time2, chrt.place, not self.newmoon)
					if not self.ready2:
						ok, self.time2, self.ready2 = self.getDateSecond(self.time2, chrt.place, not self.newmoon)

			hses2 = houses.Houses(self.time2.jd, 0, chrt.place.lat, chrt.place.lon, chrt.options.hsys, chrt.obl[0], chrt.options.ayanamsha, _ayanamsha_at(chrt, self.time2.jd))
			moon2 = planets.Planet(self.time2.jd, astrology.SE_MOON, self.flags, chrt.place.lat, hses2.ascmc2)
			if not self.newmoon:
				self.lon2 = moon2.data[planets.Planet.LONG]
			else:
				if chrt.options.syzmoon == options.Options.MOON:
					self.lon2 = moon2.data[planets.Planet.LONG]
				elif chrt.options.syzmoon == options.Options.ABOVEHOR:
					if moon2.abovehorizon:
						self.lon2 = moon2.data[planets.Planet.LONG]
					else:
						sun2 = planets.Planet(self.time2.jd, astrology.SE_SUN, self.flags)
						self.lon2 = sun2.data[planets.Planet.LONG]
				else:
					moon2 = planets.Planet(self.time2.jd, astrology.SE_MOON, self.flags, chrt.place.lat, chrt.houses.ascmc2)
					if moon2.abovehorizon:
						self.lon2 = moon2.data[planets.Planet.LONG]
					else:
						sun2 = planets.Planet(self.time2.jd, astrology.SE_SUN, self.flags)
						self.lon2 = sun2.data[planets.Planet.LONG]

			ra2, decl2, dist2 = astrology.swe_cotrans(
				util.to_tropical_lon(self.lon2, _ayanamsha_at(chrt, self.time2.jd)),
				0.0, 1.0, -chrt.obl[0]
			)
			self.speculum2 = [self.lon2, 0.0, ra2, decl2]

			#for topical almutens
			self.lons.append(self.lon)#Default
			if self.newmoon: #Conjunction
				self.lons.append(self.lon)
			else:
				self.lons.append(self.lon2)
			#Moon in chart of Syzygy
			hses = houses.Houses(self.time.jd, 0, chrt.place.lat, chrt.place.lon, chrt.options.hsys, chrt.obl[0], chrt.options.ayanamsha, _ayanamsha_at(chrt, self.time.jd))
			moonSyz = planets.Planet(self.time.jd, astrology.SE_MOON, self.flags, chrt.place.lat, hses.ascmc2)
			hses2 = houses.Houses(self.time2.jd, 0, chrt.place.lat, chrt.place.lon, chrt.options.hsys, chrt.obl[0], chrt.options.ayanamsha, _ayanamsha_at(chrt, self.time2.jd))
			moonSyz2 = planets.Planet(self.time2.jd, astrology.SE_MOON, self.flags, chrt.place.lat, hses2.ascmc2)
			if not self.newmoon: #Opposition
				if moonSyz.abovehorizon:
					self.lons.append(moonSyz.data[planets.Planet.LONG])
				else:
					sun = planets.Planet(self.time.jd, astrology.SE_SUN, self.flags)
					self.lons.append(sun.data[planets.Planet.LONG])
			else:
				if moonSyz2.abovehorizon:
					self.lons.append(moonSyz2.data[planets.Planet.LONG])
				else:
					sun2 = planets.Planet(self.time2.jd, astrology.SE_SUN, self.flags)
					self.lons.append(sun2.data[planets.Planet.LONG])
			if not self.newmoon: #OppositionRadix
				moon = planets.Planet(self.time.jd, astrology.SE_MOON, self.flags, chrt.place.lat, chrt.houses.ascmc2)
				if moon.abovehorizon:
					self.lons.append(moon.data[planets.Planet.LONG])
				else:
					sun = planets.Planet(self.time.jd, astrology.SE_SUN, self.flags)
					self.lons.append(sun.data[planets.Planet.LONG])
			else:
				moon = planets.Planet(self.time2.jd, astrology.SE_MOON, self.flags, chrt.place.lat, chrt.houses.ascmc2)
				if moon.abovehorizon:
					self.lons.append(moon.data[planets.Planet.LONG])
				else:
					sun = planets.Planet(self.time.jd, astrology.SE_SUN, self.flags)
					self.lons.append(sun.data[planets.Planet.LONG])
			if not self.newmoon: #Opposition Moon
				self.lons.append(moonSyz.data[planets.Planet.LONG])
			else:
				self.lons.append(moonSyz2.data[planets.Planet.LONG])


	def _validated_previous_opposite(self, seed):
		"""Return an exact prior opposite lunation or fail closed."""
		try:
			seed_jd = float(seed.time.jd)
			current_jd = float(self.time.jd)
			if not math.isfinite(seed_jd) or not math.isfinite(current_jd):
				return None
			if bool(seed.newmoon) == bool(self.newmoon):
				return None
			# Consecutive conjunction/opposition events are roughly a
			# fortnight apart. The strict bound rejects stale, reversed, or
			# skipped-cycle state before it can affect the exact calculation.
			if current_jd <= seed_jd or current_jd-seed_jd >= 20.0:
				return None
			return seed
		except Exception:
			return None


	def calcProfPos(self, prof):
		offs = float(getattr(prof, 'offs', 0.0))
		self.lon = util.normalize(self.lon+offs)
		if getattr(self, 'speculum', None) is not None:
			self.speculum[Syzygy.LON] = self.lon
		if hasattr(self, 'lon2'):
			self.lon2 = util.normalize(self.lon2+offs)
		if getattr(self, 'speculum2', None) is not None:
			self.speculum2[Syzygy.LON] = self.lon2
		if getattr(self, 'lons', None) is not None:
			self.lons = [util.normalize(lon+offs) for lon in self.lons]


	def isNewMoon(self, diff):
		newmoon = True
		ready = False

		if diff == 0.0:
			newmoon = True
			ready = True
		elif diff == 180.0 or diff == -180.0:
			newmoon = False
			ready = True
		elif diff < 0.0:
			if diff < -180.0:
				newmoon = True
			else:
				newmoon = False
		elif diff > 0.0:
			if diff > 180.0:
				newmoon = False
			else:
				newmoon = True

		return newmoon, ready


	def getDateHour(self, tim, place, newmoonorig):
		while True:
			h, m, s = util.decToDeg(tim.time) 
			y, mo, d = tim.year, tim.month, tim.day
			h -= 1
			if h < 0:
				h = 23	
				y, mo, d = util.decrDay(y, mo, d)
				if y == 0:
					y = 1
					tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)
					return True, tim, True

			tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)

			sun = planets.Planet(tim.jd, astrology.SE_SUN, self.flags)
			moon = planets.Planet(tim.jd, astrology.SE_MOON, self.flags)
			lonsun = sun.data[planets.Planet.LONG]
			lonmoon = moon.data[planets.Planet.LONG]

			d, m, s = util.decToDeg(lonsun)
			lonsun = d+m/60.0+s/3600.0
			d, m, s = util.decToDeg(lonmoon)
			lonmoon = d+m/60.0+s/3600.0

			diff = lonmoon-lonsun
			newmoon, ready = self.isNewMoon(diff)
			if newmoon != newmoonorig or ready:
				return True, tim, ready

		return False, tim


	def getDateMinute(self, tim, place, newmoonorig):
		h, m, s = util.decToDeg(tim.time) 
		y, mo, d = tim.year, tim.month, tim.day
		h += 1
		if h > 23:
			h = 0	
			y, mo, d = util.incrDay(y, mo, d)

		tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)

		while True:
			h, m, s = util.decToDeg(tim.time) 
			y, mo, d = tim.year, tim.month, tim.day
			y, mo, d, h, m = util.subtractMins(y, mo, d, h, m, 1)
			if y == 0:
				y = 1
				tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)
				return True, tim, True

			tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)

			sun = planets.Planet(tim.jd, astrology.SE_SUN, self.flags)
			moon = planets.Planet(tim.jd, astrology.SE_MOON, self.flags)
			lonsun = sun.data[planets.Planet.LONG]
			lonmoon = moon.data[planets.Planet.LONG]

			d, m, s = util.decToDeg(lonsun)
			lonsun = d+m/60.0+s/3600.0
			d, m, s = util.decToDeg(lonmoon)
			lonmoon = d+m/60.0+s/3600.0

			diff = lonmoon-lonsun
			newmoon, ready = self.isNewMoon(diff)
			if newmoon != newmoonorig or ready:
				return True, tim, ready

		return False, tim


	def getDateSecond(self, tim, place, newmoonorig):
		h, m, s = util.decToDeg(tim.time) 
		y, mo, d = tim.year, tim.month, tim.day
		y, mo, d, h, m = util.addMins(y, mo, d, h, m, 1)

		tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)

		while True:
			h, m, s = util.decToDeg(tim.time) 
			y, mo, d = tim.year, tim.month, tim.day
			y, mo, d, h, m, s = util.subtractSecs(y, mo, d, h, m, s, 1)
			if y == 0:
				y = 1
				tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)
				return True, tim, True

			tim = chart.Time(y, mo, d, h, m, s, False, tim.cal, chart.Time.GREENWICH, True, 0, 0, False, place, False)

			sun = planets.Planet(tim.jd, astrology.SE_SUN, self.flags)
			moon = planets.Planet(tim.jd, astrology.SE_MOON, self.flags)
			lonsun = sun.data[planets.Planet.LONG]
			lonmoon = moon.data[planets.Planet.LONG]

			d, m, s = util.decToDeg(lonsun)
			lonsun = d+m/60.0+s/3600.0
			d, m, s = util.decToDeg(lonmoon)
			lonmoon = d+m/60.0+s/3600.0

			diff = lonmoon-lonsun
			newmoon, ready = self.isNewMoon(diff)
			if newmoon != newmoonorig or ready:
				return True, tim, ready

		return False, tim
