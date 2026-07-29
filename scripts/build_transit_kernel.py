#!/usr/bin/env python3
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Build the native transit kernel from its checked-in generated C source."""

from __future__ import annotations

from pathlib import Path

from setuptools import Extension, setup


REPO_ROOT = Path(__file__).resolve().parents[1]
SWEP_ROOT = REPO_ROOT / "SWEP" / "src"
KERNEL_ROOT = REPO_ROOT / "aries" / "astrology" / "transit_fast"
SWEP_SOURCES = (
	"swecl.c",
	"swedate.c",
	"swehel.c",
	"swehouse.c",
	"swejpl.c",
	"swemmoon.c",
	"swemplan.c",
	"swepcalc.c",
	"swepdate.c",
	"sweph.c",
	"swephlib.c",
)


setup(
	name="aries-transit-kernel",
	packages=[],
	ext_modules=[
		Extension(
			"aries.astrology.transit_fast._transit_kernel",
			sources=[
				str(KERNEL_ROOT / "_transit_kernel.c"),
				*(str(SWEP_ROOT / name) for name in SWEP_SOURCES),
			],
			include_dirs=[str(SWEP_ROOT)],
			extra_compile_args=["-O3", "-fvisibility=hidden"],
		)
	],
)
