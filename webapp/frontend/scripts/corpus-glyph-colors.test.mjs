// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

async function load(path, deps = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const api = {exports: {}};
  new Function('require', 'exports', js)((id) => {
    assert.ok(id in deps, id); return deps[id];
  }, api.exports);
  return api.exports;
}
const semantic = await load('../src/lib/theme/semantic-color.ts');
const { CorpusGlyph, CorpusSignColorModeContext } = await load(
  '../src/components/workshell/corpus-glyph.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime,
    '@/lib/theme/semantic-color': semantic,
  },
);
const colors = {
  plain: {colour: [21, 22, 23], colourRole: '--morinus-signs'},
  element: {colour: [61, 62, 63], colourRole: '--morinus-element-water'},
};
const render = (mode, paint = colors) => renderToStaticMarkup(
  React.createElement(CorpusSignColorModeContext.Provider, {value: mode},
    React.createElement(CorpusGlyph, {text: 'h', colors: paint, className: 'reading-glyph'})),
);

test('the same retained glyph switches between live uniform and element roles', () => {
  const plain = render(false), element = render(true);
  assert.match(plain, /color:var\(--morinus-signs, rgb\(21, 22, 23\)\)/);
  assert.match(element, /color:var\(--morinus-element-water, rgb\(61, 62, 63\)\)/);
  for (const markup of [plain, element]) {
    assert.match(markup, /font-family:&#x27;AriesMorinus&#x27;/);
    assert.match(markup, /class="reading-glyph"/);
    assert.match(markup, />h<\/span>/);
  }
});

test('non-sign symbols and older payloads inherit the surrounding prose color', () => {
  for (const mode of [false, true]) {
    assert.doesNotMatch(render(mode, null), /color:/);
  }
});

test('black and white glyphs keep their explicit color without a palette role', () => {
  const black = {colour: [0, 0, 0], colourRole: null};
  for (const mode of [false, true]) {
    const markup = render(mode, {plain: black, element: black});
    assert.match(markup, /color:rgb\(0, 0, 0\)/);
    assert.doesNotMatch(markup, /var\(/);
  }
});
