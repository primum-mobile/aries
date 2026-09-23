"""Project the shared chart-point universe into the existing mundane frame.

This is a drawing adapter. AT contact detection and its directional eligibility
remain owned by ascensional_transits; displaying a point does not make it a
new transit actor. Angles are represented by the existing four frame axes.
"""
from __future__ import annotations

import astrology
import asteroids
import ascensional_transits as at
import common
import fixstars
import fortune
import planets
import placspec
import primdirs
import regiospec
import util
from webapp.daemon import aspect_list_service as point_registry
from webapp.frontend.scripts import export_chart_json


_HIT_FILTERED_FAMILIES = {"asteroids", "fixstars", "midpoints", "hybrid_hits"}


def _unfiltered_ring_items(chrt, role, opts, mode):
    """Use the normal ring exporters, before any zodiacal hit selection."""
    if mode == "asteroids":
        return export_chart_json.export_asteroid_items(chrt, role=role, filter_hits=False)
    if mode == "fixstars":
        return export_chart_json.export_fixstar_items(chrt, opts, filter_hits=False)
    if mode == "midpoints":
        return export_chart_json.export_midpoint_ring_items(chrt, filter_hits=False)
    if mode == "hybrid_hits":
        return export_chart_json.export_hybrid_items(chrt, role=role, filter_hits=False)
    raise ValueError(mode)


def _mdo_display_targets(chrt, opts, *, event_frame=None):
    """Resolve core candidates, then apply the outer-ring display controls.

    These are display triggers, not aspect endpoints or technique eligibility.
    The structural axes/cusps occupy the chart's fixed mundane house frame.
    """
    targets = []
    for endpoint in export_chart_json.technique_aspect_endpoints(chrt, opts):
        key = endpoint["key"]
        body_id = point_registry._PLANET_BY_KEY.get(key)
        if body_id is not None:
            if not common.is_planet_visible(opts, body_id):
                continue
            if body_id == astrology.SE_TRUE_NODE and not getattr(opts, "showfixstarsnodes", False):
                continue
            ref = {"kind": "planet", "bodyId": body_id}
        elif endpoint["kind"] == "angle":
            mdo, quadrants = {
                "mc": (0.0, (1, 4)), "ic": (0.0, (2, 3)),
                "asc": (90.0, (1, 2)), "dc": (90.0, (3, 4)),
            }[key]
            # An axis borders two quadrants; both sides meet that same axis.
            targets.extend((None, mdo, quadrant) for quadrant in quadrants)
            continue
        else:
            flag = {"fortune": "showfixstarslof", "vertex": "showvertex",
                    "syzygy": "showprenatalsyzygy", "eclipse": "showprenataleclipse"}[key]
            if not getattr(opts, flag, False):
                continue
            ref = {"kind": key}
        coords = _coordinates(chrt, {"longitude": endpoint["lon"], "metadata": {"motionRef": ref}})
        _pmp, mdo, quadrant = _position(chrt, coords, event_frame=event_frame)
        targets.append((body_id, mdo, quadrant))
    if getattr(opts, "showfixstarshcs", False):
        targets.extend((None, mdo, quadrant) for mdo, quadrant in at._CUSP_MDO_Q.values())
    return targets


def _mdo_display_orb(mode, item, opts):
    if mode == "asteroids":
        return float(getattr(opts, "asteroid_orb_conjunction", getattr(opts, "ringorb_asteroids", 1.5)))
    if mode == "fixstars":
        code = (item.get("motionRef") or {}).get("code")
        return float(opts.fixstars.get(code, 0.0))
    return float(getattr(opts, "ringorb_midpoints" if mode == "midpoints" else "ringorb_hybrid", 1.5))


def _additional_endpoints(chrt, opts, represented_ids, chart_role):
    if not callable(getattr(chrt, "get_planet_body", None)):
        return  # Non-chart compatibility fixtures have no semantic registry.
    for endpoint in export_chart_json.technique_aspect_endpoints(chrt, opts):
        key = endpoint["key"]
        body_id = point_registry._PLANET_BY_KEY.get(key)
        if endpoint["kind"] == "angle" or key == "fortune" or body_id in represented_ids:
            continue
        yield {
            **endpoint, "longitude": endpoint["lon"],
            "metadata": point_registry._endpoint_metadata(chrt, key, chart_role, opts),
        }


def outer_ring(primary, comparison, opts, *, event_frame=None, position_mode="mdo"):
    """Selected display overlay, with the same source role as the zodiac wheel.

    The technique registry also contains inactive configured Lots. Those are
    calculation candidates, never permission to draw them in a body ring.
    """
    mode = point_registry._active_outer_ring_mode(opts)
    uses_comparison = comparison is not None and mode in (
        "arabic_parts", "antiscia", "contra_antiscia", "dodecatemoria",
    )
    chrt = comparison if uses_comparison else primary
    role = "outer" if uses_comparison else "primary"
    frame = event_frame if uses_comparison or comparison is None else None
    filter_mdo = position_mode == "mdo" and mode in _HIT_FILTERED_FAMILIES
    if filter_mdo:
        items = _unfiltered_ring_items(chrt, role, opts, mode)
        targets = _mdo_display_targets(chrt, opts, event_frame=frame)
    else:
        mode, items = point_registry._active_outer_ring_items(chrt, role, opts)
        targets = None
    endpoints = []
    for item in items:
        metadata = point_registry._ring_point_metadata(item, role, opts, chrt=chrt)
        endpoints.append({"key": metadata["key"], "kind": "ringPoint",
                          "longitude": item["longitude"], "metadata": metadata,
                          "ringItem": item,
                          "displayOrb": _mdo_display_orb(mode, item, opts) if filter_mdo else None})
    return {"mode": mode, "chartRole": role, "bodies": _project_bodies(
        chrt, opts, endpoints, chart_role=role,
        event_frame=frame,
        position_mode=position_mode,
        display_targets=targets,
    )}


def _coordinates(chrt, endpoint):
    metadata = endpoint["metadata"]
    ref = metadata.get("motionRef") or {}
    lon = float(endpoint["longitude"])
    if ref.get("kind") == "fortune":
        values = chrt.fortune.fortune
        return lon, values[fortune.Fortune.LAT], values[fortune.Fortune.RA], values[fortune.Fortune.DECL]
    if ref.get("kind") == "planet":
        body = chrt.get_planet_body(int(ref["bodyId"]))
        return lon, body.data[planets.Planet.LAT], *body.dataEqu[:2]
    if ref.get("kind") == "ephemerisBody":
        body = asteroids.chart_asteroid(chrt, int(ref["bodyId"]))
        if body is None or not body.available:
            raise ValueError(f"Missing chart body {ref['bodyId']}")
        return lon, *body.data[1:4]
    if ref.get("kind") == "fixedStar":
        for star in chrt.fixstars.data:
            if str(star[fixstars.FixStars.NOMNAME]) == str(ref["code"]):
                return lon, star[fixstars.FixStars.LAT], star[fixstars.FixStars.RA], star[fixstars.FixStars.DECL]
        raise ValueError(f"Missing chart star {ref['code']}")
    # Lots, prenatal points, midpoints and zodiacal projections are ecliptic
    # points. Use the engine's coordinate transform, never longitude as RA.
    tropical_lon = util.to_tropical_lon(lon, getattr(chrt, "ayanamsha_offset", 0.0))
    ra, decl, _distance = astrology.swe_cotrans(tropical_lon, 0.0, 1.0, -chrt.obl[0])
    return lon, 0.0, ra, decl


def _position(chrt, coords, *, event_frame=None, position_mode="mdo"):
    lon, lat, ra, decl = coords
    if event_frame is not None:
        mdo, quadrant, _above = at.compute_mdo(
            ra, decl, event_frame.event_ramc, event_frame.event_place.lat,
        )
        if mdo is None:
            raise ValueError("Point has no ascensional position at this latitude")
        return at._pmp_from_mdo_q(mdo, quadrant), mdo, quadrant
    pd = chrt.options.primarydir
    if position_mode == "mundane" and pd in (
        primdirs.PrimDirs.REGIOMONTAN, primdirs.PrimDirs.CAMPANIAN,
    ):
        spec = regiospec.RegiomontanianSpeculum(
            chrt.place.lat, chrt.houses.ascmc2, chrt.raequasc,
            lon, lat, ra, decl,
        ).speculum
        slot = regiospec.RegiomontanianSpeculum.CMP if pd == primdirs.PrimDirs.CAMPANIAN else regiospec.RegiomontanianSpeculum.RMP
        pmp = spec[slot]
    else:
        pmp = placspec.PlacidianSpeculum(
            chrt.place.lat, chrt.houses.ascmc2, lon, lat, ra, decl,
        ).speculum[placspec.PlacidianSpeculum.PMP]
    mdo, quadrant = at._mdo_q_from_pmp(pmp)
    return pmp, mdo, quadrant


def additional_bodies(chrt, opts, represented_ids, *, chart_role="primary",
                      event_frame=None, position_mode="mdo"):
    """Resolve all candidates before applying the normal presentation gates.

    Core planets/Fortune retain their established AT positions; structural
    angles retain the frame axes. Display overlays belong to outer_ring().
    """
    endpoints = _additional_endpoints(chrt, opts, represented_ids, chart_role)
    return _project_bodies(chrt, opts, endpoints, chart_role=chart_role,
                           event_frame=event_frame, position_mode=position_mode)


def _project_bodies(chrt, opts, endpoints, *, chart_role, event_frame=None, position_mode="mdo",
                    display_targets=None):
    result = []
    planet_keys = {value: key for key, value in point_registry._PLANET_BY_KEY.items()}
    planet_paints = {}
    for endpoint in endpoints:
        metadata = endpoint["metadata"]
        key = endpoint["key"]
        kind = endpoint["kind"]
        if kind == "angle" or key == "fortune":
            continue  # Already represented by axes / the Fortune body.
        body_id = metadata.get("planetId")
        if body_id is not None:
            from common import is_planet_visible
            if not is_planet_visible(opts, body_id):
                continue
        flag = {"vertex": "showvertex", "syzygy": "showprenatalsyzygy",
                "eclipse": "showprenataleclipse"}.get(key)
        if flag and not getattr(opts, flag, False):
            continue
        pmp, mdo, quadrant = _position(
            chrt, _coordinates(chrt, endpoint), event_frame=event_frame,
            position_mode=position_mode,
        )
        if display_targets is not None:
            ref = metadata.get("motionRef") or {}
            own_body = ref.get("bodyId") if ref.get("kind") == "ephemerisBody" else None
            if not any(
                (own_body is None or target_id != own_body)
                and quadrant == target_quadrant
                and abs(mdo - target_mdo) <= endpoint["displayOrb"]
                for target_id, target_mdo, target_quadrant in display_targets
            ):
                continue
        printed = pmp if position_mode == "mundane" else mdo
        d, m, _s = util.decToDeg(printed)
        md, mm, ms = util.decToDeg(mdo)
        lon_d, lon_m, lon_s = util.decToDeg(endpoint["longitude"])
        # Reuse the wheel presentation, not the qualified list/search name.
        # In particular a dodecatemorion is a planet glyph on the wheel;
        # its listLabel already contains the localized (12th) qualifier.
        item = endpoint.get("ringItem")
        segments = []
        if item is not None:
            # Layout uses PMP, but every printed position uses this view's
            # coordinate (MDO in ascensional views), without zodiac modulo 30.
            item = {**item, "longitude": float(pmp),
                    "degText": str(d), "minText": f"{m:02d}"}
            if item.get("positionInLabel"):
                item["label"] = f"{item['listLabel']} {d}°{m:02d}'"
                item["segments"] = [{"text": item["label"], "kind": "text"}]
            for segment in item.get("segments") or ():
                run = dict(segment)
                if run.get("kind") == "planet" and run.get("seId") is not None:
                    planet_key = planet_keys.get(run["seId"])
                    if planet_key is not None and not run.get("color"):
                        if planet_key not in planet_paints:
                            planet_paints[planet_key] = point_registry._planet_metadata(chrt, planet_key, chart_role, opts)
                        paint = planet_paints[planet_key]
                        run["color"] = paint["color"]
                        run["colorRole"] = paint.get("colorRole")
                segments.append(run)
        glyph = metadata.get("glyph")
        glyph_font = metadata.get("glyphFont", "text") if glyph else "text"
        label = str(metadata["name"])
        display = glyph or label
        if item is not None:
            display = str(item.get("label") or label)
            glyph_font = "text"
        result.append({
            "id": body_id if body_id is not None else key,
            "glyph": display,
            "glyphFont": glyph_font,
            **({"labelSegments": segments, "labelFamily": item["family"],
                "ringItem": {**item, "segments": segments}}
               if item is not None else {}),
            "color": metadata["color"],
            "colorRole": metadata.get("colorRole"),
            "mundane": float(pmp),
            "motion": (item.get("motion") or "") if item is not None else (metadata.get("motionMarker") or ""),
            "posDeg": int(d), "posMin": int(m), "isLof": False,
            "hoverFlag": {
                "glyph": glyph if glyph_font == "morinus" else "",
                "title": label,
                "accent": None,
                "accentRole": metadata.get("colorRole"),
                "rows": [
                    ("Long", f"{lon_d:03d}°{lon_m:02d}'{lon_s:02d}\""),
                    ("MDO", f"Q{quadrant} {md:02d}°{mm:02d}'{ms:02d}\""),
                ],
                "compact": False, "chartRole": chart_role,
            },
        })
    return result
