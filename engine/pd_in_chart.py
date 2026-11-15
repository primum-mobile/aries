# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Wx-free Primary-Directions-in-Chart computation.

The celestial "PDs in Chart" surface is Morinus' directed-significator chart:
primary motion turns the sky by the signed arc, every significator keeps its
natal mundane place, and the outer ring shows the zodiac degree now standing
there -- the zero-latitude promissor that perfects on that significator at the
arc.  The degree comes from the PD system's own row equation
(``directed_significator_longitude``), the one function the directed speculum
also reads, so the wheel, the speculum and the PD list agree by construction.
The chart is cast at the turned RAMC, so its houses are the directed angles.

In the ascensional (mundane) presentation the same chart shows the natal sky
turned by the arc (``natal_sky``): promissors carried by diurnal motion past
significators fixed in their houses.

Terrestrial PDs-in-Chart keep the legacy mundane operator.  Extracted from
``primdirslistwnd.py`` (PrimDirsListWnd.calc) so wx and Tauri share one
implementation.
"""
import copy
import math

import astrology
import chart_bodies
import chart
import fortune
import houses
import pdsinchart
import planets
import primdirs
import util
from engine import pd_row_geometry

TROPICAL_YEAR_DAYS = 365.2421904
PD_DIRECTION_EXACT_TOLERANCE_DEGREES = 1.0e-8

_PLACIDIAN_POSITION_SYSTEMS = (
    primdirs.PrimDirs.PLACIDIANSEMIARC,
    primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE,
    primdirs.PrimDirs.TOPOCENTRIC,
)


class _CircularInverseError(ValueError):
    def __init__(self, message, best_longitude, best_error):
        super().__init__(message)
        self.best_longitude = util.normalize(float(best_longitude))
        self.best_error = math.fabs(float(best_error))


def _set_planet_position(target, lon, lat, pdchart, ayanamsha_offset=None):
    """Replace one PD-chart body's ecliptic point and rebuild its speculums.

    ``ayanamsha_offset`` names the zodiac frame of ``lon`` (default: the PD
    chart's own).
    """
    if ayanamsha_offset is None:
        ayanamsha_offset = getattr(pdchart, "ayanamsha_offset", 0.0)
    ra, decl, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), ayanamsha_offset),
        float(lat), 1.0, -pdchart.obl[0],
    )
    target.data = (
        util.normalize(float(lon)), float(lat),
        target.data[planets.Planet.DIST],
        target.data[planets.Planet.SPLON],
        target.data[planets.Planet.SPLAT],
        target.data[planets.Planet.SPDIST],
    )
    target.dataEqu = (
        ra, decl,
        target.dataEqu[planets.Planet.DISTEQU],
        target.dataEqu[planets.Planet.SPRAEQU],
        target.dataEqu[planets.Planet.SPDECLEQU],
        target.dataEqu[planets.Planet.SPDISTEQU],
    )
    target.speculums = []
    target.computePlacidianSpeculum(pdchart.place.lat, pdchart.houses.ascmc2)
    target.computeRegiomontanSpeculum(
        pdchart.place.lat, pdchart.houses.ascmc2, pdchart.raequasc,
    )


def _set_fortune_position(target, lon, lat, pdchart, ayanamsha_offset=None):
    """Replace one PD-chart Fortuna point and rebuild both speculums."""
    if ayanamsha_offset is None:
        ayanamsha_offset = getattr(pdchart, "ayanamsha_offset", 0.0)
    ra, decl, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), ayanamsha_offset),
        float(lat), 1.0, -pdchart.obl[0],
    )
    target.recalcForMundaneChart(
        util.normalize(float(lon)), float(lat), ra, decl,
        pdchart.houses.ascmc2, pdchart.raequasc, pdchart.obl[0],
        pdchart.place.lat,
    )


def _decimal_hours_to_hms(value):
    """Split decimal hours without truncating the symbolic frame's seconds."""
    hours_value = math.fabs(float(value))
    hour = int(hours_value)
    minute_value = (hours_value - hour) * 60.0
    minute = int(minute_value)
    second = (minute_value - minute) * 60.0
    return hour, minute, second


def _solve_circular_longitude(evaluate, target, guess, *, dense_fallback=False):
    """Solve ``evaluate(lon) == target`` on a circular, piecewise-smooth map."""
    target = util.normalize(float(target))
    longitude = util.normalize(float(guess))
    epsilon = 0.0001
    best_longitude = longitude
    best_error = math.inf
    for _iteration in range(24):
        value = evaluate(longitude)
        error = _signed_angle_delta(value, target)
        if math.fabs(error) < best_error:
            best_error = math.fabs(error)
            best_longitude = longitude
        if math.fabs(error) < 1.0e-10:
            return util.normalize(longitude)
        ahead = evaluate(longitude + epsilon)
        behind = evaluate(longitude - epsilon)
        derivative = _signed_angle_delta(ahead, behind) / (2.0 * epsilon)
        if not math.isfinite(derivative) or math.fabs(derivative) < 1.0e-8:
            break
        step = max(-30.0, min(30.0, error / derivative))
        accepted = False
        for _backtrack in range(8):
            candidate = util.normalize(longitude - step)
            candidate_error = _signed_angle_delta(evaluate(candidate), target)
            if math.fabs(candidate_error) < math.fabs(error):
                longitude = candidate
                accepted = True
                break
            step /= 2.0
        if not accepted:
            break
    if best_error <= 1.0e-7:
        return util.normalize(best_longitude)

    # Near the polar limit the ecliptic-foot map can become flat enough for a
    # local Newton step to leave the correct branch.  Search the circle only as
    # a rare fallback, then bisect genuine zero crossings.  The signed circular
    # residual jumps by ~360 degrees at its own wrap; reject that discontinuity
    # instead of mistaking it for a root.
    def scan_roots(step_degrees):
        nonlocal best_error, best_longitude
        roots = []
        left = util.normalize(float(guess))
        left_error = _signed_angle_delta(evaluate(left), target)
        steps = int(math.ceil(360.0 / float(step_degrees)))
        for step_index in range(1, steps + 1):
            offset = min(float(step_index) * float(step_degrees), 360.0)
            right = util.normalize(float(guess) + float(offset))
            right_error = _signed_angle_delta(evaluate(right), target)
            if math.fabs(right_error) < best_error:
                best_error = math.fabs(right_error)
                best_longitude = right
            if math.fabs(right_error) < 1.0e-10:
                roots.append(right)
            elif (
                left_error * right_error < 0.0
                and math.fabs(right_error - left_error) < 180.0
            ):
                low = left
                high = right
                low_error = left_error
                candidate = None
                for _iteration in range(60):
                    span = _signed_angle_delta(high, low)
                    middle = util.normalize(low + span / 2.0)
                    middle_error = _signed_angle_delta(evaluate(middle), target)
                    if math.fabs(middle_error) < 1.0e-10:
                        candidate = middle
                        break
                    if low_error * middle_error <= 0.0:
                        high = middle
                    else:
                        low = middle
                        low_error = middle_error
                if candidate is None:
                    candidate = util.normalize(
                        low + _signed_angle_delta(high, low) / 2.0
                    )
                candidate_error = math.fabs(
                    _signed_angle_delta(evaluate(candidate), target)
                )
                if candidate_error < best_error:
                    best_error = candidate_error
                    best_longitude = candidate
                if candidate_error <= 1.0e-7:
                    roots.append(candidate)
            left = right
            left_error = right_error
        return roots

    roots = scan_roots(5)
    if not roots:
        roots = scan_roots(1)
    if not roots and dense_fallback:
        roots = scan_roots(0.05)
    if roots:
        return min(
            roots,
            key=lambda candidate: math.fabs(_signed_angle_delta(candidate, guess)),
        )
    raise _CircularInverseError(
        "primary-direction ecliptic-foot inverse did not converge",
        best_longitude,
        best_error,
    )


def _signed_angle_delta(value, target):
    return ((float(value) - float(target) + 180.0) % 360.0) - 180.0


def _rotate_equatorial_ray(lon, lat, signed_arc, radix):
    """Apply primary motion to a real sky ray: RA -= arc, decl fixed."""
    ra, decl, _distance = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), getattr(radix, "ayanamsha_offset", 0.0)),
        float(lat),
        1.0,
        -radix.obl[0],
    )
    directed_ra = util.normalize(float(ra) - float(signed_arc))
    tropical_lon, directed_lat, _distance = astrology.swe_cotrans(
        directed_ra, float(decl), 1.0, radix.obl[0],
    )
    longitude = util.normalize(
        float(tropical_lon) - getattr(radix, "ayanamsha_offset", 0.0)
    )
    return longitude, float(directed_lat), directed_ra, float(decl)


def _event_int(event, *names, default=None):
    for name in names:
        if name in event and event.get(name) is not None:
            try:
                return int(event.get(name))
            except (TypeError, ValueError):
                return default
    return default


def _solve_unwrapped_row_longitude(evaluate, target_raw, guess):
    """Invert one continuous branch of a raw PD row equation.

    Ordinary rows normally converge in a few Newton iterations.  Near polar
    branch folds, however, the local derivative can flatten or jump across an
    undefined interval.  The fallback walks the complete longitude circle,
    rejects the artificial 360-degree residual wrap, and bisects only genuine
    finite crossings.  The validated root nearest the trajectory guess is the
    deterministic branch policy.
    """
    target_raw = float(target_raw)
    longitude = util.normalize(float(guess))
    epsilon = 0.0001
    best_longitude = longitude
    best_error = math.inf

    def residual(candidate):
        raw = evaluate(candidate)
        if raw is None or not math.isfinite(float(raw)):
            raise ValueError("primary-direction row has no finite ecliptic-foot coordinate")
        unwrapped = float(raw) + 360.0 * round((target_raw - float(raw)) / 360.0)
        return unwrapped - target_raw

    for _iteration in range(24):
        try:
            error = residual(longitude)
        except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
            break
        if math.fabs(error) < best_error:
            best_error = math.fabs(error)
            best_longitude = longitude
        if math.fabs(error) < 1.0e-10:
            return util.normalize(longitude)
        try:
            derivative = (
                residual(longitude + epsilon) - residual(longitude - epsilon)
            ) / (2.0 * epsilon)
        except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
            break
        if not math.isfinite(derivative) or math.fabs(derivative) < 1.0e-8:
            break
        step = max(-30.0, min(30.0, error / derivative))
        longitude = util.normalize(longitude - step)
    if best_error <= 1.0e-7:
        return util.normalize(best_longitude)

    def scan_roots(step_degrees):
        nonlocal best_error, best_longitude
        roots = []
        left_longitude = float(guess)
        try:
            left_error = residual(left_longitude)
        except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
            left_error = None
        steps = int(math.ceil(360.0 / float(step_degrees)))
        for step_index in range(1, steps + 1):
            offset = min(float(step_index) * float(step_degrees), 360.0)
            right_longitude = float(guess) + offset
            try:
                right_error = residual(right_longitude)
            except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
                left_longitude = right_longitude
                left_error = None
                continue
            if math.fabs(right_error) < best_error:
                best_error = math.fabs(right_error)
                best_longitude = util.normalize(right_longitude)
            if math.fabs(right_error) < 1.0e-10:
                roots.append(util.normalize(right_longitude))
            elif (
                left_error is not None
                and left_error * right_error < 0.0
                and math.fabs(right_error - left_error) < 180.0
            ):
                low = left_longitude
                high = right_longitude
                low_error = left_error
                candidate = None
                for _iteration in range(64):
                    middle = (low + high) / 2.0
                    try:
                        middle_error = residual(middle)
                    except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
                        candidate = None
                        break
                    if math.fabs(middle_error) < 1.0e-10:
                        candidate = middle
                        break
                    if low_error * middle_error <= 0.0:
                        high = middle
                    else:
                        low = middle
                        low_error = middle_error
                if candidate is None and high - low <= float(step_degrees):
                    candidate = (low + high) / 2.0
                if candidate is not None:
                    try:
                        candidate_error = math.fabs(residual(candidate))
                    except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
                        candidate_error = math.inf
                    if candidate_error < best_error:
                        best_error = candidate_error
                        best_longitude = util.normalize(candidate)
                    if candidate_error <= 1.0e-7:
                        roots.append(util.normalize(candidate))
            left_longitude = right_longitude
            left_error = right_error
        return roots

    roots = scan_roots(2.0)
    if not roots:
        roots = scan_roots(0.25)
    if roots:
        return min(
            roots,
            key=lambda candidate: math.fabs(
                _signed_angle_delta(candidate, guess)
            ),
        )
    if best_error <= 1.0e-7:
        return util.normalize(best_longitude)
    raise ValueError("selected primary-direction row projection did not converge")


def _selected_event_id(event):
    """Build a stable identity from immutable selected-row provenance."""
    if not isinstance(event, dict):
        return None
    supplied = event.get("eventId", event.get("event_id"))
    if supplied is not None and str(supplied).strip():
        return str(supplied)

    def token(value):
        if value is None:
            return "-"
        if isinstance(value, float):
            return format(value, ".17g")
        return str(value).replace("%", "%25").replace("|", "%7C")

    return "|".join((
        "pd-angle-v1",
        token(event.get("system")),
        token(event.get("domain")),
        token(event.get("prom")),
        token(event.get("promDynamicKey")),
        token(event.get("promasp")),
        token(event.get("promaspOffset", event.get("promasp_offset"))),
        token(event.get("sig", event.get("sigPoint"))),
        token(event.get("sigDynamicKey")),
        token(event.get("sigasp")),
        token(event.get("sigaspOffset", event.get("sigasp_offset"))),
        "D" if bool(event.get("direct", True)) else "C",
        token(event.get("arc")),
        token(event.get("time", event.get("jd"))),
    ))


def build_pd_direction_state(event, current_signed_arc, *, event_label=None):
    """Return immutable selected-row phase truth for any PD-in-chart row.

    This state is deliberately independent of the optional visual event
    overlay.  A row can therefore remain applying/exact/separating even when
    its latitude or native coordinate cannot be represented as literal glyph
    overlap.  Direct and Converse use the same signed equation.
    """
    if not isinstance(event, dict):
        return None
    try:
        current_signed = float(current_signed_arc)
        exact_arc = math.fabs(float(event.get("arc")))
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(current_signed) or not math.isfinite(exact_arc):
        return None

    direct = bool(event.get("direct", True))
    exact_signed = exact_arc if direct else -exact_arc
    tolerance = PD_DIRECTION_EXACT_TOLERANCE_DEGREES
    # A non-zero cursor on the opposite semantic branch is contradictory, not
    # a valid before/after state.  Crossing signed zero itself remains valid.
    if direct and current_signed < -tolerance:
        return None
    if not direct and current_signed > tolerance:
        return None
    if exact_arc <= tolerance and math.fabs(current_signed) > tolerance:
        return None

    event_jd = event.get("time", event.get("jd"))
    if event_jd is not None:
        try:
            event_jd = float(event_jd)
        except (TypeError, ValueError, OverflowError):
            return None
        if not math.isfinite(event_jd):
            return None

    event_id = _selected_event_id(event)
    if event_id is None:
        return None
    remaining_signed = exact_signed - current_signed
    exact_now = math.fabs(remaining_signed) <= tolerance
    if exact_now:
        phase = "exact"
    else:
        phase_product = remaining_signed * exact_signed
        if phase_product > 0.0:
            phase = "applying"
        elif phase_product < 0.0:
            phase = "separating"
        else:
            return None

    domain = event.get("domain")
    if domain not in ("zodiacal", "mundane"):
        domain = "mundane" if bool(event.get("mundane", False)) else "zodiacal"
    system = _event_int(event, "system")
    label = event_label if event_label is not None else event.get("eventLabel")
    label = str(label or event.get("eventKind") or "direction").strip()
    return {
        "schemaVersion": 1,
        "eventId": event_id,
        "eventKind": str(event.get("eventKind") or "direction"),
        "domain": domain,
        "system": system,
        "direction": "direct" if direct else "converse",
        "eventJd": event_jd,
        "eventLabel": label,
        "exactArcDegrees": exact_arc,
        "exactArcDegreesSigned": exact_signed,
        "currentArcDegreesSigned": current_signed,
        "remainingArcDegreesSigned": remaining_signed,
        "remainingArcDegrees": math.fabs(remaining_signed),
        "exactNow": exact_now,
        "phase": phase,
    }


def attach_pd_direction_state(pdchart, event, current_signed_arc, *, event_label=None):
    """Stamp generic selected-row truth on one projected chart."""
    state = build_pd_direction_state(
        event,
        current_signed_arc,
        event_label=event_label,
    )
    pdchart._pd_direction_state = state
    return state


def chart_options(options):
    """Return an options view whose houses belong to the selected PD system.

    PDs-in-Chart is a direction surface, so its P/R/C/T geometry follows
    ``primarydir`` rather than the house system currently drawn on the radix.
    Keep the global options object untouched: the derived chart retains this
    shallow snapshot as its own construction contract.
    """
    pd_options = copy.copy(options)
    hsys = primdirs.PrimDirs.house_system_for_primarydir(
        getattr(options, "primarydir", None)
    )
    if hsys is not None:
        pd_options.hsys = hsys
        pd_options.housesystem = True
    return pd_options


def event_jd_for_display_datetime(radix, when):
    """Convert a real local PD cursor datetime to its absolute Julian day.

    PD list dates are displayed in the radix civil zone in the Tauri app.  The
    old stepper treated its date fields as raw UT; rebuilding through
    ``chart.Time`` keeps the visible cursor and the represented instant aligned.
    """
    rt = radix.time
    tim = chart.Time(
        int(when.year), int(when.month), int(when.day),
        int(when.hour), int(when.minute), int(when.second),
        bool(rt.bc), rt.cal, rt.zt, bool(rt.plus), int(rt.zh), int(rt.zm),
        bool(rt.daylightsaving), radix.place, False,
        tzid=getattr(rt, "tzid", ""),
        tzauto=bool(getattr(rt, "tzauto", False)),
    )
    return float(tim.jd)


def _sun_key_position(radix, jd, key):
    sun = planets.Planet(float(jd), astrology.SE_SUN, astrology.SEFLG_SWIEPH)
    if key == primdirs.PrimDirs.TRUESOLARECLIPTICALARC:
        return float(sun.data[planets.Planet.LONG])
    return float(sun.dataEqu[planets.Planet.RAEQU])


def _birth_solar_degrees_per_year(radix, options):
    """Birth-day solar key rate, matching the legacy PD chart stepper."""
    key = int(getattr(options, "pdkeyd", primdirs.PrimDirs.BIRTHDAYSOLAREQUATORIALARC))
    y, m, d = int(radix.time.year), int(radix.time.month), int(radix.time.day)
    yn, mn, dn = util.incrDay(y, m, d)
    ti1 = chart.Time(
        y, m, d, 0, 0, 0, False, radix.time.cal, chart.Time.LOCALMEAN,
        True, 0, 0, False, radix.place, False,
    )
    ti2 = chart.Time(
        yn, mn, dn, 0, 0, 0, False, radix.time.cal, chart.Time.LOCALMEAN,
        True, 0, 0, False, radix.place, False,
    )
    p1 = _sun_key_position(radix, ti1.jd, key)
    p2 = _sun_key_position(radix, ti2.jd, key)
    return abs(((p2 - p1 + 180.0) % 360.0) - 180.0)


def arc_for_event_jd(radix, event_jd, options, *, direct=True):
    """Return the unsigned PD arc for a real signified event instant.

    This is the wx-free inverse of ``PDsInChartStepperDlg.calcTime``.  Static
    keys and birth-solar keys are linear; true-solar keys read the Sun at the
    symbolic ephemeris day.  Converse uses the regressive Sun only when the
    existing ``useregressive`` option requests it, exactly as legacy Morinus.
    """
    age_years = max(0.0, (float(event_jd) - float(radix.time.jd)) / TROPICAL_YEAR_DAYS)
    if not bool(getattr(options, "pdkeydyn", False)):
        key = int(getattr(options, "pdkeys", primdirs.PrimDirs.NAIBOD))
        if key == primdirs.PrimDirs.CUSTOMER:
            degrees_per_year = (
                float(getattr(options, "pdkeydeg", 0.0))
                + float(getattr(options, "pdkeymin", 0.0)) / 60.0
                + float(getattr(options, "pdkeysec", 0.0)) / 3600.0
            )
            return max(0.0, age_years * degrees_per_year)
        years_per_degree = float(primdirs.PrimDirs.staticData[key][primdirs.PrimDirs.COEFF])
        return max(0.0, age_years / years_per_degree) if years_per_degree > 0.0 else 0.0

    key = int(getattr(options, "pdkeyd", primdirs.PrimDirs.BIRTHDAYSOLAREQUATORIALARC))
    if key in (
        primdirs.PrimDirs.TRUESOLAREQUATORIALARC,
        primdirs.PrimDirs.TRUESOLARECLIPTICALARC,
    ):
        regressive = (not bool(direct)) and bool(getattr(options, "useregressive", False))
        symbolic_jd = float(radix.time.jd) + (-age_years if regressive else age_years)
        natal = _sun_key_position(radix, radix.time.jd, key)
        directed = _sun_key_position(radix, symbolic_jd, key)
        return abs(((directed - natal + 180.0) % 360.0) - 180.0)

    return max(0.0, age_years * _birth_solar_degrees_per_year(radix, options))


def compute_terrestrial_pd_chart(radix, da, options):
    """Compute a terrestrial (mundane) PD-in-chart from signed arc *da* (degrees).

    Mirrors the terrestrial branch of PrimDirsListWnd.calc()
    (primdirslistwnd.py:35-58).
    """
    pd_options = chart_options(options)
    pdinch = pdsinchart.PDsInChart(radix, da)
    pdh, pdm, pds_ = _decimal_hours_to_hms(pdinch.tz)
    cal = chart.Time.GREGORIAN
    if radix.time.cal == chart.Time.JULIAN:
        cal = chart.Time.JULIAN
    tim = chart.Time(pdinch.yz, pdinch.mz, pdinch.dz, pdh, pdm, pds_,
                     radix.time.bc, cal, chart.Time.GREENWICH,
                     True, 0, 0, False, radix.place, False)
    if pd_options.pdinchartterrsecmotion:
        pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
    else:
        pdchart = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
        raequasc, declequasc, dist = astrology.swe_cotrans(
            util.to_tropical_lon(pdchart.houses.ascmc[houses.Houses.EQUASC], pdchart.ayanamsha_offset),
            0.0, 1.0, -radix.obl[0],
        )
        pdchart.planets.calcMundaneWithoutSM(da, radix.obl[0], pdchart.place.lat, pdchart.houses.ascmc2, raequasc, pdchart.ayanamsha_offset)
    natal_fortune = pd_positions(radix, options).fortune.fortune
    pdchart.fortune.recalcForMundaneChart(natal_fortune[fortune.Fortune.LON], natal_fortune[fortune.Fortune.LAT], natal_fortune[fortune.Fortune.RA], natal_fortune[fortune.Fortune.DECL], pdchart.houses.ascmc2, pdchart.raequasc, pdchart.obl[0], pdchart.place.lat)
    pdchart._pd_arc_signed = float(da)
    pdchart._pd_arc_abs = math.fabs(float(da))
    pdchart._pd_direct = (da >= 0.0)
    pdchart._pd_exact_event = None
    pdchart._pd_event_overlay = None
    requested_system = int(getattr(pd_options, "primarydir", -1))
    coordinate_by_system = {
        primdirs.PrimDirs.PLACIDIANSEMIARC: "PMP",
        primdirs.PrimDirs.REGIOMONTAN: "RMP",
        primdirs.PrimDirs.CAMPANIAN: "CMP",
        primdirs.PrimDirs.TOPOCENTRIC: "PMP",
    }
    companion_system = (
        primdirs.PrimDirs.PLACIDIANSEMIARC
        if requested_system == primdirs.PrimDirs.TOPOCENTRIC
        else requested_system
    )
    terrestrial_system_supported = (
        requested_system != primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE
    )
    if not terrestrial_system_supported:
        companion_system = None
    chart_secondary_motion = bool(pd_options.pdinchartterrsecmotion)
    table_secondary_motion = bool(getattr(pd_options, "pdsecmotion", False))
    row_native_eligible = (
        terrestrial_system_supported
        and not chart_secondary_motion
        and not table_secondary_motion
    )
    pdchart._pd_projection_domain = "terrestrial"
    if not terrestrial_system_supported:
        pdchart._pd_projection_operator = "unsupported-zodiacal-only-system"
    elif chart_secondary_motion:
        pdchart._pd_projection_operator = "symbolic-time-ephemeris-motion"
    else:
        pdchart._pd_projection_operator = "frozen-declination-primary-motion"
    pdchart._pd_projection_native_coordinate = coordinate_by_system.get(
        requested_system,
    )
    pdchart._pd_projection_requested_system = requested_system
    pdchart._pd_projection_companion_system = companion_system
    # Keep the established field while naming both independent controls
    # explicitly: terrestrial chart-display secondary motion is not the PD
    # table's Moon-secondary-motion calculation option.
    pdchart._pd_projection_secondary_motion = chart_secondary_motion
    pdchart._pd_projection_chart_secondary_motion = chart_secondary_motion
    pdchart._pd_projection_table_moon_secondary_motion = table_secondary_motion
    pdchart._pd_projection_row_native_eligible = row_native_eligible
    pdchart._pd_projection_row_native = False
    pdchart._pd_projection_exact = False
    pdchart._pd_projection_exact_scope = (
        "ordinary-mundane-body-aspect-angle-rows"
        if row_native_eligible
        else None
    )
    pdchart._pd_projection_supported_event_kinds = (
        (
            "conjunction",
            "aspect",
            "angle-contact",
        )
        if terrestrial_system_supported
        else ()
    )
    pdchart._pd_projection_supported_point_families = (
        ("standard-bodies", "angles")
        if terrestrial_system_supported
        else ()
    )
    pdchart._pd_projection_deferred_families = (
        "mundane-fortune",
        "dynamic-points",
        "antiscia",
        "midpoints",
        "parallels",
        "rapt-parallels",
        "moon-table-secondary-motion",
        "placidus-under-pole-zodiacal-only",
    )
    return pdchart


def project_system_ecliptic_point(radix, longitude, latitude, signed_arc, system):
    """Project a rotated sky point through the system's circle of position.

    The ecliptic representative is the zero-latitude receiving point whose
    native directional arc from the rotated point is zero. This is one rule
    for the whole sky, independent of any selected row or receiving planet.
    Longitude is in the radix zodiac; equatorial rotation keeps declination.
    """
    lon, lat, _ra, _decl = _rotate_equatorial_ray(
        longitude, latitude, signed_arc, radix,
    )
    return _solve_circular_longitude(
        lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            system, radix, lon, lat, candidate, 0.0,
        ),
        0.0, lon,
    )


def directed_significator_longitude(radix, longitude, latitude, signed_arc, system):
    """The zodiac degree that a significator is directed to at ``signed_arc``.

    Morinus' PDs-in-Chart Positions: the significator keeps its natal mundane
    place while primary motion turns the sky. The directed degree is the
    zero-latitude promissor whose native row arc to the significator equals
    the signed arc (Direct positive), so a radix promissor standing there
    perfects now. ``latitude`` is the significator ray's latitude under the
    active latitude rule. Raises ``ValueError`` where no finite root exists.
    """
    return _solve_unwrapped_row_longitude(
        lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            system, radix, candidate, 0.0, longitude, latitude,
        ),
        float(signed_arc),
        util.normalize(float(longitude) + float(signed_arc)),
    )




def significator_ray_latitude(options, latitude):
    """The significator latitude the PD list uses for zodiacal rows."""
    with_latitude = getattr(options, "subzodiacal", primdirs.PrimDirs.SZNEITHER) in (
        primdirs.PrimDirs.SZSIGNIFICATOR, primdirs.PrimDirs.SZBOTH,
    )
    return float(latitude or 0.0) if with_latitude else 0.0


def directed_significator_point(radix, longitude, latitude, signed_arc, options):
    """One significator's directed zodiac degree under the active PD settings.

    The single source for the PDs-in-Chart outer ring and the directed
    speculum: the active ``primarydir`` row equation, the PD list's
    significator-latitude rule, Direct positive.  ``None`` where the row has
    no finite ecliptic root (polar points).
    """
    system = int(getattr(options, "primarydir", primdirs.PrimDirs.PLACIDIANSEMIARC))
    if system not in pd_row_geometry.SUPPORTED_ECLIPTIC_FOOT_SYSTEMS:
        return None
    try:
        return directed_significator_longitude(
            radix,
            float(longitude),
            significator_ray_latitude(options, latitude),
            float(signed_arc),
            system,
        )
    except ValueError:
        return None


def radix_in_pd_houses(radix, options):
    """The radix seen through the PD system's own house geometry (P/R/C/T).

    The PD list directs these cusps as significators and the turned chart draws
    them, so the directed speculum lists the same houses.  Lots built from a
    cusp are rebuilt on them too, so they match the Lots the PD engine directs.
    Returns the radix itself when its displayed system already is the PD system's.
    """
    pd_houses = primdirs.PrimDirs.pd_system_houses(radix, options)
    if pd_houses is radix.houses:
        return radix
    view = copy.copy(radix)
    view.houses = pd_houses
    if getattr(radix, "parts", None) is not None:
        view.calcArabicParts()
    return view


# Options that shape the PD view of a radix (houses, positions, Fortuna).
_PD_RADIX_OPTION_FIELDS = (
    "primarydir", "ayanamsha", "lotoffortune", "usedaynightorb", "prenatal_eclipse_mode",
)


def _radix_body_flags(radix, options):
    """(topocentric, mean node) the radix bodies were cast with."""
    built = getattr(radix, "options", None) or options
    return bool(getattr(built, "topocentric", False)), bool(getattr(built, "meannode", True))


def _pd_view_key(radix, options):
    """Cache identity of a PD view: resolved flags, so the global options and a
    PD chart's ``chart_options`` copy of them share one cached view."""
    return (
        _radix_body_flags(radix, options),
        primdirs.PrimDirs.pd_meannode(options),
        primdirs.PrimDirs.pd_topocentric(options),
    ) + tuple(getattr(options, name, None) for name in _PD_RADIX_OPTION_FIELDS)


def _pd_positions_differ(radix, options):
    """Whether the radix bodies differ from the ones the PD engine directs.

    Both follow the chart's node and Moon parallax correction; they differ
    only when ``options`` is not what the radix was cast with (a preview).
    """
    topocentric, meannode = _radix_body_flags(radix, options)
    return (
        topocentric != primdirs.PrimDirs.pd_topocentric(options)
        or meannode != primdirs.PrimDirs.pd_meannode(options)
    )


def _refresh_pd_positions(view, options):
    primdirs.PrimDirs._refresh_chart_pd_dependencies(
        _PdRefresh(chart=view, options=options),
    )


def pd_positions(radix, options):
    """The radix with the bodies the PD engine directs (``options``' node and
    Moon parallax correction).

    Houses stay the radix's own; ``pd_radix`` adds the PD system's houses.
    Returns the radix itself when its bodies already are the PD engine's.
    Cached on the radix object like ``pd_radix``.
    """
    if not _pd_positions_differ(radix, options):
        return radix
    key = _pd_view_key(radix, options)
    cached = radix.__dict__.get("_pd_positions_view")
    if cached is not None and cached[0] == key:
        return cached[1]
    _cache_prenatal_points(radix, options)
    view = copy.copy(radix)
    _refresh_pd_positions(view, options)
    view.__dict__.pop("_pd_positions_view", None)
    view.__dict__.pop("_pd_radix_view", None)
    radix._pd_positions_view = (key, view)
    return view


def pd_radix(radix, options):
    """The radix as the PD list sees it: PD-system houses and PD positions.

    The PD engine directs the bodies of ``options``' node and Moon parallax
    correction; when those differ from the radix cast (a settings preview) the
    radix is re-read through the engine's own refresh on a copy.  Otherwise
    the radix bodies are the list's already.  Cached on the radix object (a chart edit replaces that
    object), so stepping reuses one view.
    """
    key = _pd_view_key(radix, options)
    cached = radix.__dict__.get("_pd_radix_view")
    if cached is not None and cached[0] == key:
        return cached[1]
    _cache_prenatal_points(radix, options)
    view = radix_in_pd_houses(radix, options)
    if _pd_positions_differ(radix, options):
        if view is radix:
            view = copy.copy(radix)
        _refresh_pd_positions(view, options)
    view.__dict__.pop("_pd_radix_view", None)
    view.__dict__.pop("_pd_positions_view", None)
    radix._pd_radix_view = (key, view)
    return view


def _cache_prenatal_points(radix, options):
    """Compute the radix Syzygy and prenatal eclipse once, on the radix.

    Both are cached on the chart object, so the PD views copied from it (and
    every step's rebuild) inherit them instead of searching lunations again.
    """
    import eclipses

    if getattr(radix, "syzygy", None) is None:
        try:
            radix.calcSyzygy()
        except Exception:
            pass
    try:
        eclipses.selected_prenatal_eclipse_point(radix, options)
    except Exception:
        pass


class _PdRefresh:
    """The two attributes PrimDirs._refresh_chart_pd_dependencies reads."""

    def __init__(self, *, chart, options):
        self.chart = chart
        self.options = options


def _cast_turned_chart(radix, da, pd_options):
    """Cast the radix place at the moment its RAMC has turned by ``da``."""
    pdinch = pdsinchart.PDsInChart(radix, float(da))
    pdh, pdm, pds_ = _decimal_hours_to_hms(pdinch.tz)
    cal = chart.Time.JULIAN if radix.time.cal == chart.Time.JULIAN else chart.Time.GREGORIAN
    tim = chart.Time(pdinch.yz, pdinch.mz, pdinch.dz, pdh, pdm, pds_,
                     radix.time.bc, cal, chart.Time.GREENWICH,
                     True, 0, 0, False, radix.place, False)
    return chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False)


def compute_celestial_pd_chart(radix, da, options):
    """Morinus' PDs in Chart at signed arc *da* (Direct positive).

    Houses and angles are those of the turned sky (the directed angles).  Each
    body and Fortuna stand at their directed-significator degree, latitude 0.
    A point without a finite root keeps Morinus' own mundane-profection place
    (primdirslistwnd.py PrimDirsListWnd.calc) and is listed in
    ``_pd_fallback_points``.
    """
    pd_options = chart_options(options)
    pdchart = _cast_turned_chart(radix, da, pd_options)
    natal = pd_radix(radix, options)
    placidian = int(getattr(options, "primarydir", 0)) in _PLACIDIAN_POSITION_SYSTEMS
    place_lat = radix.place.lat
    obl = radix.obl[0]
    ayanamsha = pdchart.ayanamsha_offset
    # Directed degrees live in the radix zodiac, the frame of the inner ring
    # and the speculum; a sidereal cast hours later differs by ~1e-6 deg.
    frame = radix.ayanamsha_offset
    fallback = []

    def direct_body(key, target, source):
        lon = directed_significator_point(
            radix, source.data[planets.Planet.LONG], source.data[planets.Planet.LAT], da, options,
        )
        if lon is not None:
            _set_planet_position(target, lon, 0.0, pdchart, frame)
            return
        fallback.append(key)
        if placidian:
            target.calcMundaneProfPos(pdchart.houses.ascmc2, source, place_lat, obl, ayanamsha)
        else:
            target.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, source, place_lat, obl, ayanamsha)

    for index, (target, source) in enumerate(zip(pdchart.planets.planets, natal.planets.planets)):
        direct_body(index, target, source)
    for body_id, target in chart_bodies.iter_dynamic_bodies(pdchart):
        source = chart_bodies.dynamic_body(natal, body_id)
        if source is not None:
            direct_body(body_id, target, source)

    natal_fortune = natal.fortune.fortune
    lon = directed_significator_point(
        radix, natal_fortune[fortune.Fortune.LON], natal_fortune[fortune.Fortune.LAT], da, options,
    )
    if lon is not None:
        _set_fortune_position(pdchart.fortune, lon, 0.0, pdchart, frame)
    else:
        fallback.append("fortune")
        if placidian:
            pdchart.fortune.calcMundaneProfPos(pdchart.houses.ascmc2, natal.fortune, place_lat, obl, ayanamsha)
        else:
            pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, natal.fortune, place_lat, obl, ayanamsha)
    _direct_chart_points(pdchart, radix, natal, da, options)
    pdchart.calcAspMatrix()
    pdchart.calcLoFAspMatrix()

    pdchart._pd_arc_signed = float(da)
    pdchart._pd_arc_abs = math.fabs(float(da))
    pdchart._pd_direct = (da >= 0.0)
    pdchart._pd_projection_domain = "celestial"
    pdchart._pd_projection_operator = "directed-significators"
    pdchart._pd_fallback_points = tuple(fallback)
    # The ascensional presentation turns the natal sky through this chart's
    # meridian instead of projecting the directed degrees (see natal_sky).
    pdchart._pd_natal_sky = radix
    pdchart._pd_exact_event = None
    return pdchart


def _direct_chart_points(pdchart, radix, natal, da, options):
    """Cusps, Vertex, prenatal Syzygy and eclipse: the natal points, directed.

    The turned cast has its own intermediate cusps, Vertex and lunations; the
    PDs-in-Chart ring shows the radix points as significators, exactly as the
    speculum lists them (latitude 0).
    """
    import eclipses

    # Intermediate cusps: the PD system's natal cusps directed as the PD list
    # directs them.  Under-the-pole and Topocentric row equations do not
    # reproduce their own turned house frame, so the cast cusps are replaced.
    natal_cusps = natal.houses.cusps
    cusps = list(pdchart.houses.cusps)
    cusps2 = list(pdchart.houses.cusps2)
    for house in (2, 3, 5, 6, 8, 9, 11, 12):
        lon = directed_significator_point(radix, natal_cusps[house], 0.0, da, options)
        if lon is None:
            continue
        ra, decl, _dist = astrology.swe_cotrans(
            util.to_tropical_lon(lon, radix.ayanamsha_offset), 0.0, 1.0, -pdchart.obl[0],
        )
        cusps[house] = lon
        cusps2[house - 1] = (ra, decl)
    pdchart.houses.cusps = tuple(cusps)
    pdchart.houses.cusps2 = tuple(cusps2)

    vertex = directed_significator_point(
        radix, radix.houses.ascmc[houses.Houses.VERTEX], 0.0, da, options,
    )
    if vertex is not None:
        ascmc = list(pdchart.houses.ascmc)
        ascmc[houses.Houses.VERTEX] = vertex
        pdchart.houses.ascmc = tuple(ascmc)
    natal_syzygy = getattr(natal, "syzygy", None)
    if natal_syzygy is not None:
        lon = directed_significator_point(radix, natal_syzygy.lon, 0.0, da, options)
        if lon is not None:
            directed = copy.copy(natal_syzygy)
            directed.lon = lon
            pdchart.syzygy = directed
    try:
        point = eclipses.selected_prenatal_eclipse_point(natal, options)
    except Exception:
        point = None
    if point is not None:
        event, exact_jd, lon = point
        lon = directed_significator_point(radix, lon, 0.0, da, options)
        if lon is not None:
            pdchart.directedPrenatalEclipsePoint = (event, exact_jd, lon)


def natal_sky(chrt):
    """The chart whose bodies a ring shows in the ascensional presentation.

    A celestial PDs-in-Chart ring shows the PD list's natal sky (``pd_radix``:
    the bodies the PD engine directs) at its own turned meridian; every
    other chart shows its own bodies.
    """
    radix = getattr(chrt, "_pd_natal_sky", None)
    if radix is None:
        return chrt
    return pd_radix(radix, chrt.options)


def compute_pd_chart(radix, da, options, terrestrial=False):
    """Dispatch to celestial or terrestrial PD chart computation."""
    if terrestrial:
        return compute_terrestrial_pd_chart(radix, da, options)
    return compute_celestial_pd_chart(radix, da, options)
