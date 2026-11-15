// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Fragment } from "react";
import { ContextMenuCheckboxItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { ChartDashboard } from "@/lib/chart/types";
import { patchOptions } from "@/lib/daemon/client";
import { useT } from "@/lib/i18n/i18n";

/** The same daemon-owned display options as Settings → Appearance. */
export function DashboardAppearanceMenu({ dashboard }: { dashboard: ChartDashboard }) {
  const t = useT();
  const groups = [
    [
      { option: "dashboard_aspect_grid", label: "settings.dashboard.aspectGrid", checked: dashboard.modules.aspectGrid },
      { option: "dashboard_grid_large", label: "settings.dashboard.aspectGridLarge", checked: Boolean(dashboard.gridLarge), disabled: !dashboard.modules.aspectGrid },
      { option: "dashboard_grid_orbs", label: "settings.dashboard.aspectGridOrbs", checked: dashboard.gridOrbs, disabled: !dashboard.modules.aspectGrid },
      { option: "dashboard_grid_parallels", label: "settings.dashboard.aspectGridParallels", checked: dashboard.gridParallels !== false, disabled: !dashboard.modules.aspectGrid },
    ],
    [
      { option: "dashboard_declination", label: "settings.dashboard.declination", checked: dashboard.modules.declination },
      { option: "dashboard_declination_horizontal", label: "settings.dashboard.declinationHorizontal", checked: Boolean(dashboard.declinationHorizontal), disabled: !dashboard.modules.declination },
      { option: "dashboard_declination_mirrored", label: "settings.dashboard.declinationMirrored", checked: dashboard.declinationMirrored, disabled: !dashboard.modules.declination },
    ],
    [
      { option: "dashboard_moon", label: "settings.dashboard.moon", checked: dashboard.modules.moon },
      { option: "dashboard_moon_all_bodies", label: "settings.dashboard.moonAllBodies", checked: Boolean(dashboard.moonAllBodies), disabled: !dashboard.modules.moon },
    ],
  ] as const;

  return groups.map((items, index) => (
    <Fragment key={index}>
      {index > 0 ? <ContextMenuSeparator /> : null}
      {items.map((item) => (
        <ContextMenuCheckboxItem
          key={item.option}
          checked={item.checked}
          disabled={"disabled" in item && item.disabled}
          closeOnClick={false}
          onCheckedChange={(checked) => {
            void patchOptions({ display: { [item.option]: checked } })
              .catch((err) => console.error("[dashboard-appearance]", err));
          }}
        >
          {t(item.label)}
        </ContextMenuCheckboxItem>
      ))}
    </Fragment>
  ));
}
