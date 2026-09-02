// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const TOKEN_NAME_SOURCE = "--[a-zA-Z_][a-zA-Z0-9_-]*";
const CSS_VAR_REFERENCE = new RegExp(`var\\(\\s*(${TOKEN_NAME_SOURCE})`, "g");
const TAILWIND_SHORTHAND = new RegExp(`\\((${TOKEN_NAME_SOURCE})(?:\\([^)]*\\))?\\)`, "g");
const EXACT_TOKEN_LITERAL = new RegExp(`(["'\\x60])(${TOKEN_NAME_SOURCE})\\1`, "g");
const PUBLIC_METADATA_FIELDS = [
  "semanticId",
  "label",
  "description",
  "tier",
  "scope",
  "effectiveAuthority",
  "editTarget",
  "affectedSurfaces",
  "inheritanceMode",
  "handoffStatus",
  "safetyNotes",
];
const PUBLIC_TIERS = new Set([
  "primitive",
  "semantic-app",
  "component",
  "renderer-palette",
  "renderer-metric",
]);
const PUBLIC_SCOPES = new Set(["app", "chart", "both"]);
const HANDOFF_STATUSES = new Set(["editable", "blocked-by-coupling"]);

export function buildStyleTokenInventory(frontendRoot) {
  const root = resolve(frontendRoot);
  const paths = {
    contract: join(root, "src", "styles", "style-token-contract.json"),
    rendererContract: join(root, "src", "styles", "renderer-style-contract.generated.json"),
    css: join(root, "src", "app", "globals.css"),
    legacy: join(root, "src", "styles", "style-tokens.ts"),
  };
  const errors = [];
  const contract = readJson(paths.contract, errors);
  const rendererContract = readJson(paths.rendererContract, errors);
  const cssSource = readText(paths.css, errors);
  const legacySource = readText(paths.legacy, errors);
  if (!contract || !rendererContract || cssSource === null || legacySource === null) {
    return {
      contract,
      errors,
      inventory: null,
      inventoryPath: null,
      rendered: null,
      publicManifest: null,
      publicManifestPath: null,
      publicRendered: null,
      stats: {},
    };
  }
  mergeStyleContractExtension(contract, rendererContract, paths.rendererContract, errors);

  const declarations = collectCssDeclarations(cssSource, paths.css, root);
  const declarationsByName = groupBy(declarations, (entry) => entry.name);
  const legacyTokens = parseLegacyTokens(legacySource, paths.legacy, root, errors);
  const legacyIdUnion = parseLegacyIdUnion(legacySource);
  validateLegacyManifest(
    contract.legacyOverlay,
    legacyTokens,
    legacyIdUnion,
    declarationsByName,
    paths,
    errors,
  );

  const sourcePaths = listSourceFiles(join(root, "src"));
  const metadataPaths = new Set([resolve(paths.legacy)]);
  const allSourceRecords = sourcePaths
    .filter((path) => !metadataPaths.has(resolve(path)))
    .map((path) => ({ path, source: maskTypeScriptNoise(readText(path, errors) ?? "") }));
  const legacyConsumerPaths = new Set(
    (contract.legacyOverlay.consumerFiles ?? []).map((path) => resolve(root, path)),
  );
  const legacyConsumerFiles = allSourceRecords
    .filter(({ path, source }) => legacyConsumerPaths.has(resolve(path)) && /\bSTYLE_TOKENS\b/.test(source))
    .map(({ path }) => displayPath(root, path));
  if (legacyConsumerFiles.length !== legacyConsumerPaths.size) {
    pushError(errors, paths.contract, 1, "legacy preview consumer files are missing or no longer iterate STYLE_TOKENS");
  }
  const sourceRecords = allSourceRecords.filter(({ path }) => !legacyConsumerPaths.has(resolve(path)));
  const legacyReferenceRecords = allSourceRecords.filter(({ path }) => legacyConsumerPaths.has(resolve(path)));
  const references = collectReferences(cssSource, paths.css, sourceRecords, root, legacyReferenceRecords);
  const consumersByName = groupBy(references, (entry) => entry.name);
  const inlineProviders = collectInlineProviders(sourceRecords, root);
  const inlineProvidersByName = groupBy(inlineProviders, (entry) => entry.name);

  const runtimeOnly = Array.isArray(contract.runtimeOnly) ? contract.runtimeOnly : [];
  const externalTokens = Array.isArray(contract.externalTokens) ? contract.externalTokens : [];
  const allNames = new Set([
    ...declarationsByName.keys(),
    ...runtimeOnly.map(({ name }) => name),
    ...externalTokens.map(({ name }) => name),
  ]);
  const knownNames = new Set(allNames);
  for (const reference of references) {
    if (!knownNames.has(reference.name)) {
      pushError(errors, reference.path, reference.line, `undefined style token ${reference.name}`);
    }
  }

  const legacyByName = new Map(legacyTokens.map((token) => [token.cssVar, token]));
  const runtimeByName = new Map(runtimeOnly.map((token) => [token.name, token]));
  const externalByName = new Map(externalTokens.map((token) => [token.name, token]));
  const records = [];
  const overrideAssignments = new Map();

  for (const name of [...allNames].sort()) {
    const matchingFamilies = (contract.families ?? []).filter((family) => matchesAny(name, family.match));
    if (matchingFamilies.length !== 1) {
      pushError(errors, paths.contract, 1, `${name} matches ${matchingFamilies.length} base families; expected exactly one`);
      continue;
    }
    const family = matchingFamilies[0];
    const cssDeclarations = declarationsByName.get(name) ?? [];
    const runtimeDefinition = runtimeByName.get(name);
    const externalDefinition = externalByName.get(name);
    const baseDeclaration = chooseBaseDeclaration(cssDeclarations);
    const dependencies = uniqueSorted(cssDeclarations.flatMap(({ value }) => collectDependencies(value)));
    const baseDependencies = collectDependencies(baseDeclaration?.value ?? "");
    const metadata = { ...family.defaults };

    for (let index = 0; index < (contract.overrides ?? []).length; index += 1) {
      const override = contract.overrides[index];
      if (!matchesAny(name, override.match)) continue;
      for (const [key, value] of Object.entries(override.set ?? {})) {
        const assignmentKey = `${name}:${key}`;
        if (overrideAssignments.has(assignmentKey) && overrideAssignments.get(assignmentKey) !== value) {
          pushError(errors, paths.contract, 1, `conflicting overrides for ${name}.${key}`);
        }
        overrideAssignments.set(assignmentKey, value);
        metadata[key] = value;
      }
    }

    const legacy = legacyByName.get(name);
    if (legacy) {
      metadata.class = contract.legacyOverlay.class;
      metadata.migrationAuthority = contract.legacyOverlay.migrationAuthority;
      const classException = contract.legacyOverlay.classExceptions?.[name];
      if (classException) metadata.class = classException;
    }
    if (runtimeDefinition) Object.assign(metadata, runtimeDefinition);
    if (externalDefinition) Object.assign(metadata, externalDefinition);
    if (metadata.class === "derived") {
      metadata.provider = "css-expression";
    } else if (metadata.class === "runtime" && !runtimeDefinition && baseDependencies.length > 0) {
      metadata.class = "derived";
      metadata.provider = "css-expression";
    }

    const inferred = inferTypeAndUnit(name, baseDeclaration?.value ?? runtimeDefinition?.default ?? "", legacy);
    if (metadata.type === "infer") metadata.type = inferred.type;
    if (metadata.unit === "infer") metadata.unit = inferred.unit;
    const consumerFiles = uniqueSorted(
      (consumersByName.get(name) ?? []).map(({ path }) => displayPath(root, path)),
    );
    const providerFiles = uniqueSorted((inlineProvidersByName.get(name) ?? []).map(({ path }) => displayPath(root, path)));
    const record = {
      id: name,
      name,
      family: family.id,
      class: metadata.class,
      role: metadata.role,
      owner: metadata.owner,
      provider: metadata.provider,
      scope: metadata.scope,
      type: metadata.type,
      unit: metadata.unit,
      default: baseDeclaration?.value ?? runtimeDefinition?.default ?? externalDefinition?.default ?? null,
      dependencies,
      selectors: uniqueSorted(cssDeclarations.map(({ selector }) => selector), selectorSort),
      declarations: cssDeclarations.map(({ selector, value }) => ({ selector, value })),
      consumerFiles,
    };
    if (providerFiles.length > 0) record.runtimeProviderFiles = providerFiles;
    if (legacy) {
      record.legacyId = legacy.id;
      record.migrationAuthority = metadata.migrationAuthority;
      record.legacyConsumerFiles = uniqueSorted(legacyConsumerFiles);
      if (legacy.kind === "number") {
        record.bounds = { min: legacy.min, max: legacy.max, step: legacy.step };
      }
    }
    const publicMetadata = contract.publicTokens?.[name];
    if (publicMetadata?.bounds) record.bounds = { ...publicMetadata.bounds };
    records.push(record);
  }

  resolveDerivedTypes(records);
  validateRecords(records, contract, paths, root, inlineProvidersByName, errors);
  validateDependencyGraph(records, paths.contract, errors);
  validateDependencyPolicy(records, contract, paths.contract, errors);
  validatePublicMetadata(records, contract, paths.contract, errors);
  validateRelationalConstraints(records, contract, paths.contract, errors);
  validateContrastPairs(records, contract, paths.contract, errors);
  validateAuthoringExclusions(records, contract, paths.contract, errors);
  validateExpectedCounts(
    contract,
    declarationsByName.size,
    runtimeOnly.length,
    externalTokens.length,
    records.length,
    paths.contract,
    errors,
  );

  const inventory = {
    schemaVersion: contract.schemaVersion,
    generatedFrom: {
      contract: displayPath(root, paths.contract),
      css: displayPath(root, paths.css),
      legacyOverlay: displayPath(root, paths.legacy),
    },
    counts: {
      tokens: records.length,
      cssTokens: declarationsByName.size,
      cssDeclarations: declarations.length,
      runtimeOnlyTokens: runtimeOnly.length,
      externalTokens: externalTokens.length,
      public: records.filter((token) => token.class === "public").length,
      derived: records.filter((token) => token.class === "derived").length,
      runtime: records.filter((token) => token.class === "runtime").length,
    },
    legacyMigration: {
      authority: contract.legacyOverlay.migrationAuthority,
      tokens: legacyTokens.map(({ id, cssVar }) => ({ id, cssVar })),
    },
    families: (contract.families ?? []).map(({ id }) => ({
      id,
      tokenCount: records.filter((token) => token.family === id).length,
    })),
    tokens: records,
  };
  const inventoryPath = join(root, contract.inventoryPath);
  const publicTokens = records
    .filter(({ class: tokenClass }) => tokenClass === "public")
    .map((record) => renderPublicToken(record, contract.publicTokens?.[record.name]));
  const publicNames = new Set(publicTokens.map(({ cssVar }) => cssVar));
  const supportingNames = new Set();
  for (const token of publicTokens) {
    for (const dependency of token.dependencies ?? []) supportingNames.add(dependency);
  }
  for (const constraint of contract.relationalConstraints ?? []) {
    for (const name of constraint.tokens ?? []) supportingNames.add(name);
    if (constraint.target) supportingNames.add(constraint.target);
    for (const term of constraint.terms ?? []) supportingNames.add(term.token);
  }
  const derivedContext = records
    .filter((record) => supportingNames.has(record.name) && !publicNames.has(record.name))
    .map((record) => ({
      cssVar: record.name,
      class: record.class,
      default: record.default,
      dependencies: record.dependencies,
    }));
  const publicManifest = {
    schemaVersion: contract.schemaVersion,
    generatedFrom: {
      contract: displayPath(root, paths.contract),
      inventory: displayPath(root, inventoryPath),
    },
    counts: {
      public: publicTokens.length,
      editable: publicTokens.filter(({ handoffStatus }) => handoffStatus === "editable").length,
      blockedByCoupling: publicTokens.filter(({ handoffStatus }) => handoffStatus === "blocked-by-coupling").length,
      supportingDerived: derivedContext.length,
    },
    relationalConstraints: contract.relationalConstraints ?? [],
    contrastPairs: contract.contrastPairs ?? [],
    derivedContext,
    authoringExclusions: contract.authoringExclusions ?? [],
    tokens: publicTokens,
  };
  const publicManifestPath = join(root, contract.publicManifestPath);
  return {
    contract,
    errors,
    inventory,
    inventoryPath,
    rendered: `${JSON.stringify(inventory, null, 2)}\n`,
    publicManifest,
    publicManifestPath,
    publicRendered: `${JSON.stringify(publicManifest, null, 2)}\n`,
    stats: {
      sourceFiles: sourcePaths.length,
      inlineProviders: inlineProviders.length,
      referencedTokens: new Set(references.map(({ name }) => name)).size,
    },
  };
}

function renderPublicToken(record, metadata = {}) {
  const output = {
    semanticId: metadata.semanticId,
    cssVar: record.name,
    label: metadata.label,
    description: metadata.description,
    tier: metadata.tier,
    scope: metadata.scope,
    type: record.type,
    unit: record.unit,
    default: record.default,
    effectiveAuthority: metadata.effectiveAuthority,
    editTarget: metadata.editTarget,
    affectedSurfaces: metadata.affectedSurfaces,
    inheritanceMode: metadata.inheritanceMode,
    handoffStatus: metadata.handoffStatus,
    safetyNotes: metadata.safetyNotes,
  };
  if (record.bounds) output.bounds = record.bounds;
  if (record.dependencies.length > 0) output.dependencies = record.dependencies;
  if (record.migrationAuthority) {
    output.legacyMigration = {
      id: record.legacyId,
      authority: record.migrationAuthority,
    };
  }
  return output;
}

function validateRecords(records, contract, paths, root, inlineProvidersByName, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const legacyNames = new Set((contract.legacyOverlay.frozen ?? []).map(({ cssVar }) => cssVar));
  for (const record of records) {
    for (const dependency of record.dependencies) {
      if (!byName.has(dependency)) pushError(errors, paths.css, 1, `${record.name} depends on missing ${dependency}`);
    }
    for (const key of ["family", "class", "role", "owner", "provider", "scope", "type", "unit"]) {
      if (record[key] === undefined || record[key] === null || ["infer", "unresolved"].includes(record[key])) {
        pushError(errors, paths.contract, 1, `${record.name} is missing resolved ${key} metadata`);
      }
    }
    if (!["public", "derived", "runtime"].includes(record.class)) {
      pushError(errors, paths.contract, 1, `${record.name} has invalid class ${record.class}`);
    }
    if (record.migrationAuthority && (!legacyNames.has(record.name) || record.migrationAuthority !== "legacy-preview-v1")) {
      pushError(errors, paths.contract, 1, `${record.name} may not use legacy-preview-v1 migration authority`);
    }
    if (record.class === "public") {
      if (!record.id || record.consumerFiles.length === 0) {
        pushError(errors, paths.contract, 1, `${record.name} public token requires a stable id and consumer`);
      }
      if (!record.selectors.some((selector) => selector === ":root")) {
        pushError(errors, paths.css, 1, `${record.name} public token requires a :root fallback`);
      }
      if (record.type === "number" && !record.bounds) {
        pushError(errors, paths.contract, 1, `${record.name} public numeric token requires min/max/step bounds`);
      }
      if (record.bounds && ![record.bounds.min, record.bounds.max, record.bounds.step].every(Number.isFinite)) {
        pushError(errors, paths.legacy, 1, `${record.name} has incomplete numeric bounds`);
      }
    }
    if (record.class === "derived" && record.dependencies.length === 0) {
      pushError(errors, paths.css, 1, `${record.name} is derived but has no dependencies`);
    }
    if (
      record.class === "runtime"
      && record.declarations.length === 0
      && record.provider !== "external-base-ui"
      && record.provider !== "external-tailwind"
    ) {
      const providers = inlineProvidersByName.get(record.name) ?? [];
      const expectedFile = (contract.runtimeOnly ?? []).find(({ name }) => name === record.name)?.providerFile;
      const expectedPath = expectedFile ? resolve(root, expectedFile) : null;
      if (
        providers.length === 0
        || (expectedPath && !providers.some(({ path }) => resolve(path) === expectedPath))
      ) {
        pushError(errors, paths.contract, 1, `${record.name} runtime token lacks its concrete React provider`);
      }
    }
  }
}

function validateDependencyPolicy(records, contract, path, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const allowlist = new Set(
    (contract.allowedCrossFamilyDependencies ?? []).map(({ from, to }) => `${from}->${to}`),
  );
  for (const record of records) {
    for (const dependencyName of record.dependencies) {
      const dependency = byName.get(dependencyName);
      if (!dependency) continue;
      const edge = `${record.name}->${dependencyName}`;
      if (
        record.family.startsWith("app.")
        && dependency.family.startsWith("morinus.")
        && !allowlist.has(edge)
      ) {
        pushError(errors, path, 1, `${edge} crosses from app styling into Morinus styling without an allowlist`);
      }
      if (
        (record.name.startsWith("--aries-") || record.name.startsWith("--morinus-"))
        && dependency.family.startsWith("platform.")
      ) {
        pushError(errors, path, 1, `${record.name} points inward through compatibility alias ${dependencyName}`);
      }
    }
    if (record.family.startsWith("platform.") && record.declarations.length > 0) {
      if (record.class !== "derived" || record.dependencies.length === 0) {
        pushError(errors, path, 1, `${record.name} platform alias must derive outward from a canonical token`);
      } else if (!record.dependencies.some((dependency) => reachesCanonical(dependency, byName))) {
        pushError(errors, path, 1, `${record.name} platform alias does not resolve outward to Aries/Morinus`);
      }
    }
  }
}

function reachesCanonical(name, byName, seen = new Set()) {
  if (name.startsWith("--aries-") || name.startsWith("--morinus-")) return true;
  if (seen.has(name)) return false;
  const record = byName.get(name);
  if (!record) return false;
  const nextSeen = new Set(seen).add(name);
  return record.dependencies.some((dependency) => reachesCanonical(dependency, byName, nextSeen));
}

function validatePublicMetadata(records, contract, path, errors) {
  const publicRecords = records.filter(({ class: tokenClass }) => tokenClass === "public");
  const publicNames = new Set(publicRecords.map(({ name }) => name));
  const authored = contract.publicTokens ?? {};
  for (const name of Object.keys(authored)) {
    if (!publicNames.has(name)) pushError(errors, path, 1, `${name} has public authoring metadata but is not public`);
  }
  const semanticIds = new Map();
  for (const record of publicRecords) {
    const metadata = authored[record.name];
    if (!metadata) {
      pushError(errors, path, 1, `${record.name} is public but lacks authored publicTokens metadata`);
      continue;
    }
    for (const field of PUBLIC_METADATA_FIELDS) {
      const value = metadata[field];
      if (
        value === undefined
        || value === null
        || (typeof value === "string" && value.trim() === "")
        || (Array.isArray(value) && value.length === 0)
      ) {
        pushError(errors, path, 1, `${record.name} public metadata is missing ${field}`);
      }
    }
    if (!PUBLIC_TIERS.has(metadata.tier)) pushError(errors, path, 1, `${record.name} has invalid public tier ${metadata.tier}`);
    if (!PUBLIC_SCOPES.has(metadata.scope)) pushError(errors, path, 1, `${record.name} has invalid public scope ${metadata.scope}`);
    if (!HANDOFF_STATUSES.has(metadata.handoffStatus)) {
      pushError(errors, path, 1, `${record.name} has invalid handoff status ${metadata.handoffStatus}`);
    }
    const duplicate = semanticIds.get(metadata.semanticId);
    if (duplicate) pushError(errors, path, 1, `${record.name} duplicates semantic id ${metadata.semanticId} from ${duplicate}`);
    else semanticIds.set(metadata.semanticId, record.name);
    if (metadata.handoffStatus === "blocked-by-coupling" && !metadata.safetyNotes.some((note) => /coupl|block|shared/i.test(note))) {
      pushError(errors, path, 1, `${record.name} blocked handoff must explain its coupling`);
    }
  }
}

function validateRelationalConstraints(records, contract, path, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const values = new Map();
  for (const record of records) {
    const value = resolveNumericDefault(record.name, byName);
    if (value) values.set(record.name, value);
  }
  const ids = new Set();
  for (const constraint of contract.relationalConstraints ?? []) {
    if (!constraint.id || ids.has(constraint.id)) pushError(errors, path, 1, `relational constraint id is missing or duplicated: ${constraint.id}`);
    ids.add(constraint.id);
    const names = constraint.kind === "minimum-sum"
      ? [constraint.target, ...(constraint.terms ?? []).map(({ token }) => token)]
      : constraint.tokens ?? [];
    for (const name of names) {
      if (!byName.has(name)) pushError(errors, path, 1, `${constraint.id} references missing token ${name}`);
      else if (!values.has(name)) pushError(errors, path, 1, `${constraint.id} cannot resolve numeric default for ${name}`);
    }
    if (names.some((name) => !values.has(name))) continue;
    if (constraint.kind === "ascending") {
      for (let index = 1; index < constraint.tokens.length; index += 1) {
        const previous = values.get(constraint.tokens[index - 1]);
        const current = values.get(constraint.tokens[index]);
        if (previous.unit !== current.unit || previous.value > current.value) {
          pushError(errors, path, 1, `${constraint.id} requires ${constraint.tokens[index - 1]} <= ${constraint.tokens[index]}`);
        }
      }
    } else if (constraint.kind === "minimum-sum") {
      const target = values.get(constraint.target);
      const terms = constraint.terms.map(({ token, multiplier = 1 }) => ({ value: values.get(token), multiplier }));
      if (terms.some(({ value }) => value.unit !== target.unit)) {
        pushError(errors, path, 1, `${constraint.id} mixes incompatible units`);
      } else {
        const minimum = terms.reduce((sum, { value, multiplier }) => sum + value.value * multiplier, 0);
        if (target.value < minimum) pushError(errors, path, 1, `${constraint.id} requires ${constraint.target} >= ${minimum}${target.unit}`);
      }
    } else {
      pushError(errors, path, 1, `${constraint.id} has unsupported relation kind ${constraint.kind}`);
    }
  }
}

function resolveNumericDefault(name, byName, seen = new Set()) {
  if (seen.has(name)) return null;
  const record = byName.get(name);
  if (!record) return null;
  const text = String(record.default ?? "").trim();
  const direct = parseCssNumber(text);
  if (direct) return direct;
  const alias = /^var\(\s*(--[a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:,[^)]+)?\)$/.exec(text);
  if (alias) return resolveNumericDefault(alias[1], byName, new Set(seen).add(name));
  const arithmetic = /^calc\(\s*var\(\s*(--[a-zA-Z_][a-zA-Z0-9_-]*)\s*\)\s*((?:[*/]\s*-?(?:\d+\.?\d*|\.\d+)\s*)+)\)$/.exec(text);
  if (arithmetic) {
    const base = resolveNumericDefault(arithmetic[1], byName, new Set(seen).add(name));
    if (!base) return null;
    let value = base.value;
    const operations = arithmetic[2].matchAll(/([*/])\s*(-?(?:\d+\.?\d*|\.\d+))/g);
    for (const [, operator, operandText] of operations) {
      const operand = Number(operandText);
      if (!Number.isFinite(operand) || (operator === "/" && operand === 0)) return null;
      value = operator === "*" ? value * operand : value / operand;
    }
    return { value, unit: base.unit };
  }
  return null;
}

function validateContrastPairs(records, contract, path, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const ids = new Set();
  for (const pair of contract.contrastPairs ?? []) {
    if (!pair.id || ids.has(pair.id)) pushError(errors, path, 1, `contrast pair id is missing or duplicated: ${pair.id}`);
    ids.add(pair.id);
    for (const name of [pair.foreground, pair.background]) {
      const record = byName.get(name);
      if (!record) pushError(errors, path, 1, `${pair.id} references missing token ${name}`);
      else if (record.type !== "color") pushError(errors, path, 1, `${pair.id} requires color token ${name}`);
    }
    if (!(pair.minimumRatio > 0) || !pair.review || !pair.usage) {
      pushError(errors, path, 1, `${pair.id} requires minimumRatio, usage, and review metadata`);
    }
  }
}

function validateAuthoringExclusions(records, contract, path, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const covered = new Set();
  for (const exclusion of contract.authoringExclusions ?? []) {
    if (!exclusion.id || !exclusion.reason || !Array.isArray(exclusion.tokens) || exclusion.tokens.length === 0) {
      pushError(errors, path, 1, "authoring exclusion requires id, tokens, and reason");
      continue;
    }
    for (const name of exclusion.tokens) {
      const record = byName.get(name);
      if (!record) pushError(errors, path, 1, `${exclusion.id} excludes missing token ${name}`);
      else if (record.class === "public") pushError(errors, path, 1, `${exclusion.id} may not exclude public token ${name}`);
      if (covered.has(name)) pushError(errors, path, 1, `${name} appears in more than one authoring exclusion`);
      covered.add(name);
    }
  }
}

function validateDependencyGraph(records, path, errors) {
  const byName = new Map(records.map((record) => [record.name, record]));
  const state = new Map();
  const visit = (name, stack) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      pushError(errors, path, 1, `style token dependency cycle: ${[...stack, name].join(" -> ")}`);
      return;
    }
    state.set(name, "visiting");
    for (const dependency of byName.get(name)?.dependencies ?? []) {
      if (byName.has(dependency)) visit(dependency, [...stack, name]);
    }
    state.set(name, "done");
  };
  for (const name of byName.keys()) visit(name, []);
}

function validateExpectedCounts(
  contract,
  cssTokens,
  runtimeOnlyTokens,
  externalTokens,
  inventoryTokens,
  path,
  errors,
) {
  const actual = { cssTokens, runtimeOnlyTokens, externalTokens, inventoryTokens };
  for (const [key, value] of Object.entries(actual)) {
    if (contract.expected?.[key] !== value) {
      pushError(errors, path, 1, `${key} drifted: expected ${contract.expected?.[key]}, found ${value}`);
    }
  }
}

function validateLegacyManifest(overlay, actual, idUnion, declarationsByName, paths, errors) {
  const frozen = overlay?.frozen ?? [];
  if (actual.length !== frozen.length) pushError(errors, paths.contract, 1, `legacy STYLE_TOKENS count drifted: expected ${frozen.length}, found ${actual.length}`);
  const count = Math.max(actual.length, frozen.length);
  for (let index = 0; index < count; index += 1) {
    if (actual[index]?.id !== frozen[index]?.id || actual[index]?.cssVar !== frozen[index]?.cssVar) {
      pushError(errors, paths.contract, 1, `legacy STYLE_TOKENS map/order drift at index ${index}`);
      break;
    }
  }
  validateUniqueLegacyField(actual, "id", paths.legacy, errors);
  validateUniqueLegacyField(actual, "cssVar", paths.legacy, errors);
  const unionGroups = groupBy(idUnion, ({ id }) => id);
  for (const [id, entries] of unionGroups) {
    if (entries.length > 1) pushError(errors, paths.legacy, entries[1].line, `duplicate StyleTokenId member ${id}`);
  }
  const actualIds = new Set(actual.map(({ id }) => id));
  const unionIds = new Set(idUnion.map(({ id }) => id));
  for (const token of actual) {
    if (!unionIds.has(token.id)) pushError(errors, paths.legacy, token.line, `STYLE_TOKENS id ${token.id} is absent from StyleTokenId`);
  }
  for (const entry of idUnion) {
    if (!actualIds.has(entry.id)) pushError(errors, paths.legacy, entry.line, `StyleTokenId ${entry.id} has no STYLE_TOKENS entry`);
  }

  const rootValues = new Map();
  for (const [name, declarations] of declarationsByName) {
    const rootDeclaration = declarations.find(({ selector }) => selector === ":root");
    if (rootDeclaration) rootValues.set(name, rootDeclaration.value);
  }
  for (const token of actual) {
    const canonical = resolveRootValue(token.cssVar, rootValues);
    if (canonical === null) {
      pushError(errors, paths.legacy, token.line, `${token.cssVar} has no resolvable canonical :root default`);
      continue;
    }
    const expected = typeof token.defaultValue === "number"
      ? `${token.defaultValue}${token.unit ?? ""}`
      : token.defaultValue;
    const defaultException = overlay.defaultExceptions?.[token.cssVar];
    if (defaultException) {
      if (!equivalentCssValues(expected, defaultException.legacyValue)) {
        pushError(errors, paths.contract, token.line, `${token.id} legacy default no longer matches its declared migration exception`);
      }
      if (!equivalentCssValues(canonical, defaultException.canonicalValue)) {
        pushError(errors, paths.contract, token.line, `${token.cssVar} canonical default no longer matches its declared migration exception`);
      }
      if (!defaultException.reason) pushError(errors, paths.contract, token.line, `${token.cssVar} migration exception requires a reason`);
    } else if (!equivalentCssValues(expected, canonical)) {
      pushError(errors, paths.legacy, token.line, `${token.id} default ${JSON.stringify(expected)} differs from canonical ${token.cssVar}: ${JSON.stringify(canonical)}`);
    }
    if (token.kind === "number") {
      if (token.min > token.max || token.step <= 0 || token.defaultValue < token.min || token.defaultValue > token.max) {
        pushError(errors, paths.legacy, token.line, `${token.id} has invalid min/max/step bounds`);
      }
    }
  }
}

function validateUniqueLegacyField(tokens, field, path, errors) {
  for (const [value, entries] of groupBy(tokens, (token) => token[field])) {
    if (entries.length > 1) pushError(errors, path, entries[1].line, `duplicate STYLE_TOKENS ${field} ${value}`);
  }
}

function collectCssDeclarations(source, path, root) {
  const clean = maskCssComments(source);
  const blocks = collectCssBlocks(clean);
  const declarations = [];
  const pattern = new RegExp(`^\\s*(${TOKEN_NAME_SOURCE})\\s*:\\s*([^;]+);?`, "gim");
  for (const match of clean.matchAll(pattern)) {
    const containing = blocks.filter(({ start, end }) => start <= match.index && match.index < end);
    const innermost = containing.at(-1);
    declarations.push({
      name: match[1],
      value: match[2].trim(),
      selector: innermost?.chain.join(" > ") ?? "<unknown>",
      path,
      relativePath: displayPath(root, path),
      line: lineAt(clean, match.index),
    });
  }
  return declarations;
}

function collectCssBlocks(source) {
  const blocks = [];
  const stack = [];
  let statementStart = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "{") {
      const header = source.slice(statementStart, index).trim().replace(/\s+/g, " ");
      const parent = stack.at(-1);
      const block = { header, start: index + 1, end: source.length, chain: [...(parent?.chain ?? []), header] };
      blocks.push(block);
      stack.push(block);
      statementStart = index + 1;
    } else if (character === "}") {
      const block = stack.pop();
      if (block) block.end = index;
      statementStart = index + 1;
    } else if (character === ";") {
      statementStart = index + 1;
    }
  }
  return blocks;
}

function parseLegacyTokens(source, path, root, errors) {
  const declaration = source.indexOf("export const STYLE_TOKENS");
  const equals = source.indexOf("=", declaration);
  const open = source.indexOf("[", equals);
  const close = findMatchingDelimiter(source, open, "[", "]");
  if (declaration < 0 || open < 0 || close < 0) {
    pushError(errors, path, 1, "unable to parse STYLE_TOKENS");
    return [];
  }
  const tokens = [];
  for (const span of findTopLevelObjectSpans(source, open + 1, close)) {
    const block = source.slice(span.start, span.end);
    const token = {
      id: readStringProperty(block, "id"),
      cssVar: readStringProperty(block, "cssVar"),
      kind: readStringProperty(block, "kind"),
      unit: readStringProperty(block, "unit") ?? "",
      defaultValue: readLiteralProperty(block, "defaultValue"),
      min: readNumberProperty(block, "min"),
      max: readNumberProperty(block, "max"),
      step: readNumberProperty(block, "step"),
      path: displayPath(root, path),
      line: lineAt(source, span.start),
    };
    if (!token.id || !token.cssVar || !token.kind || token.defaultValue === undefined) {
      pushError(errors, path, token.line, "STYLE_TOKENS entry has incomplete literal metadata");
    }
    if (token.kind === "number" && ![token.min, token.max, token.step].every(Number.isFinite)) {
      pushError(errors, path, token.line, `${token.id ?? "<unknown>"} lacks numeric bounds`);
    }
    tokens.push(token);
  }
  return tokens;
}

function parseLegacyIdUnion(source) {
  const declaration = source.indexOf("export type StyleTokenId");
  const equals = source.indexOf("=", declaration);
  const semicolon = source.indexOf(";", equals);
  if (declaration < 0 || equals < 0 || semicolon < 0) return [];
  return [...source.slice(equals + 1, semicolon).matchAll(/["']([^"']+)["']/g)].map((match) => ({
    id: match[1],
    line: lineAt(source, equals + 1 + match.index),
  }));
}

function collectReferences(cssSource, cssPath, sourceRecords, root, legacyReferenceRecords = []) {
  const references = [];
  const cleanCss = maskCssComments(cssSource);
  for (const match of cleanCss.matchAll(CSS_VAR_REFERENCE)) {
    references.push({ name: match[1], path: cssPath, line: lineAt(cleanCss, match.index) });
  }
  for (const record of sourceRecords) {
    for (const match of record.source.matchAll(CSS_VAR_REFERENCE)) {
      references.push({ name: match[1], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
    }
    for (const match of record.source.matchAll(TAILWIND_SHORTHAND)) {
      references.push({ name: match[1], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
    }
    for (const match of record.source.matchAll(EXACT_TOKEN_LITERAL)) {
      references.push({ name: match[2], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
    }
  }
  // Legacy editor modules contain every token name as inert metadata, so exact
  // literals in those files are not consumers. They can still contain genuine
  // CSS var/Tailwind uses that keep a public token live after other consumers
  // migrate to a more specific semantic role.
  for (const record of legacyReferenceRecords) {
    for (const match of record.source.matchAll(CSS_VAR_REFERENCE)) {
      references.push({ name: match[1], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
    }
    for (const match of record.source.matchAll(TAILWIND_SHORTHAND)) {
      references.push({ name: match[1], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
    }
  }
  return references;
}

function collectInlineProviders(sourceRecords, root) {
  const providers = [];
  const patterns = [
    new RegExp(`\\.setProperty\\s*\\(\\s*["'\\x60](${TOKEN_NAME_SOURCE})["'\\x60]`, "g"),
    new RegExp(`["'\\x60](${TOKEN_NAME_SOURCE})["'\\x60]\\s*:`, "g"),
  ];
  for (const record of sourceRecords) {
    for (const pattern of patterns) {
      for (const match of record.source.matchAll(pattern)) {
        providers.push({ name: match[1], path: record.path, line: lineAt(record.source, match.index), relativePath: displayPath(root, record.path) });
      }
    }
  }
  return providers;
}

function chooseBaseDeclaration(declarations) {
  return declarations.find(({ selector }) => selector === ":root")
    ?? declarations.find(({ selector }) => selector === "@theme inline")
    ?? declarations[0]
    ?? null;
}

function collectDependencies(value) {
  return uniqueSorted([...String(value).matchAll(CSS_VAR_REFERENCE)].map((match) => match[1]));
}

function inferTypeAndUnit(name, value, legacy) {
  if (legacy?.kind === "number") return { type: "number", unit: legacy.unit ?? "" };
  if (legacy?.kind === "color") return { type: "color", unit: "" };
  if (legacy?.kind === "font") return { type: "font-family", unit: "" };
  const text = String(value).trim();
  const numeric = /^-?(?:\d+\.?\d*|\.\d+)([a-z%]*)$/i.exec(text);
  if (numeric) return { type: "number", unit: numeric[1].toLowerCase() };
  if (/^(?:#[0-9a-f]+|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\(|transparent$|currentcolor$)/i.test(text)) {
    return { type: "color", unit: "" };
  }
  if (/font-(?:ui|text|heading|mono|symbols)$/.test(name)) return { type: "font-family", unit: "" };
  if (name.endsWith("-shadow")) return { type: "shadow", unit: "" };
  if (collectDependencies(text).length > 0) return { type: "unresolved", unit: "" };
  if (/(?:bg|text|color|frame|signs|angles|houses|housenums|peregrin|positions|table|dignity|aspect|stroke|rule|indicator|ring|seam|destructive|accent|surface|background)(?:-|$)/.test(name)) {
    return { type: "color", unit: "" };
  }
  return { type: "string", unit: "" };
}

function resolveDerivedTypes(records) {
  const byName = new Map(records.map((record) => [record.name, record]));
  for (let pass = 0; pass < records.length; pass += 1) {
    let changed = false;
    for (const record of records) {
      if (!["string", "unresolved"].includes(record.type) || record.dependencies.length === 0) continue;
      const dependency = record.dependencies
        .map((name) => byName.get(name))
        .find((entry) => entry && !["string", "unresolved"].includes(entry.type));
      if (!dependency) continue;
      record.type = dependency.type;
      record.unit = dependency.unit;
      changed = true;
    }
    if (!changed) break;
  }
}

function resolveRootValue(name, rootValues, seen = new Set()) {
  if (seen.has(name)) return null;
  const raw = rootValues.get(name);
  if (raw === undefined) return null;
  const alias = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(raw.trim());
  if (!alias) return raw.trim();
  return resolveRootValue(alias[1], rootValues, new Set(seen).add(name)) ?? alias[2]?.trim() ?? null;
}

function equivalentCssValues(left, right) {
  const leftColor = parseCssColor(left);
  const rightColor = parseCssColor(right);
  if (leftColor && rightColor) return leftColor === rightColor;
  const leftNumber = parseCssNumber(left);
  const rightNumber = parseCssNumber(right);
  if (leftNumber && rightNumber) {
    return leftNumber.unit === rightNumber.unit && Math.abs(leftNumber.value - rightNumber.value) < 1e-9;
  }
  return normalizeCssText(left) === normalizeCssText(right);
}

function parseCssColor(value) {
  const text = normalizeCssText(value).toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = [...digits].map((digit) => `${digit}${digit}`).join("");
    if (digits.length === 6) digits += "ff";
    return `${parseInt(digits.slice(0, 2), 16)},${parseInt(digits.slice(2, 4), 16)},${parseInt(digits.slice(4, 6), 16)},${parseInt(digits.slice(6, 8), 16) / 255}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+))?\s*\)$/.exec(text);
  return rgb ? `${Number(rgb[1])},${Number(rgb[2])},${Number(rgb[3])},${rgb[4] === undefined ? 1 : Number(rgb[4])}` : null;
}

function parseCssNumber(value) {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(String(value).trim());
  return match ? { value: Number(match[1]), unit: match[2].toLowerCase() } : null;
}

function normalizeCssText(value) {
  return String(value).trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",");
}

function matchesAny(name, patterns = []) {
  return patterns.some((pattern) => new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, "[a-z0-9-]*")}$`).test(name));
}

function escapeRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "\\*");
}

function readJson(path, errors) {
  const source = readText(path, errors);
  if (source === null) return null;
  try { return JSON.parse(source); }
  catch (error) { pushError(errors, path, 1, `invalid JSON: ${error.message}`); return null; }
}

function mergeStyleContractExtension(contract, extension, path, errors) {
  if (extension.schemaVersion !== 1) {
    pushError(errors, path, 1, `unsupported renderer style contract version ${extension.schemaVersion}`);
  }
  for (const field of ["families", "overrides", "relationalConstraints", "contrastPairs", "authoringExclusions"]) {
    const values = extension[field] ?? [];
    if (!Array.isArray(values)) {
      pushError(errors, path, 1, `${field} must be an array`);
      continue;
    }
    contract[field] = [...(contract[field] ?? []), ...values];
  }
  if (!extension.publicTokens || typeof extension.publicTokens !== "object") {
    pushError(errors, path, 1, "publicTokens must be an object");
    return;
  }
  contract.publicTokens ??= {};
  for (const [name, metadata] of Object.entries(extension.publicTokens)) {
    if (contract.publicTokens[name]) {
      pushError(errors, path, 1, `renderer public token duplicates ${name}`);
      continue;
    }
    contract.publicTokens[name] = metadata;
  }
}

function readText(path, errors) {
  try { return readFileSync(path, "utf8").replace(/\r\n?/g, "\n"); }
  catch (error) { pushError(errors, path, 1, `unable to read: ${error.message}`); return null; }
}

function listSourceFiles(directory) {
  const paths = [];
  const extensions = [".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...listSourceFiles(path));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) paths.push(path);
  }
  return paths.sort();
}

function maskCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function maskTypeScriptNoise(source) {
  const output = [...source];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      maskRange(output, source, index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      maskRange(output, source, index, end);
      index = end;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const end = findStringEnd(source, index, character);
      const block = source.slice(index, end);
      const context = source.slice(Math.max(0, index - 100), index);
      const isSrcDoc = /\bsrcDoc\s*=\s*\{?\s*$/.test(context);
      const isHtml = /<(?:!doctype|html|head|body|style|script|div|svg)\b/i.test(block);
      if (isHtml || (isSrcDoc && /</.test(block))) maskRange(output, source, index, end);
      index = end;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function findStringEnd(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") { index += 2; continue; }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function maskRange(output, source, start, end) {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") output[index] = " ";
  }
}

function findTopLevelObjectSpans(source, start, end) {
  const spans = [];
  let depth = 0;
  let objectStart = -1;
  for (let index = start; index < end; index += 1) {
    if (source[index] === "{") { if (depth === 0) objectStart = index; depth += 1; }
    else if (source[index] === "}" && --depth === 0 && objectStart >= 0) { spans.push({ start: objectStart, end: index + 1 }); objectStart = -1; }
  }
  return spans;
}

function findMatchingDelimiter(source, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) { if (character === "\\") index += 1; else if (character === quote) quote = null; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return -1;
}

function readStringProperty(block, name) {
  return new RegExp(`\\b${name}\\s*:\\s*(["'])([^"']+)\\1`).exec(block)?.[2];
}

function readNumberProperty(block, name) {
  const value = new RegExp(`\\b${name}\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(block)?.[1];
  return value === undefined ? undefined : Number(value);
}

function readLiteralProperty(block, name) {
  const match = new RegExp(`\\b${name}\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|-?(?:\\d+\\.?\\d*|\\.\\d+))`).exec(block);
  if (!match) return undefined;
  if (match[1].startsWith('"')) return JSON.parse(match[1]);
  if (match[1].startsWith("'")) return match[1].slice(1, -1);
  return Number(match[1]);
}

function groupBy(values, key) {
  const groups = new Map();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}

function uniqueSorted(values, comparator) {
  return [...new Set(values)].sort(comparator);
}

function selectorSort(left, right) {
  if (left === ":root") return right === ":root" ? 0 : -1;
  if (right === ":root") return 1;
  return left.localeCompare(right);
}

function lineAt(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function displayPath(root, path) {
  const rendered = relative(root, path);
  return rendered && !rendered.startsWith("..") ? rendered.split(sep).join("/") : path;
}

function pushError(errors, path, line, message) {
  errors.push({ path, line: Math.max(1, line || 1), message });
}
