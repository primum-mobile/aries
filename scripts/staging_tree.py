#!/usr/bin/env python3
"""Publish generated resource trees without touching unchanged destinations."""

from __future__ import annotations

import filecmp
import os
import shutil
import stat
import tempfile
import uuid
from pathlib import Path


def create_staging_directory(destination: Path) -> Path:
    """Return a unique temporary sibling directory for *destination*."""
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    return Path(
        tempfile.mkdtemp(
            prefix=f".{destination.name}.stage-",
            dir=destination.parent,
        )
    )


def _tree_entries(root: Path) -> dict[str, tuple[str, int, int | str]]:
    entries: dict[str, tuple[str, int, int | str]] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        mode = stat.S_IMODE(metadata.st_mode)
        if path.is_symlink():
            entries[relative] = ("symlink", mode, os.readlink(path))
        elif path.is_dir():
            entries[relative] = ("directory", mode, 0)
        elif path.is_file():
            entries[relative] = ("file", mode, metadata.st_size)
        else:
            entries[relative] = ("other", mode, metadata.st_size)
    return entries


def trees_equal(left: Path, right: Path) -> bool:
    """Compare two resource trees by layout, type, mode, and file content."""
    if not left.is_dir() or left.is_symlink():
        return False
    if not right.is_dir() or right.is_symlink():
        return False

    left_entries = _tree_entries(left)
    if left_entries != _tree_entries(right):
        return False
    for relative, (kind, _, _) in left_entries.items():
        if kind == "file" and not filecmp.cmp(
            left / relative,
            right / relative,
            shallow=False,
        ):
            return False
    return True


def publish_staged_tree(staged: Path, destination: Path) -> bool:
    """Install *staged* only when its content differs from *destination*.

    Returns ``True`` when the destination changed. An existing destination is
    moved aside first so a failed publish can restore the previous tree.
    """
    staged = staged.resolve()
    destination = destination.resolve()
    if not staged.is_dir() or staged.is_symlink():
        raise ValueError(f"staged resource tree must be a directory: {staged}")

    if trees_equal(staged, destination):
        shutil.rmtree(staged)
        return False

    backup: Path | None = None
    if destination.exists() or destination.is_symlink():
        backup = destination.with_name(
            f".{destination.name}.previous-{uuid.uuid4().hex}"
        )
        destination.replace(backup)
    try:
        staged.replace(destination)
    except BaseException:
        if backup is not None and not destination.exists():
            backup.replace(destination)
        raise
    else:
        if backup is not None:
            if backup.is_dir() and not backup.is_symlink():
                shutil.rmtree(backup)
            else:
                backup.unlink()
    return True
