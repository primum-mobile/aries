# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Agent-facing UI tokens for wxPython GUI work.

New or changed widget code should take sizes, colors, and fonts from this
module instead of inventing literals inline.

Two layers, by design:

- **Runtime palette** — owned by :mod:`theme`. Materialized from the live
  ``options.clr*`` values; what the user actually sees. Custom-painted
  widgets read tokens from ``theme.current_palette()`` inside their
  ``EVT_PAINT`` handler.
- **Snapshot palette** — :data:`THEME_DARK` / :data:`THEME_FLAT` constants
  in this file. Static hex strings used by ``scripts/ui_snapshot.py`` to
  render reference scenes for design specs. *Not* used at app runtime.

Spacing / typography / dimension tokens (``SPACE_*``, ``FONT_SIZE_*``,
``RADIUS_*``, ``SIDEBAR_*_W``, etc.) apply to both layers.

Runtime mutability (added 2026-05-04 for the Design Panel)
-----------------------------------------------------------
The UPPERCASE module constants below are **mutable at runtime** via
:func:`set_value`. Callers should access tokens via the
``from aries.ui import tokens as _tokens; _tokens.SPACE_M`` namespace
pattern so the dynamic value is picked up. The ``from aries.ui.tokens
import SPACE_M`` pattern bakes the value at import time and won't react
to later mutations — **don't use it.**

A snapshot of the original values is captured at module load time and
exposed via :func:`reset_value`; this is the "Factory" profile baseline
the Design Panel resets to. Subscribe to changes via :func:`subscribe`
``(fn)`` where ``fn`` receives the set of changed token names.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Set, Tuple


RGB = Tuple[int, int, int]


# ---------------------------------------------------------------------------
# Spacing - 4 px base scale.
# ---------------------------------------------------------------------------

SPACE_XXS = 2
SPACE_XS = 4
SPACE_S = 8
SPACE_M = 12
SPACE_L = 16
SPACE_XL = 24
SPACE_XXL = 32

# Documented bridge for the 525 legacy `5px` sizer.Add callsites we have
# not yet migrated. New code should use SPACE_XS or SPACE_S, not this.
SPACE_LEGACY = 5

BORDER_HAIRLINE = 1
BORDER_THIN = 1
BORDER_THICK = 2

RADIUS_NONE = 0
RADIUS_S = 2
RADIUS_M = 4
RADIUS_L = 8

# Component-scoped radii (spotlight pill, header tools, etc.)
PILL_RADIUS = 37
PILL_DIVIDER_RADIUS = 10
ACTION_PILL_RADIUS = 9
HEADER_TOOL_RADIUS = 8
HEADER_TOOL_ICON_SIZE = 14
STEPPER_RADIUS = 5

# Custom overlay scrollbar (workspace_shell._FadingScrollbar)
SCROLLBAR_THUMB_WIDTH = 8
SCROLLBAR_RADIUS = 4

# Pane header height (currently used as off-token 26 in corpuspane)
PANE_HEADER_H = 26


# ---------------------------------------------------------------------------
# Layout dimensions.
# ---------------------------------------------------------------------------

FRAME_MIN_W = 1100
FRAME_MIN_H = 720
FRAME_DEFAULT_W = 1440
FRAME_DEFAULT_H = 900

# Canonical dialog size — 27 dialogs in the codebase use this verbatim
DIALOG_DEFAULT_W = 640
DIALOG_DEFAULT_H = 400
PANEL_MIN_DEFAULT = (200, 200)
FRAME_WIDE_CONTENT_W = 1000
FRAME_WIDE_CONTENT_H = 640

SIDEBAR_MIN_W = 220
SIDEBAR_DEFAULT_W = 280
SIDEBAR_MAX_W = 420

INSPECTOR_MIN_W = 280
INSPECTOR_DEFAULT_W = 340
INSPECTOR_MAX_W = 520

CHART_MIN_SIZE = 480

DEV_PANEL_MIN_W = 860
DEV_PANEL_MIN_H = 620
DESIGN_PANEL_DEFAULT_W = 960
DESIGN_PANEL_DEFAULT_H = 760
DESIGN_PANEL_NAV_W = 178
DESIGN_PANEL_ROW_H = 62
DESIGN_PANEL_CONTROL_W = 220
DESIGN_PANEL_VALUE_W = 72
FORM_CHOICE_W = 220

RECT_HEADER_H = 36
RECT_ROW_H = 22
RECT_TABLE_MIN_W = 560

CTRL_H_S = 22
CTRL_H_M = 28
CTRL_H_L = 36

# Chart wheel ring stroke width (base, before _scaled_line_w() factors in the
# current chart size). User-overridable via Appearance dialog → Display group;
# the live value is stored in options.chartringthickness and this token only
# supplies the factory default + slider bounds.
CHART_RING_THICKNESS = 3
CHART_RING_THICKNESS_MIN = 1
CHART_RING_THICKNESS_MAX = 3

# Surveil / paran accent — warm orange shared between zodiacal surveil marks
# (`graphchart._draw_zodiacal_surveil_marks`) and the key-prompts overlay.
# Chosen by background luminance so it reads on both Midnight and Daylight.
SURVEIL_ACCENT_DARK_RGB = (229, 146, 70)
SURVEIL_ACCENT_LIGHT_RGB = (211, 84, 0)

# Key-prompts overlay (aries/ui/key_prompts_overlay.py). PlayStation-style
# floating keycap hints over the chart canvas — laid out as a single
# vertical column anchored to the bottom-centre of the chart host. Sized
# so they read at a glance from across the room. Alphas are 0–255.
KEYCAP_CORNER = 11
KEYCAP_H = 56
KEYCAP_MIN_W = 60
KEYCAP_PAD_X = 16
KEYCAP_GAP = 5
KEYCAP_LABEL_GAP = 18
KEYCAP_ROW_GAP = 10
KEYCAP_STROKE_W = 1
KEYCAP_FILL_ALPHA = 22
KEYCAP_STROKE_ALPHA = 220
KEYCAP_GLOW_RADIUS = 18
KEYCAP_GLOW_ALPHA = 55
KEYCAP_STRIP_BOTTOM_INSET = 28
KEYCAP_STRIP_BACKDROP_ALPHA = 150
KEYCAP_STRIP_BACKDROP_PAD_X = 24
KEYCAP_STRIP_BACKDROP_PAD_Y = 20
KEYCAP_STRIP_BACKDROP_CORNER = 16
OVERLAY_FADE_S = 0.45
OVERLAY_AUTOHIDE_S = 5.5
FONT_SIZE_KEYCAP = 26
FONT_SIZE_LABEL = 20


# ---------------------------------------------------------------------------
# Typography.
# ---------------------------------------------------------------------------

FONT_SIZE_XS = 8
FONT_SIZE_S = 9
FONT_SIZE_M = 10
FONT_SIZE_L = 11
FONT_SIZE_XL = 13
FONT_SIZE_H1 = 16
FONT_SIZE_H2 = 14
FONT_SIZE_H3 = 12

FONT_WEIGHT_REGULAR = "regular"
FONT_WEIGHT_MEDIUM = "medium"
FONT_WEIGHT_BOLD = "bold"


# ---------------------------------------------------------------------------
# Snapshot themes.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Theme:
	name: str
	bg: str
	bg_panel: str
	bg_input: str
	bg_hover: str
	bg_selected: str
	fg: str
	fg_muted: str
	fg_disabled: str
	border: str
	border_strong: str
	accent: str
	accent_fg: str
	danger: str
	warn: str
	ok: str
	chart_bg: str
	chart_grid: str
	chart_ink: str


THEME_FLAT = Theme(
	name="flat",
	# Mirror the runtime Daylight palette so snapshot scenes match the app.
	bg="#FFFFFF",
	bg_panel="#F8F8F8",
	bg_input="#FFFFFF",
	bg_hover="#F2F2F2",
	bg_selected="#E6F0FF",
	fg="#272727",
	fg_muted="#808080",
	fg_disabled="#A6A6A6",
	border="#E6E6E6",
	border_strong="#808080",
	accent="#0064E1",
	accent_fg="#FFFFFF",
	danger="#C83232",
	warn="#B4821E",
	ok="#288246",
	chart_bg="#FFFFFF",
	chart_grid="#808080",
	chart_ink="#272727",
)

THEME_DARK = Theme(
	name="dark",
	# Mirror the runtime Midnight palette so snapshot scenes match the app.
	bg="#232428",
	bg_panel="#1D1E21",
	bg_input="#2A2B2F",
	bg_hover="#2D3038",
	bg_selected="#3A4258",
	fg="#98999C",
	fg_muted="#6B6C70",
	fg_disabled="#4A4B4F",
	border="#3A3B3F",
	border_strong="#5C5D62",
	accent="#60A5FA",
	accent_fg="#0F1014",
	danger="#FF0000",
	warn="#F0B446",
	ok="#28C85A",
	chart_bg="#000000",
	chart_grid="#8A8B8D",
	chart_ink="#DCDEE2",
)

THEME: Theme = THEME_DARK


PLANET_COLORS = {
	"Sun": "#E6B800",
	"Moon": "#C0C0C0",
	"Mercury": "#9966CC",
	"Venus": "#66B266",
	"Mars": "#CC3333",
	"Jupiter": "#3366CC",
	"Saturn": "#666666",
	"Uranus": "#33CCCC",
	"Neptune": "#3366FF",
	"Pluto": "#660066",
	"NorthNode": "#888888",
	"SouthNode": "#888888",
	"Lot": "#996633",
}

ELEMENT_COLORS = {
	"fire": "#CC4422",
	"earth": "#557733",
	"air": "#CCAA22",
	"water": "#3366AA",
}


def set_theme(name: str) -> Theme:
	"""Set the active snapshot token theme by name."""
	global THEME
	key = (name or "").lower()
	if key == "dark":
		THEME = THEME_DARK
	elif key == "flat":
		THEME = THEME_FLAT
	else:
		raise ValueError("unknown theme: %s" % name)
	return THEME


def hex_to_rgb(value: str) -> RGB:
	value = value.strip().lstrip("#")
	if len(value) != 6:
		raise ValueError("bad hex color: %r" % value)
	return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def wx_color(hex_str: str):
	import wx
	return wx.Colour(*hex_to_rgb(hex_str))


def _default_face(weight: str) -> str:
	try:
		import common
		c = getattr(common, "common", None)
		if c is None:
			# common.common is constructed lazily inside MFrame.__init__;
			# during snapshot scenes / tests the instance may not exist yet.
			return "FreeSans"
		if weight == FONT_WEIGHT_BOLD:
			return getattr(c, "abc_bold_face", "FreeSans")
		return getattr(c, "abc_face", "FreeSans")
	except Exception:
		return "FreeSans"


def wx_font(size=None, weight=None, family=None, italic=False):
	"""Build a wx.Font from token values.

	Reads ``FONT_SIZE_M`` / ``FONT_WEIGHT_REGULAR`` as defaults via the
	live module attributes so a Design Panel override of those tokens
	immediately changes every font this factory produces.
	"""
	import wx
	_mod = sys.modules[__name__]
	if size is None:
		size = _mod.FONT_SIZE_M
	if weight is None:
		weight = _mod.FONT_WEIGHT_REGULAR
	wx_weight = {
		FONT_WEIGHT_REGULAR: wx.FONTWEIGHT_NORMAL,
		FONT_WEIGHT_MEDIUM: getattr(wx, "FONTWEIGHT_MEDIUM", wx.FONTWEIGHT_NORMAL),
		FONT_WEIGHT_BOLD: wx.FONTWEIGHT_BOLD,
	}[weight]
	wx_style = wx.FONTSTYLE_ITALIC if italic else wx.FONTSTYLE_NORMAL
	return wx.Font(
		size,
		wx.FONTFAMILY_DEFAULT,
		wx_style,
		wx_weight,
		False,
		family if family is not None else _default_face(weight),
	)


# ---------------------------------------------------------------------------
# Runtime mutation API (Design Panel hookup, added 2026-05-04).
# ---------------------------------------------------------------------------


_MODULE = sys.modules[__name__]
_DEFAULTS: dict = {}
_LISTENERS: list = []
# Names we expose to the Design Panel. Anything UPPERCASE that's a primitive
# (int / float / str / tuple of primitives) — but *not* the snapshot Theme
# dataclass instances or the PLANET_COLORS / ELEMENT_COLORS dicts (those
# have their own design-surface paths).
_SKIP_NAMES = {'THEME', 'THEME_FLAT', 'THEME_DARK', 'PLANET_COLORS', 'ELEMENT_COLORS', 'RGB'}


def _is_tunable_value(value) -> bool:
	if isinstance(value, (int, float, str)):
		return True
	if isinstance(value, tuple) and value and all(isinstance(x, (int, float, str)) for x in value):
		return True
	return False


def _capture_defaults() -> None:
	for name in list(vars(_MODULE).keys()):
		if not name.isupper() or name.startswith('_') or name in _SKIP_NAMES:
			continue
		value = getattr(_MODULE, name)
		if not _is_tunable_value(value):
			continue
		_DEFAULTS[name] = value


_capture_defaults()


def tunable_names() -> Set[str]:
	"""Names every Design-Panel can override via :func:`set_value`."""
	return set(_DEFAULTS.keys())


def get_value(name: str):
	"""Return the live value of a tunable token (override or default)."""
	return getattr(_MODULE, name)


def get_default(name: str):
	"""Return the captured factory default for a tunable token."""
	return _DEFAULTS[name]


def is_override(name: str) -> bool:
	"""True iff the live value differs from the captured default."""
	if name not in _DEFAULTS:
		return False
	return getattr(_MODULE, name) != _DEFAULTS[name]


def set_value(name: str, value) -> None:
	"""Override a tunable token and notify subscribers.

	The new value is written to the module attribute so subsequent
	``tokens.NAME`` lookups pick it up. Subscribers (e.g. the Design Panel
	preview and any custom-painted widget that subscribed) are invoked with
	the single-element set ``{name}``.
	"""
	if name not in _DEFAULTS:
		raise KeyError('not a tunable token: %r' % name)
	setattr(_MODULE, name, value)
	_fire({name})


def reset_value(name: Optional[str] = None) -> None:
	"""Restore the captured factory default for one token, or all of them."""
	if name is None:
		changed = set()
		for k, v in _DEFAULTS.items():
			if getattr(_MODULE, k) != v:
				setattr(_MODULE, k, v)
				changed.add(k)
		if changed:
			_fire(changed)
		return
	if name not in _DEFAULTS:
		raise KeyError('not a tunable token: %r' % name)
	if getattr(_MODULE, name) != _DEFAULTS[name]:
		setattr(_MODULE, name, _DEFAULTS[name])
		_fire({name})


def apply_overrides(overrides: dict) -> None:
	"""Bulk-apply a profile dict ``{token_name: value, ...}`` and notify once.

	Unknown / non-tunable keys are skipped silently. Designed for the
	Design Panel's profile-load path (one fire per load, not one per key).
	"""
	changed = set()
	for name, value in overrides.items():
		if name not in _DEFAULTS:
			continue
		if getattr(_MODULE, name) != value:
			setattr(_MODULE, name, value)
			changed.add(name)
	if changed:
		_fire(changed)


def snapshot() -> dict:
	"""Return ``{token_name: live_value}`` for every tunable token."""
	return {k: getattr(_MODULE, k) for k in _DEFAULTS.keys()}


def defaults_snapshot() -> dict:
	"""Return a copy of the captured factory defaults."""
	return dict(_DEFAULTS)


def subscribe(fn: Callable[[Set[str]], None]) -> None:
	"""Register ``fn(changed_names)`` to fire on every token mutation."""
	if fn not in _LISTENERS:
		_LISTENERS.append(fn)


def unsubscribe(fn: Callable[[Set[str]], None]) -> None:
	if fn in _LISTENERS:
		_LISTENERS.remove(fn)


def _fire(changed: Iterable[str]) -> None:
	keys = set(changed)
	for fn in list(_LISTENERS):
		try:
			fn(keys)
		except Exception:
			# Subscriber failures must not block other subscribers or the
			# Design Panel's interactive flow.
			pass
