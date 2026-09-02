# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

import os


PROFILE_DEFAULT = 'freesans'
PROFILE_KOSUGI = 'kosugi'
PROFILE_KOSUGI_ARIES = 'kosugi_aries'
PROFILE_ARIES_UI = 'aries_ui'
PROFILE_DOT_GOTHIC = 'dot_gothic16'
PROFILE_SYSTEM = 'system'

PROFILE_CHOICES = (
	(PROFILE_DEFAULT, 'FreeSans (default)'),
	(PROFILE_ARIES_UI, 'Aries UI'),
	(PROFILE_KOSUGI, 'Kosugi'),
	(PROFILE_KOSUGI_ARIES, 'Kosugi Aries'),
	(PROFILE_DOT_GOTHIC, 'DotGothic16'),
)

# The Tauri app can persist the platform's native system-ui stack even though
# the legacy wx picker cannot represent a CSS generic family. Keep persistence
# broader than the legacy picker without adding a misleading wx-only choice.
_PERSISTED_PROFILE_KEYS = {
	*(key for key, _label in PROFILE_CHOICES),
	PROFILE_SYSTEM,
}

# 'kosugi' keeps meaning upstream Kosugi so no saved setting is silently
# swapped; 'kosugi_aries' is the respaced build from
# scripts/fonts/build_kosugi_aries.py. Both stay selectable for comparison.
# Persistence is by key string (options.py pickles coerce_profile), so the
# ordering above is free to change.
#
# PROFILE_ARIES_UI is deliberately absent below. It is a composite split by
# content rather than script - FreeSans letters with Kosugi figures and
# measurement marks - declared with unicode-range in globals.css, and a
# private-font registration can only take one file. With no entry here,
# _display_profile returns None and wx falls through to its normal FreeSans
# text bundle, which is the correct degradation.
_DISPLAY_PROFILES = {
	PROFILE_KOSUGI: ('FontTrials', 'Kosugi-Regular.ttf', 'Kosugi'),
	PROFILE_KOSUGI_ARIES: ('FontTrials', 'KosugiAries-Regular.ttf', 'Kosugi Aries'),
	PROFILE_DOT_GOTHIC: ('FontTrials', 'DotGothic16-Regular.ttf', 'DotGothic16'),
}


def coerce_profile(value):
	if value in _PERSISTED_PROFILE_KEYS:
		return value
	return PROFILE_DEFAULT


def choice_labels():
	return [label for _key, label in PROFILE_CHOICES]


def profile_index(value):
	value = coerce_profile(value)
	for idx, (key, _label) in enumerate(PROFILE_CHOICES):
		if key == value:
			return idx
	return 0


def profile_from_index(index):
	try:
		index = int(index)
		if index < 0:
			return PROFILE_DEFAULT
		return PROFILE_CHOICES[index][0]
	except Exception:
		return PROFILE_DEFAULT


def _res(base_dir, *parts):
	return os.path.join(base_dir, 'Res', *parts)


def _display_profile(base_dir, profile):
	if profile in _DISPLAY_PROFILES:
		subdir, filename, face = _DISPLAY_PROFILES[profile]
		path = _res(base_dir, subdir, filename)
		return path, path, face
	return None


def _text_bundle_for_language(base_dir, langid):
	if langid == 6:
		return (
			_res(base_dir, 'NotoSansSC-Regular.ttf'),
			_res(base_dir, 'NotoSansSC-Bold.ttf'),
			'Noto Sans SC',
		)
	if langid == 7:
		return (
			_res(base_dir, 'NotoSansTC-Regular.ttf'),
			_res(base_dir, 'NotoSansTC-Bold.ttf'),
			'Noto Sans TC',
		)
	if langid == 8:
		return (
			_res(base_dir, 'NotoSansKR-Regular.ttf'),
			_res(base_dir, 'NotoSansKR-Bold.ttf'),
			'Noto Sans KR',
		)
	return (
		_res(base_dir, 'FreeSans.ttf'),
		_res(base_dir, 'FreeSansBold.ttf'),
		'FreeSans',
	)


def apply_to_common(common_obj, opts, base_dir):
	profile = coerce_profile(getattr(opts, 'fontfamily', PROFILE_DEFAULT))
	langid = int(getattr(opts, 'langid', 0) or 0)
	text_regular, text_bold, text_face = _text_bundle_for_language(base_dir, langid)
	display_profile = _display_profile(base_dir, profile)

	if display_profile is not None and langid < 6:
		text_regular, text_bold, text_face = display_profile

	common_obj.abc = text_regular
	common_obj.abc_bold = text_bold if os.path.exists(text_bold) else text_regular
	common_obj.abc_face = text_face
	common_obj.abc_bold_face = text_face

	if display_profile is not None and langid < 6:
		common_obj.abc_italic = common_obj.abc
		common_obj.abc_bold_italic = common_obj.abc_bold
		common_obj.abc_ascii = text_regular
		common_obj.abc_ascii_bold = text_bold
		common_obj.abc_ascii_face = text_face
		common_obj.serif = text_regular
		common_obj.serif_bold = text_bold
		common_obj.serif_italic = text_regular
		common_obj.serif_bold_italic = text_bold
		common_obj.serif_face = text_face
		common_obj.serif_bold_face = text_face
	else:
		common_obj.abc_italic = common_obj.abc
		common_obj.abc_bold_italic = common_obj.abc_bold
		common_obj.abc_ascii = _res(base_dir, 'FreeSans.ttf')
		common_obj.abc_ascii_bold = _res(base_dir, 'FreeSansBold.ttf')
		common_obj.abc_ascii_face = text_face
		common_obj.serif = text_regular
		common_obj.serif_bold = common_obj.abc_bold
		common_obj.serif_italic = text_regular
		common_obj.serif_bold_italic = common_obj.abc_bold
		common_obj.serif_face = text_face
		common_obj.serif_bold_face = text_face


def common_font_paths(common_obj):
	attrs = (
		'symbols',
		'abc',
		'abc_bold',
		'abc_italic',
		'abc_bold_italic',
		'abc_ascii',
		'abc_ascii_bold',
		'freesans_bold',
		'serif',
		'serif_bold',
		'serif_italic',
		'serif_bold_italic',
	)
	paths = []
	for attr in attrs:
		path = getattr(common_obj, attr, None)
		if path and os.path.exists(path):
			paths.append(path)
	return paths
