# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class TableExportService:
    """Daemon-owned rendered-table/list/pane export backend.

    Source oracle: commonwnd.py:163-179 (the shared SaveAsBitmap menu item),
    exportutil.save_bitmap_or_pdf, pdfexport.export_table_document (the wx
    Platypus LongTable table-PDF renderer). The wx app exports the visible
    table/list as a rendered PDF; the webapp already holds the identical
    structured table truth (GenericTablePayload columns + rows, built by the
    daemon table builders), so we render exactly that payload to PDF.

    PDF rendering runs in an isolated helper subprocess: pdfexport imports wx at
    module scope, so keeping it out of the serving daemon avoids wx/AppKit
    process crashes. The Tauri shell owns native destination paths; browser
    fallback receives bytes from a daemon temporary file and downloads them as a
    Blob.
    """
    def export_table(
        self,
        *,
        path: str,
        title: str,
        columns: list[dict[str, Any]],
        rows: list[list[Any]],
        header_lines: list[str] | None = None,
    ) -> dict[str, Any]:
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        if not columns:
            raise ValueError("cannot export a table with no columns")
        destination = Path(raw_path).expanduser()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")
        payload = {
            "path": str(destination),
            "title": str(title or "Table"),
            "header_lines": [str(line) for line in (header_lines or []) if line],
            "columns": columns,
            "rows": rows,
        }
        with tempfile.NamedTemporaryFile(
            prefix="aries-table-export-", suffix=".json", delete=False, mode="w", encoding="utf-8"
        ) as fh:
            json.dump(payload, fh)
            payload_path = Path(fh.name)
        try:
            self._run_table_export(payload_path)
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            raise RuntimeError(detail or "table export failed") from exc
        finally:
            try:
                payload_path.unlink()
            except OSError:
                pass

        try:
            size = destination.stat().st_size
        except OSError as exc:
            raise RuntimeError("table export did not create an output file") from exc
        if size <= 0:
            raise RuntimeError("table export created an empty output file")
        return {"ok": True, "kind": "pdf", "path": str(destination), "bytes": size}

    @staticmethod
    def _run_table_export(payload_path: Path) -> None:
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--export-table-pdf", str(payload_path)]
        else:
            helper = REPO_ROOT / "webapp" / "frontend" / "scripts" / "export_table_pdf.py"
            if not helper.exists():
                raise RuntimeError(f"missing export helper: {helper}")
            command = [sys.executable, str(helper), str(payload_path)]
        subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def export_table_bytes(
        self,
        *,
        title: str,
        columns: list[dict[str, Any]],
        rows: list[list[Any]],
        header_lines: list[str] | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        """Render a table PDF to bytes for browser downloads."""
        with tempfile.TemporaryDirectory(prefix="aries-table-export-") as dirname:
            temp_path = Path(dirname) / "table.pdf"
            summary = self.export_table(
                path=str(temp_path),
                title=title,
                columns=columns,
                rows=rows,
                header_lines=header_lines,
            )
            data = Path(str(summary["path"])).read_bytes()
        return {
            "ok": True,
            "kind": "pdf",
            "filename": self._download_filename(filename),
            "mimeType": "application/pdf",
            "bytes": len(data),
            "data": data,
        }

    @staticmethod
    def _download_filename(filename: str | None) -> str:
        raw = Path(str(filename or "").strip()).name or "table"
        stem = Path(raw).stem or raw
        return f"{stem}.pdf"


table_export_service = TableExportService()
