# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Predicate library — the public API that corpus packs call by name.

Packs declare rules like `predicate = "moon_on_nodes"` with optional `args`.
The loader dispatches to the callable registered in `PREDICATES` below.
Every predicate takes `(chrt, **args)` and returns a bool.

All chart-math helpers live here rather than in `elections_rules.py` so the
predicate library is a stable, self-contained contract that community packs
can depend on without reaching into engine internals.
"""

import astrology
import planets

# ─────────────────────────────────────────────────────────────
# Planet / point name → id
# ─────────────────────────────────────────────────────────────

_PLANET_IDS = {
    'sun': astrology.SE_SUN, 'moon': astrology.SE_MOON,
    'mercury': astrology.SE_MERCURY, 'venus': astrology.SE_VENUS,
    'mars': astrology.SE_MARS, 'jupiter': astrology.SE_JUPITER,
    'saturn': astrology.SE_SATURN,
}
BENEFICS = ('jupiter', 'venus')
MALEFICS = ('mars', 'saturn')

_TROPICAL_SIGNS = {0, 3, 6, 9}
_STRAIGHT_RISING = {3, 4, 5, 6, 7, 8}

_SIGN_RULERS = {
    0: astrology.SE_MARS,     1: astrology.SE_VENUS,   2: astrology.SE_MERCURY,
    3: astrology.SE_MOON,     4: astrology.SE_SUN,     5: astrology.SE_MERCURY,
    6: astrology.SE_VENUS,    7: astrology.SE_MARS,    8: astrology.SE_JUPITER,
    9: astrology.SE_SATURN,  10: astrology.SE_SATURN, 11: astrology.SE_JUPITER,
}

# ─────────────────────────────────────────────────────────────
# Low-level helpers
# ─────────────────────────────────────────────────────────────

def _planet(chrt, pid):
    try: return chrt.planets.planets[pid]
    except Exception: return None

def _lon(pl):
    try: return pl.data[planets.Planet.LONG]
    except Exception: return None

def _lat(pl):
    try: return pl.data[planets.Planet.LAT]
    except Exception: return None

def _speed(pl):
    try: return pl.data[planets.Planet.SPLON]
    except Exception: return 0.0

def _sign(lon): return int(lon // 30) % 12
def _deg_in_sign(lon): return lon - 30.0 * int(lon // 30)

def _ang_diff(a, b):
    d = abs((a - b) % 360.0)
    return 360.0 - d if d > 180.0 else d

def _asc(chrt):
    try: return chrt.houses.ascmc[0]
    except Exception: return None

def _mc(chrt):
    try: return chrt.houses.ascmc[1]
    except Exception: return None

def _house_of(chrt, lon):
    try: return int(chrt.houses.getHousePos(lon, chrt.options, False)) + 1
    except Exception: return None

def _aspect_bodies(chrt, a_id, b_id, angles, orb):
    a = _planet(chrt, a_id); b = _planet(chrt, b_id)
    if a is None or b is None: return False
    la, lb = _lon(a), _lon(b)
    if la is None or lb is None: return False
    d = _ang_diff(la, lb)
    return any(abs(d - ang) <= orb for ang in angles)

def _aspect_to_point(chrt, pid, point_lon, angles, orb):
    pl = _planet(chrt, pid)
    if pl is None or point_lon is None: return False
    plon = _lon(pl)
    if plon is None: return False
    d = _ang_diff(plon, point_lon)
    return any(abs(d - ang) <= orb for ang in angles)

def _pid(name):
    return _PLANET_IDS.get(name.lower()) if isinstance(name, str) else name

def _point_lon(chrt, name):
    asc = _asc(chrt); mc = _mc(chrt)
    if asc is None: return None
    name = name.upper()
    if name == 'ASC': return asc
    if name == 'DSC': return (asc + 180.0) % 360.0
    if name == 'MC':  return mc
    if name == 'IC':  return (mc + 180.0) % 360.0 if mc is not None else None
    return None

# ─────────────────────────────────────────────────────────────
# Applying / separating direction — signed-orb + relative-speed
# ─────────────────────────────────────────────────────────────

def _signed_orb(la, lb, aspect_angle):
    """Return signed angular distance (-180..+180] from exact aspect.

    Positive when lon(A) is "ahead" of the exact aspect point measured
    from B; negative when "behind". For symmetric aspects (sextile,
    square, trine, opposition) both +θ and -θ are candidate targets —
    we pick the closer one.
    """
    d = (la - lb) % 360.0
    target_up = aspect_angle % 360.0
    target_down = (-aspect_angle) % 360.0
    def _sdiff(x, t):
        r = (x - t) % 360.0
        return r - 360.0 if r > 180.0 else r
    du = _sdiff(d, target_up)
    dd = _sdiff(d, target_down)
    return du if abs(du) < abs(dd) else dd

def lord_of_house_received_by_any(chrt, house=1,
                                   levels=('term', 'face'),
                                   require_aspect=True, orb=6.0, **_):
    """Lord of `house` is received by ANY other planet at the given
    dignity levels (default term/face = Lilly's "minor reception").

    Reception here: the lord's position falls in the receiving planet's
    dignities. With `require_aspect=True` (default) the receiver must
    also behold the lord by a Ptolemaic aspect within orb — Lilly counts
    reception only between planets in aspect (CA I Ch.XVIII).
    """
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    target = set(str(x).lower() for x in tuple(levels))
    for other in _PLANET_IDS.values():
        if other == pid:
            continue
        found = _reception_levels_of(chrt, pid, other)
        if not any(lvl in target for lvl in found):
            continue
        if not require_aspect:
            return True
        if _aspect_bodies(chrt, pid, other, (0, 60, 90, 120, 180), orb):
            return True
    return False


def _aspect_direction(chrt, faster_pid, slower_pid, aspect_angle, orb):
    """Return 'applying' / 'separating' / 'exact', or None if not in orb.

    Decides by: signed_orb * relative_speed. If they are opposite signs
    the orb is shrinking (applying). Same signs: orb is widening
    (separating). Zero: the aspect is exact this instant.

    Does not assume `faster_pid` is actually faster — it's simply the
    first planet. The sign of `rel_speed = speed(faster) - speed(slower)`
    captures which one is moving faster in which direction.
    """
    a = _planet(chrt, faster_pid); b = _planet(chrt, slower_pid)
    if a is None or b is None: return None
    la, lb = _lon(a), _lon(b)
    if la is None or lb is None: return None
    signed = _signed_orb(la, lb, aspect_angle)
    if abs(signed) > orb: return None
    rel = _speed(a) - _speed(b)
    product = signed * rel
    if product < 0: return 'applying'
    if product > 0: return 'separating'
    return 'exact'


def is_applying_between(chrt, faster='moon', slower='saturn',
                         aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """True when `faster` is applying to `slower` by any named aspect within orb."""
    pa, pb = _pid(faster), _pid(slower)
    if pa is None or pb is None or pa == pb: return False
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, pa, pb, ang, orb)
        if d in ('applying', 'exact'):
            return True
    return False


def is_separating_between(chrt, faster='moon', slower='saturn',
                           aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """True when `faster` is separating from `slower` by any named aspect within orb."""
    pa, pb = _pid(faster), _pid(slower)
    if pa is None or pb is None or pa == pb: return False
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, pa, pb, ang, orb)
        if d == 'separating':
            return True
    return False


def _moon_elong(chrt):
    moon = _planet(chrt, astrology.SE_MOON); sun = _planet(chrt, astrology.SE_SUN)
    if moon is None or sun is None: return None
    a, b = _lon(moon), _lon(sun)
    if a is None or b is None: return None
    return (a - b) % 360.0

def _is_waxing(chrt):
    e = _moon_elong(chrt)
    return e is not None and e < 180.0

# ─────────────────────────────────────────────────────────────
# Moon predicates
# ─────────────────────────────────────────────────────────────

def moon_is_waxing(chrt, **_): return _is_waxing(chrt)
def moon_is_waning(chrt, **_):
    e = _moon_elong(chrt)
    return e is not None and e >= 180.0

def moon_lat_north(chrt, threshold=0.2, **_):
    m = _planet(chrt, astrology.SE_MOON)
    lat = _lat(m) if m else None
    return lat is not None and lat > threshold

def moon_lat_south(chrt, threshold=0.2, **_):
    m = _planet(chrt, astrology.SE_MOON)
    lat = _lat(m) if m else None
    return lat is not None and lat < -threshold

def moon_swift(chrt, threshold=13.2, **_):
    m = _planet(chrt, astrology.SE_MOON)
    return m is not None and _speed(m) >= threshold

def moon_slow(chrt, threshold=11.8, **_):
    m = _planet(chrt, astrology.SE_MOON)
    return m is not None and _speed(m) <= threshold

def moon_on_nodes(chrt, orb=3.0, **_):
    m = _planet(chrt, astrology.SE_MOON)
    n = _planet(chrt, astrology.SE_TRUE_NODE) or _planet(chrt, astrology.SE_MEAN_NODE)
    if m is None or n is None: return False
    d = _ang_diff(_lon(m), _lon(n))
    return d <= orb or abs(d - 180.0) <= orb

def moon_in_houses(chrt, houses=(), **_):
    m = _planet(chrt, astrology.SE_MOON)
    if m is None: return False
    h = _house_of(chrt, _lon(m))
    return h in tuple(houses)

def moon_in_signs(chrt, signs=(), **_):
    m = _planet(chrt, astrology.SE_MOON)
    if m is None: return False
    return _sign(_lon(m)) in set(signs)

def moon_conj_sun(chrt, orb=8.0, **_):
    e = _moon_elong(chrt)
    return e is not None and (e <= orb or e >= 360.0 - orb)

def moon_opp_sun(chrt, orb=8.0, **_):
    e = _moon_elong(chrt)
    return e is not None and abs(e - 180.0) <= orb

def moon_aspects_body(chrt, body='jupiter', aspects=(0, 60, 120), orb=6.0,
                      directions=None, **_):
    """Moon in aspect with a named body within orb.

    `directions=None` (default) is direction-agnostic — "Moon in aspect
    with X". Pass `["applying", "exact"]` for Lilly's "Moon applies to X"
    testimonies, or `["separating", "exact"]` for separation rules.
    """
    pid = _pid(body)
    if directions is None:
        return _aspect_bodies(chrt, astrology.SE_MOON, pid,
                              tuple(aspects), orb)
    if pid is None or pid == astrology.SE_MOON:
        return False
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, astrology.SE_MOON, pid, ang, orb)
        if d in tuple(directions):
            return True
    return False

def moon_void_of_course(chrt, **_):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None: return False
    mlon = _lon(moon)
    if mlon is None: return False
    remaining = 30.0 - _deg_in_sign(mlon)
    for pid in (astrology.SE_SUN, astrology.SE_MERCURY, astrology.SE_VENUS,
                astrology.SE_MARS, astrology.SE_JUPITER, astrology.SE_SATURN):
        p = _planet(chrt, pid)
        if p is None: continue
        plon = _lon(p)
        if plon is None: continue
        for ang in (0, 60, 90, 120, 180):
            for target in ((plon + ang) % 360.0, (plon - ang) % 360.0):
                diff = (target - mlon) % 360.0
                if 0.0 < diff <= remaining:
                    return False
    return True

# ─────────────────────────────────────────────────────────────
# Planet condition predicates
# ─────────────────────────────────────────────────────────────

def planet_retrograde(chrt, planet='mercury', **_):
    p = _planet(chrt, _pid(planet))
    return p is not None and _speed(p) < 0.0

def planet_stationary(chrt, planet='mercury', threshold=0.05, **_):
    p = _planet(chrt, _pid(planet))
    return p is not None and abs(_speed(p)) < threshold

def planet_combust(chrt, planet='mercury', orb=8.0, **_):
    pid = _pid(planet)
    if pid == astrology.SE_SUN: return False
    sun = _planet(chrt, astrology.SE_SUN); p = _planet(chrt, pid)
    if sun is None or p is None: return False
    return _ang_diff(_lon(sun), _lon(p)) <= orb


def body_cazimi(chrt, body='mercury', orb=0.283, **_):
    """Body within `orb` (default 17 arcminutes ≈ 0.283°) of the Sun's
    longitude. Lilly CA I Ch.XV "Accidental Dignities": *"In Cazimi, in
    the Sun's heart … +5"* — the strongest accidental dignification, an
    extreme empowerment.
    """
    pid = _pid(body)
    if pid is None or pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    return _ang_diff(_lon(sun), _lon(p)) <= float(orb)


def body_combust(chrt, body='mercury', orb=8.5, cazimi_orb=0.283, **_):
    """Body within `orb` of the Sun but outside `cazimi_orb` (so cazimi
    doesn't double-count). Lilly Ch.XV: *"Combust the Sun … −5"*.

    Generic version of `planet_combust` (which is alias-named differently);
    this one excludes cazimi properly per Lilly's three-tier scheme.
    """
    pid = _pid(body)
    if pid is None or pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    d = _ang_diff(_lon(sun), _lon(p))
    return float(cazimi_orb) < d <= float(orb)


def body_under_beams(chrt, body='mercury', combust_orb=8.5, beams_orb=17.0, **_):
    """Body between `combust_orb` and `beams_orb` of the Sun. Lilly Ch.XV:
    *"Under the Sun's Beams … −4"* — weakened but not destroyed; the
    middle tier between combust and free.
    """
    pid = _pid(body)
    if pid is None or pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    d = _ang_diff(_lon(sun), _lon(p))
    return float(combust_orb) < d <= float(beams_orb)


_PLANET_JOYS = {
    astrology.SE_MERCURY: 1,
    astrology.SE_MOON:    3,
    astrology.SE_VENUS:   5,
    astrology.SE_MARS:    6,
    astrology.SE_SUN:     9,
    astrology.SE_JUPITER: 11,
    astrology.SE_SATURN:  12,
}


def body_in_joy(chrt, body='mercury', **_):
    """Named planet sits in its joy house. Lilly CA I Ch.XV (joys table):
    Mercury/1st, Moon/3rd, Venus/5th, Mars/6th, Sun/9th, Jupiter/11th,
    Saturn/12th. *"In his joy … +2"* accidental dignity.
    """
    pid = _pid(body)
    if pid is None:
        return False
    joy_house = _PLANET_JOYS.get(pid)
    if joy_house is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    h = _house_of(chrt, _lon(p))
    return h == joy_house

def planet_aspects_body(chrt, a='mercury', b='mars', aspects=(0, 90, 180),
                        orb=6.0, **_):
    return _aspect_bodies(chrt, _pid(a), _pid(b), tuple(aspects), orb)

def any_stationary(chrt, planets_=None, threshold=0.05, **_):
    if planets_ is None:
        planets_ = ('mercury', 'venus', 'mars', 'jupiter', 'saturn')
    return any(planet_stationary(chrt, planet=p, threshold=threshold)
               for p in planets_)

# ─────────────────────────────────────────────────────────────
# Pivot / point predicates
# ─────────────────────────────────────────────────────────────

def benefic_on_point(chrt, point='ASC', orb=6.0, **_):
    p_lon = _point_lon(chrt, point)
    for b in BENEFICS:
        if _aspect_to_point(chrt, _pid(b), p_lon, (0,), orb):
            return True
    return False

def malefic_on_point(chrt, point='MC', orb=5.0, **_):
    p_lon = _point_lon(chrt, point)
    for m in MALEFICS:
        if _aspect_to_point(chrt, _pid(m), p_lon, (0,), orb):
            return True
    return False

def body_on_point(chrt, body='saturn', point='ASC', orb=5.0, **_):
    return _aspect_to_point(chrt, _pid(body), _point_lon(chrt, point),
                            (0,), orb)

def asc_straight_rising(chrt, **_):
    a = _asc(chrt)
    return a is not None and _sign(a) in _STRAIGHT_RISING

def asc_oblique_rising(chrt, **_):
    a = _asc(chrt)
    return a is not None and _sign(a) not in _STRAIGHT_RISING

def planet_direct_and_free(chrt, planet='mercury', combust_orb=8.0,
                           stat_threshold=0.05, **_):
    """True when a planet is direct, not stationary, and not under the Sun's rays."""
    pid = _pid(planet)
    p = _planet(chrt, pid)
    if p is None:
        return False
    if _speed(p) < 0.0:  # retrograde
        return False
    if abs(_speed(p)) < stat_threshold:  # stationary
        return False
    if pid != astrology.SE_SUN:
        sun = _planet(chrt, astrology.SE_SUN)
        if sun is not None and _ang_diff(_lon(sun), _lon(p)) <= combust_orb:
            return False
    return True

# ─────────────────────────────────────────────────────────────
# Compound / themed predicates
# ─────────────────────────────────────────────────────────────

def lord_asc_in_houses(chrt, houses=(2, 8), **_):
    asc = _asc(chrt)
    if asc is None: return False
    lord_id = _SIGN_RULERS.get(_sign(asc))
    lord = _planet(chrt, lord_id)
    if lord is None: return False
    return _house_of(chrt, _lon(lord)) in tuple(houses)

def lords_asc_moon_aversion(chrt, **_):
    asc = _asc(chrt); moon = _planet(chrt, astrology.SE_MOON)
    if asc is None or moon is None: return False
    la_id = _SIGN_RULERS.get(_sign(asc))
    lm_id = _SIGN_RULERS.get(_sign(_lon(moon)))
    if la_id is None or lm_id is None or la_id == lm_id: return False
    return not _aspect_bodies(chrt, la_id, lm_id,
                              (0, 60, 90, 120, 180), 6.0)

def lord_asc_combust(chrt, orb=8.0, **_):
    asc = _asc(chrt)
    if asc is None: return False
    la_id = _SIGN_RULERS.get(_sign(asc))
    if la_id is None or la_id == astrology.SE_SUN: return False
    sun = _planet(chrt, astrology.SE_SUN); lord = _planet(chrt, la_id)
    if sun is None or lord is None: return False
    return _ang_diff(_lon(sun), _lon(lord)) <= orb

def lord_asc_stationary(chrt, threshold=0.05, **_):
    asc = _asc(chrt)
    if asc is None: return False
    la_id = _SIGN_RULERS.get(_sign(asc))
    return planet_stationary(chrt, planet_name_from_id(la_id), threshold=threshold)

def planet_name_from_id(pid):
    for name, pid2 in _PLANET_IDS.items():
        if pid2 == pid: return name
    return 'sun'

def venus_moon_in_tropical(chrt, **_):
    venus = _planet(chrt, astrology.SE_VENUS); moon = _planet(chrt, astrology.SE_MOON)
    if venus is None or moon is None: return False
    return _sign(_lon(venus)) in _TROPICAL_SIGNS or _sign(_lon(moon)) in _TROPICAL_SIGNS

def venus_in_tropical(chrt, **_):
    v = _planet(chrt, astrology.SE_VENUS)
    return v is not None and _sign(_lon(v)) in _TROPICAL_SIGNS

def moon_in_tropical(chrt, **_):
    m = _planet(chrt, astrology.SE_MOON)
    return m is not None and _sign(_lon(m)) in _TROPICAL_SIGNS

def moon_in_scorpio_with_mars(chrt, orb=6.0, **_):
    m = _planet(chrt, astrology.SE_MOON)
    if m is None or _sign(_lon(m)) != 7: return False
    return _aspect_bodies(chrt, astrology.SE_MOON, astrology.SE_MARS,
                          (0, 180), orb)

def mars_saturn_aspecting_venus(chrt, orb=6.0, **_):
    for m in (astrology.SE_MARS, astrology.SE_SATURN):
        if _aspect_bodies(chrt, astrology.SE_VENUS, m, (0, 90, 180), orb):
            return True
    return False

def moon_in_signs_with_benefic_aspect(chrt, signs=(), orb=6.0, **_):
    if not moon_in_signs(chrt, signs=signs):
        return False
    for b in BENEFICS:
        if _aspect_bodies(chrt, astrology.SE_MOON, _pid(b),
                          (0, 60, 120), orb):
            return True
    return False

def moon_in_signs_without_benefic_aspect(chrt, signs=(), orb=6.0, **_):
    if not moon_in_signs(chrt, signs=signs):
        return False
    for b in BENEFICS:
        if _aspect_bodies(chrt, astrology.SE_MOON, _pid(b),
                          (0, 60, 120), orb):
            return False
    return True

def benefic_witnessing_luminaries(chrt, orb=6.0, **_):
    for b in BENEFICS:
        bid = _pid(b)
        sun_ok = _aspect_bodies(chrt, astrology.SE_SUN, bid,
                                (0, 60, 120), orb)
        moon_ok = _aspect_bodies(chrt, astrology.SE_MOON, bid,
                                 (0, 60, 120), orb)
        if sun_ok and moon_ok:
            return True
    return False

def moon_opposite_sun(chrt, orb=8.0, **_):
    e = _moon_elong(chrt)
    return e is not None and abs(e - 180.0) <= orb

def benefic_on_asc_no_malefic_on_mc(chrt, orb=5.0, **_):
    """True when a benefic conjoins ASC AND no malefic conjoins MC."""
    if not benefic_on_point(chrt, point='ASC', orb=orb):
        return False
    return not malefic_on_point(chrt, point='MC', orb=orb)

def pivot_malefic_retrograde(chrt, orb=5.0, **_):
    asc = _asc(chrt); mc = _mc(chrt)
    if asc is None: return False
    points = [asc, (asc + 180.0) % 360.0]
    if mc is not None:
        points.extend([mc, (mc + 180.0) % 360.0])
    for mid in (astrology.SE_MARS, astrology.SE_SATURN):
        p = _planet(chrt, mid)
        if p is None or _speed(p) >= 0.0:
            continue
        for pt in points:
            if _aspect_to_point(chrt, mid, pt, (0,), orb):
                return True
    return False


# ─────────────────────────────────────────────────────────────
# Horary predicates — context-aware, require significator houses
# ─────────────────────────────────────────────────────────────
#
# Horary rules classically reason about "lord of quesited house" and "lord
# of querent house" as the two chief significators, plus the Moon as a
# universal co-significator. The UI supplies these houses via the context
# dict (typically context["quesited_house"] and context["querent_house"])
# when the user picks a question category.
#
# The `lord_of_house_*` predicates take an explicit `house` arg and are
# directly usable from pack rules when a fixed house is wanted. The
# `quesited_*` / `querent_*` wrappers read the house from context so the
# same rule file adapts to whichever question category the user picked.

def _house_cusp_lon(chrt, house):
    """Longitude of the house cusp for houses 1..12."""
    try:
        return chrt.houses.cusps[int(house)]
    except Exception:
        return None

def _lord_of_house(chrt, house):
    """Planet id of the traditional sign ruler of the house cusp."""
    cusp = _house_cusp_lon(chrt, house)
    if cusp is None:
        return None
    return _SIGN_RULERS.get(_sign(cusp))

def lord_of_house_retrograde(chrt, house=None, **_):
    if house is None: return False
    pid = _lord_of_house(chrt, house)
    if pid is None: return False
    p = _planet(chrt, pid)
    return p is not None and _speed(p) < 0.0

def lord_of_house_combust(chrt, house=None, orb=8.0, **_):
    if house is None: return False
    pid = _lord_of_house(chrt, house)
    if pid is None or pid == astrology.SE_SUN: return False
    sun = _planet(chrt, astrology.SE_SUN); p = _planet(chrt, pid)
    if sun is None or p is None: return False
    return _ang_diff(_lon(sun), _lon(p)) <= orb

def lord_of_house_in_houses(chrt, house=None, in_houses=(), **_):
    if house is None: return False
    pid = _lord_of_house(chrt, house)
    if pid is None: return False
    p = _planet(chrt, pid)
    if p is None: return False
    return _house_of(chrt, _lon(p)) in tuple(in_houses)

# Context-aware wrappers. These read context["quesited_house"] etc. and
# delegate to the explicit-house predicates above.

def quesited_lord_retrograde(chrt, context=None, **_):
    if not context: return False
    return lord_of_house_retrograde(chrt, house=context.get('quesited_house'))

def quesited_lord_combust(chrt, context=None, orb=8.0, **_):
    if not context: return False
    return lord_of_house_combust(chrt, house=context.get('quesited_house'),
                                 orb=orb)

def quesited_lord_in_houses(chrt, context=None, in_houses=(), **_):
    if not context: return False
    return lord_of_house_in_houses(chrt, house=context.get('quesited_house'),
                                   in_houses=in_houses)

def querent_lord_in_houses(chrt, context=None, in_houses=(), **_):
    if not context: return False
    return lord_of_house_in_houses(chrt, house=context.get('querent_house'),
                                   in_houses=in_houses)

def _moon_aspects_lord(chrt, house, orb, aspects, directions=('applying', 'exact')):
    """Shared core: Moon applying within orb of an aspect to the lord of `house`.

    Direction filter defaults to applying/exact only — the public callers
    are named `moon_applying_to_*`, so a separating Moon must not fire.
    Pass `directions=('separating', 'exact')` for a "Moon just left lord"
    variant, or the full triple for direction-agnostic legacy behaviour.
    """
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if pid is None or pid == astrology.SE_MOON:
        return False
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, astrology.SE_MOON, pid, ang, orb)
        if d in directions:
            return True
    return False


def moon_applying_to_quesited(chrt, context=None, orb=6.0,
                               aspects=(0, 60, 90, 120, 180), **_):
    """Moon is within orb of an aspect to the lord of quesited (from context)."""
    if not context:
        return False
    return _moon_aspects_lord(chrt, context.get('quesited_house'),
                              orb, tuple(aspects))


def moon_applying_to_querent(chrt, context=None, orb=6.0,
                              aspects=(0, 60, 90, 120, 180), **_):
    """Moon is within orb of an aspect to the lord of querent (from context)."""
    if not context:
        return False
    return _moon_aspects_lord(chrt, context.get('querent_house'),
                              orb, tuple(aspects))


def moon_applies_to_lord_of_house(chrt, house=None, orb=6.0,
                                    aspects=(0, 60, 90, 120, 180),
                                    directions=('applying', 'exact'), **_):
    """Moon within orb of an aspect to the lord of a specific house.

    Explicit-house version of `moon_applying_to_querent/quesited`, used
    when a rule targets a fixed house regardless of the question context.
    `directions` defaults to applying/exact (the predicate's name);
    pass `["separating", "exact"]` for Lilly's "Moon separating from
    the Lord of N" testimonies.
    Note: for Lilly's "whether it be alive" test the canonical reading
    is 8th-FROM-MOON, not radical 8th — use
    `moon_applies_to_lord_of_house_from_moon` for that doctrine.
    """
    return _moon_aspects_lord(chrt, house, orb, tuple(aspects),
                              tuple(directions))


def moon_applies_to_dispositor(chrt, orb=6.0, aspects=(0, 60, 90, 120, 180),
                                directions=('applying', 'exact'), **_):
    """Moon applies to her own dispositor (lord of the sign she is in).

    Lilly CA II, "Of Servants fled, Beasts strayed, and things lost":
    *"the Moon applying to the Lord of the Ascendant, or to the Lord
    of the 12th from the Ascendant, or to the Lord of the house of the
    Moon, the thing missing shall be found againe."*  Returns False when
    the Moon is in Cancer (no distinct dispositor).
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None or disp == astrology.SE_MOON:
        return False
    target = _planet(chrt, disp)
    if target is None:
        return False
    dirs = tuple(directions)
    for ang in tuple(aspects):
        if _aspect_direction(chrt, astrology.SE_MOON, disp, ang, orb) in dirs:
            return True
    return False


def moon_applies_to_lord_of_house_from_moon(chrt, house=8, orb=6.0,
                                              aspects=(0, 60, 90, 120, 180),
                                              directions=('applying', 'exact'), **_):
    """Moon applies to the lord of the N-th house counted from her own.

    Lilly CA II, "Whether it be alive": *"if you find her in application
    to the Lord of the 8th house from her, say it is dead."*  House count
    follows the radical house cusps — 8th from Moon = the house whose
    number is `((moon_house - 1 + house - 1) % 12) + 1`.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    moon_house = _house_of(chrt, mlon)
    if moon_house is None:
        return False
    derived = ((moon_house - 1 + int(house) - 1) % 12) + 1
    return _moon_aspects_lord(chrt, derived, orb, tuple(aspects), tuple(directions))


def body_in_houses(chrt, body='sun', houses=(), **_):
    """Named planet sits in any of the given radical houses. Generic primitive
    used by the recovery-aphorism rules ("Sun in Ascendant", "Jupiter in 2nd",
    "Moon in 7th", etc.).
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    h = _house_of(chrt, _lon(p))
    return h is not None and h in tuple(houses)


def body_in_signs(chrt, body='sun', signs=(), **_):
    """Named planet sits in any of the given signs (0=Aries..11=Pisces).

    Sign-membership counterpart of `body_in_houses`. Used for rules like
    Lilly's "Mercury in a fixed sign — the rumour holds".
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) in set(int(s) for s in signs)


def moon_dispositor_in_signs(chrt, signs=(), **_):
    """Lord of the sign the Moon is in occupies any of the given signs (0=Aries..11=Pisces).

    Lilly CA II, "The place where the thing is that is lost":
    *"if the Lord of the house of the Moon be in humane Signes, it is in
    a place where men use to be; if in Signes of small Beasts, as Aries
    and Capricorn it is where such kind of Beasts be."*
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None:
        return False
    p = _planet(chrt, disp)
    if p is None:
        return False
    return _sign(_lon(p)) in set(int(s) for s in signs)


def moon_dispositor_in_houses(chrt, in_houses=(), **_):
    """Lord of the sign the Moon is in occupies any of the given radical houses.

    Lilly CA II, "Of Servants fled, Beasts strayed, and things lost":
    *"if the Lord of the house of the Moon be in the 3rd, or in a Sextile
    to the Ascendant, there is some hope of finding the thing again,
    during that aspect with the degree ascending."*
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None:
        return False
    p = _planet(chrt, disp)
    if p is None:
        return False
    h = _house_of(chrt, _lon(p))
    return h is not None and h in tuple(in_houses)


def moon_dispositor_aspects_point(chrt, point='ASC',
                                    aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """Lord of the sign the Moon is in aspects ASC/MC/DSC/IC by any named aspect.

    Lilly CA II, "Of Servants fled, Beasts strayed, and things lost":
    *"if the Lord of the house of the Moon be in the 3rd, or in a Sextile
    to the Ascendant, there is some hope of finding the thing again."*
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None:
        return False
    p_lon = _point_lon(chrt, point)
    if p_lon is None:
        return False
    p = _planet(chrt, disp)
    if p is None:
        return False
    d = _ang_diff(_lon(p), p_lon)
    return any(abs(d - ang) <= orb for ang in tuple(aspects))


def moon_dispositor_aspects_moon(chrt, aspects=(0, 60, 90, 120, 180),
                                   orb=6.0, **_):
    """Lord of the Moon's sign aspects the Moon by any named aspect.

    Lilly CA II, "Of Servants fled, Beasts strayed, and things lost":
    *"or if the Lord of the house of the Moon do behold Moon"* — listed
    as one of the recovery testimonies alongside Moon-applies-to-L1 /
    L12 / her own dispositor. Returns False when the Moon is in Cancer
    (no distinct dispositor to behold her).
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None or disp == astrology.SE_MOON:
        return False
    p = _planet(chrt, disp)
    if p is None:
        return False
    d = _ang_diff(_lon(p), mlon)
    return any(abs(d - ang) <= orb for ang in tuple(aspects))


def moon_dispositor_separates_then_applies(chrt,
                                             separating_houses=(6, 8, 12),
                                             applying_house=2,
                                             orb=6.0,
                                             aspects=(0, 60, 90, 120, 180),
                                             **_):
    """Moon's dispositor (Lord of Moon's sign) is separating from at least
    one of the lords of `separating_houses` AND applying to the lord of
    `applying_house`.

    Lilly CA II, "Of Servants fled, Beasts strayed, and things lost":
    *"if he separate himselfe from the Lord of the 12th, 8th, or 6th
    house, and apply unto the degree of the house of Substance, (what
    aspect soever it be) there is hope to find it again."*  Defaults
    encode the lost-object reading (sep from L6/L8/L12, app to L2).
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    disp = _SIGN_RULERS.get(_sign(mlon))
    if disp is None:
        return False
    pid_app = _lord_of_house(chrt, int(applying_house))
    if pid_app is None or pid_app == disp:
        return False
    aspects = tuple(aspects)
    has_app = False
    for ang in aspects:
        if _aspect_direction(chrt, disp, pid_app, ang, orb) in ('applying', 'exact'):
            has_app = True
            break
    if not has_app:
        return False
    for h in tuple(separating_houses):
        pid_sep = _lord_of_house(chrt, int(h))
        if pid_sep is None or pid_sep == disp:
            continue
        for ang in aspects:
            if _aspect_direction(chrt, disp, pid_sep, ang, orb) == 'separating':
                return True
    return False


def benefic_aspects_point(chrt, point='ASC',
                            aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """Either Jupiter or Venus aspects the named point by any named aspect.

    Generalises `benefic_on_point` (which is conjunction-only) to all
    Ptolemaic aspects. Used for Lilly's recovery aphorism *"if that
    Fortune apply to the ascendant, or behold the same"* (CA II,
    "Of Servants fled, Beasts strayed, and things lost").
    """
    p_lon = _point_lon(chrt, point)
    if p_lon is None:
        return False
    aspects = tuple(aspects)
    for b in BENEFICS:
        pid = _pid(b)
        pl = _planet(chrt, pid)
        if pl is None:
            continue
        d = _ang_diff(_lon(pl), p_lon)
        if any(abs(d - ang) <= orb for ang in aspects):
            return True
    return False


def both_luminaries_aspect_each_other_in_angles(chrt,
                                                  aspects=(0, 60, 90, 120, 180),
                                                  orb=8.0, **_):
    """Sun and Moon aspect each other AND both occupy radical angles
    (1, 4, 7, or 10).

    Lilly CA II, "Aphorismes concerning Recovery": *"When both the lights
    behold themselves in angles, it signifies recovery of the thing at
    length, but with labour and pain; and it signifies more then one
    thief; if the aspect be a Trine, it signifyeth the lighter recovery."*
    """
    sun = _planet(chrt, astrology.SE_SUN)
    moon = _planet(chrt, astrology.SE_MOON)
    if sun is None or moon is None:
        return False
    slon = _lon(sun)
    mlon = _lon(moon)
    if slon is None or mlon is None:
        return False
    sh = _house_of(chrt, slon)
    mh = _house_of(chrt, mlon)
    if sh not in (1, 4, 7, 10) or mh not in (1, 4, 7, 10):
        return False
    d = _ang_diff(slon, mlon)
    return any(abs(d - ang) <= orb for ang in tuple(aspects))


def moon_l1_distance(chrt, context=None, span='town', **_):
    """Moon-to-L1 angular distance + quadrant-of-figure check, per Lilly's
    "How farre off a thing lost is from the owner".

    `span` ∈ {'house','town','far'}:
      house = same quadrant AND ≤30° apart → "in the house of him that lost it, or about it"
      town  = same quadrant AND 30°<d≤70° → "in the Town where the owner is"
      far   = different quadrants OR ≥90° apart → "farre from the owner"
    Quadrants are the four house-trios {1,2,3}, {4,5,6}, {7,8,9}, {10,11,12}.
    """
    if context is None:
        context = {}
    qh = context.get('querent_house', 1)
    pid_l1 = _lord_of_house(chrt, qh)
    if pid_l1 is None:
        return False
    moon = _planet(chrt, astrology.SE_MOON)
    l1 = _planet(chrt, pid_l1)
    if moon is None or l1 is None:
        return False
    mlon, l1lon = _lon(moon), _lon(l1)
    if mlon is None or l1lon is None:
        return False
    mh = _house_of(chrt, mlon)
    lh = _house_of(chrt, l1lon)
    if mh is None or lh is None:
        return False
    same_quad = ((mh - 1) // 3) == ((lh - 1) // 3)
    diff = _ang_diff(mlon, l1lon)
    if span == 'house':
        return same_quad and diff <= 30.0
    if span == 'town':
        return same_quad and 30.0 < diff <= 70.0
    if span == 'far':
        return (not same_quad) or diff >= 90.0
    return False


def _node_pid(chrt):
    """SE constant for the lunar node body (mean or true), per options."""
    try:
        return astrology.SE_MEAN_NODE if chrt.options.meannode else astrology.SE_TRUE_NODE
    except Exception:
        return astrology.SE_MEAN_NODE


def _south_node_lon(chrt):
    """South Node longitude — 180° opposite the North Node body."""
    p = _planet(chrt, _node_pid(chrt))
    if p is None:
        return None
    nlon = _lon(p)
    if nlon is None:
        return None
    return (nlon + 180.0) % 360.0


def _part_of_fortune_lon(chrt):
    """Part of Fortune longitude as computed by the chart engine.

    Reads `chrt.fortune.fortune[Fortune.LON]` (= index 0). Returns None if
    the chart hasn't built its Fortune object (e.g. a partial chart used
    in tests). Caller decides whether to early-return False.
    """
    try:
        return float(chrt.fortune.fortune[0])
    except Exception:
        return None


def _term_lord_of(chrt, lon):
    """Planet id of the Egyptian-term ruler for the given longitude.

    Reads `chrt.options.terms[chrt.options.selterm]` — the active term-set
    table. Same lookup pattern as chart.py's dignity-row builder.
    """
    if lon is None:
        return None
    sign = _sign(lon)
    pos_in_sign = _deg_in_sign(lon)
    try:
        span_total = 0.0
        for term_pid, span in chrt.options.terms[chrt.options.selterm][sign]:
            span_total += float(span)
            if span_total > pos_in_sign:
                return int(term_pid)
    except Exception:
        return None
    return None


def south_node_in_houses(chrt, houses=(), **_):
    """South Node (Tail of the Dragon / Cauda Draconis) sits in any of the
    given houses.

    Lilly CA II, "Aphorismes concerning Recovery": *"Saturn also, or Mars,
    or South Node, signifieth dividing and losse of the thing, and that
    all shall not be recovered."*  Mean vs true follows `options.meannode`.
    """
    sn_lon = _south_node_lon(chrt)
    if sn_lon is None:
        return False
    h = _house_of(chrt, sn_lon)
    return h is not None and h in tuple(houses)


def part_of_fortune_in_houses(chrt, houses=(), **_):
    """Part of Fortune occupies any of the given houses."""
    pof_lon = _part_of_fortune_lon(chrt)
    if pof_lon is None:
        return False
    h = _house_of(chrt, pof_lon)
    return h is not None and h in tuple(houses)


def part_of_fortune_lord_aspects_lord_of_house(chrt, house=None,
                                                  aspects=(0, 60, 90, 120, 180),
                                                  orb=6.0,
                                                  directions=('applying', 'separating', 'exact'),
                                                  **_):
    """Lord of Part of Fortune aspects Lord of `house`.

    Lilly CA II, "Aphorismes concerning Recovery": *"when the Lord of the
    Part of Fortune applyes to the Lord of the Ascendant, or to the 2nd
    house ... or to the Moon; all these signify recovery."*
    """
    if house is None:
        return False
    pof_lon = _part_of_fortune_lon(chrt)
    if pof_lon is None:
        return False
    pof_lord = _SIGN_RULERS.get(_sign(pof_lon))
    target_lord = _lord_of_house(chrt, house)
    if pof_lord is None or target_lord is None or pof_lord == target_lord:
        return False
    dirs = tuple(directions)
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pof_lord, target_lord, ang, orb) in dirs:
            return True
    return False


def part_of_fortune_lord_aspects_body(chrt, body='moon',
                                        aspects=(0, 60, 90, 120, 180),
                                        orb=6.0,
                                        directions=('applying', 'separating', 'exact'),
                                        **_):
    """Lord of Part of Fortune aspects a named body. Same Lilly aphorism as
    `part_of_fortune_lord_aspects_lord_of_house`, used for the Moon target.
    """
    pof_lon = _part_of_fortune_lon(chrt)
    if pof_lon is None:
        return False
    pof_lord = _SIGN_RULERS.get(_sign(pof_lon))
    target_pid = _pid(body)
    if pof_lord is None or target_pid is None or pof_lord == target_pid:
        return False
    dirs = tuple(directions)
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pof_lord, target_pid, ang, orb) in dirs:
            return True
    return False


def term_lord_of_moon_in_houses(chrt, in_houses=(), **_):
    """Lord-of-the-term-of-the-Moon — the planet ruling the Egyptian bound
    where the Moon currently sits — occupies any of the given houses.

    Lilly CA II, "If it shall be recovered": *"behold the Lord of the
    terme of the Moon, the which is Signifier of the substance stolne to
    be recovered."*  Useful to flag where this co-significator sits.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    term_pid = _term_lord_of(chrt, mlon)
    if term_pid is None:
        return False
    p = _planet(chrt, term_pid)
    if p is None:
        return False
    h = _house_of(chrt, _lon(p))
    return h is not None and h in tuple(in_houses)


def _hour_lord_pid(chrt):
    """SE planet id of the planetary-hour ruler. Reads `chrt.time.ph.planetaryhour`
    (already computed by the chart engine via `hours.PlanetaryHours`)."""
    try:
        return int(chrt.time.ph.planetaryhour)
    except Exception:
        return None


def _almuten_pid(chrt, mode='essential'):
    """SE planet id of the chart's Almuten of the figure.

    `mode='essential'` — Lilly-strict (CA I Ch.IX–XIII): max of essential
    dignity over the 5 hyleg places (Sun, Moon, Asc, Part of Fortune,
    Syzygy). Read from `chrt.almutens.essentials.scores`.

    `mode='hybrid'` — Aries' built-in synthesis (essentials +
    accidental-house + day-ruler + hour-ruler + heliacal phase). Read
    from `chrt.almutens.maxscore[0]`. This is closer to Bonatti / later
    medieval practice than Lilly, but is what the Aries chart-inspector
    table reports.

    Returns None on tie or if the table hasn't been built.
    """
    try:
        if mode == 'hybrid':
            ms = chrt.almutens.maxscore
            if ms is None or ms[0] < 0 or ms[2]:
                return None
            return int(ms[0])
        # Default: essential-only over the 5 hyleg places.
        scores = chrt.almutens.essentials.scores
        max_idx = -1
        max_val = -1
        tied = False
        for i in range(astrology.SE_SATURN + 1):
            if scores[i] > max_val:
                max_val = scores[i]
                max_idx = i
                tied = False
            elif scores[i] == max_val and max_val > 0:
                tied = True
        if max_idx < 0 or tied:
            return None
        return int(max_idx)
    except Exception:
        return None


# Sign index → row index into options.trips[seltrip]. The trips table rows
# are ordered Fire, Air, Water, Earth (see almutens.py:33 `self.tripls =
# [0, 3, 1, 2, ...]` — the engine's own map). Aries→Fire(0),
# Taurus→Earth(3), Gemini→Air(1), Cancer→Water(2), repeating.
# (Was (0,1,2,3,...) zodiac-element order before 2026-07-11 — every
# non-fire sign consulted the WRONG element's triplicity rulers.)
_TRIPLICITY_GROUP = (0, 3, 1, 2, 0, 3, 1, 2, 0, 3, 1, 2)
# Lilly's hot/cold + dry/wet planetary natures — CA I "Of the Planets":
# Hot+Dry: Sun, Mars  •  Cold+Wet: Moon, Venus
# Hot+Wet: Jupiter    •  Cold+Dry: Saturn, Mercury
_PLANET_NATURE = {
    astrology.SE_SUN:     ('hot', 'dry'),
    astrology.SE_MOON:    ('cold', 'wet'),
    astrology.SE_MERCURY: ('cold', 'dry'),
    astrology.SE_VENUS:   ('cold', 'wet'),
    astrology.SE_MARS:    ('hot', 'dry'),
    astrology.SE_JUPITER: ('hot', 'wet'),
    astrology.SE_SATURN:  ('cold', 'dry'),
}


def chart_radical(chrt, **_):
    """The chart is radical — fit to be judged — per Lilly's CA I Ch.XIX:
    *"the Lord of the hour at the time of proposing the Question … and
    the Lord of the Ascendant or first House, are of one Triplicity, or
    be one, or of the same nature."*

    Returns True if any of:
      a) hour-lord IS the Lord of the Ascendant (Lilly: "be one"),
      b) hour-lord is one of the triplicity rulers of the Asc's element
         (using the active triplicity table from `options.trips[seltrip]`),
      c) hour-lord and L1 share the same hot/cold + dry/wet nature.
    """
    hour_pid = _hour_lord_pid(chrt)
    asc_lord = _lord_of_house(chrt, 1)
    if hour_pid is None or asc_lord is None:
        return False
    if hour_pid == asc_lord:
        return True
    asc = _asc(chrt)
    if asc is None:
        return False
    tg = _TRIPLICITY_GROUP[_sign(asc)]
    try:
        rulers = [int(r) for r in chrt.options.trips[chrt.options.seltrip][tg] if int(r) != -1]
        if hour_pid in rulers and asc_lord in rulers:
            return True
    except Exception:
        pass
    h_nat = _PLANET_NATURE.get(hour_pid)
    l_nat = _PLANET_NATURE.get(asc_lord)
    if h_nat and l_nat and h_nat == l_nat:
        return True
    return False


def chart_not_radical(chrt, **_):
    """Negation of `chart_radical` — useful for the consideration-before-
    judgment caution rule which fires when the chart is *not* fit to be
    judged."""
    return not chart_radical(chrt)


def moon_in_late_degrees_of_signs(chrt, signs=(2, 7, 9), min_deg=25.0, **_):
    """Moon is in the late degrees (`min_deg+`) of the given signs.

    Lilly CA I Ch.XIX: *"It's not safe to judge when the Moon is in the
    later degrees of a Sign, especially in Gemini, Scorpio or
    Capricorn."*  Defaults to those three signs at 25°+; pack rules can
    pass other (signs, min_deg) pairs.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    s = _sign(mlon)
    if s not in set(int(x) for x in signs):
        return False
    return _deg_in_sign(mlon) >= float(min_deg)


def chart_testimonies_balanced(chrt, threshold=2.0, **_):
    """Total dignity score of the Fortunes (Venus + Jupiter) is within
    `threshold` of the Infortunes (Mars + Saturn).

    Lilly CA I Ch.XIX: *"When the testimonies of Fortunes and Infortunes
    are equal, deferre judgment, it's not possible to know which way the
    Ballance will turn."*  Uses the existing `_planet_strength_score`
    (essential dignity at the planet's current longitude + accidental
    via `chrt.almutens`) — same scoring the chart UI uses.
    """
    benefic = _planet_strength_score(chrt, astrology.SE_VENUS) + \
              _planet_strength_score(chrt, astrology.SE_JUPITER)
    malefic = _planet_strength_score(chrt, astrology.SE_MARS) + \
              _planet_strength_score(chrt, astrology.SE_SATURN)
    return abs(benefic - malefic) <= float(threshold)


def almuten_of_figure_is(chrt, body='jupiter', mode='essential', **_):
    """The Almuten of the figure is the named body.

    `mode='essential'` (default) follows Lilly's CA I Ch.IX–XIII strict
    procedure — max essential dignity over the 5 hyleg places. `mode='hybrid'`
    uses Aries' built-in essential+accidental synthesis. Pack rules that
    cite Lilly should leave the default.
    """
    target = _pid(body)
    am = _almuten_pid(chrt, mode=mode)
    return target is not None and am is not None and target == am


def almuten_of_figure_class(chrt, class_='benefic', mode='essential', **_):
    """The Almuten of the figure belongs to the named class.

    `class_` ∈ {'benefic','malefic'}. Benefics = Venus, Jupiter; malefics
    = Mars, Saturn. `mode` semantics same as `almuten_of_figure_is`.
    """
    am = _almuten_pid(chrt, mode=mode)
    if am is None:
        return False
    if class_ == 'benefic':
        return am in (astrology.SE_VENUS, astrology.SE_JUPITER)
    if class_ == 'malefic':
        return am in (astrology.SE_MARS, astrology.SE_SATURN)
    return False


def south_node_aspects_body(chrt, body='moon', aspects=(0,), orb=8.0, **_):
    """South Node forms one of the named aspects (default conjunction) to
    `body` within `orb`. Used for "Moon conjunct South Node" type tests.
    """
    sn_lon = _south_node_lon(chrt)
    if sn_lon is None:
        return False
    target = _pid(body)
    if target is None:
        return False
    p = _planet(chrt, target)
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    for ang in tuple(aspects):
        if abs(_signed_orb(sn_lon, plon, ang)) <= orb:
            return True
    return False


def asc_in_signs(chrt, signs=(), **_):
    """Ascendant sits in any of the given signs (0=Aries..11=Pisces).

    Used by sickness rules like Lilly's "when you find Scorpio Ascending, you
    may for the most part judge, the party was cause of his owne infirmnesse."
    """
    asc = _asc(chrt)
    if asc is None:
        return False
    return _sign(asc) in set(int(s) for s in signs)


def moon_day(chrt, days=(), anchor='true', **_):
    """Synodic lunar day (1..30) is in the given list.

    Uses `lunar.lunation_day_true(chrt)` by default — i.e. day 1 = apparent
    New Moon, matching the Vedic tithi and the medieval Latin lunarium.
    Used by Hephaistion III.24 §2 "On which days of the Moon the dreams are
    true" and the III.6 effective/ineffective-day table.
    """
    if not days:
        return False
    try:
        import lunar
    except ImportError:
        return False
    if anchor == 'mean':
        n = lunar.lunation_day_mean(chrt)
    else:
        n = lunar.lunation_day_true(chrt)
    return int(n) in set(int(d) for d in days)


def lot_of_fortune_in_signs(chrt, signs=(), **_):
    """Lot of Fortune sits in any of the given signs (0=Aries..11=Pisces).

    Used by Hephaistion III.15 §1 "On the digging-up of wells and ponds":
    Lot of Fortune in a watery sign favours the work.
    """
    if not signs:
        return False
    pof = _part_of_fortune_lon(chrt)
    if pof is None:
        return False
    return _sign(pof) in set(int(s) for s in signs)


def lot_of_fortune_in_houses(chrt, houses=(), **_):
    """Lot of Fortune occupies any of the given houses (1..12)."""
    if not houses:
        return False
    pof = _part_of_fortune_lon(chrt)
    if pof is None:
        return False
    h = _house_of(chrt, pof)
    if h is None:
        return False
    return int(h) in set(int(x) for x in houses)


def dsc_in_signs(chrt, signs=(), **_):
    """Descendant (the 7th cusp) sits in any of the given signs.

    Used by Lilly's pregnancy rule "Sagittarius or Pisces in the 7th, she
    is with childe of a Girle".
    """
    asc = _asc(chrt)
    if asc is None:
        return False
    dsc = (asc + 180.0) % 360.0
    return _sign(dsc) in set(int(s) for s in signs)


def asc_in_early_degrees(chrt, max_deg=3.0, **_):
    """Ascendant within `max_deg` degrees of the start of its sign.

    Lilly CA I, "Considerations before Judgment": *"When either 00 degrees,
    or the first or second degrees of a Sign ascend ... you may not
    adventure judgment, unlesse the Querent be very young."*
    """
    asc = _asc(chrt)
    if asc is None:
        return False
    return _deg_in_sign(asc) < float(max_deg)


def asc_in_late_degrees(chrt, min_deg=27.0, **_):
    """Ascendant within `30 - min_deg` degrees of the next sign.

    Lilly CA I: *"If 27, 28, 29 degrees ascend of any Sign, it's no wayes
    safe to give judgment, except the Querent be in yeers corresponding
    to the number of degrees ascending."*
    """
    asc = _asc(chrt)
    if asc is None:
        return False
    return _deg_in_sign(asc) >= float(min_deg)


def moon_via_combusta(chrt, **_):
    """Moon in the Via Combusta — last 15° of Libra or first 15° of Scorpio.

    Lilly CA I: *"some say, when she is in Via Combusta, which is, when
    she is in the last 15 degrees of Libra, or the first fifteen degrees
    of Scorpio."*  Considered an unsafe-to-judge condition.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    s = _sign(mlon)
    d = _deg_in_sign(mlon)
    if s == 6 and d >= 15.0:  # Libra second half
        return True
    if s == 7 and d < 15.0:   # Scorpio first half
        return True
    return False


def _is_in_own_triplicity(chrt, pid, sign):
    """True if `pid` is one of the triplicity rulers of `sign` per the
    active triplicity table.

    Honors `options.oneruler`: when True only the in-sect ruler counts
    (Lilly-strict — Lilly CA I p.~10571: *"if you find the Sun in Aries,
    and the … Scheam erected be by night … shall not be allowed any
    dignity, as being in his triplicity; for by night the Sun ruleth
    not the fiery Triplicity, but Jupiter"*); when False any of the three
    rulers counts (Bonatti-style).

    **Mars-in-water exception** — Lilly CA I p.~10571 continues:
    *"and this doe generally in all the Planets, Mars excepted, who
    night and day ruleth the watry Triplicity."*  So Mars in any water
    sign always gets the triplicity dignity, regardless of sect or the
    `oneruler` setting. Encoded here as a hardcoded exception.
    """
    try:
        tg = _TRIPLICITY_GROUP[sign]
        # Lilly's Mars-in-water exception (CA I p.~10571).
        if pid == astrology.SE_MARS and tg == 2:
            return True
        rulers = chrt.options.trips[chrt.options.seltrip][tg]
        if getattr(chrt.options, 'oneruler', True):
            daytime = _is_chart_daytime(chrt)
            target = int(rulers[0 if daytime else 1])
            return target == pid
        for r in rulers:
            r = int(r)
            if r == -1:
                continue
            if r == pid:
                return True
        return False
    except Exception:
        return False


_DETRIMENTS = {
    astrology.SE_SUN:     {10},        # Aquarius (opp Leo)
    astrology.SE_MOON:    {9},         # Capricorn (opp Cancer)
    astrology.SE_MERCURY: {8, 11},     # Sag (opp Gem), Pis (opp Vir)
    astrology.SE_VENUS:   {0, 7},      # Aries (opp Lib), Sco (opp Tau)
    astrology.SE_MARS:    {6, 1},      # Libra (opp Aries), Tau (opp Sco)
    astrology.SE_JUPITER: {2, 5},      # Gem (opp Sag), Vir (opp Pis)
    astrology.SE_SATURN:  {3, 4},      # Cancer (opp Cap), Leo (opp Aqu)
}

_FALLS = {
    astrology.SE_SUN:     6,   # Libra (opp Aries exalt)
    astrology.SE_MOON:    7,   # Scorpio (opp Taurus exalt)
    astrology.SE_MERCURY: 11,  # Pisces (opp Virgo exalt)
    astrology.SE_VENUS:   5,   # Virgo (opp Pisces exalt)
    astrology.SE_MARS:    3,   # Cancer (opp Capricorn exalt)
    astrology.SE_JUPITER: 9,   # Capricorn (opp Cancer exalt)
    astrology.SE_SATURN:  0,   # Aries (opp Libra exalt)
}


def body_in_detriment(chrt, body='mercury', **_):
    """Body is in its detriment — the sign opposite its domicile.

    Lilly CA I p.~11578 table: detriment is a **−5 debility**, equal in
    weight to domicile. Aries' Almutens engine does NOT subtract this
    (acknowledged divergence); this predicate exposes the condition for
    pack rules to honor it explicitly.
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) in _DETRIMENTS.get(pid, set())


def body_in_fall(chrt, body='mercury', **_):
    """Body is in its fall — the sign opposite its exaltation. Lilly's
    **−4 debility** (CA I p.~11578)."""
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) == _FALLS.get(pid)


def body_peregrine(chrt, body='mercury', **_):
    """Body is peregrine — has no essential dignity (domicile, exaltation,
    triplicity, term, or face) in its current sign. Lilly's **−5 debility**
    (CA I p.~11578); Lilly: *"In a Sign wherein he hath no essentiall
    dignity."*
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    sign = _sign(_lon(p))
    pos = _deg_in_sign(_lon(p))
    try:
        opts = chrt.options
        if opts.dignities[pid][0][sign]:
            return False
        if opts.dignities[pid][1][sign]:
            return False
        if _is_in_own_triplicity(chrt, pid, sign):
            return False
        span_total = 0.0
        for term_pid, span in opts.terms[opts.selterm][sign]:
            span_total += float(span)
            if span_total > pos:
                if int(term_pid) == pid:
                    return False
                break
        decan_idx = int(pos / 10.0)
        if int(opts.decans[opts.seldecan][sign][decan_idx]) == pid:
            return False
    except Exception:
        return False
    return True


def lord_of_house_in_detriment(chrt, house=1, **_):
    """Lord of `house` is in its detriment."""
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) in _DETRIMENTS.get(pid, set())


def lord_of_house_in_fall(chrt, house=1, **_):
    """Lord of `house` is in its fall."""
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) == _FALLS.get(pid)


def lord_of_house_peregrine(chrt, house=1, **_):
    """Lord of `house` is peregrine — no essential dignity in current sign."""
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    # Reuse body_peregrine logic via a temporary name lookup.
    from astrology import SE_SUN, SE_MOON, SE_MERCURY, SE_VENUS, SE_MARS, SE_JUPITER, SE_SATURN
    name_by_pid = {SE_SUN:'sun', SE_MOON:'moon', SE_MERCURY:'mercury',
                   SE_VENUS:'venus', SE_MARS:'mars', SE_JUPITER:'jupiter',
                   SE_SATURN:'saturn'}
    body_name = name_by_pid.get(pid)
    if body_name is None:
        return False
    return body_peregrine(chrt, body=body_name)


def body_in_own_dignity(chrt, body='venus', level='domicile', **_):
    """Named planet sits in a sign where IT has the named essential dignity.

    `level` ∈ {'domicile','exaltation','triplicity'}. The 'triplicity'
    branch honors `options.oneruler` — when True (Lilly-strict default),
    only the in-sect ruler (Primary by day, Secondary by night) counts;
    when False, any of the three Dorothean rulers counts.
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    sign = _sign(_lon(p))
    if level == 'triplicity':
        return _is_in_own_triplicity(chrt, pid, sign)
    level_idx = {'domicile': 0, 'exaltation': 1}.get(level)
    if level_idx is None:
        return False
    try:
        return bool(chrt.options.dignities[pid][level_idx][sign])
    except Exception:
        return False


def both_luminaries_in_houses(chrt, houses=(), **_):
    """Both Sun and Moon occupy any of the given houses (typically a single
    house — Lilly: *"Sun and Moon in the 10th, sudden recovery."*).
    """
    sun = _planet(chrt, astrology.SE_SUN)
    moon = _planet(chrt, astrology.SE_MOON)
    if sun is None or moon is None:
        return False
    sh = _house_of(chrt, _lon(sun))
    mh = _house_of(chrt, _lon(moon))
    target = set(int(h) for h in houses)
    return sh in target and mh in target


def lord_of_house_in_own_dignity(chrt, house=None, level='exaltation', **_):
    """Lord of `house` sits in a sign where it has the named essential dignity.

    `level` ∈ {'domicile','exaltation','triplicity'}. Used for Lilly:
    *"If the Lord of the 2nd be in his exaltation, there is a great hope
    of recovery."*  Triplicity honors `options.oneruler`.
    """
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    sign = _sign(_lon(p))
    if level == 'triplicity':
        return _is_in_own_triplicity(chrt, pid, sign)
    level_idx = {'domicile': 0, 'exaltation': 1}.get(level)
    if level_idx is None:
        return False
    try:
        return bool(chrt.options.dignities[pid][level_idx][sign])
    except Exception:
        return False


def both_luminaries_below_horizon(chrt, **_):
    """Both Sun and Moon are below the earth (houses 1–6).

    Lilly CA II, "Aphorismes concerning Recovery":
    *"When both the Luminaries are under the earth it cannot be recovered."*
    """
    sun = _planet(chrt, astrology.SE_SUN)
    moon = _planet(chrt, astrology.SE_MOON)
    if sun is None or moon is None:
        return False
    sh = _house_of(chrt, _lon(sun))
    mh = _house_of(chrt, _lon(moon))
    return sh is not None and mh is not None and 1 <= sh <= 6 and 1 <= mh <= 6


def both_luminaries_aspect_house(chrt, house=1, aspects=(0, 60, 90, 120, 180),
                                   orb=6.0, **_):
    """Sun AND Moon each form one of the named aspects to the given house cusp.

    Lilly CA II, "Aphorismes concerning Recovery":
    *"the Sun together with the Moon, beholding the Ascendant cannot be
    lost but will, shortly be discovered."*
    """
    cusp = _house_cusp_lon(chrt, house)
    if cusp is None:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    moon = _planet(chrt, astrology.SE_MOON)
    if sun is None or moon is None:
        return False
    def _aspects_cusp(p):
        plon = _lon(p)
        for ang in tuple(aspects):
            if abs(_signed_orb(plon, cusp, ang)) <= orb:
                return True
        return False
    return _aspects_cusp(sun) and _aspects_cusp(moon)


_MODALITY_SIGNS = {
    'movable': {0, 3, 6, 9},   # Aries, Cancer, Libra, Capricorn
    'fixed':   {1, 4, 7, 10},  # Taurus, Leo, Scorpio, Aquarius
    'common':  {2, 5, 8, 11},  # Gemini, Virgo, Sagittarius, Pisces
}

# Mean daily motion (degrees / day, geocentric ecliptic) for the 7 traditional
# planets. Used to test whether a planet is "swift in motion" (Lilly's term)
# i.e. moving faster than its own average rate.
_PLANET_MEAN_DEG_PER_DAY = {
    astrology.SE_SUN:     0.985,
    astrology.SE_MOON:   13.176,
    astrology.SE_MERCURY: 1.383,
    astrology.SE_VENUS:   1.200,
    astrology.SE_MARS:    0.524,
    astrology.SE_JUPITER: 0.083,
    astrology.SE_SATURN:  0.0334,
}


def recovery_significators_in_modality(chrt, context=None, modality='movable', **_):
    """Both L1 and L_quesited occupy signs of the named modality.

    Lilly CA II, "In what time it shall be recovered":
    *"if they be in moveable Signes, the shorter time is required, or it
    shal be in weeks, or in months; in fixed Signes it Signifies Moneths
    or Yeers; in common Signs a meane betwixt both."*
    """
    if not context:
        return False
    qh = context.get('querent_house')
    qsh = context.get('quesited_house')
    if qh is None or qsh is None:
        return False
    pid_q = _lord_of_house(chrt, qh)
    pid_qs = _lord_of_house(chrt, qsh)
    if pid_q is None or pid_qs is None:
        return False
    pq = _planet(chrt, pid_q)
    pqs = _planet(chrt, pid_qs)
    if pq is None or pqs is None:
        return False
    target = _MODALITY_SIGNS.get(str(modality).lower())
    if not target:
        return False
    return _sign(_lon(pq)) in target and _sign(_lon(pqs)) in target


def recovery_application_motion(chrt, context=None, motion='retrograde',
                                  orb=6.0, aspects=(0, 60, 90, 120, 180), **_):
    """L1 and L_quesited are within orb of an applying aspect, AND their
    motion matches `motion`.  motion='retrograde' fires when at least one
    significator is retrograde at the time of application; motion='direct'
    fires only when both are direct.

    Lilly CA II, "Aphorismes concerning Recovery":
    *"if the application of the Significators be by Retrogradation, the
    recovery shall bee sudden, if the application be by direction, the
    recovery shall be before it be looked for."*
    """
    if not context:
        return False
    qh = context.get('querent_house')
    qsh = context.get('quesited_house')
    if qh is None or qsh is None:
        return False
    pid_q = _lord_of_house(chrt, qh)
    pid_qs = _lord_of_house(chrt, qsh)
    if pid_q is None or pid_qs is None or pid_q == pid_qs:
        return False
    applying = False
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pid_q, pid_qs, ang, orb) in ('applying', 'exact'):
            applying = True
            break
    if not applying:
        return False
    pq = _planet(chrt, pid_q)
    pqs = _planet(chrt, pid_qs)
    if pq is None or pqs is None:
        return False
    sq = _speed(pq)
    ss = _speed(pqs)
    if motion == 'retrograde':
        return sq < 0.0 or ss < 0.0
    if motion == 'direct':
        return sq >= 0.0 and ss >= 0.0
    return False


def lord_of_house_swift(chrt, house=None, **_):
    """Lord of `house` is moving faster than its own mean daily motion.

    Lilly CA II, "In what time it shall be recovered":
    *"if the Significator be quick in motion, they Signifie it shall be
    recovered quickly, or lightly."*  Mean motions per the standard
    geocentric daily-rate table.
    """
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    mean = _PLANET_MEAN_DEG_PER_DAY.get(pid)
    if mean is None:
        return False
    return _speed(p) > mean


# ─────────────────────────────────────────────────────────────
# "Is X the lord of …" / "Is X in the sign of …" / hour-lord
# Generic identity-style predicates. Used by Lilly's "Of THEFTS"
# compound conditionals (CA II:6508–6579) — *"If the Moon be Lady of
# the ascendant, and in the 4th, and the Lord of the 2nd in the
# 7th …"* — but reusable by any author whose rule needs to compose
# "this body IS that lord" or "this body sits in the sign on that
# cusp" or "this body is the planetary-hour ruler".
# ─────────────────────────────────────────────────────────────


def body_is_lord_of_house(chrt, body='moon', house=None, **_):
    """True iff `body` is the traditional sign-ruler of `house`'s cusp.

    Lilly idiom: *"If the Moon be Lady of the 2nd …"* — i.e. Cancer
    is on the 2nd cusp. Generic over body and house, so a Sahl rule
    on Mercury-as-Lord-of-9 reads identically.
    """
    if house is None:
        return False
    pid = _pid(body)
    if pid is None:
        return False
    return _lord_of_house(chrt, int(house)) == pid


def body_in_sign_of_house_cusp(chrt, body='moon', cusp_house=None, **_):
    """True iff `body` is currently in the sign on `cusp_house`'s cusp.

    Lilly idiom: *"in the sign of the 7th"* / *"in the Signe of the
    10th"* — meaning the planet sits in the same zodiacal sign as
    the cusp of that house, regardless of which house the planet's
    longitude falls into by quadrant division.
    """
    if cusp_house is None:
        return False
    pid = _pid(body)
    if pid is None:
        return False
    cusp = _house_cusp_lon(chrt, int(cusp_house))
    if cusp is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) == _sign(cusp)


def body_is_planetary_hour_lord(chrt, body='moon', **_):
    """True iff `body` is the ruler of the current planetary hour.

    Lilly idiom: *"the Moon be Lady of the hour"* / *"Lord of the
    hour being Lord of the 7th"*. Reads `chrt.time.ph.planetaryhour`
    via `_hour_lord_pid`.
    """
    pid = _pid(body)
    if pid is None:
        return False
    return _hour_lord_pid(chrt) == pid


def hour_lord_is_lord_of_house(chrt, house=None, **_):
    """True iff the planetary-hour ruler is also the sign-ruler of
    `house`'s cusp. Lilly's *"the Lord of the hour being Lord of the
    7th"* in the "Of THEFTS" compound at CA II:6541–6542.
    """
    if house is None:
        return False
    hp = _hour_lord_pid(chrt)
    if hp is None:
        return False
    return _lord_of_house(chrt, int(house)) == hp


# ─────────────────────────────────────────────────────────────
# "Increasing in motion / free from infortunes" doctrine
# (CA II Ch.L "If it shall be recovered", lines 7263–7294)
# ─────────────────────────────────────────────────────────────
#
# Lilly's most refined recovery test: the Lord of the term of the Moon
# AND the Lord of the house of the Moon both *increasing* in motion (and
# in number — Lilly explains the two phrasings name the same thing:
# *"To encrease in motion is, whenas lately a Planet had moved slowly,
# and now encreases his motion, or moves more quick; to encrease in
# number is, when the day subsequent he is found to have moved more
# minutes then the day or dayes preceding."*) AND free from infortunes
# (no hard aspect to Saturn or Mars within orb).
#
# "Increasing" is implemented by comparing today's swisseph SPLON to
# the SPLON one day prior. Two-planet test relies on `_speed_at`.

def _speed_at(chrt, pid, jd_offset_days=0.0):
    """Instantaneous SPLON for `pid` at chart's JD plus `jd_offset_days`.

    Uses the same flag the chart pipeline uses (SWIEPH | SPEED, plus
    SIDEREAL when an ayanamsha is selected — preserved for sidereal
    packs that may land later). Returns None on any swisseph failure.
    """
    try:
        flag = astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
        if getattr(chrt.options, 'topocentric', False):
            flag |= astrology.SEFLG_TOPOCTR
        jd = chrt.time.jd + float(jd_offset_days)
        serr, data = astrology.swe_calc_ut(jd, int(pid), flag)
        if serr:
            return None
        return float(data[3])  # SPLON
    except Exception:
        return None


def _speed_increasing(chrt, pid, lookback_days=1.0):
    """True iff today's SPLON > SPLON `lookback_days` days ago.

    Signed comparison: a planet going from -0.5°/day yesterday to
    +0.1°/day today (i.e. coming out of retrograde) counts as
    increasing — that matches Lilly's "moves more quick" sense.
    """
    today = _speed_at(chrt, pid, 0.0)
    earlier = _speed_at(chrt, pid, -float(lookback_days))
    if today is None or earlier is None:
        return False
    return today > earlier


def _body_free_from_infortunes(chrt, pid, orb=8.0,
                                aspects=(0, 90, 180), include_south_node=True):
    """No hard-aspect testimony from Saturn/Mars (and optionally South
    Node) to `pid` within orb. Returns True when the body has no
    Saturn-or-Mars contact across `aspects`.
    """
    if pid is None:
        return False
    aspects = tuple(aspects)
    for malefic in (astrology.SE_SATURN, astrology.SE_MARS):
        if pid == malefic:
            continue
        if _aspect_bodies(chrt, pid, malefic, aspects, orb):
            return False
    if include_south_node:
        sn = _south_node_lon(chrt)
        body = _planet(chrt, pid)
        if sn is not None and body is not None:
            d = _ang_diff(_lon(body), sn)
            if any(abs(d - ang) <= orb for ang in aspects):
                return False
    return True


def body_speed_increasing(chrt, body='moon', lookback_days=1.0, **_):
    """Today's SPLON for `body` exceeds its SPLON `lookback_days` ago.

    Public predicate exposing Lilly's "increasing in motion / number"
    test. Composable via `all_of` for chained recovery aphorisms.
    """
    pid = _pid(body)
    if pid is None:
        return False
    return _speed_increasing(chrt, pid, lookback_days)


def body_free_from_infortunes(chrt, body='moon', orb=8.0,
                                aspects=(0, 90, 180), include_south_node=True, **_):
    """Public predicate — body has no Saturn/Mars (and optionally South
    Node) hard-aspect contact within orb. Generic enough to compose
    into any "free of malefic affliction" rule, not just recovery.
    """
    return _body_free_from_infortunes(chrt, _pid(body), orb,
                                       aspects, include_south_node)


def lords_of_moon_increasing_and_free(chrt, orb=8.0,
                                        aspects_to_infortunes=(0, 90, 180),
                                        lookback_days=1.0, **_):
    """Compound aphorism: Lord of house of Moon AND Lord of term of Moon
    are BOTH increasing in motion AND free from infortunes.

    Lilly CA II, "If it shall be recovered" (CA II Ch.L:7263–7294):
    *"If the Lord of the term of the Moon, and the Lord of the house of
    the Moon be increasing both in motion and number, and free from
    infortunes; it shews it shall be recovered whole and found, and
    nothing diminished thereof."*  This is Lilly's strongest single
    recovery testimony — bundled here as one predicate because the
    compound is doctrine-specific, not a general primitive.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    house_lord = _SIGN_RULERS.get(_sign(mlon))
    term_lord = _term_lord_of(chrt, mlon)
    if house_lord is None or term_lord is None:
        return False
    aspects_to_infortunes = tuple(aspects_to_infortunes)
    for pid in {house_lord, term_lord}:
        if not _speed_increasing(chrt, pid, lookback_days):
            return False
        if not _body_free_from_infortunes(chrt, pid, orb,
                                            aspects_to_infortunes):
            return False
    return True


def both_luminaries_closer_to_angle(chrt, angle='ASC', **_):
    """Both Sun and Moon are angularly closer to the named angle
    (ASC / MC / DSC / IC) than to any of the other three angles.

    Lilly CA II, "Aphorismes concerning Recovery": *"If both Sun and
    Moon be nearer the Ascendant then any other angle, it signifyes
    recovery of the thing with much trouble, anxiety, strife,
    bloodshed, or quarrelling."*

    Strict-less-than comparison: a luminary tied between two angles
    does NOT fire (no preferred angle). Matches the doctrinal sense —
    "nearer than" means strictly nearest.
    """
    angle = (angle or 'ASC').upper()
    target = _point_lon(chrt, angle)
    if target is None:
        return False
    other_lons = []
    for name in ('ASC', 'MC', 'DSC', 'IC'):
        if name == angle:
            continue
        l = _point_lon(chrt, name)
        if l is None:
            return False
        other_lons.append(l)
    sun = _planet(chrt, astrology.SE_SUN)
    moon = _planet(chrt, astrology.SE_MOON)
    if sun is None or moon is None:
        return False
    for body in (sun, moon):
        d_target = _ang_diff(_lon(body), target)
        for other in other_lons:
            if _ang_diff(_lon(body), other) <= d_target:
                return False
    return True


def lord_of_house_in_signs(chrt, house=None, signs=(), **_):
    """Lord of `house` currently sits in any of the given signs (0=Aries..11=Pisces).

    Used by Lilly's "Which way" / "In what grounds they be" beast-direction
    and beast-terrain readings — Lord-of-6th by sign element / modality.
    """
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) in set(int(s) for s in signs)


def lord_of_house_aspects_body(chrt, house=None, body='jupiter',
                                aspects=(0, 60, 90, 120, 180), orb=6.0,
                                directions=('applying', 'separating', 'exact'), **_):
    """Lord of `house` aspects the named body within orb. By default fires on any
    direction (applying or separating); pass `directions=['applying','exact']`
    for applying-only.

    Used by Lilly's beast-fortune/affliction readings ("Lord-of-6th unfortunate
    by Saturn", "Lord-of-6th fortunate by Jupiter or Venus") and theft thief-vs-
    significator aspect tests.
    """
    if house is None:
        return False
    pid_lord = _lord_of_house(chrt, house)
    pid_body = _pid(body)
    if pid_lord is None or pid_body is None or pid_lord == pid_body:
        return False
    dirs = tuple(directions)
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, pid_lord, pid_body, ang, orb)
        if d in dirs:
            return True
    return False


def querent_lord_separated_or_disposed(chrt, context=None, planet='saturn',
                                        orb=8.0, aspects=(0, 60, 90, 120, 180),
                                        check_domicile=True, **_):
    """L1 has separated from `planet` (any Ptolemaic aspect within orb), OR —
    when `check_domicile=True` — currently sits in a sign ruled by `planet`.

    Lilly CA II, "How the things or Goods was lost": *"behold from whom
    the Lord of the Ascendant did last separate, and if he did separate
    from Saturn ... if he be separated from Jupiter, or in the house of
    Jupiter ..."* — the chapter uses 'separated from X' and 'in the
    house of X' interchangeably for the manner-of-loss diagnostic.
    Saturn and Mercury entries in the chapter omit the 'or his house'
    half; for those rules pass `check_domicile=False`.
    """
    if not context:
        return False
    qh = context.get('querent_house')
    if qh is None:
        return False
    pid_q = _lord_of_house(chrt, qh)
    pid_target = _pid(planet)
    if pid_q is None or pid_target is None or pid_q == pid_target:
        return False
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pid_q, pid_target, ang, orb) == 'separating':
            return True
    if check_domicile:
        a = _planet(chrt, pid_q)
        if a is not None:
            sign_lord = _SIGN_RULERS.get(_sign(_lon(a)))
            if sign_lord == pid_target:
                return True
    return False

def querent_lord_separating_from_lord_of_house(chrt, context=None, house=None,
                                                 orb=6.0,
                                                 aspects=(0, 60, 90, 120, 180),
                                                 **_):
    """Lord of querent is separating from an aspect with the lord of `house`.

    Lilly uses "separation" diagnostically — "he has lately been in X"
    when the querent's significator just left an aspect with the lord of
    house X (12 for prison, 7 for quarrel, etc.). This now uses the
    signed-orb direction detector, so it fires only on the separating
    side of the aspect.
    """
    if not context or house is None:
        return False
    qh = context.get('querent_house')
    if qh is None:
        return False
    pid_q = _lord_of_house(chrt, qh)
    pid_h = _lord_of_house(chrt, house)
    if pid_q is None or pid_h is None or pid_q == pid_h:
        return False
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pid_q, pid_h, ang, orb) == 'separating':
            return True
    return False


def querent_quesited_aspect(chrt, context=None, orb=6.0,
                             aspects=(0, 60, 90, 120, 180),
                             directions=None, **_):
    """Lord of querent aspects lord of quesited — the classical
    'perfection' check for whether the matter comes to pass.

    `directions=None` (default) is direction-agnostic ("in aspect");
    pass `["applying", "exact"]` when the rule text says "applies to".
    """
    if not context: return False
    qh = context.get('querent_house'); qsh = context.get('quesited_house')
    if qh is None or qsh is None: return False
    pid_q = _lord_of_house(chrt, qh)
    pid_qs = _lord_of_house(chrt, qsh)
    if pid_q is None or pid_qs is None or pid_q == pid_qs: return False
    if directions is None:
        a = _planet(chrt, pid_q); b = _planet(chrt, pid_qs)
        if a is None or b is None: return False
        d = _ang_diff(_lon(a), _lon(b))
        return any(abs(d - ang) <= orb for ang in aspects)
    for ang in tuple(aspects):
        d = _aspect_direction(chrt, pid_q, pid_qs, ang, orb)
        if d in tuple(directions):
            return True
    return False


def lords_perfect(chrt, context=None, house_a=None, house_b=None,
                   orb=6.0, aspects=(0, 60, 90, 120, 180),
                   directions=('applying', 'exact'), **_):
    """Lord of `house_a` forms a directional aspect to lord of `house_b`.

    Generalises `querent_quesited_aspect` to any pair of houses (e.g. L2↔L7
    for "thing perfects with stranger / finder", L1↔L4 for "querent reaches
    hidden place"). House args accept literal ints OR context keys like
    'querent_house' / 'quesited_house', so a single rule can adapt to UI
    significator overrides. Defaults to applying-only via `_aspect_direction`,
    matching the Moon-applies family — pass `directions=('applying','separating','exact')`
    to fire on either side.
    """
    def _resolve(spec):
        if isinstance(spec, int):
            return spec
        if isinstance(spec, str) and context:
            return context.get(spec)
        return None
    ha = _resolve(house_a); hb = _resolve(house_b)
    if ha is None or hb is None:
        return False
    pid_a = _lord_of_house(chrt, ha)
    pid_b = _lord_of_house(chrt, hb)
    if pid_a is None or pid_b is None or pid_a == pid_b:
        return False
    dirs = tuple(directions)
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pid_a, pid_b, ang, orb) in dirs:
            return True
    return False


# ─────────────────────────────────────────────────────────────
# Reception — one planet in a dignity of another
# ─────────────────────────────────────────────────────────────

_RECEPTION_LEVEL_LABELS = {
    'domicile':   'Domicile',
    'exaltation': 'Exaltation',
    'triplicity': 'Triplicity',
    'term':       'Term',
    'face':       'Face',
}


def _reception_levels_of(chrt, pid_a, pid_b):
    """Return a list of dignity-level strings where B rules the position of A.

    Reads the engine's `chart.get_planet_essential_dignities` output.
    Empty list = no reception. Triplicity may list multiple rulers — if
    `pid_b` is any of them the level counts.
    """
    try:
        info = chrt.get_planet_essential_dignities(pid_a)
    except Exception:
        return []
    if not info:
        return []
    rows = info.get('rows') or []
    found = []
    for row in rows:
        label = (row.get('label') or '').lower()
        if label not in _RECEPTION_LEVEL_LABELS:
            continue
        if row.get('ruler') == pid_b:
            found.append(label)
            continue
        rulers = row.get('rulers') or ()
        if pid_b in rulers:
            found.append(label)
    return found


def reception_between(chrt, receiver='jupiter', received='venus',
                       levels=('domicile', 'exaltation', 'triplicity'), **_):
    """True when `received` is in a dignity of `receiver` at one of `levels`.

    Reception terminology: if Mars is in Saturn's sign, "Saturn receives
    Mars". Saturn = `receiver`, Mars = `received`. Default `levels`
    covers the three majors; pass `levels=['domicile']` for strict
    rulership-only reception, or add 'term'/'face' for minor reception.
    """
    pid_recv = _pid(receiver)
    pid_of = _pid(received)
    if pid_recv is None or pid_of is None:
        return False
    found = _reception_levels_of(chrt, pid_of, pid_recv)
    target = set(str(x).lower() for x in tuple(levels))
    return any(lvl in target for lvl in found)


def lord_receives_lord(chrt, context=None, receiver='quesited_house',
                        received='querent_house',
                        levels=('domicile', 'exaltation', 'triplicity'), **_):
    """Context-aware reception between two house lords.

    `receiver` and `received` are context keys (usually
    `"querent_house"` / `"quesited_house"`) whose lords are resolved
    from the chart. True when `received_lord` is in a dignity of
    `receiver_lord`.
    """
    if not context:
        return False
    recv_house = context.get(receiver)
    recd_house = context.get(received)
    if recv_house is None or recd_house is None:
        return False
    pid_recv = _lord_of_house(chrt, recv_house)
    pid_recd = _lord_of_house(chrt, recd_house)
    if pid_recv is None or pid_recd is None or pid_recv == pid_recd:
        return False
    found = _reception_levels_of(chrt, pid_recd, pid_recv)
    target = set(str(x).lower() for x in tuple(levels))
    return any(lvl in target for lvl in found)


def lords_in_mutual_reception(chrt, context=None,
                                levels=('domicile', 'exaltation'), **_):
    """Lord of querent and lord of quesited each in a dignity of the other.

    The canonical "best of all" marriage / perfection testimony in
    classical horary (Lilly CA II, "Of Marriage": *"with Reception,
    best of all"*). Defaults to domicile + exaltation only; pass a
    wider `levels` list to include minor reception.
    """
    if not context:
        return False
    qh = context.get('querent_house'); qsh = context.get('quesited_house')
    if qh is None or qsh is None:
        return False
    pid_q = _lord_of_house(chrt, qh)
    pid_qs = _lord_of_house(chrt, qsh)
    if pid_q is None or pid_qs is None or pid_q == pid_qs:
        return False
    a_in_b = _reception_levels_of(chrt, pid_q, pid_qs)
    b_in_a = _reception_levels_of(chrt, pid_qs, pid_q)
    target = set(str(x).lower() for x in tuple(levels))
    return (any(lvl in target for lvl in a_in_b)
            and any(lvl in target for lvl in b_in_a))


def lords_in_mutual_reception_houses(chrt, house_a=1, house_b=7,
                                       levels=('domicile', 'exaltation'), **_):
    """Generic mutual reception between the lords of any two houses.

    Used by the Considerations theme to surface mutual receptions that
    aren't tied to a specific question (e.g. L1↔L7 by default — Lilly
    flags this as a major saving grace independent of question type).
    """
    pid_a = _lord_of_house(chrt, house_a)
    pid_b = _lord_of_house(chrt, house_b)
    if pid_a is None or pid_b is None or pid_a == pid_b:
        return False
    a_in_b = _reception_levels_of(chrt, pid_a, pid_b)
    b_in_a = _reception_levels_of(chrt, pid_b, pid_a)
    target = set(str(x).lower() for x in tuple(levels))
    return (any(lvl in target for lvl in a_in_b)
            and any(lvl in target for lvl in b_in_a))


# ─────────────────────────────────────────────────────────────
# Translation and collection of light (horary perfection paths 2 & 3)
# ─────────────────────────────────────────────────────────────

_CLASSICAL_PLANETS = (
    'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'sun',
)


def _arc_to_perfection(chrt, faster_pid, slower_pid, aspects, orb):
    """If `faster_pid` is currently applying to `slower_pid` by any of the
    given aspects within `orb`, return (arc_remaining_in_degrees, aspect_angle)
    for the closest such application. Otherwise None.
    """
    a = _planet(chrt, faster_pid)
    b = _planet(chrt, slower_pid)
    if a is None or b is None:
        return None
    la, lb = _lon(a), _lon(b)
    if la is None or lb is None:
        return None
    best = None
    for ang in tuple(aspects):
        if _aspect_direction(chrt, faster_pid, slower_pid, ang, orb) in ('applying', 'exact'):
            arc = abs(_signed_orb(la, lb, ang))
            if best is None or arc < best[0]:
                best = (arc, ang)
    return best


def frustration(chrt, faster='moon', slower='saturn',
                 aspects=(0, 60, 90, 120, 180), orb=8.0, **_):
    """The faster is applying to the slower, but before perfection the
    slower itself perfects a closer-orb aspect with a third planet —
    the swift is **frustrated**, the slow is **frustrater**.

    Lilly CA I Ch.XXVI: *"Frustration is when a swift Planet would come
    to the Conjunction or Aspect of a slower planet, but before he can
    come to it, the slower is joyned to another, and so doth frustrate
    the swift."*
    """
    pa = _pid(faster); pb = _pid(slower)
    if pa is None or pb is None or pa == pb:
        return False
    a_to_b = _arc_to_perfection(chrt, pa, pb, aspects, orb)
    if a_to_b is None:
        return False
    arc_ab = a_to_b[0]
    for cname in _CLASSICAL_PLANETS:
        pc = _pid(cname)
        if pc in (pa, pb):
            continue
        # Check whether B is itself applying to a third planet C with smaller arc
        b_to_c = _arc_to_perfection(chrt, pb, pc, aspects, orb)
        if b_to_c and b_to_c[0] < arc_ab:
            return True
    return False


def prohibition(chrt, faster='moon', slower='saturn',
                 aspects=(0, 60, 90, 120, 180), orb=8.0, **_):
    """A and B applying; a third planet C reaches A *or* B by aspect first
    (with smaller arc), interposing.

    Lilly CA I Ch.XXVI: *"Prohibition, when two Planets would come to a
    corporal Conjunction or Aspect, but before they can come to it, a
    third Planet doth interpose, by his Body or Aspect, so that he
    hindereth their Conjunction or Aspect."*
    """
    pa = _pid(faster); pb = _pid(slower)
    if pa is None or pb is None or pa == pb:
        return False
    a_to_b = _arc_to_perfection(chrt, pa, pb, aspects, orb)
    if a_to_b is None:
        return False
    arc_ab = a_to_b[0]
    for cname in _CLASSICAL_PLANETS:
        pc = _pid(cname)
        if pc in (pa, pb):
            continue
        c_to_a = _arc_to_perfection(chrt, pc, pa, aspects, orb)
        if c_to_a and c_to_a[0] < arc_ab:
            return True
        c_to_b = _arc_to_perfection(chrt, pc, pb, aspects, orb)
        if c_to_b and c_to_b[0] < arc_ab:
            return True
    return False


def refranation(chrt, faster='moon', slower='saturn',
                 aspects=(0, 60, 90, 120, 180), orb=8.0,
                 station_threshold=0.1, **_):
    """A and B in applying-aspect orb, but at least one is currently
    retrograde OR within `station_threshold` of zero motion (near-station).

    Lilly CA I Ch.XXVI: *"Refrenation, when two Planets are applying
    together, before they come to perfect Conjunction or Aspect, one or
    both turn retrograde. The application is unprofitable."*  Now also
    catches the near-station case via the existing `planet_stationary`
    primitive — a planet whose absolute speed is near zero is on the
    verge of retrograding (or just turned direct), and Lilly's
    refranation includes that liminal state.

    The `station_threshold` default 0.1°/day catches outer-planet
    near-stations cleanly. For Mercury / Venus near-station detection,
    pass a wider threshold (e.g. 0.3°/day) at the rule-args level.
    """
    pa = _pid(faster); pb = _pid(slower)
    if pa is None or pb is None or pa == pb:
        return False
    a_to_b = _arc_to_perfection(chrt, pa, pb, aspects, orb)
    if a_to_b is None:
        return False
    a = _planet(chrt, pa); b = _planet(chrt, pb)
    if _speed(a) < 0.0 or _speed(b) < 0.0:
        return True
    # Near-station: either planet's absolute speed below threshold.
    if planet_stationary(chrt, planet=faster, threshold=station_threshold):
        return True
    if planet_stationary(chrt, planet=slower, threshold=station_threshold):
        return True
    return False


_DIURNAL_PLANETS = {astrology.SE_SUN, astrology.SE_JUPITER, astrology.SE_SATURN}
_NOCTURNAL_PLANETS = {astrology.SE_MOON, astrology.SE_VENUS, astrology.SE_MARS}
_MASCULINE_SIGNS = {0, 2, 4, 6, 8, 10}  # Aries, Gem, Leo, Lib, Sag, Aqu


def _is_chart_daytime(chrt):
    try:
        return bool(chrt.planets.planets[astrology.SE_SUN].abovehorizon)
    except Exception:
        return True


def _planet_sect(chrt, pid):
    """'diurnal' or 'nocturnal' or None. Mercury is diurnal when oriental
    of the Sun, nocturnal when occidental — checked via the sign of
    `(sun_lon - merc_lon) mod 360`."""
    if pid in _DIURNAL_PLANETS:
        return 'diurnal'
    if pid in _NOCTURNAL_PLANETS:
        return 'nocturnal'
    if pid == astrology.SE_MERCURY:
        try:
            slon = chrt.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]
            mlon = chrt.planets.planets[astrology.SE_MERCURY].data[planets.Planet.LONG]
            d = (slon - mlon) % 360.0
            return 'diurnal' if d < 180.0 else 'nocturnal'
        except Exception:
            return 'diurnal'
    return None


def body_in_hayz(chrt, body='moon', **_):
    """Body is in Hayz — Lilly's three-way alignment of sect, hemisphere,
    and sign gender.

    CA I Ch.XV "+1" accidental dignity. Diurnal planets (Sun, Jupiter,
    Saturn) are in Hayz when in a **day chart**, **above the horizon**,
    in a **masculine sign**. Nocturnal planets (Moon, Venus, Mars) are
    in Hayz when in a **night chart**, **below the horizon**, in a
    **feminine sign**. Mercury inherits its sect from oriental/occidental
    relation to the Sun.
    """
    pid = _pid(body)
    if pid is None:
        return False
    sect = _planet_sect(chrt, pid)
    if sect is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    daytime = _is_chart_daytime(chrt)
    above = bool(getattr(p, 'abovehorizon', False))
    sign_idx = _sign(_lon(p))
    masculine = sign_idx in _MASCULINE_SIGNS
    if sect == 'diurnal':
        return daytime and above and masculine
    return (not daytime) and (not above) and (not masculine)


def body_near_fixed_star(chrt, body='moon', star='regulus', orb=2.0, **_):
    """Named body within `orb` zodiacal-longitude degrees of a named
    fixed star, looked up in the chart's loaded fixstar table.

    Lilly Ch.X uses tight orbs (1-2°) for behenian-star contacts. The
    chart only carries the stars enabled in `options.fixstars`; if the
    requested star isn't loaded, this predicate silently returns False.
    """
    pid = _pid(body)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    target = str(star).strip().lower()
    try:
        for entry in chrt.fixstars.data:
            name = str(entry[0]).strip().lower()
            if name == target:
                slon = float(entry[2])
                return _ang_diff(plon, slon) <= float(orb)
    except Exception:
        return False
    return False


def body_beleaguered(chrt, body='moon', orb=8.0, **_):
    """Body sits between Venus and Jupiter in zodiacal order with both
    within `orb` of conjunction-distance — the benefic counterpart to
    besieged-by-malefics. Lilly Ch.XV accidental dignity.
    """
    pid = _pid(body)
    if pid in (None, astrology.SE_VENUS, astrology.SE_JUPITER):
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    venus = _planet(chrt, astrology.SE_VENUS)
    jup = _planet(chrt, astrology.SE_JUPITER)
    if venus is None or jup is None:
        return False
    vlon = _lon(venus); jlon = _lon(jup)
    if _ang_diff(plon, vlon) > orb or _ang_diff(plon, jlon) > orb:
        return False
    def _signed(a, b):
        d = (a - b) % 360.0
        return d if d <= 180.0 else d - 360.0
    sv = _signed(vlon, plon); sj = _signed(jlon, plon)
    return (sv > 0 > sj) or (sv < 0 < sj)


def lord_of_house_cazimi(chrt, house=1, orb=0.283, **_):
    """Lord of `house` within 17' of the Sun. Lilly's "+5" cazimi."""
    pid = _lord_of_house(chrt, house)
    if pid is None or pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    return _ang_diff(_lon(sun), _lon(p)) <= float(orb)


def lord_of_house_under_beams(chrt, house=1, combust_orb=8.5, beams_orb=17.0, **_):
    """Lord of `house` between combust orb and beams orb of Sun.
    Lilly's "−4" under the beams."""
    pid = _lord_of_house(chrt, house)
    if pid is None or pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    d = _ang_diff(_lon(sun), _lon(p))
    return float(combust_orb) < d <= float(beams_orb)


def lord_of_house_besieged(chrt, house=1, orb=8.0, **_):
    """Lord of `house` between Mars and Saturn in zodiacal order, both
    within `orb` of conjunction-distance to it."""
    pid = _lord_of_house(chrt, house)
    if pid is None or pid in (astrology.SE_MARS, astrology.SE_SATURN):
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    mars = _planet(chrt, astrology.SE_MARS)
    sat = _planet(chrt, astrology.SE_SATURN)
    if mars is None or sat is None:
        return False
    mlon = _lon(mars); slon = _lon(sat)
    if _ang_diff(plon, mlon) > orb or _ang_diff(plon, slon) > orb:
        return False
    def _signed(a, b):
        d = (a - b) % 360.0
        return d if d <= 180.0 else d - 360.0
    sm = _signed(mlon, plon); ss = _signed(slon, plon)
    return (sm > 0 > ss) or (sm < 0 < ss)


def lord_of_house_beleaguered(chrt, house=1, orb=8.0, **_):
    """Lord of `house` between Venus and Jupiter in zodiacal order with
    both within `orb` of it."""
    pid = _lord_of_house(chrt, house)
    if pid is None or pid in (astrology.SE_VENUS, astrology.SE_JUPITER):
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    venus = _planet(chrt, astrology.SE_VENUS)
    jup = _planet(chrt, astrology.SE_JUPITER)
    if venus is None or jup is None:
        return False
    vlon = _lon(venus); jlon = _lon(jup)
    if _ang_diff(plon, vlon) > orb or _ang_diff(plon, jlon) > orb:
        return False
    def _signed(a, b):
        d = (a - b) % 360.0
        return d if d <= 180.0 else d - 360.0
    sv = _signed(vlon, plon); sj = _signed(jlon, plon)
    return (sv > 0 > sj) or (sv < 0 < sj)


def l1_received_by_any_lord(chrt, levels=('domicile', 'exaltation'), **_):
    """Lord of Asc is received by SOME other house's lord at one of the
    listed dignity levels. Lilly's universal "the querent has friends in
    the figure" observation — surfaces a key reception-chain testimony
    independent of question type.
    """
    pid_q = _lord_of_house(chrt, 1)
    if pid_q is None:
        return False
    target = set(str(l).lower() for l in levels)
    for h in range(2, 13):
        pid_h = _lord_of_house(chrt, h)
        if pid_h is None or pid_h == pid_q:
            continue
        found = _reception_levels_of(chrt, pid_q, pid_h)
        if any(lvl in target for lvl in found):
            return True
    return False


def _dispositor_terminus(chrt, start_pid, max_iter=15):
    """Follow the dispositor chain starting at `start_pid`. Each step:
    look at the planet's current sign, find that sign's domicile ruler,
    set ruler as next step. Continue until we hit a planet that rules
    its own sign (terminal) or detect a cycle.

    Returns the terminal SE planet id, or None on cycle / failure.
    """
    if start_pid is None:
        return None
    seen = set()
    current = start_pid
    for _ in range(int(max_iter)):
        if current in seen:
            return None  # cycle without terminus
        seen.add(current)
        p = _planet(chrt, current)
        if p is None:
            return None
        ruler = _SIGN_RULERS.get(_sign(_lon(p)))
        if ruler is None or ruler == current:
            return current
        current = ruler
    return None


def dispositor_chain_terminus_is(chrt, start_house=1, body='mars', **_):
    """The dispositor chain starting at the lord of `start_house` ends at
    the named body (i.e., the named body rules its own sign and is the
    final dispositor of the chain).

    Lilly: "X hath final dominion over the matter" — the planet at the
    end of the chain governs all signification flowing through it.
    """
    start_pid = _lord_of_house(chrt, start_house)
    terminus = _dispositor_terminus(chrt, start_pid)
    target = _pid(body)
    return terminus is not None and target is not None and terminus == target


def dispositor_chain_terminus_class(chrt, start_house=1, class_='benefic', **_):
    """The dispositor chain terminus belongs to the named class.

    `class_` ∈ {'benefic','malefic','self'}. 'self' means the chain ends
    at the same planet it started (the starting significator rules its
    own sign — the querent is "his own master," self-contained).
    """
    start_pid = _lord_of_house(chrt, start_house)
    terminus = _dispositor_terminus(chrt, start_pid)
    if terminus is None:
        return False
    if class_ == 'benefic':
        return terminus in (astrology.SE_VENUS, astrology.SE_JUPITER)
    if class_ == 'malefic':
        return terminus in (astrology.SE_MARS, astrology.SE_SATURN)
    if class_ == 'self':
        return terminus == start_pid
    return False


def lords_perfect_with_reception(chrt, context=None, house_a=None, house_b=None,
                                   aspects=(0, 60, 90, 120, 180), orb=6.0,
                                   reception_levels=('domicile', 'exaltation'),
                                   directions=('applying', 'exact'), **_):
    """Lord of `house_a` perfects with lord of `house_b` by aspect AND
    the pair is in mutual reception by major dignity.

    Lilly's "with reception, best of all" — the strongest possible
    perfection. Even a square or opposition with mutual reception
    inclines to good outcome. House args accept literal ints OR context
    keys ('querent_house'/'quesited_house'/etc.) for use in any theme.
    """
    def _resolve(spec):
        if isinstance(spec, int):
            return spec
        if isinstance(spec, str) and context:
            return context.get(spec)
        return None
    ha = _resolve(house_a); hb = _resolve(house_b)
    if ha is None or hb is None:
        return False
    pid_a = _lord_of_house(chrt, ha)
    pid_b = _lord_of_house(chrt, hb)
    if pid_a is None or pid_b is None or pid_a == pid_b:
        return False
    dirs = tuple(directions)
    has_aspect = False
    for ang in tuple(aspects):
        if _aspect_direction(chrt, pid_a, pid_b, ang, orb) in dirs:
            has_aspect = True
            break
    if not has_aspect:
        return False
    target = set(str(l).lower() for l in reception_levels)
    a_in_b = _reception_levels_of(chrt, pid_a, pid_b)
    b_in_a = _reception_levels_of(chrt, pid_b, pid_a)
    return (any(lvl in target for lvl in a_in_b)
            and any(lvl in target for lvl in b_in_a))


def lord_of_house_near_fixed_star(chrt, house=1, star='regulus', orb=2.0, **_):
    """Lord of `house` within `orb` of the named fixed star (zodiacal
    longitude). Default orb 2° per Lilly's standard star-orb. Looks up
    the star in `chrt.fixstars.data`; if the star isn't loaded in
    `options.fixstars`, returns False silently.
    """
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    target = str(star).strip().lower()
    try:
        for entry in chrt.fixstars.data:
            name = str(entry[0]).strip().lower()
            if name == target:
                slon = float(entry[2])
                return _ang_diff(plon, slon) <= float(orb)
    except Exception:
        return False
    return False


def _almuten_of_topic_pid(chrt, topic):
    """SE planet id of the Almuten of the named topic. Reads
    `chrt.almutens.topicals.maxscore[i]` after locating `topic` in
    `chrt.almutens.topicals.names`. Returns None when topical-almuten
    table isn't configured (`options.topicals` defaults to None — must
    be enabled via the chart UI's Topicals dialog), the topic isn't in
    the loaded set, or there's a tie at max.
    """
    try:
        topicals = chrt.almutens.topicals
    except Exception:
        return None
    if topicals is None:
        return None
    target = str(topic).strip().lower()
    try:
        for i, n in enumerate(topicals.names):
            if str(n).strip().lower() == target:
                ms = topicals.maxscore[i]
                if ms[0] < 0 or ms[2]:
                    return None
                return int(ms[0])
    except Exception:
        return None
    return None


def almuten_of_topic_is(chrt, topic='marriage', body='venus', **_):
    """The Almuten of the named topic is the named body. Requires
    `options.topicals` configured; otherwise silently False.
    """
    target = _pid(body)
    am = _almuten_of_topic_pid(chrt, topic)
    return target is not None and am is not None and target == am


def almuten_of_topic_class(chrt, topic='marriage', class_='benefic', **_):
    """The Almuten of the named topic belongs to the given class. `class_`
    ∈ {'benefic','malefic'}. Requires `options.topicals` configured.
    """
    am = _almuten_of_topic_pid(chrt, topic)
    if am is None:
        return False
    if class_ == 'benefic':
        return am in (astrology.SE_VENUS, astrology.SE_JUPITER)
    if class_ == 'malefic':
        return am in (astrology.SE_MARS, astrology.SE_SATURN)
    return False


def lord_of_house_in_hayz(chrt, house=1, **_):
    """Lord of `house` is in its own Hayz (sect-aligned hemisphere AND
    sign gender)."""
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    sect = _planet_sect(chrt, pid)
    if sect is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    daytime = _is_chart_daytime(chrt)
    above = bool(getattr(p, 'abovehorizon', False))
    sign_idx = _sign(_lon(p))
    masculine = sign_idx in _MASCULINE_SIGNS
    if sect == 'diurnal':
        return daytime and above and masculine
    return (not daytime) and (not above) and (not masculine)


def body_besieged(chrt, body='moon', orb=8.0, **_):
    """Body is between Mars and Saturn in zodiacal order, with both
    malefics within `orb` of conjunction-distance to it.

    Lilly CA I Ch.XV: a besieged planet is severely afflicted — hemmed
    in by the two infortunes, its significations are degraded. (The
    beneficent variant — between Venus and Jupiter — is "beleaguered"
    and would be a separate predicate.)
    """
    pid = _pid(body)
    if pid in (None, astrology.SE_MARS, astrology.SE_SATURN):
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    mars = _planet(chrt, astrology.SE_MARS)
    sat = _planet(chrt, astrology.SE_SATURN)
    if mars is None or sat is None:
        return False
    mlon = _lon(mars); slon = _lon(sat)
    if _ang_diff(plon, mlon) > orb or _ang_diff(plon, slon) > orb:
        return False
    def _signed(a, b):
        d = (a - b) % 360.0
        return d if d <= 180.0 else d - 360.0
    sm = _signed(mlon, plon)
    ss = _signed(slon, plon)
    return (sm > 0 > ss) or (sm < 0 < ss)


def moon_frustration_in_chart(chrt, aspects=(0, 60, 90, 120, 180), orb=8.0, **_):
    """The Moon is currently applying to a slower body, but that body
    perfects a closer aspect with a third first — the Moon's testimony
    is frustrated. Scans Moon vs each of the six other classical bodies."""
    for sname in _CLASSICAL_PLANETS:
        if sname == 'moon':
            continue
        if frustration(chrt, faster='moon', slower=sname, aspects=aspects, orb=orb):
            return True
    return False


def moon_prohibition_in_chart(chrt, aspects=(0, 60, 90, 120, 180), orb=8.0, **_):
    """The Moon is applying to some body, but a third planet interposes."""
    for sname in _CLASSICAL_PLANETS:
        if sname == 'moon':
            continue
        if prohibition(chrt, faster='moon', slower=sname, aspects=aspects, orb=orb):
            return True
    return False


def moon_refranation_in_chart(chrt, aspects=(0, 60, 90, 120, 180), orb=8.0, **_):
    """The Moon is applying to some body, but one of the pair is currently
    retrograde — application unprofitable."""
    for sname in _CLASSICAL_PLANETS:
        if sname == 'moon':
            continue
        if refranation(chrt, faster='moon', slower=sname, aspects=aspects, orb=orb):
            return True
    return False


def _faster_than_both(chrt, translator_pid, pid_a, pid_b):
    """The translator must be faster than both significators it carries light between."""
    t = _planet(chrt, translator_pid)
    a = _planet(chrt, pid_a); b = _planet(chrt, pid_b)
    if t is None or a is None or b is None:
        return False
    st = abs(_speed(t))
    return st > abs(_speed(a)) and st > abs(_speed(b))


def translation_of_light(chrt, context=None,
                          from_house=None, to_house=None,
                          orb=6.0, aspects=(0, 60, 90, 120, 180), **_):
    """Third planet separates from one significator and applies to the other.

    Horary perfection path #2. Falls back to `context["querent_house"]`
    and `context["quesited_house"]` when `from_house` / `to_house` are
    None, so the predicate can be used either with fixed houses or in a
    context-driven rule. Any faster classical planet (Moon + Mercury +
    Venus + Mars + Jupiter + Saturn + Sun, minus the two significators)
    is a candidate translator; the first that separates from one and
    applies to the other wins.
    """
    fh = from_house if from_house is not None else (context or {}).get('querent_house')
    th = to_house if to_house is not None else (context or {}).get('quesited_house')
    if fh is None or th is None:
        return False
    lord_a = _lord_of_house(chrt, fh)
    lord_b = _lord_of_house(chrt, th)
    if lord_a is None or lord_b is None or lord_a == lord_b:
        return False
    aspect_list = tuple(aspects)
    for trans_name in _CLASSICAL_PLANETS:
        trans_pid = _pid(trans_name)
        if trans_pid in (lord_a, lord_b):
            continue
        if not _faster_than_both(chrt, trans_pid, lord_a, lord_b):
            continue
        # T separates from A and applies to B, OR the reverse.
        sep_a = any(_aspect_direction(chrt, trans_pid, lord_a, ang, orb) == 'separating'
                    for ang in aspect_list)
        app_b = any(_aspect_direction(chrt, trans_pid, lord_b, ang, orb) == 'applying'
                    for ang in aspect_list)
        if sep_a and app_b:
            return True
        sep_b = any(_aspect_direction(chrt, trans_pid, lord_b, ang, orb) == 'separating'
                    for ang in aspect_list)
        app_a = any(_aspect_direction(chrt, trans_pid, lord_a, ang, orb) == 'applying'
                    for ang in aspect_list)
        if sep_b and app_a:
            return True
    return False


def collection_of_light(chrt, context=None, houses=None,
                         orb=6.0, aspects=(0, 60, 90, 120, 180), **_):
    """A slower heavy planet receives both significators' application.

    Horary perfection path #3. Defaults to the querent / quesited lords;
    pass an explicit `houses=[a, b]` to override. Any classical planet
    slower than both significators and aspected by both is a valid
    collector.
    """
    if houses:
        house_list = list(houses)
    else:
        ctx = context or {}
        house_list = [ctx.get('querent_house'), ctx.get('quesited_house')]
    if len(house_list) < 2 or None in house_list[:2]:
        return False
    lord_a = _lord_of_house(chrt, house_list[0])
    lord_b = _lord_of_house(chrt, house_list[1])
    if lord_a is None or lord_b is None or lord_a == lord_b:
        return False
    aspect_list = tuple(aspects)
    a_pl = _planet(chrt, lord_a); b_pl = _planet(chrt, lord_b)
    if a_pl is None or b_pl is None:
        return False
    sa = abs(_speed(a_pl)); sb = abs(_speed(b_pl))
    for col_name in _CLASSICAL_PLANETS:
        col_pid = _pid(col_name)
        if col_pid in (lord_a, lord_b):
            continue
        col = _planet(chrt, col_pid)
        if col is None:
            continue
        sc = abs(_speed(col))
        if sc >= sa or sc >= sb:
            continue  # collector must be slower than both significators
        app_a = any(_aspect_direction(chrt, lord_a, col_pid, ang, orb) == 'applying'
                    for ang in aspect_list)
        app_b = any(_aspect_direction(chrt, lord_b, col_pid, ang, orb) == 'applying'
                    for ang in aspect_list)
        if app_a and app_b:
            return True
    return False


# ─────────────────────────────────────────────────────────────
# Priority 4 — tenancy, sign-of-lord, dignity-of-planet, point-aspect
# ─────────────────────────────────────────────────────────────

def malefic_in_house(chrt, house=None, include_south_node=True, **_):
    """True when Mars, Saturn, or (optionally) the South Node tenants `house`.

    Tests physical tenancy (via `_house_of(lon)`), not conjunction to the
    cusp. Distinct from `malefic_on_point(point, orb)` which only checks
    cusp-conjunction.
    """
    if house is None:
        return False
    target = int(house)
    for mid in (astrology.SE_MARS, astrology.SE_SATURN):
        p = _planet(chrt, mid)
        if p is None:
            continue
        h = _house_of(chrt, _lon(p))
        if h == target:
            return True
    if include_south_node:
        node = _planet(chrt, astrology.SE_TRUE_NODE) or _planet(chrt, astrology.SE_MEAN_NODE)
        if node is not None:
            nlon = _lon(node)
            if nlon is not None:
                south = (nlon + 180.0) % 360.0
                h = _house_of(chrt, south)
                if h == target:
                    return True
    return False


def benefic_in_house(chrt, house=None, include_north_node=True, **_):
    """True when Jupiter, Venus, or (optionally) the North Node tenants `house`.

    Tests physical tenancy (via `_house_of(lon)`), not conjunction to the
    cusp. Mirror of `malefic_in_house`.
    """
    if house is None:
        return False
    target = int(house)
    for bid in (astrology.SE_JUPITER, astrology.SE_VENUS):
        p = _planet(chrt, bid)
        if p is None:
            continue
        h = _house_of(chrt, _lon(p))
        if h == target:
            return True
    if include_north_node:
        node = _planet(chrt, astrology.SE_TRUE_NODE) or _planet(chrt, astrology.SE_MEAN_NODE)
        if node is not None:
            nlon = _lon(node)
            if nlon is not None:
                h = _house_of(chrt, nlon)
                if h == target:
                    return True
    return False


def lord_of_house_in_signs(chrt, house=None, signs=(), **_):
    """True when the lord of `house` is in one of the named signs."""
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if pid is None:
        return False
    p = _planet(chrt, pid)
    if p is None:
        return False
    return _sign(_lon(p)) in set(int(s) for s in tuple(signs))


def lord_in_dignity_of_planet(chrt, context=None, lord_of='quesited_house',
                                reference_planet='venus',
                                reference_lord_of=None,
                                levels=('domicile', 'exaltation', 'triplicity'),
                                **_):
    """Lord of a context house is in a dignity of a reference planet.

    The reference is either a named planet (`reference_planet='venus'`)
    or — when `reference_lord_of` names a context key — the LORD of that
    context house (Lilly's "Lord of the Ascendant in any of the Dignities
    of the Lord of the 3rd"). `reference_lord_of` wins when both given.

    Example Lilly usage: *"If the Significators be in … Dignities of
    Venus, the party enquiring doth marry."* →
    ``lord_in_dignity_of_planet(lord_of='quesited_house',
    reference_planet='venus', levels=['domicile','exaltation'])``.
    """
    if not context:
        return False
    house = context.get(lord_of)
    if house is None:
        return False
    pid = _lord_of_house(chrt, house)
    if reference_lord_of is not None:
        ref_house = context.get(reference_lord_of)
        if ref_house is None:
            return False
        ref_pid = _lord_of_house(chrt, ref_house)
    else:
        ref_pid = _pid(reference_planet)
    if pid is None or ref_pid is None or pid == ref_pid:
        return False
    found = _reception_levels_of(chrt, pid, ref_pid)
    target = set(str(x).lower() for x in tuple(levels))
    return any(lvl in target for lvl in found)


def body_aspects_point(chrt, body='mars', point='ASC',
                        aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """True when the named body aspects the named point via any named aspect.

    Generalised `body_on_point` — supports all aspect angles, not just
    conjunction. Use `body_on_point(body, point, orb)` when you only want
    conjunction (tighter default, clearer intent).
    """
    pid = _pid(body)
    p_lon = _point_lon(chrt, point)
    if pid is None or p_lon is None:
        return False
    pl = _planet(chrt, pid)
    if pl is None:
        return False
    d = _ang_diff(_lon(pl), p_lon)
    return any(abs(d - ang) <= orb for ang in tuple(aspects))


def moon_aspects_point(chrt, point='ASC',
                        aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """Moon aspects a named point (ASC / MC / DSC / IC) by any named aspect."""
    return body_aspects_point(chrt, body='moon', point=point,
                               aspects=aspects, orb=orb)


# ─────────────────────────────────────────────────────────────
# Comparative planet strength (Almuten scoring engine)
# ─────────────────────────────────────────────────────────────
#
# Morinus ships a full Almuten scoring engine in `almutens.py`:
# `chrt.almutens.essentials.getData(pid, lon, daytime)` returns the
# essential-dignity score of planet `pid` at longitude `lon` (using the
# 5 configurable weights in `options.dignityscores`), and
# `chrt.almutens.accidentals.scores[pid]` is the pre-computed
# accidental-dignity sum (house, day/hour ruler, solar-phase).
#
# The predicates below compose these to answer Lilly's "which is the
# strongest in the Figure?" — the classical comparative-significator
# question used for battle, lawsuit, illness, and other yes/no themes
# where the outcome turns on relative potency.


def _essential_score_at_own_position(chrt, pid):
    """Essential-dignity score of `pid` at its own current longitude."""
    try:
        almutens = getattr(chrt, 'almutens', None)
        if almutens is None or almutens.essentials is None:
            return 0
        p = _planet(chrt, pid)
        if p is None:
            return 0
        lon = _lon(p)
        if lon is None:
            return 0
        daytime = bool(chrt.planets.planets[astrology.SE_SUN].abovehorizon)
        if getattr(chrt.options, 'usedaynightorb', False):
            try:
                daytime = bool(chrt.fortune.abovehorizon)
            except Exception:
                pass
        score, _, _ = almutens.essentials.getData(pid, lon, daytime)
        return int(score)
    except Exception:
        return 0


def _accidental_score(chrt, pid):
    """Accidental-dignity score of `pid` (pre-computed per-chart)."""
    try:
        almutens = getattr(chrt, 'almutens', None)
        if almutens is None or almutens.accidentals is None:
            return 0
        return int(almutens.accidentals.scores[pid])
    except Exception:
        return 0


def _planet_strength_score(chrt, pid, essential=True, accidental=True):
    total = 0
    if essential:
        total += _essential_score_at_own_position(chrt, pid)
    if accidental:
        total += _accidental_score(chrt, pid)
    return total


def planet_strength_over(chrt, planet='mars', than='venus',
                          include_essential=True, include_accidental=True,
                          margin=0, **_):
    """True when `planet`'s total dignity score exceeds `than`'s by `margin`.

    Sums essential-dignity-at-own-position + accidental-dignity using
    Morinus's Almuten scoring. `margin` (default 0) lets the rule
    require a minimum gap — useful for "decisively stronger" tests.
    """
    pid_a = _pid(planet); pid_b = _pid(than)
    if pid_a is None or pid_b is None or pid_a == pid_b:
        return False
    sa = _planet_strength_score(chrt, pid_a, include_essential, include_accidental)
    sb = _planet_strength_score(chrt, pid_b, include_essential, include_accidental)
    return (sa - sb) > int(margin)


def lord_stronger_than_lord(chrt, context=None,
                              stronger_of='querent_house',
                              than='quesited_house',
                              include_essential=True,
                              include_accidental=True,
                              margin=0, **_):
    """Context-aware: lord of one house outscores the lord of another.

    `stronger_of` and `than` are keys looked up in `context` (typically
    `querent_house` / `quesited_house`). The lords of those houses are
    compared by combined essential + accidental dignity. `margin` is
    the minimum score differential required.

    Implements Lilly CA II's *"the strongest in the Scheame overcomes"*
    (battle, lawsuit) and *"When the Lord of the 6th is stronger than
    the Lord of the Ascendant, the Disease is like to encrease"*.
    """
    if not context:
        return False
    h_strong = context.get(stronger_of)
    h_weak = context.get(than)
    if h_strong is None or h_weak is None:
        return False
    pid_s = _lord_of_house(chrt, h_strong)
    pid_w = _lord_of_house(chrt, h_weak)
    if pid_s is None or pid_w is None or pid_s == pid_w:
        return False
    ss = _planet_strength_score(chrt, pid_s, include_essential, include_accidental)
    sw = _planet_strength_score(chrt, pid_w, include_essential, include_accidental)
    return (ss - sw) > int(margin)


# ─────────────────────────────────────────────────────────────
# Compound logical predicates (AND / OR / NOT)
# ─────────────────────────────────────────────────────────────
#
# Lilly's horary chapters (esp. CA II Ch.L "A signe of recovery") chain
# multiple conditions in a single aphorism: *"The Moon in the 7th
# Aspecting the Lord of the Ascendant with a Trine"* — Moon-in-7th AND
# Moon-trines-L1 must hold simultaneously. Earlier passes had to defer
# these because the engine only ran one predicate per rule.
#
# These three combinators let any rule express AND / OR / NOT over an
# arbitrary set of nested {predicate, args} specs without growing the
# predicate library bespoke per-pattern. Recursion is bounded at
# `_COMPOUND_MAX_DEPTH = 8` levels — generous for any real aphorism but
# fail-closed against pack bugs (e.g. a rule that names itself).
#
# Pack TOML shape:
#
#     predicate = "all_of"
#     args = { conditions = [
#       { predicate = "moon_in_houses", args = { houses = [7] } },
#       { predicate = "moon_applies_to_lord_of_house",
#         args = { house = 1, aspects = [120], orb = 6.0 } },
#     ] }
#
# `context` (e.g. quesited_house) propagates to every nested predicate
# automatically — pack authors never re-thread it manually.

_COMPOUND_MAX_DEPTH = 8


def _eval_subpredicate(spec, chrt, context, depth):
    """Evaluate one nested {predicate, args} dict under depth control.

    Fail-closed on every error path: malformed spec, unknown predicate
    name, depth-cap breach, or any exception inside the nested
    predicate. A buggy pack must not poison the verdict, only suppress
    the rule.
    """
    if depth > _COMPOUND_MAX_DEPTH or not isinstance(spec, dict):
        return False
    name = spec.get('predicate')
    fn = PREDICATES.get(name) if name else None
    if fn is None:
        return False
    sub_args = dict(spec.get('args') or {})
    if context is not None:
        sub_args['context'] = context
    sub_args['_depth'] = depth
    try:
        return bool(fn(chrt, **sub_args))
    except Exception:
        return False


def all_of(chrt, conditions=(), context=None, _depth=0, **_):
    """True iff every condition fires. Empty list → False (fail-closed)."""
    conditions = tuple(conditions)
    if not conditions:
        return False
    for spec in conditions:
        if not _eval_subpredicate(spec, chrt, context, _depth + 1):
            return False
    return True


def any_of(chrt, conditions=(), context=None, _depth=0, **_):
    """True iff at least one condition fires. Empty list → False."""
    for spec in tuple(conditions):
        if _eval_subpredicate(spec, chrt, context, _depth + 1):
            return True
    return False


def none_of(chrt, conditions=(), context=None, _depth=0, **_):
    """True iff every condition is false. Empty list → True (vacuously)."""
    for spec in tuple(conditions):
        if _eval_subpredicate(spec, chrt, context, _depth + 1):
            return False
    return True


# ─────────────────────────────────────────────────────────────
# Synastry — TWO-chart predicates
# ─────────────────────────────────────────────────────────────
# These are the only predicates that read a SECOND chart. The synastry
# discipline shim threads chart B through ``context['partner_chart']``;
# `chrt` is chart A. Every other predicate is single-chart and ignores it.
# Convention: "a_" prefix = the primary native's body, "b_" = the partner's.

def _partner_chart(context):
    if not context:
        return None
    return context.get('partner_chart')


def synastry_aspect(chrt, context=None, a_planet='sun', b_planet='moon',
                    aspects=(0, 60, 90, 120, 180), orb=6.0, **_):
    """A's `a_planet` aspects B's `b_planet` within orb (cross-aspect).

    The classic synastry contact: e.g. A's Venus trine B's Mars. Reads
    A's planet longitude from `chrt` and B's from the partner chart.
    """
    partner = _partner_chart(context)
    if partner is None:
        return False
    pa = _planet(chrt, _pid(a_planet))
    pb = _planet(partner, _pid(b_planet))
    if pa is None or pb is None:
        return False
    la, lb = _lon(pa), _lon(pb)
    if la is None or lb is None:
        return False
    d = _ang_diff(la, lb)
    return any(abs(d - ang) <= orb for ang in tuple(aspects))


def synastry_planet_in_partner_house(chrt, context=None, planet='sun',
                                     houses=(), whose='a_in_b', **_):
    """A's `planet` falls in one of B's `houses` (overlay).

    `whose='a_in_b'` (default): A's planet in B's house system — "where
    does the native land in the partner's life". `whose='b_in_a'` flips it:
    the partner's planet in the native's houses.
    """
    partner = _partner_chart(context)
    if partner is None:
        return False
    if whose == 'b_in_a':
        body_chart, house_chart = partner, chrt
    else:
        body_chart, house_chart = chrt, partner
    p = _planet(body_chart, _pid(planet))
    if p is None:
        return False
    plon = _lon(p)
    if plon is None:
        return False
    h = _house_of(house_chart, plon)
    return h is not None and h in tuple(houses)


def synastry_mutual_reception(chrt, context=None, a_planet='venus',
                              b_planet='mars', level='domicile', **_):
    """A's `a_planet` sits in the sign B's `b_planet` rules, AND B's
    `b_planet` sits in the sign A's `a_planet` rules — cross-chart mutual
    reception. A strong bonding testimony in relationship work.

    `level` is accepted for symmetry with single-chart reception but only
    'domicile' is implemented here (the standard synastry reception).
    """
    partner = _partner_chart(context)
    if partner is None:
        return False
    pa = _planet(chrt, _pid(a_planet))
    pb = _planet(partner, _pid(b_planet))
    if pa is None or pb is None:
        return False
    la, lb = _lon(pa), _lon(pb)
    if la is None or lb is None:
        return False
    sign_a = _sign(la)   # sign A's a_planet occupies
    sign_b = _sign(lb)   # sign B's b_planet occupies
    # Reception: a_planet must be in b_planet's domicile sign, and
    # b_planet in a_planet's domicile sign.
    return (_rules_sign(_pid(b_planet), sign_a) and
            _rules_sign(_pid(a_planet), sign_b))


# Domicile rulership table (traditional, planet → signs it rules).
_DOMICILE = {
    astrology.SE_SUN:     (4,),            # Leo
    astrology.SE_MOON:    (3,),            # Cancer
    astrology.SE_MERCURY: (2, 5),          # Gemini, Virgo
    astrology.SE_VENUS:   (1, 6),          # Taurus, Libra
    astrology.SE_MARS:    (0, 7),          # Aries, Scorpio
    astrology.SE_JUPITER: (8, 11),         # Sagittarius, Pisces
    astrology.SE_SATURN:  (9, 10),         # Capricorn, Aquarius
}


def _rules_sign(pid, sign_idx):
    return sign_idx in _DOMICILE.get(pid, ())


PREDICATES = {
    'moon_is_waxing': moon_is_waxing,
    'moon_is_waning': moon_is_waning,
    'moon_lat_north': moon_lat_north,
    'moon_lat_south': moon_lat_south,
    'moon_swift': moon_swift,
    'moon_slow': moon_slow,
    'moon_on_nodes': moon_on_nodes,
    'moon_in_houses': moon_in_houses,
    'moon_in_signs': moon_in_signs,
    'moon_conj_sun': moon_conj_sun,
    'moon_opp_sun': moon_opp_sun,
    'moon_aspects_body': moon_aspects_body,
    'moon_void_of_course': moon_void_of_course,
    'planet_retrograde': planet_retrograde,
    'planet_stationary': planet_stationary,
    'planet_combust': planet_combust,
    'planet_aspects_body': planet_aspects_body,
    'any_stationary': any_stationary,
    'benefic_on_point': benefic_on_point,
    'malefic_on_point': malefic_on_point,
    'body_on_point': body_on_point,
    'asc_straight_rising': asc_straight_rising,
    'asc_oblique_rising': asc_oblique_rising,
    'planet_direct_and_free': planet_direct_and_free,
    'lord_asc_in_houses': lord_asc_in_houses,
    'lords_asc_moon_aversion': lords_asc_moon_aversion,
    'lord_asc_combust': lord_asc_combust,
    'lord_asc_stationary': lord_asc_stationary,
    'venus_moon_in_tropical': venus_moon_in_tropical,
    'venus_in_tropical': venus_in_tropical,
    'moon_in_tropical': moon_in_tropical,
    'moon_in_scorpio_with_mars': moon_in_scorpio_with_mars,
    'mars_saturn_aspecting_venus': mars_saturn_aspecting_venus,
    'pivot_malefic_retrograde': pivot_malefic_retrograde,
    'moon_in_signs_with_benefic_aspect': moon_in_signs_with_benefic_aspect,
    'moon_in_signs_without_benefic_aspect': moon_in_signs_without_benefic_aspect,
    'benefic_witnessing_luminaries': benefic_witnessing_luminaries,
    'moon_opposite_sun': moon_opposite_sun,
    'benefic_on_asc_no_malefic_on_mc': benefic_on_asc_no_malefic_on_mc,
    # Horary (context-aware)
    'lord_of_house_retrograde': lord_of_house_retrograde,
    'lord_of_house_combust': lord_of_house_combust,
    'lord_of_house_in_houses': lord_of_house_in_houses,
    'quesited_lord_retrograde': quesited_lord_retrograde,
    'quesited_lord_combust': quesited_lord_combust,
    'quesited_lord_in_houses': quesited_lord_in_houses,
    'querent_lord_in_houses': querent_lord_in_houses,
    'moon_applying_to_quesited': moon_applying_to_quesited,
    'moon_applying_to_querent': moon_applying_to_querent,
    'moon_applies_to_lord_of_house': moon_applies_to_lord_of_house,
    'moon_applies_to_dispositor': moon_applies_to_dispositor,
    'moon_applies_to_lord_of_house_from_moon': moon_applies_to_lord_of_house_from_moon,
    'querent_lord_separated_or_disposed': querent_lord_separated_or_disposed,
    'body_in_houses': body_in_houses,
    'body_in_signs': body_in_signs,
    'moon_dispositor_in_signs': moon_dispositor_in_signs,
    'moon_dispositor_in_houses': moon_dispositor_in_houses,
    'moon_dispositor_aspects_point': moon_dispositor_aspects_point,
    'moon_dispositor_aspects_moon': moon_dispositor_aspects_moon,
    'moon_dispositor_separates_then_applies': moon_dispositor_separates_then_applies,
    'benefic_aspects_point': benefic_aspects_point,
    'both_luminaries_aspect_each_other_in_angles':
        both_luminaries_aspect_each_other_in_angles,
    'moon_l1_distance': moon_l1_distance,
    'both_luminaries_below_horizon': both_luminaries_below_horizon,
    'both_luminaries_in_houses': both_luminaries_in_houses,
    'lord_of_house_in_own_dignity': lord_of_house_in_own_dignity,
    'south_node_in_houses': south_node_in_houses,
    'part_of_fortune_in_houses': part_of_fortune_in_houses,
    'part_of_fortune_lord_aspects_lord_of_house': part_of_fortune_lord_aspects_lord_of_house,
    'part_of_fortune_lord_aspects_body': part_of_fortune_lord_aspects_body,
    'term_lord_of_moon_in_houses': term_lord_of_moon_in_houses,
    'asc_in_signs': asc_in_signs,
    'moon_day': moon_day,
    'lot_of_fortune_in_signs': lot_of_fortune_in_signs,
    'lot_of_fortune_in_houses': lot_of_fortune_in_houses,
    'dsc_in_signs': dsc_in_signs,
    'asc_in_early_degrees': asc_in_early_degrees,
    'asc_in_late_degrees': asc_in_late_degrees,
    'moon_via_combusta': moon_via_combusta,
    'body_in_own_dignity': body_in_own_dignity,
    'body_in_detriment': body_in_detriment,
    'body_in_fall': body_in_fall,
    'body_peregrine': body_peregrine,
    'lord_of_house_in_detriment': lord_of_house_in_detriment,
    'lord_of_house_in_fall': lord_of_house_in_fall,
    'lord_of_house_peregrine': lord_of_house_peregrine,
    'chart_radical': chart_radical,
    'chart_not_radical': chart_not_radical,
    'moon_in_late_degrees_of_signs': moon_in_late_degrees_of_signs,
    'chart_testimonies_balanced': chart_testimonies_balanced,
    'almuten_of_figure_is': almuten_of_figure_is,
    'almuten_of_figure_class': almuten_of_figure_class,
    'south_node_aspects_body': south_node_aspects_body,
    'lords_in_mutual_reception_houses': lords_in_mutual_reception_houses,
    'body_cazimi': body_cazimi,
    'body_combust': body_combust,
    'body_under_beams': body_under_beams,
    'body_in_joy': body_in_joy,
    'frustration': frustration,
    'prohibition': prohibition,
    'refranation': refranation,
    'body_besieged': body_besieged,
    'moon_frustration_in_chart': moon_frustration_in_chart,
    'moon_prohibition_in_chart': moon_prohibition_in_chart,
    'moon_refranation_in_chart': moon_refranation_in_chart,
    'body_in_hayz': body_in_hayz,
    'body_near_fixed_star': body_near_fixed_star,
    'body_beleaguered': body_beleaguered,
    'lord_of_house_cazimi': lord_of_house_cazimi,
    'lord_of_house_under_beams': lord_of_house_under_beams,
    'lord_of_house_besieged': lord_of_house_besieged,
    'lord_of_house_beleaguered': lord_of_house_beleaguered,
    'lord_of_house_in_hayz': lord_of_house_in_hayz,
    'lord_of_house_near_fixed_star': lord_of_house_near_fixed_star,
    'almuten_of_topic_is': almuten_of_topic_is,
    'almuten_of_topic_class': almuten_of_topic_class,
    'l1_received_by_any_lord': l1_received_by_any_lord,
    'dispositor_chain_terminus_is': dispositor_chain_terminus_is,
    'dispositor_chain_terminus_class': dispositor_chain_terminus_class,
    'lords_perfect_with_reception': lords_perfect_with_reception,
    'both_luminaries_aspect_house': both_luminaries_aspect_house,
    'recovery_significators_in_modality': recovery_significators_in_modality,
    'recovery_application_motion': recovery_application_motion,
    'lord_of_house_swift': lord_of_house_swift,
    'lord_of_house_in_signs': lord_of_house_in_signs,
    'lord_of_house_aspects_body': lord_of_house_aspects_body,
    'querent_lord_separating_from_lord_of_house':
        querent_lord_separating_from_lord_of_house,
    'querent_quesited_aspect': querent_quesited_aspect,
    'lords_perfect': lords_perfect,
    # Priority 3 — direction, reception, perfection paths
    'is_applying_between': is_applying_between,
    'is_separating_between': is_separating_between,
    'reception_between': reception_between,
    'lord_receives_lord': lord_receives_lord,
    'lord_of_house_received_by_any': lord_of_house_received_by_any,
    'lords_in_mutual_reception': lords_in_mutual_reception,
    'translation_of_light': translation_of_light,
    'collection_of_light': collection_of_light,
    # Priority 4 — tenancy, sign-of-lord, dignity-of-planet, point-aspect
    'malefic_in_house': malefic_in_house,
    'benefic_in_house': benefic_in_house,
    'lord_of_house_in_signs': lord_of_house_in_signs,
    'lord_in_dignity_of_planet': lord_in_dignity_of_planet,
    'body_aspects_point': body_aspects_point,
    'moon_aspects_point': moon_aspects_point,
    # Comparative strength — uses chrt.almutens essential + accidental scoring
    'planet_strength_over': planet_strength_over,
    'lord_stronger_than_lord': lord_stronger_than_lord,
    # Identity / membership (lord-of-house, sign-of-cusp, hour-lord)
    'body_is_lord_of_house': body_is_lord_of_house,
    'body_in_sign_of_house_cusp': body_in_sign_of_house_cusp,
    'body_is_planetary_hour_lord': body_is_planetary_hour_lord,
    'hour_lord_is_lord_of_house': hour_lord_is_lord_of_house,
    # Increasing-in-motion / free-from-infortunes (Lilly recovery doctrine)
    'body_speed_increasing': body_speed_increasing,
    'body_free_from_infortunes': body_free_from_infortunes,
    'lords_of_moon_increasing_and_free': lords_of_moon_increasing_and_free,
    'both_luminaries_closer_to_angle': both_luminaries_closer_to_angle,
    # Compound logical predicates (AND / OR / NOT over nested specs)
    'all_of': all_of,
    'any_of': any_of,
    'none_of': none_of,
    # Synastry two-chart predicates (read context['partner_chart']).
    'synastry_aspect': synastry_aspect,
    'synastry_planet_in_partner_house': synastry_planet_in_partner_house,
    'synastry_mutual_reception': synastry_mutual_reception,
}


def evaluate_predicate(name, chrt, args=None, context=None):
    """Dispatch a named predicate against a chart.

    `args` is the rule block's declared kwargs (TOML inline table).
    `context` is reserved for discipline-specific state (e.g. horary
    significator houses). When non-None it is forwarded as a `context`
    kwarg; predicates that don't declare it absorb it via **kwargs.
    """
    fn = PREDICATES.get(name)
    if fn is None:
        return False
    call_args = dict(args or {})
    if context is not None:
        call_args['context'] = context
    try:
        return bool(fn(chrt, **call_args))
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────
# Rule timing — signed-arc + Lilly sign-class unit
# ─────────────────────────────────────────────────────────────

_SIGN_SHORT = ('Ari', 'Tau', 'Gem', 'Can', 'Leo', 'Vir',
               'Lib', 'Sco', 'Sag', 'Cap', 'Aqu', 'Pis')
# Sign quality → Lilly's sign-class timing unit (CA II, "When the thief
# shall be known", "Time when he will returne", etc.):
#   moveable signs  (Ari/Can/Lib/Cap) → days
#   common signs    (Gem/Vir/Sag/Pis) → weeks
#   fixed signs     (Tau/Leo/Sco/Aqu) → months
_MOVEABLE = {0, 3, 6, 9}
_COMMON   = {2, 5, 8, 11}
_FIXED    = {1, 4, 7, 10}

def _sign_class_unit(sign_idx):
    if sign_idx in _MOVEABLE: return 'days'
    if sign_idx in _COMMON:   return 'weeks'
    if sign_idx in _FIXED:    return 'months'
    return 'days'


def _signed_min_arc(src_lon, target_lon):
    """Shortest signed angular distance src→target in (-180, +180].

    Positive = target ahead of src (src must move forward to reach it).
    Negative = target behind src (src has already passed it).
    """
    d = (target_lon - src_lon) % 360.0
    if d > 180.0:
        d -= 360.0
    return d


def compute_timing_addendum(spec, chrt, context=None):
    """Build a one-line timing addendum for a rule body.

    Spec shape (all optional fields have sensible defaults):

        [rule.timing]
        from = "sun"                # body whose motion drives the timing
        to = "lord_of_house"        # 'body' or 'lord_of_house'
        to_body = "saturn"          # used when to == 'body'
        house_key = "quesited_house"# used when to == 'lord_of_house';
                                    # context key; if absent, 'house' field
        house = 7                   # static house if no context key
        aspects = [0, 60, 90, 120, 180]
        unit = "sign"               # 'sign' (Lilly) or 'days' (fixed unit)

    Returns the addendum string, or '' if it can't be computed.
    """
    if not spec:
        return ''
    aspects   = tuple(spec.get('aspects', (0, 60, 90, 120, 180)))
    unit_mode = spec.get('unit', 'sign')
    from_kind = spec.get('from_kind', 'body')
    to_kind   = spec.get('to', 'body')

    # Resolve `from` body (driving body whose motion we time).
    if from_kind == 'lord_of_house':
        house = spec.get('from_house')
        key = spec.get('from_house_key')
        if context and key and key in context:
            house = context[key]
        if house is None:
            return ''
        pid_from = _lord_of_house(chrt, int(house))
        from_label = f"Lord of {int(house)}"
        if pid_from is not None:
            from_label += f" ({planet_name_from_id(pid_from).capitalize()})"
    else:
        from_body = spec.get('from', 'sun')
        pid_from = _pid(from_body)
        from_label = from_body.capitalize()
    p_from = _planet(chrt, pid_from) if pid_from is not None else None
    if p_from is None:
        return ''
    lon_from = _lon(p_from)
    if lon_from is None:
        return ''

    # Resolve `to` target.
    if to_kind == 'lord_of_house':
        house = spec.get('house')
        key = spec.get('house_key')
        if context and key and key in context:
            house = context[key]
        if house is None:
            return ''
        pid_to = _lord_of_house(chrt, int(house))
        to_label = f"Lord of {int(house)}"
        if pid_to is not None:
            to_label += f" ({planet_name_from_id(pid_to).capitalize()})"
    else:
        to_body = spec.get('to_body', 'sun')
        pid_to = _pid(to_body)
        to_label = to_body.capitalize()
    if pid_to is None or pid_to == pid_from:
        return ''
    p_to = _planet(chrt, pid_to)
    if p_to is None:
        return ''
    lon_to = _lon(p_to)
    if lon_to is None:
        return ''

    # Find the aspect target with the smallest |signed arc|.
    nearest = None  # (abs_arc, signed_arc, aspect_angle, target_lon)
    for a in aspects:
        for tgt in {(lon_to + a) % 360.0, (lon_to - a) % 360.0}:
            arc = _signed_min_arc(lon_from, tgt)
            key = abs(arc)
            if nearest is None or key < nearest[0]:
                nearest = (key, arc, a, tgt)
    if nearest is None:
        return ''
    _abs, signed, a_angle, tgt_lon = nearest

    sign_idx = _sign(lon_from)
    if unit_mode == 'days':
        unit = 'days'
    else:
        unit = _sign_class_unit(sign_idx)

    arc_str = f"{abs(signed):.1f}°"
    aspect_word = {0: 'conjunction', 60: 'sextile', 90: 'square',
                   120: 'trine', 180: 'opposition'}.get(a_angle,
                                                        f"{a_angle}°")
    sign_name = _SIGN_SHORT[sign_idx]
    n = abs(signed)
    # Time-to-perfection via real per-planet motion — no ephemeris search
    # needed because both speeds are already on the chart. From the
    # kinematic identity D(t) = lon_from(t) - lon_to(t), dD/dt = sp_from -
    # sp_to = rel, and we want D = ±a; so time = signed / rel.
    sp_from = _speed(p_from); sp_to = _speed(p_to)
    rel = sp_from - sp_to
    days_signed = None
    if abs(rel) > 1e-6:
        ds = signed / rel
        if abs(ds) < 3650:  # ignore millennia-out targets
            days_signed = ds
    # Temporal direction trumps spatial direction (handles retrograde-target
    # cases where Sun ahead of Jupiter is still a past conjunction because
    # Sun moves much faster than Jupiter).
    if days_signed is not None:
        applying = days_signed >= 0
    else:
        applying = signed >= 0
    days_str = ''
    if days_signed is not None:
        days_str = f"; mean motion ~{abs(days_signed):.1f} days"
    # Third tier — exact calendar date via the existing search backend.
    # No new ephemeris code; we just call searchbackend.search() the way the
    # CLI (`tools/aspect_search.py`) and the UI's transit search panel do.
    exact_str = _exact_aspect_date_via_search(
        chrt, from_body=spec.get('from', 'sun'),
        from_kind=spec.get('from_kind', 'body'),
        from_house=spec.get('from_house'),
        from_house_key=spec.get('from_house_key'),
        to_kind=spec.get('to', 'body'),
        to_body=spec.get('to_body', 'sun'),
        to_house=spec.get('house'),
        to_house_key=spec.get('house_key'),
        a_angle=a_angle, days_signed=days_signed, context=context,
    )
    if applying:
        return (f"Timing — {from_label} applies to the "
                f"{aspect_word} with {to_label}: arc {arc_str} ahead "
                f"({sign_name} = {unit} → ~{n:.0f} {unit}{days_str}{exact_str}).")
    else:
        ago = days_str.replace('days', 'days ago') if days_str else ''
        return (f"Timing — {from_label} has separated from the "
                f"{aspect_word} with {to_label}: arc {arc_str} past "
                f"({sign_name} = {unit} → ~{n:.0f} {unit} ago{ago}{exact_str}).")


# Aspect angle → SearchQuery aspect constant.
_ASPECT_ANGLE_TO_NAME = {
    0: 'conjunction', 60: 'sextile', 90: 'square',
    120: 'trine', 180: 'opposition',
}

# Resolve a planet pid to its searchcatalog object id (`planet:<name>`).
_PID_TO_PLANET_NAME = None  # lazy

def _planet_name_for_pid(pid):
    global _PID_TO_PLANET_NAME
    if _PID_TO_PLANET_NAME is None:
        try:
            import astrology
            _PID_TO_PLANET_NAME = {
                astrology.SE_SUN: 'sun', astrology.SE_MOON: 'moon',
                astrology.SE_MERCURY: 'mercury', astrology.SE_VENUS: 'venus',
                astrology.SE_MARS: 'mars', astrology.SE_JUPITER: 'jupiter',
                astrology.SE_SATURN: 'saturn', astrology.SE_URANUS: 'uranus',
                astrology.SE_NEPTUNE: 'neptune', astrology.SE_PLUTO: 'pluto',
            }
        except Exception:
            _PID_TO_PLANET_NAME = {}
    return _PID_TO_PLANET_NAME.get(pid)


def _exact_aspect_date_via_search(chrt, from_body, from_kind, from_house,
                                   from_house_key, to_kind, to_body,
                                   to_house, to_house_key,
                                   a_angle, days_signed, context):
    """Delegate to searchbackend.search for the exact calendar date of the
    nearest perfection. Returns "; exact YYYY-MM-DD HH:MM" or '' on failure.
    Lazy-imports so the timing helper has no hard search dependency.
    """
    if days_signed is None or abs(days_signed) > 3650:
        return ''
    aspect_name = _ASPECT_ANGLE_TO_NAME.get(a_angle)
    if aspect_name is None:
        return ''
    # Resolve from-body planet name
    if from_kind == 'lord_of_house':
        house = from_house
        if context and from_house_key and from_house_key in context:
            house = context[from_house_key]
        if house is None: return ''
        pid_from = _lord_of_house(chrt, int(house))
    else:
        pid_from = _pid(from_body)
    from_name = _planet_name_for_pid(pid_from)
    if from_name is None: return ''
    # Resolve to-body planet name
    if to_kind == 'lord_of_house':
        house = to_house
        if context and to_house_key and to_house_key in context:
            house = context[to_house_key]
        if house is None: return ''
        pid_to = _lord_of_house(chrt, int(house))
    else:
        pid_to = _pid(to_body)
    to_name = _planet_name_for_pid(pid_to)
    if to_name is None or pid_to == pid_from: return ''
    try:
        import datetime
        import searchquery, searchcatalog, searchbackend
        # Chart epoch as a date
        t = chrt.time
        chart_date = datetime.date(t.year, t.month, t.day)
        # Window: bracket the predicted perfection generously, +/-1 day plus
        # 100% of the closed-form days estimate.
        span = max(2.0, abs(days_signed) * 1.5 + 2.0)
        if days_signed >= 0:
            start = chart_date; end = chart_date + datetime.timedelta(days=int(span) + 1)
        else:
            start = chart_date - datetime.timedelta(days=int(span) + 1); end = chart_date
        catalog = searchcatalog.SearchCatalog(chrt)
        q = searchquery.SearchQuery()
        q.set_techniques([searchquery.SearchQuery.TECHNIQUE_TRANSITS])
        q.set_aspects([aspect_name])
        q.set_promittor_ids([f'planet:{from_name}'])
        q.set_significator_ids([f'planet:{to_name}'])
        rows, _trunc = searchbackend.search(catalog, chrt, q, start, end, 1)
        if not rows: return ''
        r = rows[0]
        if r.event_date:
            t_str = r.event_time[:5] if r.event_time else ''
            return f"; exact {r.event_date} {t_str}".rstrip()
    except Exception:
        return ''
    return ''


# ─────────────────────────────────────────────────────────────
# Glyph resolution
# ─────────────────────────────────────────────────────────────

_GLYPH_MAP = {
    'planet_sun': 'A', 'planet_moon': 'B', 'planet_mercury': 'C',
    'planet_venus': 'D', 'planet_mars': 'E', 'planet_jupiter': 'F',
    'planet_saturn': 'G',
    'sign_aries': 'a', 'sign_taurus': 'b', 'sign_gemini': 'c',
    'sign_cancer': 'd', 'sign_leo': 'e', 'sign_virgo': 'f',
    'sign_libra': 'g', 'sign_scorpio': 'h', 'sign_sagittarius': 'i',
    'sign_capricorn': 'j', 'sign_aquarius': 'k', 'sign_pisces': 'l',
}

def resolve_glyph(name_or_char):
    if not name_or_char:
        return ''
    return _GLYPH_MAP.get(name_or_char, name_or_char)


def resolve_dynamic_glyph(predicate, args, chrt, context=None):
    """Glyph char for the ACTUAL subject planet of a lord-of-house rule.

    Lord-of-house rules can't know their subject planet at authoring time
    (the lord depends on the chart), so pack files carry a placeholder
    glyph. This resolves the real lord at evaluation time so the alert
    card shows the correct planet — e.g. "Lord of ASC retrograde" with
    Aquarius rising shows Saturn, not the authored placeholder.

    Returns a Morinus glyph char, or None when the predicate's subject
    is not a single context-resolvable house lord (caller falls back to
    the static glyph).
    """
    house = None
    args = args or {}
    if predicate.startswith('lord_of_house_') or predicate == 'lord_of_house_received_by_any':
        house = args.get('house')
    elif predicate.startswith('lord_asc_'):
        house = 1
    elif predicate.startswith('querent_lord_'):
        house = (context or {}).get('querent_house')
    elif predicate.startswith('quesited_lord_'):
        house = (context or {}).get('quesited_house')
    elif predicate == 'lord_in_dignity_of_planet':
        house = (context or {}).get(args.get('lord_of', 'quesited_house'))
    if house is None:
        return None
    try:
        pid = _lord_of_house(chrt, int(house))
    except Exception:
        return None
    if pid is None:
        return None
    name = planet_name_from_id(pid)
    return _GLYPH_MAP.get(f'planet_{name}')
