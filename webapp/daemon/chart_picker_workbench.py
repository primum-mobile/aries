# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Daemon-owned collection workbench preferences; result rows stay in memory."""

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class PlacementState(BaseModel):
    objectIds: list[str] = []
    signIndices: list[str] = []
    degree: str = ""
    degreeOrb: str = "1"
    houseNumbers: list[str] = []
    motion: str = ""
    motions: list[str] | None = None
    exclude: bool = False


class AspectState(BaseModel):
    objectAIds: list[str] = []
    aspectType: str = "-1"
    aspectTypes: list[str] | None = None
    objectBIds: list[str] = []
    orb: str = "1"
    exclude: bool = False


class SortState(BaseModel):
    column: str
    ascending: bool


class WorkbenchState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    view: Literal["list", "search"] = "list"
    filter: str = ""
    listSort: SortState = Field(default_factory=lambda: SortState(column="lastOpened", ascending=False))
    collectionPaths: list[str] | None = None
    collectionDrawerOpen: bool = False
    stationWindowDays: str = "2"
    placements: list[PlacementState] = Field(default_factory=lambda: [PlacementState()])
    aspects: list[AspectState] = Field(default_factory=lambda: [AspectState()])
    includeAsteroids: bool = False
    searchSort: SortState | None = None
    placementDrawerOpen: bool = True
    aspectDrawerOpen: bool = True


class ChartPickerWorkbenchStore:
    def __init__(self, path_provider):
        self._path_provider = path_provider
        self._state = None
        self._lock = threading.RLock()

    def get(self):
        with self._lock:
            if self._state is None:
                try:
                    self._state = WorkbenchState.model_validate_json(Path(self._path_provider()).read_text())
                except (OSError, ValidationError):
                    self._state = WorkbenchState()
            state = self._state.model_dump(exclude_none=True)
            state.setdefault("collectionPaths", None)
            state.setdefault("searchSort", None)
            return state

    def update(self, patch):
        with self._lock:
            next_state = WorkbenchState.model_validate(self.get() | patch)
            path = Path(self._path_provider())
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump(next_state.model_dump(exclude_none=True), stream, ensure_ascii=False)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            self._state = next_state
            return self.get()
