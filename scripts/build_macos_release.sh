#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

./scripts/build_macos_app.sh arm64
./scripts/build_macos_app.sh x86_64

echo "Built release apps:"
echo "  ${repo_root}/dist/Morinus-arm64.app"
echo "  ${repo_root}/dist/Morinus-x86_64.app"
