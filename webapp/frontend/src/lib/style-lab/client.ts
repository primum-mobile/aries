// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  daemonBaseUrl,
  daemonFetch,
  type ChartPickerRow,
} from "@/lib/daemon/client";
import type {
  ChartStyleFontRef,
  ChartStyleProfileV2,
} from "@/lib/style-lab/authoring-schema";
import { WHEEL_AUTHORING_OVERRIDE_PREFIX } from "@/lib/style-lab/wheel-authoring-adapter";

export type StyleLabScalarValue = string | number | readonly number[];
export type StyleLabTokenValue = StyleLabScalarValue | ChartStyleFontRef;
export const APP_AUTHORING_OVERRIDE_PREFIX = "authoring.app." as const;

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
  /** Combined editor delta; the client routes profile-v2 keys separately. */
  overrides: Record<string, StyleLabTokenValue | null>;
};

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

export type StyleLabPreviewValue = string | number | boolean;

export type StyleLabPreviewChoice = Readonly<{
  value: StyleLabPreviewValue;
  label: string;
  labelKey?: string;
}>;

export type StyleLabPreviewDependency = Readonly<{
  fieldId: string;
  equals?: StyleLabPreviewValue;
  in?: readonly StyleLabPreviewValue[];
}>;

export type StyleLabPreviewField = Readonly<{
  id: string;
  group: string;
  type: "boolean" | "enum";
  label: string;
  labelKey?: string;
  defaultValue: StyleLabPreviewValue;
  choices?: readonly StyleLabPreviewChoice[];
  dependsOn?: StyleLabPreviewDependency;
  applicability: readonly ("single" | "comparison")[];
}>;

export type StyleLabPreviewManifest = Readonly<{
  schemaVersion: number;
  groups: readonly Readonly<{
    id: string;
    label: string;
    labelKey?: string;
  }>[];
  fields: readonly StyleLabPreviewField[];
  fixtureState: readonly Readonly<{
    id: "surveilStudyId" | "eventFixtureId" | "parallelTransitFixtureId";
    type: "reference";
    label: string;
    applicability: "unavailable" | "available";
    available: boolean;
    reason?: string;
  }>[];
}>;

export type StyleLabChartSources = Readonly<{
  primaryId: string;
  comparisonId?: string;
}>;

export type StyleLabFixtureState = Readonly<{
  surveilStudyId?: string;
  eventFixtureId?: string;
  parallelTransitFixtureId?: string;
}>;

export type StyleLabPreviewRequest = Readonly<{
  chartSources: StyleLabChartSources;
  previewOptions: Readonly<Record<string, StyleLabPreviewValue>>;
  fixtureState: StyleLabFixtureState;
}>;

export class StyleLabApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StyleLabApiError";
    this.status = status;
  }
}

const CURRENT_DRAFT_PATH = "/api/style-lab/drafts/current";

export function styleLabChartSourceId(row: ChartPickerRow): string {
  return row.key;
}

export function styleLabPreviewDefaults(
  manifest: StyleLabPreviewManifest,
): Record<string, StyleLabPreviewValue> {
  return Object.fromEntries(
    manifest.fields.map((field) => [field.id, field.defaultValue]),
  );
}

export function styleLabPreviewRequestKey(request: StyleLabPreviewRequest): string {
  const previewOptions = Object.fromEntries(
    Object.entries(request.previewOptions).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({
    chartSources: request.chartSources,
    previewOptions,
    fixtureState: request.fixtureState,
  });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const rawDetail = (await response.text()).trim();
    let detail = rawDetail;
    if (rawDetail) {
      try {
        const payload = JSON.parse(rawDetail) as {
          detail?: string | readonly { msg?: string }[];
        };
        if (typeof payload.detail === "string") {
          detail = payload.detail;
        } else if (Array.isArray(payload.detail)) {
          detail = payload.detail
            .map((entry) => entry.msg)
            .filter((message): message is string => Boolean(message))
            .join("; ");
        }
      } catch {
        // Preserve a non-JSON daemon error verbatim.
      }
    }
    throw new StyleLabApiError(
      detail || `Style Lab request failed (${response.status})`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function fetchStyleLabPreviewManifest(
  signal?: AbortSignal,
): Promise<StyleLabPreviewManifest> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/preview-schema`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  return readJson<StyleLabPreviewManifest>(response);
}

export async function fetchStyleLabPreviewSnapshot(
  request: StyleLabPreviewRequest,
  signal?: AbortSignal,
): Promise<ChartRenderSnapshot> {
  const response = await daemonFetch(`${daemonBaseUrl()}/api/style-lab/preview-snapshot`, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  return readJson<ChartRenderSnapshot>(response);
}

export async function fetchCurrentStyleLabDraft(
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(`${daemonBaseUrl()}${CURRENT_DRAFT_PATH}`, {
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
): Promise<StyleLabPortableProfile> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}/api/style-lab/drafts/${encodeURIComponent(draftId)}/export`,
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
  const response = await daemonFetch(`${daemonBaseUrl()}${CURRENT_DRAFT_PATH}`, {
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
}

export async function commitCurrentStyleLabDraft(
  options: { baseRevision?: number; activate?: false; discard?: boolean } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}${CURRENT_DRAFT_PATH}/commit`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal,
    },
  );
  return readJson<StyleLabDraft>(response);
}

export async function saveCurrentStyleLabDraftAsTheme(
  name: string,
  options: {
    baseRevision?: number;
    overrides?: Readonly<Record<string, StyleLabTokenValue | null>>;
    activate?: boolean;
    promoteWorkingCopy?: boolean;
  } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const { overrides = {}, ...requestOptions } = options;
  const channels = splitStyleLabEditorPatch(overrides);
  const response = await daemonFetch(
    `${daemonBaseUrl()}${CURRENT_DRAFT_PATH}/save-as`,
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
  options: { baseRevision?: number; factoryDefault?: boolean } = {},
  signal?: AbortSignal,
): Promise<StyleLabDraft> {
  const response = await daemonFetch(
    `${daemonBaseUrl()}${CURRENT_DRAFT_PATH}/revert`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(options),
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
