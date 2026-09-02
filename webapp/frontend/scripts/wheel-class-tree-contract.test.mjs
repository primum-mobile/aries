// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The class hierarchy the style editor renders.
 *
 * Stage 1 of doc/ui-specs/style-editor-families-and-swatches.md. The tree is
 * derived from the dotted class ids rather than hand-written, so these tests
 * pin the derivation against the real manifest: every class must appear
 * exactly once, group nodes must not masquerade as selectable classes, and the
 * families the next stage will edit must be the ones a reader actually reads
 * as one thing.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const transpile = async (url) =>
  ts.transpileModule(await readFile(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const tree = await import(dataUrl(
  await transpile(new URL("../src/lib/style-lab/wheel-class-tree.ts", import.meta.url)),
));

const manifestSource = await readFile(
  new URL("../src/lib/style-lab/semantic-class-manifest.ts", import.meta.url),
  "utf8",
);
const CLASS_IDS = [...new Set(
  [...manifestSource.matchAll(
    /"((?:bodies|angles|houses|zodiac|subdivisions|aspects)\.[a-zA-Z0-9.]+)"/g,
  )].map((match) => match[1]),
)];

test("the manifest is large enough for this to be worth grouping", () => {
  assert.ok(CLASS_IDS.length >= 40, `only found ${CLASS_IDS.length} class ids`);
});

test("every class appears exactly once in the tree", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const classNodes = tree.flattenWheelClassTree(nodes).filter((node) => node.isClass);
  const ids = classNodes.map((node) => node.id);
  assert.deepEqual([...ids].sort(), [...CLASS_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, "a class was emitted twice");
});

test("group nodes are never selectable as classes", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const groups = tree.flattenWheelClassTree(nodes).filter((node) => !node.isClass);
  assert.ok(groups.length > 0, "expected intermediate groups");
  for (const group of groups) {
    assert.ok(
      !CLASS_IDS.includes(group.id),
      `${group.id} is a manifest class but was emitted as a group`,
    );
    assert.ok(group.children.length > 0, `${group.id} is an empty group`);
  }
});

test("a path that prefixes another class stays a group", () => {
  // bodies.inner.position is not paintable; its three components are.
  const nodes = tree.buildWheelClassTree([
    "bodies.inner.position.degree",
    "bodies.inner.position.sign",
    "bodies.inner.position.minute",
  ]);
  const flat = tree.flattenWheelClassTree(nodes);
  const position = flat.find((node) => node.id === "bodies.inner.position");
  assert.ok(position, "expected a position group");
  assert.equal(position.isClass, false);
  assert.equal(position.children.length, 3);
});

test("a class that is also a prefix is still selectable", () => {
  // Defensive: if a future manifest adds both a node and children under it,
  // the node must stay selectable rather than being demoted to a group.
  const nodes = tree.buildWheelClassTree(["a.b", "a.b.c"]);
  const flat = tree.flattenWheelClassTree(nodes);
  const parent = flat.find((node) => node.id === "a.b");
  assert.ok(parent);
  assert.equal(parent.isClass, true);
  assert.equal(parent.children.length, 1);
});

test("depth reflects path position, for indentation", () => {
  const nodes = tree.buildWheelClassTree(["bodies.inner.position.degree"]);
  const flat = tree.flattenWheelClassTree(nodes);
  assert.deepEqual(flat.map((node) => [node.segment, node.depth]), [
    ["bodies", 0],
    ["inner", 1],
    ["position", 2],
    ["degree", 3],
  ]);
});

test("flatten yields parents before their children", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const order = tree.flattenWheelClassTree(nodes).map((node) => node.id);
  for (const [index, id] of order.entries()) {
    const parentPath = id.slice(0, id.lastIndexOf("."));
    if (!parentPath || !order.includes(parentPath)) continue;
    assert.ok(
      order.indexOf(parentPath) < index,
      `${parentPath} must be listed before ${id}`,
    );
  }
});

test("families are the groups whose children are all leaf classes", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const families = tree.wheelClassFamilies(nodes).map((node) => node.id);

  // The readings a user edits as one thing.
  for (const expected of [
    "bodies.inner.position",
    "houses.inner.position",
    "angles.inner.position",
    "zodiac.tick.inner",
    "zodiac.tick.outer",
    "subdivisions.term",
    "subdivisions.decan",
  ]) {
    assert.ok(families.includes(expected), `expected family ${expected}`);
  }
  // Navigation containers are not families: they mix classes and deeper
  // groups, so they are not one thing read at once.
  for (const notFamily of ["bodies", "bodies.inner", "zodiac", "zodiac.tick"]) {
    assert.ok(
      !families.includes(notFamily),
      `${notFamily} is a container, not a family`,
    );
  }
});

test("a single-child group is not a family", () => {
  // Nothing to hold together, so family-level editing would just be a second
  // name for the one class.
  const nodes = tree.buildWheelClassTree(["x.y.only"]);
  assert.deepEqual(tree.wheelClassFamilies(nodes).map((node) => node.id), []);
});

test("the tree is frozen", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  assert.ok(Object.isFrozen(nodes));
  assert.ok(Object.isFrozen(nodes[0].children));
});

test("a family may be a class in its own right", () => {
  // A degree ruler owns its 1/5/10-degree ticks *and* carries a depth of its
  // own. Requiring a family to be a bare group would have meant either a ruler
  // that cannot be sized or ticks that belong to nothing.
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const families = tree.wheelClassFamilies(nodes).map((node) => node.id);
  for (const ruler of ["zodiac.tick.inner", "zodiac.tick.outer"]) {
    assert.ok(families.includes(ruler), `expected ${ruler} to still be a family`);
    const node = tree.flattenWheelClassTree(nodes).find((entry) => entry.id === ruler);
    assert.ok(node?.isClass, `${ruler} must be selectable, not a bare group`);
  }
  // Containers stay out: they mix classes and deeper groups.
  for (const notFamily of ["bodies", "bodies.inner", "zodiac", "zodiac.tick"]) {
    assert.ok(!families.includes(notFamily), `${notFamily} is a container, not a family`);
  }
});

test("a tick's reading is its ruler, not its sibling ticks", () => {
  const nodes = tree.buildWheelClassTree(CLASS_IDS);
  const owners = tree.wheelClassFamilyOwnerByMember(nodes);
  for (const grade of ["10deg", "5deg", "1deg"]) {
    assert.equal(owners.get(`zodiac.tick.inner.${grade}`), "zodiac.tick.inner");
    assert.equal(owners.get(`zodiac.tick.outer.${grade}`), "zodiac.tick.outer");
  }
  // A family that is a bare group has no owner, so those clicks still fan out
  // to the member set rather than selecting a class that does not exist.
  assert.equal(owners.get("bodies.inner.position.degree"), undefined);
  assert.ok(
    tree.wheelClassFamilyByMember(nodes).get("bodies.inner.position.degree"),
    "a bare-group family must still resolve to its members",
  );
});
