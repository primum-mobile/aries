import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Dev-only: allow HMR/dev-resource requests when the app is opened via
  // 127.0.0.1 as well as localhost. Without this, loading the dev server over
  // 127.0.0.1 blocks the webpack-hmr socket, breaking Fast Refresh (which
  // manifests as a remount loop). No effect on the static export build.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
