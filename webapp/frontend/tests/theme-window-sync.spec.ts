// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { normalizeThemeState } from "../src/lib/theme/style-state.mjs";
import {
  createThemeWindowPublisher,
  resolveWindowThemeAppearance,
  type WindowThemeAppearance,
} from "../src/lib/shell/theme-window-sync";

const saved = normalizeThemeState({
  activePreset: "Saved", mode: "dark", version: 1, paletteHash: "saved",
  appTokens: { "--aries-background": "#121212" },
  chartPalette: { "--morinus-frame": "#eeeeee" },
  profileOverrides: {
    appAuthoring: { "authoring.app.overlay.pattern": "paper" },
    wheelAuthoring: { "not-needed-by-window-chrome": 42 },
  },
})!;

test("all window chrome receives the effective live palette and materials, then the saved appearance on discard", () => {
  const preview = {
    sourceThemeName: "Draft", mode: "light" as const,
    appTokens: { "--aries-background": "#ffffff", "--draft-only": "#abcdef" },
    chartPalette: { "--morinus-frame": "#123456" },
    appAuthoring: { "authoring.app.overlay.pattern": "blueNoise" },
  };
  const draft = resolveWindowThemeAppearance(saved, preview);
  expect(draft).toMatchObject({
    preset: "Draft", mode: "light", preview: true,
    appTokens: preview.appTokens, chartPalette: preview.chartPalette,
    appAuthoring: preview.appAuthoring,
  });
  const restored = resolveWindowThemeAppearance(saved);
  expect(restored).toMatchObject({
    preset: "Saved", mode: "dark", preview: false,
    appTokens: saved.appTokens, chartPalette: saved.chartPalette,
    appAuthoring: saved.profileOverrides.appAuthoring,
  });
  expect(restored.appTokens).not.toHaveProperty("--draft-only");
  expect(restored).not.toHaveProperty("wheelAuthoring");
  expect(saved.appTokens["--aries-background"]).toBe("#121212");
});

test("slow window IPC coalesces intermediate previews without losing the final saved palette", async () => {
  const delivered: WindowThemeAppearance[] = [];
  let completeFirst!: () => void;
  const firstSend = new Promise<void>(resolve => { completeFirst = resolve; });
  const publisher = createThemeWindowPublisher(async appearance => {
    if (!delivered.length) await firstSend;
    delivered.push(appearance);
  }, error => { throw error; });
  const first = resolveWindowThemeAppearance(saved);
  const final = { ...first, mode: "light" as const, styleHash: "new-saved", styleRevision: 2 };
  publisher.publish(first);
  publisher.publish({ ...first, preview: true, preset: "intermediate" });
  publisher.publish(final);
  completeFirst();
  await expect.poll(() => delivered.length).toBe(2);
  expect(delivered).toEqual([first, final]);
  publisher.dispose();
  publisher.publish(first);
  expect(delivered).toHaveLength(2);
});

test("a failed send does not block later theme changes", async () => {
  const errors: unknown[] = [];
  const delivered: WindowThemeAppearance[] = [];
  const publisher = createThemeWindowPublisher(async appearance => {
    if (appearance.preset === "Saved") throw new Error("window closing");
    delivered.push(appearance);
  }, error => errors.push(error));
  const initial = resolveWindowThemeAppearance(saved);
  publisher.publish(initial);
  publisher.publish({ ...initial, preset: "Next" });
  await expect.poll(() => delivered.length).toBe(1);
  expect(errors).toHaveLength(1);
  expect(delivered[0].preset).toBe("Next");
  publisher.dispose();
});
