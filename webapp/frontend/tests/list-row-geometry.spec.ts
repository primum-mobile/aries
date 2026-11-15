// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

let css: string;
test.beforeAll(async () => {
  const from = path.resolve("src/app/globals.css");
  css = (await postcss([tailwind()]).process(readFileSync(from, "utf8"), { from })).css;
});

for (const font of ["system-ui, sans-serif", "'Aries UI', sans-serif"]) {
  for (const rowHeight of [37, 52]) {
    test(`symbolic rows and virtual spacers share their height (${font}, ${rowHeight}px)`, async ({ page }) => {
      await page.route("http://list-fixture.test/fonts/*", async (route) => {
        const file = path.basename(new URL(route.request().url()).pathname);
        await route.fulfill({ body: readFileSync(path.resolve("public/fonts", file)) });
      });
      // Transit cells contain both inline-flex groups/buttons and bare glyphs.
      // Exercise their actual CSS together with the virtual spacer geometry.
      const cell = 'class="aries-list-cell align-middle"';
      const row = `<tr class="aries-list-row border-b" data-event-row style="height:${rowHeight}px">
        <td ${cell}><span class="inline-flex items-center justify-center gap-1"><span class="aries-search-glyph font-symbols">E</span><span class="aries-search-marker">R</span></span></td>
        <td ${cell}><span class="aries-search-glyph font-symbols">S</span></td>
        <td ${cell}><span class="inline-flex items-center">IX</span></td>
        <td ${cell}><button class="inline-flex tabular-nums">2026-05-26</button></td>
        <td ${cell}>13:37</td><td ${cell}>D</td></tr>`;
      const spacer = (height: number) => `<tr class="aries-list-row border-0" aria-hidden="true"><td class="aries-list-cell border-0 p-0" colspan="6" style="height:${height}px"></td></tr>`;
      const markup = `<div id="scroller" style="height:233px;overflow:auto"><table class="aries-list aries-list--symbolic border-collapse"><tbody>
        ${spacer(25 * rowHeight)}${row.repeat(40)}${spacer(100 * rowHeight)}
        </tbody></table></div>`;
      // Standards mode matters: quirks-mode tables mask inherited line height.
      await page.setContent(`<!doctype html><html><head><base href="http://list-fixture.test/"><style>${css}</style></head><body>${markup}</body></html>`);
      await page.evaluate(({ font, rowHeight }) => {
        document.documentElement.style.setProperty("--aries-font-ui", font);
        document.documentElement.style.setProperty("--aries-list-row-height-symbolic", `${rowHeight}px`);
      }, { font, rowHeight });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(({ rowHeight }) => {
        const scroller = document.getElementById("scroller")!;
        scroller.scrollTop = 25 * rowHeight;
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-event-row]"));
        return {
          mode: document.compatMode,
          heights: rows.map((row) => row.getBoundingClientRect().height),
          firstOffset: rows[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top,
          insets: rows.map((row) => {
            const box = row.getBoundingClientRect();
            const content = row.cells[0].firstElementChild!.getBoundingClientRect();
            return { top: content.top - box.top, bottom: box.bottom - content.bottom };
          }),
        };
      }, { rowHeight });
      expect(geometry.mode).toBe("CSS1Compat");
      for (const height of geometry.heights) expect(height).toBe(rowHeight);
      expect(Math.abs(geometry.firstOffset)).toBeLessThanOrEqual(1);
      for (const inset of geometry.insets) {
        expect(Math.abs(inset.top - geometry.insets[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(inset.bottom - geometry.insets[0].bottom)).toBeLessThanOrEqual(1);
      }
    });
  }
}
