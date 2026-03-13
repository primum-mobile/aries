#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

./scripts/build_sweastrology.sh

export PYINSTALLER_CONFIG_DIR="${repo_root}/.pyinstaller"
rm -rf "${repo_root}/dist/Morinus" "${repo_root}/dist/Morinus.app" || true
python3 -m PyInstaller Morinus.macos.spec --clean -y

echo "Built: ${repo_root}/dist/Morinus.app"
