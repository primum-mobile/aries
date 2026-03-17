import chart
import chartalerts
import planets
import util


TRADITIONAL_SIGN_DIFFS = {
	chart.Chart.CONJUNCTIO: 0,
	chart.Chart.SEXTIL: 2,
	chart.Chart.QUADRAT: 3,
	chart.Chart.TRIGON: 4,
	chart.Chart.OPPOSITIO: 6,
}


def _normalized_lon_for_traditional(lon, chrt, opts):
	if getattr(opts, 'ayanamsha', 0) != 0:
		lon -= getattr(chrt, 'ayanamsha', 0.0)
	return util.normalize(lon)


def _passes_traditional_filter(aspect_type, inner_lon, outer_lon, inner_chart, outer_chart, opts):
	if not getattr(opts, 'traditionalaspects', False):
		return True
	if aspect_type not in TRADITIONAL_SIGN_DIFFS:
		return False

	inner_lon = _normalized_lon_for_traditional(inner_lon, inner_chart, opts)
	outer_lon = _normalized_lon_for_traditional(outer_lon, outer_chart, opts)
	inner_sign = int(inner_lon / chart.Chart.SIGN_DEG)
	outer_sign = int(outer_lon / chart.Chart.SIGN_DEG)
	sign_diff = abs(inner_sign - outer_sign)
	if sign_diff > chart.Chart.SIGN_NUM / 2:
		sign_diff = chart.Chart.SIGN_NUM - sign_diff
	return sign_diff == TRADITIONAL_SIGN_DIFFS[aspect_type]


def _aspect_delta(inner_lon, outer_lon, aspect_type):
	distance = chartalerts.angular_distance(inner_lon, outer_lon)
	return abs(distance - chart.Chart.Aspects[aspect_type]), distance


def calc_planetary_interchart_aspects(inner_chart, outer_chart, opts):
	if inner_chart is None or outer_chart is None:
		return []

	try:
		inner_planets = inner_chart.planets.planets
		outer_planets = outer_chart.planets.planets
	except Exception:
		return []

	planet_count = min(planets.Planets.PLANETS_NUM - 1, len(inner_planets), len(outer_planets))
	results = []
	for outer_idx in range(planet_count):
		outer_lon = outer_planets[outer_idx].data[planets.Planet.LONG]
		for inner_idx in range(planet_count):
			inner_lon = inner_planets[inner_idx].data[planets.Planet.LONG]
			best_asp = None
			best_delta = None
			best_distance = None
			for aspect_type in range(chart.Chart.ASPECT_NUM):
				if not getattr(opts, 'aspect', ())[aspect_type]:
					continue
				if not _passes_traditional_filter(aspect_type, inner_lon, outer_lon, inner_chart, outer_chart, opts):
					continue

				orb = opts.orbis[outer_idx][aspect_type] + opts.orbis[inner_idx][aspect_type]
				delta, distance = _aspect_delta(inner_lon, outer_lon, aspect_type)
				if delta > orb:
					continue

				if best_delta is None or delta < best_delta:
					asp = chart.Asp()
					asp.typ = aspect_type
					asp.aspdif = delta
					asp.dif = distance
					asp.exact = delta <= getattr(opts, 'exact', 0.0)
					best_asp = asp
					best_delta = delta
					best_distance = distance

			if best_asp is not None:
				best_asp.dif = best_distance if best_distance is not None else 0.0
				results.append((outer_idx, inner_idx, best_asp))

	return results