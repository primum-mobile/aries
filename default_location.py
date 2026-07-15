# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical saved Default Location coordinate handling.

The legacy option surface stores degree/minute/sign fields.  Tauri map and
search picks also persist authoritative signed decimals so Here-and-Now and
every other default-location consumer retain the same six-decimal precision as
the rest of the map pipeline.  The DMS fields stay synchronized for backwards
compatibility with the established option file and manual controls.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import chart


def _finite_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _normalize_lon(value: float) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("longitude must be finite")
    return ((value + 180.0) % 360.0) - 180.0


def _normalize_lat(value: float) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("latitude must be finite")
    return max(-90.0, min(90.0, value))


def stored_exact_coordinates(options: Any) -> Optional[tuple[float, float]]:
    lon = _finite_float(getattr(options, "defloclon", None))
    lat = _finite_float(getattr(options, "defloclat", None))
    if lon is None or lat is None:
        return None
    return _normalize_lon(lon), _normalize_lat(lat)


def legacy_coordinates(options: Any) -> tuple[float, float]:
    lon = abs(int(getattr(options, "defloclondeg", 0) or 0))
    lon += abs(int(getattr(options, "defloclonmin", 0) or 0)) / 60.0
    if not bool(getattr(options, "defloceast", True)):
        lon = -lon
    lat = abs(int(getattr(options, "defloclatdeg", 0) or 0))
    lat += abs(int(getattr(options, "defloclatmin", 0) or 0)) / 60.0
    if not bool(getattr(options, "deflocnorth", True)):
        lat = -lat
    return _normalize_lon(lon), _normalize_lat(lat)


def coordinates(options: Any) -> tuple[float, float]:
    return stored_exact_coordinates(options) or legacy_coordinates(options)


def has_coordinates(options: Any) -> bool:
    if stored_exact_coordinates(options) is not None:
        return True
    return any(
        int(getattr(options, name, 0) or 0)
        for name in (
            "defloclondeg",
            "defloclonmin",
            "defloclatdeg",
            "defloclatmin",
        )
    )


def has_default_location(options: Any) -> bool:
    if str(getattr(options, "deflocname", "") or "").strip():
        return True
    return has_coordinates(options)


def apply_exact_coordinates(options: Any, lon: float, lat: float) -> tuple[float, float]:
    lon = _normalize_lon(lon)
    lat = _normalize_lat(lat)
    options.defloclon = lon
    options.defloclat = lat

    lon_abs = abs(lon)
    lat_abs = abs(lat)
    options.defloclondeg = int(lon_abs)
    options.defloclonmin = min(59, int((lon_abs - int(lon_abs)) * 60.0))
    options.defloceast = lon >= 0.0
    options.defloclatdeg = int(lat_abs)
    options.defloclatmin = min(59, int((lat_abs - int(lat_abs)) * 60.0))
    options.deflocnorth = lat >= 0.0
    return lon, lat


def apply_legacy_coordinates(options: Any) -> tuple[float, float]:
    """Make a manual degree/minute/sign edit authoritative."""
    lon, lat = legacy_coordinates(options)
    options.defloclon = lon
    options.defloclat = lat
    return lon, lat


def _dms_round(value: float) -> tuple[int, int, int]:
    total = int(round(abs(value) * 3600.0))
    degree, remainder = divmod(total, 3600)
    minute, second = divmod(remainder, 60)
    return degree, minute, second


def place_from_options(options: Any, *, require_present: bool = False):
    if require_present and not has_default_location(options):
        return None
    lon, lat = coordinates(options)
    lon_deg, lon_min, lon_sec = _dms_round(lon)
    lat_deg, lat_min, lat_sec = _dms_round(lat)
    place = chart.Place(
        str(getattr(options, "deflocname", "") or ""),
        lon_deg,
        lon_min,
        lon_sec,
        lon >= 0.0,
        lat_deg,
        lat_min,
        lat_sec,
        lat >= 0.0,
        int(getattr(options, "deflocalt", 0) or 0),
    )
    place.lon = lon
    place.lat = lat
    return place
