// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

// Poster export from any chart surface (⌥E, manifest command `export-poster`).
// What you see is what prints: the chart wheel is the active chart's current
// snapshot in the current style (aspects, house lines, rings, colours), and
// the plate is the astrolabe on screen, or, from a chart, the astrolabe that
// chart would show with the stored astrolabe settings. The dialog only picks
// which of them the sheet carries and how it is laid out.

import * as React from "react";

import { posterWheelPainter } from "@/lib/chart/chart-export-renderer";
import { drawPngWatermark, preparePngWatermark } from "@/lib/chart/chart-export-watermark";
import { aspectGridBodies, moonListRowCount } from "@/lib/chart/dashboard-canvas";
import type { ChartDashboard, ChartRenderSnapshot } from "@/lib/chart/types";
import { decodeBase64Bytes, fetchOptions, fetchPosterDashboard } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { resolveShellHost } from "@/lib/shell-host";
import { useStyleRevision } from "@/hooks/use-style-revision";
import { usePosterExportStore, type PreparedPosterPlate } from "@/stores/poster-export-store";
import { useThemeStore } from "@/stores/theme-store";
import type { WorkspaceDocument } from "@/stores/workspace-store";
import {
  exportAstrolabePoster,
  paintPosterSheet,
  posterLayout,
  POSTER_COUNTS_DEFAULT,
  type PosterCounts,
  type PosterLayout,
} from "./astrolabe-poster";
import {
  AstrolabePosterDialog,
  effectivePosterChoice,
  POSTER_CHOICE_DEFAULT,
  posterHasContent,
  type PosterChoice,
  type PosterFailure,
} from "./astrolabe-poster-dialog";
import { prepareStoredAstrolabePlate } from "./astrolabe-view";
import {
  estimateMeasure,
  paintStaggerSheet,
  posterStaggerLayout,
  posterTitleFromChart,
  type PosterMeasure,
  type StaggerModules,
} from "./poster-stagger";

const DASHBOARD_RETRIES = 3;
const RETRY_MS = 1000;

/** A daemon restart drops a request; a few retries ride it out. */
async function retrying<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= DASHBOARD_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

type PosterTarget = {
  chart: ChartRenderSnapshot | null;
  chartDocumentId: string | null;
  sourceName: string;
  preparePlate: () => Promise<PreparedPosterPlate>;
};

/** The poster dialog's last choices, for the next poster this session. */
let lastChoice: PosterChoice = POSTER_CHOICE_DEFAULT;

let measureContext: CanvasRenderingContext2D | null = null;
/** Text widths for the title block, from one kept 2D context. */
const measureText: PosterMeasure = (text, font) => {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return estimateMeasure(text, font);
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

/** The sheet for a choice: a fixed layout or the Custom elements. */
function choiceLayout(
  choice: PosterChoice,
  counts: PosterCounts,
  chart: ChartRenderSnapshot | null,
  fontUi: string,
  modules: StaggerModules,
  mark: string | null,
): PosterLayout {
  if (choice.mode === "layout" && chart) {
    return posterStaggerLayout(choice.sheet, counts, posterTitleFromChart(chart.primaryChart.meta, mark), fontUi, modules, measureText);
  }
  return posterLayout(choice.sheet, choice, counts);
}

export function PosterExportHost({
  activeDoc,
  activeChart,
}: {
  activeDoc: WorkspaceDocument | null;
  activeChart: ChartRenderSnapshot | null;
}) {
  const t = useT();
  const theme = useThemeStore((state) => state.theme);
  const styleRevision = useStyleRevision();
  const open = usePosterExportStore((state) => state.open);
  const close = usePosterExportStore((state) => state.close);
  const live = usePosterExportStore((state) => state.live);
  const [choice, setChoiceState] = React.useState<PosterChoice>(() => lastChoice);
  const setChoice = React.useCallback((next: PosterChoice) => {
    lastChoice = next;
    setChoiceState(next);
  }, []);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<PosterFailure | null>(null);
  const [dashboard, setDashboard] = React.useState<{ documentId: string; data: ChartDashboard } | null>(null);

  // The astrolabe on screen paints its own plate and names its chart;
  // anywhere else the active chart is the chart, and its astrolabe is built
  // from the stored settings.
  const target = React.useMemo<PosterTarget | null>(() => {
    if (!activeDoc) return null;
    if (activeDoc.kind === "astrolabe") {
      if (!live || live.documentId !== activeDoc.id) return null;
      return {
        chart: live.chart,
        chartDocumentId: live.chartDocumentId || null,
        sourceName: activeDoc.sourceName,
        preparePlate: live.preparePlate,
      };
    }
    const chartDocumentId = activeChart?.document?.documentId ?? null;
    if (!activeChart || !chartDocumentId) return null;
    return {
      chart: activeChart,
      chartDocumentId,
      sourceName: activeDoc.sourceName,
      preparePlate: () => prepareStoredAstrolabePlate({
        documentId: chartDocumentId,
        sourceName: activeDoc.sourceName,
        source: activeDoc.fpath ?? undefined,
        theme,
        styleRevision,
        t,
      }),
    };
  }, [activeChart, activeDoc, live, styleRevision, t, theme]);

  const loadDashboard = React.useCallback(async (documentId: string) => {
    const data = await retrying(() => fetchPosterDashboard(documentId));
    setDashboard({ documentId, data });
    return data;
  }, []);

  // Module data for the preview's sizes, fetched when the dialog opens.
  const chartDocumentId = target?.chartDocumentId ?? null;
  React.useEffect(() => {
    if (!open || !chartDocumentId) return;
    let current = true;
    void retrying(() => fetchPosterDashboard(chartDocumentId))
      .then((data) => {
        if (current) setDashboard({ documentId: chartDocumentId, data });
      })
      .catch((err) => console.error("[poster:dashboard]", err));
    return () => {
      current = false;
    };
  }, [chartDocumentId, open]);

  // Without a chart or a ready astrolabe there is nothing to print.
  React.useEffect(() => {
    if (open && !target) close();
  }, [close, open, target]);

  const modules = dashboard?.documentId === chartDocumentId ? dashboard.data : null;
  const chart = target?.chart ?? null;
  const counts = React.useMemo<PosterCounts>(() => ({
    speculumRows: chart?.primaryChart.planets.length ?? POSTER_COUNTS_DEFAULT.speculumRows,
    gridBodies: modules?.bodies ? aspectGridBodies(modules).length : POSTER_COUNTS_DEFAULT.gridBodies,
    scaleBodies: modules?.bodies?.length ?? POSTER_COUNTS_DEFAULT.scaleBodies,
    moonRows: modules?.moon ? moonListRowCount(modules) : POSTER_COUNTS_DEFAULT.moonRows,
    mirrored: modules?.declinationMirrored ?? POSTER_COUNTS_DEFAULT.mirrored,
  }), [chart, modules]);
  // Until the module data arrives the preview assumes both corner modules.
  const staggerModules = React.useMemo<StaggerModules>(() => ({
    aspectGrid: modules ? Boolean(modules.grid) : true,
    moon: modules ? Boolean(modules.moon) : true,
  }), [modules]);
  // The chart's print style (fonts) for the preview, resolved while the dialog is open.
  const previewWheel = React.useMemo(() => (open && chart ? posterWheelPainter(chart, theme) : null), [chart, open, theme]);
  const previewFont = previewWheel?.fonts.ui ?? "sans-serif";
  const layoutFor = React.useCallback(
    (picked: PosterChoice) => choiceLayout(picked, counts, chart, previewFont, staggerModules, picked.kind === "png" ? t("chartExport.watermark") : null),
    [chart, counts, previewFont, staggerModules, t],
  );

  const exportPoster = React.useCallback(async (picked: PosterChoice) => {
    if (!target || busy) return;
    const { sheet, kind } = picked;
    // The wheel, its tables, the modules and the fixed layouts need a chart.
    const content = effectivePosterChoice(picked, Boolean(target.chart));
    if (!posterHasContent(content)) return;
    const fixed = content.mode === "layout";
    setFailure(null);
    setBusy(true);
    let exporting = false;
    try {
      // Everything the sheet needs is ready before the save dialog, so a
      // failure keeps the dialog open and says what is missing.
      let moduleData: ChartDashboard | null = null;
      if ((fixed || content.aspectGrid || content.declination || content.moon) && target.chartDocumentId) {
        try {
          moduleData = await loadDashboard(target.chartDocumentId);
        } catch (err) {
          console.error("[poster:dashboard]", err);
          setFailure("modules");
          return;
        }
      }
      let plate: PreparedPosterPlate | null = null;
      if (fixed || content.plate) {
        try {
          plate = await retrying(target.preparePlate);
        } catch (err) {
          console.error("[poster:plate]", err);
          setFailure("plate");
          return;
        }
      }
      const sheetContent: PosterChoice = {
        ...content,
        aspectGrid: content.aspectGrid && Boolean(moduleData?.grid),
        declination: content.declination && Boolean(moduleData?.declination),
        moon: content.moon && Boolean(moduleData?.moon),
      };
      const host = resolveShellHost();
      const name = `${target.sourceName.trim() || "aries"} ${t("astrolabe.poster.fileName")} ${sheet}`
        .replace(/[\\/:*?"<>|]+/g, "_");
      const path = host.capabilities.nativeFileDialogs
        ? await host.selectSavePath({
          title: t("astrolabe.poster.saveTitle"),
          defaultPath: `${name}.${kind}`,
          filters: [kind === "png"
            ? { name: t("home.filterPng"), extensions: ["png"] }
            : { name: t("home.filterPdf"), extensions: ["pdf"] }],
        })
        : null;
      if (host.capabilities.nativeFileDialogs && !path) return;
      exporting = true;
      close();

      const options = await fetchOptions();
      const watermarkLabel = options.export.pngWatermarkText || t("chartExport.watermark");
      const watermarkStyle = options.export.pngWatermarkStyle;
      if (kind === "png") await preparePngWatermark(watermarkStyle);
      // The chart exactly as on screen: its snapshot in the screen style.
      const wheel = target.chart ? posterWheelPainter(target.chart, theme) : null;
      const ink = wheel
        ? { text: wheel.palette.textBright, muted: wheel.palette.textDim, fontUi: wheel.fonts.ui, fontSymbols: wheel.fonts.symbols }
        : plate?.ink;
      if (!ink) return;
      const labels = {
        longitude: t("astrolabe.poster.longitude"),
        house: t("astrolabe.poster.house"),
        cusps: t("astrolabe.poster.cusps"),
      };
      const mark = kind === "png" ? watermarkLabel : null;
      const layout = choiceLayout(sheetContent, counts, target.chart, ink.fontUi, {
        aspectGrid: Boolean(moduleData?.grid),
        moon: Boolean(moduleData?.moon),
      }, mark);
      const title = target.chart ? posterTitleFromChart(target.chart.primaryChart.meta, mark) : null;
      const staggerLabels = {
        bodies: t("sphere.bodies"),
        houses: t("sphere.houses"),
        longitude: t("astrolabe.poster.longitude"),
        house: t("astrolabe.poster.house"),
        cusps: t("astrolabe.poster.cusps"),
        aspects: t("common.aspects"),
        moon: t(moduleData?.moon?.voidOfCourse.isVoid ? "dashboard.moon.headingVoid" : "dashboard.moon.heading"),
      };
      const result = await exportAstrolabePoster(layout, sheet, kind, name, path ? { path } : { filename: `${name}.${kind}` }, {
        background: plate?.background ?? wheel?.palette.background ?? ink.muted,
        plate: (canvas, side, dpr) => plate?.paint(canvas, side, dpr),
        wheel: (canvas, frame, sheetLayout) => {
          if (!sheetLayout.wheel || !sheetLayout.wheelClip) return;
          wheel?.paint(canvas, frame, sheetLayout.page, sheetLayout.wheel, sheetLayout.wheelClip, sheetLayout.dpr, true);
        },
        sheet: (draw, sheetLayout) => {
          const sheetChart = wheel?.snapshot.primaryChart ?? null;
          if (sheetLayout.stagger) {
            // The fixed layout's title block ends in the watermark itself.
            if (sheetChart && title) paintStaggerSheet(draw, sheetLayout.stagger, sheetChart, title, ink, staggerLabels);
          } else {
            paintPosterSheet(draw, sheetLayout, sheetChart, ink, labels);
          }
          if (wheel && moduleData && sheetLayout.modules) {
            wheel.paintModules(draw, moduleData, sheetLayout.modules, t, sheetLayout.modulesPrint ?? undefined);
          }
          if (kind !== "png" || sheetLayout.stagger) return;
          drawPngWatermark(draw.ctx, sheetLayout.page.width, watermarkLabel, {
            x: sheetLayout.frame + sheetLayout.type,
            y: sheetLayout.frame + sheetLayout.foot * 2,
            size: sheetLayout.foot * 1.15,
            font: ink.fontUi,
            maxWidth: sheetLayout.page.width * 0.25,
            monochrome: false,
            style: watermarkStyle,
            color: ink.text,
          });
        },
      });
      if ("dataBase64" in result) {
        await host.downloadBytes(result.filename, decodeBase64Bytes(result.dataBase64), result.mimeType);
      }
    } catch (err) {
      console.error("[poster]", err);
      if (!exporting) setFailure("plate");
    } finally {
      setBusy(false);
    }
  }, [busy, close, counts, loadDashboard, target, t, theme]);

  return (
    <AstrolabePosterDialog
      open={open && target !== null}
      onOpenChange={(next) => {
        if (next) return;
        setFailure(null);
        close();
      }}
      choice={choice}
      onChoiceChange={setChoice}
      layoutFor={layoutFor}
      hasChart={Boolean(target?.chart)}
      busy={busy}
      failure={failure}
      onExport={() => void exportPoster(choice)}
    />
  );
}
