# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Spatial house boundaries on the stereographic astrolabe plate.

Constructions: Swiss Ephemeris documentation, sections 6.2 and 6.5,
https://www.astro.com/swisseph/swisseph.pdf ; implementation oracle:
SWEP/src/swehouse.c, swe_house_pos(). Regiomontanus plate construction:
Georg Zotti (2007), section 3.4.2, figure 3.7,
https://repositum.tuwien.at/retrieve/27962 .

Only zodiacal divisions use ecliptic meridians. Spatial systems retain their
own defining poles/planes, and time systems their actual semi-arc curves.
These are display projections; no chart calculation or cusp is changed.
Curves are computed on the true sphere and projected in the plate's frame
(``pole``: +1 north, -1 south; see ``astrolabe_projection``).
"""

import math

import astrolabe_projection as proj


CONSTRUCTIONS = {
    "R": "equator-horizon-circles",
    "C": "prime-vertical-horizon-circles",
    "P": "diurnal-semiarcs",
    "K": "koch-ascensional-curves",
    "B": "ascendant-semiarc-hour-circles",
    "X": "equatorial-hour-circles",
    "H": "horizon-zenith-circles",
    "T": "topocentric-pole-circles",
    "E": "zodiacal-meridians",
    "W": "zodiacal-meridians",
    "F": "zodiacal-meridians",
    "Q": "zodiacal-meridians",
    "M": "zodiacal-meridians",
    "O": "zodiacal-meridians",
    "N": "angles-only",
}


def _unit(ra, dec):
    ra, dec = math.radians(ra), math.radians(dec)
    return math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _project_curve(vector_at, parameters, obliquity, ramc, radius, pole=1):
    """Clip on the sphere before projection; never join disjoint branches."""
    # The plate rim is the outer tropic: declination -obliquity in the plate's frame.
    minimum_z = -math.sin(math.radians(obliquity))
    paths, path = [], []
    previous = None

    def project(vector):
        ra = math.degrees(math.atan2(vector[1], vector[0]))
        dec = math.degrees(math.asin(max(-1.0, min(1.0, vector[2]))))
        return proj.equatorial_to_xy(ra, dec, ramc, radius, pole)

    for parameter in sorted(set(parameters)):
        vector = vector_at(parameter)
        visible = vector is not None and pole * vector[2] >= minimum_z - 1e-12
        if previous is not None:
            last_parameter, last_vector, last_visible = previous
            if vector is not None and last_vector is not None and visible != last_visible:
                lo, hi = last_parameter, parameter
                for _ in range(32):
                    mid = (lo + hi) / 2.0
                    if (pole * vector_at(mid)[2] >= minimum_z) == last_visible:
                        lo = mid
                    else:
                        hi = mid
                path.append(project(vector_at((lo + hi) / 2.0)))
        if visible:
            path.append(project(vector))
        elif path:
            if len(path) > 1:
                paths.append(path)
            path = []
        previous = parameter, vector, visible
    if len(path) > 1:
        paths.append(path)
    return paths


def _great_circle(division, pole, cusp, obliquity, ramc, radius, plate_pole=1):
    # Remove the component along the shared pole, retaining the half-circle
    # containing this house's defining division (its opposite is another house).
    along = _dot(division, pole)
    tangent = tuple(x - along * y for x, y in zip(division, pole))
    length = math.sqrt(_dot(tangent, tangent))
    tangent = tuple(x / length for x in tangent)
    anchor = math.degrees(math.atan2(_dot(cusp, pole), _dot(cusp, tangent)))

    def vector_at(angle):
        angle = math.radians(angle)
        return tuple(x * math.cos(angle) + y * math.sin(angle) for x, y in zip(tangent, pole))

    parameters = [*range(-90, 91), *([anchor] if -90 <= anchor <= 90 else [])]
    return _project_curve(vector_at, parameters, obliquity, ramc, radius, plate_pole)


def _placidus(phase, latitude, dec):
    # A temporal division is defined only where the diurnal circle rises/sets.
    # The polar cap has no historical semi-arc division; do not invent one.
    argument = math.tan(math.radians(latitude)) * math.tan(math.radians(dec))
    if abs(argument) > 1.0 + 1e-12:
        return None
    ad = math.degrees(math.asin(max(-1.0, min(1.0, argument))))
    if phase == 0 or phase >= 180:
        return ((phase or 360) - 270) * (90 + ad) / 90
    return (180 + (phase - 90) * (90 - ad) / 90 + 180) % 360 - 180


def _koch(phase, latitude, ramc, obliquity, dec, eastern):
    argument = math.tan(math.radians(latitude)) * math.tan(math.radians(dec))
    if abs(argument) > 1.0 + 1e-12:
        return None
    ad = math.degrees(math.asin(max(-1.0, min(1.0, argument))))
    mc_argument = math.tan(math.radians(obliquity)) * math.tan(math.radians(latitude)) * math.sin(math.radians(ramc))
    if abs(mc_argument) >= 1:
        return None
    ad_mc = math.degrees(math.asin(mc_argument))
    if eastern:
        unwrapped = phase - 360 if phase >= 270 else phase
        factor = unwrapped / 90 + 1
        hour_angle = factor * (90 + ad_mc) + ad - ad_mc
        return hour_angle if 0 <= factor <= 2 and 0 <= hour_angle <= 180 else None
    factor = phase / 90 - 1
    hour_angle = factor * (90 + ad_mc) - 180 - ad - ad_mc
    return hour_angle if 0 <= factor <= 2 and -180 <= hour_angle <= 0 else None


def _topocentric(phase, latitude, dec):
    factor = abs(180 - phase) / 90 - 1
    argument = math.tan(math.radians(latitude)) * factor * math.tan(math.radians(dec))
    if abs(argument) > 1.0 + 1e-12:
        return None
    offset = 90 + phase + math.degrees(math.asin(max(-1.0, min(1.0, argument))))
    altitude = (math.sin(math.radians(latitude)) * math.sin(math.radians(dec))
                + math.cos(math.radians(latitude)) * math.cos(math.radians(dec)) * math.cos(math.radians(offset)))
    upper = phase == 0 or phase >= 180
    if (upper and altitude < -1e-12) or (not upper and altitude > 1e-12):
        return None
    return offset


def house_paths(system, house, longitude, latitude, obliquity, ramc, radius=1.0, plate_pole=1):
    """Return visible branches of one house boundary; longitude is tropical."""
    construction = CONSTRUCTIONS[system]
    if construction == "angles-only":
        return []
    if construction == "zodiacal-meridians":
        return [proj.ecliptic_cusp_line(longitude, obliquity, radius, ramc, plate_pole)]

    cusp_ra, cusp_dec = proj.ecl_lon_to_ra_dec(longitude, obliquity)
    cusp = _unit(cusp_ra, cusp_dec)
    phase = (house - 1) * 30
    east = _unit(ramc + 90, 0)
    zenith = _unit(ramc, latitude)
    # North horizon point, valid in either hemisphere.
    north = _unit(ramc + (180 if latitude >= 0 else 0), 90 - abs(latitude))

    if system in ("B", "X", "P", "K", "T"):
        limit = 90 - abs(latitude)
        # Declinations from the plate rim to the pole at its centre.
        parameters = [-obliquity, 90.0, plate_pole * cusp_dec, *range(math.ceil(-obliquity), 90)]
        parameters += [d for d in (-limit, limit) if -obliquity <= d <= 90]
        parameters = [plate_pole * d for d in parameters]

        def curve(eastern=True):
            def vector_at(dec):
                if system == "P":
                    offset = _placidus(phase, latitude, dec)
                elif system == "K":
                    offset = _koch(phase, latitude, ramc, obliquity, dec, eastern)
                elif system == "T":
                    offset = _topocentric(phase, latitude, dec)
                else:
                    offset = cusp_ra - ramc
                return None if offset is None else _unit(ramc + offset, dec)
            return _project_curve(vector_at, parameters, obliquity, ramc, radius, plate_pole)

        return curve() + curve(False) if system == "K" else curve()

    if system == "R":
        division, pole = _unit(ramc + 90 + phase, 0), north
    elif system in ("C", "H"):
        angle = math.radians(phase)
        other = tuple(-x for x in zenith) if system == "C" else north
        division = tuple(x * math.cos(angle) + y * math.sin(angle) for x, y in zip(east, other))
        pole = north if system == "C" else zenith
    return _great_circle(division, pole, cusp, obliquity, ramc, radius, plate_pole)
