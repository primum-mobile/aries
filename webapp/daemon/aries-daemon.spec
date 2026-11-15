# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Aries daemon binary.

Build:
  webapp/.venv/bin/python -m PyInstaller webapp/daemon/aries-daemon.spec --noconfirm
"""
import os
from pathlib import Path
import sys
import sysconfig
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

REPO_ROOT = Path(SPECPATH).resolve().parent.parent
ENTRY = str(REPO_ROOT / "webapp" / "daemon" / "__main__.py")
SWEASTROLOGY_NAME = f"sweastrology{sysconfig.get_config_var('EXT_SUFFIX')}"
TRANSIT_KERNEL_NAME = f"_transit_kernel{sysconfig.get_config_var('EXT_SUFFIX')}"
SWEASTROLOGY = next(
    (
        candidate.resolve()
        for candidate in (
            REPO_ROOT / SWEASTROLOGY_NAME,
            REPO_ROOT / "SWEP" / "src" / SWEASTROLOGY_NAME,
        )
        if candidate.is_file()
    ),
    None,
)
if SWEASTROLOGY is None:
    raise SystemExit(
        f"Missing {SWEASTROLOGY_NAME}. Build the Swiss Ephemeris extension first."
    )
TRANSIT_KERNEL = REPO_ROOT / "aries" / "astrology" / "transit_fast" / TRANSIT_KERNEL_NAME
# Windows version resource written by scripts/release_version.py during
# release packaging (build_windows_tauri_inputs.ps1); ignored elsewhere.
WINDOWS_VERSION_FILE = os.environ.get("ARIES_DAEMON_VERSION_FILE") or None
if not TRANSIT_KERNEL.is_file():
    raise SystemExit(
        f"Missing {TRANSIT_KERNEL_NAME}. Build the native transit kernel first."
    )

# Windows has no system IANA time-zone database; zoneinfo reads the tzdata
# package instead. Fail the build rather than ship a daemon whose charts lose
# every historical offset and DST rule.
TZDATA_HIDDENIMPORTS = []
TZDATA_DATAS = []
if sys.platform == "win32":
    try:
        import tzdata  # noqa: F401
    except ImportError:
        raise SystemExit("Missing tzdata. Install webapp/daemon/requirements.txt first.")
    TZDATA_HIDDENIMPORTS = collect_submodules("tzdata")
    TZDATA_DATAS = collect_data_files("tzdata")

# Python UTF-8 mode: open(), stdio and subprocess text default to UTF-8 instead
# of the Windows ANSI code page (cp1252, cp932 ...). Windows only, so the macOS
# daemon is built exactly as before.
PYTHON_OPTIONS = [("X utf8", None, "OPTION")] if sys.platform == "win32" else []

# Windows application manifest: PyInstaller's default (PyInstaller adds the
# Common-Controls dependency itself) plus activeCodePage UTF-8, so narrow-char C
# code in the extensions (Swiss Ephemeris fopen) reads UTF-8 paths on Windows 10
# 1903+ even outside the patched code paths.
WINDOWS_MANIFEST = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"></requestedExecutionLevel>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{e2011457-1546-43c5-a5fe-008deee3d3f0}"></supportedOS>
      <supportedOS Id="{35138b9a-5d96-4fbd-8e2d-a2440225f93a}"></supportedOS>
      <supportedOS Id="{4a2f28e3-53b9-4441-ba9c-d69d4a4a6e38}"></supportedOS>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"></supportedOS>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"></supportedOS>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>
"""

block_cipher = None
REPORTLAB_HIDDENIMPORTS = collect_submodules("reportlab")
FONTTOOLS_HIDDENIMPORTS = collect_submodules("fontTools")
BROTLI_HIDDENIMPORTS = collect_submodules("brotli")

a = Analysis(
    [ENTRY],
    pathex=[str(REPO_ROOT)],
    binaries=[
        (str(SWEASTROLOGY), "."),
        (str(TRANSIT_KERNEL), "aries/astrology/transit_fast"),
    ],
    # Keep the one-file sidecar small. Static resources are bundled by Tauri as
    # app resources and passed through ARIES_DAEMON_BASE_DIR at runtime; embedding
    # Res/SWEP/corpus here makes PyInstaller extract ~150 MB before /health.
    datas=[(str(REPO_ROOT / "webapp/daemon/shipping-style-profiles.json"), "webapp/daemon")] + [
        (str(REPO_ROOT / "webapp/frontend/src/lib/chart" / name), "webapp/frontend/src/lib/chart")
        for name in ("wheel-ring-archetypes.json", "wheel-factory-v1.json", "wheel-factory-v2.json", "wheel-geometry-ownership.json", "dignity-display-policy.json")
    ] + TZDATA_DATAS,
    hiddenimports=[
        "webapp.daemon.server",
        "webapp.daemon.chart_service",
        "webapp.frontend.scripts.export_chart_json",
        "webapp.frontend.scripts.export_table_pdf",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.loops.auto",
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
        "aries.astrology.transit_fast._transit_kernel",
        "platform_compat",
    ] + REPORTLAB_HIDDENIMPORTS + FONTTOOLS_HIDDENIMPORTS + BROTLI_HIDDENIMPORTS + TZDATA_HIDDENIMPORTS,
    hookspath=[],
    runtime_hooks=[],
    # Pillow is used only for PNG poster tiles, the sRGB ICC profile and
    # reportlab's PNG images. Its AVIF, WebP, FreeType and Tk extensions (and
    # the libavif/libwebp/freetype/harfbuzz dylibs they pull in, ~8 MB per
    # architecture) are never loaded; Pillow treats them as optional.
    excludes=[
        "tkinter", "matplotlib", "wx", "wxcompat", "graphchart", "pdfexport",
        "PIL._avif", "PIL._webp", "PIL._imagingft", "PIL._imagingtk",
    ],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    PYTHON_OPTIONS,
    exclude_binaries=True,
    name="aries-daemon",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    version=WINDOWS_VERSION_FILE,
    manifest=WINDOWS_MANIFEST if sys.platform == "win32" else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="aries-daemon",
)
