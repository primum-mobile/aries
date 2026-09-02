# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Versioned, daemon-owned style profile persistence and validation.

Profiles are portable design data, not raw CSS.  They use stable semantic token
ids and typed values; the generated catalog is the only bridge to concrete CSS
custom properties.  This keeps localStorage, React, and imported files from
becoming parallel settings authorities.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import threading
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from webapp.daemon.file_transaction import exclusive_file_transaction

from webapp.daemon.style_profile_catalog_generated import (
    LEGACY_STYLE_TOKEN_IDS,
    STYLE_PROFILE_RELATIONS,
    STYLE_PROFILE_TOKENS,
    TOKEN_SCHEMA_VERSION,
)
from webapp.daemon.app_style_authoring_service import (
    validate_app_authoring_overrides,
)
from webapp.daemon.style_authoring_service import (
    build_chart_style_profile_v2,
    flatten_chart_style_profile_v2,
    validate_authoring_overrides,
    validate_chart_style_profile_v2,
)


PROFILE_KIND = "aries.style-profile"
PORTABLE_CHART_STYLE_KIND = "aries.chart-style-profile"
PROFILE_SCHEMA_VERSION = 1
STORE_KIND = "aries.style-profile-store"
STORE_SCHEMA_VERSION = 1
STYLE_PROFILE_FILENAME = "style-profiles.json"

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_FONT_RE = re.compile(r"^[A-Za-z0-9 '\",._-]+$")
_VAR_RE = re.compile(r"^var\((--[a-z0-9-]+)\)$")


class StyleProfileError(ValueError):
    """A profile or store payload failed validation."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _content_hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()[:16]


def _profile_scope_for_token(token: Mapping[str, Any]) -> str:
    scope = str(token.get("scope") or "")
    if scope in ("chart", "renderer"):
        return "chart"
    if scope == "both":
        return "combined"
    return "app"


_ALIAS_RE = re.compile(r"^\{([A-Za-z0-9][A-Za-z0-9_.-]*)\}$")


def color_alias_target(value: Any) -> Optional[str]:
    """The token a colour follows, or None when the value is a literal.

    A colour override may name another colour token instead of carrying one, in
    the design-token standard's brace form. That is how the editor records "this
    is the planet-glyph colour" rather than "this happens to equal it today", so
    changing the followed token moves everything that follows it.
    """
    if not isinstance(value, str):
        return None
    match = _ALIAS_RE.match(value.strip())
    return match.group(1) if match else None


def _validate_color(value: Any, token: Mapping[str, Any], semantic_id: str) -> Any:
    alias = color_alias_target(value)
    if alias is not None:
        if alias == semantic_id:
            raise StyleProfileError(f"{semantic_id} cannot follow itself")
        target = STYLE_PROFILE_TOKENS.get(alias)
        if target is None:
            raise StyleProfileError(f"{semantic_id} follows unknown style token: {alias}")
        if target.get("type") != "color":
            raise StyleProfileError(f"{semantic_id} may only follow a color token")
        return f"{{{alias}}}"
    if not isinstance(value, (list, tuple)) or len(value) not in (3, 4):
        raise StyleProfileError(f"{semantic_id} must be an RGB or RGBA array")
    rgb = []
    for channel in value[:3]:
        if isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel <= 255:
            raise StyleProfileError(f"{semantic_id} RGB channels must be integers from 0 to 255")
        rgb.append(channel)
    if len(value) == 4:
        alpha = value[3]
        if isinstance(alpha, bool) or not isinstance(alpha, (int, float)):
            raise StyleProfileError(f"{semantic_id} alpha must be a number from 0 to 1")
        alpha = float(alpha)
        if not math.isfinite(alpha) or not 0 <= alpha <= 1:
            raise StyleProfileError(f"{semantic_id} alpha must be a number from 0 to 1")
        rgb.append(alpha)
    return rgb


def _validate_number(value: Any, token: Mapping[str, Any], semantic_id: str) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StyleProfileError(f"{semantic_id} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise StyleProfileError(f"{semantic_id} must be finite")
    bounds = token.get("bounds")
    if isinstance(bounds, Mapping):
        minimum = float(bounds.get("min", -math.inf))
        maximum = float(bounds.get("max", math.inf))
        if number < minimum or number > maximum:
            raise StyleProfileError(f"{semantic_id} must be between {minimum:g} and {maximum:g}")
        # ``step`` is an editor/display hint, not a semantic restriction.
        # Imported profiles may use any finite value inside the reviewed safety
        # range (several exact renderer defaults are repeating fractions).
    return int(number) if number.is_integer() else number


def _validate_font_family(value: Any, semantic_id: str) -> str:
    if not isinstance(value, str):
        raise StyleProfileError(f"{semantic_id} must be a font-family string")
    value = value.strip()
    if not value or len(value) > 160 or not _FONT_RE.fullmatch(value):
        raise StyleProfileError(f"{semantic_id} contains an invalid font-family value")
    return value


def _validate_token_value(semantic_id: str, value: Any) -> Any:
    token = STYLE_PROFILE_TOKENS.get(semantic_id)
    if token is None:
        raise StyleProfileError(f"unknown or non-editable style token: {semantic_id}")
    kind = token.get("type")
    if kind == "color":
        return _validate_color(value, token, semantic_id)
    if kind == "number":
        return _validate_number(value, token, semantic_id)
    if kind == "font-family":
        return _validate_font_family(value, semantic_id)
    raise StyleProfileError(f"unsupported style token type for {semantic_id}: {kind}")


def _validate_scope(scope: str, overrides: Mapping[str, Any]) -> None:
    if scope not in ("app", "chart", "combined"):
        raise StyleProfileError("profile scope must be app, chart, or combined")
    if scope == "combined":
        return
    wrong = [
        semantic_id
        for semantic_id in overrides
        if _profile_scope_for_token(STYLE_PROFILE_TOKENS[semantic_id]) != scope
    ]
    if wrong:
        raise StyleProfileError(f"{scope} profile contains out-of-scope token: {wrong[0]}")


def _validate_stored_style_profile(payload: Any) -> tuple[dict, bool]:
    """Validate one persisted profile, migrating older semantic-id subsets.

    Token schema revisions are additive authoring-catalog revisions. An older
    profile remains portable when every semantic id and typed value still
    validates against the current catalog. Newer revisions remain quarantined
    until this build understands them.
    """
    if not isinstance(payload, Mapping):
        raise StyleProfileError("style profile must be an object")
    token_version = payload.get("tokenSchemaVersion")
    if token_version == TOKEN_SCHEMA_VERSION:
        return validate_style_profile(payload), False
    if (
        isinstance(token_version, int)
        and not isinstance(token_version, bool)
        and 1 <= token_version < TOKEN_SCHEMA_VERSION
    ):
        migrated = deepcopy(dict(payload))
        overrides = migrated.get("overrides")
        if isinstance(overrides, Mapping) and token_version <= 2:
            # Token schema 2 accidentally exposed ``mapParanOpacity`` through
            # the daemon/profile catalog even though the iframe never consumed
            # its ``paranOp`` payload field. Schema 3 names the intended label
            # paint explicitly. Preserve stored profiles by moving the old
            # value once; an already-authored new role wins on collision.
            old_id = "renderer.astrocart.metric.mapParanOpacity"
            new_id = "renderer.astrocart.metric.mapParanLabelOpacity"
            if old_id in overrides:
                migrated_overrides = dict(overrides)
                migrated_overrides.setdefault(new_id, migrated_overrides[old_id])
                migrated_overrides.pop(old_id, None)
                migrated["overrides"] = migrated_overrides
        migrated["tokenSchemaVersion"] = TOKEN_SCHEMA_VERSION
        migrated.pop("contentHash", None)
        return validate_style_profile(migrated), True
    raise StyleProfileError(f"unsupported token schema version: {token_version}")


def _default_number(semantic_id: str, overrides: Mapping[str, Any], seen: set[str]) -> Optional[float]:
    if semantic_id in overrides and isinstance(overrides[semantic_id], (int, float)):
        return float(overrides[semantic_id])
    if semantic_id in seen:
        return None
    token = STYLE_PROFILE_TOKENS.get(semantic_id)
    if token is None:
        return None
    default = token.get("default")
    if isinstance(default, (int, float)):
        return float(default)
    if not isinstance(default, str):
        return None
    stripped = default.strip()
    try:
        return float(stripped.removesuffix(str(token.get("unit") or "")))
    except ValueError:
        match = _VAR_RE.fullmatch(stripped)
        if not match:
            return None
        css_var = match.group(1)
        target = next(
            (key for key, spec in STYLE_PROFILE_TOKENS.items() if spec.get("cssVar") == css_var),
            None,
        )
        if target is None:
            return None
        return _default_number(target, overrides, seen | {semantic_id})


def _validate_color_aliases(overrides: Mapping[str, Any]) -> None:
    """Reject a set of references that never reaches a colour.

    Each chain is walked to its end; revisiting a token means the chain closes
    on itself and no literal exists anywhere along it. Rejecting that at the
    door keeps every later reader — this daemon, the editor, the exporters —
    free of loop guards over data that should never have been stored.
    """
    for semantic_id in overrides:
        seen = {semantic_id}
        current = color_alias_target(overrides.get(semantic_id))
        while current is not None:
            if current in seen:
                raise StyleProfileError(
                    f"style color references form a cycle at {current}"
                )
            seen.add(current)
            current = color_alias_target(overrides.get(current))


def resolve_color_alias(semantic_id: str, overrides: Mapping[str, Any]) -> Any:
    """The value a colour override lands on after every reference is followed.

    Returns ``None`` when the chain ends at a token this profile does not
    override, which means the followed colour comes from the options underneath
    and the caller should leave that value alone.
    """
    seen = {semantic_id}
    current = overrides.get(semantic_id)
    while True:
        alias = color_alias_target(current)
        if alias is None:
            return current
        if alias in seen:
            return None
        seen.add(alias)
        if alias not in overrides:
            return None
        current = overrides[alias]


def _validate_relations(overrides: Mapping[str, Any]) -> None:
    for relation in STYLE_PROFILE_RELATIONS:
        kind = relation.get("kind")
        if kind == "ascending":
            values = [_default_number(token, overrides, set()) for token in relation.get("tokens", [])]
            if any(value is None for value in values):
                continue
            if any(values[index] > values[index + 1] for index in range(len(values) - 1)):
                raise StyleProfileError(f"style relation failed: {relation.get('id')}")
        elif kind == "minimum-sum":
            target = _default_number(str(relation.get("target")), overrides, set())
            terms = [
                (_default_number(str(term.get("token")), overrides, set()), float(term.get("multiplier", 1)))
                for term in relation.get("terms", [])
            ]
            if target is None or any(value is None for value, _ in terms):
                continue
            required = sum(float(value) * multiplier for value, multiplier in terms)
            if target + 1e-7 < required:
                raise StyleProfileError(f"style relation failed: {relation.get('id')}")


def validate_style_profile(payload: Any) -> dict:
    """Validate and normalize one portable profile without mutating state."""
    if not isinstance(payload, Mapping):
        raise StyleProfileError("style profile must be an object")
    if payload.get("kind") != PROFILE_KIND:
        raise StyleProfileError(f"style profile kind must be {PROFILE_KIND}")
    if payload.get("profileSchemaVersion") != PROFILE_SCHEMA_VERSION:
        raise StyleProfileError(f"unsupported profile schema version: {payload.get('profileSchemaVersion')}")
    if payload.get("tokenSchemaVersion") != TOKEN_SCHEMA_VERSION:
        raise StyleProfileError(f"unsupported token schema version: {payload.get('tokenSchemaVersion')}")

    profile_id = str(payload.get("id") or "")
    if not _ID_RE.fullmatch(profile_id):
        raise StyleProfileError("profile id must be a lowercase stable id")
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise StyleProfileError("profile name must contain 1 to 80 characters")
    name = name.strip()
    scope = str(payload.get("scope") or "")
    base_preset_id = payload.get("basePresetId")
    if base_preset_id is not None:
        if not isinstance(base_preset_id, str) or not base_preset_id.strip() or len(base_preset_id) > 80:
            raise StyleProfileError("basePresetId must be null or a short preset id")
        base_preset_id = base_preset_id.strip()
    raw_overrides = payload.get("overrides")
    if not isinstance(raw_overrides, Mapping):
        raise StyleProfileError("profile overrides must be an object")
    if len(raw_overrides) > len(STYLE_PROFILE_TOKENS):
        raise StyleProfileError("profile has too many overrides")
    overrides = {
        str(semantic_id): _validate_token_value(str(semantic_id), value)
        for semantic_id, value in raw_overrides.items()
    }
    _validate_scope(scope, overrides)
    _validate_color_aliases(overrides)
    _validate_relations(overrides)
    normalized = {
        "kind": PROFILE_KIND,
        "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
        "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
        "id": profile_id,
        "name": name,
        "scope": scope,
        "basePresetId": base_preset_id,
        "overrides": dict(sorted(overrides.items())),
    }
    raw_authoring = payload.get("authoringOverrides")
    raw_chart_style = payload.get("chartStyleProfileV2")
    if raw_authoring is not None or raw_chart_style is not None:
        validated_chart_style = (
            validate_chart_style_profile_v2(raw_chart_style)
            if raw_chart_style is not None
            else build_chart_style_profile_v2({})
        )
        authoring_overrides = (
            validate_authoring_overrides(raw_authoring)
            if raw_authoring is not None
            else flatten_chart_style_profile_v2(validated_chart_style)
        )
        # The flat map is the exact CAS/persistence authority. Recompile the
        # nested portable profile so percentage projection cannot introduce
        # round-trip drift in the editor-facing values.
        normalized["authoringOverrides"] = authoring_overrides
        normalized["chartStyleProfileV2"] = build_chart_style_profile_v2(
            authoring_overrides,
            base=validated_chart_style["base"],
            reference_space=validated_chart_style["referenceSpace"],
        )
    raw_app_authoring = payload.get("appAuthoringOverrides")
    if raw_app_authoring is not None:
        app_authoring_overrides = validate_app_authoring_overrides(
            raw_app_authoring
        )
        if app_authoring_overrides and scope not in ("app", "combined"):
            raise StyleProfileError(
                "app authoring overrides require an app or combined profile"
            )
        normalized["appAuthoringOverrides"] = app_authoring_overrides
    normalized["contentHash"] = _content_hash(normalized)
    return normalized


def normalize_imported_style_profile(payload: Any) -> dict:
    """Normalize persisted profiles and portable Style Lab exchange files."""
    if not isinstance(payload, Mapping):
        raise StyleProfileError("imported style profile must be an object")
    if payload.get("kind") == PROFILE_KIND:
        return validate_style_profile(payload)
    if payload.get("kind") != PORTABLE_CHART_STYLE_KIND:
        raise StyleProfileError(
            f"style profile kind must be {PROFILE_KIND} or {PORTABLE_CHART_STYLE_KIND}"
        )

    chart_style = validate_chart_style_profile_v2(payload)
    nested_authoring = flatten_chart_style_profile_v2(chart_style)
    raw_authoring = payload.get("authoringOverrides")
    authoring = (
        validate_authoring_overrides(raw_authoring)
        if raw_authoring is not None
        else nested_authoring
    )
    channels_match = authoring.keys() == nested_authoring.keys() and all(
        (
            abs(float(value) - float(nested_authoring[semantic_id])) <= 1e-9
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and isinstance(nested_authoring[semantic_id], (int, float))
                and not isinstance(nested_authoring[semantic_id], bool)
            )
            else value == nested_authoring[semantic_id]
        )
        for semantic_id, value in authoring.items()
    )
    if not channels_match:
        raise StyleProfileError(
            "imported style profile authoringOverrides do not match its nested styles"
        )
    legacy_overrides = payload.get("legacyTokenOverrides", {})
    if not isinstance(legacy_overrides, Mapping):
        raise StyleProfileError("imported style profile legacyTokenOverrides must be an object")

    normalized_payload = {
        "kind": PROFILE_KIND,
        "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
        "tokenSchemaVersion": payload.get("tokenSchemaVersion"),
        "id": payload.get("id"),
        "name": payload.get("name"),
        "scope": payload.get("scope"),
        "basePresetId": payload.get("basePresetId"),
        "overrides": legacy_overrides,
        "authoringOverrides": authoring,
        "chartStyleProfileV2": chart_style,
    }
    if "appAuthoringOverrides" in payload:
        normalized_payload["appAuthoringOverrides"] = payload.get(
            "appAuthoringOverrides"
        )
    return validate_style_profile(normalized_payload)


def _color_to_css(value: list) -> str:
    if len(value) == 3:
        return f"rgb({value[0]} {value[1]} {value[2]})"
    alpha = f"{float(value[3]) * 100:g}%"
    return f"rgb({value[0]} {value[1]} {value[2]} / {alpha})"


def style_profile_css_overrides(profile: Optional[Mapping[str, Any]]) -> dict[str, str]:
    """Resolve validated typed overrides to their concrete CSS declarations."""
    if not profile:
        return {}
    result = {}
    for semantic_id, value in profile.get("overrides", {}).items():
        token = STYLE_PROFILE_TOKENS[semantic_id]
        if token["type"] == "color":
            rendered = _color_to_css(value)
        elif token["type"] == "number":
            rendered = f"{value:g}{token.get('unit') or ''}" if isinstance(value, float) else f"{value}{token.get('unit') or ''}"
        else:
            rendered = str(value)
        result[str(token["cssVar"])] = rendered
    return result


def split_style_profile_css_overrides(profile: Optional[Mapping[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    app: dict[str, str] = {}
    chart: dict[str, str] = {}
    rendered = style_profile_css_overrides(profile)
    for semantic_id in (profile or {}).get("overrides", {}):
        token = STYLE_PROFILE_TOKENS[semantic_id]
        target = chart if _profile_scope_for_token(token) == "chart" else app
        target[str(token["cssVar"])] = rendered[str(token["cssVar"])]
    return app, chart


def _empty_store() -> dict:
    return {
        "kind": STORE_KIND,
        "storeSchemaVersion": STORE_SCHEMA_VERSION,
        "activeProfileId": None,
        "profiles": {},
        "quarantinedProfiles": {},
        "profileErrors": {},
        "legacyMigrations": {},
    }


class StyleProfileStore:
    """Atomic JSON store for named, validated style profiles."""

    def __init__(self, directory: str | os.PathLike[str]) -> None:
        self._lock = threading.RLock()
        self.path = Path(directory) / STYLE_PROFILE_FILENAME
        self._load_error: Optional[str] = None
        try:
            self._state = self._load()
        except StyleProfileError as exc:
            # A damaged optional style file must never prevent the daemon or a
            # user's charts from opening. Preserve it untouched and refuse
            # mutations until the caller explicitly deals with the error.
            self._state = _empty_store()
            self._load_error = str(exc)

    def _load(self) -> dict:
        if not self.path.is_file():
            return _empty_store()
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, Mapping) or value.get("kind") != STORE_KIND:
                raise StyleProfileError("invalid style profile store kind")
            if value.get("storeSchemaVersion") != STORE_SCHEMA_VERSION:
                raise StyleProfileError("unsupported style profile store version")
            profiles = value.get("profiles")
            if not isinstance(profiles, Mapping):
                raise StyleProfileError("style profile store profiles must be an object")
            quarantined = value.get("quarantinedProfiles", {})
            if not isinstance(quarantined, Mapping):
                raise StyleProfileError("style profile store quarantinedProfiles must be an object")
            normalized = _empty_store()
            # Retry quarantined entries first: a newer token catalog may make a
            # previously unknown semantic id valid again. The primary profiles
            # map wins when both containers happen to contain the same key.
            candidates = [
                *(quarantined.items()),
                *(profiles.items()),
            ]
            for raw_profile_id, raw_profile in candidates:
                profile_id = str(raw_profile_id)
                try:
                    profile, _ = _validate_stored_style_profile(raw_profile)
                    if profile_id != profile["id"]:
                        raise StyleProfileError("style profile store id mismatch")
                except (StyleProfileError, TypeError, ValueError) as exc:
                    normalized["profiles"].pop(profile_id, None)
                    normalized["quarantinedProfiles"][profile_id] = deepcopy(raw_profile)
                    normalized["profileErrors"][profile_id] = str(exc)
                    continue
                normalized["profiles"][profile_id] = profile
                normalized["quarantinedProfiles"].pop(profile_id, None)
                normalized["profileErrors"].pop(profile_id, None)
            active = value.get("activeProfileId")
            normalized["activeProfileId"] = active if active in normalized["profiles"] else None
            migrations = value.get("legacyMigrations")
            if isinstance(migrations, Mapping):
                normalized["legacyMigrations"] = deepcopy(dict(migrations))
            return normalized
        except (OSError, json.JSONDecodeError, StyleProfileError, TypeError, ValueError) as exc:
            raise StyleProfileError(f"could not load {self.path}: {exc}") from exc

    def _write(self, state: Mapping[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        persisted = {
            "kind": STORE_KIND,
            "storeSchemaVersion": STORE_SCHEMA_VERSION,
            "activeProfileId": state.get("activeProfileId"),
            "profiles": state.get("profiles", {}),
            "legacyMigrations": state.get("legacyMigrations", {}),
        }
        if state.get("quarantinedProfiles"):
            persisted["quarantinedProfiles"] = state["quarantinedProfiles"]
        rendered = json.dumps(persisted, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=str(self.path.parent)
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(rendered)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.path)
        except Exception:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise

    def _commit(self, state: dict) -> None:
        if self._load_error:
            raise StyleProfileError(self._load_error)
        self._write(state)
        self._state = state

    @contextmanager
    def _transaction(self):
        with self._lock:
            with exclusive_file_transaction(self.path):
                if not self._load_error:
                    self._state = self._load()
                yield

    def payload(self) -> dict:
        with self._transaction():
            return deepcopy({
                "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
                "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
                "activeProfileId": self._state["activeProfileId"],
                "profiles": list(self._state["profiles"].values()),
                "loadError": self._load_error,
                "profileErrors": self._state["profileErrors"],
            })

    @staticmethod
    def _remove_quarantine_for_profile(state: dict, profile_id: str) -> None:
        for quarantined_id, raw_profile in list(state["quarantinedProfiles"].items()):
            raw_id = raw_profile.get("id") if isinstance(raw_profile, Mapping) else None
            if quarantined_id == profile_id or raw_id == profile_id:
                del state["quarantinedProfiles"][quarantined_id]
                state["profileErrors"].pop(quarantined_id, None)

    def active_profile(self) -> Optional[dict]:
        with self._transaction():
            profile = self._state["profiles"].get(self._state["activeProfileId"])
            return deepcopy(profile) if profile else None

    def profile(self, profile_id: str) -> dict:
        with self._transaction():
            profile = self._state["profiles"].get(profile_id)
            if profile is None:
                raise StyleProfileError(f"unknown style profile: {profile_id}")
            return deepcopy(profile)

    def upsert(self, payload: Any, *, activate: bool = False) -> dict:
        profile = validate_style_profile(payload)
        with self._transaction():
            state = deepcopy(self._state)
            state["profiles"][profile["id"]] = profile
            self._remove_quarantine_for_profile(state, profile["id"])
            if activate:
                state["activeProfileId"] = profile["id"]
            self._commit(state)
            return deepcopy(profile)

    def activate(self, profile_id: Optional[str]) -> Optional[dict]:
        with self._transaction():
            if profile_id is not None and profile_id not in self._state["profiles"]:
                raise StyleProfileError(f"unknown style profile: {profile_id}")
            state = deepcopy(self._state)
            state["activeProfileId"] = profile_id
            self._commit(state)
            profile = state["profiles"].get(profile_id)
            return deepcopy(profile) if profile else None

    def delete(self, profile_id: str) -> None:
        with self._transaction():
            if profile_id not in self._state["profiles"]:
                raise StyleProfileError(f"unknown style profile: {profile_id}")
            state = deepcopy(self._state)
            del state["profiles"][profile_id]
            if state["activeProfileId"] == profile_id:
                state["activeProfileId"] = None
            self._commit(state)

    def discard_profiles(self, profile_ids: Iterable[str]) -> dict:
        """Remove retired profile identities without failing on absent entries."""
        retired_ids = {
            str(profile_id).strip()
            for profile_id in profile_ids
            if str(profile_id).strip()
        }
        with self._transaction():
            state = deepcopy(self._state)
            active = state["profiles"].get(state["activeProfileId"])
            removed_ids = []
            for profile_id in sorted(retired_ids):
                if state["profiles"].pop(profile_id, None) is not None:
                    removed_ids.append(profile_id)
                self._remove_quarantine_for_profile(state, profile_id)
            removed_active = (
                deepcopy(active)
                if active is not None and active.get("id") in retired_ids
                else None
            )
            if state["activeProfileId"] in retired_ids:
                state["activeProfileId"] = None
            if state != self._state:
                self._commit(state)
            return {
                "removedProfileIds": removed_ids,
                "removedActiveProfile": removed_active,
            }

    def migrate_legacy(self, values: Any, *, activate: bool = True) -> dict:
        if not isinstance(values, Mapping):
            raise StyleProfileError("legacy style values must be an object")
        source_hash = _content_hash(values)
        overrides = {}
        rejected = []
        for legacy_id, value in values.items():
            semantic_id = LEGACY_STYLE_TOKEN_IDS.get(str(legacy_id))
            if semantic_id is None:
                rejected.append(str(legacy_id))
                continue
            try:
                overrides[semantic_id] = _legacy_value(semantic_id, value)
            except StyleProfileError:
                rejected.append(str(legacy_id))
        deterministic_profile_id = f"legacy-v1-{source_hash[:8]}"
        rejected = sorted(rejected)
        with self._transaction():
            previous = self._state["legacyMigrations"].get(source_hash)
            already_migrated = isinstance(previous, Mapping)
            previous_profile_id = previous.get("profileId") if already_migrated else None
            profile_id = (
                previous_profile_id
                if isinstance(previous_profile_id, str) and _ID_RE.fullmatch(previous_profile_id)
                else deterministic_profile_id
            )
            state = deepcopy(self._state)
            profile = state["profiles"].get(profile_id)
            changed = False
            if profile is None:
                profile = validate_style_profile({
                    "kind": PROFILE_KIND,
                    "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
                    "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
                    "id": profile_id,
                    "name": "Legacy v1",
                    "scope": "combined",
                    "basePresetId": None,
                    "overrides": overrides,
                })
                state["profiles"][profile_id] = profile
                self._remove_quarantine_for_profile(state, profile_id)
                changed = True
            if activate and state["activeProfileId"] != profile_id:
                state["activeProfileId"] = profile_id
                changed = True
            migration_record = {
                "profileId": profile_id,
                "rejected": rejected,
            }
            if state["legacyMigrations"].get(source_hash) != migration_record:
                state["legacyMigrations"][source_hash] = migration_record
                changed = True
            if changed:
                self._commit(state)
        return {
            "sourceHash": source_hash,
            "profile": deepcopy(profile),
            "rejected": rejected,
            "alreadyMigrated": already_migrated,
        }


def _legacy_color(value: str, semantic_id: str) -> list:
    match = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", value.strip())
    if not match:
        raise StyleProfileError(f"invalid legacy color for {semantic_id}")
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(channel * 2 for channel in digits)
    return [int(digits[index:index + 2], 16) for index in (0, 2, 4)]


def _legacy_value(semantic_id: str, value: Any) -> Any:
    token = STYLE_PROFILE_TOKENS[semantic_id]
    if token["type"] == "color" and isinstance(value, str):
        value = _legacy_color(value, semantic_id)
    return _validate_token_value(semantic_id, value)
