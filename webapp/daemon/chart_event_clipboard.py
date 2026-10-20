# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Portable ASCII clipboard format for saved chart events (# ARIES_EVENT)."""
from __future__ import annotations

import json

CLIPBOARD_MAGIC = "# ARIES_EVENT 1"


def _normalize_text(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def format_clipboard_payload(events: list) -> str:
    payload = {"v": 1, "events": events}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return f"{CLIPBOARD_MAGIC}\n{body}"


def clipboard_looks_like_events(text: str) -> bool:
    try:
        parse_clipboard_text(text)
        return True
    except ValueError:
        return False


def parse_clipboard_text(text: str) -> list:
    raw = _normalize_text(text)
    if not raw.startswith(CLIPBOARD_MAGIC):
        raise ValueError("Not an Aries events clipboard")
    body = raw[len(CLIPBOARD_MAGIC) :].lstrip("\n")
    if not body:
        raise ValueError("Missing payload")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid JSON") from exc
    if not isinstance(data, dict) or int(data.get("v") or 0) != 1:
        raise ValueError("Unsupported version")
    events = data.get("events")
    if not isinstance(events, list) or not events:
        raise ValueError("No events")
    out = []
    for item in events:
        if not isinstance(item, dict):
            raise ValueError("Invalid event")
        name = item.get("name")
        nodes = item.get("nodes")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Event name required")
        if not isinstance(nodes, list) or not nodes:
            raise ValueError("Event nodes required")
        ev = {"name": name.strip(), "nodes": nodes}
        tag_names = item.get("tagNames")
        if tag_names is not None:
            if not isinstance(tag_names, list):
                raise ValueError("Invalid tagNames")
            ev["tagNames"] = [str(tag) for tag in tag_names]
        if "notes" in item:
            ev["notes"] = str(item.get("notes") or "")
        out.append(ev)
    return out
