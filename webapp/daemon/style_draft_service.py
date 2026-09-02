# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Revisioned style-profile drafts for the browser Style Lab.

Drafts deliberately sit beside, rather than inside, ``StyleProfileStore``.
Pointer moves can therefore publish paint-only previews without writing the
options directory. Dirty working copies are journaled after the interaction
settles, on a background timer, so they survive an Aries restart without
placing file I/O on a gesture or response path. Every candidate state is still
normalized by the same profile validator used for imports and persisted
profiles.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
import unicodedata
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from webapp.daemon.file_transaction import exclusive_file_transaction

from webapp.daemon.style_profile_catalog_generated import (
    STYLE_PROFILE_RELATIONS,
    STYLE_PROFILE_TOKENS,
    TOKEN_SCHEMA_VERSION,
)
from webapp.daemon.style_profile_service import (
    PROFILE_KIND,
    PROFILE_SCHEMA_VERSION,
    StyleProfileError,
    normalize_imported_style_profile,
    validate_style_profile,
)
from webapp.daemon.app_style_authoring_service import (
    apply_app_authoring_patch,
)
from webapp.daemon.style_authoring_service import (
    apply_authoring_patch,
    build_chart_style_profile_v2,
)


DRAFT_KIND = "aries.style-draft"
DRAFT_SCHEMA_VERSION = 2
MAX_OPEN_DRAFTS = 64
DRAFT_STORE_KIND = "aries.style-draft-store"
DRAFT_STORE_SCHEMA_VERSION = 1
DRAFT_STORE_FILENAME = "style-drafts.json"
DRAFT_PERSIST_DELAY_SECONDS = 0.45

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


def _new_profile_id(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:48] or "theme"
    return f"{slug}-{uuid.uuid4().hex[:8]}"


class StyleDraftService:
    """Thread-safe drafts with CAS mutations and an idle-time recovery journal."""

    def __init__(self, directory: str | os.PathLike[str] | None = None) -> None:
        self._lock = threading.RLock()
        self._drafts: dict[str, dict[str, Any]] = {}
        self._current_id: Optional[str] = None
        self._store_path: Optional[Path] = None
        self._persist_timer: Optional[threading.Timer] = None
        self._pending_persist_keys: set[str] = set()
        if directory is not None:
            self.configure_directory(directory)

    @staticmethod
    def _record_key(record: Mapping[str, Any]) -> str:
        source = str(record.get("sourceThemeName") or "").strip()
        return f"source:{source}" if source else f"draft:{record.get('draftId')}"

    @staticmethod
    def _record_is_dirty(record: Mapping[str, Any]) -> bool:
        profile = record.get("profile") or {}
        baseline = record.get("baselineProfile") or profile
        return profile.get("contentHash") != baseline.get("contentHash")

    @staticmethod
    def _stored_record(record: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "draftId": str(record["draftId"]),
            "revision": int(record["revision"]),
            "profile": deepcopy(record["profile"]),
            "baselineProfile": deepcopy(record.get("baselineProfile") or record["profile"]),
            "sourceThemeName": record.get("sourceThemeName"),
            "createdAt": float(record["createdAt"]),
            "updatedAt": float(record["updatedAt"]),
        }

    @staticmethod
    def _validated_stored_record(payload: Any) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise StyleDraftError("stored style draft must be an object")
        draft_id = str(payload.get("draftId") or "")
        if not _ID_RE.fullmatch(draft_id) or draft_id == "current":
            raise StyleDraftError("stored style draft id is invalid")
        profile = validate_style_profile(payload.get("profile"))
        baseline = validate_style_profile(payload.get("baselineProfile") or profile)
        if baseline["id"] != profile["id"]:
            raise StyleDraftError("stored style draft baseline identity does not match")
        revision = int(payload.get("revision") or 0)
        if revision < 1:
            raise StyleDraftError("stored style draft revision is invalid")
        source = payload.get("sourceThemeName")
        if source is not None:
            source = str(source).strip()
            if not source:
                source = None
        now = time.time()
        return {
            "draftId": draft_id,
            "revision": revision,
            "profile": profile,
            "baselineProfile": baseline,
            "sourceThemeName": source,
            "createdAt": float(payload.get("createdAt") or now),
            "updatedAt": float(payload.get("updatedAt") or now),
        }

    @classmethod
    def _read_store_file(cls, path: Path) -> tuple[dict[str, dict[str, Any]], Optional[str]]:
        if not path.is_file():
            return {}, None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}, None
        if not isinstance(payload, Mapping):
            return {}, None
        if (
            payload.get("kind") != DRAFT_STORE_KIND
            or payload.get("storeSchemaVersion") != DRAFT_STORE_SCHEMA_VERSION
        ):
            return {}, None
        records: dict[str, dict[str, Any]] = {}
        for raw in payload.get("drafts") or []:
            try:
                record = cls._validated_stored_record(raw)
            except (StyleDraftError, StyleProfileError, TypeError, ValueError):
                continue
            if not cls._record_is_dirty(record):
                continue
            key = cls._record_key(record)
            previous = records.get(key)
            if previous is None or float(record["updatedAt"]) > float(previous["updatedAt"]):
                records[key] = record
        current_id = str(payload.get("currentDraftId") or "") or None
        return records, current_id

    def configure_directory(self, directory: str | os.PathLike[str]) -> None:
        """Attach the durable recovery journal and load it once.

        The daemon calls this lazily after options are available. Tests may
        continue to use a purely in-memory service by omitting ``directory``.
        """
        path = Path(directory) / DRAFT_STORE_FILENAME
        with self._lock:
            if self._store_path == path:
                return
            self._store_path = path
            stored, current_id = self._read_store_file(path)
            for record in stored.values():
                if len(self._drafts) >= MAX_OPEN_DRAFTS:
                    break
                self._drafts.setdefault(str(record["draftId"]), record)
            if current_id in self._drafts:
                self._current_id = current_id
            elif stored:
                newest = max(stored.values(), key=lambda item: float(item["updatedAt"]))
                self._current_id = str(newest["draftId"])

    def _schedule_persist_locked(self, *records: Mapping[str, Any]) -> None:
        if self._store_path is None:
            return
        self._pending_persist_keys.update(self._record_key(record) for record in records)
        if not self._pending_persist_keys:
            return
        if self._persist_timer is not None:
            self._persist_timer.cancel()
        timer = threading.Timer(DRAFT_PERSIST_DELAY_SECONDS, self.flush_persistence)
        timer.daemon = True
        self._persist_timer = timer
        timer.start()

    def flush_persistence(self) -> None:
        """Flush settled dirty drafts; never called inline by a draft mutation."""
        with self._lock:
            path = self._store_path
            keys = set(self._pending_persist_keys)
            if path is None or not keys:
                return
            local_by_key = {
                self._record_key(record): self._stored_record(record)
                for record in self._drafts.values()
                if self._record_is_dirty(record)
            }
            current_id = self._current_id
            self._pending_persist_keys.difference_update(keys)
            self._persist_timer = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with exclusive_file_transaction(path):
                stored, stored_current_id = self._read_store_file(path)
                for key in keys:
                    stored.pop(key, None)
                    local = local_by_key.get(key)
                    if local is not None:
                        stored[key] = local
                stored_ids = {str(record["draftId"]) for record in stored.values()}
                persisted_current_id = (
                    current_id if current_id in stored_ids
                    else stored_current_id if stored_current_id in stored_ids
                    else None
                )
                rendered = json.dumps({
                    "kind": DRAFT_STORE_KIND,
                    "storeSchemaVersion": DRAFT_STORE_SCHEMA_VERSION,
                    "currentDraftId": persisted_current_id,
                    "drafts": sorted(
                        (self._stored_record(record) for record in stored.values()),
                        key=lambda item: float(item["updatedAt"]),
                        reverse=True,
                    )[:MAX_OPEN_DRAFTS],
                }, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
                descriptor, temp_name = tempfile.mkstemp(
                    prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
                )
                try:
                    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                        handle.write(rendered)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.replace(temp_name, path)
                except Exception:
                    try:
                        os.unlink(temp_name)
                    except OSError:
                        pass
                    raise
        except Exception:
            # Recovery persistence is best-effort and must never destabilize
            # the live editor. Retry quietly after the next settled mutation.
            with self._lock:
                self._pending_persist_keys.update(keys)

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
        baseline_profile = record.get("baselineProfile") or profile
        chart_style_profile = (
            profile.get("chartStyleProfileV2")
            or build_chart_style_profile_v2(
                profile.get("authoringOverrides") or {}
            )
        )
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
            "sourceThemeName": record.get("sourceThemeName"),
            "modifiedFromBaseline": (
                profile.get("contentHash") != baseline_profile.get("contentHash")
            ),
            "overrides": deepcopy(profile["overrides"]),
            "authoringOverrides": deepcopy(
                profile.get("authoringOverrides") or {}
            ),
            "appAuthoringOverrides": deepcopy(
                profile.get("appAuthoringOverrides") or {}
            ),
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
            "basePresetId": draft["basePresetId"],
            "sourceThemeName": draft["sourceThemeName"],
            "overrideCount": len(draft["overrides"]),
            "authoringOverrideCount": len(draft["authoringOverrides"]),
            "appAuthoringOverrideCount": len(draft["appAuthoringOverrides"]),
            "modifiedFromBaseline": draft["modifiedFromBaseline"],
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
            "appAuthoringOverrides": {},
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
        source_theme_name: Optional[str] = None,
    ) -> dict:
        with self._lock:
            if source_theme_name is not None:
                source_theme_name = str(source_theme_name).strip()
                if not source_theme_name:
                    raise StyleDraftError("source theme name must not be empty")
                for record in self._drafts.values():
                    if record.get("sourceThemeName") == source_theme_name:
                        self._current_id = str(record["draftId"])
                        if self._record_is_dirty(record):
                            self._schedule_persist_locked(record)
                        return self._public(record)
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
                    "appAuthoringOverrides": (
                        source.get("appAuthoringOverrides") or {}
                    ),
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
                "baselineProfile": deepcopy(normalized),
                "sourceThemeName": source_theme_name,
                "createdAt": now,
                "updatedAt": now,
            }
            self._drafts[resolved_id] = record
            self._current_id = resolved_id
            return self._public(record)

    def get_draft_for_source(self, source_theme_name: str) -> dict:
        """Return a parked dirty draft without changing the current selection."""
        source = str(source_theme_name or "").strip()
        if not source:
            raise StyleDraftNotFoundError("style draft source theme is required")
        with self._lock:
            candidates = [
                record
                for record in self._drafts.values()
                if record.get("sourceThemeName") == source
                and self._record_is_dirty(record)
            ]
            if not candidates:
                raise StyleDraftNotFoundError(f"no modified style draft for theme: {source}")
            return self._public(max(candidates, key=lambda item: float(item["updatedAt"])))

    def get_draft(self, draft_id: str) -> dict:
        with self._lock:
            return self._public(self._record(draft_id))

    def export_profile(self, draft_id: str) -> dict:
        """Return the exact validated profile behind a draft for serialization."""
        with self._lock:
            return validate_style_profile(
                self._profile_from_record(self._record(draft_id))
            )

    @staticmethod
    def _candidate_profile(
        record: Mapping[str, Any],
        overrides: Mapping[str, Any],
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        app_authoring_overrides: Optional[Mapping[str, Any]] = None,
    ) -> tuple[
        dict,
        list[str],
        list[str],
        list[str],
        list[str],
        list[str],
        list[str],
    ]:
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
        current_authoring = current.get("authoringOverrides") or {}
        current_chart_style = (
            current.get("chartStyleProfileV2")
            or build_chart_style_profile_v2(current_authoring)
        )
        merged_authoring, authoring_changed, authoring_removed = apply_authoring_patch(
            current_authoring,
            authoring_overrides or {},
        )
        (
            merged_app_authoring,
            app_authoring_changed,
            app_authoring_removed,
        ) = apply_app_authoring_patch(
            current.get("appAuthoringOverrides") or {},
            app_authoring_overrides or {},
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
            "appAuthoringOverrides": merged_app_authoring,
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
            app_authoring_changed,
            app_authoring_removed,
        )

    def patch_draft(
        self,
        draft_id: str,
        overrides: Mapping[str, Any],
        *,
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        app_authoring_overrides: Optional[Mapping[str, Any]] = None,
        expected: str | int,
    ) -> dict:
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            (
                candidate,
                changed,
                removed,
                authoring_changed,
                authoring_removed,
                app_authoring_changed,
                app_authoring_removed,
            ) = self._candidate_profile(
                record,
                overrides,
                authoring_overrides,
                app_authoring_overrides,
            )
            any_change = bool(
                changed
                or removed
                or authoring_changed
                or authoring_removed
                or app_authoring_changed
                or app_authoring_removed
            )
            if any_change:
                record["profile"] = candidate
                record["revision"] = int(record["revision"]) + 1
                record["updatedAt"] = time.time()
                self._schedule_persist_locked(record)
            draft = self._public(record)
            return {
                **draft,
                "draft": deepcopy(draft),
                "changedTokenIds": changed,
                "removedTokenIds": removed,
                "changedAuthoringIds": authoring_changed,
                "removedAuthoringIds": authoring_removed,
                "changedAppAuthoringIds": app_authoring_changed,
                "removedAppAuthoringIds": app_authoring_removed,
                "changed": any_change,
                "refreshMode": "display-overlay" if any_change else None,
            }

    def validate_draft(
        self,
        draft_id: str,
        overrides: Optional[Mapping[str, Any]] = None,
        *,
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        app_authoring_overrides: Optional[Mapping[str, Any]] = None,
        expected: Optional[str | int] = None,
    ) -> dict:
        with self._lock:
            record = self._record(draft_id)
            if expected is not None:
                self._assert_expected(record, expected)
            (
                candidate,
                changed,
                removed,
                authoring_changed,
                authoring_removed,
                app_authoring_changed,
                app_authoring_removed,
            ) = self._candidate_profile(
                record,
                overrides or {},
                authoring_overrides,
                app_authoring_overrides,
            )
            return {
                "valid": True,
                "revision": int(record["revision"]),
                "etag": self._public(record)["etag"],
                "wouldChange": bool(
                    changed
                    or removed
                    or authoring_changed
                    or authoring_removed
                    or app_authoring_changed
                    or app_authoring_removed
                ),
                "changedTokenIds": changed,
                "removedTokenIds": removed,
                "changedAuthoringIds": authoring_changed,
                "removedAuthoringIds": authoring_removed,
                "changedAppAuthoringIds": app_authoring_changed,
                "removedAppAuthoringIds": app_authoring_removed,
                "profile": candidate,
                "chartStyleProfileV2": deepcopy(candidate["chartStyleProfileV2"]),
                "appAuthoringOverrides": deepcopy(
                    candidate.get("appAuthoringOverrides") or {}
                ),
            }

    def discard_draft(self, draft_id: str, *, expected: str | int) -> dict:
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            draft = self._public(record)
            del self._drafts[str(record["draftId"])]
            if self._current_id == record["draftId"]:
                self._current_id = None
            self._schedule_persist_locked(record)
            return {
                "discarded": True,
                "discardedDraftId": record["draftId"],
                "revision": draft["revision"],
                "etag": draft["etag"],
                "profileId": draft["profileId"],
            }

    def revert_draft(self, draft_id: str, *, expected: str | int) -> dict:
        """Restore the immutable saved/source snapshot without persisting."""
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            baseline = validate_style_profile(
                deepcopy(record.get("baselineProfile") or record["profile"])
            )
            changed = baseline["contentHash"] != record["profile"]["contentHash"]
            if changed:
                record["profile"] = baseline
                record["revision"] = int(record["revision"]) + 1
                record["updatedAt"] = time.time()
                self._schedule_persist_locked(record)
            draft = self._public(record)
            return {
                **draft,
                "draft": deepcopy(draft),
                "reverted": True,
                "changed": changed,
                "refreshMode": "display-overlay" if changed else None,
            }

    def restore_draft(
        self,
        draft_id: str,
        profile: Mapping[str, Any],
        *,
        expected: str | int,
        persist: Callable[[dict], Any],
    ) -> dict:
        """Replace and persist a draft with its daemon-owned factory profile."""
        with self._lock:
            record = self._record(draft_id)
            self._assert_expected(record, expected)
            restored = validate_style_profile(profile)
            if restored["id"] != record["profile"]["id"]:
                raise StyleDraftError("factory profile identity does not match the open theme")
            persistence = persist(deepcopy(restored))
            changed = restored["contentHash"] != record["profile"]["contentHash"]
            if changed:
                record["profile"] = restored
                record["baselineProfile"] = deepcopy(restored)
                record["revision"] = int(record["revision"]) + 1
                record["updatedAt"] = time.time()
                self._schedule_persist_locked(record)
            draft = self._public(record)
            return {
                **draft,
                "draft": deepcopy(draft),
                "reverted": True,
                "factoryRestored": True,
                "changed": changed,
                "persistence": persistence,
                "refreshMode": "display-overlay" if changed else None,
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
            if not discard:
                record["baselineProfile"] = deepcopy(profile)
                self._schedule_persist_locked(record)
            draft = self._public(record)
            if discard:
                del self._drafts[str(record["draftId"])]
                if self._current_id == record["draftId"]:
                    self._current_id = None
                self._schedule_persist_locked(record)
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

    def save_draft_as(
        self,
        draft_id: str,
        *,
        name: str,
        expected: str | int,
        overrides: Optional[Mapping[str, Any]] = None,
        authoring_overrides: Optional[Mapping[str, Any]] = None,
        app_authoring_overrides: Optional[Mapping[str, Any]] = None,
        persist: Callable[[dict], Any],
        clear_source: bool = False,
    ) -> dict:
        """Fork and persist the checked revision plus a pending editor patch.

        The source draft remains open and untouched unless an in-app promotion
        explicitly clears it. The fork becomes current so later ordinary saves
        update the new user theme. Persistence happens before publication,
        under the same CAS lock as a normal commit.
        """
        clean_name = str(name or "").strip()
        if not clean_name or len(clean_name) > 80:
            raise StyleDraftError("theme name must contain 1 to 80 characters")
        with self._lock:
            source_record = self._record(draft_id)
            self._assert_expected(source_record, expected)
            if len(self._drafts) >= MAX_OPEN_DRAFTS:
                raise StyleDraftError(f"at most {MAX_OPEN_DRAFTS} style drafts may be open")
            profile_id = _new_profile_id(clean_name)
            source_profile, _, _, _, _, _, _ = self._candidate_profile(
                source_record,
                overrides or {},
                authoring_overrides,
                app_authoring_overrides,
            )
            profile = validate_style_profile({
                **source_profile,
                "id": profile_id,
                "name": clean_name,
            })
            persistence = persist(deepcopy(profile))
            now = time.time()
            new_draft_id = f"draft-{uuid.uuid4().hex[:12]}"
            new_record = {
                "draftId": new_draft_id,
                "revision": 1,
                "profile": profile,
                "baselineProfile": deepcopy(profile),
                "sourceThemeName": f"profile:{profile_id}",
                "createdAt": now,
                "updatedAt": now,
            }
            self._drafts[new_draft_id] = new_record
            self._current_id = new_draft_id
            if clear_source:
                del self._drafts[str(source_record["draftId"])]
                self._schedule_persist_locked(source_record)
            draft = self._public(new_record)
            return {
                **draft,
                "savedAs": True,
                "committed": True,
                "draft": draft,
                "profile": profile,
                "themeSelector": new_record["sourceThemeName"],
                "persistence": persistence,
            }

    def import_profile(
        self,
        payload: Mapping[str, Any],
        *,
        persist: Callable[[dict], Any],
    ) -> dict:
        """Validate an exchange file, save it under a fresh id, and edit a clone."""
        with self._lock:
            if len(self._drafts) >= MAX_OPEN_DRAFTS:
                raise StyleDraftError(f"at most {MAX_OPEN_DRAFTS} style drafts may be open")
            source = normalize_imported_style_profile(payload)
            profile_id = _new_profile_id(str(source["name"]))
            profile = validate_style_profile({**source, "id": profile_id})
            persistence = persist(deepcopy(profile))
            now = time.time()
            draft_id = f"draft-{uuid.uuid4().hex[:12]}"
            record = {
                "draftId": draft_id,
                "revision": 1,
                "profile": profile,
                "baselineProfile": deepcopy(profile),
                "sourceThemeName": f"profile:{profile_id}",
                "createdAt": now,
                "updatedAt": now,
            }
            self._drafts[draft_id] = record
            self._current_id = draft_id
            draft = self._public(record)
            return {
                **draft,
                "draft": draft,
                "imported": True,
                "committed": True,
                "profile": profile,
                "themeSelector": record["sourceThemeName"],
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
            if self._persist_timer is not None:
                self._persist_timer.cancel()
                self._persist_timer = None
            self._drafts.clear()
            self._current_id = None
            self._pending_persist_keys.clear()


style_draft_service = StyleDraftService()
