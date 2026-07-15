#!/usr/bin/env python3
"""Render a table/list/pane export payload to a PDF using the wx-free Platypus
path in ``pdfexport.export_table_document``.

This helper intentionally lives outside ``webapp/daemon``: the daemon must stay
wx-free (``pdfexport`` imports wx at module scope), but the rendered table/list
PDF export still has to reuse the EXACT wx renderer
(``commonwnd.onSaveAsBitmap`` / ``exportutil.save_bitmap_or_pdf`` /
``pdfexport.export_table_document``), not a second exporter. The daemon
serializes the structured table payload the view already holds
(``GenericTablePayload`` columns + rows) to a temporary JSON file and this helper
writes the selected PDF path via reportlab Platypus LongTable — the same
multi-page, wrapping, Morinus-glyph table renderer wx uses for its
``pdf_export_spec``-driven table windows.

Input JSON shape (one cell == one ``GenericTableCell`` dict):

    {
        "path": "/abs/out.pdf",
        "title": "Firdaria (Diurnal)",
        "header_lines": ["Native ...", ...],
        "columns": [{"label": str, "align": "L"/"C"/"R",
                     "width": float, "glyph": bool}, ...],
        "rows": [[cell, cell, ...], ...]
    }

A ``cell`` is ``{"text": str, "glyph": str, "color": "#rrggbb",
"runs": [{"text": str, "glyph": bool, "color": "#rrggbb"}], "emphasis": str}``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pdfexport  # noqa: E402  (wx-importing module — runs only in this subprocess)


def _cell_to_spec(cell: Any) -> Any:
    """Map one GenericTableCell dict to a pdfexport cell spec.

    pdfexport._cell_to_paragraph_markup accepts: plain str; a (role, text[,
    color]) tuple; or a list of such tuples for mixed-font runs. We translate the
    daemon cell encoding into that vocabulary so glyphs render in the Morinus
    'symbol' role and per-run colors survive.
    """
    if cell is None:
        return ""
    if isinstance(cell, str):
        return cell
    if not isinstance(cell, dict):
        return str(cell)

    runs = cell.get("runs")
    if runs:
        parts = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            text = run.get("text") or ""
            if not text:
                continue
            role = "symbol" if run.get("glyph") else "text"
            color = run.get("color")
            parts.append((role, text, color) if color else (role, text))
        return parts or ""

    glyph = cell.get("glyph")
    text = cell.get("text") or ""
    color = cell.get("color")
    bold = cell.get("emphasis") == "strong"
    parts = []
    if glyph:
        parts.append(("symbol", glyph, color) if color else ("symbol", glyph))
    if text:
        role = "bold" if bold else "text"
        parts.append((role, text, color) if color else (role, text))
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return parts


def _align(value: Any) -> str:
    mapped = {"left": "L", "center": "C", "right": "R"}.get(str(value or "").lower())
    return mapped or "L"


def export(payload_path: Path) -> None:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    out_path = payload["path"]
    title = payload.get("title") or "Aries Table Export"
    header_lines = payload.get("header_lines") or None

    columns = []
    for col in payload.get("columns") or []:
        columns.append(
            {
                "label": ("symbol", col.get("label", "")) if col.get("glyph") else col.get("label", ""),
                "align": _align(col.get("align")),
                "width": max(0.01, float(col.get("width", 1.0))),
            }
        )

    rows = [[_cell_to_spec(cell) for cell in row] for row in (payload.get("rows") or [])]

    pdfexport.export_table_document(
        out_path,
        title,
        columns,
        rows,
        header_lines=header_lines,
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: export_table_pdf.py PAYLOAD_JSON", file=sys.stderr)
        return 2
    try:
        export(Path(argv[1]))
    except Exception as exc:  # surfaced to the daemon via stderr
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
