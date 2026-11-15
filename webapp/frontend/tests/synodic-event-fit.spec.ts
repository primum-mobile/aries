// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

import { observeSynodicEventFit } from "../src/lib/synodic-event-fit";

const from = path.resolve("src/app/globals.css");
const overlay = JSON.parse(readFileSync("../../scripts/i18n/mtexts_overlay.json", "utf8")) as
  Record<string, Record<string, string>>;
const fonts = ["FreeSans", "Kosugi Aries", "DotGothic16", "M PLUS 1 Code", "system-ui"];
let css: string;

test.beforeAll(async () => {
  css = (await postcss([tailwind()]).process(readFileSync(from, "utf8"), { from })).css;
});

for (const lang of ["en", "de"]) for (const font of fonts) {
  test(`synodic conjunction labels fit in ${lang} with ${font}`, async ({ page }) => {
    await page.route("http://synodic-fixture.test/fonts/*", async (route) => {
      const file = path.basename(new URL(route.request().url()).pathname);
      await route.fulfill({ body: readFileSync(path.resolve("public/fonts", file)) });
    });
    const rows = ["InferiorConjunction", "SuperiorConjunction", "SolarConjunction"].map((key) => {
      const full = overlay[key][lang];
      const short = overlay[`${key}Short`][lang];
      const cazimi = overlay.Cazimi[lang];
      const title = `${full} (${cazimi})`;
      return `<tr class="aries-list-row">
        <td class="aries-list-cell"><span style="font-family:AriesMorinus">E</span> R</td>
        <td class="aries-list-cell" aria-label="${title}" title="${title}">
          <span class="inline-flex gap-1">
            <span data-synodic-event-label="full">${full}</span>
            <span data-synodic-event-label="short" aria-hidden="true">${short}</span>
            <span class="aries-list-secondary-text">(${cazimi})</span>
          </span>
        </td>
        <td class="aries-list-cell"><span style="font-family:AriesMorinus">a</span> 29°59′</td>
        <td class="aries-list-cell aries-list-date-text">24.10.2026</td>
        <td class="aries-list-cell aries-search-time-text">03:44</td>
      </tr>`;
    }).join("");
    await page.setContent(`<!doctype html><html lang="${lang}"><head>
      <base href="http://synodic-fixture.test/"><style>${css}</style></head><body>
      <div class="aries-list-scroller overflow-auto" style="width:600px;height:100px;font-family:'${font}',system-ui">
        <table class="aries-list aries-list--symbolic aries-sidebar-list-table table-auto w-full border-collapse">
          <tbody>${rows}</tbody>
        </table>
      </div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const issues = await page.evaluate(async (source) => {
      const table = document.querySelector("table")!;
      const viewport = table.parentElement!;
      const observe = new Function(`return (${source})`)() as typeof observeSynodicEventFit;
      const disconnect = observe(table);
      const issues: string[] = [];
      const widths = Array.from({ length: 91 }, (_, index) => 600 - 2 * index);
      for (const width of [...widths, ...widths.toReversed()]) {
        viewport.style.width = `${width}px`;
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const compact = table.hasAttribute("data-compact-events");
        if (table.getBoundingClientRect().width > viewport.clientWidth + 0.5) {
          issues.push(`table overflows at ${width}px`);
        }
        if (compact) {
          delete table.dataset.compactEvents;
          if (table.getBoundingClientRect().width <= viewport.clientWidth + 0.5) {
            issues.push(`label abbreviated while full label fits at ${width}px`);
          }
          table.dataset.compactEvents = "true";
        }
      }
      disconnect?.();
      return issues;
    }, observeSynodicEventFit.toString());
    expect(issues).toEqual([]);
    await expect(page.locator("[data-synodic-event-label='full']").first()).toBeVisible();
  });
}
