# SPDX-FileCopyrightText: 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Pure row-coordinate geometry for ordinary zodiacal directions.

The public evaluator returns the raw signed arc produced by the selected
primary-direction system *before* :meth:`primdirs.PrimDirs.create` folds it to
an absolute arc plus a Direct/Converse flag.  Callers must provide the actual
promissor and significator ray longitudes; aspect magnitude and ray side are
therefore never inferred here.

The public point evaluator accepts explicit ray longitude/latitude pairs.  Its
ecliptic-foot wrapper preserves the original zero-latitude API.  Resolving a
body's configured Bianchini/Morin aspect terminus remains the caller's job;
once resolved, the same native system equation applies here.  Secondary
motion, mundane rows, midpoints, and parallels have different contracts.
"""

from __future__ import annotations

import math
from types import MappingProxyType
from typing import Callable

import astrology
import houses
import primdirs
import util


class PDRowGeometryUndefined(ValueError):
    """The requested row coordinate has no real solution."""


def _equatorial(
    radix, longitude: float, latitude: float = 0.0
) -> tuple[float, float]:
    """Convert one chart-frame ecliptic point to intrinsic RA/declination."""
    ra, decl, _distance = astrology.swe_cotrans(
        util.to_tropical_lon(
            util.normalize(float(longitude)),
            float(getattr(radix, "ayanamsha_offset", 0.0)),
        ),
        float(latitude),
        1.0,
        -float(radix.obl[0]),
    )
    return float(ra), float(decl)


def _asin_degrees(value: float, label: str) -> float:
    # Match the engine's strict real-geometry guard.  A tiny floating-point
    # overshoot at an exact tangent is safe to clamp; a material overshoot is
    # circumpolar/undefined and must never become a plausible-looking arc.
    if not math.isfinite(value) or abs(value) > 1.0 + 1.0e-14:
        raise PDRowGeometryUndefined(f"{label} is outside real geometry")
    return math.degrees(math.asin(max(-1.0, min(1.0, value))))


def _ramc_raic(radix) -> tuple[float, float]:
    ramc = float(radix.houses.ascmc2[houses.Houses.MC][houses.Houses.RA])
    return ramc, util.normalize(ramc + 180.0)


def _is_eastern(ra: float, ramc: float, raic: float) -> bool:
    # Same branch test as PlacidianUTPPD.getData and
    # RegioCampBasePD.getZodW.
    if ramc > raic:
        return not (raic < ra < ramc)
    return not ((raic < ra < 360.0) or (0.0 < ra < ramc))


def _meridian_state(
    ra: float,
    decl: float,
    ramc: float,
    raic: float,
    geographic_latitude: float,
) -> tuple[bool, bool, float, float, float]:
    """Return eastern, above-horizon, local MD, SA, and geographic AD."""
    eastern = _is_eastern(ra, ramc, raic)
    md_mc = abs(ramc - ra)
    if md_mc > 180.0:
        md_mc = 360.0 - md_mc
    md_ic = abs(raic - ra)
    if md_ic > 180.0:
        md_ic = 360.0 - md_ic

    ad_geo = _asin_degrees(
        math.tan(math.radians(geographic_latitude))
        * math.tan(math.radians(decl)),
        "geographic ascensional difference",
    )
    diurnal_sa = 90.0 + ad_geo
    nocturnal_sa = 90.0 - ad_geo
    above_horizon = md_mc <= diurnal_sa
    if above_horizon:
        return eastern, True, md_mc, diurnal_sa, ad_geo
    return eastern, False, md_ic, nocturnal_sa, ad_geo


def _placidian_sa(
    radix,
    promissor_lon: float,
    promissor_lat: float,
    significator_lon: float,
    significator_lat: float,
) -> float:
    # Canonical owner: PlacidianSAPD.getZodMDSA/getvars/toPlanet.  Keep the
    # original shared zero-latitude owner on that exact path.
    if float(promissor_lat) == 0.0 and float(significator_lat) == 0.0:
        arc = primdirs.placidian_sa_ecliptic_foot_arc(
            radix, promissor_lon, significator_lon
        )
        if arc is None or not math.isfinite(float(arc)):
            raise PDRowGeometryUndefined("Placidian semiarc is undefined")
        return float(arc)

    ramc, raic = _ramc_raic(radix)
    geographic_latitude = float(radix.place.lat)
    ra_sig, decl_sig = _equatorial(radix, significator_lon, significator_lat)
    eastern, above, md, sa, _ad_geo = _meridian_state(
        ra_sig, decl_sig, ramc, raic, geographic_latitude
    )
    if not math.isfinite(sa) or abs(sa) <= 1.0e-15:
        raise PDRowGeometryUndefined("significator semiarc is zero")
    ra_prom, decl_prom = _equatorial(radix, promissor_lon, promissor_lat)
    ad_prom = _asin_degrees(
        math.tan(math.radians(geographic_latitude))
        * math.tan(math.radians(decl_prom)),
        "promissor ascensional difference",
    )
    t = 1.0 if (eastern and not above) or (not eastern and above) else -1.0
    v = 1.0 if above else -1.0
    reference_ra = ramc if above else raic
    ra_difference = (
        (float(ra_prom) - float(reference_ra) + 180.0) % 360.0
    ) - 180.0
    return ra_difference + t * (90.0 + v * ad_prom) * md / sa


def _under_pole(
    radix,
    promissor_lon: float,
    promissor_lat: float,
    significator_lon: float,
    significator_lat: float,
    *,
    topocentric: bool,
) -> float:
    """UTP/Topocentric OA(promissor under significator pole) - OA(sig)."""
    # Canonical owners:
    # - PlacidianUTPPD.getData/toPlanet: AD_phi=(MD/SA)*AD_geo, then
    #   phi=atan(sin(AD_phi)/tan(decl_sig)).
    # - TopocentricPD.getData via topocentric_pole.compute: the Polich/Page
    #   cone uses tan(phi)=(MD/SA)*tan(geographic latitude).
    ramc, raic = _ramc_raic(radix)
    geographic_latitude = float(radix.place.lat)
    ra_sig, decl_sig = _equatorial(radix, significator_lon, significator_lat)
    eastern, _above, md, sa, ad_geo = _meridian_state(
        ra_sig, decl_sig, ramc, raic, geographic_latitude
    )
    if not math.isfinite(sa) or abs(sa) <= 1.0e-15:
        raise PDRowGeometryUndefined("significator semiarc is zero")

    if topocentric:
        tan_phi = (md / sa) * math.tan(math.radians(geographic_latitude))
        phi = math.degrees(math.atan(tan_phi))
        ad_sig = _asin_degrees(
            math.tan(math.radians(decl_sig)) * tan_phi,
            "Topocentric significator ascensional difference",
        )
    else:
        ad_phi = abs(md) * ad_geo / abs(sa)
        tan_decl_sig = math.tan(math.radians(decl_sig))
        # Preserve PlacidianUTPPD.getData's exact branch.  At a nominal
        # equinoctial foot Swiss cotrans can return a tiny nonzero declination;
        # sin(AD_phi) carries the same scale, and their ratio still defines the
        # real under-the-pole phi.  Treating that value as approximate zero
        # collapses a valid pole and materially changes the row arc.
        if tan_decl_sig == 0.0:
            phi = 0.0
        else:
            phi = math.degrees(
                math.atan(math.sin(math.radians(ad_phi)) / tan_decl_sig)
            )
        ad_sig = ad_phi

    oa_sig = ra_sig - ad_sig if eastern else ra_sig + ad_sig
    ra_prom, decl_prom = _equatorial(radix, promissor_lon, promissor_lat)
    ad_prom = _asin_degrees(
        math.tan(math.radians(decl_prom)) * math.tan(math.radians(phi)),
        "promissor ascensional difference under significator pole",
    )
    oa_prom = ra_prom - ad_prom if eastern else ra_prom + ad_prom
    return oa_prom - oa_sig


def _regiomontan_zenith_distance(
    md: float, geographic_latitude: float, decl: float, upper_meridian: bool
) -> float:
    """Planet.getZD, kept local so evaluation never mutates/constructs a body."""
    # Canonical owner: planets.Planet.getZD, called by
    # RegioCampBasePD.getZodW.  Regiomontanus and Campanus use this same W
    # coordinate for ordinary zero-latitude zodiacal body/ray rows; their
    # mundane aspect/cusp constructions differ elsewhere.
    if md == 90.0:
        return 90.0 - math.degrees(
            math.atan(math.sin(abs(math.radians(geographic_latitude))))
            * math.tan(math.radians(decl))
        )
    if md >= 90.0:
        return 0.0

    a = math.degrees(
        math.atan(
            math.cos(math.radians(geographic_latitude))
            * math.tan(math.radians(md))
        )
    )
    b = math.degrees(
        math.atan(
            math.tan(abs(math.radians(geographic_latitude)))
            * math.cos(math.radians(md))
        )
    )
    c = 0.0
    if (decl < 0.0 and geographic_latitude < 0.0) or (
        decl >= 0.0 and geographic_latitude >= 0.0
    ):
        c = b - abs(decl) if upper_meridian else b + abs(decl)
    elif (decl < 0.0 and geographic_latitude > 0.0) or (
        decl > 0.0 and geographic_latitude < 0.0
    ):
        c = b + abs(decl) if upper_meridian else b - abs(decl)
    f = math.degrees(
        math.atan(
            math.sin(abs(math.radians(geographic_latitude)))
            * math.sin(math.radians(md))
            * math.tan(math.radians(c))
        )
    )
    return a + f


def _regio_campanus(
    radix,
    promissor_lon: float,
    promissor_lat: float,
    significator_lon: float,
    significator_lat: float,
) -> float:
    ramc, raic = _ramc_raic(radix)
    geographic_latitude = float(radix.place.lat)
    ra_sig, decl_sig = _equatorial(radix, significator_lon, significator_lat)
    eastern = _is_eastern(ra_sig, ramc, raic)

    md_mc = abs(ramc - ra_sig)
    if md_mc > 180.0:
        md_mc = 360.0 - md_mc
    md_ic = abs(raic - ra_sig)
    if md_ic > 180.0:
        md_ic = 360.0 - md_ic
    upper_meridian = md_mc <= md_ic
    md = md_mc if upper_meridian else md_ic

    zd = _regiomontan_zenith_distance(
        md, geographic_latitude, decl_sig, upper_meridian
    )
    pole = _asin_degrees(
        math.sin(math.radians(geographic_latitude))
        * math.sin(math.radians(zd)),
        "Regiomontanus significator pole",
    )
    q_sig = _asin_degrees(
        math.tan(math.radians(decl_sig)) * math.tan(math.radians(pole)),
        "Regiomontanus significator Q",
    )
    w_sig = util.normalize(ra_sig - q_sig if eastern else ra_sig + q_sig)

    ra_prom, decl_prom = _equatorial(radix, promissor_lon, promissor_lat)
    q_prom = _asin_degrees(
        math.tan(math.radians(decl_prom)) * math.tan(math.radians(pole)),
        "promissor Q under significator pole",
    )
    w_prom = util.normalize(
        ra_prom - q_prom if eastern else ra_prom + q_prom
    )
    return w_prom - w_sig


def _utp(
    radix,
    promissor_lon: float,
    promissor_lat: float,
    significator_lon: float,
    significator_lat: float,
) -> float:
    return _under_pole(
        radix,
        promissor_lon,
        promissor_lat,
        significator_lon,
        significator_lat,
        topocentric=False,
    )


def _topocentric(
    radix,
    promissor_lon: float,
    promissor_lat: float,
    significator_lon: float,
    significator_lat: float,
) -> float:
    return _under_pole(
        radix,
        promissor_lon,
        promissor_lat,
        significator_lon,
        significator_lat,
        topocentric=True,
    )


_EVALUATORS: dict[int, Callable[[object, float, float, float, float], float]] = {
    primdirs.PrimDirs.PLACIDIANSEMIARC: _placidian_sa,
    primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE: _utp,
    primdirs.PrimDirs.REGIOMONTAN: _regio_campanus,
    primdirs.PrimDirs.CAMPANIAN: _regio_campanus,
    primdirs.PrimDirs.TOPOCENTRIC: _topocentric,
}

ECLIPTIC_FOOT_EVALUATORS = MappingProxyType(_EVALUATORS)
SUPPORTED_ECLIPTIC_FOOT_SYSTEMS = frozenset(_EVALUATORS)


def evaluate_ecliptic_foot_arc(
    system: int,
    radix,
    promissor_ray_longitude: float,
    significator_ray_longitude: float,
) -> float:
    """Return the system-native raw signed arc between two ecliptic feet.

    Longitudes are expressed in the radix chart's display frame.  The
    evaluator performs exactly one sidereal-to-tropical recovery before each
    ecliptic-to-equatorial conversion.  It neither folds the result at 180
    degrees nor assigns Direct/Converse; that remains the row owner's job.
    """
    arc = evaluate_ecliptic_point_arc(
        system,
        radix,
        promissor_ray_longitude,
        0.0,
        significator_ray_longitude,
        0.0,
    )
    return arc


def evaluate_ecliptic_point_arc(
    system: int,
    radix,
    promissor_ray_longitude: float,
    promissor_ray_latitude: float,
    significator_ray_longitude: float,
    significator_ray_latitude: float,
) -> float:
    """Return the native raw arc between two explicit ecliptic points.

    The longitudes use the radix display frame and the latitudes are true
    ecliptic latitudes.  Callers must already have resolved the selected
    aspect side and any Bianchini/Morin correction.
    """
    try:
        evaluator = _EVALUATORS[int(system)]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Unsupported primary-direction system: {system!r}") from exc
    arc = float(
        evaluator(
            radix,
            float(promissor_ray_longitude),
            float(promissor_ray_latitude),
            float(significator_ray_longitude),
            float(significator_ray_latitude),
        )
    )
    if not math.isfinite(arc):
        raise PDRowGeometryUndefined("row evaluator returned a non-finite arc")
    return arc
