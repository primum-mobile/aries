#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Split the built frontend into an embedded part and bundle resources.

Tauri embeds its frontend directory in the executable, once per architecture.
The large static media in ``webapp/frontend/out`` (fonts, astrolabe plates,
Urania art) is most of it, so a universal app would carry it twice. This
script leaves ``out/`` untouched (the browser build uses it as is) and stages
two packaging inputs under the Tauri target directory:

- ``aries-frontend-embedded``: ``out/`` without the media directories; this is
  the configured ``frontendDist``.
- ``aries-frontend-media``: the media files plus ``manifest.json``, bundled as
  the ``frontend-media`` resource directory.

A media file that is byte-identical to a file of the same name in the staged
``Res`` resources is not copied again; the manifest points at the ``Res`` copy.
The app answers the unchanged asset URLs from the manifest
(``src-tauri/src/frontend_media.rs``).

``--verify-bundle RESOURCES`` checks a built bundle's resource directory
against its own manifest.
"""

from __future__ import annotations

import argparse
import filecmp
import json
import shutil
from pathlib import Path

try:
    from scripts.staging_tree import create_staging_directory, publish_staged_tree
except ModuleNotFoundError:
    from staging_tree import create_staging_directory, publish_staged_tree


REPO_ROOT = Path(__file__).resolve().parents[1]
TARGET_ROOT = REPO_ROOT / "webapp" / "frontend" / "src-tauri" / "target"
DEFAULT_SOURCE = REPO_ROOT / "webapp" / "frontend" / "out"
DEFAULT_RES = TARGET_ROOT / "aries-runtime-resources" / "Res"
DEFAULT_EMBEDDED = TARGET_ROOT / "aries-frontend-embedded"
DEFAULT_MEDIA = TARGET_ROOT / "aries-frontend-media"

# Top-level directories of the built frontend served from bundle resources.
MEDIA_DIRECTORIES = ("fonts", "astrolabe", "urania")
MEDIA_RESOURCE_NAME = "frontend-media"
RES_RESOURCE_NAME = "Res"
MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1


def _copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise ValueError(f"refusing to stage symlinked frontend file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def stage_frontend_dist(
    source: Path, res: Path, embedded: Path, media: Path
) -> dict[str, str]:
    """Stage both trees and return the manifest's asset map."""
    source = source.resolve()
    if not (source / "index.html").is_file():
        raise FileNotFoundError(f"missing built frontend: {source / 'index.html'}")
    for destination in (embedded.resolve(), media.resolve()):
        if destination == source or source in destination.parents:
            raise ValueError("frontend staging destinations must be outside the built frontend")

    assets: dict[str, str] = {}
    staged_embedded = create_staging_directory(embedded)
    staged_media = create_staging_directory(media)
    try:
        for entry in sorted(source.rglob("*")):
            if not entry.is_file():
                continue
            relative = entry.relative_to(source)
            if relative.parts[0] not in MEDIA_DIRECTORIES:
                _copy_file(entry, staged_embedded / relative)
                continue
            key = "/" + relative.as_posix()
            shared = res / relative.name
            if shared.is_file() and filecmp.cmp(entry, shared, shallow=False):
                assets[key] = f"{RES_RESOURCE_NAME}/{relative.name}"
            else:
                _copy_file(entry, staged_media / relative)
                assets[key] = f"{MEDIA_RESOURCE_NAME}/{relative.as_posix()}"
        manifest = {"version": MANIFEST_VERSION, "assets": dict(sorted(assets.items()))}
        (staged_media / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=1, ensure_ascii=True) + "\n", encoding="utf-8"
        )
        publish_staged_tree(staged_embedded, embedded)
        publish_staged_tree(staged_media, media)
    except BaseException:
        shutil.rmtree(staged_embedded, ignore_errors=True)
        shutil.rmtree(staged_media, ignore_errors=True)
        raise
    return assets


def verify_bundle(resources: Path) -> list[str]:
    """Return problems with a bundle's frontend media; empty when complete."""
    manifest_path = resources / MEDIA_RESOURCE_NAME / MANIFEST_NAME
    if not manifest_path.is_file():
        return [f"missing {manifest_path}"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != MANIFEST_VERSION:
        return [f"unsupported manifest version: {manifest.get('version')!r}"]
    assets = manifest.get("assets") or {}
    if not assets:
        return ["frontend media manifest lists no assets"]
    problems = []
    for key, relative in sorted(assets.items()):
        parts = Path(relative).parts
        if not key.startswith("/") or not parts or Path(relative).is_absolute() or ".." in parts:
            problems.append(f"invalid manifest entry: {key} -> {relative}")
        elif not (resources / relative).is_file():
            problems.append(f"missing media file for {key}: {relative}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--res", type=Path, default=DEFAULT_RES)
    parser.add_argument("--embedded", type=Path, default=DEFAULT_EMBEDDED)
    parser.add_argument("--media", type=Path, default=DEFAULT_MEDIA)
    parser.add_argument("--verify-bundle", type=Path, metavar="RESOURCES")
    args = parser.parse_args()

    if args.verify_bundle is not None:
        problems = verify_bundle(args.verify_bundle)
        for problem in problems[:40]:
            print(problem)
        if problems:
            return 1
        print(f"Frontend media in {args.verify_bundle} matches its manifest.")
        return 0

    assets = stage_frontend_dist(args.source, args.res, args.embedded, args.media)
    shared = sum(1 for target in assets.values() if target.startswith(f"{RES_RESOURCE_NAME}/"))
    print(
        f"Staged the embedded frontend in {args.embedded} and {len(assets)} media files "
        f"({shared} shared with Res) in {args.media}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
