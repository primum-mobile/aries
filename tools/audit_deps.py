#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ImportRef:
	file: str
	line: int
	module: str
	kind: str  # "import" | "from"


def iter_python_files(root: Path) -> Iterable[Path]:
	for path in root.rglob("*.py"):
		# Ignore build artifacts
		if any(part in {"build", "dist", ".pyinstaller", "__pycache__"} for part in path.parts):
			continue
		yield path


def _module_root(name: str) -> str:
	return name.split(".", 1)[0]


def discover_local_modules(root: Path) -> set[str]:
	local: set[str] = set()
	for path in iter_python_files(root):
		if path.name == "__init__.py":
			local.add(path.parent.name)
		else:
			local.add(path.stem)
	return local


def extract_imports(path: Path) -> list[ImportRef]:
	try:
		src = path.read_text(encoding="utf-8", errors="replace")
	except Exception:
		return []
	try:
		tree = ast.parse(src, filename=str(path))
	except SyntaxError:
		return []

	out: list[ImportRef] = []
	for node in ast.walk(tree):
		if isinstance(node, ast.Import):
			for alias in node.names:
				out.append(
					ImportRef(
						file=str(path),
						line=getattr(node, "lineno", 1),
						module=_module_root(alias.name),
						kind="import",
					)
				)
		elif isinstance(node, ast.ImportFrom):
			if node.module is None:
				continue
			out.append(
				ImportRef(
					file=str(path),
					line=getattr(node, "lineno", 1),
					module=_module_root(node.module),
					kind="from",
				)
			)
	return out


def is_stdlib(module_root: str) -> bool:
	# Python 3.10+ stdlib list
	std = getattr(sys, "stdlib_module_names", None)
	if std and module_root in std:
		return True
	# Conservative fallback: treat unknown as non-stdlib
	return False


def main() -> int:
	root = Path(os.getcwd()).resolve()
	local_modules = discover_local_modules(root)
	all_imports: list[ImportRef] = []
	for py in iter_python_files(root):
		all_imports.extend(extract_imports(py))

	by_module: dict[str, list[ImportRef]] = {}
	for ref in all_imports:
		by_module.setdefault(ref.module, []).append(ref)

	stdlib = sorted([m for m in by_module.keys() if is_stdlib(m)])
	local = sorted([m for m in by_module.keys() if (m in local_modules and not is_stdlib(m))])
	third_party = sorted([m for m in by_module.keys() if (m not in local_modules and not is_stdlib(m))])

	report = {
		"root": str(root),
		"python": sys.version,
		"stdlib_module_count": len(stdlib),
		"local_module_count": len(local),
		"third_party_module_count": len(third_party),
		"local_modules": local,
		"third_party_modules": third_party,
		"modules": {
			m: [{"file": r.file, "line": r.line, "kind": r.kind} for r in refs[:50]]
			for m, refs in sorted(by_module.items())
		},
	}

	out_path = root / "deps_report.json"
	out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

	print(f"Wrote: {out_path}")
	print("Third-party modules (top-level):")
	for m in third_party:
		print(" -", m)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
