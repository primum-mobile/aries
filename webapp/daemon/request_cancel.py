# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stop blocking daemon work once its HTTP client has gone away.

Aborting a ``fetch`` in the app closes the request, but a synchronous FastAPI
route keeps running in the threadpool and holds its service lock, so the next
request for the same surface waits behind work nobody will read. Long list
routes run through ``run_until_disconnected`` and check the cancel event at
safe points; a cancelled route raises ``RequestCancelled``.
"""
from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterable, Iterator, Optional, TypeVar

from starlette.concurrency import run_in_threadpool

T = TypeVar("T")

DISCONNECT_POLL_SECONDS = 0.05
CANCELLED_STATUS_CODE = 499  # client closed request; nobody receives the body


class RequestCancelled(Exception):
    """The client abandoned this request; its result would be discarded."""


def raise_if_cancelled(cancel: Optional[threading.Event]) -> None:
    if cancel is not None and cancel.is_set():
        raise RequestCancelled()


@contextmanager
def cancellable_lock(lock, cancel: Optional[threading.Event]):
    """Keep calculation serialization, but let abandoned queued work leave."""
    while True:
        raise_if_cancelled(cancel)
        if lock.acquire(timeout=DISCONNECT_POLL_SECONDS):
            break
    try:
        raise_if_cancelled(cancel)
        yield
    finally:
        lock.release()


def until_cancelled(
    items: Iterable[T],
    cancel: Optional[threading.Event],
    every: int = 128,
) -> Iterator[T]:
    """Yield ``items``, checking ``cancel`` before every ``every``-th item."""
    for index, item in enumerate(items):
        if index % every == 0:
            raise_if_cancelled(cancel)
        yield item


async def run_until_disconnected(request: Any, fn: Callable[..., T], /, **kwargs: Any) -> T:
    """Run ``fn(cancel=event, **kwargs)`` in the threadpool.

    ``event`` is set as soon as ``request`` reports a client disconnect, so
    ``fn`` can stop at its next check instead of finishing unread work.
    """
    cancel = threading.Event()

    async def watch_disconnect() -> None:
        while not await request.is_disconnected():
            await asyncio.sleep(DISCONNECT_POLL_SECONDS)
        cancel.set()

    # Only the watcher is a separate task. The work itself is awaited in the
    # request coroutine, so its exceptions (including SystemExit for a missing
    # chart) reach the route's handlers exactly as on a synchronous route.
    watcher = asyncio.ensure_future(watch_disconnect())
    try:
        def work():
            # All Search-backed list routes inherit the same cooperative scope.
            from aries.astrology.transit_fast.api import search_cancellation_scope

            def cancelled():
                raise_if_cancelled(cancel)
                return False

            with search_cancellation_scope(cancelled):
                raise_if_cancelled(cancel)
                result = fn(cancel=cancel, **kwargs)
                raise_if_cancelled(cancel)
                return result

        return await run_in_threadpool(work)
    finally:
        watcher.cancel()
