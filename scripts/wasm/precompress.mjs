// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Write Brotli (.br) and gzip (.gz) copies next to the compressible files of
// the built browser site, so the server sends them encoded without spending
// CPU per request (webapp/wasm/htaccess, scripts/wasm/serve_site.py). A copy
// is kept only when it is clearly smaller: the engine bundle and the Pyodide
// wheels are deflated zips already and stay as they are.
//
//   node scripts/wasm/precompress.mjs build/wasm/site
//
// Output is deterministic (gzip carries no name or time), so an unchanged
// file uploads as unchanged.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

// Brotli at its best setting is slow; compress several files at a time on
// libuv's pool, which is sized from this variable on its first use.
const WORKERS = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 8));
process.env.UV_THREADPOOL_SIZE ??= String(WORKERS);

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const COMPRESSIBLE = /\.(wasm|m?js|data|json|css|html|txt|svg|xml|zip|whl|ttf|otf|map|webmanifest)$/i;
const MIN_BYTES = 1024;
// Keep an encoded copy only when it saves at least this share of the bytes.
const MIN_SAVING = 0.1;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && COMPRESSIBLE.test(entry.name)) out.push(full);
  }
  return out;
}

async function compress(file) {
  const data = fs.readFileSync(file);
  const result = { file, size: data.length, br: data.length, gz: data.length };
  if (data.length < MIN_BYTES) return result;
  const [br, gz] = await Promise.all([
    brotli(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_LGWIN]: zlib.constants.BROTLI_MAX_WINDOW_BITS,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    }),
    gzip(data, { level: zlib.constants.Z_BEST_COMPRESSION }),
  ]);
  const { mtime } = fs.statSync(file);
  for (const [suffix, encoded] of [[".br", br], [".gz", gz]]) {
    if (encoded.length > data.length * (1 - MIN_SAVING)) continue;
    fs.writeFileSync(file + suffix, encoded);
    fs.utimesSync(file + suffix, mtime, mtime);
    result[suffix.slice(1)] = encoded.length;
  }
  return result;
}

async function main() {
  const site = process.argv[2];
  if (!site || !fs.existsSync(site)) {
    console.error("usage: node scripts/wasm/precompress.mjs <site directory>");
    process.exit(2);
  }
  const files = walk(path.resolve(site));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < files.length) results.push(await compress(files[next++]));
  }));
  const total = (key) => results.reduce((sum, item) => sum + item[key], 0);
  const encoded = results.filter((item) => item.br < item.size).length;
  console.log(
    `precompressed ${encoded} of ${results.length} files: ${(total("size") / 1e6).toFixed(1)} MB -> `
    + `${(total("br") / 1e6).toFixed(1)} MB brotli, ${(total("gz") / 1e6).toFixed(1)} MB gzip`,
  );
}

await main();
