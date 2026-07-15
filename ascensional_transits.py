# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Polich/Page Ascensional Transits — snapshot calculator.

Per Juan Estadella, *Predictive Astrology* (3rd ed., Barcelona 2019),
ch. 13, ascensional transits are NOT slow ecliptic-style events.  Their
cadence is *diurnal* — driven by the rotation of the Earth, not by the
orbital motion of the planets.  Over the course of 24 hours every planet
in the sky passes over the natal position of every radical factor
(planet, house cusp, node, lot).

Coordinate system (MDO + quadrant), per Estadella ch. 13:

  Quadrant Q1  =  houses X, XI, XII   (above horizon, eastern)
  Quadrant Q2  =  houses I, II, III   (below horizon, eastern)
  Quadrant Q3  =  houses IV, V, VI    (below horizon, western)
  Quadrant Q4  =  houses VII, VIII, IX (above horizon, western)

  MDO  =  90 * (md / sa)
           md = meridian distance to the nearer meridian (MC if above, IC if below)
           sa = the corresponding semi-arc (DSA above, NSA below)

  Within each quadrant MDO runs 0° at the meridian (MC/IC) to 90° at the
  horizon (Asc/Desc).  House cusps therefore sit at fixed MDOs:
    X / IV          MDO 0
    XI / IX / III / V    MDO 30
    XII / VIII / II / VI  MDO 60
    I / VII         MDO 90

Aspects in this system:

  Conjunction  --  same quadrant, same MDO
  Opposition   --  opposite quadrants (1<->3, 2<->4), same MDO
  Antiscia     --  adjacent quadrants (1<->2, 2<->3, 3<->4, 4<->1), same MDO

Orbs (Estadella ch. 13, with second-accurate rectification):
  Conjunction / opposition  --  25' of arc
  Antiscia                  --  10' of arc
  Parallels (true decl)     --  2'  of arc

Time/arc equivalence: 1' MDO ≈ 4 seconds of time (since the RAMC advances
1° in 4 minutes).

Two-transit rule (Estadella ch. 13 + Polich quote):

  "...in all cases, without exception, at the moment an important event
   takes place, there is an almost partile ecliptic aspect between the
   chart for the event and the zodiacal Radix.  If the aspect is not
   found, the AT is incapable of producing an important event..."

So an AT alone fires only trivial events (sneezes, yawns).  An important
event requires *both* an AT (the discharge) AND a tight ecliptic aspect
between an event-chart planet and the radix (the cause).  Reduced orbs
for the ecliptic side: 30' fast planets, 8' slow planets, aspects of 15°
and all multiples valid.  See `has_active_moment` below.

This module computes a SNAPSHOT — all ATs detected at a single event JD
+ event place.  Callers can step time (live cursor) or feed a specific
event time (forensic mode).
"""

import math
import collections

import astrology
import chart as _chart
import fortune
import houses as _houses
import mtexts
import placspec
import planets
import util


# ---------------------------------------------------------------------------
# Constants -- Estadella ch. 13
# ---------------------------------------------------------------------------

ORB_CONJ_OPP_ARCMIN = 25.0
ORB_ANTISCIA_ARCMIN = 10.0
ORB_PARALLEL_ARCMIN = 2.0

# Two-transit-rule orbs (ecliptic side, *very* tight per Estadella)
ECLIPTIC_ORB_FAST_ARCMIN = 30.0
ECLIPTIC_ORB_SLOW_ARCMIN = 8.0

# Aspects of 15° and all multiples (Estadella ch. 13).
_ECLIPTIC_ASPECT_ANGLES = tuple(15.0 * k for k in range(1, 13))  # 15, 30, ..., 180

# Identification of "fast" planets for ecliptic orb purposes.
_FAST_PLANETS = frozenset((
	astrology.SE_SUN, astrology.SE_MOON,
	astrology.SE_MERCURY, astrology.SE_VENUS, astrology.SE_MARS,
))

# Aspect kinds we report.
CONJUNCTION = 'conjunction'
OPPOSITION = 'opposition'
ANTISCIA = 'antiscia'
PARALLEL = 'parallel'
CONTRAPARALLEL = 'contraparallel'


def _show_chiron(chrt):
	return bool(
		getattr(getattr(chrt, 'options', None), 'showchiron', True)
		and getattr(chrt, 'chiron', None) is not None
	)


def _radix_planet_point_ids(chrt):
	# Main planets only; nodes stay on the explicit node path below.
	ids = list(range(planets.Planets.PLANETS_NUM - 2))
	if _show_chiron(chrt):
		ids.append(astrology.SE_CHIRON)
	return ids


def _transit_planet_point_ids(chrt):
	ids = list(range(planets.Planets.PLANETS_NUM - 2))
	if _show_chiron(chrt):
		ids.append(astrology.SE_CHIRON)
	return ids


def _radix_body(chrt, pid):
	if pid == astrology.SE_CHIRON:
		return getattr(chrt, 'chiron', None)
	try:
		return chrt.planets.planets[pid]
	except Exception:
		return None


def _radix_ecliptic_lons(chrt):
	for pid in range(planets.Planets.PLANETS_NUM):
		body = _radix_body(chrt, pid)
		if body is None:
			continue
		try:
			yield pid, body.data[planets.Planet.LONG]
		except Exception:
			continue
	if _show_chiron(chrt):
		body = getattr(chrt, 'chiron', None)
		if body is not None:
			try:
				yield astrology.SE_CHIRON, body.data[planets.Planet.LONG]
			except Exception:
				pass


# ---------------------------------------------------------------------------
# Records returned by the snapshot.
# ---------------------------------------------------------------------------

MDOPoint = collections.namedtuple(
	'MDOPoint',
	['kind', 'idx', 'label', 'ra', 'decl', 'lon', 'lat',
	 'mdo', 'quadrant', 'above_horizon', 'fixed_in_frame'],
)
"""kind:    'planet' | 'cusp' | 'angle' | 'lof' | 'node'
idx:        body id (planet_index for planets, cusp number 1..12 for cusps,
            0/1 for Asc/MC, 0 for LoF)
label:      display string
ra, decl:   degrees (None for cusps -- they are frame-relative)
lon, lat:   ecliptic coords; lat is None for cusps in the natal
mdo:        0-90 within the quadrant
quadrant:   1..4
fixed_in_frame: True for all radix factors; false for event-time transit
            planets. Marr's AT method compares moving transit MDOs against
            the fixed radix MDO table."""


ATPair = collections.namedtuple(
	'ATPair',
	['transit', 'radix', 'aspect', 'orb_arcmin'],
)


def _south_node_from_north(north):
	pmp = util.normalize(_pmp_from_mdo_q(north.mdo, north.quadrant) + 180.0)
	mdo, q = _mdo_q_from_pmp(pmp)
	return MDOPoint(
		kind='node',
		idx=astrology.SE_TRUE_NODE,
		label=mtexts.txts.get('SouthNode', 'South Node'),
		ra=(util.normalize(north.ra + 180.0) if north.ra is not None else None),
		decl=(-north.decl if north.decl is not None else None),
		lon=(util.normalize(north.lon + 180.0) if north.lon is not None else None),
		lat=(-north.lat if north.lat is not None else None),
		mdo=mdo,
		quadrant=q,
		above_horizon=(q in (1, 4)),
		fixed_in_frame=north.fixed_in_frame,
	)


# ---------------------------------------------------------------------------
# Core MDO computation.
# ---------------------------------------------------------------------------

def compute_mdo(ra, decl, ramc, placelat):
	"""Return (mdo, quadrant, above_horizon) for a sky point.

	ra, decl, ramc, placelat are in degrees.  Quadrant is 1..4
	(Estadella ch. 13).  Returns (None, None, None) if the point is
	circumpolar / undefined at this latitude.
	"""
	raic = ramc + 180.0
	if raic >= 360.0:
		raic -= 360.0

	# Hemisphere: eastern if RA lies above MC and below IC going east.
	eastern = True
	if ramc > raic:
		if raic < ra < ramc:
			eastern = False
	else:
		if (raic < ra < 360.0) or (0.0 <= ra < ramc):
			eastern = False

	# Ascensional difference under the geographic pole.
	val = math.tan(math.radians(placelat)) * math.tan(math.radians(decl))
	if math.fabs(val) > 1.0:
		return None, None, None
	adlat = math.degrees(math.asin(val))

	# Meridian distances to MC and IC (both in [0, 180]).
	md_mc = math.fabs(ramc - ra)
	if md_mc > 180.0:
		md_mc = 360.0 - md_mc
	md_ic = math.fabs(raic - ra)
	if md_ic > 180.0:
		md_ic = 360.0 - md_ic

	dsa = 90.0 + adlat   # diurnal semi-arc
	nsa = 90.0 - adlat   # nocturnal semi-arc

	above = md_mc <= dsa
	if above:
		md, sa = md_mc, dsa
	else:
		md, sa = md_ic, nsa

	if sa <= 0.0:
		return None, None, None

	mdo = 90.0 * md / sa
	if above and eastern:
		quadrant = 1
	elif above and not eastern:
		quadrant = 4
	elif (not above) and eastern:
		quadrant = 2
	else:
		quadrant = 3

	return mdo, quadrant, above


# Static (MDO, quadrant) for each house cusp -- frame-relative constants
# per Estadella ch. 13 ("Houses X and IV: MDO 0", etc.).
_CUSP_MDO_Q = {
	10: (0.0,  1),     # X cusp = MC
	11: (30.0, 1),
	12: (60.0, 1),
	1:  (90.0, 2),     # I cusp = Asc (boundary between Q1 and Q2; convention: Q2)
	2:  (60.0, 2),
	3:  (30.0, 2),
	4:  (0.0,  3),     # IV cusp = IC
	5:  (30.0, 3),
	6:  (60.0, 3),
	7:  (90.0, 4),     # VII cusp = Desc (boundary Q3/Q4; convention: Q4)
	8:  (60.0, 4),
	9:  (30.0, 4),
}


def _pmp_from_mdo_q(mdo, quadrant):
	"""Convert (MDO 0-90, quadrant 1-4) → PMP 0-360 (Asc=0, IC=90, Desc=180,
	MC=270). PMP is single-valued at the cardinal boundaries, so a planet
	on the Ascendant has the same PMP whether `compute_mdo` happens to
	classify it Q1 or Q2 — which lets the conjunction check actually fire
	when a transit hits an angle."""
	if quadrant == 1:    # above-east  (MC -> Asc, PMP 270 -> 360)
		return (270.0 + mdo) % 360.0
	if quadrant == 4:    # above-west  (Desc -> MC, PMP 180 -> 270)
		return 270.0 - mdo
	if quadrant == 2:    # below-east  (Asc -> IC, PMP 0 -> 90)
		return 90.0 - mdo
	# quadrant 3            below-west  (IC -> Desc, PMP 90 -> 180)
	return 90.0 + mdo


def _mdo_q_from_pmp(pmp):
	"""Convert fixed Placidian PMP 0-360 to (MDO, quadrant).

	Radix AT factors are compared against the natal MDO/PMP table, not
	recomputed in the event meridian. Boundary conventions match the cusp table:
	ASC -> Q2, IC -> Q3, Desc -> Q4, MC -> Q1.
	"""
	pmp = pmp % 360.0
	if pmp >= 270.0:
		return pmp - 270.0, 1
	if pmp < 90.0:
		return 90.0 - pmp, 2
	if pmp < 180.0:
		return pmp - 90.0, 3
	return 270.0 - pmp, 4


def _pmp_aspect(pmp_t, pmp_r, orb_conj, orb_antiscia):
	"""Detect AT aspect between two PMPs and return (aspect, orb_arcmin)
	or (None, None). Conjunction > Opposition > Antiscia in priority — at
	the angles (PMP 0/90/180/270) more than one condition can be satisfied
	simultaneously, and the user expects the closer-knit aspect."""
	# Conjunction
	d = abs(pmp_t - pmp_r) % 360.0
	if d > 180.0:
		d = 360.0 - d
	if d * 60.0 <= orb_conj:
		return CONJUNCTION, d * 60.0
	# Opposition
	od = abs(d - 180.0)
	if od * 60.0 <= orb_conj:
		return OPPOSITION, od * 60.0
	# Antiscia: PMP_T + PMP_R ≡ 0 or 180 (mod 360). The smaller residual
	# wins (mirror across whichever cardinal axis is closer).
	s_mod = (pmp_t + pmp_r) % 360.0
	a1 = min(s_mod, 360.0 - s_mod)        # distance to 0 (Asc / Desc-mirror)
	a2 = abs(s_mod - 180.0)               # distance to 180 (MC / IC-mirror)
	a = min(a1, a2)
	if a * 60.0 <= orb_antiscia:
		return ANTISCIA, a * 60.0
	return None, None


def _aspect_for(q_t, q_r):
	"""Return the AT aspect type for a (transit quadrant, radix quadrant)
	pair, or None if no AT aspect applies. (Kept for backward compatibility;
	`_pmp_aspect` is the working detector since it handles the angle
	boundaries correctly.)"""
	if q_t == q_r:
		return CONJUNCTION
	if (q_t, q_r) in ((1, 3), (3, 1), (2, 4), (4, 2)):
		return OPPOSITION
	if (q_t, q_r) in ((1, 2), (2, 1), (2, 3), (3, 2),
	                  (3, 4), (4, 3), (4, 1), (1, 4)):
		return ANTISCIA
	return None


# ---------------------------------------------------------------------------
# Marr/Estadella precession + Delta-T correction.
# ---------------------------------------------------------------------------
#
# The radix planet RAs are stored against the natal-epoch vernal equinox; the
# event-time RAMC against the event-epoch equinox.  Because the equinox itself
# precesses (~50.3"/yr), the two RAs live in slightly different reference
# frames — direct subtraction MD = |RA_radix - RAMC_event| accumulates a
# drift of ~50' per 60 years of age.  Marr Ch 11 / Estadella Ch 13 require
# adjusting the event RAMC by:
#
#     correction = precession_arcmin  -  (dt_event - dt_radix)_seconds / 4
#
# (1' of arc = 4 seconds of time; ratio = RAMC's 1°/4-min advance.)
# Direct ATs ADD the correction; prenatal ATs SUBTRACT. For a middle-aged
# native the precession piece is ~32', the dT piece is ~6', net +26'.
# Sign of dt_diff/4 is subtracted because Universal Time runs faster than
# Ephemeris Time (positive dt = ET ahead of UT, so the apparent meridian has
# moved slightly *less* than the precession suggests).

_PRECESSION_ARCSEC_PER_YEAR = 50.290966  # IAU 2006

# Default search window for `find_next_at_event_jd` — covers a few hours of
# sky rotation in either direction, well past the typical density of AT
# conjunctions / oppositions (most planets see several events per day).
_AT_EVENT_SEARCH_MINUTES = 360
_AT_EVENT_THRESHOLD_ARCMIN = 25.0   # max orb we consider a "hit"


def precession_dt_correction_arcmin(radix_jd, event_jd, direction='direct'):
	"""Return the Marr/Estadella event-RAMC correction in arcminutes.

	direction='direct'   -> value should be ADDED to event_ramc
	direction='prenatal' -> value should be SUBTRACTED
	(callers handle the sign themselves; we return a signed amount that
	is positive when event is after radix.)
	"""
	years = (event_jd - radix_jd) / 365.25
	precession_arcmin = years * _PRECESSION_ARCSEC_PER_YEAR / 60.0
	try:
		dt_radix_sec = astrology.swe_deltat(radix_jd) * 86400.0
		dt_event_sec = astrology.swe_deltat(event_jd) * 86400.0
	except Exception:
		dt_radix_sec = dt_event_sec = 0.0
	dt_correction_arcmin = (dt_event_sec - dt_radix_sec) / 4.0
	value = precession_arcmin - dt_correction_arcmin
	if direction == 'prenatal':
		value = -value
	return value


# ---------------------------------------------------------------------------
# Two-transit gate: ecliptic-aspect check at the event moment.
# ---------------------------------------------------------------------------

def _ecliptic_orb_for(planet_id):
	if planet_id in _FAST_PLANETS:
		return ECLIPTIC_ORB_FAST_ARCMIN
	return ECLIPTIC_ORB_SLOW_ARCMIN


def _ecliptic_aspect_residual(lon_a, lon_b):
	"""Smallest residual (arcmin) between |lon_a - lon_b| and the nearest
	multiple of 15°.  Returns (residual_arcmin, aspect_deg).
	"""
	diff = (lon_a - lon_b) % 360.0
	if diff > 180.0:
		diff = 360.0 - diff
	best_res = float('inf')
	best_asp = 0.0
	for asp in _ECLIPTIC_ASPECT_ANGLES:
		res = abs(diff - asp)
		if res < best_res:
			best_res = res
			best_asp = asp
	# Conjunction is the special case -- handle the 0° aspect separately.
	if diff < best_res:
		best_res = diff
		best_asp = 0.0
	return best_res * 60.0, best_asp


def find_active_ecliptic_aspects(radix_chart, transit_planet_data):
	"""Return list of (transit_planet_id, radix_planet_id, aspect_deg,
	orb_arcmin) where a tight ecliptic aspect between the transit chart
	and the radix exists at the event moment.

	radix_chart is a regular Aries chart.Chart for the natal.
	transit_planet_data is a list of (planet_id, ecliptic_longitude) for
	the live planets at the event moment.
	"""
	hits = []
	for tp_id, tp_lon in transit_planet_data:
		orb = _ecliptic_orb_for(tp_id)
		for rp_id, rp_lon in _radix_ecliptic_lons(radix_chart):
			residual, asp = _ecliptic_aspect_residual(tp_lon, rp_lon)
			if residual <= orb:
				hits.append((tp_id, rp_id, asp, residual))
	return hits


# ---------------------------------------------------------------------------
# Snapshot.
# ---------------------------------------------------------------------------

class ATSnapshot:
	"""All ascensional transits at a single (event_jd, event_place).

	After construction, attributes:
		event_jd           Julian date in UT.
		event_place        chart.Place at which the event observer stands.
		event_ramc         RAMC of the event moment at the event place (degrees).
		obl                obliquity (degrees) used.
		radix_points       list of MDOPoint for natal planets / cusps / LoF.
		transit_points     list of MDOPoint for current ephemeris planets.
		at_pairs           list of ATPair (only those within orb).
		active_ecliptic    list of (transit_id, radix_id, asp, orb_arcmin)
		                   present at this moment.  Empty => "trivial" by
		                   Estadella's two-transit rule.
	"""

	def __init__(self, radix_chart, event_jd, event_place,
	             swiss_flags=None, include_parallels=True,
	             apply_precession=True, direction='direct'):
		self.radix = radix_chart
		self.event_jd = float(event_jd)
		self.event_place = event_place
		self.direction = direction

		if swiss_flags is None:
			swiss_flags = astrology.SEFLG_SPEED | astrology.SEFLG_SWIEPH
			if getattr(radix_chart.options, 'topocentric', False):
				swiss_flags |= astrology.SEFLG_TOPOCTR
		self.flags = swiss_flags

		# 1. Obliquity at event JD.
		dt_corr = astrology.swe_deltat(self.event_jd)
		serr, eps_pack = astrology.swe_calc(
			self.event_jd + dt_corr, astrology.SE_ECL_NUT, 0,
		)
		self.obl = eps_pack[0]

		# 2. Event RAMC at event place.
		astrology.swe_set_topo(event_place.lon, event_place.lat, event_place.altitude)
		# We just need the houses for their ARMC -- the house *system* is
		# irrelevant to ascensional transit math (which depends only on
		# RAMC and equatorial coords), but we use Polich/Page 'T' to be
		# faithful when the user pairs ATs with topocentric houses.
		hsys = getattr(radix_chart.options, 'hsys', 'T') or 'T'
		evt_houses = _houses.Houses(
			self.event_jd, 0, event_place.lat, event_place.lon,
			hsys, self.obl, 0, 0,
		)
		self.event_ramc_uncorrected = evt_houses.ascmc2[_houses.Houses.MC][_houses.Houses.RA]
		self._evt_houses = evt_houses

		# 2a. Apply Marr/Estadella precession + Delta-T correction to the
		# event meridian before event-time transit MDOs are compared with
		# the fixed radix MDO table. Without this, AT orbs drift ~50' per
		# 60 years of age.
		if apply_precession:
			try:
				radix_jd = float(radix_chart.time.jd)
			except Exception:
				radix_jd = self.event_jd
			self.precession_correction_arcmin = precession_dt_correction_arcmin(
				radix_jd, self.event_jd, direction=direction,
			)
		else:
			self.precession_correction_arcmin = 0.0
		self.event_ramc = (
			self.event_ramc_uncorrected
			+ self.precession_correction_arcmin / 60.0
		) % 360.0

		# 3. Build radix points (planets + cusps + LoF) in the fixed radix
		# MDO frame. Marr, Prediction II ch. 11 prints a "RADIX - MDO'S"
		# table and then compares event transiting MDOs against that table;
		# the radical factors are not re-housed against every event RAMC.
		self.radix_points = self._build_radix_points()

		# 4. Build transit points (current ephemeris planets).
		self.transit_points = self._build_transit_points()

		# 5. Detect AT pairs (MDO conj / opp / antiscia).
		self.at_pairs = self._detect_at_pairs()

		# 6. Optional declination parallels / contra-parallels.
		if include_parallels:
			self.at_pairs.extend(self._detect_parallels())

		# 7. Two-transit-rule data: any tight ecliptic aspects present?
		transit_lons = [
			(p.idx, p.lon) for p in self.transit_points
			if p.kind == 'planet' and p.lon is not None
		]
		self.active_ecliptic = find_active_ecliptic_aspects(
			self.radix, transit_lons,
		)
		self.is_active_moment = bool(self.active_ecliptic)

	# -- builders -----------------------------------------------------------

	def _build_radix_points(self):
		pts = []
		# Planets (drop the two node entries at the tail to match transits.py);
		# Chiron enters through the chart-side dynamic body path, not by
		# widening the legacy planets.Planets matrix.
		for pid in _radix_planet_point_ids(self.radix):
			pl = _radix_body(self.radix, pid)
			if pl is None:
				continue
			ra = pl.dataEqu[planets.Planet.RAEQU]
			decl = pl.dataEqu[planets.Planet.DECLEQU]
			try:
				pmp = pl.speculums[_chart.Chart.PLACIDIAN][planets.Planet.PMP]
				mdo, q = _mdo_q_from_pmp(pmp)
			except Exception:
				continue
			pts.append(MDOPoint(
				kind='planet', idx=pid, label=_planet_label(pid),
				ra=ra, decl=decl,
				lon=pl.data[planets.Planet.LONG],
				lat=pl.data[planets.Planet.LAT],
				mdo=mdo, quadrant=q, above_horizon=(q in (1, 4)),
				fixed_in_frame=True,
			))

		# Nodes: the ephemeris gives the north node; the south node is always
		# the exact opposition in the same MDO/PMP frame.
		try:
			node_idx = astrology.SE_MEAN_NODE
			node_pl = self.radix.planets.planets[node_idx]
			ra = node_pl.dataEqu[planets.Planet.RAEQU]
			decl = node_pl.dataEqu[planets.Planet.DECLEQU]
			pmp = node_pl.speculums[_chart.Chart.PLACIDIAN][planets.Planet.PMP]
			mdo, q = _mdo_q_from_pmp(pmp)
			north = MDOPoint(
				kind='node', idx=node_idx,
				label=mtexts.txts.get('NorthNode', 'North Node'),
				ra=ra, decl=decl,
				lon=node_pl.data[planets.Planet.LONG],
				lat=node_pl.data[planets.Planet.LAT],
				mdo=mdo, quadrant=q, above_horizon=(q in (1, 4)),
				fixed_in_frame=True,
			)
			pts.append(north)
			pts.append(_south_node_from_north(north))
		except Exception:
			pass

		# Lot of Fortune.
		try:
			lof = self.radix.fortune.fortune
			ra = lof[fortune.Fortune.RA]
			decl = lof[fortune.Fortune.DECL]
			pmp = self.radix.fortune.speculum.speculum[
				placspec.PlacidianSpeculum.PMP
			]
			mdo, q = _mdo_q_from_pmp(pmp)
			pts.append(MDOPoint(
				kind='lof', idx=0, label=mtexts.txts.get('LoFAbbrev', 'LoF'),
				ra=ra, decl=decl,
				lon=lof[fortune.Fortune.LON],
				lat=lof[fortune.Fortune.LAT],
				mdo=mdo, quadrant=q, above_horizon=(q in (1, 4)),
				fixed_in_frame=True,
			))
		except Exception:
			pass

		# Radix house cusps: frame-relative, MDO+quadrant fixed by
		# definition.  Per Estadella ch. 13.  These are static under any
		# event RAMC.
		for cusp_idx, (mdo, q) in _CUSP_MDO_Q.items():
			pts.append(MDOPoint(
				kind='cusp', idx=cusp_idx,
				label='%d %s' % (cusp_idx, mtexts.txts.get('Cusp', 'cusp')),
				ra=None, decl=None,
				lon=self.radix.houses.cusps[cusp_idx],
				lat=None,
				mdo=mdo, quadrant=q, above_horizon=(q in (1, 4)),
				fixed_in_frame=True,
			))
		return pts

	def _build_transit_points(self):
		pts = []
		for pid in _transit_planet_point_ids(self.radix):
			p = planets.Planet(self.event_jd, pid, self.flags)
			ra = p.dataEqu[planets.Planet.RAEQU]
			decl = p.dataEqu[planets.Planet.DECLEQU]
			mdo, q, above = compute_mdo(
				ra, decl, self.event_ramc, self.event_place.lat,
			)
			if mdo is None:
				continue
			pts.append(MDOPoint(
				kind='planet', idx=pid, label=_planet_label(pid),
				ra=ra, decl=decl,
				lon=p.data[planets.Planet.LONG],
				lat=p.data[planets.Planet.LAT],
				mdo=mdo, quadrant=q, above_horizon=above,
				fixed_in_frame=False,
			))
		try:
			node_idx = astrology.SE_MEAN_NODE
			p = planets.Planet(self.event_jd, node_idx, self.flags)
			ra = p.dataEqu[planets.Planet.RAEQU]
			decl = p.dataEqu[planets.Planet.DECLEQU]
			mdo, q, above = compute_mdo(
				ra, decl, self.event_ramc, self.event_place.lat,
			)
			if mdo is not None:
				north = MDOPoint(
					kind='node', idx=node_idx,
					label=mtexts.txts.get('NorthNode', 'North Node'),
					ra=ra, decl=decl,
					lon=p.data[planets.Planet.LONG],
					lat=p.data[planets.Planet.LAT],
					mdo=mdo, quadrant=q, above_horizon=above,
					fixed_in_frame=False,
				)
				pts.append(north)
				pts.append(_south_node_from_north(north))
		except Exception:
			pass
		return pts

	# -- AT detection -------------------------------------------------------

	def _detect_at_pairs(self):
		pairs = []
		for t in self.transit_points:
			pmp_t = _pmp_from_mdo_q(t.mdo, t.quadrant)
			for r in self.radix_points:
				# Skip transit-planet vs radix-same-planet — that's the
				# obvious daily diurnal return; noise for AT analysis.
				if (t.kind == 'planet' and r.kind == 'planet'
				    and t.idx == r.idx):
					continue
				pmp_r = _pmp_from_mdo_q(r.mdo, r.quadrant)
				asp, orb_arcmin = _pmp_aspect(
					pmp_t, pmp_r,
					orb_conj=ORB_CONJ_OPP_ARCMIN,
					orb_antiscia=ORB_ANTISCIA_ARCMIN,
				)
				if asp is None:
					continue
				pairs.append(ATPair(t, r, asp, orb_arcmin))
		return pairs

	def _detect_parallels(self):
		"""Same true declination -> parallel; opposite -> contraparallel."""
		out = []
		for t in self.transit_points:
			if t.decl is None:
				continue
			for r in self.radix_points:
				if r.kind not in ('planet', 'lof', 'node') or r.decl is None:
					continue
				if t.kind == 'planet' and r.kind == 'planet' and t.idx == r.idx:
					continue
				par = abs(t.decl - r.decl) * 60.0
				contrapar = abs(t.decl + r.decl) * 60.0
				if par <= ORB_PARALLEL_ARCMIN:
					out.append(ATPair(t, r, PARALLEL, par))
				elif contrapar <= ORB_PARALLEL_ARCMIN:
					out.append(ATPair(t, r, CONTRAPARALLEL, contrapar))
		return out


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------

_PLANET_NAMES = ('Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
                 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto')

def _planet_label(pid):
	# User-facing body name, resolved through mtexts at serve time so it
	# renders in the active language. Identity (English) is _PLANET_NAMES /
	# the ids below; only the display boundary is tokenized.
	if 0 <= pid < len(_PLANET_NAMES):
		eng = _PLANET_NAMES[pid]
		return mtexts.txts.get(eng, eng)
	if pid == astrology.SE_CHIRON:
		return mtexts.txts.get('Chiron', 'Chiron')
	if pid == astrology.SE_MEAN_NODE:
		return mtexts.txts.get('NorthNode', 'North Node')
	if pid == astrology.SE_TRUE_NODE:
		return mtexts.txts.get('SouthNode', 'South Node')
	return 'P%d' % pid


def quadrant_pair_kind(q1, q2):
	"""Public helper: how do two quadrants relate? (Used by renderers
	to colour AT lines.)"""
	return _aspect_for(q1, q2)


# ---------------------------------------------------------------------------
# Snap-to-event navigation (Up / Down arrows in the AT view).
# ---------------------------------------------------------------------------

def find_next_at_event_jd(radix_chart, current_jd, event_place,
                          direction='forward',
                          max_minutes=_AT_EVENT_SEARCH_MINUTES,
                          threshold_arcmin=_AT_EVENT_THRESHOLD_ARCMIN,
                          apply_precession=True):
	"""Find the JD of the next/prev local minimum of any (transit, radix)
	pair's AT-orb where the minimum lies under threshold_arcmin.

	Returns a dict {jd, transit_label, radix_label, aspect, orb_arcmin}
	on success, None if no event found within the search window.

	Implementation: brute-force minute-by-minute scan tracking each pair's
	orb history and reporting the first detected local minimum (orb
	decreased two ticks in a row then increased).  Cost per scan tick is
	one ATSnapshot construction (~5-10 ms on contemporary hardware);
	at the default 360-minute window the entire scan completes in well
	under a second.  Conjunction and opposition only — antiscia and
	parallel are excluded as they are not the "exact transit time"
	contacts the user is chasing.
	"""
	if max_minutes <= 0:
		return None
	step_sign = 1 if direction != 'backward' else -1
	# Track the last two orb values seen per pair to detect a local min.
	pair_history = {}    # key → [n-2, n-1]
	pair_record = {}     # key → (transit_label, radix_label)
	last_seen_jd = current_jd

	for minute in range(1, int(max_minutes) + 1):
		candidate_jd = current_jd + step_sign * minute / (60.0 * 24.0)
		try:
			snap = ATSnapshot(
				radix_chart, candidate_jd, event_place,
				include_parallels=False,
				apply_precession=apply_precession,
			)
		except Exception:
			continue

		seen_keys = set()
		for at in snap.at_pairs:
			if at.aspect not in (CONJUNCTION, OPPOSITION):
				continue
			# Build a stable key — transit planet idx + radix kind/idx + aspect.
			key = (at.transit.idx, at.radix.kind, at.radix.idx, at.aspect)
			seen_keys.add(key)
			history = pair_history.get(key, [])
			pair_record[key] = (at.transit.label, at.radix.label)
			if len(history) >= 2:
				prev_prev, prev = history
				curr = at.orb_arcmin
				if (prev <= prev_prev and prev < curr
				    and prev < threshold_arcmin):
					# Local minimum near minute-1; refine to 1s precision.
					centre_jd = (current_jd
					             + step_sign * (minute - 1) / (60.0 * 24.0))
					exact_jd, exact_orb = _refine_at_event_jd(
						radix_chart, centre_jd, event_place,
						transit_idx=at.transit.idx,
						radix_kind=at.radix.kind,
						radix_idx=at.radix.idx,
						aspect=at.aspect,
						apply_precession=apply_precession,
					)
					return {
						'jd': exact_jd,
						'transit_label': at.transit.label,
						'radix_label': at.radix.label,
						'aspect': at.aspect,
						'orb_arcmin': exact_orb,
					}
				history = [prev, at.orb_arcmin]
			else:
				history.append(at.orb_arcmin)
			pair_history[key] = history

		# Drop any pair that wasn't in orb this tick — its history resets.
		for stale_key in [k for k in pair_history if k not in seen_keys]:
			pair_history.pop(stale_key, None)

		last_seen_jd = candidate_jd

	return None


def _refine_at_event_jd(radix_chart, centre_jd, event_place,
                        transit_idx, radix_kind, radix_idx, aspect,
                        apply_precession=True,
                        half_window_seconds=60):
	"""Refine a single AT event's exact time to ~1-second precision around
	an approximate centre. Scans ±half_window_seconds at 1-second steps
	for the named pair's orb minimum, ignoring all other pairs.  Returns
	(best_jd, best_orb_arcmin)."""
	best_jd = centre_jd
	best_orb = float('inf')
	one_sec_jd = 1.0 / 86400.0
	for offset in range(-half_window_seconds, half_window_seconds + 1):
		candidate_jd = centre_jd + offset * one_sec_jd
		try:
			snap = ATSnapshot(
				radix_chart, candidate_jd, event_place,
				include_parallels=False,
				apply_precession=apply_precession,
			)
		except Exception:
			continue
		for at in snap.at_pairs:
			if (at.transit.idx == transit_idx
			    and at.radix.kind == radix_kind
			    and at.radix.idx == radix_idx
			    and at.aspect == aspect):
				if at.orb_arcmin < best_orb:
					best_orb = at.orb_arcmin
					best_jd = candidate_jd
				break
	return best_jd, best_orb if best_orb != float('inf') else 0.0
