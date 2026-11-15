#!/usr/bin/env node
// Run every leaf script of an `npm run a && npm run b` chain and report all
// failures, instead of stopping at the first one like the `&&` chain does.
// CI uses it (e.g. `node scripts/run-npm-chain.mjs prebuild`) so one Windows
// run lists every broken contract test.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(path.join(frontendRoot, "package.json"), "utf8")).scripts;
const chainLink = /^npm run ([\w:.-]+)$/;

function leaves(name, seen = new Set()) {
  if (!(name in scripts)) throw new Error(`Unknown npm script: ${name}`);
  if (seen.has(name)) return [];
  seen.add(name);
  const links = scripts[name].split("&&").map(part => part.trim());
  const children = links.map(link => link.match(chainLink)?.[1]);
  if (children.every(Boolean)) return children.flatMap(child => leaves(child, seen));
  return [name];
}

const args = process.argv.slice(2);
const skipped = new Set(args.filter(arg => arg.startsWith("--skip=")).map(arg => arg.slice("--skip=".length)));
const roots = args.filter(arg => !arg.startsWith("--"));
if (roots.length === 0) {
  console.error("usage: node scripts/run-npm-chain.mjs [--skip=<script>] <script> [...]");
  process.exit(2);
}
const failed = [];
const all = [...new Set(roots.flatMap(root => leaves(root)))].filter(name => !skipped.has(name));
if (skipped.size) console.log(`Not run here: ${[...skipped].join(", ")}`);
for (const [index, name] of all.entries()) {
  console.log(`\n[${index + 1}/${all.length}] npm run ${name}`);
  const started = Date.now();
  const result = spawnSync("npm", ["run", "--silent", name], {
    cwd: frontendRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  console.log(`[${ok ? "pass" : "FAIL"}] ${name} (${seconds}s)`);
  if (!ok) failed.push(name);
}
console.log(`\n${all.length - failed.length}/${all.length} scripts passed.`);
if (failed.length) {
  console.log(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
