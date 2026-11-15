// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Headless browser smoke test of the built web app (build/wasm/site, made by
// `make web`). Serves the site under /webapp with the production headers
// (scripts/wasm/serve_site.py), checks that every page also loads without
// .html, opens it in headless Chromium and checks that the page loads, the in-browser engine boots, Here and Now renders a wheel,
// one time step repaints it, the Aspect List fits its pane with classic
// scrollbars, and nothing logs an error or fails to load. Off Apple platforms
// it also checks the Windows/Linux browser keys: Ctrl hints without the
// browser-reserved Ctrl+N, and Alt+Left kept from the browser's Back. It
// checks that the first visit arrives Brotli-encoded under a size limit, that
// a reload starts from the service worker's copies, and that the app still
// boots and steps a chart where service workers are missing or refused (as in
// some private windows).
//
//   node scripts/wasm/browser_smoke.mjs          (or: make web-browser-smoke)
//
// Uses the frontend's Playwright. ARIES_SMOKE_CHROMIUM names a Chromium
// binary when Playwright's own download is missing; ARIES_SMOKE_ARTIFACTS a
// folder for a failure screenshot.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const site = path.join(repo, "build", "wasm", "site");
const require = createRequire(path.join(repo, "webapp", "frontend", "package.json"));
const { chromium } = require("playwright");

const BOOT_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 60_000;
// First visit, Brotli-encoded (build_web.py precompresses; 55 MB unencoded).
const FIRST_VISIT_MAX_MB = 45;
// Daemon answers that are part of a contract, on every host: the theme
// provider asks for a Style Lab working draft at startup and treats 404 as
// "no draft to recover" (theme-provider.tsx); the Aspect List's exact-time
// batch answers 409 when the chart moved on (a step) while it was pending,
// and the list asks again for the new chart (aspect-list-panel.tsx).
const EXPECTED_RESPONSES = [
  { status: 404, url: /\/__daemon__\/api\/style-lab\/working-draft\?/ },
  { status: 409, url: /\/__daemon__\/api\/aspect-list\/perfections\?/ },
];
const expectedResponse = (status, url) =>
  EXPECTED_RESPONSES.some((rule) => (status == null || rule.status === status) && rule.url.test(url));

if (!fs.existsSync(path.join(site, "wasm", "engine-worker.js"))) {
  console.error(`No built web app at ${site}; run make web first.`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/webapp/sw.js`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("site server did not start");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return Boolean(ok);
}

// Every exported page answers at /webapp/<page> and /webapp/<page>/ with its
// <page>.html, although the Next export also writes a <page>/ folder of
// prefetch data (the .htaccess page rule, mirrored by serve_site.py).
async function pageRouteCheck(port) {
  const pages = fs.readdirSync(site).filter((name) =>
    name.endsWith(".html") && !name.startsWith("_") && !["index.html", "404.html"].includes(name));
  const failures = [];
  for (const name of pages) {
    const want = fs.readFileSync(path.join(site, name), "utf8");
    const route = name.slice(0, -".html".length);
    for (const url of [route, `${route}/`]) {
      const response = await fetch(`http://127.0.0.1:${port}/webapp/${url}`, { redirect: "manual" });
      const body = response.status === 200 ? await response.text() : "";
      if (body !== want) failures.push(`/webapp/${url} ${response.status}`);
    }
  }
  return check("pages load without .html", pages.length > 0 && failures.length === 0,
    failures.join(", ") || `${pages.length} pages, with and without a trailing slash`);
}

// Collects console errors, page errors, failed loads and error responses
// that no contract expects.
function watchProblems(context, page, problems) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The browser logs every 4xx response; expected ones are filtered above.
    const url = message.location()?.url ?? "";
    const status = /status of (\d+)/.exec(message.text());
    if (/Failed to load resource/.test(message.text()) && expectedResponse(status ? Number(status[1]) : null, url)) return;
    problems.push(`console: ${message.text()} ${url}`.trim());
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  context.on("response", (response) => {
    if (response.status() < 400 || expectedResponse(response.status(), response.url())) return;
    problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  context.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    // The first visit stops loading and reloads once the service worker
    // takes over (boot.js); requests cut off by that reload are expected.
    if (!/ERR_ABORTED/.test(reason)) problems.push(`request failed: ${request.url()} ${reason}`);
  });
}

// A fresh browser profile in which `disable` (run before any page script)
// takes service workers away: the engine must still boot, Here and Now must
// paint and step, and the page must say what is unavailable.
async function pageEngineSmoke(label, disable) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
  await context.addInitScript(disable);
  page = await context.newPage();
  const seen = [];
  watchProblems(context, page, seen);
  const started = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${port}/webapp/`);
    await page.waitForFunction(() => ["ready", "error"].includes(window.__ARIES_ENGINE_STAGE__), null,
      { timeout: BOOT_TIMEOUT_MS });
    const stage = await page.evaluate(() => window.__ARIES_ENGINE_STAGE__);
    const routed = await page.evaluate(() => Boolean(window.__ARIES_PAGE_ENGINE__)
      && !(navigator.serviceWorker && navigator.serviceWorker.controller));
    check(`${label}: engine boots in the page`, stage === "ready" && routed, `${stage}, ${Date.now() - started} ms`);
    await page.getByText("Here and Now", { exact: true }).first().click();
    await page.waitForFunction(wheelState, { minColours: 16 }, { timeout: STEP_TIMEOUT_MS });
    await page.mouse.click(700, 450);
    await page.waitForTimeout(1000);
    const settled = await page.evaluate(wheelState, null);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(wheelState, { minColours: 16, notHash: settled.hash }, { timeout: STEP_TIMEOUT_MS });
    check(`${label}: chart renders and steps`, true);
    const note = (await page.locator("[data-aries-page-engine]").textContent({ timeout: 5000 }).catch(() => "")) ?? "";
    check(`${label}: says what this window lacks`, /service workers/.test(note), note.slice(0, 60));
  } catch (error) {
    check(`${label}: chart renders and steps`, false, error && error.message ? error.message.split("\n")[0] : String(error));
  }
  await page.waitForTimeout(1000);
  check(`${label}: no console errors or failed loads`, seen.length === 0, seen.slice(0, 8).join(" | "));
  await context.close();
}

// The wheel is painted in stacked layers (background, geometry, moving
// bodies, overlay): composite every visible canvas of the largest size and
// hash the pixels to see repaints. With `want`, returns the state only once
// it shows a painted wheel (and, given `want.notHash`, one that differs from
// that earlier paint).
function wheelState(want) {
  const visible = [...document.querySelectorAll("canvas")]
    .filter((canvas) => canvas.width > 0 && canvas.height > 0 && canvas.getClientRects().length > 0);
  const area = Math.max(0, ...visible.map((canvas) => canvas.width * canvas.height));
  const layers = visible.filter((canvas) => canvas.width * canvas.height === area);
  if (layers.length === 0) return null;
  const probe = document.createElement("canvas");
  probe.width = 256;
  probe.height = 256;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  for (const layer of layers) ctx.drawImage(layer, 0, 0, probe.width, probe.height);
  const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data;
  const colours = new Set();
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    if (colours.size < 4096) colours.add(value);
    hash = Math.imul(hash ^ value ^ pixels[i + 3], 16777619) >>> 0;
  }
  const state = { width: layers[0].width, height: layers[0].height, layers: layers.length, colours: colours.size, hash };
  if (!want) return state;
  if (state.colours <= want.minColours) return null;
  return want.notHash != null && state.hash === want.notHash ? null : state;
}

const port = await freePort();
const python = process.env.PYTHON || "python3";
const server = spawn(python, [path.join(repo, "scripts", "wasm", "serve_site.py"), String(port)], {
  stdio: "ignore",
});
const stopServer = () => {
  if (server.exitCode === null) server.kill();
};
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

let browser;
let page;
const problems = [];
try {
  await waitForServer(port);
  await pageRouteCheck(port);
  browser = await chromium.launch({
    ...(process.env.ARIES_SMOKE_CHROMIUM ? { executablePath: process.env.ARIES_SMOKE_CHROMIUM } : {}),
    // Headless Chromium hides scrollbars by default; keep the classic ones
    // that Windows Chrome and Edge draw, so the table-fit check sees them.
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
  page = await context.newPage();
  watchProblems(context, page, problems);

  // Bytes fetched from the network (not the service worker cache) on a first
  // visit, as sent (encoded); and how the Python runtime came over the wire.
  let downloaded = 0;
  let runtimeEncoding = null;
  context.on("requestfinished", (request) => {
    request.sizes().then((sizes) => { downloaded += sizes.responseBodySize; }).catch(() => {});
  });
  context.on("response", (response) => {
    if (/\/pyodide\.asm\.wasm$/.test(response.url()) && response.status() === 200) {
      response.headerValue("content-encoding").then((value) => { runtimeEncoding = value ?? ""; }).catch(() => {});
    }
  });

  const started = Date.now();
  await page.goto(`http://127.0.0.1:${port}/webapp/`);
  check("page loads", true, `${Date.now() - started} ms`);

  await page.waitForFunction(
    () => ["ready", "error"].includes(window.__ARIES_ENGINE_STAGE__),
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  const stage = await page.evaluate(() => window.__ARIES_ENGINE_STAGE__);
  check("engine boots", stage === "ready", `${stage}, ${Date.now() - started} ms`);
  check("first visit downloads compressed files", runtimeEncoding === "br" && downloaded < FIRST_VISIT_MAX_MB * 1e6,
    `${(downloaded / 1e6).toFixed(1)} MB before the engine was ready, limit ${FIRST_VISIT_MAX_MB} MB; `
    + `Python runtime ${runtimeEncoding ? `${runtimeEncoding}-encoded` : "unencoded"}`);
  check("service worker controls the page", await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));

  // Here and Now from the sidebar (the same command as Ctrl+R / Cmd+R).
  await page.getByText("Here and Now", { exact: true }).first().click();
  await page.waitForFunction(wheelState, { minColours: 16 }, { timeout: STEP_TIMEOUT_MS });
  const before = await page.evaluate(wheelState, null);
  check("chart renders", before && before.colours > 16, before ? `${before.width}x${before.height}, ${before.colours} colours` : "no canvas");

  // Focus the chart, let the full paint and any hover settle, then step one
  // day forward: the wheel must repaint and the chart title's date advance.
  await page.mouse.click(700, 450);
  await page.waitForTimeout(2000);
  const settled = await page.evaluate(wheelState, null);
  const title = page.getByText(/^Here and Now • /).first();
  const titleBefore = (await title.textContent().catch(() => "")) ?? "";
  await page.keyboard.press("ArrowRight");
  const stepStarted = Date.now();
  let stepped = false;
  try {
    await page.waitForFunction(wheelState, { minColours: 16, notHash: settled.hash }, { timeout: STEP_TIMEOUT_MS });
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (((await title.textContent().catch(() => "")) ?? "") === titleBefore && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    stepped = titleBefore !== "" && ((await title.textContent().catch(() => "")) ?? "") !== titleBefore;
  } catch {
    stepped = false;
  }
  const titleAfter = (await title.textContent().catch(() => "")) ?? "";
  check("time step repaints the wheel", stepped, `${Date.now() - stepStarted} ms; ${titleBefore} -> ${titleAfter}`);

  // Classic (layout-taking) scrollbars, as Windows Chrome and Edge draw them:
  // a retained list must still fit its pane without horizontal overflow.
  const scrollbar = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:-999px;width:100px;height:100px;overflow:scroll";
    document.body.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    return width;
  });
  console.log(`info  native scrollbar width ${scrollbar} px`);
  await page.getByText("Aspect List", { exact: true }).first().click();
  let overflow = null;
  try {
    await page.locator(".aries-list-scroller table tbody tr").first().waitFor({ timeout: STEP_TIMEOUT_MS });
    await page.waitForTimeout(500);
    overflow = await page.evaluate(() => [...document.querySelectorAll(".aries-list-scroller")]
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => node.scrollWidth - node.clientWidth));
  } catch {
    overflow = null;
  }
  check("Aspect List fits its pane", overflow && overflow.length > 0 && overflow.every((excess) => excess <= 1),
    overflow ? `horizontal excess ${overflow.join(", ")} px` : "list did not open");

  // Windows and Linux browsers: shortcut hints use Ctrl names and leave out
  // chords the browser keeps (Ctrl+N opens a browser window), and Alt+Left
  // (minute step) never falls through to the browser's Back, even from a field.
  const apple = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test(navigator.platform));
  if (!apple) {
    const text = await page.evaluate(() => document.body.innerText);
    check("Ctrl hints shown, browser-reserved Ctrl+N left out", /\bCtrl\+O\b/.test(text) && !/\bCtrl\+N\b/.test(text));
    const url = page.url();
    await page.locator("input:visible").first().focus({ timeout: 2000 }).catch(() => {});
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForTimeout(1000);
    // Headless Chromium has no browser accelerators, so also confirm the page
    // claims the chord (a cancelled keydown is what keeps Back from running).
    const claimed = await page.evaluate(() => {
      const field = document.createElement("input");
      document.body.appendChild(field);
      field.focus();
      const event = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, bubbles: true, cancelable: true });
      const notCancelled = field.dispatchEvent(event);
      field.remove();
      return !notCancelled;
    });
    check("Alt+Left does not navigate away", page.url() === url && claimed, `${page.url()}, claimed=${claimed}`);
  }

  await page.waitForTimeout(1500);
  check("no console errors or failed loads", problems.length === 0, problems.slice(0, 8).join(" | "));

  // A second visit starts from the service worker's copies (stored decoded,
  // whatever encoding they arrived in) and downloads only the pages. Requests
  // the old page still had open are cut off by the reload; only what the new
  // page logs counts.
  downloaded = 0;
  const reloaded = Date.now();
  await page.reload();
  problems.length = 0;
  await page.waitForFunction(() => ["ready", "error"].includes(window.__ARIES_ENGINE_STAGE__), null,
    { timeout: BOOT_TIMEOUT_MS });
  const again = await page.evaluate(() => window.__ARIES_ENGINE_STAGE__);
  check("second visit starts from the device cache", again === "ready" && downloaded < 3e6,
    `${again}, ${Date.now() - reloaded} ms, ${(downloaded / 1e6).toFixed(1)} MB downloaded`);
  await page.waitForTimeout(1500);
  check("second visit: no console errors or failed loads", problems.length === 0, problems.slice(0, 8).join(" | "));
  await context.close();

  // Browsers that refuse service workers (Firefox private windows have):
  // the page routes daemon requests to the engine itself (boot.js).
  await pageEngineSmoke("no service worker API", () => {
    delete Navigator.prototype.serviceWorker;
  });
  await pageEngineSmoke("service worker refused", () => {
    ServiceWorkerContainer.prototype.register = () =>
      Promise.reject(new DOMException("The operation is insecure.", "SecurityError"));
  });
} catch (error) {
  check("smoke run", false, error && error.message ? error.message.split("\n")[0] : String(error));
  if (problems.length) console.log(problems.slice(0, 8).join("\n"));
} finally {
  const artifacts = process.env.ARIES_SMOKE_ARTIFACTS;
  if (artifacts && page && results.some((result) => !result.ok)) {
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "web-smoke-failure.png") }).catch(() => {});
  }
  await browser?.close().catch(() => {});
  stopServer();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`browser smoke: ${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
