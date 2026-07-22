"""Daemon-side astrocartography line computation.

Wraps astrocart.compute_acg_for_chart (wx-free, lives in the engine root)
to produce the GeoJSON FeatureCollection the React-embedded
Res/astrocart/map.html consumes via window.ACG.setData(...).

The wx host (astrocartframe.py) does the same conversion before pushing
via WebView.RunScript; we port the palette (_brighten_floor + _palette_from_options),
glyph-injection and theme helpers inline so we don't have to import
astrocartframe (which depends on wx).

Scope: this service ships only the static line/paran GeoJSON plus theme
derivation. Interactive/stateful edges of the wx host are NOT ported here and
are tracked as explicit deferrals in doc/migration/wiring/astrocart.md §7:
eclipse-path overlay, map-click line callback, right-click "open chart here"
relocation/transit/solar children, in-map keyboard forwarding, viewport state
persistence, PMTiles offline basemap and Nominatim UA identification.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass
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
from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon.display_palette import effective_display_options
from webapp.frontend.scripts import export_chart_json

ASTROCART_MODE_STANDARD = "standard"
ASTROCART_MODE_GEODETIC_GREENWICH = "geodetic_greenwich"
ASTROCART_MODE_GEODETIC_GIZA = "geodetic_giza"
ASTROCART_MODE_LOCAL_SPACE = "local_space"
ASTROCART_MODES = {
    ASTROCART_MODE_STANDARD,
    ASTROCART_MODE_GEODETIC_GREENWICH,
    ASTROCART_MODE_GEODETIC_GIZA,
    ASTROCART_MODE_LOCAL_SPACE,
}
ASTROCART_MODE_ORDER = (
    ASTROCART_MODE_STANDARD,
    ASTROCART_MODE_GEODETIC_GREENWICH,
    ASTROCART_MODE_GEODETIC_GIZA,
    ASTROCART_MODE_LOCAL_SPACE,
)

ASTROCART_PRECISION_PREVIEW = "preview"
ASTROCART_PRECISION_PRECISE = "precise"
ASTROCART_PRECISIONS = {ASTROCART_PRECISION_PREVIEW, ASTROCART_PRECISION_PRECISE}

_PREVIEW_STEP_DEG = 2.0
_PREVIEW_HORIZON_ERROR_METERS = 1_000_000_000.0
_PREVIEW_PARAN_SCAN_STEP_DEG = 5.0
_PREVIEW_LOCAL_SPACE_STEP_METERS = 1_000_000.0

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

ASTROCART_STYLE_SCHEMA_VERSION = 8
ASTROCART_TITLEBAR_SAFE_TOP = 34

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
    "renderer.astrocart.color.mapBuildingColor": "buildingColor",
    "renderer.astrocart.color.mapBuildingOutlineColor": "buildingOutlineColor",
    "renderer.astrocart.color.mapTerrainShadowColor": "terrainShadowColor",
    "renderer.astrocart.color.mapTerrainHighlightColor": "terrainHighlightColor",
    "renderer.astrocart.color.mapParkColor": "parkColor",
    "renderer.astrocart.color.mapParkOutlineColor": "parkOutlineColor",
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
    "renderer.astrocart.metric.mapBuildingOpacityScale": "buildingOpacityScale",
    "renderer.astrocart.metric.mapTerrainExaggeration": "terrainExaggeration",
    "renderer.astrocart.metric.mapHillshadeExaggeration": "hillshadeExaggeration",
    "renderer.astrocart.metric.mapResidentialOpacityScale": "residentialOpacityScale",
    "renderer.astrocart.metric.mapParkFillOpacityScale": "parkFillOpacityScale",
    "renderer.astrocart.metric.mapParkOutlineOpacityScale": "parkOutlineOpacityScale",
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
    for semantic_id, field in _ASTROCART_PROFILE_CHROME_COLORS.items():
        color = _profile_color(overrides.get(semantic_id))
        if color is not None:
            payload["chrome"][field] = color
    for semantic_id, field in _ASTROCART_PROFILE_RENDERER_COLORS.items():
        color = _profile_color(overrides.get(semantic_id))
        if color is not None:
            payload["renderer"][field] = color
    for semantic_id, field in _ASTROCART_PROFILE_RENDERER_NUMBERS.items():
        value = overrides.get(semantic_id)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value):
            payload["renderer"][field] = float(value)
    for point_id, (color_id, width_id, opacity_id) in _ASTROCART_PROFILE_POINT_ROLES.items():
        point = payload.get("points", {}).get(point_id)
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
    """The exact 20-property iframe chrome contract from map.html."""
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
        **values,
    }


def _astrocart_renderer_style(is_dark: bool) -> dict:
    """Complete bounded MapLibre presentation contract for schema v4."""
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
        "terrainShadowColor": "#111820" if is_dark else "#74808b",
        "terrainHighlightColor": "#697682" if is_dark else "#ffffff",
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
        "terrainExaggeration": 1.0,
        "hillshadeExaggeration": 0.35,
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
    if effective_table is not source_table:
        return _POINT_CLR_INDEX
    return _LEGACY_POINT_CLR_INDEX


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


def _inject_glyphs(geojson: dict, options) -> None:
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
            a_sym = props["a_glyph_unicode"] or a.title()
            b_sym = props["b_glyph_unicode"] or b.title()
            props["label_unicode"] = (
                f"{a_sym} {props.get('a_angle', '')} × "
                f"{b_sym} {props.get('b_angle', '')}"
            )
        else:
            pid = props.get("point", "")
            props["glyph_morinus"] = _morinus_glyph_for(pid, options)
            props["glyph_unicode"] = _UNICODE_GLYPHS.get(pid, "")


def _append_natal_ascendant_lines(
    geojson: dict,
    radix,
    options,
    compute_kwargs: dict,
) -> None:
    """Add the chart ASC degree's rising/setting pair to standard ACG data."""
    renderer_style = _astrocart_renderer_style(_is_dark_theme(options))
    color = _hex_bg(
        getattr(options, "clrAscMC", None),
        renderer_style["referenceAscColor"],
    )
    natal_kwargs = {
        key: value for key, value in compute_kwargs.items()
        if key in {"step_deg", "horizon_error_meters"}
    }
    result = astrocart.compute_natal_ascendant_acg_for_chart(
        radix,
        color_hex=color,
        **natal_kwargs,
    )
    payload = result.to_geojson()
    for feature in payload.get("features", []):
        feature.setdefault("properties", {})["natal_angle"] = True
    geojson.setdefault("features", []).extend(payload.get("features", []))


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
        elif kind == localspace.KIND_LOCAL_SPACE:
            props["label_id"] = f"local-space:{point_id}"
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
) -> dict:
    is_dark = _is_dark_theme(options)
    page_bg = _hex_bg(
        getattr(options, "clrbackground", None) if options is not None else None,
        "#1a1d21" if is_dark else "#d9dde1",
    )
    local_space_additive = bool(
        getattr(options, "astrocart_localspace_additive", True)
    )
    return {
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

    def display_style_for_chart(self, radix) -> dict:
        """One immutable-versioned map style, derived without any ACG math."""
        points = astrocart.points_from_chart(radix)
        points = (*points, astrocart.natal_ascendant_point_from_chart(radix))
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
        return payload

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
        for point in points:
            color = colors.get(point.id, point.color_hex)
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
                "localSpaceAdditive": bool(
                    getattr(opts, "astrocart_localspace_additive", True)
                ),
                "showEcliptic": bool(getattr(opts, "astrocart_show_ecliptic", False)),
                "showEquator": bool(getattr(opts, "astrocart_show_equator", False)),
                "showAscCircle": bool(getattr(opts, "astrocart_show_asc_circle", False)),
                "showMcCircle": bool(getattr(opts, "astrocart_show_mc_circle", False)),
                "showHouseLines": bool(getattr(opts, "astrocart_show_house_lines", False)),
                "showZodiacLines": bool(getattr(opts, "astrocart_show_zodiac_lines", False)),
                "terrainRelief": bool(getattr(opts, "astrocart_terrain_relief", False)),
            },
        }
        _apply_astrocart_profile(payload, active_profile)
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
            return {
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
            }

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

        return {
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
        }

    def _geojson_for_chart(
        self,
        radix,
        *,
        source_name: str,
        mode: Optional[str] = None,
        precision: Optional[str] = None,
        local_space_standalone: bool = False,
    ) -> dict:
        mode = _normalize_mode(mode)
        precision = _normalize_precision(precision)
        opts = chart_snapshot_service.options
        display_opts = effective_display_options(opts)
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
        compute_kwargs = {}
        if precision == ASTROCART_PRECISION_PREVIEW:
            compute_kwargs.update({
                "step_deg": _PREVIEW_STEP_DEG,
                "horizon_error_meters": _PREVIEW_HORIZON_ERROR_METERS,
                "paran_scan_step_deg": _PREVIEW_PARAN_SCAN_STEP_DEG,
            })
        geodetic_meridian = _GEODETIC_MERIDIANS.get(mode)
        local_space_additive = bool(getattr(opts, "astrocart_localspace_additive", True))
        include_natal_ascendant = False
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
            geojson = result.to_geojson()
            include_natal_ascendant = True
        else:
            result = astrocart.compute_geodetic_acg_for_chart(
                radix,
                points=points,
                meridian_lon=geodetic_meridian,
                **compute_kwargs,
            )
            geojson = result.to_geojson()
        if include_natal_ascendant:
            _append_natal_ascendant_lines(
                geojson,
                radix,
                display_opts,
                compute_kwargs,
            )
        _inject_glyphs(geojson, display_opts)
        geojson["meta"] = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=display_opts,
            precision=precision,
            mode=mode,
            local_space_standalone=local_space_standalone,
        )
        return geojson

    def _geojson_for_chart_modes(
        self,
        radix,
        *,
        source_name: str,
        modes: Sequence[str],
        precision: Optional[str] = None,
    ) -> dict:
        normalized_modes = _normalize_modes(modes)
        normalized_precision = _normalize_precision(precision)
        features = []
        for mode in normalized_modes:
            payload = self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=normalized_precision,
                local_space_standalone=mode == ASTROCART_MODE_LOCAL_SPACE,
            )
            for feature in payload.get("features", []):
                feature_copy = dict(feature)
                properties = dict(feature.get("properties", {}))
                properties["astrocart_mode"] = mode
                label_id = properties.get("label_id")
                if label_id:
                    properties["label_id"] = f"{mode}:{label_id}"
                feature_copy["properties"] = properties
                if "id" in feature_copy:
                    feature_copy["id"] = f"{mode}:{feature_copy['id']}"
                features.append(feature_copy)

        opts = effective_display_options(chart_snapshot_service.options)
        meta = _chart_geojson_meta(
            radix,
            source_name=source_name,
            options=opts,
            precision=normalized_precision,
        )
        meta.update({
            "composite": True,
            "modes": list(normalized_modes),
            "modeLabels": [_mode_label(mode) for mode in normalized_modes],
            "localSpaceAdditive": ASTROCART_MODE_LOCAL_SPACE in normalized_modes,
        })
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
    ) -> dict:
        with self._lock:
            return self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=precision,
            )

    def lines_geojson_for_chart_modes(
        self,
        radix,
        *,
        source_name: str,
        modes: Sequence[str],
        precision: Optional[str] = None,
    ) -> dict:
        with self._lock:
            return self._geojson_for_chart_modes(
                radix,
                source_name=source_name,
                modes=modes,
                precision=precision,
            )

    def lines_geojson(
        self,
        *,
        source: Optional[str] = None,
        source_name: str = "Morinus",
        mode: Optional[str] = None,
        precision: Optional[str] = None,
    ) -> dict:
        with self._lock:
            opts = chart_snapshot_service.options
            source_path = str(Path(source).expanduser()) if source else str(export_chart_json.DEFAULT_SOURCE)
            radix, _ = export_chart_json.load_chart(source_path, opts, name=source_name)
            return self._geojson_for_chart(
                radix,
                source_name=source_name,
                mode=mode,
                precision=precision,
            )


astrocart_service = AstrocartService()
