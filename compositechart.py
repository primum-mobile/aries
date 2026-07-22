# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import math

import antzodpars
import astrology
import chart
import customerpd
import default_location as default_location_model
import firdaria
import houses
import localcities
import mtexts
import munfortune
import planets
import util
import zodpars
from engine import calendar_policy


def _midpoint_angle(lon1, lon2):
	lon1 = util.normalize(lon1)
	lon2 = util.normalize(lon2)
	diff = math.fabs(lon1 - lon2)
	if diff <= 180.0:
		return util.normalize(min(lon1, lon2) + diff / 2.0)
	diff = 360.0 - diff
	return util.normalize(max(lon1, lon2) + diff / 2.0)


def _spherical_midpoint(lon1, lat1, lon2, lat2):
	rlon1 = math.radians(util.normalize(lon1))
	rlat1 = math.radians(lat1)
	rlon2 = math.radians(util.normalize(lon2))
	rlat2 = math.radians(lat2)

	x = math.cos(rlat1) * math.cos(rlon1) + math.cos(rlat2) * math.cos(rlon2)
	y = math.cos(rlat1) * math.sin(rlon1) + math.cos(rlat2) * math.sin(rlon2)
	z = math.sin(rlat1) + math.sin(rlat2)

	hyp = math.hypot(x, y)
	if hyp < 1e-12 and math.fabs(z) < 1e-12:
		return _midpoint_angle(lon1, lon2), (lat1 + lat2) / 2.0

	return util.normalize(math.degrees(math.atan2(y, x))), math.degrees(math.atan2(z, hyp))


def _mean(value1, value2):
	return (float(value1) + float(value2)) / 2.0


def _lon_for_cotrans(lon, ayanamsha_offset=0.0):
	return util.to_tropical_lon(lon, ayanamsha_offset)


def _signed_longitude(lon):
	lon = util.normalize(lon)
	if lon > 180.0:
		lon -= 360.0
	return lon


def _build_composite_place(chrt1, chrt2):
	lon, lat = _spherical_midpoint(chrt1.place.lon, chrt1.place.lat, chrt2.place.lon, chrt2.place.lat)
	lon = _signed_longitude(lon)
	east = lon >= 0.0
	north = lat >= 0.0
	deglon, minlon, seclon = util.decToDeg(lon)
	deglat, minlat, seclat = util.decToDeg(lat)
	altitude = int(round(_mean(chrt1.place.altitude, chrt2.place.altitude)))
	return chart.Place(mtexts.txts.get('Composite', 'Composite'), deglon, minlon, seclon, east, deglat, minlat, seclat, north, altitude)


def _build_davison_place(chrt1, chrt2):
	lon = _signed_longitude(_midpoint_angle(chrt1.place.lon, chrt2.place.lon))
	lat = _mean(chrt1.place.lat, chrt2.place.lat)
	east = lon >= 0.0
	north = lat >= 0.0
	deglon, minlon, seclon = util.decToDeg(lon)
	deglat, minlat, seclat = util.decToDeg(lat)
	altitude = int(round(_mean(chrt1.place.altitude, chrt2.place.altitude)))
	place_name = mtexts.txts.get('Composite', 'Composite')
	nearest = localcities.nearest(lon, lat)
	if nearest is not None:
		label = localcities.chart_label(nearest).strip()
		if label:
			place_name = label
	return chart.Place(place_name, deglon, minlon, seclon, east, deglat, minlat, seclat, north, altitude)


def _build_composite_time(chrt1, chrt2, place):
	jd = _mean(chrt1.time.jd, chrt2.time.jd)
	cal = (
		chart.Time.GREGORIAN
		if calendar_policy.calendar_for_jd(jd) == calendar_policy.CALENDAR_GREGORIAN
		else chart.Time.JULIAN
	)
	calflag = astrology.SE_GREG_CAL
	if cal == chart.Time.JULIAN:
		calflag = astrology.SE_JUL_CAL

	year, month, day, hour_float = astrology.swe_revjul(jd, calflag)
	hour = int(hour_float)
	minute_float = (hour_float - hour) * 60.0
	minute = int(minute_float)
	second = int(round((minute_float - minute) * 60.0))

	if second >= 60:
		second = 0
		minute += 1
	if minute >= 60:
		minute = 0
		hour += 1
	if hour >= 24:
		hour = 0
		year, month, day = util.incrDay(year, month, day)

	bc = year <= 0
	if bc:
		year = 1 - year

	return chart.Time(
		int(year), int(month), int(day), int(hour), int(minute), int(second),
		bc, cal, chart.Time.GREENWICH, True, 0, 0, False, place,
		tzid='', tzauto=False,
	)


def _apply_composite_houses(target, first, second, geolat, ayanamsha_offset=0.0):
	cusps = [0.0]
	for idx in range(1, houses.Houses.HOUSE_NUM + 1):
		cusps.append(_midpoint_angle(first.cusps[idx], second.cusps[idx]))
	target.cusps = tuple(cusps)

	ascmc = []
	count = min(len(target.ascmc), len(first.ascmc), len(second.ascmc))
	for idx in range(count):
		ascmc.append(_midpoint_angle(first.ascmc[idx], second.ascmc[idx]))
	target.ascmc = tuple(ascmc)

	ascra, ascdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.ascmc[houses.Houses.ASC], ayanamsha_offset), 0.0, 1.0, -target.obl)
	mcra, mcdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.ascmc[houses.Houses.MC], ayanamsha_offset), 0.0, 1.0, -target.obl)
	target.ascmc2 = (
		(target.ascmc[houses.Houses.ASC], 0.0, ascra, ascdecl),
		(target.ascmc[houses.Houses.MC], 0.0, mcra, mcdecl),
	)

	qasc = 0.0
	val = math.tan(math.radians(ascdecl)) * math.tan(math.radians(geolat))
	if math.fabs(val) <= 1.0:
		qasc = math.degrees(math.asin(val))
	target.regioMPAsc = ascra - qasc
	target.regioMPMC = mcra

	cuspstmp = []
	for idx in range(houses.Houses.HOUSE_NUM):
		ra, decl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.cusps[idx + 1], ayanamsha_offset), 0.0, dist, -target.obl)
		cuspstmp.append([ra, decl])
	target.cuspstmp = cuspstmp
	target.cusps2 = tuple((entry[0], entry[1]) for entry in cuspstmp)


def _midpoint_body_data(body1, body2, obl, nolat, ayanamsha_offset=0.0):
	lon = _midpoint_angle(
		body1.data[planets.Planet.LONG],
		body2.data[planets.Planet.LONG],
	)
	lat = _mean(
		body1.data[planets.Planet.LAT],
		body2.data[planets.Planet.LAT],
	)
	if nolat:
		lat = 0.0
	ra, decl, _ = astrology.swe_cotrans(_lon_for_cotrans(lon, ayanamsha_offset), lat, 1.0, -obl)
	# Explicit float() conversion to ensure independent Python objects
	data = (
		float(lon),
		float(lat),
		float(_mean(body1.data[planets.Planet.DIST], body2.data[planets.Planet.DIST])),
		float(_mean(body1.data[planets.Planet.SPLON], body2.data[planets.Planet.SPLON])),
		float(_mean(body1.data[planets.Planet.SPLAT], body2.data[planets.Planet.SPLAT])),
		float(_mean(body1.data[planets.Planet.SPDIST], body2.data[planets.Planet.SPDIST])),
	)
	dataEqu = (
		float(ra),
		float(decl),
		float(_mean(body1.dataEqu[planets.Planet.DISTEQU], body2.dataEqu[planets.Planet.DISTEQU])),
		float(_mean(body1.dataEqu[planets.Planet.SPRAEQU], body2.dataEqu[planets.Planet.SPRAEQU])),
		float(_mean(body1.dataEqu[planets.Planet.SPDECLEQU], body2.dataEqu[planets.Planet.SPDECLEQU])),
		float(_mean(body1.dataEqu[planets.Planet.SPDISTEQU], body2.dataEqu[planets.Planet.SPDISTEQU])),
	)
	return data, dataEqu


def _apply_composite_body(target, body1, body2, placelat, ascmc2, raequasc, obl, nolat=False, ayanamsha_offset=0.0):
	data, dataEqu = _midpoint_body_data(body1, body2, obl, nolat, ayanamsha_offset)
	target.data = data
	target.dataEqu = dataEqu
	target.speculums = []
	target.computePlacidianSpeculum(placelat, ascmc2)
	target.computeRegiomontanSpeculum(placelat, ascmc2, raequasc)


def _rebuild_custom_pd_points(comp):
	comp.cpd = None
	comp.cpd2 = None
	if comp.options.pdcustomer:
		comp.cpd = customerpd.CustomerPD(
			comp.options.pdcustomerlon[0], comp.options.pdcustomerlon[1], comp.options.pdcustomerlon[2],
			comp.options.pdcustomerlat[0], comp.options.pdcustomerlat[1], comp.options.pdcustomerlat[2],
			comp.options.pdcustomersouthern, comp.place.lat, comp.houses.ascmc2, comp.obl[0], comp.raequasc, comp.ayanamsha_offset,
		)
	if comp.options.pdcustomer2:
		comp.cpd2 = customerpd.CustomerPD(
			comp.options.pdcustomer2lon[0], comp.options.pdcustomer2lon[1], comp.options.pdcustomer2lon[2],
			comp.options.pdcustomer2lat[0], comp.options.pdcustomer2lat[1], comp.options.pdcustomer2lat[2],
			comp.options.pdcustomer2southern, comp.place.lat, comp.houses.ascmc2, comp.obl[0], comp.raequasc, comp.ayanamsha_offset,
		)
	try:
		comp.pd_arabic_part_prom = comp._get_pd_arabic_part_promissor_point()
		comp.pd_arabic_part_sig = comp._get_pd_arabic_part_significator_point()
	except Exception:
		comp.pd_arabic_part_prom = None
		comp.pd_arabic_part_sig = None


def _apply_midpoint_vertex(target, first, second):
	ascmc = list(target.houses.ascmc)
	if len(ascmc) > houses.Houses.VERTEX:
		ascmc[houses.Houses.VERTEX] = _short_arc_midpoint(
			first.houses.ascmc[houses.Houses.VERTEX],
			second.houses.ascmc[houses.Houses.VERTEX],
		)
	target.houses.ascmc = tuple(ascmc)


def _apply_midpoint_fortune(target, first, second):
	lon = _short_arc_midpoint(
		first.fortune.fortune[munfortune.MundaneFortune.LON],
		second.fortune.fortune[munfortune.MundaneFortune.LON],
	)
	lat = _mean(
		first.fortune.fortune[munfortune.MundaneFortune.LAT],
		second.fortune.fortune[munfortune.MundaneFortune.LAT],
	)
	ra, decl, _dist = astrology.swe_cotrans(_lon_for_cotrans(lon, target.ayanamsha_offset), lat, 1.0, -target.obl[0])
	target.fortune.recalcForMundaneChart(
		lon,
		lat,
		ra,
		decl,
		target.houses.ascmc2,
		target.raequasc,
		target.obl[0],
		target.place.lat,
	)


def _materialize_full_chart_state(comp, abovehor=None):
	if abovehor is None:
		abovehor = comp.planets.planets[astrology.SE_SUN].abovehorizon
		if comp.options.usedaynightorb:
			abovehor = comp.abovehorizonwithorb

	comp.firdaria = firdaria.Firdaria(
		comp.time.origyear,
		comp.time.origmonth,
		comp.time.origday,
		comp.options,
		comp.abovehorizonwithorb,
	)
	comp.munfortune = munfortune.MundaneFortune(
		comp.options.lotoffortune,
		comp.houses.ascmc2,
		comp.planets,
		comp.obl[0],
		comp.place.lat,
		abovehor,
	)
	comp.calcSyzygy()
	comp.calcArabicParts()
	comp.rebuildFixStars()
	comp.calcMidPoints()
	comp.rebuildRiseSet()
	comp.zodpars = zodpars.ZodPars(comp.planets, comp.obl[0])
	comp.calcAntiscia()
	comp.antzodpars = antzodpars.AntZodPars(comp.antiscia.plantiscia, comp.antiscia.plcontraant, comp.obl[0])
	comp.recalcAlmutens()
	_rebuild_custom_pd_points(comp)


def _apply_composite_angles(target, first, second, asc_lon, mc_lon, geolat, obl, ayanamsha_offset=0.0):
	"""Apply calculated ASC and MC to composite houses, with proportional cusps."""
	# Calculate IC and DSC
	ic_lon = util.normalize(mc_lon + 180.0)
	dsc_lon = util.normalize(asc_lon + 180.0)
	
	# Build cusps array - calculate proportional cusps based on original charts
	cusps = [0.0]
	
	# Get original angles for proportional calculation
	orig_asc1 = first.ascmc[houses.Houses.ASC]
	orig_mc1 = first.ascmc[houses.Houses.MC]
	orig_asc2 = second.ascmc[houses.Houses.ASC]
	orig_mc2 = second.ascmc[houses.Houses.MC]
	
	for idx in range(1, houses.Houses.HOUSE_NUM + 1):
		# Calculate relative position of cusp in first chart (from ASC)
		rel1 = util.normalize(first.cusps[idx] - orig_asc1)
		if rel1 > 180.0:
			rel1 -= 360.0
		
		# Calculate relative position of cusp in second chart (from ASC)
		rel2 = util.normalize(second.cusps[idx] - orig_asc2)
		if rel2 > 180.0:
			rel2 -= 360.0
		
		# Use short-arc midpoint of relative positions
		rel_mid = _short_arc_midpoint(rel1, rel2)
		if rel_mid > 180.0:
			rel_mid -= 360.0
		
		# Apply to new composite ASC
		cusp_lon = util.normalize(asc_lon + rel_mid)
		cusps.append(cusp_lon)
	
	target.cusps = tuple(cusps)
	
	# Build ascmc tuple
	ascmc = list(target.ascmc)
	while len(ascmc) < max(houses.Houses.ASC, houses.Houses.MC) + 1:
		ascmc.append(0.0)
	ascmc[houses.Houses.ASC] = asc_lon
	ascmc[houses.Houses.MC] = mc_lon
	target.ascmc = tuple(ascmc)
	
	# Calculate ascmc2 (equatorial coordinates)
	ascra, ascdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(asc_lon, ayanamsha_offset), 0.0, 1.0, -obl)
	mcra, mcdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(mc_lon, ayanamsha_offset), 0.0, 1.0, -obl)
	target.ascmc2 = (
		(asc_lon, 0.0, ascra, ascdecl),
		(mc_lon, 0.0, mcra, mcdecl),
	)
	
	# Calculate regioMP values
	qasc = 0.0
	val = math.tan(math.radians(ascdecl)) * math.tan(math.radians(geolat))
	if math.fabs(val) <= 1.0:
		qasc = math.degrees(math.asin(val))
	target.regioMPAsc = ascra - qasc
	target.regioMPMC = mcra
	
	# Calculate cuspstmp and cusps2
	cuspstmp = []
	for idx in range(houses.Houses.HOUSE_NUM):
		ra, decl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.cusps[idx + 1], ayanamsha_offset), 0.0, dist, -obl)
		cuspstmp.append([ra, decl])
	target.cuspstmp = cuspstmp
	target.cusps2 = tuple((entry[0], entry[1]) for entry in cuspstmp)


def _calculate_asc_from_mc(mc_lon, place_lat, obl, hsys='P', ayanamsha_offset=0.0):
	"""Calculate ASC from MC using trigonometric relationship.
	
	Given MC longitude, place latitude, and obliquity,
	calculate the corresponding ASC using the formula:
	tan(ASC) = sin(MC) / (cos(MC)*cos(obl) + sin(obl)*tan(lat))
	"""
	# Convert to radians
	mc_rad = math.radians(_lon_for_cotrans(mc_lon, ayanamsha_offset))
	lat_rad = math.radians(place_lat)
	obl_rad = math.radians(obl)
	
	# Calculate ASC using the trigonometric formula
	# tan(ASC) = sin(MC) / (cos(MC)*cos(obl) + sin(obl)*tan(lat))
	denominator = math.cos(mc_rad) * math.cos(obl_rad) + math.sin(obl_rad) * math.tan(lat_rad)
	
	if abs(denominator) < 1e-12:
		# Handle edge case where denominator is near zero
		asc_lon = 0.0 if math.sin(mc_rad) >= 0 else 180.0
	else:
		asc_tan = math.sin(mc_rad) / denominator
		asc_rad = math.atan(asc_tan)
		asc_lon = math.degrees(asc_rad)
	
	# Normalize ASC
	asc_lon = util.normalize(asc_lon - float(ayanamsha_offset or 0.0))
	
	return asc_lon


def _apply_derived_houses_from_mc(target, first, second, place, obl, hsys, ayanamsha_offset=0.0):
	"""Apply composite houses where MC is midpoint but ASC is derived from place."""
	import copy
	
	# MC is circular midpoint
	mc_lon = _midpoint_angle(first.ascmc[houses.Houses.MC], second.ascmc[houses.Houses.MC])
	
	# Calculate ASC from MC + place
	asc_lon = _calculate_asc_from_mc(mc_lon, place.lat, obl, hsys, ayanamsha_offset)
	
	# For house cusps, we use a hybrid approach:
	# - MC is the midpoint MC
	# - ASC is calculated from MC + place
	# - Other cusps are calculated proportionally between ASC and MC
	
	# Calculate the arc from ASC to MC
	asc_to_mc = util.normalize(mc_lon - asc_lon)
	if asc_to_mc > 180.0:
		asc_to_mc = 360.0 - asc_to_mc
	mc_to_asc = 360.0 - asc_to_mc
	
	# Calculate IC and DSC
	ic_lon = util.normalize(mc_lon + 180.0)
	dsc_lon = util.normalize(asc_lon + 180.0)
	
	# Build cusps array
	cusps = [0.0]
	
	# For quadrant-based house systems (Placidus, Koch, etc.), we need to calculate
	# intermediate cusps. For simplicity, we use proportional division.
	# Cusps 10, 11, 12 are in the MC->ASC arc (quadrant IV)
	# Cusps 1, 2, 3 are in the ASC->IC arc (quadrant I)
	# Cusps 4, 5, 6 are in the IC->DSC arc (quadrant II)
	# Cusps 7, 8, 9 are in the DSC->MC arc (quadrant III)
	
	# Calculate proportional cusps based on the original charts' relative positions
	# This preserves the proportional house sizes while using derived angles
	orig_asc1 = first.ascmc[houses.Houses.ASC]
	orig_mc1 = first.ascmc[houses.Houses.MC]
	orig_asc2 = second.ascmc[houses.Houses.ASC]
	orig_mc2 = second.ascmc[houses.Houses.MC]
	
	for idx in range(1, houses.Houses.HOUSE_NUM + 1):
		# Calculate relative position of cusp in first chart
		rel1 = util.normalize(first.cusps[idx] - orig_asc1)
		if rel1 > 180.0:
			rel1 -= 360.0
		
		# Calculate relative position of cusp in second chart
		rel2 = util.normalize(second.cusps[idx] - orig_asc2)
		if rel2 > 180.0:
			rel2 -= 360.0
		
		# Use midpoint of relative positions
		rel_mid = _midpoint_angle(rel1, rel2)
		if rel_mid > 180.0:
			rel_mid -= 360.0
		
		# Apply to new composite ASC
		cusp_lon = util.normalize(asc_lon + rel_mid)
		cusps.append(cusp_lon)
	
	target.cusps = tuple(cusps)
	
	# Build ascmc tuple
	ascmc = list(target.ascmc)
	while len(ascmc) < max(houses.Houses.ASC, houses.Houses.MC) + 1:
		ascmc.append(0.0)
	ascmc[houses.Houses.ASC] = asc_lon
	ascmc[houses.Houses.MC] = mc_lon
	target.ascmc = tuple(ascmc)
	
	# Calculate ascmc2 (equatorial coordinates)
	ascra, ascdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(asc_lon, ayanamsha_offset), 0.0, 1.0, -obl)
	mcra, mcdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(mc_lon, ayanamsha_offset), 0.0, 1.0, -obl)
	target.ascmc2 = (
		(asc_lon, 0.0, ascra, ascdecl),
		(mc_lon, 0.0, mcra, mcdecl),
	)
	
	# Calculate regioMP values
	qasc = 0.0
	val = math.tan(math.radians(ascdecl)) * math.tan(math.radians(place.lat))
	if math.fabs(val) <= 1.0:
		qasc = math.degrees(math.asin(val))
	target.regioMPAsc = ascra - qasc
	target.regioMPMC = mcra
	
	# Calculate cuspstmp and cusps2
	cuspstmp = []
	for idx in range(houses.Houses.HOUSE_NUM):
		ra, decl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.cusps[idx + 1], ayanamsha_offset), 0.0, dist, -obl)
		cuspstmp.append([ra, decl])
	target.cuspstmp = cuspstmp
	target.cusps2 = tuple((entry[0], entry[1]) for entry in cuspstmp)


def _short_arc_midpoint(lon1, lon2):
	"""Calculate short-arc midpoint (same as circular midpoint in most cases)."""
	lon1 = util.normalize(lon1)
	lon2 = util.normalize(lon2)
	diff = math.fabs(lon1 - lon2)
	
	if diff <= 180.0:
		# Short arc is the direct arc
		return util.normalize(min(lon1, lon2) + diff / 2.0)
	else:
		# Long arc is the direct arc, short arc goes the other way
		diff = 360.0 - diff
		return util.normalize(max(lon1, lon2) + diff / 2.0)


def _apply_short_arc_houses(target, first, second, geolat, ayanamsha_offset=0.0):
	"""Apply composite houses using short-arc midpoints for all angles."""
	cusps = [0.0]
	for idx in range(1, houses.Houses.HOUSE_NUM + 1):
		cusps.append(_short_arc_midpoint(first.cusps[idx], second.cusps[idx]))
	target.cusps = tuple(cusps)
	
	ascmc = []
	count = min(len(target.ascmc), len(first.ascmc), len(second.ascmc))
	for idx in range(count):
		ascmc.append(_short_arc_midpoint(first.ascmc[idx], second.ascmc[idx]))
	target.ascmc = tuple(ascmc)
	
	ascra, ascdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.ascmc[houses.Houses.ASC], ayanamsha_offset), 0.0, 1.0, -target.obl)
	mcra, mcdecl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.ascmc[houses.Houses.MC], ayanamsha_offset), 0.0, 1.0, -target.obl)
	target.ascmc2 = (
		(target.ascmc[houses.Houses.ASC], 0.0, ascra, ascdecl),
		(target.ascmc[houses.Houses.MC], 0.0, mcra, mcdecl),
	)
	
	qasc = 0.0
	val = math.tan(math.radians(ascdecl)) * math.tan(math.radians(geolat))
	if math.fabs(val) <= 1.0:
		qasc = math.degrees(math.asin(val))
	target.regioMPAsc = ascra - qasc
	target.regioMPMC = mcra
	
	cuspstmp = []
	for idx in range(houses.Houses.HOUSE_NUM):
		ra, decl, dist = astrology.swe_cotrans(_lon_for_cotrans(target.cusps[idx + 1], ayanamsha_offset), 0.0, dist, -target.obl)
		cuspstmp.append([ra, decl])
	target.cuspstmp = cuspstmp
	target.cusps2 = tuple((entry[0], entry[1]) for entry in cuspstmp)


def _get_reference_place(opts):
	"""Get reference place from options default location."""
	return default_location_model.place_from_options(opts)


def build_symbolic_midpoint_composite(chrt1, chrt2, opts, name=None, method=None):
	"""
	Build a purely symbolic midpoint composite chart.
	
	This chart has no real moment in time - it's purely symbolic:
	- Planets are zodiac midpoints of the two source charts
	- MC is always calculated as short-arc midpoint
	- ASC can be calculated 3 ways:
	  * Method 0 (default): Short-arc midpoint of the two ASCs
	  * Method 1: Derived from reference place given the midpoint MC
	  * Method 2: Derived from geographic midpoint place given the midpoint MC
	
	All data is copied by value (not reference) to ensure complete independence
	from the source charts and from any other composite variants.
	"""
	import copy
	import options as opts_module
	
	# Get method from options if not explicitly provided
	if method is None:
		method = getattr(opts, 'composite_method', opts_module.Options.COMPOSITE_ASC_MIDPOINT)
	
	composite_name = name or '%s + %s %s' % (chrt1.name, chrt2.name, mtexts.txts.get('Composite', 'Composite'))
	
	# Use simple arithmetic mean for place (not spherical midpoint)
	# This is a symbolic composite, the place is just for display/reference
	lon = _mean(chrt1.place.lon, chrt2.place.lon)
	lat = _mean(chrt1.place.lat, chrt2.place.lat)
	lon = _signed_longitude(lon)
	east = lon >= 0.0
	north = lat >= 0.0
	deglon, minlon, seclon = util.decToDeg(lon)
	deglat, minlat, seclat = util.decToDeg(lat)
	altitude = int(round(_mean(chrt1.place.altitude, chrt2.place.altitude)))
	place = chart.Place(mtexts.txts.get('Composite', 'Composite'), deglon, minlon, seclon, east, deglat, minlat, seclat, north, altitude)
	
	time = _build_composite_time(chrt1, chrt2, place)
	
	# Create independent copy of options to prevent shared state
	opts_copy = copy.deepcopy(opts)
	
	comp = chart.Chart(composite_name, chrt1.male, time, place, chart.Chart.COMPOSITE, mtexts.txts.get('CompositeChart', 'Composite chart'), opts_copy, full=False)

	# MC is ALWAYS short-arc midpoint (this never changes)
	mc_lon = _short_arc_midpoint(
		chrt1.houses.ascmc[houses.Houses.MC],
		chrt2.houses.ascmc[houses.Houses.MC]
	)
	
	# ASC depends on the selected method
	if method == opts_module.Options.COMPOSITE_ASC_DERIVED_REF:
		# ASC derived from reference place
		ref_place = _get_reference_place(opts)
		asc_lon = _calculate_asc_from_mc(mc_lon, ref_place.lat, comp.obl[0], opts.hsys, comp.ayanamsha_offset)
	elif method == opts_module.Options.COMPOSITE_ASC_DERIVED_GEO:
		# ASC derived from geographic midpoint
		geo_place = _build_composite_place(chrt1, chrt2)
		asc_lon = _calculate_asc_from_mc(mc_lon, geo_place.lat, comp.obl[0], opts.hsys, comp.ayanamsha_offset)
	else:
		# Default: ASC short-arc midpoint
		asc_lon = _short_arc_midpoint(
			chrt1.houses.ascmc[houses.Houses.ASC],
			chrt2.houses.ascmc[houses.Houses.ASC]
		)
	
	# Apply the calculated angles to the composite
	_apply_composite_angles(comp.houses, chrt1.houses, chrt2.houses, asc_lon, mc_lon, comp.place.lat, comp.obl[0], comp.ayanamsha_offset)
	_apply_midpoint_vertex(comp, chrt1, chrt2)
	
	comp.raequasc, declequasc, dist = astrology.swe_cotrans(_lon_for_cotrans(comp.houses.ascmc[houses.Houses.EQUASC], comp.ayanamsha_offset), 0.0, 1.0, -comp.obl[0])

	# Create completely independent planet data by copying values, not references
	for idx in range(planets.Planets.PLANETS_NUM):
		body1 = chrt1.planets.planets[idx]
		body2 = chrt2.planets.planets[idx]
		target = comp.planets.planets[idx]
		
		# Calculate midpoint data
		data, dataEqu = _midpoint_body_data(body1, body2, comp.obl[0], comp.nolat, comp.ayanamsha_offset)
		
		# Assign as tuples (immutable copies) to prevent shared references
		target.data = tuple(data)
		target.dataEqu = tuple(dataEqu)
		target.speculums = []
		target.computePlacidianSpeculum(comp.place.lat, comp.houses.ascmc2)
		target.computeRegiomontanSpeculum(comp.place.lat, comp.houses.ascmc2, comp.raequasc)

	# Handle Chiron if present in all charts
	if getattr(chrt1, 'chiron', None) is not None and getattr(chrt2, 'chiron', None) is not None and getattr(comp, 'chiron', None) is not None:
		body1 = chrt1.chiron
		body2 = chrt2.chiron
		target = comp.chiron
		
		data, dataEqu = _midpoint_body_data(body1, body2, comp.obl[0], comp.nolat, comp.ayanamsha_offset)
		
		target.data = tuple(data)
		target.dataEqu = tuple(dataEqu)
		target.speculums = []
		target.computePlacidianSpeculum(comp.place.lat, comp.houses.ascmc2)
		target.computeRegiomontanSpeculum(comp.place.lat, comp.houses.ascmc2, comp.raequasc)

	comp.abovehorizonwithorb = comp.isAboveHorizonWithOrb()
	comp.calcFortune()
	_apply_midpoint_fortune(comp, chrt1, chrt2)

	comp.full = True
	abovehor = comp.planets.planets[astrology.SE_SUN].abovehorizon
	if comp.options.usedaynightorb:
		abovehor = comp.abovehorizonwithorb

	if comp.full:
		_materialize_full_chart_state(comp, abovehor=abovehor)

	comp.calcAspMatrix()
	if comp.fixstars is not None:
		comp.calcFixStarAspMatrix()

	return comp


def build_composite_chart(chrt1, chrt2, opts, name=None):
	"""Alias for build_symbolic_midpoint_composite for backward compatibility."""
	return build_symbolic_midpoint_composite(chrt1, chrt2, opts, name)


def build_davison_chart(chrt1, chrt2, opts, name=None):
	import copy

	composite_name = name or '%s + %s %s (%s)' % (chrt1.name, chrt2.name, mtexts.txts.get('Composite', 'Composite'), mtexts.txts.get('Davison', 'Davison'))
	place = _build_davison_place(chrt1, chrt2)
	time = _build_composite_time(chrt1, chrt2, place)
	comp = chart.Chart(
		composite_name,
		chrt1.male,
		time,
		place,
		chart.Chart.RADIX,
		'Davison composite chart',
		copy.deepcopy(opts),
		full=False,
	)
	comp.full = True
	if comp.full:
		_materialize_full_chart_state(comp)
	return comp
