# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Exit the daemon when the native Aries process that launched it exits.

The native shell passes its PID in ``ARIES_DAEMON_PARENT_PID``. On macOS and
Linux the daemon polls that PID with signal 0 every two seconds.

On Windows the native shell also places the daemon in a kill-on-close Job
Object, so this watchdog is the backstop. Windows reuses PIDs quickly, so
polling by PID can mistake an unrelated process for Aries and keep the daemon
alive forever. Instead the daemon opens one ``SYNCHRONIZE`` handle on the
parent at startup, checks that the handle names the original parent by its
creation time (``ARIES_DAEMON_PARENT_CREATED``, FILETIME ticks), and waits on
it. A held handle keeps its process object alive, so it cannot be fooled by
PID reuse once open.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

PARENT_PID_ENV = "ARIES_DAEMON_PARENT_PID"
PARENT_CREATED_ENV = "ARIES_DAEMON_PARENT_CREATED"
POLL_INTERVAL_SECONDS = 2.0

_SYNCHRONIZE = 0x0010_0000
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259
_INFINITE = 0xFFFF_FFFF
_WAIT_OBJECT_0 = 0
_ERROR_ACCESS_DENIED = 5
_ERROR_INVALID_PARAMETER = 87


def _exit_now() -> None:
    os._exit(0)


def parent_pid_from_env(environ: Mapping[str, str]) -> int | None:
    value = environ.get(PARENT_PID_ENV, "").strip()
    if not value:
        return None
    try:
        pid = int(value)
    except ValueError:
        return None
    return pid if pid > 1 else None


def parent_created_from_env(environ: Mapping[str, str]) -> int | None:
    value = environ.get(PARENT_CREATED_ENV, "").strip()
    if not value:
        return None
    try:
        created = int(value)
    except ValueError:
        return None
    return created if created > 0 else None


def pid_exists(pid: int) -> bool:
    if sys.platform == "win32":
        return _windows_pid_exists(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _windows_pid_exists(pid: int) -> bool:
    """Probe a Windows PID without sending it a signal.

    CPython implements most ``os.kill`` signals on Windows with
    ``TerminateProcess``; even the POSIX-style signal 0 probe can therefore
    terminate the Tauri parent. Query the process handle and exit code instead.
    """
    api = WindowsProcessApi()
    handle, error = api.open_process(pid, _PROCESS_QUERY_LIMITED_INFORMATION)
    if not handle:
        # Access denied still proves that the process exists.
        return error == _ERROR_ACCESS_DENIED
    try:
        exit_code = api.exit_code(handle)
        return exit_code is None or exit_code == _STILL_ACTIVE
    finally:
        api.close(handle)


class WindowsProcessApi:
    """Thin ctypes wrapper over the kernel32 calls the watchdog needs."""

    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        self._ctypes = ctypes
        self._wintypes = wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.GetCurrentProcess.argtypes = []
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel32.GetExitCodeProcess.restype = wintypes.BOOL
        kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        kernel32.GetProcessTimes.restype = wintypes.BOOL
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        self._kernel32 = kernel32

    def open_process(self, pid: int, access: int) -> tuple[Any, int]:
        handle = self._kernel32.OpenProcess(access, False, pid)
        return handle, (0 if handle else self._ctypes.get_last_error())

    def current_process(self) -> Any:
        return self._kernel32.GetCurrentProcess()

    def exit_code(self, handle: Any) -> int | None:
        code = self._wintypes.DWORD()
        if not self._kernel32.GetExitCodeProcess(handle, self._ctypes.byref(code)):
            return None
        return int(code.value)

    def creation_time(self, handle: Any) -> int | None:
        times = [self._wintypes.FILETIME() for _ in range(4)]
        if not self._kernel32.GetProcessTimes(handle, *(self._ctypes.byref(t) for t in times)):
            return None
        created = times[0]
        return (int(created.dwHighDateTime) << 32) | int(created.dwLowDateTime)

    def wait(self, handle: Any) -> int:
        return int(self._kernel32.WaitForSingleObject(handle, _INFINITE))

    def close(self, handle: Any) -> None:
        self._kernel32.CloseHandle(handle)


def _poll_parent(
    pid: int,
    on_parent_exit: Callable[[], None],
    exists: Callable[[int], bool],
    sleep: Callable[[float], None],
) -> None:
    while True:
        sleep(POLL_INTERVAL_SECONDS)
        if not exists(pid):
            on_parent_exit()
            return


def open_windows_parent(
    api: Any, pid: int, expected_created: int | None
) -> tuple[str, Any]:
    """Open and verify the parent handle.

    Returns ``("handle", handle)`` for a verified live parent, ``("gone", None)``
    when the parent has already exited or its PID now names another process,
    and ``("unavailable", None)`` when only PID polling can watch the parent.
    """
    handle, error = api.open_process(pid, _SYNCHRONIZE | _PROCESS_QUERY_LIMITED_INFORMATION)
    if not handle:
        if error == _ERROR_INVALID_PARAMETER:
            return "gone", None
        return "unavailable", None
    created = api.creation_time(handle)
    if created is not None:
        if expected_created is not None:
            reused = created != expected_created
        else:
            # Without the launcher's stamp, a parent must still predate its child.
            own_created = api.creation_time(api.current_process())
            reused = own_created is not None and created > own_created
        if reused:
            api.close(handle)
            return "gone", None
    exit_code = api.exit_code(handle)
    if exit_code is not None and exit_code != _STILL_ACTIVE:
        api.close(handle)
        return "gone", None
    return "handle", handle


def _wait_windows_parent(
    api: Any,
    handle: Any,
    pid: int,
    on_parent_exit: Callable[[], None],
    exists: Callable[[int], bool],
    sleep: Callable[[float], None],
) -> None:
    try:
        result = api.wait(handle)
    finally:
        api.close(handle)
    if result == _WAIT_OBJECT_0:
        on_parent_exit()
        return
    # WAIT_FAILED should not happen on a valid SYNCHRONIZE handle; keep the
    # old PID poll as the backstop rather than leaving the daemon unwatched.
    _poll_parent(pid, on_parent_exit, exists, sleep)


def start_parent_watchdog(
    environ: Mapping[str, str] | None = None,
    *,
    on_parent_exit: Callable[[], None] = _exit_now,
    platform: str | None = None,
    windows_api_factory: Callable[[], Any] = WindowsProcessApi,
    exists: Callable[[int], bool] = pid_exists,
    sleep: Callable[[float], None] = time.sleep,
) -> threading.Thread | None:
    """Start the parent watchdog thread; return it, or ``None`` when not needed."""
    env = os.environ if environ is None else environ
    pid = parent_pid_from_env(env)
    if pid is None:
        return None
    target: Callable[[], None]
    if (platform or sys.platform) == "win32":
        try:
            api = windows_api_factory()
            status, handle = open_windows_parent(api, pid, parent_created_from_env(env))
        except Exception:
            status, handle = "unavailable", None
        if status == "gone":
            on_parent_exit()
            return None
        if status == "handle":

            def target() -> None:
                _wait_windows_parent(api, handle, pid, on_parent_exit, exists, sleep)

        else:

            def target() -> None:
                _poll_parent(pid, on_parent_exit, exists, sleep)

    else:

        def target() -> None:
            _poll_parent(pid, on_parent_exit, exists, sleep)

    thread = threading.Thread(target=target, name="aries-parent-watchdog", daemon=True)
    thread.start()
    return thread
