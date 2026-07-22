#!/usr/bin/env python3
"""Render a chart export payload using the existing wx GraphChart renderer.

This helper intentionally lives outside ``webapp/daemon``: the daemon must stay
wx-free, but Packet 10C still needs source-backed chart export semantics from
``morin.py:onSaveAsBitmap`` / ``exportutil.py`` / ``pdfexport.py``. The daemon
serializes active session chart objects to a temporary pickle and this helper
writes the selected PNG/PDF path.
"""

from __future__ import annotations

import pickle
import sys
import copy
import math
from pathlib import Path
from types import MappingProxyType
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import common
import graphchart
import pdfexport
import wx

from webapp.daemon.style_profile_catalog_generated import STYLE_PROFILE_TOKENS


EXPORT_SIZE = 1600
PDF_CHART_COLOR_MODE_MONOCHROME = "monochrome"
PDF_CHART_COLOR_MODE_COLORED_DETAILS = "colored-details"

_PROFILE_CHART_COLOR_ATTRS = {
    "chart.color.background": "clrbackground",
    "chart.color.textBright": "clrtexts",
    "chart.color.frame": "clrframe",
    "chart.color.signs": "clrsigns",
    "chart.color.angles": "clrAscMC",
    "chart.color.houses": "clrhouses",
    "chart.color.houseNumbers": "clrhousenumbers",
    "chart.color.positions": "clrpositions",
    "chart.color.peregrine": "clrperegrin",
    "chart.color.dignity.domicile": "clrdomicil",
    "chart.color.dignity.exile": "clrexil",
    "chart.color.dignity.exaltation": "clrexal",
    "chart.color.dignity.fall": "clrcasus",
}


# GraphChart is the retained Classic/Compact bitmap renderer. These are the
# public web-wheel metrics with a real visual counterpart in that renderer.
# Anglo grammar, AC/MC text labels, prenatal syzygy, and the web-only motion
# collision algorithm are intentionally absent rather than being approximated
# onto Compact geometry.
_GRAPHCHART_WHEEL_METRICS = frozenset({
    "bodyScale",
    "classicOuterScale",
    "compactOuterScale",
    "classicSignScale",
    "compactSignScale",
    "classicSubdivisionScale",
    "compactSubdivisionScale",
    "houseLabelScale",
    "degreeScale",
    "minuteScale",
    "aspectGlyphScale",
    "aspectGlyphOffsetScale",
    "motionScale",
    "outerLabelScale",
    "mediumStrokeBase",
    "hairlineStroke",
    "degreeTickStrokeSmall",
    "degreeTickStrokeLarge",
    "ascMcStrokeBase",
    "chartRingStrokeFallback",
    "chartRingStrokeMin",
    "chartRingStrokeMax",
    "aspectClassicWidth",
    "aspectClassicDashOn",
    "aspectClassicDashOff",
    "aspectClassicThicknessMin",
    "aspectClassicThicknessMax",
    "aspectClassicThicknessDefault",
    "houseClassicOffsetScale",
    "houseSecondOffsetScale",
    "outerRadiusOffsetScale",
    "outerOutsidePadScale",
    "outerMotionRadiusScale",
    "outerMotionOffsetScale",
    "surveilTickLengthMin",
    "surveilTickLengthScale",
    "surveilGlyphGapMin",
    "surveilGlyphGapScale",
    "surveilGlyphSizeMin",
    "surveilGlyphSizeScale",
    "surveilLabelGapMin",
    "surveilLabelGapScale",
    "outerLabelEdgePadFactor",
})

_WHEEL_METRIC_PREFIX = "renderer.wheel.metric."


def _catalog_number(value: Any, unit: str = "") -> float | None:
    raw = str(value or "").strip()
    if unit and raw.endswith(unit):
        raw = raw[:-len(unit)]
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _profile_wheel_render_factors(profile: Any) -> MappingProxyType:
    """Return explicit Classic/Compact GraphChart metric multipliers.

    The daemon has already validated the profile. This subprocess repeats the
    finite/bounds checks defensively and converts values to multipliers against
    the generated web default. Multipliers preserve GraphChart's established
    default pixels even where its native font/DPI formula differs from Canvas.
    No explicit supported override means an empty mapping and preserves the
    historical Classic/Compact output pixel-for-pixel.
    """
    if not isinstance(profile, dict) or profile.get("kind") != "aries.style-profile":
        return MappingProxyType({})
    overrides = profile.get("overrides")
    if not isinstance(overrides, dict):
        return MappingProxyType({})

    factors: dict[str, float] = {}
    for semantic_id, value in overrides.items():
        if not isinstance(semantic_id, str) or not semantic_id.startswith(_WHEEL_METRIC_PREFIX):
            continue
        key = semantic_id[len(_WHEEL_METRIC_PREFIX):]
        if key not in _GRAPHCHART_WHEEL_METRICS:
            continue
        token = STYLE_PROFILE_TOKENS.get(semantic_id)
        if not isinstance(token, dict) or token.get("type") != "number":
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        number = float(value)
        if not math.isfinite(number):
            continue
        bounds = token.get("bounds")
        if isinstance(bounds, dict):
            if number < float(bounds.get("min", -math.inf)) or number > float(bounds.get("max", math.inf)):
                continue
        default = _catalog_number(token.get("default"), str(token.get("unit") or ""))
        if default is None or default <= 0:
            continue
        factors[key] = number / default
    return MappingProxyType(factors)


def _ensure_common(options: Any) -> None:
    common.ensure_swe_ready()
    common.common = common.Common()
    common.common.update(options)


def _pdf_chart_color_mode(options: Any) -> str:
    mode = str(getattr(options, "pdf_chart_color_mode", PDF_CHART_COLOR_MODE_MONOCHROME) or "")
    if mode == PDF_CHART_COLOR_MODE_COLORED_DETAILS:
        return mode
    return PDF_CHART_COLOR_MODE_MONOCHROME


def _pdf_include_overlays(options: Any) -> bool:
    return bool(getattr(options, "pdf_include_overlays", True))


def _profile_chart_options(options: Any, profile: Any) -> Any:
    """Adapt validated semantic chart colors to the retained GraphChart API.

    The daemon owns profile validation. This isolated export process receives
    that immutable payload explicitly, copies options, and never mutates live
    chart/session state. Renderer metrics for non-wheel surfaces remain present
    in the profile but are intentionally irrelevant to a standard wheel export.
    """
    if not isinstance(profile, dict) or profile.get("kind") != "aries.style-profile":
        return options
    overrides = profile.get("overrides")
    if not isinstance(overrides, dict):
        return options
    resolved = copy.copy(options)
    changed = False
    for semantic_id, attr in _PROFILE_CHART_COLOR_ATTRS.items():
        value = overrides.get(semantic_id)
        if not isinstance(value, (list, tuple)) or len(value) < 3:
            continue
        setattr(resolved, attr, _rgb_tuple(value, getattr(options, attr, (0, 0, 0))))
        changed = True
    return resolved if changed else options


def _rgb_tuple(value: Any, default: tuple[int, int, int]) -> tuple[int, int, int]:
    try:
        rgb = tuple(int(v) for v in value[:3])
        if len(rgb) == 3:
            return tuple(max(0, min(255, v)) for v in rgb)
    except Exception:
        pass
    return default


def _print_dignity_rgb(value: Any, default: tuple[int, int, int]) -> tuple[int, int, int]:
    rgb = _rgb_tuple(value, default)
    if max(rgb) - min(rgb) < 24:
        return (0, 0, 0)
    luminance = (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2])
    if luminance <= 176:
        return rgb
    factor = 176.0 / luminance
    return tuple(max(0, min(255, int(round(v * factor)))) for v in rgb)


def _pdf_print_options(options: Any, color_mode: str) -> Any:
    if color_mode != PDF_CHART_COLOR_MODE_COLORED_DETAILS:
        return options
    print_options = copy.copy(options)
    white = (255, 255, 255)
    black = (0, 0, 0)
    dignity_colors = bool(getattr(options, "dignitylabelcolors", False))
    individual_colors = bool(getattr(options, "useplanetcolors", False))
    setattr(print_options, "bw", False)
    for attr in ("clrbackground", "clrtable", "clrsidebar"):
        setattr(print_options, attr, white)
    for attr in (
        "clrtexts",
        "clrframe",
        "clrsigns",
        "clrAscMC",
        "clrhouses",
        "clrhousenumbers",
        "clrpositions",
    ):
        setattr(print_options, attr, black)
    if dignity_colors:
        setattr(print_options, "useplanetcolors", False)
        for attr, fallback in (
            ("clrdomicil", (40, 130, 70)),
            ("clrexal", (180, 130, 30)),
            ("clrcasus", (160, 80, 80)),
            ("clrexil", (200, 50, 50)),
        ):
            setattr(print_options, attr, _print_dignity_rgb(getattr(options, attr, fallback), fallback))
        setattr(print_options, "clrperegrin", black)
    elif not individual_colors:
        for attr in ("clrdomicil", "clrexal", "clrperegrin", "clrcasus", "clrexil"):
            setattr(print_options, attr, black)
    else:
        setattr(print_options, "clrperegrin", black)
    return print_options


def _render_chart(
    primary: Any,
    comparison: Any,
    options: Any,
    *,
    force_bw: bool = False,
    wheel_render_factors: Any = None,
) -> tuple[wx.Bitmap, Any]:
    app = wx.App.Get() or wx.App(False)
    _ = app
    renderer = graphchart.GraphChart(
        primary,
        (EXPORT_SIZE, EXPORT_SIZE),
        options,
        True if force_bw else getattr(options, "bw", False),
        chrt2=comparison,
        theme=getattr(options, "theme", None),
        visual_style=wheel_render_factors,
    )
    renderer.drawChart()
    bitmap = getattr(renderer, "buffer", None)
    if bitmap is None or not bitmap.IsOk():
        raise RuntimeError("chart renderer did not produce a bitmap")
    return bitmap, renderer


def export(payload_path: Path) -> None:
    with payload_path.open("rb") as fh:
        payload = pickle.load(fh)
    kind = payload["kind"]
    output_path = Path(payload["path"])
    options = payload["options"]
    primary = payload["primary"]
    comparison = payload.get("comparison")
    profile_options = _profile_chart_options(options, payload.get("styleProfile"))
    wheel_render_factors = _profile_wheel_render_factors(payload.get("styleProfile"))

    pdf_color_mode = _pdf_chart_color_mode(profile_options) if kind == "pdf" else ""
    render_options = _pdf_print_options(profile_options, pdf_color_mode) if kind == "pdf" else profile_options
    force_bw = kind == "pdf" and pdf_color_mode == PDF_CHART_COLOR_MODE_MONOCHROME

    _ensure_common(render_options)
    bitmap, renderer = _render_chart(
        primary,
        comparison,
        render_options,
        force_bw=force_bw,
        wheel_render_factors=wheel_render_factors,
    )
    if kind == "png":
        if not bitmap.SaveFile(str(output_path), wx.BITMAP_TYPE_PNG):
            raise RuntimeError("PNG export failed")
    elif kind == "pdf":
        pdfexport.export_bitmap_to_pdf(
            bitmap,
            str(output_path),
            title=payload.get("title") or getattr(primary, "name", "Aries Chart"),
            overlay_labels=getattr(renderer, "overlay_labels", None) if _pdf_include_overlays(options) else None,
        )
    else:
        raise RuntimeError(f"unsupported export kind: {kind}")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: export_chart_image.py PAYLOAD_PICKLE", file=sys.stderr)
        return 2
    try:
        export(Path(argv[1]))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
