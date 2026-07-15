# -*- coding: utf-8 -*-
"""Wx-free Paranatellonta (paran) row solver.

The Paranatellonta table lists every planet/fixed-star pair that crosses an
angle (Asc/MC/Dsc/IC) at the *same instant* within ANGLE_TOL_MIN of the chart's
diurnal sunrise span, at the chart's geographic latitude. The whole row is bold
when the planet and the star cross the SAME angle (``same = kindP == kindS``).

The computation is the angle/sunrise solver that previously lived inside
``paranwnd.py`` (the wx ParanatellontaWnd). It is relocated here VERBATIM — no
math change, no reimplementation — so the webapp daemon can build the same rows
the desktop draws, and so ``hours.py`` no longer has to import the wx GUI module
just to reach the sunrise helpers.

Source of every function below: ``paranwnd.py`` (see per-function citations).
``paranwnd.py`` and ``hours.py`` now re-import these names, so there is exactly
one implementation.

This module imports the raw ``sweastrology`` binding (``swe``) exactly as
``paranwnd`` did, because the raw return signatures differ from the wrapped
``astrology.*`` helpers (e.g. ``swe.swe_fixstar_ut`` returns ``(ret, serr, xx,
abc)`` while ``astrology.swe_fixstar_ut`` returns ``(ret, name, xx, serr)``).
Substituting the wrappers would silently change the values, so the raw binding
is kept. It imports no wx.
"""
from __future__ import division
import math
import os
import astrology
import mtexts
# NOTE: ``common`` is intentionally NOT imported at module top. It sits on the
# common -> arabicparts -> fortune -> chart -> hours -> engine.paranatellonta
# import cycle, so a top-level import here would break when this module is the
# first one loaded. The two functions that need it (``_load_fixstars_cat`` and
# ``_star_display_name``) import ``common`` locally, exactly as paranwnd did.
try:
    import sweastrology as swe
except ImportError:
    swe = None

DEG = math.pi/180.0
SID_RATE = 1.002737909350795  # sidereal hours per UT hour
ANGLE_TOL_MIN = 2.0   # 분; 앵글 회합 정의의 허용 창(±2분)
ANGLE_SOLVER_TOL_MIN = 0.01   # 분; 각시각 역산 수렴 한계

# ---- fixstars.cat fallback with proper motion ----
PM_UNITS = 'sefstars_masyear' # RA: mas/yr·cos(dec0), Dec: mas/yr (sefstars.txt 기준)
# 필요시 'per_year' 로 바꾸면 연단위 μ로 처리됨.

_FIXSTAR_CAT_DB = None


def _load_fixstars_cat():
    """paranwnd.py:29-122 (verbatim).

    fixstars.cat을 찾아 1회 캐시 로드:
      code -> {name, ra_j2000_deg, dec_j2000_deg, pm_ra_sec, pm_dec_arcsec}
    pm_ra_sec   : RA 고유운동 (초/세기 또는 초/년) — PM_UNITS로 단위 지정
    pm_dec_arcsec: Dec 고유운동 (초각/세기 또는 초각/년)
    """
    import os
    global _FIXSTAR_CAT_DB
    if _FIXSTAR_CAT_DB is not None:
        return _FIXSTAR_CAT_DB

    paths = []
    try:
        import common
        ep = getattr(common.common, 'ephepath', '')
        if ep:
            paths += [
                os.path.join(ep, 'sefstars.txt'),
                os.path.join(ep, 'SWEP', 'Ephem', 'sefstars.txt'),
                os.path.join(ep, 'fixstars.cat'),
                os.path.join(ep, 'SWEP', 'Ephem', 'fixstars.cat'),
            ]

    except Exception:
        pass
    here = os.path.dirname(__file__)
    paths += [
        os.path.join(here, 'SWEP', 'Ephem', 'sefstars.txt'),
        os.path.join(here, 'sefstars.txt'),
        os.path.join(here, 'SWEP', 'Ephem', 'fixstars.cat'),
        os.path.join(here, 'fixstars.cat'),
    ]

    db = {}
    for path in paths:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, 'r') as f:
                is_sef = os.path.basename(path).lower().startswith('sefstars')
                for line in f:
                    s = line.strip()
                    if not s or s.startswith('#'):
                        continue
                    parts = [p.strip() for p in s.split(',')]
                    # 형식 예(최소): name, code, mag, RAh, RAm, RAs, DEd, DEm, DEs, [pmRA, pmDE]
                    if len(parts) < 9:
                        continue
                    name = parts[0]
                    code = parts[1].lstrip(',')
                    # RA
                    try:
                        ra_h = float(parts[3]); ra_m = float(parts[4]); ra_s = float(parts[5])
                    except:
                        continue
                    ra_deg = (ra_h + ra_m/60.0 + ra_s/3600.0) * 15.0
                    # Dec (부호 처리)
                    try:
                        dec_d_raw = parts[6]
                        dec_d = abs(float(dec_d_raw))
                        dec_m = float(parts[7]); dec_s = float(parts[8])
                        sign = -1.0 if str(dec_d_raw).strip().startswith('-') else 1.0
                    except:
                        continue
                    dec_deg = sign * (dec_d + dec_m/60.0 + dec_s/3600.0)
                    # Proper motion (있으면 읽고, 없으면 0)
                    pm_ra_sec = 0.0
                    pm_dec_arcsec = 0.0
                    if len(parts) >= 11:
                        try:
                            if is_sef:
                                # sefstars.txt: pmRA = mas/yr * cos(dec0), pmDE = mas/yr
                                pm_ra_sec     = float(parts[9])
                                pm_dec_arcsec = float(parts[10])
                            else:
                                # legacy fixstars.cat: pmRA = 초(시간)/세기(or 년), pmDE = 초각/세기(or 년)
                                pm_ra_sec     = float(parts[9])
                                pm_dec_arcsec = float(parts[10])
                        except:
                            pm_ra_sec = 0.0; pm_dec_arcsec = 0.0
                    db[code] = {
                        'name': name,
                        'ra_j2000_deg': ra_deg,
                        'dec_j2000_deg': dec_deg,
                        'pm_ra_sec': pm_ra_sec,
                        'pm_dec_arcsec': pm_dec_arcsec
                    }
            _FIXSTAR_CAT_DB = db
            return _FIXSTAR_CAT_DB
        except Exception:
            continue
    _FIXSTAR_CAT_DB = {}
    return _FIXSTAR_CAT_DB


def _precess_eq_j2000_to_date(ra_deg, dec_deg, jd_ut):
    """paranwnd.py:124-137 (verbatim). IAU 1976 precession (J2000 -> of-date), 근사."""
    T = (jd_ut - 2451545.0)/36525.0
    zeta = (2306.2181 + 1.39656*T - 0.000139*T*T)*T + (0.30188 - 0.000344*T)*T*T + 0.017998*T*T*T
    z    = (2306.2181 + 1.39656*T - 0.000139*T*T)*T + (1.09468 + 0.000066*T)*T*T + 0.018203*T*T*T
    theta= (2004.3109 - 0.85330*T - 0.000217*T*T)*T - (0.42665 + 0.000217*T)*T*T - 0.041833*T*T*T
    zeta *= (math.pi/(180.0*3600.0)); z *= (math.pi/(180.0*3600.0)); theta *= (math.pi/(180.0*3600.0))
    a = ra_deg*DEG; d = dec_deg*DEG
    A = math.cos(d)*math.sin(a + zeta)
    B = math.cos(theta)*math.cos(d)*math.cos(a + zeta) - math.sin(theta)*math.sin(d)
    C = math.sin(theta)*math.cos(d)*math.cos(a + zeta) + math.cos(theta)*math.sin(d)
    ra2 = (math.atan2(A, B) + z) % (2.0*math.pi)
    dec2= math.asin(C)
    return ra2/DEG, dec2/DEG


def _apply_proper_motion_j2000(ra_deg, dec_deg, jd_ut, pm_ra_sec, pm_dec_arcsec):
    """paranwnd.py:139-163 (verbatim).

    J2000에서 of-date까지 고유운동 1차 보정.
    pm_ra_sec      : RA 시간초 / 세기(or 년) - PM_UNITS로 단위 지정
    pm_dec_arcsec  : Dec 초각 / 세기(or 년)
    반환: (ra_pm_deg, dec_pm_deg) — 여전히 J2000 기준 성좌에서의 위치(세차 전)
    """
    years = (jd_ut - 2451545.0)/365.25
    if PM_UNITS == 'per_century':
        factor = years/100.0
        dRA_deg = (pm_ra_sec * factor) / 240.0                 # 초(시간)→도
        dDE_deg = (pm_dec_arcsec * factor) / 3600.0            # 초각→도
    elif PM_UNITS == 'per_year':
        factor = years
        dRA_deg = (pm_ra_sec * factor) / 240.0
        dDE_deg = (pm_dec_arcsec * factor) / 3600.0
    else:
        # 'sefstars_masyear': pm_ra_sec = mas/yr * cos(dec0), pm_dec_arcsec = mas/yr
        factor = years
        cosd = max(1e-12, math.cos(dec_deg * DEG))
        dRA_deg = ((pm_ra_sec / 1000.0) / 3600.0) * (factor / cosd)   # (mas→″→deg)/cosδ0
        dDE_deg = ((pm_dec_arcsec / 1000.0) / 3600.0) * factor        # (mas→″→deg)
    ra1  = (ra_deg + dRA_deg) % 360.0
    dec1 = max(-90.0, min(90.0, dec_deg + dDE_deg))
    return ra1, dec1


def _ra_dec_star_deg_ut_from_cat(jd_ut, star_code):
    """paranwnd.py:165-180 (verbatim).

    fixstars.cat 로드 → (J2000 RA/Dec + μ 보정) → of-date 세차 반영 좌표 반환
    """
    code = star_code.lstrip(',')
    db = _load_fixstars_cat()
    if code not in db:
        raise RuntimeError(u"fixstars.cat에 항성 코드가 없습니다: %s" % code)
    ra0 = db[code]['ra_j2000_deg']
    de0 = db[code]['dec_j2000_deg']
    pmra = db[code].get('pm_ra_sec', 0.0)
    pmde = db[code].get('pm_dec_arcsec', 0.0)
    # 1) 고유운동(μ) 보정
    ra1, de1 = _apply_proper_motion_j2000(ra0, de0, jd_ut, pmra, pmde)
    # 2) of-date 세차 반영
    return _precess_eq_j2000_to_date(ra1, de1, jd_ut)
# ---- /fixstars.cat fallback with proper motion ----

# ====== 유틸 ======


def _norm24(x):
    """paranwnd.py:184-186 (verbatim)."""
    x = x % 24.0
    return x + 24.0 if x < 0 else x


def _acos_clip(x):
    """paranwnd.py:188-189 (verbatim)."""
    return math.acos(max(-1.0, min(1.0, x)))


def _fmt_deltat_minutes(du_days):
    """paranwnd.py:191-194 (verbatim)."""
    s = int(round(abs(du_days)*86400.0))
    m, s = divmod(s, 60)
    return u"±%2d'%02d\"" % (m, s)


def _auto_h0_deg_for(ipl, *_, **__):
    """paranwnd.py:196-198 (verbatim).

    기하학적 상승/저녁: 굴절·반지름 무시, 중심점이 ASC에 정확히 걸리는 순간(h=0°).
    """
    return 0.0


def _star_display_name(star_id_with_or_leading_comma, jd_ref, options=None):
    """paranwnd.py:200-233 (verbatim).

    표시용 이름: (1) 사용자 선호 별칭 → (2) Swiss → (3) 카탈로그 파일의 name.
    """
    # 옵션이 비어있으면 JSON에서 한 번 복구
    if (not options.fixstarAliasMap) if hasattr(options, 'fixstarAliasMap') else True:
        import common, os, json
        alias_json = os.path.join(common.common.ephepath, 'fixstar_aliases.json')
        if os.path.isfile(alias_json):
            with open(alias_json, 'r') as _f:
                _data = json.load(_f)
            if isinstance(_data, dict):
                if not hasattr(options, 'fixstarAliasMap') or not isinstance(options.fixstarAliasMap, dict):
                    options.fixstarAliasMap = {}
                options.fixstarAliasMap.update({k: v for k, v in _data.items() if isinstance(k, str)})

    # 1) 사용자 선호 별칭(코드→표시명) 우선
    try:
        if options and hasattr(options, 'fixstarAliasMap'):
            code = star_id_with_or_leading_comma.lstrip(',').strip()
            if code in options.fixstarAliasMap:
                return options.fixstarAliasMap[code]
    except Exception:
        pass
    # 2) Swiss (성공 시 Swiss가 돌려준 name의 앞부분)
    try:
        if swe is not None:
            q = star_id_with_or_leading_comma if star_id_with_or_leading_comma.startswith(u',') else (u',' + star_id_with_or_leading_comma)
            xx, name_or_err = swe.fixstar(q)
            if isinstance(name_or_err, (str, unicode if 'unicode' in dir(__builtins__) else str)):
                return (name_or_err.split(u',')[0]).strip()
    except Exception:
        pass
    # 3) cat 폴백
    db = _load_fixstars_cat()
    return db.get(star_id_with_or_leading_comma.lstrip(','), {}).get('name', star_id_with_or_leading_comma.lstrip(','))


def _ra_dec_star_deg_ut(jd_ut, star_name):
    """paranwnd.py:235-253 (verbatim).

    해당 UT에서 항성의 적경/적위(deg). 우선 Swiss, 실패 시 fixstars.cat(+μ) 폴백.
    """
    # Python2/3 문자열 안전 처리
    try:
        base_str = basestring  # py2
    except Exception:
        base_str = str         # py3
    if swe is None:
        return _ra_dec_star_deg_ut_from_cat(jd_ut, star_name)
    iflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_EQUATORIAL
    q = star_name if isinstance(star_name, base_str) else (u"%s" % star_name)
    if not q.startswith(u','):
        q = u',' + q
    try:
        ret,serr, xx,abc = swe.swe_fixstar_ut(q, jd_ut, iflag)
        return xx[0], xx[1]
    except Exception:
        # sefstars.txt 없는 경우 등 → fixstars.cat(+μ) 폴백
        return _ra_dec_star_deg_ut_from_cat(jd_ut, q)


def _ra_dec_planet_deg_ut(jd_ut, ipl, lon_deg, lat_deg, alt_m=0.0):
    """paranwnd.py:255-261 (verbatim)."""
    if swe is None:
        raise RuntimeError("Swiss Ephemeris가 필요합니다.")
    swe.swe_set_topo(lon_deg, lat_deg, alt_m)
    iflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_EQUATORIAL | astrology.SEFLG_TOPOCTR
    err, xx = astrology.swe_calc_ut(jd_ut, ipl, iflag)
    return xx[0], xx[1]


def _lst(jd_ut, lon_deg):
    """paranwnd.py:263-264 (verbatim)."""
    return _norm24(swe.swe_sidtime(jd_ut) + lon_deg/15.0)


def _sunrise_sunset_for_local_day_geometric(Y, M, D, tz_hours, lon_deg, lat_deg, alt_m=0.0, gregflag=astrology.SE_GREG_CAL):
    """paranwnd.py:266-329 (verbatim).

    현지 달력일(Y-M-D)의 기하학적 일출/일몰(UT JD) 한 쌍을 반환.
    h0 = 0°, 굴절/반지름 무시. 없으면 (None, None).
    """
    if swe is None:
        raise RuntimeError("Swiss Ephemeris가 필요합니다.")
    jd_local0_ut = swe.julday(Y, M, D, 0.0, gregflag) - tz_hours/24.0

    phi = lat_deg*DEG

    def _event_near(jd0, kind):  # kind in {"rise","set"}
        # 정오를 기준으로 초기 α,δ를 얻고 목표 LST를 계산 → 고정점 반복
        ra, dec = _ra_dec_planet_deg_ut(jd0 + 0.5, swe.SUN, lon_deg, lat_deg, alt_m)
        dec_r = dec*DEG
        denom = math.cos(phi)*math.cos(dec_r)
        if abs(denom) < 1e-12:
            return None
        cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom  # h0=0°
        if not (-1.0 <= cosH0 <= 1.0):
            return None
        H0_deg = _acos_clip(cosH0)/DEG
        alpha_h = ra/15.0
        if kind == "rise":
            lst_target = _norm24(alpha_h - H0_deg/15.0)
        else:
            lst_target = _norm24(alpha_h + H0_deg/15.0)
        ut = jd0 + (((lst_target - _lst(jd0, lon_deg)) % 24.0) / SID_RATE)/24.0
        for _ in range(8):
            ra, dec = _ra_dec_planet_deg_ut(ut, swe.SUN, lon_deg, lat_deg, alt_m)
            dec_r = dec*DEG
            denom = math.cos(phi)*math.cos(dec_r)
            if abs(denom) < 1e-12:
                return None
            cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom
            if not (-1.0 <= cosH0 <= 1.0):
                return None
            H0_deg = _acos_clip(cosH0)/DEG
            alpha_h = ra/15.0
            if kind == "rise":
                lst_target = _norm24(alpha_h - H0_deg/15.0)
            else:
                lst_target = _norm24(alpha_h + H0_deg/15.0)
            lst_now = _lst(ut, lon_deg)
            dt_h = ((lst_target - lst_now) % 24.0) / SID_RATE
            if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN/60.0):  # <15초면 수렴
                break
            ut += dt_h/24.0
        return ut

    # 현지 달력일 경계 안에 들어오는 일출/일몰을 찾아서 선택
    sunrise_cands, sunset_cands = [], []
    for k in (-1, 0, +1, +2):
        ut_r = _event_near(jd_local0_ut + k, "rise")
        ut_s = _event_near(jd_local0_ut + k, "set")
        if ut_r and (jd_local0_ut <= ut_r < jd_local0_ut + 1.0):
            sunrise_cands.append(ut_r)
        if ut_s and (jd_local0_ut <= ut_s < jd_local0_ut + 1.0):
            sunset_cands.append(ut_s)

    sr = min(sunrise_cands) if sunrise_cands else None
    ss = min(sunset_cands) if sunset_cands else None
    return sr, ss


ANGLE_LABELS = (u"Asc", u"MC", u"Dsc", u"IC")


def _lst_target_for_kind(alpha_h, dec_r, phi, kind):
    """paranwnd.py:349-364 (verbatim)."""
    k = (kind or u"").strip().lower()
    if k in ("asc", "dsc"):
        denom = math.cos(phi)*math.cos(dec_r)
        if abs(denom) < 1e-12:
            return None
        cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom  # h=0°
        if not (-1.0 <= cosH0 <= 1.0):
            return None
        H0_deg = _acos_clip(cosH0)/DEG
        return _norm24(alpha_h - H0_deg/15.0) if k == "asc" else _norm24(alpha_h + H0_deg/15.0)
    elif k == "mc":
        return _norm24(alpha_h)
    elif k == "ic":
        return _norm24(alpha_h + 12.0)
    return None


def _angle_times_planet_in(lon_deg, lat_deg, ipl, t0_ut, t1_ut, alt_m=0.0, max_iter=8):
    """paranwnd.py:366-399 (verbatim)."""
    if swe is None:
        raise RuntimeError("Swiss Ephemeris가 필요합니다.")
    phi = lat_deg*DEG
    outs = []
    jd_days = range(int(math.floor(t0_ut)) - 1, int(math.floor(t1_ut)) + 2)
    for jd0 in jd_days:
        for kind in ANGLE_LABELS:
            ra, dec = _ra_dec_planet_deg_ut(jd0 + 0.5, ipl, lon_deg, lat_deg, alt_m)
            alpha_h = ra/15.0; dec_r = dec*DEG
            lst_tgt = _lst_target_for_kind(alpha_h, dec_r, phi, kind)
            if lst_tgt is None:
                continue
            ut = jd0 + (((lst_tgt - _lst(jd0, lon_deg)) % 24.0) / SID_RATE) / 24.0
            for _ in range(max_iter):
                ra, dec = _ra_dec_planet_deg_ut(ut, ipl, lon_deg, lat_deg, alt_m)
                alpha_h = ra/15.0; dec_r = dec*DEG
                lst_tgt = _lst_target_for_kind(alpha_h, dec_r, phi, kind)
                if lst_tgt is None:
                    ut = None; break
                lst_now = _lst(ut, lon_deg)
                dt_h = ((lst_tgt - lst_now) % 24.0) / SID_RATE
                if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN/60.0):
                    break
                ut += dt_h/24.0
            if ut is not None and (t0_ut <= ut < t1_ut):
                outs.append((kind, ut))
    # kind별 중복 제거(시간 반올림 후)
    seen, dedup = set(), []
    for kind, ut in outs:
        key = (kind, round(ut, 6))
        if key not in seen:
            seen.add(key); dedup.append((kind, ut))
    return dedup


def _angle_time_star_near(jd_guess, lon_deg, lat_deg, star_name_with_or_leading_comma, kind, max_iter=8):
    """paranwnd.py:401-430 (verbatim)."""
    if swe is None:
        raise RuntimeError("Swiss Ephemeris가 필요합니다.")
    phi = lat_deg*DEG
    best_ut, best_abs = None, 1e99
    for dd in (-1, 0, +1):
        jd0 = math.floor(jd_guess) + dd
        ra, dec = _ra_dec_star_deg_ut(jd0 + 0.5, star_name_with_or_leading_comma)
        alpha_h = ra/15.0; dec_r = dec*DEG
        lst_tgt = _lst_target_for_kind(alpha_h, dec_r, phi, kind)
        if lst_tgt is None:
            continue
        ut = jd0 + (((lst_tgt - _lst(jd0, lon_deg)) % 24.0) / SID_RATE) / 24.0
        for _ in range(max_iter):
            ra, dec = _ra_dec_star_deg_ut(ut, star_name_with_or_leading_comma)
            alpha_h = ra/15.0; dec_r = dec*DEG
            lst_tgt = _lst_target_for_kind(alpha_h, dec_r, phi, kind)
            if lst_tgt is None:
                ut = None; break
            lst_now = _lst(ut, lon_deg)
            dt_h = ((lst_tgt - lst_now) % 24.0) / SID_RATE
            if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN/60.0):
                break
            ut += dt_h/24.0
        if ut is None:
            continue
        dabs = abs(ut - jd_guess)
        if dabs < best_abs:
            best_ut, best_abs = ut, dabs
    return best_ut


def _angle_times_star_in(lon_deg, lat_deg, star_name, t0_ut, t1_ut, max_iter=4):
    """paranwnd.py:432-471 (verbatim).

    Precompute all angle crossing times for one star over [t0, t1).

    Stars have negligible proper motion over a day, so max_iter=4 suffices
    (usually converges in 1-2). Returns list of (kind, ut)."""
    if swe is None:
        return []
    phi = lat_deg * DEG
    outs = []
    jd_days = range(int(math.floor(t0_ut)) - 1, int(math.floor(t1_ut)) + 2)
    for jd0 in jd_days:
        ra, dec = _ra_dec_star_deg_ut(jd0 + 0.5, star_name)
        alpha_h = ra / 15.0
        dec_r = dec * DEG
        for kind in ANGLE_LABELS:
            lst_tgt = _lst_target_for_kind(alpha_h, dec_r, phi, kind)
            if lst_tgt is None:
                continue
            ut = jd0 + (((lst_tgt - _lst(jd0, lon_deg)) % 24.0) / SID_RATE) / 24.0
            for _ in range(max_iter):
                ra2, dec2 = _ra_dec_star_deg_ut(ut, star_name)
                lst_tgt = _lst_target_for_kind(ra2 / 15.0, dec2 * DEG, phi, kind)
                if lst_tgt is None:
                    ut = None
                    break
                lst_now = _lst(ut, lon_deg)
                dt_h = ((lst_tgt - lst_now) % 24.0) / SID_RATE
                if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN / 60.0):
                    break
                ut += dt_h / 24.0
            if ut is not None and (t0_ut <= ut < t1_ut):
                outs.append((kind, ut))
    # dedup
    seen, dedup = set(), []
    for kind, ut in outs:
        key = (kind, round(ut, 6))
        if key not in seen:
            seen.add(key)
            dedup.append((kind, ut))
    return dedup


def _rise_times_planet_in(lon_deg, lat_deg, ipl, t0_ut, t1_ut,
                          alt_m=0.0, P_hPa=1013.25, T_C=10.0):
    """paranwnd.py:473-516 (verbatim).

    구간 [t0, t1) 내 행성의 기하학적 상승(UT 리스트, h=0°)"""
    phi = lat_deg*DEG
    h0 = 0.0
    outs = []
    jd_days = range(int(math.floor(t0_ut)) - 1, int(math.floor(t1_ut)) + 2)
    for jd0 in jd_days:
        # 정오 기준 초기치
        ra, dec = _ra_dec_planet_deg_ut(jd0 + 0.5, ipl, lon_deg, lat_deg, alt_m)
        dec_r = dec*DEG
        denom = math.cos(phi)*math.cos(dec_r)
        if abs(denom) < 1e-12:
            continue
        cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom
        if not (-1.0 <= cosH0 <= 1.0):
            continue
        H0_deg = _acos_clip(cosH0)/DEG
        alpha_h = ra/15.0
        lst_target = _norm24(alpha_h - H0_deg/15.0)

        # 고정점 반복
        ut = jd0 + (((lst_target - _lst(jd0, lon_deg)) % 24.0) / SID_RATE) / 24.0
        for _ in range(6):
            ra, dec = _ra_dec_planet_deg_ut(ut, ipl, lon_deg, lat_deg, alt_m)
            dec_r = dec*DEG
            denom = math.cos(phi)*math.cos(dec_r)
            if abs(denom) < 1e-12:
                ut = None; break
            cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom
            if not (-1.0 <= cosH0 <= 1.0):
                ut = None; break
            H0_deg = _acos_clip(cosH0)/DEG
            alpha_h = ra/15.0
            lst_target = _norm24(alpha_h - H0_deg/15.0)
            lst_now = _lst(ut, lon_deg)
            dt_h = ((lst_target - lst_now) % 24.0) / SID_RATE
            if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN/60.0):
                break
            ut += dt_h/24.0
        if ut is not None and (t0_ut <= ut < t1_ut):
            outs.append(ut)
    outs = sorted(set([round(u, 6) for u in outs]))
    return outs


def _sunrise_span_for_local_day(Y, M, D, tz_hours, lon_deg, lat_deg, alt_m=0.0, gregflag=astrology.SE_GREG_CAL):
    """paranwnd.py:518-571 (verbatim).

    현지 달력일의 '기하학적' 일출→다음 일출 구간(UT, h=0°; 굴절/반지름 무시)"""
    if swe is None:
        raise RuntimeError("Swiss Ephemeris가 필요합니다.")
    jd_local0_ut = swe.swe_julday(Y, M, D, 0.0, gregflag) - tz_hours/24.0
    cands = []
    phi = lat_deg*DEG
    h0 = 0.0

    def _sunrise_near(jd0):
        ra, dec = _ra_dec_planet_deg_ut(jd0 + 0.5, astrology.SE_SUN, lon_deg, lat_deg, alt_m)
        dec_r = dec*DEG
        denom = math.cos(phi)*math.cos(dec_r)
        if abs(denom) < 1e-12:
            return None
        cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom
        if not (-1.0 <= cosH0 <= 1.0):
            return None
        H0_deg = _acos_clip(cosH0)/DEG
        alpha_h = ra/15.0
        lst_target = _norm24(alpha_h - H0_deg/15.0)
        ut = jd0 + (((lst_target - _lst(jd0, lon_deg)) % 24.0) / SID_RATE)/24.0
        for _ in range(6):
            ra, dec = _ra_dec_planet_deg_ut(ut, astrology.SE_SUN, lon_deg, lat_deg, alt_m)
            dec_r = dec*DEG
            denom = math.cos(phi)*math.cos(dec_r)
            if abs(denom) < 1e-12: return None
            cosH0 = (-math.sin(phi)*math.sin(dec_r)) / denom
            if not (-1.0 <= cosH0 <= 1.0): return None
            H0_deg = _acos_clip(cosH0)/DEG
            alpha_h = ra/15.0
            lst_target = _norm24(alpha_h - H0_deg/15.0)
            lst_now = _lst(ut, lon_deg)
            dt_h = ((lst_target - lst_now) % 24.0) / SID_RATE
            if abs(dt_h) < (ANGLE_SOLVER_TOL_MIN/60.0): break
            ut += dt_h/24.0
        return ut

    for k in (-1, 0, +1, +2):
        ut = _sunrise_near(jd_local0_ut + k)
        if ut and (jd_local0_ut <= ut < jd_local0_ut + 1.0):
            cands.append(ut)
    if not cands:
        return None, None
    first = min(cands)

    next_cands = []
    for k in (0, +1, +2, +3):
        ut = _sunrise_near(math.floor(first) + k)
        if ut and ut > first + 1e-8:
            next_cands.append(ut)
    second = min(next_cands) if next_cands else None
    return first, second

# ====== 후보 항성 목록 가져오기 ======


def _get_fixstar_names_for_parans(options):
    """paranwnd.py:574-594 (verbatim).

    유저가 켠 항성만 반환. Swiss 고유 ID 포맷은 ',<code>' 이므로
    모두 콤마를 붙여 돌려준다. (예: 'alLeo' -> ',alLeo')
    """
    try:
        fs = getattr(options, 'fixstars', {})  # dict: {code: orb, ...}
        names = []
        # 파이썬2/3 호환
        try:
            keys_iter = fs.iterkeys()
        except AttributeError:
            keys_iter = fs.keys()
        for k in keys_iter:
            k = (u'' + k)  # ensure unicode on py2
            if not k.startswith(u','):
                k = u',' + k
            names.append(k)
        return names
    except Exception:
        return []


_PLANET_LABEL = {
    astrology.SE_SUN: u"Sun", astrology.SE_MOON: u"Moon", astrology.SE_MERCURY: u"Mercury",
    astrology.SE_VENUS: u"Venus", astrology.SE_MARS: u"Mars", astrology.SE_JUPITER: u"Jupiter",
    astrology.SE_SATURN: u"Saturn"
}


def _extract_local_ymd_tz(horoscope):
    """paranwnd.py:601-656 (relocated; ``self.horoscope`` -> ``horoscope``).

    The wx ``ParanatellontaWnd._extract_local_ymd_tz(self)`` read ``self.horoscope``;
    here the chart is passed directly so the daemon can drive it. The body is
    otherwise verbatim.

    출생 '현지 달력일'(origyear/month/day)과 시간대, 위치를 차트에서 직접 추출한다.
    - tz_hours: (zh + zm/60) * (+1 if plus else -1)
    - 경도/위도: 도+분/60+초/3600, 동(E)/북(N) 양수, 서/남 음수
    """
    h = horoscope
    if h is None or getattr(h, "time", None) is None or getattr(h, "place", None) is None:
        raise RuntimeError(u"차트의 시간/장소 정보를 찾을 수 없습니다.")

    t = h.time
    p = h.place

    # 1) 현지 달력일 (사용자가 입력한 원래 날짜)
    Y = int(getattr(t, "origyear"))
    M = int(getattr(t, "origmonth"))
    D = int(getattr(t, "origday"))

    # 2) 시간대(시간 단위, +동경/−서경과 무관)
    zh = float(getattr(t, "zh", 0))
    zm = float(getattr(t, "zm", 0))
    plus = bool(getattr(t, "plus", True))
    tz = (zh + zm/60.0) * (1.0 if plus else -1.0)
    # chart.Time.daylightsaving 반영(+1h)
    if bool(getattr(t, "daylightsaving", False)):
        tz += 1.0

    dst_h = float(getattr(t, "dzh", getattr(t, "dsth", 0.0)))
    dst_m = float(getattr(t, "dzm", getattr(t, "dstm", 0.0)))
    dst_flag = bool(getattr(t, "dst", False))
    if dst_flag:
        tz += (dst_h + dst_m/60.0) or 1.0

    # 3) 위치(십진도)
    lon = float(p.deglon) + float(p.minlon)/60.0 + float(getattr(p, "seclon", 0.0))/3600.0
    east = getattr(p, "east", True)
    if isinstance(east, str):
        east_bool = east.strip().upper() in ("E", "+", "EAST", "TRUE", "T", "1")
    else:
        east_bool = bool(east)
    if not east_bool:
        lon = -lon

    lat = float(p.deglat) + float(p.minlat)/60.0 + float(getattr(p, "seclat", 0.0))/3600.0
    north = getattr(p, "north", True)
    if isinstance(north, str):
        north_bool = north.strip().upper() in ("N", "+", "NORTH", "TRUE", "T", "1")
    else:
        north_bool = bool(north)
    if not north_bool:
        lat = -lat

    alt = float(getattr(p, "altitude", 0.0))

    return (Y, M, D, tz, lon, lat, alt)


def compute_paran_rows(horoscope, options):
    """Paran rows for a chart, as (ΔtTxt, ipl, StarDispName, AnglesTxt, same).

    Relocated VERBATIM from ``ParanatellontaWnd._compute_rows`` (paranwnd.py:
    1154-1234), with ``self`` replaced by the explicit ``horoscope``/``options``
    arguments and ``_extract_local_ymd_tz(self)`` -> ``_extract_local_ymd_tz(
    horoscope)``. No math change. ``same = (kindP == kindS)`` is the whole-row
    bold predicate (paranwnd.py:1216).
    """
    # 원래 클래스의 _compute_rows 로직을 거의 그대로 복사·사용하되,
    # rows.append에서 planet_label 대신 ipl(정수 코드)을 넣는다.
    Y, M, D, tz, lon, lat, alt = _extract_local_ymd_tz(horoscope)
    # chart.Time.cal: 0=GREGORIAN, 1=JULIAN
    t = getattr(horoscope, "time", None)
    cal = int(getattr(t, "cal", 0)) if t is not None else 0
    gregflag = astrology.SE_GREG_CAL if cal == 0 else astrology.SE_JUL_CAL
    sr_today, sr_next = _sunrise_span_for_local_day(Y, M, D, tz, lon, lat, alt, gregflag)
    jd_today_ut = swe.swe_julday(Y, M, D, 0.0, gregflag)
    Yp, Mp, Dp, _ = swe.swe_revjul(jd_today_ut - 1.0, gregflag)
    sr_prev, sr_today_again = _sunrise_span_for_local_day(Yp, Mp, Dp, tz, lon, lat, alt, gregflag)

    tobj = getattr(horoscope, "time", None)
    jd_ut = getattr(tobj, "jd", None) or getattr(horoscope, "jd_ut", None)

    if jd_ut is None:
        return []

    if sr_today and sr_next and (sr_today <= jd_ut < sr_next):
        t0, t1 = sr_today, sr_next
    elif sr_prev and sr_today and (sr_prev <= jd_ut < sr_today):
        t0, t1 = sr_prev, sr_today
    else:
        half = 0.5
        t0, t1 = jd_ut - half, jd_ut + half

    _pad = ANGLE_TOL_MIN / 1440.0
    t0_pad, t1_pad = t0 - _pad, t1 + _pad

    planets = [astrology.SE_SUN, astrology.SE_MOON, astrology.SE_MERCURY, astrology.SE_VENUS, astrology.SE_MARS, astrology.SE_JUPITER, astrology.SE_SATURN]

    planet_events = []
    for ipl in planets:
        for kindP, utP in _angle_times_planet_in(lon, lat, ipl, t0_pad, t1_pad, alt):
            planet_events.append((ipl, kindP, utP))
    if not planet_events:
        return []

    fixstars_ids = _get_fixstar_names_for_parans(options)
    if not fixstars_ids:
        return []

    # Precompute all star angle crossing times once (instead of per planet event)
    star_events = {}  # sid -> [(kindS, utS), ...]
    for sid in fixstars_ids:
        star_events[sid] = _angle_times_star_in(lon, lat, sid, t0_pad, t1_pad)

    tol_days = (ANGLE_TOL_MIN + 1e-6) / 1440.0
    _tr = {'Asc': mtexts.txts['Asc'], 'Dsc': mtexts.txts['Dsc'],
           'MC': mtexts.txts['MC'],   'IC':  mtexts.txts['IC']}

    rows = []  # (ΔtTxt, ipl, StarDispName, "P - S")
    for ipl, kindP, utP in planet_events:
        for sid in fixstars_ids:
            for kindS, utS in star_events[sid]:
                du = utP - utS
                if abs(du) > tol_days:
                    continue
                dtxt = _fmt_deltat_minutes(du)
                angles_txt = u"%s - %s" % (_tr.get(kindP, kindP), _tr.get(kindS, kindS))
                star_disp = _star_display_name(sid, utP, options)
                same = (kindP == kindS)
                rows.append((dtxt, ipl, star_disp, angles_txt, same))

    def _abs_minutes(txt):
        s = txt.replace(u"±", u"").replace(u'"', u'').split(u"'")
        m = int(s[0]); ss = int(s[1])
        return m + ss/60.0
    # 중복(같은 별표시명·같은 각쌍) 압축: |Δt|가 더 작은 한 건만 유지
    uniq = {}
    for row in rows:
        dtxt, ipl2, star_disp2, angles2, same2 = row
        key = (ipl2, star_disp2, angles2)
        # 처음 보거나, 기존보다 |Δt|가 더 작으면 교체
        if (key not in uniq) or (_abs_minutes(dtxt) < _abs_minutes(uniq[key][0])):
            uniq[key] = row
    rows = list(uniq.values())

    rows.sort(key=lambda r: _abs_minutes(r[0]))
    return rows
