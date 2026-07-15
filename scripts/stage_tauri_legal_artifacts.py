#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Stage reproducible legal artifacts for an Aries Tauri application bundle.

The generated directory is a packaging input only. It contains the root
license texts, a machine-readable dependency inventory, available local
dependency license notices, and the separately licensed Valens corresponding
source. The dependency graph comes from committed JavaScript/Rust locks and the
resolved runtime Python closure rooted at ``webapp/daemon/requirements.txt``.
The JavaScript/Rust portions are a conservative lockfile inventory and can
include build, development, and non-macOS optional components.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DESTINATION = (
    REPO_ROOT
    / "webapp"
    / "frontend"
    / "src-tauri"
    / "target"
    / "aries-legal"
)
LEGAL_SOURCE_FILES = (
    "LICENSE",
    "COPYING-GPL-3.0.txt",
    "COPYING-GPL-2.0.txt",
    "THIRD_PARTY_NOTICES.txt",
)
REQUIRED_LEGAL_ARTIFACTS = (
    *LEGAL_SOURCE_FILES,
    "DEPENDENCY_NOTICES.txt",
    "DEPENDENCY_LICENSES.txt",
    "ARIES-SBOM.cdx.json",
)
NODE_WORKSPACES = ("notes_web", "webapp/frontend")
DAEMON_REQUIREMENTS = REPO_ROOT / "webapp" / "daemon" / "requirements.txt"
VALENS_BUNDLE_SOURCE_DIR = "latex-valens-source"
VALENS_SOURCE_CHECKOUT = "valens"
VALENS_SOURCE_REPOSITORY = "https://github.com/janegca/latex-valens"
VALENS_SOURCE_COMMIT = "2d4a8b9890cd5cb7714abd52f6bd938272ba8237"
VALENS_SOURCE_EXPORT_DIR = "third_party/latex-valens-source"
VALENS_LOCAL_PATCH_PATH = "book01/01-stars.tex"
VALENS_LOCAL_PATCH_BEFORE = b"\\textbf{Of the limbs of the body:}, it rules "
VALENS_LOCAL_PATCH_AFTER = b"\\textbf{Of the limbs of the body:} it rules "
VALENS_LOCAL_PATCH_NOTICE = (
    b"% Aries modification 2026-07-15: removed a stray comma after "
    b"\\textbf{Of the limbs of the body:}.\n"
)
_VALENS_SOURCE_ROOT_FILES = {"LICENSE", "SOURCE.txt"}
_NORMALIZE_NAME = re.compile(r"[-_.]+")
_REQUIREMENT_NAME = re.compile(
    r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]+)\])?"
)
_EXTRA_EQUALS = re.compile(r"\bextra\s*==\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)
_LICENSE_FILE_PREFIXES = (
    "license",
    "licence",
    "copying",
    "copyright",
    "notice",
    "notices",
    "unlicense",
    "patents",
)
_SOURCE_FILE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".go",
    ".h",
    ".hpp",
    ".java",
    ".js",
    ".mjs",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".ts",
    ".tsx",
}


@dataclass(frozen=True)
class _LicenseSource:
    """One local, text-only license/notice file for a dependency."""

    path: Path
    label: str


@dataclass(frozen=True)
class _Dependency:
    """An SBOM component and the license texts installed beside it."""

    component: dict[str, Any]
    license_sources: tuple[_LicenseSource, ...]


def _is_license_filename(path: Path) -> bool:
    """Return whether a filename is conventionally a license text.

    The generator deliberately looks only for named legal texts.  It does not
    sweep package files or reproduce source code from dependencies.
    """

    name = path.name.lower()
    if not name.startswith(_LICENSE_FILE_PREFIXES):
        return False
    return path.suffix.lower() not in _SOURCE_FILE_SUFFIXES


def _deduplicated_license_sources(
    sources: Iterable[_LicenseSource],
) -> tuple[_LicenseSource, ...]:
    """Keep one deterministic label for each physical source file."""

    unique: dict[str, _LicenseSource] = {}
    for source in sources:
        if not source.path.is_file():
            continue
        key = str(source.path.resolve())
        previous = unique.get(key)
        if previous is None or source.label < previous.label:
            unique[key] = source
    return tuple(sorted(unique.values(), key=lambda source: source.label))


def _license_sources_under(
    root: Path,
    *,
    label_prefix: str,
    excluded_directories: Iterable[str] = (),
) -> tuple[_LicenseSource, ...]:
    """Find named legal texts below one package without entering child deps."""

    if not root.is_dir():
        return ()
    excluded = set(excluded_directories)
    found: list[_LicenseSource] = []
    for directory, directories, filenames in os.walk(root, followlinks=False):
        directories[:] = sorted(
            name for name in directories if name not in excluded
        )
        current = Path(directory)
        for filename in sorted(filenames):
            candidate = current / filename
            if not _is_license_filename(candidate):
                continue
            relative = candidate.relative_to(root).as_posix()
            found.append(
                _LicenseSource(candidate, f"{label_prefix}/{relative}")
            )
    return _deduplicated_license_sources(found)


def _record_license_sources(metadata_location: Path) -> tuple[_LicenseSource, ...]:
    """Read legal files recorded by a Python wheel without guessing ownership."""

    record_path = metadata_location / "RECORD"
    site_packages = metadata_location.parent
    if not record_path.is_file():
        return ()
    found: list[_LicenseSource] = []
    with record_path.open(encoding="utf-8", newline="") as record_file:
        for row in csv.reader(record_file):
            if not row:
                continue
            relative = Path(row[0])
            if relative.is_absolute() or ".." in relative.parts:
                continue
            candidate = site_packages / relative
            if not _is_license_filename(candidate) or not candidate.is_file():
                continue
            found.append(
                _LicenseSource(
                    candidate,
                    f"site-packages/{relative.as_posix()}",
                )
            )
    return _deduplicated_license_sources(found)


def _python_license_sources(metadata_location: Path) -> tuple[_LicenseSource, ...]:
    """Return license files owned by an installed Python distribution."""

    in_metadata = _license_sources_under(
        metadata_location,
        label_prefix=f"site-packages/{metadata_location.name}",
    )
    return _deduplicated_license_sources(
        [*in_metadata, *_record_license_sources(metadata_location)]
    )


def _read_license_text(source: _LicenseSource) -> str | None:
    """Read a textual legal file, rejecting binary payloads conservatively."""

    try:
        raw = source.path.read_bytes()
    except OSError:
        return None
    if not raw or b"\0" in raw:
        return None
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n")
    text = text.replace("\r", "\n").strip()
    return text or None


def _run_json(command: list[str], *, cwd: Path) -> Any:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(
            f"command failed ({' '.join(command)}): {result.stderr.strip()}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"command did not produce JSON ({' '.join(command)}): {exc}"
        ) from exc


def _license_name(*values: object) -> str:
    for value in values:
        if not value:
            continue
        text = " ".join(str(value).split())
        if text and len(text) <= 180:
            return text
    return "NOASSERTION"


def _license_from_metadata(metadata: dict[str, Any]) -> str:
    classifiers = metadata.get("classifier") or metadata.get("classifiers") or []
    if isinstance(classifiers, str):
        classifiers = [classifiers]
    classifier_license = next(
        (
            str(value).rsplit(" :: ", 1)[-1]
            for value in classifiers
            if str(value).startswith("License :: ")
        ),
        "",
    )
    return _license_name(
        metadata.get("license_expression"),
        metadata.get("license-expression"),
        metadata.get("license"),
        classifier_license,
    )


def _purl(ecosystem: str, name: str, version: str, *, qualifier: str = "") -> str:
    encoded_name = quote(name, safe="/")
    suffix = f"?{qualifier}" if qualifier else ""
    return f"pkg:{ecosystem}/{encoded_name}@{quote(version, safe='.+-')}{suffix}"


def _component(
    *,
    ecosystem: str,
    name: str,
    version: str,
    license_name: str,
    qualifier: str = "",
) -> dict[str, Any]:
    reference = _purl(ecosystem, name, version, qualifier=qualifier)
    return {
        "type": "library",
        "bom-ref": reference,
        "name": name,
        "version": version,
        "purl": reference,
        "licenses": [{"license": {"name": license_name}}],
        "properties": [{"name": "aries:ecosystem", "value": ecosystem}],
    }


def _normalized_name(name: str) -> str:
    return _NORMALIZE_NAME.sub("-", name).lower()


def _parse_requirement(requirement: str) -> tuple[str, set[str], str]:
    """Return a normalized distribution name, requested extras, and marker.

    Aries' daemon requirements use normal PEP 508 requirement lines. Keeping
    this deliberately small parser in the standard library avoids making the
    legal-artifact build depend on a package that it is inventorying.
    """

    specification, separator, marker = requirement.partition(";")
    match = _REQUIREMENT_NAME.match(specification)
    if not match:
        raise RuntimeError(f"unsupported Python requirement: {requirement!r}")
    extras = {
        _normalized_name(extra)
        for extra in (match.group(2) or "").split(",")
        if extra.strip()
    }
    return _normalized_name(match.group(1)), extras, marker if separator else ""


def _daemon_requirement_roots() -> list[tuple[str, set[str]]]:
    roots: list[tuple[str, set[str]]] = []
    for raw_line in DAEMON_REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith(("-", "--")):
            raise RuntimeError(
                "webapp/daemon/requirements.txt must use direct PEP 508 "
                f"requirements for legal inventory: {raw_line!r}"
            )
        name, extras, _marker = _parse_requirement(line)
        roots.append((name, extras))
    if not roots:
        raise RuntimeError(f"no daemon requirements found in {DAEMON_REQUIREMENTS}")
    return roots


def _marker_allows_selected_extra(marker: str, extras: set[str]) -> bool:
    """Reject optional dependency edges unless the owning extra was requested.

    Platform markers are left to pip's installed environment: an unavailable
    dependency cannot enter the inventory, while a present dependency is
    conservatively retained. The ``extra == ...`` condition is the important
    distinction because unrequested development and documentation extras are
    commonly installed in a local environment.
    """

    requested = {_normalized_name(value) for value in _EXTRA_EQUALS.findall(marker)}
    return not requested or bool(requested & extras)


def _pip_inspect(web_python: Path) -> dict[str, Any]:
    report = _run_json(
        [str(web_python), "-m", "pip", "inspect", "--quiet"],
        cwd=REPO_ROOT,
    )
    if not isinstance(report, dict):
        raise RuntimeError("pip inspect did not return an installed-package report")
    return report


def _installed_python_distributions(
    report: dict[str, Any],
) -> dict[str, tuple[dict[str, Any], Path | None]]:
    installed: dict[str, tuple[dict[str, Any], Path | None]] = {}
    for item in report.get("installed", []):
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            continue
        name = str(metadata.get("name") or "").strip()
        if not name:
            continue
        location_value = str(item.get("metadata_location") or "").strip()
        location = Path(location_value) if location_value else None
        installed[_normalized_name(name)] = (metadata, location)
    return installed


def _python_dependencies(
    report: dict[str, Any], web_python: Path
) -> Iterable[_Dependency]:
    installed = _installed_python_distributions(report)

    roots = _daemon_requirement_roots()
    root_names = {name for name, _extras in roots}
    selected_extras: dict[str, set[str]] = {}
    pending = roots.copy()
    while pending:
        name, extras = pending.pop()
        previous_extras = selected_extras.get(name, set())
        if name in selected_extras and extras <= previous_extras:
            continue
        selected_extras[name] = previous_extras | extras
        installed_distribution = installed.get(name)
        if installed_distribution is None:
            if name in root_names:
                raise RuntimeError(
                    f"daemon requirement {name!r} is not installed in {web_python}"
                )
            continue
        metadata, _metadata_location = installed_distribution
        for raw_requirement in metadata.get("requires_dist") or []:
            dependency, dependency_extras, marker = _parse_requirement(
                str(raw_requirement)
            )
            if not _marker_allows_selected_extra(marker, selected_extras[name]):
                continue
            pending.append((dependency, dependency_extras))

    for name in sorted(selected_extras):
        installed_distribution = installed.get(name)
        if installed_distribution is None:
            continue
        metadata, metadata_location = installed_distribution
        display_name = str(metadata.get("name") or "").strip()
        version = str(metadata.get("version") or "").strip()
        if not display_name or not version:
            continue
        yield _Dependency(
            component=_component(
                ecosystem="pypi",
                name=display_name,
                version=version,
                license_name=_license_from_metadata(metadata),
            ),
            license_sources=(
                _python_license_sources(metadata_location)
                if metadata_location is not None
                else ()
            ),
        )


def _pyinstaller_bootloader_sources(
    report: dict[str, Any],
) -> tuple[str, str, tuple[_LicenseSource, ...]]:
    """Locate the GPL notice for the PyInstaller bootloader in aries-daemon."""

    installed = _installed_python_distributions(report)
    distribution = installed.get("pyinstaller")
    if distribution is None:
        raise RuntimeError(
            "PyInstaller is required to stage the bundled aries-daemon "
            "bootloader COPYING.txt. Run the daemon build-dependency setup first."
        )
    metadata, metadata_location = distribution
    if metadata_location is None:
        raise RuntimeError("PyInstaller did not report its metadata location")
    copying_sources = tuple(
        source
        for source in _python_license_sources(metadata_location)
        if source.path.name.lower().startswith("copying")
    )
    if not copying_sources:
        raise RuntimeError(
            "PyInstaller is installed but its COPYING.txt could not be located; "
            "the aries-daemon bootloader notice would be incomplete."
        )
    version = str(metadata.get("version") or "").strip()
    if not version:
        raise RuntimeError("PyInstaller did not report a version")
    return version, _license_from_metadata(metadata), copying_sources


def _node_dependencies(workspace: str) -> Iterable[_Dependency]:
    root = REPO_ROOT / workspace
    lock_path = root / "package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = lock.get("packages") or {}
    for relative, locked in sorted(packages.items()):
        if not relative or not relative.startswith("node_modules/"):
            continue
        name = str(locked.get("name") or relative.rsplit("node_modules/", 1)[-1])
        version = str(locked.get("version") or "").strip()
        if not version:
            continue
        package_json = root / relative / "package.json"
        package_metadata: dict[str, Any] = {}
        if package_json.is_file():
            try:
                package_metadata = json.loads(package_json.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                package_metadata = {}
        # A lock can legitimately retain multiple nested copies of one package
        # version.  Scan only this package tree and never recurse into its child
        # node_modules, so a child dependency is recorded once under its own
        # lock entry rather than copied repeatedly through every parent.
        yield _Dependency(
            component=_component(
                ecosystem="npm",
                name=name,
                version=version,
                license_name=_license_name(
                    package_metadata.get("license"), locked.get("license")
                ),
                qualifier=f"workspace={quote(workspace, safe='')}",
            ),
            license_sources=_license_sources_under(
                root / relative,
                label_prefix=f"{workspace}/{relative}",
                excluded_directories=(".git", "node_modules"),
            ),
        )


def _cargo_license_sources(
    package: dict[str, Any], *, name: str, version: str
) -> tuple[_LicenseSource, ...]:
    manifest_value = str(package.get("manifest_path") or "").strip()
    if not manifest_value:
        return ()
    manifest_path = Path(manifest_value)
    if not manifest_path.is_file():
        return ()
    crate_root = manifest_path.parent
    label_prefix = f"cargo/{name}-{version}"
    sources = list(
        _license_sources_under(
            crate_root,
            label_prefix=label_prefix,
            excluded_directories=(".git", "node_modules", "target"),
        )
    )
    declared_license_file = str(package.get("license_file") or "").strip()
    if declared_license_file:
        license_file = Path(declared_license_file)
        if not license_file.is_absolute():
            license_file = crate_root / license_file
        try:
            relative = license_file.resolve().relative_to(crate_root.resolve())
        except ValueError:
            relative = None
        if relative is not None and license_file.is_file():
            sources.append(
                _LicenseSource(license_file, f"{label_prefix}/{relative.as_posix()}")
            )
    return _deduplicated_license_sources(sources)


def _cargo_dependencies() -> Iterable[_Dependency]:
    crate = REPO_ROOT / "webapp" / "frontend" / "src-tauri"
    metadata = _run_json(
        ["cargo", "metadata", "--locked", "--format-version", "1"],
        cwd=crate,
    )
    workspace_members = set(metadata.get("workspace_members") or [])
    packages = sorted(
        metadata.get("packages", []),
        key=lambda package: (
            str(package.get("name") or ""),
            str(package.get("version") or ""),
            str(package.get("id") or ""),
        ),
    )
    for package in packages:
        if package.get("id") in workspace_members:
            continue
        name = str(package.get("name") or "").strip()
        version = str(package.get("version") or "").strip()
        if not name or not version:
            continue
        yield _Dependency(
            component=_component(
                ecosystem="cargo",
                name=name,
                version=version,
                license_name=_license_name(package.get("license")),
            ),
            license_sources=_cargo_license_sources(
                package, name=name, version=version
            ),
        )


def _aries_version() -> str:
    pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, flags=re.MULTILINE)
    if not match:
        raise RuntimeError("could not read Aries version from pyproject.toml")
    return match.group(1)


def _component_license_name(component: dict[str, Any]) -> str:
    return str(component["licenses"][0]["license"]["name"])


def _deduplicated_dependencies(
    dependencies: Iterable[_Dependency],
) -> list[_Dependency]:
    by_reference: dict[str, _Dependency] = {}
    for dependency in dependencies:
        reference = str(dependency.component["bom-ref"])
        previous = by_reference.get(reference)
        if previous is None:
            by_reference[reference] = dependency
            continue
        component = previous.component
        if (
            _component_license_name(previous.component) == "NOASSERTION"
            and _component_license_name(dependency.component) != "NOASSERTION"
        ):
            component = dependency.component
        by_reference[reference] = _Dependency(
            component=component,
            license_sources=_deduplicated_license_sources(
                [*previous.license_sources, *dependency.license_sources]
            ),
        )
    return [by_reference[key] for key in sorted(by_reference)]


def _deduplicated_components(components: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compatibility helper for callers interested only in the SBOM payload."""

    return [
        dependency.component
        for dependency in _deduplicated_dependencies(
            _Dependency(component=component, license_sources=())
            for component in components
        )
    ]


def _write_sbom(destination: Path, components: list[dict[str, Any]]) -> None:
    version = _aries_version()
    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "bom-ref": _purl("generic", "aries", version),
                "name": "Aries",
                "version": version,
                "licenses": [{"license": {"id": "AGPL-3.0-or-later"}}],
            },
            "tools": [
                {
                    "vendor": "Aries",
                    "name": "stage_tauri_legal_artifacts.py",
                    "version": "1",
                }
            ],
        },
        "components": components,
    }
    (destination / "ARIES-SBOM.cdx.json").write_text(
        json.dumps(sbom, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _write_dependency_notices(destination: Path, components: list[dict[str, Any]]) -> int:
    unresolved = [
        component
        for component in components
        if component["licenses"][0]["license"]["name"] == "NOASSERTION"
    ]
    lines = [
        "ARIES DEPENDENCY INVENTORY",
        "",
        "Generated from committed npm/Cargo locks and the resolved runtime Python",
        "dependency closure rooted at webapp/daemon/requirements.txt.",
        "The npm/Cargo portions are a conservative lockfile inventory and can include",
        "build, development, and non-macOS optional components.",
        "ARIES-SBOM.cdx.json is the machine-readable form.",
        "DEPENDENCY_LICENSES.txt reproduces available local legal texts.",
        "This inventory supplements THIRD_PARTY_NOTICES.txt; it does not change",
        "the license of Aries or any listed component.",
        "",
    ]
    for component in components:
        ecosystem = component["properties"][0]["value"]
        license_name = component["licenses"][0]["license"]["name"]
        lines.append(
            f"{component['name']} {component['version']} [{ecosystem}] — {license_name}"
        )
    if unresolved:
        lines.extend(
            [
                "",
                "NOASSERTION",
                "The components below did not expose a short license expression in",
                "their installed or locked metadata. Their original metadata remains",
                "the source of record and these entries require release review:",
            ]
        )
        lines.extend(f"- {component['bom-ref']}" for component in unresolved)
    (destination / "DEPENDENCY_NOTICES.txt").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )
    return len(unresolved)


def _valens_snapshot_files(source: Path) -> list[Path]:
    """Validate the deliberately small corresponding-source snapshot."""

    files = sorted(
        path for path in source.rglob("*") if path.is_file() or path.is_symlink()
    )
    if not files:
        raise RuntimeError(f"Valens source snapshot is empty: {source}")
    for path in files:
        relative = path.relative_to(source)
        if path.is_symlink():
            raise RuntimeError(f"Valens source snapshot contains symlink: {relative}")
        if relative.parent == Path(".") and relative.name in _VALENS_SOURCE_ROOT_FILES:
            continue
        if path.suffix.lower() == ".tex":
            continue
        raise RuntimeError(
            "Valens source snapshot contains unexpected file: "
            f"{relative.as_posix()}"
        )
    if not (source / "LICENSE").is_file() or not (source / "SOURCE.txt").is_file():
        raise RuntimeError(f"Valens source snapshot lacks LICENSE or SOURCE.txt: {source}")
    if not any(path.suffix.lower() == ".tex" for path in files):
        raise RuntimeError(f"Valens source snapshot contains no LaTeX source: {source}")
    source_note = (source / "SOURCE.txt").read_text(encoding="utf-8")
    expected_note_markers = (
        VALENS_SOURCE_REPOSITORY,
        VALENS_SOURCE_COMMIT,
        "GPL-2.0-only",
        "2026-07-15",
    )
    if not all(marker in source_note for marker in expected_note_markers):
        raise RuntimeError(f"Valens source provenance note is incomplete: {source}")
    corrected_source = source / VALENS_LOCAL_PATCH_PATH
    corrected_bytes = corrected_source.read_bytes()
    if (
        not corrected_bytes.startswith(VALENS_LOCAL_PATCH_NOTICE)
        or VALENS_LOCAL_PATCH_BEFORE in corrected_bytes
        or VALENS_LOCAL_PATCH_AFTER not in corrected_bytes
    ):
        raise RuntimeError(
            "Valens source snapshot is missing the recorded Aries correction: "
            f"{corrected_source}"
        )
    return files


def _valens_git(checkout: Path, *args: str) -> bytes:
    """Read a pinned latex-valens Git object from the private build checkout."""

    try:
        return subprocess.check_output(
            ["git", "-C", str(checkout), *args], stderr=subprocess.STDOUT
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "output", b"").decode("utf-8", errors="replace").strip()
        message = (
            "Unable to read the pinned latex-valens source "
            f"({VALENS_SOURCE_COMMIT}) from {checkout}."
        )
        if detail:
            message = f"{message}\n{detail}"
        raise RuntimeError(message) from exc


def _stage_private_valens_snapshot(target: Path) -> None:
    """Generate the same small source snapshot used by the public export."""

    checkout = REPO_ROOT / VALENS_SOURCE_CHECKOUT
    if not checkout.is_dir():
        raise RuntimeError(
            f"Missing local latex-valens checkout: {checkout}. Expected pinned source "
            f"{VALENS_SOURCE_REPOSITORY} at {VALENS_SOURCE_COMMIT}."
        )
    tree = _valens_git(
        checkout,
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        VALENS_SOURCE_COMMIT,
    )
    tex_paths = sorted(
        path.decode("utf-8", errors="strict")
        for path in tree.split(b"\0")
        if path.endswith(b".tex")
    )
    if not tex_paths:
        raise RuntimeError(
            f"Pinned latex-valens tree {VALENS_SOURCE_COMMIT} contains no .tex files."
        )

    target.mkdir(parents=True, exist_ok=False)
    correction_count = 0
    for relative in tex_paths:
        source_relative = Path(relative)
        if source_relative.is_absolute() or ".." in source_relative.parts:
            raise RuntimeError(f"Unsafe path in latex-valens Git tree: {relative}")
        contents = _valens_git(checkout, "show", f"{VALENS_SOURCE_COMMIT}:{relative}")
        if relative == VALENS_LOCAL_PATCH_PATH:
            correction_count = contents.count(VALENS_LOCAL_PATCH_BEFORE)
            if correction_count != 1:
                raise RuntimeError(
                    "The expected latex-valens typographical correction no longer "
                    f"matches {relative} in pinned source {VALENS_SOURCE_COMMIT}."
                )
            contents = contents.replace(
                VALENS_LOCAL_PATCH_BEFORE, VALENS_LOCAL_PATCH_AFTER
            )
            contents = VALENS_LOCAL_PATCH_NOTICE + contents
        destination = target / source_relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)

    if correction_count != 1:
        raise RuntimeError(
            f"Did not apply the latex-valens correction to {VALENS_LOCAL_PATCH_PATH}."
        )
    (target / "LICENSE").write_bytes(
        _valens_git(checkout, "show", f"{VALENS_SOURCE_COMMIT}:LICENSE")
    )
    source_note = f"""latex-valens source snapshot

Upstream repository: {VALENS_SOURCE_REPOSITORY}
Pinned upstream commit: {VALENS_SOURCE_COMMIT}
License: GPL-2.0-only (see LICENSE)

This directory intentionally contains only the upstream LaTeX (*.tex) source
files and its license. It excludes PDFs, README files, Git metadata, and local
operating-system files from the working checkout.

Aries applies one dated typographical correction to {VALENS_LOCAL_PATCH_PATH}:
  \\textbf{{Of the limbs of the body:}}, it rules
becomes:
  \\textbf{{Of the limbs of the body:}} it rules

The corrected source file begins with a LaTeX modification notice dated
2026-07-15.
"""
    (target / "SOURCE.txt").write_text(source_note, encoding="utf-8")


def _stage_valens_corresponding_source(destination: Path) -> None:
    """Stage Valens' exact GPL-2 source beside the bundled legal texts."""

    target = destination / VALENS_BUNDLE_SOURCE_DIR
    if target.exists():
        raise RuntimeError(f"legal destination already contains Valens source: {target}")

    public_snapshot = REPO_ROOT / VALENS_SOURCE_EXPORT_DIR
    if public_snapshot.is_dir():
        _valens_snapshot_files(public_snapshot)
        shutil.copytree(public_snapshot, target)
    else:
        _stage_private_valens_snapshot(target)
    _valens_snapshot_files(target)


def _require_staged_artifacts(destination: Path) -> None:
    missing = [
        artifact
        for artifact in REQUIRED_LEGAL_ARTIFACTS
        if not (destination / artifact).is_file()
        or not (destination / artifact).stat().st_size
    ]
    required_valens = (
        "LICENSE",
        "SOURCE.txt",
        "book01/01-stars.tex",
    )
    missing.extend(
        f"{VALENS_BUNDLE_SOURCE_DIR}/{artifact}"
        for artifact in required_valens
        if not (destination / VALENS_BUNDLE_SOURCE_DIR / artifact).is_file()
        or not (destination / VALENS_BUNDLE_SOURCE_DIR / artifact).stat().st_size
    )
    if missing:
        raise RuntimeError("staged legal artifacts are incomplete: " + ", ".join(missing))


def _license_texts_for_sources(
    sources: Iterable[_LicenseSource],
) -> list[tuple[_LicenseSource, str]]:
    """Read legal texts once per component, collapsing copied nested packages."""

    by_text: dict[str, _LicenseSource] = {}
    for source in sorted(sources, key=lambda candidate: candidate.label):
        text = _read_license_text(source)
        if text is None:
            continue
        previous = by_text.get(text)
        if previous is None or source.label < previous.label:
            by_text[text] = source
    return sorted(
        ((source, text) for text, source in by_text.items()),
        key=lambda entry: entry[0].label,
    )


def _append_license_record(
    lines: list[str],
    *,
    ecosystem: str,
    name: str,
    version: str,
    source: str,
    license_name: str,
    text: str,
) -> None:
    lines.extend(
        [
            "=" * 78,
            f"{ecosystem} | {name} | {version} | {source}",
            f"Declared license: {license_name}",
            "=" * 78,
            text,
            "",
        ]
    )


def _write_dependency_licenses(
    destination: Path,
    dependencies: list[_Dependency],
    *,
    pyinstaller_bootloader: tuple[str, str, tuple[_LicenseSource, ...]],
) -> int:
    """Write available license/notice texts without copying dependency code."""

    lines = [
        "ARIES DEPENDENCY LICENSE TEXTS",
        "",
        "Generated from committed npm/Cargo locks and the resolved runtime Python",
        "dependency closure rooted at webapp/daemon/requirements.txt.",
        "The npm/Cargo portions are a conservative lockfile inventory and can include",
        "build, development, and non-macOS optional components.",
        "Each record identifies its ecosystem, package, version, and local source",
        "file. Only named license, notice, copying, copyright, patent, or",
        "unlicense texts are reproduced here; dependency source code is excluded.",
        "",
    ]
    unknown_without_text: list[str] = []
    record_count = 0
    for dependency in dependencies:
        component = dependency.component
        ecosystem = str(component["properties"][0]["value"])
        name = str(component["name"])
        version = str(component["version"])
        license_name = _component_license_name(component)
        source_texts = _license_texts_for_sources(dependency.license_sources)
        if source_texts:
            for source, text in source_texts:
                _append_license_record(
                    lines,
                    ecosystem=ecosystem,
                    name=name,
                    version=version,
                    source=source.label,
                    license_name=license_name,
                    text=text,
                )
                record_count += 1
            continue

        source_label = "no local LICENSE/NOTICE/COPYING/COPYRIGHT text"
        if license_name == "NOASSERTION":
            unknown_without_text.append(str(component["bom-ref"]))
            fallback = (
                "No local legal text was found and the installed or locked metadata "
                "does not declare a license. This component requires release review."
            )
        else:
            fallback = (
                "No local named legal text was found. The installed or locked metadata "
                f"declares: {license_name}."
            )
        _append_license_record(
            lines,
            ecosystem=ecosystem,
            name=name,
            version=version,
            source=source_label,
            license_name=license_name,
            text=fallback,
        )
        record_count += 1

    pyinstaller_version, pyinstaller_license, pyinstaller_sources = (
        pyinstaller_bootloader
    )
    bootloader_texts = _license_texts_for_sources(pyinstaller_sources)
    if not bootloader_texts:
        raise RuntimeError(
            "PyInstaller bootloader COPYING.txt was present but could not be read."
        )
    for source, text in bootloader_texts:
        _append_license_record(
            lines,
            ecosystem="pypi",
            name="PyInstaller bootloader (bundled with aries-daemon)",
            version=pyinstaller_version,
            source=source.label,
            license_name=pyinstaller_license,
            text=text,
        )
        record_count += 1

    if unknown_without_text:
        raise RuntimeError(
            "License text and license metadata are both unavailable for: "
            + ", ".join(sorted(unknown_without_text))
        )
    (destination / "DEPENDENCY_LICENSES.txt").write_text(
        "\n".join(lines), encoding="utf-8"
    )
    return record_count


def stage_legal_artifacts(web_python: Path, destination: Path) -> tuple[int, int, int]:
    if not web_python.is_absolute():
        web_python = REPO_ROOT / web_python
    if not web_python.is_file():
        raise FileNotFoundError(f"missing daemon Python: {web_python}")
    destination = destination.resolve()
    temporary = destination.with_name(destination.name + ".tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True)
    try:
        for filename in LEGAL_SOURCE_FILES:
            source = REPO_ROOT / filename
            if not source.is_file():
                raise FileNotFoundError(f"missing legal source: {source}")
            shutil.copy2(source, temporary / filename)
        _stage_valens_corresponding_source(temporary)
        pip_report = _pip_inspect(web_python)
        dependencies = _deduplicated_dependencies(
            [
                *_python_dependencies(pip_report, web_python),
                *(
                    dependency
                    for workspace in NODE_WORKSPACES
                    for dependency in _node_dependencies(workspace)
                ),
                *_cargo_dependencies(),
            ]
        )
        components = [dependency.component for dependency in dependencies]
        _write_sbom(temporary, components)
        unresolved = _write_dependency_notices(temporary, components)
        license_records = _write_dependency_licenses(
            temporary,
            dependencies,
            pyinstaller_bootloader=_pyinstaller_bootloader_sources(pip_report),
        )
        _require_staged_artifacts(temporary)
        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return len(components), unresolved, license_records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--web-python",
        type=Path,
        default=REPO_ROOT / "webapp" / ".venv" / "bin" / "python",
    )
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    args = parser.parse_args()
    components, unresolved, license_records = stage_legal_artifacts(
        args.web_python, args.destination
    )
    print(
        f"Staged legal artifacts: {components} components "
        f"({unresolved} with NOASSERTION; {license_records} license records) "
        f"in {args.destination}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
