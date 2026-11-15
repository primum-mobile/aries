# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Polar azimuthal equidistant projection ("PA") for the astrolabe surface.

A. H. Blackwell's chart form as published by Gary Christen (Symmetrical
Astrology, "The Whole Sky", 2018, slides 22-26): the North Celestial Pole is the
centre, the South Celestial Pole is the whole outer rim, and declination maps
linearly to radius. The equator, horizon and meridian are the fixed frame; the
ecliptic, the zodiac and every chart object turn with the rete arc.

Projection space matches ``astrolabe_projection``: NCP at (0, 0), x right,
y down, units of R_eq (equator radius = 1, rim = 2). The screen angle is the
hour angle measured clockwise from the upper meridian, so S/MC is at the top,
west to the right and east to the left, exactly as on Christen's plates.

Every object is placed at its true right ascension and declination. Ecliptic
points stored in the chart's zodiac are returned to tropical longitude with
``util.to_tropical_lon`` before conversion, so sidereal charts project to the
same sky position as tropical ones.

Object families (display projection of the chart; wheel toggles apply):
  body       visible planets, both nodes, Chiron      true RA/Dec
  point      Fortune, Vertex, prenatal Syzygy/Eclipse ecliptic point
  angle      directed Asc, MC, Dsc, IC                ecliptic ∩ horizon/meridian
  aries      vernal point (0° Aries, Christen's ♈)    RA 0, Dec 0
  ring       the context-active outer-ring family     stars/asteroids true
                                                      RA/Dec, zodiacal
                                                      constructions ecliptic
Dsc/IC are unlabelled angle objects: a cross where the ecliptic meets the
horizon and lower meridian, without a rim label. House cusps are unsupported here because the PA is a mundane
equatorial frame with no house division in Christen's form.
"""
from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

import astrology
import common
import fixstars
import fortune
import houses
import mtexts
import planets
import util
from webapp.daemon.surveil_service import format_zodiac_position

_DEG = math.pi / 180.0
RIM = 2.0
# Fitted plates stop this far below the deepest frame point or object, on a
# 5° declination step, so nothing the chart uses touches the edge.
_FIT_MARGIN = 4.0
_FIT_STEP = 5.0
# Consecutive projected samples further apart than this cross the rim (the
# south pole spreads to the whole circle) and must not be joined.
_PATH_BREAK = 0.5
_ROUND = 4
_EARTH_ROUND = 4
_WORLD_RESOURCE = Path("Res") / "astrocart" / "natural-earth-admin0-110m.geojson"

_ALMUCANTAR_ALTS = (10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0)
_AZIMUTHS = (-60.0, -30.0, 0.0, 30.0, 60.0)


# ---------------------------------------------------------------------------
# Spherical math
# ---------------------------------------------------------------------------

def dec_to_radius(dec_deg: float) -> float:
    return (90.0 - float(dec_deg)) / 90.0


def project(ha_deg: float, dec_deg: float) -> tuple[float, float]:
    """(hour angle, declination) → projection space (NCP origin, y down)."""
    r = dec_to_radius(dec_deg)
    a = float(ha_deg) * _DEG
    return (r * math.sin(a), -r * math.cos(a))


def normalize_ha(ha_deg: float) -> float:
    value = (float(ha_deg) + 180.0) % 360.0 - 180.0
    return 180.0 if value == -180.0 else value


def horizontal_to_equatorial(alt_deg: float, az_deg: float, lat_deg: float) -> tuple[float, float]:
    """Altitude/azimuth (from south, positive west) → (hour angle, declination)."""
    h, a, phi = alt_deg * _DEG, az_deg * _DEG, lat_deg * _DEG
    sin_dec = math.sin(phi) * math.sin(h) - math.cos(phi) * math.cos(h) * math.cos(a)
    dec = math.asin(max(-1.0, min(1.0, sin_dec)))
    ha = math.atan2(
        math.cos(h) * math.sin(a),
        math.sin(h) * math.cos(phi) + math.cos(h) * math.cos(a) * math.sin(phi),
    )
    return math.degrees(ha), math.degrees(dec)


def altitude(ha_deg: float, dec_deg: float, lat_deg: float) -> float:
    h, d, phi = ha_deg * _DEG, dec_deg * _DEG, lat_deg * _DEG
    sin_alt = math.sin(phi) * math.sin(d) + math.cos(phi) * math.cos(d) * math.cos(h)
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))


def ecliptic_to_equatorial(lon_deg: float, lat_deg: float, obliquity_deg: float) -> tuple[float, float]:
    """Tropical ecliptic (λ, β) → (RA, Dec) in degrees."""
    lam, beta, eps = lon_deg * _DEG, lat_deg * _DEG, obliquity_deg * _DEG
    sin_dec = math.sin(beta) * math.cos(eps) + math.cos(beta) * math.sin(eps) * math.sin(lam)
    dec = math.asin(max(-1.0, min(1.0, sin_dec)))
    ra = math.atan2(
        math.sin(lam) * math.cos(eps) - math.tan(beta) * math.sin(eps),
        math.cos(lam),
    )
    return math.degrees(ra) % 360.0, math.degrees(dec)


def directed_mc_lon(ramc_deg: float, obliquity_deg: float) -> float:
    """Tropical longitude of the ecliptic on the upper meridian."""
    ra, eps = ramc_deg * _DEG, obliquity_deg * _DEG
    return math.degrees(math.atan2(math.sin(ra), math.cos(ra) * math.cos(eps))) % 360.0


def directed_asc_lon(ramc_deg: float, obliquity_deg: float, lat_deg: float) -> float:
    """Tropical longitude of the ecliptic on the eastern horizon."""
    ra, eps, phi = ramc_deg * _DEG, obliquity_deg * _DEG, lat_deg * _DEG
    return math.degrees(math.atan2(
        math.cos(ra),
        -(math.sin(ra) * math.cos(eps) + math.tan(phi) * math.sin(eps)),
    )) % 360.0


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _paths(samples: Iterable[tuple[float, float]], *, closed: bool) -> list[list[list[float]]]:
    """Project (ha, dec) samples; split wherever the curve crosses the rim."""
    points = [project(ha, dec) for ha, dec in samples]
    if closed and points:
        points.append(points[0])
    paths: list[list[list[float]]] = []
    current: list[list[float]] = []
    previous = None
    for x, y in points:
        if previous is not None and math.hypot(x - previous[0], y - previous[1]) > _PATH_BREAK:
            if len(current) > 1:
                paths.append(current)
            current = []
        current.append([round(x, _ROUND), round(y, _ROUND)])
        previous = (x, y)
    if len(current) > 1:
        paths.append(current)
    return paths


def _almucantar_samples(alt: float, lat: float, step: float = 2.0):
    return [horizontal_to_equatorial(alt, az, lat) for az in _frange(0.0, 360.0, step)]


def _vertical_samples(az: float, lat: float, step: float = 2.0):
    """The full vertical great circle through azimuth *az* and *az*+180."""
    up = [horizontal_to_equatorial(alt, az, lat) for alt in _frange(-90.0, 90.0, step)]
    down = [horizontal_to_equatorial(alt, az + 180.0, lat) for alt in _frange(90.0, -90.0, -step)]
    return up + down


def _frange(start: float, stop: float, step: float) -> list[float]:
    count = int(round(abs(stop - start) / abs(step)))
    return [start + i * step for i in range(count)]


def _ecliptic_samples(eramc: float, obliquity: float, step: float = 1.0, *, zodiac_offset: float = 0.0):
    """Start the display ruler at chart-zodiac zero, including sidereal plates."""
    out = []
    for lon in _frange(0.0, 360.0, step):
        ra, dec = ecliptic_to_equatorial(lon + zodiac_offset, 0.0, obliquity)
        out.append((eramc - ra, dec))
    return out


def _longitude_circle_samples(lon: float, eramc: float, obliquity: float, step: float = 3.0):
    """Great circle of ecliptic longitude *lon* and *lon*+180 through both
    ecliptic poles. Every point on its *lon* half shares that zodiacal degree,
    so through the Asc it is the zodiacal horizon and through the MC the
    zodiacal meridian."""
    out = []
    for half, betas in ((lon, _frange(-90.0, 90.0, step)), (lon + 180.0, _frange(90.0, -90.0, -step))):
        for beta in betas:
            ra, dec = ecliptic_to_equatorial(half, beta, obliquity)
            out.append((eramc - ra, dec))
    return out


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------

def _object(
    *,
    id: str,
    family: str,
    ra: float,
    dec: float,
    eramc: float,
    lat: float,
    color: Optional[str] = None,
    color_role: Optional[str] = None,
    glyph: Optional[str] = None,
    glyph_font: str = "symbol",
    segments: Optional[list] = None,
    label: Optional[str] = None,
    extra: Optional[dict] = None,
) -> dict[str, Any]:
    ha = normalize_ha(eramc - ra)
    x, y = project(ha, dec)
    payload = {
        "id": id,
        "family": family,
        "ra": round(float(ra), 6),
        "decl": round(float(dec), 6),
        "ha": round(ha, 6),
        "x": round(x, _ROUND),
        "y": round(y, _ROUND),
        "above": altitude(ha, dec, lat) > 0.0,
        "glyph": glyph,
        "glyphFont": glyph_font,
        "segments": segments,
        "label": label,
        "color": color,
        "colorRole": color_role,
    }
    if extra:
        payload.update(extra)
    return payload


def _hover(name: Optional[str], lon) -> dict[str, Any]:
    """Hover caption fields: localized name and chart-zodiac position."""
    return {"hoverName": str(name or ""), "hoverPosition": format_zodiac_position(lon)}


def _tropical(chrt, lon: float) -> float:
    return util.to_tropical_lon(float(lon), float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0))


def _ecliptic_point_equatorial(chrt, lon: float, lat: float = 0.0) -> tuple[float, float]:
    return ecliptic_to_equatorial(_tropical(chrt, lon), lat, chrt.obl[0])


def _body_objects(chrt, opts, eramc: float, lat: float) -> list[dict[str, Any]]:
    from webapp.daemon.astrolabe_service import _body_color_hex, _body_name
    from webapp.daemon.display_palette import chart_body_color_role, minor_dignity_display_facts

    out = []
    for body_id in common.common.get_visible_chart_planet_ids(
        chrt, opts, include_descnode=True, include_chiron=True,
    ):
        body = common.common.get_chart_planet(chrt, body_id)
        glyph = common.common.get_planet_glyph(body_id)
        if body is None or not glyph:
            continue
        try:
            ra = float(body.dataEqu[planets.Planet.RAEQU])
            dec = float(body.dataEqu[planets.Planet.DECLEQU])
            lon = float(body.data[planets.Planet.LONG])
        except Exception:
            continue
        color = _body_color_hex(chrt, opts, body_id)
        out.append(_object(
            id=f"planet:{int(body_id)}",
            family="body",
            ra=ra,
            dec=dec,
            eramc=eramc,
            lat=lat,
            glyph=glyph,
            color=color,
            color_role=chart_body_color_role(opts, chrt, body_id, resolved_color=color),
            extra={
                "bodyId": int(body_id),
                **_hover(_body_name(body_id), lon),
                "isSun": bool(body_id == astrology.SE_SUN),
                **minor_dignity_display_facts(chrt, body_id),
            },
        ))
    return out


def _point_objects(chrt, opts, eramc: float, lat: float) -> list[dict[str, Any]]:
    from webapp.daemon.astrolabe_service import _body_color_hex, _body_name
    from webapp.daemon.display_palette import chart_body_color_role
    from webapp.frontend.scripts import export_chart_json

    out = []
    if getattr(opts, "showlof", False) and getattr(chrt, "fortune", None) is not None:
        try:
            lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
        except Exception:
            lon = None
        if lon is not None:
            ra, dec = _ecliptic_point_equatorial(chrt, lon)
            fortune_id = common.CHART_OBJECT_FORTUNE
            color = _body_color_hex(chrt, opts, fortune_id)
            out.append(_object(
                id="point:fortune", family="point", ra=ra, dec=dec, eramc=eramc, lat=lat,
                glyph=common.common.fortune, color=color,
                color_role=chart_body_color_role(
                    opts, chrt, fortune_id, is_fortune=True, resolved_color=color,
                ),
                extra={"longitude": lon, **_hover(_body_name(fortune_id), lon)},
            ))
    for semantic_id, exporter in (
        ("point:vertex", export_chart_json.export_vertex),
        ("point:syzygy", export_chart_json.export_syzygy),
        ("point:eclipse", export_chart_json.export_recent_eclipse),
    ):
        try:
            entry = exporter(chrt)
        except Exception:
            entry = None
        if not entry:
            continue
        ra, dec = _ecliptic_point_equatorial(chrt, entry["longitude"])
        out.append(_object(
            id=semantic_id, family="point", ra=ra, dec=dec, eramc=eramc, lat=lat,
            glyph=entry.get("glyph"),
            glyph_font="text" if entry.get("glyphFont") == "text" else "symbol",
            label=entry.get("label"),
            color=entry.get("color"),
            extra=_hover(entry.get("label") or entry.get("glyph"), entry["longitude"]),
        ))
    return out


def _angle_objects(chrt, eramc: float, lat: float) -> list[dict[str, Any]]:
    obliquity = chrt.obl[0]
    asc = directed_asc_lon(eramc, obliquity, lat)
    mc = directed_mc_lon(eramc, obliquity)
    out = []
    # Christen labels only As and MC; Dsc and IC get the cross on the
    # ecliptic without a rim label (they sit on the horizon / lower meridian).
    for semantic_id, key, name_key, lon in (
        ("angle:asc", "Asc", "Asc", asc),
        ("angle:mc", "MC", "MC", mc),
        ("angle:dsc", None, "Desc", (asc + 180.0) % 360.0),
        ("angle:ic", None, "IC", (mc + 180.0) % 360.0),
    ):
        ra, dec = ecliptic_to_equatorial(lon, 0.0, obliquity)
        out.append(_object(
            id=semantic_id, family="angle", ra=ra, dec=dec, eramc=eramc, lat=lat,
            glyph=str(mtexts.txts.get(key, key)) if key else None, glyph_font="text",
            extra={"hoverName": str(mtexts.txts.get(name_key, name_key))},
        ))
    return out


def _aries_point_object(opts, eramc: float, lat: float) -> dict[str, Any]:
    from webapp.daemon.astrolabe_service import _rgb_to_hex
    from webapp.daemon.display_palette import sign_color_role

    signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
    color = _rgb_to_hex(common.get_sign_color(opts, 0, bw=bool(getattr(opts, "bw", False))))
    return _object(
        id="point:aries", family="aries", ra=0.0, dec=0.0, eramc=eramc, lat=lat,
        glyph=signs[0], color=color,
        color_role=sign_color_role(opts, 0, resolved_color=color),
    )


def _fixstar_equatorial(chrt) -> dict[str, tuple[float, float]]:
    rows = getattr(getattr(chrt, "fixstars", None), "data", None) or ()
    out = {}
    for row in rows:
        try:
            out[str(row[fixstars.FixStars.NOMNAME])] = (
                float(row[fixstars.FixStars.RA]),
                float(row[fixstars.FixStars.DECL]),
            )
        except Exception:
            continue
    return out


def _asteroid_ecliptic(chrt) -> dict[int, tuple[float, float]]:
    out = {}
    for body in getattr(getattr(chrt, "asteroids", None), "asteroids", None) or ():
        data = getattr(body, "data", None)
        if not data or len(data) < 2:
            continue
        try:
            out[int(getattr(body, "aId"))] = (float(data[0]), float(data[1]))
        except Exception:
            continue
    return out


def _ring_objects(
    chrt, opts, eramc: float, lat: float, body_ids: set[int],
) -> tuple[str, list[dict[str, Any]]]:
    """The context-active outer-ring family at its true sky position.

    A ring asteroid that is already a plotted body (Chiron) keeps one marker.
    """
    from webapp.daemon.aspect_list_service import _active_outer_ring_items

    mode, items = _active_outer_ring_items(chrt, "primary", opts)
    if not items:
        return mode, []
    stars = _fixstar_equatorial(chrt) if any(
        (item.get("motionRef") or {}).get("kind") == "fixedStar" for item in items
    ) else {}
    asteroids = _asteroid_ecliptic(chrt) if any(
        (item.get("motionRef") or {}).get("kind") == "ephemerisBody" for item in items
    ) else {}
    out = []
    for item in items:
        try:
            lon = float(item["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        ref = item.get("motionRef") or {}
        if ref.get("kind") == "ephemerisBody" and int(ref.get("bodyId", -1)) in body_ids:
            continue
        position = None
        if ref.get("kind") == "fixedStar":
            position = stars.get(str(ref.get("code") or ""))
        elif ref.get("kind") == "ephemerisBody":
            ecliptic = asteroids.get(int(ref.get("bodyId", -1)))
            if ecliptic is not None:
                position = _ecliptic_point_equatorial(chrt, *ecliptic)
        if position is None:
            # Zodiacal constructions (Lots, midpoints, antiscia, dodecatemoria)
            # are defined on the ecliptic itself.
            position = _ecliptic_point_equatorial(chrt, lon)
        ra, dec = position
        out.append(_object(
            id=str(item.get("semanticId") or item.get("id")),
            family="ring",
            ra=ra, dec=dec, eramc=eramc, lat=lat,
            segments=item.get("segments"),
            label=item.get("label"),
            extra={
                "ringFamily": item.get("family"),
                **({"longitude": lon} if ref.get("kind") == "fixedStar" else {}),
                **({"starCode": str(ref.get("code"))} if ref.get("kind") == "fixedStar" else {}),
                **_hover(item.get("label"), lon),
            },
        ))
    return mode, out


def _marked_star_objects(
    rows, opts, eramc: float, lat: float, ring_codes: set[str],
) -> list[dict[str, Any]]:
    """User-marked stars as rim-labelled objects, like the outer-ring stars."""
    from webapp.daemon.astrolabe_service import _star_display_name

    out = []
    for row in rows:
        code = str(row[fixstars.FixStars.NOMNAME])
        if code in ring_codes:
            continue
        try:
            ra = float(row[fixstars.FixStars.RA])
            dec = float(row[fixstars.FixStars.DECL])
            lon = float(row[fixstars.FixStars.LON])
        except Exception:
            continue
        name = _star_display_name(row, opts)
        out.append(_object(
            id=f"star:{code}", family="ring", ra=ra, dec=dec, eramc=eramc, lat=lat,
            label=name,
            extra={"ringFamily": "markedStar", "starCode": code, "longitude": lon, **_hover(name, lon)},
        ))
    return out


def _star_pointers(rows, opts, eramc: float) -> list[dict[str, Any]]:
    from webapp.daemon.astrolabe_service import _star_display_name, star_facts

    out = []
    for row in rows:
        try:
            ra = float(row[fixstars.FixStars.RA])
            dec = float(row[fixstars.FixStars.DECL])
            lon = float(row[fixstars.FixStars.LON])
        except Exception:
            continue
        x, y = project(normalize_ha(eramc - ra), dec)
        out.append({
            "name": str(row[fixstars.FixStars.NOMNAME]),
            "lon": lon,
            "starName": _star_display_name(row, opts),
            "position": format_zodiac_position(lon),
            **star_facts(row, opts),
            "ra": ra, "decl": dec, "x": round(x, _ROUND), "y": round(y, _ROUND),
        })
    return out


# ---------------------------------------------------------------------------
# Geometry payload
# ---------------------------------------------------------------------------

def plate_limit_declination(horizon_samples, objects, lat: float) -> float:
    """Southern declination at which a fitted plate ends.

    The full PA spreads the south pole around the whole rim, so the far
    southern sky (empty for a northern chart) takes a wide band of the plate
    and shrinks everything else. A fitted plate keeps the equidistant scale but
    ends just below the deepest point it needs: the horizon, the nadir and
    prime vertical (declination -lat), and every chart object.
    """
    deepest = min(
        min(dec for _ha, dec in horizon_samples),
        -lat,
        min((float(obj["decl"]) for obj in objects), default=0.0),
    )
    limit = math.floor((deepest - _FIT_MARGIN) / _FIT_STEP) * _FIT_STEP
    return max(-90.0, limit)


def build_polar_geometry(
    chrt, opts, eramc: float, *, lattice: bool = False, full_sphere: bool = False,
    star_rows: Optional[list] = None,
    marked_rows: Optional[list] = None,
) -> dict[str, Any]:
    """Frame, rotating ecliptic and objects for one rete orientation.

    The altitude/azimuth lattice is optional plate engraving; it is only
    shipped when the view shows it, keeping the per-step payload small.
    ``full_sphere`` keeps Christen's complete plate out to the south pole;
    otherwise the plate is fitted (see ``plate_limit_declination``).
    """
    obliquity = float(chrt.obl[0])
    lat = float(chrt.place.lat)
    # The horizon passes through both poles on the terrestrial equator, where
    # it would fold onto the rim; nudge the plate by a negligible amount.
    plate_lat = lat if abs(lat) > 1e-3 else math.copysign(1e-3, lat or 1.0)

    horizon_samples = _almucantar_samples(0.0, plate_lat)
    bodies = _body_objects(chrt, opts, eramc, plate_lat)
    points = _point_objects(chrt, opts, eramc, plate_lat)
    angles = _angle_objects(chrt, eramc, plate_lat)
    ring_mode, ring = _ring_objects(
        chrt, opts, eramc, plate_lat, {int(body["bodyId"]) for body in bodies},
    )
    ring_star_codes = {str(obj["starCode"]) for obj in ring if obj.get("starCode")}
    marked = _marked_star_objects(marked_rows or (), opts, eramc, plate_lat, ring_star_codes)
    objects = [
        *bodies, *points, *angles, _aries_point_object(opts, eramc, plate_lat), *ring, *marked,
    ]
    limit_dec = -90.0 if full_sphere else plate_limit_declination(
        horizon_samples, objects, plate_lat,
    )
    rim = dec_to_radius(limit_dec)

    frame = {
        "horizon": _paths(horizon_samples, closed=True),
        "primeVertical": _paths(_vertical_samples(90.0, plate_lat), closed=True),
        "meridian": {"x1": 0.0, "y1": -rim, "x2": 0.0, "y2": rim},
        "sixHour": {"x1": -rim, "y1": 0.0, "x2": rim, "y2": 0.0},
        "almucantars": [
            {"alt": alt, "paths": _paths(_almucantar_samples(alt, plate_lat, 4.0), closed=True)}
            for alt in _ALMUCANTAR_ALTS
        ] if lattice else [],
        "azimuths": [
            {"az": az, "paths": _paths(_vertical_samples(az, plate_lat, 4.0), closed=True)}
            for az in _AZIMUTHS
        ] if lattice else [],
        # Where a point's zodiacal degree reaches Asc/Dsc (MC/IC): compare with
        # the true horizon and meridian to see zodiacal vs in-mundo angularity.
        "zodiacalHorizon": _paths(_longitude_circle_samples(
            directed_asc_lon(eramc, obliquity, plate_lat), eramc, obliquity,
        ), closed=True),
        "zodiacalMeridian": _paths(_longitude_circle_samples(
            directed_mc_lon(eramc, obliquity), eramc, obliquity,
        ), closed=True),
    }

    ecl_ra, ecl_pole_dec = 270.0, 90.0 - obliquity
    frame_points = {
        "zenith": project(0.0, plate_lat),
        "nadir": project(180.0, -plate_lat),
        "east": project(-90.0, 0.0),
        "west": project(90.0, 0.0),
        "ramc": project(0.0, 0.0),
        "eclipticPole": project(normalize_ha(eramc - ecl_ra), ecl_pole_dec),
    }

    return {
        "projection": "polarEquidistant",
        "radii": {
            "equator": 1.0,
            "rim": rim,
            "cancer": dec_to_radius(obliquity),
            "capricorn": dec_to_radius(-obliquity),
            "arctic": dec_to_radius(90.0 - obliquity),
            "antarctic": dec_to_radius(obliquity - 90.0),
        },
        "frame": frame,
        "framePoints": {
            key: {"x": round(x, _ROUND), "y": round(y, _ROUND)}
            for key, (x, y) in frame_points.items()
        },
        # Northern plates keep the NCP in the sky; southern plates keep the
        # south pole (the rim) in the sky instead.
        "skyContainsCenter": plate_lat > 0.0,
        "ecliptic": _paths(_ecliptic_samples(
            eramc, obliquity, zodiac_offset=float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0),
        ), closed=True),
        "objects": objects,
        # The plate edge: the south pole on a full plate, else the fitted limit.
        "rimDeclination": limit_dec,
        "ringMode": ring_mode,
        "stars": _star_pointers(
            getattr(getattr(chrt, "fixstars", None), "data", None) or () if star_rows is None else star_rows,
            opts, eramc,
        ),
    }


# ---------------------------------------------------------------------------
# Terrestrial layer
# ---------------------------------------------------------------------------

def _base_dir() -> Path:
    configured = os.environ.get("ARIES_DAEMON_BASE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


_WORLD_LOCK = threading.Lock()
_WORLD_LINES: Optional[list[list[tuple[float, float]]]] = None
_EARTH_CACHE: dict[float, dict[str, Any]] = {}


def _world_lines() -> list[list[tuple[float, float]]]:
    """Natural Earth admin-0 outlines (coastlines and borders) as lon/lat lines."""
    global _WORLD_LINES
    with _WORLD_LOCK:
        if _WORLD_LINES is None:
            data = json.loads((_base_dir() / _WORLD_RESOURCE).read_text(encoding="utf-8"))
            lines: list[list[tuple[float, float]]] = []
            for feature in data.get("features") or ():
                geometry = feature.get("geometry") or {}
                kind = geometry.get("type")
                coordinates = geometry.get("coordinates") or ()
                if kind == "LineString":
                    groups = (coordinates,)
                elif kind in ("MultiLineString", "Polygon"):
                    groups = coordinates
                elif kind == "MultiPolygon":
                    groups = [ring for polygon in coordinates for ring in polygon]
                else:
                    continue
                for line in groups:
                    lines.append([(float(lon), float(lat)) for lon, lat, *_ in line])
            _WORLD_LINES = lines
        return _WORLD_LINES


def _is_seam(a: tuple[float, float], b: tuple[float, float]) -> bool:
    """Edges along the antimeridian cut or the south pole are data seams."""
    if abs(a[0]) >= 179.999 and abs(b[0]) >= 179.999 and a[0] * b[0] > 0:
        return True
    return a[1] <= -89.9 and b[1] <= -89.9


def earth_geometry(place_lon: float) -> dict[str, Any]:
    """World outlines seen from the sky frame, as flat [x0, y0, x1, y1, ..].

    Each terrestrial point lies under its own zenith: hour angle is the
    longitude difference from the chart place, declination is the latitude,
    so the chart place sits on the zenith. The layer is fixed to the horizon
    frame and depends only on the chart longitude; the rete turns above it.
    """
    key = round(float(place_lon), 6)
    with _WORLD_LOCK:
        cached = _EARTH_CACHE.get(key)
    if cached is not None:
        return cached

    def xy(point: tuple[float, float]) -> tuple[float, float]:
        return project(normalize_ha(key - point[0]), point[1])

    lines: list[list[float]] = []
    for source in _world_lines():
        line: list[float] = []
        for a, b in zip(source, source[1:]):
            if _is_seam(a, b):
                if len(line) >= 4:
                    lines.append(line)
                line = []
                continue
            if not line:
                line.extend(round(v, _EARTH_ROUND) for v in xy(a))
            line.extend(round(v, _EARTH_ROUND) for v in xy(b))
        if len(line) >= 4:
            lines.append(line)
    payload = {"lon": key, "lines": lines}
    with _WORLD_LOCK:
        if len(_EARTH_CACHE) > 16:
            _EARTH_CACHE.clear()
        _EARTH_CACHE[key] = payload
    return payload
