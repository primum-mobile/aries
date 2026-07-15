# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Daemon-side menu label keying — the "daemon emits keys, frontend renders" path.

The daemon builds several menus (chart/document right-click context menus, the
native menu-bar Options submenu) whose labels are hardcoded English with no
mtexts key. Rather than translate them daemon-side, this module attaches a
stable ``labelKey`` to each static menu node; the FRONTEND renders it from the
one shared catalog (``webapp/frontend/src/locales/*.json``). So translations
live in ONE place.

Two maps, both English label -> frontend catalog key:
  * MENU_LABEL_KEYS   — the right-click context menus (chartmenu.* keys).
  * OPTIONS_MENU_KEYS — the native Options submenu (optmenu.* keys), generated
    into _options_menu_keys.py; the frontend relabel path translates these when
    it pushes labels to the (Rust-built) native menu.

Proper nouns (Placidus, Lahiri, Naibod, …) and dynamic labels (chart names,
"Surveil <star>") are absent from the maps and pass through unchanged. Corpus/
engine labels (planet/sign/aspect names, table headers) are localized separately
by mtexts — a different stratum this module does not touch.
"""

from __future__ import annotations

from webapp.daemon._options_menu_keys import OPTIONS_MENU_KEYS

# Right-click context menus — English label -> frontend key (chartmenu.*).
MENU_LABEL_KEYS: dict[str, str] = {
    "Derived Charts": "chartmenu.derivedCharts",
    "Simple Chart": "chartmenu.simpleChart",
    "Dodecatemoria": "chartmenu.dodecatemoria",
    "Arabic parts": "chartmenu.arabicParts",
    "Antiscia": "chartmenu.antiscia",
    "Contra-antiscia": "chartmenu.contraAntiscia",
    "Fixed stars": "chartmenu.fixedStars",
    "Asteroids": "chartmenu.asteroids",
    "Midpoints": "chartmenu.midpoints",
    "Hybrid Hits": "chartmenu.hybridHits",
    "Planetary hour": "chartmenu.planetaryHour",
    "House system label": "chartmenu.houseSystemLabel",
    "Chart information": "chartmenu.chartInformation",
    "House System": "chartmenu.houseSystem",
    "Equal": "chartmenu.hsEqual",
    "Whole Sign": "chartmenu.hsWholeSign",
    "Axial": "chartmenu.hsAxial",
    "True Ascendant": "chartmenu.hsTrueAscendant",
    "Horizontal": "chartmenu.hsHorizontal",
    "Porphyrius": "chartmenu.hsPorphyrius",
    "Angles only (no house lines)": "chartmenu.hsNone",
    "Find transits": "chartmenu.findTransits",
    "Primary directions": "chartmenu.primaryDirections",
    "Other Revolutions": "chartmenu.otherRevolutions",
    "Parallel Transit": "chartmenu.parallelTransit",
    "Sidereal Return (Marr)": "chartmenu.siderealReturnMarr",
    "Tithi Pravesha (Annual Soli-Lunar Return)": "chartmenu.tithiPravesha",
    "Lunar Phase (Embolismic)": "chartmenu.lunarPhaseEmbolismic",
    "Jonas Arc": "chartmenu.jonasArc",
    "Profections": "chartmenu.profections",
    "By sign": "chartmenu.bySign",
    "Continuous": "chartmenu.continuous",
    "Anchor to This Chart": "chartmenu.anchorToThisChart",
    "For this point": "chartmenu.forThisPoint",
    "Surveil Studies...": "chartmenu.surveilStudies",
    "Clear Active Surveil Study": "chartmenu.clearActiveSurveilStudy",
    "Split into Radixes": "chartmenu.splitIntoRadixes",
}

# Node dict keys that hold nested menu children across the daemon's menu shapes.
_CHILD_KEYS = ("children", "items", "submenu")


def attach_label_keys(node, keymap: dict[str, str] = MENU_LABEL_KEYS) -> None:
    """In-place depth-first: attach labelKey (from ``keymap``) to every static
    menu node whose English label is mapped and that has no labelKey yet.
    Language-neutral — the frontend does the translating."""
    if isinstance(node, list):
        for item in node:
            attach_label_keys(item, keymap)
        return
    if not isinstance(node, dict):
        return
    label = node.get("label")
    if isinstance(label, str) and not node.get("labelKey"):
        key = keymap.get(label)
        if key:
            node["labelKey"] = key
    for child_key in _CHILD_KEYS:
        child = node.get(child_key)
        if isinstance(child, (list, dict)):
            attach_label_keys(child, keymap)
