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


def user_opts_dir(app_name: str = APP_NAME) -> str:
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
				handle.write("Copied missing legacy Morinus settings into Aries. The Morinus folder was left intact.\n")
		except OSError:
			pass
	return copied
