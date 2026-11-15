// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

import { observeInspectorSpeculumFit } from "../src/lib/inspector-speculum-layout";

// Inspector text-size presets scale the table; the fit must hold for each at the pane minimum.
const TEXT_SCALES = [["normal", 1], ["larger", 15 / 13], ["extra-large", 17 / 13]] as const;
// FreeSans is Daylight's UI face (same metrics on macOS, Windows and Linux).
const FONTS = ["Aries UI", "FreeSans", "system-ui"] as const;
const LANGUAGES = {
  en: {
    headers: ["Body", "Longitude", "Latitude", "Declination", "Speed", "House"],
    bodies: ["Asc", "MC", "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto", "North Node", "Chiron", "Apogee", "Fortuna"],
    moonMarker: "VOC",
  },
  // German headings are single long words; they set the column floor at larger sizes.
  de: {
    headers: ["Gestirn", "Länge", "Breite", "Deklination", "Geschwindigkeit", "Haus"],
    bodies: ["AC", "MC", "Sonne", "Mond", "Merkur", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptun", "Pluto", "Aufsteigender Mondknoten", "Chiron", "Apogäum", "Glückspunkt"],
    moonMarker: "VOC",
  },
  // Japanese may break between any two characters; names must still stay whole.
  ja: {
    headers: ["天体", "黄経", "黄緯", "赤緯", "速度", "ハウス"],
    bodies: ["ASC", "MC", "太陽", "月", "水星", "金星", "火星", "木星", "土星", "天王星", "海王星", "冥王星", "ドラゴンヘッド", "カイロン", "遠地点", "フォルトゥナ"],
    moonMarker: "ボイド",
  },
} as const;
const SPEEDS = ["−196%", "−1234%", "-00°45'00\"/d", "16°36'00\"/d", "Station R"];

for (const [lang, copy] of Object.entries(LANGUAGES)) for (const font of FONTS) for (const [textSize, textScale] of TEXT_SCALES) for (const speed of SPEEDS) {
  test(`speculum fits ${lang} ${textSize} ${font} text and restores full values with speed ${speed}`, async ({ page }) => {
    const from = path.resolve("src/app/globals.css");
    const css = (await postcss([tailwind()]).process(readFileSync(from, "utf8"), { from })).css;
    await page.route("http://speculum-fixture.test/fonts/*", async (route) => {
      await route.fulfill({ body: readFileSync(path.resolve("public/fonts", path.basename(new URL(route.request().url()).pathname))) });
    });
    const sign = (index: number) => `<span style="font-family:AriesMorinus">${String.fromCharCode(97 + index % 12)}</span>`;
    const angle = (column: string, full: string, compact: string, degree: string) => `<span data-speculum-angle="${column}"><span class="aries-inspector-speculum-full-angle">${full}</span><span class="aries-inspector-speculum-compact-angle">${compact}</span><span class="aries-inspector-speculum-degree-angle">${degree}</span></span>`;
    // Shortened values drop their finer units without a mark, as the app renders them.
    const compactSpeed = speed.replace(/(['′])\d{2}["″]/, "$1");
    const daily = compactSpeed.match(/^(.+['′])(\/d)$/);
    const wrappedSpeed = daily ? `${daily[1]}<wbr>${daily[2]}` : compactSpeed;
    const cell = "pr-[var(--aries-control-gap-compact)] whitespace-nowrap text-right last:pr-0";
    const rows = copy.bodies.map((name, index) => `<tr>
      <td class="pr-[var(--aries-control-gap-compact)] align-baseline whitespace-nowrap"><span class="inline-flex items-baseline gap-[var(--aries-control-gap-compact)]"><span class="inline-flex w-[1.25em] shrink-0" style="font-family:AriesMorinus">E</span><span class="aries-inspector-speculum-body-label"${/\p{L}{8,}|[\p{sc=Han}\p{sc=Hira}\p{sc=Kana}ー]{6,}/u.test(name) ? " data-long-word" : ""}>${name}${index === 3 ? `<span id="voc-suffix" class="invisible">&nbsp;(${copy.moonMarker})</span>` : ""}</span></span></td>
      <td class="${cell}">${angle("lon", `29°40'32″ ${sign(index)}`, `29°40' ${sign(index)}`, `29° ${sign(index)}`)}</td>
      <td class="${cell}">${angle("lat", "- 3°31'22″", "- 3°31'", "- 3°")}</td>
      <td class="${cell}">${angle("decl", "-23°38'32″", "-23°38'", "-23°")}</td>
      <td class="${cell}"><span class="aries-inspector-speculum-full-speed">${speed}</span><span class="aries-inspector-speculum-compact-speed">${compactSpeed}</span><span class="aries-inspector-speculum-wrapped-speed">${wrappedSpeed}</span></td>
      <td class="whitespace-nowrap text-right">10</td></tr>`).join("");
    const headers = copy.headers.map((label, index) => `<th title="${label}" class="pr-[var(--aries-control-gap-compact)] pb-[var(--aries-inspector-row-gap)] font-normal whitespace-nowrap last:pr-0 ${index ? "text-right" : "text-left"}"><span class="aries-inspector-speculum-heading">${label}</span></th>`).join("");
    await page.setContent(`<!doctype html><html lang="${lang}" style="--speculum-test-scale:${textScale}"><head><base href="http://speculum-fixture.test/"><style>${css}</style></head><body>
      <div class="aries-inspector-speculum px-[var(--aries-inspector-padding-x)]" style="width:560px;font-family:'${font}';line-height:1.375;font-variant-numeric:tabular-nums">
        <div class="overflow-x-auto overscroll-x-contain">
        <table class="w-full table-auto border-collapse" style="font-size:${12 * textScale}px"><thead style="font-size:${11 * textScale}px"><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((source) => {
      const setup = new Function(`return (${source})`)() as typeof observeInspectorSpeculumFit;
      setup(document.querySelector<HTMLElement>(".aries-inspector-speculum")!, document.querySelector("table")!);
    }, observeInspectorSpeculumFit.toString());
    const container = page.locator(".aries-inspector-speculum");
    await expect(container).toHaveAttribute("data-lon-precision", "seconds");
    // The fit state at full width, which widening back must reproduce exactly.
    const fullWidthState = await container.evaluate((node) => ({ ...node.dataset }));
    // The desktop Inspector minimum is 360px with overlay scrollbars.
    await container.evaluate((node) => { node.style.width = "360px"; });
    await expect.poll(() => container.evaluate((node) => {
      const table = node.querySelector("table")!;
      return table.getBoundingClientRect().width <= table.parentElement!.clientWidth + 1;
    })).toBe(true);
    const beforeVoc = await page.locator("#voc-suffix").evaluate((node) => ({
      markerTop: node.getBoundingClientRect().top,
      tableWidth: node.closest("table")!.getBoundingClientRect().width,
    }));
    await page.locator("#voc-suffix").evaluate((node) => node.classList.remove("invisible"));
    const afterVoc = await page.locator("#voc-suffix").evaluate((node) => {
      const moonName = document.createRange();
      moonName.selectNodeContents(node.parentElement!.firstChild!);
      return {
        markerTop: node.getBoundingClientRect().top,
        moonTop: moonName.getBoundingClientRect().top,
        tableWidth: node.closest("table")!.getBoundingClientRect().width,
      };
    });
    expect(afterVoc.markerTop).toBe(beforeVoc.markerTop);
    expect(afterVoc.tableWidth).toBe(beforeVoc.tableWidth);
    expect(Math.abs(afterVoc.markerTop - afterVoc.moonTop)).toBeLessThanOrEqual(1);
    const geometry = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>(".aries-inspector-speculum")!;
      const viewport = document.querySelector("table")!.parentElement!;
      const style = getComputedStyle(viewport);
      const viewportRight = viewport.getBoundingClientRect().left + viewport.clientWidth;
      return {
        outerGutter: parseFloat(getComputedStyle(container).paddingRight),
        available: viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        width: document.querySelector("table")!.getBoundingClientRect().width,
        scrollExtent: viewport.scrollWidth - viewport.clientWidth,
        // Unused width left after the fit: the table's natural width with the applied steps.
        slack: (() => {
          const table = document.querySelector("table")!;
          const fitted = table.getBoundingClientRect().width;
          table.style.width = "max-content";
          const natural = table.getBoundingClientRect().width;
          table.style.width = "";
          return container.dataset.fitHeadings === "true" ? fitted - natural : 0;
        })(),
        // Every heading and House value stays inside the viewport, not behind the scroller.
        escaped: Array.from(document.querySelectorAll("th > span, tr > td:last-child")).filter((node) => node.getBoundingClientRect().right > viewportRight + 1).length,
        // Short single words ("Mercury") never break, at any fit step.
        wordHeights: Array.from(document.querySelectorAll<HTMLElement>(".aries-inspector-speculum-body-label:not([data-long-word])")).filter((node) => !node.textContent!.includes(" ")).map((node) => node.getBoundingClientRect().height),
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.available + 1);
    expect(geometry.scrollExtent).toBeLessThanOrEqual(1);
    expect(geometry.escaped).toBe(0);
    expect(geometry.outerGutter).toBe(8);
    // Words never break, and speed never wraps, while any column (speed
    // included) still shows its seconds.
    if (await container.getAttribute("data-hyphenate-names") === "true" || await container.getAttribute("data-wrap-speed") === "true") {
      for (const column of ["lon", "lat", "decl", "speed"]) await expect(container).not.toHaveAttribute(`data-${column}-precision`, "seconds");
    }
    // Windows/macOS default pane (rehearsal run 41825721129): in Daylight's
    // FreeSans the seconds steps must free real width, so dropping seconds
    // from latitude and declination is enough and no speed wraps onto two lines.
    if (lang === "en" && font === "FreeSans" && textSize === "normal") {
      await expect(container).toHaveAttribute("data-wrap-speed", "false");
      await expect(container).toHaveAttribute("data-lon-precision", "seconds");
    }
    for (const height of geometry.wordHeights) expect(height).toBeLessThanOrEqual(17 * textScale);
    // Minutes are only given up when headings, names, seconds and speed were not enough.
    if (lang === "en" && font === "Aries UI" && textSize === "normal") await expect(container).toHaveAttribute("data-lon-precision", /seconds|minutes/);
    // A step frees at most one column's precision; the table must not be left with a large unused remainder.
    expect(geometry.slack).toBeLessThanOrEqual(24 * textScale);
    // Sweep every width from the minimum up: no overflow and no step that frees
    // far more than the pane needed (a whole-table jump leaves dead columns).
    const sweep = await container.evaluate(async (node) => {
      const table = node.querySelector("table")!;
      const viewport = table.parentElement!;
      const failures: string[] = [];
      for (let width = 360; width <= 560; width += 2) {
        node.style.width = `${width}px`;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const fitted = table.getBoundingClientRect().width;
        if (fitted > viewport.clientWidth + 1) failures.push(`${width}: overflow ${Math.round(fitted - viewport.clientWidth)}`);
        const secondsLeft = [node.dataset.lonPrecision, node.dataset.latPrecision, node.dataset.raPrecision, node.dataset.declPrecision, node.dataset.speedPrecision].includes("seconds");
        if (node.dataset.hyphenateNames === "true" && secondsLeft) failures.push(`${width}: words hyphenate while seconds remain`);
        if (node.dataset.wrapSpeed === "true" && secondsLeft) failures.push(`${width}: speed wraps while seconds remain`);
        if (node.dataset.fitHeadings !== "true") continue;
        table.style.width = "max-content";
        const slack = fitted - table.getBoundingClientRect().width;
        table.style.width = "";
        if (slack > 24 * parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--speculum-test-scale"))) failures.push(`${width}: slack ${Math.round(slack)}`);
      }
      return failures;
    });
    expect(sweep).toEqual([]);
    // Widening undoes every step: back at 560px the fit returns to the state it
    // had there before narrowing. At that width no data is ever shortened.
    await container.evaluate((node) => { node.style.width = "560px"; });
    await expect.poll(() => container.evaluate((node) => ({ ...node.dataset }))).toEqual(fullWidthState);
    for (const step of ["hyphenate-names", "wrap-speed"]) await expect(container).toHaveAttribute(`data-${step}`, "false");
    for (const column of ["lon", "lat", "decl", "speed"]) await expect(container).toHaveAttribute(`data-${column}-precision`, "seconds");
    // Headings may keep giving way at 560px only when they would otherwise
    // overflow it (macOS system-ui ja at extra-large: "ハウス" outgrows "10").
    // Steps are overflow-only; a heading step left on without overflow is a failure.
    if (fullWidthState.fitHeadings === "true") {
      expect(await container.evaluate((node) => {
        const table = node.querySelector("table")!;
        const viewport = table.parentElement!;
        const style = getComputedStyle(viewport);
        const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        node.dataset.fitHeadings = "false";
        const required = table.getBoundingClientRect().width;
        node.dataset.fitHeadings = "true";
        return required - available;
      })).toBeGreaterThan(0.5);
    }
  });
}
