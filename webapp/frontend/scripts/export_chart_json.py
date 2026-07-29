#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import logging
import math
import os
import subprocess
import sys
import time
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import build_info
import chart as chart_mod
import chart_context_view
import chartfile
import dateformat
import note_storage
from engine import chart_factory
import common
import fixstars
import fortune
import horfileio
import houses
import hours
import interchartaspects
import lordofyear
import mtexts
import options
import planets
import radixsignals
import symbolic_time
import util
import arabicparts
from aries.ui import tokens as _tokens


logger = logging.getLogger(__name__)


DEFAULT_SOURCE = Path(note_storage.startup_chart_collection_path())

PLANET_ID_MAP = {
    astrology.SE_SUN: "sun",
    astrology.SE_MOON: "moon",
    astrology.SE_MERCURY: "mercury",
    astrology.SE_VENUS: "venus",
    astrology.SE_MARS: "mars",
    astrology.SE_JUPITER: "jupiter",
    astrology.SE_SATURN: "saturn",
    astrology.SE_URANUS: "uranus",
    astrology.SE_NEPTUNE: "neptune",
    astrology.SE_PLUTO: "pluto",
    astrology.SE_MEAN_NODE: "nnode",
    astrology.SE_TRUE_NODE: "snode",
    astrology.SE_CHIRON: "chiron",
}

# se_id -> mtexts key for outer-ring planet-source labels. Resolved at CALL time
# (not captured at import) so the label follows the active mtexts language. The
# North node ("NorthNode") is keyed; the mean/true "South Node" variant has no
# mtexts key, so it keeps its English literal (per-item fallback, not invented).
_PLANET_LABEL_KEYS = {
    astrology.SE_SUN: "Sun",
    astrology.SE_MOON: "Moon",
    astrology.SE_MERCURY: "Mercury",
    astrology.SE_VENUS: "Venus",
    astrology.SE_MARS: "Mars",
    astrology.SE_JUPITER: "Jupiter",
    astrology.SE_SATURN: "Saturn",
    astrology.SE_URANUS: "Uranus",
    astrology.SE_NEPTUNE: "Neptune",
    astrology.SE_PLUTO: "Pluto",
    astrology.SE_MEAN_NODE: "NorthNode",
}
_PLANET_LABEL_ENGLISH_FALLBACK = {
    astrology.SE_TRUE_NODE: "South Node",  # no mtexts key; stays English by design
}


def planet_display_label(se_id, opts=None):
    """Human-facing planet label for rendered secondary-ring source points.

    ``PLANET_ID_MAP`` is intentionally lowercase and machine-stable. Outer-ring
    overlays such as dodecatemoria need the same display names as planet hover
    flags, so keep that translation separate. Labels resolve against the active
    mtexts language on every call — never cached at import.
    """
    se_id = int(se_id)
    key = _PLANET_LABEL_KEYS.get(se_id)
    label = mtexts.txts.get(key) if key else None
    if not label:
        label = _PLANET_LABEL_ENGLISH_FALLBACK.get(se_id)
    if label:
        if se_id in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not bool(getattr(opts, "meannode", True)):
            return f"{label} (T)"
        return label
    try:
        name = common.common.get_planet_name(se_id)
        if name:
            return name
    except Exception:
        pass
    fallback = PLANET_ID_MAP.get(se_id, str(se_id))
    return fallback.replace("_", " ").title()


def overlay_source_display_label(se_id, family, opts=None):
    label = planet_display_label(se_id, opts)
    return overlay_list_display_label(label, family)


def overlay_list_display_label(label, family):
    if family == "dodecatemoria":
        return f"{label} {mtexts.txts.get('Dodeca12thMark', '(12th)')}"
    return label


def ring_item_display_marker(item):
    """Return the compact semantic qualifier shared by Search and sidebar lists."""
    family = str((item or {}).get("family") or "")
    if family == "antiscia":
        return "(A)"
    if family == "contra_antiscia":
        return "CA"
    if family == "dodecatemoria":
        return str(mtexts.txts.get("Dodeca12thMark", "(12th)"))
    return ""


def ring_item_display_segments(item):
    """Preserve composite glyph runs for point families that have no single glyph."""
    if str((item or {}).get("family") or "") != "midpoint":
        return []
    segments = []
    for segment in (item or {}).get("segments") or ():
        if not isinstance(segment, dict):
            continue
        text = str(segment.get("text") or "")
        kind = str(segment.get("kind") or "text")
        if not text or kind not in ("text", "planet", "glyph"):
            continue
        out = {"text": text, "kind": kind}
        if "seId" in segment:
            try:
                out["seId"] = int(segment.get("seId"))
            except (TypeError, ValueError):
                pass
        segments.append(out)
    return segments


DIGNITY_MAP = {
    chart_mod.Chart.DOMICIL: "domicil",
    chart_mod.Chart.EXIL: "exil",
    chart_mod.Chart.EXAL: "exal",
    chart_mod.Chart.CASUS: "casus",
    chart_mod.Chart.PEREGRIN: "peregrin",
}

# Engine chart-type constants (chart.py:427-439) → stable skin kind strings.
# All ten types are mapped so meta.kind reports the real derived-chart kind
# instead of silently collapsing to "radix" (the view label still comes from
# mtexts.typeList; this is the machine-readable kind).
KIND_MAP = {
    chart_mod.Chart.RADIX: "radix",
    chart_mod.Chart.HORARY: "horary",
    chart_mod.Chart.TRANSIT: "transit",
    chart_mod.Chart.SOLAR: "solar-return",
    chart_mod.Chart.LUNAR: "lunar-return",
    chart_mod.Chart.REVOLUTION: "revolution",
    chart_mod.Chart.PROFECTION: "profection",
    chart_mod.Chart.PDINCHART: "primary-direction",
    chart_mod.Chart.COMPOSITE: "composite",
    chart_mod.Chart.RELATIONSHIP: "relationship",
}

# House-system code -> mtexts key. Resolved at CALL time via hsystem_label() so
# the line follows the active language; a module-level dict of mtexts.txts[...]
# values would freeze at the import-time language and never switch.
_HSYSTEM_KEYS = {
    "P": "HSPlacidus", "K": "HSKoch", "R": "HSRegiomontanus", "C": "HSCampanus",
    "E": "HSEqual", "W": "HSWholeSign", "X": "HSAxial", "Q": "HSTrueAscendant", "M": "HSMorinus",
    "H": "HSHorizontal", "T": "HSPagePolich", "B": "HSAlcabitus", "O": "HSPorphyrius",
    "N": "HSNoHouses",
}
_HSYSTEM_FALLBACKS = {
    "Q": "True Ascendant",
    "N": "Angles only",
}


def hsystem_label(code) -> str:
    key = _HSYSTEM_KEYS.get(str(code))
    if not key:
        return str(code)
    default = _HSYSTEM_FALLBACKS.get(str(code), str(code))
    return str(mtexts.txts.get(key, default))


# UI index -> (mtexts key, English fallback). Uses the ABBREVIATED (…2-suffixed)
# ayanamsha keys the compact house-system overlay line wants — deliberately NOT
# mtexts.ayanamshalist, whose long names ("Galactic Center (Gil Brand)") are for
# the settings menu. Same UI-index order as mtexts.ayanamshalist / graphchart.py.
_AYANAMSHA_KEYS = {
    0: ("None", None), 1: ("FaganBradley", None), 2: ("Lahiri", None),
    3: ("TrueChitra", "True Chitra"), 4: ("Krishnamurti", None), 5: ("Raman", None),
    6: ("Yukteshwar", None), 7: ("Deluce", None), 8: ("JNBhasin", None),
    9: ("Ushashashi", None), 10: ("DjwhalKhul", None), 11: ("GalacticCenter0Sag2", None),
    12: ("GalacticGilBrand2", "Gil Brand"), 13: ("Aldebaran15Tau2", None),
    14: ("BabylonianKuglerI2", None), 15: ("BabylonianKuglerII2", None),
    16: ("BabylonianKuglerIII2", None), 17: ("BabylonianHuber2", None),
    18: ("BabylonianMercier2", None), 19: ("Hipparchos", None), 20: ("Sassanian", None),
    21: ("J2000", None), 22: ("J1900", None), 23: ("B1950", None),
    24: ("DhruvaWilhelm", "Dhruva/Galactic Center (Wilhelm)"),
}


def ayanamsha_label(index) -> str:
    """Abbreviated ayanamsha label for the given UI index, resolved against the
    active mtexts language on every call (never captured at import)."""
    try:
        i = int(index)
    except (TypeError, ValueError):
        return ""
    entry = _AYANAMSHA_KEYS.get(i)
    if not entry:
        return ""
    key, fallback = entry
    return str(mtexts.txts.get(key, fallback if fallback is not None else key))


OUTER_RING_MODE_MAP = {
    options.Options.NONE: "none",
    options.Options.FIXSTARS: "fixstars",
    options.Options.ASTEROIDS: "asteroids",
    options.Options.MIDPOINTS: "midpoints",
    options.Options.HYBRID_HITS: "hybrid_hits",
    options.Options.ANTIS: "antiscia",
    options.Options.DODECATEMORIA: "dodecatemoria",
    options.Options.CANTIS: "contra_antiscia",
    options.Options.ARABICPARTS: "arabic_parts",
}


def init_environment():
    common.ensure_swe_ready()
    opts = options.Options()
    opts.load()
    activate_language(getattr(opts, 'langid', 0))
    common.common = common.Common()
    common.common.update(opts)
    return opts


def activate_language(langid):
    """Bind mtexts' active string tables to the saved language.

    The wx app did this once at startup (morinus.py:239 mtexts.setLang). The
    daemon never called it, so every mtexts-sourced label the daemon serves
    (planet/house/aspect/part names, table headers, chart-type names, ...) was
    frozen at the English import-time default regardless of options.langid.
    Invalid ids fall back to English rather than raising. Catalog activation
    failures are logged and return the language that is actually active, so a
    broken packaged catalog cannot degrade to English invisibly."""
    requested_langid = langid
    try:
        langid = int(langid or 0)
    except (TypeError, ValueError):
        logger.warning("Invalid language id %r; activating English", requested_langid)
        langid = 0
    if langid not in getattr(mtexts, 'langs', {0: None}):
        logger.warning("Unsupported language id %r; activating English", langid)
        langid = 0
    active_langid = langid
    try:
        mtexts.setLang(langid)
    except Exception:
        logger.exception(
            "Failed to activate language id %d; falling back to English",
            langid,
        )
        if langid == 0:
            raise
        active_langid = 0
        try:
            mtexts.setLang(0)
        except Exception:
            logger.exception("Failed to activate the English localization fallback")
            raise
    # mtexts.setLang rebinds mtexts globals, but common.common captured its
    # month/day tables by value at construction — rebuild them so dates follow
    # the language on a LIVE switch too (not just at boot).
    if getattr(common, 'common', None) is not None:
        try:
            common.common.reload_language_tables()
        except Exception:
            logger.exception(
                "Language id %d activated, but cached calendar tables could not be reloaded",
                active_langid,
            )
    return active_langid


def css_rgb(value):
    r, g, b = [int(v) for v in value]
    return f"rgb({r},{g},{b})"


def surveil_accent_rgb(opts):
    """Warm surveil/paran accent, picked by background luminance exactly as
    graphchart.drawSurveilMarks does (tokens.SURVEIL_ACCENT_*_RGB)."""
    bg = getattr(opts, "clrbackground", None)
    try:
        is_dark = (int(bg[0]) + int(bg[1]) + int(bg[2])) / 3 < 128
    except Exception:
        is_dark = False
    return _tokens.SURVEIL_ACCENT_DARK_RGB if is_dark else _tokens.SURVEIL_ACCENT_LIGHT_RGB


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(DEFAULT_SOURCE))
    parser.add_argument("--name", default="Morinus")
    parser.add_argument("--record-index", type=int, default=None)
    parser.add_argument("--comparison-name", default=None)
    parser.add_argument("--comparison-record-index", type=int, default=None)
    parser.add_argument("--radix-name", default=None)
    parser.add_argument("--radix-record-index", type=int, default=None)
    parser.add_argument("--anchor-name", default=None)
    parser.add_argument("--anchor-record-index", type=int, default=None)
    parser.add_argument("--overlay-render-mode", default="full", choices=("full", "step_fast", "deferred"))
    return parser.parse_args()


def load_chart(source_path, opts, name=None, record_index=None):
    path = Path(source_path)
    if path.suffix.lower() == ".jsonl":
        if record_index is not None:
            record = chartfile.read_jsonl_record(str(path), record_index)
            return chart_factory.chart_from_record(record, opts), record_index
        records = chartfile.read_jsonl(str(path))
        if name:
            for idx, record in enumerate(records):
                if record.get("name") == name:
                    return chart_factory.chart_from_record(record, opts), idx
            raise SystemExit(f'Chart "{name}" not found in {path}')
        idx = record_index if record_index is not None else 0
        return chart_factory.chart_from_record(records[idx], opts), idx
    return horfileio.read_chart(str(path), opts, record_index=record_index), record_index


def chart_datetime_tuple(chrt):
    return (
        chrt.time.origyear,
        chrt.time.origmonth,
        chrt.time.origday,
        chrt.time.hour,
        chrt.time.minute,
        chrt.time.second,
    )


def format_chart_datetime(chrt):
    yv, mv, dv, hv, miv, sv = [int(v) for v in chart_datetime_tuple(chrt)]
    try:
        month_name = common.common.months[mv - 1]
    except Exception:
        month_name = str(mv).zfill(2)
    date_txt = dateformat.date_text_named_month(
        yv, month_name, dv, getattr(chrt, "options", None), bc=chrt.time.bc)

    ztxt = ""
    if chrt.time.zt == chart_mod.Time.ZONE:
        ztxt = mtexts.txts["ZN"]
    elif chrt.time.zt in (chart_mod.Time.LOCALMEAN, chart_mod.Time.LOCALAPPARENT):
        ztxt = mtexts.txts["LC"]

    time_txt = f"{str(hv).zfill(2)}:{str(miv).zfill(2)}:{str(sv).zfill(2)}"
    if ztxt:
        time_txt = f"{time_txt}, {ztxt}"
    return date_txt, time_txt


def format_datetime_tuple(dt_tuple, bc=False, options=None):
    """Format a raw ``(y, m, d, h, mi, s)`` real-datetime tuple in the SAME
    active display-date convention as ``format_chart_datetime`` — used for the
    SIGNIFIED real date of a progression (which has no chart object of its own;
    the displayed chart is the progressed/ephemeris one). Returns
    (date_txt, time_txt)."""
    yv, mv, dv, hv, miv, sv = [int(v) for v in tuple(dt_tuple)[:6]]
    try:
        month_name = common.common.months[mv - 1]
    except Exception:
        month_name = str(mv).zfill(2)
    date_txt = dateformat.date_text_named_month(yv, month_name, dv, options, bc=bc)
    time_txt = f"{str(hv).zfill(2)}:{str(miv).zfill(2)}:{str(sv).zfill(2)}"
    return date_txt, time_txt


def display_tuple_iso(dt_tuple):
    try:
        yv, mv, dv, hv, miv, sv = [int(v) for v in tuple(dt_tuple)[:6]]
        return dt.datetime(yv, mv, dv, hv, miv, sv).isoformat()
    except Exception:
        return None


def apply_display_datetime_to_chart_payload(chart_payload, display_dt, bc=False, options=None):
    """Replace visible chart metadata with the session's local display time.

    The footer/status fields intentionally stay sourced from the chart's real
    ``Time`` object, so UT remains visible there for sanity checking.
    """
    if not isinstance(chart_payload, dict) or display_dt is None:
        return
    meta = chart_payload.get("meta")
    if not isinstance(meta, dict):
        return
    try:
        date_display, time_display = format_datetime_tuple(display_dt, bc=bc, options=options)
    except Exception:
        return
    meta["dateDisplay"] = date_display
    meta["timeDisplay"] = time_display
    meta["anchorDisplay"] = f"{date_display} {time_display}"
    iso = display_tuple_iso(display_dt)
    if iso is not None:
        meta["datetime"] = iso


def format_coord_pair(place):
    dir_lon = mtexts.txts["E"] if place.east else mtexts.txts["W"]
    dir_lat = mtexts.txts["N"] if place.north else mtexts.txts["S"]
    lon_txt = f"{str(place.deglon).zfill(2)}°{str(place.minlon).zfill(2)}'{dir_lon}"
    lat_txt = f"{str(place.deglat).zfill(2)}°{str(place.minlat).zfill(2)}'{dir_lat}"
    return lon_txt, lat_txt


def format_status_datetime(chrt):
    date_txt, _time_txt = format_chart_datetime(chrt)
    t = chrt.time
    label = ""
    if t.zt == chart_mod.Time.ZONE:
        label = mtexts.txts["ZN"]
    elif t.zt == chart_mod.Time.GREENWICH:
        label = mtexts.txts["UT"]
    elif t.zt in (chart_mod.Time.LOCALMEAN, chart_mod.Time.LOCALAPPARENT):
        label = mtexts.txts["LC"]

    base = f"{date_txt}, {str(t.hour).zfill(2)}:{str(t.minute).zfill(2)}"
    if label:
        base += label

    if t.zt == chart_mod.Time.ZONE:
        sign = "+" if t.plus else "-"
        base += f" UTC{sign}{int(t.zh):02d}"
        if int(getattr(t, "zm", 0)):
            base += f":{int(t.zm):02d}"
        base += " DST" if t.daylightsaving else " STD"
    if t.cal == chart_mod.Time.JULIAN:
        base += f" · {mtexts.txts.get('Julian', 'Julian')}"
    return base


def format_runtime_title_parts(chrt, opts):
    now = dt.datetime.now()
    calflag = symbolic_time._calflag_from_chart(chrt)
    runtime_dt = (now.year, now.month, now.day, now.hour, now.minute, now.second)
    runtime_txt = chart_context_view._compact_context_datetime_text(
        runtime_dt,
        calflag,
        show_seconds=getattr(opts, "showseconds", True),
        options=opts,
    )
    ut_disp = float(now.hour) + float(now.minute) / 60.0 + float(now.second) / 3600.0
    disp_jd = astrology.swe_julday(now.year, now.month, now.day, ut_disp, calflag)
    age_years = max(0.0, (disp_jd - float(chrt.time.jd)) / 365.2425)
    view_label = KIND_MAP.get(chrt.htype, "radix").replace("-", " ").title()
    try:
        view_label = mtexts.typeList[chrt.htype]
    except Exception:
        pass
    return runtime_txt, f"{mtexts.txts.get('Age', 'Age')}: {age_years:.2f}y", view_label


def composite_corner_lines(chrt):
    """Wx twin for midpoint composite corner labels.

    graphchart.py:3575-3595 draws participant names in the top-left for
    midpoint composites; graphchart.py:3653-3663 draws the composite marker in
    the bottom-left. Davison charts are real RADIX charts and intentionally do
    not use this branch.
    """
    if getattr(chrt, "notes", "") != "Composite chart":
        return None
    pair = getattr(chrt, "_composite_source_pair", None)
    names = []
    if isinstance(pair, (list, tuple)) and len(pair) >= 2:
        names = [
            str(getattr(participant, "name", "") or "").strip()
            for participant in pair[:2]
        ]
        names = [name for name in names if name]
    if not names:
        name = str(getattr(chrt, "name", "") or "").strip()
        if " • Composite" in name:
            name = name.split(" • Composite", 1)[0]
        elif " Composite" in name:
            name = name.split(" Composite", 1)[0]
        for sep in (" + ", " - "):
            if sep in name:
                names = [part.strip() for part in name.split(sep, 1) if part.strip()]
                break
        if not names:
            names = [name or "Composite"]
    return {
        "topLeft": names[:2],
        "bottomLeft": [
            str(mtexts.txts.get("Composite", "Composite")),
            "(%s)" % mtexts.txts.get("Midpoints", "Midpoints"),
        ],
    }


def iso_datetime_with_offset(chrt):
    tzinfo = None
    if chrt.time.zt == chart_mod.Time.ZONE:
        total_minutes = int(chrt.time.zh) * 60 + int(getattr(chrt.time, "zm", 0))
        if not chrt.time.plus:
            total_minutes *= -1
        tzinfo = dt.timezone(dt.timedelta(minutes=total_minutes))
    return dt.datetime(
        int(chrt.time.origyear),
        int(chrt.time.origmonth),
        int(chrt.time.origday),
        int(chrt.time.hour),
        int(chrt.time.minute),
        int(chrt.time.second),
        tzinfo=tzinfo,
    ).isoformat()


def floor_deg_min_in_sign(lon):
    """Resolved degree/minute within sign (floor) — daemon-side port of the
    renderer's floorDegMinInSign so the skin only prints the strings."""
    sign_deg = (((float(lon) % 360.0) + 360.0) % 360.0) % 30.0
    deg = int(sign_deg)
    minute = int((sign_deg - deg) * 60.0)
    return deg, minute


def deg_min_payload(lon):
    deg, minute = floor_deg_min_in_sign(lon)
    return {"degText": str(deg), "minText": str(minute).zfill(2)}


def export_planets(chrt):
    from webapp.daemon import inspector_service

    planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=getattr(chrt.options, "showchiron", True))
    data = []
    for pid in planet_ids:
        body = chrt.get_planet_body(pid)
        if body is None:
            continue
        planet_data = body.data
        try:
            dignity = DIGNITY_MAP.get(chrt.dignity(pid), "peregrin")
        except Exception:
            dignity = "peregrin"
        try:
            house_idx = chrt.houses.getHousePos(
                planet_data[0],
                chrt.options,
                useorbs=bool(getattr(chrt.options, "traditionalaspects", False)),
            )
            house_num = int(house_idx) + 1
        except Exception:
            house_num = None
        speed_lon = float(planet_data[3])
        # Resolved color/glyph/motion straight from the canonical daemon helpers
        # so the skin renders values rather than re-deriving them.
        #
        # `motion` carries the desktop retrograde-marker text exactly as
        # graphchart.py:2162-2168 / :2275-2280 resolve it: the station marker
        # ('SR' station-retrograde / 'SD' station-direct) WINS when
        # radixsignals.get_station_marker reports one within ±1 day, otherwise
        # the basic motion 'R'/'S' (or ''). So the SR/SD station distinction is
        # already part of this field — _motion_marker returns the station code
        # verbatim (inspector_service.py:130-145, radixsignals.get_station_marker
        # returns 'SR'/'SD'). No separate station field is emitted.
        color = css_rgb(inspector_service._body_colour(chrt, pid, chrt.options))
        glyph = common.common.get_planet_glyph(int(pid))
        motion = inspector_service._motion_marker(chrt, pid, speed_lon, chrt.options, False)
        entry = {
            "id": PLANET_ID_MAP[pid],
            "seId": int(pid),
            "longitude": float(planet_data[0]),
            "latitude": float(planet_data[1]),
            "speed": speed_lon,
            "house": house_num,
            "dignity": dignity,
            "color": color,
            "glyph": glyph,
            "motion": motion,
        }
        entry.update(deg_min_payload(planet_data[0]))
        data.append(entry)
    return data


def export_vertex(chrt):
    """Vertex as a drawable body, gated by options.showvertex.

    Mirrors the desktop's CHART_OBJECT_VERTEX body handling
    (graphchart.py:2878-2928): longitude = ascmc[VERTEX], glyph =
    get_planet_glyph(CHART_OBJECT_VERTEX) (the '!' Morinus glyph), colour =
    clrperegrin, no speed / no motion marker. House via getHousePos like any
    point. Additive: returns None when showvertex is off so the payload shape is
    unchanged for callers that don't show the Vertex."""
    if not getattr(chrt.options, "showvertex", False):
        return None
    try:
        lon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
    except Exception:
        return None
    try:
        house_idx = chrt.houses.getHousePos(
            lon,
            chrt.options,
            useorbs=bool(getattr(chrt.options, "traditionalaspects", False)),
        )
        house_num = int(house_idx) + 1
    except Exception:
        house_num = None
    entry = {
        "id": "vertex",
        "seId": int(common.CHART_OBJECT_VERTEX),
        "longitude": lon,
        "house": house_num,
        # Desktop vertex colour is always clrperegrin (graphchart.py:2927-2928).
        "color": css_rgb(chrt.options.clrperegrin),
        "glyph": common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX),
    }
    entry.update(deg_min_payload(lon))
    return entry


def _syzygy_lon(chrt):
    syz = getattr(chrt, "syzygy", None)
    if syz is None:
        return None
    try:
        return float(syz.lon)
    except Exception:
        return None


def _ensure_syzygy_lon(chrt):
    """Return the chart's prenatal Syzygy longitude, calculating it lazily."""
    lon = _syzygy_lon(chrt)
    if lon is not None:
        return lon
    try:
        chrt.calcSyzygy()
    except Exception:
        return None
    return _syzygy_lon(chrt)


def export_syzygy(chrt):
    if not getattr(chrt.options, "showprenatalsyzygy", False):
        return None
    lon = _ensure_syzygy_lon(chrt)
    if lon is None:
        return None
    try:
        house_idx = chrt.houses.getHousePos(
            lon,
            chrt.options,
            useorbs=bool(getattr(chrt.options, "traditionalaspects", False)),
        )
        house_num = int(house_idx) + 1
    except Exception:
        house_num = None
    entry = {
        "id": "syzygy",
        "longitude": lon,
        "house": house_num,
        "label": str(mtexts.txts.get("PrenatalSyzygy", "Prenatal Syzygy")),
        "glyph": "Sy",
        "glyphFont": "text",
        "color": css_rgb(chrt.options.clrsigns),
    }
    entry.update(deg_min_payload(lon))
    return entry


def export_vertex_aspects(chrt):
    """Aspects from each visible body to the Vertex, gated by
    options.showvertex AND options.showaspectstovertex.

    Ports the desktop drawVertexAspectLines gate + aspect source
    (graphchart.py:1315, :2534-2562): the aspect is a point-aspect between the
    body longitude and the Vertex longitude, computed by the wx-free engine
    method chart._build_dynamic_aspect via the same orb row _get_point_aspect
    uses (graphchart.py:1071-1086). Emitted with `p2="vertex"`, matching the
    asc/mc aspect entry shape in export_aspects."""
    if not getattr(chrt.options, "aspects", True):
        return []
    if not getattr(chrt.options, "showvertex", False):
        return []
    if not getattr(chrt.options, "showaspectstovertex", False):
        return []
    try:
        vlon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
    except Exception:
        return []

    aspects = []
    planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=getattr(chrt.options, "showchiron", True))
    for pid in planet_ids:
        if pid in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not getattr(chrt.options, "aspectstonodes", False):
            continue
        body = chrt.get_planet_body(pid)
        if body is None:
            continue
        lon = float(body.data[planets.Planet.LONG])
        idx = chrt.get_planet_orb_index(pid)
        orb_by_aspect = chrt.options.orbis[idx][:]
        asp = chrt._build_dynamic_aspect(
            lon,
            vlon,
            body.data[planets.Planet.SPLON],
            0.0,
            orb_by_aspect,
            node_only_conjunction=pid in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
        )
        if not should_show_aspect(chrt, asp, lon, vlon):
            continue
        aspects.append(
            aspect_payload(PLANET_ID_MAP[pid], "vertex", asp)
        )
    return aspects


def aspect_payload(p1, p2, asp):
    return {
        "p1": p1,
        "p2": p2,
        "type": int(asp.typ),
        "orb": float(asp.aspdif),
        "maxOrb": float(getattr(asp, "max_orb", 0.0)),
        "exact": bool(asp.exact),
    }


def should_show_aspect(chrt, asp, lon1, lon2):
    if asp is None or asp.typ == chart_mod.Chart.NONE:
        return False
    if not chrt.options.aspect[asp.typ]:
        return False
    return chrt._passes_traditional_aspect_filter(asp.typ, lon1, lon2)


_ANGLE_ASPECT_DISPLAY_FIELDS = {
    "asc": "showaspectstoasc",
    "mc": "showaspectstomc",
    "dc": "showaspectstodsc",
    "ic": "showaspectstoic",
}


def should_draw_angle_aspects(chrt, angle_key):
    """Normal wheel visibility only; click adjacency remains complete."""
    field = _ANGLE_ASPECT_DISPLAY_FIELDS.get(angle_key)
    return field is not None and bool(getattr(chrt.options, field, True))


def export_aspects(chrt):
    if not getattr(chrt.options, "aspects", True):
        return []

    aspects = []
    planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=getattr(chrt.options, "showchiron", True))
    show_lof_aspects = bool(
        getattr(chrt.options, "showlof", True)
        and getattr(chrt.options, "showaspectstolof", False)
        and getattr(chrt, "fortune", None) is not None
    )
    for idx, p1 in enumerate(planet_ids):
        if p1 in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not getattr(chrt.options, "aspectstonodes", False):
            continue
        body1 = chrt.get_planet_body(p1)
        if body1 is None:
            continue
        lon1 = float(body1.data[0])
        for p2 in planet_ids[idx + 1 :]:
            if p2 in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not getattr(chrt.options, "aspectstonodes", False):
                continue
            body2 = chrt.get_planet_body(p2)
            if body2 is None:
                continue
            lon2 = float(body2.data[0])
            asp = chrt.get_planetary_aspect(p1, p2)
            if not should_show_aspect(chrt, asp, lon1, lon2):
                continue
            aspects.append(
                aspect_payload(PLANET_ID_MAP[p1], PLANET_ID_MAP[p2], asp)
            )

    for pid in planet_ids:
        if pid in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE) and not getattr(chrt.options, "aspectstonodes", False):
            continue
        body = chrt.get_planet_body(pid)
        if body is None:
            continue
        lon = float(body.data[0])
        for angle_key, angle_lon in _angle_longitudes(chrt):
            if not should_draw_angle_aspects(chrt, angle_key):
                continue
            asp = _angle_aspect(chrt, pid, angle_key, angle_lon)
            if not should_show_aspect(chrt, asp, lon, angle_lon):
                continue
            aspects.append(
                aspect_payload(PLANET_ID_MAP[pid], angle_key, asp)
            )

        if show_lof_aspects:
            lof_lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
            asp = chrt.get_lof_aspect(pid)
            if should_show_aspect(chrt, asp, lon, lof_lon):
                aspects.append(
                    aspect_payload(PLANET_ID_MAP[pid], "fortune", asp)
                )

    return aspects


def _is_major_aspect_type(aspect_type):
    """Port of graphchart._is_major_aspect_type (graphchart.py:907-914)."""
    return aspect_type in (
        chart_mod.Chart.CONJUNCTIO,
        chart_mod.Chart.SEXTIL,
        chart_mod.Chart.QUADRAT,
        chart_mod.Chart.TRIGON,
        chart_mod.Chart.OPPOSITIO,
    )


def _click_traditional_pass(chrt, aspect_type, lon1, lon2):
    """Whole-sign traditional filter for the click force-show path — port of
    graphchart._passes_render_traditional_filter (graphchart.py:926-951).

    The sign indices are taken directly in the chart's chosen zodiac. Exported
    longitudes already carry the selected ayanamsha, so no display-stage shift
    is permitted here."""
    if aspect_type == chart_mod.Chart.CONJUNCTIO:
        diff = 0
    elif aspect_type == chart_mod.Chart.SEXTIL:
        diff = 2
    elif aspect_type == chart_mod.Chart.QUADRAT:
        diff = 3
    elif aspect_type == chart_mod.Chart.TRIGON:
        diff = 4
    elif aspect_type == chart_mod.Chart.OPPOSITIO:
        diff = 6
    else:
        return False
    lona1 = float(lon1)
    lona2 = float(lon2)
    sign1 = int(lona1 / chart_mod.Chart.SIGN_DEG)
    sign2 = int(lona2 / chart_mod.Chart.SIGN_DEG)
    signdiff = math.fabs(sign1 - sign2)
    if signdiff > chart_mod.Chart.SIGN_NUM / 2:
        signdiff = chart_mod.Chart.SIGN_NUM - signdiff
    return diff == signdiff


def _click_filter_pass(chrt, aspect_type, lon1, lon2):
    """Whether an aspect survives the click force-show sub-filters, decided in
    the engine's zodiac. Port of the click branch of
    graphchart._should_show_aspect (graphchart.py:979-986): the major-only gate
    (graphchart._click_aspects_major_only) plus, when enabled, the
    ayanamsha-correct whole-sign traditional filter. Both option flags are fixed
    at snapshot time, so the boolean is precomputed per bodyAspects entry and
    the skin never recomputes aspect meaning (closed-world rule)."""
    options = chrt.options
    major_only = not bool(getattr(options, "exclusive_aspects_on_click_show_minor", True))
    if major_only and not _is_major_aspect_type(aspect_type):
        return False
    if bool(getattr(options, "exclusive_aspects_on_click_traditional", False)):
        if not _click_traditional_pass(chrt, aspect_type, lon1, lon2):
            return False
    return True


def _asp_entry(other_key, asp, shows_on_click):
    """One engine-computed aspect record for the click force-show path.

    Mirrors the fields `_get_planetary_aspect` / `_should_show_aspect`
    (graphchart.py:974-1019) consult: type + resolved orb (`aspdif`) + exact
    flag + applying flag. `applying` comes straight off the matrix `appl`
    attribute (chart.py:411). `showsOnClick` is the engine's click force-show
    verdict (major-only + ayanamsha-correct traditional filter), precomputed so
    the skin reads a bit instead of recomputing aspect meaning."""
    return {
        "other": other_key,
        "type": int(asp.typ),
        "orb": float(asp.aspdif),
        "maxOrb": float(getattr(asp, "max_orb", 0.0)),
        "exact": bool(asp.exact),
        "applying": bool(getattr(asp, "appl", False)),
        "showsOnClick": bool(shows_on_click),
    }


def _click_point_key(point):
    role = str(point.get("role") or "primary")
    family = str(point.get("family") or "point")
    item_id = str(point.get("id") or point.get("label") or "point")
    lon = float(point["longitude"])
    return f"point:{role}:{family}:{item_id}:{lon:.6f}"


def _is_node_aspect_key(key):
    return key in ("nnode", "snode")


def _angle_longitudes(chrt):
    try:
        asc = float(chrt.houses.ascmc[houses.Houses.ASC])
        mc = float(chrt.houses.ascmc[houses.Houses.MC])
    except Exception:
        return ()
    return (
        ("asc", asc),
        ("mc", mc),
        ("dc", util.normalize(asc + 180.0)),
        ("ic", util.normalize(mc + 180.0)),
    )


def _opposite_angle_decl(chrt, angle_idx):
    try:
        return -float(chrt.houses.ascmc2[angle_idx][houses.Houses.DECL])
    except Exception:
        return None


def _angle_aspect(chrt, planet_id, angle_key, angle_lon):
    if angle_key == "asc":
        return chrt.get_ascmc_aspect(houses.Houses.ASC, planet_id)
    if angle_key == "mc":
        return chrt.get_ascmc_aspect(houses.Houses.MC, planet_id)
    body = chrt.get_planet_body(planet_id)
    if body is None or not hasattr(chrt, "_build_dynamic_aspect"):
        return None
    idx = chrt.get_planet_orb_index(planet_id)
    orb_by_aspect = [
        chrt.options.orbisAscMC[a] + chrt.options.orbis[idx][a]
        for a in range(chart_mod.Chart.ASPECT_NUM)
    ]
    parallel_orbs = [
        chrt.options.orbisparAscMC[0] + chrt.options.orbisplanetspar[idx][0],
        chrt.options.orbisparAscMC[1] + chrt.options.orbisplanetspar[idx][1],
    ]
    decl2 = (
        _opposite_angle_decl(chrt, houses.Houses.ASC)
        if angle_key in ("dc", "dsc")
        else _opposite_angle_decl(chrt, houses.Houses.MC)
    )
    return chrt._build_dynamic_aspect(
        float(body.data[planets.Planet.LONG]),
        float(angle_lon),
        float(body.data[planets.Planet.SPLON]),
        0.0,
        orb_by_aspect,
        body.dataEqu[planets.Planet.DECLEQU],
        decl2,
        parallel_orbs,
        planet_id in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
    )


def _point_aspect(chrt, planet_id, point_lon):
    body = chrt.get_planet_body(planet_id)
    if body is None:
        return None
    idx = chrt.get_planet_orb_index(planet_id)
    return chrt._build_dynamic_aspect(
        float(body.data[planets.Planet.LONG]),
        float(point_lon),
        float(body.data[planets.Planet.SPLON]),
        0.0,
        chrt.options.orbis[idx][:],
        node_only_conjunction=planet_id in (astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE),
    )


def export_body_aspects(chrt, click_point_items=None):
    """Per-body FULL engine aspect set, BEFORE the render-time type/visibility
    filter, so the skin's click force-show can reveal aspects the normal filter
    hid (desktop semantics: graphchart.py:974-1018, :2300-2317).

    Keyed exactly like `export_aspects` endpoints — planet ids plus the four
    chart angles (`asc`/`mc`/`dc`/`ic`), `fortune`/`vertex`, and active
    secondary-ring click points. Every non-NONE
    entry from the chart's aspect matrix (`get_planetary_aspect` /
    `get_ascmc_aspect` / angle dynamic aspects / `get_lof_aspect`) is listed
    for both endpoints, so `bodyAspects[X]` is the complete adjacency for X.
    Secondary-ring points
    intentionally list only point→planet entries, matching
    graphchart.drawClickedPointAspectLines: those point aspects appear only when
    the clicked target is the point itself, not when a planet is selected.

    This is additive and does not touch the existing filtered `aspects` list."""
    if not getattr(chrt.options, "aspects", True):
        return {}

    by_body = {}

    def _ensure(key):
        if key is not None:
            by_body.setdefault(key, [])

    def _key(pid):
        return PLANET_ID_MAP.get(pid)

    def _append(key, other_key, asp, shows):
        by_body.setdefault(key, []).append(_asp_entry(other_key, asp, shows))

    def _push(key_a, key_b, asp, lon_a, lon_b, *, allow_a=True, allow_b=True):
        if asp is None or asp.typ == chart_mod.Chart.NONE:
            return
        if key_a is None or key_b is None:
            return
        # showsOnClick is symmetric in the two endpoints (type-set membership +
        # |sign1-sign2|), so it is computed once and stamped on both directions.
        shows = _click_filter_pass(chrt, asp.typ, lon_a, lon_b)
        if not getattr(chrt.options, "aspectstonodes", False) and (
            _is_node_aspect_key(key_a) or _is_node_aspect_key(key_b)
        ):
            allow_a = allow_a and _is_node_aspect_key(key_a)
            allow_b = allow_b and _is_node_aspect_key(key_b)
        if allow_a:
            _append(key_a, key_b, asp, shows)
        if allow_b:
            _append(key_b, key_a, asp, shows)

    planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=getattr(chrt.options, "showchiron", True))

    # Planet ↔ planet. Skip the mean/true-node degenerate pair exactly like the
    # engine matrix accessor (chart.py:1103) and the desktop draw loop. Endpoint
    # longitudes are the tropical body LONGs (data[0]) — same source as
    # export_aspects (export_chart_json:458) — so _click_traditional_pass can
    # rebase them by ayanamsha for the sidereal whole-sign test.
    for idx, p1 in enumerate(planet_ids):
        k1 = _key(p1)
        if k1 is None:
            continue
        body1 = chrt.get_planet_body(p1)
        if body1 is None:
            continue
        _ensure(k1)
        lon1 = float(body1.data[0])
        for p2 in planet_ids[idx + 1:]:
            if {p1, p2} == {astrology.SE_MEAN_NODE, astrology.SE_TRUE_NODE}:
                continue
            k2 = _key(p2)
            if k2 is None:
                continue
            body2 = chrt.get_planet_body(p2)
            if body2 is None:
                continue
            _ensure(k2)
            lon2 = float(body2.data[0])
            _push(k1, k2, chrt.get_planetary_aspect(p1, p2), lon1, lon2)

    # Planet ↔ chart angles and Planet ↔ Lot of Fortune. ASC/MC preserve the
    # chart's existing angle matrix; DSC/IC are computed against their own
    # opposite longitudes with the same Asc/MC orb row, so click-selecting a
    # planet on the DSC shows a conjunction to the DSC, not an opposition to ASC.
    has_lof = getattr(chrt.options, "showlof", True) and getattr(chrt, "fortune", None) is not None
    if has_lof:
        _ensure("fortune")
    syzygy_lon = _syzygy_lon(chrt) if getattr(chrt.options, "showprenatalsyzygy", False) else None
    has_syzygy = syzygy_lon is not None
    if has_syzygy:
        _ensure("syzygy")
    angle_entries = _angle_longitudes(chrt)
    for angle_key, _angle_lon in angle_entries:
        _ensure(angle_key)
    for pid in planet_ids:
        k = _key(pid)
        if k is None:
            continue
        body = chrt.get_planet_body(pid)
        if body is None:
            continue
        _ensure(k)
        lon = float(body.data[0])
        for angle_key, angle_lon in angle_entries:
            _push(k, angle_key, _angle_aspect(chrt, pid, angle_key, angle_lon), lon, angle_lon)
        if has_lof:
            lof_lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
            _push(
                k,
                "fortune",
                chrt.get_lof_aspect(pid),
                lon,
                lof_lon,
                allow_a=bool(getattr(chrt.options, "showaspectstolof", False)),
                allow_b=True,
            )
        if has_syzygy:
            _push(
                k,
                "syzygy",
                _point_aspect(chrt, pid, syzygy_lon),
                lon,
                syzygy_lon,
                allow_a=True,
                allow_b=True,
            )

    # Planet ↔ Vertex. In wx, selecting a planet force-draws its Vertex aspect
    # when the Vertex is visible, and selecting the Vertex force-draws all of its
    # point aspects (graphchart.py:2386-2405, :2534-2562).
    if getattr(chrt.options, "showvertex", False):
        try:
            vertex_lon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
        except Exception:
            vertex_lon = None
        if vertex_lon is not None:
            _ensure("vertex")
            for pid in chrt.get_visible_aspect_planet_ids(include_chiron=True):
                k = _key(pid)
                if k is None:
                    continue
                body = chrt.get_planet_body(pid)
                if body is None:
                    continue
                _ensure(k)
                lon = float(body.data[planets.Planet.LONG])
                _push(
                    k,
                    "vertex",
                    _point_aspect(chrt, pid, vertex_lon),
                    lon,
                    vertex_lon,
                    allow_a=bool(getattr(chrt.options, "showaspectstovertex", False)),
                    allow_b=True,
                )

    # Active secondary-ring points. This covers fixed stars, asteroids,
    # midpoints, lots, antiscia/contra/dodecatemoria, and hybrid-hit labels using
    # the daemon-exported ring item longitude. In comparison/biwheel snapshots,
    # outer-role items keep their `point:outer:*` key and are tested against the
    # primary chart's visible planets. Aspect meaning is still computed here
    # with the same point-aspect engine call as wx _get_point_aspect; the skin
    # only chooses a key and draws the returned entries.
    for point in click_point_items or ():
        try:
            point_lon = float(point["longitude"])
            point_key = _click_point_key(point)
        except Exception:
            continue
        _ensure(point_key)
        for pid in chrt.get_visible_aspect_planet_ids(include_chiron=True):
            k = _key(pid)
            if k is None:
                continue
            body = chrt.get_planet_body(pid)
            if body is None:
                continue
            _ensure(k)
            lon = float(body.data[planets.Planet.LONG])
            asp = _point_aspect(chrt, pid, point_lon)
            if asp is None or asp.typ == chart_mod.Chart.NONE:
                continue
            shows = _click_filter_pass(chrt, asp.typ, lon, point_lon)
            by_body.setdefault(point_key, []).append(_asp_entry(k, asp, shows))

    return by_body


def export_click_aspect_flags(chrt):
    """The meaning-owning option flags the skin reads to decide whether click
    selection is active and which sub-filters to apply (options.py:149-151;
    desktop helpers graphchart.py:904-924, :982). Daemon owns the flags; the
    skin owns the click selection state and which lines to draw."""
    options = chrt.options
    return {
        "exclusiveOnClick": bool(getattr(options, "exclusive_aspects_on_click", False)),
        # show_minor True → minors allowed; major-only filter is the negation
        # (graphchart._click_aspects_major_only).
        "showMinor": bool(getattr(options, "exclusive_aspects_on_click_show_minor", True)),
        "traditional": bool(getattr(options, "exclusive_aspects_on_click_traditional", False)),
    }


def overlay_planet_glyph(planet_idx):
    return common.common.get_planet_glyph(int(planet_idx))


def overlay_planet_run(chrt, planet_idx, color_chart=None):
    from webapp.daemon import inspector_service
    color_source = color_chart if color_chart is not None else chrt

    return {
        "char": overlay_planet_glyph(planet_idx),
        "kind": "planet",
        "seId": int(planet_idx),
        "color": css_rgb(inspector_service._body_colour(color_source, int(planet_idx), chrt.options)),
    }


def _planetary_hours_for_overlay(chrt):
    time_obj = getattr(chrt, "time", None)
    place = getattr(chrt, "place", None)
    if time_obj is None or place is None:
        return None

    try:
        lon = float(getattr(place, "lon", 0.0))
        lat = float(getattr(place, "lat", 0.0))
        altitude = float(getattr(place, "altitude", 0.0))
        if getattr(time_obj, "zt", None) == chart_mod.Time.ZONE:
            tz_hours = (
                (1.0 if getattr(time_obj, "plus", True) else -1.0) *
                (float(getattr(time_obj, "zh", 0.0)) + float(getattr(time_obj, "zm", 0.0)) / 60.0)
            )
            if getattr(time_obj, "daylightsaving", False):
                tz_hours += 1.0
        elif getattr(time_obj, "zt", None) == chart_mod.Time.LOCALMEAN:
            tz_hours = lon / 15.0
        elif getattr(time_obj, "zt", None) == chart_mod.Time.LOCALAPPARENT:
            _ret, te, _serr = astrology.swe_time_equ(float(time_obj.jd))
            tz_hours = (lon / 15.0) + float(te) * 24.0
        else:
            tz_hours = lon / 15.0

        jd_local = float(time_obj.jd) + float(tz_hours) / 24.0
        weekday = int(math.floor(jd_local + 0.5)) % 7
        signature = (
            round(float(time_obj.jd), 6),
            round(lon, 6),
            round(lat, 6),
            round(altitude, 2),
            int(weekday),
            round(float(tz_hours), 6),
        )
        if getattr(time_obj, "ph", None) is None or getattr(time_obj, "_ph_signature", None) != signature:
            time_obj.ph = hours.PlanetaryHours(lon, lat, altitude, weekday, float(time_obj.jd), float(tz_hours))
            time_obj._ph_signature = signature
        return getattr(time_obj, "ph", None)
    except Exception:
        try:
            if getattr(time_obj, "ph", None) is None:
                time_obj.calcPHs(place)
            return getattr(time_obj, "ph", None)
        except Exception:
            return None


def export_overlay(chrt, overlay_render_mode="full", *, radix=None, display_datetime=None, cursor_jd=None):
    rows = []
    overlay_radix = radix if radix is not None else chrt
    header_color_chart = overlay_radix if overlay_radix is not None else chrt

    if getattr(chrt.options, "planetarydayhour", True) and chrt.htype != chart_mod.Chart.PROFECTION:
        ph = _planetary_hours_for_overlay(chrt)
        if ph is not None:
            ar = (1, 4, 2, 5, 3, 6, 0)
            idx_day = ar[int(ph.weekday)]
            idx_hour = int(ph.planetaryhour)
            rows.append(
                {
                    "group": "dayhour",
                    "slot": "planetary-day",
                    "label": mtexts.txts["Day"],
                    "glyphs": [overlay_planet_run(chrt, idx_day)],
                }
            )
            rows.append(
                {
                    "group": "dayhour",
                    "slot": "planetary-hour",
                    "label": mtexts.txts["Hour"],
                    "glyphs": [overlay_planet_run(chrt, idx_hour)],
                }
            )

    # Keep the frame-critical overlay current without pulling the more expensive
    # term/signal pass into step_fast. The retained document snapshot supplies
    # the previous stable term row until the generation-guarded full settle.
    term_info = None
    if overlay_render_mode != "step_fast":
        term_info = lordofyear.get_term_lord(
            overlay_radix,
            chrt,
            chrt.options,
            display_datetime,
            cursor_jd=cursor_jd,
        )
    if term_info is not None:
        sign_idx, ruler_idx = term_info
        sign_table = common.common.Signs1 if getattr(chrt.options, "signs", True) else common.common.Signs2
        rows.append(
            {
                "group": "header",
                "slot": "term-lord",
                "label": str(mtexts.txts.get("TermLord", "Term lord")),
                "glyphs": [
                    {"char": sign_table[sign_idx], "kind": "sign"},
                    overlay_planet_run(chrt, ruler_idx, color_chart=header_color_chart),
                ],
            }
        )

    loy_info = lordofyear.get_lord_of_year(overlay_radix, chrt, chrt.options, display_datetime, cursor_jd=cursor_jd)
    if loy_info is not None:
        sign_idx, ruler_idx = loy_info
        sign_table = common.common.Signs1 if getattr(chrt.options, "signs", True) else common.common.Signs2
        rows.append(
            {
                "group": "header",
                "slot": "lord-of-year",
                "label": str(mtexts.txts.get("LordOfYear", "Lord of the year")),
                "glyphs": [
                    {"char": sign_table[sign_idx], "kind": "sign"},
                    overlay_planet_run(chrt, ruler_idx, color_chart=header_color_chart),
                ],
            }
        )

    # wx graphchart.drawOverlayInfoBlock uses three overlay modes:
    # step_fast -> no signal rows; deferred -> station-style signals; full ->
    # stations plus phasis/cazimi/eclipses. Keep Cazimi/eclipse scans out of
    # the stepping path; only the settled full snapshot computes them.
    signal_rows = []
    if overlay_render_mode == "deferred":
        signal_rows = radixsignals.get_radix_signal_display_rows(
            chrt,
            options=chrt.options,
        )
    elif overlay_render_mode == "full":
        signal_rows = radixsignals.get_radix_overlay_display_rows(
            chrt,
            phasis_mode=int(getattr(chrt.options, "phasismode", 0)),
            cazimi_mode=int(getattr(chrt.options, "cazimimode", 0)),
            options=chrt.options,
        )
    station_labels = None
    if overlay_render_mode == "full":
        station_labels = {
            str(mtexts.txts.get("RetroStation", "Retro station")),
            str(mtexts.txts.get("DirectStation", "Direct station")),
        }
    for planet_idx, label, offset_text in signal_rows:
        glyphs = [] if planet_idx is None else [overlay_planet_run(chrt, planet_idx)]
        # Deferred exports contain only live station rows. Full exports mix
        # stations with the expensive phasis/cazimi/eclipse rows retained while
        # stepping, so tag stations semantically instead of asking the frontend
        # to recognize an English display label.
        signal_slot = (
            "station-signal"
            if overlay_render_mode == "deferred"
            or (station_labels is not None and str(label) in station_labels)
            else "signal"
        )
        rows.append(
            {
                "group": "signal",
                "slot": signal_slot,
                "label": label,
                "glyphs": glyphs,
                "trailing": offset_text,
            }
        )

    return {"rows": rows, "deferredSignals": overlay_render_mode == "step_fast"}


def _export_term_sign(sign_index, sign_terms):
    """Per-segment term data with resolved boundary + ruler longitudes and the
    resolved ruler glyph char, so the renderer only maps longitude→pixel."""
    out = []
    deg = sign_index * 30.0
    for segment in sign_terms:
        ruler = int(segment[0])
        size = int(segment[1])
        mid_lon = deg + size / 2.0
        deg += size
        out.append(
            {
                "rulerSeId": ruler,
                "size": size,
                "boundaryLon": float(deg),
                "rulerLon": float(mid_lon),
                "rulerGlyph": common.common.get_planet_glyph(ruler),
            }
        )
    return out


def _export_decan_sign(sign_index, sign_decans):
    out = []
    deg = sign_index * 30.0 + 5.0
    for pid in sign_decans:
        ruler = int(pid)
        out.append(
            {
                "rulerSeId": ruler,
                "rulerLon": float(deg),
                "rulerGlyph": common.common.get_planet_glyph(ruler),
            }
        )
        deg += 10.0
    return {"rulerSeIds": [int(pid) for pid in sign_decans], "rulers": out}


def _export_house_system_lines(chrt):
    house_system_lines = []
    if bool(getattr(chrt.options, "housesystem", False)):
        if int(getattr(chrt.options, "ayanamsha", 0)) != 0:
            house_system_lines.append(ayanamsha_label(int(chrt.options.ayanamsha)))
        if getattr(chrt, "htype", None) == chart_mod.Chart.PDINCHART:
            pd_system = int(getattr(chrt.options, "primarydir", -1))
            pd_labels = getattr(mtexts, "typeListDirs", ())
            if 0 <= pd_system < len(pd_labels):
                house_system_lines.append(str(pd_labels[pd_system]))
        else:
            house_system_lines.append(hsystem_label(getattr(chrt.houses, "ui_hsys", getattr(chrt.options, "hsys", "P"))))
        house_system_lines = [line for line in house_system_lines if line]
    return house_system_lines


def _export_house_system_code(chrt):
    chart_houses = getattr(chrt, "houses", None)
    return str(
        getattr(
            chart_houses,
            "ui_hsys",
            getattr(chart_houses, "hsys", getattr(chrt.options, "hsys", "P")),
        )
    )


def _resolve_build_stamp_label():
    stamped = (getattr(build_info, "BUILD_STAMP", "") or "").strip()
    if stamped:
        return stamped
    try:
        out = subprocess.check_output(
            [
                "git",
                "-C",
                str(REPO_ROOT),
                "log",
                "-1",
                "--format=%h %cd",
                "--date=format-local:%Y-%m-%d %H:%M",
            ],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8", "replace").strip()
        if out:
            return out
    except Exception:
        pass
    return ""


BUILD_STAMP_LABEL = _resolve_build_stamp_label()


def export_chart(
    chrt,
    overlay_render_mode="full",
    click_point_items=None,
	perf=None,
	perf_prefix="chart",
	overlay_radix=None,
	overlay_display_datetime=None,
	overlay_cursor_jd=None,
	display_options=None,
	comparison_whole_sign=False,
	include_body_aspects=True,
):
    def phase(name, fn):
        return _timed_export(perf, f"{perf_prefix}.{name}", fn)

    render_options = display_options or chrt.options
    date_display, time_display = phase("format_datetime", lambda: format_chart_datetime(chrt))
    lon_txt, lat_txt = phase("format_coords", lambda: format_coord_pair(chrt.place))
    runtime_txt, age_txt, view_label = phase("runtime_title", lambda: format_runtime_title_parts(chrt, chrt.options))
    build_stamp = BUILD_STAMP_LABEL
    house_system_lines = phase("house_system_lines", lambda: _export_house_system_lines(chrt))
    planets_payload = phase("planets", lambda: export_planets(chrt))
    aspects_payload = phase("aspects", lambda: export_aspects(chrt) + export_vertex_aspects(chrt))
    click_aspect_flags = phase("click_aspect_flags", lambda: export_click_aspect_flags(chrt))
    body_aspects = (
        phase("body_aspects", lambda: export_body_aspects(chrt, click_point_items))
        if include_body_aspects
        else None
    )
    show_houses = bool(
        getattr(render_options, "houses", getattr(chrt.options, "houses", False))
        and (
            _export_house_system_code(chrt) != "N"
            or comparison_whole_sign
        )
    )
    anglo_dense_label_layout = str(
        getattr(render_options, "anglo_dense_label_layout", "routed-cusps")
        or "leader-columns"
    )
    if anglo_dense_label_layout not in ("leader-columns", "routed-cusps"):
        anglo_dense_label_layout = "routed-cusps"
    overlay_payload = phase(
        "overlay",
        lambda: export_overlay(
            chrt,
            overlay_render_mode,
			radix=overlay_radix,
			display_datetime=overlay_display_datetime,
			cursor_jd=overlay_cursor_jd,
		),
	)
    palette_payload = phase("palette", lambda: {
        "background": css_rgb(chrt.options.clrbackground),
        "frame": css_rgb(chrt.options.clrframe),
        "signs": css_rgb(chrt.options.clrsigns),
        "angles": css_rgb(chrt.options.clrAscMC),
        "houses": css_rgb(chrt.options.clrhouses),
        "houseNums": css_rgb(chrt.options.clrhousenumbers),
        "positions": css_rgb(chrt.options.clrpositions),
        "peregrin": css_rgb(chrt.options.clrperegrin),
        "domicil": css_rgb(chrt.options.clrdomicil),
        "exil": css_rgb(chrt.options.clrexil),
        "exal": css_rgb(chrt.options.clrexal),
        "casus": css_rgb(chrt.options.clrcasus),
        "textDim": css_rgb(chrt.options.clrtexts),
        "textBright": css_rgb(chrt.options.clrtexts),
        "fortune": css_rgb(chrt.options.clrsigns),
        "planets": [css_rgb(value) for value in chrt.options.clrindividual],
        "aspects": [css_rgb(value) for value in chrt.options.clraspect],
        "surveilAccent": css_rgb(surveil_accent_rgb(chrt.options)),
    })
    options_payload = phase("options", lambda: {
        "uranus": bool(getattr(chrt.options, "uranus", True)),
        "pluto": int(getattr(chrt.options, "pluto", 0)),
        "signVariant": 1 if getattr(chrt.options, "signs", True) else 2,
        "useDignityColors": bool(getattr(chrt.options, "useplanetcolors", False)),
        "useZodiacElementColors": bool(
            getattr(chrt.options, "usezodiacelementcolors", False)
        ),
        "theme": int(getattr(chrt.options, "theme", 0)),
        "angloDenseLabelLayout": anglo_dense_label_layout,
        "ascmcSize": int(getattr(chrt.options, "ascmcsize", 5)),
        "chartRingThickness": int(getattr(chrt.options, "chartringthickness", 3)),
        "showLoF": bool(getattr(chrt.options, "showlof", True)),
        "showVertex": bool(getattr(chrt.options, "showvertex", False)),
        "showPrenatalSyzygy": bool(getattr(chrt.options, "showprenatalsyzygy", False)),
        "showAspectsToVertex": bool(getattr(chrt.options, "showaspectstovertex", False)),
        "showFixstarsToHcs": bool(getattr(chrt.options, "showfixstarshcs", False)),
        "showFixstarsToLoF": bool(getattr(chrt.options, "showfixstarslof", False)),
        "showHouses": show_houses,
        "showOuterHouseLines": bool(
            getattr(render_options, "showouterhouselines", True)
        ),
        "showPositions": bool(getattr(chrt.options, "positions", False)),
        "showInformation": bool(getattr(chrt.options, "information", True)),
        "showHouseSystem": bool(getattr(chrt.options, "housesystem", False)),
        "showSymbols": bool(getattr(chrt.options, "symbols", False)),
        "showAspects": bool(getattr(chrt.options, "aspects", False)),
        "showMinorAspects": (
            bool(getattr(chrt.options, "aspects", False))
            and not bool(getattr(chrt.options, "traditionalaspects", False))
            and all(
                index < len(getattr(chrt.options, "aspect", ()))
                and bool(chrt.options.aspect[index])
                for index in (1, 2, 4, 7, 8, 9, 11)
            )
        ),
        "aspectThicknessMode": bool(getattr(chrt.options, "aspect_thickness_mode", False)),
        "aspectOpacityMode": bool(getattr(chrt.options, "aspect_opacity_mode", False)),
        "showTerms": bool(getattr(chrt.options, "showterms", False)),
        "showAngleArrowheads": bool(getattr(chrt.options, "showanglearrowheads", True)),
        "showCusplessAscMcLabels": bool(getattr(chrt.options, "showcusplessascmclabels", True)),
        "selectedTermSet": int(getattr(chrt.options, "selterm", 0)),
        "terms": [
            _export_term_sign(sign_index, sign_terms)
            for sign_index, sign_terms in enumerate(
                chrt.options.terms[int(getattr(chrt.options, "selterm", 0))]
            )
        ],
        "showDecans": bool(getattr(chrt.options, "showdecans", False)),
        "selectedDecanSet": int(getattr(chrt.options, "seldecan", 0)),
        "decans": [
            _export_decan_sign(sign_index, sign_decans)
            for sign_index, sign_decans in enumerate(
                chrt.options.decans[int(getattr(chrt.options, "seldecan", 0))]
            )
        ],
        "signColors": [
            css_rgb(common.get_sign_color(chrt.options, sign_index))
            for sign_index in range(chart_mod.Chart.SIGN_NUM)
        ],
    })

    payload = {
        "meta": {
            "name": chrt.name,
            "kind": KIND_MAP.get(chrt.htype, "radix"),
            "datetime": iso_datetime_with_offset(chrt),
            "dateDisplay": date_display,
            "timeDisplay": time_display,
            # Resolved anchor label the biwheel title consumes (skin no longer
            # formats an ISO string client-side).
            "anchorDisplay": f"{date_display} {time_display}",
            "place": chrt.place.place,
            "placeCoords": f"{lon_txt}, {lat_txt}",
            "latitude": float(chrt.place.lat),
            "longitude": float(chrt.place.lon),
            "obliquity": float(chrt.obl[0]),
            "buildStamp": build_stamp,
            "age": age_txt,
            "titleParts": [chrt.name, view_label, runtime_txt, age_txt],
            "statusFields": [
                build_stamp,
                chrt.name,
                view_label,
                format_status_datetime(chrt),
                f"{mtexts.txts.get('Longitude', 'Longitude')}: {lon_txt}",
                f"{mtexts.txts.get('Latitude', 'Latitude')}: {lat_txt}",
            ],
            "houseSystemLines": house_system_lines,
        },
        "angles": {
            "asc": float(chrt.houses.ascmc[houses.Houses.ASC]),
            "mc": float(chrt.houses.ascmc[houses.Houses.MC]),
            "armc": float(chrt.houses.ascmc[houses.Houses.ARMC]),
            "vertex": float(chrt.houses.ascmc[houses.Houses.VERTEX]),
            "dsc": float((chrt.houses.ascmc[houses.Houses.ASC] + 180.0) % 360.0),
            "ic": float((chrt.houses.ascmc[houses.Houses.MC] + 180.0) % 360.0),
            # Resolved deg/min-in-sign for the position labels the skin prints.
            "ascDegMin": deg_min_payload(chrt.houses.ascmc[houses.Houses.ASC]),
            "mcDegMin": deg_min_payload(chrt.houses.ascmc[houses.Houses.MC]),
        },
        "houses": {
            "system": str(getattr(chrt.houses, "hsys", getattr(chrt.options, "hsys", "P"))),
            "cusps": [float(chrt.houses.cusps[i]) for i in range(1, 13)],
            "cuspDegMin": [deg_min_payload(chrt.houses.cusps[i]) for i in range(1, 13)],
        },
        "planets": planets_payload,
        "aspects": aspects_payload,
        # Additive click-to-toggle data: option flags (meaning, daemon-owned) +
        # full per-body engine aspect set (force-show source). The skin owns the
        # click selection state and which lines to draw.
        "clickAspectFlags": click_aspect_flags,
        "overlay": overlay_payload,
        "palette": palette_payload,
        "options": options_payload,
    }
    if include_body_aspects:
        payload["bodyAspects"] = body_aspects
    corner_lines = phase("composite_corner_lines", lambda: composite_corner_lines(chrt))
    if corner_lines is not None:
        payload["meta"]["cornerLines"] = corner_lines

    if getattr(chrt.options, "showlof", True) and getattr(chrt, "fortune", None) is not None:
        lof_lon = phase("fortune_lon", lambda: float(chrt.fortune.fortune[fortune.Fortune.LON]))
        payload["fortune"] = {
            "longitude": lof_lon,
            "glyph": common.common.fortune,
            "color": css_rgb(chrt.options.clrsigns),
        }
        payload["fortune"].update(deg_min_payload(lof_lon))

    vertex = phase("vertex", lambda: export_vertex(chrt))
    if vertex is not None:
        payload["vertex"] = vertex

    syzygy_payload = phase("syzygy", lambda: export_syzygy(chrt))
    if syzygy_payload is not None:
        payload["syzygy"] = syzygy_payload

    surveil = phase("surveil_marks", lambda: export_surveil_marks(chrt))
    if surveil:
        payload["surveilMarks"] = surveil

    return payload


def export_surveil_marks(chrt):
    """Serialize global Surveil study marks for the renderer (port of the
    fields graphchart.drawSurveilMarks consumes).

    The surveil *set* is owned by the desktop app's per-study store
    (MorinApp._surveil_store) and is NOT yet exposed by the daemon, so for
    headless/daemon charts this returns []. The renderer path is fully wired
    so marks draw the moment a source attaches `chrt.surveil_marks`."""
    raw = getattr(chrt, "surveil_marks", None)
    if not raw:
        return []
    out = []
    for mark in raw:
        if not isinstance(mark, dict):
            continue
        if not mark.get("enabled", True):
            continue
        try:
            lon = float(mark.get("longitude"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(lon):
            continue
        glyph = str(mark.get("glyph") or "").strip()
        item = {
            "id": str(mark.get("id") or mark.get("label") or lon),
            "longitude": lon % 360.0,
            "label": str(mark.get("label") or ""),
            "glyph": glyph,
            # 'morinus' -> symbols font, anything else -> UI/text font, matching
            # graphchart.drawSurveilMarks' marker_font selection.
            "glyphFont": "morinus" if mark.get("glyph_font") == "morinus" else "text",
            "sourceName": str(mark.get("source_name") or ""),
            "studyName": str(mark.get("study_name") or ""),
        }
        out.append(item)
    return out


def planet_id_from_se_id(se_id):
    return PLANET_ID_MAP.get(int(se_id))


def ensure_fixstars(chrt):
    fsdata = getattr(getattr(chrt, "fixstars", None), "data", None)
    if fsdata:
        return fsdata
    try:
        chrt.rebuildFixStars()
    except Exception:
        return []
    return getattr(getattr(chrt, "fixstars", None), "data", None) or []


def ensure_midpoints(chrt):
    mids = getattr(getattr(chrt, "midpoints", None), "mids", None)
    if mids:
        return mids
    try:
        chrt.calcMidPoints()
    except Exception:
        return []
    return getattr(getattr(chrt, "midpoints", None), "mids", None) or []


def ensure_arabic_parts(chrt):
    parts = getattr(getattr(chrt, "parts", None), "parts", None)
    if parts:
        return parts
    try:
        chrt.calcArabicParts()
    except Exception:
        return []
    return getattr(getattr(chrt, "parts", None), "parts", None) or []


def collect_hybrid_ring_items(chrt):
    # Hybrid Hits combines lots, fixed stars, and the always-present asteroid
    # set. A Tauri step chart deliberately skips Chart(full=True), so populate
    # only the two optional families this selected ring actually consumes.
    ensure_arabic_parts(chrt)
    ensure_fixstars(chrt)
    return common.collect_hybrid_ring_items(chrt, chrt.options)


def _resolve_live_export_options(primary, explicit_options=None):
    if explicit_options is not None:
        return explicit_options
    try:
        from webapp.daemon.chart_service import chart_snapshot_service
        return chart_snapshot_service.options
    except Exception:
        return getattr(primary, "options", None)


def export_ring_item(
    item_id,
    family,
    lon,
    label,
    role="primary",
    segments=None,
    fit_policy=None,
    search_object_id=None,
    semantic_id=None,
    motion_ref=None,
):
    payload = {
        "id": item_id,
        "family": family,
        "longitude": float(lon),
        "label": label,
        "role": role,
    }
    if segments:
        payload["segments"] = segments
    if fit_policy:
        payload["fitPolicy"] = fit_policy
    if search_object_id:
        payload["searchObjectId"] = search_object_id
    if semantic_id:
        payload["semanticId"] = semantic_id
    if motion_ref:
        payload["motionRef"] = motion_ref
    return payload


def _semantic_identity(*parts):
    """Build a stable internal identity without embedding presentation text."""
    return ":".join(str(part) for part in parts)


# wx-free port of graphchart.isShowAsp(CONJUNCTIO, lon1, lon2)
# (graphchart.py:5741-5770). Reproduces the boolean test only -- no drawing.
_ARSIGNDIFF = (0, -1, -1, 2, -1, 3, 4, -1, -1, -1, 6)


def _conjunction_is_shown(chrt, lon1, lon2):
    options = chrt.options
    typ = chart_mod.Chart.CONJUNCTIO
    if typ == chart_mod.Chart.NONE or not options.aspect[typ]:
        return False
    if getattr(options, "traditionalaspects", False):
        lona1 = lon1
        lona2 = lon2
        sign1 = int(lona1 / chart_mod.Chart.SIGN_DEG)
        sign2 = int(lona2 / chart_mod.Chart.SIGN_DEG)
        signdiff = math.fabs(sign1 - sign2)
        if signdiff > chart_mod.Chart.SIGN_NUM / 2:
            signdiff = chart_mod.Chart.SIGN_NUM - signdiff
        if _ARSIGNDIFF[typ] != signdiff:
            return False
    return True


def shown_fixstar_indices(chrt):
    """wx-free port of graphchart.mergefsaspmatrices (graphchart.py:5218-5283).

    The fsaspmatrix* structures are already orb-filtered at chart-build time via
    inorbsinister(...CONJUNCTIO) (chart.py:1808-1880), so they encode the
    conjunctions. This reproduces the desktop's per-matrix gating and returns the
    set of fixstar indices (into chrt.fixstars.data) that the wheel would draw.
    """
    options = chrt.options
    showfss = set()

    fsaspmatrix = getattr(chrt, "fsaspmatrix", None)
    if not fsaspmatrix:
        return showfss

    fsdata = chrt.fixstars.data

    # Conjunctions to chart planets/bodies.
    for star_idx, body_ids in fsaspmatrix:
        lon1 = fsdata[star_idx][fixstars.FixStars.LON]
        for body_id in body_ids:
            body = common.get_chart_planet(chrt, body_id)
            if body is None:
                continue
            lon2 = body.data[planets.Planet.LONG]
            if _conjunction_is_shown(chrt, lon1, lon2):
                showfss.add(star_idx)
                break

    # Conjunctions to Asc/Desc/MC/IC.
    asc = chrt.houses.ascmc[houses.Houses.ASC]
    mc = chrt.houses.ascmc[houses.Houses.MC]
    ascmc = [asc, util.normalize(asc + 180.0), mc, util.normalize(mc + 180.0)]
    for star_idx, angle_idxs in getattr(chrt, "fsaspmatrixangles", None) or ():
        lon1 = fsdata[star_idx][fixstars.FixStars.LON]
        for angle_idx in angle_idxs:
            if _conjunction_is_shown(chrt, lon1, ascmc[angle_idx]):
                showfss.add(star_idx)
                break

    # Conjunctions to house cusps (gated by showfixstarshcs).
    if getattr(options, "showfixstarshcs", False):
        for star_idx, cusp_idxs in getattr(chrt, "fsaspmatrixhcs", None) or ():
            lon1 = fsdata[star_idx][fixstars.FixStars.LON]
            for cusp_idx in cusp_idxs:
                if _conjunction_is_shown(chrt, lon1, chrt.houses.cusps[cusp_idx + 1]):
                    showfss.add(star_idx)
                    break

    # Conjunctions to Lot of Fortune (gated by showfixstarslof).
    if getattr(options, "showfixstarslof", False):
        lof = chrt.fortune.fortune[fortune.Fortune.LON]
        for star_idx in getattr(chrt, "fsaspmatrixlof", None) or ():
            lon1 = fsdata[star_idx][fixstars.FixStars.LON]
            if _conjunction_is_shown(chrt, lon1, lof):
                showfss.add(star_idx)

    return showfss


def export_fixstar_items(chrt):
    items = []
    fsdata = ensure_fixstars(chrt)
    shown = shown_fixstar_indices(chrt)
    configured_codes = list(getattr(chrt.options, "fixstars", {}).keys())
    for idx, star in enumerate(fsdata):
        if idx not in shown:
            continue
        name = astrology.display_fixstar_name(
            star[fixstars.FixStars.NOMNAME],
            chrt.options,
            star[fixstars.FixStars.NAME],
        )
        display_lon = float(star[fixstars.FixStars.LON])
        d, m, s = util.decToDeg(display_lon)
        d, m = util.roundDeg(d % chart_mod.Chart.SIGN_DEG, m, s)
        label = f"{name} {d}\u00B0{str(m).zfill(2)}'"
        code = str(star[fixstars.FixStars.NOMNAME] or "")
        try:
            original_index = int(chrt.fixstars.mixed[idx])
            code = code or str(configured_codes[original_index])
        except Exception:
            pass
        item = export_ring_item(
            f"fixstar-{idx}",
            "fixstar",
            star[fixstars.FixStars.LON],
            label,
            segments=[{"text": label, "kind": "text"}],
            semantic_id=_semantic_identity("fixed-star", code or idx),
            motion_ref={"kind": "fixedStar", "code": code} if code else None,
        )
        # The wheel keeps the degree suffix, while compact semantic lists need
        # only the star's name.  Keep both representations in the payload.
        item["listLabel"] = name
        items.append(item)
    return items


def export_asteroid_items(chrt, role="primary"):
    items = []
    for item in common.collect_asteroid_ring_items(chrt, chrt.options):
        try:
            body_id = int(item["bodyId"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        label = str(item.get("name") or astrology.swe_get_planet_name(body_id))
        payload = export_ring_item(
            f"asteroid-{body_id}",
            "asteroid",
            lon,
            label,
            role=role,
            segments=[{"text": label, "kind": "text"}],
            semantic_id=_semantic_identity("ephemeris-body", body_id),
            motion_ref={"kind": "ephemerisBody", "bodyId": body_id},
        )
        payload["speed"] = float(item.get("speed", 0.0) or 0.0)
        items.append(payload)
    return items


def export_hybrid_items(chrt, role="primary"):
    items = []
    for index, item in enumerate(collect_hybrid_ring_items(chrt)):
        family = str(item.get("family") or "hybrid_hit")
        label = str(item.get("name") or family)
        try:
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        motion_ref = None
        semantic_id = None
        if family == "asteroid" and item.get("bodyId") is not None:
            body_id = int(item["bodyId"])
            motion_ref = {"kind": "ephemerisBody", "bodyId": body_id}
            semantic_id = _semantic_identity("ephemeris-body", body_id)
        elif family == "fixstar" and item.get("starCode"):
            code = str(item["starCode"])
            motion_ref = {"kind": "fixedStar", "code": code}
            semantic_id = _semantic_identity("fixed-star", code)
        elif family == "arabic_part" and item.get("configIndex") is not None:
            config_index = int(item["configIndex"])
            motion_ref = {"kind": "arabicPart", "configIndex": config_index}
            semantic_id = _semantic_identity("arabic-part", config_index)
        elif family == "dodecatemoria" and item.get("bodyId") is not None:
            body_id = int(item["bodyId"])
            motion_ref = {
                "kind": "projection",
                "projection": "dodecatemoria",
                "source": {"kind": "planet", "bodyId": body_id},
            }
            semantic_id = _semantic_identity("dodecatemoria", "planet", body_id)
        payload = export_ring_item(
            f"hybrid-{family}-{semantic_id or index}",
            family,
            lon,
            label,
            role=role,
            segments=[{"text": label, "kind": "text"}],
            semantic_id=semantic_id or _semantic_identity("hybrid", family, index),
            motion_ref=motion_ref,
        )
        if family == "asteroid":
            payload["speed"] = float(item.get("speed", 0.0) or 0.0)
        items.append(payload)
    return items


def export_row_ring_items(rows, family, role="primary"):
    items = []
    for idx, row in enumerate(rows):
        label = str(row[0])
        items.append(
            export_ring_item(
                f"{family}-{idx}",
                family,
                row[2],
                label,
                role=role,
                segments=[{"text": label, "kind": "text"}],
            )
        )
    return items


def export_midpoint_ring_items(chrt):
    items = []
    ensure_midpoints(chrt)
    for idx, item in enumerate(common.collect_midpoint_ring_items(chrt, chrt.options)):
        p1 = int(item["p1"])
        p2 = int(item["p2"])
        label = f"{common.common.get_planet_name(p1)}/{common.common.get_planet_name(p2)}"
        items.append(
            export_ring_item(
                f"midpoint-{idx}",
                "midpoint",
                item["lon"],
                label,
                segments=[
                    {"text": common.common.get_planet_glyph(p1), "kind": "planet", "seId": p1},
                    {"text": "/", "kind": "text"},
                    {"text": common.common.get_planet_glyph(p2), "kind": "planet", "seId": p2},
                ],
                semantic_id=_semantic_identity("midpoint", p1, p2),
                motion_ref={"kind": "midpoint", "p1": p1, "p2": p2},
            )
        )
    return items


def export_arabic_part_items(chrt, role="primary"):
    items = []
    ensure_arabic_parts(chrt)
    parts_obj = getattr(chrt, "parts", None)
    parts_list = list(getattr(parts_obj, "parts", None) or [])
    active_config_indices = []
    for config_index, configured_part in enumerate(getattr(chrt.options, "arabicparts", ()) or ()):
        try:
            if not arabicparts.ArabicParts.is_active_item(configured_part):
                continue
        except Exception:
            pass
        active_config_indices.append(config_index)
    part_entries = [
        (
            part,
            "part:%03d" % idx,
            active_config_indices[idx] if idx < len(active_config_indices) else idx,
        )
        for idx, part in enumerate(parts_list)
    ]
    if (
        getattr(chrt, "fortune", None) is not None
        and bool(getattr(chrt.options, "showlof", False))
        and bool(getattr(chrt.options, "showlofouterring", False))
    ):
        try:
            part_entries.append(
                ({
                    arabicparts.ArabicParts.LONG: float(chrt.fortune.fortune[fortune.Fortune.LON]),
                    arabicparts.ArabicParts.NAME: mtexts.txts.get("LotOfFortune", "Fortuna"),
                }, "point:lof", None)
            )
        except Exception:
            pass
    # Arabic Parts mode mirrors graphchart.drawChart's ARABICPARTS branch:
    # `apshow = range(len(parts_ap))`, so every computed part is drawn. The
    # direct-hit/conjunction filter belongs only to Hybrid Hits.
    for idx, (part, search_object_id, config_index) in enumerate(part_entries):
        try:
            lon = float(part[arabicparts.ArabicParts.LONG])
            label = str(part[arabicparts.ArabicParts.NAME])
        except Exception:
            continue
        items.append(
            export_ring_item(
                f"arabic-part-{role}-{idx}",
                "arabic_part",
                lon,
                label,
                role=role,
                segments=[{"text": label, "kind": "text"}],
                search_object_id=search_object_id,
                semantic_id=(
                    "lot-of-fortune" if config_index is None
                    else _semantic_identity("arabic-part", int(config_index))
                ),
                motion_ref=(
                    {"kind": "fortune"} if config_index is None
                    else {"kind": "arabicPart", "configIndex": int(config_index)}
                ),
            )
        )
    return items


def export_parallel_transit_items(chrt):
    items = []
    if chrt is None:
        return items
    for planet in export_planets(chrt):
        try:
            se_id = int(planet["seId"])
            lon = float(planet["longitude"])
        except Exception:
            continue
        label = planet_display_label(se_id, chrt.options)
        items.append(
            export_ring_item(
                f"parallel-transit-planet-{se_id}",
                "parallel_transits",
                lon,
                label,
                role="outer",
                segments=[{
                    "text": common.common.get_planet_glyph(se_id),
                    "kind": "planet",
                    "seId": se_id,
                    "color": planet.get("color"),
                }],
                fit_policy="none",
            )
        )
        if planet.get("motion"):
            items[-1]["motion"] = planet.get("motion")

    if getattr(chrt.options, "showlof", True) and getattr(chrt, "fortune", None) is not None:
        try:
            lof_lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
        except Exception:
            lof_lon = None
        if lof_lon is not None:
            items.append(
                export_ring_item(
                    "parallel-transit-fortune",
                    "parallel_transits",
                    lof_lon,
                    mtexts.txts.get("LotOfFortune", "Fortuna"),
                    role="outer",
                    segments=[{
                        "text": common.common.fortune,
                        "kind": "glyph",
                        "color": css_rgb(chrt.options.clrsigns),
                    }],
                    fit_policy="none",
                )
            )

    vertex = export_vertex(chrt)
    if vertex is not None:
        items.append(
            export_ring_item(
                "parallel-transit-vertex",
                "parallel_transits",
                float(vertex["longitude"]),
                mtexts.txts.get("Vertex", "Vertex"),
                role="outer",
                segments=[{
                    "text": vertex.get("glyph", common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX)),
                    "kind": "glyph",
                    "color": vertex.get("color"),
                }],
                fit_policy="none",
            )
        )

    return items


def _build_overlay_lon_helpers(chrt, antis=None):
    from antiscia import Antiscia

    target_chart = chrt
    ayanopt = getattr(chrt.options, "ayanamsha", 0)
    ayan = getattr(target_chart, "ayanamsha_offset", 0.0)
    if antis is None:
        # Classical/dodecatemoria callers retain the original standalone
        # helper behavior. Morin callers explicitly pass the chart's canonical
        # collection so latitude-bearing branches are never flattened here.
        antis = Antiscia(
            target_chart.planets.planets,
            target_chart.houses.ascmc,
            target_chart.fortune.fortune,
            getattr(target_chart, "obl", (0.0,))[0],
            ayanopt,
            ayan,
        )

    def antis_lon(lon):
        ant, _ = antis.calc(antis._to_tropical(lon))
        return ant

    def contra_lon(lon):
        _, cant = antis.calc(antis._to_tropical(lon))
        return cant

    def dodec_lon(lon):
        return antis.calcDodecatemoria(lon)

    return antis_lon, contra_lon, dodec_lon


def _ensure_chart_antiscia(chrt):
    """Return the chart's canonical antiscia collection for current options."""
    expected_morin = bool(getattr(chrt.options, "morin_antiscia", False))
    current = getattr(chrt, "antiscia", None)
    if current is not None and bool(getattr(current, "morin_antiscia", False)) == expected_morin:
        return current
    try:
        chrt.calcAntiscia()
        current = getattr(chrt, "antiscia", None)
    except Exception:
        current = None
    if current is not None and bool(getattr(current, "morin_antiscia", False)) == expected_morin:
        return current

    # Step/deferred charts may not have populated their optional technique
    # objects yet. Build the same canonical engine object Chart.calcAntiscia
    # uses, with the live doctrine option, rather than duplicating projection
    # geometry in the exporter.
    try:
        from antiscia import Antiscia

        return Antiscia(
            chrt.planets.planets,
            chrt.houses.ascmc,
            chrt.fortune.fortune,
            getattr(chrt, "obl", (0.0,))[0],
            getattr(chrt.options, "ayanamsha", 0),
            getattr(chrt, "ayanamsha_offset", 0.0),
            morin_antiscia=expected_morin,
        )
    except Exception:
        return None


def _morin_planet_projection_points(chrt, antis, kind, planet):
    """Yield ``(branch, longitude, direction)`` from canonical Morin math."""
    from antiscia import Antiscion

    direction_names = {
        Antiscion.UNDIRECTED: "undirected",
        Antiscion.SINISTER: "sinister",
        Antiscion.DEXTER: "dexter",
    }

    def direction_name(value):
        return direction_names.get(int(value or Antiscion.UNDIRECTED), "undirected")

    se_id = int(planet["seId"])
    if kind == "antiscia":
        primary = getattr(antis, "plantiscia", ()) or ()
        secondary = getattr(antis, "plantiscia_secondary", ()) or ()
        contra = False
    else:
        primary = getattr(antis, "plcontraant", ()) or ()
        secondary = getattr(antis, "plcontraant_secondary", ()) or ()
        contra = True

    # The chart-wide arrays are the source of truth for the ordinary planet
    # matrix. Chiron is an optional body outside that fixed matrix, so project
    # it through the same Antiscia engine helper when it is visible.
    if 0 <= se_id < len(primary):
        candidates = (
            ("primary", primary[se_id]),
            ("secondary", secondary[se_id] if se_id < len(secondary) else None),
        )
        for branch, point in candidates:
            if point is None or not bool(getattr(point, "valid", True)):
                continue
            yield (
                branch,
                float(point.lon),
                direction_name(getattr(point, "direction", 0)),
            )
        return

    from antiscia import Antiscia

    points = Antiscia.morin_projection_points(
        float(planet["longitude"]),
        float(planet.get("latitude", 0.0)),
        getattr(chrt, "obl", (0.0,))[0],
        getattr(chrt.options, "ayanamsha", 0),
        getattr(chrt, "ayanamsha_offset", 0.0),
        contra=contra,
    )
    for branch in ("primary", "secondary"):
        point = points.get(branch)
        if point is None or not bool(point.get("valid", True)):
            continue
        yield branch, float(point["lon"]), direction_name(point.get("direction", 0))


def export_overlay_family_items(chrt, kind, role="primary"):
    morin_planet_mode = (
        kind in ("antiscia", "contra_antiscia")
        and bool(getattr(chrt.options, "morin_antiscia", False))
    )
    chart_antiscia = _ensure_chart_antiscia(chrt) if morin_planet_mode else None
    antis_lon, contra_lon, dodec_lon = _build_overlay_lon_helpers(
        chrt,
        antis=chart_antiscia if morin_planet_mode else None,
    )
    if kind == "antiscia":
        calc_fn = antis_lon
        suffix = "antiscia"
    elif kind == "contra_antiscia":
        calc_fn = contra_lon
        suffix = "contra"
    else:
        calc_fn = dodec_lon
        suffix = "dodec"

    items = []
    exported_planets = export_planets(chrt)
    if morin_planet_mode and chart_antiscia is not None:
        projection = "morin_antiscia" if kind == "antiscia" else "morin_contra_antiscia"
        for planet in exported_planets:
            se_id = int(planet["seId"])
            projected_points = list(_morin_planet_projection_points(
                chrt,
                chart_antiscia,
                kind,
                planet,
            ))
            branch_count = len(projected_points)
            for branch, projected_lon, branch_direction in projected_points:
                items.append(
                    export_ring_item(
                        f"{suffix}-planet-{se_id}-{branch}",
                        kind,
                        projected_lon,
                        overlay_source_display_label(se_id, kind, chrt.options),
                        role=role,
                        segments=[{
                            "text": common.common.get_planet_glyph(se_id),
                            "kind": "planet",
                            "seId": se_id,
                        }],
                        semantic_id=_semantic_identity(projection, "planet", se_id, branch),
                        motion_ref={
                            "kind": "projection",
                            "projection": projection,
                            "branch": branch,
                            "branchCount": branch_count,
                            "branchDirection": branch_direction,
                            "source": {"kind": "planet", "bodyId": se_id},
                        },
                    )
                )
    elif not morin_planet_mode:
        for idx, planet in enumerate(exported_planets):
            se_id = int(planet["seId"])
            items.append(
                export_ring_item(
                    f"{suffix}-planet-{idx}",
                    kind,
                    calc_fn(float(planet["longitude"])),
                    overlay_source_display_label(se_id, kind, chrt.options),
                    role=role,
                    segments=[{"text": common.common.get_planet_glyph(se_id), "kind": "planet", "seId": se_id}],
                    semantic_id=_semantic_identity(kind, "planet", se_id),
                    motion_ref={
                        "kind": "projection",
                        "projection": kind,
                        "source": {"kind": "planet", "bodyId": se_id},
                    },
                )
            )

    if getattr(chrt.options, "showlof", True) and getattr(chrt, "fortune", None) is not None:
        fortune_label = str(mtexts.txts.get("LotOfFortune", "Fortuna"))
        item = export_ring_item(
            f"{suffix}-fortune",
            kind,
            calc_fn(float(chrt.fortune.fortune[fortune.Fortune.LON])),
            fortune_label,
            role=role,
            # graphchart.drawAntis draws the Lot's Morinus glyph (common.common.fortune)
            # at the projected longitude, not a text label -> emit a symbols-font glyph
            # segment so the renderer matches the desktop.
            segments=[{"text": common.common.fortune, "kind": "glyph"}],
            semantic_id=_semantic_identity(kind, "fortune"),
            motion_ref={
                "kind": "projection",
                "projection": kind,
                "source": {"kind": "fortune"},
            },
        )
        item["listLabel"] = overlay_list_display_label(fortune_label, kind)
        items.append(item)

    # graphchart.drawAntis labels Asc/MC with the stripped single letters
    # (mtexts StripAsc='A' / StripMC='M') in the antis text font, not the
    # full "Asc"/"MC" words; mirror that for the projected glyph ring.
    for angle_key, angle_idx, label in (
        ("asc", houses.Houses.ASC, mtexts.txts.get("StripAsc", "A")),
        ("mc", houses.Houses.MC, mtexts.txts.get("StripMC", "M")),
    ):
        item = export_ring_item(
            f"{suffix}-{angle_key}",
            kind,
            calc_fn(float(chrt.houses.ascmc[angle_idx])),
            label,
            role=role,
            segments=[{"text": label, "kind": "text"}],
            semantic_id=_semantic_identity(kind, angle_key),
            motion_ref={
                "kind": "projection",
                "projection": kind,
                "source": {"kind": "angleSource", "angle": angle_key},
            },
        )
        item["listLabel"] = overlay_list_display_label(
            str(mtexts.txts.get("Asc" if angle_key == "asc" else "MC", angle_key)),
            kind,
        )
        items.append(item)
    items.sort(key=lambda item: item["longitude"])
    return items


def _interchart_click_enabled_aspects(options):
    major_only = not bool(getattr(options, "exclusive_aspects_on_click_show_minor", True))
    return [
        (not major_only) or _is_major_aspect_type(aspect_type)
        for aspect_type in range(chart_mod.Chart.ASPECT_NUM)
    ]


def _interchart_point_aspect(
    primary,
    comparison,
    primary_lon,
    comparison_lon,
    primary_orbs,
    comparison_orbs,
    options,
    enabled_aspects,
    traditional_filter,
):
    best_asp = None
    best_delta = None
    best_distance = None
    for aspect_type in range(chart_mod.Chart.ASPECT_NUM):
        if not enabled_aspects[aspect_type]:
            continue
        if not interchartaspects._passes_traditional_filter(
            aspect_type,
            primary_lon,
            comparison_lon,
            primary,
            comparison,
            options,
            enabled=traditional_filter,
        ):
            continue

        orb = float(primary_orbs[aspect_type]) + float(comparison_orbs[aspect_type])
        delta, distance = interchartaspects._aspect_delta(primary_lon, comparison_lon, aspect_type)
        if delta > orb:
            continue
        if best_delta is None or delta < best_delta:
            asp = chart_mod.Asp()
            asp.typ = aspect_type
            asp.aspdif = delta
            asp.max_orb = orb
            asp.dif = distance
            asp.exact = delta <= getattr(options, "exact", 0.0)
            asp.appl = False
            best_asp = asp
            best_delta = delta
            best_distance = distance

    if best_asp is not None:
        best_asp.dif = best_distance if best_distance is not None else 0.0
    return best_asp


def _zero_orbs():
    return [0.0] * chart_mod.Chart.ASPECT_NUM


_TECHNIQUE_STANDARD_BODY_IDS = (
    *range(astrology.SE_SUN, astrology.SE_PLUTO + 1),
    astrology.SE_MEAN_NODE,
    astrology.SE_TRUE_NODE,
    astrology.SE_CHIRON,
)


def _technique_body(chrt, body_id):
    getter = getattr(chrt, "get_planet_body", None)
    if callable(getter):
        try:
            body = getter(body_id)
        except Exception:
            body = None
        if body is not None:
            return body
    try:
        return common.common.get_chart_planet(chrt, body_id)
    except Exception:
        return None


def _technique_body_orbs(chrt, options, body_id):
    try:
        orb_index = int(chrt.get_planet_orb_index(body_id))
    except Exception:
        if body_id == astrology.SE_CHIRON:
            orb_index = astrology.SE_PLUTO
        elif body_id == astrology.SE_TRUE_NODE:
            orb_index = astrology.SE_MEAN_NODE
        else:
            orb_index = int(body_id)
    try:
        source = list(options.orbis[orb_index])
    except Exception:
        return _zero_orbs()
    return [
        float(source[index]) if index < len(source) else 0.0
        for index in range(chart_mod.Chart.ASPECT_NUM)
    ]


def technique_aspect_endpoints(chrt, options=None):
    """Return every chart-computable standard endpoint used by techniques.

    This is deliberately a calculation registry, not a wheel-visibility
    registry. Display gates (including nodes, trans-Saturnians, Chiron,
    Fortune, Vertex, and prenatal Syzygy) never change membership. Active
    outer-ring families are separate typed sources and are not included here.
    """
    technique_options = options if options is not None else chrt.options
    endpoints = []

    for body_id in _TECHNIQUE_STANDARD_BODY_IDS:
        body = _technique_body(chrt, body_id)
        if body is None:
            continue
        key = planet_id_from_se_id(body_id)
        if key is None:
            continue
        try:
            lon = float(body.data[planets.Planet.LONG])
        except Exception:
            continue
        endpoints.append(
            {
                "key": key,
                "kind": "planet",
                "lon": lon,
                "orbs": _technique_body_orbs(chrt, technique_options, body_id),
            }
        )

    try:
        angle_orbs = [
            float(value)
            for value in list(technique_options.orbisAscMC)[:chart_mod.Chart.ASPECT_NUM]
        ]
    except Exception:
        angle_orbs = _zero_orbs()
    if len(angle_orbs) < chart_mod.Chart.ASPECT_NUM:
        angle_orbs.extend([0.0] * (chart_mod.Chart.ASPECT_NUM - len(angle_orbs)))
    for key, lon in _angle_longitudes(chrt):
        endpoints.append(
            {
                "key": key,
                "kind": "angle",
                "lon": float(lon),
                "orbs": angle_orbs[:],
            }
        )

    try:
        fortune_lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
    except Exception:
        fortune_lon = None
    if fortune_lon is not None:
        endpoints.append(
            {
                "key": "fortune",
                "kind": "fortune",
                "lon": fortune_lon,
                "orbs": _zero_orbs(),
            }
        )

    try:
        vertex_lon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
    except Exception:
        vertex_lon = None
    if vertex_lon is not None:
        endpoints.append(
            {
                "key": "vertex",
                "kind": "vertex",
                "lon": vertex_lon,
                "orbs": _zero_orbs(),
            }
        )

    syzygy_lon = _ensure_syzygy_lon(chrt)
    if syzygy_lon is not None:
        endpoints.append(
            {
                "key": "syzygy",
                "kind": "syzygy",
                "lon": float(syzygy_lon),
                "orbs": _zero_orbs(),
            }
        )

    return endpoints


def _interchart_planet_endpoints(chrt, options):
    endpoints = []
    try:
        planet_ids = chrt.get_visible_aspect_planet_ids(include_chiron=getattr(options, "showchiron", True))
    except Exception:
        planet_ids = common.common.get_visible_chart_planet_ids(
            chrt,
            options,
            include_descnode=True,
            include_chiron=True,
        )
    for planet_id in planet_ids:
        key = planet_id_from_se_id(planet_id)
        if key is None:
            continue
        body = common.common.get_chart_planet(chrt, planet_id)
        if body is None:
            continue
        try:
            orbs = options.orbis[chrt.get_planet_orb_index(planet_id)]
        except Exception:
            continue
        endpoints.append(
            {
                "key": key,
                "kind": "planet",
                "lon": float(body.data[planets.Planet.LONG]),
                "orbs": orbs,
            }
        )
    return endpoints


def _interchart_point_endpoints(chrt, options):
    endpoints = []
    angle_orbs = getattr(options, "orbisAscMC", None)
    if angle_orbs is not None:
        for key, lon in _angle_longitudes(chrt):
            endpoints.append(
                {
                    "key": key,
                    "kind": "angle",
                    "lon": float(lon),
                    "orbs": angle_orbs,
                }
            )
    if getattr(options, "showlof", True) and getattr(chrt, "fortune", None) is not None:
        try:
            endpoints.append(
                {
                    "key": "fortune",
                    "kind": "fortune",
                    "lon": float(chrt.fortune.fortune[fortune.Fortune.LON]),
                    "orbs": _zero_orbs(),
                }
            )
        except Exception:
            pass
    vertex = export_vertex(chrt)
    if vertex is not None:
        try:
            endpoints.append(
                {
                    "key": "vertex",
                    "kind": "vertex",
                    "lon": float(vertex["longitude"]),
                    "orbs": _zero_orbs(),
                }
            )
        except Exception:
            pass
    syzygy_payload = export_syzygy(chrt)
    if syzygy_payload is not None:
        try:
            endpoints.append(
                {
                    "key": "syzygy",
                    "kind": "syzygy",
                    "lon": float(syzygy_payload["longitude"]),
                    "orbs": _zero_orbs(),
                }
            )
        except Exception:
            pass
    return endpoints


def _interchart_click_endpoints(chrt, options):
    return _interchart_planet_endpoints(chrt, options) + _interchart_point_endpoints(chrt, options)


def _endpoint_selectable_for_pair(selected, other, options):
    selected_key = selected["key"]
    other_key = other["key"]
    if _is_node_aspect_key(selected_key):
        return True
    if _is_node_aspect_key(other_key) and not getattr(options, "aspectstonodes", False):
        return False
    if selected_key == "fortune":
        return True
    if other_key == "fortune" and not getattr(options, "showaspectstolof", False):
        return False
    if selected_key == "vertex":
        return True
    if other_key == "vertex" and not getattr(options, "showaspectstovertex", False):
        return False
    if selected_key == "syzygy" or other_key == "syzygy":
        return True
    return True


def _interchart_selection_keys(inner_endpoint, outer_endpoint, options):
    keys = []
    if _endpoint_selectable_for_pair(inner_endpoint, outer_endpoint, options):
        keys.append(str(inner_endpoint["key"]))
    if _endpoint_selectable_for_pair(outer_endpoint, inner_endpoint, options):
        keys.append(f"outer:{outer_endpoint['key']}")
    return keys


def export_interchart_aspects(primary, comparison):
    return export_interchart_aspect_data(primary, comparison)["aspects"]


def export_interchart_aspect_data(primary, comparison):
    if primary is None or comparison is None:
        return {"aspects": [], "bodyAspects": {}}

    rows = {}
    by_selector = {}

    def add_row(outer, inner, asp, field, selection_keys=()):
        if outer is None or inner is None:
            return
        if field == "showsNormally":
            if not getattr(primary.options, "aspectstonodes", False) and (
                _is_node_aspect_key(outer) or _is_node_aspect_key(inner)
            ):
                return
        key = (outer, inner, int(asp.typ))
        row = rows.setdefault(
            key,
            {
                "outer": outer,
                "inner": inner,
                "type": int(asp.typ),
                "orb": float(getattr(asp, "aspdif", 0.0)),
                "maxOrb": float(getattr(asp, "max_orb", 0.0)),
                "exact": bool(getattr(asp, "exact", False)),
                "applying": bool(getattr(asp, "appl", False)),
                "showsNormally": False,
                "showsOnClick": False,
            },
        )
        row[field] = True
        if field == "showsOnClick":
            for selection_key in selection_keys:
                by_selector.setdefault(selection_key, []).append(row)

    def add_rows(aspect_rows, field):
        for outer_idx, inner_idx, asp in aspect_rows:
            outer = planet_id_from_se_id(outer_idx)
            inner = planet_id_from_se_id(inner_idx)
            add_row(outer, inner, asp, field)

    add_rows(
        interchartaspects.calc_planetary_interchart_aspects(primary, comparison, primary.options),
        "showsNormally",
    )
    click_enabled_aspects = _interchart_click_enabled_aspects(primary.options)
    click_traditional_filter = bool(getattr(primary.options, "exclusive_aspects_on_click_traditional", False))
    inner_endpoints = _interchart_click_endpoints(primary, primary.options)
    outer_endpoints = _interchart_click_endpoints(comparison, primary.options)
    for inner_endpoint in inner_endpoints:
        for outer_endpoint in outer_endpoints:
            if _is_node_aspect_key(inner_endpoint["key"]) and _is_node_aspect_key(outer_endpoint["key"]):
                continue
            asp = _interchart_point_aspect(
                primary,
                comparison,
                float(inner_endpoint["lon"]),
                float(outer_endpoint["lon"]),
                inner_endpoint["orbs"],
                outer_endpoint["orbs"],
                primary.options,
                click_enabled_aspects,
                click_traditional_filter,
            )
            if asp is None:
                continue
            add_row(
                outer_endpoint["key"],
                inner_endpoint["key"],
                asp,
                "showsOnClick",
                selection_keys=_interchart_selection_keys(inner_endpoint, outer_endpoint, primary.options),
            )
    aspects = sorted(
        rows.values(),
        key=lambda row: (str(row["inner"]), str(row["outer"]), int(row["type"])),
    )
    return {
        "aspects": aspects,
        "bodyAspects": {
            key: sorted(
                value,
                key=lambda row: (str(row["inner"]), str(row["outer"]), int(row["type"])),
            )
            for key, value in by_selector.items()
        },
    }


def render_invalidation_payload(overlay_render_mode):
    """Canvas layer invalidation contract, mirroring the wx drawBkg modes.

    full: normal drawBkg pass; all layers are current.
    deferred: chart paints now; outer overlay labels follow shortly.
    step_fast: arrow-key step burst; the full visible wheel geometry, moving
    bodies, chart-dependent outer-ring labels, and hover regions refresh from
    the stepped snapshot. Only expensive non-frame overlay facts are skipped by
    the exporter and filled by the settle/full pass.
    """
    if overlay_render_mode == "step_fast":
        return {
            "geometry": True,
            "dynamic": True,
            "outerLabel": True,
            "deferredOuterLabel": False,
        }
    if overlay_render_mode == "deferred":
        return {
            "geometry": True,
            "dynamic": True,
            "outerLabel": False,
            "deferredOuterLabel": True,
        }
    return {
        "geometry": True,
        "dynamic": True,
        "outerLabel": True,
        "deferredOuterLabel": False,
    }


def _record_perf_phase(perf, name, started_at):
    if perf is None:
        return
    perf.setdefault("phases", []).append({
        "name": name,
        "ms": (time.perf_counter() - started_at) * 1000.0,
    })


def _timed_export(perf, name, fn):
    started_at = time.perf_counter()
    result = fn()
    _record_perf_phase(perf, name, started_at)
    return result


def render_variant_for_theme(theme) -> str:
    """Map the persisted wheel-layout enum to the renderer contract."""
    try:
        value = int(theme)
    except (TypeError, ValueError):
        value = 0
    if value == 1:
        return "round-compact"
    if value == 2:
        return "round-anglo"
    return "round-classic"


def export_snapshot(
    primary,
    comparison=None,
    radix=None,
    anchor=None,
    overlay_render_mode="full",
    live_options=None,
    perf=None,
    overlay_display_datetime=None,
    overlay_cursor_jd=None,
    parallel_transit=None,
):
    export_options = _timed_export(
        perf,
        "resolve_options",
        lambda: _resolve_live_export_options(primary, live_options),
    )
    option_outer_mode = _timed_export(
        perf,
        "resolve_outer_mode",
        lambda: OUTER_RING_MODE_MAP.get(
            int(getattr(export_options, "showfixstars", 0) or 0),
            "none",
        ),
    )
    parallel_transit_items = _timed_export(
        perf,
        "outer.parallel_transits",
        lambda: export_parallel_transit_items(parallel_transit),
    )
    active_outer_mode = "parallel_transits" if parallel_transit_items else option_outer_mode
    # A step frame can only draw the currently selected outer-ring family. The
    # previous snapshot remains retained in the frontend, so calculating and
    # serializing every inactive family here is pure latency (Arabic Parts alone
    # can cost ~10 ms). Full/deferred snapshots still populate the complete set.
    include_all_outer_modes = overlay_render_mode != "step_fast"
    outer_ring_items = {}

    def include_outer(mode, builder):
        if include_all_outer_modes or active_outer_mode == mode:
            outer_ring_items[mode] = _timed_export(perf, f"outer.{mode}", builder)

    include_outer("fixstars", lambda: export_fixstar_items(primary))
    include_outer("asteroids", lambda: export_asteroid_items(primary))
    include_outer("midpoints", lambda: export_midpoint_ring_items(primary))
    include_outer("hybrid_hits", lambda: export_hybrid_items(primary))
    include_outer("antiscia", lambda: export_overlay_family_items(
            comparison if comparison is not None else primary,
            "antiscia",
            role="outer" if comparison is not None else "primary",
        ))
    include_outer("dodecatemoria", lambda: export_overlay_family_items(
            comparison if comparison is not None else primary,
            "dodecatemoria",
            role="outer" if comparison is not None else "primary",
        ))
    include_outer("contra_antiscia", lambda: export_overlay_family_items(
            comparison if comparison is not None else primary,
            "contra_antiscia",
            role="outer" if comparison is not None else "primary",
        ))
    include_outer("arabic_parts", lambda: (
            export_arabic_part_items(comparison, role="outer") if comparison is not None else export_arabic_part_items(primary)
        ))
    if include_all_outer_modes or active_outer_mode == "parallel_transits":
        outer_ring_items["parallel_transits"] = parallel_transit_items
    if perf is not None:
        perf["outerRingCounts"] = {
            key: len(value) if hasattr(value, "__len__") else 0
            for key, value in outer_ring_items.items()
        }
    active_click_points = outer_ring_items.get(active_outer_mode, ())
    overlay_radix = radix if radix is not None else primary
    include_auxiliary_body_aspects = overlay_render_mode != "step_fast"
    comparison_whole_sign = bool(
        comparison is not None and _export_house_system_code(primary) == "N"
    )
    interchart_aspect_data = _timed_export(
        perf,
        "interchart_aspect_data",
        lambda: export_interchart_aspect_data(primary, comparison),
    )
    return {
        "primaryChart": _timed_export(
            perf,
            "chart.primary",
            lambda: export_chart(
                primary,
                overlay_render_mode,
                click_point_items=active_click_points,
                perf=perf,
                perf_prefix="chart.primary",
				overlay_radix=overlay_radix,
                overlay_display_datetime=overlay_display_datetime if comparison is None else None,
                overlay_cursor_jd=overlay_cursor_jd if comparison is None else None,
                display_options=export_options,
                comparison_whole_sign=comparison_whole_sign,
			),
        ),
        # Click flags and adjacency already live on primaryChart, which is the
        # object the renderer consumes. Do not serialize a second identical
        # bodyAspects graph at snapshot root on every time step.
        # A step frame does not consume auxiliary intra-chart adjacency:
        # comparison clicks use interChartBodyAspects, while radix/anchor are
        # semantic context only. Keep full/deferred payload compatibility, but
        # leave this O(bodies x aspects) work off the input-to-paint path.
        "comparisonChart": _timed_export(
            perf,
            "chart.comparison",
            lambda: export_chart(
                comparison,
                overlay_render_mode,
                include_body_aspects=include_auxiliary_body_aspects,
                perf=perf,
                perf_prefix="chart.comparison",
				overlay_radix=overlay_radix,
				overlay_display_datetime=overlay_display_datetime,
				overlay_cursor_jd=overlay_cursor_jd,
                display_options=export_options,
                comparison_whole_sign=comparison_whole_sign,
			),
        ) if comparison is not None else None,
        # The root/session-primary chart already carries the radix geometry and
        # is passed separately above as overlay_radix for semantic calculations.
        # Serializing the same object again added a second complete chart export
        # to every arrow step without giving the renderer any new information.
        "radixChart": _timed_export(
            perf,
            "chart.radix",
            lambda: export_chart(
                radix,
                overlay_render_mode,
                include_body_aspects=include_auxiliary_body_aspects,
                perf=perf,
                perf_prefix="chart.radix",
                display_options=export_options,
            ),
        ) if radix is not None and radix is not primary else None,
        "displayAnchorChart": _timed_export(
            perf,
            "chart.anchor",
            lambda: export_chart(
                anchor,
                overlay_render_mode,
                include_body_aspects=include_auxiliary_body_aspects,
                perf=perf,
                perf_prefix="chart.anchor",
                display_options=export_options,
            ),
        ) if anchor is not None else None,
        "displayDatetime": (
            display_tuple_iso(overlay_display_datetime) or iso_datetime_with_offset(primary)
            if comparison is None and parallel_transit is not None and overlay_display_datetime is not None
            else iso_datetime_with_offset(comparison if comparison is not None else primary)
        ),
        "renderVariant": render_variant_for_theme(getattr(primary.options, "theme", 0)),
        "overlayRenderMode": overlay_render_mode,
        "renderInvalidation": render_invalidation_payload(overlay_render_mode),
        "outerRingMode": active_outer_mode,
        # Standard comparison is the non-house overlay. Workspace sessions may
        # override this to ``with-houses`` for an explicit relationship/biwheel
        # layout; ordinary primary-house visibility must not select that mode.
        "comparisonLayout": "standard",
        "comparisonWholeSign": comparison_whole_sign,
        "interChartAspects": interchart_aspect_data["aspects"],
        "interChartBodyAspects": interchart_aspect_data["bodyAspects"],
        "outerRingItems": outer_ring_items,
    }


def main():
    args = parse_args()
    opts = init_environment()
    chrt, _record_index = load_chart(args.source, opts, name=args.name, record_index=args.record_index)
    comparison = None
    radix = None
    anchor = None
    if args.comparison_name or args.comparison_record_index is not None:
        comparison, _ = load_chart(args.source, opts, name=args.comparison_name, record_index=args.comparison_record_index)
    if args.radix_name or args.radix_record_index is not None:
        radix, _ = load_chart(args.source, opts, name=args.radix_name, record_index=args.radix_record_index)
    if args.anchor_name or args.anchor_record_index is not None:
        anchor, _ = load_chart(args.source, opts, name=args.anchor_name, record_index=args.anchor_record_index)
    json.dump(export_snapshot(chrt, comparison, radix, anchor, args.overlay_render_mode), sys.stdout, ensure_ascii=True)


if __name__ == "__main__":
    main()
