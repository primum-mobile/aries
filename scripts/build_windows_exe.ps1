$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Virtualenv fehlt. Zuerst im Repo ausfuehren: py -3.14 -m venv .venv"
}

Push-Location $repoRoot
try {
    & $python -m pip install -r requirements-dev.txt
    if (Test-Path "requirements-optional.txt") {
        & $python -m pip install -r requirements-optional.txt
    }

    Push-Location (Join-Path $repoRoot "SWEP\src")
    try {
        & $python setup.py build_ext --inplace
    }
    finally {
        Pop-Location
    }

    & $python -m compileall -q .
    & $python -m PyInstaller Morinus.spec --clean -y
}
finally {
    Pop-Location
}
