// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The style editor's class hierarchy.
 *
 * Stage 1 of `doc/ui-specs/style-editor-families-and-swatches.md`. Semantic
 * class ids are dotted paths, and the path already *is* the hierarchy:
 * `bodies.inner.position.degree` states its own place in the tree. The editor
 * lists all fifty classes flat and alphabetically, which is the wrong altitude
 * for the work — an astrologer colours a position reading, not three
 * independently addressable fragments of one.
 *
 * This module derives the tree and nothing else. It makes no editing decision,
 * assigns no roles, and changes no value; those are later stages. Keeping the
 * derivation pure means the grouping can be tested without mounting a panel.
 */

export interface WheelClassTreeNode {
  /**
   * Full class id for a class node, dotted path prefix for a group. A group id
   * is not addressable as a class — nothing may look it up in the manifest.
   */
  readonly id: string;
  /** Last path segment, for display. */
  readonly segment: string;
  /** 0 for top-level entries. */
  readonly depth: number;
  /** True when this node is a real manifest class and can be selected. */
  readonly isClass: boolean;
  readonly children: readonly WheelClassTreeNode[];
}

interface MutableNode {
  id: string;
  segment: string;
  depth: number;
  isClass: boolean;
  children: MutableNode[];
}

/**
 * Build the class hierarchy from dotted class ids.
 *
 * Input order does not matter; siblings come back in the order first seen so a
 * caller can impose its own sort. A node is marked `isClass` only when that
 * exact id appears in the input, so an intermediate path such as
 * `bodies.inner.position` is a group even though its children are classes.
 */
export function buildWheelClassTree(
  classIds: readonly string[],
): readonly WheelClassTreeNode[] {
  const roots: MutableNode[] = [];
  const byPath = new Map<string, MutableNode>();

  for (const classId of classIds) {
    const segments = classId.split(".").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    let path = "";
    let siblings = roots;
    let parent: MutableNode | null = null;
    for (let depth = 0; depth < segments.length; depth += 1) {
      const segment = segments[depth];
      path = path.length > 0 ? `${path}.${segment}` : segment;
      let node = byPath.get(path);
      if (!node) {
        node = { id: path, segment, depth, isClass: false, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      siblings = node.children;
      parent = node;
    }
    // Only the exact id is a class. A path that merely prefixes another stays
    // a group, which is what lets `bodies.inner.position` group its three
    // components without pretending to be paintable itself.
    if (parent) parent.isClass = true;
  }

  const freeze = (node: MutableNode): WheelClassTreeNode => Object.freeze({
    id: node.id,
    segment: node.segment,
    depth: node.depth,
    isClass: node.isClass,
    children: Object.freeze(node.children.map(freeze)),
  });
  return Object.freeze(roots.map(freeze));
}

/** Depth-first walk, parents before children, matching display order. */
export function flattenWheelClassTree(
  nodes: readonly WheelClassTreeNode[],
): readonly WheelClassTreeNode[] {
  const out: WheelClassTreeNode[] = [];
  const visit = (node: WheelClassTreeNode) => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}

/**
 * The nodes whose children are all leaf classes — a position reading, a
 * degree ruler, a subdivision ring.
 *
 * These are the readings edited as one thing. A node with a mix of classes and
 * deeper groups is a container for navigation, not one thing the user reads at
 * once, so it is deliberately excluded.
 *
 * A family may be a class in its own right. A degree ruler is the case that
 * forced it: the ruler owns its 1°/5°/10° ticks *and* carries a depth of its
 * own, so it is both the reading and a thing with a property. Requiring a
 * family to be a bare group would have meant either a ruler that cannot be
 * sized or ticks that belong to nothing.
 */
export function wheelClassFamilies(
  nodes: readonly WheelClassTreeNode[],
): readonly WheelClassTreeNode[] {
  return flattenWheelClassTree(nodes).filter((node) =>
    // A top-level node is one of the chart's major categories — rings, fills,
    // layers. Its children are not one reading but a dozen independent things
    // that merely live in the same bag, and treating that bag as a family made
    // a click on the term ring reach for every ring in the wheel. Selecting
    // all of them at once is a bulk operation worth naming on purpose, not
    // something the shape of the tree should hand out by accident.
    node.depth > 0
    && node.children.length > 1
    && node.children.every((child) => child.isClass && child.children.length === 0),
  );
}

/**
 * Every family member mapped to the family it belongs to.
 *
 * Selection needs the inverse of `wheelClassFamilies`: given the class the user
 * clicked, which reading is it part of? Both the canvas and the inspector
 * resolve that from this one map, so clicking a degree in the wheel and picking
 * its row in the list cannot disagree about what a family is.
 */
export function wheelClassFamilyByMember(
  nodes: readonly WheelClassTreeNode[],
): ReadonlyMap<string, readonly string[]> {
  const byMember = new Map<string, readonly string[]>();
  for (const family of wheelClassFamilies(nodes)) {
    const members = Object.freeze(family.children.map((child) => child.id));
    for (const member of members) byMember.set(member, members);
  }
  return byMember;
}

/**
 * Every member of a family that is itself a class, mapped to that class.
 *
 * Where a family is a bare group there is nothing to select but its members, so
 * a click fans out to all of them. Where the family *is* a class — a degree
 * ruler owning its ticks — the reading is that one class, and fanning out would
 * select three tick groups while leaving the thing that sizes them unselected.
 * Callers that resolve a click to a reading consult this first and fall back to
 * the member list.
 */
export function wheelClassFamilyOwnerByMember(
  nodes: readonly WheelClassTreeNode[],
): ReadonlyMap<string, string> {
  const byMember = new Map<string, string>();
  for (const family of wheelClassFamilies(nodes)) {
    if (!family.isClass) continue;
    for (const child of family.children) byMember.set(child.id, family.id);
  }
  return byMember;
}
