import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  daemonBaseUrl,
  daemonFetch,
  type ChartPickerRow,
} from "@/lib/daemon/client";
import type { ChartStyleProfileV2 } from "@/lib/style-lab/authoring-schema";
import { WHEEL_AUTHORING_OVERRIDE_PREFIX } from "@/lib/style-lab/wheel-authoring-adapter";

export type StyleLabTokenValue = string | number | readonly number[];

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
  overrides: Record<string, StyleLabTokenValue>;
  authoringOverrides?: Record<string, StyleLabTokenValue>;
  chartStyleProfileV2?: ChartStyleProfileV2;
  updatedAt?: string | null;
};

export type StyleLabPatch = {
  baseRevision: number | null;
  /** Combined editor delta; the client routes profile-v2 keys separately. */
  overrides: Record<string, StyleLabTokenValue | null>;
};

export function styleLabDraftEditorOverrides(
  draft: Pick<StyleLabDraft, "overrides" | "authoringOverrides">,
): Record<string, StyleLabTokenValue> {
  return {
    ...(draft.overrides ?? {}),
    ...(draft.authoringOverrides ?? {}),
  };
}

export function splitStyleLabEditorPatch(
  overrides: Readonly<Record<string, StyleLabTokenValue | null>>,
): Readonly<{
  overrides: Record<string, StyleLabTokenValue | null>;
  authoringOverrides: Record<string, StyleLabTokenValue | null>;
}> {
  const legacy: Record<string, StyleLabTokenValue | null> = {};
  const authoring: Record<string, StyleLabTokenValue | null> = {};
  for (const [semanticId, value] of Object.entries(overrides)) {
    (semanticId.startsWith(WHEEL_AUTHORING_OVERRIDE_PREFIX) ? authoring : legacy)[semanticId] = value;
  }
  return { overrides: legacy, authoringOverrides: authoring };
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
    const detail = (await response.text()).trim();
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
      scope: "chart",
    }),
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
