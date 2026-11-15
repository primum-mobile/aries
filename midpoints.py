# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import astrology
import planets
import math
import util


class Mid:
	def __init__(self, p1, p2, m, lat):
		self.p1 = p1
		self.p2 = p2
		self.m = m
		self.lat = lat


class MidPoints:
	"""Computes Midpoints"""

	def __init__(self, pls, chiron=None, apogee=None):
		self.pls = pls
		self.chiron = chiron
		self.mids = []
		self.midslat = []

		self.countMidPoints()
		self.countMidPointsWithLatitude()
		if apogee is not None:
			self._append_apogee(apogee)
	
#		self.printMidPoints(self.midslat)


	def _append_apogee(self, apogee):
		bodies = list(enumerate(self.pls.planets))
		if self.chiron is not None:
			bodies.append((astrology.SE_CHIRON, self.chiron))
		lon2, lat2 = apogee.data[:2]
		r2, b2 = math.radians(lon2), math.radians(lat2)
		for body_id, body in bodies:
			lon1, lat1 = body.data[:2]
			delta = (lon2 - lon1 + 180.0) % 360.0 - 180.0
			longitude = util.normalize(lon1 + delta / 2.0)
			self.mids.append(Mid(body_id, apogee.pId, longitude, 0.0))
			r1, b1 = math.radians(lon1), math.radians(lat1)
			x = math.cos(b1)*math.cos(r1) + math.cos(b2)*math.cos(r2)
			y = math.cos(b1)*math.sin(r1) + math.cos(b2)*math.sin(r2)
			z = math.sin(b1) + math.sin(b2)
			if math.sqrt(x*x+y*y+z*z) < 1e-12:
				mid_lon, mid_lat = longitude, (lat1+lat2)/2.0
			else:
				mid_lon = util.normalize(math.degrees(math.atan2(y, x)))
				mid_lat = math.degrees(math.atan2(z, math.hypot(x, y)))
			self.midslat.append(Mid(body_id, apogee.pId, mid_lon, mid_lat))

	def countMidPoints(self):
		for i in range(planets.Planets.PLANETS_NUM-2):#Nodes are excluded
			for j in range(i+1, planets.Planets.PLANETS_NUM):
				p1 = self.pls.planets[i].data[planets.Planet.LONG]
				p2 = self.pls.planets[j].data[planets.Planet.LONG]
				d = math.fabs(p1-p2)
				m = 0.0
				if d <= 180.0:
					if p1 < p2:
						m = p1+d/2.0
					else:
						m = p2+d/2.0
				else:
					d = 360.0-d
					if p1 < p2:
						m = p2+d/2.0
					else:
						m = p1+d/2.0
					if m >= 360.0:
						m -= 360.0

				m = util.normalize(m)

				self.mids.append(Mid(i, j, m, 0.0))

			if self.chiron is not None:
				chiron_lon = self.chiron.data[planets.Planet.LONG]
				p_lon = self.pls.planets[i].data[planets.Planet.LONG]
				d = math.fabs(p_lon - chiron_lon)
				m = 0.0
				if d <= 180.0:
					if p_lon < chiron_lon:
						m = p_lon + d / 2.0
					else:
						m = chiron_lon + d / 2.0
				else:
					d = 360.0 - d
					if p_lon < chiron_lon:
						m = chiron_lon + d / 2.0
					else:
						m = p_lon + d / 2.0
					if m >= 360.0:
						m -= 360.0
				m = util.normalize(m)
				self.mids.append(Mid(i, astrology.SE_CHIRON, m, 0.0))


	def countMidPointsWithLatitude(self):
		'''According to Ruediger Plantiko'''
		epsilon = 1e-12

		def _fallback_mid(p1, p2, lon, l1, l2):
			self.midslat.append(Mid(p1, p2, lon, (l1 + l2) / 2.0))

		def _safe_mid_with_lat(p1, p2, l1, l2, dist, fallback_lon):
			rl1 = math.radians(l1)
			rl2 = math.radians(l2)
			rdist = math.radians(dist)
			sin_rdist = math.sin(rdist)
			tan_rdist = math.tan(rdist)
			if math.fabs(sin_rdist) <= epsilon or math.fabs(tan_rdist) <= epsilon:
				_fallback_mid(p1, p2, fallback_lon, l1, l2)
				return

			val = math.sin(rl1)*math.sin(rl2)+math.cos(rl1)*math.cos(rl2)*math.cos(rdist)
			if math.fabs(val) > 1.0:
				self.midslat.append(Mid(p1, p2, 0.0, 0.0))
				return

			d = math.acos(val)
			tan_rl2 = math.tan(rl2)
			tan_d2 = math.tan(d/2.0)
			res = ((tan_rl2*math.cos(rl1))/sin_rdist)-math.sin(rl1)/tan_rdist
			A = 1.0
			if res != 0.0:
				A = math.atan(1.0/res)
				if A < 0.0:
					A += math.pi

			sin_A = math.sin(A)
			tan_A = math.tan(A)
			if math.fabs(sin_A) <= epsilon or math.fabs(tan_A) <= epsilon or math.fabs(tan_d2) <= epsilon:
				_fallback_mid(p1, p2, fallback_lon, l1, l2)
				return

			lat = math.degrees(math.asin(math.cos(d/2.0)*math.sin(rl1)+math.sin(d/2.0)*math.cos(rl1)*math.cos(A)))
			res = math.cos(rl1)*(1.0/tan_d2)/sin_A-math.sin(rl1)/tan_A
			dd = 0.0
			if res != 0.0:
				dd = math.fabs(math.degrees(math.atan(1.0/res)))

			lon = 0.0
			d = math.fabs(p1-p2)
			if d <= 180.0:
				if p1 < p2:
					lon = p1+dd
				else:
					lon = p2+dd
			else:
				if p1 < p2:
					lon = p2+dd
				else:
					lon = p1+dd
				if lon >= 360.0:
					lon -= 360.0

			self.midslat.append(Mid(p1, p2, lon, lat))

		for i in range(planets.Planets.PLANETS_NUM-2):#Nodes are excluded
			for j in range(i+1, planets.Planets.PLANETS_NUM):
				p1 = self.pls.planets[i].data[planets.Planet.LONG]
				l1 = self.pls.planets[i].data[planets.Planet.LAT]
				p2 = self.pls.planets[j].data[planets.Planet.LONG]
				l2 = self.pls.planets[j].data[planets.Planet.LAT]
				dist = math.fabs(p2-p1)
				if dist >= 180.0:
					dist = 360.0-dist
				_safe_mid_with_lat(i, j, l1, l2, dist, self.mids[len(self.midslat)].m)

			if self.chiron is not None:
				chiron_lon = self.chiron.data[planets.Planet.LONG]
				chiron_lat = self.chiron.data[planets.Planet.LAT]
				p_lon = self.pls.planets[i].data[planets.Planet.LONG]
				l1 = self.pls.planets[i].data[planets.Planet.LAT]
				l2 = chiron_lat
				dist = math.fabs(chiron_lon - p_lon)
				if dist >= 180.0:
					dist = 360.0 - dist
				_safe_mid_with_lat(i, astrology.SE_CHIRON, l1, l2, dist, self.mids[len(self.midslat)].m)


	def printMidPoints(self, mids):
		pls = ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'AscNode', 'DescNode')

		for x in mids:
			d,m,s = util.decToDeg(x.m)
			dl,ml,sl = util.decToDeg(x.lat)
			print ("%s-%s: %d %d'%d\"  %d %d'%d\"" % (pls[x.p1], pls[x.p2], d,m,s, dl, ml, sl))

