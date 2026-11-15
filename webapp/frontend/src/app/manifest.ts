// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MetadataRoute } from "next";

// Static export: lets Add to Home Screen run the browser build standalone.
// URLs are relative to the manifest, so the site works below any base path.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  // No "maskable" icon: the ram reaches past the mask's safe zone.
  return {
    id: "./",
    name: "Aries",
    short_name: "Aries",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#232428",
    theme_color: "#232428",
    icons: [
      { src: "aries-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "aries-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
