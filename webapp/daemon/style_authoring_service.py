# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Validated profile-v2 authoring data for the isolated Chart Style Lab.

The legacy public token catalog remains intentionally closed.  Direct wheel
class properties use their own explicit grammar and are persisted alongside a
style profile without becoming active application options.
"""
from __future__ import annotations

import math
from copy import deepcopy
from typing import Any, Mapping


AUTHORING_OVERRIDE_PREFIX = "authoring.wheel."
CHART_STYLE_PROFILE_SCHEMA_VERSION = 2
CHART_STYLE_CLASS_MANIFEST_VERSION = "wheel-v2"
CHART_STYLE_PROFILE_SCHEMA_URL = "https://aries.app/schemas/chart-style-profile-v2.json"
CHART_AUTHORING_REFERENCE_SPACE = {
    "width": 800,
    "height": 800,
    "wheelRadius": 400,
    "unit": "chart-px",
}
AUTHORING_SCOPES = ("base", "classic", "compact", "anglo")


class StyleAuthoringError(ValueError):
    """A profile-v2 class property or profile failed validation."""


TYPOGRAPHY_CLASSES = frozenset({
    "zodiac.signGlyph",
    "subdivisions.term.glyph",
    "subdivisions.decan.glyph",
    "houses.inner.label",
    "houses.inner.position.degree",
    "houses.inner.position.sign",
    "houses.inner.position.minute",
    "houses.outer.label",
    "angles.inner.label",
    "angles.inner.position.degree",
    "angles.inner.position.sign",
    "angles.inner.position.minute",
    "angles.outer.label",
    "bodies.inner.glyph",
    "bodies.inner.motion",
    "bodies.inner.position.degree",
    "bodies.inner.position.sign",
    "bodies.inner.position.minute",
    "bodies.outer.glyph",
    "bodies.outer.motion",
    "aspects.primary.glyph",
    "aspects.interchart.glyph",
    "secondaryRing.fixedStar.label",
    "secondaryRing.asteroid.label",
    "secondaryRing.midpoint.glyph",
    "secondaryRing.midpoint.text",
    "secondaryRing.hybridHit.label",
    "secondaryRing.antiscia.glyph",
    "secondaryRing.antiscia.text",
    "secondaryRing.contraAntiscia.glyph",
    "secondaryRing.contraAntiscia.text",
    "secondaryRing.dodecatemoria.glyph",
    "secondaryRing.dodecatemoria.text",
    "secondaryRing.arabicPart.label",
    "secondaryRing.parallelTransit.glyph",
    "secondaryRing.parallelTransit.motion",
    "surveil.marker.glyph",
    "surveil.marker.label",
    "surveil.sourceLabel",
    "chartOverlay.information.topLeft",
    "chartOverlay.information.bottomLeft",
    "chartOverlay.houseSystem.bottomRight",
    "chartOverlay.events.dayHour.label",
    "chartOverlay.events.dayHour.glyph",
    "chartOverlay.events.dayHour.trailing",
    "chartOverlay.events.header.label",
    "chartOverlay.events.header.glyph",
    "chartOverlay.events.header.trailing",
    "chartOverlay.events.signal.label",
    "chartOverlay.events.signal.glyph",
    "chartOverlay.events.signal.trailing",
})

COLOR_ONLY_CLASSES = frozenset({
    "bodies.fortune",
    "bodies.vertex",
    "bodies.prenatalSyzygy",
})

LINE_CLASSES = frozenset({
    "rings.outerMaximum",
    "rings.outerHouse",
    "rings.outerDegree",
    "rings.zodiacOuter",
    "rings.innerDegree",
    "rings.zodiacInner",
    "rings.term",
    "rings.angloCuspOuter",
    "rings.innerBoundary",
    "rings.aspectBoundary",
    "rings.houseBoundary",
    "rings.base",
    "zodiac.spoke",
    "zodiac.tick.inner.10deg",
    "zodiac.tick.inner.5deg",
    "zodiac.tick.inner.1deg",
    "zodiac.tick.outer.10deg",
    "zodiac.tick.outer.5deg",
    "zodiac.tick.outer.1deg",
    "zodiac.tick.angloCuspRuler.10deg",
    "zodiac.tick.angloCuspRuler.5deg",
    "zodiac.tick.angloCuspRuler.1deg",
    "zodiac.tick.angloHouseCusp",
    "zodiac.tick.angloAngleRuler",
    "subdivisions.term.boundary",
    "subdivisions.decan.boundary",
    "houses.inner.cusp",
    "houses.outer.cusp",
    "angles.inner.ray",
    "angles.inner.arrowhead",
    "angles.outer.ray",
    "angles.outer.arrowhead",
    "bodies.inner.leader",
    "bodies.outer.leader",
    "aspects.primary.line",
    "aspects.interchart.line",
    "aspects.interchart.endpointMarker",
    "secondaryRing.fixedStar.leader",
    "secondaryRing.asteroid.leader",
    "secondaryRing.midpoint.leader",
    "secondaryRing.hybridHit.leader",
    "secondaryRing.antiscia.leader",
    "secondaryRing.contraAntiscia.leader",
    "secondaryRing.dodecatemoria.leader",
    "secondaryRing.arabicPart.leader",
    "secondaryRing.parallelTransit.leader",
    "surveil.tick",
})

FILL_CLASSES = frozenset({
    "canvas.background",
    "fills.chartField",
    "fills.houseField",
    "fills.centerField",
    "fills.zodiacBand",
    "fills.subdivisionBand",
})

RING_CLASSES = frozenset(class_id for class_id in LINE_CLASSES if class_id.startswith("rings."))
LINE_PROPERTIES = frozenset({
    "strokeWidth", "strokeStyle", "dashLength", "dashGap",
    "color", "opacity", "lineCap", "lineJoin",
})
TYPOGRAPHY_PROPERTIES = frozenset({
    "fontRef", "fontSize", "tracking", "color", "opacity",
})
FILL_PROPERTIES = frozenset({
    "fillPattern", "cellSize", "dotSize", "backgroundColor", "patternColor",
    "gradientType", "gradientDirection", "gradientStartColor",
    "gradientEndColor", "gradientAngle",
    "opacity", "density", "angle", "seed",
})
MASK_FILL_PROPERTIES = frozenset({
    "textureMask", "maskDirection", "maskAngle", "maskAmount",
})
SHADOW_FILL_PROPERTIES = frozenset({
    "shadowPattern", "shadowColor", "shadowX", "shadowY", "shadowBlur",
})
COLOR_PROPERTIES = frozenset({
    "backgroundColor", "patternColor", "gradientStartColor", "gradientEndColor",
    "shadowColor", "color",
})
DIMENSION_PROPERTIES = frozenset({
    "fontSize", "tracking", "strokeWidth", "dashLength", "dashGap", "radius",
    "cellSize", "dotSize", "shadowX", "shadowY", "shadowBlur",
})
FONT_REF_PROPERTIES = frozenset({"fontRef"})
ALL_PROPERTIES = frozenset((
    *DIMENSION_PROPERTIES,
    *COLOR_PROPERTIES,
    *FONT_REF_PROPERTIES,
    *MASK_FILL_PROPERTIES,
    *SHADOW_FILL_PROPERTIES,
    "strokeStyle", "fillPattern", "shadowPattern", "gradientType", "gradientDirection",
    "gradientAngle", "opacity", "density", "angle", "seed",
    "lineCap", "lineJoin",
))

NUMERIC_BOUNDS = {
    "fontSize": (1.0, 128.0),
    "tracking": (-32.0, 64.0),
    "strokeWidth": (0.0, 16.0),
    "dashLength": (0.0, 96.0),
    "dashGap": (0.0, 96.0),
    "cellSize": (0.5, 48.0),
    "dotSize": (0.25, 24.0),
    "shadowX": (-128.0, 128.0),
    "shadowY": (-128.0, 128.0),
    "shadowBlur": (0.0, 64.0),
    "opacity": (0.0, 100.0),
    "density": (0.0, 100.0),
    "angle": (-180.0, 180.0),
    "gradientAngle": (-180.0, 180.0),
    "maskAngle": (-180.0, 180.0),
    "maskAmount": (0.0, 100.0),
    "seed": (0.0, 65535.0),
    "radius": (0.0, 400.0),
}

SYMBOL_TYPOGRAPHY_CLASSES = frozenset({
    "zodiac.signGlyph",
    "subdivisions.term.glyph",
    "subdivisions.decan.glyph",
    "houses.inner.position.sign",
    "angles.inner.position.sign",
    "bodies.inner.glyph",
    "bodies.inner.position.sign",
    "bodies.outer.glyph",
    "aspects.primary.glyph",
    "aspects.interchart.glyph",
    "secondaryRing.midpoint.glyph",
    "secondaryRing.antiscia.glyph",
    "secondaryRing.contraAntiscia.glyph",
    "secondaryRing.dodecatemoria.glyph",
    "secondaryRing.parallelTransit.glyph",
    "secondaryRing.parallelTransit.motion",
    "surveil.marker.glyph",
    "chartOverlay.events.dayHour.glyph",
    "chartOverlay.events.header.glyph",
    "chartOverlay.events.signal.glyph",
})
ENUM_VALUES = {
    "strokeStyle": frozenset({"solid", "dashed", "dotted"}),
    "fillPattern": frozenset({
        "none", "solid", "stipple", "bayer2", "bayer4", "bayer8",
        "noise", "blueNoise", "paper", "newsprint", "hatch", "crosshatch",
        "scanline", "atkinson", "floydSteinberg",
    }),
    "shadowPattern": frozenset({
        "none", "solid", "stipple", "bayer2", "bayer4", "bayer8",
        "noise", "blueNoise", "paper", "newsprint", "hatch", "crosshatch",
        "scanline", "atkinson", "floydSteinberg",
    }),
    "gradientType": frozenset({"none", "linear", "radial"}),
    "gradientDirection": frozenset({"fixed", "sun"}),
    "textureMask": frozenset({"none", "crescent"}),
    "maskDirection": frozenset({"fixed", "sun"}),
    "lineCap": frozenset({"butt", "round", "square"}),
    "lineJoin": frozenset({"bevel", "round", "miter"}),
}


def class_properties(class_id: str) -> frozenset[str]:
    properties: set[str] = set()
    if class_id in TYPOGRAPHY_CLASSES:
        properties.update(TYPOGRAPHY_PROPERTIES)
    if class_id in COLOR_ONLY_CLASSES:
        properties.add("color")
    if class_id in LINE_CLASSES:
        properties.update(LINE_PROPERTIES)
    if class_id in FILL_CLASSES:
        properties.update(FILL_PROPERTIES)
    if class_id in FILL_CLASSES and class_id != "canvas.background":
        properties.update(MASK_FILL_PROPERTIES)
        properties.update(SHADOW_FILL_PROPERTIES)
    if class_id in RING_CLASSES:
        properties.add("radius")
    return frozenset(properties)


def _split_override_id(semantic_id: str) -> tuple[str, str, str]:
    if not semantic_id.startswith(AUTHORING_OVERRIDE_PREFIX):
        raise StyleAuthoringError(
            f"authoring override must start with {AUTHORING_OVERRIDE_PREFIX}"
        )
    parts = semantic_id[len(AUTHORING_OVERRIDE_PREFIX):].split(".")
    if len(parts) < 3:
        raise StyleAuthoringError(f"invalid authoring override id: {semantic_id}")
    scope, property_name = parts[0], parts[-1]
    class_id = ".".join(parts[1:-1])
    if scope not in AUTHORING_SCOPES:
        raise StyleAuthoringError(f"unknown authoring scope in {semantic_id}: {scope}")
    if property_name not in ALL_PROPERTIES:
        raise StyleAuthoringError(f"unknown authoring property in {semantic_id}: {property_name}")
    supported = class_properties(class_id)
    if not supported:
        raise StyleAuthoringError(f"unknown authoring class in {semantic_id}: {class_id}")
    if property_name not in supported:
        raise StyleAuthoringError(
            f"{class_id} does not support authoring property {property_name}"
        )
    return scope, class_id, property_name


def _validated_font_ref(
    semantic_id: str,
    class_id: str,
    value: Any,
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise StyleAuthoringError(f"{semantic_id} must be a font reference object")
    allowed_keys = {
        "role", "source", "family", "cssFamily", "style", "weight",
        "postscriptName", "assetId", "variationAxes",
    }
    unknown_keys = set(value) - allowed_keys
    if unknown_keys:
        raise StyleAuthoringError(
            f"{semantic_id} has unknown font field: {sorted(unknown_keys)[0]}"
        )
    expected_role = (
        "symbols" if class_id in SYMBOL_TYPOGRAPHY_CLASSES else "text"
    )
    if value.get("role") != expected_role:
        raise StyleAuthoringError(
            f"{semantic_id} font role must be {expected_role}"
        )
    source = value.get("source")
    if source not in {"bundled", "local", "asset", "generic"}:
        raise StyleAuthoringError(
            f"{semantic_id} font source must be bundled, local, asset, or generic"
        )

    def clean_text(field: str, *, required: bool = True, maximum: int = 512) -> str | None:
        raw = value.get(field)
        if raw is None and not required:
            return None
        if (
            not isinstance(raw, str)
            or not raw.strip()
            or len(raw) > maximum
            or any(character in raw for character in ("\x00", "\r", "\n"))
        ):
            raise StyleAuthoringError(f"{semantic_id} font {field} is invalid")
        return raw.strip()

    family = value.get("family")
    if (
        not isinstance(family, (list, tuple))
        or not 1 <= len(family) <= 16
    ):
        raise StyleAuthoringError(
            f"{semantic_id} font family must be a non-empty array"
        )
    normalized_family = []
    for item in family:
        if (
            not isinstance(item, str)
            or not item.strip()
            or len(item) > 200
            or any(character in item for character in ("\x00", "\r", "\n"))
        ):
            raise StyleAuthoringError(
                f"{semantic_id} font family entries are invalid"
            )
        normalized_family.append(item.strip())

    weight = value.get("weight")
    if (
        isinstance(weight, bool)
        or not isinstance(weight, (int, float))
        or not math.isfinite(float(weight))
        or not 1 <= float(weight) <= 1000
    ):
        raise StyleAuthoringError(
            f"{semantic_id} font weight must be between 1 and 1000"
        )
    axes = value.get("variationAxes")
    normalized_axes: dict[str, float | int] | None = None
    if axes is not None:
        if not isinstance(axes, Mapping) or len(axes) > 32:
            raise StyleAuthoringError(
                f"{semantic_id} variationAxes must be an object"
            )
        normalized_axes = {}
        for raw_axis, raw_axis_value in axes.items():
            axis = str(raw_axis)
            if (
                not 1 <= len(axis) <= 32
                or any(character in axis for character in ("\x00", "\r", "\n"))
                or isinstance(raw_axis_value, bool)
                or not isinstance(raw_axis_value, (int, float))
                or not math.isfinite(float(raw_axis_value))
            ):
                raise StyleAuthoringError(
                    f"{semantic_id} variation axis {axis!r} is invalid"
                )
            normalized_axes[axis] = raw_axis_value
    normalized = {
        "role": expected_role,
        "source": source,
        "family": normalized_family,
        "cssFamily": clean_text("cssFamily"),
        "style": clean_text("style", maximum=80),
        "weight": weight,
    }
    postscript_name = clean_text("postscriptName", required=False, maximum=200)
    asset_id = clean_text("assetId", required=False, maximum=200)
    if source == "asset" and asset_id is None:
        raise StyleAuthoringError(
            f"{semantic_id} asset font requires assetId"
        )
    if source == "local" and postscript_name is None:
        raise StyleAuthoringError(
            f"{semantic_id} local font requires postscriptName"
        )
    if postscript_name is not None:
        normalized["postscriptName"] = postscript_name
    if asset_id is not None:
        normalized["assetId"] = asset_id
    if normalized_axes is not None:
        normalized["variationAxes"] = dict(sorted(normalized_axes.items()))
    return normalized


def _validated_value(
    semantic_id: str,
    class_id: str,
    property_name: str,
    value: Any,
) -> Any:
    if property_name in FONT_REF_PROPERTIES:
        return _validated_font_ref(semantic_id, class_id, value)
    if property_name in NUMERIC_BOUNDS:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise StyleAuthoringError(f"{semantic_id} must be a number")
        number = float(value)
        if not math.isfinite(number):
            raise StyleAuthoringError(f"{semantic_id} must be finite")
        if property_name == "seed" and not number.is_integer():
            raise StyleAuthoringError(f"{semantic_id} must be an integer")
        minimum, maximum = NUMERIC_BOUNDS[property_name]
        if number < minimum or number > maximum:
            raise StyleAuthoringError(
                f"{semantic_id} must be between {minimum:g} and {maximum:g}"
            )
        return value
    if property_name in COLOR_PROPERTIES:
        if not isinstance(value, (list, tuple)) or len(value) not in (3, 4):
            raise StyleAuthoringError(f"{semantic_id} must be an RGB or RGBA array")
        color = []
        for channel in value[:3]:
            if isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel <= 255:
                raise StyleAuthoringError(
                    f"{semantic_id} RGB channels must be integers from 0 to 255"
                )
            color.append(channel)
        if len(value) == 4:
            alpha = value[3]
            if isinstance(alpha, bool) or not isinstance(alpha, (int, float)):
                raise StyleAuthoringError(f"{semantic_id} alpha must be a number from 0 to 1")
            alpha = float(alpha)
            if not math.isfinite(alpha) or not 0 <= alpha <= 1:
                raise StyleAuthoringError(f"{semantic_id} alpha must be a number from 0 to 1")
            color.append(alpha)
        return color
    if not isinstance(value, str) or value not in ENUM_VALUES[property_name]:
        choices = ", ".join(sorted(ENUM_VALUES[property_name]))
        raise StyleAuthoringError(f"{semantic_id} must be one of: {choices}")
    return value


def validate_authoring_override(semantic_id: str, value: Any) -> Any:
    """Validate one flat profile-v2 authoring value."""
    _, class_id, property_name = _split_override_id(semantic_id)
    return _validated_value(semantic_id, class_id, property_name, value)


def validate_authoring_overrides(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise StyleAuthoringError("authoring overrides must be an object")
    if len(payload) > len(AUTHORING_SCOPES) * len(ALL_PROPERTIES) * (
        len(LINE_CLASSES) + len(TYPOGRAPHY_CLASSES) + len(FILL_CLASSES)
    ):
        raise StyleAuthoringError("too many authoring overrides")
    normalized = {
        str(semantic_id): validate_authoring_override(str(semantic_id), value)
        for semantic_id, value in payload.items()
    }
    return dict(sorted(normalized.items()))


def apply_authoring_patch(
    current: Mapping[str, Any],
    patch: Mapping[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    if not isinstance(patch, Mapping):
        raise StyleAuthoringError("authoring overrides patch must be an object")
    merged = validate_authoring_overrides(current)
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
        normalized = validate_authoring_override(semantic_id, value)
        if merged.get(semantic_id) != normalized:
            merged[semantic_id] = normalized
            changed.append(semantic_id)
    return dict(sorted(merged.items())), sorted(changed), sorted(removed)


def _dimension(value: Any) -> dict[str, Any]:
    return {"value": value, "unit": "px"}


def _color(value: Any) -> dict[str, Any]:
    result = {
        "colorSpace": "srgb",
        "components": list(value[:3]),
    }
    if len(value) == 4:
        result["alpha"] = value[3]
    return result


def build_chart_style_profile_v2(
    overrides: Mapping[str, Any],
    *,
    base: Mapping[str, Any] | None = None,
    reference_space: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Compile flat CAS-friendly keys into the portable nested profile."""
    normalized = validate_authoring_overrides(overrides)
    styles: dict[str, dict[str, Any]] = {}
    variants: dict[str, dict[str, dict[str, Any]]] = {
        "classic": {}, "compact": {}, "anglo": {},
    }
    for semantic_id, value in normalized.items():
        scope, class_id, property_name = _split_override_id(semantic_id)
        class_map = styles if scope == "base" else variants[scope]
        properties = class_map.setdefault(class_id, {})
        if property_name in DIMENSION_PROPERTIES:
            properties[property_name] = _dimension(value)
        elif property_name in COLOR_PROPERTIES:
            properties[property_name] = _color(value)
        elif property_name in FONT_REF_PROPERTIES:
            properties[property_name] = deepcopy(value)
        elif property_name == "opacity":
            properties[property_name] = float(value) / 100.0
        else:
            properties[property_name] = value
    profile = {
        "$schema": CHART_STYLE_PROFILE_SCHEMA_URL,
        "profileSchemaVersion": CHART_STYLE_PROFILE_SCHEMA_VERSION,
        "classManifestVersion": CHART_STYLE_CLASS_MANIFEST_VERSION,
        "base": deepcopy(dict(base or {"id": "aries-default", "contentHash": "runtime-default"})),
        "referenceSpace": deepcopy(dict(reference_space or CHART_AUTHORING_REFERENCE_SPACE)),
        "styles": dict(sorted(styles.items())),
        "variants": {
            variant: dict(sorted(class_map.items()))
            for variant, class_map in variants.items()
        },
    }
    return validate_chart_style_profile_v2(profile)


def _validate_base(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise StyleAuthoringError("chart style profile base must be an object")
    base_id = value.get("id")
    content_hash = value.get("contentHash")
    if not isinstance(base_id, str) or not base_id.strip() or len(base_id) > 80:
        raise StyleAuthoringError("chart style profile base id is invalid")
    if not isinstance(content_hash, str) or not content_hash.strip() or len(content_hash) > 160:
        raise StyleAuthoringError("chart style profile base contentHash is invalid")
    return {"id": base_id.strip(), "contentHash": content_hash.strip()}


def _validate_reference_space(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping) or value.get("unit") != "chart-px":
        raise StyleAuthoringError("chart style referenceSpace must use chart-px")
    result: dict[str, Any] = {"unit": "chart-px"}
    for key in ("width", "height", "wheelRadius"):
        number = value.get(key)
        if isinstance(number, bool) or not isinstance(number, (int, float)):
            raise StyleAuthoringError(f"chart style referenceSpace {key} must be a number")
        if not math.isfinite(float(number)) or float(number) <= 0:
            raise StyleAuthoringError(f"chart style referenceSpace {key} must be positive")
        result[key] = number
    return {"width": result["width"], "height": result["height"], "wheelRadius": result["wheelRadius"], "unit": "chart-px"}


def flatten_chart_style_profile_v2(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise StyleAuthoringError("chart style profile v2 must be an object")
    if payload.get("profileSchemaVersion") != CHART_STYLE_PROFILE_SCHEMA_VERSION:
        raise StyleAuthoringError(
            f"unsupported chart style profile version: {payload.get('profileSchemaVersion')}"
        )
    if payload.get("classManifestVersion") != CHART_STYLE_CLASS_MANIFEST_VERSION:
        raise StyleAuthoringError(
            f"unsupported chart style class manifest: {payload.get('classManifestVersion')}"
        )
    _validate_base(payload.get("base"))
    _validate_reference_space(payload.get("referenceSpace"))
    styles = payload.get("styles")
    variants = payload.get("variants")
    if not isinstance(styles, Mapping) or not isinstance(variants, Mapping):
        raise StyleAuthoringError("chart style styles and variants must be objects")
    unknown_variants = set(variants) - {"classic", "compact", "anglo"}
    if unknown_variants:
        raise StyleAuthoringError(f"unknown chart style variant: {sorted(unknown_variants)[0]}")
    flat: dict[str, Any] = {}
    containers = [("base", styles), *(
        (variant, variants.get(variant, {}))
        for variant in ("classic", "compact", "anglo")
    )]
    for scope, class_map in containers:
        if not isinstance(class_map, Mapping):
            raise StyleAuthoringError(f"chart style {scope} classes must be an object")
        for raw_class_id, raw_properties in class_map.items():
            class_id = str(raw_class_id)
            if not isinstance(raw_properties, Mapping):
                raise StyleAuthoringError(f"chart style class {class_id} must be an object")
            for raw_property_name, raw_value in raw_properties.items():
                property_name = str(raw_property_name)
                semantic_id = (
                    f"{AUTHORING_OVERRIDE_PREFIX}{scope}.{class_id}.{property_name}"
                )
                _split_override_id(semantic_id)
                if property_name in DIMENSION_PROPERTIES:
                    if not isinstance(raw_value, Mapping) or raw_value.get("unit") != "px":
                        raise StyleAuthoringError(f"{semantic_id} must be a px dimension")
                    value = raw_value.get("value")
                elif property_name in COLOR_PROPERTIES:
                    if (
                        not isinstance(raw_value, Mapping)
                        or raw_value.get("colorSpace") != "srgb"
                        or not isinstance(raw_value.get("components"), (list, tuple))
                    ):
                        raise StyleAuthoringError(f"{semantic_id} must be an sRGB color")
                    value = list(raw_value["components"])
                    if "alpha" in raw_value:
                        value.append(raw_value["alpha"])
                elif property_name in FONT_REF_PROPERTIES:
                    if not isinstance(raw_value, Mapping):
                        raise StyleAuthoringError(
                            f"{semantic_id} must be a font reference object"
                        )
                    value = deepcopy(dict(raw_value))
                elif property_name == "opacity":
                    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                        raise StyleAuthoringError(f"{semantic_id} must be a number")
                    value = float(raw_value) * 100.0
                else:
                    value = raw_value
                flat[semantic_id] = validate_authoring_override(semantic_id, value)
    return dict(sorted(flat.items()))


def validate_chart_style_profile_v2(payload: Any) -> dict[str, Any]:
    """Normalize a nested profile-v2 payload and reject unknown class data."""
    if not isinstance(payload, Mapping):
        raise StyleAuthoringError("chart style profile v2 must be an object")
    flat = flatten_chart_style_profile_v2(payload)
    return build_chart_style_profile_v2_unchecked(
        flat,
        base=_validate_base(payload.get("base")),
        reference_space=_validate_reference_space(payload.get("referenceSpace")),
    )


def build_chart_style_profile_v2_unchecked(
    normalized_overrides: Mapping[str, Any],
    *,
    base: Mapping[str, Any],
    reference_space: Mapping[str, Any],
) -> dict[str, Any]:
    """Build a canonical profile after flat/base/reference validation."""
    styles: dict[str, dict[str, Any]] = {}
    variants: dict[str, dict[str, dict[str, Any]]] = {
        "classic": {}, "compact": {}, "anglo": {},
    }
    for semantic_id, value in normalized_overrides.items():
        scope, class_id, property_name = _split_override_id(semantic_id)
        class_map = styles if scope == "base" else variants[scope]
        properties = class_map.setdefault(class_id, {})
        if property_name in DIMENSION_PROPERTIES:
            properties[property_name] = _dimension(value)
        elif property_name in COLOR_PROPERTIES:
            properties[property_name] = _color(value)
        elif property_name in FONT_REF_PROPERTIES:
            properties[property_name] = deepcopy(value)
        elif property_name == "opacity":
            properties[property_name] = float(value) / 100.0
        else:
            properties[property_name] = value
    return {
        "$schema": CHART_STYLE_PROFILE_SCHEMA_URL,
        "profileSchemaVersion": CHART_STYLE_PROFILE_SCHEMA_VERSION,
        "classManifestVersion": CHART_STYLE_CLASS_MANIFEST_VERSION,
        "base": deepcopy(dict(base)),
        "referenceSpace": deepcopy(dict(reference_space)),
        "styles": dict(sorted(styles.items())),
        "variants": {
            variant: dict(sorted(class_map.items()))
            for variant, class_map in variants.items()
        },
    }


def authoring_schema() -> dict[str, Any]:
    classes = sorted(
        LINE_CLASSES | TYPOGRAPHY_CLASSES | COLOR_ONLY_CLASSES | FILL_CLASSES
    )
    return {
        "profileSchemaVersion": CHART_STYLE_PROFILE_SCHEMA_VERSION,
        "classManifestVersion": CHART_STYLE_CLASS_MANIFEST_VERSION,
        "overridePrefix": AUTHORING_OVERRIDE_PREFIX,
        "keyPattern": "authoring.wheel.<base|classic|compact|anglo>.<classId>.<property>",
        "scopes": list(AUTHORING_SCOPES),
        "referenceSpace": deepcopy(CHART_AUTHORING_REFERENCE_SPACE),
        "properties": {
            property_name: (
                {
                    "type": "number",
                    "unit": {
                        "opacity": "%",
                        "density": "%",
                        "angle": "deg",
                        "gradientAngle": "deg",
                        "maskAngle": "deg",
                        "maskAmount": "%",
                        "seed": "",
                    }.get(property_name, "px"),
                    "min": bounds[0],
                    "max": bounds[1],
                }
                if (bounds := NUMERIC_BOUNDS.get(property_name)) is not None
                else {"type": "color", "supportsAlpha": True}
                if property_name in COLOR_PROPERTIES
                else {
                    "type": "fontRef",
                    "roles": ["text", "symbols"],
                    "sources": ["asset", "bundled", "generic", "local"],
                    "required": [
                        "role", "source", "family", "cssFamily", "style", "weight",
                    ],
                }
                if property_name in FONT_REF_PROPERTIES
                else {"type": "enum", "values": sorted(ENUM_VALUES[property_name])}
            )
            for property_name in sorted(ALL_PROPERTIES)
        },
        "classes": [
            {
                "classId": class_id,
                "properties": sorted(class_properties(class_id)),
                **(
                    {
                        "fontRole": (
                            "symbols"
                            if class_id in SYMBOL_TYPOGRAPHY_CLASSES
                            else "text"
                        )
                    }
                    if class_id in TYPOGRAPHY_CLASSES
                    else {}
                ),
            }
            for class_id in classes
        ],
    }
