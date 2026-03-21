#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

arch="${1:-x86_64}"
pyinstaller_arch="${arch}"
host_python="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
venv_dir="${repo_root}/.build-venvs/macos-${arch}"
venv_python="${venv_dir}/bin/python"
output_app="${repo_root}/dist/Morinus-${arch}.app"

run_for_arch() {
    if [ "${arch}" = "x86_64" ]; then
        arch -x86_64 "$@"
    else
        "$@"
    fi
}

case "${arch}" in
    x86_64)
        export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.13}"
        export ARCHFLAGS="-arch x86_64"
        ;;
    arm64)
        export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
        export ARCHFLAGS="-arch arm64"
        ;;
    universal)
        export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
        export ARCHFLAGS="-arch x86_64 -arch arm64"
        pyinstaller_arch="universal2"
        ;;
    *)
        echo "Usage: $0 [x86_64|arm64|universal]" >&2
        exit 2
        ;;
esac

if [ ! -x "${venv_python}" ]; then
    rm -rf "${venv_dir}"
    run_for_arch "${host_python}" -m venv "${venv_dir}"

    run_for_arch "${venv_python}" -m pip install --upgrade pip
    run_for_arch "${venv_python}" -m pip install -r requirements-dev.txt

    # Universal app packaging needs a dual-arch Pillow build instead of a single-arch wheel.
    if [ "${arch}" = "universal" ]; then
        run_for_arch env MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET}" ARCHFLAGS="${ARCHFLAGS}" \
            "${venv_python}" -m pip install --force-reinstall --no-binary=Pillow Pillow
    fi
fi

PYTHON_BIN="${venv_python}" ./scripts/build_sweastrology.sh "${arch}"

export PYINSTALLER_CONFIG_DIR="${repo_root}/.pyinstaller"
export PYINSTALLER_TARGET_ARCH="${pyinstaller_arch}"
rm -rf "${repo_root}/dist/Morinus" "${repo_root}/dist/Morinus.app" "${output_app}" || true
run_for_arch "${venv_python}" -m PyInstaller Morinus.macos.spec --clean -y
mv "${repo_root}/dist/Morinus.app" "${output_app}"

echo "Built: ${output_app}"
