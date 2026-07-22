# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Validated, content-addressed font assets for the browser Style Lab."""

from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping, Optional

from fontTools.ttLib import TTFont, TTLibError

from webapp.daemon.file_transaction import exclusive_file_transaction


MAX_FONT_BYTES = 16 * 1024 * 1024
MAX_FONT_STORE_BYTES = 128 * 1024 * 1024
MAX_FONT_ASSETS = 64
MANIFEST_KIND = "aries.style-font-assets"
MANIFEST_VERSION = 1
SUPPORTED_SIGNATURES = {
    b"\x00\x01\x00\x00": ("ttf", "font/ttf"),
    b"OTTO": ("otf", "font/otf"),
    b"wOFF": ("woff", "font/woff"),
    b"wOF2": ("woff2", "font/woff2"),
}


class StyleFontError(ValueError):
    pass


def _font_name(font: TTFont, name_id: int) -> str:
    table = font.get("name")
    if table is None:
        return ""
    value = table.getDebugName(name_id)
    return str(value or "").strip()


def _font_axes(font: TTFont) -> list[dict[str, Any]]:
    table = font.get("fvar")
    if table is None:
        return []
    return [
        {
            "tag": str(axis.axisTag),
            "minimum": float(axis.minValue),
            "default": float(axis.defaultValue),
            "maximum": float(axis.maxValue),
            "name": _font_name(font, int(axis.axisNameID)) or str(axis.axisTag),
        }
        for axis in table.axes
    ]


def _font_codepoints(font: TTFont) -> set[int]:
    cmap = font.getBestCmap() or {}
    return {int(codepoint) for codepoint in cmap}


class StyleFontStore:
    """Small atomic manifest beside user options; font bytes are hash-named."""

    def __init__(self, options_directory: str | os.PathLike[str], repo_root: Path) -> None:
        self._lock = threading.RLock()
        self.directory = Path(options_directory) / "style-fonts"
        self.manifest_path = self.directory / "manifest.json"
        self.repo_root = Path(repo_root)
        with exclusive_file_transaction(self.manifest_path):
            self._assets = self._load_manifest()
        self._symbol_reference: Optional[set[int]] = None

    @contextmanager
    def _transaction(self):
        with self._lock:
            with exclusive_file_transaction(self.manifest_path):
                self._assets = self._load_manifest()
                yield

    def _load_manifest(self) -> dict[str, dict[str, Any]]:
        if not self.manifest_path.is_file():
            return {}
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise StyleFontError(f"could not load style font manifest: {exc}") from exc
        if not isinstance(payload, Mapping) or payload.get("kind") != MANIFEST_KIND:
            raise StyleFontError("invalid style font manifest")
        if payload.get("version") != MANIFEST_VERSION or not isinstance(payload.get("assets"), Mapping):
            raise StyleFontError("unsupported style font manifest")
        result: dict[str, dict[str, Any]] = {}
        for asset_id, metadata in payload["assets"].items():
            if isinstance(asset_id, str) and isinstance(metadata, Mapping):
                result[asset_id] = dict(metadata)
        return result

    def _write_manifest(self, assets: Mapping[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        rendered = json.dumps(
            {"kind": MANIFEST_KIND, "version": MANIFEST_VERSION, "assets": assets},
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        ) + "\n"
        descriptor, temp_name = tempfile.mkstemp(
            prefix=".manifest.", suffix=".tmp", dir=str(self.directory)
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(rendered)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.manifest_path)
        except Exception:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise

    def _required_symbol_codepoints(self) -> set[int]:
        if self._symbol_reference is not None:
            return self._symbol_reference
        reference_path = self.repo_root / "Res" / "Morinus.ttf"
        try:
            with TTFont(reference_path, lazy=False) as reference:
                self._symbol_reference = _font_codepoints(reference)
        except (OSError, TTLibError) as exc:
            raise StyleFontError(f"could not read bundled Morinus glyph reference: {exc}") from exc
        return self._symbol_reference

    def list_assets(self) -> dict[str, Any]:
        with self._transaction():
            return {"assets": [deepcopy(value) for value in self._assets.values()]}

    def asset(self, asset_id: str) -> dict[str, Any]:
        with self._transaction():
            asset = self._assets.get(asset_id)
            if asset is None:
                raise StyleFontError(f"unknown style font asset: {asset_id}")
            return deepcopy(asset)

    def asset_path(self, asset_id: str) -> Path:
        asset = self.asset(asset_id)
        path = (self.directory / str(asset["fileName"])).resolve()
        try:
            path.relative_to(self.directory.resolve())
        except ValueError as exc:
            raise StyleFontError("invalid style font asset path") from exc
        if not path.is_file():
            raise StyleFontError(f"style font bytes are missing: {asset_id}")
        return path

    def add(
        self,
        data: bytes,
        *,
        original_name: str,
        role: str = "text",
        license_note: str = "",
    ) -> dict[str, Any]:
        if not data or len(data) > MAX_FONT_BYTES:
            raise StyleFontError(f"font must contain 1 to {MAX_FONT_BYTES} bytes")
        signature = data[:4]
        if signature not in SUPPORTED_SIGNATURES:
            raise StyleFontError("font must be TTF, OTF, WOFF, or WOFF2")
        if role not in {"text", "symbols"}:
            raise StyleFontError("font role must be text or symbols")
        if len(original_name) > 240 or len(license_note) > 1000:
            raise StyleFontError("font metadata is too long")

        extension, media_type = SUPPORTED_SIGNATURES[signature]
        try:
            with TTFont(io.BytesIO(data), lazy=False) as font:
                family = _font_name(font, 16) or _font_name(font, 1)
                subfamily = _font_name(font, 17) or _font_name(font, 2) or "Regular"
                postscript_name = _font_name(font, 6)
                codepoints = _font_codepoints(font)
                axes = _font_axes(font)
        except (TTLibError, OSError, ValueError) as exc:
            raise StyleFontError(f"font validation failed: {exc}") from exc
        if not family or not codepoints:
            raise StyleFontError("font is missing a family name or Unicode character map")

        missing_symbols: list[int] = []
        if role == "symbols":
            missing_symbols = sorted(self._required_symbol_codepoints() - codepoints)
            if missing_symbols:
                raise StyleFontError(
                    f"symbol font is missing {len(missing_symbols)} required Aries glyphs"
                )

        digest = hashlib.sha256(data).hexdigest()
        asset_id = f"font-{digest[:20]}"
        file_name = f"{digest}.{extension}"
        metadata = {
            "id": asset_id,
            # Profiles store this content-addressed alias, not the font's
            # potentially ambiguous embedded family name. The browser can
            # therefore restore the exact asset after a restart.
            "cssFamily": f"AriesFont_{asset_id.replace('-', '_')}",
            "contentHash": digest,
            "fileName": file_name,
            "originalName": Path(original_name).name,
            "family": family,
            "subfamily": subfamily,
            "postscriptName": postscript_name,
            "role": role,
            "mediaType": media_type,
            "byteLength": len(data),
            "glyphCount": len(codepoints),
            "axes": axes,
            "licenseNote": license_note.strip(),
            "symbolCoverage": "complete" if role == "symbols" else "not-required",
        }

        with self._transaction():
            is_new = asset_id not in self._assets
            if is_new and len(self._assets) >= MAX_FONT_ASSETS:
                raise StyleFontError(f"at most {MAX_FONT_ASSETS} style font assets may be stored")
            stored_bytes = sum(
                int(value.get("byteLength") or 0) for value in self._assets.values()
            )
            if is_new and stored_bytes + len(data) > MAX_FONT_STORE_BYTES:
                raise StyleFontError(
                    f"style font assets may use at most {MAX_FONT_STORE_BYTES} bytes"
                )
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.directory / file_name
            if not path.exists():
                descriptor, temp_name = tempfile.mkstemp(
                    prefix=f".{digest}.", suffix=".tmp", dir=str(self.directory)
                )
                try:
                    with os.fdopen(descriptor, "wb") as handle:
                        handle.write(data)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(temp_name, path)
                except Exception:
                    try:
                        os.unlink(temp_name)
                    except OSError:
                        pass
                    raise
            assets = deepcopy(self._assets)
            assets[asset_id] = metadata
            self._write_manifest(assets)
            self._assets = assets
        return deepcopy(metadata)
