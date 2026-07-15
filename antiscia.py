
import astrology
import planets
import fortune
import houses
import util
import math


class Antiscion:
	'''Antiscion of a planet, LoF or AscMC'''

	ANTISCION = 0
	CONTRAANT = 1
	DODECATEMORIA = 2

	# Sinister/dexter classification (Morin antiscia, Astrologia Gallica book 16 ch. 15).
	UNDIRECTED = 0
	SINISTER = 1
	DEXTER = 2

	#Ids of planets are from module astrology

	#Ids
	LOF = astrology.SE_TRUE_NODE+1
	ASC = LOF+1
	MC = ASC+1

	def __init__(self, typ, Id, lon, lat, ra, decl, valid=True, direction=0):
		self.typ = typ
		self.Id = Id
		self.lon = lon
		self.lat = lat
		self.ra = ra
		self.decl = decl
		self.valid = valid             # False if Morin's |D| >= obl rule rejects this point.
		self.direction = direction     # SINISTER/DEXTER under Morin antiscia, else UNDIRECTED.


class Antiscia:
	'''Computes antiscia of the bodies(planets, LoF, Asc and MC).

	Two doctrines are supported:
	  - Classical (default): the antiscion of a longitude is its mirror across
	    the solstitial axis (180-lon). The planet's latitude is preserved as a
	    passenger but does not affect the antiscion's longitude.
	  - Morin (when morin_antiscia=True): the antiscion of a planet is the
	    point on the ecliptic that has the same declination as the planet's
	    true place (latitude included). Astrologia Gallica book 16 ch. 15.
	    A latitude-bearing planet has TWO such antiscia (the two ecliptic
	    points where its parallel of declination crosses), and zero antiscia
	    when |declination| >= obliquity. Sun, Asc, MC, LoF (lat=0) reduce to
	    the classical antiscion under either doctrine.
	'''

	CANCER0 = 90.0
	CAPRICORN0 = 270.0

	def __init__(self, pls, ascmc, lof, obl, ayanopt, ayan, morin_antiscia=False):
		self.obl = obl
		self.morin_antiscia = morin_antiscia
		self.plantiscia = []
		self.plcontraant = []
		# Morin's secondary antiscia (parallel to plantiscia / plcontraant).
		# When morin_antiscia is False these stay empty; consumers that want
		# the second point per planet check len(plantiscia_secondary).
		self.plantiscia_secondary = []
		self.plcontraant_secondary = []
		self.pldodecatemoria = []
		self.lofant = None
		self.lofcontraant = None
		self.lofdodec = None
		self.ascmcant = []
		self.ascmccontraant = []
		self.ascmcdodec = []

		self.ayanopt = ayanopt
		self.ayan = ayan

		plcants = []

		for i in range(planets.Planets.PLANETS_NUM):
			# Planet lons are stored in the chart's chosen zodiac.
			# Antiscia geometry is anchored to the tropical solstitial
			# axis (Cancer/Capricorn 0° tropical), so recover tropical
			# before any mirror or declination math; calc() and
			# calcDodecatemoria() then siderealize the result for
			# display via ``- self.ayan`` as today.
			lon_p_trop = self._to_tropical(pls[i].data[planets.Planet.LONG])
			lat_p = pls[i].data[planets.Planet.LAT]
			dodec = self.calcDodecatemoria(lon_p_trop)

			if morin_antiscia:
				prim, sec, prim_c, sec_c = self._morin_pair(lon_p_trop, lat_p, obl, ayanopt, ayan)
				self.plantiscia.append(self._make_morin(i, prim, Antiscion.ANTISCION, obl))
				self.plantiscia_secondary.append(self._make_morin(i, sec, Antiscion.ANTISCION, obl))
				self.plcontraant.append(self._make_morin(i, prim_c, Antiscion.CONTRAANT, obl))
				self.plcontraant_secondary.append(self._make_morin(i, sec_c, Antiscion.CONTRAANT, obl))
				# Track the contraantiscion of the primary for plcants[] used downstream;
				# kept for parity with classical path (only consumed by ra/decl recompute below).
				plcants.append((prim_c['lon'] if prim_c else 0.0, 0.0))
				raant, declant, dist = astrology.swe_cotrans(prim['lon'] if prim else 0.0, 0.0, 1.0, -obl)
				self.pldodecatemoria.append(Antiscion(Antiscion.DODECATEMORIA, i, dodec, lat_p, raant, declant))
				continue

			ant, cant = self.calc(lon_p_trop)
			plcants.append((cant, lat_p))
			raant, declant, dist = astrology.swe_cotrans(ant, lat_p, 1.0, -obl)
			self.plantiscia.append(Antiscion(Antiscion.ANTISCION, i, ant, lat_p, raant, declant))
			self.pldodecatemoria.append(Antiscion(Antiscion.DODECATEMORIA, i, dodec, lat_p, raant, declant))

		if not morin_antiscia:
			for i in range(planets.Planets.PLANETS_NUM):
				raant, declant, dist = astrology.swe_cotrans(plcants[i][0], plcants[i][1], 1.0, -obl)
				self.plcontraant.append(Antiscion(Antiscion.CONTRAANT, i, plcants[i][0], plcants[i][1], raant, declant))


		lof_lon_trop = self._to_tropical(lof[fortune.Fortune.LON])
		ant, cant = self.calc(lof_lon_trop)
		dodec = self.calcDodecatemoria(lof_lon_trop)
#		lat = lof[fortune.Fortune.LAT] #=0.0
		raant, declant, dist = astrology.swe_cotrans(ant, 0.0, 1.0, -self.obl)
		self.lofant = Antiscion(Antiscion.ANTISCION, Antiscion.LOF, ant, 0.0, raant, declant)
		raant, declant, dist = astrology.swe_cotrans(cant, 0.0, 1.0, -self.obl)
		self.lofcontraant = Antiscion(Antiscion.CONTRAANT, Antiscion.LOF, cant, 0.0, raant, declant)
		#Afegeixo LOF 
		raant, declant, dist = astrology.swe_cotrans(cant, 0.0, 1.0, -self.obl)
		self.lofdodec = Antiscion(Antiscion.DODECATEMORIA, Antiscion.LOF, dodec, 0.0, raant, declant)

		asc_lon_trop = self._to_tropical(ascmc[houses.Houses.ASC])
		mc_lon_trop = self._to_tropical(ascmc[houses.Houses.MC])

		antasc, cantasc = self.calc(asc_lon_trop)
		raantasc, declantasc, dist = astrology.swe_cotrans(antasc, 0.0, 1.0, -self.obl)
		self.ascmcant.append(Antiscion(Antiscion.ANTISCION, Antiscion.ASC, antasc, 0.0, raantasc, declantasc))

		antmc, cantmc = self.calc(mc_lon_trop)
		raantmc, declantmc, dist = astrology.swe_cotrans(antmc, 0.0, 1.0, -self.obl)
		self.ascmcant.append(Antiscion(Antiscion.ANTISCION, Antiscion.MC, antmc, 0.0, raantmc, declantmc))

		raantasc, declantasc, dist = astrology.swe_cotrans(cantasc, 0.0, 1.0, -self.obl)
		self.ascmccontraant.append(Antiscion(Antiscion.CONTRAANT, Antiscion.ASC, cantasc, 0.0, raantasc, declantasc))

		raantmc, declantmc, dist = astrology.swe_cotrans(cantmc, 0.0, 1.0, -self.obl)
		self.ascmccontraant.append(Antiscion(Antiscion.CONTRAANT, Antiscion.MC, cantmc, 0.0, raantmc, declantmc))

		dodecasc = self.calcDodecatemoria(asc_lon_trop)
		raantasc, declantasc, dist = astrology.swe_cotrans(dodecasc, 0.0, 1.0, -self.obl)
		self.ascmcdodec.append(Antiscion(Antiscion.DODECATEMORIA, Antiscion.ASC, dodecasc, 0.0, raantasc, declantasc))

		dodecmc = self.calcDodecatemoria(mc_lon_trop)
		raantmc, declantmc, dist = astrology.swe_cotrans(antmc, 0.0, 1.0, -self.obl)
		self.ascmcdodec.append(Antiscion(Antiscion.DODECATEMORIA, Antiscion.MC, dodecmc, 0.0, raantmc, declantmc))

#		self.printants()


	def _to_tropical(self, lon):
		"""Recover a tropical longitude — thin shim over
		``util.to_tropical_lon`` retained for backward compatibility
		with internal call sites. Antiscia geometry is anchored to the
		tropical solstitial axis, so every mirror or declination
		operation needs the tropical input; ``calc()`` and
		``calcDodecatemoria()`` then siderealize their result via
		``- self.ayan`` for display.
		"""
		return util.to_tropical_lon(lon, self.ayan if self.ayanopt != 0 else 0.0)

	def _morin_pair(self, lon_p, lat_p, obl, ayanopt, ayan):
		'''Morin antiscia/contraantiscia for a planet at (lon, lat).

		Returns ``(primary_ant, secondary_ant, primary_cant, secondary_cant)``
		where each item is a dict ``{'lon', 'decl', 'valid', 'direction'}`` or
		None when the planet sits outside the tropics (|D| >= obl).

		For latitude-zero bodies one of the two declination-roots equals the
		body's own longitude (the body itself); we drop that one and surface
		the remaining classical antiscion as the primary (no secondary).
		'''
		# True declination of the planet at (lon, lat).
		_ra_p, decl_p, _d = astrology.swe_cotrans(lon_p, lat_p, 1.0, -obl)
		ant_pair = self._roots_for_decl(decl_p, obl)
		cant_pair = self._roots_for_decl(-decl_p, obl)

		def _siderealize(lon_v):
			if lon_v is None:
				return None
			return util.normalize(lon_v - ayan) if ayanopt != 0 else util.normalize(lon_v)

		def _classify(lon_v):
			if lon_v is None:
				return Antiscion.UNDIRECTED
			# Modular signed offset of antiscion relative to planet, in (-180, 180].
			d = ((lon_v - lon_p + 540.0) % 360.0) - 180.0
			if d > 0.0:
				return Antiscion.SINISTER  # planet precedes the antiscion
			elif d < 0.0:
				return Antiscion.DEXTER     # planet follows the antiscion
			return Antiscion.UNDIRECTED

		def _drop_self_match(pair, decl_v, trivial_lon):
			"""Return (primary, secondary) from a (A1, A2) pair.

			``trivial_lon`` is the longitude that the body itself maps onto for
			this declination set: ``lon_p`` for antiscia (the planet's parallel
			of declination passes through the body when β=0), ``lon_p + 180``
			for contraantiscia (the parallel of −D crosses through the body's
			opposition when β=0). When |β|≈0 we drop the matching root.
			"""
			if pair is None:
				return None, None
			A1, A2 = pair
			if abs(lat_p) < 1.0e-6:
				if abs(((A1 - trivial_lon + 540.0) % 360.0) - 180.0) < 1.0e-6:
					return A2, None
				if abs(((A2 - trivial_lon + 540.0) % 360.0) - 180.0) < 1.0e-6:
					return A1, None
			# Pick primary by proximity to the body itself (Morin: closer = primary;
			# when planet is between them, the preceding one is primary).
			d1 = abs(((A1 - lon_p + 540.0) % 360.0) - 180.0)
			d2 = abs(((A2 - lon_p + 540.0) % 360.0) - 180.0)
			s1 = ((A1 - lon_p + 540.0) % 360.0) - 180.0
			s2 = ((A2 - lon_p + 540.0) % 360.0) - 180.0
			between = (s1 > 0.0 and s2 < 0.0) or (s1 < 0.0 and s2 > 0.0)
			if between:
				# Preceding = the one with negative offset (planet follows it = dexter).
				if s1 < 0.0:
					return A1, A2
				return A2, A1
			if d1 <= d2:
				return A1, A2
			return A2, A1

		prim_a, sec_a = _drop_self_match(ant_pair, decl_p, lon_p)
		prim_c, sec_c = _drop_self_match(cant_pair, -decl_p, (lon_p + 180.0) % 360.0)

		def _pack(lon_v, decl_v):
			if lon_v is None:
				return None
			return {
				'lon': _siderealize(lon_v),
				'decl': decl_v,
				'valid': True,
				'direction': _classify(lon_v),
			}

		# Use the actual declination root: primary/secondary antiscia carry the planet's decl;
		# contraantiscia carry the negated decl.
		return (
			_pack(prim_a, decl_p),
			_pack(sec_a, decl_p),
			_pack(prim_c, -decl_p),
			_pack(sec_c, -decl_p),
		)

	def _roots_for_decl(self, decl, obl):
		'''Two ecliptic longitudes (degrees, 0..360) where the ecliptic itself
		has declination ``decl``. Returns None when |decl| >= obl.
		'''
		sin_d = math.sin(math.radians(decl))
		sin_obl = math.sin(math.radians(obl))
		if abs(sin_obl) < 1.0e-12 or abs(sin_d) >= abs(sin_obl):
			return None
		s = sin_d / sin_obl
		if s > 1.0:
			s = 1.0
		elif s < -1.0:
			s = -1.0
		A = math.degrees(math.asin(s))     # in [-90, 90]
		if decl >= 0.0:
			A1, A2 = A, 180.0 - A
		else:
			A1, A2 = 180.0 - A, 360.0 + A
		return util.normalize(A1), util.normalize(A2)

	def _make_morin(self, planet_idx, packed, typ, obl):
		'''Build an Antiscion from the dict produced by _morin_pair, or a
		valid=False placeholder when no antiscion exists.
		'''
		if packed is None:
			return Antiscion(typ, planet_idx, 0.0, 0.0, 0.0, 0.0, valid=False, direction=Antiscion.UNDIRECTED)
		lon_v = packed['lon']
		ra_v, decl_v, _d = astrology.swe_cotrans(lon_v, 0.0, 1.0, -obl)
		return Antiscion(typ, planet_idx, lon_v, 0.0, ra_v, decl_v,
		                 valid=True, direction=packed.get('direction', Antiscion.UNDIRECTED))


	def calc(self, lon):
		"""
		Calculate antiscia and contra-antiscia for a given longitude.
		Input longitude must always be TROPICAL (never sidereal).
		If ayanopt != 0 (sidereal), antiscia is calculated in tropical, then converted to sidereal by subtracting ayan.
		All ayanamsha logic is centralized here. Frontend/chart code must never subtract ayanamsha before calling this.
		"""
		# Always work in tropical: mirror across solstice axis
		if lon < 180.0:
			ant_trop = 180.0 - lon
		else:
			ant_trop = 540.0 - lon
		ant_trop = util.normalize(ant_trop)
		# If sidereal, convert result back to sidereal by subtracting ayan
		if self.ayanopt != 0:
			ant = util.normalize(ant_trop - self.ayan)
		else:
			ant = ant_trop
		cant = util.normalize(ant + 180.0)
		return ant, cant


	def calcDodecatemoria(self, lon):
		"""
		Calculate dodecatemoria (12th-parts) for a given longitude.
		Input longitude must always be TROPICAL (never sidereal).
		If ayanopt != 0 (sidereal), convert result to sidereal by subtracting ayan.
		All ayanamsha logic is centralized here. Frontend/chart code must never subtract ayanamsha before calling this.
		"""
		dodec_trop = self.KeepInZodiac(30*self.getSign(lon) + 12*self.getRelativeLon(lon))
		if self.ayanopt != 0:
			dodec = util.normalize(dodec_trop - self.ayan)
		else:
			dodec = dodec_trop
		return dodec

	def KeepBetweenLimit(self, lon, lim):
		""" Keep the longitude between 0..lim """
		""" lon must be positive """
		return lon - math.floor(lon / lim) * lim
	
	def KeepInZodiac(self, lon):
		""" Keep the longitude between 0..360 """
		return self.KeepBetweenLimit(lon, 360)

	def getRelativeLon(self, lon):
		""" Returns the longitude relative to the zodiac """
		""" Ex. lon = 36 will return 6 (Taurus 6)"""
		return self.KeepBetweenLimit(lon, 30)

	def getSign(self, lon):
		""" Returns the sign: 0 - Aries, 1 - Taurus, 2 - Gemini..."""
		""" lon must be positive """
		return lon // 30

	def printants(self):
		plstxt = ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'AscNode', 'DescNode')
		anttxt = ('Antiscia', 'Contraantiscia')

		print ('')
		print ('Antiscia')
		i = 0
		for ant in self.antiscia:
			if i < planets.Planets.PLANETS_NUM*2:
				print ('%s %s %f %f %f %f' % (anttxt[ant.typ], plstxt[ant.Id], ant.lon, ant.lat, ant.ra, ant.decl))
			elif i == Antiscia.LOFANT or i == Antiscia.LOFCANT:
				print ('%s %s %f %f %f %f' % (anttxt[ant.typ], 'LoF', ant.lon, ant.lat, ant.ra, ant.decl))
			elif i == Antiscia.ASCANT or i == Antiscia.ASCCANT:
				print ('%s %s %f %f %f %f' % (anttxt[ant.typ], 'Asc', ant.lon, ant.lat, ant.ra, ant.decl))
			elif i == Antiscia.MCANT or i == Antiscia.MCCANT:
				print ('%s %s %f %f %f %f' % (anttxt[ant.typ], 'MC', ant.lon, ant.lat, ant.ra, ant.decl))

			i += 1





