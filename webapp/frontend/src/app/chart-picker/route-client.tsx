// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useSearchParams } from "next/navigation";

import { SystemChartPicker } from "@/components/workshell/system-chart-picker";
import { ThemeProvider } from "@/components/workshell/theme-provider";

export function ChartPickerRouteClient() {
  const params = useSearchParams();
  const modeParam = params.get("mode");
  const mode = modeParam === "synastry-partner" ? "synastry-partner" : "open-radix";
  const exclude = params.get("exclude");

  return (
    <ThemeProvider>
      <SystemChartPicker
        mode={mode}
        parentRadixId={params.get("parentRadixId")}
        excludeNames={exclude ? exclude.split("\n").filter(Boolean) : []}
      />
    </ThemeProvider>
  );
}
