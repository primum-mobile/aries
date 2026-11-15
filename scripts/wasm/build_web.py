#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Assemble the browser (WASM) build of Aries into build/wasm/site.

Prerequisites: the Pyodide wheels for
sweastrology and the transit kernel in build/wasm/dist, the pure-Python extra
wheels in build/wasm/wheels, and the Pyodide runtime plus its cached package
wheels in build/wasm/node/node_modules/pyodide.

Steps: stage the engine zip, export the Next frontend under BASE_PATH, rebase
absolute public-asset URLs, inject the WASM boot script, copy the runtime,
service worker and engine worker next to it, and write precompressed (.br,
.gz) copies of the compressible files for the server to send as they are.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FRONTEND = REPO / "webapp" / "frontend"
# Toolchain artifacts can be shared from another checkout; the site output is per checkout.
WASM = Path(os.environ.get("ARIES_WASM_DIR") or REPO / "build" / "wasm")
SITE = REPO / "build" / "wasm" / "site"
PYODIDE = WASM / "node" / "node_modules" / "pyodide"
PYODIDE_CORE = ("pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json")
EXPORT_DIR = ".next-wasm"
# boot.js runs before the app's i18n loads; it reads these keys from the
# shipped locale catalogs (e.g. the "open in another tab" state).
BOOT_STRING_PREFIX = "webEngine."


def run(cmd: list[str], **kwargs) -> None:
	print("+", " ".join(cmd), flush=True)
	subprocess.run(cmd, check=True, **kwargs)


def export_frontend(base_path: str) -> Path:
	env = dict(os.environ, ARIES_NEXT_BASE_PATH=base_path, NEXT_PUBLIC_ARIES_DAEMON_URL="same-origin",
	           NEXT_PUBLIC_ARIES_WEB_ENGINE="1",
	           ARIES_NEXT_DIST_DIR=EXPORT_DIR)
	run(["npx", "next", "build"], cwd=FRONTEND, env=env)
	return FRONTEND / EXPORT_DIR


def rebase_public_urls(site: Path, base_path: str) -> None:
	public = sorted(p.name for p in (FRONTEND / "public").iterdir())
	names = "|".join(re.escape(n) for n in public)
	pattern = re.compile(r"""(url\(\s*(?:&quot;|["'])?|["'])/(""" + names + r""")(?=[/"')?&])""")
	for path in list(site.rglob("*.css")) + list(site.rglob("*.js")) + list(site.rglob("*.html")) + list(site.rglob("*.txt")):
		text = path.read_text(encoding="utf-8", errors="surrogateescape")
		updated = pattern.sub(lambda m: f"{m.group(1)}{base_path}/{m.group(2)}", text)
		if updated != text:
			path.write_text(updated, encoding="utf-8", errors="surrogateescape")


def inject_boot(site: Path, base_path: str) -> None:
	tag = f'<script src="{base_path}/wasm/boot.js"></script>'
	for html in site.rglob("*.html"):
		if html.relative_to(site).parts[0] == "aries-notes":
			continue
		text = html.read_text(encoding="utf-8")
		if "/wasm/boot.js" not in text:
			html.write_text(text.replace("<head>", "<head>" + tag, 1), encoding="utf-8")


def write_boot_strings(wasm: Path) -> None:
	catalogs = {}
	for path in sorted((FRONTEND / "src" / "locales").glob("*.json")):
		strings = json.loads(path.read_text(encoding="utf-8"))
		catalogs[path.stem] = {k: v for k, v in strings.items() if k.startswith(BOOT_STRING_PREFIX)}
	for locale, strings in catalogs.items():
		absent = sorted(set(catalogs["en"]) - set(strings))
		if absent:
			raise SystemExit(f"locale {locale} lacks boot strings: {', '.join(absent)}")
	(wasm / "boot-strings.json").write_text(json.dumps(catalogs, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def copy_runtime(site: Path) -> None:
	# Long-cached runtime files carry their version or content hash in the
	# name, so a deploy can never pair a fresh frontend with a stale engine.
	# engine-worker.js itself is served no-cache and names the current files.
	wasm = site / "wasm"
	pyodide_version = json.loads((PYODIDE / "package.json").read_text())["version"]
	pyodide_dir = f"pyodide-{pyodide_version}"
	engine_zip = REPO / "build" / "wasm" / "out" / "aries-engine.zip"
	engine_name = f"aries-engine.{hashlib.sha256(engine_zip.read_bytes()).hexdigest()[:12]}.zip"
	(wasm / pyodide_dir).mkdir(parents=True, exist_ok=True)
	(wasm / "wheels").mkdir(exist_ok=True)
	for name in PYODIDE_CORE:
		shutil.copy2(PYODIDE / name, wasm / pyodide_dir / name)
	for wheel in PYODIDE.glob("*.whl"):
		shutil.copy2(wheel, wasm / pyodide_dir / wheel.name)
	for wheel in (WASM / "wheels").glob("*.whl"):
		shutil.copy2(wheel, wasm / "wheels" / wheel.name)
	shutil.copy2(engine_zip, wasm / engine_name)
	shutil.copy2(REPO / "webapp" / "wasm" / "boot.js", wasm / "boot.js")
	worker = (REPO / "webapp" / "wasm" / "engine-worker.js").read_text(encoding="utf-8")
	for old, new in (('"aries-engine.zip"', f'"{engine_name}"'), ('"pyodide/"', f'"{pyodide_dir}/"')):
		if old not in worker:
			raise SystemExit(f"engine-worker.js no longer references {old}")
		worker = worker.replace(old, new)
	(wasm / "engine-worker.js").write_text(worker, encoding="utf-8")
	write_boot_strings(wasm)
	shutil.copy2(REPO / "webapp" / "wasm" / "sw.js", site / "sw.js")
	shutil.copy2(REPO / "webapp" / "wasm" / "htaccess", site / ".htaccess")


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	parser.add_argument("--base-path", default="/webapp")
	parser.add_argument("--skip-next", action="store_true", help="reuse the last frontend export")
	args = parser.parse_args()
	base_path = "/" + args.base_path.strip("/")

	run([sys.executable, str(REPO / "scripts" / "wasm" / "stage_engine.py")])
	exported = FRONTEND / EXPORT_DIR if args.skip_next else export_frontend(base_path)
	shutil.rmtree(SITE, ignore_errors=True)
	shutil.copytree(exported, SITE, ignore=shutil.ignore_patterns("cache", "server", "types", "*.nft.json", "trace*",
	                                                               "build-manifest.json", "BUILD_ID", "diagnostics"))
	rebase_public_urls(SITE, base_path)
	inject_boot(SITE, base_path)
	copy_runtime(SITE)
	run(["node", str(REPO / "scripts" / "wasm" / "precompress.mjs"), str(SITE)])
	files = [p for p in SITE.rglob("*") if p.is_file() and p.suffix not in (".br", ".gz")]
	size = sum(p.stat().st_size for p in files)
	# What a browser that takes Brotli downloads for the whole site.
	sent = sum((p.with_name(p.name + ".br") if p.with_name(p.name + ".br").is_file() else p).stat().st_size
	           for p in files)
	print(f"site ready: {SITE} ({size / 1e6:.1f} MB, {sent / 1e6:.1f} MB with brotli)")
	return 0


if __name__ == "__main__":
	sys.exit(main())
