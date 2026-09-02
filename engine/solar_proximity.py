# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Source-profiled solar proximity from an already calculated chart.

This module deliberately does no ephemeris work.  It classifies the ecliptic
longitude, latitude, and longitude-speed values already present on a chart so
the inspector and compact hover flag can share one semantic result.

The profiles are kept separate because "under the rays", combustion, and the
heart of the Sun are not one timeless set of numerical bands.  In particular,
some sources have no separate combustion tier, several require a same-sign
relationship, and Morin defines the heart from the true ecliptic centres.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from types import MappingProxyType
from typing import Mapping, Optional, Union

import astrology
import planets as planets_module


PROFILE_LATE_HELLENISTIC = "late_hellenistic"
PROFILE_AL_QABISI = "al_qabisi"
PROFILE_IBN_EZRA = "ibn_ezra"
PROFILE_LILLY_1647 = "lilly_1647"
PROFILE_MORIN_1661 = "morin_1661"

MITIGATION_IN_CHARIOT = "in_chariot"
MITIGATION_MERCURY_SLIGHT_HARM = "mercury_slight_harm"

DIGNITY_DOMICILE = "domicile"
DIGNITY_EXALTATION = "exaltation"
DIGNITY_EGYPTIAN_BOUND = "egyptian_bound"

RHETORIUS_DIGNITY_FRAME = "late_hellenistic"
RHETORIUS_DOMICILE_TABLE = "traditional_domiciles"
RHETORIUS_EXALTATION_TABLE = "traditional_exaltations"
RHETORIUS_BOUND_TABLE = "egyptian_bounds"

# Aries descends from Morinus and its existing celestial-state engine already
# uses AG16 freedom-of-light semantics.  Other traditions remain explicit
# selectable lenses rather than silently replacing that default.
DEFAULT_PROFILE = PROFILE_MORIN_1661

STATE_CLEAR = "clear"
STATE_UNDER_BEAMS = "under_beams"
STATE_COMBUST = "combust"
STATE_CAZIMI = "cazimi"

MOTION_ENTERING = "entering"
MOTION_EMERGING = "emerging"
MOTION_EXACT = "exact"
MOTION_INDETERMINATE = "indeterminate"

SOLAR_SIDE_ORIENTAL = "oriental"
SOLAR_SIDE_OCCIDENTAL = "occidental"
SOLAR_SIDE_CONJUNCT = "conjunct"
SOLAR_SIDE_INDETERMINATE = "indeterminate"

_SIXTEEN_MINUTES = 16.0 / 60.0
_SEVENTEEN_MINUTES = 17.0 / 60.0
_COMPARISON_TOLERANCE_DEG = 1.0e-12
_MOTION_TOLERANCE_DEG_PER_DAY = 1.0e-12


@dataclass(frozen=True)
class SolarProximityProfile:
    """Bibliographic identity for one source-defined rule set."""

    profile_id: str
    source_ref: str


_PROFILE_SOURCE_DATA = MappingProxyType({
    PROFILE_LATE_HELLENISTIC: {
        "source": "Rhetorius, Astrological Compendium, chs. 43 and 45 (Holden trans.)",
    },
    PROFILE_AL_QABISI: {
        "source": "al-Qabisi, Introduction to Astrology III.7, and Sahl ibn Bishr, Fifty Judgments 29 and 39 (Dykes trans., pp. 95-96)",
    },
    PROFILE_IBN_EZRA: {
        "source": "Abraham ibn Ezra, The Beginning of Wisdom, chs. VI-VII (Sela trans., pp. 193-201)",
    },
    PROFILE_LILLY_1647: {
        "source": "William Lilly, Christian Astrology (1647), Introduction, p. 113",
    },
    PROFILE_MORIN_1661: {
        "source": "Jean-Baptiste Morin, Astrologia Gallica 16, I.13 and III.1 (pp. 77, 124-125)",
    },
})

PROFILES: Mapping[str, SolarProximityProfile] = MappingProxyType({
    profile_id: SolarProximityProfile(profile_id, data["source"])
    for profile_id, data in _PROFILE_SOURCE_DATA.items()
})


CLASSICAL_BODY_IDS = frozenset((
    astrology.SE_MOON,
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
    astrology.SE_JUPITER,
    astrology.SE_SATURN,
))

# These are physical bodies for which the selected historical profile can be
# applied only as an explicit modern extension.  Mathematical points and the
# geocentric Earth placeholder are intentionally absent.
MODERN_PHYSICAL_BODY_IDS = frozenset((
    astrology.SE_URANUS,
    astrology.SE_NEPTUNE,
    astrology.SE_PLUTO,
    astrology.SE_CHIRON,
    astrology.SE_PHOLUS,
    astrology.SE_CERES,
    astrology.SE_PALLAS,
    astrology.SE_JUNO,
    astrology.SE_VESTA,
))

MATHEMATICAL_POINT_IDS = frozenset((
    astrology.SE_MEAN_NODE,
    astrology.SE_TRUE_NODE,
    astrology.SE_MEAN_APOG,
    astrology.SE_OSCU_APOG,
    astrology.SE_INTP_APOG,
    astrology.SE_INTP_PERG,
))


_MORIN_ORB_OF_VIRTUE_DEG = MappingProxyType({
    astrology.SE_MOON: 12.0,
    astrology.SE_MERCURY: 8.0,
    astrology.SE_VENUS: 13.0,
    astrology.SE_MARS: 6.5,
    astrology.SE_JUPITER: 8.0,
    astrology.SE_SATURN: 7.0,
})

_IBN_EZRA_LIMITS_DEG = MappingProxyType({
    astrology.SE_MOON: (6.0, 12.0),
    astrology.SE_MARS: (10.0, 15.0),
    astrology.SE_JUPITER: (6.0, 15.0),
    astrology.SE_SATURN: (6.0, 15.0),
})

# Rhetorius' chariot mitigation is a source doctrine, so its dignity test must
# not inherit the chart's currently selected or user-edited dignity tables.
# The Hellenistic frame uses the traditional domicile/exaltation rulers and
# Egyptian bounds, matching the source-owned dignity frame used elsewhere in
# the corpus engine.
_TRADITIONAL_DOMICILE_RULERS = (
    astrology.SE_MARS,
    astrology.SE_VENUS,
    astrology.SE_MERCURY,
    astrology.SE_MOON,
    astrology.SE_SUN,
    astrology.SE_MERCURY,
    astrology.SE_VENUS,
    astrology.SE_MARS,
    astrology.SE_JUPITER,
    astrology.SE_SATURN,
    astrology.SE_SATURN,
    astrology.SE_JUPITER,
)

_TRADITIONAL_EXALTATION_RULERS = MappingProxyType({
    0: astrology.SE_SUN,
    1: astrology.SE_MOON,
    3: astrology.SE_JUPITER,
    5: astrology.SE_MERCURY,
    6: astrology.SE_SATURN,
    9: astrology.SE_MARS,
    11: astrology.SE_VENUS,
})

_EGYPTIAN_BOUNDS = (
    ((astrology.SE_JUPITER, 6), (astrology.SE_VENUS, 6),
     (astrology.SE_MERCURY, 8), (astrology.SE_MARS, 5),
     (astrology.SE_SATURN, 5)),
    ((astrology.SE_VENUS, 8), (astrology.SE_MERCURY, 6),
     (astrology.SE_JUPITER, 8), (astrology.SE_SATURN, 5),
     (astrology.SE_MARS, 3)),
    ((astrology.SE_MERCURY, 6), (astrology.SE_JUPITER, 6),
     (astrology.SE_VENUS, 5), (astrology.SE_MARS, 7),
     (astrology.SE_SATURN, 6)),
    ((astrology.SE_MARS, 7), (astrology.SE_VENUS, 6),
     (astrology.SE_MERCURY, 6), (astrology.SE_JUPITER, 7),
     (astrology.SE_SATURN, 4)),
    ((astrology.SE_JUPITER, 6), (astrology.SE_VENUS, 5),
     (astrology.SE_SATURN, 7), (astrology.SE_MERCURY, 6),
     (astrology.SE_MARS, 6)),
    ((astrology.SE_MERCURY, 7), (astrology.SE_VENUS, 10),
     (astrology.SE_JUPITER, 4), (astrology.SE_MARS, 7),
     (astrology.SE_SATURN, 2)),
    ((astrology.SE_SATURN, 6), (astrology.SE_MERCURY, 8),
     (astrology.SE_JUPITER, 7), (astrology.SE_VENUS, 7),
     (astrology.SE_MARS, 2)),
    ((astrology.SE_MARS, 7), (astrology.SE_VENUS, 4),
     (astrology.SE_MERCURY, 8), (astrology.SE_JUPITER, 5),
     (astrology.SE_SATURN, 6)),
    ((astrology.SE_JUPITER, 12), (astrology.SE_VENUS, 5),
     (astrology.SE_MERCURY, 4), (astrology.SE_SATURN, 5),
     (astrology.SE_MARS, 4)),
    ((astrology.SE_MERCURY, 7), (astrology.SE_JUPITER, 7),
     (astrology.SE_VENUS, 8), (astrology.SE_SATURN, 4),
     (astrology.SE_MARS, 4)),
    ((astrology.SE_MERCURY, 7), (astrology.SE_VENUS, 6),
     (astrology.SE_JUPITER, 7), (astrology.SE_MARS, 5),
     (astrology.SE_SATURN, 5)),
    ((astrology.SE_VENUS, 12), (astrology.SE_JUPITER, 4),
     (astrology.SE_MERCURY, 3), (astrology.SE_MARS, 9),
     (astrology.SE_SATURN, 2)),
)


@dataclass(frozen=True)
class SolarProximityThresholds:
    """The resolved boundaries that produced a classification.

    ``cazimi_geometry`` is one of ``longitude``, ``longitude_same_sign``,
    ``longitude_and_latitude``, or ``ecliptic_centre``.  The Ibn Ezra
    inferior-planet branch is recorded explicitly because its ray boundary
    changes with whether the body is entering or emerging from solar
    proximity.
    """

    cazimi_limit_deg: float
    cazimi_inclusive: bool
    cazimi_geometry: str
    cazimi_same_sign: bool
    cazimi_latitude_limit_deg: Optional[float]
    combust_limit_deg: Optional[float]
    combust_inclusive: bool
    combust_same_sign: bool
    beams_limit_deg: float
    beams_inclusive: bool
    branch: str = "common"
    alternative_beams_limit_deg: Optional[float] = None
    body_orb_deg: Optional[float] = None


@dataclass(frozen=True)
class SolarMitigationEvidence:
    """Source-owned evidence for a solar-condition mitigation."""

    mitigation: str
    dignity: Optional[str] = None
    dignity_frame: Optional[str] = None
    table: Optional[str] = None
    basis: Optional[str] = None
    source_section: Optional[str] = None


@dataclass(frozen=True)
class SolarProximityResult:
    """Complete, source-auditable solar-condition result."""

    body_id: int
    state: Optional[str]
    source_term: Optional[str]
    lon_separation_deg: Optional[float]
    lat_separation_deg: Optional[float]
    centre_separation_deg: Optional[float]
    signed_elongation_deg: Optional[float]
    relative_longitude_speed_deg_per_day: Optional[float]
    motion: str
    solar_side: str
    same_sign: Optional[bool]
    threshold_data: Optional[SolarProximityThresholds]
    profile_id: str
    source_ref: str
    modern_extension: bool
    mitigations: tuple[str, ...]
    mitigation_evidence: tuple[SolarMitigationEvidence, ...]
    supported: bool
    reason: Optional[str]

    @property
    def longitude_separation_deg(self) -> Optional[float]:
        """Verbose alias for payload consumers."""

        return self.lon_separation_deg

    @property
    def latitude_separation_deg(self) -> Optional[float]:
        """Verbose alias for payload consumers."""

        return self.lat_separation_deg

    @property
    def motion_phase(self) -> str:
        """Alias spelling used by some inspector consumers."""

        return self.motion

    @property
    def thresholds(self) -> Optional[SolarProximityThresholds]:
        return self.threshold_data

    def as_dict(self) -> dict:
        """Return a JSON-ready nested mapping for a daemon payload."""

        payload = asdict(self)
        payload["mitigation_evidence"] = tuple(
            {
                key: value
                for key, value in evidence.items()
                if value is not None
            }
            for evidence in payload["mitigation_evidence"]
        )
        return payload


ProfileInput = Union[str, SolarProximityProfile]


def resolve_profile(profile: ProfileInput = DEFAULT_PROFILE) -> SolarProximityProfile:
    """Resolve a public profile ID, rejecting silent fallback."""

    profile_id = profile.profile_id if isinstance(profile, SolarProximityProfile) else str(profile)
    try:
        return PROFILES[profile_id]
    except KeyError as exc:
        valid = ", ".join(PROFILES)
        raise ValueError(f"Unknown solar-proximity profile {profile_id!r}; expected one of: {valid}") from exc


def _normalize_longitude(value: float) -> float:
    return float(value) % 360.0


def _signed_elongation(body_lon: float, sun_lon: float) -> float:
    return ((body_lon - sun_lon + 180.0) % 360.0) - 180.0


def _ecliptic_centre_separation_deg(
    body_lon: float,
    body_lat: float,
    sun_lon: float,
    sun_lat: float,
) -> float:
    """Great-circle separation of two ecliptic longitude/latitude centres."""

    lon_delta = math.radians(_signed_elongation(body_lon, sun_lon))
    lat_delta = math.radians(body_lat - sun_lat)
    body_lat_rad = math.radians(body_lat)
    sun_lat_rad = math.radians(sun_lat)
    haversine = (
        math.sin(lat_delta / 2.0) ** 2
        + math.cos(body_lat_rad) * math.cos(sun_lat_rad) * math.sin(lon_delta / 2.0) ** 2
    )
    haversine = min(1.0, max(0.0, haversine))
    return math.degrees(2.0 * math.asin(math.sqrt(haversine)))


def _within(value: float, limit: float, *, inclusive: bool) -> bool:
    if inclusive:
        return value <= limit + _COMPARISON_TOLERANCE_DEG
    return value < limit - _COMPARISON_TOLERANCE_DEG


def _motion_from_relative_speed(
    signed_elongation_deg: float,
    relative_speed_deg_per_day: float,
) -> str:
    if abs(signed_elongation_deg) <= _COMPARISON_TOLERANCE_DEG:
        return MOTION_EXACT
    if abs(relative_speed_deg_per_day) <= _MOTION_TOLERANCE_DEG_PER_DAY:
        return MOTION_INDETERMINATE
    separation_rate = math.copysign(1.0, signed_elongation_deg) * relative_speed_deg_per_day
    if separation_rate < 0.0:
        return MOTION_ENTERING
    if separation_rate > 0.0:
        return MOTION_EMERGING
    return MOTION_INDETERMINATE


def _solar_side(signed_elongation_deg: float) -> str:
    # Lower longitude rises before the Sun (oriental/matutine); higher
    # longitude sets after it (occidental/vespertine).
    if signed_elongation_deg < -_COMPARISON_TOLERANCE_DEG:
        return SOLAR_SIDE_ORIENTAL
    if signed_elongation_deg > _COMPARISON_TOLERANCE_DEG:
        return SOLAR_SIDE_OCCIDENTAL
    return SOLAR_SIDE_CONJUNCT


def _support_for_body(
    body_id: int,
    profile_id: str,
    include_modern: bool,
) -> tuple[bool, bool, Optional[str]]:
    if body_id == astrology.SE_SUN:
        return False, False, "sun_is_reference_body"
    if body_id in CLASSICAL_BODY_IDS:
        return True, False, None
    if body_id in MATHEMATICAL_POINT_IDS or body_id == astrology.SE_EARTH:
        return False, False, "mathematical_point_not_supported"
    if body_id in MODERN_PHYSICAL_BODY_IDS:
        if not include_modern:
            return False, False, "modern_body_requires_include_modern"
        if profile_id == PROFILE_IBN_EZRA:
            return False, False, "profile_has_no_generic_modern_geometry"
        return True, True, None
    return False, False, "body_role_not_supported"


def _unsupported_result(
    body_id: int,
    profile: SolarProximityProfile,
    reason: str,
    *,
    modern_extension: bool = False,
) -> SolarProximityResult:
    return SolarProximityResult(
        body_id=body_id,
        state=None,
        source_term=None,
        lon_separation_deg=None,
        lat_separation_deg=None,
        centre_separation_deg=None,
        signed_elongation_deg=None,
        relative_longitude_speed_deg_per_day=None,
        motion=MOTION_INDETERMINATE,
        solar_side=SOLAR_SIDE_INDETERMINATE,
        same_sign=None,
        threshold_data=None,
        profile_id=profile.profile_id,
        source_ref=profile.source_ref,
        modern_extension=modern_extension,
        mitigations=(),
        mitigation_evidence=(),
        supported=False,
        reason=reason,
    )


def _ibn_ezra_inferior_rays(
    motion: str,
    solar_side: str,
    body_longitude_speed: float,
) -> tuple[float, bool, str, Optional[float]]:
    """Resolve Ibn Ezra's phase-specific ray boundary for Venus/Mercury.

    Rḥ 6.7 gives 12° on both sides for the ordinary emerging/approaching
    phases.  The distinct 15° boundary begins only after an occidental planet
    has made its second station, turned retrograde, and is returning to the
    Sun.  Separation motion alone cannot identify that phase on both sides.
    """

    if (
        solar_side == SOLAR_SIDE_OCCIDENTAL
        and motion == MOTION_ENTERING
        and body_longitude_speed < -_MOTION_TOLERANCE_DEG_PER_DAY
    ):
        return 15.0, False, "occidental_entering_retrograde", None
    return 12.0, True, f"{solar_side}_{motion}", None


def _thresholds_for(
    profile_id: str,
    body_id: int,
    motion: str,
    solar_side: str,
    body_longitude_speed: float,
    modern_extension: bool,
) -> SolarProximityThresholds:
    if profile_id == PROFILE_LATE_HELLENISTIC:
        return SolarProximityThresholds(
            cazimi_limit_deg=1.0,
            cazimi_inclusive=False,
            cazimi_geometry="longitude_same_sign",
            cazimi_same_sign=True,
            cazimi_latitude_limit_deg=None,
            combust_limit_deg=None,
            combust_inclusive=False,
            combust_same_sign=False,
            beams_limit_deg=15.0,
            beams_inclusive=True,
        )

    if profile_id == PROFILE_AL_QABISI:
        return SolarProximityThresholds(
            cazimi_limit_deg=_SIXTEEN_MINUTES,
            cazimi_inclusive=True,
            cazimi_geometry="longitude_and_latitude",
            cazimi_same_sign=False,
            cazimi_latitude_limit_deg=_SIXTEEN_MINUTES,
            combust_limit_deg=None,
            combust_inclusive=False,
            combust_same_sign=False,
            beams_limit_deg=12.0,
            beams_inclusive=False,
        )

    if profile_id == PROFILE_IBN_EZRA:
        if body_id in (astrology.SE_MERCURY, astrology.SE_VENUS):
            beams_limit, beams_inclusive, branch, alternative = _ibn_ezra_inferior_rays(
                motion,
                solar_side,
                body_longitude_speed,
            )
            combust_limit = 7.0
        else:
            combust_limit, beams_limit = _IBN_EZRA_LIMITS_DEG[body_id]
            beams_inclusive = True
            if body_id == astrology.SE_MARS:
                branch = "ibn_ezra_15_with_ancient_18_variant"
                alternative = 18.0
            else:
                branch = "common"
                alternative = None
        return SolarProximityThresholds(
            cazimi_limit_deg=_SIXTEEN_MINUTES,
            cazimi_inclusive=body_id == astrology.SE_MOON,
            cazimi_geometry="longitude",
            cazimi_same_sign=False,
            cazimi_latitude_limit_deg=None,
            combust_limit_deg=combust_limit,
            combust_inclusive=True,
            combust_same_sign=False,
            beams_limit_deg=beams_limit,
            beams_inclusive=beams_inclusive,
            branch=branch,
            alternative_beams_limit_deg=alternative,
        )

    if profile_id == PROFILE_LILLY_1647:
        return SolarProximityThresholds(
            cazimi_limit_deg=_SEVENTEEN_MINUTES,
            cazimi_inclusive=True,
            cazimi_geometry="longitude",
            cazimi_same_sign=False,
            cazimi_latitude_limit_deg=None,
            combust_limit_deg=8.5,
            combust_inclusive=True,
            combust_same_sign=True,
            beams_limit_deg=17.0,
            beams_inclusive=True,
        )

    if profile_id == PROFILE_MORIN_1661:
        body_orb = None if modern_extension else _MORIN_ORB_OF_VIRTUE_DEG[body_id]
        combust_limit = None if body_orb is None else 18.0 - body_orb
        return SolarProximityThresholds(
            cazimi_limit_deg=_SIXTEEN_MINUTES,
            cazimi_inclusive=True,
            cazimi_geometry="ecliptic_centre",
            cazimi_same_sign=False,
            cazimi_latitude_limit_deg=None,
            combust_limit_deg=combust_limit,
            combust_inclusive=True,
            combust_same_sign=False,
            beams_limit_deg=18.0,
            beams_inclusive=True,
            branch="modern_generic_no_combust" if modern_extension else "planetary_orb_complement",
            body_orb_deg=body_orb,
        )

    raise AssertionError(f"Unresolved solar-proximity profile: {profile_id}")


def _is_cazimi(
    thresholds: SolarProximityThresholds,
    *,
    lon_separation_deg: float,
    lat_separation_deg: float,
    centre_separation_deg: float,
    same_sign: bool,
) -> bool:
    geometry = thresholds.cazimi_geometry
    if geometry == "ecliptic_centre":
        distance = centre_separation_deg
    else:
        distance = lon_separation_deg

    if thresholds.cazimi_same_sign and not same_sign:
        return False
    if not _within(distance, thresholds.cazimi_limit_deg, inclusive=thresholds.cazimi_inclusive):
        return False
    if geometry == "longitude_and_latitude":
        latitude_limit = thresholds.cazimi_latitude_limit_deg
        return latitude_limit is not None and _within(
            lat_separation_deg,
            latitude_limit,
            inclusive=thresholds.cazimi_inclusive,
        )
    return True


def _source_term(profile_id: str, state: str, motion: str) -> str:
    if profile_id == PROFILE_AL_QABISI:
        if state == STATE_CAZIMI:
            return "united"
        if state == STATE_UNDER_BEAMS:
            if motion == MOTION_ENTERING:
                return "undertaken_to_be_burned"
            if motion == MOTION_EMERGING:
                return "escaped"
            return "oppressed"
        return "in_own_light"

    terms = {
        PROFILE_LATE_HELLENISTIC: {
            STATE_CAZIMI: "in_heart",
            STATE_UNDER_BEAMS: "under_rays",
            STATE_CLEAR: "free_from_rays",
        },
        PROFILE_IBN_EZRA: {
            STATE_CAZIMI: "in_heart",
            STATE_COMBUST: "burned",
            STATE_UNDER_BEAMS: "under_rays",
            STATE_CLEAR: "free_from_rays",
        },
        PROFILE_LILLY_1647: {
            STATE_CAZIMI: "cazimi",
            STATE_COMBUST: "combust",
            STATE_UNDER_BEAMS: "under_sun_beams",
            STATE_CLEAR: "free_from_sun_beams",
        },
        PROFILE_MORIN_1661: {
            STATE_CAZIMI: "in_cazimi",
            STATE_COMBUST: "combust",
            STATE_UNDER_BEAMS: "under_sun_beams",
            STATE_CLEAR: "free_from_sun_beams",
        },
    }
    return terms[profile_id][state]


def classify_solar_proximity(
    *,
    body_id: int,
    body_longitude: float,
    body_latitude: float,
    body_longitude_speed: float,
    sun_longitude: float,
    sun_latitude: float,
    sun_longitude_speed: float,
    profile: ProfileInput = DEFAULT_PROFILE,
    include_modern: bool = False,
    in_chariot_dignity: Optional[str] = None,
) -> SolarProximityResult:
    """Classify supplied ecliptic coordinates without chart or ephemeris I/O."""

    profile_spec = resolve_profile(profile)
    body_id = int(body_id)
    supported, modern_extension, reason = _support_for_body(
        body_id,
        profile_spec.profile_id,
        bool(include_modern),
    )
    if not supported:
        return _unsupported_result(body_id, profile_spec, reason or "body_role_not_supported")

    values = (
        body_longitude,
        body_latitude,
        body_longitude_speed,
        sun_longitude,
        sun_latitude,
        sun_longitude_speed,
    )
    try:
        body_lon, body_lat, body_speed, sun_lon, sun_lat, sun_speed = (
            float(value) for value in values
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Solar-proximity coordinates and speeds must be numeric") from exc
    if not all(math.isfinite(value) for value in (
        body_lon, body_lat, body_speed, sun_lon, sun_lat, sun_speed
    )):
        raise ValueError("Solar-proximity coordinates and speeds must be finite")

    body_lon = _normalize_longitude(body_lon)
    sun_lon = _normalize_longitude(sun_lon)
    signed_elongation = _signed_elongation(body_lon, sun_lon)
    lon_separation = abs(signed_elongation)
    lat_separation = abs(body_lat - sun_lat)
    centre_separation = _ecliptic_centre_separation_deg(body_lon, body_lat, sun_lon, sun_lat)
    relative_speed = body_speed - sun_speed
    motion = _motion_from_relative_speed(signed_elongation, relative_speed)
    side = _solar_side(signed_elongation)
    same_sign = int(body_lon // 30.0) == int(sun_lon // 30.0)
    thresholds = _thresholds_for(
        profile_spec.profile_id,
        body_id,
        motion,
        side,
        body_speed,
        modern_extension,
    )

    if _is_cazimi(
        thresholds,
        lon_separation_deg=lon_separation,
        lat_separation_deg=lat_separation,
        centre_separation_deg=centre_separation,
        same_sign=same_sign,
    ):
        state = STATE_CAZIMI
    elif (
        thresholds.combust_limit_deg is not None
        and (same_sign or not thresholds.combust_same_sign)
        and _within(
            lon_separation,
            thresholds.combust_limit_deg,
            inclusive=thresholds.combust_inclusive,
        )
    ):
        state = STATE_COMBUST
    elif _within(
        lon_separation,
        thresholds.beams_limit_deg,
        inclusive=thresholds.beams_inclusive,
    ):
        state = STATE_UNDER_BEAMS
    else:
        state = STATE_CLEAR

    mitigations = ()
    mitigation_evidence = ()
    if (
        profile_spec.profile_id == PROFILE_LATE_HELLENISTIC
        and state == STATE_UNDER_BEAMS
        and in_chariot_dignity in {
            DIGNITY_DOMICILE,
            DIGNITY_EXALTATION,
            DIGNITY_EGYPTIAN_BOUND,
        }
    ):
        mitigations = (MITIGATION_IN_CHARIOT,)
        table = {
            DIGNITY_DOMICILE: RHETORIUS_DOMICILE_TABLE,
            DIGNITY_EXALTATION: RHETORIUS_EXALTATION_TABLE,
            DIGNITY_EGYPTIAN_BOUND: RHETORIUS_BOUND_TABLE,
        }[in_chariot_dignity]
        mitigation_evidence = (SolarMitigationEvidence(
            mitigation=MITIGATION_IN_CHARIOT,
            dignity=in_chariot_dignity,
            dignity_frame=RHETORIUS_DIGNITY_FRAME,
            table=table,
        ),)
    elif (
        profile_spec.profile_id == PROFILE_IBN_EZRA
        and body_id == astrology.SE_MERCURY
        and state in {STATE_COMBUST, STATE_UNDER_BEAMS}
    ):
        mitigations = (MITIGATION_MERCURY_SLIGHT_HARM,)
        mitigation_evidence = (SolarMitigationEvidence(
            mitigation=MITIGATION_MERCURY_SLIGHT_HARM,
            basis="mercury_solar_familiarity",
            source_section="ibn_ezra_beginning_wisdom_7_4_8",
        ),)

    return SolarProximityResult(
        body_id=body_id,
        state=state,
        source_term=_source_term(profile_spec.profile_id, state, motion),
        lon_separation_deg=lon_separation,
        lat_separation_deg=lat_separation,
        centre_separation_deg=centre_separation,
        signed_elongation_deg=signed_elongation,
        relative_longitude_speed_deg_per_day=relative_speed,
        motion=motion,
        solar_side=side,
        same_sign=same_sign,
        threshold_data=thresholds,
        profile_id=profile_spec.profile_id,
        source_ref=profile_spec.source_ref,
        modern_extension=modern_extension,
        mitigations=mitigations,
        mitigation_evidence=mitigation_evidence,
        supported=True,
        reason=None,
    )


def _body_from_chart(chrt, body_id: int):
    getter = getattr(chrt, "get_planet_body", None)
    if callable(getter):
        try:
            body = getter(body_id)
        except Exception:
            body = None
        if body is not None:
            return body

    if body_id == astrology.SE_CHIRON:
        body = getattr(chrt, "chiron", None)
        if body is not None:
            return body

    try:
        chart_planets = chrt.planets.planets
        if 0 <= body_id < len(chart_planets):
            return chart_planets[body_id]
    except (AttributeError, IndexError, TypeError):
        pass
    return None


def _rhetorius_chariot_dignity(body_id: int, longitude: float) -> Optional[str]:
    """Resolve Rhetorius' own domicile, exaltation, or Egyptian bound.

    The tables above are immutable source data.  The chart's active dignity
    selection is intentionally irrelevant to this historical profile.
    """

    body_id = int(body_id)
    longitude = _normalize_longitude(float(longitude))
    sign = int(longitude // 30.0)
    if _TRADITIONAL_DOMICILE_RULERS[sign] == body_id:
        return DIGNITY_DOMICILE
    if _TRADITIONAL_EXALTATION_RULERS.get(sign) == body_id:
        return DIGNITY_EXALTATION

    position = longitude % 30.0
    boundary = 0.0
    for ruler, span in _EGYPTIAN_BOUNDS[sign]:
        boundary += float(span)
        if position < boundary:
            if ruler == body_id:
                return DIGNITY_EGYPTIAN_BOUND
            break
    return None


def classify_chart_body(
    chrt,
    pid: int,
    profile: ProfileInput = DEFAULT_PROFILE,
    include_modern: bool = False,
) -> SolarProximityResult:
    """Classify one already-calculated chart body relative to its Sun.

    Missing or malformed chart data fails closed as an unsupported result;
    unknown profile IDs still raise ``ValueError`` so configuration mistakes
    cannot silently select another tradition.
    """

    profile_spec = resolve_profile(profile)
    try:
        body_id = int(pid)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid chart body id: {pid!r}") from exc

    supported, modern_extension, reason = _support_for_body(
        body_id,
        profile_spec.profile_id,
        bool(include_modern),
    )
    if not supported:
        return _unsupported_result(body_id, profile_spec, reason or "body_role_not_supported")

    sun = _body_from_chart(chrt, astrology.SE_SUN)
    body = _body_from_chart(chrt, body_id)
    if sun is None:
        return _unsupported_result(
            body_id,
            profile_spec,
            "sun_body_unavailable",
            modern_extension=modern_extension,
        )
    if body is None:
        return _unsupported_result(
            body_id,
            profile_spec,
            "body_unavailable",
            modern_extension=modern_extension,
        )

    try:
        sun_data = sun.data
        body_data = body.data
        return classify_solar_proximity(
            body_id=body_id,
            body_longitude=body_data[planets_module.Planet.LONG],
            body_latitude=body_data[planets_module.Planet.LAT],
            body_longitude_speed=body_data[planets_module.Planet.SPLON],
            sun_longitude=sun_data[planets_module.Planet.LONG],
            sun_latitude=sun_data[planets_module.Planet.LAT],
            sun_longitude_speed=sun_data[planets_module.Planet.SPLON],
            profile=profile_spec,
            include_modern=include_modern,
            in_chariot_dignity=(
                _rhetorius_chariot_dignity(
                    body_id,
                    body_data[planets_module.Planet.LONG],
                )
                if profile_spec.profile_id == PROFILE_LATE_HELLENISTIC
                else None
            ),
        )
    except (AttributeError, IndexError, TypeError, ValueError):
        return _unsupported_result(
            body_id,
            profile_spec,
            "body_data_unavailable",
            modern_extension=modern_extension,
        )


__all__ = [
    "CLASSICAL_BODY_IDS",
    "DEFAULT_PROFILE",
    "DIGNITY_DOMICILE",
    "DIGNITY_EGYPTIAN_BOUND",
    "DIGNITY_EXALTATION",
    "MATHEMATICAL_POINT_IDS",
    "MITIGATION_IN_CHARIOT",
    "MITIGATION_MERCURY_SLIGHT_HARM",
    "MODERN_PHYSICAL_BODY_IDS",
    "MOTION_EMERGING",
    "MOTION_ENTERING",
    "MOTION_EXACT",
    "MOTION_INDETERMINATE",
    "PROFILE_AL_QABISI",
    "PROFILE_IBN_EZRA",
    "PROFILE_LATE_HELLENISTIC",
    "PROFILE_LILLY_1647",
    "PROFILE_MORIN_1661",
    "PROFILES",
    "RHETORIUS_BOUND_TABLE",
    "RHETORIUS_DIGNITY_FRAME",
    "RHETORIUS_DOMICILE_TABLE",
    "RHETORIUS_EXALTATION_TABLE",
    "STATE_CAZIMI",
    "STATE_CLEAR",
    "STATE_COMBUST",
    "STATE_UNDER_BEAMS",
    SolarProximityProfile.__name__,
    SolarProximityResult.__name__,
    SolarProximityThresholds.__name__,
    SolarMitigationEvidence.__name__,
    "classify_chart_body",
    "classify_solar_proximity",
    "resolve_profile",
]
