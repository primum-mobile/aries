// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Search, Settings, SlidersHorizontal } from "lucide-react";
import { useMemo, type CSSProperties } from "react";

import type { ChartRenderSnapshot } from "@/lib/chart/types";
import type { ThemeState } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import {
  APP_AUTHORING_OVERRIDE_PREFIX,
  type StyleLabScalarValue,
} from "@/lib/style-lab/client";
import {
  appMaterialStyleSheet,
  compileThemeAppMaterials,
} from "@/lib/theme/app-material-runtime";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";

import { ChartSurface } from "./workspace-content";

const PREVIEW_SCOPE = '[data-aries-material-preview="app"]';

export function AppThemePreview({
  chart,
}: {
  chart: ChartRenderSnapshot;
}) {
  const t = useT();
  const baseTheme = useChartStyleEditorStore((state) => state.styleLabBaseTheme);
  const semanticOverrides = useChartStyleEditorStore(
    (state) => state.semanticOverrides,
  );
  const cssOverrides = useChartStyleEditorStore((state) => state.cssOverrides);
  const styleEditorRevision = useChartStyleEditorStore((state) => state.revision);

  const appTokens = useMemo(
    () => ({
      ...baseTheme.appTokens,
      ...cssOverrides,
    }),
    [baseTheme, cssOverrides],
  );
  const chartPalette = useMemo(
    () => ({
      ...baseTheme.chartPalette,
      ...cssOverrides,
    }),
    [baseTheme, cssOverrides],
  );
  const appAuthoring = useMemo(
    () => ({
      ...baseTheme.appAuthoring,
      ...(Object.fromEntries(
        Object.entries(semanticOverrides).filter(([semanticId]) =>
          semanticId.startsWith(APP_AUTHORING_OVERRIDE_PREFIX)
        ),
      ) as Record<string, StyleLabScalarValue>),
    }),
    [baseTheme.appAuthoring, semanticOverrides],
  );
  const previewTheme = useMemo<ThemeState>(
    () => ({
      activePreset: baseTheme.sourceThemeName ?? "style-lab",
      mode: baseTheme.mode,
      schemaVersion: 1,
      version: 1,
      styleRevision: styleEditorRevision,
      paletteHash: `style-lab-${styleEditorRevision}`,
      styleHash: `style-lab-${styleEditorRevision}`,
      appTokens,
      chartPalette,
      activeProfile: null,
      profileOverrides: {
        appTokens,
        chartPalette,
        chartData: {},
        wheelAuthoring: {},
        appAuthoring,
      },
    }),
    [
      appAuthoring,
      appTokens,
      baseTheme.mode,
      baseTheme.sourceThemeName,
      chartPalette,
      styleEditorRevision,
    ],
  );
  const materialCss = useMemo(
    () => appMaterialStyleSheet(
      compileThemeAppMaterials(appAuthoring, appTokens),
      PREVIEW_SCOPE,
    ),
    [appAuthoring, appTokens],
  );
  return (
    <section
      data-aries-material-preview="app"
      aria-label={t("styleLab.app.preview.label")}
      style={{
        ...appTokens,
        ...chartPalette,
        colorScheme: baseTheme.mode,
      } as CSSProperties}
      className="relative grid h-full min-h-0 w-full grid-cols-[11rem_minmax(0,1fr)_14rem] grid-rows-[2.2rem_minmax(0,1fr)_1.7rem] overflow-hidden text-[length:var(--aries-font-size-base)]"
    >
      <style>{materialCss}</style>

      <header
        data-aries-surface="titlebar"
        className="col-span-3 grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-center border-b border-[color:var(--aries-border-subtle)] px-3"
      >
        <span aria-hidden="true" />
        <span className="truncate text-center text-[length:var(--aries-font-size-small)] font-medium">
          {chart.primaryChart.meta.titleParts?.join(" · ") ||
            chart.primaryChart.meta.name}
        </span>
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            data-aries-surface="control"
            aria-label={t("toolbar.search")}
            className="inline-flex size-7 items-center justify-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)]"
          >
            <Search size={13} />
          </button>
          <button
            type="button"
            data-aries-surface="control"
            aria-label={t("toolbar.settings")}
            className="inline-flex size-7 items-center justify-center rounded-[var(--aries-radius-control-compact)] border border-[color:var(--aries-border-subtle)]"
          >
            <Settings size={13} />
          </button>
        </div>
      </header>

      <aside
        data-aries-surface="sidebar"
        className="row-start-2 flex min-h-0 flex-col border-r border-[color:var(--aries-border-subtle)] p-2"
      >
        <div className="mb-2 text-[length:var(--aries-font-size-small)] font-medium">
          {t("styleLab.app.preview.library")}
        </div>
        <nav className="space-y-1">
          {[
            "styleLab.app.preview.hereNow",
            "styleLab.app.preview.charts",
            "styleLab.app.preview.transits",
            "styleLab.app.preview.tables",
          ].map((key, index) => (
            <div
              key={key}
              className={`rounded-[var(--aries-radius-control-compact)] px-2 py-1.5 ${
                index === 1
                  ? "bg-[var(--aries-accent)]"
                  : ""
              }`}
              style={index === 1
                ? { color: "var(--aries-sidebar-accent-foreground)" }
                : undefined}
            >
              {t(key)}
            </div>
          ))}
        </nav>
      </aside>

      <main
        data-aries-surface="canvas"
        className="relative row-start-2 min-h-0 overflow-hidden"
      >
        <ChartSurface
          chart={chart}
          appControlsEnabled={false}
          inheritAppTheme={false}
          resolvedTheme={previewTheme}
          exportRegistrationEnabled={false}
        />
        <div
          data-aries-surface="overlay"
          className="absolute right-2 top-2 flex items-center gap-1 rounded-[var(--aries-radius-control)] border border-[color:var(--aries-border-subtle)] p-1 shadow-sm"
        >
          <button
            type="button"
            data-aries-surface="control"
            aria-label={t("toolbar.search")}
            className="inline-flex size-7 items-center justify-center rounded-[var(--aries-radius-control-compact)]"
          >
            <Search size={13} />
          </button>
          <button
            type="button"
            data-aries-surface="control"
            aria-label={t("toolbar.settings")}
            className="inline-flex size-7 items-center justify-center rounded-[var(--aries-radius-control-compact)]"
          >
            <Settings size={13} />
          </button>
        </div>
      </main>

      <aside
        data-aries-surface="inspector"
        className="row-start-2 min-h-0 border-l border-[color:var(--aries-border-subtle)] p-3"
      >
        <div className="mb-3 flex items-center justify-between font-medium">
          <span>{t("styleLab.app.preview.inspector")}</span>
          <SlidersHorizontal size={14} />
        </div>
        <div
          data-aries-surface="panel"
          className="rounded-[var(--aries-radius-control)] border border-[color:var(--aries-border-subtle)] p-2"
        >
          <div className="font-medium">{t("styleLab.app.preview.jupiter")}</div>
          <div className="mt-2 text-[color:var(--aries-text-muted)]">
            {t("styleLab.app.preview.domicile")}
          </div>
        </div>
        <section
          data-aries-surface="panel"
          className="mt-3 min-h-0 overflow-hidden rounded-[var(--aries-radius-control)] border border-[color:var(--aries-border-subtle)]"
        >
          <div
            data-aries-surface="dataHeader"
            className="grid grid-cols-[minmax(0,1fr)_4.25rem_2.5rem] border-b border-[color:var(--aries-border-subtle)] px-2 py-1.5 text-[length:var(--aries-font-size-micro)] font-medium"
          >
            <span>{t("styleLab.app.preview.object")}</span>
            <span>{t("styleLab.app.preview.position")}</span>
            <span>{t("styleLab.app.preview.house")}</span>
          </div>
          <div
            data-aries-surface="dataBody"
            className="divide-y divide-[color:var(--aries-border-subtle)] text-[length:var(--aries-font-size-small)]"
          >
            {[
              [t("styleLab.app.preview.sun"), "17° 15′", "1"],
              [t("styleLab.app.preview.moon"), "05° 26′", "9"],
              [t("styleLab.app.preview.jupiter"), "18° 27′", "7"],
            ].map((row) => (
              <div
                key={row[0]}
                className="grid grid-cols-[minmax(0,1fr)_4.25rem_2.5rem] px-2 py-1.5"
              >
                <span>{row[0]}</span>
                <span>{row[1]}</span>
                <span>{row[2]}</span>
              </div>
            ))}
          </div>
        </section>
        <div
          data-aries-surface="popover"
          className="mt-3 rounded-[var(--aries-radius-popover)] border border-[color:var(--aries-border-subtle)] p-2 shadow-sm"
        >
          <div className="font-medium">{t("styleLab.app.preview.jupiter")}</div>
          <div className="mt-1 text-[color:var(--aries-text-muted)]">
            {t("styleLab.app.preview.domicile")}
          </div>
        </div>
      </aside>

      <footer
        data-aries-surface="statusbar"
        className="col-span-3 row-start-3 flex items-center justify-between border-t border-[color:var(--aries-border-subtle)] px-3 text-[length:var(--aries-font-size-micro)]"
      >
        <span>
          {chart.primaryChart.meta.statusFields?.join(" · ") ||
            chart.primaryChart.meta.name}
        </span>
        <span>{chart.primaryChart.meta.placeCoords}</span>
      </footer>
    </section>
  );
}
