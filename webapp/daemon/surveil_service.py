"""Surveil marks / studies brain (daemon-owned, wx-free).

Port of the desktop Surveil research-mark subsystem (``MorinApp`` methods at
``morin.py:1201-1700``). The desktop app keeps a per-study store of captured
zodiacal longitudes ("marks") on disk and renders enabled marks of the active
study as ticks/glyphs outside every chart wheel in the radix lineage.

This module owns ONLY the wx-free meaning:
  * the study store (load / normalize / persist / default),
  * active-study selection + CRUD over studies and their marks,
  * building a mark spec from a clicked chart region (label/longitude/glyph),
  * the active study's enabled marks for the renderer feed.

It holds NO wx and NO chart-render state. The desktop ``drawSurveilMarks``
fan-out / render-cache invalidation (morin.py:1619-1641) is superseded: the
React context-menu + studies dialog re-fetch the chart snapshot after every
mutation, and the active study's marks are re-injected on every snapshot build,
so a fresh GET always reflects the store (see ``doc/migration/wiring/surveil.md``).

Persistence note: the desktop pickles the store; this daemon writes JSON. The
schema is plain dict/list/str/float/bool (lossless to JSON), and the daemon must
not unpickle app-support files it did not write. No behaviour change.
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
from typing import Any, Optional

import app_paths
import chart  # chart.Chart.SIGN_DEG — zodiac sign width (morin.py:1531)
import common  # planet glyphs/names, Lot of Fortune glyph, house names
import mtexts  # localized sign names (morin.py:1543)

# Constants — morin.py:1201-1206.
SURVEIL_EPSILON_DEG = 0.05  # tolerance for "same zodiacal point"
SURVEIL_DEFAULT_STUDY = "Study"
SURVEILABLE_KINDS = frozenset(("planet", "fortune", "syzygy", "angle", "secondary_ring", "house"))

_SIGN_KEYS = (
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
)
_ANGLE_NAMES = ("Asc", "MC", "Dsc", "IC")


class SurveilStudyStore:
    """Disk-backed study store. Thread-safe; mirrors morin.py:1208-1617."""

    def __init__(self, opts_dir_provider):
        # opts_dir_provider() -> directory path; defers to options_service so the
        # store lands next to the application options store.
        self._opts_dir_provider = opts_dir_provider
        self._lock = threading.RLock()
        self._store: Optional[dict] = None

    # -- path / load / persist (morin.py:1208-1293) ------------------------

    def _store_path(self) -> str:
        opts_dir = None
        try:
            opts_dir = self._opts_dir_provider()
        except Exception:
            opts_dir = None
        if not opts_dir:
            opts_dir = app_paths.user_opts_dir()
        # Separate filename from the desktop store (surveil_studies.opt, which is
        # a PICKLE the wx app still owns). The webapp writes JSON; reusing the
        # .opt name would (a) fail to read the desktop's pickle, then (b) clobber
        # it with JSON the desktop can't unpickle. Distinct file => no cross-app
        # corruption. Both apps are independent today; a future unifier can seed
        # one from the other deliberately.
        return os.path.join(opts_dir, "surveil_studies.json")

    @staticmethod
    def _default_store() -> dict:
        return {"active_study": SURVEIL_DEFAULT_STUDY, "studies": {SURVEIL_DEFAULT_STUDY: []}}

    def _load(self) -> dict:
        if self._store is not None:
            return self._store
        raw: Any = None
        path = self._store_path()
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception:
            raw = self._default_store()
        self._store = self._normalize(raw)
        return self._store

    def _persist(self) -> None:
        store = self._store if isinstance(self._store, dict) else self._default_store()
        store = self._normalize(store)
        self._store = store
        try:
            os.makedirs(os.path.dirname(self._store_path()), exist_ok=True)
            with open(self._store_path(), "w", encoding="utf-8") as f:
                json.dump(store, f, ensure_ascii=False)
        except Exception:
            pass

    # -- normalize (morin.py:1217-1262) ------------------------------------

    @staticmethod
    def _mark_id(mark: dict, index: int = 0) -> str:
        try:
            lon = round(float(mark.get("longitude")) % 360.0, 5)
        except Exception:
            lon = 0.0
        return "%s:%s:%s" % (mark.get("source_kind") or "point", mark.get("source_id") or index, lon)

    def _normalize(self, data: Any) -> dict:
        if not isinstance(data, dict):
            data = {}
        studies_in = data.get("studies")
        if not isinstance(studies_in, dict):
            legacy = data.get("marks")
            studies_in = {SURVEIL_DEFAULT_STUDY: legacy if isinstance(legacy, list) else []}
        studies: dict[str, list] = {}
        for name, marks in studies_in.items():
            name = str(name or SURVEIL_DEFAULT_STUDY).strip() or SURVEIL_DEFAULT_STUDY
            clean: list[dict] = []
            if isinstance(marks, list):
                for mark in marks:
                    if not isinstance(mark, dict):
                        continue
                    try:
                        lon = float(mark.get("longitude")) % 360.0
                    except (TypeError, ValueError):
                        continue
                    if not math.isfinite(lon):
                        continue
                    clean.append({
                        "id": str(mark.get("id") or self._mark_id(mark, len(clean))),
                        "longitude": lon,
                        "label": str(mark.get("label") or format_zodiac_position(lon)),
                        "source_name": str(mark.get("source_name") or mark.get("radix_name") or ""),
                        "source_ref": dict(mark.get("source_ref") or {}) if isinstance(mark.get("source_ref"), dict) else {},
                        "source_kind": mark.get("source_kind"),
                        "source_id": mark.get("source_id"),
                        "glyph": str(mark.get("glyph") or ""),
                        "glyph_font": str(mark.get("glyph_font") or "text"),
                        "enabled": bool(mark.get("enabled", True)),
                    })
            studies[name] = clean
        if SURVEIL_DEFAULT_STUDY not in studies:
            studies[SURVEIL_DEFAULT_STUDY] = []
        active = str(data.get("active_study") or SURVEIL_DEFAULT_STUDY).strip() or SURVEIL_DEFAULT_STUDY
        if active not in studies:
            active = SURVEIL_DEFAULT_STUDY
        return {"active_study": active, "studies": studies}

    # -- active study (morin.py:1295-1305) ---------------------------------

    def active_study_name(self) -> str:
        with self._lock:
            store = self._load()
            name = store.get("active_study") or SURVEIL_DEFAULT_STUDY
            if name not in store["studies"]:
                name = SURVEIL_DEFAULT_STUDY
                store["active_study"] = name
            return name

    def active_study_marks(self) -> list[dict]:
        with self._lock:
            store = self._load()
            return store["studies"].setdefault(self.active_study_name(), [])

    def enabled_marks_for_active_study(self) -> list[dict]:
        """The active study's enabled marks, shallow-copied for the renderer
        feed (morin.py:1303-1305 + the active-study render path)."""
        with self._lock:
            return [dict(m) for m in self.active_study_marks() if isinstance(m, dict) and m.get("enabled", True)]

    def has_any_marks(self) -> bool:
        """True when ANY study holds at least one mark (morin.py:1087/1548-1559)."""
        with self._lock:
            store = self._load()
            for study_marks in store.get("studies", {}).values():
                if isinstance(study_marks, list) and study_marks:
                    return True
            return False

    # -- mark predicates (morin.py:1347-1572) ------------------------------

    @staticmethod
    def _angle_diff(a: float, b: float) -> float:
        return abs((a - b + 180.0) % 360.0 - 180.0)

    def mark_exists(self, longitude: float) -> bool:
        with self._lock:
            for mark in self.active_study_marks():
                try:
                    if self._angle_diff(float(mark.get("longitude", 0.0)), longitude) <= SURVEIL_EPSILON_DEG:
                        return True
                except (TypeError, ValueError):
                    continue
            return False

    # -- mutations (morin.py:1574-1617) ------------------------------------

    def toggle_mark(self, spec: dict) -> dict:
        """Toggle a mark at spec['longitude'] in the active study (epsilon
        dedupe). Port of _toggle_surveil_mark (morin.py:1574-1607)."""
        if not isinstance(spec, dict):
            return {"ok": False}
        with self._lock:
            store = self._load()
            name = self.active_study_name()
            target = float(spec["longitude"]) % 360.0
            kept: list[dict] = []
            removed = False
            for mark in store["studies"].setdefault(name, []):
                try:
                    diff = self._angle_diff(float(mark.get("longitude", 0.0)), target)
                except (TypeError, ValueError):
                    continue
                if diff <= SURVEIL_EPSILON_DEG:
                    removed = True
                    continue
                kept.append(mark)
            if not removed:
                kept.append({
                    "id": "%s:%d" % (int(time.time() * 1000), len(kept)),
                    "longitude": target,
                    "label": spec.get("label", ""),
                    "source_name": spec.get("source_name", ""),
                    "source_ref": dict(spec.get("source_ref") or {}) if isinstance(spec.get("source_ref"), dict) else {},
                    "source_kind": spec.get("source_kind"),
                    "source_id": spec.get("source_id"),
                    "glyph": spec.get("glyph", ""),
                    "glyph_font": spec.get("glyph_font", "text"),
                    "enabled": True,
                })
            store["studies"][name] = kept
            self._persist()
            return {"ok": True, "added": not removed}

    def clear_active_study(self) -> dict:
        with self._lock:
            store = self._load()
            name = self.active_study_name()
            if not store["studies"].get(name):
                return {"ok": True, "changed": False}
            store["studies"][name] = []
            self._persist()
            return {"ok": True, "changed": True}

    # -- studies CRUD (the dialog meaning, morin.py:1702-1834) -------------

    def list_studies(self) -> dict:
        with self._lock:
            store = self._load()
            studies = []
            for name, marks in store["studies"].items():
                studies.append({
                    "name": name,
                    "count": len(marks),
                    "enabledCount": sum(1 for m in marks if isinstance(m, dict) and m.get("enabled", True)),
                })
            return {"activeStudy": self.active_study_name(), "studies": studies}

    def study_marks(self, name: str) -> list[dict]:
        with self._lock:
            store = self._load()
            name = str(name or self.active_study_name()).strip() or SURVEIL_DEFAULT_STUDY
            marks = store["studies"].get(name, [])
            out = []
            for mark in marks:
                if not isinstance(mark, dict):
                    continue
                out.append({
                    "id": mark.get("id"),
                    "longitude": mark.get("longitude"),
                    "label": mark.get("label"),
                    "displayLabel": mark_display_label(mark),
                    "glyph": mark.get("glyph"),
                    "glyphFont": "morinus" if mark.get("glyph_font") == "morinus" else "text",
                    "sourceName": mark.get("source_name") or "",
                    "sourceRef": mark.get("source_ref") or {},
                    "enabled": bool(mark.get("enabled", True)),
                })
            return out

    def create_study(self, name: str) -> dict:
        name = str(name or "").strip()
        if not name:
            return {"ok": False, "error": "empty name"}
        with self._lock:
            store = self._load()
            store["studies"].setdefault(name, [])
            store["active_study"] = name
            self._persist()
            return {"ok": True}

    def set_active_study(self, name: str) -> dict:
        name = str(name or "").strip()
        with self._lock:
            store = self._load()
            if name and name in store["studies"]:
                store["active_study"] = name
                self._persist()
                return {"ok": True}
            return {"ok": False, "error": "unknown study"}

    def set_mark_enabled(self, study: str, mark_id: str, enabled: bool) -> dict:
        with self._lock:
            store = self._load()
            name = str(study or self.active_study_name()).strip() or SURVEIL_DEFAULT_STUDY
            for mark in store["studies"].get(name, []):
                if isinstance(mark, dict) and str(mark.get("id")) == str(mark_id):
                    mark["enabled"] = bool(enabled)
                    self._persist()
                    return {"ok": True}
            return {"ok": False, "error": "unknown mark"}

    def remove_mark(self, study: str, mark_id: str) -> dict:
        with self._lock:
            store = self._load()
            name = str(study or self.active_study_name()).strip() or SURVEIL_DEFAULT_STUDY
            marks = store["studies"].get(name, [])
            kept = [m for m in marks if not (isinstance(m, dict) and str(m.get("id")) == str(mark_id))]
            if len(kept) == len(marks):
                return {"ok": True, "changed": False}
            store["studies"][name] = kept
            self._persist()
            return {"ok": True, "changed": True}

    def clear_study(self, name: str) -> dict:
        with self._lock:
            store = self._load()
            name = str(name or self.active_study_name()).strip() or SURVEIL_DEFAULT_STUDY
            if not store["studies"].get(name):
                return {"ok": True, "changed": False}
            store["studies"][name] = []
            self._persist()
            return {"ok": True, "changed": True}


# -- pure formatters (module-level; morin.py glyph/label/source helpers) ----

def format_zodiac_position(longitude) -> str:
    """"12° Leo 34'" — port of _format_zodiac_position (morin.py:1526-1546)."""
    try:
        lon = float(longitude) % 360.0
    except (TypeError, ValueError):
        return ""
    sign_idx = int(lon // chart.Chart.SIGN_DEG)
    deg_in_sign = lon - sign_idx * chart.Chart.SIGN_DEG
    deg = int(deg_in_sign)
    minute = int(round((deg_in_sign - deg) * 60.0))
    if minute == 60:
        minute = 0
        deg += 1
    try:
        sign_name = mtexts.txts.get(_SIGN_KEYS[sign_idx], _SIGN_KEYS[sign_idx])
    except Exception:
        sign_name = ""
    return "%d° %s %02d'" % (deg, sign_name, minute)


def mark_display_label(mark: dict) -> str:
    """Studies-dialog row label — port of _surveil_mark_display_label
    (morin.py:1647-1658)."""
    label = str(mark.get("label") or "")
    source = str(mark.get("source_name") or "").strip()
    try:
        pos = format_zodiac_position(float(mark.get("longitude")))
    except Exception:
        pos = ""
    if pos and pos not in label:
        label = "%s - %s" % (label, pos) if label else pos
    if source:
        label = "%s (%s)" % (label, source) if label else source
    return label or pos or "Point"


def glyph_for_spec(kind, object_id, data=None):
    """(glyph, glyph_font) for a surveilable point — port of
    _surveil_glyph_for_spec (morin.py:1429-1450)."""
    if kind == "planet":
        try:
            return common.common.get_planet_glyph(int(object_id)), "morinus"
        except Exception:
            return "", "text"
    if kind == "fortune":
        return common.common.fortune, "morinus"
    if kind == "syzygy":
        return "Sy", "text"
    if kind == "angle":
        angle_names = {"asc": "Asc", "desc": "Dsc", "dsc": "Dsc", "mc": "MC", "ic": "IC"}
        key = str(object_id or "").lower()
        return angle_names.get(key, str(object_id or "Angle")), "text"
    if kind == "house":
        try:
            idx = max(1, min(12, int(object_id)))
            return common.common.Housenames[idx - 1], "text"
        except Exception:
            return "H", "text"
    if kind == "secondary_ring" and isinstance(data, dict):
        glyph = data.get("glyph") or data.get("short_label")
        if glyph:
            return str(glyph), "text"
    return "", "text"


def label_for_kind(kind, object_id, longitude, fallback_label="") -> str:
    """Zodiac label for a surveilable point — port of _surveil_label_for_region
    (morin.py:1493-1524), adapted to take primitives instead of a wx region."""
    pos_txt = format_zodiac_position(longitude)
    if kind == "planet":
        try:
            name = common.common.get_planet_name(int(object_id))
        except Exception:
            name = "Planet"
        return "%s (%s)" % (name, pos_txt)
    if kind == "fortune":
        return "%s (%s)" % (mtexts.txts.get("SurveilLotOfFortune", "Lot of Fortune"), pos_txt)
    if kind == "syzygy":
        return "%s (%s)" % (mtexts.txts.get("PrenatalSyzygy", "Prenatal Syzygy"), pos_txt)
    if kind == "angle":
        idx_map = {"asc": 0, "mc": 1, "dsc": 2, "desc": 2, "ic": 3}
        key = str(object_id or "").lower()
        idx = idx_map.get(key)
        name = _ANGLE_NAMES[idx] if idx is not None else "Angle"
        return "%s (%s)" % (name, pos_txt)
    if kind == "house":
        try:
            house_label = mtexts.txts.get("SurveilHouseCuspN", "House %d cusp") % int(object_id)
            return "%s (%s)" % (house_label, pos_txt)
        except Exception:
            return "%s (%s)" % (mtexts.txts.get("SurveilHouseCusp", "House cusp"), pos_txt)
    if kind == "secondary_ring":
        title = (fallback_label or "").strip()
        if title:
            return "%s (%s)" % (title, pos_txt)
        return pos_txt
    return pos_txt
