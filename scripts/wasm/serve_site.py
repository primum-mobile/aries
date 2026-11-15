#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Serve build/wasm/site under /webapp with the production .htaccess headers.

Like the production .htaccess, a file with a precompressed copy (foo.js.br,
foo.js.gz, written by build_web.py) is answered with that copy when the
browser accepts its encoding, keeping the original type and adding
Content-Encoding and Vary. Caching stays off (no-cache) for local testing.
"""

from __future__ import annotations

import email.utils
import http.server
import os
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[2] / "build" / "wasm" / "site"
PREFIX = "/webapp"
CSP = re.search(r'Content-Security-Policy "([^"]+)"', (SITE / ".htaccess").read_text()).group(1).replace(
	" upgrade-insecure-requests", "")
# Same file set as the .htaccess Vary rule.
COMPRESSIBLE = re.compile(r"\.(wasm|m?js|data|json|css|html|txt|svg|xml|zip|whl|ttf|otf|map|webmanifest)$", re.I)
ENCODINGS = (("br", ".br"), ("gzip", ".gz"))


def accepted_encodings(header: str) -> set[str]:
	accepted = set()
	for part in header.split(","):
		name, _, params = part.strip().partition(";")
		q = re.search(r"q\s*=\s*([0-9.]+)", params)
		if name and (not q or float(q.group(1)) > 0):
			accepted.add(name.strip().lower())
	return accepted


class Handler(http.server.SimpleHTTPRequestHandler):
	extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
	                  ".mjs": "text/javascript", ".js": "text/javascript"}

	def translate_path(self, path: str) -> str:
		path = path.split("?", 1)[0]
		if not path.startswith(PREFIX):
			return str(SITE / "__missing__")
		rel = path[len(PREFIX):].lstrip("/")
		target = SITE / rel
		# Like the .htaccess: /webapp/<page> and /webapp/<page>/ serve <page>.html
		# although the Next export also writes a <page>/ folder of prefetch data;
		# a folder with its own index.html keeps the slash redirect and index.
		page = SITE / (rel.rstrip("/") + ".html")
		if rel.strip("/") and not target.is_file() and page.is_file() and not (target / "index.html").is_file():
			target = page
		return str(target)

	def send_head(self):
		path = self.translate_path(self.path)
		if os.path.isdir(path) and self.path.split("?", 1)[0].endswith("/"):
			path = os.path.join(path, "index.html")
		self._vary = bool(COMPRESSIBLE.search(path))
		if not os.path.isfile(path) or not self._vary:
			return super().send_head()
		accepted = accepted_encodings(self.headers.get("Accept-Encoding", ""))
		for encoding, suffix in ENCODINGS:
			if encoding in accepted and os.path.isfile(path + suffix):
				break
		else:
			return super().send_head()
		handle = open(path + suffix, "rb")
		stat = os.fstat(handle.fileno())
		self.send_response(200)
		self.send_header("Content-Type", self.guess_type(path))
		self.send_header("Content-Encoding", encoding)
		self.send_header("Content-Length", str(stat.st_size))
		self.send_header("Last-Modified", email.utils.formatdate(stat.st_mtime, usegmt=True))
		self.end_headers()
		return handle

	def list_directory(self, path):
		# The .htaccess sets Options -Indexes.
		self.send_error(404)
		return None

	def end_headers(self) -> None:
		self.send_header("Content-Security-Policy", CSP)
		self.send_header("Service-Worker-Allowed", "/webapp/")
		self.send_header("Cache-Control", "no-cache")
		if getattr(self, "_vary", False):
			self.send_header("Vary", "Accept-Encoding")
		super().end_headers()


if __name__ == "__main__":
	port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
	http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
