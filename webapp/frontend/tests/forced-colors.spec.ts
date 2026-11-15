// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

// Windows High Contrast (forced colors): data surfaces keep their colours,
// chrome falls back to the system palette, and tint-only state gets an outline.
const globals = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

function forcedColorsBlocks(css: string): string {
  const blocks: string[] = [];
  const opener = "@media (forced-colors: active) {";
  let start = css.indexOf(opener);
  while (start !== -1) {
    let depth = 0;
    let end = start + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && --depth === 0) break;
    }
    blocks.push(css.slice(start, end + 1));
    start = css.indexOf(opener, end);
  }
  return blocks.join("\n");
}

test("forced colors keep chart and swatch colours and mark pressed state", async ({ page }) => {
  const rules = forcedColorsBlocks(globals);
  expect(rules).toContain("data-aries-true-color");
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  await page.setContent(`<!doctype html><html><head><style>${rules}</style></head><body>
    <span id="swatch" data-aries-true-color style="display:block;width:20px;height:20px;background-color:rgb(200, 30, 40)"></span>
    <span id="chrome" style="display:block;width:20px;height:20px;background-color:rgb(200, 30, 40)"></span>
    <button id="pressed" aria-pressed="true" style="background-color:rgb(200, 30, 40)">x</button>
  </body></html>`);
  const styles = await page.evaluate(() => {
    const read = (id: string) => getComputedStyle(document.getElementById(id)!);
    return {
      swatch: read("swatch").backgroundColor,
      chrome: read("chrome").backgroundColor,
      pressedOutline: read("pressed").outlineStyle,
    };
  });
  expect(styles.swatch).toBe("rgb(200, 30, 40)");
  expect(styles.chrome).not.toBe("rgb(200, 30, 40)");
  expect(styles.pressedOutline).toBe("solid");
});
