// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(frontendRoot, "src");
const forbiddenLiterals = [
  {
    label: "raw compact typography",
    pattern: /\btext-\[(?:9|10|11|12|13|14)px\]/g,
  },
  {
    label: "raw compact radius",
    pattern: /\brounded-\[(?:2|3|4|5|6)px\]/g,
  },
  {
    label: "raw segmented-control inset",
    pattern: /\bp-\[2px\]/g,
  },
  {
    label: "hardcoded symbol font",
    pattern: /\bfontFamily:\s*["'`]AriesMorinus["'`]/g,
  },
];

test("compact React design literals use semantic style tokens", () => {
  const violations = [];

  for (const filePath of walkTypeScript(sourceRoot)) {
    const source = readFileSync(filePath, "utf8");
    for (const { label, pattern } of forbiddenLiterals) {
      for (const match of source.matchAll(pattern)) {
        violations.push(
          `${relative(frontendRoot, filePath)}:${lineNumberAt(source, match.index)} ${label}: ${match[0]}`,
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `replace compact React literals with the corresponding semantic --aries-* token or font-symbols utility:\n${violations.join("\n")}`,
  );
});

test("aspect-matrix, Astrolabe, and sidebar wrappers keep layout literals behind tokens", () => {
  const targets = [
    {
      path: "src/components/workshell/aspect-matrix-view.tsx",
      pattern: /const\s+(?:CELL|STAR_RAIL)\s*=|(?:p-4|text-\[19px\]|inset-\[3px\]|border-\[5px\]|left-\[7px\]|top-\[5px\]|right-\[4px\]|bottom-\[4px\])/g,
    },
    {
      path: "src/components/workshell/astrolabe-view.tsx",
      pattern: /(?:gap-1\.5|px-3|py-1\.5|px-2|py-0\.5|var\(--primary,)/g,
    },
    {
      path: "src/components/workshell/app-sidebar.tsx",
      pattern: /depth\s*\*\s*12|(?:h-0\.5|-top-px|-bottom-px|size-1\.5|right-1\.5|\bh-5\b|\bw-5\b|\bsize-3\b)/g,
    },
  ];
  const violations = targets.flatMap(({ path, pattern }) => {
    const source = readFileSync(resolve(frontendRoot, path), "utf8");
    return [...source.matchAll(pattern)].map(
      (match) => `${path}:${lineNumberAt(source, match.index)} fixed wrapper geometry: ${match[0]}`,
    );
  });

  assert.deepEqual(
    violations,
    [],
    `replace restored wrapper literals with their public geometry roles:\n${violations.join("\n")}`,
  );
});

function walkTypeScript(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...walkTypeScript(path));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function lineNumberAt(source, index = 0) {
  return source.slice(0, index).split("\n").length;
}
