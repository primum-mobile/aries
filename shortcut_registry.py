# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import mtexts

# wx is only needed to build the live wx AcceleratorTable (build_main_accelerators).
# Keep the import lazy so this module — the single source of truth for the
# shortcut data — stays importable in wx-free contexts (e.g. the web daemon
# manifest service). Desktop callers still get the real wx via _wx().
try:  # pragma: no cover - exercised by both the desktop app and the daemon
    import wx
except Exception:  # wx-free context (daemon / tests without a display)
    wx = None


def _wx():
    global wx
    if wx is None:
        import wx as _wxmod  # let the ImportError surface to wx-only callers
        wx = _wxmod
    return wx


# Central editable registry for active workspace/menu shortcut behavior.
# Keep legacy mtexts menu labels as fallback, but define custom quick keys,
# accelerator bindings, and workspace shortcut overrides here.

WORKSPACE_SHORTCUT_OVERRIDES = {
	# HMLoad still carries the legacy wx Ctrl+L hint. The Tauri/native File
	# menu binds Open to CmdOrCtrl+O, so publish the live product shortcut.
	'open_chart': 'CmdOrCtrl+O',
	'transits': 'T',
	'solar_return': 'R',
	'lunar_return': 'L',
	'search_module': 'Ctrl+F',
	'secondary_chart': 'S',
	'profections_chart': 'P',
	'primary_directions': 'D',
	'circumambulation': 'C',
	'eclipses': 'E',
	'zodiacal_releasing': 'Z',
}


MENU_LABEL_UPDATES = (
	('ctransits', 'ID_Transits', 'Transits', 'transits'),
	('mcharts', 'ID_Revolutions', 'Solar Revolution', 'solar_return'),
	('mcharts', 'ID_OtherRevolutions', 'Other Revolutions...', None),
	('mcharts', 'ID_ProfectionsChart', 'Profections Chart', 'profections_chart'),
	('mcharts', 'ID_SecProgChart', 'Secondary Progressions Chart', 'secondary_chart'),
	('mtable', 'ID_Profections', 'Profections', None),
	('mtable', 'ID_PrimaryDirs', 'Primary Directions Lists', 'primary_directions'),
	('mtable', 'ID_Eclipses', 'Eclipses', 'eclipses'),
	('mtable', 'ID_SearchModule', 'Search...', 'search_module'),
	('ttimelords', 'ID_ZodiacalReleasing', 'Zodiacal Releasing', 'zodiacal_releasing'),
	('ttimelords', 'ID_Circumambulation', 'Circumambulation', 'circumambulation'),
)


MAIN_QUICK_SHORTCUTS = (
	('T', 'transits', 'onTransits'),
	('R', 'solar_return', 'onQuickSolarRevolution'),
	('L', 'lunar_return', 'onQuickLunarRevolution'),
	('S', 'secondary_chart', 'onSecondaryDirs'),
	('A', 'solar_arc_chart', 'onQuickSolarArc'),
	('M', 'minor_chart', 'onQuickMinorProgression'),
	('P', 'profections_chart', 'onProfectionsChart'),
	('D', 'primary_directions', 'onPrimaryDirs'),
	('C', 'circumambulation', 'onCircumambulation'),
	('E', 'eclipses', 'onEclipses'),
	('Z', 'zodiacal_releasing', 'onZodiacalReleasing'),
	('H', 'toggle_houses', 'onToggleHouses'),
)


# The bare-letter quick keys actually bound on the web skin today. The desktop
# binds all MAIN_QUICK_SHORTCUTS via CHAR_HOOK; the web skin binds the rows here
# through the manifest dispatcher. H/toggle_houses is a special options command
# and is marked live in the manifest directly.
WEB_BOUND_QUICK_ACTIONS = frozenset({
	'transits',
	'solar_return',
	'lunar_return',
	'secondary_chart',
	'solar_arc_chart',
	'minor_chart',
	'profections_chart',
	'primary_directions',
	'circumambulation',
	'eclipses',
	'zodiacal_releasing',
})


# The shortcut help overlay's reference rows — the SAME data the wx painter draws
# (aries/ui/shortcut_help_overlay.py imports this). Pulled here, into the wx-free
# single source of truth, so the desktop overlay and the web shortcuts overlay
# read one table (the painter is wx; this data is not). Each group is
# {'title', 'items': [(keys, action, example|None), ...]}. The key glyphs are
# KEYBOARD symbols (arrows/shift/option), never astrological Morinus glyphs.
SHORTCUT_HELP_GROUPS = (
	{
		'title': 'TIME STEP',
		# Direction: shift/option on left/right go FINER (hour < day, minute <
		# hour); up/down alone go LARGER (a week); shift+up/down jumps to the next
		# lunar quarter (chart_session._navigate_intrinsically classical phase).
		'items': (
			('← / →', 'day in transits / here-and-now charts', None),
			('⇧ + ← / →', 'step hour', None),
			('⌥ + ← / →', 'step minute', None),
			('↑ / ↓', 'step a week', None),
			('⇧ + ↑ / ↓', 'step to next lunar phase quarter', None),
		),
	},
	{
		'title': 'CHART MODES',
		'items': (
			('R', 'solar revolution', None),
			('L', 'lunar revolution', None),
			('S', 'secondary progressions', None),
			('D', 'primary directions', None),
			('Z', 'zodiacal releasing', None),
			('T', 'transits', None),
			('⌘ F', 'search', None),
		),
	},
	{
		'title': 'VIEW',
		'items': (
			('Tab', 'compare', 'derived charts only'),
			('Esc', 'close panel / overlay', None),
			('⇧ ⇧', 'open spotlight', 'double-tap shift'),
		),
	},
)


# Genuine wx accelerators as PURE DATA (label + display chord), the wx-free twin
# of _accelerator_specs() below. _accelerator_specs binds wx.ACCEL_*/wx.WXK_* ids
# the daemon cannot import; this parallel table is the same chords described for
# the web shortcuts overlay. Each row: (display_chord, label). Sourced 1:1 from
# _accelerator_specs (shortcut_registry.py:75-93) and its menu labels.
ACCELERATOR_HELP_ROWS = (
	('⌘ W', 'Close window'),
	('⌘ F', 'Search'),
	('⌃ F11', 'Angle at birth'),
	('⌃ 1', 'Zodiacal releasing'),
	('⌃ 2', 'Phasis'),
	('⌃ 3', 'Paranatellonta'),
	('⌃ 5', 'Fixed-star angle directions'),
	('F5', 'Misc'),
	('⌃ 6', 'Eclipses'),
	('⌃ 8', 'Fixed-star parallels'),
	('⌘ Y', 'Synastry'),
	('⌘ ⇧ D', 'Dev panel'),
	('⌘ ⌥ A', 'Ascensional transits'),
)


# Live Tauri/web shortcuts whose handlers do not come from the manifest
# dispatcher. Keep them as display/documentation data only: adding command ids
# here would register a second handler on top of the retained native/frontend
# handler. ``labelKey`` is an optional frontend localization key; the daemon
# also resolves the shared mtexts labels where one already exists.
TAURI_LIVE_SHORTCUT_ROWS = (
	{
		'keys': '⌘ B',
		'label': 'Toggle sidebar',
		'labelKey': 'toolbar.toggleSidebar',
		'group': 'WORKSPACE',
	},
	{
		'keys': '⌘ G',
		'label': 'Cycle secondary view',
		'labelKey': 'nativeMenu.cycleSecondaryView',
		'group': 'WORKSPACE',
	},
	{
		'keys': '⌘ ⇧ A',
		'label': 'Appearance',
		'labelKey': 'appearance.title',
		'group': 'WORKSPACE',
	},
	{
		'keys': 'Space',
		'label': 'Reset to initial chart',
		'labelKey': 'help.shortcut.resetInitialChart',
		'group': 'TIME STEP',
	},
	{
		'keys': 'Esc',
		'label': 'close panel / overlay',
		'labelKey': 'help.shortcut.closePanel',
		'group': 'VIEW',
	},
	{
		'keys': '⇧ ⇧',
		'label': 'open spotlight',
		'labelKey': 'help.shortcut.openSpotlight',
		'group': 'VIEW',
		'example': 'double-tap shift',
	},
	{
		'keys': '0–9',
		'label': 'open spotlight',
		'labelKey': 'help.shortcut.openSpotlightSeeded',
		'group': 'VIEW',
		'example': 'enter first digit',
	},
)


def _accelerator_specs():
	"""wx accelerator specs, built lazily so the module imports wx-free.

	The constants (wx.ACCEL_*, wx.WXK_F*) only resolve in a desktop (wx)
	process; keeping them inside a function lets the daemon import this module's
	pure shortcut data without dragging in wx."""
	wx = _wx()
	return (
		(wx.ACCEL_CMD, ord('W'), 'ID_CloseWindowShortcut'),
		(wx.ACCEL_CMD, ord('F'), 'ID_SearchModule'),
		(wx.ACCEL_CTRL, wx.WXK_F11, 'ID_AngleAtBirth'),
		(wx.ACCEL_CTRL, ord('1'), 'ID_ZodiacalReleasing'),
		(wx.ACCEL_CTRL, ord('2'), 'ID_Phasis'),
		(wx.ACCEL_CTRL, ord('3'), 'ID_Paranatellonta'),
		(wx.ACCEL_CTRL, ord('5'), 'ID_FixStarAngleDirs'),
		(wx.ACCEL_NORMAL, wx.WXK_F5, 'ID_Misc'),
		(wx.ACCEL_CTRL, ord('6'), 'ID_Eclipses'),
		(wx.ACCEL_CTRL, ord('8'), 'ID_FixStarsParallels'),
		# `S` for SecProgChart is dispatched via CHAR_HOOK + handle_main_quick_shortcut.
		# Adding it to the AcceleratorTable here would dispatch as EVT_MENU before
		# CHAR_HOOK and bypass the text-input focus filter — letters typed in the
		# notes pane would steal-fire the chart action. Don't put it back.
		(wx.ACCEL_CMD, ord('Y'), 'ID_Synastry'),
		(wx.ACCEL_CMD | wx.ACCEL_SHIFT, ord('D'), 'ID_DevPanel'),
		(wx.ACCEL_CMD | wx.ACCEL_ALT, ord('A'), 'ID_AscensionalTransits'),
	)


def _shortcut_from_menu_key(menu_key, fallback=''):
	label = mtexts.menutxts.get(menu_key, '')
	if '\t' not in label:
		return fallback
	return label.split('\t', 1)[1].strip() or fallback


def workspace_shortcut(action_id, menu_key=None, fallback=''):
	override = WORKSPACE_SHORTCUT_OVERRIDES.get(action_id)
	if override is not None:
		return override
	if menu_key:
		return _shortcut_from_menu_key(menu_key, fallback)
	return fallback


_SAFE_MODIFIERS = ('Cmd', 'Ctrl', 'Alt', 'Meta', 'Option')
_ALLOWED_SHIFT_MENU_ACCELERATORS = {
	(frozenset(('ctrl', 'shift')), 'A'),
	(frozenset(('cmd', 'shift')), 'A'),
	(frozenset(('ctrl', 'shift')), 'D'),
	(frozenset(('cmd', 'shift')), 'D'),
}


def _shortcut_signature(shortcut):
	if not shortcut:
		return None
	aliases = {
		'command': 'cmd',
		'control': 'ctrl',
		'option': 'alt',
	}
	parts = [p.strip() for p in shortcut.split('+') if p.strip()]
	if not parts:
		return None
	key = parts[-1].upper()
	modifiers = frozenset(aliases.get(p.lower(), p.lower()) for p in parts[:-1])
	return (modifiers, key)


def _is_allowed_shift_menu_accelerator(shortcut):
	return _shortcut_signature(shortcut) in _ALLOWED_SHIFT_MENU_ACCELERATORS


def _is_text_conflicting_shortcut(shortcut):
	"""True for shortcuts that conflict with typing in a text widget.

	Conflicting (must NOT be registered as wx menu accelerators — they would
	create an OS-level NSMenuItem keyEquivalent on macOS that fires regardless
	of focus and steals the keystroke from the focused text widget):
	  - bare single letter: 'L', 'T', 'R'

	Safe (OK to keep `\\t` form so they dispatch as real accelerators):
	  - Cmd / Ctrl / Alt / Option / Meta combos: 'Cmd+S', 'Ctrl+1'.
	  - Function keys without Shift: 'F5'.

	Aries dispatches conflicting shortcuts through EVT_CHAR_HOOK +
	`keyboard_layers.handle_main_key_event`, which the text-input focus filter
	in `morin.onCharHook` respects.
	"""
	signature = _shortcut_signature(shortcut)
	if signature is None:
		return False
	modifiers, key = signature
	# F-keys: never typed by users in a text widget — safe as accelerators.
	if len(key) >= 2 and key[0].upper() == 'F' and key[1:].isdigit():
		return False
	# Any non-Shift modifier present → real accelerator, not a conflict.
	if modifiers.intersection(m.lower() for m in _SAFE_MODIFIERS):
		return False
	# Bare letter — treat as typing.
	if len(key) == 1 and key.isalpha():
		return True
	return False


def _has_shift_modifier(shortcut):
	if not shortcut:
		return False
	parts = [p.strip().lower() for p in shortcut.split('+')]
	return 'shift' in parts[:-1]


def text_safe_menu_label(label):
	"""Return a wx menu label that cannot steal normal text input.

	wx treats text after a tab in a menu label as a native accelerator. Bare
	letters are normal typing, so show them as inert hints instead of
	registering them with the OS menu system. Shift-only shortcuts are retired
	from menus; see doc/keyboard-manual.md before reassigning.
	"""
	if not isinstance(label, str) or '\t' not in label:
		return label
	text, shortcut = label.split('\t', 1)
	shortcut = shortcut.strip()
	if _has_shift_modifier(shortcut) and not _is_allowed_shift_menu_accelerator(shortcut):
		return text
	if not _is_text_conflicting_shortcut(shortcut):
		return label
	if not shortcut:
		return text
	return '%s    (%s)' % (text, shortcut)


def menu_label_without_accelerator(label):
	if not isinstance(label, str) or '\t' not in label:
		return label
	return label.split('\t', 1)[0]


def sanitize_menu_texts(labels):
	"""Rewrite typeable menu accelerators in a mutable label dictionary."""
	if not isinstance(labels, dict):
		return
	for key, label in list(labels.items()):
		labels[key] = text_safe_menu_label(label)


def apply_menu_shortcut_labels(frame):
	for menu_name, item_id_attr, label, action_id in MENU_LABEL_UPDATES:
		try:
			item_id = getattr(frame, item_id_attr)
			menu = getattr(frame, menu_name)
		except Exception:
			continue
		shortcut = workspace_shortcut(action_id, fallback='') if action_id else ''
		if not shortcut:
			menu_label = text_safe_menu_label(label)
		elif _has_shift_modifier(shortcut):
			menu_label = label
		elif _is_text_conflicting_shortcut(shortcut):
			# Visual hint only — `(T)` is not parsed by wx as an
			# accelerator, so no OS-level keyEquivalent is registered.
			menu_label = '%s    (%s)' % (label, shortcut)
		else:
			# Real OS accelerator (Cmd+…, Ctrl+…, Fn keys) — keep `\t` form.
			menu_label = '%s\t%s' % (label, shortcut)
		try:
			menu.SetLabel(item_id, menu_label)
		except Exception:
			pass


def handle_main_quick_shortcut(frame, keycode):
	for key, action_id, handler_name in MAIN_QUICK_SHORTCUTS:
		if keycode not in (ord(key), ord(key.lower())):
			continue
		if getattr(frame, 'splash', True):
			return False
		radix_only = getattr(frame, '_handle_main_radix_quick_shortcut', None)
		if callable(radix_only) and action_id in (
			'transits',
			'solar_return',
			'lunar_return',
			'secondary_chart',
			'solar_arc_chart',
			'minor_chart',
			'profections_chart',
		):
			return bool(radix_only(action_id))
		handler = getattr(frame, handler_name, None)
		if handler is None:
			return False
		handler(None)
		return True
	return False


def build_main_accelerators(frame):
	entries = []
	for modifiers, keycode, item_id_attr in _accelerator_specs():
		try:
			item_id = getattr(frame, item_id_attr)
		except Exception:
			continue
		entries.append((modifiers, keycode, item_id))
	return entries
