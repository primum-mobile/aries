#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Prepare and validate the persistent Aries development worktree."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_TMP = Path("/private/tmp")
DEPENDENCY_TREES = (
    Path("webapp/frontend/node_modules"),
    Path("notes_web/node_modules"),
)
PYTHON_ENV = Path("webapp/.venv")


def _git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.run(
        ("git", *args),
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout.strip()


def _primary_checkout_root() -> Path:
    value = Path(_git("rev-parse", "--git-common-dir"))
    common_dir = value.resolve() if value.is_absolute() else (ROOT / value).resolve()
    if common_dir.name != ".git":
        raise RuntimeError(f"unsupported Git common directory: {common_dir}")
    return common_dir.parent


def _is_below(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _runtime_problems(root: Path, primary_root: Path) -> list[str]:
    if root.resolve() == primary_root.resolve():
        return []
    problems: list[str] = []
    if _is_below(root, PRIVATE_TMP):
        problems.append(
            "frontend worktrees may not live under /private/tmp; use "
            f"{primary_root.parent}/aries-worktrees/"
        )
    for relative in DEPENDENCY_TREES:
        dependency = root / relative
        if dependency.is_symlink():
            problems.append(
                f"{relative} is a cross-worktree symlink; run "
                "`make worktree-bootstrap` in the permanent worktree"
            )
        elif not dependency.is_dir():
            problems.append(
                f"{relative} is missing; run `make worktree-bootstrap`"
            )
    python_env = root / PYTHON_ENV
    if python_env.is_symlink():
        problems.append(
            f"{PYTHON_ENV} is a cross-worktree symlink; run "
            "`make worktree-bootstrap` in the permanent worktree"
        )
    elif not python_env.is_dir():
        problems.append(f"{PYTHON_ENV} is missing; run `make worktree-bootstrap`")
    return problems


def _clone_tree(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        subprocess.run(("cp", "-cR", str(source), str(target)), check=True)
    else:
        shutil.copytree(source, target, symlinks=True)


def _bootstrap_dependency(relative: Path, primary_root: Path) -> str:
    source = primary_root / relative
    target = ROOT / relative
    if not source.is_dir():
        raise RuntimeError(f"primary dependency tree is missing: {source}")
    if target.is_symlink():
        if target.resolve() != source.resolve():
            raise RuntimeError(f"refusing to replace unrelated symlink: {target}")
        target.unlink()
    if target.is_dir():
        return f"ready: {relative}"
    if target.exists():
        raise RuntimeError(f"dependency path is not a directory: {target}")
    _clone_tree(source, target)
    return f"prepared: {relative}"


def _bootstrap_python(primary_root: Path) -> str:
    source = primary_root / PYTHON_ENV
    target = ROOT / PYTHON_ENV
    if not source.is_dir():
        raise RuntimeError(f"primary Python environment is missing: {source}")
    if target.is_symlink():
        if target.resolve() != source.resolve():
            raise RuntimeError(f"refusing to replace unrelated symlink: {target}")
        target.unlink()
    if target.is_dir():
        return f"ready: {PYTHON_ENV}"
    if target.exists():
        raise RuntimeError(f"Python environment path is not a directory: {target}")
    _clone_tree(source, target)
    return f"prepared: {PYTHON_ENV}"


def check() -> int:
    primary_root = _primary_checkout_root()
    problems = _runtime_problems(ROOT, primary_root)
    if not problems:
        print(f"Aries worktree runtime ready: {ROOT}")
        return 0
    for problem in problems:
        print(f"ERROR: {problem}", file=sys.stderr)
    return 1


def bootstrap() -> int:
    primary_root = _primary_checkout_root()
    if ROOT.resolve() == primary_root.resolve():
        print("Primary checkout already owns the canonical dependencies.")
        return check()
    if _is_below(ROOT, PRIVATE_TMP):
        raise RuntimeError(
            "refusing to bootstrap a frontend worktree under /private/tmp; "
            f"create it under {primary_root.parent}/aries-worktrees/"
        )
    for relative in DEPENDENCY_TREES:
        print(_bootstrap_dependency(relative, primary_root))
    print(_bootstrap_python(primary_root))
    return check()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "bootstrap"))
    args = parser.parse_args()
    try:
        return check() if args.command == "check" else bootstrap()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
