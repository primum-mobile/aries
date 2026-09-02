# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Primary Directions point-id helpers.

The Primary Directions engine has its own point namespace. Some of its ids
collide with Swiss Ephemeris body ids, most visibly ``PrimDir.IC`` and
``astrology.SE_CHIRON`` both being 15. PD list/overlay renderers must classify
the PD point first, then ask planet glyph tables only for true planet slots.
"""
from __future__ import annotations

from typing import Any, Optional

import astrology
import common
import fixstars
import mtexts
from primdirs import PrimDir


PRIMDIR_ANGLE_LABEL_KEYS = ("Asc", "Dsc", "MC", "IC")
PRIMDIR_HOUSE_CUSP_LABEL_KEYS = ("HC2", "HC3", "HC5", "HC6", "HC8", "HC9", "HC11", "HC12")
PRIMDIR_ANGLE_POINT_IDS = ("angle:asc", "angle:dsc", "angle:mc", "angle:ic")
PRIMDIR_HOUSE_CUSP_NUMBERS = (2, 3, 5, 6, 8, 9, 11, 12)
_POINT_LOF_ID = "point:lof"
_ANGLE_ASC_ID = "angle:asc"
_ANGLE_MC_ID = "angle:mc"

_PLANET_POINT_IDS = {
    astrology.SE_SUN: "planet:sun",
    astrology.SE_MOON: "planet:moon",
    astrology.SE_MERCURY: "planet:mercury",
    astrology.SE_VENUS: "planet:venus",
    astrology.SE_MARS: "planet:mars",
    astrology.SE_JUPITER: "planet:jupiter",
    astrology.SE_SATURN: "planet:saturn",
    astrology.SE_URANUS: "planet:uranus",
    astrology.SE_NEPTUNE: "planet:neptune",
    astrology.SE_PLUTO: "planet:pluto",
    astrology.SE_MEAN_NODE: "planet:asc_node",
    astrology.SE_TRUE_NODE: "planet:desc_node",
    astrology.SE_CHIRON: "planet:chiron",
}


def _common_instance():
    instance = getattr(common, "common", None)
    if instance is None:
        instance = common.Common()
        common.common = instance
    return instance


def _int_id(point_id: Any) -> Optional[int]:
    try:
        return int(point_id)
    except Exception:
        return None


def primdir_planet_id(point_id: Any) -> Optional[int]:
    point = _int_id(point_id)
    if point is None:
        return None
    if astrology.SE_SUN <= point <= astrology.SE_TRUE_NODE:
        return point
    return None


def semantic_planet_point(planet_id: Any) -> Optional[dict[str, Any]]:
    """Return the shared Search/technique identity for one Swiss body id."""
    try:
        planet = int(planet_id)
    except Exception:
        return None
    point_id = _PLANET_POINT_IDS.get(planet)
    if point_id is None:
        return None
    return {"pointId": point_id, "planetId": planet}


def primdir_semantic_point(
    point_id: Any,
    *,
    dynamic_key: Any = None,
    dynamic_spec: Optional[dict[str, Any]] = None,
    reference_chart=None,
    body_context: bool = False,
) -> Optional[dict[str, Any]]:
    """Normalize one Primary-Directions point into a stable semantic identity.

    The PD engine's integer namespace is not the Swiss Ephemeris namespace:
    notably ``PrimDir.IC`` and ``SE_CHIRON`` are both 15.  Structural PD points
    are therefore classified before ordinary planet slots.  The sole numeric
    Chiron exception is an explicitly declared body context (for example the
    two bodies of a midpoint); direct dynamic Chiron rows use ``CUSTOMERPD``
    plus ``dynamic_key='chiron'``.
    """
    point = _int_id(point_id)
    if point is None or point == PrimDir.NONE:
        return None

    if body_context and point == astrology.SE_CHIRON:
        return semantic_planet_point(astrology.SE_CHIRON)

    angle_index = primdir_angle_index(point)
    if angle_index is not None:
        return {"pointId": PRIMDIR_ANGLE_POINT_IDS[angle_index], "planetId": None}

    cusp_index = primdir_house_cusp_index(point)
    if cusp_index is not None:
        return {
            "pointId": f"house-cusp:{PRIMDIR_HOUSE_CUSP_NUMBERS[cusp_index]}",
            "planetId": None,
        }

    if point == PrimDir.LOF:
        return {"pointId": "point:lof", "planetId": None}
    if point == PrimDir.SYZ:
        return {"pointId": "point:syzygy", "planetId": None}

    if point == PrimDir.CUSTOMERPD:
        key = str(dynamic_key or "").strip()
        if key == "chiron":
            return semantic_planet_point(astrology.SE_CHIRON)
        if key == "vertex":
            return {"pointId": "point:vertex", "planetId": None}

        spec = dynamic_spec if isinstance(dynamic_spec, dict) else {}
        body_id = spec.get("bodyId")
        if body_id is not None:
            body = semantic_planet_point(body_id)
            if body is not None:
                return body
        display_planet_id = spec.get("display_planet_id", spec.get("displayPlanetId"))
        try:
            display_planet_id = int(display_planet_id)
        except Exception:
            display_planet_id = None
        spec_id = str(spec.get("id") or "").strip()
        if spec_id:
            return {"pointId": spec_id, "planetId": display_planet_id}
        return {
            "pointId": f"custom-point:{key or 'primary-directions'}",
            "planetId": display_planet_id,
        }

    antiscion_kind = None
    antiscion_offset = None
    if PrimDir.ANTISCION <= point < PrimDir.CONTRAANT:
        antiscion_kind = "antiscion"
        antiscion_offset = PrimDir.ANTISCION
    elif PrimDir.CONTRAANT <= point < PrimDir.TERM:
        antiscion_kind = "contra-antiscion"
        antiscion_offset = PrimDir.CONTRAANT
    if antiscion_kind is not None and antiscion_offset is not None:
        if point in (PrimDir.ANTISCIONLOF, PrimDir.CONTRAANTLOF):
            return {"pointId": f"{antiscion_kind}:{_POINT_LOF_ID}", "planetId": None}
        if point in (PrimDir.ANTISCIONASC, PrimDir.CONTRAANTASC):
            return {"pointId": f"{antiscion_kind}:{_ANGLE_ASC_ID}", "planetId": None}
        if point in (PrimDir.ANTISCIONMC, PrimDir.CONTRAANTMC):
            return {"pointId": f"{antiscion_kind}:{_ANGLE_MC_ID}", "planetId": None}
        body = semantic_planet_point(point - antiscion_offset)
        if body is not None:
            return {
                "pointId": f"{antiscion_kind}:{body['pointId']}",
                "planetId": body["planetId"],
            }
        return {"pointId": f"primdir:{antiscion_kind}:{point}", "planetId": None}

    if PrimDir.TERM <= point < PrimDir.FIXSTAR:
        sign_index = point - PrimDir.TERM
        if 0 <= sign_index < 12:
            return {"pointId": f"bound:sign:{sign_index}", "planetId": None}
        return {"pointId": f"primdir:bound:{point}", "planetId": None}

    if point >= PrimDir.FIXSTAR:
        star_index = point - PrimDir.FIXSTAR
        code = ""
        try:
            star = reference_chart.fixstars.data[star_index]
            code = str(star[fixstars.FixStars.NOMNAME] or "").strip()
        except Exception:
            pass
        return {
            "pointId": f"fixstar:{code}" if code else f"fixstar:index:{star_index}",
            "planetId": None,
        }

    planet = semantic_planet_point(point)
    if planet is not None:
        return planet
    return {"pointId": f"primdir:{point}", "planetId": None}


def primdir_angle_index(point_id: Any) -> Optional[int]:
    point = _int_id(point_id)
    if point is None:
        return None
    if PrimDir.ASC <= point <= PrimDir.IC:
        return point - PrimDir.ASC
    return None


def primdir_house_cusp_index(point_id: Any) -> Optional[int]:
    point = _int_id(point_id)
    if point is None:
        return None
    if PrimDir.HC2 <= point < PrimDir.LOF:
        return point - PrimDir.HC2
    return None


def primdir_angle_label(point_id: Any, *, parens: bool = False) -> Optional[str]:
    idx = primdir_angle_index(point_id)
    if idx is None or idx < 0 or idx >= len(PRIMDIR_ANGLE_LABEL_KEYS):
        return None
    key = PRIMDIR_ANGLE_LABEL_KEYS[idx]
    label = str(mtexts.txts.get(key, key))
    if parens:
        return f"({label})"
    return label


def primdir_house_cusp_label(point_id: Any) -> Optional[str]:
    idx = primdir_house_cusp_index(point_id)
    if idx is None or idx < 0 or idx >= len(PRIMDIR_HOUSE_CUSP_LABEL_KEYS):
        return None
    key = PRIMDIR_HOUSE_CUSP_LABEL_KEYS[idx]
    return str(mtexts.txts.get(key, key))


def primdir_structural_label(point_id: Any) -> Optional[str]:
    angle = primdir_angle_label(point_id)
    if angle is not None:
        return angle
    cusp = primdir_house_cusp_label(point_id)
    if cusp is not None:
        return cusp
    point = _int_id(point_id)
    if point == PrimDir.LOF:
        return str(mtexts.txts.get("LoF", "LoF"))
    if point == PrimDir.SYZ:
        return str(mtexts.txts.get("Syzygy", "Syzygy"))
    if point == PrimDir.CUSTOMERPD:
        return str(mtexts.txts.get("Customer2", "Customer2"))
    return None


def primdir_point_glyph(point_id: Any) -> Optional[str]:
    point = _int_id(point_id)
    if point is None:
        return None
    if point == PrimDir.LOF:
        try:
            return _common_instance().fortune
        except Exception:
            return None
    planet_id = primdir_planet_id(point)
    if planet_id is None:
        return None
    try:
        glyph = _common_instance().get_planet_glyph(planet_id)
    except Exception:
        return None
    return glyph or None
