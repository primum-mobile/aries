# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Daemon-side Astrolog-style chart sphere geometry.

This is a view-only visualization surface inspired by Astrolog's chart sphere
draw path (XChartSphere / WireChartSphere). Aries still owns the astrology:
chart positions, house cusps, decans, and terms come from the live Morinus chart
and options objects. The React canvas only scales and paints this payload.
"""
from __future__ import annotations

import math
import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import common
import houses
import mtexts
import planets
import util
from webapp.daemon.astrolabe_service import (
    _body_color_hex,
    _iter_visible_bodies,
    _rgb_to_hex,
    workspace_chart_for_document,
)
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    chart_body_color_role,
    effective_display_options,
    sign_color_role,
)
from webapp.frontend.scripts import export_chart_json

_DEG = math.pi / 180.0
_DEFAULT_ROTATION = 7.0
_DEFAULT_TILT = -7.0

_HOUSE_SYSTEM_LABELS = {
    "P": "Placidus",
    "K": "Koch",
    "R": "Regiomontanus",
    "C": "Campanus",
    "E": "Equal",
    "W": "Whole Sign",
    "F": "Fortune Houses",
    "X": "Axial",
    "Q": "True Ascendant",
    "M": "Morinus",
    "H": "Horizontal",
    "T": "Page-Polich",
    "B": "Alcabitus",
    "O": "Porphyrius",
    "N": "Whole Sign",
}

# mtexts keys for the house-system labels that are common nouns (translatable);
# proper-noun systems (Placidus, Koch, …) are not keyed and pass through as-is.
_HOUSE_SYSTEM_LABEL_KEYS = {
    "E": "HSEqual",
    "W": "HSWholeSign",
    "F": "HSFortuneWholeSign",
    "N": "HSWholeSign",
    "Q": "HSTrueAscendant",
}


def _house_system_label(hsys_code: str) -> str:
    english = _HOUSE_SYSTEM_LABELS.get(hsys_code)
    if english is None:
        return mtexts.txts.get("HouseSystem", hsys_code or "House system")
    key = _HOUSE_SYSTEM_LABEL_KEYS.get(hsys_code)
    return mtexts.txts.get(key, english) if key else english


def _normalize(deg: float) -> float:
    return float(deg) % 360.0


def _point(x: float, y: float, z: float, front: Optional[bool] = None) -> dict:
    return {
        "x": round(float(x), 6),
        "y": round(float(y), 6),
        "z": round(float(z), 6),
        "front": bool(z >= 0.0 if front is None else front),
    }


def _coor_xform(azi: float, alt: float, tilt: float) -> tuple[float, float]:
    """Astrolog's CoorXform(): pole-shift longitude/latitude by ``tilt``."""
    azi_r = _normalize(azi) * _DEG
    alt_r = float(alt) * _DEG
    tilt_r = float(tilt) * _DEG
    sin_alt = math.sin(alt_r)
    cos_alt = math.cos(alt_r)
    sin_azi = math.sin(azi_r)
    x = cos_alt * sin_azi * math.cos(tilt_r) - sin_alt * math.sin(tilt_r)
    y = cos_alt * math.cos(azi_r)
    lon = math.degrees(math.atan2(x, y))
    lat = math.degrees(math.asin(max(-1.0, min(1.0, cos_alt * sin_azi * math.sin(tilt_r) + sin_alt * math.cos(tilt_r)))))
    return _normalize(lon), lat


def _sphere_local(azi: float, alt: float, rotation: float, tilt: float) -> dict:
    """Astrolog FSphereLocal/WireSphereLocal, normalized to a unit sphere."""
    azi = _normalize(270.0 - (float(azi) + rotation))
    alt = float(alt)
    if tilt:
        azi, alt = _coor_xform(azi, alt, tilt)
    azi_r = azi * _DEG
    alt_r = alt * _DEG
    x = math.cos(alt_r) * math.cos(azi_r)
    y = math.sin(alt_r)
    z = -math.cos(alt_r) * math.sin(azi_r)
    return _point(x, y, z, front=azi < 180.0)


def _sphere_prime(azi: float, alt: float, rotation: float, tilt: float) -> dict:
    azi, alt = _coor_xform(azi, alt, 90.0)
    return _sphere_local(azi + 90.0, alt, rotation, tilt)


def _sphere_meridian(azi: float, alt: float, rotation: float, tilt: float) -> dict:
    azi, alt = _coor_xform(azi + 90.0, alt, 90.0)
    return _sphere_local(azi, alt, rotation, tilt)


def _sphere_earth(azi: float, alt: float, latitude: float, rotation: float, tilt: float) -> dict:
    azi, alt = _coor_xform(-azi, alt, 90.0 - latitude)
    return _sphere_local(azi + 90.0, -alt, rotation, tilt)


def _ayan_offset(chrt, opts) -> float:
    if int(getattr(opts, "ayanamsha", 0) or 0) == 0:
        return 0.0
    try:
        return float(astrology.effective_ayanamsha_ut(chrt.time.jd, opts.ayanamsha))
    except Exception:
        return float(getattr(chrt, "ayanamsha_offset", 0.0) or 0.0)


def _ecliptic_to_equatorial(
    chrt,
    opts,
    lon: float,
    lat: float,
    ayan_offset: Optional[float] = None,
) -> tuple[float, float]:
    offset = _ayan_offset(chrt, opts) if ayan_offset is None else ayan_offset
    tropical_lon = util.to_tropical_lon(_normalize(lon), offset)
    ra, decl, _dist = astrology.swe_cotrans(tropical_lon, float(lat), 1.0, -float(chrt.obl[0]))
    return _normalize(ra), float(decl)


def _project_equatorial(
    ra: float,
    decl: float,
    ramc: float,
    latitude: float,
    rotation: float,
    tilt: float,
) -> dict:
    lon_t = _normalize(ramc - ra + 90.0)
    lat_t = float(decl)
    lon_t, lat_t = _coor_xform(lon_t, lat_t, 90.0 - latitude)
    return _sphere_local(lon_t + 90.0, -lat_t, rotation, tilt)


def _project_ecliptic(
    chrt,
    opts,
    lon: float,
    lat: float,
    ramc: float,
    latitude: float,
    rotation: float,
    tilt: float,
    ayan_offset: float,
) -> dict:
    ra, decl = _ecliptic_to_equatorial(chrt, opts, lon, lat, ayan_offset)
    return _project_equatorial(ra, decl, ramc, latitude, rotation, tilt)


def _polyline(
    points: list[dict],
    *,
    id_: str,
    label: str,
    kind: str,
    color: str,
    color_role: str | None = None,
    width: float = 1.0,
    dash=None,
) -> dict:
    value = {
        "id": id_,
        "label": label,
        "kind": kind,
        "color": color,
        "width": float(width),
        "dash": dash or [],
        "points": points,
    }
    if color_role:
        value["colorRole"] = color_role
    return value


def _sample_local_circle(
    kind: str,
    label: str,
    color: str,
    rotation: float,
    tilt: float,
    *,
    latitude: float = 0.0,
    width: float = 1.0,
) -> dict:
    if kind == "horizon":
        project = lambda deg: _sphere_local(float(deg), 0.0, rotation, tilt)
    elif kind == "meridian":
        project = lambda deg: _sphere_meridian(float(deg), 0.0, rotation, tilt)
    elif kind == "primeVertical":
        project = lambda deg: _sphere_prime(float(deg), 0.0, rotation, tilt)
    else:
        project = lambda deg: _sphere_earth(float(deg), 0.0, latitude, rotation, tilt)
    points = [project(deg) for deg in range(361)]
    return _polyline(points, id_=kind, label=label, kind=kind, color=color, width=width)


def _sphere_tick_lines(
    *,
    kind: str,
    rotation: float,
    tilt: float,
    chrt=None,
    opts=None,
    ramc: float = 0.0,
    latitude: float = 0.0,
    ayan_offset: float = 0.0,
    every: int = 1,
    skip_multiple: Optional[int] = None,
) -> list[dict]:
    lines = []
    for deg in range(0, 360, every):
        if skip_multiple and deg % skip_multiple == 0:
            continue
        size = 3.0 if deg % 10 == 0 else (2.0 if deg % 5 == 0 else 1.0)
        half = size / 2.0
        if kind == "horizonTick":
            points = [
                _sphere_local(float(deg), -half, rotation, tilt),
                _sphere_local(float(deg), half, rotation, tilt),
            ]
        elif kind == "primeTick":
            points = [
                _sphere_prime(float(deg), -half, rotation, tilt),
                _sphere_prime(float(deg), half, rotation, tilt),
            ]
        else:
            points = [
                _project_ecliptic(chrt, opts, float(deg), -half, ramc, latitude, rotation, tilt, ayan_offset),
                _project_ecliptic(chrt, opts, float(deg), half, ramc, latitude, rotation, tilt, ayan_offset),
            ]
        lines.append(_polyline(
            points,
            id_=f"{kind}-{deg}",
            label=f"{kind} {deg}",
            kind=kind,
            color="#8da9b8",
            width=0.7 if deg % 10 else 0.95,
        ))
    return lines


def _sample_declination_circle(
    *,
    decl: float,
    label: str,
    color: str,
    chrt,
    ramc: float,
    latitude: float,
    rotation: float,
    tilt: float,
    width: float = 1.0,
) -> dict:
    points = [
        _project_equatorial(float(ra), decl, ramc, latitude, rotation, tilt)
        for ra in range(361)
    ]
    return _polyline(points, id_=label.lower().replace(" ", "-"), label=label, kind="equatorial", color=color, width=width)


def _sample_ecliptic_latitude(
    *,
    lat: float,
    label: str,
    color: str,
    chrt,
    opts,
    ramc: float,
    latitude: float,
    rotation: float,
    tilt: float,
    ayan_offset: float,
    width: float = 1.0,
) -> dict:
    points = [
        _project_ecliptic(chrt, opts, float(lon), lat, ramc, latitude, rotation, tilt, ayan_offset)
        for lon in range(361)
    ]
    return _polyline(points, id_=label.lower().replace(" ", "-"), label=label, kind="ecliptic", color=color, width=width)


def _sample_ecliptic_longitude(
    *,
    lon: float,
    label: str,
    kind: str,
    color: str,
    chrt,
    opts,
    ramc: float,
    latitude: float,
    rotation: float,
    tilt: float,
    ayan_offset: float,
    width: float = 1.0,
) -> dict:
    points = [
        _project_ecliptic(chrt, opts, lon, float(lat), ramc, latitude, rotation, tilt, ayan_offset)
        for lat in range(-90, 91)
    ]
    return _polyline(points, id_=label.lower().replace(" ", "-"), label=label, kind=kind, color=color, width=width)


def _circular_midpoint(start: float, end: float) -> float:
    return _normalize(start + ((_normalize(end - start)) / 2.0))


def _safe_sign_color(opts, sign: int) -> str:
    try:
        return _rgb_to_hex(common.get_sign_color(opts, sign, bw=bool(getattr(opts, "bw", False))))
    except Exception:
        return "#b9bcc6"


def _planet_glyph(pid: int) -> str:
    try:
        return common.common.get_planet_glyph(int(pid)) or ""
    except Exception:
        return ""


class AstrologSphereService:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    def geometry(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        document_id: Optional[str] = None,
        rotation: float = _DEFAULT_ROTATION,
        tilt: float = _DEFAULT_TILT,
    ) -> dict:
        with self._lock:
            canonical_opts = chart_snapshot_service.options
            display_opts = effective_display_options(canonical_opts)
            radix = workspace_chart_for_document(document_id, launcher_kinds=("astrolog_sphere",))
            if radix is not None:
                return self._build(radix, display_opts, float(rotation), float(tilt))
            source_path = (
                str(Path(source).expanduser()) if source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            radix, _ = export_chart_json.load_chart(
                source_path, canonical_opts, name=source_name
            )
            return self._build(radix, display_opts, float(rotation), float(tilt))

    def _build(self, chrt, opts, rotation: float, tilt: float) -> dict:
        latitude = float(chrt.place.lat)
        longitude = float(chrt.place.lon)
        ramc = float(chrt.houses.ascmc2[houses.Houses.MC][houses.Houses.RA])
        obliquity = float(chrt.obl[0])
        ayan = _ayan_offset(chrt, opts)
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2

        reference = [
            _sample_local_circle("horizon", "Horizon", "#6aa0d8", rotation, tilt, latitude=latitude, width=1.6),
            _sample_local_circle("meridian", mtexts.txts.get("Meridian", "Meridian"), "#8b96ad", rotation, tilt, latitude=latitude, width=1.1),
            _sample_local_circle("primeVertical", mtexts.txts.get("PrimeVertical", "Prime vertical"), "#777f91", rotation, tilt, latitude=latitude, width=1.0),
            _sample_local_circle("equatorial", mtexts.txts.get("Equator", "Equator"), "#a277d8", rotation, tilt, latitude=latitude, width=1.1),
            _sample_ecliptic_latitude(
                lat=0.0, label=mtexts.txts.get("Ecliptic", "Ecliptic"), color="#c99335", chrt=chrt, opts=opts,
                ramc=ramc, latitude=latitude, rotation=rotation, tilt=tilt,
                ayan_offset=ayan, width=1.8,
            ),
        ]
        for line in reference:
            line["colorRole"] = (
                "--morinus-signs"
                if line["kind"] == "ecliptic"
                else "--morinus-frame"
            )
        reference.extend(_sphere_tick_lines(kind="horizonTick", rotation=rotation, tilt=tilt))
        reference.extend(_sphere_tick_lines(kind="primeTick", rotation=rotation, tilt=tilt))
        reference.extend(_sphere_tick_lines(
            kind="eclipticTick",
            chrt=chrt,
            opts=opts,
            ramc=ramc,
            latitude=latitude,
            rotation=rotation,
            tilt=tilt,
            ayan_offset=ayan,
            skip_multiple=30,
        ))
        for line in reference:
            line.setdefault("colorRole", "--morinus-frame")

        signs_out = []
        sign_boundaries = []
        decan_boundaries = []
        for sign in range(12):
            sign_color = _safe_sign_color(opts, sign)
            sign_boundaries.append(_sample_ecliptic_longitude(
                lon=sign * 30.0,
                label=f"Sign {sign + 1}",
                kind="sign",
                color=sign_color,
                chrt=chrt,
                opts=opts,
                ramc=ramc,
                latitude=latitude,
                rotation=rotation,
                tilt=tilt,
                ayan_offset=ayan,
                width=1.0,
            ))
            sign_role = sign_color_role(opts, sign, resolved_color=sign_color)
            sign_boundaries[-1]["colorRole"] = sign_role or "--morinus-signs"
            label_lon = sign * 30.0 + 15.0
            for label_lat in (78.0, -78.0):
                signs_out.append({
                    "sign": sign,
                    "glyph": signs[sign],
                    "color": sign_color,
                    "colorRole": sign_role or "--morinus-signs",
                    "lon": label_lon,
                    "point": _project_ecliptic(
                        chrt, opts, label_lon, label_lat, ramc, latitude, rotation, tilt, ayan,
                    ),
                })
            for dec in (10.0, 20.0):
                decan_boundaries.append(_sample_ecliptic_longitude(
                    lon=sign * 30.0 + dec,
                    label=f"{sign + 1}.{int(dec // 10)}",
                    kind="decan",
                    color="rgba(201, 147, 53, 0.38)",
                    chrt=chrt,
                    opts=opts,
                    ramc=ramc,
                    latitude=latitude,
                    rotation=rotation,
                    tilt=tilt,
                    ayan_offset=ayan,
                    width=0.7,
                ))
                decan_boundaries[-1]["colorRole"] = "--morinus-positions"

        cusps = list(getattr(chrt.houses, "cusps", ()))
        house_lines = []
        house_labels = []
        for i in range(1, 13):
            try:
                cusp_lon = float(cusps[i])
            except Exception:
                continue
            color = "#69a873" if i not in (1, 4, 7, 10) else "#8fd098"
            house_lines.append(_sample_ecliptic_longitude(
                lon=cusp_lon,
                label=f"House {i}",
                kind="house",
                color=color,
                chrt=chrt,
                opts=opts,
                ramc=ramc,
                latitude=latitude,
                rotation=rotation,
                tilt=tilt,
                ayan_offset=ayan,
                width=1.25 if i in (1, 4, 7, 10) else 0.9,
            ))
            house_lines[-1]["colorRole"] = "--morinus-houses"
            next_lon = float(cusps[1 if i == 12 else i + 1])
            mid_lon = _circular_midpoint(cusp_lon, next_lon)
            for label_lat in (82.0, -82.0):
                house_labels.append({
                    "house": i,
                    "glyph": common.common.Housenames[i - 1],
                    "color": color,
                    "colorRole": "--morinus-housenums",
                    "lon": mid_lon,
                    "point": _project_ecliptic(
                        chrt, opts, mid_lon, label_lat, ramc, latitude, rotation, tilt, ayan,
                    ),
                })

        decan_labels = self._decan_labels(chrt, opts, ramc, latitude, rotation, tilt, ayan)
        bound_ticks, bound_labels = self._bound_geometry(chrt, opts, ramc, latitude, rotation, tilt, ayan)

        bodies = []
        for (bid, ra, decl, lon, glyph, color) in _iter_visible_bodies(chrt, opts):
            point = _project_equatorial(float(ra), float(decl), ramc, latitude, rotation, tilt)
            ecliptic_point = _project_ecliptic(
                chrt, opts, float(lon), 0.0, ramc, latitude, rotation, tilt, ayan,
            )
            bodies.append({
                "id": int(bid),
                "glyph": glyph,
                "color": color,
                "colorRole": chart_body_color_role(
                    opts,
                    chrt,
                    bid,
                    is_fortune=bid == planets.Planets.PLANETS_NUM,
                    resolved_color=color,
                ),
                "ra": float(ra),
                "decl": float(decl),
                "lon": float(lon),
                "point": point,
                "eclipticPoint": ecliptic_point,
                "front": bool(point["front"]),
                "isSun": bool(bid == astrology.SE_SUN),
            })

        hsys_code = str(getattr(chrt.houses, "ui_hsys", getattr(chrt.houses, "hsys", "")) or "")
        hsys_engine_code = str(getattr(chrt.houses, "hsys", hsys_code) or hsys_code)
        return {
            "name": getattr(chrt, "name", ""),
            "lat": latitude,
            "lon": longitude,
            "obliquity": obliquity,
            "ramc": ramc,
            "rotation": rotation,
            "tilt": tilt,
            "houseSystem": {
                "code": hsys_code,
                "engineCode": hsys_engine_code,
                "label": _house_system_label(hsys_code),
            },
            "mode": "zodiacal-cusp-great-circles",
            "reference": reference,
            "signBoundaries": sign_boundaries,
            "decanBoundaries": decan_boundaries,
            "houses": house_lines,
            "signLabels": signs_out,
            "houseLabels": house_labels,
            "decanLabels": decan_labels,
            "boundTicks": bound_ticks,
            "boundLabels": bound_labels,
            "bodies": bodies,
            "colors": {
                "bodyFallback": _body_color_hex(chrt, opts, astrology.SE_SUN),
            },
        }

    def _decan_labels(self, chrt, opts, ramc: float, latitude: float, rotation: float, tilt: float, ayan: float) -> list[dict]:
        rows = getattr(opts, "decans", []) or []
        set_idx = int(getattr(opts, "seldecan", 0) or 0)
        if set_idx < 0 or set_idx >= len(rows):
            set_idx = 0
        active = rows[set_idx] if rows else []
        labels = []
        for sign, rulers in enumerate(active[:12]):
            for idx, pid in enumerate((rulers or [])[:3]):
                lon = sign * 30.0 + idx * 10.0 + 5.0
                body_color = _body_color_hex(chrt, opts, int(pid))
                labels.append({
                    "sign": sign,
                    "decan": idx + 1,
                    "planetId": int(pid),
                    "glyph": _planet_glyph(int(pid)),
                    "color": body_color,
                    "colorRole": chart_body_color_role(
                        opts,
                        chrt,
                        int(pid),
                        is_fortune=int(pid) == planets.Planets.PLANETS_NUM,
                        resolved_color=body_color,
                    ),
                    "lon": lon,
                    "point": _project_ecliptic(
                        chrt, opts, lon, 8.0, ramc, latitude, rotation, tilt, ayan,
                    ),
                })
        return labels

    def _bound_geometry(
        self,
        chrt,
        opts,
        ramc: float,
        latitude: float,
        rotation: float,
        tilt: float,
        ayan: float,
    ) -> tuple[list[dict], list[dict]]:
        sets = getattr(opts, "terms", []) or []
        set_idx = int(getattr(opts, "selterm", 0) or 0)
        if set_idx < 0 or set_idx >= len(sets):
            set_idx = 0
        active = sets[set_idx] if sets else []
        ticks = []
        labels = []
        for sign, segments in enumerate(active[:12]):
            cursor = sign * 30.0
            for idx, segment in enumerate((segments or [])[:5]):
                try:
                    pid = int(segment[0])
                    span = float(segment[1])
                except Exception:
                    continue
                start = cursor
                end = cursor + span
                mid = (start + end) / 2.0
                if idx > 0:
                    points = [
                        _project_ecliptic(chrt, opts, start, lat, ramc, latitude, rotation, tilt, ayan)
                        for lat in (-4.0, 4.0)
                    ]
                    ticks.append(_polyline(
                        points,
                        id_=f"bound-{sign}-{idx}",
                        label=f"Bound {sign + 1}.{idx + 1}",
                        kind="bound",
                        color="rgba(226, 205, 144, 0.82)",
                        color_role="--morinus-positions",
                        width=1.0,
                    ))
                body_color = _body_color_hex(chrt, opts, pid)
                labels.append({
                    "sign": sign,
                    "bound": idx + 1,
                    "planetId": pid,
                    "glyph": _planet_glyph(pid),
                    "color": body_color,
                    "colorRole": chart_body_color_role(
                        opts,
                        chrt,
                        pid,
                        is_fortune=pid == planets.Planets.PLANETS_NUM,
                        resolved_color=body_color,
                    ),
                    "lon": mid,
                    "size": span,
                    "point": _project_ecliptic(
                        chrt, opts, mid, -8.0, ramc, latitude, rotation, tilt, ayan,
                    ),
                })
                cursor = end
        return ticks, labels


astrolog_sphere_service = AstrologSphereService()
