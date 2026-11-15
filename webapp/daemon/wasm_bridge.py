# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""In-process ASGI bridge for the Pyodide (WASM) web build.

The browser build has no HTTP server: a Web Worker runs this module under
Pyodide and hands it each request the frontend would have sent to the daemon.
``server.app`` stays the single route registry; this bridge only translates a
request into an ASGI ``scope`` and collects the response, and it carries the
``/ws/events`` socket over a JS callback instead of a network connection.

Pyodide cannot start threads; ``wasm_threading`` runs threadpool work and
``Thread.start`` inline and defers ``threading.Timer`` to the event loop.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Callable

from webapp.daemon import wasm_threading

wasm_threading.install()
os.environ["ARIES_WASM_ENGINE"] = "1"

os.environ.setdefault("ARIES_DAEMON_BASE_DIR", os.getcwd())

from webapp.daemon import server  # noqa: E402

app = server.app


def _export_table_pdf_inprocess(payload_path) -> None:
	# ReportLab is imported on the first table export, not at engine start:
	# it is about a third of the engine's import time.
	from webapp.frontend.scripts import export_table_pdf

	export_table_pdf.export(payload_path)


def _install_inprocess_table_pdf() -> None:
	# Desktop renders table PDFs in a helper process; Emscripten has no
	# processes, so the same renderer runs in-process here.
	from webapp.daemon import table_export_service

	table_export_service.TableExportService._run_table_export = staticmethod(_export_table_pdf_inprocess)


_install_inprocess_table_pdf()


def set_background_listener(listener: Callable[[], Any] | None) -> None:
	"""Let the worker persist files written by deferred timers (no request follows them)."""
	wasm_threading.on_background_work = listener


def seed_default_location(browser_timezone: str) -> str | None:
	"""Give a first-run browser user the largest city in their time zone.

	Desktop users pick a default location in Settings; a fresh browser profile
	would otherwise cast Here and Now for 0°N 0°E. Runs only while no default
	location has been saved, so a user's own choice is never overwritten.
	"""
	import sqlite3

	import default_location as default_location_model
	import localcities
	from webapp.daemon.chart_service import chart_snapshot_service

	opts = chart_snapshot_service.options
	if str(getattr(opts, "deflocname", "") or "").strip() or default_location_model.has_coordinates(opts):
		return None
	tz = (browser_timezone or "").strip()
	if not tz:
		return None
	with sqlite3.connect(localcities._resource_path("places.sqlite3")) as db:
		row = db.execute(
			"SELECT name, longitude, latitude FROM places WHERE timezone = ? "
			"ORDER BY COALESCE(population, 0) DESC LIMIT 1",
			(tz,),
		).fetchone()
	if row is None:
		return None
	name, lon, lat = row
	server.workspace_service.set_default_location_from_map(lon=float(lon), lat=float(lat), place_name=str(name))
	return str(name)


async def handle(method: str, path: str, query: str, headers: list[list[str]], body: bytes | None) -> dict:
	"""Run one HTTP request through the FastAPI app and return its response."""
	if hasattr(headers, "to_py"):
		headers = headers.to_py()
	if hasattr(body, "to_py"):
		body = bytes(body.to_py())
	scope = {
		"type": "http",
		"asgi": {"version": "3.0", "spec_version": "2.3"},
		"http_version": "1.1",
		"method": method.upper(),
		"scheme": "http",
		"path": path,
		"raw_path": path.encode(),
		"query_string": (query or "").encode(),
		"root_path": "",
		"headers": [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers],
		"client": ("127.0.0.1", 0),
		"server": ("127.0.0.1", 80),
	}
	sent_body = False

	async def receive() -> dict:
		nonlocal sent_body
		if not sent_body:
			sent_body = True
			return {"type": "http.request", "body": bytes(body or b""), "more_body": False}
		await asyncio.Event().wait()  # never disconnects
		return {"type": "http.disconnect"}

	status = 500
	response_headers: list[list[str]] = []
	chunks: list[bytes] = []

	async def send(message: dict) -> None:
		nonlocal status, response_headers
		if message["type"] == "http.response.start":
			status = message["status"]
			response_headers = [[k.decode("latin-1"), v.decode("latin-1")] for k, v in message.get("headers", [])]
		elif message["type"] == "http.response.body":
			chunks.append(message.get("body", b""))

	await app(scope, receive, send)
	return {"status": status, "headers": response_headers, "body": b"".join(chunks)}


class EventSocket:
	"""One ``/ws/events`` connection whose outbound frames go to ``emit``."""

	def __init__(self, emit: Callable[[str], None]) -> None:
		self._emit = emit
		self._inbox: asyncio.Queue[dict] = asyncio.Queue()
		self._inbox.put_nowait({"type": "websocket.connect"})
		self.task: asyncio.Task | None = None

	async def _receive(self) -> dict:
		return await self._inbox.get()

	async def _send(self, message: dict) -> None:
		if message["type"] == "websocket.send":
			text = message.get("text")
			if text is None and message.get("bytes") is not None:
				text = message["bytes"].decode("utf-8")
			if text is not None:
				self._emit(text)

	def start(self) -> None:
		scope = {
			"type": "websocket",
			"asgi": {"version": "3.0"},
			"scheme": "ws",
			"path": "/ws/events",
			"raw_path": b"/ws/events",
			"query_string": b"",
			"root_path": "",
			"headers": [],
			"client": ("127.0.0.1", 0),
			"server": ("127.0.0.1", 80),
			"subprotocols": [],
		}
		self.task = asyncio.ensure_future(app(scope, self._receive, self._send))

	def push_text(self, text: str) -> None:
		self._inbox.put_nowait({"type": "websocket.receive", "text": text})

	def close(self) -> None:
		self._inbox.put_nowait({"type": "websocket.disconnect", "code": 1000})


def open_events(emit: Callable[[str], None]) -> EventSocket:
	socket = EventSocket(emit)
	socket.start()
	return socket
