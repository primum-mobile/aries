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
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import common
import graphchart
import pdfexport
import wx


EXPORT_SIZE = 1600
PDF_CHART_COLOR_MODE_MONOCHROME = "monochrome"
PDF_CHART_COLOR_MODE_COLORED_DETAILS = "colored-details"


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


def _render_chart(primary: Any, comparison: Any, options: Any, *, force_bw: bool = False) -> tuple[wx.Bitmap, Any]:
    app = wx.App.Get() or wx.App(False)
    _ = app
    renderer = graphchart.GraphChart(
        primary,
        (EXPORT_SIZE, EXPORT_SIZE),
        options,
        True if force_bw else getattr(options, "bw", False),
        chrt2=comparison,
        theme=getattr(options, "theme", None),
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

    pdf_color_mode = _pdf_chart_color_mode(options) if kind == "pdf" else ""
    render_options = _pdf_print_options(options, pdf_color_mode) if kind == "pdf" else options
    force_bw = kind == "pdf" and pdf_color_mode == PDF_CHART_COLOR_MODE_MONOCHROME

    _ensure_common(render_options)
    bitmap, renderer = _render_chart(primary, comparison, render_options, force_bw=force_bw)
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
