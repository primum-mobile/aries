# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import json

import pytest

from webapp.daemon.chart_event_clipboard import (
    CLIPBOARD_MAGIC,
    clipboard_looks_like_events,
    format_clipboard_payload,
    parse_clipboard_text,
)


def test_round_trip_single_event():
    events = [{"v": 1, "name": "Transit today", "nodes": [{"label": "Transit today", "feature": "transits"}],
               "tagNames": ["work"], "notes": "Remember this"}]
    text = format_clipboard_payload(events)
    assert text.startswith(CLIPBOARD_MAGIC + "\n")
    parsed = parse_clipboard_text(text)
    assert parsed == [{"name": "Transit today", "nodes": events[0]["nodes"],
                       "tagNames": ["work"], "notes": "Remember this"}]


def test_reject_zet_like_text():
    zet_line = "Sample;01.01.2020;12:00:00;+3;London;51N30;00W07"
    assert not clipboard_looks_like_events(zet_line)


def test_reject_invalid_json():
    text = CLIPBOARD_MAGIC + "\n{not json"
    with pytest.raises(ValueError, match="Invalid JSON"):
        parse_clipboard_text(text)


def test_reject_empty_events():
    text = CLIPBOARD_MAGIC + "\n" + json.dumps({"v": 1, "events": []})
    with pytest.raises(ValueError, match="No events"):
        parse_clipboard_text(text)
