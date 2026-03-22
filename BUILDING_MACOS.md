# Building Morinus on macOS

These steps build a native `.app` bundle using Python 3 + PyInstaller and compile the bundled Swiss Ephemeris wrapper (`sweastrology`) for your Python.

The macOS build script uses isolated per-architecture virtualenvs in `.build-venvs/` so `arm64`, `x86_64`, and `universal` builds do not overwrite each other's packages or your shared Python install.

Choose an architecture when you build:

```bash
./scripts/build_macos_app.sh x86_64
./scripts/build_macos_app.sh arm64
./scripts/build_macos_app.sh universal
```

Defaults:

- `x86_64` uses `MACOSX_DEPLOYMENT_TARGET=10.13`
- `arm64` uses `MACOSX_DEPLOYMENT_TARGET=11.0`
- `universal` uses both slices and defaults to `MACOSX_DEPLOYMENT_TARGET=11.0`

You can still override `MACOSX_DEPLOYMENT_TARGET` in the environment if you need a different minimum version.

## Prereqs

- Xcode Command Line Tools (`clang`)
- Python 3.10+ (this repo currently builds with Python 3.13)

## 1) Install Python deps

```bash
python3 -m pip install --user -U pip
python3 -m pip install --user -r requirements-dev.txt
```

Optional (offline timezone + small numeric helpers):

```bash
python3 -m pip install --user -r requirements-optional.txt
```

## 2) Build the Swiss Ephemeris extension

```bash
cd "SWEP/src"
python3 setup.py build_ext --inplace
```

This should create a file like `sweastrology.cpython-313-darwin.so` in `SWEP/src/`.

## 3) Run from source (sanity check)

```bash
cd "../.."
python3 morinus.py
```

## 4) Build a macOS `.app` bundle

```bash
python3 -m PyInstaller Morinus.macos.spec --clean -y
```

Output ends up in an arch-specific bundle:

- `dist/Morinus-x86_64.app`
- `dist/Morinus-arm64.app`
- `dist/Morinus-universal.app`

## One-command build

```bash
./scripts/build_macos_app.sh
```

To build both shipping bundles in one pass:

```bash
./scripts/build_macos_release.sh
```

or:

```bash
make macos-release
```

Per-arch build environments are created automatically on first use:

- `.build-venvs/macos-arm64`
- `.build-venvs/macos-x86_64`
- `.build-venvs/macos-universal`
