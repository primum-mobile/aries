#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Max Lange
# SPDX-License-Identifier: GPL-3.0-or-later
"""Print the CPU architectures of a native binary, portably.

A stdlib-only stand-in for ``lipo -archs`` that also reads Linux (ELF) and
Windows (PE) binaries, so the daemon build can verify its native extensions on
every platform. Architectures are normalized to ``arm64`` and ``x86_64``.

Usage:
    binary_archs.py FILE            print space-separated architectures
    binary_archs.py --normalize M   normalize a platform.machine() value
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

_MACHINE_ALIASES = {
	"arm64": "arm64",
	"aarch64": "arm64",
	"x86_64": "x86_64",
	"amd64": "x86_64",
}

# Mach-O CPU types (CPU_ARCH_ABI64 | base type).
_MACHO_CPU = {0x01000007: "x86_64", 0x0100000C: "arm64"}
_ELF_MACHINE = {0x3E: "x86_64", 0xB7: "arm64"}
_PE_MACHINE = {0x8664: "x86_64", 0xAA64: "arm64"}

_FAT_MAGIC = 0xCAFEBABE
_FAT_MAGIC_64 = 0xCAFEBABF
_MACHO_MAGIC_64 = 0xFEEDFACF


class UnknownBinaryError(ValueError):
	pass


def normalize_machine(machine: str) -> str:
	return _MACHINE_ALIASES.get(machine.strip().lower(), machine.strip())


def _name(table: dict[int, str], value: int) -> str:
	return table.get(value, f"unknown(0x{value:x})")


def _macho_fat(data: bytes, magic: int) -> list[str]:
	(count,) = struct.unpack_from(">I", data, 4)
	entry_size = 32 if magic == _FAT_MAGIC_64 else 20
	archs = []
	for index in range(count):
		(cputype,) = struct.unpack_from(">i", data, 8 + index * entry_size)
		archs.append(_name(_MACHO_CPU, cputype & 0xFFFFFFFF))
	return archs


def _elf(data: bytes) -> list[str]:
	endian = "<" if data[5] == 1 else ">"
	(machine,) = struct.unpack_from(endian + "H", data, 18)
	return [_name(_ELF_MACHINE, machine)]


def _pe(data: bytes) -> list[str]:
	(offset,) = struct.unpack_from("<I", data, 0x3C)
	if data[offset : offset + 4] != b"PE\0\0":
		raise UnknownBinaryError("MZ header without a PE signature")
	(machine,) = struct.unpack_from("<H", data, offset + 4)
	return [_name(_PE_MACHINE, machine)]


def binary_archs(path: Path) -> list[str]:
	data = path.read_bytes()
	try:
		if data[:4] == b"\x7fELF":
			return _elf(data)
		if data[:2] == b"MZ":
			return _pe(data)
		(big,) = struct.unpack_from(">I", data, 0)
		if big in (_FAT_MAGIC, _FAT_MAGIC_64):
			return _macho_fat(data, big)
		(little,) = struct.unpack_from("<I", data, 0)
		if little == _MACHO_MAGIC_64:
			(cputype,) = struct.unpack_from("<I", data, 4)
			return [_name(_MACHO_CPU, cputype)]
	except struct.error as exc:
		raise UnknownBinaryError(f"truncated binary header: {exc}") from exc
	raise UnknownBinaryError("not a Mach-O, ELF or PE binary")


def main(argv: list[str]) -> int:
	if len(argv) == 2 and argv[0] == "--normalize":
		print(normalize_machine(argv[1]))
		return 0
	if len(argv) != 1:
		print(__doc__.strip(), file=sys.stderr)
		return 2
	path = Path(argv[0])
	try:
		print(" ".join(binary_archs(path)))
	except (OSError, UnknownBinaryError) as exc:
		print(f"{path}: {exc}", file=sys.stderr)
		return 1
	return 0


if __name__ == "__main__":
	sys.exit(main(sys.argv[1:]))
