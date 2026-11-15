# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fixed-star corpus identity and shared inspector contacts."""
from __future__ import annotations

import re

import chart
import common
import fixstars
import fortune
import planets
import rule_engine
import util


def conjunction_facts(chrt, star, display_options=None) -> dict:
    """Describe stored conjunctions and standalone inner-point display hits.

    The four chart matrices own their existing contacts and the chart's
    materialized star orb owns the limit. Their stored facts remain independent
    of display flags, generic planet orbs and whole-sign aspect filters.
    Vertex, Syzygy and Eclipse have no legacy matrix; resolve their visible
    contacts using the same per-star display orb.
    """
    star_index = next(i for i, row in enumerate(chrt.fixstars.data) if row is star)
    code = star[fixstars.FixStars.NOMNAME]
    longitude = float(star[fixstars.FixStars.LON])
    limit = getattr(chrt.options, "fixstars", {}).get(code)
    contacts = []

    def append(kind, object_id, target_lon):
        contacts.append({
            "kind": kind,
            "object_id": object_id,
            "longitude": float(target_lon),
            "separation": abs(util.normalize(float(target_lon) - longitude + 180.0) - 180.0),
        })

    for index, body_ids in getattr(chrt, "fsaspmatrix", ()) or ():
        if index == star_index:
            for body_id in body_ids:
                body = common.get_chart_planet(chrt, body_id)
                if body is not None:
                    append("planet", body_id, body.data[planets.Planet.LONG])
    angle_keys = ("asc", "dsc", "mc", "ic")
    for index, angle_ids in getattr(chrt, "fsaspmatrixangles", ()) or ():
        if index == star_index:
            for angle_id in angle_ids:
                key = angle_keys[angle_id]
                append("angle", key, chart.semantic_angle_longitude(chrt, key))
    for index, cusp_ids in getattr(chrt, "fsaspmatrixhcs", ()) or ():
        if index == star_index:
            for cusp_id in cusp_ids:
                append("house", cusp_id + 1, chrt.houses.cusps[cusp_id + 1])
    if star_index in (getattr(chrt, "fsaspmatrixlof", ()) or ()):
        append("fortune", "fortune", chrt.fortune.fortune[fortune.Fortune.LON])
    if limit is not None:
        opts = display_options if display_options is not None else chrt.options
        for key, target_lon in common.get_inner_chart_point_longitudes(chrt, opts):
            if key != "fortune" and common.is_ring_direct_hit(longitude, target_lon, limit):
                append(key, key, target_lon)
    contacts.sort(key=lambda contact: (contact["separation"], contact["kind"], str(contact["object_id"])))
    return {
        "orb_limit": float(limit) if limit is not None else None,
        "contacts": contacts,
        "available": all(hasattr(chrt, name) for name in (
            "fsaspmatrix", "fsaspmatrixangles", "fsaspmatrixhcs", "fsaspmatrixlof",
        )),
    }


def constellation_code(star_code: str) -> str | None:
    if star_code == "M44":
        return "Cnc"
    match = re.search(r"[A-Z][A-Za-z]{2}$", star_code)
    return match.group() if match else None


def constellation_identity(star_code: str) -> dict | None:
    """Use installed identity metadata even when its meaning card is disabled.

    Packs are already cached by the corpus lifecycle. Global source toggles
    control readings, while the star's shared identity remains stable.
    """
    code = constellation_code(star_code)
    if not code:
        return None
    for _, pack in rule_engine.list_packs():
        entry = (getattr(pack, "inspector_content", None) or {}).get(
            ("fixed_star_constellation", code), {}
        )
        name = entry.get("constellation_name")
        if name:
            return {"name": name, "english_name": entry.get("constellation_english_name")}
    return None
