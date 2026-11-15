# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Source-only native smoke prerequisites; never builds a packaged sidecar."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import sysconfig


ROOT = Path(__file__).resolve().parents[2]


def native_builds(root: Path):
    suffix = sysconfig.get_config_var("EXT_SUFFIX")
    swe = root / "SWEP/src"
    shared = [*swe.glob("*.c"), *swe.glob("*.h")]
    kernel = root / "aries/astrology/transit_fast"
    return (
        (swe / f"sweastrology{suffix}", [*shared, swe / "setup.py"],
         swe, ["setup.py", "build_ext", "--inplace", "--force"]),
        (kernel / f"_transit_kernel{suffix}",
         [*shared, *kernel.glob("*.c"), *kernel.glob("*.h"), *kernel.glob("*.pyx"),
          *kernel.glob("*.pxd"), root / "scripts/build_transit_kernel.py"],
         root, ["scripts/build_transit_kernel.py", "build_ext", "--inplace", "--force"]),
    )


def needs_native_build(output: Path, inputs: list[Path]) -> bool:
    return not output.is_file() or any(
        source.stat().st_mtime_ns > output.stat().st_mtime_ns for source in inputs
    )


def ensure_native(root: Path = ROOT) -> None:
    """Only compile absent, changed, or ABI/architecture-incompatible extensions."""
    directory = root / "webapp/frontend/.tmp"
    directory.mkdir(parents=True, exist_ok=True)
    receipt = directory / "dev-native.json"
    configuration = [sys.executable, sys.version, platform.machine(),
                     *[os.environ.get(key, "") for key in
                       ("CC", "CFLAGS", "ARCHFLAGS", "MACOSX_DEPLOYMENT_TARGET")]]
    previous = json.loads(receipt.read_text(encoding="utf-8")) if receipt.exists() else None
    force = previous is not None and previous != configuration
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [str(root / "SWEP/src"), str(root), env.get("PYTHONPATH", "")]
    )
    probe = subprocess.run(
        [sys.executable, "-c", "import sweastrology; from aries.astrology.transit_fast import _transit_kernel"],
        cwd=root, env=env, capture_output=True,
    )
    force = force or probe.returncode != 0
    for output, inputs, cwd, arguments in native_builds(root):
        if force or needs_native_build(output, inputs):
            if importlib.util.find_spec("setuptools") is None:
                subprocess.run([sys.executable, "-m", "pip", "install", "setuptools"], check=True)
            subprocess.run([sys.executable, *arguments], cwd=cwd, env=env, check=True)
    subprocess.run(
        [sys.executable, "-c", "import sweastrology; from aries.astrology.transit_fast import _transit_kernel"],
        cwd=root, env=env, check=True,
    )
    if previous != configuration:
        receipt.write_text(json.dumps(configuration), encoding="utf-8")


def prepare(root: Path = ROOT) -> None:
    requirements = root / "webapp/daemon/requirements.txt"
    digest = hashlib.sha256(requirements.read_bytes() + sys.version.encode()).hexdigest()
    receipt = root / "webapp/.venv/.aries-dev-requirements"
    if not receipt.exists() or receipt.read_text(encoding="utf-8") != digest:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements)], check=True)
        receipt.write_text(digest, encoding="utf-8")
    ensure_native(root)


NOTES_INPUTS = ("notes_web/src", "notes_web/index.html", "notes_web/vite.config.js",
                "notes_web/package.json", "notes_web/package-lock.json")
LEGAL_INPUTS = ("scripts/stage_tauri_legal_artifacts.py", "webapp/daemon/requirements.txt",
                "webapp/daemon/requirements-build.txt", "pyproject.toml",
                "notes_web/package-lock.json", "webapp/frontend/package-lock.json",
                "webapp/frontend/src-tauri/Cargo.lock", "LICENSE", "COPYING-GPL-3.0.txt",
                "COPYING-GPL-2.0.txt", "COPYRIGHT.txt", "THIRD_PARTY_NOTICES.txt")


def inputs_digest(root: Path, inputs) -> str:
    digest = hashlib.sha256()
    for name in inputs:
        path = root / name
        files = sorted(f for f in path.rglob("*") if f.is_file()) if path.is_dir() else [path]
        for file in files:
            stat = file.stat() if file.is_file() else None
            digest.update(f"{file.relative_to(root)}\0{stat and stat.st_mtime_ns}\0{stat and stat.st_size}\0".encode())
    return digest.hexdigest()


def stage_resources(root: Path = ROOT) -> None:
    """Tauri dev resources: rebuild notes/legal only for changed inputs; never block the smoke."""
    receipt_path = root / "webapp/frontend/.tmp/dev-resources.json"
    try:
        receipts = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        receipts = {}
    steps = (
        ("corpus", None, None, ["make", "--no-print-directory", "web-corpus"]),
        ("notes", NOTES_INPUTS, root / "Res/notes/index.html", ["make", "--no-print-directory", "web-notes"]),
        ("legal", LEGAL_INPUTS, root / "webapp/frontend/src-tauri/target/aries-legal/DEPENDENCY_LICENSES.txt",
         ["make", "--no-print-directory", "web-legal"]),
        ("runtime", None, None, ["python3", "scripts/stage_tauri_runtime_resources.py"]),
    )
    for name, inputs, output, command in steps:
        digest = inputs_digest(root, inputs) if inputs else None
        if digest is not None and receipts.get(name) == digest and output.is_file():
            continue
        if subprocess.run(command, cwd=root).returncode == 0:
            if digest is not None:
                receipts[name] = digest
        else:
            print(f"warning: {name} staging failed; starting the smoke app anyway", file=sys.stderr)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipts), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1:] == ["--resources"]:
        stage_resources()
    else:
        prepare()
