// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clampOverlayOffset,
  overlayDragBounds,
} from "../src/hooks/use-draggable-overlay";
import {
  chartNavbarHoverZoneFromRect,
  pointIsInsideChartNavbarHoverZone,
} from "../src/components/workshell/chart-navbar-hover-zone";

test("overlay drag bounds keep the whole overlay inside its canvas", () => {
  const bounds = overlayDragBounds(
    { x: 40, y: 20 },
    { left: 200, right: 400, top: 100, bottom: 150 },
    { left: 0, right: 500, top: 0, bottom: 300 },
  );

  expect(bounds).toEqual({
    minX: -152,
    maxX: 132,
    minY: -72,
    maxY: 162,
  });
  expect(clampOverlayOffset({ x: 300, y: -200 }, bounds)).toEqual({
    x: 132,
    y: -72,
  });
});

test("an oversized overlay settles at the center of an impossible axis", () => {
  expect(clampOverlayOffset(
    { x: 0, y: 0 },
    { minX: 30, maxX: -10, minY: -20, maxY: 20 },
  )).toEqual({ x: 10, y: 0 });
});

test("the moved navbar carries its padded reveal zone and reset restores edge mode", () => {
  const rect = { left: 200, right: 420, top: 160, bottom: 196 };
  const moved = chartNavbarHoverZoneFromRect(rect, { x: 60, y: -80 }, "bottom");

  expect(moved).toEqual({
    left: 182,
    right: 438,
    top: 142,
    bottom: 214,
    moved: true,
    placement: "bottom",
  });
  expect(pointIsInsideChartNavbarHoverZone(moved, 190, 150)).toBe(true);
  expect(pointIsInsideChartNavbarHoverZone(moved, 170, 150)).toBe(false);
  expect(chartNavbarHoverZoneFromRect(
    rect,
    { x: 0, y: 0 },
    "bottom",
  ).moved).toBe(false);
});

test("navbar controls never enter the parent overlay drag path", () => {
  const workspace = readFileSync(
    join(process.cwd(), "src/components/workshell/workspace-content.tsx"),
    "utf8",
  );
  const hook = readFileSync(
    join(process.cwd(), "src/hooks/use-draggable-overlay.ts"),
    "utf8",
  );
  const targetGuard = workspace.match(
    /function isInteractivePointerTarget[\s\S]*?^}/m,
  )?.[0];
  const pointerDown = hook.match(
    /const handlePointerDown[\s\S]*?^  \}, \[[^\n]+\]\);/m,
  )?.[0];

  expect(targetGuard).toBeTruthy();
  expect(targetGuard).toContain("target instanceof Element");
  expect(targetGuard).toContain("button, input, textarea, select");
  expect(targetGuard).not.toContain("target instanceof HTMLElement");
  expect(pointerDown).toBeTruthy();
  expect(pointerDown!.indexOf("isBlockedTarget?.(event.target)"))
    .toBeLessThan(pointerDown!.indexOf("element.setPointerCapture"));
});
