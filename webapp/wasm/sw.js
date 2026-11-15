// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Routes daemon requests (fetches, the map iframe, notes, fonts served by the
// daemon) under ./__daemon__/ to the page that hosts the engine worker, and
// keeps the app's own files on the device so later starts download nothing.
//
// Each tab answers its own requests: a request goes to the window that made
// it, never to whichever Aries tab happens to be listed first. Frames the app
// loads from the daemon (map, notes) have no engine of their own and go to the
// tab that owns the engine lock (see boot.js).

const SCOPE = new URL(self.registration.scope).pathname; // .../webapp/
const DAEMON_PREFIX = SCOPE + "__daemon__";

// Versioned files (build_web.py puts the version or content hash in the
// path) never change, so they are served from the device cache first.
// Everything else is fetched fresh and kept only as the offline copy, so a
// deploy never pairs a new frontend with an old engine.
const ASSET_CACHE = "aries-assets-v1";
const PAGE_CACHE = "aries-pages-v1";
// The page keeps the last chart picture for the startup splash
// (lib/chart/last-chart-preview.ts).
const CACHES = [ASSET_CACHE, PAGE_CACHE, "aries-last-chart-v1"];
const VERSIONED = [
  { family: "engine", pattern: /^wasm\/aries-engine\.[0-9a-f]+\.zip$/ },
  { family: "runtime", pattern: /^wasm\/(pyodide-[^/]+)\// },
  { family: null, pattern: /^wasm\/wheels\/[^/]+\.whl$/ },
  { family: null, pattern: /^_next\/static\// },
];
// Static files that may lag one visit behind: fonts, cursors and images.
const STATIC = /^(fonts|cursors)\/|\.(woff2?|ttf|otf|png|jpe?g|svg|ico|cur)$/;
// Hashed frontend chunks from older deploys are trimmed oldest first.
const MAX_CHUNKS = 600;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith("aries-") && !CACHES.includes(name))
    .map((name) => caches.delete(name)));
  await self.clients.claim();
})()));
// Pages loaded with a hard reload bypass the worker; boot.js asks to be claimed.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "aries-claim") event.waitUntil(self.clients.claim());
});

let ownerId = null;

function isAppWindow(client) {
  return client && client.type === "window" && client.frameType === "top-level"
    && !new URL(client.url).pathname.startsWith(DAEMON_PREFIX);
}

function askOwner(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(Boolean(event.data && event.data.owner));
    };
    client.postMessage({ type: "aries-engine-ping" }, [channel.port2]);
  });
}

async function ownerClient() {
  if (ownerId) {
    const cached = await self.clients.get(ownerId);
    if (isAppWindow(cached)) return cached;
    ownerId = null;
  }
  const windows = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(isAppWindow);
  const answers = await Promise.all(windows.map((client) => askOwner(client)));
  const owner = windows.find((_, index) => answers[index]) ?? null;
  ownerId = owner ? owner.id : null;
  return owner;
}

async function requesterClient(event) {
  const requester = event.clientId ? await self.clients.get(event.clientId) : null;
  return isAppWindow(requester) ? requester : null;
}

let nextRequest = 0;
function requestId() {
  nextRequest += 1;
  const random = self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : String(Math.random()).slice(2);
  return `${random}:${nextRequest}`;
}

const CANCELLED = { status: 499, headers: [], body: null };

// An aborted fetch (the app superseded or abandoned the request) is passed on
// to the engine page, so a request still waiting in the engine queue never runs.
function send(client, request, url, body) {
  const copy = body ? body.slice(0) : null;
  // The page tags its daemon fetches (boot.js) so either side can abort them.
  const id = request.headers.get("x-aries-request-id") || requestId();
  const channel = new MessageChannel();
  const signal = request.signal;
  const reply = new Promise((resolve) => {
    channel.port1.onmessage = (event) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(event.data);
    };
    function onAbort() {
      client.postMessage({ type: "aries-daemon-abort", id });
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(CANCELLED);
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  if (signal && signal.aborted) return reply;
  client.postMessage(
    {
      type: "aries-daemon-http",
      id,
      method: request.method,
      path: url.pathname.slice(DAEMON_PREFIX.length) || "/",
      query: url.search.replace(/^\?/, ""),
      headers: [...request.headers.entries()],
      body: copy,
    },
    [channel.port2, ...(copy ? [copy] : [])],
  );
  return reply;
}

function notOwner(response) {
  return (response.headers || []).some(([name, value]) => name === "x-aries-engine" && value === "not-owner");
}

async function forward(event) {
  const request = event.request;
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const requester = await requesterClient(event);
  let client = requester ?? (await ownerClient());
  if (!client) return new Response("Aries engine page is not open", { status: 503 });
  let response = await send(client, request, url, body);
  if (!requester && notOwner(response)) {
    // The cached owner gave up the engine to another tab; find the new owner.
    ownerId = null;
    client = await ownerClient();
    if (client) response = await send(client, request, url, body);
  }
  return new Response(response.status === 204 || response.status === 304 ? null : response.body, {
    status: response.status,
    headers: response.headers,
  });
}

function versionOf(path) {
  for (const rule of VERSIONED) {
    const match = rule.pattern.exec(path);
    if (match) return { family: rule.family, version: match[1] ?? match[0] };
  }
  return null;
}

function cacheable(response) {
  // Safari refuses a stored redirected response as a navigation answer.
  return response && response.status === 200 && response.type === "basic" && !response.redirected;
}

// A new engine bundle or runtime version replaces the old one on the device.
async function dropOlder(cache, family, version) {
  const keys = await cache.keys();
  const stale = keys.filter((request) => {
    const kept = versionOf(new URL(request.url).pathname.slice(SCOPE.length));
    return kept && kept.family === family && kept.version !== version;
  });
  await Promise.all(stale.map((request) => cache.delete(request)));
}

async function trimChunks(cache) {
  const chunks = (await cache.keys()).filter((request) => new URL(request.url).pathname.includes("/_next/static/"));
  await Promise.all(chunks.slice(0, Math.max(0, chunks.length - MAX_CHUNKS)).map((request) => cache.delete(request)));
}

async function cacheFirst(event, versioned) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (cacheable(response)) {
    event.waitUntil((async () => {
      await cache.put(event.request, response.clone());
      if (versioned.family) await dropOlder(cache, versioned.family, versioned.version);
      else await trimChunks(cache);
    })());
  }
  return response;
}

async function networkFirst(event) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(event.request);
    if (cacheable(response)) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  } catch (err) {
    const hit = await cache.match(event.request, { ignoreSearch: event.request.mode === "navigate" });
    if (hit) return hit;
    // Offline start at a route not visited before: open the app's home page.
    if (event.request.mode === "navigate") {
      const home = await cache.match(SCOPE);
      if (home) return home;
    }
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(PAGE_CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then((response) => {
    if (cacheable(response)) return cache.put(event.request, response.clone()).then(() => response);
    return response;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.startsWith(DAEMON_PREFIX + "/")) {
    event.respondWith(forward(event));
    return;
  }
  // Range requests (media) and writes go straight to the network.
  if (request.method !== "GET" || request.headers.has("range")) return;
  const path = url.pathname.slice(SCOPE.length);
  const versioned = versionOf(path);
  if (versioned) event.respondWith(cacheFirst(event, versioned));
  else if (STATIC.test(path)) event.respondWith(staleWhileRevalidate(event));
  else event.respondWith(networkFirst(event));
});
