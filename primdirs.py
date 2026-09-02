# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

import copy
import math
import datetime
import astrology
import houses
import chart
import fortune
import munfortune
import syzygy
import planets
import fixstars
import transits
import secmotion
import customerpd
import mtexts
import util
from engine import morin_aspects as _morin_aspects


def placidian_sa_ecliptic_foot_arc(radix, promissor_lon, significator_lon):
	"""Return the raw signed Placidian-SA arc between two ecliptic feet.

	This is the zero-latitude equation used by ``PlacidianSAPD.toPlanet`` before
	``create`` turns its sign into the row's Direct/Converse flag.  Keeping the
	evaluator in the canonical primary-direction engine lets PD-in-chart and
	future visualizations follow the selected row without reimplementing its
	geometry in a renderer.
	"""
	r_amc = radix.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
	r_aic = util.normalize(r_amc + 180.0)
	place_tan = math.tan(math.radians(radix.place.lat))
	ayanamsha_offset = getattr(radix, 'ayanamsha_offset', 0.0)

	ra_prom, decl_prom, _dist = astrology.swe_cotrans(
		util.to_tropical_lon(util.normalize(float(promissor_lon)), ayanamsha_offset),
		0.0,
		1.0,
		-radix.obl[0],
	)
	prom_ad_value = place_tan * math.tan(math.radians(decl_prom))
	if math.fabs(prom_ad_value) > 1.0:
		return None
	prom_ad = math.degrees(math.asin(prom_ad_value))

	ra_sig, decl_sig, _dist = astrology.swe_cotrans(
		util.to_tropical_lon(util.normalize(float(significator_lon)), ayanamsha_offset),
		0.0,
		1.0,
		-radix.obl[0],
	)
	eastern = True
	if r_amc > r_aic:
		if r_aic < ra_sig < r_amc:
			eastern = False
	else:
		if (r_aic < ra_sig < 360.0) or (0.0 < ra_sig < r_amc):
			eastern = False

	meridian_distance = math.fabs(r_amc - ra_sig)
	if meridian_distance > 180.0:
		meridian_distance = 360.0 - meridian_distance
	ic_distance = math.fabs(r_aic - ra_sig)
	if ic_distance > 180.0:
		ic_distance = 360.0 - ic_distance

	sig_ad_value = place_tan * math.tan(math.radians(decl_sig))
	if math.fabs(sig_ad_value) > 1.0:
		return None
	sig_ad = math.degrees(math.asin(sig_ad_value))
	diurnal_sa = 90.0 + sig_ad
	nocturnal_sa = 90.0 - sig_ad
	above_horizon = meridian_distance <= diurnal_sa
	semiarc = diurnal_sa if above_horizon else nocturnal_sa
	if not above_horizon:
		meridian_distance = ic_distance

	t = -1.0
	if (eastern and not above_horizon) or (not eastern and above_horizon):
		t = 1.0
	v = 1.0 if above_horizon else -1.0
	reference_ra = r_amc if above_horizon else r_aic
	ra_difference = ra_prom - reference_ra
	difference_direct = True
	if ra_difference < 0.0:
		ra_difference *= -1.0
		difference_direct = False
	if ra_difference > 180.0:
		ra_difference = 360.0 - ra_difference
		difference_direct = not difference_direct
	if not difference_direct:
		ra_difference *= -1.0
	return ra_difference + t * (90.0 + v * prom_ad) * meridian_distance / semiarc


class AbortPD:
	def __init__(self):
		self.abort = False

	def aborting(self):
		self.abort = True


class PrimDir:
	'''Represents a direction'''

	NONE = -1

	from planets import Planets
	OFFSANGLES = Planets.PLANETS_NUM 

	ASC = OFFSANGLES 
	DESC = ASC+1
	MC = DESC+1
	IC = MC+1

	HC2 = IC+1
	HC3 = HC2+1
	HC5 = HC3+1
	HC6 = HC5+1
	HC8 = HC6+1
	HC9 = HC8+1
	HC11 = HC9+1
	HC12 = HC11+1

	LOF = HC12+1

	SYZ = LOF+1

	CUSTOMERPD = SYZ+1

	ANTISCION = CUSTOMERPD+1
	ANTISCIONLOF = ANTISCION+12+1
	ANTISCIONASC = ANTISCIONLOF+1
	ANTISCIONMC = ANTISCIONASC+1
	CONTRAANT = ANTISCIONMC+1
	CONTRAANTLOF = CONTRAANT+12+1
	CONTRAANTASC = CONTRAANTLOF+1
	CONTRAANTMC = CONTRAANTASC+1

	TERM = CONTRAANTMC+1

	FIXSTAR = TERM+12+1


	def __init__(self):
		self.mundane = True
		self.prom = PrimDir.NONE
		self.prom2 = PrimDir.NONE
		self.sig = PrimDir.NONE
		self.promdyn = None
		self.sigdyn = None
		self.promasp = PrimDir.NONE
		self.sigasp = PrimDir.NONE
		# The aspect id records its magnitude but not which ray was actually
		# directed.  Preserve the signed ecliptic offsets on the canonical row so
		# chart projections and other consumers never have to infer dexter/sinister
		# from the Direct/Converse flag.
		self.promasp_offset = 0.0
		self.sigasp_offset = 0.0
		# Stable row provenance for consumers which must reproduce the exact
		# calculation event without guessing from labels or the D/C flag.
		self.system = None
		self.domain = 'mundane'
		self.event_kind = 'direction'
		self.arc = 0.0
		self.direct = True
		self.parallelaxis = 0
		self.time = 0.0
		self.age = 0.0


def _pd_field(pd, name, default=None):
	if isinstance(pd, dict):
		return pd.get(name, default)
	return getattr(pd, name, default)


def _pd_int_field(pd, name, default=PrimDir.NONE):
	try:
		return int(_pd_field(pd, name, default))
	except Exception:
		return default


def _morin_antiscion_body(prom):
	if PrimDir.ANTISCION <= prom < PrimDir.ANTISCIONLOF:
		return prom - PrimDir.ANTISCION, False
	if PrimDir.CONTRAANT <= prom < PrimDir.CONTRAANTLOF:
		return prom - PrimDir.CONTRAANT, True
	if prom in (PrimDir.ANTISCIONLOF, PrimDir.ANTISCIONASC, PrimDir.ANTISCIONMC):
		return None, False
	if prom in (PrimDir.CONTRAANTLOF, PrimDir.CONTRAANTASC, PrimDir.CONTRAANTMC):
		return None, True
	return None, None


def is_morin_promittor_direction(pd):
	"""True when a PrimDir row belongs to Morin's closed AG22 promittor set."""
	prom = _pd_int_field(pd, 'prom')
	sig = _pd_int_field(pd, 'sig')
	promasp = _pd_int_field(pd, 'promasp', chart.Chart.CONJUNCTIO)
	sigasp = _pd_int_field(pd, 'sigasp', chart.Chart.CONJUNCTIO)

	if sig in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE):
		return False
	# Morin's significators are the cusps, angles, Part of Fortune, and his
	# SEVEN planets (AG23 Ch.16 book-23.txt:6633-6643; Ch.15:5862 "the cusps
	# and all of the planets") — he predates Uranus/Neptune/Pluto, so an
	# outer planet as significator is outside his set. Reject them explicitly
	# (a reject-list, NOT a SE_SUN<=sig<=SE_SATURN allowlist, which would
	# wrongly drop the angle/cusp/Pars significators that carry large sentinel
	# ids). This closes the outer-planet-significator leak on BOTH the radix
	# (compute_directions) and revolution (intra_revolution_directions) paths.
	if sig in (astrology.SE_URANUS, astrology.SE_NEPTUNE, astrology.SE_PLUTO):
		return False

	ant_body, is_contra = _morin_antiscion_body(prom)
	if is_contra is not None:
		if is_contra or ant_body is None or not (astrology.SE_SUN <= ant_body <= astrology.SE_SATURN):
			return False
		return promasp == chart.Chart.CONJUNCTIO and sigasp == chart.Chart.CONJUNCTIO

	if astrology.SE_SUN <= prom <= astrology.SE_SATURN:
		# Morin's promittor aspects are the longitudinal rays (AG22:718) plus
		# the antiscion-as-point; the declination PARALLEL / CONTRAPARALLEL are
		# NOT Morin aspects — he expresses the parallel of declination via the
		# antiscion point (AG16 ch.15), already emitted as an antiscion
		# conjunction. The parallel encoding duplicates that same contact at the
		# same arc (and is mislabeled 'conjunction' downstream), so drop it.
		if promasp in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL) or \
		   sigasp in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL):
			return False
		return True

	if prom == PrimDir.LOF:
		return promasp == chart.Chart.CONJUNCTIO and sigasp == chart.Chart.CONJUNCTIO

	if prom >= PrimDir.FIXSTAR:
		return promasp == chart.Chart.CONJUNCTIO and sigasp == chart.Chart.CONJUNCTIO

	return False


def _morin_direction_key(pd):
	return (
		_pd_int_field(pd, 'prom'),
		_pd_int_field(pd, 'prom2'),
		_pd_int_field(pd, 'promasp'),
		_pd_int_field(pd, 'sig'),
		_pd_int_field(pd, 'sigasp'),
		bool(_pd_field(pd, 'direct', False)),
		bool(_pd_field(pd, 'mundane', False)),
		_pd_int_field(pd, 'parallelaxis', 0),
		round(float(_pd_field(pd, 'arc', 0.0) or 0.0), 8),
		round(float(_pd_field(pd, 'time', 0.0) or 0.0), 8),
	)


def filter_morin_promittor_set(pds):
	"""Filter rows to Morin's body + 11 aspects + antiscion (+ LoF) set.

	AG22 Sect.I Ch.4 fixes seven planetary promittors as the body, the eleven
	aspect rays, and one antiscion. AG22 Ch.5 treats the antiscion like an
	aspect-ray promittor, not as a point that casts its own aspects; therefore
	antiscion rows survive only by conjunction. Fixed stars are a separate Morin
	promittor class and survive by conjunction. Contra-antiscia, nodes, terms,
	angle/cusp promissors, and other dynamic points are outside this closed Morin
	set.
	"""
	out = []
	seen = set()
	for pd in pds or []:
		if not is_morin_promittor_direction(pd):
			continue
		key = _morin_direction_key(pd)
		if key in seen:
			continue
		seen.add(key)
		out.append(pd)
	return out


class PrimDirs:
	'''Implements the PDs that are common in all systems (directions to Asc-MC) and also implements the MidPoints and Rapt Parallels'''

	#Primary Directions
	PLACIDIANSEMIARC = 0
	PLACIDIANUNDERTHEPOLE = 1
	REGIOMONTAN = 2
	CAMPANIAN = 3
	TOPOCENTRIC = 4

	#Speculums
	PLACSPECULUM = 0
	REGIOSPECULUM = 1

	MUNDANE = 0
	ZODIACAL = 1
	BOTH = 2

	#subzodiacals
	SZNEITHER = 0
	SZPROMISSOR = 1
	SZSIGNIFICATOR = 2
	SZBOTH = 3

	#circumambulation OA method
	CIRCUM_OA_ASCENSIONAL_TIMES = 0
	CIRCUM_OA_USE_PD = 1
	CIRCUM_PROMISSORS_FOLLOW_PD = 0
	CIRCUM_PROMISSORS_TRADITIONAL = 1

	#zodical options
	ASPSPROMSTOSIGS = 0
	PROMSTOSIGASPS = 1

	#Dynamic Keys
	TRUESOLAREQUATORIALARC = 0
	BIRTHDAYSOLAREQUATORIALARC = 1
	TRUESOLARECLIPTICALARC = 2
	BIRTHDAYSOLARECLIPTICALARC = 3

	#Static Keys
	NAIBOD = 0
	CARDAN = 1
	PTOLEMY = 2
	CUSTOMER = 3


	DEG = 0
	MIN = 1
	SEC = 2
	COEFF = 3
	staticData = ((0, 59, 8, 1.01456164), (0, 59, 12, 1.0135135), (1, 0, 0, 1.0))

	#Directions
	DIRECT = 0
	CONVERSE = 1
	BOTHDC = 2

	@staticmethod
	def is_angle_antiscion_promissor(prom):
		return prom in (
			PrimDir.ANTISCIONASC,
			PrimDir.ANTISCIONMC,
			PrimDir.CONTRAANTASC,
			PrimDir.CONTRAANTMC,
		)

	@staticmethod
	def house_system_for_primarydir(primarydir):
		if primarydir in (PrimDirs.PLACIDIANSEMIARC, PrimDirs.PLACIDIANUNDERTHEPOLE):
			return 'P'
		if primarydir == PrimDirs.REGIOMONTAN:
			return 'R'
		if primarydir == PrimDirs.CAMPANIAN:
			return 'C'
		if primarydir == PrimDirs.TOPOCENTRIC:
			return 'T'
		return None

	#Range
	RANGE25 = 0
	RANGE50 = 1
	RANGE75 = 2
	RANGE100 = 3
	RANGEALL = 4
	RANGEREV = 5

	# Solar revolution timing in revolution directions
	REVSOLAR_TROPICAL = 0
	REVSOLAR_360 = 1

	# Solar revolution annual directions mode
	REVANNUAL_USE_PRIMARY = 0
	REVANNUAL_TRADITIONAL = 1

	LIMIT = 150.0
	REVOLUTIO = 360.0

	Ranges = ((0.0, 25.0), (25.0, 50.0), (50.0, 75.0), (75.0, 100.0), (0.0, LIMIT), (0.0, REVOLUTIO))
	LOW = 0
	HIGH = 1

	@staticmethod
	def get_effective_revolution_options(chrt, options):
		# Annual directions use the ordinary Primary Directions configuration.
		# The former annual-only profile silently replaced the user's selected
		# significators and is retained only as a legacy persistence field.
		return options


	def _refresh_chart_pd_dependencies(self):
		"""Refresh chart caches that primary directions read directly.

		ChartSession can legitimately hold a fast-stepped ``full=False`` chart.
		PD calculation still needs the same derived structures a full radix has,
		and they must be rebuilt after the PD-local planet/option refresh below.
		"""
		opts = self.options
		chrt = self.chart
		original_options = getattr(chrt, 'options', None)
		if opts is not None and opts is not original_options:
			chrt.options = opts
		try:
			# Same convention as chart.create() / chart._zodiac_flags():
			# raw planet longitudes come back in the chart's chosen
			# zodiac via SEFLG_SIDEREAL; ``ayanamsha`` is the residual
			# (= 0) and ``ayanamsha_offset`` carries the actual value
			# for the few consumers that genuinely need it (e.g.
			# placidiansapd tropical-recovery for term arcs).
			pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
			chrt.ayanamsha = 0.0
			chrt.ayanamsha_offset = 0.0
			if opts.ayanamsha != 0:
				astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(opts.ayanamsha), 0, 0)
				chrt.ayanamsha_offset = astrology.effective_ayanamsha_ut(chrt.time.jd, opts.ayanamsha)
				pflag |= astrology.SEFLG_SIDEREAL
			# Do NOT add SEFLG_TOPOCTR here. Per Polich/Page, topocentric
			# primary directions use the cone/pole house formula, not
			# topocentric planet positions.

			chrt.planets = planets.Planets(
				chrt.time.jd,
				opts.meannode,
				pflag,
				chrt.place.lat,
				chrt.houses.ascmc2,
				chrt.raequasc,
				getattr(chrt, 'nolat', False),
				chrt.obl[0],
			)
			if hasattr(chrt, '_rebuild_dynamic_chart_bodies'):
				chrt._rebuild_dynamic_chart_bodies(pflag)

			chrt.abovehorizonwithorb = chrt.isAboveHorizonWithOrb()
			abovehor = chrt.planets.planets[astrology.SE_SUN].abovehorizon
			if getattr(opts, 'usedaynightorb', False):
				abovehor = chrt.abovehorizonwithorb
			chrt.fortune = fortune.Fortune(
				opts.lotoffortune,
				chrt.houses.ascmc2,
				chrt.raequasc,
				chrt.planets,
				chrt.obl[0],
				chrt.place.lat,
				abovehor,
				getattr(chrt, 'ayanamsha_offset', 0.0),
			)
			if getattr(chrt, 'munfortune', None) is not None:
				chrt.munfortune = munfortune.MundaneFortune(
					opts.lotoffortune,
					chrt.houses.ascmc2,
					chrt.planets,
					chrt.obl[0],
					chrt.place.lat,
					abovehor,
				)

			if hasattr(chrt, 'calcMidPoints'):
				chrt.calcMidPoints()
			else:
				import midpoints
				chrt.midpoints = midpoints.MidPoints(chrt.planets, chiron=getattr(chrt, 'chiron', None))

			import zodpars
			chrt.zodpars = zodpars.ZodPars(chrt.planets, chrt.obl[0])

			if hasattr(chrt, 'calcAntiscia'):
				chrt.calcAntiscia()
			else:
				import antiscia
				chrt.antiscia = antiscia.Antiscia(
					chrt.planets.planets,
					chrt.houses.ascmc,
					chrt.fortune.fortune,
					chrt.obl[0],
					opts.ayanamsha,
					getattr(chrt, 'ayanamsha_offset', 0.0),
					morin_antiscia=getattr(opts, 'morin_antiscia', False),
				)
			import antzodpars
			chrt.antzodpars = antzodpars.AntZodPars(
				chrt.antiscia.plantiscia,
				chrt.antiscia.plcontraant,
				chrt.obl[0],
			)

			needs_syzygy = (
				getattr(chrt, 'syzygy', None) is not None
				or bool(getattr(opts, 'pdsyzygy', False))
				or bool(getattr(opts, 'pdpromarabicparts', False))
				or bool(getattr(opts, 'pdsigarabicparts', False))
			)
			if needs_syzygy and hasattr(chrt, 'calcSyzygy'):
				chrt.calcSyzygy()

			needs_parts = (
				getattr(chrt, 'parts', None) is not None
				or bool(getattr(opts, 'pdpromarabicparts', False))
				or bool(getattr(opts, 'pdsigarabicparts', False))
			)
			if needs_parts and hasattr(chrt, 'calcArabicParts'):
				chrt.calcArabicParts()

			if getattr(chrt, 'fixstars', None) is not None or bool(getattr(opts, 'pdfixstars', False)):
				if hasattr(chrt, 'rebuildFixStars'):
					chrt.rebuildFixStars()
				else:
					fsflag = 0
					if opts.ayanamsha != 0:
						fsflag |= astrology.SEFLG_SIDEREAL
					chrt.fixstars = fixstars.FixStars(
						chrt.time.jd,
						fsflag,
						opts.fixstars,
						chrt.obl[0],
						getattr(chrt, 'ayanamsha_offset', 0.0),
					)

			if getattr(opts, 'pdcustomer', False) and hasattr(chrt, '_ensure_pd_customer_point'):
				chrt._ensure_pd_customer_point(False)
			if getattr(opts, 'pdcustomer2', False) and hasattr(chrt, '_ensure_pd_customer_point'):
				chrt._ensure_pd_customer_point(True)
			if hasattr(chrt, '_get_pd_arabic_part_promissor_point'):
				chrt.pd_arabic_part_prom = chrt._get_pd_arabic_part_promissor_point()
			if hasattr(chrt, '_get_pd_arabic_part_significator_point'):
				chrt.pd_arabic_part_sig = chrt._get_pd_arabic_part_significator_point()
		finally:
			if opts is not None and opts is not original_options:
				chrt.options = original_options

	def __init__(self, chrt, options, pdrange, direction, abort):
		self.chart = chrt

		self.options = options if options is not None else getattr(self.chart, 'options', None)
		self.pdrange = pdrange
		self.direction = direction
		self.abort = abort
		self.pds = []
		self._range_bounds_override = getattr(self.options, '_pd_range_bounds_override', None)
		self._max_age_limit_override = getattr(self.options, '_pd_max_age_limit_override', None)
		self._pd_cycle_age_cache = {}

		self.ramc = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
		self.raic = self.ramc+180.0
		if self.raic >= 360.0:
			self.raic -= 360.0

		self.aoasc = self.ramc+90.0
		if self.aoasc >= 360.0:
			self.aoasc -= 360.0

		self.dodesc = self.raic+90.0
		if self.dodesc >= 360.0:
			self.dodesc -= 360.0

		# Pre-compute constant trig values for geographic latitude
		self.radlat = math.radians(self.chart.place.lat)
		self.tanlat = math.tan(self.radlat)
		self.sinlat = math.sin(self.radlat)
		self.coslat = math.cos(self.radlat)

		self._refresh_chart_pd_dependencies()

		self.calc()

		self.pds.sort(key=lambda pd: pd.time)

	def _range_bounds(self):
		if self._range_bounds_override is not None:
			try:
				lo, hi = self._range_bounds_override
				return float(lo), float(hi)
			except Exception:
				pass
		return PrimDirs.Ranges[self.pdrange]

	def _uses_revolution_time(self):
		'''True only for return charts, whose directions are timed by the
		return period (calcTimeRev). Every other chart type — radix, horary,
		event, election — must be timed by the natal arc->time key (calcTime).
		Testing "!= RADIX" here silently gave horary/event charts the lunar
		return key, running 360 deg of direction in 27.7 days.'''
		return self.chart.htype in (
			chart.Chart.SOLAR, chart.Chart.LUNAR, chart.Chart.REVOLUTION)

	def _max_age_limit(self):
		if self._max_age_limit_override is not None:
			try:
				return max(float(self._max_age_limit_override), PrimDirs.LIMIT)
			except Exception:
				pass
		if self._range_bounds_override is not None:
			try:
				return max(float(self._range_bounds()[PrimDirs.HIGH]), PrimDirs.LIMIT)
			except Exception:
				pass
		return PrimDirs.LIMIT

	def _cycle_age(self, direct):
		"""Return the age span of one full primary-direction equator cycle."""
		key = bool(direct)
		if key in self._pd_cycle_age_cache:
			return self._pd_cycle_age_cache[key]
		cycle = 0.0
		try:
			_time, cycle = self.calcTime(360.0, direct)
		except Exception:
			cycle = 0.0
		if cycle <= 0.0 and not self.options.pdkeydyn:
			if self.options.pdkeys == PrimDirs.CUSTOMER:
				val = (
					self.options.pdkeydeg
					+ self.options.pdkeymin / 60.0
					+ self.options.pdkeysec / 3600.0
				)
				if val:
					cycle = 360.0 / val
			else:
				cycle = 360.0 * PrimDirs.staticData[self.options.pdkeys][PrimDirs.COEFF]
		if cycle <= 0.0:
			cycle = 365.2421904
		self._pd_cycle_age_cache[key] = cycle
		return cycle

	def _append_pd(
		self,
		mundane,
		prom,
		prom2,
		sig,
		promasp,
		sigasp,
		arc,
		direct,
		parallelaxis,
		time,
		age,
		promasp_offset=0.0,
		sigasp_offset=0.0,
	):
		if PrimDirs.is_angle_antiscion_promissor(prom):
			return
		pd = PrimDir()
		pd.mundane = mundane
		pd.prom = prom
		pd.prom2 = prom2
		pd.sig = sig
		if prom == PrimDir.CUSTOMERPD:
			pd.promdyn = self._get_active_dynamic_prom_key()
		if sig == PrimDir.CUSTOMERPD:
			sig_body_id = self._get_active_dynamic_sig_primdir()
			if sig_body_id is not None:
				pd.sig = sig_body_id
			else:
				pd.sigdyn = self._get_active_dynamic_sig_key()
		pd.promasp = promasp
		pd.sigasp = sigasp
		pd.promasp_offset = float(promasp_offset)
		pd.sigasp_offset = float(sigasp_offset)
		self._set_pd_provenance(pd)
		pd.arc = arc
		pd.direct = direct
		pd.parallelaxis = parallelaxis
		pd.time = time
		pd.age = age

		self.pds.append(pd)

	def _set_pd_provenance(self, pd):
		"""Stamp conservative engine/domain/event identity on a PD row."""
		try:
			pd.system = int(getattr(self.options, 'primarydir'))
		except (AttributeError, TypeError, ValueError):
			pd.system = None
		pd.domain = 'mundane' if bool(pd.mundane) else 'zodiacal'
		aspects = (int(pd.promasp), int(pd.sigasp))
		if chart.Chart.MIDPOINT in aspects:
			pd.event_kind = 'midpoint'
		elif any(
			aspect in (chart.Chart.RAPTPAR, chart.Chart.RAPTCONTRAPAR)
			for aspect in aspects
		):
			pd.event_kind = 'rapt-parallel'
		elif any(
			aspect in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL)
			for aspect in aspects
		):
			pd.event_kind = 'parallel'
		elif aspects == (chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO):
			pd.event_kind = 'conjunction'
		elif any(
			chart.Chart.CONJUNCTIO < aspect <= chart.Chart.SEPTILE
			for aspect in aspects
		):
			pd.event_kind = 'aspect'
		else:
			pd.event_kind = 'direction'

	def _direction_allowed(self, direct):
		return (
			self.direction == PrimDirs.BOTHDC
			or (self.direction == PrimDirs.DIRECT and direct)
			or (self.direction == PrimDirs.CONVERSE and not direct)
		)

	def _append_windowed_radix_pd(
		self,
		mundane,
		prom,
		prom2,
		sig,
		promasp,
		sigasp,
		arc,
		direct,
		parallelaxis,
		promasp_offset=0.0,
		sigasp_offset=0.0,
	):
		if not self._direction_allowed(direct):
			return
		time, age = self.calcTime(arc, direct)
		lo, hi = self._range_bounds()
		cycle_age = self._cycle_age(direct)
		cycle_time = cycle_age * 365.2421904
		cycle = 0
		if cycle_age > 0.0 and age < lo:
			cycle = max(0, int(math.floor((lo - age) / cycle_age)))
		while True:
			projected_age = age + cycle * cycle_age
			if projected_age >= hi:
				return
			if projected_age >= lo:
				self._append_pd(
					mundane,
					prom,
					prom2,
					sig,
					promasp,
					sigasp,
					arc + cycle * 360.0,
					direct,
					parallelaxis,
					time + cycle * cycle_time,
					projected_age,
					promasp_offset,
					sigasp_offset,
				)
			cycle += 1

	def _lon_for_cotrans(self, lon):
		"""Recover the tropical longitude for ``swe_cotrans``. Thin
		shim over ``util.to_tropical_lon`` — kept as an instance method
		so the existing ~17 cotrans call sites in this file stay terse.
		"""
		return util.to_tropical_lon(lon, getattr(self.chart, 'ayanamsha_offset', 0.0))

	def _get_active_dynamic_prom_point(self):
		point = getattr(self, '_active_dynamic_prom_point', None)
		if point != None:
			return point
		return getattr(self.chart, 'cpd', None)

	def _get_active_dynamic_sig_point(self):
		point = getattr(self, '_active_dynamic_sig_point', None)
		if point != None:
			return point
		return getattr(self.chart, 'cpd2', None)

	def _get_active_dynamic_prom_key(self):
		key = getattr(self, '_active_dynamic_prom_key', None)
		if key != None:
			return key
		return 'user_prom'

	def _get_active_dynamic_sig_key(self):
		key = getattr(self, '_active_dynamic_sig_key', None)
		if key != None:
			return key
		return 'user_sig'

	def _pd_fixstar_selected(self, sorted_index):
		"""Return whether the fixed star at the sorted chart index is enabled for PD."""
		selections = getattr(self.options, 'pdfixstarssel', None)
		if not selections:
			return False
		ordinal = sorted_index
		try:
			mixed = getattr(getattr(self.chart, 'fixstars', None), 'mixed', None)
			if mixed is not None and 0 <= sorted_index < len(mixed):
				ordinal = int(mixed[sorted_index])
		except (TypeError, ValueError):
			ordinal = sorted_index
		if ordinal < 0 or ordinal >= len(selections):
			return False
		return bool(selections[ordinal])

	def _get_active_dynamic_sig_primdir(self):
		return getattr(self, '_active_dynamic_sig_primdir', None)

	def _house_cusp_significators_available(self):
		if not bool(getattr(self.options, '_pd_use_display_house_cusp_significators', False)):
			return True
		# The private displayed-ring path follows the chart display. "Angles
		# only" has no visible intermediate cusps, but normal PD calculations
		# still use the selected engine's own P/R/C/T house geometry.
		if getattr(self.options, 'hsys', None) == 'N' and not bool(getattr(self.options, 'housesystem', False)):
			return False
		return True

	def _use_native_house_cusp_significators(self):
		hsys = getattr(self.options, 'hsys', None)
		return hsys == PrimDirs.house_system_for_primarydir(getattr(self.options, 'primarydir', None))

	def _use_global_house_cusp_significators(self):
		# Normal PD menus/lists must use the house geometry owned by the selected
		# PD engine (P/R/C/T), not the house system currently drawn on the chart.
		# The old displayed-cusp path is intentionally left behind this private
		# flag for possible future primary-chart drawing/overlay work where the
		# visible house ring itself is the object being directed.
		return (
			bool(getattr(self.options, '_pd_use_display_house_cusp_significators', False))
			and self._house_cusp_significators_available()
			and not self._use_native_house_cusp_significators()
		)

	def _iter_global_house_cusp_significator_points(self):
		if not self._house_cusp_significators_available():
			return
		cusp_specs = (
			(PrimDir.HC2, 2),
			(PrimDir.HC3, 3),
			(PrimDir.HC5, 5),
			(PrimDir.HC6, 6),
			(PrimDir.HC8, 8),
			(PrimDir.HC9, 9),
			(PrimDir.HC11, 11),
			(PrimDir.HC12, 12),
		)
		for body_id, cusp_idx in cusp_specs:
			try:
				lon = self.chart.houses.cusps[cusp_idx]
			except Exception:
				continue
			point = customerpd.CustomerPD.from_ecliptic_longitude(
				lon,
				self.chart.place.lat,
				self.chart.houses.ascmc2,
				self.chart.obl[0],
				self.chart.raequasc,
				0.0,
			)
			yield 'global_hc%d' % cusp_idx, body_id, point

	def _for_each_global_house_cusp_significator(self, methods):
		original_options = getattr(self.chart, 'options', None)
		using_override = self.options is not None and self.options is not original_options
		if using_override:
			self.chart.options = self.options
		try:
			for key, body_id, point in self._iter_global_house_cusp_significator_points():
				self._active_dynamic_sig_key = key
				self._active_dynamic_sig_point = point
				self._active_dynamic_sig_primdir = body_id
				try:
					for method in methods:
						method()
				finally:
					self._active_dynamic_sig_key = None
					self._active_dynamic_sig_point = None
					self._active_dynamic_sig_primdir = None
		finally:
			if using_override:
				self.chart.options = original_options

	def _for_each_dynamic_promissor(self, methods):
		original_options = getattr(self.chart, 'options', None)
		original_arabic_part_prom = getattr(self.chart, 'pd_arabic_part_prom', None)
		using_override = self.options is not None and self.options is not original_options
		if using_override:
			self.chart.options = self.options
			if hasattr(self.chart, '_get_pd_arabic_part_promissor_point'):
				self.chart.pd_arabic_part_prom = self.chart._get_pd_arabic_part_promissor_point()
		try:
			for key, point in self.chart.iter_pd_promissor_points():
				self._active_dynamic_prom_key = key
				self._active_dynamic_prom_point = point
				try:
					for method in methods:
						method()
				finally:
					self._active_dynamic_prom_key = None
					self._active_dynamic_prom_point = None
		finally:
			if using_override:
				self.chart.options = original_options
				self.chart.pd_arabic_part_prom = original_arabic_part_prom

	def _for_each_dynamic_significator(self, methods):
		original_options = getattr(self.chart, 'options', None)
		original_arabic_part_sig = getattr(self.chart, 'pd_arabic_part_sig', None)
		using_override = self.options is not None and self.options is not original_options
		if using_override:
			self.chart.options = self.options
			if hasattr(self.chart, '_get_pd_arabic_part_significator_point'):
				self.chart.pd_arabic_part_sig = self.chart._get_pd_arabic_part_significator_point()
		try:
			for key, point in self.chart.iter_pd_significator_points():
				self._active_dynamic_sig_key = key
				self._active_dynamic_sig_point = point
				try:
					for method in methods:
						method()
				finally:
					self._active_dynamic_sig_key = None
					self._active_dynamic_sig_point = None
					self._active_dynamic_sig_primdir = None
		finally:
			if using_override:
				self.chart.options = original_options
				self.chart.pd_arabic_part_sig = original_arabic_part_sig

	def _get_dynamic_point_label(self, key, promissor):
		return self.chart.get_pd_dynamic_point_label(key, promissor)

	def _promissor_body_enabled(self, body_id):
		try:
			idx = int(body_id)
		except Exception:
			return False
		if idx == astrology.SE_CHIRON:
			return bool(getattr(self.options, 'pdpromchiron', False)) and getattr(self.chart, 'chiron', None) is not None
		try:
			return 0 <= idx < len(self.options.promplanets) and bool(self.options.promplanets[idx])
		except Exception:
			return False

	def _midpoint_promissors_enabled(self, mid):
		return self._promissor_body_enabled(mid.p1) and self._promissor_body_enabled(mid.p2)

	def _format_pd_body_label(self, body_id, promissor, dyn_key=None, body_context=False):
		if body_id == PrimDir.CUSTOMERPD:
			return self._get_dynamic_point_label(dyn_key, promissor)
		if body_context:
			try:
				if int(body_id) == astrology.SE_CHIRON:
					return mtexts.txts.get('Chiron', 'Chiron')
			except Exception:
				pass
		return None

	def calcMunPromAspsInterPlanetary2Customer2(self):
		# Mundane aspects (square/trine/...) of planet promissors to a customer
		# significator. No-op base so calcMunPDs can call it uniformly; the PD
		# systems that support it override this (PlacidianUTPPD for the topocentric
		# rectification path). Regiomontan/Campanian fall through to this no-op.
		pass

	def calcCustomer2Customer2Asps(self):
		# Mundane aspects of a customer promissor to a customer significator (the
		# E-E crossing in Marr's Dual Test). No-op base; PlacidianUTPPD overrides.
		pass

	def calcZodRingProms2Planets(self):
		# Zodiacal directions with a house-cusp or angle as the PROMISSOR (its own
		# aspect points) and a planet as the SIGNIFICATOR (which supplies the pole).
		# Marr/Polich-Page name the pole-bearing factor first; e.g. "Uranus <- trine
		# of Asc" or "Saturn <- sextile of cusp XII" need the PLANET's pole, which
		# the planet->cusp/angle paths cannot express (cusps/angles are significators
		# there). No-op base so calcZodPDs can call it uniformly; PlacidianUTPPD
		# (topocentric rectification path) overrides. Gated by pdcusppromissors.
		pass

	def calcZodCustomerPromAsps2Planets(self):
		# Cross-class analog of calcZodRingProms2Planets: aspects of a Customer
		# (cross-chart) promissor to planet significators. No-op base; PlacidianUTPPD
		# overrides. Gated by pdcusppromissors, driven per dynamic promissor.
		pass

	def calcZodPlanetPromAsps2CuspSigs(self):
		# Aspects of planet promissors to intermediate-cusp significators treated as
		# pole-bearers (Marr's convention; the shipped toHCs path treats them as mundane
		# house circles). No-op base; PlacidianUTPPD overrides. Gated by pdcusppromissors.
		pass


	def calc(self):
		if self.options.subprimarydir == PrimDirs.MUNDANE:
			self.calcMunPDs()
		if self.options.subprimarydir == PrimDirs.ZODIACAL:
			self.calcZodPDs()
		if self.options.subprimarydir == PrimDirs.BOTH:
			self.calcMunPDs()
			self.calcZodPDs()


	def calcMunPDs(self):
		self.calcAscMC()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
			self.calcAntiscia2AscMC()
			self.calcAntiscia2Planets(True)
		self.calcInterPlanetary(True)
		if self.chart.htype == chart.Chart.RADIX and self.options.pdparallels[0]:
			self.calcParallels()
			if self.options.pdantiscia:
				self.calcAntiscia2Parallels()
			self._for_each_dynamic_promissor([self.calcCustomer2Parallels])
		if self.options.primarydir == PrimDirs.PLACIDIANSEMIARC and self.options.pdparallels[1]:
			self.calcRaptParallels()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdmidpoints:
			self.calcMidPoints()
		if self.options.sighouses and self._house_cusp_significators_available():
			if self._use_global_house_cusp_significators():
				self._for_each_global_house_cusp_significator([lambda: self.calcPlanetary2Customer2(True)])
				if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
					self._for_each_global_house_cusp_significator([lambda: self.calcAntiscia2Customer2(True)])
			else:
				self.calc2HouseCusps(True)
				if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
					self.calcAntiscia2HouseCusps(True)
		if self.options.primarydir == PrimDirs.PLACIDIANSEMIARC and self.options.pdlof[1]:
			# LoF 공식 변경을 문데인 루틴에 '반드시' 반영: Fortune/Antiscia 최신화
			try:
				opts = self.options
				# Sun이 지평선 위인지(주/야) – 차트에서 쓰는 단순 판정과 동일하게 씁니다.
				abovehor = self.chart.planets.planets[astrology.SE_SUN].abovehorizon

				self.chart.fortune = fortune.Fortune(
					opts.lotoffortune,
					self.chart.houses.ascmc2,
					self.chart.raequasc,
					self.chart.planets,
					self.chart.obl[0],
					self.chart.place.lat,
					abovehor,
					getattr(self.chart, 'ayanamsha_offset', 0.0),
				)

				# Fortune(LoF)을 전역 옵션으로 갱신한 '바로 다음'에 munfortune도 갱신
				try:
					self.chart.munfortune = munfortune.MundaneFortune(
						opts.lotoffortune,
						self.chart.houses.ascmc2,
						self.chart.planets,
						self.chart.obl[0],
						self.chart.place.lat,
						abovehor
					)
				except Exception:
					pass

				# 2) 안티샤/컨트라안티샤도 LoF에 종속되므로 함께 재계산
				if hasattr(self.chart, 'antiscia'):
					if hasattr(self.chart.antiscia, 'recalc'):
						self.chart.antiscia.recalc(self.chart, opts)
					else:
						import antiscia
						self.chart.antiscia = antiscia.Antiscia(self.chart, opts)
			except Exception:
				# 실패하더라도 PD 자체는 진행
				pass

			self.calcPlanets2MLoF()
			if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
				self.calcAntiscia2MLoF()
		if self.chart.htype == chart.Chart.RADIX:
			prom_methods = [lambda: self.calcCustomer2AscMC(True), lambda: self.calcCustomerPlanetary(True)]
			if self.options.primarydir == PrimDirs.PLACIDIANSEMIARC and self.options.pdlof[1]:
				prom_methods.append(self.calcCustomer2MLoF)
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					prom_methods.append(lambda: self.calcCustomer2GlobalHouseCusps(True))
				else:
					prom_methods.append(lambda: self.calcCustomer2HouseCusps(True))
			self._for_each_dynamic_promissor(prom_methods)
		# Mundane aspects to/from customer points (Marr Dual Test R-E/E-E) are
		# opt-in via pd_mundane_customer_aspects so the shipped customer-point PD
		# feature is byte-identical unless a caller (rectification) asks for them.
		mun_cust_asps = getattr(self.options, 'pd_mundane_customer_aspects', False)
		ee_sig_methods = [lambda: self.calcCustomer2Customer2(True)]
		if mun_cust_asps:
			ee_sig_methods.append(lambda: self.calcCustomer2Customer2Asps())
		self._for_each_dynamic_promissor([
			lambda: self._for_each_dynamic_significator(ee_sig_methods)
		])

		sig_methods = [lambda: self.calcPlanetary2Customer2(True)]
		if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
			sig_methods.append(lambda: self.calcAntiscia2Customer2(True))
		if self.chart.htype == chart.Chart.RADIX and self.options.pdmidpoints:
			sig_methods.append(self.calcMidPoints2Customer2)
		self._for_each_dynamic_significator(sig_methods)
		# Mundane ASPECTS (square/trine/...) of planet promissors to a customer
		# significator. calcPlanetary2Customer2 only does the conjunction; this is
		# the in-mundo aspect counterpart, mirroring toPlanets for planet sigs.
		# Opt-in (see pd_mundane_customer_aspects above) so the shipped feature is unchanged.
		if mun_cust_asps:
			self._for_each_dynamic_significator([self.calcMunPromAspsInterPlanetary2Customer2])


	def calcZodPDs(self):
		self.calcZodAscMC()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
			self.calcZodAntiscia2AscMC()
			self.calcAntiscia2Planets(False)
			self._for_each_dynamic_significator([lambda: self.calcAntiscia2Customer2(False)])
		self.calcInterPlanetary(False)
		self._for_each_dynamic_significator([lambda: self.calcPlanetary2Customer2(False)])
		if self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS]:
			self.calcZodPromAspsInterPlanetary()
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					self._for_each_global_house_cusp_significator([self.calcZodPromAspsInterPlanetary2Customer2])
				else:
					self.calcZodPromAsps2HCs()#
			self._for_each_dynamic_significator([self.calcZodPromAspsInterPlanetary2Customer2])
			if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
				self.calcZodPromAntisciaAspsInterPlanetary()
				self._for_each_dynamic_significator([self.calcZodPromAntisciaAspsInterPlanetary2Customer2])
		if getattr(self.options, 'pdcusppromissors', False):
			self.calcZodRingProms2Planets()
			self.calcZodPlanetPromAsps2CuspSigs()
		if self.options.pdlof[0]:
			self.calcZodLoF2Planets()
			if self.chart.htype == chart.Chart.RADIX and self.options.pdsyzygy:
				self.calcZodLoF2Syzygy()
			self._for_each_dynamic_significator([self.calcZodLoF2Customer2])
		if self.options.pdlof[1]:
			self.calcZodPlanets2LoF()
			if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
				self.calcZodAntiscia2LoF()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdsyzygy:
			self.calcZodPlanets2Syzygy()
			if self.options.pdantiscia:
				self.calcZodAntiscia2Syzygy()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdparallels[0]:
			self.calcZodParallels()
			if self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS]:
				self.calcZodParallelsAscMC()
				if self.options.pdlof[1]:
					self.calcZodParallels2LoF()
				if self.options.pdsyzygy:
					self.calcZodParallels2Syzygy()
			if self.options.zodpromsigasps[PrimDirs.PROMSTOSIGASPS]:
				if self.options.pdlof[0]:
					self.calcZodLoF2ZodParallels()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdmidpoints:
			self.calcZodMidPoints()
			self.calcZodMidPointsAscMC()
			if self.options.pdlof[1]:
				self.calcZodMidPoints2LoF()
			if self.options.pdsyzygy:
				self.calcZodMidPoints2Syzygy()
			self._for_each_dynamic_significator([self.calcZodMidPoints2Customer2])
		if self.options.sighouses and self._house_cusp_significators_available():
			if self._use_global_house_cusp_significators():
				self._for_each_global_house_cusp_significator([lambda: self.calcPlanetary2Customer2(False)])
				if self.options.pdlof[0]:
					self._for_each_global_house_cusp_significator([self.calcZodLoF2Customer2])
				if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
					self._for_each_global_house_cusp_significator([lambda: self.calcAntiscia2Customer2(False)])
			else:
				self.calc2HouseCusps(False)
				if self.options.pdlof[0]:
					self.calcZodLoF2HouseCusps()
				if self.chart.htype == chart.Chart.RADIX and self.options.pdantiscia:
					self.calcAntiscia2HouseCusps(False)
		if self.options.pdterms:
			self.calcZodTerms()
		if self.chart.htype == chart.Chart.RADIX and self.options.pdfixstars:
			self.calcZodFixStars2AscMC()
			self.calcZodFixStars2Planets()
			if self.options.pdlof[1]:
				self.calcZodFixStars2LoF()
			if self.options.pdsyzygy:
				self.calcZodFixStars2Syzygy()
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					self._for_each_global_house_cusp_significator([self.calcZodFixStars2Customer2])
				else:
					self.calcZodFixStars2HouseCusps()
			self._for_each_dynamic_significator([self.calcZodFixStars2Customer2])
		if self.chart.htype == chart.Chart.RADIX:
			prom_methods = [lambda: self.calcCustomer2AscMC(False), lambda: self.calcCustomerPlanetary(False)]
			if getattr(self.options, 'pdcusppromissors', False):
				prom_methods.append(self.calcZodCustomerPromAsps2Planets)
			if self.options.pdlof[1]:
				prom_methods.append(self.calcZodCustomer2LoF)
			if self.options.pdsyzygy:
				prom_methods.append(self.calcZodCustomer2Syzygy)
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					prom_methods.append(lambda: self.calcCustomer2GlobalHouseCusps(False))
				else:
					prom_methods.append(lambda: self.calcCustomer2HouseCusps(False))
			self._for_each_dynamic_promissor(prom_methods)
		self._for_each_dynamic_promissor([
			lambda: self._for_each_dynamic_significator([lambda: self.calcCustomer2Customer2(False)])
		])
		if self.options.ascmchcsasproms:
#			if self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and self.options.sigascmc[0]:
#				self.calcZodAspAsc2Asc()
			if self.options.zodpromsigasps[PrimDirs.PROMSTOSIGASPS]:
				self.calcZodAsc2AspPlanets()
				if self.chart.htype == chart.Chart.RADIX and self.options.pdparallels[0]:
					self.calcZodAsc2ParallelPlanets()
			self.calcZodAsc2Planets()
			if self.options.pdlof[1]:
				self.calcZodAsc2LoF()
			if self.chart.htype == chart.Chart.RADIX and self.options.pdsyzygy:
				self.calcZodAsc2Syzygy()
			self._for_each_dynamic_significator([self.calcZodAsc2Customer2])
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					self._for_each_global_house_cusp_significator([self.calcZodAsc2Customer2])
				else:
					self.calcZodAsc2HCs()
			if self.options.sigascmc[1]:
				self.calcZodAsc2MC()
#				if self.chart.htype == chart.Chart.RADIX and self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and self.options.pdparallels[0]:
#					self.calcZodParallelAsc2MCAsc()
#			if self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and self.options.sigascmc[1]:
#				self.calcZodAspMC2MC()
			if self.options.zodpromsigasps[PrimDirs.PROMSTOSIGASPS]:
				self.calcZodMC2AspPlanets()
				if self.chart.htype == chart.Chart.RADIX and self.options.pdparallels[0]:
					self.calcZodMC2ParallelPlanets()
			self.calcZodMC2Planets()
			if self.options.pdlof[1]:
				self.calcZodMC2LoF()
			if self.chart.htype == chart.Chart.RADIX and self.options.pdsyzygy:
				self.calcZodMC2Syzygy()
			self._for_each_dynamic_significator([self.calcZodMC2Customer2])
			if self.options.sighouses and self._house_cusp_significators_available():
				if self._use_global_house_cusp_significators():
					self._for_each_global_house_cusp_significator([self.calcZodMC2Customer2])
				else:
					self.calcZodMC2HCs()
			if self.options.sigascmc[0]:
				self.calcZodMC2Asc()
#				if self.chart.htype == chart.Chart.RADIX and self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and self.options.pdparallels[0]:
#					self.calcZodParallelMC2AscMC()


	def calcAscMC(self):
		'''Calculates mundane directions to Asc-MC (mundane planets to Asc-MC)'''

		for i in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[i]:
				continue

			if self.abort.abort:
				return

			pl = self.chart.planets.planets[i]
			rapl = pl.speculums[PrimDirs.PLACSPECULUM][planets.Planet.RA]
			adlat = pl.speculums[PrimDirs.PLACSPECULUM][planets.Planet.ADLAT]

			self.toAscMC(i, rapl, adlat)


	def calcAntiscia2AscMC(self):
		'''Calculates mundane directions to Asc-MC (mundane antiscia to Asc-MC)'''

		#Antiscia(Planets)
		for i in range(len(self.chart.antiscia.plantiscia)):
			if not self.options.promplanets[i]:
				continue

			if self.abort.abort:
				return

			ant = self.chart.antiscia.plantiscia[i]
			raant = ant.ra

			val = self.tanlat*math.tan(math.radians(ant.decl))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

			self.toAscMC(PrimDir.ANTISCION+i, raant, adlat)

		#ContraAntiscia(Planets)
		for i in range(len(self.chart.antiscia.plcontraant)):
			if not self.options.promplanets[i]:
				continue

			if self.abort.abort:
				return

			ant = self.chart.antiscia.plcontraant[i]
			raant = ant.ra

			val = self.tanlat*math.tan(math.radians(ant.decl))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

			self.toAscMC(PrimDir.CONTRAANT+i, raant, adlat)


	def toAscMC(self, idp, ra, adlat):
		if not self.options.pdaspects[chart.Chart.CONJUNCTIO]:
			return

		#MC
		if self.options.sigangles[2]:
			if idp == astrology.SE_MOON and self.options.pdsecmotion:
				for itera in range(self.options.pdsecmotioniter+1):
					ra, adlat = self.calcSM(idp, ra-self.ramc)

			self.create(True, idp, PrimDir.NONE, PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ra-self.ramc)

		# IC
		if self.options.sigangles[3]:
			if idp == astrology.SE_MOON and self.options.pdsecmotion:
				for itera in range(self.options.pdsecmotioniter+1):
					ra, adlat = self.calcSM(idp, ra-self.raic)

			self.create(True, idp, PrimDir.NONE, PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ra-self.raic)

		# Asc
		if self.options.sigangles[0]:
			ao = ra-adlat
			if idp == astrology.SE_MOON and self.options.pdsecmotion:
				for itera in range(self.options.pdsecmotioniter+1):
					ra, adlat = self.calcSM(idp, ao-self.aoasc)
					ao = ra-adlat
			self.create(True, idp, PrimDir.NONE, PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ao-self.aoasc)

		# Dsc
		if self.options.sigangles[1]:
			do = ra+adlat
			if idp == astrology.SE_MOON and self.options.pdsecmotion:
				for itera in range(self.options.pdsecmotioniter+1):
					ra, adlat = self.calcSM(idp, do-self.dodesc)
					do = ra+adlat
			self.create(True, idp, PrimDir.NONE, PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, do-self.dodesc)


	def calcCustomer2AscMC(self, mundane):
		point = self._get_active_dynamic_prom_point()
		if point == None:
			return

		lonpl = point.speculums[PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
		rapl = point.speculums[PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA]
		adlat = point.speculums[PrimDirs.PLACSPECULUM][customerpd.CustomerPD.ADLAT]
		advalid = True

		if not mundane and self.options.subzodiacal != PrimDirs.SZPROMISSOR and self.options.subzodiacal != PrimDirs.SZBOTH:
			rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonpl), 0.0, 1.0, -self.chart.obl[0])
			val = self.tanlat*math.tan(math.radians(declpl))
			if math.fabs(val) <= 1.0:
				adlat = math.degrees(math.asin(val))
			else:
				advalid = False

		# MC
		if self.options.sigangles[2]:
			self.create(mundane, PrimDir.CUSTOMERPD, PrimDir.NONE, PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, rapl-self.ramc)
		# IC
		if self.options.sigangles[3]:
			self.create(mundane, PrimDir.CUSTOMERPD, PrimDir.NONE, PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, rapl-self.raic)

		# Asc
		if self.options.sigangles[0] and advalid:
			ao = rapl-adlat
			self.create(mundane, PrimDir.CUSTOMERPD, PrimDir.NONE, PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ao-self.aoasc)
		# Dsc
		if self.options.sigangles[1] and advalid:
			do = rapl+adlat
			self.create(mundane, PrimDir.CUSTOMERPD, PrimDir.NONE, PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, do-self.dodesc)

	def calcCustomer2GlobalHouseCusps(self, mundane):
		pass


	def calcSM(self, idp, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idp, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		ra = sm.planet.speculums[PrimDirs.PLACSPECULUM][planets.Planet.RA]
		adlat = sm.planet.speculums[PrimDirs.PLACSPECULUM][planets.Planet.ADLAT]

		return ra, adlat


	def calcZodAscMC(self):
		'''Calculates zodiacal directions to Asc-MC (zodiacal planets and their aspects to Asc-MC)'''

		SINISTER = 0
		DEXTER = 1

		for i in range(len(self.chart.planets.planets)):
			if not self.options.promplanets[i]:
				continue

			pl = self.chart.planets.planets[i]
			self.toZodAscMC(pl.data[planets.Planet.LONG], pl.data[planets.Planet.LAT], i, 0)

		#LoF
		if self.options.pdlof[0]:
			ralof = self.chart.fortune.fortune[fortune.Fortune.RA]
			decllof = self.chart.fortune.fortune[fortune.Fortune.DECL]
			val = self.tanlat*math.tan(math.radians(decllof))

			# MC
			if self.options.sigangles[2]:
				self.create(False, PrimDir.LOF, PrimDir.NONE, PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ralof-self.ramc)
			# IC
			if self.options.sigangles[3]:
				self.create(False, PrimDir.LOF, PrimDir.NONE, PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ralof-self.raic)


			if math.fabs(val) <= 1.0:
				adlat = math.degrees(math.asin(val))

				# Asc
				if self.options.sigangles[0]:
					aolof = ralof-adlat
					self.create(False, PrimDir.LOF, PrimDir.NONE, PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, aolof-self.aoasc)
				# Dsc
				if self.options.sigangles[1]:
					dolof = ralof+adlat
					self.create(False, PrimDir.LOF, PrimDir.NONE, PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, dolof-self.dodesc)

		#Terms
		if self.options.pdterms:
			if any(self.options.sigangles):
				num = len(self.options.terms[0])
				subnum = len(self.options.terms[0][0])
				for i in range(num):
					summa = 0
					for j in range(subnum):
						self.options.terms[self.options.selterm][i][j][0]
						lonterm = i*chart.Chart.SIGN_DEG+summa
						if self.options.ayanamsha != 0:
							lonterm = util.to_tropical_lon(lonterm, getattr(self.chart, 'ayanamsha_offset', 0.0))
						raterm, declterm, dist = astrology.swe_cotrans(lonterm, 0.0, 1.0, -self.chart.obl[0])

						val = self.tanlat*math.tan(math.radians(declterm))
						if math.fabs(val) > 1.0:
							continue
						adlat = math.degrees(math.asin(val))
						# MC
						if self.options.sigangles[2]:
							self.create(False, PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, raterm-self.ramc)
						# IC
						if self.options.sigangles[3]:
							self.create(False, PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, raterm-self.raic)

						# Asc
						if self.options.sigangles[0]:
							aoterm = raterm-adlat
							self.create(False, PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, aoterm-self.aoasc)
						# Dsc
						if self.options.sigangles[1]:
							doterm = raterm+adlat
							self.create(False, PrimDir.TERM+i, self.options.terms[self.options.selterm][i][j][0], PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, doterm-self.dodesc)

						summa += self.options.terms[self.options.selterm][i][j][1]


	def calcZodAntiscia2AscMC(self):
		'''Calculates zodiacal directions to Asc-MC (zodiacal antiscia/contra and their aspects to Asc-MC)'''

		#Antiscia of the planets
		for i in range(len(self.chart.antiscia.plantiscia)):
			if not self.options.promplanets[i]:
				continue

			ant = self.chart.antiscia.plantiscia[i]
			lonant = ant.lon
			latant = ant.lat
			self.toZodAscMC(lonant, latant, i, PrimDir.ANTISCION)

		#Contraantiscia of the planets
		for i in range(len(self.chart.antiscia.plcontraant)):
			if not self.options.promplanets[i]:
				continue

			cant = self.chart.antiscia.plcontraant[i]
			loncant = cant.lon
			latcant = cant.lat
			self.toZodAscMC(loncant, latcant, i, PrimDir.CONTRAANT)

		#Antiscia/Contraant of LoF
		if self.options.pdlof[0]:
			ant = self.chart.antiscia.lofant
			ralofant = ant.ra
			decllofant = ant.decl

			val = self.tanlat*math.tan(math.radians(decllofant))
			if math.fabs(val) <= 1.0:
				adlat = math.degrees(math.asin(val))
				self.toZodAscMCSub(PrimDir.ANTISCIONLOF, ralofant, adlat)

			#Contra
			cant = self.chart.antiscia.lofcontraant
			ralofcant = cant.ra
			decllofcant = cant.decl
			val = self.tanlat*math.tan(math.radians(decllofcant))
			if math.fabs(val) <= 1.0:
				adlat = math.degrees(math.asin(val))
				self.toZodAscMCSub(PrimDir.CONTRAANTLOF, ralofcant, adlat)

		#Antiscia of AscMC
		for i in range(2):
			ant = self.chart.antiscia.ascmcant[i]
			raant = ant.ra
			declant = ant.decl

			val = self.tanlat*math.tan(math.radians(declant))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

			typ = PrimDir.ANTISCIONASC
			if i > 0:
				typ = PrimDir.ANTISCIONMC

			self.toZodAscMCSub(typ, raant, adlat)

		#Contraantiscia of AscMC
		for i in range(2):
			cant = self.chart.antiscia.ascmccontraant[i]
			racant = cant.ra
			declcant = cant.decl

			val = self.tanlat*math.tan(math.radians(declcant))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

			typ = PrimDir.CONTRAANTASC
			if i > 0:
				typ = PrimDir.CONTRAANTMC

			self.toZodAscMCSub(typ, racant, adlat)


	def toZodAscMCSub(self, i, ra, adlat):
		# MC
		if self.options.sigangles[2]:
			self.create(False, i, PrimDir.NONE, PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ra-self.ramc)
		# IC
		if self.options.sigangles[3]:
			self.create(False, i, PrimDir.NONE, PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ra-self.raic)

		# Asc
		if self.options.sigangles[0]:
			ao = ra-adlat
			self.create(False, i, PrimDir.NONE, PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, ao-self.aoasc)
		# Dsc
		if self.options.sigangles[1]:
			do = ra+adlat
			self.create(False, i, PrimDir.NONE, PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, do-self.dodesc)


	def toZodAscMC(self, pllon, pllat, i, ioffs):
		SINISTER = 0
		DEXTER = 1

		for j in range(chart.Chart.SEPTILE+1):
			if not self.options.pdaspects[j]:
				continue

			if not self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and j > chart.Chart.CONJUNCTIO:
				continue

			# Preserve the ordinary PD restriction for nodes and point-like
			# promissors. Circumambulation explicitly opts its normalized dynamic
			# entries into the selected aspect vector.
			allow_circum_dynamic_aspects = (
				i == PrimDir.CUSTOMERPD
				and getattr(self, 'circumDynamicPromissorAspects', False)
			)
			if i > astrology.SE_PLUTO and j > chart.Chart.CONJUNCTIO and not allow_circum_dynamic_aspects:
				break

			if self.abort.abort:
				return

			aspectus = chart.Chart.Aspects[j]
			for k in range(DEXTER+1):
				lon = 0.0
				if k == SINISTER:
					lon = pllon+chart.Chart.Aspects[j]
					if lon >= 360.0:
						lon -= 360.0

					aspectus = chart.Chart.Aspects[j]
				else:
					if j == chart.Chart.CONJUNCTIO or j == chart.Chart.OPPOSITIO:
						continue

					lon = pllon-chart.Chart.Aspects[j]
					if lon < 0.0:
						lon += 360.0

					aspectus = -chart.Chart.Aspects[j]

				rapl = 0.0
				adlat = 0.0
				if self.options.subzodiacal == PrimDirs.SZPROMISSOR or self.options.subzodiacal == PrimDirs.SZBOTH:
					latprom = 0.0
					if self.options.bianchini:
						val = self.getBianchini(pllat, chart.Chart.Aspects[j])
						if math.fabs(val) > 1.0:
							continue
						latprom = math.degrees(math.asin(val))
					else:
						latprom = pllat

					#calc real(wahre)ra and adlat
#					rapl, declpl = util.getRaDecl(lon, latprom, self.chart.obl[0])
					rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
					val = self.tanlat*math.tan(math.radians(declpl))
					if math.fabs(val) > 1.0:
						continue
					adlat = math.degrees(math.asin(val))
				else:
					rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
					val = self.tanlat*math.tan(math.radians(declpl))
					if math.fabs(val) > 1.0:
						continue
					adlat = math.degrees(math.asin(val))

				# MC / IC
				rapl2=rapl
				adlat2=adlat

				# MC
				if self.options.sigangles[2]:
					ok = True
					if i == astrology.SE_MOON and ioffs == 0 and self.options.pdsecmotion:
						for itera in range(self.options.pdsecmotioniter+1):
							ok, rapl, adlat = self.calcZodSM(i, j, aspectus, rapl-self.ramc)
					if ok:
						self.create(False, i+ioffs, PrimDir.NONE, PrimDir.MC, j, chart.Chart.CONJUNCTIO, rapl-self.ramc, promasp_offset=aspectus)

				# IC
				rapl=rapl2; adlat=adlat2
				if self.options.sigangles[3]:
					ok = True
					if i == astrology.SE_MOON and ioffs == 0 and self.options.pdsecmotion:
						for itera in range(self.options.pdsecmotioniter+1):
							ok, rapl, adlat = self.calcZodSM(i, j, aspectus, rapl-self.raic)
					if ok:
						self.create(False, i+ioffs, PrimDir.NONE, PrimDir.IC, j, chart.Chart.CONJUNCTIO, rapl-self.raic, promasp_offset=aspectus)

				# Asc
				rapl=rapl2; adlat=adlat2
				if self.options.sigangles[0]:
					aopl = rapl-adlat
					ok = True
					if i == astrology.SE_MOON and ioffs == 0 and self.options.pdsecmotion:
						for itera in range(self.options.pdsecmotioniter+1):
							ok, rapl, adlat = self.calcZodSM(i, j, aspectus, aopl-self.aoasc)
							aopl = rapl-adlat
					if ok:
						self.create(False, i+ioffs, PrimDir.NONE, PrimDir.ASC, j, chart.Chart.CONJUNCTIO, aopl-self.aoasc, promasp_offset=aspectus)

				# Dsc
				rapl=rapl2; adlat=adlat2
				if self.options.sigangles[1]:
					dopl = rapl+adlat
					ok = True
					if i == astrology.SE_MOON and ioffs == 0 and self.options.pdsecmotion:
						for itera in range(self.options.pdsecmotioniter+1):
							ok, rapl, adlat = self.calcZodSM(i, j, aspectus, dopl-self.dodesc)
							dopl = rapl+adlat
					if ok:
						self.create(False, i+ioffs, PrimDir.NONE, PrimDir.DESC, j, chart.Chart.CONJUNCTIO, dopl-self.dodesc, promasp_offset=aspectus)


	def calcZodSM(self, idp, j, aspect, arc):
		sm = secmotion.SecMotion(self.chart.time, self.chart.place, idp, arc, self.chart.place.lat, self.chart.houses.ascmc2, self.options.topocentric, getattr(self.options, 'ayanamsha', 0), getattr(self.chart, 'ayanamsha_offset', 0.0))
		pllon = sm.planet.speculums[PrimDirs.PLACSPECULUM][planets.Planet.LONG]
		pllat = sm.planet.speculums[PrimDirs.PLACSPECULUM][planets.Planet.LAT]

		lon = pllon+aspect
		lon = util.normalize(lon)

		rapl = 0.0
		adlat = 0.0
		if self.options.subzodiacal == PrimDirs.SZPROMISSOR or self.options.subzodiacal == PrimDirs.SZBOTH:
			latprom = 0.0
			if self.options.bianchini:
				val = self.getBianchini(pllat, chart.Chart.Aspects[j])
				if math.fabs(val) > 1.0:
					return False, 0.0, 0.0
				latprom = math.degrees(math.asin(val))
			else:
				latprom = pllat

			#calc real(wahre)ra and adlat
#			rapl, declpl = util.getRaDecl(lon, latprom, self.chart.obl[0])
			rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), latprom, 1.0, -self.chart.obl[0])
			val = self.tanlat*math.tan(math.radians(declpl))
			if math.fabs(val) > 1.0:
				return False, 0.0, 0.0
			adlat = math.degrees(math.asin(val))
		else:
			rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
			val = self.tanlat*math.tan(math.radians(declpl))
			if math.fabs(val) > 1.0:
				return False, 0.0, 0.0
			adlat = math.degrees(math.asin(val))

		return True, rapl, adlat


	def calcZodParallelsAscMC(self):
		NODES = 2

		for i in range(len(self.chart.planets.planets)-NODES):
			if not self.options.promplanets[i]:
				continue

			ok = self.chart.zodpars.pars[i].valid
			points = self.chart.zodpars.pars[i].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				if self.abort.abort:
					return

				rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])
				val = self.tanlat*math.tan(math.radians(declpl))
				if math.fabs(val) > 1.0:
					continue
				adlat = math.degrees(math.asin(val))

				# MC
				if self.options.sigangles[2]:
					self.create(False, i, PrimDir.NONE, PrimDir.MC, points[k][1], chart.Chart.CONJUNCTIO, rapl-self.ramc)
					#to IC would be a duplicate: par Mars->MC is contrapar Mars->IC

				#Asc
				if self.options.sigangles[0]:
					aopl = rapl-adlat
					self.create(False, i, PrimDir.NONE, PrimDir.ASC, points[k][1], chart.Chart.CONJUNCTIO, aopl-self.aoasc)
					#to Desc would be a duplicate


	def calcZodAntisciaParallels2AscMC(self): #not used
		self.calcZodAntisciaParallels2AscMCSub(self.chart.antzodpars.apars, PrimDir.ANTISCION)
		self.calcZodAntisciaParallels2AscMCSub(self.chart.antzodpars.cpars, PrimDir.CONTRAANT)


	def calcZodAntisciaParallels2AscMCSub(self, pars, ioffs):
		NODES = 2

		for i in range(len(pls)-NODES):
			if not self.options.promplanets[i]:
				continue

			ok = pars[i].valid
			points = pars[i].pts

			if not ok:
				continue

			for k in range(len(points)):
				if points[k][0] == -1.0:
					continue

				if self.abort.abort:
					return

				rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

				val = self.tanlat*math.tan(math.radians(declpl))
				if math.fabs(val) > 1.0:
					continue
				adlat = math.degrees(math.asin(val))

				#MC
				if self.options.sigangles[2]:
					self.create(False, i+ioffs, PrimDir.NONE, PrimDir.MC, points[k][1], chart.Chart.CONJUNCTIO, rapl-self.ramc)
					#to IC would be a duplicate: par Mars->MC is contrapar Mars->IC

				#Asc
				if self.options.sigangles[0]:
					aopl = rapl-adlat
					self.create(False, i+ioffs, PrimDir.NONE, PrimDir.ASC, points[k][1], chart.Chart.CONJUNCTIO, aopl-self.aoasc)
					#to Desc would be a duplicate


	def calcZodMidPointsAscMC(self):
		'''Calclucates zodiacal midpoint directions to Asc-MC'''

		mids = self.chart.midpoints.mids
		if self.options.subzodiacal == PrimDirs.SZPROMISSOR or self.options.subzodiacal == PrimDirs.SZBOTH:
			mids = self.chart.midpoints.midslat

		#promissors
		for mid in mids:
			if not self._midpoint_promissors_enabled(mid):
				continue		

			if self.abort.abort:
				return

			raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(mid.m), mid.lat, 1.0, -self.chart.obl[0])
			val = self.tanlat*math.tan(math.radians(declprom))
			if math.fabs(val) > 1.0:
				continue
			adprom = math.degrees(math.asin(val))

			# MC
			if self.options.sigangles[2]:
				self.create(False, mid.p1, mid.p2, PrimDir.MC, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, raprom-self.ramc)
			# IC
			if self.options.sigangles[3]:
				self.create(False, mid.p1, mid.p2, PrimDir.IC, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, raprom-self.raic)

			# Asc
			if self.options.sigangles[0]:
				aoprom = raprom-adprom
				self.create(False, mid.p1, mid.p2, PrimDir.ASC, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, aoprom-self.aoasc)
			# Dsc
			if self.options.sigangles[1]:
				doprom = raprom+adprom
				self.create(False, mid.p1, mid.p2, PrimDir.DESC, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, doprom-self.dodesc)


	def calcZodAsc2MC(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]

		SINISTER = 0
		DEXTER = 1
		for i in range(chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO+1):#, chart.Chart.OPPOSITIO+1):
			if not self.options.pdaspects[i]:
				continue

			if not self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and i > chart.Chart.CONJUNCTIO:
				break

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				lon = 0.0
				if k == SINISTER:
					lon = util.normalize(lonprom+chart.Chart.Aspects[i])
				else:
					if i == chart.Chart.CONJUNCTIO or i == chart.Chart.OPPOSITIO:
						continue

					lon = util.normalize(lonprom-chart.Chart.Aspects[i])

				ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				if self.options.sigangles[2]:
					self.create(False, PrimDir.ASC, PrimDir.NONE, PrimDir.MC, i, chart.Chart.CONJUNCTIO, ra-self.ramc)

				if self.options.sigangles[3]:
					self.create(False, PrimDir.ASC, PrimDir.NONE, PrimDir.IC, i, chart.Chart.CONJUNCTIO, ra-self.raic)


	def calcZodParallelAsc2MCAsc(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])
		ok, points = self.getEclPoints(lonprom, declprom, True)

		if not ok:
			return

		for k in range(len(points)):
			if points[k][0] == -1.0:
				continue

			if self.abort.abort:
				return

			rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])

			val = self.tanlat*math.tan(math.radians(declpl))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

			# MC
			if self.options.sigangles[2]:
				self.create(False, PrimDir.ASC, PrimDir.NONE, PrimDir.MC, points[k][1], chart.Chart.CONJUNCTIO, rapl-self.ramc)
				#to IC would be a duplicate: par Mars->MC is contrapar Mars->IC

			# Asc
			if self.options.sigangles[0]:
				aopl = rapl-adlat
				self.create(False, PrimDir.ASC, PrimDir.NONE, PrimDir.ASC, points[k][1], chart.Chart.CONJUNCTIO, aopl-self.aoasc)
				#to Desc would be a duplicate


	def calcZodAspAsc2Asc(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]

		SINISTER = 0
		DEXTER = 1
		for i in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
			if i == chart.Chart.OPPOSITIO:
				continue  # Asc->Asc opposition arc = 180°, exceeds 100 yrs
			if not self.options.pdaspects[i]:
				continue

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				lon = 0.0
				if k == SINISTER:
					lon = util.normalize(lonprom+chart.Chart.Aspects[i])
				else:
					if i == chart.Chart.OPPOSITIO:
						continue

					lon = util.normalize(lonprom-chart.Chart.Aspects[i])

				ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
				val = self.tanlat*math.tan(math.radians(decl))
				if math.fabs(val) > 1.0:
					continue
				adlat = math.degrees(math.asin(val))
				ao = ra-adlat

				self.create(False, PrimDir.ASC, PrimDir.NONE, PrimDir.ASC, i, chart.Chart.CONJUNCTIO, ao-self.aoasc)
				#Asc->Desc would be over 100


	def calcZodMC2Asc(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]

		SINISTER = 0
		DEXTER = 1
		for i in range(chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO+1):#, chart.Chart.OPPOSITIO+1):
			if not self.options.pdaspects[i]:
				continue

			if not self.options.zodpromsigasps[PrimDirs.ASPSPROMSTOSIGS] and i > chart.Chart.CONJUNCTIO:
				continue

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				lon = 0.0
				if k == SINISTER:
					lon = util.normalize(lonprom+chart.Chart.Aspects[i])
				else:
					if i == chart.Chart.CONJUNCTIO or i == chart.Chart.OPPOSITIO:
						continue

					lon = util.normalize(lonprom-chart.Chart.Aspects[i])

				ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])
				val = self.tanlat*math.tan(math.radians(decl))
				if math.fabs(val) > 1.0:
					continue
				adlat = math.degrees(math.asin(val))

				aoprom = ra-adlat
				if self.options.sigangles[0]:
					self.create(False, PrimDir.MC, PrimDir.NONE, PrimDir.ASC, i, chart.Chart.CONJUNCTIO, aoprom-self.aoasc)

				if self.options.sigangles[1]:
					doprom = ra+adlat
					self.create(False, PrimDir.MC, PrimDir.NONE, PrimDir.DESC, i, chart.Chart.CONJUNCTIO, doprom-self.dodesc)


	def calcZodParallelMC2AscMC(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]
		raprom, declprom, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonprom), 0.0, 1.0, -self.chart.obl[0])
		ok, points = self.getEclPoints(lonprom, declprom, True)

		if not ok:
			return

		for k in range(len(points)):
			if points[k][0] == -1.0:
				continue

			if self.abort.abort:
				return

			rapl, declpl, dist = astrology.swe_cotrans(self._lon_for_cotrans(points[k][0]), 0.0, 1.0, -self.chart.obl[0])
			val = self.tanlat*math.tan(math.radians(declpl))
			if math.fabs(val) > 1.0:
				continue
			adlat = math.degrees(math.asin(val))

				# MC
			if self.options.sigangles[2]:
				self.create(False, PrimDir.MC, PrimDir.NONE, PrimDir.MC, points[k][1], chart.Chart.CONJUNCTIO, rapl-self.ramc)
				#to IC would be a duplicate: par Mars->MC is contrapar Mars->IC

			# Asc
			if self.options.sigangles[0]:
				aopl = rapl-adlat
				self.create(False, PrimDir.MC, PrimDir.NONE, PrimDir.ASC, points[k][1], chart.Chart.CONJUNCTIO, aopl-self.aoasc)
				#to Desc would be a duplicate


	def calcZodAspMC2MC(self):
		lonprom = self.chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]

		SINISTER = 0
		DEXTER = 1
		for i in range(chart.Chart.CONJUNCTIO+1, chart.Chart.SEPTILE+1):
			if i == chart.Chart.OPPOSITIO:
				continue  # MC->MC opposition arc = 180°, exceeds 100 yrs
			if not self.options.pdaspects[i]:
				continue

			if self.abort.abort:
				return

			for k in range(DEXTER+1):
				lon = 0.0
				if k == SINISTER:
					lon = util.normalize(lonprom+chart.Chart.Aspects[i])
				else:
					if i == chart.Chart.OPPOSITIO:
						continue

					lon = util.normalize(lonprom-chart.Chart.Aspects[i])

				ra, decl, dist = astrology.swe_cotrans(self._lon_for_cotrans(lon), 0.0, 1.0, -self.chart.obl[0])

				self.create(False, PrimDir.MC, PrimDir.NONE, PrimDir.MC, i, chart.Chart.CONJUNCTIO, ra-self.ramc)
				#MC->IC would be over 100


	def calcZodFixStars2AscMC(self):
		'''Calculates zodiacal directions of fixstars to Asc-MC'''

		OFFS = PrimDir.FIXSTAR

		for i in range(len(self.chart.fixstars.data)):
			if not self._pd_fixstar_selected(i):
				continue

			if self.abort.abort:
				return

			star = self.chart.fixstars.data[i]
			lonstar = star[fixstars.FixStars.LON]
			rastar = star[fixstars.FixStars.RA]
			declstar = star[fixstars.FixStars.DECL]

			if self.options.subzodiacal != PrimDirs.SZPROMISSOR and self.options.subzodiacal != PrimDirs.SZBOTH:
				rastar, declstar, dist = astrology.swe_cotrans(self._lon_for_cotrans(lonstar), 0.0, 1.0, -self.chart.obl[0])

			val = self.tanlat*math.tan(math.radians(declstar))
			advalid = True
			adlat = 0.0
			if math.fabs(val) > 1.0:
				advalid = False
			else:
				adlat = math.degrees(math.asin(val))

			# MC
			if self.options.sigangles[2]:
				self.create(False, i+OFFS, PrimDir.NONE, PrimDir.MC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, rastar-self.ramc)
			# IC
			if self.options.sigangles[3]:
				self.create(False, i+OFFS, PrimDir.NONE, PrimDir.IC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, rastar-self.raic)

			# Asc
			if self.options.sigangles[0] and advalid:
				aostar = rastar-adlat
				self.create(False, i+OFFS, PrimDir.NONE, PrimDir.ASC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, aostar-self.aoasc)

			# Dsc
			if self.options.sigangles[1] and advalid:
				dostar = rastar+adlat
				self.create(False, i+OFFS, PrimDir.NONE, PrimDir.DESC, chart.Chart.CONJUNCTIO, chart.Chart.CONJUNCTIO, dostar-self.dodesc)


	def calcMidPoints(self):
		'''Computes mundane midpoints to significators'''

		NODES = 2

		MP = planets.Planet.PMP
		SPECULUM = PrimDirs.PLACSPECULUM
#		if self.options.primarydir == PrimDirs.PLACIDIANUNDERTHEPOLE:
#			MP = planets.Planet.PMP
#			SPECULUM = PrimDirs.PLACSPECULUM
		if self.options.primarydir == PrimDirs.REGIOMONTAN:
			MP = planets.Planet.W
			SPECULUM = PrimDirs.REGIOSPECULUM
		if self.options.primarydir == PrimDirs.CAMPANIAN:
			MP = planets.Planet.CMP
			SPECULUM = PrimDirs.REGIOSPECULUM

		#Promissor1
		for p1 in range(len(self.chart.planets.planets)-NODES):
			if not self._promissor_body_enabled(p1):
				continue

			plprom1 = self.chart.planets.planets[p1]
			raprom1 = plprom1.speculums[SPECULUM][planets.Planet.RA]
			declprom1 = plprom1.speculums[SPECULUM][planets.Planet.DECL]

			#Promissor2
			for p2 in range(p1+1, len(self.chart.planets.planets)):
				if not self._promissor_body_enabled(p2):
					continue

				# exclude midpoint of Node and its opposite (mean/true 모드 모두 안전)
				NODE_IDX = astrology.SE_PLUTO + 1      # 10: 선택된 노드(Mean 또는 True)
				if p1 == NODE_IDX and p2 == NODE_IDX + 1:  # 11: 반대 노드(노드 + 180°)
					continue

				plprom2 = self.chart.planets.planets[p2]
				raprom2 = plprom2.speculums[SPECULUM][planets.Planet.RA]
				declprom2 = plprom2.speculums[SPECULUM][planets.Planet.DECL]

				ramid = util.normalize((raprom1+raprom2)/2.0)

				#Significator
				for s in range(len(self.chart.planets.planets)):
					if not self.options.sigplanets[s]:
						continue

					if self.abort.abort:
						return

					plsig = self.chart.planets.planets[s]

#					print 'p1=%d, p2=%d, s=%d' % (p1, p2, s)#

					rasig = plsig.speculums[SPECULUM][planets.Planet.RA]
					declsig = plsig.speculums[SPECULUM][planets.Planet.DECL]
					mpsig = plsig.speculums[SPECULUM][MP]

					if math.fabs(ramid-rasig) > 90.0:
						ramid += 180.0
						if ramid >= 360.0:
							ramid -= 360.0

					arc = self.getDiff(ramid-rasig)
#					print 'ramid=%f, rasig=%f, arc=%f' % (ramid, rasig, arc)
#					print '********'

					LIM = 30
					x = 0
					good = True
					while x < LIM:
						initarc = arc
						ok, arc = self.iterate(raprom1, declprom1, raprom2, declprom2, mpsig, arc, plsig)
						if not ok:
							good = False
							break
						arc = self.getDiff(arc)#

#						print '%d: initarc=%f, arc=%f' % (x, initarc, arc)
						x += 1
						if math.fabs(math.fabs(arc)-initarc) < 0.001:
							break

						if self.abort.abort:
							return

					if not good:
						continue

					if x == LIM:
						arc = (arc+initarc)/2.0 #Is this OK!?

					self.create(True, p1, p2, s, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, arc)


	def calcMidPoints2Customer2(self):
		'''Computes mundane midpoints to Customer2'''

		NODES = 2

		MP = customerpd.CustomerPD.PMP
		SPECULUM = PrimDirs.PLACSPECULUM
#		if self.options.primarydir == PrimDirs.PLACIDIANUNDERTHEPOLE:
#			MP = customerpd.CustomerPD.Planet.PMP
#			SPECULUM = PrimDirs.PLACSPECULUM
		if self.options.primarydir == PrimDirs.REGIOMONTAN:
			MP = customerpd.CustomerPD.W
			SPECULUM = PrimDirs.REGIOSPECULUM
		if self.options.primarydir == PrimDirs.CAMPANIAN:
			MP = customerpd.CustomerPD.CMP
			SPECULUM = PrimDirs.REGIOSPECULUM

		#Promissor1
		for p1 in range(len(self.chart.planets.planets)-NODES):
			if not self._promissor_body_enabled(p1):
				continue

			plprom1 = self.chart.planets.planets[p1]
			raprom1 = plprom1.speculums[SPECULUM][planets.Planet.RA]
			declprom1 = plprom1.speculums[SPECULUM][planets.Planet.DECL]

			#Promissor2
			for p2 in range(p1+1, len(self.chart.planets.planets)):
				if not self._promissor_body_enabled(p2):
					continue

				# exclude midpoint of Node and its opposite (mean/true 모드 모두 안전)
				NODE_IDX = astrology.SE_PLUTO + 1      # 10: 선택된 노드(Mean 또는 True)
				if p1 == NODE_IDX and p2 == NODE_IDX + 1:  # 11: 반대 노드(노드 + 180°)
					continue

				plprom2 = self.chart.planets.planets[p2]
				raprom2 = plprom2.speculums[SPECULUM][planets.Planet.RA]
				declprom2 = plprom2.speculums[SPECULUM][planets.Planet.DECL]

				ramid = util.normalize((raprom1+raprom2)/2.0)

				if self.abort.abort:
					return

				#Significator
				point = self._get_active_dynamic_sig_point()
				if point == None:
					return
				rasig = point.speculums[SPECULUM][customerpd.CustomerPD.RA]
				declsig = point.speculums[SPECULUM][customerpd.CustomerPD.DECL]
				mpsig = point.speculums[SPECULUM][MP]

				if math.fabs(ramid-rasig) > 90.0:
					ramid += 180.0
					if ramid >= 360.0:
						ramid -= 360.0

				arc = self.getDiff(ramid-rasig)
#				print 'ramid=%f, rasig=%f, arc=%f' % (ramid, rasig, arc)
#				print '********'

				LIM = 30
				x = 0
				good = True
				while x < LIM:
					initarc = arc
					ok, arc = self.iterate(raprom1, declprom1, raprom2, declprom2, mpsig, arc, plprom1)
					if not ok:
						good = False
						break
					arc = self.getDiff(arc)#

#					print '%d: initarc=%f, arc=%f' % (x, initarc, arc)
					x += 1
					if math.fabs(math.fabs(arc)-initarc) < 0.001:
						break

					if self.abort.abort:
						return

				if not good:
					continue

				if x == LIM:
					arc = (arc+initarc)/2.0 #Is this OK!?

				self.create(True, p1, p2, PrimDir.CUSTOMERPD, chart.Chart.MIDPOINT, chart.Chart.CONJUNCTIO, arc)


	def iterate(self, raprom1, declprom1, raprom2, declprom2, mpsig, arc, pl):
		#3.
		raprom1comma = util.normalize(raprom1-arc)
		declprom1comma = declprom1

		raprom2comma = util.normalize(raprom2-arc)
		declprom2comma = declprom2

		ok, mpp1comma = self.calcMP(raprom1comma, declprom1comma, pl)
		if not ok:
			return False, 0.0
		ok, mpp2comma = self.calcMP(raprom2comma, declprom2comma, pl)
		if not ok:
			return False, 0.0

#		print 'mpp1comma=%f, mpp2comma=%f' % (mpp1comma, mpp2comma)

		mppmidcomma = util.normalize((mpp1comma+mpp2comma)/2.0)
#		print 'mppmidcomma=%f' % mppmidcomma

		if math.fabs(mppmidcomma-mpsig) > 90.0:
			mppmidcomma += 180.0
			if mppmidcomma >= 360.0:
				mppmidcomma -= 360.0

#		print 'mppmidcomma checked=%f' % mppmidcomma

#		dmp = util.normalize(mppmidcomma-mpsig)# Regiomontan Midpoints weren't found
		dmp = self.getDiff(mppmidcomma-mpsig)
#		print 'dmp=%f' % dmp

		ok, mpp1 = self.calcMP(raprom1, declprom1, pl)
		if not ok:
			return False, 0.0
#		print 'mpp1=%f' % mpp1
		darc = dmp*self.getDiff(raprom1-raprom1comma)/self.getDiff(mpp1-mpp1comma)

		return True, arc+darc


	def getEclPoints(self, lon, decl, onEcl):
		'''Calculates points of the Ecliptic from declination'''

		PARALLEL = chart.Chart.PARALLEL
		CONTRAPARALLEL = chart.Chart.CONTRAPARALLEL

		origdecl = decl

		if decl < 0.0:
			decl *= -1

		if decl > self.chart.obl[0]:
			return False, ((-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL))

		if onEcl:
			if decl == self.chart.obl[0]:
				lon += 180.0
				lon = util.normalize(lon)
				return True, ((lon, CONTRAPARALLEL), (-1.0, PARALLEL))
			else:
				lon1 = lon+180.0
				lon1 = util.normalize(lon1)
				lon2 = 360.0-lon1
				lon3 = util.normalize(lon2+180.0)
				return True, ((lon1, CONTRAPARALLEL), (lon2, PARALLEL), (lon3, CONTRAPARALLEL))
		else:
			if decl == self.chart.obl[0]:
				val = math.sin(math.radians(origdecl))/math.sin(math.radians(self.chart.obl[0]))
				if math.fabs(val) <= 1.0:
					lon1 = math.degrees(math.asin(val))
					lon1 = util.normalize(lon1)
					lon2 = util.normalize(lon1+180.0)
					return True, ((lon1, PARALLEL), (lon2, CONTRAPARALLEL))
				else:
					return False, ((-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL))
			else:
				val = math.sin(math.radians(origdecl))/math.sin(math.radians(self.chart.obl[0]))
				if math.fabs(val) <= 1.0:
					lon1 = math.degrees(math.asin(val))
					lon1 = util.normalize(lon1)
					lon2 = util.normalize(lon1+180.0)
					lon3 = 360.0-lon2
					lon4 = util.normalize(lon3+180.0)
					return True, ((lon1, PARALLEL), (lon2, CONTRAPARALLEL), (lon3, PARALLEL), (lon4, CONTRAPARALLEL))
				else:
					return False, ((-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL))

		return False, ((-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL), (-1.0, PARALLEL))


	def getBianchini(self, lat, asp):
		return math.sin(math.radians(lat))*math.cos(math.radians(asp))


	def getMorinExcentric(self, planet_idx, lon_p, lat_p, asp_signed_deg):
		'''Returns (corrected_lon_deg, corrected_lat_deg) for the aspect terminus
		of planet ``planet_idx`` (Planets index, 0=Sun..9=Pluto) under Morin's
		excentric circle of aspects (Astrologia Gallica book 16 §I ch. 9).

		``lon_p``, ``lat_p`` are the planet's true ecliptic longitude/latitude.
		``asp_signed_deg`` is the signed aspect angle (sinister positive,
		dexter negative).

		Falls back to ``(lon_p + asp_signed_deg, lat_p)`` if the apparent nodes
		can't be located in the planet's scan window or the inclination is
		degenerate.
		'''
		from planets import Planet, Planets
		# Map Planets index -> Swiss Eph id. Planets order is Sun..Pluto then nodes.
		_PLANET_TO_SE = [
			astrology.SE_SUN,
			astrology.SE_MOON,
			astrology.SE_MERCURY,
			astrology.SE_VENUS,
			astrology.SE_MARS,
			astrology.SE_JUPITER,
			astrology.SE_SATURN,
			astrology.SE_URANUS,
			astrology.SE_NEPTUNE,
			astrology.SE_PLUTO,
		]
		if planet_idx < 0 or planet_idx >= len(_PLANET_TO_SE):
			return util.normalize(lon_p + asp_signed_deg), lat_p
		pId = _PLANET_TO_SE[planet_idx]
		flag = self.chart._planet_calc_flag() if hasattr(self.chart, '_planet_calc_flag') else (astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED)
		tjd = self.chart.time.jd
		dlon, lat_a = _morin_aspects.aspect_correction(
			tjd, pId, flag, lon_p, lat_p, asp_signed_deg, cache_key=tjd)
		return util.normalize(lon_p + asp_signed_deg + dlon), lat_a


	def create(
		self,
		mundane,
		prom,
		prom2,
		sig,
		promasp,
		sigasp,
		arc,
		parallelaxis=0,
		promasp_offset=0.0,
		sigasp_offset=0.0,
	):
		'''Creates a direction and pushes it into the list of directions'''

		if PrimDirs.is_angle_antiscion_promissor(prom):
			return

		if not self._uses_revolution_time():
			#Just for safety
			if arc <= -360.0:
				arc += 360.0
#				print '<360 prom=%d sig=%d promasp=%d sigasp=%d parallelaxis=%d' % (prom, sig, promasp, sigasp, parallelaxis)
			if arc >= 360.0:
				arc -= 360.0
#				print '>360 prom=%d sig=%d promasp=%d sigasp=%d parallelaxis=%d' % (prom, sig, promasp, sigasp, parallelaxis)

			direct = True
			if arc < 0.0:
				arc *= -1
				direct = False
			if arc > 180.0:
				arc = 360.0-arc 
				direct = not direct

			lim = self._max_age_limit()
		else:
			direct = True
			if arc < 0.0:
				arc *= -1
				direct = False
			if arc > 180.0:
				arc = 360.0-arc 
				direct = not direct

			lim = PrimDirs.REVOLUTIO

			if (arc < lim or arc > -lim) and (
				self.direction == PrimDirs.BOTHDC
				or (self.direction == PrimDirs.DIRECT and direct)
				or (self.direction == PrimDirs.CONVERSE and not direct)
			):

				time, age = self.calcTimeRev(arc)

				pd = PrimDir()
				pd.mundane = mundane
				pd.prom = prom
				pd.prom2 = prom2
				pd.sig = sig
				if prom == PrimDir.CUSTOMERPD:
					pd.promdyn = self._get_active_dynamic_prom_key()
				if sig == PrimDir.CUSTOMERPD:
					sig_body_id = self._get_active_dynamic_sig_primdir()
					if sig_body_id is not None:
						pd.sig = sig_body_id
					else:
						pd.sigdyn = self._get_active_dynamic_sig_key()
				pd.promasp = promasp
				pd.sigasp = sigasp
				pd.promasp_offset = float(promasp_offset)
				pd.sigasp_offset = float(sigasp_offset)
				self._set_pd_provenance(pd)
				pd.arc = arc
				pd.direct = direct
				pd.parallelaxis = parallelaxis
				pd.time = time
				pd.age = age

				self.pds.append(pd)

			arc = 360.0-arc 
			direct = not direct

		if not self._uses_revolution_time() and self._range_bounds_override is not None:
			self._append_windowed_radix_pd(
				mundane,
				prom,
				prom2,
				sig,
				promasp,
				sigasp,
				arc,
				direct,
				parallelaxis,
				promasp_offset,
				sigasp_offset,
			)
			complement_arc = 360.0 - arc
			if arc > 0.0 and math.fabs(complement_arc - arc) > 1e-9:
				self._append_windowed_radix_pd(
					mundane,
					prom,
					prom2,
					sig,
					promasp,
					sigasp,
					complement_arc,
					not direct,
					parallelaxis,
					promasp_offset,
					sigasp_offset,
				)
			return

		if (arc >= lim or arc <= -lim) or (
			not self._direction_allowed(direct)
		):
			return

		if not self._uses_revolution_time():
			time, age = self.calcTime(arc, direct)
		else:
			time, age = self.calcTimeRev(arc)

		if not self._uses_revolution_time():
			lo, hi = self._range_bounds()
			if age < lo or age >= hi:
				return

		self._append_pd(
			mundane,
			prom,
			prom2,
			sig,
			promasp,
			sigasp,
			arc,
			direct,
			parallelaxis,
			time,
			age,
			promasp_offset,
			sigasp_offset,
		)


	def calcTime(self, arc, direct):
		'''Calculates time from arc according to the selected key (dynamic or static)'''

		ti = 0.0

		if self.options.pdkeydyn:
			if self.options.pdkeyd == PrimDirs.TRUESOLAREQUATORIALARC or self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
				if not direct and self.options.useregressive:
					ti = self.calcTrueSolarArcRegressive(arc)
				else:
					ti = self.calcTrueSolarArc(arc)
			else:
				ti = self.calcBirthSolarArc(arc)
		else:
			if self.options.pdkeys == PrimDirs.CUSTOMER:
				val = (self.options.pdkeydeg+self.options.pdkeymin/60.0+self.options.pdkeysec/3600.0) 
				if val != 0.0:
					coeff = 1.0/val
					ti = arc*coeff
			else:
				ti = arc*PrimDirs.staticData[self.options.pdkeys][PrimDirs.COEFF]

#		jy, jm, jd, jh = astrology.swe_revjul(self.chart.time.jd+ti, 1)
#		d, m, s = util.decToDeg(jh)
#		print '%d.%2d.%2d %2d:%2d:%2d' % (jy, jm, jd, d, m, s)
		return self.chart.time.jd+ti*365.2421904, ti
#		return util.convDate(self.chart.time.year, self.chart.time.month, self.chart.time.day)+ti, ti


	def calcTrueSolarArc(self, arc):
		LIM = 120.0 #arbitrary value
		y = self.chart.time.year
		m = self.chart.time.month
		d = self.chart.time.day

		h, mi, s = util.decToDeg(self.chart.time.time)
		tt = 0.0

		#Add arc to Suns's pos (long or ra)
		prSunPos = self.chart.planets.planets[astrology.SE_SUN].dataEqu[planets.Planet.RAEQU]
		if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
			prSunPos = self.chart.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]

		prSunPosEnd = prSunPos+arc
		transition = False #Pisces-Aries
		if prSunPosEnd >= 360.0:
			transition = True

#		Find day in ephemeris
		while (prSunPos <= prSunPosEnd):
			y, m, d = util.incrDay(y, m, d)
			ti = chart.Time(y, m, d, 0, 0, 0, False, self.chart.time.cal, chart.Time.GREENWICH, True, 0, 0, False, self.chart.place, False)
			sun = planets.Planet(ti.jd, astrology.SE_SUN, astrology.SEFLG_SWIEPH)
			
			pos = sun.dataEqu[planets.Planet.RAEQU]
			if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
				pos = sun.data[planets.Planet.LONG]

			if transition and pos < LIM:
				pos += 360.0
			prSunPos = pos

			if self.abort.abort:
				return 0.0

		if (prSunPos != prSunPosEnd):
			y, m, d = util.decrDay(y, m, d)

			if transition:
				prSunPosEnd -= 360.0

			trlon = 0.0
			if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
				trlon = prSunPosEnd
			else:
				#to Longitude...
				trlon = util.ra2ecl(prSunPosEnd, self.chart.obl[0])

			trans = transits.Transits()
			trans.day(y, m, d, self.chart, astrology.SE_SUN, trlon)

			if len(trans.transits) > 0:
				tt = trans.transits[0].time
		else:
			#the time is midnight
			tt = 0.0

		#difference
		d1 = datetime.datetime(self.chart.time.year, self.chart.time.month, self.chart.time.day, h, mi, s) #in GMT
		th, tm, ts = util.decToDeg(tt)
		d2 = datetime.datetime(y, m, d, th, tm, ts) #in GMT
		diff = d2-d1
		ddays = diff.days
		dtime = diff.seconds/3600.0
		#dtime to days
		dtimeindays = dtime/24.0

		tt = ddays+dtimeindays

		return tt


	def calcTrueSolarArcRegressive(self, arc):
		LIM = 120.0 #arbitrary value
		y = self.chart.time.year
		m = self.chart.time.month
		d = self.chart.time.day

		h, mi, s = util.decToDeg(self.chart.time.time)
		tt = 0.0

		#Subtract arc from Suns's pos (long or ra)
		prSunPos = self.chart.planets.planets[astrology.SE_SUN].dataEqu[planets.Planet.RAEQU]
		if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
			prSunPos = self.chart.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]

		prSunPosEnd = prSunPos-arc
		transition = False #Pisces-Aries
		if prSunPosEnd < 0.0:
			prSunPos += 360.0
			prSunPosEnd += 360.0
			transition = True

#		Find day in ephemeris
		while (prSunPos >= prSunPosEnd):
			y, m, d = util.decrDay(y, m, d)
			ti = chart.Time(y, m, d, 0, 0, 0, False, self.chart.time.cal, chart.Time.GREENWICH, True, 0, 0, False, self.chart.place, False)
			sun = planets.Planet(ti.jd, astrology.SE_SUN, astrology.SEFLG_SWIEPH)
			
			pos = sun.dataEqu[planets.Planet.RAEQU]
			if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
				pos = sun.data[planets.Planet.LONG]
			if transition and pos < LIM:
				pos += 360.0
			prSunPos = pos

			if self.abort.abort:
				return 0.0

		if (prSunPos != prSunPosEnd):
			if transition:
				prSunPosEnd -= 360.0

			trlon = 0.0
			if self.options.pdkeyd == PrimDirs.TRUESOLARECLIPTICALARC:
				trlon = prSunPosEnd
			else:
				#to Longitude...
				trlon = util.ra2ecl(prSunPosEnd, self.chart.obl[0])

			trans = transits.Transits()
			trans.day(y, m, d, self.chart, astrology.SE_SUN, trlon)

			if len(trans.transits) > 0:
				tt = trans.transits[0].time
		else:
			#the time is midnight
			tt = 0.0

		#difference
		th, tm, ts = util.decToDeg(tt)
		d1 = datetime.datetime(y, m, d, th, tm, ts) #in GMT
		d2 = datetime.datetime(self.chart.time.year, self.chart.time.month, self.chart.time.day, h, mi, s) #in GMT
		diff = d2-d1
		ddays = diff.days
		dtime = diff.seconds/3600.0
		#dtime to days
		dtimeindays = dtime/24.0

		tt = ddays+dtimeindays

		return tt


	def calcBirthSolarArc(self, arc):
		y = self.chart.time.year
		m = self.chart.time.month
		d = self.chart.time.day

		yn, mn, dn = util.incrDay(y, m, d)

		ti1 = chart.Time(y, m, d, 0, 0, 0, False, self.chart.time.cal, chart.Time.LOCALMEAN, True, 0, 0, False, self.chart.place, False)
		ti2 = chart.Time(yn, mn, dn, 0, 0, 0, False, self.chart.time.cal, chart.Time.LOCALMEAN, True, 0, 0, False, self.chart.place, False)

		sun1 = planets.Planet(ti1.jd, astrology.SE_SUN, astrology.SEFLG_SWIEPH)
		sun2 = planets.Planet(ti2.jd, astrology.SE_SUN, astrology.SEFLG_SWIEPH)

		diff = 0.0
		if self.options.pdkeyd == PrimDirs.BIRTHDAYSOLAREQUATORIALARC:
			diff = sun2.dataEqu[planets.Planet.RAEQU]-sun1.dataEqu[planets.Planet.RAEQU]
		elif self.options.pdkeyd == PrimDirs.BIRTHDAYSOLARECLIPTICALARC:
			diff = sun2.data[planets.Planet.LONG]-sun1.data[planets.Planet.LONG]

		coeff = 0.0
		if diff != 0.0:
			coeff = 1.0/diff

		return arc*coeff


	def calcTimeRev(self, arc):
		'''Calculates time from arc in Revolutions (Solar, Lunar)'''

		if self.chart.htype == chart.Chart.SOLAR:
			if getattr(self.options, 'pdrevsunyearmode', PrimDirs.REVSOLAR_TROPICAL) == PrimDirs.REVSOLAR_360:
				days = arc
			else:
				days = arc * (365.2421904/360.0)
			ti = days/365.2421904
		else:
			ti = arc*0.0758333/360.0#13.18681376/360.0 # 13.1868.. = 1/(27.3/360.0) coeff

		return self.chart.time.jd+ti*365.2421904, ti
#		return util.convDate(self.chart.time.year, self.chart.time.month, self.chart.time.day)+ti, ti #age won't be correct!!


	def sort(self):
		for j in range(len(self.pds)):
			for i in range(len(self.pds)-1):
				if self.abort.abort:
					return

				if (self.pds[i].time > self.pds[i+1].time):
					tmp = self.pds[i]
					self.pds[i] = self.pds[i+1]
					self.pds[i+1] = tmp


	def qsort(self, L):
		if L == []: return []
		return self.qsort([x for x in L[1:] if x.time < L[0].time]) + L[0:1] + self.qsort([x for x in L[1:] if x.time >= L[0].time])


	def adlat(self, decl):
		'''Ascensional difference for a given declination (uses pre-computed tanlat)'''
		val = self.tanlat * math.tan(math.radians(decl))
		if math.fabs(val) > 1.0:
			return None
		return math.degrees(math.asin(val))

	def getDiff(self, diff):
		direct = True
		if diff < 0.0:
			diff *= -1
			direct = False
		if diff > 180.0:
			diff = 360.0-diff 
			direct = not direct

		if not direct:
			diff *= -1

		return diff


	def print2file(self, fname):
		# Save-As-Text path. Body builder lives in format2text() so the daemon
		# (and any non-wx caller) can reuse the exact wx file formatting without
		# touching the filesystem. Signature unchanged; this only delegates.
		f = open(fname, 'w')
		f.write(self.format2text())
		f.close()


	def format2text(self, aspect_label_for_index=None):
		bodies = (mtexts.txts['Sun'], mtexts.txts['Moon'], mtexts.txts['Mercury'], mtexts.txts['Venus'], mtexts.txts['Mars'], mtexts.txts['Jupiter'], mtexts.txts['Saturn'], mtexts.txts['Uranus'], mtexts.txts['Neptune'], mtexts.txts['Pluto'], mtexts.txts['AscNode'], mtexts.txts['DescNode'], 'Asc', 'Desc', 'MC', 'IC', 'HC2', 'HC3', 'HC5', 'HC6', 'HC8', 'HC9', 'HC11', 'HC12', mtexts.txts['LoF'], mtexts.txts['Syzygy'], mtexts.txts['Customer2'])
		signs = ['('+mtexts.txts['Aries']+')', '('+mtexts.txts['Taurus']+')', '('+mtexts.txts['Gemini']+')', '('+mtexts.txts['Cancer']+')', '('+mtexts.txts['Leo']+')', '('+mtexts.txts['Virgo']+')', '('+mtexts.txts['Libra']+')', '('+mtexts.txts['Scorpio']+')', '('+mtexts.txts['Sagittarius']+')', '('+mtexts.txts['Capricornus']+')', '('+mtexts.txts['Aquarius']+')', '('+mtexts.txts['Pisces']+')']
		aspects = (mtexts.txts['Conjunctio'], mtexts.txts['Semisextil'], mtexts.txts['Semiquadrat'], mtexts.txts['Sextil'], mtexts.txts['Quintile'], mtexts.txts['Quadrat'], mtexts.txts['Trigon'], mtexts.txts['Sesquiquadrat'], mtexts.txts['Biquintile'], mtexts.txts['Quinqunx'], mtexts.txts['Oppositio'], mtexts.txts['Septile'], mtexts.txts['Parallel'], mtexts.txts['Contraparallel'], mtexts.txts['RaptParallel'], mtexts.txts['RaptParallel'], mtexts.txts['MidPoint'])
		if callable(aspect_label_for_index):
			aspects = tuple(
				aspect_label_for_index(index) or label
				for index, label in enumerate(aspects)
			)

		pdsystem = (mtexts.txts['PlacidianSemiArc'], mtexts.txts['PlacidianUnderThePole'], mtexts.txts['Regiomontan'], mtexts.txts['Campanian'])
		pdkeysdyn = (mtexts.txts['TrueSolarEquatorialArc'], mtexts.txts['BirthdaySolarEquatorialArc'], mtexts.txts['TrueSolarEclipticalArc'], mtexts.txts['BirthdaySolarEclipticalArc'])
		pdkeysstat = (mtexts.txts['Naibod'], mtexts.txts['Cardan'], mtexts.txts['Ptolemy'], mtexts.txts['Customer'])

		lines = []

		lines.append(pdsystem[self.options.primarydir])
		lines.append('\n')

		if self.options.pdkeydyn:
			lines.append(mtexts.txts['DynamicKey']+':\n')
			lines.append(pdkeysdyn[self.options.pdkeyd]) 
			lines.append('\n')
		else:
			deg = self.options.pdkeydeg
			minu = self.options.pdkeymin
			sec = self.options.pdkeysec
			if self.options.pdkeys != PrimDirs.CUSTOMER:
				deg = PrimDirs.staticData[self.options.pdkeys][PrimDirs.DEG]
				minu = PrimDirs.staticData[self.options.pdkeys][PrimDirs.MIN]
				sec = PrimDirs.staticData[self.options.pdkeys][PrimDirs.SEC]

			lines.append(mtexts.txts['StaticKey']+':\n')
			txt = pdkeysstat[self.options.pdkeys]+' '+str(deg)+mtexts.txts['DegPDList']+' '+str(minu).zfill(2)+mtexts.txts['MinPDList']+' '+str(sec).zfill(2)+mtexts.txts['SecPDList'] 
			lines.append(txt)
			lines.append('\n')

		for pd in self.pds:
			mtxt = mtexts.txts['M']
			if not pd.mundane:
				mtxt = mtexts.txts['Z']

			dirtxt = mtexts.txts['D']
			if not pd.direct:
				dirtxt = mtexts.txts['C']

			y, m, d, h = astrology.swe_revjul(pd.time, 1)
#			y, m, d, extra = util.revConvDate(pd.time)

			#M/Z
			formattxt = '%s '
			tuptxt = [mtxt]

			#promissors
			if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR: 
				formattxt += '%s %s '
				promtxt = self._format_pd_body_label(pd.prom, True, pd.promdyn, body_context=True)
				if promtxt is None:
					promtxt = bodies[pd.prom]
				prom2txt = self._format_pd_body_label(pd.prom2, True, pd.promdyn, body_context=True)
				if prom2txt is None:
					prom2txt = bodies[pd.prom2]
				tuptxt.append(promtxt)
				tuptxt.append(prom2txt)
			elif pd.prom >= PrimDir.ANTISCION and pd.prom < PrimDir.TERM:
				if pd.promasp != chart.Chart.CONJUNCTIO:
					formattxt += '%s '
					tuptxt.append(aspects[pd.promasp])

				anttxt = mtexts.txts['Antiscion']
				if pd.prom >= PrimDir.CONTRAANT:
					anttxt = mtexts.txts['Contraantiscion']
				formattxt += '%s '
				tuptxt.append(anttxt)

				promtxt = ''
				antoffs = PrimDir.ANTISCION
				if pd.prom >= PrimDir.CONTRAANT:
					antoffs = PrimDir.CONTRAANT
				if pd.prom == PrimDir.ANTISCIONLOF or pd.prom == PrimDir.CONTRAANTLOF:
					promtxt = bodies[pd.prom-antoffs]
				elif pd.prom == PrimDir.ANTISCIONASC or pd.prom == PrimDir.CONTRAANTASC:
					promtxt = mtexts.txts['Asc']
				elif pd.prom == PrimDir.ANTISCIONMC or pd.prom == PrimDir.CONTRAANTMC:
					promtxt = mtexts.txts['MC']
				else:
					promtxt = bodies[pd.prom-antoffs]

				formattxt += '%s '
				tuptxt.append(promtxt)
			elif pd.prom >= PrimDir.TERM and pd.prom < PrimDir.FIXSTAR:
				formattxt += '%s%s '
				tuptxt.append(signs[pd.prom-PrimDir.TERM])
				tuptxt.append(bodies[pd.prom2])
			elif pd.prom >= PrimDir.FIXSTAR:
				formattxt += '%s '

				# 코드(nomname)로 식별
				code = self.chart.fixstars.data[pd.prom-PrimDir.FIXSTAR][fixstars.FixStars.NOMNAME]
				raw  = self.chart.fixstars.data[pd.prom-PrimDir.FIXSTAR][fixstars.FixStars.NAME]

				if self.options.usetradfixstarnamespdlist:
					# 옵션이 켜져 있으면 전통명/alias 우선
					fallback = None
					trad = (raw or '').strip()
					if trad:
						fallback = trad
					if not fallback:
						fallback = raw or code

					promtxt = astrology.display_fixstar_name(code, self.options, fallback)
				else:
					# 옵션이 꺼져 있으면 무조건 NOMNAME(code) 그대로
					promtxt = code

				tuptxt.append(promtxt)
			elif pd.prom == PrimDir.LOF:
				formattxt += '%s '
				tuptxt.append(bodies[pd.prom])
			elif pd.prom == PrimDir.LOF:
				formattxt += '%s '
				tuptxt.append(bodies[pd.prom])
			elif pd.prom == PrimDir.CUSTOMERPD:
				formattxt += '%s '
				tuptxt.append(self._get_dynamic_point_label(pd.promdyn, True))
			elif pd.prom == PrimDir.ASC or pd.prom == PrimDir.MC:
				if pd.promasp != chart.Chart.CONJUNCTIO:
					formattxt += '%s '
					tuptxt.append(aspects[pd.promasp])
				formattxt += '%s '
				atxt = mtexts.txts['Asc']
				if pd.prom == PrimDir.MC:
					atxt = mtexts.txts['MC']
				tuptxt.append(atxt)
			elif pd.prom >= PrimDir.HC2 and pd.prom < PrimDir.LOF:#Sig is HC
				formattxt += '%s '
				HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
				htxt = HCs[pd.sig-PrimDir.HC2]
				tuptxt.append(htxt)
			else:
				if pd.promasp != chart.Chart.CONJUNCTIO:
					formattxt += '%s '
					tuptxt.append(aspects[pd.promasp])
				formattxt += '%s '
				promtxt = self._format_pd_body_label(pd.prom, True, pd.promdyn)
				if promtxt is None:
					promtxt = bodies[pd.prom]
				tuptxt.append(promtxt)

			#D/C
			formattxt += '%s %s '
			tuptxt.append(dirtxt)	
			tuptxt.append('-->')	

			#significators
			if pd.sigasp == chart.Chart.PARALLEL or pd.sigasp == chart.Chart.CONTRAPARALLEL:
				formattxt += '%s %s '
				partxt = aspects[chart.Chart.PARALLEL]
				if pd.parallelaxis == 0 and pd.sigasp == chart.Chart.CONTRAPARALLEL:
					partxt = aspects[chart.Chart.CONTRAPARALLEL]
				tuptxt.append(partxt)
				sigtxt = self._format_pd_body_label(pd.sig, False, pd.sigdyn)
				if sigtxt is None:
					sigtxt = bodies[pd.sig]
				tuptxt.append(sigtxt)
				if pd.parallelaxis != 0:
					angles = ('('+mtexts.txts['Asc']+')', '('+mtexts.txts['Dsc']+')', '('+mtexts.txts['MC']+')', '('+mtexts.txts['IC']+')')
					formattxt += '%s '
					tuptxt.append(angles[pd.parallelaxis-PrimDir.OFFSANGLES])
			elif pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
				formattxt += '%s %s '
				tuptxt.append(aspects[pd.sigasp])
				angles = ('('+mtexts.txts['Asc']+')', '('+mtexts.txts['Dsc']+')', '('+mtexts.txts['MC']+')', '('+mtexts.txts['IC']+')')
				tuptxt.append(angles[pd.parallelaxis-PrimDir.OFFSANGLES])
			elif pd.sig == PrimDir.LOF:
				if pd.mundane:
					if pd.sigasp != chart.Chart.CONJUNCTIO:
						formattxt += '%s '
						tuptxt.append(aspects[pd.sigasp])

				formattxt += '%s '
				tuptxt.append(mtexts.txts['LoF'])
			elif pd.sig == PrimDir.SYZ:
				formattxt += '%s '
				tuptxt.append(bodies[pd.sig])
			elif pd.sig == PrimDir.CUSTOMERPD:
				formattxt += '%s '
				tuptxt.append(self._get_dynamic_point_label(pd.sigdyn, False))
			elif pd.sig >= PrimDir.OFFSANGLES and pd.sig < PrimDir.LOF:#Sig is Asc,MC or HC
				formattxt += '%s '
				stxt = ''
				if pd.sig <= PrimDir.IC:
					angles = (mtexts.txts['Asc'], mtexts.txts['Dsc'], mtexts.txts['MC'], mtexts.txts['IC'])
					stxt = angles[pd.sig-PrimDir.OFFSANGLES]
				else: #=>HC
					HCs = (mtexts.txts['HC2'], mtexts.txts['HC3'], mtexts.txts['HC5'], mtexts.txts['HC6'], mtexts.txts['HC8'], mtexts.txts['HC9'], mtexts.txts['HC11'], mtexts.txts['HC12'])
					stxt = HCs[pd.sig-PrimDir.HC2]
				tuptxt.append(stxt)
			else:
				if pd.sigasp != chart.Chart.CONJUNCTIO:
					formattxt += '%s '
					tuptxt.append(aspects[pd.sigasp])
				formattxt += '%s '
				sigtxt = self._format_pd_body_label(pd.sig, False, pd.sigdyn)
				if sigtxt is None:
					sigtxt = bodies[pd.sig]
				tuptxt.append(sigtxt)

			#Arc
			formattxt += '%f '
			tuptxt.append(pd.arc)

			#Date
			formattxt += '%d.%02d.%02d'
			tuptxt.append(y)
			tuptxt.append(m)
			tuptxt.append(d)

			formattxt += '\n'

			lines.append(formattxt % tuple(tuptxt))

		return ''.join(lines)
