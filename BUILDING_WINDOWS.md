# Building Morinus on Windows

These steps build a Windows `.exe` bundle using Python 3, PyInstaller, and a locally compiled `sweastrology` extension.

## Prereqs

- Python 3.14+ installed via `py`
- Visual Studio 2022 Build Tools with C++ support

## 1) Create a virtualenv

```powershell
py -3.14 -m venv .venv
```

## 2) Run the build script

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_windows_exe.ps1
```

This will:

- install Python dependencies
- build `SWEP\src\sweastrology*.pyd`
- run `compileall`
- build the Windows app with `PyInstaller`

## Output

The packaged application is written to:

```text
dist\Morinus\
```

Main executable:

```text
dist\Morinus\Morinus.exe
```
