// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WheelComposition } from "@/lib/chart/wheel-composition";
import type { WheelTypographyProfile } from "@/lib/chart/wheel-render-style";
import type { WheelPresetsState } from "@/lib/daemon/wheel-presets-client";
import {
  daemonBaseUrl,
  daemonFetch,
  type ThemeState,
} from "@/lib/daemon/client";
import type {
  ChartStyleFontRef,
  ChartStyleProfileV2,
} from "@/lib/style-lab/authoring-schema";
import { WHEEL_AUTHORING_OVERRIDE_PREFIX } from "@/lib/style-lab/wheel-authoring-adapter";

export type StyleLabScalarValue = string | number | readonly number[];
export type StyleLabTokenValue = StyleLabScalarValue | boolean | ChartStyleFontRef;
export const APP_AUTHORING_OVERRIDE_PREFIX = "authoring.app." as const;

export type StyleLabWheelBaseline = {
  geometry?: {schemaVersion: 1; layout: WheelTypographyProfile | null;
    designs: Partial<Record<WheelTypographyProfile, {overrides: Record<string, StyleLabTokenValue>;
      appearance?: Record<string, StyleLabTokenValue>; composition: WheelComposition}>>};
  visibility?: Partial<Record<WheelTypographyProfile, Record<string, boolean>>>;
};

export type StyleLabDraft = {
  kind?: "aries.style-draft";
  draftSchemaVersion?: number;
  tokenSchemaVersion?: number;
  id: string;
  draftId?: string;
  revision: number;
  etag?: string;
  profileId?: string;
  name?: string;
  scope?: "app" | "chart" | "combined";
  basePresetId?: string | null;
  sourceThemeName?: string | null;
  modifiedFromBaseline?: boolean;
  wheelBaseline?: StyleLabWheelBaseline;
  wheelPresets?: WheelPresetsState;
  overrides: Record<string, StyleLabTokenValue>;
  authoringOverrides?: Record<string, StyleLabTokenValue>;
  appAuthoringOverrides?: Record<string, StyleLabTokenValue>;
  chartStyleProfileV2?: ChartStyleProfileV2;
  updatedAt?: string | null;
};

export type StyleLabThemeSource = Readonly<{
  name: string;
  label: string;
  profileId: string | null;
  deletable: boolean;
  system?: boolean;
  factoryModified?: boolean;
  modified?: boolean;
  mode: "light" | "dark";
  selected?: boolean;
  basePresetId: string | null;
  appTokens: Readonly<Record<string, string>>;
  chartPalette: Readonly<Record<string, string>>;
  chartData: ThemeState["profileOverrides"]["chartData"];
  appAuthoring: Readonly<Record<string, StyleLabScalarValue>>;
}>;

export type AppAuthoringPropertySchema = Readonly<{
  type: "color" | "number" | "integer" | "enum";
  supportsAlpha?: boolean;
  min?: number;
  max?: number;
  unit?: "%" | "deg" | "px";
  values?: readonly string[];
}>;

export type AppAuthoringSchema = Readonly<{
  classManifestVersion: string;
  overridePrefix: typeof APP_AUTHORING_OVERRIDE_PREFIX;
  keyPattern: string;
  properties: Readonly<Record<string, AppAuthoringPropertySchema>>;
  classes: readonly Readonly<{
    classId: string;
    properties: readonly string[];
  }>[];
}>;

export type StyleLabPatch = {
  baseRevision: number | null;
  draftId?: string;
  /** Combined editor delta; the client routes profile-v2 keys separately. */
  overrides: Record<string, StyleLabTokenValue | null>;
};

let styleDraftWrites: Promise<unknown> = Promise.resolve();
function enqueueStyleDraftWrite<T>(write: () => Promise<T>): Promise<T> {
  const request = styleDraftWrites.then(write, write);
  styleDraftWrites = request;
  return request;
}

export async function waitForStyleDraftWrites(): Promise<void> {
  let current;
  do { current = styleDraftWrites; await current.catch(() => undefined); } while (current !== styleDraftWrites);
}

export function styleLabDraftEditorOverrides(
  draft: Pick<
    StyleLabDraft,
    "overrides" | "authoringOverrides" | "appAuthoringOverrides"
  >,
): Record<string, StyleLabTokenValue> {
  return {
    ...(draft.overrides ?? {}),
    ...(draft.authoringOverrides ?? {}),
    ...(draft.appAuthoringOverrides ?? {}),
  };
}

export function splitStyleLabEditorPatch(
  overrides: Readonly<Record<string, StyleLabTokenValue | null>>,
): Readonly<{
  overrides: Record<string, StyleLabTokenValue | null>;
  authoringOverrides: Record<string, StyleLabTokenValue | null>;
  appAuthoringOverrides: Record<string, StyleLabTokenValue | null>;
}> {
  const legacy: Record<string, StyleLabTokenValue | null> = {};
  const authoring: Record<string, StyleLabTokenValue | null> = {};
  const appAuthoring: Record<string, StyleLabTokenValue | null> = {};
  for (const [semanticId, value] of Object.entries(overrides)) {
    if (semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX)) {
      authoring[semanticId] = value;
    } else if (semanticId.startsWith(APP_AUTHORING_OVERRIDE_PREFIX)) {
      appAuthoring[semanticId] = value;
    } else {
      legacy[semanticId] = value;
    }
  }
  return {
    overrides: legacy,
    authoringOverrides: authoring,
    appAuthoringOverrides: appAuthoring,
  };
}

export class StyleLabApiError extends Error {
  readonly status: number;
  /** Every edit the daemon refused by id; nothing else in the request applied. */
  readonly rejectedIds: readonly string[];

  constructor(message: string, status: number, rejectedIds: readonly string[] = []) {
    super(message);
    this.name = "StyleLabApiError";
    this.status = status;
    this.rejectedIds = rejectedIds;
  }
}

const CURRENT_DRAFT_PATH = "/api/style-lab/drafts/current";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const rawDetail = (await response.text()).trim();
    let detail = rawDetail;
    let rejectedIds: readonly string[] = [];
    if (rawDetail) {
      try {
        const payload = JSON.parse(rawDetail) as {
          detail?: string | { message?: string; rejectedIds?: unknown } | readonly { msg?: string }[];
        };
        if (typeof payload.detail === "string") {
          detail = payload.detail;
        } else if (Array.isArray(payload.detail)) {
          detail = payload.detail
            .map((entry) => entry.msg)
            .filter((message): message is string => Boolean(message))
            .join("; ");
        } else if (payload.detail && "message" in payload.detail && typeof payload.detail.message === "string") {
          detail = payload.detail.message;
          const ids = payload.detail.rejectedIds;
          if (Array.isArray(ids)) rejectedIds = ids.filter((id): id is string => typeof id === "string");
        }
      } catch {
        // Preserve a non-JSON daemon error verbatim.
      }
    }
    throw new StyleLabApiError(
      detail || `Style Lab request failed (${response.status})`,
      response.status,
      rejectedIds,
    );
  }
  return (await response.json()) as T;
}

export async function fetchCurrentStyleLabDraft(
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  return fetchStyleLabDraft('current', signal);
}

export async function fetchStyleLabDraft(draftId: string, signal?: AbortSignal): Promise<StyleLabDraft> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return readJson<StyleLabDraft>(response);
}

export async function fetchWorkingStyleLabDraft(
  sourceThemeName: string,
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const query = new URLSearchParams({ sourceThemeName });
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/working-draft?${query}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export type StyleLabPortableProfile = Readonly<{
  kind: "aries.style-profile";
  id: string;
  name: string;
  scope: "app" | "chart" | "combined";
  basePresetId: string | null;
  [key: string]: unknown;
}>;

export async function fetchStyleLabDraftExport(
  draftId = "current",
  signal?: AbortSignal,
  context?: {sourceThemeName: string; expectedWheelRevision: number},
): Promise<StyleLabPortableProfile> {
  const query = context ? `?${new URLSearchParams({sourceThemeName: context.sourceThemeName,
    expectedWheelRevision: String(context.expectedWheelRevision)})}` : '';
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}/export${query}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  return readJson<StyleLabPortableProfile>(response);
}

export async function fetchStyleLabThemeSources(
  signal?: AbortSignal,
): Promise<readonly StyleLabThemeSource[]> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/theme-sources`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await readJson<{ sources: StyleLabThemeSource[] }>(response);
  return payload.sources;
}

export async function fetchAppAuthoringSchema(
  signal?: AbortSignal,
): Promise<AppAuthoringSchema> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/app-authoring-schema`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  return readJson<AppAuthoringSchema>(response);
}

export async function createCurrentStyleLabDraft(
  name: string,
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/drafts`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      profileId: "chart-style-working",
      name,
      scope: "combined",
    }),
    signal,
  });
  return readJson<StyleLabDraft>(response);
}

export async function createStyleLabDraftFromTheme(
  sourceThemeName: string,
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/drafts`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ sourceThemeName }),
    signal,
  });
  return readJson<StyleLabDraft>(response);
}

export async function patchCurrentStyleLabDraft(
  patch: StyleLabPatch,
  etag?: string | null,
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const channels = splitStyleLabEditorPatch(patch.overrides);
  return enqueueStyleDraftWrite(async () => {
    const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(patch.draftId ?? 'current')}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: JSON.stringify({ baseRevision: patch.baseRevision, ...channels }),
    signal,
  });
    return readJson<StyleLabDraft>(response);
  });
}

export async function commitCurrentStyleLabDraft(
  options: { draftId?: string; baseRevision?: number; activate?: false; discard?: boolean;
    sourceThemeName?: string; expectedWheelRevision?: number } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const {draftId = 'current', ...payload} = options;
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}/commit`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export async function saveCurrentStyleLabDraftAsTheme(
  name: string,
  options: {
    draftId?: string;
    baseRevision?: number;
    overrides?: Readonly<Record<string, StyleLabTokenValue | null>>;
    activate?: boolean;
    promoteWorkingCopy?: boolean;
    sourceThemeName?: string;
    expectedWheelRevision?: number;
  } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const { draftId = 'current', overrides = {}, ...requestOptions } = options;
  const channels = splitStyleLabEditorPatch(overrides);
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}/save-as`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestOptions, ...channels, name }),
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export async function revertCurrentStyleLabDraft(
  options: { draftId?: string; baseRevision?: number; factoryDefault?: boolean;
    sourceThemeName?: string; expectedWheelRevision?: number } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const {draftId = 'current', ...payload} = options;
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}/revert`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export async function discardCurrentStyleLabDraft(
  options: { baseRevision?: number; etag?: string | null } = {},
  signal?: AbortSignal,
): Promise<void> {
  const query = new URLSearchParams();
  if (options.baseRevision != null) {
    query.set("baseRevision", String(options.baseRevision));
  }
  const response = await daemonFetch(
    `${daemonBaseUrl()}${CURRENT_DRAFT_PATH}${query.size ? `?${query}` : ""}`,
    {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.etag ? { "If-Match": options.etag } : {}),
      },
      signal,
    },
  );
  await readJson(response);
}

export async function importStyleLabTheme(
  profile: unknown,
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/themes/import`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export async function renameStyleLabTheme(
  profileId: string,
  name: string,
  signal?: AbortSignal,
): Promise<Readonly<{ renamed: true; profileId: string; themeName: string; label: string }>> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/themes/${encodeURIComponent(profileId)}`,
    {
      method: "PATCH",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal,
    },
  );
  return readJson<Readonly<{ renamed: true; profileId: string; themeName: string; label: string }>>(response);
}

export async function deleteStyleLabTheme(
  profileId: string,
  signal?: AbortSignal,
): Promise<Readonly<{
  deleted: true;
  deletedProfileId: string;
  deletedThemeName: string;
}>> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/themes/${encodeURIComponent(profileId)}`,
    {
      method: "DELETE",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  return readJson<Readonly<{
    deleted: true;
    deletedProfileId: string;
    deletedThemeName: string;
  }>>(response);
}
