# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Stereographic projection math for planispheric astrolabe rendering.

Projection: south-polar stereographic onto the equatorial plane.
Center of projection = South Celestial Pole.
Center of diagram    = North Celestial Pole.

All angles in DEGREES unless a variable name ends with ``_rad``.
All returned (x, y) are relative to the NCP at (0, 0) in screen
coordinates (x right, y down).
"""

import math

_DEG = math.pi / 180.0


# ---------------------------------------------------------------------------
# Core projection
# ---------------------------------------------------------------------------

def decl_to_radius(decl_deg, R_eq):
    """Map declination to radial distance from NCP.

    r = R_eq * tan((90 - dec) / 2)
    """
    return R_eq * math.tan((90.0 - decl_deg) / 2.0 * _DEG)


def _angle_from_north(ra_deg, ramc_deg):
    """Convert RA to screen angle measured clockwise from 12-o'clock (MC).

    Returns degrees.  0 = top (MC), 90 = right (west on astrolabe),
    180 = bottom (IC), 270 = left (east on astrolabe).
    """
    return -(ra_deg - ramc_deg)


def equatorial_to_xy(ra_deg, decl_deg, ramc_deg, R_eq):
    """Project equatorial (RA, Dec) to screen (x, y) relative to NCP=(0,0).

    MC at 12 o'clock, west to the right, east to the left.
    """
    r = decl_to_radius(decl_deg, R_eq)
    a = _angle_from_north(ra_deg, ramc_deg) * _DEG
    return (r * math.sin(a), -r * math.cos(a))


# ---------------------------------------------------------------------------
# Tropic & equator radii
# ---------------------------------------------------------------------------

def tropic_cancer_radius(obliquity_deg, R_eq):
    return decl_to_radius(obliquity_deg, R_eq)


def tropic_capricorn_radius(obliquity_deg, R_eq):
    return decl_to_radius(-obliquity_deg, R_eq)


# ---------------------------------------------------------------------------
# Ecliptic eccentric circle
# ---------------------------------------------------------------------------

def ecliptic_circle(obliquity_deg, R_eq):
    """Return (offset, radius) of the ecliptic eccentric circle.

    *offset* is the displacement of the ecliptic centre from the NCP
    along the solstice axis (positive = toward winter solstice / Capricorn).
    *radius* is the ecliptic circle radius.
    """
    r_can = tropic_cancer_radius(obliquity_deg, R_eq)
    r_cap = tropic_capricorn_radius(obliquity_deg, R_eq)
    offset = (r_cap - r_can) / 2.0
    radius = (r_cap + r_can) / 2.0
    return offset, radius


def ecliptic_center_xy(obliquity_deg, R_eq, ramc_deg):
    """Screen (x, y) of the ecliptic circle centre for a given rete orientation."""
    offset, _ = ecliptic_circle(obliquity_deg, R_eq)
    # The offset is along the RA = 270 direction (toward winter solstice).
    a = _angle_from_north(270.0, ramc_deg) * _DEG
    return (offset * math.sin(a), -offset * math.cos(a))


# ---------------------------------------------------------------------------
# Ecliptic longitude helpers
# ---------------------------------------------------------------------------

def ecl_lon_to_ra_dec(ecl_lon_deg, obliquity_deg):
    """Convert ecliptic longitude (lat=0) to equatorial (RA, Dec) in degrees."""
    lam = ecl_lon_deg * _DEG
    eps = obliquity_deg * _DEG
    sin_lam = math.sin(lam)
    cos_lam = math.cos(lam)
    dec = math.asin(math.sin(eps) * sin_lam)
    ra = math.atan2(math.cos(eps) * sin_lam, cos_lam)
    ra_deg = math.degrees(ra) % 360.0
    return ra_deg, math.degrees(dec)


def sign_boundary_xy(sign_index, obliquity_deg, R_eq, ramc_deg):
    """Screen (x, y) of the boundary BEFORE sign *sign_index* (0=Ari)."""
    ecl_lon = sign_index * 30.0
    ra, dec = ecl_lon_to_ra_dec(ecl_lon, obliquity_deg)
    return equatorial_to_xy(ra, dec, ramc_deg, R_eq)


def ecliptic_degree_xy(ecl_lon_deg, obliquity_deg, R_eq, ramc_deg):
    """Screen (x, y) of any ecliptic longitude."""
    ra, dec = ecl_lon_to_ra_dec(ecl_lon_deg, obliquity_deg)
    return equatorial_to_xy(ra, dec, ramc_deg, R_eq)


# ---------------------------------------------------------------------------
# Plate circles (fixed for a given latitude — no RA dependence)
# ---------------------------------------------------------------------------

def horizon_circle(latitude_deg, R_eq):
    """Return (center_y_offset, radius) of the horizon circle.

    center_y_offset is DOWNWARD from NCP on screen (toward Capricorn).
    The horizon circle is centred at (0, +center_y_offset) in plate coords.
    """
    lat = abs(latitude_deg) * _DEG
    sl, cl = math.sin(lat), math.cos(lat)
    if sl < 1e-9:
        return (0.0, 1e12)  # degenerate at equator
    center = R_eq * cl / sl
    radius = R_eq / sl
    return center, radius


def almucantar(altitude_deg, latitude_deg, R_eq):
    """Return (center_y_offset, radius) for an altitude circle."""
    lat = abs(latitude_deg) * _DEG
    alt = altitude_deg * _DEG
    denom = math.sin(lat) + math.sin(alt)
    if abs(denom) < 1e-9:
        return (0.0, 1e12)
    center = R_eq * math.cos(lat) / denom
    radius = R_eq * math.cos(alt) / denom
    return center, radius


def azimuth_arc(azimuth_deg, latitude_deg, R_eq):
    """Return (cx, cy, radius) for an azimuth arc.

    cx, cy are relative to NCP = (0, 0), screen coords (y down).
    azimuth_deg: measured from south through west (0=south, 90=west, -90=east).
    """
    lat = abs(latitude_deg) * _DEG
    cl = math.cos(lat)
    if cl < 1e-9:
        return (0.0, 0.0, 1e12)
    az = azimuth_deg * _DEG
    az_line = R_eq / cl
    # y offset of the azimuth system pole (zenith projection)
    zenith_r = R_eq * math.tan((90.0 - abs(latitude_deg)) / 2.0 * _DEG)
    center_y = -(az_line - zenith_r)
    cos_az = math.cos(az)
    if abs(cos_az) < 1e-9:
        return (0.0, center_y, 1e12)
    center_x = az_line * math.tan(az)
    radius = az_line / abs(cos_az)
    return center_x, center_y, radius


# ---------------------------------------------------------------------------
# Regiomontanus house curves
# ---------------------------------------------------------------------------

def three_point_center(p1, p2, p3):
    """Circle through three points.  Returns (cx, cy, radius) or None."""
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3

    # Swap to avoid divide-by-zero (port of Java ThreePointCenter)
    if x2 == x1:
        if x3 != x1:
            x2, y2, x3, y3 = x3, y3, x2, y2
        else:
            x1, y1, x3, y3 = x3, y3, x1, y1
    if y2 == y1:
        x1, y1, x3, y3 = x3, y3, x1, y1
    elif y3 == y1:
        x1, y1, x2, y2 = x2, y2, x1, y1

    dx1 = x2 - x1
    dy1 = y2 - y1
    dx2 = x3 - x1
    dy2 = y3 - y1

    if abs(dy1) < 1e-12 or abs(dy2) < 1e-12:
        return None
    denom = dx1 / dy1 - dx2 / dy2
    if abs(denom) < 1e-12:
        return None  # collinear

    t1 = (x2 * x2 - x1 * x1 + y2 * y2 - y1 * y1) / 2.0
    t2 = (x3 * x3 - x1 * x1 + y3 * y3 - y1 * y1) / 2.0

    cx = (t1 / dy1 - t2 / dy2) / denom
    cy = (t1 - dx1 * cx) / dy1
    r = math.hypot(cx - x1, cy - y1)
    return cx, cy, r


def regio_house_circles(latitude_deg, R_eq):
    """Compute Regiomontanus house circles for the plate.

    Returns a list of (cx, cy, radius) tuples — 8 circles for intermediate
    house cusps (2, 3, 5, 6, 8, 9, 11, 12).  All coords in projection space
    (y-down, relative to NCP at origin).  The meridian (cusps 4/10) and
    horizon (cusps 1/7) are implicit — drawn separately.

    Method:
      * The 12 Regio house cusps correspond to equator points at hour angles
        H_k = -90 + 30·k (k=0 is ASC at H=-90, k=3 is MC at H=0, etc.).
      * Each house great circle passes through the N and S horizon points
        (shared nodes) and one equator point.  In stereographic projection
        these project to circles sharing the same two points.
      * We compute 4 unique circles for H in {30, 60, 120, 150} and mirror
        each across the meridian (x=0) to get the 8 intermediate circles.
    """
    lat = abs(latitude_deg)
    # N horizon: dec=90-φ, RA=RAMC+180 → projection y = +decl_to_radius(90-φ)
    n_r = decl_to_radius(90.0 - lat, R_eq)
    # S horizon: dec=-(90-φ), RA=RAMC → projection y = -decl_to_radius(-(90-φ))
    s_r = decl_to_radius(-(90.0 - lat), R_eq)
    north_pt = (0.0, n_r)
    south_pt = (0.0, -s_r)

    circles = []
    for ha_deg in (30.0, 60.0, 120.0, 150.0):
        ha = math.radians(ha_deg)
        # Equator point in projection coords: (R_eq·sin H, -R_eq·cos H)
        ex = R_eq * math.sin(ha)
        ey = -R_eq * math.cos(ha)
        result = three_point_center(north_pt, south_pt, (ex, ey))
        if result is None:
            continue
        circles.append(result)
        # Mirror across meridian (negate x of centre)
        circles.append((-result[0], result[1], result[2]))
    return circles


# ---------------------------------------------------------------------------
# Circle–circle intersection (for clipping arcs to Capricorn boundary)
# ---------------------------------------------------------------------------

def circle_circle_angles(cx, cy, cr, bx, by, br):
    """Angles (degrees) where circle (cx,cy,cr) intersects circle (bx,by,br).

    Returns (ang1, ang2) on the (cx,cy,cr) circle, or None.
    Angles measured counterclockwise from +x in standard math convention.
    """
    dx = bx - cx
    dy = by - cy
    d = math.hypot(dx, dy)
    if d < 1e-12 or d > cr + br or d < abs(cr - br):
        return None
    a = (cr * cr - br * br + d * d) / (2.0 * d)
    h = math.sqrt(max(0.0, cr * cr - a * a))
    mx = cx + a * dx / d
    my = cy + a * dy / d
    ix1 = mx + h * dy / d
    iy1 = my - h * dx / d
    ix2 = mx - h * dy / d
    iy2 = my + h * dx / d
    ang1 = math.degrees(math.atan2(iy1 - cy, ix1 - cx))
    ang2 = math.degrees(math.atan2(iy2 - cy, ix2 - cx))
    return ang1, ang2
