# -*- mode: python ; coding: utf-8 -*-


block_cipher = None


_swe_binary_candidates = [
    ('SWEP\\src\\sweastrology.cp314-win_amd64.pyd', 'SWEP\\src'),
    ('SWEP\\src\\sweastrology.pyd', 'SWEP\\src'),
    ('sweastrology.pyd', '.'),
]

_swe_binaries = [candidate for candidate in _swe_binary_candidates if os.path.exists(candidate[0])]
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
