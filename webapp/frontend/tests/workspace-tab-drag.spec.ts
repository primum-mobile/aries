// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { documentPairSupportsDirectAttach } from "../src/components/workshell/workspace-tab-drag";
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
