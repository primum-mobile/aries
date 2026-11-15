// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Aries engine worker: runs the real Python daemon under Pyodide and answers
// the requests the page forwards (HTTP via the service worker, /ws/events via
// the WebSocket shim). User data lives on IDBFS under /home/pyodide.

const BASE = new URL("./", self.location.href).href; // .../webapp/wasm/
const PYODIDE = BASE + "pyodide/";
const PACKAGES = ["numpy", "pydantic", "pillow", "pyyaml", "fonttools", "fastapi", "starlette", "anyio", "sniffio", "typing-extensions", "annotated-types", "brotli", "tzdata"];
const EXTRA_WHEELS = ["geographiclib-2.1-py3-none-any.whl", "reportlab-4.5.1-py3-none-any.whl", "charset_normalizer-3.5.2-py3-none-any.whl"];

let py;
let bridge;
const sockets = new Map();
let syncing = null; // in-flight IDBFS write, if any
let syncAgain = false;

function status(stage, detail) {
  self.postMessage({ type: "status", stage, detail });
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Mirror HOME to IndexedDB right after every mutating request. Writes are
// serialized; a request that lands mid-write queues exactly one more pass, so
// the stored library never lags behind an acknowledged save.
function persist() {
  if (!py) return Promise.resolve();
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = new Promise((resolve) => {
    py.FS.syncfs(false, (err) => {
      if (err) console.warn("[aries-engine] persist failed", err);
      resolve();
    });
  }).then(() => {
    syncing = null;
    if (syncAgain) {
      syncAgain = false;
      return persist();
    }
  });
  return syncing;
}

async function boot() {
  const t0 = performance.now();
  status("runtime", "Loading Python runtime");
  const { loadPyodide } = await import(PYODIDE + "pyodide.mjs");
  py = await loadPyodide({ indexURL: PYODIDE, env: { HOME: "/home/pyodide" } });
  status("packages", "Loading libraries");
  const engineZip = fetchBytes(BASE + "aries-engine.zip");
  const extras = EXTRA_WHEELS.map((name) => fetchBytes(BASE + "wheels/" + name));
  await py.loadPackage(PACKAGES, { messageCallback: () => {} });
  const site = py.runPython("import site; site.getsitepackages()[0]");
  for (const wheel of await Promise.all(extras)) py.unpackArchive(wheel, "zip", { extractDir: site });
  status("engine", "Unpacking the Aries engine");
  py.unpackArchive(await engineZip, "zip", { extractDir: "/app" });
  py.FS.mkdirTree("/home/pyodide");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/home/pyodide");
  await new Promise((resolve) => py.FS.syncfs(true, () => resolve()));
  status("daemon", "Starting the Aries engine");
  await py.runPythonAsync(`
import os, sys
os.environ['ARIES_DAEMON_BASE_DIR'] = '/app'
# Pin the persisted chart library under the IDBFS mount (HOME has no Documents).
os.environ.setdefault('ARIES_CHARTS_DIR', '/home/pyodide/Aries/Charts')
sys.path[:0] = ['/app', '/app/webapp/frontend/scripts']
os.chdir('/app')
from webapp.daemon import wasm_bridge
`);
  bridge = py.pyimport("webapp.daemon.wasm_bridge");
  // Deferred timers (Style Lab draft recovery) write after their request.
  bridge.set_background_listener(() => { persist(); });
  try {
    const seeded = bridge.seed_default_location(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    if (seeded) {
      console.info("[aries-engine] default location set to", seeded);
      await persist();
    }
  } catch (err) {
    console.warn("[aries-engine] could not seed a default location", err);
  }
  status("ready", `Engine ready in ${Math.round(performance.now() - t0)} ms`);
}

const ready = boot().catch((err) => {
  status("error", String(err && err.message ? err.message : err));
  throw err;
});

async function handleHttp(msg) {
  await ready;
  const body = msg.body ? new Uint8Array(msg.body) : null;
  const result = await bridge.handle(msg.method, msg.path, msg.query, msg.headers, body);
  const out = result.toJs({ dict_converter: Object.fromEntries });
  result.destroy();
  const bytes = out.body instanceof Uint8Array ? out.body : new Uint8Array(out.body ?? []);
  if (msg.method !== "GET" && msg.method !== "HEAD") persist();
  return { status: out.status, headers: out.headers, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

// HTTP requests run one at a time, in arrival order. Python work runs inline
// and cannot be interrupted, but a request the page abandoned while it was
// still waiting here is answered as cancelled without running (499, like the
// desktop daemon's cancelled-request status).
const queue = [];
let running = false;

function cancelled(port) {
  const text = new TextEncoder().encode("cancelled");
  port.postMessage({ status: 499, headers: [["content-type", "text/plain"]], body: text.buffer }, [text.buffer]);
}

async function runHttp(msg, port) {
  try {
    const response = await handleHttp(msg);
    port.postMessage(response, [response.body]);
  } catch (err) {
    const text = new TextEncoder().encode(String(err && err.message ? err.message : err));
    port.postMessage({ status: 500, headers: [["content-type", "text/plain"]], body: text.buffer }, [text.buffer]);
  } finally {
    self.postMessage({ type: "http-done", id: msg.id });
  }
}

function pump() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  runHttp(next.msg, next.port).finally(() => {
    running = false;
    // A macrotask, so aborts that arrived during the request are read first.
    setTimeout(pump, 0);
  });
}

function abortQueued(id) {
  const index = queue.findIndex((item) => item.msg.id === id);
  if (index < 0) return;
  const [item] = queue.splice(index, 1);
  cancelled(item.port);
  self.postMessage({ type: "http-done", id });
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "http") {
    queue.push({ msg, port: event.ports[0] });
    pump();
  } else if (msg.type === "abort") {
    abortQueued(msg.id);
  } else if (msg.type === "flush") {
    await ready.catch(() => {});
    await persist();
    self.postMessage({ type: "flushed", id: msg.id });
  } else if (msg.type === "ws-open") {
    await ready;
    const socket = bridge.open_events((text) => self.postMessage({ type: "ws-message", id: msg.id, text }));
    sockets.set(msg.id, socket);
    self.postMessage({ type: "ws-open", id: msg.id });
  } else if (msg.type === "ws-send") {
    sockets.get(msg.id)?.push_text(msg.text);
  } else if (msg.type === "ws-close") {
    sockets.get(msg.id)?.close();
    sockets.delete(msg.id);
  }
};
