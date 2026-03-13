# Dependencies (macOS)

## Runtime (required)

- `wxPython` (GUI)
- `Pillow` (image rendering; this repo uses `import Image/ImageDraw/ImageFont` shims that forward to Pillow)

## Runtime (optional)

- `timezonefinder` (used by `geonames.py` for offline timezone lookup; features fall back if missing)
- `numpy` (used opportunistically in a few places for numeric coercion; not required)

## Build (macOS `.app`)

- `pyinstaller` (bundles `Morinus.app`)
- `setuptools` + `wheel` (builds the `SWEP/src` C extension)
- Xcode Command Line Tools (`clang`)

## Legacy / deprecated (not used for macOS)

- `py2exe` (Windows-only legacy build script: `0setup.py`)
- `distutils` (removed in Python 3.12+; do not use in new build scripts)

## Audit

Run:

```bash
python3 tools/audit_deps.py
```

Output: `deps_report.json`

