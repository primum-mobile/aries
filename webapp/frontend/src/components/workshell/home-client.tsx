"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClipboardPaste,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import {
  WorkspaceContent,
  type ModeHintRailProps,
} from "@/components/workshell/workspace-content";
import { CHART_UPPER_NAVIGATION_BAR_ENABLED } from "@/components/workshell/chart-navigation-bar-flag";
import { WorkspaceFrame } from "@/components/workshell/workspace-frame";
import { BrowserMenuBar } from "@/components/workshell/browser-menu-bar";
import { findChartLaunchParent } from "@/components/workshell/chart-launch-parent";
import type { EditTarget } from "@/components/workshell/chart-editor-dialog";
import { isSettingsTabId, type SettingsTabId } from "@/components/workshell/settings-dialog";
import { useSurveilStore } from "@/stores/surveil-store";
import { useHelpAboutStore } from "@/stores/help-about-store";
import { useLicenseDialogStore } from "@/stores/license-dialog-store";
import { useThemeStore } from "@/stores/theme-store";
import {
  AmbientSpotlight,
  useAmbientSpotlightTriggers,
} from "@/components/workshell/ambient-spotlight";
import { ThemeProvider } from "@/components/workshell/theme-provider";
import { LicenseStartupController } from "@/components/workshell/license-startup-controller";
import {
  ShellMenuListener,
  syncShellMenuEnablement,
  syncShellMenuChecked,
  syncShellMenuLabels,
  type AriesMenuCommand,
  type ShellMenuCheckedState,
  type ShellMenuLabelState,
  type ShellMenuEnabledState,
} from "@/components/workshell/shell-menu-listener";
import {
  corpusDisciplinesCached,
  cycleSecondaryView,
  clearStartupChart,
  toggleHouses,
  toggleMinorAspects,
  applyThemePreset,
  patchOptions,
  workspaceToggleComparison,
  fetchOptions,
  fetchWorkspaceManifest,
  fetchStartupRestoreState,
  fetchDocumentSnapshot,
  fetchEditorCursorSeed,
  fetchRecentCharts,
  isUnknownDocumentSnapshotError,
  fetchRevolutionLocationPredicate,
  fetchTimedChartShowRadixDefault,
  fetchProgressionLaunchPredicate,
  fetchGenericTablePayload,
  ioSaveChart,
  quitPreflight,
  openRecentChart,
  decodeBase64Bytes,
  exportActiveChart,
  exportActiveChartBytes,
  exportRenderedChart,
  exportRenderedChartBytes,
  importCharts,
  listCollections,
  setCurrentAsStartupChart,
  setRestoreOpenCharts,
  workspaceActivate,
  workspaceClose,
  workspaceClosePreflight,
  workspaceMove,
  workspaceNavigateKey,
  workspaceOpen,
  workspaceOpenSynastry,
  spotlightExecute,
  resolvePlace,
  fetchCorpusPacks,
  setCorpusPackActive,
  type NativeMenuNode,
  type OptionsPayload,
  type OptionsPatch,
  type ExportKind,
  type ImportKind,
  type ImportSummary,
  type ChartCollection,
  type PlaceCandidate,
  type PlanetaryReturnBody,
  type RecentChartItem,
  type SpotlightActionId,
  type SpotlightPreview,
  type SupplementaryBindingPayload,
  type QuitPreflightPrompt,
} from "@/lib/daemon/client";
import type { ChartRenderSnapshot } from "@/lib/chart/types";
import {
  fetchCachedDocumentSnapshot,
  getDocumentSnapshot,
  rememberDocumentSnapshot,
} from "@/lib/chart/document-snapshot-cache";
import { perfNow, recordChartPerf, recordStartupPerfOnce } from "@/lib/chart/perf";
import {
  canReusePaintedDocumentCanvas,
  wasDocumentSnapshotPainted,
} from "@/lib/chart/painted-snapshot-registry";
import {
  localizedWorkspaceDocumentTitle,
  useWorkspaceStore,
  type SupplementaryKind,
  type WorkspaceDocument,
} from "@/stores/workspace-store";
import {
  findDaemonRadixAncestor,
  useChartLaunchers,
  useDaemonWorkspaceActions,
  useDaemonWorkspaceConnection,
  useDaemonWorkspaceView,
  applyImmediateWorkspaceCommandResult,
} from "@/stores/daemon-workspace-adapter";
import {
  reconcileDaemonWorkspace,
  useDaemonWorkspaceStore,
} from "@/stores/daemon-workspace-store";
import {
  beginWorkspaceSnapshotCommand,
  hasPendingWorkspaceSnapshotCommand,
  waitForWorkspaceSnapshotCommands,
} from "@/stores/workspace-command-snapshot-gate";
import {
  postWorkspaceCommandFailed,
  postWorkspaceCommandResult,
  postWorkspaceCommandStarted,
  subscribeWorkspaceCommandBus,
  type WorkspaceCommandBusMessage,
  type WorkspaceCommandRequestPayload,
} from "@/stores/workspace-command-bus";
import { warmChartFonts } from "@/lib/chart/draw-chart";
import { renderRegisteredChartExport } from "@/lib/chart/chart-export-registry";
import { useShortcut } from "@/shortcuts/use-shortcut";
import { useManifestShortcutDispatch } from "@/shortcuts/manifest-shortcuts";
import { noteSpotlightDismissed } from "@/shortcuts/spotlight-cooldown";
import {
  enabledActionIds,
  supplementaryActionIds,
  useWorkspaceManifest,
  refreshWorkspaceManifest,
} from "@/stores/use-workspace-manifest";
import {
  openChartPickerWindow,
  prewarmChartPickerWindowApi,
} from "@/lib/shell/chart-picker-window";
import { safeShellUnlisten } from "@/lib/shell/unlisten";
import { confirmQuit, resolveShellHost, type ShellOpenSelection } from "@/lib/shell-host";
import { tableToAlignedText, tableToTsv } from "@/components/workshell/generic-table-view";
import { exportTablePayloadPdf, writeTablePayloadPdf } from "@/components/workshell/table-pdf-export";
import { exportTextContent } from "@/components/workshell/text-export";
import {
  CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS,
  prewarmChartPickerRows,
} from "@/lib/chart-picker/rows-cache";
import { isAbortError, isTransientDaemonFetchError } from "@/lib/abort-error";
import {
  closeInspectorAndNotes,
  closeWorkspaceTransientPanes,
} from "@/components/workshell/workspace-ui-commands";
import { useFrameLayoutStore } from "@/stores/frame-layout-store";
import { useT, useTFallback, useLocale } from "@/lib/i18n/i18n";

function recoverUnknownDocumentSnapshot(error: unknown): boolean {
  if (!isUnknownDocumentSnapshotError(error)) return false;
  void reconcileDaemonWorkspace();
  return true;
}

const SettingsDialog = dynamic(
  () => import("@/components/workshell/settings-dialog").then((mod) => mod.SettingsDialog),
  { loading: () => null },
);
const ChartEditorDialog = dynamic(
  () => import("@/components/workshell/chart-editor-dialog").then((mod) => mod.ChartEditorDialog),
  { loading: () => null },
);
const SaveToCollectionDialog = dynamic(
  () => import("@/components/workshell/save-to-collection-dialog").then((mod) => mod.SaveToCollectionDialog),
  { loading: () => null },
);
const SurveilStudiesDialog = dynamic(
  () => import("@/components/workshell/surveil-studies-dialog").then((mod) => mod.SurveilStudiesDialog),
  { loading: () => null },
);
const AboutDialog = dynamic(
  () => import("@/components/workshell/about-dialog").then((mod) => mod.AboutDialog),
  { loading: () => null },
);
const LicenseDialog = dynamic(
  () => import("@/components/workshell/license-dialog").then((mod) => mod.LicenseDialog),
  { loading: () => null },
);
type ReturnRelocationKind =
  | "solar-revolution"
  | "lunar-revolution"
  | "planetary-return";

type PickerState =
  | {
      mode: "planetary-return-body";
      parentRadixId: string;
      when?: string;
      bodies: PlanetaryReturnBody[];
    }
  | {
      mode: "revolution-location";
      parentRadixId: string;
      kind: ReturnRelocationKind;
      when?: string;
      planetType?: number;
      planetLabel?: string;
    }
  | null;

type RevolutionLocationRequest = Extract<
  NonNullable<PickerState>,
  { mode: "revolution-location" }
>;

const CHART_INDEPENDENT_COMMANDS = new Set([
  "appearance.toggle",
  "menu.ayanamsha",
  "menu.import.charts",
  "menu.import.hor-folder",
  "menu.import.jsonl",
  "menu.import.sfcht",
  "menu.import.aaf",
  "menu.import.aaf-paste",
  "menu.colors",
  "menu.help.about",
  "menu.help.features",
  "menu.help.help",
  "menu.help.license",
  "menu.house-system",
  "menu.lunar-mansions",
  "menu.options.almutens",
  "menu.options.arabic-parts",
  "menu.options.default-location",
  "menu.options.dignities",
  "menu.options.eclipses",
  "menu.options.fixed-stars",
  "menu.options.languages",
  "menu.options.nodes",
  "menu.options.orbs",
  "menu.options.primary-directions",
  "menu.options.quick-charts",
  "menu.options.relationship-charts",
  "menu.options.revolutions",
  "menu.options.speculum",
  "menu.options.step-alerts",
  "menu.options.syzygy",
  "menu.options.time-lords",
  "menu.restore-open-charts",
  "menu.startup.clear",
  "menu.symbols",
  "toggle-inspector",
  "new",
  "now",
  "open",
]);

const ROOT_RADIX_COMMANDS = new Set([
  "menu.data",
]);

const SAVE_CHART_COMMANDS = new Set([
  "menu.save",
  "menu.save.current",
  "menu.save.as",
]);

// Tables menu command id → daemon tables_service.TABLES id. Only rows whose
// daemon builder exists are mapped (the native-menu manifest marks exactly
// these rows status:"live"); unmapped rows stay deferred with their citations.
const TABLE_ID_BY_MENU_COMMAND: Record<string, string> = {
  "menu.table.positions": "positions",
  "menu.table.strip": "strip",
  "menu.table.antiscia": "antiscia",
  "menu.table.aspects": "aspects",
  "menu.table.zodiacal-parallels": "zodpars",
  "menu.table.speeds": "speeds",
  "menu.table.rise-set": "rise_set",
  "menu.table.planetary-hours": "planetary_hours",
  "menu.table.phasis": "phasis",
  "menu.table.midpoints": "midpoints",
  "menu.table.asteroids": "asteroids",
  "menu.table.arabic-parts": "arabic_parts",
  "menu.table.misc": "misc",
  "menu.table.almuten-chart": "almuten_chart",
  "menu.table.almuten-points": "almuten_zodiacal",
  "menu.table.almuten-topical": "almuten_topical",
  "menu.table.fixed-stars": "fixed_stars",
  "menu.table.fixed-star-aspects": "fixed_stars_aspects",
  "menu.table.fixed-star-parallels": "fixed_stars_parallels",
  "menu.table.eclipses": "eclipses",
  "menu.table.circumambulation": "circumambulation",
  "menu.table.paranatellonta": "paranatellonta",
  "menu.table.angle-at-birth": "angle_at_birth",
  "menu.table.profections": "profections_table",
  "menu.table.firdaria": "firdaria",
  "menu.table.decennials": "decennials",
  "menu.table.triplicity-directions": "triplicity_directions",
  "menu.table.zodiacal-releasing": "zodiacal_releasing",
  "menu.table.mundane-positions": "mundane_positions",
  "menu.table.dodecatemoria": "dodecatemoria",
  "menu.table.user-speculum": "user_speculum",
  "menu.table.fixed-star-angle-directions": "fixedstar_angle_directions",
  "menu.table.monthly-transits": "monthly_transits",
};

function exportBaseName(doc: WorkspaceDocument | null): string {
  const raw = doc?.title.replace(/\s*\*$/, "").trim() || "aries-chart";
  return raw.replace(/[\\/:*?"<>|]+/g, "_") || "aries-chart";
}

function runtimeActionIdForShellMenu(id: string): string {
  if (id.startsWith("planetary-return:")) return "planetary-return";
  return id;
}

const QUICK_OPTIONS_PREFIX = "quick.options.";
const MINOR_ASPECT_INDICES = new Set([1, 2, 4, 7, 8, 9, 11]);
const FIXED_STAR_SUBMODE_VALUES = new Set([1, 6, 7, 8]);

const NATIVE_QUICK_DISPLAY_TOGGLES = [
  "houses",
  "housesystem",
  "showchiron",
  "showvertex",
  "shownodes",
  "showlof",
  "showprenatalsyzygy",
  "positions",
  "intables",
  "showdecans",
  "topocentric",
  "morin_antiscia",
  "aspects",
  "symbols",
  "showaspectstovertex",
  "aspectstonodes",
  "showaspectstolof",
  "showlofouterring",
  "aspect_thickness_mode",
  "aspect_opacity_mode",
  "aspect_flag_show_parties",
  "showfixstarsnodes",
  "showfixstarshcs",
  "showfixstarslof",
  "extendedradixstations",
  "showcazimi",
  "showeclipseoverlay",
  "planetarydayhour",
  "information",
  "showseconds",
  "show_help_chip",
  "usetradfixstarnamespdlist",
] as const;

function quickCommandValue(command: string, prefix: string): string | null {
  return command.startsWith(prefix) ? command.slice(prefix.length) : null;
}

function nativeQuickOptionPatch(command: string, opts: OptionsPayload): OptionsPatch | null {
  const display = opts.display as Record<string, unknown>;
  const boolDisplay = (attr: string): OptionsPatch => {
    const value = !Boolean(display[attr]);
    const patch: Record<string, unknown> = { [attr]: value };
    if (attr === "showvertex" && !value) patch.showaspectstovertex = false;
    if (attr === "shownodes" && !value) patch.aspectstonodes = false;
    if (attr === "showlof" && !value) {
      patch.showaspectstolof = false;
      patch.showlofouterring = false;
    }
    return { display: patch as Partial<OptionsPayload["display"]> };
  };

  if (command === "toggle-presentation-cursor") {
    return boolDisplay("presentation_cursor");
  }

  let value = quickCommandValue(command, "quick.options.display:");
  if (value) return boolDisplay(value);

  value = quickCommandValue(command, "quick.options.node:");
  if (value !== null) return { planetsPoints: { meannode: value === "1" } };

  value = quickCommandValue(command, "quick.options.ayanamsha:");
  if (value !== null) return { ayanamsha: { ayanamsha: Number(value) } };

  value = quickCommandValue(command, "quick.options.house:");
  if (value !== null) return { houseSystem: { hsys: value } };

  value = quickCommandValue(command, "quick.options.transcendental:");
  if (value !== null) {
    const index = Number(value);
    if (!Number.isInteger(index)) return null;
    const next = [...opts.display.transcendental];
    next[index] = !Boolean(next[index]);
    return { display: { transcendental: next } };
  }

  value = quickCommandValue(command, "quick.options.aspect:");
  if (value !== null) {
    const index = Number(value);
    if (!Number.isInteger(index)) return null;
    const next = [...opts.display.aspect];
    const enabled = !Boolean(next[index]);
    next[index] = enabled;
    return {
      display: {
        aspect: next,
        ...(enabled && MINOR_ASPECT_INDICES.has(index) ? { traditionalaspects: false } : {}),
      },
    };
  }

  if (command === "quick.options.terms") {
    const enabled = !Boolean(opts.display.showterms);
    return { display: { showterms: enabled }, dignities: { showterms: enabled } };
  }

  if (command === "quick.options.traditional-aspects") {
    const enabled = !Boolean(opts.display.traditionalaspects);
    const patch: Partial<OptionsPayload["display"]> = { traditionalaspects: enabled };
    if (enabled) {
      const next = [...opts.display.aspect];
      for (const index of MINOR_ASPECT_INDICES) next[index] = false;
      patch.aspect = next;
    }
    return { display: patch };
  }

  if (command === "quick.options.exclusive-aspects") {
    const enabled = !Boolean(opts.display.exclusive_aspects_on_click);
    return {
      display: {
        exclusive_aspects_on_click: enabled,
        ...(!enabled
          ? {
              exclusive_aspects_on_click_show_minor: false,
              exclusive_aspects_on_click_traditional: false,
            }
          : {}),
      },
    };
  }

  if (command === "quick.options.exclusive-minor") {
    const enabled = !Boolean(opts.display.exclusive_aspects_on_click_show_minor);
    return {
      display: {
        exclusive_aspects_on_click_show_minor: enabled,
        ...(enabled ? { exclusive_aspects_on_click_traditional: false } : {}),
      },
    };
  }

  if (command === "quick.options.exclusive-traditional") {
    const enabled = !Boolean(opts.display.exclusive_aspects_on_click_traditional);
    return {
      display: {
        exclusive_aspects_on_click_traditional: enabled,
        ...(enabled ? { exclusive_aspects_on_click_show_minor: false } : {}),
      },
    };
  }

  value = quickCommandValue(command, "quick.options.fixstars:");
  if (value !== null) {
    const mode = Number(value);
    return {
      display: {
        showfixstars: mode,
        ...(!FIXED_STAR_SUBMODE_VALUES.has(mode)
          ? { showfixstarsnodes: false, showfixstarshcs: false, showfixstarslof: false }
          : {}),
      },
    };
  }

  value = quickCommandValue(command, "quick.options.phasis:");
  if (value !== null) return { display: { phasismode: Number(value) } };
  value = quickCommandValue(command, "quick.options.cazimi:");
  if (value !== null) return { display: { cazimimode: Number(value) } };
  value = quickCommandValue(command, "quick.options.synodic:");
  if (value !== null) return { display: { synodicmode: Number(value) } };
  value = quickCommandValue(command, "quick.options.layout:");
  if (value !== null) return { display: { theme: Number(value) } };
  value = quickCommandValue(command, "quick.options.anglo-dense-label-layout:");
  if (value === "leader-columns" || value === "routed-cusps") {
    return { display: { anglo_dense_label_layout: value } };
  }

  value = quickCommandValue(command, "quick.options.fortuna:");
  if (value !== null) return { planetsPoints: { lotoffortune: Number(value) } };
  value = quickCommandValue(command, "quick.options.syzygy:");
  if (value !== null) return { planetsPoints: { syzmoon: Number(value) } };

  value = quickCommandValue(command, "quick.options.quickcharts:");
  if (value !== null) {
    const current = Boolean((opts.quickCharts as Record<string, unknown>)[value]);
    return { quickCharts: { [value]: !current } as Partial<OptionsPayload["quickCharts"]> };
  }

  value = quickCommandValue(command, "quick.options.progressed-angle:");
  if (value !== null) return { quickCharts: { progressed_angle_method: Number(value) } };
  value = quickCommandValue(command, "quick.options.progression-day:");
  if (value !== null) return { quickCharts: { progression_day_type: Number(value) } };
  value = quickCommandValue(command, "quick.options.launch-mode:");
  if (value !== null) return { quickCharts: { secondary_progression_launch_mode: Number(value) } };

  value = quickCommandValue(command, "quick.options.solar-year:");
  if (value !== null) return { revolutions: { revolutions_solaryearmode: Number(value) } };
  value = quickCommandValue(command, "quick.options.solar-location:");
  if (value !== null) return { revolutions: { revolutions_solarlocationmode: Number(value) } };
  value = quickCommandValue(command, "quick.options.lunar-location:");
  if (value !== null) return { revolutions: { revolutions_lunarlocationmode: Number(value) } };
  value = quickCommandValue(command, "quick.options.planetary-location:");
  if (value !== null) return { revolutions: { revolutions_planetslocationmode: Number(value) } };
  value = quickCommandValue(command, "quick.options.return-mode:");
  if (value === "tithi_pravesha") {
    const current = opts.revolutions.revolutions_solarreturnmode === value;
    return { revolutions: { revolutions_solarreturnmode: current ? "standard" : value } };
  }
  if (value === "soli_lunar" || value === "jonas_arc") {
    const current = opts.revolutions.revolutions_lunarreturnmode === value;
    return { revolutions: { revolutions_lunarreturnmode: current ? "lunar" : value } };
  }
  value = quickCommandValue(command, "quick.options.revolutions:");
  if (value !== null) {
    const current = Boolean((opts.revolutions as Record<string, unknown>)[value]);
    return { revolutions: { [value]: !current } as Partial<OptionsPayload["revolutions"]> };
  }

  value = quickCommandValue(command, "quick.options.profections:");
  if (value !== null) {
    const current = Boolean((opts.profections as Record<string, unknown>)[value]);
    return { profections: { [value]: !current } };
  }

  value = quickCommandValue(command, "quick.options.firdaria:");
  if (value !== null) return { firdaria: { isfirbonatti: value === "1" } };

  value = quickCommandValue(command, "quick.options.stepalerts:");
  if (value !== null) {
    const current = Boolean((opts.stepAlerts as Record<string, unknown>)[value]);
    return { stepAlerts: { [value]: !current } as Partial<OptionsPayload["stepAlerts"]> };
  }

  value = quickCommandValue(command, "quick.options.mansions:");
  if (value !== null) return { lunarMansions: { manazil_zodiac: value } };

  value = quickCommandValue(command, "quick.options.eclipse:");
  if (value !== null) return { eclipses: { eclipse_chart_moment: value } };

  value = quickCommandValue(command, "quick.options.relationship:");
  if (value !== null) {
    return { relationshipCharts: { synastry_opens_composite_first: value === "1" } };
  }

  value = quickCommandValue(command, "quick.options.colors:");
  if (value === "follow_os_theme") {
    return { colors: { follow_os_theme: !opts.colors.follow_os_theme } };
  }

  return null;
}

function nativeQuickOptionCheckedStates(opts: OptionsPayload): ShellMenuCheckedState[] {
  const states: ShellMenuCheckedState[] = [];
  const check = (id: string, checked: boolean) => states.push({ id, checked });
  const radio = (prefix: string, values: Array<string | number | boolean>, selected: string | number | boolean) => {
    for (const value of values) check(`${prefix}:${String(value)}`, String(value) === String(selected));
  };

  radio("quick.options.node", [1, 0], opts.planetsPoints.meannode ? 1 : 0);
  radio("quick.options.ayanamsha", opts.ayanamsha.available.map((entry) => entry.index), opts.ayanamsha.ayanamsha);
  radio("quick.options.house", opts.houseSystem.available.map((entry) => entry.code), opts.houseSystem.hsys);

  for (const attr of NATIVE_QUICK_DISPLAY_TOGGLES) {
    check(`quick.options.display:${attr}`, Boolean(opts.display[attr]));
  }
  for (const section of opts.settingsRegistry.mirroredSections) {
    for (const setting of section.settings) {
      if (setting.group !== "display" || setting.kind !== "boolean") continue;
      check(
        `quick.options.${setting.group}:${setting.field}`,
        Boolean(opts.display[setting.field]),
      );
    }
  }
  check("quick.options.terms", Boolean(opts.display.showterms));
  check("quick.options.traditional-aspects", Boolean(opts.display.traditionalaspects));
  check("quick.options.exclusive-aspects", Boolean(opts.display.exclusive_aspects_on_click));
  check("quick.options.exclusive-minor", Boolean(opts.display.exclusive_aspects_on_click_show_minor));
  check("quick.options.exclusive-traditional", Boolean(opts.display.exclusive_aspects_on_click_traditional));

  opts.display.transcendental.forEach((enabled, index) => {
    check(`quick.options.transcendental:${index}`, Boolean(enabled));
  });
  opts.display.aspect.forEach((enabled, index) => {
    check(`quick.options.aspect:${index}`, Boolean(enabled));
  });

  radio("quick.options.fixstars", opts.catalog.fixstarsModes.map((entry) => entry.value), opts.display.showfixstars);
  radio("quick.options.phasis", opts.catalog.phasisModes.map((entry) => entry.value), opts.display.phasismode);
  radio("quick.options.cazimi", opts.catalog.cazimiModes.map((entry) => entry.value), opts.display.cazimimode);
  radio("quick.options.synodic", opts.catalog.synodicModes.map((entry) => entry.value), opts.display.synodicmode);
  radio("quick.options.layout", opts.catalog.themeLayouts.map((entry) => entry.value), opts.display.theme);
  radio(
    "quick.options.anglo-dense-label-layout",
    opts.catalog.angloDenseLabelLayouts.map((entry) => entry.value),
    opts.display.anglo_dense_label_layout,
  );
  radio("quick.options.fortuna", opts.catalog.fortunaModes.map((entry) => entry.value), opts.planetsPoints.lotoffortune);
  radio("quick.options.syzygy", opts.catalog.syzygyModes.map((entry) => entry.value), opts.planetsPoints.syzmoon);

  check(
    "quick.options.quickcharts:subcharts_open_compound_default",
    Boolean(opts.quickCharts.subcharts_open_compound_default),
  );
  check(
    "quick.options.quickcharts:timed_chart_show_radix_default",
    Boolean(opts.quickCharts.timed_chart_show_radix_default),
  );
  radio("quick.options.progressed-angle", opts.catalog.progressionAngleMethods.map((entry) => entry.value), opts.quickCharts.progressed_angle_method);
  radio("quick.options.progression-day", opts.catalog.progressionDayTypes.map((entry) => entry.value), opts.quickCharts.progression_day_type);
  radio("quick.options.launch-mode", opts.catalog.secondaryLaunchModes.map((entry) => entry.value), opts.quickCharts.secondary_progression_launch_mode);

  radio("quick.options.solar-year", [0, 1], opts.revolutions.revolutions_solaryearmode);
  radio("quick.options.solar-location", [0, 1], opts.revolutions.revolutions_solarlocationmode);
  radio("quick.options.lunar-location", [0, 1], opts.revolutions.revolutions_lunarlocationmode);
  radio("quick.options.planetary-location", [0, 1], opts.revolutions.revolutions_planetslocationmode);
  check("quick.options.return-mode:tithi_pravesha", opts.revolutions.revolutions_solarreturnmode === "tithi_pravesha");
  check("quick.options.return-mode:soli_lunar", opts.revolutions.revolutions_lunarreturnmode === "soli_lunar");
  check("quick.options.return-mode:jonas_arc", opts.revolutions.revolutions_lunarreturnmode === "jonas_arc");
  check("quick.options.revolutions:revsidereal_marr_solar", Boolean(opts.revolutions.revsidereal_marr_solar));
  check("quick.options.revolutions:revsidereal_marr_lunar", Boolean(opts.revolutions.revsidereal_marr_lunar));
  check("quick.options.revolutions:revsidereal_marr_planet", Boolean(opts.revolutions.revsidereal_marr_planet));

  check("quick.options.profections:wholeSign", Boolean(opts.profections.wholeSign));
  check("quick.options.profections:zodiacal", Boolean(opts.profections.zodiacal));
  check("quick.options.profections:useZodProjs", Boolean(opts.profections.useZodProjs));
  check("quick.options.profections:solarReturnSnap", Boolean(opts.profections.solarReturnSnap));
  radio("quick.options.firdaria", [1, 0], opts.firdaria.isfirbonatti ? 1 : 0);
  check("quick.options.stepalerts:stepalerts_enabled", Boolean(opts.stepAlerts.stepalerts_enabled));

  radio("quick.options.mansions", opts.catalog.mansionZodiacModes.map((entry) => entry.value), opts.lunarMansions.manazil_zodiac);
  radio("quick.options.eclipse", opts.catalog.eclipseModes.map((entry) => entry.value), opts.eclipses.eclipse_chart_moment);
  radio("quick.options.relationship", [0, 1], opts.relationshipCharts.synastry_opens_composite_first ? 1 : 0);
  for (const preset of opts.themePresets) {
    check(`quick.options.theme-preset:${preset.name}`, Boolean(preset.selected));
  }
  check("quick.options.colors:follow_os_theme", Boolean(opts.colors.follow_os_theme));
  return states;
}

const RADIX_SIBLING_LAUNCHER_IDS = new Set([
  "transits",
  "solar-revolution",
  "lunar-revolution",
  "planetary-return",
  "secondary-progression",
  "tertiary-progression",
  "solar-arc",
  "minor-progression",
  "profections",
  "solar-average",
  "ascensional-transits",
]);

const KEY_HINT_VISIBLE_MS = 1000;

function isRadixSiblingLauncherId(id: string): boolean {
  return RADIX_SIBLING_LAUNCHER_IDS.has(runtimeActionIdForShellMenu(id));
}

function chartLauncherParentForAction(
  actionId: string,
  activeLaunchParent: WorkspaceDocument | null,
  activeRadix: WorkspaceDocument | null,
): WorkspaceDocument | null {
  if (!activeLaunchParent) return null;
  if (
    isRadixSiblingLauncherId(actionId) &&
    activeLaunchParent.compoundKind !== "composite_from_synastry"
  ) {
    return activeRadix ?? activeLaunchParent;
  }
  return activeLaunchParent;
}

function isReturnRelocationKind(id: string): id is ReturnRelocationKind {
  return (
    id === "solar-revolution" ||
    id === "lunar-revolution" ||
    id === "planetary-return"
  );
}

function placePayloadFromCandidate(candidate: PlaceCandidate): Record<string, unknown> {
  return {
    place: candidate.name,
    deglon: candidate.lonDeg,
    minlon: candidate.lonMin,
    seclon: 0,
    east: candidate.east,
    deglat: candidate.latDeg,
    minlat: candidate.latMin,
    seclat: 0,
    north: candidate.north,
    altitude: candidate.altitude,
  };
}

function isChartSaveTarget(doc: WorkspaceDocument | null): boolean {
  if (!doc) return false;
  if (doc.compoundKind) return false;
  return doc.kind === "radix" || doc.kind === "here-now" || doc.kind === "supplementary";
}

function chartSaveTarget(
  activeDoc: WorkspaceDocument | null,
  activeRadix: WorkspaceDocument | null,
): WorkspaceDocument | null {
  if (isChartSaveTarget(activeDoc)) return activeDoc;
  return activeRadix;
}

function chartSaveName(doc: WorkspaceDocument): string {
  const title = doc.title.replace(/\s*\*$/, "").trim();
  if (doc.kind === "supplementary") {
    return title || doc.sourceName.trim();
  }
  return (doc.sourceName || title).trim();
}

function returnBindingFromCandidate(candidate: PlaceCandidate): SupplementaryBindingPayload {
  return {
    retained_state: {
      place_payload: placePayloadFromCandidate(candidate),
      plus: candidate.plus,
      zh: candidate.zoneHour,
      zm: candidate.zoneMin,
      daylight: Boolean(candidate.daylightSaving ?? false),
    },
  };
}

function birthplaceReturnBinding(): SupplementaryBindingPayload {
  return { retained_state: {} };
}

type Translator = (key: string, fallback: string) => string;

async function selectImportSelection(
  kind: ImportKind,
  tf: Translator,
): Promise<ShellOpenSelection> {
  return resolveShellHost().selectOpenFiles({
    title:
      kind === "hor_folder"
        ? tf("home.importDialogHorFolder", "Select folder containing .hor files")
        : kind === "jsonl"
          ? tf("home.importDialogJsonl", "Import JSONL Collection")
          : kind === "sfcht"
            ? tf("home.importDialogSfcht", "Import Solar Fire / Astro Gold .SFcht")
            : tf("home.importDialogAaf", "Import Astrological Exchange Format"),
    directory: kind === "hor_folder",
    multiple: kind === "sfcht" || kind === "aaf",
    filters:
      kind === "jsonl"
        ? [{ name: tf("home.filterJsonlCollections", "JSONL collections"), extensions: ["jsonl"] }]
        : kind === "sfcht"
          ? [{ name: tf("home.filterSolarFireAstroGold", "Solar Fire / Astro Gold"), extensions: ["sfcht", "SFcht"] }]
          : kind === "aaf"
            ? [{ name: tf("home.filterAaf", "Astrological Exchange Format"), extensions: ["aaf", "AAF", "txt"] }]
        : undefined,
  });
}

async function selectNativeExportPath(
  activeDoc: WorkspaceDocument | null,
  tf: Translator,
): Promise<string | null> {
  const isTable = activeDoc?.kind === "table" && activeDoc.tableId;
  return resolveShellHost().selectSavePath({
    title: tf("home.exportDialogTitle", "Export..."),
    defaultPath: `${exportBaseName(activeDoc)}.pdf`,
    filters: isTable
      ? [
          { name: tf("home.filterPdf", "PDF Files"), extensions: ["pdf"] },
          { name: tf("home.filterText", "Text Files"), extensions: ["txt"] },
          { name: tf("home.filterTsv", "TSV Files"), extensions: ["tsv"] },
          { name: tf("home.filterJson", "JSON Files"), extensions: ["json"] },
        ]
      : [
          { name: tf("home.filterPdf", "PDF Files"), extensions: ["pdf"] },
          { name: tf("home.filterPng", "PNG Files"), extensions: ["png"] },
        ],
  });
}

// "Save As" in Aries means "save this chart INTO a collection" — a .jsonl is a
// multi-chart collection (one record per line), never a single-chart file. The
// daemon writes a new record id for explicit Save As, preserving every other
// chart in the target collection. So the dialog defaults to the chart's CURRENT
// collection (or, for an unbound chart, the default collection), framed as a
// collection — never a chart-named file. Picking an existing collection adds a
// copy; typing a new name creates a new collection.
function exportKindFromPath(path: string): ExportKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".pdf")) return "pdf";
  return "auto";
}

function exportExtensionFromPath(path: string): "pdf" | "txt" | "tsv" | "json" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".json")) return "json";
  return "pdf";
}

async function exportTableDocument(
  activeDoc: WorkspaceDocument,
  tf: Translator,
  path?: string,
): Promise<boolean> {
  if (!activeDoc.tableId) return false;
  const payload = await fetchGenericTablePayload(activeDoc.tableId, activeDoc.id);
  const stem = exportBaseName(activeDoc);
  const extension = path ? exportExtensionFromPath(path) : "pdf";
  if (extension === "pdf") {
    if (path) {
      await writeTablePayloadPdf(path, payload, payload.rows);
      return true;
    }
    return exportTablePayloadPdf(payload, payload.rows, { fileStem: stem });
  }
  const text =
    extension === "json"
      ? JSON.stringify(payload, null, 2)
      : extension === "tsv"
        ? tableToTsv(payload, payload.rows)
        : tableToAlignedText(payload, payload.rows);
  await exportTextContent({
    path,
    filename: stem,
    extension,
    mimeType:
      extension === "json"
        ? "application/json;charset=utf-8"
        : extension === "tsv"
          ? "text/tab-separated-values;charset=utf-8"
          : "text/plain;charset=utf-8",
    text,
    title:
      extension === "json"
        ? tf("home.exportJsonTitle", "Export JSON...")
        : extension === "tsv"
          ? tf("home.exportTsvTitle", "Export TSV...")
          : tf("home.exportTextTitle", "Export Text..."),
    filters: [
      {
        name:
          extension === "json"
            ? tf("home.filterJson", "JSON Files")
            : extension === "tsv"
              ? tf("home.filterTsv", "TSV Files")
              : tf("home.filterText", "Text Files"),
        extensions: [extension],
      },
    ],
  });
  return true;
}

type PrimaryDirectionsMode = "radix" | "sr" | "lr";
type ChartListLaunchMode = 0 | 1 | 2;

function normalizeChartListLaunchMode(mode: number | null | undefined): ChartListLaunchMode {
  return mode === 1 || mode === 2 ? mode : 0;
}

function primaryDirectionsModeForDocument(doc: WorkspaceDocument | null): PrimaryDirectionsMode {
  if (doc?.kind !== "supplementary") return "radix";
  if (doc.supplementaryFeatureKind === "solar-revolution") return "sr";
  if (doc.supplementaryFeatureKind === "lunar-revolution") return "lr";
  return "radix";
}

function primaryDirectionsTargetForActiveDocument(
  activeDoc: WorkspaceDocument | null,
  radix: WorkspaceDocument,
): { doc: WorkspaceDocument; mode: PrimaryDirectionsMode } {
  const mode = primaryDirectionsModeForDocument(activeDoc);
  return mode === "radix" || activeDoc === null
    ? { doc: radix, mode: "radix" }
    : { doc: activeDoc, mode };
}

function findSupplementaryChildByKind(
  documents: WorkspaceDocument[],
  parentDocumentId: string,
  kind: SupplementaryKind,
): WorkspaceDocument | null {
  return documents.find(
    (doc) =>
      doc.parentDocumentId === parentDocumentId &&
      doc.kind === "supplementary" &&
      doc.supplementaryFeatureKind === kind,
  ) ?? null;
}

function planetaryBodyByType(
  manifest: ReturnType<typeof useWorkspaceManifest>,
  planetType: number,
): PlanetaryReturnBody | undefined {
  return manifest?.groups
    .flatMap((g) => g.actions)
    .find((a) => a.id === "planetary-return")
    ?.bodies?.find((body) => body.planetType === planetType);
}

function shellMenuActiveChartCommandIds(nodes: NativeMenuNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: NativeMenuNode) => {
    if (node.type === "separator") return;
    if (node.runtimeEnablement === "active-chart") {
      ids.add(node.id);
      ids.add(node.runtimeActionId ?? runtimeActionIdForShellMenu(node.id));
    }
    if (node.type === "submenu") {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return ids;
}

function shortcutActiveChartCommandIds(
  manifest: ReturnType<typeof useWorkspaceManifest>,
): Set<string> {
  const ids = new Set<string>();
  for (const row of manifest?.shortcuts ?? []) {
    if (
      row.bound &&
      row.commandId &&
      (row.group === "CHART MODES" || row.commandId === "ascensional-transits")
    ) {
      ids.add(row.commandId);
      ids.add(runtimeActionIdForShellMenu(row.commandId));
    }
  }
  return ids;
}

function shellMenuRuntimeStates(
  nodes: NativeMenuNode[],
  hasActiveChart: boolean,
  hasActiveRadix: boolean,
  hasActiveSaveTarget: boolean,
  runtimeEnabledActions: Record<string, boolean>,
  radixEnabledActions: Record<string, boolean>,
): ShellMenuEnabledState[] {
  const states: ShellMenuEnabledState[] = [];
  const visit = (node: NativeMenuNode) => {
    if (node.type === "separator") return;
    if (node.runtimeEnablement === "active-chart") {
      const actionId = node.runtimeActionId ?? runtimeActionIdForShellMenu(node.id);
      const gate = isRadixSiblingLauncherId(actionId)
        ? radixEnabledActions
        : runtimeEnabledActions;
      const hasRequiredContext = SAVE_CHART_COMMANDS.has(node.id)
        ? hasActiveSaveTarget
        : ROOT_RADIX_COMMANDS.has(node.id)
        ? hasActiveRadix
        : hasActiveChart;
      const enabled =
        hasRequiredContext &&
        (actionId in gate ? gate[actionId] : true);
      states.push({ id: node.id, enabled });
    }
    if (node.type === "submenu") {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return states;
}

function usesParentRuntimeGate(doc: WorkspaceDocument | null): boolean {
  return (
    doc?.kind === "astrocart" ||
    doc?.kind === "directions" ||
    doc?.kind === "astrolabe" ||
    doc?.kind === "astrolog-sphere" ||
    doc?.kind === "ephemeris" ||
    doc?.kind === "transit-search" ||
    doc?.kind === "table"
  );
}

function isViewDocument(doc: WorkspaceDocument | null): boolean {
  return usesParentRuntimeGate(doc);
}

const EMPTY_ENABLED_ACTIONS: Record<string, boolean> = Object.freeze({});
const CHART_PICKER_STARTUP_PREWARM_DELAY_MS = 2_000;
const FIRST_STARTUP_HELP_STORAGE_KEY = "aries.help.opened-on-first-startup.v1";

function enabledActionsSignature(actions: Record<string, boolean>): string {
  return Object.entries(actions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, enabled]) => `${key}:${enabled ? 1 : 0}`)
    .join("|");
}

function recentChartsMenuSignature(documents: WorkspaceDocument[]): string {
  return documents
    .map((doc) =>
      [
        doc.id,
        doc.parentDocumentId ?? "",
        doc.kind,
        doc.title,
        doc.sourceName,
        doc.fpath ?? "",
      ].join("\u001f"),
    )
    .join("\u001e");
}

export function HomeClient() {
  // The daemon owns the canonical workspace tree (slice 3). React mirrors it.
  useDaemonWorkspaceConnection();
  const t = useT();
  const tf = useTFallback();
  const daemonConnection = useDaemonWorkspaceStore((state) => state.connection);
  const nativeQuickOptionsSeq = useDaemonWorkspaceStore((state) => state.lastOptionsChange?.seq ?? 0);
  useEffect(() => {
    recordStartupPerfOnce("home-client-mounted");
    const frame = window.requestAnimationFrame(() => {
      recordStartupPerfOnce("shell-first-frame");
    });
    warmChartFonts();
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (daemonConnection !== "open") return;
    let idleHandle: number | null = null;
    const timer = window.setTimeout(() => {
      const prewarm = () => {
        // Keep picker first-use fast, but do not create its hidden webview during the
        // initial shell/daemon readiness race.
        prewarmChartPickerWindowApi();
        prewarmChartPickerRows(CHART_PICKER_ROWS_REFRESH_MIN_INTERVAL_MS);
      };
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(prewarm, { timeout: 1_500 });
        return;
      }
      prewarm();
    }, CHART_PICKER_STARTUP_PREWARM_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (idleHandle != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [daemonConnection]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void resolveShellHost()
      .listenChartPickerWindowEvents((payload) => {
        recordChartPerf("tauri-chart-picker-window", payload);
      })
      .then((unsubscribe) => {
        if (disposed) {
          safeShellUnlisten(unsubscribe);
        } else {
          stop = unsubscribe;
        }
      })
      .catch((error) => {
        console.warn("[tauri-chart-picker-window]", error);
      });
    return () => {
      disposed = true;
      safeShellUnlisten(stop);
    };
  }, []);
  useEffect(() => {
    const pending = new Map<string, { finish: () => void; timer: number }>();
    const finishPending = (id: string) => {
      const entry = pending.get(id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      entry.finish();
      pending.delete(id);
    };
    const runRequestedCommand = async (
      payload: WorkspaceCommandRequestPayload,
    ) => {
      if (payload.kind === "open-radix") {
        return workspaceOpen({
          sourceName: payload.row.name,
          source: payload.row.source,
          recordIndex: payload.row.recordIndex,
        });
      }
      if (payload.kind === "open-synastry-partner") {
        return workspaceOpenSynastry(
          payload.parentRadixId,
          payload.row.name,
          payload.row.source,
          payload.row.recordIndex,
        );
      }
      const root = await workspaceOpen({
        sourceName: payload.center.name,
        source: payload.center.source,
        recordIndex: payload.center.recordIndex,
      });
      if (!root.documentId) return root;
      return workspaceOpenSynastry(
        root.documentId,
        payload.partner.name,
        payload.partner.source,
        payload.partner.recordIndex,
      );
    };
    const handleCommandRequest = (
      message: Extract<WorkspaceCommandBusMessage, { type: "workspace-command-request" }>,
    ) => {
      const startedAt = perfNow();
      recordChartPerf("workspace-command-main-received", {
        id: message.id,
        kind: message.payload.kind,
      });
      postWorkspaceCommandStarted(message.id);
      const finish = beginWorkspaceSnapshotCommand();
      void runRequestedCommand(message.payload)
        .then((result) => {
          applyImmediateWorkspaceCommandResult(result, result.documentId);
          postWorkspaceCommandResult(message.id, result, result.documentId);
          recordChartPerf("workspace-command-main-result", {
            id: message.id,
            kind: message.payload.kind,
            docId: result.documentId ?? null,
            activeDocumentId: result.activeDocumentId ?? null,
            overlayRenderMode: result.snapshot?.overlayRenderMode ?? null,
            ms: perfNow() - startedAt,
          });
        })
        .catch((error) => {
          postWorkspaceCommandFailed(message.id, error);
          recordChartPerf("workspace-command-main-result", {
            id: message.id,
            kind: message.payload.kind,
            failed: true,
            error: error instanceof Error ? error.message : String(error),
            ms: perfNow() - startedAt,
          });
        })
        .finally(finish);
    };
    const unsubscribe = subscribeWorkspaceCommandBus((message) => {
      if (message.type === "workspace-command-request") {
        handleCommandRequest(message);
        return;
      }
      if (message.type === "workspace-command-started") {
        finishPending(message.id);
        const finish = beginWorkspaceSnapshotCommand();
        const timer = window.setTimeout(() => finishPending(message.id), 1200);
        pending.set(message.id, { finish, timer });
        return;
      }
      if (message.type === "workspace-command-result") {
        applyImmediateWorkspaceCommandResult(message.result, message.fallbackDocumentId);
        finishPending(message.id);
        return;
      }
      finishPending(message.id);
    });
    return () => {
      unsubscribe();
      for (const entry of pending.values()) {
        window.clearTimeout(entry.timer);
        entry.finish();
      }
      pending.clear();
    };
  }, []);
  // The daemon also owns the sidebar launcher catalog + shortcut map. The skin
  // renders both from this manifest and derives its dispatch sets from it — it
  // holds no hardcoded catalog ("stupid skin").
  const manifest = useWorkspaceManifest();
  const {
    documents,
    activeDocument: activeDoc,
    activeEnabledActions,
  } = useDaemonWorkspaceView();
  const {
    activate: activateDocument,
    openSupplementaryChild,
    closeDocument: closeDocumentCommand,
  } = useDaemonWorkspaceActions();
  // The active chart is lifted here so titlebar text, launch anchors, and the
  // chart surface all read the same retained snapshot. During pure self-step we
  // intentionally do not rewrite the document tree just to carry datetime.
  const { chart: activeChart } = useActiveDocumentChart(activeDoc);
  const activeDocRef = useRef<WorkspaceDocument | null>(activeDoc);
  const activeChartRef = useRef(activeChart);
  const recoveredSynodicTableDocumentRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeChartRef.current = activeChart;
  }, [activeChart]);
  useEffect(() => {
    activeDocRef.current = activeDoc;
  }, [activeDoc]);

  // Synastry / astrocart / here-now are REAL daemon documents (open-synastry /
  // open-astrocart / open-here-now). These launch handlers are shared with the
  // radix-wheel context menu via useChartLaunchers so both surfaces dispatch
  // identically — neither owns its own launch logic.
  const {
    openHereNow,
    openLensHereNow,
    openAstrocartChild,
    openAstrolabeChild,
    openAstrologSphereChild,
    openSquareChartChild,
    openMundaneChartChild,
    openEphemerisChild,
    openAscensionalTransitsChild,
    openTableChild,
  } = useChartLaunchers();

  // The radix-wheel context menu's Synastry item opens THIS picker (same flow
  // as the sidebar). Register the opener in the workspace store so the menu can
  // trigger it without prop-drilling through the chart-surface tree.
  const setSynastryPartnerRequester = useWorkspaceStore(
    (s) => s.setSynastryPartnerRequester,
  );
  // The radix-wheel context menu's "Edit chart data" opens THIS editor dialog in
  // edit mode (same dialog the sidebar's "New chart" opens in create mode).
  const setEditChartRequester = useWorkspaceStore((s) => s.setEditChartRequester);
  const requestEditChart = useWorkspaceStore((s) => s.requestEditChart);
  const openTransitSearchPane = useWorkspaceStore((s) => s.openTransitSearchPane);
  const openTransitListPane = useWorkspaceStore((s) => s.openTransitListPane);
  const openDirectionsPane = useWorkspaceStore((s) => s.openDirectionsPane);
  const openTimeLordPane = useWorkspaceStore((s) => s.openTimeLordPane);
  const openSynodicCyclesPane = useWorkspaceStore((s) => s.openSynodicCyclesPane);
  const surveilStudiesDialogOpen = useSurveilStore((s) => s.studiesDialogOpen);
  const openSurveilStudiesDialog = useSurveilStore((s) => s.openStudiesDialog);
  const aboutDialogOpen = useHelpAboutStore((s) => s.aboutOpen);
  const openAboutDialog = useHelpAboutStore((s) => s.openAbout);
  const licenseDialogOpen = useLicenseDialogStore((s) => s.open);
  const openLicenseDialog = useLicenseDialogStore((s) => s.openDialog);
  const openEclipsesPane = useWorkspaceStore((s) => s.openEclipsesPane);
  const openLunarMansionsPane = useWorkspaceStore((s) => s.openLunarMansionsPane);
  const openFeatureCatalogPane = useWorkspaceStore((s) => s.openFeatureCatalogPane);
  const openHelpPane = useWorkspaceStore((s) => s.openHelpPane);
  const reconcileWorkspaceChrome = useWorkspaceStore((s) => s.reconcileWorkspaceChrome);
  const clearAspectSelection = useWorkspaceStore((s) => s.clearAspectSelection);
  const toggleHideAllAspects = useWorkspaceStore((s) => s.toggleHideAllAspects);
  const closeAllRightPanes = useWorkspaceStore((s) => s.closeAllRightPanes);
  const setTimedChartShowRadix = useWorkspaceStore((s) => s.setTimedChartShowRadix);
  const toggleInspector = useFrameLayoutStore((s) => s.toggleInspector);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIRST_STARTUP_HELP_STORAGE_KEY) === "1") return;
      window.localStorage.setItem(FIRST_STARTUP_HELP_STORAGE_KEY, "1");
      openHelpPane();
    } catch (error) {
      console.warn("[first-startup-help]", error);
    }
  }, [openHelpPane]);

  // Early Synodic wiring briefly created generic table children. They are not
  // a valid center surface: recover an already-open legacy tab into the
  // canonical retained right pane before it can request generic table rows.
  useEffect(() => {
    if (
      activeDoc?.kind !== "table" ||
      activeDoc.tableId !== "synodic_cycles" ||
      !activeDoc.parentDocumentId
    ) {
      recoveredSynodicTableDocumentRef.current = null;
      return;
    }
    if (recoveredSynodicTableDocumentRef.current === activeDoc.id) return;
    const parent = documents.find((document) => document.id === activeDoc.parentDocumentId);
    if (!parent) return;
    recoveredSynodicTableDocumentRef.current = activeDoc.id;
    openSynodicCyclesPane({
      documentId: parent.id,
      sourceName: parent.sourceName,
      focusDatetime: activeDoc.displayDatetime ?? parent.displayDatetime ?? null,
    });
    activateDocument(parent.id);
  }, [activeDoc, activateDocument, documents, openSynodicCyclesPane]);

  const [picker, setPicker] = useState<PickerState>(null);
  const [savePicker, setSavePicker] = useState<{
    documentId: string;
    chartName: string;
    currentCollectionPath: string | null;
  } | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  // Edit-chart target: null → CREATE (new chart from defaults); set → EDIT an
  // existing radix (the editor prefills from GET /api/editor/load and preserves
  // its id on save), OR a session-cursor edit (cursorDocId + cursorSeed set,
  // morin.py:14821). The radix doc's sourceName + fpath address the record.
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [keyHintsVisible, setKeyHintsVisible] = useState(true);
  const [keyHintsPlacement, setKeyHintsPlacement] = useState<"top" | "bottom">("top");
  const [keyHintsAllowed, setKeyHintsAllowed] = useState(true);
  const [keyHintsAutoAllowed, setKeyHintsAutoAllowed] = useState(true);
  const [keyHintsRevealToken, setKeyHintsRevealToken] = useState(0);
  const lastBiwheelHintKeyRef = useRef<string | null>(null);
  const [spotlight, setSpotlight] = useState({
    open: false,
    initialText: "",
    version: 0,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>("appearance");
  const [nativeQuickOptions, setNativeQuickOptions] = useState<OptionsPayload | null>(null);
  const [importResult, setImportResult] = useState<{
    summary: ImportSummary | null;
    error: string | null;
  } | null>(null);
  const [aafPasteOpen, setAafPasteOpen] = useState(false);
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const runImportKind = useCallback((importKind: ImportKind) => {
    void selectImportSelection(importKind, tf)
      .then((selection) => {
        if (selection.paths.length === 0 && selection.files.length === 0) return null;
        return importCharts({
          kind: importKind,
          paths: selection.paths,
          files: selection.files,
        });
      })
      .then((summary) => {
        if (summary) setImportResult({ summary, error: null });
      })
      .catch((err) => {
        setImportResult({
          summary: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [tf]);
  const openSettings = useCallback((tab: SettingsTabId = "appearance") => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);
  const setSpotlightOpen = useCallback((open: boolean) => {
    if (!open) noteSpotlightDismissed();
    setSpotlight((current) => ({ ...current, open }));
  }, []);
  const openSpotlight = useCallback((initialText = "") => {
    setSpotlight((current) => ({
      open: true,
      initialText,
      version: current.version + 1,
    }));
  }, []);
  const handleSpotlightCommit = useCallback(
    async (
      action: "open-chart" | SpotlightActionId,
      _preview: SpotlightPreview,
      text: string,
    ) => {
      const finish = beginWorkspaceSnapshotCommand();
      try {
        const result = await spotlightExecute(text, action);
        applyImmediateWorkspaceCommandResult(result, result.documentId);
        setSpotlightOpen(false);
      } catch (err) {
        console.error("[spotlight-execute]", err);
      } finally {
        finish();
      }
    },
    [setSpotlightOpen],
  );
  useAmbientSpotlightTriggers({
    open: spotlight.open,
    onOpen: openSpotlight,
  });

  useEffect(() => {
    reconcileWorkspaceChrome(documents);
  }, [documents, reconcileWorkspaceChrome]);

  useEffect(() => {
    clearAspectSelection();
  }, [activeDoc?.id, clearAspectSelection]);
  // Close-cascade discard prompt (step C): when a daemon close reports
  // promptWorthyIds, hold the pending close here until the user confirms.
  const [pendingClose, setPendingClose] = useState<{
    docId: string;
    names: string[];
  } | null>(null);
  // App-quit Save/Discard/Cancel modal (policy-chart-lifecycle §3; wx onClose
  // dirty-check, morin.py:15615-15617). Populated from quit-preflight's
  // bound+dirty radix list when the native shell emits aries://quit-requested.
  // Null while no quit is pending. `busy` gates the buttons while saves/flush run.
  const [quitPrompt, setQuitPrompt] = useState<{
    prompts: QuitPreflightPrompt[];
    busy: boolean;
  } | null>(null);
  const steppingRef = useRef(false);
  // Accumulated intents for rapid arrow salvos. Adjacent equal arrows share one
  // compact queue entry, but each intent is still applied and painted on its
  // own presentation frame so the wheel never jumps multiple positions.
  const pendingStepsRef = useRef<Array<{
    documentId: string;
    paintsSnapshot: boolean;
    key: string;
    shift: boolean;
    alt: boolean;
    intentAt: number;
    intentTimes: number[];
    repeat: number;
  }>>([]);
  // A queued request may overlap the preceding snapshot's presentation, but
  // its result cannot publish until that snapshot has had a frame boundary.
  // This removes request + frame serialization without merging two steps into
  // one paint.
  const stepQueueFrameRef = useRef<number | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  // Settle debounce: after the last step in a burst, refetch full semantic
  // overlay truth. The step_fast frame already owns current, collision-validated
  // wheel geometry; settle updates state without repainting Canvas layers.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRequestRef = useRef<AbortController | null>(null);
  const stepGenerationRef = useRef(0);
  const pushSteppedSnapshot = useDaemonWorkspaceStore((s) => s.pushSteppedSnapshot);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);
  const supersedePendingStepSettle = useCallback(() => {
    stepGenerationRef.current += 1;
    if (settleFrameRef.current != null) {
      window.cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
    if (settleTimerRef.current != null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    settleRequestRef.current?.abort();
    settleRequestRef.current = null;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = (attempt = 0) => {
      fetchTimedChartShowRadixDefault(controller.signal)
        .then((result) => setTimedChartShowRadix(Boolean(result.showRadix)))
        .catch((err) => {
          if (isAbortError(err, controller.signal)) return;
          if (isTransientDaemonFetchError(err)) {
            if (attempt < 4) {
              retryTimer = setTimeout(() => load(attempt + 1), 250 * (attempt + 1));
            }
            return;
          }
          console.error("[timed-chart-show-radix-default]", err);
        });
    };

    load();
    return () => {
      controller.abort();
      if (retryTimer != null) clearTimeout(retryTimer);
    };
  }, [setTimedChartShowRadix]);

  const applyKeyPromptOptions = useCallback((next?: OptionsPayload) => {
    const display = next?.display;
    if (!display) return;
    const allowed = display.showkeyprompts !== false;
    const autoAllowed = display.show_help_chip !== false;
    setKeyHintsAutoAllowed((wasAutoAllowed) => {
      if (allowed && autoAllowed && !wasAutoAllowed) {
        setKeyHintsVisible(true);
      }
      return autoAllowed;
    });
    setKeyHintsAllowed((wasAllowed) => {
      if (!allowed || !autoAllowed) {
        setKeyHintsVisible(false);
      } else if (!wasAllowed) {
        setKeyHintsVisible(true);
      }
      return allowed;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((next) => {
        setNativeQuickOptions(next);
        applyKeyPromptOptions(next);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal) || isTransientDaemonFetchError(err)) {
          return;
        }
        console.error("[key-hints-options]", err);
      });
    return () => controller.abort();
  }, [applyKeyPromptOptions]);

  useEffect(() => {
    if (daemonConnection !== "open") return undefined;
    const controller = new AbortController();
    fetchOptions(controller.signal)
      .then((next) => {
        setNativeQuickOptions(next);
        applyKeyPromptOptions(next);
      })
      .catch((err) => {
        if (isAbortError(err, controller.signal) || isTransientDaemonFetchError(err)) {
          return;
        }
        console.error("[native-quick-options-sync]", err);
      });
    return () => controller.abort();
  }, [applyKeyPromptOptions, daemonConnection, nativeQuickOptionsSeq]);

  useEffect(() => {
    if (!nativeQuickOptions) return;
    void syncShellMenuChecked(nativeQuickOptionCheckedStates(nativeQuickOptions));
  }, [nativeQuickOptions]);

  const revealKeyHints = useCallback(
    (options: { manual?: boolean; placement?: "top" | "bottom" } = {}) => {
      if (!CHART_UPPER_NAVIGATION_BAR_ENABLED && options.placement === "top") return;
      if (!options.manual && (!keyHintsAllowed || !keyHintsAutoAllowed)) return;
      if (options.placement) setKeyHintsPlacement(options.placement);
      setKeyHintsVisible(true);
      setKeyHintsRevealToken((token) => token + 1);
    },
    [keyHintsAllowed, keyHintsAutoAllowed],
  );
  const revealKeyHintsAtEdge = useCallback(
    (placement: "top" | "bottom") => {
      revealKeyHints({ placement });
    },
    [revealKeyHints],
  );
  const renewKeyHints = useCallback(() => {
    revealKeyHints({ manual: true });
  }, [revealKeyHints]);

  const activeChartDocumentId = activeChart?.document?.documentId ?? activeDoc?.id ?? "";
  const activeChartViewMode = activeChart?.document?.viewMode ?? null;
  const activeChartPresent = activeChart != null;
  const activeChartHasComparison = activeChart?.comparisonChart != null;
  const activeChartComparisonName =
    activeDoc?.comparisonSourceName ?? activeChart?.document?.comparisonName ?? null;
  const activeDocKindForKeyHints = activeDoc?.kind;
  const hasBiwheelHintTarget = Boolean(
    activeChartPresent &&
    activeDocKindForKeyHints &&
    isChartBearingDocumentKind(activeDocKindForKeyHints),
  );

  useEffect(() => {
    if (!keyHintsAllowed || !keyHintsAutoAllowed) return;
    const biwheelKey =
      hasBiwheelHintTarget && activeChartDocumentId
        ? `${activeChartDocumentId}:comparison-toggle:${activeChartViewMode ?? "unknown"}`
        : null;
    if (!biwheelKey) {
      lastBiwheelHintKeyRef.current = null;
      return;
    }
    if (lastBiwheelHintKeyRef.current === biwheelKey) return;
    lastBiwheelHintKeyRef.current = biwheelKey;
    revealKeyHints();
  }, [
    activeChartDocumentId,
    activeChartViewMode,
    hasBiwheelHintTarget,
    keyHintsAutoAllowed,
    keyHintsAllowed,
    revealKeyHints,
  ]);

  const handleOptionsPatched = useCallback((next?: OptionsPayload) => {
    supersedePendingStepSettle();
    if (next) setNativeQuickOptions(next);
    applyKeyPromptOptions(next);
    if (next?.quickCharts) {
      setTimedChartShowRadix(Boolean(next.quickCharts.timed_chart_show_radix_default));
    }
    // options.changed is the single canonical snapshot invalidation channel.
    // Starting another GET here raced that event and produced duplicate paints.
  }, [applyKeyPromptOptions, setTimedChartShowRadix, supersedePendingStepSettle]);

  // Live language switch → relabel the native menu bar in place. The daemon
  // localizes menu labels by the active language (manifest_service), and the
  // Rust shell builds the bar localized at startup; on a runtime change we
  // re-fetch the (now switched) manifest and push the fresh labels, preserving
  // the enablement / checked / recent state a full rebuild would reset. Chrome
  // rendered in React (menus, dialogs) follows the same live locale provider.
  const tfMenu = useTFallback();
  const locale = useLocale();
  const relabelNativeMenuForLanguage = useCallback(async () => {
    try {
      const manifest = await fetchWorkspaceManifest();
      const labels: ShellMenuLabelState[] = [];
      const visit = (node: NativeMenuNode) => {
        if (node.type === "separator") return;
        // The Options submenu emits stable labelKeys (optmenu.*); translate them
        // from the shared catalog here so the native menu draws from one source.
        // Other nodes carry their (mtexts-localized) label verbatim.
        if (node.label) {
          const text = node.labelKey ? tfMenu(node.labelKey, node.label) : node.label;
          labels.push({ id: node.id, label: text });
        }
        if (node.type === "submenu") node.children.forEach(visit);
      };
      for (const node of manifest.nativeMenu?.menus ?? []) visit(node);
      // Fixed native items the Rust menu builds outside the manifest (app-menu
      // About, and the Edit/Window submenu titles). macOS localizes predefined
      // ITEMS but not these custom TITLES, so relabel them from the catalog too.
      labels.push({ id: "menu.app.about", label: tfMenu("nativeMenu.about", "About Aries") });
      labels.push({ id: "menu.edit", label: tfMenu("nativeMenu.edit", "Edit") });
      labels.push({ id: "menu.window", label: tfMenu("nativeMenu.window", "Window") });
      await syncShellMenuLabels(labels);
      // Same language switch also re-localizes the daemon-served sidebar labels;
      // push a fresh manifest to the (otherwise immutable-cached) sidebar hook.
      await refreshWorkspaceManifest();
    } catch (err) {
      if (isTransientDaemonFetchError(err)) return;
      console.error("[native-menu-relabel]", err);
    }
  }, [tfMenu]);

  // Relabel the native menu on the active locale (initial load + every switch):
  // the Rust-built menu comes up with the Options submenu in English (keys), and
  // this pushes the catalog-translated labels. Nested submenu → no visible flash.
  useEffect(() => {
    if (daemonConnection !== "open") return;
    void relabelNativeMenuForLanguage();
  }, [daemonConnection, locale, relabelNativeMenuForLanguage]);

  const runNativeQuickOptionCommand = useCallback((command: string) => {
    supersedePendingStepSettle();
    const current = nativeQuickOptions;
    const load = current ? Promise.resolve(current) : fetchOptions();
    void load
      .then((opts) => {
        const presetName = quickCommandValue(command, "quick.options.theme-preset:");
        if (presetName !== null) return applyThemePreset(presetName);
        const patch = nativeQuickOptionPatch(command, opts);
        if (!patch) return null;
        return patchOptions(patch);
      })
      .then((next) => {
        if (!next) return;
        if (command === "toggle-presentation-cursor") {
          setNativeQuickOptions(next);
          useThemeStore.getState().applyThemeState(next.themeState);
          return;
        }
        if (
          command.startsWith("quick.options.theme-preset:")
          || command === "quick.options.colors:follow_os_theme"
        ) {
          useThemeStore.getState().applyThemeState(next.themeState);
        }
        handleOptionsPatched(next);
      })
      .catch((err) => console.error("[native-quick-options]", err));
  }, [handleOptionsPatched, nativeQuickOptions, setNativeQuickOptions, supersedePendingStepSettle]);

  // Sidebar DnD reorder → the daemon move command (POST /api/workspace/move).
  // The tree order is DAEMON-owned: we forward the drop as (docId, beforeId) and
  // let the controller reorder + broadcast documents.changed, which re-seeds the
  // React mirror. The controller is sibling-only — a cross-parent drop is
  // rejected and the tree is left unchanged, so the dragged row snaps back. We
  // never mutate the client tree here.
  const reorderSibling = useCallback(
    (docId: string, beforeId: string | null): void => {
      void workspaceMove(docId, beforeId).catch((err) =>
        console.error("[ws-move]", err),
      );
    },
    [],
  );

  // Close-cascade discard prompt. The dirty + file-backed + owns-radix predicate
  // (morin.py:11529-11551) is DAEMON-owned: ask the daemon (non-destructively)
  // which docs need a discard prompt, then finalize — never recompute it here.
  // promptWorthyIds -> display names is pure presentation off the authoritative
  // daemon tree (derived children + ephemeral no-fpath charts close silently).
  const closeDocument = useCallback(
    (id: string) => {
      void workspaceClosePreflight(id)
        .then((res) => {
          const promptIds = res.promptWorthyIds ?? [];
          if (promptIds.length === 0) {
            void closeDocumentCommand(id);
            return;
          }
          const names = promptIds.map(
            (pid) =>
              documents.find((d) => d.id === pid)?.title.replace(/\s*\*$/, "") ?? pid,
          );
          setPendingClose({ docId: id, names });
        })
        .catch((err) => {
          console.error("[close-preflight]", err);
          void closeDocumentCommand(id);
        });
    },
    [documents, closeDocumentCommand],
  );

  const closeTransientWorkspaceUI = useCallback(() => {
    if (pendingClose !== null) {
      setPendingClose(null);
      return;
    }
    if (picker !== null) {
      setPicker(null);
      return;
    }
    if (editorOpen) {
      setEditorOpen(false);
      setEditTarget(null);
      return;
    }
    if (importResult !== null) {
      setImportResult(null);
      return;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (spotlight.open) {
      setSpotlightOpen(false);
      return;
    }
    closeWorkspaceTransientPanes();
  }, [
    editorOpen,
    importResult,
    pendingClose,
    picker,
    settingsOpen,
    setSpotlightOpen,
    spotlight.open,
  ]);

  // Dispatch sets derived from the daemon manifest (not a hardcoded catalog):
  // every enabled launcher id, and the subset that maps to supplementary
  // children (the Charts group minus synastry/astrocart).
  const enabledIds = useMemo(() => enabledActionIds(manifest), [manifest]);
  const supplementaryIds = useMemo(
    () => supplementaryActionIds(manifest),
    [manifest],
  );
  const hasActiveRadix = useMemo(
    () => findDaemonRadixAncestor(documents, activeDoc?.id ?? null) !== null,
    [documents, activeDoc?.id],
  );
  const activeRadix = useMemo(
    () => findDaemonRadixAncestor(documents, activeDoc?.id ?? null),
    [documents, activeDoc?.id],
  );
  const activeSaveTarget = useMemo(
    () => chartSaveTarget(activeDoc, activeRadix),
    [activeDoc, activeRadix],
  );
  const activeLaunchParent = useMemo(
    () => findChartLaunchParent(documents, activeDoc?.id ?? null),
    [documents, activeDoc?.id],
  );
  const hasActiveChart = activeLaunchParent !== null;
  const activeDocUsesParentRuntimeGate = usesParentRuntimeGate(activeDoc);
  const activeLaunchParentEnabledActions = activeLaunchParent?.enabledActions ?? EMPTY_ENABLED_ACTIONS;
  const activeRadixEnabledActions = activeRadix?.enabledActions ?? activeLaunchParentEnabledActions;
  const launcherEnabledActions = activeDocUsesParentRuntimeGate
    ? activeLaunchParentEnabledActions
    : activeEnabledActions;
  const launcherEnabledActionsSignature = useMemo(
    () => enabledActionsSignature(launcherEnabledActions),
    [launcherEnabledActions],
  );
  const activeLaunchDatetime =
    activeChart?.document?.symbolicTime?.signifiedDatetime ??
    activeDoc?.symbolicTime?.signifiedDatetime ??
    activeChart?.document?.displayDatetime ??
    activeChart?.displayDatetime ??
    activeDoc?.displayDatetime ??
    activeLaunchParent?.displayDatetime ??
    activeRadix?.displayDatetime;
  const activeLaunchDatetimeRef = useRef(activeLaunchDatetime);
  useLayoutEffect(() => {
    activeLaunchDatetimeRef.current = activeLaunchDatetime;
  }, [activeLaunchDatetime]);
  const ensureChartSurfaceForPaneLauncher = useCallback(
    (launchParent: WorkspaceDocument) => {
      const doc = activeDoc;
      if (isViewDocument(doc) && doc?.id !== launchParent.id) {
        activateDocument(launchParent.id);
      }
    },
    [activeDoc, activateDocument],
  );
  const activeChartCommandIds = useMemo(() => {
    const ids = shellMenuActiveChartCommandIds(manifest?.nativeMenu?.menus ?? []);
    for (const id of shortcutActiveChartCommandIds(manifest)) ids.add(id);
    for (const id of supplementaryIds) ids.add(id);
    return ids;
  }, [manifest, supplementaryIds]);
  const runtimeGateForAction = useCallback(
    (actionId: string): Record<string, boolean> =>
      isRadixSiblingLauncherId(actionId)
        ? activeRadixEnabledActions
        : launcherEnabledActions,
    [activeRadixEnabledActions, launcherEnabledActions],
  );
  const launcherIsRuntimeEnabled = useCallback(
    (actionId: string): boolean => {
      const gate = runtimeGateForAction(actionId);
      return actionId in gate ? gate[actionId] : true;
    },
    [runtimeGateForAction],
  );

  const commandIsRuntimeEnabled = useCallback(
    (command: string): boolean => {
      if (command === "workspace.close-active") return activeDoc !== null;
      if (CHART_INDEPENDENT_COMMANDS.has(command)) return true;
      if (SAVE_CHART_COMMANDS.has(command)) return activeSaveTarget !== null;
      if (ROOT_RADIX_COMMANDS.has(command)) return activeRadix !== null;
      if (!manifest) return false;
      const actionId = runtimeActionIdForShellMenu(command);
      const requiresActiveChart =
        activeChartCommandIds.has(command) ||
        activeChartCommandIds.has(actionId) ||
        enabledIds.has(command) ||
        enabledIds.has(actionId) ||
        supplementaryIds.has(actionId);
      if (requiresActiveChart && !hasActiveChart) return false;
      return launcherIsRuntimeEnabled(actionId);
    },
    [
      activeDoc,
      activeRadix,
      activeSaveTarget,
      activeChartCommandIds,
      enabledIds,
      hasActiveChart,
      launcherIsRuntimeEnabled,
      manifest,
      supplementaryIds,
    ],
  );

  useEffect(() => {
    const states = shellMenuRuntimeStates(
      manifest?.nativeMenu?.menus ?? [],
      hasActiveChart,
      hasActiveRadix,
      activeSaveTarget !== null,
      launcherEnabledActions,
      activeRadixEnabledActions,
    );
    void syncShellMenuEnablement(states);
  }, [
    manifest,
    hasActiveChart,
    hasActiveRadix,
    activeSaveTarget,
    launcherEnabledActions,
    launcherEnabledActionsSignature,
    activeRadixEnabledActions,
  ]);

  // Charts > Elections / Horary checkmark sync — the wx twin is
  // _refresh_pack_lens_menu_checks (morin.py:18963-18977): exactly the theme
  // matching the active lens is checked; clearing the lens unchecks all.
  const inspectorLens = useWorkspaceStore((s) => s.inspectorLens);
  useEffect(() => {
    const states: ShellMenuCheckedState[] = [];
    const visit = (node: NativeMenuNode) => {
      if (node.type === "separator") return;
      if (
        node.type === "check" &&
        (node.id.startsWith("elections:") || node.id.startsWith("horary:"))
      ) {
        const sep = node.id.indexOf(":");
        states.push({
          id: node.id,
          checked:
            inspectorLens?.discipline === node.id.slice(0, sep) &&
            inspectorLens?.theme === node.id.slice(sep + 1),
        });
      }
      if (node.type === "submenu") {
        for (const child of node.children) visit(child);
      }
    };
    for (const node of manifest?.nativeMenu?.menus ?? []) visit(node);
    void syncShellMenuChecked(states);
  }, [manifest, inspectorLens]);

  // Charts > Alternative Charts checkmark sync — these are radio-like check
  // items in wx (onSquareChart/onMundaneChart/onAstrolabe, morin.py:14298-14300):
  // exactly the active document's alternative-chart kind is checked, all others
  // unchecked. Without this the native CheckMenuItems auto-toggle on click and
  // get stuck (both Square + Mundane showing checked).
  const activeDocKind = activeDoc?.kind ?? null;
  useEffect(() => {
    const ALT_CHART_CHECK: Record<string, string> = {
      "menu.chart.square": "square-chart",
      "menu.chart.mundane": "mundane-chart",
      astrolabe: "astrolabe",
    };
    const states: ShellMenuCheckedState[] = Object.entries(ALT_CHART_CHECK).map(
      ([menuId, docKind]) => ({ id: menuId, checked: activeDocKind === docKind }),
    );
    void syncShellMenuChecked(states);
  }, [activeDocKind]);

  // Corpus Packs submenu checkmark sync — the daemon-generated "Corpus Packs"
  // menu (manifest_service._corpus_packs_submenu) carries one check item per
  // installed pack; the checked state mirrors the active-pack filter
  // (rule_engine, None == all on). Fetch the live filter and push the checks
  // to the shell menu so a toggle here matches the wx inspector pack strip
  // (workspace_shell.py:2455 _populate_pack_toggles). `corpusPackSyncTick` is
  // bumped after each toggle so the checks re-sync from the daemon truth.
  const [corpusPackSyncTick, setCorpusPackSyncTick] = useState(0);
  useEffect(() => {
    if (daemonConnection !== "open" || !manifest) return;
    let cancelled = false;
    void fetchCorpusPacks()
      .then((payload) => {
        if (cancelled) return;
        const states: ShellMenuCheckedState[] = payload.packs.map((pack) => ({
          id: `corpus.pack:${pack.id}`,
          checked: pack.active,
        }));
        void syncShellMenuChecked(states);
      })
      .catch((err) => {
        if (isTransientDaemonFetchError(err)) return;
        console.error("[corpus-pack-sync]", err);
      });
    return () => {
      cancelled = true;
    };
  }, [daemonConnection, manifest, corpusPackSyncTick]);

  // File > Recent Charts — wx's dynamic submenu (morin.py:15716-15738). The
  // daemon owns labels/order; the skin only carries the fetched list into the
  // native submenu (set_recent_charts) and back out on click. Refresh only when
  // the open-document identity/path/title shape changes. Time stepping updates
  // displayDatetime in the same mirror, but must not poll Recent Charts.
  const recentChartsRef = useRef<RecentChartItem[]>([]);
  const [recentChartsMenuItems, setRecentChartsMenuItems] = useState<RecentChartItem[]>([]);
  const recentChartsSignature = useMemo(() => recentChartsMenuSignature(documents), [documents]);
  const refreshRecentChartsMenu = useCallback(() => {
    if (useDaemonWorkspaceStore.getState().connection !== "open") return;
    void fetchRecentCharts()
      .then(async (items) => {
        recentChartsRef.current = items;
        setRecentChartsMenuItems(items);
        try {
          await resolveShellHost().syncRecentCharts(
            items.map((item, index) => ({
              id: `menu.recent-charts.entry:${index}`,
              label: item.label,
            })),
          );
        } catch {
          // Browser preview has no host-provided menu; the shell submenu is the
          // only Recent Charts surface (DEF-006 deliverable 3).
        }
      })
      .catch((err) => {
        if (isTransientDaemonFetchError(err)) return;
        console.error("[recent-charts]", err);
      });
  }, []);
  useEffect(() => {
    if (daemonConnection !== "open") return;
    refreshRecentChartsMenu();
  }, [daemonConnection, recentChartsSignature, refreshRecentChartsMenu]);

  const openReturnWithSavedLocationMode = useCallback(
    (request: RevolutionLocationRequest) => {
      void fetchRevolutionLocationPredicate(request.kind, request.planetType ?? null)
        .then((predicate) => {
          if (predicate.shouldPrompt) {
            setPicker(request);
            return;
          }
          setPicker(null);
          openSupplementaryChild(request.parentRadixId, request.kind, {
            planetType: request.planetType ?? null,
            binding: birthplaceReturnBinding(),
            when: request.when ?? null,
          });
        })
        .catch((err) => {
          console.error("[revolution-location-predicate]", err);
        });
    },
    [openSupplementaryChild],
  );

  const handleSelect = useCallback(
    (id: string) => {
      // Snapshot the live cursor once per launcher action. Keeping the changing
      // chart datetime in a ref leaves this callback stable during arrow-key
      // stepping, so retained sidebar chrome does not reconcile every frame.
      const launchDatetime = activeLaunchDatetimeRef.current;
      // Document click → activate.
      const isDoc = documents.some((d) => d.id === id);
      if (isDoc) {
        activateDocument(id);
        return;
      }
      // Only manifest-enabled launchers dispatch (disabled ones are inert in
      // the sidebar; this guards programmatic calls too).
      if (!enabledIds.has(id) && id !== "ascensional-transits") return;
      // Top actions.
      if (id === "open") {
        void openChartPickerWindow({ mode: "open-radix" });
        return;
      }
      if (id === "now") {
        openHereNow();
        return;
      }
      if (id === "new") {
        // Chart editor (Personal Data) form — build/save a new chart on the
        // canonical daemon path, then open it as a workspace radix. Clear any
        // edit target so the dialog opens in CREATE mode (defaults seed).
        setEditTarget(null);
        setEditorOpen(true);
        return;
      }
      // Chart launchers need the wx launch parent: the root chart for ordinary
      // derived tabs, or the nearest relationship-composite document.
      // For relationship composites, wx assigns cs.radix to the composite chart
      // itself, so Davison/midpoint launch from that document rather than the
      // original radix tab.
      const launchParent = chartLauncherParentForAction(id, activeLaunchParent, activeRadix);
      if (!launchParent) return;
      // RUNTIME session gate (daemon-owned): the active document's
      // enabledActions encodes has_chart / return availability (BC charts can
      // get solar returns, but not lunar returns) / the composite gate (midpoint composites
      // forbid non-transit children). When the gate names this launcher and
      // it is false, the action is inert for this session — the wx
      // morin._workspace_navigation_state behaviour, not recomputed in TS.
      if (!launcherIsRuntimeEnabled(id)) return;
      if (id.startsWith("table:")) {
        // Tables / Time Lords sidebar rows — daemon-owned dispatch ids
        // ("table:<tables_service id>") for the embedded generic table child
        // (wx _show_simple_table_in_workspace, morin.py:15898-15915).
        const launchedTableId = id.slice("table:".length);
        if (
          launchedTableId === "zodiacal_releasing" ||
          launchedTableId === "firdaria" ||
          launchedTableId === "decennials" ||
          launchedTableId === "triplicity_directions" ||
          launchedTableId === "profections_table"
        ) {
          // Time Lords live in the same retained right-pane ontology as the
          // Directions list: the chart stays active, and the pane fetches a
          // daemon-owned collapsible period tree for the chosen table id.
          ensureChartSurfaceForPaneLauncher(launchParent);
          openTimeLordPane({
            documentId: launchParent.id,
            sourceName: launchParent.sourceName,
            tableId: launchedTableId,
          });
          closeInspectorAndNotes();
          return;
        }
        if (launchedTableId === "eclipses") {
          ensureChartSurfaceForPaneLauncher(launchParent);
          openEclipsesPane({ documentId: launchParent.id, sourceName: launchParent.sourceName });
          closeInspectorAndNotes();
          return;
        }
        if (launchedTableId === "lunar_mansions") {
          ensureChartSurfaceForPaneLauncher(launchParent);
          openLunarMansionsPane({
            documentId: launchParent.id,
            sourceName: launchParent.sourceName,
          });
          closeInspectorAndNotes();
          return;
        }
        if (launchedTableId === "synodic_cycles") {
          ensureChartSurfaceForPaneLauncher(launchParent);
          openSynodicCyclesPane({
            documentId: launchParent.id,
            sourceName: launchParent.sourceName,
            focusDatetime: launchDatetime ?? launchParent.displayDatetime ?? null,
          });
          closeInspectorAndNotes();
          return;
        }
        openTableChild(launchParent.id, launchedTableId);
        return;
      }
      if (id === "synastry") {
        void openChartPickerWindow({
          mode: "synastry-partner",
          parentRadixId: launchParent.id,
          excludeNames: [launchParent.sourceName],
        });
        return;
      }
      if (id === "astrocartography") {
        openAstrocartChild(launchParent.id);
        return;
      }
      if (id === "directions") {
        const target = primaryDirectionsTargetForActiveDocument(activeDoc, launchParent);
        if (target.mode === "radix") ensureChartSurfaceForPaneLauncher(launchParent);
        openDirectionsPane({
          documentId: target.doc.id,
          cursorDocumentId: activeDoc?.id ?? launchParent.id,
          sourceName: target.doc.sourceName,
          source: target.doc.fpath ?? launchParent.fpath,
          focusDatetime:
            launchDatetime ?? target.doc.displayDatetime ?? launchParent.displayDatetime,
          initialTab: "primary",
          initialPrimaryMode: target.mode,
        });
        closeInspectorAndNotes();
        return;
      }
      if (id === "directions:circumambulation") {
        const target = primaryDirectionsTargetForActiveDocument(activeDoc, launchParent);
        if (target.mode === "radix") ensureChartSurfaceForPaneLauncher(launchParent);
        openDirectionsPane({
          documentId: target.doc.id,
          cursorDocumentId: activeDoc?.id ?? launchParent.id,
          sourceName: target.doc.sourceName,
          source: target.doc.fpath ?? launchParent.fpath,
          focusDatetime:
            launchDatetime ?? target.doc.displayDatetime ?? launchParent.displayDatetime,
          initialTab: "circumambulation",
          initialPrimaryMode: target.mode,
        });
        closeInspectorAndNotes();
        return;
      }
      if (id === "astrolabe") {
        openAstrolabeChild(launchParent.id);
        return;
      }
      if (id === "astrolog-sphere") {
        openAstrologSphereChild(launchParent.id);
        return;
      }
      if (id === "square-chart") {
        openSquareChartChild(launchParent.id);
        return;
      }
      if (id === "mundane-chart") {
        openMundaneChartChild(launchParent.id);
        return;
      }
      if (id === "ephemeris") {
        // Graphic Ephemeris — view-only daemon child (wx
        // _workspace_table_ephemeris, morin.py:16180-16195).
        openEphemerisChild(launchParent.id);
        return;
      }
      if (id === "ascensional-transits") {
        const atParent =
          launchParent.compoundKind === "composite_from_synastry"
            ? launchParent
            : activeRadix ?? launchParent;
        const atSourceId = isViewDocument(activeDoc)
          ? launchParent.id
          : activeDoc?.id ?? launchParent.id;
        openAscensionalTransitsChild(atParent.id, atSourceId);
        return;
      }
      if (id === "transits") {
        const existingChild = findSupplementaryChildByKind(
          documents,
          launchParent.id,
          "transits",
        );
        const openList = () => {
          const focusDatetime =
            existingChild?.displayDatetime ??
            launchDatetime ??
            launchParent.displayDatetime ??
            null;
          closeInspectorAndNotes();
          openTransitListPane({
            documentId: launchParent.id,
            sourceName: launchParent.sourceName,
            focusDatetime,
          });
        };
        const openChart = () => {
          const finishSnapshotCommand = beginWorkspaceSnapshotCommand();
          void workspaceOpen({
            parentDocumentId: launchParent.id,
            featureKind: "transits",
            reuseExisting: true,
          })
            .then((result) => {
              applyImmediateWorkspaceCommandResult(result, result.documentId);
            })
            .catch((err) => console.error("[ws-open-transits]", err))
            .finally(finishSnapshotCommand);
        };
        void fetchProgressionLaunchPredicate()
          .then((predicate) => {
            const mode = normalizeChartListLaunchMode(predicate.mode);
            if (mode === 1 || mode === 2 || existingChild) openList();
            if (mode === 0 || mode === 2) openChart();
          })
          .catch((err) => {
            console.error("[transit-launch-predicate]", err);
            openList();
            openChart();
          });
        return;
      }
      if (id === "transit-search") {
        ensureChartSurfaceForPaneLauncher(launchParent);
        openTransitSearchPane({ documentId: launchParent.id });
        closeInspectorAndNotes();
        return;
      }
      if (id === "planetary-return") {
        // Needs a body choice before opening — pop the
        // body-picker; the bodies come from the daemon manifest action.
        const action = manifest?.groups
          .flatMap((g) => g.actions)
          .find((a) => a.id === "planetary-return");
        const bodies = action?.bodies ?? [];
        if (bodies.length === 0) return;
        setPicker({
          mode: "planetary-return-body",
          parentRadixId: launchParent.id,
          bodies,
        });
        return;
      }
      if (isReturnRelocationKind(id)) {
        openReturnWithSavedLocationMode({
          mode: "revolution-location",
          parentRadixId: launchParent.id,
          kind: id,
        });
        return;
      }
      if (id === "profections") {
        setPicker(null);
        openSupplementaryChild(launchParent.id, "profections");
        return;
      }
      if (supplementaryIds.has(id)) {
        const secondaryMethod = progressionDirectionsMethod(id);
        if (secondaryMethod) {
          void fetchProgressionLaunchPredicate()
            .then((predicate) => {
              const mode = normalizeChartListLaunchMode(predicate.mode);
              const existingChild = findSupplementaryChildByKind(
                documents,
                launchParent.id,
                id as SupplementaryKind,
              );
              if (mode === 1 || mode === 2) {
                ensureChartSurfaceForPaneLauncher(launchParent);
                openDirectionsPane({
                  documentId: launchParent.id,
                  cursorDocumentId: activeDoc?.id ?? launchParent.id,
                  sourceName: launchParent.sourceName,
                  source: launchParent.fpath,
                  focusDatetime: launchDatetime ?? launchParent.displayDatetime,
                  initialTab: "secondary",
                  secondaryMethod,
                });
                closeInspectorAndNotes();
              } else if (existingChild) {
                openDirectionsPane({
                  documentId: launchParent.id,
                  cursorDocumentId: existingChild.id,
                  sourceName: launchParent.sourceName,
                  source: launchParent.fpath,
                  focusDatetime:
                    existingChild.symbolicTime?.signifiedDatetime ??
                    existingChild.displayDatetime ??
                    launchDatetime ??
                    launchParent.displayDatetime,
                  initialTab: "secondary",
                  secondaryMethod,
                });
                closeInspectorAndNotes();
              }
              if (mode === 0 || mode === 2) {
                openSupplementaryChild(launchParent.id, id as SupplementaryKind);
              }
            })
            .catch((err) => {
              console.error("[progression-launch-predicate]", err);
              openSupplementaryChild(launchParent.id, id as SupplementaryKind);
            });
          return;
        }
        openSupplementaryChild(launchParent.id, id as SupplementaryKind);
        return;
      }
      // Any other enabled action with no client surface yet: no-op.
    },
    [
      documents,
      activeDoc,
      activeLaunchParent,
      activeRadix,
      activateDocument,
      openHereNow,
      openSupplementaryChild,
      openAstrocartChild,
      openTableChild,
      openAstrolabeChild,
      openAstrologSphereChild,
      openSquareChartChild,
      openMundaneChartChild,
      openEphemerisChild,
      openAscensionalTransitsChild,
      openTransitSearchPane,
      openTransitListPane,
      openDirectionsPane,
      openTimeLordPane,
      openSynodicCyclesPane,
      openEclipsesPane,
      openLunarMansionsPane,
      openReturnWithSavedLocationMode,
      ensureChartSurfaceForPaneLauncher,
      enabledIds,
      supplementaryIds,
      manifest,
      launcherIsRuntimeEnabled,
    ],
  );

  const handleSolarAverageWindowSelect = useCallback(
    (maxBirthday: number, returnKind: "solar" | "lunar") => {
      const launchParent = chartLauncherParentForAction(
        "solar-average",
        activeLaunchParent,
        activeRadix,
      );
      if (!launchParent) return;
      if ("solar-average" in launcherEnabledActions && !launcherEnabledActions["solar-average"]) {
        return;
      }
      openSupplementaryChild(launchParent.id, "solar-average", {
        binding: {
          retained_state: {
            solar_average_max_birthday: maxBirthday,
            return_average_kind: returnKind,
          },
        },
      });
    },
    [activeLaunchParent, activeRadix, launcherEnabledActions, openSupplementaryChild],
  );

  // After the editor saves, open the new chart as a root radix. The save route
  // returns the record index in the target collection, so reopen uses the stable
  // JSONL row instead of a name lookup (names are not unique).
  const handleEditorSaved = useCallback(
    (chartName: string, collectionPath: string, recordIndex: number | null) => {
      const wasEdit = editTarget !== null;
      setEditTarget(null);
      const existing = documents.find(
        (d) =>
          d.kind === "radix" &&
          d.parentDocumentId === null &&
          d.sourceName === chartName &&
          (d.fpath ?? "") === collectionPath,
      );
      const openFresh = () =>
        void workspaceOpen({ sourceName: chartName, source: collectionPath, recordIndex })
          .then((res) => {
            if (res.documentId) void workspaceActivate(res.documentId);
          })
          .catch((err) => console.error("[editor-open]", err));

      if (existing) {
        if (wasEdit) {
          // The record changed but the daemon still holds the radix built from
          // the OLD record. Close it (cascade its re-derivable children) and
          // re-open from the saved collection so it renders the edited data —
          // _load_radix re-reads the file at open time.
          void workspaceClose(existing.id, true)
            .then(openFresh)
            .catch((err) => console.error("[editor-reopen]", err));
        } else {
          activateDocument(existing.id);
        }
        return;
      }
      openFresh();
    },
    [documents, activateDocument, editTarget],
  );

  // Register the synastry-partner picker opener so the radix-wheel context menu
  // can trigger the SAME picker the sidebar uses. Cleared on unmount.
  useEffect(() => {
    setSynastryPartnerRequester((radix) =>
      void openChartPickerWindow({
        mode: "synastry-partner",
        parentRadixId: radix.id,
        excludeNames: [radix.sourceName],
      }),
    );
    return () => setSynastryPartnerRequester(null);
  }, [setSynastryPartnerRequester]);

  // Register the edit-chart opener so the radix-wheel context menu's "Edit chart
  // data" item opens THIS editor dialog. Two lanes (onData, morin.py:14813):
  //   - session-cursor edit: when the ACTIVE document edits its stepping anchor
  //     (a transit/SR/return/progression child whose cursor carries a live
  //     display_datetime), the daemon's /api/editor/cursor-seed reports
  //     usesSessionCursor=true and ships the seed. We open in cursor mode (type
  //     locked, anchor hint shown, Apply re-derives the cursor — no .jsonl).
  //   - stored radix: otherwise load the radix record by name+fpath and save.
  // Cleared on unmount.
  useEffect(() => {
    setEditChartRequester((radix) => {
      const activeId = activeDoc?.id ?? null;
      const openStoredRadix = () => {
        // The radix proper is OPEN as `radix.id` → edit applies in place +
        // auto-saves to its bound collection (no close/reopen flash, wx onData).
        setEditTarget({ name: radix.sourceName, source: radix.fpath, radixDocId: radix.id });
        setEditorOpen(true);
      };
      // Only a derived child (a daemon document distinct from the radix) can be
      // a cursor-edit target; the radix proper takes the stored path directly.
      if (!activeId || activeId === radix.id) {
        openStoredRadix();
        return;
      }
      void fetchEditorCursorSeed(activeId)
        .then((seed) => {
          if (seed.usesSessionCursor) {
            setEditTarget({
              name: radix.sourceName,
              source: radix.fpath,
              cursorDocId: activeId,
              cursorSeed: seed,
            });
            setEditorOpen(true);
          } else {
            openStoredRadix();
          }
        })
        .catch((err) => {
          console.error("[editor-cursor-seed]", err);
          openStoredRadix();
        });
    });
    return () => setEditChartRequester(null);
  }, [setEditChartRequester, activeDoc]);

  // Canonical arrow-key time stepping. The frontend forwards the raw keypress +
  // modifiers; canonical Python (ChartSession._navigate_intrinsically, or the
  // year/cycle stepper for return/progression children) decides the unit — NO
  // unit ladder in JS. Spec: doc/migration/surfaces/arrow-stepping.md.
  //
  // Active doc must either be a live chart-session document or a view-only
  // child that explicitly borrows selected keys from its parent chart session.
  // Square/Mundane borrow the chart stepper; Graphic Ephemeris only borrows
  // Space reset because its arrow keys belong to the ephemeris year/month plot.
  const navigateKeyWithModifiers = useCallback(
    (
      key: string,
      modifiers: { shift?: boolean; alt?: boolean } = {},
    ) => {
      const activeDoc = activeDocRef.current;
      if (!activeDoc) return;
      const target = navigateTargetForDocument(activeDoc, key);
      if (!target) return;
      const docId = target.documentId;
      const shift = Boolean(modifiers.shift);
      const alt = Boolean(modifiers.alt);
      const intentAt = perfNow();

      // Coalesce equal repeatable intents, but retain their full delta. Classical
      // phase jumps (Shift+Up/Down) stay individually ordered because they are
      // event searches rather than a linear calendar displacement.
      if (steppingRef.current) {
        const pending = pendingStepsRef.current;
        const latest = pending.at(-1);
        const repeatable = !(shift && !alt && (key === "up" || key === "down"));
        if (
          repeatable &&
          latest?.documentId === docId &&
          latest.paintsSnapshot === target.paintsSnapshot &&
          latest?.key === key &&
          latest.shift === shift &&
          latest.alt === alt
        ) {
          latest.repeat += 1;
          latest.intentTimes.push(intentAt);
        } else {
          pending.push({
            documentId: docId,
            paintsSnapshot: target.paintsSnapshot,
            key,
            shift,
            alt,
            intentAt,
            intentTimes: [intentAt],
            repeat: 1,
          });
        }
        return;
      }

      const fire = (
        targetDocId: string,
        paintsSnapshot: boolean,
        k: string,
        shift: boolean,
        alt: boolean,
        stepIntentAt: number,
        repeat: number,
        priorPresentation?: Promise<void>,
      ) => {
        steppingRef.current = true;
        const stepGeneration = ++stepGenerationRef.current;
        let publishedStepSnapshot: ChartRenderSnapshot | null = null;
        // Activation may have queued a first-full-overlay completion for this
        // same document. The step now owns its partial -> full lifecycle, so
        // prevent that older scheduler from starting a competing snapshot GET.
        cancelDeferredFullRefresh(targetDocId);
        // Cancel any queued settle refetch — we are mid-burst again.
        if (settleTimerRef.current != null) {
          clearTimeout(settleTimerRef.current);
          settleTimerRef.current = null;
        }
        if (settleFrameRef.current != null) {
          window.cancelAnimationFrame(settleFrameRef.current);
          settleFrameRef.current = null;
        }
        // A settle GET may already have started when the next key repeat lands.
        // It is now obsolete and must neither contend with nor overwrite the
        // newer step response.
        settleRequestRef.current?.abort();
        settleRequestRef.current = null;
        void workspaceNavigateKey(targetDocId, k, shift, alt, repeat)
          .then(async (res) => {
            // Start transport as soon as the preceding response is published,
            // then hold only this publication until the preceding snapshot has
            // had a presentation boundary. Requests and frames overlap while
            // daemon mutations and visible snapshots remain strictly ordered.
            await priorPresentation;
            if (stepGeneration !== stepGenerationRef.current) return;
            // PAINT from the POST result — the daemon attached the freshly
            // rendered chart (step_fast overlay mode), so we skip the second
            // snapshot GET entirely. The step_fast frame still repaints live
            // wheel geometry plus moving bodies from this stepped snapshot.
            if (paintsSnapshot && res.stepped && res.snapshot) {
              recordChartPerf("chart-step-intent", {
                docId: targetDocId,
                key: k,
                shift,
                alt,
                repeat: res.appliedSteps ?? repeat,
                intentAt: stepIntentAt,
              });
              pushSteppedSnapshot(targetDocId, res.snapshot);
              publishedStepSnapshot = res.snapshot;
            }
          })
          .catch((err) => console.error("[ws-navigate-key]", err))
          .finally(() => {
            if (pendingStepsRef.current.length > 0) {
              // Consume one semantic input now so its daemon request overlaps
              // the current snapshot's presentation. The promise gates only
              // publication of that response, preserving one input per paint.
              const priorPresentation = new Promise<void>((resolve) => {
                stepQueueFrameRef.current = window.requestAnimationFrame(() => {
                  stepQueueFrameRef.current = null;
                  resolve();
                });
              });
              const pending = pendingStepsRef.current[0];
              if (!pending) {
                stepQueueFrameRef.current = null;
                steppingRef.current = false;
                return;
              }
              const pendingIntentAt = pending.intentTimes.shift() ?? pending.intentAt;
              pending.repeat -= 1;
              if (pending.repeat <= 0) {
                pendingStepsRef.current.shift();
              } else {
                pending.intentAt = pending.intentTimes[0] ?? pendingIntentAt;
              }
              fire(
                pending.documentId,
                pending.paintsSnapshot,
                pending.key,
                pending.shift,
                pending.alt,
                pendingIntentAt,
                1,
                priorPresentation,
              );
              return;
            }
            steppingRef.current = false;
            // Burst settled: preserve the just-painted step for two presentation
            // boundaries, then require a short input-quiet window before asking
            // for full semantic truth. Current frame-critical rows already
            // arrived in step_fast; retained term/signal slots remain visible
            // until the authoritative settle swaps them atomically. This keeps
            // a 30 ms held-key stream from launching an obsolete full GET after
            // every individual response.
            if (!paintsSnapshot) {
              return;
            }
            if (settleFrameRef.current != null) {
              window.cancelAnimationFrame(settleFrameRef.current);
            }
            if (settleTimerRef.current != null) {
              clearTimeout(settleTimerRef.current);
            }
            settleFrameRef.current = window.requestAnimationFrame(() => {
              settleFrameRef.current = window.requestAnimationFrame(() => {
                settleFrameRef.current = null;
                if (stepGeneration !== stepGenerationRef.current) return;
                settleTimerRef.current = setTimeout(() => {
                  settleTimerRef.current = null;
                  if (
                    stepGeneration !== stepGenerationRef.current ||
                    steppingRef.current ||
                    pendingStepsRef.current.length > 0
                  ) return;
                  const controller = new AbortController();
                  settleRequestRef.current = controller;
                  recordChartPerf("chart-step-settle-start", {
                    docId: targetDocId,
                    generation: stepGeneration,
                    quietWindowMs: STEP_SETTLE_QUIET_WINDOW_MS,
                  });
                  void fetchDocumentSnapshot(targetDocId, controller.signal)
                    .then((snapshot) => {
                      if (
                        controller.signal.aborted ||
                        stepGeneration !== stepGenerationRef.current ||
                        steppingRef.current ||
                        pendingStepsRef.current.length > 0
                      ) return;
                      const paintedPublishedStep = wasDocumentSnapshotPainted(
                        targetDocId,
                        publishedStepSnapshot,
                      );
                      const overlayOnly = canReusePaintedDocumentCanvas(
                        targetDocId,
                        publishedStepSnapshot,
                        snapshot,
                      );
                      if (!overlayOnly) {
                        recordChartPerf("chart-step-settle-recovery", {
                          docId: targetDocId,
                          generation: stepGeneration,
                          hadPublishedStep: publishedStepSnapshot !== null,
                          hadPaintedStep: paintedPublishedStep,
                        });
                      }
                      pushSteppedSnapshot(
                        targetDocId,
                        overlayOnly
                          ? {
                              ...snapshot,
                              settleOverlayOnly: true,
                              renderInvalidation: {
                                geometry: false,
                                dynamic: false,
                                outerLabel: false,
                                deferredOuterLabel: false,
                              },
                            }
                          : snapshot,
                      );
                    })
                    .catch((err) => {
                      if (isAbortError(err, controller.signal)) return;
                      if (recoverUnknownDocumentSnapshot(err)) return;
                      console.error("[ws-navigate-settle]", err);
                    })
                    .finally(() => {
                      if (settleRequestRef.current === controller) {
                        settleRequestRef.current = null;
                      }
                    });
                }, STEP_SETTLE_QUIET_WINDOW_MS);
              });
            });
          });
      };

      fire(docId, target.paintsSnapshot, key, shift, alt, intentAt, 1);
    },
    [pushSteppedSnapshot],
  );
  const navigateKey = useCallback(
    (key: string, event: KeyboardEvent) => {
      navigateKeyWithModifiers(key, {
        shift: event.shiftKey,
        alt: event.altKey,
      });
    },
    [navigateKeyWithModifiers],
  );

  // Drop any pending settle refetch on unmount.
  useEffect(
    () => () => {
      if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
      if (stepQueueFrameRef.current != null) {
        window.cancelAnimationFrame(stepQueueFrameRef.current);
      }
      if (settleFrameRef.current != null) {
        window.cancelAnimationFrame(settleFrameRef.current);
      }
      settleRequestRef.current?.abort();
    },
    [],
  );

  // allowAlt: true — the shortcut hook drops alt-modified keys by default, but
  // alt+arrow is a canonical unit (minute). Modifiers are forwarded verbatim.
  // ignoreRepeat: false so hold-to-step repeats while the key is held.
  const arrowOpts = { allowAlt: true, ignoreRepeat: false } as const;
  useShortcut("arrowleft", "chart", (event) => navigateKey("left", event), arrowOpts);
  useShortcut("arrowright", "chart", (event) => navigateKey("right", event), arrowOpts);
  useShortcut("arrowup", "chart", (event) => navigateKey("up", event), arrowOpts);
  useShortcut("arrowdown", "chart", (event) => navigateKey("down", event), arrowOpts);
  useShortcut(" ", "chart", (event) => navigateKey("space", event));
  useShortcut("escape", "any", closeTransientWorkspaceUI, { allowTextInput: true });
  useShortcut("?", "any", () => {
    revealKeyHints({ manual: true });
  });

  const toggleComparisonView = useCallback(() => {
    const activeDoc = activeDocRef.current;
    if (!activeDoc) return;
    if (!isChartBearingDocumentKind(activeDoc.kind)) return;
    const docId = activeDoc.id;
    void workspaceToggleComparison(docId)
      .then((res) => {
        if (res.snapshot) pushCommandSnapshot(docId, res.snapshot);
      })
      .catch((err) => console.error("[ws-toggle-comparison]", err));
  }, [pushCommandSnapshot]);

  // TAB — toggle comparison (biwheel) <-> singleton view. Wx-free twin of
  // keyboard_layers TAB -> frame.toggleComparisonView (keyboard_layers.py:123).
  // The daemon flips cs.view_mode and returns a FULL re-rendered snapshot (the
  // toggle adds/removes an entire ring); paint from the POST result. View-only
  // docs have no ChartSession, so skip them — same guard as navigateKey.
  useShortcut("tab", "chart", toggleComparisonView);

  const dispatchManifestCommand = useCallback(
    (command: AriesMenuCommand) => {
      // Recent Charts entries are runtime-built native items, not manifest
      // rows — resolve through the daemon reopen door before the manifest
      // gate (wx onRecentChartMenu, morin.py:15740-15744).
      if (command.startsWith("menu.recent-charts.entry:")) {
        const index = Number(command.slice("menu.recent-charts.entry:".length));
        const item = recentChartsRef.current[index];
        if (!item) return;
        void openRecentChart({
          id: item.id,
          path: item.path,
          chartId: item.chartId,
          label: item.label,
        })
          .catch((err) => {
            // Stale entries were already removed daemon-side (wx FileHistory
            // removal, morin.py:15710-15714); surface the detail and re-sync.
            console.error("[recent-charts-open]", err);
            refreshRecentChartsMenu();
          });
        return;
      }
      // Corpus Packs submenu — daemon-generated check items (one per installed
      // pack). Toggling flips the global active-pack filter via the SAME door
      // the wx inspector pack strip uses (_on_pack_toggled,
      // workspace_shell.py:2558 -> /api/corpus/packs/active), persists daemon-
      // side, then re-syncs the native check state from the returned filter.
      // Handled before the runtime gate because pack toggles are chart-
      // independent (the filter is global, like the wx inspector strip).
      if (command.startsWith("corpus.pack:")) {
        const packId = command.slice("corpus.pack:".length);
        if (!packId) return;
        // Read the live filter to know which way to flip, then persist the
        // toggle and bump the sync tick so the native checks re-pull daemon
        // truth (the active filter, not the click order — wx collapses an
        // all-on set back to None, workspace_shell.py:2490).
        void fetchCorpusPacks()
          .then((payload) => {
            const current = payload.packs.find((pack) => pack.id === packId);
            const nextActive = current ? !current.active : true;
            return setCorpusPackActive(packId, nextActive);
          })
          .then(() => {
            setCorpusPackSyncTick((tick) => tick + 1);
            // Bump packsVersion so the lens picker re-pulls its (pack-gated)
            // discipline/theme catalog AND the active alerts re-evaluate —
            // unison with the title-bar Corpus Packs toggle.
            useWorkspaceStore.getState().bumpPacksVersion();
          })
          .catch((err) => console.error("[corpus-pack-toggle]", err));
        return;
      }
      if (command.startsWith(QUICK_OPTIONS_PREFIX)) {
        runNativeQuickOptionCommand(command);
        return;
      }
      if (command === "toggle-presentation-cursor") {
        runNativeQuickOptionCommand(command);
        return;
      }
      if (!commandIsRuntimeEnabled(command)) return;
      if (command === "toggle-inspector") {
        closeAllRightPanes();
        toggleInspector();
        return;
      }
      if (command === "menu.data") {
        if (activeRadix) requestEditChart(activeRadix);
        return;
      }
      if (command === "menu.import.charts") {
        setImportDrawerOpen(true);
        return;
      }
      // Charts > Elections / Horary theme picks — wx _on_election_theme /
      // _on_horary_theme (morin.py:18910-18915, 18946-18951): picking the
      // already-active theme toggles the lens OFF; otherwise the lens is set
      // (horary themes seed the catalog's default significator context,
      // morin.py:18992) and, with no chart open, the here-and-now fallback
      // door supplies one (morin.py:19057-19114, 19005-19029).
      if (command.startsWith("elections:") || command.startsWith("horary:")) {
        const sep = command.indexOf(":");
        const discipline = command.slice(0, sep);
        const theme = command.slice(sep + 1);
        const store = useWorkspaceStore.getState();
        const lens = store.inspectorLens;
        if (lens && lens.discipline === discipline && lens.theme === theme) {
          store.setInspectorLens(null);
          return;
        }
        void corpusDisciplinesCached()
          .then((catalog) => {
            const themeRow = catalog.disciplines
              .find((d) => d.slug === discipline)
              ?.themes.find((t) => t.label === theme);
            store.setInspectorLens({
              discipline,
              theme,
              context: themeRow?.defaultContext ?? undefined,
            });
          })
          .catch((err) => {
            console.error("[lens-dispatch]", err);
            store.setInspectorLens({ discipline, theme });
          })
          .finally(() => {
            if (!hasActiveRadix) openLensHereNow(discipline, theme);
          });
        return;
      }
      const importKindByCommand: Record<string, ImportKind> = {
        "menu.import.hor-folder": "hor_folder",
        "menu.import.jsonl": "jsonl",
        "menu.import.sfcht": "sfcht",
        "menu.import.aaf": "aaf",
      };
      const importKind = importKindByCommand[command];
      if (importKind) {
        runImportKind(importKind);
        return;
      }
      if (command === "menu.import.aaf-paste") {
        setAafPasteOpen(true);
        return;
      }
      if (SAVE_CHART_COMMANDS.has(command)) {
        // File > Save Horoscope / Save As (DEF-007). Save targets the active
        // chart-bearing document. Root radix docs can silently upsert into
        // their bound collection; derived child charts always ask for a name
        // so a finding can be saved as its own collection record.
        const target = chartSaveTarget(activeDoc, activeRadix);
        if (!target) return;
        const forcePicker = target.id !== activeRadix?.id;
        const openPicker = () =>
          setSavePicker({
            documentId: target.id,
            chartName: chartSaveName(target),
            currentCollectionPath: target.fpath ?? null,
          });
        if (command === "menu.save.as" || forcePicker) {
          openPicker();
          return;
        }
        // ⌘S: silent in-place upsert into the bound collection; if unbound,
        // fall through to the picker.
        void ioSaveChart({ documentId: target.id })
          .then((result) => applyImmediateWorkspaceCommandResult(result, target.id))
          .catch((err) => {
            if (String(err).includes("no file binding")) {
              openPicker();
              return;
            }
            console.error("[io-save]", err);
          });
        return;
      }
      if (command === "menu.export") {
        const host = resolveShellHost();
        if (activeDoc?.kind === "table" && activeDoc.tableId) {
          if (!host.capabilities.nativeFileDialogs) {
            void exportTableDocument(activeDoc, tf).catch((err) => console.error("[export-table]", err));
            return;
          }
          void selectNativeExportPath(activeDoc, tf)
            .then((path) => {
              if (!path) return false;
              return exportTableDocument(activeDoc, tf, path);
            })
            .catch((err) => console.error("[export-table]", err));
          return;
        }
        const currentActiveChart = activeChartRef.current;
        const documentId = currentActiveChart?.document?.documentId ?? activeDoc?.id;
        if (!documentId) return;
        const renderExport = async (kind: "pdf" | "png") => {
          const opts = await fetchOptions();
          return renderRegisteredChartExport(documentId, {
            kind,
            colorMode: opts.export.pdfChartColorMode,
            includeOverlays: kind === "png" || opts.export.pdfIncludeOverlays,
          });
        };
        if (!host.capabilities.nativeFileDialogs) {
          void renderExport("pdf")
            .then((rendered) => exportRenderedChartBytes({
              kind: "pdf",
              filename: `${exportBaseName(activeDoc)}.pdf`,
              documentId,
              title: exportBaseName(activeDoc),
              ...rendered,
            }))
            .then((result) =>
              host.downloadBytes(
                result.filename,
                decodeBase64Bytes(result.dataBase64),
                result.mimeType,
              ),
            )
            .catch((err) => {
              if (!String(err).includes("visible chart renderer unavailable")) throw err;
              return exportActiveChartBytes({
                kind: "pdf",
                filename: `${exportBaseName(activeDoc)}.pdf`,
                documentId,
              }).then((result) => host.downloadBytes(
                result.filename,
                decodeBase64Bytes(result.dataBase64),
                result.mimeType,
              ));
            })
            .catch((err) => console.error("[export-chart]", err));
          return;
        }
        void selectNativeExportPath(activeDoc, tf)
          .then((path) => {
            if (!path) return null;
            const kind = exportKindFromPath(path) === "png" ? "png" : "pdf";
            return renderExport(kind)
              .then((rendered) => exportRenderedChart({
                kind,
                path,
                documentId,
                title: exportBaseName(activeDoc),
                ...rendered,
              }))
              .catch((err) => {
                if (!String(err).includes("visible chart renderer unavailable")) throw err;
                return exportActiveChart({ kind, path, documentId });
              });
          })
          .catch((err) => console.error("[export-chart]", err));
        return;
      }
      if (command === "menu.startup.set") {
        void setCurrentAsStartupChart()
          .then(() => fetchStartupRestoreState())
          .catch((err) => console.error("[startup-set]", err));
        return;
      }
      if (command === "menu.startup.clear") {
        void clearStartupChart().catch((err) => console.error("[startup-clear]", err));
        return;
      }
      if (command === "menu.restore-open-charts") {
        void fetchStartupRestoreState()
          .then((state) => setRestoreOpenCharts(!state.restoreOpenCharts.enabled))
          .catch((err) => console.error("[restore-open-toggle]", err));
        return;
      }
      const registeredTab = manifest?.settingsRegistry?.tabs.find((tab) =>
        tab.menuCommands.includes(command),
      )?.id;
      const settingsTab = registeredTab && isSettingsTabId(registeredTab)
        ? registeredTab
        : null;
      if (settingsTab) {
        openSettings(settingsTab);
        return;
      }
      if (command === "workspace.close-active") {
        if (activeDoc) closeDocument(activeDoc.id);
        return;
      }
      if (command === "cycle-secondary-view") {
        if (activeDoc) {
          supersedePendingStepSettle();
          cycleSecondaryView().catch((err) => console.error("[cycle-secondary]", err));
        }
        return;
      }
      if (command === "toggle-houses") {
        supersedePendingStepSettle();
        void toggleHouses().catch((err) => console.error("[toggle-houses]", err));
        return;
      }
      if (command === "toggle-aspects") {
        // A and an empty-band chart click operate the same transient wheel
        // gate. One input can therefore always undo the other without changing
        // the persisted Appearance > Aspects preference or rebuilding a chart.
        // Restore snapshots left hidden by the former persisted A shortcut so
        // the first press after this fix is reversible too.
        if (activeChartRef.current?.primaryChart.options.showAspects === false) {
          clearAspectSelection();
          supersedePendingStepSettle();
          void patchOptions({ display: { aspects: true } })
            .catch((err) => console.error("[toggle-aspects-restore]", err));
          return;
        }
        toggleHideAllAspects();
        return;
      }
      if (command === "toggle-minor-aspects") {
        supersedePendingStepSettle();
        void toggleMinorAspects().catch((err) => console.error("[toggle-minor-aspects]", err));
        return;
      }
      const tableId = TABLE_ID_BY_MENU_COMMAND[command];
      if (tableId) {
        // Tables menu → embedded generic table child (wx
        // _show_simple_table_in_workspace, morin.py:15898-15915). The daemon
        // builds rows from the live parent chart; workspace-content renders
        // kind:"table" via GenericTableView. ZR routes through handleSelect's
        // dedicated right-pane launcher instead.
        if (tableId === "zodiacal_releasing") {
          handleSelect("table:zodiacal_releasing");
          return;
        }
        if (tableId === "firdaria") {
          handleSelect("table:firdaria");
          return;
        }
        if (tableId === "decennials") {
          handleSelect("table:decennials");
          return;
        }
        if (tableId === "triplicity_directions") {
          handleSelect("table:triplicity_directions");
          return;
        }
        if (tableId === "profections_table") {
          handleSelect("table:profections_table");
          return;
        }
        if (tableId === "eclipses") {
          handleSelect("table:eclipses");
          return;
        }
        if (tableId === "circumambulation") {
          // Circumambulation is a Directions-companion pane tab, not a generic
          // table child — route to the same launcher the sidebar uses.
          handleSelect("directions:circumambulation");
          return;
        }
        const launchParent = findChartLaunchParent(documents, activeDoc?.id ?? null);
        if (launchParent) openTableChild(launchParent.id, tableId);
        return;
      }
      if (command === "menu.table.surveil-studies") {
        // wx onSurveilStudies (morin.py:1702-1834) — the studies manager dialog.
        // The mark/clear actions live on the chart context menu; this menu item
        // opens the management dialog (retained chrome, surveil-store flag).
        openSurveilStudiesDialog();
        return;
      }
      if (command === "menu.help.about") {
        // wx onAbout (morin.py) — the About dialog (aboutdlg.AboutDialog).
        openAboutDialog();
        return;
      }
      if (command === "menu.help.features") {
        openFeatureCatalogPane();
        closeInspectorAndNotes();
        return;
      }
      if (command === "menu.help.help") {
        openHelpPane();
        closeInspectorAndNotes();
        return;
      }
      if (command === "menu.help.license") {
        openLicenseDialog();
        return;
      }
      if (command.startsWith("planetary-return:")) {
        const planetType = Number(command.split(":")[1]);
        const launchParent = chartLauncherParentForAction(
          "planetary-return",
          findChartLaunchParent(documents, activeDoc?.id ?? null),
          activeRadix,
        );
        if (
          launchParent &&
          Number.isFinite(planetType)
        ) {
          const body = planetaryBodyByType(manifest, planetType);
          openReturnWithSavedLocationMode({
            mode: "revolution-location",
            parentRadixId: launchParent.id,
            kind: "planetary-return",
            planetType,
            planetLabel: body?.label,
          });
        }
        return;
      }
      // Alternative-chart check items (Charts > Alternative Charts) are
      // native-menu-only commands — NOT sidebar launchers — so handleSelect's
      // enabledIds guard would reject them. Dispatch directly (commandIsRuntime-
      // Enabled above already gated on an active chart). wx onSquareChart /
      // onMundaneChart (morin.py:14298-14299) open the derived chart child.
      if (command === "menu.chart.square" || command === "menu.chart.mundane") {
        const launchParent = findChartLaunchParent(documents, activeDoc?.id ?? null);
        if (!launchParent) return;
        if (command === "menu.chart.square") openSquareChartChild(launchParent.id);
        else openMundaneChartChild(launchParent.id);
        return;
      }
      handleSelect(command);
    },
    [
      activeDoc,
      activeRadix,
      clearAspectSelection,
      closeAllRightPanes,
      closeDocument,
      commandIsRuntimeEnabled,
      documents,
      handleSelect,
      hasActiveRadix,
      manifest,
      openAboutDialog,
      openFeatureCatalogPane,
      openHelpPane,
      openLicenseDialog,
      openLensHereNow,
      openMundaneChartChild,
      openReturnWithSavedLocationMode,
      openSettings,
      openSquareChartChild,
      openSurveilStudiesDialog,
      openTableChild,
      refreshRecentChartsMenu,
      requestEditChart,
      runImportKind,
      runNativeQuickOptionCommand,
      tf,
      toggleHideAllAspects,
      toggleInspector,
      supersedePendingStepSettle,
    ],
  );

  // Live shortcut rows with commandId dispatch from manifest.shortcuts, so the
  // overlay truth and key bindings cannot diverge. Reference-only/deferred rows
  // remain bound:false and do not register here.
  useManifestShortcutDispatch(manifest, dispatchManifestCommand, commandIsRuntimeEnabled);

  useShortcut("r", "any", (event) => {
    if (event.ctrlKey || event.metaKey) openHereNow();
  }, { allowMeta: true, allowCtrl: true });
  // Cycle secondary view (Ctrl+G / Cmd+G) — menu morin.py:14367, handler
  // onCycleNatalSecondaryRing morin.py:1001. The daemon advances the radix
  // secondary-view overlay (options.showfixstars cycle) and broadcasts
  // options.changed, which re-renders open charts; this handler only fires the
  // intent. No-op when no chart is active (matches the desktop splash/horoscope
  // guard, morin.py:979).
  useShortcut("g", "any", (event) => {
    if ((event.ctrlKey || event.metaKey) && activeDoc) {
      supersedePendingStepSettle();
      cycleSecondaryView().catch((err) => console.error("[cycle-secondary]", err));
    }
  }, { allowMeta: true, allowCtrl: true });

  // Native window caption — the wx handleCaption twin (morin.py:21496):
  // horary main-frame titles use "Name • Horary • date", while sidebar tabs
  // keep "Name (date)" through activeDoc.tabSuffix.
  useEffect(() => {
    let suffix = "";
    const liveTitleSuffix = activeChart?.document?.titleSuffix ?? null;
    if (activeDoc?.isHorary) {
      suffix = liveTitleSuffix
        ? ` • ${liveTitleSuffix}`
        : activeDoc.tabSuffix
          ? ` (${activeDoc.tabSuffix})`
          : "";
    } else if (liveTitleSuffix || activeDoc?.tabSuffix) {
      suffix = ` • ${liveTitleSuffix ?? activeDoc?.tabSuffix}`;
    }
    const title = activeDoc
      ? `${localizedWorkspaceDocumentTitle(activeDoc, t)}${activeDoc.dirty ? " *" : ""}${suffix} — Aries`
      : "Aries";
    let cancelled = false;
    void resolveShellHost()
      .setWindowTitle(title, () => !cancelled)
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeChart?.document?.titleSuffix, activeDoc, t]);

  // App-quit notes flush (DEF-003; wx onExit _flush_notes_if_dirty,
  // morin.py:15638-15645). The notes pane debounce-saves; on quit we force any
  // dirty sidecar buffer (saved or scratch .md, never the chart file) to write
  // now and wait for the in-flight writes before tearing the daemon down.
  const flushDirtyNotes = useCallback(async () => {
    const awaitFlush: Promise<unknown>[] = [];
    window.dispatchEvent(
      new CustomEvent("aries://flush-notes", { detail: { awaitFlush } }),
    );
    if (awaitFlush.length > 0) {
      await Promise.allSettled(awaitFlush);
    }
  }, []);

  // App-quit guard entry (wx onClose, morin.py:15615). The native shell holds
  // the close and emits aries://quit-requested; we run quit-preflight and, if any
  // BOUND+DIRTY radix needs confirmation, raise the Save/Discard/Cancel modal.
  // Nothing dirty (or preflight failed) → flush notes and confirm quit straight
  // through (UNBOUND charts auto-persist daemon-side, never prompted).
  const handleQuitRequested = useCallback(async () => {
    let result;
    try {
      result = await quitPreflight();
    } catch (err) {
      console.error("[quit-preflight]", err);
      await flushDirtyNotes();
      await confirmQuit();
      return;
    }
    if (result.needsPrompt && result.prompts.length > 0) {
      setQuitPrompt({ prompts: result.prompts, busy: false });
      return;
    }
    await flushDirtyNotes();
    await confirmQuit();
  }, [flushDirtyNotes]);

  // Save → write each bound+dirty radix into its bound collection (reuse the
  // shipped POST /api/io/save; in-place save never forks), flush dirty notes, then
  // confirm quit (wx _do_save per dirty session, morin.py:12141, 12146-12172).
  const handleQuitSave = useCallback(async () => {
    const prompts = quitPrompt?.prompts ?? [];
    setQuitPrompt((prev) => (prev ? { ...prev, busy: true } : prev));
    try {
      for (const prompt of prompts) {
        // Bound docs (preflight only lists bound+dirty) upsert in place; if a
        // doc somehow lacks a binding the daemon raises and we surface it
        // rather than silently dropping the save.
        await ioSaveChart({ documentId: prompt.documentId });
      }
      await flushDirtyNotes();
    } catch (err) {
      console.error("[quit-save]", err);
      setQuitPrompt((prev) => (prev ? { ...prev, busy: false } : prev));
      return;
    }
    setQuitPrompt(null);
    await confirmQuit();
  }, [flushDirtyNotes, quitPrompt]);

  // Discard → flush dirty notes (sidecar lifecycle is decoupled from the chart
  // Record; notes are never discarded by discarding chart edits, wx onExit
  // flushes them regardless), then confirm quit (wx "No", morin.py:12143).
  const handleQuitDiscard = useCallback(async () => {
    setQuitPrompt((prev) => (prev ? { ...prev, busy: true } : prev));
    await flushDirtyNotes();
    setQuitPrompt(null);
    await confirmQuit();
  }, [flushDirtyNotes]);

  // Cancel → abort the quit, leave everything open (wx onClose early return,
  // morin.py:15616-15617). Native close was already prevented; not calling
  // confirm_quit leaves the window alive.
  const handleQuitCancel = useCallback(() => {
    setQuitPrompt(null);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void resolveShellHost()
      .listenQuitRequested(() => {
        void handleQuitRequested();
      })
      .then((stop) => {
        if (cancelled) {
          safeShellUnlisten(stop);
          return;
        }
        unlisten = stop;
      })
      .catch(() => {
        // Hosts without native quit events can ignore this listener.
      });
    return () => {
      cancelled = true;
      safeShellUnlisten(unlisten);
    };
  }, [handleQuitRequested]);

  const browserDirtySignature = useMemo(
    () => documents.map((doc) => `${doc.id}:${doc.dirty ? 1 : 0}`).join("|"),
    [documents],
  );
  useEffect(() => {
    const hasDirtyDocuments = () => documents.some((doc) => doc.dirty);
    return resolveShellHost().installBeforeUnloadGuard(hasDirtyDocuments);
  }, [browserDirtySignature, documents]);

  const chartNavbar: ModeHintRailProps = {
    visible:
      keyHintsVisible &&
      (CHART_UPPER_NAVIGATION_BAR_ENABLED || keyHintsPlacement !== "top"),
    placement: keyHintsPlacement,
    revealToken: keyHintsRevealToken,
    autoHideMs: KEY_HINT_VISIBLE_MS,
    overlay: false,
    hasChart: activeChartPresent,
    hasComparisonChart: activeChartHasComparison,
    parentDocumentId: activeDoc?.parentDocumentId,
    comparisonSourceName: activeChartComparisonName,
    viewMode: activeChartViewMode,
    chartVisualMode: activeDoc?.chartVisualMode,
    launcherKind: activeDoc?.launcherKind,
    compoundKind: activeDoc?.compoundKind,
    kind: activeDoc?.kind,
    supplementaryFeatureKind: activeDoc?.supplementaryFeatureKind,
    onToggleComparison: toggleComparisonView,
    onHintInteraction: renewKeyHints,
    onNavigateHint: navigateKeyWithModifiers,
  };

  return (
    <ThemeProvider>
      <>
        <LicenseStartupController />
        <ShellMenuListener onCommand={dispatchManifestCommand} />
        <BrowserMenuBar
          manifest={manifest}
          recentCharts={recentChartsMenuItems}
          onCommand={dispatchManifestCommand}
          isCommandEnabled={commandIsRuntimeEnabled}
        />
        <WorkspaceFrame
          chart={activeChart}
          activeDocument={activeDoc}
          manifest={manifest}
          documents={documents}
          onSelect={handleSelect}
          onCloseDocument={closeDocument}
          onReorder={reorderSibling}
          onSolarAverageWindowSelect={handleSolarAverageWindowSelect}
          onOpenSettings={openSettings}
          onMenuCommand={dispatchManifestCommand}
          isMenuCommandEnabled={commandIsRuntimeEnabled}
          onRevealKeyHints={
            keyHintsAllowed && keyHintsAutoAllowed ? revealKeyHintsAtEdge : undefined
          }
        >
          <ActiveDocumentSurface
            doc={activeDoc}
            chart={activeChart}
            navbar={chartNavbar}
          />
        </WorkspaceFrame>
        <AmbientSpotlight
          key={spotlight.version}
          open={spotlight.open}
          initialText={spotlight.initialText}
          onOpenChange={setSpotlightOpen}
          onCommit={handleSpotlightCommit}
        />
        {settingsOpen ? (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            initialTab={settingsInitialTab}
            onOptionsPatched={handleOptionsPatched}
          />
        ) : null}
        <ImportResultDialog
          result={importResult}
          onClose={() => setImportResult(null)}
        />
        <ImportChartsDrawer
          open={importDrawerOpen}
          onOpenChange={setImportDrawerOpen}
          onImport={runImportKind}
          onPasteAaf={() => {
            setImportDrawerOpen(false);
            setAafPasteOpen(true);
          }}
        />
        <AafPasteImportDialog
          open={aafPasteOpen}
          onOpenChange={setAafPasteOpen}
          onImported={(summary) => setImportResult({ summary, error: null })}
          onError={(error) => setImportResult({ summary: null, error })}
        />
        {editorOpen ? (
          <ChartEditorDialog
            open={editorOpen}
            onOpenChange={(open) => {
              setEditorOpen(open);
              if (!open) setEditTarget(null);
            }}
            onSaved={handleEditorSaved}
            editTarget={editTarget}
          />
        ) : null}
        <PlanetaryReturnBodyDialog
          open={picker?.mode === "planetary-return-body"}
          bodies={picker?.mode === "planetary-return-body" ? picker.bodies : []}
          onPick={(body) => {
            if (picker?.mode !== "planetary-return-body") return;
            openReturnWithSavedLocationMode({
              mode: "revolution-location",
              parentRadixId: picker.parentRadixId,
              kind: "planetary-return",
              when: picker.when,
              planetType: body.planetType,
              planetLabel: body.label,
            });
          }}
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
        />
        <RevolutionLocationDialog
          key={
            picker?.mode === "revolution-location"
              ? `${picker.parentRadixId}:${picker.kind}:${picker.planetType ?? ""}`
              : "revolution-location-closed"
          }
          request={picker?.mode === "revolution-location" ? picker : null}
          onOpen={(request, binding) => {
            openSupplementaryChild(request.parentRadixId, request.kind, {
              planetType: request.planetType ?? null,
              binding,
              when: request.when ?? null,
            });
            setPicker(null);
          }}
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
        />
        {savePicker !== null ? (
          <SaveToCollectionDialog
            key={savePicker ? `save:${savePicker.documentId}:${savePicker.chartName}` : "save-closed"}
            open={savePicker !== null}
            initialName={savePicker?.chartName ?? ""}
            currentCollectionPath={savePicker?.currentCollectionPath ?? null}
            onConfirm={(name, collection) => {
              const target = savePicker;
              setSavePicker(null);
              if (!target) return;
              void ioSaveChart({ documentId: target.documentId, collection, name })
                .then((result) => applyImmediateWorkspaceCommandResult(result, target.documentId))
                .catch((err) => console.error("[io-save]", err));
            }}
            onOpenChange={(open) => {
              if (!open) setSavePicker(null);
            }}
          />
        ) : null}
        <DiscardCloseDialog
          pending={pendingClose}
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            if (pendingClose) void closeDocumentCommand(pendingClose.docId);
            setPendingClose(null);
          }}
        />
        <QuitConfirmDialog
          prompt={quitPrompt}
          onSave={() => void handleQuitSave()}
          onDiscard={() => void handleQuitDiscard()}
          onCancel={handleQuitCancel}
        />
        {surveilStudiesDialogOpen ? <SurveilStudiesDialog /> : null}
        {aboutDialogOpen ? <AboutDialog /> : null}
        {licenseDialogOpen ? <LicenseDialog /> : null}
      </>
    </ThemeProvider>
  );
}

function progressionDirectionsMethod(id: string): "secondary" | "minor" | "tertiary" | null {
  if (id === "secondary-progression") return "secondary";
  if (id === "minor-progression") return "minor";
  if (id === "tertiary-progression") return "tertiary";
  return null;
}

/**
 * Planetary-return body picker. The desktop's Revolutions menu offers a
 * discrete Mercury/Venus/Mars/Jupiter/Saturn Return; the daemon ships that body
 * list on the planetary-return manifest action. Picking a body opens the
 * planetary-return child for that body's planet_type (threaded through
 * /api/workspace/open). A compact menu, not a chart-list picker.
 */
function PlanetaryReturnBodyDialog({
  open,
  bodies,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  bodies: PlanetaryReturnBody[];
  onPick: (body: PlanetaryReturnBody) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>{t("home.planetaryReturnTitle")}</DialogTitle>
          <DialogDescription>{t("home.planetaryReturnDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          {bodies.map((body) => (
            <Button
              key={body.planetType}
              variant="ghost"
              className="justify-start"
              onClick={() => onPick(body)}
            >
              {body.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevolutionLocationDialog({
  request,
  onOpen,
  onOpenChange,
}: {
  request: RevolutionLocationRequest | null;
  onOpen: (
    request: RevolutionLocationRequest,
    binding: SupplementaryBindingPayload,
  ) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [locationMode, setLocationMode] = useState<"birthplace" | "relocated">("birthplace");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PlaceCandidate[] | null>(null);
  const [selected, setSelected] = useState<PlaceCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(() => {
    const q = query.trim();
    if (q.length < 3) {
      setError(t("home.searchMinChars"));
      return;
    }
    setBusy(true);
    setError(null);
    setCandidates(null);
    resolvePlace(q)
      .then((rows) => {
        if (rows.length === 0) {
          setError(t("home.noMatchingPlace"));
          return;
        }
        setCandidates(rows);
        if (rows.length === 1) {
          setSelected(rows[0]);
          setQuery(rows[0].label || rows[0].name);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [query, t]);

  const openDisabled = !request || (locationMode === "relocated" && selected === null);
  const title = request
    ? request.kind === "solar-revolution"
      ? t("home.solarRevolutionTitle")
      : request.kind === "lunar-revolution"
        ? t("home.lunarRevolutionTitle")
        : request.planetLabel
          ? t("home.namedReturnTitle", { planetLabel: request.planetLabel })
          : t("home.planetaryReturnTitle")
    : t("home.returnTitle");

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-[length:var(--aries-font-size-small)]">
          <div className="grid grid-cols-2 gap-1 rounded border border-border/60 p-1">
            <button
              type="button"
              onClick={() => setLocationMode("birthplace")}
              className={
                "rounded px-2 py-1.5 text-left " +
                (locationMode === "birthplace"
                  ? "bg-foreground/85 text-background"
                  : "text-foreground/75 hover:bg-muted")
              }
            >
              {t("home.birthplace")}
            </button>
            <button
              type="button"
              onClick={() => setLocationMode("relocated")}
              className={
                "rounded px-2 py-1.5 text-left " +
                (locationMode === "relocated"
                  ? "bg-foreground/85 text-background"
                  : "text-foreground/75 hover:bg-muted")
              }
            >
              {t("home.relocate")}
            </button>
          </div>
          {locationMode === "relocated" ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                search();
              }}
            >
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                    setSelected(null);
                  }}
                  placeholder={t("home.searchCityPlaceholder")}
                  className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-foreground outline-none focus:border-border"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded border border-border/60 px-3 py-1 text-foreground/85 disabled:opacity-50"
                >
                  {busy ? "..." : t("home.search")}
                </button>
              </div>
              {error ? <div className="text-[length:var(--aries-font-size-small)] text-foreground/55">{error}</div> : null}
              {candidates && candidates.length > 0 ? (
                <div className="max-h-40 overflow-y-auto rounded border border-border/50">
                  {candidates.map((candidate, index) => {
                    const active = selected === candidate;
                    return (
                      <button
                        key={`${candidate.label}-${candidate.countryCode}-${index}`}
                        type="button"
                        onClick={() => {
                          setSelected(candidate);
                          setQuery(candidate.label || candidate.name);
                        }}
                        className={
                          "flex w-full items-center justify-between gap-3 border-b border-border/40 px-2 py-1.5 text-left last:border-b-0 hover:bg-muted " +
                          (active ? "bg-muted" : "")
                        }
                      >
                        <span className="min-w-0 truncate text-foreground/90">
                          {candidate.label}
                        </span>
                        <span className="shrink-0 truncate text-[length:var(--aries-font-size-small)] text-foreground/50">
                          {candidate.countryName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {selected ? (
                <div className="truncate text-[length:var(--aries-font-size-small)] text-foreground/60">
                  {selected.name} - GMT {selected.plus ? "+" : "-"}
                  {selected.zoneHour}:{String(selected.zoneMin).padStart(2, "0")}
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("home.cancel")}
          </Button>
          <Button
            disabled={openDisabled}
            onClick={() => {
              if (!request) return;
              onOpen(
                request,
                locationMode === "relocated" && selected
                  ? returnBindingFromCandidate(selected)
                  : birthplaceReturnBinding(),
              );
            }}
          >
            {t("home.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportResultDialog({
  result,
  onClose,
}: {
  result: { summary: ImportSummary | null; error: string | null } | null;
  onClose: () => void;
}) {
  const t = useT();
  const summary = result?.summary ?? null;
  const error = result?.error ?? null;
  const duplicatePreview = summary?.skippedDuplicates.slice(0, 6) ?? [];
  const errorPreview = summary?.errors.slice(0, 4) ?? [];
  return (
    <Dialog open={result !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{error ? t("home.importFailedTitle") : t("home.importCompleteTitle")}</DialogTitle>
          {summary ? (
            <DialogDescription>
              {t("home.importedSummary", {
                count: summary.importedCount,
                destination: summary.destinationCollectionName || t("home.chartCollectionFallback"),
              })}
            </DialogDescription>
          ) : error ? (
            <DialogDescription>{error}</DialogDescription>
          ) : null}
        </DialogHeader>
        {summary ? (
          <div className="grid gap-2 text-[length:var(--aries-font-size-small)] text-foreground/75">
            <div>{t("home.filesChecked", { count: summary.filesConsidered })}</div>
            <div>{t("home.skippedDuplicates", { count: summary.skippedDuplicateCount })}</div>
            {duplicatePreview.length > 0 ? (
              <div className="rounded border border-border/50 p-2">
                {duplicatePreview.map((item) => (
                  <div key={item} className="truncate">{item}</div>
                ))}
                {summary.skippedDuplicates.length > duplicatePreview.length ? (
                  <div>{t("home.andMore", { count: summary.skippedDuplicates.length - duplicatePreview.length })}</div>
                ) : null}
              </div>
            ) : null}
            {errorPreview.length > 0 ? (
              <div className="rounded border border-border/50 p-2">
                {errorPreview.map((item) => (
                  <div key={`${item.path}:${item.message}`} className="truncate">
                    {item.path}: {item.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>{t("home.ok")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportChartsDrawer({
  open,
  onOpenChange,
  onImport,
  onPasteAaf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (kind: ImportKind) => void;
  onPasteAaf: () => void;
}) {
  const t = useT();
  const importFromFile = (kind: ImportKind) => {
    onOpenChange(false);
    onImport(kind);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="sm">
        <SheetHeader className="border-b border-border/60 pr-12">
          <SheetTitle>{t("home.importChartsTitle")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("home.importChartsDescription")}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-1 px-3 pb-4">
          <ImportChartsDrawerButton
            icon={FolderOpen}
            label={t("home.importHorFolder")}
            onClick={() => importFromFile("hor_folder")}
          />
          <ImportChartsDrawerButton
            icon={FileJson}
            label={t("home.importJsonl")}
            onClick={() => importFromFile("jsonl")}
          />
          <ImportChartsDrawerButton
            icon={Database}
            label={t("home.importSfcht")}
            onClick={() => importFromFile("sfcht")}
          />
          <ImportChartsDrawerButton
            icon={FileText}
            label={t("home.importAaf")}
            onClick={() => importFromFile("aaf")}
          />
          <div className="my-2 border-t border-border/60" />
          <ImportChartsDrawerButton
            icon={ClipboardPaste}
            label={t("home.importPasteAaf")}
            onClick={onPasteAaf}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImportChartsDrawerButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 w-full justify-start rounded-md px-2.5 text-left"
      onClick={onClick}
    >
      <Icon data-icon="inline-start" className="size-4" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function AafPasteImportDialog({
  open,
  onOpenChange,
  onImported,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (summary: ImportSummary) => void;
  onError: (error: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [collections, setCollections] = useState<ChartCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [pending, setPending] = useState(false);
  const creatingNew = selectedCollection === "__new__";
  const collectionValue = creatingNew ? newCollectionName.trim() : selectedCollection;
  const canImport = text.trim().length > 0 && collectionValue.length > 0 && !pending;

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    listCollections(ctrl.signal)
      .then((list) => {
        setCollections(list);
        const preferred = list.find((collection) => collection.isDefault) ?? list[0] ?? null;
        setSelectedCollection(preferred ? preferred.path : "__new__");
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setCollections([]);
        setSelectedCollection("__new__");
      });
    return () => ctrl.abort();
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rawText = text.trim();
    if (!rawText || !collectionValue) return;
    setPending(true);
    try {
      const summary = await importCharts({
        kind: "aaf",
        paths: [],
        text: rawText,
        collection: collectionValue,
      });
      setText("");
      setNewCollectionName("");
      onOpenChange(false);
      onImported(summary);
    } catch (err) {
      onOpenChange(false);
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && !pending) {
      setText("");
      setNewCollectionName("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent size="reading" className="h-[min(44rem,calc(100vh-3rem))] overflow-hidden">
        <form onSubmit={submit} className="grid h-full min-h-0 grid-rows-[auto_minmax(12rem,1fr)_auto_auto_auto] gap-4">
          <DialogHeader>
            <DialogTitle>{t("home.pasteAafTitle")}</DialogTitle>
            <DialogDescription>
              {t("home.pasteAafDescription")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-full min-h-0 resize-none overflow-auto font-mono text-[length:var(--aries-font-size-small)]"
            spellCheck={false}
            autoFocus
          />
          <label className="flex flex-col gap-1 text-[length:var(--aries-font-size-small)] text-[color:var(--aries-text-primary)]">
            <span className="text-[color:var(--aries-text-muted)]">{t("home.collection")}</span>
            <select
              value={selectedCollection}
              onChange={(event) => setSelectedCollection(event.currentTarget.value)}
              className="rounded border border-[color:var(--aries-border-subtle)] bg-[color:var(--aries-surface)] px-2 py-1.5 text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
            >
              {collections.map((collection) => (
                <option key={collection.path} value={collection.path}>
                  {collection.name} ({collection.count})
                </option>
              ))}
              <option value="__new__">{t("home.newCollectionOption")}</option>
            </select>
          </label>
          {creatingNew ? (
            <label className="flex flex-col gap-1 text-[length:var(--aries-font-size-small)]">
              <span className="text-[color:var(--aries-text-muted)]">{t("home.newCollectionName")}</span>
              <input
                value={newCollectionName}
                placeholder="Astro-Seek"
                onChange={(event) => setNewCollectionName(event.currentTarget.value)}
                className="rounded border border-[color:var(--aries-border-subtle)] bg-transparent px-2 py-1.5 text-[color:var(--aries-text-primary)] outline-none focus:border-[color:var(--aries-focus-ring)]"
              />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
              {t("home.cancel")}
            </Button>
            <Button type="submit" disabled={!canImport}>
              {pending ? t("home.importing") : t("home.import")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Close-cascade discard confirmation. Mirrors wx
 * _confirm_discard_or_save_current_chart (morin.py:11544): closing a dirty,
 * file-backed, radix-owning tab asks before discarding. Only shown when the
 * daemon-derived predicate (promptWorthyNames) yields names.
 */
function DiscardCloseDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { docId: string; names: string[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const names = pending?.names ?? [];
  const label = names.length === 1 ? names[0] : names.join(", ");
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("home.discardTitle")}</DialogTitle>
          <DialogDescription>
            {names.length > 0
              ? t("home.discardNamedBody", { label })
              : t("home.discardTitle")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("home.keepOpen")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("home.discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// App-quit Save/Discard/Cancel modal (policy-chart-lifecycle §3; wx
// _confirm_discard_or_save_all_dirty_sessions, morin.py:12146-12172). Lists the
// BOUND+DIRTY radixes that need a decision before quit. Save writes each into its
// bound collection; Discard quits without saving; Cancel aborts the quit. UNBOUND
// charts never reach here — they auto-persist daemon-side.
function QuitConfirmDialog({
  prompt,
  onSave,
  onDiscard,
  onCancel,
}: {
  prompt: { prompts: QuitPreflightPrompt[]; busy: boolean } | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const prompts = prompt?.prompts ?? [];
  const busy = prompt?.busy ?? false;
  const names = prompts.map((p) => p.label || t("home.untitled"));
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("home.quitTitle")}</DialogTitle>
          <DialogDescription>
            {names.length === 1
              ? t("home.quitSingleBody", { name: names[0] })
              : t("home.quitMultiBody", { count: names.length })}
          </DialogDescription>
        </DialogHeader>
        {names.length > 1 ? (
          <ul className="list-disc pl-5 text-sm">
            {names.map((name, i) => (
              <li key={`${name}:${i}`}>{name}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("home.cancel")}
          </Button>
          <Button variant="destructive" onClick={onDiscard} disabled={busy}>
            {t("home.discard")}
          </Button>
          <Button onClick={onSave} disabled={busy}>
            {busy ? t("home.saving") : t("home.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveDocumentSurface({
  doc,
  chart,
  navbar,
}: {
  doc: WorkspaceDocument | null;
  chart: ChartRenderSnapshot | null;
  navbar?: ModeHintRailProps | null;
}) {
  return <WorkspaceContent chart={chart} activeDoc={doc} navbar={navbar} />;
}

type ActiveDocumentChart = {
  chart: ChartRenderSnapshot | null;
};

const STEP_SETTLE_QUIET_WINDOW_MS = 32;
// The step-fast overlay keeps every visible slot populated. Two presentation
// boundaries plus this sub-repeat quiet window prevent obsolete full exports
// from contending with a held-key stream while preserving a prompt single-step
// authoritative refresh.
const DEFERRED_FULL_REFRESH_SETTLE_MS = 0;
const deferredFullRefreshInFlight = new Set<string>();
type DeferredFullRefreshSchedule = {
  raf1: number | null;
  raf2: number | null;
  timeout: number | null;
};
const deferredFullRefreshSchedules = new Map<string, DeferredFullRefreshSchedule>();

function cancelDeferredFullRefresh(docId: string): void {
  const schedule = deferredFullRefreshSchedules.get(docId);
  if (!schedule) return;
  if (schedule.raf1 != null) window.cancelAnimationFrame(schedule.raf1);
  if (schedule.raf2 != null) window.cancelAnimationFrame(schedule.raf2);
  if (schedule.timeout != null) window.clearTimeout(schedule.timeout);
  deferredFullRefreshSchedules.delete(docId);
}

function scheduleDeferredFullRefresh(docId: string, callback: () => void): void {
  cancelDeferredFullRefresh(docId);
  const schedule: DeferredFullRefreshSchedule = {
    raf1: null,
    raf2: null,
    timeout: null,
  };
  deferredFullRefreshSchedules.set(docId, schedule);

  const startSettleTimer = () => {
    if (deferredFullRefreshSchedules.get(docId) !== schedule) return;
    schedule.timeout = window.setTimeout(() => {
      if (deferredFullRefreshSchedules.get(docId) !== schedule) return;
      deferredFullRefreshSchedules.delete(docId);
      callback();
    }, DEFERRED_FULL_REFRESH_SETTLE_MS);
  };

  schedule.raf1 = window.requestAnimationFrame(() => {
    schedule.raf1 = null;
    schedule.raf2 = window.requestAnimationFrame(() => {
      schedule.raf2 = null;
      startSettleTimer();
    });
  });
}

function isChartBearingDocumentKind(kind: WorkspaceDocument["kind"] | undefined): boolean {
  return (
    kind !== undefined &&
    kind !== "astrocart" &&
    kind !== "directions" &&
    kind !== "astrolabe" &&
    kind !== "astrolog-sphere" &&
    kind !== "square-chart" &&
    kind !== "mundane-chart" &&
    kind !== "ephemeris" &&
    kind !== "transit-search" &&
    kind !== "table"
  );
}

function navigateTargetForDocument(
  doc: WorkspaceDocument,
  key: string,
): { documentId: string; paintsSnapshot: boolean } | null {
  if (isChartBearingDocumentKind(doc.kind)) {
    return { documentId: doc.id, paintsSnapshot: true };
  }
  if (
    (doc.kind === "square-chart" || doc.kind === "mundane-chart") &&
    doc.parentDocumentId
  ) {
    return { documentId: doc.parentDocumentId, paintsSnapshot: false };
  }
  if (doc.kind === "ephemeris" && key === "space" && doc.parentDocumentId) {
    return { documentId: doc.parentDocumentId, paintsSnapshot: false };
  }
  return null;
}

function useActiveDocumentChart(
  doc: WorkspaceDocument | null,
): ActiveDocumentChart {
  const [chart, setChart] = useState<ChartRenderSnapshot | null>(null);
  const retainedDocIdRef = useRef<string | null>(null);
  const selectedDocId = doc?.id ?? null;
  const lastSessionChange = useDaemonWorkspaceStore((state) => {
    const change = state.lastSessionChange;
    if (
      selectedDocId &&
      change?.changeReason === "step" &&
      change.docId === selectedDocId &&
      change.rebuiltChildIds.length === 0
    ) {
      // The navigate POST's steppedSnapshot is the sole paint source for a
      // pure self-step. Returning one stable value here prevents the websocket
      // notification from re-rendering HomeClient while that POST is in flight.
      return null;
    }
    return change;
  });
  const steppedSnapshot = useDaemonWorkspaceStore((s) => s.steppedSnapshot);
  const commandSnapshot = useDaemonWorkspaceStore((s) => s.commandSnapshot);
  const pushCommandSnapshot = useDaemonWorkspaceStore((s) => s.pushCommandSnapshot);

  // Tracking individual fields so unrelated doc mutations (e.g. closing a
  // sibling tab) don't trigger a refetch on the active tab. displayDatetime is
  // daemon-owned, but a pure self-step already paints from the navigate POST
  // snapshot below; including displayDatetime here would turn every step's
  // session.changed event into a second full snapshot GET.
  const docId = selectedDocId;
  const docKind = doc?.kind;
  const chartBearingDoc = docId && isChartBearingDocumentKind(docKind);

  useEffect(() => {
    if (chartBearingDoc) return;
    retainedDocIdRef.current = null;
    const timer = window.setTimeout(() => setChart(null), 0);
    return () => window.clearTimeout(timer);
  }, [chartBearingDoc]);

  // Live-refresh on session.changed. Cases that force a refetch:
  //   1. OPTIONS — a settings change re-rendered every chart (changeReason
  //      'options'); refetch the visible wheel against the mutated options.
  //   2. CHILD-REBUILD (mirrors morin._refresh_workspace_child_sessions): when a
  //      parent's cursor moves the controller rebuilds its children and lists
  //      them in rebuiltChildIds. If the active doc is one of those, refetch.
  //   3. SELF non-step (e.g. 'normal' / reset) — refetch the snapshot.
  //
  // A pure SELF-STEP ('step' on this doc) is DELIBERATELY excluded: the navigate
  // POST already returned the rendered snapshot and we painted it via the
  // steppedSnapshot channel (see the effect below). Refetching here would be the
  // exact second round-trip ISSUE 1 eliminated and would also clobber the cheap
  // step_fast paint with a full GET mid-burst.
  const isSelfStep =
    !!docId &&
    !!lastSessionChange &&
    lastSessionChange.changeReason === "step" &&
    lastSessionChange.docId === docId &&
    !lastSessionChange.rebuiltChildIds.includes(docId);
  const sessionRefreshTick =
    docId &&
    lastSessionChange &&
    !isSelfStep &&
    (lastSessionChange.docId === docId ||
      lastSessionChange.rebuiltChildIds.includes(docId))
      ? lastSessionChange.seq
      : 0;
  useEffect(() => {
    if (!docId || !isChartBearingDocumentKind(docKind)) {
      return;
    }
    // View-only daemon documents have no chart session; their own surfaces fetch
    // their own payloads and must not ask for a document snapshot.
    const controller = new AbortController();
    const cleanup = () => {
      cancelDeferredFullRefresh(docId);
      controller.abort();
    };
    const activatedAt = perfNow();
    const retainedDocId = retainedDocIdRef.current;
    // EVERY chart-bearing doc renders by document id from the LIVE daemon
    // session — no name+kind+when rebuild. here-now, synastry (COMPOUND
    // biwheel), supplementary children + root radix all resolve through this one
    // path, so a stepped chart shows the daemon's actual stepped chart. This is
    // the "stupid skin" contract: the skin draws what the session holds and
    // computes nothing. (Astrocart is excluded above — it has no chart session
    // and renders via the iframe surface in workspace-content.tsx.)
    const applyReadySnapshot = (
      snapshot: ChartRenderSnapshot,
      source: string,
      extra: Record<string, unknown> = {},
    ) => {
      retainedDocIdRef.current = docId;
      recordChartPerf("chart-activation-ready", {
        docId,
        source,
        cacheHit: true,
        retainedDocId,
        ms: perfNow() - activatedAt,
        ...extra,
      });
      recordStartupPerfOnce("first-chart-ready", {
        docId,
        source,
        cacheHit: true,
        ms: Math.round(perfNow() - activatedAt),
      });
      setChart(snapshot);
      if (snapshot.overlayRenderMode !== "full" && sessionRefreshTick === 0) {
        scheduleDeferredFullRefresh(docId, () => {
          if (controller.signal.aborted) return;
          if (getDocumentSnapshot(docId)?.overlayRenderMode === "full") return;
          if (deferredFullRefreshInFlight.has(docId)) return;
          deferredFullRefreshInFlight.add(docId);
          const refreshStartedAt = perfNow();
          void fetchDocumentSnapshot(docId)
            .then((fullSnapshot) => {
              if (controller.signal.aborted) return;
              // A newer command/step snapshot owns the document now. Do not let
              // this activation-tail request overwrite it; that newer path will
              // schedule its own authoritative completion.
              if (getDocumentSnapshot(docId) !== snapshot) return;
              recordChartPerf("chart-deferred-full-ready", {
                docId,
                source,
                ms: perfNow() - activatedAt,
                fetchMs: perfNow() - refreshStartedAt,
              });
              // Publish through the same canonical channel as the initial
              // command snapshot. Merely setting local chart state cannot win
              // while commandSnapshot has render priority, which left phasis,
              // cazimi and eclipse rows permanently stuck in deferred mode.
              // Deferred activation still owes one outer-label paint; an
              // activated step_fast cache already painted every canvas layer.
              const paintedActivationSnapshot = wasDocumentSnapshotPainted(
                docId,
                snapshot,
              );
              const overlayOnly = canReusePaintedDocumentCanvas(
                docId,
                snapshot,
                fullSnapshot,
              );
              if (!overlayOnly) {
                recordChartPerf("chart-activation-settle-recovery", {
                  docId,
                  source,
                  hadPaintedSnapshot: paintedActivationSnapshot,
                });
              }
              pushCommandSnapshot(
                docId,
                overlayOnly
                  ? {
                      ...fullSnapshot,
                      settleOverlayOnly: snapshot.overlayRenderMode === "step_fast",
                      renderInvalidation: {
                        geometry: false,
                        dynamic: false,
                        outerLabel: snapshot.overlayRenderMode === "deferred",
                        deferredOuterLabel: false,
                      },
                    }
                  : fullSnapshot,
              );
            })
            .catch((err) => {
              if (isAbortError(err, controller.signal)) return;
              if (recoverUnknownDocumentSnapshot(err)) return;
              console.error(`[chart-full-overlay] ${docId}`, err);
            })
            .finally(() => {
              deferredFullRefreshInFlight.delete(docId);
            });
        });
      }
    };
    const fetchAndApply = () => {
      const sourceStore = useDaemonWorkspaceStore.getState();
      const sourceStepped =
        sourceStore.steppedSnapshot?.docId === docId ? sourceStore.steppedSnapshot : null;
      const sourceCommand =
        sourceStore.commandSnapshot?.docId === docId ? sourceStore.commandSnapshot : null;
      const request = sessionRefreshTick === 0
        ? fetchCachedDocumentSnapshot(docId)
        : fetchDocumentSnapshot(docId, controller.signal);
      request
        .then((snapshot) => {
          if (controller.signal.aborted) return;
          retainedDocIdRef.current = docId;
          recordChartPerf("chart-activation-ready", {
            docId,
            source: "fetch",
            cacheHit: false,
            retainedDocId,
            ms: perfNow() - activatedAt,
          });
          recordStartupPerfOnce("first-chart-ready", {
            docId,
            source: "fetch",
            cacheHit: false,
            ms: Math.round(perfNow() - activatedAt),
          });
          if (sessionRefreshTick !== 0) {
            const currentStore = useDaemonWorkspaceStore.getState();
            const currentStepped =
              currentStore.steppedSnapshot?.docId === docId
                ? currentStore.steppedSnapshot
                : null;
            const currentCommand =
              currentStore.commandSnapshot?.docId === docId
                ? currentStore.commandSnapshot
                : null;
            // A step or newer command that arrived while this refresh was in
            // flight already owns the visible frame. Its own snapshot carries
            // the current options, so an older options completion must not win.
            if (currentStepped !== sourceStepped || currentCommand !== sourceCommand) {
              return;
            }
            // Swap the retained frame and refreshed frame in one store update.
            // pushCommandSnapshot also clears the same-doc stepped frame, so
            // React can never fall through to the pre-step local chart.
            pushCommandSnapshot(docId, snapshot);
            return;
          }
          setChart(snapshot);
        })
        .catch((err) => {
          if (isAbortError(err, controller.signal)) return;
          if (recoverUnknownDocumentSnapshot(err)) return;
          console.error(`[chart] ${docId}`, err);
        });
    };
    const cached = getDocumentSnapshot(docId);
    if (cached) {
      applyReadySnapshot(cached, "cache");
      if (sessionRefreshTick === 0) {
        return cleanup;
      }
    } else {
      const commandPushed = useDaemonWorkspaceStore.getState().commandSnapshot;
      if (sessionRefreshTick === 0 && commandPushed?.docId === docId) {
        rememberDocumentSnapshot(docId, commandPushed.snapshot);
        applyReadySnapshot(commandPushed.snapshot, "command-pushed", {
          commandSnapshot: true,
        });
        return cleanup;
      }
      const pushed = useDaemonWorkspaceStore.getState().steppedSnapshot;
      if (sessionRefreshTick === 0 && pushed?.docId === docId) {
        rememberDocumentSnapshot(docId, pushed.snapshot);
        applyReadySnapshot(pushed.snapshot, "pushed", { pushedSnapshot: true });
        return cleanup;
      }
    }
    if (!cached && retainedDocId) {
      recordChartPerf("chart-activation-retained", {
        docId,
        retainedDocId,
      });
    }
    if (!cached && sessionRefreshTick === 0 && hasPendingWorkspaceSnapshotCommand()) {
      void waitForWorkspaceSnapshotCommands().then(() => {
        if (controller.signal.aborted) return;
        const commandCached = getDocumentSnapshot(docId);
        if (commandCached) {
          applyReadySnapshot(commandCached, "command-cache", { waitedForCommand: true });
          return;
        }
        const openedCommandPushed = useDaemonWorkspaceStore.getState().commandSnapshot;
        if (openedCommandPushed?.docId === docId) {
          rememberDocumentSnapshot(docId, openedCommandPushed.snapshot);
          applyReadySnapshot(openedCommandPushed.snapshot, "command-pushed", {
            commandSnapshot: true,
            waitedForCommand: true,
          });
          return;
        }
        const commandPushed = useDaemonWorkspaceStore.getState().steppedSnapshot;
        if (commandPushed?.docId === docId) {
          rememberDocumentSnapshot(docId, commandPushed.snapshot);
          applyReadySnapshot(commandPushed.snapshot, "pushed", {
            pushedSnapshot: true,
            waitedForCommand: true,
          });
          return;
        }
        fetchAndApply();
      });
      return cleanup;
    }
    fetchAndApply();
    return cleanup;
  }, [docId, docKind, pushCommandSnapshot, sessionRefreshTick]);

  const commandSeq = commandSnapshot?.seq ?? 0;
  useEffect(() => {
    if (!docId || !commandSnapshot || commandSnapshot.docId !== docId) {
      return;
    }
    retainedDocIdRef.current = docId;
    // pushCommandSnapshot remembers/normalizes before publishing; this effect
    // only tracks which retained document is currently presented.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, commandSeq]);

  // Paint from a navigate-POST-pushed snapshot (step_fast during a burst, full
  // on settle) without a snapshot GET. Both this hook's instances (wheel +
  // status bar) subscribe to the same steppedSnapshot, so they stay coherent. A
  // step is NEVER options-driven, but the visible wheel still has to repaint
  // coherently: signs, houses, ASC/MC arrows, bodies, and hover regions all use
  // the stepped snapshot. Only expensive non-frame overlay facts are settled
  // later by the full repaint.
  const steppedSeq = steppedSnapshot?.seq ?? 0;
  useEffect(() => {
    if (!docId || !steppedSnapshot || steppedSnapshot.docId !== docId) {
      return;
    }
    retainedDocIdRef.current = docId;
    // pushSteppedSnapshot remembers/normalizes before publishing, so React can
    // never observe the raw partial overlay for an intermediate frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, steppedSeq]);

  if (!docId || !isChartBearingDocumentKind(docKind)) {
    return { chart: null };
  }
  if (steppedSnapshot?.docId === docId) {
    return { chart: steppedSnapshot.snapshot };
  }
  if (commandSnapshot?.docId === docId) {
    return { chart: commandSnapshot.snapshot };
  }
  const cachedSnapshot = getDocumentSnapshot(docId);
  if (cachedSnapshot) {
    return { chart: cachedSnapshot };
  }
  if (chart?.document?.documentId === docId) {
    return { chart };
  }
  if (chart) {
    return { chart };
  }
  return { chart: null };
}
