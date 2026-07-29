"""Daemon-side options + appearance backend.

Exposes the canonical ``options.py`` settings (the single source of truth) so the
web app can read and change the chart-affecting + appearance options, and makes a
change re-render every open chart — the headless analogue of
``morin._refresh_current_views`` (morin.py:3393).

This service mutates the *same* live options instance the rest of the daemon
shares (``chart_snapshot_service.options``, chart_service.py:58), which is also
the instance every loaded chart is constructed with. So a patch is reflected
everywhere: the next ``/api/chart`` snapshot reloads against the mutated options,
and ``WorkspaceSessionController.refresh_all_sessions`` recomputes every open
document's chart in place.

Spec: ``doc/migration/surfaces/options.md``.

wx-free: ``colorsdlg.py`` owns the full palette preset behavior, including
body/aspect colors, "System (auto)", "My Colors", and the OS-follow flag. The
daemon mirrors that contract here because it may not import wx/theme/colorsdlg.
"""
from __future__ import annotations

import hashlib
import datetime
import json
import copy
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Mapping, Optional

REPO_ROOT = Path(os.environ.get("ARIES_DAEMON_BASE_DIR", "").strip() or Path(__file__).resolve().parents[2])
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import arabicparts  # wx-free Arabic-part slot readers + formula formatter
import astrology  # wx-free swe_fixstar_ut for the PD fixed-star picker catalog
import chart  # wx-free Place/Time data model used by default-location timezone lookup
import dateformat
import default_location as default_location_model
import geonames  # wx-free timezone resolver backed by bundled localcities/zoneinfo
import houses  # canonical house-system code list (houses.Houses.hsystems)
import mtexts  # canonical ayanamsha label list (mtexts.ayanamshalist)
import posfordate  # progression angle-method / day-type enums + labels
import revolutions  # Revolution option cache invalidation
from engine import solilunar

from webapp.daemon.chart_service import chart_snapshot_service
from webapp.daemon import settings_registry
from webapp.daemon.builtin_style_profiles import (
    BUILTIN_STYLE_PRESET_NAMES,
    BUILTIN_STYLE_PROFILE_IDS,
    NASA_ATLAS_PRESET_NAME,
    builtin_style_profile,
    nasa_atlas_upgrade_for,
)
from webapp.daemon.event_time import (
    EVENT_TABLE_TIME_BASIS_VALUES,
    EVENT_TABLE_TIME_DEFAULT_LOCATION,
    EVENT_TABLE_TIME_UT,
    event_table_time_basis,
)
from webapp.daemon.style_profile_service import (
    PROFILE_KIND,
    PROFILE_SCHEMA_VERSION,
    StyleProfileError,
    StyleProfileStore,
    split_style_profile_css_overrides,
    validate_style_profile,
)
from webapp.daemon.style_authoring_service import build_chart_style_profile_v2
from webapp.daemon.style_profile_catalog_generated import TOKEN_SCHEMA_VERSION


logger = logging.getLogger(__name__)

THEME_STATE_SCHEMA_VERSION = 2
_ACTIVE_PROFILE_UNSET = object()
_STYLE_PROFILE_THEME_PREFIX = "profile:"
_RETIRED_BUILTIN_STYLE_PROFILE_IDS = frozenset({
    "chrome-glass-light",
    "chrome-glass-dark",
})
_UNIFIED_APP_SURFACE_PRESETS = frozenset({
    "Midnight",
    "Daylight",
    "Diurnal",
    "Taurus",
    "Nocturne",
    "Sirius",
})


def _style_profile_theme_name(profile_id: str) -> str:
    return f"{_STYLE_PROFILE_THEME_PREFIX}{profile_id}"


def _style_profile_id_from_theme_name(name: str) -> Optional[str]:
    if not str(name).startswith(_STYLE_PROFILE_THEME_PREFIX):
        return None
    profile_id = str(name)[len(_STYLE_PROFILE_THEME_PREFIX):].strip()
    if not profile_id:
        raise StyleProfileError("saved theme selector is missing its profile id")
    return profile_id


def _style_lab_system_profile_id(name: str) -> str:
    builtin = builtin_style_profile(name)
    if builtin is not None:
        return str(builtin["id"])
    slug = ''.join(
        character.lower() if character.isalnum() else '-'
        for character in str(name)
    ).strip('-')
    while '--' in slug:
        slug = slug.replace('--', '-')
    return f'theme-source-{slug}'


def _style_lab_system_preset_name(profile: Any) -> Optional[str]:
    if not isinstance(profile, Mapping):
        return None
    profile_id = str(profile.get('id') or '')
    for name in PALETTE_PRESET_NAMES:
        if profile_id == _style_lab_system_profile_id(name):
            return name
    return None


def _jsonable_refdeg(trip) -> list:
    """JSON-safe copy of a refdeg triplet: slots are ints, name strings, or
    embedded-formula tuples (arabicpartsdlg.py parts_refdeg shapes) — tuples
    become lists recursively so they survive the wire and round-trip back
    through arabicparts._normalize_refdeg_value."""
    out = []
    for v in list(trip or (0, 0, 0))[:3]:
        if isinstance(v, (list, tuple)):
            packed = list(v[:3])
            if len(v) > 3 and isinstance(v[3], (list, tuple)):
                packed.append(_jsonable_refdeg(v[3]))
            out.append(packed)
        elif isinstance(v, str):
            out.append(v)
        else:
            try:
                out.append(int(v))
            except Exception:
                out.append(0)
    while len(out) < 3:
        out.append(0)
    return out


def _ensure_arabic_part_tokens() -> None:
    """Port of ArabicPartsDlg._ensure_extra_tokens (arabicpartsdlg.py:1001-1028):
    guarantee DE/RE/node labels exist in mtexts.partstxts + mtexts.conv before
    the calculator catalog is built (defensive for older language tables)."""
    if 'DE' not in mtexts.txts:
        mtexts.txts['DE'] = u'DE'
    if 'RE' not in mtexts.txts:
        mtexts.txts['RE'] = u'RE'
    need = [
        (mtexts.txts['DE'], arabicparts.ArabicParts.DEG),
        (mtexts.txts['DE'] + u'!', arabicparts.ArabicParts.DEGLORD),
        (mtexts.txts['RE'], arabicparts.ArabicParts.RE),
        (mtexts.txts['RE'] + u'!', arabicparts.ArabicParts.REFLORD),
        (mtexts.txts['AscNode'], arabicparts.ArabicParts.ASCNODE),
        (mtexts.txts['DescNode'], arabicparts.ArabicParts.DESCNODE),
    ]
    pts = list(mtexts.partstxts)
    for label, _code in need:
        if label not in pts:
            pts.append(label)
    mtexts.partstxts = tuple(pts)
    for label, code in need:
        if label not in mtexts.conv:
            mtexts.conv[label] = code
    try:
        delattr(mtexts, '_conv_rev_cache')
    except Exception:
        pass


def _txt(key: str, fallback: str) -> str:
    """Resolve a user-facing label through mtexts at CALL time so it follows the
    active language. Module-level option catalogs are built at import (before
    ``mtexts.setLang``), so any label they carry must be re-resolved when the
    payload is served — this is the same call-time pattern as
    ``_fixstars_mode_catalog``/``_slider_catalog``."""
    return str(mtexts.txts.get(key, fallback))


def _localized(catalog) -> list:
    """Serve-time copy of a dict catalog with each entry's ``labelKey`` resolved
    through mtexts into ``label`` (English ``label`` is the fallback). The
    ``labelKey`` field is dropped from the payload; entries without one pass
    through unchanged. Keeps the module tables as the structural source of truth
    (value/attr/idx/glyph) while the visible label localizes by langid."""
    out = []
    for row in catalog:
        item = dict(row)
        key = item.pop('labelKey', None)
        if key is not None:
            item['label'] = _txt(key, item.get('label', ''))
        out.append(item)
    return out


# ---------------------------------------------------------------------------
# Theme presets — wx-free mirror of theme.BUILTIN_SPECS.
#
# Each spec's seven chrome slots map onto options.clr* exactly as
# theme.write_through_to_options does (theme.py:516-522):
#   clrbackground <- surface        clrsidebar  <- surface_subtle
#   clrtexts      <- text_primary    clrtable    <- chart_bg
#   clrhouses     <- chart_grid      clrexil     <- danger
#   clrdomicil    <- success
# clrindividual / clraspect / useplanetcolors / usezodiacelementcolors are
# DELIBERATELY untouched (theme.py:508-512) so user customizations survive a
# preset apply.
#
# Daylight resolves through native Cocoa semantic colours on a real GUI session
# (theme.native_day_theme_spec, theme.py:269); headless we use its documented
# wx-free fallback RGBs. See options.md "Gaps".
# ---------------------------------------------------------------------------

THEME_PRESETS: dict[str, dict[str, tuple]] = {
    'Midnight': {
        'surface': (35, 36, 40), 'surface_subtle': (29, 30, 33),
        'text_primary': (255, 255, 255), 'chart_bg': (0, 0, 0),
        'chart_grid': (138, 139, 141), 'danger': (255, 0, 0), 'success': (2, 191, 2),
        'mode': 'dark',
    },
    'Daylight': {
        'surface': (255, 255, 255), 'surface_subtle': (242, 242, 242),
        'text_primary': (17, 17, 17), 'chart_bg': (255, 255, 255),
        'chart_grid': (88, 88, 88), 'danger': (17, 17, 17), 'success': (17, 17, 17),
        'mode': 'light',
    },
    'Diurnal': {
        'surface': (255, 255, 255), 'surface_subtle': (242, 242, 242),
        'text_primary': (17, 17, 17), 'chart_bg': (251, 250, 247),
        'chart_grid': (139, 134, 118), 'danger': (161, 69, 58), 'success': (61, 122, 79),
        'mode': 'light',
    },
    'Classic Morinus': {
        'surface': (192, 192, 192), 'surface_subtle': (192, 192, 192),
        'text_primary': (0, 0, 0), 'chart_bg': (0, 0, 0),
        'chart_grid': (0, 0, 255), 'danger': (255, 0, 0), 'success': (2, 191, 2),
        'mode': 'light',
    },
    'Taurus': {
        'surface': (36, 36, 40), 'surface_subtle': (28, 28, 32),
        'text_primary': (217, 249, 245), 'chart_bg': (36, 36, 40),
        'chart_grid': (221, 206, 245), 'danger': (236, 175, 175), 'success': (185, 230, 180),
        'mode': 'dark',
    },
    'Nocturne': {
        'surface': (21, 24, 27), 'surface_subtle': (16, 18, 21),
        'text_primary': (245, 248, 250), 'chart_bg': (8, 10, 12),
        'chart_grid': (96, 119, 130), 'danger': (255, 96, 120), 'success': (67, 220, 150),
        'mode': 'dark',
    },
    'Sirius': {
        'surface': (29, 30, 33), 'surface_subtle': (29, 30, 33),
        'text_primary': (235, 229, 242), 'chart_bg': (0, 0, 0),
        'chart_grid': (119, 112, 139), 'danger': (229, 105, 117), 'success': (91, 188, 145),
        'mode': 'dark',
    },
}

# spec slot -> options.clr* attribute (theme.write_through_to_options mapping).
_PRESET_CHROME_MAP = {
    'surface': 'clrbackground',
    'surface_subtle': 'clrsidebar',
    'text_primary': 'clrtexts',
    'chart_bg': 'clrtable',
    'chart_grid': 'clrhouses',
    'danger': 'clrexil',
    'success': 'clrdomicil',
}

_SYSTEM_AUTO_NAME = 'System (auto)'
_MY_COLORS_NAME = 'My Colors'
# The palette `name` is a stable identity (selection key + patch lookup), so it is
# NOT translated. The two worded presets get a separate localized display `label`
# via mtexts; the remaining presets are proper product names (label == name).
_PALETTE_LABEL_KEYS = {
    definition['name']: definition['mtextKey']
    for definition in settings_registry.THEME_PRESET_DEFINITIONS
    if definition.get('mtextKey')
}
PALETTE_PRESET_NAMES = settings_registry.THEME_PRESET_NAMES

_PALETTE_ATTR_NAMES = (
    'clrframe', 'clrsigns',
    'clrsignelementfire', 'clrsignelementearth', 'clrsignelementair', 'clrsignelementwater',
    'clrAscMC', 'clrhouses', 'clrhousenumbers', 'clrpositions', 'clrperegrin',
    'clrdomicil', 'clrexil', 'clrexal', 'clrcasus',
    'clrbackground', 'clrsidebar', 'clrsidebartext',
    'clrtable', 'clrtexts', 'clrappbackground', 'clrapptexts',
)

_PD_IN_CHART_FIELDS = {
    'pdincharttyp',
    'pdinchartsecmotion',
    'pdinchartterrsecmotion',
    'pdinchartreverse',
}

_DARK_THEME_ASPECTS = [
    (246, 0, 206), (40, 232, 232), (246, 0, 206), (34, 255, 154),
    (255, 242, 0), (246, 0, 206), (34, 255, 154), (246, 0, 206),
    (255, 122, 0), (0, 0, 251), (246, 0, 206), (138, 43, 226),
]

# Sirius keeps the user's exact major-aspect anchors (pink for conjunction,
# square, and opposition; light blue for sextile and trine). Minor aspects
# retain Midnight's colour families at calmer, space-toned values.
_SIRIUS_ASPECTS = [
    (246, 0, 206),   # conjunction — user pink
    (80, 206, 224),  # semisextile — Midnight cyan, softened
    (219, 43, 179),  # semisquare — nebula rose
    (0, 199, 252),   # sextile — user light blue
    (229, 190, 88),  # quintile — star gold
    (246, 0, 206),   # square — user pink
    (0, 199, 252),   # trine — user light blue
    (205, 48, 171),  # sesquisquare — deeper nebula rose
    (238, 139, 65),  # biquintile — stellar amber
    (88, 96, 214),   # quincunx — deep-space indigo
    (246, 0, 206),   # opposition — user pink
    (162, 83, 220),  # septile — Sirius violet
]

# Classic Astro-Seek aspect families on the otherwise monochrome Daylight
# wheel: conjunction/hard aspects red, flowing aspects blue, and the
# semisextile/quincunx family green. The remaining minor harmonics use vivid,
# darker orange/gold/purple hues so they stay categorical on a white field.
_ASTRO_SEEK_ASPECT_RED = (255, 0, 0)
_ASTRO_SEEK_ASPECT_BLUE = (0, 0, 255)
_ASTRO_SEEK_ASPECT_GREEN = (0, 128, 0)
_DAYLIGHT_ASPECT_ORANGE = (214, 96, 0)
_DAYLIGHT_ASPECT_GOLD = (179, 122, 0)
_DAYLIGHT_ASPECT_PURPLE = (128, 0, 160)
_DAYLIGHT_ASPECTS = [
    _ASTRO_SEEK_ASPECT_RED,    # conjunction
    _ASTRO_SEEK_ASPECT_GREEN,  # semisextile
    _DAYLIGHT_ASPECT_ORANGE,   # semisquare
    _ASTRO_SEEK_ASPECT_BLUE,   # sextile
    _DAYLIGHT_ASPECT_GOLD,     # quintile
    _ASTRO_SEEK_ASPECT_RED,    # square
    _ASTRO_SEEK_ASPECT_BLUE,   # trine
    _DAYLIGHT_ASPECT_ORANGE,   # sesquisquare
    _DAYLIGHT_ASPECT_GOLD,     # biquintile
    _ASTRO_SEEK_ASPECT_GREEN,  # quincunx
    _ASTRO_SEEK_ASPECT_RED,    # opposition
    _DAYLIGHT_ASPECT_PURPLE,   # septile
]

_ASTRO_SEEK_SIGN_ELEMENTS = {
    'clrsignelementfire': (255, 0, 0),
    'clrsignelementearth': (74, 141, 0),
    'clrsignelementair': (232, 130, 0),
    'clrsignelementwater': (17, 43, 205),
}

_ZODIAC_ELEMENT_DEFAULTS = {
    'clrsignelementfire': (214, 82, 60),
    'clrsignelementearth': (118, 146, 74),
    'clrsignelementair': (88, 138, 214),
    'clrsignelementwater': (68, 164, 172),
}

_CURRENT_COLOR_NIGHT_PRESET = {
    'clrframe': (220, 220, 221),
    'clrsigns': (215, 215, 217),
    'clrAscMC': (205, 205, 209),
    'clrhouses': (138, 139, 141),
    'clrhousenumbers': (59, 59, 60),
    'clrpositions': (255, 255, 255),
    'clrperegrin': (205, 205, 209),
    'clrdomicil': (2, 191, 2),
    'clrexil': (255, 0, 0),
    'clrexal': (255, 215, 0),
    'clrcasus': (205, 92, 92),
    'clrbackground': (35, 36, 40),
    'clrsidebar': (29, 30, 33),
    'clrsidebartext': (255, 255, 255),
    'clrtable': (0, 0, 0),
    'clrtexts': (255, 255, 255),
    'clrindividual': [
        (255, 215, 0), (0, 191, 255), (138, 43, 226), (0, 128, 0),
        (178, 34, 34), (0, 0, 255), (0, 0, 0), (0, 0, 128),
        (0, 0, 128), (0, 0, 128), (139, 54, 38), (205, 96, 144),
        (128, 0, 128),
    ],
    'clraspect': _DARK_THEME_ASPECTS[:],
    'useplanetcolors': False,
}

_CURRENT_COLOR_DAY_PRESET = {
    'clrframe': (17, 17, 17),
    'clrsigns': (17, 17, 17),
    **_ASTRO_SEEK_SIGN_ELEMENTS,
    'clrAscMC': (17, 17, 17),
    'clrhouses': (88, 88, 88),
    'clrhousenumbers': (45, 45, 45),
    'clrpositions': (17, 17, 17),
    'clrperegrin': (17, 17, 17),
    'clrdomicil': (17, 17, 17),
    'clrexil': (17, 17, 17),
    'clrexal': (17, 17, 17),
    'clrcasus': (17, 17, 17),
    'clrbackground': (255, 255, 255),
    'clrsidebar': (242, 242, 242),
    'clrsidebartext': (17, 17, 17),
    'clrtable': (255, 255, 255),
    'clrtexts': (17, 17, 17),
    'clrindividual': [(17, 17, 17)] * 13,
    'clraspect': _DAYLIGHT_ASPECTS[:],
    'useplanetcolors': False,
}

# Warm-white daylight palette with a strict luminance hierarchy. Aspect colors
# are the 76% warm-background composites of the intended equal-lightness OKLCH
# families because the persisted palette contract stores opaque RGB values.
_DIURNAL_PRESET = {
    'clrframe': (95, 92, 83),
    'clrsigns': (95, 92, 83),
    'clrsignelementfire': (128, 87, 83),
    'clrsignelementearth': (86, 107, 75),
    'clrsignelementair': (114, 97, 62),
    'clrsignelementwater': (65, 105, 125),
    'clrAscMC': (95, 92, 83),
    'clrhouses': (139, 134, 118),
    'clrhousenumbers': (95, 92, 83),
    'clrpositions': (38, 36, 31),
    'clrperegrin': (38, 36, 31),
    'clrdomicil': (61, 122, 79),
    'clrexil': (161, 69, 58),
    'clrexal': (140, 108, 31),
    'clrcasus': (139, 80, 80),
    'clrbackground': (251, 250, 247),
    'clrsidebar': (242, 242, 242),
    'clrsidebartext': (17, 17, 17),
    'clrtable': (255, 255, 252),
    'clrtexts': (38, 36, 31),
    'clrappbackground': (255, 255, 255),
    'clrapptexts': (17, 17, 17),
    'clrindividual': [
        (143, 107, 9), (64, 98, 122), (94, 71, 132), (43, 99, 57),
        (136, 57, 46), (43, 86, 139), (94, 84, 63), (28, 97, 115),
        (58, 83, 141), (107, 68, 116), (116, 73, 49), (122, 63, 92),
        (97, 71, 125),
    ],
    'clraspect': [
        (186, 118, 165), (132, 144, 182), (186, 118, 165), (97, 160, 130),
        (132, 144, 182), (186, 118, 165), (97, 160, 130), (186, 118, 165),
        (132, 144, 182), (132, 144, 182), (186, 118, 165), (132, 144, 182),
    ],
    'useplanetcolors': False,
    'usezodiacelementcolors': True,
}

_CLASSIC_MORINUS_PRESET = {
    'clrframe': (0, 0, 255),
    'clrsigns': (0, 0, 255),
    'clrAscMC': (0, 0, 0),
    'clrhouses': (0, 0, 255),
    'clrhousenumbers': (0, 0, 255),
    'clrpositions': (0, 0, 128),
    'clrperegrin': (0, 0, 128),
    'clrdomicil': (2, 191, 2),
    'clrexil': (255, 0, 0),
    'clrexal': (255, 215, 0),
    'clrcasus': (205, 92, 92),
    'clrbackground': (192, 192, 192),
    'clrsidebar': (192, 192, 192),
    'clrsidebartext': (0, 0, 0),
    'clrtable': (0, 0, 0),
    'clrtexts': (0, 0, 0),
    'clrindividual': [
        (255, 215, 0), (0, 191, 255), (138, 43, 226), (0, 128, 0),
        (178, 34, 34), (0, 0, 255), (0, 0, 0), (0, 0, 128),
        (0, 0, 128), (0, 0, 128), (139, 54, 38), (205, 96, 144),
        (128, 0, 128),
    ],
    'clraspect': [
        (0, 0, 128), (0, 128, 0), (128, 0, 0), (0, 128, 0),
        (0, 128, 0), (128, 0, 0), (0, 128, 0), (128, 0, 0),
        (0, 128, 0), (128, 0, 0), (128, 0, 0), (0, 128, 0),
    ],
    'useplanetcolors': False,
}

_TAURUS_PRESET = {
    'clrframe': (221, 206, 245),
    'clrsigns': (217, 249, 245),
    'clrAscMC': (219, 246, 217),
    'clrhouses': (221, 206, 245),
    'clrhousenumbers': (221, 206, 245),
    'clrpositions': (217, 249, 245),
    'clrperegrin': (217, 249, 245),
    'clrdomicil': (185, 230, 180),
    'clrexil': (236, 175, 175),
    'clrexal': (236, 220, 175),
    'clrcasus': (210, 170, 170),
    'clrbackground': (36, 36, 40),
    'clrsidebar': (28, 28, 32),
    'clrsidebartext': (217, 249, 245),
    'clrtable': (36, 36, 40),
    'clrtexts': (217, 249, 245),
    'clrindividual': [(217, 249, 245)] * 13,
    'clraspect': [
        (217, 249, 245), (168, 166, 190), (228, 191, 233), (168, 166, 190),
        (168, 166, 190), (228, 191, 233), (168, 166, 190), (228, 191, 233),
        (168, 166, 190), (168, 166, 190), (228, 191, 233), (168, 166, 190),
    ],
    'useplanetcolors': True,
}

_NOCTURNE_PRESET = {
    'clrframe': (164, 182, 190),
    'clrsigns': (238, 242, 245),
    'clrAscMC': (125, 218, 205),
    'clrhouses': (96, 119, 130),
    'clrhousenumbers': (164, 182, 190),
    'clrpositions': (255, 255, 255),
    'clrperegrin': (238, 242, 245),
    'clrdomicil': (67, 220, 150),
    'clrexil': (255, 96, 120),
    'clrexal': (244, 198, 92),
    'clrcasus': (220, 104, 126),
    'clrbackground': (21, 24, 27),
    'clrsidebar': (16, 18, 21),
    'clrsidebartext': (245, 248, 250),
    'clrtable': (8, 10, 12),
    'clrtexts': (245, 248, 250),
    'clrindividual': [
        (244, 198, 92), (185, 219, 240), (180, 145, 255), (67, 220, 150),
        (255, 96, 120), (110, 168, 255), (180, 190, 195), (130, 145, 205),
        (130, 145, 205), (130, 145, 205), (165, 120, 88), (240, 130, 178),
        (178, 120, 210),
    ],
    'clraspect': [
        (125, 218, 205), (67, 220, 150), (255, 96, 120), (67, 220, 150),
        (244, 198, 92), (255, 96, 120), (67, 220, 150), (255, 96, 120),
        (244, 198, 92), (255, 174, 92), (255, 96, 120), (67, 220, 150),
    ],
    'useplanetcolors': False,
}

_SIRIUS_PRESET = {
    'clrframe': (190, 55, 243),
    'clrsigns': (226, 220, 235),
    'clrsignelementfire': (224, 111, 82),
    'clrsignelementearth': (139, 160, 101),
    'clrsignelementair': (101, 158, 204),
    'clrsignelementwater': (75, 166, 174),
    'clrAscMC': (248, 103, 1),
    'clrhouses': (119, 112, 139),
    'clrhousenumbers': (168, 157, 188),
    'clrpositions': (255, 170, 1),
    'clrperegrin': (204, 199, 213),
    'clrdomicil': (91, 188, 145),
    'clrexil': (229, 105, 117),
    'clrexal': (226, 181, 87),
    'clrcasus': (190, 103, 126),
    'clrbackground': (29, 30, 33),
    'clrsidebar': (29, 30, 33),
    'clrsidebartext': (224, 215, 236),
    'clrtable': (0, 0, 0),
    'clrtexts': (235, 229, 242),
    'clrindividual': [
        (226, 181, 87), (190, 211, 226), (183, 146, 219), (115, 188, 157),
        (229, 105, 117), (103, 155, 216), (170, 166, 174), (84, 181, 196),
        (111, 126, 190), (155, 104, 179), (173, 112, 83), (207, 116, 158),
        (174, 119, 201),
    ],
    'clraspect': _SIRIUS_ASPECTS[:],
    'useplanetcolors': False,
}

# Profile-only compatibility for style profiles authored while the token branch
# exposed Aries and Solar as selectable bases. Those presets were intentionally
# retired from the current product in favour of the current Sirius/Daylight
# palette work, but a stored portable profile must not silently lose its base
# layer after this merge. Keep the historical values exact and reachable only
# through ``basePresetId`` resolution; neither id belongs in
# ``PALETTE_PRESET_NAMES`` or any user-visible preset catalog.
_LEGACY_STYLE_PROFILE_BASE_PRESETS = {
    'Aries': {
        'clrframe': (238, 168, 92),
        'clrsigns': (248, 239, 220),
        **_ZODIAC_ELEMENT_DEFAULTS,
        'clrAscMC': (255, 116, 92),
        'clrhouses': (120, 94, 82),
        'clrhousenumbers': (238, 168, 92),
        'clrpositions': (255, 255, 255),
        'clrperegrin': (248, 239, 220),
        'clrdomicil': (80, 210, 125),
        'clrexil': (255, 92, 84),
        'clrexal': (255, 214, 102),
        'clrcasus': (218, 110, 96),
        'clrbackground': (34, 32, 32),
        'clrsidebar': (28, 26, 26),
        'clrsidebartext': (255, 255, 255),
        'clrtable': (22, 20, 20),
        'clrtexts': (255, 255, 255),
        'clrappbackground': (34, 32, 32),
        'clrapptexts': (255, 255, 255),
        'clrindividual': [
            (255, 214, 102), (226, 232, 240), (169, 121, 255), (80, 210, 125),
            (255, 92, 84), (96, 165, 250), (170, 160, 145), (112, 126, 194),
            (112, 126, 194), (112, 126, 194), (186, 124, 76), (236, 126, 170),
            (186, 110, 210),
        ],
        'clraspect': [
            (248, 239, 220), (80, 210, 125), (255, 92, 84), (80, 210, 125),
            (255, 214, 102), (255, 92, 84), (80, 210, 125), (255, 92, 84),
            (255, 214, 102), (238, 168, 92), (255, 92, 84), (80, 210, 125),
        ],
        'useplanetcolors': False,
        'usezodiacelementcolors': True,
    },
    'Solar': {
        'clrframe': (52, 75, 94),
        'clrsigns': (35, 40, 45),
        **_ZODIAC_ELEMENT_DEFAULTS,
        'clrAscMC': (198, 122, 42),
        'clrhouses': (122, 140, 154),
        'clrhousenumbers': (86, 100, 112),
        'clrpositions': (26, 30, 34),
        'clrperegrin': (35, 40, 45),
        'clrdomicil': (35, 135, 95),
        'clrexil': (202, 70, 70),
        'clrexal': (194, 134, 36),
        'clrcasus': (178, 96, 90),
        'clrbackground': (252, 252, 250),
        'clrsidebar': (244, 246, 248),
        'clrsidebartext': (26, 30, 34),
        'clrtable': (255, 255, 252),
        'clrtexts': (26, 30, 34),
        'clrappbackground': (252, 252, 250),
        'clrapptexts': (26, 30, 34),
        'clrindividual': [
            (194, 134, 36), (70, 110, 140), (116, 76, 166), (35, 135, 95),
            (202, 70, 70), (52, 92, 170), (62, 70, 78), (68, 82, 142),
            (68, 82, 142), (68, 82, 142), (122, 82, 56), (176, 78, 124),
            (116, 64, 138),
        ],
        'clraspect': [
            (52, 75, 94), (35, 135, 95), (202, 70, 70), (35, 135, 95),
            (194, 134, 36), (202, 70, 70), (35, 135, 95), (202, 70, 70),
            (194, 134, 36), (198, 122, 42), (202, 70, 70), (35, 135, 95),
        ],
        'useplanetcolors': False,
        'usezodiacelementcolors': True,
    },
}

for _preset, _enabled in (
    (_CURRENT_COLOR_NIGHT_PRESET, False),
    (_CURRENT_COLOR_DAY_PRESET, True),
    (_DIURNAL_PRESET, True),
    (_CLASSIC_MORINUS_PRESET, False),
    (_TAURUS_PRESET, False),
    (_NOCTURNE_PRESET, False),
    (_SIRIUS_PRESET, False),
):
    for _attr, _rgb_value in _ZODIAC_ELEMENT_DEFAULTS.items():
        _preset.setdefault(_attr, _rgb_value)
    _preset['usezodiacelementcolors'] = _enabled
    # Existing presets continue to produce the exact same app and chart colors;
    # the two authorities diverge only after an explicit app-only edit.
    _preset['clrappbackground'] = _preset['clrbackground']
    _preset['clrapptexts'] = _preset['clrtexts']

# Diurnal is deliberately a chart reskin over the established light chrome,
# rather than a second app-chrome palette.
_DIURNAL_PRESET['clrappbackground'] = _CURRENT_COLOR_DAY_PRESET['clrappbackground']
_DIURNAL_PRESET['clrapptexts'] = _CURRENT_COLOR_DAY_PRESET['clrapptexts']


# ---------------------------------------------------------------------------
# Catalogued option fields, grouped as the wx dialogs group them.
# ---------------------------------------------------------------------------

# Chrome + chart-glyph colour slots (RGB tuples). onColors (morin.py:19720).
_COLOR_RGB_FIELDS = (
    'clrbackground', 'clrsidebar', 'clrsidebartext', 'clrtable', 'clrtexts',
    'clrappbackground', 'clrapptexts',
    'clrframe', 'clrsigns', 'clrAscMC', 'clrhouses', 'clrhousenumbers',
    'clrpositions', 'clrperegrin', 'clrdomicil', 'clrexil', 'clrexal',
    'clrcasus',
    'clrsignelementfire', 'clrsignelementearth', 'clrsignelementair',
    'clrsignelementwater',
)
_COLOR_LIST_FIELDS = ('clrindividual', 'clraspect')  # list[RGB]
_COLOR_BOOL_FIELDS = ('useplanetcolors', 'usezodiacelementcolors', 'follow_os_theme')

# Display / Appearance. onAppearance1 (morin.py:19463), onToggleHouses (19545).
# showvertex / showaspectstovertex are the Vertex toggles (options.py:145-146);
# the wheel draws the Vertex body when showvertex and aspects-to-Vertex when
# both are set (graphchart.py:1315, :2534). The remaining body/header/aesthetic
# toggles mirror appearance1dlg.fill()/check() (appearance1dlg.py:805-889) +
# their options.py defaults (options.py:110-160). The legacy `bw` display toggle
# is intentionally not exported in the webapp; PDF monochrome is an export
# setting. `showkeyprompts` gates keyboard learning hints (:129).
_DISPLAY_BOOL_FIELDS = (
    'houses', 'showouterhouselines', 'housesystem', 'topocentric', 'morin_antiscia',
    'showvertex', 'showaspectstovertex',
    # Aspect drawing master + sub-toggles (appearance1dlg.py:805/818-819).
    'aspects', 'symbols', 'traditionalaspects',
    'showaspectstoasc', 'showaspectstomc', 'showaspectstodsc', 'showaspectstoic',
	# Body show-toggles (appearance1dlg.py:855-871).
	'showchiron', 'shownodes', 'aspectstonodes',
	'showlof', 'showaspectstolof', 'showlofouterring', 'showprenatalsyzygy',
    # Header (appearance1dlg.py:845-848).
    'planetarydayhour', 'information', 'showseconds',
    # Aesthetic / chrome (appearance1dlg.py:849-850, options.py:118).
    'show_help_chip',
    # Hidden Tauri-only presentation cursor. It is intentionally absent from
    # the settings catalog/UI and reaches React only through ThemeState.
    'presentation_cursor',
    # Master key-prompt toggle (options.py:129). Distinct from keyprompts_style
    # (which presentation) and show_help_chip (the transient hint affordance):
    # this is the on/off switch for the key-prompt UI as a whole.
    'showkeyprompts',
    # Dignity ring display lives on this dialog too (appearance1dlg.py:879-880).
    'showterms', 'showdecans',
    'showanglearrowheads', 'showcusplessascmclabels',
    # --- Appearance-menu parity adds (appearance1dlg.py control delta) ---
    # Modern Planets / extended station radices (appearance1dlg.py:332-333 build,
    # :889 fill, :1126-1128 check) -> options.py:144.
    'extendedradixstations',
    # Radix overlay event rows. These are display-only toggles: disabling them
    # also prevents the full-overlay Cazimi/eclipse scans from running.
    'showcazimi', 'showeclipseoverlay',
    # Display-only celestial reference circles on Astrocartography maps.
    'astrocart_show_ecliptic', 'astrocart_show_equator',
    'astrocart_show_asc_circle', 'astrocart_show_mc_circle',
    'astrocart_show_house_lines', 'astrocart_show_zodiac_lines',
    'astrocart_show_country_labels',
    # Show the two parties in the aspect hover flag. build_flag_payload reads it
    # at chartinspector.py:1262; inspector_service already calls that builder
    # (inspector_service.py:599), so exposing the option makes the flag honour it.
    # appearance1dlg.py:100-101 build, :865 fill, :1072-1074 check -> options.py:152.
    'aspect_flag_show_parties',
    # Aspect orb shown via line thickness (appearance1dlg.py:98-99/864/1069-1071)
    # -> options.py:400.
    'aspect_thickness_mode',
    'aspect_opacity_mode',
    # FixStars sub-toggles: conjunctions to Nodes / intermediate house cusps / Lot
    # of Fortune (appearance1dlg.py:180-185 build, :921-923 fill, :1174-1184 check)
    # -> options.py:161-163. The chart snapshot reads hcs/lof at
    # export_chart_json.py:917-918/:1103-1113.
    'showfixstarsnodes', 'showfixstarshcs', 'showfixstarslof',
    # Exclusive-aspects-on-click group (appearance1dlg.py:89-96 build, :861-863
    # fill, :1054-1067 check) -> options.py:149-151. The two subs are write-gated
    # in wx (only True when the master is on); the skin disables them when the
    # master is off, and each field still round-trips independently.
    'exclusive_aspects_on_click', 'exclusive_aspects_on_click_show_minor',
    'exclusive_aspects_on_click_traditional',
    # Positions + In Tables display toggles (appearance1dlg.py:151-153 build,
    # :820-821/:867 fill, :985-987/:1075-1077 check) -> options.py:116-117.
    'positions', 'intables',
    # Traditional fixstar names in the PD list (appearance1dlg.py:252-253/927/
    # 1190-1192) -> options.py:168.
    'usetradfixstarnamespdlist',
)
# showfixstars enum. transcendental[3] / aspect[12] are bool vectors handled
# separately (their per-index labels come from the catalog). theme is the wheel
# LAYOUT choice (Classic/Compact/Anglo Wheel, int 0/1/2 — DISTINCT from color themes;
# appearance1dlg.py:41-44/271/825-828/989-991 -> options.py:119). phasismode is
# the 3-way Phasis enum (PHASIS_MODE_* 0/1/2; appearance1dlg.py:326-331/882-888/
# 1117-1124 -> options.py:81-83/160). cazimimode is the radix overlay Cazimi
# enum: Hellenistic 1 deg, Abu Ma'shar 16' longitude, al-Qabisi 16' longitude
# plus latitude. synodicmode controls planetary-return Shift+Arrow event
# filtering: Station+Cazimi vs full Sun-planet cycle.
_DISPLAY_INT_FIELDS = ('showfixstars', 'theme', 'phasismode', 'cazimimode', 'synodicmode')
_DISPLAY_BOOL_VECTOR_FIELDS = ('transcendental', 'aspect')  # list[bool]
# Non-Ptolemaic aspect draw toggles in chart.Chart aspect-index order
# (chart.py:458-469; appearance1dlg.py:806-817).
_MINOR_ASPECT_INDICES = (1, 2, 4, 7, 8, 9, 11)
_DISPLAY_OVERLAY_ONLY_FIELDS = {
    'houses',
    'showouterhouselines',
    'housesystem',
    'theme',
    'anglo_dense_label_layout',
    # Body visibility changes the retained list projection, never the
    # canonical point universe or its calculated aspect rows.
    'transcendental',
    'showchiron',
    'shownodes',
    'showlof',
    'showvertex',
    'showprenatalsyzygy',
    'aspectstonodes',
    'showaspectstolof',
    'showaspectstovertex',
    'showlofouterring',
    'showfixstars',
    'aspects',
    'symbols',
    'traditionalaspects',
    'aspect',
    'showaspectstoasc',
    'showaspectstomc',
    'showaspectstodsc',
    'showaspectstoic',
    'exclusive_aspects_on_click',
    'exclusive_aspects_on_click_show_minor',
    'exclusive_aspects_on_click_traditional',
    'aspect_thickness_mode',
    'aspect_opacity_mode',
    'fontfamily',
    'phasismode',
    'cazimimode',
    'showcazimi',
    'showeclipseoverlay',
    'showterms',
    'showdecans',
    'planetarydayhour',
    'information',
    'showseconds',
    'positions',
    'intables',
    'extendedradixstations',
    'aspect_flag_show_parties',
    'showfixstarsnodes',
    'showfixstarshcs',
    'showfixstarslof',
    'usetradfixstarnamespdlist',
    'ascmcsize',
    'chartringthickness',
    'showanglearrowheads',
    'showcusplessascmclabels',
    'astrocart_show_ecliptic',
    'astrocart_show_equator',
    'astrocart_show_asc_circle',
    'astrocart_show_mc_circle',
    'astrocart_show_house_lines',
    'astrocart_show_zodiac_lines',
    'astrocart_show_country_labels',
    'synodicmode',
}
_DISPLAY_TEXT_ONLY_FIELDS = {'dateconvention'}
_DISPLAY_UI_STYLE_ONLY_FIELDS = {'presentation_cursor'}
# These options repaint chart chrome/overlays but do not alter any retained
# list query or row semantics.  Keep this separate from refreshMode: a few
# display-overlay fields (notably phasis/cazimi modes) genuinely do affect
# daemon list payloads.
_LIST_NEUTRAL_DISPLAY_FIELDS = (
    _DISPLAY_OVERLAY_ONLY_FIELDS
    - {
        'showfixstars',
        'phasismode',
        'cazimimode',
        'synodicmode',
        'usetradfixstarnamespdlist',
        # The chart's configured aspect set is also the Aspect List's row gate.
        # It remains a display-only chart refresh, but retained list data changes.
        'aspects',
        'aspect',
        'traditionalaspects',
    }
) | _DISPLAY_UI_STYLE_ONLY_FIELDS
_RETAINED_LIST_DATA_IGNORED_PAYLOAD_GROUPS = {
    'colors',
    'export',
    'retainedListDisplay',
    'themePresets',
    'themeState',
    'catalog',
    'settingsRegistry',
}
# Numeric sliders (appearance1dlg.py:287-304). The legacy wx tablesize slider is
# intentionally not exported in the webapp: current web table surfaces do not
# consume it, and table density will get a separate retained-table sizing model.
_DISPLAY_INT_SLIDER_FIELDS = ('ascmcsize', 'chartringthickness')
_DISPLAY_FLOAT_SLIDER_FIELDS = ()
# Enum string fields persisted by their canonical option names.
_DISPLAY_ENUM_STR_FIELDS = ('keyprompts_style', 'dateconvention', 'anglo_dense_label_layout')
_DATE_CONVENTION_CATALOG = (
    {'value': dateformat.DATE_CONVENTION_CURRENT, 'label': 'YYYY-MM-DD'},
    {'value': dateformat.DATE_CONVENTION_DMY, 'label': 'DD.MM.YYYY'},
)
_PDF_CHART_COLOR_MODE_CATALOG = (
    {'value': 'monochrome', 'label': 'Monochrome', 'labelKey': 'Monochrome'},
    {'value': 'colored-details', 'label': 'Colored details', 'labelKey': 'ColoredDetails'},
)
_PDF_CHART_COLOR_MODE_VALUES = {item['value'] for item in _PDF_CHART_COLOR_MODE_CATALOG}
_PDF_CHART_RASTER_PRESET_CATALOG = (
    {'value': 'clean', 'labelKey': 'settings.pdfRasterClean'},
    {'value': 'atkinson', 'labelKey': 'settings.pdfRasterAtkinson'},
    {'value': 'blue-noise', 'labelKey': 'settings.pdfRasterBlueNoise'},
    {'value': 'newsprint', 'labelKey': 'settings.pdfRasterNewsprint'},
)
_PDF_CHART_RASTER_PRESET_VALUES = {item['value'] for item in _PDF_CHART_RASTER_PRESET_CATALOG}
_PNG_CHART_APPEARANCE_CATALOG = (
    {'value': 'screen', 'labelKey': 'settings.pngAppearanceScreen'},
    {'value': 'monochrome', 'labelKey': 'settings.pngAppearanceMonochrome'},
    {'value': 'colored-details', 'labelKey': 'settings.pngAppearanceColoredDetails'},
)
_PNG_CHART_APPEARANCE_VALUES = {item['value'] for item in _PNG_CHART_APPEARANCE_CATALOG}
_EVENT_TABLE_TIME_BASIS_CATALOG = (
    {'value': EVENT_TABLE_TIME_DEFAULT_LOCATION, 'label': 'Default Location', 'labelKey': 'DefaultLocation'},
    {'value': EVENT_TABLE_TIME_UT, 'label': 'UT', 'labelKey': 'UT'},
)

# Orbs. onOrbs (morin.py:19881). The Asc/MC + Houses aspect-orb vectors and the
# parallel/contraparallel pairs mirror orbisdlg's per-target editor
# (orbisdlg.py:27-29, :337-346). orbiscuspAscMC / exact are scalars there
# (orbisdlg.py:401-411); options.py:391-399.
_ORB_MATRIX_FIELDS = ('orbis', 'orbisplanetspar')  # list[list[float]]
_ORB_VECTOR_FIELDS = ('orbisH', 'orbisAscMC', 'orbisparH', 'orbisparAscMC')  # list[float]
_ORB_SCALAR_FIELDS = ('orbiscuspH', 'orbiscuspAscMC', 'exact')

# Dignities. onDignities (morin.py:19610).
_DIGNITY_BOOL_FIELDS = ('showterms', 'dignitylabelcolors')
# selterm selects the active term-set (index into options.terms; the wx
# TermsDlg ComboBox over mtexts.termList — termsdlg.py:95-96, check() :325-326).
_DIGNITY_INT_FIELDS = ('selterm',)
_DIGNITY_LIST_FIELDS = ('dignityscores',)
_DIGNITY_TABLE_FIELDS = ('dignities', 'terms')

# Glyph-variant settings (symbolsdlg.SymbolsDlg). uranus is a bool (which Uranus
# glyph), pluto an int 0..3 (which Pluto glyph), signs a bool (which sign-glyph
# set). They feed common.common.update -> common.Planets[7]/[9] and the sign
# table, which the chart snapshot reads (export_chart_json.py:139/746/910).
_SYMBOL_BOOL_FIELDS = ('uranus', 'signs')
_SYMBOL_INT_FIELDS = ('pluto',)

# Default Location (defaultlocdlg.py / options.py:543-556). The saved
# "Here-and-Now" place: chart_service._build_here_now_chart (chart_service.py:141)
# reads these to construct the current-moment chart's Place + timezone. Field
# names mirror the options.py def* attributes verbatim; the desktop editor is
# defaultlocdlg.DefaultLocDlg (fill()/check() at :562/:590).
_DEFLOC_STR_FIELDS = ('deflocname', 'defloctzid')
_DEFLOC_FLOAT_FIELDS = ('defloclon', 'defloclat')
_DEFLOC_INT_FIELDS = (
    'defloclondeg', 'defloclonmin', 'defloclatdeg', 'defloclatmin',
    'deflocalt', 'defloczhour', 'defloczminute',
)
_DEFLOC_BOOL_FIELDS = (
    'defloceast', 'deflocnorth', 'deflocplus', 'deflocdst', 'defloctzauto',
)

# ---------------------------------------------------------------------------
# Field-metadata catalog. The single source of truth for WHICH option fields
# exist, their labels, control grouping and enum choices — derived from
# options.py + the wx settings dialogs (the oracle). The React skin renders
# generic controls from this; it must not hardcode any of these tables.
#
# Morinus glyph chars are the engine font map (Morinus.ttf). They are supplied
# here wx-free: common.py:368-413 owns the canonical mapping but imports wx, so
# the codepoints are mirrored verbatim (same chars as glyphs.ts PLANET_GLYPHS /
# ASPECT_GLYPHS, which already mirror common.py).
# ---------------------------------------------------------------------------

# Morinus.ttf planet/point glyph chars by SE id (common.py:390 / glyphs.ts).
_MORINUS_GLYPHS_BY_SEID: dict[int, str] = {
    0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 7: 'H',
    8: 'I', 9: 'J', 10: 'K', 11: 'L', 15: '}',
}
_MORINUS_FORTUNE_GLYPH = '4'   # FORTUNE_GLYPH (glyphs.ts:46)

# Morinus.ttf aspect glyph chars in engine aspect order (common.py:368 /
# glyphs.ts ASPECT_GLYPHS). 12 base aspects (par/contrapar are 12/13).
_MORINUS_ASPECT_GLYPHS = (
    'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', '[',
)

# Colour field metadata: {attr, label, group}. group ∈ chrome|chart|element|
# dignity. Labels mirror the wx colorsdlg notebook pages.
_COLOR_FIELD_CATALOG = (
    # Chart page (colorsdlg.py:684-689).
    {'attr': 'clrframe', 'label': 'Frame', 'group': 'chart', 'labelKey': 'Frame'},
    {'attr': 'clrsigns', 'label': 'Signs', 'group': 'chart', 'labelKey': 'Signs'},
    {'attr': 'clrAscMC', 'label': 'Asc / MC', 'group': 'chart', 'labelKey': 'AscMC'},
    {'attr': 'clrhouses', 'label': 'Houses', 'group': 'chart', 'labelKey': 'Houses'},
    {'attr': 'clrhousenumbers', 'label': 'House numbers', 'group': 'chart', 'labelKey': 'HouseNumbers'},
    {'attr': 'clrpositions', 'label': 'Positions', 'group': 'chart', 'labelKey': 'ChartPositions'},
    # Zodiac element colours (colorsdlg.py:702-713).
    {'attr': 'clrsignelementfire', 'label': 'Fire', 'group': 'element', 'labelKey': 'Fire'},
    {'attr': 'clrsignelementearth', 'label': 'Earth', 'group': 'element', 'labelKey': 'Earth'},
    {'attr': 'clrsignelementair', 'label': 'Air', 'group': 'element', 'labelKey': 'Air'},
    {'attr': 'clrsignelementwater', 'label': 'Water', 'group': 'element', 'labelKey': 'Water'},
    # Dignities colour grid (colorsdlg.py:721-730). Labels reuse the canonical
    # dignity keys (Domicil/Exal/Peregrin/Casus/Exil) so they inherit the
    # 9-language dignity vocabulary.
    {'attr': 'clrdomicil', 'label': 'Domicil', 'group': 'dignity', 'labelKey': 'Domicil'},
    {'attr': 'clrexal', 'label': 'Exaltation', 'group': 'dignity', 'labelKey': 'Exal'},
    {'attr': 'clrperegrin', 'label': 'Peregrine', 'group': 'dignity', 'labelKey': 'Peregrin'},
    {'attr': 'clrcasus', 'label': 'Fall', 'group': 'dignity', 'labelKey': 'Casus'},
    {'attr': 'clrexil', 'label': 'Exile', 'group': 'dignity', 'labelKey': 'Exil'},
    # General / chrome page (colorsdlg.py:871-875).
    {'attr': 'clrbackground', 'label': 'Background', 'group': 'chrome', 'labelKey': 'Background'},
    {'attr': 'clrsidebar', 'label': 'Sidebar', 'group': 'chrome', 'labelKey': 'Sidebar'},
    {'attr': 'clrsidebartext', 'label': 'Sidebar text', 'group': 'chrome', 'labelKey': 'SidebarText'},
    {'attr': 'clrtable', 'label': 'Canvas', 'group': 'chrome', 'labelKey': 'Canvas'},
    {'attr': 'clrtexts', 'label': 'Text', 'group': 'chrome', 'labelKey': 'Text'},
)

# Individual bodies — SE-id-indexed clrindividual rows (colorsdlg.py:745-770).
# {index, label, glyph}. index 10 = Nodes, 11 = Fortune, 12 = Chiron (the wx
# row order; glyph for 10 is the node glyph, 12 the chiron glyph).
_INDIVIDUAL_COLOR_CATALOG = (
    {'index': 0, 'label': 'Sun', 'glyph': _MORINUS_GLYPHS_BY_SEID[0], 'labelKey': 'Sun'},
    {'index': 1, 'label': 'Moon', 'glyph': _MORINUS_GLYPHS_BY_SEID[1], 'labelKey': 'Moon'},
    {'index': 2, 'label': 'Mercury', 'glyph': _MORINUS_GLYPHS_BY_SEID[2], 'labelKey': 'Mercury'},
    {'index': 3, 'label': 'Venus', 'glyph': _MORINUS_GLYPHS_BY_SEID[3], 'labelKey': 'Venus'},
    {'index': 4, 'label': 'Mars', 'glyph': _MORINUS_GLYPHS_BY_SEID[4], 'labelKey': 'Mars'},
    {'index': 5, 'label': 'Jupiter', 'glyph': _MORINUS_GLYPHS_BY_SEID[5], 'labelKey': 'Jupiter'},
    {'index': 6, 'label': 'Saturn', 'glyph': _MORINUS_GLYPHS_BY_SEID[6], 'labelKey': 'Saturn'},
    {'index': 7, 'label': 'Uranus', 'glyph': _MORINUS_GLYPHS_BY_SEID[7], 'labelKey': 'Uranus'},
    {'index': 8, 'label': 'Neptune', 'glyph': _MORINUS_GLYPHS_BY_SEID[8], 'labelKey': 'Neptune'},
    {'index': 9, 'label': 'Pluto', 'glyph': _MORINUS_GLYPHS_BY_SEID[9], 'labelKey': 'Pluto'},
    {'index': 10, 'label': 'Nodes', 'glyph': _MORINUS_GLYPHS_BY_SEID[10], 'labelKey': 'Nodes'},
    {'index': 11, 'label': 'Fortune', 'glyph': _MORINUS_FORTUNE_GLYPH, 'labelKey': 'Fortune'},
    {'index': 12, 'label': 'Chiron', 'glyph': _MORINUS_GLYPHS_BY_SEID[15], 'labelKey': 'Chiron'},
)

# Aspect names in engine order (colorsdlg.py:801-812). 12 entries; the glyph at
# each index is _MORINUS_ASPECT_GLYPHS[i]. (mtexts key, English fallback) — labels
# resolve at call time in _aspect_label_catalog() so they follow the language.
_ASPECT_LABEL_KEYS = (
    ('Conjunctio', 'Conjunction'),
    ('Semisextil', 'Semisextile'),
    ('Semiquadrat', 'Semisquare'),
    ('Sextil', 'Sextile'),
    ('Quintile', 'Quintile'),
    ('Quadrat', 'Square'),
    ('Trigon', 'Trine'),
    ('Sesquiquadrat', 'Sesquisquare'),
    ('Biquintile', 'Biquintile'),
    ('Quinqunx', 'Quinqunx'),
    ('Oppositio', 'Opposition'),
    ('Septile', 'Septile'),
)


def _aspect_label_catalog() -> list:
    return [str(mtexts.txts.get(key, fallback)) for key, fallback in _ASPECT_LABEL_KEYS]

# Outer-ring / showfixstars mode selector. The wx dialog lists modes in widget
# tab order (appearance1dlg.py:891-915), but the engine stores an integer enum
# (options.py:47-68) whose values do NOT follow that tab order. Each entry must
# therefore carry its real options.Options value grepped from options.py — never
# the list position: selecting "Asteroids" has to send ASTEROIDS=6, not its row
# index. Display order below preserves the wx tab order for familiarity.
# (enum value, mtexts key, English fallback). Labels are resolved at CALL time in
# _fixstars_mode_catalog() so they follow the active language; a module-level list
# of resolved mtexts strings would freeze at the import-time language.
_FIXSTARS_MODE_KEYS = (
    (0, 'None', 'None'),                    # Options.NONE
    (1, 'FixStars', 'Fixed Stars'),         # Options.FIXSTARS
    (6, 'Asteroids', 'Asteroids'),          # Options.ASTEROIDS
    (7, 'Midpoints', 'Midpoints'),          # Options.MIDPOINTS
    (8, 'HybridHits', 'Hybrid Hits'),       # Options.HYBRID_HITS
    (4, 'Dodecatemoria', 'Dodecatemoria'),  # Options.DODECATEMORIA
    (2, 'Antiscia', 'Antiscia'),            # Options.ANTIS
    (3, 'ContraAntiscia', 'Contraantiscia'),  # Options.CANTIS
    (5, 'ArabicParts', 'Arabic Parts'),     # Options.ARABICPARTS
)


def _fixstars_mode_catalog() -> list:
    return [
        {'value': value, 'label': str(mtexts.txts.get(key, fallback))}
        for value, key, fallback in _FIXSTARS_MODE_KEYS
    ]

# Phasis (heliacal) mode selector. Values are the engine's options.Options
# PHASIS_MODE_* integer enum (options.py:81-83) — NOT a list index. Labels are
# verbatim from appearance1dlg.py:326-330 (the radio-button captions).
_PHASIS_MODE_CATALOG = (
    {'value': 0, 'label': 'Astronomical', 'labelKey': 'Astronomical'},      # PHASIS_MODE_ASTRONOMICAL
    {'value': 1, 'label': 'Hellenistic', 'labelKey': 'Hellenistic'},       # PHASIS_MODE_HELLENISTIC
    {'value': 2, 'label': 'Swiss Ephemeris', 'labelKey': 'SwissEphemeris'},   # PHASIS_MODE_SIMPLE_SWEP
)

_CAZIMI_MODE_CATALOG = (
    {'value': 0, 'label': 'Hellenistic · 1°', 'labelKey': 'CazimiHellenistic'},
    {'value': 2, 'label': "Abu Maʿshar · 16′", 'labelKey': 'CazimiAbuMashar'},
    {'value': 1, 'label': "al-Qabisi · 16′ + latitude", 'labelKey': 'CazimiAlQabisi'},
)

_SYNODIC_MODE_CATALOG = (
    {'value': 0, 'label': 'Station+Cazimi', 'labelKey': 'StationCazimi'},
    {'value': 1, 'label': 'All', 'labelKey': 'All'},
)


def _primary_directions_default_direction(opts) -> int:
    """Default list filter for doctrine presets that need both D/C rows.

    The list filter is UI state, but the condition comes from the canonical
    options object. React consumes this value instead of correcting Direct ->
    Both after first paint.
    """
    import primdirs as _primdirs
    if (
        int(getattr(opts, 'primarydir', -1)) == _primdirs.PrimDirs.TOPOCENTRIC
        or bool(getattr(opts, 'pdmorinpromittorset', False))
    ):
        return _primdirs.PrimDirs.BOTHDC
    return _primdirs.PrimDirs.DIRECT


# Wheel LAYOUT choice (`theme`, int 0/1/2). DISTINCT from the colour theme presets:
# this is the radix wheel layout. Labels verbatim from appearance1dlg._theme_labels
# (appearance1dlg.py:41-44 — mtexts 'ClassicWheel'/'CompactWheel' fallbacks). The
# value is the choice index, which is exactly what check() stores (appearance1dlg.py:990).
_THEME_LAYOUT_CATALOG = (
    {'value': 0, 'label': 'Classic Wheel', 'labelKey': 'ClassicWheel'},   # _theme_labels[0]
    {'value': 1, 'label': 'Compact Wheel', 'labelKey': 'CompactWheel'},   # _theme_labels[1]
    # Tauri-native house-centred layout inspired by the established Anglo /
    # American wheel grammar. This is renderer geometry only; it must never
    # imply a house system, zodiac, object set, aspect set, or colour preset.
    {'value': 2, 'label': 'Anglo Wheel', 'labelKey': 'AngloWheel'},
)

_ANGLO_DENSE_LABEL_LAYOUT_CATALOG = (
    {'value': 'leader-columns', 'label': 'Straight house lines'},
    {'value': 'routed-cusps', 'label': 'Routed house lines'},
)
_ANGLO_DENSE_LABEL_LAYOUT_VALUES = {
    item['value'] for item in _ANGLO_DENSE_LABEL_LAYOUT_CATALOG
}

# Lunar Mansions zodiac mode (manazil_zodiac, options.py:318). Values are the
# manazil.ZODIAC_MODES strings verbatim (manazil.py:50-54); labels are verbatim
# from mtexts.txts (mtexts.py:322 — ManzilZodiacAuto/Sidereal/Tropical). The wx
# MansionsDlg lists them in this order (mansionsdlg.py:13 _MODE_ORDER).
_MANSION_ZODIAC_CATALOG = (
    {'value': 'auto', 'label': 'Follow chart zodiac', 'labelKey': 'ManzilZodiacAuto'},   # ZODIAC_AUTO / ManzilZodiacAuto
    {'value': 'sidereal', 'label': 'Always sidereal', 'labelKey': 'ManzilZodiacSidereal'},   # ZODIAC_SIDEREAL / ManzilZodiacSidereal
    {'value': 'tropical', 'label': 'Always tropical', 'labelKey': 'ManzilZodiacTropical'},   # ZODIAC_TROPICAL / ManzilZodiacTropical
)
_MANSION_ZODIAC_VALUES = tuple(m['value'] for m in _MANSION_ZODIAC_CATALOG)

# Speculum column-visibility settings (appearance2dlg.Appearance2Dlg). The wx
# dialog toggles options.speculums[PLACIDIAN|REGIOMONTAN][planets.Planet.<col>]
# (a 2-row bool matrix) + options.speculumdodecat[2] + options.intime. The column
# indices are the planets.Planet attribute constants (planets.py:25-56); the
# labels are verbatim from the mtexts keys the dialog uses (mtexts.py:237-241/
# 391-392). `attr` here is the speculum row key + column index pair the daemon
# read/apply uses; the React skin renders one toggle per entry.
#
# PLACIDIAN columns (appearance2dlg.py:245-261, check :291-314): the 16 toggles +
# placdodec. column index, label, mtexts source line.
_SPECULUM_PLACIDIAN_COLS = (
    {'idx': 0, 'label': 'Longitude', 'labelKey': 'Longitude'},        # planets.Planet.LONG / mtexts 'Longitude'
    {'idx': 1, 'label': 'Latitude', 'labelKey': 'Latitude'},         # LAT / 'Latitude'
    {'idx': 2, 'label': 'Rectascension', 'labelKey': 'Rectascension'},    # RA / 'Rectascension'
    {'idx': 3, 'label': 'Declination', 'labelKey': 'Declination'},      # DECL / 'Declination'
    {'idx': 4, 'label': 'AD (Lat)', 'labelKey': 'AscDiffLat'},         # ADLAT / 'AscDiffLat'
    {'idx': 5, 'label': 'Semiarcus', 'labelKey': 'Semiarcus'},         # SA / 'Semiarcus'
    {'idx': 6, 'label': 'Meridiandist', 'labelKey': 'Meridiandist'},     # MD / 'Meridiandist'
    {'idx': 7, 'label': 'Horizondist', 'labelKey': 'Horizondist'},      # HD / 'Horizondist'
    {'idx': 8, 'label': 'Temporalhour', 'labelKey': 'TemporalHour'},     # TH / 'TemporalHour'
    {'idx': 9, 'label': 'Hourlydist', 'labelKey': 'HourlyDist'},       # HOD / 'HourlyDist'
    {'idx': 10, 'label': 'PMP', 'labelKey': 'PMP'},             # PMP / 'PMP'
    {'idx': 11, 'label': 'AD (Pole H.)', 'labelKey': 'AscDiffPole'},    # ADPH / 'AscDiffPole'
    {'idx': 12, 'label': 'Pole Height', 'labelKey': 'PoleHeight'},     # POH / 'PoleHeight'
    {'idx': 13, 'label': 'AO/DO (PH)', 'labelKey': 'AscDescObl'},      # AODO / 'AscDescObl'
    {'idx': 14, 'label': 'Astrl. Azimuth', 'labelKey': 'AZM'},  # PL_AZM / 'AZM'
    {'idx': 15, 'label': 'Altitude', 'labelKey': 'ELV'},        # PL_ELV / 'ELV'
)
# REGIOMONTAN columns (appearance2dlg.py:263-277, check :316-338).
_SPECULUM_REGIOMONTAN_COLS = (
    {'idx': 0, 'label': 'Longitude', 'labelKey': 'Longitude'},        # LONG / 'Longitude'
    {'idx': 1, 'label': 'Latitude', 'labelKey': 'Latitude'},         # LAT / 'Latitude'
    {'idx': 2, 'label': 'Rectascension', 'labelKey': 'Rectascension'},    # RA / 'Rectascension'
    {'idx': 3, 'label': 'Declination', 'labelKey': 'Declination'},      # DECL / 'Declination'
    {'idx': 4, 'label': 'Meridiandist', 'labelKey': 'Meridiandist'},     # RMD / 'Meridiandist'
    {'idx': 5, 'label': 'Horizondist', 'labelKey': 'Horizondist'},      # RHD / 'Horizondist'
    {'idx': 6, 'label': 'ZD', 'labelKey': 'ZD'},               # ZD / 'ZD'
    {'idx': 7, 'label': 'Pole', 'labelKey': 'Pole'},             # POLE / 'Pole'
    {'idx': 8, 'label': 'Q', 'labelKey': 'Q'},                # Q / 'Q'
    {'idx': 9, 'label': 'W', 'labelKey': 'WReg'},             # W / 'WReg'
    {'idx': 10, 'label': 'CMP Vrt. Azmt.', 'labelKey': 'CMP'},  # CMP / 'CMP'
    {'idx': 11, 'label': 'RMP', 'labelKey': 'RMP'},             # RMP / 'RMP'
    {'idx': 12, 'label': 'Astrl. Azimuth', 'labelKey': 'AZM'},  # AZM / 'AZM'
    {'idx': 13, 'label': 'Altitude', 'labelKey': 'ELV'},        # ELV / 'ELV'
)
# Engine constants (chart.Chart.PLACIDIAN=0 / REGIOMONTAN=1, chart.py:493-494),
# mirrored as literals — the daemon is wx-free and must not import chart's wx
# siblings just for two ints.
_SPECULUM_PLACIDIAN = 0
_SPECULUM_REGIOMONTAN = 1

# Orb target rows (orbisdlg) — 0..10 planets/Nodes, then Houses pseudo-target.
_ORB_TARGET_CATALOG = (
    'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn',
    'Uranus', 'Neptune', 'Pluto', 'Nodes',
)

# dignityscores labels in canonical order (options.py:299): domicil,
# exaltation, triplicity, term, face. (mtexts key, English fallback) — resolved
# at call time in _dignity_score_labels() so they follow the active language.
_DIGNITY_SCORE_LABEL_KEYS = (
    ('Domicil', 'Domicile'), ('Exal', 'Exaltation'),
    ('Triplicity', 'Triplicity'), ('Term', 'Term'), ('Face', 'Face'),
)


def _dignity_score_labels() -> list:
    return [_txt(key, fallback) for key, fallback in _DIGNITY_SCORE_LABEL_KEYS]

# Term-set selector choices (selterm). The wx TermsDlg ComboBox lists
# mtexts.termList = (Egyptian, Ptolemaic) — termsdlg.py:95, mtexts.py:3683/3805.
# value == index into options.terms, the engine's selterm semantics.
_TERM_SET_CATALOG = (
    {'value': 0, 'label': 'Egyptian', 'labelKey': 'Egyptian'},
    {'value': 1, 'label': 'Ptolemaic', 'labelKey': 'Ptolemaic'},
)

# Row labels for the essential-dignities grid (DignitiesDlg planet RadioButtons,
# dignitiesdlg.py:48-67). The grid is options.dignities[planet][type][sign] over
# the first PLANETS_NUM-NODES = 10 planets (Sun..Pluto; nodes excluded — the wx
# check() loop is range(PLANETS_NUM-NODES), dignitiesdlg.py:249). mtexts keys are
# the wx-free oracle for the labels.
_DIGNITY_PLANET_KEYS = (
    'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
    'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
)
# The two dignity-type columns the wx grid edits (DignitiesDlg domicile/exaltatio
# RadioButtons, dignitiesdlg.py:74-77; the inner type index 0/1).
_DIGNITY_TYPE_KEYS = ('Domicil', 'Exal')
# Term-ruler combo choices (TermsDlg per-cell ComboBox over mtexts.pls2 =
# Mercury..Saturn, termsdlg.py:111). value == the stored planet code, which is
# the pls2 index + TermsDlg.OFFS (=2): Mercury=2..Saturn=6 (termsdlg.py:184).
_TERM_PLANET_OFFS = 2
_TERM_PLANET_KEYS = ('Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn')

# Glyph-variant selector choices (symbolsdlg.SymbolsDlg). Each option chooses one
# Morinus.ttf glyph variant; the glyph chars are mirrored verbatim from common.py
# (common.Uranus/common.Pluto, common.py:372-373; sign tables :370-371). uranus
# True -> Uranus[0]='H' (default), False -> Uranus[1]='6'. pluto 0..3 indexes
# Pluto=('J','7','8','9'). signs True -> Signs1 (default, 'a'..), False -> Signs2.
_SYMBOL_URANUS_GLYPHS = ('H', '6')
_SYMBOL_PLUTO_GLYPHS = ('J', '7', '8', '9')
_SYMBOL_URANUS_CATALOG = (
    {'value': True, 'glyph': _SYMBOL_URANUS_GLYPHS[0]},   # common.Uranus[0]
    {'value': False, 'glyph': _SYMBOL_URANUS_GLYPHS[1]},  # common.Uranus[1]
)
_SYMBOL_PLUTO_CATALOG = tuple(
    {'value': i, 'glyph': glyph} for i, glyph in enumerate(_SYMBOL_PLUTO_GLYPHS)
)
_SYMBOL_SIGNS_CATALOG = (
    {'value': True, 'glyph': 'a'},   # common.Signs1[0] (Aries)
    {'value': False, 'glyph': 'm'},  # common.Signs2[0] (Aries, alt set)
)

# Step alert bodies in the same order as common.STEP_ALERT_BODY_IDS and
# options.stepalerts_* vectors. Mean Node is the ascending node label in the wx
# dialog; True Node is used as the descendant-node slot by that same dialog.
_STEP_ALERT_BODY_CATALOG = (
    {'id': 0, 'label': 'Sun', 'glyph': _MORINUS_GLYPHS_BY_SEID[0], 'labelKey': 'Sun'},
    {'id': 1, 'label': 'Moon', 'glyph': _MORINUS_GLYPHS_BY_SEID[1], 'labelKey': 'Moon'},
    {'id': 2, 'label': 'Mercury', 'glyph': _MORINUS_GLYPHS_BY_SEID[2], 'labelKey': 'Mercury'},
    {'id': 3, 'label': 'Venus', 'glyph': _MORINUS_GLYPHS_BY_SEID[3], 'labelKey': 'Venus'},
    {'id': 4, 'label': 'Mars', 'glyph': _MORINUS_GLYPHS_BY_SEID[4], 'labelKey': 'Mars'},
    {'id': 5, 'label': 'Jupiter', 'glyph': _MORINUS_GLYPHS_BY_SEID[5], 'labelKey': 'Jupiter'},
    {'id': 6, 'label': 'Saturn', 'glyph': _MORINUS_GLYPHS_BY_SEID[6], 'labelKey': 'Saturn'},
    {'id': 7, 'label': 'Uranus', 'glyph': _MORINUS_GLYPHS_BY_SEID[7], 'labelKey': 'Uranus'},
    {'id': 8, 'label': 'Neptune', 'glyph': _MORINUS_GLYPHS_BY_SEID[8], 'labelKey': 'Neptune'},
    {'id': 9, 'label': 'Pluto', 'glyph': _MORINUS_GLYPHS_BY_SEID[9], 'labelKey': 'Pluto'},
    {'id': 10, 'label': 'Asc. Node', 'glyph': _MORINUS_GLYPHS_BY_SEID[10], 'labelKey': 'AscNode'},
    {'id': 11, 'label': 'Dsc. Node', 'glyph': _MORINUS_GLYPHS_BY_SEID[11], 'labelKey': 'DescNode'},
    {'id': 15, 'label': 'Chiron', 'glyph': _MORINUS_GLYPHS_BY_SEID[15], 'labelKey': 'Chiron'},
)

_STEP_ALERT_ANGLE_CATALOG = (
    {'value': 'Asc', 'label': 'Asc', 'labelKey': 'Asc'},
    {'value': 'Dsc', 'label': 'Dsc', 'labelKey': 'Dsc'},
    {'value': 'MC', 'label': 'MC', 'labelKey': 'MC'},
    {'value': 'IC', 'label': 'IC', 'labelKey': 'IC'},
)
_STEP_ALERT_PROMPLANET_DEFAULTS = tuple(True for _ in _STEP_ALERT_BODY_CATALOG)
_STEP_ALERT_SIGPLANET_DEFAULTS = tuple(False for _ in _STEP_ALERT_BODY_CATALOG)
_STEP_ALERT_SIGANGLE_DEFAULTS = (True, False, False, False)

# Numeric-slider metadata (appearance1dlg.py:287-304). _tokens ring-thickness
# bounds (aries/ui/tokens.py:133-135) mirrored wx-free as literals — importing
# the dialog is forbidden by verify_wiring_imports. The wx Table Size slider is
# decommissioned for the webapp until table sizing has a real web table contract.
# (attr, mtexts key, English fallback, min, max, step, kind). Labels resolved at
# call time in _slider_catalog() so they follow the active language.
_SLIDER_KEYS = (
    ('ascmcsize', 'AscMCWidth', 'Asc, MC Width', 2, 5, 1, 'int'),
    ('chartringthickness', 'RingThickness', 'Ring Thickness', 1, 3, 1, 'int'),
)


def _slider_catalog() -> list:
    return [
        {'attr': attr, 'label': str(mtexts.txts.get(key, fallback)),
         'min': lo, 'max': hi, 'step': step, 'kind': kind}
        for attr, key, fallback, lo, hi, step, kind in _SLIDER_KEYS
    ]

# Key-prompt presentation style enum (options.py:136/1384 accepted values).
_KEYPROMPT_STYLE_CATALOG = ('overlay', 'native', 'strip', 'off')

# Font-family profiles (fontprofiles.PROFILE_CHOICES) — wx-free module.
try:
    import fontprofiles as _fontprofiles
    _FONT_PROFILE_CATALOG = tuple(
        {'value': key, 'label': label} for key, label in _fontprofiles.PROFILE_CHOICES
    )
except Exception:  # pragma: no cover - fontprofiles is import-safe today
    _fontprofiles = None
    _FONT_PROFILE_CATALOG = ()

_WEB_FONT_PROFILE_FAMILIES = {
    'freesans': 'FreeSans',
    'kosugi': 'Kosugi',
    'dot_gothic16': 'DotGothic16',
}
_WEB_FONT_LANGUAGE_FAMILIES = {
    6: 'Noto Sans SC',
    7: 'Noto Sans TC',
    8: 'Noto Sans KR',
}


def _coerce_font_profile(value: Any) -> str:
    if _fontprofiles is not None:
        return _fontprofiles.coerce_profile(value)
    return value if value in _WEB_FONT_PROFILE_FAMILIES else 'freesans'


def _web_text_font_family(opts) -> str:
    # Mirrors fontprofiles.apply_to_common: CJK language bundles override the
    # display profile; Kosugi/DotGothic only apply for non-CJK languages.
    try:
        langid = int(getattr(opts, 'langid', 0) or 0)
    except Exception:
        langid = 0
    family = _WEB_FONT_LANGUAGE_FAMILIES.get(langid)
    if family:
        return family
    profile = _coerce_font_profile(getattr(opts, 'fontfamily', 'freesans'))
    return _WEB_FONT_PROFILE_FAMILIES.get(profile, 'FreeSans')


def _web_text_font_stack(opts) -> str:
    family = _web_text_font_family(opts)
    if family == 'FreeSans':
        return "'FreeSans', ui-sans-serif, system-ui, sans-serif"
    return f"'{family}', 'FreeSans', ui-sans-serif, system-ui, sans-serif"

# Default-location field metadata — labels + control kinds the skin renders
# generic controls from. The wx oracle is defaultlocdlg.py:69-231, whose
# StaticText/RadioButton labels come from mtexts.txts keys (Long, Deg, Min, E, W,
# N, S, GMT, Daylight, Altitude). The labels below are PARAPHRASED for the web
# skin (e.g. "Longitude (deg)" for the Long+Deg pair, "E / W" for the E/W radio,
# "GMT +/-" for the GMT sign) — NOT verbatim mtexts text. Labels are skin
# presentation only; the behaviour-bearing data is `attr` (the options.py def*
# key) + `kind`. kind ∈ name|int|sign|bool|text. `sign` fields carry the pair of
# radio labels (positive,negative); the place name + tzid are handled by the
# custom place-search control on the frontend but still catalogued here so the
# daemon stays the field oracle.
_DEFLOC_FIELD_CATALOG = (
    {'attr': 'deflocname', 'label': 'Place', 'kind': 'name', 'labelKey': 'Place'},
    {'attr': 'defloclondeg', 'label': 'Longitude (deg)', 'kind': 'int',
     'min': 0, 'max': 180, 'labelKey': 'LongitudeDeg'},
    {'attr': 'defloclonmin', 'label': 'Longitude (min)', 'kind': 'int',
     'min': 0, 'max': 59, 'labelKey': 'LongitudeMin'},
    {'attr': 'defloceast', 'label': 'E / W', 'kind': 'sign',
     'positive': 'E', 'negative': 'W'},
    {'attr': 'defloclatdeg', 'label': 'Latitude (deg)', 'kind': 'int',
     'min': 0, 'max': 90, 'labelKey': 'LatitudeDeg'},
    {'attr': 'defloclatmin', 'label': 'Latitude (min)', 'kind': 'int',
     'min': 0, 'max': 59, 'labelKey': 'LatitudeMin'},
    {'attr': 'deflocnorth', 'label': 'N / S', 'kind': 'sign',
     'positive': 'N', 'negative': 'S'},
    {'attr': 'deflocalt', 'label': 'Altitude (m)', 'kind': 'int',
     'min': 0, 'max': 10000, 'labelKey': 'AltitudeM'},
    {'attr': 'defloctzauto', 'label': 'Auto DST/TZ', 'kind': 'bool', 'labelKey': 'AutoDstTz'},
    {'attr': 'deflocplus', 'label': 'GMT +/-', 'kind': 'sign',
     'positive': '+', 'negative': '-'},
    {'attr': 'defloczhour', 'label': 'Zone (hour)', 'kind': 'int',
     'min': 0, 'max': 12, 'labelKey': 'ZoneHour'},
    {'attr': 'defloczminute', 'label': 'Zone (min)', 'kind': 'int',
     'min': 0, 'max': 59, 'labelKey': 'ZoneMin'},
    {'attr': 'deflocdst', 'label': 'Daylight saving', 'kind': 'bool', 'labelKey': 'Daylight'},
    {'attr': 'defloctzid', 'label': 'Timezone id', 'kind': 'text', 'labelKey': 'TimezoneId'},
)


def _rgb(value: Any) -> Optional[list]:
    try:
        r, g, b = (int(c) for c in tuple(value)[:3])
    except Exception:
        return None
    return [max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))]


def _coerce_rgb(value: Any) -> Optional[tuple]:
    rgb = _rgb(value)
    return tuple(rgb) if rgb is not None else None


def _rgb_or(value: Any, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    rgb = _coerce_rgb(value)
    return rgb if rgb is not None else fallback


def _css_rgb(value: tuple[int, int, int]) -> str:
    return f'rgb({value[0]} {value[1]} {value[2]})'


def _mix_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


_PROFILE_BODY_COLOR_ROLES = (
    ('chart.color.body.sun', '--morinus-body-sun', 0),
    ('chart.color.body.moon', '--morinus-body-moon', 1),
    ('chart.color.body.mercury', '--morinus-body-mercury', 2),
    ('chart.color.body.venus', '--morinus-body-venus', 3),
    ('chart.color.body.mars', '--morinus-body-mars', 4),
    ('chart.color.body.jupiter', '--morinus-body-jupiter', 5),
    ('chart.color.body.saturn', '--morinus-body-saturn', 6),
    ('chart.color.body.uranus', '--morinus-body-uranus', 7),
    ('chart.color.body.neptune', '--morinus-body-neptune', 8),
    ('chart.color.body.pluto', '--morinus-body-pluto', 9),
    ('chart.color.body.nodes', '--morinus-body-nodes', 10),
    ('chart.color.body.fortune', '--morinus-body-fortune', 11),
    ('chart.color.body.chiron', '--morinus-body-chiron', 12),
)

_PROFILE_ASPECT_COLOR_ROLES = (
    ('chart.color.aspect.conjunction', '--morinus-aspect-conjunction', 0),
    ('chart.color.aspect.semisextile', '--morinus-aspect-semisextile', 1),
    ('chart.color.aspect.semisquare', '--morinus-aspect-semisquare', 2),
    ('chart.color.aspect.sextile', '--morinus-aspect-sextile', 3),
    ('chart.color.aspect.quintile', '--morinus-aspect-quintile', 4),
    ('chart.color.aspect.square', '--morinus-aspect-square', 5),
    ('chart.color.aspect.trine', '--morinus-aspect-trine', 6),
    ('chart.color.aspect.sesquisquare', '--morinus-aspect-sesquisquare', 7),
    ('chart.color.aspect.biquintile', '--morinus-aspect-biquintile', 8),
    ('chart.color.aspect.quincunx', '--morinus-aspect-quincunx', 9),
    ('chart.color.aspect.opposition', '--morinus-aspect-opposition', 10),
    ('chart.color.aspect.septile', '--morinus-aspect-septile', 11),
    ('chart.color.aspect.parallel', '--morinus-aspect-parallel', 12),
    ('chart.color.aspect.contraparallel', '--morinus-aspect-contraparallel', 13),
)

_PROFILE_ELEMENT_COLOR_ROLES = (
    ('chart.color.element.fire', '--morinus-element-fire', 'clrsignelementfire'),
    ('chart.color.element.earth', '--morinus-element-earth', 'clrsignelementearth'),
    ('chart.color.element.air', '--morinus-element-air', 'clrsignelementair'),
    ('chart.color.element.water', '--morinus-element-water', 'clrsignelementwater'),
)


_PROFILE_CHART_BASE_ATTRS = {
    'chart.color.background': 'clrbackground',
    'chart.color.textBright': 'clrtexts',
    'chart.color.frame': 'clrframe',
    'chart.color.signs': 'clrsigns',
    'chart.color.angles': 'clrAscMC',
    'chart.color.houses': 'clrhouses',
    'chart.color.houseNumbers': 'clrhousenumbers',
    'chart.color.positions': 'clrpositions',
    'chart.color.peregrine': 'clrperegrin',
    'chart.color.dignity.domicile': 'clrdomicil',
    'chart.color.dignity.exile': 'clrexil',
    'chart.color.dignity.exaltation': 'clrexal',
    'chart.color.dignity.fall': 'clrcasus',
    'chart.color.element.fire': 'clrsignelementfire',
    'chart.color.element.earth': 'clrsignelementearth',
    'chart.color.element.air': 'clrsignelementair',
    'chart.color.element.water': 'clrsignelementwater',
}

_PROFILE_APP_BASE_ATTRS = {
    'app.color.background': 'clrappbackground',
    'app.color.textPrimary': 'clrapptexts',
    'app.color.surface': 'clrsidebar',
    'app.sidebar.foreground': 'clrsidebartext',
}

_PROFILE_CHART_BASE_EXTRA_ATTRS = (
    'clrtable',
    'clrindividual',
    'clraspect',
)


def _effective_body_color_list(options) -> list[tuple[int, int, int]]:
    fallback = _rgb_or(
        getattr(options, 'clrperegrin', None),
        _rgb_or(getattr(options, 'clrtexts', None), (205, 205, 209)),
    )
    result = []
    for value in list(getattr(options, 'clrindividual', ()) or ())[:13]:
        result.append(_rgb_or(value, fallback))
    while len(result) < 13:
        result.append(fallback)
    return result


def _effective_aspect_color_list(options) -> list[tuple[int, int, int]]:
    text_fallback = _rgb_or(getattr(options, 'clrtexts', None), (205, 205, 209))
    frame_fallback = _rgb_or(getattr(options, 'clrframe', None), text_fallback)
    result = []
    for value in list(getattr(options, 'clraspect', ()) or ())[:14]:
        fallback = frame_fallback if len(result) == 13 else text_fallback
        result.append(_rgb_or(value, fallback))
    while len(result) < 12:
        result.append(text_fallback)
    if len(result) < 13:
        result.append(text_fallback)
    if len(result) < 14:
        result.append(frame_fallback)
    return result


def _profile_indexed_color_overrides(
    explicit: dict,
    roles,
) -> dict[int, tuple[int, int, int]]:
    result = {}
    for semantic_id, _css_var, index in roles:
        if semantic_id not in explicit:
            continue
        rgb = _coerce_rgb(explicit[semantic_id])
        if rgb is not None:
            result[index] = rgb
    return result


def _style_profile_base_values(opts, profile: Optional[dict]) -> tuple[dict, bool, bool]:
    """Resolve a profile base as a non-mutating effective palette layer.

    A named style profile must never rewrite the user's underlying options.
    Scope controls which half of a legacy preset participates: an app profile
    cannot recolor charts, and a chart profile cannot recolor app chrome.
    """
    base_preset_id = (profile or {}).get('basePresetId')
    scope = (profile or {}).get('scope')
    legacy_values = _LEGACY_STYLE_PROFILE_BASE_PRESETS.get(base_preset_id)
    if legacy_values is not None:
        values = copy.deepcopy(legacy_values)
    elif base_preset_id in PALETTE_PRESET_NAMES:
        values = _resolve_palette_preset_values(opts, base_preset_id)
    else:
        return {}, False, False
    return values, scope in ('app', 'combined'), scope in ('chart', 'combined')


def _profile_base_chart_semantic_overrides(opts, profile: Optional[dict]) -> dict[str, list[int]]:
    values, _, use_chart_base = _style_profile_base_values(opts, profile)
    if not use_chart_base:
        return {}
    result: dict[str, list[int]] = {}
    for semantic_id, attr in _PROFILE_CHART_BASE_ATTRS.items():
        rgb = _rgb(values.get(attr))
        if rgb is not None:
            result[semantic_id] = rgb
    base_only_profile = {
        'scope': (profile or {}).get('scope'),
        'basePresetId': (profile or {}).get('basePresetId'),
        'overrides': {},
    }
    effective_base = _effective_style_chart_options(opts, base_only_profile)
    bodies = _effective_body_color_list(effective_base)
    aspects = _effective_aspect_color_list(effective_base)
    for semantic_id, _css_var, index in _PROFILE_BODY_COLOR_ROLES:
        result[semantic_id] = list(bodies[index])
    for semantic_id, _css_var, index in _PROFILE_ASPECT_COLOR_ROLES:
        result[semantic_id] = list(aspects[index])
    return result


def _profile_base_app_semantic_overrides(opts, profile: Optional[dict]) -> dict[str, list[int]]:
    values, use_app_base, _ = _style_profile_base_values(opts, profile)
    if not use_app_base:
        return {}
    result: dict[str, list[int]] = {}
    for semantic_id, attr in _PROFILE_APP_BASE_ATTRS.items():
        rgb = _rgb(values.get(attr))
        if rgb is not None:
            result[semantic_id] = rgb
    return result


def _effective_style_chart_options(opts, profile: Optional[dict]):
    """Copy chart color state through the active profile without persistence.

    Retained Python renderers (Astrocart and PNG/PDF GraphChart) cannot consume
    CSS. They receive this shallow options adapter, including a chart-scoped
    base preset's individual/aspect/element arrays and final explicit semantic
    chart-color overrides. Calculation and display-option fields are untouched.
    """
    base_values, _, use_chart_base = _style_profile_base_values(opts, profile)
    typed_overrides = (profile or {}).get('overrides')
    explicit = typed_overrides if isinstance(typed_overrides, dict) else {}
    semantic_overrides = {
        attr: explicit[semantic_id]
        for semantic_id, attr in _PROFILE_CHART_BASE_ATTRS.items()
        if semantic_id in explicit
    }
    body_overrides = _profile_indexed_color_overrides(explicit, _PROFILE_BODY_COLOR_ROLES)
    aspect_overrides = _profile_indexed_color_overrides(explicit, _PROFILE_ASPECT_COLOR_ROLES)
    if not use_chart_base and not semantic_overrides and not body_overrides and not aspect_overrides:
        return opts
    resolved = copy.copy(opts)
    if use_chart_base:
        for attr in (*_PROFILE_CHART_BASE_ATTRS.values(), *_PROFILE_CHART_BASE_EXTRA_ATTRS):
            if attr in base_values:
                setattr(resolved, attr, copy.deepcopy(base_values[attr]))
    for attr, value in semantic_overrides.items():
        rgb = _coerce_rgb(value)
        if rgb is not None:
            setattr(resolved, attr, rgb)
    if use_chart_base or body_overrides:
        body_colors = _effective_body_color_list(resolved)
        for index, rgb in body_overrides.items():
            body_colors[index] = rgb
        resolved.clrindividual = body_colors
    if use_chart_base or aspect_overrides:
        aspect_colors = _effective_aspect_color_list(resolved)
        for index, rgb in aspect_overrides.items():
            aspect_colors[index] = rgb
        resolved.clraspect = aspect_colors
    return resolved


def _profile_chart_data_overrides(opts, profile: Optional[dict]) -> dict[str, list[str]]:
    """Non-scalar palette data needed to beat retained frontend snapshots."""
    _, _, use_chart_base = _style_profile_base_values(opts, profile)
    typed_overrides = (profile or {}).get('overrides')
    explicit = typed_overrides if isinstance(typed_overrides, dict) else {}
    body_requested = use_chart_base or any(
        semantic_id in explicit for semantic_id, _css_var, _index in _PROFILE_BODY_COLOR_ROLES
    )
    aspect_requested = use_chart_base or any(
        semantic_id in explicit for semantic_id, _css_var, _index in _PROFILE_ASPECT_COLOR_ROLES
    )
    sign_requested = (
        use_chart_base
        or 'chart.color.signs' in explicit
        or any(semantic_id in explicit for semantic_id, _css_var, _attr in _PROFILE_ELEMENT_COLOR_ROLES)
    )
    if not body_requested and not aspect_requested and not sign_requested:
        return {}
    effective = _effective_style_chart_options(opts, profile)

    result: dict[str, list[str]] = {}
    if body_requested:
        result['planets'] = [_css_rgb(value) for value in _effective_body_color_list(effective)]
    if aspect_requested:
        result['aspects'] = [_css_rgb(value) for value in _effective_aspect_color_list(effective)]

    if sign_requested and bool(getattr(effective, 'usezodiacelementcolors', False)):
        element_colors = [
            _css_rgb(_rgb_or(getattr(effective, attr, None), (255, 255, 255)))
            for _semantic_id, _css_var, attr in _PROFILE_ELEMENT_COLOR_ROLES
        ]
        result['signColors'] = [element_colors[index % 4] for index in range(12)]
    elif sign_requested:
        sign_color = _css_rgb(_rgb_or(getattr(effective, 'clrsigns', None), (255, 255, 255)))
        result['signColors'] = [sign_color] * 12
    return result


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    def channel(v: int) -> float:
        c = v / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def _theme_state_payload(opts, active_profile: Optional[dict] = None) -> dict:
    """Ready-to-apply web theme state derived once from options.py clr* fields.

    React consumes the semantic CSS-variable contract below; it does not know
    about wx option field names.
    """
    base_values, use_app_base, use_chart_base = _style_profile_base_values(opts, active_profile)

    def option_rgb(attr: str, fallback: tuple[int, int, int], *, use_base: bool) -> tuple[int, int, int]:
        source = base_values.get(attr) if use_base and attr in base_values else getattr(opts, attr, None)
        return _rgb_or(source, fallback)

    chart_bg = option_rgb('clrbackground', (35, 36, 40), use_base=use_chart_base)
    chart_text = option_rgb('clrtexts', (255, 255, 255), use_base=use_chart_base)
    app_bg = option_rgb('clrappbackground', chart_bg, use_base=use_app_base)
    app_text = option_rgb('clrapptexts', chart_text, use_base=use_app_base)
    sidebar = option_rgb('clrsidebar', app_bg, use_base=use_app_base)
    sidebar_text = option_rgb('clrsidebartext', app_text, use_base=use_app_base)
    frame = option_rgb('clrframe', chart_text, use_base=use_chart_base)
    houses = option_rgb('clrhouses', (138, 139, 141), use_base=use_chart_base)
    table = option_rgb('clrtable', chart_bg, use_base=use_chart_base)
    explicit_app_tokens, explicit_chart_tokens = split_style_profile_css_overrides(active_profile)
    typed_overrides = (active_profile or {}).get('overrides', {})

    def typed_rgb(semantic_id: str, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
        value = typed_overrides.get(semantic_id) if isinstance(typed_overrides, dict) else None
        return _rgb_or(value, fallback)

    # Root app colors affect all derived semantics, so resolve their typed
    # overrides before calculating mode, muted text, borders, and accents.
    effective_app_bg = typed_rgb('app.color.background', app_bg)
    effective_app_text = typed_rgb('app.color.textPrimary', app_text)
    is_dark = _relative_luminance(effective_app_bg) < 0.5
    active_palette_name = (
        _current_palette_preset_name(opts)
        if active_profile is None
        else None
    )
    # These established palettes predate independently authored full-pane
    # materials. Their subtle clrsidebar value belongs to controls and small
    # regions, not an entire sidebar or inspector. Keep their app backgrounds
    # unified; saved/custom profiles remain free to author app.color.surface
    # or individual pane backgrounds.
    surface_fallback = (
        effective_app_bg
        if active_palette_name in _UNIFIED_APP_SURFACE_PRESETS
        else sidebar
    )
    effective_sidebar = typed_rgb('app.color.surface', surface_fallback)
    toward_text = effective_app_text if is_dark else (0, 0, 0)
    surface_subtle = _mix_rgb(effective_sidebar, toward_text, 0.10 if is_dark else 0.06)
    accent = _mix_rgb(effective_sidebar, toward_text, 0.18 if is_dark else 0.11)
    border = _mix_rgb(effective_sidebar, toward_text, 0.20 if is_dark else 0.18)
    muted_text = _mix_rgb(effective_app_text, effective_app_bg, 0.34 if is_dark else 0.28)
    dim_text = _mix_rgb(effective_app_text, effective_app_bg, 0.50 if is_dark else 0.42)
    titlebar_text = _mix_rgb(effective_app_text, effective_app_bg, 0.16)

    text_font_stack = _web_text_font_stack(opts)
    app_tokens = {
        '--aries-font-ui': text_font_stack,
        '--aries-font-symbols': '"AriesMorinus", ui-sans-serif',
        '--font-ui': 'var(--aries-font-ui)',
        '--aries-text-primary': _css_rgb(effective_app_text),
        '--aries-text-muted': _css_rgb(muted_text),
        '--aries-text-dim': _css_rgb(dim_text),
        '--aries-sidebar-text': _css_rgb(sidebar_text),
        '--aries-background': _css_rgb(effective_app_bg),
        '--aries-surface': _css_rgb(effective_sidebar),
        '--aries-surface-subtle': _css_rgb(surface_subtle),
        '--aries-accent': _css_rgb(accent),
        '--aries-accent-foreground': 'var(--aries-text-primary)',
        '--aries-border-subtle': _css_rgb(border),
        '--aries-sidebar-background': 'var(--aries-surface)',
        '--aries-sidebar-accent-foreground': 'var(--aries-accent-foreground)',
        '--aries-titlebar-background': 'var(--aries-background)',
        '--aries-titlebar-text': _css_rgb(titlebar_text),
        '--aries-statusbar-background': 'var(--aries-background)',
        '--aries-panel-background': 'var(--aries-surface)',
        '--aries-panel-text': 'var(--aries-text-primary)',
        '--aries-overlay-background': 'var(--aries-surface)',
        '--aries-overlay-text': 'var(--aries-text-primary)',
        '--aries-popover-background': 'var(--aries-background)',
        '--aries-popover-text': 'var(--aries-text-primary)',
        '--aries-control-background': 'var(--aries-surface-subtle)',
        '--aries-control-text': 'var(--aries-text-primary)',
        '--aries-data-body-background': 'var(--aries-background)',
        '--aries-data-body-text': 'var(--aries-text-primary)',
        '--aries-data-header-background': 'var(--aries-surface)',
        '--aries-data-header-text': 'var(--aries-text-primary)',

        # Compatibility aliases are references, not a second concrete palette.
        # This keeps shadcn/Tailwind consumers synchronized with Aries semantic
        # tokens when a future profile or transient design preview overrides one.
        '--background': 'var(--aries-background)',
        '--foreground': 'var(--aries-text-primary)',
        '--card': 'var(--aries-panel-background)',
        '--card-foreground': 'var(--aries-panel-text)',
        '--popover': 'var(--aries-popover-background)',
        '--popover-foreground': 'var(--aries-popover-text)',
        '--primary': 'var(--aries-text-primary)',
        '--primary-foreground': 'var(--aries-surface)',
        '--secondary': 'var(--aries-accent)',
        '--secondary-foreground': 'var(--aries-accent-foreground)',
        '--muted': 'var(--aries-surface-subtle)',
        '--muted-foreground': 'var(--aries-text-dim)',
        '--accent': 'var(--aries-accent)',
        '--accent-foreground': 'var(--aries-accent-foreground)',
        '--destructive': 'var(--aries-destructive)',
        '--border': 'var(--aries-border-subtle)',
        '--input': 'var(--aries-border-subtle)',
        '--ring': 'var(--aries-text-muted)',

        '--sidebar': 'var(--aries-sidebar-background)',
        '--sidebar-foreground': 'var(--aries-sidebar-text)',
        '--sidebar-primary': 'var(--aries-text-primary)',
        '--sidebar-primary-foreground': 'var(--aries-surface)',
        '--sidebar-accent': 'var(--aries-accent)',
        '--sidebar-accent-foreground': 'var(--aries-sidebar-accent-foreground)',
        '--sidebar-border': 'var(--aries-border-subtle)',
        '--sidebar-ring': 'var(--aries-text-muted)',
    }
    chart_palette = {
        '--morinus-background': _css_rgb(chart_bg),
        '--morinus-text-bright': _css_rgb(chart_text),
        '--morinus-frame': _css_rgb(frame),
        '--morinus-signs': _css_rgb(option_rgb('clrsigns', frame, use_base=use_chart_base)),
        '--morinus-angles': _css_rgb(option_rgb('clrAscMC', frame, use_base=use_chart_base)),
        '--morinus-houses': _css_rgb(houses),
        '--morinus-housenums': _css_rgb(option_rgb('clrhousenumbers', houses, use_base=use_chart_base)),
        '--morinus-peregrin': _css_rgb(option_rgb('clrperegrin', frame, use_base=use_chart_base)),
        '--morinus-positions': _css_rgb(option_rgb('clrpositions', chart_text, use_base=use_chart_base)),
        '--morinus-table': _css_rgb(table),
        '--morinus-dignity-domicil': _css_rgb(option_rgb('clrdomicil', (2, 191, 2), use_base=use_chart_base)),
        '--morinus-dignity-exil': _css_rgb(
            option_rgb('clrexil', (255, 85, 75), use_base=use_chart_base)
        ),
        '--morinus-dignity-exal': _css_rgb(option_rgb('clrexal', (255, 215, 0), use_base=use_chart_base)),
        '--morinus-dignity-casus': _css_rgb(option_rgb('clrcasus', (205, 92, 92), use_base=use_chart_base)),
    }
    if use_chart_base:
        base_chart_options = _effective_style_chart_options(opts, {
            'scope': (active_profile or {}).get('scope'),
            'basePresetId': (active_profile or {}).get('basePresetId'),
            'overrides': {},
        })
    else:
        base_chart_options = opts
    body_colors = _effective_body_color_list(base_chart_options)
    aspect_colors = _effective_aspect_color_list(base_chart_options)
    for _semantic_id, css_var, index in _PROFILE_BODY_COLOR_ROLES:
        chart_palette[css_var] = _css_rgb(body_colors[index])
    for _semantic_id, css_var, index in _PROFILE_ASPECT_COLOR_ROLES:
        chart_palette[css_var] = _css_rgb(aspect_colors[index])
    for _semantic_id, css_var, attr in _PROFILE_ELEMENT_COLOR_ROLES:
        chart_palette[css_var] = _css_rgb(
            option_rgb(attr, frame, use_base=use_chart_base)
        )
    # A base preset participates in the active profile layer so it wins over a
    # retained chart snapshot, but it never mutates the saved options beneath
    # the profile. Explicit semantic overrides remain the final authority.
    profile_app_tokens = dict(app_tokens) if use_app_base else {}
    profile_chart_tokens = dict(chart_palette) if use_chart_base else {}
    profile_app_tokens.update(explicit_app_tokens)
    profile_chart_tokens.update(explicit_chart_tokens)
    app_tokens.update(explicit_app_tokens)
    chart_palette.update(explicit_chart_tokens)
    active_profile_summary = None
    if active_profile:
        active_profile_summary = {
            key: active_profile.get(key)
            for key in ('id', 'name', 'scope', 'basePresetId', 'contentHash')
        }
    builtin_preset_name = _style_lab_system_preset_name(active_profile)
    return {
        'activePreset': (
            builtin_preset_name
            if builtin_preset_name is not None
            else _style_profile_theme_name(str(active_profile['id']))
            if active_profile
            else _current_palette_preset_name(opts)
        ),
        'mode': 'dark' if is_dark else 'light',
        'presentationCursor': bool(getattr(opts, 'presentation_cursor', False)),
        'appTokens': app_tokens,
        'chartPalette': chart_palette,
        'activeProfile': active_profile_summary,
        'profileOverrides': {
            'appTokens': profile_app_tokens,
            'chartPalette': profile_chart_tokens,
            'chartData': _profile_chart_data_overrides(opts, active_profile),
            'wheelAuthoring': copy.deepcopy(
                (active_profile or {}).get('authoringOverrides') or {}
            ),
            'appAuthoring': copy.deepcopy(
                (active_profile or {}).get('appAuthoringOverrides') or {}
            ),
        },
    }


def _theme_payload_hash(payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]


def _system_is_dark() -> bool:
    """wx-free best effort for colorsdlg's theme.system_is_dark()."""
    try:
        proc = subprocess.run(
            ['defaults', 'read', '-g', 'AppleInterfaceStyle'],
            check=False,
            capture_output=True,
            text=True,
            timeout=0.5,
        )
        return proc.returncode == 0 and proc.stdout.strip().lower() == 'dark'
    except Exception:
        return False


def _normalize_clrindividual(opts, values: Any) -> list:
    if hasattr(opts, '_normalize_clrindividual'):
        try:
            return list(opts._normalize_clrindividual(values))
        except Exception:
            pass
    return [tuple(v) for v in (values or [])]


def _coerce_rgb_list(values: Any, fallback: list | tuple, expected: Optional[int] = None) -> list:
    fallback_values = [tuple(v) for v in fallback]
    count = expected if expected is not None else len(fallback_values)
    source = list(values) if isinstance(values, (list, tuple)) else []
    out = []
    for i in range(count):
        fallback_rgb = fallback_values[i] if i < len(fallback_values) else fallback_values[-1]
        rgb = _coerce_rgb(source[i]) if i < len(source) else None
        out.append(rgb if rgb is not None else fallback_rgb)
    return out


def _bool_or(value: Any, fallback: bool) -> bool:
    return value if isinstance(value, bool) else fallback


def _resolve_palette_preset_values(opts, name: str) -> dict:
    if name == _SYSTEM_AUTO_NAME:
        return dict(_CURRENT_COLOR_NIGHT_PRESET if _system_is_dark() else _CURRENT_COLOR_DAY_PRESET)
    if name == _MY_COLORS_NAME:
        if hasattr(opts, 'get_custom_color_preset'):
            return dict(opts.get_custom_color_preset())
        return _capture_palette_state(opts)
    if name == 'Midnight':
        return dict(_CURRENT_COLOR_NIGHT_PRESET)
    if name == 'Daylight':
        return dict(_CURRENT_COLOR_DAY_PRESET)
    if name == NASA_ATLAS_PRESET_NAME:
        return dict(_CURRENT_COLOR_DAY_PRESET)
    if name == 'Diurnal':
        return dict(_DIURNAL_PRESET)
    if name == 'Classic Morinus':
        return dict(_CLASSIC_MORINUS_PRESET)
    if name == 'Taurus':
        return dict(_TAURUS_PRESET)
    if name == 'Nocturne':
        return dict(_NOCTURNE_PRESET)
    if name == 'Sirius':
        return dict(_SIRIUS_PRESET)
    raise ValueError(f'unknown palette preset: {name!r}')


def _capture_palette_state(opts) -> dict:
    state = {'follow_os_theme': bool(getattr(opts, 'follow_os_theme', True))}
    for attr in _PALETTE_ATTR_NAMES:
        state[attr] = getattr(opts, attr, None)
    state['usezodiacelementcolors'] = bool(getattr(opts, 'usezodiacelementcolors', False))
    state['clrindividual'] = list(getattr(opts, 'clrindividual', []) or [])
    state['clraspect'] = list(getattr(opts, 'clraspect', []) or [])
    state['useplanetcolors'] = bool(getattr(opts, 'useplanetcolors', False))
    return state


def _factory_default_palette_state(opts) -> dict:
    # Factory/user colors.opt may be older than the current saved layout. Treat
    # def_* values as untrusted here so Restore Default never installs shifted
    # fields such as a bool in an RGB slot.
    shifted_tail = not isinstance(getattr(opts, 'def_usezodiacelementcolors', None), bool)
    state = {}
    for attr in _PALETTE_ATTR_NAMES:
        fallback = _CURRENT_COLOR_NIGHT_PRESET.get(attr, (0, 0, 0))
        if shifted_tail and attr in _ZODIAC_ELEMENT_DEFAULTS:
            state[attr] = _ZODIAC_ELEMENT_DEFAULTS[attr]
            continue
        state[attr] = _rgb_or(getattr(opts, f'def_{attr}', None), fallback)
    state['usezodiacelementcolors'] = _bool_or(
        getattr(opts, 'def_usezodiacelementcolors', None),
        False,
    )
    state['clrindividual'] = _normalize_clrindividual(
        opts,
        _coerce_rgb_list(
            getattr(opts, 'def_clrindividual', None),
            _CURRENT_COLOR_NIGHT_PRESET['clrindividual'],
        ),
    )
    state['clraspect'] = _coerce_rgb_list(
        getattr(opts, 'def_clraspect', None),
        _DARK_THEME_ASPECTS,
        expected=len(_DARK_THEME_ASPECTS),
    )
    state['useplanetcolors'] = _bool_or(
        getattr(opts, 'def_useplanetcolors', None),
        False,
    )
    return state


def _preset_identity_snapshot(state: dict) -> dict:
    snap = dict(state or {})
    snap.pop('usemacsystemcolors', None)
    snap.pop('usezodiacelementcolors', None)
    snap.pop('follow_os_theme', None)
    return snap


def _current_palette_preset_name(opts) -> str:
    if bool(getattr(opts, 'follow_os_theme', True)):
        return _SYSTEM_AUTO_NAME
    current = _preset_identity_snapshot(_capture_palette_state(opts))
    for name in ('Midnight', 'Daylight', 'Diurnal', 'Classic Morinus', 'Taurus', 'Nocturne', 'Sirius'):
        if current == _preset_identity_snapshot(_resolve_palette_preset_values(opts, name)):
            return name
    if hasattr(opts, 'get_custom_color_preset'):
        if current == _preset_identity_snapshot(opts.get_custom_color_preset()):
            return _MY_COLORS_NAME
    return _MY_COLORS_NAME


def _set_color_list_attr(opts, attr: str, values: Any) -> bool:
    coerced = [_coerce_rgb(v) for v in (values or [])]
    if not coerced or any(v is None for v in coerced):
        return False
    normalized = _normalize_clrindividual(opts, coerced) if attr == 'clrindividual' else list(coerced)
    existing = getattr(opts, attr, None)
    if isinstance(existing, list):
        if list(existing) == list(normalized):
            return False
        existing[:] = normalized
    else:
        if list(existing or []) == list(normalized):
            return False
        setattr(opts, attr, normalized)
    return True


def _apply_palette_values(opts, name: str, values: dict) -> bool:
    changed = False
    follow = (name == _SYSTEM_AUTO_NAME)
    if bool(getattr(opts, 'follow_os_theme', True)) != follow:
        opts.follow_os_theme = follow
        changed = True
    for attr in _PALETTE_ATTR_NAMES:
        if attr not in values:
            continue
        rgb = _coerce_rgb(values[attr])
        if rgb is not None and getattr(opts, attr, None) != rgb:
            setattr(opts, attr, rgb)
            changed = True
    if 'clrindividual' in values:
        changed |= _set_color_list_attr(opts, 'clrindividual', values['clrindividual'])
    if 'clraspect' in values:
        changed |= _set_color_list_attr(opts, 'clraspect', values['clraspect'])
    if 'useplanetcolors' in values:
        new = bool(values['useplanetcolors'])
        if bool(getattr(opts, 'useplanetcolors', False)) != new:
            opts.useplanetcolors = new
            changed = True
    # The toggle is part of every complete palette. Otherwise applying Daylight
    # leaks its enabled element colours into the next fixed or system preset.
    if 'usezodiacelementcolors' in values:
        new = bool(values['usezodiacelementcolors'])
        if bool(getattr(opts, 'usezodiacelementcolors', False)) != new:
            opts.usezodiacelementcolors = new
            changed = True
    return changed


def _maybe_update_custom_palette(opts) -> bool:
    if not hasattr(opts, 'get_custom_color_preset') or not hasattr(opts, 'set_custom_color_preset'):
        return False
    state = _capture_palette_state(opts)
    state['follow_os_theme'] = False
    if _preset_identity_snapshot(state) == _preset_identity_snapshot(_factory_default_palette_state(opts)):
        return False
    for name in ('Midnight', 'Daylight', 'Diurnal', 'Classic Morinus', 'Taurus', 'Nocturne', 'Sirius'):
        if _preset_identity_snapshot(state) == _preset_identity_snapshot(_resolve_palette_preset_values(opts, name)):
            return False
    if state == opts.get_custom_color_preset():
        return False
    opts.set_custom_color_preset(state)
    return True


# ---------------------------------------------------------------------------
# Fixed-star SE-catalog reader — wx-free port of fixstarsdlg.FixStarCatalog
# (fixstarsdlg.py:26-114). The wx module imports wx so it can't be imported
# here; the catalog logic itself only uses astrology/chart/util (wx-free) and is
# transcribed verbatim. The full Swiss-Ephemeris fixed-star catalog (~1362 rows)
# is enumerated once and cached, since each row is a swe_fixstar_ut call.
# ---------------------------------------------------------------------------

_FIXSTAR_EPHE_PATH = str(REPO_ROOT / 'SWEP' / 'Ephem')  # common.py:313 derives this
_FIXSTAR_CATALOG_CANDIDATES = (
    REPO_ROOT / 'SWEP' / 'Ephem' / 'sefstars.txt',
    REPO_ROOT / 'SWEP' / 'Ephem' / 'fixstars.cat',
    REPO_ROOT / 'SWEP' / 'Ephem' / 'fixedstars.cat',
)
_FIXSTAR_ALIAS_JSON = REPO_ROOT / 'SWEP' / 'Ephem' / 'fixstar_aliases.json'
_FIXSTAR_SIGN_KEYS = (
    'Ari', 'Tau', 'Gem', 'Can', 'Leo2', 'Vir',
    'Lib', 'Sco', 'Sag', 'Cap', 'Aqu', 'Pis',
)
_fixstar_catalog_cache: Optional[list] = None


def _fixstar_catalog_path() -> Optional[Path]:
    for cand in _FIXSTAR_CATALOG_CANDIDATES:
        if cand.is_file():
            return cand
    return None


def _fixstar_count_rows(path: Path) -> int:
    # fixstarsdlg.FixStarCatalog._count_catalog_rows (fixstarsdlg.py:55-65).
    with open(path, 'r', encoding='utf-8', errors='ignore') as handle:
        count = 0
        for line in handle:
            if not line:
                continue
            if line[0] == '#' and line.find('example') != -1:
                break
            if line[0] != '#':
                count += 1
    return count


def _fixstar_format_longitude(value: float) -> str:
    # fixstarsdlg.FixStarCatalog._format_longitude (fixstarsdlg.py:67-74).
    import chart as _chart
    import mtexts as _mtexts
    import util as _util
    deg, minute, second = _util.decToDeg(value)
    sign = int(deg / _chart.Chart.SIGN_DEG)
    lon = deg % _chart.Chart.SIGN_DEG
    sign_txt = str(_mtexts.txts[_FIXSTAR_SIGN_KEYS[sign]])
    return f"{lon}{sign_txt} {str(minute).zfill(2)}' {str(second).zfill(2)}\""


def _fixstar_format_latitude(value: float) -> str:
    # fixstarsdlg.FixStarCatalog._format_latitude (fixstarsdlg.py:76-79).
    import util as _util
    deg, minute, second = _util.decToDeg(value)
    sign = '-' if value < 0.0 else ''
    return f"{sign}{deg} {str(minute).zfill(2)}' {str(second).zfill(2)}\""


def _fixstar_split_name(raw_name) -> tuple:
    # fixstarsdlg.FixStarCatalog._split_star_name (fixstarsdlg.py:81-92).
    name = raw_name[0].strip()
    code = ''
    if ',' in name:
        parts = name.split(',', 1)
        name = parts[0].strip()
        code = parts[1].strip()
    if code == 'laSco' or name == 'Mula':
        name = 'Shaula'
    return name, code


def _read_fixstar_catalog() -> list:
    """Enumerate the full SE fixed-star catalog (cached).

    Verbatim port of fixstarsdlg.FixStarCatalog.read (fixstarsdlg.py:94-114):
    the row count comes from sefstars.txt, then swe_fixstar_ut(str(index), ...)
    resolves each star. swisseph only finds the catalog after swe_set_ephe_path
    (morin.py:14753 sets it in wx; the daemon never does, so set it here)."""
    global _fixstar_catalog_cache
    if _fixstar_catalog_cache is not None:
        return _fixstar_catalog_cache

    import astrology as _astrology
    path = _fixstar_catalog_path()
    if path is None:
        _fixstar_catalog_cache = []
        return _fixstar_catalog_cache

    try:
        _astrology.swe_set_ephe_path(_FIXSTAR_EPHE_PATH)
    except Exception:
        pass

    jd = _astrology.swe_julday(1950, 1, 1, 0.0, _astrology.SE_GREG_CAL)
    try:
        count = _fixstar_count_rows(path)
    except OSError:
        _fixstar_catalog_cache = []
        return _fixstar_catalog_cache

    rows = []
    for index in range(1, count + 1):
        try:
            ret, raw_name, dat, _serr = _astrology.swe_fixstar_ut(str(index), jd, 0)
        except Exception:
            continue
        name, code = _fixstar_split_name(raw_name)
        rows.append({
            'index': index - 1,
            'name': name,
            'code': code,
            'lon': _fixstar_format_longitude(dat[0]),
            'lat': _fixstar_format_latitude(dat[1]),
            'lonValue': float(dat[0]),
            'latValue': float(dat[1]),
        })
    _fixstar_catalog_cache = rows
    return _fixstar_catalog_cache


def _read_fixstar_alias_map(opts) -> dict:
    """Alias map (code -> display name), seeded from disk like the wx dialog
    (fixstarsdlg._ensure_alias_map_loaded, fixstarsdlg.py:340-354)."""
    alias = getattr(opts, 'fixstarAliasMap', None)
    if not isinstance(alias, dict):
        alias = {}
        try:
            opts.fixstarAliasMap = alias
        except Exception:
            pass
    if _FIXSTAR_ALIAS_JSON.is_file():
        try:
            with open(_FIXSTAR_ALIAS_JSON, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                alias.update({k: v for k, v in data.items() if isinstance(k, str)})
        except Exception:
            pass
    return alias


def _write_fixstar_alias_map(alias: dict) -> None:
    # fixstarsdlg.FixStarsDlg.check alias persistence (fixstarsdlg.py:529-534).
    try:
        with open(_FIXSTAR_ALIAS_JSON, 'w', encoding='utf-8') as handle:
            json.dump(alias, handle, ensure_ascii=False, indent=2, sort_keys=True)
    except Exception:
        pass


class OptionsService:
    """Read/patch the live canonical options object and drive a re-render."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        # The controller is bound by the workspace service after both modules
        # import (avoids an import cycle: workspace_service imports chart_service
        # + supplementary_service; this service only needs the controller for
        # the refresh fan-out). Set via set_controller().
        self._controller = None
        self._theme_hash: Optional[str] = None
        self._theme_version = 0
        self._style_profile_store: Optional[StyleProfileStore] = None
        self._retained_list_data_key: Optional[str] = None

    def set_controller(self, controller) -> None:
        self._controller = controller

    @property
    def options(self):
        return chart_snapshot_service.options

    # -- READ --------------------------------------------------------------

    def get_options(self) -> dict:
        with self._lock:
            opts = self.options
            active_style_profile = self._style_profiles().active_profile()
            # Heal historical Auto-TZ records whose name/coordinates were
            # changed while an older city's tzid remained saved.  Frontend
            # boot always reads this payload, so canonical in-memory state and
            # deflocation.opt are repaired once instead of only masking the
            # stale value in list presentation.
            if self._apply_defloc_auto_timezone(opts):
                try:
                    opts.saveDefLocation()
                except Exception:
                    pass
            payload = {
                'colors': self._read_colors(opts),
                'display': self._read_display(opts),
                'aspectList': self._read_aspect_list(opts),
                'houseSystem': self._read_house_system(opts),
                'ayanamsha': self._read_ayanamsha(opts),
                'orbs': self._read_orbs(opts),
                'dignities': self._read_dignities(opts),
                'symbols': self._read_symbols(opts),
                'lunarMansions': self._read_lunar_mansions(opts),
                'speculum': self._read_speculum(opts),
                'defaultLocation': self._read_defloc(opts),
                'export': self._read_export(opts),
                'primaryDirections': self._read_primary_directions(opts),
                'profections': self._read_profections(opts),
                'revolutions': self._read_revolutions(opts),
                'quickCharts': self._read_quick_charts(opts),
                'stepAlerts': self._read_step_alerts(opts),
                'almutens': self._read_almutens(opts),
                'firdaria': self._read_firdaria(opts),
                'eclipses': self._read_eclipses(opts),
                'fixedStars': self._read_fixed_stars(opts),
                'relationshipCharts': self._read_relationship_charts(opts),
                'languages': self._read_languages(opts),
                'planetsPoints': self._read_planets_points(opts),
                'retainedListDisplay': self._read_retained_list_display(opts),
                'themePresets': self._read_theme_presets(opts, active_style_profile),
                'themeState': self._read_theme_state(opts, active_style_profile),
                'catalog': self._read_catalog(opts),
                'settingsRegistry': settings_registry.registry_payload(),
            }
            retained_list_data_key = self._retained_list_data_key_from_payload(payload)
            self._retained_list_data_key = retained_list_data_key
            payload['retainedListDataKey'] = retained_list_data_key
            return payload

    @staticmethod
    def _retained_list_data_key_from_payload(payload: Mapping[str, Any]) -> str:
        """Content identity for option state that can alter retained data.

        Event sequence numbers authorize request ordering but cannot identify a
        reusable data world. Keep this key content-derived and omit projection,
        style, export and catalog data that retained lists never query.
        """
        semantic: dict[str, Any] = {}
        for group, value in payload.items():
            if group in _RETAINED_LIST_DATA_IGNORED_PAYLOAD_GROUPS:
                continue
            if group == 'display' and isinstance(value, Mapping):
                semantic[group] = {
                    key: item
                    for key, item in value.items()
                    if key not in _LIST_NEUTRAL_DISPLAY_FIELDS
                }
                continue
            if group == 'dignities' and isinstance(value, Mapping):
                semantic[group] = {
                    key: item
                    for key, item in value.items()
                    if key != 'showterms'
                }
                continue
            semantic[group] = value
        encoded = json.dumps(
            semantic,
            sort_keys=True,
            separators=(',', ':'),
            ensure_ascii=True,
        ).encode('utf-8')
        return f"retained-v1:{hashlib.sha256(encoded).hexdigest()}"

    def get_retained_list_data_key(self) -> str:
        with self._lock:
            if self._retained_list_data_key is None:
                self.get_options()
            return str(self._retained_list_data_key)

    @staticmethod
    def _read_retained_list_display(opts) -> dict:
        """Projection-only body visibility shared by resident list renderers.

        These ids address rows already present in each list's canonical source
        universe. They must never participate in calculation/cache identity.
        """
        hidden: list[str] = []
        transcendental = list(getattr(opts, 'transcendental', ()) or ())
        for index, key in enumerate(('uranus', 'neptune', 'pluto')):
            if index >= len(transcendental) or not bool(transcendental[index]):
                hidden.append(f'planet:{key}')
        if not bool(getattr(opts, 'showchiron', True)):
            hidden.append('planet:chiron')
        if not bool(getattr(opts, 'shownodes', True)):
            hidden.extend(('planet:nnode', 'planet:snode'))
        if not bool(getattr(opts, 'showlof', True)):
            hidden.append('point:fortune')
        if not bool(getattr(opts, 'showvertex', True)):
            hidden.append('point:vertex')
        if not bool(getattr(opts, 'showprenatalsyzygy', False)):
            hidden.append('point:syzygy')
        return {'hiddenObjectIds': hidden}

    def get_retained_list_display(self) -> dict:
        with self._lock:
            return self._read_retained_list_display(self.options)

    def get_sidebar_list_preferences(self) -> dict:
        """Small durable preference payload for retained sidebar lists.

        This deliberately bypasses the chart-options refresh fan-out: chooser,
        sorting, and drawer controls are presentation state and must not
        recalculate charts or invalidate retained list data.
        """
        with self._lock:
            opts = self.options
            normalized = opts._normalize_sidebar_list_preferences(
                getattr(opts, 'sidebar_list_preferences', None)
            )
            opts.sidebar_list_preferences = copy.deepcopy(normalized)
            return copy.deepcopy(normalized)

    def set_sidebar_list_preferences(self, patch: dict) -> dict:
        if not isinstance(patch, dict):
            raise ValueError('patch must be an object')
        with self._lock:
            opts = self.options
            current = opts._normalize_sidebar_list_preferences(
                getattr(opts, 'sidebar_list_preferences', None)
            )
            candidate = copy.deepcopy(current)
            for group in ('aspectList', 'transitList'):
                fields = patch.get(group)
                if not isinstance(fields, dict):
                    continue
                candidate[group] = {
                    **candidate.get(group, {}),
                    **fields,
                }
            normalized = opts._normalize_sidebar_list_preferences(candidate)
            if normalized != current:
                opts.sidebar_list_preferences = copy.deepcopy(normalized)
                if not opts.saveSidebarListPreferences():
                    raise RuntimeError('could not persist sidebar list preferences')
            return copy.deepcopy(normalized)

    def preview_options(self, patch: dict):
        """Return an in-memory options clone with a live-preview patch applied.

        This mirrors the wx PrimDirsLiveFrame path: settings controls mutate a
        preview copy for the visible list calculation, while persistence and
        global workspace refresh happen later through set_options().
        """
        if not isinstance(patch, dict) or not patch:
            return self.options
        with self._lock:
            opts = copy.deepcopy(self.options)
            for group, fields in patch.items():
                if not isinstance(fields, dict):
                    continue
                if group == 'primaryDirections':
                    self._apply_primary_directions(opts, fields)
                elif group == 'planetsPoints':
                    self._apply_planets_points(opts, fields)
                elif group == 'houseSystem':
                    self._apply_house_system(opts, fields)
                elif group == 'ayanamsha':
                    self._apply_ayanamsha(opts, fields)
            return opts

    def get_theme_state(self) -> dict:
        with self._lock:
            return self._read_theme_state(self.options)

    def get_style_profiles(self) -> dict:
        with self._lock:
            return self._style_profiles().payload()

    def get_style_profile_export(self, profile_id: str) -> dict:
        with self._lock:
            return self._style_profiles().profile(profile_id)

    def build_portable_style_profile_export(self, profile: dict) -> dict:
        """Freeze a draft's local palette base into portable semantic values."""
        with self._lock:
            source = validate_style_profile(profile)
            if source.get('basePresetId') is None:
                return source
            overrides = _profile_base_app_semantic_overrides(self.options, source)
            overrides.update(_profile_base_chart_semantic_overrides(self.options, source))
            overrides.update(source.get('overrides') or {})
            return validate_style_profile({
                **source,
                'basePresetId': None,
                'overrides': overrides,
            })

    def get_active_style_profile(self) -> Optional[dict]:
        with self._lock:
            return self._style_profiles().active_profile()

    @staticmethod
    def _style_lab_factory_theme_profile(name: str) -> dict:
        """Portable factory profile for one real Aries theme preset."""
        profile_id = _style_profile_id_from_theme_name(name)
        if profile_id is not None:
            raise StyleProfileError("saved user themes do not have factory profiles")
        if name not in PALETTE_PRESET_NAMES:
            raise StyleProfileError(f"unknown palette preset: {name!r}")
        builtin_profile = builtin_style_profile(name)
        if builtin_profile is not None:
            return builtin_profile
        return validate_style_profile({
            'kind': PROFILE_KIND,
            'profileSchemaVersion': PROFILE_SCHEMA_VERSION,
            'tokenSchemaVersion': TOKEN_SCHEMA_VERSION,
            'id': _style_lab_system_profile_id(name),
            'name': name,
            'scope': 'combined',
            'basePresetId': name,
            'overrides': {},
            'authoringOverrides': {},
            'appAuthoringOverrides': {},
            'chartStyleProfileV2': build_chart_style_profile_v2({}),
        })

    def _style_lab_theme_profile(self, name: str) -> dict:
        """Editable source profile for one real Aries theme preset.

        User themes and saved system-theme overrides retain their persistence
        identity. A system theme without a saved override resolves to its
        factory profile.
        """
        profile_id = _style_profile_id_from_theme_name(name)
        if profile_id is not None:
            return self._style_profiles().profile(profile_id)
        factory = self._style_lab_factory_theme_profile(name)
        try:
            return self._style_profiles().profile(str(factory['id']))
        except StyleProfileError:
            return factory

    def get_style_lab_theme_profile(self, name: str) -> dict:
        """Return an editable source without changing active app options."""
        with self._lock:
            return self._style_lab_theme_profile(name)

    def get_style_lab_factory_theme_profile(self, name: str) -> dict:
        """Return the immutable shipped definition for a system theme."""
        with self._lock:
            return self._style_lab_factory_theme_profile(name)

    def get_style_lab_theme_sources(self) -> dict:
        """Actual Theme presets plus their fully resolved preview tokens."""
        with self._lock:
            opts = self.options
            presets = self._read_theme_presets(opts, self._style_profiles().active_profile())
            sources = []
            for preset in presets:
                name = str(preset['name'])
                profile_id = _style_profile_id_from_theme_name(name)
                profile = self._style_lab_theme_profile(name)
                system = profile_id is None
                factory = (
                    self._style_lab_factory_theme_profile(name)
                    if system
                    else None
                )
                theme = _theme_state_payload(opts, profile)
                sources.append({
                    'name': name,
                    'label': str(preset.get('label') or name),
                    'profileId': profile_id,
                    'deletable': profile_id is not None,
                    'system': system,
                    'factoryModified': bool(
                        factory
                        and profile.get('contentHash') != factory.get('contentHash')
                    ),
                    'mode': theme['mode'],
                    'selected': bool(preset.get('selected')),
                    'basePresetId': profile.get('basePresetId'),
                    'appTokens': copy.deepcopy(theme['appTokens']),
                    'chartPalette': copy.deepcopy(theme['chartPalette']),
                    'appAuthoring': copy.deepcopy(
                        theme['profileOverrides']['appAuthoring']
                    ),
                })
            return {'sources': sources}

    def get_theme_presets(self) -> list:
        """Return the current built-in and user-authored app theme selectors."""
        with self._lock:
            return copy.deepcopy(
                self._read_theme_presets(
                    self.options,
                    self._style_profiles().active_profile(),
                )
            )

    def validate_style_profile_base(self, profile: Optional[dict]) -> dict:
        """Validate daemon-owned preset references without persisting a profile."""
        self._validate_style_profile_base(profile)
        return {'valid': True}

    def get_effective_style_chart_options(self, source_options=None):
        """Chart-color adapter for retained non-CSS renderer processes."""
        _, effective = self.get_style_chart_render_context(source_options)
        return effective

    def get_style_chart_render_context(self, source_options=None) -> tuple[Optional[dict], Any]:
        """Atomically pair the active profile with effective chart options."""
        with self._lock:
            profile = self._style_profiles().active_profile()
            effective = _effective_style_chart_options(source_options or self.options, profile)
            return profile, effective

    def get_active_style_profile_for_chart_render(self) -> Optional[dict]:
        """Return an isolated profile with its chart base resolved for export.

        The portable stored profile remains unchanged. The retained wx export
        renderer receives a semantic override map because it cannot consume
        ThemeState/CSS, and must match the effective on-screen chart palette.
        """
        with self._lock:
            profile = self._style_profiles().active_profile()
            if not profile:
                return None
            resolved = copy.deepcopy(profile)
            overrides = _profile_base_chart_semantic_overrides(self.options, profile)
            overrides.update(resolved.get('overrides') or {})
            resolved['overrides'] = overrides
            # This is an internal resolved render payload, not the portable
            # stored profile. Its stored content hash must not describe a body
            # after effective base values have been injected.
            resolved.pop('contentHash', None)
            return resolved

    def save_style_profile(self, profile: dict, *, activate: bool = False) -> dict:
        with self._lock:
            store = self._style_profiles()
            self._validate_style_profile_base(profile)
            before = store.active_profile()
            saved = store.upsert(profile, activate=activate)
            after = store.active_profile()
            result = self._style_profile_mutation_result(
                changed=self._active_style_profile_changed(before, after),
                profile=after,
            )
            result['profile'] = saved
            return result

    def activate_style_profile(self, profile_id: Optional[str]) -> dict:
        with self._lock:
            store = self._style_profiles()
            before = store.active_profile()
            candidate = store.profile(profile_id) if profile_id is not None else None
            self._validate_style_profile_base(candidate)
            active = store.activate(profile_id)
            return self._style_profile_mutation_result(
                changed=self._active_style_profile_changed(before, active),
                profile=active,
            )

    def delete_style_profile(self, profile_id: str) -> dict:
        with self._lock:
            store = self._style_profiles()
            before = store.active_profile()
            store.delete(profile_id)
            after = store.active_profile()
            return self._style_profile_mutation_result(
                changed=self._active_style_profile_changed(before, after),
                profile=after,
            )

    def migrate_legacy_style_tokens(self, values: dict, *, activate: bool = True) -> dict:
        with self._lock:
            store = self._style_profiles()
            before = store.active_profile()
            migration = store.migrate_legacy(values, activate=activate)
            after = store.active_profile()
            result = self._style_profile_mutation_result(
                changed=self._active_style_profile_changed(before, after),
                profile=after,
            )
            result['migration'] = migration
            return result

    def _style_profiles(self) -> StyleProfileStore:
        opts_dir = str(getattr(self.options, 'optsdirtxt', '') or '')
        if not opts_dir:
            raise StyleProfileError('options directory is unavailable')
        if self._style_profile_store is None or str(self._style_profile_store.path.parent) != opts_dir:
            self._style_profile_store = StyleProfileStore(opts_dir)
            self._style_profile_store.discard_profiles(
                _RETIRED_BUILTIN_STYLE_PROFILE_IDS
            )
            replacement = nasa_atlas_upgrade_for(
                self._style_profile_store.active_profile()
            )
            if replacement is not None:
                self._validate_style_profile_base(replacement)
                self._style_profile_store.upsert(replacement, activate=True)
        return self._style_profile_store

    @staticmethod
    def _active_style_profile_changed(before: Optional[dict], after: Optional[dict]) -> bool:
        before_identity = None if not before else (before.get('id'), before.get('contentHash'))
        after_identity = None if not after else (after.get('id'), after.get('contentHash'))
        return before_identity != after_identity

    @staticmethod
    def _validate_style_profile_base(profile: Optional[dict]) -> None:
        base_preset_id = (profile or {}).get('basePresetId')
        if (
            base_preset_id is not None
            and base_preset_id not in PALETTE_PRESET_NAMES
            and base_preset_id not in _LEGACY_STYLE_PROFILE_BASE_PRESETS
        ):
            raise StyleProfileError(f'unknown style profile base preset: {base_preset_id}')

    def _style_profile_mutation_result(self, *, changed: bool, profile: Optional[dict]) -> dict:
        refresh_mode = 'display-overlay'
        refreshed = self._refresh_all(refresh_mode) if changed else []
        return {
            'styleProfiles': self._style_profiles().payload(),
            'activeProfile': profile,
            'themeState': self._read_theme_state(self.options),
            'refreshedDocumentIds': refreshed,
            'refreshMode': refresh_mode if changed else None,
        }

    def get_quickcharts_prompt_predicate(self) -> dict:
        """Saved quick-chart prompt predicate.

        Source twin: morin._should_prompt_quickcharts (morin.py:11607-11608)
        reads ``options.quickcharts_prompt`` (default True, options.py:576).
        wx quick-chart launchers (profections 'P', morin.py:19172-19178) prompt
        for the source datetime — defaulting to now — only when this is True;
        otherwise they open against the current launch context directly.
        """
        with self._lock:
            should = bool(getattr(self.options, 'quickcharts_prompt', True))
        return {'shouldPrompt': should}

    def get_timed_chart_show_radix_default(self) -> dict:
        """Default state for the timed-list ``Show Radix`` context-menu lens."""
        with self._lock:
            value = bool(getattr(self.options, 'timed_chart_show_radix_default', False))
        return {'showRadix': value}

    def get_progression_launch_predicate(self) -> dict:
        """Saved progression chart/list launcher mode.

        Source twin: morin._secondary_progression_launch_mode
        (morin.py:11620-11635) normalizes ``options.secondary_progression_launch_mode``
        to the QuickChartsOptDlg Chart/Table/Both enum. The wx launcher applies
        this mode to secondary, minor, and tertiary progression launches; solar
        arc remains chart-only because the source list builder returns no table.
        """
        with self._lock:
            try:
                mode = int(getattr(self.options, 'secondary_progression_launch_mode', 0))
            except Exception:
                mode = 0
        if mode not in (0, 1, 2):
            mode = 0
        return {'mode': mode}

    def get_revolution_location_predicate(self, kind: str, planet_type: Optional[int] = None) -> dict:
        """Return the saved wx Revolution location-mode predicate.

        Source twin: revolutionsoptdlg.RevolutionsOptDlg.check writes the three
        ``revolutions_*locationmode`` fields, and morin.py only prompts when the
        selected field is ``1`` (Ask).
        """
        normalized = str(kind or '').strip().lower().replace('_', '-')
        if normalized in ('solar', 'solar-return', 'solar-revolution'):
            attr = 'revolutions_solarlocationmode'
            public_kind = 'solar-revolution'
        elif normalized in ('lunar', 'lunar-return', 'lunar-revolution'):
            attr = 'revolutions_lunarlocationmode'
            public_kind = 'lunar-revolution'
        elif normalized in ('planetary', 'planetary-return', 'planetary-revolution'):
            attr = 'revolutions_planetslocationmode'
            public_kind = 'planetary-return'
        else:
            raise ValueError('unknown revolution kind')

        with self._lock:
            mode_value = int(getattr(self.options, attr, 0) or 0)
        mode = 'ask' if mode_value == 1 else 'natal'
        return {
            'kind': public_kind,
            'planetType': planet_type,
            'optionAttr': attr,
            'locationMode': mode,
            'locationModeValue': mode_value,
            'shouldPrompt': mode == 'ask',
        }

    def _read_theme_state(self, opts, active_profile: Any = _ACTIVE_PROFILE_UNSET) -> dict:
        if active_profile is _ACTIVE_PROFILE_UNSET:
            active_profile = self._style_profiles().active_profile()
        payload = _theme_state_payload(opts, active_profile)
        palette_hash = _theme_payload_hash(payload)
        if palette_hash != self._theme_hash:
            self._theme_hash = palette_hash
            self._theme_version += 1
        return {
            **payload,
            'schemaVersion': THEME_STATE_SCHEMA_VERSION,
            'version': self._theme_version,
            'styleRevision': self._theme_version,
            'paletteHash': palette_hash,
            'styleHash': palette_hash,
        }

    @staticmethod
    def _normalized_pd_fixstars_sel(opts) -> list:
        """pdfixstarssel as a parallel-bool list the length of options.fixstars.

        Mirrors options._normalized_pdfixstarssel (options.py) so the React
        picker always sees one checkbox per catalog star, even if a stale pickle
        had a shorter/longer list."""
        fixstars_map = getattr(opts, 'fixstars', None) or {}
        length = len(fixstars_map)
        values = list(getattr(opts, 'pdfixstarssel', None) or [])
        out = [bool(v) for v in values[:length]]
        if len(out) < length:
            out.extend([False] * (length - len(out)))
        return out

    @staticmethod
    def _pd_fixstar_catalog(opts) -> list:
        """The candidate fixed stars for the PD selection picker.

        Transcribes fixstarspddlg.FixStarPDCatalog.read (fixstarspddlg.py:42-60):
        for each star code in options.fixstars, read the Swiss-Ephemeris display
        name (swe_fixstar_ut at JD 1950-01-01), apply the Shaula/Mula special
        case and the user alias map. Each entry's ``ordinal`` is its index in
        options.fixstars, matching the pdfixstarssel index contract."""
        fixstars_map = getattr(opts, 'fixstars', None) or {}
        alias_map = getattr(opts, 'fixstarAliasMap', None) or {}
        jd = astrology.swe_julday(1950, 1, 1, 0.0, astrology.SE_GREG_CAL)
        catalog = []
        for ordinal, code in enumerate(fixstars_map.keys()):
            display = code
            try:
                ret, raw_name, dat, serr = astrology.swe_fixstar_ut(',' + code, jd, 0)
                star_name = raw_name[0].strip()
                parsed_code = ''
                if ',' in star_name:
                    parts = star_name.split(',', 1)
                    star_name = parts[0].strip()
                    parsed_code = parts[1].strip()
                if parsed_code == 'laSco' or star_name == 'Mula':
                    star_name = 'Shaula'
                display = star_name or code
            except Exception:
                display = code
            if alias_map.get(code):
                display = alias_map[code]
            catalog.append({'ordinal': ordinal, 'code': code, 'name': display})
        return catalog

    def _read_primary_directions(self, opts) -> dict:
        """Live PrimDirs settings the desktop PrimDirsLiveFrame commits
        (primarydirsdlg.py fill()/check(), :1312-1761). EVERY control the wx
        PrimDirsPanel reads/writes is round-tripped here so the React settings
        panel renders the full surface. No OK/Cancel: set_options commits live
        exactly like the desktop's onLivePreviewControl path.

        The desktop key-block also derives a read-only coefficient
        (primarydirsdlg.py:907-917): for a Customer key it is 1/(deg+min/60+
        sec/3600); for a preset it is PrimDirs.staticData[sel][COEFF]. We expose
        it as a display-only field so the React Keys block can show it without
        recomputing anything in TS."""
        import primdirs as _primdirs
        pdkeys = int(getattr(opts, 'pdkeys', 0))
        pdkeydeg = int(getattr(opts, 'pdkeydeg', 0))
        pdkeymin = int(getattr(opts, 'pdkeymin', 0))
        pdkeysec = int(getattr(opts, 'pdkeysec', 0))
        if pdkeys == _primdirs.PrimDirs.CUSTOMER:
            val = pdkeydeg + pdkeymin / 60.0 + pdkeysec / 3600.0
            pdkeycoeff = 1.0 / val if val != 0.0 else 0.0
        else:
            try:
                pdkeycoeff = _primdirs.PrimDirs.staticData[pdkeys][_primdirs.PrimDirs.COEFF]
            except (IndexError, TypeError):
                pdkeycoeff = 0.0
        return {
            # House system + sub-mode
            'primarydir': int(getattr(opts, 'primarydir', 0)),
            'pddefaultdirection': _primary_directions_default_direction(opts),
            'subprimarydir': int(getattr(opts, 'subprimarydir', 0)),
            # Latitude (Use SZ) + Bianchini / Morin excentric / Morin antiscia
            'subzodiacal': int(getattr(opts, 'subzodiacal', 0)),
            'bianchini': bool(getattr(opts, 'bianchini', False)),
            'morin_excentric': bool(getattr(opts, 'morin_excentric', False)),
            'morin_antiscia': bool(getattr(opts, 'morin_antiscia', False)),
            # Zodiacal options (2 bools + asc/mc as proms)
            'zodpromsigasps': [bool(v) for v in getattr(opts, 'zodpromsigasps', [])],
            'ascmchcsasproms': bool(getattr(opts, 'ascmchcsasproms', False)),
            'pdcusppromissors': bool(getattr(opts, 'pdcusppromissors', False)),
            # Promissor grid
            'promplanets': [bool(v) for v in getattr(opts, 'promplanets', [])],
            'pdantiscia': bool(getattr(opts, 'pdantiscia', False)),
            'pdmorinpromittorset': bool(getattr(opts, 'pdmorinpromittorset', False)),
            'pdmidpoints': bool(getattr(opts, 'pdmidpoints', False)),
            'pdterms': bool(getattr(opts, 'pdterms', False)),
            'pdfixstars': bool(getattr(opts, 'pdfixstars', False)),
            # Per-star PD selection list (the fixstarspddlg sub-dialog,
            # fixstarspddlg.py; option pdfixstarssel). Parallel-bool list indexed
            # by the star order in options.fixstars; consumed by
            # primdirs._pd_fixstar_selected (primdirs.py:497-511).
            'pdfixstarssel': self._normalized_pd_fixstars_sel(opts),
            'pdFixStarCatalog': self._pd_fixstar_catalog(opts),
            'pdFixStarMaxSelected': 200,  # FixStarPDSelectionModel.MAX_SELECTED
            'pdsecmotion': bool(getattr(opts, 'pdsecmotion', False)),
            'pdsecmotioniter': int(getattr(opts, 'pdsecmotioniter', 0)),
            'pdpromchiron': bool(getattr(opts, 'pdpromchiron', True)),
            'pdpromarabicparts': bool(getattr(opts, 'pdpromarabicparts', False)),
            'pdpromarabicpartname': str(getattr(opts, 'pdpromarabicpartname', '')),
            'pdcustomer': bool(getattr(opts, 'pdcustomer', False)),
            'pdcustomerlon': [int(v) for v in getattr(opts, 'pdcustomerlon', [0, 0, 0])[:3]],
            'pdcustomerlat': [int(v) for v in getattr(opts, 'pdcustomerlat', [0, 0, 0])[:3]],
            'pdcustomersouthern': bool(getattr(opts, 'pdcustomersouthern', False)),
            # pdlof[0] = promissor LoF, pdlof[1] = significator LoF
            'promlof': bool(getattr(opts, 'pdlof', [False, False])[0]),
            # Aspect grid (12 aspects + 2 parallels)
            'pdaspects': [bool(v) for v in getattr(opts, 'pdaspects', [])],
            'pdparallels': [bool(v) for v in getattr(opts, 'pdparallels', [])],
            # Significator grid
            'sigangles': [bool(v) for v in getattr(opts, 'sigangles', [])],
            'sighouses': bool(getattr(opts, 'sighouses', False)),
            'sigplanets': [bool(v) for v in getattr(opts, 'sigplanets', [])],
            'siglof': bool(getattr(opts, 'pdlof', [False, False])[1]),
            'pdsyzygy': bool(getattr(opts, 'pdsyzygy', False)),
            'pdsigchiron': bool(getattr(opts, 'pdsigchiron', True)),
            'pdsigvertex': bool(getattr(opts, 'pdsigvertex', False)),
            'pdcustomer2': bool(getattr(opts, 'pdcustomer2', False)),
            'pdcustomer2lon': [int(v) for v in getattr(opts, 'pdcustomer2lon', [0, 0, 0])[:3]],
            'pdcustomer2lat': [int(v) for v in getattr(opts, 'pdcustomer2lat', [0, 0, 0])[:3]],
            'pdcustomer2southern': bool(getattr(opts, 'pdcustomer2southern', False)),
            'pdsigarabicparts': bool(getattr(opts, 'pdsigarabicparts', False)),
            'pdsigarabicpartname': str(getattr(opts, 'pdsigarabicpartname', '')),
            # Circumambulation method
            'pdcircumoa': int(getattr(opts, 'pdcircumoa', 0)),
            # Revolutions / annual / list view
            'pdrevsunyearmode': int(getattr(opts, 'pdrevsunyearmode', 0)),
            'pdrevannualmode': int(getattr(opts, 'pdrevannualmode', 0)),
            'pdrevshownatalpromissors': bool(getattr(opts, 'pdrevshownatalpromissors', False)),
            'pdlistmode': int(getattr(opts, 'pdlistmode', 1)),
            'pdlistglyphcolors': bool(getattr(opts, 'pdlistglyphcolors', False)),
            # PDs-in-Chart options (pdsinchartdlgopts.py and
            # pdsinchartterrdlgopts.py). These live beside the main PD settings
            # in React but retain their separate legacy persistence file.
            'pdincharttyp': int(getattr(opts, 'pdincharttyp', 0)),
            'pdinchartsecmotion': bool(getattr(opts, 'pdinchartsecmotion', False)),
            'pdinchartterrsecmotion': bool(getattr(opts, 'pdinchartterrsecmotion', False)),
            'pdinchartreverse': bool(getattr(opts, 'pdinchartreverse', True)),
            # Keys block
            'pdkeydyn': bool(getattr(opts, 'pdkeydyn', False)),
            'pdkeyd': int(getattr(opts, 'pdkeyd', 0)),
            'pdkeys': pdkeys,
            'pdkeydeg': pdkeydeg,
            'pdkeymin': pdkeymin,
            'pdkeysec': pdkeysec,
            'pdkeycoeff': float(pdkeycoeff),
            'useregressive': bool(getattr(opts, 'useregressive', False)),
            # Active Arabic-part names so the significator picker can list them.
            'arabicPartNames': self._active_arabic_part_names(opts),
        }

    def _active_arabic_part_names(self, opts) -> list:
        """Mirror primarydirsdlg._get_active_arabic_part_names (:804-813):
        every Arabic part flagged active (item[4] truthy)."""
        names = []
        for item in getattr(opts, 'arabicparts', []) or []:
            try:
                if len(item) > 4 and not bool(item[4]):
                    continue
                names.append(item[0])
            except Exception:
                continue
        return names

    def _sync_pd_arabic_part_selection(self, opts, enabled_attr: str, name_attr: str) -> None:
        choices = self._active_arabic_part_names(opts)
        current = str(getattr(opts, name_attr, '') or '')
        if not bool(getattr(opts, enabled_attr, False)):
            return
        if current not in choices:
            setattr(opts, name_attr, choices[0] if choices else '')

    def _read_profections(self, opts) -> dict:
        """Annual-profection mode flags (the wx ProfectionsWnd radio submenu,
        profectionswnd.py:48-60). ``wholeSign`` is the Aries-added Hellenistic
        whole-sign ("by sign") vs continuous toggle; ``zodiacal``/``mundane``
        mirror the wx Zodiacal/Placidian radio."""
        return {
            'wholeSign': bool(getattr(opts, 'profwholesign', True)),
            'zodiacal': bool(getattr(opts, 'zodprof', True)),
            'useZodProjs': bool(getattr(opts, 'usezodprojsprof', False)),
            'solarReturnSnap': bool(getattr(opts, 'profections_solar_return_snap', False)),
        }

    def _apply_profections(self, opts, fields: dict) -> bool:
        changed = False
        if 'wholeSign' in fields:
            value = bool(fields['wholeSign'])
            if bool(getattr(opts, 'profwholesign', True)) != value:
                opts.profwholesign = value
                changed = True
        if 'zodiacal' in fields:
            value = bool(fields['zodiacal'])
            if bool(getattr(opts, 'zodprof', True)) != value:
                opts.zodprof = value
                changed = True
        if 'useZodProjs' in fields:
            value = bool(fields['useZodProjs'])
            if bool(getattr(opts, 'usezodprojsprof', False)) != value:
                opts.usezodprojsprof = value
                changed = True
        if 'solarReturnSnap' in fields:
            value = bool(fields['solarReturnSnap'])
            if bool(getattr(opts, 'profections_solar_return_snap', False)) != value:
                opts.profections_solar_return_snap = value
                changed = True
        return changed

    def _read_revolutions(self, opts) -> dict:
        """RevolutionsOptDlg fields (revolutionsoptdlg.py:7-168).

        The three location-mode values are consumed by
        ``get_revolution_location_predicate`` and the return launchers; lunar
        parent and Marr flags are consumed by the supplementary return builders
        and return-session rebuild paths.
        """
        solar_return_mode = str(getattr(opts, 'revolutions_solarreturnmode', 'standard') or 'standard')
        if solar_return_mode != solilunar.RETURN_MODE_TITHI_PRAVESHA:
            solar_return_mode = 'standard'
        lunar_return_mode = solilunar.normalize_return_mode(
            getattr(opts, 'revolutions_lunarreturnmode', solilunar.RETURN_MODE_LUNAR)
        )
        return {
            'revolutions_solaryearmode': int(getattr(opts, 'revolutions_solaryearmode', 0) or 0),
            'revolutions_solarlocationmode': int(getattr(opts, 'revolutions_solarlocationmode', 0) or 0),
            'revolutions_lunarlocationmode': int(getattr(opts, 'revolutions_lunarlocationmode', 0) or 0),
            'revolutions_planetslocationmode': int(getattr(opts, 'revolutions_planetslocationmode', 0) or 0),
            'revolutions_lunarparentmode': int(getattr(opts, 'revolutions_lunarparentmode', 0) or 0),
            'revolutions_solarreturnmode': solar_return_mode,
            'revolutions_lunarreturnmode': lunar_return_mode,
            'revsidereal_marr_solar': bool(getattr(opts, 'revsidereal_marr_solar', False)),
            'revsidereal_marr_lunar': bool(getattr(opts, 'revsidereal_marr_lunar', False)),
            'revsidereal_marr_planet': bool(getattr(opts, 'revsidereal_marr_planet', False)),
        }

    def _apply_revolutions(self, opts, fields: dict) -> bool:
        changed = False

        for attr in (
            'revolutions_solaryearmode',
            'revolutions_solarlocationmode',
            'revolutions_lunarlocationmode',
            'revolutions_planetslocationmode',
            'revolutions_lunarparentmode',
        ):
            if attr not in fields:
                continue
            try:
                value = 1 if int(fields[attr]) == 1 else 0
            except (TypeError, ValueError):
                continue
            if int(getattr(opts, attr, 0) or 0) != value:
                setattr(opts, attr, value)
                changed = True

        if 'revolutions_solarreturnmode' in fields:
            value = str(fields.get('revolutions_solarreturnmode') or 'standard')
            if value != solilunar.RETURN_MODE_TITHI_PRAVESHA:
                value = 'standard'
            if str(getattr(opts, 'revolutions_solarreturnmode', 'standard') or 'standard') != value:
                opts.revolutions_solarreturnmode = value
                changed = True
            if value == solilunar.RETURN_MODE_TITHI_PRAVESHA and bool(getattr(opts, 'revsidereal_marr_solar', False)):
                opts.revsidereal_marr_solar = False
                changed = True

        if 'revolutions_lunarreturnmode' in fields:
            value = solilunar.normalize_return_mode(fields.get('revolutions_lunarreturnmode'))
            if solilunar.normalize_return_mode(getattr(opts, 'revolutions_lunarreturnmode', None)) != value:
                opts.revolutions_lunarreturnmode = value
                changed = True
            if value != solilunar.RETURN_MODE_LUNAR and bool(getattr(opts, 'revsidereal_marr_lunar', False)):
                opts.revsidereal_marr_lunar = False
                changed = True

        for attr in (
            'revsidereal_marr_solar',
            'revsidereal_marr_lunar',
            'revsidereal_marr_planet',
        ):
            if attr not in fields:
                continue
            value = bool(fields[attr])
            if bool(getattr(opts, attr, False)) != value:
                setattr(opts, attr, value)
                changed = True
            if attr == 'revsidereal_marr_solar' and value:
                if getattr(opts, 'revolutions_solarreturnmode', 'standard') != 'standard':
                    opts.revolutions_solarreturnmode = 'standard'
                    changed = True
            elif attr == 'revsidereal_marr_lunar' and value:
                if solilunar.normalize_return_mode(getattr(opts, 'revolutions_lunarreturnmode', None)) != solilunar.RETURN_MODE_LUNAR:
                    opts.revolutions_lunarreturnmode = solilunar.RETURN_MODE_LUNAR
                    changed = True

        if changed:
            try:
                revolutions._LUNAR_MONTH_HIT_CACHE.clear()
                revolutions._PLANETARY_MONTH_HIT_CACHE.clear()
            except Exception:
                pass
        return changed

    def _read_almutens(self, opts) -> dict:
        """Chart-Almuten scoring weights (almutenchartdlg.AlmutenChartDlg
        fill()/check(), almutenchartdlg.py:331-415). Every control the wx dialog
        edits is round-tripped: the triplicity-ruler radio (oneruler), the
        day/night-orb toggle, the five essential-dignity weights, the accidental
        toggle, the twelve house-place weights, three Sun-phase weights, the
        day/hour-ruler weights, and the Mercury-in-Virgo exaltation toggle. A
        change recalculates every chart's almuten (Chart.recalc fan-out subsumes
        the desktop horoscope.recalcAlmutens, morin.py:20876)."""
        return {
            'oneruler': bool(getattr(opts, 'oneruler', True)),
            'usedaynightorb': bool(getattr(opts, 'usedaynightorb', False)),
            'dignityscores': [int(v) for v in (getattr(opts, 'dignityscores', None) or [])],
            'useaccidental': bool(getattr(opts, 'useaccidental', True)),
            'housescores': [int(v) for v in (getattr(opts, 'housescores', None) or [])],
            'sunphases': [int(v) for v in (getattr(opts, 'sunphases', None) or [])],
            'dayhourscores': [int(v) for v in (getattr(opts, 'dayhourscores', None) or [])],
            'useexaltationmercury': bool(getattr(opts, 'useexaltationmercury', False)),
        }

    def _apply_almutens(self, opts, fields: dict) -> bool:
        """Write AlmutenChartDlg.check() fields (almutenchartdlg.py:369-415).
        Bool scalars set directly; the four int vectors are clamped per the wx
        IntValidator ranges (dignity/sun/dayhour 0..5/0..10, houses 0..12) and
        written IN PLACE to preserve options.py list identity. dignityscores is
        also read-only-exposed in the dignities group; here it is the editable
        owner (the wx AlmutenChartDlg and DignitiesDlg share opts.dignityscores)."""
        changed = False
        for attr in ('oneruler', 'usedaynightorb', 'useaccidental', 'useexaltationmercury'):
            if attr in fields:
                value = bool(fields[attr])
                if bool(getattr(opts, attr, False)) != value:
                    setattr(opts, attr, value)
                    changed = True
        # (attr, length, min, max) — wx IntValidator bounds.
        for attr, length, lo, hi in (
            ('dignityscores', 5, 0, 5),
            ('housescores', 12, 0, 12),
            ('sunphases', 3, 0, 5),
            ('dayhourscores', 2, 0, 10),
        ):
            if attr not in fields or not isinstance(fields[attr], (list, tuple)):
                continue
            current = getattr(opts, attr, None)
            if not isinstance(current, list) or len(current) < length:
                continue
            for i in range(length):
                if i >= len(fields[attr]):
                    continue
                try:
                    value = int(fields[attr][i])
                except (TypeError, ValueError):
                    continue
                value = max(lo, min(hi, value))
                if current[i] != value:
                    current[i] = value
                    changed = True
        return changed

    def _read_firdaria(self, opts) -> dict:
        """Firdaria nocturnal order (firdariadlg.FirdariaDlg, firdariadlg.py:74-85):
        ``isfirbonatti`` True = Bonatus order, False = Al-Biruni."""
        return {'isfirbonatti': bool(getattr(opts, 'isfirbonatti', True))}

    def _apply_firdaria(self, opts, fields: dict) -> bool:
        changed = False
        if 'isfirbonatti' in fields:
            value = bool(fields['isfirbonatti'])
            if bool(getattr(opts, 'isfirbonatti', True)) != value:
                opts.isfirbonatti = value
                changed = True
        return changed

    def _read_eclipses(self, opts) -> dict:
        """Eclipse chart-moment radio (morin._set_eclipse_chart_moment_mode,
        morin.py:958-976). ``eclipse_chart_moment`` is one of the two string
        enums options.Options.ECLIPSE_CHART_MOMENT_* (options.py:57-58) and is
        persisted by saveQuickCharts (options.py:2734)."""
        import options as _options
        mode = str(getattr(opts, 'eclipse_chart_moment',
                           _options.Options.ECLIPSE_CHART_MOMENT_EXACT))
        if mode not in (_options.Options.ECLIPSE_CHART_MOMENT_EXACT,
                        _options.Options.ECLIPSE_CHART_MOMENT_MAXIMUM):
            mode = _options.Options.ECLIPSE_CHART_MOMENT_EXACT
        return {'eclipse_chart_moment': mode}

    def _apply_eclipses(self, opts, fields: dict) -> bool:
        import options as _options
        changed = False
        if 'eclipse_chart_moment' in fields:
            value = str(fields['eclipse_chart_moment'])
            if value not in (_options.Options.ECLIPSE_CHART_MOMENT_EXACT,
                             _options.Options.ECLIPSE_CHART_MOMENT_MAXIMUM):
                value = _options.Options.ECLIPSE_CHART_MOMENT_EXACT
            if getattr(opts, 'eclipse_chart_moment',
                       _options.Options.ECLIPSE_CHART_MOMENT_EXACT) != value:
                opts.eclipse_chart_moment = value
                changed = True
        return changed

    def _read_fixed_stars(self, opts) -> dict:
        """Fixed-stars which-stars picker (fixstarsdlg.FixStarsDlg).

        ``options.fixstars`` is a {code: orb} dict (options.py:525); its KEYS are
        the active stars. The Orbs tab already edits the per-star orbs; this group
        exposes the full SE catalog so the skin can choose the active set. The
        alias map carries the user-facing display name per code
        (fixstarsdlg.py:340-354)."""
        catalog = _read_fixstar_catalog()
        alias_map = _read_fixstar_alias_map(opts)
        selected = list((getattr(opts, 'fixstars', None) or {}).keys())
        defaults = list((getattr(opts, 'def_fixstars', None) or {}).keys())
        return {
            'catalog': [dict(row) for row in catalog],
            'selectedCodes': [str(c) for c in selected],
            'aliasMap': {str(k): str(v) for k, v in alias_map.items()},
            # FixStarSelectionModel.MAX_SELECTED (fixstarsdlg.py:118).
            'maxSelected': 200,
            'defaultCodes': [str(c) for c in defaults],
        }

    def _apply_fixed_stars(self, opts, fields: dict) -> bool:
        """Apply the which-stars selection (fixstarsdlg.FixStarsDlg.check,
        fixstarsdlg.py:501-549).

        ``selectedCodes`` is the new active set. Empty selection falls back to
        ``def_fixstars`` (fixstarsdlg.py:507-508). The resulting ``options.fixstars``
        keeps each retained code's existing orb and assigns ``def_fixstarsorb``
        (chart.py:501 = 1.5) to newly added codes (fixstarsdlg.py:536-544). The
        alias map is pruned to the selection and persisted. Returns True when the
        active key set actually changed."""
        if 'selectedCodes' not in fields:
            return False
        raw = fields.get('selectedCodes')
        if not isinstance(raw, (list, tuple)):
            return False

        import chart as _chart

        current = getattr(opts, 'fixstars', None) or {}
        valid_codes = {str(row['code']) for row in _read_fixstar_catalog() if row['code']}

        # Preserve catalog/selection order, dedupe, honour the 200 cap and the
        # catalog membership (FixStarSelectionModel limits + validity).
        selected: list[str] = []
        seen: set[str] = set()
        for code in raw:
            code = str(code)
            if not code or code in seen:
                continue
            if valid_codes and code not in valid_codes:
                continue
            seen.add(code)
            selected.append(code)
            if len(selected) >= 200:
                break

        if not selected:
            # FixStarsDlg.check: empty selection => default star set.
            selected = list((getattr(opts, 'def_fixstars', None) or {}).keys())

        # Did the active key set change? (order-insensitive, matching check()).
        changed = set(selected) != set(current.keys())
        if not changed:
            return False

        new_fixstars: dict = {}
        for code in selected:
            if code in current:
                new_fixstars[code] = current[code]
            else:
                new_fixstars[code] = _chart.Chart.def_fixstarsorb
        opts.fixstars = new_fixstars

        # Prune + rewrite the alias map to the selection, then persist it
        # (fixstarsdlg.py:518-534). Display names come from the catalog rows.
        alias = _read_fixstar_alias_map(opts)
        name_by_code = {
            str(row['code']): (str(row['name']).strip() or str(row['code']))
            for row in _read_fixstar_catalog() if row['code']
        }
        for code in list(alias.keys()):
            if code not in new_fixstars:
                del alias[code]
        for code in new_fixstars:
            display = name_by_code.get(code)
            if display:
                alias[code] = display
        try:
            opts.fixstarAliasMap = alias
        except Exception:
            pass
        _write_fixstar_alias_map(alias)

        # morin.onFixStarsOpt clears the PD fixed-star selection vector after a
        # key-set change (morin.py:20073; options.clearPDFSSel options.py:2901).
        try:
            opts.clearPDFSSel()
        except Exception:
            pass

        return True

    def _rebuild_fixstars_on_open_charts(self) -> None:
        """Rebuild the in-memory fixstars set on every open chart object.

        ``Chart.recalc`` only re-runs ``calcFixStarAspMatrix`` on an existing
        fixstars object (chart.py:1883) — it does NOT pick up a changed key set.
        The wx handler therefore calls ``self.horoscope.rebuildFixStars()`` after
        mutating ``options.fixstars`` (morin.py:20080; chart.py:616). Mirror that
        here over the same chart-object set the controller refresh walks
        (workspace_session_controller.py:463-472), so live table sessions track
        the new selection. Fresh ``/api/chart`` snapshots reload a new Chart and
        pick up the change regardless."""
        controller = self._controller
        if controller is None:
            return
        seen: set[int] = set()
        try:
            documents = list(controller.documents())
        except Exception:
            return
        for document in documents:
            document_id = getattr(document, 'document_id', None)
            if not document_id:
                continue
            try:
                session = controller.session(document_id)
            except Exception:
                session = None
            if not session:
                continue
            cs = session.get('chart_session')
            for obj in (
                session.get('chart'),
                session.get('comparison_chart'),
                getattr(cs, 'chart', None) if cs is not None else None,
                getattr(cs, 'radix', None) if cs is not None else None,
                getattr(cs, '_initial_chart', None) if cs is not None else None,
                getattr(cs, 'display_anchor_chart', None) if cs is not None else None,
            ):
                if obj is None:
                    continue
                key = id(obj)
                if key in seen:
                    continue
                seen.add(key)
                rebuild = getattr(obj, 'rebuildFixStars', None)
                if callable(rebuild):
                    try:
                        rebuild()
                    except Exception:
                        pass

    def _read_relationship_charts(self, opts) -> dict:
        """Relationship-chart settings (morin.onRelChartsCompositeMethod +
        onRelChartsLauncherToggle, morin.py:20167-20228). ``composite_method`` is
        the CompositeOptsDlg ASC-method radio (options.Options.COMPOSITE_ASC_*,
        options.py:74-76); ``synastry_opens_composite_first`` is the launcher
        radio. Both persist via saveComposite (options.py:2844-2849)."""
        import options as _options
        method = int(getattr(opts, 'composite_method',
                             _options.Options.COMPOSITE_ASC_MIDPOINT) or 0)
        if method not in (0, 1, 2):
            method = _options.Options.COMPOSITE_ASC_MIDPOINT
        return {
            'composite_method': method,
            'synastry_opens_composite_first': bool(
                getattr(opts, 'synastry_opens_composite_first', False)),
        }

    def _apply_relationship_charts(self, opts, fields: dict) -> bool:
        changed = False
        if 'composite_method' in fields:
            try:
                value = int(fields['composite_method'])
            except (TypeError, ValueError):
                value = None
            if value in (0, 1, 2) and int(getattr(opts, 'composite_method', 0) or 0) != value:
                opts.composite_method = value
                changed = True
        if 'synastry_opens_composite_first' in fields:
            value = bool(fields['synastry_opens_composite_first'])
            if bool(getattr(opts, 'synastry_opens_composite_first', False)) != value:
                opts.synastry_opens_composite_first = value
                changed = True
        return changed

    def _read_languages(self, opts) -> dict:
        """Language selection (langsdlg.LanguagesDlg, morin.onLanguages
        morin.py:20231-20761). ``langid`` is an index into mtexts language
        tables. The available list is the catalogue of bundled language packs.

        NOTE: daemon-served labels ARE localized — export_chart_json
        .activate_language() binds mtexts to opts.langid at boot and
        _apply_languages re-binds on change, so mtexts-sourced strings
        (planet/house/aspect/part names, table headers, chart-type names, ...)
        follow the selection. React mirrors this same langid through its catalog
        provider, so daemon labels and interface chrome switch together."""
        return {
            'langid': int(getattr(opts, 'langid', 0) or 0),
            'available': self._language_catalog(),
        }

    @staticmethod
    def _language_catalog() -> list:
        """Bundled language list — labels verbatim from mtexts.langtexts, the
        same tuple the wx LanguagesDlg ComboBox lists (langsdlg.py:18). ``value``
        remains the original combo index / options.langid (langsdlg.py:58-59),
        while the display order prioritizes the fully translated Western
        locales used most often in Aries."""
        try:
            names = list(getattr(mtexts, 'langtexts', None) or [])
        except Exception:
            names = []
        catalog = [{'value': i, 'label': str(lbl)} for i, lbl in enumerate(names)]
        preferred_order = {langid: rank for rank, langid in enumerate((0, 3, 5, 2, 9))}
        catalog.sort(
            key=lambda entry: (
                preferred_order.get(entry['value'], len(preferred_order)),
                entry['value'],
            )
        )
        return catalog

    def _apply_languages(self, opts, fields: dict) -> bool:
        """Persist the chosen langid and rebind mtexts' active string tables so
        every daemon-served label (planet/house/aspect/part names, table
        headers, chart-type names, ...) re-localizes live — the wx analogue is
        morin.onLanguages reloading the language table (morin.py:20240-20272).
        The text-only refresh that follows re-reads the now-switched labels,
        titles, dates, and font profile without rebuilding chart semantics.
        Restricted to known indices."""
        changed = False
        if 'langid' in fields:
            try:
                value = int(fields['langid'])
            except (TypeError, ValueError):
                value = None
            catalog = self._language_catalog()
            valid = {entry['value'] for entry in catalog} if catalog else None
            if value is not None and (valid is None or value in valid):
                if int(getattr(opts, 'langid', 0) or 0) != value:
                    opts.langid = value
                    changed = True
        # Always re-assert the active language via the single entry point, so a
        # first-touch of this tab (or a stale binding) converges even when the
        # value did not change. activate_language() switches mtexts AND rebuilds
        # common.common's month/day tables (captured by value), so dates follow
        # the language live, not just at boot.
        target = int(getattr(opts, 'langid', 0) or 0)
        try:
            from webapp.frontend.scripts import export_chart_json
            active = export_chart_json.activate_language(target)
            if active != target:
                logger.error(
                    "Requested language id %d could not be activated; language id %d is active",
                    target,
                    active,
                )
        except Exception:
            logger.exception(
                "Canonical language activation failed for id %d; trying the direct mtexts path",
                target,
            )
            try:
                mtexts.setLang(target)
            except Exception:
                logger.exception(
                    "Direct language activation failed for id %d; falling back to English",
                    target,
                )
                try:
                    mtexts.setLang(0)
                except Exception:
                    logger.exception("Failed to activate the English localization fallback")
                    raise
        return changed

    def _read_quick_charts(self, opts) -> dict:
        """QuickChartsOptDlg fields (quickchartsoptdlg.py:96-126 fill()).

        ``progressed_angle_method`` / ``progression_day_type`` are the
        progression CALC options consumed by posfordate's builders
        (posfordate.py:374,448-449), the secondary adapter defaults
        (engine/supplementary_adapter.py:195-203) and searchbackend
        (searchbackend.py:1077,2872). The other fields are launcher behaviours
        persisted to the same quickcharts.opt file (options.saveQuickCharts,
        options.py:2725-2736); the webapp consumes quickcharts_prompt via
        get_quickcharts_prompt_predicate and the progression launch mode via
        get_progression_launch_predicate."""
        return {
            'quickcharts_prompt': bool(getattr(opts, 'quickcharts_prompt', True)),
            'quickcharts_anchor_to_radix': 1 if int(getattr(opts, 'quickcharts_anchor_to_radix', 0) or 0) == 1 else 0,
            'timed_chart_show_radix_default': bool(
                getattr(opts, 'timed_chart_show_radix_default', False)),
            'event_table_time_basis': event_table_time_basis(opts),
            'subcharts_open_compound_default': bool(
                getattr(opts, 'subcharts_open_compound_default', False)),
            'secondary_progression_launch_mode': int(getattr(opts, 'secondary_progression_launch_mode', 0) or 0),
            'at_reclick_behavior': str(getattr(opts, 'at_reclick_behavior', 'focus_only') or 'focus_only'),
            'progressed_angle_method': posfordate.progression_angle_method(
                getattr(opts, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)),
            'progression_day_type': posfordate.progression_day_type(
                getattr(opts, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)),
        }

    def _apply_quick_charts(self, opts, fields: dict) -> tuple[bool, bool]:
        """Write QuickChartsOptDlg.check fields (quickchartsoptdlg.py:128-155),
        normalized exactly as the wx dialog normalizes them. Returns
        ``(changed, calc_changed)`` — ``calc_changed`` is True when the two
        progression CALC fields changed, so the caller can push the new values
        into open progression bindings before the recalc fan-out (the headless
        analogue of morin.onQuickChartsOpt -> _refresh_active_progression_session,
        morin.py:20126-20143)."""
        changed = False
        calc_changed = False

        if 'quickcharts_prompt' in fields:
            value = bool(fields['quickcharts_prompt'])
            if bool(getattr(opts, 'quickcharts_prompt', True)) != value:
                opts.quickcharts_prompt = value
                changed = True

        if 'quickcharts_anchor_to_radix' in fields:
            try:
                value = 1 if int(fields['quickcharts_anchor_to_radix']) == 1 else 0
            except (TypeError, ValueError):
                value = None
            if value is not None and int(getattr(opts, 'quickcharts_anchor_to_radix', 0) or 0) != value:
                opts.quickcharts_anchor_to_radix = value
                changed = True

        if 'timed_chart_show_radix_default' in fields:
            value = bool(fields['timed_chart_show_radix_default'])
            if bool(getattr(opts, 'timed_chart_show_radix_default', False)) != value:
                opts.timed_chart_show_radix_default = value
                changed = True

        if 'event_table_time_basis' in fields:
            value = str(fields['event_table_time_basis'] or '')
            if value in EVENT_TABLE_TIME_BASIS_VALUES and event_table_time_basis(opts) != value:
                opts.event_table_time_basis = value
                changed = True

        if 'subcharts_open_compound_default' in fields:
            value = bool(fields['subcharts_open_compound_default'])
            if bool(getattr(opts, 'subcharts_open_compound_default', False)) != value:
                opts.subcharts_open_compound_default = value
                changed = True

        if 'secondary_progression_launch_mode' in fields:
            try:
                value = int(fields['secondary_progression_launch_mode'])
            except (TypeError, ValueError):
                value = None
            if value not in (0, 1, 2):
                value = None
            if value is not None and int(getattr(opts, 'secondary_progression_launch_mode', 0) or 0) != value:
                opts.secondary_progression_launch_mode = value
                changed = True

        if 'at_reclick_behavior' in fields:
            value = str(fields['at_reclick_behavior'])
            if value in ('focus_only', 'focus_and_snap_now', 'new_tab') and \
                    getattr(opts, 'at_reclick_behavior', 'focus_only') != value:
                opts.at_reclick_behavior = value
                changed = True

        if 'progressed_angle_method' in fields:
            value = posfordate.progression_angle_method(fields['progressed_angle_method'])
            if posfordate.progression_angle_method(
                    getattr(opts, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)) != value:
                opts.progressed_angle_method = value
                changed = True
                calc_changed = True

        if 'progression_day_type' in fields:
            value = posfordate.progression_day_type(fields['progression_day_type'])
            if posfordate.progression_day_type(
                    getattr(opts, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)) != value:
                opts.progression_day_type = value
                changed = True
                calc_changed = True

        return changed, calc_changed

    def _apply_primary_directions(self, opts, fields: dict) -> bool:
        """Write every PrimDirsPanel.check() field (primarydirsdlg.py:1469-1761).
        Scalars set directly; fixed-length bool vectors written IN PLACE
        (promplanets[:] = ...) to preserve options.py list identity. pdlof is a
        2-vector split across promlof/siglof to match the wx promissor/
        significator placement. sigascmc is kept in sync from sigangles exactly
        as check() does (:1559-1563)."""
        changed = False

        # -- scalar ints -----------------------------------------------------
        for attr in (
            'primarydir', 'subprimarydir', 'subzodiacal',
            'pdsecmotioniter', 'pdcircumoa', 'pdrevsunyearmode',
            'pdrevannualmode', 'pdlistmode',
            'pdincharttyp',
            'pdkeyd', 'pdkeys', 'pdkeydeg', 'pdkeymin', 'pdkeysec',
        ):
            if attr in fields:
                try:
                    setattr(opts, attr, int(fields[attr]))
                    changed = True
                except (TypeError, ValueError):
                    pass

        # -- scalar bools ----------------------------------------------------
        for attr in (
            'bianchini', 'morin_excentric', 'morin_antiscia',
            'ascmchcsasproms', 'pdcusppromissors', 'pdantiscia', 'pdmorinpromittorset', 'pdmidpoints', 'pdterms',
            'pdfixstars', 'pdsecmotion', 'pdpromchiron', 'pdpromarabicparts',
            'pdcustomer', 'pdcustomersouthern',
            'sighouses', 'pdsyzygy', 'pdsigchiron', 'pdsigvertex',
            'pdcustomer2', 'pdcustomer2southern', 'pdsigarabicparts',
            'pdkeydyn', 'pdlistglyphcolors', 'pdrevshownatalpromissors', 'useregressive',
            'pdinchartsecmotion', 'pdinchartterrsecmotion', 'pdinchartreverse',
        ):
            if attr in fields:
                setattr(opts, attr, bool(fields[attr]))
                changed = True

        if 'pdpromarabicpartname' in fields:
            opts.pdpromarabicpartname = str(fields['pdpromarabicpartname'])
            changed = True

        if 'pdsigarabicpartname' in fields:
            opts.pdsigarabicpartname = str(fields['pdsigarabicpartname'])
            changed = True
        if 'pdpromarabicparts' in fields or 'pdpromarabicpartname' in fields:
            before = getattr(opts, 'pdpromarabicpartname', '')
            self._sync_pd_arabic_part_selection(opts, 'pdpromarabicparts', 'pdpromarabicpartname')
            changed = changed or before != getattr(opts, 'pdpromarabicpartname', '')
        if 'pdsigarabicparts' in fields or 'pdsigarabicpartname' in fields:
            before = getattr(opts, 'pdsigarabicpartname', '')
            self._sync_pd_arabic_part_selection(opts, 'pdsigarabicparts', 'pdsigarabicpartname')
            changed = changed or before != getattr(opts, 'pdsigarabicpartname', '')

        # -- pdfixstarssel (the fixstarspddlg sub-dialog selection list) -------
        # Variable-length parallel-bool list keyed by the options.fixstars order.
        # Normalize to the catalog length so a partial patch from the picker
        # writes the whole list (savePrimaryDirs persists it, options.py:2451).
        if 'pdfixstarssel' in fields and isinstance(fields['pdfixstarssel'], (list, tuple)):
            length = len(getattr(opts, 'fixstars', None) or {})
            incoming = [bool(v) for v in fields['pdfixstarssel'][:length]]
            if len(incoming) < length:
                incoming.extend([False] * (length - len(incoming)))
            existing = getattr(opts, 'pdfixstarssel', None)
            if isinstance(existing, list) and len(existing) == length:
                existing[:] = incoming
            else:
                opts.pdfixstarssel = incoming
            changed = True

        # -- fixed-length bool vectors (in-place writes) ---------------------
        for attr in (
            ('promplanets', 12), ('sigplanets', 12), ('sigangles', 4),
            ('pdaspects', 12), ('pdparallels', 2), ('zodpromsigasps', 2),
        ):
            name, _count = attr
            if name in fields and isinstance(fields[name], (list, tuple)):
                incoming = [bool(v) for v in fields[name]]
                existing = getattr(opts, name, None)
                if existing is not None and len(incoming) == len(existing):
                    existing[:] = incoming
                    changed = True

        # -- CustomerDlg coordinate triples (lon deg/min/sec, lat deg/min/sec) -
        for attr, limits in (
            ('pdcustomerlon', (359, 59, 59)),
            ('pdcustomerlat', (90, 59, 59)),
            ('pdcustomer2lon', (359, 59, 59)),
            ('pdcustomer2lat', (90, 59, 59)),
        ):
            if attr not in fields or not isinstance(fields[attr], (list, tuple)):
                continue
            existing = getattr(opts, attr, None)
            if existing is None or len(existing) < 3:
                continue
            incoming = []
            for i, max_value in enumerate(limits):
                try:
                    value = int(fields[attr][i])
                except (IndexError, TypeError, ValueError):
                    value = int(existing[i])
                incoming.append(max(0, min(max_value, value)))
            if list(existing[:3]) != incoming:
                existing[:3] = incoming
                changed = True

        # -- pdlof[0]=promissor LoF, pdlof[1]=significator LoF ----------------
        pdlof = getattr(opts, 'pdlof', None)
        if pdlof is not None and len(pdlof) == 2:
            if 'promlof' in fields:
                pdlof[0] = bool(fields['promlof'])
                changed = True
            if 'siglof' in fields:
                pdlof[1] = bool(fields['siglof'])
                changed = True

        # -- sigascmc back-compat sync (check() :1559-1563) ------------------
        sigangles = getattr(opts, 'sigangles', None)
        sigascmc = getattr(opts, 'sigascmc', None)
        if sigangles is not None and len(sigangles) >= 4 and isinstance(sigascmc, list):
            asc_group = bool(sigangles[0] or sigangles[1])
            mc_group = bool(sigangles[2] or sigangles[3])
            if [asc_group, mc_group] != sigascmc:
                opts.sigascmc = [asc_group, mc_group]
                changed = True

        return changed

    def _selected_planet_glyph(self, opts, body_id: int) -> str:
        """Mirror common.common.update(options) for body glyph variants without
        importing wx-bound common.py."""
        if body_id == 7:
            if bool(getattr(opts, 'uranus', True)):
                return _SYMBOL_URANUS_GLYPHS[0]
            return _SYMBOL_URANUS_GLYPHS[1]
        if body_id == 9:
            try:
                pluto_idx = int(getattr(opts, 'pluto', 0))
            except Exception:
                pluto_idx = 0
            if pluto_idx < 0 or pluto_idx >= len(_SYMBOL_PLUTO_GLYPHS):
                pluto_idx = 0
            return _SYMBOL_PLUTO_GLYPHS[pluto_idx]
        return _MORINUS_GLYPHS_BY_SEID.get(body_id, '')

    def _read_individual_color_catalog(self, opts) -> list[dict]:
        rows: list[dict] = []
        for item in _localized(_INDIVIDUAL_COLOR_CATALOG):
            index = int(item['index'])
            if index in (7, 9):
                item['glyph'] = self._selected_planet_glyph(opts, index)
            rows.append(item)
        return rows

    def _read_transcendental_label_catalog(self, opts) -> list[dict]:
        return [
            {'label': _txt('Uranus', 'Uranus'), 'glyph': self._selected_planet_glyph(opts, 7)},
            {'label': _txt('Neptune', 'Neptune'), 'glyph': _MORINUS_GLYPHS_BY_SEID[8]},
            {'label': _txt('Pluto', 'Pluto'), 'glyph': self._selected_planet_glyph(opts, 9)},
        ]

    def _read_step_alert_body_catalog(self, opts) -> list[dict]:
        rows: list[dict] = []
        for item in _localized(_STEP_ALERT_BODY_CATALOG):
            body_id = int(item['id'])
            if body_id in (7, 9):
                item['glyph'] = self._selected_planet_glyph(opts, body_id)
            rows.append(item)
        return rows

    def _read_catalog(self, opts) -> dict:
        """Field-metadata catalog the dialog renders generic controls from —
        the daemon-owned option-field oracle (see catalog tables above)."""
        return {
            'colorFields': _localized(_COLOR_FIELD_CATALOG),
            'individualColors': self._read_individual_color_catalog(opts),
            'aspectLabels': _aspect_label_catalog(),
            'aspectGlyphs': list(_MORINUS_ASPECT_GLYPHS),
            'fixstarsModes': _fixstars_mode_catalog(),
            'phasisModes': _localized(_PHASIS_MODE_CATALOG),
            'cazimiModes': _localized(_CAZIMI_MODE_CATALOG),
            'synodicModes': _localized(_SYNODIC_MODE_CATALOG),
            'eventTableTimeModes': _localized(_EVENT_TABLE_TIME_BASIS_CATALOG),
            'themeLayouts': _localized(_THEME_LAYOUT_CATALOG),
            'angloDenseLabelLayouts': [dict(item) for item in _ANGLO_DENSE_LABEL_LAYOUT_CATALOG],
            'mansionZodiacModes': _localized(_MANSION_ZODIAC_CATALOG),
            'speculumPlacidianCols': _localized(_SPECULUM_PLACIDIAN_COLS),
            'speculumRegiomontanCols': _localized(_SPECULUM_REGIOMONTAN_COLS),
            'orbTargets': [
                {'value': i, 'label': _txt(lbl, lbl)}
                for i, lbl in enumerate(_ORB_TARGET_CATALOG)
            ],
            'dignityScoreLabels': _dignity_score_labels(),
            'termSets': _localized(_TERM_SET_CATALOG),
            # Essential-dignities grid axes (DignitiesDlg). Planets = the 10 the
            # wx check() loop edits (Sun..Pluto); types = Domicile/Exaltation.
            # signs are shared with zodiacSigns below.
            'dignityPlanets': [str(mtexts.txts[k]) for k in _DIGNITY_PLANET_KEYS],
            'dignityTypes': [str(mtexts.txts[k]) for k in _DIGNITY_TYPE_KEYS],
            # Term-ruler combo choices (TermsDlg per-cell planet picker). value is
            # the stored term-planet code (pls2 index + OFFS, Mercury=2..Saturn=6).
            'termPlanets': [
                {'value': i + _TERM_PLANET_OFFS, 'label': str(mtexts.txts[k])}
                for i, k in enumerate(_TERM_PLANET_KEYS)
            ],
            'symbolUranus': [dict(f) for f in _SYMBOL_URANUS_CATALOG],
            'symbolPluto': [dict(f) for f in _SYMBOL_PLUTO_CATALOG],
            'symbolSigns': [dict(f) for f in _SYMBOL_SIGNS_CATALOG],
            'defaultLocationFields': _localized(_DEFLOC_FIELD_CATALOG),
            'transcendentalLabels': self._read_transcendental_label_catalog(opts),
            'stepAlertBodies': self._read_step_alert_body_catalog(opts),
            'stepAlertAngles': _localized(_STEP_ALERT_ANGLE_CATALOG),
            'sliders': _slider_catalog(),
            'keypromptStyles': list(_KEYPROMPT_STYLE_CATALOG),
            'dateConventions': [dict(f) for f in _DATE_CONVENTION_CATALOG],
            'fontProfiles': [dict(f) for f in _FONT_PROFILE_CATALOG],
            # QuickChartsOptDlg choice catalogs — values/labels verbatim from
            # the wx surface (quickchartsoptdlg.py:17-65; posfordate.py:39-59).
            'progressionAngleMethods': [
                {'value': v, 'label': posfordate.progression_angle_method_label(v)}
                for v in sorted(posfordate.ANGLE_METHOD_NAMES)
            ],
            'progressionDayTypes': [
                {'value': v, 'label': posfordate.progression_day_type_label(v)}
                for v in sorted(posfordate.PROGRESSION_DAY_TYPE_NAMES)
            ],
            'quickchartsAnchorModes': [
                {'value': 0, 'label': _txt('Auto', 'Auto')},
                {'value': 1, 'label': _txt('Parent', 'Parent')},
            ],
            'secondaryLaunchModes': [
                {'value': 0, 'label': _txt('Chart', 'Chart')},
                {'value': 1, 'label': _txt('Table', 'Table')},
                {'value': 2, 'label': _txt('Both', 'Both')},
            ],
            'atReclickModes': [
                {'value': 'focus_only', 'label': _txt('AtReclickFocusOnly', 'Focus existing tab (keep stepped position)')},
                {'value': 'focus_and_snap_now', 'label': _txt('AtReclickFocusSnap', 'Focus + snap cursor to now')},
                {'value': 'new_tab', 'label': _txt('AtReclickNewTab', 'Always open a new tab')},
            ],
            # Planets/Points choice catalogs — labels verbatim from mtexts
            # (the wx oracle). Node labels strip the wx accelerator suffix
            # (mtexts.py:83 'Mean Node\tAlt+M'); meannode is stored as the
            # bool morin.onNodes writes (True=Mean — morin.py:19851-19855).
            'nodeModes': [
                {'value': 1, 'label': str(mtexts.menutxts['OMNMean']).split('\t')[0]},
                {'value': 0, 'label': str(mtexts.menutxts['OMNTrue']).split('\t')[0]},
            ],
            # fortunedlg radio order = options.lotoffortune 0/1/2
            # (fortunedlg.py:85; chart.py:497-499). 1 and 2 carry the
            # nocturnal sub-label the wx dialog shows beneath the radio.
            'fortunaModes': [
                {'value': 0, 'label': mtexts.txts['LFMoonSun'], 'sublabel': ''},
                {'value': 1, 'label': mtexts.txts['LFDSunMoon'], 'sublabel': mtexts.txts['LFNMoonSun']},
                {'value': 2, 'label': mtexts.txts['LFDMoonSun'], 'sublabel': mtexts.txts['LFNSunMoon']},
            ],
            # syzygydlg radio order = options.Options MOON/ABOVEHOR/
            # ABOVEHORNATAL (options.py:78-80; syzygydlg.py:70-92).
            'syzygyModes': [
                {'value': 0, 'label': mtexts.txts['SyzMoon']},
                {'value': 1, 'label': mtexts.txts['SyzAbove']},
                {'value': 2, 'label': mtexts.txts['SyzAboveNatal']},
            ],
            # Arabic-parts Ascendant reference (arabicpartsdlg.py:959-961;
            # mtexts.partsreftxts — Asc..House 12 cusp).
            'arabicPartsRefs': [
                {'value': i, 'label': str(lbl)}
                for i, lbl in enumerate(mtexts.partsreftxts)
            ],
            # Lot-formula calculator catalogs. Term list = mtexts.partstxts in
            # combo order with the wx integer code from mtexts.conv (the A/B/C
            # pickers, arabicpartsdlg.py:1040-1056); `kind` marks the tokens
            # that unlock the inline RE / DE sub-controls
            # (_update_inline_refdeg_enabled, arabicpartsdlg.py:1491-1504).
            'arabicPartTerms': self._arabic_part_terms(),
            # DE sign picker labels (FormulaEditorDlg._signs,
            # arabicpartsdlg.py:1065-1067).
            'zodiacSigns': [
                str(mtexts.txts[k]) for k in (
                    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                    'Libra', 'Scorpio', 'Sagittarius', 'Capricornus',
                    'Aquarius', 'Pisces')
            ],
            # Synthetic LoF row title + RE picker row-0 label
            # (arabicpartsdlg.py:914/1230).
            'lotOfFortuneName': str(mtexts.txts.get('LotOfFortune', u'Fortuna')),
            # Composite ASC-method radio (compositeoptsdlg.py:31-44). value ==
            # options.Options.COMPOSITE_ASC_* (options.py:74-76). The MC note and
            # ASC group label come from mtexts (compositeoptsdlg.py:20/24).
            'compositeMethods': [
                {'value': 0, 'label': str(mtexts.txts.get('CompositeASCMidpoint', 'ASC is taken as short-arc midpoint'))},
                {'value': 1, 'label': str(mtexts.txts.get('CompositeASCDerivedRef', 'ASC is derived from Reference place'))},
                {'value': 2, 'label': str(mtexts.txts.get('CompositeASCDerivedGeo', 'ASC is derived from (A+B)/2 coordinates'))},
            ],
            'compositeMCNote': str(mtexts.txts.get('CompositeMCShortArc', 'MC is taken as short-arc midpoint')),
            'compositeASCLabel': str(mtexts.txts.get('CompositeASCLabel', 'ASC calculation method:')),
            # Synastry launcher radio (morin.py:14452-14453). value == the bool
            # synastry_opens_composite_first (False = Synastry first).
            'relationshipLauncherModes': [
                {'value': False, 'label': _txt('OpenSynastryFirst', 'Open Synastry first')},
                {'value': True, 'label': _txt('OpenCompositeFirst', 'Open Composite first')},
            ],
            # Eclipse chart-moment radio (morin.py:14431-14442). value == the
            # ECLIPSE_CHART_MOMENT_* string enum (options.py:57-58).
            'eclipseModes': [
                {'value': 'exact_conjunction', 'label': _txt('ExactConjunction', 'Exact conjunction')},
                {'value': 'eclipse_maximum', 'label': _txt('EclipseMaximum', 'Eclipse maximum')},
            ],
            # Firdaria nocturnal-order radio (firdariadlg.py:42-44). value == the
            # isfirbonatti bool (True = Bonatus).
            'firdariaModes': [
                {'value': True, 'label': str(mtexts.txts.get('Bonatus', 'Bonatus'))},
                {'value': False, 'label': str(mtexts.txts.get('AlBiruni', 'Al-Biruni'))},
            ],
            # Almuten scoring weight row labels (almutenchartdlg.py). Dignity +
            # sun-phase + day/hour labels from mtexts where available.
            'almutenDignityLabels': _dignity_score_labels(),
        }

    @staticmethod
    def _arabic_part_terms() -> list:
        _ensure_arabic_part_tokens()
        ap = arabicparts.ArabicParts
        terms = []
        for label in mtexts.partstxts:
            try:
                code = int(mtexts.conv[label])
            except Exception:
                continue
            kind = ''
            if code in (ap.RE, ap.REFLORD):
                kind = 'RE'
            elif code in (ap.DEG, ap.DEGLORD):
                kind = 'DE'
            terms.append({'value': code, 'label': str(label), 'kind': kind})
        return terms

    def _read_colors(self, opts) -> dict:
        out: dict[str, Any] = {}
        for attr in _COLOR_RGB_FIELDS:
            out[attr] = _rgb(getattr(opts, attr, None))
        for attr in _COLOR_LIST_FIELDS:
            seq = getattr(opts, attr, None) or []
            out[attr] = [_rgb(v) for v in seq]
        for attr in _COLOR_BOOL_FIELDS:
            out[attr] = bool(getattr(opts, attr, False))
        return out

    def _read_display(self, opts) -> dict:
        out: dict[str, Any] = {}
        for attr in _DISPLAY_BOOL_FIELDS:
            out[attr] = bool(getattr(opts, attr, False))
        for attr in _DISPLAY_INT_FIELDS:
            out[attr] = int(getattr(opts, attr, 0) or 0)
        for attr in _DISPLAY_BOOL_VECTOR_FIELDS:
            out[attr] = [bool(v) for v in (getattr(opts, attr, None) or [])]
        for attr in _DISPLAY_INT_SLIDER_FIELDS:
            out[attr] = int(getattr(opts, attr, 0) or 0)
        for attr in _DISPLAY_FLOAT_SLIDER_FIELDS:
            out[attr] = float(getattr(opts, attr, 0.0) or 0.0)
        for attr in _DISPLAY_ENUM_STR_FIELDS:
            if attr == 'dateconvention':
                out[attr] = dateformat.date_convention_from_options(opts)
            elif attr == 'anglo_dense_label_layout':
                value = str(getattr(opts, attr, 'leader-columns') or 'leader-columns')
                out[attr] = value if value in _ANGLO_DENSE_LABEL_LAYOUT_VALUES else 'routed-cusps'
            else:
                out[attr] = str(getattr(opts, attr, '') or '')
        # fontfamily — coerce through fontprofiles so an unknown stored value
        # round-trips to the default profile (fontprofiles.coerce_profile).
        ff = getattr(opts, 'fontfamily', None)
        out['fontfamily'] = _coerce_font_profile(ff)
        return out

    @staticmethod
    def _read_aspect_list(opts) -> dict:
        """List-only aspect policy; never part of the chart display contract."""
        return {
            'showAspectsForDerivedPoints': bool(
                getattr(opts, 'showaspectsforderivedpoints', False)
            ),
        }

    def _read_export(self, opts) -> dict:
        mode = str(getattr(opts, 'pdf_chart_color_mode', 'monochrome') or 'monochrome')
        if mode not in _PDF_CHART_COLOR_MODE_VALUES:
            mode = 'monochrome'
        raster_preset = str(getattr(opts, 'pdf_chart_raster_preset', 'clean') or 'clean')
        if raster_preset not in _PDF_CHART_RASTER_PRESET_VALUES:
            raster_preset = 'clean'
        png_appearance = str(getattr(opts, 'png_chart_appearance', 'screen') or 'screen')
        if png_appearance not in _PNG_CHART_APPEARANCE_VALUES:
            png_appearance = 'screen'
        return {
            'pngChartAppearance': png_appearance,
            'pngIncludeOverlays': bool(getattr(opts, 'png_include_overlays', True)),
            'pngChartAppearanceChoices': [dict(item) for item in _PNG_CHART_APPEARANCE_CATALOG],
            'pdfChartColorMode': mode,
            'pdfChartRasterPreset': raster_preset,
            'pdfIncludeOverlays': bool(getattr(opts, 'pdf_include_overlays', True)),
            'listExportAspectSymbols': bool(
                getattr(opts, 'list_export_aspect_symbols', False)
            ),
            'pdfChartColorModeChoices': _localized(_PDF_CHART_COLOR_MODE_CATALOG),
            'pdfChartRasterPresetChoices': [dict(item) for item in _PDF_CHART_RASTER_PRESET_CATALOG],
        }

    def _read_house_system(self, opts) -> dict:
        codes = list(houses.Houses.hsystems)
        # Person-named systems (Placidus/Koch/Regiomontanus/Campanus/Morinus/
        # Alcabitius/Porphyry) are proper nouns kept untranslated; the descriptive
        # ones localize through mtexts.
        labels = {
            'P': 'Placidus', 'K': 'Koch', 'R': 'Regiomontanus', 'C': 'Campanus',
            'E': _txt('Equal', 'Equal'), 'W': _txt('WholeSign', 'Whole Sign'),
            'X': _txt('AxialRotation', 'Axial Rotation'),
            'Q': _txt('TrueAscendant', 'True Ascendant'), 'M': 'Morinus',
            'H': _txt('Horizon', 'Horizon'), 'T': 'Polich-Page (Topocentric)', 'B': 'Alcabitius',
            'O': 'Porphyry', 'N': _txt('None', 'None'),
        }
        return {
            'hsys': str(getattr(opts, 'hsys', 'P')),
            'housesystem': bool(getattr(opts, 'housesystem', False)),
            'available': [{'code': c, 'label': labels.get(c, c)} for c in codes],
        }

    def _read_ayanamsha(self, opts) -> dict:
        try:
            entries = list(mtexts.ayanamsha_display_entries())
        except Exception:
            entries = []
        idx = int(getattr(opts, 'ayanamsha', 0) or 0)
        return {
            'ayanamsha': idx,
            'available': [{'index': i, 'label': str(label)} for i, label in entries],
        }

    def _read_orbs(self, opts) -> dict:
        out: dict[str, Any] = {}
        for attr in _ORB_MATRIX_FIELDS:
            out[attr] = [[float(v) for v in row] for row in (getattr(opts, attr, None) or [])]
        for attr in _ORB_VECTOR_FIELDS:
            out[attr] = [float(v) for v in (getattr(opts, attr, None) or [])]
        for attr in _ORB_SCALAR_FIELDS:
            out[attr] = float(getattr(opts, attr, 0.0) or 0.0)
        # Fixed-star conjunction orbs. options.fixstars is a per-star {name: orb}
        # dict (options.py:525); fixstarsorbdlg.py edits one selected star and
        # also has an "All" bulk setter (fixstarsorbdlg.py:118, :138-155).
        out['fixstarsOrbAll'] = self._read_fixstars_orb(opts)
        out['fixstarsOrbs'] = [
            {'name': str(name), 'orb': float(value)}
            for name, value in (getattr(opts, 'fixstars', None) or {}).items()
        ]
        return out

    @staticmethod
    def _read_fixstars_orb(opts) -> float:
        fs = getattr(opts, 'fixstars', None) or {}
        vals = [float(v) for v in fs.values()]
        if not vals:
            return 1.5  # chart.Chart.def_fixstarsorb
        # Most common value (uniform dict -> that value).
        counts: dict[float, int] = {}
        for v in vals:
            counts[v] = counts.get(v, 0) + 1
        return max(counts.items(), key=lambda kv: kv[1])[0]

    def _read_dignities(self, opts) -> dict:
        out: dict[str, Any] = {}
        for attr in _DIGNITY_BOOL_FIELDS:
            out[attr] = bool(getattr(opts, attr, False))
        for attr in _DIGNITY_INT_FIELDS:
            out[attr] = int(getattr(opts, attr, 0) or 0)
        for attr in _DIGNITY_LIST_FIELDS:
            out[attr] = [int(v) for v in (getattr(opts, attr, None) or [])]
        # Big nested matrices: passthrough (read-only-ish; the daemon does not
        # reproduce the per-cell wx grid editor — see options.md "Gaps").
        for attr in _DIGNITY_TABLE_FIELDS:
            out[attr] = getattr(opts, attr, None)
        return out

    def _read_symbols(self, opts) -> dict:
        """Glyph-variant settings (symbolsdlg.SymbolsDlg). uranus/signs are bool,
        pluto is an int 0..3 (options.py:186-188)."""
        out: dict[str, Any] = {}
        for attr in _SYMBOL_BOOL_FIELDS:
            out[attr] = bool(getattr(opts, attr, True))
        for attr in _SYMBOL_INT_FIELDS:
            out[attr] = int(getattr(opts, attr, 0) or 0)
        return out

    def _read_lunar_mansions(self, opts) -> dict:
        """Lunar Mansions (manazil) zodiac mode (mansionsdlg.MansionsDlg.fill,
        mansionsdlg.py:59-63). `manazil_zodiac` is a string in
        manazil.ZODIAC_MODES (options.py:318)."""
        mode = str(getattr(opts, 'manazil_zodiac', 'auto') or 'auto')
        if mode not in _MANSION_ZODIAC_VALUES:
            mode = 'auto'
        return {
            'manazil_zodiac': mode,
            'show_manzil_in_inspector': bool(
                getattr(opts, 'show_manzil_in_inspector', True)),
        }

    def _read_speculum(self, opts) -> dict:
        """Speculum column-visibility settings (appearance2dlg.Appearance2Dlg.fill,
        appearance2dlg.py:242-283). Reads the two speculum rows
        (options.speculums[PLACIDIAN|REGIOMONTAN][col]) + speculumdodecat[2] +
        intime into a flat shape the skin renders generic toggles from."""
        specs = getattr(opts, 'speculums', None) or []
        placidian = specs[_SPECULUM_PLACIDIAN] if len(specs) > _SPECULUM_PLACIDIAN else []
        regio = specs[_SPECULUM_REGIOMONTAN] if len(specs) > _SPECULUM_REGIOMONTAN else []
        dodecat = getattr(opts, 'speculumdodecat', None) or []
        return {
            'placidian': {
                str(c['idx']): bool(placidian[c['idx']]) if c['idx'] < len(placidian) else False
                for c in _SPECULUM_PLACIDIAN_COLS
            },
            'regiomontan': {
                str(c['idx']): bool(regio[c['idx']]) if c['idx'] < len(regio) else False
                for c in _SPECULUM_REGIOMONTAN_COLS
            },
            'placidianDodec': bool(dodecat[_SPECULUM_PLACIDIAN]) if len(dodecat) > _SPECULUM_PLACIDIAN else False,
            'regiomontanDodec': bool(dodecat[_SPECULUM_REGIOMONTAN]) if len(dodecat) > _SPECULUM_REGIOMONTAN else False,
            'intime': bool(getattr(opts, 'intime', False)),
        }

    def _read_defloc(self, opts, *, when: Optional[datetime.datetime] = None) -> dict:
        """Saved default ("Here-and-Now") location — the def* fields the
        Here-and-Now chart is built from (chart_service.py:141)."""
        out: dict[str, Any] = {}
        for attr in _DEFLOC_STR_FIELDS:
            out[attr] = str(getattr(opts, attr, '') or '')
        for attr in _DEFLOC_INT_FIELDS:
            out[attr] = int(getattr(opts, attr, 0) or 0)
        for attr in _DEFLOC_FLOAT_FIELDS:
            value = getattr(opts, attr, None)
            out[attr] = None if value is None else float(value)
        for attr in _DEFLOC_BOOL_FIELDS:
            out[attr] = bool(getattr(opts, attr, False))
        info = self._resolve_defloc_auto_timezone(opts, when=when)
        if info is not None:
            out['deflocplus'] = bool(info['plus'])
            out['defloczhour'] = int(info['zh'])
            out['defloczminute'] = int(info['zm'])
            out['deflocdst'] = bool(info['daylightsaving'])
            out['defloctzid'] = str(info['tzid'] or '')
        return out

    @staticmethod
    def _defloc_place(opts):
        try:
            return default_location_model.place_from_options(opts)
        except Exception:
            return None

    def _resolve_defloc_auto_timezone(
        self,
        opts,
        *,
        place=None,
        when: Optional[datetime.datetime] = None,
    ) -> Optional[dict]:
        """Resolve default-location zone fields for the actual Here-and-Now
        clock, not a winter standard-time anchor."""
        if not bool(getattr(opts, 'defloctzauto', True)):
            return None
        has_name = bool(str(getattr(opts, 'deflocname', '') or '').strip())
        has_coords = default_location_model.has_coordinates(opts)
        if not has_name and not has_coords:
            return None
        place = place or self._defloc_place(opts)
        if place is None:
            return None
        if when is None:
            when = datetime.datetime.now()
        try:
            saved_tzid = str(getattr(opts, 'defloctzid', '') or '')
            # Auto DST/TZ is coordinate-owned.  The saved tzid can belong to
            # the previously selected default city when only name/coordinates
            # were patched, so resolve the current coordinates first.
            coordinate_tzid = (
                geonames.Geonames.get_timezone_name(place.lon, place.lat)
                if has_coords
                else None
            )
            return geonames.Geonames.resolve_zone_fields(
                int(when.year), int(when.month), int(when.day),
                int(when.hour), int(when.minute), int(when.second),
                place,
                str(coordinate_tzid or saved_tzid),
            )
        except Exception:
            return None

    def _apply_defloc_auto_timezone(
        self,
        opts,
        *,
        place=None,
        when: Optional[datetime.datetime] = None,
    ) -> bool:
        info = self._resolve_defloc_auto_timezone(opts, place=place, when=when)
        if info is None:
            return False
        changed = False
        updates = {
            'deflocplus': bool(info['plus']),
            'defloczhour': int(info['zh']),
            'defloczminute': int(info['zm']),
            'deflocdst': bool(info['daylightsaving']),
            'defloctzid': str(info['tzid'] or ''),
            'defloctzauto': True,
        }
        for attr, value in updates.items():
            if getattr(opts, attr, None) != value:
                setattr(opts, attr, value)
                changed = True
        return changed

    def _read_step_alerts(self, opts) -> dict:
        """Step conjunction sound alerts (stepalertsdlg.StepAlertsDlg.fill).

        ChartSession.change_chart -> _handle_chart_alerts already runs the
        canonical chartalerts brain and calls soundfx.play_sound. This options
        group only exposes the wx dialog's configuration vectors so the Tauri
        app can edit the same sound-transit alert set."""
        prom = [bool(v) for v in getattr(opts, 'stepalerts_promplanets', [])]
        sigp = [bool(v) for v in getattr(opts, 'stepalerts_sigplanets', [])]
        siga = [bool(v) for v in getattr(opts, 'stepalerts_sigangles', [])]
        return {
            'stepalerts_enabled': bool(getattr(opts, 'stepalerts_enabled', True)),
            'stepalerts_promplanets': self._fit_bool_vector(prom, _STEP_ALERT_PROMPLANET_DEFAULTS),
            'stepalerts_sigplanets': self._fit_bool_vector(sigp, _STEP_ALERT_SIGPLANET_DEFAULTS),
            'stepalerts_sigangles': self._fit_bool_vector(siga, _STEP_ALERT_SIGANGLE_DEFAULTS),
        }

    @staticmethod
    def _fit_bool_vector(values: list[bool], defaults: tuple[bool, ...]) -> list[bool]:
        fitted = list(values[:len(defaults)])
        if len(fitted) < len(defaults):
            fitted.extend(bool(v) for v in defaults[len(fitted):])
        return fitted

    def _read_planets_points(self, opts) -> dict:
        """Options > Planets/Points remainder (Nodes / Fortuna / Syzygy /
        Arabic Parts). Scalars mirror the wx writers verbatim:
        morin.onNodes (morin.py:19846-19868), fortunedlg.check (:92-101),
        syzygydlg.check (:79-92), arabicpartsdlg.check (:2368-2381).
        The parts list is read through the wx-free arabicparts.ArabicParts
        slot helpers — the same readers PartsListCtrl.load uses
        (arabicpartsdlg.py:396-446)."""
        parts_payload = []
        ap = arabicparts.ArabicParts
        parts = list(getattr(opts, 'arabicparts', None) or [])
        ref_names = arabicparts.make_ref_name_resolver(
            parts,
            lof_name=str(mtexts.txts.get('LotOfFortune', u'Fortuna')),
        )
        for index, item in enumerate(parts):
            try:
                name = str(item[ap.NAME])
            except Exception:
                continue
            codes = arabicparts.normalize_formula_codes(
                item[ap.FORMULA] if len(item) > ap.FORMULA else None)
            trip = arabicparts.normalize_refdeg_triplet(ap.get_refdeg_triplet_base(item))
            female_codes = None
            female_trip = None
            if ap.has_female_formula(item):
                female_codes = list(arabicparts.normalize_formula_codes(item[ap.FEMALE_FORMULA]))
                try:
                    female_trip = _jsonable_refdeg(arabicparts.normalize_refdeg_triplet(item[ap.FEMALE_REFDEG]))
                except Exception:
                    female_trip = [0, 0, 0]
            nocturnal_codes = None
            nocturnal_trip = None
            nocturnal_formula = None
            if ap.has_nocturnal_formula(item):
                n_codes, n_trip = ap.get_nocturnal_formula_triplet(item, codes, trip)
                nocturnal_codes = [int(c) for c in arabicparts.normalize_formula_codes(n_codes)]
                nocturnal_trip = _jsonable_refdeg(arabicparts.normalize_refdeg_triplet(n_trip))
                nocturnal_formula = arabicparts.ArabicParts.format_formula_text(
                    item,
                    abovehorizon=False,
                    ref_names=ref_names,
                ) or ''
            parts_payload.append({
                'index': index,
                'name': name,
                # Base (male, diurnal-form) formula text, matching the wx
                # dialog's Formula column (arabicpartsdlg.py:442).
                'formula': arabicparts.ArabicParts.format_formula_text(
                    item,
                    ref_names=ref_names,
                ) or '',
                'diurnal': bool(arabicparts.ArabicParts.get_diurnal_flag(item)),
                'active': bool(arabicparts.ArabicParts.is_active_item(item)),
                'gendered': bool(arabicparts.ArabicParts.is_gendered_item(item)),
                'hasFemaleFormula': bool(arabicparts.ArabicParts.has_female_formula(item)),
                'hasNocturnalFormula': bool(arabicparts.ArabicParts.has_nocturnal_formula(item)),
                # Raw calculator state, so the skin's editor can prefill
                # without re-deriving anything (PartsListCtrl.load keeps the
                # same per-row maps — arabicpartsdlg.py:396-446).
                'codes': [int(c) for c in codes],
                'refdeg': _jsonable_refdeg(trip),
                'femaleCodes': female_codes,
                'femaleRefdeg': female_trip,
                'nocturnalCodes': nocturnal_codes,
                'nocturnalRefdeg': nocturnal_trip,
                'nocturnalFormula': nocturnal_formula,
                # The embedded-formula pack other lots' RE pickers reference
                # this row by (arabicpartsdlg.py:1453-1457).
                'embed': list(arabicparts.embedded_formula_pack(codes, trip)[:3]) + [_jsonable_refdeg(trip)],
            })
        return {
            'meannode': bool(getattr(opts, 'meannode', True)),
            'lotoffortune': int(getattr(opts, 'lotoffortune', 0) or 0),
            'syzmoon': int(getattr(opts, 'syzmoon', 0) or 0),
            'arabicpartsref': int(getattr(opts, 'arabicpartsref', 0) or 0),
            'daynightorbdeg': int(getattr(opts, 'daynightorbdeg', 0) or 0),
            'daynightorbmin': int(getattr(opts, 'daynightorbmin', 0) or 0),
            'parts': parts_payload,
        }

    def _apply_planets_points(self, opts, fields: dict) -> tuple[bool, bool]:
        """Apply the Planets/Points group. Returns (changed, parts_removed).

        parts_removed mirrors morin.onArabicParts' `rem` flag
        (morin.py:19946-19953): a removed part invalidates options.topicals."""
        changed = False
        removed = False

        if 'meannode' in fields:
            value = bool(fields['meannode'])
            if bool(getattr(opts, 'meannode', True)) != value:
                opts.meannode = value
                changed = True
        if 'lotoffortune' in fields:
            value = max(0, min(2, int(fields['lotoffortune'])))
            if int(getattr(opts, 'lotoffortune', 0) or 0) != value:
                opts.lotoffortune = value
                changed = True
        if 'syzmoon' in fields:
            value = max(0, min(2, int(fields['syzmoon'])))
            if int(getattr(opts, 'syzmoon', 0) or 0) != value:
                opts.syzmoon = value
                changed = True
        if 'arabicpartsref' in fields:
            value = max(0, min(len(mtexts.partsreftxts) - 1, int(fields['arabicpartsref'])))
            if int(getattr(opts, 'arabicpartsref', 0) or 0) != value:
                opts.arabicpartsref = value
                changed = True
        if 'daynightorbdeg' in fields:
            # IntValidator(0, 6) — arabicpartsdlg.py:980.
            value = max(0, min(6, int(fields['daynightorbdeg'])))
            if int(getattr(opts, 'daynightorbdeg', 0) or 0) != value:
                opts.daynightorbdeg = value
                changed = True
        if 'daynightorbmin' in fields:
            # IntValidator(0, 59) — arabicpartsdlg.py:992.
            value = max(0, min(59, int(fields['daynightorbmin'])))
            if int(getattr(opts, 'daynightorbmin', 0) or 0) != value:
                opts.daynightorbmin = value
                changed = True

        parts_active = fields.get('partsActive')
        if isinstance(parts_active, list):
            parts = list(getattr(opts, 'arabicparts', None) or [])
            for entry in parts_active:
                if not isinstance(entry, dict):
                    continue
                try:
                    index = int(entry['index'])
                    active = bool(entry['active'])
                except Exception:
                    continue
                if not (0 <= index < len(parts)):
                    continue
                if bool(arabicparts.ArabicParts.is_active_item(parts[index])) == active:
                    continue
                parts[index] = self._rebuild_part_with_active(parts[index], active)
                changed = True
            if changed:
                opts.arabicparts = parts

        if 'removeIndex' in fields and fields['removeIndex'] is not None:
            parts = list(getattr(opts, 'arabicparts', None) or [])
            try:
                index = int(fields['removeIndex'])
            except Exception:
                index = -1
            if 0 <= index < len(parts):
                parts.pop(index)
                opts.arabicparts = parts if parts else None
                changed = True
                removed = True

        if isinstance(fields.get('addPart'), dict):
            # OnAdd (arabicpartsdlg.py:1783-1828): max-count gate, then the
            # same row build PartsListCtrl.save serializes.
            parts = list(getattr(opts, 'arabicparts', None) or [])
            if 1 + len(parts) >= arabicparts.MAX_ARABICPARTS_NUM:
                # MaxArabicPartsNum guard (:1785-1792); count includes LoF row.
                raise ValueError(
                    str(mtexts.txts.get('MaxArabicPartsNum', 'Maximum number of parts is ')) +
                    str(arabicparts.MAX_ARABICPARTS_NUM) + '!')
            parts.append(self._build_part_from_fields(opts, fields['addPart']))
            opts.arabicparts = parts
            changed = True

        if isinstance(fields.get('updatePart'), dict):
            # OnModify (arabicpartsdlg.py:1830-1932) / _onLiveEdit (:2302-2353):
            # rewrite the selected row from the full editor state.
            spec = fields['updatePart']
            parts = list(getattr(opts, 'arabicparts', None) or [])
            try:
                index = int(spec.get('index'))
            except Exception:
                index = -1
            if 0 <= index < len(parts):
                parts[index] = self._build_part_from_fields(opts, spec, exclude_index=index)
                opts.arabicparts = parts
                changed = True

        if fields.get('removeAll'):
            # OnRemoveAll (arabicpartsdlg.py:2170-2217): delete every user part
            # (LoF is synthetic and survives); marks the removed flag so
            # topicals invalidate like single remove.
            if getattr(opts, 'arabicparts', None):
                opts.arabicparts = None
                changed = True
                removed = True

        if isinstance(fields.get('importParts'), list):
            # OnImport (arabicpartsdlg.py:2478-2660) via the extracted brain
            # parser; appends to the existing list.
            _ensure_arabic_part_tokens()
            parts = list(getattr(opts, 'arabicparts', None) or [])
            new_items, added, skipped, unresolved = arabicparts.parse_parts_json(
                fields['importParts'], parts,
                lof_name=str(mtexts.txts.get('LotOfFortune', u'Fortuna')))
            self._last_import_summary = {
                'imported': added, 'skipped': skipped, 'unresolved': unresolved,
            }
            if new_items:
                opts.arabicparts = parts + new_items
                changed = True

        if removed and getattr(opts, 'topicals', None) is not None:
            # morin.py:19950-19953 — removing a part invalidates topicals.
            opts.topicals = None

        return changed, removed

    def _build_part_from_fields(self, opts, spec: dict, exclude_index: Optional[int] = None):
        """Validate + build one options.arabicparts row from editor fields,
        enforcing the wx calculator's rules: non-empty name (PartsListCtrl.OnAdd
        arabicpartsdlg.py:276-278), 20-char cap (name ctrl SetMaxLength :1036),
        unique name across every list row including the LoF title (checkName
        :311-316; OnModify allows keeping its own name :1844-1850)."""
        _ensure_arabic_part_tokens()
        name = str(spec.get('name', '') or '').strip()[:20]
        if not name:
            raise ValueError(str(mtexts.txts.get('ArabicPartNameEmpty', 'The name must not be empty!')))
        parts = list(getattr(opts, 'arabicparts', None) or [])
        ap = arabicparts.ArabicParts
        taken = {str(mtexts.txts.get('LotOfFortune', u'Fortuna'))}
        for i, item in enumerate(parts):
            if exclude_index is not None and i == exclude_index:
                continue
            try:
                taken.add(str(item[ap.NAME]))
            except Exception:
                continue
        if name in taken:
            raise ValueError(str(mtexts.txts.get('ArabicPartAlreadyExists', 'This Arabic Part already exists!')))

        codes = self._coerce_part_codes(spec.get('codes'))
        female_codes = spec.get('femaleCodes')
        if female_codes is not None:
            female_codes = self._coerce_part_codes(female_codes)
        nocturnal_codes = spec.get('nocturnalCodes')
        if nocturnal_codes is not None:
            nocturnal_codes = self._coerce_part_codes(nocturnal_codes)
        return arabicparts.build_part_tuple(
            name, codes,
            bool(spec.get('diurnal', False)),
            spec.get('refdeg', (0, 0, 0)),
            active=bool(spec.get('active', True)),
            gendered=bool(spec.get('gendered', False)),
            female_codes=female_codes,
            female_refdeg=spec.get('femaleRefdeg', (0, 0, 0)),
            nocturnal_codes=nocturnal_codes,
            nocturnal_refdeg=spec.get('nocturnalRefdeg', (0, 0, 0)),
        )

    @staticmethod
    def _coerce_part_codes(codes) -> list:
        if not isinstance(codes, (list, tuple)) or len(codes) != 3:
            raise ValueError('codes must be a 3-item list')
        out = [int(c) for c in codes]
        for c in out:
            if c not in arabicparts.CODE_TO_NAME:
                raise ValueError('unknown formula code: %r' % (c,))
        return out

    def preview_arabic_part(self, spec: dict) -> dict:
        """Parse + format a candidate formula without writing options — the
        headless twin of the dialog's live Formula column
        (PartsListCtrl._format_formula_text, arabicpartsdlg.py:110-111; the wx
        dialog shows no computed longitude, so neither do we)."""
        _ensure_arabic_part_tokens()
        codes = self._coerce_part_codes(spec.get('codes'))
        female_codes = spec.get('femaleCodes')
        if female_codes is not None:
            female_codes = self._coerce_part_codes(female_codes)
        nocturnal_codes = spec.get('nocturnalCodes')
        if nocturnal_codes is not None:
            nocturnal_codes = self._coerce_part_codes(nocturnal_codes)
        item = arabicparts.build_part_tuple(
            str(spec.get('name', '') or 'Preview').strip() or 'Preview',
            codes,
            bool(spec.get('diurnal', False)),
            spec.get('refdeg', (0, 0, 0)),
            gendered=bool(spec.get('gendered', False)),
            female_codes=female_codes,
            female_refdeg=spec.get('femaleRefdeg', (0, 0, 0)),
            nocturnal_codes=nocturnal_codes,
            nocturnal_refdeg=spec.get('nocturnalRefdeg', (0, 0, 0)),
        )
        ap = arabicparts.ArabicParts
        ref_names = arabicparts.make_ref_name_resolver(
            getattr(self.options, 'arabicparts', None) or [],
            lof_name=str(mtexts.txts.get('LotOfFortune', u'Fortuna')),
        )
        female_text = None
        if ap.has_female_formula(item):
            female_text = ap.format_formula_text(item, male=False, ref_names=ref_names)
        nocturnal_text = None
        if ap.has_nocturnal_formula(item):
            nocturnal_text = ap.format_formula_text(item, abovehorizon=False, ref_names=ref_names)
        return {
            'formulaText': ap.format_formula_text(item, ref_names=ref_names) or '',
            'femaleFormulaText': female_text,
            'nocturnalFormulaText': nocturnal_text,
        }

    def export_arabic_parts_text(self) -> str:
        """JSON export text, byte-compatible with the wx OnExport file
        (arabicpartsdlg.py:2426-2469) via arabicparts.parts_json_text."""
        with self._lock:
            _ensure_arabic_part_tokens()
            return arabicparts.parts_json_text(
                getattr(self.options, 'arabicparts', None) or [],
                lof_name=str(mtexts.txts.get('LotOfFortune', u'Fortuna')))

    def import_arabic_parts(self, data: list) -> dict:
        """Apply a JSON import through the normal planetsPoints patch path so
        autosave + recalc fan-out behave like any other parts edit, then attach
        the wx-style imported/skipped/unresolved summary (OnImport :2652-2660)."""
        self._last_import_summary = {'imported': 0, 'skipped': 0, 'unresolved': 0}
        result = self.set_options({'planetsPoints': {'importParts': data}})
        result.update(self._last_import_summary)
        return result

    @staticmethod
    def _rebuild_part_with_active(item, active: bool):
        """Rewrite one stored Arabic-part tuple with a new ACTIVE slot,
        normalizing legacy 4-slot rows to the current 6/8-slot row exactly the
        way PartsListCtrl.save rebuilds rows (arabicpartsdlg.py:462-474)."""
        ap = arabicparts.ArabicParts
        name = item[ap.NAME]
        codes = ap._normalize_formula_triplet(
            item[ap.FORMULA] if len(item) > ap.FORMULA else None)
        diurnal = bool(ap.get_diurnal_flag(item))
        trip = ap.get_refdeg_triplet_base(item)
        try:
            gendered = bool(item[ap.GENDERED]) if (
                not ap.is_legacy_item(item) and len(item) > ap.GENDERED) else False
        except Exception:
            gendered = False
        rebuilt = [name, tuple(codes), diurnal, tuple(trip), bool(active), gendered]
        if ap.has_female_formula(item):
            female_codes = ap._normalize_formula_triplet(item[ap.FEMALE_FORMULA])
            try:
                female_trip = ap._normalize_ref_triplet(item[ap.FEMALE_REFDEG])
            except Exception:
                female_trip = (0, 0, 0)
            rebuilt.extend([tuple(female_codes), tuple(female_trip)])
        if ap.has_nocturnal_formula(item):
            while len(rebuilt) < ap.NOCTURNAL_FORMULA:
                rebuilt.append(None if len(rebuilt) == ap.FEMALE_FORMULA else (0, 0, 0))
            nocturnal_codes, nocturnal_trip = ap.get_nocturnal_formula_triplet(item, codes, trip)
            rebuilt.extend([tuple(nocturnal_codes), tuple(nocturnal_trip)])
        return tuple(rebuilt)

    def _read_theme_presets(self, opts=None, active_profile: Any = _ACTIVE_PROFILE_UNSET) -> list:
        presets = []
        if opts is not None and active_profile is _ACTIVE_PROFILE_UNSET:
            active_profile = self._style_profiles().active_profile()
        elif active_profile is _ACTIVE_PROFILE_UNSET:
            active_profile = None
        selected = _style_lab_system_preset_name(active_profile)
        if selected is None and active_profile is None and opts is not None:
            selected = _current_palette_preset_name(opts)
        modes = {
            _SYSTEM_AUTO_NAME: 'system',
            _MY_COLORS_NAME: 'custom',
            'Midnight': 'dark',
            'Daylight': 'light',
            NASA_ATLAS_PRESET_NAME: 'light',
            'Diurnal': 'light',
            'Classic Morinus': 'light',
            'Taurus': 'dark',
            'Nocturne': 'dark',
            'Sirius': 'dark',
        }
        for name in PALETTE_PRESET_NAMES:
            values = _resolve_palette_preset_values(opts, name) if opts is not None else (
                _CURRENT_COLOR_NIGHT_PRESET if name == 'Midnight' else
                _CURRENT_COLOR_DAY_PRESET if name in (
                    _SYSTEM_AUTO_NAME,
                    'Daylight',
                    NASA_ATLAS_PRESET_NAME,
                ) else
                _DIURNAL_PRESET if name == 'Diurnal' else
                _CLASSIC_MORINUS_PRESET if name == 'Classic Morinus' else
                _TAURUS_PRESET if name == 'Taurus' else
                _NOCTURNE_PRESET if name == 'Nocturne' else
                _SIRIUS_PRESET if name == 'Sirius' else {}
            )
            presets.append({
                'name': name,
                'label': _txt(_PALETTE_LABEL_KEYS[name], name) if name in _PALETTE_LABEL_KEYS else name,
                'mode': modes[name],
                'selected': name == selected,
                'chrome': {
                    attr: _rgb(values.get(attr))
                    for attr in _PALETTE_ATTR_NAMES
                    if attr in values
                },
            })
        if opts is not None:
            stored_profiles = self._style_profiles().payload().get('profiles') or []
            for profile in sorted(
                (
                    profile
                    for profile in stored_profiles
                    if (
                        isinstance(profile, dict)
                        and profile.get('id') not in BUILTIN_STYLE_PROFILE_IDS
                        and not str(profile.get('id') or '').startswith('theme-source-')
                    )
                ),
                key=lambda profile: (
                    str(profile.get('name') or '').casefold(),
                    str(profile.get('id') or ''),
                ),
            ):
                profile_id = str(profile.get('id') or '')
                if not profile_id:
                    continue
                theme = _theme_state_payload(opts, profile)
                presets.append({
                    'name': _style_profile_theme_name(profile_id),
                    'label': str(profile.get('name') or profile_id),
                    'mode': theme['mode'],
                    'selected': bool(
                        active_profile
                        and active_profile.get('id') == profile_id
                    ),
                    'chrome': {},
                })
        return presets

    # -- PATCH -------------------------------------------------------------

    @staticmethod
    def _display_refresh_mode(fields: dict) -> str:
        """Classify display-option fan-out.

        Overlay-only display controls update live options and redraw without
        rebuilding symbolic relationship charts.
        """
        keys = set(fields.keys())
        if keys.issubset(_DISPLAY_UI_STYLE_ONLY_FIELDS):
            return 'ui-style'
        if keys.issubset(_DISPLAY_TEXT_ONLY_FIELDS):
            return 'display-text'
        if keys.issubset(_DISPLAY_OVERLAY_ONLY_FIELDS):
            return 'display-overlay'
        return 'recalc'

    @staticmethod
    def _patch_affects_list_data(patch: dict) -> bool:
        """Whether an options patch can change retained list rows/queries."""
        for group, fields in patch.items():
            if not isinstance(fields, dict):
                continue
            if group == 'colors':
                continue
            if group == 'display' and set(fields).issubset(_LIST_NEUTRAL_DISPLAY_FIELDS):
                continue
            # The same stored flag is mirrored through Appearance and
            # Dignities. Showing the terms ring does not alter any list row.
            if group == 'dignities' and set(fields).issubset({'showterms'}):
                continue
            # ``housesystem`` is the small on-wheel house-system label.  It is
            # presentation even when written through the historical
            # houseSystem group rather than the display group.
            if group == 'houseSystem' and set(fields).issubset({'housesystem'}):
                continue
            return True
        return False

    def set_options(self, patch: dict) -> dict:
        """Apply a partial, grouped update to the live options object, coercing
        each field, then apply the cheapest valid refresh for the changed group.

        ``patch`` mirrors the ``get_options`` group shape, e.g.
        ``{"houseSystem": {"hsys": "R"}, "colors": {"clrtexts": [10,20,30]}}``.
        Unknown keys are ignored. Returns the resulting ``get_options()`` plus a
        ``refreshedDocumentIds`` list.
        """
        if not isinstance(patch, dict):
            raise ValueError('patch must be an object')
        with self._lock:
            opts = self.options
            changed = False
            refresh_mode: Optional[str] = None

            def request_refresh(mode: str) -> None:
                nonlocal refresh_mode
                # A full chart recompute subsumes a house-only geometry refresh.
                if mode == 'recalc' or refresh_mode is None or refresh_mode == 'ui-style':
                    refresh_mode = mode

            for group, fields in patch.items():
                if not isinstance(fields, dict):
                    continue
                if group == 'colors':
                    group_changed = self._apply_colors(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('display-overlay')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'display':
                    group_changed = self._apply_display(opts, fields)
                    if group_changed and 'fontfamily' in fields:
                        self._update_active_profile_ui_typeface(opts)
                    changed |= group_changed
                    if group_changed:
                        request_refresh(self._display_refresh_mode(fields))
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'aspectList':
                    group_changed = self._apply_aspect_list(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('retained-data')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'houseSystem':
                    group_changed = self._apply_house_system(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh(
                            'display-overlay'
                            if set(fields).issubset({'housesystem'})
                            else 'house-system'
                        )
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'ayanamsha':
                    group_changed = self._apply_ayanamsha(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'orbs':
                    group_changed = self._apply_orbs(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'dignities':
                    group_changed = self._apply_dignities(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh(
                            'display-overlay'
                            if set(fields).issubset({'showterms'})
                            else 'recalc'
                        )
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'symbols':
                    group_changed = self._apply_symbols(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'lunarMansions':
                    group_changed = self._apply_lunar_mansions(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('display-overlay')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'speculum':
                    group_changed = self._apply_speculum(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, group_changed)
                elif group == 'defaultLocation':
                    group_changed = self._apply_defloc(opts, fields)
                    changed |= group_changed
                    if group_changed:
                        request_refresh('recalc')
                elif group == 'export':
                    export_changed = self._apply_export(opts, fields)
                    changed |= export_changed
                    self._autosave_group(opts, group, fields, export_changed)
                elif group == 'primaryDirections':
                    pd_changed = self._apply_primary_directions(opts, fields)
                    changed |= pd_changed
                    if pd_changed:
                        if any(key not in _PD_IN_CHART_FIELDS for key in fields):
                            request_refresh('recalc')
                        else:
                            # Projection-only controls rebuild only open PD chart
                            # tabs through their retained binding/hook.  Radix,
                            # list and unrelated supplementary sessions stay put.
                            request_refresh('pd-in-chart')
                    self._autosave_group(opts, group, fields, pd_changed)
                elif group == 'profections':
                    prof_changed = self._apply_profections(opts, fields)
                    changed |= prof_changed
                    if prof_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, prof_changed)
                elif group == 'revolutions':
                    rev_changed = self._apply_revolutions(opts, fields)
                    changed |= rev_changed
                    if rev_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, rev_changed)
                elif group == 'quickCharts':
                    qc_changed, qc_calc_changed = self._apply_quick_charts(opts, fields)
                    changed |= qc_changed
                    if qc_changed and 'event_table_time_basis' in fields:
                        request_refresh('display-text')
                    if qc_calc_changed:
                        # Push the new progression calc values into open
                        # progression bindings BEFORE the recalc fan-out, so the
                        # rebuild uses them instead of the chart-retained ones
                        # (secdirui._on_calc passes the new value explicitly and
                        # writes the option, morin.py:18719-18737; the dialog OK
                        # then re-derives the open progression session,
                        # morin.py:20140).
                        if self._controller is not None:
                            try:
                                self._controller.apply_progression_calc_options(
                                    posfordate.progression_angle_method(
                                        getattr(opts, 'progressed_angle_method', posfordate.TRUE_SOLAR_ARC_LON)),
                                    posfordate.progression_day_type(
                                        getattr(opts, 'progression_day_type', posfordate.PROGRESSION_DAY_TYPE_Q2)),
                                )
                            except Exception:
                                pass
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, qc_changed)
                elif group == 'stepAlerts':
                    step_changed = self._apply_step_alerts(opts, fields)
                    changed |= step_changed
                    if step_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, step_changed)
                elif group == 'almutens':
                    alm_changed = self._apply_almutens(opts, fields)
                    changed |= alm_changed
                    if alm_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, alm_changed)
                elif group == 'firdaria':
                    fir_changed = self._apply_firdaria(opts, fields)
                    changed |= fir_changed
                    if fir_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, fir_changed)
                elif group == 'eclipses':
                    ecl_changed = self._apply_eclipses(opts, fields)
                    changed |= ecl_changed
                    if ecl_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, ecl_changed)
                elif group == 'fixedStars':
                    fs_changed = self._apply_fixed_stars(opts, fields)
                    changed |= fs_changed
                    if fs_changed:
                        # Mirror morin.onFixStarsOpt: rebuild the in-memory
                        # fixstars set on every open chart object BEFORE the
                        # recalc fan-out, since Chart.recalc alone keeps the stale
                        # star set (morin.py:20080; chart.py:616,1883).
                        self._rebuild_fixstars_on_open_charts()
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, fs_changed)
                elif group == 'relationshipCharts':
                    rel_changed = self._apply_relationship_charts(opts, fields)
                    changed |= rel_changed
                    if rel_changed:
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, rel_changed)
                elif group == 'languages':
                    lang_changed = self._apply_languages(opts, fields)
                    changed |= lang_changed
                    if lang_changed:
                        # Language changes affect labels, dates, titles and the
                        # selected font profile, not positions/houses/bindings.
                        # A full recalc can reset derived/comparison cursors;
                        # display-text emits fresh session metadata and causes
                        # every text-bearing frontend surface to refetch.
                        request_refresh('display-text')
                    self._autosave_group(opts, group, fields, lang_changed)
                elif group == 'planetsPoints':
                    pp_changed, _pp_removed = self._apply_planets_points(opts, fields)
                    changed |= pp_changed
                    if pp_changed:
                        # wx refreshes each writer with full recomputes
                        # (setNodes/calcFortune/calcSyzygy/calcArabicParts +
                        # aspect/almuten recalcs, morin.py:19862-19999); the
                        # daemon's Chart.recalc fan-out subsumes all of them.
                        request_refresh('recalc')
                    self._autosave_group(opts, group, fields, pp_changed)
            resolved_refresh_mode = refresh_mode or 'recalc'
            refreshed = (
                []
                if resolved_refresh_mode in {'ui-style', 'retained-data'}
                else self._refresh_all(resolved_refresh_mode) if refresh_mode else []
            )
        result = self.get_options()
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = resolved_refresh_mode if refresh_mode else None
        result['listDataChanged'] = self._patch_affects_list_data(patch)
        return result

    def _update_active_profile_ui_typeface(self, opts) -> bool:
        """Persist Settings' typeface choice into the active app theme.

        A combined/app profile is the final CSS authority, so changing only the
        legacy option would appear to do nothing until that profile was
        deactivated. Keep the normal Settings control authoritative by editing
        the active theme in place; chart-only profiles continue to inherit the
        legacy application typeface.
        """
        store = self._style_profiles()
        profile = store.active_profile()
        if not profile or profile.get('scope') not in ('app', 'combined'):
            return False
        overrides = copy.deepcopy(profile.get('overrides') or {})
        font_stack = _web_text_font_stack(opts)
        if overrides.get('app.type.familyUi') == font_stack:
            return False
        overrides['app.type.familyUi'] = font_stack
        updated = copy.deepcopy(profile)
        updated['overrides'] = overrides
        updated.pop('contentHash', None)
        self._validate_style_profile_base(updated)
        store.upsert(updated, activate=True)
        return True

    def set_revolutions_scoped(self, fields: dict) -> dict:
        """Apply Revolutions options without the global open-document refresh.

        The sidebar/tab Marr row follows ``morin._toggle_session_marr_flag``:
        write the option, clear Revolution caches, then rebuild the clicked return
        session in place. Settings still use ``set_options({"revolutions": ...})``
        for full fan-out.
        """
        if not isinstance(fields, dict):
            raise ValueError('fields must be an object')
        with self._lock:
            changed = self._apply_revolutions(self.options, fields)
            self._autosave_group(self.options, 'revolutions', fields, changed)
        result = self.get_options()
        result['changed'] = changed
        result['refreshedDocumentIds'] = []
        return result

    def _autosave_group(self, opts, group: str, fields: dict, changed: bool) -> None:
        """Persist the same option file(s) the wx handler persists."""
        if not changed:
            return
        # The presentation cursor has no visible Apply/Save control. A direct
        # hidden-option patch is therefore an explicit persistence request even
        # when the legacy global autosave preference is disabled.
        force_presentation_save = group == 'display' and 'presentation_cursor' in fields
        if not force_presentation_save and not getattr(opts, 'autosave', False):
            return

        savers: list[str] = []
        if group == 'colors':
            savers.append('saveColors')
        elif group == 'display':
            savers.append('saveAppearance1')
            if 'fontfamily' in fields:
                savers.append('saveLanguages')
        elif group == 'aspectList':
            savers.append('saveAppearance1')
        elif group == 'export':
            savers.append('saveAppearance1')
        elif group == 'houseSystem':
            savers.append('saveHouseSystem')
        elif group in ('ayanamsha', 'lunarMansions'):
            savers.append('saveAyanamsa')
        elif group == 'orbs':
            if any(attr in fields for attr in (*_ORB_MATRIX_FIELDS, *_ORB_VECTOR_FIELDS, *_ORB_SCALAR_FIELDS)):
                savers.append('saveOrbs')
            if 'fixstarsOrbAll' in fields or 'fixstarsOrb' in fields:
                savers.append('saveFixstars')
        elif group == 'dignities':
            if any(attr in fields for attr in _DIGNITY_BOOL_FIELDS):
                savers.append('saveAppearance1')
            if 'dignityscores' in fields:
                savers.append('saveChartAlmuten')
            if 'dignities' in fields:
                savers.append('saveDignities')
            if 'selterm' in fields or 'terms' in fields:
                savers.append('saveTerms')
        elif group == 'symbols':
            savers.append('saveSymbols')
        elif group == 'speculum':
            savers.append('saveAppearance2')
        elif group == 'primaryDirections':
            if any(key not in _PD_IN_CHART_FIELDS for key in fields):
                savers.extend(('savePrimaryDirs', 'savePrimaryKeys'))
            if any(key in _PD_IN_CHART_FIELDS for key in fields):
                savers.append('savePDsInChart')
        elif group == 'profections':
            savers.append('saveProfections')
        elif group == 'revolutions':
            savers.append('saveRevolutions')
        elif group == 'quickCharts':
            savers.append('saveQuickCharts')
        elif group == 'stepAlerts':
            savers.append('saveStepAlerts')
        elif group == 'almutens':
            savers.append('saveChartAlmuten')
        elif group == 'firdaria':
            savers.append('saveFirdaria')
        elif group == 'eclipses':
            # eclipse_chart_moment persists inside the quickcharts.opt pickle
            # (options.saveQuickCharts, options.py:2734).
            savers.append('saveQuickCharts')
        elif group == 'fixedStars':
            # FixStarsDlg.check persists the active star set via saveFixstars
            # (fixstarsdlg.py:546-547; options.saveFixstars options.py:2586).
            savers.append('saveFixstars')
        elif group == 'relationshipCharts':
            savers.append('saveComposite')
        elif group == 'languages':
            savers.append('saveLanguages')
        elif group == 'planetsPoints':
            # Per-field saver parity with the four wx handlers
            # (morin.py:19859/19916/19956/19992).
            if 'meannode' in fields:
                savers.append('saveNodes')
            if 'lotoffortune' in fields:
                savers.append('saveFortune')
            if 'syzmoon' in fields:
                savers.append('saveSyzygy')
            if any(attr in fields for attr in (
                    'arabicpartsref', 'daynightorbdeg', 'daynightorbmin',
                    'partsActive', 'removeIndex', 'addPart', 'updatePart',
                    'removeAll', 'importParts')):
                savers.append('saveTopicalandParts')

        self._run_autosave_methods(opts, savers)

    def _run_autosave_methods(self, opts, method_names: list[str]) -> None:
        seen: set[str] = set()
        for name in method_names:
            if name in seen:
                continue
            seen.add(name)
            saver = getattr(opts, name, None)
            if saver is None:
                continue
            try:
                saver()
            except Exception:
                pass

    def _apply_colors(self, opts, fields: dict) -> bool:
        changed = False
        manual_palette_change = False
        follow_requested = bool(fields.get('follow_os_theme')) if 'follow_os_theme' in fields else False
        for attr in _COLOR_RGB_FIELDS:
            if attr in fields:
                rgb = _coerce_rgb(fields[attr])
                if rgb is not None and getattr(opts, attr, None) != rgb:
                    setattr(opts, attr, rgb)
                    changed = True
                    manual_palette_change = True
        for attr in _COLOR_LIST_FIELDS:
            if attr in fields and isinstance(fields[attr], (list, tuple)):
                list_changed = _set_color_list_attr(opts, attr, fields[attr])
                changed |= list_changed
                manual_palette_change |= list_changed
        for attr in _COLOR_BOOL_FIELDS:
            if attr not in fields:
                continue
            if attr == 'follow_os_theme':
                if follow_requested:
                    changed |= _apply_palette_values(
                        opts,
                        _SYSTEM_AUTO_NAME,
                        _resolve_palette_preset_values(opts, _SYSTEM_AUTO_NAME),
                    )
                elif bool(getattr(opts, attr, True)):
                    setattr(opts, attr, False)
                    changed = True
                continue
            new = bool(fields[attr])
            if bool(getattr(opts, attr, False)) != new:
                setattr(opts, attr, new)
                changed = True
                manual_palette_change = True
        if manual_palette_change and not follow_requested:
            if bool(getattr(opts, 'follow_os_theme', True)):
                opts.follow_os_theme = False
                changed = True
            _maybe_update_custom_palette(opts)
        return changed

    def _apply_display(self, opts, fields: dict) -> bool:
        changed = False
        for attr in _DISPLAY_BOOL_FIELDS:
            if attr in fields:
                setattr(opts, attr, bool(fields[attr]))
                changed = True
        for attr in _DISPLAY_INT_FIELDS:
            if attr in fields:
                try:
                    value = int(fields[attr])
                    if attr == 'synodicmode' and value not in (0, 1):
                        continue
                    if attr == 'theme' and value not in (0, 1, 2):
                        continue
                    setattr(opts, attr, value)
                    changed = True
                except (TypeError, ValueError):
                    pass
        # Fixed-length bool vectors (aspect[12] / transcendental[3]): assign
        # element-wise so per-index draw toggles round-trip; ignore length drift.
        for attr in _DISPLAY_BOOL_VECTOR_FIELDS:
            if attr in fields and isinstance(fields[attr], (list, tuple)):
                existing = getattr(opts, attr, None)
                incoming = [bool(v) for v in fields[attr]]
                if isinstance(existing, list) and len(existing) == len(incoming):
                    for i, v in enumerate(incoming):
                        existing[i] = v
                else:
                    setattr(opts, attr, incoming)
                changed = True
        if bool(getattr(opts, 'traditionalaspects', False)) and (
            'traditionalaspects' in fields or 'aspect' in fields
        ):
            aspects = getattr(opts, 'aspect', None)
            if isinstance(aspects, list):
                for i in _MINOR_ASPECT_INDICES:
                    if i < len(aspects) and bool(aspects[i]):
                        aspects[i] = False
                        changed = True
        for attr in _DISPLAY_INT_SLIDER_FIELDS:
            if attr in fields:
                try:
                    setattr(opts, attr, int(round(float(fields[attr]))))
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _DISPLAY_FLOAT_SLIDER_FIELDS:
            if attr in fields:
                try:
                    setattr(opts, attr, float(fields[attr]))
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _DISPLAY_ENUM_STR_FIELDS:
            if attr in fields:
                val = str(fields[attr])
                if attr == 'keyprompts_style' and val not in _KEYPROMPT_STYLE_CATALOG:
                    continue
                if attr == 'dateconvention':
                    val = dateformat.coerce_date_convention(val)
                if attr == 'anglo_dense_label_layout' and val not in _ANGLO_DENSE_LABEL_LAYOUT_VALUES:
                    continue
                setattr(opts, attr, val)
                changed = True
        if 'fontfamily' in fields:
            opts.fontfamily = _coerce_font_profile(fields['fontfamily'])
            changed = True
        return changed

    @staticmethod
    def _apply_aspect_list(opts, fields: dict) -> bool:
        if 'showAspectsForDerivedPoints' not in fields:
            return False
        value = bool(fields['showAspectsForDerivedPoints'])
        if bool(getattr(opts, 'showaspectsforderivedpoints', False)) == value:
            return False
        opts.showaspectsforderivedpoints = value
        return True

    def _apply_export(self, opts, fields: dict) -> bool:
        changed = False
        if 'pngChartAppearance' in fields:
            appearance = str(fields['pngChartAppearance'] or '')
            if (
                appearance in _PNG_CHART_APPEARANCE_VALUES
                and str(getattr(opts, 'png_chart_appearance', 'screen')) != appearance
            ):
                opts.png_chart_appearance = appearance
                changed = True
        if 'pngIncludeOverlays' in fields:
            include = bool(fields['pngIncludeOverlays'])
            if bool(getattr(opts, 'png_include_overlays', True)) != include:
                opts.png_include_overlays = include
                changed = True
        if 'pdfChartColorMode' in fields:
            mode = str(fields['pdfChartColorMode'] or '')
            if mode in _PDF_CHART_COLOR_MODE_VALUES and str(getattr(opts, 'pdf_chart_color_mode', 'monochrome')) != mode:
                opts.pdf_chart_color_mode = mode
                changed = True
        if 'pdfChartRasterPreset' in fields:
            preset = str(fields['pdfChartRasterPreset'] or '')
            if preset in _PDF_CHART_RASTER_PRESET_VALUES and str(getattr(opts, 'pdf_chart_raster_preset', 'clean')) != preset:
                opts.pdf_chart_raster_preset = preset
                changed = True
        if 'pdfIncludeOverlays' in fields:
            include = bool(fields['pdfIncludeOverlays'])
            if bool(getattr(opts, 'pdf_include_overlays', True)) != include:
                opts.pdf_include_overlays = include
                changed = True
        if 'listExportAspectSymbols' in fields:
            include = bool(fields['listExportAspectSymbols'])
            if bool(getattr(opts, 'list_export_aspect_symbols', False)) != include:
                opts.list_export_aspect_symbols = include
                changed = True
        return changed

    def _apply_house_system(self, opts, fields: dict) -> bool:
        changed = False
        if 'hsys' in fields:
            code = str(fields['hsys'])
            if code in houses.Houses.hsystems:
                opts.hsys = code
                # Mirror onHouseSystem side-effects (morin.py:19819/19837/19840).
                if code == 'N':
                    opts.housesystem = False
                else:
                    if not bool(getattr(opts, 'houses', False)):
                        opts.houses = True
                    if code == 'W':
                        opts.housesystem = True
                changed = True
            else:
                raise ValueError(f'unknown house system code: {code!r}')
        if 'housesystem' in fields:
            opts.housesystem = bool(fields['housesystem'])
            changed = True
        return changed

    def _apply_ayanamsha(self, opts, fields: dict) -> bool:
        if 'ayanamsha' in fields:
            try:
                idx = int(fields['ayanamsha'])
            except (TypeError, ValueError):
                raise ValueError('ayanamsha must be an integer index')
            try:
                count = len(mtexts.ayanamshalist)
            except Exception:
                count = idx + 1
            if not (0 <= idx < count):
                raise ValueError(f'ayanamsha index out of range: {idx}')
            opts.ayanamsha = idx
            return True
        return False

    def _apply_orbs(self, opts, fields: dict) -> bool:
        changed = False
        for attr in _ORB_MATRIX_FIELDS:
            if attr in fields and isinstance(fields[attr], (list, tuple)):
                try:
                    setattr(opts, attr, [[float(v) for v in row] for row in fields[attr]])
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _ORB_VECTOR_FIELDS:
            if attr in fields and isinstance(fields[attr], (list, tuple)):
                try:
                    setattr(opts, attr, [float(v) for v in fields[attr]])
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _ORB_SCALAR_FIELDS:
            if attr in fields:
                try:
                    setattr(opts, attr, float(fields[attr]))
                    changed = True
                except (TypeError, ValueError):
                    pass
        # Fixed-star "all stars" orb — set every star's orb to one value, the
        # headless analogue of fixstarsorbdlg's "All" button
        # (fixstarsorbdlg.py:138-155).
        if 'fixstarsOrbAll' in fields:
            try:
                val = float(fields['fixstarsOrbAll'])
            except (TypeError, ValueError):
                val = None
            if val is not None and 0.0 <= val <= 6.0:
                fs = getattr(opts, 'fixstars', None)
                if isinstance(fs, dict) and fs:
                    for name in list(fs.keys()):
                        fs[name] = val
                    changed = True
        # Fixed-star single-row orb — fixstarsorbdlg.onOK writes the selected
        # star into options.fixstars and saveFixstars() handles persistence.
        if 'fixstarsOrb' in fields and isinstance(fields['fixstarsOrb'], dict):
            payload = fields['fixstarsOrb']
            name = payload.get('name')
            try:
                val = float(payload.get('orb'))
            except (TypeError, ValueError):
                val = None
            fs = getattr(opts, 'fixstars', None)
            if isinstance(name, str) and val is not None and 0.0 <= val <= 6.0 and isinstance(fs, dict) and name in fs:
                if float(fs[name]) != val:
                    fs[name] = val
                    changed = True
        return changed

    def _apply_dignities(self, opts, fields: dict) -> bool:
        changed = False
        for attr in _DIGNITY_BOOL_FIELDS:
            if attr in fields:
                setattr(opts, attr, bool(fields[attr]))
                changed = True
        for attr in _DIGNITY_INT_FIELDS:
            if attr in fields:
                try:
                    setattr(opts, attr, int(fields[attr]))
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _DIGNITY_LIST_FIELDS:
            if attr in fields and isinstance(fields[attr], (list, tuple)):
                try:
                    setattr(opts, attr, [int(v) for v in fields[attr]])
                    changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _DIGNITY_TABLE_FIELDS:
            if attr in fields and isinstance(fields[attr], list):
                setattr(opts, attr, fields[attr])
                changed = True
        return changed

    def _apply_symbols(self, opts, fields: dict) -> bool:
        """Patch the glyph-variant settings (symbolsdlg.SymbolsDlg.check), then
        resync ``common.common`` so the live glyph map reflects the new variant.

        symbolsdlg's OK handler calls ``common.common.update(options)``
        (symbolsdlg.py:173) to rebuild ``common.Planets`` after a variant change
        (the Uranus/Pluto glyph chars come from there — common.py:388-393). The
        chart snapshot only re-runs ``update`` at process init
        (export_chart_json.py:139), so a runtime variant change would not take
        effect on re-render unless we resync here. ``pluto`` is clamped to the
        0..3 range the dialog offers (symbolsdlg.py:212-219)."""
        changed = False
        for attr in _SYMBOL_BOOL_FIELDS:
            if attr in fields:
                setattr(opts, attr, bool(fields[attr]))
                changed = True
        for attr in _SYMBOL_INT_FIELDS:
            if attr in fields:
                try:
                    val = int(fields[attr])
                except (TypeError, ValueError):
                    continue
                if attr == 'pluto':
                    val = max(0, min(3, val))
                setattr(opts, attr, val)
                changed = True
        if changed:
            # Rebuild common.Planets from the new variant choices — the headless
            # analogue of symbolsdlg's common.common.update(options). Reached via
            # the already-imported export_chart_json (chart_service.py:14) so the
            # daemon needn't import the wx-laden common module directly.
            try:
                from webapp.frontend.scripts import export_chart_json
                export_chart_json.common.common.update(opts)
            except Exception:
                pass
        return changed

    def _apply_lunar_mansions(self, opts, fields: dict) -> bool:
        """Patch mansion frame and inspector visibility display options."""
        changed = False
        if 'manazil_zodiac' in fields:
            val = str(fields['manazil_zodiac'])
            if (
                val in _MANSION_ZODIAC_VALUES
                and str(getattr(opts, 'manazil_zodiac', 'auto')) != val
            ):
                opts.manazil_zodiac = val
                changed = True
        if 'show_manzil_in_inspector' in fields:
            visible = bool(fields['show_manzil_in_inspector'])
            if bool(getattr(opts, 'show_manzil_in_inspector', True)) != visible:
                opts.show_manzil_in_inspector = visible
                changed = True
        return changed

    def _apply_speculum(self, opts, fields: dict) -> bool:
        """Patch the speculum column-visibility settings (appearance2dlg.check,
        appearance2dlg.py:288-348). Assigns element-wise into the existing
        options.speculums[row][col] bool matrix + speculumdodecat[2] + intime so
        the engine's speculum tables (which read these flags) reflect the change."""
        changed = False
        specs = getattr(opts, 'speculums', None)
        dodecat = getattr(opts, 'speculumdodecat', None)
        placidian = fields.get('placidian')
        if isinstance(placidian, dict) and isinstance(specs, list) and len(specs) > _SPECULUM_PLACIDIAN:
            row = specs[_SPECULUM_PLACIDIAN]
            for c in _SPECULUM_PLACIDIAN_COLS:
                key = str(c['idx'])
                if key in placidian and c['idx'] < len(row):
                    new = bool(placidian[key])
                    if bool(row[c['idx']]) != new:
                        row[c['idx']] = new
                        changed = True
        regio = fields.get('regiomontan')
        if isinstance(regio, dict) and isinstance(specs, list) and len(specs) > _SPECULUM_REGIOMONTAN:
            row = specs[_SPECULUM_REGIOMONTAN]
            for c in _SPECULUM_REGIOMONTAN_COLS:
                key = str(c['idx'])
                if key in regio and c['idx'] < len(row):
                    new = bool(regio[key])
                    if bool(row[c['idx']]) != new:
                        row[c['idx']] = new
                        changed = True
        if isinstance(dodecat, list):
            if 'placidianDodec' in fields and len(dodecat) > _SPECULUM_PLACIDIAN:
                new = bool(fields['placidianDodec'])
                if bool(dodecat[_SPECULUM_PLACIDIAN]) != new:
                    dodecat[_SPECULUM_PLACIDIAN] = new
                    changed = True
            if 'regiomontanDodec' in fields and len(dodecat) > _SPECULUM_REGIOMONTAN:
                new = bool(fields['regiomontanDodec'])
                if bool(dodecat[_SPECULUM_REGIOMONTAN]) != new:
                    dodecat[_SPECULUM_REGIOMONTAN] = new
                    changed = True
        if 'intime' in fields:
            new = bool(fields['intime'])
            if bool(getattr(opts, 'intime', False)) != new:
                opts.intime = new
                changed = True
        return changed

    def _apply_defloc(self, opts, fields: dict) -> bool:
        """Patch the saved default-location def* fields, then persist to
        ``deflocation.opt`` via ``options.saveDefLocation`` (the same writer the
        wx dialog's OK uses — wx-free on the success path). The 20-char name cap
        mirrors defaultlocdlg's hidden backing field (defaultlocdlg.py:149).
        When Auto DST/TZ is enabled, normalize the saved zone fields against
        the current Here-and-Now clock so summer locations do not stay on a
        winter no-DST anchor."""
        changed = False
        coordinate_fields_changed = False
        for attr in _DEFLOC_STR_FIELDS:
            if attr in fields:
                val = str(fields[attr] or '')
                if attr == 'deflocname':
                    val = val[:20]
                setattr(opts, attr, val)
                changed = True
        for attr in _DEFLOC_INT_FIELDS:
            if attr in fields:
                try:
                    setattr(opts, attr, int(fields[attr]))
                    changed = True
                    if attr in {
                        'defloclondeg', 'defloclonmin',
                        'defloclatdeg', 'defloclatmin',
                    }:
                        coordinate_fields_changed = True
                except (TypeError, ValueError):
                    pass
        for attr in _DEFLOC_BOOL_FIELDS:
            if attr in fields:
                setattr(opts, attr, bool(fields[attr]))
                changed = True
                if attr in {'defloceast', 'deflocnorth'}:
                    coordinate_fields_changed = True
        exact_updates = {}
        for attr in _DEFLOC_FLOAT_FIELDS:
            if attr not in fields:
                continue
            try:
                exact_updates[attr] = float(fields[attr])
            except (TypeError, ValueError):
                continue
        if exact_updates:
            current_lon, current_lat = default_location_model.coordinates(opts)
            default_location_model.apply_exact_coordinates(
                opts,
                exact_updates.get('defloclon', current_lon),
                exact_updates.get('defloclat', current_lat),
            )
            changed = True
        elif coordinate_fields_changed:
            default_location_model.apply_legacy_coordinates(opts)
        if self._apply_defloc_auto_timezone(opts):
            changed = True
        if changed:
            # Persist like the desktop dialog's OK handler (morin saves
            # deflocation.opt after DefaultLocDlg accepts). Best-effort; a write
            # failure must not break the in-memory patch / re-render.
            try:
                opts.saveDefLocation()
            except Exception:
                pass
        return changed

    def _apply_step_alerts(self, opts, fields: dict) -> bool:
        """Patch StepAlertsDlg.check fields (stepalertsdlg.py:96-113).

        The vectors are fixed to the daemon catalog lengths. Assign into the
        existing option lists where possible so any existing references held by
        ChartSession/chartalerts continue to observe the updated values."""
        changed = False
        if 'stepalerts_enabled' in fields:
            new = bool(fields['stepalerts_enabled'])
            if bool(getattr(opts, 'stepalerts_enabled', True)) != new:
                opts.stepalerts_enabled = new
                changed = True

        for attr, defaults in (
            ('stepalerts_promplanets', _STEP_ALERT_PROMPLANET_DEFAULTS),
            ('stepalerts_sigplanets', _STEP_ALERT_SIGPLANET_DEFAULTS),
            ('stepalerts_sigangles', _STEP_ALERT_SIGANGLE_DEFAULTS),
        ):
            if attr not in fields or not isinstance(fields[attr], (list, tuple)):
                continue
            count = len(defaults)
            incoming = self._fit_bool_vector([bool(v) for v in fields[attr]], defaults)
            existing = getattr(opts, attr, None)
            if isinstance(existing, list):
                if existing[:count] != incoming or len(existing) != count:
                    existing[:] = incoming
                    changed = True
            else:
                setattr(opts, attr, incoming)
                changed = True
        return changed

    # -- THEME -------------------------------------------------------------

    def apply_theme_preset(self, name: str) -> dict:
        """Apply a complete built-in or saved theme, then redraw charts."""
        profile_id = _style_profile_id_from_theme_name(name)
        if profile_id is None and name not in PALETTE_PRESET_NAMES:
            raise ValueError(f'unknown palette preset: {name!r}')
        with self._lock:
            opts = self.options
            store = self._style_profiles()
            before_profile = store.active_profile()
            palette_changed = False
            if profile_id is not None:
                profile = store.profile(profile_id)
                self._validate_style_profile_base(profile)
                store.activate(profile_id)
            elif name in BUILTIN_STYLE_PRESET_NAMES:
                profile = self._style_lab_theme_profile(name)
                self._validate_style_profile_base(profile)
                store.upsert(profile, activate=True)
            else:
                try:
                    profile = store.profile(_style_lab_system_profile_id(name))
                except StyleProfileError:
                    profile = None
                if profile is not None:
                    self._validate_style_profile_base(profile)
                    store.activate(str(profile['id']))
                else:
                    if before_profile is not None:
                        store.activate(None)
                    palette_changed = _apply_palette_values(
                        opts,
                        name,
                        _resolve_palette_preset_values(opts, name),
                    )
                    if name != _SYSTEM_AUTO_NAME and palette_changed:
                        _maybe_update_custom_palette(opts)
                    self._autosave_group(opts, 'colors', {}, palette_changed)
            after_profile = store.active_profile()
            changed = (
                palette_changed
                or self._active_style_profile_changed(before_profile, after_profile)
            )
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode) if changed else []
        result = self.get_options()
        result['appliedPreset'] = name
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode if changed else None
        return result

    def reset_color_defaults(self) -> dict:
        """Restore the colorsdlg Restore Default palette and redraw charts."""
        with self._lock:
            opts = self.options
            values = _factory_default_palette_state(opts)
            changed = False
            if bool(getattr(opts, 'follow_os_theme', True)):
                opts.follow_os_theme = False
                changed = True
            for attr in _PALETTE_ATTR_NAMES:
                if attr in values and getattr(opts, attr, None) != values[attr]:
                    setattr(opts, attr, values[attr])
                    changed = True
            if 'clrindividual' in values:
                changed |= _set_color_list_attr(opts, 'clrindividual', values['clrindividual'])
            if 'clraspect' in values:
                changed |= _set_color_list_attr(opts, 'clraspect', values['clraspect'])
            for attr in ('useplanetcolors', 'usezodiacelementcolors'):
                if attr in values:
                    new = bool(values[attr])
                    if bool(getattr(opts, attr, False)) != new:
                        setattr(opts, attr, new)
                        changed = True
            self._autosave_group(opts, 'colors', {}, changed)
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode) if changed else []
        result = self.get_options()
        result['resetColors'] = True
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode if changed else None
        return result

    def reset_all_defaults(self) -> dict:
        """Restore Default — headless analogue of morin.onReload (morin.py:21034).

        Delete the persisted user option pickles (options.removeOptsFiles),
        clear personal/session-only values through ``options.reload``, then load
        the bundled ``Res/Opts`` files so Restore Default and a fresh install
        share one factory baseline. Finally resync the live glyph map (the
        headless twin of common.common.update, reached through the
        already-imported export_chart_json so the daemon needn't import wx) and
        re-render every open chart with a full recalc. Returns the resulting
        options + refreshedDocumentIds."""
        with self._lock:
            opts = self.options
            try:
                self._style_profiles().activate(None)
            except StyleProfileError:
                # A preserved corrupt optional profile file must not block the
                # canonical options reset or chart recovery path.
                pass
            try:
                if opts.checkOptsFiles():
                    opts.removeOptsFiles()
            except Exception:
                pass
            opts.reload()
            opts.load()
            try:
                from webapp.frontend.scripts import export_chart_json
                export_chart_json.common.common.update(opts)
            except Exception:
                pass
            refresh_mode = 'recalc'
            refreshed = self._refresh_all(refresh_mode)
        result = self.get_options()
        result['resetAll'] = True
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode
        return result

    # -- RADIX SECONDARY-VIEW CYCLE ----------------------------------------

    # Cycle order verbatim from morin._cycle_natal_secondary_ring
    # (morin.py:983-993). Values are the options.Options secondary-view enum ints
    # (options.py:47-68), mirrored wx-free. Advancing `showfixstars` to the next
    # member and re-rendering IS the headless cycle: Chart.recalc()->create()
    # (chart.py:1883-1904) dels+rebuilds fixstars/midpoints/antiscia from the new
    # showfixstars, exactly what _apply_radix_overlay_mode does eagerly
    # (morin.py:754-780) before drawBkg/Refresh.
    _RADIX_SECONDARY_CYCLE = (
        4,  # Options.DODECATEMORIA
        5,  # Options.ARABICPARTS
        1,  # Options.FIXSTARS
        6,  # Options.ASTEROIDS
        7,  # Options.MIDPOINTS
        8,  # Options.HYBRID_HITS
        2,  # Options.ANTIS
        3,  # Options.CANTIS
        0,  # Options.NONE
    )

    def cycle_radix_secondary(self) -> dict:
        """Advance the radix secondary-view overlay one step and re-render —
        headless analogue of morin.onCycleNatalSecondaryRing (morin.py:1001) /
        _cycle_natal_secondary_ring (:978-999). Reads the current global
        ``options.showfixstars``, finds it in the cycle order, sets the next
        member, then refreshes all open charts (the recalc rebuilds the overlay).
        Returns the resulting options + refreshedDocumentIds + the new mode."""
        with self._lock:
            opts = self.options
            current = int(getattr(opts, 'showfixstars', 0) or 0)
            try:
                index = self._RADIX_SECONDARY_CYCLE.index(current)
            except ValueError:
                index = 0
            new_value = self._RADIX_SECONDARY_CYCLE[
                (index + 1) % len(self._RADIX_SECONDARY_CYCLE)
            ]
            opts.showfixstars = new_value
            self._autosave_group(opts, 'display', {'showfixstars': new_value}, True)
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode)
        result = self.get_options()
        result['showfixstars'] = new_value
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode
        result['listDataChanged'] = True
        return result

    def toggle_houses(self) -> dict:
        """Flip the Appearance1 "Houses" option (draw house cusps / division
        lines) — headless analogue of morin.onToggleHouses (morin.py:19535).
        Reads the current global ``options.houses``, inverts it, persists via
        ``saveAppearance1`` when autosave is on (matching the desktop), then
        invalidates open chart snapshots without rebuilding chart semantics.
        Returns the resulting options + the new value + refreshedDocumentIds."""
        with self._lock:
            opts = self.options
            new_value = not bool(getattr(opts, 'houses', True))
            opts.houses = new_value
            if getattr(opts, 'autosave', False):
                try:
                    opts.saveAppearance1()
                except Exception:
                    pass
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode)
        result = self.get_options()
        result['houses'] = new_value
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode
        return result

    def toggle_aspects(self) -> dict:
        """Flip the Appearance1 "Aspects" draw master without changing prefs."""
        with self._lock:
            opts = self.options
            new_value = not bool(getattr(opts, 'aspects', True))
            opts.aspects = new_value
            self._autosave_group(
                opts,
                'display',
                {'aspects': opts.aspects},
                True,
            )
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode)
        result = self.get_options()
        result['aspects'] = new_value
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode
        result['listDataChanged'] = True
        return result

    def toggle_minor_aspects(self) -> dict:
        """Flip the visible minor-aspect state as one group.

        Minor aspects are the non-Ptolemaic aspect slots in ``options.aspect``:
        semisextile, semisquare, quintile, sesquisquare, biquintile, quincunx,
        and septile. Turning them on also enables the Aspects master and exits
        Traditional mode, because Traditional mode suppresses every minor aspect
        regardless of the vector state. Major aspect slots are left unchanged.
        """
        with self._lock:
            opts = self.options
            aspects = getattr(opts, 'aspect', None)
            if not isinstance(aspects, list):
                aspects = list(aspects or [])
                opts.aspect = aspects
            visible_now = (
                bool(getattr(opts, 'aspects', True)) and
                not bool(getattr(opts, 'traditionalaspects', False)) and
                all(
                    i < len(aspects) and bool(aspects[i])
                    for i in _MINOR_ASPECT_INDICES
                )
            )
            new_value = not visible_now
            changed = False
            if new_value and not bool(getattr(opts, 'aspects', True)):
                opts.aspects = True
                changed = True
            if new_value and bool(getattr(opts, 'traditionalaspects', False)):
                opts.traditionalaspects = False
                changed = True
            for i in _MINOR_ASPECT_INDICES:
                if i >= len(aspects):
                    continue
                if bool(aspects[i]) != new_value:
                    aspects[i] = new_value
                    changed = True
            self._autosave_group(
                opts,
                'display',
                {'aspects': opts.aspects, 'traditionalaspects': opts.traditionalaspects, 'aspect': aspects},
                changed,
            )
            refresh_mode = 'display-overlay'
            refreshed = self._refresh_all(refresh_mode) if changed else []
        result = self.get_options()
        result['minorAspects'] = new_value
        result['refreshedDocumentIds'] = refreshed
        result['refreshMode'] = refresh_mode if changed else None
        result['listDataChanged'] = changed
        return result

    # -- RE-RENDER ---------------------------------------------------------

    def _refresh_all(self, mode: str = 'recalc') -> list:
        """Re-render every open chart — headless settings refresh fan-out.

        ``mode='house-system'`` mirrors morin.py:9257 by using
        ``Chart.setHouseSystem`` where possible. ``mode='recalc'`` mirrors the
        ayanamsha/global path at morin.py:9154 with full ``Chart.recalc``. Option
        autosave remains above in ``_autosave_group``; this runtime refresh never
        marks or writes chart documents.
        """
        if self._controller is None:
            return []
        try:
            return list(self._controller.refresh_all_sessions(mode=mode))
        except Exception:
            return []


options_service = OptionsService()
