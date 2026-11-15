# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Three explicit lunar void-of-course policies.

No renderer visibility, aspect chooser, or user aspect orb enters this technique.
Exact future contacts use the shared ephemeris crossing solver, not constant
speed extrapolation. Results are immutable and language independent.
"""
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
import math
import threading

import astrology
import common
from aries.astrology.ephemeris_context import EphemerisContext
from aries.astrology.transit_fast import api
from engine import orb_policy

HELLENISTIC, LILLY, MODERN = range(3)
POLICIES = (HELLENISTIC, LILLY, MODERN)
POLICY_KEYS = ("VoidCourseHellenistic", "VoidCourseLilly", "VoidCourseModern")
TRADITIONAL = (astrology.SE_SUN, astrology.SE_MERCURY, astrology.SE_VENUS,
               astrology.SE_MARS, astrology.SE_JUPITER, astrology.SE_SATURN)
MODERN_PLANETS = TRADITIONAL + (astrology.SE_URANUS, astrology.SE_NEPTUNE, astrology.SE_PLUTO)
# Directed longitudes include both dexter and sinister forms.
ASPECTS = (0.0, 60.0, 90.0, 120.0, 180.0, 240.0, 270.0, 300.0)
TIME_EPS = 1e-8  # shared crossing solver precision, in days
# Lilly's own first column (CA I p.107), shared with the chart policy and
# the Lilly corpus pack. Moieties are half these values.
LILLY_ORBS = orb_policy.LILLY_ORBS
# Total family/target-role declaration. These exclusions are doctrinal, never
# a fallback for missing data or a filter derived from visible chart objects.
TARGET_SUPPORT = {
    "traditional_planets": "supported",
    "outer_planets": "modern_only",
    "moon": "unsupported_self_aspect",
    "dynamic_bodies": "unsupported_non_doctrinal_body",
    "nodes": "unsupported_non_planetary_point",
    "angles": "unsupported_non_planetary_point",
    "fortune": "unsupported_non_planetary_point",
    "vertex": "unsupported_non_planetary_point",
    "syzygy": "unsupported_past_event_point",
    "lots": "unsupported_non_planetary_point",
    "outer_ring": "unsupported_separate_sky",
    "fixed_stars": "unsupported_non_planetary_target",
}


@dataclass(frozen=True)
class VoidCourseState:
    policy: int
    is_void: bool | None
    horizon_jd: float | None = None
    contact_jd: float | None = None


def normalize_policy(value):
    return value if type(value) is int and value in POLICIES else HELLENISTIC


def _state(context, jd, body):
    with context.activate():
        flag, values, error = astrology.swe_calc_ut_ex(jd, body, context.flags)
    if flag < 0 or not all(math.isfinite(float(values[i])) for i in (0, 3)):
        raise ValueError(error or "Missing lunar ephemeris")
    return float(values[0]), float(values[3])


def applying_within_moieties(moon, other, body):
    """Current applying (or exactly perfect) Ptolemaic contact, across signs."""
    allowance = (LILLY_ORBS[astrology.SE_MOON] + LILLY_ORBS[body]) / 2.0
    relative_speed = moon[1] - other[1]
    for aspect in ASPECTS:
        residual = (moon[0] - other[0] - aspect + 180.0) % 360.0 - 180.0
        if abs(residual) <= 1e-8:
            return True
        if abs(residual) <= allowance and residual * relative_speed < 0.0:
            return True
    return False


@lru_cache(maxsize=512)
def calculate(jd, policy, context):
    """Evaluate one sky in the supplied zodiac/observer context.

    Four days safely bounds 30 degrees of lunar travel, including topocentric
    parallax. A missing boundary raises instead of certifying an empty interval.
    Future contacts are strictly after now and before the boundary, matching
    the existing corpus lunar-course convention. A contact exact now has
    already perfected; a sign-exit contact belongs to the new sign.
    """
    policy = normalize_policy(policy)
    moon = _state(context, jd, astrology.SE_MOON)
    targets = MODERN_PLANETS if policy == MODERN else TRADITIONAL
    if policy == LILLY:
        active = any(applying_within_moieties(moon, _state(context, jd, body), body)
                     for body in targets)
        return VoidCourseState(policy, not active)
    target_lon = ((moon[0] + 30.0) if policy == HELLENISTIC
                  else (math.floor(moon[0] / 30.0) + 1) * 30.0) % 360.0
    boundaries = api.search_longitude_transits(
        astrology.SE_MOON, jd, jd + 4.0, [target_lon], context=context,
    )
    future = [hit.jd_ut for hit in boundaries if hit.jd_ut > jd]
    if not future:
        raise ValueError("Lunar search did not reach its boundary")
    horizon = min(future)
    bodies = [astrology.SE_MOON, *targets]
    specs = [(0, i, aspect) for i in range(1, len(bodies)) for aspect in ASPECTS]
    hits = api.search_relative_aspects_batch_raw(
        bodies, jd, horizon, specs, context=context,
    )
    contacts = [float(hit[0]) for hit in hits
                if jd + TIME_EPS < float(hit[0]) < horizon - TIME_EPS]
    return VoidCourseState(policy, not bool(contacts), horizon,
                           min(contacts) if contacts else None)


@dataclass(frozen=True)
class VoidCoursePeriod:
    start_jd: float
    end_jd: float


def _contacts(context, targets, start, end, offset=0.0):
    bodies = [astrology.SE_MOON, *targets]
    specs = [(0, i, (aspect + offset) % 360.0)
             for i in range(1, len(bodies)) for aspect in ASPECTS]
    return sorted(float(hit[0]) for hit in api.search_relative_aspects_batch_raw(
        bodies, start, end, specs, context=context,
    ))


def _ingresses(context, start, end):
    hits = api.search_longitude_transits(
        astrology.SE_MOON, start, end, [30.0 * sign for sign in range(12)], context=context,
    )
    return sorted(hit.jd_ut for hit in hits)


def periods(start_jd, end_jd, policy, context):
    """Void intervals whose onset lies in [start_jd, end_jd), exact per policy.

    Each policy's state only becomes void at a perfection (or, for the modern
    sign-exit test, at an ingress into a sign without contacts), so onsets are
    found from exact crossings rather than sampling. Ends are exact too: the
    Hellenistic 30-degree horizon reaching the next contact, the next Lilly
    moiety entry, or the modern sign exit. Agrees with calculate() throughout.
    """
    policy = normalize_policy(policy)
    targets = MODERN_PLANETS if policy == MODERN else TRADITIONAL
    # Padding covers a full lunar sign before and the longest contact gap after.
    lo, hi = start_jd - 3.0, end_jd + 6.0
    contacts = _contacts(context, targets, lo, hi)
    result = []
    if policy == MODERN:
        ingresses = _ingresses(context, lo, hi)
        for previous, ingress in zip(ingresses, ingresses[1:]):
            inside = [c for c in contacts if previous - TIME_EPS <= c < ingress - TIME_EPS]
            onset = inside[-1] if inside else previous
            if start_jd <= onset < end_jd and onset < ingress - TIME_EPS:
                result.append(VoidCoursePeriod(onset, ingress))
    elif policy == HELLENISTIC:
        for contact, following in zip(contacts, contacts[1:]):
            if not start_jd <= contact < end_jd or following - contact <= TIME_EPS:
                continue
            target = (_state(context, following, astrology.SE_MOON)[0] - 30.0) % 360.0
            moon = _state(context, contact, astrology.SE_MOON)[0]
            if (target - moon) % 360.0 > 30.0:
                continue  # under 30 degrees of travel to the next contact
            ends = [hit.jd_ut for hit in api.search_longitude_transits(
                astrology.SE_MOON, contact, following, [target], context=context,
            ) if hit.jd_ut > contact + TIME_EPS]
            if ends:
                result.append(VoidCoursePeriod(contact, min(ends)))
    else:
        entries = []
        for body in targets:
            allowance = (LILLY_ORBS[astrology.SE_MOON] + LILLY_ORBS[body]) / 2.0
            entries.extend(_contacts(context, (body,), lo, hi, -allowance))
        entries.sort()
        for contact in contacts:
            if not start_jd <= contact < end_jd:
                continue
            after = contact + 1e-6
            moon = _state(context, after, astrology.SE_MOON)
            if any(applying_within_moieties(moon, _state(context, after, body), body)
                   for body in targets):
                continue
            ends = [entry for entry in entries if entry > contact + TIME_EPS]
            if ends:
                result.append(VoidCoursePeriod(contact, ends[0]))
    # Simultaneous contacts share one onset.
    unique = {}
    for period in result:
        unique.setdefault(round(period.start_jd * 86400.0), period)
    return [unique[key] for key in sorted(unique)]


@lru_cache(maxsize=256)
def current_period(jd, policy, context):
    """The void period containing ``jd`` (start <= jd < end), or None.

    Onsets are searched four days back, beyond the longest lunar void, so a
    period the Moon is in now is never cut off at the search window.
    """
    for period in periods(jd - 4.0, jd + TIME_EPS, policy, context):
        if period.start_jd <= jd + TIME_EPS and jd < period.end_jd:
            return period
    return None


def period_for_chart(chrt, options=None):
    """The chart's current void period under the selected policy, or None."""
    opts = options if options is not None else chrt.options
    policy = normalize_policy(getattr(opts, "voidcoursepolicy", HELLENISTIC))
    sky = chart_sky(chrt, MODERN_PLANETS if policy == MODERN else TRADITIONAL)
    if sky is None:
        return None
    return current_period(sky[0], policy, sky[1])


def chart_sky(chrt, bodies):
    """(jd, context) when the chart's Moon and ``bodies`` are its own sky.

    Compare every participating body; an unchanged Moon alone does not prove
    that the remaining positions belong to this astronomical sky.
    """
    context = EphemerisContext.for_chart(chrt, ephe_path=common.get_ephe_path())
    jd = float(chrt.time.jd)
    for body in (astrology.SE_MOON, *bodies):
        actual = _state(context, jd, body)[0]
        displayed = float(chrt.get_planet_body(body).data[0])
        if abs((actual - displayed + 180.0) % 360.0 - 180.0) > 1e-5:
            return None
    return jd, context


def for_chart(chrt, options=None):
    """Use the chart's own sky; do not label transformed coordinates as a sky.

    Physical returns/transits and ephemeris progressions work at their actual
    ephemeris epoch. Symbolic directions, composites and harmonic/profected
    positions have no physical future ephemeris and report an unavailable state.
    """
    opts = options if options is not None else chrt.options
    policy = normalize_policy(getattr(opts, "voidcoursepolicy", HELLENISTIC))
    sky = chart_sky(chrt, MODERN_PLANETS if policy == MODERN else TRADITIONAL)
    if sky is None:
        return VoidCourseState(policy, None)
    jd, context = sky
    return calculate(jd, policy, context)


@dataclass(frozen=True)
class LunarContact:
    body: int     # caller's body id
    angle: float  # undirected aspect angle, 0..180
    jd: float


# Solved contacts are a pure function of (targets, context, time), so a time
# step only needs the stretch of time the previous searches have not covered.
# Each window keeps every hit in [start, end]; a query whose own +/- span lies
# inside it is answered by filtering, exactly as a fresh search of that span.
# Extensions overlap by CONTACT_SEAM days and duplicate roots merge.
CONTACT_SEAM = 1e-3
CONTACT_WINDOW_MAX = 30.0  # days kept per window; a far jump restarts it
_CONTACT_WINDOWS: "OrderedDict[tuple, list]" = OrderedDict()
_CONTACT_WINDOWS_LOCK = threading.Lock()


def _contact_search(targets):
    """(body codes, relative-aspect specs, (body, angle) per spec)."""
    bodies, specs, meaning = [astrology.SE_MOON], [], []
    for body, code, shift, angles in targets:
        bodies.append(code)
        for angle in angles:
            for offset in sorted({(angle + shift) % 360.0, (shift - angle) % 360.0}):
                specs.append((0, len(bodies) - 1, offset))
                meaning.append((body, angle))
    return bodies, specs, meaning


def _search_contacts(search, start, end, context):
    bodies, specs, meaning = search
    hits = api.search_relative_aspects_batch_raw(bodies, start, end, specs, context=context)
    return [(float(hit[0]), int(hit[1])) for hit in hits]


def _merge_hits(hits, extra):
    merged = sorted(hits + extra)
    result = []
    for hit in merged:
        if result and result[-1][1] == hit[1] and hit[0] - result[-1][0] < CONTACT_SEAM:
            continue
        result.append(hit)
    return result


def _contact_hits(jd, targets, context, span):
    """Every solved hit in [jd - span, jd + span], reusing prior searches."""
    lo, hi = jd - span, jd + span
    key = (targets, context)
    with _CONTACT_WINDOWS_LOCK:
        window = _CONTACT_WINDOWS.get(key)
        if window is not None:
            _CONTACT_WINDOWS.move_to_end(key)
        if (
            window is None
            or hi < window[0] or lo > window[1]
            or max(hi, window[1]) - min(lo, window[0]) > CONTACT_WINDOW_MAX
        ):
            search = _contact_search(targets)
            window = [lo, hi, _search_contacts(search, lo, hi, context), search]
            _CONTACT_WINDOWS[key] = window
            while len(_CONTACT_WINDOWS) > 16:
                _CONTACT_WINDOWS.popitem(last=False)
        else:
            start, end, hits, search = window
            if lo < start:
                hits = _merge_hits(hits, _search_contacts(search, lo, start + CONTACT_SEAM, context))
                start = lo
            if hi > end:
                hits = _merge_hits(hits, _search_contacts(search, end - CONTACT_SEAM, hi, context))
                end = hi
            window[:3] = [start, end, hits]
        meaning = window[3][2]
        return [LunarContact(*meaning[index], hit_jd)
                for hit_jd, index in window[2] if lo <= hit_jd <= hi]


@lru_cache(maxsize=256)
def lunar_contacts(jd, targets, context, span=3.0):
    """Most recent and next exact Moon contacts within ``span`` days.

    ``targets`` holds (body id, ephemeris code, longitude shift, aspect
    angles); the shift places a derived point such as the south node (its
    north node + 180). Order is by solved perfection time, not current orb:
    a retrograde body can perfect before a nearer one moving away. A contact
    exact now has perfected and is the last one, matching calculate().
    """
    contacts = _contact_hits(float(jd), targets, context, float(span))
    past = [c for c in contacts if c.jd <= jd + TIME_EPS]
    future = [c for c in contacts if c.jd > jd + TIME_EPS]
    return (max(past, key=lambda c: c.jd) if past else None,
            min(future, key=lambda c: c.jd) if future else None)


def display_text(chrt, options=None):
    """Shared inspector, hover and overlay label, present only while void.

    Like stations and the Lord of the Year, the signal appears only when the
    event is the case; inactive or unavailable states produce no row.
    """
    import mtexts
    try:
        result = for_chart(chrt, options)
    except (AttributeError, IndexError, KeyError, TypeError, ValueError, RuntimeError):
        # Partial or unavailable ephemerides must not certify a void interval
        # or break the rest of the inspector/chart payload.
        return None
    return mtexts.txts["VoidCourseActive"] if result.is_void else None
