// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Dev-only save helper for the in-app copy editor (src/lib/i18n/copy-editor).
// It rewrites one English value in src/locales/en.json and queues every locale
// that translated the previous wording in scripts/i18n/copy_backlog.json, so
// translations catch up in one batch before release instead of on every edit.
//
// Started automatically by src/instrumentation.ts under `next dev` (so every
// `make run` smoke has it); standalone: node scripts/copy-editor/server.mjs
// Binds 127.0.0.1 only and accepts requests only from local dev origins.

import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Must match COPY_EDITOR_PORT in src/lib/i18n/copy-editor/copy-editor.tsx.
export const COPY_EDITOR_PORT = 8790;

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;
const LOCAL_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|http:\/\/tauri\.localhost)$/;
const MAX_BODY = 64 * 1024;

export function copyEditorPaths(frontendDir = FRONTEND_DIR) {
  return {
    locales: join(frontendDir, "src", "locales"),
    backlog: join(frontendDir, "..", "..", "scripts", "i18n", "copy_backlog.json"),
  };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

// Write via rename so the Next watcher never reads a half-written catalog.
function writeJson(path, data) {
  const tmp = `${path}.copy-editor.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function placeholders(value) {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[0]).sort().join(" ");
}

function sortedObject(object) {
  // Code-point order, matching Python's json.dump(sort_keys=True) in i18n_tool.py.
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Locales (other than English and the pseudo-locale) holding a translation of key. */
function translatedLocales(localesDir, key) {
  return readdirSync(localesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => basename(name, ".json"))
    .filter((code) => code !== "en" && code !== "en-XA")
    .filter((code) => typeof readJson(join(localesDir, `${code}.json`), {})[key] === "string")
    .sort();
}

/**
 * Apply one English copy edit. Returns { status, body } — status 200 on success,
 * 409 when en.json changed underneath the editor, 422 for an invalid edit.
 */
export function saveCopyEdit({ key, from, to }, paths = copyEditorPaths()) {
  if (typeof key !== "string" || typeof from !== "string" || typeof to !== "string") {
    return { status: 422, body: { error: "key, from and to must be strings" } };
  }
  const enPath = join(paths.locales, "en.json");
  const en = readJson(enPath, {});
  const current = en[key];
  if (typeof current !== "string") return { status: 422, body: { error: `unknown key ${key}` } };
  if (current !== from) return { status: 409, body: { error: "en.json changed meanwhile", current } };
  if (!to.trim()) return { status: 422, body: { error: "English text cannot be empty" } };
  // Placeholders are a code contract (t(key, params)); changing them needs a code edit.
  if (placeholders(to) !== placeholders(from)) {
    return { status: 422, body: { error: `keep the placeholders ${placeholders(from) || "(none)"}` } };
  }
  if (to === from) return { status: 200, body: { value: to, queued: [] } };

  en[key] = to; // in-place assignment keeps the catalog's key order
  writeJson(enPath, en);

  // The backlog remembers the English the translations were made from, so a
  // series of rewordings stays one entry and reverting to it clears the entry.
  const backlog = readJson(paths.backlog, {});
  const entry = backlog[key];
  const was = entry?.was ?? from;
  const locales = entry?.locales ?? translatedLocales(paths.locales, key);
  if (to === was || locales.length === 0) delete backlog[key];
  else backlog[key] = { was, locales };
  writeJson(paths.backlog, sortedObject(backlog));
  return { status: 200, body: { value: to, queued: backlog[key]?.locales ?? [] } };
}

function send(res, origin, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

export function createCopyEditorServer(paths = copyEditorPaths()) {
  return createServer((req, res) => {
    const origin = req.headers.origin;
    // Only the app's own dev windows may write the catalog; a web page open in
    // another browser must not be able to post edits to this port.
    if (origin && !LOCAL_ORIGIN.test(origin)) return send(res, null, 403, { error: "origin" });
    if (req.method === "OPTIONS") return send(res, origin, 204, {});
    if (req.method === "GET" && req.url === "/copy/health") return send(res, origin, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/copy/save") return send(res, origin, 404, { error: "not found" });
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      try {
        const { status, body } = saveCopyEdit(JSON.parse(raw), paths);
        send(res, origin, status, body);
      } catch (error) {
        send(res, origin, 500, { error: String(error?.message ?? error) });
      }
    });
  });
}

/**
 * Start once per process; a second dev server or a restart just reuses the port.
 * Pass frontendDir when bundled (import.meta.url then names the bundle, not this file).
 */
export function startCopyEditorServer({ port = COPY_EDITOR_PORT, frontendDir = FRONTEND_DIR } = {}) {
  const server = createCopyEditorServer(copyEditorPaths(frontendDir));
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") return; // another dev server already serves it
    console.warn("[copy-editor]", error);
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startCopyEditorServer().ref();
  console.log(`[copy-editor] saving to ${copyEditorPaths().locales}/en.json on 127.0.0.1:${COPY_EDITOR_PORT}`);
}
