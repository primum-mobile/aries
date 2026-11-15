# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Application-owned user paths for Aries.

The fork used ``Morinus`` as the application-support folder for a long time.
Shipping Aries should write new state under ``Aries`` while preserving existing
user settings. Migration helpers here copy old files into the new location
without deleting or moving the legacy folder.
"""
from __future__ import annotations

import filecmp
import os
import shutil
import sys


APP_NAME = "Aries"
LEGACY_APP_NAME = "Morinus"
MIGRATION_MARKER = ".migrated-from-morinus"


def _home() -> str:
	return os.path.expanduser("~")


def app_support_dir(app_name: str = APP_NAME) -> str:
	home = _home()
	if sys.platform == "darwin":
		return os.path.join(home, "Library", "Application Support", app_name)
	if sys.platform.startswith("win"):
		appdata = os.environ.get("APPDATA")
		if appdata:
			return os.path.join(appdata, app_name)
		return os.path.join(home, "AppData", "Roaming", app_name)
	xdg_config = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
	return os.path.join(xdg_config, app_name)


def legacy_app_support_dir() -> str:
	return app_support_dir(LEGACY_APP_NAME)


def app_cache_dir(app_name: str = APP_NAME) -> str:
	"""Machine-local data Aries can download or rebuild again.

	On Windows this is ``%LOCALAPPDATA%\\Aries``: roaming ``%APPDATA%`` is
	copied to every machine at sign-in, which is wrong for offline map archives,
	downloaded helper tools and logs. Other platforms keep the support folder.
	"""
	if sys.platform.startswith("win"):
		import platform_compat

		local = platform_compat.local_app_data_dir()
		if local:
			return os.path.join(local, app_name)
	return app_support_dir(app_name)


def relocated_cache_dir(name: str) -> str:
	"""``app_cache_dir()/name``, moving an older support-folder copy there once.

	Earlier Windows builds kept caches under roaming ``%APPDATA%``. The folder
	is renamed into place when the new location does not exist yet; if it
	cannot move (another volume, a file still open) the old folder stays in use
	so nothing has to be downloaded again. The choice is made once per process,
	so a folder never moves underneath a file the daemon is already serving.
	"""
	current = os.path.join(app_cache_dir(), name)
	previous = os.path.join(app_support_dir(), name)
	if os.path.normcase(os.path.abspath(previous)) == os.path.normcase(os.path.abspath(current)):
		return current
	key = (previous, current)
	if key in _RELOCATED_CACHE_DIRS:
		return _RELOCATED_CACHE_DIRS[key]
	chosen = current
	if os.path.isdir(previous) and not os.path.exists(current):
		try:
			os.makedirs(os.path.dirname(current), exist_ok=True)
			os.replace(previous, current)
		except OSError:
			chosen = previous
	_RELOCATED_CACHE_DIRS[key] = chosen
	return chosen


_RELOCATED_CACHE_DIRS: dict[tuple[str, str], str] = {}


# `make run` sets this so the dev smoke app keeps its own settings folder. Two
# daemons sharing one folder (the dev app and an installed build) each rewrite
# whole option files from memory and silently undo each other's changes.
DEV_PROFILE_ENV = "ARIES_DEV_PROFILE"
DEV_OPTS_DIR_NAME = "Opts-dev"
DEV_SEED_MARKER = ".seeded-from-installed"


def dev_profile_active() -> bool:
	return os.environ.get(DEV_PROFILE_ENV, "").strip() == "1"


def installed_user_opts_dir() -> str:
	return os.path.join(app_support_dir(APP_NAME), "Opts")


# An explicit settings folder (the test suite uses it so runs never write the
# real one). It applies only while HOME is the home it was set for, so code that
# points HOME at an empty folder still gets a fresh install there.
OPTS_DIR_ENV = "ARIES_USER_OPTS_DIR"
OPTS_DIR_HOME_ENV = "ARIES_USER_OPTS_DIR_HOME"


def _opts_dir_override() -> str:
	override = os.environ.get(OPTS_DIR_ENV, "").strip()
	if override and os.environ.get(OPTS_DIR_HOME_ENV, _home()) == _home():
		return override
	return ""


def user_opts_dir(app_name: str = APP_NAME) -> str:
	if app_name == APP_NAME:
		override = _opts_dir_override()
		if override:
			return override
		if dev_profile_active():
			return os.path.join(app_support_dir(APP_NAME), DEV_OPTS_DIR_NAME)
	return os.path.join(app_support_dir(app_name), "Opts")


def legacy_user_opts_dir() -> str:
	return user_opts_dir(LEGACY_APP_NAME)


def _same_file(left: str, right: str) -> bool:
	try:
		return os.path.isfile(left) and os.path.isfile(right) and filecmp.cmp(left, right, shallow=False)
	except OSError:
		return False


def _copy_file(src: str, dst: str) -> bool:
	try:
		parent = os.path.dirname(dst)
		if parent:
			os.makedirs(parent, exist_ok=True)
		shutil.copy2(src, dst)
		return True
	except OSError:
		return False


def migrate_file_if_missing(legacy_path: str, current_path: str) -> bool:
	"""Copy one legacy file to the Aries path when Aries has no file yet."""
	if not legacy_path or not current_path:
		return False
	if os.path.exists(current_path) or not os.path.isfile(legacy_path):
		return False
	return _copy_file(legacy_path, current_path)


def _should_replace_default(dst: str, src: str, factory: str | None) -> bool:
	if not factory or not os.path.isfile(factory):
		return False
	if not _same_file(dst, factory):
		return False
	return not _same_file(src, dst)


def migrate_directory_contents(
	legacy_dir: str,
	current_dir: str,
	*,
	factory_dir: str | None = None,
	marker_name: str | None = None,
	marker_text: str = "Copied missing legacy Morinus settings into Aries. The Morinus folder was left intact.\n",
) -> int:
	"""Copy legacy directory contents into the Aries directory.

	Existing Aries files are preserved, except for the first-run options case
	where a file is still byte-identical to the shipped factory default and the
	legacy file differs. That protects real Aries edits while recovering old
	settings from an accidental factory seed.
	"""
	if not legacy_dir or not current_dir or not os.path.isdir(legacy_dir):
		return 0
	if os.path.abspath(legacy_dir) == os.path.abspath(current_dir):
		return 0

	marker_path = os.path.join(current_dir, marker_name) if marker_name else ""
	if marker_path and os.path.exists(marker_path):
		return 0

	copied = 0
	try:
		os.makedirs(current_dir, exist_ok=True)
	except OSError:
		return 0

	try:
		names = os.listdir(legacy_dir)
	except OSError:
		names = []

	for name in names:
		if marker_name and name == marker_name:
			continue
		src = os.path.join(legacy_dir, name)
		dst = os.path.join(current_dir, name)
		factory = os.path.join(factory_dir, name) if factory_dir else None
		if os.path.isdir(src):
			if not os.path.exists(dst):
				try:
					shutil.copytree(src, dst, symlinks=True)
					copied += 1
				except OSError:
					pass
			elif os.path.isdir(dst):
				copied += migrate_directory_contents(src, dst, factory_dir=factory)
			continue
		if not os.path.isfile(src):
			continue
		if not os.path.exists(dst) or _should_replace_default(dst, src, factory):
			if _copy_file(src, dst):
				copied += 1

	if marker_path:
		try:
			with open(marker_path, "w", encoding="utf-8") as handle:
				handle.write(marker_text)
		except OSError:
			pass
	return copied
