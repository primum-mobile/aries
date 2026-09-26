// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import * as React from "react";

import type {
  AspectListEndpoint,
  AspectListPerfection,
  AspectListRow,
  GenericTableCell,
  GenericTableCellRun,
} from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";
import { LIST_PANE_CLASSES } from "@/lib/list-tokens";
import { buildAdHocTableExportDocument } from "./table-pdf-export";
import { TextExportActions } from "./text-export-actions";

function endpointRuns(endpoint: AspectListEndpoint): GenericTableCellRun[] {
  const runs: GenericTableCellRun[] = endpoint.displaySegments?.length
    ? endpoint.displaySegments.map((segment) => ({
        text: segment.text,
        glyph: segment.kind === "planet" || segment.kind === "glyph",
        color: endpoint.color ?? undefined,
        colorRole: endpoint.colorRole,
      }))
    : [{
        text: endpoint.glyph || endpoint.name,
        glyph: Boolean(endpoint.glyph) && endpoint.glyphFont === "morinus",
        color: endpoint.color ?? undefined,
        colorRole: endpoint.colorRole,
      }];
  const marker = endpoint.displayMarker?.trim();
  if (marker) runs.push({ text: ` ${marker}` });
  const motion = endpoint.motionMarker?.trim();
  if (motion) runs.push({ text: ` ${motion}` });
  return runs;
}

function endpointText(endpoint: AspectListEndpoint): string {
  const motion = endpoint.motionMarker?.trim();
  return [endpoint.name, motion].filter(Boolean).join(" ");
}

export function aspectListExportCells(
  row: AspectListRow,
  perfection: AspectListPerfection | undefined,
  phaseLabel: string,
  unavailable: string,
): GenericTableCell[] {
  const ready = perfection?.status === "ready" && perfection.exactDate && perfection.exactTime;
  return [
    {
      exportText: `${endpointText(row.left)} ${row.aspect.name} ${endpointText(row.right)}`,
      exportSymbolText: `${endpointText(row.left)} ${row.aspect.exportSymbolText || row.aspect.name} ${endpointText(row.right)}`,
      runs: [
        ...endpointRuns(row.left),
        { text: " " },
        {
          text: row.aspect.glyph || row.aspect.name,
          glyph: Boolean(row.aspect.glyph) && row.aspect.glyphFont === "morinus",
          color: row.aspect.color ?? undefined,
          colorRole: row.aspect.colorRole,
        },
        { text: " " },
        ...endpointRuns(row.right),
      ],
    },
    { text: [row.orbFormatted, phaseLabel].filter(Boolean).join(" "), align: "right" },
    { text: ready ? perfection.exactDate : unavailable, align: "right" },
    { text: ready ? perfection.exactTime : "", align: "left" },
  ];
}

export function AspectListExport({
  rows,
  perfectionByRow,
  retainedPerfectionByRow,
  modeLabel,
  sourceName,
  maxOrb,
  disabled,
}: {
  rows: AspectListRow[];
  perfectionByRow: ReadonlyMap<string, AspectListPerfection>;
  retainedPerfectionByRow: ReadonlyMap<string, AspectListPerfection>;
  modeLabel: string;
  sourceName: string;
  maxOrb: number;
  disabled: boolean;
}) {
  const t = useT();
  const [error, setError] = React.useState(false);
  const buildDocument = React.useCallback(() => {
    setError(false);
    return buildAdHocTableExportDocument({
      title: `${t("aspectList.title")} · ${modeLabel}`,
      fileStem: "aspect-list",
      sourceName,
      pdfProfile: "directions",
      columns: [
        { label: t("aspectList.bodies"), align: "left", widthFactor: 3 },
        { label: t("aspectList.orb"), align: "right", widthFactor: 1.5 },
        { label: t("aspectList.perfection"), align: "right", widthFactor: 1.5 },
        { label: t("search.time"), align: "left", widthFactor: 1.5 },
      ],
      rows: rows.length ? rows.map((row) => aspectListExportCells(
        row,
        perfectionByRow.get(row.id) ?? retainedPerfectionByRow.get(row.id),
        row.phase === "applying" ? t("aspectList.applyingShort")
          : row.phase === "separating" ? t("aspectList.separatingShort")
            : row.phase === "exact" ? t("aspectList.exact") : "",
        t("aspectList.notApplicable"),
      )) : [[{ text: t("aspectList.empty", { orb: maxOrb }) }, {}, {}, {}]],
    });
  }, [maxOrb, modeLabel, perfectionByRow, retainedPerfectionByRow, rows, sourceName, t]);

  return <>
    <TextExportActions
      buildDocument={buildDocument}
      fileStem="aspect-list"
      disabled={disabled}
      scopeLabel={modeLabel}
      onError={() => setError(true)}
    />
    {error ? <span role="alert" className={LIST_PANE_CLASSES.error}>{t("textExport.failed")}</span> : null}
  </>;
}
