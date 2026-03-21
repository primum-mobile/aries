#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}/SWEP/src"

arch="${1:-${ARCHFLAGS:-x86_64}}"
deployment_target="${MACOSX_DEPLOYMENT_TARGET:-10.13}"
python_bin="${PYTHON_BIN:-python3}"

case "${arch}" in
    x86_64|arm64)
        export ARCHFLAGS="-arch ${arch}"
        ;;
    universal)
        export ARCHFLAGS="-arch x86_64 -arch arm64"
        deployment_target="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
        ;;
    *)
        echo "Usage: $0 [x86_64|arm64|universal]" >&2
        exit 2
        ;;
esac

export MACOSX_DEPLOYMENT_TARGET="${deployment_target}"

"${python_bin}" setup.py build_ext --inplace
