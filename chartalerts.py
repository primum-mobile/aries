import astrology
import houses
import planets
import util


EXACT_ASC_CONJUNCTION_ORB = 1.0
DEFAULT_ALERT_PLANETS = tuple(range(astrology.SE_SUN, astrology.SE_PLUTO + 1))
ANGLE_TARGETS = ('Asc', 'Dsc', 'MC', 'IC')


def angular_distance(lon1, lon2):
	diff = abs(util.normalize(lon1) - util.normalize(lon2))
	return min(diff, 360.0 - diff)


def exact_asc_conjunction_hits(radix, moving_chart, planet_ids=None, orb=EXACT_ASC_CONJUNCTION_ORB):
	if radix is None or moving_chart is None:
		return ()

	try:
		asc_lon = radix.houses.ascmc[houses.Houses.ASC]
		moving_planets = moving_chart.planets.planets
	except Exception:
		return ()

	ids = planet_ids or DEFAULT_ALERT_PLANETS
	hits = []
	for planet_id in ids:
		try:
			lon = moving_planets[planet_id].data[planets.Planet.LONG]
		except Exception:
			continue
		if angular_distance(lon, asc_lon) <= orb:
			hits.append(planet_id)
	return tuple(hits)


def selected_exact_hits(radix, moving_chart, options, orb=EXACT_ASC_CONJUNCTION_ORB):
	if radix is None or moving_chart is None or not getattr(options, 'stepalerts_enabled', True):
		return ()

	try:
		moving_planets = moving_chart.planets.planets
	except Exception:
		return ()

	hits = []
	proms = getattr(options, 'stepalerts_promplanets', ())
	sig_planets = getattr(options, 'stepalerts_sigplanets', ())
	sig_angles = getattr(options, 'stepalerts_sigangles', ())

	for planet_id in DEFAULT_ALERT_PLANETS:
		if planet_id >= len(proms) or not proms[planet_id]:
			continue
		try:
			moving_lon = moving_planets[planet_id].data[planets.Planet.LONG]
		except Exception:
			continue

		for target_id in range(min(len(sig_planets), len(radix.planets.planets))):
			if not sig_planets[target_id]:
				continue
			try:
				static_lon = radix.planets.planets[target_id].data[planets.Planet.LONG]
			except Exception:
				continue
			if angular_distance(moving_lon, static_lon) <= orb:
				hits.append(('planet', planet_id, target_id))

		for idx, angle_target in enumerate(ANGLE_TARGETS):
			if idx >= len(sig_angles) or not sig_angles[idx]:
				continue
			try:
				if angle_target == 'Asc':
					static_lon = radix.houses.ascmc[houses.Houses.ASC]
				elif angle_target == 'Dsc':
					static_lon = util.normalize(radix.houses.ascmc[houses.Houses.ASC] + 180.0)
				elif angle_target == 'MC':
					static_lon = radix.houses.ascmc[houses.Houses.MC]
				else:
					static_lon = util.normalize(radix.houses.ascmc[houses.Houses.MC] + 180.0)
			except Exception:
				continue
			if angular_distance(moving_lon, static_lon) <= orb:
				hits.append(('angle', planet_id, angle_target))

	return tuple(hits)
