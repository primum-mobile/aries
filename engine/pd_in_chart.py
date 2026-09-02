# -*- coding: utf-8 -*-
# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Wx-free Primary-Directions-in-Chart computation.

The "PDs in Chart" surface projects a single primary direction's arc onto a
biwheel.  Its default fixed-radix frame moves promissors outside; the optional
traditional Converse frame keeps natal promissors fixed and moves a directed
significator layer.  The legacy forward whole-sky transform supplies that
second background, while the outer-promissor ecliptic-feet view applies its
mathematical inverse.  Either frame can place a selected ordinary zero-latitude
event from any supported PD system's row-native equation.
The math lives here and in the canonical primary-direction engine; it does not
touch wx or React.

Extracted from ``primdirslistwnd.py`` (PrimDirsListWnd.calc and the module-level
``_compute_*_pd_chart`` helpers) so wx and Tauri share one implementation. The
shared engine also closes later Topocentric gaps: Topocentric positions use the
PMP/MDO family rather than the Regiomontanus inverse, and an exact selected
planet-to-angle row can be projected with the same latitude convention that
created its arc.

The two public ``pdincharttyp`` mode constants are inlined here (the wx owner
``pdsinchartdlgopts.PDsInChartsDlgOpts`` imports wx for its dialog body).  Old
saved value ``2`` is retired and defensively resolves to Planets.
"""
import copy
import math

import astrology
import chart
import fortune
import houses
import pdsinchart
import planets
import primdirs
import util
from engine import pd_row_geometry
from engine import morin_aspects as _morin_aspects

# pdsinchartdlgopts.PDsInChartsDlgOpts.* (wx-free integer constants).
FROMMUNDANEPOS = 0
FROMZODIACALPOS = 1

TROPICAL_YEAR_DAYS = 365.2421904
PD_DIRECTION_EXACT_TOLERANCE_DEGREES = 1.0e-8

_PLACIDIAN_POSITION_SYSTEMS = (
    primdirs.PrimDirs.PLACIDIANSEMIARC,
    primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE,
    primdirs.PrimDirs.TOPOCENTRIC,
)


def _normalize_projection_mode(value):
    """Keep retired/malformed persisted modes out of the engine branches."""
    if isinstance(value, bool):
        return FROMMUNDANEPOS
    try:
        projection = int(value)
    except (TypeError, ValueError, OverflowError):
        return FROMMUNDANEPOS
    if isinstance(value, float) and not value.is_integer():
        return FROMMUNDANEPOS
    if projection not in (FROMMUNDANEPOS, FROMZODIACALPOS):
        return FROMMUNDANEPOS
    return projection


class _CircularInverseError(ValueError):
    def __init__(self, message, best_longitude, best_error):
        super().__init__(message)
        self.best_longitude = util.normalize(float(best_longitude))
        self.best_error = math.fabs(float(best_error))


def _set_planet_position(target, lon, lat, pdchart):
    """Replace one PD-chart body's ecliptic point and rebuild its speculums."""
    ra, decl, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), getattr(pdchart, "ayanamsha_offset", 0.0)),
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


def _set_fortune_position(target, lon, lat, pdchart):
    """Replace one PD-chart Fortuna point and rebuild both speculums."""
    ra, decl, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), getattr(pdchart, "ayanamsha_offset", 0.0)),
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


def _inverse_placidian_ecliptic_feet(pdchart, natal_frame, radix):
    """Place the moving outer sky on a right-inverse branch of Morinus's map.

    Morinus's legacy wheel applies the nonlinear point map from the natal frame
    to the directed frame, which is appropriate when significators occupy the
    outer ring.  Aries keeps the radix fixed and puts promissors outside, so the
    ring-role inversion must solve the inverse equation for that same map;
    changing the sign of the direction arc is not an inverse operation.  The
    map can fold at high latitudes, so the validated root nearest the reciprocal
    frame estimate is the deterministic branch policy; global continuity is
    not claimed where multiple roots merge or disappear.
    """
    placelat = radix.place.lat
    obl = radix.obl[0]
    ayanamsha = pdchart.ayanamsha_offset
    max_roundtrip_error = 0.0

    point_pairs = list(enumerate(zip(
        pdchart.planets.planets, natal_frame.planets.planets,
    )))
    if getattr(pdchart, "chiron", None) is not None and getattr(natal_frame, "chiron", None) is not None:
        point_pairs.append(("chiron", (pdchart.chiron, natal_frame.chiron)))
    failed_points = []
    for point_id, (target_point, source_point) in point_pairs:
        natal_longitude = float(source_point.data[planets.Planet.LONG])

        # Applying the legacy map with the two frames exchanged is not the
        # exact inverse, but it is a strong branch-aware initial estimate.  It
        # usually keeps Newton on a nearby branch; the forward equation below
        # remains the authority and is solved to a sub-milliarcsecond
        # round-trip.
        _set_planet_position(target_point, natal_longitude, 0.0, pdchart)
        _set_planet_position(source_point, natal_longitude, 0.0, natal_frame)
        source_point.calcMundaneProfPos(
            natal_frame.houses.ascmc2,
            target_point,
            placelat,
            obl,
            natal_frame.ayanamsha_offset,
        )
        reciprocal_guess = float(source_point.data[planets.Planet.LONG])

        def forward(candidate, target_point=target_point, source_point=source_point):
            _set_planet_position(source_point, candidate, 0.0, natal_frame)
            _set_planet_position(target_point, candidate, 0.0, pdchart)
            target_point.calcMundaneProfPos(
                pdchart.houses.ascmc2,
                source_point,
                placelat,
                obl,
                ayanamsha,
            )
            return float(target_point.data[planets.Planet.LONG])

        point_failed = False
        try:
            directed_longitude = _solve_circular_longitude(
                forward,
                natal_longitude,
                reciprocal_guess,
                dense_fallback=True,
            )
        except _CircularInverseError as exc:
            # Even below the circumpolar cutoff the symbolic map can fold and
            # make root isolation numerically ambiguous.  Keep the best
            # validated candidate instead of aborting the selected-event chart,
            # and mark the surrounding background as a partial inverse.
            directed_longitude = exc.best_longitude
            failed_points.append((point_id, exc.best_error))
            point_failed = True
        roundtrip_error = math.fabs(
            _signed_angle_delta(forward(directed_longitude), natal_longitude)
        )
        if roundtrip_error > 1.0e-7 and not point_failed:
            raise ValueError("primary-direction ecliptic-foot inverse failed validation")
        max_roundtrip_error = max(max_roundtrip_error, roundtrip_error)
        _set_planet_position(target_point, directed_longitude, 0.0, pdchart)

    natal_fortune = float(natal_frame.fortune.fortune[fortune.Fortune.LON])

    _set_fortune_position(pdchart.fortune, natal_fortune, 0.0, pdchart)
    _set_fortune_position(natal_frame.fortune, natal_fortune, 0.0, natal_frame)
    natal_frame.fortune.calcMundaneProfPos(
        natal_frame.houses.ascmc2,
        pdchart.fortune,
        placelat,
        obl,
        natal_frame.ayanamsha_offset,
    )
    reciprocal_fortune_guess = float(
        natal_frame.fortune.fortune[fortune.Fortune.LON]
    )

    def forward_fortune(candidate):
        _set_fortune_position(natal_frame.fortune, candidate, 0.0, natal_frame)
        _set_fortune_position(pdchart.fortune, candidate, 0.0, pdchart)
        pdchart.fortune.calcMundaneProfPos(
            pdchart.houses.ascmc2,
            natal_frame.fortune,
            placelat,
            obl,
            ayanamsha,
        )
        return float(pdchart.fortune.fortune[fortune.Fortune.LON])

    fortune_failed = False
    try:
        directed_fortune = _solve_circular_longitude(
            forward_fortune,
            natal_fortune,
            reciprocal_fortune_guess,
            dense_fallback=True,
        )
    except _CircularInverseError as exc:
        directed_fortune = exc.best_longitude
        failed_points.append(("fortune", exc.best_error))
        fortune_failed = True
    roundtrip_error = math.fabs(
        _signed_angle_delta(forward_fortune(directed_fortune), natal_fortune)
    )
    if roundtrip_error > 1.0e-7 and not fortune_failed:
        raise ValueError("primary-direction Fortuna foot inverse failed validation")
    max_roundtrip_error = max(max_roundtrip_error, roundtrip_error)
    _set_fortune_position(pdchart.fortune, directed_fortune, 0.0, pdchart)
    pdchart.calcAspMatrix()
    pdchart.calcLoFAspMatrix()
    pdchart._pd_projection_roundtrip_max_error = max_roundtrip_error
    pdchart._pd_projection_inverse_failures = tuple(failed_points)
    return not failed_points


def _angle_coordinate(lon, lat, angle, radix):
    """RA/OA/OD coordinate used by the canonical planet-to-angle PD path."""
    ra, decl, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(float(lon), getattr(radix, "ayanamsha_offset", 0.0)),
        float(lat), 1.0, -radix.obl[0],
    )
    if angle in (primdirs.PrimDir.MC, primdirs.PrimDir.IC):
        return util.normalize(ra)
    val = math.tan(math.radians(radix.place.lat)) * math.tan(math.radians(decl))
    if math.fabs(val) > 1.0:
        raise ValueError("circumpolar point has no finite angle coordinate")
    ad = math.degrees(math.asin(val))
    if angle == primdirs.PrimDir.ASC:
        return util.normalize(ra - ad)
    if angle == primdirs.PrimDir.DESC:
        return util.normalize(ra + ad)
    raise ValueError("unsupported PD significator angle")


def _signed_angle_delta(value, target):
    return ((float(value) - float(target) + 180.0) % 360.0) - 180.0


def _directed_angle_longitude(lon, lat, angle, signed_arc, radix):
    """Invert the same RA/OA/OD equation used to create an angle PD row."""
    target = util.normalize(_angle_coordinate(lon, lat, angle, radix) + signed_arc)
    guess = util.normalize(float(lon) + float(signed_arc))
    epsilon = 0.0001
    for _iteration in range(16):
        value = _angle_coordinate(guess, lat, angle, radix)
        error = _signed_angle_delta(value, target)
        if math.fabs(error) < 1.0e-10:
            break
        ahead = _angle_coordinate(guess + epsilon, lat, angle, radix)
        behind = _angle_coordinate(guess - epsilon, lat, angle, radix)
        derivative = _signed_angle_delta(ahead, behind) / (2.0 * epsilon)
        if math.fabs(derivative) < 1.0e-8:
            break
        guess = util.normalize(guess - error / derivative)
    return util.normalize(guess)


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


_ANGLE_POINTS = (
    primdirs.PrimDir.ASC,
    primdirs.PrimDir.DESC,
    primdirs.PrimDir.MC,
    primdirs.PrimDir.IC,
)


def _angle_longitude(radix, angle):
    """Return the zodiacal longitude of one radix angle."""
    if angle == primdirs.PrimDir.ASC:
        return util.normalize(float(radix.houses.ascmc2[houses.Houses.ASC][0]))
    if angle == primdirs.PrimDir.DESC:
        return util.normalize(float(radix.houses.ascmc2[houses.Houses.ASC][0]) + 180.0)
    if angle == primdirs.PrimDir.MC:
        return util.normalize(float(radix.houses.ascmc2[houses.Houses.MC][0]))
    if angle == primdirs.PrimDir.IC:
        return util.normalize(float(radix.houses.ascmc2[houses.Houses.MC][0]) + 180.0)
    raise ValueError("unsupported PD angle")


def _selected_angle_event_parts(radix, pdchart, event, options, *, feet):
    """Resolve the shared zodiacal body/aspect-ray -> angle row contract."""
    if not isinstance(event, dict):
        return None, "missing-selected-row"
    if bool(event.get("mundane", False)) or event.get("domain") != "zodiacal":
        return None, "not-zodiacal"
    system = _event_int(event, "system")
    if (
        system not in pd_row_geometry.SUPPORTED_ECLIPTIC_FOOT_SYSTEMS
        or system != getattr(options, "primarydir", None)
    ):
        return None, "system-mismatch"
    if event.get("eventKind") not in ("conjunction", "aspect"):
        return None, "unsupported-event-kind"
    prom = _event_int(event, "prom")
    prom2 = _event_int(event, "prom2", default=primdirs.PrimDir.NONE)
    sig = _event_int(event, "sig", "sigPoint")
    promasp = _event_int(event, "promasp", default=chart.Chart.CONJUNCTIO)
    sigasp = _event_int(event, "sigasp", default=chart.Chart.CONJUNCTIO)
    if prom is None or sig is None or prom2 != primdirs.PrimDir.NONE:
        return None, "compound-promissor"
    if sig not in _ANGLE_POINTS:
        return None, "not-angle-significator"
    if sigasp != chart.Chart.CONJUNCTIO:
        return None, "significator-aspect"
    if promasp < chart.Chart.CONJUNCTIO or promasp > chart.Chart.SEPTILE:
        return None, "non-aspect-ray"
    if (
        promasp != chart.Chart.CONJUNCTIO
        and "promaspOffset" not in event
        and "promasp_offset" not in event
    ):
        return None, "missing-promissor-ray-side"
    prom_pair = _event_body(radix, pdchart, prom, event.get("promDynamicKey"))
    if prom_pair is None:
        return None, "unsupported-promissor"
    if (
        prom_pair[2] == astrology.SE_MOON
        and bool(getattr(options, "pdsecmotion", False))
    ):
        return None, "moon-secondary-motion"
    if bool(getattr(options, "morin_excentric", False)):
        return None, "morin-excentric"

    prom_offset = _event_float(event, "promaspOffset", "promasp_offset")
    body = prom_pair[0]
    body_lon = float(body.data[planets.Planet.LONG])
    body_lat = float(body.data[planets.Planet.LAT])
    ray_lon = util.normalize(body_lon + prom_offset)
    ray_lat = 0.0
    if not feet and getattr(options, "subzodiacal", primdirs.PrimDirs.SZNEITHER) in (
        primdirs.PrimDirs.SZPROMISSOR,
        primdirs.PrimDirs.SZBOTH,
    ):
        ray_lat = body_lat
        if bool(getattr(options, "bianchini", False)) and promasp != chart.Chart.CONJUNCTIO:
            value = math.sin(math.radians(body_lat)) * math.cos(
                math.radians(chart.Chart.Aspects[promasp])
            )
            if math.fabs(value) > 1.0:
                return None, "bianchini-latitude"
            ray_lat = math.degrees(math.asin(value))

    angle_lon = _angle_longitude(radix, sig)
    try:
        ray_coordinate = _angle_coordinate(ray_lon, ray_lat, sig, radix)
        angle_coordinate = _angle_coordinate(angle_lon, 0.0, sig, radix)
    except ValueError:
        return None, "angle-coordinate-undefined"
    raw_initial = _signed_angle_delta(ray_coordinate, angle_coordinate)
    row_direct, row_arc = _canonical_raw_direction(raw_initial)
    direct = bool(event.get("direct", raw_initial >= 0.0))
    event_arc = math.fabs(_event_float(event, "arc", default=row_arc))
    if row_direct is not direct or math.fabs(row_arc - event_arc) > 1.0e-7:
        return None, "row-equation-mismatch"
    return {
        "system": system,
        "prom": prom,
        "promPair": prom_pair,
        "promasp": promasp,
        "promOffset": prom_offset,
        "sig": sig,
        "sigasp": sigasp,
        "bodyLongitude": body_lon,
        "bodyLatitude": body_lat,
        "rayLongitude": ray_lon,
        "rayLatitude": ray_lat,
        "rayCoordinate": ray_coordinate,
        "angleLongitude": angle_lon,
        "angleCoordinate": angle_coordinate,
        "direct": direct,
        "eventArc": event_arc,
    }, None


def apply_exact_planet_to_angle_projection(pdchart, radix, event, signed_arc, options):
    """Align a selected ecliptic-foot body/aspect-ray to a radix angle.

    This correction is only valid when the chart itself represents the row's
    ecliptic-foot point.  ``From the Planets`` is a rigid physical-sky
    background: relocating one body there would falsify that projection, so an
    exact selected contact must eventually be represented by a separate event
    ray/marker instead.
    """
    if (
        getattr(options, "pdincharttyp", None) != FROMZODIACALPOS
        or getattr(getattr(pdchart, "options", None), "pdincharttyp", None)
        != FROMZODIACALPOS
        or getattr(pdchart, "_pd_projection_orientation", None)
        != "outer-promissor"
        or getattr(options, "subzodiacal", primdirs.PrimDirs.SZNEITHER)
        not in (
            primdirs.PrimDirs.SZNEITHER,
            primdirs.PrimDirs.SZSIGNIFICATOR,
        )
        or bool(getattr(options, "morin_excentric", False))
    ):
        return False
    parts, _reason = _selected_angle_event_parts(
        radix, pdchart, event, options, feet=True,
    )
    if parts is None:
        return False
    latitude = 0.0
    # A primary-direction row stores the natal promissor coordinate minus the
    # fixed angle coordinate.  With the radix fixed and promissors outside, the
    # moving foot therefore follows F(0) - u for signed cursor arc u.
    longitude = _directed_angle_longitude(
        parts["rayLongitude"], latitude, parts["sig"], -float(signed_arc), radix,
    )
    _set_planet_position(
        parts["promPair"][1], longitude - parts["promOffset"], latitude, pdchart,
    )
    pdchart.calcAspMatrix()
    pdchart.calcLoFAspMatrix()
    try:
        event_magnitude = math.fabs(float(event.get("arc")))
    except (TypeError, ValueError):
        event_magnitude = math.fabs(float(signed_arc))
    current_magnitude = math.fabs(float(signed_arc))
    pdchart._pd_projection_row_native_eligible = True
    pdchart._pd_projection_row_native = True
    pdchart._pd_projection_exact = (
        math.fabs(current_magnitude - event_magnitude) <= 1.0e-8
    )
    pdchart._pd_projection_remaining_arc = event_magnitude - current_magnitude
    pdchart._pd_projection_exact_scope = "selected-zodiacal-body-ray-to-angle"
    pdchart._pd_projection_exact_kind = "selected-angle-event"
    pdchart._pd_projection_selected_operator = "shared-angle-coordinate-override"
    pdchart._pd_projection_unsupported_reason = None
    return True


def _canonical_raw_direction(raw_arc):
    """Mirror ``PrimDirs.create``'s signed-arc normalization."""
    arc = float(raw_arc)
    if arc <= -360.0:
        arc += 360.0
    if arc >= 360.0:
        arc -= 360.0
    direct = True
    if arc < 0.0:
        arc *= -1.0
        direct = False
    if arc > 180.0:
        arc = 360.0 - arc
        direct = not direct
    return direct, arc


def _event_int(event, *names, default=None):
    for name in names:
        if name in event and event.get(name) is not None:
            try:
                return int(event.get(name))
            except (TypeError, ValueError):
                return default
    return default


def _event_float(event, *names, default=0.0):
    for name in names:
        if name in event and event.get(name) is not None:
            try:
                return float(event.get(name))
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


def _selected_significator_longitude(radix, sig):
    if 0 <= sig < len(radix.planets.planets):
        return float(radix.planets.planets[sig].data[planets.Planet.LONG])
    if sig == primdirs.PrimDir.LOF:
        return float(radix.fortune.fortune[fortune.Fortune.LON])
    return None


def _mark_selected_projection_unsupported(pdchart, reason):
    """Leave the background untouched and make a rejected row explicit."""
    pdchart._pd_projection_row_native_eligible = False
    pdchart._pd_projection_row_native = False
    pdchart._pd_projection_exact = False
    pdchart._pd_projection_exact_scope = None
    pdchart._pd_projection_exact_kind = None
    pdchart._pd_projection_selected_operator = None
    pdchart._pd_projection_unsupported_reason = str(reason)


def _event_body(radix, pdchart, point_id, dynamic_key):
    """Resolve one ordinary PD body without confusing Chiron with the IC id."""
    if dynamic_key == "chiron":
        if int(point_id) != primdirs.PrimDir.CUSTOMERPD:
            return None
        source = getattr(radix, "chiron", None)
        target = getattr(pdchart, "chiron", None)
        if source is None or target is None:
            return None
        return source, target, "chiron"
    if dynamic_key is not None:
        return None
    try:
        point_id = int(point_id)
    except (TypeError, ValueError):
        return None
    if point_id < 0 or point_id >= len(radix.planets.planets):
        return None
    if point_id >= len(pdchart.planets.planets):
        return None
    return (
        radix.planets.planets[point_id],
        pdchart.planets.planets[point_id],
        point_id,
    )


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


def _unsupported_angle_event_overlay(
    event,
    signed_arc,
    reason,
    *,
    projection_mode=None,
    display_frame=None,
):
    event = event or {}
    event_arc = math.fabs(_event_float(event or {}, "arc", default=signed_arc))
    direct = bool(event.get("direct", float(signed_arc) >= 0.0))
    exact_signed_arc = event_arc if direct else -event_arc
    remaining = exact_signed_arc - float(signed_arc)
    event_jd = event.get("time", event.get("jd"))
    try:
        event_jd = float(event_jd) if event_jd is not None else None
    except (TypeError, ValueError):
        event_jd = None
    system = _event_int(event, "system")
    sig = _event_int(event, "sig", "sigPoint")
    native_coordinate_kind = {
        primdirs.PrimDir.ASC: "oblique-ascension",
        primdirs.PrimDir.DESC: "oblique-descension",
        primdirs.PrimDir.MC: "right-ascension",
        primdirs.PrimDir.IC: "right-ascension",
    }.get(sig)
    return {
        "schemaVersion": 1,
        "eventId": _selected_event_id(event),
        "supported": False,
        "unsupportedReason": str(reason),
        "eventKind": "body-aspect-to-angle",
        "domain": event.get("domain"),
        "system": system,
        "projectionMode": projection_mode,
        "displayFrame": display_frame,
        "direction": "direct" if direct else "converse",
        "eventJd": event_jd,
        "exactArcDegrees": event_arc,
        "exactArcDegreesSigned": exact_signed_arc,
        "currentArcDegreesSigned": float(signed_arc),
        "remainingArcDegreesSigned": remaining,
        "remainingArcDegrees": math.fabs(remaining),
        "exactNow": False,
        "residualDegrees": None,
        "nativeCoordinateKind": native_coordinate_kind,
        "literalLongitudeContact": False,
        "parties": None,
        "primitives": [],
    }


def attach_selected_angle_event_overlay(
    pdchart,
    radix,
    event,
    signed_arc,
    options,
    *,
    outer_promissor,
):
    """Attach daemon/render authority for one body/aspect-ray -> angle event.

    The overlay tells the truth in the coordinate that created the selected
    row.  In the fixed-radix frame it carries the moving promissor ray and the
    fixed radix angle.  In the traditional Converse frame it carries the fixed
    natal promissor ray and a separate moving directed-angle marker; the real
    radix axis never moves.  Planet glyphs remain untouched in Planets mode.
    """
    if not isinstance(event, dict):
        pdchart._pd_event_overlay = None
        return None
    prom = _event_int(event, "prom")
    sig = _event_int(event, "sig", "sigPoint")
    if prom in _ANGLE_POINTS and sig not in _ANGLE_POINTS:
        return attach_selected_angle_promissor_event_overlay(
            pdchart,
            radix,
            event,
            signed_arc,
            options,
            outer_promissor=outer_promissor,
        )
    feet = (
        getattr(options, "pdincharttyp", None) == FROMZODIACALPOS
        and getattr(getattr(pdchart, "options", None), "pdincharttyp", None)
        == FROMZODIACALPOS
    )
    parts, reason = _selected_angle_event_parts(
        radix, pdchart, event, options, feet=feet,
    )
    projection_mode = "ecliptic-feet" if feet else "planets"
    display_frame = "fixed-radix" if outer_promissor else "traditional-converse"
    if parts is None:
        overlay = _unsupported_angle_event_overlay(
            event,
            signed_arc,
            reason,
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay
    if not outer_promissor and parts["direct"]:
        overlay = _unsupported_angle_event_overlay(
            event,
            signed_arc,
            "traditional-frame-is-converse-only",
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay

    signed_cursor = float(signed_arc)
    exact_signed_arc = (
        parts["eventArc"] if parts["direct"] else -parts["eventArc"]
    )
    coordinate_kind = {
        primdirs.PrimDir.ASC: "oblique-ascension",
        primdirs.PrimDir.DESC: "oblique-descension",
        primdirs.PrimDir.MC: "right-ascension",
        primdirs.PrimDir.IC: "right-ascension",
    }[parts["sig"]]
    if outer_promissor:
        if feet:
            moving_ray_lon = _directed_angle_longitude(
                parts["rayLongitude"],
                parts["rayLatitude"],
                parts["sig"],
                -signed_cursor,
                radix,
            )
            moving_ray_lat = parts["rayLatitude"]
            equatorial_motion = None
        else:
            (
                moving_ray_lon,
                moving_ray_lat,
                directed_ra,
                fixed_declination,
            ) = _rotate_equatorial_ray(
                parts["rayLongitude"],
                parts["rayLatitude"],
                signed_cursor,
                radix,
            )
            equatorial_motion = {
                "rightAscension": directed_ra,
                "declination": fixed_declination,
            }
        moving_ray_coordinate = _angle_coordinate(
            moving_ray_lon, moving_ray_lat, parts["sig"], radix,
        )
        directed_angle_lon = parts["angleLongitude"]
        directed_angle_coordinate = parts["angleCoordinate"]
        residual = _signed_angle_delta(
            moving_ray_coordinate, directed_angle_coordinate,
        )
        primitives = [
            {
                "kind": "direction-ray",
                "role": "promissor",
                "motion": "moving",
                "ring": "outer",
                "longitude": util.normalize(moving_ray_lon),
                "latitude": float(moving_ray_lat),
                "nativeCoordinate": util.normalize(moving_ray_coordinate),
                "nativeCoordinateKind": coordinate_kind,
                "motionModel": (
                    "ecliptic-foot-inverse" if feet else "rigid-equatorial"
                ),
                "equatorial": equatorial_motion,
            },
            {
                "kind": "directed-angle",
                "role": "significator",
                "motion": "fixed",
                "ring": "inner",
                "angleId": int(parts["sig"]),
                "longitude": util.normalize(directed_angle_lon),
                "latitude": 0.0,
                "nativeCoordinate": util.normalize(directed_angle_coordinate),
                "nativeCoordinateKind": coordinate_kind,
            },
        ]
        display_frame = "fixed-radix"
    else:
        moving_ray_lon = parts["rayLongitude"]
        moving_ray_coordinate = parts["rayCoordinate"]
        directed_angle_lon = _directed_angle_longitude(
            parts["angleLongitude"], 0.0, parts["sig"], signed_cursor, radix,
        )
        directed_angle_coordinate = _angle_coordinate(
            directed_angle_lon, 0.0, parts["sig"], radix,
        )
        residual = _signed_angle_delta(
            moving_ray_coordinate, directed_angle_coordinate,
        )
        primitives = [
            {
                "kind": "direction-ray",
                "role": "promissor",
                "motion": "fixed",
                "ring": "outer",
                "longitude": util.normalize(moving_ray_lon),
                "latitude": float(parts["rayLatitude"]),
                "nativeCoordinate": util.normalize(moving_ray_coordinate),
                "nativeCoordinateKind": coordinate_kind,
                "motionModel": "fixed-natal-ray",
                "equatorial": None,
            },
            {
                "kind": "directed-angle",
                "role": "significator",
                "motion": "moving",
                "ring": "inner",
                "angleId": int(parts["sig"]),
                "longitude": util.normalize(directed_angle_lon),
                "latitude": 0.0,
                "nativeCoordinate": util.normalize(directed_angle_coordinate),
                "nativeCoordinateKind": coordinate_kind,
            },
        ]
        display_frame = "traditional-converse"

    remaining = exact_signed_arc - signed_cursor
    exact_now = math.fabs(remaining) <= 1.0e-8
    event_jd = event.get("time", event.get("jd"))
    try:
        event_jd = float(event_jd) if event_jd is not None else None
    except (TypeError, ValueError):
        event_jd = None
    overlay = {
        "schemaVersion": 1,
        "eventId": _selected_event_id(event),
        "supported": True,
        "unsupportedReason": None,
        "eventKind": "body-aspect-to-angle",
        "domain": "zodiacal",
        "system": int(parts["system"]),
        "projectionMode": "ecliptic-feet" if feet else "planets",
        "displayFrame": display_frame,
        "direction": "direct" if parts["direct"] else "converse",
        "eventJd": event_jd,
        "exactArcDegrees": float(parts["eventArc"]),
        "exactArcDegreesSigned": exact_signed_arc,
        "currentArcDegreesSigned": signed_cursor,
        "remainingArcDegreesSigned": remaining,
        "remainingArcDegrees": math.fabs(remaining),
        "exactNow": exact_now,
        "residualDegrees": float(residual),
        "nativeCoordinateKind": coordinate_kind,
        "literalLongitudeContact": bool(
            feet and exact_now and math.fabs(parts["rayLatitude"]) <= 1.0e-12
        ),
        "parties": {
            "promissor": {
                "pointId": int(parts["prom"]),
                "dynamicKey": event.get("promDynamicKey"),
                "aspect": int(parts["promasp"]),
                "aspectOffset": float(parts["promOffset"]),
                "bodyLongitude": float(parts["bodyLongitude"]),
                "bodyLatitude": float(parts["bodyLatitude"]),
                "rayLongitude": float(parts["rayLongitude"]),
                "rayLatitude": float(parts["rayLatitude"]),
                "glyph": event.get("promGlyph"),
                "aspectGlyph": event.get("promAspectGlyph"),
                "color": event.get("promColor"),
                "colorRole": event.get("promColorRole"),
            },
            "significator": {
                "pointId": int(parts["sig"]),
                "dynamicKey": event.get("sigDynamicKey"),
                "aspect": int(parts["sigasp"]),
                "longitude": float(parts["angleLongitude"]),
                "glyph": event.get("sigGlyph"),
                "color": event.get("sigColor"),
                "colorRole": event.get("sigColorRole"),
            },
        },
        "primitives": primitives,
    }
    pdchart._pd_event_overlay = overlay
    return overlay


_ROW_NATIVE_COORDINATE_KINDS = {
    primdirs.PrimDirs.PLACIDIANSEMIARC: "placidian-semiarc",
    primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE: "placidian-under-pole",
    primdirs.PrimDirs.REGIOMONTAN: "regiomontanus-w",
    primdirs.PrimDirs.CAMPANIAN: "campanus-zodiacal-w",
    primdirs.PrimDirs.TOPOCENTRIC: "topocentric-pole",
}


def _selected_angle_promissor_event_parts(radix, pdchart, event, options):
    """Resolve angle-point -> body/significator-ray row geometry.

    An angle used as a zodiacal promissor is a detached zero-latitude point at
    the natal angle degree.  It is not the live radix axis and never gains the
    axis's great-circle semantics.  The receiving body ray retains precisely
    the latitude policy used by the selected row.
    """
    if not isinstance(event, dict):
        return None, "missing-selected-row"
    if bool(event.get("mundane", False)) or event.get("domain") != "zodiacal":
        return None, "not-zodiacal"
    system = _event_int(event, "system")
    if (
        system not in pd_row_geometry.SUPPORTED_ECLIPTIC_FOOT_SYSTEMS
        or system != getattr(options, "primarydir", None)
    ):
        return None, "system-mismatch"
    if event.get("eventKind") not in ("conjunction", "aspect"):
        return None, "unsupported-event-kind"
    prom = _event_int(event, "prom")
    prom2 = _event_int(event, "prom2", default=primdirs.PrimDir.NONE)
    sig = _event_int(event, "sig", "sigPoint")
    promasp = _event_int(event, "promasp", default=chart.Chart.CONJUNCTIO)
    sigasp = _event_int(event, "sigasp", default=chart.Chart.CONJUNCTIO)
    if prom not in _ANGLE_POINTS or sig is None or prom2 != primdirs.PrimDir.NONE:
        return None, "not-angle-promissor"
    if sig in _ANGLE_POINTS:
        return None, "angle-to-angle"
    if event.get("promDynamicKey") is not None:
        return None, "dynamic-angle-promissor"
    if promasp < chart.Chart.CONJUNCTIO or promasp > chart.Chart.SEPTILE:
        return None, "non-aspect-promissor-ray"
    if sigasp < chart.Chart.CONJUNCTIO or sigasp > chart.Chart.SEPTILE:
        return None, "non-aspect-significator-ray"
    if (
        promasp != chart.Chart.CONJUNCTIO
        and "promaspOffset" not in event
        and "promasp_offset" not in event
    ):
        return None, "missing-promissor-ray-side"
    if (
        sigasp != chart.Chart.CONJUNCTIO
        and "sigaspOffset" not in event
        and "sigasp_offset" not in event
    ):
        return None, "missing-significator-ray-side"
    sig_pair = _event_body(radix, pdchart, sig, event.get("sigDynamicKey"))
    if sig_pair is None:
        return None, "unsupported-significator"

    prom_offset = _event_float(event, "promaspOffset", "promasp_offset")
    sig_offset = _event_float(event, "sigaspOffset", "sigasp_offset")
    angle_lon = _angle_longitude(radix, prom)
    prom_ray_lon = util.normalize(angle_lon + prom_offset)
    prom_ray_lat = 0.0

    body = sig_pair[0]
    body_lon = float(body.data[planets.Planet.LONG])
    body_lat = float(body.data[planets.Planet.LAT])
    sig_ray_lon = util.normalize(body_lon + sig_offset)
    sig_ray_lat = 0.0
    with_sig_lat = getattr(
        options, "subzodiacal", primdirs.PrimDirs.SZNEITHER
    ) in (primdirs.PrimDirs.SZSIGNIFICATOR, primdirs.PrimDirs.SZBOTH)
    if with_sig_lat:
        sig_ray_lat = body_lat
        if bool(getattr(options, "morin_excentric", False)) and (
            sigasp != chart.Chart.CONJUNCTIO
        ):
            # PrimDirs.getMorinExcentric applies this only to the fixed standard
            # planet matrix.  Dynamic points (including Chiron) use the same
            # ordinary longitude side and retain their own latitude.
            if isinstance(sig_pair[2], int) and 0 <= sig_pair[2] <= astrology.SE_PLUTO:
                flag = (
                    radix._planet_calc_flag()
                    if hasattr(radix, "_planet_calc_flag")
                    else astrology.SEFLG_SWIEPH | astrology.SEFLG_SPEED
                )
                delta_lon, sig_ray_lat = _morin_aspects.aspect_correction(
                    radix.time.jd,
                    sig_pair[2],
                    flag,
                    body_lon,
                    body_lat,
                    sig_offset,
                    cache_key=radix.time.jd,
                )
                sig_ray_lon = util.normalize(body_lon + sig_offset + delta_lon)
        elif bool(getattr(options, "bianchini", False)):
            value = math.sin(math.radians(body_lat)) * math.cos(
                math.radians(chart.Chart.Aspects[sigasp])
            )
            if math.fabs(value) > 1.0:
                return None, "bianchini-latitude"
            sig_ray_lat = math.degrees(math.asin(value))

    try:
        raw_initial = pd_row_geometry.evaluate_ecliptic_point_arc(
            system,
            radix,
            prom_ray_lon,
            prom_ray_lat,
            sig_ray_lon,
            sig_ray_lat,
        )
    except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
        return None, "row-geometry-undefined"
    row_direct, row_arc = _canonical_raw_direction(raw_initial)
    direct = bool(event.get("direct", raw_initial >= 0.0))
    event_arc = math.fabs(_event_float(event, "arc", default=row_arc))
    if row_direct is not direct or math.fabs(row_arc - event_arc) > 1.0e-7:
        return None, "row-equation-mismatch"
    return {
        "system": system,
        "prom": prom,
        "promasp": promasp,
        "promOffset": prom_offset,
        "sig": sig,
        "sigPair": sig_pair,
        "sigasp": sigasp,
        "sigOffset": sig_offset,
        "angleLongitude": angle_lon,
        "promRayLongitude": prom_ray_lon,
        "promRayLatitude": prom_ray_lat,
        "bodyLongitude": body_lon,
        "bodyLatitude": body_lat,
        "sigRayLongitude": sig_ray_lon,
        "sigRayLatitude": sig_ray_lat,
        "rawInitial": raw_initial,
        "direct": direct,
        "eventArc": event_arc,
    }, None


def _unsupported_angle_promissor_event_overlay(
    event,
    signed_arc,
    reason,
    *,
    projection_mode,
    display_frame,
):
    event = event or {}
    event_arc = math.fabs(_event_float(event, "arc", default=signed_arc))
    direct = bool(event.get("direct", float(signed_arc) >= 0.0))
    exact_signed_arc = event_arc if direct else -event_arc
    remaining = exact_signed_arc - float(signed_arc)
    event_jd = event.get("time", event.get("jd"))
    try:
        event_jd = float(event_jd) if event_jd is not None else None
    except (TypeError, ValueError):
        event_jd = None
    system = _event_int(event, "system")
    return {
        "schemaVersion": 1,
        "eventId": _selected_event_id(event),
        "supported": False,
        "unsupportedReason": str(reason),
        "eventKind": "angle-to-body-aspect",
        "domain": event.get("domain"),
        "system": system,
        "projectionMode": projection_mode,
        "displayFrame": display_frame,
        "direction": "direct" if direct else "converse",
        "eventJd": event_jd,
        "exactArcDegrees": event_arc,
        "exactArcDegreesSigned": exact_signed_arc,
        "currentArcDegreesSigned": float(signed_arc),
        "remainingArcDegreesSigned": remaining,
        "remainingArcDegrees": math.fabs(remaining),
        "exactNow": False,
        "residualDegrees": None,
        "nativeCoordinateKind": _ROW_NATIVE_COORDINATE_KINDS.get(system),
        "literalLongitudeContact": False,
        "parties": None,
        "primitives": [],
    }


def attach_selected_angle_promissor_event_overlay(
    pdchart,
    radix,
    event,
    signed_arc,
    options,
    *,
    outer_promissor,
):
    """Attach an exact angle-point -> body/significator-ray event marker."""
    feet = (
        getattr(options, "pdincharttyp", None) == FROMZODIACALPOS
        and getattr(getattr(pdchart, "options", None), "pdincharttyp", None)
        == FROMZODIACALPOS
    )
    projection_mode = "ecliptic-feet" if feet else "planets"
    display_frame = "fixed-radix" if outer_promissor else "traditional-converse"
    parts, reason = _selected_angle_promissor_event_parts(
        radix, pdchart, event, options,
    )
    if parts is None:
        overlay = _unsupported_angle_promissor_event_overlay(
            event,
            signed_arc,
            reason,
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay
    if not outer_promissor and parts["direct"]:
        overlay = _unsupported_angle_promissor_event_overlay(
            event,
            signed_arc,
            "traditional-frame-is-converse-only",
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay

    signed_cursor = float(signed_arc)
    exact_signed_arc = (
        parts["eventArc"] if parts["direct"] else -parts["eventArc"]
    )
    target_raw = float(parts["rawInitial"]) - signed_cursor
    fraction = (
        signed_cursor / exact_signed_arc
        if math.fabs(exact_signed_arc) > 1.0e-12
        else 1.0
    )
    evaluate = None
    equatorial_motion = None
    if outer_promissor:
        fixed_lon = parts["sigRayLongitude"]
        fixed_lat = parts["sigRayLatitude"]
        moving_natal_lon = parts["promRayLongitude"]
        moving_lat = 0.0
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            parts["system"],
            radix,
            candidate,
            0.0,
            parts["sigRayLongitude"],
            parts["sigRayLatitude"],
        )
    else:
        fixed_lon = parts["promRayLongitude"]
        fixed_lat = 0.0
        moving_natal_lon = parts["sigRayLongitude"]
        moving_lat = parts["sigRayLatitude"]
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            parts["system"],
            radix,
            parts["promRayLongitude"],
            0.0,
            candidate,
            parts["sigRayLatitude"],
        )

    exact_cursor = math.fabs(signed_cursor - exact_signed_arc) <= 1.0e-10
    literal_zero_latitude = math.fabs(parts["sigRayLatitude"]) <= 1.0e-12
    if feet:
        if exact_cursor and literal_zero_latitude:
            directed_lon = fixed_lon
        else:
            guess = util.normalize(
                moving_natal_lon
                + fraction * _signed_angle_delta(fixed_lon, moving_natal_lon)
            )
            try:
                directed_lon = _solve_unwrapped_row_longitude(
                    evaluate, target_raw, guess,
                )
            except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
                overlay = _unsupported_angle_promissor_event_overlay(
                    event,
                    signed_arc,
                    "row-inverse-failed",
                    projection_mode=projection_mode,
                    display_frame=display_frame,
                )
                pdchart._pd_event_overlay = overlay
                return overlay
    elif outer_promissor:
        (
            directed_lon,
            moving_lat,
            directed_ra,
            fixed_declination,
        ) = _rotate_equatorial_ray(
            parts["promRayLongitude"], 0.0, signed_cursor, radix,
        )
        equatorial_motion = {
            "rightAscension": directed_ra,
            "declination": fixed_declination,
        }
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            parts["system"],
            radix,
            candidate,
            moving_lat,
            parts["sigRayLongitude"],
            parts["sigRayLatitude"],
        )
    else:
        (
            directed_lon,
            moving_lat,
            directed_ra,
            fixed_declination,
        ) = _rotate_equatorial_ray(
            parts["sigRayLongitude"],
            parts["sigRayLatitude"],
            -signed_cursor,
            radix,
        )
        equatorial_motion = {
            "rightAscension": directed_ra,
            "declination": fixed_declination,
        }
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_point_arc(
            parts["system"],
            radix,
            parts["promRayLongitude"],
            0.0,
            candidate,
            moving_lat,
        )

    try:
        raw_at_cursor = float(evaluate(directed_lon))
    except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
        overlay = _unsupported_angle_promissor_event_overlay(
            event,
            signed_arc,
            "row-geometry-undefined",
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay
    unwrapped_at_cursor = raw_at_cursor + 360.0 * round(
        (target_raw - raw_at_cursor) / 360.0
    )
    equation_residual = unwrapped_at_cursor - target_raw
    if feet and math.fabs(equation_residual) > 1.0e-9:
        overlay = _unsupported_angle_promissor_event_overlay(
            event,
            signed_arc,
            "row-inverse-residual",
            projection_mode=projection_mode,
            display_frame=display_frame,
        )
        pdchart._pd_event_overlay = overlay
        return overlay

    coordinate_kind = _ROW_NATIVE_COORDINATE_KINDS[parts["system"]]
    if outer_promissor:
        angle_primitive = {
            "kind": "directed-angle",
            "role": "promissor",
            "motion": "moving",
            "ring": "outer",
            "angleId": int(parts["prom"]),
            "longitude": util.normalize(directed_lon),
            "latitude": float(moving_lat),
            "nativeCoordinate": util.normalize(directed_lon),
            "nativeCoordinateKind": "ecliptic-longitude",
            "motionModel": (
                "row-native-point-inverse" if feet else "rigid-equatorial"
            ),
            "equatorial": equatorial_motion,
        }
        ray_primitive = {
            "kind": "direction-ray",
            "role": "significator",
            "motion": "fixed",
            "ring": "inner",
            "longitude": util.normalize(parts["sigRayLongitude"]),
            "latitude": float(parts["sigRayLatitude"]),
            "nativeCoordinate": util.normalize(parts["sigRayLongitude"]),
            "nativeCoordinateKind": "ecliptic-longitude",
            "motionModel": "fixed-natal-ray",
            "equatorial": None,
        }
        primitives = [angle_primitive, ray_primitive]
    else:
        angle_primitive = {
            "kind": "directed-angle",
            "role": "promissor",
            "motion": "fixed",
            "ring": "outer",
            "angleId": int(parts["prom"]),
            "longitude": util.normalize(parts["promRayLongitude"]),
            "latitude": 0.0,
            "nativeCoordinate": util.normalize(parts["promRayLongitude"]),
            "nativeCoordinateKind": "ecliptic-longitude",
            "motionModel": "fixed-natal-angle-point",
            "equatorial": None,
        }
        ray_primitive = {
            "kind": "direction-ray",
            "role": "significator",
            "motion": "moving",
            "ring": "inner",
            "longitude": util.normalize(directed_lon),
            "latitude": float(moving_lat),
            "nativeCoordinate": util.normalize(directed_lon),
            "nativeCoordinateKind": "ecliptic-longitude",
            "motionModel": (
                "row-native-point-inverse" if feet else "rigid-equatorial"
            ),
            "equatorial": equatorial_motion,
        }
        primitives = [angle_primitive, ray_primitive]

    remaining = exact_signed_arc - signed_cursor
    exact_now = math.fabs(remaining) <= 1.0e-8
    event_jd = event.get("time", event.get("jd"))
    try:
        event_jd = float(event_jd) if event_jd is not None else None
    except (TypeError, ValueError):
        event_jd = None
    literal_contact = bool(
        feet
        and exact_now
        and literal_zero_latitude
        and math.fabs(
            _signed_angle_delta(
                angle_primitive["longitude"], ray_primitive["longitude"]
            )
        ) <= 1.0e-8
    )
    overlay = {
        "schemaVersion": 1,
        "eventId": _selected_event_id(event),
        "supported": True,
        "unsupportedReason": None,
        "eventKind": "angle-to-body-aspect",
        "domain": "zodiacal",
        "system": int(parts["system"]),
        "projectionMode": projection_mode,
        "displayFrame": display_frame,
        "direction": "direct" if parts["direct"] else "converse",
        "eventJd": event_jd,
        "exactArcDegrees": float(parts["eventArc"]),
        "exactArcDegreesSigned": exact_signed_arc,
        "currentArcDegreesSigned": signed_cursor,
        "remainingArcDegreesSigned": remaining,
        "remainingArcDegrees": math.fabs(remaining),
        "exactNow": exact_now,
        "residualDegrees": float(_signed_angle_delta(raw_at_cursor, 0.0)),
        "rowEquationResidualDegrees": float(equation_residual),
        "nativeCoordinateKind": coordinate_kind,
        "literalLongitudeContact": literal_contact,
        "parties": {
            "promissor": {
                "pointId": int(parts["prom"]),
                "dynamicKey": None,
                "aspect": int(parts["promasp"]),
                "aspectOffset": float(parts["promOffset"]),
                "longitude": float(parts["angleLongitude"]),
                "rayLongitude": float(parts["promRayLongitude"]),
                "rayLatitude": 0.0,
                "glyph": event.get("promGlyph"),
                "aspectGlyph": event.get("promAspectGlyph"),
                "color": event.get("promColor"),
                "colorRole": event.get("promColorRole"),
            },
            "significator": {
                "pointId": int(parts["sig"]),
                "dynamicKey": event.get("sigDynamicKey"),
                "aspect": int(parts["sigasp"]),
                "aspectOffset": float(parts["sigOffset"]),
                "bodyLongitude": float(parts["bodyLongitude"]),
                "bodyLatitude": float(parts["bodyLatitude"]),
                "rayLongitude": float(parts["sigRayLongitude"]),
                "rayLatitude": float(parts["sigRayLatitude"]),
                "glyph": event.get("sigGlyph"),
                "aspectGlyph": event.get("sigAspectGlyph"),
                "color": event.get("sigColor"),
                "colorRole": event.get("sigColorRole"),
            },
        },
        "primitives": primitives,
    }
    pdchart._pd_projection_equation_residual = equation_residual
    pdchart._pd_event_overlay = overlay
    return overlay


def apply_selected_ecliptic_foot_projection(
    pdchart,
    radix,
    event,
    signed_arc,
    options,
    *,
    outer_promissor,
):
    """Put one selected ordinary ecliptic-foot row on its native trajectory.

    The surrounding wheel remains the established whole-sky background
    operator.  In the fixed-radix frame the selected promissor moves while the
    significator stays natal.  In the traditional converse frame the natal
    promissor stays fixed and the selected significator moves.  Both solve the
    same signed row equation ``F(P, S) = F(0) - u`` and continue through
    perfection without clamping.
    """
    if not isinstance(event, dict):
        _mark_selected_projection_unsupported(pdchart, "missing-selected-row")
        return False
    if bool(event.get("mundane", False)) or event.get("domain") != "zodiacal":
        _mark_selected_projection_unsupported(pdchart, "not-zodiacal")
        return False
    if getattr(options, "pdincharttyp", None) != FROMZODIACALPOS:
        _mark_selected_projection_unsupported(pdchart, "not-ecliptic-feet")
        return False
    if (
        getattr(getattr(pdchart, "options", None), "pdincharttyp", None)
        != FROMZODIACALPOS
    ):
        _mark_selected_projection_unsupported(pdchart, "chart-not-ecliptic-feet")
        return False
    system = _event_int(event, "system")
    if (
        system not in pd_row_geometry.SUPPORTED_ECLIPTIC_FOOT_SYSTEMS
        or system != getattr(options, "primarydir", None)
    ):
        _mark_selected_projection_unsupported(pdchart, "system-mismatch")
        return False
    if event.get("eventKind") not in ("conjunction", "aspect"):
        _mark_selected_projection_unsupported(pdchart, "unsupported-event-kind")
        return False
    if (
        getattr(options, "subzodiacal", primdirs.PrimDirs.SZNEITHER)
        != primdirs.PrimDirs.SZNEITHER
    ):
        _mark_selected_projection_unsupported(pdchart, "nonzero-latitude-row")
        return False
    if bool(getattr(options, "bianchini", False)):
        _mark_selected_projection_unsupported(pdchart, "bianchini")
        return False
    if bool(getattr(options, "morin_excentric", False)):
        _mark_selected_projection_unsupported(pdchart, "morin-excentric")
        return False
    prom = _event_int(event, "prom")
    prom2 = _event_int(event, "prom2", default=primdirs.PrimDir.NONE)
    sig = _event_int(event, "sig", "sigPoint")
    promasp = _event_int(event, "promasp", default=chart.Chart.CONJUNCTIO)
    sigasp = _event_int(event, "sigasp", default=chart.Chart.CONJUNCTIO)
    if prom is None or sig is None or prom2 != primdirs.PrimDir.NONE:
        _mark_selected_projection_unsupported(pdchart, "compound-promissor")
        return False
    prom_pair = _event_body(
        radix, pdchart, prom, event.get("promDynamicKey"),
    )
    sig_pair = _event_body(
        radix, pdchart, sig, event.get("sigDynamicKey"),
    )
    if prom_pair is None:
        _mark_selected_projection_unsupported(pdchart, "unsupported-promissor")
        return False
    if sig_pair is None:
        _mark_selected_projection_unsupported(pdchart, "unsupported-significator")
        return False
    if (
        prom_pair[2] == astrology.SE_MOON
        and bool(getattr(options, "pdsecmotion", False))
    ):
        _mark_selected_projection_unsupported(pdchart, "moon-secondary-motion")
        return False
    unsupported_aspects = {
        chart.Chart.PARALLEL,
        chart.Chart.CONTRAPARALLEL,
        chart.Chart.RAPTPAR,
        chart.Chart.RAPTCONTRAPAR,
        chart.Chart.MIDPOINT,
    }
    if promasp in unsupported_aspects or sigasp in unsupported_aspects:
        _mark_selected_projection_unsupported(pdchart, "non-aspect-ray")
        return False
    if (
        promasp != chart.Chart.CONJUNCTIO
        and "promaspOffset" not in event
        and "promasp_offset" not in event
    ):
        _mark_selected_projection_unsupported(pdchart, "missing-promissor-ray-side")
        return False
    if (
        sigasp != chart.Chart.CONJUNCTIO
        and "sigaspOffset" not in event
        and "sigasp_offset" not in event
    ):
        _mark_selected_projection_unsupported(pdchart, "missing-significator-ray-side")
        return False

    prom_offset = _event_float(event, "promaspOffset", "promasp_offset")
    sig_offset = _event_float(event, "sigaspOffset", "sigasp_offset")
    natal_prom_body = float(prom_pair[0].data[planets.Planet.LONG])
    natal_prom_ray = util.normalize(natal_prom_body + prom_offset)
    natal_sig_body = float(sig_pair[0].data[planets.Planet.LONG])
    natal_sig_ray = util.normalize(natal_sig_body + sig_offset)
    signed_cursor = float(signed_arc)
    current_magnitude = math.fabs(signed_cursor)
    event_magnitude = math.fabs(_event_float(event, "arc", default=current_magnitude))
    direct = bool(event.get("direct", float(signed_arc) >= 0.0))
    if not outer_promissor and direct:
        _mark_selected_projection_unsupported(pdchart, "outer-significator")
        return False
    try:
        raw_initial = pd_row_geometry.evaluate_ecliptic_foot_arc(
            system, radix, natal_prom_ray, natal_sig_ray,
        )
    except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
        _mark_selected_projection_unsupported(pdchart, "row-geometry-undefined")
        return False
    row_direct, row_arc = _canonical_raw_direction(raw_initial)
    if row_direct is not direct or math.fabs(row_arc - event_magnitude) > 1.0e-7:
        _mark_selected_projection_unsupported(pdchart, "row-equation-mismatch")
        return False

    event_signed_arc = event_magnitude if direct else -event_magnitude
    target_raw = float(raw_initial) - signed_cursor
    fraction = (
        signed_cursor / event_signed_arc
        if math.fabs(event_signed_arc) > 1.0e-12
        else 1.0
    )
    if outer_promissor:
        moving_natal_ray = natal_prom_ray
        fixed_ray = natal_sig_ray
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_foot_arc(
            system, radix, candidate, natal_sig_ray,
        )
    else:
        moving_natal_ray = natal_sig_ray
        fixed_ray = natal_prom_ray
        evaluate = lambda candidate: pd_row_geometry.evaluate_ecliptic_foot_arc(
            system, radix, natal_prom_ray, candidate,
        )
    if math.fabs(signed_cursor - event_signed_arc) <= 1.0e-10:
        directed_ray = fixed_ray
    else:
        guess = util.normalize(
            moving_natal_ray
            + fraction * _signed_angle_delta(fixed_ray, moving_natal_ray)
        )
        try:
            directed_ray = _solve_unwrapped_row_longitude(
                evaluate, target_raw, guess,
            )
        except (ValueError, pd_row_geometry.PDRowGeometryUndefined):
            _mark_selected_projection_unsupported(pdchart, "row-inverse-failed")
            return False

    raw_at_cursor = evaluate(directed_ray)
    unwrapped_at_cursor = raw_at_cursor + 360.0 * round(
        (target_raw - raw_at_cursor) / 360.0
    )
    equation_residual = unwrapped_at_cursor - target_raw
    if math.fabs(equation_residual) > 1.0e-9:
        _mark_selected_projection_unsupported(pdchart, "row-inverse-residual")
        return False
    moving_pair = prom_pair if outer_promissor else sig_pair
    moving_offset = prom_offset if outer_promissor else sig_offset
    _set_planet_position(
        moving_pair[1], directed_ray - moving_offset, 0.0, pdchart,
    )

    pdchart.calcAspMatrix()
    pdchart.calcLoFAspMatrix()
    exact_now = math.fabs(signed_cursor - event_signed_arc) <= 1.0e-8
    pdchart._pd_projection_row_native_eligible = True
    pdchart._pd_projection_row_native = True
    pdchart._pd_projection_exact = exact_now
    pdchart._pd_projection_remaining_arc = event_magnitude - current_magnitude
    pdchart._pd_projection_exact_scope = "selected-zodiacal-body-ray"
    pdchart._pd_projection_exact_kind = "selected-ecliptic-foot-event"
    pdchart._pd_projection_selected_operator = (
        "row-native-ecliptic-foot-override"
        if outer_promissor
        else "row-native-ecliptic-foot-significator-override"
    )
    pdchart._pd_projection_unsupported_reason = None
    pdchart._pd_projection_requested_system = system
    pdchart._pd_projection_equation_residual = equation_residual
    pdchart._pd_projection_target_raw_arc = target_raw
    pdchart._pd_projection_promissor_ray = util.normalize(
        directed_ray if outer_promissor else natal_prom_ray
    )
    pdchart._pd_projection_significator_ray = util.normalize(
        natal_sig_ray if outer_promissor else directed_ray
    )
    return True


def chart_options(options):
    """Return an options view whose houses belong to the selected PD system.

    PDs-in-Chart is a direction surface, so its P/R/C/T geometry follows
    ``primarydir`` rather than the house system currently drawn on the radix.
    Keep the global options object untouched: the derived chart retains this
    shallow snapshot as its own construction contract.
    """
    pd_options = copy.copy(options)
    pd_options.pdincharttyp = _normalize_projection_mode(
        getattr(options, "pdincharttyp", FROMMUNDANEPOS)
    )
    # This historical slot belonged only to the removed third projection.
    pd_options.pdinchartsecmotion = False
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
    pdchart.fortune.recalcForMundaneChart(radix.fortune.fortune[fortune.Fortune.LON], radix.fortune.fortune[fortune.Fortune.LAT], radix.fortune.fortune[fortune.Fortune.RA], radix.fortune.fortune[fortune.Fortune.DECL], pdchart.houses.ascmc2, pdchart.raequasc, pdchart.obl[0], pdchart.place.lat)
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


def _apply_rigid_equatorial_projection(
    pdchart,
    planet_source,
    fortune_source,
    frame_da,
    radix,
):
    """Rotate one frozen celestial sphere in right ascension.

    Primary motion is a rotation about the celestial pole.  The source
    declinations therefore stay fixed while every right ascension receives the
    same signed frame displacement; longitude and latitude are only the final
    ecliptic display coordinates.  ``calcFullAstronomicalProc`` is the legacy
    closed-form equatorial-to-ecliptic operator for exactly that transform.
    """
    raequasc, _declequasc, _dist = astrology.swe_cotrans(
        util.to_tropical_lon(
            pdchart.houses.ascmc[houses.Houses.EQUASC],
            pdchart.ayanamsha_offset,
        ),
        0.0,
        1.0,
        -radix.obl[0],
    )
    pdchart.planets.calcFullAstronomicalProc(
        frame_da,
        radix.obl[0],
        planet_source.planets.planets,
        pdchart.place.lat,
        pdchart.houses.ascmc2,
        raequasc,
        pdchart.ayanamsha_offset,
    )
    target_chiron = getattr(pdchart, "chiron", None)
    source_chiron = getattr(planet_source, "chiron", None)
    if target_chiron is not None and source_chiron is not None:
        target_chiron.calcFullAstronomicalProc(
            frame_da,
            radix.obl[0],
            source_chiron.dataEqu[planets.Planet.RAEQU],
            source_chiron.dataEqu[planets.Planet.DECLEQU],
            pdchart.place.lat,
            pdchart.houses.ascmc2,
            raequasc,
            pdchart.ayanamsha_offset,
        )
    pdchart.fortune.calcFullAstronomicalProc(
        fortune_source.fortune,
        frame_da,
        radix.obl[0],
        pdchart.ayanamsha_offset,
    )


def compute_celestial_pd_chart(radix, da, options, *, outer_promissor=False):
    """Compute a celestial (non-terrestrial) PD-in-chart from signed arc *da*.

    Mirrors the calculation in PrimDirsListWnd.calc non-terrestrial branch
    (primdirslistwnd.py:68-118).
    """
    pd_options = chart_options(options)
    inverse_ecliptic_feet_requested = bool(
        outer_promissor
        and pd_options.pdincharttyp == FROMZODIACALPOS
        and pd_options.primarydir == primdirs.PrimDirs.PLACIDIANSEMIARC
    )
    # Below this natural Placidus boundary every zero-latitude ecliptic foot
    # has a finite ascensional difference.  This guarantees neither uniqueness
    # nor global branch continuity: the map can still fold near the boundary.
    # At or above it the legacy routine also acquires circumpolar branch gaps,
    # so a complete whole-sky inverse is not a truthful model.  Keep the
    # selected event eligible for its row-native placement, but label the
    # surrounding ring as an explicit polar fallback.
    inverse_ecliptic_feet = bool(
        inverse_ecliptic_feet_requested
        and math.fabs(float(radix.place.lat)) < 90.0 - math.fabs(float(radix.obl[0]))
    )
    polar_inverse_fallback = bool(
        inverse_ecliptic_feet_requested and not inverse_ecliptic_feet
    )
    # Preserve the prior presentation for Feet families not yet given a true
    # role-aware whole-sky inverse. Selected supported rows still receive their
    # row-native exact-event override after this background is constructed.
    frame_da = float(da)
    inverse_complete = False
    if outer_promissor and not inverse_ecliptic_feet:
        frame_da = -frame_da
    pdinch = pdsinchart.PDsInChart(radix, frame_da)
    pdh, pdm, pds_ = _decimal_hours_to_hms(pdinch.tz)
    cal = chart.Time.GREGORIAN
    if radix.time.cal == chart.Time.JULIAN:
        cal = chart.Time.JULIAN
    tim = chart.Time(pdinch.yz, pdinch.mz, pdinch.dz, pdh, pdm, pds_,
                     radix.time.bc, cal, chart.Time.GREENWICH,
                     True, 0, 0, False, radix.place, False)
    pl = pd_options.primarydir
    if pd_options.pdincharttyp == FROMMUNDANEPOS:
        pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
        pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
        _apply_rigid_equatorial_projection(
            pdchart,
            pdchartpls,
            pdchartpls,
            frame_da,
            radix,
        )
    elif pd_options.pdincharttyp == FROMZODIACALPOS:
        pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False, chart.Chart.YEAR, True)
        pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', pd_options, False, chart.Chart.YEAR, True)
        if pl in _PLACIDIAN_POSITION_SYSTEMS:
            if inverse_ecliptic_feet:
                inverse_complete = _inverse_placidian_ecliptic_feet(
                    pdchart, pdchartpls, radix,
                )
            else:
                pdchart.apply_mundane_profection(pdchartpls, radix.place.lat, radix.obl[0])
        else:
            pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
            pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
    pdchart._pd_arc_signed = float(da)
    pdchart._pd_arc_abs = math.fabs(float(da))
    pdchart._pd_direct = (da >= 0.0)
    pdchart._pd_frame_arc_signed = frame_da
    pdchart._pd_projection_orientation = (
        "outer-promissor" if outer_promissor else "outer-significator"
    )
    if pd_options.pdincharttyp == FROMMUNDANEPOS:
        pdchart._pd_projection_operator = "rigid-equatorial"
    else:
        pdchart._pd_projection_operator = (
            ("inverse" if inverse_complete else "partial-inverse")
            if inverse_ecliptic_feet else (
                "polar-sign-fallback" if polar_inverse_fallback else (
                    "legacy-sign-fallback" if outer_promissor else "forward"
                )
            )
        )
    pdchart._pd_projection_inverse_policy = (
        "nearest-reciprocal-validated-root" if inverse_ecliptic_feet else None
    )
    pdchart._pd_exact_event = None
    pdchart._pd_event_overlay = None
    return pdchart


def compute_pd_chart(radix, da, options, terrestrial=False, *, outer_promissor=False):
    """Dispatch to celestial or terrestrial PD chart computation."""
    if terrestrial:
        return compute_terrestrial_pd_chart(radix, da, options)
    return compute_celestial_pd_chart(
        radix, da, options, outer_promissor=outer_promissor,
    )
