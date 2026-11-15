// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { chartEventDropAction, documentPairSupportsDirectAttach, dragPointInside, savedChartEventDropEligible } from "../src/components/workshell/workspace-tab-drag";
import type { WorkspaceDocument } from "../src/stores/workspace-store";

function document(
  id: string,
  parentDocumentId: string | null,
  kind: WorkspaceDocument["kind"] = "radix",
): WorkspaceDocument {
  return {
    id,
    parentDocumentId,
    kind,
    sourceName: id,
    title: id,
    enabledActions: {},
  } as WorkspaceDocument;
}

test("two childless root charts can attach directly", () => {
  expect(documentPairSupportsDirectAttach(
    document("source", null),
    document("target", null),
  )).toBe(true);
});

test("same-parent children retain sibling reordering", () => {
  expect(documentPairSupportsDirectAttach(
    document("source", "parent"),
    document("target", "parent"),
  )).toBe(false);
});

test("root non-chart surfaces do not replace ordinary root ordering", () => {
  expect(documentPairSupportsDirectAttach(
    document("source", null),
    document("table", null, "table"),
  )).toBe(false);
});

test("chart event drops accept saved, dirty, scratch, and indented chart sources", () => {
  const source = { ...document("source", null), fpath: "/Charts/People.jsonl" };
  const target = document("target", null);
  expect(savedChartEventDropEligible(source, target)).toBe(true);
  expect(savedChartEventDropEligible(source, source)).toBe(false);
  expect(savedChartEventDropEligible({ ...source, dirty: true }, target)).toBe(true);
  expect(savedChartEventDropEligible({ ...source, fpath: "" }, target)).toBe(true);
  expect(savedChartEventDropEligible(source, document("child", "target"))).toBe(false);
  expect(savedChartEventDropEligible(document("child", "source"), target)).toBe(true);
  expect(savedChartEventDropEligible(document("child", "source", "supplementary"), target)).toBe(true);
  expect(savedChartEventDropEligible(source, document("table", null, "table"))).toBe(false);
  expect(savedChartEventDropEligible(document("table", "source", "table"), target)).toBe(false);
});

test("cross-sash drag acts only after the pointer enters the Events pane", () => {
  const origin = { x: 120, y: 200 };
  const sidebar = { left: 0, right: 240, top: 0, bottom: 800 };
  const events = { left: 700, right: 1100, top: 0, bottom: 800 };
  expect(dragPointInside(origin, { x: 150, y: 0 }, sidebar)).toBe(false);
  expect(dragPointInside(origin, { x: 150, y: 0 }, events)).toBe(false);
  expect(dragPointInside(origin, { x: 600, y: 0 }, events)).toBe(true);
  expect(dragPointInside(origin, { x: 600, y: 700 }, events)).toBe(false);
});

test("own unsaved and stepped children drop through Add event, including nested ancestry", () => {
  const root = document("root", null);
  const child = { ...document("child", root.id, "supplementary"), dirty: true, fpath: "" };
  const nested = document("nested", child.id, "supplementary");
  const documents = [root, child, nested];
  expect(chartEventDropAction(child, root, documents)).toBe("workspace.save_event");
  expect(chartEventDropAction(nested, root, documents)).toBe("workspace.save_event");
  const ascensional = document("ascensional", root.id, "ascensional-transits");
  expect(chartEventDropAction(ascensional, root, [...documents, ascensional])).toBe("workspace.save_event");
  expect(chartEventDropAction(child, document("other", null), [...documents, document("other", null)])).toBe("workspace.copy_saved_chart_event");
  expect(chartEventDropAction(nested, child, documents)).toBeNull();
  expect(chartEventDropAction(root, root, documents)).toBeNull();
  expect(chartEventDropAction(document("table", root.id, "table"), root, documents)).toBeNull();
  expect(chartEventDropAction(nested, root, [root, nested])).toBeNull();
  expect(chartEventDropAction(child, root, [root, { ...child, parentDocumentId: child.id }])).toBeNull();
});

test("collection-backed parents retain the independent copy action", () => {
  const source = { ...document("source", null), fpath: "/Charts/People.jsonl" };
  const target = document("target", null);
  expect(chartEventDropAction(source, target, [source, target])).toBe("workspace.copy_saved_chart_event");
  expect(chartEventDropAction({ ...source, dirty: true }, target, [source, target])).toBe("workspace.copy_saved_chart_event");
  expect(chartEventDropAction({ ...source, fpath: "" }, target, [source, target])).toBe("workspace.copy_saved_chart_event");
});
