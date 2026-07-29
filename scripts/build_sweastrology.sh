#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

arch="${1:-${ARCHFLAGS:-x86_64}}"
deployment_target="${MACOSX_DEPLOYMENT_TARGET:-10.13}"
python_bin="${PYTHON_BIN:-python3}"

case "${python_bin}" in
    /*)
        ;;
    */*)
        python_bin="${repo_root}/${python_bin}"
        ;;
    *)
        python_bin="$(command -v "${python_bin}")"
        ;;
esac

cd "${repo_root}/SWEP/src"
ext_suffix="$("${python_bin}" - <<'PY'
import sysconfig
print(sysconfig.get_config_var("EXT_SUFFIX") or ".so")
PY
)"

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

# Remove the previously-built .so for this interpreter so a different-arch
# build doesn't leave a stale binary in place (setuptools skips recompile when
# source mtime is unchanged). Keep other Python ABI suffixes intact.
rm -f "sweastrology${ext_suffix}"

"${python_bin}" setup.py build_ext --inplace --force

# PyInstaller's daemon spec loads the extension from the repo root so each
# Python ABI gets a stable import path regardless of where setuptools wrote it.
ln -sf "SWEP/src/sweastrology${ext_suffix}" "${repo_root}/sweastrology${ext_suffix}"

cd "${repo_root}"
"${python_bin}" scripts/build_transit_kernel.py build_ext --inplace --force
