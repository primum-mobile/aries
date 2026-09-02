# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Map-book PDF export for daemon-produced Astrocartography maps.

The preferred input is a bounded set of fully rendered Aries map captures:
one world overview followed by overlapping regional sheets.  Those captures
are embedded without recolouring or redrawing their astrology content, so the
PDF is a faithful printed form of the in-app map.  The existing single
equirectangular basemap plus daemon GeoJSON remains supported as an offline and
backwards-compatible fallback.

All reader-facing prose comes from the caller or from localized properties in
the GeoJSON.  When a localized label is absent, semantic identifiers such as
``MC``, ``transit``, or ``trine`` are used as technical fallbacks.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
import json
from math import isfinite
import os
from pathlib import Path
import struct
import tempfile
import threading
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ASTROCART_PDF_SCHEMA = "aries.astrocart-pdf"
ASTROCART_PDF_SCHEMA_VERSION = 1

PAGE_FORMAT_A4 = "A4"
PAGE_FORMAT_A3 = "A3"
PAGE_FORMATS = (PAGE_FORMAT_A4, PAGE_FORMAT_A3)

KIND_PARAN = "PARAN"
KIND_ASPECT = "ASPECT"
KIND_ZENITH = "ZENITH"
KIND_LOCAL_SPACE = "LOCAL_SPACE"
KIND_LOCAL_SPACE_OPPOSITION = "LOCAL_SPACE_OPPOSITION"

LAYER_NATAL = "natal"
LAYER_TRANSIT = "transit"
LAYER_PROGRESSION = "progression"

_WORLD_RESOURCE = Path("Res") / "astrocart" / "natural-earth-admin0-110m.geojson"
_FONT_LOCK = threading.Lock()
_REGISTERED_FONT_FAMILIES: set[str] = set()

_DEFAULT_STYLE: dict[str, Any] = {
    "pageBg": "#ffffff",
    "oceanColor": "#fafafa",
    "borderColor": "#55585b",
    "casing": "rgba(255,255,255,0.94)",
    "labelColor": "#161719",
    "labelHalo": "rgba(255,255,255,0.96)",
    "paranColor": "#242628",
    "fallbackMcColor": "#e74c3c",
    "fallbackIcColor": "#8e44ad",
    "fallbackAscColor": "#2e9f60",
    "fallbackDscColor": "#d47d05",
    "fallbackUnknownColor": "#666b72",
    "casingWidth": 3.0,
    "casingOpacity": 0.75,
    "solidWidth": 1.6,
    "solidOpacity": 0.95,
    "dashedWidth": 1.6,
    "dashedOpacity": 0.95,
    "dashedOn": 3.0,
    "dashedOff": 2.0,
    "paranWidth": 1.0,
    "paranOpacity": 0.55,
    "paranDashOn": 1.0,
    "paranDashOff": 2.0,
}

COLOR_MODE_MONOCHROME = "monochrome"
COLOR_MODE_COLORED_DETAILS = "colored-details"
COLOR_MODES = (COLOR_MODE_MONOCHROME, COLOR_MODE_COLORED_DETAILS)

_PNG_DATA_URL_PREFIX = "data:image/png;base64,"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_MAX_BASEMAP_DATA_URL_CHARS = 32_000_000
_MAX_BASEMAP_BYTES = 24_000_000
_MAX_BASEMAP_DIMENSION = 4096
_MAX_ATLAS_PAGES = 32
_MAX_ATLAS_TOTAL_BYTES = 128_000_000
_MAX_ATLAS_DIMENSION = 8192
# Retained only for the legacy, non-rendered helper functions below. The atlas
# renderer never creates auxiliary index pages.
_INDEX_COLUMN_COUNT = 2
_INDEX_ROWS_PER_COLUMN = 42
_OSM_ATTRIBUTION = (
    "Data © OpenStreetMap contributors · "
    "https://www.openstreetmap.org/copyright"
)
_NATURAL_EARTH_ATTRIBUTION = "Natural Earth · naturalearthdata.com"


def _base_dir() -> Path:
    configured = os.environ.get("ARIES_DAEMON_BASE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def _resource_path(relative_path: Path) -> Path:
    return _base_dir() / relative_path


def _sequence_values(value: Any) -> Sequence[Any]:
    if isinstance(value, str):
        return (value,)
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return value
    return ()


def _normalized_values(value: Any, *, case: str | None = None) -> tuple[str, ...]:
    normalized: set[str] = set()
    for raw in _sequence_values(value):
        text = str(raw).strip()
        if not text:
            continue
        if case == "upper":
            text = text.upper()
        elif case == "lower":
            text = text.lower()
        normalized.add(text)
    return tuple(sorted(normalized))


def _mapping_field(
    payload: Mapping[str, Any],
    camel_name: str,
    snake_name: str,
) -> tuple[bool, Any]:
    if camel_name in payload:
        return True, payload[camel_name]
    if snake_name in payload:
        return True, payload[snake_name]
    return False, None


@dataclass(frozen=True, slots=True)
class AstrocartPdfSelection:
    """Normalized export-only feature inclusion.

    ``None`` means that the dimension is not filtered.  An explicit empty
    tuple means that no feature can match that dimension.  The distinction
    preserves the contract that an omitted selection exports the configured
    GeoJSON unchanged.
    """

    point_ids: tuple[str, ...] | None = None
    line_kinds: tuple[str, ...] | None = None
    layer_kinds: tuple[str, ...] | None = None
    layer_ids: tuple[str, ...] | None = None
    aspect_ids: tuple[str, ...] | None = None
    include_zenith: bool | None = None

    def __post_init__(self) -> None:
        for field_name, case in (
            ("point_ids", None),
            ("line_kinds", "upper"),
            ("layer_kinds", "lower"),
            ("layer_ids", None),
            ("aspect_ids", "lower"),
        ):
            value = getattr(self, field_name)
            if value is not None:
                object.__setattr__(
                    self,
                    field_name,
                    _normalized_values(value, case=case),
                )
        if self.include_zenith is not None and not isinstance(
            self.include_zenith,
            bool,
        ):
            object.__setattr__(self, "include_zenith", None)

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any] | "AstrocartPdfSelection" | None,
    ) -> "AstrocartPdfSelection":
        if payload is None:
            return cls()
        if isinstance(payload, cls):
            return payload
        if not isinstance(payload, Mapping):
            raise TypeError("astrocart PDF selection must be a mapping")

        def values(camel: str, snake: str, *, case: str | None = None):
            present, raw = _mapping_field(payload, camel, snake)
            return _normalized_values(raw, case=case) if present else None

        present_zenith, raw_zenith = _mapping_field(
            payload,
            "includeZenith",
            "include_zenith",
        )
        include_zenith = (
            raw_zenith if present_zenith and isinstance(raw_zenith, bool) else None
        )
        return cls(
            point_ids=values("pointIds", "point_ids"),
            line_kinds=values("lineKinds", "line_kinds", case="upper"),
            layer_kinds=values("layerKinds", "layer_kinds", case="lower"),
            layer_ids=values("layerIds", "layer_ids"),
            aspect_ids=values("aspectIds", "aspect_ids", case="lower"),
            include_zenith=include_zenith,
        )

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        for key, value in (
            ("pointIds", self.point_ids),
            ("lineKinds", self.line_kinds),
            ("layerKinds", self.layer_kinds),
            ("layerIds", self.layer_ids),
            ("aspectIds", self.aspect_ids),
        ):
            if value is not None:
                payload[key] = list(value)
        if self.include_zenith is not None:
            payload["includeZenith"] = self.include_zenith
        return payload


def normalize_export_selection(
    selection: Mapping[str, Any] | AstrocartPdfSelection | None,
) -> AstrocartPdfSelection:
    return AstrocartPdfSelection.from_payload(selection)


def _feature_layer(properties: Mapping[str, Any]) -> str:
    layer = str(properties.get("astrocart_layer") or LAYER_NATAL).strip().lower()
    if layer in ("", "current"):
        return LAYER_NATAL
    return layer


def _feature_layer_id(properties: Mapping[str, Any]) -> str:
    return str(
        properties.get("astrocart_layer_id")
        or properties.get("astrocart_layer")
        or LAYER_NATAL
    ).strip()


def _feature_matches(
    feature: Mapping[str, Any],
    selection: AstrocartPdfSelection,
) -> bool:
    properties = feature.get("properties")
    if not isinstance(properties, Mapping):
        properties = {}
    kind = str(properties.get("kind") or "").strip().upper()

    if selection.include_zenith is False and kind == KIND_ZENITH:
        return False
    if selection.point_ids is not None:
        candidates = {
            str(properties.get(name) or "").strip()
            for name in ("point", "a_point", "b_point")
        }
        candidates.discard("")
        if not candidates.intersection(selection.point_ids):
            return False
    if selection.line_kinds is not None and kind not in selection.line_kinds:
        return False
    if (
        selection.layer_kinds is not None
        and _feature_layer(properties) not in selection.layer_kinds
    ):
        return False
    if (
        selection.layer_ids is not None
        and _feature_layer_id(properties) not in selection.layer_ids
    ):
        return False
    if selection.aspect_ids is not None and kind == KIND_ASPECT:
        aspect_id = str(
            properties.get("aspect_id")
            or properties.get("aspect_name")
            or ""
        ).strip().lower()
        if aspect_id not in selection.aspect_ids:
            return False
    return True


def filter_geojson_for_export(
    geojson: Mapping[str, Any],
    selection: Mapping[str, Any] | AstrocartPdfSelection | None = None,
) -> dict[str, Any]:
    """Return a detached FeatureCollection filtered only for this export."""
    if not isinstance(geojson, Mapping):
        raise TypeError("astrocart PDF source must be a GeoJSON mapping")
    normalized = normalize_export_selection(selection)
    detached = deepcopy(dict(geojson))
    source_features = detached.get("features")
    if not isinstance(source_features, Sequence) or isinstance(
        source_features,
        (str, bytes, bytearray),
    ):
        source_features = []
    detached["features"] = [
        feature
        for feature in source_features
        if isinstance(feature, Mapping) and _feature_matches(feature, normalized)
    ]
    return detached


def count_export_features(
    geojson: Mapping[str, Any],
    selection: Mapping[str, Any] | AstrocartPdfSelection | None = None,
) -> int:
    """Return the exact post-selection feature count used by the compositor."""
    if not isinstance(geojson, Mapping):
        raise TypeError("astrocart PDF source must be a GeoJSON mapping")
    normalized = normalize_export_selection(selection)
    features = geojson.get("features")
    if not isinstance(features, Sequence) or isinstance(
        features,
        (str, bytes, bytearray),
    ):
        return 0
    return sum(
        1
        for feature in features
        if isinstance(feature, Mapping) and _feature_matches(feature, normalized)
    )


def _print_basemap_encoded_payload(
    basemap: Mapping[str, Any] | None,
) -> str | None:
    if basemap is None:
        return None
    if not isinstance(basemap, Mapping):
        raise TypeError("astrocart PDF basemap must be a mapping")
    data_url = basemap.get("dataUrl")
    if (
        not isinstance(data_url, str)
        or not data_url.startswith(_PNG_DATA_URL_PREFIX)
        or len(data_url) > _MAX_BASEMAP_DATA_URL_CHARS
    ):
        raise ValueError("astrocart PDF basemap must be a bounded PNG data URL")
    projection = str(basemap.get("projection") or "equirectangular").strip()
    if projection != "equirectangular":
        raise ValueError("astrocart PDF basemap projection must be equirectangular")
    encoded = data_url[len(_PNG_DATA_URL_PREFIX):]
    if (
        not encoded
        or len(encoded) % 4 != 0
        or encoded.count("=") > 2
        or ("=" in encoded[:-2])
        or any(
            character
            not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
            for character in encoded
        )
    ):
        raise ValueError("astrocart PDF basemap PNG encoding is invalid")
    declared_width = basemap.get("width")
    declared_height = basemap.get("height")
    if declared_width is not None or declared_height is not None:
        if (
            isinstance(declared_width, bool)
            or not isinstance(declared_width, int)
            or isinstance(declared_height, bool)
            or not isinstance(declared_height, int)
            or declared_width < 2
            or declared_height < 1
            or declared_width > _MAX_BASEMAP_DIMENSION
            or declared_height > _MAX_BASEMAP_DIMENSION
            or declared_width != declared_height * 2
        ):
            raise ValueError("astrocart PDF basemap must have a 2:1 aspect ratio")
    return encoded


def _decode_print_basemap(
    basemap: Mapping[str, Any] | None,
) -> bytes | None:
    encoded = _print_basemap_encoded_payload(basemap)
    if encoded is None:
        return None
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("astrocart PDF basemap PNG encoding is invalid") from exc
    if not payload or len(payload) > _MAX_BASEMAP_BYTES:
        raise ValueError("astrocart PDF basemap PNG is outside the size limit")
    if len(payload) < 24 or payload[:8] != _PNG_SIGNATURE:
        raise ValueError("astrocart PDF basemap payload is not a PNG")
    width, height = struct.unpack(">II", payload[16:24])
    if (
        width < 2
        or height < 1
        or width > _MAX_BASEMAP_DIMENSION
        or height > _MAX_BASEMAP_DIMENSION
        or width != height * 2
    ):
        raise ValueError("astrocart PDF basemap must have a 2:1 aspect ratio")
    for key, decoded in (("width", width), ("height", height)):
        declared = basemap.get(key)
        if declared is not None and (
            isinstance(declared, bool)
            or not isinstance(declared, int)
            or declared != decoded
        ):
            raise ValueError(
                f"astrocart PDF basemap {key} does not match its PNG"
            )
    return payload


def print_basemap_payload_bytes(
    basemap: Mapping[str, Any] | None,
) -> int:
    """Return decoded byte size without allocating a second PNG payload."""
    encoded = _print_basemap_encoded_payload(basemap)
    if encoded is None:
        return 0
    padding = len(encoded) - len(encoded.rstrip("="))
    return (len(encoded) // 4) * 3 - padding


@dataclass(frozen=True, slots=True)
class _AtlasPage:
    payload: bytes
    width: int
    height: int
    role: str
    sheet_id: str
    title: str
    bounds: tuple[float, float, float, float] | None
    scale_label: str
    scale_km: float | None
    neighbors: tuple[tuple[str, str], ...]


def _atlas_number(
    value: Any,
    *,
    name: str,
    low: float,
    high: float,
) -> float:
    if isinstance(value, bool):
        raise ValueError(f"astrocart atlas {name} is invalid")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"astrocart atlas {name} is invalid") from exc
    if not isfinite(number) or not low <= number <= high:
        raise ValueError(f"astrocart atlas {name} is invalid")
    return number


def _atlas_text(value: Any, *, name: str, maximum: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f"astrocart atlas {name} is invalid")
    return value.strip()


def _decode_atlas_page(
    page: Mapping[str, Any],
    *,
    index: int,
) -> _AtlasPage:
    data_url = page.get("dataUrl")
    if (
        not isinstance(data_url, str)
        or not data_url.startswith(_PNG_DATA_URL_PREFIX)
        or len(data_url) > _MAX_BASEMAP_DATA_URL_CHARS
    ):
        raise ValueError(
            f"astrocart atlas page {index + 1} must be a bounded PNG data URL"
        )
    encoded = data_url[len(_PNG_DATA_URL_PREFIX):]
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(
            f"astrocart atlas page {index + 1} PNG encoding is invalid"
        ) from exc
    if not payload or len(payload) > _MAX_BASEMAP_BYTES:
        raise ValueError(
            f"astrocart atlas page {index + 1} PNG is outside the size limit"
        )
    if len(payload) < 24 or payload[:8] != _PNG_SIGNATURE:
        raise ValueError(f"astrocart atlas page {index + 1} is not a PNG")
    width, height = struct.unpack(">II", payload[16:24])
    if (
        width < 2
        or height < 1
        or width > _MAX_ATLAS_DIMENSION
        or height > _MAX_ATLAS_DIMENSION
    ):
        raise ValueError(f"astrocart atlas page {index + 1} dimensions are invalid")
    for key, decoded in (("width", width), ("height", height)):
        declared = page.get(key)
        if (
            isinstance(declared, bool)
            or not isinstance(declared, int)
            or declared != decoded
        ):
            raise ValueError(
                f"astrocart atlas page {index + 1} {key} does not match its PNG"
            )

    role = _atlas_text(page.get("role"), name="page role", maximum=16).lower()
    expected_role = "overview" if index == 0 else "detail"
    if role != expected_role:
        raise ValueError(
            "astrocart atlas must begin with one overview followed by detail pages"
        )
    if page.get("containsAstrology") is not True:
        raise ValueError("astrocart atlas pages must contain rendered astrology")

    projection = _atlas_text(
        page.get("projection"),
        name="page projection",
        maximum=32,
    )
    if not projection:
        raise ValueError("astrocart atlas page projection is required")
    center = page.get("center")
    if (
        not isinstance(center, Sequence)
        or isinstance(center, (str, bytes, bytearray))
        or len(center) != 2
    ):
        raise ValueError("astrocart atlas page center is required")
    _atlas_number(center[0], name="page center longitude", low=-180, high=180)
    _atlas_number(center[1], name="page center latitude", low=-90, high=90)
    _atlas_number(page.get("zoom"), name="page zoom", low=-2, high=30)
    _atlas_number(page.get("bearing"), name="page bearing", low=-360, high=360)
    _atlas_number(page.get("pitch"), name="page pitch", low=0, high=85)

    bounds_value = page.get("bounds")
    bounds: tuple[float, float, float, float] | None = None
    if bounds_value is not None:
        if not isinstance(bounds_value, Sequence) or isinstance(
            bounds_value,
            (str, bytes, bytearray),
        ):
            raise ValueError("astrocart atlas page bounds are invalid")
        if (
            len(bounds_value) == 2
            and all(
                isinstance(corner, Sequence)
                and not isinstance(corner, (str, bytes, bytearray))
                and len(corner) == 2
                for corner in bounds_value
            )
        ):
            flat_bounds = (
                bounds_value[0][0],
                bounds_value[0][1],
                bounds_value[1][0],
                bounds_value[1][1],
            )
        elif len(bounds_value) == 4:
            flat_bounds = tuple(bounds_value)
        else:
            raise ValueError("astrocart atlas page bounds are invalid")
        bounds = (
            _atlas_number(
                flat_bounds[0],
                name="page west bound",
                low=-180,
                high=180,
            ),
            _atlas_number(
                flat_bounds[1],
                name="page south bound",
                low=-90,
                high=90,
            ),
            _atlas_number(
                flat_bounds[2],
                name="page east bound",
                low=-180,
                high=180,
            ),
            _atlas_number(
                flat_bounds[3],
                name="page north bound",
                low=-90,
                high=90,
            ),
        )
        if bounds[1] >= bounds[3]:
            raise ValueError("astrocart atlas page bounds are invalid")

    scale_label = _atlas_text(
        page.get("scaleLabel", page.get("scale")),
        name="page scale",
        maximum=64,
    )
    scale_km: float | None = None
    if page.get("scaleKm") is not None:
        scale_km = _atlas_number(
            page.get("scaleKm"),
            name="page scale",
            low=0.001,
            high=100_000,
        )
        if not scale_label:
            scale_label = f"{scale_km:g} km"

    raw_neighbors = page.get("neighbors")
    neighbors: list[tuple[str, str]] = []
    if raw_neighbors is not None:
        if not isinstance(raw_neighbors, Mapping):
            raise ValueError("astrocart atlas page neighbors are invalid")
        for direction in ("north", "east", "south", "west"):
            value = raw_neighbors.get(direction)
            if value is None:
                continue
            label = _atlas_text(
                value,
                name=f"page {direction} neighbor",
                maximum=64,
            )
            if label:
                neighbors.append((direction, label))

    return _AtlasPage(
        payload=payload,
        width=width,
        height=height,
        role=role,
        sheet_id=_atlas_text(
            page.get("sheetId"),
            name="page sheet id",
            maximum=64,
        ),
        title=_atlas_text(page.get("title"), name="page title", maximum=256),
        bounds=bounds,
        scale_label=scale_label,
        scale_km=scale_km,
        neighbors=tuple(neighbors),
    )


def _decode_atlas(
    atlas: Mapping[str, Any] | None,
) -> tuple[tuple[_AtlasPage, ...], str]:
    if atlas is None:
        return (), ""
    if not isinstance(atlas, Mapping):
        raise TypeError("astrocart atlas must be a mapping")
    raw_pages = atlas.get("pages")
    if (
        not isinstance(raw_pages, Sequence)
        or isinstance(raw_pages, (str, bytes, bytearray))
        or not raw_pages
        or len(raw_pages) > _MAX_ATLAS_PAGES
    ):
        raise ValueError("astrocart atlas pages are invalid")
    pages: list[_AtlasPage] = []
    total_bytes = 0
    for index, raw_page in enumerate(raw_pages):
        if not isinstance(raw_page, Mapping):
            raise ValueError(f"astrocart atlas page {index + 1} is invalid")
        page = _decode_atlas_page(raw_page, index=index)
        total_bytes += len(page.payload)
        if total_bytes > _MAX_ATLAS_TOTAL_BYTES:
            raise ValueError("astrocart atlas exceeds the total size limit")
        pages.append(page)
    attribution = _atlas_text(
        atlas.get("attribution"),
        name="attribution",
        maximum=1024,
    )
    if not attribution:
        raise ValueError("astrocart atlas attribution is required")
    return tuple(pages), attribution


def atlas_payload_bytes(atlas: Mapping[str, Any] | None) -> int:
    """Return atlas byte size from base64 lengths without decoding it again."""
    if atlas is None:
        return 0
    if not isinstance(atlas, Mapping):
        raise TypeError("astrocart atlas must be a mapping")
    pages = atlas.get("pages")
    if (
        not isinstance(pages, Sequence)
        or isinstance(pages, (str, bytes, bytearray))
        or not pages
        or len(pages) > _MAX_ATLAS_PAGES
    ):
        raise ValueError("astrocart atlas pages are invalid")
    total = 0
    for index, page in enumerate(pages):
        if not isinstance(page, Mapping):
            raise ValueError(f"astrocart atlas page {index + 1} is invalid")
        data_url = page.get("dataUrl")
        if (
            not isinstance(data_url, str)
            or not data_url.startswith(_PNG_DATA_URL_PREFIX)
            or len(data_url) > _MAX_BASEMAP_DATA_URL_CHARS
        ):
            raise ValueError(
                f"astrocart atlas page {index + 1} must be a bounded PNG data URL"
            )
        encoded = data_url[len(_PNG_DATA_URL_PREFIX):]
        padding = len(encoded) - len(encoded.rstrip("="))
        page_bytes = (len(encoded) // 4) * 3 - padding
        if page_bytes <= 0 or page_bytes > _MAX_BASEMAP_BYTES:
            raise ValueError(
                f"astrocart atlas page {index + 1} PNG is outside the size limit"
            )
        total += page_bytes
        if total > _MAX_ATLAS_TOTAL_BYTES:
            raise ValueError("astrocart atlas exceeds the total size limit")
    return total


def _font_files(locale: str) -> tuple[str, str, Path, Path]:
    normalized = str(locale or "").replace("_", "-").lower()
    if normalized.startswith("zh-tw") or normalized.startswith("zh-hant"):
        family = "AriesPdfNotoTC"
        regular = Path("Res") / "NotoSansTC-Regular.ttf"
        bold = Path("Res") / "NotoSansTC-Bold.ttf"
    elif normalized.startswith("zh"):
        family = "AriesPdfNotoSC"
        regular = Path("Res") / "NotoSansSC-Regular.ttf"
        bold = Path("Res") / "NotoSansSC-Bold.ttf"
    elif normalized.startswith("ko"):
        family = "AriesPdfNotoKR"
        regular = Path("Res") / "NotoSansKR-Regular.ttf"
        bold = Path("Res") / "NotoSansKR-Bold.ttf"
    else:
        family = "AriesPdfFreeSans"
        regular = Path("Res") / "FreeSans.ttf"
        bold = Path("Res") / "FreeSansBold.ttf"
    return family, f"{family}-Bold", _resource_path(regular), _resource_path(bold)


def _register_fonts(locale: str) -> tuple[str, str]:
    regular_name, bold_name, regular_path, bold_path = _font_files(locale)
    with _FONT_LOCK:
        if regular_name not in _REGISTERED_FONT_FAMILIES:
            if not regular_path.is_file() or not bold_path.is_file():
                raise FileNotFoundError(
                    f"bundled PDF font missing: {regular_path} / {bold_path}"
                )
            pdfmetrics.registerFont(TTFont(regular_name, str(regular_path)))
            pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            _REGISTERED_FONT_FAMILIES.add(regular_name)
    return regular_name, bold_name


def _page_size(page_format: str) -> tuple[float, float]:
    normalized = str(page_format or PAGE_FORMAT_A4).strip().upper()
    if normalized == PAGE_FORMAT_A4:
        return landscape(A4)
    if normalized == PAGE_FORMAT_A3:
        return landscape(A3)
    raise ValueError(f"unsupported astrocart PDF page format: {page_format}")


def _renderer_style(
    style: Mapping[str, Any] | None,
    *,
    color_mode: str = COLOR_MODE_COLORED_DETAILS,
) -> dict[str, Any]:
    source: Mapping[str, Any] = style or {}
    nested = source.get("renderer") if isinstance(source, Mapping) else None
    if isinstance(nested, Mapping):
        source = nested
    result = dict(_DEFAULT_STYLE)
    # The fallback vector path follows the same renderer contract as the
    # interactive map. Fully rendered atlas captures bypass these values.
    for key in result:
        if key in source:
            result[key] = source[key]
    normalized_mode = str(color_mode or COLOR_MODE_MONOCHROME).strip().lower()
    # Astrocartography is a colour-keyed map. Preserve authored point colours
    # even when the general chart-PDF preference is monochrome; the geographic
    # capture itself is responsible for its grayscale book-map treatment.
    result["_color_mode"] = COLOR_MODE_COLORED_DETAILS
    result["_requested_color_mode"] = (
        normalized_mode if normalized_mode in COLOR_MODES else COLOR_MODE_COLORED_DETAILS
    )
    return result


def _css_color(value: Any, fallback: str) -> colors.Color:
    text = str(value or fallback).strip()
    if text.lower().startswith("rgba(") and text.endswith(")"):
        parts = [part.strip() for part in text[5:-1].split(",")]
        if len(parts) == 4:
            try:
                return colors.Color(
                    max(0.0, min(1.0, float(parts[0]) / 255.0)),
                    max(0.0, min(1.0, float(parts[1]) / 255.0)),
                    max(0.0, min(1.0, float(parts[2]) / 255.0)),
                    alpha=max(0.0, min(1.0, float(parts[3]))),
                )
            except (TypeError, ValueError):
                pass
    try:
        return colors.HexColor(text)
    except (TypeError, ValueError):
        return colors.HexColor(fallback)


def _luminance(color: colors.Color) -> float:
    return 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue


def _bounded_number(value: Any, fallback: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not isfinite(number):
        return fallback
    return max(low, min(high, number))


@lru_cache(maxsize=4)
def _world_outlines(resource_path: str) -> tuple[tuple[tuple[float, float], ...], ...]:
    path = Path(resource_path)
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    outlines: list[tuple[tuple[float, float], ...]] = []
    for feature in payload.get("features", ()):
        geometry = feature.get("geometry", {}) if isinstance(feature, Mapping) else {}
        for line in _geometry_lines(geometry):
            clean = tuple(_clean_coordinate(point) for point in line)
            clean = tuple(point for point in clean if point is not None)
            if len(clean) >= 2:
                outlines.append(clean)
    return tuple(outlines)


def _clean_coordinate(value: Any) -> tuple[float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return None
    if len(value) < 2:
        return None
    try:
        longitude = float(value[0])
        latitude = float(value[1])
    except (TypeError, ValueError):
        return None
    if not (isfinite(longitude) and isfinite(latitude)):
        return None
    return (
        max(-180.0, min(180.0, longitude)),
        max(-90.0, min(90.0, latitude)),
    )


def _geometry_lines(geometry: Any) -> tuple[Sequence[Any], ...]:
    if not isinstance(geometry, Mapping):
        return ()
    geometry_type = str(geometry.get("type") or "")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, Sequence):
        return (coordinates,)
    if geometry_type == "MultiLineString" and isinstance(coordinates, Sequence):
        return tuple(
            line for line in coordinates
            if isinstance(line, Sequence)
            and not isinstance(line, (str, bytes, bytearray))
        )
    if geometry_type == "Polygon" and isinstance(coordinates, Sequence):
        return tuple(
            ring for ring in coordinates
            if isinstance(ring, Sequence)
            and not isinstance(ring, (str, bytes, bytearray))
        )
    if geometry_type == "MultiPolygon" and isinstance(coordinates, Sequence):
        rings: list[Sequence[Any]] = []
        for polygon in coordinates:
            if not isinstance(polygon, Sequence):
                continue
            rings.extend(
                ring for ring in polygon
                if isinstance(ring, Sequence)
                and not isinstance(ring, (str, bytes, bytearray))
            )
        return tuple(rings)
    return ()


def _split_dateline(
    line: Sequence[tuple[float, float]],
) -> tuple[tuple[tuple[float, float], ...], ...]:
    if len(line) < 2:
        return ()
    if (
        len(line) == 2
        and abs(abs(line[0][0] - line[1][0]) - 360.0) < 1e-8
        and abs(line[0][1] - line[1][1]) < 1e-8
    ):
        return (tuple(line),)
    segments: list[list[tuple[float, float]]] = [[line[0]]]
    for previous, current in zip(line, line[1:]):
        previous_lon, previous_lat = previous
        current_lon, current_lat = current
        delta = current_lon - previous_lon
        if abs(delta) <= 180.0:
            segments[-1].append(current)
            continue
        if delta > 0.0:
            boundary = -180.0
            current_unwrapped = current_lon - 360.0
        else:
            boundary = 180.0
            current_unwrapped = current_lon + 360.0
        denominator = current_unwrapped - previous_lon
        ratio = (
            0.0
            if abs(denominator) < 1e-12
            else (boundary - previous_lon) / denominator
        )
        ratio = max(0.0, min(1.0, ratio))
        boundary_lat = previous_lat + (current_lat - previous_lat) * ratio
        segments[-1].append((boundary, boundary_lat))
        opposite = -boundary
        segments.append([(opposite, boundary_lat), current])
    return tuple(tuple(segment) for segment in segments if len(segment) >= 2)


@dataclass(frozen=True, slots=True)
class _MapBox:
    x: float
    y: float
    width: float
    height: float

    def project(self, longitude: float, latitude: float) -> tuple[float, float]:
        return (
            self.x + ((longitude + 180.0) / 360.0) * self.width,
            self.y + ((latitude + 90.0) / 180.0) * self.height,
        )


def _path_for_lines(
    pdf: canvas.Canvas,
    lines: Sequence[Sequence[tuple[float, float]]],
    box: _MapBox,
):
    path = pdf.beginPath()
    drew = False
    for raw_line in lines:
        clean = tuple(point for point in raw_line if point is not None)
        for segment in _split_dateline(clean):
            x, y = box.project(*segment[0])
            path.moveTo(x, y)
            for longitude, latitude in segment[1:]:
                x, y = box.project(longitude, latitude)
                path.lineTo(x, y)
            drew = True
    return path if drew else None


def _set_stroke_alpha(pdf: canvas.Canvas, alpha: float) -> None:
    setter = getattr(pdf, "setStrokeAlpha", None)
    if callable(setter):
        setter(max(0.0, min(1.0, alpha)))


def _set_fill_alpha(pdf: canvas.Canvas, alpha: float) -> None:
    setter = getattr(pdf, "setFillAlpha", None)
    if callable(setter):
        setter(max(0.0, min(1.0, alpha)))


def _feature_color(properties: Mapping[str, Any], style: Mapping[str, Any]) -> colors.Color:
    if style.get("_color_mode") != COLOR_MODE_COLORED_DETAILS:
        layer = _feature_layer(properties)
        kind = str(properties.get("kind") or "").strip().upper()
        if kind == KIND_PARAN:
            return colors.HexColor("#26282a")
        if layer == LAYER_PROGRESSION:
            return colors.HexColor("#4a4c4e")
        if layer == LAYER_TRANSIT:
            return colors.HexColor("#303234")
        return colors.HexColor("#111214")
    if properties.get("color"):
        return _css_color(properties["color"], style["fallbackUnknownColor"])
    kind = str(properties.get("kind") or "").upper()
    fallback_key = {
        "MC": "fallbackMcColor",
        "IC": "fallbackIcColor",
        "ASC": "fallbackAscColor",
        "DSC": "fallbackDscColor",
        KIND_PARAN: "paranColor",
    }.get(kind, "fallbackUnknownColor")
    return _css_color(style[fallback_key], _DEFAULT_STYLE[fallback_key])


def _feature_line_style(
    properties: Mapping[str, Any],
    style: Mapping[str, Any],
) -> tuple[float, float, tuple[float, ...]]:
    kind = str(properties.get("kind") or "").upper()
    if kind in ("IC", "DSC"):
        width = _bounded_number(style["dashedWidth"], 1.6, 0.2, 8.0)
        opacity = _bounded_number(style["dashedOpacity"], 0.95, 0.0, 1.0)
        dash = (
            _bounded_number(style["dashedOn"], 3.0, 0.1, 20.0),
            _bounded_number(style["dashedOff"], 2.0, 0.1, 20.0),
        )
    elif kind == KIND_LOCAL_SPACE_OPPOSITION:
        width = _bounded_number(style["dashedWidth"], 1.6, 0.2, 8.0) * 0.9
        opacity = _bounded_number(style["dashedOpacity"], 0.95, 0.0, 1.0) * 0.88
        dash = (
            _bounded_number(style["dashedOn"], 3.0, 0.1, 20.0) * 0.65,
            _bounded_number(style["dashedOff"], 2.0, 0.1, 20.0) * 1.25,
        )
    elif kind == KIND_ASPECT:
        width = _bounded_number(style["solidWidth"], 1.6, 0.2, 8.0) * 0.82
        opacity = _bounded_number(style["solidOpacity"], 0.95, 0.0, 1.0) * 0.78
        dash = (0.45, 1.55)
    elif kind == KIND_PARAN:
        width = _bounded_number(style["paranWidth"], 1.0, 0.2, 8.0)
        opacity = _bounded_number(style["paranOpacity"], 0.55, 0.0, 1.0)
        dash = (
            _bounded_number(style["paranDashOn"], 1.0, 0.1, 20.0),
            _bounded_number(style["paranDashOff"], 2.0, 0.1, 20.0),
        )
    else:
        width = _bounded_number(style["solidWidth"], 1.6, 0.2, 8.0)
        opacity = _bounded_number(style["solidOpacity"], 0.95, 0.0, 1.0)
        dash = ()

    width *= _bounded_number(properties.get("line_width_scale"), 1.0, 0.1, 5.0)
    opacity *= _bounded_number(properties.get("line_opacity"), 1.0, 0.0, 1.0)
    opacity *= {
        LAYER_TRANSIT: 0.82,
        LAYER_PROGRESSION: 0.68,
    }.get(_feature_layer(properties), 1.0)
    return width, opacity, dash


def _draw_vector_line(
    pdf: canvas.Canvas,
    feature: Mapping[str, Any],
    box: _MapBox,
    style: Mapping[str, Any],
) -> None:
    geometry = feature.get("geometry")
    lines: list[tuple[tuple[float, float], ...]] = []
    for raw_line in _geometry_lines(geometry):
        clean = tuple(_clean_coordinate(point) for point in raw_line)
        clean = tuple(point for point in clean if point is not None)
        if len(clean) >= 2:
            lines.append(clean)
    path = _path_for_lines(pdf, lines, box)
    if path is None:
        return

    properties = feature.get("properties")
    if not isinstance(properties, Mapping):
        properties = {}
    kind = str(properties.get("kind") or "").upper()
    width, opacity, dash = _feature_line_style(properties, style)

    if kind != KIND_PARAN:
        casing_color = _css_color(style["casing"], _DEFAULT_STYLE["casing"])
        pdf.saveState()
        pdf.setStrokeColor(casing_color)
        _set_stroke_alpha(
            pdf,
            opacity
            * _bounded_number(style["casingOpacity"], 0.75, 0.0, 1.0)
            * casing_color.alpha,
        )
        pdf.setLineWidth(max(width + 1.3, _bounded_number(
            style["casingWidth"],
            3.0,
            0.2,
            10.0,
        )))
        pdf.setLineJoin(1)
        pdf.setLineCap(1)
        if dash:
            pdf.setDash(dash)
        pdf.drawPath(path, stroke=1, fill=0)
        pdf.restoreState()

    color = _feature_color(properties, style)
    pdf.saveState()
    pdf.setStrokeColor(color)
    _set_stroke_alpha(pdf, opacity * color.alpha)
    pdf.setLineWidth(width)
    pdf.setLineJoin(1)
    pdf.setLineCap(1)
    if dash:
        pdf.setDash(dash)
    pdf.drawPath(path, stroke=1, fill=0)
    pdf.restoreState()


def _point_coordinate(feature: Mapping[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry")
    if not isinstance(geometry, Mapping) or geometry.get("type") != "Point":
        return None
    return _clean_coordinate(geometry.get("coordinates"))


def _draw_zenith(
    pdf: canvas.Canvas,
    feature: Mapping[str, Any],
    box: _MapBox,
    style: Mapping[str, Any],
    scale: float,
) -> None:
    coordinate = _point_coordinate(feature)
    if coordinate is None:
        return
    properties = feature.get("properties")
    if not isinstance(properties, Mapping):
        properties = {}
    color = _feature_color(properties, style)
    x, y = box.project(*coordinate)
    radius = 2.8 * scale
    pdf.saveState()
    pdf.setFillColor(color)
    pdf.setStrokeColor(_css_color(style["casing"], "#ffffff"))
    _set_fill_alpha(pdf, color.alpha)
    pdf.setLineWidth(max(0.8, scale))
    pdf.circle(x, y, radius, stroke=1, fill=1)
    pdf.setStrokeColor(color)
    pdf.setLineWidth(max(0.55, 0.7 * scale))
    pdf.line(x - radius * 1.65, y, x + radius * 1.65, y)
    pdf.line(x, y - radius * 1.65, x, y + radius * 1.65)
    pdf.restoreState()


def _nested_label(
    labels: Mapping[str, Any],
    section: str,
    identifier: str,
) -> str:
    nested = labels.get(section)
    if isinstance(nested, Mapping):
        value = nested.get(identifier)
        if value is not None and str(value).strip():
            return str(value).strip()
    flat = labels.get(f"{section}.{identifier}")
    if flat is not None and str(flat).strip():
        return str(flat).strip()
    return identifier


def _point_label(properties: Mapping[str, Any], labels: Mapping[str, Any]) -> str:
    point_id = str(properties.get("point") or "").strip()
    configured = _nested_label(labels, "points", point_id) if point_id else ""
    if configured and configured != point_id:
        return configured
    return str(properties.get("label") or point_id).strip()


def _feature_label(properties: Mapping[str, Any], labels: Mapping[str, Any]) -> str:
    kind = str(properties.get("kind") or "").strip().upper()
    layer = _feature_layer(properties)
    technique = str(properties.get("astrocart_technique") or "").strip().lower()
    layer_label = (
        _nested_label(labels, "techniques", technique)
        if technique and layer != LAYER_NATAL
        else _nested_label(labels, "layers", layer)
    )
    layer_prefix = f"[{layer_label}] " if layer != LAYER_NATAL else ""

    if kind == KIND_PARAN:
        a_point = str(properties.get("a_point") or "").strip()
        b_point = str(properties.get("b_point") or "").strip()
        if not a_point and not b_point:
            return f"{layer_prefix}{properties.get('label') or kind}".strip()
        a_label = _nested_label(labels, "points", a_point)
        b_label = _nested_label(labels, "points", b_point)
        if not a_label or a_label == a_point:
            a_label = str(properties.get("a_label") or a_point).strip()
        if not b_label or b_label == b_point:
            b_label = str(properties.get("b_label") or b_point).strip()
        return (
            f"{layer_prefix}{a_label} {properties.get('a_angle') or ''} × "
            f"{b_label} {properties.get('b_angle') or ''}"
        ).strip()

    point = _point_label(properties, labels)
    kind_label = _nested_label(labels, "kinds", kind)
    if kind == KIND_ASPECT:
        aspect_id = str(
            properties.get("aspect_id")
            or properties.get("aspect_name")
            or ""
        ).strip()
        aspect_label = _nested_label(labels, "aspects", aspect_id)
        target = str(properties.get("target_angle") or "").strip()
        return f"{layer_prefix}{point} {aspect_label} {target}".strip()
    if kind in (KIND_LOCAL_SPACE, KIND_LOCAL_SPACE_OPPOSITION):
        bearing = str(
            properties.get("bearing_label")
            or properties.get("source_bearing_label")
            or ""
        ).strip()
        return f"{layer_prefix}{point} {bearing} {kind_label}".strip()
    return f"{layer_prefix}{point} {kind_label}".strip()


def _label_anchor(feature: Mapping[str, Any]) -> tuple[float, float] | None:
    properties = feature.get("properties")
    if isinstance(properties, Mapping):
        anchors = properties.get("label_anchors")
        if isinstance(anchors, Sequence) and not isinstance(
            anchors,
            (str, bytes, bytearray),
        ):
            for anchor in anchors:
                clean = _clean_coordinate(anchor)
                if clean is not None:
                    return clean
    point = _point_coordinate(feature)
    if point is not None:
        return point
    lines = _geometry_lines(feature.get("geometry"))
    for raw_line in lines:
        clean = tuple(_clean_coordinate(value) for value in raw_line)
        clean = tuple(value for value in clean if value is not None)
        if clean:
            return clean[len(clean) // 2]
    return None


def _overlaps(
    candidate: tuple[float, float, float, float],
    occupied: Sequence[tuple[float, float, float, float]],
) -> bool:
    x0, y0, x1, y1 = candidate
    return any(
        x0 < ox1 and x1 > ox0 and y0 < oy1 and y1 > oy0
        for ox0, oy0, ox1, oy1 in occupied
    )


def _ellipsize(text: str, font: str, size: float, width: float) -> str:
    if pdfmetrics.stringWidth(text, font, size) <= width:
        return text
    suffix = "..."
    available = max(0.0, width - pdfmetrics.stringWidth(suffix, font, size))
    value = text
    while value and pdfmetrics.stringWidth(value, font, size) > available:
        value = value[:-1]
    return value.rstrip() + suffix


def _draw_feature_labels(
    pdf: canvas.Canvas,
    features: Sequence[Mapping[str, Any]],
    box: _MapBox,
    style: Mapping[str, Any],
    labels: Mapping[str, Any],
    regular_font: str,
    scale: float,
) -> None:
    font_size = 5.6 * scale
    occupied: list[tuple[float, float, float, float]] = []
    limit = 80 if scale < 1.25 else 150
    drawn = 0
    for feature in features:
        if drawn >= limit:
            break
        anchor = _label_anchor(feature)
        if anchor is None:
            continue
        properties = feature.get("properties")
        if not isinstance(properties, Mapping):
            properties = {}
        text = _feature_label(properties, labels)
        if not text:
            continue
        text = _ellipsize(text, regular_font, font_size, box.width * 0.20)
        text_width = pdfmetrics.stringWidth(text, regular_font, font_size)
        x, y = box.project(*anchor)
        x += 3.4 * scale
        y += 2.2 * scale
        x = min(max(x, box.x + 1.5), box.x + box.width - text_width - 3.0)
        y = min(max(y, box.y + 1.5), box.y + box.height - font_size - 3.0)
        candidate = (
            x - 1.4,
            y - 1.1,
            x + text_width + 1.4,
            y + font_size + 1.3,
        )
        if _overlaps(candidate, occupied):
            continue
        occupied.append(candidate)
        fill = _css_color(style["labelHalo"], "#ffffff")
        text_color = _feature_color(properties, style)
        pdf.saveState()
        pdf.setFillColor(fill)
        _set_fill_alpha(pdf, 0.78 * fill.alpha)
        pdf.roundRect(
            candidate[0],
            candidate[1],
            candidate[2] - candidate[0],
            candidate[3] - candidate[1],
            1.4 * scale,
            stroke=0,
            fill=1,
        )
        pdf.setFillColor(text_color)
        _set_fill_alpha(pdf, 0.96 * text_color.alpha)
        pdf.setFont(regular_font, font_size)
        pdf.drawString(x, y, text)
        pdf.restoreState()
        drawn += 1


def _draw_graticule(
    pdf: canvas.Canvas,
    box: _MapBox,
    border_color: colors.Color,
    scale: float,
) -> None:
    pdf.saveState()
    pdf.setStrokeColor(border_color)
    _set_stroke_alpha(pdf, 0.22)
    pdf.setLineWidth(0.35 * scale)
    for longitude in range(-150, 180, 30):
        x, _ = box.project(float(longitude), 0.0)
        pdf.line(x, box.y, x, box.y + box.height)
    for latitude in range(-60, 90, 30):
        _, y = box.project(0.0, float(latitude))
        pdf.line(box.x, y, box.x + box.width, y)
    _set_stroke_alpha(pdf, 0.36)
    pdf.setLineWidth(0.55 * scale)
    x0, _ = box.project(0.0, 0.0)
    _, y0 = box.project(0.0, 0.0)
    pdf.line(x0, box.y, x0, box.y + box.height)
    pdf.line(box.x, y0, box.x + box.width, y0)
    pdf.restoreState()


def _draw_world_outlines(
    pdf: canvas.Canvas,
    box: _MapBox,
    border_color: colors.Color,
    scale: float,
) -> None:
    outlines = _world_outlines(str(_resource_path(_WORLD_RESOURCE)))
    path = _path_for_lines(pdf, outlines, box)
    if path is None:
        return
    pdf.saveState()
    pdf.setStrokeColor(border_color)
    _set_stroke_alpha(pdf, 0.82 * border_color.alpha)
    pdf.setLineWidth(0.42 * scale)
    pdf.setLineJoin(1)
    pdf.drawPath(path, stroke=1, fill=0)
    pdf.restoreState()


def _map_features(geojson: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    features = geojson.get("features")
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, Mapping)]


def _feature_sort_key(feature: Mapping[str, Any]) -> tuple[int, int]:
    properties = feature.get("properties")
    if not isinstance(properties, Mapping):
        properties = {}
    layer_rank = {
        LAYER_PROGRESSION: 0,
        LAYER_TRANSIT: 1,
        LAYER_NATAL: 2,
    }.get(_feature_layer(properties), 0)
    kind_rank = 0 if str(properties.get("kind") or "").upper() == KIND_PARAN else 1
    return layer_rank, kind_rank


def _unique_semantics(
    features: Sequence[Mapping[str, Any]],
) -> tuple[list[str], list[str], list[str], list[str]]:
    points: set[str] = set()
    kinds: set[str] = set()
    layers: set[str] = set()
    aspects: set[str] = set()
    for feature in features:
        properties = feature.get("properties")
        if not isinstance(properties, Mapping):
            continue
        for name in ("point", "a_point", "b_point"):
            value = str(properties.get(name) or "").strip()
            if value:
                points.add(value)
        kind = str(properties.get("kind") or "").strip().upper()
        if kind:
            kinds.add(kind)
        layers.add(_feature_layer(properties))
        aspect = str(properties.get("aspect_id") or "").strip()
        if aspect:
            aspects.add(aspect)
    return sorted(points), sorted(kinds), sorted(layers), sorted(aspects)


def _automatic_selection_summary(
    features: Sequence[Mapping[str, Any]],
    labels: Mapping[str, Any],
) -> str:
    points, kinds, layers, aspects = _unique_semantics(features)
    sections = [
        ", ".join(_nested_label(labels, "points", value) for value in points),
        ", ".join(_nested_label(labels, "kinds", value) for value in kinds),
        ", ".join(_nested_label(labels, "layers", value) for value in layers),
    ]
    if aspects:
        sections.append(
            ", ".join(_nested_label(labels, "aspects", value) for value in aspects)
        )
    return " | ".join(section for section in sections if section)


def _wrap_lines(
    text: str,
    font: str,
    size: float,
    max_width: float,
    max_lines: int,
) -> list[str]:
    words = str(text or "").split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(_ellipsize(current, font, size, max_width))
    if len(lines) == max_lines:
        consumed = " ".join(lines)
        if len(consumed) < len(str(text)):
            lines[-1] = _ellipsize(lines[-1] + "...", font, size, max_width)
    return lines


def _draw_legend(
    pdf: canvas.Canvas,
    features: Sequence[Mapping[str, Any]],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    style: Mapping[str, Any],
    labels: Mapping[str, Any],
    selection_summary: str,
    regular_font: str,
    bold_font: str,
    text_color: colors.Color,
    scale: float,
) -> None:
    points, kinds, layers, aspects = _unique_semantics(features)
    del points, aspects
    heading = str(labels.get("selection") or "").strip()
    legend_heading = str(labels.get("legend") or "").strip()
    summary = str(selection_summary or "").strip()

    current_y = y + height - 6.0 * scale
    if heading:
        pdf.setFont(bold_font, 6.8 * scale)
        pdf.setFillColor(text_color)
        pdf.drawString(x, current_y, heading)
        current_y -= 8.0 * scale
    summary_lines = _wrap_lines(
        summary,
        regular_font,
        6.4 * scale,
        width,
        2,
    )
    pdf.setFont(regular_font, 6.4 * scale)
    pdf.setFillColor(text_color)
    for line in summary_lines:
        pdf.drawString(x, current_y, line)
        current_y -= 7.5 * scale

    legend_y = y + 7.5 * scale
    if legend_heading:
        pdf.setFont(bold_font, 6.8 * scale)
        pdf.drawString(x, legend_y, legend_heading)
        legend_x = x + pdfmetrics.stringWidth(
            legend_heading,
            bold_font,
            6.8 * scale,
        ) + 8.0 * scale
    else:
        legend_x = x

    entries: list[tuple[str, str, str]] = [
        ("kind", kind, _nested_label(labels, "kinds", kind))
        for kind in kinds
    ]
    entries.extend(
        ("layer", layer, _nested_label(labels, "layers", layer))
        for layer in layers
    )
    available = x + width - legend_x
    cursor_x = legend_x
    for entry_type, identifier, label in entries:
        label = _ellipsize(
            label,
            regular_font,
            6.2 * scale,
            max(30.0 * scale, available * 0.2),
        )
        entry_width = (
            18.0 * scale
            + pdfmetrics.stringWidth(label, regular_font, 6.2 * scale)
            + 8.0 * scale
        )
        if cursor_x + entry_width > x + width:
            break
        properties: dict[str, Any]
        if entry_type == "kind":
            properties = {"kind": identifier}
        else:
            properties = {"kind": "MC", "astrocart_layer": identifier}
        color = _feature_color(properties, style)
        line_width, opacity, dash = _feature_line_style(properties, style)
        pdf.saveState()
        pdf.setStrokeColor(color)
        _set_stroke_alpha(pdf, opacity * color.alpha)
        pdf.setLineWidth(max(0.65, line_width * 0.75))
        if dash:
            pdf.setDash(dash)
        if identifier == KIND_ZENITH:
            pdf.circle(
                cursor_x + 6.0 * scale,
                legend_y + 2.0 * scale,
                2.1 * scale,
                stroke=1,
                fill=0,
            )
        else:
            pdf.line(
                cursor_x,
                legend_y + 2.0 * scale,
                cursor_x + 12.0 * scale,
                legend_y + 2.0 * scale,
            )
        pdf.restoreState()
        pdf.setFillColor(text_color)
        pdf.setFont(regular_font, 6.2 * scale)
        pdf.drawString(cursor_x + 15.0 * scale, legend_y, label)
        cursor_x += entry_width


@dataclass(frozen=True, slots=True)
class _FeatureRecord:
    ordinal: int
    feature: Mapping[str, Any]
    label: str
    kind: str


@dataclass(frozen=True, slots=True)
class _PrintLayout:
    page_width: float
    page_height: float
    scale: float
    margin: float
    map_box: _MapBox


def _feature_records(
    features: Sequence[Mapping[str, Any]],
    labels: Mapping[str, Any],
) -> list[_FeatureRecord]:
    records: list[_FeatureRecord] = []
    for ordinal, feature in enumerate(features, 1):
        properties = feature.get("properties")
        if not isinstance(properties, Mapping):
            properties = {}
        label = _feature_label(properties, labels)
        cursor_iso = str(properties.get("astrocart_cursor_iso") or "").strip()
        if cursor_iso and _feature_layer(properties) != LAYER_NATAL:
            label = f"{label} · {cursor_iso}".strip(" ·")
        records.append(
            _FeatureRecord(
                ordinal=ordinal,
                feature=feature,
                label=label or str(feature.get("id") or ordinal),
                kind=str(properties.get("kind") or "").strip().upper(),
            )
        )
    return records


def _print_layout(page_width: float, page_height: float) -> _PrintLayout:
    scale = page_width / landscape(A4)[0]
    margin = 20.0 * scale
    header_height = 35.0 * scale
    footer_height = 48.0 * scale
    edge_space = 19.0 * scale
    available_width = page_width - 2.0 * margin
    available_height = (
        page_height
        - 2.0 * margin
        - header_height
        - footer_height
        - 2.0 * edge_space
    )
    map_width = min(available_width, max(1.0, available_height * 2.0))
    map_height = map_width / 2.0
    map_x = (page_width - map_width) / 2.0
    map_y = margin + footer_height + edge_space
    return _PrintLayout(
        page_width=page_width,
        page_height=page_height,
        scale=scale,
        margin=margin,
        map_box=_MapBox(map_x, map_y, map_width, map_height),
    )


def _basemap_attribution(basemap: Mapping[str, Any] | None) -> str:
    if basemap is None:
        return _NATURAL_EARTH_ATTRIBUTION
    supplied = str(basemap.get("attribution") or "").strip()
    if not supplied:
        return _OSM_ATTRIBUTION
    if "openstreetmap" not in supplied.lower():
        return f"{supplied} · {_OSM_ATTRIBUTION}"
    return supplied


def _draw_legacy_report_header(
    pdf: canvas.Canvas,
    layout: _PrintLayout,
    *,
    title: str,
    subtitle: str,
    client_name: str,
    chart_date: str,
    labels: Mapping[str, Any],
    regular_font: str,
    bold_font: str,
) -> None:
    scale = layout.scale
    margin = layout.margin
    baseline = layout.page_height - margin - 11.0 * scale
    left_width = layout.page_width * 0.63
    pdf.setFillColor(colors.HexColor("#111214"))
    pdf.setFont(bold_font, 12.4 * scale)
    pdf.drawString(
        margin,
        baseline,
        _ellipsize(title, bold_font, 12.4 * scale, left_width),
    )
    if subtitle:
        pdf.setFont(regular_font, 6.8 * scale)
        pdf.setFillColor(colors.HexColor("#46494c"))
        pdf.drawString(
            margin,
            baseline - 10.0 * scale,
            _ellipsize(subtitle, regular_font, 6.8 * scale, left_width),
        )

    client_label = str(labels.get("client") or "").strip()
    date_label = str(labels.get("date") or "").strip()
    details: list[str] = []
    if client_name:
        details.append(
            f"{client_label}: {client_name}" if client_label else client_name
        )
    if chart_date:
        details.append(
            f"{date_label}: {chart_date}" if date_label else chart_date
        )
    pdf.setFont(regular_font, 6.8 * scale)
    pdf.setFillColor(colors.HexColor("#303234"))
    for index, detail in enumerate(details[:2]):
        pdf.drawRightString(
            layout.page_width - margin,
            baseline - index * 9.0 * scale,
            _ellipsize(
                detail,
                regular_font,
                6.8 * scale,
                layout.page_width * 0.30,
            ),
        )
    divider_y = layout.map_box.y + layout.map_box.height + 27.0 * scale
    pdf.setStrokeColor(colors.HexColor("#74777a"))
    pdf.setLineWidth(0.4 * scale)
    pdf.line(margin, divider_y, layout.page_width - margin, divider_y)


def _draw_map_background(
    pdf: canvas.Canvas,
    box: _MapBox,
    *,
    basemap_image: ImageReader | None,
    border_color: colors.Color,
    scale: float,
) -> None:
    pdf.setFillColor(colors.white)
    pdf.rect(box.x, box.y, box.width, box.height, stroke=0, fill=1)
    if basemap_image is not None:
        pdf.drawImage(
            basemap_image,
            box.x,
            box.y,
            width=box.width,
            height=box.height,
            preserveAspectRatio=False,
            anchor="c",
            mask="auto",
        )
    else:
        pdf.setFillColor(colors.HexColor("#fafafa"))
        pdf.rect(box.x, box.y, box.width, box.height, stroke=0, fill=1)
        _draw_graticule(pdf, box, border_color, scale)
        _draw_world_outlines(pdf, box, border_color, scale)


def _record_line_coordinates(
    record: _FeatureRecord,
) -> tuple[tuple[float, float], ...]:
    coordinates: list[tuple[float, float]] = []
    for raw_line in _geometry_lines(record.feature.get("geometry")):
        coordinates.extend(
            clean
            for clean in (_clean_coordinate(value) for value in raw_line)
            if clean is not None
        )
    return tuple(coordinates)


def _edge_anchor(
    record: _FeatureRecord,
) -> tuple[str, tuple[float, float]] | None:
    coordinates = _record_line_coordinates(record)
    if not coordinates:
        return None
    north = max(coordinates, key=lambda value: value[1])
    south = min(coordinates, key=lambda value: value[1])
    north_gap = 90.0 - north[1]
    south_gap = south[1] + 90.0
    if abs(north_gap - south_gap) < 1e-8:
        return ("top", north) if record.ordinal % 2 else ("bottom", south)
    return ("top", north) if north_gap < south_gap else ("bottom", south)


def _draw_edge_labels(
    pdf: canvas.Canvas,
    records: Sequence[_FeatureRecord],
    box: _MapBox,
    style: Mapping[str, Any],
    regular_font: str,
    scale: float,
) -> tuple[set[int], bool]:
    font_size = 5.2 * scale
    max_label_width = 108.0 * scale
    gap = 3.0 * scale
    lanes = {
        "top": [
            box.y + box.height + 3.0 * scale,
            box.y + box.height + 10.0 * scale,
        ],
        "bottom": [
            box.y - 8.0 * scale,
            box.y - 15.0 * scale,
        ],
    }
    occupied: dict[tuple[str, int], list[tuple[float, float]]] = {
        (side, index): []
        for side in ("top", "bottom")
        for index in range(2)
    }
    candidates: list[
        tuple[float, _FeatureRecord, str, tuple[float, float]]
    ] = []
    for record in records:
        anchor = _edge_anchor(record)
        if anchor is None:
            continue
        side, coordinate = anchor
        x, _ = box.project(*coordinate)
        candidates.append((x, record, side, coordinate))
    candidates.sort(key=lambda value: (value[0], value[1].ordinal))

    drawn: set[int] = set()
    complete = True
    for desired_x, record, preferred_side, coordinate in candidates:
        original_width = pdfmetrics.stringWidth(
            record.label,
            regular_font,
            font_size,
        )
        text = _ellipsize(
            record.label,
            regular_font,
            font_size,
            max_label_width,
        )
        if original_width > max_label_width:
            complete = False
        text_width = pdfmetrics.stringWidth(text, regular_font, font_size)
        start = max(
            box.x,
            min(
                box.x + box.width - text_width,
                desired_x - text_width / 2.0,
            ),
        )
        end = start + text_width
        placement: tuple[str, int] | None = None
        for side in (preferred_side, "bottom" if preferred_side == "top" else "top"):
            for lane_index in range(2):
                intervals = occupied[(side, lane_index)]
                if any(start < stop + gap and end > begin - gap for begin, stop in intervals):
                    continue
                placement = (side, lane_index)
                intervals.append((start, end))
                break
            if placement is not None:
                break
        if placement is None:
            complete = False
            continue
        side, lane_index = placement
        text_y = lanes[side][lane_index]
        anchor_x, anchor_y = box.project(*coordinate)
        leader_end_y = (
            box.y + box.height
            if side == "top"
            else box.y
        )
        pdf.saveState()
        pdf.setStrokeColor(colors.HexColor("#66696c"))
        _set_stroke_alpha(pdf, 0.65)
        pdf.setLineWidth(0.35 * scale)
        pdf.line(
            anchor_x,
            anchor_y,
            start + text_width / 2.0,
            leader_end_y,
        )
        pdf.setFillColor(colors.white)
        _set_fill_alpha(pdf, 0.94)
        pdf.rect(
            start - 1.0 * scale,
            text_y - 1.0 * scale,
            text_width + 2.0 * scale,
            font_size + 1.8 * scale,
            stroke=0,
            fill=1,
        )
        properties = record.feature.get("properties")
        if not isinstance(properties, Mapping):
            properties = {}
        pdf.setFillColor(_feature_color(properties, style))
        _set_fill_alpha(pdf, 1.0)
        pdf.setFont(regular_font, font_size)
        pdf.drawString(start, text_y, text)
        pdf.restoreState()
        drawn.add(record.ordinal)
    return drawn, complete


def _paran_latitude(record: _FeatureRecord) -> float:
    coordinates = _record_line_coordinates(record)
    if not coordinates:
        return 0.0
    return sum(value[1] for value in coordinates) / len(coordinates)


def _draw_paran_tags(
    pdf: canvas.Canvas,
    records: Sequence[_FeatureRecord],
    box: _MapBox,
    regular_font: str,
    scale: float,
    *,
    full_labels: bool,
) -> bool:
    if not records:
        return True
    font_size = 4.9 * scale
    min_gap = 7.0 * scale
    complete = True
    side_records = {
        "left": list(records[::2]),
        "right": list(records[1::2]),
    }
    for side, values in side_records.items():
        positioned: list[tuple[float, _FeatureRecord]] = []
        for record in values:
            _, desired_y = box.project(0.0, _paran_latitude(record))
            positioned.append((desired_y, record))
        positioned.sort(key=lambda value: value[0])
        previous = box.y + 1.5 * scale - min_gap
        adjusted: list[tuple[float, _FeatureRecord]] = []
        for desired_y, record in positioned:
            y = max(desired_y, previous + min_gap)
            adjusted.append((y, record))
            previous = y
        overflow = (
            adjusted[-1][0] - (box.y + box.height - font_size - 1.5 * scale)
            if adjusted
            else 0.0
        )
        if overflow > 0:
            adjusted = [(y - overflow, record) for y, record in adjusted]
        for y, record in adjusted:
            tag = f"{record.ordinal:02d}"
            if full_labels:
                tag = f"{tag}  {record.label}"
            max_width = (168.0 if full_labels else 18.0) * scale
            shown = _ellipsize(tag, regular_font, font_size, max_width)
            if shown != tag:
                complete = False
            width = pdfmetrics.stringWidth(shown, regular_font, font_size)
            x = (
                box.x + 2.0 * scale
                if side == "left"
                else box.x + box.width - width - 2.0 * scale
            )
            pdf.saveState()
            pdf.setFillColor(colors.white)
            _set_fill_alpha(pdf, 0.91)
            pdf.rect(
                x - 1.0 * scale,
                y - 0.8 * scale,
                width + 2.0 * scale,
                font_size + 1.6 * scale,
                stroke=0,
                fill=1,
            )
            pdf.setFillColor(colors.HexColor("#1a1b1d"))
            pdf.setFont(regular_font, font_size)
            pdf.drawString(x, y, shown)
            pdf.restoreState()
    return complete


def _draw_map_plate(
    pdf: canvas.Canvas,
    layout: _PrintLayout,
    records: Sequence[_FeatureRecord],
    *,
    basemap_image: ImageReader | None,
    style: Mapping[str, Any],
    regular_font: str,
    edge_labels: bool,
    full_paran_labels: bool,
) -> bool:
    box = layout.map_box
    scale = layout.scale
    border = _css_color(style["borderColor"], _DEFAULT_STYLE["borderColor"])
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(box.x, box.y, box.width, box.height)
    pdf.clipPath(clip, stroke=0, fill=0)
    _draw_map_background(
        pdf,
        box,
        basemap_image=basemap_image,
        border_color=border,
        scale=scale,
    )
    for record in records:
        geometry = record.feature.get("geometry")
        if not isinstance(geometry, Mapping) or geometry.get("type") == "Point":
            continue
        _draw_vector_line(pdf, record.feature, box, style)
    for record in records:
        if record.kind == KIND_ZENITH:
            _draw_zenith(pdf, record.feature, box, style, scale)
    pdf.restoreState()

    pdf.setStrokeColor(colors.HexColor("#383a3c"))
    _set_stroke_alpha(pdf, 1.0)
    pdf.setLineWidth(0.65 * scale)
    pdf.rect(box.x, box.y, box.width, box.height, stroke=1, fill=0)

    complete = True
    line_records = [
        record
        for record in records
        if record.kind not in (KIND_PARAN, KIND_ZENITH)
        and _geometry_lines(record.feature.get("geometry"))
    ]
    if edge_labels:
        drawn, labels_complete = _draw_edge_labels(
            pdf,
            line_records,
            box,
            style,
            regular_font,
            scale,
        )
        complete = labels_complete and len(drawn) == len(line_records)
    parans = [record for record in records if record.kind == KIND_PARAN]
    if parans:
        complete = (
            _draw_paran_tags(
                pdf,
                parans,
                box,
                regular_font,
                scale,
                full_labels=full_paran_labels,
            )
            and complete
        )
    return complete


def _draw_compact_footer(
    pdf: canvas.Canvas,
    layout: _PrintLayout,
    records: Sequence[_FeatureRecord],
    *,
    labels: Mapping[str, Any],
    selection_summary: str,
    attribution: str,
    style: Mapping[str, Any],
    regular_font: str,
    bold_font: str,
    page_number: int,
    page_count: int,
) -> None:
    scale = layout.scale
    margin = layout.margin
    width = layout.page_width - 2.0 * margin
    text_color = colors.HexColor("#242628")
    selection_heading = str(labels.get("selection") or "").strip()
    summary = str(selection_summary or "").strip()
    if summary:
        summary_text = (
            f"{selection_heading}: {summary}"
            if selection_heading
            else summary
        )
        pdf.setFillColor(text_color)
        pdf.setFont(regular_font, 6.0 * scale)
        pdf.drawString(
            margin,
            margin + 31.0 * scale,
            _ellipsize(
                summary_text,
                regular_font,
                6.0 * scale,
                width * 0.84,
            ),
        )

    kinds = sorted({record.kind for record in records if record.kind})
    legend_heading = str(labels.get("legend") or "").strip()
    cursor_x = margin
    legend_y = margin + 18.0 * scale
    if legend_heading:
        pdf.setFillColor(text_color)
        pdf.setFont(bold_font, 5.8 * scale)
        pdf.drawString(cursor_x, legend_y, legend_heading)
        cursor_x += (
            pdfmetrics.stringWidth(legend_heading, bold_font, 5.8 * scale)
            + 7.0 * scale
        )
    for kind in kinds:
        label = _nested_label(labels, "kinds", kind)
        label = _ellipsize(label, regular_font, 5.5 * scale, 72.0 * scale)
        entry_width = (
            17.0 * scale
            + pdfmetrics.stringWidth(label, regular_font, 5.5 * scale)
            + 7.0 * scale
        )
        if cursor_x + entry_width > margin + width:
            break
        properties = {"kind": kind}
        line_width, opacity, dash = _feature_line_style(properties, style)
        pdf.saveState()
        pdf.setStrokeColor(_feature_color(properties, style))
        _set_stroke_alpha(pdf, opacity)
        pdf.setLineWidth(max(0.55 * scale, line_width * 0.65))
        if dash:
            pdf.setDash(dash)
        if kind == KIND_ZENITH:
            pdf.circle(
                cursor_x + 5.0 * scale,
                legend_y + 1.8 * scale,
                1.7 * scale,
                stroke=1,
                fill=0,
            )
        else:
            pdf.line(
                cursor_x,
                legend_y + 1.8 * scale,
                cursor_x + 11.0 * scale,
                legend_y + 1.8 * scale,
            )
        pdf.restoreState()
        pdf.setFillColor(text_color)
        pdf.setFont(regular_font, 5.5 * scale)
        pdf.drawString(cursor_x + 14.0 * scale, legend_y, label)
        cursor_x += entry_width

    pdf.setFillColor(colors.HexColor("#5d6063"))
    pdf.setFont(regular_font, 5.0 * scale)
    pdf.drawString(
        margin,
        margin + 5.0 * scale,
        _ellipsize(
            attribution,
            regular_font,
            5.0 * scale,
            width * 0.86,
        ),
    )
    pdf.drawRightString(
        layout.page_width - margin,
        margin + 5.0 * scale,
        f"{page_number} / {page_count}",
    )


def _complete_wrap(
    text: str,
    font: str,
    size: float,
    max_width: float,
) -> list[str]:
    words = str(text or "").split()
    if not words:
        return [""]
    lines: list[str] = []
    current = ""
    for raw_word in words:
        word_parts: list[str] = []
        remaining = raw_word
        while (
            remaining
            and pdfmetrics.stringWidth(remaining, font, size) > max_width
        ):
            split_at = len(remaining)
            while (
                split_at > 1
                and pdfmetrics.stringWidth(
                    remaining[:split_at],
                    font,
                    size,
                ) > max_width
            ):
                split_at -= 1
            word_parts.append(remaining[:split_at])
            remaining = remaining[split_at:]
        if remaining:
            word_parts.append(remaining)
        for word in word_parts:
            candidate = word if not current else f"{current} {word}"
            if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
    if current:
        lines.append(current)
    return lines or [""]


def _pack_index_pages(
    records: Sequence[_FeatureRecord],
    *,
    font: str,
    font_size: float,
    column_width: float,
) -> list[list[list[tuple[_FeatureRecord, list[str]]]]]:
    pages: list[list[list[tuple[_FeatureRecord, list[str]]]]] = []
    columns: list[list[tuple[_FeatureRecord, list[str]]]] = [[], []]
    column_index = 0
    used_rows = 0

    def advance_column() -> None:
        nonlocal columns, column_index, used_rows
        column_index += 1
        used_rows = 0
        if column_index >= _INDEX_COLUMN_COUNT:
            pages.append(columns)
            columns = [[], []]
            column_index = 0

    for record in records:
        row_text = f"{record.ordinal:03d}  {record.label}"
        lines = _complete_wrap(
            row_text,
            font,
            font_size,
            column_width,
        )
        while lines:
            capacity = _INDEX_ROWS_PER_COLUMN - used_rows
            if capacity <= 0:
                advance_column()
                capacity = _INDEX_ROWS_PER_COLUMN
            take = min(capacity, len(lines))
            chunk = lines[:take]
            columns[column_index].append((record, chunk))
            used_rows += take
            lines = lines[take:]
            if lines:
                advance_column()
        if used_rows < _INDEX_ROWS_PER_COLUMN:
            used_rows += 1
    if any(columns):
        pages.append(columns)
    return pages


def _draw_index_page(
    pdf: canvas.Canvas,
    layout: _PrintLayout,
    columns: Sequence[Sequence[tuple[_FeatureRecord, list[str]]]],
    *,
    title: str,
    subtitle: str,
    client_name: str,
    chart_date: str,
    labels: Mapping[str, Any],
    attribution: str,
    overview_detail: str,
    regular_font: str,
    bold_font: str,
    page_number: int,
    page_count: int,
) -> None:
    scale = layout.scale
    _draw_legacy_report_header(
        pdf,
        layout,
        title=title,
        subtitle=subtitle,
        client_name=client_name,
        chart_date=chart_date,
        labels=labels,
        regular_font=regular_font,
        bold_font=bold_font,
    )
    gap = 18.0 * scale
    column_width = (
        layout.page_width - 2.0 * layout.margin - gap
    ) / _INDEX_COLUMN_COUNT
    top = layout.page_height - layout.margin - 48.0 * scale
    line_height = 7.6 * scale
    for column_index, blocks in enumerate(columns):
        x = layout.margin + column_index * (column_width + gap)
        y = top
        for _, lines in blocks:
            pdf.setStrokeColor(colors.HexColor("#d0d1d2"))
            pdf.setLineWidth(0.25 * scale)
            pdf.line(x, y + 2.2 * scale, x + column_width, y + 2.2 * scale)
            pdf.setFillColor(colors.HexColor("#202224"))
            pdf.setFont(regular_font, 5.7 * scale)
            for line in lines:
                pdf.drawString(x, y - 5.2 * scale, line)
                y -= line_height
            y -= 1.5 * scale
    pdf.setFillColor(colors.HexColor("#5d6063"))
    pdf.setFont(regular_font, 5.0 * scale)
    pdf.drawString(
        layout.margin,
        layout.margin + 5.0 * scale,
        _ellipsize(
            attribution,
            regular_font,
            5.0 * scale,
            (layout.page_width - 2.0 * layout.margin) * 0.86,
        ),
    )
    pdf.drawRightString(
        layout.page_width - layout.margin,
        layout.margin + 5.0 * scale,
        f"{page_number} / {page_count}",
    )


def _book_map_box(
    page_width: float,
    page_height: float,
    *,
    image_width: int,
    image_height: int,
) -> tuple[_MapBox, float]:
    scale = page_width / landscape(A4)[0]
    margin = 12.0 * scale
    header_height = 18.0 * scale
    footer_height = 13.0 * scale
    available_width = page_width - 2.0 * margin
    available_height = (
        page_height - 2.0 * margin - header_height - footer_height
    )
    image_ratio = image_width / image_height
    map_width = min(available_width, available_height * image_ratio)
    map_height = map_width / image_ratio
    return (
        _MapBox(
            x=(page_width - map_width) / 2.0,
            y=margin + footer_height + (available_height - map_height) / 2.0,
            width=map_width,
            height=map_height,
        ),
        scale,
    )


def _draw_book_header(
    pdf: canvas.Canvas,
    *,
    page_width: float,
    page_height: float,
    scale: float,
    title: str,
    sheet_label: str,
    regular_font: str,
    bold_font: str,
) -> None:
    margin = 12.0 * scale
    baseline = page_height - margin - 8.0 * scale
    pdf.setFillColor(colors.HexColor("#202327"))
    pdf.setFont(bold_font, 8.4 * scale)
    pdf.drawString(
        margin,
        baseline,
        _ellipsize(title, bold_font, 8.4 * scale, page_width * 0.58),
    )
    if sheet_label:
        pdf.setFont(regular_font, 7.0 * scale)
        pdf.setFillColor(colors.HexColor("#4e5358"))
        pdf.drawRightString(
            page_width - margin,
            baseline,
            _ellipsize(
                sheet_label,
                regular_font,
                7.0 * scale,
                page_width * 0.34,
            ),
        )


def _format_coordinate(value: float, *, longitude: bool) -> str:
    suffix = (
        ("E" if value >= 0 else "W")
        if longitude
        else ("N" if value >= 0 else "S")
    )
    return f"{abs(value):.1f}°{suffix}"


def _bounds_label(bounds: tuple[float, float, float, float] | None) -> str:
    if bounds is None:
        return ""
    west, south, east, north = bounds
    return (
        f"{_format_coordinate(west, longitude=True)}–"
        f"{_format_coordinate(east, longitude=True)} · "
        f"{_format_coordinate(south, longitude=False)}–"
        f"{_format_coordinate(north, longitude=False)}"
    )


def _draw_sheet_locator(
    pdf: canvas.Canvas,
    *,
    map_box: _MapBox,
    bounds: tuple[float, float, float, float],
    scale: float,
) -> None:
    locator_width = 73.0 * scale
    locator_height = locator_width / 2.0
    inset = 5.0 * scale
    box = _MapBox(
        map_box.x + map_box.width - locator_width - inset,
        map_box.y + inset,
        locator_width,
        locator_height,
    )
    pdf.saveState()
    pdf.setFillColor(colors.Color(1, 1, 1, alpha=0.88))
    _set_fill_alpha(pdf, 0.88)
    pdf.rect(
        box.x - 2.0 * scale,
        box.y - 2.0 * scale,
        box.width + 4.0 * scale,
        box.height + 4.0 * scale,
        stroke=0,
        fill=1,
    )
    _draw_world_outlines(
        pdf,
        box,
        colors.HexColor("#777c81"),
        max(0.65, scale * 0.65),
    )
    west, south, east, north = bounds
    ranges = (
        ((west, east),)
        if west <= east
        else ((west, 180.0), (-180.0, east))
    )
    pdf.setStrokeColor(colors.HexColor("#303438"))
    _set_stroke_alpha(pdf, 1.0)
    pdf.setLineWidth(max(0.55, 0.65 * scale))
    for longitude_range in ranges:
        x0, y0 = box.project(longitude_range[0], south)
        x1, y1 = box.project(longitude_range[1], north)
        pdf.rect(
            min(x0, x1),
            min(y0, y1),
            abs(x1 - x0),
            abs(y1 - y0),
            stroke=1,
            fill=0,
        )
    pdf.setStrokeColor(colors.HexColor("#777c81"))
    pdf.setLineWidth(max(0.35, 0.4 * scale))
    pdf.rect(box.x, box.y, box.width, box.height, stroke=1, fill=0)
    pdf.restoreState()


def _draw_map_scale_bar(
    pdf: canvas.Canvas,
    *,
    map_box: _MapBox,
    scale_label: str,
    regular_font: str,
    scale: float,
) -> None:
    if not scale_label:
        return
    inset = 5.0 * scale
    bar_width = map_box.width * 0.2
    segment_width = bar_width / 4.0
    bar_height = max(2.4, 2.5 * scale)
    x = map_box.x + inset
    y = map_box.y + inset + 7.0 * scale
    pdf.saveState()
    _set_fill_alpha(pdf, 0.88)
    pdf.setFillColor(colors.white)
    pdf.rect(
        x - 3.0 * scale,
        y - 7.0 * scale,
        bar_width + 6.0 * scale,
        17.0 * scale,
        stroke=0,
        fill=1,
    )
    _set_fill_alpha(pdf, 1.0)
    for index in range(4):
        pdf.setFillColor(colors.black if index % 2 == 0 else colors.white)
        pdf.rect(
            x + index * segment_width,
            y,
            segment_width,
            bar_height,
            stroke=0,
            fill=1,
        )
    pdf.setStrokeColor(colors.HexColor("#303438"))
    pdf.setLineWidth(max(0.35, 0.4 * scale))
    pdf.rect(x, y, bar_width, bar_height, stroke=1, fill=0)
    pdf.setFillColor(colors.HexColor("#303438"))
    pdf.setFont(regular_font, 4.8 * scale)
    pdf.drawString(x, y + bar_height + 1.5 * scale, "0")
    pdf.drawRightString(
        x + bar_width,
        y + bar_height + 1.5 * scale,
        scale_label,
    )
    pdf.restoreState()


def _neighbor_sheet_label(neighbors: tuple[tuple[str, str], ...]) -> str:
    abbreviations = {
        "north": "N",
        "east": "E",
        "south": "S",
        "west": "W",
    }
    return "  ".join(
        f"{abbreviations[direction]} {sheet_id}"
        for direction, sheet_id in neighbors
        if direction in abbreviations
    )


def _draw_book_footer(
    pdf: canvas.Canvas,
    *,
    page_width: float,
    scale: float,
    attribution: str,
    detail: str,
    regular_font: str,
    page_number: int,
    page_count: int,
) -> None:
    margin = 12.0 * scale
    baseline = margin - 1.0 * scale
    pdf.setFillColor(colors.HexColor("#666b70"))
    pdf.setFont(regular_font, 4.8 * scale)
    pdf.drawString(
        margin,
        baseline,
        _ellipsize(
            attribution,
            regular_font,
            4.8 * scale,
            page_width * 0.46,
        ),
    )
    if detail:
        pdf.drawCentredString(
            page_width / 2.0,
            baseline,
            _ellipsize(
                detail,
                regular_font,
                4.8 * scale,
                page_width * 0.34,
            ),
        )
    pdf.drawRightString(
        page_width - margin,
        baseline,
        f"{page_number} / {page_count}",
    )


def _draw_atlas_page(
    pdf: canvas.Canvas,
    page: _AtlasPage,
    *,
    page_width: float,
    page_height: float,
    document_title: str,
    attribution: str,
    overview_detail: str,
    regular_font: str,
    bold_font: str,
    page_number: int,
    page_count: int,
) -> None:
    box, scale = _book_map_box(
        page_width,
        page_height,
        image_width=page.width,
        image_height=page.height,
    )
    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
    sheet_label = " · ".join(
        value for value in (page.sheet_id, page.title) if value
    )
    _draw_book_header(
        pdf,
        page_width=page_width,
        page_height=page_height,
        scale=scale,
        title=document_title,
        sheet_label=sheet_label,
        regular_font=regular_font,
        bold_font=bold_font,
    )
    pdf.drawImage(
        ImageReader(BytesIO(page.payload)),
        box.x,
        box.y,
        width=box.width,
        height=box.height,
        preserveAspectRatio=False,
        anchor="c",
        mask="auto",
    )
    pdf.setStrokeColor(colors.HexColor("#70757a"))
    pdf.setLineWidth(max(0.35, 0.4 * scale))
    pdf.rect(box.x, box.y, box.width, box.height, stroke=1, fill=0)
    if page.role == "detail" and page.bounds is not None:
        _draw_sheet_locator(
            pdf,
            map_box=box,
            bounds=page.bounds,
            scale=scale,
        )
    if page.role == "detail" and page.scale_km is not None:
        _draw_map_scale_bar(
            pdf,
            map_box=box,
            scale_label=page.scale_label,
            regular_font=regular_font,
            scale=scale,
        )
    detail = (
        overview_detail
        if page.role == "overview"
        else " · ".join(
            value
            for value in (
                _bounds_label(page.bounds),
                _neighbor_sheet_label(page.neighbors),
            )
            if value
        )
    )
    _draw_book_footer(
        pdf,
        page_width=page_width,
        scale=scale,
        attribution=attribution,
        detail=detail,
        regular_font=regular_font,
        page_number=page_number,
        page_count=page_count,
    )


def render_astrocart_pdf_bytes(
    geojson: Mapping[str, Any],
    *,
    title: str,
    client_name: str = "",
    chart_date: str = "",
    subtitle: str = "",
    localized_labels: Mapping[str, Any] | None = None,
    selection_summary: str = "",
    selection: Mapping[str, Any] | AstrocartPdfSelection | None = None,
    page_format: str = PAGE_FORMAT_A4,
    locale: str = "en",
    style: Mapping[str, Any] | None = None,
    color_mode: str = COLOR_MODE_COLORED_DETAILS,
    basemap: Mapping[str, Any] | None = None,
    atlas: Mapping[str, Any] | None = None,
) -> bytes:
    """Render an Aries map-book PDF and return its bytes.

    ``atlas`` is the canonical path: its first fully rendered PNG is the world
    overview and each following PNG is an overlapping regional sheet. Because
    the captures already contain the active Aries astrology layers, they are
    embedded unchanged. ``basemap`` remains a legacy single-page fallback.
    """
    filtered = filter_geojson_for_export(geojson, selection)
    labels = localized_labels if isinstance(localized_labels, Mapping) else {}
    renderer_style = _renderer_style(style, color_mode=color_mode)
    page_width, page_height = _page_size(page_format)
    regular_font, bold_font = _register_fonts(locale)
    atlas_pages, atlas_attribution = _decode_atlas(atlas)
    stream = BytesIO()
    pdf = canvas.Canvas(
        stream,
        pagesize=(page_width, page_height),
        pageCompression=0,
    )

    metadata = filtered.get("meta")
    if not isinstance(metadata, Mapping):
        metadata = {}
    document_title = str(title or metadata.get("radix") or "").strip()
    pdf.setTitle(document_title)
    pdf.setAuthor(str(client_name or "Aries"))
    pdf.setSubject(str(subtitle or document_title))
    pdf.setCreator("Aries")
    pdf.setKeywords("astrocartography atlas map")

    if atlas_pages:
        page_count = len(atlas_pages)
        atlas_title = " · ".join(
            dict.fromkeys(
                value
                for value in (
                    str(client_name or "").strip(),
                    document_title,
                )
                if value
            )
        )
        for index, atlas_page in enumerate(atlas_pages, 1):
            _draw_atlas_page(
                pdf,
                atlas_page,
                page_width=page_width,
                page_height=page_height,
                document_title=atlas_title,
                attribution=atlas_attribution,
                overview_detail=" · ".join(
                    value
                    for value in (
                        str(subtitle or "").strip(),
                        str(chart_date or "").strip(),
                    )
                    if value
                ),
                regular_font=regular_font,
                bold_font=bold_font,
                page_number=index,
                page_count=page_count,
            )
            pdf.showPage()
        pdf.save()
        return stream.getvalue()

    decoded_basemap = _decode_print_basemap(basemap)
    basemap_image = (
        ImageReader(BytesIO(decoded_basemap))
        if decoded_basemap is not None
        else None
    )
    image_width = 2
    image_height = 1
    if decoded_basemap is not None:
        image_width, image_height = struct.unpack(">II", decoded_basemap[16:24])
    map_box, scale = _book_map_box(
        page_width,
        page_height,
        image_width=image_width,
        image_height=image_height,
    )
    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, page_width, page_height, stroke=0, fill=1)
    _draw_book_header(
        pdf,
        page_width=page_width,
        page_height=page_height,
        scale=scale,
        title=document_title,
        sheet_label=str(subtitle or ""),
        regular_font=regular_font,
        bold_font=bold_font,
    )

    border = _css_color(
        renderer_style["borderColor"],
        _DEFAULT_STYLE["borderColor"],
    )
    pdf.saveState()
    clipping_path = pdf.beginPath()
    clipping_path.rect(
        map_box.x,
        map_box.y,
        map_box.width,
        map_box.height,
    )
    pdf.clipPath(clipping_path, stroke=0, fill=0)
    _draw_map_background(
        pdf,
        map_box,
        basemap_image=basemap_image,
        border_color=border,
        scale=scale,
    )
    features = sorted(_map_features(filtered), key=_feature_sort_key)
    if not bool((basemap or {}).get("containsAstrology")):
        for feature in features:
            geometry = feature.get("geometry")
            if not isinstance(geometry, Mapping) or geometry.get("type") == "Point":
                continue
            _draw_vector_line(pdf, feature, map_box, renderer_style)
        for feature in features:
            properties = feature.get("properties")
            if (
                isinstance(properties, Mapping)
                and str(properties.get("kind") or "").upper() == KIND_ZENITH
            ):
                _draw_zenith(
                    pdf,
                    feature,
                    map_box,
                    renderer_style,
                    scale,
                )
        _draw_feature_labels(
            pdf,
            features,
            map_box,
            renderer_style,
            labels,
            regular_font,
            scale,
        )
    pdf.restoreState()
    pdf.setStrokeColor(colors.HexColor("#70757a"))
    pdf.setLineWidth(max(0.35, 0.4 * scale))
    pdf.rect(
        map_box.x,
        map_box.y,
        map_box.width,
        map_box.height,
        stroke=1,
        fill=0,
    )
    client_label = str(labels.get("client") or "").strip()
    date_label = str(labels.get("date") or "").strip()
    detail = " · ".join(
        value
        for value in (
            (
                f"{client_label}: {client_name}"
                if client_label and client_name
                else str(client_name or "")
            ),
            (
                f"{date_label}: {chart_date}"
                if date_label and chart_date
                else str(chart_date or "")
            ),
        )
        if value
    )
    _draw_book_footer(
        pdf,
        page_width=page_width,
        scale=scale,
        attribution=_basemap_attribution(basemap),
        detail=detail,
        regular_font=regular_font,
        page_number=1,
        page_count=1,
    )
    pdf.showPage()

    pdf.save()
    return stream.getvalue()


def write_astrocart_pdf(
    output_path: str | os.PathLike[str],
    geojson: Mapping[str, Any],
    **render_options: Any,
) -> Path:
    """Render the PDF and atomically replace the requested output file."""
    path = Path(output_path).expanduser()
    if not path.name:
        raise ValueError("astrocart PDF output path is empty")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = render_astrocart_pdf_bytes(geojson, **render_options)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return path
