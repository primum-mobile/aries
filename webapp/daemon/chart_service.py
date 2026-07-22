# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import datetime
import copy
import json
import threading
import sys
from pathlib import Path
from typing import Any, Mapping, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import default_location as default_location_model
from engine import chart_factory, moment
from webapp.daemon.event_time import DefaultLocationClock
from webapp.frontend.scripts import export_chart_json


_PREVIEW_THEME_BY_VARIANT = {
    "round-classic": 0,
    "round-compact": 1,
    "round-anglo": 2,
}
_PREVIEW_MINOR_ASPECT_INDICES = (1, 2, 4, 7, 8, 9, 11)

_PREVIEW_OUTER_RING_BY_ID = {
    "none": export_chart_json.options.Options.NONE,
    "fixstars": export_chart_json.options.Options.FIXSTARS,
    "asteroids": export_chart_json.options.Options.ASTEROIDS,
    "midpoints": export_chart_json.options.Options.MIDPOINTS,
    "hybrid_hits": export_chart_json.options.Options.HYBRID_HITS,
    "dodecatemoria": export_chart_json.options.Options.DODECATEMORIA,
    "antiscia": export_chart_json.options.Options.ANTIS,
    "contra_antiscia": export_chart_json.options.Options.CANTIS,
    "arabic_parts": export_chart_json.options.Options.ARABICPARTS,
}
_PREVIEW_OUTER_RING_ID_BY_VALUE = {
    value: key for key, value in _PREVIEW_OUTER_RING_BY_ID.items()
}

# These are the visual/content switches that can safely be applied to the
# Style Lab's deep-copied Options instance. The public IDs deliberately differ
# from legacy Python attribute spellings; the latter stay an implementation
# detail of the preview resolver.
_PREVIEW_BOOLEAN_ATTRIBUTES = {
    "houses": "houses",
    "positions": "positions",
    "terms": "showterms",
    "decans": "showdecans",
    "aspects": "aspects",
    "aspectGlyphs": "symbols",
    "traditionalAspects": "traditionalaspects",
    "aspectThicknessMode": "aspect_thickness_mode",
    "aspectOpacityMode": "aspect_opacity_mode",
    "showChiron": "showchiron",
    "showNodes": "shownodes",
    "aspectsToNodes": "aspectstonodes",
    "showLotOfFortune": "showlof",
    "aspectsToLotOfFortune": "showaspectstolof",
    "showLotOfFortuneOuterRing": "showlofouterring",
    "showVertex": "showvertex",
    "aspectsToVertex": "showaspectstovertex",
    "showPrenatalSyzygy": "showprenatalsyzygy",
    "angleArrowheads": "showanglearrowheads",
    "cusplessAscMcLabels": "showcusplessascmclabels",
    "information": "information",
    "houseSystemLabel": "housesystem",
    "planetaryDayHour": "planetarydayhour",
    "seconds": "showseconds",
    "extendedStations": "extendedradixstations",
    "showCazimi": "showcazimi",
    "eclipseOverlay": "showeclipseoverlay",
    "fixedStarsToNodes": "showfixstarsnodes",
    "fixedStarsToIntermediateCusps": "showfixstarshcs",
    "fixedStarsToLotOfFortune": "showfixstarslof",
    "morinAntiscia": "morin_antiscia",
    "dignityBodyColors": "useplanetcolors",
    "zodiacElementColors": "usezodiacelementcolors",
    "dignityLabelColors": "dignitylabelcolors",
}

_PREVIEW_INTEGER_ATTRIBUTES = {
    "termSystem": ("selterm", (0, 1)),
    "decanSystem": ("seldecan", (0, 1)),
    "phasisMode": ("phasismode", (0, 1, 2)),
    "cazimiMode": ("cazimimode", (0, 1, 2)),
    "plutoGlyph": ("pluto", (0, 1, 2, 3)),
}

_PREVIEW_BOOLEAN_ENUM_ATTRIBUTES = {
    "uranusGlyph": "uranus",
    "signGlyphVariant": "signs",
}

_PREVIEW_FIELD_GROUPS = (
    {"id": "layout", "labelKey": "settings.chartLayout", "label": "Chart layout"},
    {"id": "content", "labelKey": "settings.display", "label": "Display"},
    {"id": "aspects", "labelKey": "settings.aspects", "label": "Aspects"},
    {"id": "outer", "labelKey": "settings.outerRing", "label": "Outer ring"},
    {"id": "points", "labelKey": "settings.bodiesAndPoints", "label": "Bodies and points"},
    {"id": "overlays", "labelKey": "settings.chartHeader", "label": "Chart header"},
    {"id": "symbols", "labelKey": "quickopt.symbols", "label": "Symbols"},
)

_PREVIEW_LABELS = {
    "variant": {"label": "Wheel style", "labelKey": "styleLab.variant.label"},
    "classic": {"label": "Classic", "labelKey": "styleLab.variant.classic"},
    "compact": {"label": "Compact", "labelKey": "styleLab.variant.compact"},
    "anglo": {"label": "Anglo", "labelKey": "styleLab.variant.anglo"},
    "mode": {"label": "Chart mode", "labelKey": "styleLab.mode.label"},
    "standard": {"label": "Standard", "labelKey": "quickopt.standard"},
    "minorAspects": {"label": "Show minor", "labelKey": "settings.showMinor"},
}

_PREVIEW_FIELD_DEFINITIONS = (
    {"id": "houses", "group": "content", "labelKey": "quickopt.houses", "label": "Houses"},
    {"id": "positions", "group": "content", "labelKey": "table.positions", "label": "Positions"},
    {"id": "terms", "group": "content", "labelKey": "quickopt.terms", "label": "Terms"},
    {"id": "decans", "group": "content", "labelKey": "quickopt.decans", "label": "Decans"},
    {"id": "aspects", "group": "aspects", "labelKey": "quickopt.aspects", "label": "Aspects"},
    {"id": "aspectGlyphs", "group": "aspects", "labelKey": "quickopt.withSymbols", "label": "Aspect glyphs"},
    {"id": "traditionalAspects", "group": "aspects", "labelKey": "quickopt.traditionalOnly", "label": "Traditional only"},
    {"id": "aspectThicknessMode", "group": "aspects", "labelKey": "quickopt.orbAsLineThickness", "label": "Orb as line thickness"},
    {"id": "aspectOpacityMode", "group": "aspects", "labelKey": "quickopt.opacity", "label": "Orb as line opacity"},
    {"id": "showChiron", "group": "points", "labelKey": "quickopt.chiron", "label": "Chiron"},
    {"id": "showNodes", "group": "points", "labelKey": "quickopt.nodes", "label": "Nodes"},
    {"id": "aspectsToNodes", "group": "points", "labelKey": "quickopt.aspectsToNodes", "label": "Aspects to Nodes"},
    {"id": "showLotOfFortune", "group": "points", "labelKey": "quickopt.fortuna", "label": "Lot of Fortune"},
    {"id": "aspectsToLotOfFortune", "group": "points", "labelKey": "quickopt.aspectsToFortuna", "label": "Aspects to Fortuna"},
    {"id": "showLotOfFortuneOuterRing", "group": "points", "labelKey": "quickopt.outerRingFortunaLabel", "label": "Outer-ring Fortuna label"},
    {"id": "showVertex", "group": "points", "labelKey": "quickopt.vertex", "label": "Vertex"},
    {"id": "aspectsToVertex", "group": "points", "labelKey": "quickopt.aspectsToVertex", "label": "Aspects to Vertex"},
    {"id": "showPrenatalSyzygy", "group": "points", "labelKey": "quickopt.prenatalSyzygy", "label": "Prenatal Syzygy"},
    {"id": "angleArrowheads", "group": "content", "labelKey": "settings.angleArrowheads", "label": "Angle arrowheads"},
    {"id": "cusplessAscMcLabels", "group": "content", "labelKey": "settings.cusplessAscMcLabels", "label": "AC/MC labels in cuspless charts"},
    {"id": "information", "group": "overlays", "labelKey": "quickopt.information", "label": "Information"},
    {"id": "houseSystemLabel", "group": "overlays", "labelKey": "quickopt.houseSystemLabel", "label": "House system label"},
    {"id": "planetaryDayHour", "group": "overlays", "labelKey": "quickopt.planetaryHour", "label": "Planetary hour"},
    {"id": "seconds", "group": "overlays", "labelKey": "quickopt.secondsInHeader", "label": "Seconds in header"},
    {"id": "extendedStations", "group": "overlays", "labelKey": "quickopt.phasisModernPlanets", "label": "Phasis modern planets"},
    {"id": "showCazimi", "group": "overlays", "labelKey": "quickopt.cazimi", "label": "Cazimi"},
    {"id": "eclipseOverlay", "group": "overlays", "labelKey": "quickopt.eclipseOverlay", "label": "Eclipse overlay"},
    {"id": "fixedStarsToNodes", "group": "outer", "labelKey": "quickopt.fixstarsToNodes", "label": "Fixed stars to Nodes"},
    {"id": "fixedStarsToIntermediateCusps", "group": "outer", "labelKey": "quickopt.fixstarsToIntermediateHcs", "label": "Fixed stars to intermediate cusps"},
    {"id": "fixedStarsToLotOfFortune", "group": "outer", "labelKey": "quickopt.fixstarsToFortuna", "label": "Fixed stars to Fortuna"},
    {"id": "morinAntiscia", "group": "outer", "labelKey": "quickopt.morinAntiscia", "label": "Morin antiscia"},
    {"id": "dignityBodyColors", "group": "symbols", "labelKey": "settings.useIndividualColors", "label": "Use individual body colours"},
    {"id": "zodiacElementColors", "group": "symbols", "labelKey": "settings.useZodiacElementColors", "label": "Use zodiac element colours"},
    {"id": "dignityLabelColors", "group": "symbols", "labelKey": "settings.colorDignityLabels", "label": "Colour dignity labels"},
)

_PREVIEW_ASPECT_FIELD = {"id": "aspect."}

_PREVIEW_FIXTURE_FIELDS = (
    {
        "id": "surveilStudyId",
        "label": "Surveil study",
        "labelKey": "styleLab.fixture.surveilStudy",
    },
    {
        "id": "eventFixtureId",
        "label": "Event overlay",
        "labelKey": "styleLab.fixture.eventOverlay",
    },
    {
        "id": "parallelTransitFixtureId",
        "label": "Parallel transit",
        "labelKey": "styleLab.fixture.parallelTransit",
    },
)

_PREVIEW_FIXTURE_UNAVAILABLE_REASON = {
    "labelKey": "styleLab.fixture.unavailableReason",
}


def _txt(key: str, fallback: str) -> str:
    return str(export_chart_json.mtexts.txts.get(key, fallback))


def _preview_choice(value: object, label: str, labelKey: Optional[str] = None) -> dict[str, object]:
    choice: dict[str, object] = {"value": value, "label": label}
    if labelKey:
        choice["labelKey"] = labelKey
    return choice


def _preview_field(
    *,
    field_id: str,
    group: str,
    label: str,
    default_value: object,
    labelKey: Optional[str] = None,
    choices: Optional[list[dict[str, object]]] = None,
    depends_on: Optional[dict[str, object]] = None,
    applicability: tuple[str, ...] = ("single", "comparison"),
) -> dict[str, object]:
    field: dict[str, object] = {
        "id": field_id,
        "group": group,
        "type": "enum" if choices is not None else "boolean",
        "label": label,
        "defaultValue": default_value,
        "applicability": list(applicability),
    }
    if labelKey:
        field["labelKey"] = labelKey
    if choices is not None:
        field["choices"] = choices
    if depends_on is not None:
        field["dependsOn"] = depends_on
    return field


def style_lab_preview_manifest(base_options) -> dict[str, object]:
    """Daemon-owned, read-only catalog for the standalone chart preview.

    The manifest contains only fields that the isolated resolver accepts. It is
    intentionally independent from POST /api/options and from workspace state.
    """
    fields: list[dict[str, object]] = [
        _preview_field(
            field_id="variant",
            group="layout",
            **_PREVIEW_LABELS["variant"],
            default_value={0: "round-classic", 1: "round-compact", 2: "round-anglo"}.get(
                int(getattr(base_options, "theme", 0) or 0), "round-classic"
            ),
            choices=[
                _preview_choice("round-classic", **_PREVIEW_LABELS["classic"]),
                _preview_choice("round-compact", **_PREVIEW_LABELS["compact"]),
                _preview_choice("round-anglo", **_PREVIEW_LABELS["anglo"]),
            ],
        ),
        _preview_field(
            field_id="comparisonLayout",
            group="layout",
            **_PREVIEW_LABELS["mode"],
            default_value="standard",
            choices=[
                _preview_choice("standard", **_PREVIEW_LABELS["standard"]),
                _preview_choice("with-houses", _txt("Houses", "Houses"), "quickopt.houses"),
            ],
            applicability=("comparison",),
        ),
        _preview_field(
            field_id="houseSystem",
            group="content",
            label="House system",
            labelKey="settings.houseSystem",
            default_value=str(getattr(base_options, "hsys", "P") or "P"),
            choices=[
                _preview_choice(code, label)
                for code, label in (
                    ("P", "Placidus"), ("K", "Koch"), ("R", "Regiomontanus"),
                    ("C", "Campanus"), ("E", _txt("Equal", "Equal")),
                    ("W", _txt("WholeSign", "Whole Sign")),
                    ("X", _txt("AxialRotation", "Axial Rotation")),
                    ("Q", _txt("TrueAscendant", "True Ascendant")),
                    ("M", "Morinus"), ("H", _txt("Horizon", "Horizon")),
                    ("T", "Polich-Page (Topocentric)"), ("B", "Alcabitius"),
                    ("O", "Porphyry"), ("N", _txt("None", "None")),
                )
            ],
        ),
        _preview_field(
            field_id="termSystem",
            group="content",
            label=_txt("Terms", "Terms"),
            labelKey="settings.termSet",
            default_value=int(getattr(base_options, "selterm", 0) or 0),
            choices=[
                _preview_choice(index, str(label))
                for index, label in enumerate(export_chart_json.mtexts.termList)
            ],
            depends_on={"fieldId": "terms", "equals": True},
        ),
        _preview_field(
            field_id="decanSystem",
            group="content",
            label=_txt("Decans", "Decans"),
            labelKey="quickopt.decans",
            default_value=int(getattr(base_options, "seldecan", 0) or 0),
            choices=[
                _preview_choice(index, str(label))
                for index, label in enumerate(export_chart_json.mtexts.decanList)
            ],
            depends_on={"fieldId": "decans", "equals": True},
        ),
        _preview_field(
            field_id="minorAspects",
            group="aspects",
            **_PREVIEW_LABELS["minorAspects"],
            default_value=all(
                index < len(getattr(base_options, "aspect", ()))
                and bool(base_options.aspect[index])
                for index in _PREVIEW_MINOR_ASPECT_INDICES
            ),
            depends_on={"fieldId": "aspects", "equals": True},
        ),
        _preview_field(
            field_id="outerRing",
            group="outer",
            label="Outer ring",
            labelKey="settings.outerRing",
            default_value=_PREVIEW_OUTER_RING_ID_BY_VALUE.get(
                int(getattr(base_options, "showfixstars", 0) or 0), "none"
            ),
            choices=[
                _preview_choice(mode_id, _txt(label_key, fallback))
                for mode_id, label_key, fallback in (
                    ("none", "None", "None"),
                    ("fixstars", "FixStars", "Fixed Stars"),
                    ("asteroids", "Asteroids", "Asteroids"),
                    ("midpoints", "Midpoints", "Midpoints"),
                    ("hybrid_hits", "HybridHits", "Hybrid Hits"),
                    ("dodecatemoria", "Dodecatemoria", "Dodecatemoria"),
                    ("antiscia", "Antiscia", "Antiscia"),
                    ("contra_antiscia", "ContraAntiscia", "Contraantiscia"),
                    ("arabic_parts", "ArabicParts", "Arabic Parts"),
                )
            ],
        ),
        _preview_field(
            field_id="phasisMode",
            group="overlays",
            label="Phasis mode",
            labelKey="quickopt.phasisMode",
            default_value=int(getattr(base_options, "phasismode", 0) or 0),
            choices=[
                _preview_choice(0, _txt("Astronomical", "Astronomical")),
                _preview_choice(1, _txt("Hellenistic", "Hellenistic")),
                _preview_choice(2, _txt("SwissEphemeris", "Swiss Ephemeris")),
            ],
        ),
        _preview_field(
            field_id="cazimiMode",
            group="overlays",
            label="Cazimi mode",
            labelKey="quickopt.cazimiMode",
            default_value=int(getattr(base_options, "cazimimode", 0) or 0),
            choices=[
                _preview_choice(0, _txt("CazimiHellenistic", "Hellenistic · 1°")),
                _preview_choice(2, _txt("CazimiAbuMashar", "Abu Maʿshar · 16′")),
                _preview_choice(1, _txt("CazimiAlQabisi", "al-Qabisi · 16′ + latitude")),
            ],
            depends_on={"fieldId": "showCazimi", "equals": True},
        ),
        _preview_field(
            field_id="uranusGlyph",
            group="symbols",
            label="Uranus",
            labelKey="settings.uranus",
            default_value=bool(getattr(base_options, "uranus", True)),
            choices=[_preview_choice(True, "1"), _preview_choice(False, "2")],
        ),
        _preview_field(
            field_id="plutoGlyph",
            group="symbols",
            label="Pluto",
            labelKey="settings.pluto",
            default_value=int(getattr(base_options, "pluto", 0) or 0),
            choices=[_preview_choice(value, str(value + 1)) for value in range(4)],
        ),
        _preview_field(
            field_id="signGlyphVariant",
            group="symbols",
            label="Signs",
            labelKey="settings.signs",
            default_value=bool(getattr(base_options, "signs", True)),
            choices=[_preview_choice(True, "1"), _preview_choice(False, "2")],
        ),
    ]

    for definition in _PREVIEW_FIELD_DEFINITIONS:
        field_id = str(definition["id"])
        attribute = _PREVIEW_BOOLEAN_ATTRIBUTES[field_id]
        depends_on = None
        if field_id in {
            "aspectGlyphs", "traditionalAspects", "aspectThicknessMode", "aspectOpacityMode",
            "aspectsToNodes", "aspectsToLotOfFortune", "aspectsToVertex",
        }:
            depends_on = {"fieldId": "aspects", "equals": True}
        if field_id.startswith("fixedStarsTo"):
            depends_on = {"fieldId": "outerRing", "in": ["fixstars", "asteroids", "midpoints", "hybrid_hits"]}
        fields.append(_preview_field(
            field_id=field_id,
            group=str(definition["group"]),
            label=str(definition["label"]),
            labelKey=str(definition["labelKey"]),
            default_value=bool(getattr(base_options, attribute, False)),
            depends_on=depends_on,
        ))

    aspect_labels = (
        ("Conjunctio", "Conjunction"), ("Semisextil", "Semisextile"),
        ("Semiquadrat", "Semisquare"), ("Sextil", "Sextile"),
        ("Quintile", "Quintile"), ("Quadrat", "Square"),
        ("Trigon", "Trine"), ("Sesquiquadrat", "Sesquisquare"),
        ("Biquintile", "Biquintile"), ("Quinqunx", "Quincunx"),
        ("Oppositio", "Opposition"), ("Septile", "Septile"),
    )
    visibility = list(getattr(base_options, "aspect", ()))
    for index, (text_key, fallback) in enumerate(aspect_labels):
        fields.append(_preview_field(
            field_id=f"{_PREVIEW_ASPECT_FIELD['id']}{index}",
            group="aspects",
            label=_txt(text_key, fallback),
            default_value=bool(visibility[index]) if index < len(visibility) else False,
            depends_on={"fieldId": "aspects", "equals": True},
        ))

    return {
        "schemaVersion": 1,
        "groups": [dict(group) for group in _PREVIEW_FIELD_GROUPS],
        "fields": fields,
        "fixtureState": [
            {
                **fixture,
                "type": "reference",
                "applicability": "unavailable",
                "available": False,
                "reasonKey": _PREVIEW_FIXTURE_UNAVAILABLE_REASON["labelKey"],
            }
            for fixture in _PREVIEW_FIXTURE_FIELDS
        ],
    }


def copied_preview_options(base_options, preview: Mapping[str, object]):
    """Resolve one read-only Style Lab preview against an isolated Options copy."""
    allowed = {
        "variant", "comparisonLayout", "minorAspects", "outerRing", "fixedStars",
        "houseSystem", *_PREVIEW_BOOLEAN_ATTRIBUTES, *_PREVIEW_INTEGER_ATTRIBUTES,
        *_PREVIEW_BOOLEAN_ENUM_ATTRIBUTES,
    }
    allowed.update(f"{_PREVIEW_ASPECT_FIELD['id']}{index}" for index in range(12))
    unknown = sorted(str(key) for key in preview if key not in allowed)
    if unknown:
        raise ValueError(f"unsupported chart preview option: {unknown[0]}")

    resolved = copy.deepcopy(base_options)

    variant = preview.get("variant")
    if variant is not None:
        if not isinstance(variant, str) or variant not in _PREVIEW_THEME_BY_VARIANT:
            raise ValueError(f"unsupported chart preview variant: {variant}")
        resolved.theme = _PREVIEW_THEME_BY_VARIANT[str(variant)]

    for key, attribute in _PREVIEW_BOOLEAN_ATTRIBUTES.items():
        value = preview.get(key)
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ValueError(f"chart preview {key} must be boolean")
        setattr(resolved, attribute, value)

    for key, (attribute, choices) in _PREVIEW_INTEGER_ATTRIBUTES.items():
        value = preview.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value not in choices:
            raise ValueError(f"unsupported chart preview {key}: {value}")
        setattr(resolved, attribute, value)

    for key, attribute in _PREVIEW_BOOLEAN_ENUM_ATTRIBUTES.items():
        value = preview.get(key)
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ValueError(f"chart preview {key} must be boolean")
        setattr(resolved, attribute, value)

    house_system = preview.get("houseSystem")
    if house_system is not None:
        available_house_systems = {"P", "K", "R", "C", "E", "W", "X", "Q", "M", "H", "T", "B", "O", "N"}
        if not isinstance(house_system, str) or house_system not in available_house_systems:
            raise ValueError(f"unsupported chart preview houseSystem: {house_system}")
        resolved.hsys = house_system

    minor_aspects = preview.get("minorAspects")
    if minor_aspects is not None:
        if not isinstance(minor_aspects, bool):
            raise ValueError("chart preview minorAspects must be boolean")
        aspect_visibility = list(getattr(resolved, "aspect", ()))
        if len(aspect_visibility) <= max(_PREVIEW_MINOR_ASPECT_INDICES):
            raise ValueError("chart preview aspect visibility is incomplete")
        for index in _PREVIEW_MINOR_ASPECT_INDICES:
            aspect_visibility[index] = minor_aspects
        resolved.aspect = aspect_visibility
        resolved.exclusive_aspects_on_click_show_minor = minor_aspects
        if minor_aspects:
            # Minor aspects and traditional-only are mutually exclusive in the
            # renderer/export contract. Keep both normal and click paths honest.
            resolved.traditionalaspects = False
            resolved.exclusive_aspects_on_click_traditional = False

    fixed_stars_compat = preview.get("fixedStars")
    if fixed_stars_compat is not None:
        if not isinstance(fixed_stars_compat, bool):
            raise ValueError("chart preview fixedStars must be boolean")
        resolved.showfixstars = (
            export_chart_json.options.Options.FIXSTARS
            if fixed_stars_compat
            else export_chart_json.options.Options.NONE
        )

    outer_ring = preview.get("outerRing")
    if outer_ring is not None:
        if not isinstance(outer_ring, str) or outer_ring not in _PREVIEW_OUTER_RING_BY_ID:
            raise ValueError(f"unsupported chart preview outerRing: {outer_ring}")
        resolved.showfixstars = _PREVIEW_OUTER_RING_BY_ID[outer_ring]

    aspect_visibility = list(getattr(resolved, "aspect", ()))
    if len(aspect_visibility) < 12:
        raise ValueError("chart preview aspect visibility is incomplete")
    for index in range(12):
        key = f"{_PREVIEW_ASPECT_FIELD['id']}{index}"
        value = preview.get(key)
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ValueError(f"chart preview {key} must be boolean")
        aspect_visibility[index] = value
    resolved.aspect = aspect_visibility

    return resolved


def preview_comparison_layout(preview: Mapping[str, object]) -> str:
    layout = preview.get("comparisonLayout", "standard")
    if not isinstance(layout, str) or layout not in {"standard", "with-houses"}:
        raise ValueError(f"unsupported chart preview comparisonLayout: {layout}")
    return str(layout)


def validate_style_lab_fixture_state(fixture_state: Optional[Mapping[str, object]]) -> dict[str, object]:
    """Validate the explicit fixture namespace without inventing overlay data."""
    fixture_state = fixture_state or {}
    allowed = {str(field["id"]) for field in _PREVIEW_FIXTURE_FIELDS}
    unknown = sorted(str(key) for key in fixture_state if key not in allowed)
    if unknown:
        raise ValueError(f"unsupported Style Lab fixture: {unknown[0]}")
    for field_id in allowed:
        value = fixture_state.get(field_id)
        if value is not None and value != "":
            raise ValueError(f"Style Lab fixture {field_id} is not available")
    return {field_id: None for field_id in sorted(allowed)}


def _source_path(source: Optional[str]) -> str:
    return str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)


def list_chart_names(source: Optional[str] = None) -> list[dict]:
    """List chart entries available in the Hors source jsonl.

    Returns a list of `{index, name, date, place}` records the frontend
    can render in an Open dialog. Reading is line-by-line — works for the
    flat jsonl format the engine has used since the original Morinus.
    """
    path = Path(_source_path(source))
    if not path.exists():
        return []
    out: list[dict] = []
    with path.open() as fh:
        for idx, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            out.append({
                "index": idx,
                "name": entry.get("name") or f"#{idx}",
                "date": entry.get("date", ""),
                "time": entry.get("time", ""),
                "place": entry.get("place", ""),
            })
    return out


class ChartSnapshotService:
    """Long-lived chart snapshot exporter for the Tauri/Web frontend."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._options = None

    @property
    def options(self):
        with self._lock:
            if self._options is None:
                self._options = export_chart_json.init_environment()
            return self._options

    def snapshot(
        self,
        *,
        source: Optional[str] = None,
        name: str = "Morinus",
        record_index: Optional[int] = None,
        comparison_source: Optional[str] = None,
        comparison_name: Optional[str] = None,
        comparison_record_index: Optional[int] = None,
        radix_name: Optional[str] = None,
        radix_record_index: Optional[int] = None,
        anchor_name: Optional[str] = None,
        anchor_record_index: Optional[int] = None,
        overlay_render_mode: str = "full",
        preview_options: Optional[Mapping[str, object]] = None,
    ) -> dict:
        source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
        comparison_source_path = (
            str(Path(comparison_source).expanduser())
            if comparison_source
            else source_path
        )
        with self._lock:
            base_options = self.options
            opts = (
                copied_preview_options(base_options, preview_options)
                if preview_options is not None
                else base_options
            )
            primary, _ = export_chart_json.load_chart(
                source_path,
                opts,
                name=name,
                record_index=record_index,
            )
            comparison = None
            radix = None
            anchor = None
            if comparison_name or comparison_record_index is not None:
                comparison, _ = export_chart_json.load_chart(
                    comparison_source_path,
                    opts,
                    name=comparison_name,
                    record_index=comparison_record_index,
                )
            if radix_name or radix_record_index is not None:
                radix, _ = export_chart_json.load_chart(
                    source_path,
                    opts,
                    name=radix_name,
                    record_index=radix_record_index,
                )
            if anchor_name or anchor_record_index is not None:
                anchor, _ = export_chart_json.load_chart(
                    source_path,
                    opts,
                    name=anchor_name,
                    record_index=anchor_record_index,
                )
            snapshot = export_chart_json.export_snapshot(
                primary,
                comparison=comparison,
                radix=radix,
                anchor=anchor,
                overlay_render_mode=overlay_render_mode,
                live_options=opts,
            )
            if preview_options is not None:
                snapshot["comparisonLayout"] = (
                    preview_comparison_layout(preview_options)
                    if comparison is not None
                    else "standard"
                )
            return snapshot

    def style_lab_preview_manifest(self) -> dict[str, object]:
        with self._lock:
            return style_lab_preview_manifest(self.options)

    def style_lab_snapshot(
        self,
        *,
        primary_source: Mapping[str, Any],
        comparison_source: Optional[Mapping[str, Any]] = None,
        preview_options: Optional[Mapping[str, object]] = None,
        fixture_state: Optional[Mapping[str, object]] = None,
    ) -> dict:
        """Build one isolated sidecar snapshot from explicit saved-chart IDs."""
        resolved_fixture_state = validate_style_lab_fixture_state(fixture_state)
        preview_options = dict(preview_options or {})
        snapshot = self.snapshot(
            source=str(primary_source["source"]),
            name=str(primary_source["name"]),
            record_index=int(primary_source["recordIndex"]),
            comparison_source=(
                str(comparison_source["source"])
                if comparison_source is not None
                else None
            ),
            comparison_name=(
                str(comparison_source["name"])
                if comparison_source is not None
                else None
            ),
            comparison_record_index=(
                int(comparison_source["recordIndex"])
                if comparison_source is not None
                else None
            ),
            preview_options=preview_options,
        )
        snapshot["styleLabPreview"] = {
            "schemaVersion": 1,
            "chartSources": {
                "primaryId": str(primary_source["id"]),
                "comparisonId": (
                    str(comparison_source["id"])
                    if comparison_source is not None
                    else None
                ),
            },
            "previewOptions": preview_options,
            "fixtureState": resolved_fixture_state,
            "fixtureApplicability": "unavailable",
        }
        return snapshot

    def here_now_snapshot(self, *, when_iso: Optional[str] = None) -> dict:
        """Build File -> Here and Now as a wx-free horary/current chart.

        Mirrors morin._build_here_and_now_chart(): default location, current
        local clock, Time.ZONE using saved default-location timezone settings.
        """
        with self._lock:
            opts = self.options
            chrt = self._build_here_now_chart(opts, when_iso=when_iso)
            return export_chart_json.export_snapshot(chrt, overlay_render_mode="full")

    def _build_here_now_chart(self, opts, *, when_iso: Optional[str] = None,
                              chart_type: Optional[int] = None,
                              name: Optional[str] = None):
        # chart_type/name mirror morin._build_here_and_now_chart's params
        # (morin.py:19034-19038): the elections menu fallback builds a TRANSIT
        # 'Election Base' here-and-now (morin.py:19082), horary a HORARY one.
        chart_mod = export_chart_json.chart_mod
        place = default_location_model.place_from_options(opts)
        clock = self._here_now_clock_fields(opts, place, when_iso)
        time = chart_factory.build_time(
            clock["year"], clock["month"], clock["day"],
            clock["hour"], clock["minute"], clock["second"],
            place=place,
            plus=clock["plus"],
            zh=clock["zh"],
            zm=clock["zm"],
            daylight=clock["daylightsaving"],
            tzid=clock["tzid"],
            tzauto=clock["tzauto"],
        )
        if name is None:
            name = export_chart_json.mtexts.txts.get(
                "HereAndNow",
                export_chart_json.mtexts.txts.get("Horary", "Here and Now"),
            )
        if chart_type is None:
            chart_type = chart_mod.Chart.HORARY
        return chart_factory.build_chart(name, True, time, place, chart_type, "", opts)

    @staticmethod
    def _parse_when_iso(when_iso: Optional[str]) -> Optional[datetime.datetime]:
        if not when_iso:
            return None
        try:
            value = str(when_iso).strip()
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return datetime.datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _has_default_place(opts) -> bool:
        return default_location_model.has_default_location(opts)

    @staticmethod
    def _utc_tuple(dt: datetime.datetime) -> tuple[int, int, int, int, int, int]:
        utc = dt.astimezone(datetime.timezone.utc)
        return utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second

    def _here_now_clock_fields(self, opts, place, when_iso: Optional[str] = None) -> dict:
        """Return local clock digits + zone fields for the default location.

        A naive `when_iso` remains a local civil-time anchor for tests and
        internal callers. A timezone-aware anchor, and the ordinary no-anchor
        Here-and-Now action, is an instant that must be converted into the
        default location's local civil clock before constructing chart.Time.
        """
        parsed = self._parse_when_iso(when_iso)
        if parsed is not None and parsed.tzinfo is None:
            default_clock = DefaultLocationClock(opts)
            zone_fields = default_clock.local_zone_fields(
                (parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second)
            )
            return {
                "year": parsed.year,
                "month": parsed.month,
                "day": parsed.day,
                "hour": parsed.hour,
                "minute": parsed.minute,
                "second": parsed.second,
                "plus": zone_fields["plus"],
                "zh": zone_fields["zh"],
                "zm": zone_fields["zm"],
                "daylightsaving": zone_fields["daylightsaving"],
                "tzid": zone_fields["tzid"],
                "tzauto": zone_fields["tzauto"],
            }

        if parsed is None:
            parsed = datetime.datetime.now(datetime.timezone.utc)
        utc_tuple = self._utc_tuple(parsed)

        if bool(getattr(opts, "defloctzauto", True)) and self._has_default_place(opts):
            zone = moment.utc_to_place_local_zone(utc_tuple, place)
            if zone is not None and zone.get("tzid"):
                y, m, d, h, mi, s = zone["datetime"]
                return {
                    "year": y,
                    "month": m,
                    "day": d,
                    "hour": h,
                    "minute": mi,
                    "second": s,
                    "plus": bool(zone["plus"]),
                    "zh": int(zone["zh"]),
                    "zm": int(zone["zm"]),
                    "daylightsaving": bool(zone["daylightsaving"]),
                    "tzid": str(zone["tzid"] or ""),
                    "tzauto": True,
                }

        class _StaticTime:
            pass

        static_time = _StaticTime()
        static_time.zt = export_chart_json.chart_mod.Time.ZONE
        static_time.plus = bool(getattr(opts, "deflocplus", True))
        static_time.zh = int(getattr(opts, "defloczhour", 0) or 0)
        static_time.zm = int(getattr(opts, "defloczminute", 0) or 0)
        static_time.daylightsaving = bool(getattr(opts, "deflocdst", False))
        static_time.tzid = ""
        local_tuple = moment.utc_to_chart_local(static_time, utc_tuple, place=None)
        y, m, d, h, mi, s = local_tuple or utc_tuple
        return {
            "year": y,
            "month": m,
            "day": d,
            "hour": h,
            "minute": mi,
            "second": s,
            "plus": static_time.plus,
            "zh": static_time.zh,
            "zm": static_time.zm,
            "daylightsaving": static_time.daylightsaving,
            "tzid": str(getattr(opts, "defloctzid", "") or ""),
            "tzauto": bool(getattr(opts, "defloctzauto", True)),
        }


chart_snapshot_service = ChartSnapshotService()
