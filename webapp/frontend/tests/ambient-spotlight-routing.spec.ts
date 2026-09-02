// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { targetAllowsAmbientDigit } from "../src/components/workshell/ambient-spotlight";

function target(
  tagName: string,
  options: { contentEditable?: boolean; insideDialog?: boolean } = {},
): EventTarget {
  return {
    tagName,
    isContentEditable: options.contentEditable ?? false,
    closest: () => (options.insideDialog ? {} : null),
  } as unknown as EventTarget;
}

test("Spotlight accepts ambient digits after modal focus returns to an app button", () => {
  expect(targetAllowsAmbientDigit(target("BUTTON"))).toBe(true);
});

test("Spotlight leaves real editing targets and open dialog contents alone", () => {
  expect(targetAllowsAmbientDigit(target("INPUT"))).toBe(false);
  expect(targetAllowsAmbientDigit(target("TEXTAREA"))).toBe(false);
  expect(targetAllowsAmbientDigit(target("DIV", { contentEditable: true }))).toBe(false);
  expect(targetAllowsAmbientDigit(target("BUTTON", { insideDialog: true }))).toBe(false);
});
