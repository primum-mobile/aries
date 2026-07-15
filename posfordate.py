# -*- coding: utf-8 -*-
"""Positions for Date (Secondary Progressions by real date)

규칙(요약):
- 1년(현실) = 1일(에피메리스)
- 1일(현실) = 1/365 or 1/366 (그레고리 윤년)
- 행성: 분수일 그대로(스위스에페메리스 보간/계산 그대로)
- 감응점(Asc/MC/커스프 등): '정수년(=정수 에피메리스 일)'과 그 다음 1일 사이 이동량을
  365/366으로 나눠 선형 보간
- LoF: 보간된 Asc 기준으로 주/야 판정 후, 보간된 Asc로 재계산
"""

import copy
import math

import astrology
import chart
import houses
import planets
import primdirs
import util

# Progression methods
SECONDARY = 0
SOLAR_ARC = 1
MINOR = 2
TERTIARY = 3

TROPICAL_YEAR = 365.24219907
MEAN_LUNAR_MONTH = 27.32158648

METHOD_NAMES = {
    SECONDARY: 'Secondary',
    SOLAR_ARC: 'Solar Arc',
    MINOR: 'Minor',
    TERTIARY: 'Tertiary',
}

PROGRESSION_DAY_TYPE_Q2 = 0
PROGRESSION_DAY_TYPE_Q1 = 1

PROGRESSION_DAY_TYPE_NAMES = {
    PROGRESSION_DAY_TYPE_Q2: 'Q2 / Standard',
    PROGRESSION_DAY_TYPE_Q1: 'Q1 / Bija',
}

TRUE_SOLAR_ARC_LON = 0
TRUE_SOLAR_ARC_RA = 1
NAIBOD_LON = 2
NAIBOD_RA = 3
MEAN_QUOTIDIAN_Q2 = 4

ANGLE_METHOD_NAMES = {
    TRUE_SOLAR_ARC_LON: 'True Solar Arc (Lon)',
    TRUE_SOLAR_ARC_RA: 'True Solar Arc (RA)',
    NAIBOD_LON: 'Naibod (Lon)',
    NAIBOD_RA: 'Naibod (RA)',
    MEAN_QUOTIDIAN_Q2: 'Q2 / Mean Quotidian',
}

MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR = 360.98564736629

# --- Serve-time localization ------------------------------------------------
# The *_NAMES dicts above keep their English identity: they are consumed by the
# legacy wx dialogs, by log/Recorder labels, and as stable comparison values.
# Webapp payloads (options_service / manifest_service) must instead show the
# active language, so the labels are re-resolved through mtexts when the payload
# is assembled. These key maps + *_label helpers are that serve-time boundary.
ANGLE_METHOD_NAME_KEYS = {
    TRUE_SOLAR_ARC_LON: 'TrueSolarArcLon',
    TRUE_SOLAR_ARC_RA: 'TrueSolarArcRA',
    NAIBOD_LON: 'NaibodLon',
    NAIBOD_RA: 'NaibodRA',
    MEAN_QUOTIDIAN_Q2: 'Q2MeanQuotidian',
}

PROGRESSION_DAY_TYPE_NAME_KEYS = {
    PROGRESSION_DAY_TYPE_Q2: 'Q2Standard',
    PROGRESSION_DAY_TYPE_Q1: 'Q1Bija',
}


def _txt(key, english):
    """Resolve a user-facing label through mtexts at serve time (English fallback)."""
    try:
        import mtexts
        return str(mtexts.txts.get(key, english))
    except Exception:
        return english


def progression_angle_method_label(method):
    """Localized display label for an angle method (webapp serve boundary)."""
    method = progression_angle_method(method)
    return _txt(ANGLE_METHOD_NAME_KEYS[method], ANGLE_METHOD_NAMES[method])


def progression_day_type_label(day_type):
    """Localized display label for a progression day type (webapp serve boundary)."""
    day_type = progression_day_type(day_type)
    return _txt(PROGRESSION_DAY_TYPE_NAME_KEYS[day_type], PROGRESSION_DAY_TYPE_NAMES[day_type])


def progression_method(method):
    try:
        method = int(method)
    except Exception:
        method = SECONDARY
    if method not in METHOD_NAMES:
        return SECONDARY
    return method


def progression_method_name(method):
    return METHOD_NAMES.get(progression_method(method), METHOD_NAMES[SECONDARY])


def progression_day_type(day_type):
    try:
        day_type = int(day_type)
    except Exception:
        day_type = PROGRESSION_DAY_TYPE_Q2
    if day_type not in PROGRESSION_DAY_TYPE_NAMES:
        return PROGRESSION_DAY_TYPE_Q2
    return day_type


def progression_day_type_name(day_type):
    return PROGRESSION_DAY_TYPE_NAMES.get(
        progression_day_type(day_type),
        PROGRESSION_DAY_TYPE_NAMES[PROGRESSION_DAY_TYPE_Q2],
    )


def progression_chart_day_type(chrt, default=PROGRESSION_DAY_TYPE_Q2):
    try:
        return progression_day_type(getattr(chrt, '_progression_day_type'))
    except Exception:
        return progression_day_type(default)


def progression_symbolic_scale(method):
    method = progression_method(method)
    if method == MINOR:
        return MEAN_LUNAR_MONTH
    if method == TERTIARY:
        return TROPICAL_YEAR / MEAN_LUNAR_MONTH
    return 1.0


def progression_chart_method(chrt, default=SECONDARY):
    try:
        return progression_method(getattr(chrt, '_progression_method'))
    except Exception:
        return progression_method(default)


def progression_angle_method(method):
    try:
        method = int(method)
    except Exception:
        method = TRUE_SOLAR_ARC_LON
    if method not in ANGLE_METHOD_NAMES:
        return TRUE_SOLAR_ARC_LON
    return method


def progression_angle_method_name(method):
    return ANGLE_METHOD_NAMES.get(
        progression_angle_method(method),
        ANGLE_METHOD_NAMES[TRUE_SOLAR_ARC_LON],
    )


def progression_chart_angle_method(chrt, default=TRUE_SOLAR_ARC_LON):
    try:
        return progression_angle_method(getattr(chrt, '_progressed_angle_method'))
    except Exception:
        return progression_angle_method(default)


def _signed_shortest_angle_delta(a1, a0):
    """Return signed delta (a1-a0) wrapped to (-180, 180]."""
    d = float(a1) - float(a0)
    if d > 180.0:
        d -= 360.0
    elif d <= -180.0:
        d += 360.0
    return d


def _revjul_datetime_fields(jd_value, calflag):
    """Convert a Julian day to whole-second fields with time carry normalized."""
    py, pm, pd, ptime = astrology.swe_revjul(float(jd_value), calflag)
    total_seconds = int(round(float(ptime) * 3600.0))
    if total_seconds >= 24 * 3600:
        total_seconds -= 24 * 3600
        py, pm, pd = util.incrDay(int(py), int(pm), int(pd))
    elif total_seconds < 0:
        total_seconds += 24 * 3600
        py, pm, pd = util.decrDay(int(py), int(pm), int(pd))
    ph = total_seconds // 3600
    total_seconds %= 3600
    pmi = total_seconds // 60
    ps = total_seconds % 60
    return int(py), int(pm), int(pd), int(ph), int(pmi), int(ps)


def _offset_body_longitudes(body, arc):
    if body is None:
        return
    try:
        body.data = (util.normalize(body.data[0] + arc),) + tuple(body.data[1:])
    except Exception:
        pass
    try:
        body.dataEqu = (util.normalize(body.dataEqu[0] + arc),) + tuple(body.dataEqu[1:])
    except Exception:
        pass


def _offset_dynamic_chart_bodies(chrt, arc):
    """Apply a uniform solar-arc shift to chart-side dynamic bodies."""
    for attr_name in ('chiron',):
        _offset_body_longitudes(getattr(chrt, attr_name, None), arc)


def _cotrans_lon_to_equ(lon, obl):
    ra, decl, _ = astrology.swe_cotrans(float(lon), 0.0, 1.0, -float(obl))
    return float(ra), float(decl)


def _cotrans_equ_to_lon(ra, decl, obl):
    lon, lat, _ = astrology.swe_cotrans(float(ra), float(decl), 1.0, float(obl))
    return float(lon), float(lat)


def _armc_from_mc_longitude(mc_lon, obl):
    """Inverse of Swiss Ephemeris armc->MC mapping for longitude-based methods."""
    mc_lon = util.normalize(float(mc_lon))
    if abs(mc_lon - 90.0) <= 1e-12:
        return 90.0
    if abs(mc_lon - 270.0) <= 1e-12:
        return 270.0
    armc = math.degrees(math.atan(math.tan(math.radians(mc_lon)) * math.cos(math.radians(float(obl)))))
    if 90.0 < mc_lon <= 270.0:
        armc += 180.0
    elif mc_lon > 270.0:
        armc += 360.0
    return util.normalize(armc)


def _obl_ut(jd_ut):
    d = astrology.swe_deltat(jd_ut)
    serr, x = astrology.swe_calc(jd_ut + d, astrology.SE_ECL_NUT, 0)
    return float(x[0])


def _ayan_ut(jd_ut, options):
    if getattr(options, 'ayanamsha', 0) != 0:
        astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(options.ayanamsha), 0, 0)
        return float(astrology.swe_get_ayanamsa_ut(jd_ut))
    return 0.0


def _build_interpolated_houses(jd_base, jd_next, frac, place, options, obl_final, ayan_final):
    """Create a Houses instance at jd_base, then overwrite with interpolated values."""
    hflag = 0

    obl0 = _obl_ut(jd_base)
    obl1 = _obl_ut(jd_next)
    ay0 = _ayan_ut(jd_base, options)
    ay1 = _ayan_ut(jd_next, options)

    hb = houses.Houses(jd_base, hflag, place.lat, place.lon, options.hsys, obl0, options.ayanamsha, ay0)
    hn = houses.Houses(jd_next, hflag, place.lat, place.lon, options.hsys, obl1, options.ayanamsha, ay1)

    # Start with a fresh houses object (same time system), then overwrite.
    hout = houses.Houses(jd_base, hflag, place.lat, place.lon, options.hsys, obl_final, options.ayanamsha, ayan_final)

    # --- interpolate cusps ---
    cusps = [0.0] * (houses.Houses.HOUSE_NUM + 1)
    cusps[0] = 0.0
    for i in range(1, houses.Houses.HOUSE_NUM + 1):
        d = _signed_shortest_angle_delta(hn.cusps[i], hb.cusps[i])
        cusps[i] = util.normalize(hb.cusps[i] + d * frac)

    # Whole sign sidereal special-case (Morinus 기존 정책 유지)
    if getattr(options, 'ayanamsha', 0) != 0 and options.hsys == 'W':
        # Houses.__init__의 로직을 재현: sid asc = tropical asc - ayan
        asc_sid = util.normalize(hb.ascmc[houses.Houses.ASC] - ayan_final)
        sign = int(asc_sid / 30.0)
        for i in range(houses.Houses.HOUSE_NUM):
            cusps[i + 1] = util.normalize((sign + i) * 30.0 + ayan_final)

    # --- interpolate ascmc array (ASC/MC 포함) ---
    ascmc = [0.0] * len(hb.ascmc)
    for j in range(len(ascmc)):
        d = _signed_shortest_angle_delta(hn.ascmc[j], hb.ascmc[j])
        ascmc[j] = util.normalize(hb.ascmc[j] + d * frac)

    # Write back
    hout.obl = float(obl_final)
    hout.cusps = tuple(cusps)
    hout.ascmc = tuple(ascmc)

    # ascmc2: (ASC lon/lat/RA/decl, MC lon/lat/RA/decl)
    asc_lon = hout.ascmc[houses.Houses.ASC]
    mc_lon = hout.ascmc[houses.Houses.MC]
    asc_ra, asc_decl = _cotrans_lon_to_equ(asc_lon, obl_final)
    mc_ra, mc_decl = _cotrans_lon_to_equ(mc_lon, obl_final)
    hout.ascmc2 = ((asc_lon, 0.0, asc_ra, asc_decl), (mc_lon, 0.0, mc_ra, mc_decl))

    # Regiomontanus MP values
    try:
        qasc = math.degrees(math.asin(math.tan(math.radians(asc_decl)) * math.tan(math.radians(place.lat))))
    except Exception:
        qasc = 0.0
    hout.regioMPAsc = asc_ra - qasc
    hout.regioMPMC = mc_ra

    # cusps2 + cuspstmp
    hout.cuspstmp = [[0.0, 0.0] for _ in range(houses.Houses.HOUSE_NUM)]
    cusps2 = []
    for i in range(houses.Houses.HOUSE_NUM):
        ra, decl = _cotrans_lon_to_equ(hout.cusps[i + 1], obl_final)
        hout.cuspstmp[i][0] = ra
        hout.cuspstmp[i][1] = decl
        cusps2.append((ra, decl))
    hout.cusps2 = tuple(cusps2)

    return hout


def _build_houses_from_armc(armc, place, options, obl, ayan):
    hsys = options.hsys if getattr(options, 'hsys', None) in houses.Houses.hsystems else houses.Houses.hsystems[0]
    res, raw_cusps, raw_ascmc = astrology.swe_houses_armc(
        util.normalize(float(armc)), float(place.lat), float(obl), ord(hsys)
    )

    house_obj = houses.Houses(2451545.0, 0, place.lat, place.lon, hsys, obl, options.ayanamsha, ayan)
    cusps = list(raw_cusps)
    ascmc = list(raw_ascmc)

    if getattr(options, 'ayanamsha', 0) != 0 and hsys == 'W':
        asc_sid = util.normalize(ascmc[houses.Houses.ASC] - ayan)
        sign = int(asc_sid / 30.0)
        cusp_list = [0.0]
        for i in range(houses.Houses.HOUSE_NUM):
            cusp_list.append(util.normalize((sign + i) * 30.0 + ayan))
        cusps = cusp_list

    house_obj.obl = float(obl)
    house_obj.cusps = tuple(float(v) for v in cusps)
    house_obj.ascmc = tuple(float(v) for v in ascmc)

    asc_lon = house_obj.ascmc[houses.Houses.ASC]
    mc_lon = house_obj.ascmc[houses.Houses.MC]
    asc_ra, asc_decl = _cotrans_lon_to_equ(asc_lon, obl)
    mc_ra, mc_decl = _cotrans_lon_to_equ(mc_lon, obl)
    house_obj.ascmc2 = ((asc_lon, 0.0, asc_ra, asc_decl), (mc_lon, 0.0, mc_ra, mc_decl))

    try:
        qasc = math.degrees(math.asin(math.tan(math.radians(asc_decl)) * math.tan(math.radians(place.lat))))
    except Exception:
        qasc = 0.0
    house_obj.regioMPAsc = asc_ra - qasc
    house_obj.regioMPMC = mc_ra

    house_obj.cuspstmp = [[0.0, 0.0] for _ in range(houses.Houses.HOUSE_NUM)]
    cusps2 = []
    for i in range(houses.Houses.HOUSE_NUM):
        ra, decl = _cotrans_lon_to_equ(house_obj.cusps[i + 1], obl)
        house_obj.cuspstmp[i][0] = ra
        house_obj.cuspstmp[i][1] = decl
        cusps2.append((ra, decl))
    house_obj.cusps2 = tuple(cusps2)
    return house_obj


def _build_houses_from_progressed_angle_method(radix_chart, options, angle_method, age_years, jd_prog, symbolic_age):
    angle_method = progression_angle_method(angle_method)
    obl_final = _obl_ut(jd_prog)
    ayan_final = _ayan_ut(jd_prog, options)
    natal_houses = radix_chart.houses

    if angle_method == TRUE_SOLAR_ARC_LON:
        pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
        serr, prog_sun = astrology.swe_calc_ut(jd_prog, astrology.SE_SUN, pflag)
        serr, natal_sun = astrology.swe_calc_ut(float(radix_chart.time.jd), astrology.SE_SUN, pflag)
        mc_arc = _signed_shortest_angle_delta(prog_sun[0], natal_sun[0])
        mc_lon = util.normalize(natal_houses.ascmc[houses.Houses.MC] + mc_arc)
        armc = _armc_from_mc_longitude(mc_lon, obl_final)
        return _build_houses_from_armc(armc, radix_chart.place, options, obl_final, ayan_final)

    if angle_method == TRUE_SOLAR_ARC_RA:
        pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED | astrology.SEFLG_EQUATORIAL
        serr, prog_sun = astrology.swe_calc_ut(jd_prog, astrology.SE_SUN, pflag)
        serr, natal_sun = astrology.swe_calc_ut(float(radix_chart.time.jd), astrology.SE_SUN, pflag)
        armc = util.normalize(natal_houses.ascmc[houses.Houses.ARMC] + _signed_shortest_angle_delta(prog_sun[0], natal_sun[0]))
        return _build_houses_from_armc(armc, radix_chart.place, options, obl_final, ayan_final)

    naibod_arc = (
        primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.DEG]
        + primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.MIN] / 60.0
        + primdirs.PrimDirs.staticData[primdirs.PrimDirs.NAIBOD][primdirs.PrimDirs.SEC] / 3600.0
    ) * age_years

    if angle_method == NAIBOD_LON:
        mc_lon = util.normalize(natal_houses.ascmc[houses.Houses.MC] + naibod_arc)
        natal_obl = float(getattr(radix_chart, 'obl', (obl_final,))[0])
        armc = _armc_from_mc_longitude(mc_lon, natal_obl)
        return _build_houses_from_armc(armc, radix_chart.place, options, obl_final, ayan_final)

    if angle_method == NAIBOD_RA:
        armc = util.normalize(natal_houses.ascmc[houses.Houses.ARMC] + naibod_arc)
        return _build_houses_from_armc(armc, radix_chart.place, options, obl_final, ayan_final)

    armc = util.normalize(natal_houses.ascmc[houses.Houses.ARMC] + (age_years * MEAN_QUOTIDIAN_ARMC_DEG_PER_YEAR))
    return _build_houses_from_armc(armc, radix_chart.place, options, obl_final, ayan_final)


def progressed_angle_state_for_symbolic_age(radix_chart, options, symbolic_age, method=SECONDARY, angle_method=None):
    """Return progressed house/angle state without building a full Chart."""
    method = progression_method(method)
    symbolic_age = float(symbolic_age)
    scale = progression_symbolic_scale(method)
    birth_jd = float(radix_chart.time.jd)
    jd_prog = birth_jd + symbolic_age
    age_years = symbolic_age / scale if scale != 0.0 else symbolic_age
    if angle_method is None:
        angle_method = getattr(options, 'progressed_angle_method', TRUE_SOLAR_ARC_LON)
    angle_method = progression_angle_method(angle_method)

    houses_obj = _build_houses_from_progressed_angle_method(
        radix_chart, options, angle_method, age_years, jd_prog, symbolic_age
    )
    obl_final = _obl_ut(jd_prog)
    raequasc, _declequasc, _dist = astrology.swe_cotrans(
        houses_obj.ascmc[houses.Houses.EQUASC], 0.0, 1.0, -obl_final
    )
    return {
        'jd_prog': float(jd_prog),
        'age_years': float(age_years),
        'symbolic_age': float(symbolic_age),
        'houses': houses_obj,
        'asc_lon': float(houses_obj.ascmc[houses.Houses.ASC]),
        'mc_lon': float(houses_obj.ascmc[houses.Houses.MC]),
        'ascmc2': houses_obj.ascmc2,
        'raequasc': float(raequasc),
        'obl': float(obl_final),
    }


def make_progressed_chart_by_symbolic_age(radix_chart, options, symbolic_age, method=SECONDARY, angle_method=None):
    """Build a progressed chart from symbolic age (ephemeris days since birth)."""
    nt = radix_chart.time
    method = progression_method(method)
    symbolic_age = float(symbolic_age)
    scale = progression_symbolic_scale(method)

    # UT anchor fixed to radix UT
    try:
        ut_anchor = float(nt.time)
    except Exception:
        ut_anchor = float(nt.hour) + float(nt.minute) / 60.0 + float(nt.second) / 3600.0

    birth_jd = float(nt.jd)
    calflag = astrology.SE_JUL_CAL if nt.cal == chart.Time.JULIAN else astrology.SE_GREG_CAL
    age_years = symbolic_age / scale if scale != 0.0 else symbolic_age
    if angle_method is None:
        angle_method = getattr(options, 'progressed_angle_method', TRUE_SOLAR_ARC_LON)
    angle_method = progression_angle_method(angle_method)

    if method == SOLAR_ARC:
        years_passed = int(math.floor(age_years + 1e-12)) if age_years >= 0.0 else int(math.ceil(age_years - 1e-12))
        return _make_solar_arc_chart(radix_chart, options, birth_jd, age_years, calflag, years_passed, angle_method)

    jd_prog = birth_jd + symbolic_age

    py, pm, pd, ph, pmi, ps = _revjul_datetime_fields(jd_prog, calflag)

    tm_prog = chart.Time(int(py), int(pm), int(pd), ph, pmi, ps, False, nt.cal,
                         chart.Time.GREENWICH, True, 0, 0, False, radix_chart.place, False)
    prg = chart.Chart(radix_chart.name, radix_chart.male, tm_prog, radix_chart.place,
                      chart.Chart.TRANSIT, '', options, False)

    # ensure topo settings match Chart.create policy
    if getattr(options, 'topocentric', False):
        try:
            astrology.swe_set_topo(radix_chart.place.lon, radix_chart.place.lat, radix_chart.place.altitude)
        except Exception:
            pass

    prg._apply_house_geometry(
        _build_houses_from_progressed_angle_method(
            radix_chart, options, angle_method, age_years, jd_prog, symbolic_age
        ),
        materialize_optional=False,
    )

    prg._progression_method = method
    prg._progression_day_type = progression_day_type(
        getattr(options, 'progression_day_type', PROGRESSION_DAY_TYPE_Q2)
    )
    prg._progressed_angle_method = angle_method
    prg._progression_age_years = float(age_years)
    prg._progression_symbolic_age = float(symbolic_age)

    years_passed = int(math.floor(age_years + 1e-12)) if age_years >= 0.0 else int(math.ceil(age_years - 1e-12))
    return years_passed, age_years, (int(py), int(pm), int(pd)), prg


def make_progressed_chart_by_real_date(radix_chart, options, yy, mm, dd, hh=None, mi=None, ss=None, method=SECONDARY, angle_method=None):
    """Build a progressed chart for a real date using the requested Positions for Date rules.

    Returns:
        (age_int_years, age_years_float, progressed_date_tuple, progressed_chart)
    """
    nt = radix_chart.time
    method = progression_method(method)

    try:
        ut_anchor = float(nt.time)
    except Exception:
        ut_anchor = float(nt.hour) + float(nt.minute) / 60.0 + float(nt.second) / 3600.0

    import symbolic_time
    if hh is None:
        hh = int(nt.hour)
    if mi is None:
        mi = int(nt.minute)
    if ss is None:
        ss = int(nt.second)
    real_dt = (int(yy), int(mm), int(dd), int(hh), int(mi), int(ss))
    if method == SOLAR_ARC:
        symbolic_age = symbolic_time.solar_arc_age_for_real_datetime(radix_chart, real_dt)
    else:
        symbolic_age = symbolic_time.symbolic_age_for_real_datetime(
            radix_chart,
            real_dt,
            method=method,
            day_type=getattr(options, 'progression_day_type', PROGRESSION_DAY_TYPE_Q2),
        )
    return make_progressed_chart_by_symbolic_age(
        radix_chart, options, symbolic_age, method=method, angle_method=angle_method
    )


def _make_solar_arc_chart(radix_chart, options, birth_jd, age_years, calflag, years_passed, angle_method=None):
    """Build a solar arc directed chart: uniform angular offset on all natal bodies."""
    angle_method = progression_angle_method(
        angle_method if angle_method is not None
        else getattr(options, 'progressed_angle_method', TRUE_SOLAR_ARC_LON)
    )

    # Secondary progressed Sun
    jd_sec = birth_jd + age_years
    pflag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
    if getattr(options, 'topocentric', False):
        pflag |= astrology.SEFLG_TOPOCTR
    if getattr(options, 'ayanamsha', 0) != 0:
        astrology.swe_set_sid_mode(astrology.ayanamsha_swe_mode(options.ayanamsha), 0, 0)

    serr, prog_sun = astrology.swe_calc_ut(jd_sec, astrology.SE_SUN, pflag)
    serr, natal_sun = astrology.swe_calc_ut(birth_jd, astrology.SE_SUN, pflag)
    arc = _signed_shortest_angle_delta(prog_sun[0], natal_sun[0])

    # Clone the natal chart
    prg = copy.deepcopy(radix_chart)
    prg.htype = chart.Chart.TRANSIT

    # Offset all planet longitudes
    for p in prg.planets.planets:
        _offset_body_longitudes(p, arc)
    _offset_dynamic_chart_bodies(prg, arc)

    prg.houses = _build_houses_from_progressed_angle_method(
        radix_chart, options, angle_method, age_years, jd_sec, age_years
    )
    try:
        obl_values = list(prg.obl)
        obl_values[0] = float(prg.houses.obl)
        prg.obl = tuple(obl_values)
    except Exception:
        pass
    try:
        prg.raequasc, _declequasc, _dist = astrology.swe_cotrans(
            util.to_tropical_lon(
                prg.houses.ascmc[houses.Houses.EQUASC],
                getattr(prg, 'ayanamsha_offset', 0.0),
            ),
            0.0, 1.0, -float(prg.houses.obl),
        )
    except Exception:
        pass

    # Recompute LoF
    try:
        prg.calcFortune()
    except Exception:
        pass

    # The solar-arc chart starts as a deepcopy of the radix, including its
    # cached aspect matrices.  A uniform body shift preserves planet-to-planet
    # geometry, but the progressed houses/angles are built independently, so
    # every angle/house aspect cache must be rebuilt from the directed state.
    prg.calcAspMatrix()

    py, pm, pd, ph, pmi, ps = _revjul_datetime_fields(jd_sec, calflag)
    prg.time = chart.Time(int(py), int(pm), int(pd), ph, pmi, ps, False, radix_chart.time.cal,
                          chart.Time.GREENWICH, True, 0, 0, False, radix_chart.place, False)
    prg._progression_method = SOLAR_ARC
    prg._progression_day_type = PROGRESSION_DAY_TYPE_Q2
    prg._progressed_angle_method = angle_method
    prg._progression_age_years = float(age_years)
    prg._progression_symbolic_age = float(age_years)
    prg._solar_arc_degrees = float(arc)
    return years_passed, age_years, (int(py), int(pm), int(pd)), prg
