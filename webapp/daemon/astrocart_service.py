# SPDX-FileCopyrightText: Morinus contributors
# SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
# SPDX-License-Identifier: GPL-3.0-or-later
# Modified for Aries in 2026 by Max Lange.

"""Daemon-side astrocartography line computation.

Wraps astrocart.compute_acg_for_chart (wx-free, lives in the engine root)
to produce the GeoJSON FeatureCollection the React-embedded
Res/astrocart/map.html consumes via window.ACG.setData(...).

The wx host (astrocartframe.py) does the same conversion before pushing
via WebView.RunScript; we port the palette (_brighten_floor + _palette_from_options),
glyph-injection and theme helpers inline so we don't have to import
astrocartframe (which depends on wx).

The retained-map contract covers canonical static point selection, physical
parans, angle aspects, zenith markers, Local Space rays/oppositions, and
independently selected transit/progression layers. Theme/style derivation stays
separate and calculation-free.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass, replace
import hashlib
import json
from math import acos, asin, atan2, cos, degrees, isfinite, radians, sin, tan
import os
import sys
import threading
import time
from pathlib import Path
from typing import Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import astrocart  # wx-free
import asterism_projection
import astrocart_tiles
import common
import localspace  # wx-free
import mtexts
from webapp.daemon import astrocart_dynamic, astrocart_spec
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import effective_display_options
from webapp.frontend.scripts import export_chart_json

ASTROCART_MODE_STANDARD = astrocart_spec.MODE_STANDARD
ASTROCART_MODE_GEODETIC_GREENWICH = astrocart_spec.MODE_GEODETIC_GREENWICH
ASTROCART_MODE_GEODETIC_GIZA = astrocart_spec.MODE_GEODETIC_GIZA
ASTROCART_MODE_LOCAL_SPACE = astrocart_spec.MODE_LOCAL_SPACE
ASTROCART_MODES = {
    ASTROCART_MODE_STANDARD,
    ASTROCART_MODE_GEODETIC_GREENWICH,
    ASTROCART_MODE_GEODETIC_GIZA,
    ASTROCART_MODE_LOCAL_SPACE,
}
ASTROCART_MODE_ORDER = astrocart_spec.MODE_ORDER

ASTROCART_PRECISION_PREVIEW = "preview"
ASTROCART_PRECISION_INTERACTIVE = "interactive"
ASTROCART_PRECISION_PRECISE = "precise"
ASTROCART_PRECISIONS = {
    ASTROCART_PRECISION_PREVIEW,
    ASTROCART_PRECISION_INTERACTIVE,
    ASTROCART_PRECISION_PRECISE,
}

_PREVIEW_STEP_DEG = 2.0
_PREVIEW_HORIZON_ERROR_METERS = 1_000_000_000.0
_PREVIEW_PARAN_SCAN_STEP_DEG = 5.0
_PREVIEW_LOCAL_SPACE_STEP_METERS = 1_000_000.0
_INTERACTIVE_STEP_DEG = 2.0
_INTERACTIVE_HORIZON_ERROR_METERS = 1_000.0

_LABEL_CONTRACT_VERSION = 1
_COORDINATE_PRECISION = 6
_MERIDIAN_LABEL_LATITUDES = (0.0, 30.0, -30.0, 55.0, -55.0, 70.0, -70.0)
_HORIZON_LABEL_LATITUDES = (0.0, 25.0, -25.0, 50.0, -50.0)
_HORIZON_LABEL_FRACTIONS = (0.2, 0.35, 0.5, 0.65, 0.8)
_LOCAL_SPACE_LABEL_DISTANCE_METERS = 16_000_000.0
_LOCAL_SPACE_LABEL_STEP_METERS = 2_000_000.0
_CITY_LABEL_RESOURCE = Path("Res") / "astrocart" / "places.geojson"
_ASTERISM_RESOURCE = Path("Res") / "astrocart" / "constellations.lines.min.geojson"
_ASTERISM_STAR_RESOURCE = Path("Res") / "astrocart" / "constellations.stars.min.geojson"

def _mode_label(mode: str) -> str:
    """Served astrocart mode label, resolved to the active language at serve
    time (never at import) via mtexts so the payload localizes correctly."""
    if mode == ASTROCART_MODE_GEODETIC_GREENWICH:
        return mtexts.txts.get("GeodeticGreenwich", "Geodetic - Greenwich")
    if mode == ASTROCART_MODE_GEODETIC_GIZA:
        return mtexts.txts.get("GeodeticGiza", "Geodetic - Giza")
    if mode == ASTROCART_MODE_LOCAL_SPACE:
        return mtexts.txts.get("LocalSpace", "Local Space")
    return mtexts.txts.get("Astrocartography", "Astrocartography")

_GEODETIC_MERIDIANS = {
    ASTROCART_MODE_GEODETIC_GREENWICH: astrocart.GEODETIC_GREENWICH_MERIDIAN_LON,
    ASTROCART_MODE_GEODETIC_GIZA: astrocart.GEODETIC_GIZA_MERIDIAN_LON,
}


# Canonical ``options.clrindividual`` row identity. Both lunar nodes share the
# Nodes row; Fortune owns row 11 and is not one of the default ACG bodies.
_POINT_CLR_INDEX: dict[str, int] = {
    "sun": 0, "moon": 1, "mercury": 2, "venus": 3, "mars": 4,
    "jupiter": 5, "saturn": 6, "uranus": 7, "neptune": 8, "pluto": 9,
    "chiron": 12, "node_asc": 10, "node_desc": 10,
}

_SEMANTIC_POINT_TO_LEGACY_ID: dict[str, str] = {
    **{
        f"ephemeris-body:{body_id}": point_id
        for body_id, point_id in enumerate(
            (
                "sun",
                "moon",
                "mercury",
                "venus",
                "mars",
                "jupiter",
                "saturn",
                "uranus",
                "neptune",
                "pluto",
            )
        )
    },
    "ephemeris-body:15": "chiron",
    "logical-node:north": "node_asc",
    "logical-node:south": "node_desc",
}

# Historical ACG row assignment used by the established no-profile renderer.
# Keep it as the default presentation contract; canonical body rows take over
# only when a style profile actually supplies a replacement body palette.
_LEGACY_POINT_CLR_INDEX: dict[str, int] = {
    "sun": 0, "moon": 1, "mercury": 2, "venus": 3, "mars": 4,
    "jupiter": 5, "saturn": 6, "uranus": 7, "neptune": 8, "pluto": 9,
    "chiron": 10, "node_asc": 11, "node_desc": 12,
}

_MORINUS_PLANETS_DEFAULT = ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
_MORINUS_URANUS_VARIANTS = ("H", "6")
_MORINUS_PLUTO_VARIANTS = ("J", "7", "8", "9")

ASTROCART_STYLE_SCHEMA_VERSION = 10
ASTROCART_TITLEBAR_SAFE_TOP = 34

_ASTROCART_PROFILE_CHROME_STRINGS = {
    "app.type.familyUi": "fontUi",
    "app.type.familySymbols": "fontSymbols",
}

_ASTROCART_PROFILE_CHROME_COLORS = {
    "renderer.astrocart.color.chromePageBg": "pageBg",
    "renderer.astrocart.color.chromeBg": "chromeBg",
    "renderer.astrocart.color.chromeBgThin": "chromeBgThin",
    "renderer.astrocart.color.chromeBorder": "chromeBorder",
    "renderer.astrocart.color.chromeRule": "chromeRule",
    "renderer.astrocart.color.chromeText": "chromeText",
    "renderer.astrocart.color.chromeDim": "chromeDim",
    "renderer.astrocart.color.chromeSoft": "chromeSoft",
    "renderer.astrocart.color.chromeButtonActiveBg": "buttonActiveBg",
    "renderer.astrocart.color.chromeButtonHoverBg": "buttonHoverBg",
    "renderer.astrocart.color.chromeButtonActiveFg": "buttonActiveFg",
    "renderer.astrocart.color.chromeKeyLine": "keyLine",
    "renderer.astrocart.color.chromeKeyParan": "keyParan",
    "renderer.astrocart.color.chromePopupBg": "popupBg",
    "renderer.astrocart.color.chromeMenuBg": "menuBg",
    "renderer.astrocart.color.chromeMenuBorder": "menuBorder",
    "renderer.astrocart.color.chromeMenuShadow": "menuShadow",
    "renderer.astrocart.color.chromeMenuHoverBg": "menuHoverBg",
    "renderer.astrocart.color.chromeMenuHoverFg": "menuHoverFg",
}

_ASTROCART_PROFILE_CHROME_NUMBERS = {
    "renderer.astrocart.metric.chromeControlSize": "controlSize",
    "renderer.astrocart.metric.chromePanelRadius": "panelRadius",
    "renderer.astrocart.metric.chromeFontSize": "fontSize",
    "renderer.astrocart.metric.chromeSmallFontSize": "smallFontSize",
    "renderer.astrocart.metric.chromeInset": "inset",
    "renderer.astrocart.metric.chromeGap": "gap",
    "renderer.astrocart.metric.chromePaddingX": "paddingX",
    "renderer.astrocart.metric.chromePaddingY": "paddingY",
}

_ASTROCART_PROFILE_RENDERER_COLORS = {
    "renderer.astrocart.color.mapCasing": "casing",
    "renderer.astrocart.color.mapLabelColor": "labelColor",
    "renderer.astrocart.color.mapLabelHalo": "labelHalo",
    "renderer.astrocart.color.mapParanColor": "paranColor",
    "renderer.astrocart.color.mapParanHalo": "paranHalo",
    "renderer.astrocart.color.mapPageBg": "pageBg",
    "renderer.astrocart.color.mapOceanColor": "oceanColor",
    "renderer.astrocart.color.mapLandColor": "landColor",
    "renderer.astrocart.color.mapBorderColor": "borderColor",
    "renderer.astrocart.color.mapCountryLabelColor": "countryLabelColor",
    "renderer.astrocart.color.mapCountryLabelHalo": "countryLabelHalo",
    "renderer.astrocart.color.mapCityLabelColor": "cityLabelColor",
    "renderer.astrocart.color.mapCityLabelHalo": "cityLabelHalo",
    "renderer.astrocart.color.mapMinorPlaceLabelColor": "minorPlaceLabelColor",
    "renderer.astrocart.color.mapMinorPlaceLabelHalo": "minorPlaceLabelHalo",
    "renderer.astrocart.color.mapWaterLabelColor": "waterLabelColor",
    "renderer.astrocart.color.mapWaterLabelHalo": "waterLabelHalo",
    "renderer.astrocart.color.mapHospitalLabelColor": "hospitalLabelColor",
    "renderer.astrocart.color.mapHospitalLabelHalo": "hospitalLabelHalo",
    "renderer.astrocart.color.mapHospitalFillColor": "hospitalFillColor",
    "renderer.astrocart.color.mapRoadColor": "roadColor",
    "renderer.astrocart.color.mapStreetNameColor": "streetNameColor",
    "renderer.astrocart.color.mapStreetNameHalo": "streetNameHalo",
    "renderer.astrocart.color.mapResidentialColor": "residentialColor",
    "renderer.astrocart.color.mapFallbackMcColor": "fallbackMcColor",
    "renderer.astrocart.color.mapFallbackIcColor": "fallbackIcColor",
    "renderer.astrocart.color.mapFallbackAscColor": "fallbackAscColor",
    "renderer.astrocart.color.mapFallbackDscColor": "fallbackDscColor",
    "renderer.astrocart.color.mapFallbackUnknownColor": "fallbackUnknownColor",
    "renderer.astrocart.color.mapEclipseShadowColor": "eclipseShadowColor",
    "renderer.astrocart.color.mapEclipseOutlineColor": "eclipseOutlineColor",
    "renderer.astrocart.color.mapEclipseCenterColor": "eclipseCenterColor",
    "renderer.astrocart.color.mapEclipseHaloColor": "eclipseHaloColor",
    "renderer.astrocart.color.mapAsterismHighlightColor": "asterismHighlightColor",
    "renderer.astrocart.color.mapAsterismShadowColor": "asterismShadowColor",
    "renderer.astrocart.color.mapReferenceEclipticColor": "referenceEclipticColor",
    "renderer.astrocart.color.mapReferenceEquatorColor": "referenceEquatorColor",
    "renderer.astrocart.color.mapReferenceAscColor": "referenceAscColor",
    "renderer.astrocart.color.mapReferenceMcColor": "referenceMcColor",
    "renderer.astrocart.color.mapReferenceHouseGridColor": "referenceHouseGridColor",
    "renderer.astrocart.color.mapReferenceZodiacGridColor": "referenceZodiacGridColor",
}

_ASTROCART_PROFILE_RENDERER_NUMBERS = {
    "renderer.astrocart.metric.mapCountryLabelSize": "countryLabelSize",
    "renderer.astrocart.metric.mapCityLabelSize": "cityLabelSize",
    "renderer.astrocart.metric.mapMinorPlaceLabelSize": "minorPlaceLabelSize",
    "renderer.astrocart.metric.mapWaterLabelSize": "waterLabelSize",
    "renderer.astrocart.metric.mapCasingWidth": "casingWidth",
    "renderer.astrocart.metric.mapCasingOpacity": "casingOpacity",
    "renderer.astrocart.metric.mapSolidWidth": "solidWidth",
    "renderer.astrocart.metric.mapSolidOpacity": "solidOpacity",
    "renderer.astrocart.metric.mapDashedWidth": "dashedWidth",
    "renderer.astrocart.metric.mapDashedOpacity": "dashedOpacity",
    "renderer.astrocart.metric.mapDashedOn": "dashedOn",
    "renderer.astrocart.metric.mapDashedOff": "dashedOff",
    "renderer.astrocart.metric.mapParanWidth": "paranWidth",
    "renderer.astrocart.metric.mapParanLineOpacity": "paranOpacity",
    "renderer.astrocart.metric.mapParanDashOn": "paranDashOn",
    "renderer.astrocart.metric.mapParanDashOff": "paranDashOff",
    "renderer.astrocart.metric.mapLocalSpaceOppositionWidthScale": "localSpaceOppositionWidthScale",
    "renderer.astrocart.metric.mapLocalSpaceOppositionOpacityScale": "localSpaceOppositionOpacityScale",
    "renderer.astrocart.metric.mapLocalSpaceOppositionDashOnScale": "localSpaceOppositionDashOnScale",
    "renderer.astrocart.metric.mapLocalSpaceOppositionDashOffScale": "localSpaceOppositionDashOffScale",
    "renderer.astrocart.metric.mapAspectLineWidthScale": "aspectLineWidthScale",
    "renderer.astrocart.metric.mapAspectLineOpacityScale": "aspectLineOpacityScale",
    "renderer.astrocart.metric.mapAspectLineDashOn": "aspectLineDashOn",
    "renderer.astrocart.metric.mapAspectLineDashOff": "aspectLineDashOff",
    "renderer.astrocart.metric.mapZenithRadiusMin": "zenithRadiusMin",
    "renderer.astrocart.metric.mapZenithRadiusWidthScale": "zenithRadiusWidthScale",
    "renderer.astrocart.metric.mapZenithStrokeWidthMin": "zenithStrokeWidthMin",
    "renderer.astrocart.metric.mapTransitLayerOpacity": "transitLayerOpacity",
    "renderer.astrocart.metric.mapProgressionLayerOpacity": "progressionLayerOpacity",
    "renderer.astrocart.metric.mapLabelSize": "labelSize",
    "renderer.astrocart.metric.mapLabelSpacing": "labelSpacing",
    "renderer.astrocart.metric.mapLabelHaloWidth": "labelHaloWidth",
    "renderer.astrocart.metric.mapLabelOpacity": "labelOpacity",
    "renderer.astrocart.metric.mapDomLabelOpacityScale": "domLabelOpacityScale",
    "renderer.astrocart.metric.mapParanLabelSize": "paranLabelSize",
    "renderer.astrocart.metric.mapParanLabelSpacing": "paranLabelSpacing",
    "renderer.astrocart.metric.mapParanLabelHaloWidth": "paranLabelHaloWidth",
    "renderer.astrocart.metric.mapParanLabelOpacity": "paranLabelOpacity",
    "renderer.astrocart.metric.mapLocalCountryBorderWidth": "localCountryBorderWidth",
    "renderer.astrocart.metric.mapLocalCountryBorderOpacity": "localCountryBorderOpacity",
    "renderer.astrocart.metric.mapLocalRegionBorderWidth": "localRegionBorderWidth",
    "renderer.astrocart.metric.mapLocalRegionBorderOpacity": "localRegionBorderOpacity",
    "renderer.astrocart.metric.mapResidentialOpacityScale": "residentialOpacityScale",
    "renderer.astrocart.metric.mapHospitalFillOpacityScale": "hospitalFillOpacityScale",
    "renderer.astrocart.metric.mapRoadWidthScale": "roadWidthScale",
    "renderer.astrocart.metric.mapRoadOpacityScale": "roadOpacityScale",
    "renderer.astrocart.metric.mapRoadBlur": "roadBlur",
    "renderer.astrocart.metric.mapWaterLineOpacity": "waterLineOpacity",
    "renderer.astrocart.metric.mapWaterLabelSpacing": "waterLabelSpacing",
    "renderer.astrocart.metric.mapWaterLabelHaloWidth": "waterLabelHaloWidth",
    "renderer.astrocart.metric.mapWaterLabelHaloBlur": "waterLabelHaloBlur",
    "renderer.astrocart.metric.mapWaterLineLabelOpacity": "waterLineLabelOpacity",
    "renderer.astrocart.metric.mapWaterPointLabelOpacity": "waterPointLabelOpacity",
    "renderer.astrocart.metric.mapStreetLabelSize": "streetLabelSize",
    "renderer.astrocart.metric.mapStreetLabelHaloWidth": "streetLabelHaloWidth",
    "renderer.astrocart.metric.mapStreetLabelHaloBlur": "streetLabelHaloBlur",
    "renderer.astrocart.metric.mapStreetLabelOpacity": "streetLabelOpacity",
    "renderer.astrocart.metric.mapHospitalLabelSize": "hospitalLabelSize",
    "renderer.astrocart.metric.mapHospitalLabelHaloWidth": "hospitalLabelHaloWidth",
    "renderer.astrocart.metric.mapHospitalLabelHaloBlur": "hospitalLabelHaloBlur",
    "renderer.astrocart.metric.mapHospitalLabelOpacity": "hospitalLabelOpacity",
    "renderer.astrocart.metric.mapHospitalIconOpacity": "hospitalIconOpacity",
    "renderer.astrocart.metric.mapCountryLabelSpacing": "countryLabelSpacing",
    "renderer.astrocart.metric.mapCountryLabelHaloWidth": "countryLabelHaloWidth",
    "renderer.astrocart.metric.mapCountryLabelHaloBlur": "countryLabelHaloBlur",
    "renderer.astrocart.metric.mapCountryLabelOpacity": "countryLabelOpacity",
    "renderer.astrocart.metric.mapCityLabelSpacing": "cityLabelSpacing",
    "renderer.astrocart.metric.mapCityLabelHaloWidth": "cityLabelHaloWidth",
    "renderer.astrocart.metric.mapCityLabelHaloBlur": "cityLabelHaloBlur",
    "renderer.astrocart.metric.mapCityLabelOpacity": "cityLabelOpacity",
    "renderer.astrocart.metric.mapMinorPlaceLabelSpacing": "minorPlaceLabelSpacing",
    "renderer.astrocart.metric.mapMinorPlaceLabelHaloWidth": "minorPlaceLabelHaloWidth",
    "renderer.astrocart.metric.mapMinorPlaceLabelHaloBlur": "minorPlaceLabelHaloBlur",
    "renderer.astrocart.metric.mapMinorPlaceLabelOpacity": "minorPlaceLabelOpacity",
    "renderer.astrocart.metric.mapEclipseShadowWidth": "eclipseShadowWidth",
    "renderer.astrocart.metric.mapEclipseShadowOpacity": "eclipseShadowOpacity",
    "renderer.astrocart.metric.mapEclipseShadowBlur": "eclipseShadowBlur",
    "renderer.astrocart.metric.mapEclipseFillOpacity": "eclipseFillOpacity",
    "renderer.astrocart.metric.mapEclipseOutlineWidth": "eclipseOutlineWidth",
    "renderer.astrocart.metric.mapEclipseOutlineOpacity": "eclipseOutlineOpacity",
    "renderer.astrocart.metric.mapEclipseLimitWidth": "eclipseLimitWidth",
    "renderer.astrocart.metric.mapEclipseLimitOpacity": "eclipseLimitOpacity",
    "renderer.astrocart.metric.mapEclipseLimitDashOn": "eclipseLimitDashOn",
    "renderer.astrocart.metric.mapEclipseLimitDashOff": "eclipseLimitDashOff",
    "renderer.astrocart.metric.mapEclipseCenterWidth": "eclipseCenterWidth",
    "renderer.astrocart.metric.mapEclipseCenterOpacity": "eclipseCenterOpacity",
    "renderer.astrocart.metric.mapEclipseMaximumRadius": "eclipseMaximumRadius",
    "renderer.astrocart.metric.mapEclipseMaximumStrokeWidth": "eclipseMaximumStrokeWidth",
    "renderer.astrocart.metric.mapEclipseLabelSize": "eclipseLabelSize",
    "renderer.astrocart.metric.mapEclipseLabelSpacing": "eclipseLabelSpacing",
    "renderer.astrocart.metric.mapEclipseLabelHaloWidth": "eclipseLabelHaloWidth",
    "renderer.astrocart.metric.mapEclipseLabelOpacity": "eclipseLabelOpacity",
    "renderer.astrocart.metric.mapAsterismLineWidth": "asterismLineWidth",
    "renderer.astrocart.metric.mapAsterismLineOpacity": "asterismLineOpacity",
    "renderer.astrocart.metric.mapAsterismStarRadiusMin": "asterismStarRadiusMin",
    "renderer.astrocart.metric.mapAsterismStarRadiusMax": "asterismStarRadiusMax",
    "renderer.astrocart.metric.mapAsterismStarOpacity": "asterismStarOpacity",
    "renderer.astrocart.metric.mapAsterismShadowSpread": "asterismShadowSpread",
    "renderer.astrocart.metric.mapAsterismShadowOpacity": "asterismShadowOpacity",
    "renderer.astrocart.metric.mapAsterismShadowBlur": "asterismShadowBlur",
    "renderer.astrocart.metric.mapAsterismLabelSize": "asterismLabelSize",
    "renderer.astrocart.metric.mapAsterismLabelSpacing": "asterismLabelSpacing",
    "renderer.astrocart.metric.mapAsterismLabelHaloWidth": "asterismLabelHaloWidth",
    "renderer.astrocart.metric.mapAsterismLabelOpacity": "asterismLabelOpacity",
    "renderer.astrocart.metric.mapReferenceLineWidth": "referenceLineWidth",
    "renderer.astrocart.metric.mapReferenceLineOpacity": "referenceLineOpacity",
    "renderer.astrocart.metric.mapReferenceSignSize": "referenceSignSize",
    "renderer.astrocart.metric.mapReferenceSignOpacity": "referenceSignOpacity",
    "renderer.astrocart.metric.mapReferenceSignHaloWidth": "referenceSignHaloWidth",
    "renderer.astrocart.metric.mapReferenceGridLineWidth": "referenceGridLineWidth",
    "renderer.astrocart.metric.mapReferenceGridLineOpacity": "referenceGridLineOpacity",
    "renderer.astrocart.metric.mapReferencePoleSignSize": "referencePoleSignSize",
    "renderer.astrocart.metric.mapReferencePoleHouseSize": "referencePoleHouseSize",
    "renderer.astrocart.metric.mapReferencePoleLabelOpacity": "referencePoleLabelOpacity",
    "renderer.astrocart.metric.mapReferencePoleLabelHaloWidth": "referencePoleLabelHaloWidth",
}

_ASTROCART_PROFILE_POINT_ROLES = {
    "sun": (
        "renderer.astrocart.color.mapSunLineColor",
        "renderer.astrocart.metric.mapSunLineWidthScale",
        "renderer.astrocart.metric.mapSunLineOpacity",
    ),
    "moon": (
        "renderer.astrocart.color.mapMoonLineColor",
        "renderer.astrocart.metric.mapMoonLineWidthScale",
        "renderer.astrocart.metric.mapMoonLineOpacity",
    ),
    "mercury": (
        "renderer.astrocart.color.mapMercuryLineColor",
        "renderer.astrocart.metric.mapMercuryLineWidthScale",
        "renderer.astrocart.metric.mapMercuryLineOpacity",
    ),
    "venus": (
        "renderer.astrocart.color.mapVenusLineColor",
        "renderer.astrocart.metric.mapVenusLineWidthScale",
        "renderer.astrocart.metric.mapVenusLineOpacity",
    ),
    "mars": (
        "renderer.astrocart.color.mapMarsLineColor",
        "renderer.astrocart.metric.mapMarsLineWidthScale",
        "renderer.astrocart.metric.mapMarsLineOpacity",
    ),
    "jupiter": (
        "renderer.astrocart.color.mapJupiterLineColor",
        "renderer.astrocart.metric.mapJupiterLineWidthScale",
        "renderer.astrocart.metric.mapJupiterLineOpacity",
    ),
    "saturn": (
        "renderer.astrocart.color.mapSaturnLineColor",
        "renderer.astrocart.metric.mapSaturnLineWidthScale",
        "renderer.astrocart.metric.mapSaturnLineOpacity",
    ),
    "uranus": (
        "renderer.astrocart.color.mapUranusLineColor",
        "renderer.astrocart.metric.mapUranusLineWidthScale",
        "renderer.astrocart.metric.mapUranusLineOpacity",
    ),
    "neptune": (
        "renderer.astrocart.color.mapNeptuneLineColor",
        "renderer.astrocart.metric.mapNeptuneLineWidthScale",
        "renderer.astrocart.metric.mapNeptuneLineOpacity",
    ),
    "pluto": (
        "renderer.astrocart.color.mapPlutoLineColor",
        "renderer.astrocart.metric.mapPlutoLineWidthScale",
        "renderer.astrocart.metric.mapPlutoLineOpacity",
    ),
    "chiron": (
        "renderer.astrocart.color.mapChironLineColor",
        "renderer.astrocart.metric.mapChironLineWidthScale",
        "renderer.astrocart.metric.mapChironLineOpacity",
    ),
    "node_asc": (
        "renderer.astrocart.color.mapNorthNodeLineColor",
        "renderer.astrocart.metric.mapNorthNodeLineWidthScale",
        "renderer.astrocart.metric.mapNorthNodeLineOpacity",
    ),
    "node_desc": (
        "renderer.astrocart.color.mapSouthNodeLineColor",
        "renderer.astrocart.metric.mapSouthNodeLineWidthScale",
        "renderer.astrocart.metric.mapSouthNodeLineOpacity",
    ),
}


def _profile_color(value) -> str | None:
    if not isinstance(value, (list, tuple)) or len(value) not in (3, 4):
        return None
    try:
        rgb = [max(0, min(255, int(channel))) for channel in value[:3]]
        if len(value) == 3:
            return f"rgb({rgb[0]} {rgb[1]} {rgb[2]})"
        alpha = max(0.0, min(1.0, float(value[3])))
        return f"rgb({rgb[0]} {rgb[1]} {rgb[2]} / {alpha * 100:g}%)"
    except (TypeError, ValueError):
        return None


def _apply_astrocart_profile(payload: dict, profile: dict | None) -> None:
    overrides = (profile or {}).get("overrides")
    if not isinstance(overrides, dict):
        return
    for semantic_id, field in _ASTROCART_PROFILE_CHROME_STRINGS.items():
        value = overrides.get(semantic_id)
        if isinstance(value, str) and value.strip():
            payload["chrome"][field] = value.strip()
    for semantic_id, field in _ASTROCART_PROFILE_CHROME_COLORS.items():
        color = _profile_color(overrides.get(semantic_id))
        if color is not None:
            payload["chrome"][field] = color
    for semantic_id, field in _ASTROCART_PROFILE_CHROME_NUMBERS.items():
        value = overrides.get(semantic_id)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value):
            payload["chrome"][field] = float(value)
    for semantic_id, field in _ASTROCART_PROFILE_RENDERER_COLORS.items():
        color = _profile_color(overrides.get(semantic_id))
        if color is not None:
            payload["renderer"][field] = color
    for semantic_id, field in _ASTROCART_PROFILE_RENDERER_NUMBERS.items():
        value = overrides.get(semantic_id)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value):
            payload["renderer"][field] = float(value)
    for point_id, (color_id, width_id, opacity_id) in _ASTROCART_PROFILE_POINT_ROLES.items():
        semantic_aliases = globals().get("_SEMANTIC_POINT_TO_LEGACY_ID", {})
        point_ids = (
            point_id,
            *(
                semantic_id
                for semantic_id, legacy_id in semantic_aliases.items()
                if legacy_id == point_id
            ),
        )
        for candidate_id in point_ids:
            point = payload.get("points", {}).get(candidate_id)
            if not isinstance(point, dict):
                continue
            color = _profile_color(overrides.get(color_id))
            if color is not None:
                point["color"] = color
            width_scale = overrides.get(width_id)
            if (
                isinstance(width_scale, (int, float))
                and not isinstance(width_scale, bool)
                and isfinite(width_scale)
                and 0.25 <= float(width_scale) <= 3.0
            ):
                point["lineWidthScale"] = float(width_scale)
            opacity = overrides.get(opacity_id)
            if (
                isinstance(opacity, (int, float))
                and not isinstance(opacity, bool)
                and isfinite(opacity)
                and 0.0 <= float(opacity) <= 1.0
            ):
                point["lineOpacity"] = float(opacity)


def _astrocart_chrome_style(is_dark: bool, page_bg: str) -> dict:
    """The complete iframe chrome contract from map.html."""
    if is_dark:
        values = {
            "chromeBg": "rgba(29,30,33,0.88)",
            "chromeBgThin": "rgba(29,30,33,0.84)",
            "chromeBorder": "rgba(255,255,255,0.10)",
            "chromeRule": "rgba(255,255,255,0.08)",
            "chromeText": "#e2e3e6",
            "chromeDim": "#b0b3b8",
            "chromeSoft": "#c4c6ca",
            "buttonActiveBg": "rgba(255,255,255,0.12)",
            "buttonHoverBg": "rgba(255,255,255,0.05)",
            "buttonActiveFg": "#ffffff",
            "keyLine": "#d0d2d6",
            "keyParan": "#e59246",
            "popupBg": "#23262c",
            "menuBg": "rgba(37,39,44,0.88)",
            "menuBorder": "rgba(255,255,255,0.14)",
            "menuShadow": "rgba(0,0,0,0.45)",
            "menuHoverBg": "#0a84ff",
            "menuHoverFg": "#ffffff",
        }
    else:
        values = {
            "chromeBg": "rgba(255,255,255,0.88)",
            "chromeBgThin": "rgba(255,255,255,0.84)",
            "chromeBorder": "rgba(0,0,0,0.12)",
            "chromeRule": "rgba(0,0,0,0.08)",
            "chromeText": "#2d3136",
            "chromeDim": "#43484e",
            "chromeSoft": "#34383d",
            "buttonActiveBg": "rgba(0,0,0,0.09)",
            "buttonHoverBg": "rgba(0,0,0,0.04)",
            "buttonActiveFg": "#1a1d21",
            "keyLine": "#2d3136",
            "keyParan": "#b35800",
            "popupBg": "#ffffff",
            "menuBg": "rgba(246,246,246,0.88)",
            "menuBorder": "rgba(0,0,0,0.18)",
            "menuShadow": "rgba(0,0,0,0.24)",
            "menuHoverBg": "#0a84ff",
            "menuHoverFg": "#ffffff",
        }
    return {
        "pageBg": page_bg,
        "titlebarSafeTop": ASTROCART_TITLEBAR_SAFE_TOP,
        "fontUi": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "fontSymbols": "'Morinus', serif",
        "controlSize": 28.0,
        "panelRadius": 6.0,
        "fontSize": 11.0,
        "smallFontSize": 10.0,
        "inset": 8.0,
        "gap": 4.0,
        "paddingX": 8.0,
        "paddingY": 6.0,
        **values,
    }


def _astrocart_renderer_style(is_dark: bool) -> dict:
    """Complete bounded MapLibre presentation contract."""
    return {
        "casing": "rgba(10,12,16,0.85)" if is_dark else "rgba(255,255,255,0.85)",
        "labelColor": "#e2e3e6" if is_dark else "#30343a",
        "labelHalo": "rgba(10,12,16,0.85)" if is_dark else "rgba(255,255,255,0.85)",
        "paranColor": "#e59246" if is_dark else "#d35400",
        "paranHalo": "rgba(10,12,16,0.85)" if is_dark else "rgba(255,255,255,0.9)",
        "fallbackMcColor": "#e74c3c",
        "fallbackIcColor": "#8e44ad",
        "fallbackAscColor": "#2ecc71",
        "fallbackDscColor": "#f39c12",
        "fallbackUnknownColor": "#888888",
        "eclipseShadowColor": "rgba(5, 6, 7, 0.34)" if is_dark else "rgba(38, 42, 46, 0.18)",
        "eclipseOutlineColor": "#c8c2b5" if is_dark else "#5e6872",
        "eclipseCenterColor": "#d9b760" if is_dark else "#8a6418",
        "eclipseHaloColor": "rgba(8, 11, 15, 0.92)" if is_dark else "rgba(255, 255, 255, 0.92)",
        "asterismHighlightColor": "#c9a7ff" if is_dark else "#6d3fb2",
        "asterismShadowColor": "#4f8cff" if is_dark else "#376ec7",
        "referenceEclipticColor": "#d7d7d9" if is_dark else "#111111",
        "referenceEquatorColor": "#dcdccd" if is_dark else "#111111",
        "referenceAscColor": "#cdcdd1" if is_dark else "#111111",
        "referenceMcColor": "#cdcdd1" if is_dark else "#111111",
        "referenceHouseGridColor": "#8a8b8d" if is_dark else "#585858",
        "referenceZodiacGridColor": "#d7d7d9" if is_dark else "#111111",
        "pageBg": "#1a1d21" if is_dark else "#d9dde1",
        "oceanColor": "#232a32" if is_dark else "#dfe7f0",
        "landColor": "#31353a" if is_dark else "#eef1f4",
        "borderColor": "#59616a" if is_dark else "#8a929d",
        "countryLabelColor": "#d7dbe0" if is_dark else "#343941",
        "countryLabelHalo": "rgba(10,12,16,0.88)" if is_dark else "rgba(255,255,255,0.92)",
        "countryLabelSize": 12.0,
        "countryLabelsOn": True,
        "cityLabelColor": "#9ea5ae" if is_dark else "#5d6773",
        "cityLabelHalo": "rgba(10,12,16,0.88)" if is_dark else "rgba(255,255,255,0.92)",
        "cityLabelSize": 10.5,
        "cityLabelsOn": True,
        "minorPlaceLabelColor": "#868d95" if is_dark else "#727b86",
        "minorPlaceLabelHalo": "rgba(10,12,16,0.50)" if is_dark else "rgba(255,255,255,0.56)",
        "minorPlaceLabelSize": 9.4,
        "waterLabelColor": "#8db5d9" if is_dark else "#4c6f96",
        "waterLabelHalo": "rgba(10,12,16,0.62)" if is_dark else "rgba(255,255,255,0.74)",
        "waterLabelSize": 11.0,
        "hospitalLabelColor": "#c2c7cd" if is_dark else "#555e68",
        "hospitalLabelHalo": "rgba(10,12,16,0.72)" if is_dark else "rgba(255,255,255,0.80)",
        "hospitalFillColor": "rgba(182,188,196,0.10)" if is_dark else "rgba(88,96,106,0.08)",
        "roadColor": "#454d57" if is_dark else "#c5cdd6",
        "streetNameColor": "rgba(230,235,240,0.42)" if is_dark else "rgba(70,78,88,0.42)",
        "streetNameHalo": "rgba(10,12,16,0.22)" if is_dark else "rgba(255,255,255,0.26)",
        "buildingColor": "rgba(10,12,16,0.44)" if is_dark else "rgba(116,124,134,0.16)",
        "buildingOutlineColor": "rgba(126,134,144,0.14)" if is_dark else "rgba(92,100,110,0.12)",
        "parkColor": "rgba(74,92,78,0.14)" if is_dark else "rgba(142,168,146,0.16)",
        "parkOutlineColor": "rgba(118,142,122,0.16)" if is_dark else "rgba(122,150,126,0.18)",
        "residentialColor": "rgba(70,76,84,0.08)" if is_dark else "rgba(174,182,190,0.08)",
        "casingWidth": 3.0,
        "casingOpacity": 0.9,
        "solidWidth": 1.6,
        "solidOpacity": 0.95,
        "dashedWidth": 1.6,
        "dashedOpacity": 0.95,
        "dashedOn": 3.0,
        "dashedOff": 2.0,
        "paranWidth": 1.0,
        "paranOpacity": 0.7 if is_dark else 0.55,
        "paranDashOn": 1.0,
        "paranDashOff": 2.0,
        "localSpaceOppositionWidthScale": 0.9,
        "localSpaceOppositionOpacityScale": 0.88,
        "localSpaceOppositionDashOnScale": 0.65,
        "localSpaceOppositionDashOffScale": 1.25,
        "aspectLineWidthScale": 0.82,
        "aspectLineOpacityScale": 0.78,
        "aspectLineDashOn": 0.45,
        "aspectLineDashOff": 1.55,
        "zenithRadiusMin": 3.0,
        "zenithRadiusWidthScale": 2.0,
        "zenithStrokeWidthMin": 1.0,
        "transitLayerOpacity": 0.82,
        "progressionLayerOpacity": 0.68,
        "labelSize": 11.0,
        "labelSpacing": 0.04,
        "labelHaloWidth": 1.0,
        "labelOpacity": 1.0,
        "domLabelOpacityScale": 0.9,
        "labelHaloOn": True,
        "labelsOn": True,
        "paranLabelSize": 11.0,
        "paranLabelSpacing": 0.02,
        "paranLabelHaloWidth": 1.3,
        "paranLabelOpacity": 1.0,
        "paranLabelHaloOn": True,
        "paranLabelsOn": True,
        "localCountryBorderWidth": 0.8,
        "localCountryBorderOpacity": 0.62,
        "localRegionBorderWidth": 0.45,
        "localRegionBorderOpacity": 0.28,
        "buildingOpacityScale": 1.0,
        "residentialOpacityScale": 1.0,
        "parkFillOpacityScale": 1.0,
        "parkOutlineOpacityScale": 1.0,
        "hospitalFillOpacityScale": 1.0,
        "roadWidthScale": 1.0,
        "roadOpacityScale": 1.0,
        "roadBlur": 0.0,
        "waterLineOpacity": 0.65,
        "waterLabelSpacing": 0.12,
        "waterLabelHaloWidth": 1.05,
        "waterLabelHaloBlur": 0.45,
        "waterLineLabelOpacity": 0.62,
        "waterPointLabelOpacity": 0.74,
        "streetLabelSize": 11.0,
        "streetLabelHaloWidth": 0.65,
        "streetLabelHaloBlur": 0.25,
        "streetLabelOpacity": 1.0,
        "hospitalLabelSize": 11.2,
        "hospitalLabelHaloWidth": 1.0,
        "hospitalLabelHaloBlur": 0.35,
        "hospitalLabelOpacity": 0.82,
        "hospitalIconOpacity": 0.5,
        "countryLabelSpacing": 0.04,
        "countryLabelHaloWidth": 1.35,
        "countryLabelHaloBlur": 0.8,
        "countryLabelOpacity": 0.92,
        "cityLabelSpacing": 0.02,
        "cityLabelHaloWidth": 1.15,
        "cityLabelHaloBlur": 0.7,
        "cityLabelOpacity": 0.82,
        "minorPlaceLabelSpacing": 0.01,
        "minorPlaceLabelHaloWidth": 0.35,
        "minorPlaceLabelHaloBlur": 0.2,
        "minorPlaceLabelOpacity": 0.64,
        "eclipseShadowWidth": 12.0,
        "eclipseShadowOpacity": 0.92,
        "eclipseShadowBlur": 3.0,
        "eclipseFillOpacity": 0.9,
        "eclipseOutlineWidth": 0.8,
        "eclipseOutlineOpacity": 0.24,
        "eclipseLimitWidth": 1.2,
        "eclipseLimitOpacity": 0.78,
        "eclipseLimitDashOn": 3.0,
        "eclipseLimitDashOff": 2.0,
        "eclipseCenterWidth": 2.0,
        "eclipseCenterOpacity": 0.96,
        "eclipseMaximumRadius": 4.5,
        "eclipseMaximumStrokeWidth": 2.0,
        "eclipseLabelSize": 11.0,
        "eclipseLabelSpacing": 0.0,
        "eclipseLabelHaloWidth": 1.3,
        "eclipseLabelOpacity": 1.0,
        "asterismLineWidth": 0.7,
        "asterismLineOpacity": 0.52,
        "asterismStarRadiusMin": 0.85,
        "asterismStarRadiusMax": 3.8,
        "asterismStarOpacity": 0.92,
        "asterismShadowSpread": 0.65,
        "asterismShadowOpacity": 0.28,
        "asterismShadowBlur": 0.55,
        "asterismLabelSize": 7.0,
        "asterismLabelSpacing": 0.06,
        "asterismLabelHaloWidth": 0.55,
        "asterismLabelOpacity": 0.72,
        "referenceLineWidth": 1.1,
        "referenceLineOpacity": 0.78,
        "referenceSignSize": 12.0,
        "referenceSignOpacity": 1.0,
        "referenceSignHaloWidth": 1.25,
        "referenceGridLineWidth": 0.5,
        "referenceGridLineOpacity": 0.34,
        "referencePoleSignSize": 8.0,
        "referencePoleHouseSize": 7.0,
        "referencePoleLabelOpacity": 0.82,
        "referencePoleLabelHaloWidth": 0.9,
    }

_CITY_LABEL_THRESHOLDS = (
    (1.7, 0, 4_000_000, 60),
    (2.3, 1, 1_000_000, 110),
    (3.0, 2, 250_000, 180),
    (4.0, 3, 100_000, 260),
)


@dataclass(frozen=True, slots=True)
class _CityLabel:
    name: str
    ascii_name: str
    country: str
    longitude: float
    latitude: float
    population: int
    level: int
    feature_code: str
    canonical_rank: int


@dataclass(frozen=True, slots=True)
class _CityLabelIndex:
    rows_by_latitude: tuple[_CityLabel, ...]
    latitudes: tuple[float, ...]
    row_count: int
    load_ms: float

_UNICODE_GLYPHS: dict[str, str] = {
    "sun": "☉",       # ☉
    "moon": "☽",      # ☽
    "mercury": "☿",   # ☿
    "venus": "♀",     # ♀
    "mars": "♂",      # ♂
    "jupiter": "♃",   # ♃
    "saturn": "♄",    # ♄
    "uranus": "♅",    # ♅
    "neptune": "♆",   # ♆
    "pluto": "♇",     # ♇
    "chiron": "⚷",    # ⚷
    "node_asc": "☊",  # ☊
    "node_desc": "☋", # ☋
}


def _brighten_floor(r: int, g: int, b: int, floor: int = 96) -> tuple[int, int, int]:
    """Port of astrocartframe._brighten_floor (astrocartframe.py:682-694):
    if brightness is below ``floor``, scale up toward white PRESERVING hue;
    only pure black maps to neutral grey. Lifts deep navy/maroon/forest custom
    clrindividual colours off the dark basemap without losing their hue."""
    brightness = max(r, g, b)
    if brightness >= floor:
        return r, g, b
    if brightness == 0:
        return floor, floor, floor  # pure black → neutral light grey
    scale = floor / brightness
    return (min(255, int(r * scale)),
            min(255, int(g * scale)),
            min(255, int(b * scale)))


def _hex_bg(value, fallback: str) -> str:
    """Port of astrocartframe._hex_bg (astrocartframe.py:56-61)."""
    try:
        r, g, b = int(value[0]), int(value[1]), int(value[2])
    except Exception:
        return fallback
    return f"#{r:02x}{g:02x}{b:02x}"


def _is_dark_theme(options) -> bool:
    """Port of astrocartframe._is_dark_theme (astrocartframe.py:666-679):
    classify the active Morinus colour theme from ``options.clrbackground``.
    Plain channel mean < 128 → dark (Midnight/Nocturne), else light
    (Daylight/Paper/Classic). Same luminance test as
    export_chart_json.surveil_accent_rgb (export_chart_json.py:153)."""
    bg = getattr(options, "clrbackground", None) if options is not None else None
    try:
        r, g, b = int(bg[0]), int(bg[1]), int(bg[2])
    except Exception:
        return False
    return (r + g + b) / 3 < 128


def _point_palette_indices(source_options, effective_options) -> dict[str, int]:
    """Select canonical rows only for a profile-supplied body palette."""
    source_table = getattr(source_options, "clrindividual", None)
    effective_table = getattr(effective_options, "clrindividual", None)
    legacy_indices = (
        _POINT_CLR_INDEX
        if effective_table is not source_table
        else _LEGACY_POINT_CLR_INDEX
    )
    indices = dict(legacy_indices)
    indices.update({
        semantic_id: legacy_indices[legacy_id]
        for semantic_id, legacy_id in _SEMANTIC_POINT_TO_LEGACY_ID.items()
    })
    # Structural Lots share the established Fortune palette row. Dynamic
    # asteroid/centaur and fixed-star records deliberately fall through to the
    # renderer's semantic unknown-point role instead of inventing a color.
    if effective_table is not source_table:
        indices["point:fortune"] = 11
    return indices


def _palette_from_options(options, points, *, index_by_point) -> dict[str, str]:
    colors: dict[str, str] = {}
    table = getattr(options, "clrindividual", None) if options is not None else None
    if table is None:
        return colors
    try:
        n = len(table)
    except TypeError:
        return colors

    def _hex(rgb) -> Optional[str]:
        try:
            r, g, b = int(rgb[0]), int(rgb[1]), int(rgb[2])
        except Exception:
            return None
        r, g, b = _brighten_floor(r, g, b, floor=96)
        return f"#{r:02x}{g:02x}{b:02x}"

    for pt in points:
        idx = index_by_point.get(pt.id)
        if idx is None or idx >= n:
            continue
        hx = _hex(table[idx])
        if hx:
            colors[pt.id] = hx
    return colors


def _morinus_glyph_for(point_id: str, options) -> str:
    point_id = _SEMANTIC_POINT_TO_LEGACY_ID.get(point_id, point_id)
    if point_id == "node_asc":
        return "K"
    if point_id == "node_desc":
        return "L"
    if point_id == "chiron":
        return "}"
    clr_idx = _POINT_CLR_INDEX.get(point_id)
    if clr_idx is None or clr_idx > 9:
        return ""
    if point_id == "uranus":
        v = getattr(options, "uranus", True) if options is not None else True
        return _MORINUS_URANUS_VARIANTS[0] if v else _MORINUS_URANUS_VARIANTS[1]
    if point_id == "pluto":
        try:
            v = int(getattr(options, "pluto", 0) if options is not None else 0)
        except Exception:
            v = 0
        v = max(0, min(v, len(_MORINUS_PLUTO_VARIANTS) - 1))
        return _MORINUS_PLUTO_VARIANTS[v]
    return _MORINUS_PLANETS_DEFAULT[clr_idx]


def _inject_glyphs(
    geojson: dict,
    options,
    *,
    label_by_point: Optional[dict[str, str]] = None,
) -> None:
    labels = label_by_point or {}
    for feat in geojson.get("features", []):
        props = feat.setdefault("properties", {})
        kind = props.get("kind")
        if kind == "PARAN":
            a = props.get("a_point", "")
            b = props.get("b_point", "")
            props["a_glyph_morinus"] = _morinus_glyph_for(a, options)
            props["b_glyph_morinus"] = _morinus_glyph_for(b, options)
            props["a_glyph_unicode"] = _UNICODE_GLYPHS.get(a, "")
            props["b_glyph_unicode"] = _UNICODE_GLYPHS.get(b, "")
            a_label = labels.get(a, props.get("a_label") or a)
            b_label = labels.get(b, props.get("b_label") or b)
            props["a_label"] = a_label
            props["b_label"] = b_label
            a_sym = props["a_glyph_unicode"] or a_label
            b_sym = props["b_glyph_unicode"] or b_label
            props["label_unicode"] = (
                f"{a_sym} {props.get('a_angle', '')} × "
                f"{b_sym} {props.get('b_angle', '')}"
            )
        else:
            pid = props.get("point", "")
            props["glyph_morinus"] = _morinus_glyph_for(pid, options)
            # The map renderer always prefers the bundled Morinus font. Keep
            # Unicode only for the established legacy IDs; semantic asteroid,
            # fixed-star, and structural IDs fall back to their text labels.
            props["glyph_unicode"] = _UNICODE_GLYPHS.get(pid, "")


def _catalog_labels(catalog: astrocart_spec.AstrocartPointCatalog) -> dict[str, str]:
    return {
        record.semantic_id: mtexts.txts.get(record.label, record.label)
        for record in catalog.records
    }


def _feature_identity(properties: dict, index: int) -> str:
    kind = str(properties.get("kind") or "feature").lower()
    layer_id = str(
        properties.get("astrocart_layer_id")
        or properties.get("astrocart_layer")
        or "natal"
    )
    if kind == "paran":
        core = ":".join((
            str(properties.get("a_point") or ""),
            str(properties.get("a_angle") or ""),
            str(properties.get("b_point") or ""),
            str(properties.get("b_angle") or ""),
        ))
    elif kind == astrocart.LINE_ASPECT.lower():
        core = ":".join((
            str(properties.get("point") or ""),
            str(properties.get("aspect_id") or ""),
            str(properties.get("target_angle") or ""),
            str(properties.get("branch") or ""),
        ))
    else:
        core = ":".join((
            str(properties.get("point") or ""),
            kind,
            str(properties.get("bearing_role") or ""),
        ))
    return f"astrocart:{layer_id}:{core}:{index}"


def _stamp_feature_contract(
    geojson: dict,
    *,
    layer: str = "natal",
) -> None:
    for index, feature in enumerate(geojson.get("features", ())):
        if not isinstance(feature, dict):
            continue
        props = feature.setdefault("properties", {})
        if not isinstance(props, dict):
            continue
        props.setdefault("astrocart_layer", layer)
        layer_role = str(props.get("astrocart_layer") or layer)
        layer_id = str(props.get("astrocart_layer_id") or layer_role)
        label_id = props.get("label_id")
        if (
            label_id
            and layer_role not in {"natal", "current"}
            and not str(label_id).startswith(f"{layer_id}:")
        ):
            props["label_id"] = f"{layer_id}:{label_id}"
        feature.setdefault("id", _feature_identity(props, index))


def _append_natal_ascendant_lines(
    geojson: dict,
    radix,
    options,
    compute_kwargs: dict,
    *,
    kinds: Sequence[str] = (astrocart.LINE_ASC, astrocart.LINE_DSC),
    geodetic_meridian_lon: Optional[float] = None,
) -> None:
    """Add the chart ASC degree's rising/setting pair in the display system."""
    selected = set(kinds)
    requested_horizon_kinds = tuple(
        kind
        for kind in (astrocart.LINE_ASC, astrocart.LINE_DSC)
        if kind in selected
    )
    if not requested_horizon_kinds:
        return
    renderer_style = _astrocart_renderer_style(_is_dark_theme(options))
    color = _hex_bg(
        getattr(options, "clrAscMC", None),
        renderer_style["referenceAscColor"],
    )
    natal_kwargs = {
        key: value for key, value in compute_kwargs.items()
        if key in {"step_deg", "horizon_error_meters"}
    }
    if geodetic_meridian_lon is None:
        result = astrocart.compute_natal_ascendant_acg_for_chart(
            radix,
            color_hex=color,
            **natal_kwargs,
        )
    else:
        point = astrocart.natal_ascendant_point_from_chart(
            radix,
            color_hex=color,
        )
        result = astrocart.compute_geodetic_acg_for_chart(
            radix,
            points=(point,),
            kinds=requested_horizon_kinds,
            meridian_lon=geodetic_meridian_lon,
            include_parans=False,
            **natal_kwargs,
        )
    payload = result.to_geojson()
    for feature in payload.get("features", []):
        properties = feature.setdefault("properties", {})
        properties["natal_angle"] = True
    geojson.setdefault("features", []).extend(
        feature
        for feature in payload.get("features", [])
        if feature.get("properties", {}).get("kind") in selected
    )


def _normalize_mode(mode: Optional[str]) -> str:
    value = (mode or ASTROCART_MODE_STANDARD).strip().lower()
    if value not in ASTROCART_MODES:
        raise ValueError(f"unknown astrocartography mode: {mode}")
    return value


def _normalize_modes(modes: Sequence[str]) -> tuple[str, ...]:
    requested = {_normalize_mode(mode) for mode in modes}
    return tuple(mode for mode in ASTROCART_MODE_ORDER if mode in requested)


def _normalize_precision(precision: Optional[str]) -> str:
    value = (precision or ASTROCART_PRECISION_PRECISE).strip().lower()
    if value not in ASTROCART_PRECISIONS:
        raise ValueError(f"unknown astrocartography precision: {precision}")
    return value


def _precision_compute_kwargs(precision: str) -> dict[str, float]:
    if precision == ASTROCART_PRECISION_PREVIEW:
        return {
            "step_deg": _PREVIEW_STEP_DEG,
            "horizon_error_meters": _PREVIEW_HORIZON_ERROR_METERS,
            "paran_scan_step_deg": _PREVIEW_PARAN_SCAN_STEP_DEG,
        }
    if precision == ASTROCART_PRECISION_INTERACTIVE:
        return {
            "step_deg": _INTERACTIVE_STEP_DEG,
            "horizon_error_meters": _INTERACTIVE_HORIZON_ERROR_METERS,
        }
    return {}


def _normalize_lon(value: float) -> float:
    value = ((float(value) + 180.0) % 360.0) - 180.0
    # Keep the dateline stable for SQL comparisons.
    return 180.0 if value == -180.0 else value


def _city_label_budget(zoom: float) -> tuple[int, int, int]:
    try:
        z = float(zoom)
    except (TypeError, ValueError):
        z = 0.0
    for max_zoom, max_level, min_pop, max_labels in _CITY_LABEL_THRESHOLDS:
        if z < max_zoom:
            return max_level, min_pop, max_labels
    return 4, 0, 420


def _clamp_label_limit(limit: Optional[int], default_limit: int) -> int:
    try:
        value = int(limit) if limit is not None else int(default_limit)
    except (TypeError, ValueError):
        value = int(default_limit)
    return max(1, min(1000, value))


def _bundled_city_labels_path() -> Path:
    """Resolve the canonical offline label pack in source and Tauri builds."""
    daemon_base = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if daemon_base:
        # The daemon bootstrap makes this override authoritative. In a packaged
        # app, silently falling back to the source checkout would mask a broken
        # resource bundle and make offline behavior installation-dependent.
        return Path(daemon_base).expanduser() / _CITY_LABEL_RESOURCE
    if getattr(sys, "frozen", False):
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            return Path(mei) / _CITY_LABEL_RESOURCE
    return REPO_ROOT / _CITY_LABEL_RESOURCE


def _bundled_asterism_path() -> Path:
    """Resolve the all-sky figure catalogue in source and Tauri builds."""
    daemon_base = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if daemon_base:
        return Path(daemon_base).expanduser() / _ASTERISM_RESOURCE
    if getattr(sys, "frozen", False):
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            return Path(mei) / _ASTERISM_RESOURCE
    return REPO_ROOT / _ASTERISM_RESOURCE


def _bundled_asterism_star_path() -> Path:
    """Resolve the figure-star catalogue in source and Tauri builds."""
    daemon_base = os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip()
    if daemon_base:
        return Path(daemon_base).expanduser() / _ASTERISM_STAR_RESOURCE
    if getattr(sys, "frozen", False):
        mei = getattr(sys, "_MEIPASS", None)
        if mei:
            return Path(mei) / _ASTERISM_STAR_RESOURCE
    return REPO_ROOT / _ASTERISM_STAR_RESOURCE


def _load_city_label_index(path: Path) -> tuple[Optional[_CityLabelIndex], Optional[str], float]:
    """Parse and latitude-index the generated places.geojson exactly once."""
    started = time.perf_counter()
    if not path.is_file():
        return None, "missing", (time.perf_counter() - started) * 1000.0
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        features = payload.get("features") if isinstance(payload, dict) else None
        if (
            not isinstance(payload, dict)
            or payload.get("type") != "FeatureCollection"
            or not isinstance(features, list)
        ):
            raise ValueError("not a GeoJSON FeatureCollection")

        rows: list[_CityLabel] = []
        for rank, feature in enumerate(features):
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                raise ValueError("invalid city feature")
            geometry = feature.get("geometry")
            properties = feature.get("properties")
            if not isinstance(geometry, dict) or geometry.get("type") != "Point":
                raise ValueError("invalid city geometry")
            if not isinstance(properties, dict):
                raise ValueError("invalid city properties")
            coordinates = geometry.get("coordinates")
            if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
                raise ValueError("invalid city coordinates")

            longitude = float(coordinates[0])
            latitude = float(coordinates[1])
            population = int(properties.get("population", 0) or 0)
            level = int(properties["level"])
            name = str(properties.get("name") or "").strip()
            if (
                not name
                or not isfinite(longitude)
                or not isfinite(latitude)
                or not -180.0 <= longitude <= 180.0
                or not -90.0 <= latitude <= 90.0
                or not 0 <= level <= 4
                or population < 0
            ):
                raise ValueError("invalid city label value")
            ascii_name = str(properties.get("ascii") or name)
            rows.append(_CityLabel(
                name=name,
                ascii_name=ascii_name,
                country=str(properties.get("country") or ""),
                longitude=longitude,
                latitude=latitude,
                population=population,
                level=level,
                feature_code=str(properties.get("feature") or ""),
                canonical_rank=rank,
            ))
        if not rows:
            raise ValueError("empty city label resource")
    except FileNotFoundError:
        return None, "missing", (time.perf_counter() - started) * 1000.0
    except (OSError, UnicodeError):
        return None, "unreadable", (time.perf_counter() - started) * 1000.0
    except (KeyError, OverflowError, TypeError, ValueError, json.JSONDecodeError):
        return None, "corrupt", (time.perf_counter() - started) * 1000.0

    rows.sort(key=lambda row: (row.latitude, row.canonical_rank))
    load_ms = (time.perf_counter() - started) * 1000.0
    return _CityLabelIndex(
        rows_by_latitude=tuple(rows),
        latitudes=tuple(row.latitude for row in rows),
        row_count=len(rows),
        load_ms=load_ms,
    ), None, load_ms


def _city_label_features(rows) -> list[dict]:
    return [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row.longitude, row.latitude],
            },
            "properties": {
                "name": row.name,
                "ascii": row.ascii_name,
                "country": row.country,
                "population": row.population,
                "level": row.level,
                "feature": row.feature_code,
            },
        }
        for row in rows
    ]


def _round_anchor(lon: float, lat: float) -> list[float]:
    return [
        round(_normalize_lon(float(lon)), _COORDINATE_PRECISION),
        round(float(lat), _COORDINATE_PRECISION),
    ]


def _quantize_geojson_coordinates(geojson: dict) -> None:
    """Trim display geometry to sub-meter precision without changing math."""
    def quantize(value):
        if isinstance(value, (list, tuple)):
            return [quantize(item) for item in value]
        if isinstance(value, float):
            return round(value, _COORDINATE_PRECISION)
        return value

    for feature in geojson.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or "coordinates" not in geometry:
            continue
        geometry["coordinates"] = quantize(geometry["coordinates"])


def _presentation_geojson(geojson: dict) -> dict:
    """Finalize one GeoJSON payload after all calculation and composition."""
    _quantize_geojson_coordinates(geojson)
    return geojson


def _dedupe_anchors(anchors) -> list[list[float]]:
    out: list[list[float]] = []
    seen: set[tuple[float, float]] = set()
    for lon, lat in anchors:
        if not isfinite(float(lon)) or not isfinite(float(lat)):
            continue
        anchor = _round_anchor(lon, lat)
        key = (anchor[0], anchor[1])
        if key in seen:
            continue
        seen.add(key)
        out.append(anchor)
    return out


def _first_line_coordinate(geometry: dict) -> Optional[tuple[float, float]]:
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "LineString":
        lines = [coordinates]
    elif geometry.get("type") == "MultiLineString":
        lines = coordinates
    else:
        return None
    if not isinstance(lines, (list, tuple)):
        return None
    for line in lines:
        if not isinstance(line, (list, tuple)):
            continue
        for coordinate in line:
            if isinstance(coordinate, (list, tuple)) and len(coordinate) >= 2:
                try:
                    return float(coordinate[0]), float(coordinate[1])
                except (TypeError, ValueError):
                    continue
    return None


def _candidate_latitudes(
    low: float,
    high: float,
    *,
    absolute_candidates: tuple[float, ...],
    fractions: tuple[float, ...],
    polar_limit: float,
) -> list[float]:
    low = max(float(low), -abs(float(polar_limit)))
    high = min(float(high), abs(float(polar_limit)))
    if low > high:
        return []
    candidates = [lat for lat in absolute_candidates if low <= lat <= high]
    if high - low > 1e-9:
        candidates.extend(low + (high - low) * fraction for fraction in fractions)
    elif not candidates:
        candidates.append(low)
    out: list[float] = []
    seen: set[float] = set()
    for value in candidates:
        rounded = round(float(value), 9)
        if rounded in seen:
            continue
        seen.add(rounded)
        out.append(float(value))
    return out


def _meridian_label_anchors(feature: dict, acg_result) -> list[list[float]]:
    coordinate = _first_line_coordinate(feature.get("geometry", {}))
    if coordinate is None:
        return []
    low, high = (-astrocart.GEOGRAPHIC_LAT_LIMIT, astrocart.GEOGRAPHIC_LAT_LIMIT)
    lat_range = getattr(acg_result, "lat_range", None)
    if isinstance(lat_range, (list, tuple)) and len(lat_range) >= 2:
        try:
            low, high = float(lat_range[0]), float(lat_range[1])
        except (TypeError, ValueError):
            pass
    # A meridian's two geometry vertices sit effectively at the poles. Those
    # are line endpoints, not useful label positions, so the display contract
    # deliberately supplies several stable non-polar latitude candidates.
    latitudes = _candidate_latitudes(
        low,
        high,
        absolute_candidates=_MERIDIAN_LABEL_LATITUDES,
        fractions=(0.25, 0.5, 0.75),
        polar_limit=75.0,
    )
    return _dedupe_anchors((coordinate[0], latitude) for latitude in latitudes)


def _horizon_label_anchors(
    *,
    point_id: str,
    kind: str,
    acg_result,
    mode: str,
    geodetic_obliquity: Optional[float],
) -> list[list[float]]:
    equatorial = getattr(acg_result, "equatorial", None)
    if not isinstance(equatorial, dict) or point_id not in equatorial:
        return []
    try:
        ra, dec = map(float, equatorial[point_id])
    except (TypeError, ValueError):
        return []
    lat_range = getattr(acg_result, "lat_range", None)
    if isinstance(lat_range, (list, tuple)) and len(lat_range) >= 2:
        low, high = float(lat_range[0]), float(lat_range[1])
    else:
        low, high = -astrocart.GEOGRAPHIC_LAT_LIMIT, astrocart.GEOGRAPHIC_LAT_LIMIT
    latitude_edge = 90.0 - abs(dec)
    low = max(low, -latitude_edge)
    high = min(high, latitude_edge)
    latitudes = _candidate_latitudes(
        low,
        high,
        absolute_candidates=_HORIZON_LABEL_LATITUDES,
        fractions=_HORIZON_LABEL_FRACTIONS,
        polar_limit=85.0,
    )
    sign = -1.0 if kind == astrocart.LINE_ASC else 1.0
    anchors = []
    for latitude in latitudes:
        cos_h = -tan(radians(latitude)) * tan(radians(dec))
        hour_angle = degrees(acos(max(-1.0, min(1.0, cos_h))))
        ramc = ra + sign * hour_angle
        if mode in _GEODETIC_MERIDIANS and geodetic_obliquity is not None:
            longitude = (
                astrocart._ra_to_ecl_lon(ramc, geodetic_obliquity)
                + _GEODETIC_MERIDIANS[mode]
            )
        else:
            longitude = ramc - float(getattr(acg_result, "theta0_deg", 0.0))
        anchors.append((longitude, latitude))
    return _dedupe_anchors(anchors)


def _local_space_label_anchors(
    *,
    origin_lon: float,
    origin_lat: float,
    bearing: float,
) -> list[list[float]]:
    # Fixed geodesic distances make these candidates independent of the
    # preview/precise sampling step. Drop the origin, where every Local Space
    # label would collide, and stop short of the antipodal end of the ray.
    samples = localspace._sample_geodesic_ray(
        float(origin_lon),
        float(origin_lat),
        float(bearing),
        max_distance_m=_LOCAL_SPACE_LABEL_DISTANCE_METERS,
        step_m=_LOCAL_SPACE_LABEL_STEP_METERS,
    )
    return _dedupe_anchors(samples[1:])


def _inject_label_contract(
    geojson: dict,
    *,
    acg_result,
    mode: str,
    origin_lon: float,
    origin_lat: float,
) -> None:
    geodetic_obliquity = None
    if mode in _GEODETIC_MERIDIANS and acg_result is not None:
        try:
            geodetic_obliquity = astrocart._true_obliquity_deg(float(acg_result.jd_ut))
        except Exception:
            geodetic_obliquity = None
    for feature in geojson.get("features", []):
        if not isinstance(feature, dict):
            continue
        props = feature.setdefault("properties", {})
        if not isinstance(props, dict):
            continue
        kind = str(props.get("kind") or "")
        if kind == "PARAN":
            props["label_id"] = ":".join((
                "paran",
                str(props.get("a_point") or ""),
                str(props.get("a_angle") or "").lower(),
                str(props.get("b_point") or ""),
                str(props.get("b_angle") or "").lower(),
            ))
            coordinate = _first_line_coordinate(feature.get("geometry", {}))
            props["label_anchors"] = (
                [_round_anchor(*coordinate)] if coordinate is not None else []
            )
            continue
        point_id = str(props.get("point") or "")
        if not point_id:
            continue
        if kind in (astrocart.LINE_MC, astrocart.LINE_IC):
            props["label_id"] = f"acg:{point_id}:{kind.lower()}"
            props["label_anchors"] = _meridian_label_anchors(feature, acg_result)
        elif kind in (astrocart.LINE_ASC, astrocart.LINE_DSC):
            props["label_id"] = f"acg:{point_id}:{kind.lower()}"
            props["label_anchors"] = _horizon_label_anchors(
                point_id=point_id,
                kind=kind,
                acg_result=acg_result,
                mode=mode,
                geodetic_obliquity=geodetic_obliquity,
            )
        elif kind == astrocart.LINE_ASPECT:
            props["label_id"] = ":".join((
                "aspect",
                point_id,
                str(props.get("aspect_id") or ""),
                str(props.get("target_angle") or "").lower(),
                str(props.get("branch") or ""),
            ))
            coordinate = _first_line_coordinate(feature.get("geometry", {}))
            props["label_anchors"] = (
                [_round_anchor(*coordinate)] if coordinate is not None else []
            )
        elif kind == astrocart.MARKER_ZENITH:
            props["label_id"] = f"zenith:{point_id}"
            coordinates = feature.get("geometry", {}).get("coordinates")
            if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
                try:
                    props["label_anchors"] = [
                        _round_anchor(float(coordinates[0]), float(coordinates[1]))
                    ]
                except (TypeError, ValueError):
                    props["label_anchors"] = []
        elif kind in (
            localspace.KIND_LOCAL_SPACE,
            localspace.KIND_LOCAL_SPACE_OPPOSITION,
        ):
            label_role = (
                "local-space-opposition"
                if kind == localspace.KIND_LOCAL_SPACE_OPPOSITION
                else "local-space"
            )
            props["label_id"] = f"{label_role}:{point_id}"
            try:
                props["label_anchors"] = _local_space_label_anchors(
                    origin_lon=origin_lon,
                    origin_lat=origin_lat,
                    bearing=float(props["bearing"]),
                )
            except (KeyError, TypeError, ValueError):
                props["label_anchors"] = []


def _chart_geojson_meta(
    radix,
    *,
    source_name: str,
    options,
    precision: str,
    mode: Optional[str] = None,
    local_space_standalone: bool = False,
    spec: Optional[astrocart_spec.AstrocartMapSpec] = None,
    line_system: Optional[str] = None,
    paran_system: Optional[str] = None,
) -> dict:
    is_dark = _is_dark_theme(options)
    page_bg = _hex_bg(
        getattr(options, "clrbackground", None) if options is not None else None,
        "#1a1d21" if is_dark else "#d9dde1",
    )
    local_space_additive = bool(
        getattr(options, "astrocart_localspace_additive", True)
    )
    payload = {
        "radix": source_name,
        "lat": float(radix.place.lat),
        "lon": float(radix.place.lon),
        "theme": "dark" if is_dark else "light",
        "pageBg": page_bg,
        "mode": mode,
        "modeLabel": _mode_label(mode) if mode else "",
        "geodeticMeridian": _GEODETIC_MERIDIANS.get(mode),
        "localSpaceAdditive": local_space_additive and not local_space_standalone,
        "localSpaceStandalone": local_space_standalone,
        "precision": precision,
        "origin": {
            "lat": float(radix.place.lat),
            "lon": float(radix.place.lon),
            "altitude": float(getattr(radix.place, "altitude", 0.0) or 0.0),
        },
    }
    if spec is not None:
        spec_key = spec.cache_key()
        payload.update({
            "specKey": spec_key,
            "specRevision": spec_key[:16],
            "cacheKey": spec_key,
            "coordinateSystem": spec.coordinate_system,
            "lineSystem": line_system or spec.coordinate_system,
            "paranSystem": paran_system or astrocart.LINE_SYSTEM_IN_MUNDO,
        })
        if mode:
            payload["modeSpecKey"] = spec.mode_cache_key(mode)
    return payload


def _unique_points(
    *point_groups: Sequence[astrocart.ACGPoint],
) -> tuple[astrocart.ACGPoint, ...]:
    by_id: dict[str, astrocart.ACGPoint] = {}
    for points in point_groups:
        for point in points:
            by_id.setdefault(point.id, point)
    return tuple(by_id.values())


def _points_with_display_colors(
    points: Sequence[astrocart.ACGPoint],
    *,
    source_options,
    display_options,
) -> tuple[astrocart.ACGPoint, ...]:
    colors = _palette_from_options(
        display_options,
        points,
        index_by_point=_point_palette_indices(source_options, display_options),
    )
    fallback = _astrocart_renderer_style(
        _is_dark_theme(display_options)
    )["fallbackUnknownColor"]
    return tuple(
        replace(
            point,
            color_hex=colors.get(point.id) or point.color_hex or fallback,
        )
        for point in points
    )


def _catalog_with_display_colors(
    catalog: astrocart_spec.AstrocartPointCatalog,
    *,
    source_options,
    display_options,
) -> astrocart_spec.AstrocartPointCatalog:
    colored = {
        point.id: point
        for point in _points_with_display_colors(
            tuple(record.acg_point for record in catalog.records),
            source_options=source_options,
            display_options=display_options,
        )
    }
    return replace(
        catalog,
        records=tuple(
            replace(record, acg_point=colored[record.semantic_id])
            for record in catalog.records
        ),
    )


def _selected_points_for_ids(
    catalog: astrocart_spec.AstrocartPointCatalog,
    point_ids: Sequence[str],
    *,
    role: str,
) -> tuple[astrocart.ACGPoint, ...]:
    selected = set(point_ids)
    return tuple(
        record.acg_point
        for record in catalog.records
        if record.semantic_id in selected
        and record.capability(role).supported
    )


def _engine_aspect_specs(
    definitions: Sequence[astrocart_spec.AstrocartAspectDefinition],
) -> tuple[astrocart.ACGAspectSpec, ...]:
    return tuple(
        astrocart.ACGAspectSpec(
            aspect_id=definition.aspect_id,
            name=definition.aspect_id,
            label_key=f"optmenu.{definition.aspect_id}",
            angle_deg=definition.angle_deg,
        )
        for definition in definitions
        if definition.enabled
    )


def _merge_geojson_features(target: dict, source: Optional[dict]) -> None:
    if not isinstance(source, dict):
        return
    target.setdefault("features", []).extend(source.get("features", ()))


def _physical_overlay_identity(feature: dict) -> Optional[str]:
    """Stable cross-mode identity for physically invariant overlay features."""
    if not isinstance(feature, dict):
        return None
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return None
    kind = str(properties.get("kind") or "")
    if kind not in {"PARAN", astrocart.MARKER_ZENITH}:
        return None
    layer_id = str(
        properties.get("astrocart_layer_id")
        or properties.get("astrocart_layer")
        or "natal"
    )
    if kind == "PARAN":
        semantic = (
            properties.get("a_point"),
            properties.get("a_angle"),
            properties.get("b_point"),
            properties.get("b_angle"),
        )
    else:
        semantic = (properties.get("point"),)
    geometry = feature.get("geometry")
    return json.dumps(
        (layer_id, kind, semantic, geometry),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )


def _all_aspect_payloads() -> list[dict]:
    return [
        {
            "id": definition.aspect_id,
            "labelKey": f"optmenu.{definition.aspect_id}",
            "angleDeg": definition.angle_deg,
            "enabled": True,
        }
        for definition in astrocart.ECLIPTIC_ASPECT_SPECS
        if definition.aspect_id
        not in astrocart_spec.REDUNDANT_ASPECT_TO_ANGLE_IDS
    ]


def _dynamic_technique_payloads() -> list[dict]:
    return [
        {
            "id": technique,
            "labelKey": f"astrocart.dynamic.{technique}",
        }
        for technique in astrocart_spec.DYNAMIC_TECHNIQUES
    ]


class AstrocartService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._city_index_lock = threading.Lock()
        self._city_index_loaded = False
        self._city_index: Optional[_CityLabelIndex] = None
        self._city_index_error: Optional[str] = None
        self._city_index_load_ms = 0.0

    def _get_city_label_index(
        self,
    ) -> tuple[Optional[_CityLabelIndex], Optional[str], float, bool]:
        # City-label disk/index work must never queue behind precise astrology
        # calculation, which is serialized separately by ``self._lock``.
        with self._city_index_lock:
            cached = self._city_index_loaded
            if not self._city_index_loaded:
                index, error, load_ms = _load_city_label_index(_bundled_city_labels_path())
                self._city_index = index
                self._city_index_error = error
                self._city_index_load_ms = load_ms
                self._city_index_loaded = True
            return (
                self._city_index,
                self._city_index_error,
                self._city_index_load_ms,
                cached,
            )

    def prewarm_city_labels(self) -> None:
        """Build the compact world-label index before the first map opens."""
        self._get_city_label_index()

    def _catalog_and_spec(
        self,
        radix,
        *,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> tuple[
        astrocart_spec.AstrocartPointCatalog,
        astrocart_spec.AstrocartMapSpec,
    ]:
        resolved_catalog = catalog or astrocart_spec.build_point_catalog(
            radix,
            chart_snapshot_service.options,
        )
        if spec is None:
            normalized = astrocart_spec.AstrocartMapSpec.default_for_catalog(
                resolved_catalog
            )
        else:
            normalized = astrocart_spec.normalize_spec_for_catalog(
                spec,
                resolved_catalog,
            )
        return resolved_catalog, normalized

    def configuration_payload_for_chart(
        self,
        radix,
        *,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> dict:
        """Authoritative retained-map configuration without ACG calculation."""
        resolved_catalog, normalized = self._catalog_and_spec(
            radix,
            spec=spec,
            catalog=catalog,
        )
        default_spec = astrocart_spec.AstrocartMapSpec.default_for_catalog(
            resolved_catalog
        )
        spec_key = normalized.cache_key()
        return {
            "schema": astrocart_spec.ASTROCART_MAP_SPEC_SCHEMA,
            "schemaVersion": astrocart_spec.ASTROCART_MAP_SPEC_SCHEMA_VERSION,
            "spec": normalized.to_payload(),
            "defaultSpec": default_spec.to_payload(),
            "catalog": resolved_catalog.to_payload(),
            "aspects": _all_aspect_payloads(),
            "dynamicTechniques": _dynamic_technique_payloads(),
            "coordinateSystems": list(astrocart_spec.COORDINATE_SYSTEMS),
            "angleKinds": list(astrocart_spec.ANGLE_KINDS),
            "specKey": spec_key,
            "specRevision": spec_key[:16],
            "cacheKey": spec_key,
            "modeSpecKeys": normalized.mode_cache_keys(),
        }

    def display_style_for_chart(self, radix) -> dict:
        """One immutable-versioned map style, derived without any ACG math."""
        legacy_points = astrocart.points_from_chart(radix)
        catalog = astrocart_spec.build_point_catalog(
            radix,
            chart_snapshot_service.options,
        )
        points = _unique_points(
            legacy_points,
            tuple(record.acg_point for record in catalog.records),
            (astrocart.natal_ascendant_point_from_chart(radix),),
        )
        return self._display_style_for_points(points)

    def asterisms_geojson_for_chart(self, radix) -> dict:
        """Date-correct all-sky figures plus system-aware celestial references."""
        started = time.perf_counter()
        catalog = asterism_projection.load_catalog(_bundled_asterism_path())
        stars = asterism_projection.load_catalog(_bundled_asterism_star_path())
        opts = effective_display_options(chart_snapshot_service.options)
        signs = common.common.Signs1 if getattr(opts, "signs", True) else common.common.Signs2
        house_system_code = str(
            getattr(radix.houses, "ui_hsys", getattr(radix.houses, "hsys", "")) or ""
        )
        house_cusps = () if house_system_code == "N" else tuple(radix.houses.cusps[1:13])
        payload = asterism_projection.build_geojson(
            catalog,
            float(radix.time.jd),
            star_catalog=stars,
            observer_lon=float(radix.place.lon),
            observer_lat=float(radix.place.lat),
            obliquity_deg=float(radix.obl[0]),
            zodiac_offset_deg=float(getattr(radix, "ayanamsha_offset", 0.0) or 0.0),
            sign_glyphs=signs,
            house_cusps=house_cusps,
            house_system_code=house_system_code,
        )
        payload.setdefault("meta", {})["projectMs"] = round(
            (time.perf_counter() - started) * 1000.0,
            3,
        )
        return _presentation_geojson(payload)

    def display_style_for_default_location(self) -> dict:
        """Global map style for the chartless Default Location picker.

        The picker shares map.html and its complete renderer/chrome contract,
        but has no radix and must never trigger ACG or point calculation.
        """
        return self._display_style_for_points(())

    def _display_style_for_points(self, points: Sequence[astrocart.ACGPoint]) -> dict:
        opts = chart_snapshot_service.options
        try:
            # Runtime import avoids the options-service/chart-service module
            # cycle. The non-mutating adapter applies a chart-scoped profile
            # base plus scalar chart colors without touching live options.
            from webapp.daemon.options_service import options_service

            active_profile, effective_opts = options_service.get_style_chart_render_context(opts)
        except Exception:
            active_profile = None
            effective_opts = opts
        colors = _palette_from_options(
            effective_opts,
            points,
            index_by_point=_point_palette_indices(opts, effective_opts),
        )
        is_dark = _is_dark_theme(effective_opts)
        renderer_style = _astrocart_renderer_style(is_dark)
        renderer_style["countryLabelsOn"] = bool(
            getattr(opts, "astrocart_show_country_labels", True)
        )
        # Celestial guides use the same authored chart palette as their wheel
        # counterparts. Map-specific profile roles can still override these
        # resolved defaults in _apply_astrocart_profile below.
        renderer_style["referenceEclipticColor"] = _hex_bg(
            getattr(effective_opts, "clrsigns", None),
            renderer_style["referenceEclipticColor"],
        )
        renderer_style["referenceEquatorColor"] = _hex_bg(
            getattr(effective_opts, "clrframe", None),
            renderer_style["referenceEquatorColor"],
        )
        angle_color = _hex_bg(
            getattr(effective_opts, "clrAscMC", None),
            renderer_style["referenceAscColor"],
        )
        renderer_style["referenceAscColor"] = angle_color
        renderer_style["referenceMcColor"] = angle_color
        renderer_style["referenceHouseGridColor"] = _hex_bg(
            getattr(effective_opts, "clrhouses", None),
            renderer_style["referenceHouseGridColor"],
        )
        renderer_style["referenceZodiacGridColor"] = _hex_bg(
            getattr(effective_opts, "clrsigns", None),
            renderer_style["referenceZodiacGridColor"],
        )
        point_styles = {}
        fallback_point_ids: set[str] = set()
        for point in points:
            if (
                point.id != astrocart.NATAL_ASC_POINT_ID
                and point.id not in colors
                and not point.color_hex
            ):
                fallback_point_ids.add(point.id)
            color = (
                colors.get(point.id)
                or point.color_hex
                or renderer_style["fallbackUnknownColor"]
            )
            if point.id == astrocart.NATAL_ASC_POINT_ID:
                color = angle_color
            point_styles[point.id] = {
                "label": mtexts.txts.get(point.label, point.label),
                "color": color or "",
                "glyphMorinus": _morinus_glyph_for(point.id, effective_opts),
                "lineWidthScale": 1.0,
                "lineOpacity": 1.0,
            }
        # Zodiac glyph choice is a live display option. Carry it in the cheap
        # style payload as point-like renderer metadata so an open map updates
        # immediately without rebuilding the celestial reference geometry.
        signs = common.common.Signs1 if getattr(effective_opts, "signs", True) else common.common.Signs2
        sign_color = renderer_style["referenceEclipticColor"]
        element_colors = (
            "clrsignelementfire",
            "clrsignelementearth",
            "clrsignelementair",
            "clrsignelementwater",
        )
        use_element_colors = bool(getattr(effective_opts, "usezodiacelementcolors", False))
        for sign_index, glyph in enumerate(signs):
            glyph_color = sign_color
            if use_element_colors:
                glyph_color = _hex_bg(
                    getattr(effective_opts, element_colors[sign_index % 4], None),
                    sign_color,
                )
            point_styles[f"zodiac_sign_{sign_index}"] = {
                "label": "",
                "color": glyph_color,
                "glyphMorinus": glyph,
                "lineWidthScale": 1.0,
                "lineOpacity": 1.0,
            }
        page_bg = _hex_bg(
            getattr(effective_opts, "clrbackground", None) if effective_opts is not None else None,
            "#1a1d21" if is_dark else "#d9dde1",
        )
        payload = {
            "schemaVersion": ASTROCART_STYLE_SCHEMA_VERSION,
            "mode": "dark" if is_dark else "light",
            "chrome": _astrocart_chrome_style(is_dark, page_bg),
            "renderer": renderer_style,
            "points": point_styles,
            "behavior": {
                "showEcliptic": bool(getattr(opts, "astrocart_show_ecliptic", False)),
                "showEquator": bool(getattr(opts, "astrocart_show_equator", False)),
                "showAscCircle": bool(getattr(opts, "astrocart_show_asc_circle", False)),
                "showMcCircle": bool(getattr(opts, "astrocart_show_mc_circle", False)),
                "showHouseLines": bool(getattr(opts, "astrocart_show_house_lines", False)),
                "showZodiacLines": bool(getattr(opts, "astrocart_show_zodiac_lines", False)),
            },
        }
        _apply_astrocart_profile(payload, active_profile)
        resolved_unknown_color = payload["renderer"]["fallbackUnknownColor"]
        for point_id in fallback_point_ids:
            point_style = payload["points"].get(point_id)
            if isinstance(point_style, dict):
                point_style["color"] = resolved_unknown_color
        style_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        return {
            **payload,
            "styleRevision": style_hash,
            "styleHash": style_hash,
        }

    def basemap_meta(self) -> dict:
        """Local PMTiles availability for the shared map.html host.

        This mirrors wx's load contract: pass a local ``tiles=`` URL when an
        archive exists, but let map.html stay online-first unless explicitly
        launched with ``offline=1``.
        """
        path, installing = astrocart_tiles.default_install_state()
        if not path:
            return {
                "hasLocalTiles": False,
                "tilesUrl": None,
                "installing": installing,
            }
        return {
            "hasLocalTiles": True,
            # The main authenticated daemon serves this stable resource route.
            # Do not spin up astrocart_tiles' auxiliary random-port HTTP server.
            "tilesUrl": "/astrocart/basemap.pmtiles",
            "installing": installing,
        }

    def city_labels_geojson(
        self,
        *,
        west: float,
        south: float,
        east: float,
        north: float,
        zoom: float,
        limit: Optional[int] = None,
    ) -> dict:
        """Fast offline labels from the canonical compact bundled index.

        The online map keeps provider-owned labels. This endpoint exists only
        for local/minimal offline basemaps and intentionally preserves the
        curated label set instead of exposing the full cities500 database.
        """
        started = time.perf_counter()
        try:
            west_f = float(west)
            east_f = float(east)
            south_f = max(-90.0, min(90.0, float(south)))
            north_f = max(-90.0, min(90.0, float(north)))
        except (TypeError, ValueError):
            raise ValueError("invalid map bounds")
        if south_f > north_f:
            south_f, north_f = north_f, south_f

        zoom_f = float(zoom)
        max_level, min_pop, default_limit = _city_label_budget(zoom_f)
        row_limit = _clamp_label_limit(limit, default_limit)

        raw_span = east_f - west_f
        if raw_span < 0:
            raw_span += 360.0
        covers_world = raw_span >= 359.0 or abs(east_f - west_f) >= 359.0
        west_n = _normalize_lon(west_f)
        east_n = _normalize_lon(east_f)

        index, index_error, load_ms, cached = self._get_city_label_index()
        if index is None:
            return _presentation_geojson({
                "type": "FeatureCollection",
                "features": [],
                "meta": {
                    "source": "places.geojson",
                    "available": False,
                    "reason": index_error or "unavailable",
                    "cached": cached,
                    "loadMs": round(load_ms, 3),
                    "queryMs": round((time.perf_counter() - started) * 1000.0, 3),
                },
            })

        low_index = bisect.bisect_left(index.latitudes, south_f)
        high_index = bisect.bisect_right(index.latitudes, north_f)
        candidates = index.rows_by_latitude[low_index:high_index]

        def longitude_visible(longitude: float) -> bool:
            if covers_world:
                return True
            normalized = _normalize_lon(longitude)
            if west_n <= east_n:
                return west_n <= normalized <= east_n
            return normalized >= west_n or normalized <= east_n

        rows = [
            row for row in candidates
            if (row.level <= max_level or row.population >= min_pop)
            and longitude_visible(row.longitude)
        ]
        # Match places.geojson/map.html exactly: level first, population second,
        # then retain the canonical generated-resource order for stable ties.
        rows.sort(key=lambda row: (row.level, -row.population, row.canonical_rank))
        rows = rows[:row_limit]

        features = _city_label_features(rows)

        return _presentation_geojson({
            "type": "FeatureCollection",
            "features": features,
            "meta": {
                "source": "places.geojson",
                "available": True,
                "cached": cached,
                "rowCount": len(features),
                "indexRowCount": index.row_count,
                "candidateCount": len(candidates),
                "zoom": zoom_f,
                "maxLevel": max_level,
                "minPopulation": min_pop,
                "limit": row_limit,
                "loadMs": round(load_ms, 3),
                "queryMs": round((time.perf_counter() - started) * 1000.0, 3),
            },
        })

    def _geojson_for_chart(
        self,
        radix,
        *,
        source_name: str,
        mode: Optional[str] = None,
        precision: Optional[str] = None,
        local_space_standalone: bool = False,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> dict:
        mode = _normalize_mode(mode)
        precision = _normalize_precision(precision)
        opts = chart_snapshot_service.options
        display_opts = effective_display_options(opts)
        resolved_catalog, normalized_spec = self._catalog_and_spec(
            radix,
            spec=spec,
            catalog=catalog,
        )

        # Keep every existing no-spec caller's point selection and calculation
        # path compatible while the retained workspace moves to the canonical
        # semantic specification. The authoritative default spec is still
        # attached to metadata/configuration.
        if spec is None:
            return self._legacy_geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=precision,
                local_space_standalone=local_space_standalone,
                normalized_spec=normalized_spec,
                display_opts=display_opts,
            )

        colored_catalog = _catalog_with_display_colors(
            resolved_catalog,
            source_options=opts,
            display_options=display_opts,
        )
        static_role = (
            astrocart_spec.ROLE_LOCAL_SPACE_TRUE_RAY
            if mode == ASTROCART_MODE_LOCAL_SPACE
            else astrocart_spec.ROLE_ANGULAR_LINE_SOURCE
        )
        static_points = _selected_points_for_ids(
            colored_catalog,
            normalized_spec.selected_point_ids,
            role=static_role,
        )
        labels = _catalog_labels(colored_catalog)
        compute_kwargs = _precision_compute_kwargs(precision)

        geodetic_meridian = _GEODETIC_MERIDIANS.get(mode)
        local_space_additive = bool(
            getattr(opts, "astrocart_localspace_additive", True)
        )
        primary_result = None
        include_natal_ascendant = False
        dynamic_enabled = False
        if mode == ASTROCART_MODE_LOCAL_SPACE:
            local_kwargs = {
                "include_oppositions": (
                    normalized_spec.local_space_opposition_enabled
                ),
            }
            if precision == ASTROCART_PRECISION_PREVIEW:
                local_kwargs["step_m"] = _PREVIEW_LOCAL_SPACE_STEP_METERS
            local_result = localspace.compute_local_space_for_chart(
                radix,
                points=static_points,
                **local_kwargs,
            )
            local_geojson = local_result.to_geojson()
            _inject_label_contract(
                local_geojson,
                acg_result=None,
                mode=mode,
                origin_lon=float(radix.place.lon),
                origin_lat=float(radix.place.lat),
            )
            if local_space_standalone:
                geojson = local_geojson
            else:
                geojson, primary_result = self._advanced_standard_geojson(
                    radix,
                    normalized_spec,
                    colored_catalog,
                    compute_kwargs,
                    mode=mode,
                )
                if not local_space_additive:
                    geojson["features"] = [
                        feature
                        for feature in geojson.get("features", ())
                        if feature.get("properties", {}).get("kind") == "PARAN"
                    ]
                else:
                    include_natal_ascendant = True
                    dynamic_enabled = True
                _merge_geojson_features(geojson, local_geojson)
        elif geodetic_meridian is None:
            geojson, primary_result = self._advanced_standard_geojson(
                radix,
                normalized_spec,
                colored_catalog,
                compute_kwargs,
                mode=mode,
            )
            include_natal_ascendant = True
            dynamic_enabled = True
        else:
            geojson, primary_result = self._advanced_geodetic_geojson(
                radix,
                normalized_spec,
                colored_catalog,
                compute_kwargs,
                meridian_lon=geodetic_meridian,
                mode=mode,
            )
            include_natal_ascendant = True
            dynamic_enabled = True

        if include_natal_ascendant and any(
            kind in normalized_spec.selected_angle_kinds
            for kind in (astrocart.LINE_ASC, astrocart.LINE_DSC)
        ):
            _append_natal_ascendant_lines(
                geojson,
                radix,
                display_opts,
                compute_kwargs,
                kinds=normalized_spec.selected_angle_kinds,
                geodetic_meridian_lon=geodetic_meridian,
            )

        dynamic_meta = (
            self._append_dynamic_layers(
                geojson,
                radix,
                normalized_spec,
                colored_catalog,
                compute_kwargs,
                mode=mode,
                geodetic_meridian_lon=geodetic_meridian,
            )
            if dynamic_enabled
            else []
        )

        _inject_glyphs(geojson, display_opts, label_by_point=labels)
        _stamp_feature_contract(geojson)
        line_system = getattr(
            primary_result,
            "line_system",
            normalized_spec.coordinate_system,
        )
        paran_system = getattr(
            primary_result,
            "paran_system",
            astrocart.LINE_SYSTEM_IN_MUNDO,
        )
        geojson["meta"] = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=display_opts,
            precision=precision,
            mode=mode,
            local_space_standalone=local_space_standalone,
            spec=normalized_spec,
            line_system=line_system,
            paran_system=paran_system,
        )
        if dynamic_meta:
            geojson["meta"]["dynamicLayers"] = dynamic_meta
        return geojson

    def _append_dynamic_layers(
        self,
        geojson: dict,
        radix,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
        compute_kwargs: dict,
        *,
        mode: str,
        geodetic_meridian_lon: Optional[float],
    ) -> list[dict]:
        dynamic_meta: list[dict] = []
        for layer in spec.dynamic_layers:
            dynamic_result = astrocart_dynamic.compute_dynamic_layer(
                radix,
                catalog,
                layer,
                coordinate_system=spec.coordinate_system,
                kinds=spec.selected_angle_kinds,
                include_parans=False,
                include_zenith_markers=spec.zenith_enabled,
                geodetic_meridian_lon=geodetic_meridian_lon,
                **compute_kwargs,
            )
            if dynamic_result is None:
                continue
            dynamic_payload = dynamic_result.to_geojson()
            _inject_label_contract(
                dynamic_payload,
                acg_result=dynamic_result.acg_result,
                mode=mode,
                origin_lon=float(radix.place.lon),
                origin_lat=float(radix.place.lat),
            )
            _merge_geojson_features(geojson, dynamic_payload)
            layer_meta = dynamic_payload.get("metadata", {}).get(
                "dynamic_layer",
                {},
            )
            if isinstance(layer_meta, dict):
                dynamic_meta.append(layer_meta)
        return dynamic_meta

    def _dynamic_only_geojson(
        self,
        radix,
        *,
        source_name: str,
        precision: str,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
    ) -> dict:
        """Compute timing geometry when every natal line mode is hidden."""
        opts = chart_snapshot_service.options
        display_opts = effective_display_options(opts)
        colored_catalog = _catalog_with_display_colors(
            catalog,
            source_options=opts,
            display_options=display_opts,
        )
        compute_kwargs = _precision_compute_kwargs(precision)

        geojson = {
            "type": "FeatureCollection",
            "features": [],
        }
        dynamic_meta = self._append_dynamic_layers(
            geojson,
            radix,
            spec,
            colored_catalog,
            compute_kwargs,
            mode=ASTROCART_MODE_STANDARD,
            geodetic_meridian_lon=None,
        )
        for feature in geojson["features"]:
            feature.setdefault("properties", {}).setdefault(
                "astrocart_mode",
                ASTROCART_MODE_STANDARD,
            )
        _inject_glyphs(
            geojson,
            display_opts,
            label_by_point=_catalog_labels(colored_catalog),
        )
        _stamp_feature_contract(geojson)
        meta = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=display_opts,
            precision=precision,
            spec=spec,
            line_system=spec.coordinate_system,
            paran_system=astrocart.LINE_SYSTEM_IN_MUNDO,
        )
        meta.update({
            "composite": True,
            "modes": [],
            "modeLabels": [],
            "localSpaceAdditive": False,
            "lineSystems": {},
            "paranSystems": {},
        })
        if dynamic_meta:
            meta["dynamicLayers"] = dynamic_meta
        geojson["meta"] = meta
        return geojson

    def _legacy_geojson_for_chart(
        self,
        radix,
        *,
        source_name: str,
        mode: str,
        precision: str,
        local_space_standalone: bool,
        normalized_spec: astrocart_spec.AstrocartMapSpec,
        display_opts,
    ) -> dict:
        opts = chart_snapshot_service.options
        points = astrocart.points_from_chart(radix)
        colors = _palette_from_options(
            display_opts,
            points,
            index_by_point=_point_palette_indices(opts, display_opts),
        )
        if colors:
            points = tuple(
                astrocart.ACGPoint(
                    id=p.id, label=p.label, kind=p.kind,
                    body_id=p.body_id, star_name=p.star_name,
                    ecliptic=p.ecliptic, antipode=p.antipode,
                    color_hex=colors.get(p.id, p.color_hex),
                )
                for p in points
            )
        compute_kwargs = _precision_compute_kwargs(precision)
        geodetic_meridian = _GEODETIC_MERIDIANS.get(mode)
        local_space_additive = bool(getattr(opts, "astrocart_localspace_additive", True))
        include_natal_ascendant = False
        primary_result = None
        if mode == ASTROCART_MODE_LOCAL_SPACE:
            local_kwargs = {}
            if precision == ASTROCART_PRECISION_PREVIEW:
                local_kwargs = {"step_m": _PREVIEW_LOCAL_SPACE_STEP_METERS}
            local_result = localspace.compute_local_space_for_chart(
                radix,
                points=points,
                **local_kwargs,
            )
            geojson = local_result.to_geojson()
            if not local_space_standalone:
                acg_result = astrocart.compute_acg_for_chart(
                    radix,
                    points=points,
                    **compute_kwargs,
                )
                primary_result = acg_result
                acg_geojson = acg_result.to_geojson()
                if not local_space_additive:
                    acg_geojson["features"] = [
                        feature for feature in acg_geojson.get("features", [])
                        if feature.get("properties", {}).get("kind") == "PARAN"
                    ]
                else:
                    include_natal_ascendant = True
                acg_geojson.setdefault("features", []).extend(geojson.get("features", []))
                geojson = acg_geojson
        elif geodetic_meridian is None:
            result = astrocart.compute_acg_for_chart(radix, points=points, **compute_kwargs)
            primary_result = result
            geojson = result.to_geojson()
            include_natal_ascendant = True
        else:
            result = astrocart.compute_geodetic_acg_for_chart(
                radix,
                points=points,
                meridian_lon=geodetic_meridian,
                **compute_kwargs,
            )
            primary_result = result
            geojson = result.to_geojson()
        if include_natal_ascendant:
            _append_natal_ascendant_lines(
                geojson,
                radix,
                display_opts,
                compute_kwargs,
            )
        _inject_glyphs(geojson, display_opts)
        _stamp_feature_contract(geojson)
        geojson["meta"] = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=display_opts,
            precision=precision,
            mode=mode,
            local_space_standalone=local_space_standalone,
            spec=normalized_spec,
            line_system=getattr(
                primary_result,
                "line_system",
                normalized_spec.coordinate_system,
            ),
            paran_system=getattr(
                primary_result,
                "paran_system",
                astrocart.LINE_SYSTEM_IN_MUNDO,
            ),
        )
        return geojson

    def _advanced_standard_geojson(
        self,
        radix,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
        compute_kwargs: dict,
        *,
        mode: str,
    ) -> tuple[dict, object]:
        compute = (
            astrocart.compute_zodiacal_acg_for_chart
            if spec.coordinate_system == astrocart_spec.COORDINATE_ZODIACAL
            else astrocart.compute_acg_for_chart
        )
        return self._advanced_angular_geojson(
            radix,
            spec,
            catalog,
            compute_kwargs,
            mode=mode,
            compute=compute,
            engine_kwargs={},
        )

    def _advanced_geodetic_geojson(
        self,
        radix,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
        compute_kwargs: dict,
        *,
        meridian_lon: float,
        mode: str,
    ) -> tuple[dict, object]:
        return self._advanced_angular_geojson(
            radix,
            spec,
            catalog,
            compute_kwargs,
            mode=mode,
            compute=astrocart.compute_geodetic_acg_for_chart,
            engine_kwargs={"meridian_lon": meridian_lon},
        )

    def _advanced_angular_geojson(
        self,
        radix,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
        compute_kwargs: dict,
        *,
        mode: str,
        compute,
        engine_kwargs: dict,
    ) -> tuple[dict, object]:
        static_points = _selected_points_for_ids(
            catalog,
            spec.selected_point_ids,
            role=astrocart_spec.ROLE_ANGULAR_LINE_SOURCE,
        )
        zenith_points = _selected_points_for_ids(
            catalog,
            spec.selected_point_ids,
            role=astrocart_spec.ROLE_ZENITH,
        )
        zeniths_share_angular_sources = tuple(
            point.id for point in zenith_points
        ) == tuple(point.id for point in static_points)
        common_engine_kwargs = {**compute_kwargs, **engine_kwargs}
        primary_result = compute(
            radix,
            points=static_points,
            kinds=spec.selected_angle_kinds,
            include_parans=False,
            include_zenith_markers=(
                spec.zenith_enabled and zeniths_share_angular_sources
            ),
            aspects=(),
            **common_engine_kwargs,
        )
        geojson = primary_result.to_geojson()
        if (
            spec.zenith_enabled
            and zenith_points
            and not zeniths_share_angular_sources
        ):
            zenith_result = compute(
                radix,
                points=zenith_points,
                kinds=(),
                include_parans=False,
                include_zenith_markers=True,
                aspects=(),
                **common_engine_kwargs,
            )
            zenith_geojson = zenith_result.to_geojson()
            zenith_geojson["features"] = [
                feature
                for feature in zenith_geojson.get("features", ())
                if feature.get("properties", {}).get("kind")
                == astrocart.MARKER_ZENITH
            ]
            _inject_label_contract(
                zenith_geojson,
                acg_result=zenith_result,
                mode=mode,
                origin_lon=float(radix.place.lon),
                origin_lat=float(radix.place.lat),
            )
            _merge_geojson_features(geojson, zenith_geojson)
        self._append_separate_parans(
            geojson,
            radix,
            spec,
            catalog,
            compute_kwargs,
            mode=mode,
            display_line_system=str(primary_result.line_system),
        )

        aspect_points = _selected_points_for_ids(
            catalog,
            spec.aspect_actor_ids,
            role=astrocart_spec.ROLE_ASPECT_TO_ANGLE_SOURCE,
        )
        aspect_specs = _engine_aspect_specs(spec.aspect_definitions)
        if aspect_points and aspect_specs and spec.aspect_target_angles:
            aspect_result = compute(
                radix,
                points=aspect_points,
                kinds=(),
                include_parans=False,
                include_zenith_markers=False,
                aspects=aspect_specs,
                aspect_targets=spec.aspect_target_angles,
                **common_engine_kwargs,
            )
            aspect_geojson = aspect_result.to_geojson()
            _inject_label_contract(
                aspect_geojson,
                acg_result=aspect_result,
                mode=mode,
                origin_lon=float(radix.place.lon),
                origin_lat=float(radix.place.lat),
            )
            _merge_geojson_features(geojson, aspect_geojson)

        _inject_label_contract(
            geojson,
            acg_result=primary_result,
            mode=mode,
            origin_lon=float(radix.place.lon),
            origin_lat=float(radix.place.lat),
        )
        return geojson, primary_result

    def _append_separate_parans(
        self,
        geojson: dict,
        radix,
        spec: astrocart_spec.AstrocartMapSpec,
        catalog: astrocart_spec.AstrocartPointCatalog,
        compute_kwargs: dict,
        *,
        mode: str,
        display_line_system: str,
    ) -> None:
        if not spec.paran_enabled:
            return
        participants = _selected_points_for_ids(
            catalog,
            spec.paran_participant_ids,
            role=astrocart_spec.ROLE_PARAN_PARTICIPANT,
        )
        if len(participants) < 2:
            return
        result = astrocart.compute_acg_for_chart(
            radix,
            points=participants,
            kinds=(),
            include_parans=True,
            include_zenith_markers=False,
            aspects=(),
            **compute_kwargs,
        )
        payload = result.to_geojson()
        payload["features"] = [
            feature
            for feature in payload.get("features", ())
            if feature.get("properties", {}).get("kind") == "PARAN"
        ]
        for feature in payload["features"]:
            properties = feature.setdefault("properties", {})
            properties["line_system"] = astrocart.LINE_SYSTEM_IN_MUNDO
            properties["display_line_system"] = display_line_system
        _inject_label_contract(
            payload,
            acg_result=result,
            mode=mode,
            origin_lon=float(radix.place.lon),
            origin_lat=float(radix.place.lat),
        )
        _merge_geojson_features(geojson, payload)

    def _geojson_for_chart_modes(
        self,
        radix,
        *,
        source_name: str,
        modes: Sequence[str],
        precision: Optional[str] = None,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> dict:
        normalized_modes = _normalize_modes(modes)
        normalized_precision = _normalize_precision(precision)
        resolved_catalog, normalized_spec = self._catalog_and_spec(
            radix,
            spec=spec,
            catalog=catalog,
        )
        if not normalized_modes:
            return self._dynamic_only_geojson(
                radix,
                source_name=source_name,
                precision=normalized_precision,
                spec=normalized_spec,
                catalog=resolved_catalog,
            )
        features = []
        physical_overlay_indices: dict[str, int] = {}
        line_system_by_mode: dict[str, str] = {}
        paran_system_by_mode: dict[str, str] = {}
        dynamic_layers_by_id: dict[str, dict] = {}
        for mode in normalized_modes:
            payload = self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=normalized_precision,
                local_space_standalone=mode == ASTROCART_MODE_LOCAL_SPACE,
                spec=spec,
                catalog=resolved_catalog,
            )
            payload_meta = payload.get("meta", {})
            if isinstance(payload_meta, dict):
                line_system_by_mode[mode] = str(
                    payload_meta.get("lineSystem")
                    or normalized_spec.coordinate_system
                )
                paran_system_by_mode[mode] = str(
                    payload_meta.get("paranSystem")
                    or astrocart.LINE_SYSTEM_IN_MUNDO
                )
                for layer_metadata in payload_meta.get("dynamicLayers", ()):
                    if not isinstance(layer_metadata, dict):
                        continue
                    layer_id = str(layer_metadata.get("id") or "")
                    if layer_id:
                        dynamic_layers_by_id.setdefault(
                            layer_id,
                            dict(layer_metadata),
                        )
            for feature in payload.get("features", []):
                feature_copy = dict(feature)
                properties = dict(feature.get("properties", {}))
                properties["astrocart_mode"] = mode
                physical_identity = _physical_overlay_identity(feature)
                if physical_identity is not None:
                    display_line_system = str(
                        properties.get("display_line_system")
                        or line_system_by_mode.get(mode)
                        or ""
                    )
                    existing_index = physical_overlay_indices.get(physical_identity)
                    if existing_index is not None:
                        existing_properties = features[existing_index].setdefault(
                            "properties",
                            {},
                        )
                        existing_modes = existing_properties.setdefault(
                            "astrocart_modes",
                            [existing_properties.get("astrocart_mode")],
                        )
                        if mode not in existing_modes:
                            existing_modes.append(mode)
                        existing_display_systems = existing_properties.setdefault(
                            "display_line_systems",
                            [existing_properties.get("display_line_system")],
                        )
                        if (
                            display_line_system
                            and display_line_system not in existing_display_systems
                        ):
                            existing_display_systems.append(display_line_system)
                        existing_properties.setdefault(
                            "display_line_system_by_mode",
                            {},
                        )[mode] = display_line_system
                        continue
                    properties["astrocart_modes"] = [mode]
                    if display_line_system:
                        properties["display_line_system"] = display_line_system
                        properties["display_line_systems"] = [
                            display_line_system
                        ]
                        properties["display_line_system_by_mode"] = {
                            mode: display_line_system
                        }
                label_id = properties.get("label_id")
                if label_id:
                    properties["label_id"] = f"{mode}:{label_id}"
                feature_copy["properties"] = properties
                if "id" in feature_copy:
                    feature_copy["id"] = f"{mode}:{feature_copy['id']}"
                if physical_identity is not None:
                    physical_overlay_indices[physical_identity] = len(features)
                features.append(feature_copy)

        opts = effective_display_options(chart_snapshot_service.options)
        single_line_system = (
            line_system_by_mode[normalized_modes[0]]
            if len(normalized_modes) == 1
            else normalized_spec.coordinate_system
        )
        single_paran_system = (
            paran_system_by_mode[normalized_modes[0]]
            if len(normalized_modes) == 1
            else astrocart.LINE_SYSTEM_IN_MUNDO
        )
        meta = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=opts,
            precision=normalized_precision,
            spec=normalized_spec,
            line_system=single_line_system,
            paran_system=single_paran_system,
        )
        meta.update({
            "composite": True,
            "modes": list(normalized_modes),
            "modeLabels": [_mode_label(mode) for mode in normalized_modes],
            "localSpaceAdditive": ASTROCART_MODE_LOCAL_SPACE in normalized_modes,
            "lineSystems": line_system_by_mode,
            "paranSystems": paran_system_by_mode,
        })
        if dynamic_layers_by_id:
            meta["dynamicLayers"] = list(dynamic_layers_by_id.values())
        return {
            "type": "FeatureCollection",
            "features": features,
            "meta": meta,
        }

    def lines_geojson_for_chart(
        self,
        radix,
        *,
        source_name: str,
        mode: Optional[str] = None,
        precision: Optional[str] = None,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> dict:
        with self._lock:
            payload = self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=precision,
                spec=spec,
                catalog=catalog,
            )
        return _presentation_geojson(payload)

    def lines_geojson_for_chart_modes(
        self,
        radix,
        *,
        source_name: str,
        modes: Sequence[str],
        precision: Optional[str] = None,
        spec=None,
        catalog: Optional[astrocart_spec.AstrocartPointCatalog] = None,
    ) -> dict:
        with self._lock:
            payload = self._geojson_for_chart_modes(
                radix,
                source_name=source_name,
                modes=modes,
                precision=precision,
                spec=spec,
                catalog=catalog,
            )
        return _presentation_geojson(payload)

    def lines_geojson(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        mode: Optional[str] = None,
        precision: Optional[str] = None,
        spec=None,
    ) -> dict:
        with self._lock:
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            radix, _ = export_chart_json.load_chart(source_path, opts, name=source_name)
            payload = self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=precision,
                spec=spec,
            )
        return _presentation_geojson(payload)


astrocart_service = AstrocartService()
