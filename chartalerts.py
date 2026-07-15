# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import astrology
import common
import houses
import planets
import util


EXACT_ASC_CONJUNCTION_ORB = 1.0
PERFECTION_TOLERANCE = 0.01
STEP_ALERT_BODY_IDS = common.get_step_alert_body_ids()
ANGLE_TARGETS = ('Asc', 'Dsc', 'MC', 'IC')


def angular_distance(lon1, lon2):
	diff = abs(util.normalize(lon1) - util.normalize(lon2))
	return min(diff, 360.0 - diff)


def signed_angular_delta(lon1, lon2):
	diff = util.normalize(lon1) - util.normalize(lon2)
	if diff > 180.0:
		diff -= 360.0
	elif diff <= -180.0:
		diff += 360.0
	return diff


def _body_longitude(chrt, body_id):
	body = common.get_chart_planet(chrt, body_id)
	if body is None:
		return None
	try:
		return body.data[planets.Planet.LONG]
	except Exception:
		return None


def exact_asc_conjunction_hits(radix, moving_chart, planet_ids=None, orb=EXACT_ASC_CONJUNCTION_ORB):
	if radix is None or moving_chart is None:
		return ()

	try:
		asc_lon = radix.houses.ascmc[houses.Houses.ASC]
	except Exception:
		return ()

	ids = STEP_ALERT_BODY_IDS if planet_ids is None else planet_ids
	hits = []
	for planet_id in ids:
		lon = _body_longitude(moving_chart, planet_id)
		if lon is None:
			continue
		if angular_distance(lon, asc_lon) <= orb:
			hits.append(planet_id)
	return tuple(hits)


def selected_step_alert_metrics(radix, moving_chart, options, orb=EXACT_ASC_CONJUNCTION_ORB):
	if radix is None or moving_chart is None or not getattr(options, 'stepalerts_enabled', True):
		return {}

	hits = {}
	proms = getattr(options, 'stepalerts_promplanets', ())
	sig_planets = getattr(options, 'stepalerts_sigplanets', ())
	sig_angles = getattr(options, 'stepalerts_sigangles', ())

	for mover_slot, mover_body_id in enumerate(STEP_ALERT_BODY_IDS):
		if mover_slot >= len(proms) or not proms[mover_slot]:
			continue
		moving_lon = _body_longitude(moving_chart, mover_body_id)
		if moving_lon is None:
			continue

		for target_slot in range(len(sig_planets)):
			if not sig_planets[target_slot]:
				continue
			if target_slot >= len(STEP_ALERT_BODY_IDS):
				continue
			static_lon = _body_longitude(radix, STEP_ALERT_BODY_IDS[target_slot])
			if static_lon is None:
				continue
			distance = angular_distance(moving_lon, static_lon)
			hits[('planet', mover_body_id, STEP_ALERT_BODY_IDS[target_slot])] = {
				'distance': distance,
				'signed_delta': signed_angular_delta(moving_lon, static_lon),
				'within_orb': bool(distance <= orb),
			}

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
			distance = angular_distance(moving_lon, static_lon)
			hits[('angle', mover_body_id, angle_target)] = {
				'distance': distance,
				'signed_delta': signed_angular_delta(moving_lon, static_lon),
				'within_orb': bool(distance <= orb),
			}

	return hits


def selected_exact_hits(radix, moving_chart, options, orb=EXACT_ASC_CONJUNCTION_ORB):
	return tuple(selected_exact_hit_metrics(radix, moving_chart, options, orb=orb).keys())


def selected_exact_hit_metrics(radix, moving_chart, options, orb=EXACT_ASC_CONJUNCTION_ORB):
	return {
		hit: metric for hit, metric in selected_step_alert_metrics(radix, moving_chart, options, orb=orb).items()
		if metric.get('within_orb', False)
	}


def is_perfection_crossing(previous_metric, current_metric, tolerance=PERFECTION_TOLERANCE):
	if current_metric is None:
		return False
	current_distance = float(current_metric.get('distance', 999.0))
	if previous_metric is None:
		return current_distance <= float(tolerance)

	previous_distance = float(previous_metric.get('distance', 999.0))
	previous_delta = float(previous_metric.get('signed_delta', 0.0))
	current_delta = float(current_metric.get('signed_delta', 0.0))
	tolerance = float(tolerance)
	epsilon = 1e-9

	if current_distance <= tolerance and current_distance + epsilon < previous_distance:
		return True
	if previous_delta < -tolerance and current_delta > tolerance:
		return True
	if previous_delta > tolerance and current_delta < -tolerance:
		return True
	return False


def perfection_hits(previous_metrics, current_metrics, tolerance=PERFECTION_TOLERANCE):
	hits = []
	for hit, current_metric in current_metrics.items():
		if is_perfection_crossing(previous_metrics.get(hit), current_metric, tolerance=tolerance):
			hits.append(hit)
	return tuple(hits)


def update_step_alert_state(previous_metrics, radix, moving_chart, options, orb=EXACT_ASC_CONJUNCTION_ORB):
	current_metrics = selected_step_alert_metrics(radix, moving_chart, options, orb=orb)
	return current_metrics, bool(perfection_hits(previous_metrics, current_metrics))
