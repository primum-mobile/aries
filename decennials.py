# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Valens Decennials on the 360-day schematic clock.

L1 lasts 129 months (10 years 9 months, or 3,870 days). L2 distributes
the seven planetary minor numbers as months. Lower levels may either divide
their parent proportionally by those numbers or repeat them as days and hours.
The default apheta follows Valens' complex predomination rules as summarized
by Demetra George, volume II, chapter 92, table 85. All levels begin with their
parent ruler and continue in natal zodiacal order.
"""
import datetime
import astrology, planets, util, houses, fortune

from engine import solar_proximity

MINOR_MONTHS = {
    astrology.SE_SATURN: 30,
    astrology.SE_JUPITER: 12,
    astrology.SE_MARS:    15,
    astrology.SE_SUN:     19,
    astrology.SE_VENUS:    8,
    astrology.SE_MERCURY: 20,
    astrology.SE_MOON:    25,
}

SCHEMATIC_DAY   = 1.0
SCHEMATIC_MONTH = 30 * SCHEMATIC_DAY
L1_MONTHS = 129
L1_DAYS   = L1_MONTHS * SCHEMATIC_MONTH
MINOR_TOTAL = 129.0  # 발렌스식 재분배 계수(소년수 합계)

def _chart_datetime(chart):
    # 시작 시각은 "원본 현지 입력" 기준으로 고정 (UTC 변환 금지)
    t = chart.time
    y  = int(getattr(t, 'origyear',  getattr(t, 'year')))
    m  = int(getattr(t, 'origmonth', getattr(t, 'month')))
    d  = int(getattr(t, 'origday',   getattr(t, 'day')))
    hh = int(getattr(t, 'hour',    0))
    mi = int(getattr(t, 'minute',  0))
    ss = int(getattr(t, 'second',  0))
    return datetime.datetime(y, m, d, hh, mi, ss)

def _seven_classicals():
    return [astrology.SE_SATURN, astrology.SE_JUPITER, astrology.SE_MARS,
            astrology.SE_SUN, astrology.SE_VENUS, astrology.SE_MERCURY, astrology.SE_MOON]

def _is_diurnal(chart):
    """Use Valens' astronomical sect, without the configurable day/night orb."""
    try:
        return bool(chart.planets.planets[astrology.SE_SUN].abovehorizon)
    except Exception:
        try:
            return bool(chart.isAboveHorizonWithOrb())
        except Exception:
            return True

def _planet_order(chart, options):
    pairs = []
    for p in _seven_classicals():
        lon = chart.planets.planets[p].data[planets.Planet.LONG]
        pairs.append((p, lon))
    pairs.sort(key=lambda x: x[1])
    start = astrology.SE_SUN if _is_diurnal(chart) else astrology.SE_MOON
    idx = 0
    for i,(pp,_) in enumerate(pairs):
        if pp == start:
            idx = i; break
    order = [pairs[(idx+i) % 7][0] for i in range(7)]
    return order

def _planet_order_raw(chart, options):
    """황도경도 오름차순 정렬(회전 없음). 반환: [행성se_index..]"""
    pairs = []
    for p in _seven_classicals():
        lon = chart.planets.planets[p].data[planets.Planet.LONG]
        pairs.append((p, lon))
    pairs.sort(key=lambda x: x[1])
    return [pp for (pp, _) in pairs]

def _planet_after_degree(chart, options, deg):
    """deg 이후 최초로 나타나는 행성을 반환(없으면 첫 원소)."""
    pairs = []
    for p in _seven_classicals():
        lon = chart.planets.planets[p].data[planets.Planet.LONG]
        pairs.append((p, lon))
    pairs.sort(key=lambda x: x[1])
    deg = util.normalize(float(deg))
    for (pp, lon) in pairs:
        if lon >= deg:
            return pp
    return pairs[0][0]

def _longitude(chart, planet_id):
    return float(chart.planets.planets[planet_id].data[planets.Planet.LONG])


def _whole_sign_house(longitude, ascendant):
    return ((int(util.normalize(longitude) // 30.0) - int(util.normalize(ascendant) // 30.0)) % 12) + 1


def _porphyry_frame(chart, options):
    current = getattr(chart, 'houses', None)
    if getattr(current, 'ui_hsys', None) == 'O':
        return current
    _pflag, hflag, _fsflag, _astflag = chart._zodiac_flags()
    return houses.Houses(
        chart.time.jd,
        hflag,
        chart.place.lat,
        chart.place.lon,
        'O',
        chart.obl[0],
        options.ayanamsha,
        getattr(chart, 'ayanamsha_offset', 0.0),
    )


def _luminary_houses(chart, options, house_system):
    asc = float(chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON])
    sun_lon = _longitude(chart, astrology.SE_SUN)
    moon_lon = _longitude(chart, astrology.SE_MOON)
    if house_system == 'porphyry':
        frame = _porphyry_frame(chart, options)
        return (
            int(frame.getHousePos(sun_lon, options, False)) + 1,
            int(frame.getHousePos(moon_lon, options, False)) + 1,
        )
    return _whole_sign_house(sun_lon, asc), _whole_sign_house(moon_lon, asc)


def _partile_ascendant(longitude, ascendant):
    """George's gloss: partile means the same whole-integer zodiacal degree."""
    return int(util.normalize(longitude)) == int(util.normalize(ascendant))


def _moon_under_beams(chart):
    try:
        result = solar_proximity.classify_chart_body(
            chart,
            astrology.SE_MOON,
            profile=solar_proximity.PROFILE_LATE_HELLENISTIC,
        )
        if result.supported:
            return result.state != solar_proximity.STATE_CLEAR
    except Exception:
        pass
    separation = abs((_longitude(chart, astrology.SE_MOON) - _longitude(chart, astrology.SE_SUN) + 180.0) % 360.0 - 180.0)
    return separation <= 15.0


def _prenatal_new_moon_longitude(chart):
    syzygy = chart.syzygy
    if bool(syzygy.newmoon):
        return float(syzygy.lon)
    return float(syzygy.lon2)


def _point_result(chart, options, point, longitude, rule, start_longitude=None, **extra):
    longitude = util.normalize(float(longitude))
    distribution_degree = longitude if start_longitude is None else util.normalize(float(start_longitude))
    return {
        'apheta_kind': point,
        'apheta_planet': None,
        'apheta_longitude': longitude,
        'start_planet': _planet_after_degree(chart, options, distribution_degree),
        'rule': rule,
        **extra,
    }


def _luminary_result(planet_id, rule, **extra):
    return {
        'apheta_kind': (
            'sun' if planet_id == astrology.SE_SUN else
            'moon' if planet_id == astrology.SE_MOON else
            'planet'
        ),
        'apheta_planet': planet_id,
        'apheta_longitude': None,
        'start_planet': planet_id,
        'rule': rule,
        **extra,
    }


def resolve_valens_apheta(chart, options, house_system='whole_sign', overlap_resolution='table'):
    """Resolve Valens' predominator using George II, table 85 (pp. 1052-54).

    The source contains two overlapping rules: Sun 5/Moon 9 and Sun 9/Moon
    11 occur both in the direct luminary table and in the ray-to-Ascendant
    rule.  ``overlap_resolution`` therefore remains an explicit interpretation
    rather than hiding the textual conflict in the calculation.
    """
    house_system = str(house_system or 'whole_sign').strip().lower()
    if house_system not in {'whole_sign', 'porphyry'}:
        house_system = 'whole_sign'
    overlap_resolution = str(overlap_resolution or 'table').strip().lower()
    if overlap_resolution not in {'table', 'sun_ray', 'moon_ray'}:
        overlap_resolution = 'table'

    sun_house, moon_house = _luminary_houses(chart, options, house_system)
    asc = float(chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON])
    mc = float(chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON])
    sun_lon = _longitude(chart, astrology.SE_SUN)
    moon_lon = _longitude(chart, astrology.SE_MOON)
    overlapping = (sun_house, moon_house) in {(5, 9), (9, 11)}
    common = {
        'house_system': house_system,
        'sun_house': sun_house,
        'moon_house': moon_house,
        'ambiguous': False,
        'overlap_applicable': overlapping,
    }

    # The point-based rules are independent of either luminary's eligibility.
    if sun_house == moon_house and sun_house in {1, 4, 7, 10}:
        return _point_result(
            chart,
            options,
            'prenatal_new_moon',
            _prenatal_new_moon_longitude(chart),
            'both_lights_angular_new_moon',
            start_longitude=asc,
            **common,
        )
    if sun_house == moon_house == 9:
        return _point_result(
            chart, options, 'ascendant', asc, 'both_lights_ninth_ascendant',
            start_longitude=asc, **common,
        )
    if sun_house == moon_house and sun_house in {3, 12}:
        return _point_result(
            chart, options, 'midheaven', mc, 'both_lights_cadent_midheaven',
            start_longitude=asc, **common,
        )

    sun_partile_asc = _partile_ascendant(sun_lon, asc)
    moon_partile_asc = _partile_ascendant(moon_lon, asc)
    sun_disqualified = int(util.normalize(sun_lon) // 30.0) == 6 and not sun_partile_asc
    moon_disqualified = (
        int(util.normalize(moon_lon) // 30.0) == 7 or _moon_under_beams(chart)
    ) and not moon_partile_asc

    if overlapping and overlap_resolution != 'table':
        chosen = astrology.SE_SUN if overlap_resolution == 'sun_ray' else astrology.SE_MOON
        chosen_disqualified = sun_disqualified if chosen == astrology.SE_SUN else moon_disqualified
        if not chosen_disqualified:
            return _luminary_result(
                chosen,
                'overlap_sun_ray' if chosen == astrology.SE_SUN else 'overlap_moon_ray',
                **{**common, 'ambiguous': True},
            )

    sun_wins = {(1, 12), (11, 10), (7, 8), (8, 7), (4, 9), (5, 9)}
    moon_wins = {(9, 1), (9, 2), (9, 4), (9, 10), (9, 11), (9, 5)}
    pair = (sun_house, moon_house)
    if pair in sun_wins and not sun_disqualified:
        return _luminary_result(
            astrology.SE_SUN,
            'table_sun',
            **{**common, 'ambiguous': overlapping},
        )
    if pair in moon_wins and not moon_disqualified:
        return _luminary_result(
            astrology.SE_MOON,
            'table_moon',
            **{**common, 'ambiguous': overlapping},
        )

    profitable = {1, 2, 4, 5, 7, 8, 10, 11}
    sun_eligible = sun_house in profitable and not sun_disqualified
    moon_eligible = moon_house in profitable and not moon_disqualified
    if sun_eligible != moon_eligible:
        chosen = astrology.SE_SUN if sun_eligible else astrology.SE_MOON
        reason = 'general_house_sun' if sun_eligible else 'general_house_moon'
        return _luminary_result(chosen, reason, **{**common, 'ambiguous': True})
    if sun_eligible and moon_eligible:
        chosen = astrology.SE_SUN if _is_diurnal(chart) else astrology.SE_MOON
        if chosen == astrology.SE_SUN and sun_disqualified:
            chosen = astrology.SE_MOON
        elif chosen == astrology.SE_MOON and moon_disqualified:
            chosen = astrology.SE_SUN
        return _luminary_result(chosen, 'general_sect_hierarchy', **{**common, 'ambiguous': True})

    # George/Hand explicitly note gaps.  Valens' general instruction gives the
    # Ascendant to a day chart and the Midheaven to a night chart when neither
    # light can take the role; retain the ambiguity marker for manual review.
    if _is_diurnal(chart):
        return _point_result(
            chart, options, 'ascendant', asc, 'general_cadent_ascendant',
            start_longitude=asc, **{**common, 'ambiguous': True},
        )
    return _point_result(
        chart, options, 'midheaven', mc, 'general_cadent_midheaven',
        start_longitude=asc, **{**common, 'ambiguous': True},
    )


def resolve_start_info(
    chart,
    options,
    selector='valens_apheta',
    house_system='whole_sign',
    overlap_resolution='table',
):
    s = (selector or 'valens_apheta').strip().lower()
    if s == 'valens_apheta':
        return resolve_valens_apheta(chart, options, house_system, overlap_resolution)
    if s == 'sect':
        return _luminary_result(
            astrology.SE_SUN if _is_diurnal(chart) else astrology.SE_MOON,
            'manual_sect_light',
            house_system=house_system,
            sun_house=None,
            moon_house=None,
            ambiguous=False,
        )
    pmap = {
        'sun': astrology.SE_SUN, 'moon': astrology.SE_MOON,
        'mercury': astrology.SE_MERCURY, 'venus': astrology.SE_VENUS,
        'mars': astrology.SE_MARS, 'jupiter': astrology.SE_JUPITER,
        'saturn': astrology.SE_SATURN,
    }
    if s in pmap:
        return _luminary_result(
            pmap[s], 'manual_planet', house_system=house_system,
            sun_house=None, moon_house=None, ambiguous=False,
        )
    point_degrees = {
        'asc': ('ascendant', chart.houses.ascmc2[houses.Houses.ASC][houses.Houses.LON]),
        'mc': ('midheaven', chart.houses.ascmc2[houses.Houses.MC][houses.Houses.LON]),
        'prenatal_new_moon': ('prenatal_new_moon', _prenatal_new_moon_longitude(chart)),
        'fortune': ('fortune', chart.fortune.fortune[fortune.Fortune.LON]),
    }
    if s in point_degrees:
        point, degree = point_degrees[s]
        return _point_result(
            chart, options, point, degree, 'manual_point', house_system=house_system,
            sun_house=None, moon_house=None, ambiguous=False,
        )
    return resolve_valens_apheta(chart, options, house_system, overlap_resolution)


def _resolve_start_planet(chart, options, selector, house_system='whole_sign', overlap_resolution='table'):
    """
    selector: 'sect' | 'sun'|'moon'|'mercury'|'venus'|'mars'|'jupiter'|'saturn'
              | 'asc' | 'fortune'
    반환: astrology.SE_* 정수 (행성)
    """
    return resolve_start_info(
        chart,
        options,
        selector,
        house_system,
        overlap_resolution,
    )['start_planet']

def _dur_days(level, planet):
    if level == 1:
        return L1_DAYS
    if level == 2:
        return MINOR_MONTHS[planet] * SCHEMATIC_MONTH
    raise ValueError("Unsupported level")

def build_main(
    chart,
    options,
    cycles=2,
    start_selector='valens_apheta',
    apheta_house_system='whole_sign',
    overlap_resolution='table',
):
    """
    Return interleaved L1/L2 rows for given cycles (default 2).
    Each row: {'level': 1|2, 'planet': se_index, 'start': datetime, 'end': datetime}
    """
    out = []
    t = _chart_datetime(chart)
    order = _planet_order(chart, options)
    startp = _resolve_start_planet(
        chart,
        options,
        start_selector,
        apheta_house_system,
        overlap_resolution,
    )
    order = order[order.index(startp):] + order[:order.index(startp)]
    for c in range(int(cycles)):
        for p in order:
            s = t
            e = s + datetime.timedelta(days=_dur_days(1, p))
            out.append({'level': 1, 'planet': p, 'start': s, 'end': e})
            # L2 stream (order rotated to start from L1 planet)
            idx0 = order.index(p)
            sub_order = order[idx0:] + order[:idx0]
            tt = s
            for sp in sub_order:
                ss = tt
                ee = ss + datetime.timedelta(days=_dur_days(2, sp))
                if ee > e: ee = e
                out.append({'level': 2, 'planet': sp, 'start': ss, 'end': ee})
                tt = ee
            t = e
    return out
def build_children_valens(chart, options, parent_row, level):
    """
    발렌스식: 하위 단계 길이는 상위 구간 길이에 7행성 '소년수 비율(=minor_months/129)'을 곱해 재분배.
    parent_row: L2(→L3 생성) 또는 L3(→L4 생성)
    반환 Each row: {'level': 3|4, 'planet': se_index, 'start': dt, 'end': dt}
    """
    if level not in (3, 4):
        raise ValueError("level must be 3 or 4")

    order = _planet_order(chart, options)
    # 하위 단계도 항상 '부모 행성'에서 시작하도록 순서를 회전
    startp = int(parent_row['planet'])
    i0 = order.index(startp)
    sub_order = order[i0:] + order[:i0]

    base_days = (parent_row['end'] - parent_row['start']).total_seconds() / 86400.0
    t = parent_row['start']
    out = []
    acc = 0.0
    for j, sp in enumerate(sub_order):
        # 비율배분: (소년수 / 129) × 부모 길이(일)
        seg_days = base_days * (MINOR_MONTHS[sp] / MINOR_TOTAL)
        ss = t
        ee = ss + datetime.timedelta(days=seg_days)
        out.append({'level': level, 'planet': sp, 'start': ss, 'end': ee})
        t = ee
        acc += seg_days
    # 누적 오차 보정: 마지막 세그먼트의 끝을 부모 끝에 강제 일치
    out[-1]['end'] = parent_row['end']
    return out

def build_children_repeating_cycles(chart, options, parent_row, level):
    """Build the repeated 129-unit lower distribution.

    The daily branch repeats the planetary minor numbers as days throughout an
    L2 period.  The hourly branch repeats the same numbers as hours throughout
    an L3 period.  Each cycle begins with the parent ruler and follows the
    planets in their natal zodiacal order.  Valens VI.8 preserves a related
    129-day current-day procedure; the repeated nested day/hour method is in
    the fifth-century addition to the Anthology, II.10.3.
    """
    if level not in (3, 4):
        raise ValueError("level must be 3 or 4")

    order = _planet_order(chart, options)
    startp = int(parent_row['planet'])
    i0 = order.index(startp)
    sub_order = order[i0:] + order[:i0]
    unit = datetime.timedelta(days=1) if level == 3 else datetime.timedelta(hours=1)
    display_unit = 'days' if level == 3 else 'hours'
    parent_end = parent_row['end']
    t = parent_row['start']
    out = []
    while t < parent_end:
        for sp in sub_order:
            ss = t
            ee = min(ss + unit * MINOR_MONTHS[sp], parent_end)
            out.append({
                'level': level,
                'planet': sp,
                'start': ss,
                'end': ee,
                'display_unit': display_unit,
            })
            t = ee
            if t >= parent_end:
                break
    return out

def build_children_combo_valens(chart, options, parent_row):
    """
    L2 한 구간을 받아서: L3 전 구간을 만들고, 각 L3 안에 L4를 시간 순서로 바로 이어붙여
    하나의 납작한 목록으로 반환한다. (정렬은 시간 흐름 그대로)
    """
    out = []
    rows3 = build_children_valens(chart, options, parent_row, level=3)
    for r3 in rows3:
        out.append(r3)
        rows4 = build_children_valens(chart, options, r3, level=4)
        out.extend(rows4)
    return out

# Formatting helpers (same style as zodiacalreleasing)
try:
    import mtexts
except Exception:
    mtexts = None

def fmt_date(dt):
    return u'%04d.%02d.%02d' % (int(dt.year), int(dt.month), int(dt.day))

def fmt_length(row):
    td = row['end'] - row['start']
    days = td.total_seconds() / 86400.0
    if row['level'] == 1:
        total_months = int(round(days / SCHEMATIC_MONTH))
        years, months = divmod(total_months, 12)
        year_unit = mtexts.txts['Year'] if abs(years) == 1 else mtexts.txts['Years']
        month_unit = mtexts.txts['Month'] if abs(months) == 1 else mtexts.txts['Months']
        return u'%d %s %d %s' % (years, year_unit, months, month_unit)
    if row['level'] == 2:
        months = int(round(days / 30.0))
        unit = mtexts.txts['Month'] if abs(months) == 1 else mtexts.txts['Months']
        return u'%d %s' % (months, unit)
    if row.get('display_unit') == 'hours':
        hours = int(round(td.total_seconds() / 3600.0))
        unit = mtexts.txts['Hour'] if abs(hours) == 1 else mtexts.txts['Hours']
        return u'%d %s' % (hours, unit)
    # L3/L4: 소수 월이 너무 작아 0으로 떨어지므로 '일'로 표기
    d = int(round(days))
    unit = mtexts.txts['Day'] if abs(d) == 1 else mtexts.txts['Days']
    return u'%d %s' % (d, unit)
