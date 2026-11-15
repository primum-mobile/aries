// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { WorkspaceDocument } from "@/stores/workspace-store";
import { MundaneChartView } from "./mundane-chart-view";

type Props = {
  document: WorkspaceDocument;
  renderSnapshot?: import("@/lib/chart/types").ChartRenderSnapshot | null;
  snapshotData?: import("@/lib/daemon/client").MundaneChartData | null;
};

export function AscensionalTransitsView({ document, snapshotData, renderSnapshot }: Props) {
  return (
    <div className="font-morinus-text flex h-full min-h-0 bg-background">
      <MundaneChartView
        renderSnapshot={renderSnapshot}
        snapshotData={snapshotData}
        documentId={document.id}
        parentDocumentId={document.parentDocumentId}
        sourceName={document.sourceName}
        refreshKey={`${document.ascensionalEventJd ?? ""}:${
          document.ascensionalEventPlace ? JSON.stringify(document.ascensionalEventPlace) : ""
        }`}
      />
    </div>
  );
}
