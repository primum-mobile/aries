import math
import astrology
import util
from typing import TYPE_CHECKING
if TYPE_CHECKING:
	import chart  

class Houses:
	"""Calculates the cusps of the Houses.

	ascmc2[i][j] stores the j-th coordinate of the i-th angular point:
	  i = ASC/MC/ARMC/VERTEX/EQUASC/COASC/COASC2/POLARASC
	  j = LON/LAT/RA/DECL
	"""

	HOUSE_NUM = 12
	hsystems = ('P', 'K', 'R', 'C', 'E', 'W', 'X', 'Q', 'M', 'H', 'T', 'B', 'O', 'N')
	TRUE_ASCENDANT = 'Q'

	# Angular point indices into ascmc2[] (returned by swe_houses_ex)
	ASC, MC, ARMC, VERTEX, EQUASC, COASC, COASC2, POLARASC = range(0, 8)
	# ASC       = Ascendant (rising degree on eastern horizon)
	# MC        = Medium Coeli / Midheaven (culminating degree)
	# ARMC      = Right Ascension of the MC (sidereal time in degrees)
	# VERTEX    = Vertex (western intersection of prime vertical and ecliptic)
	# EQUASC    = Equatorial Ascendant
	# COASC     = Co-Ascendant (Koch)
	# COASC2    = Co-Ascendant (Munkasey)
	# POLARASC  = Polar Ascendant

	# Coordinate indices into ascmc2[i][j]
	LON = 0     # Ecliptic longitude
	LAT = 1     # Ecliptic latitude
	RA = 2      # Right Ascension
	DECL = 3    # Declination

	def __init__(self, tjd_ut, flag, geolat, geolon, hsys, obl, ayanopt, ayan):
		self.ui_hsys = hsys
		if hsys == 'N':
			self.hsys = 'W'
		elif hsys in Houses.hsystems:
			self.hsys = hsys
		else:
			self.hsys = Houses.hsystems[0]

		self.obl = obl

		# Sidereal mode is encoded by ``ayanopt`` (the user's chosen
		# ayanamsha index). Apply SEFLG_SIDEREAL at the SwissEph
		# boundary so cusps come back in the chosen zodiac, regardless
		# of whether the caller remembered to OR it into ``flag``.
		# Callers that already set the flag are unaffected — the OR is
		# idempotent.
		if ayanopt != 0:
			astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(ayanopt), 0, 0)
			flag |= astrology.SEFLG_SIDEREAL

		engine_hsys = 'X' if self.hsys == Houses.TRUE_ASCENDANT else self.hsys
		res, self.cusps, self.ascmc = astrology.swe_houses_ex(tjd_ut, flag, geolat, geolon, ord(engine_hsys))

		if self.hsys == Houses.TRUE_ASCENDANT:
			self._apply_true_ascendant_geometry(geolat)

		##################
		if ayanopt != 0 and self.hsys == 'W':
			del self.cusps
			cusps = [0.0]
			# swe_houses_ex already returned ASC in the selected sidereal
			# zodiac. Whole-sign cusps start at that chosen-frame sign.
			sign = int(util.normalize(self.ascmc[Houses.ASC])) // 30
			cusps.append(sign*30.0)
			for i in range(2, Houses.HOUSE_NUM+1):
				hc = util.normalize(cusps[i-1]+30.0)
				cusps.append(hc)

			#to tuple (which is a read-only list)
			self.cusps = tuple(cusps)
		##################

		# swe_cotrans is pure ecliptic→equatorial geometry — it treats
		# the input longitude as angular distance from the vernal
		# equinox. Our stored ASC/MC/cusps are in the chart's chosen
		# zodiac (sidereal when SEFLG_SIDEREAL is in `flag`), so add
		# the ayanamsha offset back to get a tropical lon for cotrans.
		# RA/decl are intrinsic to the point — they must match between
		# tropical and sidereal mode regardless of where 0° of the
		# zodiac is placed. ARMC (`self.ascmc[Houses.ARMC]`) is already
		# frame-independent, but ASC/MC/cusp RA/decl have to be
		# reconstructed via cotrans, and cotrans needs a tropical input.
		ayan_offset = 0.0
		if ayanopt != 0:
			ayan_offset = astrology.effective_ayanamsha_ut(tjd_ut, ayanopt)
		self.ayanamsha_offset = float(ayan_offset)

		ascra, ascdecl, dist = astrology.swe_cotrans(util.to_tropical_lon(self.ascmc[Houses.ASC], ayan_offset), 0.0, 1.0, -obl)
		mcra, mcdecl, dist = astrology.swe_cotrans(util.to_tropical_lon(self.ascmc[Houses.MC], ayan_offset), 0.0, 1.0, -obl)
		if self.hsys == Houses.TRUE_ASCENDANT:
			ascmc = list(self.ascmc)
			ascmc[Houses.ARMC] = mcra
			self.ascmc = tuple(ascmc)
		self.ascmc2 = ((self.ascmc[Houses.ASC], 0.0, ascra, ascdecl), (self.ascmc[Houses.MC], 0.0, mcra, mcdecl))

		#zdAsc=90.0, zdMC=0.0
		#poleAsc=lat, poleMC=0.0
		qasc_arg = math.tan(math.radians(ascdecl))*math.tan(math.radians(geolat))
		if self.hsys == Houses.TRUE_ASCENDANT:
			qasc_arg = max(-1.0, min(1.0, qasc_arg))
		qasc = math.degrees(math.asin(qasc_arg))
		self.regioMPAsc = ascra-qasc
		self.regioMPMC = mcra

		self.cuspstmp = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]]
		for i in range(Houses.HOUSE_NUM):
			self.cuspstmp[i][0], self.cuspstmp[i][1], dist = astrology.swe_cotrans(util.to_tropical_lon(self.cusps[i+1], ayan_offset), 0.0, dist, -obl)
			
		self.cusps2 = ((self.cuspstmp[0][0], self.cuspstmp[0][1]), (self.cuspstmp[1][0], self.cuspstmp[1][1]), (self.cuspstmp[2][0], self.cuspstmp[2][1]), (self.cuspstmp[3][0], self.cuspstmp[3][1]), (self.cuspstmp[4][0], self.cuspstmp[4][1]), (self.cuspstmp[5][0], self.cuspstmp[5][1]), (self.cuspstmp[6][0], self.cuspstmp[6][1]), (self.cuspstmp[7][0], self.cuspstmp[7][1]), (self.cuspstmp[8][0], self.cuspstmp[8][1]), (self.cuspstmp[9][0], self.cuspstmp[9][1]), (self.cuspstmp[10][0], self.cuspstmp[10][1]), (self.cuspstmp[11][0], self.cuspstmp[11][1]))

	@staticmethod
	def _signed_arc(start, end):
		return (float(end)-float(start)+540.0) % 360.0-180.0

	@staticmethod
	def _true_ascendant_vertex_weight(geolat):
		lat = max(0.0, min(90.0, abs(float(geolat))))
		if lat <= 45.0:
			return math.tan(math.radians(lat))**2/2.0
		return 1.0-(math.tan(math.radians(90.0-lat))**2/2.0)

	def _apply_true_ascendant_geometry(self, geolat):
		asc = float(self.ascmc[Houses.ASC])
		mc = float(self.ascmc[Houses.MC])
		anti_vertex = util.normalize(float(self.ascmc[Houses.VERTEX])+180.0)
		vertex_weight = Houses._true_ascendant_vertex_weight(geolat)

		corrected_asc = util.normalize(
			asc+Houses._signed_arc(asc, anti_vertex)*vertex_weight
		)
		target_square = util.normalize(mc+90.0)
		square_residual = Houses._signed_arc(target_square, corrected_asc)
		true_asc = util.normalize(corrected_asc-square_residual/2.0)
		true_mc = util.normalize(mc+square_residual/2.0)

		cusp1 = util.normalize(true_asc-15.0)
		self.cusps = tuple(
			[0.0]+[util.normalize(cusp1+(i*30.0)) for i in range(Houses.HOUSE_NUM)]
		)
		ascmc = list(self.ascmc)
		ascmc[Houses.ASC] = true_asc
		ascmc[Houses.MC] = true_mc
		self.ascmc = tuple(ascmc)


	#Zodiacal
	def getHousePos(self, lon, opts, useorbs = False):
		# lazy-import to avoid circular import at bundle-time
		from chart import Chart as _Chart
		SIGN_DEG = _Chart.SIGN_DEG
		for i in range(1, Houses.HOUSE_NUM):
			orb1 = 0.0
			orb2 = 0.0

			if useorbs:
				orb1 = opts.orbiscuspH
				orb2 = opts.orbiscuspH
				if i == 1 or i == 4 or i == 7 or i == 10:
					orb1 = opts.orbiscuspAscMC
				if i+1 == 4 or i+1 == 7 or i+1 == 10:
					orb2 = opts.orbiscuspAscMC

			cusp1 = util.normalize(self.cusps[i]-orb1)
			cusp2 = util.normalize(self.cusps[i+1]-orb2)

			pos = lon
			if cusp1 > 240.0 and cusp2 < 120.0: #Pisces-Aries check
				if pos > 240.0:#planet is in the Pisces-part
					cusp2 += 360.0
				else:
					cusp2 += 360.0
					pos += 360.0
					
			if cusp1 < pos and cusp2 > pos:
				# The traditional-aspects flag only limits cusp-orb promotion
				# across sign boundaries. Plain house lookup must stay geometric.
				if useorbs and opts.traditionalaspects:
					pos = lon
					cusp1 = self.cusps[i]
					cusp2 = self.cusps[i+1]
					if cusp1 > 240.0 and cusp2 < 120.0: #Pisces-Aries check
						if pos > 240.0:#planet is in the Pisces-part
							cusp2 += 360.0
						else:
							cusp2 += 360.0
							pos += 360.0

					if cusp1 > pos:
						sign1 = int(lon/SIGN_DEG)
						sign2 = int(self.cusps[i]/SIGN_DEG)
						if sign1 != sign2:
							if i == 1:
								return 11
							else:
								return i-2

				return i-1

		#12-I
		orb1 = 0.0
		orb2 = 0.0

		if useorbs:
			orb1 = opts.orbiscuspH
			orb2 = opts.orbiscuspAscMC		

		cusp1 = util.normalize(self.cusps[12]-orb1)
		cusp2 = util.normalize(self.cusps[1]-orb2)

		pos = lon
		if cusp1 > 240.0 and cusp2 < 120.0: #Pisces-Aries check
			if pos > 240.0:#planet is in the Pisces-part
				cusp2 += 360.0
			else:
				cusp2 += 360.0
				pos += 360.0
					
		if cusp1 < pos and cusp2 > pos:
			if useorbs and opts.traditionalaspects:
				pos = lon
				cusp1 = self.cusps[12]
				cusp2 = self.cusps[1]
				if cusp1 > 240.0 and cusp2 < 120.0: #Pisces-Aries check
					if pos > 240.0:#planet is in the Pisces-part
						cusp2 += 360.0
					else:
						cusp2 += 360.0
						pos += 360.0

				if cusp1 > pos:
					sign1 = int(lon/SIGN_DEG)
					sign2 = int(self.cusps[12]/SIGN_DEG)
						
					if sign1 != sign2:
						return 10

			return 11

		return 0


	def calcProfPos(self, prof):
		hcs = [self.cusps[0]]
		for i in range(1, Houses.HOUSE_NUM+1):
			hcs.append(util.normalize(self.cusps[i]+prof.offs))

		#to tuple (which is a read-only list)
		self.cusps = tuple(hcs)

		ascmc = list(self.ascmc)
		for idx in (
			Houses.ASC,
			Houses.MC,
			Houses.VERTEX,
			Houses.EQUASC,
			Houses.COASC,
			Houses.COASC2,
			Houses.POLARASC,
		):
			ascmc[idx] = util.normalize(ascmc[idx]+prof.offs)
		self.ascmc = tuple(ascmc)

		ayan_offset = float(getattr(self, 'ayanamsha_offset', 0.0))
		ascra, ascdecl, dist = astrology.swe_cotrans(util.to_tropical_lon(self.ascmc[Houses.ASC], ayan_offset), 0.0, 1.0, -self.obl)
		mcra, mcdecl, dist = astrology.swe_cotrans(util.to_tropical_lon(self.ascmc[Houses.MC], ayan_offset), 0.0, 1.0, -self.obl)

		self.ascmc2 = ((self.ascmc[Houses.ASC], 0.0, ascra, ascdecl), (self.ascmc[Houses.MC], 0.0, mcra, mcdecl))
