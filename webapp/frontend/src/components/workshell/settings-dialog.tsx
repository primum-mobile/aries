// SPDX-FileCopyrightText: Morinus contributors
// SPDX-FileCopyrightText: 2026 Max Lange (Aries modifications)
// SPDX-License-Identifier: GPL-3.0-or-later
// Modified for Aries in 2026 by Max Lange.

"use client";

import { WheelPresetControls } from "./wheel-preset-controls";
import { useShallow } from "zustand/react/shallow";
import { applyWheelTheme } from "@/lib/daemon/wheel-theme-transition";
import { wheelTypographyProfileForTheme } from "@/lib/chart/wheel-render-style";
import { settingsColorPreviewMatchesTheme } from "@/lib/chart/palette";
import {
  ECLIPSE_MARKER,
  FORTUNE_GLYPH,
  PLANET_GLYPHS,
  SE_CHIRON,
  SE_MEAN_APOG,
  SE_MEAN_NODE,
  SYZYGY_MARKER,
  VERTEX_GLYPH,
} from "@/lib/chart/glyphs";
import * as React from "react";

import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, FloatingDialogContent, NativeDialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createAstrocartStyleMessage } from "@/lib/chart/astrocart-style";
import { appUiFontStack } from "@/lib/chart/astrocart-ui-font";
import {
  FORTUNE_REVERSED_BY_NIGHT,
  FORTUNE_SAME_DAY_NIGHT,
  corpusDisciplinesCached,
  daemonBaseUrl,
  deleteCustomCorpusSemanticProfile,
  daemonFetch,
  exportArabicParts,
  fetchAsteroidCatalog,
  fetchCorpusSemanticProfiles,
  fetchOptions,
  importArabicParts,
  invalidateCorpusDisciplines,
  installAsteroidEphemeris,
  patchCorpusDoctrinePreferences,
  patchOptions,
  previewArabicPart,
  recoverSavedSettings,
  setDefaultLocationFromMap,
  upsertCustomCorpusSemanticProfile,
  type ArabicPartMeta,
  type ArabicPartSpec,
  type ArabicRefSlot,
  type AsteroidCatalogRow,
  type ColorFieldMeta,
  type CorpusDiscipline,
  type CorpusSemanticProfile,
  type CorpusSemanticProfileSemantics,
  type CorpusSemanticProfilesPayload,
  type FixedStarCatalogRow,
  type FixedStarKind,
  type OptionsAlmutens,
  type OptionsDefaultLocation,
  type OptionsDisplay,
  type OptionsPayload,
  type OptionsPatch,
  type OptionsPlanetsPoints,
  type OptionsQuickCharts,
  type OptionsRevolutions,
  type OptionsSymbols,
  type PlaceCandidate,
  type RGB,
} from "@/lib/daemon/client";
import { PrimDirSettingsBody, PD_PLANET_GLYPHS } from "./primdir-settings";
import { PlaceSearchField } from "./place-search-field";
import { AsteroidSelectionControls } from "./asteroid-selection-controls";
import { StyleLabColorPicker } from "./style-lab-color-picker";
import { SETTINGS_COLOR_PREVIEW, useColorSettingsPreviewStore, type SettingsColorPreview, type SettingsColorPreviewEvent } from "@/stores/color-settings-preview-store";
import { resolveShellHost } from "@/lib/shell-host";
import { useAstrocartMapUrl } from "@/hooks/use-astrocart-map-url";
import { downloadTextContent } from "./text-export";
import { useThemeStore } from "@/stores/theme-store";
import { useChartStyleEditorStore } from "@/stores/chart-style-editor-store";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSyncLocale, useT } from "@/lib/i18n/i18n";
import { isSettingsTabId, readLastSettingsTab, rememberSettingsTab, type SettingsTabId } from "@/lib/settings-navigation";
import { buildSettingsSearchIndex, searchSettings, type SettingsSearchResult } from "@/lib/settings-search";
import { COLOR_GROUP_TITLE_KEYS } from "@/lib/settings-search-fields";
import { SettingsHeader, SettingsSearchResults } from "./settings-search";
export { isSettingsTabId, type SettingsTabId } from "@/lib/settings-navigation";
import { useFixedRowHeightAnchor, useListRowHeight } from "@/lib/list-tokens";
import { formatCoordinate, parseCoordinate } from "@/lib/coordinate-input";

// ---------------------------------------------------------------------------
// Settings / Appearance surface — a thin skin over the daemon options catalog.
// The daemon owns enum catalogs, glyph chars, color fields, and validation;
// React owns the desktop grouping and row order for the visible tabs.
// Driven by GET/POST /api/options + POST /api/options/theme.
// ---------------------------------------------------------------------------

type Props = {
  nativeWindow?: boolean;
  onReady?: () => void;
  onEndThemePreview?: () => Promise<void>;
  onBeforeWheelAction?: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTabId;
  tabRequestGeneration?: number;
  focusSearch?: boolean;
  onOptionsPatched?: (next?: OptionsPayload) => void;
  onSemanticProfileSelect: (
    profileId: string,
  ) => Promise<CorpusSemanticProfilesPayload | null>;
  onSemanticProfilesCommitted: (
    payload: CorpusSemanticProfilesPayload,
  ) => void;
  getSemanticProfileRevision: () => number;
};

function changesAppThemeAppearance(patch: OptionsPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, "colors")
    || patch.display?.fontfamily !== undefined;
}

export function SettingsDialog({
  nativeWindow = false,
  onReady,
  onEndThemePreview,
  onBeforeWheelAction,
  open,
  onOpenChange,
  initialTab,
  tabRequestGeneration = 0,
  focusSearch = false,
  onOptionsPatched,
  onSemanticProfileSelect,
  onSemanticProfilesCommitted,
  getSemanticProfileRevision,
}: Props) {
  const Content = nativeWindow ? NativeDialogContent : FloatingDialogContent;
  return (
    <Dialog open={nativeWindow || open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
      <Content size="workspace" data-settings-surface="" data-aries-surface="popover" className={`flex ${nativeWindow ? "" : "max-h-[var(--aries-dialog-viewport-height)]"} flex-col gap-0 overflow-hidden rounded-[var(--aries-radius-popover)] bg-[var(--aries-popover-background)] p-0 text-[color:var(--aries-popover-text)]`}>
        <SettingsBody
          prepare={nativeWindow}
          active={open}
          onReady={onReady}
          onEndThemePreview={onEndThemePreview}
          onBeforeWheelAction={onBeforeWheelAction}
          initialTab={initialTab}
          tabRequestGeneration={tabRequestGeneration}
          focusSearch={focusSearch}
          onOptionsPatched={onOptionsPatched}
          onSemanticProfileSelect={onSemanticProfileSelect}
          onSemanticProfilesCommitted={onSemanticProfilesCommitted}
          getSemanticProfileRevision={getSemanticProfileRevision}
        />
      </Content>
    </Dialog>
  );
}

function SettingsBody({
  prepare,
  active,
  onReady,
  onEndThemePreview,
  onBeforeWheelAction,
  initialTab,
  tabRequestGeneration,
  focusSearch,
  onOptionsPatched,
  onSemanticProfileSelect,
  onSemanticProfilesCommitted,
  getSemanticProfileRevision,
}: {
  prepare: boolean;
  active: boolean;
  onReady?: () => void;
  onEndThemePreview?: () => Promise<void>;
  onBeforeWheelAction?: () => Promise<void>;
  initialTab?: SettingsTabId;
  tabRequestGeneration: number;
  focusSearch: boolean;
  onOptionsPatched?: (next?: OptionsPayload) => void;
  onSemanticProfileSelect: (
    profileId: string,
  ) => Promise<CorpusSemanticProfilesPayload | null>;
  onSemanticProfilesCommitted: (
    payload: CorpusSemanticProfilesPayload,
  ) => void;
  getSemanticProfileRevision: () => number;
}) {
  const t = useT();
  const [opts, setOpts] = React.useState<OptionsPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = React.useState(false);
  const [recoveryConfirming, setRecoveryConfirming] = React.useState(false);
  const [recovered, setRecovered] = React.useState(false);
  const [recoveryError, setRecoveryError] = React.useState<string | null>(null);
  const applyThemeState = useThemeStore((state) => state.applyThemeState);
  const syncLocale = useSyncLocale();
  const [selectedTab, setSelectedTab] = React.useState(() => initialTab ?? readLastSettingsTab());
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [searchTarget, setSearchTarget] = React.useState<SettingsSearchResult | null>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const settingsPane = React.useRef<HTMLDivElement>(null);
  const resultsId = React.useId();
  const [tabIntent, setTabIntent] = React.useState({ initialTab, active, tabRequestGeneration });
  if (initialTab !== tabIntent.initialTab || active !== tabIntent.active || tabRequestGeneration !== tabIntent.tabRequestGeneration) {
    setTabIntent({ initialTab, active, tabRequestGeneration });
    if (active && initialTab) setSelectedTab(initialTab);
    setQuery("");
    setActiveIndex(0);
    setSearchTarget(null);
  }
  const searching = opts !== null && query.trim().length > 0;
  const searchIndex = React.useMemo(() => searching && opts ? buildSettingsSearchIndex(opts, t) : [], [searching, opts, t]);
  const results = React.useMemo(() => searchSettings(searchIndex, query), [searchIndex, query]);
  const changeQuery = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
    setSearchTarget(null);
  };
  const selectResult = (result: SettingsSearchResult) => {
    changeQuery("");
    setSelectedTab(result.tab);
    setSearchTarget({ ...result });
  };
  React.useEffect(() => {
    if (!active) return;
    const handleFind = (event: KeyboardEvent) => {
      const input = searchInput.current;
      if (!input || event.isComposing || event.altKey || event.shiftKey
        || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      if (!prepare && !input.closest("[data-settings-surface]")?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", handleFind, true);
    return () => window.removeEventListener("keydown", handleFind, true);
  }, [active, prepare]);
  React.useEffect(() => {
    if (!active || !focusSearch || error) return;
    const focus = () => {
      if (!document.hasFocus() || !searchInput.current) return;
      searchInput.current.focus();
      window.removeEventListener("focus", focus);
    };
    const frame = requestAnimationFrame(focus);
    window.addEventListener("focus", focus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", focus);
    };
  }, [active, focusSearch, error, tabRequestGeneration]);
  React.useLayoutEffect(() => {
    if (!searchTarget) return;
    const pane = settingsPane.current;
    if (!pane) return;
    const findAnchor = (anchor?: string) => anchor ? Array.from(
      pane.querySelectorAll<HTMLElement>(`[data-settings-search-anchor="${CSS.escape(anchor)}"]`),
    ).find(element => !element.closest("[inert]") && element.getClientRects().length > 0) : undefined;
    const tab = pane.closest(".aries-settings-tabs")?.querySelector<HTMLElement>(
      `[data-settings-tab="${searchTarget.tab}"]`,
    );
    const target = findAnchor(searchTarget.anchor) ?? findAnchor(searchTarget.sectionAnchor)
      ?? (searchTarget.directionsTab ? findAnchor(`pd-tab:${searchTarget.directionsTab}`) : undefined);
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!target) {
      pane.scrollTop = 0;
      tab?.focus({ preventScroll: true });
      return;
    }
    if (!target.matches("button, input, select, textarea, a[href]")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.setAttribute("data-settings-search-highlight", "");
    const timer = window.setTimeout(() => target.removeAttribute("data-settings-search-highlight"), 1600);
    return () => {
      window.clearTimeout(timer);
      target.removeAttribute("data-settings-search-highlight");
    };
  }, [searchTarget]);
  React.useEffect(() => {
    if (active) rememberSettingsTab(selectedTab);
  }, [active, selectedTab]);
  const tabs = opts?.settingsRegistry.tabs.filter((tab) => isSettingsTabId(tab.id)) ?? [];
  const optionsLoaded = React.useRef(false);
  const applyOptionsPayload = React.useCallback((next: OptionsPayload) => {
    optionsLoaded.current = true;
    setOpts(next);
    applyThemeState(next.themeState);
    if (settingsColorPreviewMatchesTheme(next.themeState, useColorSettingsPreviewStore.getState().color)) {
      useColorSettingsPreviewStore.getState().setColor(null);
    }
    syncLocale(next.languages.langid);
  }, [applyThemeState, syncLocale]);
  const patchQueueRef = React.useRef<OptionsPatch[]>([]);
  const presetRepliesRef = React.useRef(new WeakMap<OptionsPatch, (ok: boolean) => void>());
  const patchDrainRef = React.useRef(false);
  const patchEpochRef = React.useRef(0);
  const wheelDisplay = useChartStyleEditorStore(useShallow(state => state.wheelPresetState?.display));
  React.useEffect(() => {
    if (opts || error) onReady?.();
  }, [opts, error, onReady]);

  // Use the canonical mutation reply for the few overlapping Settings fields.
  // A ring edit never reloads the full settings catalog or replaces every row.
  React.useEffect(() => {
    if (!wheelDisplay || patchDrainRef.current) return;
    setOpts(current => {
      if (!current || Object.entries(wheelDisplay).every(([key, value]) => current.display[key as keyof OptionsDisplay] === value)) return current;
      return {...current, display: {...current.display, ...wheelDisplay}};
    });
  }, [wheelDisplay]);

  const drainPatches = React.useCallback(async () => {
    if (patchDrainRef.current) return;
    patchDrainRef.current = true;
    let latest: OptionsPayload | null = null;
    let failed = false;
    let failedColors = false;
    try {
      while (patchQueueRef.current.length > 0) {
        const patch = patchQueueRef.current.shift()!;
        try {
          if (changesAppThemeAppearance(patch)) await onEndThemePreview?.();
          latest = await patchOptions(patch);
          onOptionsPatched?.(latest);
          presetRepliesRef.current.get(patch)?.(true);
        } catch (err) {
          failed = true;
          failedColors ||= Boolean(patch.colors);
          presetRepliesRef.current.get(patch)?.(false);
          console.error("[options-patch]", err);
        }
      }
    } finally {
      patchDrainRef.current = false;
      if (failedColors) clearSettingsColorPreview();
      if (failed) {
        const epoch = patchEpochRef.current;
        fetchOptions().then((next) => {
          if (patchEpochRef.current === epoch && !patchDrainRef.current) {
            applyOptionsPayload(next);
          }
        }).catch(() => undefined);
      } else if (latest) {
        applyOptionsPayload(latest);
      }
    }
  }, [applyOptionsPayload, onOptionsPatched, onEndThemePreview]);

  // Keep controls on reopen and reconcile quietly with canonical options.
  // A refresh must never replace a newer local edit or an in-flight mutation.
  React.useEffect(() => {
    if (!active && (!prepare || optionsLoaded.current)) return;
    const controller = new AbortController();
    const epoch = patchEpochRef.current;
    fetchOptions(controller.signal)
      .then((next) => {
        if (controller.signal.aborted || patchEpochRef.current !== epoch || patchDrainRef.current) return;
        setError(null);
        applyOptionsPayload(next);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(String(err));
      });
    return () => controller.abort();
  }, [active, prepare, applyOptionsPayload]);

  // Apply intent immediately. Serialize daemon writes and collapse consecutive
  // queued asteroid selections into their newest state; one active write and
  // one trailing write suffice for a burst of checkbox clicks.
  const sendPatch = React.useCallback((patch: OptionsPatch, optimistic: OptionsPayload) => {
    if (changesAppThemeAppearance(patch)) {
      // Appearance changes made outside Style Lab intentionally switch away
      // from its parked working preview without discarding that draft.
      useChartStyleEditorStore.getState().setLiveAppThemePreview(false);
    }
    const reply = patch.primaryDirectionPreset || patch.asteroidSelection
      ? new Promise<boolean>(resolve => presetRepliesRef.current.set(patch, resolve))
      : undefined;
    setOpts(optimistic);
    patchEpochRef.current += 1;
    const selectionOnly = Object.keys(patch).length === 1
      && patch.asteroids !== undefined
      && Object.keys(patch.asteroids).length === 1
      && patch.asteroids.selectedNumbers !== undefined;
    const queued = patchQueueRef.current;
    const last = queued[queued.length - 1];
    if (Object.keys(patch).length === 1 && patch.colors
      && last?.colors && Object.keys(last).length === 1) {
      // A picker or opacity drag may emit many values while one daemon write
      // is active. Keep one latest trailing paint transaction and preserve
      // edits to different color fields in that same burst.
      queued[queued.length - 1] = {
        colors: { ...last.colors, ...patch.colors },
      };
    } else if (last && canCoalesceOrbPatch(last, patch)) {
      // Stepping or typing an orb emits a value per keystroke; whole rows and
      // repeated edits of one cell keep only the latest queued write.
      queued[queued.length - 1] = { orbs: { ...last.orbs, ...patch.orbs } };
    } else if (selectionOnly && last?.asteroids?.selectedNumbers !== undefined
      && Object.keys(last).length === 1 && Object.keys(last.asteroids).length === 1) {
      queued[queued.length - 1] = patch;
    } else {
      queued.push(patch);
    }
    void drainPatches();
    return reply;
  }, [drainPatches]);

  const applyPreset = React.useCallback((name: string) => {
    clearSettingsColorPreview();
    useChartStyleEditorStore.getState().setLiveAppThemePreview(false);
    applyWheelTheme(name, onEndThemePreview)
      .then((next) => {
        applyOptionsPayload(next);
        onOptionsPatched?.(next);
      })
      .catch((err) => console.error("[theme-preset]", err));
  }, [applyOptionsPayload, onOptionsPatched, onEndThemePreview]);

  if (error) {
    return (
      <>
      <DialogHeader data-tauri-drag-region={prepare ? "" : undefined} className="border-b border-border/40 p-[var(--aries-dialog-padding)]">
        <DialogTitle>{t("settings.title")}</DialogTitle>
      </DialogHeader>
      <div className="flex min-h-0 flex-col items-center gap-[var(--aries-section-gap)] overflow-y-auto px-[var(--aries-dialog-padding)] py-[var(--aries-section-gap)] text-center text-[length:var(--aries-font-size-base)] text-foreground/70">
        <p className="max-w-full break-all">{t("settings.loadFailed")}: {error}</p>
        {recovered ? (
          <p>{t("settings.recoveryRestart")}</p>
        ) : (
          <>
            <p>{t("settings.recoveryExplanation")}</p>
            {recoveryConfirming ? (
              <>
                <p>{t("settings.recoveryConfirm")}</p>
                <div className="flex gap-[var(--aries-section-gap)]">
                  <Button type="button" variant="outline" disabled={recoveryBusy} onClick={() => setRecoveryConfirming(false)}>{t("settings.cancel")}</Button>
                  <Button type="button" disabled={recoveryBusy} onClick={() => {
                    setRecoveryBusy(true);
                    setRecoveryError(null);
                    void recoverSavedSettings().then(() => setRecovered(true)).catch((cause) => {
                      setRecoveryError(String(cause));
                    }).finally(() => setRecoveryBusy(false));
                  }}>{t("settings.recoveryAction")}</Button>
                </div>
              </>
            ) : (
              <Button type="button" onClick={() => setRecoveryConfirming(true)}>{t("settings.recoveryAction")}</Button>
            )}
            {recoveryError && <p>{t("settings.recoveryFailed")}: {recoveryError}</p>}
          </>
        )}
      </div>
      </>
    );
  }

  const highlightedResult = Math.max(0, Math.min(activeIndex, results.length - 1));
  return (
    <>
      <SettingsHeader
        nativeWindow={prepare} query={query} inputRef={searchInput} resultsId={resultsId}
        searching={searching} results={results} activeIndex={highlightedResult}
        setActiveIndex={setActiveIndex} onQueryChange={changeQuery} onSelect={selectResult}
      />
      {opts === null ? (
        <div className="px-[var(--aries-dialog-padding)] py-[calc(var(--aries-section-gap)*2)] text-center text-[length:var(--aries-font-size-base)] text-foreground/55">{t("settings.loading")}</div>
      ) : (
        <Tabs value={selectedTab} onValueChange={value => {
          if (!isSettingsTabId(String(value))) return;
          changeQuery("");
          setSelectedTab(value as SettingsTabId);
        }} orientation="vertical" className={`aries-settings-tabs min-h-0 gap-[var(--aries-tabs-rail-gap)] overflow-hidden ${searching || selectedTab === "asteroids" ? prepare ? "flex-1" : "h-[var(--aries-dialog-content-height-workspace)]" : "max-h-[var(--aries-dialog-content-height-workspace)]"}`}>
          <TabsList
            variant="line"
            className="aries-settings-tab-list min-h-0 w-[var(--aries-tabs-rail-width)] shrink-0 items-stretch justify-start gap-[var(--aries-tabs-rail-gap)] overflow-y-auto border-r border-border/40 bg-transparent p-[var(--aries-tabs-rail-padding)] data-vertical:h-auto"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                data-settings-tab={tab.id}
                onClick={() => { if (searching) changeQuery(""); }}
                className="h-auto flex-none justify-start rounded-[var(--aries-radius-menu-item)] px-[var(--aries-tabs-rail-trigger-padding-x)] py-[var(--aries-tabs-rail-trigger-padding-y)] text-[length:var(--aries-font-size-base)] text-foreground/60"
              >
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          {searching && (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <SettingsSearchResults resultsId={resultsId} results={results} activeIndex={highlightedResult} onSelect={selectResult} />
            </div>
          )}
          <div ref={settingsPane} className={`min-h-0 min-w-0 flex-1 ${searching ? "hidden" : selectedTab === "asteroids" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
            <TabsContent value="colors" className="m-0 p-[var(--aries-dialog-padding)]">
              <ColorsTab
                opts={opts}
                sendPatch={sendPatch}
                applyPreset={applyPreset}
              />
            </TabsContent>
            <TabsContent value="appearance" className="m-0 p-[var(--aries-dialog-padding)]">
              <AppearanceTab opts={opts} sendPatch={sendPatch} onBeforeWheelAction={onBeforeWheelAction} />
            </TabsContent>
            <TabsContent value="interpretation" className="m-0 p-[var(--aries-dialog-padding)]">
              <InterpretationTab
                opts={opts}
                onSemanticProfileSelect={onSemanticProfileSelect}
                onSemanticProfilesCommitted={onSemanticProfilesCommitted}
                getSemanticProfileRevision={getSemanticProfileRevision}
              />
            </TabsContent>
            <TabsContent value="astrocartography" className="m-0 p-[var(--aries-dialog-padding)]">
              <MirroredSettingsTab tabId="astrocartography" opts={opts} sendPatch={sendPatch} />
              <Row searchAnchor="astrocart.ruler.units" label={t("astrocart.ruler.units")}>
                <Select
                  value={opts.display.astrocart_distance_units ?? "metric"}
                  onChange={(value) => {
                    const display = { ...opts.display, astrocart_distance_units: value as "metric" | "miles" };
                    sendPatch({ display: { astrocart_distance_units: display.astrocart_distance_units } }, { ...opts, display });
                  }}
                >
                  <option value="metric">{t("astrocart.ruler.metric")}</option>
                  <option value="miles">{t("astrocart.ruler.miles")}</option>
                </Select>
              </Row>
            </TabsContent>
            <TabsContent value="export" className="m-0 p-[var(--aries-dialog-padding)]">
              <ExportTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="speculum" className="m-0 p-[var(--aries-dialog-padding)]">
              <SpeculumTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="orbs" className="m-0 p-[var(--aries-dialog-padding)]">
              <OrbsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="dignities" className="m-0 p-[var(--aries-dialog-padding)]">
              <DignitiesTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="planets" className="m-0 p-[var(--aries-dialog-padding)]">
              <PlanetsPointsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="location" className="m-0 p-[var(--aries-dialog-padding)]">
              <DefaultLocationTab
                opts={opts}
                sendPatch={sendPatch}
                onDefaultLocationApplied={(group) => {
                  // The map write happened on the daemon (outside the tab's
                  // optimistic patch); reconcile local state from the returned
                  // group so the fields update without a full refetch.
                  setOpts((cur) => (cur ? { ...cur, defaultLocation: group } : cur));
                  onOptionsPatched?.();
                }}
              />
            </TabsContent>
            <TabsContent value="revolutions" className="m-0 p-[var(--aries-dialog-padding)]">
              <RevolutionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="supplementary" className="m-0 p-[var(--aries-dialog-padding)]">
              <ProgressionsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="stepalerts" className="m-0 p-[var(--aries-dialog-padding)]">
              <StepAlertsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="almutens" className="m-0 p-[var(--aries-dialog-padding)]">
              <AlmutensTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="timelords" className="m-0 p-[var(--aries-dialog-padding)]">
              <TimeLordsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="primarydirections" className="m-0 p-[var(--aries-dialog-padding)]">
              <PrimaryDirectionsTab opts={opts} sendPatch={sendPatch} searchTarget={searchTarget} />
            </TabsContent>
            <TabsContent value="fixstars" className="m-0 p-[var(--aries-dialog-padding)]">
              <FixedStarsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="asteroids" className="m-0 flex min-h-0 min-w-0 flex-col p-[var(--aries-dialog-padding)]">
              <AsteroidsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="relationship" className="m-0 p-[var(--aries-dialog-padding)]">
              <RelationshipChartsTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
            <TabsContent value="languages" className="m-0 p-[var(--aries-dialog-padding)]">
              <LanguagesTab opts={opts} sendPatch={sendPatch} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives — dense, hairline, 10px section labels.
// ---------------------------------------------------------------------------

function SectionLabel({ children, searchAnchor }: { children: React.ReactNode; searchAnchor?: string }) {
  return (
    <div data-settings-search-anchor={searchAnchor} className="mb-[var(--aries-control-gap)] mt-[var(--aries-section-gap)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45 first:mt-0">
      {children}
    </div>
  );
}

function Row({ label, children, searchAnchor }: { label: React.ReactNode; children: React.ReactNode; searchAnchor?: string }) {
  return (
    <div data-settings-search-anchor={searchAnchor} className="flex h-[var(--aries-control-height-small)] items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 last:border-b-0">
      <span className="truncate text-[length:var(--aries-font-size-base)] text-foreground/80">{label}</span>
      <span className="flex shrink-0 items-center">{children}</span>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <span className="pl-[var(--aries-panel-padding-x)] text-foreground/70">{children}</span>;
}

function rgbToHex(rgb: RGB | null): string {
  if (!rgb) return "#000000";
  const [r, g, b] = rgb;
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function Swatch({
  value,
  label,
  attr,
  index,
  onCommit,
}: {
  value: RGB | null;
  label: string;
  attr: SettingsColorPreview["attr"];
  index?: number;
  onCommit: (rgb: RGB) => void;
}) {
  const hex = rgbToHex(value);
  const [syncedHex, setSyncedHex] = React.useState(hex);
  const [liveHex, setLiveHex] = React.useState<string | null>(null);
  const gestureActive = React.useRef(false);
  const latestRgb = React.useRef<RGB | null>(null);
  if (hex !== syncedHex) {
    setSyncedHex(hex);
    setLiveHex(null);
  }
  const changed = (next: string) => {
    const rgb = hexToRgb(next);
    latestRgb.current = rgb;
    setLiveHex(next);
    previewSettingsColor({ attr, index, rgb });
    if (!gestureActive.current) onCommit(rgb);
  };
  return (
    <StyleLabColorPicker
      value={liveHex ?? hex}
      label={label}
      className="!h-[var(--aries-control-icon-size-default)] !w-[var(--aries-control-height-small)]"
      onGestureStart={() => { gestureActive.current = true; latestRgb.current = null; }}
      onGestureEnd={() => {
        gestureActive.current = false;
        if (latestRgb.current) onCommit(latestRgb.current);
      }}
      onChange={changed}
    />
  );
}

let opacityPreviewFrame: number | null = null;
let opacityPreviewValue = 0;
let colorPreviewFrame: number | null = null;
let colorPreviewValue: SettingsColorPreview | null = null;
let previewSequence = 0;

function emitSettingsColorPreview(payload: SettingsColorPreviewEvent): void {
  void import("@tauri-apps/api/event").then(({ emitTo }) =>
    emitTo("main", SETTINGS_COLOR_PREVIEW, payload)
  ).catch((error) => console.error("[settings-color-preview]", error));
}

function previewSettingsColor(color: Omit<SettingsColorPreview, "revision">): void {
  const next = { ...color, revision: ++previewSequence };
  colorPreviewValue = next;
  if (colorPreviewFrame !== null) return;
  colorPreviewFrame = requestAnimationFrame(() => {
    colorPreviewFrame = null;
    const color = colorPreviewValue && { ...colorPreviewValue, revision: ++previewSequence };
    useChartStyleEditorStore.getState().setLiveAppThemePreview(false);
    useColorSettingsPreviewStore.getState().setColor(color);
    if (resolveShellHost().kind === "tauri") {
      emitSettingsColorPreview({ kind: "color", color, sequence: color?.revision ?? ++previewSequence });
    }
  });
}

function clearSettingsColorPreview(): void {
  if (colorPreviewFrame !== null) cancelAnimationFrame(colorPreviewFrame);
  colorPreviewFrame = null;
  colorPreviewValue = null;
  useColorSettingsPreviewStore.getState().setColor(null);
  if (resolveShellHost().kind === "tauri") {
    emitSettingsColorPreview({ kind: "color", color: null, sequence: ++previewSequence });
  }
}

function previewZodiacFieldOpacity(value: number): void {
  useColorSettingsPreviewStore.getState().setZodiacFieldOpacity(value);
  if (resolveShellHost().kind !== "tauri") return;
  opacityPreviewValue = value;
  if (opacityPreviewFrame !== null) return;
  opacityPreviewFrame = requestAnimationFrame(() => {
    opacityPreviewFrame = null;
    emitSettingsColorPreview({ kind: "opacity", value: opacityPreviewValue, sequence: ++previewSequence });
  });
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={
        "relative h-[var(--aries-control-icon-size-default)] w-[var(--aries-control-height-small)] rounded-[var(--aries-radius-ui-control)] transition-colors " +
        (disabled ? "opacity-40 " : "") +
        (checked ? "bg-foreground/80" : "bg-border")
      }
    >
      <span
        className={
          "absolute left-[calc(var(--aries-control-gap-compact)/2)] top-[calc(var(--aries-control-gap-compact)/2)] h-[var(--aries-control-icon-size-xs)] w-[var(--aries-control-icon-size-xs)] rounded-[var(--aries-radius-ui-control)] bg-background transition-all " +
          (checked ? "translate-x-[var(--aries-control-icon-size-xs)]" : "translate-x-0")
        }
      />
    </button>
  );
}

/** Uncontrolled numeric field, committed on blur. Keyed by `value` upstream so a
 * server-driven value change remounts it with the fresh defaultValue — avoids a
 * setState-in-effect sync (react-hooks/set-state-in-effect). */
function NumberField({
  ariaLabel,
  value,
  step = 1,
  min,
  max,
  onCommit,
  disabled = false,
}: {
  ariaLabel?: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
}) {
  // Commit every valid in-range value as it is stepped or typed (Aries
  // settings apply immediately); the draft keeps partial text such as "1."
  // and an out-of-range entry is clamped when the field loses focus.
  const [draft, setDraft] = React.useState(String(value));
  const [synced, setSynced] = React.useState(value);
  if (synced !== value) {
    setSynced(value);
    if (Number(draft) !== value) setDraft(String(value));
  }
  const inRange = (n: number) =>
    (typeof min !== "number" || n >= min) && (typeof max !== "number" || n <= max);
  const clamp = (n: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <input
      data-aries-control-appearance="local"
      aria-label={ariaLabel}
      type="number"
      step={step}
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = Number(text);
        if (text.trim() !== "" && Number.isFinite(n) && inRange(n) && n !== value) onCommit(n);
      }}
      onBlur={() => {
        const n = Number(draft);
        if (draft.trim() === "" || !Number.isFinite(n)) {
          setDraft(String(value));
          return;
        }
        const clamped = clamp(n);
        if (clamped !== value) onCommit(clamped);
        setDraft(String(clamped));
      }}
      className="h-[var(--aries-control-height-micro)] w-[52px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-right text-[length:var(--aries-font-size-base)] tabular-nums outline-none focus:border-border"
    />
  );
}

function Select({
  value,
  onChange,
  children,
  ariaLabel,
  width = 180,
  disabled = false,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  ariaLabel?: string;
  width?: number;
  disabled?: boolean;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ width }}
      className="h-[var(--aries-control-height-compact)] rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}

function Glyph({ ch, font = "morinus" }: { ch: string; font?: "morinus" | "text" }) {
  return (
    <span aria-hidden="true" className={`${font === "morinus" ? "font-symbols" : ""} inline-block w-[var(--aries-control-icon-size-default)] text-center text-[length:var(--aries-font-size-reading)] text-foreground/70`}>
      {ch}
    </span>
  );
}

function ObjectLabel({ glyph, children, font }: { glyph: string; children: React.ReactNode; font?: "morinus" | "text" }) {
  return (
    <span className="flex items-center gap-[var(--aries-control-gap)]">
      <Glyph ch={glyph} font={font} />
      {children}
    </span>
  );
}

/** Generic numeric slider rendered from catalog SliderFieldMeta. Most rows
 * commit on release; color opacity commits during the gesture. */
function Slider({
  value,
  min,
  max,
  step,
  disabled = false,
  suffix = "",
  live = false,
  onPreview,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  suffix?: string;
  live?: boolean;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
}) {
  const [local, setLocal] = React.useState(value);
  const [previousValue, setPreviousValue] = React.useState(value);
  const [gestureActive, setGestureActive] = React.useState(false);
  const currentValue = React.useRef(value);
  const lastCommitted = React.useRef(value);
  if (value !== previousValue) {
    setPreviousValue(value);
    if (!gestureActive) {
      setLocal(value);
    }
  }
  const commitLive = () => {
    if (!live || currentValue.current === lastCommitted.current) return;
    lastCommitted.current = currentValue.current;
    onCommit(currentValue.current);
  };
  return (
    <span className="flex items-center gap-[var(--aries-form-field-gap)]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onPointerDown={() => setGestureActive(true)}
        onPointerUp={() => { setGestureActive(false); commitLive(); }}
        onPointerCancel={() => { setGestureActive(false); commitLive(); }}
        onBlur={() => { setGestureActive(false); commitLive(); }}
        onChange={(e) => {
          const next = Number(e.target.value);
          currentValue.current = next;
          setLocal(next);
          if (live) onPreview?.(next);
        }}
        onMouseUp={() => {
          if (!live && local !== value) onCommit(local);
        }}
        onKeyUp={() => {
          if (live) commitLive();
          else if (local !== value) onCommit(local);
        }}
        className="h-1 w-[120px] cursor-pointer accent-foreground/70 disabled:cursor-default disabled:opacity-40"
      />
      <span className="w-9 text-right text-[length:var(--aries-font-size-small)] tabular-nums text-foreground/55">
        {step < 1 ? local.toFixed(2) : local}{suffix}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Colors
// ---------------------------------------------------------------------------

type TabProps = {
  opts: OptionsPayload;
  sendPatch: (patch: OptionsPatch, optimistic: OptionsPayload) => void | Promise<boolean>;
};

function MirroredSettingsTab({
  tabId,
  opts,
  sendPatch,
}: TabProps & { tabId: SettingsTabId }) {
  const t = useT();
  const section = opts.settingsRegistry.mirroredSections.find((item) => item.tabId === tabId);
  if (!section) return null;

  return (
    <>
      <SectionLabel>{t(section.labelKey)}</SectionLabel>
      {section.settings.map((setting) => (
        <Row key={setting.id} searchAnchor={`mirrored:${setting.id}`} label={t(setting.labelKey)}>
          <Toggle
            checked={Boolean(opts.display[setting.field])}
            onChange={(value) => {
              const displayPatch = { [setting.field]: value } as Partial<OptionsDisplay>;
              sendPatch(
                { display: displayPatch },
                { ...opts, display: { ...opts.display, ...displayPatch } },
              );
            }}
          />
        </Row>
      ))}
    </>
  );
}

function semanticProfileLabel(
  profile: CorpusSemanticProfile,
  t: ReturnType<typeof useT>,
): string {
  if (profile.id === "source-native") {
    return t("settings.semanticProfileSourceNative");
  }
  if (profile.id === "quadrant") {
    return t("settings.semanticProfileQuadrant");
  }
  if (profile.id === "hellenistic") {
    return t("settings.semanticProfileHellenistic");
  }
  return profile.name?.trim() || profile.id;
}

type SemanticProfileDraft = {
  id: string;
  name: string;
  existing: boolean;
  semantics: CorpusSemanticProfileSemantics;
};

/** Corpus configuration belongs in Settings. Paradigm and doctrine are global
 * daemon state; discipline, theme, and question facts remain the chart lens. */
function InterpretationTab({
  opts,
  onSemanticProfileSelect,
  onSemanticProfilesCommitted,
  getSemanticProfileRevision,
}: {
  opts: OptionsPayload;
  onSemanticProfileSelect: (
    profileId: string,
  ) => Promise<CorpusSemanticProfilesPayload | null>;
  onSemanticProfilesCommitted: (
    payload: CorpusSemanticProfilesPayload,
  ) => void;
  getSemanticProfileRevision: () => number;
}) {
  const t = useT();
  const lens = useWorkspaceStore((state) => state.inspectorLens);
  const packsVersion = useWorkspaceStore((state) => state.packsVersion);
  const semanticProfileVersion = useWorkspaceStore((state) => state.semanticProfileVersion);
  const [catalog, setCatalog] = React.useState<CorpusDiscipline[] | null>(null);
  const [profiles, setProfiles] = React.useState<CorpusSemanticProfilesPayload | null>(null);
  const [pendingProfileId, setPendingProfileId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<SemanticProfileDraft | null>(null);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [profileErrorKey, setProfileErrorKey] = React.useState<string | null>(null);
  const profileRevision = React.useRef(0);
  const doctrineRevisions = React.useRef<Record<string, number>>({});
  const doctrineWriteChain = React.useRef<Promise<void>>(Promise.resolve());
  const [pendingDoctrineValues, setPendingDoctrineValues] = React.useState<
    Record<string, string>
  >({});

  // A discipline can be chosen before its theme. The canonical lens remains
  // null until a theme is selected, exactly as it did in the inspector strip.
  const [pickedDiscipline, setPickedDiscipline] = React.useState("");
  const [previousLensDiscipline, setPreviousLensDiscipline] = React.useState<string | null>(null);
  const lensDiscipline = lens?.discipline ?? null;
  if (lensDiscipline !== previousLensDiscipline) {
    setPreviousLensDiscipline(lensDiscipline);
    if (lensDiscipline) setPickedDiscipline(lensDiscipline);
  }

  React.useEffect(() => {
    let cancelled = false;
    if (packsVersion > 0) invalidateCorpusDisciplines();
    corpusDisciplinesCached()
      .then((payload) => {
        if (!cancelled) {
          setCatalog(payload.disciplines);
          setProfileErrorKey((current) => (
            current === "settings.interpretationLoadFailed" ? null : current
          ));
        }
      })
      .catch((error) => {
        if (!cancelled) setProfileErrorKey("settings.interpretationLoadFailed");
        console.error("[settings:interpretation-catalog]", error);
      });
    return () => {
      cancelled = true;
    };
  }, [packsVersion]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchCorpusSemanticProfiles(controller.signal)
      .then((payload) => {
        setProfiles(payload);
        setProfileErrorKey((current) => (
          current === "settings.semanticProfilesLoadFailed" ? null : current
        ));
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setProfileErrorKey("settings.semanticProfilesLoadFailed");
        console.error("[settings:semantic-profiles]", error);
      });
    return () => controller.abort();
  }, [semanticProfileVersion]);

  const discipline = pickedDiscipline;
  const themes = catalog?.find((item) => item.slug === discipline)?.themes ?? [];
  const activeTheme = themes.find(
    (theme) => theme.label === lens?.theme || theme.aliases.includes(lens?.theme ?? ""),
  );
  const activeContextOptions = activeTheme?.contextOptions ?? [];
  const doctrineFields = activeContextOptions.filter(
    (field) => field.scope === "global_doctrine",
  );
  const questionFields = activeContextOptions.filter(
    (field) => field.scope === "question_fact",
  );

  const selectProfile = (profileId: string) => {
    if (savingDraft || pendingProfileId !== null) return;
    setDraft(null);
    setProfileErrorKey(null);
    profileRevision.current += 1;
    const revision = profileRevision.current;
    setPendingProfileId(profileId);
    void onSemanticProfileSelect(profileId)
      .then((payload) => {
        if (profileRevision.current !== revision) return;
        if (payload) setProfiles(payload);
        setPendingProfileId(null);
      })
      .catch((error) => {
        if (profileRevision.current === revision) {
          setPendingProfileId(null);
          setProfileErrorKey("settings.semanticProfileChangeFailed");
        }
        console.error("[settings:semantic-profile-select]", error);
      });
  };

  const activeProfile = profiles?.profiles.find(
    (profile) => profile.id === profiles.active_profile_id,
  ) ?? null;
  const editProfile = () => {
    if (!activeProfile) return;
    setDraft({
      id: activeProfile.custom ? activeProfile.id : "",
      name: activeProfile.custom ? activeProfile.name ?? "" : "",
      existing: activeProfile.custom,
      semantics: { ...activeProfile.semantics },
    });
  };
  const updateDraftSemantic = (
    key: keyof CorpusSemanticProfileSemantics,
    value: string,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const semantics = { ...current.semantics };
      if (value) semantics[key] = value;
      else delete semantics[key];
      return { ...current, semantics };
    });
  };
  const saveDraft = () => {
    if (!draft || savingDraft) return;
    const savedDraft = draft;
    const revision = profileRevision.current + 1;
    profileRevision.current = revision;
    const selectionRevision = getSemanticProfileRevision();
    setSavingDraft(true);
    setProfileErrorKey(null);
    void (async () => {
      try {
        const payload = await upsertCustomCorpusSemanticProfile({
          profileId: savedDraft.id,
          name: savedDraft.name.trim() || null,
          semantics: savedDraft.semantics,
          activate: true,
        });
        if (
          profileRevision.current !== revision
          || getSemanticProfileRevision() !== selectionRevision
        ) {
          setDraft(null);
          return;
        }
        setProfiles(payload);
        onSemanticProfilesCommitted(payload);
        setDraft(null);
      } catch (error) {
        if (profileRevision.current === revision) {
          setProfileErrorKey("settings.customProfileSaveFailed");
        }
        console.error("[settings:semantic-profile-save]", error);
      } finally {
        setSavingDraft(false);
      }
    })();
  };
  const deleteDraft = () => {
    if (!draft?.existing || savingDraft) return;
    const deletedProfileId = draft.id;
    const revision = profileRevision.current + 1;
    profileRevision.current = revision;
    const selectionRevision = getSemanticProfileRevision();
    setSavingDraft(true);
    setProfileErrorKey(null);
    void (async () => {
      try {
        const payload = await deleteCustomCorpusSemanticProfile(deletedProfileId);
        if (
          profileRevision.current !== revision
          || getSemanticProfileRevision() !== selectionRevision
        ) {
          setDraft(null);
          return;
        }
        setProfiles(payload);
        onSemanticProfilesCommitted(payload);
        setDraft(null);
      } catch (error) {
        if (profileRevision.current === revision) {
          setProfileErrorKey("settings.customProfileDeleteFailed");
        }
        console.error("[settings:semantic-profile-delete]", error);
      } finally {
        setSavingDraft(false);
      }
    })();
  };

  const doctrinePreferenceKey = (field: (typeof doctrineFields)[number]) => (
    field.preferenceKey || field.key
  );
  const doctrineValue = (field: (typeof doctrineFields)[number]): string => {
    const key = doctrinePreferenceKey(field);
    if (Object.prototype.hasOwnProperty.call(pendingDoctrineValues, key)) {
      return pendingDoctrineValues[key];
    }
    return profiles?.doctrine?.preferences[key] ?? "";
  };
  const setDoctrineValue = (
    field: (typeof doctrineFields)[number],
    value: string,
  ) => {
    const key = doctrinePreferenceKey(field);
    const revision = (doctrineRevisions.current[key] ?? 0) + 1;
    doctrineRevisions.current[key] = revision;
    setPendingDoctrineValues((current) => ({ ...current, [key]: value }));
    setProfileErrorKey(null);

    const request = doctrineWriteChain.current.then(() => (
      patchCorpusDoctrinePreferences({ [key]: value || null })
    ));
    doctrineWriteChain.current = request.then(() => undefined, () => undefined);
    void request
      .then((payload) => {
        if (doctrineRevisions.current[key] !== revision) return;
        setProfiles(payload);
        setPendingDoctrineValues((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setProfileErrorKey((current) => (
          current === "settings.doctrineChangeFailed" ? null : current
        ));
        onSemanticProfilesCommitted(payload);
      })
      .catch((error) => {
        if (doctrineRevisions.current[key] === revision) {
          setPendingDoctrineValues((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
          setProfileErrorKey("settings.doctrineChangeFailed");
        }
        console.error("[settings:doctrine-preference]", error);
      });
  };

  const selectDiscipline = (slug: string) => {
    setPickedDiscipline(slug);
    useWorkspaceStore.getState().setInspectorLens(null);
  };
  const selectTheme = (label: string) => {
    if (!discipline || !label) {
      useWorkspaceStore.getState().setInspectorLens(null);
      return;
    }
    const theme = themes.find((item) => item.label === label);
    useWorkspaceStore.getState().setInspectorLens({
      discipline,
      theme: label,
      context: theme?.defaultContext ?? undefined,
    });
  };
  const setContextHouse = (
    key: "quesited_house" | "querent_house",
    value: string,
  ) => {
    const current = useWorkspaceStore.getState().inspectorLens;
    const house = Number.parseInt(value, 10);
    if (!current || !Number.isFinite(house)) return;
    useWorkspaceStore.getState().setInspectorLens({
      ...current,
      context: { ...(current.context ?? {}), [key]: house },
    });
  };
  const contextHouse = (key: "quesited_house" | "querent_house"): string => {
    const value = lens?.context?.[key];
    return typeof value === "number" && value >= 1 && value <= 12 ? String(value) : "";
  };
  const setContextValue = (key: string, value: string) => {
    const current = useWorkspaceStore.getState().inspectorLens;
    if (!current) return;
    useWorkspaceStore.getState().setInspectorLens({
      ...current,
      context: { ...(current.context ?? {}), [key]: value },
    });
  };
  const contextValue = (key: string): string => {
    const value = lens?.context?.[key] ?? activeTheme?.defaultContext?.[key];
    if (typeof value === "string") return value;
    return activeTheme?.contextOptions
      .find((field) => field.contextKey === key)
      ?.options.at(0)?.value ?? "";
  };
  const houseLabels = Array.from({ length: 12 }, (_, index) => String(index + 1));

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.semanticProfile">{t("settings.semanticProfile")}</SectionLabel>
      <Row searchAnchor="settings.semanticProfile" label={t("settings.semanticProfile")}>
        <Select
          value={pendingProfileId ?? profiles?.active_profile_id ?? ""}
          width={220}
          disabled={savingDraft || pendingProfileId !== null}
          onChange={selectProfile}
        >
          {!profiles ? <option value="">—</option> : null}
          {profiles?.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {semanticProfileLabel(profile, t)}
            </option>
          ))}
        </Select>
      </Row>
      {activeProfile && !draft ? (
        <Row searchAnchor="settings.customProfile" label={t("settings.customProfile")}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={savingDraft || pendingProfileId !== null}
            onClick={editProfile}
          >
            {t(activeProfile.custom
              ? "settings.editCustomProfile"
              : "settings.customizeProfile")}
          </Button>
        </Row>
      ) : null}
      {profileErrorKey ? (
        <p
          role="alert"
          className="mt-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-small)] text-destructive"
        >
          {t(profileErrorKey)}
        </p>
      ) : null}
      {draft ? (
        <div className="mt-[var(--aries-control-gap)] rounded-[var(--aries-radius-md)] border border-border/50 px-[var(--aries-panel-padding-x)] pb-[var(--aries-control-gap)]">
          <SectionLabel searchAnchor="section:settings.customProfile">{t("settings.customProfile")}</SectionLabel>
          <Row label={t("settings.profileId")}>
            <input
              data-aries-control-appearance="local"
              type="text"
              value={draft.id}
              disabled={draft.existing || savingDraft}
              onChange={(event) => setDraft((current) => (
                current ? { ...current, id: event.target.value } : current
              ))}
              className="h-[var(--aries-control-height-compact)] w-[220px] rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border disabled:opacity-50"
            />
          </Row>
          <Row label={t("settings.profileName")}>
            <input
              data-aries-control-appearance="local"
              type="text"
              value={draft.name}
              disabled={savingDraft}
              onChange={(event) => setDraft((current) => (
                current ? { ...current, name: event.target.value } : current
              ))}
              className="h-[var(--aries-control-height-compact)] w-[220px] rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
            />
          </Row>
          {opts.settingsRegistry.corpusSemanticFields.map((field) => (
            <Row key={field.key} label={t(field.labelKey)}>
              <Select
                value={draft.semantics[field.key] ?? ""}
                width={220}
                disabled={savingDraft}
                onChange={(value) => updateDraftSemantic(field.key, value)}
              >
                {field.options.map((option) => (
                  <option key={option.value || "source"} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </Row>
          ))}
          <div className="mt-[var(--aries-control-gap)] flex justify-end gap-[var(--aries-control-gap)]">
            {draft.existing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={savingDraft}
                onClick={deleteDraft}
              >
                {t("settings.deleteProfile")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingDraft}
              onClick={() => setDraft(null)}
            >
              {t("settings.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                savingDraft ||
                !/^[a-z][a-z0-9_-]{0,63}$/.test(draft.id) ||
                Object.keys(draft.semantics).length === 0
              }
              onClick={saveDraft}
            >
              {t("settings.saveAndUseProfile")}
            </Button>
          </div>
        </div>
      ) : null}

      <SectionLabel searchAnchor="section:inspector.interpretation">{t("inspector.interpretation")}</SectionLabel>
      <Row searchAnchor="inspector.discipline" label={t("inspector.discipline")}>
        <Select value={discipline} width={220} onChange={selectDiscipline}>
          <option value="">—</option>
          {catalog?.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.displayName}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="inspector.theme" label={t("inspector.theme")}>
        <Select
          value={lens?.discipline === discipline ? activeTheme?.label ?? "" : ""}
          width={220}
          onChange={selectTheme}
        >
          <option value="">—</option>
          {themes.map((theme) => (
            <option key={theme.label} value={theme.label} title={theme.tooltip || undefined}>
              {theme.label}
            </option>
          ))}
        </Select>
      </Row>

      {doctrineFields.length > 0 ? (
        <>
          <SectionLabel searchAnchor="section:settings.globalDoctrine">{t("settings.globalDoctrine")}</SectionLabel>
          {doctrineFields.map((field) => (
            <Row key={doctrinePreferenceKey(field)} label={t(field.labelKey)}>
              <Select
                value={doctrineValue(field)}
                width={220}
                onChange={(value) => setDoctrineValue(field, value)}
              >
                <option value="">{t("settings.semanticUseSourceDefinition")}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </Row>
          ))}
        </>
      ) : null}

      {lens?.discipline === "horary" || questionFields.length > 0 ? (
        <>
          <SectionLabel searchAnchor="section:settings.questionContext">{t("settings.questionContext")}</SectionLabel>
          {lens?.discipline === "horary" ? (
            <>
              <Row searchAnchor="inspector.quesitedHouse" label={t("inspector.quesitedHouse")}>
                <Select
                  value={contextHouse("quesited_house")}
                  width={100}
                  onChange={(value) => setContextHouse("quesited_house", value)}
                >
                  <option value="" disabled hidden />
                  {houseLabels.map((house) => (
                    <option key={house} value={house}>{house}</option>
                  ))}
                </Select>
              </Row>
              <Row searchAnchor="inspector.querentHouse" label={t("inspector.querentHouse")}>
                <Select
                  value={contextHouse("querent_house")}
                  width={100}
                  onChange={(value) => setContextHouse("querent_house", value)}
                >
                  <option value="" disabled hidden />
                  {houseLabels.map((house) => (
                    <option key={house} value={house}>{house}</option>
                  ))}
                </Select>
              </Row>
            </>
          ) : null}
          {questionFields.map((field) => (
            <Row key={field.key} label={t(field.labelKey)}>
              <Select
                value={contextValue(field.contextKey)}
                width={220}
                onChange={(value) => setContextValue(field.contextKey, value)}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </Row>
          ))}
        </>
      ) : null}
    </div>
  );
}

function ExportTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const e = opts.export;
  const setPatch = (patch: Partial<OptionsPayload["export"]>) => {
    sendPatch({ export: patch }, { ...opts, export: { ...e, ...patch } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.pngCopy">{t("settings.pngCopy")}</SectionLabel>
      <Row searchAnchor="settings.pngAppearance" label={t("settings.pngAppearance")}>
        <Select
          value={e.pngChartAppearance}
          width={190}
          onChange={(value) => setPatch({ pngChartAppearance: value as OptionsPayload["export"]["pngChartAppearance"] })}
        >
          {e.pngChartAppearanceChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.includeOverlays" label={t("settings.includeOverlays")}>
        <Toggle checked={e.pngIncludeOverlays} onChange={(value) => setPatch({ pngIncludeOverlays: value })} />
      </Row>
      <Row searchAnchor="settings.pngFormat" label={t("settings.pngFormat")}>
        <Select
          value={e.pngPageFormat}
          width={190}
          onChange={(value) => setPatch({ pngPageFormat: value as OptionsPayload["export"]["pngPageFormat"] })}
        >
          {e.pngPageFormatChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <p className="pb-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] text-muted-foreground">
        {t("settings.pngFormatHint")}
      </p>
      <Row searchAnchor="settings.pngWatermarkStyle" label={t("settings.pngWatermarkStyle")}>
        <Select
          value={e.pngWatermarkStyle}
          width={190}
          onChange={(value) => setPatch({ pngWatermarkStyle: value as OptionsPayload["export"]["pngWatermarkStyle"] })}
        >
          {e.pngWatermarkStyleChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{t(choice.labelKey)}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.pngWatermarkText" label={t("settings.pngWatermarkText")}>
        <input
          key={e.pngWatermarkText}
          data-aries-control-appearance="local"
          type="text"
          defaultValue={e.pngWatermarkText}
          placeholder={t("chartExport.watermark")}
          aria-label={t("settings.pngWatermarkText")}
          aria-describedby="png-watermark-text-hint"
          spellCheck={false}
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (text !== e.pngWatermarkText) setPatch({ pngWatermarkText: text });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
          }}
          className="h-[var(--aries-control-height-micro)] w-[190px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
        />
      </Row>
      <p id="png-watermark-text-hint" className="pb-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] text-muted-foreground">
        {t("settings.pngWatermarkTextHint")}
      </p>
      <SectionLabel searchAnchor="section:settings.pdf">{t("settings.pdf")}</SectionLabel>
      <Row searchAnchor="settings.chartColors" label={t("settings.chartColors")}>
        <Select
          value={e.pdfChartColorMode}
          width={190}
          onChange={(value) => setPatch({ pdfChartColorMode: value as OptionsPayload["export"]["pdfChartColorMode"] })}
        >
          {e.pdfChartColorModeChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.pdfRasterPreset" label={t("settings.pdfRasterPreset")}>
        <Select
          value={e.pdfChartRasterPreset}
          width={190}
          onChange={(value) => setPatch({ pdfChartRasterPreset: value as OptionsPayload["export"]["pdfChartRasterPreset"] })}
        >
          {e.pdfChartRasterPresetChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.pdfPageFormat" label={t("settings.pdfPageFormat")}>
        <Select
          value={e.pdfPageFormat}
          width={190}
          onChange={(value) => setPatch({ pdfPageFormat: value as OptionsPayload["export"]["pdfPageFormat"] })}
        >
          {e.pdfPageFormatChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {t(choice.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.includeOverlays#2" label={t("settings.includeOverlays")}>
        <Toggle checked={e.pdfIncludeOverlays} onChange={(value) => setPatch({ pdfIncludeOverlays: value })} />
      </Row>
      <SectionLabel searchAnchor="section:settings.listExports">{t("settings.listExports")}</SectionLabel>
      <Row searchAnchor="textExport.textAndClipboard" label={t("textExport.textAndClipboard")}>
        <Select
          value={e.listExportAspectSymbols ? "glyphs" : "aliases"}
          width={190}
          onChange={(value) => setPatch({ listExportAspectSymbols: value === "glyphs" })}
        >
          <option value="aliases">{t("textExport.aliasNames")}</option>
          <option value="glyphs">{t("textExport.astrologicalGlyphs")}</option>
        </Select>
      </Row>
    </div>
  );
}

// Section title per colour group — the only presentation glue between the
// daemon `group` enum and a heading. Not an option catalog (no field/label/enum
// data); the daemon owns which attrs land in each group.
const COLOR_GROUP_ORDER: ColorFieldMeta["group"][] = ["chart", "element", "dignity", "chrome"];

function ColorsTab({
  opts,
  sendPatch,
  applyPreset,
}: TabProps & { applyPreset: (name: string) => void }) {
  const t = useT();
  const c = opts.colors;
  const cat = opts.catalog;

  const setColor = (attr: keyof OptionsPayload["colors"], rgb: RGB) => {
    // These two existing rows historically styled both the Tauri shell and
    // charts. Keep that UI behavior while the independently persisted app
    // slots allow future profiles to edit either authority on its own.
    const paired = attr === "clrbackground"
      ? { clrbackground: rgb, clrappbackground: rgb }
      : attr === "clrtexts"
        ? { clrtexts: rgb, clrapptexts: rgb }
        : { [attr]: rgb };
    sendPatch(
      { colors: paired },
      { ...opts, colors: { ...c, ...paired } },
    );
  };
  const setListColor = (key: "clrindividual" | "clraspect", index: number, rgb: RGB) => {
    const next = [...(c[key] as (RGB | null)[])];
    next[index] = rgb;
    sendPatch({ colors: { [key]: next } }, { ...opts, colors: { ...c, [key]: next } });
  };
  const setBool = (
    attr:
      | "useplanetcolors"
      | "blendminordignities"
      | "useplanetcolorsforsubdivisions"
      | "usezodiacelementcolors"
      | "usezodiacelementfieldcolors"
      | "follow_os_theme",
    v: boolean,
  ) => {
    sendPatch({ colors: { [attr]: v } }, { ...opts, colors: { ...c, [attr]: v } });
  };
  const setNumber = (attr: "zodiacelementfieldopacity", value: number) => {
    sendPatch(
      { colors: { [attr]: value } },
      { ...opts, colors: { ...c, [attr]: value } },
    );
  };

  // Group the daemon-provided colour fields by their `group` tag, preserving
  // daemon order within each group.
  const byGroup = (group: ColorFieldMeta["group"]) =>
    cat.colorFields.filter((f) => f.group === group);

  const rgbText = (rgb: RGB | null | undefined) =>
    rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "";
  const hexText = (rgb: RGB | null | undefined) =>
    rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}` : "";
  const appendRows = (lines: string[], section: string, rows: [string, RGB | null | undefined][]) => {
    rows.forEach(([name, rgb]) => {
      lines.push(`${section}\t${name}\t${hexText(rgb)}\t${rgbText(rgb)}`);
    });
  };
  const copyTable = () => {
    const lines = ["section\tname\thex\trgb"];
    for (const group of COLOR_GROUP_ORDER) {
      appendRows(
        lines,
        group === "element" ? "zodiac elements" : group,
        byGroup(group).map((f) => [f.label, c[f.attr] as RGB | null]),
      );
    }
    appendRows(
      lines,
      "bodies",
      cat.individualColors.map((p) => [p.label, c.clrindividual[p.index] ?? null]),
    );
    appendRows(
      lines,
      "aspects",
      cat.aspectLabels.map((label, i) => [label, c.clraspect[i] ?? null]),
    );
    lines.push(`flags\t${t("settings.useIndividualColors")}\t${c.useplanetcolors ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.showTriplicityGlyphs")}\t${c.showdignityglyphs ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.showTermGlyphs")}\t${c.showtermglyphs ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.showFaceGlyphs")}\t${c.showfaceglyphs ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.usePlanetColorsForSubdivisions")}\t${c.useplanetcolorsforsubdivisions ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.blendMinorDignities")}\t${c.blendminordignities ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.useZodiacElementGlyphColors")}\t${c.usezodiacelementcolors ? "1" : "0"}\t`);
    lines.push(`flags\t${t("settings.useZodiacElementFieldColors")}\t${c.usezodiacelementfieldcolors ? "1" : "0"}\t`);
    lines.push(`values\t${t("settings.zodiacElementFieldOpacity")}\t${Math.round(c.zodiacelementfieldopacity * 100)}%\t`);
    void navigator.clipboard?.writeText(lines.join("\n")).catch((err) => {
      console.error("[copy-color-table]", err);
    });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.palettePreset">{t("settings.palettePreset")}</SectionLabel>
      <div className="flex flex-wrap gap-[var(--aries-control-gap)] pb-[var(--aries-segmented-control-padding)]">
        {opts.themePresets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => applyPreset(preset.name)}
            aria-pressed={Boolean(preset.selected)}
            className={`rounded-[var(--aries-radius-menu-item)] border border-transparent px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] hover:bg-accent hover:text-accent-foreground ${
              preset.selected
                ? "bg-accent text-accent-foreground"
                : "text-foreground/80"
            }`}
          >
            {preset.label ?? preset.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-[var(--aries-control-gap)] pb-[var(--aries-segmented-control-padding)]">
        <button
          type="button"
          onClick={copyTable}
          className="rounded-[var(--aries-radius-control-compact)] border border-border/60 px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-small)] text-foreground/80 hover:border-border hover:text-foreground"
        >
          {t("settings.copyTable")}
        </button>
      </div>
      <Row searchAnchor="settings.followOsTheme" label={t("settings.followOsTheme")}>
        <Toggle checked={c.follow_os_theme} onChange={(v) => setBool("follow_os_theme", v)} />
      </Row>

      {COLOR_GROUP_ORDER.map((group) => {
        const fields = byGroup(group);
        if (fields.length === 0) return null;
        return (
          <React.Fragment key={group}>
            <SectionLabel searchAnchor={`section:${COLOR_GROUP_TITLE_KEYS[group]}`}>{t(COLOR_GROUP_TITLE_KEYS[group])}</SectionLabel>
            {group === "dignity" ? (
              <>
                <Row searchAnchor="settings.blendMinorDignities" label={t("settings.blendMinorDignities")}>
                  <Toggle
                    checked={c.blendminordignities}
                    disabled={c.useplanetcolors}
                    onChange={(v) => setBool("blendminordignities", v)}
                  />
                </Row>
              </>
            ) : null}
            {group === "element" ? (
              <>
                <Row searchAnchor="settings.usePlanetColorsForSubdivisions" label={t("settings.usePlanetColorsForSubdivisions")}>
                  <Toggle
                    checked={c.useplanetcolorsforsubdivisions}
                    onChange={(v) => setBool("useplanetcolorsforsubdivisions", v)}
                  />
                </Row>
                <Row searchAnchor="settings.useZodiacElementGlyphColors" label={t("settings.useZodiacElementGlyphColors")}>
                  <Toggle
                    checked={c.usezodiacelementcolors}
                    onChange={(v) => setBool("usezodiacelementcolors", v)}
                  />
                </Row>
                <Row searchAnchor="settings.useZodiacElementFieldColors" label={t("settings.useZodiacElementFieldColors")}>
                  <Toggle
                    checked={c.usezodiacelementfieldcolors}
                    onChange={(v) => setBool("usezodiacelementfieldcolors", v)}
                  />
                </Row>
                <Row searchAnchor="settings.zodiacElementFieldOpacity" label={<SubLabel>{t("settings.zodiacElementFieldOpacity")}</SubLabel>}>
                  <Slider
                    value={Math.round(c.zodiacelementfieldopacity * 100)}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    live
                    onPreview={(value) => previewZodiacFieldOpacity(value / 100)}
                    disabled={!c.usezodiacelementfieldcolors}
                    onCommit={(value) => setNumber("zodiacelementfieldopacity", value / 100)}
                  />
                </Row>
              </>
            ) : null}
            {fields.map((f) => (
              <Row key={f.attr} searchAnchor={`color:${f.attr}`} label={f.label}>
                <Swatch value={c[f.attr] as RGB | null} label={f.label} attr={f.attr} onCommit={(rgb) => setColor(f.attr, rgb)} />
              </Row>
            ))}
          </React.Fragment>
        );
      })}

      <SectionLabel searchAnchor="section:settings.individualBodies">{t("settings.individualBodies")}</SectionLabel>
      <Row searchAnchor="settings.useIndividualColors" label={t("settings.useIndividualColors")}>
        <Toggle checked={c.useplanetcolors} onChange={(v) => setBool("useplanetcolors", v)} />
      </Row>
      {cat.individualColors.map((p) => (
        <Row
          key={p.index}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={p.glyph} />
              {p.label}
            </span>
          }
        >
          <Swatch
            value={c.clrindividual[p.index] ?? null}
            label={p.label}
            attr="clrindividual"
            index={p.index}
            onCommit={(rgb) => setListColor("clrindividual", p.index, rgb)}
          />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.aspects">{t("settings.aspects")}</SectionLabel>
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          <Swatch value={c.clraspect[i] ?? null} label={label} attr="clraspect" index={i} onCommit={(rgb) => setListColor("clraspect", i, rgb)} />
        </Row>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Appearance  (appearance1dlg subset the backend exposes)
// ---------------------------------------------------------------------------

const MINOR_ASPECT_INDICES = new Set([1, 2, 4, 7, 8, 9, 11]);

function AppearanceTab({ opts, sendPatch, onBeforeWheelAction }: TabProps & {onBeforeWheelAction?: () => Promise<void>}) {
  const t = useT();
  const d = opts.display;
  const aspectList = opts.aspectList;
  const q = opts.quickCharts;
  const cat = opts.catalog;
  const solarConditionMode = cat.solarConditionModes.find(
    (mode) => mode.value === d.solarconditionmode,
  );
  type DisplayPatch = Partial<OptionsPayload["display"]>;
  type QuickChartsPatch = Partial<OptionsQuickCharts>;
  const setSectAllowance = (patch: Pick<Partial<OptionsPlanetsPoints>, "daynightorbdeg" | "daynightorbmin">) => {
    sendPatch({ planetsPoints: patch }, { ...opts, planetsPoints: { ...opts.planetsPoints, ...patch } });
  };
  const setDisplayPatch = (patch: DisplayPatch) => {
    sendPatch({ display: patch }, { ...opts, display: { ...d, ...patch } });
  };
  const setAspectListPatch = (patch: Partial<OptionsPayload["aspectList"]>) => {
    sendPatch(
      { aspectList: patch },
      { ...opts, aspectList: { ...aspectList, ...patch } },
    );
  };
  const setQuickChartsPatch = (patch: QuickChartsPatch) => {
    sendPatch({ quickCharts: patch }, { ...opts, quickCharts: { ...q, ...patch } });
  };
  const setBool = (attr: keyof OptionsPayload["display"], v: boolean) => {
    setDisplayPatch({ [attr]: v } as DisplayPatch);
  };
  const setNum = (attr: keyof OptionsPayload["display"], n: number) => {
    setDisplayPatch({ [attr]: n } as DisplayPatch);
  };
  const setStr = (attr: keyof OptionsPayload["display"], s: string) => {
    setDisplayPatch({ [attr]: s } as DisplayPatch);
  };
  // Element-wise patch of a fixed-length bool vector (aspect[] / transcendental[]).
  const setVec = (attr: "aspect" | "transcendental", i: number, v: boolean) => {
    const next = [...d[attr]];
    next[i] = v;
    setDisplayPatch({
      [attr]: next,
      ...(attr === "aspect" && v && MINOR_ASPECT_INDICES.has(i)
        ? { traditionalaspects: false }
        : {}),
    } as DisplayPatch);
  };
  const setTraditionalAspects = (v: boolean) => {
    const patch: DisplayPatch = { traditionalaspects: v };
    if (v) {
      const nextAspect = [...d.aspect];
      for (const i of MINOR_ASPECT_INDICES) nextAspect[i] = false;
      patch.aspect = nextAspect;
    }
    setDisplayPatch(patch);
  };
  const setAspects = (v: boolean) => {
    setDisplayPatch({ aspects: v });
  };
  const setShownodes = (v: boolean) => {
    setDisplayPatch({ shownodes: v, ...(!v ? { aspectstonodes: false } : {}) });
  };
  const setShowvertex = (v: boolean) => {
    setDisplayPatch({ showvertex: v, ...(!v ? { showaspectstovertex: false } : {}) });
  };
  const setShowlof = (v: boolean) => {
    setDisplayPatch({
      showlof: v,
      ...(!v ? { showaspectstolof: false, showlofouterring: false } : {}),
    });
  };
  const setExclusiveAspects = (v: boolean) => {
    setDisplayPatch({
      exclusive_aspects_on_click: v,
      ...(!v
        ? {
            exclusive_aspects_on_click_show_minor: false,
            exclusive_aspects_on_click_traditional: false,
          }
        : {}),
    });
  };
  const setShowfixstars = (value: number) => {
    const patch: DisplayPatch = { showfixstars: value };
    if (![1, 6, 7, 8].includes(value)) {
      Object.assign(patch, {
        showfixstarsnodes: false,
        showfixstarshcs: false,
        showfixstarslof: false,
      });
    }
    setDisplayPatch(patch);
  };
  const setTerms = (v: boolean) => {
    sendPatch(
      { display: { showterms: v }, dignities: { showterms: v } },
      { ...opts, display: { ...d, showterms: v }, dignities: { ...opts.dignities, showterms: v } },
    );
  };
  const setGlyphFlag = (attr: "showdignityglyphs" | "showtermglyphs" | "showfaceglyphs", v: boolean) => {
    sendPatch({ colors: { [attr]: v } }, { ...opts, colors: { ...opts.colors, [attr]: v } });
  };
  const setDignityLabelColors = (v: boolean) => {
    sendPatch(
      { dignities: { dignitylabelcolors: v } },
      { ...opts, dignities: { ...opts.dignities, dignitylabelcolors: v } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.zodiacAndHouses">{t("settings.zodiacAndHouses")}</SectionLabel>
      <Row searchAnchor="settings.ayanamsha" label={t("settings.ayanamsha")}>
        <Select
          value={opts.ayanamsha.ayanamsha}
          width={220}
          onChange={(v) =>
            sendPatch(
              { ayanamsha: { ayanamsha: Number(v) } },
              { ...opts, ayanamsha: { ...opts.ayanamsha, ayanamsha: Number(v) } },
            )
          }
        >
          {opts.ayanamsha.available.map((entry) => (
            <option key={entry.index} value={entry.index}>{entry.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.houseSystem" label={t("settings.houseSystem")}>
        <Select
          value={opts.houseSystem.hsys}
          width={220}
          onChange={(code) =>
            sendPatch(
              { houseSystem: { hsys: code } },
              { ...opts, houseSystem: { ...opts.houseSystem, hsys: code } },
            )
          }
        >
          {opts.houseSystem.available.map((entry) => (
            <option key={entry.code} value={entry.code}>{entry.labelKey ? t(entry.labelKey) : entry.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.topocentricMoon" label={t("settings.topocentricMoon")}>
        <Toggle checked={d.topocentric} onChange={(v) => setBool("topocentric", v)} />
      </Row>
      <Row searchAnchor="settings.houses" label={t("settings.houses")}>
        <Toggle checked={d.houses} onChange={(v) => setBool("houses", v)} />
      </Row>
      <Row searchAnchor="settings.outerHouseLines" label={<SubLabel>{t("settings.outerHouseLines")}</SubLabel>}>
        <Toggle
          checked={d.houses && d.showouterhouselines}
          disabled={!d.houses}
          onChange={(v) => setBool("showouterhouselines", v)}
        />
      </Row>
      <Row searchAnchor="settings.zodiacForManazil" label={t("settings.zodiacForManazil")}>
        <Select
          value={opts.lunarMansions.manazil_zodiac}
          width={180}
          onChange={(v) =>
            sendPatch(
              { lunarMansions: { manazil_zodiac: v } },
              { ...opts, lunarMansions: { ...opts.lunarMansions, manazil_zodiac: v } },
            )
          }
        >
          {cat.mansionZodiacModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.sect">{t("settings.sect")}</SectionLabel>
      <Row searchAnchor="settings.dayNightOrb" label={t("settings.dayNightOrb")}>
        <span className="flex items-center gap-[var(--aries-form-field-gap)]">
          <span className="flex items-center gap-[var(--aries-control-gap-compact)]" data-settings-search-anchor="settings.dayNightOrbDegrees">
            <NumberField
              ariaLabel={t("settings.dayNightOrbDegrees")}
              value={opts.planetsPoints.daynightorbdeg}
              min={0}
              max={6}
              onCommit={(n) => setSectAllowance({ daynightorbdeg: n })}
            />
            <span aria-hidden="true">°</span>
          </span>
          <span className="flex items-center gap-[var(--aries-control-gap-compact)]" data-settings-search-anchor="settings.dayNightOrbMinutes">
            <NumberField
              ariaLabel={t("settings.dayNightOrbMinutes")}
              value={opts.planetsPoints.daynightorbmin}
              min={0}
              max={59}
              onCommit={(n) => setSectAllowance({ daynightorbmin: n })}
            />
            <span aria-hidden="true">′</span>
          </span>
        </span>
      </Row>
      <Row searchAnchor="settings.dayNightOrbForLotsAlmutens" label={<SubLabel>{t("settings.dayNightOrbForLotsAlmutens")}</SubLabel>}>
        <Toggle
          checked={opts.almutens.usedaynightorb}
          onChange={(v) =>
            sendPatch({ almutens: { usedaynightorb: v } }, { ...opts, almutens: { ...opts.almutens, usedaynightorb: v } })
          }
        />
      </Row>
      <p className="mt-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-foreground/60">
        {t("settings.dayNightOrbHint")}
      </p>

      <SectionLabel searchAnchor="section:settings.termsAndDecans">{t("settings.termsAndDecans")}</SectionLabel>
      <Row searchAnchor="settings.terms" label={t("settings.terms")}>
        <Toggle checked={d.showterms} onChange={setTerms} />
      </Row>
      <Row searchAnchor="settings.decans" label={t("settings.decans")}>
        <Toggle checked={d.showdecans} onChange={(v) => setBool("showdecans", v)} />
      </Row>
      <Row searchAnchor="settings.colorDignityLabelsFromGlyph" label={t("settings.colorDignityLabelsFromGlyph")}>
        <Toggle checked={opts.dignities.dignitylabelcolors} onChange={setDignityLabelColors} />
      </Row>
      <Row searchAnchor="settings.showTriplicityGlyphs" label={<SubLabel>{t("settings.showTriplicityGlyphs")}</SubLabel>}>
        <Toggle checked={opts.colors.showdignityglyphs} onChange={(v) => setGlyphFlag("showdignityglyphs", v)} />
      </Row>
      <Row searchAnchor="settings.showTermGlyphs" label={<SubLabel>{t("settings.showTermGlyphs")}</SubLabel>}>
        <Toggle checked={opts.colors.showtermglyphs} onChange={(v) => setGlyphFlag("showtermglyphs", v)} />
      </Row>
      <Row searchAnchor="settings.showFaceGlyphs" label={<SubLabel>{t("settings.showFaceGlyphs")}</SubLabel>}>
        <Toggle checked={opts.colors.showfaceglyphs} onChange={(v) => setGlyphFlag("showfaceglyphs", v)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.bodiesAndPoints">{t("settings.bodiesAndPoints")}</SectionLabel>
      {/* Transcendental U/N/P — labels/glyphs from the catalog. */}
      {cat.transcendentalLabels.map((item, i) => (
        <Row
          key={item.label}
          label={
            <ObjectLabel glyph={item.glyph}>
              {item.label}
            </ObjectLabel>
          }
        >
          <Toggle
            checked={Boolean(d.transcendental[i])}
            onChange={(v) => setVec("transcendental", i, v)}
          />
        </Row>
      ))}
      <Row searchAnchor="settings.chiron" label={<ObjectLabel glyph={PLANET_GLYPHS[SE_CHIRON]}>{t("settings.chiron")}</ObjectLabel>}>
        <Toggle checked={d.showchiron} onChange={(v) => setBool("showchiron", v)} />
      </Row>
      <Row searchAnchor="settings.apogee" label={<ObjectLabel glyph={PLANET_GLYPHS[SE_MEAN_APOG]}>{t("settings.apogee")}</ObjectLabel>}>
        <div className="flex items-center gap-[var(--aries-control-gap)]">
          <Select ariaLabel={t("settings.apogee")} value={d.meanapogee ? 1 : 0} width={110} onChange={(v) => setBool("meanapogee", Number(v) === 1)}>
            <option value={1}>{t("settings.mean")}</option>
            <option value={0}>{t("settings.true")}</option>
          </Select>
          <Toggle checked={d.showapogee} onChange={(v) => setBool("showapogee", v)} />
        </div>
      </Row>
      <Row searchAnchor="settings.vertex" label={<ObjectLabel glyph={VERTEX_GLYPH}>{t("settings.vertex")}</ObjectLabel>}>
        <Toggle checked={d.showvertex} onChange={setShowvertex} />
      </Row>
      <Row searchAnchor="settings.aspectsToVertex" label={<SubLabel>{t("settings.aspectsToVertex")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.showvertex && d.showaspectstovertex}
          disabled={!d.aspects || !d.showvertex}
          onChange={(v) => setBool("showaspectstovertex", v)}
        />
      </Row>
      <Row searchAnchor="settings.nodes" label={<ObjectLabel glyph={PLANET_GLYPHS[SE_MEAN_NODE]}>{t("settings.nodes")}</ObjectLabel>}>
        <div className="flex items-center gap-[var(--aries-control-gap)]">
          <Select
            ariaLabel={t("settings.nodeCalculation")}
            value={opts.planetsPoints.meannode ? 1 : 0}
            width={110}
            onChange={(v) => {
              const planetsPoints = { ...opts.planetsPoints, meannode: Number(v) === 1 };
              sendPatch({ planetsPoints: { meannode: planetsPoints.meannode } }, { ...opts, planetsPoints });
            }}
          >
            <option value={1}>{t("settings.mean")}</option>
            <option value={0}>{t("settings.true")}</option>
          </Select>
          <Toggle checked={d.shownodes} onChange={setShownodes} />
        </div>
      </Row>
      <Row searchAnchor="settings.aspectsToNodes" label={<SubLabel>{t("settings.aspectsToNodes")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.shownodes && d.aspectstonodes}
          disabled={!d.aspects || !d.shownodes}
          onChange={(v) => setBool("aspectstonodes", v)}
        />
      </Row>
      <Row searchAnchor="settings.fortuna" label={<ObjectLabel glyph={FORTUNE_GLYPH}>{t("settings.fortuna")}</ObjectLabel>}>
        <Toggle checked={d.showlof} onChange={setShowlof} />
      </Row>
      <Row searchAnchor="settings.aspectsToFortuna" label={<SubLabel>{t("settings.aspectsToFortuna")}</SubLabel>}>
        <Toggle
          checked={d.aspects && d.showlof && d.showaspectstolof}
          disabled={!d.aspects || !d.showlof}
          onChange={(v) => setBool("showaspectstolof", v)}
        />
      </Row>
      <Row searchAnchor="settings.outerRingFortunaLabel" label={<SubLabel>{t("settings.outerRingFortunaLabel")}</SubLabel>}>
        <Toggle
          checked={d.showlof && d.showlofouterring}
          disabled={!d.showlof}
          onChange={(v) => setBool("showlofouterring", v)}
        />
      </Row>
      <Row searchAnchor="settings.prenatalSyzygy" label={<ObjectLabel glyph={SYZYGY_MARKER} font="text">{t("settings.prenatalSyzygy")}</ObjectLabel>}>
        <Toggle checked={d.showprenatalsyzygy} onChange={(v) => setBool("showprenatalsyzygy", v)} />
      </Row>
      <Row searchAnchor="settings.referencePoint" label={<SubLabel>{t("settings.referencePoint")}</SubLabel>}>
        <Select
          ariaLabel={t("settings.referencePoint")}
          value={opts.planetsPoints.syzmoon}
          width={280}
          onChange={(v) => {
            const planetsPoints = { ...opts.planetsPoints, syzmoon: Number(v) };
            sendPatch({ planetsPoints: { syzmoon: planetsPoints.syzmoon } }, { ...opts, planetsPoints });
          }}
        >
          {cat.syzygyModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.prenatalEclipseMarker" label={<ObjectLabel glyph={ECLIPSE_MARKER} font="text">{t("settings.prenatalEclipseMarker")}</ObjectLabel>}>
        <Toggle checked={d.showprenataleclipse} onChange={(v) => setBool("showprenataleclipse", v)} />
      </Row>
      <Row searchAnchor="settings.prenatalEclipseKinds" label={<SubLabel>{t("settings.prenatalEclipseKinds")}</SubLabel>}>
        <Select
          ariaLabel={t("settings.prenatalEclipseKinds")}
          value={opts.eclipses.prenatal_eclipse_mode}
          width={200}
          onChange={(v) => {
            const prenatal_eclipse_mode = v as OptionsPayload["eclipses"]["prenatal_eclipse_mode"];
            sendPatch({ eclipses: { prenatal_eclipse_mode } }, { ...opts, eclipses: { ...opts.eclipses, prenatal_eclipse_mode } });
          }}
        >
          <option value="solar_only">{t("settings.prenatalEclipseSolarOnly")}</option>
          <option value="solar_and_lunar">{t("settings.prenatalEclipseSolarAndLunar")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.chartPositionLabels" label={t("settings.chartPositionLabels")}>
        <Toggle checked={d.positions} onChange={(v) => setBool("positions", v)} />
      </Row>
      <Row searchAnchor="settings.showArcMinutes" label={<SubLabel>{t("settings.showArcMinutes")}</SubLabel>}>
        <Toggle
          checked={d.positions && d.positionsminutes}
          disabled={!d.positions}
          onChange={(v) => setBool("positionsminutes", v)}
        />
      </Row>
      <Row searchAnchor="settings.outerRingPositions" label={t("settings.outerRingPositions")}>
        <Toggle checked={d.showouterpositions} onChange={(v) => setBool("showouterpositions", v)} />
      </Row>
      <Row searchAnchor="settings.showArcMinutes#2" label={<SubLabel>{t("settings.showArcMinutes")}</SubLabel>}>
        <Toggle
          checked={d.showouterpositions && d.showouterminutes}
          disabled={!d.showouterpositions}
          onChange={(v) => setBool("showouterminutes", v)}
        />
      </Row>
      <Row searchAnchor="settings.showMansionInMoonInspector" label={t("settings.showMansionInMoonInspector")}>
        <Toggle
          checked={opts.lunarMansions.show_manzil_in_inspector}
          onChange={(v) =>
            sendPatch(
              { lunarMansions: { show_manzil_in_inspector: v } },
              { ...opts, lunarMansions: { ...opts.lunarMansions, show_manzil_in_inspector: v } },
            )
          }
        />
      </Row>

      <SymbolsSection opts={opts} sendPatch={sendPatch} />

      <SectionLabel searchAnchor="section:settings.aspects">{t("settings.aspects")}</SectionLabel>
      <Row searchAnchor="settings.aspects" label={t("settings.aspects")}>
        <Toggle checked={d.aspects} onChange={setAspects} />
      </Row>
      <Row searchAnchor="settings.withSymbols" label={t("settings.withSymbols")}>
        <Toggle checked={d.symbols} disabled={!d.aspects} onChange={(v) => setBool("symbols", v)} />
      </Row>
      <Row searchAnchor="settings.traditional" label={t("settings.traditional")}>
        <Toggle
          checked={d.traditionalaspects}
          disabled={!d.aspects}
          onChange={setTraditionalAspects}
        />
      </Row>
      {/* Per-aspect draw toggles — labels/glyphs reuse the catalog aspect list. */}
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(d.aspect[i])}
            disabled={!d.aspects || (d.traditionalaspects && MINOR_ASPECT_INDICES.has(i))}
            onChange={(v) => setVec("aspect", i, v)}
          />
        </Row>
      ))}
      <Row searchAnchor="settings.aspectsToAngles" label={t("settings.aspectsToAngles")}>
        <span />
      </Row>
      <Row searchAnchor="primdir.angleAsc" label={<SubLabel>{t("primdir.angleAsc")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstoasc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstoasc", v)}
        />
      </Row>
      <Row searchAnchor="primdir.angleMC" label={<SubLabel>{t("primdir.angleMC")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstomc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstomc", v)}
        />
      </Row>
      <Row searchAnchor="primdir.angleDsc" label={<SubLabel>{t("primdir.angleDsc")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstodsc}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstodsc", v)}
        />
      </Row>
      <Row searchAnchor="primdir.angleIC" label={<SubLabel>{t("primdir.angleIC")}</SubLabel>}>
        <Toggle
          checked={d.showaspectstoic}
          disabled={!d.aspects}
          onChange={(v) => setBool("showaspectstoic", v)}
        />
      </Row>
      {/* Aspect behaviour toggles (appearance1dlg.py). The exclusive-on-click subs
          are gated on their master (and the master on `aspects`) — mirrors
          _sync_dependent_aspect_toggles (appearance1dlg.py:726-730). */}
      <Row searchAnchor="settings.exclusiveAspectsOnClick" label={t("settings.exclusiveAspectsOnClick")}>
        <Toggle
          checked={d.exclusive_aspects_on_click}
          disabled={!d.aspects}
          onChange={setExclusiveAspects}
        />
      </Row>
      <Row searchAnchor="settings.showMinor" label={<SubLabel>{t("settings.showMinor")}</SubLabel>}>
        <Toggle
          checked={d.exclusive_aspects_on_click_show_minor}
          disabled={
            !d.aspects ||
            !d.exclusive_aspects_on_click ||
            d.exclusive_aspects_on_click_traditional
          }
          onChange={(v) =>
            setDisplayPatch({
              exclusive_aspects_on_click_show_minor: v,
              ...(v ? { exclusive_aspects_on_click_traditional: false } : {}),
            })
          }
        />
      </Row>
      <Row searchAnchor="settings.traditional#2" label={<SubLabel>{t("settings.traditional")}</SubLabel>}>
        <Toggle
          checked={d.exclusive_aspects_on_click_traditional}
          disabled={!d.aspects || !d.exclusive_aspects_on_click}
          onChange={(v) =>
            setDisplayPatch({
              exclusive_aspects_on_click_traditional: v,
              ...(v ? { exclusive_aspects_on_click_show_minor: false } : {}),
            })
          }
        />
      </Row>
      <Row searchAnchor="settings.aspectDrawingStandard" label={t("settings.aspectDrawingStandard")}>
        <Toggle
          checked={!d.aspect_thickness_mode && !d.aspect_opacity_mode}
          disabled={!d.aspects}
          onChange={(v) => v && setDisplayPatch({ aspect_thickness_mode: false, aspect_opacity_mode: false })}
        />
      </Row>
      <Row searchAnchor="settings.aspectDrawingLineThickness" label={<SubLabel>{t("settings.aspectDrawingLineThickness")}</SubLabel>}>
        <Toggle
          checked={d.aspect_thickness_mode}
          disabled={!d.aspects}
          onChange={(v) => setBool("aspect_thickness_mode", v)}
        />
      </Row>
      <Row searchAnchor="settings.aspectDrawingOpacity" label={<SubLabel>{t("settings.aspectDrawingOpacity")}</SubLabel>}>
        <Toggle
          checked={d.aspect_opacity_mode}
          disabled={!d.aspects}
          onChange={(v) => setBool("aspect_opacity_mode", v)}
        />
      </Row>

      <SectionLabel searchAnchor="section:settings.outerRing">{t("settings.outerRing")}</SectionLabel>
      <Row searchAnchor="settings.mode" label={t("settings.mode")}>
        <Select
          value={d.showfixstars}
          width={150}
          onChange={(v) => setShowfixstars(Number(v))}
        >
          {opts.catalog.fixstarsModes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </Row>
      <SectionLabel searchAnchor="section:settings.outerRingConjunctionTargets">{t("settings.outerRingConjunctionTargets")}</SectionLabel>
      {/* Inner-object visibility is shared with the chart. Only structural
          cusp inclusion is an independent outer-ring filter. */}
      {(() => {
        const subsEnabled = [1, 6, 7, 8].includes(d.showfixstars);
        return (
          <>
            <Row searchAnchor="settings.nodes#2" label={<SubLabel>{t("settings.nodes")}</SubLabel>}>
              <Toggle
                checked={d.shownodes}
                disabled={!subsEnabled}
                onChange={setShownodes}
              />
            </Row>
            <Row searchAnchor="settings.intermediateHouseCusps" label={<SubLabel>{t("settings.intermediateHouseCusps")}</SubLabel>}>
              <Toggle
                checked={d.showfixstarshcs}
                disabled={!subsEnabled}
                onChange={(v) => setBool("showfixstarshcs", v)}
              />
            </Row>
            <Row searchAnchor="settings.fortuna#2" label={<SubLabel>{t("settings.fortuna")}</SubLabel>}>
              <Toggle
                checked={d.showlof}
                disabled={!subsEnabled}
                onChange={setShowlof}
              />
            </Row>
          </>
        );
      })()}
      <Row searchAnchor="settings.morinAntiscia" label={t("settings.morinAntiscia")}>
        <Toggle checked={d.morin_antiscia} onChange={(v) => setBool("morin_antiscia", v)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.combustion">{t("settings.combustion")}</SectionLabel>
      <Row searchAnchor="settings.doctrine" label={t("settings.doctrine")}>
        <Select
          value={d.solarconditionmode}
          width={180}
          onChange={(v) => setNum("solarconditionmode", Number(v))}
        >
          {cat.solarConditionModes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {t(mode.labelKey)}
            </option>
          ))}
        </Select>
      </Row>
      {solarConditionMode ? (
        <p
          aria-live="polite"
          className="border-b border-border/40 py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/60"
        >
          {t(solarConditionMode.descriptionKey)}
        </p>
      ) : null}

      <SectionLabel searchAnchor="section:settings.phasisHeliacal">{t("settings.phasisHeliacal")}</SectionLabel>
      <Row searchAnchor="settings.mode#2" label={t("settings.mode")}>
        <Select
          value={d.phasismode}
          width={150}
          onChange={(v) => setNum("phasismode", Number(v))}
        >
          {cat.phasisModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.modernPlanets" label={t("settings.modernPlanets")}>
        <Toggle checked={d.extendedradixstations} onChange={(v) => setBool("extendedradixstations", v)} />
      </Row>

      <SectionLabel searchAnchor="section:voc.title">{t("voc.title")}</SectionLabel>
      <Row searchAnchor="settings.display" label={t("settings.display")}>
        <Toggle checked={d.showvoidcourse} onChange={(v) => setBool("showvoidcourse", v)} />
      </Row>
      <Row searchAnchor="settings.doctrine#2" label={t("settings.doctrine")}>
        <Select value={d.voidcoursepolicy} width={220} onChange={(v) => setNum("voidcoursepolicy", Number(v))}>
          {cat.voidCoursePolicies.map((policy) => (
            <option key={policy.value} value={policy.value}>{t(policy.labelKey)}</option>
          ))}
        </Select>
      </Row>
      <p className="border-b border-border/40 py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/60" aria-live="polite">
        {t(cat.voidCoursePolicies.find((policy) => policy.value === d.voidcoursepolicy)?.descriptionKey ?? "voc.hellenisticDescription")}
      </p>

      <SectionLabel searchAnchor="section:settings.cazimi">{t("settings.cazimi")}</SectionLabel>
      <Row searchAnchor="settings.display#2" label={t("settings.display")}>
        <Toggle checked={d.showcazimi} onChange={(v) => setBool("showcazimi", v)} />
      </Row>
      <Row searchAnchor="settings.mode#3" label={t("settings.mode")}>
        <Select
          value={d.cazimimode}
          width={150}
          onChange={(v) => setNum("cazimimode", Number(v))}
        >
          {cat.cazimiModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.eclipses">{t("settings.eclipses")}</SectionLabel>
      <Row searchAnchor="settings.eclipseOverlay" label={t("settings.eclipseOverlay")}>
        <Toggle checked={d.showeclipseoverlay} onChange={(v) => setBool("showeclipseoverlay", v)} />
      </Row>
      <Row searchAnchor="settings.openEclipseChartsAt" label={t("settings.openEclipseChartsAt")}>
        <Select
          value={opts.eclipses.eclipse_chart_moment}
          width={180}
          onChange={(v) =>
            sendPatch(
              { eclipses: { eclipse_chart_moment: v } },
              { ...opts, eclipses: { ...opts.eclipses, eclipse_chart_moment: v } },
            )
          }
        >
          {cat.eclipseModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.chartLayout">{t("settings.chartLayout")}</SectionLabel>
      <Row searchAnchor="settings.subChartsAsBiwheels" label={t("settings.subChartsAsBiwheels")}>
        <Toggle
          checked={q.subcharts_open_compound_default}
          onChange={(v) => setQuickChartsPatch({ subcharts_open_compound_default: v })}
        />
      </Row>
      <Row searchAnchor="settings.multiwheelOpenAtThree" label={t("settings.multiwheelOpenAtThree")}>
        <Toggle
          checked={q.multiwheel_open_at_three}
          onChange={(v) => setQuickChartsPatch({ multiwheel_open_at_three: v })}
        />
      </Row>
      <div data-settings-search-anchor="wheelPreset.title">
        <WheelPresetControls profile={wheelTypographyProfileForTheme(d.theme)} surface="settings" beforeAction={onBeforeWheelAction} />
      </div>
      {d.theme === 2 ? (
        <Row searchAnchor="settings.angloDenseLabelLayout" label={t("settings.angloDenseLabelLayout")}>
          <Select
            value={d.anglo_dense_label_layout}
            width={180}
            onChange={(v) => setStr("anglo_dense_label_layout", v)}
          >
            {cat.angloDenseLabelLayouts.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.value === "routed-cusps"
                  ? t("settings.routedCuspLines")
                  : layout.value === "sign-locked"
                  ? t("settings.signLockedCusps")
                  : t("settings.leaderColumns")}
              </option>
            ))}
          </Select>
        </Row>
      ) : null}
      <Row searchAnchor="settings.angleArrowheads" label={t("settings.angleArrowheads")}>
        <Toggle
          checked={d.showanglearrowheads}
          onChange={(v) => setBool("showanglearrowheads", v)}
        />
      </Row>
      <Row searchAnchor="settings.cusplessAscMcLabels" label={t("settings.cusplessAscMcLabels")}>
        <Toggle
          checked={d.showcusplessascmclabels}
          onChange={(v) => setBool("showcusplessascmclabels", v)}
        />
      </Row>

      <SectionLabel searchAnchor="section:chartmenu.ascensional">{t("chartmenu.ascensional")}</SectionLabel>
      <Row searchAnchor="settings.ascensionalReadout" label={t("settings.ascensionalReadout")}>
        <Select
          ariaLabel={t("settings.ascensionalReadout")}
          value={d.ascensional_readout}
          onChange={(v) => setStr("ascensional_readout", v)}
        >
          <option value="mdo-quadrant">{t("chartmenu.mdoReadout")}</option>
          <option value="absolute">{t("chartmenu.absoluteDegrees")}</option>
          <option value="equatorial-signs">{t("chartmenu.equatorialNotation")}</option>
        </Select>
      </Row>
      <Row searchAnchor="chartmenu.equatorialSigns" label={t("chartmenu.equatorialSigns")}>
        <Toggle
          checked={d.ascensional_equatorial_signs}
          onChange={(v) => setBool("ascensional_equatorial_signs", v)}
        />
      </Row>
      <Row searchAnchor="settings.ascensionalPrecessionMeasure" label={t("settings.ascensionalPrecessionMeasure")}>
        <Select
          ariaLabel={t("settings.ascensionalPrecessionMeasure")}
          value={d.ascensional_precession_measure}
          onChange={(v) => setStr("ascensional_precession_measure", v)}
        >
          <option value="ecliptic">{t("settings.ascensionalPrecessionEcliptic")}</option>
          <option value="equatorial">{t("settings.ascensionalPrecessionEquatorial")}</option>
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.multiwheel">{t("settings.multiwheel")}</SectionLabel>
      <Row searchAnchor="settings.chartRingZodiac" label={t("settings.chartRingZodiac")}>
        <Select
          value={q.chart_ring_zodiac}
          width={150}
          onChange={(v) => setQuickChartsPatch({ chart_ring_zodiac: v === "centre" ? "centre" : "rim" })}
        >
          <option value="rim">{t("chartmenu.zodiacOutermost")}</option>
          <option value="centre">{t("chartmenu.zodiacInnermost")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.multiwheelShowPositions" label={t("settings.multiwheelShowPositions")}>
        <Toggle
          checked={d.positions && d.multiwheel_show_positions}
          disabled={!d.positions}
          onChange={(v) => setBool("multiwheel_show_positions", v)}
        />
      </Row>
      <Row searchAnchor="settings.multiwheelShowMinutes" label={<SubLabel>{t("settings.multiwheelShowMinutes")}</SubLabel>}>
        <Toggle
          checked={d.positions && d.multiwheel_show_positions && d.multiwheel_show_minutes}
          disabled={!d.positions || !d.multiwheel_show_positions}
          onChange={(v) => setBool("multiwheel_show_minutes", v)}
        />
      </Row>
      <Row searchAnchor="settings.multiwheelSignColors" label={t("settings.multiwheelSignColors")}>
        <Toggle
          checked={d.multiwheel_sign_colors}
          onChange={(v) => setBool("multiwheel_sign_colors", v)}
        />
      </Row>
      <Row searchAnchor="settings.multiwheelAngleLabels" label={t("settings.multiwheelAngleLabels")}>
        <Toggle
          checked={d.multiwheel_show_angle_labels}
          onChange={(v) => setBool("multiwheel_show_angle_labels", v)}
        />
      </Row>

      <SectionLabel searchAnchor="section:settings.sizes">{t("settings.sizes")}</SectionLabel>
      {/* Numeric sliders rendered generically from catalog.sliders. */}
      {cat.sliders.map((s) => (
        <Row key={s.attr} searchAnchor={`slider:${s.attr}`} label={s.label}>
          <Slider
            key={`${s.attr}:${Number(d[s.attr] ?? s.min)}`}
            value={Number(d[s.attr] ?? s.min)}
            min={s.min}
            max={s.max}
            step={s.step}
            onCommit={(n) => setNum(s.attr, s.kind === "int" ? Math.round(n) : n)}
          />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.chartHeader">{t("settings.chartHeader")}</SectionLabel>
      <Row searchAnchor="settings.planetaryHour" label={t("settings.planetaryHour")}>
        <Toggle checked={d.planetarydayhour} onChange={(v) => setBool("planetarydayhour", v)} />
      </Row>
      <Row searchAnchor="settings.housesystem" label={t("settings.housesystem")}>
        <Toggle checked={d.housesystem} onChange={(v) => setBool("housesystem", v)} />
      </Row>
      <Row searchAnchor="settings.information" label={t("settings.information")}>
        <Toggle checked={d.information} onChange={(v) => setBool("information", v)} />
      </Row>
      <Row searchAnchor="settings.radixNameInCanvas" label={t("settings.radixNameInCanvas")}>
        <Toggle
          checked={d.showradixnameincanvas}
          onChange={(v) => setBool("showradixnameincanvas", v)}
        />
      </Row>
      <Row searchAnchor="settings.showSecondsInHeader" label={t("settings.showSecondsInHeader")}>
        <Toggle checked={d.showseconds} onChange={(v) => setBool("showseconds", v)} />
      </Row>
      <Row searchAnchor="settings.dateFormat" label={t("settings.dateFormat")}>
        <Select
          value={d.dateconvention}
          width={170}
          onChange={(v) => setStr("dateconvention", v)}
        >
          {cat.dateConventions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.dashboard.title">{t("settings.dashboard.title")}</SectionLabel>
      <p className="border-b border-border/40 py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/60">
        {t("settings.dashboard.description")}
      </p>
      <Row searchAnchor="settings.dashboard.aspectGrid" label={t("settings.dashboard.aspectGrid")}>
        <Toggle checked={d.dashboard_aspect_grid} onChange={(v) => setBool("dashboard_aspect_grid", v)} />
      </Row>
      <Row searchAnchor="settings.dashboard.aspectGridLarge" label={t("settings.dashboard.aspectGridLarge")}>
        <Toggle checked={d.dashboard_grid_large} disabled={!d.dashboard_aspect_grid} onChange={(v) => setBool("dashboard_grid_large", v)} />
      </Row>
      <Row searchAnchor="settings.dashboard.aspectGridOrbs" label={t("settings.dashboard.aspectGridOrbs")}>
        <Toggle
          checked={d.dashboard_grid_orbs}
          disabled={!d.dashboard_aspect_grid}
          onChange={(v) => setBool("dashboard_grid_orbs", v)}
        />
      </Row>
      <Row searchAnchor="settings.dashboard.aspectGridParallels" label={t("settings.dashboard.aspectGridParallels")}>
        <Toggle
          checked={d.dashboard_grid_parallels}
          disabled={!d.dashboard_aspect_grid}
          onChange={(v) => setBool("dashboard_grid_parallels", v)}
        />
      </Row>
      <Row searchAnchor="settings.dashboard.declination" label={t("settings.dashboard.declination")}>
        <Toggle checked={d.dashboard_declination} onChange={(v) => setBool("dashboard_declination", v)} />
      </Row>
      <Row searchAnchor="settings.dashboard.declinationHorizontal" label={t("settings.dashboard.declinationHorizontal")}>
        <Toggle
          checked={d.dashboard_declination_horizontal}
          disabled={!d.dashboard_declination}
          onChange={(v) => setBool("dashboard_declination_horizontal", v)}
        />
      </Row>
      <Row searchAnchor="settings.dashboard.declinationMirrored" label={t("settings.dashboard.declinationMirrored")}>
        <Toggle
          checked={d.dashboard_declination_mirrored}
          disabled={!d.dashboard_declination}
          onChange={(v) => setBool("dashboard_declination_mirrored", v)}
        />
      </Row>
      <Row searchAnchor="settings.dashboard.moon" label={t("settings.dashboard.moon")}>
        <Toggle checked={d.dashboard_moon} onChange={(v) => setBool("dashboard_moon", v)} />
      </Row>
      <Row searchAnchor="settings.dashboard.moonAllBodies" label={t("settings.dashboard.moonAllBodies")}>
        <Toggle
          checked={d.dashboard_moon_all_bodies}
          disabled={!d.dashboard_moon}
          onChange={(v) => setBool("dashboard_moon_all_bodies", v)}
        />
      </Row>

      <SectionLabel searchAnchor="section:settings.display">{t("settings.display")}</SectionLabel>
      {cat.fontProfiles.length > 0 ? (
        <Row searchAnchor="settings.typeface" label={t("settings.typeface")}>
          <Select
            value={d.fontfamily}
            width={160}
            onChange={(v) => setStr("fontfamily", v)}
          >
            {cat.fontProfiles.map((p) => (
              <option key={p.value} value={p.value}>
                {p.labelKey ? t(p.labelKey) : p.label}
              </option>
            ))}
          </Select>
        </Row>
      ) : null}
      <Row searchAnchor="settings.inspectorTextSize" label={t("settings.inspectorTextSize")}>
        <Select
          value={d.inspector_text_size ?? "normal"}
          width={160}
          onChange={(value) => setStr("inspector_text_size", value)}
        >
          <option value="normal">{t("inspector.textSize.normal")}</option>
          <option value="larger">{t("inspector.textSize.larger")}</option>
          <option value="extra-large">{t("inspector.textSize.extraLarge")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.showTradFixStarNamesPdLists" label={t("settings.showTradFixStarNamesPdLists")}>
        <Toggle
          checked={d.usetradfixstarnamespdlist}
          onChange={(v) => setBool("usetradfixstarnamespdlist", v)}
        />
      </Row>
      <Row searchAnchor="settings.showChartNavigationBar" label={t("settings.showChartNavigationBar")}>
        <Toggle checked={d.show_help_chip} onChange={(v) => setBool("show_help_chip", v)} />
      </Row>
      <Row searchAnchor="settings.shiftArrow" label={t("settings.shiftArrow")}>
        <Select
          value={d.synodicmode}
          width={150}
          onChange={(v) => setNum("synodicmode", Number(v))}
        >
          {cat.synodicModes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:aspectList.title">{t("aspectList.title")}</SectionLabel>
      <Row searchAnchor="settings.showAspectsForDerivedPoints" label={t("settings.showAspectsForDerivedPoints")}>
        <Toggle
          checked={aspectList.showAspectsForDerivedPoints}
          onChange={(v) => setAspectListPatch({ showAspectsForDerivedPoints: v })}
        />
      </Row>
      <Row searchAnchor="settings.aspectListPerfectionLinkDefault" label={t("settings.aspectListPerfectionLinkDefault")}>
        <Select
          value={aspectList.perfectionLinkMode}
          width={200}
          onChange={(value) =>
            setAspectListPatch({
              perfectionLinkMode: value as OptionsPayload["aspectList"]["perfectionLinkMode"],
            })
          }
        >
          <option value="transits">{t("dirview.openAsTransit")}</option>
          <option value="secondary">{t("aspectList.openAsSecondaryProgression")}</option>
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speculum — one chart-owned surface whose active coordinate family follows
// the current house system. The daemon owns the family and column schema; the
// inactive family's choices remain saved for a future house-system switch.
// ---------------------------------------------------------------------------

function SpeculumTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.speculum;
  const cat = opts.catalog;
  const activeFamily = s.activeFamily;
  const activeColumns = activeFamily === "regiomontan"
    ? cat.speculumRegiomontanCols
    : cat.speculumPlacidianCols;
  const activeDodec = activeFamily === "regiomontan"
    ? "regiomontanDodec"
    : "placidianDodec";
  const activeHouseSystem = opts.houseSystem.available.find(
    (item) => item.code === opts.houseSystem.hsys,
  );

  const setCol = (row: "placidian" | "regiomontan", idx: number, v: boolean) => {
    const nextRow = { ...s[row], [String(idx)]: v };
    sendPatch(
      { speculum: { [row]: nextRow } },
      { ...opts, speculum: { ...s, [row]: nextRow } },
    );
  };
  const setFlag = (attr: "placidianDodec" | "regiomontanDodec" | "intime", v: boolean) => {
    sendPatch({ speculum: { [attr]: v } }, { ...opts, speculum: { ...s, [attr]: v } });
  };
  const setSpeedMode = (speedMode: OptionsPayload["speculum"]["speedMode"]) => {
    sendPatch(
      { speculum: { speedMode } },
      { ...opts, speculum: { ...s, speedMode } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.display">{t("settings.display")}</SectionLabel>
      <Row searchAnchor="settings.speculumSpeedDisplay" label={t("settings.speculumSpeedDisplay")}>
        <Select
          value={s.speedMode}
          width={180}
          onChange={(value) => setSpeedMode(value as OptionsPayload["speculum"]["speedMode"])}
        >
          {cat.speculumSpeedModes.map((mode) => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel>{activeHouseSystem?.label ?? t("settings.speculum")}</SectionLabel>
      {activeColumns.map((c) => (
        <Row key={c.idx} label={c.label}>
          <Toggle
            checked={Boolean(s[activeFamily][String(c.idx)])}
            onChange={(v) => setCol(activeFamily, c.idx, v)}
          />
        </Row>
      ))}
      <Row searchAnchor="settings.dodecatemorion" label={t("settings.dodecatemorion")}>
        <Toggle checked={s[activeDodec]} onChange={(v) => setFlag(activeDodec, v)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.rectascension">{t("settings.rectascension")}</SectionLabel>
      <Row searchAnchor="settings.inTime" label={t("settings.inTime")}>
        <Toggle checked={s.intime} onChange={(v) => setFlag("intime", v)} />
      </Row>
    </div>
  );
}

/** Label and cited hint of each daemon moiety preset (engine.orb_policy.PRESETS). */
const ORB_PRESET_KEYS: Record<string, { label: string; hint: string }> = {
  lilly: { label: "settings.orbRuleLilly", hint: "settings.orbRuleLillyHint" },
  biruni: { label: "settings.orbRuleBiruni", hint: "settings.orbRuleBiruniHint" },
  leo: { label: "settings.orbRuleLeo", hint: "settings.orbRuleLeoHint" },
  morin: { label: "settings.orbRuleMorin", hint: "settings.orbRuleMorinHint" },
};

const WHOLE_ORB_FIELDS = new Set([
  "orbis", "orbisplanetspar", "orbisH", "orbisAscMC", "orbisparH", "orbisparAscMC",
  "orbiscuspH", "orbiscuspAscMC", "exact", "orbPolicy",
]);

/** Whether a queued orb write can absorb this one (latest value wins). */
function canCoalesceOrbPatch(last: OptionsPatch, patch: OptionsPatch): boolean {
  if (Object.keys(last).length !== 1 || Object.keys(patch).length !== 1 || !last.orbs || !patch.orbs) return false;
  const whole = (orbs: object) => Object.keys(orbs).every((key) => WHOLE_ORB_FIELDS.has(key));
  if (whole(last.orbs) && whole(patch.orbs)) return true;
  // Typing in one cell sends a value per keystroke; same cell, latest wins.
  const a = last.orbs.orbCell;
  const b = patch.orbs.orbCell;
  return Object.keys(last.orbs).length === 1 && Object.keys(patch.orbs).length === 1
    && !!a && !!b && a.row === b.row && a.aspect === b.aspect;
}

// ---------------------------------------------------------------------------
// Tab 5 — Orbs  (orbisdlg: target selector → 12 aspect orbs + par/contrapar)
// ---------------------------------------------------------------------------

function OrbsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const o = opts.orbs;
  const cat = opts.catalog;
  // Target: 0..10 = planets/Nodes (orbis rows), "A" = Asc/MC (orbisAscMC),
  // "H" = Houses (orbisH). Mirrors orbisdlg's per-target radio list.
  const [target, setTarget] = React.useState<string>("0");
  const [fixedStarName, setFixedStarName] = React.useState<string>(o.fixstarsOrbs?.[0]?.name ?? "");
  const isHouses = target === "H";
  const isAscMC = target === "A";
  const ti = Number(target);
  const fixedStarRows = o.fixstarsOrbs ?? [];
  const selectedFixedStar = fixedStarRows.find((row) => row.name === fixedStarName) ?? fixedStarRows[0];
  const fixedStarMode = o.fixstarsOrbMode ?? "individual";

  const preset = o.orbPresets?.includes(o.orbPolicy ?? "") ? o.orbPolicy : undefined;
  // Every body cell is editable; an edit sits on the selected base and can be
  // reset to it, cell by cell or all at once.
  const edited = (aspectIdx: number) =>
    !isHouses && !isAscMC && !!o.orbEdited?.some(([row, aspect]) => row === ti && aspect === aspectIdx);
  const aspectVals = isHouses ? o.orbisH : isAscMC ? o.orbisAscMC
    : (o.effectiveOrbis?.[ti] ?? o.orbis[ti] ?? []);
  const parVals = isHouses ? o.orbisparH : isAscMC ? o.orbisparAscMC : (o.orbisplanetspar[ti] ?? []);

  const setAspect = (aspectIdx: number, n: number) => {
    if (isHouses) {
      const next = [...o.orbisH];
      next[aspectIdx] = n;
      sendPatch({ orbs: { orbisH: next } }, { ...opts, orbs: { ...o, orbisH: next } });
    } else if (isAscMC) {
      const next = [...o.orbisAscMC];
      next[aspectIdx] = n;
      sendPatch({ orbs: { orbisAscMC: next } }, { ...opts, orbs: { ...o, orbisAscMC: next } });
    } else {
      const effectiveOrbis = (o.effectiveOrbis ?? o.orbis).map((row) => [...row]);
      effectiveOrbis[ti][aspectIdx] = n;
      const orbEdited: [number, number][] = [
        ...(o.orbEdited ?? []).filter(([row, aspect]) => row !== ti || aspect !== aspectIdx),
        [ti, aspectIdx],
      ];
      sendPatch(
        { orbs: { orbCell: { row: ti, aspect: aspectIdx, value: n } } },
        { ...opts, orbs: { ...o, effectiveOrbis, orbEdited } },
      );
    }
  };
  const resetAspect = (aspectIdx: number) =>
    sendPatch({ orbs: { orbCellReset: { row: ti, aspect: aspectIdx } } }, opts);
  const setPar = (col: 0 | 1, n: number) => {
    if (isHouses) {
      const next = [...o.orbisparH];
      next[col] = n;
      sendPatch({ orbs: { orbisparH: next } }, { ...opts, orbs: { ...o, orbisparH: next } });
    } else if (isAscMC) {
      const next = [...o.orbisparAscMC];
      next[col] = n;
      sendPatch({ orbs: { orbisparAscMC: next } }, { ...opts, orbs: { ...o, orbisparAscMC: next } });
    } else {
      const next = o.orbisplanetspar.map((row) => [...row]);
      next[ti][col] = n;
      sendPatch({ orbs: { orbisplanetspar: next } }, { ...opts, orbs: { ...o, orbisplanetspar: next } });
    }
  };
  const setScalar = (attr: "orbiscuspH" | "orbiscuspAscMC" | "exact", n: number) => {
    sendPatch({ orbs: { [attr]: n } }, { ...opts, orbs: { ...o, [attr]: n } });
  };
  const setFixedStarOrb = (name: string, n: number) => {
    const nextRows = fixedStarRows.map((row) => (row.name === name ? { ...row, orb: n } : row));
    sendPatch(
      { orbs: { fixstarsOrb: { name, orb: n } } },
      { ...opts, orbs: { ...o, fixstarsOrbMode: "individual", fixstarsOrbs: nextRows } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <Row searchAnchor="settings.orbRule" label={t("settings.orbRule")}>
        <Select
          value={o.orbPolicy ?? "custom"}
          width={180}
          onChange={(orbPolicy) => sendPatch({ orbs: { orbPolicy } }, { ...opts, orbs: { ...o, orbPolicy } })}
        >
          <option value="custom">{t("settings.orbRuleDefault")}</option>
          {(o.orbPresets ?? []).map((id) => (
            <option key={id} value={id}>{t(ORB_PRESET_KEYS[id]?.label ?? "settings.orbRuleDefault")}</option>
          ))}
        </Select>
      </Row>
      <p className="border-b border-border/40 py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/60">
        {t((preset && ORB_PRESET_KEYS[preset]?.hint) || "settings.orbRuleCustomHint")}
      </p>
      {o.orbEdited?.length ? (
        <Row label="">
          <Button type="button" variant="outline" size="sm" onClick={() => sendPatch({ orbs: { orbResetAll: true } }, opts)}>
            {t("settings.orbResetAll")}
          </Button>
        </Row>
      ) : null}

      <SectionLabel searchAnchor="section:settings.target">{t("settings.target")}</SectionLabel>
      <Row searchAnchor="settings.bodyPoint" label={t("settings.bodyPoint")}>
        <Select value={target} width={150} onChange={setTarget}>
          {cat.orbTargets.map((opt) => (
            <option key={opt.value} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
          <option value="A">{t("settings.ascMc")}</option>
          <option value="H">{t("settings.houses")}</option>
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.aspectOrbsDegrees">{t("settings.aspectOrbsDegrees")}</SectionLabel>
      {cat.aspectLabels.map((label, i) => (
        <Row
          key={label}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={cat.aspectGlyphs[i] ?? ""} />
              {label}
            </span>
          }
        >
          {edited(i) ? (
            <button
              type="button"
              className="mr-[var(--aries-control-gap-compact)] text-foreground/45 hover:text-foreground"
              aria-label={t("settings.orbResetCell")}
              title={t("settings.orbResetCell")}
              onClick={() => resetAspect(i)}
            >
              <RotateCcw className="size-3" aria-hidden />
            </button>
          ) : null}
          <NumberField value={aspectVals[i] ?? 0} step={0.5} onCommit={(n) => setAspect(i, n)} />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.declination">{t("settings.declination")}</SectionLabel>
      <Row searchAnchor="settings.parallel" label={t("settings.parallel")}>
        <NumberField value={parVals[0] ?? 0} step={0.5} onCommit={(n) => setPar(0, n)} />
      </Row>
      <Row searchAnchor="settings.contraparallel" label={t("settings.contraparallel")}>
        <NumberField value={parVals[1] ?? 0} step={0.5} onCommit={(n) => setPar(1, n)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.cuspsExactness">{t("settings.cuspsExactness")}</SectionLabel>
      <Row searchAnchor="settings.ascMcCuspOrb" label={t("settings.ascMcCuspOrb")}>
        <NumberField value={o.orbiscuspAscMC} step={0.5} onCommit={(n) => setScalar("orbiscuspAscMC", n)} />
      </Row>
      <Row searchAnchor="settings.intermediateCuspOrb" label={t("settings.intermediateCuspOrb")}>
        <NumberField value={o.orbiscuspH} step={0.5} onCommit={(n) => setScalar("orbiscuspH", n)} />
      </Row>
      <Row searchAnchor="settings.exactOrb" label={t("settings.exactOrb")}>
        <NumberField value={o.exact} step={0.5} onCommit={(n) => setScalar("exact", n)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.fixedStars">{t("settings.fixedStars")}</SectionLabel>
      <Row searchAnchor="settings.fixedStarOrbRule" label={t("settings.fixedStarOrbRule")}>
        <Select value={fixedStarMode} width={250}
          ariaLabel={t("settings.fixedStarOrbRule")}
          onChange={(value) => sendPatch({ orbs: {
            fixstarsOrbMode: value as NonNullable<typeof o.fixstarsOrbMode>,
          } }, opts)}>
          <option value="uniform">{t("settings.fixedStarOrbUniform")}</option>
          <option value="traditional">{t("settings.fixedStarOrbTraditional")}</option>
          <option value="individual">{t("settings.fixedStarOrbIndividual")}</option>
        </Select>
      </Row>
      {fixedStarMode === "uniform" ? (
        <Row searchAnchor="settings.conjunctionOrbAllStars" label={t("settings.conjunctionOrbAllStars")}>
          <NumberField value={o.fixstarsOrbAll} step={0.5} min={0} max={o.fixstarsOrbMax ?? 10}
            onCommit={(n) => sendPatch({ orbs: { fixstarsOrbAll: n } }, {
              ...opts, orbs: { ...o, fixstarsOrbAll: n,
                fixstarsOrbs: fixedStarRows.map((row) => ({ ...row, orb: n })),
              },
            })} />
        </Row>
      ) : selectedFixedStar ? (
        <>
          {fixedStarMode === "traditional" ? (
            <Row searchAnchor="settings.fixedStarMagnitudeScale" label={t("settings.fixedStarMagnitudeScale")}>
              <span className="text-foreground/70 tabular-nums">
                {(o.fixstarsOrbScale ?? []).map((entry) => `${entry.magnitude}: ${entry.orb}°`).join(" · ")}
              </span>
            </Row>
          ) : null}
          <Row searchAnchor="settings.selectedStar" label={t("settings.selectedStar")}>
            <Select value={selectedFixedStar.name} width={250} ariaLabel={t("settings.selectedStar")}
              onChange={setFixedStarName}>
              {fixedStarRows.map((row) => (
                <option key={row.name} value={row.name}>
                  {fixedStarMode === "traditional" && row.magnitude != null
                    ? t("settings.fixedStarMagnitudeName", { name: row.displayName ?? row.name, magnitude: row.magnitude })
                    : row.displayName ?? row.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row searchAnchor="settings.selectedStarOrb" label={t("settings.selectedStarOrb")}>
            <NumberField
              value={selectedFixedStar.orb}
              step={0.5}
              min={0}
              max={o.fixstarsOrbMax ?? 10}
              onCommit={(n) => setFixedStarOrb(selectedFixedStar.name, n)}
            />
          </Row>
          {fixedStarMode === "traditional" && (selectedFixedStar.magnitude == null || selectedFixedStar.magnitude > 4) ? (
            <p className="py-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] text-foreground/60">
              {t("settings.fixedStarOrbFallback")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Dignities  (scalar fields the backend exposes; matrix is passthrough)
// ---------------------------------------------------------------------------

// Morinus sign glyphs in zodiac order (Aries..Pisces) — header chars for the
// dignity/term grids. The Morinus font maps these letters to the sign glyphs
// (common.py Signs1 'a'..'l'); mirrored here as column-header decoration only.
const SIGN_GLYPH_CHARS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

function DignitiesTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const setScore = (i: number, n: number) => {
    const next = [...g.dignityscores];
    next[i] = Math.round(n);
    sendPatch({ dignities: { dignityscores: next } }, { ...opts, dignities: { ...g, dignityscores: next } });
  };

  // Active term-set selector (selterm). Choices come from catalog.termSets
  // (Egyptian/Ptolemaic); the daemon reads/applies selterm already.
  const setTermSet = (value: number) => {
    sendPatch({ dignities: { selterm: value } }, { ...opts, dignities: { ...g, selterm: value } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.dignityScores">{t("settings.dignityScores")}</SectionLabel>
      {cat.dignityScoreLabels.map((label, i) => (
        <Row key={label} label={label}>
          <NumberField value={g.dignityscores[i] ?? 0} step={1} onCommit={(n) => setScore(i, n)} />
        </Row>
      ))}

      <DignityGridEditor opts={opts} sendPatch={sendPatch} />

      {cat.termSets.length > 0 ? (
        <>
          <SectionLabel searchAnchor="section:settings.termSet">{t("settings.termSet")}</SectionLabel>
          <Row searchAnchor="settings.activeTerms" label={t("settings.activeTerms")}>
            <Select value={g.selterm} width={140} onChange={(v) => setTermSet(Number(v))}>
              {cat.termSets.map((ts) => (
                <option key={ts.value} value={ts.value}>
                  {ts.label}
                </option>
              ))}
            </Select>
          </Row>
        </>
      ) : null}

      <TermsGridEditor opts={opts} sendPatch={sendPatch} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Essential-dignities grid editor (DignitiesDlg, dignitiesdlg.py). The wx dialog
// picks one planet + Domicile/Exaltatio at a time and shows 12 sign checkboxes;
// the native idiom shows the whole grid. Cell = options.dignities[planet][type]
// [sign] (bool). The full grid is sent back whole; the daemon setattrs it and
// recalcs (almutens/dignity tables re-read options.dignities). Planets = the 10
// the wx check() loop edits (Sun..Pluto); nodes are excluded by design.
// ---------------------------------------------------------------------------
function DignityGridEditor({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const grid = g.dignities;
  const planets = cat.dignityPlanets;
  const types = cat.dignityTypes;
  if (!Array.isArray(grid) || grid.length === 0 || planets.length === 0) return null;

  const toggle = (pl: number, ty: number, sign: number) => {
    // Deep-clone only the touched planet/type row, structural-share the rest.
    const next: boolean[][][] = grid.map((p, pi) =>
      pi === pl ? p.map((typeRow, ti) => (ti === ty ? typeRow.map((v, si) => (si === sign ? !v : v)) : typeRow)) : p,
    );
    sendPatch({ dignities: { dignities: next } }, { ...opts, dignities: { ...g, dignities: next } });
  };

  return (
    <>
      <SectionLabel searchAnchor="section:settings.essentialDignities">{t("settings.essentialDignities")}</SectionLabel>
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-0 text-[length:var(--aries-font-size-small)]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-popover px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-left font-normal text-foreground/55" />
              {SIGN_GLYPH_CHARS.map((ch, si) => (
                <th key={si} className="px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-center font-normal text-foreground/55">
                  <Glyph ch={ch} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {planets.map((plName, pi) =>
              types.map((tyName, ti) => (
                <tr key={`${pi}-${ti}`}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-popover px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-foreground/70">
                    {plName}
                    <span className="ml-1 text-foreground/40">{ti === 0 ? t("settings.domicileAbbr") : t("settings.exaltationAbbr")}</span>
                  </td>
                  {SIGN_GLYPH_CHARS.map((_, si) => (
                    <td key={si} className="px-[var(--aries-table-cell-x-standard)] py-[var(--aries-segmented-control-padding)] text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(grid[pi]?.[ti]?.[si])}
                        onChange={() => toggle(pi, ti, si)}
                        className="h-3 w-3 cursor-pointer accent-foreground/70"
                        aria-label={`${plName} ${tyName} ${si}`}
                      />
                    </td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Terms / bounds grid editor (TermsDlg, termsdlg.py). Edits the ACTIVE term-set
// (selterm) only — options.terms[selterm][sign][position] = [planetCode, deg].
// The wx dialog validates before OK (each sign's 5 rulers unique, degree spans
// sum to 30 — termsdlg.py:_terms_layout_valid/onOK); that validation is skin
// logic, so we run it client-side and only patch a sign row when it is valid.
// The full terms grid (both sets) is sent back whole; the daemon setattrs it.
// ---------------------------------------------------------------------------
const SIGN_DEG_TOTAL = 30;

function termSignValid(positions: [number, number][]): boolean {
  const seen = new Set<number>();
  let sum = 0;
  for (const [pl, deg] of positions) {
    if (seen.has(pl)) return false; // duplicate ruler in this sign
    seen.add(pl);
    sum += deg;
  }
  return sum === SIGN_DEG_TOTAL;
}

function TermsGridEditor({ opts, sendPatch }: TabProps) {
  const t = useT();
  const g = opts.dignities;
  const cat = opts.catalog;
  const allSets = g.terms;
  const planetChoices = cat.termPlanets;
  const signLabels = cat.zodiacSigns;
  if (!Array.isArray(allSets) || allSets.length === 0 || planetChoices.length === 0) return null;

  const setIdx = g.selterm >= 0 && g.selterm < allSets.length ? g.selterm : 0;
  const signs = allSets[setIdx];
  if (!Array.isArray(signs)) return null;

  // Patch one cell field (planet code or degrees) of the active set. Validates
  // the affected sign row; an invalid row (dup ruler / spans != 30) is held in
  // local edit state and not sent until it becomes valid.
  const writeCell = (sign: number, pos: number, field: 0 | 1, value: number) => {
    const nextSet: [number, number][][] = signs.map((row, ri) =>
      ri === sign
        ? row.map((pair, pj) =>
            pj === pos
              ? ((field === 0 ? [value, pair[1]] : [pair[0], value]) as [number, number])
              : pair,
          )
        : row,
    );
    if (!termSignValid(nextSet[sign])) return false;
    const nextAll: [number, number][][][] = allSets.map((s, si) => (si === setIdx ? nextSet : s));
    sendPatch({ dignities: { terms: nextAll } }, { ...opts, dignities: { ...g, terms: nextAll } });
    return true;
  };

  return (
    <>
      <SectionLabel searchAnchor="section:settings.termsBoundsActiveSet">{t("settings.termsBoundsActiveSet")}</SectionLabel>
      <div className="overflow-x-auto pb-1 text-[length:var(--aries-font-size-small)]">
        <table className="border-separate border-spacing-x-1 border-spacing-y-0.5">
          <tbody>
            {signs.map((row, si) => {
              const valid = termSignValid(row);
              return (
                <tr key={si}>
                  <td className="whitespace-nowrap px-[var(--aries-table-cell-x-standard)] text-foreground/70">
                    <Glyph ch={SIGN_GLYPH_CHARS[si]} />
                    <span className="ml-1 text-foreground/55">{signLabels[si]}</span>
                  </td>
                  {row.map(([plCode, deg], pos) => (
                    <td key={pos} className="px-0.5">
                      <span className="flex items-center gap-0.5">
                        <TermPlanetSelect
                          value={plCode}
                          choices={planetChoices}
                          onChange={(v) => writeCell(si, pos, 0, v)}
                        />
                        <TermDegInput value={deg} onCommit={(n) => writeCell(si, pos, 1, n)} />
                      </span>
                    </td>
                  ))}
                  <td className="px-[var(--aries-table-cell-x-standard)] text-right tabular-nums text-foreground/40">
                    {valid ? "" : `∑ ${row.reduce((a, [, d]) => a + d, 0)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-[var(--aries-table-cell-x-standard)] pb-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-section)] text-foreground/40">
        {t("settings.termsBoundsHelp")}
      </p>
    </>
  );
}

function TermPlanetSelect({
  value,
  choices,
  onChange,
}: {
  value: number;
  choices: { value: number; label: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <select
      data-aries-control-appearance="local"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] outline-none focus:border-border"
    >
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label.slice(0, 3)}
        </option>
      ))}
    </select>
  );
}

function TermDegInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  return (
    <input
      data-aries-control-appearance="local"
      key={value}
      type="number"
      min={0}
      max={30}
      step={1}
      defaultValue={value}
      onBlur={(e) => {
        let n = Math.round(Number(e.target.value));
        if (!Number.isFinite(n)) {
          e.target.value = String(value);
          return;
        }
        n = Math.max(0, Math.min(30, n));
        if (n !== value) onCommit(n);
        else e.target.value = String(value);
      }}
      className="h-[var(--aries-control-height-micro)] w-[34px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-right text-[length:var(--aries-font-size-small)] tabular-nums outline-none focus:border-border"
    />
  );
}

// ---------------------------------------------------------------------------
// Symbols  (symbolsdlg.SymbolsDlg) — appearance glyph-variant choices. The daemon owns
// WHICH variants exist and the Morinus glyph char for each (catalog.symbol*);
// this section renders a radio row per option and patches the chosen value. The
// chart snapshot already resolves the picked glyph (common.common.update is
// re-run daemon-side on apply), so the wheel reflects the choice on re-render.
// ---------------------------------------------------------------------------

/** A horizontal row of glyph-variant choices; the selected one is highlighted.
 * Each choice renders its Morinus glyph (font-family Morinus). */
function GlyphChoiceRow<V extends boolean | number>({
  choices,
  current,
  onPick,
}: {
  choices: { value: V; glyph: string }[];
  current: V;
  onPick: (v: V) => void;
}) {
  return (
    <span className="flex items-center gap-[var(--aries-control-gap)]">
      {choices.map((c) => (
        <button
          key={String(c.value)}
          type="button"
          onClick={() => onPick(c.value)}
          aria-pressed={current === c.value}
          className={
            "font-symbols flex h-[var(--aries-control-height-small)] w-[var(--aries-control-height-small)] items-center justify-center rounded-[var(--aries-radius-menu-item)] border border-transparent text-[length:var(--aries-font-size-large)] hover:bg-accent hover:text-accent-foreground " +
            (current === c.value
              ? "bg-accent text-accent-foreground"
              : "text-foreground/70")
          }
        >
          {c.glyph}
        </button>
      ))}
    </span>
  );
}

function SymbolsSection({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.symbols;
  const cat = opts.catalog;
  const setSymbol = <K extends keyof OptionsSymbols>(attr: K, value: OptionsSymbols[K]) => {
    sendPatch({ symbols: { [attr]: value } }, { ...opts, symbols: { ...s, [attr]: value } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.glyphVariants">{t("settings.glyphVariants")}</SectionLabel>
      <Row searchAnchor="settings.uranus" label={t("settings.uranus")}>
        <GlyphChoiceRow
          choices={cat.symbolUranus as { value: boolean; glyph: string }[]}
          current={s.uranus}
          onPick={(v) => setSymbol("uranus", v)}
        />
      </Row>
      <Row searchAnchor="settings.pluto" label={t("settings.pluto")}>
        <GlyphChoiceRow
          choices={cat.symbolPluto as { value: number; glyph: string }[]}
          current={s.pluto}
          onPick={(v) => setSymbol("pluto", v)}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Default Location  (defaultlocdlg.DefaultLocDlg). The saved
// "Here-and-Now" place. The daemon owns WHICH def* fields exist + their
// labels/control kinds (catalog.defaultLocationFields); this tab renders generic
// controls from that list (the same "stupid skin" pattern as the other tabs).
// The ONE custom control is the place search: it reuses the chart editor's
// resolve-place flow (daemon-form-shaped candidates) and, on pick, patches the
// matching def* fields in a single grouped patch. Manual field edits patch one
// def* field each. Persistence + Here-and-Now reconstruction are daemon-side.
// ---------------------------------------------------------------------------

/** A segmented choice between a few short labelled values. */
function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <span className="flex overflow-hidden rounded-[var(--aries-radius-control-compact)] border border-border/60 text-[length:var(--aries-font-size-base)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            "whitespace-nowrap px-[var(--aries-control-padding-x)] py-[var(--aries-segmented-control-padding)] text-center " +
            (value === o.value ? "bg-foreground/80 text-background" : "text-foreground/70")
          }
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Uncontrolled text field committed on blur, keyed by value so a server-driven
 * change remounts with the fresh value (same trick as NumberField). */
function TextField({
  value,
  width = 120,
  onCommit,
}: {
  value: string;
  width?: number;
  onCommit: (s: string) => void;
}) {
  return (
    <input
      data-aries-control-appearance="local"
      key={value}
      type="text"
      defaultValue={value}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      style={{ width }}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
    />
  );
}

/**
 * Default-location map picker — a modal sheet over the Settings dialog that
 * hosts the SAME Res/astrocart/map.html surface wx opens from the Default
 * Location dialog's "Map" button (morin._open_astrocart_from_chart_editor with
 * context='default_location', morin.py:16466). The map is launched in
 * `default_location` context (window.ACG.setContext('default_location') via the
 * aries.setContext postMessage bridge, map.html:2551) so the right-click menu
 * surfaces ONLY "Set default location" — the chart-bound items (relocation / SR
 * / transit / set place of birth) are hidden by map.html's data-mode CSS gating
 * (map.html:328-331).
 *
 * No ACG line data is fetched: in the settings flow there is no chart, just a
 * globe to search or click. Choosing a search result posts its exact pin as a
 * `place-selection`, which the dialog commits with OK. The existing right-click
 * "Set default location" action remains available and uses the same daemon
 * pipeline (setDefaultLocationFromMap -> morin._astrocart_set_default_location
 * parity), which resolves the place name + timezone, persists the defloc* group,
 * and broadcasts options.changed.
 */
function DefaultLocationMapSheet({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (group: OptionsDefaultLocation) => void;
}) {
  const t = useT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const applyControllerRef = React.useRef<AbortController | null>(null);
  const [readyUrl, setReadyUrl] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<{
    lon: number;
    lat: number;
    placeName: string;
  } | null>(null);
  const [applying, setApplying] = React.useState(false);
  const theme = useThemeStore((s) => s.theme);
  const bootTheme = theme?.mode === "light" ? "light" : "dark";
  const bootPageBg = theme?.chartPalette["--aries-astrocart-map-page-bg"]
    ?? (bootTheme === "light" ? "#d9dde1" : "#1a1d21");
  // Same stable map.html contract as AstrocartSurface: bundled viewport city
  // labels online/offline, with theme changes pushed live instead of reloading.
  const [mapBootOptions] = React.useState(() => ({
    theme: bootTheme,
    pageBg: bootPageBg,
    places: "auto",
  } as const));
  const url = useAstrocartMapUrl(mapBootOptions);
  const ready = !!url && readyUrl === url;

  const applySelection = React.useCallback((next: {
    lon: number;
    lat: number;
    placeName: string;
  }) => {
    if (applyControllerRef.current) return;
    const controller = new AbortController();
    applyControllerRef.current = controller;
    setApplying(true);
    void setDefaultLocationFromMap(next.lon, next.lat, next.placeName, controller.signal)
      .then((res) => {
        if (controller.signal.aborted || applyControllerRef.current !== controller) return;
        applyControllerRef.current = null;
        setApplying(false);
        onApplied(res.defaultLocation);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        applyControllerRef.current = null;
        setApplying(false);
        console.error("[defloc-map]", err);
      });
  }, [onApplied]);

  React.useEffect(() => () => applyControllerRef.current?.abort(), []);

  // Once the iframe is loaded, flip the right-click menu to default_location
  // mode (only "Set default location" shows). map.html's setContext is the wx
  // twin of window.ACG.setContext (map.html:2517).
  React.useEffect(() => {
    if (!open || !ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "aries.setContext", mode: "default_location" }, "*");
    if (bootTheme) {
      win.postMessage({ type: "aries.setTheme", theme: bootTheme, pageBg: bootPageBg }, "*");
    }
  }, [open, ready, bootTheme, bootPageBg]);

  React.useEffect(() => {
    if (!open || !ready) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const controller = new AbortController();
    void daemonFetch(`${daemonBaseUrl()}/api/astrocart/style`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`astrocart style fetch failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted || iframeRef.current?.contentWindow !== win) return;
        win.postMessage(createAstrocartStyleMessage(payload, { fontUi: appUiFontStack() }), "*");
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("[defloc-map-style]", err);
      });
    return () => controller.abort();
  }, [open, ready, theme?.styleHash, theme?.styleRevision]);

  // Listen for search-pin selection and the existing right-click intent from
  // THIS iframe only. Both commit through the same daemon-owned pipeline.
  React.useEffect(() => {
    if (!open) return;
    function onMessage(event: MessageEvent) {
      const win = iframeRef.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as
        | { source?: string; payload?: { type?: string; action?: string; lon?: number; lat?: number; placeName?: string } }
        | undefined;
      if (!data || data.source !== "aries-acg") return;
      const payload = data.payload;
      if (!payload) return;
      if (typeof payload.lon !== "number" || typeof payload.lat !== "number") return;
      const next = {
        lon: payload.lon,
        lat: payload.lat,
        placeName: payload.placeName ?? "",
      };
      if (payload.type === "place-selection") {
        setSelection(next);
        return;
      }
      if (payload.type === "here" && payload.action === "set_default_loc") {
        applySelection(next);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applySelection, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) applyControllerRef.current?.abort();
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" motion="none" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-[var(--aries-dialog-padding)] pb-2.5 pt-3">
          <DialogTitle className="text-[length:var(--aries-font-size-reading)] font-medium tracking-tight">
            {t("settings.pickDefaultLocation")}
          </DialogTitle>
          <p className="text-[length:var(--aries-font-size-small)] text-foreground/50">
            {t("settings.defaultLocationMapHint")}
          </p>
        </DialogHeader>
        <div className="relative h-[60vh] w-full bg-background">
          {open && url ? (
            <iframe
              key={url}
              ref={iframeRef}
              src={url}
              title={t("settings.defaultLocationMap")}
              className="h-full w-full border-0 bg-background"
              onLoad={() => setReadyUrl(url)}
            />
          ) : null}
        </div>
        <div className="flex h-11 items-center gap-[var(--aries-dialog-footer-gap)] border-t border-border/40 bg-muted/20 px-[var(--aries-dialog-padding)]">
          <span className="min-w-0 flex-1 truncate text-[length:var(--aries-font-size-small)] text-foreground/55">
            {selection
              ? selection.placeName || `${selection.lat.toFixed(4)}°, ${selection.lon.toFixed(4)}°`
              : ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="min-w-[var(--aries-dialog-map-action-min-width)] rounded-[var(--aries-radius-control-compact)] border-border/60 bg-transparent px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-base)] font-normal text-foreground/75 hover:bg-transparent hover:text-foreground dark:border-border/60 dark:bg-transparent dark:hover:bg-transparent"
          >
            {t("settings.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selection || applying}
            onClick={() => {
              if (selection) applySelection(selection);
            }}
            className="min-w-[var(--aries-dialog-map-action-min-width)] rounded-[var(--aries-radius-control-compact)] border-0 px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-base)] font-normal hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
          >
            {t("picker.ok")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DefaultLocationTab({
  opts,
  sendPatch,
  onDefaultLocationApplied,
}: TabProps & {
  onDefaultLocationApplied: (group: OptionsDefaultLocation) => void;
}) {
  const t = useT();
  const loc = opts.defaultLocation;
  const r = opts.revolutions;
  const altitudeLabel = opts.catalog.defaultLocationFields.find((f) => f.attr === "deflocalt")?.label;
  const [mapOpen, setMapOpen] = React.useState(false);
  // The search bar shows the saved place name and follows it whenever the
  // default location changes (search pick, map pick, coordinate edit).
  const [placeQuery, setPlaceQuery] = React.useState(loc.deflocname);
  const [shownName, setShownName] = React.useState(loc.deflocname);
  if (shownName !== loc.deflocname) {
    setShownName(loc.deflocname);
    setPlaceQuery(loc.deflocname);
  }
  const exactLongitude = loc.defloclon ?? (
    (loc.defloceast ? 1 : -1) * (loc.defloclondeg + loc.defloclonmin / 60)
  );
  const exactLatitude = loc.defloclat ?? (
    (loc.deflocnorth ? 1 : -1) * (loc.defloclatdeg + loc.defloclatmin / 60)
  );

  // Picking a resolved place fills the def* fields in ONE grouped patch — the
  // candidate is already form-shaped by the daemon (resolve-place), so map its
  // fields straight onto the def* keys (name, deg/min + E/W·N/S, altitude, GMT
  // offset, tzid).
  const applyPlace = (c: PlaceCandidate) => {
    const patch: Partial<OptionsDefaultLocation> = {
      deflocname: c.name,
      defloclondeg: c.lonDeg,
      defloclonmin: c.lonMin,
      defloclon: c.lon,
      defloceast: c.east,
      defloclatdeg: c.latDeg,
      defloclatmin: c.latMin,
      defloclat: c.lat,
      deflocnorth: c.north,
      deflocalt: c.altitude,
      deflocplus: c.plus,
      defloczhour: c.zoneHour,
      defloczminute: c.zoneMin,
      defloctzid: c.tzid,
    };
    sendPatch(
      { defaultLocation: patch },
      { ...opts, defaultLocation: { ...loc, ...patch } },
    );
  };

  // Typed coordinates go through the map-pick write: the daemon names the
  // place and resolves its time zone, so manual entry never needs zone fields.
  const coordinateController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => coordinateController.current?.abort(), []);
  const applyCoordinates = (lon: number, lat: number) => {
    coordinateController.current?.abort();
    const controller = new AbortController();
    coordinateController.current = controller;
    void setDefaultLocationFromMap(lon, lat, "", controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) onDefaultLocationApplied(res.defaultLocation);
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("[defloc-coordinates]", err);
      });
  };

  const setLocationMode = (
    attr: "revolutions_solarlocationmode" | "revolutions_lunarlocationmode" | "revolutions_planetslocationmode",
    ask: boolean,
  ) => {
    const value = ask ? 1 : 0;
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };
  const supplementaryLocation = opts.quickCharts.supplementary_location;

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center gap-[var(--aries-control-gap)]">
        <PlaceSearchField
          value={placeQuery}
          onValueChange={setPlaceQuery}
          onPick={applyPlace}
          bias={{ lat: exactLatitude, lon: exactLongitude, zoom: 9 }}
          placeholder={t("placeSearch.placeholder")}
          ariaLabel={t("placeSearch.placeholder")}
          inputClassName="h-[var(--aries-control-height-compact)] w-full rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
        />
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="h-[var(--aries-control-height-compact)] shrink-0 rounded-[var(--aries-radius-control-compact)] border border-border/60 px-[var(--aries-control-padding-x)] text-[length:var(--aries-font-size-base)] text-foreground/80 hover:border-border hover:text-foreground"
        >
          {t("settings.pickOnMap")}
        </button>
      </div>
      {loc.defloctzid ? (
        <p className="pt-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-foreground/50">
          {loc.defloctzid}
        </p>
      ) : null}
      {mapOpen ? (
        <DefaultLocationMapSheet
          open={mapOpen}
          onOpenChange={setMapOpen}
          onApplied={(group) => {
            onDefaultLocationApplied(group);
            setMapOpen(false);
          }}
        />
      ) : null}

      <SectionLabel searchAnchor="section:settings.supplementaryCharts">{t("settings.supplementaryCharts")}</SectionLabel>
      <Row searchAnchor="settings.castAt" label={t("settings.castAt")}>
        <SegmentedChoice
          value={supplementaryLocation}
          options={[
            { value: "radix", label: t("settings.natalPlace") },
            { value: "default", label: t("settings.tabDefaultLocation") },
          ]}
          onChange={(next) => {
            sendPatch(
              { quickCharts: { supplementary_location: next } },
              { ...opts, quickCharts: { ...opts.quickCharts, supplementary_location: next } },
            );
          }}
        />
      </Row>
      <Row searchAnchor="settings.askPlaceSolarReturn" label={t("settings.askPlaceSolarReturn")}>
        <Toggle checked={r.revolutions_solarlocationmode === 1} onChange={(v) => setLocationMode("revolutions_solarlocationmode", v)} />
      </Row>
      <Row searchAnchor="settings.askPlaceLunarReturn" label={t("settings.askPlaceLunarReturn")}>
        <Toggle checked={r.revolutions_lunarlocationmode === 1} onChange={(v) => setLocationMode("revolutions_lunarlocationmode", v)} />
      </Row>
      <Row searchAnchor="settings.askPlacePlanetaryReturn" label={t("settings.askPlacePlanetaryReturn")}>
        <Toggle checked={r.revolutions_planetslocationmode === 1} onChange={(v) => setLocationMode("revolutions_planetslocationmode", v)} />
      </Row>

      <SectionLabel searchAnchor="section:settings.manualEntry">{t("settings.manualEntry")}</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(calc(var(--aries-control-height-small)*6),1fr))] gap-x-[var(--aries-section-gap)]">
        <GridRow searchAnchor="common.latitude" label={t("common.latitude")}>
          <TextField
            value={formatCoordinate(exactLatitude, "lat")}
            width={110}
            onCommit={(s) => {
              const lat = parseCoordinate(s, "lat");
              if (lat !== null) applyCoordinates(exactLongitude, lat);
            }}
          />
        </GridRow>
        <GridRow searchAnchor="common.longitude" label={t("common.longitude")}>
          <TextField
            value={formatCoordinate(exactLongitude, "lon")}
            width={110}
            onCommit={(s) => {
              const lon = parseCoordinate(s, "lon");
              if (lon !== null) applyCoordinates(lon, exactLatitude);
            }}
          />
        </GridRow>
        {altitudeLabel ? (
          <GridRow label={altitudeLabel}>
            <NumberField
              value={loc.deflocalt}
              step={1}
              onCommit={(n) => {
                const deflocalt = Number.isFinite(n) ? Math.trunc(n) : 0;
                sendPatch(
                  { defaultLocation: { deflocalt } },
                  { ...opts, defaultLocation: { ...loc, deflocalt } },
                );
              }}
            />
          </GridRow>
        ) : null}
      </div>
    </div>
  );
}

/** A settings row inside a wrapping grid; every cell keeps its own rule. */
function GridRow({ label, children, searchAnchor }: { label: React.ReactNode; children: React.ReactNode; searchAnchor?: string }) {
  return (
    <div data-settings-search-anchor={searchAnchor} className="flex h-[var(--aries-control-height-small)] min-w-0 items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40">
      <span className="truncate text-[length:var(--aries-font-size-base)] text-foreground/80">{label}</span>
      <span className="flex shrink-0 items-center">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 10 — Revolutions (revolutionsoptdlg.RevolutionsOptDlg)
// ---------------------------------------------------------------------------

function RevolutionsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const r = opts.revolutions;

  const setInt = (
    attr: Extract<
      keyof OptionsRevolutions,
      | "revolutions_solaryearmode"
      | "revolutions_solarlocationmode"
      | "revolutions_lunarlocationmode"
      | "revolutions_planetslocationmode"
      | "revolutions_lunarparentmode"
    >,
    raw: string,
  ) => {
    const value = Number(raw) === 1 ? 1 : 0;
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const setBool = (
    attr: Extract<
      keyof OptionsRevolutions,
      "revsidereal_marr_solar" | "revsidereal_marr_lunar" | "revsidereal_marr_planet"
    >,
    value: boolean,
  ) => {
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const setReturnMode = (
    attr: "revolutions_solarreturnmode" | "revolutions_lunarreturnmode",
    value: string,
  ) => {
    sendPatch(
      { revolutions: { [attr]: value } },
      { ...opts, revolutions: { ...r, [attr]: value } },
    );
  };

  const locationSelect = (
    attr: "revolutions_solarlocationmode" | "revolutions_lunarlocationmode" | "revolutions_planetslocationmode",
  ) => (
    <Select value={r[attr]} width={200} onChange={(v) => setInt(attr, v)}>
      <option value={0}>{t("settings.useSupplementaryLocation")}</option>
      <option value={1}>{t("settings.ask")}</option>
    </Select>
  );

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.solarReturn">{t("settings.solarReturn")}</SectionLabel>
      <Row searchAnchor="settings.precessedSidereal" label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_solar} onChange={(v) => setBool("revsidereal_marr_solar", v)} />
      </Row>
      <Row searchAnchor="settings.year" label={t("settings.year")}>
        <Select value={r.revolutions_solaryearmode} width={150} onChange={(v) => setInt("revolutions_solaryearmode", v)}>
          <option value={0}>{t("settings.currentYear")}</option>
          <option value={1}>{t("settings.nextYear")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.location" label={t("settings.location")}>{locationSelect("revolutions_solarlocationmode")}</Row>
      <Row searchAnchor="chartmenu.tithiPravesha" label={t("chartmenu.tithiPravesha")}>
        <Toggle checked={r.revolutions_solarreturnmode === "tithi_pravesha"} onChange={(v) => setReturnMode("revolutions_solarreturnmode", v ? "tithi_pravesha" : "standard")} />
      </Row>

      <SectionLabel searchAnchor="section:settings.lunarReturn">{t("settings.lunarReturn")}</SectionLabel>
      <Row searchAnchor="settings.precessedSidereal#2" label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_lunar} onChange={(v) => setBool("revsidereal_marr_lunar", v)} />
      </Row>
      <Row searchAnchor="settings.location#2" label={t("settings.location")}>{locationSelect("revolutions_lunarlocationmode")}</Row>
      <Row searchAnchor="settings.parentChart" label={t("settings.parentChart")}>
        <Select value={r.revolutions_lunarparentmode} width={170} onChange={(v) => setInt("revolutions_lunarparentmode", v)}>
          <option value={0}>{t("settings.useRadixMoon")}</option>
          <option value={1}>{t("settings.useSolarReturnMoon")}</option>
        </Select>
      </Row>
      <Row searchAnchor="chartmenu.lunarPhaseEmbolismic" label={t("chartmenu.lunarPhaseEmbolismic")}>
        <Toggle checked={r.revolutions_lunarreturnmode === "soli_lunar"} onChange={(v) => setReturnMode("revolutions_lunarreturnmode", v ? "soli_lunar" : "lunar")} />
      </Row>
      <Row searchAnchor="chartmenu.jonasArc" label={t("chartmenu.jonasArc")}>
        <Toggle checked={r.revolutions_lunarreturnmode === "jonas_arc"} onChange={(v) => setReturnMode("revolutions_lunarreturnmode", v ? "jonas_arc" : "lunar")} />
      </Row>

      <SectionLabel searchAnchor="section:settings.planetaryReturns">{t("settings.planetaryReturns")}</SectionLabel>
      <Row searchAnchor="settings.precessedSidereal#3" label={t("settings.precessedSidereal")}>
        <Toggle checked={r.revsidereal_marr_planet} onChange={(v) => setBool("revsidereal_marr_planet", v)} />
      </Row>
      <Row searchAnchor="settings.location#3" label={t("settings.location")}>{locationSelect("revolutions_planetslocationmode")}</Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Progressions (quickchartsoptdlg.QuickChartsOptDlg).
// progressed_angle_method / progression_day_type are the secondary-progression
// CALC options (posfordate enums) consumed by the directions list, the
// progression adapters and the stepper.
// Choice values + labels come from the daemon catalog — nothing is computed
// here.
// ---------------------------------------------------------------------------

function SolarArcTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const q = opts.quickCharts;
  const patch = (fields: Partial<OptionsQuickCharts>) => {
    sendPatch({ quickCharts: fields }, { ...opts, quickCharts: { ...q, ...fields } });
  };
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.tabSolarArcDirections">{t("settings.tabSolarArcDirections")}</SectionLabel>
      <Row searchAnchor="settings.method" label={t("settings.method")}>
        <Select value={q.solar_arc_angle_mode} width={200}
          onChange={(v) => patch({ solar_arc_angle_mode: v as "progressed" | "zodiacal" })}>
          <option value="zodiacal">{t("optmenu.zodiacalDirectionsUniform")}</option>
          <option value="progressed">{t("settings.calculatedAngles")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.calculatedAngles" label={t("settings.calculatedAngles")}>
        <Select value={q.solar_arc_angle_method} width={200}
          onChange={(v) => patch({ solar_arc_angle_method: Number(v) })}>
          {opts.catalog.progressionAngleMethods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

function ProgressionsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const q = opts.quickCharts;
  const cat = opts.catalog;

  const patch = (fields: Partial<OptionsQuickCharts>) => {
    sendPatch(
      { quickCharts: fields },
      { ...opts, quickCharts: { ...q, ...fields } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.progressionCalculation">{t("settings.progressionCalculation")}</SectionLabel>
      <Row searchAnchor="settings.progressedAngles" label={t("settings.progressedAngles")}>
        <Select
          value={q.progressed_angle_method}
          width={200}
          onChange={(v) => patch({ progressed_angle_method: Number(v) })}
        >
          {cat.progressionAngleMethods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.dayType" label={t("settings.dayType")}>
        <Select
          value={q.progression_day_type}
          width={200}
          onChange={(v) => patch({ progression_day_type: Number(v) })}
        >
          {cat.progressionDayTypes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.prebirthPerfectionsConverse" label={t("settings.prebirthPerfectionsConverse")}>
        <Toggle
          checked={q.aspectlist_prebirth_secondary_converse}
          onChange={(v) => patch({ aspectlist_prebirth_secondary_converse: v })}
        />
      </Row>

      <SolarArcTab opts={opts} sendPatch={sendPatch} />

      <SectionLabel searchAnchor="section:settings.harmonicCharts">{t("settings.harmonicCharts")}</SectionLabel>
      <Row searchAnchor="settings.defaultDivisionMethod" label={t("settings.defaultDivisionMethod")}>
        <Select
          value={q.harmonic_chart_mode}
          width={200}
          onChange={(v) => patch({ harmonic_chart_mode: v as "harmonic" | "varga" })}
        >
          <option value="harmonic">{t("chartmenu.harmonicChart")}</option>
          <option value="varga">{t("chartmenu.vargas")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.vargaDrishti" label={t("settings.vargaDrishti")}>
        <Select
          value={q.varga_drishti_mode}
          width={200}
          onChange={(v) => patch({ varga_drishti_mode: v as "off" | "parashari" | "jaimini" })}
        >
          <option value="off">{t("settings.vargaDrishtiOff")}</option>
          <option value="parashari">{t("settings.vargaDrishtiParashari")}</option>
          <option value="jaimini">{t("settings.vargaDrishtiJaimini")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.vargaNodeDrishti" label={t("settings.vargaNodeDrishti")}>
        <Toggle
          checked={q.varga_node_special_drishti}
          disabled={q.varga_drishti_mode !== "parashari"}
          onChange={(v) => patch({ varga_node_special_drishti: v })}
        />
      </Row>

      <SectionLabel searchAnchor="section:settings.launcher">{t("settings.launcher")}</SectionLabel>
      <Row searchAnchor="settings.progressionsTransits" label={t("settings.progressionsTransits")}>
        <Select
          value={q.secondary_progression_launch_mode}
          width={150}
          onChange={(v) => patch({ secondary_progression_launch_mode: Number(v) })}
        >
          {cat.secondaryLaunchModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.tableTimes" label={t("settings.tableTimes")}>
        <Select
          value={q.event_table_time_basis}
          width={170}
          onChange={(v) => patch({ event_table_time_basis: v })}
        >
          {cat.eventTableTimeModes.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <Row searchAnchor="settings.timedRowsShowRadix" label={t("settings.timedRowsShowRadix")}>
        <Toggle
          checked={q.timed_chart_show_radix_default}
          onChange={(v) => patch({ timed_chart_show_radix_default: v })}
        />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 11 — Step Alerts (stepalertsdlg.StepAlertsDlg)
// ---------------------------------------------------------------------------

function StepAlertsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const s = opts.stepAlerts;
  const cat = opts.catalog;

  const setEnabled = (value: boolean) => {
    sendPatch(
      { stepAlerts: { stepalerts_enabled: value } },
      { ...opts, stepAlerts: { ...s, stepalerts_enabled: value } },
    );
  };

  const setVec = (
    attr: "stepalerts_promplanets" | "stepalerts_sigplanets" | "stepalerts_sigangles",
    index: number,
    value: boolean,
  ) => {
    const next = [...s[attr]];
    next[index] = value;
    sendPatch(
      { stepAlerts: { [attr]: next } },
      { ...opts, stepAlerts: { ...s, [attr]: next } },
    );
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel>{t("settings.sound")}</SectionLabel>
      <Row label={t("settings.enableExactConjunctionAlerts")}>
        <Toggle
          checked={s.stepalerts_enabled}
          onChange={setEnabled}
        />
      </Row>

      <SectionLabel>{t("settings.promissors")}</SectionLabel>
      {cat.stepAlertBodies.map((body, i) => (
        <Row
          key={`prom-${body.id}`}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={body.glyph} />
              {body.label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(s.stepalerts_promplanets[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_promplanets", i, v)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.planetSignificators")}</SectionLabel>
      {cat.stepAlertBodies.map((body, i) => (
        <Row
          key={`sig-${body.id}`}
          label={
            <span className="flex items-center gap-[var(--aries-control-gap)]">
              <Glyph ch={body.glyph} />
              {body.label}
            </span>
          }
        >
          <Toggle
            checked={Boolean(s.stepalerts_sigplanets[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_sigplanets", i, v)}
          />
        </Row>
      ))}

      <SectionLabel>{t("settings.angleSignificators")}</SectionLabel>
      {cat.stepAlertAngles.map((angle, i) => (
        <Row key={angle.value} label={angle.label}>
          <Toggle
            checked={Boolean(s.stepalerts_sigangles[i])}
            disabled={!s.stepalerts_enabled}
            onChange={(v) => setVec("stepalerts_sigangles", i, v)}
          />
        </Row>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Lots. The daemon provides the Fortune choices and configured part formulas.
// ---------------------------------------------------------------------------

function PlanetsPointsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const p = opts.planetsPoints;
  const cat = opts.catalog;
  const [removeAllPending, setRemoveAllPending] = React.useState(false);

  const patch = (
    fields: NonNullable<OptionsPatch["planetsPoints"]>,
    optimistic?: Partial<OptionsPlanetsPoints>,
  ) => {
    sendPatch(
      { planetsPoints: fields },
      { ...opts, planetsPoints: { ...p, ...(optimistic ?? fields) } },
    );
  };

  const setPartActive = (index: number, active: boolean) => {
    patch(
      { partsActive: [{ index, active }] },
      {
        parts: p.parts.map((part) =>
          part.index === index ? { ...part, active } : part,
        ),
      },
    );
  };

  const removePart = (index: number) => {
    patch(
      { removeIndex: index },
      {
        parts: p.parts
          .filter((part) => part.index !== index)
          .map((part, i) => ({ ...part, index: i })),
      },
    );
  };

  // Bulk active intents — wx All On / All Off / Invert buttons
  // (arabicpartsdlg.py:1396-1412) applied to every user row (the webapp list
  // has no multi-select; per-row Toggle covers single rows).
  const setAllActive = (compute: (part: ArabicPartMeta) => boolean) => {
    patch(
      { partsActive: p.parts.map((part) => ({ index: part.index, active: compute(part) })) },
      { parts: p.parts.map((part) => ({ ...part, active: compute(part) })) },
    );
  };

  const removeAll = () => {
    if (p.parts.length === 0) return;
    setRemoveAllPending(true);
  };

  const confirmRemoveAll = () => {
    patch({ removeAll: true }, { parts: [] });
    setRemoveAllPending(false);
  };

  // Add/Edit lot-formula calculator (wx OnAdd/OnModify; all formula semantics
  // live in the Python brain — this editor only collects raw codes/refdeg).
  const [editor, setEditor] = React.useState<
    | { mode: "add" }
    | { mode: "edit"; index: number }
    | null
  >(null);

  const addPart = (spec: ArabicPartSpec) => {
    patch({ addPart: spec });
    setEditor(null);
  };

  const updatePart = (index: number, spec: ArabicPartSpec) => {
    patch({ updatePart: { ...spec, index } });
  };

  const [importStatus, setImportStatus] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const onImportFile = (file: File) => {
    file
      .text()
      .then((text) => importArabicParts(JSON.parse(text) as unknown[]))
      .then((res) => {
        // wx shows "Imported N. Skipped M. K unresolved." (OnImport :2652-2660).
        let msg = t("settings.importedParts", { count: res.imported });
        if (res.skipped > 0) msg += " " + t("settings.skippedParts", { count: res.skipped });
        if (res.unresolved > 0) msg += " " + t("settings.unresolvedRefs", { count: res.unresolved });
        setImportStatus(msg);
        // res IS the authoritative options payload — reconcile through the
        // shared sendPatch path with an empty no-op patch.
        sendPatch({}, res);
      })
      .catch((err) => setImportStatus(`${t("settings.importFailed")}: ${String(err)}`));
  };

  const exportParts = () => {
    exportArabicParts()
      .then((text) => downloadTextContent("arabic_parts.json", text, "application/json"))
      .catch((err) => setImportStatus(`${t("settings.exportFailed")}: ${String(err)}`));
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.lotOfFortune">{t("settings.lotOfFortune")}</SectionLabel>
      <Row searchAnchor="settings.reverseByNight" label={t("settings.reverseByNight")}>
        <Toggle
          checked={p.lotoffortune !== FORTUNE_SAME_DAY_NIGHT}
          onChange={(v) => patch({ lotoffortune: v ? FORTUNE_REVERSED_BY_NIGHT : FORTUNE_SAME_DAY_NIGHT })}
        />
      </Row>
      <p className="mt-[var(--aries-control-gap)] text-[length:var(--aries-font-size-small)] text-foreground/60">
        {t("settings.fortuneReverseHint")}
      </p>

      <SectionLabel searchAnchor="section:settings.arabicParts">{t("settings.arabicParts")}</SectionLabel>
      {p.parts.map((part) => {
        const isEditing = editor?.mode === "edit" && editor.index === part.index;
        return (
          <React.Fragment key={part.index}>
            <div className="flex h-[var(--aries-control-height-small)] items-center justify-between gap-[var(--aries-form-row-gap)] border-b border-border/40 text-[length:var(--aries-font-size-base)]">
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                #{part.index + 2} {part.name}
                <span className="ml-2 text-foreground/45">{part.formula}</span>
                {part.hasNocturnalFormula ? (
                  <span className="ml-1 text-foreground/45">{t("settings.badgeDayNight")}</span>
                ) : part.diurnal ? (
                  <span className="ml-1 text-foreground/45">*</span>
                ) : null}
                {part.gendered || part.hasFemaleFormula ? (
                  <span className="ml-1 text-foreground/45">{t("settings.badgeMaleFemale")}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-[var(--aries-form-field-gap)]">
                <Toggle
                  checked={part.active}
                  onChange={(v) => setPartActive(part.index, v)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setEditor((current) =>
                      current?.mode === "edit" && current.index === part.index
                        ? null
                        : { mode: "edit", index: part.index },
                    )
                  }
                  className="rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-gap)] py-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] text-foreground/60 hover:text-foreground"
                >
                  {isEditing ? t("settings.close") : t("settings.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => removePart(part.index)}
                  className="rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-gap)] py-[var(--aries-segmented-control-padding)] text-[length:var(--aries-font-size-small)] text-foreground/60 hover:text-foreground"
                >
                  {t("settings.remove")}
                </button>
              </span>
            </div>
            {isEditing ? (
              <ArabicPartEditor
                key={`edit-${part.index}`}
                mode="edit"
                part={part}
                parts={p.parts}
                terms={cat.arabicPartTerms}
                signs={cat.zodiacSigns}
                lofName={cat.lotOfFortuneName}
                onSave={(spec) => updatePart(part.index, spec)}
                onAutoSave={(spec) => updatePart(part.index, spec)}
                onCancel={() => setEditor(null)}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      {p.parts.length === 0 ? (
        <div className="py-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.noCustomParts")}</div>
      ) : null}

      <div className="mt-[var(--aries-form-field-gap)] flex flex-wrap items-center gap-[var(--aries-control-gap)]">
        <ActionButton onClick={() => setEditor({ mode: "add" })}>{t("settings.addPart")}</ActionButton>
        <ActionButton onClick={() => setAllActive(() => true)}>{t("settings.allOn")}</ActionButton>
        <ActionButton onClick={() => setAllActive(() => false)}>{t("settings.allOff")}</ActionButton>
        <ActionButton onClick={() => setAllActive((part) => !part.active)}>{t("settings.invert")}</ActionButton>
        <ActionButton onClick={removeAll}>{t("settings.removeAll")}</ActionButton>
        <span className="mx-[var(--aries-control-gap-compact)] h-[var(--aries-control-icon-size-default)] w-[var(--aries-sash-rule-size)] bg-border/60" />
        <ActionButton onClick={exportParts}>{t("settings.export")}</ActionButton>
        <ActionButton onClick={() => fileInputRef.current?.click()}>{t("settings.import")}</ActionButton>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {importStatus ? (
        <div className="pt-1 text-[length:var(--aries-font-size-small)] text-foreground/55">{importStatus}</div>
      ) : null}

      {editor?.mode === "add" ? (
        <ArabicPartEditor
          key="add"
          mode="add"
          part={null}
          parts={p.parts}
          terms={cat.arabicPartTerms}
          signs={cat.zodiacSigns}
          lofName={cat.lotOfFortuneName}
          onSave={addPart}
          onCancel={() => setEditor(null)}
        />
      ) : null}
      {removeAllPending ? (
        <SettingsConfirmDialog
          title={t("settings.removeArabicParts")}
          body={t("settings.removeAllPartsConfirm")}
          action={t("settings.remove")}
          onCancel={() => setRemoveAllPending(false)}
          onConfirm={confirmRemoveAll}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="h-[var(--aries-control-height-micro)] rounded-[var(--aries-radius-xs)] border border-border/60 px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-small)] text-foreground/70 hover:text-foreground disabled:opacity-40 disabled:hover:text-foreground/70"
    >
      {children}
    </button>
  );
}

function SettingsConfirmDialog({
  title,
  body,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--aries-overlay-scrim)] px-[var(--aries-form-section-gap)]">
      <div
        data-aries-surface="overlay"
        className="w-full max-w-[var(--aries-dialog-width-confirm)] rounded-[var(--aries-radius-md)] border border-border bg-background p-[var(--aries-dialog-padding)] shadow-xl"
      >
        <div className="mb-[var(--aries-dialog-header-gap)] text-[length:var(--aries-font-size-large)] font-medium">{title}</div>
        <p className="text-[length:var(--aries-font-size-reading)] leading-[var(--aries-font-line-height-reading)] text-muted-foreground">{body}</p>
        <div className="mt-[var(--aries-dialog-gap)] flex justify-end gap-[var(--aries-dialog-footer-gap)]">
          <button
            type="button"
            onClick={onCancel}
            className="h-[var(--aries-control-height)] min-w-[var(--aries-control-min-width)] rounded-[var(--aries-radius-md)] border border-border px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-reading)] text-foreground/75 hover:text-foreground"
          >
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-[var(--aries-control-height)] min-w-[var(--aries-control-min-width)] rounded-[var(--aries-radius-md)] bg-destructive/10 px-[calc(var(--aries-control-padding-x)+var(--aries-control-gap-compact)/2)] text-[length:var(--aries-font-size-reading)] text-destructive hover:bg-destructive/20"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lot-formula calculator editor — webapp twin of the wx Add/Modify surface
// (arabicpartsdlg.py ArabicPartsDlg editor block + FormulaEditorDlg). The skin
// collects raw term codes and refdeg slots; ALL formula semantics (parsing,
// formatting, validation, serialization) stay in the Python brain via
// previewArabicPart + the addPart/updatePart patch intents.
// ---------------------------------------------------------------------------

type TermMeta = { value: number; label: string; kind: "" | "RE" | "DE" };

function normalizeArabicFormulaCode(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function normalizeArabicRefTriplet(value: unknown): unknown[] {
  const source = Array.isArray(value) ? value : [0, 0, 0];
  return [0, 1, 2].map((idx) => normalizeArabicRefSlot(source[idx]));
}

function normalizeArabicRefSlot(value: unknown): ArabicRefSlot {
  if (Array.isArray(value)) {
    return [
      normalizeArabicFormulaCode(value[0]),
      normalizeArabicFormulaCode(value[1]),
      normalizeArabicFormulaCode(value[2]),
      normalizeArabicRefTriplet(value[3]),
    ];
  }
  if (typeof value === "string") return value;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function arabicRefKey(value: unknown): string {
  return JSON.stringify(normalizeArabicRefSlot(value));
}

/** Match a stored RE slot back to its picker choice — the headless twin of
 * ArabicPartsDlg._sync_inline_from_pending (arabicpartsdlg.py:1542-1588):
 * embedded tuples match a lot's embed pack, name strings match by name, legacy
 * numeric refs are dialog row indices (0 = LoF). */
function reChoiceIndexFor(
  ref: ArabicRefSlot,
  others: ArabicPartMeta[],
  allParts: ArabicPartMeta[],
): number {
  if (Array.isArray(ref)) {
    const key = arabicRefKey(ref);
    const idx = others.findIndex((o) => arabicRefKey(o.embed) === key);
    return idx >= 0 ? idx + 1 : 0;
  }
  if (typeof ref === "string") {
    const idx = others.findIndex((o) => o.name === ref);
    return idx >= 0 ? idx + 1 : 0;
  }
  const n = Number(ref);
  if (Number.isInteger(n) && n > 0) {
    // Legacy numeric refs are dialog row indices (row 0 = LoF); map row n to
    // options.arabicparts[n-1] by NAME so the self-excluded list lines up.
    const name = allParts[n - 1]?.name;
    const idx = name ? others.findIndex((o) => o.name === name) : -1;
    return idx >= 0 ? idx + 1 : 0;
  }
  return 0;
}

function ArabicPartEditor({
  mode,
  part,
  parts,
  terms,
  signs,
  lofName,
  onSave,
  onAutoSave,
  onCancel,
}: {
  mode: "add" | "edit";
  part: ArabicPartMeta | null;
  parts: ArabicPartMeta[];
  terms: TermMeta[];
  signs: string[];
  lofName: string;
  onSave: (spec: ArabicPartSpec) => void;
  onAutoSave?: (spec: ArabicPartSpec) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = React.useState(part?.name ?? "");
  const [codes, setCodes] = React.useState<number[]>(part?.codes ?? [0, 0, 0]);
  const [refdeg, setRefdeg] = React.useState<ArabicRefSlot[]>(part?.refdeg ?? [0, 0, 0]);
  const [diurnal, setDiurnal] = React.useState(
    part?.hasNocturnalFormula ? false : (part?.diurnal ?? false),
  );
  const [gendered, setGendered] = React.useState(part?.gendered ?? false);
  const [femaleOn, setFemaleOn] = React.useState(part?.hasFemaleFormula ?? false);
  const [nocturnalOn, setNocturnalOn] = React.useState(part?.hasNocturnalFormula ?? false);
  const [femaleCodes, setFemaleCodes] = React.useState<number[]>(
    part?.femaleCodes ?? part?.codes ?? [0, 0, 0],
  );
  const [femaleRefdeg, setFemaleRefdeg] = React.useState<ArabicRefSlot[]>(
    part?.femaleRefdeg ?? part?.refdeg ?? [0, 0, 0],
  );
  const [nocturnalCodes, setNocturnalCodes] = React.useState<number[]>(
    part?.nocturnalCodes ?? part?.codes ?? [0, 0, 0],
  );
  const [nocturnalRefdeg, setNocturnalRefdeg] = React.useState<ArabicRefSlot[]>(
    part?.nocturnalRefdeg ?? part?.refdeg ?? [0, 0, 0],
  );
  const [preview, setPreview] = React.useState<{
    formulaText: string;
    femaleFormulaText: string | null;
    nocturnalFormulaText: string | null;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  // Other lots this row may RE-reference (no self-reference —
  // _rebuild_re_choices excludes the current row, arabicpartsdlg.py:1432-1447).
  const editPartIndex = mode === "edit" ? (part?.index ?? null) : null;
  const others = React.useMemo(
    () => parts.filter((o) => editPartIndex === null || o.index !== editPartIndex),
    [editPartIndex, parts],
  );

  // Live preview from the Python brain (the wx Formula column).
  React.useEffect(() => {
    const controller = new AbortController();
    previewArabicPart(
      {
        codes,
        refdeg,
        diurnal,
        gendered,
        femaleCodes: femaleOn ? femaleCodes : null,
        femaleRefdeg: femaleOn ? femaleRefdeg : null,
        nocturnalCodes: nocturnalOn ? nocturnalCodes : null,
        nocturnalRefdeg: nocturnalOn ? nocturnalRefdeg : null,
      },
      controller.signal,
    )
      .then((res) => {
        setPreview(res);
        setPreviewError(null);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setPreviewError(String(err));
      });
    return () => controller.abort();
  }, [
    codes,
    refdeg,
    diurnal,
    gendered,
    femaleOn,
    femaleCodes,
    femaleRefdeg,
    nocturnalOn,
    nocturnalCodes,
    nocturnalRefdeg,
  ]);

  // Name guards mirror the daemon's checkName + empty-name gate, preventing
  // invalid add saves and invalid edit autosaves before the 400 would happen.
  const trimmed = name.trim();
  const duplicate =
    trimmed === lofName || others.some((o) => o.name === trimmed);
  const canSave = trimmed.length > 0 && !duplicate;
  const spec = React.useMemo<ArabicPartSpec>(() => ({
    name: trimmed,
    codes,
    refdeg,
    diurnal: nocturnalOn ? false : diurnal,
    gendered,
    femaleCodes: femaleOn ? femaleCodes : null,
    femaleRefdeg: femaleOn ? femaleRefdeg : null,
    nocturnalCodes: nocturnalOn ? nocturnalCodes : null,
    nocturnalRefdeg: nocturnalOn ? nocturnalRefdeg : null,
    active: mode === "edit" ? (part?.active ?? true) : true,
  }), [
    trimmed,
    codes,
    refdeg,
    nocturnalOn,
    diurnal,
    gendered,
    femaleOn,
    femaleCodes,
    femaleRefdeg,
    nocturnalCodes,
    nocturnalRefdeg,
    mode,
    part?.active,
  ]);
  const specKey = React.useMemo(() => JSON.stringify(spec), [spec]);
  const lastAutoSavedKeyRef = React.useRef(specKey);

  React.useEffect(() => {
    if (mode !== "edit" || !onAutoSave || !canSave) return;
    if (lastAutoSavedKeyRef.current === specKey) return;
    const timer = window.setTimeout(() => {
      lastAutoSavedKeyRef.current = specKey;
      onAutoSave(spec);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [canSave, mode, onAutoSave, spec, specKey]);

  return (
    <div
      className={
        mode === "edit"
          ? "flex flex-col gap-[var(--aries-form-field-gap)] border-b border-border/40 bg-muted/20 px-[var(--aries-control-padding-x-compact)] py-[var(--aries-form-field-gap)]"
          : "mt-[var(--aries-form-field-gap)] flex flex-col gap-[var(--aries-form-field-gap)] rounded-[var(--aries-radius-control-compact)] border border-border/60 p-[var(--aries-form-field-gap)]"
      }
    >
      <div className="flex items-center justify-between gap-[var(--aries-form-field-gap)]">
        <span className="text-[length:var(--aries-font-size-small)] font-medium text-foreground/55">
          {mode === "edit" ? t("settings.editPart", { name: part?.name ?? "" }) : t("settings.newPart")}
        </span>
      </div>
      <div className="flex items-center gap-[var(--aries-form-field-gap)]">
        <span className="w-12 text-[length:var(--aries-font-size-small)] text-foreground/60">{t("settings.name")}</span>
        <input
          data-aries-control-appearance="local"
          type="text"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-[var(--aries-control-height-compact)] w-[200px] rounded-[var(--aries-radius-xs)] border border-border/60 bg-transparent px-[var(--aries-control-gap)] text-[length:var(--aries-font-size-base)] outline-none focus:border-border"
        />
        {duplicate ? (
          <span className="text-[length:var(--aries-font-size-small)] text-[color:var(--aries-validation-error)]">{t("settings.alreadyExists")}</span>
        ) : null}
      </div>
      <FormulaSlots
        codes={codes}
        refdeg={refdeg}
        terms={terms}
        signs={signs}
        lofName={lofName}
        others={others}
        allParts={parts}
        onChange={(nextCodes, nextRefdeg) => {
          setCodes(nextCodes);
          setRefdeg(nextRefdeg);
        }}
      />
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={!nocturnalOn && diurnal} onChange={setDiurnal} disabled={nocturnalOn} />
        {t("settings.diurnalSwapBc")}
      </label>
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle
          checked={nocturnalOn}
          onChange={setNocturnalOn}
        />
        {t("settings.separateNocturnalFormula")}
      </label>
      {nocturnalOn ? (
        <FormulaSlots
          codes={nocturnalCodes}
          refdeg={nocturnalRefdeg}
          terms={terms}
          signs={signs}
          lofName={lofName}
          others={others}
          allParts={parts}
          onChange={(nextCodes, nextRefdeg) => {
            setNocturnalCodes(nextCodes);
            setNocturnalRefdeg(nextRefdeg);
          }}
        />
      ) : null}
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={gendered} onChange={setGendered} />
        {t("settings.switchForFemale")}
      </label>
      <label className="flex items-center gap-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-base)] text-foreground/80">
        <Toggle checked={femaleOn} onChange={setFemaleOn} />
        {t("settings.separateFemaleFormula")}
      </label>
      {femaleOn ? (
        <FormulaSlots
          codes={femaleCodes}
          refdeg={femaleRefdeg}
          terms={terms}
          signs={signs}
          lofName={lofName}
          others={others}
          allParts={parts}
          onChange={(nextCodes, nextRefdeg) => {
            setFemaleCodes(nextCodes);
            setFemaleRefdeg(nextRefdeg);
          }}
        />
      ) : null}
      <div className="text-[length:var(--aries-font-size-small)] text-foreground/55">
        {previewError
          ? `${t("settings.previewFailed")}: ${previewError}`
          : preview
            ? `${t("settings.formula")}: ${preview.formulaText}` +
              (nocturnalOn && preview.nocturnalFormulaText
                ? ` — ${t("settings.night")}: ${preview.nocturnalFormulaText}`
                : "") +
              (femaleOn && preview.femaleFormulaText
                ? ` — ${t("settings.female")}: ${preview.femaleFormulaText}`
                : "")
            : "…"}
      </div>
      <div className="flex items-center gap-[var(--aries-control-gap)]">
        {mode === "add" ? (
          <ActionButton
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave(spec);
            }}
          >
            {t("settings.save")}
          </ActionButton>
        ) : null}
        <ActionButton onClick={onCancel}>{mode === "edit" ? t("settings.close") : t("settings.cancel")}</ActionButton>
        {!canSave && trimmed.length === 0 ? (
          <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.nameRequired")}</span>
        ) : null}
      </div>
    </div>
  );
}

/** One formula row: A + ( B - C ), each slot a term picker with RE/DE
 * sub-controls (the wx inline RE/DE rows, arabicpartsdlg.py:1064-1158, in the
 * simple native per-slot form). */
function FormulaSlots({
  codes,
  refdeg,
  terms,
  signs,
  lofName,
  others,
  allParts,
  onChange,
}: {
  codes: number[];
  refdeg: ArabicRefSlot[];
  terms: TermMeta[];
  signs: string[];
  lofName: string;
  others: ArabicPartMeta[];
  allParts: ArabicPartMeta[];
  onChange: (codes: number[], refdeg: ArabicRefSlot[]) => void;
}) {
  const ops = ["", "+ (", "−"];
  const setSlot = (i: number, code: number, ref: ArabicRefSlot) => {
    const nextCodes = codes.slice();
    const nextRef = refdeg.slice();
    nextCodes[i] = code;
    nextRef[i] = ref;
    onChange(nextCodes, nextRef);
  };
  return (
    <div className="flex flex-wrap items-start gap-[var(--aries-control-gap)]">
      {[0, 1, 2].map((i) => {
        const term = terms.find((t) => t.value === codes[i]);
        const kind = term?.kind ?? "";
        const ref = refdeg[i];
        const deAbs =
          kind === "DE" && typeof ref === "number" ? ((ref % 360) + 360) % 360 : 0;
        return (
          <React.Fragment key={i}>
            {ops[i] ? (
              <span className="pt-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-base)] text-foreground/60">{ops[i]}</span>
            ) : null}
            <span className="flex flex-col gap-[var(--aries-control-gap-compact)]">
              <Select
                value={codes[i]}
                width={110}
                onChange={(v) => {
                  // Every token change resets its refdeg slot; RE/DE slots
                  // then start at LoF / 0 Aries like the wx inline controls
                  // (_handle_token_click, arabicpartsdlg.py:1694-1695).
                  setSlot(i, Number(v), 0);
                }}
              >
                {terms.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
              {kind === "DE" ? (
                <span className="flex items-center gap-[var(--aries-control-gap-compact)]">
                  <Select
                    value={Math.floor(deAbs / 30)}
                    width={90}
                    onChange={(v) => setSlot(i, codes[i], Number(v) * 30 + (deAbs % 30))}
                  >
                    {signs.map((s, si) => (
                      <option key={s} value={si}>{s}</option>
                    ))}
                  </Select>
                  <NumberField
                    value={deAbs % 30}
                    min={0}
                    max={29}
                    onCommit={(n) => setSlot(i, codes[i], Math.floor(deAbs / 30) * 30 + n)}
                  />
                </span>
              ) : null}
              {kind === "RE" ? (
                <Select
                  value={reChoiceIndexFor(ref, others, allParts)}
                  width={130}
                  onChange={(v) => {
                    const idx = Number(v);
                    // Choice 0 = LoF (stored as legacy 0 — arabicpartsdlg.py
                    // :1653-1655); others embed that lot's formula pack.
                    setSlot(
                      i,
                      codes[i],
                      idx === 0 ? 0 : normalizeArabicRefSlot(others[idx - 1].embed),
                    );
                  }}
                >
                  <option value={0}>{lofName}</option>
                  {others.map((o, oi) => (
                    <option key={o.index} value={oi + 1}>{o.name}</option>
                  ))}
                </Select>
              ) : null}
            </span>
          </React.Fragment>
        );
      })}
      <span className="pt-1 text-[length:var(--aries-font-size-base)] text-foreground/60">)</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Almutens (almutenchartdlg.AlmutenChartDlg scoring weights). Every wx
// control round-trips; a change recalculates every chart's almuten (the daemon
// Chart.recalc fan-out subsumes horoscope.recalcAlmutens, morin.py:20876).
// The Topical-almuten definition editor (almutentopicalsdlg) is a bespoke CRUD
// list deferred separately — see the settings wiring map.
// ---------------------------------------------------------------------------

const ALMUTEN_HOUSE_LABELS = [
  "House 1", "House 2", "House 3", "House 4", "House 5", "House 6",
  "House 7", "House 8", "House 9", "House 10", "House 11", "House 12",
] as const;
const ALMUTEN_SUNPHASE_LABELS = ["Strong", "Medium", "Weak"] as const;
const ALMUTEN_DAYHOUR_LABELS = ["Day ruler", "Hour ruler"] as const;

function AlmutensTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const a = opts.almutens;
  const cat = opts.catalog;
  const sunPhaseKeys = ["settings.almutenPhaseStrong", "settings.almutenPhaseMedium", "settings.almutenPhaseWeak"];
  const dayHourKeys = ["settings.almutenDayRuler", "settings.almutenHourRuler"];

  const patch = (fields: Partial<OptionsAlmutens>) => {
    sendPatch({ almutens: fields }, { ...opts, almutens: { ...a, ...fields } });
  };
  const setVec = (
    key: "dignityscores" | "housescores" | "sunphases" | "dayhourscores",
    i: number,
    value: number,
  ) => {
    const next = a[key].slice();
    next[i] = value;
    patch({ [key]: next } as Partial<OptionsAlmutens>);
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.triplicityRulers">{t("settings.triplicityRulers")}</SectionLabel>
      <Row searchAnchor="settings.rulersCounted" label={t("settings.rulersCounted")}>
        <Select
          value={a.oneruler ? 1 : 0}
          width={150}
          onChange={(v) => patch({ oneruler: Number(v) === 1 })}
        >
          <option value={1}>{t("settings.oneRulerDayNight")}</option>
          <option value={0}>{t("settings.allThree")}</option>
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.essentialDignityWeights">{t("settings.essentialDignityWeights")}</SectionLabel>
      {cat.almutenDignityLabels.map((label, i) => (
        <Row key={`dig-${i}`} label={label}>
          <NumberField value={a.dignityscores[i] ?? 0} min={0} max={5} onCommit={(n) => setVec("dignityscores", i, n)} />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.accidentalDignity">{t("settings.accidentalDignity")}</SectionLabel>
      <Row searchAnchor="settings.useAccidental" label={t("settings.useAccidental")}>
        <Toggle checked={a.useaccidental} onChange={(v) => patch({ useaccidental: v })} />
      </Row>
      {ALMUTEN_HOUSE_LABELS.map((_, i) => (
        <Row key={`hc-${i}`} label={t("settings.house", { n: i + 1 })}>
          <NumberField value={a.housescores[i] ?? 0} min={0} max={12} onCommit={(n) => setVec("housescores", i, n)} />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.sunPhaseWeights">{t("settings.sunPhaseWeights")}</SectionLabel>
      {ALMUTEN_SUNPHASE_LABELS.map((_, i) => (
        <Row key={`sun-${i}`} label={t(sunPhaseKeys[i])}>
          <NumberField value={a.sunphases[i] ?? 0} min={0} max={5} onCommit={(n) => setVec("sunphases", i, n)} />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.dayHourRulerWeights">{t("settings.dayHourRulerWeights")}</SectionLabel>
      {ALMUTEN_DAYHOUR_LABELS.map((_, i) => (
        <Row key={`dh-${i}`} label={t(dayHourKeys[i])}>
          <NumberField value={a.dayhourscores[i] ?? 0} min={0} max={10} onCommit={(n) => setVec("dayhourscores", i, n)} />
        </Row>
      ))}

      <SectionLabel searchAnchor="section:settings.mercury">{t("settings.mercury")}</SectionLabel>
      <Row searchAnchor="settings.useExaltationMercury" label={t("settings.useExaltationMercury")}>
        <Toggle checked={a.useexaltationmercury} onChange={(v) => patch({ useexaltationmercury: v })} />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Time Lords (Options > Time Lords: Profections + Firdaria).
// Profections flags route through {profections:{…}} (options_service
// ._apply_profections); Firdaria through {firdaria:{…}} (._apply_firdaria).
// ---------------------------------------------------------------------------

function TimeLordsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const p = opts.profections;
  const f = opts.firdaria;
  const cat = opts.catalog;

  const patchProf = (fields: Partial<typeof p>) => {
    sendPatch({ profections: fields }, { ...opts, profections: { ...p, ...fields } });
  };

  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.profectionChart">{t("settings.profectionChart")}</SectionLabel>
      <Row searchAnchor="settings.method" label={t("settings.method")}>
        <Select
          value={p.zodiacal ? 1 : 0}
          width={170}
          onChange={(v) => patchProf({ zodiacal: Number(v) === 1 })}
        >
          <option value={1}>{t("settings.zodiacal")}</option>
          <option value={0}>{t("settings.placidianMundane")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.motion" label={t("settings.motion")}>
        <Select
          value={p.wholeSign ? "sign" : "continuous"}
          width={170}
          onChange={(v) => patchProf({ wholeSign: v === "sign" })}
        >
          <option value="continuous">{t("settings.continuous")}</option>
          <option value="sign">{t("settings.bySign")}</option>
        </Select>
      </Row>
      <Row searchAnchor="settings.useZodiacalProjections" label={t("settings.useZodiacalProjections")}>
        <Toggle
          checked={p.useZodProjs}
          disabled={p.zodiacal}
          onChange={(v) => patchProf({ useZodProjs: v })}
        />
      </Row>
      <Row searchAnchor="settings.snapStepsToSr" label={t("settings.snapStepsToSr")}>
        <Toggle checked={p.solarReturnSnap} onChange={(v) => patchProf({ solarReturnSnap: v })} />
      </Row>

      <SectionLabel searchAnchor="section:settings.firdaria">{t("settings.firdaria")}</SectionLabel>
      <Row searchAnchor="settings.nocturnalOrder" label={t("settings.nocturnalOrder")}>
        <Select
          value={f.isfirbonatti ? "1" : "0"}
          width={150}
          onChange={(v) =>
            sendPatch(
              { firdaria: { isfirbonatti: v === "1" } },
              { ...opts, firdaria: { isfirbonatti: v === "1" } },
            )
          }
        >
          {cat.firdariaModes.map((m) => (
            <option key={String(m.value)} value={m.value ? "1" : "0"}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Primary Directions. Reuses the complete PrimDirSettingsBody (the faithful
// migration of primarydirsdlg.PrimDirsPanel) so the menu item opens the SAME
// surface as the directions-view Settings sheet — no rebuild.
// ---------------------------------------------------------------------------

function PrimaryDirectionsTab({ opts, sendPatch, searchTarget }: TabProps & { searchTarget: SettingsSearchResult | null }) {
  const s = opts.primaryDirections;
  const paneDock = useFrameLayoutStore((state) => state.primaryDirectionsSettingsDock);
  const setPaneDock = useFrameLayoutStore((state) => state.setPrimaryDirectionsSettingsDock);
  return (
    <PrimDirSettingsBody
      settings={s}
      globals={{ meannode: opts.planetsPoints.meannode, topocentric: opts.display.topocentric }}
      planetGlyphs={PD_PLANET_GLYPHS}
      paneDock={paneDock}
      searchTarget={searchTarget}
      onPaneDockChange={setPaneDock}
      onPatch={(fields, optionsPatch) =>
        sendPatch(
          { ...optionsPatch, primaryDirections: fields },
          {
            ...opts,
            primaryDirections: { ...s, ...fields },
            planetsPoints: { ...opts.planetsPoints, ...optionsPatch?.planetsPoints },
            display: { ...opts.display, ...optionsPatch?.display },
          },
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Tab — Fixed Stars (fixstarsdlg.FixStarsDlg which-stars picker). The active set
// is the KEY set of options.fixstars; the per-star orbs live in the Orbs tab.
// Greenfield searchable checkbox list over the full SE catalog (~1362 rows),
// windowed to visible rows + overscan for immediacy. All selection/limit/alias
// semantics are owned by the daemon (_apply_fixed_stars); this only collects the
// selectedCodes set and forwards it.
// ---------------------------------------------------------------------------

const FIXSTAR_OVERSCAN = 8;
const FIXSTAR_VIEWPORT_H = 320; // px scroll viewport
const FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT = "aries:virtual-scroll-sync";
type FixedStarSortKey = "selected" | "name" | "code" | "lon";
type FixedStarSortState = {
  key: FixedStarSortKey;
  ascending: boolean;
} | null;

function FixedStarsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const fs = opts.fixedStars;
  const [nameQuery, setNameQuery] = React.useState("");
  const [codeQuery, setCodeQuery] = React.useState("");
  const [sort, setSort] = React.useState<FixedStarSortState>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowHeight = useListRowHeight("dense");

  // Local optimistic selection set (the daemon is still the truth owner).
  const selected = React.useMemo(
    () => new Set(fs.selectedCodes),
    [fs.selectedCodes],
  );

  const remaining = fs.maxSelected - selected.size;

  // Search filter — name AND code substring (fixstarsdlg._filtered_indices,
  // fixstarsdlg.py:423-434). Only rows with a non-empty code are selectable.
  const visible = React.useMemo(() => {
    const nq = nameQuery.trim().toLowerCase();
    const cq = codeQuery.trim().toLowerCase();
    const filtered = fs.catalog.filter((row) => {
      if (nq && !(row.name || "").toLowerCase().includes(nq)) return false;
      if (cq && !(row.code || "").toLowerCase().includes(cq)) return false;
      return true;
    });
    return groupFixedStarRows(sortFixedStarRows(filtered, sort, selected));
  }, [fs.catalog, nameQuery, codeQuery, selected, sort]);

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [nameQuery, codeQuery, sort]);

  const commit = (codes: string[]) => {
    sendPatch(
      { fixedStars: { selectedCodes: codes } },
      { ...opts, fixedStars: { ...fs, selectedCodes: codes } },
    );
  };

  const setUseIndianNames = (value: boolean) => {
    sendPatch(
      { fixedStars: { useIndianFixstarNames: value } },
      {
        ...opts,
        fixedStars: { ...fs, useIndianFixstarNames: value },
      },
    );
  };

  const toggle = (code: string) => {
    if (!code) return;
    if (selected.has(code)) {
      commit(fs.selectedCodes.filter((c) => c !== code));
      return;
    }
    // MAX_SELECTED cap (fixstarsdlg FixStarSelectionModel.toggle_row).
    if (selected.size >= fs.maxSelected) return;
    commit([...fs.selectedCodes, code]);
  };

  const deselectAll = () => commit([]);
  const restoreDefaults = () => commit(fs.defaultCodes);
  const isDefaultSelection =
    selected.size === new Set(fs.defaultCodes).size && fs.defaultCodes.every((code) => selected.has(code));

  // Windowed slice — render only the visible rows plus overscan.
  const total = visible.length;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - FIXSTAR_OVERSCAN);
  const count = Math.ceil(FIXSTAR_VIEWPORT_H / rowHeight) + FIXSTAR_OVERSCAN * 2;
  const slice = visible.slice(first, first + count);

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const syncScrollTop = () => setScrollTop(viewport.scrollTop);
    viewport.addEventListener(FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT, syncScrollTop);
    return () => viewport.removeEventListener(FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT, syncScrollTop);
  }, []);
  useFixedRowHeightAnchor(viewportRef, total, rowHeight, {
    syncEvent: FIXSTAR_VIRTUAL_SCROLL_SYNC_EVENT,
  });

  return (
    <div className="flex flex-col gap-0">
      <Row searchAnchor="settings.useIndianFixedStarNames" label={t("settings.useIndianFixedStarNames")}>
        <Toggle
          checked={fs.useIndianFixstarNames}
          onChange={setUseIndianNames}
        />
      </Row>
      <SectionLabel searchAnchor="section:settings.whichFixedStarsActive">{t("settings.whichFixedStarsActive")}</SectionLabel>
      {fs.catalog.length === 0 ? (
        <div className="py-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45">
          {t("settings.fixStarCatalogNotFound")}
        </div>
      ) : (
        <>
          <div className="mb-[var(--aries-form-field-gap)] flex items-center gap-[var(--aries-form-field-gap)]">
            <input
              data-aries-control-appearance="local"
              type="text"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder={t("settings.searchName")}
              className="h-[var(--aries-control-height-small)] flex-1 rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-foreground/40"
            />
            <input
              data-aries-control-appearance="local"
              type="text"
              value={codeQuery}
              onChange={(e) => setCodeQuery(e.target.value)}
              placeholder={t("settings.searchNomenclature")}
              className="h-[var(--aries-control-height-small)] flex-1 rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-foreground/40"
            />
          </div>

          {/* Header row */}
          <div className="flex h-[var(--aries-control-height-compact)] items-center gap-[var(--aries-form-field-gap)] border-b border-border/60 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
            <FixedStarSortHeader sortKey="selected" sort={sort} onSort={setSort} className="w-[var(--aries-control-height-micro)] shrink-0" ariaLabel={t("settings.sortSelected")} />
            <FixedStarSortHeader sortKey="name" sort={sort} onSort={setSort} className="min-w-0 flex-1" label={t("settings.name")} />
            <FixedStarSortHeader sortKey="code" sort={sort} onSort={setSort} className="w-24 shrink-0" label={t("settings.nomenclAbbr")} />
            <FixedStarSortHeader sortKey="lon" sort={sort} onSort={setSort} className="w-24 shrink-0" label={t("settings.longitude")} />
          </div>

          <div
            ref={viewportRef}
            className="relative overflow-y-auto"
            style={{ height: FIXSTAR_VIEWPORT_H }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: total * rowHeight, position: "relative" }}>
              {slice.map((item, i) => {
                const rowIndex = first + i;
                if (item.type === "group") {
                  return (
                    <div
                      key={`group-${item.kind}`}
                      className="absolute left-0 right-0 flex items-end border-b border-border/60 px-[var(--aries-control-gap-compact)] pb-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45"
                      style={{ top: rowIndex * rowHeight, height: rowHeight }}
                    >
                      {t(FIXED_STAR_GROUP_LABEL_KEYS[item.kind])}
                    </div>
                  );
                }
                const row = item.row;
                const checked = selected.has(row.code);
                const disabled = !row.code || (!checked && remaining <= 0);
                return (
                  <div
                    key={`${row.index}-${row.code}`}
                    className="absolute left-0 right-0 flex items-center gap-[var(--aries-form-field-gap)] border-b border-border/30 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)]"
                    style={{ top: rowIndex * rowHeight, height: rowHeight }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(row.code)}
                      className="h-3.5 w-3.5 shrink-0 accent-foreground/80 disabled:opacity-40"
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground/80">
                      {row.name || <span className="text-foreground/35">{t("settings.unnamed")}</span>}
                    </span>
                    <span className="w-24 shrink-0 truncate text-foreground/55">{row.code}</span>
                    <span className="w-24 shrink-0 truncate text-foreground/55">{row.lon}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-[var(--aries-form-field-gap)]">
              <ActionButton onClick={deselectAll} disabled={selected.size === 0}>{t("settings.deselectAll")}</ActionButton>
              <ActionButton onClick={restoreDefaults} disabled={isDefaultSelection}>{t("settings.fixedStarDefaults")}</ActionButton>
            </div>
            <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">
              {t("settings.fixStarSelectedCount", { selected: selected.size, remaining })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function FixedStarSortHeader({
  sortKey,
  sort,
  onSort,
  className,
  label,
  ariaLabel,
}: {
  sortKey: FixedStarSortKey;
  sort: FixedStarSortState;
  onSort: React.Dispatch<React.SetStateAction<FixedStarSortState>>;
  className?: string;
  label?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? t("settings.sortBy", { label: label ?? sortKey })}
      className={`flex min-w-0 items-center gap-[var(--aries-control-gap-compact)] text-left hover:text-foreground/80 ${className ?? ""}`}
      onClick={() =>
        onSort((current) => ({
          key: sortKey,
          ascending: current?.key === sortKey ? !current.ascending : true,
        }))
      }
    >
      {label ? <span className="min-w-0 truncate">{label}</span> : null}
      {active ? (
        sort.ascending ? (
          <ArrowUp className="size-3 shrink-0" />
        ) : (
          <ArrowDown className="size-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}

const FIXED_STAR_KIND_ORDER: readonly FixedStarKind[] = ["star", "deepSky", "reference"];
const FIXED_STAR_GROUP_LABEL_KEYS: Record<FixedStarKind, string> = {
  star: "settings.fixedStarGroupStars",
  deepSky: "settings.fixedStarGroupDeepSky",
  reference: "settings.fixedStarGroupReference",
};

type FixedStarListItem =
  | { type: "group"; kind: FixedStarKind }
  | { type: "row"; row: FixedStarCatalogRow };

// Stars first, then deep-sky objects, then Swiss reference points, each keeping
// the active sort. Headings appear only when more than one stratum is listed.
function groupFixedStarRows(rows: FixedStarCatalogRow[]): FixedStarListItem[] {
  const groups = FIXED_STAR_KIND_ORDER
    .map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) }))
    .filter((group) => group.rows.length > 0);
  const headed = groups.length > 1;
  return groups.flatMap(({ kind, rows: groupRows }) => [
    ...(headed ? [{ type: "group" as const, kind }] : []),
    ...groupRows.map((row) => ({ type: "row" as const, row })),
  ]);
}

function sortFixedStarRows(
  rows: FixedStarCatalogRow[],
  sort: FixedStarSortState,
  selected: Set<string>,
): FixedStarCatalogRow[] {
  if (!sort) return rows;
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const cmp = compareFixedStarSortValue(
        fixedStarSortValue(a.row, sort.key, selected),
        fixedStarSortValue(b.row, sort.key, selected),
      );
      if (cmp !== 0) return sort.ascending ? cmp : -cmp;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ row }) => row);
}

function fixedStarSortValue(
  row: FixedStarCatalogRow,
  key: FixedStarSortKey,
  selected: Set<string>,
): string | number {
  if (key === "selected") return selected.has(row.code) ? 0 : 1;
  if (key === "lon") return row.lonValue;
  if (key === "code") return row.code;
  return row.name;
}

function compareFixedStarSortValue(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// ---------------------------------------------------------------------------
// Tab — Asteroids. Named objects use the compact Swiss catalogue index; an
// exact MPC number addresses any numbered asteroid. Non-bundled ephemerides are
// installed only when selected, before the canonical options patch is sent.
// ---------------------------------------------------------------------------

const ASTEROID_OVERSCAN = 8;
type AsteroidSortKey = "number" | "name";
type AsteroidSortState = { key: AsteroidSortKey; ascending: boolean };

function AsteroidsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const asteroidOptions = opts.asteroids;
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<AsteroidCatalogRow[]>(asteroidOptions.selectedRows);
  const browseRowsRef = React.useRef(new Map(
    asteroidOptions.selectedRows.map((row) => [row.number, row]),
  ));
  const [sort, setSort] = React.useState<AsteroidSortState>({ key: "number", ascending: true });
  const [loading, setLoading] = React.useState(false);
  const [installing, setInstalling] = React.useState<number | null>(null);
  const [installError, setInstallError] = React.useState<number | null>(null);
  const [selectionBusy, setSelectionBusy] = React.useState(false);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const selectionRef = React.useRef(asteroidOptions.selectedNumbers);
  const selectionVersionRef = React.useRef(0);
  const rowHeight = useListRowHeight("dense");
  const selected = React.useMemo(
    () => new Set(asteroidOptions.selectedNumbers),
    [asteroidOptions.selectedNumbers],
  );

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewportHeight(viewport.clientHeight));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    selectionRef.current = asteroidOptions.selectedNumbers;
  }, [asteroidOptions.selectedNumbers]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchAsteroidCatalog(query, controller.signal)
        .then((payload) => {
          if (query.trim()) {
            setRows(payload.rows);
          } else {
            for (const row of payload.rows) browseRowsRef.current.set(row.number, row);
            setRows([...browseRowsRef.current.values()]);
          }
        })
        .catch((error) => {
          if ((error as { name?: string }).name !== "AbortError") {
            console.error("[asteroid-catalog]", error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  React.useEffect(() => {
    let changed = false;
    for (const row of asteroidOptions.selectedRows) {
      if (!browseRowsRef.current.has(row.number)) changed = true;
      browseRowsRef.current.set(row.number, row);
    }
    if (changed && !query.trim()) setRows([...browseRowsRef.current.values()]);
  }, [asteroidOptions.selectedRows, query]);

  const visible = React.useMemo(() => {
    return [...rows].sort((left, right) => {
      const selectionOrder = Number(selected.has(right.number)) - Number(selected.has(left.number));
      if (selectionOrder !== 0) return selectionOrder;
      const compared = sort.key === "number"
        ? left.number - right.number
        : left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      if (compared !== 0) return sort.ascending ? compared : -compared;
      return left.number - right.number;
    });
  }, [rows, selected, sort]);

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [query, sort]);

  const commitSelection = (numbers: number[], installedRow?: AsteroidCatalogRow) => {
    selectionRef.current = numbers;
    selectionVersionRef.current += 1;
    if (installedRow) browseRowsRef.current.set(installedRow.number, installedRow);
    sendPatch(
      { asteroids: { selectedNumbers: numbers } },
      {
        ...opts,
        asteroids: {
          ...asteroidOptions,
          selectedNumbers: numbers,
          selectedRows: numbers.map((number) => browseRowsRef.current.get(number))
            .filter((row): row is AsteroidCatalogRow => row !== undefined),
        },
      },
    );
  };

  const toggle = async (row: AsteroidCatalogRow) => {
    if (installing !== null && !row.installed) return;
    setInstallError(null);
    const current = selectionRef.current;
    if (current.includes(row.number)) {
      commitSelection(current.filter((number) => number !== row.number));
      return;
    }
    if (current.length >= asteroidOptions.maxSelected) return;
    if (row.installed) {
      browseRowsRef.current.set(row.number, row);
      commitSelection([...current, row.number], row);
      return;
    }
    const selectionVersion = selectionVersionRef.current;
    setInstalling(row.number);
    try {
      const installedRow = await installAsteroidEphemeris(row.number);
      browseRowsRef.current.set(row.number, installedRow);
      if (selectionVersionRef.current === selectionVersion) {
        commitSelection([...selectionRef.current, row.number], installedRow);
      }
      setRows((current) => current.map((item) => (
        item.number === row.number ? { ...item, installed: true } : item
      )));
    } catch (error) {
      console.error("[asteroid-install]", error);
      setInstallError(row.number);
    } finally {
      setInstalling(null);
    }
  };

  const setOrb = (field: "conjunctionOrb" | "oppositionOrb", value: number) => {
    sendPatch(
      { asteroids: { [field]: value } },
      { ...opts, asteroids: { ...asteroidOptions, [field]: value } },
    );
  };

  const total = visible.length;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - ASTEROID_OVERSCAN);
  const count = Math.ceil(viewportHeight / rowHeight) + ASTEROID_OVERSCAN * 2;
  const slice = visible.slice(first, first + count);
  useFixedRowHeightAnchor(viewportRef, total, rowHeight);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
      <div className="flex shrink-0 flex-col">
        <SectionLabel searchAnchor="section:settings.asteroidAspectOrbs">{t("settings.asteroidAspectOrbs")}</SectionLabel>
        <Row searchAnchor="settings.conjunctionOrb" label={t("settings.conjunctionOrb")}>
          <NumberField
            value={asteroidOptions.conjunctionOrb}
            step={0.5}
            min={0}
            max={6}
            onCommit={(value) => setOrb("conjunctionOrb", value)}
          />
        </Row>
        <Row searchAnchor="settings.oppositionOrb" label={t("settings.oppositionOrb")}>
          <NumberField
            value={asteroidOptions.oppositionOrb}
            step={0.5}
            min={0}
            max={6}
            onCommit={(value) => setOrb("oppositionOrb", value)}
          />
        </Row>

        <SectionLabel searchAnchor="section:settings.whichAsteroidsActive">{t("settings.whichAsteroidsActive")}</SectionLabel>
        <AsteroidSelectionControls options={asteroidOptions} disabled={installing !== null}
          onCommand={async command => {
            selectionVersionRef.current += 1;
            setSelectionBusy(true);
            setInstallError(null);
            try {
              return await sendPatch({ asteroidSelection: command }, opts) !== false;
            } finally { setSelectionBusy(false); }
          }} />
        <input
          data-aries-control-appearance="local"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.searchAsteroidNameOrNumber")}
          className="mb-[var(--aries-form-field-gap)] h-[var(--aries-control-height-small)] rounded-[var(--aries-radius-control-compact)] border border-border/60 bg-transparent px-[var(--aries-control-padding-x-compact)] text-[length:var(--aries-font-size-base)] outline-none focus:border-foreground/40"
        />
        <div className="mb-[var(--aries-form-field-gap)] text-[length:var(--aries-font-size-small)] text-foreground/45">
          {t("settings.asteroidDownloadNote")}
        </div>

        <div className="flex h-[var(--aries-control-height-compact)] items-center gap-[var(--aries-form-field-gap)] border-b border-border/60 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-section)] font-medium text-foreground/45">
          <span className="w-[var(--aries-control-height-micro)] shrink-0" />
          {(["number", "name"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-label={t("settings.sortBy", { label: t(`settings.${key}`) })}
              onClick={() => setSort((current) => ({
                key,
                ascending: current.key === key ? !current.ascending : true,
              }))}
              className={`flex min-w-0 items-center gap-[var(--aries-control-gap-compact)] text-left hover:text-foreground/80 ${key === "number" ? "w-20 shrink-0" : "flex-1"}`}
            >
              <span className="truncate">{t(`settings.${key}`)}</span>
              {sort.key === key ? sort.ascending
                ? <ArrowUp className="size-3 shrink-0" />
                : <ArrowDown className="size-3 shrink-0" /> : null}
            </button>
          ))}
          <span className="w-24 shrink-0 text-right">{loading ? t("settings.loading") : ""}</span>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: total * rowHeight, position: "relative" }}>
          {slice.map((row, index) => {
            const checked = selected.has(row.number);
            const busy = installing === row.number;
            const disabled = selectionBusy || (installing !== null && !row.installed)
              || (!checked && selected.size >= asteroidOptions.maxSelected);
            return (
              <div
                key={row.number}
                className="absolute left-0 right-0 flex items-center gap-[var(--aries-form-field-gap)] border-b border-border/30 px-[var(--aries-control-gap-compact)] text-[length:var(--aries-font-size-base)]"
                style={{ top: (first + index) * rowHeight, height: rowHeight }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => void toggle(row)}
                  className="h-3.5 w-3.5 shrink-0 accent-foreground/80 disabled:opacity-40"
                />
                <span className="w-20 shrink-0 tabular-nums text-foreground/55">{row.number}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/80">{row.name}</span>
                <span className="w-24 shrink-0 text-right text-[length:var(--aries-font-size-small)] text-foreground/40">
                  {busy
                    ? t("settings.downloading")
                    : row.bundled
                      ? t("settings.bundled")
                      : row.installed
                        ? t("settings.downloaded")
                        : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {installError !== null ? (
        <div className="mt-2 shrink-0 text-[length:var(--aries-font-size-small)] text-destructive">
          {t("settings.asteroidInstallFailed", { number: installError })}
        </div>
      ) : null}
      <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-[var(--aries-form-field-gap)]">
        <div className="flex flex-wrap items-center gap-[var(--aries-form-field-gap)]">
          <ActionButton disabled={selectionBusy} onClick={() => commitSelection([])}>{t("settings.deselectAll")}</ActionButton>
          <ActionButton disabled={selectionBusy} onClick={() => commitSelection(asteroidOptions.defaultNumbers)}>{t("settings.restoreDefaultSelection")}</ActionButton>
        </div>
        <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">
          {t("settings.asteroidSelectedCount", {
            selected: selected.size,
            remaining: asteroidOptions.maxSelected - selected.size,
          })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Relationship Charts (compositeoptsdlg ASC method + synastry launcher
// radio, morin.py:20167-20228).
// ---------------------------------------------------------------------------

function RelationshipChartsTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const r = opts.relationshipCharts;
  const cat = opts.catalog;
  const patch = (fields: Partial<typeof r>) => {
    sendPatch(
      { relationshipCharts: fields },
      { ...opts, relationshipCharts: { ...r, ...fields } },
    );
  };
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.compositeConstruction">{t("settings.compositeConstruction")}</SectionLabel>
      <Row label={cat.compositeMCNote}>
        <span className="text-[length:var(--aries-font-size-small)] text-foreground/45">{t("settings.fixed")}</span>
      </Row>
      <Row label={cat.compositeASCLabel}>
        <Select
          value={r.composite_method}
          width={260}
          onChange={(v) => patch({ composite_method: Number(v) })}
        >
          {cat.compositeMethods.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>

      <SectionLabel searchAnchor="section:settings.launcher">{t("settings.launcher")}</SectionLabel>
      <Row searchAnchor="settings.openFirst" label={t("settings.openFirst")}>
        <Select
          value={r.synastry_opens_composite_first ? "1" : "0"}
          width={180}
          onChange={(v) => patch({ synastry_opens_composite_first: v === "1" })}
        >
          {cat.relationshipLauncherModes.map((m) => (
            <option key={String(m.value)} value={m.value ? "1" : "0"}>{m.label}</option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — Languages (langsdlg.LanguagesDlg). The daemon's persisted options.langid
// is canonical. Changing it rebinds mtexts, refreshes chart/inspector payloads,
// and bumps the frontend locale provider so React and native-menu labelKeys
// re-render from the same selected language.
// ---------------------------------------------------------------------------

function LanguagesTab({ opts, sendPatch }: TabProps) {
  const t = useT();
  const l = opts.languages;
  return (
    <div className="flex flex-col gap-0">
      <SectionLabel searchAnchor="section:settings.language">{t("settings.language")}</SectionLabel>
      <Row searchAnchor="settings.activeLanguage" label={t("settings.activeLanguage")}>
        <Select
          value={l.langid}
          width={180}
          onChange={(v) =>
            sendPatch(
              { languages: { langid: Number(v) } },
              { ...opts, languages: { ...l, langid: Number(v) } },
            )
          }
        >
          {l.available.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>
      </Row>
      <p className="mt-2 text-[length:var(--aries-font-size-small)] leading-relaxed text-foreground/45">
        {t("settings.languageHelp")}
      </p>
    </div>
  );
}
