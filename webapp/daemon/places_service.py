# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Saved-places database service — the wx-free twin of placesdlg.PlacesDlg.

Wraps the existing placedb.PlaceDB brain (placedb.py — pure os/pickle, no wx)
that persists to the Aries app-support store (with a one-time copy from the
legacy Morinus placedb.dat, factory fallback Res/placedb.dat). No second layer:
every mutation is read -> mutate -> sort -> write through PlaceDB itself, so
the wx semantics survive verbatim:

  * dedup-by-name happens on READ, first occurrence wins (placedb.py:57-66);
    appending an existing name is therefore a round-trip no-op, exactly as
    placesdlg's OnAdd + reload behaves.
  * the list is alphabetically sorted on write (PlaceDB.sort, placedb.py:100).

Row strings are stored in the wx display format ("13E24", "52N31", "+1:00",
"34") produced by placesdlg._addGeoPlace (placesdlg.py:274-308); picking a row
back into a form re-parses them the way personaldatadlg.onManagePlaces
(personaldatadlg.py:541-590) / defaultlocdlg.onManagePlaces (defaultlocdlg.py:
264-330) do — that split lives HERE so the React skin only assigns fields.
"""
from __future__ import annotations

import threading

import placedb


class PlacesService:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    # -- formatting (placesdlg._addGeoPlace, placesdlg.py:274-308) ----------

    @staticmethod
    def _format_lonlat(deg: int, minute: int, positive: bool, pos_ch: str, neg_ch: str) -> str:
        return str(int(deg)).zfill(2) + (pos_ch if positive else neg_ch) + str(int(minute)).zfill(2)

    @staticmethod
    def _format_zone(plus: bool, zhour: int, zminute: int) -> str:
        # placesdlg._format_zone (placesdlg.py:334-340) renders '+H:MM'.
        return '%s%d:%02d' % ('+' if plus else '-', int(zhour), int(zminute))

    # -- parsing (personaldatadlg.onManagePlaces, personaldatadlg.py:541-590)

    @staticmethod
    def _parse_lonlat(text: str, pos_ch: str, neg_ch: str) -> tuple[int, int, bool]:
        idx = text.find(pos_ch)
        positive = idx != -1
        if idx == -1:
            idx = text.find(neg_ch)
        if idx == -1:
            return 0, 0, True
        try:
            deg = int(text[:idx])
            minute = int(text[idx + 1:])
        except ValueError:
            return 0, 0, positive
        return deg, minute, positive

    @staticmethod
    def _parse_zone(text: str) -> tuple[bool, int, int]:
        text = (text or '').strip()
        if not text:
            return True, 0, 0
        plus = text[0] != '-'
        body = text[1:] if text[0] in '+-' else text
        idx = body.find(':')
        try:
            if idx == -1:
                return plus, int(body or 0), 0
            return plus, int(body[:idx] or 0), int(body[idx + 1:] or 0)
        except ValueError:
            return True, 0, 0

    def _row_payload(self, rec) -> dict:
        lon_deg, lon_min, east = self._parse_lonlat(rec.lon, 'E', 'W')
        lat_deg, lat_min, north = self._parse_lonlat(rec.lat, 'N', 'S')
        plus, zhour, zminute = self._parse_zone(rec.tz)
        try:
            altitude = max(int(rec.alt), 0)
        except (TypeError, ValueError):
            altitude = 0
        return {
            # Raw stored strings — the wx list columns (Place/Long/Lat/Zone/Alt).
            "name": rec.name,
            "lon": rec.lon,
            "lat": rec.lat,
            "zone": rec.tz,
            "alt": rec.alt,
            # PlaceCandidate-shaped fields so picking a saved place assigns the
            # same form fields a resolve-place candidate does. tzid is NOT
            # stored in placedb.dat — wx clears the cached tzid on pick
            # (personaldatadlg.py:541 _clear_cached_tzid_for_place_change) and
            # re-runs auto-TZ; the empty string mirrors that.
            "lonDeg": lon_deg,
            "lonMin": lon_min,
            "east": east,
            "latDeg": lat_deg,
            "latMin": lat_min,
            "north": north,
            "altitude": altitude,
            "plus": plus,
            "zoneHour": zhour,
            "zoneMin": zminute,
            "tzid": "",
            "label": rec.name,
            "countryCode": "",
            "countryName": "",
        }

    # -- CRUD ----------------------------------------------------------------

    def list_places(self) -> dict:
        with self._lock:
            pdb = placedb.PlaceDB()
            pdb.read()
            return {"places": [self._row_payload(rec) for rec in pdb.placedb]}

    def add_place(self, candidate: dict) -> dict:
        """Append a form-shaped place (resolve-place candidate fields), then
        sort + write — placesdlg OnAdd + save (placesdlg.py:83,139). Dedup is
        the wx read-side rule: an existing name survives, the duplicate is
        dropped on the next read."""
        name = str(candidate.get("name", "") or "").strip()[:20]
        if not name:
            raise ValueError("place name is required")
        lontxt = self._format_lonlat(
            candidate.get("lonDeg", 0), candidate.get("lonMin", 0),
            bool(candidate.get("east", True)), 'E', 'W')
        lattxt = self._format_lonlat(
            candidate.get("latDeg", 0), candidate.get("latMin", 0),
            bool(candidate.get("north", True)), 'N', 'S')
        zonetxt = self._format_zone(
            bool(candidate.get("plus", True)),
            candidate.get("zoneHour", 0), candidate.get("zoneMin", 0))
        try:
            alt = max(int(candidate.get("altitude", 0) or 0), 0)
        except (TypeError, ValueError):
            alt = 0
        with self._lock:
            pdb = placedb.PlaceDB()
            pdb.read()
            pdb.add(name, lontxt, lattxt, zonetxt, str(alt))
            pdb.sort()
            pdb.write()
        return self.list_places()

    def remove_place(self, name: str) -> dict:
        """Drop a row by name (the read-side dedup key) — placesdlg OnRemove
        (placesdlg.py:98) followed by the dialog's save/rewrite."""
        name = str(name or '')
        with self._lock:
            pdb = placedb.PlaceDB()
            pdb.read()
            pdb.placedb = [rec for rec in pdb.placedb if rec.name != name]
            pdb.sort()
            pdb.write()
        return self.list_places()

    def remove_all(self) -> dict:
        """placesdlg OnRemoveAll (placesdlg.py:118) + save."""
        with self._lock:
            pdb = placedb.PlaceDB()
            pdb.write()  # empty list -> empty file
        return {"places": []}


places_service = PlacesService()
