# Building Morinus on macOS

These steps build a native `.app` bundle using Python 3 + PyInstaller and compile the bundled Swiss Ephemeris wrapper (`sweastrology`) for your Python.

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

Output ends up in `dist/Morinus.app`.

## One-command build

```bash
./scripts/build_macos_app.sh
```
