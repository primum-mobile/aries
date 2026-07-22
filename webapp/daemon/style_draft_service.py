# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Ephemeral, revisioned style-profile drafts for the browser Style Lab.

Drafts deliberately sit beside, rather than inside, ``StyleProfileStore``.
Pointer moves can therefore publish paint-only previews without writing the
options directory.  Every candidate state is still normalized by the same
profile validator used for imports and persisted profiles.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

from webapp.daemon.style_profile_catalog_generated import (
    STYLE_PROFILE_RELATIONS,
    STYLE_PROFILE_TOKENS,
    TOKEN_SCHEMA_VERSION,
)
from webapp.daemon.style_profile_service import (
    PROFILE_KIND,
    PROFILE_SCHEMA_VERSION,
    StyleProfileError,
    validate_style_profile,
)
from webapp.daemon.style_authoring_service import (
    apply_authoring_patch,
    build_chart_style_profile_v2,
)


DRAFT_KIND = "aries.style-draft"
DRAFT_SCHEMA_VERSION = 2
MAX_OPEN_DRAFTS = 64

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


class StyleDraftError(ValueError):
    """A draft request was malformed or could not be completed."""


class StyleDraftNotFoundError(StyleDraftError):
    """The requested draft (or the current alias) does not exist."""


class StyleDraftConflictError(StyleDraftError):
    """The caller tried to mutate a stale revision."""

    def __init__(self, current: dict) -> None:
        super().__init__("style draft revision is stale")
        self.current = current


def _utc_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _draft_etag(draft_id: str, revision: int, profile: Mapping[str, Any]) -> str:
    source = json.dumps(
        {
            "draftId": draft_id,
            "revision": revision,
            "profileHash": profile.get("contentHash"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return "style-draft-" + hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]


def _clean_etag(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("W/"):
        cleaned = cleaned[2:].strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] == '"':
        cleaned = cleaned[1:-1]
    return cleaned


def _normalized_search_text(value: Any) -> str:
    """Flatten catalog metadata into word-searchable, camel-case-aware text."""
    if isinstance(value, Mapping):
        raw = " ".join(
            f"{_normalized_search_text(key)} {_normalized_search_text(item)}"
            for key, item in value.items()
        )
    elif isinstance(value, (list, tuple, set)):
        raw = " ".join(_normalized_search_text(item) for item in value)
    else:
        raw = str(value or "")
    raw = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", raw)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", raw.lower()).split())


class StyleDraftService:
    """Thread-safe in-memory drafts with compare-and-swap mutations."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._drafts: dict[str, dict[str, Any]] = {}
        self._current_id: Optional[str] = None

    def _resolve_id(self, draft_id: str) -> str:
        if draft_id == "current":
            if self._current_id is None:
                raise StyleDraftNotFoundError("no current style draft")
            return self._current_id
        if not _ID_RE.fullmatch(draft_id):
            raise StyleDraftError("draft id must be a lowercase stable id")
        return draft_id

    @staticmethod
    def _profile_from_record(record: Mapping[str, Any]) -> dict:
        return deepcopy(record["profile"])

    @staticmethod
    def _public(record: Mapping[str, Any]) -> dict:
        profile = record["profile"]
        chart_style_profile = profile["chartStyleProfileV2"]
        draft_id = str(record["draftId"])
        revision = int(record["revision"])
        return {
            "kind": DRAFT_KIND,
            "draftSchemaVersion": DRAFT_SCHEMA_VERSION,
            "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
            # ``id`` is the convenient browser identity; ``profileId`` is the
            # eventual persisted profile identity.
            "id": draft_id,
            "draftId": draft_id,
            "revision": revision,
            "etag": _draft_etag(draft_id, revision, profile),
            "profileId": profile["id"],
            "name": profile["name"],
            "scope": profile["scope"],
            "basePresetId": profile["basePresetId"],
            "overrides": deepcopy(profile["overrides"]),
            "authoringOverrides": deepcopy(profile["authoringOverrides"]),
            "chartStyleProfileV2": deepcopy(chart_style_profile),
            "profileContentHash": profile["contentHash"],
            "createdAt": _utc_timestamp(float(record["createdAt"])),
            "updatedAt": _utc_timestamp(float(record["updatedAt"])),
        }

    @staticmethod
    def _summary(record: Mapping[str, Any], *, current: bool) -> dict:
        draft = StyleDraftService._public(record)
        return {
            "id": draft["id"],
            "draftId": draft["draftId"],
            "revision": draft["revision"],
            "etag": draft["etag"],
            "profileId": draft["profileId"],
            "name": draft["name"],
            "scope": draft["scope"],
            "overrideCount": len(draft["overrides"]),
            "authoringOverrideCount": len(draft["authoringOverrides"]),
            "current": current,
            "createdAt": draft["createdAt"],
            "updatedAt": draft["updatedAt"],
        }

    def _record(self, draft_id: str) -> dict[str, Any]:
        resolved = self._resolve_id(draft_id)
        record = self._drafts.get(resolved)
        if record is None:
            raise StyleDraftNotFoundError(f"unknown style draft: {resolved}")
        return record

    def _assert_expected(self, record: Mapping[str, Any], expected: str | int) -> None:
        if isinstance(expected, bool):
            raise StyleDraftError("style draft revision precondition is invalid")
        if isinstance(expected, int):
            matches = expected == int(record["revision"])
        else:
            candidate = _clean_etag(str(expected))
            matches = candidate == "*" or candidate == self._public(record)["etag"]
        if not matches:
            raise StyleDraftConflictError(self._public(record))

    @staticmethod
    def _new_profile(
        *,
        profile_id: Optional[str],
        name: Optional[str],
        scope: str,
        base_preset_id: Optional[str],
    ) -> dict:
        target_id = profile_id or f"chart-style-{uuid.uuid4().hex[:8]}"
        return validate_style_profile({
            "kind": PROFILE_KIND,
            "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
            "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
            "id": target_id,
            "name": name or "Untitled chart style",
            "scope": scope,
            "basePresetId": base_preset_id,
            "overrides": {},
            "authoringOverrides": {},
            "chartStyleProfileV2": build_chart_style_profile_v2({}),
        })

    def list_drafts(self) -> dict:
        with self._lock:
            ordered = sorted(self._drafts.values(), key=lambda item: float(item["updatedAt"]), reverse=True)
            return {
                "currentDraftId": self._current_id,
                "drafts": [
                    self._summary(record, current=record["draftId"] == self._current_id)
                    for record in ordered
                ],
            }

    def create_draft(
        self,
        *,
        draft_id: Optional[str] = None,
        profile: Optional[Mapping[str, Any]] = None,
        profile_id: Optional[str] = None,
        name: Optional[str] = None,
        scope: Optional[str] = None,
        base_preset_id: Optional[str] = None,
    ) -> dict:
        with self._lock:
            if len(self._drafts) >= MAX_OPEN_DRAFTS:
                raise StyleDraftError(f"at most {MAX_OPEN_DRAFTS} style drafts may be open")
            resolved_id = draft_id or f"draft-{uuid.uuid4().hex[:12]}"
            if not _ID_RE.fullmatch(resolved_id) or resolved_id == "current":
                raise StyleDraftError("draft id must be a lowercase stable id other than current")
            if resolved_id in self._drafts:
                raise StyleDraftError(f"style draft already exists: {resolved_id}")
            if profile is not None:
                source = validate_style_profile(profile)
                source_id = str(source["id"])
                generated_id = f"{source_id}-copy-{uuid.uuid4().hex[:8]}"
                if len(generated_id) > 64:
                    generated_id = f"chart-style-{uuid.uuid4().hex[:12]}"
                normalized = validate_style_profile({
                    **source,
                    "id": profile_id or generated_id,
                    "name": name or source["name"],
                    "scope": scope or source["scope"],
                    "basePresetId": (
                        base_preset_id
                        if base_preset_id is not None
                        else source["basePresetId"]
                    ),
                    "chartStyleProfileV2": source.get("chartStyleProfileV2")
                    or build_chart_style_profile_v2({}),
                    "authoringOverrides": source.get("authoringOverrides") or {},
                })
            else:
                normalized = self._new_profile(
                    profile_id=profile_id,
                    name=name,
                    scope=scope or "chart",
                    base_preset_id=base_preset_id,
                )
            now = time.time()
            record = {
                "draftId": resolved_id,
                "revision": 1,
                "profile": normalized,
                "createdAt": now,
                "updatedAt": now,
            }
            self._drafts[resolved_id] = record
            self._current_id = resolved_id
            return self._public(record)

    def get_draft(self, draft_id: str) -> dict:
        with self._lock:
            return self._public(self._record(draft_id))

    @staticmethod
    def _candidate_profile(
        record: Mapping[str, Any],
        overrides: Mapping[str, Any],
        authoring_overrides: Optional[Mapping[str, Any]] = None,
    ) -> tuple[dict, list[str], list[str], list[str], list[str]]:
        if not isinstance(overrides, Mapping):
            raise StyleDraftError("draft overrides patch must be an object")
        current = record["profile"]
        merged = deepcopy(current["overrides"])
        changed: list[str] = []
        removed: list[str] = []
        for raw_id, value in overrides.items():
            semantic_id = str(raw_id)
            if semantic_id not in STYLE_PROFILE_TOKENS:
                raise StyleProfileError(f"unknown or non-editable style token: {semantic_id}")
            if value is None:
                if semantic_id in merged:
                    del merged[semantic_id]
                    removed.append(semantic_id)
            elif merged.get(semantic_id) != value:
                merged[semantic_id] = value
                changed.append(semantic_id)
        current_chart_style = current["chartStyleProfileV2"]
        current_authoring = current["authoringOverrides"]
        merged_authoring, authoring_changed, authoring_removed = apply_authoring_patch(
            current_authoring,
            authoring_overrides or {},
        )
        candidate = validate_style_profile({
            "kind": PROFILE_KIND,
            "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
            "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
            "id": current["id"],
            "name": current["name"],
            "scope": current["scope"],
            "basePresetId": current["basePresetId"],
            "overrides": merged,
            "authoringOverrides": merged_authoring,
            "chartStyleProfileV2": build_chart_style_profile_v2(
                merged_authoring,
                base=current_chart_style["base"],
                reference_space=current_chart_style["referenceSpace"],
            ),
        })
        return (
            candidate,
            sorted(changed),
            sorted(removed),
            authoring_changed,
            authoring_removed,
        )

    def patch_draft(
        self,
        draft_id: str,
        overrides: Mapping[str, Any],
        *,
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        expected: str | int,
    ) -> dict:
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            candidate, changed, removed, authoring_changed, authoring_removed = (
                self._candidate_profile(record, overrides, authoring_overrides)
            )
            any_change = bool(changed or removed or authoring_changed or authoring_removed)
            if any_change:
                record["profile"] = candidate
                record["revision"] = int(record["revision"]) + 1
                record["updatedAt"] = time.time()
            draft = self._public(record)
            return {
                **draft,
                "draft": deepcopy(draft),
                "changedTokenIds": changed,
                "removedTokenIds": removed,
                "changedAuthoringIds": authoring_changed,
                "removedAuthoringIds": authoring_removed,
                "changed": any_change,
                "refreshMode": "display-overlay" if any_change else None,
            }

    def validate_draft(
        self,
        draft_id: str,
        overrides: Optional[Mapping[str, Any]] = None,
        *,
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        expected: Optional[str | int] = None,
    ) -> dict:
        with self._lock:
            record = self._record(draft_id)
            if expected is not None:
                self._assert_expected(record, expected)
            candidate, changed, removed, authoring_changed, authoring_removed = (
                self._candidate_profile(record, overrides or {}, authoring_overrides)
            )
            return {
                "valid": True,
                "revision": int(record["revision"]),
                "etag": self._public(record)["etag"],
                "wouldChange": bool(changed or removed or authoring_changed or authoring_removed),
                "changedTokenIds": changed,
                "removedTokenIds": removed,
                "changedAuthoringIds": authoring_changed,
                "removedAuthoringIds": authoring_removed,
                "profile": candidate,
                "chartStyleProfileV2": deepcopy(candidate["chartStyleProfileV2"]),
            }

    def discard_draft(self, draft_id: str, *, expected: str | int) -> dict:
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            draft = self._public(record)
            del self._drafts[str(record["draftId"])]
            if self._current_id == record["draftId"]:
                self._current_id = None
            return {
                "discarded": True,
                "discardedDraftId": record["draftId"],
                "revision": draft["revision"],
                "etag": draft["etag"],
                "profileId": draft["profileId"],
            }

    def commit_draft(
        self,
        draft_id: str,
        *,
        expected: str | int,
        persist: Callable[[dict], Any],
        discard: bool = False,
    ) -> dict:
        """Persist exactly the revision checked while holding the draft lock.

        The persistence callback is intentionally injected by ``server.py`` so
        this module stays independent of the heavyweight options service.
        A failed store write leaves the draft untouched.
        """
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            profile = validate_style_profile(self._profile_from_record(record))
            persistence = persist(deepcopy(profile))
            draft = self._public(record)
            if discard:
                del self._drafts[str(record["draftId"])]
                if self._current_id == record["draftId"]:
                    self._current_id = None
            return {
                **({} if discard else draft),
                "committed": True,
                "discarded": bool(discard),
                "draft": None if discard else draft,
                "draftId": draft["draftId"],
                "revision": draft["revision"],
                "etag": draft["etag"],
                "profile": profile,
                "persistence": persistence,
            }

    def catalog(
        self,
        *,
        query: Optional[str] = None,
        scope: Optional[str] = None,
        token_type: Optional[str] = None,
    ) -> dict:
        raw_needle = (query or "").strip().lower()
        query_terms = _normalized_search_text(query).split()
        exact_tokens = []
        word_tokens = []
        for semantic_id, raw_spec in sorted(STYLE_PROFILE_TOKENS.items()):
            spec = deepcopy(raw_spec)
            if scope and spec.get("scope") != scope:
                continue
            if token_type and spec.get("type") != token_type:
                continue
            token = {"semanticId": semantic_id, **spec}
            identifier_haystack = " ".join(
                (semantic_id, str(spec.get("cssVar") or ""))
            ).lower()
            if raw_needle and raw_needle in identifier_haystack:
                exact_tokens.append(token)
                continue
            haystack = _normalized_search_text({"semanticId": semantic_id, **spec})
            if query_terms and not all(term in haystack for term in query_terms):
                continue
            word_tokens.append(token)
        tokens = exact_tokens if exact_tokens else word_tokens
        return {
            "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
            "count": len(tokens),
            "tokens": tokens,
            "relations": deepcopy(STYLE_PROFILE_RELATIONS),
        }

    @staticmethod
    def catalog_token(semantic_id: str) -> dict:
        spec = STYLE_PROFILE_TOKENS.get(semantic_id)
        if spec is None:
            raise StyleDraftNotFoundError(f"unknown style token: {semantic_id}")
        return {
            "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
            "semanticId": semantic_id,
            **deepcopy(spec),
        }

    def clear(self) -> None:
        """Reset ephemeral state; intended for deterministic daemon tests."""
        with self._lock:
            self._drafts.clear()
            self._current_id = None


style_draft_service = StyleDraftService()
