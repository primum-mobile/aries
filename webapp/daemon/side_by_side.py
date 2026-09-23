# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Workspace presentation only: two independently selected chart documents."""
from dataclasses import dataclass, field


@dataclass
class SideBySideView:
    enabled: bool = False
    left: str | None = None
    right: str | None = None
    active_side: str = "left"
    revision: int = 0
    aspect_primary: str | None = None
    aspect_outer: str | None = None
    # Branch ring membership stays shared; isolating one tab is pane-local.
    single_chart_views: dict[str, bool] = field(default_factory=dict)

    def reconcile(self, eligible: list[str], active: str | None, *, activate: bool = False) -> None:
        before = (self.left, self.right)
        focused_was_empty = getattr(self, self.active_side) is None
        self.single_chart_views = {doc: single for doc, single in self.single_chart_views.items() if doc in eligible}
        for side in ("left", "right"):
            if getattr(self, side) not in eligible:
                setattr(self, side, None)
        if self.enabled and active in eligible:
            if focused_was_empty and active in (self.left, self.right):
                # A refresh still carries the previous document while an empty
                # pane has focus. Only an explicit open/activation fills it.
                if activate:
                    setattr(self, self.active_side, active)
            elif active == getattr(self, self.active_side):
                pass
            elif active == self.left:
                self.active_side = "left"
            elif active == self.right:
                self.active_side = "right"
            else:
                setattr(self, self.active_side, active)
        if before != (self.left, self.right):
            self.revision += 1

    def set_enabled(self, enabled: bool, eligible: list[str], active: str | None) -> None:
        self.enabled = enabled
        self.reconcile(eligible, active)
        if enabled:
            other = "right" if self.active_side == "left" else "left"
            if getattr(self, other) is None:
                setattr(self, other, next((doc for doc in eligible if doc != active), None))
        self.revision += 1

    def select(self, side: str, document_id: str, eligible: list[str]) -> None:
        if side not in ("left", "right") or document_id not in eligible:
            raise ValueError("invalid side-by-side chart selection")
        if getattr(self, side) != document_id:
            setattr(self, side, document_id)
            self.revision += 1
        self.active_side = side

    def focus(self, side: str) -> str | None:
        if side not in ("left", "right"):
            raise ValueError("invalid side-by-side focus")
        self.active_side = side
        return getattr(self, side)

    def contains(self, document_id: str | None) -> bool:
        return self.enabled and bool(document_id) and document_id in (self.left, self.right)

    def payload(self) -> dict:
        return {
            "enabled": self.enabled,
            "leftDocumentId": self.left,
            "rightDocumentId": self.right,
            "activeSide": self.active_side,
            "revision": self.revision,
        }
