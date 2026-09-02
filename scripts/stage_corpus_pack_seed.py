#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Stage explicitly named corpus packs as first-launch installation seeds."""

from __future__ import annotations

import argparse
import shutil
import tomllib
from pathlib import Path

try:
    from scripts.staging_tree import create_staging_directory, publish_staged_tree
except ModuleNotFoundError:
    from staging_tree import create_staging_directory, publish_staged_tree


def stage_pack(source: Path, destination_root: Path) -> str:
    source = source.resolve()
    manifest_path = source / "manifest.toml"
    if not manifest_path.is_file():
        raise ValueError(f"pack manifest is missing: {manifest_path}")
    with manifest_path.open("rb") as handle:
        manifest = tomllib.load(handle)
    pack_id = str((manifest.get("pack") or {}).get("id") or "").strip()
    if not pack_id or pack_id != source.name:
        raise ValueError("pack id must be present and match its directory name")

    destination_root.mkdir(parents=True, exist_ok=True)
    destination = destination_root / pack_id
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(
        source,
        destination,
        symlinks=True,
        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc", "*.bak"),
    )
    return pack_id


def stage_packs(sources: list[Path], destination: Path) -> list[str]:
    temporary = create_staging_directory(destination)
    try:
        staged = [stage_pack(source, temporary) for source in sources]
        publish_staged_tree(temporary, destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return staged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("sources", nargs="*", type=Path)
    args = parser.parse_args()
    staged = stage_packs(args.sources, args.destination)
    print(f"Staged pack seeds: {', '.join(staged) if staged else '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
