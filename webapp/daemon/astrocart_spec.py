"""Daemon-owned semantic contracts for advanced astrocartography.

This module deliberately contains no route, renderer, or map-state code.  It
defines the canonical point universe and a deterministic configuration payload
that the service, exporter, and retained map can share.

Two invariants matter here:

* Technique membership comes from the live chart and configured semantic
  sources, never from wheel visibility or already-rendered hit lists.
* Unsupported point-family/technique combinations remain explicit.  They do
  not disappear from the catalog merely because their calculator is not wired
  yet.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
import re
from types import MappingProxyType
from typing import Any

import arabicparts
import astrology
import astrocart
import fixstars
import fortune
import houses
import planets
import util
from antiscia import Antiscia, Antiscion


ASTROCART_MAP_SPEC_SCHEMA = "aries.astrocart-map-spec"
ASTROCART_MAP_SPEC_SCHEMA_VERSION = 1

COORDINATE_IN_MUNDO = "in_mundo"
COORDINATE_ZODIACAL = "zodiacal"
COORDINATE_SYSTEMS = (COORDINATE_IN_MUNDO, COORDINATE_ZODIACAL)

ANGLE_KINDS = (
    astrocart.LINE_MC,
    astrocart.LINE_IC,
    astrocart.LINE_ASC,
    astrocart.LINE_DSC,
)

MODE_STANDARD = "standard"
MODE_GEODETIC_GREENWICH = "geodetic_greenwich"
MODE_GEODETIC_GIZA = "geodetic_giza"
MODE_LOCAL_SPACE = "local_space"
MODE_ORDER = (
    MODE_STANDARD,
    MODE_GEODETIC_GREENWICH,
    MODE_GEODETIC_GIZA,
    MODE_LOCAL_SPACE,
)

TECHNIQUE_TRANSIT = "transit"
TECHNIQUE_SECONDARY_PROGRESSION = "secondary_progression"
TECHNIQUE_MINOR_PROGRESSION = "minor_progression"
TECHNIQUE_TERTIARY_PROGRESSION = "tertiary_progression"
TECHNIQUE_SOLAR_ARC = "solar_arc"
DYNAMIC_TECHNIQUES = (
    TECHNIQUE_TRANSIT,
    TECHNIQUE_SECONDARY_PROGRESSION,
    TECHNIQUE_MINOR_PROGRESSION,
    TECHNIQUE_TERTIARY_PROGRESSION,
    TECHNIQUE_SOLAR_ARC,
)

ROLE_ANGULAR_LINE_SOURCE = "angular_line_source"
ROLE_PARAN_PARTICIPANT = "paran_participant"
ROLE_ASPECT_TO_ANGLE_SOURCE = "aspect_to_angle_source"
ROLE_LOCAL_SPACE_TRUE_RAY = "local_space_true_ray"
ROLE_LOCAL_SPACE_RECIPROCAL_RAY = "local_space_reciprocal_ray"
ROLE_ZENITH = "zenith"
ROLE_TRANSIT_ACTOR = "transit_actor"
ROLE_SECONDARY_PROGRESSION_ACTOR = "secondary_progression_actor"
ROLE_MINOR_PROGRESSION_ACTOR = "minor_progression_actor"
ROLE_TERTIARY_PROGRESSION_ACTOR = "tertiary_progression_actor"
ROLE_SOLAR_ARC_ACTOR = "solar_arc_actor"
ROLE_EXPORT_PARTICIPANT = "export_participant"
ALL_ROLES = (
    ROLE_ANGULAR_LINE_SOURCE,
    ROLE_PARAN_PARTICIPANT,
    ROLE_ASPECT_TO_ANGLE_SOURCE,
    ROLE_LOCAL_SPACE_TRUE_RAY,
    ROLE_LOCAL_SPACE_RECIPROCAL_RAY,
    ROLE_ZENITH,
    ROLE_TRANSIT_ACTOR,
    ROLE_SECONDARY_PROGRESSION_ACTOR,
    ROLE_MINOR_PROGRESSION_ACTOR,
    ROLE_TERTIARY_PROGRESSION_ACTOR,
    ROLE_SOLAR_ARC_ACTOR,
    ROLE_EXPORT_PARTICIPANT,
)

FAMILY_STANDARD_BODY = "standard_body"
FAMILY_CHIRON = "chiron"
FAMILY_LOGICAL_NODE = "logical_node"
FAMILY_ASTEROID_CENTAUR = "asteroid_centaur"
FAMILY_FIXED_STAR = "fixed_star"
FAMILY_ANGLE = "angle"
FAMILY_FORTUNE = "fortune"
FAMILY_VERTEX = "vertex"
FAMILY_PRENATAL_SYZYGY = "prenatal_syzygy"
FAMILY_CONFIGURED_LOT = "configured_lot"
FAMILY_OUTER_MIDPOINT = "outer_midpoint"
FAMILY_OUTER_ANTISCION = "outer_antiscion"
FAMILY_OUTER_CONTRA_ANTISCION = "outer_contra_antiscion"
FAMILY_OUTER_DODECATEMORIA = "outer_dodecatemoria"
FAMILY_OUTER_HYBRID_HIT = "outer_hybrid_hit"
_OUTER_HYBRID_SEMANTIC_PREFIX = "outer-hybrid:"
ALL_POINT_FAMILIES = (
    FAMILY_STANDARD_BODY,
    FAMILY_CHIRON,
    FAMILY_LOGICAL_NODE,
    FAMILY_ASTEROID_CENTAUR,
    FAMILY_FIXED_STAR,
    FAMILY_ANGLE,
    FAMILY_FORTUNE,
    FAMILY_VERTEX,
    FAMILY_PRENATAL_SYZYGY,
    FAMILY_CONFIGURED_LOT,
    FAMILY_OUTER_MIDPOINT,
    FAMILY_OUTER_ANTISCION,
    FAMILY_OUTER_CONTRA_ANTISCION,
    FAMILY_OUTER_DODECATEMORIA,
    FAMILY_OUTER_HYBRID_HIT,
)

_STANDARD_BODIES = (
    (astrology.SE_SUN, "Sun"),
    (astrology.SE_MOON, "Moon"),
    (astrology.SE_MERCURY, "Mercury"),
    (astrology.SE_VENUS, "Venus"),
    (astrology.SE_MARS, "Mars"),
    (astrology.SE_JUPITER, "Jupiter"),
    (astrology.SE_SATURN, "Saturn"),
    (astrology.SE_URANUS, "Uranus"),
    (astrology.SE_NEPTUNE, "Neptune"),
    (astrology.SE_PLUTO, "Pluto"),
)
_STANDARD_BODY_LABELS = dict(_STANDARD_BODIES)
_OUTER_BODY_LABELS = {
    **_STANDARD_BODY_LABELS,
    astrology.SE_MEAN_NODE: "N. Node",
    astrology.SE_TRUE_NODE: "S. Node",
    astrology.SE_CHIRON: "Chiron",
}

DEFAULT_SELECTED_POINT_IDS = tuple(sorted(
    [f"ephemeris-body:{body_id}" for body_id, _label in _STANDARD_BODIES]
    + [
        f"ephemeris-body:{astrology.SE_CHIRON}",
        "logical-node:north",
        "logical-node:south",
    ]
))

CURRENT_ASTEROID_CENTAUR_IDS = frozenset(
    (
        astrology.SE_CERES,
        astrology.SE_CHIRON,
        astrology.SE_JUNO,
        astrology.SE_PALLAS,
        astrology.SE_PHOLUS,
        astrology.SE_VESTA,
    )
)
CURRENT_NON_CHIRON_ASTEROID_IDS = frozenset(
    CURRENT_ASTEROID_CENTAUR_IDS - {astrology.SE_CHIRON}
)

_KNOWN_FIXED_STAR_LABELS = {
    # The configured Swiss catalog key remains the identity.  This label is a
    # fallback for lightweight charts where FixStars has not been materialized.
    "alLeo": "Regulus",
}

_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,127}$")
_ASPECT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_STANDARD_ASPECT_ANGLES = {
    "conjunction": 0.0,
    "semisextile": 30.0,
    "semisquare": 45.0,
    "septile": 360.0 / 7.0,
    "sextile": 60.0,
    "quintile": 72.0,
    "square": 90.0,
    "trine": 120.0,
    "sesquisquare": 135.0,
    "biquintile": 144.0,
    "quincunx": 150.0,
    "opposition": 180.0,
}
# Ordinary ACG ASC/DSC/MC/IC lines already are the source point's exact
# angular contact.  Keeping a second 0-degree aspect-to-angle definition would
# draw the same geometry again under an "ASPECT" label.
REDUNDANT_ASPECT_TO_ANGLE_IDS = frozenset(("conjunction",))

_DYNAMIC_TECHNIQUE_ALIASES = {
    "transits": TECHNIQUE_TRANSIT,
    "secondary": TECHNIQUE_SECONDARY_PROGRESSION,
    "secondary_progressions": TECHNIQUE_SECONDARY_PROGRESSION,
    "minor": TECHNIQUE_MINOR_PROGRESSION,
    "minor_progressions": TECHNIQUE_MINOR_PROGRESSION,
    "tertiary": TECHNIQUE_TERTIARY_PROGRESSION,
    "tertiary_progressions": TECHNIQUE_TERTIARY_PROGRESSION,
    "solar-arc": TECHNIQUE_SOLAR_ARC,
    "solar_arc_direction": TECHNIQUE_SOLAR_ARC,
}

_TECHNIQUE_ROLE = {
    TECHNIQUE_TRANSIT: ROLE_TRANSIT_ACTOR,
    TECHNIQUE_SECONDARY_PROGRESSION: ROLE_SECONDARY_PROGRESSION_ACTOR,
    TECHNIQUE_MINOR_PROGRESSION: ROLE_MINOR_PROGRESSION_ACTOR,
    TECHNIQUE_TERTIARY_PROGRESSION: ROLE_TERTIARY_PROGRESSION_ACTOR,
    TECHNIQUE_SOLAR_ARC: ROLE_SOLAR_ARC_ACTOR,
}


def _strict_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    return default


def _mapping_value(mapping: Mapping[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return default


def _identifier(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not _IDENTIFIER_RE.fullmatch(value):
        return None
    return value


def _normalized_ids(
    value: Any,
    *,
    default: Iterable[str] = (),
    allowed: Iterable[str] | None = None,
) -> tuple[str, ...]:
    values: Iterable[Any]
    if isinstance(value, str):
        values = (value,)
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        values = value
    else:
        values = default
    allowed_set = set(allowed) if allowed is not None else None
    normalized = {
        item
        for raw in values
        if (item := _identifier(raw)) is not None
        and (allowed_set is None or item in allowed_set)
    }
    return tuple(sorted(normalized))


def _normalized_angle_kinds(value: Any, *, default: Iterable[str]) -> tuple[str, ...]:
    if isinstance(value, str):
        values = (value,)
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        values = value
    else:
        values = default
    selected = {str(item).strip().upper() for item in values}
    return tuple(kind for kind in ANGLE_KINDS if kind in selected)


def _normalized_iso(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or len(raw) > 64:
        return None
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc)
        return parsed.isoformat(timespec="seconds").replace("+00:00", "Z")
    return parsed.isoformat(timespec="seconds")


@dataclass(frozen=True, order=True)
class AstrocartAspectDefinition:
    """One longitude/RA aspect family available to angle-line generation."""

    aspect_id: str
    angle_deg: float
    enabled: bool = True

    def __post_init__(self) -> None:
        aspect_id = str(self.aspect_id).strip().lower()
        if not _ASPECT_ID_RE.fullmatch(aspect_id):
            raise ValueError(f"Invalid aspect id: {self.aspect_id!r}")
        angle = float(self.angle_deg)
        if not 0.0 <= angle <= 180.0:
            raise ValueError("Aspect angle must be within 0..180 degrees")
        object.__setattr__(self, "aspect_id", aspect_id)
        object.__setattr__(self, "angle_deg", round(angle, 9))
        object.__setattr__(self, "enabled", bool(self.enabled))

    @classmethod
    def from_value(cls, value: Any) -> AstrocartAspectDefinition | None:
        if isinstance(value, cls):
            return value
        if isinstance(value, str):
            aspect_id = value.strip().lower().replace(" ", "_")
            angle = _STANDARD_ASPECT_ANGLES.get(aspect_id)
            if angle is None:
                return None
            return cls(aspect_id, angle)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            angle = float(value)
            aspect_id = next(
                (
                    name
                    for name, standard_angle in _STANDARD_ASPECT_ANGLES.items()
                    if abs(standard_angle - angle) <= 1e-9
                ),
                f"aspect_{angle:g}",
            )
            try:
                return cls(aspect_id, angle)
            except ValueError:
                return None
        if not isinstance(value, Mapping):
            return None
        aspect_id = _mapping_value(value, "id", "aspectId", "aspect_id")
        angle = _mapping_value(value, "angleDeg", "angle_deg", "angle")
        if angle is None and isinstance(aspect_id, str):
            angle = _STANDARD_ASPECT_ANGLES.get(aspect_id.strip().lower().replace(" ", "_"))
        try:
            return cls(
                str(aspect_id),
                float(angle),
                _strict_bool(value.get("enabled"), True),
            )
        except (TypeError, ValueError):
            return None

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.aspect_id,
            "labelKey": f"optmenu.{self.aspect_id}",
            "angleDeg": self.angle_deg,
            "enabled": self.enabled,
        }


def _normalized_aspects(value: Any) -> tuple[AstrocartAspectDefinition, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return ()
    definitions: dict[str, AstrocartAspectDefinition] = {}
    for raw in value:
        definition = AstrocartAspectDefinition.from_value(raw)
        if definition is None:
            continue
        if definition.aspect_id in REDUNDANT_ASPECT_TO_ANGLE_IDS:
            continue
        canonical_angle = _STANDARD_ASPECT_ANGLES.get(definition.aspect_id)
        if (
            canonical_angle is None
            or abs(definition.angle_deg - canonical_angle) > 1e-7
        ):
            # The public map catalog has one localized, canonical definition
            # per aspect ID. Reject conflicting/custom ID-angle pairs before
            # they can reach the engine as a duplicate-ID conflict.
            continue
        existing = definitions.get(definition.aspect_id)
        definitions[definition.aspect_id] = AstrocartAspectDefinition(
            definition.aspect_id,
            canonical_angle,
            definition.enabled or bool(existing and existing.enabled),
        )
    return tuple(sorted(definitions.values()))


@dataclass(frozen=True, order=True)
class AstrocartDynamicLayer:
    """One transit/progression actor layer at a canonical time cursor."""

    technique: str
    cursor_iso: str | None = None
    selected_actor_ids: tuple[str, ...] = ()
    enabled: bool = False

    def __post_init__(self) -> None:
        technique = str(self.technique).strip().lower().replace("-", "_").replace(" ", "_")
        technique = _DYNAMIC_TECHNIQUE_ALIASES.get(technique, technique)
        if technique not in DYNAMIC_TECHNIQUES:
            raise ValueError(f"Unsupported dynamic ACG technique: {self.technique!r}")
        cursor = _normalized_iso(self.cursor_iso)
        enabled = bool(self.enabled) and cursor is not None
        object.__setattr__(self, "technique", technique)
        object.__setattr__(self, "cursor_iso", cursor)
        object.__setattr__(
            self,
            "selected_actor_ids",
            _normalized_ids(self.selected_actor_ids),
        )
        object.__setattr__(self, "enabled", enabled)

    @property
    def moving_actor_ids(self) -> tuple[str, ...]:
        """Moving actors remain distinct from natal/static map selections."""
        return self.selected_actor_ids

    @classmethod
    def from_value(cls, value: Any) -> AstrocartDynamicLayer | None:
        if isinstance(value, cls):
            return value
        if not isinstance(value, Mapping):
            return None
        try:
            return cls(
                technique=str(value.get("technique") or ""),
                cursor_iso=_mapping_value(value, "cursorIso", "cursor_iso", "cursor"),
                selected_actor_ids=_mapping_value(
                    value,
                    "movingActorIds",
                    "moving_actor_ids",
                    "selectedActorIds",
                    "selected_actor_ids",
                    "actorIds",
                    default=(),
                ),
                enabled=_strict_bool(value.get("enabled"), False),
            )
        except (TypeError, ValueError):
            return None

    def to_payload(self) -> dict[str, Any]:
        return {
            "technique": self.technique,
            "labelKey": f"astrocart.dynamic.{self.technique}",
            "cursorIso": self.cursor_iso,
            "movingActorIds": list(self.selected_actor_ids),
            "enabled": self.enabled,
        }


def _normalized_dynamic_layers(value: Any) -> tuple[AstrocartDynamicLayer, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return ()
    layers = {
        layer
        for raw in value
        if (layer := AstrocartDynamicLayer.from_value(raw)) is not None
    }
    return tuple(sorted(layers))


@dataclass(frozen=True)
class AstrocartMapSpec:
    """Stable, immutable configuration for one advanced ACG map snapshot."""

    schema: str = ASTROCART_MAP_SPEC_SCHEMA
    schema_version: int = ASTROCART_MAP_SPEC_SCHEMA_VERSION
    coordinate_system: str = COORDINATE_IN_MUNDO
    selected_point_ids: tuple[str, ...] = DEFAULT_SELECTED_POINT_IDS
    selected_angle_kinds: tuple[str, ...] = ANGLE_KINDS
    paran_enabled: bool = False
    paran_participant_ids: tuple[str, ...] = DEFAULT_SELECTED_POINT_IDS
    zenith_enabled: bool = False
    aspect_definitions: tuple[AstrocartAspectDefinition, ...] = ()
    aspect_actor_ids: tuple[str, ...] = DEFAULT_SELECTED_POINT_IDS
    aspect_target_angles: tuple[str, ...] = ANGLE_KINDS
    local_space_opposition_enabled: bool = False
    dynamic_layers: tuple[AstrocartDynamicLayer, ...] = ()

    def __post_init__(self) -> None:
        coordinate_system = str(self.coordinate_system).strip().lower()
        if coordinate_system not in COORDINATE_SYSTEMS:
            coordinate_system = COORDINATE_IN_MUNDO
        object.__setattr__(self, "schema", ASTROCART_MAP_SPEC_SCHEMA)
        object.__setattr__(self, "schema_version", ASTROCART_MAP_SPEC_SCHEMA_VERSION)
        object.__setattr__(self, "coordinate_system", coordinate_system)
        object.__setattr__(
            self,
            "selected_point_ids",
            _normalized_ids(self.selected_point_ids, default=DEFAULT_SELECTED_POINT_IDS),
        )
        object.__setattr__(
            self,
            "selected_angle_kinds",
            _normalized_angle_kinds(self.selected_angle_kinds, default=ANGLE_KINDS),
        )
        object.__setattr__(self, "paran_enabled", bool(self.paran_enabled))
        object.__setattr__(
            self,
            "paran_participant_ids",
            _normalized_ids(
                self.paran_participant_ids,
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
        )
        object.__setattr__(self, "zenith_enabled", bool(self.zenith_enabled))
        object.__setattr__(
            self,
            "aspect_definitions",
            _normalized_aspects(self.aspect_definitions),
        )
        object.__setattr__(
            self,
            "aspect_actor_ids",
            _normalized_ids(
                self.aspect_actor_ids,
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
        )
        object.__setattr__(
            self,
            "aspect_target_angles",
            _normalized_angle_kinds(self.aspect_target_angles, default=ANGLE_KINDS),
        )
        object.__setattr__(
            self,
            "local_space_opposition_enabled",
            bool(self.local_space_opposition_enabled),
        )
        object.__setattr__(
            self,
            "dynamic_layers",
            _normalized_dynamic_layers(self.dynamic_layers),
        )

    @property
    def aspect_targets(self) -> tuple[str, ...]:
        """Compatibility name matching the semantic request vocabulary."""
        return self.aspect_target_angles

    @property
    def static_angle_line_point_ids(self) -> tuple[str, ...]:
        """Natal four-angle line sources, separate from aspect/dynamic actors."""
        return self.selected_point_ids

    @classmethod
    def normalize(
        cls,
        payload: Any,
        *,
        available_point_ids: Iterable[str] | None = None,
    ) -> AstrocartMapSpec:
        return cls.from_payload(payload, available_point_ids=available_point_ids)

    @classmethod
    def from_payload(
        cls,
        payload: Any,
        *,
        available_point_ids: Iterable[str] | None = None,
    ) -> AstrocartMapSpec:
        if isinstance(payload, cls):
            spec = payload
            return (
                spec.filtered_to_point_ids(available_point_ids)
                if available_point_ids is not None
                else spec
            )
        if not isinstance(payload, Mapping):
            spec = cls()
            return (
                spec.filtered_to_point_ids(available_point_ids)
                if available_point_ids is not None
                else spec
            )

        schema = payload.get("schema")
        if schema not in (None, "", ASTROCART_MAP_SPEC_SCHEMA):
            spec = cls()
            return (
                spec.filtered_to_point_ids(available_point_ids)
                if available_point_ids is not None
                else spec
            )
        version = _mapping_value(payload, "schemaVersion", "schema_version")
        if version is not None:
            try:
                if int(version) != ASTROCART_MAP_SPEC_SCHEMA_VERSION:
                    spec = cls()
                    return (
                        spec.filtered_to_point_ids(available_point_ids)
                        if available_point_ids is not None
                        else spec
                    )
            except (TypeError, ValueError):
                spec = cls()
                return (
                    spec.filtered_to_point_ids(available_point_ids)
                    if available_point_ids is not None
                    else spec
                )

        paran_payload = payload.get("paran")
        if not isinstance(paran_payload, Mapping):
            paran_payload = {}
        aspect_payload = payload.get("aspects")
        if not isinstance(aspect_payload, Mapping):
            aspect_payload = {}
        local_space_payload = _mapping_value(payload, "localSpace", "local_space", default={})
        if not isinstance(local_space_payload, Mapping):
            local_space_payload = {}

        selected_raw = _mapping_value(
            payload,
            "staticAngleLinePointIds",
            "static_angle_line_point_ids",
            "selectedPointIds",
            "selected_point_ids",
            default=DEFAULT_SELECTED_POINT_IDS,
        )
        participant_raw = _mapping_value(
            paran_payload,
            "participantIds",
            "participant_ids",
            default=_mapping_value(
                payload,
                "paranParticipantIds",
                "paran_participant_ids",
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
        )
        definitions_raw = _mapping_value(
            aspect_payload,
            "definitions",
            default=_mapping_value(
                payload,
                "aspectDefinitions",
                "aspect_definitions",
                default=(),
            ),
        )
        aspect_actor_raw = _mapping_value(
            aspect_payload,
            "actorIds",
            "sourceIds",
            default=_mapping_value(
                payload,
                "aspectActorIds",
                "aspect_actor_ids",
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
        )
        targets_raw = _mapping_value(
            aspect_payload,
            "targetAngleKinds",
            "targets",
            default=_mapping_value(
                payload,
                "aspectTargetAngles",
                "aspect_target_angles",
                default=ANGLE_KINDS,
            ),
        )
        spec = cls(
            coordinate_system=_mapping_value(
                payload,
                "coordinateSystem",
                "coordinate_system",
                default=COORDINATE_IN_MUNDO,
            ),
            selected_point_ids=_normalized_ids(
                selected_raw,
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
            selected_angle_kinds=_normalized_angle_kinds(
                _mapping_value(
                    payload,
                    "selectedAngleKinds",
                    "selected_angle_kinds",
                    default=ANGLE_KINDS,
                ),
                default=ANGLE_KINDS,
            ),
            paran_enabled=_strict_bool(
                _mapping_value(
                    paran_payload,
                    "enabled",
                    default=_mapping_value(
                        payload,
                        "paranEnabled",
                        "paran_enabled",
                        default=False,
                    ),
                ),
                False,
            ),
            paran_participant_ids=_normalized_ids(
                participant_raw,
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
            zenith_enabled=_strict_bool(
                _mapping_value(
                    payload,
                    "zenithEnabled",
                    "zenith_enabled",
                    default=False,
                ),
                False,
            ),
            aspect_definitions=_normalized_aspects(definitions_raw),
            aspect_actor_ids=_normalized_ids(
                aspect_actor_raw,
                default=DEFAULT_SELECTED_POINT_IDS,
            ),
            aspect_target_angles=_normalized_angle_kinds(
                targets_raw,
                default=ANGLE_KINDS,
            ),
            local_space_opposition_enabled=_strict_bool(
                _mapping_value(
                    local_space_payload,
                    "oppositionEnabled",
                    "opposition_enabled",
                    default=_mapping_value(
                        payload,
                        "localSpaceOppositionEnabled",
                        "local_space_opposition_enabled",
                        default=False,
                    ),
                ),
                False,
            ),
            dynamic_layers=_normalized_dynamic_layers(
                _mapping_value(
                    payload,
                    "dynamicLayers",
                    "dynamic_layers",
                    default=(),
                )
            ),
        )
        return (
            spec.filtered_to_point_ids(available_point_ids)
            if available_point_ids is not None
            else spec
        )

    @classmethod
    def default_for_catalog(cls, catalog: AstrocartPointCatalog) -> AstrocartMapSpec:
        defaults = catalog.default_selected_ids
        return cls(
            selected_point_ids=defaults,
            paran_participant_ids=defaults,
            aspect_actor_ids=defaults,
        )

    def filtered_to_point_ids(self, point_ids: Iterable[str]) -> AstrocartMapSpec:
        allowed = set(point_ids)
        return replace(
            self,
            selected_point_ids=tuple(
                point_id for point_id in self.selected_point_ids if point_id in allowed
            ),
            paran_participant_ids=tuple(
                point_id
                for point_id in self.paran_participant_ids
                if point_id in allowed
            ),
            aspect_actor_ids=tuple(
                point_id for point_id in self.aspect_actor_ids if point_id in allowed
            ),
            dynamic_layers=tuple(
                replace(
                    layer,
                    selected_actor_ids=tuple(
                        point_id
                        for point_id in layer.selected_actor_ids
                        if point_id in allowed
                    ),
                )
                for layer in self.dynamic_layers
            ),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "schemaVersion": self.schema_version,
            "coordinateSystem": self.coordinate_system,
            "staticAngleLinePointIds": list(self.selected_point_ids),
            "selectedAngleKinds": list(self.selected_angle_kinds),
            "paran": {
                "enabled": self.paran_enabled,
                "participantIds": list(self.paran_participant_ids),
            },
            "zenithEnabled": self.zenith_enabled,
            "aspects": {
                "definitions": [
                    definition.to_payload() for definition in self.aspect_definitions
                ],
                "actorIds": list(self.aspect_actor_ids),
                "targetAngleKinds": list(self.aspect_target_angles),
            },
            "localSpace": {
                "oppositionEnabled": self.local_space_opposition_enabled,
            },
            "dynamicLayers": [
                layer.to_payload() for layer in self.dynamic_layers
            ],
        }

    def canonical_json(self) -> str:
        return json.dumps(
            self.to_payload(),
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )

    def cache_key(self) -> str:
        return sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def mode_cache_key(self, mode: str) -> str:
        """Hash only the semantic inputs consumed by one line calculator."""
        normalized_mode = str(mode or "").strip().lower()
        if normalized_mode not in MODE_ORDER:
            raise ValueError(f"Unknown ACG line mode: {mode!r}")
        if normalized_mode == MODE_LOCAL_SPACE:
            payload = {
                "schemaVersion": self.schema_version,
                "mode": normalized_mode,
                "selectedPointIds": list(self.selected_point_ids),
                "oppositionEnabled": self.local_space_opposition_enabled,
            }
        else:
            payload = self.to_payload()
            payload.pop("localSpace", None)
            payload["mode"] = normalized_mode
        encoded = json.dumps(
            payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        return sha256(encoded.encode("utf-8")).hexdigest()

    def mode_cache_keys(self) -> dict[str, str]:
        return {mode: self.mode_cache_key(mode) for mode in MODE_ORDER}


@dataclass(frozen=True)
class CapabilityCell:
    role: str
    supported: bool
    reason: str | None = None
    reason_key: str | None = None

    def __post_init__(self) -> None:
        if self.role not in ALL_ROLES:
            raise ValueError(f"Unknown ACG capability role: {self.role!r}")
        if not self.supported and not str(self.reason or "").strip():
            raise ValueError("Unsupported capability cells require a reason")
        if self.supported:
            object.__setattr__(self, "reason", None)
            object.__setattr__(self, "reason_key", None)

    @property
    def status(self) -> str:
        return "supported" if self.supported else "unsupported"

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "role": self.role,
            "labelKey": f"astrocart.role.{self.role}",
            "status": self.status,
        }
        if not self.supported:
            # The English explanation is an internal capability-audit detail.
            # Served UI contracts expose a stable localization key instead.
            payload["reasonKey"] = "astrocart.capability.unsupported"
        return payload


def _family_capabilities(family: str) -> tuple[CapabilityCell, ...]:
    unsupported: dict[str, str] = {}
    if family in (FAMILY_STANDARD_BODY, FAMILY_CHIRON, FAMILY_LOGICAL_NODE):
        pass
    elif family == FAMILY_ASTEROID_CENTAUR:
        # Current supplementary builders materialize all six configured
        # asteroid/centaur rows for transits, secondary/minor/tertiary
        # progressions, and solar arc. Keep these physical bodies eligible.
        pass
    elif family == FAMILY_FIXED_STAR:
        static_reason = "static_reference"
        for role in (
            ROLE_TRANSIT_ACTOR,
            ROLE_SECONDARY_PROGRESSION_ACTOR,
            ROLE_MINOR_PROGRESSION_ACTOR,
            ROLE_TERTIARY_PROGRESSION_ACTOR,
            ROLE_SOLAR_ARC_ACTOR,
        ):
            unsupported[role] = static_reason
    elif family == FAMILY_ANGLE:
        unsupported_reason = "structural_angle"
        for role in ALL_ROLES:
            if role != ROLE_EXPORT_PARTICIPANT:
                unsupported[role] = unsupported_reason
    elif family in (
        FAMILY_FORTUNE,
        FAMILY_VERTEX,
        FAMILY_PRENATAL_SYZYGY,
        FAMILY_CONFIGURED_LOT,
    ):
        unsupported_reason = "no_dynamic_transform"
        for role in (
            ROLE_TRANSIT_ACTOR,
            ROLE_SECONDARY_PROGRESSION_ACTOR,
            ROLE_MINOR_PROGRESSION_ACTOR,
            ROLE_TERTIARY_PROGRESSION_ACTOR,
            ROLE_SOLAR_ARC_ACTOR,
        ):
            unsupported[role] = unsupported_reason
    elif family in (
        FAMILY_OUTER_MIDPOINT,
        FAMILY_OUTER_ANTISCION,
        FAMILY_OUTER_CONTRA_ANTISCION,
        FAMILY_OUTER_DODECATEMORIA,
        FAMILY_OUTER_HYBRID_HIT,
    ):
        unsupported_reason = "symbolic_outer_technique_unavailable"
        unsupported = {role: unsupported_reason for role in ALL_ROLES}
    else:
        raise ValueError(f"Unknown ACG point family: {family!r}")

    return tuple(
        CapabilityCell(
            role,
            role not in unsupported,
            unsupported.get(role),
            (
                f"astrocart.capability.unsupported.{family}.{role}"
                if role in unsupported
                else None
            ),
        )
        for role in ALL_ROLES
    )


CAPABILITY_MATRIX: Mapping[str, Mapping[str, CapabilityCell]] = MappingProxyType(
    {
        family: MappingProxyType(
            {cell.role: cell for cell in _family_capabilities(family)}
        )
        for family in ALL_POINT_FAMILIES
    }
)


def capability_matrix_payload() -> dict[str, dict[str, dict[str, Any]]]:
    return {
        family: {
            role: cell.to_payload()
            for role, cell in CAPABILITY_MATRIX[family].items()
        }
        for family in ALL_POINT_FAMILIES
    }


def _motion_reference(value: Mapping[str, Any]) -> Mapping[str, Any]:
    normalized: dict[str, Any] = {}
    for key in sorted(value):
        item = value[key]
        if item is None or isinstance(item, (str, int, float, bool)):
            normalized[str(key)] = item
    return MappingProxyType(normalized)


def _acg_point_payload(point: astrocart.ACGPoint) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": point.id,
        "label": point.label,
        "kind": point.kind,
        "antipode": bool(point.antipode),
    }
    if point.body_id is not None:
        payload["bodyId"] = int(point.body_id)
    if point.star_name is not None:
        payload["starName"] = str(point.star_name)
    if point.ecliptic is not None:
        payload["ecliptic"] = [
            float(point.ecliptic[0]),
            float(point.ecliptic[1]),
        ]
    if point.color_hex:
        payload["color"] = point.color_hex
    return payload


_POINT_LABEL_KEYS = {
    **{
        f"ephemeris-body:{body_id}": f"astrocart.point.{label.lower()}"
        for body_id, label in _STANDARD_BODIES
    },
    f"ephemeris-body:{astrology.SE_CHIRON}": "astrocart.point.chiron",
    "logical-node:north": "astrocart.point.northNode",
    "logical-node:south": "astrocart.point.southNode",
    "angle:asc": "astrocart.point.ascendant",
    "angle:dsc": "astrocart.point.descendant",
    "angle:mc": "astrocart.point.midheaven",
    "angle:ic": "astrocart.point.imumCoeli",
    "point:fortune": "astrocart.point.fortune",
    "point:vertex": "astrocart.point.vertex",
    "point:syzygy": "astrocart.point.prenatalSyzygy",
}


@dataclass(frozen=True)
class AstrocartPointRecord:
    semantic_id: str
    family: str
    label: str
    acg_point: astrocart.ACGPoint
    default_selected: bool
    motion_reference: Mapping[str, Any]
    label_key: str | None = None
    capabilities: tuple[CapabilityCell, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        semantic_id = _identifier(self.semantic_id)
        if semantic_id is None:
            raise ValueError(f"Invalid semantic ACG point id: {self.semantic_id!r}")
        if self.family not in ALL_POINT_FAMILIES:
            raise ValueError(f"Unknown ACG point family: {self.family!r}")
        if self.acg_point.id != semantic_id:
            raise ValueError("ACGPoint.id must equal the record semantic id")
        capabilities = self.capabilities or _family_capabilities(self.family)
        by_role = {cell.role: cell for cell in capabilities}
        if set(by_role) != set(ALL_ROLES):
            raise ValueError("Every point record must declare every ACG capability role")
        object.__setattr__(self, "semantic_id", semantic_id)
        object.__setattr__(self, "label", str(self.label))
        object.__setattr__(
            self,
            "label_key",
            str(self.label_key) if self.label_key else None,
        )
        object.__setattr__(self, "default_selected", bool(self.default_selected))
        object.__setattr__(
            self,
            "motion_reference",
            _motion_reference(self.motion_reference),
        )
        object.__setattr__(
            self,
            "capabilities",
            tuple(by_role[role] for role in ALL_ROLES),
        )

    @property
    def motion_ref(self) -> Mapping[str, Any]:
        return self.motion_reference

    def capability(self, role: str) -> CapabilityCell:
        for cell in self.capabilities:
            if cell.role == role:
                return cell
        raise KeyError(role)

    def to_payload(self) -> dict[str, Any]:
        payload = {
            "semanticId": self.semantic_id,
            "family": self.family,
            "label": self.label,
            "point": _acg_point_payload(self.acg_point),
            "defaultSelected": self.default_selected,
            "motionRef": dict(self.motion_reference),
            "capabilities": {
                cell.role: {
                    key: value
                    for key, value in cell.to_payload().items()
                    if key != "role"
                }
                for cell in self.capabilities
            },
        }
        if self.label_key:
            payload["labelKey"] = self.label_key
        return payload


@dataclass(frozen=True)
class FamilyAvailability:
    family: str
    supported: bool
    reason: str | None = None
    active_outer_ring: bool = False

    def __post_init__(self) -> None:
        if self.family not in ALL_POINT_FAMILIES:
            raise ValueError(f"Unknown ACG point family: {self.family!r}")
        if not self.supported and not str(self.reason or "").strip():
            raise ValueError("Unavailable ACG families require a reason")

    @property
    def status(self) -> str:
        return "supported" if self.supported else "unsupported"

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "family": self.family,
            "labelKey": f"astrocart.family.{self.family}",
            "status": self.status,
            "activeOuterRing": self.active_outer_ring,
        }
        if not self.supported:
            payload["reasonKey"] = "astrocart.family.unsupported"
        return payload


_FAMILY_SORT_INDEX = {family: index for index, family in enumerate(ALL_POINT_FAMILIES)}
_BODY_SORT_INDEX = {
    f"ephemeris-body:{body_id}": index
    for index, (body_id, _label) in enumerate(_STANDARD_BODIES)
}
_BODY_SORT_INDEX.update(
    {
        f"ephemeris-body:{astrology.SE_CHIRON}": len(_BODY_SORT_INDEX),
        "logical-node:north": len(_BODY_SORT_INDEX) + 1,
        "logical-node:south": len(_BODY_SORT_INDEX) + 2,
    }
)


def _record_sort_key(record: AstrocartPointRecord) -> tuple[int, int, str]:
    return (
        _FAMILY_SORT_INDEX[record.family],
        _BODY_SORT_INDEX.get(record.semantic_id, 10_000),
        record.semantic_id,
    )


@dataclass(frozen=True)
class AstrocartPointCatalog:
    records: tuple[AstrocartPointRecord, ...]
    family_availability: tuple[FamilyAvailability, ...]

    def __post_init__(self) -> None:
        record_by_id: dict[str, AstrocartPointRecord] = {}
        for record in sorted(self.records, key=_record_sort_key):
            record_by_id.setdefault(record.semantic_id, record)
        availability_by_family = {
            item.family: item for item in self.family_availability
        }
        for family in ALL_POINT_FAMILIES:
            if family not in availability_by_family:
                availability_by_family[family] = FamilyAvailability(
                    family,
                    False,
                    "no_canonical_source",
                )
        object.__setattr__(self, "records", tuple(record_by_id.values()))
        object.__setattr__(
            self,
            "family_availability",
            tuple(availability_by_family[family] for family in ALL_POINT_FAMILIES),
        )

    @property
    def points(self) -> tuple[AstrocartPointRecord, ...]:
        return self.records

    @property
    def point_ids(self) -> tuple[str, ...]:
        return tuple(record.semantic_id for record in self.records)

    @property
    def default_selected_ids(self) -> tuple[str, ...]:
        return tuple(
            record.semantic_id for record in self.records if record.default_selected
        )

    def by_id(self, semantic_id: str) -> AstrocartPointRecord | None:
        return next(
            (record for record in self.records if record.semantic_id == semantic_id),
            None,
        )

    def family_status(self, family: str) -> FamilyAvailability:
        return next(
            item for item in self.family_availability if item.family == family
        )

    def selected_records(
        self,
        spec: AstrocartMapSpec,
        *,
        role: str = ROLE_ANGULAR_LINE_SOURCE,
    ) -> tuple[AstrocartPointRecord, ...]:
        if role not in ALL_ROLES:
            raise ValueError(f"Unknown ACG role: {role!r}")
        selected = set(spec.selected_point_ids)
        return tuple(
            record
            for record in self.records
            if record.semantic_id in selected and record.capability(role).supported
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "points": [record.to_payload() for record in self.records],
            "families": [
                availability.to_payload()
                for availability in self.family_availability
            ],
            "capabilityMatrix": capability_matrix_payload(),
        }


def _point_record(
    semantic_id: str,
    family: str,
    label: str,
    *,
    body_id: int | None = None,
    star_name: str | None = None,
    ecliptic: tuple[float, float] | None = None,
    antipode: bool = False,
    kind: str = astrocart.KIND_CUSTOM,
    default_selected: bool = False,
    motion_reference: Mapping[str, Any],
) -> AstrocartPointRecord:
    return AstrocartPointRecord(
        semantic_id=semantic_id,
        family=family,
        label=label,
        acg_point=astrocart.ACGPoint(
            id=semantic_id,
            label=label,
            kind=kind,
            body_id=body_id,
            star_name=star_name,
            ecliptic=ecliptic,
            antipode=antipode,
        ),
        default_selected=default_selected,
        motion_reference=motion_reference,
        label_key=_POINT_LABEL_KEYS.get(semantic_id),
    )


def _tropical_ecliptic(chart_obj: Any, longitude: float) -> tuple[float, float]:
    offset = float(getattr(chart_obj, "ayanamsha_offset", 0.0) or 0.0)
    return (float(util.to_tropical_lon(float(longitude), offset)), 0.0)


def _fixed_star_labels(chart_obj: Any, options_obj: Any) -> dict[str, str]:
    configured_codes = [
        str(code)
        for code in (getattr(options_obj, "fixstars", {}) or {}).keys()
    ]
    labels: dict[str, str] = {}
    fixstars_obj = getattr(chart_obj, "fixstars", None)
    data = list(getattr(fixstars_obj, "data", ()) or ())
    mixed = list(getattr(fixstars_obj, "mixed", ()) or ())
    for index, row in enumerate(data):
        try:
            catalog_name = str(row[fixstars.FixStars.NAME] or "").strip()
            nomname = str(row[fixstars.FixStars.NOMNAME] or "").strip()
        except (IndexError, TypeError):
            continue
        code = nomname
        try:
            original_index = int(mixed[index])
            code = configured_codes[original_index]
        except (IndexError, TypeError, ValueError):
            pass
        if code and catalog_name:
            labels[code] = catalog_name

    aliases = getattr(options_obj, "fixstarAliasMap", None)
    if isinstance(aliases, Mapping):
        for code, label in aliases.items():
            if str(label).strip():
                labels[str(code)] = str(label).strip()
    return labels


def _configured_lot_records(chart_obj: Any, options_obj: Any) -> tuple[
    list[AstrocartPointRecord],
    str | None,
]:
    configured = list(getattr(options_obj, "arabicparts", ()) or ())
    active_indices: list[int] = []
    for index, item in enumerate(configured):
        try:
            if not arabicparts.ArabicParts.is_active_item(item):
                continue
        except Exception:
            continue
        active_indices.append(index)
    if not active_indices:
        return [], "no_activated_lots"

    parts_obj = getattr(chart_obj, "parts", None)
    computed = list(getattr(parts_obj, "parts", ()) or ())
    if not computed:
        return [], "lots_not_materialized"

    records: list[AstrocartPointRecord] = []
    for computed_index, config_index in enumerate(active_indices):
        if computed_index >= len(computed):
            break
        part = computed[computed_index]
        try:
            label = str(part[arabicparts.ArabicParts.NAME])
            longitude = float(part[arabicparts.ArabicParts.LONG])
        except (IndexError, TypeError, ValueError):
            continue
        semantic_id = f"configured-lot:{config_index}"
        records.append(
            _point_record(
                semantic_id,
                FAMILY_CONFIGURED_LOT,
                label,
                ecliptic=_tropical_ecliptic(chart_obj, longitude),
                kind=astrocart.KIND_LOT,
                # Canonical membership is independent of display selection,
                # but the established ACG default renders only the standard
                # bodies, logical nodes, and Chiron. Activated Lots remain
                # available as explicit opt-in sources.
                default_selected=False,
                motion_reference={
                    "kind": "arabicPart",
                    "configIndex": config_index,
                },
            )
        )
    materialization_reason = None
    if len(records) != len(active_indices):
        materialization_reason = "partial_lot_materialization"
    return records, materialization_reason


_OUTER_MODE_FAMILY = {
    1: FAMILY_FIXED_STAR,
    2: FAMILY_OUTER_ANTISCION,
    3: FAMILY_OUTER_CONTRA_ANTISCION,
    4: FAMILY_OUTER_DODECATEMORIA,
    5: FAMILY_CONFIGURED_LOT,
    6: FAMILY_ASTEROID_CENTAUR,
    7: FAMILY_OUTER_MIDPOINT,
    8: FAMILY_OUTER_HYBRID_HIT,
}


def _finite_longitude(value: Any) -> float | None:
    try:
        longitude = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(longitude):
        return None
    return util.normalize(longitude)


def _outer_body_label(body_id: int) -> str:
    label = _OUTER_BODY_LABELS.get(int(body_id))
    if label:
        return label
    try:
        return str(astrology.swe_get_planet_name(int(body_id)))
    except Exception:
        return str(int(body_id))


def _materialized_midpoints(chart_obj: Any) -> tuple[Any, ...]:
    midpoints_obj = getattr(chart_obj, "midpoints", None)
    mids = getattr(midpoints_obj, "mids", None)
    if not mids:
        calc_midpoints = getattr(chart_obj, "calcMidPoints", None)
        if callable(calc_midpoints):
            try:
                calc_midpoints()
            except Exception:
                pass
        mids = getattr(getattr(chart_obj, "midpoints", None), "mids", None)
    return tuple(mids or ())


def _materialized_antiscia(chart_obj: Any, options_obj: Any) -> Any | None:
    expected_morin = bool(getattr(options_obj, "morin_antiscia", False))
    current = getattr(chart_obj, "antiscia", None)
    if (
        current is not None
        and bool(getattr(current, "morin_antiscia", False)) == expected_morin
    ):
        return current

    calc_antiscia = getattr(chart_obj, "calcAntiscia", None)
    if callable(calc_antiscia):
        try:
            calc_antiscia()
        except Exception:
            pass
        current = getattr(chart_obj, "antiscia", None)
        if (
            current is not None
            and bool(getattr(current, "morin_antiscia", False)) == expected_morin
        ):
            return current

    try:
        return Antiscia(
            chart_obj.planets.planets,
            chart_obj.houses.ascmc,
            chart_obj.fortune.fortune,
            float(getattr(chart_obj, "obl", (0.0,))[0]),
            int(getattr(options_obj, "ayanamsha", 0) or 0),
            float(getattr(chart_obj, "ayanamsha_offset", 0.0) or 0.0),
            morin_antiscia=expected_morin,
        )
    except Exception:
        return None


def _projection_direction_name(value: Any) -> str:
    try:
        direction = int(value)
    except (TypeError, ValueError):
        direction = Antiscion.UNDIRECTED
    return {
        Antiscion.SINISTER: "sinister",
        Antiscion.DEXTER: "dexter",
    }.get(direction, "undirected")


def _projection_record(
    chart_obj: Any,
    *,
    family: str,
    projection: str,
    semantic_id: str,
    label: str,
    longitude: Any,
    source_kind: str,
    source_semantic_id: str,
    kind: str,
    body_id: int | None = None,
    branch: str | None = None,
    branch_count: int | None = None,
    branch_direction: str | None = None,
) -> AstrocartPointRecord | None:
    normalized_longitude = _finite_longitude(longitude)
    if normalized_longitude is None:
        return None
    motion_reference: dict[str, Any] = {
        "kind": "projection",
        "projection": projection,
        "sourceKind": source_kind,
        "sourceSemanticId": source_semantic_id,
    }
    if body_id is not None:
        motion_reference["bodyId"] = int(body_id)
    if branch is not None:
        motion_reference["branch"] = branch
    if branch_count is not None:
        motion_reference["branchCount"] = int(branch_count)
    if branch_direction is not None:
        motion_reference["branchDirection"] = branch_direction
    return _point_record(
        semantic_id,
        family,
        label,
        ecliptic=_tropical_ecliptic(chart_obj, normalized_longitude),
        kind=kind,
        default_selected=False,
        motion_reference=motion_reference,
    )


def _raw_midpoint_records(chart_obj: Any) -> list[AstrocartPointRecord]:
    records: list[AstrocartPointRecord] = []
    for midpoint in _materialized_midpoints(chart_obj):
        try:
            p1 = int(midpoint.p1)
            p2 = int(midpoint.p2)
        except (AttributeError, TypeError, ValueError):
            continue
        longitude = _finite_longitude(getattr(midpoint, "m", None))
        if longitude is None:
            continue
        semantic_id = f"midpoint:{p1}:{p2}"
        records.append(
            _point_record(
                semantic_id,
                FAMILY_OUTER_MIDPOINT,
                f"{_outer_body_label(p1)}/{_outer_body_label(p2)}",
                ecliptic=_tropical_ecliptic(chart_obj, longitude),
                kind=astrocart.KIND_MIDPOINT,
                default_selected=False,
                motion_reference={
                    "kind": "midpoint",
                    "p1": p1,
                    "p2": p2,
                },
            )
        )
    return records


def _raw_projection_records(
    chart_obj: Any,
    options_obj: Any,
    family: str,
) -> list[AstrocartPointRecord]:
    antiscia_obj = _materialized_antiscia(chart_obj, options_obj)
    if antiscia_obj is None:
        return []

    projection_by_family = {
        FAMILY_OUTER_ANTISCION: "antiscia",
        FAMILY_OUTER_CONTRA_ANTISCION: "contra_antiscia",
        FAMILY_OUTER_DODECATEMORIA: "dodecatemoria",
    }
    primary_attr_by_family = {
        FAMILY_OUTER_ANTISCION: "plantiscia",
        FAMILY_OUTER_CONTRA_ANTISCION: "plcontraant",
        FAMILY_OUTER_DODECATEMORIA: "pldodecatemoria",
    }
    secondary_attr_by_family = {
        FAMILY_OUTER_ANTISCION: "plantiscia_secondary",
        FAMILY_OUTER_CONTRA_ANTISCION: "plcontraant_secondary",
    }
    fortune_attr_by_family = {
        FAMILY_OUTER_ANTISCION: "lofant",
        FAMILY_OUTER_CONTRA_ANTISCION: "lofcontraant",
        FAMILY_OUTER_DODECATEMORIA: "lofdodec",
    }
    angle_attr_by_family = {
        FAMILY_OUTER_ANTISCION: "ascmcant",
        FAMILY_OUTER_CONTRA_ANTISCION: "ascmccontraant",
        FAMILY_OUTER_DODECATEMORIA: "ascmcdodec",
    }
    projection = projection_by_family[family]
    kind = (
        astrocart.KIND_ANTISCION
        if family in (FAMILY_OUTER_ANTISCION, FAMILY_OUTER_CONTRA_ANTISCION)
        else astrocart.KIND_CUSTOM
    )
    morin_planets = (
        family in (FAMILY_OUTER_ANTISCION, FAMILY_OUTER_CONTRA_ANTISCION)
        and bool(getattr(options_obj, "morin_antiscia", False))
    )

    records: list[AstrocartPointRecord] = []
    primary = tuple(getattr(antiscia_obj, primary_attr_by_family[family], ()) or ())
    secondary = tuple(
        getattr(antiscia_obj, secondary_attr_by_family.get(family, ""), ()) or ()
    )
    seen_body_ids: set[int] = set()
    for index in range(max(len(primary), len(secondary))):
        primary_point = primary[index] if index < len(primary) else None
        secondary_point = secondary[index] if index < len(secondary) else None
        point_for_id = primary_point or secondary_point
        try:
            body_id = int(point_for_id.Id)
        except (AttributeError, TypeError, ValueError):
            body_id = index
        seen_body_ids.add(body_id)
        source_semantic_id = f"ephemeris-body:{body_id}"
        label = _outer_body_label(body_id)

        if morin_planets:
            valid_branches = [
                (branch, point)
                for branch, point in (
                    ("primary", primary_point),
                    ("secondary", secondary_point),
                )
                if point is not None and bool(getattr(point, "valid", True))
            ]
            branch_count = len(valid_branches)
            morin_projection = (
                "morin_antiscia"
                if family == FAMILY_OUTER_ANTISCION
                else "morin_contra_antiscia"
            )
            for branch, point in valid_branches:
                record = _projection_record(
                    chart_obj,
                    family=family,
                    projection=morin_projection,
                    semantic_id=(
                        f"{morin_projection}:planet:{body_id}:{branch}"
                    ),
                    label=label,
                    longitude=getattr(point, "lon", None),
                    source_kind="planet",
                    source_semantic_id=source_semantic_id,
                    kind=kind,
                    body_id=body_id,
                    branch=branch,
                    branch_count=branch_count,
                    branch_direction=_projection_direction_name(
                        getattr(point, "direction", Antiscion.UNDIRECTED)
                    ),
                )
                if record is not None:
                    records.append(record)
            continue

        if primary_point is None or not bool(getattr(primary_point, "valid", True)):
            continue
        record = _projection_record(
            chart_obj,
            family=family,
            projection=projection,
            semantic_id=f"{projection}:planet:{body_id}",
            label=(
                f"{label} (12th)"
                if family == FAMILY_OUTER_DODECATEMORIA
                else label
            ),
            longitude=getattr(primary_point, "lon", None),
            source_kind="planet",
            source_semantic_id=source_semantic_id,
            kind=kind,
            body_id=body_id,
        )
        if record is not None:
            records.append(record)

    chiron = getattr(chart_obj, "chiron", None)
    chiron_data = getattr(chiron, "data", None)
    if astrology.SE_CHIRON not in seen_body_ids and chiron_data:
        try:
            chiron_longitude = float(chiron_data[planets.Planet.LONG])
            chiron_latitude = float(chiron_data[planets.Planet.LAT])
        except (IndexError, TypeError, ValueError):
            chiron_longitude = None
            chiron_latitude = 0.0
        if chiron_longitude is not None:
            source_semantic_id = f"ephemeris-body:{astrology.SE_CHIRON}"
            label = _outer_body_label(astrology.SE_CHIRON)
            if family == FAMILY_OUTER_DODECATEMORIA:
                projected = antiscia_obj.calcDodecatemoria(chiron_longitude)
                record = _projection_record(
                    chart_obj,
                    family=family,
                    projection=projection,
                    semantic_id=f"{projection}:planet:{astrology.SE_CHIRON}",
                    label=f"{label} (12th)",
                    longitude=projected,
                    source_kind="planet",
                    source_semantic_id=source_semantic_id,
                    kind=kind,
                    body_id=astrology.SE_CHIRON,
                )
                if record is not None:
                    records.append(record)
            elif morin_planets:
                branches = Antiscia.morin_projection_points(
                    chiron_longitude,
                    chiron_latitude,
                    float(getattr(chart_obj, "obl", (0.0,))[0]),
                    int(getattr(options_obj, "ayanamsha", 0) or 0),
                    float(getattr(chart_obj, "ayanamsha_offset", 0.0) or 0.0),
                    contra=family == FAMILY_OUTER_CONTRA_ANTISCION,
                )
                valid_branches = [
                    (branch, point)
                    for branch, point in branches.items()
                    if point is not None and bool(point.get("valid", True))
                ]
                morin_projection = (
                    "morin_antiscia"
                    if family == FAMILY_OUTER_ANTISCION
                    else "morin_contra_antiscia"
                )
                for branch, point in valid_branches:
                    record = _projection_record(
                        chart_obj,
                        family=family,
                        projection=morin_projection,
                        semantic_id=(
                            f"{morin_projection}:planet:"
                            f"{astrology.SE_CHIRON}:{branch}"
                        ),
                        label=label,
                        longitude=point.get("lon"),
                        source_kind="planet",
                        source_semantic_id=source_semantic_id,
                        kind=kind,
                        body_id=astrology.SE_CHIRON,
                        branch=branch,
                        branch_count=len(valid_branches),
                        branch_direction=_projection_direction_name(
                            point.get("direction")
                        ),
                    )
                    if record is not None:
                        records.append(record)
            else:
                tropical_longitude = util.to_tropical_lon(
                    chiron_longitude,
                    float(getattr(chart_obj, "ayanamsha_offset", 0.0) or 0.0),
                )
                antiscion, contra_antiscion = antiscia_obj.calc(tropical_longitude)
                projected = (
                    antiscion
                    if family == FAMILY_OUTER_ANTISCION
                    else contra_antiscion
                )
                record = _projection_record(
                    chart_obj,
                    family=family,
                    projection=projection,
                    semantic_id=f"{projection}:planet:{astrology.SE_CHIRON}",
                    label=label,
                    longitude=projected,
                    source_kind="planet",
                    source_semantic_id=source_semantic_id,
                    kind=kind,
                    body_id=astrology.SE_CHIRON,
                )
                if record is not None:
                    records.append(record)

    fortune_point = getattr(antiscia_obj, fortune_attr_by_family[family], None)
    if fortune_point is not None and bool(getattr(fortune_point, "valid", True)):
        record = _projection_record(
            chart_obj,
            family=family,
            projection=projection,
            semantic_id=":".join((projection, "fortune")),
            label="Lot of Fortune",
            longitude=getattr(fortune_point, "lon", None),
            source_kind="fortune",
            source_semantic_id="point:fortune",
            kind=kind,
        )
        if record is not None:
            records.append(record)

    angle_points = tuple(
        getattr(antiscia_obj, angle_attr_by_family[family], ()) or ()
    )
    for index, (angle_key, label) in enumerate(
        (("asc", "Ascendant"), ("mc", "Midheaven"))
    ):
        if index >= len(angle_points):
            continue
        angle_point = angle_points[index]
        if angle_point is None or not bool(getattr(angle_point, "valid", True)):
            continue
        record = _projection_record(
            chart_obj,
            family=family,
            projection=projection,
            semantic_id=f"{projection}:{angle_key}",
            label=label,
            longitude=getattr(angle_point, "lon", None),
            source_kind="angleSource",
            source_semantic_id=f"angle:{angle_key}",
            kind=kind,
        )
        if record is not None:
            records.append(record)
    return records


def _materialize_hybrid_inputs(chart_obj: Any) -> None:
    if not (getattr(getattr(chart_obj, "parts", None), "parts", None) or ()):
        calc_parts = getattr(chart_obj, "calcArabicParts", None)
        if callable(calc_parts):
            try:
                calc_parts()
            except Exception:
                pass
    if not (getattr(getattr(chart_obj, "fixstars", None), "data", None) or ()):
        rebuild_fixstars = getattr(chart_obj, "rebuildFixStars", None)
        if callable(rebuild_fixstars):
            try:
                rebuild_fixstars()
            except Exception:
                pass


def _hybrid_record(
    chart_obj: Any,
    *,
    semantic_id: str,
    source_semantic_id: str,
    label: str,
    longitude: Any,
    source_kind: str,
    **source_fields: Any,
) -> AstrocartPointRecord | None:
    normalized_longitude = _finite_longitude(longitude)
    if normalized_longitude is None:
        return None
    motion_reference = {
        "kind": "contextOuterPoint",
        "family": "hybrid_hit",
        "sourceKind": source_kind,
        "sourceSemanticId": source_semantic_id,
        **source_fields,
    }
    return _point_record(
        semantic_id,
        FAMILY_OUTER_HYBRID_HIT,
        label,
        ecliptic=_tropical_ecliptic(chart_obj, normalized_longitude),
        kind=astrocart.KIND_CUSTOM,
        default_selected=False,
        motion_reference=motion_reference,
    )


def _raw_hybrid_records(
    chart_obj: Any,
    options_obj: Any,
) -> list[AstrocartPointRecord]:
    """Return the full configured Hybrid Hits candidate pool.

    A direct conjunction is a wheel-display decision about which candidates
    receive labels. It must not decide whether the context-active semantic
    points exist in the ACG catalog.
    """

    _materialize_hybrid_inputs(chart_obj)
    records: list[AstrocartPointRecord] = []
    antiscia_obj = _materialized_antiscia(chart_obj, options_obj)
    if antiscia_obj is not None:
        for index, point in enumerate(
            tuple(getattr(antiscia_obj, "pldodecatemoria", ()) or ())
        ):
            if point is None or not bool(getattr(point, "valid", True)):
                continue
            try:
                body_id = int(point.Id)
            except (AttributeError, TypeError, ValueError):
                body_id = index
            source_semantic_id = f"dodecatemoria:planet:{body_id}"
            record = _hybrid_record(
                chart_obj,
                semantic_id=(
                    f"{_OUTER_HYBRID_SEMANTIC_PREFIX}"
                    f"dodecatemoria:planet:{body_id}"
                ),
                source_semantic_id=source_semantic_id,
                label=f"{_outer_body_label(body_id)} (12th)",
                longitude=getattr(point, "lon", None),
                source_kind="dodecatemoria",
                bodyId=body_id,
                projection="dodecatemoria",
            )
            if record is not None:
                records.append(record)

    configured_lots = list(getattr(options_obj, "arabicparts", ()) or ())
    active_lot_indices = []
    for config_index, configured_lot in enumerate(configured_lots):
        try:
            if not arabicparts.ArabicParts.is_active_item(configured_lot):
                continue
        except Exception:
            continue
        active_lot_indices.append(config_index)
    computed_lots = tuple(
        getattr(getattr(chart_obj, "parts", None), "parts", ()) or ()
    )
    for computed_index, config_index in enumerate(active_lot_indices):
        if computed_index >= len(computed_lots):
            break
        lot = computed_lots[computed_index]
        try:
            label = str(lot[arabicparts.ArabicParts.NAME])
            longitude = lot[arabicparts.ArabicParts.LONG]
        except (IndexError, TypeError):
            continue
        source_semantic_id = f"configured-lot:{config_index}"
        record = _hybrid_record(
            chart_obj,
            semantic_id=(
                f"{_OUTER_HYBRID_SEMANTIC_PREFIX}configured-lot:{config_index}"
            ),
            source_semantic_id=source_semantic_id,
            label=label,
            longitude=longitude,
            source_kind="configuredLot",
            configIndex=config_index,
        )
        if record is not None:
            records.append(record)

    configured_codes = [
        str(code)
        for code in (getattr(options_obj, "fixstars", {}) or {}).keys()
    ]
    fixstars_obj = getattr(chart_obj, "fixstars", None)
    fixed_star_rows = tuple(getattr(fixstars_obj, "data", ()) or ())
    mixed = tuple(getattr(fixstars_obj, "mixed", ()) or ())
    for index, row in enumerate(fixed_star_rows):
        try:
            label = str(row[fixstars.FixStars.NAME] or "").strip()
            code = str(row[fixstars.FixStars.NOMNAME] or "").strip()
            longitude = row[fixstars.FixStars.LON]
        except (IndexError, TypeError):
            continue
        try:
            code = code or configured_codes[int(mixed[index])]
        except (IndexError, TypeError, ValueError):
            pass
        code = _identifier(code)
        if code is None:
            continue
        source_semantic_id = f"fixed-star:{code}"
        record = _hybrid_record(
            chart_obj,
            semantic_id=f"{_OUTER_HYBRID_SEMANTIC_PREFIX}fixed-star:{code}",
            source_semantic_id=source_semantic_id,
            label=label or code,
            longitude=longitude,
            source_kind="fixedStar",
            code=code,
        )
        if record is not None:
            records.append(record)

    asteroid_rows = tuple(
        getattr(getattr(chart_obj, "asteroids", None), "asteroids", ()) or ()
    )
    for asteroid_obj in asteroid_rows:
        try:
            body_id = int(asteroid_obj.aId)
            longitude = asteroid_obj.data[planets.Planet.LONG]
        except (AttributeError, IndexError, TypeError, ValueError):
            continue
        label = str(
            getattr(asteroid_obj, "name", None)
            or astrology.swe_get_planet_name(body_id)
        )
        source_semantic_id = f"ephemeris-body:{body_id}"
        record = _hybrid_record(
            chart_obj,
            semantic_id=(
                f"{_OUTER_HYBRID_SEMANTIC_PREFIX}ephemeris-body:{body_id}"
            ),
            source_semantic_id=source_semantic_id,
            label=label,
            longitude=longitude,
            source_kind="ephemerisBody",
            bodyId=body_id,
        )
        if record is not None:
            records.append(record)
    return records


def _active_outer_family_records(
    chart_obj: Any,
    options_obj: Any,
    family: str | None,
) -> list[AstrocartPointRecord]:
    """Materialize every point supplied by the context-active outer family.

    These records enter the canonical universe before role capability
    filtering. Symbolic outer families currently remain explicitly unsupported
    by ACG techniques, but their members must still be represented so no
    context-active semantic points disappear before that decision is made.
    """

    if family not in {
        FAMILY_OUTER_MIDPOINT,
        FAMILY_OUTER_ANTISCION,
        FAMILY_OUTER_CONTRA_ANTISCION,
        FAMILY_OUTER_DODECATEMORIA,
        FAMILY_OUTER_HYBRID_HIT,
    }:
        return []

    if family == FAMILY_OUTER_MIDPOINT:
        return _raw_midpoint_records(chart_obj)
    if family == FAMILY_OUTER_HYBRID_HIT:
        return _raw_hybrid_records(chart_obj, options_obj)
    return _raw_projection_records(chart_obj, options_obj, family)


def build_point_catalog(
    chart_obj: Any,
    options_obj: Any | None = None,
) -> AstrocartPointCatalog:
    """Build the complete daemon-owned ACG point catalog for a live chart."""

    options_obj = options_obj or getattr(chart_obj, "options", None)
    records: list[AstrocartPointRecord] = []

    for body_id, label in _STANDARD_BODIES:
        semantic_id = f"ephemeris-body:{body_id}"
        records.append(
            _point_record(
                semantic_id,
                FAMILY_STANDARD_BODY,
                label,
                body_id=body_id,
                kind=astrocart.KIND_PLANET,
                default_selected=True,
                motion_reference={"kind": "ephemerisBody", "bodyId": body_id},
            )
        )

    # Chiron remains part of the existing default set, but belongs to its own
    # family so its tested solar-arc support is not conflated with the other
    # five current asteroid/centaur bodies.
    chiron_id = f"ephemeris-body:{astrology.SE_CHIRON}"
    records.append(
        _point_record(
            chiron_id,
            FAMILY_CHIRON,
            "Chiron",
            body_id=astrology.SE_CHIRON,
            kind=astrocart.KIND_PLANET,
            default_selected=True,
            motion_reference={
                "kind": "ephemerisBody",
                "bodyId": astrology.SE_CHIRON,
            },
        )
    )

    node_body_id = (
        astrology.SE_MEAN_NODE
        if bool(getattr(options_obj, "meannode", False))
        else astrology.SE_TRUE_NODE
    )
    records.extend(
        (
            _point_record(
                "logical-node:north",
                FAMILY_LOGICAL_NODE,
                "N. Node",
                body_id=node_body_id,
                kind=astrocart.KIND_NODE,
                default_selected=True,
                motion_reference={
                    "kind": "logicalNode",
                    "bodyId": node_body_id,
                    "axis": "north",
                },
            ),
            _point_record(
                "logical-node:south",
                FAMILY_LOGICAL_NODE,
                "S. Node",
                body_id=node_body_id,
                antipode=True,
                kind=astrocart.KIND_NODE,
                default_selected=True,
                motion_reference={
                    "kind": "logicalNode",
                    "bodyId": node_body_id,
                    "axis": "south",
                },
            ),
        )
    )

    asteroid_container = getattr(chart_obj, "asteroids", None)
    asteroid_rows = list(getattr(asteroid_container, "asteroids", ()) or ())
    seen_asteroid_ids = {astrology.SE_CHIRON}
    for asteroid_obj in asteroid_rows:
        try:
            body_id = int(asteroid_obj.aId)
        except (AttributeError, TypeError, ValueError):
            continue
        if body_id in seen_asteroid_ids:
            continue
        seen_asteroid_ids.add(body_id)
        label = str(
            getattr(asteroid_obj, "name", None)
            or astrology.swe_get_planet_name(body_id)
        )
        records.append(
            _point_record(
                f"ephemeris-body:{body_id}",
                FAMILY_ASTEROID_CENTAUR,
                label,
                body_id=body_id,
                kind=astrocart.KIND_PLANET,
                default_selected=False,
                motion_reference={"kind": "ephemerisBody", "bodyId": body_id},
            )
        )

    configured_fixstars = getattr(options_obj, "fixstars", {}) or {}
    fixed_labels = _fixed_star_labels(chart_obj, options_obj)
    if isinstance(configured_fixstars, Mapping):
        for raw_code in configured_fixstars.keys():
            code = _identifier(str(raw_code))
            if code is None:
                continue
            label = fixed_labels.get(code) or _KNOWN_FIXED_STAR_LABELS.get(code) or code
            records.append(
                _point_record(
                    f"fixed-star:{code}",
                    FAMILY_FIXED_STAR,
                    label,
                    # Leading comma selects the configured nomenclature code in
                    # Swiss Ephemeris instead of doing an ambiguous name lookup.
                    star_name=f",{code}",
                    kind=astrocart.KIND_STAR,
                    default_selected=False,
                    motion_reference={"kind": "fixedStar", "code": code},
                )
            )

    houses_obj = getattr(chart_obj, "houses", None)
    ascmc = getattr(houses_obj, "ascmc", None)
    if ascmc is not None:
        try:
            asc = float(ascmc[houses.Houses.ASC])
            mc = float(ascmc[houses.Houses.MC])
            angle_values = (
                ("angle:asc", "Ascendant", "ASC", asc),
                ("angle:dsc", "Descendant", "DSC", util.normalize(asc + 180.0)),
                ("angle:mc", "Midheaven", "MC", mc),
                ("angle:ic", "Imum Coeli", "IC", util.normalize(mc + 180.0)),
            )
            for semantic_id, label, angle, longitude in angle_values:
                records.append(
                    _point_record(
                        semantic_id,
                        FAMILY_ANGLE,
                        label,
                        ecliptic=_tropical_ecliptic(chart_obj, longitude),
                        default_selected=False,
                        motion_reference={"kind": "angleSource", "angle": angle},
                    )
                )
        except (IndexError, TypeError, ValueError):
            pass

    fortune_obj = getattr(chart_obj, "fortune", None)
    try:
        fortune_lon = float(fortune_obj.fortune[fortune.Fortune.LON])
    except (AttributeError, IndexError, TypeError, ValueError):
        fortune_lon = None
    if fortune_lon is not None:
        records.append(
            _point_record(
                "point:fortune",
                FAMILY_FORTUNE,
                "Lot of Fortune",
                ecliptic=_tropical_ecliptic(chart_obj, fortune_lon),
                kind=astrocart.KIND_LOT,
                default_selected=False,
                motion_reference={"kind": "fortune"},
            )
        )

    try:
        vertex_lon = float(ascmc[houses.Houses.VERTEX])
    except (IndexError, TypeError, ValueError):
        vertex_lon = None
    if vertex_lon is not None:
        records.append(
            _point_record(
                "point:vertex",
                FAMILY_VERTEX,
                "Vertex",
                ecliptic=_tropical_ecliptic(chart_obj, vertex_lon),
                default_selected=False,
                motion_reference={"kind": "angleSource", "angle": "vertex"},
            )
        )

    syzygy_obj = getattr(chart_obj, "syzygy", None)
    try:
        syzygy_lon = float(syzygy_obj.lon)
    except (AttributeError, TypeError, ValueError):
        syzygy_lon = None
    if syzygy_lon is not None:
        records.append(
            _point_record(
                "point:syzygy",
                FAMILY_PRENATAL_SYZYGY,
                "Prenatal Syzygy",
                ecliptic=_tropical_ecliptic(chart_obj, syzygy_lon),
                default_selected=False,
                motion_reference={"kind": "syzygy"},
            )
        )

    lot_records, lot_reason = _configured_lot_records(chart_obj, options_obj)
    records.extend(lot_records)

    try:
        active_outer_family = _OUTER_MODE_FAMILY.get(
            int(getattr(options_obj, "showfixstars", 0) or 0)
        )
    except (TypeError, ValueError):
        active_outer_family = None
    records.extend(
        _active_outer_family_records(
            chart_obj,
            options_obj,
            active_outer_family,
        )
    )
    record_families = {record.family for record in records}

    unavailable_reason = {
        FAMILY_STANDARD_BODY: "no_standard_bodies",
        FAMILY_CHIRON: "no_chiron",
        FAMILY_LOGICAL_NODE: "no_logical_nodes",
        FAMILY_ASTEROID_CENTAUR: "no_asteroid_rows",
        FAMILY_FIXED_STAR: "no_configured_fixed_stars",
        FAMILY_ANGLE: "no_angle_geometry",
        FAMILY_FORTUNE: "no_fortune",
        FAMILY_VERTEX: "no_vertex",
        FAMILY_PRENATAL_SYZYGY: "no_prenatal_syzygy",
        FAMILY_CONFIGURED_LOT: lot_reason or "no_activated_lots",
        FAMILY_OUTER_MIDPOINT: "no_midpoint_resolver",
        FAMILY_OUTER_ANTISCION: "no_antiscion_resolver",
        FAMILY_OUTER_CONTRA_ANTISCION: "no_contra_antiscion_resolver",
        FAMILY_OUTER_DODECATEMORIA: "no_dodecatemoria_resolver",
        FAMILY_OUTER_HYBRID_HIT: "no_hybrid_hit_resolver",
    }
    availability = tuple(
        FamilyAvailability(
            family=family,
            supported=family in record_families,
            reason=None if family in record_families else unavailable_reason[family],
            active_outer_ring=family == active_outer_family,
        )
        for family in ALL_POINT_FAMILIES
    )
    return AstrocartPointCatalog(tuple(records), availability)


def normalize_spec_for_catalog(
    payload_or_spec: Any,
    catalog: AstrocartPointCatalog,
) -> AstrocartMapSpec:
    """Normalize selections and dynamic actors against canonical capabilities."""

    spec = AstrocartMapSpec.from_payload(
        payload_or_spec,
        available_point_ids=catalog.point_ids,
    )
    record_by_id = {record.semantic_id: record for record in catalog.records}
    layers: list[AstrocartDynamicLayer] = []
    for layer in spec.dynamic_layers:
        role = _TECHNIQUE_ROLE[layer.technique]
        actor_ids = tuple(
            point_id
            for point_id in layer.selected_actor_ids
            if point_id in record_by_id
            and record_by_id[point_id].capability(role).supported
        )
        layers.append(replace(layer, selected_actor_ids=actor_ids))
    return replace(
        spec,
        paran_participant_ids=tuple(
            point_id
            for point_id in spec.paran_participant_ids
            if record_by_id[point_id].capability(ROLE_PARAN_PARTICIPANT).supported
        ),
        aspect_actor_ids=tuple(
            point_id
            for point_id in spec.aspect_actor_ids
            if record_by_id[point_id]
            .capability(ROLE_ASPECT_TO_ANGLE_SOURCE)
            .supported
        ),
        dynamic_layers=tuple(layers),
    )


def enroll_newly_activated_paran_participants(
    spec: AstrocartMapSpec,
    previous_spec: AstrocartMapSpec,
    catalog: AstrocartPointCatalog,
) -> AstrocartMapSpec:
    """Make newly activated angular-line points participate in parans.

    A point remains independently removable from the paran selector while it
    stays active. Removing and later reactivating its ordinary lines enrolls it
    again. Capability filtering keeps structural or otherwise ineligible point
    families out of the paran calculation.
    """

    newly_activated = (
        set(spec.selected_point_ids) - set(previous_spec.selected_point_ids)
    )
    if not newly_activated:
        return spec
    supported = {
        record.semantic_id
        for record in catalog.records
        if record.semantic_id in newly_activated
        and record.capability(ROLE_PARAN_PARTICIPANT).supported
    }
    if not supported:
        return spec
    return replace(
        spec,
        paran_participant_ids=(
            *spec.paran_participant_ids,
            *sorted(supported),
        ),
    )


def selected_acg_points(
    spec: AstrocartMapSpec,
    catalog: AstrocartPointCatalog,
    *,
    role: str = ROLE_ANGULAR_LINE_SOURCE,
) -> tuple[astrocart.ACGPoint, ...]:
    """Return only canonical, role-supported point sources selected by the spec."""

    return tuple(
        record.acg_point
        for record in catalog.selected_records(spec, role=role)
    )
