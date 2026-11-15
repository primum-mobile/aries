# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Single-threaded stand-ins for threads in the Pyodide (WASM) engine.

Pyodide cannot start threads. ``install()`` makes threadpool offloading
(FastAPI sync routes, ``ThreadPoolExecutor.submit``) and ``Thread.start`` run
their work inline. ``threading.Timer`` is the exception: ``Timer.run`` blocks
on ``Event.wait(interval)``, which would stall the whole engine for the
interval, so a timer started inside the event loop fires later through
``loop.call_later`` instead.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from typing import Any, Callable

# Called after a deferred timer has run, so the host can persist what it wrote
# (the worker mirrors HOME to IndexedDB only after requests otherwise).
on_background_work: Callable[[], Any] | None = None


def _notify_background_work() -> None:
	listener = on_background_work
	if listener is None:
		return
	try:
		listener()
	except Exception:  # noqa: BLE001 - persistence is best effort here
		pass


def schedule_timer(timer: threading.Timer) -> bool:
	"""Run ``timer`` from the running event loop after its interval.

	Returns False when no loop is running (the caller then runs it inline).
	``Timer.cancel()`` keeps working: it sets ``finished`` and the deferred
	call does nothing.
	"""
	try:
		loop = asyncio.get_running_loop()
	except RuntimeError:
		return False

	def fire() -> None:
		if timer.finished.is_set():
			return
		try:
			timer.function(*timer.args, **timer.kwargs)
		finally:
			timer.finished.set()
			_notify_background_work()

	loop.call_later(max(0.0, float(timer.interval)), fire)
	return True


def start_inline(thread: threading.Thread) -> None:
	"""``Thread.start`` for a single-threaded runtime."""
	if isinstance(thread, threading.Timer) and schedule_timer(thread):
		return
	thread.run()


async def run_sync_inline(func: Callable[..., Any], *args: Any, **_kwargs: Any) -> Any:
	return func(*args)


def submit_inline(
	_executor: concurrent.futures.ThreadPoolExecutor,
	fn: Callable[..., Any],
	/,
	*args: Any,
	**kwargs: Any,
) -> concurrent.futures.Future:
	# A real pool would start a worker thread that blocks forever on its queue.
	future: concurrent.futures.Future = concurrent.futures.Future()
	try:
		future.set_result(fn(*args, **kwargs))
	except BaseException as exc:  # noqa: BLE001 - delivered through the future
		future.set_exception(exc)
	return future


def install() -> None:
	"""Patch threading for the WASM worker. Never call this in a real daemon."""
	import anyio.to_thread

	anyio.to_thread.run_sync = run_sync_inline  # type: ignore[assignment]
	threading.Thread.start = start_inline  # type: ignore[method-assign]
	concurrent.futures.ThreadPoolExecutor.submit = submit_inline  # type: ignore[method-assign]
