# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

from __future__ import division
import datetime
import math
from collections import OrderedDict
import astrology  # sweastrology 래퍼
import geonames
import util       # decToDeg 등
import mtexts     # user-facing label localization (resolved at serve time)

SEFLG = astrology.SEFLG_SWIEPH
# --- 스캔 토글 ---
ENABLE_SOLAR_SCAN = True
USE_GLOB_SOLAR    = True

# 굵게 처리: 개기일식/금환/혼성, 개기월식
SOLAR_BOLD_FLAGS = (
    astrology.SE_ECL_TOTAL | astrology.SE_ECL_ANNULAR | astrology.SE_ECL_ANNULAR_TOTAL
)
LUNAR_BOLD_FLAGS = astrology.SE_ECL_TOTAL
_SAROS_UNSET = u'—'
SAROS_PERIOD_DAYS = 6585.3211
ECLIPSE_CHART_MOMENT_EXACT = 'exact_conjunction'
ECLIPSE_CHART_MOMENT_MAXIMUM = 'eclipse_maximum'

_RECENT_ECLIPSE_CHUNK_DAYS = 45.0
_RECENT_ECLIPSE_LOOKBACK_DAYS = 400.0
_RECENT_ECLIPSE_CACHE_MAX = 48
_RECENT_ECLIPSE_CACHE = OrderedDict()


class EclipseEvent(object):
    __slots__ = ("jdut", "is_solar", "retflag", "elon", "elat", "decl",
                 "dodek_deg", "dodek_sign", "dodek_d", "dodek_m", "dodek_s",
                 "saros", "bold")

    def __init__(self):
        self.jdut = 0.0
        self.is_solar = True
        self.retflag = 0
        self.elon = 0.0
        self.elat = 0.0
        self.decl = 0.0
        self.dodek_deg = 0.0
        self.dodek_sign = 0
        self.dodek_d = 0
        self.dodek_m = 0
        self.dodek_s = 0
        self.saros = u'—'
        self.bold = False

# 정밀 양자화/경계 상수
_ARCSEC_360 = 360 * 3600
_ARCSEC_30  = 30  * 3600
_EPS        = 1e-9          # 경계 보정(부동소수 오류 방지용)

def _normalize_deg(x):
    """[0,360)로 정규화. 360.0000…은 0으로 클램프."""
    t = float(x) % 360.0
    if t < 0.0:
        t += 360.0
    # 359°59′59.9996″ 같은 경우 360°로 튀는 걸 0으로 내림
    if t >= 360.0 - 1e-10:
        t = 0.0
    return t

def _q_arcsec(x_deg, full_circle_arcsec=_ARCSEC_360):
    """
    최종 한 번만 반올림: arcsec = floor(x*3600 + 0.5 - EPS)
    그 뒤 모듈러와 캐리로 DMS 분해.
    """
    asec = int(math.floor(x_deg * 3600.0 + 0.5 - _EPS))
    # 360°나 30° 경계에서 0으로 접힘
    if full_circle_arcsec is not None:
        asec %= full_circle_arcsec
    d = asec // 3600
    m = (asec % 3600) // 60
    s = asec % 60
    return d, m, s, asec  # asec도 돌려줌(도데 사인 계산 때 씀)

def _dms(angle_deg):
    """
    경도/황경 등 [0,360)용 DMS. (정규화→단일 양자화→캐리)
    """
    t = _normalize_deg(angle_deg)
    d, m, s, _ = _q_arcsec(t, _ARCSEC_360)
    return d, m, s

def _dms_signed(angle_deg):
    """
    위도/적위처럼 부호 있는 값: 부호는 따로 두고 절댓값만 양자화.
    """
    sign_neg = (angle_deg < 0)
    d, m, s, _ = _q_arcsec(abs(angle_deg), None)  # 부호값에는 360모듈러 없음
    return ('−' if sign_neg else '+'), d, m, s

def _dodek_from_ecliptic(lon_deg):
    """
    도데카테모리온: (사인 내 위치 × 12)을 전체 원에 투영.
    ★ 핵심: 중간에 절대 '라운딩'하지 않고, 맨 마지막에 한 번만 양자화.
    """
    L = _normalize_deg(lon_deg)
    base_sign = int(math.floor((L + 1e-12) / 30.0))  # 경계에서 사인 흔들림 방지
    pos_in_sign = L - base_sign * 30.0               # [0,30)

    # 사인 내 위치 × 12 → 전체 원에 투영 후 [0,360) 정규화
    proj = (pos_in_sign * 12.0)
    Ld_total = _normalize_deg(base_sign * 30.0 + proj)

    # 최종 한 번만 양자화
    # 먼저 '도데 사인'을 결정하고, 그 사인 내부의 도/분/초를 구함
    s2 = int(math.floor((Ld_total + 1e-12) / 30.0)) % 12
    within = Ld_total - s2 * 30.0                    # [0,30)
    d2, m2, s2sec, asec = _q_arcsec(within, _ARCSEC_30)
    # 드물게 30°00′00″으로 양자화될 수 있는데, 위에서 모듈러로 이미 0 처리됨

    return Ld_total, s2, d2, m2, s2sec

def _angnorm180(x):
    x = (x + 180.0) % 360.0
    if x < 0:
        x += 360.0
    return x - 180.0

def _moon_sun_lon(jd):
    mlon, _, _ = _calc3(jd, astrology.SE_MOON, SEFLG)
    slon, _, _ = _calc3(jd, astrology.SE_SUN,  SEFLG)
    return mlon % 360.0, slon % 360.0

def _dlon_m_minus_s(jd):
    mlon, slon = _moon_sun_lon(jd)
    return _angnorm180(mlon - slon)  # 합삭에서 0°


def _phase_error(jd, target_deg):
    mlon, slon = _moon_sun_lon(jd)
    return _angnorm180((mlon - slon) - float(target_deg))


def syzygy_jdut_near(jdut, is_solar=True, search_days=0.75):
    """Return exact geocentric syzygy JD UT near an eclipse maximum.

    Swiss Ephemeris eclipse search returns maximum eclipse time. A chart opened
    for the eclipse should use the exact Sun-Moon conjunction/opposition so the
    zodiacal longitudes are exact in the geocentric chart.
    """
    try:
        center = float(jdut)
    except Exception:
        return jdut
    target = 0.0 if bool(is_solar) else 180.0
    span = abs(float(search_days))
    step = min(0.02, max(0.002, span / 40.0))
    a = center - span
    fa = _phase_error(a, target)
    best_pair = None
    best_score = abs(fa)
    best_t = a
    t = a + step
    while t <= center + span + 1e-12:
        ft = _phase_error(t, target)
        if abs(ft) < best_score:
            best_score = abs(ft)
            best_t = t
        if fa == 0.0:
            return a
        if fa * ft <= 0.0:
            best_pair = (a, t, fa, ft)
            break
        a, fa = t, ft
        t += step
    if best_pair is None:
        return best_t
    lo, hi, flo, fhi = best_pair
    for _ in range(80):
        mid = (lo + hi) / 2.0
        fm = _phase_error(mid, target)
        if abs(fm) < 1e-10 or (hi - lo) < 1e-10:
            return mid
        if flo * fm <= 0.0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2.0


def syzygy_jdut_for_event(event):
    if event is None:
        return None
    return syzygy_jdut_near(getattr(event, 'jdut', 0.0), getattr(event, 'is_solar', True))


def chart_moment_jdut_for_event(event, mode=ECLIPSE_CHART_MOMENT_EXACT):
    if event is None:
        return None
    if mode == ECLIPSE_CHART_MOMENT_MAXIMUM:
        return float(getattr(event, 'jdut', 0.0))
    return syzygy_jdut_for_event(event)


def eclipse_zodiac_longitude(event):
    """Return the eclipsed Moon's tropical longitude at exact syzygy."""
    exact_jd = syzygy_jdut_for_event(event)
    if exact_jd is None:
        return None
    moon_lon, _sun_lon = _moon_sun_lon(float(exact_jd))
    return _normalize_deg(moon_lon)


def selected_prenatal_eclipse_point(chart, options=None):
    """Return the configured prenatal eclipse and its chart-zodiac longitude.

    This is the canonical semantic-point resolver shared by chart export,
    Search, Aspect List, Astrocartography, and inspectors.  Wheel visibility is
    intentionally not consulted here.
    """
    opts = options if options is not None else getattr(chart, 'options', None)
    mode = str(getattr(opts, 'prenatal_eclipse_mode', 'solar_and_lunar'))
    solar_only = mode == 'solar_only'
    ayanamsha = int(getattr(opts, 'ayanamsha', 0) or 0)
    try:
        anchor_jd = round(float(chart.time.jd), 9)
    except Exception:
        anchor_jd = None
    cache_key = (anchor_jd, mode, ayanamsha)
    cached = getattr(chart, 'selectedPrenatalEclipsePointCache', None)
    if isinstance(cached, tuple) and len(cached) == 2 and cached[0] == cache_key:
        return cached[1]
    event = most_recent_eclipse(chart, solar_only=solar_only)
    if event is None:
        return None
    exact_jd = float(syzygy_jdut_for_event(event))
    longitude = float(eclipse_zodiac_longitude(event))
    if ayanamsha:
        longitude = util.normalize(
            longitude - astrology.effective_ayanamsha_ut(exact_jd, ayanamsha)
        )
    result = (event, exact_jd, util.normalize(longitude))
    try:
        chart.selectedPrenatalEclipsePointCache = (cache_key, result)
    except Exception:
        pass
    return result


def eclipse_kind_label(event):
    try:
        if bool(getattr(event, 'is_solar', False)):
            token, _major, _priority = _classify_solar_from_retflag(
                int(getattr(event, 'retflag', 0))
            )
        else:
            token, _major, _priority = _classify_lunar_from_retflag(
                int(getattr(event, 'retflag', 0))
            )
    except Exception:
        token = 'UNKNOWN'
    key, fallback = {
        'TOTAL': ('EclipseTotal', u'Total'),
        'ANNULAR': ('EclipseAnnular', u'Annular'),
        'HYBRID': ('EclipseHybrid', u'Hybrid'),
        'PARTIAL': ('EclipsePartial', u'Partial'),
        'PENUMBRAL': ('EclipsePenumbral', u'Penumbral'),
        'UNKNOWN': ('EclipseUnknown', u'Unknown'),
        'NONE': ('EclipseUnknown', u'Unknown'),
    }.get(str(token), ('EclipseUnknown', u'Unknown'))
    return str(mtexts.txts.get(key, fallback))


def eclipse_event_label(event):
    luminary = mtexts.txts.get(
        'EclipseSolar' if bool(getattr(event, 'is_solar', False)) else 'EclipseLunar',
        u'Solar' if bool(getattr(event, 'is_solar', False)) else u'Lunar',
    )
    return str(mtexts.txts.get(
        'EclipseLabelFormat', u'{kind} {luminary} Eclipse'
    ).format(kind=eclipse_kind_label(event), luminary=luminary))

def _find_new_moons(jd_from, jd_to):
    """일 단위로 부호 변화를 잡아 합삭(신월)을 이분법으로 정밀화."""
    t = jd_from - 2.0
    valsafe = _dlon_m_minus_s(t)
    out = []
    MAX_IT = 40
    while t < jd_to + 2.0:
        t2 = t + 1.0
        v2 = _dlon_m_minus_s(t2)
        if valsafe == 0.0 or valsafe * v2 <= 0.0:
            a, b = t, t2
            fa, fb = valsafe, v2
            # bisection
            for _ in range(MAX_IT):
                m = 0.5*(a+b)
                fm = _dlon_m_minus_s(m)
                if abs(fm) < 1e-4 or (b - a) < 1e-5:
                    out.append(m)
                    break
                # 부호가 바뀌는 구간을 유지
                if fa * fm <= 0.0:
                    b, fb = m, fm
                else:
                    a, fa = m, fm
            # 다음 탐색은 이번 신월을 건너뛰고 진행
            t = t2 + 0.5
            valsafe = _dlon_m_minus_s(t)
            continue
        t = t2
        valsafe = v2
    return out

def _swe_attr_from_result(res):
    if not isinstance(res, tuple):
        return None
    for item in res:
        if (
            isinstance(item, (list, tuple)) and
            len(item) >= 11 and
            all(isinstance(v, (int, float)) for v in item[:11])
        ):
            return item
    return None


def _saros_label_from_swe_attr(attr):
    if not attr or len(attr) <= 10:
        return _SAROS_UNSET
    try:
        series = int(round(float(attr[9])))
        member = int(round(float(attr[10])))
    except Exception:
        return _SAROS_UNSET
    if series <= 0 or member <= 0:
        return _SAROS_UNSET
    return u'%d/%d' % (series, member)


def _eclipse_event_from_swe(jdut, is_solar, retflag, attr=None):
    ev = EclipseEvent()
    ev.jdut = float(jdut)
    ev.is_solar = bool(is_solar)
    ev.retflag = _flag_int(retflag)
    elon, elat, decl = _moon_geo_ecl_equ(ev.jdut)
    ev.elon, ev.elat, ev.decl = elon, elat, decl
    Ld, s2, d2, m2, s2sec = _dodek_from_ecliptic(elon)
    ev.dodek_deg = Ld; ev.dodek_sign = s2
    ev.dodek_d, ev.dodek_m, ev.dodek_s = d2, m2, s2sec
    ev.saros = _saros_label_from_swe_attr(attr)
    ev.bold = False
    return ev


def _solar_saros_label_from_swe(jdut):
    try:
        res = astrology.swe_sol_eclipse_where(float(jdut), SEFLG)
    except Exception:
        return _SAROS_UNSET
    return _saros_label_from_swe_attr(_swe_attr_from_result(res))


def _lunar_saros_label_from_swe(jdut):
    try:
        res = astrology.swe_lun_eclipse_how(float(jdut), SEFLG, 0.0, 0.0, 0.0)
    except Exception:
        return _SAROS_UNSET
    return _saros_label_from_swe_attr(_swe_attr_from_result(res))


def _assign_saros(event):
    if event is None:
        return
    if getattr(event, 'is_solar', False):
        event.saros = _solar_saros_label_from_swe(getattr(event, 'jdut', 0.0))
    else:
        event.saros = _lunar_saros_label_from_swe(getattr(event, 'jdut', 0.0))


def saros_series_member(label):
    if label in (None, '', _SAROS_UNSET):
        return None
    try:
        parts = str(label).split('/')
        if len(parts) != 2:
            return None
        series = int(parts[0])
        member = int(parts[1])
    except Exception:
        return None
    if series <= 0 or member <= 0:
        return None
    return series, member


def first_saros_event(event, search_days=80.0):
    parsed = saros_series_member(getattr(event, 'saros', None))
    if parsed is None:
        return None
    series, member = parsed
    if member <= 1:
        return event
    try:
        approx_jd = float(getattr(event, 'jdut', 0.0)) - (float(member - 1) * SAROS_PERIOD_DAYS)
    except Exception:
        return None

    candidates = _dedup_eclipse_events(None, approx_jd - float(search_days), approx_jd + float(search_days))
    best = None
    best_delta = None
    for candidate in candidates:
        if bool(getattr(candidate, 'is_solar', False)) != bool(getattr(event, 'is_solar', False)):
            continue
        if getattr(candidate, 'saros', None) in (None, '', _SAROS_UNSET):
            _assign_saros(candidate)
        if saros_series_member(getattr(candidate, 'saros', None)) != (series, 1):
            continue
        delta = abs(float(getattr(candidate, 'jdut', 0.0)) - approx_jd)
        if best is None or delta < best_delta:
            best = candidate
            best_delta = delta
    return best


def saros_series_events(event, search_days=80.0, max_members=100):
    """Return every Swiss-Ephemeris member of ``event``'s Saros series.

    Solar and lunar Saros numbers overlap, so the event's kind remains part of
    the identity.  Each member is resolved in a small window around the
    canonical Saros-period estimate; this reuses the normal Swiss eclipse
    builders without scanning the intervening fourteen centuries.
    """
    parsed = saros_series_member(getattr(event, 'saros', None))
    if parsed is None:
        return []
    series, _member = parsed
    first = first_saros_event(event, search_days=search_days)
    if first is None:
        return []
    is_solar = bool(getattr(event, 'is_solar', False))
    if (
        bool(getattr(first, 'is_solar', False)) != is_solar or
        saros_series_member(getattr(first, 'saros', None)) != (series, 1)
    ):
        return []

    out = [first]
    first_jd = float(getattr(first, 'jdut', 0.0))
    member_limit = max(1, min(200, int(max_members)))
    for member in range(2, member_limit + 1):
        approx_jd = first_jd + float(member - 1) * SAROS_PERIOD_DAYS
        if is_solar:
            retflag, tret = _sol_when_glob(approx_jd - 10.0)
        else:
            retflag, tret = _lun_when(approx_jd - 10.0)
        try:
            event_jd = float(tret[0])
        except (TypeError, ValueError, IndexError):
            break
        if not math.isfinite(event_jd) or abs(event_jd - approx_jd) > abs(float(search_days)):
            break
        if is_solar:
            _where_retflag, attr = _sol_where_try(event_jd)
        else:
            try:
                attr = _swe_attr_from_result(
                    astrology.swe_lun_eclipse_how(event_jd, SEFLG, 0.0, 0.0, 0.0)
                )
            except Exception:
                attr = None
        candidate = _eclipse_event_from_swe(event_jd, is_solar, retflag, attr)
        if saros_series_member(getattr(candidate, 'saros', None)) != (series, member):
            break
        out.append(candidate)
    return out


def _utc_tuple_from_jdut(jdut):
    y, m, d, h = astrology.swe_revjul(jdut, astrology.SE_GREG_CAL)
    hh = int(h)
    mm = int((h - hh) * 60.0)
    ss = int(round(((h - hh) * 60.0 - mm) * 60.0))
    if ss == 60:
        ss = 0; mm += 1
    if mm == 60:
        mm = 0; hh += 1
    return y, m, d, hh, mm, ss


def _zone_fields_from_local_datetime(local_dt):
    try:
        total_offset = local_dt.utcoffset()
        dst_offset = local_dt.dst()
    except Exception:
        return None
    if total_offset is None:
        return None
    if dst_offset is None:
        dst_offset = datetime.timedelta(0)
    total_minutes = int(total_offset.total_seconds() // 60)
    dst_minutes = int(dst_offset.total_seconds() // 60)
    standard_minutes = total_minutes - dst_minutes
    plus = standard_minutes >= 0
    absolute_minutes = abs(standard_minutes)
    return {
        'plus': plus,
        'zh': absolute_minutes // 60,
        'zm': absolute_minutes % 60,
        'daylightsaving': dst_minutes != 0,
    }


def _timezone_name_for_chart(chart):
    t = getattr(chart, 'time', None)
    tzid = getattr(t, 'tzid', '') or ''
    if tzid:
        return tzid
    place = getattr(chart, 'place', None)
    if place is None:
        return ''
    try:
        return geonames.Geonames.get_timezone_name(place.lon, place.lat) or ''
    except Exception:
        return ''


def _local_datetime_tuple_and_context_from_zoneinfo(jdut, chart):
    zoneinfo_cls = getattr(geonames, 'ZoneInfo', None)
    if zoneinfo_cls is None:
        return None
    t = getattr(chart, 'time', None)
    if t is None or getattr(t, 'bc', False):
        return None
    if int(getattr(t, 'cal', 0)) != 0:
        return None
    if int(getattr(t, 'zt', 0)) != 0:
        return None
    tzid = _timezone_name_for_chart(chart)
    if not tzid:
        return None
    y, m, d, hh, mm, ss = _utc_tuple_from_jdut(jdut)
    try:
        utc_dt = datetime.datetime(
            int(y), int(m), int(d), int(hh), int(mm), int(ss),
            tzinfo=datetime.timezone.utc,
        )
        local_dt = utc_dt.astimezone(zoneinfo_cls(tzid))
    except Exception:
        return None
    zone_fields = _zone_fields_from_local_datetime(local_dt)
    if zone_fields is None:
        return None
    context = {
        'zt': 0,
        'plus': zone_fields['plus'],
        'zh': zone_fields['zh'],
        'zm': zone_fields['zm'],
        'daylightsaving': zone_fields['daylightsaving'],
        'tzid': tzid,
        'tzauto': False,
    }
    return (
        int(local_dt.year), int(local_dt.month), int(local_dt.day),
        int(local_dt.hour), int(local_dt.minute), int(local_dt.second),
    ), context


def _time_context_from_chart(chart):
    t = getattr(chart, 'time', None)
    if t is None:
        return {}
    return {
        'zt': getattr(t, 'zt', 0),
        'plus': bool(getattr(t, 'plus', True)),
        'zh': int(abs(getattr(t, 'zh', 0) or 0)),
        'zm': int(abs(getattr(t, 'zm', 0) or 0)),
        'daylightsaving': bool(getattr(t, 'daylightsaving', False)),
        'tzid': getattr(t, 'tzid', '') or '',
        'tzauto': False,
    }


def local_datetime_tuple_and_context(jdut, chart):
    zone_result = _local_datetime_tuple_and_context_from_zoneinfo(jdut, chart)
    if zone_result is not None:
        return zone_result
    off = _tz_offset_hours(chart)
    jd_local = float(jdut) + off / 24.0
    y, m, d, h = astrology.swe_revjul(jd_local, _calflag(chart))
    hh = int(h)
    mm = int((h - hh) * 60.0)
    ss = int(round(((h - hh) * 60.0 - mm) * 60.0))
    if ss == 60:
        ss = 0
        mm += 1
    if mm == 60:
        mm = 0
        hh += 1
    return (int(y), int(m), int(d), int(hh), int(mm), int(ss)), _time_context_from_chart(chart)


def local_datetime_tuple(jdut, chart):
    values, _context = local_datetime_tuple_and_context(jdut, chart)
    return values


def _calc3(jdut, ipl, flags):
    """
    swe_calc_ut → ((retflag), (xx0..xx5), (serr)) 형태를 기본으로 가정하고
    (lon, lat, dist)를 꺼낸다. 다른 변종도 방어.
    """
    r = astrology.swe_calc_ut(jdut, ipl, flags)

    # 표준(이 프로젝트 pyd): ((retflag), (xx[0..5]), (serr))
    if isinstance(r, tuple) and len(r) >= 2 and isinstance(r[1], (list, tuple)):
        xx = r[1]
        lon = float(xx[0]) if len(xx) > 0 else 0.0
        lat = float(xx[1]) if len(xx) > 1 else 0.0
        dist = float(xx[2]) if len(xx) > 2 else 0.0
        return lon, lat, dist

    # 다른 변종(혹시): (xx, something) 또는 (lon,lat,dist,...) 직접값
    if isinstance(r, tuple) and len(r) >= 1 and isinstance(r[0], (list, tuple)):
        xx = r[0]
        lon = float(xx[0]) if len(xx) > 0 else 0.0
        lat = float(xx[1]) if len(xx) > 1 else 0.0
        dist = float(xx[2]) if len(xx) > 2 else 0.0
        return lon, lat, dist

    if isinstance(r, (list, tuple)) and len(r) >= 3 and all(isinstance(v, (int, float)) for v in r[:3]):
        return float(r[0]), float(r[1]), float(r[2])

    return 0.0, 0.0, 0.0


def _moon_geo_ecl_equ(jdut):
    # 황도 경도/위도
    lon, lat, _ = _calc3(jdut, astrology.SE_MOON, SEFLG)
    # 적위
    _ra, decl, _ = _calc3(jdut, astrology.SE_MOON, SEFLG | astrology.SEFLG_EQUATORIAL)
    return lon, lat, decl


def _equatorial_ra_dec(jdut, ipl):
    ra, dec, _ = _calc3(jdut, ipl, SEFLG | astrology.SEFLG_EQUATORIAL)
    return float(ra), float(dec)


def _angular_sep_deg(ra1_deg, dec1_deg, ra2_deg, dec2_deg):
    a1 = math.radians(float(ra1_deg))
    d1 = math.radians(float(dec1_deg))
    a2 = math.radians(float(ra2_deg))
    d2 = math.radians(float(dec2_deg))
    cossep = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    cossep = max(-1.0, min(1.0, cossep))
    return math.degrees(math.acos(cossep))


def _pheno_attr(jdut, ipl):
    try:
        res = astrology.swe_pheno_ut(float(jdut), int(ipl), int(SEFLG))
    except Exception:
        return []

    if isinstance(res, tuple):
        for item in res:
            if isinstance(item, (list, tuple)) and len(item) >= 5 and isinstance(item[0], (int, float)):
                return [float(v) for v in item]
    return []


def _safe_apparent_radius_deg(jdut, ipl):
    attr = _pheno_attr(jdut, ipl)
    if len(attr) >= 4:
        try:
            diameter = abs(float(attr[3]))
            if diameter > 0.0:
                return diameter / 2.0
        except Exception:
            pass
    return 0.0


def _classify_solar_from_geometry(jdut):
    ra_sun, dec_sun = _equatorial_ra_dec(jdut, astrology.SE_SUN)
    ra_moon, dec_moon = _equatorial_ra_dec(jdut, astrology.SE_MOON)
    sep = _angular_sep_deg(ra_sun, dec_sun, ra_moon, dec_moon)
    rs = _safe_apparent_radius_deg(jdut, astrology.SE_SUN)
    rm = _safe_apparent_radius_deg(jdut, astrology.SE_MOON)
    beta = abs(_moon_lat(jdut))

    if rs <= 0.0 or rm <= 0.0:
        return 0

    overlap_limit = rs + rm
    if sep > (overlap_limit + 0.1):
        if beta <= 1.6 and abs(_dlon_m_minus_s(jdut)) <= 1.5:
            return astrology.SE_ECL_PARTIAL
        return 0

    if sep <= abs(rm - rs):
        if abs(rm - rs) <= 0.01:
            return astrology.SE_ECL_ANNULAR_TOTAL
        return astrology.SE_ECL_TOTAL if rm >= rs else astrology.SE_ECL_ANNULAR

    return astrology.SE_ECL_PARTIAL


def _unify_when_glob_result(res):
    """
    어떤 빌드든 (retflag, tret)을 뽑아낸다.
    - tret 후보: 길이 10 이상인 시각배열, 없으면 첫 번째 수치 시퀀스
    - retflag 후보: 정수 또는 길이 1의 시퀀스
    실패 시 (0, (nan,)) 반환
    """
    import math
    if not isinstance(res, tuple):
        return 0, (float('nan'),)

    tret = None
    rf = None

    # 1) 길이 10+ 인 시퀀스를 우선 tret로
    for item in res:
        if isinstance(item, (list, tuple)) and len(item) >= 10 and all(isinstance(x, (int, float)) for x in item[:10]):
            tret = item
            break

    # 2) 없으면 수치 시퀀스 아무거나
    if tret is None:
        for item in res:
            if isinstance(item, (list, tuple)) and len(item) >= 1 and isinstance(item[0], (int, float)):
                tret = item
                break

    # 3) retflag: 정수 > 길이1 시퀀스 > 길이1 시퀀스의 첫 원소
    for item in res:
        if isinstance(item, (int, float)):
            rf = item
            break
    if rf is None:
        for item in res:
            if isinstance(item, (list, tuple)) and len(item) == 1 and isinstance(item[0], (int, float)):
                rf = item[0]
                break

    if tret is None:
        tret = (float('nan'),)
    return _flag_int(rf), tret

def _flag_int(rf):
    if isinstance(rf, (list, tuple)):
        for v in rf:
            try:
                return int(v)
            except Exception:
                continue
        return 0
    try:
        return int(rf)
    except Exception:
        return 0

def _sol_when_glob(jd):
    # 빌드별 시그니처 차이(3 or 4 args)를 모두 수용
    try:
        res = astrology.swe_sol_eclipse_when_glob(jd, SEFLG, 0, 0)
    except TypeError:
        try:
            res = astrology.swe_sol_eclipse_when_glob(jd, SEFLG, 0)
        except Exception:
            return 0, (float('nan'),)
    except Exception:
        return 0, (float('nan'),)
    return _unify_when_glob_result(res)

def _lun_when(jd):
    try:
        res = astrology.swe_lun_eclipse_when(jd, SEFLG, 0, 0)
    except TypeError:
        try:
            res = astrology.swe_lun_eclipse_when(jd, SEFLG, 0)
        except Exception:
            return 0, (float('nan'),)
    except Exception:
        return 0, (float('nan'),)
    return _unify_when_glob_result(res)
ANY_SOLAR_FLAGS = (astrology.SE_ECL_TOTAL |
                   astrology.SE_ECL_ANNULAR |
                   astrology.SE_ECL_PARTIAL |
                   astrology.SE_ECL_ANNULAR_TOTAL)

def _sol_where_unify(res):
    """swe_sol_eclipse_where 반환을 (retflag:int, attr:list|None)로 통일."""
    rf = None
    attr = None
    if not isinstance(res, tuple):
        return 0, None
    for item in res:
        if isinstance(item, (int, float)) and rf is None:
            rf = int(item)
        elif isinstance(item, (list, tuple)):
            if (rf is None and len(item) == 1
                    and isinstance(item[0], (int, float))):
                rf = int(item[0])
                continue
            # attr 후보: 수치가 많이 들어있는 배열(보통 길이 10~20)
            if attr is None and len(item) >= 5 and isinstance(item[0], (int, float)):
                attr = item
    return _flag_int(rf), attr
def _sol_where_retflag(t):
    """
    swe_sol_eclipse_where(t, ifl)의 retflag를 어떤 래퍼 변종에서도 int로 안전 추출.
    반환: int retflag (0이면 식 없음)
    """
    try:
        res = astrology.swe_sol_eclipse_where(t, SEFLG)
    except TypeError:
        try:
            res = astrology.swe_sol_eclipse_where(t, SEFLG, )
        except Exception:
            return 0
    except Exception:
        return 0

    if not isinstance(res, tuple):
        return 0

    # retflag 후보: (l) 단일원소 시퀀스 또는 숫자 하나
    for item in res:
        if isinstance(item, (int, float)):
            return int(item)
        if isinstance(item, (list, tuple)) and len(item) == 1 and isinstance(item[0], (int, float)):
            return int(item[0])
    return 0

def _sol_where_try(t):
    """서명 변종(인자수/반환형) 모두 시도해서 안전하게 결과 받기."""
    try:
        res = astrology.swe_sol_eclipse_where(t, SEFLG)
    except TypeError:
        # 일부 빌드는 (t, iflag, serr)로만 받게 포장되어 있을 수도…
        try:
            res = astrology.swe_sol_eclipse_where(t, SEFLG, )
        except Exception:
            return 0, None
    except Exception:
        return 0, None
    return _sol_where_unify(res)
def _classify_solar_from_retflag(rf):
    """전지구 타입 분류와 굵게 여부를 retflag 비트로 결정."""
    if rf & astrology.SE_ECL_TOTAL:
        return u"TOTAL", True, 3
    if rf & astrology.SE_ECL_ANNULAR_TOTAL:
        return u"HYBRID", True, 2
    if rf & astrology.SE_ECL_ANNULAR:
        return u"ANNULAR", True, 1
    if rf & astrology.SE_ECL_PARTIAL:
        return u"PARTIAL", False, 0
    return u"NONE", False, -1
# Lunar 분류(전지구 타입) + 우선순위
def _classify_lunar_from_retflag(rf):
    PEN = getattr(astrology, 'SE_ECL_PENUMBRAL', 0)  # 빌드에 없을 수도 있음
    if rf & getattr(astrology, 'SE_ECL_TOTAL', 0):         return u"TOTAL",   True, 2
    if rf & getattr(astrology, 'SE_ECL_PARTIAL', 0):       return u"PARTIAL", False, 1
    if PEN and (rf & PEN):                                 return u"PENUMBRAL", False, 0
    return u"UNKNOWN", False, -1


def eclipse_state_at_jdut(jdut):
    """Return the Swiss-Ephemeris eclipse state active at one UT instant.

    This is an event-state query, not a Sun-Moon aspect admission test.  The
    Swiss Ephemeris retflag decides whether an eclipse is physically active at
    ``jdut``; the phase branch only prevents the solar ``where`` routine from
    classifying the nodal geometry of an actual lunar eclipse as a solar one.
    Consequently callers do not need (and must not add) a degree orb or a
    made-up number of hours around syzygy.
    """
    try:
        anchor = float(jdut)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(anchor):
        return None

    new_moon_residual = abs(_phase_error(anchor, 0.0))
    full_moon_residual = abs(_phase_error(anchor, 180.0))
    lunar_mask = (
        getattr(astrology, 'SE_ECL_TOTAL', 0)
        | getattr(astrology, 'SE_ECL_PARTIAL', 0)
        | getattr(astrology, 'SE_ECL_PENUMBRAL', 0)
    )
    lunar_retflag = 0
    lunar_attr = None
    try:
        lunar_result = astrology.swe_lun_eclipse_how(
            anchor, SEFLG, 0.0, 0.0, 0.0,
        )
        if isinstance(lunar_result, tuple) and lunar_result:
            lunar_retflag = _flag_int(lunar_result[0])
            lunar_attr = _swe_attr_from_result(lunar_result)
    except Exception:
        lunar_retflag = 0
        lunar_attr = None

    # A lunar eclipse is the Full-Moon branch.  This is a categorical
    # syzygy distinction, not an allowance around 180 degrees.
    if (lunar_retflag & lunar_mask
            and full_moon_residual <= new_moon_residual):
        classification, _bold, _rank = _classify_lunar_from_retflag(
            lunar_retflag,
        )
        magnitude = None
        try:
            magnitude = float(lunar_attr[0]) if lunar_attr else None
        except (TypeError, ValueError, IndexError):
            magnitude = None
        return {
            'kind': 'lunar_eclipse',
            'is_solar': False,
            'classification': str(classification).lower(),
            'retflag': int(lunar_retflag),
            'jd_ut': anchor,
            'phase_residual_deg': float(full_moon_residual),
            'moon_latitude_deg': float(_moon_lat(anchor)),
            'magnitude': magnitude,
            'event_source': 'swiss_ephemeris_instant_state',
        }

    solar_retflag, solar_attr = _sol_where_try(anchor)
    solar_retflag = _flag_int(solar_retflag)
    # The global solar-eclipse state is meaningful only on the New-Moon
    # branch.  In particular, ``swe_sol_eclipse_where`` can report the nodal
    # overlap geometry at the instant of a lunar eclipse.
    if (solar_retflag & ANY_SOLAR_FLAGS
            and new_moon_residual < full_moon_residual):
        classification, _bold, _rank = _classify_solar_from_retflag(
            solar_retflag,
        )
        magnitude = None
        try:
            magnitude = float(solar_attr[0]) if solar_attr else None
        except (TypeError, ValueError, IndexError):
            magnitude = None
        return {
            'kind': 'solar_eclipse',
            'is_solar': True,
            'classification': str(classification).lower(),
            'retflag': int(solar_retflag),
            'jd_ut': anchor,
            'phase_residual_deg': float(new_moon_residual),
            'moon_latitude_deg': float(_moon_lat(anchor)),
            'magnitude': magnitude,
            'event_source': 'swiss_ephemeris_instant_state',
        }
    return None

# 이벤트 우선순위(중복 제거용)
def _rank_event(ev):
    rf = int(ev.retflag) if not isinstance(ev.retflag, (list, tuple)) else int(ev.retflag[0])
    if ev.is_solar:
        # 개기(3) > 혼성(2) > 금환(1) > 부분(0)
        if rf & astrology.SE_ECL_TOTAL:         return 3
        if rf & astrology.SE_ECL_ANNULAR_TOTAL: return 2
        if rf & astrology.SE_ECL_ANNULAR:       return 1
        if rf & astrology.SE_ECL_PARTIAL:       return 0
        return -1
    else:
        # 개기(2) > 부분(1) > 반영(0)
        if rf & getattr(astrology, 'SE_ECL_TOTAL', 0):   return 2
        if rf & getattr(astrology, 'SE_ECL_PARTIAL', 0): return 1
        if getattr(astrology, 'SE_ECL_PENUMBRAL', 0) and (rf & astrology.SE_ECL_PENUMBRAL): return 0
        return -1

def _moon_lat(jd):
    # 달 황위(지오센터)
    _, lat, _ = _calc3(jd, astrology.SE_MOON, SEFLG)
    return lat

def _refine_min(f, a, b, it=80, tol=1e-5):
    """
    골든섹션 최소화. tol=1e-5d ≈ 0.864초까지 좁힘(각 DMS 1~2″ 수준 안정).
    """
    phi = (math.sqrt(5.0)-1.0)/2.0
    a, b = (a, b) if a <= b else (b, a)
    c = b - phi*(b-a)
    d = a + phi*(b-a)
    fc, fd = f(c), f(d)
    for _ in range(it):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - phi*(b-a); fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + phi*(b-a); fd = f(d)
        if (b - a) < tol:
            break
    return 0.5*(a+b)

def _refine_solar_time(ta, tb):
    """
    일식: 합삭(Δλ≈0) + 달 황위(|β|) 동시 최소.
    가중치 ↑, tol ↓ 로 1″~2″ 수준까지 맞춤.
    """
    def F(t):
        return 2.0*abs(_dlon_m_minus_s(t)) + 5.0*abs(_moon_lat(t))
    return _refine_min(F, ta, tb, it=100, tol=1e-5)

def _solar_fallback(jd_from, jd_to):
    # ---- Safe fallback: 합삭 기반 스캔 + 순수 기하 분류 ----
    # `swe_sol_eclipse_where()` is unstable in this Python 3 build and can abort the
    # process. Keep solar eclipse logic in Python-space so the module stays usable.
    out = []
    tlist = _find_new_moons(jd_from, jd_to)
    for t0 in tlist:
        best_t = _refine_solar_time(t0 - 0.08, t0 + 0.08)
        if abs(_dlon_m_minus_s(best_t)) > 1.5:
            continue

        rf_best = _classify_solar_from_geometry(best_t)
        if not (rf_best & ANY_SOLAR_FLAGS):
            continue

        elon, elat, decl = _moon_geo_ecl_equ(best_t)
        Ld, s2, d2, m2, s2sec = _dodek_from_ecliptic(elon)
        ev = EclipseEvent()
        ev.jdut = best_t
        ev.is_solar = True
        ev.retflag  = rf_best
        ev.elon, ev.elat, ev.decl = elon, elat, decl
        ev.dodek_deg = Ld; ev.dodek_sign = s2
        ev.dodek_d, ev.dodek_m, ev.dodek_s = d2, m2, s2sec
        ev.saros = u'—'
        # bold 여부는 find_eclipses_around()에서 출생시각 기준으로 한 번에 결정
        ev.bold = False
        out.append(ev)
    return out

def _solar(jd_from, jd_to):
    if not USE_GLOB_SOLAR or not hasattr(astrology, 'swe_sol_eclipse_when_glob'):
        return []
    out = []
    jd = jd_from - 1e-6
    safe_guard = 0
    call_count = 0
    MAX_CALLS = 400
    while True:
        call_count += 1
        if call_count > MAX_CALLS:
            break
        retflag, tret = _sol_when_glob(jd)
        retflag = _flag_int(retflag)
        if retflag <= 0:
            break
        if not tret or len(tret) == 0:
            break
        tmax = float(tret[0])
        if not math.isfinite(tmax):
            break
        if tmax > jd_to + 1e-9:
            break
        if tmax <= jd + 1e-6:
            jd += 0.5
            safe_guard += 1
            if safe_guard > 3:
                break
            continue
        if tmax >= jd_from - 1e-9:
            _where_retflag, attr = _sol_where_try(tmax)
            out.append(_eclipse_event_from_swe(tmax, True, retflag, attr))
        jd = tmax + 0.01
        safe_guard = 0
    return out

def _lunar(jd_from, jd_to):
    out = []
    jd = jd_from - 1e-6
    safe_guard = 0
    call_count = 0
    MAX_CALLS = 400
    while True:
        call_count += 1
        if call_count > MAX_CALLS:
            break

        retflag, tret = _lun_when(jd)
        retflag = _flag_int(retflag)
        if retflag == 0:
            break

        if not tret or len(tret) == 0:
            jd += 5.0
            safe_guard += 1
            if safe_guard > 50: break
            continue

        tmax = float(tret[0])

        if not math.isfinite(tmax):
            jd += 5.0
            safe_guard += 1
            if safe_guard > 50: break
            continue

        if tmax > jd_to + 1e-9:
            break
        if tmax <= jd + 1e-6:
            jd += 0.5
            safe_guard += 1
            if safe_guard > 3:
                jd += 5.0
                safe_guard = 0
            continue

        if tmax >= jd_from - 1e-9:
            attr = _swe_attr_from_result(astrology.swe_lun_eclipse_how(tmax, SEFLG, 0.0, 0.0, 0.0))
            out.append(_eclipse_event_from_swe(tmax, False, retflag, attr))

        jd = tmax + 0.01
        safe_guard = 0
    return out


def _dedup_eclipse_events(chart, jd_from, jd_to):
    sol = []
    lun = []

    # when_glob 유무와 무관하게, 솔라 스캔 토글만 본다
    if ENABLE_SOLAR_SCAN:
        try:
            sol = _solar(jd_from, jd_to) or []
        except Exception:
            sol = []

    try:
        lun = _lunar(jd_from, jd_to) or []
    except Exception:
        lun = []

    allv = []
    allv.extend(sol)
    allv.extend(lun)
    allv.sort(key=lambda e: e.jdut)
    # 중복 제거(같은 종류에서 0.02일(≈29분) 이내면 하나만 남김: 더 ‘강한’ 타입 우선)
    dedup = []
    TH = 0.02
    for ev in allv:
        if dedup and (ev.is_solar == dedup[-1].is_solar) and abs(ev.jdut - dedup[-1].jdut) < TH:
            if _rank_event(ev) > _rank_event(dedup[-1]):
                dedup[-1] = ev
            # 그렇지 않으면 새 이벤트 버림
        else:
            # 직전 이벤트와 타입이 다르고 '같은 날' 수준(24h 이내)이면 일관성 체크
            if dedup and (ev.is_solar != dedup[-1].is_solar) and abs(ev.jdut - dedup[-1].jdut) < 1.0:
                # Solar는 신월(|Δλ|≈0°), Lunar는 망(|Δλ-180°|≈0°)에 더 부합하는 쪽만 남김
                e_new = abs(_dlon_m_minus_s(ev.jdut))
                e_old = abs(_dlon_m_minus_s(dedup[-1].jdut))
                ok_new = (ev.is_solar  and e_new <  2.0) or ((not ev.is_solar)  and abs(e_new-180.0) < 2.0)
                ok_old = (dedup[-1].is_solar and e_old < 2.0) or ((not dedup[-1].is_solar) and abs(e_old-180.0) < 2.0)
                if ok_new and not ok_old:
                    dedup[-1] = ev
                elif ok_new == ok_old:
                    # 둘 다 비슷하면 우선순위 높은 쪽(개기>혼성>금환>부분 / 개기>부분>반영)
                    if _rank_event(ev) > _rank_event(dedup[-1]):
                        dedup[-1] = ev
                # 둘 중 하나만 남기고 종료
            else:
                dedup.append(ev)
    return dedup


def find_eclipses_in_range(chart, jd_from, jd_to):
    try:
        start = float(jd_from)
        end = float(jd_to)
    except Exception:
        return []
    if end < start:
        start, end = end, start
    dedup = _dedup_eclipse_events(chart, start, end)
    for ev in dedup:
        ev.bold = False
        if getattr(ev, 'saros', _SAROS_UNSET) == _SAROS_UNSET:
            _assign_saros(ev)
    return dedup


def most_recent_eclipse(chart, jd_ut=None, *, solar_only=False):
    """Return the latest physical solar or lunar eclipse at/before ``jd_ut``.

    Wheel snapshots may be exported repeatedly while a cursor is stepped. A
    bounded 45-day event cache keeps the Swiss-Ephemeris search out of every
    paint while still letting the selected event change at the exact eclipse.
    """
    if jd_ut is None:
        try:
            jd_ut = chart.time.jd
        except Exception:
            return None
    try:
        anchor = float(jd_ut)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(anchor):
        return None

    chunk = int(math.floor(anchor / _RECENT_ECLIPSE_CHUNK_DAYS))
    cached = _RECENT_ECLIPSE_CACHE.get(chunk)
    if cached is None:
        chunk_start = chunk * _RECENT_ECLIPSE_CHUNK_DAYS
        events = _dedup_eclipse_events(
            chart,
            chunk_start - _RECENT_ECLIPSE_LOOKBACK_DAYS,
            chunk_start + _RECENT_ECLIPSE_CHUNK_DAYS,
        )
        cached = tuple(events)
        _RECENT_ECLIPSE_CACHE[chunk] = cached
        if len(_RECENT_ECLIPSE_CACHE) > _RECENT_ECLIPSE_CACHE_MAX:
            _RECENT_ECLIPSE_CACHE.popitem(last=False)
    else:
        _RECENT_ECLIPSE_CACHE.move_to_end(chunk)

    candidates = [
        event
        for event in cached
        if float(getattr(event, 'jdut', anchor + 1.0)) <= anchor
        and (not solar_only or bool(getattr(event, 'is_solar', False)))
    ]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda event: float(getattr(event, 'jdut', float('-inf'))),
    )


def find_eclipses_around(chart):
    # chart.time.jd는 표준시/서머타임 보정이 끝난 UT 기준 JD이므로 재조립하지 말고 그대로 사용
    try:
        jd0 = float(chart.time.jd)
    except Exception:
        # 혹시 모를 방어(특수 객체): year/month/day + time(UT decimal hour)로만 재구성
        y = chart.time.year; m = chart.time.month; d = chart.time.day
        h = float(getattr(chart.time, 'time', 0.0))
        jd0 = astrology.swe_julday(y, m, d, h, _calflag(chart))

    span = 365.0
    dedup = find_eclipses_in_range(chart, jd0 - span, jd0 + span)

    # --- 여기서부터 bold 대상 결정 로직 추가 ---

    # 1) 일단 전부 bold 해제
    for ev in dedup:
        ev.bold = False

    # 2) 메이저 타입 필터: Solar = Total/Hybrid/Annular, Lunar = Total
    def _is_major(ev):
        rf = int(ev.retflag) if not isinstance(ev.retflag, (list, tuple)) else int(ev.retflag[0])
        if ev.is_solar:
            _kind, is_major, _prio = _classify_solar_from_retflag(rf)
            return is_major   # TOTAL / ANNULAR / HYBRID만 True
        else:
            _kind, is_major, _prio = _classify_lunar_from_retflag(rf)
            return is_major   # TOTAL만 True

    majors = [ev for ev in dedup if _is_major(ev)]

    if majors:
        # 출생 시각 jd0 기준으로 직전/직후 메이저 일·월식 선택
        prevs = [ev for ev in majors if ev.jdut <= jd0]
        nexts = [ev for ev in majors if ev.jdut >= jd0]

        prev_ev = max(prevs, key=lambda e: e.jdut) if prevs else None
        next_ev = min(nexts, key=lambda e: e.jdut) if nexts else None

        if prev_ev is not None:
            prev_ev.bold = True
        if next_ev is not None and next_ev is not prev_ev:
            next_ev.bold = True

    return dedup


def _tz_offset_hours(chart):
    """
    chart.time에서 시/분 오프셋(+DST)을 정밀 추출 → 시간대 시차(시간 단위).
    - 지원 필드(존재하는 것만 사용):
      zh, zm  (시, 분) / zoneh, zonemin / tz, zone / utcoff(시간단위)
      dst, ds, daylight, daylightsaving (True면 +1h)
    """
    t = getattr(chart, 'time', None)
    if t is None:
        return 0.0
    try:
        zt = int(getattr(t, 'zt', 0))
    except Exception:
        zt = 0
    if zt == 1:
        return 0.0
    if zt in (2, 3):
        place = getattr(chart, 'place', None)
        if place is None:
            return 0.0
        lon = getattr(place, 'lon', None)
        if isinstance(lon, (int, float)):
            return float(lon) / 15.0
        try:
            base = float(getattr(place, 'deglon', 0)) + float(getattr(place, 'minlon', 0)) / 60.0
            return base / 15.0 if bool(getattr(place, 'east', True)) else -base / 15.0
        except Exception:
            return 0.0
    # 1) 시/분 분리형
    hours = None; minutes = 0.0
    for hnm in ('zh','zoneh','hours','zone'):
        v = getattr(t, hnm, None)
        if isinstance(v, (int,float)):
            hours = float(v); break
    for mnm in ('zm','zonemin','minutes','min'):
        v = getattr(t, mnm, None)
        if isinstance(v, (int,float)):
            minutes = float(v); break
    # 2) 단일 시간값
    if hours is None:
        for nm in ('tz','utcoff','utcoffset','offset','z'):
            v = getattr(t, nm, None)
            if isinstance(v, (int,float)):
                hours = float(v); minutes = 0.0; break
    if hours is None:
        hours = 0.0
    plus = getattr(t, 'plus', None)
    if isinstance(plus, bool):
        off = (1.0 if plus else -1.0) * (abs(hours) + abs(minutes)/60.0)
    else:
        # Legacy/stub charts may store the sign directly in the hour field.
        off = hours + (minutes/60.0 if hours>=0 else -minutes/60.0)
    # DST 보정(+1h)
    for dnm in ('dst','ds','daylight','daylightsaving','summer'):
        v = getattr(t, dnm, None)
        if isinstance(v, bool) and v:
            off += 1.0
            break
    return off
def _calflag(chart):
    """
    차트의 달력 설정(Time.cal: 0=그레고리, 1=율리우스)을 Swiss Ephemeris 플래그로 변환.
    속성이 없거나 예외면 기본은 그레고리안.
    """
    try:
        cal = int(getattr(chart.time, 'cal', 0))
    except Exception:
        cal = 0
    return astrology.SE_JUL_CAL if cal == 1 else astrology.SE_GREG_CAL
def _fmt_civil_date(y, m, d):
    """
    천문학적 연도(…,-1,0,1,2,…) → 사람 달력(… 2 BC, 1 BC, AD …) 날짜 문자열.
    예) y=-591  → "0592.MM.DD BC"
        y=   1  → "0001.MM.DD"
    """
    yi = int(y)
    if yi <= 0:
        civ = 1 - yi  # 0 → 1 BC, -1 → 2 BC, …
        return u"%04d.%02d.%02d %s" % (civ, m, d, mtexts.txts.get(u"BC", u"BC"))
    return u"%04d.%02d.%02d" % (yi, m, d)

def _fmt_civil_datetime(y, m, d, hh, mm, ss):
    """
    시각 포함 버전. BC엔 접미사 ' BC'를 붙임.
    """
    yi = int(y)
    if yi <= 0:
        civ = 1 - yi
        return u"%04d.%02d.%02d %02d:%02d:%02d %s" % (civ, m, d, hh, mm, ss, mtexts.txts.get(u"BC", u"BC"))
    return u"%04d.%02d.%02d %02d:%02d:%02d" % (yi, m, d, hh, mm, ss)

def utc_string(jdut):
    y, m, d, hh, mm, ss = _utc_tuple_from_jdut(jdut)
    return u"%04d.%02d.%02d %02d:%02d:%02d" % (y, m, d, hh, mm, ss)

def local_string(jdut, chart):
    """
    차트의 현지시간대로 'YYYY.MM.DD HH:MM:SS' 또는 'YYYY.MM.DD HH:MM:SS BC' 반환
    (차트 달력 설정에 맞춰 율/그레 변환)
    """
    y, m, d, hh, mm, ss = local_datetime_tuple(jdut, chart)
    return _fmt_civil_datetime(y, m, d, hh, mm, ss)


def local_date_string(jdut, chart):
    """
    현지시간대의 사람 달력 표기('YYYY.MM.DD' 또는 'YYYY.MM.DD BC') 반환
    """
    y, m, d, _, _, _ = local_datetime_tuple(jdut, chart)
    return _fmt_civil_date(y, m, d)


def local_time_string(jdut, chart):
    _, _, _, hh, mm, _ = local_datetime_tuple(jdut, chart)
    return u"%02d:%02d" % (hh, mm)


def local_day_bounds_to_jd(chart, year, month, day):
    zoneinfo_cls = getattr(geonames, 'ZoneInfo', None)
    t = getattr(chart, 'time', None)
    if zoneinfo_cls is not None and t is not None and not getattr(t, 'bc', False) and int(getattr(t, 'cal', 0)) == 0 and int(getattr(t, 'zt', 0)) == 0:
        tzid = _timezone_name_for_chart(chart)
        if tzid:
            try:
                zone = zoneinfo_cls(tzid)
                local_start = datetime.datetime(int(year), int(month), int(day), 0, 0, 0, tzinfo=zone)
                local_end = datetime.datetime(int(year), int(month), int(day), 23, 59, 59, tzinfo=zone)
                utc_start = local_start.astimezone(datetime.timezone.utc)
                utc_end = local_end.astimezone(datetime.timezone.utc)
                return (
                    astrology.swe_julday(
                        utc_start.year, utc_start.month, utc_start.day,
                        utc_start.hour + utc_start.minute / 60.0 + utc_start.second / 3600.0,
                        astrology.SE_GREG_CAL,
                    ),
                    astrology.swe_julday(
                        utc_end.year, utc_end.month, utc_end.day,
                        utc_end.hour + utc_end.minute / 60.0 + utc_end.second / 3600.0,
                        astrology.SE_GREG_CAL,
                    ),
                )
            except Exception:
                pass
    ut_start = astrology.swe_julday(int(year), int(month), int(day), 0.0, _calflag(chart))
    ut_end = astrology.swe_julday(
        int(year),
        int(month),
        int(day),
        23.0 + (59.0 / 60.0) + (59.0 / 3600.0),
        _calflag(chart),
    )
    off = _tz_offset_hours(chart) / 24.0
    return (ut_start - off, ut_end - off)

def dms_string(deg):
    d, m, s = util.decToDeg(deg % 360.0)
    return d, m, s
