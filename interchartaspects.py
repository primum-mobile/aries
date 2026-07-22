# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import chart
import chartalerts
import common
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
	return util.normalize(lon)


def _passes_traditional_filter(aspect_type, inner_lon, outer_lon, inner_chart, outer_chart, opts, enabled=None):
	if enabled is None:
		enabled = getattr(opts, 'traditionalaspects', False)
	if not enabled:
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


def calc_planetary_interchart_aspects(inner_chart, outer_chart, opts, enabled_aspects=None, traditional_filter=None):
	if inner_chart is None or outer_chart is None:
		return []
	inner_planet_ids = common.common.get_visible_chart_planet_ids(
		inner_chart, opts, include_descnode=False, include_chiron=True
	)
	outer_planet_ids = common.common.get_visible_chart_planet_ids(
		outer_chart, opts, include_descnode=False, include_chiron=True
	)
	results = []
	for outer_idx in outer_planet_ids:
		outer_body = common.common.get_chart_planet(outer_chart, outer_idx)
		if outer_body is None:
			continue
		outer_lon = outer_body.data[planets.Planet.LONG]
		outer_orb_idx = outer_chart.get_planet_orb_index(outer_idx)
		for inner_idx in inner_planet_ids:
			inner_body = common.common.get_chart_planet(inner_chart, inner_idx)
			if inner_body is None:
				continue
			inner_lon = inner_body.data[planets.Planet.LONG]
			inner_orb_idx = inner_chart.get_planet_orb_index(inner_idx)
			best_asp = None
			best_delta = None
			best_distance = None
			for aspect_type in range(chart.Chart.ASPECT_NUM):
				aspect_enabled = enabled_aspects[aspect_type] if enabled_aspects is not None else getattr(opts, 'aspect', ())[aspect_type]
				if not aspect_enabled:
					continue
				if not _passes_traditional_filter(aspect_type, inner_lon, outer_lon, inner_chart, outer_chart, opts, enabled=traditional_filter):
					continue

				orb = opts.orbis[outer_orb_idx][aspect_type] + opts.orbis[inner_orb_idx][aspect_type]
				delta, distance = _aspect_delta(inner_lon, outer_lon, aspect_type)
				if delta > orb:
					continue

				if best_delta is None or delta < best_delta:
					asp = chart.Asp()
					asp.typ = aspect_type
					asp.aspdif = delta
					asp.max_orb = orb  # Set max orb for thickness/alpha calculation
					asp.dif = distance
					asp.exact = delta <= getattr(opts, 'exact', 0.0)
					best_asp = asp
					best_delta = delta
					best_distance = distance

			if best_asp is not None:
				best_asp.dif = best_distance if best_distance is not None else 0.0
				results.append((outer_idx, inner_idx, best_asp))

	return results
