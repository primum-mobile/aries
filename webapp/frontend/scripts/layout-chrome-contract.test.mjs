// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { buildStyleTokenInventory } from "./style-token-contract.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(frontendRoot, "src");

function readSource(path) {
  return readFileSync(join(frontendRoot, path), "utf8");
}

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function assertConsumes(path, tokenNames) {
  const source = readSource(path);
  for (const name of tokenNames) {
    assert.ok(source.includes(`var(${name})`), `${path} must consume ${name}`);
  }
}

const NON_CONTROL_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "hidden",
  "button",
  "submit",
  "reset",
  "image",
]);

function jsxStringAttribute(element, name) {
  const attribute = element.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) {
    return null;
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  return null;
}

function assertMountedFormControlsDeclareAppearance(
  path,
  { checkDensity = true, requireControls = true } = {},
) {
  const source = readSource(path);
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const controls = [];
  const failures = [];
  const fixedDensityPatterns = [
    /(?:^|[\s"'`])h-\d+(?:\.\d+)?\b/,
    /\b(?:p|px|py)-\d+(?:\.\d+)?\b/,
    /\btext-(?:xs|sm|base|lg|xl)\b/,
    /\brounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?\b(?!-\[)/,
  ];

  const visit = (node) => {
    if (
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxOpeningElement(node)
    ) {
      const tagName = node.tagName.getText(sourceFile);
      if (tagName === "input" || tagName === "select" || tagName === "textarea") {
        const inputType = jsxStringAttribute(node, "type")?.toLowerCase() ?? "";
        if (tagName !== "input" || !NON_CONTROL_INPUT_TYPES.has(inputType)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          const location = `${path}:${line + 1}`;
          controls.push(location);
          const appearance = jsxStringAttribute(
            node,
            "data-aries-control-appearance",
          );
          const surface = jsxStringAttribute(node, "data-aries-surface");
          const openingSource = source.slice(
            node.getStart(sourceFile),
            node.getEnd(),
          );
          if (appearance === "local" && surface != null) {
            failures.push(
              `${location} local controls must not also declare a generic material surface`,
            );
          } else if (appearance !== "local" && surface !== "control") {
            failures.push(`${location} must declare data-aries-surface="control"`);
          }
          if (appearance === "local" && !openingSource.includes("className=")) {
            failures.push(`${location} local controls must declare their appearance class`);
          }
          if (checkDensity) {
            for (const pattern of fixedDensityPatterns) {
              if (pattern.test(openingSource)) {
                failures.push(`${location} bypasses control density with ${pattern}`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (requireControls) {
    assert.ok(controls.length > 0, `${path} must contain mounted form controls`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  return controls.length;
}

test("the live inventory exposes the bounded chrome-layout authoring surface", () => {
  // Build from current CSS and source declarations. Generated inventory counts
  // are intentionally not read here: this contract must catch wiring drift even
  // before the generated handoff artifacts are refreshed.
  const result = buildStyleTokenInventory(frontendRoot);
  assert.deepEqual(result.errors, []);
  assert.ok(result.inventory, "the live style inventory must build");
  assert.ok(result.publicManifest, "the live public manifest must build");

  const publicBySemanticId = new Map(
    result.publicManifest.tokens.map((token) => [token.semanticId, token]),
  );
  const expected = new Map([
    ["app.radius.base", "--aries-radius-md"],
    ["app.control.height", "--aries-control-height"],
    ["app.control.gap", "--aries-control-gap"],
    ["app.control.paddingInline", "--aries-control-padding-x"],
    ["app.control.paddingBlock", "--aries-control-padding-y"],
    ["app.tabs.gap", "--aries-tabs-gap"],
    ["app.tabs.listPadding", "--aries-tabs-list-padding"],
    ["app.tabs.indicatorSize", "--aries-tabs-indicator-size"],
    ["app.tabs.indicatorOffset", "--aries-tabs-indicator-offset"],
    ["app.tabs.railWidth", "--aries-tabs-rail-width"],
    ["app.tabs.railGap", "--aries-tabs-rail-gap"],
    ["app.dialog.padding", "--aries-dialog-padding"],
    ["app.dialog.contentGap", "--aries-dialog-gap"],
    ["app.dialog.headerGap", "--aries-dialog-header-gap"],
    ["app.dialog.footerGap", "--aries-dialog-footer-gap"],
    ["app.dialog.closeInset", "--aries-dialog-close-inset"],
    ["app.dialog.mapActionMinWidth", "--aries-dialog-map-action-min-width"],
    ["app.dialog.listMaxHeight", "--aries-dialog-list-max-height"],
    ["app.menu.padding", "--aries-menu-padding"],
    ["app.menu.quickOptionsWidth", "--aries-menu-quick-width"],
    ["app.menu.quickOptionsMaxHeight", "--aries-menu-quick-max-height"],
    ["app.menu.quickOptionsViewportMaxHeight", "--aries-menu-quick-viewport-max-height"],
    ["app.menu.commandListMaxHeight", "--aries-menu-command-max-height"],
    ["app.menu.contextPopupMinWidth", "--aries-menu-context-popup-min-width"],
    ["app.menu.dropdownMinWidth", "--aries-menu-dropdown-min-width"],
    ["app.menu.dropdownSubmenuMinWidth", "--aries-menu-dropdown-submenu-min-width"],
    ["app.menu.popupSideOffset", "--aries-menu-popup-side-offset"],
    ["app.menu.popupAlignOffset", "--aries-menu-popup-align-offset"],
    ["app.menu.contextSideOffset", "--aries-menu-context-side-offset"],
    ["app.menu.contextAlignOffset", "--aries-menu-context-align-offset"],
    ["app.menu.submenuSideOffset", "--aries-menu-submenu-side-offset"],
    ["app.menu.submenuAlignOffset", "--aries-menu-submenu-align-offset"],
    ["app.menu.pickerSideOffset", "--aries-menu-picker-side-offset"],
    ["app.spotlight.dialogTop", "--aries-spotlight-dialog-top"],
    ["app.sash.ruleSize", "--aries-sash-rule-size"],
    ["app.sash.idleColor", "--aries-sash-idle-color"],
    ["app.sash.hoverColor", "--aries-sash-hover-color"],
    ["app.sash.activeColor", "--aries-sash-active-color"],
    ["app.sash.panelIdleColor", "--aries-sash-panel-idle-color"],
    ["app.sash.panelHoverColor", "--aries-sash-panel-hover-color"],
    ["app.sash.panelActiveColor", "--aries-sash-panel-active-color"],
    ["app.panel.paddingInline", "--aries-panel-padding-x"],
    ["app.panel.paddingBlock", "--aries-panel-padding-y"],
    ["app.panel.sectionGap", "--aries-section-gap"],
    ["app.control.segmented.itemMinWidth", "--aries-segmented-control-item-min-width"],
    ["app.control.segmented.itemRadius", "--aries-segmented-control-item-radius"],
    ["app.list.dense.rowHeight", "--aries-list-row-height-dense"],
    ["app.list.standard.rowHeight", "--aries-list-row-height-standard"],
    ["app.list.symbolic.rowHeight", "--aries-list-row-height-symbolic"],
    ["app.pane.header.paddingInline", "--aries-pane-header-padding-x"],
    ["app.pane.ruleSize", "--aries-pane-rule-size"],
    ["app.notes.padding", "--aries-notes-padding"],
    ["app.sheet.padding", "--aries-sheet-padding"],
    ["app.inspector.layout.paddingInline", "--aries-inspector-padding-x"],
    ["app.inspector.headingGap", "--aries-inspector-heading-gap"],
    ["app.inspector.cardGap", "--aries-inspector-card-gap"],
    ["app.inspector.citationGap", "--aries-inspector-citation-gap"],
    ["app.inspector.cardPaddingInline", "--aries-inspector-card-padding-x"],
    ["app.inspector.cardPaddingBlock", "--aries-inspector-card-padding-y"],
    ["app.inspector.controlHeight", "--aries-inspector-control-height"],
    ["app.inspector.type.titleSize", "--aries-inspector-title-size"],
    ["app.inspector.color.title", "--aries-inspector-title-color"],
    ["app.inspector.color.value", "--aries-inspector-value-color"],
    ["app.inspector.color.label", "--aries-inspector-label-color"],
    ["app.sidebar.sectionHeaderHeight", "--aries-sidebar-section-header-height"],
    ["app.typography.titlebarSize", "--aries-font-size-titlebar"],
    ["app.typography.statusbarSize", "--aries-font-size-statusbar"],
    ["app.typography.sidebarNavigationSize", "--aries-font-size-nav"],
    ["app.typography.sidebarSectionSize", "--aries-font-size-nav-section"],
    ["app.shell.statusbarNameWidth", "--aries-statusbar-name-width"],
    ["app.shell.statusbarKindWidth", "--aries-statusbar-kind-width"],
    ["app.shell.statusbarDatetimeGrow", "--aries-statusbar-datetime-grow"],
    ["app.shell.statusbarDetailGrow", "--aries-statusbar-detail-grow"],
    ["app.shell.titlebarPaddingInline", "--aries-titlebar-padding-x"],
    ["app.shell.titlebarTitlePaddingInline", "--aries-titlebar-title-padding-x"],
    ["app.shell.titlebarClusterGap", "--aries-titlebar-cluster-gap"],
  ]);

  for (const [semanticId, cssVar] of expected) {
    const token = publicBySemanticId.get(semanticId);
    assert.equal(token?.cssVar, cssVar, `${semanticId} must remain a public layout role`);
    assert.equal(token?.scope, "app", `${semanticId} must remain app-scoped`);
    assert.equal(token?.handoffStatus, "editable", `${semanticId} must remain editable`);
  }
});

test("the expanded radius scale is derived from one base and projected to Tailwind", () => {
  const { inventory } = buildStyleTokenInventory(frontendRoot);
  const byName = new Map(inventory.tokens.map((token) => [token.name, token]));
  const radiusXl = byName.get("--aries-radius-xl");
  assert.equal(radiusXl?.class, "derived");
  assert.deepEqual(radiusXl?.dependencies, ["--aries-radius-md"]);
  assert.match(radiusXl?.default ?? "", /^calc\(var\(--aries-radius-md\).+\)$/);

  const tailwindRadiusXl = byName.get("--radius-xl");
  assert.equal(tailwindRadiusXl?.class, "derived");
  assert.equal(tailwindRadiusXl?.default, "var(--aries-radius-xl)");
  assert.deepEqual(tailwindRadiusXl?.selectors, ["@theme inline"]);
});

test("TypeScript chrome cannot reintroduce subtractive or capped radius formulas", () => {
  const forbidden = [
    /(?:min|max)\(\s*var\(\s*--(?:aries-)?radius-[^)]+\)[^)]*\)/g,
    /calc\(\s*var\(\s*--(?:aries-)?radius-[^)]+\)\s*-\s*/g,
    /max\(\s*0(?:px)?\s*,\s*(?:calc\()?\s*var\(\s*--(?:aries-)?radius-[^)]+\)\s*-\s*/g,
  ];
  const failures = [];
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    for (const pattern of forbidden) {
      for (const match of source.matchAll(pattern)) {
        failures.push(`${relative(frontendRoot, path)}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(failures, [], `radius formulas must derive in CSS:\n${failures.join("\n")}`);
});

test("shared chrome primitives consume semantic layout variables", () => {
  assertConsumes("src/components/ui/tabs.tsx", [
    "--aries-tabs-gap",
    "--aries-tabs-list-padding",
    "--aries-tabs-indicator-size",
    "--aries-tabs-indicator-offset",
    "--aries-control-gap-compact",
    "--aries-control-icon-size-default",
    "--aries-font-size-control",
  ]);
  assertConsumes("src/components/workshell/settings-dialog.tsx", [
    "--aries-tabs-rail-width",
    "--aries-tabs-rail-gap",
  ]);
  assertConsumes("src/components/ui/dialog.tsx", [
    "--aries-radius-dialog",
    "--aries-dialog-padding",
    "--aries-dialog-gap",
    "--aries-dialog-header-gap",
    "--aries-dialog-footer-gap",
    "--aries-dialog-close-inset",
  ]);
  assertConsumes("src/components/ui/button.tsx", [
    "--aries-radius-ui-control",
    "--aries-control-height",
    "--aries-control-gap",
    "--aries-control-padding-x",
    "--aries-font-size-base",
    "--aries-font-size-reading",
  ]);
  assertConsumes("src/components/ui/input.tsx", [
    "--aries-radius-ui-control",
    "--aries-control-height",
    "--aries-control-padding-x",
    "--aries-control-padding-y",
  ]);
  assertConsumes("src/components/ui/textarea.tsx", [
    "--aries-radius-ui-control",
    "--aries-control-textarea-min-height",
    "--aries-control-padding-x",
    "--aries-form-field-gap",
    "--aries-font-size-control",
  ]);
  assertConsumes("src/components/ui/input-group.tsx", [
    "--aries-control-height",
    "--aries-control-height-compact",
    "--aries-control-gap",
    "--aries-control-padding-x",
    "--aries-form-field-gap",
    "--aries-font-size-control",
  ]);
  assertConsumes("src/components/ui/tooltip.tsx", [
    "--aries-radius-popover",
    "--aries-control-tooltip-arrow-size",
    "--aries-control-gap",
    "--aries-control-padding-x",
    "--aries-control-padding-y",
    "--aries-font-size-small",
  ]);
  assert.ok(
    readSource("src/components/ui/tooltip.tsx").includes(
      "--aries-control-tooltip-side-offset",
    ),
    "tooltip positioning must resolve the active density offset",
  );
  assertConsumes("src/components/workshell/settings-dialog.tsx", [
    "--aries-section-gap",
    "--aries-dialog-padding",
    "--aries-control-height-micro",
    "--aries-control-height-compact",
    "--aries-control-height-small",
    "--aries-form-field-gap",
  ]);
  for (const path of [
    "src/components/ui/context-menu.tsx",
    "src/components/ui/dropdown-menu.tsx",
  ]) {
    assertConsumes(path, [
      "--aries-radius-popover",
      "--aries-radius-menu-item",
      "--aries-menu-padding",
      "--aries-menu-item-gap",
      "--aries-menu-item-padding-x",
      "--aries-menu-item-padding-y",
      "--aries-menu-separator-gap",
      "--aries-menu-indicator-inset",
    ]);
  }
  assertConsumes("src/components/ui/command.tsx", [
    "--aries-radius-dialog",
    "--aries-radius-menu-item",
    "--aries-control-height",
    "--aries-control-padding-x-compact",
    "--aries-menu-padding",
    "--aries-menu-command-max-height",
    "--aries-menu-label-padding-x",
    "--aries-menu-label-padding-y",
    "--aries-menu-item-gap",
    "--aries-menu-item-padding-x",
    "--aries-menu-item-padding-y",
    "--aries-menu-icon-size",
    "--aries-spotlight-dialog-top",
    "--aries-font-size-control",
    "--aries-font-size-small",
  ]);
  assertConsumes("src/components/workshell/titlebar-options-menu.tsx", [
    "--aries-menu-quick-width",
    "--aries-menu-quick-max-height",
    "--aries-menu-quick-viewport-max-height",
    "--aries-menu-label-padding-x",
    "--aries-menu-label-padding-y",
    "--aries-font-size-small",
  ]);
  for (const [path, tokens] of [
    [
      "src/components/ui/dropdown-menu.tsx",
      [
        "--aries-menu-dropdown-min-width",
        "--aries-menu-dropdown-submenu-min-width",
        "--aries-menu-popup-side-offset",
        "--aries-menu-popup-align-offset",
        "--aries-menu-submenu-side-offset",
        "--aries-menu-submenu-align-offset",
      ],
    ],
    [
      "src/components/ui/context-menu.tsx",
      [
        "--aries-menu-context-popup-min-width",
        "--aries-menu-context-side-offset",
        "--aries-menu-context-align-offset",
        "--aries-menu-submenu-side-offset",
      ],
    ],
    [
      "src/components/workshell/chart-style-panel.tsx",
      ["--aries-menu-popup-side-offset"],
    ],
    [
      "src/components/workshell/style-lab-color-picker.tsx",
      ["--aries-menu-picker-side-offset"],
    ],
  ]) {
    const source = readSource(path);
    for (const token of tokens) {
      assert.ok(source.includes(token), `${path} must resolve ${token}`);
    }
  }
  assertConsumes("src/components/ui/resizable.tsx", [
    "--aries-sash-rule-size",
    "--aries-sash-panel-idle-color",
    "--aries-sash-panel-hover-color",
    "--aries-sash-panel-active-color",
  ]);
  for (const path of [
    "src/components/workshell/sidebar-sash.tsx",
    "src/components/workshell/workspace-content.tsx",
  ]) {
    assertConsumes(path, [
      "--aries-sash-rule-size",
      "--aries-sash-idle-color",
      "--aries-sash-active-color",
    ]);
  }
  assertConsumes("src/lib/list-tokens.ts", [
    "--aries-pane-header-padding-x",
    "--aries-pane-header-compact-padding-x",
    "--aries-pane-control-gap-x",
    "--aries-pane-control-compact-gap-x",
    "--aries-pane-title-gap",
    "--aries-pane-state-padding",
  ]);
  assertConsumes("src/components/ui/separator.tsx", ["--aries-pane-rule-size"]);
  assertConsumes("src/components/ui/sheet.tsx", [
    "--aries-sheet-padding",
    "--aries-sheet-content-gap",
    "--aries-sheet-close-inset",
    "--aries-sheet-header-gap",
    "--aries-sheet-footer-gap",
  ]);
  assertConsumes("src/components/workshell/notes-panel.tsx", [
    "--aries-notes-padding",
    "--aries-notes-gap",
    "--aries-notes-header-gap",
  ]);
  assertConsumes("src/components/workshell/inspector-panel.tsx", [
    "--aries-inspector-title-size",
    "--aries-inspector-glyph-size",
    "--aries-inspector-padding-x",
    "--aries-inspector-section-gap",
    "--aries-inspector-label-width",
    "--aries-inspector-title-color",
    "--aries-inspector-value-color",
    "--aries-inspector-label-color",
    "--aries-inspector-divider-color",
    "--aries-inspector-background",
  ]);
  assertConsumes("src/components/workshell/astrolabe-view.tsx", [
    "--aries-pane-header-compact-padding-x",
    "--aries-pane-header-compact-padding-y",
    "--aries-control-gap",
    "--aries-control-padding-x-compact",
    "--aries-segmented-control-padding",
    "--aries-radius-control-compact",
    "--aries-text-primary",
    "--aries-text-muted",
    "--aries-surface",
  ]);
  assertConsumes("src/components/workshell/app-sidebar.tsx", [
    "--aries-sidebar-section-header-height",
    "--aries-sidebar-group-padding-start",
    "--aries-sidebar-group-padding-end",
    "--aries-sidebar-tree-indent",
    "--aries-sidebar-drop-indicator-size",
    "--aries-sidebar-drop-indicator-overhang",
    "--aries-sidebar-trailing-inset",
    "--aries-sidebar-unsaved-indicator-size",
    "--aries-sidebar-close-inset",
    "--aries-sidebar-close-action-size",
    "--aries-sidebar-action-icon-size",
  ]);
});

test("generic form and tooltip primitives do not bypass the density contract", () => {
  const forbiddenByFile = new Map([
    [
      "src/components/ui/tooltip.tsx",
      [/\bgap-1\.5\b/, /\bpx-3\b/, /\bpy-1\.5\b/, /\btext-xs\b/, /\bsize-2\.5\b/, /sideOffset\s*=\s*4/],
    ],
    [
      "src/components/ui/textarea.tsx",
      [/\bmin-h-16\b/, /\bpx-2\.5\b/, /\bpy-2\b/, /\btext-base\b/, /\btext-sm\b/],
    ],
    [
      "src/components/ui/input-group.tsx",
      [/\bh-6\b/, /\bsize-6\b/, /\bsize-8\b/, /\bgap-2\b/, /\bpx-2\.5\b/, /\bpy-2\b/, /\btext-sm\b/],
    ],
    [
      "src/components/workshell/settings-dialog.tsx",
      [/\bh-[567]\b/, /\bpt-4\b/, /\bpb-3\b/, /\bpx-4\b/],
    ],
    [
      "src/components/ui/command.tsx",
      [/\bp-1\b/, /\bpx-2\b/, /\bpy-1\.5\b/, /\bgap-2\b/, /\btext-sm\b/, /\btext-xs\b/, /\bmax-h-72\b/, /\bsize-4\b/],
    ],
    [
      "src/components/workshell/titlebar-options-menu.tsx",
      [/\bw-72\b/, /\bpx-1\.5\b/, /\bpy-1\b/, /\btext-xs\b/, /76vh/, /620px/],
    ],
  ]);
  const failures = [];
  for (const [path, patterns] of forbiddenByFile) {
    const source = readSource(path);
    for (const pattern of patterns) {
      if (pattern.test(source)) failures.push(`${path}: ${pattern}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `shared density consumers must use active profile roles:\n${failures.join("\n")}`,
  );
});

test("mounted dialog form controls declare one appearance owner", () => {
  const paths = [
    "src/components/workshell/settings-dialog.tsx",
    "src/components/workshell/chart-editor-dialog.tsx",
    "src/components/workshell/save-to-collection-dialog.tsx",
    "src/components/workshell/surveil-studies-dialog.tsx",
  ];
  const count = paths.reduce(
    (total, path) => total + assertMountedFormControlsDeclareAppearance(path),
    0,
  );
  assert.equal(count, 20, "the mounted ordinary-control inventory changed");

  const editor = readSource(
    "src/components/workshell/chart-editor-dialog.tsx",
  );
  const fieldClass = editor.match(
    /function fieldCls\([\s\S]*?^}/m,
  )?.[0];
  assert.ok(fieldClass, "chart editor field class must remain discoverable");
  assert.match(fieldClass, /--aries-control-height-small/);
  assert.match(fieldClass, /--aries-control-padding-x-compact/);
  assert.match(fieldClass, /--aries-radius-ui-control-compact/);
  assert.doesNotMatch(fieldClass, /\brounded-md\b/);
});

test("all mounted ordinary raw controls declare one appearance owner", () => {
  const chartStylePanel =
    "src/components/workshell/chart-style-panel.tsx";
  const paths = sourceFiles(join(sourceRoot, "components"))
    .filter((path) => path.endsWith(".tsx"))
    .map((path) => relative(frontendRoot, path))
    // Chart Style Panel has its own focused authoring lane and contract.
    .filter((path) => path !== chartStylePanel);
  const count = paths.reduce(
    (total, path) =>
      total +
      assertMountedFormControlsDeclareAppearance(path, {
        checkDensity: false,
        requireControls: false,
      }),
    0,
  );
  assert.equal(count, 51, "the mounted ordinary-control inventory changed");
});

test("context menus stay above the floating workspace navbar", () => {
  const globals = readSource("src/app/globals.css");
  const contextMenu = readSource("src/components/ui/context-menu.tsx");

  assert.match(globals, /\.aries-mode-hint\s*\{[\s\S]*?z-index:\s*70;/);
  assert.match(contextMenu, /className="isolate z-\[100\] outline-none"/);
  assert.match(contextMenu, /className=\{cn\("z-\[100\] max-h-/);
});

test("generic panel dividers preserve their brighter pre-tokenization states", () => {
  const css = readSource("src/app/globals.css");
  assert.match(
    css,
    /--aries-sash-panel-idle-color:\s*var\(--aries-sidebar-sash-rule\);/,
  );
  assert.match(
    css,
    /--aries-sash-panel-hover-color:\s*var\(--aries-border-subtle\);/,
  );
  assert.match(
    css,
    /--aries-sash-panel-active-color:\s*var\(--aries-border-subtle\);/,
  );

  const resizable = readSource("src/components/ui/resizable.tsx");
  assert.match(resizable, /var\(--aries-sash-panel-idle-color\)/);
  assert.match(resizable, /var\(--aries-sash-panel-hover-color\)/);
  assert.match(resizable, /var\(--aries-sash-panel-active-color\)/);
  assert.doesNotMatch(resizable, /var\(--aries-sash-(?:idle|hover|active)-color\)/);

  const sidebar = readSource("src/components/workshell/sidebar-sash.tsx");
  assert.match(sidebar, /var\(--aries-sash-idle-color\)/);
  assert.match(sidebar, /var\(--aries-sash-hover-color\)/);
  assert.match(sidebar, /var\(--aries-sash-active-color\)/);
});

test("native titlebar alignment remains on the proven pre-tokenization geometry", () => {
  const css = readSource("src/app/globals.css");
  for (const declaration of [
    "--morinus-header-height: 34px;",
    "--titlebar-h: var(--morinus-header-height);",
    "--titlebar-sidebar-pad-top: 40px;",
    "--titlebar-pane-pad-top: 40px;",
    "--titlebar-content-offset-y: 0px;",
    "--titlebar-left-controls-x: 8px;",
    "--titlebar-traffic-x: 19px;",
    "--titlebar-traffic-y: 22px;",
    "--titlebar-side-min-w: 132px;",
    "--titlebar-left-controls-x: 84px;",
    "--aries-control-height: 32px;",
    "--aries-control-icon-size: 14px;",
    "--aries-toolbar-control-width: var(--aries-control-height-compact);",
    "--aries-toolbar-control-height: calc(var(--aries-control-height) * 11 / 16);",
    "--aries-toolbar-icon-size: calc(var(--aries-control-icon-size) * 15 / 14);",
  ]) {
    assert.ok(css.includes(declaration), `${declaration} must remain at the proven titlebar default`);
  }

  const content = readSource("src/components/workshell/workspace-content.tsx");
  assert.match(
    content,
    /absolute left-\[var\(--titlebar-left-controls-x\)\] top-0[^"\n]*h-\[var\(--titlebar-h\)\][^"\n]*translate-y-\[var\(--titlebar-content-offset-y\)\]/,
  );
  assert.match(
    content,
    /col-start-2[^"\n]*translate-y-\[var\(--titlebar-content-offset-y\)\][^"\n]*justify-center/,
  );
  assert.match(
    content,
    /col-start-3[^"\n]*translate-y-\[var\(--titlebar-content-offset-y\)\][^"\n]*justify-end/,
  );
  assert.match(
    content,
    /captionActions\?\.style\.setProperty\(\s*"margin-right",\s*`\$\{resolveWindowsCaptionInset\(\)\}px`/,
  );
  assert.match(
    content,
    /h-\[var\(--morinus-header-btn-h\)\] w-\[var\(--morinus-header-btn-w\)\]/,
  );

  const optionsMenu = readSource("src/components/workshell/titlebar-options-menu.tsx");
  assert.match(
    optionsMenu,
    /h-\[var\(--morinus-header-btn-h\)\] w-\[var\(--morinus-header-btn-w\)\]/,
  );
});

test("outer chart labels cross only the titlebar backplate and stay below transient chrome", () => {
  const content = readSource("src/components/workshell/workspace-content.tsx");
  const copyControl = readSource("src/components/workshell/chart-copy-control.tsx");
  const chartCanvas = readSource("src/components/workshell/chart-canvas.tsx");
  const dialog = readSource("src/components/ui/dialog.tsx");
  const dropdown = readSource("src/components/ui/dropdown-menu.tsx");
  const contextMenu = readSource("src/components/ui/context-menu.tsx");

  assert.match(
    content,
    /data-aries-titlebar-backplate=""[\s\S]*?z-\[40\][\s\S]*?bg-\[var\(--aries-titlebar-background\)\]/,
  );
  assert.match(copyControl, /data-aries-titlebar-title=""/);
  assert.match(
    chartCanvas,
    /data-aries-chart-layer="outer-label"[\s\S]*?z-\[41\]/,
  );
  assert.match(
    chartCanvas,
    /querySelector<HTMLElement>\(\s*"\[data-aries-titlebar-title\]"/,
  );
  assert.equal(
    (chartCanvas.match(/\n\s+outerLabelCollisionBounds,\n/g) ?? []).length,
    3,
  );
  assert.match(
    content,
    /z-\[42\][^"\n]*col-start-2/,
  );
  assert.match(dialog, /fixed inset-0 isolate z-50[\s\S]*?backdrop-blur/);
  assert.match(dropdown, /isolate z-50 outline-none/);
  assert.match(contextMenu, /isolate z-\[100\] outline-none/);
});

test("Windows extends the native DWM frame without replacing caption controls in HTML", () => {
  const nativeFrame = readSource("src-tauri/src/windows_titlebar.rs");
  const rustShell = readSource("src-tauri/src/lib.rs");
  const shellHost = readSource("src/lib/shell-host.ts");
  const css = readSource("src/app/globals.css");

  assert.match(nativeFrame, /DwmExtendFrameIntoClientArea/);
  assert.match(nativeFrame, /DwmDefWindowProc/);
  assert.match(nativeFrame, /SetWindowSubclass/);
  assert.match(nativeFrame, /SM_CXSIZE/);
  assert.match(nativeFrame, /HTCLIENT/);
  assert.doesNotMatch(nativeFrame, /createElement|<button|innerHTML/);
  assert.match(rustShell, /#\[cfg\(target_os = "windows"\)\]\s*mod windows_titlebar;/);
  assert.match(rustShell, /windows_titlebar::install\(hwnd\)/);
  assert.match(shellHost, /__ARIES_WINDOWS_CAPTION_INSET__\?: number/);
  assert.match(css, /\.is-tauri\.is-macos\s*\{/);
  assert.doesNotMatch(css, /\.is-tauri\s*\{\s*--titlebar-left-controls-x:\s*84px/);
});

test("titlebar quick options dismisses across embedded workspace boundaries", () => {
  const optionsMenu = readSource("src/components/workshell/titlebar-options-menu.tsx");
  assert.match(optionsMenu, /window\.addEventListener\("blur", dismissOnWindowBlur\)/);
  assert.match(optionsMenu, /const dismissOnWindowBlur = \(\) => setOpen\(false\)/);
  assert.match(optionsMenu, /window\.removeEventListener\("blur", dismissOnWindowBlur\)/);
});

test("sidebar chrome retains the proven pre-tokenization spacing and action geometry", () => {
  const css = readSource("src/app/globals.css");
  for (const declaration of [
    "--aries-sidebar-row-padding-x: 12px;",
    "--aries-sidebar-row-padding-y: 4px;",
    "--aries-sidebar-section-header-height: 20px;",
    "--aries-sidebar-group-padding-start: 7px;",
    "--aries-sidebar-group-padding-end: 5px;",
    "--aries-sidebar-tree-indent: 12px;",
    "--aries-sidebar-drop-indicator-size: 2px;",
    "--aries-sidebar-drop-indicator-overhang: 1px;",
    "--aries-sidebar-trailing-inset: 8px;",
    "--aries-sidebar-unsaved-indicator-size: 6px;",
    "--aries-sidebar-close-inset: 6px;",
    "--aries-sidebar-close-action-size: 20px;",
    "--aries-sidebar-action-icon-size: 12px;",
  ]) {
    assert.ok(css.includes(declaration), `${declaration} must remain at the proven sidebar default`);
  }

  assertConsumes("src/components/workshell/app-sidebar.tsx", [
    "--aries-sidebar-section-header-height",
    "--aries-sidebar-group-padding-start",
    "--aries-sidebar-group-padding-end",
    "--aries-sidebar-tree-indent",
    "--aries-sidebar-drop-indicator-size",
    "--aries-sidebar-drop-indicator-overhang",
    "--aries-sidebar-trailing-inset",
    "--aries-sidebar-unsaved-indicator-size",
    "--aries-sidebar-close-inset",
    "--aries-sidebar-close-action-size",
    "--aries-sidebar-action-icon-size",
  ]);
});

test("migrated dialog actions and retained-list close controls keep their established defaults", () => {
  const css = readSource("src/app/globals.css");
  assert.match(css, /--aries-dialog-map-action-min-width:\s*72px;/);
  assert.match(css, /--aries-dialog-width-confirm:\s*380px;/);

  const settings = readSource("src/components/workshell/settings-dialog.tsx");
  assert.equal(
    (settings.match(/min-w-\[var\(--aries-dialog-map-action-min-width\)\]/g) ?? []).length,
    2,
  );
  for (const fragment of [
    "rounded-[var(--aries-radius-control-compact)]",
    "px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)]",
    "text-[length:var(--aries-font-size-base)]",
    "font-normal",
  ]) {
    assert.ok(settings.includes(fragment), `map actions must retain ${fragment}`);
  }
  assert.match(settings, /border-border\/60/);
  assert.match(settings, /disabled:opacity-40/);

  const picker = readSource("src/components/workshell/system-chart-picker.tsx");
  assert.match(
    picker,
    /max-w-\[var\(--aries-dialog-width-confirm\)\][^\n]*rounded-\[var\(--aries-radius-dialog\)\] border border-border/,
  );

  const shell = readSource("src/components/workshell/retained-pane-shell.tsx");
  assert.match(shell, /closeAppearance = "pane"/);
  assert.match(shell, /inline-flex shrink-0 items-center justify-center/);
  assert.match(shell, /var\(--aries-radius-ui-control-compact\)/);
  assert.match(shell, /var\(--aries-control-icon-size\)/);
  for (const file of [
    "feature-catalog-view.tsx",
    "legal-document-view.tsx",
    "whats-new-view.tsx",
    "lunar-mansions-view.tsx",
  ]) {
    assert.match(
      readSource(`src/components/workshell/${file}`),
      /closeAppearance="list"/,
      `${file} must keep its former 24px button and 14px close-icon treatment`,
    );
  }
});

test("shared list segmented controls retain their proven six-pixel item corners", () => {
  const css = readSource("src/app/globals.css");
  assert.match(
    css,
    /--aries-segmented-control-item-radius:\s*var\(--aries-radius-sm\);/,
  );
  assert.match(css, /--aries-radius-sm:\s*calc\(var\(--aries-radius-md\) \* 2 \/ 3\);/);
  assert.match(css, /--aries-radius-md:\s*9px;/);

  const listTokens = readSource("src/lib/list-tokens.ts");
  assert.match(listTokens, /segmentedButton:[\s\S]*?var\(--aries-segmented-control-item-radius\)/);
  const controls = readSource("src/components/workshell/list-controls.tsx");
  const segmentedControl = controls.slice(
    controls.indexOf("export function ListSegmentedControl"),
    controls.indexOf("export function ListCalendarStepper"),
  );
  assert.doesNotMatch(segmentedControl, /var\(--aries-radius-control-compact\)/);
});

test("retained sidebar lists use the structural table facade, not token-only raw cells", () => {
  const facade = readSource("src/components/workshell/sidebar-list-table.tsx");
  assert.match(facade, /data-slot="sidebar-list-table"/);
  assert.match(facade, /"directions-titled"/);
  assert.match(facade, /"transit-cursor"/);
  assert.match(facade, /LIST_ROLE_CLASSES\.symbolic/);
  assert.match(facade, /aries-sidebar-list-table caption-bottom w-full table-auto border-collapse/);
  assert.doesNotMatch(facade, /--aries-list-outer-x:\s*7px/);
  assert.doesNotMatch(facade, /NarrativeCell|NarrativeContent|max-w-|overflow-hidden|text-ellipsis/);
  assert.match(facade, /export function SidebarListDateCell/);
  assert.match(facade, /LIST_TEXT_CLASSES\.date,\s*"text-right tabular-nums"/);
  assert.match(facade, /export function SidebarListTimeCell/);
  assert.match(facade, /LIST_TEXT_CLASSES\.secondary,\s*"text-left tabular-nums"/);
  assert.doesNotMatch(facade, /data-slot="table-container"|overflow-x|max-content|table-fixed/);
  for (const primitive of ["TableHeader", "TableBody", "TableRow", "TableHead", "TableCell"]) {
    assert.match(facade, new RegExp(`${primitive} as SidebarList`));
  }

  const listTokens = readSource("src/lib/list-tokens.ts");
  assert.match(listTokens, /root:\s*"[^"]*bg-background/);
  assert.match(listTokens, /scroller:\s*"flex-1 min-h-0 overflow-auto"/);
  assert.match(listTokens, /stickyHeader:\s*"sticky top-0 z-10 bg-background"/);
  assert.match(listTokens, /date:\s*"aries-list-date-text"/);
  assert.match(listTokens, /secondary:\s*"aries-list-secondary-text"/);
  assert.doesNotMatch(
    listTokens.match(/root:\s*"[^"]*"/)?.[0] ?? "",
    /bg-muted|--aries-surface|bg-card/,
  );

  const tablePrimitives = readSource("src/components/ui/table.tsx");
  assert.match(tablePrimitives, /aries-list-row aries-list-row--hover aries-list-row--selected border-b/);
  assert.match(tablePrimitives, /aries-list-head text-foreground/);
  assert.match(tablePrimitives, /aries-list-cell align-middle/);
  const globalCss = readSource("src/app/globals.css");
  assert.match(
    globalCss,
    /\.aries-list \{[\s\S]*?table-layout: auto;[\s\S]*?min-width: 100%;[\s\S]*?width: 100%;/,
  );
  assert.match(
    globalCss,
    /\.aries-sidebar-list-table tr > \.aries-list-cell:first-child,[\s\S]*?padding-left: max\(var\(--aries-list-cell-x\), var\(--aries-list-outer-x\)\);/,
  );
  assert.match(
    globalCss,
    /\.aries-list tr > \.aries-list-cell:last-child,[\s\S]*?padding-right: max\(var\(--aries-list-cell-x\), var\(--aries-list-outer-x\)\);/,
  );
  assert.match(
    globalCss,
    /\.aries-list-date-text \{[\s\S]*?font-size: inherit;[\s\S]*?font-weight: 500;/,
  );
  assert.doesNotMatch(globalCss, /\.aries-sidebar-list-narrative/);
  const sidebarTableRule =
    globalCss.match(/\.aries-sidebar-list-table\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.doesNotMatch(
    sidebarTableRule,
    /max-width:\s*0|overflow:\s*hidden|text-overflow:\s*ellipsis/,
  );
  assert.match(globalCss, /\.aries-list-secondary-text \{[\s\S]*?color: var\(--aries-text-dim\);/);
  const secondaryTextRule = globalCss.match(/\.aries-list-secondary-text \{[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.doesNotMatch(secondaryTextRule, /font-size|text-transform/);

  const aspect = readSource("src/components/workshell/aspect-list-panel.tsx");
  const tableBlock = aspect.slice(aspect.indexOf("function AspectListTable"));
  assert.match(tableBlock, /<SidebarListTable profile="directions-titled">/);
  assert.match(tableBlock, /<SidebarListHeader className=\{LIST_PANE_CLASSES\.stickyHeader\}>/);
  for (const primitive of [
    "SidebarListBody",
    "SidebarListRow",
    "SidebarListHead",
    "SidebarListCell",
    "SidebarListSpacerRow",
    "SidebarListSortHeader",
  ]) {
    assert.match(tableBlock, new RegExp(`<${primitive}\\b`));
  }
  assert.doesNotMatch(tableBlock, /<(?:thead|tbody|tr|th|td)\b/);
  assert.doesNotMatch(
    tableBlock,
    /table-fixed|<colgroup|ColumnResizeHandle|useResizableTableColumns|min-w-\[|w-\[[^\]]*(?:px|ch)|overflow-hidden|\btruncate\b|text-ellipsis/,
  );
  assert.doesNotMatch(tableBlock, /aspectList\.phase/);
  assert.match(
    tableBlock,
    /<SidebarListHead[\s\S]*?colSpan=\{2\}[\s\S]*?aria-sort=\{sortBy === "exact"[\s\S]*?aspectList\.perfection[\s\S]*?onSort\("exact"\)/,
  );
  assert.match(tableBlock, /<SidebarListSpacerRow colSpan=\{4\}/);
  assert.doesNotMatch(tableBlock, /NarrativeCell|NarrativeContent/);
  assert.doesNotMatch(tableBlock, /colSpan=\{3\}/);
  assert.doesNotMatch(tableBlock, /colSpan=\{5\}/);
  assert.match(
    tableBlock,
    /<SidebarListCell className="text-right tabular-nums">[\s\S]*?row\.orbFormatted[\s\S]*?compactPhase[\s\S]*?<\/SidebarListCell>/,
  );
  assert.match(aspect, /aspectList\.applyingShort/);
  assert.match(aspect, /aspectList\.separatingShort/);
  assert.match(tableBlock, /<SidebarListDateCell>[\s\S]*?<button[\s\S]*?perfection\.exactDate[\s\S]*?<\/button>[\s\S]*?<\/SidebarListDateCell>/);
  assert.match(tableBlock, /<SidebarListTimeCell title=\{perfection\.exactTime\}>[\s\S]*?shortClockTime\(perfection\.exactTime\)/);
  assert.match(
    tableBlock,
    /<SidebarListDateCell>[\s\S]*?<\/SidebarListDateCell>[\s\S]*?<SidebarListTimeCell/,
  );
  assert.match(tableBlock, /shortClockTime\(perfection\.exactTime\)/);
  assert.match(
    tableBlock,
    /<AspectListRowContextMenu\b[\s\S]*?<SidebarListRow\b[\s\S]*?<\/SidebarListRow>[\s\S]*?<\/AspectListRowContextMenu>/,
    "Aspect List must expose its context-preserving actions from the entire data row",
  );

  const synodic = readSource("src/components/workshell/synodic-cycle-list-view.tsx");
  assert.match(synodic, /<SidebarListTable profile="transit-cursor">/);
  assert.doesNotMatch(synodic, /<table\b|LIST_ROLE_CLASSES/);
  assert.doesNotMatch(
    synodic,
    /NarrativeCell|NarrativeContent|max-w-0|overflow-hidden|text-ellipsis/,
  );

  const frameLayout = readSource("src/stores/frame-layout-store.ts");
  const rightPaneLayout = readSource("src/components/workshell/right-pane-layout.ts");
  assert.match(frameLayout, /const RIGHT_PANE_SYNODIC_MIN_WIDTH = 420;/);
  assert.match(
    frameLayout,
    /"synodic-cycles": \{[\s\S]*?minContentWidth: RIGHT_PANE_SYNODIC_MIN_WIDTH/,
  );
  assert.match(
    rightPaneLayout,
    /if \(input\.synodicCyclesPane\) return "synodic-cycles";/,
  );

  const headerBlock = aspect.slice(
    aspect.indexOf("<div className={LIST_PANE_CLASSES.standardHeader}>"),
    aspect.indexOf("{error && payload ?"),
  );
  assert.match(headerBlock, /LIST_PANE_CLASSES\.controlRow/);
  assert.match(headerBlock, /LIST_PANE_CLASSES\.labeledControl/);
  assert.match(headerBlock, /LIST_PANE_CLASSES\.controlLabel/);
  assert.equal((headerBlock.match(/<PaneSelect/g) ?? []).length, 2);
  assert.doesNotMatch(headerBlock, /<(?:select|input)\b/);
});

test("retained time-lord controls preserve their caller-specific pre-tokenization gaps", () => {
  const table = readSource("src/components/workshell/time-lord-table-view.tsx");
  assert.match(
    table,
    /<PaneInfoBar className="gap-\[var\(--aries-pane-control-gap-y\)\]">/,
    "time-lord header fragments must retain their former 8px separation",
  );
  assert.match(
    table,
    /<PaneControlBar\s+density="compact"\s+className="gap-\[var\(--aries-pane-control-gap-y\)\]"/,
    "Triplicity controls must retain their former 8px compact-band gap",
  );
  assert.equal(
    (table.match(/"gap-\[var\(--aries-control-gap-compact\)\]"/g) ?? []).length,
    2,
    "time-lord ZR and Profections checkboxes must retain their former 4px gap",
  );

  const zodiacalReleasing = readSource(
    "src/components/workshell/zodiacal-releasing-view.tsx",
  );
  assert.equal(
    (zodiacalReleasing.match(/"gap-\[var\(--aries-control-gap-compact\)\]"/g) ?? []).length,
    1,
    "the dedicated ZR checkbox must retain its former 4px gap",
  );
});

test("loading error and empty-state chrome retains the established inset and type defaults", () => {
  const css = readSource("src/app/globals.css");
  assert.match(css, /--aries-pane-header-padding-x:\s*16px;/);
  assert.match(css, /--aries-pane-state-padding:\s*24px;/);
  assert.match(css, /--aries-font-size-base:\s*12px;/);

  const listTokens = readSource("src/lib/list-tokens.ts");
  for (const state of ["loading", "error"]) {
    const start = listTokens.indexOf(`${state}:`);
    assert.notEqual(start, -1);
    const block = listTokens.slice(start, listTokens.indexOf("\n", start + 20) + 1);
    assert.match(block, /--aries-pane-header-padding-x/);
    assert.match(block, /--aries-pane-state-padding/);
    assert.match(block, /--aries-font-size-base/);
  }

  const retained = readSource("src/components/workshell/retained-pane-shell.tsx");
  assert.match(retained, /flex h-full min-h-0 flex-col bg-background/);
  for (const file of [
    "decennials-view.tsx",
    "firdaria-view.tsx",
    "time-lord-pane-view.tsx",
    "zodiacal-releasing-view.tsx",
    "eclipses-view.tsx",
    "profections-view.tsx",
  ]) {
    const source = readSource(`src/components/workshell/${file}`);
    assert.match(source, /items-center justify-center p-6/);
    assert.match(source, /text-\[length:var\(--aries-font-size-base\)\]/);
  }
});

test("aspect-matrix geometry is a bounded chart-scoped authoring family", () => {
  const geometryTokens = [
    "--aries-aspect-matrix-cell-size",
    "--aries-aspect-matrix-fixed-star-rail-width",
    "--aries-aspect-matrix-outer-padding",
    "--aries-aspect-matrix-axis-glyph-size",
    "--aries-aspect-matrix-rule-width",
    "--aries-aspect-matrix-exact-inset",
    "--aries-aspect-matrix-applying-marker-size",
    "--aries-aspect-matrix-glyph-inset-x",
    "--aries-aspect-matrix-glyph-inset-y",
    "--aries-aspect-matrix-parallel-inset-x",
    "--aries-aspect-matrix-parallel-inset-y",
    "--aries-aspect-matrix-orb-inset-bottom",
  ];
  assertConsumes("src/components/workshell/aspect-matrix-view.tsx", geometryTokens);

  const matrix = readSource("src/components/workshell/aspect-matrix-view.tsx");
  assert.doesNotMatch(matrix, /const\s+(?:CELL|STAR_RAIL)\s*=/);
  assert.doesNotMatch(matrix, /(?:p-4|text-\[19px\]|inset-\[3px\]|border-\[5px\]|left-\[7px\]|top-\[5px\]|right-\[4px\]|bottom-\[4px\])/);
  assert.ok(matrix.includes("var(--morinus-aspect-parallel)"));
  assert.ok(matrix.includes("var(--morinus-aspect-contraparallel)"));

  const { publicManifest } = buildStyleTokenInventory(frontendRoot);
  const publicByName = new Map(publicManifest.tokens.map((token) => [token.cssVar, token]));
  for (const name of geometryTokens) {
    const token = publicByName.get(name);
    assert.equal(token?.scope, "chart", `${name} must remain chart-scoped`);
    assert.equal(token?.tier, "renderer-metric", `${name} must remain renderer geometry`);
    assert.equal(token?.handoffStatus, "editable", `${name} must remain editable`);
    assert.ok(token?.bounds, `${name} must keep explicit numeric bounds`);
  }
});

test("Astrolabe and sidebar wrappers cannot restore their former fixed layout literals", () => {
  const astrolabe = readSource("src/components/workshell/astrolabe-view.tsx");
  assert.doesNotMatch(astrolabe, /(?:gap-1\.5|px-3|py-1\.5|px-2|py-0\.5|var\(--primary,)/);

  const sidebar = readSource("src/components/workshell/app-sidebar.tsx");
  assert.doesNotMatch(sidebar, /depth\s*\*\s*12|(?:h-0\.5|-top-px|-bottom-px|size-1\.5|right-1\.5|\bh-5\b|\bw-5\b|\bsize-3\b)/);
  assertConsumes("src/app/globals.css", [
    "--aries-sidebar-row-padding-x",
    "--aries-sidebar-row-padding-y",
  ]);
});

test("public list row-height roles are the sole authority for fixed-row virtualization", () => {
  const tokens = readSource("src/lib/list-tokens.ts");
  for (const cssVar of [
    "--aries-list-row-height-dense",
    "--aries-list-row-height-standard",
    "--aries-list-row-height-symbolic",
  ]) {
    assert.ok(tokens.includes(`\"${cssVar}\"`), `list-tokens.ts must resolve ${cssVar}`);
  }
  assert.match(tokens, /export function resolveListRowHeight/);
  assert.match(tokens, /Number\.isFinite\(value\) && value > 0/);
  assert.match(tokens, /export function useListRowHeight/);
  assert.match(tokens, /export function useFixedRowHeightAnchor/);
  assert.match(tokens, /anchorUnits \* rowHeight/);
  assert.match(tokens, /querySelector<HTMLElement>\("thead"\)\?\.offsetHeight/);
  assert.match(tokens, /scroller\.clientHeight - headerHeight/);
  assert.match(tokens, /rowCount \* rowHeight - bodyViewportHeight/);
  assert.match(tokens, /ariesRowHeightAnchorUntil/);

  const stitchedHarness = readSource("src/components/workshell/stitched-list-harness.ts");
  assert.match(stitchedHarness, /thresholdPxRef/);
  assert.match(stitchedHarness, /ariesRowHeightAnchorUntil/);

  const consumers = new Map([
    ["src/components/workshell/directions-view.tsx", "symbolic"],
    ["src/components/workshell/transit-list-view.tsx", "symbolic"],
    ["src/components/workshell/transit-search-view.tsx", "dense"],
    ["src/components/workshell/synodic-cycle-list-view.tsx", "symbolic"],
    ["src/components/workshell/time-lord-table-view.tsx", "symbolic"],
    ["src/components/workshell/eclipses-view.tsx", "standard"],
  ]);
  for (const [path, density] of consumers) {
    const source = readSource(path);
    assert.ok(
      source.includes(`useListRowHeight(\"${density}\")`),
      `${path} must resolve its ${density} CSS row-height role`,
    );
    assert.doesNotMatch(
      source,
      /LIST_ROW_HEIGHT|(?:^|\W)(?:DIRECTION_|TRANSIT_|SYNODIC_)?ROW_HEIGHT(?:\W|$)/,
      `${path} cannot retain a disconnected numeric row-height authority`,
    );
    assert.match(source, /paddingTop:\s*startIndex \* rowHeight/);
    assert.match(source, /paddingBottom:[^\n]*rowCount - endIndex[^\n]*\* rowHeight/);
    assert.match(source, /style=\{\{ height: rowHeight \}\}/);
  }

  for (const path of [
    "src/components/workshell/directions-view.tsx",
    "src/components/workshell/transit-list-view.tsx",
    "src/components/workshell/synodic-cycle-list-view.tsx",
  ]) {
    assert.match(readSource(path), /useFixedRowHeightAnchor\(/);
  }
  const aspect = readSource("src/components/workshell/aspect-list-panel.tsx");
  assert.ok(aspect.includes('useListRowHeight("symbolic")'));
  assert.match(aspect, /useFixedRowHeightAnchor\(/);
  assert.match(aspect, /topSpacer = start \* rowHeight/);
  assert.match(aspect, /bottomSpacer = Math\.max\(0, \(rows\.length - end\) \* rowHeight\)/);
  assert.match(aspect, /style=\{\{ height: rowHeight \}\}/);
  for (const path of [
    "src/components/workshell/time-lord-table-view.tsx",
    "src/components/workshell/eclipses-view.tsx",
  ]) {
    const source = readSource(path);
    assert.match(source, /previousRowHeightRef/);
    assert.match(source, /anchorUnits \* rowHeight/);
  }
  assert.match(
    readSource("src/components/workshell/time-lord-table-view.tsx"),
    /\(scroller\.scrollTop \+ viewportAnchor\) \/ previousRowHeight/,
  );
  const eclipses = readSource("src/components/workshell/eclipses-view.tsx");
  assert.match(eclipses, /bodyScrollTop \/ previousRowHeight/);
  assert.match(eclipses, /bodyScrollTop \/ sourceRowHeight/);
});

test("measured geometry, native titlebar geometry, hit zones, and table algorithms stay internal", () => {
  const { inventory, publicManifest } = buildStyleTokenInventory(frontendRoot);
  const byName = new Map(inventory.tokens.map((token) => [token.name, token]));
  const publicTokens = publicManifest.tokens;

  for (const name of [
    "--sidebar-width",
    "--sidebar-width-icon",
    "--right-pane-width",
    "--right-pane-min-content-width",
    "--right-pane-preferred-width",
  ]) {
    assert.equal(byName.get(name)?.class, "runtime", `${name} must remain measured runtime geometry`);
    assert.ok(!publicTokens.some((token) => token.cssVar === name), `${name} cannot be profile-editable`);
  }

  for (const token of inventory.tokens.filter(({ name }) => name.startsWith("--titlebar-"))) {
    assert.notEqual(token.class, "public", `${token.name} is native titlebar geometry`);
  }

  assert.ok(
    !publicTokens.some(({ cssVar, semanticId }) => /sash.*(?:hit|target)|(?:hit|target).*sash/i.test(`${cssVar} ${semanticId}`)),
    "sash pointer hit zones must remain fixed interaction geometry",
  );
  assert.ok(
    !publicTokens.some(({ cssVar, semanticId }) => /table.*(?:algorithm|column-width|layout-mode|measure)|(?:algorithm|measure).*table/i.test(`${cssVar} ${semanticId}`)),
    "table measurement and column-layout algorithms must remain code-owned",
  );

  const tableAlgorithm = readSource("src/components/workshell/resizable-table-columns.tsx");
  assert.match(tableAlgorithm, /getBoundingClientRect\(\)\.width/);
  assert.match(tableAlgorithm, /tableLayout:\s*["']fixed["']/);
});

test("retained pane chrome defaults to the app background and Profections opts into surfaces", () => {
  const shell = readSource("src/components/workshell/retained-pane-shell.tsx");
  assert.match(shell, /headerSurface = "background"/);
  assert.match(
    shell,
    /headerSurface === "surface"[\s\S]*?"bg-\[color:var\(--aries-surface\)\]"[\s\S]*?: "bg-background"/,
  );

  const controls = readSource("src/components/workshell/list-controls.tsx");
  const controlBar = controls.slice(
    controls.indexOf("export function PaneControlBar"),
    controls.indexOf("export function PaneInfoBar"),
  );
  const infoBar = controls.slice(
    controls.indexOf("export function PaneInfoBar"),
    controls.indexOf("export function PaneSelect"),
  );
  const select = controls.slice(
    controls.indexOf("export function PaneSelect"),
    controls.indexOf("export function PaneToolbarButton"),
  );
  for (const block of [controlBar, infoBar, select]) {
    assert.match(block, /surface = false/);
  }
  assert.match(controlBar, /surface && "bg-\[color:var\(--aries-surface-subtle\)\]"/);
  assert.match(infoBar, /surface && "bg-\[color:var\(--aries-surface-subtle\)\]"/);
  assert.match(
    select,
    /surface \? "bg-\[color:var\(--aries-surface\)\]" : "bg-background"/,
  );

  const profections = readSource("src/components/workshell/profections-view.tsx");
  assert.equal((profections.match(/headerSurface="surface"/g) ?? []).length, 4);
  assert.match(profections, /<PaneControlBar density="grouped" surface>/);
  for (const id of ["prof-pane-mode", "prof-pane-display", "prof-pane-monthly"]) {
    assert.match(profections, new RegExp(`<PaneSelect\\s+id="${id}"\\s+surface`));
  }

  for (const file of [
    "feature-catalog-view.tsx",
    "legal-document-view.tsx",
    "whats-new-view.tsx",
    "lunar-mansions-view.tsx",
  ]) {
    const source = readSource(`src/components/workshell/${file}`);
    assert.match(source, /titleSize="large"/);
    assert.match(source, /titleWeight="semibold"/);
    assert.match(source, /headerDensity="compact"/);
  }
});

test("dialog roles preserve the established desktop cap and Manzil keeps its Arabic size", () => {
  const globals = readSource("src/app/globals.css");
  assert.match(globals, /--aries-dialog-width-sm:\s*384px;/);
  assert.match(globals, /--aries-font-size-arabic:\s*17px;/);

  const dialog = readSource("src/components/ui/dialog.tsx");
  assert.match(dialog, /size = "sm"/);
  assert.match(dialog, /sm: "[^"]*var\(--aries-dialog-width-sm\)/);
  for (const role of ["compact", "md", "detail", "prose", "reading"]) {
    assert.match(
      dialog,
      new RegExp(`${role}: "[^"]*sm:w-\\[[^"]*var\\(--aries-dialog-width-sm\\)`),
    );
  }

  const manzil = readSource("src/components/workshell/inspector-panel.tsx");
  assert.match(manzil, /text-\[length:var\(--aries-font-size-arabic\)\]/);
  assert.match(
    manzil,
    /className=\{cn\("justify-self-start leading-none", INSPECTOR_STRONG_COLOR, TEXT_ARABIC\)\}/,
  );
  assert.doesNotMatch(manzil, /text-\[17px\]/);
});

test("inspector colours repaint from semantic roles without refetching the hover flag", () => {
  const hover = readSource("src/components/workshell/chart-hover-flag.tsx");
  const fetchIndex = hover.indexOf("fetchInspectorFlagPayload(query, controller.signal)");
  assert.notEqual(fetchIndex, -1, "hover flag fetch is missing");
  const fetchEffectStart = hover.lastIndexOf("React.useEffect(() => {", fetchIndex);
  const fetchEffectEnd = hover.indexOf("React.useEffect(() => {", fetchIndex + 1);
  const fetchEffect = hover.slice(fetchEffectStart, fetchEffectEnd);
  assert.doesNotMatch(
    fetchEffect,
    /styleRevision/,
    "a palette/radius/font revision must not invoke the inspector flag endpoint",
  );
  assert.match(fetchEffect, /identityKey/);
  assert.match(fetchEffect, /bindingKey/);
  assert.match(fetchEffect, /retryTick/);
  assert.match(fetchEffect, /semanticOptionsSeq/);
  assert.match(
    hover,
    /if\s*\(\s*!lastOptionsChange\s*\|\|\s*lastOptionsChange\.styleOnly\s*\|\|\s*lastOptionsChange\.listDataChanged === false\s*\)\s*\{\s*return;\s*\}/,
    "hover flags must refetch only for semantic option changes, never renderer-only events",
  );

  assert.match(hover, /semanticChartColor\(payload\.accentRole, rgbCss\(payload\.accent\)\)/);
  assert.match(hover, /semanticChartColor\(span\.colourRole, rgbCss\(span\.colour\)\)/);
  assert.match(hover, /semanticChartColor\(colourRole, rgbCss\(colour\)\)/);
  assert.match(
    hover,
    /useLayoutEffect\([\s\S]*?\[payload, anchor\?\.x, anchor\?\.y, styleRevision\]\)/,
    "style revisions may still remeasure the resident card",
  );

  const inspector = readSource("src/components/workshell/inspector-panel.tsx");
  assert.match(inspector, /semanticChartColor\(payload\.accentRole, rgb\(payload\.accent\)\)/);
  assert.match(inspector, /semanticChartColor\(item\.colour_role, rgb\(item\.colour\)\)/);
  assert.match(inspector, /semanticChartColor\(item\.aspect_colour_role, rgb\(item\.aspect_colour\)\)/);

  const client = readSource("src/lib/daemon/client.ts");
  assert.match(client, /accentRole\?: string \| null/);
  assert.match(client, /colourRole\?: string \| null/);
  assert.match(client, /aspect_colour_role\?: string \| null/);
});

test("directions PDF export resolves the active semantic palette at export time", () => {
  const directions = readSource("src/components/workshell/directions-view.tsx");
  const semanticColor = readSource("src/lib/theme/semantic-color.ts");

  assert.match(semanticColor, /export function resolvedSemanticChartColor/);
  assert.match(semanticColor, /getComputedStyle\(root\)\.getPropertyValue\(role\)/);
  assert.match(directions, /resolvedSemanticChartColor\(part\.colorRole, part\.color\)/);
  assert.match(directions, /directionGlyphPdfCell\(/);
  assert.match(directions, /resolvedSemanticChartColor\(colorRole, color\)/);
  assert.match(directions, /circumSignColors/);
});

test("mounted informational dialogs consume semantic density roles", () => {
  const expectedByFile = new Map([
    [
      "src/components/workshell/about-dialog.tsx",
      [
        "--aries-font-size-reading",
        "--aries-dialog-gap",
        "--aries-dialog-section-padding-y",
        "--aries-form-row-gap",
        "--aries-form-field-gap",
        "--aries-pane-state-padding",
      ],
    ],
    [
      "src/components/workshell/help-dialog.tsx",
      [
        "--aries-font-size-reading",
        "--aries-control-gap",
        "--aries-form-field-gap",
        "--aries-pane-content-padding",
        "--aries-panel-padding-y",
        "--aries-section-gap",
        "--aries-radius-md",
      ],
    ],
    [
      "src/components/workshell/license-management-panel.tsx",
      [
        "--aries-font-size-base",
        "--aries-dialog-section-padding-y",
        "--aries-dialog-padding",
        "--aries-form-row-gap",
        "--aries-form-group-gap",
        "--aries-form-field-gap",
        "--aries-control-padding-x",
        "--aries-radius-ui-control",
        "--aries-radius-ui-control-compact",
      ],
    ],
    [
      "src/components/workshell/system-chart-picker.tsx",
      [
        "--aries-font-size-dialog-title",
        "--aries-font-size-large",
        "--aries-radius-dialog",
        "--aries-radius-md",
        "--aries-radius-control-compact",
        "--aries-radius-ui-control-compact",
        "--aries-control-padding-y",
      ],
    ],
  ]);
  for (const [path, tokens] of expectedByFile) {
    assertConsumes(path, tokens);
  }

  const help = readSource("src/components/workshell/help-dialog.tsx");
  assert.match(help, /className="aries-list-head/);
  assert.match(help, /className="aries-list-cell/);
  assert.match(help, /className="aries-list-row/);

  const forbiddenByFile = new Map([
    [
      "src/components/workshell/about-dialog.tsx",
      [
        /\btext-2xl\b/,
        /\btext-sm\b/,
        /\bspace-y-(?:1|1\.5|4)\b/,
        /\bgap-[xy]-(?:1|4)\b/,
        /\bpt-(?:2|4)\b/,
        /\bmb-(?:2|3)\b/,
        /\bpr-1\b/,
        /\bpy-8\b/,
      ],
    ],
    [
      "src/components/workshell/help-dialog.tsx",
      [
        /\bspace-y-(?:1\.5|2|5)\b/,
        /\bpx-(?:2|4)\b/,
        /\bpy-(?:1\.5|3)\b/,
        /\bpb-4\b/,
        /\brounded-md\b/,
      ],
    ],
    [
      "src/components/workshell/license-management-panel.tsx",
      [
        /\btext-xs\b/,
        /\bgap-(?:2|2\.5|3)\b/,
        /\bspace-y-2\b/,
        /\b(?:mt|pt)-3\b/,
        /\bmt-(?:0\.5|2)\b/,
        /\bpx-(?:1\.5|2|2\.5)\b/,
        /\bpy-(?:0\.5|2|4)\b/,
        /\brounded-(?:full|md)\b/,
      ],
    ],
    [
      "src/components/workshell/system-chart-picker.tsx",
      [
        /text-\[(?:15|18)px\]/,
        /\brounded-(?:md|sm)\b/,
        /\bmr-2\b/,
        /\bpx-1\.5\b/,
        /\bpy-0\.5\b/,
      ],
    ],
  ]);
  const failures = [];
  for (const [path, patterns] of forbiddenByFile) {
    const source = readSource(path);
    for (const pattern of patterns) {
      if (pattern.test(source)) failures.push(`${path}: ${pattern}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `mounted informational dialogs must use semantic density roles:\n${failures.join("\n")}`,
  );
});
