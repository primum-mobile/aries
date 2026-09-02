# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Semantic geometry profiles for corpus rule evaluation.

The chart engine computes positions once.  Corpus rules then choose how those
positions are interpreted: in the selected quadrant houses or whole-sign
places, by degree aspects or sign configurations, whether an axial reference
means a degree or an angular whole-sign place, and with configured or
source-authored orbs.  Keeping those choices in a small typed layer prevents
a word such as ``angle`` or ``tenth`` from silently changing meaning.
"""

from __future__ import annotations

from collections.abc import Mapping
import json
import math
import os
from pathlib import Path
import re
import tempfile
from types import MappingProxyType


ENGINE_DEFAULT = {
    "house_frame": "active",
    "aspect_frame": "degree",
    "point_frame": "degree",
    "orb_policy": "configured",
    "point_orb_policy": "configured",
    "dignity_frame": "active",
    "solar_condition_profile": "active",
}

# Canonical schema accepted by both the authoring validator and the runtime
# transactional reload boundary.  Keep aliases here, beside resolution, so a
# pack cannot pass one boundary and acquire a different meaning at another.
HOUSE_FRAMES = frozenset({
    "active", "selected", "active_house", "whole_sign",
    "whole_sign_place", "source_whole_sign", "regiomontanus_5deg",
    "lilly_regiomontanus", "source_regiomontanus", "profile", "inherit",
})
ASPECT_FRAMES = frozenset({
    "degree", "zodiacal_degree", "sign", "whole_sign",
    "sign_configuration", "profile", "inherit",
})
POINT_FRAMES = frozenset({
    "degree", "zodiacal_degree", "axial_degree", "sign", "whole_sign",
    "sign_configuration", "unresolved", "profile", "inherit",
})
ORB_POLICIES = frozenset({
    "chart", "chart_aspect", "configured", "fixed", "rule",
    "source_fixed", "lilly", "lilly_moiety", "source_moiety",
    "unresolved", "profile", "inherit",
})
POINT_ORB_POLICIES = ORB_POLICIES | frozenset({"exact"})
DIGNITY_FRAMES = frozenset({
    "active", "configured", "user", "hellenistic", "dorothean",
    "source_hellenistic", "lilly", "source_lilly", "profile", "inherit",
})
SOLAR_CONDITION_PROFILES = frozenset({
    "active", "current", "late_hellenistic", "al_qabisi", "ibn_ezra",
    "lilly_1647", "morin_1661", "unresolved", "profile", "inherit",
})

_PROFILES = MappingProxyType({
    # Empty by design: the pack's declared source semantics remain sovereign.
    "source-native": MappingProxyType({"id": "source-native"}),
    "quadrant": MappingProxyType({
        "id": "quadrant",
        "house_frame": "active",
        "aspect_frame": "degree",
        "point_frame": "degree",
        "orb_policy": "configured",
        "point_orb_policy": "configured",
        "dignity_frame": "active",
        "solar_condition_profile": "active",
    }),
    "hellenistic": MappingProxyType({
        "id": "hellenistic",
        "house_frame": "whole_sign",
        "aspect_frame": "sign",
        "point_frame": "sign",
        "orb_policy": "unresolved",
        "point_orb_policy": "unresolved",
        "dignity_frame": "hellenistic",
        "solar_condition_profile": "late_hellenistic",
    }),
})

SEMANTIC_FIELDS = (
    "house_frame", "aspect_frame", "point_frame", "orb_policy",
    "point_orb_policy", "dignity_frame",
    "solar_condition_profile",
)
SEMANTIC_ALLOWED_VALUES = {
    "house_frame": HOUSE_FRAMES,
    "aspect_frame": ASPECT_FRAMES,
    "point_frame": POINT_FRAMES,
    "orb_policy": ORB_POLICIES,
    "point_orb_policy": POINT_ORB_POLICIES,
    "dignity_frame": DIGNITY_FRAMES,
    "solar_condition_profile": SOLAR_CONDITION_PROFILES,
}
STATE_FILENAME = "corpus_semantics.json"
DEFAULT_PROFILE_ID = "quadrant"

_INHERITED_VALUES = {"", "profile", "inherit"}
_CUSTOM_PROFILE_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_DOCTRINE_PREFERENCE_KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_DOCTRINE_PREFERENCE_VALUE_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$",
)
_CUSTOM_PROFILE_NAME_MAX = 80
_FIXED_ORB_POLICIES = frozenset({"fixed", "rule", "source_fixed"})


def _concrete_semantic(value) -> bool:
    """Whether *value* actually selects a semantic doctrine.

    ``profile`` and ``inherit`` are author-facing delegation markers.  They
    must never erase a concrete value supplied by a lower-precedence layer.
    """
    if value is None:
        return False
    return str(value).strip().lower() not in _INHERITED_VALUES


def _merge_layer(resolved: dict, layer) -> None:
    """Merge one default/rule layer without materialising inherit markers."""
    for key, value in dict(layer or {}).items():
        if key in SEMANTIC_FIELDS:
            if _concrete_semantic(value):
                resolved[key] = value
        else:
            resolved[key] = value


def profile(profile_id: str) -> dict:
    """Return a copy of a built-in profile, rejecting unknown identifiers."""
    key = str(profile_id or "").strip().lower()
    try:
        return dict(_PROFILES[key])
    except KeyError as exc:
        raise ValueError(f"unknown semantic profile: {profile_id}") from exc


def profile_ids() -> tuple[str, ...]:
    return tuple(_PROFILES)


def custom_profile(profile_id: str, semantics, name=None) -> dict:
    """Return one validated partial user profile.

    Custom profiles are overrides, never replacements for built-ins or pack
    source defaults.  Omitted dimensions continue to resolve from the pack;
    concrete selected dimensions reinterpret authored geometry.  Literal
    ``source_fixed`` numeric thresholds remain intrinsic until a distinct
    source-threshold override contract exists.  Delegation markers are
    represented by omission and therefore rejected as stored values.
    """
    key = str(profile_id or "").strip().lower()
    if not _CUSTOM_PROFILE_ID_RE.fullmatch(key):
        raise ValueError(
            "custom semantic profile id must be a lowercase slug",
        )
    if key in _PROFILES:
        raise ValueError(f'built-in semantic profile "{key}" is immutable')
    if not isinstance(semantics, Mapping) or not semantics:
        raise ValueError("custom semantic profile requires semantic fields")
    unknown = sorted(set(semantics) - set(SEMANTIC_FIELDS))
    if unknown:
        raise ValueError(
            f"unknown custom semantic profile field(s): {unknown}",
        )
    selected = {"id": key}
    if name is not None:
        label = str(name).strip()
        if (not label or len(label) > _CUSTOM_PROFILE_NAME_MAX or
                any(ord(character) < 32 for character in label)):
            raise ValueError("custom semantic profile name is invalid")
        selected["name"] = label
    for field, value in semantics.items():
        if (not isinstance(value, str) or
                value not in SEMANTIC_ALLOWED_VALUES[field]):
            raise ValueError(
                f'unsupported {field} "{value}" in custom semantic profile',
            )
        if not _concrete_semantic(value):
            raise ValueError(
                f'custom semantic profile must omit delegated {field}',
            )
        selected[field] = value
    return selected


def select_profile(candidate) -> dict:
    """Validate a built-in id or a concrete custom-profile mapping."""
    if isinstance(candidate, str):
        return profile(candidate)
    if not isinstance(candidate, Mapping):
        raise ValueError("semantic profile must be an id or mapping")
    profile_id = str(candidate.get("id") or "").strip().lower()
    if profile_id in _PROFILES:
        canonical = profile(profile_id)
        supplied = {
            field: candidate[field]
            for field in SEMANTIC_FIELDS if field in candidate
        }
        expected = {
            field: canonical[field]
            for field in SEMANTIC_FIELDS if field in canonical
        }
        if supplied != expected:
            raise ValueError(
                f'built-in semantic profile "{profile_id}" is immutable',
            )
        return canonical
    semantics = {
        field: candidate[field]
        for field in SEMANTIC_FIELDS if field in candidate
    }
    unknown = sorted(
        set(candidate) - ({"id", "name"} | set(SEMANTIC_FIELDS)),
    )
    if unknown:
        raise ValueError(f"unknown semantic profile field(s): {unknown}")
    return custom_profile(profile_id, semantics, candidate.get("name"))


def resolve(rule_args, user_profile, pack_default, engine_default=None) -> dict:
    """Resolve one rule's effective arguments field by field.

    Precedence for semantic fields is concrete user profile > explicit rule
    source value > pack source default > engine default. ``source-native``
    intentionally contributes no overrides, so it reproduces the authored
    rule and pack doctrine. A concrete built-in or custom profile is an
    intentional comparative lens and must therefore be able to reinterpret
    even an explicitly authored house/aspect/point/dignity frame. A rule or
    pack's ``source_fixed`` orb policy identifies a literal numeric threshold,
    not a default orb cosmology, and therefore survives comparative profiles.
    Non-semantic predicate arguments always remain authored rule data.
    """
    resolved = {}
    _merge_layer(
        resolved,
        ENGINE_DEFAULT if engine_default is None else engine_default,
    )
    _merge_layer(resolved, pack_default)
    _merge_layer(resolved, rule_args)
    intrinsic_source_thresholds = {
        field for field in ("orb_policy", "point_orb_policy")
        if str(resolved.get(field) or "").strip().lower() == "source_fixed"
    }
    if user_profile:
        selected = select_profile(user_profile)
        for field in SEMANTIC_FIELDS:
            if (field not in intrinsic_source_thresholds
                    and field in selected
                    and _concrete_semantic(selected[field])):
                resolved[field] = selected[field]
    # A fixed policy is a claim that an authored number exists.  Function
    # signature defaults are implementation conveniences, not source data;
    # materialise ``None`` so degree evaluators fail closed when neither the
    # rule nor an inherited authored layer supplied a finite threshold.
    fixed_selected = any(
        str(resolved.get(field) or "").strip().lower()
        in _FIXED_ORB_POLICIES
        for field in ("orb_policy", "point_orb_policy")
    )
    orb = resolved.get("orb")
    authored_orb = (
        isinstance(orb, (int, float))
        and not isinstance(orb, bool)
        and math.isfinite(float(orb))
    )
    if fixed_selected and not authored_orb:
        resolved["orb"] = None
    resolved.pop("id", None)
    return resolved


def resolve_predicate_args(
        rule_args, user_profile, pack_default, engine_default=None) -> dict:
    """Resolve one predicate tree, including every compound condition.

    Nested predicate specs inherit the already-resolved outer doctrine when
    they delegate a field, but a concrete user lens remains highest
    precedence at every depth. This prevents an explicit source value buried
    inside ``all_of``/``any_of`` from silently defeating the profile selector.
    """
    resolved = resolve(
        rule_args, user_profile, pack_default, engine_default,
    )
    conditions = resolved.get("conditions")
    if not isinstance(conditions, list):
        return resolved
    inherited = {
        field: resolved[field]
        for field in SEMANTIC_FIELDS if field in resolved
    }
    normalized = []
    for raw in conditions:
        if not isinstance(raw, Mapping):
            normalized.append(raw)
            continue
        spec = dict(raw)
        spec["args"] = resolve_predicate_args(
            spec.get("args") or {}, user_profile, inherited,
            engine_default,
        )
        normalized.append(spec)
    resolved["conditions"] = normalized
    return resolved


class SemanticProfileStore:
    """Validated, atomic persistence for built-in/custom profile selection."""

    def __init__(self, options_directory):
        self.path = Path(options_directory) / STATE_FILENAME

    @staticmethod
    def _serialized_custom_profile(selected: dict) -> dict:
        payload = {
            "semantics": {
                field: selected[field]
                for field in SEMANTIC_FIELDS if field in selected
            },
        }
        if selected.get("name"):
            payload["name"] = selected["name"]
        return payload

    def _read_state(self) -> tuple[str, dict[str, dict], dict[str, str]]:
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            if not isinstance(data, dict):
                return DEFAULT_PROFILE_ID, {}, {}
        except (OSError, TypeError, ValueError):
            return DEFAULT_PROFILE_ID, {}, {}

        custom = {}
        raw_custom = data.get("custom_profiles") or {}
        if isinstance(raw_custom, dict):
            for profile_id, definition in raw_custom.items():
                if not isinstance(definition, dict):
                    continue
                try:
                    selected = custom_profile(
                        profile_id,
                        definition.get("semantics"),
                        definition.get("name"),
                    )
                except (TypeError, ValueError):
                    continue
                custom[selected["id"]] = selected

        active_id = str(
            data.get("active_profile_id") or DEFAULT_PROFILE_ID,
        ).strip().lower()
        if active_id not in _PROFILES and active_id not in custom:
            active_id = DEFAULT_PROFILE_ID
        preferences = {}
        raw_preferences = data.get("doctrine_preferences") or {}
        if isinstance(raw_preferences, dict):
            for raw_key, raw_value in raw_preferences.items():
                if (isinstance(raw_key, str)
                        and _DOCTRINE_PREFERENCE_KEY_RE.fullmatch(raw_key)
                        and isinstance(raw_value, str)
                        and _DOCTRINE_PREFERENCE_VALUE_RE.fullmatch(raw_value)):
                    preferences[raw_key] = raw_value
        return active_id, custom, preferences

    def _write_state(
            self, active_id: str, custom: dict[str, dict],
            preferences: dict[str, str]) -> None:
        payload = {"active_profile_id": active_id}
        if custom:
            payload["custom_profiles"] = {
                profile_id: self._serialized_custom_profile(custom[profile_id])
                for profile_id in sorted(custom)
            }
        if preferences:
            payload["doctrine_preferences"] = {
                key: preferences[key] for key in sorted(preferences)
            }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(
            prefix=f".{self.path.name}.", dir=str(self.path.parent), text=True,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    def profile(self, profile_id: str) -> dict:
        key = str(profile_id or "").strip().lower()
        if key in _PROFILES:
            return profile(key)
        _active_id, custom, _preferences = self._read_state()
        try:
            return dict(custom[key])
        except KeyError as exc:
            raise ValueError(f"unknown semantic profile: {profile_id}") from exc

    def profiles(self) -> tuple[dict, ...]:
        _active_id, custom, _preferences = self._read_state()
        return tuple(
            [profile(profile_id) for profile_id in profile_ids()] +
            [dict(custom[profile_id]) for profile_id in sorted(custom)]
        )

    def active_profile(self) -> dict:
        active_id, custom, _preferences = self._read_state()
        if active_id in _PROFILES:
            return profile(active_id)
        return dict(custom[active_id])

    def activate(self, profile_id: str) -> dict:
        _active_id, custom, preferences = self._read_state()
        key = str(profile_id or "").strip().lower()
        if key in _PROFILES:
            selected = profile(key)
        elif key in custom:
            selected = dict(custom[key])
        else:
            raise ValueError(f"unknown semantic profile: {profile_id}")
        self._write_state(selected["id"], custom, preferences)
        return selected

    def upsert_custom_profile(
            self, profile_id: str, semantics, name=None,
            activate: bool = False) -> dict:
        selected = custom_profile(profile_id, semantics, name)
        active_id, custom, preferences = self._read_state()
        custom[selected["id"]] = selected
        if activate:
            active_id = selected["id"]
        self._write_state(active_id, custom, preferences)
        return dict(selected)

    def delete_custom_profile(self, profile_id: str) -> dict:
        key = str(profile_id or "").strip().lower()
        if key in _PROFILES:
            raise ValueError(f'built-in semantic profile "{key}" is immutable')
        active_id, custom, preferences = self._read_state()
        if key not in custom:
            raise ValueError(f"unknown semantic profile: {profile_id}")
        del custom[key]
        if active_id == key:
            active_id = DEFAULT_PROFILE_ID
        self._write_state(active_id, custom, preferences)
        if active_id in _PROFILES:
            return profile(active_id)
        return dict(custom[active_id])

    def doctrine_preferences(self) -> dict[str, str]:
        """Return sparse explicit global doctrine overrides.

        Missing keys deliberately remain missing: each source theme then uses
        its own authored default instead of a materialized application-wide
        value.
        """
        _active_id, _custom, preferences = self._read_state()
        return dict(preferences)

    def patch_doctrine_preferences(self, updates) -> dict[str, str]:
        """Atomically update/delete sparse doctrine overrides.

        Semantic validity against installed option catalogs is owned by the
        daemon service.  This persistence boundary still rejects malformed
        keys and values so direct callers cannot corrupt shared state.
        """
        if not isinstance(updates, Mapping):
            raise ValueError("doctrine preference updates must be a mapping")
        active_id, custom, preferences = self._read_state()
        candidate = dict(preferences)
        for raw_key, raw_value in updates.items():
            if (not isinstance(raw_key, str)
                    or not _DOCTRINE_PREFERENCE_KEY_RE.fullmatch(raw_key)):
                raise ValueError("invalid doctrine preference key")
            if raw_value is None:
                candidate.pop(raw_key, None)
                continue
            if (not isinstance(raw_value, str)
                    or not _DOCTRINE_PREFERENCE_VALUE_RE.fullmatch(raw_value)):
                raise ValueError(
                    f'invalid doctrine preference value for "{raw_key}"',
                )
            candidate[raw_key] = raw_value
        self._write_state(active_id, custom, candidate)
        return dict(candidate)
