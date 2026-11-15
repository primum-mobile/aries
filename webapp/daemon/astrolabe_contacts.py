# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Rete contacts on the astrolabe, read off the primary-direction list.

Turning the rete forward performs the direct directions: a promissor on the
rete is carried to a significator on the fixed plate. A contact is a direct
conjunction direction of a chart point to an angle or house cusp whose time
lies within the two-month orb of the current arc. The engine's PD list (the
same one the stepper snaps to) is the only source; nothing is re-solved here.
Mundane directions light the body, zodiacal ones its ecliptic degree.
"""

from __future__ import annotations

import chart
import common
from primdirs import PrimDir

# The primary-direction orb in time: contacts within two months of exact.
CONTACT_ORB_YEARS = 2.0 / 12.0

_ANGLE_TARGETS = {
    PrimDir.ASC: {"kind": "horizon", "angle": "asc"},
    PrimDir.DESC: {"kind": "horizon", "angle": "dsc"},
    PrimDir.MC: {"kind": "meridian", "angle": "mc"},
    PrimDir.IC: {"kind": "meridian", "angle": "ic"},
}
_CUSP_HOUSES = {
    PrimDir.HC2: 2, PrimDir.HC3: 3, PrimDir.HC5: 5, PrimDir.HC6: 6,
    PrimDir.HC8: 8, PrimDir.HC9: 9, PrimDir.HC11: 11, PrimDir.HC12: 12,
}


def contact_orb_deg(years_per_degree: float) -> float:
    """The time orb as rete arc through the chart's direction key."""
    if not years_per_degree or years_per_degree <= 0:
        return 0.0
    return CONTACT_ORB_YEARS / years_per_degree


def _target(sig: int):
    if sig in _ANGLE_TARGETS:
        return dict(_ANGLE_TARGETS[sig])
    house = _CUSP_HOUSES.get(sig)
    return {"kind": "houseLine", "house": house} if house else None


def _point_id(prom: int):
    if 0 <= prom < PrimDir.OFFSANGLES:
        return prom
    if prom == PrimDir.LOF:
        return common.CHART_OBJECT_FORTUNE
    return None


def rete_contacts(entries, delta_deg: float, years_per_degree: float) -> list[dict]:
    """Direct conjunction directions to angles and cusps within the orb of
    ``delta_deg``; ``entries`` is the stepper's arc-sorted [(arc, pd), ..]."""
    orb = contact_orb_deg(years_per_degree)
    if orb <= 0:
        return []
    out = []
    for arc, pd in entries or ():
        offset = float(arc) - float(delta_deg)
        if offset < -orb:
            continue
        if offset > orb:
            break
        if not getattr(pd, "direct", True):
            continue
        if int(getattr(pd, "promasp", chart.Chart.CONJUNCTIO)) != chart.Chart.CONJUNCTIO:
            continue
        if int(getattr(pd, "sigasp", chart.Chart.CONJUNCTIO)) != chart.Chart.CONJUNCTIO:
            continue
        if int(getattr(pd, "prom2", PrimDir.NONE)) != PrimDir.NONE:
            continue  # midpoint promissors have no single rete point
        point_id = _point_id(int(pd.prom))
        target = _target(int(pd.sig))
        if point_id is None or target is None:
            continue
        out.append({
            "pointId": point_id,
            "point": "body" if pd.mundane else "ecliptic",
            "target": target,
            "arcToExact": round(offset, 8),
        })
    return out
