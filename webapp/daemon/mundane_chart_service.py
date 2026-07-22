"""Daemon-side Mundane Chart (planets by mundane position) data.

Canonical brain: ``mundanechart.MundaneChart`` (the wx-fused renderer the
desktop ``MundaneWnd`` draws with, mundanechart.py:92-983). This service does
NOT import that wx-fused module and does NOT reimplement astrology: it lifts the
planet *mundane position* read (the Placidian mundane longitude ``PMP``,
mundanechart.py:702-715, planets.py:37), the visible-body gating
(mundanechart.py:697), the dignity / per-planet colour branch
(mundanechart.py:719-731), retrograde markers (mundanechart.py:752-761), the
12-spoke house frame + names (mundanechart.py:471-515) and the ASC/MC/Desc/IC
axes (mundanechart.py:518-543), then ships a STRUCTURED payload in MUNDANE
DEGREES (0 = ASC, increasing clockwise as wx draws -PMP from math.pi). The React
skin (mundane-chart-view.tsx) owns only Canvas2D replay of the wx fixed radii
(mundanechart.py:150-242) and the pixel-overlap ``arrange`` de-clutter
(mundanechart.py:837-983).

The mundane chart places each body at its mundane position, NOT its zodiacal
longitude — this is why it cannot be a draw-chart.ts snapshot variant.

Output shape (all angles in degrees of mundane longitude, 0 at the ASC)::

  {
    "name": str, "showHouses": bool, "positions": bool, "compound": bool,
    "ascLongitude": float, "ascmcSize": int, "colors": {...},
    "bodies": [{id, glyph, color, mundane, motion, posDeg, posMin, isLof}, ..],
    "secondaryBodies": [{...}, ..] | None,             # wx chart2 / outer ring
    "houses": [{house, name, mundane}, ..],            # 12 equal mundane spokes
    "angles": [{name, mundane, arrow}, ..],            # ASC/IC/Desc/MC axes
    "aspects": [{fromMundane, toMundane, scope, aspect, ...}, ..],
  }

The planet angle is the engine's (the speculum PMP); nothing is computed in TS.
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import ascensional_transits as at_engine
import chart as chart_mod
import chart_session
import chartinspector
import common
import fortune
import houses
import mtexts
import planets
import posfordate
import primdirs
import placspec
import regiospec
import symbolic_time
import util
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon import ascensional_service as ascensional_payload
from webapp.daemon.display_palette import (
    aspect_color_role,
    chart_body_color_role,
    effective_display_options,
)
from webapp.daemon.inspector_service import _fortune_region, _planet_region
from webapp.frontend.scripts import export_chart_json

_DIGNITY_KEYS = ("clrdomicil", "clrexal", "clrperegrin", "clrcasus", "clrexil")
_LOF_BODY_ID = planets.Planets.PLANETS_NUM
_MDO_VISUAL_MODES = {"mdo", "mundane", "ascensional_transits"}
_PROGRESSION_METHOD_BY_FEATURE = {
    "secondary": posfordate.SECONDARY,
    "solar_arc": posfordate.SOLAR_ARC,
    "minor": posfordate.MINOR,
    "tertiary": posfordate.TERTIARY,
}


def _at_house_system_lines() -> list[str]:
    label = str(mtexts.txts.get("PrimDirTopocentric") or "Topocentric (Polich/Page)")
    return [label]


def _mundane_system_lines(chrt) -> list[str]:
    """Overlay label for the coordinate family that places mundane bodies."""
    lines = []
    if int(getattr(chrt.options, "ayanamsha", 0)) != 0:
        lines.append(export_chart_json.ayanamsha_label(int(chrt.options.ayanamsha)))
    pd_system = int(getattr(chrt.options, "primarydir", -1))
    labels = getattr(mtexts, "typeListDirs", ())
    if 0 <= pd_system < len(labels):
        lines.append(str(labels[pd_system]))
    else:
        lines.extend(export_chart_json._export_house_system_lines(chrt))
    return [line for line in lines if line]


def _at_aspect_chart_index(aspect_name: str) -> Optional[int]:
    return {
        at_engine.CONJUNCTION: chart_mod.Chart.CONJUNCTIO,
        at_engine.OPPOSITION: chart_mod.Chart.OPPOSITIO,
        at_engine.PARALLEL: chart_mod.Chart.PARALLEL,
        at_engine.CONTRAPARALLEL: chart_mod.Chart.CONTRAPARALLEL,
    }.get(aspect_name)


def _at_aspect_color_rgb(opts, aspect_name: str) -> list[int]:
    idx = _at_aspect_chart_index(aspect_name)
    colors = list(getattr(opts, "clraspect", []) or [])
    if idx is not None and 0 <= idx < len(colors):
        return _rgb_payload(colors[idx])
    return _rgb_payload(getattr(opts, "clrframe", (0, 0, 0)))


def _at_aspect_color(opts, aspect_name: str) -> str:
    return _rgb_to_hex(_at_aspect_color_rgb(opts, aspect_name))


def _at_aspect_max_orb_arcmin(aspect_name: str) -> float:
    if aspect_name == at_engine.ANTISCIA:
        return float(at_engine.ORB_ANTISCIA_ARCMIN)
    if aspect_name in (at_engine.PARALLEL, at_engine.CONTRAPARALLEL):
        return float(at_engine.ORB_PARALLEL_ARCMIN)
    return float(at_engine.ORB_CONJ_OPP_ARCMIN)


def _rgb_to_hex(rgb) -> str:
    try:
        r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return "#cdcdd1"
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _rgb_payload(rgb) -> list[int]:
    try:
        r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return [205, 205, 209]
    return [max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))]


def _mundane_colors(opts, bw: bool) -> dict:
    if bw:
        black = _rgb_to_hex((0, 0, 0))
        return {
            "background": _rgb_to_hex((255, 255, 255)),
            "frame": black,
            "ascmc": black,
            "houses": black,
            "houseNumbers": black,
            "positions": black,
        }
    return {
        "background": _rgb_to_hex(getattr(opts, "clrbackground", (255, 255, 255))),
        "frame": _rgb_to_hex(getattr(opts, "clrframe", (0, 0, 0))),
        "ascmc": _rgb_to_hex(getattr(opts, "clrAscMC", (0, 0, 0))),
        "houses": _rgb_to_hex(getattr(opts, "clrhouses", (0, 0, 0))),
        "houseNumbers": _rgb_to_hex(getattr(opts, "clrhousenumbers", (0, 0, 0))),
        "positions": _rgb_to_hex(getattr(opts, "clrpositions", (0, 0, 0))),
    }


def _mundane_position(chrt, opts, idx):
    """Mundane longitude (deg) of body ``idx`` for the active PD system.

    Verbatim port of the speculum read in MundaneChart.drawPlanets
    (mundanechart.py:702-715): Placidian/Topocentric → PMP, Regiomontan → RMP,
    Campanian → CMP; the Lot of Fortune reads its own speculum slot."""
    pd = chrt.options.primarydir
    if idx != _LOF_BODY_ID:
        if idx == astrology.SE_TRUE_NODE:
            return util.normalize(
                float(_mundane_position(chrt, opts, astrology.SE_MEAN_NODE)) + 180.0
            )
        body = _chart_body_for_mdo(chrt, idx)
        if body is None:
            raise ValueError(f"chart has no body {idx}")
        spec = body.speculums
        if pd in (primdirs.PrimDirs.PLACIDIANSEMIARC,
                  primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE,
                  primdirs.PrimDirs.TOPOCENTRIC):
            return spec[chart_mod.Chart.PLACIDIAN][planets.Planet.PMP]
        if pd == primdirs.PrimDirs.REGIOMONTAN:
            return spec[chart_mod.Chart.REGIOMONTAN][planets.Planet.RMP]
        if pd == primdirs.PrimDirs.CAMPANIAN:
            return spec[chart_mod.Chart.REGIOMONTAN][planets.Planet.CMP]
        return spec[chart_mod.Chart.PLACIDIAN][planets.Planet.PMP]
    frtn = chrt.fortune
    if pd in (primdirs.PrimDirs.PLACIDIANSEMIARC,
              primdirs.PrimDirs.PLACIDIANUNDERTHEPOLE,
              primdirs.PrimDirs.TOPOCENTRIC):
        return frtn.speculum.speculum[placspec.PlacidianSpeculum.PMP]
    if pd == primdirs.PrimDirs.REGIOMONTAN:
        return frtn.speculum2.speculum[regiospec.RegiomontanianSpeculum.RMP]
    if pd == primdirs.PrimDirs.CAMPANIAN:
        return frtn.speculum2.speculum[regiospec.RegiomontanianSpeculum.CMP]
    return frtn.speculum.speculum[placspec.PlacidianSpeculum.PMP]


def _is_visible(opts, i):
    """Body-visibility gate, verbatim from MundaneChart.drawPlanets
    (mundanechart.py:697): transcendentals/nodes/LoF follow their option flags."""
    if i == astrology.SE_CHIRON and not getattr(opts, "showchiron", True):
        return False
    if i == astrology.SE_URANUS and not opts.transcendental[chart_mod.Chart.TRANSURANUS]:
        return False
    if i == astrology.SE_NEPTUNE and not opts.transcendental[chart_mod.Chart.TRANSNEPTUNE]:
        return False
    if i == astrology.SE_PLUTO and not opts.transcendental[chart_mod.Chart.TRANSPLUTO]:
        return False
    if (i == astrology.SE_MEAN_NODE or i == astrology.SE_TRUE_NODE) and not opts.shownodes:
        return False
    if i == _LOF_BODY_ID and not opts.showlof:
        return False
    return True


def _mundane_body_ids(chrt, opts, *, force_lof: bool = False) -> list[int]:
    ids = list(range(planets.Planets.PLANETS_NUM))
    if getattr(chrt, "chiron", None) is not None and _is_visible(opts, astrology.SE_CHIRON):
        ids.append(astrology.SE_CHIRON)
    if force_lof or _is_visible(opts, _LOF_BODY_ID):
        ids.append(_LOF_BODY_ID)
    return ids


def _chart_body_for_mdo(chrt, body_id: int):
    return common.common.get_chart_planet(chrt, body_id)


def _planet_color_rgb(chrt, opts, i):
    """Per-planet colour, verbatim from MundaneChart.drawPlanets
    (mundanechart.py:719-731): useplanetcolors → clrindividual (with the
    >=PLANETS_NUM-1 index shift), else dignity palette; LoF → clrperegrin."""
    if getattr(opts, "useplanetcolors", False):
        objidx = i
        if i == astrology.SE_CHIRON:
            try:
                objidx = common.common.get_planet_color_index(i)
            except Exception:
                objidx = astrology.SE_PLUTO
        elif i >= planets.Planets.PLANETS_NUM - 1:
            objidx -= 1
        try:
            return opts.clrindividual[objidx]
        except Exception:
            return getattr(opts, "clrperegrin", (205, 205, 209))
    if i < planets.Planets.PLANETS_NUM:
        pal = tuple(getattr(opts, k) for k in _DIGNITY_KEYS)
        try:
            return pal[chrt.dignity(i)]
        except Exception:
            return getattr(opts, "clrperegrin", (205, 205, 209))
    return getattr(opts, "clrperegrin", (205, 205, 209))


def _planet_color_hex(chrt, opts, i) -> str:
    return _rgb_to_hex(_planet_color_rgb(chrt, opts, i))


def _planet_color_role(chrt, opts, i, resolved_color) -> Optional[str]:
    return chart_body_color_role(
        opts,
        chrt,
        i,
        is_fortune=i == _LOF_BODY_ID,
        resolved_color=resolved_color,
    )


def _at_aspect_color_role(opts, aspect_name: str, resolved_color) -> Optional[str]:
    idx = _at_aspect_chart_index(aspect_name)
    if idx is not None:
        return aspect_color_role(opts, idx, resolved_color=resolved_color)
    if _rgb_to_hex(getattr(opts, "clrframe", (0, 0, 0))).lower() == str(resolved_color).lower():
        return "--morinus-frame"
    return None


def _format_mdo(mdo: float, quadrant: int) -> str:
    d, m, s = util.decToDeg(float(mdo))
    return f"Q{int(quadrant)} {int(d):02d}°{int(m):02d}'{int(s):02d}\""


def _point_title(point, body_id: int, opts) -> str:
    if point.kind == "lof":
        return str(mtexts.txts.get("LotOfFortune", "Fortuna"))
    if point.kind == "node":
        return str(getattr(point, "label", None) or common.common.get_planet_name(body_id))
    try:
        return str(common.common.get_planet_name(body_id))
    except Exception:
        return str(getattr(point, "label", "") or "")


def _at_point_glyph(point, body_id: int) -> str:
    if point.kind == "lof":
        return common.common.fortune
    glyph = _planet_glyph(body_id)
    return glyph or str(getattr(point, "label", "") or "")


def _planet_glyph(body_id: int) -> str:
    if body_id == _LOF_BODY_ID:
        return common.common.fortune
    if body_id == astrology.SE_CHIRON:
        return getattr(common.common, "Chiron", "}")
    glyphs = getattr(common.common, "Planets", None)
    if glyphs is None:
        glyphs = ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L')
    if 0 <= int(body_id) < len(glyphs):
        return glyphs[int(body_id)]
    try:
        return common.common.get_planet_glyph(body_id)
    except Exception:
        return ""


def _at_hover_flag(point, body_id: int, chrt, opts, chart_role: str, partner_chart=None) -> dict:
    try:
        if point.kind == "lof":
            region = _fortune_region(chrt, opts, chart_role=chart_role)
        else:
            region = _planet_region(chrt, partner_chart, opts, body_id, chart_role=chart_role)
        payload = chartinspector.build_flag_payload(region, opts) or {}
        rows = list(payload.get("rows") or [])
        rows.insert(1 if rows else 0, ("MDO", _format_mdo(float(point.mdo), int(point.quadrant))))
        payload["rows"] = rows
        payload["chartRole"] = chart_role
        return payload
    except Exception:
        pass
    display_lon = float(point.lon if point.lon is not None else 0.0)
    try:
        _sign_index, lon_text = chartinspector._format_position(display_lon)
    except Exception:
        d, m, s = util.decToDeg(display_lon)
        lon_text = f"{int(d):03d}°{int(m):02d}'{int(s):02d}\""
    return {
        "glyph": _at_point_glyph(point, body_id),
        "title": _point_title(point, body_id, opts),
        "accent": _rgb_payload(_planet_color_rgb(chrt, opts, body_id)),
        "rows": [
            ("Long", lon_text),
            ("MDO", _format_mdo(float(point.mdo), int(point.quadrant))),
        ],
        "compact": False,
        "chartRole": chart_role,
    }


def _at_aspect_endpoint(point, opts) -> dict:
    if point.kind in ("planet", "node"):
        body_id = int(point.idx)
        return {
            "kind": "planet",
            "index": body_id,
            "label": _point_title(point, body_id, opts),
        }
    if point.kind == "lof":
        return {
            "kind": "fortune",
            "label": str(mtexts.txts.get("LotOfFortune", "Fortune")),
        }
    return {
        "kind": str(getattr(point, "kind", "") or "point"),
        "label": str(getattr(point, "label", "") or "Point"),
    }


def _at_aspect_title(aspect_name: str) -> str:
    return {
        at_engine.CONJUNCTION: "Conjunction",
        at_engine.OPPOSITION: "Opposition",
        at_engine.ANTISCIA: "Antiscia",
        at_engine.PARALLEL: "Parallel",
        at_engine.CONTRAPARALLEL: "Contraparallel",
    }.get(aspect_name, "Aspect")


def _at_aspect_hover_flag(pair, opts, aspect_glyph: str, aspect_font: str) -> dict:
    actor = _at_aspect_endpoint(pair.transit, opts)
    target = _at_aspect_endpoint(pair.radix, opts)
    aspect_idx = _at_aspect_chart_index(pair.aspect)
    rgb = _at_aspect_color_rgb(opts, pair.aspect)
    if aspect_idx is not None:
        region = {
            "kind": "aspect",
            "object_id": int(aspect_idx),
            "data": {
                "aspect_type": int(aspect_idx),
                "colour": tuple(rgb),
                "orb": float(pair.orb_arcmin) / 60.0,
                "exact": bool(float(pair.orb_arcmin) <= 1e-9),
                "applying": False,
                "actor": actor,
                "target": target,
            },
        }
        payload = chartinspector.build_flag_payload(region, opts)
        if payload:
            return payload

    rows = []
    if bool(getattr(opts, "aspect_flag_show_parties", True)):
        rows.extend([
            ("From", str(actor.get("label") or "—")),
            ("To", str(target.get("label") or "—")),
        ])
    return {
        "glyph": aspect_glyph if aspect_font == "morinus" else "",
        "title": f"{_at_aspect_title(pair.aspect)} ({abs(float(pair.orb_arcmin)) / 60.0:.1f}°)",
        "accent": rgb,
        "rows": rows,
        "compact": True,
    }


def _progression_overlay_top_left(session: dict) -> Optional[list[str]]:
    cs = session.get("chart_session") if isinstance(session, dict) else None
    feature_kind = session.get("supplementary_feature_kind") if isinstance(session, dict) else None
    method = _PROGRESSION_METHOD_BY_FEATURE.get(feature_kind)
    if cs is None or method is None:
        return None
    radix = getattr(cs, "radix", None)
    chrt = getattr(cs, "chart", None)
    if radix is None or chrt is None:
        return None
    if method == posfordate.SOLAR_ARC:
        sig = getattr(cs, "display_datetime", None)
    else:
        try:
            day_type = posfordate.progression_chart_day_type(
                chrt,
                default=getattr(
                    getattr(radix, "options", None),
                    "progression_day_type",
                    posfordate.PROGRESSION_DAY_TYPE_Q2,
                ),
            )
        except Exception:
            day_type = posfordate.PROGRESSION_DAY_TYPE_Q2
        info = symbolic_time.secondary_direction_symbolic_info(
            radix,
            chrt,
            method=method,
            day_type=day_type,
        )
        if info is None:
            return None
        sig = info.get("signified_datetime")
    if sig is None:
        return None
    try:
        bc = bool(getattr(getattr(radix, "time", None), "bc", False))
        date_display, time_display = export_chart_json.format_datetime_tuple(
            sig, bc=bc, options=getattr(radix, "options", None))
    except Exception:
        return None
    return [date_display, time_display]


class MundaneChartService:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    def data(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        document_id: Optional[str] = None,
    ) -> dict:
        with self._lock:
            canonical_opts = chart_snapshot_service.options
            display_opts = effective_display_options(canonical_opts)
            document_payload = self._data_for_document(document_id, display_opts)
            if document_payload is not None:
                return document_payload
            source_path = (
                str(Path(source).expanduser()) if source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            chrt, _ = export_chart_json.load_chart(
                source_path, canonical_opts, name=source_name
            )
            return self._build(chrt, display_opts)

    def _data_for_document(self, document_id: Optional[str], opts) -> Optional[dict]:
        if not document_id:
            return None
        from webapp.daemon.workspace_service import workspace_service

        session = workspace_service._controller.session(str(document_id))
        if not session:
            return None
        visual_mode = str(session.get("chart_visual_mode") or "")
        if session.get("launcher_kind") == "ascensional_transits":
            return self._build_ascensional_transits(session, opts)
        if visual_mode in _MDO_VISUAL_MODES:
            return self._build_visual_mode(session, opts, visual_mode=visual_mode)
        if session.get("launcher_kind") == "mundane_chart" and session.get("parent_document_id"):
            parent = workspace_service._controller.session(str(session.get("parent_document_id")))
            if parent:
                session = parent
        cs = session.get("chart_session")
        chrt = getattr(cs, "chart", None) if cs is not None else None
        if chrt is not None:
            return self._build(chrt, opts)
        chrt = session.get("chart")
        if chrt is not None:
            return self._build(chrt, opts)
        return None

    def _build_visual_mode(self, session: dict, opts, *, visual_mode: str) -> Optional[dict]:
        cs = session.get("chart_session")
        if cs is None:
            return None
        live = getattr(cs, "chart", None) or session.get("chart")
        if live is None:
            return None
        if visual_mode == "ascensional_transits":
            payload = self._build_ascensional_transits(session, opts)
            if payload is not None:
                payload["visualMode"] = "ascensional_transits"
            return payload
        if visual_mode == "mundane":
            radix = getattr(cs, "radix", None) or session.get("chart")
            if radix is not None and live is not radix:
                payload = self._build_mundane_comparison(
                    radix,
                    live,
                    opts,
                    overlay_top_left_override=_progression_overlay_top_left(session),
                )
            else:
                payload = self._build(
                    live,
                    opts,
                    aspects_override=[],
                    asc_longitude_override=0.0,
                    overlay_top_left_override=_progression_overlay_top_left(session),
                )
            payload["visualMode"] = "mundane"
            return payload
        top_left_override = _progression_overlay_top_left(session)
        radix = getattr(cs, "radix", None) or session.get("chart")
        if radix is not None and live is not radix:
            payload = self._build_mdo_comparison(
                radix,
                live,
                opts,
                overlay_top_left_override=top_left_override,
            )
            payload["visualMode"] = "mdo"
            return payload
        bodies = self._at_bodies(
            self._chart_mdo_points(live, opts, include_cusps=False),
            live,
            opts,
            force_lof=False,
            chart_role="primary",
        )
        payload = self._build(
            live,
            opts,
            bodies_override=bodies,
            asc_longitude_override=0.0,
            overlay_top_left_override=top_left_override,
        )
        payload["visualMode"] = "mdo"
        return payload

    def _build_mdo_comparison(
        self,
        radix,
        live,
        opts,
        *,
        overlay_top_left_override: Optional[list[str]] = None,
    ) -> dict:
        radix_bodies = self._at_bodies(
            self._chart_mdo_points(radix, opts, include_cusps=False),
            radix,
            opts,
            force_lof=False,
            chart_role="primary",
            partner_chart=live,
        )
        live_bodies = self._at_bodies(
            self._chart_mdo_points(live, opts, include_cusps=False),
            live,
            opts,
            force_lof=False,
            chart_role="outer",
            partner_chart=radix,
        )
        return self._build(
            radix,
            opts,
            secondary=live,
            bodies_override=radix_bodies,
            secondary_bodies_override=live_bodies,
            overlay_chart=live,
            asc_longitude_override=0.0,
            overlay_top_left_override=overlay_top_left_override,
        )

    def _build_mundane_comparison(
        self,
        radix,
        live,
        opts,
        *,
        overlay_top_left_override: Optional[list[str]] = None,
    ) -> dict:
        """Legacy MundaneWnd comparison, without AT/MDO contact semantics."""
        radix_bodies = self._at_bodies(
            self._chart_mdo_points(radix, opts, include_cusps=False),
            radix,
            opts,
            force_lof=False,
            chart_role="primary",
            partner_chart=live,
            position_mode="mundane",
        )
        live_bodies = self._at_bodies(
            self._chart_mdo_points(live, opts, include_cusps=False),
            live,
            opts,
            force_lof=False,
            chart_role="outer",
            partner_chart=radix,
            position_mode="mundane",
        )
        return self._build(
            radix,
            opts,
            secondary=live,
            bodies_override=radix_bodies,
            secondary_bodies_override=live_bodies,
            overlay_chart=live,
            aspects_override=[],
            asc_longitude_override=0.0,
            overlay_top_left_override=overlay_top_left_override,
        )

    def _build_ascensional_transits(self, session: dict, opts) -> Optional[dict]:
        cs = session.get("chart_session")
        if cs is None:
            return None
        radix = getattr(cs, "radix", None) or session.get("chart")
        transit = getattr(cs, "chart", None)
        if radix is None:
            return None
        event_jd = getattr(getattr(transit, "time", None), "jd", None)
        if event_jd is None:
            event_jd = session.get("ascensional_event_jd")
        live_chart_b_place = getattr(transit, "place", None)
        event_place = (
            live_chart_b_place
            or session.get("ascensional_chart_b_place")
            or session.get("ascensional_event_place")
            or getattr(radix, "place", None)
        )
        if event_jd is None or event_place is None:
            return None

        snapshot = at_engine.ATSnapshot(
            radix,
            float(event_jd),
            event_place,
            apply_precession=True,
        )
        # AT contacts compare event-time transit MDOs with the fixed radix MDO
        # table. The wheel flattens those MDO+quadrant pairs to PMP so the list
        # and drawing use the same geometry without re-housing the birth chart.
        transit_points = list(snapshot.transit_points)
        event_fortune = self._at_event_fortune_point(transit, snapshot)
        if event_fortune is not None:
            transit_points.append(event_fortune)
        radix_bodies = self._at_bodies(
            snapshot.radix_points,
            radix,
            opts,
            force_lof=True,
            chart_role="primary",
            partner_chart=transit,
        )
        transit_bodies = self._at_bodies(
            transit_points,
            transit or radix,
            opts,
            force_lof=True,
            chart_role="outer",
            partner_chart=radix if transit is not None else None,
        )
        aspects = self._at_aspects(snapshot.at_pairs, opts, force_lof=True, scope="at")
        compound = (
            transit is not None
            and (
                getattr(cs, "view_mode", None) == chart_session.ChartSession.COMPOUND
                or session.get("chart_visual_mode") == "ascensional_transits"
            )
        )
        if compound:
            return self._build(
                radix,
                opts,
                secondary=transit,
                show_houses_override=True,
                bodies_override=radix_bodies,
                secondary_bodies_override=transit_bodies,
                overlay_chart=transit,
                overlay_house_system_lines=_at_house_system_lines(),
                force_show_house_system=True,
                aspects_override=aspects,
                asc_longitude_override=0.0,
            )
        return self._build(
            transit or radix,
            opts,
            show_houses_override=True,
            bodies_override=transit_bodies if transit is not None else radix_bodies,
            overlay_chart=transit or radix,
            overlay_house_system_lines=_at_house_system_lines(),
            force_show_house_system=True,
            aspects_override=aspects,
            asc_longitude_override=0.0,
        )

    def _build(
        self,
        chrt,
        opts,
        *,
        secondary=None,
        show_houses_override: Optional[bool] = None,
        bodies_override: Optional[list[dict]] = None,
        secondary_bodies_override: Optional[list[dict]] = None,
        overlay_chart=None,
        overlay_house_system_lines: Optional[list[str]] = None,
        force_show_house_system: Optional[bool] = None,
        aspects_override: Optional[list[dict]] = None,
        asc_longitude_override: Optional[float] = None,
        overlay_top_left_override: Optional[list[str]] = None,
    ) -> dict:
        # show_houses predicate, verbatim from MundaneChart.__init__
        # (mundanechart.py:138-139): houses toggle on AND a real house system.
        if show_houses_override is not None:
            show_houses = bool(show_houses_override)
        else:
            show_houses = bool(
                getattr(opts, "houses", False) and getattr(opts, "hsys", "P") != 'N'
            )

        # --- Bodies (mundanechart.py:696-777) -------------------------------
        bodies = bodies_override if bodies_override is not None else self._bodies(chrt, opts)

        secondary_bodies = None
        if secondary_bodies_override is not None:
            secondary_bodies = secondary_bodies_override
        elif secondary is not None:
            secondary_bodies = self._bodies(secondary, opts)

        # --- House spokes (mundanechart.py:478-501) -------------------------
        # 12 EQUAL mundane spokes (the mundane house frame is angle-uniform, not
        # cusp-driven). wx draws them from math.pi stepping -30°, with names at
        # the spoke-midpoints (offs = math.pi - 15°). In mundane degrees (0 at
        # the ASC, the leftmost point), the spokes sit at 0, 30, 60, ... and the
        # name for house i is centred at the midpoint of its sector.
        houses_out = []
        for i in range(houses.Houses.HOUSE_NUM):
            houses_out.append({
                "house": i + 1,
                "name": common.common.Housenames[i],
                # spoke at the cusp, midpoint label angle
                "mundane": float(i * 30.0),
                "nameMundane": float(i * 30.0 + 15.0),
            })

        # --- Angles (mundanechart.py:532-542) -------------------------------
        # ASC/IC/Desc/MC axes — 4 spokes from math.pi stepping -90°, i.e. mundane
        # 0 (ASC) / 90 (IC) / 180 (Desc) / 270 (MC). wx draws the arrowhead on
        # the endpoint reached AFTER the i==2/i==3 step (offs -= 90 happens
        # before the i==2/3 arrow check), which lands on the MC (mundane 270)
        # and the ASC (mundane 0). So the ASC and MC spokes carry the arrow.
        angle_names = ("ASC", "IC", "Desc", "MC")
        angles = []
        for i in range(4):
            name = angle_names[i]
            angles.append({
                "name": name,
                "mundane": float(i * 90.0),
                "arrow": bool(name in ("ASC", "MC")),
            })

        if aspects_override is not None:
            aspects = aspects_override
        elif secondary is not None:
            aspects = self._mdo_comparison_aspects(secondary, chrt, opts)
        else:
            aspects = self._mdo_within_aspects(chrt, opts)

        bw = bool(getattr(opts, "bw", False))
        return {
            "name": getattr(chrt, "name", ""),
            "showHouses": show_houses,
            "positions": bool(getattr(opts, "positions", False)),
            "compound": bool(secondary_bodies is not None),
            "ascLongitude": (
                float(asc_longitude_override)
                if asc_longitude_override is not None
                else float(chrt.houses.ascmc[houses.Houses.ASC])
            ),
            "ascmcSize": int(getattr(opts, "ascmcsize", 5)),
            "colors": _mundane_colors(opts, bw),
            "bodies": bodies,
            "secondaryBodies": secondary_bodies,
            "houses": houses_out,
            "angles": angles,
            "aspects": aspects,
            "overlay": self._overlay_payload(
                overlay_chart or secondary or chrt,
                house_system_lines_override=overlay_house_system_lines,
                force_show_house_system=force_show_house_system,
                top_left_override=overlay_top_left_override,
            ),
        }

    def _overlay_payload(
        self,
        chrt,
        *,
        house_system_lines_override: Optional[list[str]] = None,
        force_show_house_system: Optional[bool] = None,
        top_left_override: Optional[list[str]] = None,
    ) -> dict:
        date_display, time_display = export_chart_json.format_chart_datetime(chrt)
        lon_txt, lat_txt = export_chart_json.format_coord_pair(chrt.place)
        house_system_lines = (
            list(house_system_lines_override)
            if house_system_lines_override is not None
            else _mundane_system_lines(chrt)
        )
        corner_lines = export_chart_json.composite_corner_lines(chrt)
        top_left = (
            corner_lines.get("topLeft")
            if isinstance(corner_lines, dict) and corner_lines.get("topLeft")
            else [date_display, time_display]
        )
        if top_left_override is not None:
            top_left = list(top_left_override)
        return {
            "showInformation": bool(getattr(chrt.options, "information", True)),
            "showHouseSystem": (
                bool(force_show_house_system)
                if force_show_house_system is not None
                else bool(getattr(chrt.options, "housesystem", False))
            ),
            "topLeft": top_left,
            "bottomLeft": (
                corner_lines.get("bottomLeft")
                if isinstance(corner_lines, dict) and corner_lines.get("bottomLeft")
                else [chrt.place.place, f"{lon_txt}, {lat_txt}"]
            ),
            "houseSystemLines": house_system_lines,
        }

    def _bodies(self, chrt, opts) -> list[dict]:
        bodies = []
        for i in _mundane_body_ids(chrt, opts):
            if not _is_visible(opts, i):
                continue
            xmp = _mundane_position(chrt, opts, i)
            glyph = _planet_glyph(i)
            motion = ""
            if i != _LOF_BODY_ID:
                body = common.common.get_chart_planet(chrt, i)
                if body is not None:
                    speed = body.data[planets.Planet.SPLON]
                    if speed <= 0.0:
                        motion = "S" if speed == 0.0 else "R"
            # Position label = the mundane degree split (mundanechart.py:766).
            d, m, s = util.decToDeg(xmp)
            color = _planet_color_hex(chrt, opts, i)
            bodies.append({
                "id": int(i),
                "glyph": glyph,
                "color": color,
                "colorRole": _planet_color_role(chrt, opts, i, color),
                "mundane": float(xmp),
                "motion": motion,
                "posDeg": int(d),
                "posMin": int(m),
                "isLof": bool(i == _LOF_BODY_ID),
            })
        return bodies

    def _at_event_fortune_point(self, transit, snapshot):
        if transit is None or getattr(transit, "fortune", None) is None:
            return None
        try:
            lof = transit.fortune.fortune
            ra = lof[fortune.Fortune.RA]
            decl = lof[fortune.Fortune.DECL]
            mdo, q, above = at_engine.compute_mdo(
                ra,
                decl,
                snapshot.event_ramc,
                snapshot.event_place.lat,
            )
            if mdo is None:
                return None
            return at_engine.MDOPoint(
                kind="lof",
                idx=0,
                label="LoF",
                ra=ra,
                decl=decl,
                lon=lof[fortune.Fortune.LON],
                lat=lof[fortune.Fortune.LAT],
                mdo=mdo,
                quadrant=q,
                above_horizon=above,
                fixed_in_frame=False,
            )
        except Exception:
            return None

    def _at_bodies(
        self,
        points,
        chrt,
        opts,
        *,
        force_lof: bool = False,
        chart_role: str = "primary",
        partner_chart=None,
        position_mode: str = "mdo",
    ) -> list[dict]:
        bodies = []
        for point in points:
            body_id = None
            if point.kind == "planet":
                body_id = int(point.idx)
                if not _is_visible(opts, body_id):
                    continue
            elif point.kind == "node":
                body_id = int(point.idx)
                if not bool(getattr(opts, "shownodes", False)):
                    continue
            elif point.kind == "lof":
                body_id = _LOF_BODY_ID
                if not force_lof and not bool(getattr(opts, "showlof", False)):
                    continue
            else:
                continue
            pmp = at_engine._pmp_from_mdo_q(point.mdo, point.quadrant)
            # Geometry always uses absolute PMP so both charts share the same
            # ASC/MC cross. Marr/AT surfaces print 0..90 MDO; legacy mundane
            # charts print the same 0..360 PMP/RMP/CMP used for placement.
            printed_position = float(pmp) if position_mode == "mundane" else float(point.mdo)
            d, m, _s = util.decToDeg(printed_position)
            color = _planet_color_hex(chrt, opts, body_id)
            bodies.append({
                "id": body_id,
                "glyph": self._at_glyph(point, body_id),
                "color": color,
                "colorRole": _planet_color_role(chrt, opts, body_id, color),
                "mundane": float(pmp),
                "motion": self._motion_for_body(chrt, body_id),
                "posDeg": int(d),
                "posMin": int(m),
                "isLof": bool(point.kind == "lof"),
                "hoverFlag": _at_hover_flag(point, body_id, chrt, opts, chart_role, partner_chart),
            })
        return bodies

    @staticmethod
    def _at_glyph(point, body_id: int) -> str:
        return _at_point_glyph(point, body_id)

    def _mdo_within_aspects(self, chrt, opts) -> list[dict]:
        points = self._chart_mdo_points(chrt, opts, include_cusps=False)
        pairs = self._detect_mdo_pairs(points, within=True)
        return self._aspect_payloads(pairs, opts, force_lof=False, scope="within")

    def _mdo_comparison_aspects(self, source, target, opts) -> list[dict]:
        source_points = self._chart_mdo_points(source, opts, include_cusps=False)
        target_points = self._chart_mdo_points(target, opts, include_cusps=False)
        pairs = self._detect_mdo_pairs(source_points, target_points, within=False)
        return self._aspect_payloads(pairs, opts, force_lof=False, scope="comparison")

    def _chart_mdo_points(
        self,
        chrt,
        opts,
        *,
        include_cusps: bool = False,
    ) -> list:
        pts = []
        for body_id in _mundane_body_ids(chrt, opts):
            try:
                pmp = _mundane_position(chrt, opts, body_id)
                mdo, q = at_engine._mdo_q_from_pmp(pmp)
            except Exception:
                continue
            if body_id == _LOF_BODY_ID:
                try:
                    lof = chrt.fortune.fortune
                    pts.append(at_engine.MDOPoint(
                        kind="lof",
                        idx=0,
                        label="LoF",
                        ra=lof[fortune.Fortune.RA],
                        decl=lof[fortune.Fortune.DECL],
                        lon=lof[fortune.Fortune.LON],
                        lat=lof[fortune.Fortune.LAT],
                        mdo=mdo,
                        quadrant=q,
                        above_horizon=(q in (1, 4)),
                        fixed_in_frame=True,
                    ))
                except Exception:
                    continue
                continue
            body = _chart_body_for_mdo(chrt, body_id)
            if body is None:
                continue
            kind = "node" if body_id in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) else "planet"
            pts.append(at_engine.MDOPoint(
                kind=kind,
                idx=body_id,
                label=common.common.get_planet_name(body_id),
                ra=body.dataEqu[planets.Planet.RAEQU],
                decl=body.dataEqu[planets.Planet.DECLEQU],
                lon=body.data[planets.Planet.LONG],
                lat=body.data[planets.Planet.LAT],
                mdo=mdo,
                quadrant=q,
                above_horizon=(q in (1, 4)),
                fixed_in_frame=True,
            ))
        if include_cusps:
            for cusp_idx, (mdo, q) in at_engine._CUSP_MDO_Q.items():
                pts.append(at_engine.MDOPoint(
                    kind="cusp",
                    idx=cusp_idx,
                    label=f"{cusp_idx} cusp",
                    ra=None,
                    decl=None,
                    lon=chrt.houses.cusps[cusp_idx],
                    lat=None,
                    mdo=mdo,
                    quadrant=q,
                    above_horizon=(q in (1, 4)),
                    fixed_in_frame=True,
                ))
        return pts

    def _detect_mdo_pairs(self, from_points, to_points=None, *, within: bool = False) -> list:
        pairs = []

        def add_pair(point_a, point_b):
            if (
                within
                and point_a.kind == "node"
                and point_b.kind == "node"
                and {int(point_a.idx), int(point_b.idx)}
                == {astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE}
            ):
                return
            if (
                point_a.kind == "planet"
                and point_b.kind == "planet"
                and point_a.idx == point_b.idx
            ):
                return
            try:
                pmp_a = at_engine._pmp_from_mdo_q(point_a.mdo, point_a.quadrant)
                pmp_b = at_engine._pmp_from_mdo_q(point_b.mdo, point_b.quadrant)
            except Exception:
                return
            aspect, orb_arcmin = at_engine._pmp_aspect(
                pmp_a,
                pmp_b,
                orb_conj=at_engine.ORB_CONJ_OPP_ARCMIN,
                orb_antiscia=at_engine.ORB_ANTISCIA_ARCMIN,
            )
            if aspect is not None:
                pairs.append(at_engine.ATPair(point_a, point_b, aspect, orb_arcmin))
            if (
                point_a.kind in ("planet", "lof", "node")
                and point_b.kind in ("planet", "lof", "node")
                and point_a.decl is not None
                and point_b.decl is not None
            ):
                par = abs(point_a.decl - point_b.decl) * 60.0
                contrapar = abs(point_a.decl + point_b.decl) * 60.0
                if par <= at_engine.ORB_PARALLEL_ARCMIN:
                    pairs.append(at_engine.ATPair(point_a, point_b, at_engine.PARALLEL, par))
                elif contrapar <= at_engine.ORB_PARALLEL_ARCMIN:
                    pairs.append(at_engine.ATPair(point_a, point_b, at_engine.CONTRAPARALLEL, contrapar))

        if within:
            points = list(from_points)
            for idx, point_a in enumerate(points):
                for point_b in points[idx + 1:]:
                    add_pair(point_a, point_b)
        else:
            for point_a in from_points:
                for point_b in (to_points or []):
                    add_pair(point_a, point_b)
        return pairs

    def _at_aspects(self, pairs, opts, *, force_lof: bool = False, scope: str = "at") -> list[dict]:
        return self._aspect_payloads(
            ascensional_payload._dedup_cusp_pair_duplicates(pairs),
            opts,
            force_lof=force_lof,
            scope=scope,
        )

    def _aspect_payloads(self, pairs, opts, *, force_lof: bool = False, scope: str) -> list[dict]:
        if not bool(getattr(opts, "aspects", False)):
            return []

        aspects = []
        for pair in pairs:
            if not self._at_point_visible(pair.transit, opts, force_lof=force_lof):
                continue
            if not self._at_point_visible(pair.radix, opts, force_lof=force_lof):
                continue
            try:
                from_pmp = at_engine._pmp_from_mdo_q(pair.transit.mdo, pair.transit.quadrant)
                to_pmp = at_engine._pmp_from_mdo_q(pair.radix.mdo, pair.radix.quadrant)
            except Exception:
                continue
            aspect_glyph, aspect_font = ascensional_payload._aspect_glyph_and_font(pair.aspect)
            color = _at_aspect_color(opts, pair.aspect)
            aspects.append({
                "fromMundane": float(from_pmp),
                "toMundane": float(to_pmp),
                "scope": scope,
                # Backward-compatible names for older clients/tests.
                "transitMundane": float(from_pmp),
                "radixMundane": float(to_pmp),
                "aspect": pair.aspect,
                "aspectGlyph": aspect_glyph,
                "aspectFont": aspect_font,
                "orbArcmin": float(pair.orb_arcmin),
                "maxOrbArcmin": _at_aspect_max_orb_arcmin(pair.aspect),
                "color": color,
                "colorRole": _at_aspect_color_role(opts, pair.aspect, color),
                "hoverFlag": _at_aspect_hover_flag(pair, opts, aspect_glyph, aspect_font),
            })
        aspects.sort(key=lambda item: (float(item["orbArcmin"]), str(item["aspect"])))
        return aspects

    @staticmethod
    def _at_point_visible(point, opts, *, force_lof: bool = False) -> bool:
        if point.kind == "planet":
            return _is_visible(opts, int(point.idx))
        if point.kind == "node":
            return bool(getattr(opts, "shownodes", False))
        if point.kind == "lof":
            return bool(force_lof or getattr(opts, "showlof", False))
        if point.kind in ("cusp", "angle"):
            return True
        return False

    @staticmethod
    def _motion_for_body(chrt, body_id: int) -> str:
        try:
            if body_id == planets.Planets.PLANETS_NUM:
                return ""
            body = common.common.get_chart_planet(chrt, body_id)
            if body is None:
                return ""
            speed = body.data[planets.Planet.SPLON]
        except Exception:
            return ""
        if speed > 0.0:
            return ""
        return "S" if speed == 0.0 else "R"


mundane_chart_service = MundaneChartService()
