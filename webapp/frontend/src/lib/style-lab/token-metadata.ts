// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import Color from "colorjs.io";

import type { StyleLabTokenValue } from "@/lib/style-lab/client";
import type { ChartStyleTokenMetadata } from "@/stores/chart-style-editor-store";
import publicCatalogJson from "@/styles/style-token-public.generated.json";

type PublicStyleToken = {
  semanticId: string;
  cssVar: string;
  label: string;
  description: string;
  type: "color" | "number" | "font-family";
  unit: string;
  default: string | number;
  bounds?: { min: number; max: number; step: number };
  dependencies?: string[];
};

type PublicCatalog = { tokens: PublicStyleToken[] };

function colorDefault(value: string | number): number[] | null {
  try {
    const srgb = new Color(String(value)).to("srgb").toGamut();
    const rgb = srgb.coords.map((channel) =>
      Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255))),
    );
    return srgb.alpha < 1 ? [...rgb, srgb.alpha] : rgb;
  } catch {
    return null;
  }
}

const catalog = publicCatalogJson as PublicCatalog;
const tokenByCssVar = new Map(catalog.tokens.map((token) => [token.cssVar, token]));
const CSS_VAR_ALIAS = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;

function catalogDefault(
  token: PublicStyleToken,
  seen: ReadonlySet<string> = new Set(),
): StyleLabTokenValue {
  if (token.type === "number") {
    const number = typeof token.default === "number"
      ? token.default
      : Number.parseFloat(token.default);
    return Number.isFinite(number) ? number : (token.bounds?.min ?? 0);
  }
  if (token.type === "color") {
    const literal = colorDefault(token.default);
    if (literal) return literal;
    const cssVar = CSS_VAR_ALIAS.exec(String(token.default).trim())?.[1];
    const target = cssVar ? tokenByCssVar.get(cssVar) : undefined;
    if (target && !seen.has(target.semanticId)) {
      return catalogDefault(target, new Set([...seen, token.semanticId]));
    }
    return [128, 128, 128];
  }
  return String(token.default);
}

export const STYLE_LAB_TOKEN_METADATA: readonly ChartStyleTokenMetadata[] =
  catalog.tokens.map((token) => ({
    semanticId: token.semanticId,
    cssVar: token.cssVar,
    label: token.label,
    description: token.description,
    type: token.type,
    unit: token.unit,
    defaultValue: catalogDefault(token),
    defaultReference: (() => {
      const cssVar = CSS_VAR_ALIAS.exec(String(token.default).trim())?.[1];
      return cssVar ? tokenByCssVar.get(cssVar)?.semanticId : undefined;
    })(),
    bounds: token.bounds,
    supportsAlpha: token.type === "color",
  }));
