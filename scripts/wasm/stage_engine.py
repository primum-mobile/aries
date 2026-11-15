#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Stage the Aries engine + daemon tree for the Pyodide (WASM) web build.

Copies the Python sources and the runtime data the daemon reads into
build/wasm/stage/app (mirroring repository-relative paths), stages the public
corpus packs' first-launch seeds from corpus/<pack>, drops native CPython
extensions, unpacks the WASM extension wheels from build/wasm/dist into place,
and writes build/wasm/out/aries-engine.zip.

With ARIES_WEB_RELEASE=1 (set by make web-deploy) a missing public pack seed
stops the build instead of warning.
"""

from __future__ import annotations

import os
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WASM = Path(os.environ.get("ARIES_WASM_DIR") or REPO / "build" / "wasm")
STAGE = REPO / "build" / "wasm" / "stage" / "app"
OUT = REPO / "build" / "wasm" / "out"

PY_TREES = ("engine", "aries", "rectification", "forecasting", "parsers", "corpus", "webapp/daemon")
PY_EXTRA = ("webapp/frontend/scripts",)
SKIP_DIRS = {"__pycache__", "tests", "build", "dist", ".venv", "node_modules", "ui"}
RES_SKIP = ("places.sqlite3", "cities500.zip", "NotoSans*", "FontTrials", "*.icns", "*.ico", "*.jpg", "*.bak",
	"*.pmtiles", ".DS_Store", "__pycache__", "helpChs_files", "starfont", "font-sources", "V7.3.0*", "Z 0_*")
DATA = (
	("Res", "Res"), ("Opts", "Opts"), ("Data", "Data"), ("Data/rt_0p5.txt", "data/rt_0p5.txt"),
	("images", "images"), ("corpus/parsed", "corpus/parsed"), ("Hors/Charts.jsonl", "Hors/Charts.jsonl"), ("Hors/Notes.json", "Hors/Notes.json"),
	("parsers/query_corpus.py", "parsers/query_corpus.py"),
	("webapp/frontend/src-tauri/native-menu-manifest.json", "webapp/frontend/src-tauri/native-menu-manifest.json"),
	("SWEP/Ephem/ast0", "SWEP/Ephem/ast0"), ("SWEP/Ephem/ast1", "SWEP/Ephem/ast1"), ("SWEP/Ephem/ast7", "SWEP/Ephem/ast7"),
)
DATA_GLOBS = ("scripts/i18n/*.json", "webapp/frontend/src/lib/chart/*.json", "webapp/daemon/*.json")
EPHE_KEEP = ("_06.se1", "_12.se1", "_18.se1", ".txt", ".json", ".cat", ".tsv")


sys.path.insert(0, str(REPO / "scripts"))
try:
	from export_public_source import should_copy  # noqa: E402
except ModuleNotFoundError:
	# A public source checkout is already the allowlisted tree and carries no
	# exporter, so every file in it may ship.
	def should_copy(rel, path):  # noqa: ARG001
		return True, "public source tree"
from stage_corpus_pack_seed import stage_pack  # noqa: E402

# The web build is publicly downloadable, so it ships only what the public
# source export allows (no private research corpus, forecasting/rectification
# or private corpus packs). Pack seeds are limited to public packs.
PUBLIC_PACK_SEEDS = ("valens",)
SKIPPED: list[str] = []


def copy(src: Path, dst: Path) -> None:
	rel = src.relative_to(REPO).as_posix()
	allowed, _reason = should_copy(rel, src)
	if not allowed:
		SKIPPED.append(rel)
		return
	dst.parent.mkdir(parents=True, exist_ok=True)
	shutil.copy2(src, dst)


def stage_python() -> int:
	count = 0
	for path in REPO.glob("*.py"):
		copy(path, STAGE / path.name)
		count += 1
	for tree in PY_TREES:
		for path in (REPO / tree).rglob("*"):
			rel = path.relative_to(REPO)
			if path.is_dir() or SKIP_DIRS & set(rel.parts[:-1]):
				continue
			if path.suffix in (".py", ".json", ".toml", ".yaml", ".yml", ".txt", ".md", ".tsv", ".csv"):
				copy(path, STAGE / rel)
				count += 1
	# aries/ui is wx presentation; keep only its token module used by the daemon.
	for keep in ("aries/ui/__init__.py", "aries/ui/tokens.py"):
		if (REPO / keep).exists():
			copy(REPO / keep, STAGE / keep)
	for tree in PY_EXTRA:
		for path in (REPO / tree).glob("*.py"):
			copy(path, STAGE / path.relative_to(REPO))
			count += 1
	return count


def stage_data() -> None:
	for item, dest in DATA:
		src = REPO / item
		if src.is_dir():
			skip = shutil.ignore_patterns(*RES_SKIP)
			for path in src.rglob("*"):
				parts = path.relative_to(src).parts
				if path.is_file() and not any(skip(str(path.parent), [part]) for part in parts):
					copy(path, STAGE / dest / path.relative_to(src))
		elif src.exists():
			copy(src, STAGE / dest)
		else:
			print(f"warning: missing {item}", file=sys.stderr)
	for pattern in DATA_GLOBS:
		for src in REPO.glob(pattern):
			copy(src, STAGE / src.relative_to(REPO))
	for path in (REPO / "SWEP" / "Ephem").iterdir():
		if path.is_file() and path.name.endswith(EPHE_KEEP):
			copy(path, STAGE / "SWEP" / "Ephem" / path.name)


def stage_pack_seeds() -> None:
	"""Stage the public packs' seeds as `make web-corpus` does for the desktop app.

	Staged straight from corpus/<pack>, so the browser build always carries the
	current pack whether or not the desktop resources were staged before.
	"""
	for pack in PUBLIC_PACK_SEEDS:
		source = REPO / "corpus" / pack
		if not (source / "manifest.toml").is_file():
			message = f"missing public pack seed corpus/{pack}"
			if os.environ.get("ARIES_WEB_RELEASE") == "1":
				raise SystemExit(f"error: {message}; a release build of the browser app must carry it")
			print(f"warning: {message}; the browser app ships without it", file=sys.stderr)
			continue
		stage_pack(source, STAGE / "pack-seeds")


PLACES_MIN_POPULATION = 5000
PLACES_ALIAS_MIN_POPULATION = 100_000


def stage_places() -> None:
	"""Ship a trimmed place index (towns of 5,000+ people) instead of the 89 MB one."""
	import sqlite3

	src = REPO / "Res" / "places.sqlite3"
	if not src.exists():
		print("warning: missing Res/places.sqlite3", file=sys.stderr)
		return
	target = STAGE / "Res" / "places.sqlite3"
	target.parent.mkdir(parents=True, exist_ok=True)
	target.unlink(missing_ok=True)
	with sqlite3.connect(src) as source, sqlite3.connect(target) as dest:
		source.backup(dest)
	with sqlite3.connect(target) as db:
		db.execute("DELETE FROM places WHERE COALESCE(population, 0) < ?", (PLACES_MIN_POPULATION,))
		# Alternate-language names are kept for cities of 100,000+ only.
		db.execute(
			"DELETE FROM place_aliases WHERE geonameid NOT IN "
			"(SELECT geonameid FROM places WHERE COALESCE(population, 0) >= ?)",
			(PLACES_ALIAS_MIN_POPULATION,),
		)
		db.execute("DELETE FROM places_rtree WHERE geonameid NOT IN (SELECT geonameid FROM places)")
		db.commit()
	with sqlite3.connect(target) as db:
		db.execute("VACUUM")


def stage_extensions() -> None:
	for wheel in (WASM / "dist").glob("*.whl"):
		with zipfile.ZipFile(wheel) as archive:
			for name in archive.namelist():
				if name.endswith(".so"):
					target = STAGE / name
					target.parent.mkdir(parents=True, exist_ok=True)
					target.write_bytes(archive.read(name))


def main() -> int:
	shutil.rmtree(STAGE, ignore_errors=True)
	STAGE.mkdir(parents=True)
	files = stage_python()
	stage_data()
	stage_pack_seeds()
	stage_places()
	stage_extensions()
	OUT.mkdir(parents=True, exist_ok=True)
	target = OUT / "aries-engine.zip"
	with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
		for path in sorted(STAGE.rglob("*")):
			if path.is_file():
				archive.write(path, path.relative_to(STAGE))
	print(f"withheld {len(SKIPPED)} non-public files (public export allowlist)")
	print(f"staged {files} source files; {target} {target.stat().st_size / 1e6:.1f} MB")
	return 0


if __name__ == "__main__":
	sys.exit(main())
