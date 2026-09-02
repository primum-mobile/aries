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
    """Daemon-owned selectable table/list/pane PDF backend.

    The frontend supplies a structured PDF document that preserves the mounted
    table's hierarchy and glyph runs. Clipboard/TXT never pass through this
    service. Rendering stays in an isolated subprocess so a long document can
    paginate without blocking the serving daemon.
    """
    def export_table(
        self,
        *,
        path: str,
        title: str,
        document: dict[str, Any],
    ) -> dict[str, Any]:
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        if not document:
            raise ValueError("cannot export an empty table")
        destination = Path(raw_path).expanduser()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")
        payload = {
            "path": str(destination),
            "title": str(title or "Table"),
            "document": document,
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
        filename: str | None = None,
        document: dict[str, Any],
    ) -> dict[str, Any]:
        """Render a table PDF to bytes for browser downloads."""
        with tempfile.TemporaryDirectory(prefix="aries-table-export-") as dirname:
            temp_path = Path(dirname) / "table.pdf"
            summary = self.export_table(
                path=str(temp_path),
                title=title,
                document=document,
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
