# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Private framed IPC transport for the native Tauri shell.

The browser keeps using the daemon's HTTP server. The native shell sends the
same method/path/body contract over one retained Unix-domain socket, and this
module dispatches it through the existing ASGI app. No feature or calculation
logic lives in the transport.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import stat
import struct
import tempfile
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit


_LOG = logging.getLogger(__name__)

REQUEST_MAGIC = b"ARQ1"
RESPONSE_MAGIC = b"ARS1"
REQUEST_HEADER = struct.Struct("!4sBHI")
RESPONSE_HEADER = struct.Struct("!4sHI")
METHOD_GET = 0
METHOD_POST = 1
MAX_PATH_BYTES = 8 * 1024
MAX_BODY_BYTES = 32 * 1024 * 1024

AsgiApp = Callable[
    [
        dict[str, Any],
        Callable[[], Awaitable[dict[str, Any]]],
        Callable[[dict[str, Any]], Awaitable[None]],
    ],
    Awaitable[None],
]


class NativeIpcProtocolError(RuntimeError):
    pass


def _validated_socket_path(raw_path: str) -> Path:
    path = Path(raw_path)
    temp_root = Path(tempfile.gettempdir()).resolve()
    if path.parent.resolve() != temp_root:
        raise ValueError("native IPC socket must live in the process temporary directory")
    if not path.name.startswith("aries-native-") or path.suffix != ".sock":
        raise ValueError("native IPC socket name is invalid")
    encoded = os.fsencode(path)
    if len(encoded) >= 100:
        raise ValueError("native IPC socket path is too long")
    return path


def _remove_socket(path: Path) -> None:
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(mode):
        raise ValueError(f"refusing to replace non-socket native IPC path: {path}")
    path.unlink()


async def _dispatch_asgi(
    app: AsgiApp,
    token: str,
    method: str,
    target: str,
    body: bytes,
) -> tuple[int, bytes]:
    parsed = urlsplit(target)
    if (
        parsed.scheme
        or parsed.netloc
        or not parsed.path.startswith("/")
        or "\r" in target
        or "\n" in target
    ):
        return 400, b'{"detail":"invalid native daemon path"}'

    request_pending = True

    async def receive() -> dict[str, Any]:
        nonlocal request_pending
        if request_pending:
            request_pending = False
            return {
                "type": "http.request",
                "body": body,
                "more_body": False,
            }
        return {"type": "http.disconnect"}

    status = 500
    response_chunks: list[bytes] = []

    async def send(message: dict[str, Any]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = int(message["status"])
        elif message["type"] == "http.response.body":
            response_chunks.append(bytes(message.get("body", b"")))

    headers = [(b"host", b"aries-native")]
    if token:
        headers.append((b"x-aries-token", token.encode("utf-8")))
    if body:
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(body)).encode("ascii")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": parsed.path,
        "raw_path": parsed.path.encode("utf-8"),
        "query_string": parsed.query.encode("utf-8"),
        "root_path": "",
        "headers": headers,
        "client": None,
        "server": ("aries-native", 0),
        "state": {},
    }
    try:
        await app(scope, receive, send)
    except Exception:
        _LOG.exception("native IPC ASGI dispatch failed")
        return 500, b'{"detail":"native daemon request failed"}'
    return status, b"".join(response_chunks)


class NativeIpcServer:
    def __init__(self, app: AsgiApp, socket_path: str, token: str) -> None:
        self._app = app
        self.path = _validated_socket_path(socket_path)
        self._token = token
        self._server: asyncio.AbstractServer | None = None
        self._connections: set[asyncio.StreamWriter] = set()

    async def start(self) -> None:
        if self._server is not None:
            return
        _remove_socket(self.path)
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        previous_umask = os.umask(0o177)
        try:
            listener.bind(os.fspath(self.path))
        finally:
            os.umask(previous_umask)
        os.chmod(self.path, 0o600)
        listener.listen(4)
        listener.setblocking(False)
        try:
            self._server = await asyncio.start_unix_server(
                self._serve_connection,
                sock=listener,
                backlog=4,
            )
        except BaseException:
            listener.close()
            _remove_socket(self.path)
            raise

    async def stop(self) -> None:
        server = self._server
        self._server = None
        if server is not None:
            server.close()
            await server.wait_closed()
        connections = tuple(self._connections)
        for writer in connections:
            writer.close()
        if connections:
            await asyncio.gather(
                *(writer.wait_closed() for writer in connections),
                return_exceptions=True,
            )
        self._connections.clear()
        try:
            _remove_socket(self.path)
        except ValueError:
            _LOG.warning("native IPC path changed before cleanup: %s", self.path)

    async def __aenter__(self) -> NativeIpcServer:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.stop()

    async def _serve_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self._connections.add(writer)
        try:
            while True:
                try:
                    header = await reader.readexactly(REQUEST_HEADER.size)
                except asyncio.IncompleteReadError as exc:
                    if not exc.partial:
                        return
                    raise NativeIpcProtocolError("native IPC frame ended early") from exc
                await self._serve_frame(reader, writer, header)
        except (ConnectionError, OSError, NativeIpcProtocolError):
            _LOG.warning("native IPC connection closed after protocol error")
        finally:
            self._connections.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    async def _serve_frame(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        header: bytes,
    ) -> None:
        magic, method_code, path_length, body_length = REQUEST_HEADER.unpack(header)
        if magic != REQUEST_MAGIC:
            raise NativeIpcProtocolError("native IPC request magic is invalid")
        if path_length == 0 or path_length > MAX_PATH_BYTES:
            raise NativeIpcProtocolError("native IPC request path is invalid")
        if body_length > MAX_BODY_BYTES:
            raise NativeIpcProtocolError("native IPC request body is too large")
        method = {METHOD_GET: "GET", METHOD_POST: "POST"}.get(method_code)
        if method is None:
            raise NativeIpcProtocolError("native IPC request method is invalid")
        try:
            path_bytes = await reader.readexactly(path_length)
            body = await reader.readexactly(body_length)
        except asyncio.IncompleteReadError as exc:
            raise NativeIpcProtocolError("native IPC frame ended early") from exc
        try:
            target = path_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise NativeIpcProtocolError("native IPC request path is not UTF-8") from exc
        status, response_body = await _dispatch_asgi(
            self._app,
            self._token,
            method,
            target,
            body,
        )
        if len(response_body) > MAX_BODY_BYTES:
            status = 500
            response_body = b'{"detail":"native daemon response is too large"}'
        writer.write(
            RESPONSE_HEADER.pack(RESPONSE_MAGIC, status, len(response_body))
            + response_body
        )
        await writer.drain()


async def start_native_ipc_server(
    app: AsgiApp,
    socket_path: str | None = None,
) -> NativeIpcServer | None:
    raw_path = (socket_path or os.environ.get("ARIES_DAEMON_SOCKET", "")).strip()
    if not raw_path or os.name == "nt":
        return None
    server = NativeIpcServer(
        app,
        raw_path,
        os.environ.get("ARIES_DAEMON_TOKEN", "").strip(),
    )
    await server.start()
    return server
