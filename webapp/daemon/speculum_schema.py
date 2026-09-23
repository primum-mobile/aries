# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Canonical schema for the chart-owned Speculum surface.

Aries stores the two coordinate families calculated for every ordinary chart
body.  Which family is presented belongs to the active chart house system,
not to the independently configured Primary Directions method.
"""
from __future__ import annotations


PLACIDIAN = 0
REGIOMONTAN = 1

# Regiomontanus and Campanus share the Regio/Camp coordinate tuple.  Every
# other supported house system uses the general Placidian coordinate tuple;
# House membership still follows the active chart cusps.
REGIO_CAMP_HOUSE_SYSTEMS = frozenset({"R", "C"})


PLACIDIAN_COLUMNS = (
    {"id": "lon", "idx": 0, "label": "Longitude", "labelKey": "Longitude"},
    {"id": "lat", "idx": 1, "label": "Latitude", "labelKey": "Latitude"},
    {"id": "ra", "idx": 2, "label": "Rectascension", "labelKey": "Rectascension"},
    {"id": "decl", "idx": 3, "label": "Declination", "labelKey": "Declination"},
    {"id": "adlat", "idx": 4, "label": "AD (Lat)", "labelKey": "AscDiffLat"},
    {"id": "sa", "idx": 5, "label": "Semiarcus", "labelKey": "Semiarcus"},
    {"id": "md", "idx": 6, "label": "Meridiandist", "labelKey": "Meridiandist"},
    {"id": "hd", "idx": 7, "label": "Horizondist", "labelKey": "Horizondist"},
    {"id": "th", "idx": 8, "label": "Temporalhour", "labelKey": "TemporalHour"},
    {"id": "hod", "idx": 9, "label": "Hourlydist", "labelKey": "HourlyDist"},
    {"id": "pmp", "idx": 10, "label": "PMP", "labelKey": "PMP"},
    {"id": "adph", "idx": 11, "label": "AD (Pole H.)", "labelKey": "AscDiffPole"},
    {"id": "poh", "idx": 12, "label": "Pole Height", "labelKey": "PoleHeight"},
    {"id": "aodo", "idx": 13, "label": "AO/DO (PH)", "labelKey": "AscDescObl"},
    {"id": "azm", "idx": 14, "label": "Astrl. Azimuth", "labelKey": "AZM"},
    {"id": "elv", "idx": 15, "label": "Altitude", "labelKey": "ELV"},
)

REGIOMONTAN_COLUMNS = (
    {"id": "lon", "idx": 0, "label": "Longitude", "labelKey": "Longitude"},
    {"id": "lat", "idx": 1, "label": "Latitude", "labelKey": "Latitude"},
    {"id": "ra", "idx": 2, "label": "Rectascension", "labelKey": "Rectascension"},
    {"id": "decl", "idx": 3, "label": "Declination", "labelKey": "Declination"},
    {"id": "md", "idx": 4, "label": "Meridiandist", "labelKey": "Meridiandist"},
    {"id": "hd", "idx": 5, "label": "Horizondist", "labelKey": "Horizondist"},
    {"id": "zd", "idx": 6, "label": "ZD", "labelKey": "ZD"},
    {"id": "pole", "idx": 7, "label": "Pole", "labelKey": "Pole"},
    {"id": "q", "idx": 8, "label": "Q", "labelKey": "Q"},
    {"id": "w", "idx": 9, "label": "W", "labelKey": "WReg"},
    {"id": "cmp", "idx": 10, "label": "CMP Vrt. Azmt.", "labelKey": "CMP"},
    {"id": "rmp", "idx": 11, "label": "RMP", "labelKey": "RMP"},
    {"id": "azm", "idx": 12, "label": "Astrl. Azimuth", "labelKey": "AZM"},
    {"id": "elv", "idx": 13, "label": "Altitude", "labelKey": "ELV"},
)


def family_for_house_system(hsys: object) -> str:
    return "regiomontan" if str(hsys or "P").upper() in REGIO_CAMP_HOUSE_SYSTEMS else "placidian"


def index_for_house_system(hsys: object) -> int:
    return REGIOMONTAN if family_for_house_system(hsys) == "regiomontan" else PLACIDIAN


def columns_for_index(speculum_index: int):
    return REGIOMONTAN_COLUMNS if int(speculum_index) == REGIOMONTAN else PLACIDIAN_COLUMNS
