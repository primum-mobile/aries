# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Daemon service for Ascensional Transits snapshots.

Packet 08A scope is deliberately backend-only: expose the existing
``ascensional_transits`` engine and source popup row semantics as JSON without
opening workspace documents or importing wx surfaces.
"""
from __future__ import annotations

import datetime
import sys
import threading
from collections import namedtuple
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import ascensional_transits as at_engine
import astrology
import default_location as default_location_model
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.frontend.scripts import export_chart_json


_ANGLE_NAMES = {1: "Asc", 4: "IC", 7: "Dsc", 10: "MC"}
_HOUSE_ROMAN = {
    2: "II",
    3: "III",
    5: "V",
    6: "VI",
    8: "VIII",
    9: "IX",
    11: "XI",
    12: "XII",
}


def _source_path(source: Optional[str]) -> str:
    return str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)


def _parse_when(when_iso: Optional[str]) -> datetime.datetime:
    if when_iso:
        try:
            return datetime.datetime.fromisoformat(when_iso).replace(tzinfo=None)
        except (TypeError, ValueError):
            pass
    return datetime.datetime.now()


def _event_datetime_from_jd(jd: float) -> dict[str, Any]:
    y, m, d, hour = astrology.swe_revjul(float(jd), 1)
    hh = int(hour)
    minute_float = (hour - hh) * 60.0
    mm = int(minute_float)
    ss = int(round((minute_float - mm) * 60.0))
    if ss == 60:
        ss = 0
        mm += 1
    if mm == 60:
        mm = 0
        hh += 1
    return {
        "year": int(y),
        "month": int(m),
        "day": int(d),
        "hour": int(hh),
        "minute": int(mm),
        "second": int(ss),
        "isoUtc": f"{int(y):04d}-{int(m):02d}-{int(d):02d}T{int(hh):02d}:{int(mm):02d}:{int(ss):02d}",
    }


def _place_from_payload(payload: Optional[dict[str, Any]]):
    if not payload:
        return None
    chart_mod = export_chart_json.chart_mod
    name = str(payload.get("name") or payload.get("place") or "")
    if "lon" in payload or "lat" in payload:
        lon = float(payload.get("lon", 0.0))
        lat = float(payload.get("lat", 0.0))
        londeg, lonmin, lonsec = _decimal_to_dms(abs(lon))
        latdeg, latmin, latsec = _decimal_to_dms(abs(lat))
        place = chart_mod.Place(
            name,
            londeg,
            lonmin,
            lonsec,
            lon >= 0,
            latdeg,
            latmin,
            latsec,
            lat >= 0,
            int(payload.get("altitude", payload.get("alt", 0)) or 0),
        )
        # Place.__init__ recomputes lon/lat from the DMS above (floored to the
        # arcsecond, ~30 m); the payload already carries the exact decimals, so
        # restore them — the event place must match the clicked point.
        place.lon = lon
        place.lat = lat
        return place
    return chart_mod.Place(
        name,
        int(payload.get("deglon", payload.get("lonDeg", 0)) or 0),
        int(payload.get("minlon", payload.get("lonMin", 0)) or 0),
        int(payload.get("seclon", payload.get("lonSec", 0)) or 0),
        bool(payload.get("east", True)),
        int(payload.get("deglat", payload.get("latDeg", 0)) or 0),
        int(payload.get("minlat", payload.get("latMin", 0)) or 0),
        int(payload.get("seclat", payload.get("latSec", 0)) or 0),
        bool(payload.get("north", True)),
        int(payload.get("altitude", payload.get("alt", 0)) or 0),
    )


def _decimal_to_dms(value: float) -> tuple[int, int, int]:
    deg = int(value)
    rem = (value - deg) * 60.0
    minute = int(rem)
    sec = int(round((rem - minute) * 60.0))
    if sec == 60:
        sec = 0
        minute += 1
    if minute == 60:
        minute = 0
        deg += 1
    return deg, minute, sec


def _place_payload(place, *, source: str) -> dict[str, Any]:
    return {
        "source": source,
        "name": getattr(place, "place", "") or "",
        "lon": float(getattr(place, "lon", 0.0)),
        "lat": float(getattr(place, "lat", 0.0)),
        "altitude": int(getattr(place, "altitude", 0) or 0),
        "deglon": int(getattr(place, "deglon", 0) or 0),
        "minlon": int(getattr(place, "minlon", 0) or 0),
        "seclon": int(getattr(place, "seclon", 0) or 0),
        "east": bool(getattr(place, "east", True)),
        "deglat": int(getattr(place, "deglat", 0) or 0),
        "minlat": int(getattr(place, "minlat", 0) or 0),
        "seclat": int(getattr(place, "seclat", 0) or 0),
        "north": bool(getattr(place, "north", True)),
    }


def _default_event_place(radix, opts):
    try:
        place = default_location_model.place_from_options(opts, require_present=True)
        if place is not None:
            return place, "default_location"
    except Exception:
        pass
    return radix.place, "radix_place"


def _event_jd_from_when(radix, when: datetime.datetime, event_place) -> float:
    """Source-faithful wall-clock -> JD conversion.

    Mirrors ``morin._build_ascensional_transit_chart``: the date tuple is
    interpreted with the radix time-zone convention, while the chart place is
    the AT event place.
    """
    chart_mod = export_chart_json.chart_mod
    rtime = radix.time
    t = chart_mod.Time(
        int(when.year),
        int(when.month),
        int(when.day),
        int(when.hour),
        int(when.minute),
        int(when.second),
        False,
        chart_mod.Time.GREGORIAN,
        rtime.zt,
        rtime.plus,
        rtime.zh,
        rtime.zm,
        rtime.daylightsaving,
        event_place,
        full=False,
        tzid=getattr(rtime, "tzid", ""),
        tzauto=getattr(rtime, "tzauto", False),
    )
    return float(t.jd)


def _aspect_chart_index(aspect_name: str) -> Optional[int]:
    chart_cls = export_chart_json.chart_mod.Chart
    return {
        at_engine.CONJUNCTION: chart_cls.CONJUNCTIO,
        at_engine.OPPOSITION: chart_cls.OPPOSITIO,
        at_engine.PARALLEL: chart_cls.PARALLEL,
        at_engine.CONTRAPARALLEL: chart_cls.CONTRAPARALLEL,
    }.get(aspect_name)


def _aspect_glyph_and_font(aspect_name: str) -> tuple[str, str]:
    if aspect_name == at_engine.ANTISCIA:
        return "ant.", "text"
    idx = _aspect_chart_index(aspect_name)
    common_obj = getattr(export_chart_json.common, "common", None)
    glyphs = getattr(common_obj, "Aspects", None)
    if idx is None or glyphs is None or idx >= len(glyphs):
        return "?", "text"
    return glyphs[idx], "morinus"


def _angle_or_cusp_label(cusp_idx: int) -> str:
    if cusp_idx in _ANGLE_NAMES:
        return _ANGLE_NAMES[cusp_idx]
    return _HOUSE_ROMAN.get(cusp_idx, f"{cusp_idx}")


def _cusp_axis_id(cusp_idx: int) -> int:
    return cusp_idx if cusp_idx <= 6 else cusp_idx - 6


def _dedup_cusp_pair_duplicates(pairs):
    by_key = {}
    other = []
    for pair in pairs:
        if pair.transit.kind == "planet" and pair.radix.kind == "cusp":
            key = (pair.transit.idx, _cusp_axis_id(pair.radix.idx))
            existing = by_key.get(key)
            if existing is None:
                by_key[key] = pair
            elif pair.aspect == at_engine.CONJUNCTION and existing.aspect != at_engine.CONJUNCTION:
                by_key[key] = pair
            elif pair.aspect == existing.aspect and pair.orb_arcmin < existing.orb_arcmin:
                by_key[key] = pair
        else:
            other.append(pair)
    return list(by_key.values()) + other


def _planet_glyph_text(planet_idx: int) -> str:
    common_obj = getattr(export_chart_json.common, "common", None)
    getter = getattr(common_obj, "get_planet_glyph", None)
    if callable(getter):
        return getter(planet_idx) or "?"
    return "?"


def _pair_id(transit_pt, radix_pt, aspect: str) -> tuple[Any, ...]:
    return (transit_pt.kind, transit_pt.idx, radix_pt.kind, radix_pt.idx, aspect)


def _orb_for_aspect(pmp_t: float, pmp_r: float, aspect: str) -> Optional[float]:
    d = abs(pmp_t - pmp_r) % 360.0
    if d > 180.0:
        d = 360.0 - d
    if aspect == at_engine.CONJUNCTION:
        return d * 60.0
    if aspect == at_engine.OPPOSITION:
        return abs(d - 180.0) * 60.0
    if aspect == at_engine.ANTISCIA:
        smod = (pmp_t + pmp_r) % 360.0
        a1 = min(smod, 360.0 - smod)
        a2 = abs(smod - 180.0)
        return min(a1, a2) * 60.0
    return None


def _near_miss_pairs(
    radix,
    event_jd: float,
    event_place,
    *,
    max_orb_arcmin: float = 90.0,
    dt_minutes: float = 2.0,
    apply_precession: bool = True,
):
    snap = at_engine.ATSnapshot(
        radix,
        event_jd,
        event_place,
        include_parallels=True,
        apply_precession=apply_precession,
    )
    already = {_pair_id(pair.transit, pair.radix, pair.aspect) for pair in snap.at_pairs}

    fwd_jd = float(event_jd) + float(dt_minutes) / (60.0 * 24.0)
    snap_fwd = at_engine.ATSnapshot(
        radix,
        fwd_jd,
        event_place,
        include_parallels=True,
        apply_precession=apply_precession,
    )
    fwd_transit = {(pt.kind, pt.idx): pt for pt in snap_fwd.transit_points}
    fwd_radix = {(pt.kind, pt.idx): pt for pt in snap_fwd.radix_points}

    out = []
    for tp in snap.transit_points:
        if tp.kind != "planet":
            continue
        pmp_t_now = at_engine._pmp_from_mdo_q(tp.mdo, tp.quadrant)
        for rp in snap.radix_points:
            if tp.kind == "planet" and rp.kind == "planet" and tp.idx == rp.idx:
                continue
            pmp_r_now = at_engine._pmp_from_mdo_q(rp.mdo, rp.quadrant)
            asp, orb_arcmin = at_engine._pmp_aspect(
                pmp_t_now,
                pmp_r_now,
                orb_conj=float(max_orb_arcmin),
                orb_antiscia=float(max_orb_arcmin) * 0.5,
            )
            if asp is None or _pair_id(tp, rp, asp) in already:
                continue

            tp_fwd = fwd_transit.get((tp.kind, tp.idx))
            rp_fwd = fwd_radix.get((rp.kind, rp.idx))
            if tp_fwd is None or rp_fwd is None:
                applying = None
                mins_to_exact = None
            else:
                pmp_t_fwd = at_engine._pmp_from_mdo_q(tp_fwd.mdo, tp_fwd.quadrant)
                pmp_r_fwd = at_engine._pmp_from_mdo_q(rp_fwd.mdo, rp_fwd.quadrant)
                fwd_orb = _orb_for_aspect(pmp_t_fwd, pmp_r_fwd, asp)
                if fwd_orb is None:
                    applying = None
                    mins_to_exact = None
                else:
                    d_orb = fwd_orb - orb_arcmin
                    applying = d_orb < 0
                    rate_per_min = abs(d_orb) / max(float(dt_minutes), 1e-6)
                    mins_to_exact = orb_arcmin / rate_per_min if rate_per_min > 1e-4 else None
            out.append((orb_arcmin, tp, asp, rp, applying, mins_to_exact))
    out.sort(key=lambda row: row[0])
    return out


def _format_time_to_exact(mins: Optional[float]) -> str:
    if mins is None or mins != mins:
        return "-"
    mins = float(mins)
    if mins < 90:
        return f"{max(1, int(round(mins)))}m"
    if mins < 60 * 72:
        return f"{mins / 60.0:.1f}h"
    days = mins / (60.0 * 24.0)
    if days < 365:
        return f"{int(round(days))}d"
    return f"{days / 365.25:.1f}y"


def _format_orb(orb_arcmin: float) -> str:
    arcmin_int = int(orb_arcmin)
    arcsec = int(round((float(orb_arcmin) - arcmin_int) * 60.0))
    if arcsec == 60:
        arcmin_int += 1
        arcsec = 0
    return f"{arcmin_int}'{arcsec:02d}\""


def _point_payload(point) -> dict[str, Any]:
    return {
        "kind": point.kind,
        "idx": int(point.idx),
        "label": point.label,
        "ra": point.ra,
        "decl": point.decl,
        "lon": point.lon,
        "lat": point.lat,
        "mdo": point.mdo,
        "quadrant": point.quadrant,
        "aboveHorizon": point.above_horizon,
        "fixedInFrame": point.fixed_in_frame,
        "pmp": (
            at_engine._pmp_from_mdo_q(point.mdo, point.quadrant)
            if point.mdo is not None and point.quadrant is not None
            else None
        ),
    }


def _pair_payload(pair, *, dim: bool = False, status_text: str = "") -> dict[str, Any]:
    aspect_glyph, aspect_font = _aspect_glyph_and_font(pair.aspect)
    return {
        "transit": _point_payload(pair.transit),
        "radix": _point_payload(pair.radix),
        "aspect": pair.aspect,
        "aspectGlyph": aspect_glyph,
        "aspectFont": aspect_font,
        "orbArcmin": float(pair.orb_arcmin),
        "orbText": _format_orb(pair.orb_arcmin),
        "dim": bool(dim),
        "statusText": status_text,
    }


def _placeholder_row(text: str) -> dict[str, Any]:
    return {
        "kind": "data",
        "transitGlyph": "",
        "transitFont": "text",
        "aspectGlyph": "",
        "aspectFont": "text",
        "radixGlyph": text,
        "radixFont": "text",
        "radixExtra": "",
        "orbText": "",
        "statusText": "",
        "dim": True,
        "pair": None,
    }


def _data_row_from_pair(pair, *, dim: bool = False, status_text: str = "") -> dict[str, Any]:
    transit = pair.transit
    radix = pair.radix
    transit_glyph = _planet_glyph_text(transit.idx) if transit.kind == "planet" else transit.label
    transit_font = "morinus" if transit.kind == "planet" else "text"
    aspect_glyph, aspect_font = _aspect_glyph_and_font(pair.aspect)

    if radix.kind == "cusp":
        radix_glyph = _angle_or_cusp_label(radix.idx)
        radix_font = "text"
    elif radix.kind == "planet":
        radix_glyph = _planet_glyph_text(radix.idx)
        radix_font = "morinus"
    elif radix.kind == "lof":
        common_obj = getattr(export_chart_json.common, "common", None)
        radix_glyph = getattr(common_obj, "fortune", None) or "LoF"
        radix_font = "morinus"
    elif radix.kind == "node":
        radix_glyph = export_chart_json.mtexts.txts.get("Node", "Node")
        radix_font = "text"
    else:
        radix_glyph = radix.label
        radix_font = "text"

    return {
        "kind": "data",
        "transitGlyph": transit_glyph,
        "transitFont": transit_font,
        "aspectGlyph": aspect_glyph,
        "aspectFont": aspect_font,
        "radixGlyph": radix_glyph,
        "radixFont": radix_font,
        "radixExtra": "",
        "orbText": _format_orb(pair.orb_arcmin),
        "statusText": status_text,
        "dim": bool(dim),
        "pair": _pair_payload(pair, dim=dim, status_text=status_text),
    }


def _list_rows(
    radix,
    snapshot,
    event_place,
    *,
    filter_to_active_moment: bool,
    apply_precession: bool,
    include_near_misses: bool,
    near_miss_max_orb_arcmin: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    deduped = _dedup_cusp_pair_duplicates(snapshot.at_pairs)
    filtered_out_count = 0
    if filter_to_active_moment:
        active_transit_bodies = {tid for tid, _radix, _aspect, _orb in snapshot.active_ecliptic}
        before = len(deduped)
        deduped = [
            pair
            for pair in deduped
            if pair.transit.kind == "planet" and pair.transit.idx in active_transit_bodies
        ]
        filtered_out_count = before - len(deduped)

    order = {
        at_engine.CONJUNCTION: 0,
        at_engine.OPPOSITION: 1,
        at_engine.PARALLEL: 2,
        at_engine.CONTRAPARALLEL: 3,
        at_engine.ANTISCIA: 4,
    }
    deduped.sort(key=lambda pair: (order.get(pair.aspect, 99), pair.orb_arcmin))

    # Section titles/placeholders resolved from mtexts at serve time (active langid).
    mtexts = export_chart_json.mtexts
    rows: list[dict[str, Any]] = [
        {"kind": "section", "title": mtexts.txts.get("WithinPolichPageOrb", "Within Polich/Page orb (25')")}
    ]
    if not deduped:
        if filtered_out_count > 0:
            placeholder = mtexts.txts.get(
                "FilteredNotInActiveEcliptic", "(filtered: {count} not in active ecliptic)"
            ).format(count=filtered_out_count)
        elif not snapshot.is_active_moment:
            placeholder = mtexts.txts.get("PassiveMomentTrivial", "(passive moment - AT alone is trivial)")
        else:
            placeholder = mtexts.txts.get("NoContactsInTightOrb", "(no contacts in tight orb)")
        rows.append(_placeholder_row(placeholder))
    else:
        rows.extend(_data_row_from_pair(pair) for pair in deduped)

    near_rows: list[dict[str, Any]] = []
    if include_near_misses:
        near_misses = _near_miss_pairs(
            radix,
            snapshot.event_jd,
            event_place,
            max_orb_arcmin=near_miss_max_orb_arcmin,
            apply_precession=apply_precession,
        )
        if filter_to_active_moment:
            active = {tid for tid, _radix, _aspect, _orb in snapshot.active_ecliptic}
            near_misses = [
                row for row in near_misses
                if row[1].kind == "planet" and row[1].idx in active
            ]

        lite = namedtuple("Lite", "transit radix aspect orb_arcmin")
        near_lite = [lite(row[1], row[3], row[2], row[0]) for row in near_misses]
        near_lite = _dedup_cusp_pair_duplicates(near_lite)
        status_by_id = {
            (row[1].kind, row[1].idx, row[3].kind, row[3].idx, row[2]): (row[4], row[5])
            for row in near_misses
        }
        near_lite.sort(key=lambda pair: pair.orb_arcmin)
        for pair in near_lite[:8]:
            key = (pair.transit.kind, pair.transit.idx, pair.radix.kind, pair.radix.idx, pair.aspect)
            applying, mins_to_exact = status_by_id.get(key, (None, None))
            if applying is None:
                status = "-"
            elif applying:
                status = mtexts.txts.get("ApplyingApprox", "applying ~{time}").format(
                    time=_format_time_to_exact(mins_to_exact)
                )
            else:
                status = mtexts.txts.get("SeparatingApprox", "separating ~{time}").format(
                    time=_format_time_to_exact(mins_to_exact)
                )
            near_rows.append(_data_row_from_pair(pair, dim=True, status_text=status))

    if near_rows:
        rows.append({"kind": "section", "title": mtexts.txts.get("ApproachingWithin90", "Approaching (within 90')")})
        rows.extend(near_rows)

    meta = {
        "tightDedupedCount": len(deduped),
        "filteredOutCount": filtered_out_count,
        "nearMissCount": len(near_rows),
        "nearMissMaxOrbArcmin": float(near_miss_max_orb_arcmin),
        "filterToActiveMoment": bool(filter_to_active_moment),
    }
    return rows, meta


def _active_ecliptic_payload(snapshot) -> list[dict[str, Any]]:
    out = []
    for transit_id, radix_id, aspect_deg, orb_arcmin in snapshot.active_ecliptic:
        out.append(
            {
                "transitId": int(transit_id),
                "transitLabel": at_engine._planet_label(transit_id),
                "transitGlyph": _planet_glyph_text(transit_id),
                "radixId": int(radix_id),
                "radixLabel": at_engine._planet_label(radix_id),
                "radixGlyph": _planet_glyph_text(radix_id),
                "aspectDeg": float(aspect_deg),
                "orbArcmin": float(orb_arcmin),
                "orbText": _format_orb(orb_arcmin),
            }
        )
    return out


class AscensionalTransitService:
    """Build AT snapshot/list payloads for React renderers and future UI routes."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

    def snapshot(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        record_index: Optional[int] = None,
        event_jd: Optional[float] = None,
        when_iso: Optional[str] = None,
        place_payload: Optional[dict[str, Any]] = None,
        filter_to_active_moment: bool = True,
        apply_precession: bool = True,
        include_near_misses: bool = True,
        near_miss_max_orb_arcmin: float = 90.0,
    ) -> dict[str, Any]:
        with self._lock:
            opts = chart_snapshot_service.options
            document_event_jd = None
            document_event_place = None
            document_place_source = None
            chart_b_place = None
            chart_b_place_source = None
            if document_id:
                (
                    radix,
                    resolved_index,
                    document_event_jd,
                    document_event_place,
                    document_place_source,
                    chart_b_place,
                    chart_b_place_source,
                ) = self._document_context(document_id)
            else:
                radix, resolved_index = export_chart_json.load_chart(
                    _source_path(source),
                    opts,
                    name=name,
                    record_index=record_index,
                )
            event_place = None if document_id else _place_from_payload(place_payload)
            if event_place is None:
                if document_event_place is not None:
                    event_place = document_event_place
                    place_source = document_place_source or "session"
                else:
                    event_place, place_source = _default_event_place(radix, opts)
            else:
                place_source = "override"

            event_source = "event_jd"
            if event_jd is None:
                if document_event_jd is not None and when_iso is None:
                    event_jd = document_event_jd
                    event_source = "document"
                else:
                    when = _parse_when(when_iso)
                    event_jd = _event_jd_from_when(radix, when, event_place)
                    event_source = "when" if when_iso else "now"

            snapshot = at_engine.ATSnapshot(
                radix,
                float(event_jd),
                event_place,
                apply_precession=apply_precession,
            )
            rows, row_meta = _list_rows(
                radix,
                snapshot,
                event_place,
                filter_to_active_moment=filter_to_active_moment,
                apply_precession=apply_precession,
                include_near_misses=include_near_misses,
                near_miss_max_orb_arcmin=near_miss_max_orb_arcmin,
            )
            return self._snapshot_payload(
                radix=radix,
                record_index=resolved_index,
                snapshot=snapshot,
                event_place=event_place,
                place_source=place_source,
                event_source=event_source,
                rows=rows,
                row_meta=row_meta,
                filter_to_active_moment=filter_to_active_moment,
                apply_precession=apply_precession,
                chart_b_place=chart_b_place,
                chart_b_place_source=chart_b_place_source,
            )

    def _document_context(self, document_id: str):
        from webapp.daemon.workspace_service import workspace_service

        session = workspace_service._controller.session(str(document_id))
        if not session:
            raise SystemExit(f"Document {document_id!r} not found")
        cs = session.get("chart_session")
        radix = getattr(cs, "radix", None) if cs is not None else None
        if radix is None:
            radix = session.get("chart")
        if radix is None and cs is not None:
            radix = getattr(cs, "chart", None)
        if radix is None:
            raise SystemExit(f"Document {document_id!r} has no chart")

        event_jd = None
        event_place = None
        place_source = "chart_b"
        if (
            session.get("launcher_kind") == "ascensional_transits"
            or session.get("chart_visual_mode") == "ascensional_transits"
        ):
            if cs is not None and getattr(cs, "chart", None) is not None:
                event_jd = getattr(getattr(cs.chart, "time", None), "jd", None)
            if event_jd is None:
                event_jd = session.get("ascensional_event_jd")
        live_chart_b_place = getattr(getattr(cs, "chart", None), "place", None) if cs is not None else None
        chart_b_place = live_chart_b_place or session.get("ascensional_chart_b_place")
        chart_b_place_source = None
        chart_b_payload = session.get("ascensional_chart_b_place_payload")
        if isinstance(chart_b_payload, dict):
            chart_b_place_source = str(chart_b_payload.get("source") or "chart_b")
        if chart_b_place is None:
            chart_b_place = session.get("ascensional_event_place")
            chart_b_place_source = chart_b_place_source or "chart_b"
        if chart_b_place is not None:
            event_place = chart_b_place
        return radix, None, event_jd, event_place, place_source, chart_b_place, chart_b_place_source

    def snap(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        record_index: Optional[int] = None,
        current_jd: float,
        direction: str = "forward",
        place_payload: Optional[dict[str, Any]] = None,
        apply_precession: bool = True,
        max_minutes: int = 360,
        threshold_arcmin: float = 25.0,
        include_snapshot: bool = True,
    ) -> dict[str, Any]:
        with self._lock:
            opts = chart_snapshot_service.options
            radix, _resolved_index = export_chart_json.load_chart(
                _source_path(source),
                opts,
                name=name,
                record_index=record_index,
            )
            event_place = _place_from_payload(place_payload)
            place_source = "override"
            if event_place is None:
                event_place, place_source = _default_event_place(radix, opts)
            result = at_engine.find_next_at_event_jd(
                radix,
                float(current_jd),
                event_place,
                direction=direction,
                max_minutes=max_minutes,
                threshold_arcmin=threshold_arcmin,
                apply_precession=apply_precession,
            )
            payload: dict[str, Any] = {
                "kind": "ascensional_transits_snap",
                "currentJd": float(current_jd),
                "direction": "backward" if direction == "backward" else "forward",
                "place": _place_payload(event_place, source=place_source),
                "applyPrecession": bool(apply_precession),
                "maxMinutes": int(max_minutes),
                "thresholdArcmin": float(threshold_arcmin),
                "result": None,
            }
            if result:
                payload["result"] = {
                    "jd": float(result["jd"]),
                    "datetime": _event_datetime_from_jd(float(result["jd"])),
                    "deltaSeconds": int(round((float(result["jd"]) - float(current_jd)) * 86400.0)),
                    "transitLabel": result.get("transit_label"),
                    "radixLabel": result.get("radix_label"),
                    "aspect": result.get("aspect"),
                    "orbArcmin": float(result.get("orb_arcmin", 0.0)),
                    "orbText": _format_orb(float(result.get("orb_arcmin", 0.0))),
                }
                if include_snapshot:
                    payload["snapshot"] = self.snapshot(
                        source=source,
                        name=name,
                        record_index=record_index,
                        event_jd=float(result["jd"]),
                        place_payload=place_payload,
                        filter_to_active_moment=True,
                        apply_precession=apply_precession,
                    )
            return payload

    def _snapshot_payload(
        self,
        *,
        radix,
        record_index: Optional[int],
        snapshot,
        event_place,
        place_source: str,
        event_source: str,
        rows: list[dict[str, Any]],
        row_meta: dict[str, Any],
        filter_to_active_moment: bool,
        apply_precession: bool,
        chart_b_place=None,
        chart_b_place_source: Optional[str] = None,
    ) -> dict[str, Any]:
        active = _active_ecliptic_payload(snapshot)
        return {
            "kind": "ascensional_transits",
            "radix": {
                "name": getattr(radix, "name", ""),
                "recordIndex": record_index,
                "jd": float(getattr(radix.time, "jd", 0.0)),
                "datetime": export_chart_json.chart_datetime_tuple(radix),
                "place": _place_payload(radix.place, source="radix_place"),
            },
            "event": {
                "jd": float(snapshot.event_jd),
                "datetime": _event_datetime_from_jd(snapshot.event_jd),
                "source": event_source,
                "place": _place_payload(event_place, source=place_source),
                "ramc": float(snapshot.event_ramc),
                "ramcUncorrected": float(snapshot.event_ramc_uncorrected),
                "precessionCorrectionArcmin": float(snapshot.precession_correction_arcmin),
                "applyPrecession": bool(apply_precession),
                "direction": snapshot.direction,
            },
            "points": {
                "radix": [_point_payload(point) for point in snapshot.radix_points],
                "transit": [_point_payload(point) for point in snapshot.transit_points],
            },
            "atPairs": [_pair_payload(pair) for pair in snapshot.at_pairs],
            "activeEclipticAspects": active,
            "twoTransitRule": {
                "isActiveMoment": bool(snapshot.is_active_moment),
                "activeTransitBodyIds": sorted({row["transitId"] for row in active}),
                "aspectOrbFastArcmin": float(at_engine.ECLIPTIC_ORB_FAST_ARCMIN),
                "aspectOrbSlowArcmin": float(at_engine.ECLIPTIC_ORB_SLOW_ARCMIN),
                "aspectMultiplesDeg": [float(15 * k) for k in range(1, 13)],
            },
            "list": {
                "rows": rows,
                "meta": row_meta,
                "filterToActiveMoment": bool(filter_to_active_moment),
            },
            "meta": {
                "orbs": {
                    "conjunctionOppositionArcmin": float(at_engine.ORB_CONJ_OPP_ARCMIN),
                    "antisciaArcmin": float(at_engine.ORB_ANTISCIA_ARCMIN),
                    "parallelArcmin": float(at_engine.ORB_PARALLEL_ARCMIN),
                },
                "precession": {
                    "applied": bool(apply_precession),
                    "correctionArcmin": float(snapshot.precession_correction_arcmin),
                },
                "rowSemantics": {
                    "source": "ascensional_transit_wnd.py:_populate_at_list",
                    "cuspPairDedup": True,
                    "nearMissCap": 8,
                },
            },
        }


ascensional_service = AscensionalTransitService()
