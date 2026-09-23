// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const registry = await readFile(new URL('../src/lib/chart/wheel-ring-archetypes.json', import.meta.url), 'utf8');
const factories = await readFile(new URL('../src/lib/chart/wheel-factory-v1.json', import.meta.url), 'utf8');
const source = (await readFile(new URL('../src/lib/chart/wheel-composition.ts', import.meta.url), 'utf8'))
  .replace(/import registry from [^;]+;/, `const registry = ${registry};`)
  .replace(/import factorySettings from [^;]+;/, `const factorySettings = ${factories};`);
export const compositionModuleUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText).toString('base64')}`;
