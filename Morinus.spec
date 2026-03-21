# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

block_cipher = None


_repo_root = Path.cwd()
_swe_binary_candidates = []

for pattern in ("sweastrology*.pyd", "sweastrology*.so"):
    for candidate in sorted((_repo_root / "SWEP" / "src").glob(pattern)):
        _swe_binary_candidates.append((str(candidate), "SWEP\\src"))

for pattern in ("sweastrology*.pyd", "sweastrology*.so"):
    for candidate in sorted(_repo_root.glob(pattern)):
        _swe_binary_candidates.append((str(candidate), "."))

_swe_binaries = _swe_binary_candidates
if not _swe_binaries:
    raise SystemExit(
        'Swiss Ephemeris extension not found. Build it first with '
        '`cd SWEP\\\\src && ..\\\\..\\\\.venv\\\\Scripts\\\\python.exe setup.py build_ext --inplace`.'
    )


a = Analysis(
    ['morinus.py'],
    pathex=[],
    binaries=_swe_binaries,
    datas=[('Res', 'Res'), ('Data', 'Data'), ('Hors', 'Hors'), ('Opts', 'Opts'), ('SWEP\\Ephem', 'SWEP\\Ephem'), ('Res\\Morinus.ico', '.')],
    hiddenimports=['wx.adv'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Morinus',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['Res\\Morinus.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Morinus',
)
