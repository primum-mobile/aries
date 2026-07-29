#!/usr/bin/env python3
"""Stage one explicit corpus resource tree for packaging.

This module never discovers interpretation packs.  Pack authoring trees and
installed packs are outside the application-resource build input.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

try:
    from scripts.staging_tree import create_staging_directory, publish_staged_tree
except ModuleNotFoundError:
    from staging_tree import create_staging_directory, publish_staged_tree


IGNORED_RESOURCE_NAMES = frozenset({".DS_Store", "__pycache__"})
IGNORED_RESOURCE_SUFFIXES = (".bak", ".pyc")


def _ignored_resource(path: Path) -> bool:
    return (
        any(part in IGNORED_RESOURCE_NAMES for part in path.parts)
        or path.name.endswith(IGNORED_RESOURCE_SUFFIXES)
    )


def pyinstaller_corpus_datas(
    source: Path, destination_root: str = "corpus/parsed"
) -> list[tuple[str, str]]:
    """Return PyInstaller mappings for one explicit core-resource tree."""
    if not source.is_dir():
        return []
    datas: list[tuple[str, str]] = []
    for entry in sorted(source.rglob("*")):
        relative = entry.relative_to(source)
        if _ignored_resource(relative) or not entry.is_file():
            continue
        datas.append((str(entry), str(Path(destination_root) / relative.parent)))
    return datas


def stage_corpus(
    source: Path, destination: Path, *, destination_subdir: str | None = None
) -> list[str]:
    """Copy one explicit core-resource tree into *destination*."""
    source = source.resolve()
    destination = destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError("corpus staging destination must be outside the source tree")

    temporary = create_staging_directory(destination)
    target_root = temporary
    if destination_subdir:
        target_root = temporary / destination_subdir
        target_root.mkdir(parents=True)

    staged: list[str] = []
    try:
        if source.is_dir():
            for entry in sorted(source.iterdir(), key=lambda path: path.name):
                if _ignored_resource(Path(entry.name)):
                    continue
                target = target_root / entry.name
                if entry.is_dir():
                    shutil.copytree(
                        entry,
                        target,
                        symlinks=True,
                        ignore=shutil.ignore_patterns(
                            *IGNORED_RESOURCE_NAMES,
                            *(f"*{suffix}" for suffix in IGNORED_RESOURCE_SUFFIXES),
                        ),
                    )
                else:
                    shutil.copy2(entry, target, follow_symlinks=False)
                staged.append(entry.name)
        publish_staged_tree(temporary, destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return staged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--subdir")
    args = parser.parse_args()
    staged = stage_corpus(
        args.source, args.destination, destination_subdir=args.subdir
    )
    print(f"Staged core corpus resources: {', '.join(staged) if staged else '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
