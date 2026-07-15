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
import mtexts
from primdirs import PrimDir


PRIMDIR_ANGLE_LABEL_KEYS = ("Asc", "Dsc", "MC", "IC")
PRIMDIR_HOUSE_CUSP_LABEL_KEYS = ("HC2", "HC3", "HC5", "HC6", "HC8", "HC9", "HC11", "HC12")


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
