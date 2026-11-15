# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Poster export: a print sheet painted by the web renderer in tiles.

A poster (A3 to A1 at 300 dpi, up to 70 megapixels) is larger than one
WebKit canvas, so the frontend paints it tile by tile with the production
renderer and uploads each tile here. The daemon stitches the tiles into
one sheet and writes it as a print-tagged PNG (sRGB profile, physical dpi)
or as a full-bleed PDF on the exact ISO sheet.
"""

from __future__ import annotations

import io
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from webapp.daemon.io_service import IoService

# ISO sheet sizes, millimetres, portrait (width, height); posters are portrait.
POSTER_SHEETS_MM: dict[str, tuple[int, int]] = {
    "A1": (594, 841),
    "A2": (420, 594),
    "A3": (297, 420),
}
POSTER_DPI = 300
# A1 at 300 dpi is 7016 x 9933.
POSTER_MAX_PIXELS = 72_000_000


def poster_pixel_size(sheet: str, dpi: int = POSTER_DPI) -> tuple[int, int]:
    """Pixel size of the portrait `sheet` at `dpi`, rounded like the frontend's sheet."""
    width_mm, height_mm = POSTER_SHEETS_MM[sheet]
    return round(width_mm / 25.4 * dpi), round(height_mm / 25.4 * dpi)


class _PosterJob:
    def __init__(self, sheet: str, width: int, height: int) -> None:
        from PIL import Image

        self.sheet = sheet
        self.width = width
        self.height = height
        self.image = Image.new("RGB", (width, height))
        self.covered = 0


class PosterExportService:
    """One poster at a time: a new poster abandons an unfinished one."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, _PosterJob] = {}

    def begin(self, *, sheet: str, width: int, height: int) -> dict[str, Any]:
        sheet = str(sheet or "").upper()
        if sheet not in POSTER_SHEETS_MM:
            raise ValueError(f"unsupported poster sheet: {sheet}")
        width, height = int(width), int(height)
        if (width, height) != poster_pixel_size(sheet):
            raise ValueError("poster pixel size does not match the sheet at 300 dpi")
        if width * height > POSTER_MAX_PIXELS:
            raise ValueError("poster exceeds the pixel budget")
        job = _PosterJob(sheet, width, height)
        job_id = uuid.uuid4().hex
        with self._lock:
            self._jobs.clear()
            self._jobs[job_id] = job
        return {"ok": True, "jobId": job_id, "width": width, "height": height}

    def add_tile(self, *, job_id: str, x: int, y: int, png_base64: str) -> dict[str, Any]:
        from PIL import Image

        job = self._job(job_id)
        png = IoService._decode_rendered_png(png_base64)
        tile_width, tile_height = IoService._png_dimensions(png)
        x, y = int(x), int(y)
        if x < 0 or y < 0 or x + tile_width > job.width or y + tile_height > job.height:
            raise ValueError("poster tile lies outside the sheet")
        with Image.open(io.BytesIO(png)) as tile:
            job.image.paste(tile.convert("RGB"), (x, y))
        job.covered += tile_width * tile_height
        return {"ok": True}

    def cancel(self, *, job_id: str) -> dict[str, Any]:
        with self._lock:
            self._jobs.pop(str(job_id), None)
        return {"ok": True}

    def finish(
        self,
        *,
        job_id: str,
        kind: str,
        path: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        job = self._job(job_id)
        if job.covered < job.width * job.height:
            raise ValueError("poster tiles do not cover the sheet")
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        destination = Path(raw_path).expanduser()
        resolved_kind = IoService._export_kind(kind, destination)
        if destination.suffix.lower() != f".{resolved_kind}":
            destination = destination.with_suffix(f".{resolved_kind}")
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")
        try:
            if resolved_kind == "png":
                self._write_png(job, destination)
            else:
                self._write_pdf(job, destination, title=title)
        finally:
            self.cancel(job_id=job_id)
        size = destination.stat().st_size
        if size <= 0:
            raise RuntimeError("poster export created an empty output file")
        return {
            "ok": True,
            "kind": resolved_kind,
            "path": str(destination),
            "bytes": size,
            "sheet": job.sheet,
        }

    def finish_bytes(
        self,
        *,
        job_id: str,
        kind: str,
        title: str | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        requested_kind = str(kind or "pdf").lower().strip()
        if requested_kind not in ("pdf", "png"):
            raise ValueError(f"unsupported export kind: {kind}")
        with tempfile.TemporaryDirectory(prefix="aries-poster-export-") as dirname:
            target = Path(dirname) / f"poster.{requested_kind}"
            summary = self.finish(job_id=job_id, kind=requested_kind, path=str(target), title=title)
            data = Path(str(summary["path"])).read_bytes()
        return {
            "ok": True,
            "kind": requested_kind,
            "filename": IoService._download_filename(filename, requested_kind),
            "mimeType": IoService._mime_type(requested_kind),
            "bytes": len(data),
            "data": data,
        }

    def _job(self, job_id: str) -> _PosterJob:
        with self._lock:
            job = self._jobs.get(str(job_id))
        if job is None:
            raise ValueError("poster export is no longer open")
        return job

    @staticmethod
    def _srgb_profile() -> bytes | None:
        try:
            from PIL import ImageCms

            return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        except Exception:
            return None

    @classmethod
    def _write_png(cls, job: _PosterJob, destination: Path) -> None:
        # The canvas paints sRGB; the profile and the physical resolution tell
        # the print service how to reproduce it and at what size.
        options: dict[str, Any] = {"dpi": (POSTER_DPI, POSTER_DPI)}
        profile = cls._srgb_profile()
        if profile:
            options["icc_profile"] = profile
        job.image.save(destination, "PNG", **options)

    @staticmethod
    def _write_pdf(job: _PosterJob, destination: Path, *, title: str | None) -> None:
        try:
            from reportlab.lib import pagesizes
            from reportlab.lib.utils import ImageReader
            from reportlab.pdfgen import canvas
        except Exception as exc:
            raise RuntimeError("PDF export requires ReportLab") from exc

        # Full bleed: the poster's own background is the sheet.
        page = getattr(pagesizes, job.sheet)
        doc = canvas.Canvas(str(destination), pagesize=page)
        poster_title = str(title or "Aries Poster")
        doc.setTitle(poster_title)
        doc.setAuthor("Aries")
        doc.setSubject(poster_title)
        doc.drawImage(ImageReader(job.image), 0, 0, width=page[0], height=page[1])
        doc.showPage()
        doc.save()


poster_export_service = PosterExportService()
