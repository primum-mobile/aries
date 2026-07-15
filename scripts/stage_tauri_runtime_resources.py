#!/usr/bin/env python3
"""Stage the Tauri runtime resource tree from explicit public inputs.

The Tauri bundle must not copy the working ``Res/``, ``Data/``, or
``parsers/`` directories wholesale: Finder metadata, SQLite journals, parser
bytecode, legacy splash/icon files, and old help artifacts otherwise become
part of a signed application.  This script leaves those source files alone and
creates a clean, reproducible packaging input under the Tauri target directory.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = (
    REPO_ROOT
    / "webapp"
    / "frontend"
    / "src-tauri"
    / "target"
    / "aries-runtime-resources"
)

# These remain in the private/legacy source tree where appropriate, but are
# neither needed nor wanted in a Tauri runtime bundle.
EXCLUDED_RES_NAMES = frozenset(
    {
        ".DS_Store",
        "Aries.icns",  # copied separately as the app's CFBundle icon
        "Morinus.icns",
        "Morinus.ico",
        "Morinus.jpg",
        "Morinus-legacy.icns",
        "V7.3.0 Leggimi.txt",
        "V7.3.0 Readme.txt",
        "Z 0_Bitacora-Elias.txt",
        # Factory resources must never seed a customer's location, search
        # history, or saved custom panel.
        "deflocation.opt",
        "search.opt",
        "userpanel.opt",
        "_test.json",
    }
)
EXCLUDED_RES_PARTS = frozenset({"__pycache__", "helpChs_files", "starfont"})
EXCLUDED_RES_SUFFIXES = frozenset(
    {
        ".bak",
        ".icns",
        ".ico",
        ".jpg",
        ".jpeg",
        ".png",
        ".pyc",
        ".sqlite-shm",
        ".sqlite-wal",
        ".sqlite3-shm",
        ".sqlite3-wal",
    }
)


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def excluded_res_path(relative: Path) -> bool:
    """Return whether a path below ``Res`` must stay out of the package."""
    return (
        any(part.startswith(".") or part in EXCLUDED_RES_PARTS for part in relative.parts)
        or relative.name in EXCLUDED_RES_NAMES
        or relative.suffix.lower() in EXCLUDED_RES_SUFFIXES
        or (len(relative.parts) == 1 and relative.name.startswith("help"))
    )


def _copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise ValueError(f"refusing to stage symlinked resource: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _stage_res(source: Path, destination: Path) -> list[str]:
    if not source.is_dir():
        raise FileNotFoundError(f"missing resource directory: {source}")

    staged: list[str] = []
    for entry in sorted(source.rglob("*")):
        if not entry.is_file():
            continue
        relative = entry.relative_to(source)
        if excluded_res_path(relative):
            continue
        _copy_file(entry, destination / "Res" / relative)
        staged.append((Path("Res") / relative).as_posix())
    return staged


def stage_runtime_resources(source_root: Path, destination: Path) -> list[str]:
    """Create a clean Tauri resource input directory and return copied paths."""
    source_root = source_root.resolve()
    destination = destination.resolve()
    source_res = source_root / "Res"
    source_data = source_root / "Data"
    source_parsers = source_root / "parsers"

    if destination == source_root or any(
        _is_within(destination, source) for source in (source_res, source_data, source_parsers)
    ):
        raise ValueError("runtime staging destination must be outside source resource trees")

    rising_times = source_data / "rt_0p5.txt"
    corpus_parser = source_parsers / "query_corpus.py"
    for required in (rising_times, corpus_parser):
        if not required.is_file():
            raise FileNotFoundError(f"missing required Tauri resource: {required}")

    temporary = destination.with_name(destination.name + ".tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True)

    try:
        staged = _stage_res(source_res, temporary)
        _copy_file(rising_times, temporary / "data" / "rt_0p5.txt")
        _copy_file(corpus_parser, temporary / "parsers" / "query_corpus.py")
        staged.extend(("data/rt_0p5.txt", "parsers/query_corpus.py"))

        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    return staged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()

    staged = stage_runtime_resources(args.source_root, args.destination)
    print(f"Staged {len(staged)} Tauri runtime resource files in {args.destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
