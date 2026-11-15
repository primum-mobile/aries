# -*- coding: utf-8 -*-
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Small Windows adapters shared by the daemon and the calculation engine.

Every helper returns the existing macOS/Linux behaviour unchanged; only the
``win32`` branches do anything new. Keep this module dependency-free (stdlib
and ``ctypes`` only) because the engine, the daemon and the browser build all
import it.
"""
from __future__ import annotations

import os
import sys
import uuid

IS_WINDOWS = sys.platform == "win32"

# KnownFolders.h
FOLDERID_DOCUMENTS = "FDD39AD0-238F-46AF-ADB4-6C85480369C7"
FOLDERID_LOCAL_APP_DATA = "F1B32785-6FBA-4FCF-9D55-7B8E7F157091"

# Device names Windows reserves in every directory, with or without an
# extension ("CON.md" is still the console). Compared case-insensitively.
WINDOWS_RESERVED_NAMES = frozenset(
	["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"]
	+ [f"COM{index}" for index in "123456789¹²³"]
	+ [f"LPT{index}" for index in "123456789¹²³"]
)
WINDOWS_INVALID_FILENAME_CHARS = frozenset('<>:"/\\|?*')

# Swiss Ephemeris keeps the ephemeris path in a 256-byte buffer and silently
# falls back to its compiled-in default (Moshier) above 242 bytes, so long
# Windows paths also go through their short form.
_LONG_NATIVE_PATH_BYTES = 120


def _guid_struct(value: str):
	import ctypes

	class GUID(ctypes.Structure):
		_fields_ = [
			("Data1", ctypes.c_uint32),
			("Data2", ctypes.c_uint16),
			("Data3", ctypes.c_uint16),
			("Data4", ctypes.c_ubyte * 8),
		]

	parsed = uuid.UUID(value)
	return GUID(
		parsed.time_low,
		parsed.time_mid,
		parsed.time_hi_version,
		(ctypes.c_ubyte * 8).from_buffer_copy(parsed.bytes[8:]),
	)


def windows_known_folder(folder_id: str) -> str | None:
	"""Resolve a Windows Known Folder (``SHGetKnownFolderPath``) or ``None``.

	This follows OneDrive "Known Folder Move" and redirected profiles, which a
	``%USERPROFILE%\\Documents`` guess misses.
	"""
	if not IS_WINDOWS:
		return None
	try:
		import ctypes
		from ctypes import wintypes

		guid = _guid_struct(folder_id)
		shell32 = ctypes.WinDLL("shell32")
		ole32 = ctypes.WinDLL("ole32")
		shell32.SHGetKnownFolderPath.argtypes = [
			ctypes.POINTER(type(guid)),
			wintypes.DWORD,
			wintypes.HANDLE,
			ctypes.POINTER(ctypes.c_void_p),
		]
		shell32.SHGetKnownFolderPath.restype = ctypes.c_long
		ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
		ole32.CoTaskMemFree.restype = None
		raw = ctypes.c_void_p()
		result = shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(raw))
		try:
			if result != 0 or not raw.value:
				return None
			path = ctypes.wstring_at(raw.value)
		finally:
			if raw.value:
				ole32.CoTaskMemFree(raw)
		return path or None
	except Exception:
		return None


def documents_dir() -> str:
	"""The user's Documents folder (Known Folder on Windows)."""
	known = windows_known_folder(FOLDERID_DOCUMENTS)
	if known:
		return known
	return os.path.join(os.path.expanduser("~"), "Documents")


def local_app_data_dir() -> str | None:
	"""``%LOCALAPPDATA%`` on Windows (non-roaming), else ``None``."""
	if not IS_WINDOWS:
		return None
	known = windows_known_folder(FOLDERID_LOCAL_APP_DATA)
	if known:
		return known
	value = os.environ.get("LOCALAPPDATA", "").strip()
	if value:
		return value
	return os.path.join(os.path.expanduser("~"), "AppData", "Local")


def _windows_short_path(path: str) -> str | None:
	try:
		import ctypes
		from ctypes import wintypes

		kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
		kernel32.GetShortPathNameW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
		kernel32.GetShortPathNameW.restype = wintypes.DWORD
		size = kernel32.GetShortPathNameW(path, None, 0)
		if not size:
			return None
		buffer = ctypes.create_unicode_buffer(size)
		written = kernel32.GetShortPathNameW(path, buffer, size)
		if not written or written >= size:
			return None
		return buffer.value or None
	except Exception:
		return None


def _needs_native_path(path: str) -> bool:
	return not path.isascii() or len(path.encode("utf-8")) > _LONG_NATIVE_PATH_BYTES


def native_library_path(path: str) -> str:
	"""Path string for a C library that opens files with narrow ``fopen``.

	On Windows a non-ASCII or long directory (``C:\\Users\\Jürgen\\…``) is
	replaced by its 8.3 short form when the volume has one, so Swiss Ephemeris
	finds its ``.se1`` files and stays inside its 242-byte path buffer. The
	extension also opens UTF-8 paths through the wide API, so this is a second
	line of defence. A path with several ``os.pathsep``-separated entries is
	converted entry by entry. Elsewhere, and for plain ASCII paths, the input
	is returned unchanged.
	"""
	if not IS_WINDOWS or not path:
		return path
	parts = path.split(os.pathsep)
	if not any(_needs_native_path(part) for part in parts):
		return path
	converted = []
	for part in parts:
		short = _windows_short_path(part) if part and _needs_native_path(part) else None
		converted.append(short if short and short.isascii() else part)
	return os.pathsep.join(converted)


def is_windows_reserved_name(name: str) -> bool:
	"""``CON``, ``nul.txt``, ``com1.md`` … (the stem before the first dot)."""
	stem = str(name or "").split(".", 1)[0].rstrip(" ")
	return stem.upper() in WINDOWS_RESERVED_NAMES


def windows_filename_problem(name: str) -> str | None:
	"""Why ``name`` cannot be a Windows file name, or ``None`` when it can."""
	text = str(name or "")
	if any(char in WINDOWS_INVALID_FILENAME_CHARS or ord(char) < 32 for char in text):
		return "invalid-character"
	if text != text.rstrip(" ."):
		return "trailing-dot-or-space"
	if is_windows_reserved_name(text):
		return "reserved-name"
	return None
