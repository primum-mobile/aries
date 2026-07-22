# -*- coding: utf-8 -*-
"""Wx-free Primary-Directions-in-Chart computation.

The "PDs in Chart" surface projects a single primary direction's arc back onto a
chart wheel: the radix is advanced by the directed arc so the directed moment can
be drawn as a biwheel (radix inner ring + PD-projected outer ring). The math is
the engine ``pdsinchart.PDsInChart`` plus ``chart.Chart`` construction; it does
not touch wx.

Extracted from ``primdirslistwnd.py`` (PrimDirsListWnd.calc and the module-level
``_compute_*_pd_chart`` helpers) so wx and Tauri share one implementation. The
shared engine also closes later Topocentric gaps: Topocentric positions use the
PMP/MDO family rather than the Regiomontanus inverse, and an exact selected
planet-to-angle row can be projected with the same latitude convention that
created its arc.

The ``pdincharttyp`` mode constants are inlined here (the wx owner
``pdsinchartdlgopts.PDsInChartsDlgOpts`` imports wx for its dialog body, but the
three modes are just integers 0/1/2).
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

# pdsinchartdlgopts.PDsInChartsDlgOpts.* (wx-free integer constants).
FROMMUNDANEPOS = 0
FROMZODIACALPOS = 1
PSEUDOASTRONOMICAL = 2

TROPICAL_YEAR_DAYS = 365.2421904

_PLACIDIAN_POSITION_SYSTEMS = (
    primdirs.PrimDirs.PLACIDIANSEMIARC,
    primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE,
    primdirs.PrimDirs.TOPOCENTRIC,
)


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


def apply_exact_planet_to_angle_projection(pdchart, radix, event, signed_arc, options):
    """Align a selected zodiacal planet-to-angle conjunction on the wheel.

    A row may calculate the promissor on its ecliptic foot while a ``From the
    planets`` chart otherwise carries the physical body's latitude.  The wheel
    must use the same point as the row or an exact contact cannot look exact.
    Other selected rows remain honest whole-sky projections; making their event
    exact requires a dedicated aspect/event marker rather than relocating the
    physical promissor glyph.
    """
    if not isinstance(event, dict) or bool(event.get("mundane", False)):
        return False
    try:
        prom = int(event.get("prom"))
        promasp = int(event.get("promasp"))
        sig = int(event.get("sig"))
        sigasp = int(event.get("sigasp"))
    except (TypeError, ValueError):
        return False
    if promasp != chart.Chart.CONJUNCTIO or sigasp != chart.Chart.CONJUNCTIO:
        return False
    if sig not in (
        primdirs.PrimDir.ASC, primdirs.PrimDir.DESC,
        primdirs.PrimDir.MC, primdirs.PrimDir.IC,
    ):
        return False
    if prom < 0 or prom >= len(radix.planets.planets):
        return False

    source = radix.planets.planets[prom]
    target = pdchart.planets.planets[prom]
    use_promissor_latitude = getattr(options, "subzodiacal", primdirs.PrimDirs.SZNEITHER) in (
        primdirs.PrimDirs.SZPROMISSOR, primdirs.PrimDirs.SZBOTH,
    )
    latitude = float(source.data[planets.Planet.LAT]) if use_promissor_latitude else 0.0
    longitude = _directed_angle_longitude(
        source.data[planets.Planet.LONG], latitude, sig, signed_arc, radix,
    )
    _set_planet_position(target, longitude, latitude, pdchart)
    pdchart.calcAspMatrix()
    pdchart.calcLoFAspMatrix()
    pdchart._pd_projection_exact = True
    return True


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
    pdh, pdm, pds_ = util.decToDeg(pdinch.tz)
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
    return pdchart


def compute_celestial_pd_chart(radix, da, options):
    """Compute a celestial (non-terrestrial) PD-in-chart from signed arc *da*.

    Mirrors the calculation in PrimDirsListWnd.calc non-terrestrial branch
    (primdirslistwnd.py:68-118).
    """
    pd_options = chart_options(options)
    pdinch = pdsinchart.PDsInChart(radix, da)
    pdh, pdm, pds_ = util.decToDeg(pdinch.tz)
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
        if pl in _PLACIDIAN_POSITION_SYSTEMS:
            # Topocentric mundane longitude is PMP, the same canonical
            # coordinate used by mundane_chart_service and legacy MundaneWnd.
            # Routing Topocentric through the Regiomontanus pole/Q inverse was
            # the half-migration that displaced exact contacts on the wheel.
            pdchart.apply_mundane_profection(pdchartpls, radix.place.lat, radix.obl[0])
        else:
            pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
            pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
    elif pd_options.pdincharttyp == FROMZODIACALPOS:
        pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False, chart.Chart.YEAR, True)
        pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', pd_options, False, chart.Chart.YEAR, True)
        if pl in _PLACIDIAN_POSITION_SYSTEMS:
            pdchart.apply_mundane_profection(pdchartpls, radix.place.lat, radix.obl[0])
        else:
            pdchart.planets.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.planets.planets, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
            pdchart.fortune.calcRegioPDsInChartsPos(pdchart.houses.ascmc2, pdchartpls.fortune, radix.place.lat, radix.obl[0], pdchart.ayanamsha_offset)
    else:  # Full Astronomical Procedure
        pdchart = chart.Chart(radix.name, radix.male, tim, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
        pdchartpls = chart.Chart(radix.name, radix.male, radix.time, radix.place, chart.Chart.PDINCHART, '', pd_options, False)
        pdpls = pdchartpls.planets.planets
        if pd_options.pdinchartsecmotion:
            pdpls = pdchart.planets.planets
        raequasc, declequasc, dist = astrology.swe_cotrans(
            util.to_tropical_lon(pdchart.houses.ascmc[houses.Houses.EQUASC], pdchart.ayanamsha_offset),
            0.0, 1.0, -radix.obl[0],
        )
        pdchart.planets.calcFullAstronomicalProc(da, radix.obl[0], pdpls, pdchart.place.lat, pdchart.houses.ascmc2, raequasc, pdchart.ayanamsha_offset)
        pdchart.fortune.calcFullAstronomicalProc(pdchartpls.fortune, da, radix.obl[0], pdchart.ayanamsha_offset)
    pdchart._pd_arc_signed = float(da)
    pdchart._pd_arc_abs = math.fabs(float(da))
    pdchart._pd_direct = (da >= 0.0)
    pdchart._pd_exact_event = None
    return pdchart


def compute_pd_chart(radix, da, options, terrestrial=False):
    """Dispatch to celestial or terrestrial PD chart computation."""
    if terrestrial:
        return compute_terrestrial_pd_chart(radix, da, options)
    return compute_celestial_pd_chart(radix, da, options)
