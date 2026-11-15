// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs before the Aries app: points the daemon client at the in-browser
// engine, installs the service worker that carries daemon requests, starts the
// engine worker, and replaces WebSocket for the daemon event socket.
//
// Only one tab may own the engine: every engine keeps the chart library in
// memory and mirrors it to IndexedDB, so two engines would overwrite each
// other's saves. The owner holds the "aries-engine" Web Lock; any other tab
// shows a localized "open in another tab" state and can take over.
//
// Where the browser refuses service workers (Firefox private windows have
// done so), the page routes its own daemon fetches to the engine worker
// instead. Frames the daemon serves (the map, the notes editor) and starting
// offline need the service worker; a localized note says so.
(function () {
  var script = document.currentScript;
  var root = new URL("../", script.src); // .../webapp/
  var daemonBase = new URL("__daemon__", root).href;
  window.__ARIES_DAEMON_URL__ = daemonBase;
  window.__ARIES_WASM_ENGINE__ = true;

  var PAGE_ENGINE_KEY = "aries-wasm-page-engine";
  var pageEngine = !("serviceWorker" in navigator);
  try { pageEngine = pageEngine || sessionStorage.getItem(PAGE_ENGINE_KEY) === "1"; } catch (e) { /* storage unavailable */ }
  if (!pageEngine && !navigator.serviceWorker.controller) {
    // First visit: the app's requests only reach the engine once the service
    // worker controls this page, so reload as soon as it takes over.
    // A hard reload (Shift-reload) also arrives uncontrolled even though the
    // worker is already active; ask it to claim this page, and reload once as
    // a fallback if no takeover arrives.
    navigator.serviceWorker.addEventListener("controllerchange", function () { location.reload(); });
    try { sessionStorage.removeItem("aries-wasm-claim-retry"); } catch (e) { /* storage unavailable */ }
    navigator.serviceWorker.register(new URL("sw.js", root).href, { scope: root.pathname }).catch(function (err) {
      // A refusal (SecurityError in a private window, not a network error,
      // which the retry below covers): reload once into the page engine.
      if (err && err.name === "TypeError") return;
      try { sessionStorage.setItem(PAGE_ENGINE_KEY, "1"); } catch (e) { return; }
      location.reload();
    });
    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.active) registration.active.postMessage({ type: "aries-claim" });
    });
    var retryKey = "aries-wasm-claim-retry";
    setTimeout(function () {
      if (navigator.serviceWorker.controller) return;
      var tried = false;
      try { tried = sessionStorage.getItem(retryKey) === "1"; sessionStorage.setItem(retryKey, "1"); } catch (e) { tried = true; }
      if (!tried) location.reload();
    }, 5000);
    window.stop();
    return;
  }
  if (!pageEngine) navigator.serviceWorker.register(new URL("sw.js", root).href, { scope: root.pathname });

  var ENGINE_LOCK = "aries-engine";
  var channel = "BroadcastChannel" in window ? new BroadcastChannel("aries-engine") : null;
  var worker = null;
  var owner = false;
  var blocked = false;
  var releaseLock = null;
  var pendingHttp = [];
  var pendingSockets = [];
  var flushWaiters = {};
  var nextFlush = 1;

  function startEngine() {
    owner = true;
    worker = new Worker(new URL("engine-worker.js", script.src).href, { type: "module" });
    window.__ARIES_ENGINE_WORKER__ = worker;
    worker.addEventListener("message", onWorkerMessage);
    pendingHttp.splice(0).forEach(function (item) { worker.postMessage(item.msg, item.transfer); });
    pendingSockets.splice(0).forEach(function (msg) { worker.postMessage(msg); });
    if (navigator.storage && navigator.storage.persist) {
      // Ask the browser not to evict the chart library under storage pressure.
      navigator.storage.persisted().then(function (done) { if (!done) return navigator.storage.persist(); })
        .catch(function () {});
    }
  }

  function flushEngine() {
    if (!worker) return Promise.resolve();
    var id = nextFlush++;
    return new Promise(function (resolve) {
      flushWaiters[id] = resolve;
      worker.postMessage({ type: "flush", id: id });
      setTimeout(function () { if (flushWaiters[id]) { delete flushWaiters[id]; resolve(); } }, 4000);
    });
  }

  // Leave the library on disk whenever the tab may be about to disappear.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushEngine();
  });
  window.addEventListener("pagehide", function () { flushEngine(); });

  function stopEngine() {
    return flushEngine().then(function () {
      if (worker) worker.terminate();
      worker = null;
      busyReset();
      owner = false;
      window.__ARIES_ENGINE_WORKER__ = null;
      if (releaseLock) releaseLock();
      releaseLock = null;
    });
  }

  function takeOver() {
    if (channel) channel.postMessage({ type: "takeover" });
    // Granted once the current owner has saved and released the library.
    navigator.locks.request(ENGINE_LOCK, function () {
      location.reload();
      return new Promise(function () {});
    });
  }

  var blockedView = null;
  function showBlocked() {
    blocked = true;
    pendingHttp.splice(0).forEach(function (item) { refuse(item.transfer[0]); });
    pendingSockets = [];
    if (blockedView) return;
    blockedView = document.createElement("div");
    blockedView.setAttribute("role", "alertdialog");
    blockedView.setAttribute("aria-modal", "true");
    blockedView.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.45 system-ui,-apple-system,sans-serif;background:Canvas;color:CanvasText;color-scheme:light dark";
    var panel = document.createElement("div");
    panel.style.cssText = "max-width:26rem;text-align:center";
    var title = document.createElement("h1");
    title.style.cssText = "font-size:17px;font-weight:600;margin:0 0 8px";
    var body = document.createElement("p");
    body.style.cssText = "margin:0 0 16px;opacity:.75";
    var button = document.createElement("button");
    button.type = "button";
    button.style.cssText = "font:inherit;padding:6px 14px;border-radius:6px;border:1px solid GrayText;background:ButtonFace;color:ButtonText;cursor:pointer";
    button.addEventListener("click", function () { button.disabled = true; takeOver(); });
    panel.appendChild(title); panel.appendChild(body); panel.appendChild(button);
    blockedView.appendChild(panel);
    (document.body || document.documentElement).appendChild(blockedView);
    bootStrings().then(function (strings) {
      title.textContent = strings["webEngine.otherTabTitle"] || "";
      body.textContent = strings["webEngine.otherTabBody"] || "";
      button.textContent = strings["webEngine.useHere"] || "";
      button.focus();
    });
  }

  // Strings come from the app's locale catalogs (staged by build_web.py).
  function bootStrings() {
    return fetch(new URL("boot-strings.json", script.src).href).then(function (r) { return r.json(); })
      .then(function (catalogs) {
        var wanted = [document.documentElement.lang].concat(navigator.languages || [navigator.language]);
        for (var i = 0; i < wanted.length; i++) {
          var tag = String(wanted[i] || "");
          if (!tag) continue;
          var lower = tag.toLowerCase();
          var key = catalogs[tag] ? tag
            : lower.indexOf("zh") === 0 ? (/hant|tw|hk|mo/.test(lower) ? "zh-Hant" : "zh-Hans")
            : lower.split("-")[0];
          if (catalogs[key]) return catalogs[key];
        }
        return catalogs.en || {};
      })
      .catch(function () { return {}; });
  }

  if (channel) {
    channel.onmessage = function (event) {
      if (!event.data || event.data.type !== "takeover" || !owner) return;
      stopEngine().then(showBlocked);
    };
  }

  if (navigator.locks && navigator.locks.request) {
    navigator.locks.request(ENGINE_LOCK, { ifAvailable: true }, function (lock) {
      if (!lock) {
        showBlocked();
        return null;
      }
      startEngine();
      return new Promise(function (resolve) { releaseLock = resolve; });
    });
  } else {
    startEngine();
  }
  // The app's splash (components/web-engine-splash.tsx) reads the startup
  // stage; it may mount before or after any stage arrives.
  window.__ARIES_ENGINE_STAGE__ = "starting";
  function showStage(stage) {
    window.__ARIES_ENGINE_STAGE__ = stage;
    window.dispatchEvent(new CustomEvent("aries-engine-stage", { detail: stage }));
  }

  function refuse(port) {
    var text = new TextEncoder().encode("Aries engine is open in another tab");
    port.postMessage({ status: 503, headers: [["content-type", "text/plain"], ["x-aries-engine", "not-owner"]], body: text.buffer }, [text.buffer]);
  }

  // One daemon request, from the service worker or (page engine) this page.
  function routeHttp(msg, port) {
    if (blocked) {
      // This tab does not own the engine; never answer from another tab's state.
      refuse(port);
      return;
    }
    if (abortedIds.has(msg.id)) {
      // The app gave up on it before it arrived here.
      cancelledReply(port);
      return;
    }
    var transfer = [port].concat(msg.body ? [msg.body] : []);
    busyStart(msg.id);
    if (worker) worker.postMessage(msg, transfer);
    else pendingHttp.push({ msg: msg, transfer: transfer });
  }

  if (!pageEngine) navigator.serviceWorker.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === "aries-engine-ping") {
      event.ports[0].postMessage({ owner: owner });
      return;
    }
    if (msg.type === "aries-daemon-abort") {
      abortHttp(msg.id);
      return;
    }
    if (msg.type !== "aries-daemon-http") return;
    msg.type = "http";
    msg.id = requestIdHeader(msg.headers) || msg.id;
    routeHttp(msg, event.ports[0]);
  });

  // The app abandoned a request: drop it if it has not reached the engine yet,
  // otherwise let the worker skip it while it is still queued there (work
  // already running inline cannot be interrupted).
  var abortedIds = new Set();
  function abortHttp(id) {
    if (id == null) return;
    abortedIds.add(id);
    if (abortedIds.size > 256) abortedIds.delete(abortedIds.values().next().value);
    for (var i = 0; i < pendingHttp.length; i++) {
      if (pendingHttp[i].msg.id === id) {
        var dropped = pendingHttp.splice(i, 1)[0];
        cancelledReply(dropped.transfer[0]);
        busyEnd(id);
        return;
      }
    }
    if (worker) worker.postMessage({ type: "abort", id: id });
  }
  function cancelledReply(port) {
    var text = new TextEncoder().encode("cancelled");
    port.postMessage({ status: 499, headers: [["content-type", "text/plain"]], body: text.buffer }, [text.buffer]);
  }
  function requestIdHeader(headers) {
    for (var i = 0; i < (headers || []).length; i++) {
      if (String(headers[i][0]).toLowerCase() === REQUEST_ID_HEADER) return headers[i][1];
    }
    return null;
  }

  // Daemon fetches carry an id, so an abort on this page reaches the engine
  // directly (service workers do not reliably see a page's fetch abort).
  var REQUEST_ID_HEADER = "x-aries-request-id";
  var nativeFetch = window.fetch.bind(window);
  var nextRequest = 1;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    var signal = (init && init.signal) || (input instanceof Request ? input.signal : null);
    var target;
    try { target = new URL(url, location.href).href; } catch (e) { target = ""; }
    if (target.indexOf(daemonBase + "/") === 0 && pageEngine) return pageFetch(input, init, target, signal);
    if (!signal || target.indexOf(daemonBase + "/") !== 0) return nativeFetch(input, init);
    var id = "page-" + nextRequest++ + "-" + Math.random().toString(36).slice(2, 10);
    var headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    headers.set(REQUEST_ID_HEADER, id);
    if (!signal.aborted) signal.addEventListener("abort", function () { abortHttp(id); }, { once: true });
    return nativeFetch(input, Object.assign({}, init, { headers: headers }));
  };

  // Page engine: answer a daemon fetch from the engine worker, as sw.js would.
  function abortError() {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  function pageFetch(input, init, target, signal) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    var request;
    try { request = new Request(input, init); } catch (e) { return Promise.reject(e); }
    var id = request.headers.get(REQUEST_ID_HEADER) || "page-" + nextRequest++ + "-" + Math.random().toString(36).slice(2, 10);
    var method = request.method;
    var url = new URL(target);
    var body = method === "GET" || method === "HEAD" ? Promise.resolve(null) : request.arrayBuffer();
    return body.then(function (bytes) {
      if (signal && signal.aborted) throw abortError();
      return new Promise(function (resolve, reject) {
        var channel = new MessageChannel();
        function onAbort() {
          channel.port1.onmessage = null;
          channel.port1.close();
          abortHttp(id);
          reject(abortError());
        }
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        channel.port1.onmessage = function (event) {
          if (signal) signal.removeEventListener("abort", onAbort);
          var reply = event.data;
          var empty = method === "HEAD" || reply.status === 204 || reply.status === 304;
          resolve(new Response(empty ? null : reply.body, { status: reply.status, headers: reply.headers }));
        };
        var headers = [];
        request.headers.forEach(function (value, name) { headers.push([name, value]); });
        routeHttp({
          type: "http",
          id: id,
          method: method,
          path: url.pathname.slice(new URL(daemonBase).pathname.length) || "/",
          query: url.search.replace(/^\?/, ""),
          headers: headers,
          body: bytes,
        }, channel.port2);
      });
    });
  }

  if (pageEngine) {
    window.__ARIES_PAGE_ENGINE__ = true;
    var showLimits = function () {
      var bar = document.createElement("div");
      bar.setAttribute("role", "status");
      bar.setAttribute("data-aries-page-engine", "");
      bar.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483645;box-sizing:border-box;width:max-content;max-width:calc(100vw - 32px);display:flex;gap:12px;align-items:center;padding:8px 12px;border-radius:8px;border:1px solid GrayText;font:13px/1.4 system-ui,-apple-system,sans-serif;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 4px 16px rgba(0,0,0,.2)";
      var text = document.createElement("span");
      var close = document.createElement("button");
      close.type = "button";
      close.style.cssText = "flex:none;font:inherit;padding:4px 10px;border-radius:6px;border:1px solid GrayText;background:ButtonFace;color:ButtonText;cursor:pointer";
      close.addEventListener("click", function () { bar.remove(); });
      bar.appendChild(text);
      bar.appendChild(close);
      bootStrings().then(function (strings) {
        if (!strings["webEngine.limitedWindow"]) return;
        text.textContent = strings["webEngine.limitedWindow"];
        close.textContent = strings["webEngine.close"] || "";
        document.body.appendChild(bar);
      });
    };
    if (document.body) showLimits();
    else document.addEventListener("DOMContentLoaded", showLimits, { once: true });
  }

  // Engine work slower than BUSY_DELAY_MS shows a thin, textless activity
  // line at the top edge, so a slow request reads as work in progress rather
  // than a missed tap. Startup shows the app's splash instead.
  var BUSY_DELAY_MS = 350;
  var busyIds = {};
  var busyCount = 0;
  var busyTimer = null;
  var busyLine = null;
  var busyAnimation = null;
  var engineReady = false;
  function busyStart(id) {
    if (id == null || busyIds[id]) return;
    busyIds[id] = true;
    busyCount += 1;
    if (busyCount === 1 && engineReady && !busyTimer) busyTimer = setTimeout(showBusy, BUSY_DELAY_MS);
  }
  function busyEnd(id) {
    if (id == null || !busyIds[id]) return;
    delete busyIds[id];
    busyCount -= 1;
    if (busyCount > 0) return;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = null;
    hideBusy();
  }
  function showBusy() {
    busyTimer = null;
    if (busyCount <= 0) return;
    if (!busyLine) {
      busyLine = document.createElement("div");
      busyLine.setAttribute("aria-hidden", "true");
      busyLine.setAttribute("data-aries-engine-busy", "");
      busyLine.style.cssText = "position:fixed;left:0;right:0;top:env(safe-area-inset-top,0px);height:2px;z-index:2147483647;pointer-events:none;overflow:hidden;opacity:0;transition:opacity .15s ease";
      var runner = document.createElement("div");
      runner.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:30%;background:var(--aries-accent,var(--aries-titlebar-icon-active,currentColor))";
      busyLine.appendChild(runner);
      (document.body || document.documentElement).appendChild(busyLine);
      var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!still && runner.animate) {
        busyAnimation = runner.animate(
          [{ transform: "translateX(-100%)" }, { transform: "translateX(340%)" }],
          { duration: 1100, iterations: Infinity, easing: "ease-in-out" },
        );
      } else {
        runner.style.width = "100%";
        runner.style.opacity = "0.6";
      }
    }
    if (busyAnimation) busyAnimation.play();
    busyLine.style.opacity = "1";
  }
  function busyReset() {
    busyIds = {};
    busyCount = 0;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = null;
    hideBusy();
  }
  function hideBusy() {
    if (!busyLine) return;
    busyLine.style.opacity = "0";
    if (busyAnimation) busyAnimation.pause();
  }

  var sockets = {};
  var nextId = 1;
  function postSocket(msg) {
    if (worker) worker.postMessage(msg);
    else if (!blocked) pendingSockets.push(msg);
  }
  function onWorkerMessage(event) {
    var msg = event.data;
    if (msg.type === "flushed") {
      var done = flushWaiters[msg.id];
      delete flushWaiters[msg.id];
      if (done) done();
      return;
    }
    if (msg.type === "http-done") {
      busyEnd(msg.id);
      return;
    }
    if (msg.type === "status") {
      if (msg.stage === "ready") engineReady = true;
      if (msg.stage === "error") console.error("[aries-engine]", msg.detail);
      else console.info("[aries-engine]", msg.detail);
      showStage(msg.stage);
      return;
    }
    var socket = sockets[msg.id];
    if (!socket) return;
    if (msg.type === "ws-open") socket._open();
    else if (msg.type === "ws-message") socket._message(msg.text);
  }

  var NativeWebSocket = window.WebSocket;
  function isDaemonSocket(url) {
    try { var u = new URL(url, location.href); return u.host === location.host && u.pathname.endsWith("/ws/events"); }
    catch (e) { return false; }
  }
  function EngineSocket(url) {
    this.url = String(url);
    this.readyState = 0;
    this.protocol = "";
    this.extensions = "";
    this.binaryType = "blob";
    this._id = nextId++;
    this._listeners = {};
    sockets[this._id] = this;
    postSocket({ type: "ws-open", id: this._id });
  }
  EngineSocket.CONNECTING = 0; EngineSocket.OPEN = 1; EngineSocket.CLOSING = 2; EngineSocket.CLOSED = 3;
  EngineSocket.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
  EngineSocket.prototype.removeEventListener = function (type, fn) { var l = this._listeners[type] || []; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  EngineSocket.prototype._emit = function (type, event) {
    var handler = this["on" + type]; if (handler) handler.call(this, event);
    (this._listeners[type] || []).slice().forEach(function (fn) { fn.call(this, event); }, this);
  };
  EngineSocket.prototype._open = function () { this.readyState = 1; this._emit("open", new Event("open")); };
  EngineSocket.prototype._message = function (text) { if (this.readyState === 1) this._emit("message", new MessageEvent("message", { data: text })); };
  EngineSocket.prototype.send = function (text) { postSocket({ type: "ws-send", id: this._id, text: String(text) }); };
  EngineSocket.prototype.close = function () {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    postSocket({ type: "ws-close", id: this._id });
    delete sockets[this._id];
    this._emit("close", new CloseEvent("close", { code: 1000, wasClean: true }));
  };
  function PatchedWebSocket(url, protocols) {
    if (isDaemonSocket(url)) return new EngineSocket(url);
    return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
  }
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  PatchedWebSocket.CONNECTING = 0; PatchedWebSocket.OPEN = 1; PatchedWebSocket.CLOSING = 2; PatchedWebSocket.CLOSED = 3;
  window.WebSocket = PatchedWebSocket;
})();
