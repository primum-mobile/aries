// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Phone layout rules: the wheel is the
// largest square the chart pane allows and nothing reserves height out of it;
// the phone keeps one top bar and one bottom bar.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(path) {
  return readFileSync(join(frontendRoot, path), "utf8").replace(/\r\n?/g, "\n");
}

function cssBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `globals.css must declare ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function pxDeclaration(block, property) {
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*(\\d+)px;`));
  assert.ok(match, `expected a px ${property} in ${block.split("\n")[0]}`);
  return Number(match[1]);
}

const css = readSource("src/app/globals.css");
const workspace = readSource("src/components/workshell/workspace-content.tsx");

test("the phone wheel is the largest square of its pane, never inset by the chart facts", () => {
  const host = cssBlock(css, ".aries-mobile-chart");
  assert.match(host, /container-type: size;/);
  assert.match(host, /overflow-y: auto;/);
  const wheel = cssBlock(css, ".aries-mobile-chart-wheel");
  assert.match(wheel, /\n\s*width: min\(100cqw, 100cqh\);/);
  assert.match(wheel, /\n\s*height: min\(100cqw, 100cqh\);/);
  assert.match(wheel, /flex: none;/);

  const phone = workspace.slice(workspace.indexOf("  if (mobile) {\n    // Phone: the wheel"));
  assert.match(
    phone,
    /<div className="aries-mobile-chart-wheel">\{canvas\}<\/div>\s*<div className="aries-mobile-chart-facts">/,
    "the wheel box holds only the canvas and the facts follow it in flow",
  );
  assert.equal(existsSync(join(frontendRoot, "src/components/workshell/chart-overlay-bands.ts")), false);
  assert.doesNotMatch(workspace, /useOverlayBandInsets|data-aries-overlay-band/);
});

test("a scrolled phone wheel is never constrained by the title bar", () => {
  const canvas = readSource("src/components/workshell/chart-canvas.tsx");
  for (const name of ["chartTitlebarCollisionBounds", "chartTitlebarTopBoundary"]) {
    const body = canvas.slice(canvas.indexOf(`function ${name}(`));
    assert.match(body.slice(0, 200), /if \(mobileLayoutMatches\(\)\) return (?:null|0);/, name);
  }
});

test("the phone stepping controls live in the bottom bar, not a rail above it", () => {
  assert.match(workspace, /\{navSlot \? createPortal\(rail, navSlot\) : null\}/);
  assert.match(
    readSource("src/components/workshell/mobile-workspace-nav.tsx"),
    /<div ref=\{setMobileNavSlot\} className="aries-mobile-nav-slot" \/>/,
  );
  const pane = cssBlock(css, "html[data-aries-mobile] [data-workspace-focus-anchor]");
  assert.match(pane, /grid-template-rows: minmax\(0, 1fr\);/, "the chart pane has no second row");
  assert.doesNotMatch(cssBlock(css, ".aries-mode-hint--mobile"), /grid-row/);
});

test("phone bars stay within the chrome budget", () => {
  const titlebar = pxDeclaration(cssBlock(css, "html[data-aries-mobile]"), "--titlebar-h");
  const navButton = pxDeclaration(cssBlock(css, ".aries-mobile-nav-button"), "min-height");
  // One 44 px touch row plus breathing room per bar; safe-area insets come on top.
  assert.ok(titlebar <= 48, `phone title bar is ${titlebar}px`);
  assert.ok(navButton <= 50, `phone bottom bar is ${navButton}px`);
  assert.ok(titlebar >= 44 && navButton >= 44, "bars keep 44 px touch targets");
});
