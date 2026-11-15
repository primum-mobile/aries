import struct
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "binary_archs.py"
sys.path.insert(0, str(SCRIPT.parent))

from binary_archs import UnknownBinaryError, binary_archs, normalize_machine  # noqa: E402


def write(tmp_path: Path, data: bytes) -> Path:
	path = tmp_path / "binary"
	path.write_bytes(data + b"\0" * 64)
	return path


def elf(machine: int, little: bool = True) -> bytes:
	endian = "<" if little else ">"
	ident = b"\x7fELF" + bytes([2, 1 if little else 2, 1]) + b"\0" * 9
	return ident + struct.pack(endian + "HH", 3, machine)


def pe(machine: int) -> bytes:
	header = bytearray(0x80)
	header[:2] = b"MZ"
	struct.pack_into("<I", header, 0x3C, 0x40)
	header[0x40:0x44] = b"PE\0\0"
	struct.pack_into("<H", header, 0x44, machine)
	return bytes(header)


def macho_thin(cputype: int) -> bytes:
	return struct.pack("<II", 0xFEEDFACF, cputype)


def macho_fat(*cputypes: int, wide: bool = False) -> bytes:
	magic = 0xCAFEBABF if wide else 0xCAFEBABE
	entry = ">iiQQII" if wide else ">iiIII"
	body = struct.pack(">II", magic, len(cputypes))
	for cputype in cputypes:
		fields = (cputype, 0, 0, 0, 0, 0) if wide else (cputype, 0, 0, 0, 0)
		body += struct.pack(entry, *fields)
	return body


@pytest.mark.parametrize(
	("data", "expected"),
	[
		(elf(0x3E), ["x86_64"]),
		(elf(0xB7), ["arm64"]),
		(elf(0xB7, little=False), ["arm64"]),
		(pe(0x8664), ["x86_64"]),
		(pe(0xAA64), ["arm64"]),
		(macho_thin(0x0100000C), ["arm64"]),
		(macho_thin(0x01000007), ["x86_64"]),
		(macho_fat(0x01000007, 0x0100000C), ["x86_64", "arm64"]),
		(macho_fat(0x01000007, 0x0100000C, wide=True), ["x86_64", "arm64"]),
		(elf(0x28), ["unknown(0x28)"]),
	],
)
def test_reads_binary_architectures(tmp_path, data, expected):
	assert binary_archs(write(tmp_path, data)) == expected


def test_rejects_non_binaries(tmp_path):
	with pytest.raises(UnknownBinaryError):
		binary_archs(write(tmp_path, b"#!/bin/sh\necho hi\n"))


def test_rejects_mz_without_pe_signature(tmp_path):
	data = bytearray(pe(0x8664))
	data[0x40:0x44] = b"XXXX"
	with pytest.raises(UnknownBinaryError):
		binary_archs(write(tmp_path, bytes(data)))


@pytest.mark.parametrize(
	("machine", "expected"),
	[("aarch64", "arm64"), ("arm64", "arm64"), ("x86_64", "x86_64"), ("AMD64", "x86_64"), ("riscv64", "riscv64")],
)
def test_normalizes_machine_names(machine, expected):
	assert normalize_machine(machine) == expected


def test_cli_reports_interpreter_architecture():
	result = subprocess.run(
		[sys.executable, str(SCRIPT), sys.executable], capture_output=True, text=True, check=True
	)
	import platform

	assert normalize_machine(platform.machine()) in result.stdout.split()


def test_cli_fails_for_missing_file(tmp_path):
	result = subprocess.run(
		[sys.executable, str(SCRIPT), str(tmp_path / "missing")], capture_output=True, text=True
	)
	assert result.returncode == 1
	assert result.stdout == ""
