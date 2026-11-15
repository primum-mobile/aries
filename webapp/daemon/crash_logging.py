# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Make fatal daemon errors reach the Windows log with a traceback.

On Windows the native shell pipes the daemon's stdout and stderr into
timestamped, size-capped files in ``%LOCALAPPDATA%\\Aries\\logs``
(``aries-daemon.out.log`` / ``aries-daemon.err.log``). A tester's report is
the only signal from that platform, so the daemon:

- writes one start-up line (pid, Python, UTF-8 mode, encodings);
- dumps every thread's Python stack on a hard crash (``faulthandler``), for
  example an access violation inside a native extension;
- labels uncaught exceptions, in the main thread and in worker threads, and
  flushes them before the process ends.

macOS, Linux and the browser build keep Python's default behaviour.
"""

from __future__ import annotations

import faulthandler
import locale
import os
import sys
import threading
import traceback
from collections.abc import Callable
from typing import Any, TextIO


def _write(stream: TextIO, text: str) -> None:
    try:
        stream.write(text)
        stream.flush()
    except Exception:
        pass


def startup_line() -> str:
    try:
        preferred = locale.getpreferredencoding(False)
    except Exception:
        preferred = "?"
    return (
        f"Aries daemon starting: pid {os.getpid()}, Python {sys.version.split()[0]}, "
        f"frozen {bool(getattr(sys, 'frozen', False))}, utf8_mode {sys.flags.utf8_mode}, "
        f"filesystem encoding {sys.getfilesystemencoding()}, preferred encoding {preferred}\n"
    )


def install(
    stream: TextIO | None = None,
    *,
    platform: str = sys.platform,
    enable_faulthandler: Callable[..., Any] = faulthandler.enable,
) -> bool:
    """Install the Windows crash logging; returns whether anything changed."""
    if platform != "win32":
        return False
    stream = stream if stream is not None else sys.stderr
    if stream is None:
        return False
    try:
        enable_faulthandler(file=stream, all_threads=True)
    except Exception as exc:  # a stream without a file descriptor
        _write(stream, f"faulthandler unavailable: {exc!r}\n")

    previous_excepthook = sys.excepthook

    def excepthook(exc_type, exc, tb) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            previous_excepthook(exc_type, exc, tb)
            return
        try:
            stream.write(f"Uncaught exception in the Aries daemon (pid {os.getpid()}):\n")
            traceback.print_exception(exc_type, exc, tb, file=stream)
            stream.flush()
        except Exception:
            previous_excepthook(exc_type, exc, tb)

    def thread_excepthook(args: threading.ExceptHookArgs) -> None:
        if args.exc_type is SystemExit:
            return
        name = args.thread.name if args.thread is not None else "unknown"
        try:
            stream.write(f"Uncaught exception in Aries daemon thread {name!r}:\n")
            traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback, file=stream)
            stream.flush()
        except Exception:
            pass

    sys.excepthook = excepthook
    threading.excepthook = thread_excepthook
    _write(stream, startup_line())
    return True
