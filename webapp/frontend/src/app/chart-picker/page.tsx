// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense } from "react";

import { ChartPickerRouteClient } from "./route-client";

export default function ChartPickerPage() {
  return (
    <Suspense fallback={null}>
      <ChartPickerRouteClient />
    </Suspense>
  );
}
