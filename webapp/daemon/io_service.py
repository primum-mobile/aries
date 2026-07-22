# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import base64
import binascii
import datetime
import os
import pickle
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chart
import aaf_import
import chartfile
import horfileio
import note_storage
import sfcht_import
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon import notes_service
from webapp.frontend.scripts import export_chart_json


class IoService:
    """Daemon-owned File I/O backend.

    Source oracle: morin.py:15096-15373. Native shells select filesystem paths;
    browser shells upload selected file bytes. All file reading, parsing,
    duplicate checks, and writes happen here through the existing Python import
    helpers.

    Export source oracle: morin.py:15534-15576, exportutil.py, pdfexport.py.
    The daemon resolves the active live chart session and owns the destination
    path; chart/PDF rendering runs in an isolated helper subprocess so daemon
    startup and request handling remain wx-free.
    """

    @property
    def _opts(self) -> Any:
        return chart_snapshot_service.options

    def import_charts(
        self,
        *,
        kind: str,
        paths: list[str],
        text: str | None = None,
        collection: str | None = None,
        files: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        selected = [str(Path(path).expanduser()) for path in paths if str(path or "").strip()]
        if kind == "aaf" and str(text or "").strip():
            return self._import_aaf_text(str(text or ""), collection=collection)
        if files:
            return self._import_uploaded_files(kind, files, collection=collection)
        if not selected:
            raise ValueError("no import path selected")
        if kind == "hor_folder":
            if len(selected) != 1:
                raise ValueError("HOR folder import expects exactly one folder")
            return self._import_hor_folder(Path(selected[0]))
        if kind == "jsonl":
            if len(selected) != 1:
                raise ValueError("JSONL import expects exactly one file")
            return self._import_jsonl(Path(selected[0]))
        if kind == "sfcht":
            return self._import_sfcht_files([Path(path) for path in selected])
        if kind == "aaf":
            return self._import_aaf_files([Path(path) for path in selected], collection=collection)
        raise ValueError(f"unsupported import kind: {kind}")

    def export_chart(
        self,
        *,
        kind: str,
        path: str,
        workspace: Any,
        document_id: str | None = None,
    ) -> dict[str, Any]:
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        destination = Path(raw_path).expanduser()
        resolved_kind = self._export_kind(kind, destination)
        if destination.suffix.lower() != f".{resolved_kind}":
            destination = destination.with_suffix(f".{resolved_kind}")
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")

        active_id = document_id or workspace.state().get("activeDocumentId")
        if not active_id:
            raise ValueError("no active chart to export")
        opts, primary, comparison = workspace.inspector_charts(active_id)
        if primary is None:
            raise ValueError("no active chart to export")
        # Export is a separate helper process, so carry the already-validated
        # semantic profile explicitly instead of asking it to rediscover CSS or
        # daemon state. The helper adapts chart roles before the final PDF print
        # transform; app-only roles remain irrelevant to chart output.
        from webapp.daemon.options_service import options_service
        active_style_profile, effective_export_options = (
            options_service.get_style_chart_render_context(opts)
        )

        payload = {
            "kind": resolved_kind,
            "path": str(destination),
            "title": self._export_title(primary),
            "options": effective_export_options,
            "primary": primary,
            "comparison": comparison,
            "styleProfile": active_style_profile,
        }
        with tempfile.NamedTemporaryFile(prefix="aries-export-", suffix=".pickle", delete=False) as fh:
            pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)
            payload_path = Path(fh.name)
        try:
            self._run_chart_export(payload_path)
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            raise RuntimeError(detail or "chart export failed") from exc
        finally:
            try:
                payload_path.unlink()
            except OSError:
                pass

        try:
            size = destination.stat().st_size
        except OSError as exc:
            raise RuntimeError("chart export did not create an output file") from exc
        if size <= 0:
            raise RuntimeError("chart export created an empty output file")
        return {
            "ok": True,
            "kind": resolved_kind,
            "path": str(destination),
            "bytes": size,
            "documentId": active_id,
        }

    @staticmethod
    def _run_chart_export(payload_path: Path) -> None:
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--export-chart-image", str(payload_path)]
        else:
            helper = REPO_ROOT / "webapp" / "frontend" / "scripts" / "export_chart_image.py"
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

    def export_chart_bytes(
        self,
        *,
        kind: str,
        workspace: Any,
        document_id: str | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        """Render a chart export to bytes for browser downloads.

        The semantic export path is still `export_chart`: this method only
        swaps the shell-owned destination path for a daemon temporary file.
        """
        requested_kind = str(kind or "pdf").lower().strip()
        if requested_kind == "auto":
            requested_kind = "pdf"
        if requested_kind not in ("pdf", "png"):
            raise ValueError(f"unsupported export kind: {kind}")

        with tempfile.TemporaryDirectory(prefix="aries-chart-export-") as dirname:
            temp_path = Path(dirname) / f"chart.{requested_kind}"
            summary = self.export_chart(
                kind=requested_kind,
                path=str(temp_path),
                workspace=workspace,
                document_id=document_id,
            )
            output_path = Path(str(summary["path"]))
            data = output_path.read_bytes()

        return {
            "ok": True,
            "kind": requested_kind,
            "filename": self._download_filename(filename, requested_kind),
            "mimeType": self._mime_type(requested_kind),
            "bytes": len(data),
            "data": data,
            "documentId": summary.get("documentId"),
        }

    def export_rendered_chart(
        self,
        *,
        kind: str,
        path: str,
        png_base64: str,
        width: int,
        height: int,
        title: str | None = None,
        document_id: str | None = None,
    ) -> dict[str, Any]:
        """Write a chart painted by the production web renderer.

        The daemon still owns filesystem access and PDF construction; the PNG
        pixels come from the same snapshot/Canvas renderer as the visible
        Tauri surface, so wheel grammar and display-only state cannot diverge.
        """
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        destination = Path(raw_path).expanduser()
        resolved_kind = self._export_kind(kind, destination)
        if destination.suffix.lower() != f".{resolved_kind}":
            destination = destination.with_suffix(f".{resolved_kind}")
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")

        png = self._decode_rendered_png(png_base64)
        actual_width, actual_height = self._png_dimensions(png)
        if int(width) != actual_width or int(height) != actual_height:
            raise ValueError("rendered chart dimensions do not match PNG data")
        if resolved_kind == "png":
            destination.write_bytes(png)
        else:
            self._write_rendered_chart_pdf(
                destination,
                png,
                actual_width,
                actual_height,
                title=title,
            )
        size = destination.stat().st_size
        if size <= 0:
            raise RuntimeError("chart export created an empty output file")
        return {
            "ok": True,
            "kind": resolved_kind,
            "path": str(destination),
            "bytes": size,
            "documentId": document_id,
        }

    def export_rendered_chart_bytes(
        self,
        *,
        kind: str,
        png_base64: str,
        width: int,
        height: int,
        title: str | None = None,
        document_id: str | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        requested_kind = str(kind or "pdf").lower().strip()
        if requested_kind not in ("pdf", "png"):
            raise ValueError(f"unsupported export kind: {kind}")
        with tempfile.TemporaryDirectory(prefix="aries-rendered-chart-export-") as dirname:
            target = Path(dirname) / f"chart.{requested_kind}"
            summary = self.export_rendered_chart(
                kind=requested_kind,
                path=str(target),
                png_base64=png_base64,
                width=width,
                height=height,
                title=title,
                document_id=document_id,
            )
            data = Path(str(summary["path"])).read_bytes()
        return {
            "ok": True,
            "kind": requested_kind,
            "filename": self._download_filename(filename, requested_kind),
            "mimeType": self._mime_type(requested_kind),
            "bytes": len(data),
            "data": data,
            "documentId": document_id,
        }

    @staticmethod
    def _decode_rendered_png(value: str) -> bytes:
        try:
            data = base64.b64decode(str(value or ""), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("rendered chart PNG is not valid base64") from exc
        if len(data) > 32 * 1024 * 1024:
            raise ValueError("rendered chart PNG exceeds 32 MiB")
        if not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("rendered chart payload is not a PNG")
        return data

    @staticmethod
    def _png_dimensions(data: bytes) -> tuple[int, int]:
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise ValueError("rendered chart PNG has no valid IHDR")
        width = int.from_bytes(data[16:20], byteorder="big", signed=False)
        height = int.from_bytes(data[20:24], byteorder="big", signed=False)
        if width <= 0 or height <= 0 or width > 8192 or height > 8192:
            raise ValueError("rendered chart PNG dimensions are invalid")
        return int(width), int(height)

    @staticmethod
    def _write_rendered_chart_pdf(
        destination: Path,
        png: bytes,
        width: int,
        height: int,
        *,
        title: str | None = None,
    ) -> None:
        try:
            from io import BytesIO
            from reportlab.lib import pagesizes
            from reportlab.lib.utils import ImageReader
            from reportlab.pdfgen import canvas
        except Exception as exc:
            raise RuntimeError("PDF export requires ReportLab") from exc

        margin = 36.0
        portrait = pagesizes.letter
        landscape = pagesizes.landscape(portrait)

        def fit(page):
            area_width = page[0] - 2 * margin
            area_height = page[1] - 2 * margin
            scale = min(area_width / width, area_height / height)
            image_width = width * scale
            image_height = height * scale
            left = margin + (area_width - image_width) / 2
            bottom = margin + (area_height - image_height) / 2
            return page, scale, image_width, image_height, left, bottom

        portrait_fit = fit(portrait)
        landscape_fit = fit(landscape)
        aspect = width / max(1.0, float(height))
        selected = (
            landscape_fit
            if aspect > 1.15 and landscape_fit[1] > portrait_fit[1] + 0.01
            else portrait_fit
        )
        page, _scale, image_width, image_height, left, bottom = selected
        doc = canvas.Canvas(str(destination), pagesize=page)
        chart_title = str(title or "Aries Chart Export")
        doc.setTitle(chart_title)
        doc.setAuthor("Aries")
        doc.setSubject(chart_title)
        doc.setFillColorRGB(1, 1, 1)
        doc.rect(0, 0, page[0], page[1], stroke=0, fill=1)
        doc.drawImage(
            ImageReader(BytesIO(png)),
            left,
            bottom,
            width=image_width,
            height=image_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        doc.showPage()
        doc.save()

    def export_text_file(
        self,
        *,
        path: str,
        text: str,
        extension: str = "txt",
    ) -> dict[str, Any]:
        raw_path = str(path or "").strip()
        if not raw_path:
            raise ValueError("no export path selected")
        destination = Path(raw_path).expanduser()
        suffix = self._text_export_suffix(extension)
        if not destination.suffix:
            destination = destination.with_suffix(suffix)
        if not destination.parent.exists():
            raise ValueError(f"export directory does not exist: {destination.parent}")
        data = str(text or "").encode("utf-8")
        destination.write_bytes(data)
        return {
            "ok": True,
            "kind": destination.suffix.lower().lstrip(".") or suffix.lstrip("."),
            "path": str(destination),
            "bytes": len(data),
        }

    @staticmethod
    def _text_export_suffix(extension: str) -> str:
        cleaned = str(extension or "txt").strip().lower().lstrip(".")
        if not cleaned:
            cleaned = "txt"
        if any(ch in cleaned for ch in "/\\:"):
            raise ValueError(f"unsupported export extension: {extension}")
        return f".{cleaned}"

    @staticmethod
    def _export_kind(kind: str, path: Path) -> str:
        cleaned = str(kind or "auto").lower().strip()
        if cleaned in ("png", "pdf"):
            return cleaned
        if cleaned != "auto":
            raise ValueError(f"unsupported export kind: {kind}")
        suffix = path.suffix.lower()
        if suffix == ".png":
            return "png"
        if suffix == ".pdf" or suffix == "":
            return "pdf"
        raise ValueError("export path must end in .pdf or .png")

    @staticmethod
    def _export_title(chrt: Any) -> str:
        name = str(getattr(chrt, "name", "") or "").strip()
        return name or "Aries Chart"

    @staticmethod
    def _download_filename(filename: str | None, kind: str) -> str:
        raw = Path(str(filename or "").strip()).name or "aries-chart"
        path = Path(raw)
        stem = path.stem or raw
        return f"{stem}.{kind}"

    @staticmethod
    def _mime_type(kind: str) -> str:
        return "image/png" if kind == "png" else "application/pdf"

    def _hors_dir(self) -> Path:
        canonical = Path(note_storage.charts_directory()).expanduser()
        if canonical.exists() or str(canonical):
            canonical.mkdir(parents=True, exist_ok=True)
            return canonical
        saved = Path(str(getattr(self._opts, "last_hor_dir", "") or "")).expanduser()
        if saved.exists() or str(saved):
            saved.mkdir(parents=True, exist_ok=True)
            return saved
        fallback = Path(export_chart_json.DEFAULT_SOURCE).expanduser().parent
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback

    def _existing_charts_for_duplicate_check(self) -> set[tuple[str, str, str]]:
        existing: set[tuple[str, str, str]] = set()
        hors_dir = self._hors_dir()
        if not hors_dir.exists():
            return existing
        for filename in os.listdir(hors_dir):
            if not filename.endswith(".jsonl"):
                continue
            collection_path = hors_dir / filename
            try:
                charts = chartfile.read_jsonl(str(collection_path))
            except Exception:
                continue
            for chart_dict in charts:
                key = self._record_duplicate_key(chart_dict)
                if key is not None:
                    existing.add(key)
        return existing

    def _resolve_collection_path(self, collection: str | None) -> Path:
        if not collection:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            return self._hors_dir() / f"AstroSeek_AAF_{timestamp}.jsonl"
        path = Path(str(collection).strip()).expanduser()
        if not path.is_absolute():
            path = self._hors_dir() / path
        if path.suffix.lower() != ".jsonl":
            path = path.with_suffix(".jsonl")
        return path

    def _import_uploaded_files(
        self,
        kind: str,
        files: list[dict[str, Any]],
        *,
        collection: str | None = None,
    ) -> dict[str, Any]:
        if not files:
            raise ValueError("no import files selected")
        with tempfile.TemporaryDirectory(prefix="aries-import-upload-") as dirname:
            root = Path(dirname)
            paths: list[Path] = []
            for index, file_payload in enumerate(files):
                name = self._upload_filename(file_payload, index)
                path = root / name
                if path.exists():
                    path = root / f"{index}_{name}"
                path.write_bytes(self._upload_bytes(file_payload, name))
                paths.append(path)

            if kind == "hor_folder":
                return self._import_hor_folder(root)
            if kind == "jsonl":
                if len(paths) != 1:
                    raise ValueError("JSONL import expects exactly one file")
                return self._import_jsonl(paths[0])
            if kind == "sfcht":
                return self._import_sfcht_files(paths)
            if kind == "aaf":
                return self._import_aaf_files(paths, collection=collection)
        raise ValueError(f"unsupported import kind: {kind}")

    @staticmethod
    def _upload_filename(file_payload: dict[str, Any], index: int) -> str:
        raw = str(
            file_payload.get("relativePath")
            or file_payload.get("name")
            or f"upload-{index}"
        ).replace("\\", "/")
        return Path(raw).name or f"upload-{index}"

    @staticmethod
    def _upload_bytes(file_payload: dict[str, Any], filename: str) -> bytes:
        data_base64 = str(file_payload.get("dataBase64") or "")
        try:
            return base64.b64decode(data_base64.encode("ascii"), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"invalid uploaded file data: {filename}") from exc

    @staticmethod
    def _record_duplicate_key(record: dict[str, Any]) -> tuple[str, str, str] | None:
        name = str(record.get("name", "") or "").lower().strip()
        date = str(record.get("date", "") or "")
        time = str(record.get("time", "") or "")
        if not name or not date or not time:
            return None
        return (name, date, time)

    @staticmethod
    def _sfcht_duplicate_key(record: dict[str, Any]) -> tuple[str, str, str]:
        return (
            str(record["name"] or "").lower().strip(),
            f"{record['year']}-{record['month']:02d}-{record['day']:02d}",
            f"{record['hour']:02d}:{record['minute']:02d}:{record['second']:02d}",
        )

    @staticmethod
    def _duplicate_label_from_key(name: str, date: str, time: str) -> str:
        return f"{name} ({date} {time[:5]})"

    @staticmethod
    def _error(path: Path, exc: Exception) -> dict[str, str]:
        return {"path": str(path), "message": str(exc)}

    @staticmethod
    def _lift_import_record(record: dict[str, Any]) -> dict[str, Any]:
        return notes_service.lift_legacy_record_notes(record)

    def _summary(
        self,
        *,
        kind: str,
        selected_paths: list[Path],
        collection_path: Path | None,
        imported_count: int,
        skipped_duplicates: list[str] | None = None,
        errors: list[dict[str, str]] | None = None,
        files_considered: int | None = None,
    ) -> dict[str, Any]:
        skipped_duplicates = skipped_duplicates or []
        errors = errors or []
        return {
            "ok": True,
            "kind": kind,
            "selectedPaths": [str(path) for path in selected_paths],
            "destinationCollectionPath": str(collection_path) if collection_path else "",
            "destinationCollectionName": collection_path.name if collection_path else "",
            "importedCount": imported_count,
            "skippedDuplicateCount": len(skipped_duplicates),
            "skippedDuplicates": skipped_duplicates,
            "errors": errors,
            "filesConsidered": files_considered if files_considered is not None else len(selected_paths),
        }

    def _import_jsonl(self, source: Path) -> dict[str, Any]:
        if source.suffix.lower() != ".jsonl":
            raise ValueError("selected file is not a JSONL collection")
        if not source.exists() or not source.is_file():
            raise ValueError(f"JSONL file does not exist: {source}")
        target = self._hors_dir() / source.name
        records = [self._lift_import_record(dict(record)) for record in chartfile.read_jsonl(str(source))]
        chartfile.write_jsonl(records, str(target))
        return self._summary(
            kind="jsonl",
            selected_paths=[source],
            collection_path=target,
            imported_count=len(records),
            files_considered=1,
        )

    def _import_hor_folder(self, folder_path: Path) -> dict[str, Any]:
        if not folder_path.exists() or not folder_path.is_dir():
            raise ValueError(f"HOR import folder does not exist: {folder_path}")
        hor_files = [
            folder_path / filename
            for filename in os.listdir(folder_path)
            if filename.lower().endswith(".hor")
        ]
        if not hor_files:
            return self._summary(
                kind="hor_folder",
                selected_paths=[folder_path],
                collection_path=None,
                imported_count=0,
                files_considered=0,
            )

        records: list[dict[str, Any]] = []
        duplicates: list[str] = []
        errors: list[dict[str, str]] = []
        existing_charts = self._existing_charts_for_duplicate_check()
        for fpath in hor_files:
            try:
                # Convert the raw .hor pickle values straight to the schema-v1
                # dict (chartfile.hor_values_to_dict) instead of routing through
                # horfileio.values_to_chart + chart_to_dict. The wx reader drops
                # the stored seconds-of-longitude (horfileio.py:53 hardcodes
                # seclon=0 even though values[19] carries it) — a precision-loss
                # defect we intentionally do NOT inherit on import: the dict
                # converter folds the real seclon/seclat into the decimal
                # coordinates (chartfile.py:539-544).
                values = horfileio.read_hor_values(str(fpath))
                record = chartfile.hor_values_to_dict(values)
                if len(values) <= 28:
                    # Legacy (<29-value) files carry no tzauto flag; mirror the
                    # wx reader's derivation (horfileio.py:51) instead of the
                    # dict converter's plain False default.
                    record["tzauto"] = (
                        values[11] == chart.Time.ZONE
                        and not values[3]
                        and values[10] == chart.Time.GREGORIAN
                    )
                key = self._record_duplicate_key(record)
                if key is not None and key in existing_charts:
                    duplicates.append(
                        self._duplicate_label_from_key(record.get("name", ""), key[1], key[2])
                    )
                    continue
                self._lift_import_record(record)
                records.append(record)
            except Exception as exc:
                errors.append(self._error(fpath, exc))

        collection_path = self._hors_dir() / f"{folder_path.name}.jsonl"
        added = 0
        if records:
            added = chartfile.merge_into_jsonl(records, str(collection_path))
        return self._summary(
            kind="hor_folder",
            selected_paths=[folder_path],
            collection_path=collection_path if records else None,
            imported_count=added,
            skipped_duplicates=duplicates,
            errors=errors,
            files_considered=len(hor_files),
        )

    def _import_sfcht_files(self, paths: list[Path]) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        duplicates: list[str] = []
        errors: list[dict[str, str]] = []
        existing_charts = self._existing_charts_for_duplicate_check()
        for fpath in paths:
            try:
                for record in sfcht_import.parse_sfcht(str(fpath)):
                    key = self._sfcht_duplicate_key(record)
                    if key in existing_charts:
                        duplicates.append(
                            self._duplicate_label_from_key(record["name"], key[1], key[2])
                        )
                        continue
                    records.append(self._lift_import_record(sfcht_import._record_to_v1_dict(record)))
            except Exception as exc:
                errors.append(self._error(fpath, exc))

        collection_path: Path | None = None
        added = 0
        if records:
            if len(paths) == 1:
                collection_filename = f"{paths[0].stem}.jsonl"
            else:
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                collection_filename = f"AstroGold_Combined_{timestamp}.jsonl"
            collection_path = self._hors_dir() / collection_filename
            added = chartfile.merge_into_jsonl(records, str(collection_path))
        return self._summary(
            kind="sfcht",
            selected_paths=paths,
            collection_path=collection_path,
            imported_count=added,
            skipped_duplicates=duplicates,
            errors=errors,
            files_considered=len(paths),
        )

    def _import_aaf_files(self, paths: list[Path], *, collection: str | None = None) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        duplicates: list[str] = []
        errors: list[dict[str, str]] = []
        existing_charts = self._existing_charts_for_duplicate_check()
        for fpath in paths:
            try:
                for record in aaf_import.parse_aaf(str(fpath)):
                    chart_record = aaf_import.record_to_v1_dict(record)
                    key = self._record_duplicate_key(chart_record)
                    if key is not None and key in existing_charts:
                        duplicates.append(
                            self._duplicate_label_from_key(chart_record.get("name", ""), key[1], key[2])
                        )
                        continue
                    records.append(self._lift_import_record(chart_record))
            except Exception as exc:
                errors.append(self._error(fpath, exc))

        collection_path: Path | None = None
        added = 0
        if records:
            if collection:
                collection_path = self._resolve_collection_path(collection)
            elif len(paths) == 1:
                collection_filename = f"{paths[0].stem}.jsonl"
                collection_path = self._hors_dir() / collection_filename
            else:
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                collection_filename = f"AAF_Combined_{timestamp}.jsonl"
                collection_path = self._hors_dir() / collection_filename
            added = chartfile.merge_into_jsonl(records, str(collection_path))
        return self._summary(
            kind="aaf",
            selected_paths=paths,
            collection_path=collection_path,
            imported_count=added,
            skipped_duplicates=duplicates,
            errors=errors,
            files_considered=len(paths),
        )

    def _import_aaf_text(self, text: str, *, collection: str | None = None) -> dict[str, Any]:
        records: list[dict[str, Any]] = []
        duplicates: list[str] = []
        existing_charts = self._existing_charts_for_duplicate_check()
        for record in aaf_import.parse_aaf_text(text, source_name="AAF paste"):
            chart_record = aaf_import.record_to_v1_dict(record)
            key = self._record_duplicate_key(chart_record)
            if key is not None and key in existing_charts:
                duplicates.append(
                    self._duplicate_label_from_key(chart_record.get("name", ""), key[1], key[2])
                )
                continue
            records.append(self._lift_import_record(chart_record))

        collection_path: Path | None = None
        added = 0
        if records:
            collection_path = self._resolve_collection_path(collection)
            added = chartfile.merge_into_jsonl(records, str(collection_path))
        return self._summary(
            kind="aaf",
            selected_paths=[],
            collection_path=collection_path,
            imported_count=added,
            skipped_duplicates=duplicates,
            errors=[],
            files_considered=1,
        )


io_service = IoService()
