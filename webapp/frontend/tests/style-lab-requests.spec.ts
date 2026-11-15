// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import {
  fetchStyleLabDraft,
  StyleLabApiError,
  waitForStyleDraftWrites,
  type StyleLabDraft,
} from "../src/lib/style-lab/client";
import { StyleLabInputError, styleLabRequestErrorMessage } from "../src/lib/style-lab/request-error";
import { saveWorkingTheme, styleLabPatchIsSuperseded } from "../src/lib/style-lab/theme-session";
import { waitForWheelPresetWrites } from "../src/lib/daemon/wheel-preset-sync";
import { WheelPresetApiError } from "../src/lib/daemon/wheel-presets-client";
import { useChartStyleEditorStore } from "../src/stores/chart-style-editor-store";
import en from "../src/locales/en.json";
import type { TFunc } from "../src/lib/i18n/i18n";

const originalFetch = globalThis.fetch;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const t: TFunc = (key, params) => {
  const message = en[key as keyof typeof en] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
};

test.afterEach(async () => {
  await waitForStyleDraftWrites();
  await waitForWheelPresetWrites();
  globalThis.fetch = originalFetch;
});

test("structured revision errors preserve the daemon message without serializing the draft into it", async () => {
  globalThis.fetch = async () => response({ detail: {
    message: "The style draft changed elsewhere.", current: { id: "private-draft", revision: 7 },
  } }, 412);
  await expect(fetchStyleLabDraft("current")).rejects.toMatchObject({
    status: 412, message: "The style draft changed elsewhere.",
  });
});

test("connection, missing draft, rejected requests and wheel conflicts have distinct localized errors", () => {
  const detail = "authoring.wheel.anglo.bodies.inner.glyph.fontSize must be finite";
  expect(styleLabRequestErrorMessage(new TypeError("Failed to fetch"), t)).toBe(en["styleLab.status.connectionFailed"]);
  expect(styleLabRequestErrorMessage(new StyleLabApiError(detail, 404), t)).toBe(en["styleLab.status.draftUnavailable"]);
  expect(styleLabRequestErrorMessage(new StyleLabApiError(detail, 400), t)).toContain("400");
  expect(styleLabRequestErrorMessage(new StyleLabApiError(detail, 400), t)).not.toContain("authoring.wheel");
  expect(styleLabRequestErrorMessage(new WheelPresetApiError(409), t)).toBe(en["styleLab.status.conflictDetail"]);
  expect(styleLabRequestErrorMessage(new StyleLabInputError(en["styleLab.import.invalidFile"]), t)).toBe(en["styleLab.import.invalidFile"]);
});

test("a failed theme commit remains dirty and retry commits again even with no pending appearance delta", async () => {
  const draft: StyleLabDraft = {
    id: "retry-theme", sourceThemeName: "Daylight", revision: 7, etag: "revision-7",
    overrides: { "app.color.background": [1, 2, 3] }, modifiedFromBaseline: true,
  };
  useChartStyleEditorStore.setState({
    semanticOverrides: {}, syncedOverrides: {}, geometryOverrides: {}, syncedGeometryOverrides: {},
    geometryProfile: null, wheelPresetState: null, gestureStart: null, geometryTransition: false,
  });
  useChartStyleEditorStore.getState().acceptRemoteDraft(draft, { clearHistory: true });
  let commits = 0;
  let patches = 0;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (init?.method === "PATCH") patches++;
    if (path.endsWith("/drafts/retry-theme/commit")) {
      commits++;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        baseRevision: 7, sourceThemeName: "Daylight", expectedWheelRevision: 9,
      });
      if (commits === 1) return response({ detail: "temporary write failure" }, 500);
      return response({ ...draft, modifiedFromBaseline: false });
    }
    if (path.endsWith("/drafts/retry-theme")) return response(draft);
    if (path.endsWith("/options/wheel-presets")) return response({
      context: { sourceThemeName: "Daylight", revision: 9 },
    });
    throw new Error(path);
  };
  await expect(saveWorkingTheme("conflict")).rejects.toMatchObject({ status: 500 });
  expect(useChartStyleEditorStore.getState().remoteModifiedFromBaseline).toBe(true);
  await expect(saveWorkingTheme("conflict")).resolves.toMatchObject({ modifiedFromBaseline: false });
  expect(commits).toBe(2);
  expect(patches).toBe(0);
  expect(useChartStyleEditorStore.getState().semanticOverrides).toEqual(draft.overrides);
});

test("late failures from repeated changes cannot reject the final value or resurrect a deleted override", async () => {
  const id = "authoring.wheel.anglo.bodies.inner.glyph.fontSize";
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const { patchCurrentStyleLabDraft } = await import("../src/lib/style-lab/client");
  const { syncDelta } = await import("../src/lib/style-lab/theme-session");
  const store = useChartStyleEditorStore.getState();
  store.acceptRemoteDraft({ id: "burst", revision: 1, overrides: {}, authoringOverrides: { [id]: 12 } });
  store.setOverride(id, 13);
  const current = useChartStyleEditorStore.getState();
  const sent = syncDelta(current.syncedOverrides, current.semanticOverrides);
  globalThis.fetch = async () => {
    started();
    await held;
    return response({ detail: `${id} was refused` }, 400);
  };
  const pending = patchCurrentStyleLabDraft({ draftId: "burst", baseRevision: 1, overrides: sent });
  await requestStarted;
  for (let value = 14; value <= 60; value++) store.setOverride(id, value);
  release();
  await expect(pending).rejects.toMatchObject({ status: 400 });
  expect(styleLabPatchIsSuperseded(sent, useChartStyleEditorStore.getState().semanticOverrides)).toBe(true);
  expect(useChartStyleEditorStore.getState().semanticOverrides[id]).toBe(60);
  expect(styleLabPatchIsSuperseded({ [id]: 60 }, useChartStyleEditorStore.getState().semanticOverrides)).toBe(false);
  store.resetProperty(id);
  expect(styleLabPatchIsSuperseded({ [id]: 60 }, useChartStyleEditorStore.getState().semanticOverrides)).toBe(true);
  expect(styleLabPatchIsSuperseded({ [id]: null }, useChartStyleEditorStore.getState().semanticOverrides)).toBe(false);
});

test("a refused patch carries every rejected id the daemon named", async () => {
  const { patchCurrentStyleLabDraft } = await import("../src/lib/style-lab/client");
  const ray = "authoring.wheel.base.angles.outer.ray.fontSize";
  globalThis.fetch = async () => response({
    detail: { message: "angles.outer.ray does not support authoring property fontSize", rejectedIds: [ray] },
  }, 400);
  await expect(patchCurrentStyleLabDraft({ draftId: "named", baseRevision: 1, overrides: { [ray]: 14 } }))
    .rejects.toMatchObject({ status: 400, rejectedIds: [ray] });
});

test("a revision refresh during repeated edits retains the gesture and rebases its undo origin", () => {
  const size = "authoring.wheel.anglo.bodies.inner.glyph.fontSize";
  const color = "app.color.background";
  const draft: StyleLabDraft = { id: "gesture", revision: 1, overrides: {
    [color]: [1, 2, 3],
  }, authoringOverrides: { [size]: 12 } };
  const store = useChartStyleEditorStore.getState();
  store.acceptRemoteDraft(draft, { clearHistory: true });
  store.beginGesture("inspector");
  store.setOverride(size, 13);
  store.acceptRemoteDraft({ ...draft, revision: 2, overrides: { [color]: [4, 5, 6] } }, { preserveLocalChanges: true });
  expect(useChartStyleEditorStore.getState().gestureOwner).toBe("inspector");
  for (let value = 14; value <= 30; value++) store.setOverride(size, value);
  store.endGesture("inspector");
  expect(useChartStyleEditorStore.getState().undoStack).toHaveLength(1);
  expect(useChartStyleEditorStore.getState().semanticOverrides[size]).toBe(30);
  store.undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides[size]).toBe(12);
  expect(useChartStyleEditorStore.getState().semanticOverrides[color]).toEqual([4, 5, 6]);
});
