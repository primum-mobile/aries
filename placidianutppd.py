import math
import astrology
import primdirs
import placidiancommonpd
import planets
import houses
import chart
import fortune
import syzygy
import fixstars
import secmotion
import customerpd
import util


#The UTP is zodiacal only.

class PlacidianUTPPD(placidiancommonpd.PlacidianCommonPD):
	'Implements Placidian(UnderThePole) Primary Directions'

	def __init__(self, chrt, options, pdrange, direction, abort):
		placidiancommonpd.PlacidianCommonPD.__init__(self, chrt, options, pdrange, direction, abort)


	def _force_getdata_for_sig(self):
		# Subclasses (TopocentricPD) override to force getData() so the
		# significator pole/AODO is recomputed instead of read from the
		# Placidian-only speculum cache.
		return False


	def calcInterPlanetary(self, mundane):
		'''Calculates mundane/zodiacal directions of the promissors to aspects of significators'''

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			plprom = self.chart.planets.planets[p]
			lonprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
			raprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

			self.toPlanets(mundane, p, raprom, declprom)


	def calcCustomerPlanetary(self, mundane):
		'''Calculates mundane/zodiacal directions of the Customer-promissor to aspects of significators'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			#recalc zodiacals
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toPlanets(mundane, primdirs.PrimDir.CUSTOMERPD, raprom, declprom)

	def calcZodCustomerPromAsps2Planets(self):
		'''Zodiacal ASPECTS of the active Customer (cross-chart) PROMISSOR to ALL
		significators -- planets (planet pole) and cusps/angles (the significator's own
		pole). The aspect point is the customer's lon +/- aspect (ecliptic, no latitude).
		This is the cross-class (R-E / E-R) analog of calcZodRingProms2Planets --
		calcCustomerPlanetary/toPlanets only emit the conjunction and the aspects OF the
		significator, so Marr's "significator <- aspect of epoch promissor" (e.g.
		JUP sq MON R-E, or MC 30 SUN E-R with an angle significator) was missing. Gated
		by options.pdcusppromissors. Runs inside _for_each_dynamic_promissor, so create()
		stamps promdyn = the active customer key.'''
		point = self._get_active_dynamic_prom_point()
		if point is None:
			return
		DEXTER = 1
		lonp = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		for promasp in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
			if not self.options.pdaspects[promasp]:
				continue
			if self.abort.abort:
				return
			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[promasp]
				if k == DEXTER:
					if promasp == chart.Chart.OPPOSITIO:
						break
					aspect *= -1
				lon = util.normalize(lonp+aspect)
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
				self._direct_aspect_point_to_sigs(primdirs.PrimDir.CUSTOMERPD, raprom, declprom, promasp, aspect)

	def calcCustomer2GlobalHouseCusps(self, mundane):
		'''Calculates directions of Customer-promissor to global house cusp significators'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self._for_each_global_house_cusp_significator([
			lambda: self.toCustomer2(mundane, primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO, 0.0, True)
		])


	def calcPlanetary2Customer2(self, mundane):
		'''Calculates mundane/zodiacal directions of the promissors to the Customer2 point'''

		for p in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			plprom = self.chart.planets.planets[p]
			raprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.DECL]

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				#recalc zodiacals
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(plprom.data[planets.Planet.LONG]), 0.0, 1.0, -self.chart.obl[0])

			self.toCustomer2(mundane, p, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO, 0.0, True)

	def calcCustomer2Customer2(self, mundane):
		'''Calculates directions of the active Customer-promissor to the active Customer2 significator'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]

		if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toCustomer2(mundane, primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcAntiscia2Planets(self, mundane):
		'''Calculates mundane/zodiacal directions of the antiscia to aspects of significators'''

		self.calcAntiscia2PlanetsSub(mundane, self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcAntiscia2PlanetsSub(mundane, self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcAntiscia2PlanetsSub(mundane, self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcAntiscia2PlanetsSub(mundane, self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)

		if not mundane:
			#Antiscia/Contraant of LoF
			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				ralofant = ant.ra
				decllofant = ant.decl
				self.toPlanets(mundane, primdirs.PrimDir.ANTISCIONLOF, ralofant, decllofant)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				ralofcant = cant.ra
				decllofcant = cant.decl
				self.toPlanets(mundane, primdirs.PrimDir.CONTRAANTLOF, ralofcant, decllofcant)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				raant = ant.ra
				declant = ant.decl

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toPlanets(mundane, typ, raant, declant)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				racant = cant.ra
				declcant = cant.decl

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toPlanets(mundane, typ, racant, declcant)


	def calcAntiscia2PlanetsSub(self, mundane, pls, offs):
		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			lonprom = plprom.lon
			raprom = plprom.ra
			declprom = plprom.decl

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				#recalc zodiacals
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

			self.toPlanets(mundane, p+offs, raprom, declprom)


	def calcAntiscia2Customer2(self, mundane):
		'''Calculates mundane/zodiacal directions of the antiscia to aspects of significators'''

		self.calcAntiscia2Customer2Sub(mundane, self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcAntiscia2Customer2Sub(mundane, self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcAntiscia2Customer2Sub(mundane, self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcAntiscia2Customer2Sub(mundane, self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)

		if not mundane:
			#Antiscia/Contraant of LoF
			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				ralofant = ant.ra
				decllofant = ant.decl

				self.toCustomer2(mundane, primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, ralofant, decllofant, chart.Chart.CONJUNCTIO)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				ralofcant = cant.ra
				decllofcant = cant.decl
				self.toCustomer2(mundane, primdirs.PrimDir.CONTRAANTLOF, primdirs.PrimDir.NONE, ralofcant, decllofcant, chart.Chart.CONJUNCTIO)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				raant = ant.ra
				declant = ant.decl

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toCustomer2(mundane, typ, primdirs.PrimDir.NONE, raant, declant, chart.Chart.CONJUNCTIO)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				racant = cant.ra
				declcant = cant.decl

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toCustomer2(mundane, typ, primdirs.PrimDir.NONE, racant, declcant, chart.Chart.CONJUNCTIO)


	def calcAntiscia2Customer2Sub(self, mundane, pls, offs):
		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			lonprom = plprom.lon
			raprom = plprom.ra
			declprom = plprom.decl

			if not mundane and self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				#recalc zodiacals
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

			self.toCustomer2(mundane, p+offs, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodPromAspsInterPlanetary(self):
		'''Calclucates zodiacal directions of the aspects of promissors to significators'''
		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

			for promasp in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.data[planets.Planet.LONG]+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.morin_excentric:
							lonprom, latprom = self.getMorinExcentric(p, plprom.data[planets.Planet.LONG], pllat, aspect)
						elif self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(False, p, primdirs.PrimDir.NONE, raprom, declprom, promasp, s, chart.Chart.CONJUNCTIO, True, aspect)


	def _ring_houses(self):
		# Normal house-cusp PDs do not read the displayed chart cusps: the
		# legacy engines compute their intermediate house geometry internally
		# in toHCs(). This narrow helper is only for the newer cusp/angle ring
		# feature (pdcusppromissors), which needs actual cusp longitudes because
		# cusps can act as promissors/significator points. Keep it PD-owned, not
		# chart-display-owned. The private flag intentionally preserves the old
		# displayed-ring source for possible future primary-chart drawings.
		H = self.chart.houses
		if bool(getattr(self.options, '_pd_use_display_house_cusp_significators', False)):
			return H
		hsys = primdirs.PrimDirs.house_system_for_primarydir(getattr(self.options, 'primarydir', None))
		if not hsys or getattr(H, 'ui_hsys', None) == hsys:
			return H
		try:
			hflag = 0
			if getattr(self.options, 'ayanamsha', 0) != 0:
				astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(self.options.ayanamsha), 0, 0)
				hflag |= astrology.SEFLG_SIDEREAL
			return houses.Houses(
				self.chart.time.jd,
				hflag,
				self.chart.place.lat,
				self.chart.place.lon,
				hsys,
				self.chart.obl[0],
				getattr(self.options, 'ayanamsha', 0),
				getattr(self.chart, 'ayanamsha_offset', 0.0),
			)
		except Exception:
			return H

	def _ring_points(self):
		'''The radix/base house ring as (PrimDir code, longitude): the four angles
		plus the eight intermediate cusps. Used both as promissors and as
		(pole-bearing) significators.'''
		H = self._ring_houses()
		asclon = H.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		mclon = H.ascmc2[houses.Houses.MC][houses.Houses.LON]
		return [
			(primdirs.PrimDir.ASC, asclon), (primdirs.PrimDir.MC, mclon),
			(primdirs.PrimDir.IC, util.normalize(mclon+180.0)),
			(primdirs.PrimDir.DESC, util.normalize(asclon+180.0)),
			(primdirs.PrimDir.HC2, H.cusps[2]), (primdirs.PrimDir.HC3, H.cusps[3]),
			(primdirs.PrimDir.HC5, H.cusps[5]), (primdirs.PrimDir.HC6, H.cusps[6]),
			(primdirs.PrimDir.HC8, H.cusps[8]), (primdirs.PrimDir.HC9, H.cusps[9]),
			(primdirs.PrimDir.HC11, H.cusps[11]), (primdirs.PrimDir.HC12, H.cusps[12]),
		]

	def _toSigPoint(self, idprom, raprom, declprom, promasp, sig_id, sig_lon):
		'''Direct a promissor aspect point (ecliptic ra/decl) to a cusp/angle
		SIGNIFICATOR treated as a pole-bearing point (its own longitude), under the
		significator's topocentric pole -- the toPlanet arc, but for a non-planet
		significator. getData(sig_lon, 0) yields the right pole for every ring point
		(0 on the MC/IC meridian, the geographic latitude on the ASC/DSC horizon, the
		Polich-Page cone pole on an intermediate cusp), so this is Marr's "pole on the
		significator" -- unlike toHCs/toAscMC, which treat cusps/angles as mundane
		house circles / great circles.'''
		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(sig_lon, 0.0)
		if not ok:
			return
		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))
		aodo = raprom-adprom if sigeastern else raprom+adprom
		arc = aodo-aodosig
		self.create(False, idprom, primdirs.PrimDir.NONE, sig_id, promasp, chart.Chart.CONJUNCTIO, arc)

	def _direct_aspect_point_to_sigs(self, promid, raprom, declprom, promasp, aspect_signed):
		'''Direct one promissor aspect point to ALL significators: planets (toPlanet,
		planet pole) and the cusps/angles (_toSigPoint, the significator's own pole).
		Shared by the ring- and customer-promissor methods so every promissor reaches
		every significator type with the aspect on the promissor.'''
		for s in range(len(self.chart.planets.planets)):
			if not self.options.sigplanets[s]:
				continue
			if self.abort.abort:
				return
			self.toPlanet(False, promid, primdirs.PrimDir.NONE, raprom, declprom, promasp, s, chart.Chart.CONJUNCTIO, True, aspect_signed)
		if getattr(self.options, 'sighouses', False):
			for sig_id, sig_lon in self._ring_points():
				if sig_id == promid:
					continue
				if self.abort.abort:
					return
				self._toSigPoint(promid, raprom, declprom, promasp, sig_id, sig_lon)

	def calcZodRingProms2Planets(self):
		'''Zodiacal: house-cusp and angle PROMISSORS (conjunction + aspects) to ALL
		significators -- planets (planet pole) and the other cusps/angles (the
		significator's own pole). Produces e.g. "Uranus <- trine of Asc",
		"Saturn <- sextile of cusp XII", and cusp/angle <- cusp/angle ("bodiless")
		directions the planet->cusp/angle paths cannot express. Mirrors
		calcZodPromAspsInterPlanetary but iterates the house ring as the promissor.
		Gated by options.pdcusppromissors (default off => no change to existing output).'''
		DEXTER = 1
		for promid, lonp in self._ring_points():
			for promasp in range(chart.Chart.CONJUNCTIO, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.CONJUNCTIO or promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lon = util.normalize(lonp+aspect)
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
					self._direct_aspect_point_to_sigs(promid, raprom, declprom, promasp, aspect)

	def calcZodPlanetPromAsps2CuspSigs(self):
		'''Zodiacal aspects (and conjunction) of PLANET promissors to intermediate-CUSP
		SIGNIFICATORS as pole-bearers (_toSigPoint) -- e.g. "cusp III <- trine of Pluto",
		"cusp XII <- sextile of Venus". The shipped planet->cusp path
		(calcZodPromAsps2HCs / toHCs) treats a cusp as a mundane house circle, which is
		~tens of arcminutes off Marr's pole-on-the-significator; this emits the correct
		cusp-as-pole arc alongside it. Angle significators are already correct via
		calcZodAscMC, so they are skipped here. Gated by pdcusppromissors.'''
		NODES = 2
		DEXTER = 1
		ANGLES = (primdirs.PrimDir.ASC, primdirs.PrimDir.MC, primdirs.PrimDir.IC, primdirs.PrimDir.DESC)
		cusp_sigs = [(cid, lon) for cid, lon in self._ring_points() if cid not in ANGLES]
		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue
			plprom = self.chart.planets.planets[p]
			for promasp in range(chart.Chart.CONJUNCTIO, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue
				if self.abort.abort:
					return
				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.CONJUNCTIO or promasp == chart.Chart.OPPOSITIO:
							break
						aspect *= -1
					lon = util.normalize(plprom.data[planets.Planet.LONG]+aspect)
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
					for sig_id, sig_lon in cusp_sigs:
						if self.abort.abort:
							return
						self._toSigPoint(p, raprom, declprom, promasp, sig_id, sig_lon)


	def calcZodPromAspsInterPlanetary2Customer2(self):
		'''Calclucates zodiacal directions of the aspects of promissors to Customer2'''

		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

			for promasp in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.data[planets.Planet.LONG]+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.morin_excentric:
							lonprom, latprom = self.getMorinExcentric(p, plprom.data[planets.Planet.LONG], pllat, aspect)
						elif self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					self.toCustomer2(False, p, primdirs.PrimDir.NONE, raprom, declprom, promasp, aspect, True)


	def calcZodPromAntisciaAspsInterPlanetary(self):
		'''Calclucates zodiacal directions of the aspects of Antiscia to significators'''

		self.calcZodPromAntisciaAspsInterPlanetarySub(self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcZodPromAntisciaAspsInterPlanetarySub(self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcZodPromAntisciaAspsInterPlanetarySub(self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcZodPromAntisciaAspsInterPlanetarySub(self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)


	def calcZodPromAntisciaAspsInterPlanetarySub(self, pls, offs):
		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			pllat = plprom.lat

			for promasp in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.lon+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					for s in range(len(self.chart.planets.planets)):
						if not self.options.sigplanets[s]:
							continue

						if self.abort.abort:
							return

						self.toPlanet(False, p+offs, primdirs.PrimDir.NONE, raprom, declprom, promasp, s, chart.Chart.CONJUNCTIO)


	def calcZodPromAntisciaAspsInterPlanetary2Customer2(self):
		'''Calclucates zodiacal directions of the aspects of Antiscia to Customer2'''

		self.calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)


	def calcZodPromAntisciaAspsInterPlanetary2Customer2Sub(self, pls, offs):

		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			pllat = plprom.lat

			for promasp in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.lon+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					self.toCustomer2(False, p+offs, primdirs.PrimDir.NONE, raprom, declprom, promasp, aspect, True)


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

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				for s in range(len(self.chart.planets.planets)):
					if not self.options.sigplanets[s]:
						continue

					if self.abort.abort:
						return

					plsig = self.chart.planets.planets[s]
					self.toPlanet(False, p, primdirs.PrimDir.NONE, raprom, declprom, psidx, s, chart.Chart.CONJUNCTIO)


	def calcZodAsc2AspPlanets(self):
		'''Calculates zodiacal Asc to Planets and their aspects'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toPlanets(False, primdirs.PrimDir.ASC, raprom, declprom)


	def calcZodAsc2ParallelPlanets(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toZodParallels(primdirs.PrimDir.ASC, raprom, declprom)


	def calcZodMC2AspPlanets(self):
		'''Calculates zodiacal MC to Planets and their aspects'''

		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toPlanets(False, primdirs.PrimDir.MC, raprom, declprom)


	def calcZodMC2ParallelPlanets(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toZodParallels(primdirs.PrimDir.MC, raprom, declprom)


	def calcZodAsc2HCs(self):
		'''Calculates zodiacal Asc to housecusps'''

		raprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.RA]
		declprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.DECL]
		val = self.tanlat*math.tan(math.radians(declprom))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))

		dsa = 90.0+adprom
		nsa = 90.0-adprom

		self.toHCs(False, primdirs.PrimDir.ASC, raprom, dsa, nsa, chart.Chart.CONJUNCTIO)


	def calcZodMC2HCs(self):
		'''Calculates zodiacal MC to housecusps'''

		raprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
		declprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.DECL]
		val = self.tanlat*math.tan(math.radians(declprom))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))

		dsa = 90.0+adprom
		nsa = 90.0-adprom

		self.toHCs(False, primdirs.PrimDir.MC, raprom, dsa, nsa, chart.Chart.CONJUNCTIO)


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

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toLoF(p, primdirs.PrimDir.NONE, raprom, declprom, psidx)


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

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toCustomer2(False, p, primdirs.PrimDir.NONE, raprom, declprom, psidx, aspect)


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

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[psidx]
				if k == DEXTER:
					if psidx == chart.Chart.CONJUNCTIO or psidx == chart.Chart.OPPOSITIO:
						break

					aspect *= -1

				lon = util.normalize(lonprom+aspect)
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.toSyzygy(p, primdirs.PrimDir.NONE, raprom, declprom, psidx)


	def calcZodLoF2Planets(self):
		'''Calculates zodiacal LoF to Planets and their aspects'''

		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toPlanets(False, primdirs.PrimDir.LOF, raprom, declprom)


	def calcZodLoF2Customer2(self):
		'''Calculates zodiacal LoF to Customer2'''

		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toCustomer2(False, primdirs.PrimDir.LOF, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodPlanets2LoF(self):
		'''Calculates zodiacal Planets and their aspects to LoF'''

		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

			for promasp in range(chart.Chart.CONJUNCTIO, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.CONJUNCTIO or promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.data[planets.Planet.LONG]+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.morin_excentric:
							lonprom, latprom = self.getMorinExcentric(p, plprom.data[planets.Planet.LONG], pllat, aspect)
						elif self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					if self.abort.abort:
						return

					self.toLoF(p, primdirs.PrimDir.NONE, raprom, declprom, promasp, aspect, True)


	def calcZodPlanets2Syzygy(self):
		'''Calculates zodiacal Planets and their aspects to Syzygy'''

		SINISTER = 0
		DEXTER = 1

		NODES = 2

		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			plprom = self.chart.planets.planets[p]
			pllat = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

			for promasp in range(chart.Chart.CONJUNCTIO, chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[promasp]:
					continue

				if self.abort.abort:
					return

				for k in range(DEXTER+1):
					aspect = chart.Chart.Aspects[promasp]
					if k == DEXTER:
						if promasp == chart.Chart.CONJUNCTIO or promasp == chart.Chart.OPPOSITIO:
							break

						aspect *= -1

					lonprom = plprom.data[planets.Planet.LONG]+aspect
					lonprom = util.normalize(lonprom)
					raprom, declprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.morin_excentric:
							lonprom, latprom = self.getMorinExcentric(p, plprom.data[planets.Planet.LONG], pllat, aspect)
						elif self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[promasp])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

					if self.abort.abort:
						return

					self.toSyzygy(p, primdirs.PrimDir.NONE, raprom, declprom, promasp, aspect, True)


	def calcZodCustomer2LoF(self):
		'''Calculates zodiacal Customer to LoF'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]

		if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toLoF(primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodCustomer2Syzygy(self):
		'''Calculates zodiacal Customer to Syzygy'''

		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]

		if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		self.toSyzygy(primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2LoF(self):
		'''Calculates zodiacal Antiscia and their aspects to LoF'''

		self.calcZodAntiscia2LoFSub(self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcZodAntiscia2LoFSub(self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcZodAntiscia2LoFSub(self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcZodAntiscia2LoFSub(self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)

		if self.options.pdlof[0]:
			#Antiscia/Contraant of LoF
			ant = self.chart.antiscia.lofant
			ralofant = ant.ra
			decllofant = ant.decl
			self.toLoF(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, ralofant, decllofant, chart.Chart.CONJUNCTIO)

			#Contra
			cant = self.chart.antiscia.lofcontraant
			ralofcant = ant.ra
			decllofcant = ant.decl
			self.toLoF(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, ralofcant, decllofcant, chart.Chart.CONJUNCTIO)

		#Antiscia of AscMC
		for i in range(2):
			ant = self.chart.antiscia.ascmcant[i]
			raant = ant.ra
			declant = ant.decl

			typ = primdirs.PrimDir.ANTISCIONASC
			if i > 0:
				typ = primdirs.PrimDir.ANTISCIONMC

			self.toLoF(typ, primdirs.PrimDir.NONE, raant, declant, chart.Chart.CONJUNCTIO)

		#Contraantiscia of AscMC
		for i in range(2):
			cant = self.chart.antiscia.ascmccontraant[i]
			racant = ant.ra
			declcant = ant.decl

			typ = primdirs.PrimDir.CONTRAANTASC
			if i > 0:
				typ = primdirs.PrimDir.CONTRAANTMC

			self.toLoF(typ, primdirs.PrimDir.NONE, racant, declcant, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2LoFSub(self, pls, offs):
		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			pllat = plprom.lat

			if self.abort.abort:
				return

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

					lon = plprom.lon+aspect
					lon = util.normalize(lon)
					raprom, adprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

					if self.abort.abort:
						return

					self.toLoF(p+offs, primdirs.PrimDir.NONE, raprom, declprom, psidx)


	def calcZodAntiscia2Syzygy(self):
		'''Calculates zodiacal Antiscia and their aspects to Syzygy'''

		self.calcZodAntiscia2SyzygySub(self.chart.antiscia.plantiscia, primdirs.PrimDir.ANTISCION)
		self.calcZodAntiscia2SyzygySub(self.chart.antiscia.plcontraant, primdirs.PrimDir.CONTRAANT)
		if getattr(self.chart.antiscia, 'morin_antiscia', False):
			if getattr(self.chart.antiscia, 'plantiscia_secondary', None):
				self.calcZodAntiscia2SyzygySub(self.chart.antiscia.plantiscia_secondary, primdirs.PrimDir.ANTISCION)
			if getattr(self.chart.antiscia, 'plcontraant_secondary', None):
				self.calcZodAntiscia2SyzygySub(self.chart.antiscia.plcontraant_secondary, primdirs.PrimDir.CONTRAANT)

		if self.options.pdlof[0]:
			#Antiscia/Contraant of LoF
			ant = self.chart.antiscia.lofant
			ralofant = ant.ra
			decllofant = ant.decl
			self.toSyzygy(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, ralofant, decllofant, chart.Chart.CONJUNCTIO)

			#Contra
			cant = self.chart.antiscia.lofcontraant
			ralofcant = ant.ra
			decllofcant = ant.decl
			self.toSyzygy(primdirs.PrimDir.ANTISCIONLOF, primdirs.PrimDir.NONE, ralofcant, decllofcant, chart.Chart.CONJUNCTIO)

		#Antiscia of AscMC
		for i in range(2):
			ant = self.chart.antiscia.ascmcant[i]
			raant = ant.ra
			declant = ant.decl

			typ = primdirs.PrimDir.ANTISCIONASC
			if i > 0:
				typ = primdirs.PrimDir.ANTISCIONMC

			self.toSyzygy(typ, primdirs.PrimDir.NONE, raant, declant, chart.Chart.CONJUNCTIO)

		#Contraantiscia of AscMC
		for i in range(2):
			cant = self.chart.antiscia.ascmccontraant[i]
			racant = ant.ra
			declcant = ant.decl

			typ = primdirs.PrimDir.CONTRAANTASC
			if i > 0:
				typ = primdirs.PrimDir.CONTRAANTMC

			self.toSyzygy(typ, primdirs.PrimDir.NONE, racant, declcant, chart.Chart.CONJUNCTIO)


	def calcZodAntiscia2SyzygySub(self, pls, offs):
		SINISTER = 0
		DEXTER = 1

		for p in range(len(pls)):
			if not self.options.promplanets[p]:
				continue

			plprom = pls[p]
			if not getattr(plprom, 'valid', True): continue
			pllat = plprom.lat

			if self.abort.abort:
				return

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

					lon = plprom.lon+aspect
					lon = util.normalize(lon)
					raprom, adprom = 0.0, 0.0
					if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
						latprom = 0.0
						if self.options.bianchini:
							val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
							if math.fabs(val) > 1.0:
								continue
							latprom = math.degrees(math.asin(val))
						else:
							latprom = pllat

						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
					else:
						raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

					if self.abort.abort:
						return

					self.toSyzygy(p+offs, primdirs.PrimDir.NONE, raprom, declprom, psidx)


	def calcZodTerms(self):
		'''Calculates zodiacal terms to Planets, LoF, Syzygy and Customer2'''

		num = len(self.options.terms[0])
		subnum = len(self.options.terms[0][0])
		for i in range(num):
			summa = 0
			for j in range(subnum):
				lonprom = i*chart.Chart.SIGN_DEG+summa
				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

				if self.abort.abort:
					return

				#Planets
				for s in range(len(self.chart.planets.planets)):
					if self.options.sigplanets[s]:
						self.toPlanet(False, primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], raprom, declprom, chart.Chart.CONJUNCTIO, s, chart.Chart.CONJUNCTIO)

				#LoF
				if self.options.pdlof[1]:
					self.toLoF(primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], raprom, declprom, chart.Chart.CONJUNCTIO)

				#Syzygy
				if self.options.pdsyzygy:
					self.toSyzygy(primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], raprom, declprom, chart.Chart.CONJUNCTIO)

				#Customer2
				if self._get_active_dynamic_sig_point() != None:
					self.toCustomer2(False, primdirs.PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], raprom, declprom, chart.Chart.CONJUNCTIO)

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
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				if self.abort.abort:
					return

				self.toPlanet(False, i+OFFS, primdirs.PrimDir.NONE, rastar, declstar, chart.Chart.CONJUNCTIO, s, chart.Chart.CONJUNCTIO)


	def calcZodFixStars2Customer2(self):
		'''Calculates zodiacal directions of fixstars to Customer2'''

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

			self.toCustomer2(False, i+OFFS, primdirs.PrimDir.NONE, rastar, declstar, chart.Chart.CONJUNCTIO)


	def calcParallels(self):
		'''Calculates mundo parallels'''

		pass


	def calcAntiscia2Parallels(self):
		'''Calculates antiscia to mundo parallels'''

		pass


	def calcAntiscia2ParallelsSub(self, pls, offs):
		pass


	def calcCustomer2Parallels(self):
		'''Calculates mundo parallels of the Customer Point'''

		pass


	def calcZodParallels(self):
		'''Calculates zodiacal parallels'''

		if self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS]:
			for p in range(len(self.chart.planets.planets)):
				if not self.options.promplanets[p]:
					continue

				if self.abort.abort:
					return

				plprom = self.chart.planets.planets[p]
				lonprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]

				raprom, declprom = 0.0, 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#Bianchini is the same since only conjunctio
					raprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.RA]
					declprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.DECL]
				else:
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

				self.toZodParallels(p, raprom, declprom)

			point = self._get_active_dynamic_prom_point()
			if point != None:
				lonprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]

				raprom, declprom = 0.0, 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#Bianchini is the same since only conjunctio
					raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
					declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]
				else:
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

				self.toZodParallels(primdirs.PrimDir.CUSTOMERPD, raprom, declprom)

		if self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS]:
			NODES = 2

			for p in range(len(self.chart.planets.planets)-NODES):
				if not self.options.promplanets[p]:
					continue

				if self.abort.abort:
					return

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

						self.toPlanet(False, p, primdirs.PrimDir.NONE, raprom, declprom, points[k][1], s, chart.Chart.CONJUNCTIO, False)

					if self._get_active_dynamic_sig_point() != None:
						self.toCustomer2(False, p, primdirs.PrimDir.NONE, raprom, declprom, points[k][1])


	def calcZodAntisciaParallels(self):
		'''Calculates zodiacal parallels(Antiscia)'''

		self.calcZodAntisciaParallelsSub(self.chart.antiscia.plantiscia, self.chart.antzodpars.apars, primdirs.PrimDir.ANTISCION)
		self.calcZodAntisciaParallelsSub(self.chart.antiscia.plcontraant, self.chart.antzodpars.cpars, primdirs.PrimDir.CONTRAANT)
		# NOTE: Morin secondary antiscia don't fire here yet — would require a parallel
		# antzodpars built from plantiscia_secondary / plcontraant_secondary. Left for a follow-up.


	def calcZodAntisciaParallelsSub(self, pls, pars, offs):
		if self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS]:
			for p in range(len(pls)):
				if not self.options.promplanets[p]:
					continue

				if self.abort.abort:
					return

				plprom = pls[p]
				if not getattr(plprom, 'valid', True): continue
				lonprom = plprom.lon
				pllat = plprom.lat

				raprom, adprom = 0.0, 0.0
				if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
					#This is only conjunction, so bianchini is the same
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), pllat, 1.0, -self.chart.obl[0])
				else:
					raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

				self.toZodParallels(p+offs, raprom, declprom)

			if self.options.pdlof[0]:
				ant = self.chart.antiscia.lofant
				ralofant = ant.ra
				decllofant = ant.decl
				self.toZodParallels(primdirs.PrimDir.ANTISCIONLOF, ralofant, decllofant)

				#Contra
				cant = self.chart.antiscia.lofcontraant
				ralofcant = cant.ra
				decllofcant = cant.decl
				self.toZodParallels(primdirs.PrimDir.CONTRAANTLOF, ralofcant, decllofcant)

			#Antiscia of AscMC
			for i in range(2):
				ant = self.chart.antiscia.ascmcant[i]
				raant = ant.ra
				declant = ant.decl

				typ = primdirs.PrimDir.ANTISCIONASC
				if i > 0:
					typ = primdirs.PrimDir.ANTISCIONMC

				self.toZodParallels(typ, raant, declant)

			#Contraantiscia of AscMC
			for i in range(2):
				cant = self.chart.antiscia.ascmccontraant[i]
				racant = cant.ra
				declcant = cant.decl

				typ = primdirs.PrimDir.CONTRAANTASC
				if i > 0:
					typ = primdirs.PrimDir.CONTRAANTMC

				self.toZodParallels(typ, racant, declcant)

		if self.options.zodpromsigasps[primdirs.PrimDirs.ASPSPROMSTOSIGS]:
			NODES = 2
			for p in range(planets.Planets.PLANETS_NUM-NODES):#Nodes are excluded
				if not self.options.promplanets[p]:
					continue

				if self.abort.abort:
					return

				ok = pars[i].valid
				points = pars[i].pts

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

						self.toPlanet(False, p+offs, primdirs.PrimDir.NONE, raprom, declprom, points[k][1], s, chart.Chart.CONJUNCTIO)


	def calcZodLoF2ZodParallels(self):
		'''Calculates zodiacal LoF to zodiacal parallels'''

		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toZodParallels(primdirs.PrimDir.LOF, raprom, declprom)


	def calcZodLoF2Syzygy(self):
		'''Calculates zodiacal LoF to Syzygy'''

		raprom = self.chart.fortune.fortune[fortune.Fortune.RA]
		declprom = self.chart.fortune.fortune[fortune.Fortune.DECL]

		self.toSyzygy(primdirs.PrimDir.LOF, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO)


	def calcZodParallels2LoF(self):
		'''Calculates zodiacal parallels to zodiacal LoF'''

		NODES = 2
		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			ok = self.chart.zodpars.pars[p].valid
			points = self.chart.zodpars.pars[p].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

				self.toLoF(p, primdirs.PrimDir.NONE, raprom, declprom, points[k][1])


	def calcZodParallels2Syzygy(self):
		'''Calculates zodiacal parallels to zodiacal Syzygy'''

		NODES = 2
		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue

			if self.abort.abort:
				return

			ok = self.chart.zodpars.pars[p].valid
			points = self.chart.zodpars.pars[p].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

				self.toSyzygy(p, primdirs.PrimDir.NONE, raprom, declprom, points[k][1])


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

			ok = pars[i].valid
			points = pars[i].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

				self.toLoF(p+offs, primdirs.PrimDir.NONE, raprom, declprom, points[k][1])


	def calcZodMidPoints(self):
		'''Calclucates zodiacal midpoint directions'''

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			if self.abort.abort:
				return

			#significators
			for s in range(len(self.chart.planets.planets)):
				if not self.options.sigplanets[s]:
					continue

				if self.abort.abort:
					return

				plsig = self.chart.planets.planets[s]
				lonsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
				lonmid = mid.m

				#if sig is closer to midpoint+180
				if math.fabs(lonmid-lonsig) > 90.0:
					lonmid += 180.0
					if lonmid >= 360.0:
						lonmid -= 360.0

				raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

				self.toPlanet(False, mid.p1, mid.p2, raprom, declprom, chart.Chart.MIDPOINT, s, chart.Chart.CONJUNCTIO)


	def calcZodMidPoints2LoF(self):
		'''Calclucates zodiacal midpoint directions to LoF'''

		lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			lonmid = mid.m

			if self.abort.abort:
				return

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

			self.toLoF(mid.p1, mid.p2, raprom, declprom, chart.Chart.MIDPOINT)


	def calcZodMidPoints2Syzygy(self):
		'''Calclucates zodiacal midpoint directions to Syzygy'''

		lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			lonmid = mid.m

			if self.abort.abort:
				return

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

			self.toSyzygy(mid.p1, mid.p2, raprom, declprom, chart.Chart.MIDPOINT)


	def calcZodMidPoints2Customer2(self):
		'''Calclucates zodiacal midpoint directions to Customer'''

		point = self._get_active_dynamic_sig_point()
		if point == None:
			return
		lonsig = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			lonmid = mid.m

			if self.abort.abort:
				return

			#if sig is closer to midpoint+180
			if math.fabs(lonmid-lonsig) > 90.0:
				lonmid += 180.0
				if lonmid >= 360.0:
					lonmid -= 360.0

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonmid), mid.lat, 1.0, -self.chart.obl[0])

			self.toCustomer2(False, mid.p1, mid.p2, raprom, declprom, chart.Chart.MIDPOINT)


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
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toLoF(i+OFFS, primdirs.PrimDir.NONE, rastar, declstar, chart.Chart.CONJUNCTIO)


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
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			self.toSyzygy(i+OFFS, primdirs.PrimDir.NONE, rastar, declstar, chart.Chart.CONJUNCTIO)


	def calcPlanets2MLoF(self):
		pass


	def calcCustomer2MLoF(self):
		pass


	def calcAntiscia2MLoF(self):
		pass


	def calcAntiscia2MLoFSub(self, pls, offs):
		pass


	def toPlanets(self, mundane, idprom, raprom, declprom):
		'''Calculates the directions of the promissor to the planets and their aspects'''

		for s in range(len(self.chart.planets.planets)):
			if not self.options.sigplanets[s]:
				continue

			if self.abort.abort:
				return

			#exclude AscNode -> DescNode or vice-versa
			if (idprom == astrology.SE_MEAN_NODE and s == astrology.SE_TRUE_NODE) or (idprom == astrology.SE_TRUE_NODE and s == astrology.SE_MEAN_NODE):
				continue

			for sigasp in range(chart.Chart.SEPTILE+1):
				if not self.options.pdaspects[sigasp] or (idprom == s and sigasp == chart.Chart.CONJUNCTIO):
					continue

				if not self.options.zodpromsigasps[primdirs.PrimDirs.PROMSTOSIGASPS] and sigasp > chart.Chart.CONJUNCTIO:
					continue

				if self.abort.abort:
					return

				#We don't need the aspects of the nodes
				if s > astrology.SE_PLUTO and sigasp > chart.Chart.CONJUNCTIO:
					break

				self.toPlanet(mundane, idprom, primdirs.PrimDir.NONE, raprom, declprom, chart.Chart.CONJUNCTIO, s, sigasp)


	def toPlanet(self, mundane, idprom, idprom2, raprom, declprom, promasp, sig, sigasp, calcsecmotion=True, paspect=chart.Chart.NONE):
		SINISTER = 0
		DEXTER = 1

		plsig = self.chart.planets.planets[sig]
		latsig_orig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]
		latsig = latsig_orig

		aspect = chart.Chart.Aspects[sigasp]

		# Angle-as-promissor: ASC/MC/IC/DESC is a great circle (meridian or
		# horizon), not an ecliptic body, so the CONJUNCTION gets a meridian/horizon
		# arc below instead of the significator-pole projection. (BUG-2 fix.)
		# An ASPECT of an angle (e.g. Asc + 120) is an ordinary ecliptic point, not
		# a great circle, so it must use the normal significator-pole projection --
		# hence the promasp==CONJUNCTIO guard. (Cusps/angle aspect points as
		# promissors arrive here from calcZodRingProms2Planets.)
		angle_prom = (idprom2 == primdirs.PrimDir.NONE and promasp == chart.Chart.CONJUNCTIO and idprom in (
			primdirs.PrimDir.ASC, primdirs.PrimDir.DESC,
			primdirs.PrimDir.MC, primdirs.PrimDir.IC))

		latchanged = False
		sz_with_sig_lat = (self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH)
		if sz_with_sig_lat:
			if self.options.morin_excentric:
				latchanged = True	# we'll recompute lonsig/latsig per-side below
			elif self.options.bianchini:
				val = self.getBianchini(latsig, chart.Chart.Aspects[sigasp])
				if math.fabs(val) > 1.0:
					return
				latsig = math.degrees(math.asin(val))
				latchanged = True
		else:
			latsig = 0.0
			latchanged = True

		for k in range(DEXTER+1):
			if k == DEXTER:
				if sigasp == chart.Chart.CONJUNCTIO or sigasp == chart.Chart.OPPOSITIO:
					break

				aspect *= -1

			sigeastern = plsig.eastern
			lonsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
			phisig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.POH]
			aodosig = math.fabs(plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.AODO])

			if sz_with_sig_lat and self.options.morin_excentric and sigasp > chart.Chart.CONJUNCTIO:
				lonsig, latsig = self.getMorinExcentric(sig, lonsig, latsig_orig, aspect)
			elif sigasp > chart.Chart.CONJUNCTIO:
				lonsig += aspect
				lonsig = util.normalize(lonsig)

			if angle_prom:
				# The angle (promissor) is a great circle with no ascensional
				# difference of its own; bring the fixed significator(-aspect) point
				# to it by pure RA (MC/IC) or oblique ascension/descension under the
				# geographic latitude (ASC/DESC). Mirrors toAscMC (the inverse
				# planet->angle direction). Routing the angle through the
				# significator's topocentric pole would inject a spurious AD --
				# Marr/Polich-Page: RAMC and OAMC are equal. See BUG-2 in
				# doc/primary-directions-math-and-terminology.md.
				rasig, declsig, _dsig = astrology.swe_cotrans(self._lon_for_cotrans(lonsig), latsig, 1.0, -self.chart.obl[0])
				if idprom == primdirs.PrimDir.MC:
					arc = rasig-self.ramc
				elif idprom == primdirs.PrimDir.IC:
					arc = rasig-self.raic
				else:
					adval = self.tanlat*math.tan(math.radians(declsig))
					if math.fabs(adval) > 1.0:
						continue
					adgeo = math.degrees(math.asin(adval))
					if idprom == primdirs.PrimDir.ASC:
						arc = (rasig-adgeo)-self.aoasc
					else:
						arc = (rasig+adgeo)-self.dodesc
				ok = True
			else:
				if self._force_getdata_for_sig() or sigasp > chart.Chart.CONJUNCTIO or latchanged: #recalc data
					ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, latsig)
					if not ok:
						continue

				val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
				if math.fabs(val) > 1.0:
					continue
				adprom = math.degrees(math.asin(val))

				aodo = 0.0
				if sigeastern:
					aodo = raprom-adprom
				else:
					aodo = raprom+adprom

				arc = aodo-aodosig
				ok = True
			if idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion and calcsecmotion:
				if paspect == chart.Chart.NONE:
					for itera in range(self.options.pdsecmotioniter+1):
						ok, arc = self.calcArcWithSM(mundane, idprom, sig, sigasp, aspect, arc)
						if not ok:
							break
				else:
					for itera in range(self.options.pdsecmotioniter+1):
						ok, arc = self.calcArcWithSM2(idprom, promasp, sig, paspect, arc)
						if not ok:
							break

			if ok:
				self.create(mundane, idprom, idprom2, sig, promasp, sigasp, arc)


	def toLoF(self, idprom, idprom2, raprom, declprom, promasp, aspect = 0.0, calcsecmotion = False):
		lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, 0.0)
		if not ok:
			return

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMLoF(idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(False, idprom, idprom2, primdirs.PrimDir.LOF, promasp, chart.Chart.CONJUNCTIO, arc)


	def toCustomer2(self, mundane, idprom, idprom2, raprom, declprom, promasp, aspect = 0.0, calcsecmotion = False):
		point = self._get_active_dynamic_sig_point()
		if point == None:
			return
		lonsig = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		latsig = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LAT]

		if self.options.subzodiacal != primdirs.PrimDirs.SZSIGNIFICATOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latsig = 0.0

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, latsig)
		if not ok:
			return

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMCustomer2(mundane, idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(False, idprom, idprom2, primdirs.PrimDir.CUSTOMERPD, promasp, chart.Chart.CONJUNCTIO, arc)


	def toCustomer2Asps(self, idprom, idprom2, raprom, declprom):
		'''In-mundo directions of a promissor to the ASPECTS of the Customer2
		significator. toCustomer2 produces only the conjunction; this adds
		square/trine/etc. by shifting the customer's longitude by the aspect and
		re-deriving its topocentric pole via getData() -- identical to how toPlanet
		forms a (non-angle) significator aspect, the only difference being the
		significator is a CustomerPD. Emitted with mundane=True.'''
		point = self._get_active_dynamic_sig_point()
		if point == None:
			return

		lon0 = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		lat0 = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LAT]
		if self.options.subzodiacal != primdirs.PrimDirs.SZSIGNIFICATOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			lat0 = 0.0

		DEXTER = 1
		for asidx in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
			if not self.options.pdaspects[asidx]:
				continue
			if self.abort.abort:
				return
			for k in range(DEXTER+1):
				aspect = chart.Chart.Aspects[asidx]
				if k == DEXTER:
					if asidx == chart.Chart.OPPOSITIO:
						break
					aspect *= -1

				lonsig = util.normalize(lon0+aspect)
				ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, lat0)
				if not ok:
					continue

				val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
				if math.fabs(val) > 1.0:
					continue
				adprom = math.degrees(math.asin(val))

				if sigeastern:
					aodo = raprom-adprom
				else:
					aodo = raprom+adprom

				arc = aodo-aodosig
				self.create(True, idprom, idprom2, primdirs.PrimDir.CUSTOMERPD, chart.Chart.CONJUNCTIO, asidx, arc)


	def calcMunPromAspsInterPlanetary2Customer2(self):
		'''In-mundo directions of the aspects of planet promissors to Customer2.

		Mundane counterpart of calcZodPromAspsInterPlanetary2Customer2 (which shifts
		the promissor longitude for zodiacal aspects): here the promissor keeps its
		real (RA, DECL) position and the aspect is taken on the customer significator
		via toCustomer2Asps, matching how toPlanet/toPlanets form mundane aspects.'''
		NODES = 2
		for p in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[p]:
				continue
			if self.abort.abort:
				return
			plprom = self.chart.planets.planets[p]
			raprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.RA]
			declprom = plprom.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.DECL]
			self.toCustomer2Asps(p, primdirs.PrimDir.NONE, raprom, declprom)


	def calcCustomer2Customer2Asps(self):
		'''In-mundo aspects of the active customer promissor to the active customer
		significator (the E-E crossing in Marr's Dual Test). Reuses toCustomer2Asps
		with the promissor customer's real (RA, DECL).'''
		point = self._get_active_dynamic_prom_point()
		if point == None:
			return
		raprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		declprom = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.DECL]
		self.toCustomer2Asps(primdirs.PrimDir.CUSTOMERPD, primdirs.PrimDir.NONE, raprom, declprom)


	def toSyzygy(self, idprom, idprom2, raprom, declprom, promasp, aspect = 0.0, calcsecmotion = False):
		lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, 0.0)
		if not ok:
			return

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig
		ok = True
		if calcsecmotion and idprom == astrology.SE_MOON and idprom2 == primdirs.PrimDir.NONE and self.options.pdsecmotion:
			for itera in range(self.options.pdsecmotioniter+1):
				ok, arc = self.calcArcWithSMSyzygy(idprom, promasp, aspect, arc)
				if not ok:
					break

		if ok:
			self.create(False, idprom, idprom2, primdirs.PrimDir.SYZ, promasp, chart.Chart.CONJUNCTIO, arc)


	def toMundaneLoF(self, idprom, idprom2, raprom, adprom, calcsecmotion=True):
		pass


	def toZodParallels(self, idprom, raprom, declprom):
		'''Calculates directions of the promissor to zodiacal parallels of the planets'''

		NODES = 2

		for s in range(len(self.chart.planets.planets)-NODES):
			if not self.options.sigplanets[s]:
				continue

			if self.abort.abort:
				return

			ok = self.chart.zodpars.pars[s].valid
			points = self.chart.zodpars.pars[s].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				if self.abort.abort:
					return

				ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(points[k][0], 0.0)
				if not ok:
					return

				val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
				if math.fabs(val) > 1.0:
					continue
				adprom = math.degrees(math.asin(val))

				aodo = 0.0
				if sigeastern:
					aodo = raprom-adprom
				else:
					aodo = raprom+adprom
			
				arc = aodo-aodosig
				self.create(False, idprom, primdirs.PrimDir.NONE, s, chart.Chart.CONJUNCTIO, points[k][1], arc)


	def getData(self, lon, lat):
		ramc = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
		raic = ramc+180.0
		if raic > 360.0:
			raic -= 360.0

		placelat = self.chart.place.lat

		ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), lat, 1.0, -self.chart.obl[0])

		ok = True

		eastern = True
		if ramc > raic:
			if ra > raic and ra < ramc:
				eastern = False
		else:
			if (ra > raic and ra < 360.0) or (ra < ramc and ra > 0.0):
				eastern = False

		#adlat
		adlat = 0.0
		val = math.tan(math.radians(placelat))*math.tan(math.radians(decl))
		if math.fabs(val) <= 1.0:
			adlat = math.degrees(math.asin(val))
		else:
			ok = False

		#md
		md = math.fabs(ramc-ra)

		if md > 180.0:
			md = 360.0-md
		icd = math.fabs(raic-ra)
		if icd > 180.0:
			icd = 360.0-icd

		#sa (southern hemisphere!?)
		dsa = 90.0+adlat
		nsa = 90.0-adlat

		abovehorizon = True
		if md > dsa:
			abovehorizon = False

		sa = dsa
		if not abovehorizon:
			sa = nsa
			md = icd

		#adphi
		tval = math.fabs(sa)
		adphi = 0.0
		if tval != 0.0:
			adphi = math.fabs(md)*adlat/tval

		#phi
		tval = math.tan(math.radians(decl))
		phi = 0.0
		if tval != 0.0:
			phi = math.degrees(math.atan(math.sin(math.radians(adphi))/tval))

		#ao/do (southern hemisphere!?)
		if eastern:
			ao = ra-adphi
		else:
			ao = ra+adphi

		return ok, eastern, abovehorizon, phi, ao


#####################################Moon's SecMotion
	def calcArcWithSM(self, mundane, idprom, sig, sigasp, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		lonprom = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		raprom = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.RA]
		declprom = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.DECL]

		if self.options.subzodiacal != primdirs.PrimDirs.SZPROMISSOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])

		plsig = self.chart.planets.planets[sig]
		sigeastern = plsig.eastern
		lonsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		latsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]
		phisig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.POH]
		aodosig = math.fabs(plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.AODO])

		latchanged = False
		if self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			if self.options.morin_excentric:
				if sigasp > chart.Chart.CONJUNCTIO:
					lonsig, latsig = self.getMorinExcentric(sig, lonsig, latsig, aspect)
				latchanged = True
			elif self.options.bianchini:
				val = self.getBianchini(latsig, chart.Chart.Aspects[sigasp])
				if math.fabs(val) > 1.0:
					return False, 0.0
				latsig = math.degrees(math.asin(val))
				latchanged = True
		else:
			latsig = 0.0
			latchanged = True

		if sigasp > chart.Chart.CONJUNCTIO and not (self.options.morin_excentric and (self.options.subzodiacal == primdirs.PrimDirs.SZSIGNIFICATOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH)):
			lonsig += aspect
			lonsig = util.normalize(lonsig)

		if self._force_getdata_for_sig() or sigasp > chart.Chart.CONJUNCTIO or latchanged: #recalc data
			ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, latsig)
			if not ok:
				return False, 0.0

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return False, 0.0
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig

		return True, arc


	def calcArcWithSM2(self, idprom, psidx, sig, paspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		lonprom = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]
		lon = lonprom+paspect
		lon = util.normalize(lon)

		raprom, declprom = 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			if self.options.morin_excentric:
				lon, latprom = self.getMorinExcentric(idprom, lonprom, pllat, paspect)
			elif self.options.bianchini:
				val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
				if math.fabs(val) > 1.0:
					return False, 0.0
				latprom = math.degrees(math.asin(val))
			else:
				latprom = pllat
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

		plsig = self.chart.planets.planets[sig]
		sigeastern = plsig.eastern
		lonsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		latsig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]
		phisig = plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.POH]
		aodosig = math.fabs(plsig.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.AODO])

		if self._force_getdata_for_sig() or (self.options.subzodiacal != primdirs.PrimDirs.SZSIGNIFICATOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH):
			if self.options.subzodiacal != primdirs.PrimDirs.SZSIGNIFICATOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
				latsig = 0.0
			ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, latsig)
			if not ok:
				return False, 0.0

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return False, 0.0
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
		
		arc = aodo-aodosig

		return True, arc


	def calcPArcWithSM(self, idprom, idsig, k, arc):#Mundane-Parallel
		pass


	def calcArcWithSMMLoF(self, idprom, sigasp, aspect, arc):
		pass


	def calcArcWithSMLoF(self, idprom, psidx, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

		lon = pllon+aspect
		lon = util.normalize(lon)
		raprom, declprom = 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			if self.options.morin_excentric:
				lon, latprom = self.getMorinExcentric(idprom, pllon, pllat, aspect)
			elif self.options.bianchini:
				val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
				if math.fabs(val) > 1.0:
					return False, 0.0
				latprom = math.degrees(math.asin(val))
			else:
				latprom = pllat

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

		lonsig = self.chart.fortune.fortune[fortune.Fortune.LON]

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, 0.0)
		if not ok:
			return False, 0.0

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return False, 0.0
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig

		return True, arc


	def calcArcWithSMCustomer2(self, mundane, idprom, psidx, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

		lon = pllon+aspect
		lon = util.normalize(lon)
		raprom, declprom = 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			if self.options.morin_excentric:
				lon, latprom = self.getMorinExcentric(idprom, pllon, pllat, aspect)
			elif self.options.bianchini:
				val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
				if math.fabs(val) > 1.0:
					return False, 0.0
				latprom = math.degrees(math.asin(val))
			else:
				latprom = pllat

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

		point = self._get_active_dynamic_sig_point()
		if point == None:
			return False, 0.0
		lonsig = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		latsig = point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LAT]

		if self.options.subzodiacal != primdirs.PrimDirs.SZSIGNIFICATOR and self.options.subzodiacal != primdirs.PrimDirs.SZBOTH:
			latsig = 0.0

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, latsig)
		if not ok:
			return False, 0.0

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return False, 0.0
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig

		return True, arc


	def calcArcWithSMSyzygy(self, idprom, psidx, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idprom, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[primdirs.PrimDirs.PLACSPECULUM][planets.Planet.LAT]

		lon = pllon+aspect
		lon = util.normalize(lon)
		raprom, declprom = 0.0, 0.0
		if self.options.subzodiacal == primdirs.PrimDirs.SZPROMISSOR or self.options.subzodiacal == primdirs.PrimDirs.SZBOTH:
			latprom = 0.0
			if self.options.morin_excentric:
				lon, latprom = self.getMorinExcentric(idprom, pllon, pllat, aspect)
			elif self.options.bianchini:
				val = self.getBianchini(pllat, chart.Chart.Aspects[psidx])
				if math.fabs(val) > 1.0:
					return False, 0.0
				latprom = math.degrees(math.asin(val))
			else:
				latprom = pllat

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
		else:
			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

		lonsig = self.chart.syzygy.speculum[syzygy.Syzygy.LON]

		ok, sigeastern, abovehorizon, phisig, aodosig = self.getData(lonsig, 0.0)
		if not ok:
			return False, 0.0

		val = math.tan(math.radians(declprom))*math.tan(math.radians(phisig))
		if math.fabs(val) > 1.0:
			return False, 0.0
		adprom = math.degrees(math.asin(val))

		aodo = 0.0
		if sigeastern:
			aodo = raprom-adprom
		else:
			aodo = raprom+adprom
			
		arc = aodo-aodosig

		return True, arc
