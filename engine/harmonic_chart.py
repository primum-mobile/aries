# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Pure harmonic and Parashari Varga derivation from a resolved radix chart.

Harmonic charts multiply ecliptic longitude by the selected harmonic number
and normalize the result to the zodiac.  The radix has already resolved the
active tropical or sidereal frame, so this transform must not apply an
ayanamsha a second time.  No ephemeris call, process I/O, or disk I/O belongs
in this module: changing H is an interactive chart-navigation hot path.

Vargas are not equal Western harmonics.  Each supported D chart uses the
sign-assignment rule in BPHS chapter 6; D30 additionally uses its five unequal
planetary spans.  The source radix has already resolved the active zodiac
frame, so neither projection applies ayanamsha again.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import astrology
import fortune
import houses
import planets
import syzygy
import util
from antiscia import Antiscia


MIN_HARMONIC = 1.0
MAX_HARMONIC = 360.0
DEFAULT_HARMONIC = 9.0
PRESET_HARMONICS = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 12.0)

PROJECTION_MODE_HARMONIC = "harmonic"
PROJECTION_MODE_VARGA = "varga"
PROJECTION_MODES = (PROJECTION_MODE_HARMONIC, PROJECTION_MODE_VARGA)

DRISHTI_MODE_OFF = "off"
DRISHTI_MODE_PARASHARI = "parashari"
DRISHTI_MODE_JAIMINI = "jaimini"
DRISHTI_MODES = (
	DRISHTI_MODE_OFF,
	DRISHTI_MODE_PARASHARI,
	DRISHTI_MODE_JAIMINI,
)
DEFAULT_DRISHTI_MODE = DRISHTI_MODE_PARASHARI

DEFAULT_VARGA = 9
VARGA_DIVISIONS = (1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60)
VARGA_NAME_KEYS = {
	1: "VargaNameD1",
	2: "VargaNameD2",
	3: "VargaNameD3",
	4: "VargaNameD4",
	7: "VargaNameD7",
	9: "VargaNameD9",
	10: "VargaNameD10",
	12: "VargaNameD12",
	16: "VargaNameD16",
	20: "VargaNameD20",
	24: "VargaNameD24",
	27: "VargaNameD27",
	30: "VargaNameD30",
	40: "VargaNameD40",
	45: "VargaNameD45",
	60: "VargaNameD60",
}

POLICY_TRANSFORM_SOURCE_LONGITUDE = "transform_source_longitude"
POLICY_TRANSFORM_RESOLVED_FACTOR = "transform_resolved_factor"
POLICY_DERIVE_FROM_PROJECTED_CHART = "derive_from_projected_chart"
POLICY_RETAIN_ASTRONOMICAL_REFERENCE = "retain_astronomical_reference"
POLICY_DELEGATE_TO_CONSTITUENT = "delegate_to_constituent"
POLICY_DERIVE_FROM_PROJECTED_LAGNA = "derive_from_projected_lagna"
POLICY_UNSUPPORTED_OUTSIDE_CLASSICAL_VARGA = "unsupported_outside_classical_varga"
POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN = "receive_by_occupied_varga_sign"
POLICY_CAST_CLASSICAL_GRAHA_ONLY = "cast_classical_graha_only"
POLICY_CAST_OPTIONAL_NODE_SCHOOL = "cast_optional_node_school"
POLICY_NO_DRISHTI_AGENCY = "no_drishti_agency"

# Total semantic-point contract.  Keep this in lockstep with
# astrocart_spec.ALL_POINT_FAMILIES: the regression test intentionally fails
# when Aries adds a point family without deciding its harmonic role.
HARMONIC_POINT_POLICY = {
	"standard_body": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"chiron": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"logical_node": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"asteroid_centaur": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"fixed_star": POLICY_RETAIN_ASTRONOMICAL_REFERENCE,
	"angle": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"fortune": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"vertex": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"prenatal_syzygy": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"configured_lot": POLICY_DERIVE_FROM_PROJECTED_CHART,
	"outer_midpoint": POLICY_DERIVE_FROM_PROJECTED_CHART,
	"outer_antiscion": POLICY_DERIVE_FROM_PROJECTED_CHART,
	"outer_contra_antiscion": POLICY_DERIVE_FROM_PROJECTED_CHART,
	"outer_dodecatemoria": POLICY_DERIVE_FROM_PROJECTED_CHART,
	"outer_hybrid_hit": POLICY_DELEGATE_TO_CONSTITUENT,
}

# Total Varga role contract.  BPHS explicitly assigns grahas and divisions;
# Aries extends that deterministic longitude mapping to every enabled physical
# or mathematical point with a resolved radix longitude.  Formula-derived
# points are therefore mapped from that resolved longitude rather than
# recalculated from already-mapped operands.  Fixed stars remain an astronomical
# reference field.  The Lagna starts the whole-sign house frame; the remaining
# chart angles retain their independently mapped source longitudes.
VARGA_POINT_POLICY = {
	"standard_body": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"chiron": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"logical_node": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"asteroid_centaur": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"fixed_star": POLICY_RETAIN_ASTRONOMICAL_REFERENCE,
	"angle": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"fortune": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"vertex": POLICY_TRANSFORM_SOURCE_LONGITUDE,
	"prenatal_syzygy": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"configured_lot": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"outer_midpoint": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"outer_antiscion": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"outer_contra_antiscion": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"outer_dodecatemoria": POLICY_TRANSFORM_RESOLVED_FACTOR,
	"outer_hybrid_hit": POLICY_DELEGATE_TO_CONSTITUENT,
}

VARGA_TECHNIQUE_POLICY = {
	"western_degree_aspects": POLICY_UNSUPPORTED_OUTSIDE_CLASSICAL_VARGA,
	"fixed_star_conjunctions": POLICY_UNSUPPORTED_OUTSIDE_CLASSICAL_VARGA,
	"parashari_graha_drishti": POLICY_CAST_CLASSICAL_GRAHA_ONLY,
	"jaimini_rashi_drishti": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN,
}

# Point-family x dṛṣṭi role coverage.  Parāśari graha dṛṣṭi is cast by
# the seven classical grahas (and optionally the nodes under an explicit school
# setting), but it falls on the whole Varga sign/house and therefore reaches
# every mathematical point placed there.  Jaimini rāśi dṛṣṭi belongs to the
# signs themselves, so points participate as occupants rather than as agents.
# Fixed stars are the one deliberate exception: they remain unprojected
# astronomical references and are not silently inserted into a Varga technique.
VARGA_DRISHTI_POINT_POLICY = {
	"standard_body": {"cast": POLICY_CAST_CLASSICAL_GRAHA_ONLY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"chiron": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"logical_node": {"cast": POLICY_CAST_OPTIONAL_NODE_SCHOOL, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"asteroid_centaur": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"fixed_star": {"cast": POLICY_UNSUPPORTED_OUTSIDE_CLASSICAL_VARGA, "receive": POLICY_UNSUPPORTED_OUTSIDE_CLASSICAL_VARGA},
	"angle": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"fortune": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"vertex": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"prenatal_syzygy": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"configured_lot": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"outer_midpoint": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"outer_antiscion": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"outer_contra_antiscion": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"outer_dodecatemoria": {"cast": POLICY_NO_DRISHTI_AGENCY, "receive": POLICY_RECEIVE_BY_OCCUPIED_VARGA_SIGN},
	"outer_hybrid_hit": {"cast": POLICY_DELEGATE_TO_CONSTITUENT, "receive": POLICY_DELEGATE_TO_CONSTITUENT},
}

_PARASHARI_CLASSICAL_ORDINALS = {
	astrology.SE_SUN: (7,),
	astrology.SE_MOON: (7,),
	astrology.SE_MERCURY: (7,),
	astrology.SE_VENUS: (7,),
	astrology.SE_MARS: (4, 7, 8),
	astrology.SE_JUPITER: (5, 7, 9),
	astrology.SE_SATURN: (3, 7, 10),
}
_PARASHARI_NODE_ORDINALS = (5, 7, 9)

def _house_position_is_undefined(*_args: Any, **_kwargs: Any) -> int:
	raise ValueError("house positions are undefined for harmonic charts")


def normalize_harmonic_number(value: Any, *, default: float = DEFAULT_HARMONIC) -> float:
	"""Return a finite harmonic number in Aries' supported interactive range."""
	try:
		number = float(value)
	except (TypeError, ValueError):
		number = float(default)
	if not math.isfinite(number):
		number = float(default)
	return min(MAX_HARMONIC, max(MIN_HARMONIC, number))


def normalize_projection_mode(value: Any, *, default: str = PROJECTION_MODE_HARMONIC) -> str:
	mode = str(value or "").strip().lower()
	if mode in PROJECTION_MODES:
		return mode
	return default if default in PROJECTION_MODES else PROJECTION_MODE_HARMONIC


def normalize_drishti_mode(value: Any, *, default: str = DEFAULT_DRISHTI_MODE) -> str:
	mode = str(value or "").strip().lower()
	if mode in DRISHTI_MODES:
		return mode
	return default if default in DRISHTI_MODES else DEFAULT_DRISHTI_MODE


def parashari_drishti_target_signs(
	actor_id: Any,
	actor_sign: Any,
	*,
	include_node_special: bool = False,
) -> tuple[tuple[int, int], ...]:
	"""Return ``(target_sign, ordinal)`` for one graha in a Varga.

	The ordinal is counted inclusively from the graha's occupied sign: every
	classical graha sees the seventh, while Mars, Jupiter and Saturn receive
	their BPHS special sights.  Rāhu/Ketu 5/7/9 is deliberately opt-in because
	the node rule is a school choice rather than part of the uncontested seven-
	graha rule.
	"""
	try:
		body_id = int(actor_id)
		sign = int(actor_sign) % 12
	except (TypeError, ValueError, OverflowError):
		return ()
	ordinals = _PARASHARI_CLASSICAL_ORDINALS.get(body_id)
	if ordinals is None and include_node_special and body_id in (
		astrology.SE_MEAN_NODE,
		astrology.SE_TRUE_NODE,
	):
		ordinals = _PARASHARI_NODE_ORDINALS
	if not ordinals:
		return ()
	return tuple((((sign + ordinal - 1) % 12), ordinal) for ordinal in ordinals)


def jaimini_drishti_target_signs(source_sign: Any) -> tuple[int, ...]:
	"""Return the three classical Jaimini rāśi-dṛṣṭi targets."""
	try:
		sign = int(source_sign) % 12
	except (TypeError, ValueError, OverflowError):
		return ()
	modality = sign % 3
	if modality == 0:  # movable -> fixed, excluding the adjacent fixed sign
		candidates = (1, 4, 7, 10)
	elif modality == 1:  # fixed -> movable, excluding the adjacent movable sign
		candidates = (0, 3, 6, 9)
	else:  # dual -> every other dual sign
		return tuple(candidate for candidate in (2, 5, 8, 11) if candidate != sign)
	return tuple(
		candidate
		for candidate in candidates
		if (candidate - sign) % 12 not in (1, 11)
	)


def varga_drishti_relations(
	chart_obj: Any,
	mode: Any = DEFAULT_DRISHTI_MODE,
	*,
	include_node_special: bool = False,
) -> tuple[dict[str, Any], ...]:
	"""Build the small, renderer-neutral dṛṣṭi graph for a Varga chart."""
	if getattr(chart_obj, "_varga_number", None) is None:
		return ()
	resolved_mode = normalize_drishti_mode(mode)
	if resolved_mode == DRISHTI_MODE_OFF:
		return ()
	rows: list[dict[str, Any]] = []
	if resolved_mode == DRISHTI_MODE_PARASHARI:
		actor_ids = list(_PARASHARI_CLASSICAL_ORDINALS)
		if include_node_special:
			actor_ids.extend((astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE))
		for actor_id in actor_ids:
			body = chart_obj.get_planet_body(actor_id)
			if body is None:
				continue
			try:
				actor_sign = int(float(body.data[planets.Planet.LONG]) // 30.0) % 12
			except (AttributeError, IndexError, TypeError, ValueError):
				continue
			for target_sign, ordinal in parashari_drishti_target_signs(
				actor_id,
				actor_sign,
				include_node_special=include_node_special,
			):
				rows.append({
					"id": f"parashari:planet:{actor_id}:s:{target_sign}:{ordinal}",
					"method": DRISHTI_MODE_PARASHARI,
					"actor_kind": "planet",
					"actor_id": actor_id,
					"actor_sign": actor_sign,
					"target_sign": target_sign,
					"ordinal": ordinal,
					"special": ordinal != 7,
				})
	else:
		seen: set[tuple[int, int]] = set()
		for source_sign in range(12):
			for target_sign in jaimini_drishti_target_signs(source_sign):
				pair = tuple(sorted((source_sign, target_sign)))
				if pair in seen:
					continue
				seen.add(pair)
				rows.append({
					"id": f"jaimini:s:{pair[0]}:s:{pair[1]}",
					"method": DRISHTI_MODE_JAIMINI,
					"actor_kind": "sign",
					"actor_sign": pair[0],
					"target_sign": pair[1],
					"ordinal": None,
					"special": False,
				})
	return tuple(rows)


def normalize_varga_number(value: Any, *, default: int = DEFAULT_VARGA) -> int:
	try:
		raw_number = float(value)
		if not math.isfinite(raw_number) or not raw_number.is_integer():
			raise ValueError
		number = int(raw_number)
	except (TypeError, ValueError, OverflowError):
		number = int(default)
	if number in VARGA_DIVISIONS:
		return number
	return int(default) if int(default) in VARGA_DIVISIONS else DEFAULT_VARGA


def step_varga_number(value: Any, direction: int) -> int:
	current = normalize_varga_number(value)
	index = VARGA_DIVISIONS.index(current)
	next_index = min(len(VARGA_DIVISIONS) - 1, max(0, index + (1 if direction >= 0 else -1)))
	return VARGA_DIVISIONS[next_index]


def varga_name_key(value: Any) -> str:
	return VARGA_NAME_KEYS[normalize_varga_number(value)]


def harmonic_longitude(longitude: Any, harmonic_number: Any) -> float:
	return util.normalize(float(longitude) * normalize_harmonic_number(harmonic_number))


def _equal_varga_projection(source_longitude: float, division: int, start_sign: int) -> tuple[float, float]:
	"""Map one equal amsa to its assigned sign and expand it for wheel display."""
	lon = util.normalize(float(source_longitude))
	source_sign = int(lon // 30.0)
	offset = lon - source_sign * 30.0
	part_size = 30.0 / float(division)
	part = min(division - 1, int(offset / part_size))
	fraction = (offset - part * part_size) / part_size
	target_sign = (int(start_sign) + part) % 12
	return util.normalize(target_sign * 30.0 + fraction * 30.0), float(division)


def varga_longitude_details(longitude: Any, division: Any) -> tuple[float, float]:
	"""Return ``(display_longitude, local_speed_scale)`` for one Shodashavarga.

	The sign assignment is the classical result.  The position inside that sign
	is the proportional position inside the occupied amsa, expanded to 30 degrees
	solely so Aries can place distinct glyphs on a circular wheel.  It must not be
	read as an additional astronomical longitude.
	"""
	lon = util.normalize(float(longitude))
	d = normalize_varga_number(division)
	source_sign = int(lon // 30.0)
	offset = lon - source_sign * 30.0
	odd_sign = source_sign % 2 == 0  # Aries is sign 1 (odd), index 0.
	modality = source_sign % 3  # 0 movable, 1 fixed, 2 dual.

	if d == 1:
		return lon, 1.0
	if d == 2:
		part = 0 if offset < 15.0 else 1
		target_sign = (4, 3)[part] if odd_sign else (3, 4)[part]
		fraction = (offset - part * 15.0) / 15.0
		return target_sign * 30.0 + fraction * 30.0, 2.0
	if d == 3:
		part = min(2, int(offset / 10.0))
		return _equal_varga_projection(lon, d, source_sign + part * 3)
	if d == 4:
		part = min(3, int(offset / 7.5))
		return _equal_varga_projection(lon, d, source_sign + part * 2)
	if d == 7:
		start = source_sign if odd_sign else source_sign + 6
		return _equal_varga_projection(lon, d, start)
	if d == 9:
		start = source_sign if modality == 0 else source_sign + (8 if modality == 1 else 4)
		return _equal_varga_projection(lon, d, start)
	if d == 10:
		return _equal_varga_projection(lon, d, source_sign if odd_sign else source_sign + 8)
	if d == 12:
		return _equal_varga_projection(lon, d, source_sign)
	if d == 16:
		return _equal_varga_projection(lon, d, (0, 4, 8)[modality])
	if d == 20:
		return _equal_varga_projection(lon, d, (0, 8, 4)[modality])
	if d == 24:
		return _equal_varga_projection(lon, d, 4 if odd_sign else 3)
	if d == 27:
		# Fire, earth, air, water start from Aries, Cancer, Libra, Capricorn.
		return _equal_varga_projection(lon, d, (0, 3, 6, 9)[source_sign % 4])
	if d == 30:
		if odd_sign:
			spans = (
				(0.0, 5.0, 0),   # Mars -> Aries
				(5.0, 10.0, 10), # Saturn -> Aquarius
				(10.0, 18.0, 8), # Jupiter -> Sagittarius
				(18.0, 25.0, 2), # Mercury -> Gemini
				(25.0, 30.0, 6), # Venus -> Libra
			)
		else:
			spans = (
				(0.0, 5.0, 1),   # Venus -> Taurus
				(5.0, 12.0, 5),  # Mercury -> Virgo
				(12.0, 20.0, 11),# Jupiter -> Pisces
				(20.0, 25.0, 9), # Saturn -> Capricorn
				(25.0, 30.0, 7), # Mars -> Scorpio
			)
		for start, end, target_sign in spans:
			if offset < end or end == 30.0:
				span = end - start
				return target_sign * 30.0 + ((offset - start) / span) * 30.0, 30.0 / span
	if d == 40:
		return _equal_varga_projection(lon, d, 0 if odd_sign else 6)
	if d == 45:
		return _equal_varga_projection(lon, d, (0, 4, 8)[modality])
	if d == 60:
		# BPHS: find the occupied half-degree part, then count it from the
		# source sign.  This is not the Western H60 formula.
		return _equal_varga_projection(lon, d, source_sign)
	raise AssertionError("unreachable Varga division")


def varga_longitude(longitude: Any, division: Any) -> float:
	return util.normalize(varga_longitude_details(longitude, division)[0])


def format_harmonic_number(value: Any) -> str:
	number = normalize_harmonic_number(value)
	if number.is_integer():
		return str(int(number))
	return f"{number:.6f}".rstrip("0").rstrip(".")


def _replace_index(values: Any, index: int, value: float) -> Any:
	if values is None or len(values) <= index:
		return values
	replaced = list(values)
	replaced[index] = value
	return tuple(replaced) if isinstance(values, tuple) else replaced


def _transform_planet_body(body: Any, harmonic_number: float) -> None:
	data = getattr(body, "data", None)
	if data is not None and len(data) > planets.Planet.LONG:
		data = _replace_index(
			data,
			planets.Planet.LONG,
			harmonic_longitude(data[planets.Planet.LONG], harmonic_number),
		)
		if len(data) > planets.Planet.SPLON:
			data = _replace_index(
				data,
				planets.Planet.SPLON,
				float(data[planets.Planet.SPLON]) * harmonic_number,
			)
		body.data = data

	for index, speculum in enumerate(list(getattr(body, "speculums", ()) or ())):
		if speculum is not None and len(speculum) > planets.Planet.LONG:
			body.speculums[index] = _replace_index(
				speculum,
				planets.Planet.LONG,
				harmonic_longitude(speculum[planets.Planet.LONG], harmonic_number),
			)


def _transform_houses(chart_obj: Any, harmonic_number: float) -> None:
	houses_obj = getattr(chart_obj, "houses", None)
	if houses_obj is None:
		return

	cusps = list(getattr(houses_obj, "cusps", ()) or ())
	for index in range(1, len(cusps)):
		cusps[index] = harmonic_longitude(cusps[index], harmonic_number)
	if cusps:
		houses_obj.cusps = tuple(cusps)

	ascmc = list(getattr(houses_obj, "ascmc", ()) or ())
	for index in range(len(ascmc)):
		# ARMC is sidereal time, not an ecliptic point.
		if index != houses.Houses.ARMC:
			ascmc[index] = harmonic_longitude(ascmc[index], harmonic_number)
	if ascmc:
		houses_obj.ascmc = tuple(ascmc)

	ascmc2 = []
	for index, coordinates in enumerate(list(getattr(houses_obj, "ascmc2", ()) or ())):
		if coordinates is None or len(coordinates) <= houses.Houses.LON:
			ascmc2.append(coordinates)
			continue
		# The usual ascmc2 payload contains ASC and MC.  If a future payload
		# includes ARMC, keep that non-ecliptic quantity untouched.
		longitude = coordinates[houses.Houses.LON]
		if index != houses.Houses.ARMC:
			longitude = harmonic_longitude(longitude, harmonic_number)
		ascmc2.append(_replace_index(coordinates, houses.Houses.LON, longitude))
	if ascmc2:
		houses_obj.ascmc2 = tuple(ascmc2)
	try:
		semantic_angles = chart_obj._semantic_angle_longitudes
	except AttributeError:
		semantic_angles = None
	if semantic_angles is not None:
		houses_obj._semantic_angle_longitudes = dict(semantic_angles)

	# A harmonic wheel has angles as points, but no mundane house system.
	# Keep transformed cusps in the clone for consumers that inspect geometry,
	# while the canonical display flag suppresses house sectors and positions.
	houses_obj.ui_hsys = "N"
	houses_obj.getHousePos = _house_position_is_undefined


def _transform_resolved_radix_factors(chart_obj: Any, harmonic_number: float) -> None:
	# These are already-resolved factors/events of the radix. Transform their radix
	# longitudes just as Solar Fire's harmonic contract transforms each point in
	# the base chart. Fortune preserves the radix sect decision; for its ordinary
	# linear formula, transforming the result is algebraically identical to using
	# the projected ASC, Moon, and Sun. The prenatal Syzygy remains the radix's
	# actual prenatal event rather than triggering a new event search.
	fortune_obj = getattr(chart_obj, "fortune", None)
	fortune_data = getattr(fortune_obj, "fortune", None)
	if fortune_data is not None and len(fortune_data) > fortune.Fortune.LON:
		fortune_obj.fortune = _replace_index(
			fortune_data,
			fortune.Fortune.LON,
			harmonic_longitude(fortune_data[fortune.Fortune.LON], harmonic_number),
		)
	for attr in ("speculum", "speculum2"):
		speculum_obj = getattr(fortune_obj, attr, None)
		speculum = getattr(speculum_obj, "speculum", None)
		if speculum is not None and len(speculum) > planets.Planet.LONG:
			speculum_obj.speculum = _replace_index(
				speculum,
				planets.Planet.LONG,
				harmonic_longitude(speculum[planets.Planet.LONG], harmonic_number),
			)

	syzygy_obj = getattr(chart_obj, "syzygy", None)
	for attr in ("lon", "lon2"):
		if syzygy_obj is not None and getattr(syzygy_obj, attr, None) is not None:
			setattr(
				syzygy_obj,
				attr,
				harmonic_longitude(getattr(syzygy_obj, attr), harmonic_number),
			)
	if syzygy_obj is not None and getattr(syzygy_obj, "lons", None) is not None:
		syzygy_obj.lons = [harmonic_longitude(value, harmonic_number) for value in syzygy_obj.lons]
	for attr in ("speculum", "speculum2"):
		speculum = getattr(syzygy_obj, attr, None)
		if speculum is not None and len(speculum) > syzygy.Syzygy.LON:
			setattr(
				syzygy_obj,
				attr,
				_replace_index(
					speculum,
					syzygy.Syzygy.LON,
					harmonic_longitude(speculum[syzygy.Syzygy.LON], harmonic_number),
				),
			)



def _derive_secondary_point_families(chart_obj: Any) -> None:
	"""Apply selected secondary-ring techniques to the finished symbolic chart.

	Configured Lots, midpoints, antiscia, contra-antiscia, and dodecatemoria
	are overlays derived from the currently displayed chart. Their operator is
	therefore applied after the harmonic operator; transforming the already
	derived radix overlay would reverse that order and can change the result.
	"""
	if getattr(chart_obj, "parts", None) is not None and hasattr(chart_obj, "calcArabicParts"):
		chart_obj.calcArabicParts()
	if getattr(chart_obj, "midpoints", None) is not None and hasattr(chart_obj, "calcMidPoints"):
		chart_obj.calcMidPoints()
	if getattr(chart_obj, "antiscia", None) is not None and hasattr(chart_obj, "calcAntiscia"):
		chart_obj.calcAntiscia()


def _transform_varga_planet_body(body: Any, division: int) -> None:
	data = getattr(body, "data", None)
	if data is not None and len(data) > planets.Planet.LONG:
		longitude, speed_scale = varga_longitude_details(data[planets.Planet.LONG], division)
		data = _replace_index(data, planets.Planet.LONG, longitude)
		if len(data) > planets.Planet.SPLON:
			data = _replace_index(
				data,
				planets.Planet.SPLON,
				float(data[planets.Planet.SPLON]) * speed_scale,
			)
		body.data = data

	for index, speculum in enumerate(list(getattr(body, "speculums", ()) or ())):
		if speculum is not None and len(speculum) > planets.Planet.LONG:
			body.speculums[index] = _replace_index(
				speculum,
				planets.Planet.LONG,
				varga_longitude(speculum[planets.Planet.LONG], division),
			)


def _transform_varga_houses(chart_obj: Any, division: int) -> None:
	houses_obj = getattr(chart_obj, "houses", None)
	if houses_obj is None:
		return
	try:
		source_ascmc = tuple(houses_obj.ascmc)
		source_asc = float(source_ascmc[houses.Houses.ASC])
	except Exception:
		return

	# Parashari Vargas use the projected Lagna and a whole-sign house frame.
	# Other enabled angles remain independent mathematical points and are mapped
	# from their own radix longitudes, just like special Lagnas in the literature.
	asc = varga_longitude(source_asc, division)
	dsc = varga_longitude(util.normalize(source_asc + 180.0), division)
	source_mc = float(source_ascmc[houses.Houses.MC])
	mc = varga_longitude(source_mc, division)
	ic = varga_longitude(util.normalize(source_mc + 180.0), division)
	chart_obj._semantic_angle_longitudes = {
		"asc": asc,
		"dsc": dsc,
		"mc": mc,
		"ic": ic,
	}

	ascmc = list(source_ascmc)
	for index in range(len(ascmc)):
		if index == houses.Houses.ARMC:
			continue
		if index == houses.Houses.ASC:
			ascmc[index] = asc
		elif index == houses.Houses.MC:
			ascmc[index] = mc
		else:
			ascmc[index] = varga_longitude(source_ascmc[index], division)
	if ascmc:
		houses_obj.ascmc = tuple(ascmc)

	ascmc2 = []
	for index, coordinates in enumerate(list(getattr(houses_obj, "ascmc2", ()) or ())):
		if coordinates is None or len(coordinates) <= houses.Houses.LON:
			ascmc2.append(coordinates)
			continue
		longitude = asc if index == houses.Houses.ASC else mc if index == houses.Houses.MC else coordinates[houses.Houses.LON]
		ascmc2.append(_replace_index(coordinates, houses.Houses.LON, longitude))
	if ascmc2:
		houses_obj.ascmc2 = tuple(ascmc2)

	first_sign = int(asc // 30.0)
	houses_obj.cusps = tuple(
		[0.0] + [util.normalize((first_sign + index) * 30.0) for index in range(12)]
	)
	houses_obj.ui_hsys = "W"
	houses_obj.hsys = "W"


def _transform_varga_syzygy(chart_obj: Any, division: int) -> None:
	# The prenatal event remains the radix's actual event; only its resolved
	# longitude is placed in the chosen Varga.
	syzygy_obj = getattr(chart_obj, "syzygy", None)
	for attr in ("lon", "lon2"):
		if syzygy_obj is not None and getattr(syzygy_obj, attr, None) is not None:
			setattr(syzygy_obj, attr, varga_longitude(getattr(syzygy_obj, attr), division))
	if syzygy_obj is not None and getattr(syzygy_obj, "lons", None) is not None:
		syzygy_obj.lons = [varga_longitude(value, division) for value in syzygy_obj.lons]
	for attr in ("speculum", "speculum2"):
		speculum = getattr(syzygy_obj, attr, None)
		if speculum is not None and len(speculum) > syzygy.Syzygy.LON:
			setattr(
				syzygy_obj,
				attr,
				_replace_index(
					speculum,
					syzygy.Syzygy.LON,
					varga_longitude(speculum[syzygy.Syzygy.LON], division),
				),
			)


def _capture_varga_overlay_factors(chart_obj: Any, division: int) -> dict:
	"""Resolve radix projection overlays before any Varga body is transformed.

	Rao's construction maps any already-located physical or mathematical point
	through the selected division.  Retaining this compact source-factor cache
	prevents the renderer from accidentally reversing the operator order by
	recomputing antiscia or dodecatemoria from already-mapped Varga planets.
	"""
	collection = getattr(chart_obj, "antiscia", None)
	expected_morin = bool(getattr(getattr(chart_obj, "options", None), "morin_antiscia", False))
	if collection is None or bool(getattr(collection, "morin_antiscia", False)) != expected_morin:
		try:
			chart_obj.calcAntiscia()
			collection = getattr(chart_obj, "antiscia", None)
		except Exception:
			collection = None
	if collection is None:
		return {}

	def entry(point: Any, branch: str = "primary") -> dict | None:
		if point is None or not bool(getattr(point, "valid", True)):
			return None
		longitude = getattr(point, "lon", None)
		if longitude is None:
			return None
		return {
			"branch": branch,
			"longitude": varga_longitude(longitude, division),
			"direction": int(getattr(point, "direction", 0) or 0),
		}

	def family_payload(primary_attr: str, secondary_attr: str | None,
			fortune_attr: str, angles_attr: str) -> dict:
		planets_by_id: dict[int, list[dict]] = {}
		primary = getattr(collection, primary_attr, ()) or ()
		secondary = getattr(collection, secondary_attr, ()) or () if secondary_attr else ()
		for body_id, point in enumerate(primary):
			points = []
			primary_entry = entry(point)
			if primary_entry is not None:
				points.append(primary_entry)
			if body_id < len(secondary):
				secondary_entry = entry(secondary[body_id], "secondary")
				if secondary_entry is not None:
					points.append(secondary_entry)
			if points:
				planets_by_id[body_id] = points

		fortune_entry = entry(getattr(collection, fortune_attr, None))
		angles = {}
		for angle_key, point in zip(("asc", "mc"), getattr(collection, angles_attr, ()) or ()):
			angle_entry = entry(point)
			if angle_entry is not None:
				angles[angle_key] = angle_entry
		return {
			"planets": planets_by_id,
			"fortune": fortune_entry,
			"angles": angles,
		}

	cache = {
		"antiscia": family_payload("plantiscia", "plantiscia_secondary", "lofant", "ascmcant"),
		"contra_antiscia": family_payload(
			"plcontraant", "plcontraant_secondary", "lofcontraant", "ascmccontraant"
		),
		"dodecatemoria": family_payload("pldodecatemoria", None, "lofdodec", "ascmcdodec"),
	}

	# Chiron is intentionally outside the fixed classic planet matrix but is an
	# enabled planet-like point in Aries. Resolve the same three radix operators
	# explicitly so it cannot fall through to a derive-after-Varga shortcut.
	chiron = getattr(chart_obj, "chiron", None)
	data = getattr(chiron, "data", None)
	if data is not None and len(data) > planets.Planet.LONG:
		body_id = astrology.SE_CHIRON
		longitude = float(data[planets.Planet.LONG])
		latitude = float(data[planets.Planet.LAT]) if len(data) > planets.Planet.LAT else 0.0
		if expected_morin:
			for family, contra in (("antiscia", False), ("contra_antiscia", True)):
				resolved = Antiscia.morin_projection_points(
					longitude,
					latitude,
					float(getattr(chart_obj, "obl", (0.0,))[0]),
					int(getattr(chart_obj.options, "ayanamsha", 0)),
					float(getattr(chart_obj, "ayanamsha_offset", 0.0)),
					contra=contra,
				)
				points = []
				for branch in ("primary", "secondary"):
					point = resolved.get(branch)
					if point is None or point.get("lon") is None:
						continue
					points.append({
						"branch": branch,
						"longitude": varga_longitude(point["lon"], division),
						"direction": int(point.get("direction", 0) or 0),
					})
				if points:
					cache[family]["planets"][body_id] = points
		else:
			ant, contra = collection.calc(collection._to_tropical(longitude))
			cache["antiscia"]["planets"][body_id] = [{
				"branch": "primary", "longitude": varga_longitude(ant, division), "direction": 0,
			}]
			cache["contra_antiscia"]["planets"][body_id] = [{
				"branch": "primary", "longitude": varga_longitude(contra, division), "direction": 0,
			}]
		cache["dodecatemoria"]["planets"][body_id] = [{
			"branch": "primary",
			"longitude": varga_longitude(collection.calcDodecatemoria(longitude), division),
			"direction": 0,
		}]
	return cache


def _transform_varga_resolved_points(chart_obj: Any, division: int) -> None:
	"""Map resolved mathematical points exactly as the Varga source describes."""
	fortune_obj = getattr(chart_obj, "fortune", None)
	fortune_data = getattr(fortune_obj, "fortune", None)
	if fortune_data is not None and len(fortune_data) > fortune.Fortune.LON:
		fortune_obj.fortune = _replace_index(
			fortune_data,
			fortune.Fortune.LON,
			varga_longitude(fortune_data[fortune.Fortune.LON], division),
		)
	for attr in ("speculum", "speculum2"):
		speculum_obj = getattr(fortune_obj, attr, None)
		speculum = getattr(speculum_obj, "speculum", None)
		if speculum is not None and len(speculum) > planets.Planet.LONG:
			speculum_obj.speculum = _replace_index(
				speculum,
				planets.Planet.LONG,
				varga_longitude(speculum[planets.Planet.LONG], division),
			)

	parts_obj = getattr(chart_obj, "parts", None)
	if parts_obj is not None and getattr(parts_obj, "parts", None) is not None:
		parts_obj.parts = [
			_replace_index(row, 3, varga_longitude(row[3], division))
			if row is not None and len(row) > 3 else row
			for row in parts_obj.parts
		]

	for midpoint in list(getattr(getattr(chart_obj, "midpoints", None), "mids", ()) or ()) + list(
		getattr(getattr(chart_obj, "midpoints", None), "midslat", ()) or ()
	):
		if getattr(midpoint, "m", None) is not None:
			midpoint.m = varga_longitude(midpoint.m, division)

	seen = set()
	antiscia_obj = getattr(chart_obj, "antiscia", None)
	for attr in (
		"plantiscia", "plcontraant", "plantiscia_secondary",
		"plcontraant_secondary", "pldodecatemoria", "ascmcant",
		"ascmccontraant", "ascmcdodec",
	):
		for point in getattr(antiscia_obj, attr, ()) or ():
			if id(point) in seen or getattr(point, "lon", None) is None:
				continue
			seen.add(id(point))
			point.lon = varga_longitude(point.lon, division)
	for attr in ("lofant", "lofcontraant", "lofdodec"):
		point = getattr(antiscia_obj, attr, None)
		if point is not None and id(point) not in seen and getattr(point, "lon", None) is not None:
			seen.add(id(point))
			point.lon = varga_longitude(point.lon, division)


def build_harmonic_chart(radix: Any, harmonic_number: Any = DEFAULT_HARMONIC) -> Any:
	"""Clone ``radix`` and return its deterministic harmonic projection."""
	number = normalize_harmonic_number(harmonic_number)
	chart_obj = copy.deepcopy(radix)
	chart_obj._harmonic_number = number
	chart_obj._symbolic_longitudes = True
	chart_obj._suppress_house_positions = True
	try:
		asc = float(chart_obj.houses.ascmc[houses.Houses.ASC])
		mc = float(chart_obj.houses.ascmc[houses.Houses.MC])
		chart_obj._semantic_angle_longitudes = {
			"asc": harmonic_longitude(asc, number),
			"dsc": harmonic_longitude(util.normalize(asc + 180.0), number),
			"mc": harmonic_longitude(mc, number),
			"ic": harmonic_longitude(util.normalize(mc + 180.0), number),
		}
	except Exception:
		chart_obj._semantic_angle_longitudes = {}

	# Options are part of the cloned chart, so this never mutates the global
	# options singleton used by the radix or other documents.
	if getattr(chart_obj, "options", None) is not None:
		chart_obj.options.houses = False

	for body in getattr(getattr(chart_obj, "planets", None), "planets", ()) or ():
		_transform_planet_body(body, number)
	try:
		# Aries stores the descending node as the second resolved node body.
		# Preserve its independently transformed radix longitude; rebuilding it
		# as transformed North Node + 180° is wrong for every even harmonic.
		chart_obj._semantic_desc_node_body = chart_obj.planets.planets[astrology.SE_TRUE_NODE]
	except Exception:
		chart_obj._semantic_desc_node_body = None
	_transform_planet_body(getattr(chart_obj, "chiron", None), number)

	for asteroid in getattr(getattr(chart_obj, "asteroids", None), "asteroids", ()) or ():
		data = getattr(asteroid, "data", None)
		if data is not None and len(data) > 0:
			asteroid.data = _replace_index(data, 0, harmonic_longitude(data[0], number))
		if getattr(asteroid, "speed", None) is not None:
			asteroid.speed = float(asteroid.speed) * number

	_transform_houses(chart_obj, number)
	_transform_resolved_radix_factors(chart_obj, number)
	_derive_secondary_point_families(chart_obj)

	# Fixed stars are the astronomical reference field around Aries' secondary
	# ring, not symbolic factors of the harmonic chart.  Their epoch-correct
	# ecliptic longitudes therefore remain exactly as resolved on the radix.
	# A future explicit "star as harmonic factor" technique would need a
	# separate point role; it must not mutate this reference overlay.

	# Rebuild ecliptic aspect relationships from the projected longitudes.  The
	# physical equatorial coordinates remain the radix values by design; a
	# harmonic projection must not fabricate astronomical RA/declination.
	if hasattr(chart_obj, "calcAspMatrix"):
		chart_obj.calcAspMatrix()
	if getattr(chart_obj, "fixstars", None) is not None and hasattr(chart_obj, "calcFixStarAspMatrix"):
		chart_obj.calcFixStarAspMatrix()
	return chart_obj


def build_varga_chart(radix: Any, division: Any = DEFAULT_VARGA) -> Any:
	"""Clone ``radix`` and return its Parashari Shodashavarga projection."""
	number = normalize_varga_number(division)
	chart_obj = copy.deepcopy(radix)
	chart_obj._varga_number = number
	chart_obj._varga_name_key = varga_name_key(number)
	chart_obj._symbolic_longitudes = True
	chart_obj._suppress_house_positions = False
	chart_obj._varga_overlay_longitudes = _capture_varga_overlay_factors(chart_obj, number)

	# Varga houses are whole-sign houses from the projected Lagna.  Western
	# degree aspects and star conjunctions are not silently applied to the
	# expanded display degrees; their dedicated Parashari equivalents belong to
	# a separate, explicit technique implementation.
	if getattr(chart_obj, "options", None) is not None:
		chart_obj.options.houses = True
		chart_obj.options.hsys = "W"
		chart_obj.options.aspects = False

	for body in getattr(getattr(chart_obj, "planets", None), "planets", ()) or ():
		_transform_varga_planet_body(body, number)
	try:
		chart_obj._semantic_desc_node_body = chart_obj.planets.planets[astrology.SE_TRUE_NODE]
	except Exception:
		chart_obj._semantic_desc_node_body = None
	_transform_varga_planet_body(getattr(chart_obj, "chiron", None), number)

	for asteroid in getattr(getattr(chart_obj, "asteroids", None), "asteroids", ()) or ():
		data = getattr(asteroid, "data", None)
		if data is not None and len(data) > 0:
			longitude, speed_scale = varga_longitude_details(data[0], number)
			asteroid.data = _replace_index(data, 0, longitude)
			if getattr(asteroid, "speed", None) is not None:
				asteroid.speed = float(asteroid.speed) * speed_scale

	_transform_varga_houses(chart_obj, number)
	_transform_varga_syzygy(chart_obj, number)
	_transform_varga_resolved_points(chart_obj, number)

	# Fixed-star longitudes are intentionally untouched.  Clear physical/star
	# and Western aspect matrices rather than leave stale radix relationships on
	# a symbolic sign chart.
	for attr in (
		"aspmatrix", "aspmatrixH", "aspmatrixLoF", "fsaspmatrix",
		"fsaspmatrixangles", "fsaspmatrixhcs", "fsaspmatrixlof",
	):
		if hasattr(chart_obj, attr):
			setattr(chart_obj, attr, [])
	return chart_obj
