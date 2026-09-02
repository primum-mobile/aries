// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * References between style tokens — one token following another.
 *
 * Picking a role used to copy its colour, which answered "make this the same as
 * the planet glyphs" only at the moment of picking: changing the role afterwards
 * left every copy behind. A reference is the difference between a colour that
 * *is* the role and a colour that once *matched* it.
 *
 * The grammar is the design-token standard's: an override whose value is
 * `{chart.color.signs}` follows that token instead of carrying a colour. Braces
 * make the intent unmistakable next to the literal forms — no CSS colour and no
 * number begins with one — so a reference can share the value slot without a
 * parallel map that could fall out of step with it.
 *
 * This module owns the grammar and the resolution, and nothing else. It holds no
 * state and knows no token catalog; the caller says what a token is worth when
 * nothing overrides it.
 */

import type { StyleLabTokenValue } from "@/lib/style-lab/client";

const ALIAS_PATTERN = /^\{([A-Za-z0-9][A-Za-z0-9_.-]*)\}$/;

/** The token a value follows, or null when the value is a literal. */
export function styleTokenAliasTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ALIAS_PATTERN.exec(value.trim());
  return match ? match[1] : null;
}

/** The value that makes a token follow `semanticId`. */
export function styleTokenAliasValue(semanticId: string): string {
  return `{${semanticId}}`;
}

/**
 * What a token is worth when no override carries it — the theme being edited,
 * or the factory value. Returning null means the token has no value at all,
 * which leaves a reference to it unresolvable.
 */
export type StyleTokenBaseReader = (
  semanticId: string,
) => StyleLabTokenValue | null | undefined;

/**
 * Follow one reference chain to the value at its end.
 *
 * A chain that revisits a token is cut there and resolved from that token's
 * base value instead: a cycle is an authoring mistake, and painting nothing at
 * all would punish it far past what it costs. `null` means the chain ended at a
 * token with no value.
 */
export function resolveStyleTokenValue(
  semanticId: string,
  overrides: Readonly<Record<string, StyleLabTokenValue>>,
  readBaseValue: StyleTokenBaseReader,
): StyleLabTokenValue | null {
  const seen = new Set<string>();
  let current = semanticId;
  for (;;) {
    const overridden = Object.hasOwn(overrides, current)
      ? overrides[current]
      : undefined;
    const target = seen.has(current) ? null : styleTokenAliasTarget(overridden);
    if (target == null) {
      const literal = seen.has(current) ? undefined : overridden;
      return literal ?? readBaseValue(current) ?? null;
    }
    seen.add(current);
    current = target;
  }
}

/**
 * The override map with every reference replaced by the value it follows.
 *
 * Everything that paints reads this rather than the authored map, so a
 * reference is invisible downstream — the renderer, the exporters and the CSS
 * layer keep receiving plain values and cannot tell the two apart. An
 * unresolvable reference is dropped rather than passed on, because a brace
 * string reaching a painter would be drawn as a broken colour.
 */
export function resolveStyleTokenAliases(
  overrides: Readonly<Record<string, StyleLabTokenValue>>,
  readBaseValue: StyleTokenBaseReader,
): Record<string, StyleLabTokenValue> {
  let hasAlias = false;
  for (const value of Object.values(overrides)) {
    if (styleTokenAliasTarget(value) != null) {
      hasAlias = true;
      break;
    }
  }
  // The common map has no references at all, and rebuilding it on every edit
  // would cost every consumer a new identity for nothing.
  if (!hasAlias) return overrides as Record<string, StyleLabTokenValue>;

  const resolved: Record<string, StyleLabTokenValue> = {};
  for (const [semanticId, value] of Object.entries(overrides)) {
    if (styleTokenAliasTarget(value) == null) {
      resolved[semanticId] = value;
      continue;
    }
    const literal = resolveStyleTokenValue(semanticId, overrides, readBaseValue);
    if (literal != null && styleTokenAliasTarget(literal) == null) {
      resolved[semanticId] = literal;
    }
  }
  return resolved;
}
