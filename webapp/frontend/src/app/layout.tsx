// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TextEditingShortcuts } from "@/components/text-editing-shortcuts";
import { WebEngineSplash } from "@/components/web-engine-splash";
import { I18nProvider } from "@/lib/i18n/i18n";
import { THEME_STATE_STORAGE_KEY } from "@/lib/theme/constants";
import "./globals.css";
import "./presentation-cursor.css";

export const metadata: Metadata = {
  title: "Aries",
  description: "Astrology workspace",
  // Add to Home Screen runs standalone; the status bar keeps the app's own
  // title bar colour (theme-color is updated from the active theme).
  appleWebApp: {
    capable: true,
    title: "Aries",
    statusBarStyle: "default",
  },
  other: {
    "color-scheme": "dark",
    "theme-color": "#232428",
  },
};

// Phones lay the app out at device width and extend under notches/home
// indicators; the phone chrome pads itself with the safe-area insets. Desktop
// webviews ignore these hints.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
    root.dataset.themeTokens = JSON.stringify(Object.keys(Object.assign({}, theme.appTokens, theme.chartPalette)));
    root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
    root.classList.toggle("dark", theme.mode === "dark");
    root.classList.toggle("day", theme.mode === "light");
    root.dataset.themePreset = theme.activePreset || "";
    root.dataset.themeVersion = String(theme.version || "");
    root.dataset.styleSchemaVersion = String(theme.schemaVersion || 1);
    root.dataset.styleRevision = String(theme.styleRevision || theme.version || "");
    root.dataset.styleHash = String(theme.styleHash || theme.paletteHash || "");
    root.dataset.presentationCursor = theme.presentationCursor === true ? "glow" : "system";
    root.dataset.themeReady = "cached";
  } catch (error) {
    markPending();
  }
})();
`;

// The desktop shell's OS, for the few CSS rules that differ in the native
// app (scrollbar chrome under WebView2). Only the Tauri shell's own report is
// used: the browser app keeps one set of rules on every OS.
const platformBootScript = `
(function () {
  try {
    var native = window.__ARIES_NATIVE_PLATFORM__;
    if (native === "windows" || native === "macos" || native === "linux") {
      document.documentElement.dataset.ariesOs = native;
    }
  } catch (error) {}
})();
`;

const bootPaintStyle = `
html {
  min-height: 100%;
  background: var(--background, #232428);
  color-scheme: dark;
}
body {
  min-height: 100%;
  background: var(--background, #232428);
  color-scheme: inherit;
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
        {/* Synchronous parser execution: Next's documented theme-flash pattern. */}
        <script id="aries-platform-boot" dangerouslySetInnerHTML={{ __html: platformBootScript }} />
        <script id="aries-theme-boot" dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body
        className="min-h-full bg-background text-foreground"
        style={{ backgroundColor: "var(--background, #232428)" }}
      >
        <TextEditingShortcuts />
        <I18nProvider>
          <TooltipProvider delay={250}>{children}</TooltipProvider>
          {/* Set by scripts/wasm/build_web.py for the browser build only. */}
          {process.env.NEXT_PUBLIC_ARIES_WEB_ENGINE === "1" ? <WebEngineSplash /> : null}
        </I18nProvider>
      </body>
    </html>
  );
}
