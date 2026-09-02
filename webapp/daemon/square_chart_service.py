# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side Square Chart (medieval square diagram) data.

Canonical brain: ``squarechart.SquareChart`` (the wx-fused renderer the desktop
``SquareChartWnd`` draws with, squarechart.py:16-376). This service does NOT
import that wx-fused module and does NOT reimplement any astrology: it lifts the
pure house-membership / ordering logic from ``SquareChart.getPlanetsInHouse``
(squarechart.py:320-376), the per-planet display reads (dignity colour,
retrograde marker, ayanamsha rebase) from ``SquareChart.drawChart``
(squarechart.py:218-311), and the resolved wx colour/text payload the React
renderer needs to replay the fixed-coordinate square drawing faithfully.

Output shape::

  {
    "name": str, "houseSystem": str, "info": [str, ..],   # header text lines
    "dayHour": [{"glyph": str, "label": str}, ..],
    "colors": {"background": str, "frame": str, "texts": str,
               "positions": str, "signs": str},
    "cusps": [{house, sign, signGlyph, deg, min}, ..],     # 12 house cusps
    "houses": [                                            # 12 houses, planets within
      {"house": int,
       "planets": [{id, glyph, color, sign, signGlyph, deg, min,
                    motion, isLof, isVertex}, ..]},
      ..
    ],
  }

House membership + intra-house ordering is the engine's
(``houses.getHousePos`` houses.py:104, then the wx bubble-sort + reverse for
houses 6..11, squarechart.py:360-375). Nothing positional is computed in TS.
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
import chart as chart_mod
import common
import dateformat
import fortune
import houses
import planets
import util
import mtexts
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import chart_body_color_role, effective_display_options
from webapp.frontend.scripts import export_chart_json

# House-system label table — verbatim from SquareChart.__init__
# (squarechart.py:63). Lifted inline (the wx module is not importable here).
_HSYSTEM = {
    'P': 'Placidus', 'K': 'Koch', 'R': 'Regiomontanus', 'C': 'Campanus',
    'E': 'Equal', 'W': 'Whole Sign', 'F': 'Fortune Houses', 'X': 'Axial', 'Q': 'True Ascendant', 'M': 'Morinus',
    'H': 'Horizontal', 'T': 'Page/Polich', 'B': 'Alcabitus',
    'O': 'Porphyrius', 'N': 'Angles only',
}

# Dignity-index → colour key order, verbatim from SquareChart.__init__
# (squarechart.py:62): domicil, exal, peregrin, casus, exil.
_DIGNITY_KEYS = ("clrdomicil", "clrexal", "clrperegrin", "clrcasus", "clrexil")


def _rgb_to_hex(rgb) -> str:
    try:
        r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
    except Exception:
        return "#cdcdd1"
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _square_colors(opts, bw: bool) -> dict:
    if bw:
        black = _rgb_to_hex((0, 0, 0))
        return {
            "background": _rgb_to_hex((255, 255, 255)),
            "frame": black,
            "texts": black,
            "positions": black,
            "signs": black,
        }
    return {
        "background": _rgb_to_hex(getattr(opts, "clrbackground", (255, 255, 255))),
        "frame": _rgb_to_hex(getattr(opts, "clrframe", (0, 0, 0))),
        "texts": _rgb_to_hex(getattr(opts, "clrtexts", (0, 0, 0))),
        "positions": _rgb_to_hex(getattr(opts, "clrpositions", (0, 0, 0))),
        "signs": _rgb_to_hex(getattr(opts, "clrsigns", (0, 0, 0))),
    }


def _planet_color_hex(chrt, opts, idxpl, bw: bool = False) -> str:
    """Per-planet colour, verbatim port of the SquareChart.drawChart colour
    branch (squarechart.py:266-285): useplanetcolors → clrindividual (with the
    SE_MEAN_NODE remap), else dignity palette; Vertex/LoF → clrperegrin."""
    if bw:
        return _rgb_to_hex((0, 0, 0))
    if getattr(opts, "useplanetcolors", False):
        objidx = idxpl
        if objidx == common.CHART_OBJECT_VERTEX:
            return _rgb_to_hex(opts.clrperegrin)
        if objidx == planets.Planets.PLANETS_NUM - 1:
            objidx = astrology.SE_MEAN_NODE
        elif objidx > planets.Planets.PLANETS_NUM - 1:
            objidx = astrology.SE_MEAN_NODE + 1
        try:
            return _rgb_to_hex(opts.clrindividual[objidx])
        except Exception:
            return _rgb_to_hex(opts.clrperegrin)
    if idxpl < planets.Planets.PLANETS_NUM:
        pal = tuple(getattr(opts, k) for k in _DIGNITY_KEYS)
        try:
            return _rgb_to_hex(pal[chrt.dignity(idxpl)])
        except Exception:
            return _rgb_to_hex(opts.clrperegrin)
    return _rgb_to_hex(opts.clrperegrin)


def _get_planets_in_house(chrt, opts, hnum):
    """Pure port of SquareChart.getPlanetsInHouse (squarechart.py:320-376):
    return (longitudes, object-ids) of every visible body whose house == hnum,
    sorted by longitude, then reversed for houses 5..10 (the lower hemisphere of
    the square), exactly as the wx brain orders them."""
    inhouse = []
    mixed = []
    for i in range(planets.Planets.PLANETS_NUM + 1):
        if i in (astrology.SE_URANUS, astrology.SE_NEPTUNE, astrology.SE_PLUTO):
            continue
        if i < planets.Planets.PLANETS_NUM:
            lon = chrt.planets.planets[i].data[planets.Planet.LONG]
        else:
            lon = chrt.fortune.fortune[fortune.Fortune.LON]

        num = chrt.houses.getHousePos(lon, opts)
        if num == hnum:
            inhouse.append(lon)
            mixed.append(i)

    if getattr(opts, "showvertex", False):
        lon = chrt.houses.ascmc[houses.Houses.VERTEX]
        num = chrt.houses.getHousePos(lon, opts)
        if num == hnum:
            inhouse.append(lon)
            mixed.append(common.CHART_OBJECT_VERTEX)

    num = len(inhouse)
    for _ in range(num):
        for i in range(num - 1):
            if inhouse[i] > inhouse[i + 1]:
                inhouse[i], inhouse[i + 1] = inhouse[i + 1], inhouse[i]
                mixed[i], mixed[i + 1] = mixed[i + 1], mixed[i]

    if 5 <= hnum <= 10:
        inhouse.reverse()
        mixed.reverse()
    return inhouse, mixed


def _sign_split(lon):
    """(sign 0-11, deg-in-sign, min) for a longitude — the wx decToDeg + sign
    split (squarechart.py:224-227, 299-303)."""
    d, m, s = util.decToDeg(lon)
    sign = int(d / chart_mod.Chart.SIGN_DEG)
    pos = d % chart_mod.Chart.SIGN_DEG
    return sign, pos, m


class SquareChartService:
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
            chrt = self._chart_for_document(document_id)
            if chrt is not None:
                return self._build(chrt, display_opts)
            source_path = (
                str(Path(source).expanduser()) if source
                else str(export_chart_json.DEFAULT_SOURCE)
            )
            chrt, _ = export_chart_json.load_chart(
                source_path, canonical_opts, name=source_name
            )
            return self._build(chrt, display_opts)

    def _chart_for_document(self, document_id: Optional[str]):
        if not document_id:
            return None
        from webapp.daemon.workspace_service import workspace_service

        session = workspace_service._controller.session(str(document_id))
        if not session:
            return None
        if session.get("launcher_kind") == "square_chart" and session.get("parent_document_id"):
            parent = workspace_service._controller.session(str(session.get("parent_document_id")))
            if parent:
                session = parent
        cs = session.get("chart_session")
        chrt = getattr(cs, "chart", None) if cs is not None else None
        if chrt is not None:
            return chrt
        return session.get("chart")

    def _build(self, chrt, opts) -> dict:
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
        bw = bool(getattr(opts, "bw", False))

        # --- House cusps (squarechart.py:218-233) ---------------------------
        cusps = []
        for i in range(houses.Houses.HOUSE_NUM):
            lon = chrt.houses.cusps[i + 1]
            sign, pos, m = _sign_split(lon)
            cusps.append({
                "house": i + 1,
                "sign": sign,
                "signGlyph": signs[sign],
                "deg": int(pos),
                "min": int(m),
            })

        # --- Planets per house (squarechart.py:235-311) ---------------------
        houses_out = []
        for hidx in range(houses.Houses.HOUSE_NUM):
            order, mixed = _get_planets_in_house(chrt, opts, hidx)
            plist = []
            for j in range(len(order)):
                idxpl = mixed[j]
                lon = order[j]
                sign, pos, m = _sign_split(lon)

                if idxpl < planets.Planets.PLANETS_NUM:
                    glyph = common.common.Planets[idxpl]
                elif idxpl == common.CHART_OBJECT_VERTEX:
                    glyph = common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX)
                else:
                    glyph = common.common.fortune

                motion = ""
                if idxpl < planets.Planets.PLANETS_NUM:
                    speed = chrt.planets.planets[idxpl].data[planets.Planet.SPLON]
                    if speed <= 0.0:
                        motion = "S" if speed == 0.0 else "R"

                color = _planet_color_hex(chrt, opts, idxpl, bw)
                is_lof = idxpl == planets.Planets.PLANETS_NUM
                is_vertex = idxpl == common.CHART_OBJECT_VERTEX

                plist.append({
                    "id": int(idxpl),
                    "glyph": glyph,
                    "color": color,
                    "colorRole": chart_body_color_role(
                        opts,
                        chrt,
                        idxpl,
                        is_fortune=is_lof,
                        is_vertex=is_vertex,
                        resolved_color=color,
                    ),
                    "sign": sign,
                    "signGlyph": signs[sign],
                    "deg": int(pos),
                    "min": int(m),
                    "motion": motion,
                    "isLof": bool(is_lof),
                    "isVertex": bool(is_vertex),
                })
            houses_out.append({"house": hidx + 1, "planets": plist})

        # --- Header info lines (squarechart.py:162-207) ---------------------
        info = self._info_lines(chrt, opts)
        day_hour = self._day_hour_lines(chrt)

        return {
            "name": getattr(chrt, "name", ""),
            "houseSystem": _HSYSTEM.get(opts.hsys, opts.hsys),
            "info": info,
            "dayHour": day_hour,
            "colors": _square_colors(opts, bw),
            "cusps": cusps,
            "houses": houses_out,
        }

    def _info_lines(self, chrt, opts) -> list:
        """The square chart's central text block (squarechart.py:162-198):
        date, time+zone, place, coordinates, name, chart type, house system."""
        t = chrt.time
        zonetxts = (
            mtexts.txts['ZN'], mtexts.txts['UT'], mtexts.txts['LC'], mtexts.txts['LC'],
        )
        datetxt = dateformat.date_text(t.origyear, t.origmonth, t.origday, opts, bc=getattr(t, "bc", False))
        if t.cal == chart_mod.Time.JULIAN:
            datetxt += " " + mtexts.txts['J']
        timetxt = "%s:%s:%s %s" % (
            str(t.hour).zfill(2), str(t.minute).zfill(2), str(t.second).zfill(2),
            zonetxts[t.zt],
        )
        p = chrt.place
        dirlon = mtexts.txts['E'] if p.east else mtexts.txts['W']
        dirlat = mtexts.txts['N'] if p.north else mtexts.txts['S']
        coordtxt = "%s°%s'%s  %s°%s'%s" % (
            str(p.deglon).zfill(2), str(p.minlon).zfill(2), dirlon,
            str(p.deglat).zfill(2), str(p.minlat).zfill(2), dirlat,
        )
        try:
            typetxt = mtexts.typeList[chrt.htype]
        except Exception:
            typetxt = ""
        return [
            datetxt,
            timetxt,
            p.place,
            coordtxt,
            getattr(chrt, "name", ""),
            typetxt,
            _HSYSTEM.get(opts.hsys, opts.hsys),
        ]

    def _day_hour_lines(self, chrt) -> list:
        """Planetary day/hour glyph rows, matching squarechart.py:199-207."""
        ph = getattr(chrt.time, "ph", None)
        if ph is None:
            return []
        weekday_map = (1, 4, 2, 5, 3, 6, 0)
        try:
            day_idx = weekday_map[int(ph.weekday)]
            hour_idx = int(ph.planetaryhour)
            return [
                {"glyph": common.common.Planets[day_idx], "label": mtexts.txts['Day']},
                {"glyph": common.common.Planets[hour_idx], "label": mtexts.txts['Hour']},
            ]
        except Exception:
            return []


square_chart_service = SquareChartService()
