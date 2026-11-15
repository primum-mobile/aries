# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side planispheric astrolabe geometry.

Canonical projection owner: ``astrolabe_projection`` (the wx-free stereographic
math module the desktop ``astrolabechart.AstrolabeChart`` draws with). This
service does NOT reimplement that math and does NOT import the wx frame
(``astrolabechart.py`` ``import wx``) — it lifts the *layout* arithmetic from
``AstrolabeChart.__init__`` (astrolabechart.py:137-166) and the body / ecliptic
projection from ``_draw_ecliptic`` / ``_draw_planets`` / ``_iter_visible_bodies``
(astrolabechart.py:241-275, 860-982), computing everything in a NORMALIZED
projection space (``R_eq = 1.0``) so the Canvas2D skin can scale freely.

Projection (astrolabe_projection.py): polar stereographic onto the equatorial
plane from the pole below the horizon. The visible pole is at the centre of the
diagram (the NCP for northern charts, the SCP for southern ones), MC at 12
o'clock, west to the right, east to the left, all coords (x right, y down)
relative to the centre. A southern plate is the northern plate for |lat| with
the sky reflected through the equator; its rim (``tropicCapricorn``, the outer
tropic) is the Tropic of Cancer and ``tropicCancer`` (the inner one) is the
Tropic of Capricorn.

Output shape (all radii/coords in units of ``R_eq`` unless noted):
  {
    "name": str, "lat": float, "lon": float,
    "pole": "north" | "south",                # celestial pole at the centre
    "plateLat": float,                        # latitude the tympan is drawn for (> 0)
    "obliquity": deg, "ramc": deg, "delta": deg, "eramc": deg,
    "jd": float,                              # chart moment (UT Julian day)
    "center": {"horizonOffset": ..},          # NCP→horizon-centre on screen (+y down)
    "radii": {"equator","cancer","capricorn"},
    "tympan": {
      "horizon": {cx,cy,r}, "equator": {..}, "tropicCancer": {..},
      "tropicCapricorn": {..}, "meridian": {x1,y1,x2,y2},
      "houseLines": [{house,longitude,construction,paths:[[{x,y}, ..]]}, ..],
      "almucantars": [{alt,cx,cy,r}, ..],      # altitude circles every 5°
      "azimuths": [{az,cx,cy,r,toZenith}, ..], # great circles through the zenith, every 5°
      "azimuthStop": {alt,cx,cy,r},            # where azimuths off 15° bearings stop (85°)
      "hourLines": [{hour,period,paths:[[{x,y}, ..]]}, ..],  # unequal hours, day and night
    },
    "rete": {
      "ecliptic": {cx,cy,r},                   # eccentric gold circle
      "signBoundaries": [{sign,x,y}, ..],      # 12 cusp points on the ecliptic
      "signGlyphLabels": [{sign,glyph,x,y}, ..],
      "stars": [{name,nom,ra,decl,x,y}, ..],   # bright-star pointers
    },
    "bodies": [{id,glyph,color,ra,decl,lon,
                sphere:{x,y}, ecliptic:{x,y}, above:bool, isSun:bool}, ..],
  }
"""
from __future__ import annotations

import datetime
import copy
import math
import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import arabicparts
import astrology
import astrolabe_projection as proj  # wx-free stereographic math
from webapp.daemon import astrolabe_plate_lines as plate_lines
from webapp.daemon import polar_azimuthal_service
from webapp.daemon.astrolabe_contacts import contact_orb_deg, rete_contacts
from webapp.daemon.astrolabe_house_geometry import CONSTRUCTIONS, house_paths
import chart as chart_mod
import common
import fixstars
import fortune
import houses
import planets
import util
import dateformat
import mtexts
import pd_point_selection
import pdsinchart
import symbolic_time
import primdirs
from primdirs import PrimDirs
from engine import pd_in_chart, symbolic_projection
from webapp.daemon.astrolabe_pd_geometry import (
    attach_display_loci, build_focus as build_pd_focus, build_overlay as build_pd_overlay,
    build_significators as build_pd_significators,
)
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    minor_dignity_display_facts,
    chart_body_color_role,
    effective_display_options,
    sign_color_role,
)
from webapp.daemon.directions_service import _prom_label, _sig_label
from webapp.daemon.surveil_service import format_zodiac_position
from webapp.daemon.primdir_points import primdir_point_glyph
from webapp.frontend.scripts import export_chart_json

_DEG = math.pi / 180.0

# Normalized projection: every circle/point is expressed in units of R_eq, so
# the skin chooses the on-screen scale. Matches astrolabechart's R_eq-relative
# proj.* outputs (astrolabe_projection returns coords already divided by R_eq
# when R_eq=1.0).
_R_EQ = 1.0

# Plate projections. Stereographic is the classical planispheric astrolabe;
# polar equidistant is Blackwell's PA (see polar_azimuthal_service).
PROJECTION_STEREOGRAPHIC = "stereographic"
PROJECTION_POLAR_EQUIDISTANT = "polarEquidistant"
PROJECTIONS = (PROJECTION_STEREOGRAPHIC, PROJECTION_POLAR_EQUIDISTANT)

# Circle palette — verbatim port of astrolabechart.py:28-30, used for the
# Equator / Horizon / Ecliptic text-label colours the daemon ships.
_CLR_HORIZON = (62, 130, 196)
_CLR_ECLIPTIC = (198, 138, 34)
_CLR_EQUATOR = (120, 130, 145)

# Atmospheric sky color ramp — directed Sun altitude (deg) -> RGB. Verbatim port
# of astrolabechart._SKY_STOPS (astrolabechart.py:33-37) so the React skin paints
# the same sun-altitude-driven sky/ground the desktop renderer does.
_SKY_STOPS = [
    (30, (136, 180, 220)), (10, (120, 168, 212)), (0, (232, 150, 90)),
    (-3, (188, 96, 96)), (-6, (92, 80, 128)), (-12, (36, 44, 88)),
    (-18, (14, 18, 40)), (-90, (6, 8, 18)),
]

# Window (years of life either side of the rete arc) within which a primary
# direction is listed in the nearby-events overlay. Mirrors
# _AstrolabeStepper.NEARBY_PD_WINDOW_YEARS (morin.py:19307).
_NEARBY_PD_WINDOW_YEARS = 0.5


def _sky_color_for_altitude(alt_deg):
    """Interpolate sky RGB from directed Sun altitude.

    Verbatim port of astrolabechart._sky_color_for_altitude
    (astrolabechart.py:40-50).
    """
    if alt_deg >= _SKY_STOPS[0][0]:
        return _SKY_STOPS[0][1]
    for i in range(len(_SKY_STOPS) - 1):
        a1, c1 = _SKY_STOPS[i]
        a2, c2 = _SKY_STOPS[i + 1]
        if a1 >= alt_deg >= a2:
            t = (a1 - alt_deg) / max(a1 - a2, 1e-9)
            return tuple(int(c1[j] + (c2[j] - c1[j]) * t) for j in range(3))
    return _SKY_STOPS[-1][1]


def _pd_years_per_degree(options):
    """Years of life per degree of directed arc for the active PD key.

    Inlined port of chart_context_view._pd_years_per_degree
    (chart_context_view.py:96-108); that module imports chart_context which
    pulls in wx transitively, so the daemon ports the tiny arithmetic here.
    """
    if options is None:
        return 1.0
    if getattr(options, "pdkeydyn", False):
        coeff = PrimDirs.staticData[PrimDirs.NAIBOD][PrimDirs.COEFF]
        return coeff if coeff > 0.0 else 1.0
    if options.pdkeys == PrimDirs.CUSTOMER:
        deg_per_year = options.pdkeydeg + options.pdkeymin / 60.0 + options.pdkeysec / 3600.0
        if deg_per_year <= 0.0:
            return 1.0
        return 1.0 / deg_per_year
    coeff = PrimDirs.staticData[options.pdkeys][PrimDirs.COEFF]
    return coeff if coeff > 0.0 else 1.0


def _directed_sun_altitude(chrt, latitude, eramc):
    """Altitude (deg) of the Sun at the current rete orientation.

    Verbatim port of AstrolabeChart._directed_sun_altitude
    (astrolabechart.py:343-355).
    """
    return _directed_sun_horizontal(chrt, latitude, eramc)[0]


def _directed_sun_horizontal(chrt, latitude, eramc):
    """True (unrefracted) altitude and azimuth (deg, from north through east)
    of the Sun at the current rete orientation. RA/declination are the
    tropical equatorial ones in every zodiac (planets.Planet), so sidereal
    charts get the same sky."""
    sun = chrt.planets.planets[astrology.SE_SUN]
    if sun is None:
        return 0.0, 180.0
    ra = sun.dataEqu[planets.Planet.RAEQU]
    dec = sun.dataEqu[planets.Planet.DECLEQU]
    ha = (eramc - ra) * _DEG
    dec_rad = dec * _DEG
    lat_rad = latitude * _DEG
    sin_alt = (math.sin(lat_rad) * math.sin(dec_rad)
               + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha))
    east = -math.cos(dec_rad) * math.sin(ha)
    north = (math.sin(dec_rad) * math.cos(lat_rad)
             - math.cos(dec_rad) * math.cos(ha) * math.sin(lat_rad))
    altitude = math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))
    return altitude, math.degrees(math.atan2(east, north)) % 360.0


def _rgb_to_hex(rgb) -> str:
    try:
        r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return "#cdcdd1"
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _body_color_hex(chrt, options, body_id) -> str:
    """Mirror AstrolabeChart._get_body_color (astrolabechart.py:195-208)."""
    if body_id == common.CHART_OBJECT_FORTUNE:
        if getattr(options, "useplanetcolors", False):
            idx = min(astrology.SE_PLUTO + 2, len(options.clrindividual) - 1)
            return _rgb_to_hex(options.clrindividual[idx])
        return _rgb_to_hex(options.clrperegrin)
    if getattr(options, "useplanetcolors", False):
        idx = min(common.common.get_planet_color_index(body_id), len(options.clrindividual) - 1)
        return _rgb_to_hex(options.clrindividual[idx])
    if body_id == astrology.SE_CHIRON:
        return _rgb_to_hex(options.clrperegrin)
    try:
        from .display_palette import chart_dignity_color

        return _rgb_to_hex(chart_dignity_color(chrt, options, body_id))
    except Exception:
        return _rgb_to_hex(options.clrperegrin)


_ASTROLABE_STAR_CACHE: dict[tuple, list] = {}
_ASTROLABE_STAR_CACHE_SIZE = 8
ASTROLABE_MAX_STARS = 200  # FixStarSelectionModel.MAX_SELECTED (fixstarsdlg.py:118)
# Star field drawn by the "Show fixed stars" layer: the Settings list, the
# classic bright rete stars, or the whole Swiss Ephemeris catalogue. Catalogue
# fields hold real stars only; deep-sky objects and reference points appear
# when the Settings list or Marked stars name them.
STAR_FIELDS = ("settings", "bright", "catalogue")
BRIGHT_STAR_MAGNITUDE = 2.5


_STAR_CATALOGUE_FACTS: Optional[tuple[int, dict[str, float], tuple]] = None


def _star_catalogue_facts() -> tuple[dict[str, float], tuple]:
    """Magnitudes and real-star codes, cached per catalogue read."""
    global _STAR_CATALOGUE_FACTS
    from webapp.daemon.options_service import _read_fixstar_catalog

    catalog = _read_fixstar_catalog()
    if _STAR_CATALOGUE_FACTS is None or _STAR_CATALOGUE_FACTS[0] != id(catalog):
        mags = {
            str(row["code"]): float(row["mag"])
            for row in catalog if row.get("code") and row.get("mag") is not None
        }
        stars = tuple(
            (str(row["code"]), row.get("mag"))
            for row in catalog if row.get("code") and row.get("kind") == "star"
        )
        _STAR_CATALOGUE_FACTS = (id(catalog), mags, stars)
    return _STAR_CATALOGUE_FACTS[1], _STAR_CATALOGUE_FACTS[2]


def star_magnitudes() -> dict[str, float]:
    """Visual magnitude per catalogue code that has a real one."""
    return _star_catalogue_facts()[0]


def star_field_codes(field: str) -> Optional[tuple[str, ...]]:
    """Codes for a star field; ``None`` is the chart's Settings list."""
    if field == "bright":
        return tuple(sorted(
            code for code, mag in _star_catalogue_facts()[1]
            if mag is not None and mag < BRIGHT_STAR_MAGNITUDE
        ))
    if field == "catalogue":
        return tuple(sorted(code for code, _mag in _star_catalogue_facts()[1]))
    return None


def normalized_star_codes(codes) -> tuple[str, ...]:
    """Astrolabe-only star selection: catalogue codes, deduplicated, capped."""
    from webapp.daemon.options_service import _read_fixstar_catalog

    valid = {str(row["code"]) for row in _read_fixstar_catalog() if row.get("code")}
    out: list[str] = []
    for code in codes or ():
        code = str(code).strip()
        if code in valid and code not in out:
            out.append(code)
        if len(out) >= ASTROLABE_MAX_STARS:
            break
    return tuple(out)


def astrolabe_star_rows(chrt, star_codes: Optional[tuple[str, ...]]) -> list:
    """FixStars rows for the astrolabe.

    ``None`` follows the chart's own fixed-star selection; a tuple is the
    astrolabe's independent selection, computed by the same FixStars engine at
    the chart moment and zodiac. The rete arc does not move stars, so rows are
    cached across drag steps.
    """
    if star_codes is None:
        return list(getattr(getattr(chrt, "fixstars", None), "data", None) or ())
    if not star_codes:
        return []
    common.ensure_swe_ready()
    _pflag, _hflag, fsflag, _astflag = chrt._zodiac_flags()
    key = (
        float(chrt.time.jd), int(fsflag), float(chrt.obl[0]),
        float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0), star_codes,
    )
    rows = _ASTROLABE_STAR_CACHE.get(key)
    if rows is None:
        swiss_codes = tuple(code for code in star_codes if not code.startswith("HIP "))
        rows = fixstars.FixStars(
            key[0], key[1], {code: 0.0 for code in swiss_codes}, key[2], key[3],
        ).data
        if len(swiss_codes) != len(star_codes):
            from webapp.daemon.astrolabe_asterisms import fallback_star_rows

            rows.extend(fallback_star_rows(chrt, (code for code in star_codes if code.startswith("HIP "))))
        if len(_ASTROLABE_STAR_CACHE) >= _ASTROLABE_STAR_CACHE_SIZE:
            _ASTROLABE_STAR_CACHE.pop(next(iter(_ASTROLABE_STAR_CACHE)))
        _ASTROLABE_STAR_CACHE[key] = rows
    return list(rows)


def _star_display_name(row, opts) -> str:
    code = str(row[fixstars.FixStars.NOMNAME])
    return str(astrology.display_fixstar_name(code, opts, row[fixstars.FixStars.NAME]))


def star_facts(row, opts) -> dict:
    """Magnitude and Settings-list membership; the skin picks labels from these."""
    code = str(row[fixstars.FixStars.NOMNAME])
    mag = star_magnitudes().get(code)
    return {
        "mag": None if mag is None else round(mag, 2),
        "inSettings": code in (getattr(opts, "fixstars", None) or {}),
    }


def _body_name(body_id) -> str:
    """Localized hover name for an astrolabe body or the Lot of Fortune."""
    if body_id == common.CHART_OBJECT_FORTUNE:
        return mtexts.txts.get("LoF", "LoF")
    return common.common.get_planet_name(body_id)


def _tropical(chrt, lon: float) -> float:
    """Chart-zodiac longitude -> tropical (sidereal charts store sidereal)."""
    return util.to_tropical_lon(float(lon), float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0))


def _zodiac_divisions(chrt, opts, place) -> dict:
    """Active term and decan (face) divisions in chart-zodiac longitude.

    ``place(lon)`` projects a chart-zodiac degree on the ecliptic; the skin
    only draws. Each entry starts at its boundary; index 0 shares the sign
    boundary the zodiac band already engraves.
    """
    def ruler(pid: int) -> dict:
        color = _body_color_hex(chrt, opts, pid)
        try:
            glyph = common.common.get_planet_glyph(pid) or ""
        except Exception:
            glyph = ""
        return {
            "planetId": pid,
            "glyph": glyph,
            "color": color,
            "colorRole": chart_body_color_role(
                opts, chrt, pid, is_fortune=pid == common.CHART_OBJECT_FORTUNE, resolved_color=color,
            ),
        }

    def entry(sign: int, index: int, pid: int, start: float, end: float) -> dict:
        return {
            "sign": sign,
            "index": index,
            "start": start,
            "end": end,
            **ruler(pid),
            "boundary": place(start),
            "mid": place((start + end) / 2.0),
        }

    def active(rows, selected):
        rows = rows or []
        idx = int(selected or 0)
        return rows[idx] if 0 <= idx < len(rows) else (rows[0] if rows else [])

    terms = []
    for sign, segments in enumerate(active(getattr(opts, "terms", None), getattr(opts, "selterm", 0))[:12]):
        cursor = sign * 30.0
        for index, segment in enumerate((segments or [])[:5]):
            try:
                pid, span = int(segment[0]), float(segment[1])
            except Exception:
                continue
            terms.append(entry(sign, index, pid, cursor, cursor + span))
            cursor += span
    decans = []
    for sign, rulers in enumerate(active(getattr(opts, "decans", None), getattr(opts, "seldecan", 0))[:12]):
        for index, pid in enumerate((rulers or [])[:3]):
            try:
                start = sign * 30.0 + index * 10.0
                decans.append(entry(sign, index, int(pid), start, start + 10.0))
            except Exception:
                continue
    return {
        "terms": terms,
        "decans": decans,
        # The chart wheel's subdivision ink: ruler colours, or the sign colour.
        "inheritPlanetColors": bool(getattr(opts, "useplanetcolorsforsubdivisions", True)),
    }


def _polar_ecliptic_place(chrt, eramc: float):
    """Polar plate point and unit tangent (increasing longitude) of a
    chart-zodiac degree, for ticks drawn across the ecliptic path."""
    obliquity = float(chrt.obl[0])

    def at(lon: float) -> tuple[float, float]:
        ra, dec = polar_azimuthal_service.ecliptic_to_equatorial(_tropical(chrt, lon), 0.0, obliquity)
        return polar_azimuthal_service.project(eramc - ra, dec)

    def place(lon: float) -> dict:
        x, y = at(lon)
        bx, by = at(lon - 0.25)
        ax, ay = at(lon + 0.25)
        d = math.hypot(ax - bx, ay - by) or 1.0
        return {"x": x, "y": y, "tx": (ax - bx) / d, "ty": (ay - by) / d}

    return place


def _house_lines(chrt, ramc, R_eq, eramc=None, pole=1):
    """Project the selected system's radix house boundaries.

    Spatial and time systems are the radix mundane frame: fixed on the plate at
    the radix RAMC. Zodiacal cusps are ecliptic degrees, so their meridians are
    rete objects and turn with the directed RAMC, staying on their degrees.
    """
    eramc = ramc if eramc is None else eramc
    system = getattr(chrt.houses, "ui_hsys", chrt.houses.hsys)
    if system == "N":
        return []
    if system in ("P", "K"):
        # Match the existing engine's Porphyry fallback at polar latitudes or
        # failed cusp convergence; never draw a different system over its cusps.
        status, _cusps, _angles = astrology.swe_houses_armc(
            ramc, chrt.place.lat, chrt.obl[0], ord(system),
        )
        if astrology._unwrap_1tuple(status) < 0:
            system = "O"
    return [
        {
            "house": house,
            "longitude": float(chrt.houses.cusps[house]),
            "construction": CONSTRUCTIONS[system],
            "paths": [
                [{"x": round(x, 8), "y": round(y, 8)} for x, y in path]
                for path in house_paths(
                    system, house, _tropical(chrt, chrt.houses.cusps[house]),
                    chrt.place.lat, chrt.obl[0],
                    eramc if CONSTRUCTIONS[system] == "zodiacal-meridians" else ramc, R_eq, pole,
                )
            ],
        }
        for house in range(1, houses.Houses.HOUSE_NUM + 1)
    ]


# Angle marks on the turned rete: id, short label key, hover name key.
_ANGLE_POINTS = (
    ("angle:asc", "Asc", "Asc"),
    ("angle:dsc", "Dsc", "Desc"),
    ("angle:mc", "MC", "MC"),
    ("angle:ic", "IC", "IC"),
)


def _angle_points(chrt, eramc, obliquity, latitude, R_eq, pole=1):
    """Where the turned ecliptic meets the horizon (Asc/Dsc) and the meridian
    (MC/IC): the directed angles of the current rete arc, on the ecliptic."""
    asc = polar_azimuthal_service.directed_asc_lon(eramc, obliquity, latitude)
    mc = polar_azimuthal_service.directed_mc_lon(eramc, obliquity)
    ayanamsha = float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)
    out = []
    for (point_id, label_key, name_key), lon in zip(
        _ANGLE_POINTS, (asc, asc + 180.0, mc, mc + 180.0),
    ):
        lon %= 360.0
        x, y = proj.ecliptic_degree_xy(lon, obliquity, R_eq, eramc, pole)
        out.append({
            "id": point_id,
            "label": str(mtexts.txts.get(label_key, label_key)),
            "name": str(mtexts.txts.get(name_key, name_key)),
            "position": format_zodiac_position((lon - ayanamsha) % 360.0),
            "x": x,
            "y": y,
        })
    return out


def _disk_radius(chrt, body_id, sx, sy):
    """Sun/Moon apparent semi-diameter in plate units at the projected sphere
    (stereographic local scale (1 + r^2) / 2 per radian, R_eq = 1)."""
    if body_id not in (astrology.SE_SUN, astrology.SE_MOON):
        return None
    try:
        _flag, attr, _err = astrology.swe_pheno_ut(float(chrt.time.jd), int(body_id), astrology.SEFLG_SWIEPH)
        semi = math.radians(float(attr[3])) / 2.0
    except Exception:
        return None
    if not math.isfinite(semi) or semi <= 0:
        return None
    return semi * (1.0 + sx * sx + sy * sy) / 2.0


def _iter_visible_bodies(chrt, options):
    """Port of AstrolabeChart._iter_visible_bodies (astrolabechart.py:241-275).

    Yields (body_id, ra, decl, lon, glyph, color_hex) for every visible body
    plus the Lot of Fortune when enabled. ra/decl are true equatorial degrees.
    """
    obliquity = chrt.obl[0]
    for body_id in common.common.get_visible_chart_planet_ids(
        chrt, options, include_descnode=True, include_chiron=True,
    ):
        body = common.common.get_chart_planet(chrt, body_id)
        if body is None:
            continue
        glyph = common.common.get_planet_glyph(body_id)
        if not glyph:
            continue
        try:
            ra = body.dataEqu[planets.Planet.RAEQU]
            decl = body.dataEqu[planets.Planet.DECLEQU]
            lon = body.data[planets.Planet.LONG]
        except Exception:
            continue
        yield (body_id, ra, decl, lon, glyph, _body_color_hex(chrt, options, body_id))

    if getattr(options, "showlof", False) and chrt.fortune is not None:
        try:
            lon = chrt.fortune.fortune[fortune.Fortune.LON]
            fra, fdec = proj.ecl_lon_to_ra_dec(_tropical(chrt, lon), obliquity)
            yield (
                common.CHART_OBJECT_FORTUNE, fra, fdec, lon,
                common.common.fortune,
                _body_color_hex(chrt, options, common.CHART_OBJECT_FORTUNE),
            )
        except Exception:
            pass


def _pd_event_row(pds, pd, offset_years):
    """One PD-exact overlay row with daemon-resolved glyphs + prom/sig text
    fallbacks (for ids the 12-planet glyph tuple can't render).

    Shape mirrors what AstrolabeChart._getPDExactOverlayRow consumes
    (astrolabechart.py:1120-1163). Direction marker D/C and the M/Z mundane
    marker follow the wx _pdDirectionMarker / mundane_marker logic
    (astrolabechart.py:1115-1118, 1160).
    """
    return {
        "prom": int(pd.prom),
        "prom2": int(pd.prom2),
        "promasp": int(pd.promasp),
        "sig": int(pd.sig),
        "sigasp": int(pd.sigasp),
        "promGlyph": primdir_point_glyph(pd.prom),
        "prom2Glyph": primdir_point_glyph(pd.prom2),
        "sigGlyph": primdir_point_glyph(pd.sig),
        "mundane": bool(pd.mundane),
        "direct": bool(pd.direct),
        "arc": round(float(pd.arc), 6),
        # Daemon-rendered text fallbacks for non-planet promissor/significator
        # (angles, house cusps, LoF, Syzygy, terms, fixstars).
        "promText": _prom_label(pds, pd),
        "sigText": _sig_label(pds, pd),
        "offsetYears": round(float(offset_years), 4),
    }


def _pd_sky(chrt, options):
    """The radix bodies the PD rows were directed from (PD node and Moon
    parallax), for the PD overlay's rays and significator marks."""
    return pd_in_chart.pd_positions(chrt, options)


def _build_pd_directions(chrt, options):
    """Project the radix primary directions wx-free and return the
    PrimDirs object + the arc-sorted [(abs(arc), pd), ..] snap list.

    Reuses the SAME engine path the desktop stepper uses
    (_install_astrolabe_stepper, morin.py:19287-19299): the engine
    symbolic_projection PRIMARY_DIRECTIONS table. No directional math here.
    """
    try:
        abort = primdirs.AbortPD()
        projection = symbolic_projection.project_symbolic_table(
            symbolic_projection.PRIMARY_DIRECTIONS, chrt, options, abort=abort,
        )
        pds = projection.get("content")
        if pds is None or not hasattr(pds, "pds"):
            return None, []
        entries = sorted(
            [(abs(pd.arc), pd) for pd in pds.pds if pd.arc != 0],
            key=lambda item: item[0],
        )
        return pds, entries
    except Exception:
        return None, []


# Option fields that select, show or label the drawn house ring, plus save
# bookkeeping. Primary directions use the P/R/C/T geometry of their own engine;
# only Lots (whose formulas may read cusps) and the private displayed-cusp
# significator path see the ring.
_HOUSE_DISPLAY_OPTIONS = frozenset({"hsys", "housesystem", "houses", "_legacy_hashes"})


def _house_neutral_options(values: dict) -> dict:
    return {key: value for key, value in values.items() if key not in _HOUSE_DISPLAY_OPTIONS}


def _pd_lot_names(options) -> set:
    """Lots the PD table directs, in either role."""
    names = set()
    for promissor, fields in pd_point_selection.ROLE_FIELDS.items():
        if getattr(options, fields["partsEnabled"], False):
            names.update(pd_point_selection.arabic_part_names(options, promissor))
            names.add(getattr(options, fields["legacyName"], ""))
    return names


class _ReteDirectionsCache:
    """One retained PD table; the rete arc is deliberately not a cache input.

    Compare all option values, including nested/custom PD settings, rather than
    maintaining a second list of calculation options. Chart dependency objects
    are retained by identity so a rebuilt source invalidates even at the same JD.
    Capture them *after* PD construction, which materializes chart dependencies.

    Switching the drawn house system rebuilds every chart dependency object,
    but leaves the table unchanged unless a Lot moved: that switch reuses it.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._chart = None
        self._dependencies = ()
        self._source = None
        self._house = None
        self._house_inputs = None
        self._options = None
        self._result = None
        self._derived = {}

    @staticmethod
    def _state(chrt):
        dependencies = tuple(getattr(chrt, name, None) for name in (
            "time", "place", "houses", "planets", "chiron", "apogee", "fortune",
            "syzygy", "parts", "fixstars", "antiscia", "zodpars", "antzodpars",
            "asteroids", "cpd", "cpd2", "midpoints", "munfortune",
            "pd_arabic_part_prom", "pd_arabic_part_sig",
        ))
        source = (
            # Include civil date/calendar and place metadata too: PD keys can
            # use civil-year boundaries even when the UT instant is unchanged.
            tuple((key, value) for key, value in vars(chrt.time).items()
                  if isinstance(value, (str, int, float, bool, type(None)))),
            tuple((key, value) for key, value in vars(chrt.place).items()
                  if isinstance(value, (str, int, float, bool, type(None)))),
            chrt.htype, chrt.male, getattr(chrt, "nolat", False),
            tuple(chrt.obl), chrt.raequasc, chrt.ayanamsha, getattr(chrt, "ayanamsha_offset", 0),
        )
        house = (tuple(chrt.houses.cusps), chrt.houses.hsys)
        return dependencies, source, house

    @staticmethod
    def _house_switch_inputs(chrt, options):
        """What a PD table can read from the drawn houses, or None if it may
        read their cusps directly."""
        if getattr(options, "_pd_use_display_house_cusp_significators", False):
            return None
        names = _pd_lot_names(options)
        if names and getattr(chrt, "parts", None) is None:
            # The PD engine computes its directed lots on its own copy of the
            # chart; without the chart's lots a house switch cannot be shown
            # to leave them in place.
            return None
        lots = getattr(getattr(chrt, "parts", None), "parts", None) or () if names else ()
        return (
            tuple(tuple(row) for row in chrt.houses.ascmc2),
            tuple((lot[arabicparts.ArabicParts.NAME], lot[arabicparts.ArabicParts.LONG])
                  for lot in lots if lot[arabicparts.ArabicParts.NAME] in names),
        )

    def _store(self, chrt, options):
        self._derived = {}
        self._chart = chrt
        self._dependencies, self._source, self._house = self._state(chrt)
        self._house_inputs = self._house_switch_inputs(chrt, options)

    def get(self, chrt, options):
        with self._lock:
            dependencies, source, house = self._state(chrt)
            if self._chart is chrt and self._source == source:
                if (house == self._house
                        and all(a is b for a, b in zip(self._dependencies, dependencies))
                        and self._options == vars(options)):
                    return self._result
                if (house != self._house and self._house_inputs is not None
                        and self._house_switch_inputs(chrt, options) == self._house_inputs
                        and _house_neutral_options(self._options) == _house_neutral_options(vars(options))):
                    self._store(chrt, options)
                    self._options.update({key: copy.deepcopy(value) for key, value in vars(options).items()
                                          if key in _HOUSE_DISPLAY_OPTIONS})
                    return self._result
            result = _build_pd_directions(chrt, options)
            # Failed/aborted construction is retryable, never a retained table.
            if result[0] is None or getattr(getattr(result[0], "abort", None), "abort", False):
                self._chart = None
                return result
            self._store(chrt, options)
            self._options = copy.deepcopy(vars(options))
            self._result = result
            return result

    def derived(self, key, build):
        """An arc-independent value of the retained table, built once per key
        and dropped with the table (or a drawn-house switch that reuses it)."""
        with self._lock:
            if key not in self._derived:
                self._derived[key] = build()
            return self._derived[key]


def _nearby_pd_events(pds, entries, current_arc, years_per_deg):
    """PD events within +/- NEARBY window of the current rete arc, sorted by
    time offset. Mirrors _AstrolabeStepper._compute_nearby_pd_events
    (morin.py:19313-19333)."""
    if not entries or years_per_deg <= 0:
        return []
    cur_years = float(current_arc) * years_per_deg
    out = []
    for arc, pd in entries:
        pd_years = float(arc) * years_per_deg
        offset = pd_years - cur_years
        if abs(offset) <= _NEARBY_PD_WINDOW_YEARS:
            out.append(_pd_event_row(pds, pd, offset))
    out.sort(key=lambda e: e["offsetYears"])
    return out


def _snap_arcs(entries):
    """The forward-only sorted unique arcs the rete snaps to (UP/DOWN jump and
    drag-release snapping). Mirrors _AstrolabeStepper._jump_pd
    (morin.py:19381-19394)."""
    return [round(float(arc), 6) for (arc, _pd) in entries]


def _atmospheric_payload(chrt, latitude, eramc) -> dict:
    """Sun-altitude-driven sky and darkened ground for the filled plate
    (astrolabechart._draw_atmospheric, astrolabechart.py:310-456; ground =
    darkened sky, astrolabechart.py:406-409). The skin paints; nothing is
    recomputed in TypeScript. The Sun's true altitude and azimuth drive the
    frontend's physical sky; sky/ground are its flat fallback."""
    sun_alt, sun_az = _directed_sun_horizontal(chrt, latitude, eramc)
    sky_rgb = _sky_color_for_altitude(sun_alt)
    return {
        "sunAltitude": float(sun_alt),
        "sunAzimuth": float(sun_az),
        "sky": _rgb_to_hex(sky_rgb),
        "ground": _rgb_to_hex(_ground_color_for_altitude(sky_rgb, sun_alt)),
    }


# Night ground: the sky mixed this share toward black in OKLab, ramped in
# linearly through dusk so the dark earth stays clearly below the night sky.
_NIGHT_GROUND_DARKEN = 0.45
_DUSK_START_ALT = -6.0
_NIGHT_FULL_ALT = -12.0


def _srgb_to_oklab(rgb):
    def linear(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(float(c)) for c in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


def _oklab_to_srgb(lab):
    def gamma(c):
        c = max(0.0, min(1.0, c))
        return 255.0 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)

    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return tuple(int(round(gamma(v))) for v in (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ))


def _mix_oklab(a_rgb, b_rgb, share_b):
    a, b = _srgb_to_oklab(a_rgb), _srgb_to_oklab(b_rgb)
    return _oklab_to_srgb(tuple(a[i] + (b[i] - a[i]) * share_b for i in range(3)))


def _ground_color_for_altitude(sky_rgb, sun_alt):
    """Ground below the horizon: the darkened sky (astrolabechart.py:406-409)
    by day and sunset; from Sun -6 deg it moves toward the sky mixed 45 %
    toward black, reaching it at -12 deg, so night ground never rivals the
    night sky."""
    dayness = max(0.0, min(1.0, (sun_alt + 6.0) / 12.0))
    darken = 0.18 + dayness * 0.22
    ground_rgb = tuple(int(sky_rgb[j] * (1 - darken)) for j in range(3))
    night = max(0.0, min(1.0, (_DUSK_START_ALT - sun_alt) / (_DUSK_START_ALT - _NIGHT_FULL_ALT)))
    if night <= 0.0:
        return ground_rgb
    night_ground = _mix_oklab(sky_rgb, (0, 0, 0), _NIGHT_GROUND_DARKEN)
    return _mix_oklab(ground_rgb, night_ground, night)


def wall_clock_arc(radix, now: Optional[datetime.datetime] = None) -> float:
    """Rete arc whose signified moment is the wall clock under the active PD
    key: the inverse of ``_pd_signified_jd``, clamped forward-only like every
    rete arc (a radix born in the future opens at 0)."""
    now = (now or datetime.datetime.now(datetime.timezone.utc)).astimezone(datetime.timezone.utc)
    ut = now.hour + now.minute / 60.0 + (now.second + now.microsecond / 1e6) / 3600.0
    jd = astrology.swe_julday(now.year, now.month, now.day, ut, astrology.SE_GREG_CAL)
    opts = effective_display_options(chart_snapshot_service.options)
    return max(0.0, float(pd_in_chart.arc_for_event_jd(radix, jd, opts)))


def _pd_signified_jd(radix, opts, arc_deg: float) -> float:
    """Real (signified) event JD for a direct rete arc under the active PD key.

    Inverts the engine's ``pd_in_chart.arc_for_event_jd`` (the PD-in-Chart
    stepper key), so static, custom and solar keys date the arc exactly like
    the PD list and PD-in-Chart. The arc grows monotonically with age at
    roughly 1° per year for every key, so a secant solve converges quickly.
    """
    jd0 = float(radix.time.jd)
    if arc_deg <= 0.0:
        return jd0
    year = pd_in_chart.TROPICAL_YEAR_DAYS

    def arc_at(age: float) -> float:
        return float(pd_in_chart.arc_for_event_jd(radix, jd0 + age * year, opts))

    age_a = arc_deg * float(_pd_years_per_degree(opts))
    err_a = arc_deg - arc_at(age_a)
    age_b = age_a + err_a
    for _ in range(40):
        if abs(err_a) < 1e-9:
            return jd0 + age_a * year
        err_b = arc_deg - arc_at(age_b)
        if abs(err_b) < 1e-9 or age_b == age_a:
            return jd0 + age_b * year
        slope = (err_a - err_b) / (age_b - age_a)
        step = err_b / slope if slope > 1e-6 else err_b
        age_a, err_a, age_b = age_b, err_b, max(0.0, age_b + step)
    return jd0 + age_b * year


def _radix_local_datetime(radix, jd: float) -> tuple[tuple[int, ...], bool]:
    """``jd`` as a civil datetime in the radix's own zone (as the PD list
    shows dates); returns (y, m, d, h, mi, s) with a BC flag."""
    t = radix.time
    calflag = symbolic_time._calflag_from_chart(radix)
    astro_year = (1 - int(t.origyear)) if t.bc else int(t.origyear)
    offset = astrology.swe_julday(
        astro_year, int(t.origmonth), int(t.origday),
        t.hour + t.minute / 60.0 + t.second / 3600.0, calflag,
    ) - float(t.jd)

    def local(j: float) -> tuple[int, ...]:
        return symbolic_time._jd_to_datetime_tuple(j + offset, calflag)

    value = local(jd)
    try:  # zone rules at the event date may differ from those at birth
        if value[0] > 0:
            back = pd_in_chart.event_jd_for_display_datetime(radix, datetime.datetime(*value))
            if abs(back - jd) > 0.5 / 86400.0:
                value = local(jd + (jd - back))
    except Exception:
        pass
    if value[0] <= 0:
        return (1 - value[0],) + tuple(value[1:]), True
    return tuple(value), False


def _radix_zone_suffix(radix) -> str:
    zt = radix.time.zt
    if zt == chart_mod.Time.ZONE:
        return mtexts.txts["ZN"]
    if zt in (chart_mod.Time.LOCALMEAN, chart_mod.Time.LOCALAPPARENT):
        return mtexts.txts["LC"]
    return ""


def _corner_datetime_lines(radix, opts, value, bc) -> list[str]:
    """Date + time lines formatted like the chart wheel's top-left corner."""
    date_txt, time_txt = export_chart_json.format_datetime_tuple(value, bc=bc, options=opts)
    zone = _radix_zone_suffix(radix)
    return [date_txt, f"{time_txt}, {zone}" if zone else time_txt]


def _iso(value, bc) -> str:
    y, m, d, h, mi, s = value
    return "%s%04d-%02d-%02dT%02d:%02d:%02d" % ("-" if bc else "", y, m, d, h, mi, s)


def _chart_information_payload(radix, opts, arc_deg: float) -> dict:
    """Wheel-style corner text and the symbolic-time readout for the rete arc.

    Top-left matches every chart corner but carries the REAL (signified)
    moment of the directed arc; bottom-left is the SYMBOLIC moment, the real
    sky turned by the arc after birth (``pdsinchart``, as PD-in-Chart);
    bottom-right is the chart's house-system block.
    """
    real_jd = _pd_signified_jd(radix, opts, arc_deg)
    real, real_bc = _radix_local_datetime(radix, real_jd)
    rotation = pdsinchart.PDsInChart(radix, arc_deg)
    symbolic_jd = astrology.swe_julday(
        int(rotation.yz), int(rotation.mz), int(rotation.dz), float(rotation.tz),
        astrology.SE_GREG_CAL,
    )
    symbolic, symbolic_bc = _radix_local_datetime(radix, symbolic_jd)

    top_left = _corner_datetime_lines(radix, opts, real, real_bc)
    name = str(getattr(radix, "name", "") or "").strip()
    if getattr(opts, "showradixnameincanvas", False) and name:
        top_left = [name, *top_left]
    age_years = max(0.0, (real_jd - float(radix.time.jd)) / pd_in_chart.TROPICAL_YEAR_DAYS)
    real_date_text = dateformat.date_text(real[0], real[1], real[2], opts, bc=real_bc)
    real_datetime_text = dateformat.date_time_text(real, opts, show_seconds=True)
    symbolic_datetime_text = dateformat.date_time_text(symbolic, opts, show_seconds=True)
    real_date_display, real_time_display = export_chart_json.format_datetime_tuple(real, bc=real_bc, options=opts)
    return {
        "information": {
            "showInformation": bool(getattr(opts, "information", True)),
            "showHouseSystem": bool(getattr(opts, "housesystem", False)),
            "wheelTheme": int(getattr(opts, "theme", 0)),
            "topLeft": top_left,
            "bottomLeft": _corner_datetime_lines(radix, opts, symbolic, symbolic_bc),
            "houseSystemLines": export_chart_json._export_house_system_lines(radix),
        },
        # Same shape as the PD-in-Chart readout (workspace_service).
        "symbolicTime": {
            "method": "primary_direction",
            "signifiedDatetime": _iso(real, real_bc),
            "signifiedDateText": real_date_text,
            "signifiedDateDisplay": real_date_display,
            "signifiedTimeDisplay": real_time_display,
            "progressedDatetime": _iso(symbolic, symbolic_bc),
            "ageYears": float(age_years),
            "ageYearsInt": int(age_years),
            "ageText": mtexts.txts.get("AgeColonFmt", "Age: %d") % int(age_years),
            "realText": mtexts.txts.get("RealColonFmt", "Real: %s") % real_date_text,
            "symbolicRealText": mtexts.txts.get("SymbolicRealFmt", "Symbolic: %s - Real: %s") % (
                symbolic_datetime_text, real_datetime_text,
            ),
        },
    }


def _direction_stepper_payload(chrt, opts, delta_deg: float, directions_cache=None) -> dict:
    """Rete arc facts shared by both projections: the PD key, the arc label,
    the chart-information corners and symbolic/real time, and the engine PD
    list's snap arcs + nearby-event overlay rows."""
    years_per_deg = float(_pd_years_per_degree(opts))
    pds_obj, pd_entries = (directions_cache.get(chrt, opts) if directions_cache is not None
                           else _build_pd_directions(chrt, opts))
    arc_deg = abs(float(delta_deg))
    d_whole = int(arc_deg)
    rem = (arc_deg - d_whole) * 60.0
    m_whole = int(rem)
    s_whole = int((rem - m_whole) * 60.0)
    information = _chart_information_payload(chrt, opts, arc_deg)
    return {
        "yearsPerDegree": years_per_deg,
        "infoLabel": {
            "arc": u"%s %d°%02d'%02d\"" % (
                mtexts.txts.get("Arc", "Arc"), d_whole, m_whole, s_whole,
            ),
            "deltaDeg": float(delta_deg),
            "ageYears": information["symbolicTime"]["ageYears"],
        },
        **information,
        "pd": {
            "snapArcs": _snap_arcs(pd_entries),
            "nearbyEvents": _nearby_pd_events(pds_obj, pd_entries, delta_deg, years_per_deg),
        },
        # Rete contacts read off the same PD list, within the two-month orb.
        "contactOrbDeg": contact_orb_deg(years_per_deg),
        "contacts": rete_contacts(pd_entries, delta_deg, years_per_deg),
    }


def workspace_chart_for_document(document_id: Optional[str], *, launcher_kinds: tuple[str, ...] = ()):
    """Resolve a live workspace chart for view-only children."""
    if not document_id:
        return None
    from webapp.daemon.workspace_service import workspace_service

    session = workspace_service._controller.session(str(document_id))
    if not session:
        return None
    if session.get("launcher_kind") in launcher_kinds and session.get("parent_document_id"):
        parent = workspace_service._controller.session(str(session.get("parent_document_id")))
        if parent:
            session = parent
    cs = session.get("chart_session")
    chrt = getattr(cs, "chart", None) if cs is not None else None
    if chrt is not None:
        return chrt
    return session.get("chart")


class AstrolabeService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._directions_cache = _ReteDirectionsCache()

    def geometry(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        document_id: Optional[str] = None,
        delta_deg: float = 0.0,
        projection: str = PROJECTION_STEREOGRAPHIC,
        lattice: bool = False,
        full_sphere: bool = False,
        asterisms: bool = False,
        star_field: str = "settings",
        marked: Optional[list[str]] = None,
        pd_overlay: bool = False,
        pd_focus: Optional[str] = None,
    ) -> dict:
        field = star_field if star_field in STAR_FIELDS else "settings"
        codes = star_field_codes(field)
        marked_codes = normalized_star_codes(marked or ())
        with self._lock:
            canonical_opts = chart_snapshot_service.options
            display_opts = effective_display_options(canonical_opts)
            radix = self._radix(document_id, source, source_name, canonical_opts)
            # Forward-only rete: directions are forward in time. wx clamps the
            # arc to max(0.0, ...) (morin.py:19367,19377,19427); the daemon holds
            # the same clamp regardless of what the skin sends.
            delta = max(0.0, float(delta_deg))
            if projection == PROJECTION_POLAR_EQUIDISTANT:
                payload = self._build_polar(
                    radix, display_opts, delta, lattice=lattice, full_sphere=full_sphere,
                    star_codes=codes, marked_codes=marked_codes, pd_overlay=pd_overlay,
                )
            else:
                payload = self._build(
                    radix, display_opts, delta, star_codes=codes, marked_codes=marked_codes,
                    pd_overlay=pd_overlay,
                )
            if asterisms:
                from webapp.daemon.astrolabe_asterisms import geometry

                payload["asterisms"] = geometry(
                    radix, display_opts, payload["eramc"], payload["projection"],
                    payload["radii"].get("rim", payload["radii"]["capricorn"]),
                )
            if pd_focus and payload.get("pdReprojection"):
                # A focused PD significator adds its next contacts (view state
                # from the skin; rows and geometry stay engine-owned).
                payload["pdReprojection"]["focus"] = build_pd_focus(
                    _pd_sky(radix, display_opts), display_opts, self._directions_cache.get(radix, display_opts)[1], pd_focus,
                    delta, payload["projection"], payload["yearsPerDegree"],
                )
            attach_display_loci(radix, payload)
            return payload

    def earth(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        document_id: Optional[str] = None,
    ) -> dict:
        """Terrestrial layer for the polar azimuthal plate of this radix."""
        with self._lock:
            radix = self._radix(document_id, source, source_name, chart_snapshot_service.options)
            place_lon = float(radix.place.lon)
        return polar_azimuthal_service.earth_geometry(place_lon)

    @staticmethod
    def _radix(document_id, source, source_name, canonical_opts):
        radix = workspace_chart_for_document(document_id, launcher_kinds=("astrolabe",))
        if radix is not None:
            return radix
        source_path = (
            str(Path(source).expanduser()) if source
            else str(export_chart_json.DEFAULT_SOURCE)
        )
        radix, _ = export_chart_json.load_chart(
            source_path, canonical_opts, name=source_name
        )
        return radix

    def _build_polar(
        self, chrt, opts, delta_deg: float, *, lattice: bool = False, full_sphere: bool = False,
        star_codes: Optional[tuple[str, ...]] = None,
        marked_codes: tuple[str, ...] = (),
        pd_overlay: bool = True,
    ) -> dict:
        ramc = chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
        eramc = ramc + float(delta_deg)
        payload = polar_azimuthal_service.build_polar_geometry(
            chrt, opts, eramc, lattice=lattice, full_sphere=full_sphere,
            star_rows=astrolabe_star_rows(chrt, star_codes),
            marked_rows=astrolabe_star_rows(chrt, marked_codes),
        )
        place = _polar_ecliptic_place(chrt, eramc)
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
        payload.update({
            "name": getattr(chrt, "name", ""),
            "lat": float(chrt.place.lat),
            "lon": float(chrt.place.lon),
            "obliquity": float(chrt.obl[0]),
            "ramc": float(ramc),
            "delta": float(delta_deg),
            "eramc": float(eramc),
            "jd": float(chrt.time.jd),
            "atmospheric": _atmospheric_payload(chrt, float(chrt.place.lat), eramc),
            "zodiacSigns": [
                {"sign": sign, "glyph": signs[sign], **place(sign * 30.0)}
                for sign in range(12)
            ],
            "zodiacDegrees": [
                {"sign": sign, "degree": degree, "label": f"{degree}°", **place(sign * 30.0 + degree)}
                for sign in range(12) for degree in (0, 10, 20)
            ],
            "zodiacDivisions": _zodiac_divisions(chrt, opts, place),
            **_direction_stepper_payload(chrt, opts, delta_deg, self._directions_cache),
        })
        if pd_overlay:
            payload["pdReprojection"] = build_pd_overlay(
                _pd_sky(chrt, opts), opts, delta_deg, PROJECTION_POLAR_EQUIDISTANT,
                self._directions_cache.get(chrt, opts)[1], payload["yearsPerDegree"],
            )
            payload["pdReprojection"]["significators"] = self._pd_significators(
                chrt, opts, PROJECTION_POLAR_EQUIDISTANT)
        return payload

    def _pd_significators(self, chrt, opts, projection):
        entries = self._directions_cache.get(chrt, opts)[1]
        return self._directions_cache.derived(
            ("significators", projection), lambda: build_pd_significators(_pd_sky(chrt, opts), opts, entries, projection))

    def _build(
        self, chrt, opts, delta_deg: float, *, star_codes: Optional[tuple[str, ...]] = None,
        marked_codes: tuple[str, ...] = (),
        pd_overlay: bool = True,
    ) -> dict:
        R_eq = _R_EQ
        obliquity = chrt.obl[0]
        latitude = chrt.place.lat
        longitude = chrt.place.lon
        ramc = chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
        eramc = ramc + float(delta_deg)
        # The plate is cut for the visible pole: sky points take pole * dec,
        # the tympan the (nudged) plate latitude (astrolabe_projection).
        pole = proj.plate_pole(latitude)
        plate_lat = proj.plate_latitude(latitude)

        # --- Plate radii (astrolabechart.py:146-166, R_eq=1) ----------------
        r_cancer = proj.tropic_cancer_radius(obliquity, R_eq)
        r_capricorn = proj.tropic_capricorn_radius(obliquity, R_eq)
        r_equator = R_eq

        # Horizon: proj.horizon_circle returns center as a POSITIVE magnitude.
        # astrolabechart draws the horizon centre at SCREEN y = cy - h_off
        # (astrolabechart.py:473) — i.e. ABOVE the NCP, toward S / the zenith —
        # so in NCP-relative space (y down) the centre offset is -h_off, NOT
        # +h_off. Shipping +h_off mirrored the horizon to the wrong side.
        h_off, h_rad = proj.horizon_circle(plate_lat, R_eq)
        h_cy = -h_off  # NCP-relative horizon-centre y (matches wx cy - h_off)

        # --- Tympan (fixed plate) -------------------------------------------
        tympan = {
            "horizon": {"cx": 0.0, "cy": h_cy, "r": h_rad},
            "equator": {"cx": 0.0, "cy": 0.0, "r": r_equator},
            "tropicCancer": {"cx": 0.0, "cy": 0.0, "r": r_cancer},
            "tropicCapricorn": {"cx": 0.0, "cy": 0.0, "r": r_capricorn},
            # Meridian: vertical through the NCP, spanning the Capricorn disk.
            "meridian": {"x1": 0.0, "y1": -r_capricorn, "x2": 0.0, "y2": r_capricorn},
            "houseLines": _house_lines(chrt, ramc, R_eq, eramc, pole),
            "hourLines": plate_lines.unequal_hour_lines(plate_lat, obliquity, R_eq),
        }
        # Almucantars and azimuths at the plate's 5° division; azimuths are
        # great circles the renderer clips to the sky, those not reaching the
        # zenith also outside ``azimuthStop`` (astrolabe_plate_lines).
        grid = plate_lines.plate_grid(plate_lat, R_eq)
        tympan["almucantars"] = grid["almucantars"]
        tympan["azimuths"] = grid["azimuths"]
        tympan["azimuthStop"] = grid["azimuthStop"]

        # --- Rete (rotating: ecliptic + signs + star pointers) --------------
        _, ecl_r = proj.ecliptic_circle(obliquity, R_eq)
        ecx, ecy = proj.ecliptic_center_xy(obliquity, R_eq, eramc, pole)
        # The eccentric ecliptic circle is tropical frame geometry; zodiac
        # degrees (signs, ticks, body feet) are chart-zodiac and must be
        # converted so sidereal signs sit ayanamsa-rotated on the rete.
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
        bw = bool(getattr(opts, "bw", False))
        sign_boundaries = []
        sign_glyphs = []
        for i in range(12):
            # Real per-sign element tint from the engine — common.get_sign_color
            # (astrolabechart.py:679,900). Replaces the invented flat grey.
            sign_clr = _rgb_to_hex(common.get_sign_color(opts, i, bw=bw))
            sign_role = sign_color_role(opts, i, resolved_color=sign_clr)
            bx, by = proj.ecliptic_degree_xy(_tropical(chrt, i * 30), obliquity, R_eq, eramc, pole)
            sign_boundaries.append({
                "sign": i,
                "x": bx,
                "y": by,
                "color": sign_clr,
                "colorRole": sign_role,
            })
            # Glyph anchor at the sign midpoint, on the ecliptic circle.
            mx, my = proj.ecliptic_degree_xy(_tropical(chrt, i * 30.0 + 15.0), obliquity, R_eq, eramc, pole)
            sign_glyphs.append({
                "sign": i,
                "glyph": signs[i],
                "x": mx,
                "y": my,
                "color": sign_clr,
                "colorRole": sign_role,
            })

        def _rete_stars(rows):
            out = []
            for row in rows:
                try:
                    name = _star_display_name(row, opts)
                    nom = row[fixstars.FixStars.NOMNAME]
                    ra = float(row[fixstars.FixStars.RA])
                    decl = float(row[fixstars.FixStars.DECL])
                    lon = float(row[fixstars.FixStars.LON])
                except Exception:
                    continue
                sx, sy = proj.equatorial_to_xy(ra, decl, eramc, R_eq, pole)
                # Cull by the TRUE outer-tropic radius (proj.tropic_capricorn_radius),
                # not a fabricated 1.25x multiplier: stars outside the outermost
                # plate circle are not on the astrolabe.
                if math.hypot(sx, sy) > r_capricorn:
                    continue
                out.append({
                    "name": name, "nom": nom, "ra": ra, "decl": decl, "lon": lon,
                    "position": format_zodiac_position(lon),
                    **star_facts(row, opts),
                    "x": sx, "y": sy,
                })
            return out

        stars = _rete_stars(astrolabe_star_rows(chrt, star_codes))
        marked_stars = _rete_stars(astrolabe_star_rows(chrt, marked_codes))

        rete = {
            "ecliptic": {"cx": ecx, "cy": ecy, "r": ecl_r},
            "signBoundaries": sign_boundaries,
            "signGlyphLabels": sign_glyphs,
            "stars": stars,
            "markedStars": marked_stars,
        }

        # --- Bodies (true RA/Dec sphere + ecliptic-degree foot) -------------
        bodies = []
        for (bid, ra, decl, lon, glyph, color) in _iter_visible_bodies(chrt, opts):
            sx, sy = proj.equatorial_to_xy(ra, decl, eramc, R_eq, pole)
            ex, ey = proj.ecliptic_degree_xy(_tropical(chrt, lon), obliquity, R_eq, eramc, pole)
            # Filled (above) or hollow sphere: the body's true altitude, which
            # on the plate is inside the horizon circle.
            above = polar_azimuthal_service.altitude(eramc - ra, decl, latitude) > 0.0
            bodies.append({
                "id": int(bid),
                **minor_dignity_display_facts(chrt, bid),
                "glyph": glyph,
                "name": _body_name(bid),
                "position": format_zodiac_position(lon),
                "color": color,
                "colorRole": chart_body_color_role(
                    opts,
                    chrt,
                    bid,
                    is_fortune=bid == common.CHART_OBJECT_FORTUNE,
                    resolved_color=color,
                ),
                "ra": ra,
                "decl": decl,
                "lon": lon,
                "sphere": {"x": sx, "y": sy},
                "ecliptic": {"x": ex, "y": ey},
                "above": bool(above),
                "isSun": bool(bid == astrology.SE_SUN),
                "diskRadius": _disk_radius(chrt, bid, sx, sy),
            })

        # --- Atmospheric layer (DEFAULT view) --------------------------------
        # Filled plate: ground below horizon, sky above, sun-altitude-driven
        # sky colour (astrolabechart._draw_atmospheric / _atmo_draw_plate_disk,
        # astrolabechart.py:310-456). The React skin paints the lens; the daemon
        # ships the engine-computed colours + altitude so nothing is recomputed
        # in TypeScript.
        atmospheric = _atmospheric_payload(chrt, latitude, eramc)

        # --- Circle text labels (Equator / Horizon / Ecliptic) ---------------
        # astrolabechart._draw_circle_labels (astrolabechart.py:1007-1032). Anchor
        # points in projection space; the skin places the text.
        circle_labels = {
            "equator": {"x": 0.0, "y": -r_equator, "color": _rgb_to_hex(_CLR_EQUATOR)},
            "horizon": {"x": 0.0, "y": h_cy + h_rad, "color": _rgb_to_hex(_CLR_HORIZON)},
            "ecliptic": {"x": ecx, "y": ecy - ecl_r, "color": _rgb_to_hex(_CLR_ECLIPTIC)},
        }

        # --- Graduated zodiac wheel band (1/5/10/30 ticks + glyphs) ----------
        # astrolabechart._draw_zodiac_wheel_band (astrolabechart.py:613-680).
        # Ship the 360 tick anchor points (each with its level) + the 12 glyph
        # anchors at sign midpoints; the skin draws the radial strokes inward.
        zodiac_ticks = []
        for deg in range(360):
            tx, ty = proj.ecliptic_degree_xy(_tropical(chrt, deg), obliquity, R_eq, eramc, pole)
            level = 30 if deg % 30 == 0 else 10 if deg % 10 == 0 else 5 if deg % 5 == 0 else 1
            zodiac_ticks.append({"deg": deg, "x": tx, "y": ty, "level": level})
        zodiac_band = {
            "ecliptic": {"cx": ecx, "cy": ecy, "r": ecl_r},
            "ticks": zodiac_ticks,
            "glyphs": sign_glyphs,
        }

        def _rete_place(lon: float) -> dict:
            x, y = proj.ecliptic_degree_xy(_tropical(chrt, lon), obliquity, R_eq, eramc, pole)
            return {"x": x, "y": y}

        stepper = _direction_stepper_payload(chrt, opts, delta_deg, self._directions_cache)

        return {
            "name": getattr(chrt, "name", ""),
            "lat": float(latitude),
            "lon": float(longitude),
            "pole": "north" if pole > 0 else "south",
            "plateLat": float(plate_lat),
            "obliquity": float(obliquity),
            "ramc": float(ramc),
            "delta": float(delta_deg),
            "eramc": float(eramc),
            "jd": float(chrt.time.jd),
            "projection": PROJECTION_STEREOGRAPHIC,
            "center": {"horizonOffset": float(h_cy)},
            "radii": {
                "equator": float(r_equator),
                "cancer": float(r_cancer),
                "capricorn": float(r_capricorn),
            },
            "tympan": tympan,
            "rete": rete,
            "bodies": bodies,
            **({"pdReprojection": {
                **build_pd_overlay(
                    _pd_sky(chrt, opts), opts, delta_deg, PROJECTION_STEREOGRAPHIC,
                    self._directions_cache.get(chrt, opts)[1], stepper["yearsPerDegree"],
                ),
                "significators": self._pd_significators(chrt, opts, PROJECTION_STEREOGRAPHIC),
            }} if pd_overlay else {}),
            "angles": _angle_points(chrt, eramc, obliquity, latitude, R_eq, pole),
            "atmospheric": atmospheric,
            "circleLabels": circle_labels,
            "zodiacBand": zodiac_band,
            "zodiacDivisions": _zodiac_divisions(chrt, opts, _rete_place),
            **stepper,
        }


astrolabe_service = AstrolabeService()
