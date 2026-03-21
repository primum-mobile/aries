# -*- mode: python ; coding: utf-8 -*-

import glob
import os
from pathlib import Path

# `__file__` is not guaranteed to exist when PyInstaller executes a spec.
here = Path(globals().get("SPECPATH", os.getcwd())).resolve()
swe_src = here / "SWEP" / "src"

so_candidates = sorted(glob.glob(str(swe_src / "sweastrology*.so")))
if not so_candidates:
	raise SystemExit(
		"Missing built `sweastrology` extension.\n"
		"Run: `cd SWEP/src && python3 setup.py build_ext --inplace`"
	)

sweastrology_so = so_candidates[0]

block_cipher = None
target_arch = os.environ.get("PYINSTALLER_TARGET_ARCH")

datas = [
	(str(here / "Res"), "Res"),
	(str(here / "Data"), "Data"),
	(str(here / "Hors"), "Hors"),
	(str(here / "Opts"), "Opts"),
	(str(here / "SWEP" / "Ephem"), os.path.join("SWEP", "Ephem")),
]

binaries = [
	(sweastrology_so, os.path.join("SWEP", "src")),
]

a = Analysis(
	["morinus.py"],
	pathex=[str(here)],
	binaries=binaries,
	datas=datas,
	hiddenimports=["wx.adv", "wx.html"],
	hookspath=[],
	hooksconfig={},
	runtime_hooks=[],
	excludes=[],
	cipher=block_cipher,
	noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
	pyz,
	a.scripts,
	[],
	exclude_binaries=True,
	name="Morinus",
	debug=False,
	bootloader_ignore_signals=False,
	strip=False,
	upx=False,
	console=False,
	argv_emulation=True,
	target_arch=target_arch,
)

coll = COLLECT(
	exe,
	a.binaries,
	a.zipfiles,
	a.datas,
	strip=False,
	upx=False,
	name="Morinus",
)

app = BUNDLE(
	coll,
	name="Morinus.app",
	icon=str(here / "Res" / "Morinus.icns") if (here / "Res" / "Morinus.icns").exists() else None,
	bundle_identifier="org.morinus.morinus",
)
