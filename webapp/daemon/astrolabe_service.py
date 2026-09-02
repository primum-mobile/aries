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

Projection (astrolabe_projection.py): south-polar stereographic onto the
equatorial plane. NCP at the centre of the diagram, MC at 12 o'clock, west to
the right, east to the left, all coords (x right, y down) relative to NCP=(0,0).

Output shape (all radii/coords in units of ``R_eq`` unless noted):
  {
    "name": str, "lat": float, "lon": float,
    "obliquity": deg, "ramc": deg, "delta": deg, "eramc": deg,
    "center": {"horizonOffset": ..},          # NCP→horizon-centre on screen (+y down)
    "radii": {"equator","cancer","capricorn"},
    "tympan": {
      "horizon": {cx,cy,r}, "equator": {..}, "tropicCancer": {..},
      "tropicCapricorn": {..}, "meridian": {x1,y1,x2,y2},
      "regioHouses": [{cx,cy,r}, ..],          # Regiomontanus intermediate cusps
      "almucantars": [{alt,cx,cy,r}, ..],      # altitude circles
      "azimuths": [{az,cx,cy,r}, ..],          # azimuth arcs
      "hourLines": [{hour,cx,cy,r}, ..],       # unequal (planetary) hour curves
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

import math
import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import astrolabe_projection as proj  # wx-free stereographic math
import chart as chart_mod
import common
import fixstars
import fortune
import houses
import planets
import primdirs
from primdirs import PrimDirs
from engine import symbolic_projection
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    chart_body_color_role,
    effective_display_options,
    sign_color_role,
)
from webapp.daemon.directions_service import _prom_label, _sig_label
from webapp.daemon.primdir_points import primdir_point_glyph
from webapp.frontend.scripts import export_chart_json

_DEG = math.pi / 180.0

# Normalized projection: every circle/point is expressed in units of R_eq, so
# the skin chooses the on-screen scale. Matches astrolabechart's R_eq-relative
# proj.* outputs (astrolabe_projection returns coords already divided by R_eq
# when R_eq=1.0).
_R_EQ = 1.0

# Altitude circles to ship (almucantars) — every 10° above the horizon, matching
# a classic astrolabe plate.
_ALMUCANTAR_ALTS = (10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0)

# Azimuth arcs — from south (0) through west (+) and east (-), every 30°.
_AZIMUTHS = (-90.0, -60.0, -30.0, 0.0, 30.0, 60.0, 90.0)

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
    sun = chrt.planets.planets[astrology.SE_SUN]
    if sun is None:
        return 0.0
    ra = sun.dataEqu[planets.Planet.RAEQU]
    dec = sun.dataEqu[planets.Planet.DECLEQU]
    ha = (eramc - ra) * _DEG
    dec_rad = dec * _DEG
    lat_rad = latitude * _DEG
    sin_alt = (math.sin(lat_rad) * math.sin(dec_rad)
               + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(ha))
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))


def _rgb_to_hex(rgb) -> str:
    try:
        r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return "#cdcdd1"
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _body_color_hex(chrt, options, body_id) -> str:
    """Mirror AstrolabeChart._get_body_color (astrolabechart.py:195-208)."""
    if body_id == planets.Planets.PLANETS_NUM:
        if getattr(options, "useplanetcolors", False):
            idx = min(astrology.SE_PLUTO + 2, len(options.clrindividual) - 1)
            return _rgb_to_hex(options.clrindividual[idx])
        return _rgb_to_hex(options.clrperegrin)
    if getattr(options, "useplanetcolors", False):
        idx = min(common.common.get_planet_color_index(body_id), len(options.clrindividual) - 1)
        return _rgb_to_hex(options.clrindividual[idx])
    if body_id == astrology.SE_CHIRON:
        return _rgb_to_hex(options.clrperegrin)
    pal = (options.clrdomicil, options.clrexal, options.clrperegrin, options.clrcasus, options.clrexil)
    try:
        return _rgb_to_hex(pal[chrt.dignity(body_id)])
    except Exception:
        return _rgb_to_hex(options.clrperegrin)


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
            fra, fdec = proj.ecl_lon_to_ra_dec(lon, obliquity)
            yield (
                planets.Planets.PLANETS_NUM, fra, fdec, lon,
                common.common.fortune,
                _body_color_hex(chrt, options, planets.Planets.PLANETS_NUM),
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


def _unequal_hour_lines(latitude, obliquity, R_eq):
    """Unequal (planetary) hour curves for the plate.

    Each curve is the locus of points at a constant fraction of the day/night
    arc. We approximate each of the 12 boundaries by the circle through the two
    horizon nodes (N/S poles of the horizon great circle) and the equator point
    at the matching hour angle — the same three-point construction the
    Regiomontanus houses use (astrolabe_projection.regio_house_circles,
    astrolabe_projection.py:211-248), but every 15° of RA rather than every 30°.
    These are the classic astrolabe day-hour lines for the equator; below the
    equator they bow but share the two horizon nodes.
    """
    lat = abs(latitude)
    n_r = proj.decl_to_radius(90.0 - lat, R_eq)
    s_r = proj.decl_to_radius(-(90.0 - lat), R_eq)
    north_pt = (0.0, n_r)
    south_pt = (0.0, -s_r)
    out = []
    # Hour angles for the 11 intermediate boundaries between the 12 unequal
    # hours, skipping ASC (-90) / MC (0) / DSC (+90) which are horizon+meridian.
    for hour, ha_deg in enumerate(range(-75, 90, 15), start=1):
        if ha_deg in (-90, 0, 90):
            continue
        ha = math.radians(ha_deg)
        ex = R_eq * math.sin(ha)
        ey = -R_eq * math.cos(ha)
        result = proj.three_point_center(north_pt, south_pt, (ex, ey))
        if result is None:
            continue
        cx, cy, r = result
        out.append({"hour": hour, "cx": cx, "cy": cy, "r": r})
    return out


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

    def geometry(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        document_id: Optional[str] = None,
        delta_deg: float = 0.0,
    ) -> dict:
        with self._lock:
            canonical_opts = chart_snapshot_service.options
            display_opts = effective_display_options(canonical_opts)
            radix = workspace_chart_for_document(document_id, launcher_kinds=("astrolabe",))
            if radix is not None:
                return self._build(radix, display_opts, max(0.0, float(delta_deg)))
            source_path = (
                str(Path(source).expanduser()) if source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            radix, _ = export_chart_json.load_chart(
                source_path, canonical_opts, name=source_name
            )
            # Forward-only rete: directions are forward in time. wx clamps the
            # arc to max(0.0, ...) (morin.py:19367,19377,19427); the daemon holds
            # the same clamp regardless of what the skin sends.
            return self._build(radix, display_opts, max(0.0, float(delta_deg)))

    def _build(self, chrt, opts, delta_deg: float) -> dict:
        R_eq = _R_EQ
        obliquity = chrt.obl[0]
        latitude = chrt.place.lat
        longitude = chrt.place.lon
        ramc = chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA]
        eramc = ramc + float(delta_deg)

        # --- Plate radii (astrolabechart.py:146-166, R_eq=1) ----------------
        r_cancer = proj.tropic_cancer_radius(obliquity, R_eq)
        r_capricorn = proj.tropic_capricorn_radius(obliquity, R_eq)
        r_equator = R_eq

        # Horizon: proj.horizon_circle returns center as a POSITIVE magnitude.
        # astrolabechart draws the horizon centre at SCREEN y = cy - h_off
        # (astrolabechart.py:473) — i.e. ABOVE the NCP, toward S / the zenith —
        # so in NCP-relative space (y down) the centre offset is -h_off, NOT
        # +h_off. Shipping +h_off mirrored the horizon to the wrong side.
        h_off, h_rad = proj.horizon_circle(latitude, R_eq)
        h_cy = -h_off  # NCP-relative horizon-centre y (matches wx cy - h_off)

        # --- Tympan (fixed plate) -------------------------------------------
        tympan = {
            "horizon": {"cx": 0.0, "cy": h_cy, "r": h_rad},
            "equator": {"cx": 0.0, "cy": 0.0, "r": r_equator},
            "tropicCancer": {"cx": 0.0, "cy": 0.0, "r": r_cancer},
            "tropicCapricorn": {"cx": 0.0, "cy": 0.0, "r": r_capricorn},
            # Meridian: vertical through the NCP, spanning the Capricorn disk.
            "meridian": {"x1": 0.0, "y1": -r_capricorn, "x2": 0.0, "y2": r_capricorn},
            # Asc-Dsc axis: horizontal through the horizon centre.
            "horizonAxis": {"x1": -r_capricorn, "y1": h_cy, "x2": r_capricorn, "y2": h_cy},
            "regioHouses": [
                {"cx": cx, "cy": cy, "r": r}
                for (cx, cy, r) in proj.regio_house_circles(latitude, R_eq)
            ],
            "almucantars": [],
            "azimuths": [],
            "hourLines": _unequal_hour_lines(latitude, obliquity, R_eq),
        }
        for alt in _ALMUCANTAR_ALTS:
            cy, r = proj.almucantar(alt, latitude, R_eq)
            if not math.isfinite(r) or r > 1e6:
                continue
            # almucantar() returns (center MAGNITUDE, radius); almucantar(0) ==
            # horizon_circle, so altitude circles share the horizon's sign — the
            # centre is at NCP-relative y = -cy (same flip as the horizon above).
            tympan["almucantars"].append({"alt": alt, "cx": 0.0, "cy": -cy, "r": r})
        for az in _AZIMUTHS:
            cx, cy, r = proj.azimuth_arc(az, latitude, R_eq)
            if not math.isfinite(r) or r > 1e6:
                continue
            tympan["azimuths"].append({"az": az, "cx": cx, "cy": cy, "r": r})

        # --- Rete (rotating: ecliptic + signs + star pointers) --------------
        _, ecl_r = proj.ecliptic_circle(obliquity, R_eq)
        ecx, ecy = proj.ecliptic_center_xy(obliquity, R_eq, eramc)
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
        bw = bool(getattr(opts, "bw", False))
        sign_boundaries = []
        sign_glyphs = []
        for i in range(12):
            # Real per-sign element tint from the engine — common.get_sign_color
            # (astrolabechart.py:679,900). Replaces the invented flat grey.
            sign_clr = _rgb_to_hex(common.get_sign_color(opts, i, bw=bw))
            sign_role = sign_color_role(opts, i, resolved_color=sign_clr)
            bx, by = proj.ecliptic_degree_xy(float(i * 30), obliquity, R_eq, eramc)
            sign_boundaries.append({
                "sign": i,
                "x": bx,
                "y": by,
                "color": sign_clr,
                "colorRole": sign_role,
            })
            # Glyph anchor at the sign midpoint, on the ecliptic circle.
            mx, my = proj.ecliptic_degree_xy(i * 30.0 + 15.0, obliquity, R_eq, eramc)
            sign_glyphs.append({
                "sign": i,
                "glyph": signs[i],
                "x": mx,
                "y": my,
                "color": sign_clr,
                "colorRole": sign_role,
            })

        stars = []
        fs = getattr(chrt, "fixstars", None)
        if fs is not None and getattr(fs, "data", None):
            for row in fs.data:
                try:
                    name = row[fixstars.FixStars.NAME]
                    nom = row[fixstars.FixStars.NOMNAME]
                    ra = float(row[fixstars.FixStars.RA])
                    decl = float(row[fixstars.FixStars.DECL])
                except Exception:
                    continue
                sx, sy = proj.equatorial_to_xy(ra, decl, eramc, R_eq)
                # Cull by the TRUE Capricorn radius (proj.tropic_capricorn_radius),
                # not a fabricated 1.25x multiplier: stars outside the outermost
                # plate circle are not on the astrolabe.
                if math.hypot(sx, sy) > r_capricorn:
                    continue
                stars.append({
                    "name": name, "nom": nom, "ra": ra, "decl": decl,
                    "x": sx, "y": sy,
                })

        rete = {
            "ecliptic": {"cx": ecx, "cy": ecy, "r": ecl_r},
            "signBoundaries": sign_boundaries,
            "signGlyphLabels": sign_glyphs,
            "stars": stars,
        }

        # --- Bodies (true RA/Dec sphere + ecliptic-degree foot) -------------
        bodies = []
        for (bid, ra, decl, lon, glyph, color) in _iter_visible_bodies(chrt, opts):
            sx, sy = proj.equatorial_to_xy(ra, decl, eramc, R_eq)
            ex, ey = proj.ecliptic_degree_xy(lon, obliquity, R_eq, eramc)
            # Above-horizon test in NCP-relative space: distance from horizon
            # centre (0, h_cy) < horizon radius (astrolabechart.py:700, where
            # hcy = cy - h_off, so NCP-relative distance is hypot(sx, sy + h_off)).
            above = math.hypot(sx - 0.0, sy - h_cy) < h_rad
            bodies.append({
                "id": int(bid),
                "glyph": glyph,
                "color": color,
                "colorRole": chart_body_color_role(
                    opts,
                    chrt,
                    bid,
                    is_fortune=bid == planets.Planets.PLANETS_NUM,
                    resolved_color=color,
                ),
                "ra": ra,
                "decl": decl,
                "lon": lon,
                "sphere": {"x": sx, "y": sy},
                "ecliptic": {"x": ex, "y": ey},
                "above": bool(above),
                "isSun": bool(bid == astrology.SE_SUN),
            })

        # --- Atmospheric layer (DEFAULT view) --------------------------------
        # Filled plate: ground below horizon, sky above, sun-altitude-driven
        # sky colour (astrolabechart._draw_atmospheric / _atmo_draw_plate_disk,
        # astrolabechart.py:310-456). The React skin paints the lens; the daemon
        # ships the engine-computed colours + altitude so nothing is recomputed
        # in TypeScript.
        sun_alt = _directed_sun_altitude(chrt, latitude, eramc)
        sky_rgb = _sky_color_for_altitude(sun_alt)
        # Ground = darkened sky, matching astrolabechart.py:406-409.
        dayness = max(0.0, min(1.0, (sun_alt + 6.0) / 12.0))
        darken = 0.18 + dayness * 0.22
        ground_rgb = tuple(int(sky_rgb[j] * (1 - darken)) for j in range(3))
        atmospheric = {
            "sunAltitude": float(sun_alt),
            "sky": _rgb_to_hex(sky_rgb),
            "ground": _rgb_to_hex(ground_rgb),
        }

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
            tx, ty = proj.ecliptic_degree_xy(float(deg), obliquity, R_eq, eramc)
            level = 30 if deg % 30 == 0 else 10 if deg % 10 == 0 else 5 if deg % 5 == 0 else 1
            zodiac_ticks.append({"deg": deg, "x": tx, "y": ty, "level": level})
        zodiac_band = {
            "ecliptic": {"cx": ecx, "cy": ecy, "r": ecl_r},
            "ticks": zodiac_ticks,
            "glyphs": sign_glyphs,
        }

        # --- Primary-direction stepper + PD-exact overlay --------------------
        # Engine PD list (same projection the desktop stepper uses); arc-sorted
        # snap list + the nearby-events overlay rows for the current arc.
        years_per_deg = float(_pd_years_per_degree(opts))
        pds_obj, pd_entries = _build_pd_directions(chrt, opts)
        snap_arcs = _snap_arcs(pd_entries)
        nearby_events = _nearby_pd_events(pds_obj, pd_entries, delta_deg, years_per_deg)

        # --- Info label (Arc d°m's" + Age N yrs) -----------------------------
        # astrolabechart._draw_info_label (astrolabechart.py:1034-1061).
        arc_deg = abs(float(delta_deg))
        d_whole = int(arc_deg)
        rem = (arc_deg - d_whole) * 60.0
        m_whole = int(rem)
        s_whole = int((rem - m_whole) * 60.0)
        age_years = arc_deg * years_per_deg
        info_label = {
            "arc": u"Arc %s%d°%02d'%02d\"" % (
                "+" if delta_deg >= 0 else "-", d_whole, m_whole, s_whole,
            ),
            "age": "Age %.1f yrs" % age_years,
            "deltaDeg": float(delta_deg),
            "ageYears": float(age_years),
        }

        return {
            "name": getattr(chrt, "name", ""),
            "lat": float(latitude),
            "lon": float(longitude),
            "obliquity": float(obliquity),
            "ramc": float(ramc),
            "delta": float(delta_deg),
            "eramc": float(eramc),
            "yearsPerDegree": years_per_deg,
            "center": {"horizonOffset": float(h_cy)},
            "radii": {
                "equator": float(r_equator),
                "cancer": float(r_cancer),
                "capricorn": float(r_capricorn),
            },
            "tympan": tympan,
            "rete": rete,
            "bodies": bodies,
            "atmospheric": atmospheric,
            "circleLabels": circle_labels,
            "zodiacBand": zodiac_band,
            "infoLabel": info_label,
            "pd": {
                "snapArcs": snap_arcs,
                "nearbyEvents": nearby_events,
            },
        }


astrolabe_service = AstrolabeService()
