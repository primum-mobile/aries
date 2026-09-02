// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  findChartLaunchParent,
  findRadixSiblingLaunchParent,
} from "../src/components/workshell/chart-launch-parent";
import type { WorkspaceDocument } from "../src/stores/workspace-store";

function workspaceDoc(
  id: string,
  fields: Partial<WorkspaceDocument>,
): WorkspaceDocument {
  return {
    id,
    parentDocumentId: null,
    kind: "radix",
    sourceName: "Morinus",
    title: id,
    dirty: false,
    fpath: "",
    enabledActions: {},
    ...fields,
  } as WorkspaceDocument;
}

test("chart-bearing supplementary document is its own launch parent", () => {
  const root = workspaceDoc("root", { kind: "radix" });
  const solarArc = workspaceDoc("solar-arc", {
    parentDocumentId: "root",
    kind: "supplementary",
    supplementaryFeatureKind: "solar-arc",
    displayDatetime: "2026-07-11T12:00:00",
  });

  expect(findChartLaunchParent([root, solarArc], "solar-arc")).toBe(solarArc);
});

test("view-only document still climbs to nearest chart-bearing parent", () => {
  const root = workspaceDoc("root", { kind: "radix" });
  const solarArc = workspaceDoc("solar-arc", {
    parentDocumentId: "root",
    kind: "supplementary",
    supplementaryFeatureKind: "solar-arc",
  });
  const directions = workspaceDoc("directions", {
    parentDocumentId: "solar-arc",
    kind: "directions",
  });

  expect(findChartLaunchParent([root, solarArc, directions], "directions")).toBe(solarArc);
});

test("radix-owned list launched from a derived branch resolves the radix", () => {
  const root = workspaceDoc("root", { kind: "radix" });
  const solarArc = workspaceDoc("solar-arc", {
    parentDocumentId: "root",
    kind: "supplementary",
    supplementaryFeatureKind: "solar-arc",
  });
  const directions = workspaceDoc("directions", {
    parentDocumentId: "solar-arc",
    kind: "directions",
  });

  expect(findRadixSiblingLaunchParent([root, solarArc, directions], "directions")).toBe(root);
});
