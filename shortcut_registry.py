# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import mtexts

# Stable arrow IDs shared by sessions, cursor steppers and daemon commands.
# Keep the historical integer contract so legacy keyboard events also work.
NAVIGATION_KEYCODES = {'left': 314, 'up': 315, 'right': 316, 'down': 317}
NAVIGATION_NUMPAD_KEYCODES = {'left': 376, 'up': 377, 'right': 378, 'down': 379}


# Central editable registry for active workspace/menu shortcut behavior.
# Keep legacy mtexts menu labels as fallback, but define custom quick keys,
# accelerator bindings, and workspace shortcut overrides here.

WORKSPACE_SHORTCUT_OVERRIDES = {
	# HMLoad still carries the legacy wx Ctrl+L hint. The Tauri/native File
	# menu binds Open to CmdOrCtrl+O, so publish the live product shortcut.
	'open_chart': 'CmdOrCtrl+O',
	'astrocart': 'CmdOrCtrl+A',
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
	'synodic_cycles': 'Q',
	'aspect_list': 'X',
}


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
	# The Synodic Cycles retained list is a Tauri-only surface. Keeping its key
	# in the shared registry publishes the live web command without inventing a
	# legacy wx table handler.
	('Q', 'synodic_cycles', None),
	('X', 'aspect_list', None),
	('H', 'toggle_houses', 'onToggleHouses'),
)


# The bare-letter quick keys actually bound on the web skin today. The desktop
# binds MAIN_QUICK_SHORTCUTS rows with a handler via CHAR_HOOK; Tauri-only rows
# may deliberately use ``None``. The web skin binds the action ids listed here
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
	'synodic_cycles',
	'aspect_list',
})


# The shortcut help overlay's reference rows, read by the web shortcuts
# overlay. Each group is
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
			('Tab', 'compare or dashboard', 'dashboard on single charts'),
			('Esc', 'close panel / overlay', None),
			('⇧ ⇧', 'open spotlight', 'double-tap shift'),
		),
	},
)


# Former desktop accelerators as display data (chord + label) for the web
# shortcuts overlay. Each row: (display_chord, label).
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


# Live Tauri/web shortcuts owned by the manifest dispatcher.
TAURI_MANIFEST_SHORTCUT_ROWS = (
	{
		'keys': 'N',
		'label': 'Notes',
		'labelKey': 'notes.title',
		'group': 'WORKSPACE',
		'commandId': 'toggle-notes',
	},
	{
		'keys': '⌘ A',
		'label': 'Astrocartography',
		'labelKey': 'settings.astrocartography',
		'group': 'WORKSPACE',
		'commandId': 'astrocartography',
	},
	{
		'keys': '⌘ ⇧ E',
		'label': 'Chart Style Lab',
		'labelKey': 'styleLab.title',
		'group': 'WORKSPACE',
		'commandId': 'open-style-lab',
	},
	{
		'keys': '⌥ A',
		'label': 'Ascensional view',
		'labelKey': 'chartmenu.ascensional',
		'group': 'WORKSPACE',
		'commandId': 'ascensional-view',
	},
	{
		'keys': '⌥ E',
		'label': 'Export poster',
		'labelKey': 'astrolabe.poster.saveTitle',
		'group': 'WORKSPACE',
		'commandId': 'export-poster',
	},
	{
		'keys': '⌘ ⇧ H',
		'label': 'Cycle house system',
		'labelKey': 'nativeMenu.cycleHouseSystem',
		'group': 'WORKSPACE',
		'commandId': 'quick.options.house:next',
	},
)


# Live Tauri/web shortcuts whose handlers do not come from the manifest
# dispatcher. Keep them as display/documentation data only: adding command ids
# here would register a second handler on top of the retained native/frontend
# handler. ``labelKey`` is an optional frontend localization key; the daemon
# also resolves the shared mtexts labels where one already exists.
TAURI_LIVE_SHORTCUT_ROWS = (
	{
		'keys': '^',
		'label': 'Toggle sidebar',
		'labelKey': 'toolbar.toggleSidebar',
		'group': 'WORKSPACE',
	},
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
		'keys': '⇧ + ⌥ + ← / →',
		'label': 'Step by one second',
		'labelKey': 'help.shortcut.secondStep',
		'group': 'TIME STEP',
	},
	{
		'keys': 'Space',
		'label': 'Reset Chart',
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


# Hidden Tauri/web bindings. These remain in the canonical manifest so the
# shortcut dispatcher has one source of truth, but are deliberately omitted
# from Help and other public shortcut lists.
TAURI_HIDDEN_SHORTCUT_ROWS = (
	{
		'keys': '⌘ ⇧ 0',
		'commandId': 'toggle-presentation-cursor',
	},
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
	from menus.
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
