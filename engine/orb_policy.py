# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""How a chart's aspect allowances are formed.

Every consumer forms a pair's allowance from two per-body contributions (or one
contribution and an angle/house orb) through ``combiner``: the sum, or under
Morin's whole orbs the larger. A policy is therefore resolved once into an
effective contribution table shaped like ``options.orbis``; consumers read
that table and its pair rule.

- ``custom``: the saved Morinus matrix, each cell a contribution, added
  without halving (Moon sextile 3° + Jupiter sextile 3° = ±6°).
- a source preset: cited shares for some cells. A moiety table gives each body
  half its orb (Lilly: Moon 12°30′/2 + Jupiter 12°/2 = ±12°15′). Cells a
  preset does not give keep their saved contributions.
"""
from functools import lru_cache

import astrology

CUSTOM = "custom"
# Chart.Aspects order.
(CONJ, SEMISEXTILE, SEMISQUARE, SEXTILE, QUINTILE, SQUARE, TRINE,
 SESQUIQUADRATE, BIQUINTILE, QUINCUNX, OPPOSITION, SEPTILE) = range(12)
PTOLEMAIC = (CONJ, SEXTILE, SQUARE, TRINE, OPPOSITION)

# Lilly's own first column, Christian Astrology I p.107 ("by the best Authors
# and my own Experience"), the column his platick example and combustion rule
# use. Shared by the chart policy, the VOC engine and the Lilly corpus pack.
LILLY_ORBS = {
    astrology.SE_SUN: 17.0,
    astrology.SE_MOON: 12.5,
    astrology.SE_MERCURY: 7.0,
    astrology.SE_VENUS: 8.0,
    astrology.SE_MARS: 7.5,
    astrology.SE_JUPITER: 12.0,
    astrology.SE_SATURN: 10.0,
}

# The Arabic-tradition table, identical in Sahl (Introduction; Dykes, Works of
# Sahl & Masha'allah p.101), Abu Ma'shar (Abbreviation II.11-12; Dykes,
# Introductions to Traditional Astrology pp.90-91: "one-half ... of the orb of
# each"), al-Qabisi II, al-Biruni (Book of Instruction, Wright tr. §§436-437,
# moiety reading §490), Ibn Ezra (Te'amim I §4.2:12) and Bonatti (Liber
# Astronomiae Tr.3). Lilly's second column repeats it except Mars 7.
ARABIC_ORBS = {
    astrology.SE_SUN: 15.0,
    astrology.SE_MOON: 12.0,
    astrology.SE_MERCURY: 7.0,
    astrology.SE_VENUS: 7.0,
    astrology.SE_MARS: 8.0,
    astrology.SE_JUPITER: 9.0,
    astrology.SE_SATURN: 9.0,
}

# Uranus, Neptune, Pluto beside a traditional table: orb 5° (Houlding,
# Skyscript "Aspect orbs", 2004; Devore, Encyclopedia of Astrology, 1947;
# the Huber school). Chiron shares Pluto's orb row.
MODERN_ORBS = {
    astrology.SE_URANUS: 5.0,
    astrology.SE_NEPTUNE: 5.0,
    astrology.SE_PLUTO: 5.0,
}

# The nodes beside a traditional table: orb 12°, conjunction only (Avelar &
# Ribeiro, On the Heavenly Spheres p.169), so the Moon reaches a node at 12°,
# the eclipse limit of Sahl's and Abu Ma'shar's lunar impediments. Their row
# (both nodes share it) takes the conjunction share only.
NODE_ROW, NODE_ORB = 10, 12.0

# Minor aspects as a fraction of the pair's major allowance: the 12th and 8th
# harmonics after Leo (How to Judge a Nativity p.47: 2° and 4° against 8°) and
# Devore ("minor aspects by one-half"); the 5th and 7th after Addey's orb =
# base / harmonic (Harmonics in Astrology pp.128-130).
MINOR_FRACTIONS = {
    SEMISEXTILE: 0.25, QUINCUNX: 0.25,
    SEMISQUARE: 0.5, SESQUIQUADRATE: 0.5,
    QUINTILE: 0.2, BIQUINTILE: 0.2,
    SEPTILE: 1.0 / 7.0,
}


def source_shares(orbs, scale, node_orb=NODE_ORB):
    """Cells from a per-planet table: ``scale`` 0.5 gives moieties (shares a
    pair adds), 1.0 whole orbs (Morin, whose pair takes the larger). Majors take the
    value, minors their fraction, the nodes their conjunction orb."""
    shares = {}
    for body, orb in {**orbs, **MODERN_ORBS}.items():
        for aspect in PTOLEMAIC:
            shares[body, aspect] = orb * scale
        for aspect, fraction in MINOR_FRACTIONS.items():
            shares[body, aspect] = orb * scale * fraction
    shares[NODE_ROW, CONJ] = node_orb * scale
    return shares


def leo_shares():
    """Alan Leo, How to Judge a Nativity p.47, as shares of a pair.

    Majors 8° between planets, 10° from a luminary, 12° Sun-Moon (shares 4 and
    6); sextile 7°; semisextile and quincunx 2°; semisquare and
    sesquiquadrate 4°. He gives no quintile or septile, so those keep their
    saved values.
    """
    shares = {}
    for body in range(astrology.SE_SUN, astrology.SE_PLUTO + 1):
        luminary = body in (astrology.SE_SUN, astrology.SE_MOON)
        for aspect in (CONJ, SQUARE, TRINE, OPPOSITION):
            shares[body, aspect] = 6.0 if luminary else 4.0
        shares[body, SEXTILE] = 3.5
        for aspect in (SEMISEXTILE, QUINCUNX):
            shares[body, aspect] = 1.0
        for aspect in (SEMISQUARE, SESQUIQUADRATE):
            shares[body, aspect] = 2.0
    return shares


# Morin, Astrologia Gallica 16 ch.13 (Holden tr. pp.75-76): each planet's
# "semidiameter Orbis virtutis" (orb), from its visibility in twilight. Ch.14
# (pp.77-79): planets are platically joined while one lies within the other's
# orb (incomplete) and completely while each lies within the other's: Venus 13
# and Jupiter 8 at 12° apart, "Jupiter is indeed within the orb of Venus and
# conjoined to her, but she is not within the orb of Jupiter". Beyond the
# larger orb neither body reaches the other, so his pair limit is the larger
# whole orb, the complete limit the smaller.
MORIN_ORBS = {
    astrology.SE_SUN: 18.0,
    astrology.SE_MOON: 12.0,
    astrology.SE_MERCURY: 8.0,
    astrology.SE_VENUS: 13.0,
    astrology.SE_MARS: 6.5,
    astrology.SE_JUPITER: 8.0,
    astrology.SE_SATURN: 7.0,
}

# How a preset's pair joins its two cells: shares add; Morin's whole orbs take
# the larger (either body reaching the other). A cell of 0 brings no orb.
ADD, LARGER = "add", "larger"


def _add(a, b):
    return a + b


def _larger(a, b):
    return a if a > b else b


_COMBINE = {ADD: _add, LARGER: _larger}

# id -> (cells, cells are whole orbs, pair rule). Whole orbs also let the
# Inspector tell complete from incomplete.
PRESETS = {
    "lilly": (source_shares(LILLY_ORBS, 0.5), False, ADD),
    "biruni": (source_shares(ARABIC_ORBS, 0.5), False, ADD),
    "leo": (leo_shares(), False, ADD),
    "morin": (source_shares(MORIN_ORBS, 1.0), True, LARGER),
}
LILLY = "lilly"
POLICIES = (CUSTOM, *PRESETS)


def normalize(value):
    return value if value in POLICIES else CUSTOM


def base(options):
    return normalize(getattr(options, "orb_policy", CUSTOM))


def edits(options, policy=None):
    """The user's own cells on a preset, {(row, aspect): value}.

    The Default table keeps its edits in ``options.orbis`` itself (measured
    against ``def_orbis``); each preset keeps its own in ``orb_overrides``.
    """
    stored = (getattr(options, "orb_overrides", None) or {}).get(policy or base(options)) or {}
    cells = {}
    for row, aspects in stored.items():
        for aspect, value in (aspects or {}).items():
            try:
                cells[int(row), int(aspect)] = float(value)
            except (TypeError, ValueError):
                continue
    return cells


def pair_rule(options):
    """The selected preset's pair rule (the Default table adds)."""
    policy = base(options)
    return PRESETS[policy][2] if policy in PRESETS else ADD


def combiner(options):
    """f(a, b) -> a pair's allowance from its two cells. Fetch once per
    matrix, not per cell."""
    return _COMBINE[pair_rule(options)]


def contributions(options):
    """Effective per-body, per-aspect cells (rows like ``options.orbis``)."""
    policy = base(options)
    if policy == CUSTOM:
        return options.orbis
    cells = tuple(sorted(edits(options, policy).items()))
    return _preset_rows(policy, tuple(tuple(row) for row in options.orbis), cells)


@lru_cache(maxsize=32)
def _preset_rows(policy, saved, user_cells):
    rows = [list(row) for row in saved]
    for (body, aspect), value in (*PRESETS[policy][0].items(), *user_cells):
        if 0 <= body < len(rows) and 0 <= aspect < len(rows[body]):
            rows[body][aspect] = value
    return rows


def base_rows(options, policy=None):
    """The base's own cells before the user's edits (for per-cell reset)."""
    policy = policy or base(options)
    if policy == CUSTOM:
        return getattr(options, "def_orbis", options.orbis)
    return _preset_rows(policy, tuple(tuple(row) for row in options.orbis), ())


def contact_is_complete(options, a, b, deviation):
    """Morin's complete contact (each body within the other's whole orb).

    None unless the selected preset's cells are whole orbs."""
    policy = base(options)
    if policy not in PRESETS or not PRESETS[policy][1]:
        return None
    return deviation <= min(a, b)


def lilly_moiety_sum(a, b):
    """Lilly's combined allowance for two bodies, or None outside his table."""
    if a not in LILLY_ORBS or b not in LILLY_ORBS:
        return None
    return (LILLY_ORBS[a] + LILLY_ORBS[b]) / 2.0
