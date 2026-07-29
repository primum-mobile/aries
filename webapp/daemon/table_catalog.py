# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Lightweight table catalog for daemon startup paths.

The sidebar manifest and table-document shell only need stable table ids and
titles. Heavy table builders live in ``tables_service`` and are loaded only when
payload rows are requested.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableCatalogEntry:
    table_id: str
    title: str
    source: str
    # ``table`` creates a center workspace document. ``right_pane`` is still
    # a Tables navigation action, but its renderer stays beside the live chart.
    surface: str = "table"


TABLE_CATALOG: dict[str, TableCatalogEntry] = {
    "strip": TableCatalogEntry("strip", "30° Strip", "morin.py:14245,14620; stripwnd.py:78-646"),
    "positions": TableCatalogEntry("positions", "Positions", "morin.py:15823-15896; positionswnd.py"),
    "aspects": TableCatalogEntry("aspects", "Aspects", "morin.py:16752-16766; aspectswnd.py"),
    "aspect_list": TableCatalogEntry("aspect_list", "Aspect List", "webapp/daemon/aspect_list_service.py", surface="right_pane"),
    "rise_set": TableCatalogEntry("rise_set", "Rise/Set", "morin.py:16768-16769; risesetwnd.py"),
    "planetary_hours": TableCatalogEntry("planetary_hours", "Planetary Hours", "morin.py:16770-16771; hourswnd.py"),
    "firdaria": TableCatalogEntry("firdaria", "Firdaria", "morin.py:16017-16020,16764-16769,17566-17570; firdaria.py; firdariawnd.py"),
    "decennials": TableCatalogEntry("decennials", "Decennials", "morin.py:16014-16031,17164-17181,17699-17729; decennials.py; decennialswnd.py; decennials_popup.py"),
    "triplicity_directions": TableCatalogEntry("triplicity_directions", "Triplicity Directions", "triplicitydirections.py; Bonatti triplicity-lord research feature"),
    "zodiacal_releasing": TableCatalogEntry("zodiacal_releasing", "Zodiacal Releasing", "morin.py:16033-16072,17129-17162,17682-17698,4119-4147; zodiacalreleasing.py; zodiacalreleasingwnd.py"),
    "profections_table": TableCatalogEntry("profections_table", "Profections", "morin.py:16991-17033,17501-17530,4151-4178; profectionswnd.py; profectionsmonwnd.py; profectiontable.py; profectionsmonthly.py"),
    "eclipses": TableCatalogEntry("eclipses", "Eclipses", "morin.py:17677-17680; eclipsesframe.py; eclipseswnd.py; eclipses.py"),
    "lunar_mansions": TableCatalogEntry("lunar_mansions", "Lunar Mansions", "manazil.py; classical Arabic manāzil al-qamar nomenclature", surface="right_pane"),
    "arabic_parts": TableCatalogEntry("arabic_parts", "Arabic Parts", "morin.py:16776-16777; arabicpartswnd.py"),
    "misc": TableCatalogEntry("misc", "Miscellaneous", "morin.py:16862-16863; miscwnd.py"),
    "midpoints": TableCatalogEntry("midpoints", "Midpoints", "morin.py:16864-16865; midpointswnd.py"),
    "speeds": TableCatalogEntry("speeds", "Speeds", "morin.py:16866-16867; speedswnd.py"),
    "mundane_positions": TableCatalogEntry("mundane_positions", "Mundane Positions", "morin.py:16868-16869; munposwnd.py"),
    "antiscia": TableCatalogEntry("antiscia", "Antiscia", "morin.py:16870-16871; antisciawnd.py"),
    "zodpars": TableCatalogEntry("zodpars", "Zodiacal Parallels", "morin.py:16872-16873; zodparswnd.py"),
    "almuten_zodiacal": TableCatalogEntry("almuten_zodiacal", "Almuten Points", "morin.py:16875-16876; almutenzodswnd.py"),
    "almuten_chart": TableCatalogEntry("almuten_chart", "Almuten Chart", "morin.py:16877-16878; almutenchartwnd.py"),
    "almuten_topical": TableCatalogEntry("almuten_topical", "Almuten Topical", "morin.py:14263,14602,17208-17221; almutentopicalswnd.py; almutentopicalsframe.py"),
    "fixed_stars": TableCatalogEntry("fixed_stars", "Fixed Stars", "morin.py:15883-15896; fixstarswnd.py"),
    "fixed_stars_aspects": TableCatalogEntry("fixed_stars_aspects", "Fixed Star Aspects", "morin.py:16879-16882; fixstarsaspectswnd.py"),
    "fixed_stars_parallels": TableCatalogEntry("fixed_stars_parallels", "Fixed Star Parallels", "morin.py:16883-16884; fixstarsparallelswnd.py"),
    "asteroids": TableCatalogEntry("asteroids", "Asteroids", "morin.py:17188-17190; asteroidswnd.py"),
    "angle_at_birth": TableCatalogEntry("angle_at_birth", "Angle at Birth", "morin.py:16887-16898; angleatbirthwnd.py"),
    "phasis": TableCatalogEntry("phasis", "Phasis", "morin.py:15843-15850,17181-17183; phasiswnd.py"),
    "paranatellonta": TableCatalogEntry("paranatellonta", "Paranatellonta", "morin.py:17184-17185; paranwnd.py"),
    "dodecatemoria": TableCatalogEntry("dodecatemoria", "Dodecatemoria", "morin.py:14244,14632,17585-17599; dodecatemoriawnd.py; antiscia.py"),
    "user_speculum": TableCatalogEntry("user_speculum", "User Speculum", "morin.py:14289,14634,17537-17562; customerwnd.py; customerpd.py"),
    "monthly_transits": TableCatalogEntry("monthly_transits", "Monthly Transits", "morin.py:14293,14622,16790-16793,17314-17332; transits.py; transitmwnd.py"),
    "synodic_cycles": TableCatalogEntry("synodic_cycles", "Synodic Cycles", "engine/synodic_cycle.py; searchbackend station/cazimi/sign-change rows", surface="right_pane"),
    "fixedstar_angle_directions": TableCatalogEntry("fixedstar_angle_directions", "Angular Directions of Fixed Stars", "morin.py:14287,14641,17628-17675; fixstardirs.py; fixstardirsframe.py"),
}


def table_ids() -> list[str]:
    return sorted(TABLE_CATALOG)
