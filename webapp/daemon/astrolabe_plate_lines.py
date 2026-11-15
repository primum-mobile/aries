# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Engraved plate lines of the stereographic astrolabe tympan.

Display geometry only: nothing here feeds a calculation. Every function takes
the (positive) plate latitude of ``astrolabe_projection.plate_latitude``, so a
southern plate is the northern plate for |latitude| (the tympan is symmetric
under the sky's reflection through the equator). Coordinates are in units of
R_eq, relative to the visible pole, x right (west), y down, MC up.

Two families, as engraved on period plates (e.g. a plate for latitude 39°):

* Almucantars and azimuths above the horizon at the plate's 5° division. Azimuths stop at the 85° almucantar, where they would crowd together;
  every 15th degree runs on to the zenith. Each azimuth is a great circle
  through the zenith and nadir, so the circle serves the bearings A and A+180;
  the renderer clips it to the sky (inside the horizon), and all but the
  zenith-reaching ones outside the 85° almucantar.
* Unequal (temporal, planetary) hours between the tropics, where the Sun
  travels: the day arc of each parallel divided into twelve equal parts above
  the horizon (hour 1 at the eastern horizon), the night arc into twelve below
  it (hour 1 at the western horizon). Plates engrave the night hours, read
  with the Sun's nadir; dials such as the Prague astronomical clock draw the
  day hours. Plates approximated each line by a circle through its points on
  the two tropics and the equator; these are the exact loci.
"""

from __future__ import annotations

import functools
import math

import astrolabe_projection as proj

GRID_STEP_DEG = 5
AZIMUTH_STOP_ALT_DEG = 85.0
AZIMUTH_ZENITH_STEP_DEG = 15
UNEQUAL_HOURS = 12
# Day hours run sunrise (east) to sunset; night hours sunset (west) to sunrise.
PERIODS = ("day", "night")
# Samples along each hour line between the two tropics.
_HOUR_LINE_SAMPLES = 41


def _round(value: float) -> float:
    return round(float(value), 7)


def _plate_xy(ha_rad: float, dec_deg: float, r_eq: float) -> tuple[float, float]:
    """Hour angle (west positive) and declination to plate coordinates."""
    r = proj.decl_to_radius(dec_deg, r_eq)
    return r * math.sin(ha_rad), -r * math.cos(ha_rad)


def _day_semi_arc(lat_deg: float, dec_deg: float) -> float:
    """Day semi-arc H0 (radians): the parallel is above the horizon for
    |hour angle| < H0. Circumpolar parallels clamp to 0 (all night) or pi."""
    x = -math.tan(math.radians(lat_deg)) * math.tan(math.radians(dec_deg))
    return math.acos(max(-1.0, min(1.0, x)))


def _hour_angle(lat_deg: float, dec_deg: float, period: str, boundary: float) -> float:
    """Hour angle (west positive) of an unequal-hour boundary on the parallel
    ``dec_deg``. Night: 0 = western horizon at sunset, 12 = eastern horizon at
    sunrise. Day: 0 = eastern horizon at sunrise, 12 = western at sunset."""
    h0 = _day_semi_arc(lat_deg, dec_deg)
    if period == "day":
        return -h0 + boundary * 2.0 * h0 / UNEQUAL_HOURS
    return h0 + boundary * (2.0 * math.pi - 2.0 * h0) / UNEQUAL_HOURS


def unequal_hour_lines(plate_lat: float, obliquity: float, r_eq: float = 1.0) -> list[dict]:
    """Hour lines 1..11 of the day (above the horizon) and of the night (below
    it); 0 and 12 are the horizon itself. Each is a path from the outer tropic
    to the inner one."""
    lat = abs(plate_lat)
    out = []
    for period in PERIODS:
        for hour in range(1, UNEQUAL_HOURS):
            path = []
            for i in range(_HOUR_LINE_SAMPLES):
                dec = -obliquity + 2.0 * obliquity * i / (_HOUR_LINE_SAMPLES - 1)
                x, y = _plate_xy(_hour_angle(lat, dec, period, hour), dec, r_eq)
                path.append({"x": _round(x), "y": _round(y)})
            out.append({"hour": hour, "period": period, "paths": [path]})
    return out


def _almucantar_circle(alt: float, lat: float, r_eq: float) -> dict | None:
    c, r = proj.almucantar(alt, lat, r_eq)
    if not math.isfinite(r) or r > 1e6:
        return None
    # almucantar() returns the centre's distance toward the zenith side.
    return {"alt": float(alt), "cx": 0.0, "cy": _round(-c), "r": _round(r)}


def _azimuth_circle(azimuth: float, lat: float, r_eq: float) -> dict | None:
    """Great circle through zenith, nadir and the horizon point at
    ``azimuth`` (degrees from south through west); None for the meridian."""
    zenith = _plate_xy(0.0, lat, r_eq)
    nadir = _plate_xy(math.pi, -lat, r_eq)
    a = math.radians(azimuth)
    # Horizon point (altitude 0) at this azimuth, as hour angle / declination.
    dec = math.degrees(math.asin(-math.cos(math.radians(lat)) * math.cos(a)))
    ha = math.atan2(math.sin(a), math.cos(a) * math.sin(math.radians(lat)))
    circle = proj.three_point_center(zenith, nadir, _plate_xy(ha, dec, r_eq))
    if circle is None:
        return None
    cx, cy, r = circle
    if not math.isfinite(r) or r > 1e6:
        return None
    return {"cx": _round(cx), "cy": _round(cy), "r": _round(r)}


@functools.lru_cache(maxsize=32)
def _plate_grid(plate_lat: float, r_eq: float) -> dict:
    lat = abs(plate_lat)
    step = GRID_STEP_DEG
    almucantars = [c for alt in range(step, 90, step) if (c := _almucantar_circle(alt, lat, r_eq))]
    stop = _almucantar_circle(AZIMUTH_STOP_ALT_DEG, lat, r_eq)
    azimuths = []
    for az in range(0, 180, step):
        circle = _azimuth_circle(float(az), lat, r_eq)
        if circle is None:
            continue  # the meridian: drawn as the plate's meridian line
        azimuths.append({"az": az, **circle, "toZenith": az % AZIMUTH_ZENITH_STEP_DEG == 0})
    return {
        "almucantarStep": step,
        "azimuthStep": step,
        "almucantars": almucantars,
        "azimuths": azimuths,
        # Azimuths that do not reach the zenith stop at this almucantar.
        "azimuthStop": stop,
    }


def plate_grid(plate_lat: float, r_eq: float = 1.0) -> dict:
    """The dense almucantar/azimuth lattice above the horizon (see module)."""
    grid = _plate_grid(float(plate_lat), float(r_eq))
    return {
        **grid,
        "almucantars": [dict(c) for c in grid["almucantars"]],
        "azimuths": [dict(c) for c in grid["azimuths"]],
        "azimuthStop": dict(grid["azimuthStop"]) if grid["azimuthStop"] else None,
    }
