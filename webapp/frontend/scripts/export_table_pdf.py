#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Render structured Aries table/list data as selectable PDFs.

PDFs deliberately use the same bundled FreeSans + Morinus pairing as the live
Tauri tables. Clipboard and TXT exports are a separate tab-delimited pipeline;
this helper never lays out plain text or assumes a monospace font.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    LongTable,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
RESOURCE_ROOT = Path(os.environ.get("ARIES_DAEMON_BASE_DIR", REPO_ROOT))
FONT_ROOT = RESOURCE_ROOT / "Res"

UI_FONT = "AriesPdfUi"
UI_BOLD_FONT = "AriesPdfUiBold"
SYMBOL_FONT = "AriesPdfSymbols"
ARABIC_FONT = "AriesPdfArabic"
FALLBACK_FONTS = (
    ("AriesPdfKorean", FONT_ROOT / "NotoSansKR-Regular.ttf"),
    ("AriesPdfChineseSC", FONT_ROOT / "NotoSansSC-Regular.ttf"),
    ("AriesPdfChineseTC", FONT_ROOT / "NotoSansTC-Regular.ttf"),
)

BLACK = colors.HexColor("#000000")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ARABIC_WORD_RE = re.compile(r"[\u0600-\u06ff\u0750-\u077f]+")


# isolated, final, initial, medial presentation forms. The PDF runtime does not
# ship HarfBuzz, so these forms keep the small Arabic scholarly cells legible
# and correctly joined without adding another daemon dependency.
ARABIC_FORMS: dict[str, tuple[str, str | None, str | None, str | None]] = {
    "\u0621": ("\ufe80", None, None, None),
    "\u0622": ("\ufe81", "\ufe82", None, None),
    "\u0623": ("\ufe83", "\ufe84", None, None),
    "\u0624": ("\ufe85", "\ufe86", None, None),
    "\u0625": ("\ufe87", "\ufe88", None, None),
    "\u0626": ("\ufe89", "\ufe8a", "\ufe8b", "\ufe8c"),
    "\u0627": ("\ufe8d", "\ufe8e", None, None),
    "\u0628": ("\ufe8f", "\ufe90", "\ufe91", "\ufe92"),
    "\u0629": ("\ufe93", "\ufe94", None, None),
    "\u062a": ("\ufe95", "\ufe96", "\ufe97", "\ufe98"),
    "\u062b": ("\ufe99", "\ufe9a", "\ufe9b", "\ufe9c"),
    "\u062c": ("\ufe9d", "\ufe9e", "\ufe9f", "\ufea0"),
    "\u062d": ("\ufea1", "\ufea2", "\ufea3", "\ufea4"),
    "\u062e": ("\ufea5", "\ufea6", "\ufea7", "\ufea8"),
    "\u062f": ("\ufea9", "\ufeaa", None, None),
    "\u0630": ("\ufeab", "\ufeac", None, None),
    "\u0631": ("\ufead", "\ufeae", None, None),
    "\u0632": ("\ufeaf", "\ufeb0", None, None),
    "\u0633": ("\ufeb1", "\ufeb2", "\ufeb3", "\ufeb4"),
    "\u0634": ("\ufeb5", "\ufeb6", "\ufeb7", "\ufeb8"),
    "\u0635": ("\ufeb9", "\ufeba", "\ufebb", "\ufebc"),
    "\u0636": ("\ufebd", "\ufebe", "\ufebf", "\ufec0"),
    "\u0637": ("\ufec1", "\ufec2", "\ufec3", "\ufec4"),
    "\u0638": ("\ufec5", "\ufec6", "\ufec7", "\ufec8"),
    "\u0639": ("\ufec9", "\ufeca", "\ufecb", "\ufecc"),
    "\u063a": ("\ufecd", "\ufece", "\ufecf", "\ufed0"),
    "\u0641": ("\ufed1", "\ufed2", "\ufed3", "\ufed4"),
    "\u0642": ("\ufed5", "\ufed6", "\ufed7", "\ufed8"),
    "\u0643": ("\ufed9", "\ufeda", "\ufedb", "\ufedc"),
    "\u0644": ("\ufedd", "\ufede", "\ufedf", "\ufee0"),
    "\u0645": ("\ufee1", "\ufee2", "\ufee3", "\ufee4"),
    "\u0646": ("\ufee5", "\ufee6", "\ufee7", "\ufee8"),
    "\u0647": ("\ufee9", "\ufeea", "\ufeeb", "\ufeec"),
    "\u0648": ("\ufeed", "\ufeee", None, None),
    "\u0649": ("\ufeef", "\ufef0", None, None),
    "\u064a": ("\ufef1", "\ufef2", "\ufef3", "\ufef4"),
    "\u067e": ("\ufb56", "\ufb57", "\ufb58", "\ufb59"),
    "\u0686": ("\ufb7a", "\ufb7b", "\ufb7c", "\ufb7d"),
    "\u0698": ("\ufb8a", "\ufb8b", None, None),
    "\u06a9": ("\ufb8e", "\ufb8f", "\ufb90", "\ufb91"),
    "\u06af": ("\ufb92", "\ufb93", "\ufb94", "\ufb95"),
    "\u06cc": ("\ufbfc", "\ufbfd", "\ufbfe", "\ufbff"),
}


def _safe_color(value: Any) -> colors.Color:
    candidate = str(value or "").strip()
    return colors.HexColor(candidate) if HEX_COLOR_RE.fullmatch(candidate) else BLACK


def _register_fonts() -> dict[str, set[int]]:
    required = {
        UI_FONT: FONT_ROOT / "FreeSans.ttf",
        UI_BOLD_FONT: FONT_ROOT / "FreeSansBold.ttf",
        SYMBOL_FONT: FONT_ROOT / "Morinus.ttf",
    }
    for name, path in required.items():
        if not path.is_file():
            raise FileNotFoundError(f"missing PDF font: {path}")
        pdfmetrics.registerFont(TTFont(name, str(path)))

    coverage: dict[str, set[int]] = {
        name: set(pdfmetrics.getFont(name).face.charWidths) for name in required
    }
    arabic_path = FONT_ROOT / "NotoNaskhArabic-Regular.ttf"
    if arabic_path.is_file():
        pdfmetrics.registerFont(TTFont(ARABIC_FONT, str(arabic_path)))
        coverage[ARABIC_FONT] = set(pdfmetrics.getFont(ARABIC_FONT).face.charWidths)
    for name, path in FALLBACK_FONTS:
        if path.is_file():
            pdfmetrics.registerFont(TTFont(name, str(path)))
            coverage[name] = set(pdfmetrics.getFont(name).face.charWidths)
    return coverage


def _is_mark(char: str) -> bool:
    return 0x064B <= ord(char) <= 0x065F or ord(char) == 0x0670


def _shape_arabic_word(word: str) -> str:
    clusters: list[tuple[str, str]] = []
    for char in word:
        if _is_mark(char) and clusters:
            base, marks = clusters[-1]
            clusters[-1] = (base, marks + char)
        else:
            clusters.append((char, ""))

    shaped: list[str] = []
    for index, (char, marks) in enumerate(clusters):
        forms = ARABIC_FORMS.get(char)
        if forms is None:
            shaped.append(char + marks)
            continue
        previous = clusters[index - 1][0] if index > 0 else None
        following = clusters[index + 1][0] if index + 1 < len(clusters) else None
        previous_forms = ARABIC_FORMS.get(previous or "")
        following_forms = ARABIC_FORMS.get(following or "")
        joins_previous = bool(previous_forms and previous_forms[2] and forms[1])
        joins_following = bool(forms[2] and following_forms and following_forms[1])
        if joins_previous and joins_following and forms[3]:
            glyph = forms[3]
        elif joins_previous and forms[1]:
            glyph = forms[1]
        elif joins_following and forms[2]:
            glyph = forms[2]
        else:
            glyph = forms[0]
        shaped.append(glyph + marks)
    return "".join(reversed(shaped))


def _visual_text(text: str) -> str:
    return ARABIC_WORD_RE.sub(lambda match: _shape_arabic_word(match.group(0)), text)


def _text_runs(text: str, coverage: dict[str, set[int]], *, bold: bool = False) -> list[tuple[str, str]]:
    value = _visual_text(str(text or ""))
    runs: list[tuple[str, str]] = []
    for char in value:
        codepoint = ord(char)
        if 0xFE70 <= codepoint <= 0xFEFF and ARABIC_FONT in coverage:
            font_name = ARABIC_FONT
        elif codepoint in coverage[UI_FONT]:
            font_name = UI_BOLD_FONT if bold else UI_FONT
        else:
            font_name = next(
                (name for name, chars in coverage.items() if name not in {UI_FONT, UI_BOLD_FONT, SYMBOL_FONT} and codepoint in chars),
                UI_FONT,
            )
            if font_name == UI_FONT and codepoint not in coverage[UI_FONT]:
                char = "?"
        if runs and runs[-1][0] == font_name:
            runs[-1] = (font_name, runs[-1][1] + char)
        else:
            runs.append((font_name, char))
    return runs


def _font_markup(font_name: str, text: str, color: Any = None) -> str:
    color_attr = f' color="{str(color)}"' if color and HEX_COLOR_RE.fullmatch(str(color)) else ""
    return f'<font name="{font_name}"{color_attr}>{escape(str(text or ""))}</font>'


def _plain_markup(text: str, coverage: dict[str, set[int]], *, bold: bool = False) -> str:
    return "".join(_font_markup(font_name, run) for font_name, run in _text_runs(text, coverage, bold=bold))


def _cell_markup(cell: Any, coverage: dict[str, set[int]], *, row_bold: bool = False) -> str:
    if cell is None:
        return ""
    if not isinstance(cell, dict):
        return _plain_markup(str(cell), coverage, bold=row_bold)
    bold = row_bold or cell.get("emphasis") == "strong"
    glyph_color = cell.get("color")
    runs = cell.get("runs")
    if isinstance(runs, list) and runs:
        fragments: list[str] = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            value = str(run.get("text") or "")
            if not value:
                continue
            if run.get("glyph"):
                fragments.append(_font_markup(SYMBOL_FONT, value, run.get("color") or glyph_color))
            else:
                fragments.append(_plain_markup(value, coverage, bold=bold))
        return "".join(fragments)
    fragments = []
    glyph = str(cell.get("glyph") or "")
    if glyph:
        fragments.append(_font_markup(SYMBOL_FONT, glyph, glyph_color))
    value = str(cell.get("text") or "")
    if value:
        fragments.append(_plain_markup(value, coverage, bold=bold))
    return "".join(fragments)


def _plain_width(text: str, font_size: float, coverage: dict[str, set[int]], *, bold: bool = False) -> float:
    return sum(
        pdfmetrics.stringWidth(run, font_name, font_size)
        for font_name, run in _text_runs(text, coverage, bold=bold)
    )


def _cell_width(cell: Any, font_size: float, coverage: dict[str, set[int]], *, row_bold: bool = False) -> float:
    if cell is None:
        return 0.0
    if not isinstance(cell, dict):
        return _plain_width(str(cell), font_size, coverage, bold=row_bold)
    bold = row_bold or cell.get("emphasis") == "strong"
    runs = cell.get("runs")
    if isinstance(runs, list) and runs:
        return sum(
            pdfmetrics.stringWidth(str(run.get("text") or ""), SYMBOL_FONT, font_size)
            if isinstance(run, dict) and run.get("glyph")
            else _plain_width(str(run.get("text") or ""), font_size, coverage, bold=bold)
            for run in runs
            if isinstance(run, dict)
        )
    width = _plain_width(str(cell.get("text") or ""), font_size, coverage, bold=bold)
    if cell.get("glyph"):
        width += pdfmetrics.stringWidth(str(cell.get("glyph")), SYMBOL_FONT, font_size)
    return width


def _normalize_row(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        cells = row.get("cells")
        return {**row, "cells": cells if isinstance(cells, list) else []}
    return {"cells": row if isinstance(row, list) else []}


def _structured_sections(document: dict[str, Any]) -> list[dict[str, Any]]:
    sections = document.get("sections")
    if isinstance(sections, list) and sections:
        return [section for section in sections if isinstance(section, dict)]
    columns = document.get("columns")
    if isinstance(columns, list):
        return [{"columns": columns, "rows": document.get("rows") or []}]
    return []


def _page_geometry(document: dict[str, Any]) -> tuple[tuple[float, float], float]:
    profile = str(document.get("profile") or "standard")
    matrix = document.get("matrix")
    if isinstance(matrix, dict):
        if matrix.get("kind") == "fixedStar":
            return A4, 8.2
        total = 1 + len(matrix.get("ascmc") or []) + len(matrix.get("planets") or []) + len(matrix.get("houses") or [])
        return (A3 if total > 19 else A4), 8.6
    if profile == "strip":
        return landscape(A4), 9.2
    if profile == "almuten-chart":
        return landscape(A4), 9.2
    sections = _structured_sections(document)
    max_columns = max((len(section.get("columns") or []) for section in sections), default=1)
    if profile in {"directions", "circumambulation"}:
        return A4, 9.2
    if max_columns <= 6:
        return A4, 9.2
    if max_columns <= 10:
        return landscape(A4), 8.6
    return landscape(A3), 8.0


def _natural_widths(
    columns: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    font_size: float,
    coverage: dict[str, set[int]],
) -> list[float]:
    widths: list[float] = []
    for index, column in enumerate(columns):
        label = str(column.get("label") or "")
        header_width = (
            pdfmetrics.stringWidth(label, SYMBOL_FONT, font_size + 0.5)
            if column.get("glyph")
            else _plain_width(label, font_size, coverage, bold=True)
        )
        content_width = header_width
        for row in rows[:240]:
            cells = row.get("cells") or []
            if index < len(cells):
                content_width = max(
                    content_width,
                    _cell_width(cells[index], font_size, coverage, row_bold=row.get("emphasis") == "strong"),
                )
        widths.append(max(25.0, min(210.0, content_width + 13.0)))
    return widths


def _column_widths(
    columns: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    available_width: float,
    font_size: float,
    coverage: dict[str, set[int]],
    *,
    compact: bool,
) -> list[float]:
    natural = _natural_widths(columns, rows, font_size, coverage)
    if compact and sum(natural) <= available_width:
        return natural
    weights: list[float] = []
    for index, column in enumerate(columns):
        try:
            weights.append(max(0.3, float(column["width"])))
        except (KeyError, TypeError, ValueError):
            weights.append(natural[index])
    total = sum(weights) or 1.0
    return [available_width * weight / total for weight in weights]


def _hierarchy_column(columns: list[dict[str, Any]], profile: str) -> int | None:
    ids = [str(column.get("id") or "").lower() for column in columns]
    if profile == "time-lord":
        for candidate in ("body", "planet", "ruler", "sign"):
            if candidate in ids:
                return ids.index(candidate)
    if profile == "circumambulation":
        return 2 if len(columns) > 2 else None
    return None


class CurrentRowMarker(Flowable):
    """Inset current-period rail that cannot close into a selection box."""

    def __init__(self, content: Paragraph):
        super().__init__()
        self.content = content
        self.content_width = 0.0
        self.content_height = 0.0

    def wrap(self, avail_width: float, avail_height: float) -> tuple[float, float]:
        self.content_width, self.content_height = self.content.wrap(max(1.0, avail_width - 5.0), avail_height)
        self.width = avail_width
        self.height = self.content_height
        return self.width, self.height

    def draw(self) -> None:
        pdf = self.canv
        pdf.saveState()
        pdf.setStrokeColor(BLACK)
        pdf.setLineWidth(1.6)
        pdf.line(0, 1.0, 0, max(1.0, self.height - 1.0))
        pdf.restoreState()
        self.content.drawOn(pdf, 5.0, 0)


def _make_table(
    section: dict[str, Any],
    available_width: float,
    font_size: float,
    coverage: dict[str, set[int]],
    *,
    profile: str = "standard",
    compact: bool = False,
) -> Table:
    columns = [column for column in (section.get("columns") or []) if isinstance(column, dict)]
    rows = [_normalize_row(row) for row in (section.get("rows") or [])]
    body_style = ParagraphStyle(
        "AriesPdfBody",
        fontName=UI_FONT,
        fontSize=font_size,
        leading=font_size * 1.28,
        textColor=BLACK,
        splitLongWords=False,
    )
    alignments = {"left": 0, "center": 1, "right": 2}
    header_cells: list[Paragraph] = []
    for column in columns:
        label = str(column.get("label") or "")
        markup = (
            _font_markup(SYMBOL_FONT, label, column.get("color"))
            if column.get("glyph")
            else _plain_markup(label, coverage, bold=True)
        )
        style = ParagraphStyle(
            "AriesPdfHeaderCell",
            parent=body_style,
            fontName=UI_BOLD_FONT,
            leading=font_size * 1.35,
            alignment=alignments.get(str(column.get("align") or "left").lower(), 0),
        )
        header_cells.append(Paragraph(markup or "&#160;", style))

    hierarchy_index = _hierarchy_column(columns, profile)
    table_data: list[list[Any]] = [header_cells]
    for row in rows:
        row_cells = list((row.get("cells") or [])[: len(columns)])
        row_cells.extend([None] * max(0, len(columns) - len(row_cells)))
        rendered: list[Any] = []
        for index, cell in enumerate(row_cells):
            column = columns[index]
            align = cell.get("align") if isinstance(cell, dict) else None
            level = max(0, int(row.get("level") or 0))
            hierarchy_level = level if profile == "circumambulation" else max(0, level - 1)
            alignment = "left" if hierarchy_index == index else str(align or column.get("align") or "left").lower()
            style = ParagraphStyle(
                "AriesPdfCell",
                parent=body_style,
                alignment=alignments.get(alignment, 0),
                leftIndent=(hierarchy_level * 14.0 if hierarchy_index == index else 0),
            )
            content = Paragraph(
                _cell_markup(cell, coverage, row_bold=row.get("emphasis") == "strong") or "&#160;",
                style,
            )
            rendered.append(CurrentRowMarker(content) if row.get("current") and index == 0 else content)
        table_data.append(rendered)

    widths = _column_widths(columns, rows, available_width, font_size, coverage, compact=compact)
    table_class = Table if compact else LongTable
    table = table_class(table_data, colWidths=widths, repeatRows=1, splitByRow=1, hAlign="LEFT")
    commands: list[tuple[Any, ...]] = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5.5),
        ("TOPPADDING", (0, 0), (-1, 0), 4.0),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4.5),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, BLACK),
        ("TOPPADDING", (0, 1), (-1, -1), 3.0),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3.0),
        ("LINEBELOW", (0, 1), (-1, -1), 0.18, BLACK),
    ]
    for row_index, row in enumerate(rows, start=1):
        if row.get("kind") == "group":
            commands.extend([
                ("LINEABOVE", (0, row_index), (-1, row_index), 0.65, BLACK),
                ("TOPPADDING", (0, row_index), (-1, row_index), 4.5),
                ("BOTTOMPADDING", (0, row_index), (-1, row_index), 4.0),
            ])
    table.setStyle(TableStyle(commands))
    return table


def _panel_width(section: dict[str, Any], available_width: float, font_size: float, coverage: dict[str, set[int]]) -> float:
    columns = [column for column in (section.get("columns") or []) if isinstance(column, dict)]
    rows = [_normalize_row(row) for row in (section.get("rows") or [])]
    return min(available_width, sum(_natural_widths(columns, rows, font_size, coverage)))


def _make_panel(
    section: dict[str, Any],
    width: float,
    font_size: float,
    coverage: dict[str, set[int]],
    section_style: ParagraphStyle,
) -> Table:
    contents: list[list[Any]] = []
    section_title = str(section.get("title") or "").strip()
    if section_title:
        contents.append([Paragraph(_plain_markup(section_title, coverage, bold=True), section_style)])
    contents.append([_make_table(section, width, font_size, coverage, compact=True)])
    panel = Table(contents, colWidths=[width], hAlign="LEFT")
    panel.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return panel


def _section_panels(
    sections: list[dict[str, Any]],
    available_width: float,
    font_size: float,
    coverage: dict[str, set[int]],
    section_style: ParagraphStyle,
) -> list[Any]:
    gap = 11.0
    story: list[Any] = []
    row_panels: list[Table] = []
    row_widths: list[float] = []

    def flush() -> None:
        if not row_panels:
            return
        widths = [width + (gap if index < len(row_widths) - 1 else 0) for index, width in enumerate(row_widths)]
        row = Table([row_panels.copy()], colWidths=widths, hAlign="LEFT")
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.extend([row, Spacer(1, 10)])
        row_panels.clear()
        row_widths.clear()

    for section in sections:
        width = _panel_width(section, available_width, font_size, coverage)
        too_tall = len(section.get("rows") or []) > 25
        too_wide = len(section.get("columns") or []) > 7
        if too_tall or too_wide:
            flush()
            title = str(section.get("title") or "").strip()
            if title:
                story.append(Paragraph(_plain_markup(title, coverage, bold=True), section_style))
            story.extend([_make_table(section, available_width, font_size, coverage), Spacer(1, 10)])
            continue
        occupied = sum(row_widths) + gap * len(row_widths)
        if row_panels and occupied + width > available_width:
            flush()
        row_panels.append(_make_panel(section, width, font_size, coverage, section_style))
        row_widths.append(width)
    flush()
    return story


def _almuten_chart_panels(
    sections: list[dict[str, Any]],
    available_width: float,
    font_size: float,
    coverage: dict[str, set[int]],
    section_style: ParagraphStyle,
) -> list[Any]:
    """Preserve the app's Almuten workspace composition on paper.

    The large essential table owns the upper-left; the four compact score
    panels and the total panel retain their established grouped reading order.
    The A3 landscape sheet is the paper analogue of this deliberately wide
    workspace surface, rather than a generic sequence of unrelated tables.
    """
    if len(sections) != 6:
        return _section_panels(sections, available_width, font_size, coverage, section_style)

    gap = 12.0

    def panel_row(indexes: list[int]) -> Table:
        natural = [
            max(90.0, _panel_width(sections[index], available_width, font_size, coverage))
            for index in indexes
        ]
        usable = available_width - gap * (len(indexes) - 1)
        total = sum(natural)
        widths = [width * usable / total for width in natural]
        panels = [
            _make_panel(sections[index], width, font_size, coverage, section_style)
            for index, width in zip(indexes, widths)
        ]
        row = Table([panels], colWidths=[
            width + (gap if position < len(widths) - 1 else 0)
            for position, width in enumerate(widths)
        ], hAlign="LEFT")
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return row

    return [
        panel_row([0, 1, 2, 3]),
        Spacer(1, 12),
        panel_row([4, 5]),
    ]


class AspectMatrixFlowable(Flowable):
    def __init__(self, width: float, matrix: dict[str, Any]):
        super().__init__()
        self.available_width = width
        self.matrix = matrix
        self.fixed = matrix.get("kind") == "fixedStar"
        self.gap = 7.0
        if self.fixed:
            self.rows = matrix.get("rows") or []
            self.cols = matrix.get("cols") or []
            self.rail = min(112.0, max(88.0, width * 0.19))
            self.cell = min(23.0, (width - self.rail) / max(1, len(self.cols)))
            self.width = self.rail + self.cell * len(self.cols)
            self.height = self.cell * (len(self.rows) + 1)
        else:
            self.planets = matrix.get("planets") or []
            self.ascmc = matrix.get("ascmc") or []
            self.houses = matrix.get("houses") or []
            gap_count = int(bool(self.ascmc)) + int(bool(self.houses))
            total_cols = 1 + len(self.ascmc) + len(self.planets) + len(self.houses)
            self.cell = min(28.0, (width - gap_count * self.gap) / max(1, total_cols))
            self.rail = self.cell
            self.angle_x = self.rail
            self.planet_x = self.angle_x + len(self.ascmc) * self.cell + (self.gap if self.ascmc else 0.0)
            self.house_x = self.planet_x + len(self.planets) * self.cell + (self.gap if self.houses else 0.0)
            self.width = self.house_x + len(self.houses) * self.cell
            self.height = self.cell * (len(self.planets) + 1)

    def split(self, avail_width: float, avail_height: float) -> list[Flowable]:
        if not self.fixed or self.height <= avail_height:
            return [self]
        if avail_height < self.cell * 2:
            return []
        # Leave one full cell of slack: Platypus subtracts frame fuzz after
        # split() and otherwise rejects a chunk that lands exactly on the
        # reported boundary.
        max_rows = max(1, int(avail_height // self.cell) - 2)
        source_rows = list(self.matrix.get("rows") or [])
        source_cells = self.matrix.get("cells") or {}
        chunks: list[Flowable] = []
        for start in range(0, len(source_rows), max_rows):
            rows = source_rows[start:start + max_rows]
            cells: dict[str, Any] = {}
            for local_row, source_row in enumerate(range(start, start + len(rows))):
                for col_index, _entry in enumerate(self.cols):
                    value = source_cells.get(f"row:{source_row}:col:{col_index}")
                    if value is not None:
                        cells[f"row:{local_row}:col:{col_index}"] = value
            chunks.append(AspectMatrixFlowable(
                min(self.available_width, avail_width),
                {**self.matrix, "rows": rows, "cells": cells},
            ))
        return chunks

    def _cell_rect(self, x: float, row: int, width: float | None = None) -> tuple[float, float, float, float]:
        width = self.cell if width is None else width
        y = self.height - (row + 1) * self.cell
        return x, y, width, self.cell

    def _thin_box(self, pdf: canvas.Canvas, x: float, row: int, width: float | None = None) -> tuple[float, float, float, float]:
        x, y, width, height = self._cell_rect(x, row, width)
        pdf.setStrokeColor(BLACK)
        pdf.setLineWidth(0.18)
        pdf.rect(x, y, width, height, stroke=1, fill=0)
        return x, y, width, height

    def _block_outline(self, pdf: canvas.Canvas, x: float, y: float, width: float, height: float) -> None:
        if width <= 0 or height <= 0:
            return
        pdf.setStrokeColor(BLACK)
        pdf.setLineWidth(0.85)
        pdf.rect(x, y, width, height, stroke=1, fill=0)

    def _stair_outline(self, pdf: canvas.Canvas) -> None:
        count = len(self.planets)
        if count == 0:
            return
        top = self.height - self.cell
        path = pdf.beginPath()
        path.moveTo(self.planet_x, top)
        path.lineTo(self.planet_x + self.cell, top)
        for step in range(count - 1):
            y = top - (step + 1) * self.cell
            path.lineTo(self.planet_x + (step + 1) * self.cell, y)
            path.lineTo(self.planet_x + (step + 2) * self.cell, y)
        path.lineTo(self.planet_x + count * self.cell, 0)
        path.lineTo(self.planet_x, 0)
        path.close()
        pdf.setStrokeColor(BLACK)
        pdf.setLineWidth(0.9)
        pdf.drawPath(path, stroke=1, fill=0)

    def _axis(self, pdf: canvas.Canvas, entry: dict[str, Any], x: float, row: int, width: float | None = None) -> None:
        x, y, width, height = self._cell_rect(x, row, width)
        glyph = str(entry.get("glyph") or "")
        if glyph:
            font = UI_FONT if entry.get("glyphFont") == "text" else SYMBOL_FONT
            pdf.setFont(font, min(13.5, self.cell * 0.46))
            pdf.setFillColor(_safe_color(entry.get("color")))
            pdf.drawCentredString(x + width / 2, y + height / 2 - self.cell * 0.15, glyph)
        else:
            pdf.setFont(UI_BOLD_FONT, min(7.8, self.cell * 0.26))
            pdf.setFillColor(BLACK)
            pdf.drawCentredString(x + width / 2, y + height / 2 - self.cell * 0.09, str(entry.get("label") or ""))

    def _aspect(self, pdf: canvas.Canvas, cell: dict[str, Any] | None, x: float, row: int) -> None:
        x, y, width, height = self._cell_rect(x, row)
        if not cell:
            return
        if cell.get("exact"):
            pdf.setFillColor(BLACK)
            pdf.circle(x + width - 3.7, y + height - 3.7, 1.15, stroke=0, fill=1)
        if cell.get("applying"):
            pdf.setFillColor(BLACK)
            path = pdf.beginPath()
            path.moveTo(x, y + height)
            path.lineTo(x + 4.0, y + height)
            path.lineTo(x, y + height - 4.0)
            path.close()
            pdf.drawPath(path, stroke=0, fill=1)
        glyph = str(cell.get("glyph") or "")
        if glyph:
            font = UI_FONT if cell.get("glyphFont") == "text" else SYMBOL_FONT
            pdf.setFont(font, min(10.5, self.cell * 0.38))
            pdf.setFillColor(_safe_color(cell.get("color")))
            pdf.drawString(x + 4.0, y + height - min(11.0, self.cell * 0.42), glyph)
        if cell.get("parallel"):
            pdf.setFont(SYMBOL_FONT, min(8.5, self.cell * 0.29))
            pdf.setFillColor(BLACK)
            pdf.drawRightString(x + width - 3.5, y + height - min(9.5, self.cell * 0.36), "Y" if cell.get("parallel") == "contraparallel" else "X")
        pdf.setFont(UI_FONT, min(7.2, self.cell * 0.25))
        pdf.setFillColor(BLACK)
        pdf.drawCentredString(x + width / 2, y + 3.1, str(cell.get("orb") or ""))

    def draw(self) -> None:
        pdf = self.canv
        matrix_cells = self.matrix.get("cells") or {}
        if self.fixed:
            pdf.setStrokeColor(BLACK)
            pdf.setLineWidth(0.18)
            for boundary in range(len(self.rows) + 2):
                y = self.height - boundary * self.cell
                pdf.line(0, y, self.width, y)
            pdf.setLineWidth(0.85)
            pdf.line(0, self.height, self.width, self.height)
            pdf.line(0, self.height - self.cell, self.width, self.height - self.cell)
            pdf.line(0, 0, self.width, 0)
            for col_index, entry in enumerate(self.cols):
                self._axis(pdf, entry, self.rail + col_index * self.cell, 0)
            for row_index, entry in enumerate(self.rows):
                x, y, _width, height = self._cell_rect(0, row_index + 1, self.rail)
                pdf.setFillColor(BLACK)
                pdf.setFont(UI_FONT, min(7.5, self.cell * 0.3))
                label = str(entry.get("label") or "")
                pdf.drawString(x + 4.0, y + height / 2 - self.cell * 0.09, label[:28])
                for col_index, _entry in enumerate(self.cols):
                    self._aspect(
                        pdf,
                        matrix_cells.get(f"row:{row_index}:col:{col_index}"),
                        self.rail + col_index * self.cell,
                        row_index + 1,
                    )
            return

        for row_index, _entry in enumerate(self.planets):
            self._thin_box(pdf, 0, row_index + 1)
        for index, _entry in enumerate(self.ascmc):
            x = self.angle_x + index * self.cell
            self._thin_box(pdf, x, 0)
            for row_index, _planet in enumerate(self.planets):
                self._thin_box(pdf, x, row_index + 1)
        for row_index, _entry in enumerate(self.planets):
            for col_index in range(row_index + 1):
                self._thin_box(pdf, self.planet_x + col_index * self.cell, row_index + 1)
        for index, _entry in enumerate(self.houses):
            x = self.house_x + index * self.cell
            self._thin_box(pdf, x, 0)
            for row_index, _planet in enumerate(self.planets):
                self._thin_box(pdf, x, row_index + 1)

        body_height = self.cell * len(self.planets)
        self._block_outline(pdf, 0, 0, self.rail, body_height)
        self._block_outline(pdf, self.angle_x, 0, len(self.ascmc) * self.cell, self.height)
        self._stair_outline(pdf)
        self._block_outline(pdf, self.house_x, 0, len(self.houses) * self.cell, self.height)

        for index, entry in enumerate(self.ascmc):
            self._axis(pdf, entry, self.angle_x + index * self.cell, 0)
        for index, entry in enumerate(self.houses):
            self._axis(pdf, entry, self.house_x + index * self.cell, 0)
        for row_index, row_entry in enumerate(self.planets):
            row = row_index + 1
            self._axis(pdf, row_entry, 0, row)
            for angle_index, _entry in enumerate(self.ascmc):
                self._aspect(
                    pdf,
                    matrix_cells.get(f"ascmc:{angle_index}:planet:{row_entry.get('planet')}"),
                    self.angle_x + angle_index * self.cell,
                    row,
                )
            for col_index, col_entry in enumerate(self.planets):
                x = self.planet_x + col_index * self.cell
                if col_index == row_index:
                    self._axis(pdf, col_entry, x, row)
                elif col_index < row_index:
                    self._aspect(
                        pdf,
                        matrix_cells.get(f"planet:{col_entry.get('planet')}:planet:{row_entry.get('planet')}"),
                        x,
                        row,
                    )
            for house_index, _entry in enumerate(self.houses):
                self._aspect(
                    pdf,
                    matrix_cells.get(f"house:{house_index}:planet:{row_entry.get('planet')}"),
                    self.house_x + house_index * self.cell,
                    row,
                )


class StripFlowable(Flowable):
    def __init__(self, width: float, strip: dict[str, Any]):
        super().__init__()
        self.width = width
        self.height = 136.0
        self.strip = strip

    def draw(self) -> None:
        pdf = self.canv
        left = 14.0
        right = self.width - 14.0
        axis_y = 42.0
        axis_width = right - left
        pdf.setStrokeColor(BLACK)
        pdf.setFillColor(BLACK)
        pdf.setLineWidth(0.55)
        pdf.line(left, axis_y, right, axis_y)
        for degree in range(31):
            x = left + axis_width * degree / 30.0
            tick = 8.0 if degree % 5 == 0 else 4.0
            pdf.line(x, axis_y, x, axis_y - tick)
            if degree % 5 == 0:
                pdf.setFont(UI_FONT, 7.5)
                pdf.drawCentredString(x, axis_y - 19.0, str(degree))

        bodies: list[dict[str, Any]] = []
        for sign in self.strip.get("signs") or []:
            for body in sign.get("bodies") or []:
                bodies.append({**body, "signGlyph": sign.get("signGlyph") or ""})
        bodies.sort(key=lambda body: float(body.get("degree") or 0.0))
        placed: list[float] = []
        minimum = 18.0
        for body in bodies:
            true_x = left + axis_width * float(body.get("degree") or 0.0) / 30.0
            placed.append(max(true_x, (placed[-1] + minimum) if placed else left))
        overflow = (placed[-1] - right) if placed else 0.0
        if overflow > 0:
            placed = [value - overflow for value in placed]
            for index in range(len(placed) - 2, -1, -1):
                placed[index] = min(placed[index], placed[index + 1] - minimum)
        if placed and placed[0] < left:
            shift = left - placed[0]
            placed = [value + shift for value in placed]

        for body, display_x in zip(bodies, placed):
            true_x = left + axis_width * float(body.get("degree") or 0.0) / 30.0
            color = _safe_color(body.get("colorHex"))
            pdf.setStrokeColor(color)
            pdf.setLineWidth(0.45)
            pdf.line(true_x, axis_y, display_x, 82.0)
            font = SYMBOL_FONT if body.get("glyphFont") == "morinus" else UI_BOLD_FONT
            pdf.setFont(font, 13.0)
            pdf.setFillColor(color)
            pdf.drawCentredString(display_x, 87.0, str(body.get("glyph") or ""))


def _strip_legend(strip: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for sign in strip.get("signs") or []:
        sign_glyph = str(sign.get("signGlyph") or "")
        for body in sign.get("bodies") or []:
            color = body.get("colorHex")
            rows.append({
                "cells": [
                    {
                        "exportText": body.get("label") or "",
                        "runs": [{"text": body.get("glyph") or "", "glyph": body.get("glyphFont") == "morinus", "color": color}],
                    },
                    {"glyph": sign_glyph},
                    {"text": body.get("minuteLabel") or "", "align": "right"},
                ]
            })
    return {
        "columns": [
            {"label": "Body", "align": "left", "width": 2.0},
            {"label": "Sign", "align": "center", "width": 1.0},
            {"label": "Position", "align": "right", "width": 1.4},
        ],
        "rows": rows,
    }


def _render(output: Path, title: str, document: dict[str, Any], coverage: dict[str, set[int]]) -> None:
    if not document:
        raise ValueError("structured PDF document is empty")
    page_size, font_size = _page_geometry(document)
    margin = 13 * mm
    printable_width = page_size[0] - 2 * margin
    printable_height = page_size[1] - 2 * margin
    profile = str(document.get("profile") or "standard")

    title_style = ParagraphStyle(
        "AriesPdfTitle",
        fontName=UI_BOLD_FONT,
        fontSize=15.0,
        leading=18.0,
        textColor=BLACK,
        spaceAfter=2.0,
    )
    subtitle_style = ParagraphStyle(
        "AriesPdfSubtitle",
        fontName=UI_FONT,
        fontSize=9.0,
        leading=11.0,
        textColor=BLACK,
    )
    section_style = ParagraphStyle(
        "AriesPdfSection",
        fontName=UI_BOLD_FONT,
        fontSize=10.0,
        leading=12.0,
        textColor=BLACK,
        spaceBefore=8.0,
        spaceAfter=3.0,
    )

    doc = BaseDocTemplate(
        str(output),
        pagesize=page_size,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
        title=title,
        author="Aries",
        subject=title,
    )
    frame = Frame(margin, margin, printable_width, printable_height, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="content")

    def on_page(pdf: canvas.Canvas, current_doc: BaseDocTemplate) -> None:
        pdf.saveState()
        pdf.setFont(UI_FONT, 7.0)
        pdf.setFillColor(BLACK)
        pdf.drawRightString(page_size[0] - margin, margin * 0.42, str(current_doc.page))
        pdf.restoreState()

    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=on_page)])
    story: list[Any] = [Paragraph(_plain_markup(title, coverage, bold=True), title_style)]
    header_lines = [str(line) for line in (document.get("headerLines") or []) if str(line or "").strip()]
    for line in header_lines:
        if str(line or "").strip():
            story.append(Paragraph(_plain_markup(str(line), coverage), subtitle_style))
    story.append(Spacer(1, 7 if header_lines else 14))

    matrix = document.get("matrix")
    strip = document.get("strip")
    if isinstance(matrix, dict):
        story.append(AspectMatrixFlowable(printable_width, matrix))
    elif isinstance(strip, dict):
        story.extend([
            StripFlowable(printable_width, strip),
            Spacer(1, 8),
            _make_table(_strip_legend(strip), min(330.0, printable_width), font_size, coverage, compact=True),
        ])
    else:
        sections = _structured_sections(document)
        if not sections or not any(section.get("columns") for section in sections):
            raise ValueError("structured PDF document has no columns")
        if profile == "almuten-chart":
            story.extend(_almuten_chart_panels(sections, printable_width, font_size, coverage, section_style))
        elif len(sections) > 1:
            story.extend(_section_panels(sections, printable_width, font_size, coverage, section_style))
        else:
            section = sections[0]
            section_title = str(section.get("title") or "").strip()
            if section_title:
                story.append(Paragraph(_plain_markup(section_title, coverage, bold=True), section_style))
            story.append(_make_table(section, printable_width, font_size, coverage, profile=profile))
    doc.build(story)


def export(payload_path: Path) -> None:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    output = Path(payload["path"])
    title = str(payload.get("title") or "Aries Table Export")
    document = payload.get("document")
    if not isinstance(document, dict):
        raise ValueError("structured PDF document is required")
    coverage = _register_fonts()
    _render(output, title, document, coverage)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: export_table_pdf.py PAYLOAD_JSON", file=sys.stderr)
        return 2
    try:
        export(Path(argv[1]))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
