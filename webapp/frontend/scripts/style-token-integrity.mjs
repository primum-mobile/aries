#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStyleTokenInventory } from "./style-token-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(readOption("--frontend-root") ?? resolve(scriptDirectory, ".."));
const writeInventory = process.argv.includes("--write-inventory");
const result = buildStyleTokenInventory(frontendRoot);

checkGeneratedArtifact(
  result.inventoryPath,
  result.rendered,
  "generated inventory",
);
checkGeneratedArtifact(
  result.publicManifestPath,
  result.publicRendered,
  "generated public handoff manifest",
);

const counts = result.inventory?.counts ?? {};
console.log("Aries style token contract");
console.log(`  sources: ${result.stats.sourceFiles ?? 0} first-party source modules`);
console.log(`  CSS declarations: ${counts.cssDeclarations ?? 0} (${counts.cssTokens ?? 0} unique)`);
console.log(`  classified inventory: ${counts.tokens ?? 0} (${counts.public ?? 0} public, ${counts.derived ?? 0} derived, ${counts.runtime ?? 0} runtime)`);
console.log(`  concrete inline runtime providers: ${result.stats.inlineProviders ?? 0}`);
console.log(`  legacy migration overlay: ${result.inventory?.legacyMigration.tokens.length ?? 0} frozen entries`);
console.log(`  public handoff: ${result.publicManifest?.counts.editable ?? 0} editable, ${result.publicManifest?.counts.blockedByCoupling ?? 0} blocked by coupling`);

if (result.errors.length > 0) {
  console.error("");
  for (const error of result.errors) {
    console.error(`ERROR ${displayPath(error.path)}:${error.line} ${error.message}`);
  }
  console.error(`\nStyle token contract failed with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`);
  process.exitCode = 1;
} else {
  console.log(writeInventory ? "  inventory: UPDATED" : "  result: PASS");
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} requires a path`);
    process.exit(2);
  }
  return value;
}

function addError(path, line, message) {
  result.errors.push({ path, line, message });
}

function checkGeneratedArtifact(path, rendered, label) {
  if (!path || !rendered) return;
  if (writeInventory) {
    writeFileSync(path, rendered, "utf8");
    return;
  }
  let checkedIn = null;
  try { checkedIn = readFileSync(path, "utf8").replace(/\r\n?/g, "\n"); }
  catch { addError(path, 1, `${label} is missing; run npm run style-token-inventory`); }
  if (checkedIn !== null && checkedIn !== rendered) {
    addError(path, 1, `${label} drifted; run npm run style-token-inventory and review the diff`);
  }
}

function displayPath(path) {
  const rendered = relative(frontendRoot, path);
  return rendered && !rendered.startsWith("..") ? rendered : path;
}
