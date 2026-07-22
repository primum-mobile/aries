"""Daemon-side Primary Directions list + directions-to-solar-revolution.

Canonical owner: the engine PD pipeline ``primdirs.PrimDirs`` (and its
per-house-system subclasses), reached wx-free through
``engine.symbolic_projection.project_symbolic_table(PRIMARY_DIRECTIONS, …)``.
This service does NOT reimplement directional math — it constructs the radix
(or a solar-revolution chart) and hands it to the projection, then shapes the
resulting ``PrimDir`` rows into JSON.

The per-row label text mirrors ``PrimDirs.print2file`` (primdirs.py:2253-2472)
verbatim in column structure. We re-derive labels here (rather than calling the
list window) because the wx DC renderer pulls ``common.common.*`` which imports
wx (common.py:5). The math, dates, arcs and point ids all come straight from the
engine ``PrimDir`` objects.

Spec: doc/migration/surfaces/primary-directions.md
"""
from __future__ import annotations

import datetime
import copy
import math
import sys
import threading
import types
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrology
import arabicparts
import chart
import common
import customerpd
import dateformat
import fixstars
import fortune
import houses
import mtexts
import planets
import primdirs
import symbolic_time
import util
from primdirs import PrimDir, PrimDirs
from engine import moment
from engine import symbolic_projection
from engine.supplementary_headless_driver import SupplementaryHeadlessDriver
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import (
    aspect_color_role,
    effective_display_options,
    object_glyph_color,
    object_glyph_color_role,
    sign_color_role,
)
from webapp.daemon.primdir_points import (
    primdir_angle_label,
    primdir_house_cusp_label,
    primdir_planet_id,
    primdir_point_glyph,
)
from webapp.daemon.supplementary_service import supplementary_service
from webapp.frontend.scripts import export_chart_json


_CONTEXT_SIG_KEY = "context_sig"
_NATAL_PROMISSOR_KEY_PREFIX = "natal_radix:"
_NATAL_PROMISSOR_MARKER = "n"

_TEXT_COLOR_ROLE = "--morinus-text-bright"
_PEREGRIN_COLOR_ROLE = "--morinus-peregrin"


def _is_natal_radix_promissor_key(key: Any) -> bool:
    return isinstance(key, str) and key.startswith(_NATAL_PROMISSOR_KEY_PREFIX)


def _body_label(body_id: Any) -> str:
    keys = (
        "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter",
        "Saturn", "Uranus", "Neptune", "Pluto", "AscNode", "DescNode",
    )
    try:
        body_index = int(body_id)
    except (TypeError, ValueError):
        return str(body_id or "")
    if 0 <= body_index < len(keys):
        key = keys[body_index]
        return mtexts.txts.get(key, key)
    if body_index == astrology.SE_CHIRON:
        return mtexts.txts.get("Chiron", "Chiron")
    return str(body_id)


def _display_date_from_iso(value: Optional[str], options=None) -> Optional[str]:
    if not value:
        return None
    try:
        y, m, d = [int(part) for part in str(value)[:10].split("-")]
    except Exception:
        return value
    return dateformat.date_text(y, m, d, options)


def _natal_radix_promissor_specs(radix, target_chart, options) -> list[dict[str, Any]]:
    if radix is None or target_chart is None:
        return []
    specs: list[dict[str, Any]] = []
    promplanets = list(getattr(options, "promplanets", []) or [])
    for body_id, enabled in enumerate(promplanets):
        if not enabled:
            continue
        body = common.get_chart_planet(radix, body_id)
        if body is None:
            continue
        try:
            lon = float(body.data[planets.Planet.LONG])
            lat = float(body.data[planets.Planet.LAT])
            point = customerpd.CustomerPD.from_ecliptic_longitude(
                lon,
                target_chart.place.lat,
                target_chart.houses.ascmc2,
                target_chart.obl[0],
                target_chart.raequasc,
                lat,
            )
        except Exception:
            continue
        specs.append({
            "key": f"{_NATAL_PROMISSOR_KEY_PREFIX}{body_id}",
            "bodyId": int(body_id),
            "label": _body_label(int(body_id)),
            "point": point,
        })
    if getattr(options, "pdpromchiron", False):
        body = common.get_chart_planet(radix, astrology.SE_CHIRON)
        if body is not None:
            try:
                point = customerpd.CustomerPD.from_ecliptic_longitude(
                    float(body.data[planets.Planet.LONG]),
                    target_chart.place.lat,
                    target_chart.houses.ascmc2,
                    target_chart.obl[0],
                    target_chart.raequasc,
                    float(body.data[planets.Planet.LAT]),
                )
                specs.append({
                    "key": f"{_NATAL_PROMISSOR_KEY_PREFIX}{astrology.SE_CHIRON}",
                    "bodyId": int(astrology.SE_CHIRON),
                    "label": _body_label(astrology.SE_CHIRON),
                    "point": point,
                })
            except Exception:
                pass
    return specs


@contextmanager
def _temporary_natal_radix_promissors(chrt, radix, options):
    specs = _natal_radix_promissor_specs(radix, chrt, options)
    if chrt is None or not specs:
        yield []
        return
    labels = {spec["key"]: spec["label"] for spec in specs}
    by_key = {spec["key"]: spec for spec in specs}
    original_label = getattr(chrt, "get_pd_dynamic_point_label")
    original_specs = getattr(chrt, "pd_natal_radix_promissor_specs", None)

    def get_pd_dynamic_point_label_override(self, key, promissor):
        if promissor and key in labels:
            return f"{_NATAL_PROMISSOR_MARKER} {labels[key]}"
        return original_label(key, promissor)

    chrt.get_pd_dynamic_point_label = types.MethodType(
        get_pd_dynamic_point_label_override,
        chrt,
    )
    chrt.pd_natal_radix_promissor_specs = by_key
    try:
        yield specs
    finally:
        chrt.get_pd_dynamic_point_label = original_label
        chrt.pd_natal_radix_promissor_specs = original_specs


def _natal_promissor_spec(chrt, key: Any) -> Optional[dict[str, Any]]:
    if not _is_natal_radix_promissor_key(key):
        return None
    specs = getattr(chrt, "pd_natal_radix_promissor_specs", None)
    if isinstance(specs, dict):
        item = specs.get(key)
        if isinstance(item, dict):
            return item
    return None


def _natal_marker_part(color: Any = None) -> dict[str, Any]:
    return {
        "text": _NATAL_PROMISSOR_MARKER,
        "glyph": False,
        "marker": "natal",
        "color": _rgb_css(color) if color is not None else None,
        "colorRole": _TEXT_COLOR_ROLE,
    }


def _append_natal_radix_promissor_directions(pds, radix) -> None:
    specs = getattr(pds.chart, "pd_natal_radix_promissor_specs", None)
    if not isinstance(specs, dict) or not specs:
        return

    def run_for_spec(spec: dict[str, Any], methods: list[Any]) -> None:
        pds._active_dynamic_prom_key = spec["key"]
        pds._active_dynamic_prom_point = spec["point"]
        try:
            for method in methods:
                method()
        finally:
            pds._active_dynamic_prom_key = None
            pds._active_dynamic_prom_point = None

    def zod_ascmc_method(spec: dict[str, Any]):
        def method() -> None:
            point = spec["point"]
            lon = point.speculums[PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LONG]
            lat = point.speculums[PrimDirs.PLACSPECULUM][customerpd.CustomerPD.LAT]
            pds.toZodAscMC(lon, lat, PrimDir.CUSTOMERPD, 0)
        return method

    for spec in specs.values():
        if pds.options.subprimarydir in (PrimDirs.MUNDANE, PrimDirs.BOTH):
            methods = [lambda: pds.calcCustomer2AscMC(True), lambda: pds.calcCustomerPlanetary(True)]
            if pds.options.primarydir == PrimDirs.PLACIDIANSEMIARC and getattr(pds.options, "pdlof", [False, False])[1]:
                methods.append(pds.calcCustomer2MLoF)
            if getattr(pds.options, "sighouses", False) and pds._house_cusp_significators_available():
                if pds._use_global_house_cusp_significators():
                    methods.append(lambda: pds.calcCustomer2GlobalHouseCusps(True))
                else:
                    methods.append(lambda: pds.calcCustomer2HouseCusps(True))
            run_for_spec(spec, methods)
        if pds.options.subprimarydir in (PrimDirs.ZODIACAL, PrimDirs.BOTH):
            methods = [zod_ascmc_method(spec), lambda: pds.calcCustomerPlanetary(False)]
            if getattr(pds.options, "pdcusppromissors", False):
                methods.append(pds.calcZodCustomerPromAsps2Planets)
            if getattr(pds.options, "pdlof", [False, False])[1]:
                methods.append(pds.calcZodCustomer2LoF)
            if getattr(pds.options, "pdsyzygy", False):
                methods.append(pds.calcZodCustomer2Syzygy)
            if getattr(pds.options, "sighouses", False) and pds._house_cusp_significators_available():
                if pds._use_global_house_cusp_significators():
                    methods.append(lambda: pds.calcCustomer2GlobalHouseCusps(False))
                else:
                    methods.append(lambda: pds.calcCustomer2HouseCusps(False))
            run_for_spec(spec, methods)
    pds.pds.sort(key=lambda pd: pd.time)


def normalize_custom_significator(spec: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(spec, dict):
        return None
    try:
        lon = util.normalize(float(spec.get("longitude")))
    except (TypeError, ValueError):
        return None
    try:
        lat = float(spec.get("latitude", 0.0) or 0.0)
    except (TypeError, ValueError):
        lat = 0.0
    lat = max(-90.0, min(90.0, lat))
    label = str(spec.get("label") or "").strip() or mtexts.txts.get("User2", "User")
    out: dict[str, Any] = {
        "id": str(spec.get("id") or "custom:context"),
        "label": label,
        "longitude": lon,
        "latitude": lat,
        "only": bool(spec.get("only", True)),
    }
    for key in ("display_glyph", "display_marker"):
        value = str(spec.get(key) or "")
        if value:
            out[key] = value
    segments = spec.get("display_segments")
    if isinstance(segments, list):
        out["display_segments"] = [item for item in segments if isinstance(item, dict)]
    try:
        out["display_planet_id"] = int(spec.get("display_planet_id"))
    except (TypeError, ValueError):
        pass
    return out


def _options_for_custom_significator(options, spec: Optional[dict[str, Any]]):
    normalized = normalize_custom_significator(spec)
    if normalized is None:
        return options, None
    opts = copy.copy(options)
    if normalized.get("only", True):
        for attr in ("sigplanets", "sigangles", "sigascmc"):
            value = getattr(options, attr, None)
            if isinstance(value, list):
                setattr(opts, attr, [False] * len(value))
        try:
            opts.sighouses = False
        except Exception:
            pass
        try:
            opts.pdlof = [bool(options.pdlof[0]), False]
        except Exception:
            pass
        for attr in ("pdsyzygy", "pdsigchiron", "pdsigvertex", "pdsigarabicparts"):
            try:
                setattr(opts, attr, False)
            except Exception:
                pass
    try:
        opts.pdcustomer2 = True
    except Exception:
        pass
    return opts, normalized


@contextmanager
def _temporary_custom_significator(chrt, spec: Optional[dict[str, Any]]):
    normalized = normalize_custom_significator(spec)
    if normalized is None or chrt is None:
        yield None
        return
    try:
        point = customerpd.CustomerPD.from_ecliptic_longitude(
            normalized["longitude"],
            chrt.place.lat,
            chrt.houses.ascmc2,
            chrt.obl[0],
            chrt.raequasc,
            normalized.get("latitude", 0.0),
        )
    except Exception:
        yield None
        return

    original_iter = getattr(chrt, "iter_pd_significator_points")
    original_label = getattr(chrt, "get_pd_dynamic_point_label")
    original_cpd2 = getattr(chrt, "cpd2", None)
    original_context_spec = getattr(chrt, "pd_context_significator_spec", None)
    only = bool(normalized.get("only", True))
    label = str(normalized.get("label") or mtexts.txts.get("User2", "User"))

    def iter_pd_significator_points_override(self):
        points = [] if only else list(original_iter())
        points.append((_CONTEXT_SIG_KEY, point))
        return points

    def get_pd_dynamic_point_label_override(self, key, promissor):
        if key == _CONTEXT_SIG_KEY or (only and key == "user_sig" and not promissor):
            return label
        return original_label(key, promissor)

    chrt.iter_pd_significator_points = types.MethodType(
        iter_pd_significator_points_override,
        chrt,
    )
    chrt.get_pd_dynamic_point_label = types.MethodType(
        get_pd_dynamic_point_label_override,
        chrt,
    )
    if only:
        chrt.cpd2 = point
    chrt.pd_context_significator_spec = normalized
    try:
        yield normalized
    finally:
        chrt.iter_pd_significator_points = original_iter
        chrt.get_pd_dynamic_point_label = original_label
        chrt.cpd2 = original_cpd2
        chrt.pd_context_significator_spec = original_context_spec


@contextmanager
def _temporary_radix_direction_chart(chrt):
    """Run the standard Primary Directions path as radix-style directions.

    The engine's ``PrimDirs.create`` uses ``chart.htype == RADIX`` as the switch
    for natal/radix timing; saved event charts such as horary records can keep
    their own semantic htype, but the plain Primary Directions list should not
    silently fall into the revolution branch. SR/LR modes still call the annual
    endpoint with real return charts.
    """
    if chrt is None or getattr(chrt, "htype", None) == chart.Chart.RADIX:
        yield
        return
    original_htype = getattr(chrt, "htype", None)
    try:
        chrt.htype = chart.Chart.RADIX
        yield
    finally:
        chrt.htype = original_htype


# --- Label tables (mirror PrimDirs.print2file, primdirs.py:2254-2260) ---------

def _bodies() -> tuple:
    t = mtexts.txts
    return (
        t['Sun'], t['Moon'], t['Mercury'], t['Venus'], t['Mars'], t['Jupiter'],
        t['Saturn'], t['Uranus'], t['Neptune'], t['Pluto'], t['AscNode'], t['DescNode'],
        'Asc', mtexts.txts.get('Desc', 'Desc'), 'MC', 'IC', 'HC2', 'HC3', 'HC5', 'HC6', 'HC8', 'HC9', 'HC11', 'HC12',
        t['LoF'], t['Syzygy'], t['Customer2'],
    )


def _signs() -> tuple:
    t = mtexts.txts
    return tuple(
        '(%s)' % t.get(k, k)
        for k in ('Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                  'Libra', 'Scorpio', 'Sagittarius', 'Capricornus', 'Aquarius', 'Pisces')
    )


def _aspects() -> tuple:
    t = mtexts.txts
    return (
        t['Conjunctio'], t['Semisextil'], t['Semiquadrat'], t['Sextil'], t['Quintile'],
        t['Quadrat'], t['Trigon'], t['Sesquiquadrat'], t['Biquintile'], t['Quinqunx'],
        t['Oppositio'], t['Parallel'], t['Contraparallel'], t['RaptParallel'],
        t['RaptParallel'], t['MidPoint'],
    )


def _short_direction_body(label: Any, key: Optional[str] = None) -> str:
    """Compact a localized body label for a chart title (Ven, Mon, Mer, …)."""
    value = str(label or "").strip()
    if not value:
        return ""
    # ``Mon`` is the established Aries/Marr abbreviation for English Moon;
    # slicing "Moon" would produce the misleading ``Moo``.
    if key == "Moon":
        return mtexts.txts.get("MoonAbbrev", "Mon")
    if len(value) <= 3:
        return value
    return value[:3]


def _compact_direction_subject(label: Any) -> str:
    """Abbreviate known localized bodies/signs while preserving special points."""
    value = str(label or "").strip()
    if not value:
        return ""
    replacements: list[tuple[str, str]] = []
    for key in (
        "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter",
        "Saturn", "Uranus", "Neptune", "Pluto", "AscNode", "DescNode",
    ):
        full = str(mtexts.txts.get(key, key) or "").strip()
        if full:
            replacements.append((full, _short_direction_body(full, key)))
    for full_key, short_key in zip(
        (
            "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
            "Libra", "Scorpio", "Sagittarius", "Capricornus", "Aquarius", "Pisces",
        ),
        ("Ari", "Tau", "Gem", "Can", "Leo2", "Vir", "Lib", "Sco", "Sag", "Cap", "Aqu", "Pis"),
    ):
        full = str(mtexts.txts.get(full_key, full_key) or "").strip()
        short = str(mtexts.txts.get(short_key, short_key) or "").strip()
        if full and short:
            replacements.append((full, short))
    for full, short in sorted(replacements, key=lambda item: len(item[0]), reverse=True):
        value = value.replace(full, short)
    return " ".join(value.split())


def _short_direction_aspect(label: Any) -> str:
    """Compact a localized aspect word without replacing it by a glyph/code."""
    value = str(label or "").strip()
    if not value:
        return ""
    if value.endswith(".") or len(value) <= 3:
        return value.lower()
    return value[:3].lower() + "."


def _without_leading_direction_aspect(label: Any) -> str:
    value = str(label or "").strip()
    for aspect in sorted((str(item or "").strip() for item in _aspects()), key=len, reverse=True):
        if not aspect:
            continue
        if value == aspect:
            return ""
        prefix = aspect + " "
        if value.startswith(prefix):
            return value[len(prefix):].strip()
    return value


def _direction_event_session_label(prom: Any, aspect: Any, sig: Any) -> str:
    """Human chart name for one direction hit, e.g. ``Ven con. Mon``."""
    prom_text = _compact_direction_subject(_without_leading_direction_aspect(prom))
    sig_text = _compact_direction_subject(_without_leading_direction_aspect(sig))
    relation = _short_direction_aspect(aspect)
    return " ".join(part for part in (prom_text, relation, sig_text) if part)


def _primary_direction_session_label(pd, prom_label: str, sig_label: str) -> str:
    sig_aspect = int(pd.sigasp)
    if sig_aspect in {
        chart.Chart.PARALLEL,
        chart.Chart.CONTRAPARALLEL,
        chart.Chart.RAPTPAR,
        chart.Chart.RAPTCONTRAPAR,
    }:
        aspect_index = sig_aspect
    else:
        aspect_index = int(pd.promasp)
    if aspect_index == chart.Chart.CONJUNCTIO and sig_aspect != chart.Chart.CONJUNCTIO:
        aspect_index = sig_aspect
    aspects = _aspects()
    aspect_label = aspects[aspect_index] if 0 <= aspect_index < len(aspects) else aspects[chart.Chart.CONJUNCTIO]
    return _direction_event_session_label(prom_label, aspect_label, sig_label)


def _system_label(options) -> str:
    # mtexts.typeListDirs is the canonical PD-system label tuple the wx frame
    # uses for the progress/header text (primdirslistframe.py:361).
    idx = int(getattr(options, 'primarydir', 0))
    if 0 <= idx < len(mtexts.typeListDirs):
        return mtexts.typeListDirs[idx]
    return ''


def _key_label(options) -> str:
    t = mtexts.txts
    if getattr(options, 'pdkeydyn', False):
        dyn = (t['TrueSolarEquatorialArc'], t['BirthdaySolarEquatorialArc'],
               t['TrueSolarEclipticalArc'], t['BirthdaySolarEclipticalArc'])
        return dyn[int(options.pdkeyd)]
    stat = (t['Naibod'], t['Cardan'], t['Ptolemy'], t['Customer'])
    deg, minu, sec = options.pdkeydeg, options.pdkeymin, options.pdkeysec
    if int(options.pdkeys) != PrimDirs.CUSTOMER:
        deg = PrimDirs.staticData[options.pdkeys][PrimDirs.DEG]
        minu = PrimDirs.staticData[options.pdkeys][PrimDirs.MIN]
        sec = PrimDirs.staticData[options.pdkeys][PrimDirs.SEC]
    return '%s %d%s %s%s %s%s' % (
        stat[int(options.pdkeys)], deg, t['DegPDList'],
        str(minu).zfill(2), t['MinPDList'], str(sec).zfill(2), t['SecPDList'],
    )


def _prom_label(pds, pd) -> str:
    """Promissor column text. Mirrors print2file prom branches (primdirs.py:2301-2395)."""
    bodies = _bodies()
    aspects = _aspects()
    chrt = pds.chart
    options = pds.options

    parts: list[str] = []
    if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp == chart.Chart.RAPTPAR or pd.sigasp == chart.Chart.RAPTCONTRAPAR:
        prom = pds._format_pd_body_label(pd.prom, True, pd.promdyn, body_context=True) or bodies[pd.prom]
        prom2 = pds._format_pd_body_label(pd.prom2, True, pd.promdyn, body_context=True) or bodies[pd.prom2]
        parts += [prom, prom2]
    elif PrimDir.ANTISCION <= pd.prom < PrimDir.TERM:
        if pd.promasp != chart.Chart.CONJUNCTIO:
            parts.append(aspects[pd.promasp])
        anttxt = mtexts.txts['Antiscion']
        if pd.prom >= PrimDir.CONTRAANT:
            anttxt = mtexts.txts['Contraantiscion']
        parts.append(anttxt)
        antoffs = PrimDir.CONTRAANT if pd.prom >= PrimDir.CONTRAANT else PrimDir.ANTISCION
        if pd.prom in (PrimDir.ANTISCIONASC, PrimDir.CONTRAANTASC):
            parts.append(mtexts.txts['Asc'])
        elif pd.prom in (PrimDir.ANTISCIONMC, PrimDir.CONTRAANTMC):
            parts.append(mtexts.txts['MC'])
        else:
            parts.append(bodies[pd.prom - antoffs])
    elif PrimDir.TERM <= pd.prom < PrimDir.FIXSTAR:
        parts += [_signs()[pd.prom - PrimDir.TERM], bodies[pd.prom2]]
    elif pd.prom >= PrimDir.FIXSTAR:
        code = chrt.fixstars.data[pd.prom - PrimDir.FIXSTAR][fixstars.FixStars.NOMNAME]
        raw = chrt.fixstars.data[pd.prom - PrimDir.FIXSTAR][fixstars.FixStars.NAME]
        if getattr(options, 'usetradfixstarnamespdlist', False):
            fallback = (raw or '').strip() or raw or code
            parts.append(astrology.display_fixstar_name(code, options, fallback))
        else:
            parts.append(code)
    elif pd.prom == PrimDir.LOF:
        parts.append(bodies[pd.prom])
    elif pd.prom == PrimDir.CUSTOMERPD:
        parts.append(pds._get_dynamic_point_label(pd.promdyn, True))
    elif (angle_label := primdir_angle_label(pd.prom)) is not None:
        if pd.promasp != chart.Chart.CONJUNCTIO:
            parts.append(aspects[pd.promasp])
        parts.append(angle_label)
    elif (house_cusp_label := primdir_house_cusp_label(pd.prom)) is not None:
        parts.append(house_cusp_label)
    else:
        if pd.promasp != chart.Chart.CONJUNCTIO:
            parts.append(aspects[pd.promasp])
        parts.append(pds._format_pd_body_label(pd.prom, True, pd.promdyn) or bodies[pd.prom])
    return ' '.join(p for p in parts if p)


def _sig_label(pds, pd) -> str:
    """Significator column text. Mirrors print2file sig branches (primdirs.py:2402-2454)."""
    bodies = _bodies()
    aspects = _aspects()
    parts: list[str] = []
    if pd.sigasp in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL):
        partxt = mtexts.txts['Parallel']
        if pd.parallelaxis == 0 and pd.sigasp == chart.Chart.CONTRAPARALLEL:
            partxt = mtexts.txts['Contraparallel']
        parts.append(partxt)
        parts.append(pds._format_pd_body_label(pd.sig, False, pd.sigdyn) or bodies[pd.sig])
        if pd.parallelaxis != 0:
            angle_label = primdir_angle_label(pd.parallelaxis, parens=True)
            if angle_label is not None:
                parts.append(angle_label)
    elif pd.sigasp in (chart.Chart.RAPTPAR, chart.Chart.RAPTCONTRAPAR):
        parts.append(mtexts.txts['RaptParallel'])
        angle_label = primdir_angle_label(pd.parallelaxis, parens=True)
        if angle_label is not None:
            parts.append(angle_label)
    elif pd.sig == PrimDir.LOF:
        if pd.mundane and pd.sigasp != chart.Chart.CONJUNCTIO:
            parts.append(aspects[pd.sigasp])
        parts.append(mtexts.txts['LoF'])
    elif pd.sig == PrimDir.SYZ:
        parts.append(bodies[pd.sig])
    elif pd.sig == PrimDir.CUSTOMERPD:
        parts.append(pds._get_dynamic_point_label(pd.sigdyn, False))
    elif (angle_label := primdir_angle_label(pd.sig)) is not None:
        parts.append(angle_label)
    elif (house_cusp_label := primdir_house_cusp_label(pd.sig)) is not None:
        parts.append(house_cusp_label)
    else:
        if pd.sigasp != chart.Chart.CONJUNCTIO:
            parts.append(aspects[pd.sigasp])
        parts.append(pds._format_pd_body_label(pd.sig, False, pd.sigdyn) or bodies[pd.sig])
    return ' '.join(p for p in parts if p)


def _row(
    pds,
    pd,
    radix_jd: Optional[float],
    reference_chart=None,
    *,
    display_options=None,
) -> dict:
    # pd.time is a UT Julian day; the displayed Date column must be LOCAL civil
    # (policy-chart-lifecycle display rule). wx shows the raw UT digits here
    # (primdirslistwnd.py:166) — deliberate documented divergence, matching the
    # timed-row open fix so the row date and the opened chart agree.
    y, m, d, ut_hour = astrology.swe_revjul(float(pd.time), 1)
    ho, mi, se = util.decToDeg(ut_hour)
    local = moment.utc_to_chart_local(
        getattr(reference_chart, "time", None),
        (y, m, d, ho, mi, se),
        place=getattr(reference_chart, "place", None),
    )
    if local is not None:
        y, m, d = local[0], local[1], local[2]
    presentation = display_options if display_options is not None else pds.options
    age = None
    if radix_jd is not None:
        age = max(0.0, (float(pd.time) - float(radix_jd)) / 365.2425)
    natal_promissor = _natal_promissor_spec(pds.chart, getattr(pd, "promdyn", None))
    prom_source: Optional[str] = None
    prom_source_marker: Optional[str] = None
    prom_source_body_id: Optional[int] = None
    if natal_promissor is not None:
        prom_source = "natal_radix"
        prom_source_marker = _NATAL_PROMISSOR_MARKER
        try:
            prom_source_body_id = int(natal_promissor.get("bodyId"))
        except Exception:
            prom_source_body_id = None
    date_iso = "%04d-%02d-%02d" % (int(y), int(m), int(d))
    prom_label = _prom_label(pds, pd)
    sig_label = _sig_label(pds, pd)
    return {
        # Rendered text cells (MZ / Prom / DC / Sig / Arc / Date), the wx columns
        "mz": mtexts.txts['M'] if pd.mundane else mtexts.txts['Z'],
        "prom": prom_label,
        "dc": mtexts.txts['D'] if pd.direct else mtexts.txts['C'],
        "sig": sig_label,
        "sessionLabel": _primary_direction_session_label(pd, prom_label, sig_label),
        "arc": round(float(pd.arc), 6),
        "date": date_iso,
        "displayDate": dateformat.date_text(int(y), int(m), int(d), getattr(pds, "options", None)),
        "age": round(age, 4) if age is not None else None,
        # Raw engine fields so the React table can map ids -> Morinus glyphs.
        "fields": {
            "mundane": bool(pd.mundane),
            "direct": bool(pd.direct),
            "prom": int(pd.prom),
            "prom2": int(pd.prom2),
            "promasp": int(pd.promasp),
            "sigPoint": int(pd.sig),
            "sigasp": int(pd.sigasp),
            "parallelaxis": int(pd.parallelaxis),
            # Keep calculation precision for row-open actions.  The top-level
            # value is rounded only for stable table display/serialization.
            "arc": float(pd.arc),
            "jd": float(pd.time),
            "promGlyph": _primdir_point_glyph(pd.prom),
            "prom2Glyph": _primdir_point_glyph(pd.prom2),
            "sigGlyph": _primdir_point_glyph(pd.sig),
            "promParts": _primdir_prom_parts(pds, pd, display_options=presentation),
            "sigParts": _primdir_sig_parts(pds, pd, display_options=presentation),
            "promAspectGlyph": _aspect_glyph(pd.promasp),
            "sigAspectGlyph": _aspect_glyph(pd.sigasp),
            "promColor": _rgb_css(_primdir_point_color(pds.chart, presentation, pd.prom)),
            "prom2Color": _rgb_css(_primdir_point_color(pds.chart, presentation, pd.prom2)),
            "sigColor": _rgb_css(_primdir_point_color(pds.chart, presentation, pd.sig)),
            "promAspectColor": _rgb_css(_aspect_color(presentation, pd.promasp)),
            "sigAspectColor": _rgb_css(_aspect_color(presentation, pd.sigasp)),
            "promColorRole": _primdir_point_color_role(pds.chart, presentation, pd.prom),
            "prom2ColorRole": _primdir_point_color_role(pds.chart, presentation, pd.prom2),
            "sigColorRole": _primdir_point_color_role(pds.chart, presentation, pd.sig),
            "promAspectColorRole": _aspect_color_role(presentation, pd.promasp),
            "sigAspectColorRole": _aspect_color_role(presentation, pd.sigasp),
            "promSource": prom_source,
            "promSourceMarker": prom_source_marker,
            "promSourceBodyId": prom_source_body_id,
        },
        "signature": list(symbolic_projection.pd_entry_signature(pd) or []),
    }


def _meta(options, range_mode: int, direction: int, chrt, title: str) -> dict:
    return {
        "title": title,
        "columns": [mtexts.txts['MZ'], mtexts.txts['Prom'], mtexts.txts['DC'],
                    mtexts.txts['Sig'], mtexts.txts['Arc'], mtexts.txts['Date']],
        "system": _system_label(options),
        "key": _key_label(options),
        "subprimarydir": int(getattr(options, 'subprimarydir', 0)),
        "rangeMode": int(range_mode),
        "direction": int(direction),
        "htype": int(getattr(chrt, 'htype', 0)),
        "listGlyphColors": bool(getattr(options, "pdlistglyphcolors", False)),
    }


def _project(chrt, options, range_mode: int, direction: int) -> Any:
    abort = primdirs.AbortPD()
    projection = symbolic_projection.project_symbolic_table(
        symbolic_projection.PRIMARY_DIRECTIONS,
        chrt,
        options,
        abort=abort,
        default_range=range_mode,
        default_direction=direction,
    )
    return projection["content"]


def _planet_glyph(planet_id: Any) -> Optional[str]:
    try:
        glyph = export_chart_json.common.common.get_planet_glyph(int(planet_id))
    except Exception:
        return None
    return glyph or None


def _rgb_css(value: Any) -> str:
    try:
        r, g, b = list(value)[:3]
        return "#%02x%02x%02x" % (
            max(0, min(255, int(r))),
            max(0, min(255, int(g))),
            max(0, min(255, int(b))),
        )
    except Exception:
        return "#000000"


def _text_color(options) -> Any:
    return getattr(options, "clrtexts", (0, 0, 0))


def _dignity_palette(options) -> tuple:
    return (
        getattr(options, "clrdomicil", (0, 0, 0)),
        getattr(options, "clrexal", (0, 0, 0)),
        getattr(options, "clrperegrin", (0, 0, 0)),
        getattr(options, "clrcasus", (0, 0, 0)),
        getattr(options, "clrexil", (0, 0, 0)),
    )


def _planet_color_role(chrt, options, planet_id: Any) -> Optional[str]:
    try:
        planet_id = int(planet_id)
    except Exception:
        return _TEXT_COLOR_ROLE
    if planet_id == PrimDir.LOF:
        return _lof_color_role(options)
    try:
        dignity_code = int(chrt.dignity(planet_id))
    except Exception:
        dignity_code = chart.Chart.PEREGRIN
    return object_glyph_color_role(
        options,
        types.SimpleNamespace(id=f"planet:{planet_id}", planet_index=planet_id),
        dignity_code,
        resolved_color=_planet_color(chrt, options, planet_id),
    )


def _planet_color(chrt, options, planet_id: Any) -> Any:
    try:
        planet_id = int(planet_id)
    except Exception:
        return _text_color(options)
    if planet_id == PrimDir.LOF:
        return _lof_color(options)
    if planet_id == astrology.SE_CHIRON:
        return _chiron_color(options)
    if getattr(options, "useplanetcolors", False):
        objidx = planet_id
        if objidx > astrology.SE_MEAN_NODE:
            objidx = astrology.SE_MEAN_NODE
        try:
            return options.clrindividual[objidx]
        except Exception:
            return _text_color(options)
    try:
        dign = int(chrt.dignity(planet_id))
        return _dignity_palette(options)[dign]
    except Exception:
        return getattr(options, "clrperegrin", _text_color(options))


def _primdir_point_color(chrt, options, point_id: Any) -> Any:
    try:
        point_id = int(point_id)
    except Exception:
        return _text_color(options)
    if point_id == PrimDir.LOF:
        return _lof_color(options)
    planet_id = primdir_planet_id(point_id)
    if planet_id is not None:
        return _planet_color(chrt, options, planet_id)
    return _text_color(options)


def _primdir_point_color_role(chrt, options, point_id: Any) -> Optional[str]:
    try:
        point_id = int(point_id)
    except Exception:
        return _TEXT_COLOR_ROLE
    if point_id == PrimDir.LOF:
        return _lof_color_role(options)
    planet_id = primdir_planet_id(point_id)
    if planet_id is not None:
        return _planet_color_role(chrt, options, planet_id)
    return _TEXT_COLOR_ROLE


def _antiscion_planet_color(chrt, options, planet_id: Any) -> Any:
    try:
        planet_id = int(planet_id)
    except Exception:
        return _text_color(options)
    if getattr(options, "useplanetcolors", False):
        objidx = planet_id
        if objidx == astrology.SE_MEAN_NODE + 1:
            objidx = astrology.SE_MEAN_NODE
        elif objidx > astrology.SE_MEAN_NODE + 1:
            objidx = astrology.SE_MEAN_NODE + 1
        try:
            return options.clrindividual[objidx]
        except Exception:
            return _text_color(options)
    try:
        dign = int(chrt.dignity(planet_id))
        return _dignity_palette(options)[dign]
    except Exception:
        return getattr(options, "clrperegrin", _text_color(options))


def _antiscion_planet_color_role(chrt, options, planet_id: Any) -> Optional[str]:
    try:
        planet_id = int(planet_id)
        dignity_code = int(chrt.dignity(planet_id))
    except Exception:
        return None
    return object_glyph_color_role(
        options,
        types.SimpleNamespace(id=f"planet:{planet_id}", planet_index=planet_id),
        dignity_code,
        resolved_color=_antiscion_planet_color(chrt, options, planet_id),
    )


def _aspect_color(options, aspect_id: Any) -> Any:
    try:
        aspect_id = int(aspect_id)
    except Exception:
        return _text_color(options)
    if aspect_id in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL):
        return getattr(options, "clrperegrin", _text_color(options))
    try:
        return options.clraspect[aspect_id]
    except Exception:
        return _text_color(options)


def _aspect_color_role(options, aspect_id: Any) -> Optional[str]:
    resolved = _aspect_color(options, aspect_id)
    role = aspect_color_role(
        options,
        aspect_id,
        resolved_color=resolved,
    )
    if role is not None:
        return role
    if _rgb_css(resolved) == _rgb_css(getattr(options, "clrperegrin", None)):
        return _PEREGRIN_COLOR_ROLE
    return None


def _lof_color(options) -> Any:
    if getattr(options, "useplanetcolors", False):
        try:
            return options.clrindividual[astrology.SE_MEAN_NODE + 1]
        except Exception:
            pass
    return getattr(options, "clrperegrin", _text_color(options))


def _lof_color_role(options) -> Optional[str]:
    return object_glyph_color_role(
        options,
        types.SimpleNamespace(id="point:lof", planet_index=None),
        chart.Chart.PEREGRIN,
        resolved_color=_lof_color(options),
    )


def _chiron_color(options) -> Any:
    if getattr(options, "useplanetcolors", False):
        try:
            objidx = common.common.get_planet_color_index(astrology.SE_CHIRON)
            return options.clrindividual[min(objidx, len(options.clrindividual) - 1)]
        except Exception:
            pass
    return getattr(options, "clrperegrin", _text_color(options))


def _chiron_color_role(options) -> Optional[str]:
    return object_glyph_color_role(
        options,
        types.SimpleNamespace(id="planet:chiron", planet_index=astrology.SE_CHIRON),
        chart.Chart.PEREGRIN,
        resolved_color=_chiron_color(options),
    )


def _vertex_color(options) -> Any:
    return getattr(options, "clrperegrin", _text_color(options))


def _vertex_color_role(_options) -> str:
    return _PEREGRIN_COLOR_ROLE


def _sign_color(options, sign_index: Any) -> Any:
    try:
        element = common.get_sign_element_key(int(sign_index))
    except Exception:
        return getattr(options, "clrsigns", _text_color(options))
    if element == "earth":
        return getattr(options, "clrsignelementearth", getattr(options, "clrsigns", _text_color(options)))
    if element == "air":
        return getattr(options, "clrsignelementair", getattr(options, "clrsigns", _text_color(options)))
    if element == "water":
        return getattr(options, "clrsignelementwater", getattr(options, "clrsigns", _text_color(options)))
    return getattr(options, "clrsignelementfire", getattr(options, "clrsigns", _text_color(options)))


def _sign_color_role(options, sign_index: Any) -> Optional[str]:
    resolved = _sign_color(options, sign_index)
    try:
        int(sign_index)
    except Exception:
        return sign_color_role(
            options,
            0,
            resolved_color=resolved,
        )
    return sign_color_role(
        options,
        sign_index,
        force_element=True,
        resolved_color=resolved,
    )


def _sign_glyph(options, sign_index: Any) -> Optional[str]:
    try:
        signs = common.common.Signs1 if getattr(options, "signs", True) else common.common.Signs2
        return signs[int(sign_index) % chart.Chart.SIGN_NUM]
    except Exception:
        return None


def _circum_degree_text(lon: Any) -> Optional[str]:
    try:
        value = util.normalize(float(lon))
    except Exception:
        return None
    deg, minute, _second = util.decToDeg(value)
    position = int(deg % chart.Chart.SIGN_DEG)
    return "%s°%02d'" % (str(position).rjust(2), minute)


def _aspect_glyph(aspect_id: Any) -> Optional[str]:
    try:
        aspect_id = int(aspect_id)
        glyph = common.common.Aspects[aspect_id]
    except Exception:
        return None
    return glyph or None


def _display_part(
    text: Any,
    *,
    glyph: bool = False,
    color: Any = None,
    color_role: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "text": "" if text is None else str(text),
        "glyph": bool(glyph),
        "color": _rgb_css(color) if color is not None else None,
        "colorRole": color_role,
    }


def _aspect_glyph_for_degree(aspect_deg: Any) -> Optional[str]:
    """Map a participating-hit aspect *degree value* to its Morinus glyph.

    The circumambulation brain stores the aspect as a degree value
    (circumambulation.py:700 PD mode `chart.Chart.Aspects[ph.promasp]`;
    circumambulation.py:891 ascensional mode `A` from ASPECTS=(0,60,90,120,180)).
    wx CircumWnd._aspect_glyph / set_data._aspect_glyph (circumambulationframe.py:705)
    resolve it through ``chart.Chart.Aspects`` index -> ``common.common.Aspects``.
    Transcribed here so the skin never reimplements the aspect table.
    """
    try:
        av = round(float(aspect_deg), 6)
    except Exception:
        return None
    aspects = getattr(chart.Chart, "Aspects", None)
    glyphs = getattr(export_chart_json.common.common, "Aspects", None)
    if not aspects or not glyphs:
        return None
    for idx, deg in enumerate(aspects):
        try:
            if abs(float(deg) - av) < 1e-3 and 0 <= idx < len(glyphs):
                return glyphs[idx] or None
        except Exception:
            continue
    return None


def _aspect_label_for_degree(aspect_deg: Any) -> str:
    try:
        av = round(float(aspect_deg), 6)
    except Exception:
        return mtexts.txts.get("Conjunctio", "Conjunction")
    aspects = getattr(chart.Chart, "Aspects", None)
    labels = _aspects()
    if aspects:
        for idx, deg in enumerate(aspects):
            try:
                if abs(float(deg) - av) < 1e-3 and 0 <= idx < len(labels):
                    return labels[idx]
            except Exception:
                continue
    return mtexts.txts.get("Conjunctio", "Conjunction")


def _aspect_color_for_degree(options, aspect_deg: Any) -> Any:
    try:
        av = round(float(aspect_deg), 6)
    except Exception:
        return _text_color(options)
    aspects = getattr(chart.Chart, "Aspects", None)
    if not aspects:
        return _text_color(options)
    for idx, deg in enumerate(aspects):
        try:
            if abs(float(deg) - av) < 1e-3:
                return _aspect_color(options, idx)
        except Exception:
            continue
    return _text_color(options)


def _aspect_color_role_for_degree(options, aspect_deg: Any) -> Optional[str]:
    try:
        av = round(float(aspect_deg), 6)
    except Exception:
        return None
    aspects = getattr(chart.Chart, "Aspects", None)
    if not aspects:
        return None
    for idx, deg in enumerate(aspects):
        try:
            if abs(float(deg) - av) < 1e-3:
                return _aspect_color_role(options, idx)
        except Exception:
            continue
    return None


# Inverse of circumambulation.planet_label (circumambulation.py:992): the brain
# emits participating planets as English base10 labels indexed by SE id, and
# can emit nodes as numeric labels ("10", "11"). wx _glyph_planet handles both
# numeric strings and localized names (circumambulationframe.py:1152-1173), so
# the daemon accepts the same forms before sending glyph-ready rows to React.
_CIRCUM_PLANET_LABELS = (
    ("Sun", astrology.SE_SUN),
    ("Moon", astrology.SE_MOON),
    ("Mercury", astrology.SE_MERCURY),
    ("Venus", astrology.SE_VENUS),
    ("Mars", astrology.SE_MARS),
    ("Jupiter", astrology.SE_JUPITER),
    ("Saturn", astrology.SE_SATURN),
    ("Uranus", astrology.SE_URANUS),
    ("Neptune", astrology.SE_NEPTUNE),
    ("Pluto", astrology.SE_PLUTO),
    ("AscNode", astrology.SE_MEAN_NODE),
    ("DescNode", astrology.SE_TRUE_NODE),
)


def _circum_label_key(label: str) -> str:
    return "".join(ch for ch in label.strip().lower() if ch.isalnum())


def _build_circum_label_to_se() -> dict[str, int]:
    aliases: dict[str, int] = {}

    def add(name: Any, se_id: int) -> None:
        if isinstance(name, str) and name.strip():
            aliases[_circum_label_key(name)] = se_id

    for key, se_id in _CIRCUM_PLANET_LABELS:
        add(key, se_id)
        add(mtexts.txts.get(key, key), se_id)

    for name in ("North Node", "Ascending Node", "Asc. Node", "N Node", "NN"):
        add(name, astrology.SE_MEAN_NODE)
    for name in ("South Node", "Descending Node", "Dsc. Node", "Desc. Node", "S Node", "SN"):
        add(name, astrology.SE_TRUE_NODE)
    return aliases


_CIRCUM_LABEL_TO_SE = _build_circum_label_to_se()


def _participating_planet_id(label: Any) -> Optional[int]:
    try:
        numeric = int(label)
    except Exception:
        numeric = None
    if numeric is not None and astrology.SE_SUN <= numeric <= astrology.SE_TRUE_NODE:
        return numeric
    if not isinstance(label, str):
        return None
    return _CIRCUM_LABEL_TO_SE.get(_circum_label_key(label))


def _participating_planet_glyph(label: Any) -> Optional[str]:
    se_id = _participating_planet_id(label)
    if se_id is None:
        return None
    return _planet_glyph(se_id)


def _circum_age_offset_years(radix, source_chart) -> float:
    if (
        radix is None
        or source_chart is None
        or getattr(source_chart, "htype", None) not in (chart.Chart.SOLAR, chart.Chart.LUNAR)
        or getattr(radix, "time", None) is None
        or getattr(source_chart, "time", None) is None
    ):
        return 0.0
    try:
        return max(0.0, (float(source_chart.time.jd) - float(radix.time.jd)) / 365.2425)
    except Exception:
        return 0.0


def _primdir_point_glyph(point_id: Any) -> Optional[str]:
    return primdir_point_glyph(point_id)


def _primdir_prom_parts(pds, pd, *, display_options=None) -> list[dict[str, Any]]:
    chrt = pds.chart
    options = display_options if display_options is not None else pds.options
    txt = _text_color(options)

    if pd.promasp == chart.Chart.MIDPOINT or pd.sigasp in (chart.Chart.RAPTPAR, chart.Chart.RAPTCONTRAPAR):
        return [
            _display_part(
                _planet_glyph(pd.prom),
                glyph=True,
                color=_planet_color(chrt, options, pd.prom),
                color_role=_planet_color_role(chrt, options, pd.prom),
            ),
            _display_part(
                _planet_glyph(pd.prom2),
                glyph=True,
                color=_planet_color(chrt, options, pd.prom2),
                color_role=_planet_color_role(chrt, options, pd.prom2),
            ),
        ]

    if PrimDir.ANTISCION <= pd.prom < PrimDir.TERM:
        parts: list[dict[str, Any]] = []
        if pd.promasp != chart.Chart.CONJUNCTIO:
            parts.append(_display_part(
                _aspect_glyph(pd.promasp),
                glyph=True,
                color=_aspect_color(options, pd.promasp),
                color_role=_aspect_color_role(options, pd.promasp),
            ))
        parts.append(_display_part(
            mtexts.txts['ContraAntis'] if pd.prom >= PrimDir.CONTRAANT else mtexts.txts['Antis'],
            color=txt,
            color_role=_TEXT_COLOR_ROLE,
        ))
        if pd.prom in (PrimDir.ANTISCIONLOF, PrimDir.CONTRAANTLOF):
            parts.append(_display_part(
                common.common.fortune,
                glyph=True,
                color=_lof_color(options),
                color_role=_lof_color_role(options),
            ))
        elif pd.prom in (PrimDir.ANTISCIONASC, PrimDir.CONTRAANTASC):
            parts.append(_display_part(mtexts.txts['Asc'], color=txt, color_role=_TEXT_COLOR_ROLE))
        elif pd.prom in (PrimDir.ANTISCIONMC, PrimDir.CONTRAANTMC):
            parts.append(_display_part(mtexts.txts['MC'], color=txt, color_role=_TEXT_COLOR_ROLE))
        else:
            antoffs = PrimDir.CONTRAANT if pd.prom >= PrimDir.CONTRAANT else PrimDir.ANTISCION
            planet_id = pd.prom - antoffs
            parts.append(_display_part(
                _planet_glyph(planet_id),
                glyph=True,
                color=_antiscion_planet_color(chrt, options, planet_id),
                color_role=_antiscion_planet_color_role(chrt, options, planet_id),
            ))
        return [p for p in parts if p.get("text")]

    if PrimDir.TERM <= pd.prom < PrimDir.FIXSTAR:
        sign_idx = pd.prom - PrimDir.TERM
        return [
            _display_part(
                _sign_glyph(options, sign_idx),
                glyph=True,
                color=_sign_color(options, sign_idx),
                color_role=_sign_color_role(options, sign_idx),
            ),
            _display_part(
                _planet_glyph(pd.prom2),
                glyph=True,
                color=_planet_color(chrt, options, pd.prom2),
                color_role=_planet_color_role(chrt, options, pd.prom2),
            ),
        ]

    if pd.prom >= PrimDir.FIXSTAR:
        return [_display_part(_prom_label(pds, pd), color=txt, color_role=_TEXT_COLOR_ROLE)]

    if pd.prom == PrimDir.LOF:
        return [_display_part(
            common.common.fortune,
            glyph=True,
            color=_lof_color(options),
            color_role=_lof_color_role(options),
        )]

    if pd.prom == PrimDir.CUSTOMERPD:
        natal = _natal_promissor_spec(chrt, getattr(pd, "promdyn", None))
        if natal is not None:
            body_id = int(natal.get("bodyId", -1))
            return [
                _natal_marker_part(_text_color(options)),
                _display_part(
                    _planet_glyph(body_id),
                    glyph=True,
                    color=_planet_color(chrt, options, body_id),
                    color_role=_planet_color_role(chrt, options, body_id),
                ),
            ]
        if getattr(pd, 'promdyn', None) == 'chiron':
            return [_display_part(
                _planet_glyph(astrology.SE_CHIRON),
                glyph=True,
                color=_chiron_color(options),
                color_role=_chiron_color_role(options),
            )]
        return [_display_part(
            pds._get_dynamic_point_label(pd.promdyn, True),
            color=txt,
            color_role=_TEXT_COLOR_ROLE,
        )]

    if (angle_label := primdir_angle_label(pd.prom)) is not None:
        parts = []
        if pd.promasp != chart.Chart.CONJUNCTIO:
            parts.append(_display_part(
                _aspect_glyph(pd.promasp),
                glyph=True,
                color=_aspect_color(options, pd.promasp),
                color_role=_aspect_color_role(options, pd.promasp),
            ))
        parts.append(_display_part(angle_label, color=txt, color_role=_TEXT_COLOR_ROLE))
        return [p for p in parts if p.get("text")]

    if (house_cusp_label := primdir_house_cusp_label(pd.prom)) is not None:
        return [_display_part(house_cusp_label, color=txt, color_role=_TEXT_COLOR_ROLE)]

    parts = []
    if pd.promasp != chart.Chart.CONJUNCTIO:
        parts.append(_display_part(
            _aspect_glyph(pd.promasp),
            glyph=True,
            color=_aspect_color(options, pd.promasp),
            color_role=_aspect_color_role(options, pd.promasp),
        ))
    planet_id = primdir_planet_id(pd.prom)
    if planet_id is not None:
        parts.append(_display_part(
            _planet_glyph(planet_id),
            glyph=True,
            color=_planet_color(chrt, options, planet_id),
            color_role=_planet_color_role(chrt, options, planet_id),
        ))
    else:
        parts.append(_display_part(_prom_label(pds, pd), color=txt, color_role=_TEXT_COLOR_ROLE))
    return [p for p in parts if p.get("text")]


def _custom_significator_display_parts(chrt, options, spec: Optional[dict[str, Any]]) -> Optional[list[dict[str, Any]]]:
    if not isinstance(spec, dict):
        return None
    txt = _text_color(options)
    segments = spec.get("display_segments")
    if isinstance(segments, list) and segments:
        parts: list[dict[str, Any]] = []
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            text = str(segment.get("text") or "")
            kind = str(segment.get("kind") or "text")
            if not text:
                continue
            if kind == "planet":
                try:
                    se_id = int(segment.get("seId"))
                    glyph = common.common.get_planet_glyph(se_id)
                    parts.append(_display_part(
                        glyph,
                        glyph=True,
                        color=_planet_color(chrt, options, se_id),
                        color_role=_planet_color_role(chrt, options, se_id),
                    ))
                except Exception:
                    parts.append(_display_part(text, glyph=True, color=txt, color_role=_TEXT_COLOR_ROLE))
            elif kind == "glyph":
                parts.append(_display_part(text, glyph=True, color=txt, color_role=_TEXT_COLOR_ROLE))
            else:
                parts.append(_display_part(text, color=txt, color_role=_TEXT_COLOR_ROLE))
        if parts:
            return parts

    glyph = str(spec.get("display_glyph") or "")
    marker = str(spec.get("display_marker") or "")
    if glyph:
        color = txt
        color_role = _TEXT_COLOR_ROLE
        try:
            planet_id = int(spec.get("display_planet_id"))
            color = _planet_color(chrt, options, planet_id)
            color_role = _planet_color_role(chrt, options, planet_id)
        except Exception:
            if glyph == getattr(common.common, "fortune", None):
                color = _lof_color(options)
                color_role = _lof_color_role(options)
        parts = [_display_part(glyph, glyph=True, color=color, color_role=color_role)]
        if marker:
            parts.append(_display_part(marker, color=txt, color_role=_TEXT_COLOR_ROLE))
        return parts
    label = str(spec.get("label") or "")
    if label:
        return [_display_part(label, color=txt, color_role=_TEXT_COLOR_ROLE)]
    return None


def _primdir_sig_parts(pds, pd, *, display_options=None) -> list[dict[str, Any]]:
    chrt = pds.chart
    options = display_options if display_options is not None else pds.options
    txt = _text_color(options)

    if pd.sigasp in (chart.Chart.PARALLEL, chart.Chart.CONTRAPARALLEL):
        partxt = 'Y' if pd.parallelaxis == 0 and pd.sigasp == chart.Chart.CONTRAPARALLEL else 'X'
        parts = [
            _display_part(
                partxt,
                glyph=True,
                color=getattr(options, "clrperegrin", txt),
                color_role=_PEREGRIN_COLOR_ROLE,
            ),
        ]
        sig_label = primdir_angle_label(pd.sig) or primdir_house_cusp_label(pd.sig)
        if sig_label is not None:
            parts.append(_display_part(sig_label, color=txt, color_role=_TEXT_COLOR_ROLE))
        else:
            parts.append(_display_part(
                _planet_glyph(pd.sig),
                glyph=True,
                color=_planet_color(chrt, options, pd.sig),
                color_role=_planet_color_role(chrt, options, pd.sig),
            ))
        if pd.parallelaxis != 0:
            angle_label = primdir_angle_label(pd.parallelaxis, parens=True)
            if angle_label is not None:
                parts.append(_display_part(angle_label, color=txt, color_role=_TEXT_COLOR_ROLE))
        return [p for p in parts if p.get("text")]

    if pd.sigasp in (chart.Chart.RAPTPAR, chart.Chart.RAPTCONTRAPAR):
        angle_label = primdir_angle_label(pd.parallelaxis, parens=True)
        return [
            _display_part('R', color=txt, color_role=_TEXT_COLOR_ROLE),
            _display_part(
                'X',
                glyph=True,
                color=getattr(options, "clrperegrin", txt),
                color_role=_PEREGRIN_COLOR_ROLE,
            ),
            _display_part(angle_label or "", color=txt, color_role=_TEXT_COLOR_ROLE),
        ]

    if pd.sig == PrimDir.LOF:
        parts = []
        if pd.mundane:
            parts.append(_display_part(
                _aspect_glyph(pd.sigasp),
                glyph=True,
                color=_aspect_color(options, pd.sigasp),
                color_role=_aspect_color_role(options, pd.sigasp),
            ))
        parts.append(_display_part(
            common.common.fortune,
            glyph=True,
            color=_lof_color(options),
            color_role=_lof_color_role(options),
        ))
        return [p for p in parts if p.get("text")]

    if pd.sig == PrimDir.SYZ:
        return [_display_part(mtexts.txts['Syzygy'], color=txt, color_role=_TEXT_COLOR_ROLE)]

    if pd.sig == PrimDir.CUSTOMERPD:
        if getattr(pd, 'sigdyn', None) == 'chiron':
            return [_display_part(
                _planet_glyph(astrology.SE_CHIRON),
                glyph=True,
                color=_chiron_color(options),
                color_role=_chiron_color_role(options),
            )]
        if getattr(pd, 'sigdyn', None) == 'vertex':
            return [_display_part(
                common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX),
                glyph=True,
                color=_vertex_color(options),
                color_role=_vertex_color_role(options),
            )]
        if getattr(pd, 'sigdyn', None) in (_CONTEXT_SIG_KEY, "user_sig"):
            parts = _custom_significator_display_parts(
                chrt,
                options,
                getattr(chrt, "pd_context_significator_spec", None),
            )
            if parts:
                return parts
        return [_display_part(
            pds._get_dynamic_point_label(pd.sigdyn, False),
            color=txt,
            color_role=_TEXT_COLOR_ROLE,
        )]

    if (angle_label := primdir_angle_label(pd.sig)) is not None:
        return [_display_part(angle_label, color=txt, color_role=_TEXT_COLOR_ROLE)]

    if (house_cusp_label := primdir_house_cusp_label(pd.sig)) is not None:
        return [_display_part(house_cusp_label, color=txt, color_role=_TEXT_COLOR_ROLE)]

    parts = []
    if pd.sigasp != chart.Chart.CONJUNCTIO:
        parts.append(_display_part(
            _aspect_glyph(pd.sigasp),
            glyph=True,
            color=_aspect_color(options, pd.sigasp),
            color_role=_aspect_color_role(options, pd.sigasp),
        ))
    planet_id = primdir_planet_id(pd.sig)
    if planet_id is not None:
        parts.append(_display_part(
            _planet_glyph(planet_id),
            glyph=True,
            color=_planet_color(chrt, options, planet_id),
            color_role=_planet_color_role(chrt, options, planet_id),
        ))
    else:
        parts.append(_display_part(_sig_label(pds, pd), color=txt, color_role=_TEXT_COLOR_ROLE))
    return [p for p in parts if p.get("text")]


def _primary_options_for_age_window(options, start_age: Optional[float], end_age: Optional[float]):
    if start_age is None or end_age is None:
        return options, False
    opts = copy.copy(options)
    start = max(0.0, float(start_age))
    end = max(start + 1.0, float(end_age))
    setattr(opts, "_pd_range_bounds_override", (start, end))
    setattr(opts, "_pd_max_age_limit_override", end)
    return opts, True


def _display_tuple_from_datetime(value: datetime.datetime) -> tuple[int, int, int, int, int, int]:
    return (
        int(value.year),
        int(value.month),
        int(value.day),
        int(value.hour),
        int(value.minute),
        int(value.second),
    )


def _directions_source_path(source: Optional[str]) -> str:
    return str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)


def _canonical_path(value: Any) -> str:
    if value is None:
        return ""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(Path(raw).expanduser().resolve(strict=False))
    except Exception:
        return str(Path(raw).expanduser())


def _same_source_path(left: Any, right: Any) -> bool:
    return bool(_canonical_path(left)) and _canonical_path(left) == _canonical_path(right)


def _load_radix_from_source(source: Optional[str], name: str, opts):
    source_path = _directions_source_path(source)
    radix, _ = export_chart_json.load_chart(source_path, opts, name=name)
    return radix


def _workspace_radix_matches_request(radix, parent_session: Optional[dict], source: Optional[str], name: str) -> bool:
    requested_source = str(source or "").strip()
    if not requested_source:
        return True
    requested_name = str(name or "").strip()
    live_name = str(getattr(radix, "name", "") or "").strip()
    if requested_name and live_name != requested_name:
        return False
    live_source = ""
    if isinstance(parent_session, dict):
        live_source = str(parent_session.get("fpath") or "").strip()
    return _same_source_path(live_source, requested_source)


def _load_direction_radix_context(
    source: Optional[str],
    name: str,
    document_id: Optional[str],
    opts,
):
    if document_id:
        workspace_error = None
        try:
            from webapp.daemon.workspace_service import workspace_service

            parent_document_id = workspace_service._timed_chart_parent_document_id(document_id)
            parent_session = workspace_service._controller.session(parent_document_id)
            radix = workspace_service._parent_radix(parent_document_id)
            if _workspace_radix_matches_request(radix, parent_session, source, name):
                return radix, opts, document_id
        except Exception as exc:
            workspace_error = exc
        if source:
            return _load_radix_from_source(source, name, opts), opts, None
        if workspace_error is not None:
            raise workspace_error
    return _load_radix_from_source(source, name, opts), opts, None


# Circumambulation is intentionally a separate service below: it shares the
# Directions companion pane in the skin, but its row shape and source engine are
# the Time-Lords/circumambulation path rather than the Primary Directions list.


class DirectionsService:
    """Computes the PD list plus annual/monthly directions over return charts."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

    def _document_custom_significator(self, document_id: Optional[str]) -> Optional[dict[str, Any]]:
        if not document_id:
            return None
        try:
            from webapp.daemon.workspace_service import workspace_service

            session = workspace_service._controller.session(document_id)
        except Exception:
            return None
        if not isinstance(session, dict):
            return None
        return normalize_custom_significator(session.get("directions_custom_significator"))

    def _preview_options(self, options_patch: Optional[dict[str, Any]]):
        if not isinstance(options_patch, dict) or not options_patch:
            return None
        from webapp.daemon.options_service import options_service

        return options_service.preview_options(options_patch)

    def _load_radix(
        self,
        source: Optional[str],
        name: str,
        document_id: Optional[str] = None,
        options_override=None,
    ):
        radix, opts, _effective_document_id = self._load_radix_context(
            source,
            name,
            document_id=document_id,
            options_override=options_override,
        )
        return radix, opts

    def _load_radix_context(
        self,
        source: Optional[str],
        name: str,
        document_id: Optional[str] = None,
        options_override=None,
    ):
        opts = options_override if options_override is not None else chart_snapshot_service.options
        return _load_direction_radix_context(source, name, document_id, opts)

    def _live_return_chart(self, document_id: Optional[str], return_kind: str):
        if not document_id:
            return None
        try:
            from webapp.daemon.workspace_service import workspace_service

            session = workspace_service._controller.session(document_id)
        except Exception:
            return None
        if not isinstance(session, dict):
            return None
        cs = session.get("chart_session")
        chrt = getattr(cs, "chart", None) if cs is not None else session.get("chart")
        if chrt is None:
            return None
        wanted = chart.Chart.LUNAR if return_kind == "lunar" else chart.Chart.SOLAR
        if getattr(chrt, "htype", None) != wanted:
            return None
        display_dt = getattr(cs, "display_datetime", None) if cs is not None else None
        label_type = chart.Chart.LUNAR if return_kind == "lunar" else chart.Chart.SOLAR
        label = None
        if display_dt:
            driver = SupplementaryHeadlessDriver(chart_snapshot_service.options)
            label = driver._workspace_timed_label(
                mtexts.typeList[label_type],
                int(display_dt[0]), int(display_dt[1]), int(display_dt[2]),
                int(display_dt[3]), int(display_dt[4]), int(display_dt[5]),
            )
        return chrt, label, display_dt

    def _build_return_for_reference(
        self,
        radix,
        opts,
        return_kind: str,
        reference_dt: datetime.datetime,
    ):
        return_kind = "lunar" if str(return_kind).lower() == "lunar" else "solar"
        public_kind = "lunar-revolution" if return_kind == "lunar" else "solar-revolution"
        built = supplementary_service.build_result(
            radix=radix,
            kind=public_kind,
            when=reference_dt,
        )
        result_chart = built.get("chart")
        display_datetime = built.get("display_datetime")
        if result_chart is None:
            return None, None, None, None
        driver = SupplementaryHeadlessDriver(opts)
        label_type = chart.Chart.LUNAR if return_kind == "lunar" else chart.Chart.SOLAR
        label = driver._workspace_timed_label(
            mtexts.typeList[label_type],
            *[int(v) for v in display_datetime],
        ) if display_datetime else None
        target_year = None
        if return_kind == "solar":
            binding = built.get("binding")
            retained = getattr(binding, "retained_state", {}) if binding is not None else {}
            try:
                target_year = int(retained.get("base_year"))
            except Exception:
                target_year = None
        if target_year is None and display_datetime:
            try:
                target_year = int(display_datetime[0])
            except Exception:
                target_year = None
        return result_chart, label, display_datetime, target_year

    def _return_reference_datetime(
        self,
        document_id: Optional[str],
        reference_datetime: Optional[str],
    ) -> datetime.datetime:
        ref_dt = _parse_reference_datetime(reference_datetime)
        if ref_dt is None:
            return datetime.datetime.now()
        if not document_id:
            return ref_dt
        try:
            from webapp.daemon.workspace_service import workspace_service

            parent_document_id = workspace_service._timed_chart_parent_document_id(document_id)
            session = workspace_service._controller.session(parent_document_id)
        except Exception:
            return ref_dt
        if not isinstance(session, dict):
            return ref_dt
        cs = session.get("chart_session")
        chrt = getattr(cs, "chart", None) if cs is not None else session.get("chart")
        if cs is None or getattr(chrt, "htype", None) != chart.Chart.RADIX:
            return ref_dt
        initial = getattr(cs, "_initial_display_datetime", None)
        current = getattr(cs, "display_datetime", None)
        try:
            ref_tuple = _display_tuple_from_datetime(ref_dt)
            initial_tuple = tuple(int(v) for v in tuple(initial or ())[:6])
            current_tuple = tuple(int(v) for v in tuple(current or ())[:6])
        except Exception:
            return ref_dt
        if (
            len(initial_tuple) == 6
            and len(current_tuple) == 6
            and ref_tuple == initial_tuple
            and current_tuple == initial_tuple
        ):
            return datetime.datetime.now()
        return ref_dt

    def primary_directions(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        range_mode: int = PrimDirs.RANGEALL,
        direction: int = PrimDirs.DIRECT,
        start_age: Optional[float] = None,
        end_age: Optional[float] = None,
        seek: str = "exact",
        custom_significator: Optional[dict[str, Any]] = None,
        options_preview: Optional[dict[str, Any]] = None,
    ) -> dict:
        with self._lock:
            preview_options = self._preview_options(options_preview)
            radix, opts, effective_document_id = self._load_radix_context(
                source,
                name,
                document_id=document_id,
                options_override=preview_options,
            )
            if custom_significator is None:
                custom_significator = self._document_custom_significator(effective_document_id)
            opts, normalized_sig = _options_for_custom_significator(opts, custom_significator)
            pd_opts, windowed = _primary_options_for_age_window(opts, start_age, end_age)
            radix_jd = float(radix.time.jd) if getattr(radix, "time", None) is not None else None
            normalized_seek = seek if seek in {"next", "previous"} else "exact"
            searched_windows = 0
            with _temporary_radix_direction_chart(radix):
                with _temporary_custom_significator(radix, normalized_sig):
                    while True:
                        pds = _project(radix, pd_opts, range_mode, direction)
                        display_options = effective_display_options(pds.options)
                        rows = [
                            _row(
                                pds,
                                pd,
                                radix_jd,
                                reference_chart=radix,
                                display_options=display_options,
                            )
                            for pd in pds.pds
                        ]
                        if rows or not windowed or normalized_seek == "exact" or searched_windows >= 40:
                            break
                        lo, hi = getattr(pd_opts, "_pd_range_bounds_override")
                        width = max(1.0, float(hi) - float(lo))
                        if normalized_seek == "next":
                            next_lo = float(lo) + width
                            next_hi = float(hi) + width
                        else:
                            next_hi = max(0.0, float(lo))
                            next_lo = max(0.0, next_hi - width)
                            if next_hi <= 0.0 or (next_lo == float(lo) and next_hi == float(hi)):
                                break
                        pd_opts, _ = _primary_options_for_age_window(opts, next_lo, next_hi)
                        searched_windows += 1
            title = mtexts.txts.get("PrimaryDirections", "Primary Directions")
            meta = _meta(pd_opts, range_mode, direction, radix, title)
            if normalized_sig is not None:
                meta["customSignificator"] = normalized_sig
            if windowed:
                lo, hi = getattr(pd_opts, "_pd_range_bounds_override")
                meta.update({
                    "startAge": round(float(lo), 4),
                    "endAge": round(float(hi), 4),
                    "windowed": True,
                    "seek": normalized_seek,
                    "searchedWindows": searched_windows,
                })
            return {
                "name": getattr(radix, "name", name),
                "meta": meta,
                "directions": rows,
            }

    def _resolve_revolution_chart(
        self,
        radix,
        opts,
        *,
        document_id: Optional[str],
        year: Optional[int],
        return_kind: str,
        reference_datetime: Optional[str],
    ):
        """Resolve the solar/lunar revolution chart for the annual-directions
        path. Shared by annual_directions (rows) and primary_directions_text
        (export) so the PD-in-revolution projection has exactly one builder.
        Returns (sr_chart, label, display_dt, target_year)."""
        return_kind = "lunar" if str(return_kind).lower() == "lunar" else "solar"
        live = self._live_return_chart(document_id, return_kind)
        target_year = int(year) if year is not None else None
        if live is not None:
            sr_chart, label, display_dt = live
            if target_year is None and display_dt:
                target_year = int(display_dt[0])
        elif return_kind == "lunar":
            ref_dt = self._return_reference_datetime(document_id, reference_datetime)
            sr_chart, label, display_dt, target_year = self._build_return_for_reference(
                radix,
                opts,
                return_kind,
                ref_dt,
            )
            if sr_chart is None:
                raise RuntimeError("Could not build lunar revolution")
        else:
            if target_year is None:
                ref_dt = self._return_reference_datetime(document_id, reference_datetime)
                sr_chart, label, display_dt, target_year = self._build_return_for_reference(
                    radix,
                    opts,
                    return_kind,
                    ref_dt,
                )
                if sr_chart is None:
                    raise RuntimeError("Could not build solar revolution")
            else:
                driver = SupplementaryHeadlessDriver(opts)
                driver.horoscope = radix
                sr_chart, label, display_dt, _ = driver._build_solar_revolution_chart_for_year(
                    radix, target_year
                )
                if sr_chart is None:
                    raise RuntimeError(f"Could not build solar revolution for year {target_year}")
        return sr_chart, label, display_dt, target_year

    def primary_directions_text(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        mode: str = "radix",
        range_mode: int = PrimDirs.RANGEALL,
        direction: int = PrimDirs.DIRECT,
        start_age: Optional[float] = None,
        end_age: Optional[float] = None,
        year: Optional[int] = None,
        return_kind: str = "solar",
        reference_datetime: Optional[str] = None,
        custom_significator: Optional[dict[str, Any]] = None,
    ) -> dict:
        """Save-As-Text payload for the Primary Directions list (radix) and the
        PD-in-revolution list (annual/SR/LR). The file body is built by the
        engine's PrimDirs.format2text (the primdirs.print2file extraction) — the
        skin never assembles the text. Mirrors primdirslistwnd.onSaveAsText."""
        with self._lock:
            radix, opts, effective_document_id = self._load_radix_context(
                source,
                name,
                document_id=document_id,
            )
            if custom_significator is None:
                custom_significator = self._document_custom_significator(effective_document_id)
            opts, normalized_sig = _options_for_custom_significator(opts, custom_significator)
            if mode == "radix":
                pd_opts, _windowed = _primary_options_for_age_window(opts, start_age, end_age)
                with _temporary_radix_direction_chart(radix):
                    with _temporary_custom_significator(radix, normalized_sig):
                        pds = _project(radix, pd_opts, range_mode, direction)
                        text = pds.format2text()
            else:
                sr_chart, _label, _display_dt, _target_year = self._resolve_revolution_chart(
                    radix,
                    opts,
                    document_id=effective_document_id,
                    year=year,
                    return_kind=return_kind,
                    reference_datetime=reference_datetime,
                )
                rev_range = range_mode if range_mode != PrimDirs.RANGEALL else PrimDirs.RANGEREV
                with _temporary_custom_significator(sr_chart, normalized_sig):
                    pds = _project(sr_chart, opts, rev_range, direction)
                    if getattr(opts, "pdrevshownatalpromissors", False):
                        with _temporary_natal_radix_promissors(sr_chart, radix, pds.options):
                            _append_natal_radix_promissor_directions(pds, radix)
                            text = pds.format2text()
                    else:
                        text = pds.format2text()
            base_name = getattr(radix, "name", name) or name
            # wx default filename: chart.name + mtexts.txts['PD']
            # (primdirslistwnd.onSaveAsText:1567/1579).
            filename = "%s%s.txt" % (base_name, mtexts.txts.get("PD", " (Primary Directions)"))
            return {
                "text": text,
                "filename": filename,
            }

    def annual_directions(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        year: Optional[int] = None,
        return_kind: str = "solar",
        reference_datetime: Optional[str] = None,
        range_mode: int = PrimDirs.RANGEREV,
        direction: int = PrimDirs.DIRECT,
        custom_significator: Optional[dict[str, Any]] = None,
        options_preview: Optional[dict[str, Any]] = None,
    ) -> dict:
        with self._lock:
            preview_options = self._preview_options(options_preview)
            radix, opts, effective_document_id = self._load_radix_context(
                source,
                name,
                document_id=document_id,
                options_override=preview_options,
            )
            if custom_significator is None:
                custom_significator = self._document_custom_significator(effective_document_id)
            opts, normalized_sig = _options_for_custom_significator(opts, custom_significator)
            sr_chart, label, display_dt, target_year = self._resolve_revolution_chart(
                radix,
                opts,
                document_id=effective_document_id,
                year=year,
                return_kind=return_kind,
                reference_datetime=reference_datetime,
            )
            # Return charts -> projection applies get_effective_revolution_options
            # and every arc routes through calcTimeRev (primdirs.py:2198).
            radix_jd = float(radix.time.jd) if getattr(radix, "time", None) is not None else None
            with _temporary_custom_significator(sr_chart, normalized_sig):
                pds = _project(sr_chart, opts, range_mode, direction)
                display_options = effective_display_options(pds.options)
                if getattr(opts, "pdrevshownatalpromissors", False):
                    with _temporary_natal_radix_promissors(sr_chart, radix, pds.options):
                        _append_natal_radix_promissor_directions(pds, radix)
                        rows = [
                            _row(
                                pds,
                                pd,
                                radix_jd,
                                reference_chart=sr_chart,
                                display_options=display_options,
                            )
                            for pd in pds.pds
                        ]
                else:
                    rows = [
                        _row(
                            pds,
                            pd,
                            radix_jd,
                            reference_chart=sr_chart,
                            display_options=display_options,
                        )
                        for pd in pds.pds
                    ]
            title = (mtexts.txts.get("MonthlyDirections", "Monthly Directions")
                     if sr_chart.htype == chart.Chart.LUNAR
                     else mtexts.txts.get("AnnualDirections", "Annual Directions"))
            meta = _meta(opts, range_mode, direction, sr_chart, title)
            if normalized_sig is not None:
                meta["customSignificator"] = normalized_sig
            meta["returnKind"] = return_kind
            meta["returnDatetime"] = _iso_from_display_datetime(display_dt)
            meta["returnLabel"] = label
            meta["solarRevolutionYear"] = target_year
            meta["solarRevolutionDatetime"] = _iso_from_display_datetime(display_dt)
            meta["solarRevolutionLabel"] = label
            meta["showNatalPromissors"] = bool(getattr(opts, "pdrevshownatalpromissors", False))
            return {
                "name": getattr(radix, "name", name),
                "meta": meta,
                "directions": rows,
            }


directions_service = DirectionsService()


# ---------------------------------------------------------------------------
# Secondary / minor / tertiary directions (the secdirframe.py popup).
# Row math is the wx-free engine.secondary_directions module (extracted from
# secdirframe.py:691). The daemon owns the SAME search the desktop list runs.
# ---------------------------------------------------------------------------
from engine import secondary_directions as _secdir  # noqa: E402
import posfordate  # noqa: E402

_SECONDARY_METHODS = {
    "secondary": posfordate.SECONDARY,
    "minor": posfordate.MINOR,
    "tertiary": posfordate.TERTIARY,
}
_FULL_SECONDARY_DIRECTION_LIMIT = 1_000_000
_SECONDARY_DIRECTION_WINDOW_YEARS = 5.0
_SECONDARY_FOCUS_WINDOW_YEARS = {
    posfordate.SECONDARY: 25.0,
    posfordate.TERTIARY: 1.0,
    posfordate.MINOR: 0.25,
}


def _secondary_conversion_key_label(method: str) -> str:
    engine_method = posfordate.progression_method(
        _SECONDARY_METHODS.get(method, posfordate.SECONDARY)
    )
    lunar_month = float(posfordate.MEAN_LUNAR_MONTH)
    if engine_method == posfordate.TERTIARY:
        return f"1d = {lunar_month:.2f}d"
    if engine_method == posfordate.MINOR:
        return f"{lunar_month:.2f}d = 1y"
    return "1d = 1y"


def _parse_reference_datetime(value: Optional[str]) -> Optional[datetime.datetime]:
    if not value:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(value))
    except Exception:
        return None
    return dt.replace(tzinfo=None)


def _iso_from_display_datetime(values) -> Optional[str]:
    if not values:
        return None
    try:
        y, m, d, h, mi, s = [int(v) for v in values[:6]]
    except Exception:
        return None
    return f"{y:04d}-{m:02d}-{d:02d}T{h:02d}:{mi:02d}:{s:02d}"


def _reference_age_years(radix, value: Optional[str]) -> Optional[float]:
    dt = _parse_reference_datetime(value)
    if dt is None or radix is None or getattr(radix, "time", None) is None:
        return None
    try:
        calflag = symbolic_time._calflag_from_chart(radix)
        reference_jd = astrology.swe_julday(
            int(dt.year),
            int(dt.month),
            int(dt.day),
            dt.hour + dt.minute / 60.0 + dt.second / 3600.0,
            calflag,
        )
        return max(0.0, (float(reference_jd) - float(radix.time.jd)) / 365.2425)
    except Exception:
        return None


def _secondary_row_display_color(
    row,
    metadata_key: str,
    catalog,
    object_id: str,
    display_options,
    source_options=None,
) -> Optional[str]:
    metadata = getattr(row, "metadata", None)
    if not isinstance(metadata, dict):
        return None
    payload = metadata.get(metadata_key)
    if not isinstance(payload, dict):
        return None
    fallback = payload.get("glyph_color")
    obj = catalog.get(object_id) if catalog is not None else None
    color = object_glyph_color(
        display_options,
        obj,
        payload.get("dignity_code"),
        fallback=fallback,
        source_options=source_options,
    )
    return _rgb_css(color) if color is not None else None


def _secondary_row_display_color_role(
    row,
    metadata_key: str,
    catalog,
    object_id: str,
    display_options,
    resolved_color: Optional[str],
) -> Optional[str]:
    metadata = getattr(row, "metadata", None)
    if not isinstance(metadata, dict):
        return None
    payload = metadata.get(metadata_key)
    if not isinstance(payload, dict):
        return None
    obj = catalog.get(object_id) if catalog is not None else None
    return object_glyph_color_role(
        display_options,
        obj,
        payload.get("dignity_code"),
        resolved_color=resolved_color,
    )


def _apply_secondary_display_palette(
    serialized: list[dict[str, Any]],
    rows,
    catalog,
    display_options,
    source_options=None,
) -> None:
    """Recolor final secondary-direction JSON from existing semantic metadata."""
    for payload, source in zip(serialized, rows):
        fields = payload.get("fields")
        if not isinstance(fields, dict):
            continue
        prom_color = _secondary_row_display_color(
            source,
            "prom_display",
            catalog,
            source.promittor_id,
            display_options,
            source_options,
        )
        sig_color = _secondary_row_display_color(
            source,
            "sig_display",
            catalog,
            source.significator_id,
            display_options,
            source_options,
        )
        fields["promColor"] = prom_color
        fields["sigColor"] = sig_color
        fields["promColorRole"] = _secondary_row_display_color_role(
            source,
            "prom_display",
            catalog,
            source.promittor_id,
            display_options,
            prom_color,
        )
        fields["sigColorRole"] = _secondary_row_display_color_role(
            source,
            "sig_display",
            catalog,
            source.significator_id,
            display_options,
            sig_color,
        )
        try:
            aspect_index = int(fields.get("aspectIndex"))
            aspect_color = _rgb_css(display_options.clraspect[aspect_index])
            fields["aspectColor"] = aspect_color
            fields["aspectColorRole"] = aspect_color_role(
                display_options,
                aspect_index,
                resolved_color=aspect_color,
            )
        except Exception:
            pass


def _focused_secondary_age_window(radix, reference_datetime: Optional[str], method: int) -> tuple[float, float, Optional[float]]:
    age = _reference_age_years(radix, reference_datetime)
    dt = _parse_reference_datetime(reference_datetime)
    if dt is None:
        start_age, end_age = _secdir.SECONDARY_DIRECTION_RANGES[0]
        return float(start_age), float(end_age), age
    if age is None:
        try:
            start_age, end_age = _secdir.age_range_for_reference(
                radix,
                (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second),
            )
        except Exception:
            start_age, end_age = _secdir.SECONDARY_DIRECTION_RANGES[0]
        return float(start_age), float(end_age), age
    window_years = float(
        _SECONDARY_FOCUS_WINDOW_YEARS.get(
            posfordate.progression_method(method),
            _SECONDARY_DIRECTION_WINDOW_YEARS,
        )
    )
    start_age = max(0.0, math.floor(float(age) / window_years) * window_years)
    end_age = start_age + window_years
    return float(start_age), float(end_age), age


class SecondaryDirectionsService:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    def _load_radix(self, source: Optional[str], name: str, document_id: Optional[str] = None):
        opts = chart_snapshot_service.options
        radix, opts, _effective_document_id = _load_direction_radix_context(
            source,
            name,
            document_id,
            opts,
        )
        return radix, opts

    def _build_secondary_rows(
        self,
        *,
        source: Optional[str],
        name: str,
        document_id: Optional[str],
        start_age: Optional[float],
        end_age: Optional[float],
        method: str,
        direction: str,
        reference_datetime: Optional[str],
    ):
        """Shared row build for the list payload and the Save-As-Text export so
        both serve the exact same window of rows."""
        radix, _opts = self._load_radix(source, name, document_id=document_id)
        engine_method = _SECONDARY_METHODS.get(method, posfordate.SECONDARY)
        direction_mode = _secdir.normalize_secondary_direction(direction)
        reference_age = _reference_age_years(radix, reference_datetime)
        windowed = start_age is None or end_age is None
        if windowed:
            start_age, end_age, reference_age = _focused_secondary_age_window(
                radix, reference_datetime, engine_method,
            )
        start_age = max(0.0, float(start_age))
        end_age = float(end_age)
        if end_age <= start_age:
            end_age = start_age + _SECONDARY_DIRECTION_WINDOW_YEARS
        full_range = False
        rows, truncated, catalog = _secdir.build_secondary_direction_rows(
            radix,
            start_age=start_age,
            end_age=end_age,
            limit=_FULL_SECONDARY_DIRECTION_LIMIT if full_range else _secdir.SECONDARY_DIRECTION_LIMIT,
            method=engine_method,
            direction=direction_mode,
        )
        return radix, rows, truncated, catalog, start_age, end_age, reference_age, direction_mode

    def secondary_directions_text(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        start_age: Optional[float] = None,
        end_age: Optional[float] = None,
        method: str = "secondary",
        direction: str = _secdir.SECONDARY_DIRECTION_DIRECT,
        reference_datetime: Optional[str] = None,
    ) -> dict:
        """Save-As-Text payload (secdirframe.onSaveAsText:1237) — formatting is
        the engine's build_secondary_rows_text, never the skin."""
        with self._lock:
            radix, rows, _truncated, catalog, _start, _end, _ref, _dir = self._build_secondary_rows(
                source=source,
                name=name,
                document_id=document_id,
                start_age=start_age,
                end_age=end_age,
                method=method,
                direction=direction,
                reference_datetime=reference_datetime,
            )
            return {
                "text": _secdir.build_secondary_rows_text(radix, rows, catalog),
                "filename": "secondary-directions.txt",
            }

    def secondary_directions(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        start_age: Optional[float] = None,
        end_age: Optional[float] = None,
        method: str = "secondary",
        direction: str = _secdir.SECONDARY_DIRECTION_DIRECT,
        reference_datetime: Optional[str] = None,
    ) -> dict:
        with self._lock:
            radix, rows, truncated, catalog, start_age, end_age, reference_age, direction_mode = self._build_secondary_rows(
                source=source,
                name=name,
                document_id=document_id,
                start_age=start_age,
                end_age=end_age,
                method=method,
                direction=direction,
                reference_datetime=reference_datetime,
            )
            source_display_options = (
                getattr(radix, "options", None) or chart_snapshot_service.options
            )
            display_options = effective_display_options(source_display_options)
            serialized = _secdir.serialize_secondary_rows(radix, rows, catalog)
            _apply_secondary_display_palette(
                serialized,
                rows,
                catalog,
                display_options,
                source_display_options,
            )
            for row in serialized:
                row["displayDate"] = _display_date_from_iso(row.get("date"), display_options)
                row["sessionLabel"] = _direction_event_session_label(
                    row.get("prom"), row.get("aspect"), row.get("sig"),
                )
            title = {
                "minor": mtexts.txts.get("MinorProgression", "Minor Progressions") + mtexts.txts.get("ToRadixSuffix", " to Radix"),
                "tertiary": mtexts.txts.get("TertiaryProgression", "Tertiary Progressions") + mtexts.txts.get("ToRadixSuffix", " to Radix"),
            }.get(method, "Secondary Progressions to Radix")
            return {
                "name": getattr(radix, "name", name),
                "meta": {
                    "title": title,
                    "method": method,
                    "direction": direction_mode,
                    "directionModes": [
                        _secdir.SECONDARY_DIRECTION_DIRECT,
                        _secdir.SECONDARY_DIRECTION_CONVERSE,
                        _secdir.SECONDARY_DIRECTION_BOTH,
                    ],
                    "conversionKey": _secondary_conversion_key_label(method),
                    "startAge": round(float(start_age), 4),
                    "endAge": round(float(end_age), 4),
                    "totalStartAge": 0,
                    "totalEndAge": None,
                    "referenceAge": round(reference_age, 4) if reference_age is not None else None,
                    "windowed": True,
                    "windowYears": round(float(end_age) - float(start_age), 4),
                    "hasPrevious": start_age > 0,
                    "hasNext": True,
                    "ranges": [list(r) for r in _secdir.SECONDARY_DIRECTION_RANGES],
                    "truncated": bool(truncated),
                    "columns": (
                        [mtexts.txts.get("Age", "Age"), mtexts.txts.get("DirColumn", "Dir"),
                         mtexts.txts.get("Prom", "Prom."), mtexts.txts.get("AspColumn", "Asp."),
                         mtexts.txts.get("Sig", "Sig."), mtexts.txts.get("Date", "Date")]
                        if direction_mode != _secdir.SECONDARY_DIRECTION_DIRECT
                        else [mtexts.txts.get("Age", "Age"), mtexts.txts.get("Prom", "Prom."),
                              mtexts.txts.get("AspColumn", "Asp."), mtexts.txts.get("Sig", "Sig."),
                              mtexts.txts.get("Date", "Date")]
                    ),
                },
                "directions": serialized,
            }


secondary_directions_service = SecondaryDirectionsService()


# ---------------------------------------------------------------------------
# Circumambulations (the circumambulationframe.py popup). The engine projection
# already returns wx-free row dicts (term-by-term ascensional progression with
# participating planets) via symbolic_projection.project_circumambulation
# (engine/symbolic_projection.py:90) -> circumambulation.build_circumambulation_rows
# (circumambulation.py:714). Method radios -> options.pdcircumoa /
# use_exact_oa (circumambulationframe.py:581).
# ---------------------------------------------------------------------------
import datetime as _dt  # noqa: E402


class CircumambulationService:
    def __init__(self) -> None:
        self._lock = threading.RLock()

    def _load_radix(self, source: Optional[str], name: str, document_id: Optional[str] = None):
        opts = chart_snapshot_service.options
        radix, opts, _effective_document_id = _load_direction_radix_context(
            source,
            name,
            document_id,
            opts,
        )
        return radix, opts

    @staticmethod
    def _significator_spec(
        *,
        oid: str,
        label: str,
        longitude: float,
        latitude: float = 0.0,
        display_glyph: str = "",
        display_marker: str = "",
        display_planet_id: Optional[int] = None,
    ) -> dict[str, Any]:
        spec: dict[str, Any] = {
            "id": oid,
            "label": label,
            "longitude": util.normalize(float(longitude)),
            "latitude": float(latitude),
            "only": True,
        }
        if display_glyph:
            spec["display_glyph"] = display_glyph
        if display_marker:
            spec["display_marker"] = display_marker
        if display_planet_id is not None:
            spec["display_planet_id"] = int(display_planet_id)
        return spec

    @staticmethod
    def _significator_item(
        *,
        group: str,
        label: str,
        custom_significator: Optional[dict[str, Any]],
        item_id: Optional[str] = None,
    ) -> dict[str, Any]:
        return {
            "id": item_id or (custom_significator or {}).get("id") or "default:asc",
            "group": group,
            "label": label,
            "customSignificator": custom_significator,
            "glyph": (custom_significator or {}).get("display_glyph") or "",
            "marker": (custom_significator or {}).get("display_marker") or "",
        }

    def _circumambulation_significator_items(self, chrt) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = [
            self._significator_item(
                group=mtexts.txts.get("Angles", "Angles"),
                label=mtexts.txts.get("Asc", "Asc"),
                custom_significator=None,
                item_id="default:asc",
            )
        ]

        def add_spec(group: str, oid: str, label: str, lon: Any, lat: Any = 0.0, glyph: str = "", marker: str = "", planet_id: Optional[int] = None):
            try:
                lon_float = float(lon)
            except (TypeError, ValueError):
                return
            if not math.isfinite(lon_float):
                return
            try:
                lat_float = float(lat)
            except (TypeError, ValueError):
                lat_float = 0.0
            spec = self._significator_spec(
                oid=oid,
                label=label,
                longitude=lon_float,
                latitude=lat_float,
                display_glyph=glyph,
                display_marker=marker,
                display_planet_id=planet_id,
            )
            items.append(self._significator_item(group=group, label=label, custom_significator=spec))

        planet_ids = list(range(0, 12))
        if hasattr(chrt, "get_planet_body"):
            planet_ids.append(astrology.SE_CHIRON)
        for pid in planet_ids:
            try:
                body = common.common.get_chart_planet(chrt, pid)
                lon = body.data[planets.Planet.LONG]
                lat = body.data[planets.Planet.LAT]
            except Exception:
                continue
            label = common.common.get_planet_name(pid)
            add_spec(
                "Planets",
                "custom:primary:planet:%s" % pid,
                label,
                lon,
                lat,
                common.common.get_planet_glyph(pid),
                "",
                pid,
            )

        try:
            asc = float(chrt.houses.ascmc[houses.Houses.ASC])
            mc = float(chrt.houses.ascmc[houses.Houses.MC])
            add_spec("Angles", "custom:primary:angle:dsc", mtexts.txts.get("Dsc", "Dsc"), asc + 180.0)
            add_spec("Angles", "custom:primary:angle:mc", mtexts.txts.get("MC", "MC"), mc)
            add_spec("Angles", "custom:primary:angle:ic", mtexts.txts.get("IC", "IC"), mc + 180.0)
        except Exception:
            pass

        try:
            vertex_lon = float(chrt.houses.ascmc[houses.Houses.VERTEX])
            add_spec(
                "Angles",
                "custom:primary:vertex:vertex",
                mtexts.txts.get("Vertex", "Vertex"),
                vertex_lon,
                0.0,
                common.common.get_planet_glyph(common.CHART_OBJECT_VERTEX),
                "",
                common.CHART_OBJECT_VERTEX,
            )
        except Exception:
            pass

        try:
            lof_lon = float(chrt.fortune.fortune[fortune.Fortune.LON])
            add_spec(
                mtexts.txts.get("Lots", "Lots"),
                "custom:primary:fortune:fortune",
                mtexts.txts.get("LoF", "LoF"),
                lof_lon,
                0.0,
                common.common.fortune,
            )
        except Exception:
            pass

        try:
            for cusp_idx in range(1, 13):
                add_spec(
                    "Houses",
                    "custom:primary:house:%s" % cusp_idx,
                    mtexts.txts.get("HouseCuspLabel", "House %d cusp") % cusp_idx,
                    chrt.houses.cusps[cusp_idx],
                )
        except Exception:
            pass

        try:
            parts = list(getattr(getattr(chrt, "parts", None), "parts", None) or [])
        except Exception:
            parts = []
        for idx, part in enumerate(parts):
            try:
                label = str(part[arabicparts.ArabicParts.NAME])
                lon = float(part[arabicparts.ArabicParts.LONG])
            except Exception:
                continue
            add_spec(mtexts.txts.get("Lots", "Lots"), "custom:primary:secondary_ring:lot:%03d" % idx, label, lon)

        return items

    def circumambulations(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        document_id: Optional[str] = None,
        use_exact_oa: bool = False,
        max_age: int = 150,
        mode: str = "radix",
        year: Optional[int] = None,
        return_kind: str = "solar",
        reference_datetime: Optional[str] = None,
        custom_significator: Optional[dict[str, Any]] = None,
    ) -> dict:
        with self._lock:
            radix, opts, effective_document_id = directions_service._load_radix_context(
                source,
                name,
                document_id=document_id,
            )
            if custom_significator is None:
                custom_significator = directions_service._document_custom_significator(effective_document_id)
            normalized_sig = normalize_custom_significator(custom_significator)
            source_chart = radix
            return_label = None
            return_datetime = None
            target_year = None
            normalized_mode = str(mode or "radix").lower()
            if normalized_mode in {"sr", "solar", "annual", "revolution"}:
                source_chart, return_label, display_dt, target_year = directions_service._resolve_revolution_chart(
                    radix,
                    opts,
                    document_id=effective_document_id,
                    year=year,
                    return_kind="solar",
                    reference_datetime=reference_datetime,
                )
                return_kind = "solar"
                return_datetime = _iso_from_display_datetime(display_dt)
                normalized_mode = "sr"
            elif normalized_mode in {"lr", "lunar", "monthly"}:
                source_chart, return_label, display_dt, target_year = directions_service._resolve_revolution_chart(
                    radix,
                    opts,
                    document_id=effective_document_id,
                    year=year,
                    return_kind="lunar",
                    reference_datetime=reference_datetime,
                )
                return_kind = "lunar"
                return_datetime = _iso_from_display_datetime(display_dt)
                normalized_mode = "lr"
            else:
                normalized_mode = "radix"
                return_kind = "radix"
            age_offset = _circum_age_offset_years(radix, source_chart)
            include_natal_promissors = (
                normalized_mode in {"sr", "lr"}
                and getattr(opts, "pdrevshownatalpromissors", False)
            )
            with (
                _temporary_radix_direction_chart(source_chart)
                if normalized_mode == "radix"
                else nullcontext()
            ):
                projection = symbolic_projection.project_symbolic_table(
                    symbolic_projection.CIRCUMAMBULATION,
                    source_chart,
                    opts,
                    default_use_exact_oa=bool(use_exact_oa),
                    default_max_age=int(max_age),
                    custom_significator=normalized_sig,
                    natal_participator_chart=radix if include_natal_promissors else None,
                )
            rows = projection.get("content") or []
            display_options = effective_display_options(opts)
            serialized = [
                self._serialize_row(
                    r,
                    source_chart=source_chart,
                    opts=display_options,
                    age_offset=age_offset,
                    significator_label=(
                        str(normalized_sig.get("label") or "").strip()
                        or mtexts.txts.get("Asc", "Asc")
                        if isinstance(normalized_sig, dict)
                        else mtexts.txts.get("Asc", "Asc")
                    ),
                )
                for r in rows
            ]
            title = mtexts.txts.get("CircumThroughBounds", "Circumambulations through the Bounds")
            if normalized_mode == "sr":
                title = mtexts.txts.get("AnnualCircumThroughBounds", "Annual Circumambulations through the Bounds")
            elif normalized_mode == "lr":
                title = mtexts.txts.get("MonthlyCircumThroughBounds", "Monthly Circumambulations through the Bounds")
            return {
                "name": getattr(radix, "name", name),
                "meta": {
                    "title": title,
                    "useExactOa": bool(use_exact_oa),
                    "maxAge": int(max_age),
                    "mode": normalized_mode,
                    "returnKind": return_kind,
                    "returnDatetime": return_datetime,
                    "returnLabel": return_label,
                    "solarRevolutionYear": target_year,
                    "ageOffset": round(float(age_offset), 4),
                    "listGlyphColors": bool(getattr(opts, "pdlistglyphcolors", False)),
                    "showNatalPromissors": bool(include_natal_promissors),
                    "customSignificator": normalized_sig,
                    "significators": self._circumambulation_significator_items(source_chart),
                    "columns": [mtexts.txts.get("Degree", "Degree"), mtexts.txts.get("TermLord", "Term Lord"),
                                mtexts.txts.get("Participator", "Participator"), mtexts.txts.get("Age", "Age"),
                                mtexts.txts.get("Date", "Date")],
                },
                "directions": serialized,
            }

    @staticmethod
    def _serialize_row(
        row: dict,
        *,
        source_chart,
        opts,
        age_offset: float = 0.0,
        significator_label: str = "Asc",
    ) -> dict:
        """Project one circumambulation term row (circumambulation.py:714) into a
        flat JSON row. event_datetime drives the Timed-chart action (the term's
        start)."""
        def _iso(value) -> Optional[str]:
            if isinstance(value, _dt.datetime):
                return "%04d-%02d-%02dT%02d:%02d:%02d" % (
                    value.year, value.month, value.day, value.hour, value.minute, value.second)
            if isinstance(value, _dt.date):
                return "%04d-%02d-%02dT00:00:00" % (value.year, value.month, value.day)
            return None

        def _date(value) -> Optional[str]:
            if isinstance(value, (_dt.date, _dt.datetime)):
                return "%04d-%02d-%02d" % (value.year, value.month, value.day)
            return None

        def _display_date(value) -> Optional[str]:
            date_iso = _date(value)
            return _display_date_from_iso(date_iso, opts)

        participating = []
        term_ruler_label = _body_label(row.get("term_ruler_pid"))
        for p in row.get("participating") or []:
            pid = _participating_planet_id(p.get("planet"))
            part_age = None
            if p.get("years") is not None:
                part_age = float(p["years"]) + float(age_offset)
            part_sign_index = None
            if p.get("lam") is not None:
                try:
                    part_sign_index = int(util.normalize(float(p["lam"])) / chart.Chart.SIGN_DEG)
                except Exception:
                    part_sign_index = None
            planet_label = _body_label(pid) if pid is not None else str(p.get("planet") or "")
            aspect_label = _aspect_label_for_degree(p.get("aspect"))
            participating.append({
                "planet": p.get("planet"),
                "source": p.get("source") or "return",
                "sourceMarker": p.get("source_marker"),
                "planetGlyph": _participating_planet_glyph(p.get("planet")),
                "planetColor": _rgb_css(_planet_color(source_chart, opts, pid)) if pid is not None else None,
                "planetColorRole": _planet_color_role(source_chart, opts, pid) if pid is not None else None,
                "degreeText": _circum_degree_text(p.get("lam")),
                "degreeSignIndex": part_sign_index,
                "degreeSignGlyph": _sign_glyph(opts, part_sign_index),
                "degreeSignColor": _rgb_css(_sign_color(opts, part_sign_index)),
                "degreeSignColorRole": _sign_color_role(opts, part_sign_index),
                "aspectGlyph": _aspect_glyph_for_degree(p.get("aspect")),
                "aspectColor": _rgb_css(_aspect_color_for_degree(opts, p.get("aspect"))),
                "aspectColorRole": _aspect_color_role_for_degree(opts, p.get("aspect")),
                "aspectDegree": (
                    round(float(p["aspect"]), 3) if p.get("aspect") is not None else None
                ),
                "date": _date(p.get("date") or p.get("datetime")),
                "displayDate": _display_date(p.get("date") or p.get("datetime")),
                "eventDatetime": _iso(p.get("datetime") or p.get("date")),
                "sessionLabel": _direction_event_session_label(
                    planet_label,
                    aspect_label,
                    significator_label,
                ),
                "age": round(part_age, 3) if part_age is not None else None,
            })
        sign_index = row.get("sign_idx")
        age_start = None
        age_end = None
        if row.get("age_start") is not None:
            age_start = float(row["age_start"]) + float(age_offset)
        if row.get("age_end") is not None:
            age_end = float(row["age_end"]) + float(age_offset)
        return {
            "signIndex": sign_index,
            "signGlyph": _sign_glyph(opts, sign_index),
            "signColor": _rgb_css(_sign_color(opts, sign_index)),
            "signColorRole": _sign_color_role(opts, sign_index),
            "degreeText": _circum_degree_text(row.get("lam_start")),
            "termRulerPid": row.get("term_ruler_pid"),
            "termRulerGlyph": _planet_glyph(row.get("term_ruler_pid")),
            "termRulerColor": _rgb_css(_planet_color(source_chart, opts, row.get("term_ruler_pid"))),
            "termRulerColorRole": _planet_color_role(source_chart, opts, row.get("term_ruler_pid")),
            "dateStart": _date(row.get("date_start")),
            "dateEnd": _date(row.get("date_end")),
            "displayDateStart": _display_date(row.get("date_start")),
            "displayDateEnd": _display_date(row.get("date_end")),
            "ageStart": round(age_start, 3) if age_start is not None else None,
            "ageEnd": round(age_end, 3) if age_end is not None else None,
            "deltaOa": round(float(row["delta_oa"]), 4) if row.get("delta_oa") is not None else None,
            "eventDatetime": _iso(row.get("datetime_start") or row.get("date_start")),
            "sessionLabel": " ".join(part for part in (
                _compact_direction_subject(term_ruler_label),
                mtexts.txts.get("Term", "Term"),
                _compact_direction_subject(significator_label),
            ) if part),
            "participating": participating,
        }


circumambulation_service = CircumambulationService()
