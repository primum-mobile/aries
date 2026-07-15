# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Aries daemon binary.

Build:
  webapp/.venv/bin/python -m PyInstaller webapp/daemon/aries-daemon.spec --noconfirm
"""
from pathlib import Path
import sysconfig
from PyInstaller.utils.hooks import collect_submodules

REPO_ROOT = Path(SPECPATH).resolve().parent.parent
ENTRY = str(REPO_ROOT / "webapp" / "daemon" / "__main__.py")
SWEASTROLOGY = REPO_ROOT / f"sweastrology{sysconfig.get_config_var('EXT_SUFFIX')}"
if not SWEASTROLOGY.exists():
    raise SystemExit(f"Missing sweastrology extension for this Python: {SWEASTROLOGY}")

block_cipher = None
REPORTLAB_HIDDENIMPORTS = collect_submodules("reportlab")

a = Analysis(
    [ENTRY],
    pathex=[str(REPO_ROOT)],
    binaries=[
        (str(SWEASTROLOGY), "."),
    ],
    # Keep the one-file sidecar small. Static resources are bundled by Tauri as
    # app resources and passed through ARIES_DAEMON_BASE_DIR at runtime; embedding
    # Res/SWEP/corpus here makes PyInstaller extract ~150 MB before /health.
    datas=[],
    hiddenimports=[
        "webapp.daemon.server",
        "webapp.daemon.chart_service",
        "webapp.frontend.scripts.export_chart_json",
        "webapp.frontend.scripts.export_chart_image",
        "webapp.frontend.scripts.export_table_pdf",
        "graphchart",
        "pdfexport",
        "wxcompat",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.logging",
        "astrology",
        "chart",
        "common",
        "houses",
        "planets",
        "options",
        "util",
        "mtexts",
        "horfileio",
        "chartfile",
        "fortune",
        "fixstars",
        "interchartaspects",
        "lordofyear",
        "radixsignals",
        "symbolic_time",
        "arabicparts",
        "chart_context_view",
        "sweastrology",
    ] + REPORTLAB_HIDDENIMPORTS,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aries-daemon",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="aries-daemon",
)
