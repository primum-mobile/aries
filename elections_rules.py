# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Elections discipline binding for the generic rule engine.

This module is a thin shim over `rule_engine.py`: it owns the elections-
specific theme-slug map and the legacy inline Python evaluators (kept as a
migration-era fallback for themes no pack has covered yet), but delegates
all pack discovery, alert flattening, and severity-sorting to the engine.

Public surface (unchanged for callers in morin/workspace_shell):

- `Alert` — re-export from `rule_engine`.
- `evaluate(theme, chrt)` — UI label in, sorted [Alert] out.
- `list_packs()` / `set_active_packs(ids)` — re-export from engine.

Each inline rule inspects a chart.Chart and returns 0 or 1 Alert. The
Traveling evaluator composes rules from Hephaistion III.30 (parallels
Dorotheus Carmen V.21); other themes compose theme-specific rules plus a
universal III.2 inception gate.
"""

import astrology
import planets
import rule_engine

# Re-export so existing callers stay pointed at this module.
Alert = rule_engine.Alert
list_packs = rule_engine.list_packs
set_active_packs = rule_engine.set_active_packs


SIGN_NAMES = ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
              'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces')

# Morinus font: Signs1 lowercase a..l, Planets uppercase A..L (Sun..Pluto).
SIGN_GLYPHS = ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l')
PLANET_GLYPHS = ('A', 'B', 'C', 'D', 'E', 'F', 'G')  # Sun..Saturn indices 0..6


_THEME_SLUGS = {
    'Traveling': 'traveling',
    'Meetings': 'meetings',
    'Marriage': 'marriage',
    'Medical Procedure': 'medical-procedure',
    'Starting a Business': 'business',
    'Signing Contracts': 'contracts',
    'Requesting a Favor': 'favors',
    'Lending Money': 'loans',
    'Taking on a Surety': 'sureties',
    'Hosting a Dinner': 'dinners',
    'New Implement': 'new-implement',
    'Foundation / Building': 'foundations',
    'Taking an Oath': 'oaths',
    'Making a Purchase': 'purchases',
    'Buying / Building a Ship': 'ship-building',
    'Farming / Planting': 'farming',
    'Buying Livestock': 'cattle',
    'Conception': 'conception',
    'Purgation / Cleanse': 'purgation',
    'Public Spectacle / Event': 'games',
    'Oracle / Prophetic Inquiry': 'oracle',
    'Effective / Ineffective Day': 'effective-days',
    'Digging a Well / Pond': 'wells',
    'Treating Disease': 'diseases',
    'Childbirth': 'childbirth',
    'Making a Will': 'wills',
    'Teaching an Art': 'teaching',
    'Removal of Fetus': 'fetus-removal',
    'Abortion (dangerous-degree test)': 'abortion',
    'Manumission / Release': 'manumission',
    'Befriending Someone': 'befriending',
    'Putting a Ship to Sea': 'sailing',
    'Entering a City': 'entering-city',
    'Effective Hour': 'effective-hour',
    'Selling Something': 'selling',
}


# Register this discipline with the engine so the inspector's Discipline
# dropdown knows about it without importing this module directly.
rule_engine.register_discipline('elections', 'Elections', _THEME_SLUGS)


def evaluate(theme, chrt, context=None):
    """UI-label entry point. Delegates to rule_engine.evaluate().

    The inline evaluator for the given theme is passed as the fallback
    so a theme that no pack has covered still produces alerts.
    """
    theme_slug = rule_engine.theme_slug_for('elections', theme)
    if theme_slug is None:
        return []
    inline_label = next(
        (label for label, slug in _THEME_SLUGS.items()
         if slug == theme_slug),
        None,
    )
    inline = _THEME_EVALUATORS.get(inline_label)
    return rule_engine.evaluate('elections', theme_slug, chrt,
                                inline_fallback=inline, context=context)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _planet(chrt, pid):
    try:
        return chrt.planets.planets[pid]
    except Exception:
        return None

def _lon(pl):
    try:
        return pl.data[planets.Planet.LONG]
    except Exception:
        return None

def _lat(pl):
    try:
        return pl.data[planets.Planet.LAT]
    except Exception:
        return None

def _speed(pl):
    try:
        return pl.data[planets.Planet.SPLON]
    except Exception:
        return 0.0

def _sign(lon):
    return int(lon // 30) % 12

def _deg_in_sign(lon):
    return lon - 30.0 * (int(lon // 30))

def _house_of(chrt, lon):
    try:
        return int(chrt.houses.getHousePos(lon, chrt.options, False)) + 1
    except Exception:
        return None

def _ang_diff(a, b):
    d = abs((a - b) % 360.0)
    if d > 180.0:
        d = 360.0 - d
    return d

def _is_stationary(pl):
    if pl is None:
        return False
    return abs(_speed(pl)) < 0.05  # °/day; Mercury station ~0.03, Mars ~0.04

def _is_retrograde(pl):
    return pl is not None and _speed(pl) < 0.0

def _under_rays(chrt, pid, orb=8.0):
    """Combust / under the beams: within ~8° of the Sun by longitude."""
    if pid == astrology.SE_SUN:
        return False
    sun = _planet(chrt, astrology.SE_SUN)
    p = _planet(chrt, pid)
    if sun is None or p is None:
        return False
    a = _lon(sun); b = _lon(p)
    if a is None or b is None:
        return False
    return _ang_diff(a, b) <= orb

def _aspect_bodies(chrt, pid_a, pid_b, angles=(0, 60, 90, 120, 180), orb=6.0):
    a = _planet(chrt, pid_a); b = _planet(chrt, pid_b)
    if a is None or b is None:
        return None
    la = _lon(a); lb = _lon(b)
    if la is None or lb is None:
        return None
    d = _ang_diff(la, lb)
    for ang in angles:
        if abs(d - ang) <= orb:
            return ang
    return None

def _aspect_to_point(chrt, pid, point_lon, angles=(0, 60, 90, 120, 180), orb=6.0):
    pl = _planet(chrt, pid)
    if pl is None or point_lon is None:
        return None
    plon = _lon(pl)
    if plon is None:
        return None
    d = _ang_diff(plon, point_lon)
    for ang in angles:
        if abs(d - ang) <= orb:
            return ang
    return None

def _asc_lon(chrt):
    try:
        return chrt.houses.ascmc[0]  # Houses.ASC == 0
    except Exception:
        return None

def _mc_lon(chrt):
    try:
        return chrt.houses.ascmc[1]  # Houses.MC == 1
    except Exception:
        return None

def _sign_glyph(sign_idx):
    if 0 <= sign_idx < 12:
        return SIGN_GLYPHS[sign_idx]
    return ''

def _planet_glyph(pid):
    if 0 <= pid < len(PLANET_GLYPHS):
        return PLANET_GLYPHS[pid]
    return ''

def _sign_ruler(sign_idx):
    """Traditional rulers (0..11 → planet id)."""
    rulers = {
        0: astrology.SE_MARS,      # Aries
        1: astrology.SE_VENUS,     # Taurus
        2: astrology.SE_MERCURY,   # Gemini
        3: astrology.SE_MOON,      # Cancer
        4: astrology.SE_SUN,       # Leo
        5: astrology.SE_MERCURY,   # Virgo
        6: astrology.SE_VENUS,     # Libra
        7: astrology.SE_MARS,      # Scorpio
        8: astrology.SE_JUPITER,   # Sagittarius
        9: astrology.SE_SATURN,    # Capricorn
        10: astrology.SE_SATURN,   # Aquarius
        11: astrology.SE_JUPITER,  # Pisces
    }
    return rulers.get(sign_idx)


TROPICAL_SIGNS = {0, 3, 6, 9}          # Aries, Cancer, Libra, Capricorn
BICORPOREAL_SIGNS = {2, 5, 8, 11}      # Gemini, Virgo, Sagittarius, Pisces
FIXED_SIGNS = {1, 4, 7, 10}            # Taurus, Leo, Scorpio, Aquarius
# Straight (direct) rising signs in the northern hemisphere: Cancer..Sagittarius.
STRAIGHT_RISING_SIGNS = {3, 4, 5, 6, 7, 8}

# Zodiacal melothesia — sign → body part (Heph. III.31,11).
MELOTHESIA = {
    0: 'head',
    1: 'neck and throat',
    2: 'shoulders and arms',
    3: 'chest and stomach',
    4: 'heart and upper back',
    5: 'intestines and lower abdomen',
    6: 'kidneys and hips',
    7: 'genitals and bladder',
    8: 'thighs',
    9: 'knees',
    10: 'shins and ankles',
    11: 'feet',
}

def _decan(deg):
    if deg < 10.0: return 0
    if deg < 20.0: return 1
    return 2

def _half(deg):
    return 0 if deg < 15.0 else 1

def _moon_elong(chrt):
    """Moon's elongation from the Sun (0–360° forward)."""
    moon = _planet(chrt, astrology.SE_MOON)
    sun = _planet(chrt, astrology.SE_SUN)
    if moon is None or sun is None:
        return None
    a = _lon(moon); b = _lon(sun)
    if a is None or b is None:
        return None
    return (a - b) % 360.0

def _is_waxing(chrt):
    e = _moon_elong(chrt)
    return e is not None and e < 180.0

def _moon_void_of_course(chrt):
    """Moon makes no Ptolemaic aspect to a classical planet before leaving her sign."""
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return False
    mlon = _lon(moon)
    if mlon is None:
        return False
    remaining = 30.0 - _deg_in_sign(mlon)
    for pid in (astrology.SE_SUN, astrology.SE_MERCURY, astrology.SE_VENUS,
                astrology.SE_MARS, astrology.SE_JUPITER, astrology.SE_SATURN):
        p = _planet(chrt, pid)
        if p is None:
            continue
        plon = _lon(p)
        if plon is None:
            continue
        for ang in (0, 60, 90, 120, 180):
            for target in ((plon + ang) % 360.0, (plon - ang) % 360.0):
                diff = (target - mlon) % 360.0
                if 0.0 < diff <= remaining:
                    return False
    return True

def _benefic_on_point(chrt, point_lon, orb=6.0):
    for ben in (astrology.SE_JUPITER, astrology.SE_VENUS):
        a = _aspect_to_point(chrt, ben, point_lon, angles=(0,), orb=orb)
        if a is not None:
            return ben
    return None

def _malefic_on_point(chrt, point_lon, orb=6.0):
    for mal in (astrology.SE_MARS, astrology.SE_SATURN):
        a = _aspect_to_point(chrt, mal, point_lon, angles=(0,), orb=orb)
        if a is not None:
            return mal
    return None


# ─────────────────────────────────────────────────────────────
# Traveling — Hephaistion III.30 / Dorotheus V.21
# ─────────────────────────────────────────────────────────────

def _rule_moon_light(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    sun = _planet(chrt, astrology.SE_SUN)
    if moon is None or sun is None:
        return None
    elong = ((_lon(moon) - _lon(sun)) % 360.0)
    waxing = elong < 180.0
    if waxing:
        return Alert('good', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon increasing in light',
                     'Waxing — favourable for departure.',
                     'Heph. III.30, §2')
    return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                 'Moon decreasing in light',
                 'Waning — weakens the significator of the journey.',
                 'Heph. III.30, §2')


def _rule_moon_latitude(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    lat = _lat(moon)
    if lat is None:
        return None
    if lat > 0.2:
        return Alert('good', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon in north latitude',
                     'Additive in latitude — favourable.',
                     'Heph. III.30, §2')
    if lat < -0.2:
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon in south latitude',
                     'Subtractive in latitude — avoid for journeys.',
                     'Heph. III.28, §4')
    return None


def _rule_moon_speed(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    sp = _speed(moon)
    if sp >= 13.2:
        return Alert('good', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon swift in motion',
                     'Fast Moon supports a brisk journey.',
                     'Heph. III.30, §2')
    if sp <= 11.8:
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon slow in motion',
                     'Sluggish Moon — delays on the road.',
                     'Heph. III.30, §2')
    return None


def _rule_moon_nodes(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    mlon = _lon(moon)
    if mlon is None:
        return None
    node_id = astrology.SE_TRUE_NODE
    node = _planet(chrt, node_id)
    if node is None:
        node_id = astrology.SE_MEAN_NODE
        node = _planet(chrt, node_id)
    if node is None:
        return None
    nlon = _lon(node)
    if nlon is None:
        return None
    d = _ang_diff(mlon, nlon)
    near_node = d <= 3.0 or abs(d - 180.0) <= 3.0
    if near_node:
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon on the Nodes',
                     'Close to North/South Node — eclipse-like, avoid travel.',
                     'Heph. III.28, §4')
    return None


def _rule_moon_places(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    mlon = _lon(moon)
    if mlon is None:
        return None
    h = _house_of(chrt, mlon)
    if h == 6:
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon in the 6th (Bad Fortune)',
                     'Produces misery, loss of livelihood — do not depart.',
                     'Heph. III.30, §7')
    if h == 12:
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon in the 12th (Bad Spirit)',
                     'Misery and hidden enemies — avoid travel.',
                     'Heph. III.30, §9')
    return None


# Land travel outgoing (§24–34) — degree-sensitive for Leo/Libra.
# Values: ('good'/'caution'/'avoid', body)
def _moon_by_sign_land_out(sign_idx, deg):
    table = {
        0: ('good', 'Quick returns — suitable for departure.'),                           # Aries
        1: ('good', 'Favourable for going out.'),                                         # Taurus
        2: ('caution', 'Outgoing: long stay abroad.'),                                    # Gemini
        3: (None, None),                                                                   # Cancer — return only
        4: None,  # Leo — handled below by degree
        5: (None, None),                                                                   # Virgo — return only
        6: None,  # Libra — handled below by degree
        7: ('good', 'Suitable for departure and return.'),                                # Scorpio
        8: ('avoid', 'Aimless wandering — avoid outgoing.'),                              # Sagittarius
        9: ('avoid', 'Avoid outgoing; favourable only for return.'),                      # Capricorn
        10: ('avoid', 'Avoid outgoing; favourable only for return.'),                     # Aquarius
        11: ('caution', 'Suitable only for going to war.'),                               # Pisces
    }
    if sign_idx == 4:  # Leo
        if deg < 15.0:
            return ('avoid', 'Leo 0°–15°: avoid outgoing.')
        return ('caution', 'Leo 15°–30°: lesser evil.')
    if sign_idx == 6:  # Libra
        if deg < 10.0:
            return ('avoid', 'Libra 0°–10°: avoid outgoing.')
        return ('good', 'Libra 10°–30°: favourable outgoing.')
    return table.get(sign_idx)


def _rule_moon_by_sign_travel(chrt):
    """Legacy inline Moon-by-sign travel verdict.

    Only runs as the theme-wide fallback when no pack covers
    elections/traveling. Pack-driven lookup happens in `rule_engine.evaluate`
    ahead of this function.
    """
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return []
    mlon = _lon(moon)
    if mlon is None:
        return []
    s = _sign(mlon)
    d = _deg_in_sign(mlon)
    moon_glyph = _sign_glyph(s)
    title = 'Moon in ' + SIGN_NAMES[s]
    verdict = _moon_by_sign_land_out(s, d)
    if not verdict or verdict[0] is None:
        return []
    status, body = verdict
    return [Alert(status, moon_glyph, title, body,
                  'Heph. III.30, §24–34', pack=None)]


def _rule_mercury_condition(chrt):
    merc = _planet(chrt, astrology.SE_MERCURY)
    if merc is None:
        return None
    if _is_retrograde(merc):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury retrograde',
                     'Mercury governs affairs abroad — reversed motion reverses outcomes.',
                     'Heph. III.30, §5')
    if _is_stationary(merc):
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury stationary',
                     'Slowing toward retrogradation — delays and losses.',
                     'Heph. III.30, §5')
    if _under_rays(chrt, astrology.SE_MERCURY, orb=8.0):
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury under the rays',
                     'Obscured by the Sun — poor for business abroad.',
                     'Heph. III.30, §5')
    return None


def _rule_mercury_malefic(chrt):
    merc = _planet(chrt, astrology.SE_MERCURY)
    if merc is None:
        return None
    for mal_id, name in ((astrology.SE_MARS, 'Mars'), (astrology.SE_SATURN, 'Saturn')):
        asp = _aspect_bodies(chrt, astrology.SE_MERCURY, mal_id, angles=(0, 90, 180), orb=5.0)
        if asp is not None:
            return Alert('caution', PLANET_GLYPHS[astrology.SE_MERCURY],
                         'Mercury afflicted by ' + name,
                         'Hard aspect damages the traveller\u2019s affairs abroad.',
                         'Heph. III.30, §5')
    return None


def _rule_lords_pair(chrt):
    asc = _asc_lon(chrt)
    moon = _planet(chrt, astrology.SE_MOON)
    if asc is None or moon is None:
        return None
    asc_sign = _sign(asc)
    moon_sign = _sign(_lon(moon))
    lord_asc_id = _sign_ruler(asc_sign)
    lord_moon_id = _sign_ruler(moon_sign)
    la = _planet(chrt, lord_asc_id)
    lm = _planet(chrt, lord_moon_id)
    if la is None or lm is None:
        return None
    # Under the beams
    for pid, lbl in ((lord_asc_id, 'Lord of ASC'), (lord_moon_id, 'Lord of Moon')):
        if pid != astrology.SE_SUN and _under_rays(chrt, pid, orb=8.0):
            return Alert('caution', _planet_glyph(pid),
                         lbl + ' under the rays',
                         'Combust — the traveller\u2019s means are obscured.',
                         'Heph. III.30, §10')
    # Stationary
    for pid, lbl in ((lord_asc_id, 'Lord of ASC'), (lord_moon_id, 'Lord of Moon')):
        if _is_stationary(_planet(chrt, pid)):
            return Alert('caution', _planet_glyph(pid),
                         lbl + ' stationary',
                         'Slowness, want of action, delays.',
                         'Heph. III.30, §12')
    # Aversion (divided) — no major aspect within 6°
    if lord_asc_id != lord_moon_id:
        asp = _aspect_bodies(chrt, lord_asc_id, lord_moon_id,
                             angles=(0, 60, 90, 120, 180), orb=6.0)
        if asp is None:
            return Alert('caution', _planet_glyph(lord_asc_id),
                         'Lords of ASC and Moon in aversion',
                         'Disconnected — traveller and means not cooperating.',
                         'Heph. III.30, §11')
    return None


def _rule_angle_testimony(chrt):
    asc = _asc_lon(chrt)
    if asc is None:
        return None
    # DSC = ASC + 180
    dsc = (asc + 180.0) % 360.0
    mc = _mc_lon(chrt)
    # Malefics on/aspecting DSC → bodily weakness, delays (§6)
    for mal_id, name in ((astrology.SE_MARS, 'Mars'), (astrology.SE_SATURN, 'Saturn')):
        a = _aspect_to_point(chrt, mal_id, dsc, angles=(0,), orb=6.0)
        if a is not None:
            return Alert('avoid', _planet_glyph(mal_id),
                         name + ' on the Descendant',
                         'Bodily weakness, damage, delays at destination.',
                         'Heph. III.30, §6')
    # Benefic on/aspecting ASC → pleasant land journey (§4)
    for ben_id, name in ((astrology.SE_JUPITER, 'Jupiter'), (astrology.SE_VENUS, 'Venus')):
        a = _aspect_to_point(chrt, ben_id, asc, angles=(0, 60, 120), orb=6.0)
        if a is not None:
            return Alert('good', _planet_glyph(ben_id),
                         name + ' testifying to the Ascendant',
                         'Pleasant land journey — benefic covers the traveller.',
                         'Heph. III.30, §4')
    # Mars on MC → shipwreck / peak-of-journey risk (§36)
    if mc is not None:
        a = _aspect_to_point(chrt, astrology.SE_MARS, mc, angles=(0,), orb=5.0)
        if a is not None:
            return Alert('avoid', _planet_glyph(astrology.SE_MARS),
                         'Mars on the Midheaven',
                         'Shipwreck risk at the peak of the journey.',
                         'Heph. III.30, §36')
    return None


def _rule_stations(chrt):
    """Any outer planet station at the election → delays, reversals."""
    stationary = []
    for pid in (astrology.SE_MERCURY, astrology.SE_VENUS, astrology.SE_MARS,
                astrology.SE_JUPITER, astrology.SE_SATURN):
        pl = _planet(chrt, pid)
        if _is_stationary(pl):
            stationary.append(pid)
    if not stationary:
        return None
    names = ', '.join([_planet_glyph(p) for p in stationary])
    return Alert('caution', names[:1] if names else 'A',
                 'Stationary planet',
                 'Stations at election → delays and turning back.',
                 'Heph. III.30, §14')


def _rule_void_moon_fit_sign(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    s = _sign(_lon(moon))
    fit = {1, 2, 3, 5, 8, 9, 11}  # Taurus, Gemini, Cancer, Virgo, Sag, Cap, Pisces
    if s in fit:
        return Alert('good', _sign_glyph(s),
                     'Moon in a sign fit for sailing',
                     SIGN_NAMES[s] + ' is among the signs allowed even for a void Moon.',
                     'Heph. III.30, §63')
    return None


def _evaluate_traveling(chrt):
    return [
        _rule_moon_light(chrt),
        _rule_moon_latitude(chrt),
        _rule_moon_speed(chrt),
        _rule_moon_nodes(chrt),
        _rule_moon_places(chrt),
        _rule_moon_by_sign_travel(chrt),
        _rule_mercury_condition(chrt),
        _rule_mercury_malefic(chrt),
        _rule_lords_pair(chrt),
        _rule_angle_testimony(chrt),
        _rule_stations(chrt),
        _rule_void_moon_fit_sign(chrt),
    ]


# ─────────────────────────────────────────────────────────────
# Universal Inception Gate — Hephaistion III.2
# ─────────────────────────────────────────────────────────────

def _rule_lord_asc_placement(chrt):
    asc = _asc_lon(chrt)
    if asc is None:
        return None
    lord_id = _sign_ruler(_sign(asc))
    lord = _planet(chrt, lord_id)
    if lord is None:
        return None
    h = _house_of(chrt, _lon(lord))
    if h == 8:
        return Alert('avoid', _planet_glyph(lord_id),
                     'Lord of ASC in the 8th',
                     'Deadly placement for the inceptor — reject.',
                     'Heph. III.2, §1')
    if h == 2:
        return Alert('caution', _planet_glyph(lord_id),
                     'Lord of ASC in the 2nd',
                     'Lord on livelihood — weak universal precondition.',
                     'Heph. III.2, §1')
    return None


def _rule_moon_good_place(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    h = _house_of(chrt, _lon(moon))
    if h in (6, 8, 12):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon in a cadent bad place',
                     'Moon in the %d — adverse precondition.' % h,
                     'Heph. III.2, §3')
    return None


def _rule_moon_void_general(chrt):
    if _moon_void_of_course(chrt):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon void of course',
                     'No more aspects before leaving sign — reject.',
                     'Heph. III.5, §48')
    return None


def _rule_moon_diminishing_general(chrt):
    if _is_waxing(chrt):
        return None
    return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                 'Moon diminishing in light',
                 'Reject unless the theme calls for waning (surgery, purge).',
                 'Heph. III.5, §48')


def _rule_asc_benefic_witness(chrt):
    asc = _asc_lon(chrt)
    if asc is None:
        return None
    ben = _benefic_on_point(chrt, asc, orb=6.0)
    if ben is not None:
        name = 'Jupiter' if ben == astrology.SE_JUPITER else 'Venus'
        return Alert('good', _planet_glyph(ben),
                     name + ' on the Ascendant',
                     'Benefic covers the ASC — strong universal precondition.',
                     'Heph. III.2, §3')
    return None


def _universal_gate(chrt):
    return [
        _rule_lord_asc_placement(chrt),
        _rule_moon_good_place(chrt),
        _rule_moon_void_general(chrt),
        _rule_moon_diminishing_general(chrt),
        _rule_asc_benefic_witness(chrt),
    ]


# ─────────────────────────────────────────────────────────────
# Meetings — Hephaistion III.20
# ─────────────────────────────────────────────────────────────

def _rule_meetings_moon_sign(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    s = _sign(_lon(moon))
    # Libra — special: legal matters.
    if s == 6:
        return Alert('good', _sign_glyph(s),
                     'Moon in Libra',
                     'Especially favourable for legal meetings and recovering money owed.',
                     'Heph. III.20, §1')
    # Plain suitable signs.
    if s in (0, 1, 2, 5, 7, 9):
        return Alert('good', _sign_glyph(s),
                     'Moon in ' + SIGN_NAMES[s],
                     'Suitable sign for meetings and negotiations.',
                     'Heph. III.20, §1')
    # Sagittarius — double-bodied ambiguity.
    if s == 8:
        return Alert('caution', _sign_glyph(s),
                     'Moon in Sagittarius',
                     'Acceptable for accusations; avoid for requests for favour.',
                     'Heph. III.20, §1')
    # Leo / Aquarius / Pisces — need benefic witness.
    if s in (4, 10, 11):
        ben = None
        for bid in (astrology.SE_JUPITER, astrology.SE_VENUS):
            if _aspect_bodies(chrt, astrology.SE_MOON, bid,
                              angles=(0, 60, 120), orb=6.0) is not None:
                ben = bid
                break
        if ben is not None:
            return Alert('caution', _sign_glyph(s),
                         'Moon in ' + SIGN_NAMES[s],
                         'Workable only because a benefic witnesses the Moon.',
                         'Heph. III.20, §1')
        return Alert('avoid', _sign_glyph(s),
                     'Moon in ' + SIGN_NAMES[s],
                     'Needs a benefic aspect to the Moon — none present.',
                     'Heph. III.20, §1')
    # Cancer — not listed either way; treat as caution.
    return Alert('caution', _sign_glyph(s),
                 'Moon in ' + SIGN_NAMES[s],
                 'Not among the recommended signs for meetings.',
                 'Heph. III.20, §1')


def _rule_meetings_sun_moon_afflict(chrt):
    # Mars square/opposition Sun → avoid for friendship meetings.
    asp = _aspect_bodies(chrt, astrology.SE_SUN, astrology.SE_MARS,
                         angles=(90, 180), orb=6.0)
    if asp is not None:
        return Alert('avoid', _planet_glyph(astrology.SE_MARS),
                     'Mars hard aspect to Sun',
                     'Poisons friendship / first meetings.',
                     'Heph. III.20, §5')
    asp = _aspect_bodies(chrt, astrology.SE_MOON, astrology.SE_SATURN,
                         angles=(90, 180), orb=6.0)
    if asp is not None:
        return Alert('avoid', _planet_glyph(astrology.SE_SATURN),
                     'Saturn hard aspect to Moon',
                     'Chills the meeting — avoid.',
                     'Heph. III.20, §5')
    return None


def _rule_meetings_benefic_witness(chrt):
    # Benefic connected to both luminaries → rejoicing meeting.
    for ben_id, name in ((astrology.SE_JUPITER, 'Jupiter'), (astrology.SE_VENUS, 'Venus')):
        asp_sun = _aspect_bodies(chrt, astrology.SE_SUN, ben_id,
                                 angles=(0, 60, 120), orb=6.0)
        asp_moon = _aspect_bodies(chrt, astrology.SE_MOON, ben_id,
                                  angles=(0, 60, 120), orb=6.0)
        if asp_sun is not None and asp_moon is not None:
            return Alert('good', _planet_glyph(ben_id),
                         name + ' witnesses Sun and Moon',
                         'Luminaries connected through a benefic — auspicious meeting.',
                         'Heph. III.20, §5–6')
    return None


def _evaluate_meetings(chrt):
    alerts = _universal_gate(chrt)
    alerts.extend([
        _rule_meetings_moon_sign(chrt),
        _rule_meetings_sun_moon_afflict(chrt),
        _rule_meetings_benefic_witness(chrt),
    ])
    return alerts


# ─────────────────────────────────────────────────────────────
# Marriage — Hephaistion III.9
# ─────────────────────────────────────────────────────────────

_MARRIAGE_MOON_TABLE = {
    0: ('avoid', 'Refuse — quickly dissolved marriage.'),                 # Aries
    3: ('avoid', 'Wholly inauspicious for marriage.'),                    # Cancer
    4: ('caution', 'Husband becomes wastefully lavish.'),                 # Leo
    5: ('caution', 'Good only for marrying a widow, not a maid.'),        # Virgo
    6: ('avoid', 'Unfit to marry (but favourable for being courted).'),   # Libra
    8: ('caution', 'Watch for scarcity of children.'),                    # Sagittarius
    10: ('avoid', 'Unfit for marriage.'),                                 # Aquarius
    11: ('caution', 'Wife will be warlike and silly-talking.'),           # Pisces
}


def _rule_marriage_venus_moon_tropical(chrt):
    venus = _planet(chrt, astrology.SE_VENUS)
    moon = _planet(chrt, astrology.SE_MOON)
    if venus is None or moon is None:
        return None
    vs = _sign(_lon(venus))
    ms = _sign(_lon(moon))
    if vs in TROPICAL_SIGNS:
        return Alert('avoid', _planet_glyph(astrology.SE_VENUS),
                     'Venus in a tropical sign',
                     'Venus in ' + SIGN_NAMES[vs] + ' — lustful, unfaithful wife.',
                     'Heph. III.9, §4')
    if ms in TROPICAL_SIGNS:
        return Alert('avoid', _planet_glyph(astrology.SE_MOON),
                     'Moon in a tropical sign',
                     'Moon in ' + SIGN_NAMES[ms] + ' — no lasting marriage bed.',
                     'Heph. III.9, §4')
    return None


def _rule_marriage_moon_by_sign(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    mlon = _lon(moon)
    s = _sign(mlon)
    d = _deg_in_sign(mlon)
    # Decan- and half-sensitive entries.
    if s == 1:  # Taurus
        dec = _decan(d)
        if dec == 1:
            return Alert('good', _sign_glyph(s),
                         'Moon in Taurus 2nd decan',
                         'Fitting for marriage.',
                         'Heph. III.9, §6')
        return Alert('avoid', _sign_glyph(s),
                     'Moon in Taurus 1st/3rd decan',
                     'Refuse — 2nd decan only.',
                     'Heph. III.9, §6')
    if s == 2:  # Gemini
        if _half(d) == 0:
            return Alert('avoid', _sign_glyph(s),
                         'Moon in Gemini 0–15°',
                         'First half — refuse.',
                         'Heph. III.9, §7')
        return Alert('good', _sign_glyph(s),
                     'Moon in Gemini 15–30°',
                     'Second half — favourable for marriage.',
                     'Heph. III.9, §7')
    if s == 7:  # Scorpio
        if _half(d) == 0:
            return Alert('good', _sign_glyph(s),
                         'Moon in Scorpio 1st half',
                         'Favourable for marriage.',
                         'Heph. III.9, §12')
        return Alert('caution', _sign_glyph(s),
                     'Moon in Scorpio 2nd half',
                     'Short-lasting marriage.',
                     'Heph. III.9, §12')
    if s == 9:  # Capricorn
        dec = _decan(d)
        if dec == 0:
            return Alert('avoid', _sign_glyph(s),
                         'Moon in Capricorn 1st decan',
                         'Partners become wandering liars.',
                         'Heph. III.9, §14')
        return Alert('good', _sign_glyph(s),
                     'Moon in Capricorn 2nd/3rd decan',
                     'Favourable for marriage.',
                     'Heph. III.9, §14')
    entry = _MARRIAGE_MOON_TABLE.get(s)
    if entry is None:
        return None
    status, body = entry
    return Alert(status, _sign_glyph(s),
                 'Moon in ' + SIGN_NAMES[s],
                 body,
                 'Heph. III.9, §5–15')


def _rule_marriage_venus_afflicted(chrt):
    for mal_id, name in ((astrology.SE_MARS, 'Mars'), (astrology.SE_SATURN, 'Saturn')):
        asp = _aspect_bodies(chrt, astrology.SE_VENUS, mal_id,
                             angles=(0, 90, 180), orb=6.0)
        if asp is not None:
            return Alert('avoid', _planet_glyph(mal_id),
                         name + ' afflicting Venus',
                         'Deadly for the wife; shame; short marriage.',
                         'Heph. III.9, §2')
    return None


def _rule_marriage_full_moon(chrt):
    e = _moon_elong(chrt)
    if e is None:
        return None
    if abs(e - 180.0) <= 8.0:
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                     'Full Moon at wedding',
                     'Wife will trouble the husband.',
                     'Heph. III.9, §25')
    return None


def _rule_marriage_void_moon(chrt):
    if _moon_void_of_course(chrt):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon void of course',
                     'Promiscuity — reject for marriage.',
                     'Heph. III.9, §46')
    return None


_MARRIAGE_ASC_PIVOT = {
    astrology.SE_SATURN:  ('caution', 'older, dirty husband'),
    astrology.SE_MARS:    ('caution', 'younger, angry husband'),
    astrology.SE_JUPITER: ('good',    'rich, noble, middle-aged husband'),
    astrology.SE_VENUS:   ('good',    'cheerful, clean, pleasant husband'),
    astrology.SE_MERCURY: ('good',    'well-educated, intelligent husband'),
    astrology.SE_SUN:     ('good',    'well-born, remarkable husband'),
    astrology.SE_MOON:    ('good',    'well-born, remarkable husband'),
}


def _rule_marriage_pivot_planets(chrt):
    asc = _asc_lon(chrt)
    mc = _mc_lon(chrt)
    if asc is None:
        return None
    # ASC planet.
    for pid, (status, body) in _MARRIAGE_ASC_PIVOT.items():
        a = _aspect_to_point(chrt, pid, asc, angles=(0,), orb=5.0)
        if a is not None:
            return Alert(status, _planet_glyph(pid),
                         'Planet on ASC',
                         'Signifies ' + body + '.',
                         'Heph. III.9, §38')
    # Malefic on MC.
    if mc is not None:
        for mal_id, name in ((astrology.SE_SATURN, 'Saturn'), (astrology.SE_MARS, 'Mars')):
            a = _aspect_to_point(chrt, mal_id, mc, angles=(0,), orb=5.0)
            if a is not None:
                return Alert('avoid', _planet_glyph(mal_id),
                             name + ' on the Midheaven',
                             'Breakup, instability or jealousy in the union.',
                             'Heph. III.9, §39')
    return None


def _evaluate_marriage(chrt):
    alerts = _universal_gate(chrt)
    alerts.extend([
        _rule_marriage_venus_moon_tropical(chrt),
        _rule_marriage_moon_by_sign(chrt),
        _rule_marriage_venus_afflicted(chrt),
        _rule_marriage_full_moon(chrt),
        _rule_marriage_void_moon(chrt),
        _rule_marriage_pivot_planets(chrt),
    ])
    return alerts


# ─────────────────────────────────────────────────────────────
# Medical Procedure — Hephaistion III.32–34
# ─────────────────────────────────────────────────────────────

def _rule_medical_moon_light(chrt):
    if _is_waxing(chrt):
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon waxing',
                     'General surgery and purgation call for a waning Moon.',
                     'Heph. III.32, §1 / III.34, §1')
    return Alert('good', PLANET_GLYPHS[astrology.SE_MOON],
                 'Moon waning',
                 'Decreasing light — favourable for surgery and purgation.',
                 'Heph. III.32, §1')


def _rule_medical_moon_spasm_signs(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    s = _sign(_lon(moon))
    if s in (1, 5, 9, 11):  # Taurus, Virgo, Capricorn, Pisces
        return Alert('avoid', _sign_glyph(s),
                     'Moon in ' + SIGN_NAMES[s],
                     'Causes spasms / convulsions — avoid for surgery.',
                     'Heph. III.32, §2')
    return None


def _rule_medical_moon_tropical(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    s = _sign(_lon(moon))
    if s not in TROPICAL_SIGNS:
        return None
    # Benefic aspecting the Moon softens it.
    for bid in (astrology.SE_JUPITER, astrology.SE_VENUS):
        if _aspect_bodies(chrt, astrology.SE_MOON, bid,
                          angles=(0, 60, 120), orb=6.0) is not None:
            return Alert('caution', _sign_glyph(s),
                         'Moon in tropical ' + SIGN_NAMES[s],
                         'Relapse risk — softened by benefic connection to Moon.',
                         'Heph. III.32, §3 / §8')
    return Alert('avoid', _sign_glyph(s),
                 'Moon in tropical ' + SIGN_NAMES[s],
                 'Surgery causes relapse; no benefic connects.',
                 'Heph. III.32, §3 / §8')


def _rule_medical_moon_sun_assembly(chrt):
    e = _moon_elong(chrt)
    if e is None:
        return None
    if e <= 8.0 or e >= 352.0:
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon conjunct Sun',
                     'New Moon — body is weakest, reject surgery.',
                     'Heph. III.32, §4')
    return None


def _rule_medical_moon_nodes(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    mlon = _lon(moon)
    node = _planet(chrt, astrology.SE_TRUE_NODE) or _planet(chrt, astrology.SE_MEAN_NODE)
    if node is None:
        return None
    nlon = _lon(node)
    if nlon is None:
        return None
    d = _ang_diff(mlon, nlon)
    if d <= 3.0 or abs(d - 180.0) <= 3.0:
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon on the Nodes',
                     'Amplifies affliction — avoid for general medical work.',
                     'Heph. III.32, §4')
    return None


def _rule_medical_pivot_malefic_retrograde(chrt):
    asc = _asc_lon(chrt); mc = _mc_lon(chrt)
    if asc is None:
        return None
    dsc = (asc + 180.0) % 360.0
    ic = (mc + 180.0) % 360.0 if mc is not None else None
    for mal_id, name in ((astrology.SE_MARS, 'Mars'), (astrology.SE_SATURN, 'Saturn')):
        pl = _planet(chrt, mal_id)
        if pl is None or not _is_retrograde(pl):
            continue
        for point, label in ((asc, 'ASC'), (mc, 'MC'), (dsc, 'DSC'), (ic, 'IC')):
            if point is None:
                continue
            a = _aspect_to_point(chrt, mal_id, point, angles=(0,), orb=5.0)
            if a is not None:
                return Alert('avoid', _planet_glyph(mal_id),
                             name + ' retrograde on ' + label,
                             'Malefic retrograde on a pivot — reject the procedure.',
                             'Heph. III.32, §7')
    return None


def _rule_medical_moon_benefic(chrt):
    for bid, name in ((astrology.SE_JUPITER, 'Jupiter'), (astrology.SE_VENUS, 'Venus')):
        if _aspect_bodies(chrt, astrology.SE_MOON, bid,
                          angles=(0, 60, 120), orb=6.0) is not None:
            return Alert('good', _planet_glyph(bid),
                         'Moon connected to ' + name,
                         'Benefic connection — dispels misery, aids recovery.',
                         'Heph. III.33, §8')
    return None


def _evaluate_medical(chrt):
    # Medical elections deliberately skip the "waning Moon" precondition,
    # so they do not run the full universal gate.
    return [
        _rule_lord_asc_placement(chrt),
        _rule_moon_good_place(chrt),
        _rule_moon_void_general(chrt),
        _rule_medical_moon_light(chrt),
        _rule_medical_moon_spasm_signs(chrt),
        _rule_medical_moon_tropical(chrt),
        _rule_medical_moon_sun_assembly(chrt),
        _rule_medical_moon_nodes(chrt),
        _rule_medical_pivot_malefic_retrograde(chrt),
        _rule_medical_moon_benefic(chrt),
    ]


# ─────────────────────────────────────────────────────────────
# Starting a Business — Hephaistion III.5 + III.26
# ─────────────────────────────────────────────────────────────

def _rule_business_mercury_core(chrt):
    merc = _planet(chrt, astrology.SE_MERCURY)
    if merc is None:
        return None
    if _is_retrograde(merc):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury retrograde',
                     'Commerce significator reversed — avoid starting a venture.',
                     'Heph. III.5, §59')
    if _is_stationary(merc):
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury stationary',
                     'Slowing — delays and stalled partnerships.',
                     'Heph. III.5, §59')
    if _under_rays(chrt, astrology.SE_MERCURY, orb=8.0):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury combust',
                     'Secret affairs become exposed — bad for business discretion.',
                     'Heph. III.5, §60')
    return Alert('good', PLANET_GLYPHS[astrology.SE_MERCURY],
                 'Mercury direct and free',
                 'Partnership significator is clean — favourable.',
                 'Heph. III.5, §59')


def _rule_business_moon_sign(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    mlon = _lon(moon)
    s = _sign(mlon)
    d = _deg_in_sign(mlon)
    if s == 6:  # Libra
        return Alert('good', _sign_glyph(s),
                     'Moon in Libra',
                     'Best for commerce, workshops, scales and measures.',
                     'Heph. III.5, §38')
    if s == 0 and d < 9.0:  # Aries first 9°
        return Alert('good', _sign_glyph(s),
                     'Moon in Aries 0–9°',
                     'Foundations, treaties, loans, weaving.',
                     'Heph. III.5, §62')
    if s == 2:  # Gemini
        if d < 15.0:
            return Alert('avoid', _sign_glyph(s),
                         'Moon in Gemini 0–15°',
                         'Turn away from starting any matter.',
                         'Heph. III.5, §64')
        return Alert('good', _sign_glyph(s),
                     'Moon in Gemini 15–30°',
                     'Promises, oaths, partnerships, appointing governors.',
                     'Heph. III.5, §64')
    if s == 4 and d >= 10.0:  # Leo from 10°
        return Alert('good', _sign_glyph(s),
                     'Moon in Leo from 10°',
                     'Four-footed stock, authority.',
                     'Heph. III.5, §66')
    if s == 10:  # Aquarius — deposits
        return Alert('caution', _sign_glyph(s),
                     'Moon in Aquarius',
                     'Avoid for taking deposits (source of ingratitude).',
                     'Heph. III.5, §34')
    if s == 1 and d >= 15.0:  # Taurus second half
        return Alert('caution', _sign_glyph(s),
                     'Moon in Taurus 15–30°',
                     'Letting something out for hire causes loss.',
                     'Heph. III.5, §63')
    return None


def _rule_business_moon_condition(chrt):
    if _moon_void_of_course(chrt):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon void of course',
                     'No applying aspect before leaving sign — reject.',
                     'Heph. III.5, §48')
    return None


def _rule_business_pivots_iii26(chrt):
    asc = _asc_lon(chrt); mc = _mc_lon(chrt)
    if asc is None:
        return None
    asc_sign = _sign(asc)
    if asc_sign in STRAIGHT_RISING_SIGNS:
        alert_rise = Alert('good', _sign_glyph(asc_sign),
                           'Straight rising sign on ASC',
                           'Counterparty\u2019s intentions are honest.',
                           'Heph. III.26, §2')
    else:
        alert_rise = Alert('caution', _sign_glyph(asc_sign),
                           'Oblique rising sign on ASC',
                           'Counterparty may be deceptive.',
                           'Heph. III.26, §2')
    if mc is not None:
        mal = _malefic_on_point(chrt, mc, orb=5.0)
        if mal is not None:
            name = 'Mars' if mal == astrology.SE_MARS else 'Saturn'
            return [alert_rise,
                    Alert('avoid', _planet_glyph(mal),
                          name + ' on the Midheaven',
                          'The business itself will bring disgust — unfavourable.',
                          'Heph. III.26, §4')]
    return [alert_rise]


def _evaluate_business(chrt):
    alerts = _universal_gate(chrt)
    alerts.append(_rule_business_mercury_core(chrt))
    alerts.append(_rule_business_moon_sign(chrt))
    alerts.append(_rule_business_moon_condition(chrt))
    extra = _rule_business_pivots_iii26(chrt)
    if extra:
        alerts.extend(extra)
    return alerts


# ─────────────────────────────────────────────────────────────
# Signing Contracts — Hephaistion III.26 + III.8/27/28
# ─────────────────────────────────────────────────────────────

def _rule_contracts_mercury(chrt):
    merc = _planet(chrt, astrology.SE_MERCURY)
    if merc is None:
        return None
    if _is_retrograde(merc):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury retrograde',
                     'Documents and agreements reversed — reject.',
                     'Heph. III.26 / III.27')
    if _is_stationary(merc):
        return Alert('caution', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury stationary',
                     'Slowing toward station — ambiguous document.',
                     'Heph. III.26')
    if _under_rays(chrt, astrology.SE_MERCURY, orb=8.0):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MERCURY],
                     'Mercury combust',
                     'Terms hidden or misread — avoid signing.',
                     'Heph. III.27, §2')
    return Alert('good', PLANET_GLYPHS[astrology.SE_MERCURY],
                 'Mercury direct and free',
                 'Language and documents are clean.',
                 'Heph. III.26')


def _rule_contracts_asc_rising_type(chrt):
    asc = _asc_lon(chrt)
    if asc is None:
        return None
    s = _sign(asc)
    if s in STRAIGHT_RISING_SIGNS:
        return Alert('good', _sign_glyph(s),
                     'Straight rising sign on ASC',
                     'Counterparty\u2019s intentions are honest.',
                     'Heph. III.26, §2')
    return Alert('caution', _sign_glyph(s),
                 'Oblique rising sign on ASC',
                 'Counterparty may be deceptive or obscure.',
                 'Heph. III.26, §2')


def _rule_contracts_pivot_bodies(chrt):
    asc = _asc_lon(chrt); mc = _mc_lon(chrt)
    if asc is None:
        return None
    # Benefic on ASC.
    ben = _benefic_on_point(chrt, asc, orb=5.0)
    if ben is not None:
        name = 'Jupiter' if ben == astrology.SE_JUPITER else 'Venus'
        return Alert('good', _planet_glyph(ben),
                     name + ' on the Ascendant',
                     'No cunning to fear from the proposer.',
                     'Heph. III.26, §3')
    # Malefic on MC.
    if mc is not None:
        mal = _malefic_on_point(chrt, mc, orb=5.0)
        if mal is not None:
            name = 'Mars' if mal == astrology.SE_MARS else 'Saturn'
            return Alert('avoid', _planet_glyph(mal),
                         name + ' on the Midheaven',
                         'The matter itself will lead to disgust.',
                         'Heph. III.26, §4')
    return None


def _rule_contracts_moon_void(chrt):
    if _moon_void_of_course(chrt):
        return Alert('avoid', PLANET_GLYPHS[astrology.SE_MOON],
                     'Moon void of course',
                     'Contract has no follow-through — reject.',
                     'Heph. III.26, §6')
    return None


def _rule_contracts_letter_sign(chrt):
    """Document-delivery flag from III.27 — informational."""
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    s = _sign(_lon(moon))
    if s == 8:  # Sagittarius
        return Alert('avoid', _sign_glyph(s),
                     'Moon in Sagittarius',
                     'Message delivered false or deceptive.',
                     'Heph. III.27, §3')
    if s in (0, 3, 4, 5, 7, 10):  # Aries Cancer Leo Virgo Scorpio Aquarius
        return Alert('good', _sign_glyph(s),
                     'Moon in ' + SIGN_NAMES[s],
                     'Transmitted documents delivered true and certain.',
                     'Heph. III.27, §3')
    return None


def _rule_contracts_oath_moon_mars(chrt):
    moon = _planet(chrt, astrology.SE_MOON)
    if moon is None:
        return None
    if _sign(_lon(moon)) != 7:  # Scorpio
        return None
    asp = _aspect_bodies(chrt, astrology.SE_MOON, astrology.SE_MARS,
                         angles=(0, 180), orb=6.0)
    if asp is not None:
        return Alert('avoid', _planet_glyph(astrology.SE_MARS),
                     'Moon in Scorpio with Mars',
                     'Unstable oath-integrity — avoid sworn contracts.',
                     'Heph. III.8')
    return None


def _evaluate_contracts(chrt):
    alerts = _universal_gate(chrt)
    alerts.extend([
        _rule_contracts_mercury(chrt),
        _rule_contracts_asc_rising_type(chrt),
        _rule_contracts_pivot_bodies(chrt),
        _rule_contracts_moon_void(chrt),
        _rule_contracts_letter_sign(chrt),
        _rule_contracts_oath_moon_mars(chrt),
    ])
    return alerts


_THEME_EVALUATORS = {
    'Traveling': _evaluate_traveling,
    'Meetings': _evaluate_meetings,
    'Marriage': _evaluate_marriage,
    'Medical Procedure': _evaluate_medical,
    'Starting a Business': _evaluate_business,
    'Signing Contracts': _evaluate_contracts,
}
