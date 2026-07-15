// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata } from "next";
import Script from "next/script";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n/i18n";
import { THEME_STATE_STORAGE_KEY } from "@/lib/theme/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morinus",
  description: "Astrology workspace",
  other: {
    "color-scheme": "dark",
    "theme-color": "#232428",
  },
};

const themeBootScript = `
(function () {
  var key = ${JSON.stringify(THEME_STATE_STORAGE_KEY)};
  var root = document.documentElement;
  function markPending() {
    root.dataset.themeReady = "pending";
    window.setTimeout(function () {
      if (root.dataset.themeReady === "pending") {
        root.dataset.themeReady = "fallback";
      }
    }, 2500);
  }
  function applyTokens(tokens) {
    for (var name in tokens) {
      if (Object.prototype.hasOwnProperty.call(tokens, name)) {
        root.style.setProperty(name, tokens[name]);
      }
    }
  }
  try {
    var raw = window.localStorage && window.localStorage.getItem(key);
    if (!raw) {
      markPending();
      return;
    }
    var theme = JSON.parse(raw);
    if (
      !theme ||
      typeof theme.activePreset !== "string" ||
      (theme.mode !== "light" && theme.mode !== "dark") ||
      typeof theme.version !== "number" ||
      typeof theme.paletteHash !== "string" ||
      !theme.appTokens ||
      typeof theme.appTokens !== "object" ||
      !theme.chartPalette ||
      typeof theme.chartPalette !== "object"
    ) {
      markPending();
      return;
    }
    applyTokens(theme.appTokens);
    applyTokens(theme.chartPalette);
    root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
    root.classList.toggle("dark", theme.mode === "dark");
    root.classList.toggle("day", theme.mode === "light");
    root.dataset.themePreset = theme.activePreset || "";
    root.dataset.themeVersion = String(theme.version || "");
    root.dataset.styleSchemaVersion = String(theme.schemaVersion || 1);
    root.dataset.styleRevision = String(theme.styleRevision || theme.version || "");
    root.dataset.styleHash = String(theme.styleHash || theme.paletteHash || "");
    root.dataset.themeReady = "cached";
  } catch (error) {
    markPending();
  }
})();
`;

const bootPaintStyle = `
html,
body {
  min-height: 100%;
  background: var(--background, #232428);
  color-scheme: dark;
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={{ backgroundColor: "var(--background, #232428)", colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <head>
        <style id="aries-boot-paint" dangerouslySetInnerHTML={{ __html: bootPaintStyle }} />
      </head>
      <body
        className="min-h-full bg-background text-foreground"
        style={{ backgroundColor: "var(--background, #232428)" }}
      >
        <Script
          id="aries-theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
        <I18nProvider>
          <TooltipProvider delay={250}>{children}</TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
