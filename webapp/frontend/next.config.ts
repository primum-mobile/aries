// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NextConfig } from "next";

const isolatedDistDir = process.env.ARIES_NEXT_DIST_DIR?.trim();
const isolatedTurbopackRoot = process.env.ARIES_TURBOPACK_ROOT?.trim();
// Browser (WASM) build served below a path such as https://aries.sh/webapp.
const basePath = process.env.ARIES_NEXT_BASE_PATH?.trim().replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "export",
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  env: { NEXT_PUBLIC_ARIES_BASE_PATH: basePath ?? "" },
  ...(isolatedDistDir ? { distDir: isolatedDistDir } : {}),
  ...(isolatedTurbopackRoot ? { turbopack: { root: isolatedTurbopackRoot } } : {}),
  // Dev-only: allow HMR/dev-resource requests when the app is opened via
  // 127.0.0.1 as well as localhost. Without this, loading the dev server over
  // 127.0.0.1 blocks the webpack-hmr socket, breaking Fast Refresh (which
  // manifests as a remount loop). No effect on the static export build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
