#!/usr/bin/env python3
"""Fuse an arm64 and an x86_64 PyInstaller folder into one universal folder.

    fuse_macos_universal.py ARM64_DIR X86_64_DIR OUTPUT_DIR

Both folders must come from the same source and the same pinned packages.
Every Mach-O pair becomes one fat file with `lipo -create`; a file that is
already universal in both trees must be byte-identical. Every other file and
symlink must match exactly, with two narrow exceptions that only describe
packaging, never code:

- zip archives (PyInstaller's base_library.zip) whose members are identical
  and differ only in entry timestamps;
- a wheel's WHEEL, RECORD and direct_url.json, which name its platform tag.

The PyInstaller executable carries its Python archive inside each slice, and
the fat bootloader reads only one of them, so both slices' archives must hold
the same modules with the same code (only `numpy.__config__`, which records
the NumPy build machine, may differ). Run this with the packaging Python that
built the daemon: it reads the archives with PyInstaller's own readers.

Anything else that differs, or exists in only one tree, stops the fuse with a
list, so an arch-specific build never ships half its code.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

THIN_MAGICS = {b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"}
FAT_MAGICS = {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}
WHEEL_METADATA = {"WHEEL", "RECORD", "direct_url.json"}
PYI_COOKIE = b"MEI\x0c\x0b\x0a\x0b\x0e"
# Modules whose code legitimately records the build architecture.
ARCH_SPECIFIC_MODULES = {"numpy.__config__"}


def entries(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for directory, dirs, files in os.walk(root):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink() or path.is_file():
                found[str(path.relative_to(root))] = path
    return found


def magic(path: Path) -> bytes:
    with path.open("rb") as handle:
        return handle.read(4)


def lipo_archs(path: Path) -> set[str]:
    out = subprocess.run(["lipo", "-archs", str(path)], check=True, capture_output=True, text=True)
    return set(out.stdout.split())


def zip_members_equal(a: Path, b: Path) -> bool:
    try:
        with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
            if sorted(za.namelist()) != sorted(zb.namelist()):
                return False
            return all(za.read(name) == zb.read(name) for name in za.namelist())
    except zipfile.BadZipFile:
        return False


def has_pyinstaller_archive(path: Path) -> bool:
    return PYI_COOKIE in path.read_bytes()


def pyz_modules(reader) -> dict[str, object]:
    """Map each module in a PYZ to its code, compared by value, not by bytes."""
    import marshal

    modules = {}
    for name in reader.toc:
        raw = reader.extract(name, raw=True)
        try:
            modules[name] = marshal.loads(raw) if isinstance(raw, bytes) else raw
        except (EOFError, ValueError, TypeError):
            modules[name] = raw
    return modules


def archive_differences(a: Path, b: Path, relative: str) -> list[str]:
    """Compare the Python archives embedded in two thin PyInstaller executables."""
    import tempfile

    from PyInstaller.archive.readers import CArchiveReader, ZlibArchiveReader

    ca, cb = CArchiveReader(str(a)), CArchiveReader(str(b))
    problems = [f"archive entry only in arm64: {relative}:{n}" for n in sorted(set(ca.toc) - set(cb.toc))]
    problems += [f"archive entry only in x86_64: {relative}:{n}" for n in sorted(set(cb.toc) - set(ca.toc))]
    for name in sorted(set(ca.toc) & set(cb.toc)):
        da, db = ca.extract(name), cb.extract(name)
        if da == db:
            continue
        if not name.endswith(".pyz"):
            problems.append(f"archive entry differs: {relative}:{name}")
            continue
        with tempfile.TemporaryDirectory() as temp:
            pa, pb = Path(temp) / "arm64.pyz", Path(temp) / "x86_64.pyz"
            pa.write_bytes(da)
            pb.write_bytes(db)
            ma = pyz_modules(ZlibArchiveReader(str(pa), start_offset=0))
            mb = pyz_modules(ZlibArchiveReader(str(pb), start_offset=0))
        problems += [f"module only in arm64: {relative}:{m}" for m in sorted(set(ma) - set(mb))]
        problems += [f"module only in x86_64: {relative}:{m}" for m in sorted(set(mb) - set(ma))]
        problems += [
            f"module code differs: {relative}:{m}"
            for m in sorted(set(ma) & set(mb))
            if m not in ARCH_SPECIFIC_MODULES and ma[m] != mb[m]
        ]
    return problems


def is_wheel_metadata(relative: str) -> bool:
    parts = Path(relative).parts
    return len(parts) >= 2 and parts[-2].endswith(".dist-info") and parts[-1] in WHEEL_METADATA


def fuse(arm_root: Path, x86_root: Path, out_root: Path) -> list[str]:
    arm, x86 = entries(arm_root), entries(x86_root)
    problems = [f"only in arm64: {k}" for k in sorted(set(arm) - set(x86))]
    problems += [f"only in x86_64: {k}" for k in sorted(set(x86) - set(arm))]
    if problems:
        return problems

    if out_root.exists():
        shutil.rmtree(out_root)
    shutil.copytree(arm_root, out_root, symlinks=True)

    fused = 0
    for relative in sorted(arm):
        a, b = arm[relative], x86[relative]
        if a.is_symlink() or b.is_symlink():
            if not (a.is_symlink() and b.is_symlink() and os.readlink(a) == os.readlink(b)):
                problems.append(f"symlink differs: {relative}")
            continue
        if a.read_bytes() == b.read_bytes():
            continue
        ma, mb = magic(a), magic(b)
        if ma in THIN_MAGICS and mb in THIN_MAGICS:
            if lipo_archs(a) != {"arm64"} or lipo_archs(b) != {"x86_64"}:
                problems.append(f"unexpected architectures: {relative}")
                continue
            if has_pyinstaller_archive(a) or has_pyinstaller_archive(b):
                archive_problems = archive_differences(a, b, relative)
                if archive_problems:
                    problems += archive_problems
                    continue
            target = out_root / relative
            target.unlink()
            subprocess.run(["lipo", "-create", str(a), str(b), "-output", str(target)], check=True)
            shutil.copymode(a, target)
            fused += 1
        elif ma in FAT_MAGICS or mb in FAT_MAGICS:
            problems.append(f"universal file differs between builds: {relative}")
        elif zipfile.is_zipfile(a) and zip_members_equal(a, b):
            continue
        elif is_wheel_metadata(relative):
            continue
        else:
            problems.append(f"data differs: {relative}")
    print(f"Fused {fused} Mach-O files into {out_root}")
    return problems


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    arm_root, x86_root, out_root = (Path(p).resolve() for p in sys.argv[1:])
    problems = fuse(arm_root, x86_root, out_root)
    if problems:
        print("Cannot fuse the arm64 and x86_64 builds:", file=sys.stderr)
        for line in problems[:40]:
            print(f"  {line}", file=sys.stderr)
        if len(problems) > 40:
            print(f"  … and {len(problems) - 40} more", file=sys.stderr)
        if out_root.exists():
            shutil.rmtree(out_root)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
