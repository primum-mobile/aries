# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Bundled whole-app style profiles exposed as first-class theme presets."""
from __future__ import annotations

from copy import deepcopy

from webapp.daemon.style_authoring_service import build_chart_style_profile_v2
from webapp.daemon.style_profile_catalog_generated import TOKEN_SCHEMA_VERSION
from webapp.daemon.style_profile_service import (
    PROFILE_KIND,
    PROFILE_SCHEMA_VERSION,
    validate_style_profile,
)


NASA_ATLAS_PRESET_NAME = "NASA Atlas"
NASA_ATLAS_PROFILE_ID = "nasa-atlas"
_NASA_ATLAS_REPLACEABLE_CONTENT_HASHES = frozenset({
    # Initial bundled profile. It reused the vivid chart cyan for application
    # selections; replace only this exact immutable version, never an edited
    # user profile that happens to share the reserved id.
    "85eba72ffbaec26d",
    # Muted application-selection accent, before retained stipple fills.
    "c0d121111cd3b0f9",
    # Retained Espenak stipple fills, before the single/comparison aspect
    # classes received one consistent NASA default.
    "fc5efd23fda621fb",
    # Consistent aspect treatment and dotted wheel geometry, before the
    # full-app retained blue-noise material channel.
    "d45564146d9daa10",
    # Full-app blue-noise material, before linked-palette accent foreground
    # roles were explicit in the bundled preset.
    "cb4c978e3229249c",
})


def _color_overrides() -> dict:
    result: dict[str, object] = {}

    def assign(value, *semantic_ids: str) -> None:
        for semantic_id in semantic_ids:
            result[semantic_id] = deepcopy(value)

    assign(
        'Helvetica, "Helvetica Neue", Arial, sans-serif',
        "app.type.familyUi",
    )
    assign(
        [0, 0, 0],
        "app.color.textPrimary",
        "app.color.interactiveAccentForeground",
        "app.inspector.color.source",
        "app.inspector.color.title",
        "app.sidebar.accentForeground",
        "app.sidebar.foreground",
        "chart.color.body.mercury",
        "chart.color.body.saturn",
        "chart.color.frame",
        "chart.color.peregrine",
        "chart.color.positions",
        "chart.color.textBright",
        "renderer.astrocart.color.chromeButtonActiveFg",
        "renderer.astrocart.color.chromeKeyLine",
        "renderer.astrocart.color.chromeMenuHoverFg",
        "renderer.astrocart.color.chromeText",
        "renderer.astrocart.color.mapCountryLabelColor",
        "renderer.astrocart.color.mapLabelColor",
        "renderer.astrolabe.color.infoAtmospheric",
        "renderer.sphere.color.wire",
        "renderer.strip.color.textPrimary",
        "renderer.wheel.color.angloBaseRing",
        "renderer.wheel.color.angloBodyLeader",
        "renderer.wheel.color.angloOuterLeader",
        "renderer.wheel.color.aspectBoundaryRing",
        "renderer.wheel.color.baseRing",
        "renderer.wheel.color.bodyLeader",
        "renderer.wheel.color.decanBoundary",
        "renderer.wheel.color.innerBoundaryRing",
        "renderer.wheel.color.innerDegreeRing",
        "renderer.wheel.color.outerDegreeRing",
        "renderer.wheel.color.outerLeader",
        "renderer.wheel.color.outerMaximumRing",
        "renderer.wheel.color.termBoundary",
        "renderer.wheel.color.termRing",
        "renderer.wheel.color.zodiacInnerRing",
        "renderer.wheel.color.zodiacOuterRing",
        "renderer.wheel.color.zodiacSpoke",
    )
    assign([0, 0, 0, 0.22], "renderer.sphere.color.faintWire")
    assign([0, 0, 0, 0.9], "renderer.astrolabe.color.cardinal")
    assign(
        [0, 0, 212],
        "app.sash.activeColor",
        "app.sash.hoverColor",
        "app.sash.panelActiveColor",
        "app.sash.panelHoverColor",
        "app.status.unsaved",
        "chart.color.aspect.biquintile",
        "chart.color.aspect.quintile",
        "chart.color.aspect.septile",
        "chart.color.body.fortune",
        "chart.color.body.jupiter",
        "chart.color.body.moon",
        "chart.color.body.neptune",
        "chart.color.body.uranus",
        "chart.color.dignity.exaltation",
        "chart.color.element.water",
        "chart.color.houseNumbers",
        "chart.color.signs",
        "renderer.astrocart.color.mapAsterismShadowColor",
        "renderer.astrocart.color.mapWaterLabelColor",
        "renderer.astrolabe.color.horizon",
        "renderer.wheel.color.angloHouseLabel",
        "renderer.wheel.color.decanGlyph",
        "renderer.wheel.color.houseLabel",
        "renderer.wheel.color.termGlyph",
    )
    assign([0, 0, 212, 0.3], "renderer.astrolabe.color.hour")
    assign(
        [0, 128, 17],
        "app.status.good",
        "chart.color.aspect.quincunx",
        "chart.color.aspect.semisextile",
        "chart.color.body.chiron",
        "chart.color.body.nodes",
        "chart.color.dignity.domicile",
        "chart.color.element.earth",
        "chart.color.houses",
        "renderer.astrolabe.color.equator",
        "renderer.astrolabe.color.equatorLabel",
        "renderer.wheel.color.angloHouseBoundaryRing",
        "renderer.wheel.color.cuspOuterRing",
        "renderer.wheel.color.houseBoundaryRing",
        "renderer.wheel.color.houseCusp",
        "renderer.wheel.color.outerHouseRing",
    )
    assign([0, 128, 17, 0.32], "renderer.astrolabe.color.azimuth")
    assign([0, 128, 17, 0.42], "renderer.astrolabe.color.regio")
    assign(
        [2, 171, 234],
        "chart.color.aspect.parallel",
        "chart.color.aspect.sextile",
        "chart.color.aspect.trine",
        "renderer.astrocart.color.chromeButtonActiveBg",
        "renderer.astrocart.color.chromeMenuHoverBg",
        "renderer.astrocart.color.mapAsterismHighlightColor",
    )
    assign([126, 159, 181], "app.color.interactiveAccent")
    assign([2, 171, 234, 0.42], "renderer.astrolabe.color.almucantar")
    assign([34, 34, 34], "app.inspector.color.value")
    assign(
        [68, 68, 68],
        "app.color.textMuted",
        "app.statusbar.textColor",
        "renderer.astrocart.color.chromeDim",
        "renderer.astrocart.color.mapCityLabelColor",
        "renderer.astrolabe.color.infoSchematic",
        "renderer.strip.color.axis",
        "renderer.strip.color.textMuted",
    )
    assign([68, 68, 68, 0.55], "renderer.astrolabe.color.meridian")
    assign([85, 85, 85], "app.inspector.color.label")
    assign(
        [102, 102, 102],
        "app.color.textDim",
        "app.inspector.color.muted",
        "app.status.neutral",
        "renderer.astrocart.color.chromeSoft",
        "renderer.astrocart.color.mapBorderColor",
        "renderer.astrocart.color.mapMinorPlaceLabelColor",
    )
    assign([102, 102, 102, 0.55], "renderer.astrolabe.color.capricorn")
    assign(
        [187, 187, 187],
        "app.color.borderSubtle",
        "app.inspector.color.divider",
        "app.sash.idleColor",
        "app.sash.panelIdleColor",
        "renderer.astrocart.color.chromeBorder",
        "renderer.astrocart.color.mapRoadColor",
    )
    assign([187, 187, 187, 0.58], "renderer.astrocart.color.mapEclipseShadowColor")
    assign(
        [221, 8, 6],
        "app.color.destructive",
        "app.status.avoid",
        "app.status.validationError",
        "chart.color.angles",
        "chart.color.aspect.semisquare",
        "chart.color.aspect.sesquisquare",
        "chart.color.body.mars",
        "chart.color.body.sun",
        "chart.color.dignity.exile",
        "chart.color.element.fire",
        "renderer.astrocart.color.mapEclipseCenterColor",
        "renderer.astrolabe.color.ecliptic",
        "renderer.astrolabe.color.sunFill",
        "renderer.wheel.color.angleLabel",
        "renderer.wheel.color.angleRay",
    )
    assign([221, 8, 6, 0.85], "renderer.astrolabe.color.star")
    assign(
        [238, 238, 238],
        "app.color.surfaceSubtle",
        "app.inspector.color.cardBackground",
        "renderer.astrocart.color.mapOceanColor",
    )
    assign(
        [242, 8, 132],
        "app.status.caution",
        "chart.color.aspect.conjunction",
        "chart.color.aspect.contraparallel",
        "chart.color.aspect.opposition",
        "chart.color.aspect.square",
        "chart.color.body.pluto",
        "chart.color.body.venus",
        "chart.color.dignity.fall",
        "chart.color.element.air",
        "renderer.astrocart.color.chromeKeyParan",
        "renderer.astrocart.color.mapEclipseOutlineColor",
        "renderer.astrocart.color.mapParanColor",
    )
    assign([242, 8, 132, 0.45], "renderer.astrolabe.color.tropic")
    assign([246, 246, 246], "app.color.surface")
    assign([250, 250, 250], "app.inspector.color.background")
    assign(
        [255, 255, 255],
        "app.color.background",
        "chart.color.background",
        "renderer.astrocart.color.mapLandColor",
        "renderer.astrocart.color.mapPageBg",
        "renderer.astrolabe.color.background",
        "renderer.sphere.color.background",
        "renderer.strip.color.background",
    )
    assign([255, 255, 255, 0.92], "renderer.astrocart.color.mapCasing")
    assign([255, 255, 255, 0.94], "renderer.astrocart.color.mapEclipseHaloColor")
    return result


_NASA_ATLAS_AUTHORING_OVERRIDES = {
    "authoring.wheel.anglo.rings.zodiacInner.strokeWidth": 1.75,
    "authoring.wheel.anglo.subdivisions.term.boundary.strokeWidth": 1.25,
    "authoring.wheel.base.fills.centerField.cellSize": 7,
    "authoring.wheel.base.fills.centerField.dotSize": 0.8,
    "authoring.wheel.base.fills.centerField.fillPattern": "stipple",
    "authoring.wheel.base.fills.centerField.opacity": 14,
    "authoring.wheel.base.fills.subdivisionBand.cellSize": 5,
    "authoring.wheel.base.fills.subdivisionBand.dotSize": 1,
    "authoring.wheel.base.fills.subdivisionBand.fillPattern": "stipple",
    "authoring.wheel.base.fills.subdivisionBand.opacity": 22,
    "authoring.wheel.base.fills.zodiacBand.cellSize": 4,
    "authoring.wheel.base.fills.zodiacBand.dotSize": 1,
    "authoring.wheel.base.fills.zodiacBand.fillPattern": "stipple",
    "authoring.wheel.base.fills.zodiacBand.opacity": 28,
    "authoring.wheel.base.aspects.primary.line.opacity": 88,
    "authoring.wheel.base.aspects.primary.line.strokeStyle": "solid",
    "authoring.wheel.base.aspects.primary.line.strokeWidth": 0.9,
    "authoring.wheel.base.aspects.interchart.line.opacity": 88,
    "authoring.wheel.base.aspects.interchart.line.strokeStyle": "solid",
    "authoring.wheel.base.aspects.interchart.line.strokeWidth": 0.9,
    "authoring.wheel.base.houses.inner.cusp.dashGap": 2.25,
    "authoring.wheel.base.houses.inner.cusp.dashLength": 1,
    "authoring.wheel.base.houses.inner.cusp.opacity": 100,
    "authoring.wheel.base.houses.inner.cusp.strokeStyle": "dotted",
    "authoring.wheel.base.houses.inner.cusp.strokeWidth": 1,
    "authoring.wheel.base.houses.outer.cusp.dashGap": 2.25,
    "authoring.wheel.base.houses.outer.cusp.dashLength": 1,
    "authoring.wheel.base.houses.outer.cusp.opacity": 100,
    "authoring.wheel.base.houses.outer.cusp.strokeStyle": "dotted",
    "authoring.wheel.base.houses.outer.cusp.strokeWidth": 1,
    "authoring.wheel.base.rings.aspectBoundary.dashGap": 2.25,
    "authoring.wheel.base.rings.aspectBoundary.dashLength": 1,
    "authoring.wheel.base.rings.aspectBoundary.opacity": 88,
    "authoring.wheel.base.rings.aspectBoundary.strokeStyle": "dotted",
    "authoring.wheel.base.rings.aspectBoundary.strokeWidth": 1,
    "authoring.wheel.base.rings.base.strokeWidth": 1,
    "authoring.wheel.base.rings.houseBoundary.strokeWidth": 1,
    "authoring.wheel.base.rings.outerMaximum.strokeWidth": 1.25,
    "authoring.wheel.base.rings.zodiacInner.strokeWidth": 1,
    "authoring.wheel.base.rings.zodiacOuter.strokeWidth": 1,
    "authoring.wheel.base.zodiac.spoke.dashGap": 2.25,
    "authoring.wheel.base.zodiac.spoke.dashLength": 1,
    "authoring.wheel.base.zodiac.spoke.opacity": 88,
    "authoring.wheel.base.zodiac.spoke.strokeStyle": "dotted",
    "authoring.wheel.base.zodiac.spoke.strokeWidth": 1,
}

_NASA_ATLAS_APP_AUTHORING_OVERRIDES = {
    # A quiet Espenak-like gray grain across retained daylight chrome. These
    # author only the material; each semantic surface keeps its own palette
    # color and can still override any inherited property in Style Lab.
    "authoring.app.materials.global.pattern": "blueNoise",
    "authoring.app.materials.global.patternColor": [54, 54, 54],
    "authoring.app.materials.global.opacity": 8,
    "authoring.app.materials.global.cellSize": 1.25,
    "authoring.app.materials.global.dotSize": 0.45,
    "authoring.app.materials.global.density": 27,
    "authoring.app.materials.global.seed": 2230,
    "authoring.app.materials.global.blendMode": "multiply",
    "authoring.app.surfaces.canvas.opacity": 5,
    "authoring.app.sidebar.opacity": 7,
    "authoring.app.titlebar.opacity": 4,
    "authoring.app.statusbar.opacity": 4,
    "authoring.app.panel.opacity": 6,
    "authoring.app.inspector.opacity": 5,
    "authoring.app.overlay.opacity": 5,
    "authoring.app.popover.opacity": 5,
    "authoring.app.control.opacity": 4,
    "authoring.app.dataBody.opacity": 4,
    "authoring.app.dataHeader.opacity": 7,
}


def _build_nasa_atlas_profile() -> dict:
    authoring = deepcopy(_NASA_ATLAS_AUTHORING_OVERRIDES)
    return validate_style_profile({
        "kind": PROFILE_KIND,
        "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
        "tokenSchemaVersion": TOKEN_SCHEMA_VERSION,
        "id": NASA_ATLAS_PROFILE_ID,
        "name": NASA_ATLAS_PRESET_NAME,
        "scope": "combined",
        "basePresetId": "Daylight",
        "overrides": _color_overrides(),
        "authoringOverrides": authoring,
        "appAuthoringOverrides": deepcopy(
            _NASA_ATLAS_APP_AUTHORING_OVERRIDES
        ),
        "chartStyleProfileV2": build_chart_style_profile_v2(authoring),
    })


_NASA_ATLAS_PROFILE = _build_nasa_atlas_profile()

_BUILTIN_STYLE_PROFILES = {
    NASA_ATLAS_PRESET_NAME: _NASA_ATLAS_PROFILE,
}
BUILTIN_STYLE_PRESET_NAMES = frozenset(_BUILTIN_STYLE_PROFILES)
BUILTIN_STYLE_PROFILE_IDS = frozenset(
    profile["id"] for profile in _BUILTIN_STYLE_PROFILES.values()
)


def builtin_style_profile(name: str) -> dict | None:
    profile = _BUILTIN_STYLE_PROFILES.get(name)
    return deepcopy(profile) if profile is not None else None


def builtin_style_preset_name(profile: object) -> str | None:
    if not isinstance(profile, dict):
        return None
    for name, builtin in _BUILTIN_STYLE_PROFILES.items():
        if (
            profile.get("id") == builtin.get("id")
            and profile.get("contentHash") == builtin.get("contentHash")
        ):
            return name
    return None


def nasa_atlas_profile() -> dict:
    """Return a fresh copy of the immutable bundled NASA Atlas theme."""
    return deepcopy(_NASA_ATLAS_PROFILE)


def is_nasa_atlas_profile(profile: object) -> bool:
    """Distinguish the exact preset from an edited profile sharing its id."""
    return (
        isinstance(profile, dict)
        and profile.get("id") == NASA_ATLAS_PROFILE_ID
        and profile.get("contentHash") == _NASA_ATLAS_PROFILE.get("contentHash")
    )


def nasa_atlas_upgrade_for(profile: object) -> dict | None:
    """Return the latest built-in for a known superseded immutable version."""
    if not isinstance(profile, dict):
        return None
    if profile.get("id") != NASA_ATLAS_PROFILE_ID:
        return None
    if profile.get("contentHash") not in _NASA_ATLAS_REPLACEABLE_CONTENT_HASHES:
        return None
    return nasa_atlas_profile()
