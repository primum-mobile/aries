// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Headless smoke test of the browser engine: boots the staged engine zip under
// Pyodide in Node with the same packages and wheels as webapp/wasm/engine-worker.js,
// then drives the real daemon through wasm_bridge (workspace state, Here and
// Now, its snapshot, inspector and hover rulers for Part of Fortune and Pluto,
// Primary Directions (first paint and the full list), a
// derived transits chart and its Aspect List, Graphic Ephemeris meta, month
// blocks and year stations, place search, a table PDF, and
// a Style Lab timer that must not block the engine). Exits non-zero on any
// failure.
// Also caches the Pyodide package wheels that build_web.py ships.
//
//   node scripts/wasm/smoke.mjs

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wasm = process.env.ARIES_WASM_DIR || path.join(repo, "build", "wasm");
const require = createRequire(path.join(wasm, "node", "package.json"));
const { loadPyodide } = require("pyodide");

const worker = fs.readFileSync(path.join(repo, "webapp", "wasm", "engine-worker.js"), "utf8");
const listOf = (name) => JSON.parse(worker.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]);
const packages = listOf("PACKAGES");
const extraWheels = listOf("EXTRA_WHEELS");
const engineZip = path.join(repo, "build", "wasm", "out", "aries-engine.zip");

const started = performance.now();
const py = await loadPyodide({ env: { HOME: "/home/pyodide" } });
await py.loadPackage(packages, { messageCallback: () => {} });
const site = py.runPython("import site; site.getsitepackages()[0]");
for (const name of extraWheels) {
  py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(wasm, "wheels", name))), "zip", { extractDir: site });
}
py.unpackArchive(new Uint8Array(fs.readFileSync(engineZip)), "zip", { extractDir: "/app" });
py.FS.mkdirTree("/home/pyodide");

const checks = await py.runPythonAsync(`
import json, os, sys, time
os.environ['ARIES_DAEMON_BASE_DIR'] = '/app'
sys.path[:0] = ['/app', '/app/webapp/frontend/scripts']
os.chdir('/app')
from webapp.daemon import wasm_bridge as bridge

results = []

async def call(name, method, path, body=None, query='', expect=200, check=None):
    started = time.time()
    data = json.dumps(body).encode() if body is not None else None
    response = await bridge.handle(method, path, query, [['content-type', 'application/json']], data)
    ms = round((time.time() - started) * 1000)
    ok = response['status'] == expect
    payload = None
    if ok:
        payload = json.loads(response['body'] or b'null')
        if check is not None:
            ok = bool(check(payload))
    results.append([name, ok, response['status'], ms])
    return payload

seeded = bridge.seed_default_location('Europe/Berlin')
results.append(['default location from time zone', seeded == 'Berlin', seeded, 0])
await call('workspace state', 'GET', '/api/workspace/state')
# The public Valens pack ships as a first-launch seed (stage_engine.py).
await call('corpus packs list Valens', 'GET', '/api/corpus/packs',
           check=lambda p: any(x.get('id') == 'valens' for x in p.get('packs') or []))
import corpus_loader, os
results.append(['Valens pack installed from its seed', os.path.isfile(
    os.path.join(corpus_loader._community_root(), 'valens', 'manifest.toml')), 'seed', 0])
opened = await call('open Here and Now', 'POST', '/api/workspace/open-here-now', {},
                    check=lambda p: p.get('documentId'))
if opened:
    await call('chart snapshot', 'GET', f"/api/workspace/document/{opened['documentId']}/snapshot",
               check=lambda p: len((p.get('primaryChart') or {}).get('planets') or []) >= 10)
    from urllib.parse import urlencode
    doc = opened['documentId']
    # Every chart point lists its domicile/exaltation/term/face and triplicity
    # rulers; only the seven classical planets carry a dignity judgment.
    def rulers_listed(p):
        rows = ' '.join(p.get('detail_rows') or [])
        return 'Term:' in rows and 'Face:' in rows and any(
            i.get('kind') == 'triplicity_lords' for i in p.get('dignity_items') or [])
    await call('inspector Part of Fortune rulers', 'GET', '/api/inspector',
               query=urlencode({'kind': 'fortune', 'objectId': 'fortune', 'docId': doc}), check=rulers_listed)
    await call('inspector Pluto rulers, no dignity', 'GET', '/api/inspector',
               query=urlencode({'kind': 'planet', 'objectId': '9', 'docId': doc}),
               check=lambda p: rulers_listed(p) and not any(
                   i.get('label') == 'Dignity' for i in p.get('dignity_items') or []))
    await call('hover Part of Fortune has no empty dignity', 'GET', '/api/inspector/flag',
               query=urlencode({'kind': 'fortune', 'objectId': 'fortune', 'docId': doc}),
               check=lambda p: [r[0] for r in p.get('rows') or []].count('Trip. Rulers') == 1
                   and not any(r[0] == 'Dign' and r[1] == '—' for r in p.get('rows') or []))
    pd = {'name': 'Here and Now', 'range': 4, 'direction': 0, 'documentId': doc}
    first = dict(pd, focusSpanYears=6, focusDatetime=time.strftime('%Y-%m-%dT%H:%M:%S'))
    await call('primary directions first paint', 'GET', '/api/directions', query=urlencode(first),
               check=lambda p: len(p.get('directions') or []) > 0 and (p.get('meta') or {}).get('focusWindow'))
    await call('primary directions full list', 'GET', '/api/directions', query=urlencode(pd),
               check=lambda p: len(p.get('directions') or []) > 100)
    transits = await call('open transits (derived chart)', 'POST', '/api/workspace/open',
                          {'parentDocumentId': doc, 'featureKind': 'transits', 'reuseExisting': True},
                          check=lambda p: p.get('documentId') and p.get('documentId') != doc)
    if transits:
        await call('transits snapshot', 'GET', f"/api/workspace/document/{transits['documentId']}/snapshot",
                   check=lambda p: len((p.get('primaryChart') or {}).get('planets') or []) >= 10)
        await call('aspect list (transits)', 'GET', '/api/aspect-list',
                   query=urlencode({'documentId': transits['documentId']}),
                   check=lambda p: len(p.get('rows') or []) > 0)

# A threading.Timer (Style Lab draft persistence) must be deferred, not waited out.
import threading
fired = []
started = time.time()
timer = threading.Timer(0.3, lambda: fired.append(1))
timer.start()
blocked_ms = round((time.time() - started) * 1000)
results.append(['timer start does not block', blocked_ms < 50 and not fired, blocked_ms, blocked_ms])
await __import__('asyncio').sleep(0.4)
results.append(['deferred timer fires', fired == [1], len(fired), 0])
await call('graphic ephemeris meta', 'GET', '/api/ephemeris/meta',
           check=lambda p: p.get('dataKey') and len(p.get('planets') or []) >= 10)
await call('graphic ephemeris month blocks', 'GET', '/api/ephemeris/blocks',
           query='year=2026&month=1&count=2',
           check=lambda p: len(p.get('blocks') or []) == 2 and p['blocks'][1].get('lunations'))
await call('graphic ephemeris year stations', 'GET', '/api/ephemeris/stations', query='year=2026',
           check=lambda p: len(p.get('longitude') or []) > 10)
await call('place search', 'GET', '/api/editor/resolve-place', query='q=Paris',
           check=lambda p: any(c.get('tzid') == 'Europe/Paris' for c in p.get('candidates') or []))
await call('table PDF export', 'POST', '/api/table/export-bytes',
           {'title': 'Smoke', 'filename': 'smoke.pdf',
            'document': {'title': 'Smoke', 'columns': [{'id': 'a', 'label': 'A'}], 'rows': [{'cells': ['1']}]}},
           check=lambda p: p.get('ok') and p.get('bytes', 0) > 0)
json.dumps(results)
`);

let failed = 0;
for (const [name, ok, status, ms] of JSON.parse(checks)) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}  (${status}, ${ms} ms)`);
  if (!ok) failed += 1;
}
console.log(`engine smoke: ${failed ? `${failed} failed` : "all passed"} in ${Math.round(performance.now() - started)} ms`);
process.exitCode = failed ? 1 : 0;
