# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical presentation registry for Aries settings surfaces.

The daemon option schema remains the source of truth for values, validation,
persistence, and refresh modes.  This registry owns presentation order and the
small set of settings that can be rendered generically on every settings
surface.  A mirrored boolean added here appears in:

* the native/browser Options menu (via ``manifest_service``),
* the upper-right titlebar options drawer (which renders that same menu tree),
* the full Settings dialog (which renders the registered tab and fields).

Complex settings keep their purpose-built React bodies, but their tab order and
native-menu entry points still live here so future hierarchy cleanup is a data
edit rather than another three-surface rewrite.
"""

from __future__ import annotations

from copy import deepcopy


# The palette preset identities are shared by the daemon options endpoint and
# every quick-options menu.  Keep them here so adding/reordering a preset cannot
# silently update the full Colors settings tab while dropping it from the
# native/titlebar Theme presets drawer.
THEME_PRESET_DEFINITIONS: tuple[dict, ...] = (
    {"name": "System (auto)", "mtextKey": "SystemAuto"},
    {"name": "My Colors", "mtextKey": "MyColors"},
    {"name": "Midnight"},
    {"name": "Daylight"},
    {"name": "NASA Atlas", "mtextKey": "ThemeNasaAtlas"},
    {"name": "Diurnal"},
    {"name": "Classic Morinus"},
    {"name": "Taurus"},
    {"name": "Nocturne"},
    {"name": "Sirius"},
)
THEME_PRESET_NAMES: tuple[str, ...] = tuple(
    definition["name"] for definition in THEME_PRESET_DEFINITIONS
)


SETTINGS_TABS: tuple[dict, ...] = (
    {"id": "appearance", "labelKey": "settings.tabAppearance", "menuCommands": ["appearance.toggle", "menu.symbols"]},
    {"id": "interpretation", "labelKey": "settings.tabInterpretation", "menuCommands": []},
    {"id": "astrocartography", "labelKey": "settings.astrocartography", "menuCommands": ["menu.options.astrocartography"]},
    {"id": "colors", "labelKey": "settings.tabColors", "menuCommands": ["menu.colors"]},
    {"id": "export", "labelKey": "settings.tabExport", "menuCommands": []},
    {"id": "houses", "labelKey": "settings.tabHouseSystem", "menuCommands": ["menu.house-system"]},
    {"id": "ayanamsha", "labelKey": "settings.tabAyanamsha", "menuCommands": ["menu.ayanamsha"]},
    {"id": "location", "labelKey": "settings.tabDefaultLocation", "menuCommands": ["menu.options.default-location"]},
    {"id": "planets", "labelKey": "settings.tabPlanetsPoints", "menuCommands": ["menu.options.planets-points", "menu.options.nodes", "menu.options.arabic-parts", "menu.options.syzygy"]},
    {"id": "orbs", "labelKey": "settings.tabOrbs", "menuCommands": ["menu.options.orbs"]},
    {"id": "dignities", "labelKey": "settings.tabDignities", "menuCommands": ["menu.options.dignities"]},
    {"id": "speculum", "labelKey": "settings.tabSpeculum", "menuCommands": ["menu.options.speculum"]},
    {"id": "fixstars", "labelKey": "settings.tabFixedStars", "menuCommands": ["menu.options.fixed-stars"]},
    {"id": "mansions", "labelKey": "settings.tabLunarMansions", "menuCommands": ["menu.lunar-mansions"]},
    {"id": "almutens", "labelKey": "settings.tabAlmutens", "menuCommands": ["menu.options.almutens"]},
    {"id": "primarydirections", "labelKey": "settings.tabPrimaryDirections", "menuCommands": ["menu.options.primary-directions"]},
    {"id": "revolutions", "labelKey": "settings.tabRevolutions", "menuCommands": ["menu.options.revolutions"]},
    {"id": "supplementary", "labelKey": "settings.tabProgressions", "menuCommands": ["menu.options.quick-charts"]},
    {"id": "timelords", "labelKey": "settings.tabTimeLords", "menuCommands": ["menu.options.time-lords"]},
    {"id": "eclipses", "labelKey": "settings.tabEclipses", "menuCommands": ["menu.options.eclipses"]},
    {"id": "relationship", "labelKey": "settings.tabRelationshipCharts", "menuCommands": ["menu.options.relationship-charts"]},
    {"id": "stepalerts", "labelKey": "settings.tabStepAlerts", "menuCommands": ["menu.options.step-alerts"]},
    {"id": "languages", "labelKey": "settings.tabLanguages", "menuCommands": ["menu.options.languages"]},
)


# Purpose-built Interpretation settings consume this daemon-owned catalog.
# Values are the canonical concrete subset suitable for user profiles; the
# empty value means "do not override the source definition" and is removed
# before the profile reaches corpus_semantics validation.
CORPUS_SEMANTIC_FIELDS: tuple[dict, ...] = (
    {
        "key": "house_frame",
        "labelKey": "settings.houseSystem",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "active", "labelKey": "settings.semanticCurrentHouseSystem"},
            {"value": "whole_sign", "labelKey": "optmenu.wholeSign"},
            {"value": "regiomontanus_5deg", "labelKey": "settings.semanticRegiomontanusFiveDegrees"},
        ),
    },
    {
        "key": "aspect_frame",
        "labelKey": "settings.aspects",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "degree", "labelKey": "settings.semanticDegreeAspects"},
            {"value": "sign", "labelKey": "settings.semanticSignConfigurations"},
        ),
    },
    {
        "key": "point_frame",
        "labelKey": "settings.semanticFieldPointFrame",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "degree", "labelKey": "dirview.degree"},
            {"value": "sign", "labelKey": "settings.signs"},
            {"value": "unresolved", "labelKey": "settings.semanticUnresolved"},
        ),
    },
    {
        "key": "orb_policy",
        "labelKey": "settings.semanticFieldAspectOrbs",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "configured", "labelKey": "settings.semanticConfiguredOrbs"},
            {"value": "lilly_moiety", "labelKey": "settings.semanticLillyMoiety"},
            {"value": "unresolved", "labelKey": "settings.semanticUnresolved"},
        ),
    },
    {
        "key": "point_orb_policy",
        "labelKey": "settings.semanticFieldPointOrbs",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "configured", "labelKey": "settings.semanticConfiguredOrbs"},
            {"value": "lilly_moiety", "labelKey": "settings.semanticLillyMoiety"},
            {"value": "exact", "labelKey": "aspectList.exact"},
            {"value": "unresolved", "labelKey": "settings.semanticUnresolved"},
        ),
    },
    {
        "key": "dignity_frame",
        "labelKey": "settings.tabDignities",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "active", "labelKey": "settings.semanticCurrentDignities"},
            {"value": "hellenistic", "labelKey": "settings.semanticHellenisticDignities"},
            {"value": "lilly", "labelKey": "settings.semanticLillyDignities"},
        ),
    },
    {
        "key": "solar_condition_profile",
        "labelKey": "settings.solarCondition",
        "options": (
            {"value": "", "labelKey": "settings.semanticUseSourceDefinition"},
            {"value": "active", "labelKey": "settings.semanticCurrentSolarCondition"},
            {"value": "late_hellenistic", "labelKey": "settings.solarConditionLateHellenistic"},
            {"value": "al_qabisi", "labelKey": "settings.solarConditionAlQabisi"},
            {"value": "ibn_ezra", "labelKey": "settings.solarConditionIbnEzra"},
            {"value": "lilly_1647", "labelKey": "settings.solarConditionWilliamLilly"},
            {"value": "morin_1661", "labelKey": "settings.solarConditionMorin"},
            {"value": "unresolved", "labelKey": "settings.semanticUnresolved"},
        ),
    },
)


MIRRORED_SECTIONS: tuple[dict, ...] = (
    {
        "id": "astrocartography",
        "tabId": "astrocartography",
        "menuId": "menu.options.quick.astrocartography",
        "label": "Astrocartography",
        "labelKey": "settings.astrocartography",
        "settings": [
            {"id": "astrocart-ecliptic", "group": "display", "field": "astrocart_show_ecliptic", "kind": "boolean", "label": "Ecliptic and zodiac signs", "labelKey": "settings.astrocartEcliptic"},
            {"id": "astrocart-equator", "group": "display", "field": "astrocart_show_equator", "kind": "boolean", "label": "Celestial equator", "labelKey": "settings.astrocartEquator"},
            {"id": "astrocart-asc-circle", "group": "display", "field": "astrocart_show_asc_circle", "kind": "boolean", "label": "Ascendant line", "labelKey": "settings.astrocartAscCircle"},
            {"id": "astrocart-mc-circle", "group": "display", "field": "astrocart_show_mc_circle", "kind": "boolean", "label": "Midheaven / Imum Coeli great circle", "labelKey": "settings.astrocartMcCircle"},
            {"id": "astrocart-house-lines", "group": "display", "field": "astrocart_show_house_lines", "kind": "boolean", "label": "House lines", "labelKey": "settings.astrocartHouseLines"},
            {"id": "astrocart-zodiac-lines", "group": "display", "field": "astrocart_show_zodiac_lines", "kind": "boolean", "label": "Zodiac lines", "labelKey": "settings.astrocartZodiacLines"},
            {"id": "astrocart-country-labels", "group": "display", "field": "astrocart_show_country_labels", "kind": "boolean", "label": "Show countries", "labelKey": "settings.astrocartCountryLabels"},
        ],
    },
)


def registry_payload() -> dict:
    """Return a mutation-safe JSON payload consumed by React and tests."""
    return {
        "version": 1,
        "tabs": deepcopy(list(SETTINGS_TABS)),
        "mirroredSections": deepcopy(list(MIRRORED_SECTIONS)),
        "themePresets": deepcopy(list(THEME_PRESET_DEFINITIONS)),
        "corpusSemanticFields": deepcopy(list(CORPUS_SEMANTIC_FIELDS)),
    }
