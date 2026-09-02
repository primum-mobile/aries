# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import math
import astrology
import primdirs
import planets
import chart
import fixstars
import fortune
import syzygy
import houses
import secmotion
import customerpd
import util


class RegioCampBasePD(primdirs.PrimDirs):
	'Implements Regiomontanian/Campanian(common) Primary Directions'

	def __init__(self, chrt, options, pdrange, direction, abort):
		primdirs.PrimDirs.__init__(self, chrt, options, pdrange, direction, abort)


	def _zodiacal_aspect_position(self, planet_idx, lon_base, lat_base, aspect_idx, aspect):
		lon = util.normalize(lon_base+aspect)
		lat = lat_base
		if self.options.morin_excentric and 0 <= planet_idx <= astrology.SE_PLUTO:
			lon, lat = self.getMorinExcentric(planet_idx, lon_base, lat_base, aspect)
		elif self.options.bianchini:
			val = self.getBianchini(lat_base, chart.Chart.Aspects[aspect_idx])
			if math.fabs(val) > 1.0:
				return False, lon, lat
			lat = math.degrees(math.asin(val))

		return True, lon, lat


	def _antiscia_point_sets(self):
		antiscia_obj = getattr(self.chart, 'antiscia', None)
		if antiscia_obj is None:
			return
		yield getattr(antiscia_obj, 'plantiscia', []), primdirs.PrimDir.ANTISCION
		yield getattr(antiscia_obj, 'plcontraant', []), primdirs.PrimDir.CONTRAANT
		if getattr(antiscia_obj, 'morin_antiscia', False):
			secondary = getattr(antiscia_obj, 'plantiscia_secondary', None)
			if secondary:
				yield secondary, primdirs.PrimDir.ANTISCION
			secondary = getattr(antiscia_obj, 'plcontraant_secondary', None)
			if secondary:
				yield secondary, primdirs.PrimDir.CONTRAANT


	def _valid_antiscia_point(self, point):
		return point is not None and getattr(point, 'valid', True)


	def calcInterPlanetary(self, mundane):
		'''Calclucates mundane/zodiacal directions of the promissors to aspects of planets'''

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			lonprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
			latprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]
			raprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.DECL]

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latprom = 0.0
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(plprom.data[planets.Planet.LONG]), 0.0, 1.0, -self.chart.obl[0])

			self.toPlanets(mundane, p, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcCustomerPlanetary(self, mundane):
		'''Calclucates mundane/zodiacal directions of the Cutomer-promissor to aspects of planets'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		latprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]
		raprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toPlanets(mundane, primdirs.PrimDir.CUSTOMERPD, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcPlanetary2Customer2(self, mundane):
		'''Calclucates mundane/zodiacal directions of the promissors to the Customer2 point'''

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			lonprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
			latprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]
			raprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.DECL]

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latprom = 0.0
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(plprom.data[planets.Planet.LONG]), 0.0, 1.0, -self.chart.obl[0])

			self.toCustomer2(mundane, p, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO, 0.0, True)

	def calcCustomer2Customer2(self, mundane):
		'''Calculates directions of the active Customer-promissor to the active Customer2 significator'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		latprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]
		raprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toCustomer2(mundane, primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcAntiscia2Planets(self, mundane):
		'''Calclucates mundane/zodiacal directions of the Antiscia to aspects of planets'''
		for points, offs in self._antiscia_point_sets():
			self.calcAntiscia2PlanetsSub(mundane, points, offs)

		if not mundane:
			#Antiscia/Contraant of LoF
			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				lonlofant = ant.lon
				latlofant = ant.lat
				ralofant = ant.ra
				decllofant = ant.decl

				self.toPlanets(mundane, primdirs.PrimDir.ANTISCIONLOF, lonlofant, latlofant, ralofant, decllofant, chart.Chart.CONJUNCTIO)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				lonlofcant = cant.lon
				latlofcant = cant.lat
				ralofcant = cant.ra
				decllofcant = cant.decl

				self.toPlanets(mundane, primdirs.PrimDir.CONTRAANTLOF, lonlofcant, latlofcant, ralofcant, decllofcant, chart.Chart.CONJUNCTIO)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				lonant = ant.lon
				raant = ant.ra
				declant = ant.decl

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toPlanets(mundane, typ, lonant, 0.0, raant, declant, chart.Chart.CONJUNCTIO)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				loncant = cant.lon
				racant = cant.ra
				declcant = cant.decl

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toPlanets(mundane, typ, loncant, 0.0, racant, declcant, chart.Chart.CONJUNCTIO)


	def calcAntiscia2PlanetsSub(self, mundane, pls, offs):
		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			lonprom = plprom.lon
			latprom = plprom.lat
			raprom = plprom.ra
			declprom = plprom.decl

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latprom = 0.0
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

			self.toPlanets(mundane, p+offs, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcAntiscia2Customer2(self, mundane):
		'''Calclucates mundane/zodiacal directions of the Antiscia to aspects of planets'''

		for points, offs in self._antiscia_point_sets():
			self.calcAntiscia2Customer2Sub(mundane, points, offs)

		if not mundane:
			#Antiscia/Contraant of LoF
			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				lonlofant = ant.lon
				latlofant = ant.lat
				ralofant = ant.ra
				decllofant = ant.decl

				self.toCustomer2(mundane, primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, lonlofant, latlofant, ralofant, decllofant, chart.Chart.CONJUNCTIO)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				lonlofcant = cant.lon
				latlofcant = cant.lat
				ralofcant = cant.ra
				decllofcant = cant.decl

				self.toCustomer2(mundane, primdirs.PrimDir.CONTRAANTLOF, primdirs.PrimDir.NONE, lonlofcant, latlofcant, ralofcant, decllofcant, chart.Chart.CONJUNCTIO)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				lonant = ant.lon
				raant = ant.ra
				declant = ant.decl

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toCustomer2(mundane, typ, primdirs.PrimDir.NONE, lonant, 0.0, raant, declant, chart.Chart.CONJUNCTIO)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				loncant = cant.lon
				racant = cant.ra
				declcant = cant.decl

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toCustomer2(mundane, typ, primdirs.PrimDir.NONE, loncant, 0.0, racant, declcant, chart.Chart.CONJUNCTIO)


	def calcAntiscia2Customer2Sub(self, mundane, pls, offs):
		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			lonprom = plprom.lon
			latprom = plprom.lat
			raprom = plprom.ra
			declprom = plprom.decl

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latprom = 0.0
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

			self.toCustomer2(mundane, p+offs, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodPromAspsInterPlanetary(self):
		'''Calclucates zodiacal directions of the aspects of promissors to significators'''

		NODES = 2

		SINISTER = 0
		DEXTER = 1

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

			for psidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom_base = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
					lonprom = util.normalize(lonprom_base+aspect)
					latprom, raprom, declprom = 0.0, 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						ok, lonprom, latprom = self._zodiacal_aspect_position(p, lonprom_base, pllat, psidx, aspect)
						if not ok:
							continue

						#calc real(wahre)ra
#						raprom, declprom = util.getRaDecl(lonprom, latprom, self.chart.obl[0])
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(False, p, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, psidx, s, chart.Chart.CONJUNCTIO, True, aspect)


	def calcZodPromAsps2HCs(self):
		'''Calclucates zodiacal directions of the aspects of promissors to intermediate housecusps'''

		NODES = 2

		SINISTER = 0
		DEXTER = 1

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

			for psidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom_base = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
					lonprom = util.normalize(lonprom_base+aspect)
					latprom, raprom, declprom = 0.0, 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						ok, lonprom, latprom = self._zodiacal_aspect_position(p, lonprom_base, pllat, psidx, aspect)
						if not ok:
							continue

						#calc real(wahre)ra
#						raprom, declprom = util.getRaDecl(lonprom, latprom, self.chart.obl[0])
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					self.toHCs(False, p, raprom, declprom, psidx, aspect)


	def calcZodPromAspsInterPlanetary2Customer2(self):
		'''Calclucates zodiacal directions of the aspects of promissors to Customer2'''

		NODES = 2

		SINISTER = 0
		DEXTER = 1

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

			for psidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom_base = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
					lonprom = util.normalize(lonprom_base+aspect)
					latprom, raprom, declprom = 0.0, 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						ok, lonprom, latprom = self._zodiacal_aspect_position(p, lonprom_base, pllat, psidx, aspect)
						if not ok:
							continue

						#calc real(wahre)ra
#						raprom, declprom = util.getRaDecl(lonprom, latprom, self.chart.obl[0])
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					self.toCustomer2(False, p, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, psidx, aspect, True)


	def calcZodPromAntisciaAspsInterPlanetary(self):
		'''Calclucates zodiacal directions of the aspects of Antiscia to significators'''
		for points, offs in self._antiscia_point_sets():
			self.calcZodPromAntisciaAspsInterPlanetarySub(points, offs)


	def calcZodPromAntisciaAspsInterPlanetarySub(self, pls, offs):
		NODES = 2

		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			pllat = plprom.lat

			for psidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = util.normalize(plprom.lon+aspect)
					latprom, raprom, declprom = 0.0, 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						#calc real(wahre)ra
#						raprom, declprom = util.getRaDecl(lonprom, latprom, self.chart.obl[0])
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(
							False,
							p+offs,
							primdirs.PrimDir.NONE,
							lonprom,
							latprom,
							raprom,
							declprom,
							psidx,
							s,
							chart.Chart.CONJUNCTIO,
							row_promasp_offset=aspect,
						)


	def calcZodPromAntisciaAspsInterPlanetary2Customer2(self):
		'''Calclucates zodiacal directions of the aspects of Antiscia to significators'''

		for points, offs in self._antiscia_point_sets():
			self.calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(points, offs)


	def calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self, pls, offs):
		NODES = 2

		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			pllat = plprom.lat

			for psidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = util.normalize(plprom.lon+aspect)
					latprom, raprom, declprom = 0.0, 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						#calc real(wahre)ra
#						raprom, declprom = util.getRaDecl(lonprom, latprom, self.chart.obl[0])
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					self.toCustomer2(False, p+offs, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, psidx, aspect)


	def calc2HouseCusps(self, mundane):
		'''Calculates directions of Promissors to intermediate house cusps'''

		for i in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[i]:
				continue

			if self.abort.abort:
				return

			plprom = self.chart.planets.planets[i]
			raprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.DECL]

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(plprom.data[planets.Planet.LONG]), 0.0, 1.0, -self.chart.obl[0])

			self.toHCs(mundane, i, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcCustomer2HouseCusps(self, mundane):
		'''Calculates directions of Customer-Promissor to intermediate house cusps'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toHCs(mundane, primdirs.PrimDir.CUSTOMERPD, raprom, declprom, chart.Chart.CONJUNCTIO)

	def calcCustomer2GlobalHouseCusps(self, mundane):
		'''Calculates directions of Customer-promissor to global house cusp significators'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		latprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]
		raprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self._for_each_global_house_cusp_significator([
			lambda: self.toCustomer2(mundane, primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO, 0.0, True)
		])


	def calcAntiscia2HouseCusps(self, mundane):
		'''Calculates directions of Antiscia to intermediate house cusps'''

		for points, offs in self._antiscia_point_sets():
			self.calcAntiscia2HouseCuspsSub(mundane, points, offs)


	def calcAntiscia2HouseCuspsSub(self, mundane, pls, offs):
		#aspects of proms to HCs in Zodiacal!?

		for i in range(len(pls)):
			if not self.options.promplanets[i]:
				continue

			if self.abort.abort:
				return

			plprom = pls[i]
			if not self._valid_antiscia_point(plprom):
				continue
			raprom = plprom.ra
			declprom = plprom.decl

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(plprom.lon), 0.0, 1.0, -self.chart.obl[0])

			self.toHCs(mundane, i+offs, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodFixStars2HouseCusps(self):
		'''Calculates zodiacal directions of fixstars to HCs'''

		OFFS = primdirs.PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self.options.pdfixstarssel[self.chart.fixstars.mixed[i]]:
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toHCs(False, i+OFFS, rastar, declstar, chart.Chart.CONJUNCTIO)


	def	calcZodLoF2HouseCusps(self):
		'''Calculates zodiacal LoF to housecusps'''

		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toHCs(False, primdirs.PrimDir.LOF, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodLoF2Planets(self):
		'''Calculates zodiacal LoF to Planets and their aspects'''

		lonprom = self.chart.fortune.fortune[fortune.Fortune.LON]
		latprom = self.chart.fortune.fortune[fortune.Fortune.LAT]
		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toPlanets(False, primdirs.PrimDir.LOF, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodPlanets2LoF(self):
		'''Calculates zodiacal Planets and their aspects to LoF'''

		SINISTER = 0
		DEXTER = 1

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

			for psidx in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
					continue

				#We don't need the aspects of the nodes
				if p > astrology.SE_PLUTO and psidx > chart.Chart.CONJUNCTIO:
					break

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					if self.abort.abort:
						return

					lonprom_base = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
					lonprom = util.normalize(lonprom_base+aspect)
					latprom = 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						ok, lonprom, latprom = self._zodiacal_aspect_position(p, lonprom_base, pllat, psidx, aspect)
						if not ok:
							continue

					self.toLoF(p, primdirs.PrimDir.NONE, lonprom, latprom, psidx, aspect, True)


	def calcZodPlanets2Syzygy(self):
		'''Calculates zodiacal Planets and their aspects to Syzygy'''

		SINISTER = 0
		DEXTER = 1

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

			for psidx in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
					continue

				#We don't need the aspects of the nodes
				if p > astrology.SE_PLUTO and psidx > chart.Chart.CONJUNCTIO:
					break

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					if self.abort.abort:
						return

					lonprom_base = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
					lonprom = util.normalize(lonprom_base+aspect)
					latprom = 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						ok, lonprom, latprom = self._zodiacal_aspect_position(p, lonprom_base, pllat, psidx, aspect)
						if not ok:
							continue

					self.toSyzygy(p, primdirs.PrimDir.NONE, lonprom, latprom, psidx, aspect, True)


	def calcZodCustomer2LoF(self):
		'''Calculates zodiacal Customer to LoF'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		latprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]

		if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latprom = 0.0

		self.toLoF(primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, lonprom, latprom, chart.Chart.CONJUNCTIO)


	def calcZodCustomer2Syzygy(self):
		'''Calculates zodiacal Customer to Syzygy'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
		latprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]

		if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latprom = 0.0

		self.toSyzygy(primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, lonprom, latprom, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2LoF(self):
		'''Calculates zodiacal Antiscia and their aspects to LoF'''

		for points, offs in self._antiscia_point_sets():
			self.calcZodAntiscia2LoFSub(points, offs)

		#Antiscia/Contraant of LoF
		if self.options.pdlof[0]:
			ant = self.chart.antiscia.lofant
			lonlofant = ant.lon
			ralofant = ant.ra
			decllofant = ant.decl

			self.toLoF(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, lonlofant, 0.0, chart.Chart.CONJUNCTIO)

			#Contra
			cant = self.chart.antiscia.lofcontraant
			lonlofcant = ant.lon
			ralofcant = ant.ra
			decllofcant = ant.decl

			self.toLoF(primdirs.PrimDir.CONTRAANTLOF, primdirs.PrimDir.NONE, lonlofcant, 0.0, chart.Chart.CONJUNCTIO)

		#Antiscia of AscMC
		for i in range(2):
			ant = self.chart.antiscia.ascmcant[i]
			lonant = ant.lon
			raant = ant.ra
			declant = ant.decl

			typ = primdirs.PrimDir.ANTISCIONASC
			if i > 0:
				typ = primdirs.PrimDir.ANTISCIONMC

			self.toLoF(typ, primdirs.PrimDir.NONE, lonant, 0.0, chart.Chart.CONJUNCTIO)

		#Contraantiscia of AscMC
		for i in range(2):
			cant = self.chart.antiscia.ascmccontraant[i]
			loncant = ant.lon
			racant = ant.ra
			declcant = ant.decl

			typ = primdirs.PrimDir.CONTRAANTASC
			if i > 0:
				typ = primdirs.PrimDir.CONTRAANTMC

			self.toLoF(typ, primdirs.PrimDir.NONE, loncant, 0.0, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2LoFSub(self, pls, offs):
		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			pllat = plprom.lat

			for psidx in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
					continue

				#We don't need the aspects of the nodes
				if p > astrology.SE_PLUTO and psidx > chart.Chart.CONJUNCTIO:
					break

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					if self.abort.abort:
						return

					lonprom = util.normalize(plprom.lon+aspect)
					latprom = 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat
					self.toLoF(
						p+offs,
						primdirs.PrimDir.NONE,
						lonprom,
						latprom,
						psidx,
						row_promasp_offset=aspect,
					)


	def calcZodAntiscia2Syzygy(self):
		'''Calculates zodiacal Antiscia and their aspects to Syzygy'''

		for points, offs in self._antiscia_point_sets():
			self.calcZodAntiscia2SyzygySub(points, offs)

		#Antiscia/Contraant of LoF
		if self.options.pdlof[0]:
			ant = self.chart.antiscia.lofant
			lonlofant = ant.lon
			ralofant = ant.ra
			decllofant = ant.decl

			self.toSyzygy(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, lonlofant, 0.0, chart.Chart.CONJUNCTIO)

			#Contra
			cant = self.chart.antiscia.lofcontraant
			lonlofcant = ant.lon
			ralofcant = ant.ra
			decllofcant = ant.decl

			self.toSyzygy(primdirs.PrimDir.CONTRAANTLOF, primdirs.PrimDir.NONE, lonlofcant, 0.0, chart.Chart.CONJUNCTIO)

		#Antiscia of AscMC
		for i in range(2):
			ant = self.chart.antiscia.ascmcant[i]
			lonant = ant.lon
			raant = ant.ra
			declant = ant.decl

			typ = primdirs.PrimDir.ANTISCIONASC
			if i > 0:
				typ = primdirs.PrimDir.ANTISCIONMC

			self.toSyzygy(typ, primdirs.PrimDir.NONE, lonant, 0.0, chart.Chart.CONJUNCTIO)

		#Contraantiscia of AscMC
		for i in range(2):
			cant = self.chart.antiscia.ascmccontraant[i]
			loncant = ant.lon
			racant = ant.ra
			declcant = ant.decl

			typ = primdirs.PrimDir.CONTRAANTASC
			if i > 0:
				typ = primdirs.PrimDir.CONTRAANTMC

			self.toSyzygy(typ, primdirs.PrimDir.NONE, loncant, 0.0, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2SyzygySub(self, pls, offs):
		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			pllat = plprom.lat

			for psidx in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[psidx]:
					continue

				if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
					continue

				#We don't need the aspects of the nodes
				if p > astrology.SE_PLUTO and psidx > chart.Chart.CONJUNCTIO:
					break

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[psidx]
					if k == DEXTER:
						if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					if self.abort.abort:
						return

					lonprom = util.normalize(plprom.lon+aspect)
					latprom = 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat
					self.toSyzygy(
						p+offs,
						primdirs.PrimDir.NONE,
						lonprom,
						latprom,
						psidx,
						row_promasp_offset=aspect,
					)


	def calcZodTerms(self):
		'''Calculates zodiacal terms to Planets, LoF'''

		num = len(self.options.terms[0])
		subnum = len(self.options.terms[0][0])
		for i in range(num):
			summa = 0
			for j in range(subnum):

				if self.abort.abort:
					return

				lonprom = i*chart.Chart.SIGN_DEG+summa
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

				#Planets
				for s in range(len(self.chart.planets.planets)):
					if self.options.sigplanets[s]:
						plsig = self.chart.planets.planets[s]

						wprom, wsig = 0.0, 0.0
						if self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:# zod with sig's latitude
							wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]
							ok, wprom, ppole, seastern, md, umd = self.getZodW(plsig, lonprom, 0.0, plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE], plsig.eastern)
							if not ok:
								continue
						else:
							lonsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
							ok, wsig, spole, seastern, md, umd = self.getZodW(plsig, lonsig, 0.0)
							if not ok:
								continue
							ok, wprom, ppole, seastern, md, umd = self.getZodW(plsig, lonprom, 0.0, spole, seastern)
							if not ok:
								continue

						arc = wprom-wsig
						self.create(False, primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], s, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, arc)

				#LoF
				if self.options.pdlof[1]:
					self.toLoF(primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], lonprom, 0.0, chart.Chart.CONJUNCTIO)

				#Syzygy
				if self.options.pdsyzygy:
					self.toSyzygy(primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], lonprom, 0.0, chart.Chart.CONJUNCTIO)

				#Customer2
				if self._get_active_dynamic_sig_point() != None:
					self.toCustomer2(False, primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], lonprom, 0.0, raprom, declprom, chart.Chart.CONJUNCTIO)

				summa += self.options.terms[self.options.selterm][i][j][1]


	def calcZodFixStars2Planets(self):
		'''Calculates zodiacal directions of fixstars to planets'''

		OFFS = primdirs.PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self.options.pdfixstarssel[self.chart.fixstars.mixed[i]]:
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			latstar = star[fixstars.FixStars.LAT]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latstar = 0.0
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				if self.abort.abort:
					return

				self.toPlanet(False, i+OFFS, primdirs.PrimDir.NONE, lonstar, latstar, rastar, declstar, chart.Chart.CONJUNCTIO, s, chart.Chart.CONJUNCTIO)


	def calcZodAsc2Planets(self):
		'''Calculates zodiacal Asc and its aspects to Planets'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		self.calcZodAscMC2Planets(primdirs.PrimDir.ASC, lonprom)


	def calcZodMC2Planets(self):
		'''Calculates zodiacal MC and its aspects to Planets'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		self.calcZodAscMC2Planets(primdirs.PrimDir.MC, lonprom)


	def calcZodAscMC2Planets(self, p, lonprom):
		SINISTER = 0
		DEXTER = 1

		beg = chart.Chart.CONJUNCTIO
		if self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS]:
			beg += 1

#		for psidx in range(beg, chart.Chart.SEPTILE+1):
		for psidx in range(beg, chart.Chart.CONJUNCTIO+1):
			if not self.options.pdaspects[psidx]:
				continue

			if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
				break

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				for s in range(len(self.chart.planets.planets)):
					if not self.options.sigplanets[s]:
						continue

					if self.abort.abort:
						return

					self.toPlanet(False, p, primdirs.PrimDir.NONE, lon, 0.0, raprom, declprom, psidx, s, chart.Chart.CONJUNCTIO)


	def calcZodAsc2AspPlanets(self):
		'''Calculates zodiacal Asc to Planets and their aspects'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])
		self.toPlanets(False, primdirs.PrimDir.ASC, lonprom, 0.0, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodAsc2ParallelPlanets(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		self.toParallels(primdirs.PrimDir.ASC, lonprom, 0.0)


	def calcZodMC2AspPlanets(self):
		'''Calculates zodiacal MC to Planets and their aspects'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])
		self.toPlanets(False, primdirs.PrimDir.MC, lonprom, 0.0, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodMC2ParallelPlanets(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		self.toParallels(primdirs.PrimDir.MC, lonprom, 0.0)


	def calcZodAsc2HCs(self):
		'''Calculates zodiacal Asc to housecusps'''

		raprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.RA]
		declprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]

		self.toHCs(False, primdirs.PrimDir.ASC, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodMC2HCs(self):
		'''Calculates zodiacal MC to housecusps'''

		raprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
		declprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]

		self.toHCs(False, primdirs.PrimDir.MC, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodAsc2LoF(self):
		'''Calculates zodiacal Asc to LoF'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		self.calcZodAscMC2LoF(primdirs.PrimDir.ASC, lonprom)


	def calcZodMC2LoF(self):
		'''Calculates zodiacal MC to LoF'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		self.calcZodAscMC2LoF(primdirs.PrimDir.MC, lonprom)


	def calcZodAscMC2LoF(self, p, lonprom):
		SINISTER = 0
		DEXTER = 1

#		for psidx in range(chart.Chart.SEPTILE+1):
		for psidx in range(chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO+1):
			if not self.options.pdaspects[psidx]:
				continue

			if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
				break

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toLoF(p, primdirs.PrimDir.NONE, lon, 0.0, psidx)


	def calcZodAsc2Syzygy(self):
		'''Calculates zodiacal Asc to Syzygy'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		self.calcZodAscMC2Syzygy(primdirs.PrimDir.ASC, lonprom)


	def calcZodMC2Syzygy(self):
		'''Calculates zodiacal MC to Syzygy'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		self.calcZodAscMC2Syzygy(primdirs.PrimDir.MC, lonprom)


	def calcZodAscMC2Syzygy(self, p, lonprom):
		SINISTER = 0
		DEXTER = 1

#		for psidx in range(chart.Chart.SEPTILE+1):
		for psidx in range(chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO+1):
			if not self.options.pdaspects[psidx]:
				continue

			if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
				break

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toSyzygy(p, primdirs.PrimDir.NONE, lon, 0.0, psidx)


	def calcZodAsc2Customer2(self):
		'''Calculates zodiacal Asc to Customer2'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		self.calcZodAscMC2Customer2(primdirs.PrimDir.ASC, lonprom)


	def calcZodMC2Customer2(self):
		'''Calculates zodiacal MC to Customer2'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		self.calcZodAscMC2Customer2(primdirs.PrimDir.MC, lonprom)


	def calcZodAscMC2Customer2(self, p, lonprom):
		SINISTER = 0
		DEXTER = 1

#		for psidx in range(chart.Chart.SEPTILE+1):
		for psidx in range(chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO+1):
			if not self.options.pdaspects[psidx]:
				continue

			if not self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS] and psidx > chart.Chart.CONJUNCTIO:
				break

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toCustomer2(False, p, primdirs.PrimDir.NONE, lon, 0.0, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcParallels(self):
		'''Calculates mundo parallels'''

		PARALLEL = 0
		CONTRAPARALLEL = 1

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			raprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.DECL]

			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				#exclude AscNode -> DescNode or vice-versa
				if (p == astrology.SE_MEAN_NODE and s == astrology.SE_TRUE_NODE) or (p == astrology.SE_TRUE_NODE and s == astrology.SE_MEAN_NODE):
					continue

				if self.abort.abort:
					return

				plsig = self.chart.planets.planets[s]

				mdsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.MD]
				umdsig = True
				if mdsig < 0.0:
					mdsig *= -1
					umdsig = False

				wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]
				polesig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE]

				ra = self.ramc
				if not umdsig:
					ra = self.raic

				for k in range(CONTRAPARALLEL+1):
					parallelaxis = primdirs.PrimDir.MC
					aspsig = chart.Chart.PARALLEL

					rapprom = 0.0

					if k == PARALLEL:
						parallelaxis = primdirs.PrimDir.MC
						if not plsig.abovehorizon:
							parallelaxis = primdirs.PrimDir.IC

						aspsig = chart.Chart.PARALLEL

						wpprom = util.normalize(2*ra)-wsig
						wpprom = util.normalize(wpprom)

						val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
						if math.fabs(val) > 1.0:
							continue
						qpprom = math.degrees(math.asin(val))

						if plsig.eastern:
							rapprom = wpprom-qpprom
						else:
							rapprom = wpprom+qpprom
						rapprom = util.normalize(rapprom)
					else:
						parallelaxis = primdirs.PrimDir.ASC
						if not plsig.eastern:
							parallelaxis = primdirs.PrimDir.DESC

						aspsig = chart.Chart.CONTRAPARALLEL

						wpprom = util.normalize(util.normalize(2*ra)-wsig)+180.0
						wpprom = util.normalize(wpprom)

						val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
						if math.fabs(val) > 1.0:
							continue
						qpprom = math.degrees(math.asin(val))

						if plsig.eastern:#reverse the rules!?
							rapprom = wpprom+qpprom
						else:
							rapprom = wpprom-qpprom
						rapprom = util.normalize(rapprom)

					arc = raprom-rapprom
					ok = True
					if p == astrology.SE_MOON and self.options.pdsecmotion:
						for itera in range(self.options.pdsecmotioniter+1):
							ok, arc = self.calcPArcWithSM(p, s, k, arc)
							if not ok:
								break

					if ok:
						self.create(True, p, primdirs.PrimDir.NONE, s, chart.Chart.CONJUNCTIO, aspsig, arc, parallelaxis)


	def calcAntiscia2Parallels(self):
		'''Calculates antiscia to mundo parallels'''

		for points, offs in self._antiscia_point_sets():
			self.calcAntiscia2ParallelsSub(points, offs)


	def calcAntiscia2ParallelsSub(self, pls, offs):
		PARALLEL = 0
		CONTRAPARALLEL = 1

		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not self._valid_antiscia_point(plprom):
				continue
			raprom = plprom.ra
			declprom = plprom.decl

			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				#exclude AscNode -> DescNode or vice-versa
				if (p == astrology.SE_MEAN_NODE and s == astrology.SE_TRUE_NODE) or (p == astrology.SE_TRUE_NODE and s == astrology.SE_MEAN_NODE):
					continue

				if self.abort.abort:
					return

				plsig = self.chart.planets.planets[s]

				mdsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.MD]
				umdsig = True
				if mdsig < 0.0:
					mdsig *= -1
					umdsig = False

				wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]
				polesig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE]

				ra = self.ramc
				if not umdsig:
					ra = self.raic

				for k in range(CONTRAPARALLEL+1):
					parallelaxis = primdirs.PrimDir.MC
					aspsig = chart.Chart.PARALLEL

					rapprom = 0.0

					if k == PARALLEL:
						parallelaxis = primdirs.PrimDir.MC
						if not plsig.abovehorizon:
							parallelaxis = primdirs.PrimDir.IC

						aspsig = chart.Chart.PARALLEL

						wpprom = util.normalize(2*ra)-wsig
						wpprom = util.normalize(wpprom)

						val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
						if math.fabs(val) > 1.0:
							continue
						qpprom = math.degrees(math.asin(val))

						if plsig.eastern:
							rapprom = wpprom-qpprom
						else:
							rapprom = wpprom+qpprom
						rapprom = util.normalize(rapprom)
					else:
						parallelaxis = primdirs.PrimDir.ASC
						if not plsig.eastern:
							parallelaxis = primdirs.PrimDir.DESC

						aspsig = chart.Chart.CONTRAPARALLEL

						wpprom = util.normalize(util.normalize(2*ra)-wsig)+180.0
						wpprom = util.normalize(wpprom)

						val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
						if math.fabs(val) > 1.0:
							continue
						qpprom = math.degrees(math.asin(val))

						if plsig.eastern:#reverse the rules!?
							rapprom = wpprom+qpprom
						else:
							rapprom = wpprom-qpprom
						rapprom = util.normalize(rapprom)

					arc = raprom-rapprom
					self.create(True, p+offs, primdirs.PrimDir.NONE, s, chart.Chart.CONJUNCTIO, aspsig, arc, parallelaxis)


	def calcCustomer2Parallels(self):
		'''Calculates mundo parallels of the Customer point'''

		PARALLEL = 0
		CONTRAPARALLEL = 1

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		raprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.DECL]

		for s in range(len(self.chart.planets.planets)):
			if not self.options.sigplanets[s]:
				continue

			if self.abort.abort:
				return

			plsig = self.chart.planets.planets[s]

			mdsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.MD]
			umdsig = True
			if mdsig < 0.0:
				mdsig *= -1
				umdsig = False

			wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]
			polesig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE]

			ra = self.ramc
			if not umdsig:
				ra = self.raic

			for k in range(CONTRAPARALLEL+1):
				parallelaxis = primdirs.PrimDir.MC
				aspsig = chart.Chart.PARALLEL

				rapprom = 0.0

				if k == PARALLEL:
					parallelaxis = primdirs.PrimDir.MC
					if not plsig.abovehorizon:
						parallelaxis = primdirs.PrimDir.IC

					aspsig = chart.Chart.PARALLEL

					wpprom = util.normalize(2*ra)-wsig
					wpprom = util.normalize(wpprom)

					val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
					if math.fabs(val) > 1.0:
						continue
					qpprom = math.degrees(math.asin(val))

					if plsig.eastern:
						rapprom = wpprom-qpprom
					else:
						rapprom = wpprom+qpprom
					rapprom = util.normalize(rapprom)
				else:
					parallelaxis = primdirs.PrimDir.ASC
					if not plsig.eastern:
						parallelaxis = primdirs.PrimDir.DESC

					aspsig = chart.Chart.CONTRAPARALLEL

					wpprom = util.normalize(util.normalize(2*ra)-wsig)+180.0
					wpprom = util.normalize(wpprom)

					val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
					if math.fabs(val) > 1.0:
						continue
					qpprom = math.degrees(math.asin(val))

					if plsig.eastern:#reverse the rules!?
						rapprom = wpprom+qpprom
					else:
						rapprom = wpprom-qpprom
					rapprom = util.normalize(rapprom)

				arc = raprom-rapprom
				self.create(True, primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, s, chart.Chart.CONJUNCTIO, aspsig, arc, parallelaxis)


	def calcZodParallels(self):
		'''Calculates zodiacal parallels'''

		NODES = 2

		if self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS]:
			for p in range(len(self.chart.planets.planets)):
				if not self.options.promplanets[p]:
					continue

				plprom = self.chart.planets.planets[p]
				lonprom = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
				pllat = plprom.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

				latprom = 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#Bianchini is the same => only conjunctio
					latprom = pllat

				self.toParallels(p, lonprom, latprom)

			point = self._get_active_dynamic_prom_point()
			if point != None:
				lonprom = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
				pllat = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LAT]

				latprom = 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#Bianchini is the same => only conjunctio
					latprom = pllat

				self.toParallels(primdirs.PrimDir.CUSTOMERPD, lonprom, latprom)

		if self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS]:
			for p in range(len(self.chart.planets.planets)-NODES):
				if not self.options.promplanets[p]:
					continue

				ok = self.chart.zodpars.pars[p].valid
				points = self.chart.zodpars.pars[p].pts

				if not ok:
					continue

				for k in range(len(points)):
					if points[k][0] == -1.0:
						continue

					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(False, p, primdirs.PrimDir.NONE, points[k][0], 0.0, raprom, declprom, points[k][1], s, chart.Chart.CONJUNCTIO, False)
					if self._get_active_dynamic_sig_point() != None:
						self.toCustomer2(False, p, primdirs.PrimDir.NONE, points[k][0], 0.0, raprom, declprom, points[k][1])


	def calcZodAntisciaParallels(self):
		'''Calculates zodiacal parallels(Antiscia)'''

		self.calcZodAntisciaParallelsSub(self.chart.antiscia.plantiscia, self.chart.antzodpars.apars, primdirs.PrimDir.ANTISCION)
		self.calcZodAntisciaParallelsSub(self.chart.antiscia.plcontraant, self.chart.antzodpars.cpars, primdirs.PrimDir.CONTRAANT)


	def calcZodAntisciaParallelsSub(self, pls, pars, offs):
		NODES = 2

		if self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS]:
			for p in range(len(pls)):
				if not self.options.promplanets[p]:
					continue

				plprom = pls[p]
				if not self._valid_antiscia_point(plprom):
					continue
				lonprom = plprom.lon
				pllat = plprom.lat

				latprom = 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#Bianchini is the same => only conjunctio
					latprom = pllat

				self.toParallels(p+offs, lonprom, latprom)

			#Antiscia/Contraant of LoF
			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				lonlofant = ant.lon

				self.toParallels(primdirs.PrimDir.ANTISCIONLOF, lonlofant, 0.0)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				lonlofcant = cant.lon

				self.toParallels(primdirs.PrimDir.CONTRAANTLOF, lonlofcant, 0.0)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				lonant = ant.lon

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toParallels(typ, lonant, 0.0)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				loncant = cant.lon

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toParallels(typ, loncant, 0.0)

		if self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS]:
			for p in range(len(pls)-NODES):
				if not self.options.promplanets[p]:
					continue

				if self.abort.abort:
					return

				plprom = pls[p]
				if not self._valid_antiscia_point(plprom):
					continue

				ok = pars[p].valid
				points = pars[p].pts

				if not ok:
					continue

				for k in range(len(points)):
					if points[k][0] == -1.0:
						continue

					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(False, p+offs, primdirs.PrimDir.NONE, points[k][0], 0.0, raprom, declprom, points[k][1], s, chart.Chart.CONJUNCTIO)


	def calcZodMidPoints(self):
		'''Calclucates zodiacal midpoint directions'''

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			plprom = self.chart.planets.planets[mid.p1]

			#significators
			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				if self.abort.abort:
					return

				plsig = self.chart.planets.planets[s]
				lonsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
				lonmid = mid.m

				#if sig is closer to midpoint+180
				if math.fabs(lonmid-lonsig) > 90.0:
					lonmid += 180.0
					if lonmid >= 360.0:
						lonmid -= 360.0

				raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

				self.toPlanet(False, mid.p1, mid.p2, lonmid, mid.lat, raprom, declprom, chart.Chart.MIDPOINT, s, chart.Chart.CONJUNCTIO)


	def calcZodMidPoints2LoF(self):
		'''Calclucates zodiacal midpoint directions to LoF'''

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			if self.abort.abort:
				return

			lonmid = mid.m

			#significator
			lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			self.toLoF(mid.p1, mid.p2, lonmid, mid.lat, chart.Chart.MIDPOINT)


	def calcZodMidPoints2Syzygy(self):
		'''Calclucates zodiacal midpoint directions to Syzygy'''

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			if self.abort.abort:
				return

			lonmid = mid.m

			#significator
			lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			self.toSyzygy(mid.p1, mid.p2, lonmid, mid.lat, chart.Chart.MIDPOINT)


	def calcZodMidPoints2Customer2(self):
		'''Calclucates zodiacal midpoint directions to Customer2'''

		point = self._get_active_dynamic_sig_point()
		if point == None:
			return
		lonsig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			if self.abort.abort:
				return

			lonmid = mid.m

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

			self.toCustomer2(False, mid.p1, mid.p2, lonmid, mid.lat, raprom, declprom, chart.Chart.MIDPOINT)


	def calcZodLoF2ZodParallels(self):
		'''Calculates zodiacal LoF to zodiacal parallels'''

		lonprom = self.chart.fortune.fortune[fortune.Fortune.LON]
		self.toParallels(primdirs.PrimDir.LOF, lonprom, 0.0)


	def calcZodLoF2Syzygy(self):
		'''Calculates zodiacal LoF to Syzygy'''

		lonprom = self.chart.fortune.fortune[fortune.Fortune.LON]
		latprom = 0.0
		self.toSyzygy(primdirs.PrimDir.LOF, primdirs.PrimDir.NONE, lonprom, latprom, chart.Chart.CONJUNCTIO)


	def calcZodLoF2Customer2(self):
		'''Calculates zodiacal LoF to Customer2'''

		lonprom = self.chart.fortune.fortune[fortune.Fortune.LON]
		latprom = 0.0
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
		self.toCustomer2(False, primdirs.PrimDir.LOF, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodParallels2LoF(self):
		'''Calculates zodiacal parallels to zodiacal LoF'''

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			ok = self.chart.zodpars.pars[p].valid
			points = self.chart.zodpars.pars[p].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				self.toLoF(p, primdirs.PrimDir.NONE, points[k][0], 0.0, points[k][1])


	def calcZodParallels2Syzygy(self):
		'''Calculates zodiacal parallels to zodiacal Syzygy'''

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			ok = self.chart.zodpars.pars[p].valid
			points = self.chart.zodpars.pars[p].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				self.toSyzygy(p, primdirs.PrimDir.NONE, points[k][0], 0.0, points[k][1])


	def calcZodAntisciaParallels2LoF(self):
		'''Calculates zodiacal parallels to zodiacal LoF'''

		self.calcZodAntisciaParallels2LoFSub(self.chart.antzodpars.apars, primdirs.PrimDir.ANTISCION)
		self.calcZodAntisciaParallels2LoFSub(self.chart.antzodpars.cpars, primdirs.PrimDir.CONTRAANT)


	def calcZodAntisciaParallels2LoFSub(self, pars, offs):
		NODES = 2

		for p in range(planets.Planets.PLANETS_NUM-NODES):#Nodes are excluded
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			ok = pars[p].valid
			points = pars[p].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				self.toLoF(p+offs, primdirs.PrimDir.NONE, points[k][0], 0.0, points[k][1])


	def calcZodFixStars2LoF(self):
		'''Calclucates zodiacal Fixstars directions to LoF'''

		OFFS = primdirs.PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self.options.pdfixstarssel[self.chart.fixstars.mixed[i]]:
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			latstar = star[fixstars.FixStars.LAT]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latstar = 0.0
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toLoF(i+OFFS, primdirs.PrimDir.NONE, lonstar, latstar, chart.Chart.CONJUNCTIO)


	def calcZodFixStars2Syzygy(self):
		'''Calclucates zodiacal Fixstars directions to Syzygy'''

		OFFS = primdirs.PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self.options.pdfixstarssel[self.chart.fixstars.mixed[i]]:
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			latstar = star[fixstars.FixStars.LAT]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latstar = 0.0
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toSyzygy(i+OFFS, primdirs.PrimDir.NONE, lonstar, latstar, chart.Chart.CONJUNCTIO)


	def calcZodFixStars2Customer2(self):
		'''Calclucates zodiacal Fixstars directions to Customer2'''

		OFFS = primdirs.PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self.options.pdfixstarssel[self.chart.fixstars.mixed[i]]:
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			latstar = star[fixstars.FixStars.LAT]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latstar = 0.0
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toCustomer2(False, i+OFFS, primdirs.PrimDir.NONE, lonstar, latstar, rastar, declstar, chart.Chart.CONJUNCTIO)


	def calcPlanets2MLoF(self):
		pass


	def calcCustomer2MLoF(self):
		pass


	def calcAntiscia2MLoF(self):
		pass


	def toPlanets(self, mundane, idprom, lonprom, latprom, raprom, declprom, promasp):
		'''Calclucates mundane/zodiacal directions of the promissor to aspects of planets'''

		for s in range(len(self.chart.planets.planets)):
			if not self.options.sigplanets[s]:
				continue

			#exclude AscNode -> DescNode or vice-versa
			if (idprom == astrology.SE_MEAN_NODE and s == astrology.SE_TRUE_NODE) or (idprom == astrology.SE_TRUE_NODE and s == astrology.SE_MEAN_NODE):
				continue

			plsig = self.chart.planets.planets[s]

			if self.abort.abort:
				return

			for asidx in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[asidx] or (idprom == s and asidx == chart.Chart.CONJUNCTIO):
					continue

				if not mundane and not self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS] and asidx > chart.Chart.CONJUNCTIO:
					continue

				#We don't need the aspects of the nodes
				if s > astrology.SE_PLUTO and asidx > chart.Chart.CONJUNCTIO:
					break

				if self.abort.abort:
					return

				self.toPlanet(mundane, idprom, primdirs.PrimDir.NONE, lonprom, latprom, raprom, declprom, promasp, s, asidx)


	def toLoF(
		self,
		idprom,
		idprom2,
		lonprom,
		latprom,
		promasp,
		aspect=0.0,
		calcsecmotion=False,
		row_promasp_offset=None,
	):
		lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]
		pltmp = self.chart.planets.planets[0]

		ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
		if not ok:
			return
		ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
		if not ok:
			return	

		arc = wprom-wsig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMLoF(idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(
				False,
				idprom,
				idprom2,
				primdirs.PrimDir.LOF,
				promasp,
				chart.Chart.CONJUNCTIO,
				arc,
				promasp_offset=(
					aspect if row_promasp_offset is None else row_promasp_offset
				),
			)


	def toCustomer2(self, mundane, idprom, idprom2, lonprom, latprom, raprom, declprom, promasp, aspect = 0.0, calcsecmotion = False):
		wprom, wsig = 0.0, 0.0
		point = self._get_active_dynamic_sig_point()
		if point == None:
			return
		if mundane or self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH: #mundane or zod with sig's latitude
			wsig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.W]
			polesig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.POLE]
			val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
			if math.fabs(val) > 1.0:
				return
			qprom = math.degrees(math.asin(val))
			if point.eastern:
				wprom = raprom-qprom
			else:
				wprom = raprom+qprom
			wprom = util.normalize(wprom)#
		else:
			lonsig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
			pltmp = self.chart.planets.planets[0]

			ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
			if not ok:
				return
			ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
			if not ok:
				return	

		arc = wprom-wsig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMCustomer2(mundane, idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(
				mundane,
				idprom,
				idprom2,
				primdirs.PrimDir.CUSTOMERPD,
				promasp,
				chart.Chart.CONJUNCTIO,
				arc,
				promasp_offset=aspect,
			)


	def toSyzygy(
		self,
		idprom,
		idprom2,
		lonprom,
		latprom,
		promasp,
		aspect=0.0,
		calcsecmotion=False,
		row_promasp_offset=None,
	):
		lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]
		pltmp = self.chart.planets.planets[0]

		ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
		if not ok:
			return
		ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
		if not ok:
			return	

		arc = wprom-wsig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMSyzygy(idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(
				False,
				idprom,
				idprom2,
				primdirs.PrimDir.SYZ,
				promasp,
				chart.Chart.CONJUNCTIO,
				arc,
				promasp_offset=(
					aspect if row_promasp_offset is None else row_promasp_offset
				),
			)


	def toParallels(self, idprom, lonprom, latprom):
		NODES = 2
		for s in range(len(self.chart.planets.planets)-NODES):
			if not self.options.sigplanets[s]:
				continue

			plsig = self.chart.planets.planets[s]

			ok = self.chart.zodpars.pars[s].valid
			points = self.chart.zodpars.pars[s].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				if self.abort.abort:
					return

				ok, wsig, spole, seastern, md, umd = self.getZodW(plsig, points[k][0], 0.0)
				if not ok:
					continue
				ok, wprom, ppole, seastern, md, umd = self.getZodW(plsig, lonprom, latprom, spole, seastern)
				if not ok:
					continue

				arc = wprom-wsig
				self.create(False, idprom, primdirs.PrimDir.NONE, s, chart.Chart.CONJUNCTIO, points[k][1], arc)


	def getZodW(self, pl, lon, lat, spole=None, seastern=None):
		'''Calculates W, pole of the zodiacal(Regiomontan) point'''

		ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), lat, 1.0, -self.chart.obl[0])

		eastern = True
		if seastern == None:
			if self.ramc > self.raic:
				if ra > self.raic and ra < self.ramc:
					eastern = False
			else:
				if (ra > self.raic and ra < 360.0) or (ra < self.ramc and ra > 0.0):
					eastern = False
		else:
			eastern = seastern

		med = math.fabs(self.ramc-ra)

		if med > 180.0:
			med = 360.0-med
		icd = math.fabs(self.raic-ra)
		if icd > 180.0:
			icd = 360.0-icd

		md = med
		umd = True
		if icd < med:
			md = icd
			umd = False

		#zd
		zd = pl.getZD(md, self.chart.place.lat, decl, umd)

		#pole
		val = self.sinlat*math.sin(math.radians(zd))
		if math.fabs(val) > 1.0:
			return False, 0.0, 0.0, 0.0, 0.0, 0.0
		pole = math.degrees(math.asin(val))

		#Q
		p = pole
		if spole != None:
			p = spole
		val = math.tan(math.radians(decl))*math.tan(math.radians(p))
		if math.fabs(val) > 1.0:
			return False, 0.0, 0.0, 0.0, 0.0, 0.0
		Q = math.degrees(math.asin(val))

		#W
		W = 0.0
		if eastern:
			W = ra-Q
		else:
			W = ra+Q

		return True, util.normalize(W), pole, eastern, md, umd


	def calcPlanets2MLoF(self):
		pass


	def calcAntiscia2MLoF(self):
		pass


#######################################Secondary Motion of the Moon
	def calcPArcWithSM(self, idprom, idsig, k, arc):
		PARALLEL = 0
		CONTRAPARALLEL = 1

		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		raprom = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.RA]
		declprom = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.DECL]

		plsig = self.chart.planets.planets[idsig]

		mdsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.MD]
		umdsig = True
		if mdsig < 0.0:
			mdsig *= -1
			umdsig = False

		wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]
		polesig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE]

		ra = self.ramc
		if not umdsig:
			ra = self.raic

		parallelaxis = primdirs.PrimDir.MC
		aspsig = chart.Chart.PARALLEL

		rapprom = 0.0

		if k == PARALLEL:
			parallelaxis = primdirs.PrimDir.MC
			if not plsig.abovehorizon:
				parallelaxis = primdirs.PrimDir.IC

			aspsig = chart.Chart.PARALLEL

			wpprom = util.normalize(2*ra)-wsig
			wpprom = util.normalize(wpprom)

			val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
			if math.fabs(val) > 1.0:
				return False, 0.0
			qpprom = math.degrees(math.asin(val))

			if plsig.eastern:
				rapprom = wpprom-qpprom
			else:
				rapprom = wpprom+qpprom
			rapprom = util.normalize(rapprom)
		else:
			parallelaxis = primdirs.PrimDir.ASC
			if not plsig.eastern:
				parallelaxis = primdirs.PrimDir.DESC

			aspsig = chart.Chart.CONTRAPARALLEL

			wpprom = util.normalize(util.normalize(2*ra)-wsig)+180.0
			wpprom = util.normalize(wpprom)

			val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
			if math.fabs(val) > 1.0:
				return False, 0.0
			qpprom = math.degrees(math.asin(val))

			if plsig.eastern:#reverse the rules!?
				rapprom = wpprom+qpprom
			else:
				rapprom = wpprom-qpprom
			rapprom = util.normalize(rapprom)

		arc = raprom-rapprom

		return True, arc


	def calcArcWithSMLoF(self, idprom, psidx, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

		lonprom_base = pllon
		lonprom = util.normalize(lonprom_base+aspect)
		latprom = 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			ok, lonprom, latprom = self._zodiacal_aspect_position(idprom, lonprom_base, pllat, psidx, aspect)
			if not ok:
				return False, 0.0

		lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]
		pltmp = self.chart.planets.planets[0]

		ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
		if not ok:
			return False, 0.0
		ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
		if not ok:
			return False, 0.0

		arc = wprom-wsig

		return True, arc


	def calcArcWithSMSyzygy(self, idprom, psidx, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]

		lonprom_base = pllon
		lonprom = util.normalize(lonprom_base+aspect)
		latprom = 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			ok, lonprom, latprom = self._zodiacal_aspect_position(idprom, lonprom_base, pllat, psidx, aspect)
			if not ok:
				return False, 0.0

		lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]
		pltmp = self.chart.planets.planets[0]

		ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
		if not ok:
			return False, 0.0
		ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
		if not ok:
			return False, 0.0

		arc = wprom-wsig

		return True, arc


	def calcArcWithSM2(self, idprom, psidx, sig, paspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		lonprom_base = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]
		lonprom = util.normalize(lonprom_base+paspect)

		plsig = self.chart.planets.planets[sig]

#from calcZodPromAspInterPlanetary
		latprom, raprom, declprom = 0.0, 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			ok, lonprom, latprom = self._zodiacal_aspect_position(idprom, lonprom_base, pllat, psidx, paspect)
			if not ok:
				return False, 0.0

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

#from toPlanet
		wprom, wsig = 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			wsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.W]

			val = math.tan(math.radians(declprom))*math.tan(math.radians(plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.POLE]))
			if math.fabs(val) > 1.0:
				return False, 0.0
			qprom = math.degrees(math.asin(val))
			if plsig.eastern:
				wprom = raprom-qprom
			else:
				wprom = raprom+qprom
			wprom = util.normalize(wprom)#
		else: #zodiacal
			lonsig = plsig.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
			ok, wsig, spole, seastern, md, umd = self.getZodW(plsig, lonsig, 0.0)
			if not ok:
				return False, 0.0

			ok, wprom, ppole, seastern, md, umd = self.getZodW(plsig, lonprom, latprom, spole, seastern)
			if not ok:
				return False, 0.0

		arc = wprom-wsig
		return True, arc


	def calcArcWithSMCustomer2(self, mundane, idprom, psidx, paspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		lonprom_base = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.REGIOSPECULUM][planets.Planet.LAT]
		lonprom = util.normalize(lonprom_base+paspect)

#from calcZodPromAspInterPlanetary
		latprom, raprom, declprom = 0.0, 0.0, 0.0
		if mundane or self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			if not mundane:
				ok, lonprom, latprom = self._zodiacal_aspect_position(idprom, lonprom_base, pllat, psidx, paspect)
				if not ok:
					return False, 0.0
			else:
				latprom = pllat

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, distprom = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

#from toPlanet
		wprom, wsig = 0.0, 0.0
		point = self._get_active_dynamic_sig_point()
		if point == None:
			return False, 0.0
		if mundane or self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			wsig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.W]
			polesig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.POLE]

			val = math.tan(math.radians(declprom))*math.tan(math.radians(polesig))
			if math.fabs(val) > 1.0:
				return False, 0.0
			qprom = math.degrees(math.asin(val))
			if point.eastern:
				wprom = raprom-qprom
			else:
				wprom = raprom+qprom
			wprom = util.normalize(wprom)#
		else: #zodiacal
			lonsig = point.speculums[primdirs.PrimDirs.REGIOSPECULUM][customerpd.CustomerPD.LONG]
			pltmp = self.chart.planets.planets[0]
			ok, wsig, spole, seastern, md, umd = self.getZodW(pltmp, lonsig, 0.0)
			if not ok:
				return False, 0.0

			ok, wprom, ppole, seastern, md, umd = self.getZodW(pltmp, lonprom, latprom, spole, seastern)
			if not ok:
				return False, 0.0

		arc = wprom-wsig
		return True, arc
