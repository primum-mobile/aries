#!/usr/bin/env bash
# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prepare build/wasm for the browser (Pyodide) build. Idempotent: every step is
# skipped when its output already exists, so `make web` can call it each time.
#
#   build/wasm/.venv-pyodide   pyodide-build + Emscripten cross-build env
#   build/wasm/dist            sweastrology + transit kernel wasm32 wheels
#   build/wasm/wheels          pure-Python extras not in the Pyodide distribution
#   build/wasm/node            the Pyodide runtime (npm) with its package wheels
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
wasm="${ARIES_WASM_DIR:-$repo/build/wasm}"
pyodide_version="${ARIES_PYODIDE_VERSION:-314.0.7}"
host_python="${ARIES_PYODIDE_HOST_PYTHON:-python3.14}"
export npm_config_cache="$wasm/.npm-cache"
mkdir -p "$wasm"

if [[ ! -x "$wasm/.venv-pyodide/bin/pyodide" ]]; then
  echo "Installing pyodide-build ($host_python)"
  "$host_python" -m venv "$wasm/.venv-pyodide"
  "$wasm/.venv-pyodide/bin/pip" install -q pyodide-build
fi
pyodide="$wasm/.venv-pyodide/bin/pyodide"
# The cross-build environment and Emscripten (about 1.7 GB) only build the two
# extension wheels; skip them while both wheels exist.
if ! ls "$wasm"/dist/sweastrology-*.whl "$wasm"/dist/aries_transit_kernel-*.whl >/dev/null 2>&1 \
  && ! "$pyodide" xbuildenv versions 2>/dev/null | grep -q "$pyodide_version"; then
  echo "Installing the Pyodide $pyodide_version cross-build environment and Emscripten"
  # The release index lives on pyodide.github.io; where only github.com is
  # reachable, install the same release asset by URL.
  "$pyodide" xbuildenv install "$pyodide_version" \
    || "$pyodide" xbuildenv install --url \
      "https://github.com/pyodide/pyodide/releases/download/$pyodide_version/xbuildenv-$pyodide_version.tar.bz2"
  "$pyodide" xbuildenv install-emscripten
fi

swe_sources=(swecl.c swedate.c swehel.c swehouse.c swejpl.c swemmoon.c swemplan.c swepcalc.c swepdate.c sweph.c swephlib.c)
mkdir -p "$wasm/dist"
if ! ls "$wasm"/dist/sweastrology-*.whl >/dev/null 2>&1; then
  echo "Building sweastrology for wasm32"
  rm -rf "$wasm/swe" && mkdir -p "$wasm/swe"
  cp "$repo"/SWEP/src/*.c "$repo"/SWEP/src/*.h "$repo/SWEP/src/setup.py" "$repo/SWEP/src/pyproject.toml" "$wasm/swe/"
  (cd "$wasm/swe" && "$pyodide" build -o "$wasm/dist")
fi
if ! ls "$wasm"/dist/aries_transit_kernel-*.whl >/dev/null 2>&1; then
  echo "Building the transit kernel for wasm32"
  tk="$wasm/tk"
  rm -rf "$tk" && mkdir -p "$tk/aries/astrology/transit_fast" "$tk/swep"
  cp "$repo/aries/astrology/transit_fast/_transit_kernel.c" "$tk/aries/astrology/transit_fast/"
  cp "$repo"/SWEP/src/*.c "$repo"/SWEP/src/*.h "$tk/swep/"
  cp "$repo/SWEP/src/pyproject.toml" "$tk/"
  {
    echo 'from setuptools import Extension, setup'
    printf 'SW = [%s]\n' "$(printf '"%s",' "${swe_sources[@]}")"
    echo 'setup(name="aries-transit-kernel", version="1.0", packages=[],'
    echo '  ext_modules=[Extension("aries.astrology.transit_fast._transit_kernel",'
    echo '    sources=["aries/astrology/transit_fast/_transit_kernel.c"] + ["swep/" + s for s in SW],'
    echo '    include_dirs=["swep"], extra_compile_args=["-O3", "-fvisibility=hidden"])])'
  } > "$tk/setup.py"
  (cd "$tk" && "$pyodide" build -o "$wasm/dist")
fi

mkdir -p "$wasm/wheels"
for spec in geographiclib==2.1 reportlab==4.5.1 charset-normalizer==3.5.2; do
  name="${spec%%==*}"
  if ! ls "$wasm/wheels/${name//-/_}"-*.whl >/dev/null 2>&1; then
    "$wasm/.venv-pyodide/bin/pip" download -q --no-deps --only-binary=:all: \
      --python-version 3.14 --platform any "$spec" -d "$wasm/wheels"
  fi
done

if [[ ! -f "$wasm/node/node_modules/pyodide/package.json" ]] \
  || ! grep -q "\"version\": \"$pyodide_version\"" "$wasm/node/node_modules/pyodide/package.json"; then
  echo "Installing the Pyodide $pyodide_version runtime"
  mkdir -p "$wasm/node"
  [[ -f "$wasm/node/package.json" ]] || (cd "$wasm/node" && npm init -y >/dev/null)
  (cd "$wasm/node" && npm install --no-audit --no-fund "pyodide@$pyodide_version" >/dev/null)
fi
echo "WASM toolchain ready in $wasm"
