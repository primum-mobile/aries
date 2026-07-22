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

RING_CLASSES = frozenset(class_id for class_id in LINE_CLASSES if class_id.startswith("rings."))
LINE_PROPERTIES = frozenset({
    "strokeWidth", "strokeStyle", "dashLength", "dashGap",
    "opacity", "lineCap", "lineJoin",
})
DIMENSION_PROPERTIES = frozenset({"fontSize", "strokeWidth", "dashLength", "dashGap", "radius"})
ALL_PROPERTIES = frozenset((*DIMENSION_PROPERTIES, "strokeStyle", "opacity", "lineCap", "lineJoin"))

NUMERIC_BOUNDS = {
    "fontSize": (1.0, 128.0),
    "strokeWidth": (0.0, 16.0),
    "dashLength": (0.0, 96.0),
    "dashGap": (0.0, 96.0),
    "opacity": (0.0, 100.0),
    "radius": (0.0, 400.0),
}
ENUM_VALUES = {
    "strokeStyle": frozenset({"solid", "dashed", "dotted"}),
    "lineCap": frozenset({"butt", "round", "square"}),
    "lineJoin": frozenset({"bevel", "round", "miter"}),
}


def class_properties(class_id: str) -> frozenset[str]:
    properties: set[str] = set()
    if class_id in TYPOGRAPHY_CLASSES:
        properties.add("fontSize")
    if class_id in LINE_CLASSES:
        properties.update(LINE_PROPERTIES)
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


def _validated_value(semantic_id: str, property_name: str, value: Any) -> Any:
    if property_name in NUMERIC_BOUNDS:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise StyleAuthoringError(f"{semantic_id} must be a number")
        number = float(value)
        if not math.isfinite(number):
            raise StyleAuthoringError(f"{semantic_id} must be finite")
        minimum, maximum = NUMERIC_BOUNDS[property_name]
        if number < minimum or number > maximum:
            raise StyleAuthoringError(
                f"{semantic_id} must be between {minimum:g} and {maximum:g}"
            )
        return value
    if not isinstance(value, str) or value not in ENUM_VALUES[property_name]:
        choices = ", ".join(sorted(ENUM_VALUES[property_name]))
        raise StyleAuthoringError(f"{semantic_id} must be one of: {choices}")
    return value


def validate_authoring_override(semantic_id: str, value: Any) -> Any:
    """Validate one flat profile-v2 authoring value."""
    _, _, property_name = _split_override_id(semantic_id)
    return _validated_value(semantic_id, property_name, value)


def validate_authoring_overrides(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise StyleAuthoringError("authoring overrides must be an object")
    if len(payload) > len(AUTHORING_SCOPES) * len(ALL_PROPERTIES) * (
        len(LINE_CLASSES) + len(TYPOGRAPHY_CLASSES)
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
    classes = sorted(LINE_CLASSES | TYPOGRAPHY_CLASSES)
    return {
        "profileSchemaVersion": CHART_STYLE_PROFILE_SCHEMA_VERSION,
        "classManifestVersion": CHART_STYLE_CLASS_MANIFEST_VERSION,
        "overridePrefix": AUTHORING_OVERRIDE_PREFIX,
        "keyPattern": "authoring.wheel.<base|classic|compact|anglo>.<classId>.<property>",
        "scopes": list(AUTHORING_SCOPES),
        "referenceSpace": deepcopy(CHART_AUTHORING_REFERENCE_SPACE),
        "properties": {
            property_name: (
                {"type": "number", "unit": "%" if property_name == "opacity" else "px", "min": bounds[0], "max": bounds[1]}
                if (bounds := NUMERIC_BOUNDS.get(property_name)) is not None
                else {"type": "enum", "values": sorted(ENUM_VALUES[property_name])}
            )
            for property_name in sorted(ALL_PROPERTIES)
        },
        "classes": [
            {"classId": class_id, "properties": sorted(class_properties(class_id))}
            for class_id in classes
        ],
    }
