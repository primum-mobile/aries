"""Graphic Ephemeris daemon service.

Brain: ``ephemcalc.EphemCalc`` (ephemcalc.py:8-87) runs AS-IS — one sample per
day for 12 anchored months of planet longitudes + declinations in the selected
zodiac. Station detection is the wx-fused semantic EXTRACTED verbatim from
``graphephemwnd.GraphEphemWnd`` (graphephemwnd.py:365-537): longitude SR/SD via
aries.astrology.transit_fast batch search with the series-inflection fallback,
declination DN/DS extrema + EQ zero crossings via the same bisection refiners.
Nothing here imports wx; the React view (graph-ephemeris-view.tsx) only renders
this payload.

Series cache mirrors morin._ephemeris_cache_key / GraphEphemPanel._series_cache_key
(morin.py:5428-5434, graphephemframe.py:338-345). The per-radix view-state store
mirrors morin.ephemeris_state_for_radix/_radix_view_state_key
(morin.py:5364-5426).
"""
from __future__ import annotations

import calendar
import sys
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import chart
import common
import ephemcalc
import mtexts
import planets
import util
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import search_longitude_transits_batch, search_station_times_batch

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
}

# graphephemwnd.GraphEphemWnd.SIGN_NAME_KEYS (graphephemwnd.py:41).
SIGN_NAME_KEYS = ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                  'Libra', 'Scorpio', 'Sagittarius', 'Capricornus',
                  'Aquarius', 'Pisces')


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


def _month_offsets(year: int, start_month: int) -> list[int]:
    """graphephemwnd._month_start_offsets (graphephemwnd.py:260-274)."""
    offsets = [0]
    total = 0
    y, m = int(year), int(start_month)
    for _ in range(12):
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


def _fast_ephemeris_series(year: int, options, start_month: int) -> dict:
    """EphemCalc-compatible daily series without chart.Time/Planet wrappers.

    EphemCalc samples 00:00 Greenwich once per calendar day and asks Swiss
    Ephemeris for ecliptic positions directly in the selected zodiac. Keep that
    exact behavior here; this is only a daemon-side fast path for the renderer.
    """
    context = _longitude_context(options)
    flags = context.flags

    days = _month_offsets(year, start_month)[-1]
    start_jd = astrology.swe_julday(int(year), int(start_month), 1, 0.0, astrology.SE_GREG_CAL)
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


def _declination_stations(series_by_planet, planet_ids, start_jd) -> list[dict]:
    """graphephemwnd._build_station_snap_targets declination branch
    (graphephemwnd.py:717-756): DN/DS extrema + EQ equator crossings."""
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
            root_jd = _refine_decl_station_root(pid, start_jd + i - 1, start_jd + i + 1)
            if root_jd is None:
                root_jd = _refine_decl_extremum(
                    start_jd + i - 1, start_jd + i, start_jd + i + 1, va, vb, vc)
            decl = _decl_at_jd(pid, root_jd)
            if decl is None:
                decl = _decl_extremum_value(va, vb, vc)
            date_txt = _format_date_jd(root_jd)
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
                root_jd = _refine_decl_zero_root(pid, start_jd + i, start_jd + i + 1)
                if root_jd is None:
                    root_jd = _refine_decl_zero_cross(start_jd + i, start_jd + i + 1, va, vb)
                date_txt = _format_date_jd(root_jd)
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


def _longitude_sign_events(options, year: int, planet_ids, start_jd, days) -> list[dict]:
    """Exact sign-boundary crossings for the plotted longitude ephemeris.

    Search in the same zodiac frame used by the plotted series.
    """
    out: list[dict] = []
    if start_jd is None or days <= 0 or not planet_ids:
        return out
    context = _longitude_context(options)
    search_targets: list[tuple[float, int]] = []
    for sign_index in range(chart.Chart.SIGN_NUM):
        display_target = float(sign_index * chart.Chart.SIGN_DEG)
        search_targets.append((display_target, sign_index))
    try:
        hits = search_longitude_transits_batch(
            [int(pid) for pid in planet_ids],
            float(start_jd),
            float(start_jd) + float(days),
            [target for target, _sign in search_targets],
            context=context,
        )
    except Exception:
        return out
    for hit in hits:
        if getattr(hit, 'hit_type', None) != 'longitude':
            continue
        target_sign = _target_sign_for_hit(search_targets, float(hit.target_deg))
        if target_sign is None:
            continue
        left_sign, right_sign = _sign_change_pair(target_sign, float(hit.speed))
        retrograde = float(hit.speed) < 0.0
        event_sign = left_sign if retrograde else right_sign
        date_txt = _format_date_jd(float(hit.jd_ut))
        out.append({
            "planet": int(hit.planet),
            "jd": float(hit.jd_ut),
            "dayOffset": float(hit.jd_ut) - float(start_jd),
            "value": float(target_sign * chart.Chart.SIGN_DEG),
            "targetSign": int(target_sign),
            "fromSign": int(left_sign),
            "toSign": int(right_sign),
            "eventSign": int(event_sign),
            "retrograde": bool(retrograde),
            "date": date_txt or "",
        })
    return out


class EphemerisService:
    """Payload builder + series cache + per-radix view-state store."""

    def __init__(self) -> None:
        self._series_cache: dict[tuple, dict] = {}
        self._payload_cache: dict[tuple, dict] = {}
        self._station_cache: dict[tuple, dict] = {}
        self._sign_event_cache: dict[tuple, list[dict]] = {}
        # morin._radix_view_state[('ephemeris', key)] twin (morin.py:5396-5426).
        self._view_state: dict[tuple, dict] = {}

    # graphephemframe._series_cache_key (graphephemframe.py:338-345).
    def _data_key(self, year: int, month: int) -> tuple:
        options = chart_snapshot_service.options
        return (
            int(year),
            int(month),
            int(getattr(options, 'ayanamsha', 0)),
            tuple(bool(v) for v in getattr(options, 'transcendental', ())),
            bool(getattr(options, 'showchiron', True)),
        )

    def _payload_key(self, year: int, month: int) -> tuple:
        options = chart_snapshot_service.options
        return (
            *self._data_key(year, month),
            bool(getattr(options, 'signs', True)),
            bool(getattr(options, 'bw', False)),
            _rgb_key(getattr(options, 'clrbackground', None)),
            _rgb_key(getattr(options, 'clrframe', None)),
            _rgb_key(getattr(options, 'clrtexts', None)),
            _rgb_key(getattr(options, 'clrsigns', None)),
            _rgb_key(getattr(options, 'clrhouses', None)),
            _rgb_list_key(getattr(options, 'clrindividual', None)),
        )

    def _series_for(self, year: int, start_month: int):
        data_key = self._data_key(year, start_month)
        series = self._series_cache.get(data_key)
        if series is not None:
            return series
        options = chart_snapshot_service.options
        try:
            series = _fast_ephemeris_series(year, options, start_month)
        except Exception:
            series = ephemcalc.EphemCalc(year, options, start_month=start_month).series
        self._series_cache[data_key] = series
        if len(self._series_cache) > 36:
            self._series_cache.pop(next(iter(self._series_cache)))
        return series

    def _stations_for(self, year: int, start_month: int, series, planet_ids, start_jd, days) -> dict:
        data_key = self._data_key(year, start_month)
        cached = self._station_cache.get(data_key)
        if cached is not None:
            return cached
        stations = {"longitude": [], "declination": []}
        if start_jd is not None:
            options = chart_snapshot_service.options
            stations["longitude"] = _longitude_stations(
                options, series, planet_ids, start_jd, days)
            stations["declination"] = _declination_stations(series, planet_ids, start_jd)
        self._station_cache[data_key] = stations
        if len(self._station_cache) > 36:
            self._station_cache.pop(next(iter(self._station_cache)))
        return stations

    def _sign_events_for(self, year: int, start_month: int, planet_ids, start_jd, days) -> list[dict]:
        data_key = self._data_key(year, start_month)
        cached = self._sign_event_cache.get(data_key)
        if cached is not None:
            return cached
        options = chart_snapshot_service.options
        events = _longitude_sign_events(options, year, planet_ids, start_jd, days)
        self._sign_event_cache[data_key] = events
        if len(self._sign_event_cache) > 36:
            self._sign_event_cache.pop(next(iter(self._sign_event_cache)))
        return events

    def payload(self, year: int, start_month: int = 1, include_stations: bool = True) -> dict:
        year = int(year)
        start_month = min(12, max(1, int(start_month)))
        payload_key = self._payload_key(year, start_month)
        cached = self._payload_cache.get(payload_key)
        if cached is not None:
            if include_stations:
                series = self._series_for(year, start_month)
                planet_ids = [pid for pid in PLANET_ORDER if pid in series]
                return {
                    **cached,
                    "stations": self._stations_for(
                        year, start_month, series, planet_ids,
                        cached.get("startJd"), int(cached.get("days", 0))),
                    "signEvents": self._sign_events_for(
                        year, start_month, planet_ids,
                        cached.get("startJd"), int(cached.get("days", 0))),
                }
            return cached

        options = chart_snapshot_service.options
        bw = bool(getattr(options, 'bw', False))
        series = self._series_for(year, start_month)
        start_jd = _start_jd(year, start_month)
        offsets = _month_offsets(year, start_month)
        days = offsets[-1]

        # Month labels in anchored order (graphephemwnd.py:1276-1283).
        month_labels = []
        for i in range(12):
            month = ((start_month - 1 + i) % 12) + 1
            month_labels.append(common.common.monthabbr[month - 1])

        signs = common.common.Signs1 if getattr(options, 'signs', True) else common.common.Signs2

        planet_ids = [pid for pid in PLANET_ORDER if pid in series]
        planets_payload = []
        for pid in planet_ids:
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
                "longitude": [float(v) for v in series[pid]['longitude']],
                "declination": [float(v) for v in series[pid]['declination']],
            })

        payload = {
            "year": year,
            "startMonth": start_month,
            "startJd": start_jd,
            "days": int(days),
            "monthOffsets": [int(v) for v in offsets],
            "monthLabels": month_labels,
            "signGlyphs": list(signs),
            "signNames": [mtexts.txts.get(k, k) for k in SIGN_NAME_KEYS],
            "colors": _ephemeris_colors(options, bw),
            "planets": planets_payload,
            "stations": {"longitude": [], "declination": []},
            "signEvents": [],
        }
        self._payload_cache[payload_key] = payload
        if len(self._payload_cache) > 36:
            self._payload_cache.pop(next(iter(self._payload_cache)))
        if include_stations:
            return {
                **payload,
                "stations": self._stations_for(year, start_month, series, planet_ids, start_jd, days),
                "signEvents": self._sign_events_for(year, start_month, planet_ids, start_jd, days),
            }
        return payload

    def station_payload(self, year: int, start_month: int = 1) -> dict:
        year = int(year)
        start_month = min(12, max(1, int(start_month)))
        series = self._series_for(year, start_month)
        planet_ids = [pid for pid in PLANET_ORDER if pid in series]
        start_jd = _start_jd(year, start_month)
        days = _month_offsets(year, start_month)[-1]
        return {
            "year": year,
            "startMonth": start_month,
            "stations": self._stations_for(year, start_month, series, planet_ids, start_jd, days),
            "signEvents": self._sign_events_for(year, start_month, planet_ids, start_jd, days),
        }

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

    def state_for_radix(self, radix) -> dict:
        key = self._radix_key(radix)
        if key is None:
            return {}
        return dict(self._view_state.get(key, {}))

    def store_state_for_radix(self, radix, state: Optional[dict[str, Any]]) -> None:
        key = self._radix_key(radix)
        if key is None:
            return
        self._view_state[key] = dict(state or {})


ephemeris_service = EphemerisService()
