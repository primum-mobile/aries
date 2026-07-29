# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Validated material authoring data for non-chart Aries application surfaces.

The flat semantic map is intentionally closed: profiles may select reviewed
surface classes and material properties, but may not persist arbitrary CSS,
URLs, filters, selectors, or executable strings.
"""
from __future__ import annotations

import math
from typing import Any, Mapping


APP_AUTHORING_OVERRIDE_PREFIX = "authoring.app."
APP_STYLE_CLASS_MANIFEST_VERSION = "app-materials-v2"

APP_MATERIAL_CLASSES = frozenset({
    "materials.global",
    "surfaces.canvas",
    "sidebar",
    "titlebar",
    "statusbar",
    "panel",
    "inspector",
    "overlay",
    "popover",
    "control",
    "dataBody",
    "dataHeader",
})

COLOR_PROPERTIES = frozenset({
    "backgroundColor",
    "patternColor",
    "gradientStartColor",
    "gradientEndColor",
    "shadowColor",
})
NUMERIC_BOUNDS = {
    "opacity": (0.0, 100.0),
    "cellSize": (0.5, 64.0),
    "dotSize": (0.25, 32.0),
    "density": (0.0, 100.0),
    "angle": (-180.0, 180.0),
    "gradientAngle": (-180.0, 180.0),
    "seed": (0.0, 65535.0),
    "backdropBlur": (0.0, 40.0),
    "backdropSaturation": (0.0, 200.0),
    "shadowX": (-64.0, 64.0),
    "shadowY": (-64.0, 64.0),
    "shadowBlur": (0.0, 80.0),
}
ENUM_VALUES = {
    "pattern": frozenset({
        "none",
        "solid",
        "stipple",
        "bayer2",
        "bayer4",
        "bayer8",
        "noise",
        "blueNoise",
        "paper",
        "newsprint",
        "hatch",
        "crosshatch",
        "scanline",
        "atkinson",
        "floydSteinberg",
    }),
    "blendMode": frozenset({
        "normal",
        "multiply",
        "screen",
        "overlay",
        "soft-light",
        "hard-light",
        "darken",
        "lighten",
    }),
    "gradientType": frozenset({"none", "linear", "radial"}),
}
APP_MATERIAL_PROPERTIES = frozenset({
    *COLOR_PROPERTIES,
    *NUMERIC_BOUNDS,
    *ENUM_VALUES,
})
INTEGER_PROPERTIES = frozenset({"seed"})


class AppStyleAuthoringError(ValueError):
    """An application material class property failed validation."""


def _split_override_id(semantic_id: str) -> tuple[str, str]:
    if not semantic_id.startswith(APP_AUTHORING_OVERRIDE_PREFIX):
        raise AppStyleAuthoringError(
            f"app authoring override must start with {APP_AUTHORING_OVERRIDE_PREFIX}"
        )
    parts = semantic_id[len(APP_AUTHORING_OVERRIDE_PREFIX):].split(".")
    if len(parts) < 2:
        raise AppStyleAuthoringError(f"invalid app authoring override id: {semantic_id}")
    class_id = ".".join(parts[:-1])
    property_name = parts[-1]
    if class_id not in APP_MATERIAL_CLASSES:
        raise AppStyleAuthoringError(
            f"unknown app authoring class in {semantic_id}: {class_id}"
        )
    if property_name not in APP_MATERIAL_PROPERTIES:
        raise AppStyleAuthoringError(
            f"unknown app authoring property in {semantic_id}: {property_name}"
        )
    return class_id, property_name


def _validate_color(semantic_id: str, value: Any) -> list:
    if not isinstance(value, (list, tuple)) or len(value) not in (3, 4):
        raise AppStyleAuthoringError(
            f"{semantic_id} must be an RGB or RGBA array"
        )
    color: list[Any] = []
    for channel in value[:3]:
        if (
            isinstance(channel, bool)
            or not isinstance(channel, int)
            or not 0 <= channel <= 255
        ):
            raise AppStyleAuthoringError(
                f"{semantic_id} RGB channels must be integers from 0 to 255"
            )
        color.append(channel)
    if len(value) == 4:
        alpha = value[3]
        if isinstance(alpha, bool) or not isinstance(alpha, (int, float)):
            raise AppStyleAuthoringError(
                f"{semantic_id} alpha must be a number from 0 to 1"
            )
        normalized_alpha = float(alpha)
        if not math.isfinite(normalized_alpha) or not 0 <= normalized_alpha <= 1:
            raise AppStyleAuthoringError(
                f"{semantic_id} alpha must be a number from 0 to 1"
            )
        color.append(normalized_alpha)
    return color


def _validate_number(semantic_id: str, property_name: str, value: Any) -> int | float:
    if property_name in INTEGER_PROPERTIES:
        if isinstance(value, bool) or not isinstance(value, int):
            raise AppStyleAuthoringError(f"{semantic_id} must be an integer")
    elif isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AppStyleAuthoringError(f"{semantic_id} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise AppStyleAuthoringError(f"{semantic_id} must be finite")
    minimum, maximum = NUMERIC_BOUNDS[property_name]
    if number < minimum or number > maximum:
        raise AppStyleAuthoringError(
            f"{semantic_id} must be between {minimum:g} and {maximum:g}"
        )
    return int(number) if number.is_integer() else number


def validate_app_authoring_override(semantic_id: str, value: Any) -> Any:
    """Validate one flat application-material authoring value."""
    _, property_name = _split_override_id(semantic_id)
    if property_name in COLOR_PROPERTIES:
        return _validate_color(semantic_id, value)
    if property_name in NUMERIC_BOUNDS:
        return _validate_number(semantic_id, property_name, value)
    if not isinstance(value, str) or value not in ENUM_VALUES[property_name]:
        choices = ", ".join(sorted(ENUM_VALUES[property_name]))
        raise AppStyleAuthoringError(
            f"{semantic_id} must be one of: {choices}"
        )
    return value


def validate_app_authoring_overrides(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise AppStyleAuthoringError("app authoring overrides must be an object")
    maximum = len(APP_MATERIAL_CLASSES) * len(APP_MATERIAL_PROPERTIES)
    if len(payload) > maximum:
        raise AppStyleAuthoringError("too many app authoring overrides")
    normalized = {
        str(semantic_id): validate_app_authoring_override(
            str(semantic_id),
            value,
        )
        for semantic_id, value in payload.items()
    }
    return dict(sorted(normalized.items()))


def apply_app_authoring_patch(
    current: Mapping[str, Any],
    patch: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Apply one deletion-aware CAS patch to an application material map."""
    if not isinstance(patch, Mapping):
        raise AppStyleAuthoringError(
            "app authoring overrides patch must be an object"
        )
    merged = validate_app_authoring_overrides(current)
    changed: list[str] = []
    removed: list[str] = []
    for raw_id, value in patch.items():
        semantic_id = str(raw_id)
        _split_override_id(semantic_id)
        if value is None:
            if semantic_id in merged:
                del merged[semantic_id]
                removed.append(semantic_id)
            continue
        normalized = validate_app_authoring_override(semantic_id, value)
        if merged.get(semantic_id) != normalized:
            merged[semantic_id] = normalized
            changed.append(semantic_id)
    return dict(sorted(merged.items())), sorted(changed), sorted(removed)


def app_authoring_schema() -> dict[str, Any]:
    """Public closed manifest consumed by the isolated Style Lab."""
    properties: dict[str, dict[str, Any]] = {}
    for property_name in sorted(APP_MATERIAL_PROPERTIES):
        if property_name in COLOR_PROPERTIES:
            properties[property_name] = {
                "type": "color",
                "supportsAlpha": True,
            }
        elif property_name in NUMERIC_BOUNDS:
            minimum, maximum = NUMERIC_BOUNDS[property_name]
            numeric_spec: dict[str, Any] = {
                "type": "integer" if property_name in INTEGER_PROPERTIES else "number",
                "min": minimum,
                "max": maximum,
            }
            unit = (
                "%"
                if property_name in {"opacity", "density", "backdropSaturation"}
                else "deg"
                if property_name == "angle"
                else "px"
                if property_name in {
                    "cellSize",
                    "dotSize",
                    "backdropBlur",
                    "shadowX",
                    "shadowY",
                    "shadowBlur",
                }
                else None
            )
            if unit is not None:
                numeric_spec["unit"] = unit
            properties[property_name] = numeric_spec
        else:
            properties[property_name] = {
                "type": "enum",
                "values": sorted(ENUM_VALUES[property_name]),
            }
    return {
        "classManifestVersion": APP_STYLE_CLASS_MANIFEST_VERSION,
        "overridePrefix": APP_AUTHORING_OVERRIDE_PREFIX,
        "keyPattern": "authoring.app.<classId>.<property>",
        "properties": properties,
        "classes": [
            {
                "classId": class_id,
                "properties": sorted(APP_MATERIAL_PROPERTIES),
            }
            for class_id in sorted(APP_MATERIAL_CLASSES)
        ],
    }
