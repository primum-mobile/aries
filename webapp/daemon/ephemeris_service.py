# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Graphic Ephemeris daemon service.

Brain: ``ephemcalc.EphemCalc`` (ephemcalc.py:8-87) runs AS-IS — one sample per
day for 12 anchored months of planet longitudes + declinations in the selected
zodiac. Station detection is the wx-fused semantic EXTRACTED verbatim from
``graphephemwnd.GraphEphemWnd`` (graphephemwnd.py:365-537): longitude SR/SD via
aries.astrology.transit_fast batch search with the series-inflection fallback,
declination DN/DS extrema + EQ zero crossings via the same bisection refiners.
Nothing here imports wx; the React view (graph-ephemeris-view.tsx) only renders
these payloads.

The view is a continuous camera over calendar-month blocks the client keeps:
``meta`` (presentation), ``blocks`` (daily series + every event a month owns)
and ``stations`` (longitude SR/SD per calendar year). Series blocks are cached
per month and options identity, after morin._ephemeris_cache_key /
GraphEphemPanel._series_cache_key (morin.py:5428-5434,
graphephemframe.py:338-345). The per-radix view-state store
mirrors morin.ephemeris_state_for_radix/_radix_view_state_key
(morin.py:5364-5426).
"""
from __future__ import annotations

import base64
import calendar
import datetime
import hashlib
import itertools
import json
import math
import sys
import threading
from array import array
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import chart
import common
import eclipses
import ephemcalc
import mtexts
import planets
import util
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import search_longitude_transits_batch, search_station_times_batch
from engine import planetary_state

from webapp.daemon.chart_service import chart_snapshot_service


_FLAGS = astrology.SEFLG_SWIEPH + astrology.SEFLG_SPEED

# graphephemwnd.GraphEphemWnd.PLANET_ORDER (graphephemwnd.py:28-40).
PLANET_ORDER = (
    astrology.SE_SUN,
    astrology.SE_MOON,
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
    astrology.SE_JUPITER,
    astrology.SE_SATURN,
    astrology.SE_URANUS,
    astrology.SE_NEPTUNE,
    astrology.SE_PLUTO,
    astrology.SE_CHIRON,
    astrology.SE_MEAN_APOG,
    astrology.SE_OSCU_APOG,
)

# graphephemframe.GraphEphemPanel.PLANET_LABEL_KEYS (graphephemframe.py:16-28).
PLANET_LABEL_KEYS = {
    astrology.SE_SUN: 'Sun',
    astrology.SE_MOON: 'Moon',
    astrology.SE_MERCURY: 'Mercury',
    astrology.SE_VENUS: 'Venus',
    astrology.SE_MARS: 'Mars',
    astrology.SE_JUPITER: 'Jupiter',
    astrology.SE_SATURN: 'Saturn',
    astrology.SE_URANUS: 'Uranus',
    astrology.SE_NEPTUNE: 'Neptune',
    astrology.SE_PLUTO: 'Pluto',
    astrology.SE_CHIRON: 'Chiron',
    astrology.SE_MEAN_APOG: 'Apogee',
    astrology.SE_OSCU_APOG: 'Apogee',
}

# graphephemwnd.GraphEphemWnd.SIGN_NAME_KEYS (graphephemwnd.py:41).
SIGN_NAME_KEYS = ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                  'Libra', 'Scorpio', 'Sagittarius', 'Capricornus',
                  'Aquarius', 'Pisces')

# chart.Chart.dignity codes as wire names (meta dignityBySign).
_DIGNITY_NAMES = {
    chart.Chart.DOMICIL: 'domicile',
    chart.Chart.EXAL: 'exaltation',
    chart.Chart.EXIL: 'detriment',
    chart.Chart.CASUS: 'fall',
    chart.Chart.PEREGRIN: 'peregrine',
}

VIEW_MODULI = (360, 90, 45, 30)
DEFAULT_VIEW_MODULUS = 45
# 'dignity' colours each curve by its essential dignity. A stored 'chart' is
# the retired "follow the wheel" mode (body colours, or dignity when the theme
# turned planet colours off), which was the first default: it reads back as
# the default so every theme shows planet colours until dignity is picked.
VIEW_INK_MODES = ('tiers', 'planets', 'dignity')
DEFAULT_VIEW_INK_MODE = 'planets'


def _hex(rgb, fallback: str) -> str:
    try:
        return "#%02x%02x%02x" % (int(rgb[0]), int(rgb[1]), int(rgb[2]))
    except Exception:
        return fallback


def _rgb_key(rgb) -> Optional[tuple[int, int, int]]:
    try:
        return (
            max(0, min(255, int(rgb[0]))),
            max(0, min(255, int(rgb[1]))),
            max(0, min(255, int(rgb[2]))),
        )
    except Exception:
        return None


def _rgb_list_key(values) -> tuple:
    return tuple(_rgb_key(value) for value in list(values or ()))


def _planet_colour_hex(options, planet_id: int, bw: bool = False) -> str:
    """graphephemwnd._planet_colour (graphephemwnd.py:159-164)."""
    if bw:
        return "#000000"
    table = getattr(options, 'clrindividual', None)
    if not table:
        return "#000000"
    idx = common.common.get_planet_color_index(planet_id)
    idx = min(max(0, int(idx)), len(table) - 1)
    return _hex(table[idx], "#000000")


def _ephemeris_colors(options, bw: bool) -> dict:
    """Resolved GraphEphemWnd color slots (graphephemwnd.py:1080-1091)."""
    if bw:
        black = "#000000"
        return {
            "background": "#ffffff",
            "frame": black,
            "texts": black,
            "grid": black,
            "signs": black,
        }
    return {
        "background": _hex(getattr(options, 'clrbackground', (255, 255, 255)), "#ffffff"),
        "frame": _hex(getattr(options, 'clrframe', (0, 0, 0)), "#000000"),
        "texts": _hex(getattr(options, 'clrtexts', (0, 0, 0)), "#000000"),
        "grid": _hex(getattr(options, 'clrhouses', (128, 128, 128)), "#808080"),
        "signs": _hex(getattr(options, 'clrsigns', (0, 0, 0)), "#000000"),
    }


def _dignity_by_sign(options, planet_id: int) -> list[str]:
    """The wheel's essential-dignity code of ``planet_id`` in each sign.

    Calls chart.Chart.dignity (the classifier object_glyph_color paints from)
    with the effective options' dignity table at each sign's midpoint; bodies
    the engine gives no dignity (Chiron, apogees) read peregrine, as
    object_glyph_color paints them with clrperegrin."""
    holder = _DignityOptions(options)
    codes = []
    for sign in range(12):
        try:
            code = chart.Chart.dignity(holder, int(planet_id), sign * 30.0 + 15.0)
        except Exception:
            code = chart.Chart.PEREGRIN
        codes.append(_DIGNITY_NAMES.get(code, 'peregrine'))
    return codes


def _hover_glyph_colors(options, planet_ids, bw: bool) -> dict:
    """App chart colours for the hover flag's glyphs, as the lists paint them.

    Planets: ``object_glyph_color`` / ``object_glyph_color_role`` with the
    body's essential dignity in each sign (``chart.Chart.dignity`` at the
    sign's midpoint, as ``dignityBySign``). Signs: the chart flag's
    ``get_sign_color`` / ``sign_color_role``. Aspects: the aspect list's
    colour (``_aspect_metadata``: ``clraspect``, else the text colour, with
    ``aspect_color_role``). Black-and-white keeps the plate's text colour."""
    from types import SimpleNamespace
    from webapp.daemon.display_palette import (
        aspect_color_role,
        effective_display_options,
        object_glyph_color,
        object_glyph_color_role,
        sign_color_role,
    )

    if bw:
        black = "#000000"
        return {
            "planets": {str(int(pid)): {"bySign": [black] * 12, "roleBySign": [None] * 12} for pid in planet_ids},
            "signs": {"colors": [black] * 12, "roles": [None] * 12},
            "aspects": {"colors": [], "roles": []},
        }
    try:
        display_options = effective_display_options(options)
    except Exception:
        display_options = options
    text = _hex(getattr(display_options, 'clrtexts', None), "#000000")
    holder = _DignityOptions(display_options)
    fallback = getattr(display_options, 'clrperegrin', None)
    planets_out: dict[str, dict] = {}
    for pid in planet_ids:
        obj = SimpleNamespace(id=f"planet:{int(pid)}", planet_index=int(pid))
        colors: list[str] = []
        roles: list[Optional[str]] = []
        for sign in range(12):
            try:
                code = chart.Chart.dignity(holder, int(pid), sign * 30.0 + 15.0)
            except Exception:
                code = chart.Chart.PEREGRIN
            value = object_glyph_color(display_options, obj, code, fallback=fallback)
            colors.append(_hex(value, text))
            roles.append(object_glyph_color_role(display_options, obj, code, resolved_color=value))
        planets_out[str(int(pid))] = {"bySign": colors, "roleBySign": roles}
    sign_colors: list[str] = []
    sign_roles: list[Optional[str]] = []
    for sign in range(12):
        try:
            value = common.get_sign_color(display_options, sign)
        except Exception:
            value = getattr(display_options, 'clrsigns', None)
        sign_colors.append(_hex(value, text))
        sign_roles.append(sign_color_role(display_options, sign, resolved_color=value))
    aspect_colors: list[str] = []
    aspect_roles: list[Optional[str]] = []
    for aspect_type in range(len(getattr(display_options, 'clraspect', None) or ())):
        value = display_options.clraspect[aspect_type]
        aspect_colors.append(_hex(value, text))
        aspect_roles.append(aspect_color_role(display_options, aspect_type, resolved_color=value))
    return {
        "planets": planets_out,
        "signs": {"colors": sign_colors, "roles": sign_roles},
        "aspects": {"colors": aspect_colors, "roles": aspect_roles},
    }


class _DignityOptions:
    """The ``self`` chart.Chart.dignity reads: only ``options`` (a longitude
    is always passed, so no planet table is consulted)."""

    __slots__ = ('options',)

    def __init__(self, options) -> None:
        self.options = options


def _dignity_table_key(options) -> tuple:
    table = getattr(options, 'dignities', None) or ()
    try:
        return tuple(tuple(tuple(bool(v) for v in row) for row in kinds) for kinds in table)
    except TypeError:
        return ()


def _zodiac_label(options) -> str:
    """Tropical, or the sidereal ayanamsha name, as the wheel centre shows
    it (directions_service._zodiac_label)."""
    ayanamsha = int(getattr(options, 'ayanamsha', 0) or 0)
    if ayanamsha:
        from webapp.frontend.scripts import export_chart_json
        return export_chart_json.ayanamsha_label(ayanamsha)
    return mtexts.txts.get('WheelCenterTropical', 'Tropical')


def _default_planet_visibility(mode: str, planet_id: int) -> bool:
    """graphephemwnd._default_planet_visibility (graphephemwnd.py:100-103)."""
    if mode == 'declination':
        return planet_id in (astrology.SE_SUN, astrology.SE_MERCURY)
    return planet_id != astrology.SE_MOON


def _start_jd(year: int, start_month: int) -> Optional[float]:
    """graphephemwnd._chart_start_jd (graphephemwnd.py:343-348)."""
    try:
        tim = chart.Time(int(year), int(start_month), 1, 0, 0, 0, False,
                         chart.Time.GREGORIAN, chart.Time.GREENWICH, True,
                         0, 0, False, None, False)
        return float(tim.jd)
    except Exception:
        return None


DEFAULT_SPAN_MONTHS = 12
MAX_SPAN_MONTHS = 120
# The camera's visible span in days (view state), four weeks to ten years.
MIN_SPAN_DAYS = 28.0
MAX_SPAN_DAYS = 3653.0
# The standard zoom a radix first opens at: three months (the frontend's
# EPHEMERIS_DEFAULT_SPAN_MONTHS, also what Reset zoom returns to).
DEFAULT_CAMERA_SPAN_DAYS = 3 * 365.2425 / 12


def _span_months(months) -> int:
    """An old stored window span in whole calendar months, 1..MAX_SPAN_MONTHS."""
    try:
        value = int(months)
    except (TypeError, ValueError):
        return DEFAULT_SPAN_MONTHS
    return min(MAX_SPAN_MONTHS, max(1, value))


def _month_offsets(year: int, start_month: int, months: int = DEFAULT_SPAN_MONTHS) -> list[int]:
    """graphephemwnd._month_start_offsets (graphephemwnd.py:260-274), for a
    plot of ``months`` calendar months (12 in wx)."""
    offsets = [0]
    total = 0
    y, m = int(year), int(start_month)
    for _ in range(int(months)):
        total += calendar.monthrange(y, m)[1]
        offsets.append(total)
        y, m = util.incrMonth(y, m)
    return offsets


def _format_date_jd(jd_ut: float) -> Optional[str]:
    """graphephemwnd._format_hover_date_jd (graphephemwnd.py:539-547)."""
    try:
        y, m, d, _ = astrology.swe_revjul(float(jd_ut) + 1e-9, astrology.SE_GREG_CAL)
    except Exception:
        return None
    month = common.common.monthabbr[m - 1]
    if month:
        month = month[:1].upper() + month[1:]
    return '%s %d' % (month, d)


def _month_jd(year: int, month: int) -> float:
    """00:00 Greenwich on the 1st: the first daily sample of that month."""
    return astrology.swe_julday(int(year), int(month), 1, 0.0, astrology.SE_GREG_CAL)


def _window_months(year: int, start_month: int, months: int = DEFAULT_SPAN_MONTHS) -> list[tuple[int, int]]:
    """The calendar months of one anchored plot, in order."""
    out = []
    y, m = int(year), int(start_month)
    for _ in range(int(months)):
        out.append((y, m))
        y, m = util.incrMonth(y, m)
    return out


def _fast_ephemeris_series(year: int, options, start_month: int, months: int = DEFAULT_SPAN_MONTHS) -> dict:
    """EphemCalc-compatible daily series without chart.Time/Planet wrappers.

    EphemCalc samples 00:00 Greenwich once per calendar day and asks Swiss
    Ephemeris for ecliptic positions directly in the selected zodiac. Keep that
    exact behavior here; this is only a daemon-side fast path for the renderer.
    """
    days = _month_offsets(year, start_month, months)[-1]
    return _daily_samples(options, _month_jd(year, start_month), days)


def _daily_samples(options, start_jd: float, days: int) -> dict:
    """One 00:00 UT sample per day from ``start_jd``: the series kernel.

    Each sample depends only on its own JD, so a month computed alone is
    bit-identical to the same days inside any 12-month window.
    """
    context = _longitude_context(options)
    flags = context.flags
    series = {}
    for planet_id in ephemcalc.EphemCalc.get_planet_ids(options):
        longitudes = []
        declinations = []
        for chunk_start in range(0, days, 32):
            with context.activate():
                for day in range(chunk_start, min(chunk_start + 32, days)):
                    jd_ut = start_jd + day
                    _serr, ecl = astrology.swe_calc_ut(jd_ut, planet_id, flags)
                    equatorial_flags = (flags & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL
                    _serr_equ, equ = astrology.swe_calc_ut(jd_ut, planet_id, equatorial_flags)
                    lon = float(ecl[planets.Planet.LONG])
                    longitudes.append(lon)
                    declinations.append(float(equ[planets.Planet.DECLEQU]))
        series[planet_id] = {
            'longitude': longitudes,
            'declination': declinations,
        }
    return series


# --- station math, transcribed from graphephemwnd.py:365-537 ----------------

def _longitude_context(options) -> EphemerisContext:
    flags = int(_FLAGS)
    sidereal_mode = None
    if int(getattr(options, 'ayanamsha', 0) or 0) != 0:
        sidereal_mode = astrology.ayanamsha_swe_mode(options.ayanamsha)
        flags |= astrology.SEFLG_SIDEREAL
    return EphemerisContext(
        flags=flags,
        ephe_path=common.get_ephe_path(),
        sidereal_mode=sidereal_mode,
    )


def _speed_lon(options, planet_id: int, jd_ut: float) -> Optional[float]:
    try:
        context = _longitude_context(options)
        with context.activate():
            pl = planets.Planet(float(jd_ut), int(planet_id), context.flags)
        return float(pl.data[planets.Planet.SPLON])
    except Exception:
        return None


def _speed_decl(planet_id: int, jd_ut: float) -> Optional[float]:
    try:
        pl = planets.Planet(float(jd_ut), int(planet_id), _FLAGS)
        return float(pl.dataEqu[planets.Planet.SPDECLEQU])
    except Exception:
        return None


def _lon_at_jd(options, planet_id: int, jd_ut: float) -> Optional[float]:
    try:
        context = _longitude_context(options)
        with context.activate():
            pl = planets.Planet(float(jd_ut), int(planet_id), context.flags)
        return float(pl.data[planets.Planet.LONG])
    except Exception:
        return None


def _decl_at_jd(planet_id: int, jd_ut: float) -> Optional[float]:
    try:
        pl = planets.Planet(float(jd_ut), int(planet_id), _FLAGS)
        return float(pl.dataEqu[planets.Planet.DECLEQU])
    except Exception:
        return None


def _refine_station_root(options, planet_id: int, jd_a: float, jd_b: float) -> Optional[float]:
    sa = _speed_lon(options, planet_id, jd_a)
    sb = _speed_lon(options, planet_id, jd_b)
    if sa is None or sb is None:
        return None
    for _ in range(24):
        mid = 0.5 * (jd_a + jd_b)
        sm = _speed_lon(options, planet_id, mid)
        if sm is None:
            return None
        if abs(sm) < 1e-6 or abs(jd_b - jd_a) < 1e-4:
            return mid
        if sa * sm <= 0.0:
            jd_b, sb = mid, sm
        else:
            jd_a, sa = mid, sm
    return 0.5 * (jd_a + jd_b)


def _longitude_station_code(options, planet_id: int, jd_ut: float) -> Optional[str]:
    before = _speed_lon(options, planet_id, float(jd_ut) - 0.05)
    after = _speed_lon(options, planet_id, float(jd_ut) + 0.05)
    if before is None or after is None:
        return None
    if before > 0.0 and after < 0.0:
        return 'SR'
    if before < 0.0 and after > 0.0:
        return 'SD'
    return None


def _unwrap(series) -> list[float]:
    if not series:
        return []
    out = [float(series[0])]
    prev = out[0]
    for value in series[1:]:
        cur = float(value)
        while cur - prev > 180.0:
            cur -= 360.0
        while cur - prev < -180.0:
            cur += 360.0
        out.append(cur)
        prev = cur
    return out


def _fallback_longitude_hits(options, series, planet_id: int, start_jd: float, end_jd: float) -> list[float]:
    if len(series) < 3:
        return []
    hits = []
    unwrapped = _unwrap(series)
    for i in range(1, len(unwrapped) - 1):
        left = unwrapped[i] - unwrapped[i - 1]
        right = unwrapped[i + 1] - unwrapped[i]
        if not ((left > 0.0 and right < 0.0) or (left < 0.0 and right > 0.0)):
            continue
        root = _refine_station_root(options, planet_id, start_jd + i - 1, start_jd + i + 1)
        if root is not None and float(start_jd) <= root <= float(end_jd):
            hits.append(root)
    return hits


def _longitude_station_hit_map(options, series_by_planet, planet_ids, start_jd: float, end_jd: float):
    result = dict((int(pid), []) for pid in planet_ids)
    if not result:
        return result
    try:
        hits = search_station_times_batch(
            list(result.keys()),
            float(start_jd),
            float(end_jd),
            context=_longitude_context(options),
        )
        for hit in hits:
            if getattr(hit, 'hit_type', None) != 'station':
                continue
            pid = int(getattr(hit, 'planet'))
            if pid in result:
                result[pid].append(float(hit.jd_ut))
        return result
    except Exception:
        for pid in result:
            result[pid] = _fallback_longitude_hits(
                options, series_by_planet.get(pid, {}).get('longitude', ()), pid, start_jd, end_jd)
        return result


def _refine_decl_station_root(planet_id: int, jd_a: float, jd_b: float) -> Optional[float]:
    sa = _speed_decl(planet_id, jd_a)
    sb = _speed_decl(planet_id, jd_b)
    if sa is None or sb is None or sa * sb > 0.0:
        return None
    for _ in range(28):
        mid = 0.5 * (jd_a + jd_b)
        sm = _speed_decl(planet_id, mid)
        if sm is None:
            return None
        if abs(sm) < 1e-8 or abs(jd_b - jd_a) < 1e-6:
            return mid
        if sa * sm <= 0.0:
            jd_b, sb = mid, sm
        else:
            jd_a, sa = mid, sm
    return 0.5 * (jd_a + jd_b)


def _refine_decl_extremum(jd_a, jd_b, jd_c, va, vb, vc):
    den = va - (2.0 * vb) + vc
    if abs(den) < 1e-12:
        return jd_b
    shift = 0.5 * (va - vc) / den
    if shift < -1.0 or shift > 1.0:
        return jd_b
    return jd_b + shift


def _decl_extremum_value(va, vb, vc):
    den = va - (2.0 * vb) + vc
    if abs(den) < 1e-12:
        return vb
    return vb - (((va - vc) * (va - vc)) / (8.0 * den))


def _refine_decl_zero_cross(jd_a, jd_b, va, vb):
    dv = vb - va
    if abs(dv) < 1e-12:
        return 0.5 * (jd_a + jd_b)
    return jd_a - (va * (jd_b - jd_a)) / dv


def _refine_decl_zero_root(planet_id: int, jd_a: float, jd_b: float) -> Optional[float]:
    va = _decl_at_jd(planet_id, jd_a)
    vb = _decl_at_jd(planet_id, jd_b)
    if va is None or vb is None:
        return None
    if abs(va) < 1e-10:
        return jd_a
    if abs(vb) < 1e-10:
        return jd_b
    if va * vb > 0.0:
        return None
    for _ in range(28):
        mid = 0.5 * (jd_a + jd_b)
        vm = _decl_at_jd(planet_id, mid)
        if vm is None:
            return None
        if abs(vm) < 1e-8 or abs(jd_b - jd_a) < 1e-6:
            return mid
        if va * vm <= 0.0:
            jd_b, vb = mid, vm
        else:
            jd_a, va = mid, vm
    return 0.5 * (jd_a + jd_b)


def _longitude_stations(options, series_by_planet, planet_ids, start_jd, days) -> list[dict]:
    """graphephemwnd._build_station_snap_targets longitude branch
    (graphephemwnd.py:692-716)."""
    out: list[dict] = []
    hit_map = _longitude_station_hit_map(options, series_by_planet, planet_ids, start_jd, start_jd + days)
    for pid in planet_ids:
        if len(series_by_planet.get(pid, {}).get('longitude', ())) < 3:
            continue
        for root_jd in hit_map.get(int(pid), ()):
            code = _longitude_station_code(options, pid, root_jd)
            if code is None:
                continue
            lon = _lon_at_jd(options, pid, root_jd)
            date_txt = _format_date_jd(root_jd)
            if lon is None or date_txt is None:
                continue
            out.append({
                "planet": int(pid),
                "jd": float(root_jd),
                "dayOffset": float(root_jd - start_jd),
                "value": float(lon),
                "code": code,
                "date": date_txt,
            })
    return out


# A month block searches one day past each edge and keeps only the hits inside
# its own half-open month, so adjacent blocks never miss or repeat a seam event.
# Longitude stations are not blocked: transit_fast accepts a station root
# anywhere |speed| <= 1e-3 deg/day, which for the outer planets spans hours, so
# the root (and occasional repeat hits) depends on the search bracket. They keep
# one canonical bracket per calendar year (EphemerisService.stations).
_BLOCK_SEARCH_MARGIN_DAYS = 1.0


def _memoized(memo: Optional[dict], key: tuple, compute):
    """Reuse a refinement keyed by absolute JD; ``memo=None`` always computes."""
    if memo is None:
        return compute()
    if key in memo:
        return memo[key]
    value = compute()
    memo[key] = value
    return value


def _declination_stations(series_by_planet, planet_ids, start_jd, memo: Optional[dict] = None) -> list[dict]:
    """graphephemwnd._build_station_snap_targets declination branch
    (graphephemwnd.py:717-756): DN/DS extrema + EQ equator crossings.

    Every refinement brackets absolute sample days, so ``memo`` (keyed by
    planet and bracket JD) returns the same root to every overlapping window.
    """
    out: list[dict] = []
    for pid in planet_ids:
        series = series_by_planet.get(pid, {}).get('declination', ())
        if len(series) < 3:
            continue
        for i in range(1, len(series) - 1):
            va, vb, vc = float(series[i - 1]), float(series[i]), float(series[i + 1])
            left = vb - va
            right = vc - vb
            if not ((left > 0.0 and right < 0.0) or (left < 0.0 and right > 0.0)):
                continue

            def turn(i=i, va=va, vb=vb, vc=vc, pid=pid):
                root_jd = _refine_decl_station_root(pid, start_jd + i - 1, start_jd + i + 1)
                if root_jd is None:
                    root_jd = _refine_decl_extremum(
                        start_jd + i - 1, start_jd + i, start_jd + i + 1, va, vb, vc)
                decl = _decl_at_jd(pid, root_jd)
                if decl is None:
                    decl = _decl_extremum_value(va, vb, vc)
                return root_jd, decl, _format_date_jd(root_jd)

            root_jd, decl, date_txt = _memoized(memo, ('turn', int(pid), start_jd + i), turn)
            if date_txt is None:
                continue
            out.append({
                "planet": int(pid),
                "jd": float(root_jd),
                "dayOffset": float(root_jd - start_jd),
                "value": float(decl),
                "code": 'DN' if left < 0.0 and right > 0.0 else 'DS',
                "date": date_txt,
            })
        for i in range(len(series) - 1):
            va, vb = float(series[i]), float(series[i + 1])
            if va == 0.0 or vb == 0.0 or (va < 0.0 and vb > 0.0) or (va > 0.0 and vb < 0.0):
                def crossing(i=i, va=va, vb=vb, pid=pid):
                    root_jd = _refine_decl_zero_root(pid, start_jd + i, start_jd + i + 1)
                    if root_jd is None:
                        root_jd = _refine_decl_zero_cross(start_jd + i, start_jd + i + 1, va, vb)
                    return root_jd, _format_date_jd(root_jd)

                root_jd, date_txt = _memoized(memo, ('equator', int(pid), start_jd + i), crossing)
                if date_txt is None:
                    continue
                out.append({
                    "planet": int(pid),
                    "jd": float(root_jd),
                    "dayOffset": float(root_jd - start_jd),
                    "value": 0.0,
                    "code": 'EQ',
                    "date": date_txt,
                })
    return out


def _sign_change_pair(target_sign_index: int, speed: float) -> tuple[int, int]:
    target_sign_index = int(target_sign_index) % chart.Chart.SIGN_NUM
    if float(speed) < 0.0:
        return target_sign_index, (target_sign_index - 1) % chart.Chart.SIGN_NUM
    return (target_sign_index - 1) % chart.Chart.SIGN_NUM, target_sign_index


def _angle_delta_abs(left: float, right: float) -> float:
    delta = abs((float(left) - float(right) + 180.0) % 360.0 - 180.0)
    return delta


def _target_sign_for_hit(search_targets: list[tuple[float, int]], target_deg: float) -> Optional[int]:
    if not search_targets:
        return None
    best_target, best_sign = min(
        search_targets,
        key=lambda item: _angle_delta_abs(item[0], target_deg),
    )
    if _angle_delta_abs(best_target, target_deg) > 1e-6:
        return None
    return int(best_sign)


def _sign_search_targets() -> list[tuple[float, int]]:
    return [(float(sign_index * chart.Chart.SIGN_DEG), sign_index)
            for sign_index in range(chart.Chart.SIGN_NUM)]


def _sign_event_from_hit(hit, search_targets) -> Optional[dict]:
    """One sign-boundary crossing as an absolute-JD event (no day offset)."""
    if getattr(hit, 'hit_type', None) != 'longitude':
        return None
    target_sign = _target_sign_for_hit(search_targets, float(hit.target_deg))
    if target_sign is None:
        return None
    left_sign, right_sign = _sign_change_pair(target_sign, float(hit.speed))
    retrograde = float(hit.speed) < 0.0
    event_sign = left_sign if retrograde else right_sign
    date_txt = _format_date_jd(float(hit.jd_ut))
    return {
        "planet": int(hit.planet),
        "jd": float(hit.jd_ut),
        "value": float(target_sign * chart.Chart.SIGN_DEG),
        "targetSign": int(target_sign),
        "fromSign": int(left_sign),
        "toSign": int(right_sign),
        "eventSign": int(event_sign),
        "retrograde": bool(retrograde),
        "date": date_txt or "",
    }


def _block_sign_events(options, planet_ids, block_start: float, block_end: float) -> list[dict]:
    """Sign-boundary crossings with ``block_start <= jd < block_end``."""
    if not planet_ids:
        return []
    search_targets = _sign_search_targets()
    try:
        hits = search_longitude_transits_batch(
            [int(pid) for pid in planet_ids],
            float(block_start) - _BLOCK_SEARCH_MARGIN_DAYS,
            float(block_end) + _BLOCK_SEARCH_MARGIN_DAYS,
            [target for target, _sign in search_targets],
            context=_longitude_context(options),
        )
    except Exception:
        return []
    out = []
    for hit in hits:
        event = _sign_event_from_hit(hit, search_targets)
        if event is not None and block_start <= event["jd"] < block_end:
            out.append(event)
    return out


def _elongation(sun_lon: float, moon_lon: float) -> float:
    return (float(moon_lon) - float(sun_lon)) % 360.0


def _syzygy_jd(estimate: float, target: float) -> float:
    """Newton refinement of a Sun-Moon syzygy from a bracketed estimate.

    Elongation error over the Moon-minus-Sun speed converges to the exact
    geocentric conjunction (0) or opposition (180) in a few Swiss Ephemeris
    calls, cheap enough for every base payload and arrow-key step.
    """
    jd = float(estimate)
    for _ in range(8):
        _serr, moon = astrology.swe_calc_ut(jd, astrology.SE_MOON, _FLAGS)
        _serr, sun = astrology.swe_calc_ut(jd, astrology.SE_SUN, _FLAGS)
        error = ((float(moon[0]) - float(sun[0]) - target + 180.0) % 360.0) - 180.0
        rate = float(moon[3]) - float(sun[3])
        if rate <= 0.0:
            break
        step = error / rate
        jd -= step
        if abs(step) < 1e-8:
            break
    return jd


def _lunations(options, series, start_jd, days, memo: Optional[dict] = None,
               eclipses_near=None) -> list[dict]:
    """Exact geocentric new and full moons inside ``[start_jd, start_jd + days]``.

    The daily Sun and Moon samples bracket each syzygy (the Moon gains about
    12 degrees a day on the Sun); _syzygy_jd refines it. The
    marker sits on the Moon's plotted longitude and declination at that moment.
    A lunation that eclipses.find_eclipses_in_range finds an eclipse for (a
    solar eclipse at a New Moon, a lunar one at a Full Moon, within a day)
    carries ``eclipse`` and the engine's localized ``eclipseLabel``.

    The refinement starts from the absolute bracket day, so ``memo`` (keyed by
    bracket JD) hands every overlapping window the same lunation.
    ``eclipses_near(jd)`` returns the engine eclipses around ``jd``; without
    it the whole window is searched once. A series of exactly ``days`` samples
    gets its closing sample (at ``start_jd + days``) fetched; a longer series
    supplies its own, as a month block's edge-extended series does.
    """
    if start_jd is None or days <= 0:
        return []
    sun = series.get(astrology.SE_SUN, {}).get('longitude') or []
    moon = series.get(astrology.SE_MOON, {}).get('longitude') or []
    count = min(len(sun), len(moon))
    if count == 0:
        return []
    samples = [_elongation(sun[index], moon[index]) for index in range(count)]
    end_jd = float(start_jd) + float(days)
    if count == days:
        sun_end = _lon_at_jd(options, astrology.SE_SUN, end_jd)
        moon_end = _lon_at_jd(options, astrology.SE_MOON, end_jd)
        if sun_end is not None and moon_end is not None:
            samples.append(_elongation(sun_end, moon_end))
    if eclipses_near is None:
        try:
            window_eclipses = eclipses.find_eclipses_in_range(None, float(start_jd) - 1.0, end_jd + 1.0)
        except Exception:
            window_eclipses = []

        def eclipses_near(_jd):
            return window_eclipses

    out: list[dict] = []
    for index in range(len(samples) - 1):
        before = samples[index]
        after = samples[index + 1]
        if before > 270.0 and after < 90.0:
            kind, target, gain = "new", 0.0, (after + 360.0) - before
            reached = 360.0 - before
        elif before < 180.0 <= after:
            kind, target, gain = "full", 180.0, after - before
            reached = 180.0 - before
        else:
            continue

        def syzygy(index=index, kind=kind, target=target, gain=gain, reached=reached):
            estimate = float(start_jd) + index + (reached / gain if gain > 0 else 0.5)
            jd = _syzygy_jd(estimate, target)
            longitude = _lon_at_jd(options, astrology.SE_MOON, jd)
            declination = _decl_at_jd(astrology.SE_MOON, jd)
            if longitude is None or declination is None:
                return jd, None
            event = {
                "kind": kind,
                "jd": jd,
                "longitude": longitude % 360.0,
                "declination": declination,
                "date": _format_date_jd(jd) or "",
            }
            solar = kind == "new"
            eclipse = next(
                (candidate for candidate in eclipses_near(jd)
                 if bool(candidate.is_solar) == solar and abs(float(candidate.jdut) - jd) < 1.0),
                None,
            )
            if eclipse is not None:
                event["eclipse"] = "solar" if solar else "lunar"
                event["eclipseLabel"] = eclipses.eclipse_event_label(eclipse)
            return jd, event

        jd, event = _memoized(memo, ('syzygy', kind, float(start_jd) + index), syzygy)
        if event is None or not (float(start_jd) <= jd <= end_jd):
            continue
        placed = {"kind": kind, "jd": jd, "dayOffset": jd - float(start_jd)}
        placed.update((key, value) for key, value in event.items() if key not in placed)
        out.append(placed)
    return out


# Forty years of month blocks: a ten-year camera pins its view, a year
# either side and twice the pan margin ahead (about 25 years), and its marks
# are built from these series after the curves were served.
_BLOCK_CACHE_LIMIT = 480
_MEMO_LIMIT = 20000
_ECLIPSE_CHUNK_DAYS = 366.0
MAX_BLOCK_COUNT = 24
# Daily samples read past each month edge, so a declination turn, equator
# crossing or lunation whose bracket straddles the edge is found by both
# neighbours and kept by the one whose half-open month holds its JD.
_EDGE_SAMPLES = 2
# An out-of-bounds excursion running across a month edge is followed into the
# neighbouring months until it ends (at most this many months each way), so
# its one marker sits at the excursion's true furthest sample.
_OOB_SCAN_MONTHS = 480


def _encode_f64(values) -> str:
    """Base64 of little-endian Float64 values: the blocks wire format."""
    packed = array('d', values)
    if sys.byteorder != 'little':
        packed.byteswap()
    return base64.b64encode(packed.tobytes()).decode('ascii')


def _owned(events, start_jd: float, end_jd: float) -> list[dict]:
    """Events with ``start_jd <= jd < end_jd``, absolute JD only (no dayOffset)."""
    return [
        {key: value for key, value in event.items() if key != 'dayOffset'}
        for event in events
        if float(start_jd) <= float(event['jd']) < float(end_jd)
    ]


def _daily_declinations(options, planet_id: int, start_jd: float, days: int) -> list[float]:
    """One body's daily declinations, sample for sample equal to _daily_samples."""
    context = _longitude_context(options)
    equatorial_flags = (context.flags & ~astrology.SEFLG_SIDEREAL) | astrology.SEFLG_EQUATORIAL
    out = []
    with context.activate():
        for day in range(int(days)):
            _serr, equ = astrology.swe_calc_ut(start_jd + day, int(planet_id), equatorial_flags)
            out.append(float(equ[planets.Planet.DECLEQU]))
    return out


def _sign_declination_ranges(obliquity: float, ayanamsha: float = 0.0) -> list[list[float]]:
    """[lowest, highest] declination of each zodiac sign (0 = Aries) on the
    ecliptic of the given obliquity; ``ayanamsha`` shifts sidereal signs to
    their tropical longitudes. A sign holding a solstice reaches ±obliquity."""
    def declination(tropical_lon: float) -> float:
        return float(astrology.swe_cotrans(tropical_lon % 360.0, 0.0, 1.0, -obliquity)[1])

    ranges = []
    for sign in range(12):
        start = (30.0 * sign + ayanamsha) % 360.0
        values = [declination(start), declination(start + 30.0)]
        for solstice, extreme in ((90.0, obliquity), (270.0, -obliquity)):
            if 0.0 < (solstice - start) % 360.0 < 30.0:
                values.append(extreme)
        ranges.append([min(values), max(values)])
    return ranges


def _month_days(year: int, month: int) -> int:
    return calendar.monthrange(int(year), int(month))[1]


# --- radix layer: natal reference lines and their crossings -------------------
#
# The cosmobiology working sheet (Hamburg School practice, popularised by
# Ebertin): the radix's points as horizontal lines at their folded longitude;
# wherever a transit curve crosses one, the transit is in a hard aspect (a
# multiple of the plate modulus) to that natal factor.
#
# Point-family x role capability (canonical semantic-point universe):
#   natal reference line  supported: every standard body of
#     technique_aspect_endpoints (Sun..Pluto, both nodes, Chiron, apogee),
#     Asc/Dsc/MC/IC, Fortune, Vertex, prenatal Syzygy, prenatal Eclipse, and
#     the personal-point midpoints of NATAL_MIDPOINT_PAIRS.
#     unsupported(Lots): activated Lots are not part of the sheet's factor set;
#     they need their own chooser before they can be offered as lines.
#     unsupported(outer-ring family): the outer ring belongs to a comparison
#     context; the sheet's lines are the radix's own points.
#   transit curve (acting)  supported: every ephemeris curve except the Moon.
#     unsupported(Moon): on the 45° dial it crosses each natal line about
#     twice a month; its contacts are read by eye, not marked.
#   planet contact (both curves acting, planet_contacts)  supported: every
#     pair of ephemeris curves except the Moon's, for the same reason.
# Display defaults (Show group) never remove a point from the payload.

NATAL_MIDPOINT_PAIRS = (
    ('sun', 'moon'),
    ('asc', 'mc'),
    ('sun', 'mc'),
    ('moon', 'mc'),
    ('sun', 'asc'),
    ('moon', 'asc'),
)
def _radix_band_orb(options) -> float:
    """The Orb bands' half-width in degrees: the midpoint orb (ringorb_midpoints)."""
    try:
        orb = float(getattr(options, 'ringorb_midpoints', 1.5))
    except (TypeError, ValueError):
        return 1.5
    return orb if math.isfinite(orb) and orb > 0 else 1.5


NATAL_DEFAULT_KEYS = frozenset({
    'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus',
    'neptune', 'pluto', 'nnode', 'asc', 'mc', 'sun/moon', 'asc/mc',
})
# Crossings are found on the 15° step, the finest step any plate modulus
# (360/90/45/30) needs, and kept when the aspect is a multiple of 45° or 30°;
# the view keeps those that are multiples of its own modulus.
NATAL_CROSSING_STEP = 15.0
_NATAL_TRANSIT_EXCLUDED = frozenset({astrology.SE_MOON})


def _near_midpoint(a: float, b: float) -> float:
    """Shorter-arc midpoint, midpoints.MidPoints.countMidPoints's rule."""
    delta = ((float(b) - float(a) + 180.0) % 360.0) - 180.0
    return util.normalize(float(a) + delta / 2.0)


def _folded_offset(value: float, ref: float, step: float = NATAL_CROSSING_STEP) -> float:
    """(value - ref) folded into [-step/2, step/2)."""
    return ((float(value) - float(ref) + step / 2.0) % step) - step / 2.0


def _crossing_aspect(lon: float, ref: float) -> Optional[int]:
    aspect = int(round(((float(lon) - float(ref)) % 360.0) / NATAL_CROSSING_STEP) * NATAL_CROSSING_STEP) % 360
    return aspect if aspect % 45 == 0 or aspect % 30 == 0 else None


def _cubic_at(samples, i: int, t: float) -> float:
    """Unwrapped cubic (Lagrange) interpolation of daily samples around
    [i, i+1] at fraction ``t``; two-point linear at the series edges."""
    n = len(samples)
    if i < 1 or i + 2 >= n:
        a = samples[i]
        b = a + ((samples[i + 1] - a + 180.0) % 360.0 - 180.0)
        return a + (b - a) * t
    base = samples[i]
    p = [base + ((samples[i + k] - base + 180.0) % 360.0 - 180.0) for k in (-1, 0, 1, 2)]
    x = t
    return (
        p[0] * (-x * (x - 1) * (x - 2) / 6.0)
        + p[1] * ((x + 1) * (x - 1) * (x - 2) / 2.0)
        + p[2] * (-(x + 1) * x * (x - 2) / 2.0)
        + p[3] * ((x + 1) * x * (x - 1) / 6.0)
    )


def _crossing_rows(series, ref: float, start_jd: float, days: int) -> list[tuple[float, int, int, float]]:
    """(jd, aspect, day, fraction) where a daily longitude series crosses ``ref`` on the
    15° step inside [start_jd, start_jd + days): sign change of the folded
    offset between whole days, refined on the cubic through the engine's
    daily samples (bisection, about a second of time)."""
    rows = []
    offsets = [_folded_offset(v, ref) for v in series]
    half = NATAL_CROSSING_STEP / 2.0
    for d in range(min(days, len(series) - 1)):
        a, b = offsets[d], offsets[d + 1]
        if (a < 0.0) == (b < 0.0) or abs(a - b) >= half:
            continue
        lo, hi = 0.0, 1.0
        f_lo = a
        for _ in range(30):
            mid = (lo + hi) / 2.0
            f_mid = _folded_offset(_cubic_at(series, d, mid), ref)
            if abs(f_mid - f_lo) >= half:
                f_mid = f_lo  # unwrap guard; never expected inside one day
            if (f_lo < 0.0) == (f_mid < 0.0):
                lo, f_lo = mid, f_mid
            else:
                hi = mid
        t = (lo + hi) / 2.0
        aspect = _crossing_aspect(_cubic_at(series, d, t), ref)
        if aspect is not None:
            rows.append((float(start_jd) + d + t, aspect, d, t))
    return rows


class EphemerisService:
    """Month-block builder, its caches, and the per-radix view-state store.

    The view is a continuous camera over client-held calendar-month blocks:
    ``blocks`` serves the daily series plus every event owned by each month
    (sign ingresses, declination turns and equator crossings, lunations with
    eclipse flags, out-of-bounds peaks), ``stations`` the slower longitude
    SR/SD layer per calendar year, and ``meta`` the time-free presentation.
    """

    def __init__(self) -> None:
        self._series_block_cache: dict[tuple, dict] = {}
        self._series_inflight: dict[tuple, threading.Event] = {}
        self._sign_block_cache: dict[tuple, list[dict]] = {}
        self._event_block_cache: dict[tuple, tuple] = {}
        self._station_year_cache: dict[tuple, list[dict]] = {}
        self._oob_limit_cache: dict[tuple, float] = {}
        self._decl_scale_cache: dict[tuple, dict] = {}
        self._oob_decl_cache: dict[tuple, list[float]] = {}
        self._oob_runs: dict[tuple, list[tuple]] = {}
        self._memos: dict[tuple, dict] = {}
        self._eclipse_chunks: dict[int, list] = {}
        self._natal_point_cache: dict[tuple, dict] = {}
        self._natal_crossing_cache: dict[tuple, dict] = {}
        self._planet_contact_cache: dict[tuple, dict] = {}
        self._cache_lock = threading.RLock()
        # morin._radix_view_state[('ephemeris', key)] twin (morin.py:5396-5426).
        self._view_state: dict[tuple, dict] = {}

    def _data_options_key(self) -> tuple:
        """Options that change the calculated daily series."""
        options = chart_snapshot_service.options
        return (
            int(getattr(options, 'ayanamsha', 0)),
            tuple(bool(v) for v in getattr(options, 'transcendental', ())),
            bool(getattr(options, 'showchiron', True)),
            bool(getattr(options, 'showapogee', True)),
            bool(getattr(options, 'meanapogee', True)),
        )

    @staticmethod
    def _language_key(options) -> int:
        return int(getattr(options, 'langid', 0) or 0)

    def _payload_options_key(self) -> tuple:
        """Exact option identity for everything drawable.

        Keep this separate from ``_data_options_key``: language, glyph variants,
        and colours must invalidate labels/paint data without forcing the daily
        Swiss Ephemeris series to be recalculated.
        """
        options = chart_snapshot_service.options
        bw = bool(getattr(options, 'bw', False))
        color_key = () if bw else (
            _rgb_key(getattr(options, 'clrbackground', None)),
            _rgb_key(getattr(options, 'clrframe', None)),
            _rgb_key(getattr(options, 'clrtexts', None)),
            _rgb_key(getattr(options, 'clrsigns', None)),
            _rgb_key(getattr(options, 'clrhouses', None)),
            _rgb_list_key(getattr(options, 'clrindividual', None)),
            # Hover flag glyph colours (_hover_glyph_colors).
            _rgb_list_key(getattr(options, 'clraspect', None)),
            _rgb_key(getattr(options, 'clrsignelementfire', None)),
            _rgb_key(getattr(options, 'clrsignelementearth', None)),
            _rgb_key(getattr(options, 'clrsignelementair', None)),
            _rgb_key(getattr(options, 'clrsignelementwater', None)),
            _rgb_key(getattr(options, 'clrdomicil', None)),
            _rgb_key(getattr(options, 'clrexal', None)),
            _rgb_key(getattr(options, 'clrexil', None)),
            _rgb_key(getattr(options, 'clrcasus', None)),
            _rgb_key(getattr(options, 'clrperegrin', None)),
            bool(getattr(options, 'usezodiacelementcolors', False)),
        )
        return (
            *self._data_options_key(),
            bool(getattr(options, 'signs', True)),
            bool(getattr(options, 'uranus', True)),
            int(getattr(options, 'pluto', 0) or 0),
            self._language_key(options),
            bw,
            *color_key,
            bool(getattr(options, 'useplanetcolors', False)),
            _dignity_table_key(options),
            # Radix Orb bands: the midpoint orb.
            _radix_band_orb(options),
        )

    def payload_revision_key(self) -> str:
        """Deterministic identity for every drawable dependency (meta's styleRevision)."""
        encoded = json.dumps(
            self._payload_options_key(),
            ensure_ascii=True,
            separators=(',', ':'),
        ).encode('utf-8')
        return 'ephemeris-v2:' + hashlib.sha256(encoded).hexdigest()

    def data_key(self) -> str:
        """Identity of every numeric and event value in blocks and stations:
        the series options plus the language of event dates and labels."""
        options = chart_snapshot_service.options
        encoded = json.dumps(
            [*self._data_options_key(), self._language_key(options)],
            ensure_ascii=True,
            separators=(',', ':'),
        ).encode('utf-8')
        return 'ephemeris-data-v1:' + hashlib.sha256(encoded).hexdigest()

    # --- caches ------------------------------------------------------------

    def _recall(self, cache: dict, key):
        with self._cache_lock:
            value = cache.pop(key, None)
            if value is not None:
                cache[key] = value
            return value

    def _remember(self, cache: dict, key, value, limit: int):
        with self._cache_lock:
            cache[key] = value
            while len(cache) > limit:
                cache.pop(next(iter(cache)))
        return value

    def _block_key(self, year: int, month: int) -> tuple:
        return (*self._data_options_key(), int(year), int(month))

    def _block_marker_key(self, year: int, month: int, planet_ids) -> tuple:
        options = chart_snapshot_service.options
        return (
            *self._block_key(year, month),
            self._language_key(options),
            tuple(int(pid) for pid in planet_ids),
        )

    def _refinement_memo(self) -> dict:
        """JD-keyed refinements shared by both neighbours of a month edge."""
        options = chart_snapshot_service.options
        key = (*self._data_options_key(), self._language_key(options))
        memo = self._recall(self._memos, key)
        if memo is None or len(memo) > _MEMO_LIMIT:
            memo = {}
        return self._remember(self._memos, key, memo, 4)

    def _eclipses_near(self, jd: float) -> list:
        """Engine eclipses of the fixed 366-day chunk holding ``jd`` (plus a
        day either side, so any eclipse within a day of ``jd`` is included)."""
        chunk = math.floor(float(jd) / _ECLIPSE_CHUNK_DAYS)
        events = self._recall(self._eclipse_chunks, chunk)
        if events is None:
            start = chunk * _ECLIPSE_CHUNK_DAYS
            try:
                events = eclipses.find_eclipses_in_range(
                    None, start - 1.0, start + _ECLIPSE_CHUNK_DAYS + 1.0)
            except Exception:
                events = []
            self._remember(self._eclipse_chunks, chunk, events, 24)
        return events

    # --- month blocks --------------------------------------------------------

    def _series_block(self, year: int, month: int, options) -> dict:
        """One month's daily series, computed once even when concurrent
        requests (a year's blocks and its stations) need it at the same time:
        later callers wait for the first one's result instead of repeating it."""
        key = self._block_key(year, month)
        while True:
            block = self._recall(self._series_block_cache, key)
            if block is not None:
                return block
            with self._cache_lock:
                pending = self._series_inflight.get(key)
                owner = pending is None
                if owner:
                    pending = self._series_inflight[key] = threading.Event()
            if not owner:
                pending.wait()
                continue
            try:
                block = _daily_samples(options, _month_jd(year, month), _month_days(year, month))
                return self._remember(self._series_block_cache, key, block, _BLOCK_CACHE_LIMIT)
            finally:
                with self._cache_lock:
                    self._series_inflight.pop(key, None)
                pending.set()

    def _sign_block(self, year: int, month: int, planet_ids, options) -> list[dict]:
        key = self._block_marker_key(year, month, planet_ids)
        block = self._recall(self._sign_block_cache, key)
        if block is None:
            block = self._remember(
                self._sign_block_cache, key,
                _block_sign_events(options, planet_ids, _month_jd(year, month),
                                   _month_jd(*util.incrMonth(year, month))),
                _BLOCK_CACHE_LIMIT)
        return block

    def _edge_samples(self, year: int, month: int, options, side: int) -> dict:
        """The _EDGE_SAMPLES daily samples just before (side < 0) or just
        after (side > 0) one month: from the cached neighbour block if any."""
        if side < 0:
            y, m = util.decrMonth(int(year), int(month))
            neighbour = self._recall(self._series_block_cache, self._block_key(y, m))
            if neighbour is not None:
                return {pid: {field: values[field][-_EDGE_SAMPLES:] for field in values}
                        for pid, values in neighbour.items()}
            return _daily_samples(options, _month_jd(year, month) - _EDGE_SAMPLES, _EDGE_SAMPLES)
        y, m = util.incrMonth(int(year), int(month))
        neighbour = self._recall(self._series_block_cache, self._block_key(y, m))
        if neighbour is not None:
            return {pid: {field: values[field][:_EDGE_SAMPLES] for field in values}
                    for pid, values in neighbour.items()}
        return _daily_samples(options, _month_jd(y, m), _EDGE_SAMPLES)

    # Out of bounds. The window plot took its limit as the Sun's largest
    # sampled |declination| inside the window and gave every continuous
    # excursion one marker at its furthest sample, clipping excursions at the
    # window edges. Blocks keep the January-anchored annual plate's semantics
    # everywhere: the limit of a sample is the Sun's largest sampled
    # |declination| in that sample's calendar year, and an excursion is followed
    # across month (and year) edges, so its one marker is owned by the month
    # holding its true furthest sample (first such sample on a tie).

    def _oob_limit(self, year: int, options) -> float:
        key = (*self._data_options_key(), int(year))
        limit = self._recall(self._oob_limit_cache, key)
        if limit is None:
            start = _month_jd(year, 1)
            days = int(round(_month_jd(int(year) + 1, 1) - start))
            values = _daily_declinations(options, astrology.SE_SUN, start, days)
            limit = max((abs(value) for value in values), default=0.0)
            self._remember(self._oob_limit_cache, key, limit, 128)
        return limit

    def _declination_scale(self, year: int, options) -> dict:
        """The declination scale of one calendar year: the out-of-bounds
        limit (the Sun's largest sampled |declination|, as the markers use)
        and each sign's declination range at that obliquity, in the active
        zodiac (sidereal signs are shifted by the effective ayanamsha at
        mid-year)."""
        key = (*self._data_options_key(), int(year))
        scale = self._recall(self._decl_scale_cache, key)
        if scale is None:
            limit = self._oob_limit(year, options)
            ayanamsha = 0.0
            if int(getattr(options, 'ayanamsha', 0) or 0) != 0:
                mid = (_month_jd(year, 1) + _month_jd(int(year) + 1, 1)) / 2
                ayanamsha = astrology.effective_ayanamsha_ut(mid, options.ayanamsha)
            scale = {"limit": float(limit), "signRanges": _sign_declination_ranges(limit, ayanamsha)}
            self._remember(self._decl_scale_cache, key, scale, 128)
        return scale

    def _month_declinations(self, planet_id: int, year: int, month: int, options) -> list[float]:
        block = self._recall(self._series_block_cache, self._block_key(year, month))
        if block is not None and planet_id in block:
            return block[planet_id]['declination']
        key = (*self._data_options_key(), int(planet_id), int(year), int(month))
        values = self._recall(self._oob_decl_cache, key)
        if values is None:
            values = self._remember(
                self._oob_decl_cache, key,
                _daily_declinations(options, planet_id, _month_jd(year, month), _month_days(year, month)),
                _BLOCK_CACHE_LIMIT * 2)
        return values

    def _oob_walk(self, planet_id: int, year: int, month: int, index: int, options, step: int):
        """(jd, declination, out of bounds) per daily sample from sample
        ``index`` of (year, month), forward (step 1) or backward (step -1)."""
        y, m, i = int(year), int(month), index
        for _ in range(_OOB_SCAN_MONTHS + 1):
            start = _month_jd(y, m)
            decl = self._month_declinations(planet_id, y, m, options)
            limit = self._oob_limit(y, options)
            if i is None:
                i = 0 if step > 0 else len(decl) - 1
            while 0 <= i < len(decl):
                value = decl[i]
                yield start + i, value, planetary_state.is_out_of_bounds(planet_id, value, limit)
                i += step
            y, m = util.incrMonth(y, m) if step > 0 else util.decrMonth(y, m)
            i = None

    def _oob_run(self, planet_id: int, year: int, month: int, index: int, options) -> tuple:
        """(first jd, last jd, peak jd, peak declination) of the whole
        excursion through out-of-bounds sample ``index`` of (year, month)."""
        jd = _month_jd(year, month) + index
        runs_key = (*self._data_options_key(), int(planet_id))
        with self._cache_lock:
            runs = self._oob_runs.setdefault(runs_key, [])
            for run in runs:
                if run[0] <= jd <= run[1]:
                    return run
        samples = []
        for sample_jd, value, out in self._oob_walk(planet_id, year, month, index, options, -1):
            if not out:
                break
            samples.append((sample_jd, value))
        samples.reverse()
        for sample_jd, value, out in self._oob_walk(planet_id, year, month, index + 1, options, 1):
            if not out:
                break
            samples.append((sample_jd, value))
        peak_jd, peak_value = max(samples, key=lambda sample: abs(sample[1]))
        run = (samples[0][0], samples[-1][0], peak_jd, peak_value)
        with self._cache_lock:
            if len(runs) > 4000:
                runs.clear()
            runs.append(run)
        return run

    def _block_out_of_bounds(self, year: int, month: int, block: dict, planet_ids, options) -> list[dict]:
        start = _month_jd(year, month)
        limit = self._oob_limit(year, options)
        out = []
        for pid in planet_ids:
            if pid == astrology.SE_SUN:
                continue
            decl = block[pid]['declination']
            last = len(decl) - 1
            i = 0
            while i <= last:
                if not planetary_state.is_out_of_bounds(pid, decl[i], limit):
                    i += 1
                    continue
                j = i
                while j < last and planetary_state.is_out_of_bounds(pid, decl[j + 1], limit):
                    j += 1
                if i == 0 or j == last:
                    _first, _last, peak_jd, value = self._oob_run(pid, year, month, i, options)
                else:
                    k = max(range(i, j + 1), key=lambda index: abs(decl[index]))
                    peak_jd, value = start + k, decl[k]
                if start <= peak_jd <= start + last:
                    out.append({"planet": int(pid), "jd": float(peak_jd), "value": float(value)})
                i = j + 1
        return out

    def _event_block(self, year: int, month: int, options) -> tuple[list[int], dict]:
        """(planet ids, wire block) for one calendar month."""
        key = (*self._block_key(year, month), self._language_key(options))
        cached = self._recall(self._event_block_cache, key)
        if cached is not None:
            return cached
        start = _month_jd(year, month)
        days = _month_days(year, month)
        end = start + days
        block = self._series_block(year, month, options)
        planet_ids = [pid for pid in PLANET_ORDER if pid in block]
        before = self._edge_samples(year, month, options, -1)
        after = self._edge_samples(year, month, options, 1)
        extended = {
            pid: {
                field: [*before[pid][field], *block[pid][field], *after[pid][field]]
                for field in ('longitude', 'declination')
            }
            for pid in planet_ids
        }
        memo = self._refinement_memo()
        # Samples start-2 .. end+1: turns at days start-1 .. end, crossings of
        # pairs from start-2: every root that can land inside the month.
        declination = _declination_stations(extended, planet_ids, start - _EDGE_SAMPLES, memo=memo)
        # Elongation samples start-1 .. end+1 (one more than ``days``, so the
        # closing sample comes from the series): brackets start-1 .. end.
        lunation_series = {
            pid: {'longitude': extended[pid]['longitude'][_EDGE_SAMPLES - 1:]}
            for pid in (astrology.SE_SUN, astrology.SE_MOON) if pid in extended
        }
        lunations = _lunations(
            options, lunation_series, start - 1, days + _EDGE_SAMPLES,
            memo=memo, eclipses_near=self._eclipses_near)
        wire = {
            "year": int(year),
            "month": int(month),
            "startJd": float(start),
            "days": int(days),
            "longitude": _encode_f64(itertools.chain.from_iterable(block[pid]['longitude'] for pid in planet_ids)),
            "declination": _encode_f64(itertools.chain.from_iterable(block[pid]['declination'] for pid in planet_ids)),
            "signEvents": list(self._sign_block(year, month, planet_ids, options)),
            "declinationStations": _owned(declination, start, end),
            "lunations": _owned(lunations, start, end),
            "outOfBounds": self._block_out_of_bounds(year, month, block, planet_ids, options),
            "declinationScale": self._declination_scale(year, options),
        }
        return self._remember(self._event_block_cache, key, ([int(pid) for pid in planet_ids], wire),
                              _BLOCK_CACHE_LIMIT)

    # --- endpoints -------------------------------------------------------------

    def meta(self) -> dict:
        """Time-free presentation for the camera view (GET /api/ephemeris/meta)."""
        options = chart_snapshot_service.options
        bw = bool(getattr(options, 'bw', False))
        enabled = set(int(pid) for pid in ephemcalc.EphemCalc.get_planet_ids(options))
        planets_payload = []
        for pid in PLANET_ORDER:
            if pid not in enabled:
                continue
            key_name = PLANET_LABEL_KEYS.get(pid)
            planets_payload.append({
                "id": int(pid),
                "glyph": common.common.get_planet_glyph(pid),
                "label": mtexts.txts.get(key_name, key_name or str(pid)),
                "color": _planet_colour_hex(options, pid, bw),
                "defaultVisible": {
                    "longitude": _default_planet_visibility('longitude', pid),
                    "declination": _default_planet_visibility('declination', pid),
                },
            })
        signs = common.common.Signs1 if getattr(options, 'signs', True) else common.common.Signs2
        dignity_by_sign = {str(planet["id"]): _dignity_by_sign(options, planet["id"]) for planet in planets_payload}
        return {
            "dataKey": self.data_key(),
            "styleRevision": self.payload_revision_key(),
            "planets": planets_payload,
            "signGlyphs": list(signs),
            "signNames": [mtexts.txts.get(k, k) for k in SIGN_NAME_KEYS],
            "monthLabels": list(common.common.monthabbr[:12]),
            "colors": _ephemeris_colors(options, bw),
            "dignityBySign": dignity_by_sign,
            "usePlanetColors": bool(getattr(options, 'useplanetcolors', False)),
            "hoverGlyphColors": _hover_glyph_colors(options, [planet["id"] for planet in planets_payload], bw),
            "zodiacLabel": _zodiac_label(options),
        }

    def series(self, year: int, month: int = 1, count: int = 1) -> dict:
        """The curves alone: ``count`` consecutive calendar months of daily
        series from (year, month) (GET /api/ephemeris/series), about a
        quarter of a full block's cost. The camera steps on these; each
        month's marks follow from ``blocks(..., series=False)``. Wire: the
        block fields ``year month startJd days longitude declination``."""
        year = int(year)
        month = min(12, max(1, int(month)))
        count = min(MAX_BLOCK_COUNT, max(1, int(count)))
        options = chart_snapshot_service.options
        out = []
        planet_ids: list[int] = []
        for y, m in _window_months(year, month, count):
            block = self._series_block(y, m, options)
            planet_ids = [pid for pid in PLANET_ORDER if pid in block]
            out.append({
                "year": int(y),
                "month": int(m),
                "startJd": float(_month_jd(y, m)),
                "days": int(_month_days(y, m)),
                "longitude": _encode_f64(itertools.chain.from_iterable(block[pid]['longitude'] for pid in planet_ids)),
                "declination": _encode_f64(itertools.chain.from_iterable(block[pid]['declination'] for pid in planet_ids)),
            })
        return {"dataKey": self.data_key(), "planetIds": [int(pid) for pid in planet_ids], "blocks": out}

    def blocks(self, year: int, month: int = 1, count: int = 1, series: bool = True) -> dict:
        """``count`` consecutive calendar months from (year, month)
        (GET /api/ephemeris/blocks). Every event sits in exactly one block:
        the one whose [startJd, startJd + days) holds its absolute jd.
        ``series=False`` serves the marks alone (no ``longitude`` /
        ``declination``) for a client that already holds the curves."""
        year = int(year)
        month = min(12, max(1, int(month)))
        count = min(MAX_BLOCK_COUNT, max(1, int(count)))
        options = chart_snapshot_service.options
        months = _window_months(year, month, count)
        # Series first, so the inner month edges read their neighbours' samples.
        for y, m in months:
            self._series_block(y, m, options)
        built = [self._event_block(y, m, options) for y, m in months]
        wires = [wire for _planet_ids, wire in built]
        if not series:
            wires = [{k: v for k, v in wire.items() if k not in ("longitude", "declination")} for wire in wires]
        return {
            "dataKey": self.data_key(),
            "planetIds": list(built[0][0]),
            "blocks": wires,
        }

    def stations(self, year: int) -> dict:
        """Longitude SR/SD stations of one calendar year (GET
        /api/ephemeris/stations): the January-anchored annual search, kept
        whole because transit_fast's station root depends on its bracket
        (ephemeris-speed.md). Owned half-open like the blocks."""
        year = int(year)
        options = chart_snapshot_service.options
        key = (*self._data_options_key(), self._language_key(options), year)
        stations = self._recall(self._station_year_cache, key)
        if stations is None:
            months = [self._series_block(year, m, options) for m in range(1, 13)]
            planet_ids = [pid for pid in PLANET_ORDER if pid in months[0]]
            series = {
                pid: {'longitude': list(itertools.chain.from_iterable(block[pid]['longitude'] for block in months))}
                for pid in planet_ids
            }
            start_jd = _start_jd(year, 1)
            days = _month_offsets(year, 1)[-1]
            stations = []
            if start_jd is not None:
                stations = _owned(
                    _longitude_stations(options, series, planet_ids, start_jd, days),
                    start_jd, start_jd + days)
            stations = self._remember(self._station_year_cache, key, stations, 64)
        return {"dataKey": self.data_key(), "year": year, "longitude": stations}

    # --- radix layer --------------------------------------------------------

    def _natal_cache_key(self, radix) -> Optional[tuple]:
        key = self._radix_key(radix)
        if key is None:
            return None
        options = chart_snapshot_service.options
        # id(radix): a recalculated radix (node type, apogee, zodiac) is a new
        # object under the same birth data.
        # The payload key: the marks carry the lists' colours.
        return (*self._payload_options_key(), key, id(radix))

    def natal_points(self, radix) -> dict:
        """The radix's reference lines (GET .../ephemeris-natal): every point
        of the engine's technique endpoint registry plus the personal-point
        midpoints, with glyphs, names and the Show-group default. Longitudes
        are the radix's own (its zodiac is the options' zodiac, like the
        curves). ``radixKey`` identifies the point set for the crossing layer."""
        cache_key = self._natal_cache_key(radix)
        if cache_key is None:
            return {"radixKey": "", "points": []}
        cached = self._recall(self._natal_point_cache, cache_key)
        if cached is not None:
            return cached
        from webapp.daemon import aspect_list_service
        from webapp.frontend.scripts import export_chart_json

        options = chart_snapshot_service.options
        points: list[dict] = []
        by_key: dict[str, dict] = {}
        # A body's SE id, for the Inspector region a clicked line pins: the
        # registry's body the key names in this radix (mean or true apogee).
        se_by_key: dict[str, int] = {}
        for body_id in export_chart_json._TECHNIQUE_STANDARD_BODY_IDS:
            body_key = export_chart_json.planet_id_from_se_id(body_id)
            if body_key and body_key not in se_by_key and export_chart_json._technique_body(radix, body_id) is not None:
                se_by_key[body_key] = int(body_id)
        for endpoint in export_chart_json.technique_aspect_endpoints(radix, radix.options):
            key = 'dsc' if str(endpoint['key']) == 'dc' else str(endpoint['key'])
            try:
                metadata = aspect_list_service._endpoint_metadata(radix, key, 'primary', options)
            except ValueError:
                continue
            # The list's own mark: a Morinus glyph for bodies and points, the
            # written name for the angles (Asc, Dsc, MC, IC), never the
            # Morinus angle slots.
            glyph = str(metadata.get('glyph') or '')
            font = 'morinus' if glyph and metadata.get('glyphFont') == 'morinus' else 'text'
            if not glyph:
                glyph = str(metadata.get('name') or key)
            point = {
                "key": key,
                "kind": str(endpoint['kind']),
                "lon": util.normalize(float(endpoint['lon'])),
                "glyphs": [glyph],
                "glyphFonts": [font],
                # The list's own colour for the hover flag's mark.
                "glyphColors": [str(metadata.get('color') or '')],
                "glyphColorRoles": [metadata.get('colorRole')],
                "label": str(metadata.get('name') or key),
                "defaultVisible": key in NATAL_DEFAULT_KEYS,
            }
            if endpoint['kind'] == 'planet' and key in se_by_key:
                point["seId"] = se_by_key[key]
            points.append(point)
            by_key[key] = point
        for first, second in NATAL_MIDPOINT_PAIRS:
            a, b = by_key.get(first), by_key.get(second)
            if a is None or b is None:
                continue
            key = f"{first}/{second}"
            points.append({
                "key": key,
                "kind": "midpoint",
                "lon": _near_midpoint(a['lon'], b['lon']),
                "glyphs": [a['glyphs'][0], b['glyphs'][0]],
                "glyphFonts": [a['glyphFonts'][0], b['glyphFonts'][0]],
                "glyphColors": [a['glyphColors'][0], b['glyphColors'][0]],
                "glyphColorRoles": [a['glyphColorRoles'][0], b['glyphColorRoles'][0]],
                "label": f"{a['label']}/{b['label']}",
                "pair": [first, second],
                "defaultVisible": key in NATAL_DEFAULT_KEYS,
            })
        identity = json.dumps([[p['key'], round(p['lon'], 9)] for p in points], separators=(',', ':'))
        payload = {
            "radixKey": 'radix-v1:' + hashlib.sha256(identity.encode('utf-8')).hexdigest()[:24],
            "points": points,
            # Orb bands: one orb for every hard contact on the dial, the
            # options' midpoint orb (Hamburg School practice).
            "orb": _radix_band_orb(options),
        }
        return self._remember(self._natal_point_cache, cache_key, payload, 16)

    def _transit_year_series(self, year: int):
        """(start_jd, days, {planet: daily longitudes}) for one calendar year
        of every transit curve that makes contacts (all but the Moon), with
        three days of the next year for the cubic at the edge."""
        options = chart_snapshot_service.options
        start_jd = _start_jd(year, 1)
        if start_jd is None:
            return None
        months = [self._series_block(year, m, options) for m in range(1, 13)]
        following = self._series_block(year + 1, 1, options)
        by_planet: dict[int, list[float]] = {}
        for pid in PLANET_ORDER:
            if pid in _NATAL_TRANSIT_EXCLUDED or pid not in months[0]:
                continue
            series = list(itertools.chain.from_iterable(block[pid]['longitude'] for block in months))
            series.extend(following.get(pid, {}).get('longitude', ())[:3])
            by_planet[int(pid)] = series
        return start_jd, _month_offsets(year, 1)[-1], by_planet

    def planet_contacts(self, year: int) -> dict:
        """Planet-to-planet contacts of one calendar year (GET
        /api/ephemeris/contacts?year): every crossing of two transit curves
        whose angle is a multiple of 45° or 30°, the Moon excluded, at
        absolute JD and owned half-open by the year. Found on the 15° step of
        the daily longitude difference and refined on its cubic. Compact
        wire: ``jd`` and ``lon`` (the first planet's longitude there) base64
        Float64, parallel ``a``/``b`` (SE ids, PLANET_ORDER) and ``aspect``
        (degrees, a minus b)."""
        year = int(year)
        options = chart_snapshot_service.options
        key = (*self._data_options_key(), self._language_key(options), year)
        cached = self._recall(self._planet_contact_cache, key)
        if cached is not None:
            return cached
        rows: list[tuple[float, int, int, int, float]] = []
        year_series = self._transit_year_series(year)
        if year_series is not None:
            start_jd, days, by_planet = year_series
            ids = list(by_planet)
            for i, a in enumerate(ids):
                for b in ids[i + 1:]:
                    sa, sb = by_planet[a], by_planet[b]
                    diff = [(x - y) % 360.0 for x, y in zip(sa, sb)]
                    for jd, aspect, day, fraction in _crossing_rows(diff, 0.0, start_jd, days):
                        rows.append((jd, a, b, aspect, util.normalize(_cubic_at(sa, day, fraction))))
        rows.sort()
        payload = {
            "dataKey": self.data_key(),
            "year": year,
            "jd": _encode_f64([r[0] for r in rows]),
            "lon": _encode_f64([r[4] for r in rows]),
            "a": [r[1] for r in rows],
            "b": [r[2] for r in rows],
            "aspect": [r[3] for r in rows],
        }
        return self._remember(self._planet_contact_cache, key, payload, 48)

    def natal_crossings(self, radix, year: int) -> dict:
        """Every crossing of a transit curve with a radix line in one calendar
        year (GET .../ephemeris-natal-crossings?year): aspects that are
        multiples of 45° or 30°, at absolute JD, owned half-open by the year
        like the stations. Compact wire: ``jd`` base64 Float64, and parallel
        ``planet`` (SE id), ``point`` (index into ``points``), ``aspect`` (°)."""
        year = int(year)
        natal = self.natal_points(radix)
        cache_key = self._natal_cache_key(radix)
        empty = {"dataKey": self.data_key(), "radixKey": natal["radixKey"], "year": year,
                 "points": [], "jd": _encode_f64([]), "planet": [], "point": [], "aspect": []}
        if cache_key is None or not natal["points"]:
            return empty
        key = (*cache_key, year)
        cached = self._recall(self._natal_crossing_cache, key)
        if cached is not None:
            return cached
        year_series = self._transit_year_series(year)
        if year_series is None:
            return empty
        start_jd, days, by_planet = year_series
        rows: list[tuple[float, int, int, int]] = []
        for pid, series in by_planet.items():
            for index, point in enumerate(natal["points"]):
                for jd, aspect, _day, _fraction in _crossing_rows(series, point['lon'], start_jd, days):
                    rows.append((jd, int(pid), index, aspect))
        rows.sort()
        payload = {
            "dataKey": self.data_key(),
            "radixKey": natal["radixKey"],
            "year": year,
            "points": [p['key'] for p in natal["points"]],
            "jd": _encode_f64([r[0] for r in rows]),
            "planet": [r[1] for r in rows],
            "point": [r[2] for r in rows],
            "aspect": [r[3] for r in rows],
        }
        return self._remember(self._natal_crossing_cache, key, payload, 48)

    # --- per-radix view state (morin.py:5364-5426 twin) ---------------------

    @staticmethod
    def _radix_key(radix) -> Optional[tuple]:
        """morin._radix_view_state_key (morin.py:5364-5394)."""
        if radix is None:
            return None
        t = getattr(radix, 'time', None)
        p = getattr(radix, 'place', None)
        if t is None or p is None:
            return None
        return (
            getattr(radix, 'name', '') or '',
            bool(getattr(radix, 'male', False)),
            int(getattr(t, 'origyear', getattr(t, 'year', 0))),
            int(getattr(t, 'origmonth', getattr(t, 'month', 0))),
            int(getattr(t, 'origday', getattr(t, 'day', 0))),
            int(getattr(t, 'hour', 0)),
            int(getattr(t, 'minute', 0)),
            int(getattr(t, 'second', 0)),
            bool(getattr(t, 'bc', False)),
            int(getattr(t, 'cal', 0)),
            getattr(p, 'place', '') or '',
            int(getattr(p, 'deglon', 0)),
            int(getattr(p, 'minlon', 0)),
            int(getattr(p, 'seclon', 0)),
            bool(getattr(p, 'east', True)),
            int(getattr(p, 'deglat', 0)),
            int(getattr(p, 'minlat', 0)),
            int(getattr(p, 'seclat', 0)),
            bool(getattr(p, 'north', True)),
            int(getattr(p, 'altitude', 0)),
        )

    # Per radix: where the plate looks and which natal lines it draws. Every
    # other view field (modulus, colours, layers, planets, mode, mirrored) is
    # one preference shared by all charts, saved in settings.json.
    RADIX_VIEW_FIELDS = ('camera', 'radix_points')

    @staticmethod
    def _global_view() -> dict:
        prefs = getattr(chart_snapshot_service.options, 'graphic_ephemeris_view', None)
        return dict(prefs) if isinstance(prefs, Mapping) else {}

    def _store_global_view(self, prefs: dict) -> None:
        options = chart_snapshot_service.options
        if not hasattr(options, 'graphic_ephemeris_view') or prefs == self._global_view():
            return
        options.graphic_ephemeris_view = prefs
        save = getattr(options, 'saveGraphicEphemerisView', None)
        if callable(save):
            save()

    def state_for_radix(self, radix) -> dict:
        key = self._radix_key(radix)
        if key is None:
            return {}
        local = self._view_state.get(key, {})
        # Global preferences win; a radix's own older view fields only fill
        # what has never been set globally.
        merged = {
            **{k: v for k, v in local.items() if k not in self.RADIX_VIEW_FIELDS},
            **self._global_view(),
            **{k: local[k] for k in self.RADIX_VIEW_FIELDS if k in local},
        }
        state = self._normalize_view_state(merged)
        # Heal the radix cache to its own canonical fields (old window keys
        # migrate to a camera; view fields now live globally).
        own = {k: state[k] for k in self.RADIX_VIEW_FIELDS if k in state}
        if own:
            self._view_state[key] = own
        else:
            self._view_state.pop(key, None)
        return state

    def store_state_for_radix(self, radix, state: Optional[dict[str, Any]]) -> None:
        key = self._radix_key(radix)
        if key is None:
            return
        normalized = self._normalize_view_state(state)
        local = {k: normalized[k] for k in self.RADIX_VIEW_FIELDS if k in normalized}
        if local:
            self._view_state[key] = local
        else:
            self._view_state.pop(key, None)
        prefs = {k: v for k, v in normalized.items() if k not in self.RADIX_VIEW_FIELDS}
        if state is not None:
            self._store_global_view(prefs)

    def center_state_for_radix(self, radix, jd: float, span_days: Optional[float] = None) -> dict:
        """Centre the radix's stored camera on ``jd``.

        Every open shows the launching chart's cursor in the middle of the
        plate at the standard three months (``span_days``); Spotlight
        "current" passes none and keeps the zoom on screen."""
        state = self.state_for_radix(radix)
        camera = state.get('camera') or {}
        span = float(span_days or camera.get('spanDays') or DEFAULT_CAMERA_SPAN_DAYS)
        span = min(MAX_SPAN_DAYS, max(MIN_SPAN_DAYS, span))
        self.store_state_for_radix(radix, {**state, 'camera': {'startJd': float(jd) - span / 2, 'spanDays': span}})
        return self.state_for_radix(radix)

    @staticmethod
    def wall_clock_jd() -> float:
        """Julian day (UT) of the wall clock."""
        now = datetime.datetime.now(datetime.timezone.utc)
        hours = now.hour + now.minute / 60 + (now.second + now.microsecond / 1e6) / 3600
        return float(astrology.swe_julday(now.year, now.month, now.day, hours, astrology.SE_GREG_CAL))

    @staticmethod
    def _canonical_int(value) -> Optional[int]:
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value) if value.is_integer() else None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            try:
                return int(value, 10)
            except ValueError:
                return None
        return None

    @staticmethod
    def _canonical_bool(value) -> Optional[bool]:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {'true', '1', 'yes', 'on'}:
                return True
            if normalized in {'false', '0', 'no', 'off'}:
                return False
        return None

    @staticmethod
    def _canonical_float(value) -> Optional[float]:
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, (int, float)):
            number = float(value)
        elif isinstance(value, str):
            try:
                number = float(value.strip())
            except ValueError:
                return None
        else:
            return None
        return number if math.isfinite(number) else None

    @classmethod
    def _camera(cls, state: Mapping) -> Optional[dict]:
        """The stored camera, or the one an old {year, start_month,
        span_months} window opens to (its first day, all its days)."""
        camera = state.get('camera')
        if isinstance(camera, Mapping):
            start = cls._canonical_float(camera.get('startJd'))
            span = cls._canonical_float(camera.get('spanDays'))
            if start is not None and span is not None:
                return {'startJd': start, 'spanDays': min(MAX_SPAN_DAYS, max(MIN_SPAN_DAYS, span))}
        year = cls._canonical_int(state.get('year')) if 'year' in state else None
        if year is None:
            return None
        month = cls._canonical_int(state.get('start_month')) if 'start_month' in state else None
        month = 1 if month is None else min(12, max(1, month))
        span_months = cls._canonical_int(state.get('span_months')) if 'span_months' in state else None
        span_months = DEFAULT_SPAN_MONTHS if span_months is None else _span_months(span_months)
        try:
            start = float(_month_jd(year, month))
            days = float(_month_offsets(year, month, span_months)[-1])
        except Exception:
            return None
        return {'startJd': start, 'spanDays': min(MAX_SPAN_DAYS, max(MIN_SPAN_DAYS, days))}

    @classmethod
    def _normalize_view_state(cls, state) -> dict:
        """Canonical, JSON-stable Graphic Ephemeris view-state schema.

        The time axis is ``camera`` {startJd, spanDays}; an old window state
        is migrated on read and its keys are never written back.
        """
        if not isinstance(state, Mapping):
            return {}

        normalized: dict[str, Any] = {}
        camera = cls._camera(state)
        if camera is not None:
            normalized['camera'] = camera

        mode = state.get('display_mode')
        if mode in {'longitude', 'declination'}:
            normalized['display_mode'] = mode

        # Plate modulus and ink mode always read back, defaulted when absent
        # (state stored before they existed) or invalid.
        modulus = cls._canonical_int(state.get('modulus'))
        normalized['modulus'] = modulus if modulus in VIEW_MODULI else DEFAULT_VIEW_MODULUS
        ink_mode = state.get('ink_mode')
        normalized['ink_mode'] = ink_mode if ink_mode in VIEW_INK_MODES else DEFAULT_VIEW_INK_MODE

        for field in ('show_grid', 'show_event_glyphs', 'show_lunations', 'mirrored',
                      'show_equator', 'show_oob_range', 'show_sign_bands',
                      'show_radix', 'show_fast_contacts', 'show_now_line',
                      'show_planet_contacts', 'hover_line_colors', 'show_radix_bands',
                      'show_radix_reading_glyphs', 'color_radix_labels'):
            if field not in state:
                continue
            value = cls._canonical_bool(state.get(field))
            if value is not None:
                normalized[field] = value

        radix_points = state.get('radix_points')
        if isinstance(radix_points, Mapping):
            # Per-point radix line choices, keyed by natal point key.
            by_point: dict[str, bool] = {}
            for raw_key, raw_visible in radix_points.items():
                visibility = cls._canonical_bool(raw_visible)
                if isinstance(raw_key, str) and 0 < len(raw_key) <= 32 and visibility is not None:
                    by_point[raw_key] = visibility
            normalized['radix_points'] = dict(sorted(by_point.items()))

        visible = state.get('visible_planets')
        if isinstance(visible, Mapping):
            by_planet: dict[int, bool] = {}
            valid_ids = set(PLANET_ORDER)
            for raw_planet_id, raw_visible in visible.items():
                planet_id = cls._canonical_int(raw_planet_id)
                visibility = cls._canonical_bool(raw_visible)
                if planet_id in valid_ids and visibility is not None:
                    by_planet[int(planet_id)] = visibility
            normalized['visible_planets'] = {
                str(planet_id): by_planet[planet_id]
                for planet_id in PLANET_ORDER
                if planet_id in by_planet
            }

        return normalized


ephemeris_service = EphemerisService()
