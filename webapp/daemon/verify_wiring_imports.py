# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Migration guard for daemon-side wiring drift.

The daemon is allowed to import calculation/session services, but it should not
drag wx GUI modules into the web backend or recreate derived-chart lifecycle
logic that already exists in Morinus' session/adapters.
"""
from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DAEMON_ROOT = REPO_ROOT / "webapp" / "daemon"

FORBIDDEN_IMPORT_ROOTS = {
    "wx",
    "morin",
    "workspace_shell",
    "windowbehavior",
}

FORBIDDEN_IMPORT_SUFFIXES = (
    "dlg",
    "frame",
    "wnd",
)

DERIVED_REIMPLEMENTATION_CALLS = {
    ("chart", "Chart"): "constructs derived charts directly; use the session/supplementary adapter path",
    ("revolutions", "Revolutions"): "recomputes returns directly; use the solar/lunar return adapter path",
    ("posfordate", "make_progressed_chart_by_real_date"): "recomputes progressions directly; use the progression adapter path",
}


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    message: str

    def format(self) -> str:
        rel = self.path.relative_to(REPO_ROOT)
        return f"{rel}:{self.line}: {self.message}"


def iter_python_files() -> list[Path]:
    return sorted(
        path
        for path in DAEMON_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
        and not path.name.startswith("verify_")
    )


def module_root(name: str) -> str:
    return name.split(".", 1)[0]


def is_forbidden_module(name: str) -> bool:
    root = module_root(name)
    if root in FORBIDDEN_IMPORT_ROOTS:
        return True
    return any(root.endswith(suffix) for suffix in FORBIDDEN_IMPORT_SUFFIXES)


def scan_imports(path: Path, tree: ast.AST) -> list[Finding]:
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if is_forbidden_module(alias.name):
                    findings.append(
                        Finding(path, node.lineno, f"forbidden daemon import {alias.name!r}")
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.module and is_forbidden_module(node.module):
                findings.append(
                    Finding(path, node.lineno, f"forbidden daemon import from {node.module!r}")
                )
    return findings


def call_name(node: ast.AST) -> tuple[str, str] | None:
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return (func.value.id, func.attr)
    return None


def assigns_wx_module(node: ast.AST) -> bool:
    if not isinstance(node, ast.Assign):
        return False
    for target in node.targets:
        if not isinstance(target, ast.Subscript):
            continue
        if not (
            isinstance(target.value, ast.Attribute)
            and isinstance(target.value.value, ast.Name)
            and target.value.value.id == "sys"
            and target.value.attr == "modules"
        ):
            continue
        subscript = target.slice
        if isinstance(subscript, ast.Constant) and subscript.value == "wx":
            return True
    return False


def scan_ast_markers(path: Path, tree: ast.AST) -> list[Finding]:
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if assigns_wx_module(node):
            findings.append(
                Finding(path, node.lineno, "installs a wx fallback shim; extract wx-free services instead")
            )
        name = call_name(node)
        if name in DERIVED_REIMPLEMENTATION_CALLS:
            findings.append(Finding(path, node.lineno, DERIVED_REIMPLEMENTATION_CALLS[name]))
    return findings


def scan_file(path: Path) -> list[Finding]:
    source = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return [Finding(path, exc.lineno or 1, f"syntax error while scanning: {exc.msg}")]
    return [*scan_imports(path, tree), *scan_ast_markers(path, tree)]


def main() -> int:
    findings: list[Finding] = []
    for path in iter_python_files():
        findings.extend(scan_file(path))

    if not findings:
        print("WIRING IMPORT GUARD OK")
        return 0

    print("WIRING IMPORT GUARD FAILED", file=sys.stderr)
    for finding in findings:
        print(f"  {finding.format()}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
