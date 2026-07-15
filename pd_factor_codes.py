# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical Primary Directions factor-code registry.

The PD engines store promissors and significators as integers, but not every
integer is a Swiss Ephemeris id.  This registry records the Aries PD code space
in one place so matchers, reports, and audit scripts resolve promissor and
significator codes the same way.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import astrology
import chart
import primdirs


ROLE_PROMISSOR = "promissor"
ROLE_SIGNIFICATOR = "significator"
ROLE_PROMISSOR_SECOND = "promissor_second"
ROLE_PARALLEL_AXIS = "parallel_axis"

KIND_BODY = "body"
KIND_NODE = "node"
KIND_ANGLE = "angle"
KIND_CUSP = "cusp"
KIND_LOT = "lot"
KIND_SYZYGY = "syzygy"
KIND_CUSTOMER = "customer"
KIND_ANTISCIA = "antiscia"
KIND_TERM = "term"
KIND_FIXED_STAR = "fixed_star"

SOUTH_NODE_CODE = astrology.SE_TRUE_NODE
DESC_NODE_CODE = -10001
SOUTH_NODE_CODES = frozenset((SOUTH_NODE_CODE, DESC_NODE_CODE))


@dataclass(frozen=True)
class PDFactorInfo:
    code: int
    token: str
    short_token: str
    kind: str
    roles: frozenset[str]
    canonical_code: int | None = None
    label: str = ""

    def __post_init__(self) -> None:
        if self.canonical_code is None:
            object.__setattr__(self, "canonical_code", self.code)
        if not self.label:
            object.__setattr__(self, "label", self.short_token)


_BODIES = (
    (astrology.SE_SUN, "Sun", "SUN"),
    (astrology.SE_MOON, "Moon", "MON"),
    (astrology.SE_MERCURY, "Mercury", "MER"),
    (astrology.SE_VENUS, "Venus", "VEN"),
    (astrology.SE_MARS, "Mars", "MAR"),
    (astrology.SE_JUPITER, "Jupiter", "JUP"),
    (astrology.SE_SATURN, "Saturn", "SAT"),
    (astrology.SE_URANUS, "Uranus", "URA"),
    (astrology.SE_NEPTUNE, "Neptune", "NEP"),
    (astrology.SE_PLUTO, "Pluto", "PLU"),
)

_ANGLES = (
    (primdirs.PrimDir.ASC, "ASC", "ASC"),
    (primdirs.PrimDir.DESC, "DSC", "DSC"),
    (primdirs.PrimDir.MC, "MC", "MC"),
    (primdirs.PrimDir.IC, "IC", "IC"),
)

_CUSPS = (
    (primdirs.PrimDir.HC2, "cusp_2", "II"),
    (primdirs.PrimDir.HC3, "cusp_3", "III"),
    (primdirs.PrimDir.HC5, "cusp_5", "V"),
    (primdirs.PrimDir.HC6, "cusp_6", "VI"),
    (primdirs.PrimDir.HC8, "cusp_8", "VIII"),
    (primdirs.PrimDir.HC9, "cusp_9", "IX"),
    (primdirs.PrimDir.HC11, "cusp_11", "XI"),
    (primdirs.PrimDir.HC12, "cusp_12", "XII"),
)

_ALL_ROLES = frozenset((ROLE_PROMISSOR, ROLE_SIGNIFICATOR))
_PROM_ROLES = frozenset((ROLE_PROMISSOR,))
_SIG_ROLES = frozenset((ROLE_SIGNIFICATOR,))
_PROM2_ROLES = frozenset((ROLE_PROMISSOR_SECOND,))
_ANGLE_ROLES = frozenset((ROLE_PROMISSOR, ROLE_SIGNIFICATOR, ROLE_PARALLEL_AXIS))


def _build_static_infos() -> dict[int, PDFactorInfo]:
    infos: dict[int, PDFactorInfo] = {}
    for code, token, short in _BODIES:
        infos[code] = PDFactorInfo(code, token, short, KIND_BODY, _ALL_ROLES)
    infos[astrology.SE_MEAN_NODE] = PDFactorInfo(
        astrology.SE_MEAN_NODE, "North_Node", "ANO", KIND_NODE, _ALL_ROLES
    )
    infos[SOUTH_NODE_CODE] = PDFactorInfo(
        SOUTH_NODE_CODE, "South_Node", "SNO", KIND_NODE, _ALL_ROLES
    )
    infos[DESC_NODE_CODE] = PDFactorInfo(
        DESC_NODE_CODE,
        "South_Node",
        "SNO",
        KIND_NODE,
        _ALL_ROLES,
        canonical_code=SOUTH_NODE_CODE,
    )
    for code, token, short in _ANGLES:
        infos[code] = PDFactorInfo(code, token, short, KIND_ANGLE, _ANGLE_ROLES)
    for code, token, short in _CUSPS:
        infos[code] = PDFactorInfo(code, token, short, KIND_CUSP, _ALL_ROLES)
    infos[primdirs.PrimDir.LOF] = PDFactorInfo(
        primdirs.PrimDir.LOF, "fortune", "PF", KIND_LOT, _ALL_ROLES
    )
    infos[primdirs.PrimDir.SYZ] = PDFactorInfo(
        primdirs.PrimDir.SYZ, "syzygy", "SYZ", KIND_SYZYGY, _SIG_ROLES
    )
    infos[primdirs.PrimDir.CUSTOMERPD] = PDFactorInfo(
        primdirs.PrimDir.CUSTOMERPD, "customer", "USER", KIND_CUSTOMER, _ALL_ROLES
    )
    return infos


STATIC_FACTOR_INFOS = _build_static_infos()

DYNAMIC_POINT_INFOS: dict[str, PDFactorInfo] = {
    "user_prom": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "customer", "USERP", KIND_CUSTOMER, _PROM_ROLES),
    "user_sig": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "customer", "USERS", KIND_CUSTOMER, _SIG_ROLES),
    "chiron": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "Chiron", "CHIRON", KIND_CUSTOMER, _ALL_ROLES),
    "vertex": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "Vertex", "VERTEX", KIND_CUSTOMER, _SIG_ROLES),
    "arabic_part_prom": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "Arabic_Part", "ARABIC_PART", KIND_CUSTOMER, _PROM_ROLES),
    "arabic_part_sig": PDFactorInfo(primdirs.PrimDir.CUSTOMERPD, "Arabic_Part", "ARABIC_PART", KIND_CUSTOMER, _SIG_ROLES),
}


def canonical_factor_code(code: int) -> int:
    """Return the canonical storage code for exact-factor matching."""

    value = int(code)
    if value in SOUTH_NODE_CODES:
        return SOUTH_NODE_CODE
    return value


def canonical_south_node_code(code: int) -> int:
    return canonical_factor_code(code)


def sno_equivalent_pair(prom_code: int, sig_code: int) -> frozenset[int]:
    return frozenset((canonical_factor_code(prom_code), canonical_factor_code(sig_code)))


def factor_info(code: int, role: str | None = None, dynamic_key: str | None = None) -> PDFactorInfo | None:
    """Resolve a PD factor code.

    Ranged promissor classes (antiscia, terms, fixed stars) are returned as
    family infos because their exact display labels need the chart payload.
    """

    value = int(code)
    if value == primdirs.PrimDir.NONE:
        return None
    if value == primdirs.PrimDir.CUSTOMERPD and dynamic_key:
        info = DYNAMIC_POINT_INFOS.get(str(dynamic_key), STATIC_FACTOR_INFOS.get(value))
    else:
        info = STATIC_FACTOR_INFOS.get(value)
    if info is None:
        info = ranged_factor_info(value)
    if info is None:
        return None
    if role is not None and role not in info.roles:
        return None
    return info


def ranged_factor_info(code: int) -> PDFactorInfo | None:
    value = int(code)
    if primdirs.PrimDir.ANTISCION <= value < primdirs.PrimDir.CONTRAANT:
        base = _antiscia_base_info(value, primdirs.PrimDir.ANTISCION, "Antiscion")
        if base is not None:
            return base
    if primdirs.PrimDir.CONTRAANT <= value < primdirs.PrimDir.TERM:
        base = _antiscia_base_info(value, primdirs.PrimDir.CONTRAANT, "Contraantiscion")
        if base is not None:
            return base
    if primdirs.PrimDir.TERM <= value < primdirs.PrimDir.FIXSTAR:
        sign_index = value - primdirs.PrimDir.TERM
        if 0 <= sign_index < 12:
            return PDFactorInfo(value, f"term_{sign_index}", f"TERM_{sign_index + 1}", KIND_TERM, _PROM_ROLES)
        return None
    if value >= primdirs.PrimDir.FIXSTAR:
        return PDFactorInfo(value, "fixed_star", "FIXSTAR", KIND_FIXED_STAR, _PROM_ROLES)
    return None


def _antiscia_base_info(code: int, base: int, prefix: str) -> PDFactorInfo | None:
    if code == base + 12:
        return None
    if code == base + 13:
        return PDFactorInfo(code, f"{prefix}_fortune", f"{prefix.upper()}_PF", KIND_ANTISCIA, _PROM_ROLES)
    if code == base + 14:
        return PDFactorInfo(code, f"{prefix}_ASC", f"{prefix.upper()}_ASC", KIND_ANTISCIA, _PROM_ROLES)
    if code == base + 15:
        return PDFactorInfo(code, f"{prefix}_MC", f"{prefix.upper()}_MC", KIND_ANTISCIA, _PROM_ROLES)
    body_index = code - base
    body = STATIC_FACTOR_INFOS.get(body_index)
    if body is None:
        return None
    return PDFactorInfo(code, f"{prefix}_{body.token}", f"{prefix.upper()}_{body.short_token}", KIND_ANTISCIA, _PROM_ROLES)


def factor_to_token(code: int, role: str | None = None, dynamic_key: str | None = None) -> str:
    info = factor_info(code, role=role, dynamic_key=dynamic_key)
    return info.token if info is not None else ""


def factor_to_short_token(code: int, role: str | None = None, dynamic_key: str | None = None) -> str:
    info = factor_info(code, role=role, dynamic_key=dynamic_key)
    return info.short_token if info is not None else ""


TOKEN_TO_FACTOR_CODE: dict[str, int] = {}
for _info in STATIC_FACTOR_INFOS.values():
    TOKEN_TO_FACTOR_CODE[_info.token] = int(_info.canonical_code)
    TOKEN_TO_FACTOR_CODE[_info.short_token] = int(_info.canonical_code)
TOKEN_TO_FACTOR_CODE.update({
    "DESC": TOKEN_TO_FACTOR_CODE.get("DSC", 13),  # report tables print "DESC"
    "MOON": astrology.SE_MOON,
    "NOR": astrology.SE_MEAN_NODE,
    "DNO": SOUTH_NODE_CODE,
    "LOF": primdirs.PrimDir.LOF,
    "Part_of_Fortune": primdirs.PrimDir.LOF,
})


def factor_code_for_token(token: str) -> int | None:
    return TOKEN_TO_FACTOR_CODE.get(str(token))


OPPOSITE_FACTOR: dict[int, int] = {
    primdirs.PrimDir.ASC: primdirs.PrimDir.DESC,
    primdirs.PrimDir.DESC: primdirs.PrimDir.ASC,
    primdirs.PrimDir.MC: primdirs.PrimDir.IC,
    primdirs.PrimDir.IC: primdirs.PrimDir.MC,
    primdirs.PrimDir.HC2: primdirs.PrimDir.HC8,
    primdirs.PrimDir.HC8: primdirs.PrimDir.HC2,
    primdirs.PrimDir.HC3: primdirs.PrimDir.HC9,
    primdirs.PrimDir.HC9: primdirs.PrimDir.HC3,
    primdirs.PrimDir.HC5: primdirs.PrimDir.HC11,
    primdirs.PrimDir.HC11: primdirs.PrimDir.HC5,
    primdirs.PrimDir.HC6: primdirs.PrimDir.HC12,
    primdirs.PrimDir.HC12: primdirs.PrimDir.HC6,
}

SUPPLEMENTARY_ASPECT: dict[int, int] = {
    chart.Chart.CONJUNCTIO: chart.Chart.OPPOSITIO,
    chart.Chart.OPPOSITIO: chart.Chart.CONJUNCTIO,
    chart.Chart.SEMISEXTIL: chart.Chart.QUINQUNX,
    chart.Chart.QUINQUNX: chart.Chart.SEMISEXTIL,
    chart.Chart.SEMIQUADRAT: chart.Chart.SESQUIQUADRAT,
    chart.Chart.SESQUIQUADRAT: chart.Chart.SEMIQUADRAT,
    chart.Chart.SEXTIL: chart.Chart.TRIGON,
    chart.Chart.TRIGON: chart.Chart.SEXTIL,
    chart.Chart.QUADRAT: chart.Chart.QUADRAT,
}

NODE_AXIS_FLIP: dict[int, bool] = {
    astrology.SE_MEAN_NODE: False,
    SOUTH_NODE_CODE: True,
    DESC_NODE_CODE: True,
}


def canonical_axis_factor_aspect(factor_code: int, aspect: int) -> tuple[int, int]:
    """Canonicalize factor/aspect under opposite-cusp and node-axis equivalence.

    This is for duplicate-evidence collapse only.  Exact matching should use
    :func:`canonical_factor_code`, which does not turn South Node into North Node.
    """

    factor = int(factor_code)
    if factor in NODE_AXIS_FLIP:
        flip = NODE_AXIS_FLIP[factor]
        canonical_aspect = SUPPLEMENTARY_ASPECT.get(aspect, aspect) if flip else aspect
        return astrology.SE_MEAN_NODE, canonical_aspect
    opposite = OPPOSITE_FACTOR.get(factor)
    if opposite is None:
        return factor, aspect
    opposite_aspect = SUPPLEMENTARY_ASPECT.get(aspect, aspect)
    if opposite < factor:
        return opposite, opposite_aspect
    return factor, aspect


def canonical_axis_direction_triple(prom_code: int, sig_code: int, aspect: int) -> tuple[int, int, int]:
    prom_code, aspect = canonical_axis_factor_aspect(prom_code, aspect)
    sig_code, aspect = canonical_axis_factor_aspect(sig_code, aspect)
    return prom_code, sig_code, aspect


def audit_direction_factor_codes(directions: Iterable[object]) -> dict[str, list[tuple[int, object]]]:
    """Return unresolved prom/sig/prom2/parallel-axis codes from PD-like rows."""

    missing: dict[str, list[tuple[int, object]]] = {
        ROLE_PROMISSOR: [],
        ROLE_SIGNIFICATOR: [],
        ROLE_PROMISSOR_SECOND: [],
        ROLE_PARALLEL_AXIS: [],
    }
    for direction in directions:
        prom = getattr(direction, "prom_code", getattr(direction, "prom", primdirs.PrimDir.NONE))
        sig = getattr(direction, "sig_code", getattr(direction, "sig", primdirs.PrimDir.NONE))
        promdyn = getattr(direction, "promdyn", None)
        sigdyn = getattr(direction, "sigdyn", None)
        if factor_info(prom, role=ROLE_PROMISSOR, dynamic_key=promdyn) is None:
            missing[ROLE_PROMISSOR].append((int(prom), direction))
        if factor_info(sig, role=ROLE_SIGNIFICATOR, dynamic_key=sigdyn) is None:
            missing[ROLE_SIGNIFICATOR].append((int(sig), direction))
        prom2 = getattr(direction, "prom2", primdirs.PrimDir.NONE)
        if prom2 != primdirs.PrimDir.NONE and factor_info(prom2, role=ROLE_PROMISSOR_SECOND) is None:
            info = factor_info(prom2, role=ROLE_PROMISSOR)
            if info is None or info.kind not in (KIND_BODY, KIND_NODE):
                missing[ROLE_PROMISSOR_SECOND].append((int(prom2), direction))
        parallelaxis = getattr(direction, "parallelaxis", 0)
        if parallelaxis and factor_info(parallelaxis, role=ROLE_PARALLEL_AXIS) is None:
            missing[ROLE_PARALLEL_AXIS].append((int(parallelaxis), direction))
    return {role: rows for role, rows in missing.items() if rows}
