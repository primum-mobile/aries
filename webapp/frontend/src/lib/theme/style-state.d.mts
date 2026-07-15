import type { ThemeState } from "../daemon/client";

export type NormalizedOptionsStyleIdentity = {
  schemaVersion: number;
  themeVersion: number;
  styleRevision: number;
  paletteHash: string;
  styleHash: string;
};

export function normalizeThemeState(value: unknown): ThemeState | null;

export function normalizeOptionsStyleIdentity(value: {
  schemaVersion?: number | null;
  themeVersion?: number | null;
  styleRevision?: number | null;
  paletteHash?: string | null;
  styleHash?: string | null;
}): NormalizedOptionsStyleIdentity;

export function styleRevisionKey(
  theme: ThemeState | null | undefined,
): string;
