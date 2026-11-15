// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GenericTablePayload, GenericTableRow } from "@/lib/daemon/client";

/** Speculum tables whose layer-gated rows follow the chart's visible layers. */
export const SPECULUM_LAYER_TABLE_IDS: ReadonlySet<string> = new Set(["positions", "pd_speculum"]);

/** The daemon always sends Vertex, prenatal Syzygy and the prenatal eclipse
 * with their chart layer as ``meta.layerId``. Hide the rows whose layer is
 * off (daemon-owned ``hiddenObjectIds``) without refetching, and title the
 * PD significators' extra-points section. */
export function withSpeculumLayers(
  payload: GenericTablePayload,
  hiddenObjectIds: readonly string[],
  extraPointsTitle: string,
): GenericTablePayload {
  const hidden = new Set(hiddenObjectIds);
  const visible = (row: GenericTableRow) => {
    const layer = row.meta?.layerId;
    return typeof layer !== "string" || !hidden.has(layer);
  };
  return {
    ...payload,
    rows: payload.rows.filter(visible),
    sections: payload.sections?.map((section) => ({
      ...section,
      title: section.id === "extra" ? extraPointsTitle : section.title,
      rows: section.rows.filter(visible),
    })),
  };
}
