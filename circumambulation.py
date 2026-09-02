# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

# circumambulation.py
# -*- coding: utf-8 -*-

from __future__ import division
import os, sys, math, datetime
import io
import types
from contextlib import contextmanager
import astrology, chart, houses, mtexts
import fixstars
import fortune
import planets
import primdirs
import customerpd
import util

TRADITIONAL_ASPECT_INDICES = (
    chart.Chart.CONJUNCTIO,
    chart.Chart.SEXTIL,
    chart.Chart.QUADRAT,
    chart.Chart.TRIGON,
    chart.Chart.OPPOSITIO,
)
DEFAULT_KEY_Y_PER_DEG = 1.0  # years per equatorial degree (OA)
DAYS_PER_YEAR = 365.2421897
_CIRCUM_SIG_KEY = "circum_sig"
_NATAL_PARTICIPATOR_SOURCE = "natal_radix"
_NATAL_PARTICIPATOR_MARKER = "n"

CIRCUMAMBULATION_PROMISSOR_CAPABILITIES = {
    "planets": "supported",
    "nodes": "supported-follow-pd",
    "chiron": "supported-follow-pd",
    "fortune": "supported-follow-pd",
    "customer-point": "supported-follow-pd",
    "arabic-part": "supported-follow-pd",
    "fixed-stars": "supported-follow-pd",
    "antiscia": "supported-follow-pd",
    "midpoints": "supported-follow-pd",
    "angles": "supported-follow-pd",
    "house-cusps": "supported-follow-pd",
    "bounds": "structural-period-boundaries",
    "parallels": "unsupported-declination-contact-not-an-ecliptic-circumambulation-aspect",
    "syzygy": "unsupported-no-primary-directions-promissor-selection",
    "vertex": "unsupported-no-primary-directions-promissor-selection",
}


def normalize_promissor_profile(value):
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD
    if value == primdirs.PrimDirs.CIRCUM_PROMISSORS_TRADITIONAL:
        return value
    return primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD


def promissor_profile_from_options(options):
    return normalize_promissor_profile(getattr(
        options,
        "pdcircumprommode",
        primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD,
    ))


def _participating_aspect_indices(options, promissor_profile):
    if normalize_promissor_profile(promissor_profile) == primdirs.PrimDirs.CIRCUM_PROMISSORS_TRADITIONAL:
        return TRADITIONAL_ASPECT_INDICES
    selected = list(getattr(options, "pdaspects", []) or [])
    return tuple(
        idx for idx in range(min(len(selected), len(chart.Chart.Aspects)))
        if selected[idx]
    )


def _participating_aspect_degrees(options, promissor_profile):
    return tuple(chart.Chart.Aspects[idx] for idx in _participating_aspect_indices(options, promissor_profile))


def _body_label(body_id):
    labels = (
        "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
        "Uranus", "Neptune", "Pluto", "AscNode", "DescNode",
    )
    try:
        key = labels[int(body_id)]
    except (IndexError, TypeError, ValueError):
        return str(body_id)
    return mtexts.txts.get(key, key)


def _participating_longitude_entries(chart_obj, options, promissor_profile, *, natal=False):
    """Resolve the PD-selected promissor universe for circumambulation.

    Bounds remain the structural period stream. Every selected ecliptic
    promissor family is converted to a stable longitude entry before either
    calculation method narrows it to contacts.
    """
    profile = normalize_promissor_profile(promissor_profile)
    source = _NATAL_PARTICIPATOR_SOURCE if natal else "return"
    marker = _NATAL_PARTICIPATOR_MARKER if natal else None
    prefix = "natal" if natal else "source"
    entries = []
    seen = set()

    def add(family, identity, label, lon, lat=0.0, planet_id=None):
        try:
            lon = util.normalize(float(lon))
            lat = float(lat or 0.0)
        except (TypeError, ValueError):
            return
        key = "%s:%s:%s" % (prefix, family, identity)
        if key in seen:
            return
        seen.add(key)
        entries.append({
            "key": key,
            "family": family,
            "label": str(label or identity),
            "lon": lon,
            "lat": lat,
            "source": source,
            "source_marker": marker,
            "planet_id": planet_id,
        })

    selected_bodies = list(getattr(options, "promplanets", []) or [])
    body_ids = range(7) if profile == primdirs.PrimDirs.CIRCUM_PROMISSORS_TRADITIONAL else range(len(selected_bodies))
    for body_id in body_ids:
        if profile != primdirs.PrimDirs.CIRCUM_PROMISSORS_TRADITIONAL and not selected_bodies[body_id]:
            continue
        try:
            body = chart_obj.planets.planets[body_id]
            add("body", body_id, _body_label(body_id), body.data[planets.Planet.LONG], body.data[planets.Planet.LAT], body_id)
        except Exception:
            continue

    if profile == primdirs.PrimDirs.CIRCUM_PROMISSORS_TRADITIONAL:
        return entries

    if getattr(options, "pdpromchiron", False):
        try:
            body = chart_obj.chiron
            add("body", astrology.SE_CHIRON, mtexts.txts.get("Chiron", "Chiron"), body.data[planets.Planet.LONG], body.data[planets.Planet.LAT], astrology.SE_CHIRON)
        except Exception:
            pass

    if bool((getattr(options, "pdlof", [False]) or [False])[0]):
        try:
            add("fortune", "lof", mtexts.txts.get("LoF", "LoF"), chart_obj.fortune.fortune[fortune.Fortune.LON])
        except Exception:
            pass

    if getattr(options, "pdcustomer", False):
        try:
            point = chart_obj._ensure_pd_customer_point(False)
            if point is not None:
                add("customer", "user-promissor", mtexts.txts.get("User2", "User"), point.lon, point.lat)
        except Exception:
            pass

    if getattr(options, "pdpromarabicparts", False):
        try:
            point = chart_obj._get_pd_arabic_part_promissor_point()
            label = chart_obj._get_pd_active_arabic_part_name(True)
            if point is not None and label:
                add("arabic-part", label, label, point.lon, point.lat)
        except Exception:
            pass

    if getattr(options, "pdfixstars", False):
        selections = list(getattr(options, "pdfixstarssel", []) or [])
        try:
            mixed = list(getattr(chart_obj.fixstars, "mixed", []) or [])
            for sorted_idx, star in enumerate(chart_obj.fixstars.data):
                ordinal = mixed[sorted_idx] if sorted_idx < len(mixed) else sorted_idx
                if ordinal < 0 or ordinal >= len(selections) or not selections[ordinal]:
                    continue
                code = star[fixstars.FixStars.NOMNAME]
                label = code or star[fixstars.FixStars.NAME]
                add("fixed-star", ordinal, label, star[fixstars.FixStars.LON])
        except Exception:
            pass

    if getattr(options, "pdantiscia", False):
        for family, collection in (
            ("antiscion", getattr(getattr(chart_obj, "antiscia", None), "plantiscia", [])),
            ("contra-antiscion", getattr(getattr(chart_obj, "antiscia", None), "plcontraant", [])),
        ):
            for body_id, point in enumerate(collection or []):
                if body_id >= len(selected_bodies) or not selected_bodies[body_id] or not getattr(point, "valid", True):
                    continue
                label = "%s %s" % (
                    mtexts.txts.get("Antiscion", "Antiscion") if family == "antiscion" else mtexts.txts.get("Contraantiscion", "Contra-antiscion"),
                    _body_label(body_id),
                )
                add(family, body_id, label, point.lon, point.lat)

        if bool((getattr(options, "pdlof", [False]) or [False])[0]):
            for family, point in (
                ("antiscion-fortune", getattr(getattr(chart_obj, "antiscia", None), "lofant", None)),
                ("contra-antiscion-fortune", getattr(getattr(chart_obj, "antiscia", None), "lofcontraant", None)),
            ):
                if point is not None and getattr(point, "valid", True):
                    prefix_label = (
                        mtexts.txts.get("Antiscion", "Antiscion")
                        if family == "antiscion-fortune"
                        else mtexts.txts.get("Contraantiscion", "Contra-antiscion")
                    )
                    add(family, "lof", "%s %s" % (prefix_label, mtexts.txts.get("LoF", "LoF")), point.lon, point.lat)

        for family, collection in (
            ("antiscion-angle", getattr(getattr(chart_obj, "antiscia", None), "ascmcant", [])),
            ("contra-antiscion-angle", getattr(getattr(chart_obj, "antiscia", None), "ascmccontraant", [])),
        ):
            for angle_idx, point in enumerate(collection or []):
                if angle_idx >= 2 or not getattr(point, "valid", True):
                    continue
                angle_label = mtexts.txts.get("Asc", "Asc") if angle_idx == 0 else mtexts.txts.get("MC", "MC")
                prefix_label = (
                    mtexts.txts.get("Antiscion", "Antiscion")
                    if family == "antiscion-angle"
                    else mtexts.txts.get("Contraantiscion", "Contra-antiscion")
                )
                add(family, angle_idx, "%s %s" % (prefix_label, angle_label), point.lon, point.lat)

    if getattr(options, "pdmidpoints", False):
        mids = getattr(getattr(chart_obj, "midpoints", None), "mids", []) or []
        for idx, midpoint in enumerate(mids):
            try:
                if not selected_bodies[midpoint.p1] or not selected_bodies[midpoint.p2]:
                    continue
                label = "%s / %s" % (_body_label(midpoint.p1), _body_label(midpoint.p2))
                add("midpoint", idx, label, midpoint.m, midpoint.lat)
            except Exception:
                continue

    if getattr(options, "ascmchcsasproms", False):
        try:
            add("angle", "asc", mtexts.txts.get("Asc", "Asc"), chart_obj.houses.ascmc[houses.Houses.ASC])
            add("angle", "mc", mtexts.txts.get("MC", "MC"), chart_obj.houses.ascmc[houses.Houses.MC])
        except Exception:
            pass

    if getattr(options, "pdcusppromissors", False):
        for cusp in (2, 3, 5, 6, 8, 9, 11, 12):
            try:
                add("house-cusp", cusp, mtexts.txts.get("HC%d" % cusp, "HC%d" % cusp), chart_obj.houses.cusps[cusp])
            except Exception:
                continue

    return entries


def years_per_degree_from_options(options):
    """Return years-per-degree key for circumambulation from current options."""
    v = getattr(options, 'circumkey', None)
    if v is not None:
        try:
            return float(v)
        except Exception:
            pass

    if getattr(options, 'pdkeydyn', False):
        try:
            coeff = float(primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.COEFF])
            return coeff if coeff > 0.0 else DEFAULT_KEY_Y_PER_DEG
        except Exception:
            return DEFAULT_KEY_Y_PER_DEG

    try:
        if getattr(options, 'pdkeys', None) == primdirs.PrimDirs.CUSTOMER:
            deg = float(getattr(options, 'pdkeydeg', 0.0))
            minu = float(getattr(options, 'pdkeymin', 0.0))
            sec = float(getattr(options, 'pdkeysec', 0.0))
            deg_per_year = deg + minu / 60.0 + sec / 3600.0
            return (1.0 / deg_per_year) if deg_per_year > 0.0 else DEFAULT_KEY_Y_PER_DEG

        pdkeys = getattr(options, 'pdkeys', None)
        if pdkeys is not None:
            coeff = float(primdirs.PrimDirs.staticData[pdkeys][primdirs.PrimDirs.COEFF])
            return coeff if coeff > 0.0 else DEFAULT_KEY_Y_PER_DEG
    except Exception:
        pass

    return DEFAULT_KEY_Y_PER_DEG


def use_pd_circumoa_from_options(options):
    """Return True when circumambulation must use the PD engine method."""
    mode = getattr(options, 'pdcircumoa', primdirs.PrimDirs.CIRCUM_OA_ASCENSIONAL_TIMES)
    return mode == primdirs.PrimDirs.CIRCUM_OA_USE_PD


def normalize_custom_significator(spec):
    if not isinstance(spec, dict):
        return None
    try:
        lon = util.normalize(float(spec.get("longitude")))
    except (TypeError, ValueError):
        return None
    try:
        lat = float(spec.get("latitude", 0.0) or 0.0)
    except (TypeError, ValueError):
        lat = 0.0
    lat = max(-90.0, min(90.0, lat))
    label = str(spec.get("label") or "").strip() or mtexts.txts.get("User2", "User")
    out = {
        "id": str(spec.get("id") or "custom:circum"),
        "label": label,
        "longitude": lon,
        "latitude": lat,
    }
    for key in ("display_glyph", "display_marker"):
        value = str(spec.get(key) or "")
        if value:
            out[key] = value
    segments = spec.get("display_segments")
    if isinstance(segments, list):
        out["display_segments"] = [item for item in segments if isinstance(item, dict)]
    try:
        out["display_planet_id"] = int(spec.get("display_planet_id"))
    except (TypeError, ValueError):
        pass
    return out


@contextmanager
def _temporary_custom_significator(chrt, spec):
    normalized = normalize_custom_significator(spec)
    if normalized is None or chrt is None:
        yield None
        return
    try:
        point = customerpd.CustomerPD.from_ecliptic_longitude(
            normalized["longitude"],
            chrt.place.lat,
            chrt.houses.ascmc2,
            chrt.obl[0],
            chrt.raequasc,
            normalized.get("latitude", 0.0),
            _sidereal_offset_deg(chrt, getattr(chrt, "options", None)),
        )
    except Exception:
        yield None
        return

    original_iter = getattr(chrt, "iter_pd_significator_points")
    original_label = getattr(chrt, "get_pd_dynamic_point_label")
    original_cpd2 = getattr(chrt, "cpd2", None)
    original_context_spec = getattr(chrt, "pd_context_significator_spec", None)
    label = str(normalized.get("label") or mtexts.txts.get("User2", "User"))

    def iter_pd_significator_points_override(self):
        return [(_CIRCUM_SIG_KEY, point)]

    def get_pd_dynamic_point_label_override(self, key, promissor):
        if key in (_CIRCUM_SIG_KEY, "user_sig") and not promissor:
            return label
        return original_label(key, promissor)

    chrt.iter_pd_significator_points = types.MethodType(
        iter_pd_significator_points_override,
        chrt,
    )
    chrt.get_pd_dynamic_point_label = types.MethodType(
        get_pd_dynamic_point_label_override,
        chrt,
    )
    chrt.cpd2 = point
    chrt.pd_context_significator_spec = normalized
    try:
        yield normalized
    finally:
        chrt.iter_pd_significator_points = original_iter
        chrt.get_pd_dynamic_point_label = original_label
        chrt.cpd2 = original_cpd2
        chrt.pd_context_significator_spec = original_context_spec

def _gregorian_date_in_radix_zone(jd, chrt):
    """
    표시용 날짜를 라딕스의 민법(현지) 시각대(TZ + DST)에 맞춰 반환.
    Morinus: plus(동경=+), zh(시간), zm(분), daylightsaving(썸머타임) 기준.
    """
    tz_hours = 0.0
    dst_hours = 0.0
    t = getattr(chrt, 'time', None)
    if t is not None:
        # 우선순위 1: Morinus 고유 필드(plus, zh, zm, daylightsaving)
        try:
            if hasattr(t, 'plus') and hasattr(t, 'zh') and hasattr(t, 'zm'):
                base = float(getattr(t, 'zh', 0.0)) + float(getattr(t, 'zm', 0.0)) / 60.0
                sign = 1.0 if bool(getattr(t, 'plus', True)) else -1.0   # 동경=+, 서경=-
                tz_hours = sign * base
            if bool(getattr(t, 'daylightsaving', False)):
                dst_hours = 1.0
        except Exception:
            pass
        # 우선순위 2: 다른 프로젝트 변형 필드들(가능하면 활용, 없으면 0 유지)
        if tz_hours == 0.0:
            for name in ('zone', 'tz', 'utcoff', 'utc_offset'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        tz_hours = float(v)
                        break
                    except Exception:
                        pass
        if dst_hours == 0.0:
            for name in ('dst', 'DST'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        dst_hours = float(v)
                        break
                    except Exception:
                        pass

    off_days = (tz_hours + dst_hours) / 24.0
    gY, gM, gD, _ = astrology.swe_revjul(jd + off_days + 1e-9, astrology.SE_GREG_CAL)
    return datetime.date(int(gY), int(gM), int(gD))


def _gregorian_datetime_in_radix_zone(jd, chrt):
    """
    Return a local civil datetime in the radix zone used for circum row display.
    This mirrors _gregorian_date_in_radix_zone() but preserves the clock time.
    """
    tz_hours = 0.0
    dst_hours = 0.0
    t = getattr(chrt, 'time', None)
    if t is not None:
        try:
            if hasattr(t, 'plus') and hasattr(t, 'zh') and hasattr(t, 'zm'):
                base = float(getattr(t, 'zh', 0.0)) + float(getattr(t, 'zm', 0.0)) / 60.0
                sign = 1.0 if bool(getattr(t, 'plus', True)) else -1.0
                tz_hours = sign * base
            if bool(getattr(t, 'daylightsaving', False)):
                dst_hours = 1.0
        except Exception:
            pass
        if tz_hours == 0.0:
            for name in ('zone', 'tz', 'utcoff', 'utc_offset'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        tz_hours = float(v)
                        break
                    except Exception:
                        pass
        if dst_hours == 0.0:
            for name in ('dst', 'DST'):
                v = getattr(t, name, None)
                if v is not None:
                    try:
                        dst_hours = float(v)
                        break
                    except Exception:
                        pass

    off_days = (tz_hours + dst_hours) / 24.0
    gY, gM, gD, gH = astrology.swe_revjul(jd + off_days + 1e-9, astrology.SE_GREG_CAL)
    hour_float = float(gH)
    hour = int(math.floor(hour_float))
    minute_float = (hour_float - hour) * 60.0
    minute = int(math.floor(minute_float))
    second = int(round((minute_float - minute) * 60.0))
    if second >= 60:
        second = 0
        minute += 1
    if minute >= 60:
        minute = 0
        hour += 1
    base = datetime.datetime(int(gY), int(gM), int(gD), 0, 0, 0)
    return base + datetime.timedelta(hours=hour, minutes=minute, seconds=second)

_ASTROSEEK_CANDIDATES = [
    os.path.join(os.path.dirname(__file__), "data", "rt_0p5.txt"),
    os.path.join(os.path.dirname(__file__), "Data", "rt_0p5.txt"),
    os.path.join(os.path.dirname(__file__), "rt_0p5.txt"),
]
_GRID_PHI = None
_GRID_RT  = None

def _rt_table_candidates():
    """Return source, dev, and packaged Tauri resource paths for rt_0p5.txt."""
    bases = [
        os.environ.get("ARIES_DAEMON_BASE_DIR", ""),
        getattr(sys, "_MEIPASS", ""),
        os.getcwd(),
    ]
    candidates = list(_ASTROSEEK_CANDIDATES)
    for base in bases:
        if not base:
            continue
        candidates.extend((
            os.path.join(base, "data", "rt_0p5.txt"),
            os.path.join(base, "Data", "rt_0p5.txt"),
            os.path.join(base, "rt_0p5.txt"),
        ))
    seen = set()
    ordered = []
    for path in candidates:
        try:
            normalized = os.path.abspath(path)
        except Exception:
            normalized = path
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(path)
    return ordered

def _load_rt_table_once():
    global _GRID_PHI, _GRID_RT
    if _GRID_PHI is not None:
        return _GRID_PHI, _GRID_RT
    grid_phi, grid_rt = [], []
    def _try(path):
        if not os.path.exists(path):
            return False
        # 유니코드로 안전하게 읽고, 쉼표/세미콜론도 허용
        with io.open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                parts = line.strip().replace("\t", " ")
                parts = parts.replace(",", " ").replace(";", " ").split()
                if len(parts) != 13:
                    continue
                try:
                    phi_txt = parts[0].replace(u"°", u"")
                    phi = float(phi_txt)
                    row = [float(x) for x in parts[1:13]]
                except Exception:
                    continue
                if phi > 66.0:
                    continue
                s = sum(row)
                if 300.0 <= s <= 420.0:
                    grid_phi.append(phi); grid_rt.append(row)
        return len(grid_phi) > 0
    for p in _rt_table_candidates():
        try:
            if _try(p):
                break
        except Exception:
            pass
    if not grid_phi:
        raise RuntimeError("Rising Times table not found. Put 'rt_0p5.txt' under ./data/ or project root.")
    pairs = sorted(zip(grid_phi, grid_rt), key=lambda t: t[0])
    _GRID_PHI = [p for p,_ in pairs]
    _GRID_RT  = [r for _,r in pairs]
    return _GRID_PHI, _GRID_RT

def _interp_rt12(phi):
    grid_phi, grid_rt = _load_rt_table_once()
    if phi <= grid_phi[0]:
        return list(grid_rt[0])
    if phi >= grid_phi[-1]:
        return list(grid_rt[-1])
    lo, hi = 0, len(grid_phi)-1
    while lo <= hi:
        mid = (lo+hi)//2
        if grid_phi[mid] < phi:
            lo = mid+1
        else:
            hi = mid-1
    i = lo
    if i <= 0:
        return list(grid_rt[0])
    if i >= len(grid_phi):
        return list(grid_rt[-1])
    p0, p1 = grid_phi[i-1], grid_phi[i]
    w = 0.0 if p1 == p0 else (phi - p0) / (p1 - p0)
    row0, row1 = grid_rt[i-1], grid_rt[i]
    return [ (1.0-w)*a + w*b for a,b in zip(row0,row1) ]

def _sign_index(lmb):
    return int((lmb % 360.0) // 30.0)
def _oa_rising_deg_unwrapped(lon_deg, phi_deg, eps_deg):
    """Rising OA(°) for ecliptic longitude lon_deg (tropical), latitude phi_deg, obliquity eps_deg.
    Unwrap so lon+360 -> OA+360.
    """
    k = math.floor(lon_deg / 360.0)
    lon0 = lon_deg - 360.0 * k

    lon = math.radians(lon0)
    phi = math.radians(phi_deg)
    eps = math.radians(eps_deg)

    # RA/Dec of ecliptic point (β=0)
    ra = math.atan2(math.sin(lon) * math.cos(eps), math.cos(lon))
    if ra < 0:
        ra += 2.0 * math.pi
    dec = math.asin(math.sin(eps) * math.sin(lon))

    # semi-diurnal arc: cos(H) = -tan(phi)*tan(dec)
    x = -math.tan(phi) * math.tan(dec)
    if x <= -1.0:
        H = math.pi
    elif x >= 1.0:
        H = 0.0
    else:
        H = math.acos(x)

    oa = (ra - H) % (2.0 * math.pi)
    return math.degrees(oa) + 360.0 * k


def _delta_oa_exact(phi_deg, lam1_sid, lam2_sid, ayan_deg, eps_deg):
    """Exact ΔOA using OA difference. lam*_sid are your internal longitudes; +ayan -> tropical."""
    lon1 = lam1_sid + ayan_deg
    lon2 = lam2_sid + ayan_deg
    if lon2 < lon1:
        lon2 += 360.0

    oa1 = _oa_rising_deg_unwrapped(lon1, phi_deg, eps_deg)
    oa2 = _oa_rising_deg_unwrapped(lon2, phi_deg, eps_deg)
    return max(0.0, oa2 - oa1)
def _delta_oa_by_rt(rt12, lam1, lam2, ayan=0.0, gran_deg=0.0):
    import math
    a_t = lam1 + ayan
    b_t = lam2 + ayan
    if b_t < a_t:
        b_t += 360.0

    cur_t = a_t
    end_t = b_t
    s = 0.0
    eps = 1e-12

    while cur_t + eps < end_t:
        # 현재 트로피컬 사인 경계
        si = _sign_index(cur_t)
        k_next = math.floor((cur_t + eps) / 30.0) + 1
        sign_end_t = 30.0 * k_next

        # 선택적: 0.5° 같은 세분 격자 경계
        if gran_deg and gran_deg > 0.0:
            gk = math.floor((cur_t + eps) / gran_deg) + 1
            grid_end_t = gran_deg * gk
            step_end = min(sign_end_t, grid_end_t, end_t)
        else:
            step_end = min(sign_end_t, end_t)

        step_t = step_end - cur_t
        s += rt12[si] * (step_t / 30.0)
        cur_t = step_end

    return max(0.0, s)

def _term_edges_deg(options, ayan=0.0):

    """Return [(lam_start, lam_end, ruler_pid, sign_idx)] over 0..360°.

    - Morinus 옵션의 terms 구조가 환경에 따라
      * 각 텀의 '길이(span)' 5개 (합≈30) 이거나
      * 각 텀의 '끝도수(end)' 5개 (단조증가, 마지막≈30)
      로 들어오는 사례가 있어, 여기서 자동 판별한다.
    """
    edges = []
    sel = getattr(options, "selterm", 0)
    terms = options.terms[sel]    # [12][n][planet_id, value]

    # 텀 경계는 이미 시데리얼 좌표계(0,30,60…°)에서 생성해야 한다.
    # 상위 레벨에서 아야남샤 보정이 끝났으므로 여기서는 추가 평행이동을 하지 않는다.
    lam0 = 0.0

    for sign in range(12):
        rows = terms[sign]
        # value 후보를 한 번에 뽑기
        vals = []
        pids = []
        for t in range(len(rows)):
            pid = rows[t][0]
            try:
                val = float(rows[t][1])
            except Exception:
                # (안전) 숫자가 아니면 0 취급
                val = 0.0
            pids.append(pid)
            vals.append(val)

        # --- 판별: span 형식인가 end 형식인가?
        use_span = False
        use_end  = False
        ssum = sum(vals)
        if 28.5 <= ssum <= 31.5:
            use_span = True
        # end 후보: 단조 증가 & 마지막이 28~30.5
        if all(vals[i] <= vals[i+1] for i in range(len(vals)-1)) and (28.0 <= vals[-1] <= 30.5):
            use_end = True

        # 애매하면 span 우선(실전에서 Morinus가 span인 빌드가 많음)
        mode = "span" if (use_span or not use_end) else "end"

        prev = 0.0
        if mode == "span":
            for t in range(len(vals)):
                span = max(0.0, min(vals[t], 30.0 - prev))
                a = lam0 + prev
                b = a + span
                if b - a > 1e-9:
                    edges.append((a, b, pids[t], sign))
                prev += span
        else:  # end
            for t in range(len(vals)):
                end = max(prev, min(vals[t], 30.0))
                a = lam0 + prev
                b = lam0 + end
                if b - a > 1e-9:
                    edges.append((a, b, pids[t], sign))
                prev = end

        lam0 += 30.0

    # 시작경도 기준 정렬 보장
    edges.sort(key=lambda x: x[0])
    return edges
def _sidereal_offset_deg(chrt, options):
    """Return the ayanamsha offset (°) when the chart is sidereal, else 0.0.

    Reads ``chrt.ayanamsha_offset`` (the actual offset value). The
    ``chrt.ayanamsha`` attribute now stays at 0.0 as the residual offset
    after ``Chart._zodiac_flags()`` applies ``SEFLG_SIDEREAL`` at the
    SwissEph boundary; the genuine offset value lives on
    ``ayanamsha_offset``. Falls back to ``ayanamsha`` for compatibility
    with any caller that hasn't been rebuilt yet.
    """
    try:
        if getattr(options, 'ayanamsha', 0) != 0:
            val = float(getattr(chrt, 'ayanamsha_offset', 0.0)) or 0.0
            if val == 0.0:
                val = float(getattr(chrt, 'ayanamsha', 0.0)) or 0.0
            return val
    except Exception:
        pass
    return 0.0
def _ayan_ut(jd_ut, options):
    """Return ayanamsha(°) for given jd_ut if sidereal mode is on, else 0.0.

    NOTE:
    - Swiss Ephemeris sidereal mode is global, so set it here to be safe.
    - We intentionally use *_ut variants everywhere in this module.
    """
    try:
        if getattr(options, 'ayanamsha', 0) != 0:
            astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(options.ayanamsha), 0, 0)
            return float(astrology.effective_ayanamsha_ut(float(jd_ut), options.ayanamsha))
    except Exception:
        pass
    return 0.0

def _solve_segment_time(rt12, lam1_sid, lam2_sid, jd_start, key, calflag, options, iters=4,
                        phi_deg=None, use_exact_oa=False, chart_obj=None):
    def _years_for_arc(delta_oa):
        if _is_revolution_chart(chart_obj):
            return _revolution_years_for_arc(chart_obj, options, delta_oa)
        return delta_oa * key

    # Circumambulation is a symbolic direction on the radix/revolution
    # sphere. Its zodiac frame and obliquity therefore stay fixed at the
    # source chart epoch; the eventual event date must not drift the
    # ayanamsha used to measure the directed arc.
    ay = (
        _sidereal_offset_deg(chart_obj, options)
        if chart_obj is not None
        else _ayan_ut(jd_start, options)
    )
    if use_exact_oa and phi_deg is not None:
        eps = (
            float(chart_obj.obl[0])
            if chart_obj is not None and getattr(chart_obj, "obl", None)
            else _mean_obliquity_deg(jd_start)
        )
        delta_oa = _delta_oa_exact(phi_deg, lam1_sid, lam2_sid, ay, eps)
    else:
        delta_oa = _delta_oa_by_rt(rt12, lam1_sid, lam2_sid, ay)
    delta_years = _years_for_arc(delta_oa)
    jd_end = _jd_add_years(jd_start, delta_years, calflag)

    return delta_oa, delta_years, jd_end, ay

def _exact_aspect_hits(lam_start_abs, lam_end_abs, planet_lams, aspects=(0,60,90,120,180)):
    """
    lam_start_abs, lam_end_abs : 절대 경도(증가 단조)
    planet_lams : {"Venus": 123.45, ...} (0..360)
    반환: [(L_abs, planet, A), ...]  -- 세그먼트 내부(양끝 제외)만
    """
    hits = []
    if lam_end_abs <= lam_start_abs + 1e-12:
        return hits

    if isinstance(planet_lams, dict):
        iterable = [
            {
                'label': label,
                'lon': lon,
                'source': 'return',
                'source_marker': None,
            }
            for label, lon in planet_lams.items()
        ]
    else:
        iterable = list(planet_lams or [])

    for entry in iterable:
        if isinstance(entry, dict):
            label = entry.get('label')
            lp = entry.get('lon')
            source = entry.get('source')
            source_marker = entry.get('source_marker')
            planet_id = entry.get('planet_id')
        else:
            label, lp = entry
            source = 'return'
            source_marker = None
            planet_id = None
        lp = lp % 360.0
        for A in aspects:
            bases = [(lp - A) % 360.0]
            if A not in (0, 180):
                bases.append((lp + A) % 360.0)   # ±A 모두
            for base in bases:
                k_min = int(math.ceil((lam_start_abs - base) / 360.0))
                k_max = int(math.floor((lam_end_abs   - base) / 360.0))
                for k in range(k_min, k_max + 1):
                    L = base + 360.0 * k
                    if lam_start_abs + 1e-9 < L < lam_end_abs - 1e-9:  # 경계 제외
                        hits.append((L, label, A, source, source_marker, planet_id))
    hits.sort(key=lambda x: x[0])
    return hits

def _jd_add_years(jd0, years, calflag):
    return jd0 + float(years) * DAYS_PER_YEAR

def _years_since_birth(jd, jd_birth):
    yrs = (jd - jd_birth) / DAYS_PER_YEAR
    return 0.0 if yrs < 0 else yrs

def _is_revolution_chart(chrt):
    # Must stay in step with PrimDirs._uses_revolution_time(): the PD engine
    # decides the arc->time key, and the age limit computed here has to be
    # measured on the same clock.
    return getattr(chrt, 'htype', None) in (
        chart.Chart.SOLAR, chart.Chart.LUNAR, chart.Chart.REVOLUTION)

def _revolution_years_for_arc(chrt, options, arc):
    arc = float(arc)
    if getattr(chrt, 'htype', None) == chart.Chart.SOLAR:
        if getattr(options, 'pdrevsunyearmode', primdirs.PrimDirs.REVSOLAR_TROPICAL) == primdirs.PrimDirs.REVSOLAR_360:
            days = arc
        else:
            days = arc * (DAYS_PER_YEAR / 360.0)
        return days / DAYS_PER_YEAR
    # Mirrors PrimDirs.calcTimeRev(): every non-solar return uses the lunar
    # period coefficient.
    return arc * 0.0758333 / 360.0

def _max_age_years_for_chart(chrt, options, max_age_years):
    limit = float(max_age_years)
    if _is_revolution_chart(chrt):
        return min(limit, _revolution_years_for_arc(chrt, options, 360.0))
    return limit

def calibrate_key_with_anchor(phi, lam_start, lam_end, observed_years, ayan=0.0):

    """Return key so that ΔOA(rt(phi), lam_start→lam_end) * key == observed_years."""
    rt12 = _interp_rt12(phi)    
    doa  = _delta_oa_by_rt(rt12, lam_start%360.0, lam_end%360.0, ayan)

    if doa <= 0.0:
        return DEFAULT_KEY_Y_PER_DEG
    return float(observed_years) / doa
def _mean_obliquity_deg(jd):
    T = (jd - 2451545.0) / 36525.0
    eps = (84381.406
           - 46.836769*T
           - 0.0001831*T*T
           + 0.00200340*T**3
           - 5.76e-7*T**4
           - 4.34e-8*T**5) / 3600.0
    return eps


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def compute_distributions(chrt, options, start_lambda=None, key=DEFAULT_KEY_Y_PER_DEG,
                          max_rows=200, include_participating=True, max_age_years=150,
                          use_exact_oa=False, custom_significator=None,
                          natal_participator_chart=None, promissor_profile=None):
    """Route to the correct back-end depending on the OA method setting.

    use_exact_oa=True  (CIRCUM_OA_USE_PD):
        Delegates entirely to the Morinus PD engine (PlacidianSAPD).
        Circumambulations use the selected significator, the bounds stream, and
        the selected Follow PD or Traditional promissor/aspect profile.

    use_exact_oa=False (CIRCUM_OA_ASCENSIONAL_TIMES):
        Uses the traditional Hellenistic rising-times table (rt_0p5.txt).
        Original table-based implementation preserved below as
        _compute_distributions_ascensional_times().
    """
    profile = normalize_promissor_profile(
        promissor_profile if promissor_profile is not None else promissor_profile_from_options(options)
    )
    if use_exact_oa:
        return _compute_distributions_pd(
            chrt, options, max_rows=max_rows, max_age_years=max_age_years,
            custom_significator=custom_significator,
            natal_participator_chart=natal_participator_chart,
            promissor_profile=profile)
    else:
        normalized_sig = normalize_custom_significator(custom_significator)
        if normalized_sig is not None and start_lambda is None:
            start_lambda = normalized_sig["longitude"]
        return _compute_distributions_ascensional_times(
            chrt, options, start_lambda=start_lambda, key=key,
            max_rows=max_rows, include_participating=include_participating,
            max_age_years=max_age_years,
            natal_participator_chart=natal_participator_chart,
            promissor_profile=profile)


def _aspect_display_longitude(base_lon, aspect_deg, seg_start, seg_end, fallback_lon=None):
    try:
        base = util.normalize(float(base_lon))
        aspect = float(aspect_deg)
    except Exception:
        return fallback_lon

    if abs(aspect) <= 1e-9:
        return base
    if abs(aspect - 180.0) <= 1e-9:
        candidates = [util.normalize(base + 180.0)]
    else:
        candidates = [
            util.normalize(base + aspect),
            util.normalize(base - aspect),
        ]

    try:
        start = float(seg_start)
        end = float(seg_end)
    except Exception:
        start = 0.0
        end = 360.0
    eps = 1e-7
    for lon in candidates:
        if start <= end:
            if start - eps <= lon <= end + eps:
                return lon
        else:
            if lon >= start - eps or lon <= end + eps:
                return lon
    return candidates[0] if fallback_lon is None else fallback_lon


def _append_participator_pd_hits(pd_engine, target_chart, options, entries, custom_significator=None):
    custom_target = normalize_custom_significator(custom_significator) is not None
    aspect_indices = tuple(
        idx for idx, enabled in enumerate(getattr(pd_engine.options, "pdaspects", []) or [])
        if enabled and idx < len(chart.Chart.Aspects)
    )
    for entry in entries:
        label = str(entry.get("label") or "")
        lon = entry.get("lon")
        if not label or lon is None:
            continue
        try:
            point = customerpd.CustomerPD.from_ecliptic_longitude(
                lon,
                target_chart.place.lat,
                target_chart.houses.ascmc2,
                target_chart.obl[0],
                target_chart.raequasc,
                float(entry.get("lat", 0.0) or 0.0),
                _sidereal_offset_deg(target_chart, options),
            )
        except Exception:
            continue
        pd_engine._active_dynamic_prom_key = str(entry.get("key") or label)
        pd_engine._active_dynamic_prom_point = point
        try:
            if not custom_target:
                # toZodAscMC accepts chart-frame longitude and performs its own
                # tropical recovery before the cotransformation.
                pd_engine.circumDynamicPromissorAspects = True
                try:
                    pd_engine.toZodAscMC(lon, float(entry.get("lat", 0.0) or 0.0), primdirs.PrimDir.CUSTOMERPD, 0)
                finally:
                    pd_engine.circumDynamicPromissorAspects = False
                continue

            for aspect_idx in aspect_indices:
                aspect_deg = float(chart.Chart.Aspects[aspect_idx])
                signed_aspects = (aspect_deg,)
                if aspect_idx not in (chart.Chart.CONJUNCTIO, chart.Chart.OPPOSITIO):
                    signed_aspects = (aspect_deg, -aspect_deg)
                for signed_aspect in signed_aspects:
                    try:
                        aspect_point = customerpd.CustomerPD.from_ecliptic_longitude(
                            util.normalize(float(lon) + signed_aspect),
                            target_chart.place.lat,
                            target_chart.houses.ascmc2,
                            target_chart.obl[0],
                            target_chart.raequasc,
                            float(entry.get("lat", 0.0) or 0.0) if aspect_idx == chart.Chart.CONJUNCTIO else 0.0,
                            _sidereal_offset_deg(target_chart, options),
                        )
                    except Exception:
                        continue
                    pd_engine.toCustomer2(
                        False,
                        primdirs.PrimDir.CUSTOMERPD,
                        primdirs.PrimDir.NONE,
                        aspect_point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.RA],
                        aspect_point.speculums[primdirs.PrimDirs.PLACSPECULUM][customerpd.CustomerPD.ADLAT],
                        aspect_idx,
                        signed_aspect,
                        False,
                    )
        finally:
            pd_engine._active_dynamic_prom_key = None
            pd_engine._active_dynamic_prom_point = None
    pd_engine.pds.sort(key=lambda pd: pd.time)


def _compute_distributions_pd(chrt, options, max_rows=200, max_age_years=150,
                              custom_significator=None,
                              natal_participator_chart=None,
                              promissor_profile=primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD):
    """Compute circumambulation table by delegating to the Morinus PD engine.

    Circumambulations = PD with the selected significator, bounds, and the
    selected promissor/aspect profile (zodiacal).
    Arc→years conversion uses the same key (Naibod/Cardan/Ptolemy/Custom) and
    ayanamsha already set in options, so results align exactly with the PD table.
    """
    import copy
    import placidiansapd

    normalized_sig = normalize_custom_significator(custom_significator)
    participant_entries = _participating_longitude_entries(
        chrt, options, promissor_profile, natal=False,
    )
    if natal_participator_chart is not None and natal_participator_chart is not chrt:
        participant_entries.extend(_participating_longitude_entries(
            natal_participator_chart, options, promissor_profile, natal=True,
        ))
    participant_by_key = {entry["key"]: entry for entry in participant_entries}

    # Build effective options: ASC-only by default, or one dynamic custom
    # significator when the list was launched from a chart point.
    # All other settings (key, ayanamsha, subzodiacal, bianchini, secmotion…)
    # are inherited from the user's PD settings unchanged.
    eff = copy.copy(options)
    eff.sigangles = [False, False, False, False] if normalized_sig is not None else [True, False, False, False]
    if hasattr(eff, 'sigplanets'):
        try:
            eff.sigplanets = [False] * len(eff.sigplanets)
        except Exception:
            pass
    eff.sighouses = False
    eff.pdterms   = True
    eff.pdlof     = [False, False]
    eff.pdsyzygy  = False
    eff.pdsigchiron = False
    eff.pdsigvertex = False
    eff.pdsigarabicparts = False
    eff.pdcustomer2 = normalized_sig is not None
    eff.subzodiacal = primdirs.PrimDirs.SZNEITHER
    eff.subprimarydir = primdirs.PrimDirs.ZODIACAL
    eff.zodpromsigasps = [True, False]
    eff.bianchini = False
    eff.morin_excentric = False
    # Dynamic keys (True/Birthday Solar Arc) iterate ephemeris day-by-day per PD event
    # which makes the on-render term-lord overlay block the main thread. Fall back to
    # whichever static key (pdkeys) the user last had selected — Naibod/Cardan/Ptolemy/
    # Customer — so the display respects their choice without running the slow path.
    eff.pdkeydyn = False
    eff.promplanets = [False] * len(getattr(options, "promplanets", []) or [])
    eff.pdantiscia = False
    eff.pdmidpoints = False
    eff.pdfixstars = False
    eff.pdcustomer = False
    eff.pdpromchiron = False
    eff.pdpromarabicparts = False
    eff.ascmchcsasproms = False
    eff.pdcusppromissors = False
    eff._range_bounds_override = (0.0, float(max_age_years))
    eff._max_age_limit_override = float(max_age_years)
    if hasattr(eff, 'pdparallels'):
        eff.pdparallels = [False, False]

    enabled_asps = set(_participating_aspect_indices(options, promissor_profile))
    if hasattr(eff, 'pdaspects'):
        try:
            pdaspects = [False] * len(eff.pdaspects)
            for idx in enabled_asps:
                if 0 <= idx < len(pdaspects):
                    pdaspects[idx] = True
            eff.pdaspects = pdaspects
        except Exception:
            pass

    abort = primdirs.AbortPD()
    try:
        with _temporary_custom_significator(chrt, normalized_sig):
            pd_engine = placidiansapd.PlacidianSAPD(
                chrt, eff, primdirs.PrimDirs.RANGEALL, primdirs.PrimDirs.DIRECT, abort)
            _append_participator_pd_hits(
                pd_engine,
                chrt,
                options,
                participant_entries,
                custom_significator=normalized_sig,
            )
    except Exception as e:
        raise ValueError("PD engine error in circumambulation: %s" % e)

    # Simple PD stream: one significator only.
    if normalized_sig is None:
        sig_pds = [
            pd for pd in pd_engine.pds
            if pd.sig == primdirs.PrimDir.ASC and pd.direct
        ]
        start_lon = chrt.houses.ascmc[houses.Houses.ASC]
    else:
        sig_pds = [
            pd for pd in pd_engine.pds
            if (
                pd.sig == primdirs.PrimDir.CUSTOMERPD
                and getattr(pd, "sigdyn", None) in (_CIRCUM_SIG_KEY, "user_sig")
                and pd.direct
            )
        ]
        start_lon = normalized_sig["longitude"]
    sig_pds.sort(key=lambda pd: pd.arc)

    TERM_MIN = primdirs.PrimDir.TERM
    TERM_MAX = primdirs.PrimDir.TERM + 11        # 12 signs → TERM+0 … TERM+11

    def _unique_by(events, keyfunc):
        out = []
        seen = set()
        for ev in events:
            key = keyfunc(ev)
            if key in seen:
                continue
            seen.add(key)
            out.append(ev)
        return out

    # Root-cause normalization:
    # - term stream = true term-boundary events only (conjunction)
    # - collapse equivalent PD emissions to one event identity
    term_hits_raw = [
        pd for pd in sig_pds
        if TERM_MIN <= pd.prom <= TERM_MAX and int(pd.promasp) == chart.Chart.CONJUNCTIO
    ]
    term_hits = _unique_by(
        term_hits_raw,
        lambda pd: (int(pd.prom), int(pd.prom2), round(float(pd.arc), 10), round(float(pd.time), 8))
    )

    planet_hits_raw = []
    for pd in sig_pds:
        participant = participant_by_key.get(getattr(pd, "promdyn", None))
        if (
            pd.prom == primdirs.PrimDir.CUSTOMERPD
            and participant is not None
            and int(pd.promasp) in enabled_asps
        ):
            planet_hits_raw.append(pd)
    planet_hits = _unique_by(
        planet_hits_raw,
        lambda pd: (int(pd.prom), getattr(pd, 'promdyn', None), int(pd.promasp), round(float(pd.arc), 10), round(float(pd.time), 8))
    )

    if not term_hits:
        return []

    # Birth JD
    calflag = astrology.SE_GREG_CAL
    if chrt.time.cal == chart.Time.JULIAN:
        calflag = astrology.SE_JUL_CAL
    jd0 = astrology.swe_julday(chrt.time.year, chrt.time.month, chrt.time.day,
                                chrt.time.time, calflag)
    effective_max_age_years = _max_age_years_for_chart(chrt, options, max_age_years)
    jd_limit = jd0 + effective_max_age_years * DAYS_PER_YEAR

    # Term edges for lam_start/lam_end (kept from original helper)
    edges = sorted(_term_edges_deg(options), key=lambda e: e[0])

    # Find which term the selected significator falls in at birth.
    # ASC/custom point is already in the chart's chosen zodiac. The previous
    # subtraction applied the ayanamsha twice after Chart._zodiac_flags moved
    # sidereal conversion to the Swiss Ephemeris boundary.
    start_sid = util.normalize(float(start_lon))
    i0 = 0
    for idx, (a, b, _, _) in enumerate(edges):
        if a - 1e-9 <= start_sid < b + 1e-9:
            i0 = idx
            break

    rows = []
    prev_arc = 0.0
    prev_jd  = jd0
    prev_age = 0.0
    ph_ptr   = 0   # pointer into planet_hits list
    for k, th in enumerate(term_hits):
        if len(rows) >= max_rows:
            break
        if th.time > jd_limit + 1e-9:
            break

        edge = edges[(i0 + k) % len(edges)]
        edge_a, b, edge_ruler, _ = edge
        # The first period starts at the actual significator longitude, not
        # at the lower bound of the term it happens to occupy.
        a = start_sid if k == 0 else edge_a

        # Period k ruler: birth term ruler for k=0, else the ruler entered at hit k-1
        ruler_pid = edge_ruler if k == 0 else term_hits[k - 1].prom2

        g_start = _gregorian_date_in_radix_zone(prev_jd, chrt)
        g_end   = _gregorian_date_in_radix_zone(th.time,  chrt)
        dt_start = _gregorian_datetime_in_radix_zone(prev_jd, chrt)
        dt_end   = _gregorian_datetime_in_radix_zone(th.time, chrt)

        # Collect participating planet hits whose arc falls within this period
        participating = []
        seg_arc = max(th.arc - prev_arc, 0.0)
        seg_lon = (b - a) % 360.0
        while ph_ptr < len(planet_hits):
            ph = planet_hits[ph_ptr]
            if ph.arc > th.arc - 1e-9:
                break
            if ph.arc > prev_arc + 1e-9 and ph.time <= jd_limit + 1e-9:
                if seg_arc > 1e-12:
                    frac = (ph.arc - prev_arc) / seg_arc
                    if frac < 0.0:
                        frac = 0.0
                    elif frac > 1.0:
                        frac = 1.0
                else:
                    frac = 0.0
                aspect_deg  = chart.Chart.Aspects[ph.promasp] if 0 <= ph.promasp < len(chart.Chart.Aspects) else 0.0
                participant = participant_by_key.get(getattr(ph, "promdyn", None), {})
                fallback_lon = (a + seg_lon * frac) % 360.0
                lam_part = _aspect_display_longitude(
                    participant.get("lon"),
                    aspect_deg,
                    a,
                    b,
                    fallback_lon=fallback_lon,
                )
                participating.append({
                    'lam':     lam_part,
                    'lam_abs': ph.arc,
                    'planet':  participant.get("label") or planet_label(ph.prom),
                    'planet_id': participant.get("planet_id"),
                    'source':  participant.get("source") or "return",
                    'source_marker': participant.get("source_marker"),
                    'aspect':  aspect_deg,
                    'doa':     ph.arc,
                    'years':   ph.age,
                    'jd':      ph.time,
                    'date':    _gregorian_date_in_radix_zone(ph.time, chrt),
                    'datetime': _gregorian_datetime_in_radix_zone(ph.time, chrt),
                })
            ph_ptr += 1

        rows.append({
            'lam_start':      a % 360.0,
            'lam_end':        b % 360.0,
            'sign_idx':       _sign_index(a),
            'term_ruler_pid': ruler_pid,
            'delta_oa':       th.arc - prev_arc,
            'delta_years':    th.age - prev_age,
            'date_start':     g_start,
            'date_end':       g_end,
            'datetime_start': dt_start,
            'datetime_end':   dt_end,
            'age_start':      prev_age,
            'age_end':        th.age,
            'jd_start':       prev_jd,
            'jd_end':         th.time,
            'participating':  participating,
        })

        prev_arc = th.arc
        prev_jd  = th.time
        prev_age = th.age

    return rows


# ---------------------------------------------------------------------------
# Ascensional Times (rt_0p5.txt table) implementation
#
# NOTE: The following function was the original implementation written to
# compute circumambulation periods using a rising-times table read from an
# external file (rt_0p5.txt).  It is kept here as a reference and as the
# back-end for the "Ascensional Times" mode (CIRCUM_OA_ASCENSIONAL_TIMES).
#
# For the PD calculation method the code above (_compute_distributions_pd)
# delegates directly to the Morinus PD engine, which uses the exact same spherical
# trigonometry already trusted for all other primary directions in the application.
# ---------------------------------------------------------------------------

def _compute_distributions_ascensional_times(
        chrt, options, start_lambda=None, key=DEFAULT_KEY_Y_PER_DEG,
        max_rows=200, include_participating=True, max_age_years=150,
        natal_participator_chart=None,
        promissor_profile=primdirs.PrimDirs.CIRCUM_PROMISSORS_FOLLOW_PD):
    """
    Returns list of rows:
      - 'lam_start','lam_end','sign_idx','term_ruler_pid'
      - 'delta_oa','delta_years'
      - 'date_start','date_end'  (datetime.date)
      - 'participating' : [{'lam','planet','aspect','date'}, ...]
    """
    if start_lambda is None:
        start_lambda = chrt.houses.ascmc[houses.Houses.ASC]
    # ASC/custom point is already in the chart's chosen zodiac. Sidereal
    # conversion happens in Chart._zodiac_flags at chart construction.
    start_lambda = util.normalize(float(start_lambda))

    phi = chrt.place.lat
    rt12 = _interp_rt12(phi)
    edges = _term_edges_deg(options)

    calflag = astrology.SE_GREG_CAL
    if chrt.time.cal == chart.Time.JULIAN:
        calflag = astrology.SE_JUL_CAL
    jd0 = astrology.swe_julday(chrt.time.year, chrt.time.month, chrt.time.day, chrt.time.time, calflag)
    # --- Polar guard: 고위도(극권)에서는 전통적 분배(OA/RT)가 물리적으로 미정의 ---
    # 임계 위도 = 90° - ε  (ε: 출생 시점의 황도경사)
    eps_deg   = _mean_obliquity_deg(jd0)
    phi_limit = 90.0 - eps_deg  # ≈ 66.56° 부근
    # 경계 근처의 수치 진동을 막기 위해 아주 소폭(0.01°) 안쪽에서 컷
    if abs(phi) >= (phi_limit - 0.01):
        raise ValueError(mtexts.txts['CircumPolarLatErr'].format(abs(phi), phi_limit))

    effective_max_age_years = _max_age_years_for_chart(chrt, options, max_age_years)
    jd_limit = jd0 + effective_max_age_years * DAYS_PER_YEAR

    rows = []
    planet_lams = []
    if include_participating:
        planet_lams = _participating_longitude_entries(
            chrt, options, promissor_profile, natal=False,
        )
        if natal_participator_chart is not None and natal_participator_chart is not chrt:
            planet_lams.extend(_participating_longitude_entries(
                natal_participator_chart, options, promissor_profile, natal=True,
            ))
    aspect_degrees = _participating_aspect_degrees(options, promissor_profile)

    # 텀 경계 생성 + 정렬(시데리얼 경계는 -ayan 만큼 평행이동되어 있음)
    edges1 = sorted(edges, key=lambda t: t[0])  # edges는 위에서 _term_edges_deg(options, ayan)

    # start_lambda(0..360)를 경계가 놓인 '절대 링'으로 올림/내림
    base0 = edges1[0][0]  # 첫 경계의 절대 시작도수(예: 337°)
    start_abs = start_lambda
    while start_abs < base0 - 1e-9:
        start_abs += 360.0
    while start_abs >= base0 + 360.0 - 1e-9:
        start_abs -= 360.0

    # 포함 세그먼트 찾기: a ≤ start_abs < b
    i0 = None
    for idx, (a, b, _, _) in enumerate(edges1):
        if (a - 1e-9) <= start_abs < (b - 1e-9):
            i0 = idx
            break
    # 경계선(==b)에 정확히 걸려 있으면 다음 세그먼트로
    if i0 is None:
        for idx, (a, b, _, _) in enumerate(edges1):
            if abs(start_abs - b) <= 1e-9:
                i0 = (idx + 1) % len(edges1)
                break
    # 그래도 못 찾으면: start_abs 이후 첫 b(없으면 0)
    if i0 is None:
        i0 = min(range(len(edges1)), key=lambda i: ((edges1[i][1] - start_abs) % 360.0))


    # 진행 루프 (edges1을 원형으로 순회)
    lam_cursor = start_abs

    jd_cursor  = jd0
    idx = i0
    if jd_cursor < jd0:
        jd_cursor = jd0
    if jd_cursor >= jd_limit - 1e-9:
        return rows

        
    for _ in range(max_rows):
        if jd_cursor >= jd_limit - 1e-9:
            break
        a, b, pid, _sign_ignored = edges1[idx]
        seg_start = lam_cursor
        seg_end   = b

        delta_oa, delta_year, jd_next, ayan_used = _solve_segment_time(
            rt12, seg_start, seg_end, jd_cursor, key, calflag, options,
            phi_deg=phi, use_exact_oa=False, chart_obj=chrt
        )
        if delta_oa <= 1e-9:
            # ★ 0길이 구간이라도 '텀 진입 시점'이 UI에 보이도록 마커 행을 추가한다.
            g0 = _gregorian_date_in_radix_zone(jd_cursor, chrt)
            dt0 = _gregorian_datetime_in_radix_zone(jd_cursor, chrt)
            rows.append({
                'lam_start': seg_start % 360.0,                   # 표시용: 시데리얼 그대로
                'lam_end':   seg_end   % 360.0,
                'sign_idx':  _sign_index(seg_start),              # 시데리얼 사인 인덱스
                'term_ruler_pid': pid,
                'delta_oa':  0.0,
                'delta_years': 0.0,
                'date_start': g0,
                'datetime_start': dt0,
                'age_start': _years_since_birth(jd_cursor, jd0),
                'age_end':   _years_since_birth(jd_cursor, jd0),
                'date_end':  g0,
                'datetime_end': dt0,
                'jd_start':  jd_cursor,
                'jd_end':    jd_cursor,
                'participating': []
            })
            # 다음 세그먼트로 진행
            lam_cursor = seg_end
            idx = (idx + 1) % len(edges1)
            continue

        # ★ rows.append에서 쓰일 시작/끝 날짜 + participatings를 먼저 계산
        y0, m0, d0, h0 = astrology.swe_revjul(jd_cursor, calflag)
        y1, m1, d1, h1 = astrology.swe_revjul(jd_next,   calflag)
        age_start_years = _years_since_birth(jd_cursor, jd0)
        age_end_years   = _years_since_birth(jd_next,   jd0)
        # 표시용 날짜는 항상 Gregorian으로 변환 (Julian 출생이라도 음수/역전 방지)
        g0 = _gregorian_date_in_radix_zone(jd_cursor, chrt)
        g1 = _gregorian_date_in_radix_zone(jd_next,   chrt)
        dt0 = _gregorian_datetime_in_radix_zone(jd_cursor, chrt)
        dt1 = _gregorian_datetime_in_radix_zone(jd_next, chrt)

        participants = []
        if include_participating and planet_lams:
            hits = _exact_aspect_hits(seg_start, seg_end, planet_lams, aspects=aspect_degrees)
            for L, label, A, source, source_marker, planet_id in hits:
                doa, yrs, jd, _ay_hit = _solve_segment_time(
                    rt12, seg_start, L, jd_cursor, key, calflag, options,
                    phi_deg=phi, use_exact_oa=False, chart_obj=chrt
                )
                if jd > jd_limit + 1e-9:
                    continue
                gP = _gregorian_date_in_radix_zone(jd, chrt)
                ageP = _years_since_birth(jd, jd0)
                participants.append({
                    'lam':   L % 360.0,            # 표시용: 시데리얼 그대로
                    'lam_abs': L,
                    'planet': label,
                    'planet_id': planet_id,
                    'source': source,
                    'source_marker': source_marker,
                    'aspect': A,
                    'doa':   doa,
                    'years': ageP,
                    'jd':    jd,
                    'date':  gP,
                    'datetime': _gregorian_datetime_in_radix_zone(jd, chrt),
                })

        # ★ 150세 컷: 부분 구간으로 잘라 1줄 추가하고 종료
        if jd_next > jd_limit + 1e-9:
            if _is_revolution_chart(chrt):
                break
            remain_years = max(0.0, (jd_limit - jd_cursor) / DAYS_PER_YEAR)
            rem_doa = remain_years / max(key, 1e-12)

            # 표시용 사인 인덱스(시데리얼)과, RT 선택용 사인 인덱스(트로피컬)를 분리
            sign_from_start_sid = _sign_index(seg_start)           # 시데리얼(표시)
            ayan_cap = _sidereal_offset_deg(chrt, options)
            sign_from_start_tro = _sign_index(seg_start + ayan_cap)    # 트로피컬(RT용)

            rt_sign = rt12[sign_from_start_tro]
            lam_end_cap = seg_start + (rem_doa / max(rt_sign, 1e-12)) * 30.0

            # 표시용 date_end는 컷 시점(jd_limit)을 라딕스 민법 시각대 기준으로
            gCut = _gregorian_date_in_radix_zone(jd_limit, chrt)

            rows.append({
                'lam_start': seg_start   % 360.0,
                'lam_end':   lam_end_cap % 360.0,
                'sign_idx':  sign_from_start_sid,
                'term_ruler_pid': pid,
                'delta_oa':  rem_doa,
                'delta_years': remain_years,
                'date_start':  g0,
                'datetime_start': dt0,
                'age_start': age_start_years,
                'age_end':   _years_since_birth(jd_limit, jd0),
                'date_end':    gCut,
                'datetime_end': _gregorian_datetime_in_radix_zone(jd_limit, chrt),
                'jd_start':  jd_cursor,
                'jd_end':    jd_limit,
                'participating': participants
            })
            break

        else:
            # 정상 케이스: 한 텀 전체를 행으로 추가
            sign_from_start = _sign_index(seg_start)               # 시데리얼(표시)
            rows.append({
                'lam_start': seg_start % 360.0,                    # 표시용: 시데리얼 그대로
                'lam_end':   seg_end   % 360.0,
                'sign_idx':  sign_from_start,
                'term_ruler_pid': pid,
                'delta_oa':  delta_oa,
                'delta_years': delta_year,
                'date_start': g0,
                'datetime_start': dt0,
                'age_start': age_start_years,
                'age_end':   age_end_years,
                'date_end':   g1,
                'datetime_end': dt1,
                'jd_start':  jd_cursor,
                'jd_end':    jd_next,
                'participating': participants
            })

            # ★ 다음 세그먼트로 진행
            lam_cursor = seg_end
            jd_cursor  = jd_next
            idx = (idx + 1) % len(edges1)

    return rows

def planet_label(pid):
    base10 = [u"Sun", u"Moon", u"Mercury", u"Venus", u"Mars", u"Jupiter", u"Saturn",
              u"Uranus", u"Neptune", u"Pluto"]
    five   = [u"Mercury", u"Venus", u"Mars", u"Jupiter", u"Saturn"]
    try:
        x = int(pid)
    except Exception:
        return str(pid)
    if 0 <= x < len(base10):  # SwissEph 스타일
        return base10[x]
    if 0 <= x < 5:            # 5행성 전용
        return five[x]
    return str(pid)

