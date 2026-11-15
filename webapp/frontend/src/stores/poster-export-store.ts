// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Poster export (⌥E, any chart surface): the dialog's open state and the
// astrolabe that is on screen right now. A mounted astrolabe registers its
// live plate so the poster paints exactly what it shows; without one the
// poster host builds the plate from the stored astrolabe settings
// (poster-export-host.tsx).

import { create } from "zustand";

import type { ChartRenderSnapshot } from "@/lib/chart/types";

/** The astrolabe plate ready to paint on poster tiles. */
export type PreparedPosterPlate = {
  /** Paint the plate into its square of `side` CSS px at `dpr` (fills the tile first). */
  paint: (canvas: HTMLCanvasElement, side: number, dpr: number) => void;
  /** Paper colour where no plate paints. */
  background: string;
  /** Type colours and faces when the sheet carries no wheel. */
  ink: { text: string; muted: string; fontUi: string; fontSymbols: string };
};

export type LivePosterAstrolabe = {
  /** The astrolabe document on screen. */
  documentId: string;
  /** The chart it shows, and that chart's document. */
  chartDocumentId: string;
  chart: ChartRenderSnapshot | null;
  preparePlate: () => Promise<PreparedPosterPlate>;
};

type PosterExportState = {
  open: boolean;
  live: LivePosterAstrolabe | null;
  request: () => void;
  close: () => void;
  /** Register the on-screen astrolabe; returns its unregister. */
  registerLive: (live: LivePosterAstrolabe) => () => void;
};

export const usePosterExportStore = create<PosterExportState>((set, get) => ({
  open: false,
  live: null,
  request: () => set({ open: true }),
  close: () => set({ open: false }),
  registerLive: (live) => {
    set({ live });
    return () => {
      if (get().live === live) set({ live: null });
    };
  },
}));
