// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Chart, ChartRenderSnapshot } from "@/lib/chart/types";

const hasOwn = Object.prototype.hasOwnProperty;

function sameJsonTree(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameJsonTree(left[index], right[index])) return false;
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  for (const key in leftRecord) {
    if (!hasOwn.call(leftRecord, key) || leftRecord[key] === undefined) continue;
    if (
      !hasOwn.call(rightRecord, key) ||
      rightRecord[key] === undefined ||
      !sameJsonTree(leftRecord[key], rightRecord[key])
    ) {
      return false;
    }
  }
  for (const key in rightRecord) {
    if (!hasOwn.call(rightRecord, key) || rightRecord[key] === undefined) continue;
    if (!hasOwn.call(leftRecord, key) || leftRecord[key] === undefined) return false;
  }
  return true;
}

function sameCanvasChart(
  left: Chart | null | undefined,
  right: Chart | null | undefined,
  omitBodyAspects: boolean,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  const omitted = (key: string) =>
    key === "meta" || key === "overlay" || (omitBodyAspects && key === "bodyAspects");
  for (const key in leftRecord) {
    if (
      !hasOwn.call(leftRecord, key) ||
      omitted(key) ||
      leftRecord[key] === undefined
    ) {
      continue;
    }
    if (
      !hasOwn.call(rightRecord, key) ||
      rightRecord[key] === undefined ||
      !sameJsonTree(leftRecord[key], rightRecord[key])
    ) {
      return false;
    }
  }
  for (const key in rightRecord) {
    if (
      !hasOwn.call(rightRecord, key) ||
      omitted(key) ||
      rightRecord[key] === undefined
    ) {
      continue;
    }
    if (!hasOwn.call(leftRecord, key) || leftRecord[key] === undefined) return false;
  }
  return true;
}

/**
 * True only when two daemon snapshots feed identical state to every Canvas and
 * hit-test layer. It runs once after the settle GET, performs no serialization
 * or response-sized allocation, and deliberately ignores full-overlay fields
 * that step_fast omits but Canvas never reads.
 */
export function sameCanvasRenderState(
  left: ChartRenderSnapshot | null,
  right: ChartRenderSnapshot,
): boolean {
  if (!left) return false;
  const outerMode = right.outerRingMode;
  return (
    left.displayDatetime === right.displayDatetime &&
    left.renderVariant === right.renderVariant &&
    left.outerRingMode === outerMode &&
    left.comparisonLayout === right.comparisonLayout &&
    left.comparisonWholeSign === right.comparisonWholeSign &&
    sameCanvasChart(left.primaryChart, right.primaryChart, false) &&
    sameCanvasChart(left.comparisonChart, right.comparisonChart, true) &&
    sameJsonTree(left.outerRingItems?.[outerMode], right.outerRingItems?.[outerMode]) &&
    sameJsonTree(left.interChartAspects, right.interChartAspects) &&
    sameJsonTree(left.interChartBodyAspects, right.interChartBodyAspects)
  );
}
