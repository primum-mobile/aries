# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Lunar day, phase, and Vedic tithi.

The Vedic tithi and the only computationally well-defined western "lunar day"
share one arithmetic: floor((Moon_lon - Sun_lon) mod 360 / 12) + 1. This
module returns that single integer under both labels, plus the continuous
phase classifier and tithi metadata (paksha, name, pañcaka group, deity).

Two anchors are supported, chosen by options.lunar_day_anchor:

  true  Day 1 = apparent New Moon (true Sun-Moon conjunction). Variable length
        20-27h. Matches Vedic tithi exactly. Matches the medieval Latin
        lunarium ("Luna prima…xxx") and selenodromion 'observed New Moon'
        anchor. Citations on file: Hephaistion of Thebes, Apotelesmatika
        III.24 ("On which days of the Moon the dreams are true"); Vettius
        Valens, Anthologies III.3; al-Qabīṣī, Introduction IV.23-24 (bust
        doctrine), in Dykes, Choices & Inceptions, Appendix D.

  mean  Day 1 = mean New Moon (constant 29.530588853 / 30 day length).
        Matches Bede's aetas lunae used in ecclesiastical computus
        (De temporum ratione, ch. 11-43). Drifts off true conjunction by up
        to ±14h. Useful for cross-checks against printed church calendars.

  both  Display the true number primary and the mean in parentheses.

Tithi is ayanamsa-invariant because elongation is a difference of longitudes:
(λM - ay) - (λS - ay) ≡ λM - λS. No sidereal toggle is required.
"""

import collections

import astrology
import mtexts
import planets


# --- Constants ----------------------------------------------------------------

TITHI_DEG = 12.0
TITHIS_PER_LUNATION = 30

# Meeus, Astronomical Algorithms, eq. 49.1
SYNODIC_MONTH_DAYS = 29.530588853

# Geocentric mean New Moon 2000-01-06 18:14 UT — Meeus Table 49.A, k=0.
# (True NM for the same lunation was 2000-01-06 18:14 UT, so the mean and true
# coincide closely at this epoch; drift accumulates roughly linearly with k.)
MEAN_NM_REFERENCE_JD = 2451550.25972

ANCHOR_TRUE = 'true'
ANCHOR_MEAN = 'mean'
ANCHOR_BOTH = 'both'
ANCHORS = (ANCHOR_TRUE, ANCHOR_MEAN, ANCHOR_BOTH)


# --- Names tables -------------------------------------------------------------

# Indexed 0..13 for tithi-in-paksha 1..14. The 15th (Pūrṇimā / Amāvāsyā) is
# special-cased in tithi() because it differs between Śukla and Kṛṣṇa pakṣas.
TITHI_NAMES_IAST = (
    'Pratipad', 'Dvitīyā', 'Tṛtīyā', 'Caturthī', 'Pañcamī',
    'Ṣaṣṭhī', 'Saptamī', 'Aṣṭamī', 'Navamī', 'Daśamī',
    'Ekādaśī', 'Dvādaśī', 'Trayodaśī', 'Caturdaśī',
)
TITHI_NAMES_ROMAN = (
    'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
    'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
    'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi',
)

# Pañcaka group: tithi-in-paksha 1..15 → label. Index by [n-1].
PANCAKA = (
    'Nandā', 'Bhadrā', 'Jayā', 'Riktā', 'Pūrṇā',
    'Nandā', 'Bhadrā', 'Jayā', 'Riktā', 'Pūrṇā',
    'Nandā', 'Bhadrā', 'Jayā', 'Riktā', 'Pūrṇā',
)

# Presiding deities (Roman, one word). Cross-checked: BPHS pañcaṅga chapter,
# Muhūrta Cintāmaṇi, Hari Ome tithi-deity list. The 15th differs by paksha and
# is supplied in tithi().
TITHI_DEITIES = (
    'Brahmā', 'Vidhātṛ', 'Viṣṇu', 'Yama', 'Candra',
    'Kārttikeya', 'Indra', 'Vasus', 'Sarpa', 'Dharma',
    'Rudra', 'Āditya', 'Kāma', 'Kālī',
)

# 8-state classical phase classifier. Names follow Lilly / standard English.
PHASE_NAMES_AT_EXACT = ('New Moon', 'First Quarter', 'Full Moon', 'Last Quarter')
PHASE_EXACT_DEG = (0.0, 90.0, 180.0, 270.0)
PHASE_EXACT_EPSILON = 1.0  # within ±1° of a quarter → call it the quarter

PAKSHA_SUKLA_IAST = 'Śukla'
PAKSHA_KRSNA_IAST = 'Kṛṣṇa'
PAKSHA_SUKLA_LETTER = 'S'
PAKSHA_KRSNA_LETTER = 'K'


# --- Dataclasses --------------------------------------------------------------

Tithi = collections.namedtuple(
    'Tithi',
    ['number_in_lunation', 'paksha', 'paksha_letter',
     'number_in_paksha', 'name_iast', 'name_roman',
     'group', 'deity', 'is_purnima', 'is_amavasya'],
)


PhaseInfo = collections.namedtuple(
    'PhaseInfo',
    ['delta_lambda', 'name', 'is_waxing', 'target_name', 'progress'],
)


# --- Core computations --------------------------------------------------------

def elongation(chrt):
    """True Sun → Moon elongation in degrees, 0..360°.

    Returns 0.0 when Moon-Sun longitudes are not available (e.g. partial chart).
    """
    try:
        sun_lon = chrt.planets.planets[astrology.SE_SUN].data[planets.Planet.LONG]
        moon_lon = chrt.planets.planets[astrology.SE_MOON].data[planets.Planet.LONG]
    except (AttributeError, IndexError, KeyError, TypeError):
        return 0.0
    return (moon_lon - sun_lon) % 360.0


def lunation_day_true(chrt):
    """True lunation day 1..30. Identical to the Vedic tithi number."""
    return int(elongation(chrt) // TITHI_DEG) + 1


def lunation_day_mean(chrt):
    """Mean lunation day 1..30 (Bede's aetas lunae)."""
    try:
        jd = float(chrt.time.jd)
    except (AttributeError, TypeError):
        return 1
    n = ((jd - MEAN_NM_REFERENCE_JD) / SYNODIC_MONTH_DAYS) % 1.0
    day = int(n * TITHIS_PER_LUNATION) + 1
    if day > 30:
        day = 30
    return day


def phase(chrt):
    """8-state phase classifier + progress toward next quarter.

    PhaseInfo carries canonical English identity names. User-facing consumers
    localize those names at their presentation boundary; calculation results do
    not change shape or value when the application language changes.
    """
    delta = elongation(chrt)
    name, is_waxing = _phase_name_and_polarity(delta)
    target_name, progress = _phase_progress(delta)
    return PhaseInfo(
        delta_lambda=delta,
        name=name,
        is_waxing=is_waxing,
        target_name=target_name,
        progress=progress,
    )


def tithi(chrt):
    """Compute the current tithi from the chart's true Sun-Moon elongation."""
    n = lunation_day_true(chrt)
    if n <= 15:
        paksha_iast = PAKSHA_SUKLA_IAST
        paksha_letter = PAKSHA_SUKLA_LETTER
        in_paksha = n
    else:
        paksha_iast = PAKSHA_KRSNA_IAST
        paksha_letter = PAKSHA_KRSNA_LETTER
        in_paksha = n - 15

    is_purnima = (n == 15)
    is_amavasya = (n == 30)

    if is_purnima:
        name_iast = 'Pūrṇimā'
        name_roman = 'Purnima'
        deity = 'Viśvadevas'
    elif is_amavasya:
        name_iast = 'Amāvāsyā'
        name_roman = 'Amavasya'
        deity = 'Pitṛs'
    else:
        name_iast = TITHI_NAMES_IAST[in_paksha - 1]
        name_roman = TITHI_NAMES_ROMAN[in_paksha - 1]
        deity = TITHI_DEITIES[in_paksha - 1]

    return Tithi(
        number_in_lunation=n,
        paksha=paksha_iast,
        paksha_letter=paksha_letter,
        number_in_paksha=in_paksha,
        name_iast=name_iast,
        name_roman=name_roman,
        group=PANCAKA[in_paksha - 1],
        deity=deity,
        is_purnima=is_purnima,
        is_amavasya=is_amavasya,
    )


def tithi_end_jd(chrt):
    """JD UT when the current tithi ends, estimated from the current Moon-Sun
    relative angular speed.

    Cheap enough for inspector hover (one arithmetic step, no Swiss calls).
    Accuracy is ~minute-resolution — the relative speed varies smoothly over
    a tithi, so a linear extrapolation across at most ~27h is well within the
    display rounding to HH:MM.

    Returns None if speed data is unavailable or the relative speed is
    non-positive (Moon retrograde relative to Sun — only happens near eclipses
    in extreme librations, but guard against div-by-zero).
    """
    try:
        moon = chrt.planets.planets[astrology.SE_MOON].data
        sun = chrt.planets.planets[astrology.SE_SUN].data
        jd_start = float(chrt.time.jd)
    except (AttributeError, IndexError, KeyError, TypeError):
        return None

    delta = elongation(chrt)
    next_boundary = (int(delta // TITHI_DEG) + 1) * TITHI_DEG
    deg_remaining = next_boundary - delta
    rel_speed = float(moon[planets.Planet.SPLON]) - float(sun[planets.Planet.SPLON])
    if rel_speed <= 0.0:
        return None
    return jd_start + deg_remaining / rel_speed


# --- Internal helpers ---------------------------------------------------------

# Canonical English phase name → mtexts key. The English strings returned by
# _phase_name_and_polarity / _phase_progress are the identity values used for
# polarity logic; user-facing consumers localize them with
# _localize_phase_name() at their display boundary.
_PHASE_NAME_KEYS = {
    'New Moon': 'NewMoon',
    'First Quarter': 'FirstQuarter',
    'Full Moon': 'FullMoon',
    'Last Quarter': 'LastQuarter',
    'Waxing Crescent': 'WaxingCrescent',
    'Waxing Gibbous': 'WaxingGibbous',
    'Waning Gibbous': 'WaningGibbous',
    'Waning Crescent': 'WaningCrescent',
}


def _localize_phase_name(english):
    """Localize a canonical English phase name at serve time.

    The English string stays the identity value used for polarity comparisons
    in _phase_name_and_polarity; only the user-facing display copy is swapped.
    """
    return mtexts.txts.get(_PHASE_NAME_KEYS.get(english, ''), english)


def _phase_name_and_polarity(delta):
    """Return (8-state phase name, is_waxing) for a Δλ in 0..360°.

    Within ±PHASE_EXACT_EPSILON of a quarter (0/90/180/270°) we name the
    exact phase; otherwise the interval label.
    """
    for target, name in zip(PHASE_EXACT_DEG, PHASE_NAMES_AT_EXACT):
        signed = ((delta - target + 180.0) % 360.0) - 180.0
        if abs(signed) <= PHASE_EXACT_EPSILON:
            is_waxing = name in ('New Moon', 'First Quarter') or (
                name == 'Full Moon' and signed < 0.0
            )
            return name, is_waxing

    if delta < 90.0:
        return 'Waxing Crescent', True
    if delta < 180.0:
        return 'Waxing Gibbous', True
    if delta < 270.0:
        return 'Waning Gibbous', False
    return 'Waning Crescent', False


def _phase_progress(delta):
    """Return (next-quarter name, progress 0..1) toward the next quarter."""
    if delta < 90.0:
        return 'First Quarter', delta / 90.0
    if delta < 180.0:
        return 'Full Moon', (delta - 90.0) / 90.0
    if delta < 270.0:
        return 'Last Quarter', (delta - 180.0) / 90.0
    return 'New Moon', (delta - 270.0) / 90.0
