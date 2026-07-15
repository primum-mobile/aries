# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import datetime
import re
from pathlib import Path
from typing import Any

import astrology
import chartcollectionsearchbackend
import chartcollectionsearchquery
import chartfile
import common
import note_storage
import searchcatalog
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.frontend.scripts import export_chart_json


class ChartPickerService:
    """File-backed chart picker rows and mutations.

    Mirrors macfiledialog.HoroscopeChoiceDialog: rows are JSONL records from the
    Hors directory, addressed by collection path + record index. The React/Tauri
    picker is only the window skin; parsing, rename, and delete stay here.
    """

    columns = [
        "Name",
        "Birth Date",
        "Time",
        "Type",
        "Location",
        "Gender",
        "Collection",
        "Modified",
        "Last Opened",
    ]

    def rows(self) -> dict[str, Any]:
        rows, _infos = self._rows_and_infos()
        return {
            "directory": str(self._hors_dir()),
            "columns": self.columns,
            "defaultSort": {"column": "lastOpened", "ascending": False},
            "rows": rows,
        }

    def search_catalog(self) -> dict[str, Any]:
        return {
            "objects": self._choices(chartcollectionsearchbackend.OBJECT_CHOICES),
            "signs": self._choices(
                (("", "Any"),)
                + tuple(
                    (str(idx), label)
                    for idx, label in chartcollectionsearchbackend.SIGN_CHOICES
                )
            ),
            "houses": self._choices(
                (("", "Any"),) + tuple((str(idx), str(idx)) for idx in range(1, 13))
            ),
            "motions": self._choices(
                (
                    ("", "Any"),
                    (chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_DIRECT, "Direct"),
                    (chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_RETROGRADE, "Retrograde"),
                    (
                        chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_DIRECT,
                        "Station direct",
                    ),
                    (
                        chartcollectionsearchquery.ChartCollectionSearchQuery.MOTION_STATION_RETROGRADE,
                        "Station retrograde",
                    ),
                )
            ),
            "aspects": self._choices(
                ((str(-1), "Any"),)
                + tuple(
                    (str(idx), label)
                    for idx, label in chartcollectionsearchbackend.ASPECT_CHOICES
                )
            ),
            "defaultStationWindowDays": chartcollectionsearchquery.ChartCollectionSearchQuery.DEFAULT_STATION_WINDOW_DAYS,
        }

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        _rows, chart_infos = self._rows_and_infos()
        query = self._build_search_query(payload)
        if not query.is_active():
            raise ValueError("set at least one placement or aspect")
        results, summary = chartcollectionsearchbackend.search_chart_infos(
            chart_infos,
            chart_snapshot_service.options,
            query,
            limit=1000,
        )
        return {
            "summary": {
                "scanned": summary.scanned,
                "matched": summary.matched,
                "errors": summary.errors,
                "truncated": summary.truncated,
            },
            "columns": ["Name", "Date", "Time", "Type", "Collection", "Place", "Matches"],
            "rows": [
                {
                    "key": f"{result.path}:{result.record_index}:{result.name}",
                    "source": result.path,
                    "recordIndex": result.record_index,
                    "name": result.name,
                    "date": result.date,
                    "time": result.time,
                    "type": result.type,
                    "collection": result.collection,
                    "place": result.place,
                    "matches": result.matches_text(),
                    "matchRuns": _match_runs(result.matches, chart_snapshot_service.options),
                    "matchSortValue": _first_match_longitude_sort(result.matches),
                }
                for result in results
            ],
        }

    def _rows_and_infos(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        rows: list[dict[str, Any]] = []
        infos: list[dict[str, Any]] = []
        recent = self._recent_opened_map()
        for path in self._collection_paths():
            collection_name = path.stem
            try:
                records = chartfile.read_jsonl(str(path))
            except Exception:
                continue
            for record_index, record in enumerate(records):
                chart_id = record.get("id", "")
                row = {
                    "key": f"{path}:{record_index}:{chart_id or record.get('name', '')}",
                    "source": str(path),
                    "recordIndex": record_index,
                    "chartId": chart_id,
                    "name": record.get("name", f"Chart {record_index + 1}"),
                    "date": record.get("date", ""),
                    "time": record.get("time", ""),
                    "type": str(record.get("type", "radix") or "radix").capitalize(),
                    "place": record.get("place", ""),
                    "gender": self._gender_label(record),
                    "collection": collection_name,
                    "modified": self._format_modified(record.get("modified_at", "")),
                    "lastOpened": self._last_opened_for_chart(
                        recent, str(path), chart_id=chart_id, record=record
                    ),
                    "recentRank": self._recent_rank_for_chart(
                        recent, str(path), chart_id=chart_id, record=record
                    ),
                }
                rows.append(row)
                infos.append({
                    "name": row["name"],
                    "date": row["date"],
                    "time": row["time"],
                    "type": row["type"],
                    "place": row["place"],
                    "collection": row["collection"],
                    "path": (str(path), record_index),
                    "record": record,
                })
        return rows, infos

    def rename(self, *, source: str, record_index: int, name: str) -> dict[str, Any]:
        new_name = name.strip()
        if not new_name:
            raise ValueError("name is required")
        path = self._safe_collection_path(source)
        records = chartfile.read_jsonl(str(path))
        if not 0 <= record_index < len(records):
            raise ValueError("record index out of range")
        records[record_index]["name"] = new_name
        records[record_index]["modified_at"] = self._timestamp()
        chartfile.write_jsonl(records, str(path))
        return {"ok": True, "rows": self.rows()["rows"]}

    def delete(self, selections: list[dict[str, Any]]) -> dict[str, Any]:
        grouped: dict[Path, set[int]] = {}
        for selection in selections:
            source = str(selection.get("source", ""))
            try:
                record_index = int(selection.get("recordIndex"))
            except (TypeError, ValueError):
                continue
            path = self._safe_collection_path(source)
            grouped.setdefault(path, set()).add(record_index)
        if not grouped:
            raise ValueError("no deletable chart records selected")

        deleted = 0
        for path, indices in grouped.items():
            records = chartfile.read_jsonl(str(path))
            for record_index in sorted(indices, reverse=True):
                if 0 <= record_index < len(records):
                    del records[record_index]
                    deleted += 1
            if records:
                chartfile.write_jsonl(records, str(path))
            else:
                path.unlink(missing_ok=True)
        return {"ok": True, "deleted": deleted, "rows": self.rows()["rows"]}

    def _collection_paths(self) -> list[Path]:
        hors_dir = self._hors_dir()
        seen: set[str] = set()
        out: list[Path] = []
        candidates: list[Path] = []
        if hors_dir.exists():
            candidates.extend(sorted(hors_dir.glob("*.jsonl")))
        if not candidates:
            candidates.append(Path(export_chart_json.DEFAULT_SOURCE).expanduser())
        for path in candidates:
            try:
                resolved = path.resolve()
            except Exception:
                resolved = path
            key = str(resolved)
            if key in seen or not path.exists():
                continue
            seen.add(key)
            out.append(path)
        return out

    def _hors_dir(self) -> Path:
        canonical = Path(note_storage.charts_directory()).expanduser()
        if canonical.is_dir():
            return canonical
        opts = chart_snapshot_service.options
        saved = Path(str(getattr(opts, "last_hor_dir", "") or "")).expanduser()
        if saved.is_dir():
            return saved
        return Path(export_chart_json.DEFAULT_SOURCE).expanduser().parent

    def _safe_collection_path(self, source: str) -> Path:
        path = Path(source).expanduser().resolve()
        default = Path(export_chart_json.DEFAULT_SOURCE).expanduser().resolve()
        hors_dir = self._hors_dir().resolve()
        if path.suffix.lower() != ".jsonl":
            raise ValueError("only JSONL chart collections are supported")
        if path != default and hors_dir not in path.parents:
            raise ValueError("chart collection is outside the Hors directory")
        if not path.exists():
            raise ValueError("chart collection does not exist")
        return path

    def _recent_opened_map(self) -> dict[str, dict[Any, Any]]:
        opts = chart_snapshot_service.options
        recent_refs = getattr(opts, "recent_chart_refs", []) or []
        by_chart_id: dict[tuple[str, str], str] = {}
        by_identity: dict[tuple[str, str, str, str, str], str] = {}
        rank_by_chart_id: dict[tuple[str, str], int] = {}
        rank_by_identity: dict[tuple[str, str, str, str, str], int] = {}
        for rank, ref in enumerate(recent_refs):
            if not isinstance(ref, dict):
                continue
            path = ref.get("path", "")
            last_opened = ref.get("last_opened", "")
            if not path or not last_opened:
                continue
            chart_id = ref.get("chart_id", "")
            if chart_id:
                by_chart_id[(path, chart_id)] = last_opened
                rank_by_chart_id[(path, chart_id)] = rank
            key = (
                path,
                ref.get("chart_name", ""),
                ref.get("chart_date", ""),
                ref.get("chart_time", ""),
                ref.get("chart_place", ""),
            )
            by_identity[key] = last_opened
            rank_by_identity[key] = rank
        return {
            "by_chart_id": by_chart_id,
            "by_identity": by_identity,
            "rank_by_chart_id": rank_by_chart_id,
            "rank_by_identity": rank_by_identity,
        }

    def _last_opened_for_chart(
        self,
        recent: dict[str, dict[Any, Any]],
        path: str,
        *,
        chart_id: str = "",
        record: dict[str, Any] | None = None,
    ) -> str:
        if chart_id:
            last_opened = recent["by_chart_id"].get((path, chart_id), "")
            if last_opened:
                return str(last_opened)
        record = record or {}
        key = (
            path,
            record.get("name", ""),
            record.get("date", ""),
            record.get("time", ""),
            record.get("place", ""),
        )
        return str(recent["by_identity"].get(key, ""))

    def _recent_rank_for_chart(
        self,
        recent: dict[str, dict[Any, Any]],
        path: str,
        *,
        chart_id: str = "",
        record: dict[str, Any] | None = None,
    ) -> int:
        missing_rank = 10**9
        if chart_id:
            rank = recent["rank_by_chart_id"].get((path, chart_id))
            if rank is not None:
                return int(rank)
        record = record or {}
        key = (
            path,
            record.get("name", ""),
            record.get("date", ""),
            record.get("time", ""),
            record.get("place", ""),
        )
        return int(recent["rank_by_identity"].get(key, missing_rank))

    def _format_modified(self, value: Any) -> str:
        text = str(value or "")
        if not text:
            return ""
        if "T" not in text:
            return text
        date_part, time_part = text.split("T", 1)
        return f"{date_part} {time_part[:5]}"

    def _gender_label(self, record: dict[str, Any]) -> str:
        if record.get("male") is True:
            return "Male"
        if record.get("male") is False:
            return "Female"
        return ""

    def _timestamp(self) -> str:
        return datetime.datetime.now().replace(microsecond=0).isoformat()

    def _build_search_query(self, payload: dict[str, Any]) -> chartcollectionsearchquery.ChartCollectionSearchQuery:
        query = chartcollectionsearchquery.ChartCollectionSearchQuery()
        query.station_window_days = self._float_value(
            payload.get("stationWindowDays"),
            query.DEFAULT_STATION_WINDOW_DAYS,
        )
        for raw in payload.get("placements", []) or []:
            if not isinstance(raw, dict):
                continue
            query.add_placement(
                chartcollectionsearchquery.PlacementClause(
                    object_ids=self._list_value(raw.get("objectIds")),
                    sign_indices=self._list_value(raw.get("signIndices")),
                    degree=raw.get("degree"),
                    degree_orb=raw.get("degreeOrb"),
                    house_numbers=self._list_value(raw.get("houseNumbers")),
                    motion=raw.get("motion") or "",
                )
            )
        for raw in payload.get("aspects", []) or []:
            if not isinstance(raw, dict):
                continue
            query.add_aspect(
                chartcollectionsearchquery.AspectClause(
                    object_a_ids=self._list_value(raw.get("objectAIds")),
                    aspect_type=raw.get("aspectType"),
                    object_b_ids=self._list_value(raw.get("objectBIds")),
                    orb=raw.get("orb", 1.0),
                )
            )
        return query

    def _choices(self, values: tuple[Any, ...]) -> list[dict[str, str]]:
        return [{"value": str(value), "label": str(label)} for value, label in values]

    def _list_value(self, value: Any) -> list[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return [value]

    def _float_value(self, value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default


_COMPACT_LONGITUDE_RE = re.compile(r"(\d{1,2})°(\d{2})\s+([^;,\s]+)")
_OBJECT_GLYPH_IDS = {
    "planet:sun": astrology.SE_SUN,
    "planet:moon": astrology.SE_MOON,
    "planet:mercury": astrology.SE_MERCURY,
    "planet:venus": astrology.SE_VENUS,
    "planet:mars": astrology.SE_MARS,
    "planet:jupiter": astrology.SE_JUPITER,
    "planet:saturn": astrology.SE_SATURN,
    "planet:uranus": astrology.SE_URANUS,
    "planet:neptune": astrology.SE_NEPTUNE,
    "planet:pluto": astrology.SE_PLUTO,
    "planet:chiron": astrology.SE_CHIRON,
}


def _first_match_longitude_sort(matches: list[str]) -> float | None:
    signs = {str(label): idx for idx, label in enumerate(searchcatalog.SIGNS)}
    for match in matches:
        found = _COMPACT_LONGITUDE_RE.search(str(match))
        if not found:
            continue
        sign_idx = signs.get(found.group(3))
        if sign_idx is None:
            continue
        try:
            deg = int(found.group(1))
            minute = int(found.group(2))
        except Exception:
            continue
        return sign_idx * 30.0 + deg + minute / 60.0
    return None


def _match_runs(matches: list[Any], options: Any) -> list[list[dict[str, str]]]:
    return [_match_run(str(match), options) for match in matches]


def _match_run(text: str, options: Any) -> list[dict[str, str]]:
    token_specs = _match_token_specs(options)
    runs: list[dict[str, str]] = []
    pos = 0
    while pos < len(text):
        best: tuple[int, int, Any, Any] | None = None
        for regex, build in token_specs:
            match = regex.search(text, pos)
            if match is None:
                continue
            start = match.start()
            length = match.end() - match.start()
            if best is None or start < best[0] or (start == best[0] and length > best[1]):
                best = (start, length, match, build)
        if best is None:
            _append_text_run(runs, text[pos:])
            break
        start, _length, match, build = best
        if start > pos:
            _append_text_run(runs, text[pos:start])
        built = build(match)
        if isinstance(built, list):
            runs.extend(built)
        else:
            runs.append(built)
        pos = match.end()
    return [run for run in runs if run.get("text")]


def _match_token_specs(options: Any) -> list[tuple[re.Pattern[str], Any]]:
    sign_labels = [str(label) for label in searchcatalog.SIGNS]
    sign_pattern = "|".join(re.escape(label) for label in sorted(sign_labels, key=len, reverse=True))

    object_tokens: dict[str, str] = {}
    for object_id, label in chartcollectionsearchbackend.OBJECT_CHOICES:
        glyph = ""
        if object_id in _OBJECT_GLYPH_IDS:
            glyph = common.common.get_planet_glyph(_OBJECT_GLYPH_IDS[object_id])
        elif object_id == "point:lof":
            glyph = common.common.fortune
        if glyph:
            object_tokens[str(label)] = glyph

    aspect_tokens: dict[str, str] = {}
    for aspect_id, label in chartcollectionsearchbackend.ASPECT_CHOICES:
        try:
            glyph, role = common.common.aspect_glyph(aspect_id)
        except Exception:
            glyph, role = "", "morinus"
        if glyph and role == "morinus":
            aspect_tokens[str(label).lower()] = glyph

    object_pattern = "|".join(re.escape(label) for label in sorted(object_tokens, key=len, reverse=True))
    aspect_pattern = "|".join(re.escape(label) for label in sorted(aspect_tokens, key=len, reverse=True))

    signs = common.common.Signs1 if getattr(options, "signs", True) else common.common.Signs2
    specs: list[tuple[re.Pattern[str], Any]] = []
    if sign_pattern:
        specs.append((
            re.compile(rf"(\d{{1,2}}°\d{{2}})\s+({sign_pattern})"),
            lambda match: [
                {"kind": "text", "text": match.group(1)},
                _sign_run(match.group(2), signs, options),
            ],
        ))
        specs.append((
            re.compile(rf"(?<![\w°])({sign_pattern})(?!\w)"),
            lambda match: _sign_run(match.group(1), signs, options),
        ))
    if object_pattern:
        specs.append((
            re.compile(rf"(?<!\w)({object_pattern})(?!\w)"),
            lambda match: {
                "kind": "glyph",
                "text": object_tokens.get(match.group(1), ""),
                "title": match.group(1),
            },
        ))
    if aspect_pattern:
        specs.append((
            re.compile(rf"(?<!\w)({aspect_pattern})(?!\w)"),
            lambda match: {
                "kind": "glyph",
                "text": aspect_tokens.get(match.group(1), ""),
                "title": match.group(1),
            },
        ))
    return specs


def _sign_run(label: str, signs: tuple[str, ...], options: Any) -> dict[str, str]:
    sign_index = {str(name): idx for idx, name in enumerate(searchcatalog.SIGNS)}.get(str(label))
    if sign_index is None:
        return {"kind": "text", "text": label}
    return {
        "kind": "glyph",
        "text": signs[sign_index],
        "title": label,
        "color": _rgb_css(common.get_sign_color(options, sign_index, force_element=True)),
    }


def _append_text_run(runs: list[dict[str, str]], text: str) -> None:
    if not text:
        return
    if runs and runs[-1].get("kind") == "text":
        runs[-1]["text"] = runs[-1].get("text", "") + text
        return
    runs.append({"kind": "text", "text": text})


def _rgb_css(value: Any) -> str:
    try:
        r, g, b = list(value)[:3]
        return "#%02x%02x%02x" % (
            max(0, min(255, int(r))),
            max(0, min(255, int(g))),
            max(0, min(255, int(b))),
        )
    except Exception:
        return ""


chart_picker_service = ChartPickerService()
